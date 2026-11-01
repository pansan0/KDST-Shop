const bcrypt = require('bcryptjs');
const { db } = require('../db');

// URL prefix of each role's portal (buyers sign in under /account).
const PREFIX = { buyer: 'account', seller: 'seller', admin: 'admin' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Very small in-memory limiter: 10 failed attempts per IP+email in 15 minutes.
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
function tooManyAttempts(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) return false;
  return a.count >= 10;
}
function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { first: Date.now(), count: 1 });
  else a.count++;
}
const clearFailures = key => attempts.delete(key);

function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const u = db.prepare('SELECT id, role, email, display_name, phone, status FROM users WHERE id=?').get(req.session.userId);
    if (u && u.status === 'active') { req.user = u; res.locals.user = u; }
    else delete req.session.userId;
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user && req.user.role === role) return next();
    const nextUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(`/${PREFIX[role]}/login?next=${nextUrl}`);
  };
}

// Regenerate the session id on login to prevent fixation.
function startSession(req, user, cb) {
  req.session.regenerate(err => {
    if (err) return cb(err);
    req.session.userId = user.id;
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(Date.now(), user.id);
    req.session.save(cb);
  });
}

function validateRegistration({ email, password, confirm, display_name }) {
  const errors = [];
  if (!EMAIL_RE.test(email || '')) errors.push('อีเมลไม่ถูกต้อง');
  if (!password || password.length < 8) errors.push('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (password !== confirm) errors.push('ยืนยันรหัสผ่านไม่ตรงกัน');
  if (!display_name || display_name.trim().length < 2) errors.push('ใส่ชื่ออย่างน้อย 2 ตัวอักษร');
  if (email && db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) errors.push('อีเมลนี้มีบัญชีอยู่แล้ว');
  return errors;
}

const hashPassword = pw => bcrypt.hash(pw, 12);
const checkPassword = (pw, hash) => bcrypt.compare(pw || '', hash);

// Only allow redirects to a path on this site (never "//host" or a full URL), and only inside the role's own area.
const safeNext = (next, fallback, role) => {
  if (typeof next !== 'string' || !/^\/(?![\/\\])[\w\-/?=&%.]*$/.test(next)) return fallback;
  const top = next.split(/[/?]/)[1];
  const owner = { seller: 'seller', admin: 'admin' }[top] || 'buyer';
  return owner === role ? next : fallback;
};

module.exports = {
  PREFIX, loadUser, requireRole, startSession, validateRegistration, hashPassword, checkPassword,
  tooManyAttempts, recordFailure, clearFailures, safeNext,
};
