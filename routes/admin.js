// Admin portal: review listings against the standards checklist, vet handmade sellers, print & ship KDP,
// oversee seller shipments and COD settlement, manage buyers, pay sellers.
const express = require('express');
const cfg = require('../config');
const { db, getSettings, setSetting, sellerStats, sellerMetrics } = require('../db');
const C = require('../lib/catalog');
const O = require('../lib/options');
const ORD = require('../lib/orders');
const A = require('../lib/auth');
const mountAuth = require('../lib/auth-routes');

const router = express.Router();
mountAuth(router, 'admin', { passwordBack: '/admin/settings' });
router.use(A.requireRole('admin'));

const str = (v, n) => String(v || '').trim().slice(0, n);
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const back = (req, d) => (typeof req.body.back === 'string' && /^\/admin(\/|$|\?)/.test(req.body.back) ? req.body.back : d);

router.use((req, res, next) => {
  res.locals.badges = {
    products: db.prepare("SELECT COUNT(*) n FROM products WHERE status='pending'").get().n,
    orders: db.prepare("SELECT COUNT(*) n FROM shipments WHERE fulfilled_by='platform' AND status IN ('placed','in_production')").get().n,
    apps: db.prepare("SELECT COUNT(*) n FROM seller_applications WHERE status='applied'").get().n,
  };
  next();
});

const PRODUCT_LIST = `SELECT p.*, u.display_name AS shop, u.email AS seller_email FROM products p JOIN users u ON u.id=p.seller_id`;

router.get('/', (req, res) => {
  const now = Date.now();
  const k = db.prepare(`SELECT
      (SELECT COALESCE(SUM(items_total),0) FROM shipments WHERE status='delivered') AS revenue,
      (SELECT COUNT(*) FROM shipments WHERE status='shipped') AS awaiting_cod,
      (SELECT COUNT(*) FROM shipments WHERE fulfilled_by='seller' AND status IN ('placed','in_production') AND due_at<?) AS late,
      (SELECT COUNT(*) FROM users WHERE role='seller') AS sellers,
      (SELECT COUNT(*) FROM users WHERE role='buyer') AS buyers,
      (SELECT COUNT(*) FROM products WHERE status='approved') AS live`).get(now);
  const owed = db.prepare("SELECT id FROM users WHERE role='seller'").all().reduce((a, s) => a + sellerStats(s.id).balance, 0);
  const products = db.prepare(PRODUCT_LIST + " WHERE p.status='pending' ORDER BY p.submitted_at LIMIT 5").all();
  const apps = db.prepare("SELECT a.*, u.display_name AS shop FROM seller_applications a JOIN users u ON u.id=a.seller_id WHERE a.status='applied' ORDER BY a.created_at LIMIT 5").all();
  res.render('admin/dashboard', { title: 'ภาพรวม', portal: 'admin', k, owed, products, apps });
});

/* ---------- product review ---------- */
const PRODUCT_FILTERS = { pending: 'รอตรวจ', approved: 'วางขาย', changes: 'ต้องแก้ไข', rejected: 'ไม่อนุมัติ', suspended: 'ถูกระงับ', archived: 'ปิดการขาย', all: 'ทั้งหมด' };
router.get('/products', (req, res) => {
  const status = PRODUCT_FILTERS[req.query.status] ? req.query.status : 'pending';
  const kind = C.KINDS[req.query.kind] ? req.query.kind : '';
  let sql = PRODUCT_LIST + (status === 'all' ? " WHERE p.status<>'draft'" : ' WHERE p.status=?');
  const params = status === 'all' ? [] : [status];
  if (kind) { sql += ' AND p.kind=?'; params.push(kind); }
  sql += ` ORDER BY ${status === 'pending' ? 'p.submitted_at ASC' : 'p.updated_at DESC'} LIMIT 300`;
  res.render('admin/products', { title: 'ตรวจสินค้า', portal: 'admin', products: db.prepare(sql).all(...params), status, kind, filters: PRODUCT_FILTERS });
});

router.get('/products/:id', (req, res, next) => {
  const p = db.prepare(PRODUCT_LIST + ' WHERE p.id=?').get(req.params.id);
  if (!p || p.status === 'draft') return next();
  p.previews = JSON.parse(p.preview_files);
  p.opts = O.parse(p.options);
  const history = db.prepare('SELECT r.*, u.display_name AS admin_name FROM reviews r JOIN users u ON u.id=r.admin_id WHERE product_id=? ORDER BY r.id DESC').all(p.id);
  const last = history.find(h => h.rev === p.rev);
  res.render('admin/product', { title: p.title, portal: 'admin', p, history, checklist: C.checksFor(p), checks: last ? JSON.parse(last.checks) : {}, fee: Number(getSettings().hm_fee_pct) || 0 });
});

