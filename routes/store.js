// Public storefront: browse the catalogue (KDP books + handmade), product pages, cart and COD checkout.
const express = require('express');
const { db, getSettings } = require('../db');
const C = require('../lib/catalog');
const O = require('../lib/options');
const ORD = require('../lib/orders');
const ADDR = require('../lib/address');

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
  res.render('store/index', { title: 'ร้านค้า', portal: 'store', products, cat, search: q });
});

function itemView(req, res, p, { form = {}, errors = null, status = 200 } = {}) {
  p.previews = JSON.parse(p.preview_files);
  p.opts = O.parse(p.options);
  const eta = C.waitRange(Date.now());
  res.status(status).render('store/item', { title: p.title, portal: 'store', p, form, errors, eta, left: ORD.capacityLeft(p), ship: Number(getSettings().shipping) || 0 });
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
  const sel = p.kind === 'handmade' ? O.readSelection(O.parse(p.options), req.body) : { lines: [], key: '[]', errors: [] };
  const errors = [...sel.errors];
  const inCart = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM cart_items WHERE buyer_id=? AND product_id=?').get(req.user.id, p.id).n;
  if (p.kind === 'handmade' && inCart + qty > ORD.capacityLeft(p)) errors.push(`ร้านรับคิวสินค้านี้ได้อีก ${ORD.capacityLeft(p)} ชิ้นในสัปดาห์นี้`);
  if (errors.length) return itemView(req, res, p, { form: req.body, errors, status: 400 });
  db.prepare(`INSERT INTO cart_items(buyer_id,product_id,qty,options,added_at) VALUES (?,?,?,?,?)
              ON CONFLICT(buyer_id,product_id,options) DO UPDATE SET qty=MIN(20, qty+excluded.qty)`).run(req.user.id, p.id, qty, sel.key, Date.now());
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

/* ---------- checkout (cash on delivery) ---------- */
function checkoutView(req, res, { form = {}, errors = null, status = 200 } = {}) {
  const settings = getSettings();
  const cart = ORD.loadCart(req.user.id);
  if (!cart.length) return res.redirect('/cart');
  const plan = ORD.planShipments(cart, settings);
  const addresses = ADDR.listAddresses(req.user.id);
  const me = db.prepare('SELECT display_name, phone FROM users WHERE id=?').get(req.user.id);
  res.status(status).render('store/checkout', { title: 'ชำระเงิน', portal: 'store', cart, plan, addresses, me, form, errors });
}
router.get('/checkout', needBuyer('/checkout'), (req, res) => checkoutView(req, res));
router.post('/checkout', needBuyer('/checkout'), (req, res) => {
  // Everything is made to order: the buyer must acknowledge the 7–14 day wait before ordering.
  if (!req.body.ack_wait) return checkoutView(req, res, { form: req.body, errors: [`ติ๊กยืนยันว่ารับทราบ: ${C.WAIT.text}`], status: 400 });
  let address = req.body.address_id && req.body.address_id !== 'new' ? ADDR.myAddress(req.user.id, req.body.address_id) : null;
  if (!address) {
    const r = ADDR.readAddress(req.body);
    if (r.errors.length) return checkoutView(req, res, { form: req.body, errors: r.errors, status: 400 });
    address = r.address;
    if (req.body.save_address) ADDR.saveAddress(req.user.id, address, false);
  }
  const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const out = ORD.placeOrder(buyer, address);
  if (out.errors) return checkoutView(req, res, { form: req.body, errors: out.errors, status: 400 });
  res.redirect(`/account/orders/${out.code}?new=1`);
});

module.exports = router;
