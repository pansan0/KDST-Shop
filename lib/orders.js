// Cart, checkout and the shipment state machine shared by buyer, seller, admin routes and the background jobs.
// Payment: carts with handmade items are paid by transfer + slip (one payment, split into parcels per shop);
// carts with only books stay cash-on-delivery exactly as before.
const crypto = require('crypto');
const { db, getSettings } = require('../db');
const C = require('./catalog');
const O = require('./options');
const ADDR = require('./address');

const LIVE = `SELECT p.*, u.display_name AS shop, u.ship_first, u.ship_next, u.ship_free_over
              FROM products p JOIN users u ON u.id=p.seller_id WHERE p.status='approved' AND u.status='active'`;
const liveProduct = id => db.prepare(LIVE + ' AND p.id=?').get(id);
const NOTE_LABEL = 'ข้อความสั่งทำพิเศษ';
const num = (v, d = 0) => Number(v) || d;

// Handmade items already ordered (not cancelled) in the last 7 days, against weekly_capacity.
function weeklyLoad(productId) {
  return db.prepare(`SELECT COALESCE(SUM(i.qty),0) n FROM order_items i JOIN shipments s ON s.id=i.shipment_id
                     WHERE i.product_id=? AND s.status<>'cancelled' AND s.created_at>?`).get(productId, Date.now() - 7 * C.DAY).n;
}
// Stock is deducted when payment is confirmed; until then unpaid orders hold it so it is not sold twice.
function stockLeft(p) {
  if (p.stock == null) return Infinity;
  const held = db.prepare(`SELECT COALESCE(SUM(i.qty),0) n FROM order_items i JOIN shipments s ON s.id=i.shipment_id
                           WHERE i.product_id=? AND s.status='awaiting_payment'`).get(p.id).n;
  return Math.max(0, p.stock - held);
}
const capacityLeft = p => (p.kind === 'handmade' ? Math.min(Math.max(0, p.weekly_capacity - weeklyLoad(p.id)), stockLeft(p)) : Infinity);

// Cart rows with live product data; rows whose product is gone/unlisted are flagged, not silently dropped.
// The buyer's custom-order note rides along as the last "line" so identical items with different notes stay separate.
function loadCart(buyerId) {
  const rows = db.prepare('SELECT * FROM cart_items WHERE buyer_id=? ORDER BY added_at').all(buyerId);
  return rows.map(r => {
    const p = liveProduct(r.product_id);
    const lines = JSON.parse(r.options);
    return { ...r, product: p, lines, unit: p ? priceWithLines(p, lines) : 0 };
  });
}
const splitNote = lines => ({ lines: lines.filter(l => !l.note), note: (lines.find(l => l.note) || {}).value || '' });
const withNote = (lines, note) => (note ? [...lines, { label: NOTE_LABEL, value: note, note: true }] : lines);

// Price = base + extras of the chosen values, recomputed from the product's current option list.
function priceWithLines(p, lines) {
  if (p.kind !== 'handmade') return p.price;
  let extra = 0;
  for (const o of O.parse(p.options)) {
    const l = lines.find(x => x.label === o.label && !x.note);
    if (!l) continue;
    if (o.values) extra += (o.values.find(v => v.label === l.value) || { price: 0 }).price;
    else if (o.type === 'text') extra += o.price;
  }
  return p.price + extra;
}