router.post('/products/:id/review', (req, res, next) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return next();
  const decision = ['approved', 'changes', 'rejected'].includes(req.body.decision) ? req.body.decision : null;
  const note = str(req.body.note, 1000);
  const checks = Object.fromEntries(C.checksFor(p).map(([k]) => [k, req.body['ck_' + k] ? 1 : 0]));
  let err = null;
  if (p.status !== 'pending') err = 'สินค้านี้ไม่ได้อยู่ในสถานะรอตรวจ';
  else if (!decision) err = 'เลือกผลการตรวจ';
  else if (decision === 'approved' && !Object.values(checks).every(Boolean)) err = 'ติ๊กเช็กลิสต์มาตรฐานให้ครบทุกข้อก่อนอนุมัติ';
  else if (decision !== 'approved' && note.length < 5) err = 'เขียนเหตุผลถึงผู้ขาย';
  if (err) { flash(req, 'bad', err); return res.redirect(`/admin/products/${p.id}`); }
  const now = Date.now();
  db.transaction(() => {
    db.prepare('INSERT INTO reviews(product_id,rev,admin_id,decision,note,checks,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(p.id, p.rev, req.user.id, decision, note, JSON.stringify(checks), now);
    db.prepare('UPDATE products SET status=?, updated_at=? WHERE id=?').run(decision, now, p.id);
  })();
  flash(req, 'good', { approved: 'อนุมัติแล้ว สินค้าขึ้นหน้าร้าน', changes: 'ส่งกลับให้ผู้ขายแก้ไขแล้ว', rejected: 'บันทึกว่าไม่อนุมัติแล้ว' }[decision]);
  const nextPending = db.prepare("SELECT id FROM products WHERE status='pending' ORDER BY submitted_at LIMIT 1").get();
  res.redirect(nextPending ? `/admin/products/${nextPending.id}` : '/admin/products');
});

router.post('/products/:id/suspend', (req, res, next) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return next();
  const note = str(req.body.note, 1000);
  if (!['approved', 'archived'].includes(p.status)) flash(req, 'bad', 'ระงับได้เฉพาะสินค้าที่วางขายหรือปิดการขาย');
  else if (note.length < 5) flash(req, 'bad', 'เขียนเหตุผลที่ระงับ');
  else {
    db.prepare("INSERT INTO reviews(product_id,rev,admin_id,decision,note,checks,created_at) VALUES (?,?,?,'suspended',?,'{}',?)").run(p.id, p.rev, req.user.id, note, Date.now());
    db.prepare("UPDATE products SET status='suspended', updated_at=? WHERE id=?").run(Date.now(), p.id);
    flash(req, 'good', 'ระงับการขายแล้ว');
  }
  res.redirect(`/admin/products/${p.id}`);
});
router.post('/products/:id/reinstate', (req, res, next) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return next();
  if (p.status === 'suspended') {
    db.prepare("INSERT INTO reviews(product_id,rev,admin_id,decision,note,checks,created_at) VALUES (?,?,?,'approved','ยกเลิกการระงับ','{}',?)").run(p.id, p.rev, req.user.id, Date.now());
    db.prepare("UPDATE products SET status='approved', updated_at=? WHERE id=?").run(Date.now(), p.id);
    flash(req, 'good', 'กลับมาวางขายแล้ว');
  }
  res.redirect(`/admin/products/${p.id}`);
});

