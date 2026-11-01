// Public storefront: browse the catalogue (KDP books + handmade), product pages, cart and COD checkout.
const express = require('express');
const { db, getSettings } = require('../db');
const C = require('../lib/catalog');
const O = require('../lib/options');
const ORD = require('../lib/orders');
const ADDR = require('../lib/address');
const { uploadFields, removeUploaded, removeFile } = require('../lib/upload');

const router = express.Router();
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const isBuyer = req => req.user && req.user.role === 'buyer';
// Cart/checkout need a buyer account; send everyone else to the buyer login and come back afterwards.
const needBuyer = backTo => (req, res, next) => {
  if (isBuyer(req)) return next();
  if (req.user) flash(req, 'warn', 'ตอนนี้เข้าสู่ระบบเป็นผู้ขายหรือแอดมินอยู่ ออกจากระบบแล้วเข้าสู่ระบบผู้ซื้อเพื่อสั่งซื้อ');
  res.redirect(`/account/login?next=${encodeURIComponent(typeof backTo === 'function' ? backTo(req) : backTo)}`);
};

const SOLD_30D = `(SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN shipments s ON s.id=i.shipment_id
                   WHERE i.product_id=p.id AND s.status<>'cancelled' AND s.created_at>?)`;

router.get('/', (req, res) => {
  const cat = req.query.cat === 'kdp' || req.query.cat === 'handmade' || C.ALL_CATS[req.query.cat] ? req.query.cat : 'all';
  const q = String(req.query.q || '').trim().slice(0, 80);
  let sql = ORD.LIVE.replace('SELECT p.*', `SELECT p.*, ${SOLD_30D} AS sold`);
  const p = [Date.now() - 30 * C.DAY];
  if (cat === 'kdp' || cat === 'handmade') { sql += ' AND p.kind=?'; p.push(cat); }
  else if (cat !== 'all') { sql += ' AND p.category=?'; p.push(cat); }
  if (q) { sql += ' AND (p.title LIKE ? OR p.subtitle LIKE ? OR p.keywords LIKE ? OR p.materials LIKE ? OR u.display_name LIKE ?)'; p.push(...Array(5).fill(`%${q}%`)); }
  const products = db.prepare(sql + ' ORDER BY p.updated_at DESC LIMIT 200').all(...p);
  // The landing sections (stats, category tiles, featured shops) only show on the unfiltered home page.
  const home = cat === 'all' && !q ? homeExtras() : null;
  res.render('store/index', { title: 'ร้านค้า', portal: 'store', products, cat, search: q, home, scripts: ['home'] });
});

