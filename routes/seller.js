// Seller portal: list KDP books (we print & ship) or handmade items (seller makes & ships),
// apply for handmade, fulfil handmade shipments, see sales and payouts.
const express = require('express');
const { db, sellerStats, sellerMetrics, getSettings } = require('../db');
const C = require('../lib/catalog');
const O = require('../lib/options');
const ORD = require('../lib/orders');
const A = require('../lib/auth');
const mountAuth = require('../lib/auth-routes');
const { uploadFields, removeUploaded, removeFile } = require('../lib/upload');

const router = express.Router();
mountAuth(router, 'seller', { passwordBack: '/seller/account' });
router.use(A.requireRole('seller'));

const str = (v, n) => String(v || '').trim().slice(0, n);
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = (map, v, d) => (Object.prototype.hasOwnProperty.call(map, v) ? v : d);
const latestReview = db.prepare('SELECT decision,note,created_at FROM reviews WHERE product_id=? ORDER BY id DESC LIMIT 1');
const myProduct = req => db.prepare('SELECT * FROM products WHERE id=? AND seller_id=?').get(req.params.id, req.user.id);
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const me = req => db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
// multer hands back UTF-8 file names decoded as latin1.
const fixName = n => Buffer.from(n || '', 'latin1').toString('utf8').slice(0, 200);

router.use((req, res, next) => {
  res.locals.badges = { orders: db.prepare("SELECT COUNT(*) n FROM shipments WHERE seller_id=? AND fulfilled_by='seller' AND status IN ('preparing','placed','in_production','problem')").get(req.user.id).n };
  next();
});

router.get('/', (req, res) => {
  const products = db.prepare(`SELECT p.*, (SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN shipments s ON s.id=i.shipment_id
                                 WHERE i.product_id=p.id AND s.status IN ('delivered','released')) AS sold
                               FROM products p WHERE seller_id=? ORDER BY updated_at DESC`).all(req.user.id);
  for (const p of products) p.review = latestReview.get(p.id);
  const fee = Number(getSettings().hm_fee_pct) || 0;
  res.render('seller/dashboard', { title: 'สินค้าของฉัน', portal: 'seller', products, stats: sellerStats(req.user.id), metrics: sellerMetrics(req.user.id), seller: me(req), fee });
});