/* ---------- shipments ---------- */
const SHIP_TABS = {
  platform: ['พิมพ์และส่ง (Inkfold)', "s.fulfilled_by='platform' AND s.status IN ('placed','in_production')"],
  cod: ['รอยืนยันเก็บเงิน', "s.status='shipped'"],
  seller: ['ผู้ขายกำลังทำ', "s.fulfilled_by='seller' AND s.status IN ('placed','in_production')"],
  late: ['เลยกำหนดส่ง', "s.status IN ('placed','in_production') AND s.due_at<@now"],
  done: ['เสร็จสิ้น', "s.status IN ('delivered','cancelled','returned')"],
  all: ['ทั้งหมด', '1=1'],
};
router.get('/orders', (req, res) => {
  const tab = SHIP_TABS[req.query.tab] ? req.query.tab : 'platform';
  const ships = db.prepare(`SELECT s.*, o.code, o.ship_name, o.ship_phone, o.ship_address, b.display_name AS buyer, u.display_name AS shop
      FROM shipments s JOIN orders o ON o.id=s.order_id JOIN users b ON b.id=o.buyer_id LEFT JOIN users u ON u.id=s.seller_id
      WHERE ${SHIP_TABS[tab][1]} ORDER BY s.due_at ${tab === 'done' || tab === 'all' ? 'DESC' : 'ASC'} LIMIT 300`).all({ now: Date.now() });
  const items = db.prepare('SELECT i.*, p.pdf_file, p.cover_pdf FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.shipment_id=? ORDER BY i.id');
  for (const s of ships) s.items = items.all(s.id).map(i => ({ ...i, lines: JSON.parse(i.options) }));
  const counts = Object.fromEntries(Object.entries(SHIP_TABS).map(([k, [, w]]) => [k, db.prepare(`SELECT COUNT(*) n FROM shipments s WHERE ${w}`).get({ now: Date.now() }).n]));
  res.render('admin/orders', { title: 'คำสั่งซื้อ', portal: 'admin', ships, tab, tabs: SHIP_TABS, counts });
});
router.post('/shipments/:id/:move', (req, res) => {
  const move = req.params.move;
  if (!ORD.MOVES[move]) return res.redirect(back(req, '/admin/orders'));
  const out = ORD.moveShipment('admin', req.user.id, Number(req.params.id), move, { tracking: str(req.body.tracking, 60), note: str(req.body.note, 300) });
  flash(req, out.error ? 'bad' : 'good', out.error || {
    start: 'ส่งเข้าคิวพิมพ์แล้ว', ship: 'บันทึกเลขพัสดุแล้ว', deliver: 'ยืนยันส่งถึงและเก็บเงินแล้ว ยอดเข้าบัญชีผู้ขาย',
    return: 'บันทึกว่าพัสดุตีกลับแล้ว', cancel: 'ยกเลิกพัสดุแล้ว',
  }[move]);
  res.redirect(back(req, '/admin/orders'));
});

/* ---------- sellers & handmade applications ---------- */
function sellerRows() {
  return db.prepare(`SELECT u.id,u.email,u.display_name,u.phone,u.status,u.handmade_status,u.created_at,u.last_login_at,u.payout_account,u.payout_name,u.payout_bank,
      (SELECT COUNT(*) FROM products p WHERE p.seller_id=u.id AND p.status='approved') AS live,
      (SELECT COUNT(*) FROM products p WHERE p.seller_id=u.id AND p.status<>'draft') AS submitted
    FROM users u WHERE role='seller' ORDER BY u.created_at DESC`).all().map(s => ({ ...s, stats: sellerStats(s.id), metrics: sellerMetrics(s.id) }));
}
router.get('/sellers', (req, res) => {
  const apps = db.prepare(`SELECT a.*, u.display_name AS shop, u.email FROM seller_applications a JOIN users u ON u.id=a.seller_id
                           ORDER BY a.status='applied' DESC, a.created_at DESC LIMIT 50`).all().map(a => ({ ...a, imgs: JSON.parse(a.images) }));
  res.render('admin/sellers', { title: 'ผู้ขาย', portal: 'admin', sellers: sellerRows(), apps });
});
router.post('/applications/:id', (req, res, next) => {
  const a = db.prepare('SELECT * FROM seller_applications WHERE id=?').get(req.params.id);
  if (!a) return next();
  const decision = req.body.decision === 'approved' ? 'approved' : req.body.decision === 'rejected' ? 'rejected' : null;
  const note = str(req.body.note, 500);
  if (a.status !== 'applied' || !decision) flash(req, 'bad', 'ใบสมัครนี้พิจารณาไปแล้ว');
  else if (decision === 'rejected' && note.length < 5) flash(req, 'bad', 'เขียนเหตุผลที่ไม่ผ่าน (ผู้ขายจะเห็น)');
  else {
    db.transaction(() => {
      db.prepare('UPDATE seller_applications SET status=?, note=?, admin_id=?, decided_at=? WHERE id=?').run(decision, note, req.user.id, Date.now(), a.id);
      db.prepare('UPDATE users SET handmade_status=? WHERE id=?').run(decision, a.seller_id);
    })();
    flash(req, 'good', decision === 'approved' ? 'อนุมัติผู้ขาย handmade แล้ว' : 'บันทึกว่าไม่ผ่านแล้ว');
  }
  res.redirect('/admin/sellers');
});
router.post('/users/:id/status', (req, res, next) => {
  const u = db.prepare("SELECT id,role,display_name FROM users WHERE id=? AND role IN ('seller','buyer')").get(req.params.id);
  if (!u) return next();
  const st = req.body.status === 'suspended' ? 'suspended' : 'active';
  db.prepare('UPDATE users SET status=? WHERE id=?').run(st, u.id);
  if (st === 'suspended') db.prepare("DELETE FROM sessions WHERE json_extract(sess,'$.userId')=?").run(u.id);
  flash(req, 'good', st === 'suspended' ? `ระงับบัญชี ${u.display_name} แล้ว${u.role === 'seller' ? ' สินค้าทั้งหมดถูกซ่อนจากหน้าร้าน' : ''}` : `เปิดใช้งานบัญชี ${u.display_name} แล้ว`);
  res.redirect(u.role === 'seller' ? '/admin/sellers' : '/admin/buyers');
});