function homeExtras() {
  const live = "p.status='approved' AND u.status='active'";
  const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM products p JOIN users u ON u.id=p.seller_id WHERE ${live} AND p.kind='kdp') AS books,
      (SELECT COUNT(*) FROM products p JOIN users u ON u.id=p.seller_id WHERE ${live} AND p.kind='handmade') AS handmade,
      (SELECT COUNT(DISTINCT p.seller_id) FROM products p JOIN users u ON u.id=p.seller_id WHERE ${live}) AS shops,
      (SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN shipments s ON s.id=i.shipment_id WHERE s.status IN ('delivered','released')) AS delivered`).get();
  const counts = Object.fromEntries(db.prepare(`SELECT p.category, COUNT(*) n FROM products p JOIN users u ON u.id=p.seller_id WHERE ${live} GROUP BY p.category`).all().map(r => [r.category, r.n]));
  const shops = db.prepare(`SELECT u.id, u.display_name AS name, COUNT(*) AS n, MIN(p.id) AS cover,
      GROUP_CONCAT(DISTINCT p.category) AS cats, MAX(u.ship_free_over) AS free_over
    FROM products p JOIN users u ON u.id=p.seller_id WHERE ${live} AND p.kind='handmade' GROUP BY u.id ORDER BY n DESC LIMIT 4`).all();
  return { stats, counts, shops };
}

function itemView(req, res, p, { form = {}, errors = null, status = 200 } = {}) {
  p.previews = JSON.parse(p.preview_files);
  p.opts = O.parse(p.options);
  // Books: fixed 7–14 days. Handmade: shop preparation days + 1–3 days transit (from payment confirmation).
  const eta = p.kind === 'kdp' ? C.waitRange(Date.now()) : C.hmRange(Date.now(), p.lead_days);
  const more = db.prepare(ORD.LIVE + ' AND p.seller_id=? AND p.id<>? ORDER BY p.updated_at DESC LIMIT 4').all(p.seller_id, p.id);
  res.status(status).render('store/item', { title: p.title, portal: 'store', p, form, errors, eta, more, left: ORD.capacityLeft(p), stock: ORD.stockLeft(p), ship: Number(getSettings().shipping) || 0 });
}

router.get('/book/:id', (req, res) => res.redirect(301, `/item/${encodeURIComponent(req.params.id)}`));
router.get('/item/:id', (req, res, next) => {
  const p = ORD.liveProduct(req.params.id);
  if (!p) return next();
  itemView(req, res, p);
});

/* ---------- cart ---------- */
router.post('/cart/add/:id', needBuyer(req => `/item/${req.params.id}`), (req, res, next) => {
  const p = ORD.liveProduct(req.params.id);
  if (!p) return next();
  const qty = Math.min(20, Math.max(1, parseInt(req.body.qty, 10) || 1));
  const sel = p.kind === 'handmade' ? O.readSelection(O.parse(p.options), req.body) : { lines: [], errors: [] };
  const errors = [...sel.errors];
  // Free-text message to the shop (handmade only), e.g. "ขอห่อของขวัญ" — kept with the item as its own line.
  const note = p.kind === 'handmade' ? String(req.body.note || '').trim().slice(0, 200) : '';
  if (/[<>]/.test(note)) errors.push('ข้อความสั่งทำพิเศษมีอักขระที่ใช้ไม่ได้');
  const inCart = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM cart_items WHERE buyer_id=? AND product_id=?').get(req.user.id, p.id).n;
  const left = ORD.capacityLeft(p);
  if (p.kind === 'handmade' && inCart + qty > left) errors.push(left > inCart ? `สั่งได้อีก ${left - inCart} ชิ้น (รวมที่อยู่ในตะกร้าแล้ว)` : 'สินค้าหมดหรือเต็มคิวแล้ว');
  if (errors.length) return itemView(req, res, p, { form: req.body, errors, status: 400 });
  db.prepare(`INSERT INTO cart_items(buyer_id,product_id,qty,options,added_at) VALUES (?,?,?,?,?)
              ON CONFLICT(buyer_id,product_id,options) DO UPDATE SET qty=MIN(20, qty+excluded.qty)`).run(req.user.id, p.id, qty, JSON.stringify(ORD.withNote(sel.lines, note)), Date.now());
  flash(req, 'good', `เพิ่ม “${p.title}” ลงตะกร้าแล้ว`);
  res.redirect('/cart');
});

router.get('/cart', needBuyer('/cart'), (req, res) => {
  const settings = getSettings();
  const cart = ORD.loadCart(req.user.id);
  const plan = ORD.planShipments(cart, settings);
  const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.render('store/cart', { title: 'ตะกร้า', portal: 'store', cart, plan, problems: cart.length ? ORD.checkoutProblems(buyer, cart, plan, settings) : [] });
});
router.post('/cart/:id/qty', needBuyer('/cart'), (req, res) => {
  const qty = Math.min(20, Math.max(1, parseInt(req.body.qty, 10) || 1));
  db.prepare('UPDATE cart_items SET qty=? WHERE id=? AND buyer_id=?').run(qty, req.params.id, req.user.id);
  res.redirect('/cart');
});
router.post('/cart/:id/remove', needBuyer('/cart'), (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id=? AND buyer_id=?').run(req.params.id, req.user.id);
  res.redirect('/cart');
});

/* ---------- checkout: books only → cash on delivery; anything handmade → transfer + slip ---------- */
function checkoutView(req, res, { form = {}, errors = null, status = 200 } = {}) {
  const settings = getSettings();
  const cart = ORD.loadCart(req.user.id);
  if (!cart.length) return res.redirect('/cart');
  const plan = ORD.planShipments(cart, settings);
  const addresses = ADDR.listAddresses(req.user.id);
  const me = db.prepare('SELECT display_name, phone FROM users WHERE id=?').get(req.user.id);
  res.status(status).render('store/checkout', { title: 'ชำระเงิน', portal: 'store', cart, plan, addresses, me, form, errors, now: Date.now() });
}
router.get('/checkout', needBuyer('/checkout'), (req, res) => checkoutView(req, res));
router.post('/checkout', needBuyer('/checkout'), uploadFields([{ name: 'slip', maxCount: 1 }], '/checkout'), (req, res) => {
  const slip = req.files?.slip?.[0];
  const fail = errors => { removeUploaded(req); return checkoutView(req, res, { form: req.body, errors, status: 400 }); };
  // Everything is made to order: the buyer must acknowledge the waiting time shown for each parcel.
  if (!req.body.ack_wait) return fail(['ติ๊กยืนยันว่ารับทราบระยะเวลารอสินค้าของแต่ละพัสดุ']);
  let address = req.body.address_id && req.body.address_id !== 'new' ? ADDR.myAddress(req.user.id, req.body.address_id) : null;
  if (!address) {
    const r = ADDR.readAddress(req.body);
    if (r.errors.length) return fail(r.errors);
    address = r.address;
    if (req.body.save_address) ADDR.saveAddress(req.user.id, address, false);
  }
  const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const out = ORD.placeOrder(buyer, address, { slip: slip?.filename });
  if (out.errors) return fail(out.errors);
  // A slip attached to a books-only (COD) cart is not needed.
  if (slip && !db.prepare("SELECT 1 FROM orders WHERE code=? AND method='transfer'").get(out.code)) removeFile(slip.filename);
  res.redirect(`/account/orders/${out.code}?new=1`);
});

module.exports = router;
