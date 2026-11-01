// Buyer portal (/account): sign up / log in, orders and shipment tracking, cancel, re-send slip,
// confirm receipt / report a problem (handmade), refund account, address book, profile.
const express = require('express');
const { db, getSettings } = require('../db');
const C = require('../lib/catalog');
const A = require('../lib/auth');
const ORD = require('../lib/orders');
const ADDR = require('../lib/address');
const mountAuth = require('../lib/auth-routes');
const { uploadFields, removeUploaded, removeFile } = require('../lib/upload');

const router = express.Router();
mountAuth(router, 'buyer', { passwordBack: '/account' });
router.use(A.requireRole('buyer'));

const str = (v, n) => String(v || '').trim().slice(0, n);
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

router.get('/', (req, res) => {
  const me = db.prepare('SELECT email,display_name,phone,cod_blocked,refund_account,created_at FROM users WHERE id=?').get(req.user.id);
  res.render('account/index', { title: 'บัญชีของฉัน', portal: 'store', me, addresses: ADDR.listAddresses(req.user.id), form: {}, errors: null });
});
router.post('/profile', (req, res) => {
  const name = str(req.body.display_name, 60), phone = str(req.body.phone, 20).replace(/[^\d+]/g, '');
  if (name.length < 2 || phone.replace(/\D/g, '').length < 9) flash(req, 'bad', 'ใส่ชื่ออย่างน้อย 2 ตัวอักษรและเบอร์โทรที่ถูกต้อง');
  else { db.prepare('UPDATE users SET display_name=?, phone=? WHERE id=?').run(name, phone, req.user.id); flash(req, 'good', 'บันทึกข้อมูลแล้ว'); }
  res.redirect('/account');
});
// Where admin sends money back (no bank link): free text, e.g. "พร้อมเพย์ 08x-xxx-xxxx ชื่อ ...".
router.post('/refund-account', (req, res) => {
  db.prepare('UPDATE users SET refund_account=? WHERE id=?').run(str(req.body.refund_account, 200), req.user.id);
  flash(req, 'good', 'บันทึกบัญชีรับเงินคืนแล้ว');
  res.redirect(typeof req.body.back === 'string' && /^\/account\/orders\/IF-[0-9A-F]+$/.test(req.body.back) ? req.body.back : '/account#refund');
});

router.post('/addresses', (req, res) => {
  const r = ADDR.readAddress(req.body);
  if (r.errors.length) {
    const me = db.prepare('SELECT email,display_name,phone,cod_blocked,refund_account,created_at FROM users WHERE id=?').get(req.user.id);
    return res.status(400).render('account/index', { title: 'บัญชีของฉัน', portal: 'store', me, addresses: ADDR.listAddresses(req.user.id), form: req.body, errors: r.errors });
  }
  ADDR.saveAddress(req.user.id, r.address, !!req.body.is_default);
  flash(req, 'good', 'เพิ่มที่อยู่แล้ว');
  res.redirect('/account#addresses');
});
router.post('/addresses/:id/default', (req, res) => {
  if (ADDR.myAddress(req.user.id, req.params.id)) {
    db.transaction(() => {
      db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
      db.prepare('UPDATE addresses SET is_default=1 WHERE id=?').run(req.params.id);
    })();
  }
  res.redirect('/account#addresses');
});
router.post('/addresses/:id/delete', (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.redirect('/account#addresses');
});

