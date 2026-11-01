// Serves uploaded files with access control. Print PDFs, slips, problem photos and seller application photos are never public.
const express = require('express');
const { db } = require('../db');
const { filePath } = require('../lib/upload');
const { coverSvg } = require('../lib/cover');

const router = express.Router();

const isOwnerOrAdmin = (req, sellerId) => req.user && (req.user.role === 'admin' || (req.user.role === 'seller' && req.user.id === sellerId));
// Buyers keep seeing pictures of what they ordered even after the product is unlisted (order history).
const boughtIt = (req, productId) => req.user?.role === 'buyer' &&
  !!db.prepare('SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=? AND o.buyer_id=? LIMIT 1').get(productId, req.user.id);
const canSee = (req, p) => p.status === 'approved' || isOwnerOrAdmin(req, p.seller_id) || boughtIt(req, p.id);
const send = (res, name, cache) => {
  const p = filePath(name);
  if (!p) return res.sendStatus(404);
  res.set('Cache-Control', cache);
  res.sendFile(p, err => err && !res.headersSent && res.sendStatus(404));
};

router.get('/files/cover/:id', (req, res) => {
  const p = db.prepare('SELECT id,kind,title,palette,status,seller_id,cover_file FROM products WHERE id=?').get(req.params.id);
  if (!p || !canSee(req, p)) return res.sendStatus(404);
  if (!p.cover_file) return res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(coverSvg(p));
  send(res, p.cover_file, p.status === 'approved' ? 'public, max-age=300' : 'private, no-store');
});

router.get('/files/preview/:id/:i', (req, res) => {
  const p = db.prepare('SELECT id,status,seller_id,preview_files FROM products WHERE id=?').get(req.params.id);
  if (!p || !canSee(req, p)) return res.sendStatus(404);
  send(res, JSON.parse(p.preview_files)[Number(req.params.i)], 'private, max-age=300');
});

router.get('/files/cover-pdf/:id', (req, res) => {
  const p = db.prepare("SELECT seller_id,cover_pdf FROM products WHERE id=? AND kind='kdp'").get(req.params.id);
  if (!p || !isOwnerOrAdmin(req, p.seller_id)) return res.sendStatus(404);
  res.set('Content-Disposition', 'inline; filename="cover.pdf"');
  send(res, p.cover_pdf, 'private, no-store');
});

router.get('/files/pdf/:id', (req, res) => {
  const p = db.prepare("SELECT seller_id,pdf_file,pdf_name FROM products WHERE id=? AND kind='kdp'").get(req.params.id);
  if (!p || !isOwnerOrAdmin(req, p.seller_id)) return res.sendStatus(404);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(p.pdf_name || 'interior.pdf')}`);
  send(res, p.pdf_file, 'private, no-store');
});

// Payment slip: admin, or the buyer who placed the order.
router.get('/files/slip/:orderId', (req, res) => {
  const o = db.prepare('SELECT buyer_id,slip_file FROM orders WHERE id=?').get(req.params.orderId);
  if (!o || !req.user || !(req.user.role === 'admin' || (req.user.role === 'buyer' && req.user.id === o.buyer_id))) return res.sendStatus(404);
  send(res, o.slip_file, 'private, no-store');
});

// Problem photos: admin, the buyer who reported, and the shop whose parcel it is.
router.get('/files/dispute/:id/:i', (req, res) => {
  const d = db.prepare('SELECT d.buyer_id,d.images,s.seller_id FROM disputes d JOIN shipments s ON s.id=d.shipment_id WHERE d.id=?').get(req.params.id);
  const u = req.user;
  if (!d || !u || !(u.role === 'admin' || (u.role === 'buyer' && u.id === d.buyer_id) || (u.role === 'seller' && u.id === d.seller_id))) return res.sendStatus(404);
  send(res, JSON.parse(d.images)[Number(req.params.i)], 'private, no-store');
});

router.get('/files/app/:id/:i', (req, res) => {
  const a = db.prepare('SELECT seller_id,images FROM seller_applications WHERE id=?').get(req.params.id);
  if (!a || !isOwnerOrAdmin(req, a.seller_id)) return res.sendStatus(404);
  send(res, JSON.parse(a.images)[Number(req.params.i)], 'private, no-store');
});

module.exports = router;
