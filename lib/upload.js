const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const cfg = require('../config');

const UPLOAD_DIR = path.join(cfg.DATA_DIR, 'uploads');
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const RULES = {
  cover: ['image/jpeg', 'image/png', 'application/pdf'],
  cover_image: ['image/jpeg', 'image/png'],
  previews: ['image/jpeg', 'image/png', 'image/webp'],
  pdf: ['application/pdf'],
  app_images: ['image/jpeg', 'image/png', 'image/webp'],
  slip: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  payout_slip: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  problem_images: ['image/jpeg', 'image/png', 'image/webp'],
};

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '')),
});

function fileFilter(req, file, cb) {
  const ok = (RULES[file.fieldname] || []).includes(file.mimetype);
  if (!ok) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  cb(null, true);
}

// Wraps multer so errors become a flash message instead of a crash.
function uploadFields(fields, backTo) {
  const mw = multer({ storage, fileFilter, limits: { fileSize: cfg.MAX_PDF_MB * 1024 * 1024, files: 10 } }).fields(fields);
  return (req, res, next) => mw(req, res, err => {
    if (!err) {
      // Images have a tighter limit than the print PDF.
      const big = Object.values(req.files || {}).flat()
        .find(f => f.mimetype.startsWith('image/') && f.size > cfg.MAX_IMAGE_MB * 1024 * 1024);
      if (!big) return next();
      removeUploaded(req);
      err = { code: 'IMAGE_TOO_BIG' };
    }
    removeUploaded(req);
    const msg = {
      LIMIT_FILE_SIZE: `ไฟล์ใหญ่เกิน ${cfg.MAX_PDF_MB} MB`,
      IMAGE_TOO_BIG: `ไฟล์ภาพต้องไม่เกิน ${cfg.MAX_IMAGE_MB} MB`,
      LIMIT_UNEXPECTED_FILE: 'ชนิดไฟล์ไม่ถูกต้องหรือจำนวนไฟล์เกิน: ปกใช้ JPG/PNG/PDF, สลิปใช้รูปหรือ PDF, รูปอื่นใช้ JPG/PNG/WebP, เนื้อในหนังสือใช้ PDF',
    }[err.code] || 'อัปโหลดไฟล์ไม่สำเร็จ';
    req.session.flash = { type: 'bad', msg };
    res.redirect(typeof backTo === 'function' ? backTo(req) : backTo);
  });
}

function removeUploaded(req) {
  for (const f of Object.values(req.files || {}).flat()) fs.rm(f.path, { force: true }, () => {});
}
function removeFile(name) {
  if (name && /^[a-f0-9]{32}\.\w+$/.test(name)) fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}
const filePath = name => (name && /^[a-f0-9]{32}\.\w+$/.test(name) ? path.join(UPLOAD_DIR, name) : null);

module.exports = { uploadFields, removeUploaded, removeFile, filePath };