router.get('/orders', (req, res) => {
  const codes = db.prepare('SELECT code FROM orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  const orders = codes.map(o => ORD.orderDetail('o.code=?', o.code));
  res.render('account/orders', { title: 'คำสั่งซื้อของฉัน', portal: 'store', orders });
});
router.get('/orders/:code', (req, res, next) => {
  const order = ORD.orderDetail('o.code=? AND o.buyer_id=?', String(req.params.code).toUpperCase(), req.user.id);
  if (!order) return next();
  res.render('account/order', { title: `คำสั่งซื้อ ${order.code}`, portal: 'store', order, isNew: req.query.new === '1', settings: getSettings() });
});
const orderCode = (req, shipmentId) => db.prepare('SELECT o.code FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=? AND o.buyer_id=?').get(shipmentId, req.user.id)?.code;
const backToOrder = (req, res, shipmentId) => { const code = orderCode(req, shipmentId); res.redirect(code ? `/account/orders/${code}` : '/account/orders'); };

// Transfer orders: send a new slip when the first one was rejected.
router.post('/orders/:code/slip', uploadFields([{ name: 'slip', maxCount: 1 }], req => `/account/orders/${req.params.code}`), (req, res) => {
  const slip = req.files?.slip?.[0];
  const code = String(req.params.code).toUpperCase();
  if (!slip) { flash(req, 'bad', 'แนบสลิปการโอนเงิน'); return res.redirect(`/account/orders/${code}`); }
  const out = ORD.resubmitSlip(code, req.user.id, slip.filename);
  if (out.error) { removeUploaded(req); flash(req, 'bad', out.error); } else { removeFile(out.oldSlip); flash(req, 'good', 'ส่งสลิปใหม่แล้ว รอแอดมินตรวจ'); }
  res.redirect(`/account/orders/${code}`);
});

router.post('/shipments/:id/receive', (req, res) => {
  const out = ORD.moveShipment('buyer', req.user.id, Number(req.params.id), 'receive');
  flash(req, out.error ? 'bad' : 'good', out.error || (out.shipment?.fulfilled_by === 'platform' ? 'ขอบคุณที่ยืนยันว่าได้รับหนังสือแล้ว' : 'ขอบคุณที่ยืนยัน เราปล่อยเงินให้ร้านแล้ว'));
  backToOrder(req, res, req.params.id);
});

/* ---------- report a problem (handmade) ---------- */
function problemView(req, res, s, { form = {}, errors = null, status = 200 } = {}) {
  s.items = db.prepare('SELECT * FROM order_items WHERE shipment_id=? ORDER BY id').all(s.id).map(i => ({ ...i, lines: JSON.parse(i.options) }));
  res.status(status).render('account/problem', { title: 'แจ้งปัญหาพัสดุ', portal: 'store', s, form, errors });
}
const myShipment = req => {
  const s = ORD.getShipment(Number(req.params.id));
  if (!s || s.buyer_id !== req.user.id) return null;
  s.shop = db.prepare('SELECT display_name FROM users WHERE id=?').get(s.seller_id)?.display_name;
  return s;
};
router.get('/shipments/:id/problem', (req, res, next) => {
  const s = myShipment(req);
  if (!s) return next();
  if (s.status !== 'shipped' || C.shipFlow(s) !== 'hm') { flash(req, 'bad', 'แจ้งปัญหาได้เฉพาะพัสดุที่จัดส่งแล้วและยังไม่ได้กดรับสินค้า'); return backToOrder(req, res, s.id); }
  problemView(req, res, s);
});
router.post('/shipments/:id/problem', uploadFields([{ name: 'problem_images', maxCount: 3 }], req => `/account/shipments/${req.params.id}/problem`), (req, res, next) => {
  const s = myShipment(req);
  if (!s) { removeUploaded(req); return next(); }
  const imgs = (req.files || {}).problem_images || [];
  const out = ORD.openDispute(req.user.id, s.id, { kind: req.body.kind, detail: str(req.body.detail, 2000), images: imgs.map(f => f.filename) });
  if (out.error) { removeUploaded(req); return problemView(req, res, s, { form: req.body, errors: [out.error, ...(imgs.length ? ['รูปที่เลือกไว้ต้องแนบใหม่อีกครั้ง'] : [])], status: 400 }); }
  flash(req, 'good', 'ส่งเรื่องแล้ว แอดมินจะตรวจและแจ้งผลในหน้านี้ ระหว่างนี้ระบบจะยังไม่ปล่อยเงินให้ร้าน');
  backToOrder(req, res, s.id);
});
router.post('/shipments/:id/cancel', (req, res) => {
  const out = ORD.moveShipment('buyer', req.user.id, Number(req.params.id), 'cancel');
  flash(req, out.error ? 'bad' : 'good', out.error || 'ยกเลิกพัสดุนี้แล้ว');
  backToOrder(req, res, req.params.id);
});

module.exports = router;
