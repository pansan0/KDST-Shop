// Login / register / logout / change-password routes, mounted once per portal (buyer at /account, seller, admin).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cfg = require('../config');
const { db } = require('../db');
const A = require('./auth');

const LABEL = { buyer: '', seller: 'ผู้ขาย', admin: 'แอดมิน' };
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const str = (v, n) => String(v || '').trim().slice(0, n);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = function mountAuth(router, role, { passwordBack }) {
  const base = `/${A.PREFIX[role]}`;
  const home = role === 'buyer' ? '/' : base;
  const page = (view, extra) => ({ title: `${view === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}${LABEL[role]}`, portal: role === 'buyer' ? 'store' : role, role, base, bare: true, form: {}, errors: null, ...extra });
  const adminSignupOpen = () => role !== 'admin' || !!cfg.ADMIN_INVITE_CODE;

  router.get('/login', (req, res) => {
    if (req.user?.role === role) return res.redirect(home);
    res.render('auth/login', page('login', { next: String(req.query.next || '') }));
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = str(req.body.email, 200).toLowerCase();
      const key = `${req.ip}|${email}`;
      const fail = msg => res.status(400).render('auth/login', page('login', { errors: [msg], form: { email }, next: req.body.next }));
      if (A.tooManyAttempts(key)) return fail('ลองผิดหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่');
      const u = db.prepare('SELECT * FROM users WHERE email=? AND role=?').get(email, role);
      const ok = await A.checkPassword(req.body.password, u ? u.password_hash : DUMMY_HASH);
      if (!u || !ok) { A.recordFailure(key); return fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง'); }
      if (u.status !== 'active') return fail('บัญชีนี้ถูกระงับ ติดต่อผู้ดูแลระบบ');
      A.clearFailures(key);
      A.startSession(req, u, err => (err ? next(err) : res.redirect(A.safeNext(req.body.next, home, role))));
    } catch (e) { next(e); }
  });

  router.get('/register', (req, res) => {
    if (req.user?.role === role) return res.redirect(home);
    res.render('auth/register', page('register', { open: adminSignupOpen(), next: String(req.query.next || '') }));
  });

  router.post('/register', async (req, res, next) => {
    try {
      const f = {
        email: str(req.body.email, 200).toLowerCase(), display_name: str(req.body.display_name, 60),
        phone: str(req.body.phone, 20).replace(/[^\d+]/g, ''), password: String(req.body.password || ''), confirm: String(req.body.confirm || ''),
      };
      const errors = [];
      const regKey = `reg|${req.ip}`;
      if (A.tooManyAttempts(regKey)) errors.push('สมัครถี่เกินไป รอสักครู่แล้วลองใหม่');
      if (role === 'admin') {
        if (!cfg.ADMIN_INVITE_CODE) errors.push('ระบบปิดรับสมัครแอดมิน ให้แอดมินที่มีอยู่ตั้ง ADMIN_INVITE_CODE ก่อน');
        else if (!safeEq(req.body.invite, cfg.ADMIN_INVITE_CODE)) { errors.push('รหัสเชิญแอดมินไม่ถูกต้อง'); A.recordFailure(regKey); }
      }
      errors.push(...A.validateRegistration(f));
      if (role === 'seller' && !req.body.accept) errors.push('ยอมรับเงื่อนไขผู้ขายก่อนสมัคร');
      if (role === 'buyer' && f.phone.replace(/\D/g, '').length < 9) errors.push('ใส่เบอร์โทรที่ติดต่อได้ (ใช้ยืนยันตอนส่งของเก็บเงินปลายทาง)');
      if (errors.length) {
        return res.status(400).render('auth/register', page('register', { open: adminSignupOpen(), next: req.body.next, errors, form: { email: f.email, display_name: f.display_name, phone: f.phone } }));
      }
      const hash = await A.hashPassword(f.password);
      const id = db.prepare('INSERT INTO users(role,email,password_hash,display_name,phone,created_at) VALUES (?,?,?,?,?,?)')
        .run(role, f.email, hash, f.display_name, f.phone, Date.now()).lastInsertRowid;
      A.recordFailure(regKey); // counts toward the per-IP signup limit
      A.startSession(req, { id }, err => {
        if (err) return next(err);
        req.session.flash = { type: 'good', msg: { buyer: 'สมัครสำเร็จ เลือกสินค้าใส่ตะกร้าได้เลย', seller: 'สมัครสำเร็จ เริ่มลงขายสินค้าชิ้นแรกได้เลย', admin: 'สร้างบัญชีแอดมินแล้ว' }[role] };
        res.redirect(A.safeNext(req.body.next, home, role));
      });
    } catch (e) { next(e); }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => { res.clearCookie('inkfold.sid'); res.redirect(role === 'buyer' ? '/' : `${base}/login`); });
  });

  router.post('/password', A.requireRole(role), async (req, res, next) => {
    try {
      const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
      const pw = String(req.body.new_password || '');
      let msg = null;
      if (!(await A.checkPassword(req.body.current_password, u.password_hash))) msg = 'รหัสผ่านปัจจุบันไม่ถูกต้อง';
      else if (pw.length < 8) msg = 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร';
      else if (pw !== req.body.confirm) msg = 'ยืนยันรหัสผ่านใหม่ไม่ตรงกัน';
      if (msg) req.session.flash = { type: 'bad', msg };
      else {
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await A.hashPassword(pw), req.user.id);
        // Sign out this account's other sessions.
        db.prepare("DELETE FROM sessions WHERE sid<>? AND json_extract(sess,'$.userId')=?").run(req.sessionID, req.user.id);
        req.session.flash = { type: 'good', msg: 'เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นจะต้องเข้าสู่ระบบใหม่' };
      }
      res.redirect(passwordBack);
    } catch (e) { next(e); }
  });
};
