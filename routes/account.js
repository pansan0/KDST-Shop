// Buyer portal (/account): sign up / log in, orders and shipment tracking, cancel, address book, profile.
const express = require('express');
const { db } = require('../db');
const A = require('../lib/auth');
const ORD = require('../lib/orders');
const ADDR = require('../lib/address');
const mountAuth = require('../lib/auth-routes');

const router = express.Router();
mountAuth(router, 'buyer', { passwordBack: '/account' });
router.use(A.requireRole('buyer'));

const str = (v, n) => String(v || '').trim().slice(0, n);
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

router.get('/', (req, res) => {
  const me = db.prepare('SELECT email,display_name,phone,cod_blocked,created_at FROM users WHERE id=?').get(req.user.id);
  res.render('account/index', { title: 'บัญชีของฉัน', portal: 'store', me, addresses: ADDR.listAddresses(req.user.id), form: {}, errors: null });
});
router.post('/profile', (req, res) => {
  const name = str(req.body.display_name, 60), phone = str(req.body.phone, 20).replace(/[^\d+]/g, '');
  if (name.length < 2 || phone.replace(/\D/g, '').length < 9) flash(req, 'bad', 'ใส่ชื่ออย่างน้อย 2 ตัวอักษรและเบอร์โทรที่ถูกต้อง');
  else { db.prepare('UPDATE users SET display_name=?, phone=? WHERE id=?').run(name, phone, req.user.id); flash(req, 'good', 'บันทึกข้อมูลแล้ว'); }
  res.redirect('/account');
});

router.post('/addresses', (req, res) => {
  const r = ADDR.readAddress(req.body);
  if (r.errors.length) {
    const me = db.prepare('SELECT email,display_name,phone,cod_blocked,created_at FROM users WHERE id=?').get(req.user.id);
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
  res.render('account/order', { title: `คำสั่งซื้อ ${order.code}`, portal: 'store', order, isNew: req.query.new === '1' });
});
router.post('/shipments/:id/cancel', (req, res) => {
  const out = ORD.moveShipment('buyer', req.user.id, Number(req.params.id), 'cancel');
  const code = db.prepare('SELECT o.code FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=? AND o.buyer_id=?').get(req.params.id, req.user.id)?.code;
  flash(req, out.error ? 'bad' : 'good', out.error || 'ยกเลิกพัสดุนี้แล้ว');
  res.redirect(code ? `/account/orders/${code}` : '/account/orders');
});

module.exports = router;