// Groups cart rows into shipments: one Inkfold shipment for all books, one per handmade shop (shop shipping rules).
function planShipments(cart, settings) {
  const groups = new Map();
  for (const r of cart) {
    if (!r.product) continue;
    const hm = r.product.kind === 'handmade';
    const key = hm ? 'seller:' + r.product.seller_id : 'platform';
    if (!groups.has(key)) groups.set(key, {
      key, fulfilled_by: hm ? 'seller' : 'platform', seller_id: hm ? r.product.seller_id : null, shop: hm ? r.product.shop : null,
      shopShip: hm ? { ship_first: r.product.ship_first, ship_next: r.product.ship_next, ship_free_over: r.product.ship_free_over } : null,
      rows: [], items_total: 0, qty: 0, ship_fee: 0, prep_days: 0,
    });
    const g = groups.get(key);
    g.rows.push(r);
    g.items_total += r.unit * r.qty;
    g.qty += r.qty;
    if (hm) g.prep_days = Math.max(g.prep_days, r.product.lead_days);
  }
  const list = [...groups.values()];
  for (const g of list) g.ship_fee = g.fulfilled_by === 'platform' ? num(settings.shipping) : C.shopShipFee(g.shopShip, g.qty, g.items_total);
  const items = list.reduce((a, g) => a + g.items_total, 0), ship = list.reduce((a, g) => a + g.ship_fee, 0);
  const method = list.some(g => g.fulfilled_by === 'seller') ? 'transfer' : 'cod';
  return { shipments: list, items_total: items, ship_total: ship, total: items + ship, method };
}

function checkoutProblems(buyer, cart, plan, settings) {
  const e = [];
  if (!cart.length) e.push('ตะกร้าว่าง');
  if (cart.some(r => !r.product)) e.push('มีสินค้าในตะกร้าที่ปิดการขายแล้ว ลบออกก่อนสั่งซื้อ');
  if (plan.method === 'cod') {
    if (buyer.cod_blocked) e.push('บัญชีนี้ถูกระงับการเก็บเงินปลายทาง เพราะมีพัสดุตีกลับหลายครั้ง ติดต่อร้าน');
    const limit = num(settings.cod_limit);
    if (limit && plan.total > limit) e.push(`ยอดเก็บเงินปลายทางต่อคำสั่งซื้อได้ไม่เกิน ${C.thb(limit)}`);
  }
  const want = new Map();
  for (const r of cart) if (r.product?.kind === 'handmade') want.set(r.product.id, (want.get(r.product.id) || 0) + r.qty);
  for (const [id, q] of want) {
    const p = cart.find(r => r.product?.id === id).product;
    const left = capacityLeft(p);
    if (q > left) e.push(left ? `“${p.title}” เหลือให้สั่งได้อีก ${left} ชิ้น` : `“${p.title}” สินค้าหมดหรือเต็มคิวแล้ว`);
  }
  return e;
}