/* ---------- handmade application (vetting, like Amazon Handmade / Etsy) ---------- */
const appUpload = uploadFields([{ name: 'app_images', maxCount: 3 }], '/seller/handmade/apply');
router.get('/handmade/apply', (req, res) => {
  const app = db.prepare('SELECT * FROM seller_applications WHERE seller_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.render('seller/apply', { title: 'สมัครขายงาน Handmade', portal: 'seller', seller: me(req), app, form: {}, errors: null });
});
router.post('/handmade/apply', appUpload, (req, res) => {
  const seller = me(req);
  const imgs = (req.files || {}).app_images || [];
  const about = str(req.body.about, 2000);
  const errors = [];
  if (['applied', 'approved'].includes(seller.handmade_status)) errors.push('คุณส่งใบสมัครแล้ว');
  if (about.length < 50) errors.push('เล่าวิธีทำสินค้าอย่างน้อย 50 ตัวอักษร');
  if (imgs.length < 2) errors.push('แนบรูปขั้นตอนการทำอย่างน้อย 2 รูป');
  if (!req.body.declare) errors.push('ยืนยันว่าสินค้าทำหรือประกอบด้วยมือของคุณเอง');
  if (errors.length) {
    removeUploaded(req);
    return res.status(400).render('seller/apply', { title: 'สมัครขายงาน Handmade', portal: 'seller', seller, app: null, form: req.body, errors });
  }
  db.transaction(() => {
    db.prepare('INSERT INTO seller_applications(seller_id,about,images,created_at) VALUES (?,?,?,?)').run(seller.id, about, JSON.stringify(imgs.map(f => f.filename)), Date.now());
    db.prepare("UPDATE users SET handmade_status='applied' WHERE id=?").run(seller.id);
  })();
  flash(req, 'good', 'ส่งใบสมัครแล้ว แอดมินจะพิจารณาและแจ้งผลในหน้านี้');
  res.redirect('/seller');
});

/* ---------- products ---------- */
const DEFAULTS = {
  kdp: { kind: 'kdp', category: 'coloring', age: '6-9', trim: '8.5x11', pages: 48, interior: 'bw', paper: 'white', finish: 'matte', price: 199 },
  handmade: { kind: 'handmade', category: 'jewelry', price: 159, made_by: 'solo', method: 'handmade', lead_days: 3, weekly_capacity: 20, stock: null },
};

function readForm(body, kind) {
  const f = { kind, title: str(body.title, 120), subtitle: str(body.subtitle, 160), description: str(body.description, 3000), price: int(body.price, 0, 100000, 0), keywords: str(body.keywords, 300) };
  if (kind === 'kdp') {
    return Object.assign(f, {
      category: pick(C.CATS, body.category, 'coloring'), age: pick(C.AGES, body.age, '6-9'), trim: pick(C.TRIMS, body.trim, '8.5x11'),
      pages: parseInt(body.pages, 10) || 0, interior: pick(C.INTERIOR, body.interior, 'bw'), paper: pick(C.PAPER, body.paper, 'white'),
      finish: pick(C.FINISH, body.finish, 'matte'), ai: body.ai ? 1 : 0,
    });
  }
  const { options, errors } = O.parseSellerOptions(body);
  return Object.assign(f, {
    category: pick(C.HM_CATS, body.category, 'jewelry'), age: 'all', materials: str(body.materials, 300),
    made_by: pick(C.MADE_BY, body.made_by, 'solo'), method: pick(C.METHOD, body.method, 'handmade'),
    lead_days: int(body.lead_days, 1, 60, 3), weekly_capacity: int(body.weekly_capacity, 1, 500, 20),
    // Empty = made to order (no stock count). Shipping is set per shop on the account page.
    stock: String(body.stock ?? '').trim() === '' ? null : int(body.stock, 0, 100000, 0),
    metal: body.metal ? 1 : 0, for_kids: body.for_kids ? 1 : 0, small_parts: body.small_parts ? 1 : 0,
    options: JSON.stringify(options), _optErrors: errors,
  });
}

function validate(f, submit, { hasCover, hasImage, coverIsPdf, hasPdf, previewCount, body }) {
  const e = [...(f._optErrors || [])];
  if (coverIsPdf && f.kind !== 'kdp') e.push('รูปหลักของสินค้า handmade ต้องเป็น JPG/PNG');
  if (!f.title) e.push('ใส่ชื่อสินค้า');
  if (f.price < 1) e.push('ใส่ราคาขายเป็นจำนวนเต็มบาท');
  if (f.kind === 'kdp') {
    if (f.pages < C.MIN_PAGES || f.pages > C.MAX_PAGES || f.pages % 2) e.push(`จำนวนหน้าต้องเป็นเลขคู่ ระหว่าง ${C.MIN_PAGES}–${C.MAX_PAGES} หน้า`);
    if (previewCount > 4) e.push('ภาพตัวอย่างหน้าในได้สูงสุด 4 ภาพ');
  }
  if (!submit) return e;
  if (f.description.length < 20) e.push('เขียนคำอธิบายอย่างน้อย 20 ตัวอักษร');
  if (!hasCover) e.push(f.kind === 'kdp' ? 'แนบไฟล์ปก' : 'แนบรูปหลักของสินค้า');
  // A PDF cover is for the printer; the storefront needs an image to show.
  else if (!hasImage) e.push('ปกเป็น PDF: แนบภาพปกสำหรับหน้าร้าน (JPG/PNG) ด้วย');
  if (!body.rights) e.push('ยืนยันว่าคุณมีสิทธิ์ในเนื้อหาและรูปทั้งหมด');
  if (f.kind === 'kdp') {
    if (f.price < C.minPrice(f)) e.push(`สเปกนี้ตั้งราคาได้ต่ำสุด ${C.thb(C.minPrice(f))}`);
    if (!hasPdf) e.push('แนบไฟล์เนื้อใน PDF');
  } else {
    if (!f.materials) e.push('ระบุวัสดุที่ใช้');
    if (f.lead_days > C.MAX_LEAD_DAYS) e.push(`ระยะเวลาเตรียมสินค้าต้องอยู่ระหว่าง 1–${C.MAX_LEAD_DAYS} วัน`);
    if (!body.declare_handmade) e.push('ยืนยันว่าสินค้านี้ทำหรือประกอบด้วยมือของคุณเอง');
    if (f.metal && !body.declare_metal) e.push('ยืนยันว่าชิ้นส่วนโลหะผ่านเกณฑ์นิกเกิล ตะกั่ว และแคดเมียม');
    if ((f.for_kids || f.small_parts) && !body.declare_kids) e.push('ยืนยันเรื่องความปลอดภัยสำหรับเด็ก');
  }
  return e;
}

const productUpload = uploadFields(
  [{ name: 'cover', maxCount: 1 }, { name: 'cover_image', maxCount: 1 }, { name: 'pdf', maxCount: 1 }, { name: 'previews', maxCount: 7 }],
  req => (req.params.id ? `/seller/products/${req.params.id}/edit` : `/seller/products/new?kind=${req.query.kind === 'handmade' ? 'handmade' : 'kdp'}`),
);

function renderForm(res, { product, form, errors, status = 200 }) {
  const kind = form.kind;
  const view = kind === 'kdp' ? 'seller/product-kdp' : 'seller/product-handmade';
  const label = kind === 'kdp' ? 'หนังสือ' : 'สินค้า handmade';
  res.status(status).render(view, {
    title: product ? `แก้ไข: ${product.title}` : `ลงขาย${label}ใหม่`, portal: 'seller', product, form, errors,
    review: product ? latestReview.get(product.id) : null, fee: Number(getSettings().hm_fee_pct) || 0,
  });
}
const canHandmade = req => me(req).handmade_status === 'approved';

router.get('/products/new', (req, res) => {
  const kind = req.query.kind === 'handmade' ? 'handmade' : 'kdp';
  if (kind === 'handmade' && !canHandmade(req)) return res.redirect('/seller/handmade/apply');
  renderForm(res, { product: null, form: DEFAULTS[kind], errors: null });
});
router.post('/products', productUpload, (req, res) => {
  const kind = req.query.kind === 'handmade' ? 'handmade' : 'kdp';
  if (kind === 'handmade' && !canHandmade(req)) { removeUploaded(req); return res.redirect('/seller/handmade/apply'); }
  saveProduct(req, res, null, kind);
});

router.get('/products/:id/edit', (req, res, next) => {
  const p = myProduct(req);
  if (!p) return next();
  if (p.status === 'suspended') { flash(req, 'bad', 'สินค้านี้ถูกระงับโดยแอดมิน แก้ไขไม่ได้'); return res.redirect('/seller'); }
  renderForm(res, { product: p, form: { ...p, ...O.toFormFields(O.parse(p.options)) }, errors: null });
});
router.post('/products/:id', productUpload, (req, res, next) => {
  const p = myProduct(req);
  if (!p) { removeUploaded(req); return next(); }
  if (p.status === 'suspended') { removeUploaded(req); flash(req, 'bad', 'สินค้านี้ถูกระงับโดยแอดมิน แก้ไขไม่ได้'); return res.redirect('/seller'); }
  saveProduct(req, res, p, p.kind);
});

function saveProduct(req, res, old, kind) {
  // Only never-submitted products can be saved as drafts; anything already in the review loop is re-submitted.
  const submit = req.body.action === 'submit' || (old && old.status !== 'draft');
  const f = readForm(req.body, kind);
  const files = req.files || {};
  const cover = files.cover?.[0], pdf = kind === 'kdp' ? files.pdf?.[0] : null, previews = files.previews || [];
  if (kind !== 'kdp' && files.pdf) removeFile(files.pdf[0].filename);
  // KDP cover may be a PDF (print file) with a separate JPG/PNG for the storefront; an image cover serves both.
  const coverIsPdf = cover?.mimetype === 'application/pdf';
  const coverPdf = coverIsPdf ? cover : null;
  const coverImg = coverIsPdf ? files.cover_image?.[0] : cover || files.cover_image?.[0];
  if (cover && !coverIsPdf && files.cover_image) removeFile(files.cover_image[0].filename);
  const errors = validate(f, submit, {
    hasCover: !!(cover || old?.cover_file || old?.cover_pdf), hasImage: !!(coverImg || old?.cover_file), coverIsPdf,
    hasPdf: !!(pdf || old?.pdf_file), previewCount: previews.length, body: req.body,
  });
  if (errors.length) {
    removeUploaded(req);
    const keep = Object.fromEntries(Object.entries(req.body).filter(([k]) => k.startsWith('opt_') || k.startsWith('declare') || k === 'rights'));
    return renderForm(res, { product: old, form: { ...f, ...keep }, errors: [...errors, ...(Object.keys(files).length ? ['ไฟล์ที่เลือกไว้ต้องแนบใหม่อีกครั้ง'] : [])], status: 400 });
  }
  delete f._optErrors;

  const now = Date.now();
  const data = { ...f, updated_at: now };
  if (coverImg) { data.cover_file = coverImg.filename; if (old) removeFile(old.cover_file); }
  if (coverPdf) { data.cover_pdf = coverPdf.filename; if (old) removeFile(old.cover_pdf); }
  // An image uploaded as the cover itself replaces an earlier PDF cover.
  else if (cover && old?.cover_pdf) { data.cover_pdf = null; removeFile(old.cover_pdf); }
  if (pdf) { data.pdf_file = pdf.filename; data.pdf_name = fixName(pdf.originalname); data.pdf_size = pdf.size; if (old) removeFile(old.pdf_file); }
  if (previews.length) { data.preview_files = JSON.stringify(previews.map(p => p.filename)); if (old) JSON.parse(old.preview_files).forEach(removeFile); }
  if (submit) Object.assign(data, { status: 'pending', rev: (old?.rev || 0) + 1, submitted_at: now });

  if (old) {
    const cols = Object.keys(data);
    db.prepare(`UPDATE products SET ${cols.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...data, id: old.id });
  } else {
    Object.assign(data, { seller_id: req.user.id, created_at: now, palette: Math.floor(Math.random() * 6) });
    if (!submit) Object.assign(data, { status: 'draft', rev: 0 });
    const keys = Object.keys(data);
    db.prepare(`INSERT INTO products(${keys.join(',')}) VALUES (${keys.map(c => '@' + c).join(',')})`).run(data);
  }
  flash(req, 'good', submit ? 'ส่งให้แอดมินตรวจแล้ว ผลการตรวจจะแสดงในหน้านี้' : 'บันทึกร่างแล้ว');
  res.redirect('/seller');
}

router.post('/products/:id/archive', (req, res, next) => {
  const p = myProduct(req); if (!p) return next();
  if (p.status === 'approved') { db.prepare("UPDATE products SET status='archived', updated_at=? WHERE id=?").run(Date.now(), p.id); flash(req, 'good', 'ปิดการขายแล้ว'); }
  res.redirect('/seller');
});
router.post('/products/:id/unarchive', (req, res, next) => {
  const p = myProduct(req); if (!p) return next();
  if (p.status === 'archived') { db.prepare("UPDATE products SET status='approved', updated_at=? WHERE id=?").run(Date.now(), p.id); flash(req, 'good', 'เปิดขายอีกครั้งแล้ว'); }
  res.redirect('/seller');
});
router.post('/products/:id/delete', (req, res, next) => {
  const p = myProduct(req); if (!p) return next();
  if (p.status !== 'draft') { flash(req, 'bad', 'ลบได้เฉพาะร่างที่ยังไม่เคยส่งตรวจ'); return res.redirect('/seller'); }
  db.prepare('DELETE FROM products WHERE id=?').run(p.id);
  [p.cover_file, p.cover_pdf, p.pdf_file, ...JSON.parse(p.preview_files)].forEach(removeFile);
  flash(req, 'good', 'ลบร่างแล้ว');
  res.redirect('/seller');
});

/* ---------- handmade orders to ship ---------- */
// PDPA: the buyer's name/phone/address is shown only for the shop's own parcels, once paid, while it is being handled,
// and for 30 days after the buyer has it.
const PAID_OR_COD = ['preparing', 'shipped', 'problem', 'placed', 'in_production'];
const showBuyer = s => PAID_OR_COD.includes(s.status) || (['delivered', 'released'].includes(s.status) && Date.now() - (s.delivered_at || s.released_at) < 30 * C.DAY);
const SHIP_TABS = {
  todo: ['ต้องจัดส่ง', "s.status IN ('preparing','placed','in_production')"],
  unpaid: ['รอลูกค้าชำระ', "s.status='awaiting_payment'"],
  shipped: ['จัดส่งแล้ว', "s.status='shipped'"],
  problem: ['มีปัญหา', "s.status='problem'"],
  done: ['เสร็จสิ้น', "s.status IN ('delivered','released','refunded','cancelled','returned')"],
  all: ['ทั้งหมด', '1=1'],
};
const SHIP_ROWS = `SELECT s.*, o.code, o.method, o.ship_name, o.ship_phone, o.ship_address FROM shipments s JOIN orders o ON o.id=s.order_id
                   WHERE s.seller_id=? AND s.fulfilled_by='seller'`;
function withItems(s) {
  s.flow = C.shipFlow(s);
  s.items = db.prepare('SELECT * FROM order_items WHERE shipment_id=? ORDER BY id').all(s.id).map(i => ({ ...i, lines: JSON.parse(i.options) }));
  s.disputes = db.prepare('SELECT * FROM disputes WHERE shipment_id=? ORDER BY id').all(s.id).map(d => ({ ...d, imgs: JSON.parse(d.images) }));
  s.showBuyer = showBuyer(s);
  return s;
}

router.get('/orders', (req, res) => {
  const tab = SHIP_TABS[req.query.tab] ? req.query.tab : 'todo';
  const ships = db.prepare(`${SHIP_ROWS} AND ${SHIP_TABS[tab][1]} ORDER BY s.due_at ASC LIMIT 200`).all(req.user.id).map(withItems);
  const counts = Object.fromEntries(Object.entries(SHIP_TABS).map(([k, [, w]]) => [k, db.prepare(`SELECT COUNT(*) n FROM (${SHIP_ROWS} AND ${w})`).get(req.user.id).n]));
  res.render('seller/orders', { title: 'ออเดอร์ที่ต้องจัดส่ง', portal: 'seller', ships, tab, tabs: SHIP_TABS, counts, metrics: sellerMetrics(req.user.id) });
});

// Printable shipping label (opens in a new tab; print from the browser).
router.get('/shipments/:id/label', (req, res, next) => {
  const s = db.prepare(`${SHIP_ROWS} AND s.id=?`).get(req.user.id, req.params.id);
  if (!s) return next();
  withItems(s);
  if (!PAID_OR_COD.includes(s.status)) { flash(req, 'bad', 'พิมพ์ใบปะหน้าได้เมื่อลูกค้าชำระเงินแล้ว และพัสดุยังไม่ปิดงาน'); return res.redirect('/seller/orders'); }
  const shop = db.prepare('SELECT display_name, phone, ship_from FROM users WHERE id=?').get(req.user.id);
  res.render('seller/label', { s, shop });
});

router.post('/shipments/:id/:move', (req, res) => {
  const move = req.params.move;
  const tab = typeof req.body.tab === 'string' && SHIP_TABS[req.body.tab] ? req.body.tab : 'todo';
  if (!['start', 'ship', 'cancel'].includes(move)) return res.redirect(`/seller/orders?tab=${tab}`);
  // Carrier: one of the listed companies, or the seller types another name.
  const key = C.CARRIERS[req.body.carrier] ? req.body.carrier : '';
  const carrier = key === 'other' ? str(req.body.carrier_other, 40) : key ? C.CARRIERS[key] : '';
  const out = ORD.moveShipment('seller', req.user.id, Number(req.params.id), move, { tracking: str(req.body.tracking, 60), carrier, note: str(req.body.note, 300) });
  flash(req, out.error ? 'bad' : 'good', out.error || {
    start: 'รับงานแล้ว เริ่มทำได้เลย', ship: 'บันทึกการจัดส่งแล้ว ลูกค้าเห็นเลขพัสดุแล้ว',
    cancel: out.shipment?.method === 'transfer' ? 'ยกเลิกพัสดุแล้ว ระบบตั้งรายการคืนเงินให้ลูกค้า' : 'ยกเลิกพัสดุแล้ว ผู้ซื้อจะเห็นเหตุผล',
  }[move]);
  res.redirect(`/seller/orders?tab=${!out.error && move === 'ship' ? 'shipped' : tab}`);
});

/* ---------- sales & account ---------- */
router.get('/sales', (req, res) => {
  const items = db.prepare(`SELECT i.*, o.code, o.method, s.status, s.fulfilled_by, s.created_at FROM order_items i
                            JOIN shipments s ON s.id=i.shipment_id JOIN orders o ON o.id=i.order_id
                            WHERE i.seller_id=? ORDER BY s.created_at DESC LIMIT 300`).all(req.user.id);
  const payouts = db.prepare('SELECT amount,ref,note,created_at FROM payouts WHERE seller_id=? ORDER BY created_at DESC').all(req.user.id);
  res.render('seller/sales', { title: 'ยอดขายและการรับเงิน', portal: 'seller', items, payouts, stats: sellerStats(req.user.id), fee: Number(getSettings().hm_fee_pct) || 0 });
});

router.get('/account', (req, res) => {
  const m = db.prepare(`SELECT email,display_name,phone,payout_account,payout_name,payout_bank,handmade_status,
                               ship_first,ship_next,ship_free_over,ship_from,created_at FROM users WHERE id=?`).get(req.user.id);
  res.render('seller/account', { title: 'บัญชีของฉัน', portal: 'seller', me: m });
});
router.post('/account/profile', (req, res) => {
  const name = str(req.body.display_name, 60);
  if (name.length < 2) flash(req, 'bad', 'ชื่อร้านต้องมีอย่างน้อย 2 ตัวอักษร');
  else {
    db.prepare('UPDATE users SET display_name=?, phone=? WHERE id=?').run(name, str(req.body.phone, 20).replace(/[^\d+]/g, ''), req.user.id);
    flash(req, 'good', 'บันทึกข้อมูลร้านแล้ว');
  }
  res.redirect('/seller/account');
});
// Shop shipping (handmade): first piece, each extra piece, optional free-shipping threshold, sender address for labels.
router.post('/account/shipping', (req, res) => {
  const first = int(req.body.ship_first, 0, 1000, 40), next = int(req.body.ship_next, 0, 1000, 0);
  const free = String(req.body.ship_free_over ?? '').trim() === '' ? null : int(req.body.ship_free_over, 1, 1000000, 0);
  db.prepare('UPDATE users SET ship_first=?, ship_next=?, ship_free_over=?, ship_from=? WHERE id=?').run(first, next, free, str(req.body.ship_from, 300), req.user.id);
  flash(req, 'good', 'บันทึกค่าส่งของร้านแล้ว');
  res.redirect('/seller/account#shipping');
});
router.post('/account/payout', (req, res) => {
  db.prepare('UPDATE users SET payout_account=?, payout_name=?, payout_bank=? WHERE id=?')
    .run(str(req.body.payout_account, 40), str(req.body.payout_name, 100), str(req.body.payout_bank, 60), req.user.id);
  flash(req, 'good', 'บันทึกบัญชีรับเงินแล้ว');
  res.redirect('/seller/account');
});

module.exports = router;
