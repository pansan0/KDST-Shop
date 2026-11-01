const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const cfg = require('./config');
const { db, getSettings } = require('./db');
const C = require('./lib/catalog');
const O = require('./lib/options');
const { TH, format: addrText } = require('./lib/address');
const { loadUser } = require('./lib/auth');
const SqliteStore = require('./lib/session-store')(session);
const seed = require('./seed');
const { startJobs, jobsOnRequest } = require('./lib/jobs');
const { i18n, switchLang } = require('./lib/i18n');

seed();

// Cache-busting for /static: the URL carries the file's mtime, so an edited CSS/JS file is fetched fresh
// even though static files are cached for an hour.
const asset = name => { try { return Math.floor(fs.statSync(path.join(__dirname, 'public', name)).mtimeMs).toString(36); } catch { return '0'; } };

const app = express();
app.set('view engine', 'ejs');
app.locals.asset = asset; // on app.locals so even early error pages get it
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
if (cfg.COOKIE_SECURE) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(session({
  store: new SqliteStore(db),
  secret: cfg.SESSION_SECRET,
  name: 'inkfold.sid',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: cfg.COOKIE_SECURE, maxAge: 7 * 864e5 },
}));

app.use(loadUser);
app.use((req, res, next) => {
  res.locals.C = C;
  res.locals.O = O;
  res.locals.TH = TH;
  res.locals.addrText = addrText;
  res.locals.badges = req.user?.role === 'buyer'
    ? { cart: db.prepare('SELECT COALESCE(SUM(qty),0) n FROM cart_items WHERE buyer_id=?').get(req.user.id).n }
    : null;
  res.locals.pill = (t, c) => `<span class="pill ${c}">${String(t).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)}</span>`;
  res.locals.settings = getSettings();
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.q = req.query;
  next();
});

// Thai / English for customer pages (must run after the locals above so it can swap C for English dates).
app.use(i18n);
app.get('/lang/:code', switchLang);

// CSRF: one token per session. Multipart forms pass it in the query string
// (body is not parsed until multer runs), urlencoded forms pass it in the body.
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const t = String((req.body && req.body._csrf) || req.query._csrf || '');
    const ok = t.length === req.session.csrf.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(req.session.csrf));
    if (!ok) return res.status(403).render('error', { title: 'หมดเวลาฟอร์ม', message: 'ฟอร์มหมดอายุ กรุณากลับไปหน้าเดิมแล้วลองใหม่', portal: 'store' });
  }
  next();
});

app.use('/', require('./routes/files'));
// Handmade time rules (auto release / auto cancel) also run when these portals are opened.
app.use(['/admin', '/seller', '/account'], jobsOnRequest);
app.use('/account', require('./routes/account'));
app.use('/seller', require('./routes/seller'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/store'));

app.use((req, res) => res.status(404).render('error', { title: 'ไม่พบหน้านี้', message: 'ลิงก์อาจผิด หรือสินค้าถูกปิดการขายแล้ว', portal: 'store' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', portal: 'store' });
});

if (require.main === module) {
  startJobs();
  app.listen(cfg.PORT, () => {
    console.log(`Inkfold running at http://localhost:${cfg.PORT}`);
    console.log(`  หน้าร้าน   http://localhost:${cfg.PORT}/   (ผู้ซื้อเข้าสู่ระบบที่ /account/login)`);
    console.log(`  ผู้ขาย     http://localhost:${cfg.PORT}/seller`);
    console.log(`  แอดมิน    http://localhost:${cfg.PORT}/admin`);
  });
}
module.exports = app;