/* ---------- buyers ---------- */
router.get('/buyers', (req, res) => {
  const buyers = db.prepare(`SELECT u.id,u.email,u.display_name,u.phone,u.status,u.cod_blocked,u.created_at,
      (SELECT COUNT(*) FROM orders o WHERE o.buyer_id=u.id) AS orders,
      (SELECT COUNT(*) FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.buyer_id=u.id AND s.status='returned') AS returned,
      (SELECT COALESCE(SUM(s.items_total+s.ship_fee),0) FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.buyer_id=u.id AND s.status='delivered') AS spent
    FROM users u WHERE role='buyer' ORDER BY u.created_at DESC LIMIT 500`).all();
  res.render('admin/buyers', { title: 'ผู้ซื้อ', portal: 'admin', buyers });
});
router.post('/buyers/:id/cod', (req, res, next) => {
  const u = db.prepare("SELECT id,display_name FROM users WHERE id=? AND role='buyer'").get(req.params.id);
  if (!u) return next();
  const blocked = req.body.blocked === '1' ? 1 : 0;
  db.prepare('UPDATE users SET cod_blocked=? WHERE id=?').run(blocked, u.id);
  flash(req, 'good', blocked ? `ปิดสิทธิ์เก็บเงินปลายทางของ ${u.display_name} แล้ว` : `เปิดสิทธิ์เก็บเงินปลายทางให้ ${u.display_name} แล้ว`);
  res.redirect('/admin/buyers');
});

/* ---------- payouts ---------- */
router.get('/payouts', (req, res) => {
  const history = db.prepare(`SELECT p.*, s.display_name AS seller, a.display_name AS admin_name FROM payouts p
                              JOIN users s ON s.id=p.seller_id JOIN users a ON a.id=p.admin_id ORDER BY p.created_at DESC LIMIT 200`).all();
  res.render('admin/payouts', { title: 'จ่ายเงินผู้ขาย', portal: 'admin', sellers: sellerRows().filter(s => s.stats.earned > 0 || s.stats.paid > 0), history });
});
router.post('/payouts', (req, res) => {
  const s = db.prepare("SELECT id,display_name FROM users WHERE id=? AND role='seller'").get(req.body.seller_id);
  const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
  const bal = s ? sellerStats(s.id).balance : 0;
  if (!s) flash(req, 'bad', 'ไม่พบผู้ขาย');
  else if (!(amount > 0)) flash(req, 'bad', 'ใส่ยอดที่โอน');
  else if (amount > bal + 0.005) flash(req, 'bad', `ยอดเกินที่ค้างจ่าย (${C.thb(bal)})`);
  else {
    db.prepare('INSERT INTO payouts(seller_id,amount,ref,note,admin_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(s.id, amount, str(req.body.ref, 80), str(req.body.note, 200), req.user.id, Date.now());
    flash(req, 'good', `บันทึกการโอน ${C.thb(amount)} ให้ ${s.display_name} แล้ว`);
  }
  res.redirect('/admin/payouts');
});

/* ---------- settings ---------- */
router.get('/settings', (req, res) => {
  const admins = db.prepare("SELECT display_name,email,last_login_at,created_at FROM users WHERE role='admin' ORDER BY created_at").all();
  res.render('admin/settings', { title: 'ตั้งค่า', portal: 'admin', admins, inviteOn: !!cfg.ADMIN_INVITE_CODE });
});
router.post('/settings', (req, res) => {
  const name = str(req.body.store_name, 60);
  if (!name) { flash(req, 'bad', 'ใส่ชื่อร้าน'); return res.redirect('/admin/settings'); }
  const n = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || 0));
  setSetting('store_name', name);
  setSetting('shipping', n(req.body.shipping, 0, 1000));
  setSetting('hm_fee_pct', n(req.body.hm_fee_pct, 0, 50));
  setSetting('cod_limit', n(req.body.cod_limit, 0, 1000000));
  setSetting('return_limit', n(req.body.return_limit, 0, 20));
  flash(req, 'good', 'บันทึกการตั้งค่าแล้ว');
  res.redirect('/admin/settings');
});

module.exports = router;
