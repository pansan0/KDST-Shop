// usage: BASE=... DATA_DIR=... node book-receive.mjs  (run from the project root)
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/');
const { db, sellerStats } = require('./db');
const B = process.env.BASE; let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function client() { const jar = new Map(); const c = async (p, { method = 'GET', form } = {}) => {
  const r = await fetch(B + p, { method, redirect: 'manual', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
  for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return { status: r.status, loc: r.headers.get('location'), text: await r.text() }; };
  c.login = async (area, email, pw) => { const t = (await c(`/${area}/login`)).text.match(/name="_csrf" value="([^"]+)"/)[1]; await c(`/${area}/login`, { method: 'POST', form: { _csrf: t, email, password: pw } }); };
  return c; }
const ship = code => db.prepare("SELECT s.* FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.code=? AND s.fulfilled_by='platform'").get(code);
const bu = client(); await bu.login('account', 'demo@buyer.local', 'buyer12345');
const ad = client(); await ad.login('admin', 'admin@inkfold.local', 'admin12345');
const at = (await ad('/admin/orders')).text.match(/name="_csrf" value="([^"]+)"/)[1];
// IF-DEMO03: transfer order with a book parcel. Confirm slip, print, ship it.
const o3 = db.prepare("SELECT id FROM orders WHERE code='IF-DEMO03'").get();
await ad(`/admin/orders/${o3.id}/confirm-payment`, { method: 'POST', form: { _csrf: at } });
let s = ship('IF-DEMO03');
let r = await bu('/account/orders/IF-DEMO03');
ok(!r.text.includes(`/account/shipments/${s.id}/receive`), 'no receive button before the book ships');
await ad(`/admin/shipments/${s.id}/start`, { method: 'POST', form: { _csrf: at } });
await ad(`/admin/shipments/${s.id}/ship`, { method: 'POST', form: { _csrf: at, carrier: 'thaipost', tracking: 'EB000111TH' } });
ok(ship('IF-DEMO03').status === 'shipped', 'prepaid book shipped');
r = await bu('/account/orders/IF-DEMO03');
const part = r.text.slice(r.text.indexOf('EB000111TH'));
ok(r.text.includes(`/account/shipments/${s.id}/receive`), 'buyer sees "received" on the prepaid book');
ok(!r.text.includes(`/account/shipments/${s.id}/problem`), 'no handmade problem link on book parcel');
const bt = r.text.match(/name="_csrf" value="([^"]+)"/)[1];
const seller = db.prepare("SELECT i.seller_id FROM order_items i WHERE i.shipment_id=?").get(s.id).seller_id;
const before = sellerStats(seller).earned;
r = await bu(`/account/shipments/${s.id}/receive`, { method: 'POST', form: { _csrf: bt } });
s = ship('IF-DEMO03');
ok(s.status === 'delivered' && s.delivered_at && !s.released_at, 'book marked delivered (not "released")');
ok(sellerStats(seller).earned > before, 'author royalty becomes withdrawable');
r = await bu('/account/orders/IF-DEMO03');
ok(r.text.includes('ขอบคุณที่ยืนยันว่าได้รับหนังสือแล้ว'), 'buyer gets a book-specific thank-you');
r = await bu(`/account/shipments/${s.id}/receive`, { method: 'POST', form: { _csrf: bt } });
ok(ship('IF-DEMO03').status === 'delivered', 'second click does nothing harmful');
// COD book: buyer cannot confirm
const cod = db.prepare("SELECT s.id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.method='cod' AND s.fulfilled_by='platform' AND o.buyer_id=(SELECT id FROM users WHERE email='demo@buyer.local') LIMIT 1").get();
db.prepare("UPDATE shipments SET status='shipped', tracking='CODX', carrier='Flash Express', shipped_at=? WHERE id=?").run(Date.now(), cod.id);
r = await bu(`/account/orders/${db.prepare('SELECT o.code FROM orders o JOIN shipments s ON s.order_id=o.id WHERE s.id=?').get(cod.id).code}`);
ok(!r.text.includes(`/account/shipments/${cod.id}/receive`), 'no receive button on a COD book');
await bu(`/account/shipments/${cod.id}/receive`, { method: 'POST', form: { _csrf: bt } });
ok(db.prepare('SELECT status FROM shipments WHERE id=?').get(cod.id).status === 'shipped', 'COD book: forged POST refused');
// another buyer cannot confirm someone else's
const other = client();
const ot = (await other('/account/register')).text.match(/name="_csrf" value="([^"]+)"/)[1];
await other('/account/register', { method: 'POST', form: { _csrf: ot, display_name: 'ผู้ทดสอบ', email: 'x9@test.local', phone: '0811111111', password: 'abcdefgh', confirm: 'abcdefgh' } });
const ot2 = (await other('/account')).text.match(/name="_csrf" value="([^"]+)"/)[1];
db.prepare("UPDATE shipments SET status='shipped' WHERE id=?").run(s.id);
await other(`/account/shipments/${s.id}/receive`, { method: 'POST', form: { _csrf: ot2 } });
ok(ship('IF-DEMO03').status === 'shipped', "another buyer cannot confirm someone else's parcel");
// admin can still mark delivered
await ad(`/admin/shipments/${s.id}/deliver`, { method: 'POST', form: { _csrf: at } });
ok(ship('IF-DEMO03').status === 'delivered', 'admin can still confirm delivery');
// Prepaid book nobody confirmed: counts as received after release_days.
const { runJobs } = require('./lib/jobs');
const DAY = 864e5;
db.prepare("UPDATE shipments SET status='shipped', delivered_at=NULL, shipped_at=? WHERE id=?").run(Date.now() - 8 * DAY, s.id);
let out = runJobs();
s = ship('IF-DEMO03');
ok(out.delivered >= 1 && s.status === 'delivered' && /ยืนยันได้รับอัตโนมัติ/.test(s.auto_note || ''), 'prepaid book auto-confirmed after release_days');
db.prepare("UPDATE shipments SET status='shipped', delivered_at=NULL, auto_note=NULL, shipped_at=? WHERE id=?").run(Date.now() - 2 * DAY, s.id);
runJobs();
ok(ship('IF-DEMO03').status === 'shipped', 'not auto-confirmed before release_days');
db.prepare("UPDATE shipments SET shipped_at=? WHERE id=?").run(Date.now() - 30 * DAY, cod.id);
runJobs();
ok(db.prepare('SELECT status FROM shipments WHERE id=?').get(cod.id).status === 'shipped', 'COD book never auto-confirmed (admin waits for the cash)');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
