// Cart, checkout (COD only) and the shipment state machine shared by buyer, seller and admin routes.
const crypto = require('crypto');
const { db, getSettings } = require('../db');
const C = require('./catalog');
const O = require('./options');
const ADDR = require('./address');

const LIVE = `SELECT p.*, u.display_name AS shop FROM products p JOIN users u ON u.id=p.seller_id
              WHERE p.status='approved' AND u.status='active'`;
const liveProduct = id => db.prepare(LIVE + ' AND p.id=?').get(id);

// Handmade items already ordered (not cancelled) in the last 7 days, against weekly_capacity.
function weeklyLoad(productId) {
  return db.prepare(`SELECT COALESCE(SUM(i.qty),0) n FROM order_items i JOIN shipments s ON s.id=i.shipment_id
                     WHERE i.product_id=? AND s.status<>'cancelled' AND s.created_at>?`).get(productId, Date.now() - 7 * C.DAY).n;
}
const capacityLeft = p => (p.kind === 'handmade' ? Math.max(0, p.weekly_capacity - weeklyLoad(p.id)) : Infinity);

// Cart rows with live product data; rows whose product is gone/unlisted are flagged, not silently dropped.
function loadCart(buyerId) {
  const rows = db.prepare('SELECT * FROM cart_items WHERE buyer_id=? ORDER BY added_at').all(buyerId);
  return rows.map(r => {
    const p = liveProduct(r.product_id);
    const lines = JSON.parse(r.options);
    return { ...r, product: p, lines, unit: p ? priceWithLines(p, lines) : 0 };
  });
}
// Price = base + extras of the chosen values, recomputed from the product's current option list.
function priceWithLines(p, lines) {
  if (p.kind !== 'handmade') return p.price;
  let extra = 0;
  for (const o of O.parse(p.options)) {
    const l = lines.find(x => x.label === o.label);
    if (!l) continue;
    if (o.values) extra += (o.values.find(v => v.label === l.value) || { price: 0 }).price;
    else if (o.type === 'text') extra += o.price;
  }
  return p.price + extra;
}

// Groups cart rows into shipments: one Inkfold shipment for all KDP books, one per handmade seller.
function planShipments(cart, settings) {
  const groups = new Map();
  for (const r of cart) {
    if (!r.product) continue;
    const key = r.product.kind === 'kdp' ? 'platform' : 'seller:' + r.product.seller_id;
    if (!groups.has(key)) groups.set(key, {
      key, fulfilled_by: r.product.kind === 'kdp' ? 'platform' : 'seller',
      seller_id: r.product.kind === 'kdp' ? null : r.product.seller_id, shop: r.product.kind === 'kdp' ? null : r.product.shop,
      rows: [], items_total: 0, ship_fee: 0, lead_days: 0,
    });
    const g = groups.get(key);
    g.rows.push(r);
    g.items_total += r.unit * r.qty;
    g.ship_fee = g.fulfilled_by === 'platform' ? Number(settings.shipping) || 0 : Math.max(g.ship_fee, r.product.ship_fee);
    g.lead_days = Math.max(g.lead_days, r.product.kind === 'kdp' ? 3 : r.product.lead_days);
  }
  const list = [...groups.values()];
  const items = list.reduce((a, g) => a + g.items_total, 0), ship = list.reduce((a, g) => a + g.ship_fee, 0);
  return { shipments: list, items_total: items, ship_total: ship, total: items + ship };
}

function checkoutProblems(buyer, cart, plan, settings) {
  const e = [];
  if (!cart.length) e.push('ตะกร้าว่าง');
  if (cart.some(r => !r.product)) e.push('มีสินค้าในตะกร้าที่ปิดการขายแล้ว ลบออกก่อนสั่งซื้อ');
  if (buyer.cod_blocked) e.push('บัญชีนี้ถูกระงับการเก็บเงินปลายทาง เพราะมีพัสดุตีกลับหลายครั้ง ติดต่อร้าน');
  const limit = Number(settings.cod_limit) || 0;
  if (limit && plan.total > limit) e.push(`ยอดเก็บเงินปลายทางต่อคำสั่งซื้อได้ไม่เกิน ${C.thb(limit)}`);
  const want = new Map();
  for (const r of cart) if (r.product?.kind === 'handmade') want.set(r.product.id, (want.get(r.product.id) || 0) + r.qty);
  for (const [id, q] of want) {
    const p = cart.find(r => r.product?.id === id).product;
    if (q > capacityLeft(p)) e.push(`“${p.title}” รับคิวได้อีก ${capacityLeft(p)} ชิ้นในสัปดาห์นี้`);
  }
  return e;
}

function placeOrder(buyer, address) {
  const settings = getSettings();
  const cart = loadCart(buyer.id);
  const plan = planShipments(cart, settings);
  const errors = checkoutProblems(buyer, cart, plan, settings);
  if (errors.length) return { errors };
  const fee = Number(settings.hm_fee_pct) || 0;
  const now = Date.now();
  const code = 'IF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const addr = ADDR.format(address);
  db.transaction(() => {
    const orderId = db.prepare(`INSERT INTO orders(code,buyer_id,ship_name,ship_phone,ship_address,items_total,ship_total,total,created_at)
                                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(code, buyer.id, address.name, address.phone, addr, plan.items_total, plan.ship_total, plan.total, now).lastInsertRowid;
    for (const g of plan.shipments) {
      // Ship-by date: KDP 3 days to print; handmade = longest lead time + 1 day to hand over to the courier.
      const due = now + (g.fulfilled_by === 'platform' ? 3 : g.lead_days + 1) * C.DAY;
      const shipId = db.prepare(`INSERT INTO shipments(order_id,fulfilled_by,seller_id,items_total,ship_fee,due_at,created_at,updated_at)
                                 VALUES (?,?,?,?,?,?,?,?)`).run(orderId, g.fulfilled_by, g.seller_id, g.items_total, g.ship_fee, due, now, now).lastInsertRowid;
      for (const r of g.rows) {
        db.prepare(`INSERT INTO order_items(order_id,shipment_id,product_id,seller_id,kind,title,qty,unit_price,options,earn_unit)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(orderId, shipId, r.product.id, r.product.seller_id, r.product.kind, r.product.title, r.qty, r.unit, r.options, C.earnUnit(r.product, r.unit, fee));
      }
    }
    db.prepare('DELETE FROM cart_items WHERE buyer_id=?').run(buyer.id);
  })();
  return { code };
}