function placeOrder(buyer, address, { slip } = {}) {
  const settings = getSettings();
  const cart = loadCart(buyer.id);
  const plan = planShipments(cart, settings);
  const errors = checkoutProblems(buyer, cart, plan, settings);
  if (plan.method === 'transfer' && !slip) errors.push('แนบสลิปการโอนเงิน');
  if (errors.length) return { errors };
  const fee = num(settings.hm_fee_pct);
  const now = Date.now();
  const code = 'IF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const prepaid = plan.method === 'transfer';
  db.transaction(() => {
    const orderId = db.prepare(`INSERT INTO orders(code,buyer_id,ship_name,ship_phone,ship_address,method,pay_status,slip_file,items_total,ship_total,total,created_at)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, buyer.id, address.name, address.phone, ADDR.format(address), plan.method, prepaid ? 'awaiting' : 'cod',
        prepaid ? slip : null, plan.items_total, plan.ship_total, plan.total, now).lastInsertRowid;
    for (const g of plan.shipments) {
      // Ship-by date: books 3 days to print; handmade = preparation days. Prepaid parcels get it again from the payment time.
      const due = now + (g.fulfilled_by === 'platform' ? 3 : g.prep_days) * C.DAY;
      const shipId = db.prepare(`INSERT INTO shipments(order_id,fulfilled_by,seller_id,status,items_total,ship_fee,prep_days,due_at,created_at,updated_at)
                                 VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(orderId, g.fulfilled_by, g.seller_id, prepaid ? 'awaiting_payment' : 'placed', g.items_total, g.ship_fee, g.prep_days, due, now, now).lastInsertRowid;
      for (const r of g.rows) {
        const { lines, note } = splitNote(r.lines);
        db.prepare(`INSERT INTO order_items(order_id,shipment_id,product_id,seller_id,kind,title,qty,unit_price,options,note,earn_unit)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(orderId, shipId, r.product.id, r.product.seller_id, r.product.kind, r.product.title, r.qty, r.unit, JSON.stringify(lines), note, C.earnUnit(r.product, r.unit, fee));
      }
    }
    db.prepare('DELETE FROM cart_items WHERE buyer_id=?').run(buyer.id);
  })();
  return { code };
}

/* ---------- payment (transfer orders) ---------- */
const stockMove = (shipmentId, sign) => db.prepare(`UPDATE products SET stock=MAX(0, stock + ? * (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE shipment_id=? AND product_id=products.id))
  WHERE stock IS NOT NULL AND id IN (SELECT product_id FROM order_items WHERE shipment_id=?)`).run(sign, shipmentId, shipmentId);

// Admin checked the slip: every unpaid parcel starts. Handmade parcels: stock deducted, money becomes "pending" for the shop.
function confirmPayment(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o || o.method !== 'transfer' || !['awaiting', 'rejected'].includes(o.pay_status)) return { error: 'คำสั่งซื้อนี้ไม่ได้รอยืนยันการชำระ' };
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE orders SET pay_status='paid', paid_at=?, slip_note='' WHERE id=?").run(now, o.id);
    for (const s of db.prepare("SELECT * FROM shipments WHERE order_id=? AND status='awaiting_payment'").all(o.id)) {
      if (s.fulfilled_by === 'platform') {
        db.prepare("UPDATE shipments SET status='placed', paid_at=?, due_at=?, updated_at=? WHERE id=?").run(now, now + 3 * C.DAY, now, s.id);
      } else {
        db.prepare("UPDATE shipments SET status='preparing', paid_at=?, due_at=?, updated_at=? WHERE id=?").run(now, now + s.prep_days * C.DAY, now, s.id);
        stockMove(s.id, -1);
      }
    }
  })();
  return { order: o };
}
function rejectSlip(orderId, note) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o || o.pay_status !== 'awaiting') return { error: 'คำสั่งซื้อนี้ไม่ได้รอตรวจสลิป' };
  db.prepare("UPDATE orders SET pay_status='rejected', slip_note=? WHERE id=?").run(note || 'สลิปไม่ถูกต้องหรือยอดไม่ตรง กรุณาส่งสลิปใหม่', o.id);
  return { order: o };
}
function resubmitSlip(code, buyerId, slip) {
  const o = db.prepare('SELECT * FROM orders WHERE code=? AND buyer_id=?').get(code, buyerId);
  if (!o || !['awaiting', 'rejected'].includes(o.pay_status)) return { error: 'ส่งสลิปใหม่ไม่ได้กับคำสั่งซื้อนี้' };
  db.prepare("UPDATE orders SET pay_status='awaiting', slip_file=?, slip_note='' WHERE id=?").run(slip, o.id);
  return { order: o, oldSlip: o.slip_file };
}

/* ---------- shipment state machine ---------- */
// who: actor → true (any `from` state) or a narrower list of states that actor may move from.
// Sellers can only touch their own parcels. 'system' is the background job (auto release / auto cancel).
const FLOWS = {
  pod: {
    start:   { from: ['placed'], to: 'in_production', who: { admin: true } },
    ship:    { from: ['in_production'], to: 'shipped', who: { admin: true } },
    deliver: { from: ['shipped'], to: 'delivered', who: { admin: true } },
    // Prepaid books (bought together with handmade): the buyer can confirm too. COD books wait for the admin,
    // who confirms once the carrier has remitted the cash.
    receive: { from: ['shipped'], to: 'delivered', who: { buyer: true, system: true }, when: s => s.method === 'transfer' },
    return:  { from: ['shipped'], to: 'returned', who: { admin: true } },
    cancel:  { from: ['awaiting_payment', 'placed', 'in_production'], to: 'cancelled', who: { admin: true, buyer: ['placed'] } },
  },
  legacy: {
    start:   { from: ['placed'], to: 'in_production', who: { admin: true, seller: true } },
    ship:    { from: ['in_production'], to: 'shipped', who: { admin: true, seller: true } },
    deliver: { from: ['shipped'], to: 'delivered', who: { admin: true } },
    return:  { from: ['shipped'], to: 'returned', who: { admin: true } },
    cancel:  { from: ['placed', 'in_production'], to: 'cancelled', who: { admin: true, seller: true, buyer: ['placed'] } },
  },
  hm: {
    ship:    { from: ['preparing'], to: 'shipped', who: { admin: true, seller: true } },
    receive: { from: ['shipped'], to: 'released', who: { buyer: true } },
    report:  { from: ['shipped'], to: 'problem', who: { buyer: true } },
    release: { from: ['shipped', 'problem'], to: 'released', who: { admin: true, system: ['shipped'] } },
    refund:  { from: ['problem'], to: 'refunded', who: { admin: true } },
    cancel:  { from: ['awaiting_payment', 'preparing'], to: 'cancelled', who: { admin: true, seller: ['preparing'], system: ['preparing'] } },
  },
};
const MOVES = Object.assign({}, ...Object.values(FLOWS)); // every move name, for route whitelists

const SHIP_SELECT = `SELECT s.*, o.buyer_id, o.method, o.pay_status, o.code FROM shipments s JOIN orders o ON o.id=s.order_id`;
const getShipment = id => db.prepare(SHIP_SELECT + ' WHERE s.id=?').get(id);

function allowed(actor, s, move, userId) {
  const m = FLOWS[C.shipFlow(s)][move];
  if (!m || !m.from.includes(s.status)) return 'ทำรายการนี้ไม่ได้กับสถานะปัจจุบันของพัสดุ';
  if (m.when && !m.when(s)) return move === 'receive' ? 'พัสดุเก็บเงินปลายทาง แอดมินจะยืนยันเมื่อขนส่งโอนยอดให้' : 'ทำรายการนี้ไม่ได้กับพัสดุนี้';
  const who = m.who[actor];
  if (!who) {
    if (actor === 'seller') return move === 'deliver' || move === 'return' ? 'แอดมินเป็นผู้ยืนยันเมื่อขนส่งโอนยอดเก็บเงินปลายทาง' : 'ไม่มีสิทธิ์ทำรายการนี้';
    if (actor === 'buyer') return move === 'cancel' ? 'ยกเลิกเองได้เฉพาะพัสดุที่ยังไม่เริ่มผลิต' : 'ไม่มีสิทธิ์ทำรายการนี้';
    return 'ไม่มีสิทธิ์ทำรายการนี้';
  }
  if (Array.isArray(who) && !who.includes(s.status)) return actor === 'buyer' ? 'ยกเลิกเองได้เฉพาะพัสดุที่ยังไม่เริ่มผลิต' : 'ทำรายการนี้ไม่ได้กับสถานะปัจจุบันของพัสดุ';
  if (actor === 'seller' && (s.fulfilled_by !== 'seller' || s.seller_id !== userId)) return 'ไม่ใช่พัสดุของร้านคุณ';
  if (actor === 'buyer' && s.buyer_id !== userId) return 'ไม่พบพัสดุ';
  return null;
}

const refundOf = s => s.items_total + s.ship_fee;
function addRefund(s, amount, reason) {
  db.prepare('INSERT INTO refunds(order_id,shipment_id,buyer_id,amount,reason,created_at) VALUES (?,?,?,?,?,?)').run(s.order_id, s.id, s.buyer_id, amount, reason, Date.now());
}

// opts: tracking, carrier, note, amount (refund), auto (system note)
function moveShipment(actor, userId, shipmentId, move, { tracking = '', carrier = '', note = '', amount, auto = '' } = {}) {
  const s = getShipment(shipmentId);
  if (!s || (actor === 'buyer' && s.buyer_id !== userId)) return { error: 'ไม่พบพัสดุ' };
  const err = allowed(actor, s, move, userId);
  if (err) return { error: err };
  const flow = C.shipFlow(s);
  if (move === 'ship' && !tracking) return { error: 'ใส่เลขพัสดุก่อนกดจัดส่ง' };
  if (move === 'ship' && flow === 'hm' && !carrier) return { error: 'เลือกบริษัทขนส่ง' };
  if (move === 'cancel' && actor !== 'buyer' && note.length < 3) return { error: 'ใส่เหตุผลที่ยกเลิก (ผู้ซื้อจะเห็น)' };
  const now = Date.now();
  const m = FLOWS[flow][move];
  const upd = { status: m.to, updated_at: now };
  if (move === 'ship') Object.assign(upd, { tracking, carrier, shipped_at: now });
  if (move === 'deliver') upd.delivered_at = now;
  if (move === 'receive') Object.assign(upd, flow === 'hm' ? { delivered_at: now, released_at: now } : { delivered_at: now });
  if (move === 'release') Object.assign(upd, { released_at: now });
  if (move === 'cancel') Object.assign(upd, { cancelled_by: actor, note: note || 'ผู้ซื้อยกเลิกเอง' });
  if (move === 'return') upd.note = note || 'ผู้รับปฏิเสธรับพัสดุ';
  if (auto) upd.auto_note = auto;
  const cols = Object.keys(upd);
  db.transaction(() => {
    db.prepare(`UPDATE shipments SET ${cols.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...upd, id: s.id });
    if (move === 'cancel' && s.method === 'transfer' && s.status !== 'awaiting_payment') {
      // Money was already taken: owe it back, and put stock back on the shelf.
      addRefund(s, refundOf(s), `ยกเลิกพัสดุ: ${upd.note}`);
      if (s.fulfilled_by === 'seller') stockMove(s.id, +1);
    }
    if (move === 'refund') addRefund(s, Math.min(refundOf(s), amount ?? refundOf(s)), note || 'แอดมินตัดสินให้คืนเงิน');
    if (move === 'return' && s.method === 'cod') {
      // Too many refused COD parcels → block COD for this buyer (admin can lift it).
      const limit = num(getSettings().return_limit);
      const n = db.prepare("SELECT COUNT(*) n FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.buyer_id=? AND s.status='returned'").get(s.buyer_id).n;
      if (limit && n >= limit) db.prepare('UPDATE users SET cod_blocked=1 WHERE id=?').run(s.buyer_id);
    }
  })();
  return { shipment: { ...s, ...upd } };
}

/* ---------- problems & refunds ---------- */
function openDispute(buyerId, shipmentId, { kind, detail, images }) {
  if (!C.PROBLEM_KINDS[kind]) return { error: 'เลือกประเภทปัญหา' };
  if (detail.length < 10) return { error: 'เล่าปัญหาอย่างน้อย 10 ตัวอักษร' };
  const s = getShipment(shipmentId);
  if (!s || s.buyer_id !== buyerId) return { error: 'ไม่พบพัสดุ' };
  const err = allowed('buyer', s, 'report', buyerId);
  if (err) return { error: 'แจ้งปัญหาได้เฉพาะพัสดุที่จัดส่งแล้วและยังไม่ได้กดรับสินค้า' };
  db.transaction(() => {
    db.prepare('INSERT INTO disputes(shipment_id,buyer_id,kind,detail,images,created_at) VALUES (?,?,?,?,?,?)').run(s.id, buyerId, kind, detail, JSON.stringify(images), Date.now());
    moveShipment('buyer', buyerId, s.id, 'report');
  })();
  return { shipment: s };
}

// decision: 'refund' (amount, note) or 'release' (note)
function decideDispute(disputeId, adminId, decision, { amount, note = '' } = {}) {
  const d = db.prepare('SELECT * FROM disputes WHERE id=?').get(disputeId);
  if (!d || d.status !== 'open') return { error: 'เรื่องนี้ตัดสินไปแล้ว' };
  if (!['refund', 'release'].includes(decision)) return { error: 'เลือกผลการตัดสิน' };
  if (note.length < 3) return { error: 'เขียนเหตุผล (ลูกค้าและร้านจะเห็น)' };
  let out;
  db.transaction(() => {
    out = decision === 'refund'
      ? moveShipment('admin', adminId, d.shipment_id, 'refund', { amount, note: `เรื่องร้องเรียน #${d.id}: ${note}` })
      : moveShipment('admin', adminId, d.shipment_id, 'release');
    if (out.error) return;
    db.prepare('UPDATE disputes SET status=?, decision_note=?, admin_id=?, decided_at=? WHERE id=?').run(decision, note, adminId, Date.now(), d.id);
  })();
  return out;
}

function markRefundPaid(refundId, adminId, ref) {
  const r = db.prepare('SELECT * FROM refunds WHERE id=?').get(refundId);
  if (!r || r.status !== 'pending') return { error: 'รายการนี้คืนเงินไปแล้ว' };
  if (!ref) return { error: 'ใส่เลขอ้างอิงการโอน' };
  db.prepare("UPDATE refunds SET status='paid', ref=?, admin_id=?, paid_at=? WHERE id=?").run(ref, adminId, Date.now(), r.id);
  return { refund: r };
}

/* ---------- views ---------- */
// Order-level summary derived from its shipments (orders have no status column of their own).
function orderState(o, ships) {
  if (o.method === 'transfer' && o.pay_status === 'awaiting') return ['รอตรวจสลิป', 'warn'];
  if (o.method === 'transfer' && o.pay_status === 'rejected') return ['สลิปไม่ผ่าน · ส่งใหม่', 'bad'];
  if (ships.every(s => s.status === 'cancelled')) return ['ยกเลิกแล้ว', 'bad'];
  const live = ships.filter(s => s.status !== 'cancelled');
  if (live.some(s => s.status === 'problem')) return ['มีปัญหา · รอแอดมิน', 'bad'];
  if (live.every(s => ['delivered', 'released', 'refunded'].includes(s.status))) return live.some(s => s.status === 'refunded') ? ['เสร็จสิ้น · มีการคืนเงิน', 'neutral'] : ['ได้รับครบแล้ว', 'good'];
  if (live.some(s => s.status === 'returned')) return ['มีพัสดุตีกลับ', 'bad'];
  if (live.every(s => ['shipped', 'delivered', 'released'].includes(s.status))) return ['จัดส่งแล้ว', 'info'];
  return ['กำลังดำเนินการ', 'warn'];
}

// Full order view (order + shipments + items + problems + refunds) for buyer/admin pages.
function orderDetail(where, ...params) {
  const o = db.prepare(`SELECT o.*, u.display_name AS buyer, u.email AS buyer_email, u.refund_account FROM orders o JOIN users u ON u.id=o.buyer_id WHERE ${where}`).get(...params);
  if (!o) return null;
  o.shipments = db.prepare(`SELECT s.*, u.display_name AS shop FROM shipments s LEFT JOIN users u ON u.id=s.seller_id WHERE order_id=? ORDER BY s.id`).all(o.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(o.id);
  const disputes = db.prepare('SELECT d.* FROM disputes d JOIN shipments s ON s.id=d.shipment_id WHERE s.order_id=? ORDER BY d.id').all(o.id);
  const refunds = db.prepare('SELECT * FROM refunds WHERE order_id=? ORDER BY id').all(o.id);
  for (const s of o.shipments) {
    s.method = o.method;
    s.flow = C.shipFlow(s);
    s.items = items.filter(i => i.shipment_id === s.id).map(i => ({ ...i, lines: JSON.parse(i.options) }));
    s.disputes = disputes.filter(d => d.shipment_id === s.id).map(d => ({ ...d, imgs: JSON.parse(d.images) }));
    s.refunds = refunds.filter(r => r.shipment_id === s.id);
  }
  o.refunds = refunds;
  o.state = orderState(o, o.shipments);
  return o;
}

module.exports = {
  LIVE, NOTE_LABEL, liveProduct, capacityLeft, stockLeft, loadCart, priceWithLines, planShipments, checkoutProblems, placeOrder,
  splitNote, withNote, confirmPayment, rejectSlip, resubmitSlip,
  FLOWS, MOVES, SHIP_SELECT, getShipment, moveShipment, openDispute, decideDispute, markRefundPaid, orderState, orderDetail,
};