/* ---------- shipment state machine ---------- */
// actor: 'buyer' | 'seller' | 'admin'. Returns an error message, or null when the move is allowed.
const MOVES = {
  start:   { from: ['placed'], to: 'in_production' },
  ship:    { from: ['in_production'], to: 'shipped' },
  deliver: { from: ['shipped'], to: 'delivered' },
  return:  { from: ['shipped'], to: 'returned' },
  cancel:  { from: ['placed', 'in_production'], to: 'cancelled' },
};
function allowed(actor, s, move, userId) {
  const m = MOVES[move];
  if (!m || !m.from.includes(s.status)) return 'ทำรายการนี้ไม่ได้กับสถานะปัจจุบันของพัสดุ';
  if (actor === 'admin') return null;
  if (actor === 'seller') {
    if (s.fulfilled_by !== 'seller' || s.seller_id !== userId) return 'ไม่ใช่พัสดุของร้านคุณ';
    // COD money is collected by Inkfold's courier account, so only admin confirms delivered / returned.
    return ['start', 'ship', 'cancel'].includes(move) ? null : 'แอดมินเป็นผู้ยืนยันเมื่อขนส่งโอนยอดเก็บเงินปลายทาง';
  }
  if (actor === 'buyer') return move === 'cancel' && s.status === 'placed' ? null : 'ยกเลิกเองได้เฉพาะพัสดุที่ยังไม่เริ่มผลิต';
  return 'ไม่มีสิทธิ์';
}

function moveShipment(actor, userId, shipmentId, move, { tracking = '', note = '' } = {}) {
  const s = db.prepare('SELECT s.*, o.buyer_id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=?').get(shipmentId);
  if (!s) return { error: 'ไม่พบพัสดุ' };
  if (actor === 'buyer' && s.buyer_id !== userId) return { error: 'ไม่พบพัสดุ' };
  const err = allowed(actor, s, move, userId);
  if (err) return { error: err };
  if (move === 'ship' && !tracking) return { error: 'ใส่เลขพัสดุก่อนกดจัดส่ง' };
  if (move === 'cancel' && actor !== 'buyer' && note.length < 3) return { error: 'ใส่เหตุผลที่ยกเลิก (ผู้ซื้อจะเห็น)' };
  const now = Date.now();
  const upd = { status: MOVES[move].to, updated_at: now };
  if (move === 'ship') Object.assign(upd, { tracking, shipped_at: now });
  if (move === 'deliver') upd.delivered_at = now;
  if (move === 'cancel') Object.assign(upd, { cancelled_by: actor, note: note || 'ผู้ซื้อยกเลิกเอง' });
  if (move === 'return') upd.note = note || 'ผู้รับปฏิเสธรับพัสดุ';
  const cols = Object.keys(upd);
  db.transaction(() => {
    db.prepare(`UPDATE shipments SET ${cols.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...upd, id: s.id });
    if (move === 'return') {
      // Too many refused COD parcels → block COD for this buyer (admin can lift it).
      const limit = Number(getSettings().return_limit) || 0;
      const n = db.prepare("SELECT COUNT(*) n FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.buyer_id=? AND s.status='returned'").get(s.buyer_id).n;
      if (limit && n >= limit) db.prepare('UPDATE users SET cod_blocked=1 WHERE id=?').run(s.buyer_id);
    }
  })();
  return { shipment: { ...s, ...upd } };
}

// Order-level summary derived from its shipments (orders have no status column of their own).
function orderState(ships) {
  if (ships.every(s => s.status === 'cancelled')) return ['ยกเลิกแล้ว', 'bad'];
  const live = ships.filter(s => s.status !== 'cancelled');
  if (live.every(s => s.status === 'delivered')) return ['ได้รับครบแล้ว', 'good'];
  if (live.some(s => s.status === 'returned')) return ['มีพัสดุตีกลับ', 'bad'];
  if (live.every(s => ['shipped', 'delivered'].includes(s.status))) return ['จัดส่งแล้ว', 'info'];
  return ['กำลังดำเนินการ', 'warn'];
}

// Full order view (order + shipments + items) for buyer/admin pages.
function orderDetail(where, ...params) {
  const o = db.prepare(`SELECT o.*, u.display_name AS buyer, u.email AS buyer_email FROM orders o JOIN users u ON u.id=o.buyer_id WHERE ${where}`).get(...params);
  if (!o) return null;
  o.shipments = db.prepare(`SELECT s.*, u.display_name AS shop FROM shipments s LEFT JOIN users u ON u.id=s.seller_id WHERE order_id=? ORDER BY s.id`).all(o.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(o.id);
  for (const s of o.shipments) s.items = items.filter(i => i.shipment_id === s.id).map(i => ({ ...i, lines: JSON.parse(i.options) }));
  o.state = orderState(o.shipments);
  return o;
}

module.exports = {
  LIVE, liveProduct, capacityLeft, loadCart, priceWithLines, planShipments, checkoutProblems, placeOrder,
  MOVES, moveShipment, orderState, orderDetail,
};
