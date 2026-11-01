// End-to-end test for "sellers ship handmade themselves" against a FRESH seeded server.
// Run through npm test (test/run.js gives it BASE and DATA_DIR and runs it from the project root).
import { execFileSync } from 'node:child_process';
const B = process.env.BASE || 'http://localhost:3100';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const DAY = 864e5;

function client() {
  const jar = new Map();
  const c = async (path, { method = 'GET', form, multipart } = {}) => {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    if (multipart) { body = new FormData(); for (const [k, v] of Object.entries(multipart)) Array.isArray(v) ? body.append(k, v[0], v[1]) : body.append(k, v); }
    const r = await fetch(B + path, { method, headers, body, redirect: 'manual' });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: r.status, loc: r.headers.get('location'), text: await r.text() };
  };
  c.csrf = async (p = '/') => (await c(p)).text.match(/name="_csrf" value="([^"]+)"/)?.[1] || (await c(p)).text.match(/_csrf=([0-9a-f]+)/)?.[1];
  c.login = async (base, email, password) => {
    const t = await c.csrf(`${base}/login`);
    await c(`${base}/login`, { method: 'POST', form: { _csrf: t, email, password } });
    c.t = await c.csrf(base === '/account' ? '/account' : base);
    return c;
  };
  return c;
}
const png = () => [new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'x.png'];
// Query the server's database directly (read-only) for assertions.
const q = (sql, ...args) => JSON.parse(execFileSync(process.execPath, ['-e', `
  const D=require('better-sqlite3');const d=new D(require('path').join(process.env.DATA_DIR,'inkfold.db'),{readonly:true});
  process.stdout.write(JSON.stringify(d.prepare(process.argv[1]).all(...JSON.parse(process.argv[2]))));`, sql, JSON.stringify(args)], { env: process.env }).toString());
const runJobsAt = offsetDays => execFileSync(process.execPath, ['-e', `require('./lib/jobs').runJobs(Date.now()+${offsetDays * DAY})`], { env: { ...process.env, SEED_DEMO: '0' } }).toString();
const money = t => (t.match(/ถอนได้ \(รอแอดมินโอน\)/) ? true : false);

const buyer = await client().login('/account', 'demo@buyer.local', 'buyer12345');
const shop1 = await client().login('/seller', 'demo@handmade.local', 'seller12345');
const shop2 = await client().login('/seller', 'demo@handmade2.local', 'seller12345');
const admin = await client().login('/admin', 'admin@inkfold.local', 'admin12345');
const anon = client();

/* ---------- product page: preparation time, shop shipping, stock, note ---------- */
let r = await anon('/item/9');
ok(r.text.includes('เตรียมสินค้า 2 วัน + ขนส่ง 1–3 วัน'), 'handmade page: prep days + 1–3 days transit');
ok(r.text.includes('฿50 · ชิ้นต่อไป +฿15'), 'handmade page: shop shipping (first + next)');
ok(r.text.includes('เหลือ 3 ชิ้น'), 'stock shown, minus the unpaid DEMO03 hold (4 − 1)');
ok(r.text.includes('name="note"'), 'custom-order note field');
r = await anon('/item/4');
ok(r.text.includes('ส่งฟรีเมื่อซื้อจากร้านนี้ครบ ฿500'), 'free-shipping threshold shown');
r = await anon('/item/1');
ok(r.text.includes('รอผลิตและจัดส่ง 7–14 วัน') && r.text.includes('เก็บเงินปลายทาง'), 'POD book page unchanged (7–14 days, COD)');

/* ---------- cart: 2 shops + a book ---------- */
await buyer('/cart/add/4', { method: 'POST', form: { _csrf: buyer.t, qty: 1, opt_o0: '1', opt_o1: '0', opt_o2: 'ANN', note: 'ขอห่อของขวัญ' } });
r = await buyer('/cart/add/9', { method: 'POST', form: { _csrf: buyer.t, qty: 4, opt_o0: '0' } });
ok(r.status === 400 && r.text.includes('สั่งได้อีก 3 ชิ้น'), 'cannot add more than stock left');
await buyer('/cart/add/9', { method: 'POST', form: { _csrf: buyer.t, qty: 2, opt_o0: '0' } });
await buyer('/cart/add/1', { method: 'POST', form: { _csrf: buyer.t, qty: 1 } });
r = await buyer('/cart');
ok(r.text.includes('พัสดุจากร้าน มะลิทำมือ') && r.text.includes('พัสดุจากร้าน ฝนผ้าทอ') && r.text.includes('พัสดุจาก KDST Shop'), 'cart split into 3 parcels');
// shop1: bracelet 159 + 0 + 0 + text 30 = 189 → fee 40 · shop2: 2 × 450 = 900 → 50 + 15 = 65 · book 189 → 50
ok(r.text.includes('฿65') && r.text.includes('ขาดอีก ฿311'), 'shop shipping: first + next piece, distance to free shipping');
ok(r.text.includes('ข้อความสั่งทำพิเศษ') && r.text.includes('ขอห่อของขวัญ'), 'note kept with the cart item');
ok(r.text.includes('จ่ายครั้งเดียวด้วยการโอน'), 'cart with handmade → one transfer payment');

/* ---------- checkout: transfer + slip ---------- */
r = await buyer('/checkout');
ok(r.text.includes('แนบสลิปการโอน') && r.text.includes('เตรียมสินค้า 3 วัน + ขนส่ง 1–3 วัน') && r.text.includes('เตรียมสินค้า 2 วัน'), 'checkout: slip field + ETA per parcel');
const addr = r.text.match(/name="address_id" value="(\d+)"/)[1];
r = await buyer(`/checkout?_csrf=${buyer.t}`, { method: 'POST', multipart: { ack_wait: '1', address_id: addr } });
ok(r.status === 400 && r.text.includes('แนบสลิปการโอนเงิน'), 'transfer order needs a slip');
r = await buyer(`/checkout?_csrf=${buyer.t}`, { method: 'POST', multipart: { ack_wait: '1', address_id: addr, slip: png() } });
ok(r.status === 302 && /\/account\/orders\/IF-[0-9A-F]{8}\?new=1/.test(r.loc), 'order placed with slip');
const code = r.loc.split('/')[3].split('?')[0];
const [ord] = q('SELECT * FROM orders WHERE code=?', code);
let ships = q('SELECT s.*, u.email FROM shipments s LEFT JOIN users u ON u.id=s.seller_id WHERE order_id=? ORDER BY id', ord.id);
ok(ord.method === 'transfer' && ord.pay_status === 'awaiting' && ord.total === 189 + 900 + 189 + 40 + 65 + 50, `one payment for all parcels (total ${ord.total})`);
ok(ships.length === 3 && ships.every(s => s.status === 'awaiting_payment'), 'all parcels wait for payment (book too)');
const s1 = ships.find(s => s.email === 'demo@handmade.local'), s2 = ships.find(s => s.email === 'demo@handmade2.local'), sp = ships.find(s => s.fulfilled_by === 'platform');
ok(q('SELECT note FROM order_items WHERE shipment_id=?', s1.id)[0].note === 'ขอห่อของขวัญ', 'note saved on the order item');

r = await shop1('/seller/orders?tab=unpaid');
ok(r.text.includes(code) && r.text.includes('แสดงชื่อที่อยู่เมื่อลูกค้าชำระเงินแล้ว') && !r.text.includes('99/1 ถ.สุขุมวิท'), 'seller sees unpaid order but no address yet');

/* ---------- admin: slip reject → resend → confirm ---------- */
r = await admin('/admin/orders?tab=slips');
ok(r.text.includes(code) && r.text.includes(`/files/slip/${ord.id}`), 'admin slip queue lists the order with the slip');
await admin(`/admin/orders/${ord.id}/reject-slip`, { method: 'POST', form: { _csrf: admin.t, note: 'ยอดไม่ตรง' } });
r = await buyer(`/account/orders/${code}`);
ok(r.text.includes('ยอดไม่ตรง') && r.text.includes('ส่งสลิปใหม่'), 'buyer sees rejection and can resend');
await buyer(`/account/orders/${code}/slip?_csrf=${buyer.t}`, { method: 'POST', multipart: { slip: png() } });
ok(q('SELECT pay_status FROM orders WHERE id=?', ord.id)[0].pay_status === 'awaiting', 'slip resent → awaiting again');
const stockBefore = q('SELECT stock FROM products WHERE id=9')[0].stock;
await admin(`/admin/orders/${ord.id}/confirm-payment`, { method: 'POST', form: { _csrf: admin.t } });
ships = q('SELECT * FROM shipments WHERE order_id=? ORDER BY id', ord.id);
ok(ships.find(s => s.id === s1.id).status === 'preparing' && ships.find(s => s.id === s2.id).status === 'preparing', 'handmade parcels → preparing');
ok(ships.find(s => s.id === sp.id).status === 'placed', 'book parcel → placed (normal print queue)');
ok(q('SELECT stock FROM products WHERE id=9')[0].stock === stockBefore - 2, `stock deducted on payment (${stockBefore} → ${stockBefore - 2})`);
r = await shop2('/seller/sales');
ok(r.text.includes('รอปล่อย'), 'shop money becomes pending');

/* ---------- sellers ship ---------- */
r = await shop1('/seller/orders');
ok(r.text.includes('99/1 ถ.สุขุมวิท') && r.text.includes('ขอห่อของขวัญ') && r.text.includes('ANN'), 'seller sees address, options and note once paid');
r = await shop1(`/seller/shipments/${s1.id}/label`);
ok(r.status === 200 && r.text.includes('ผู้รับ') && r.text.includes('สมใจ') && r.text.includes(code) && r.text.includes('มะลิทำมือ 12/3'), 'printable label: recipient, sender, order no.');
ok((await shop1(`/seller/shipments/${s2.id}/label`)).status === 404, "shop can't open another shop's label");
await shop1(`/seller/shipments/${s1.id}/ship`, { method: 'POST', form: { _csrf: shop1.t, carrier: '', tracking: 'X' } });
ok(q('SELECT status FROM shipments WHERE id=?', s1.id)[0].status === 'preparing', 'carrier is required');
await shop1(`/seller/shipments/${s2.id}/ship`, { method: 'POST', form: { _csrf: shop1.t, carrier: 'kerry', tracking: 'HACK' } });
ok(q('SELECT status FROM shipments WHERE id=?', s2.id)[0].status === 'preparing', "shop can't ship another shop's parcel");
await shop1(`/seller/shipments/${s1.id}/ship`, { method: 'POST', form: { _csrf: shop1.t, carrier: 'thaipost', tracking: 'EF123456789TH' } });
await shop2(`/seller/shipments/${s2.id}/ship`, { method: 'POST', form: { _csrf: shop2.t, carrier: 'other', carrier_other: 'ขนส่งชุมชน', tracking: 'LOCAL-77' } });
ships = q('SELECT * FROM shipments WHERE order_id=? ORDER BY id', ord.id);
ok(ships.find(s => s.id === s1.id).carrier === 'ไปรษณีย์ไทย' && ships.find(s => s.id === s2.id).carrier === 'ขนส่งชุมชน', 'carrier saved (listed and "other")');
r = await buyer(`/account/orders/${code}`);
ok(r.text.includes('EF123456789TH') && r.text.includes('LOCAL-77') && r.text.includes('ส่งโดยร้าน มะลิทำมือ') && r.text.includes('ส่งโดยร้าน ฝนผ้าทอ'), 'buyer tracking page split by shop with own tracking numbers');

/* ---------- buyer receives shop 1 → money withdrawable ---------- */
const bal = email => q(`SELECT id FROM users WHERE email=?`, email)[0].id;
const statsOf = id => JSON.parse(execFileSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require('./db').sellerStats(${id})))`], { env: { ...process.env, SEED_DEMO: '0' } }).toString());
const before1 = statsOf(bal('demo@handmade.local'));
await buyer(`/account/shipments/${s1.id}/receive`, { method: 'POST', form: { _csrf: buyer.t } });
const after1 = statsOf(bal('demo@handmade.local'));
ok(q('SELECT status FROM shipments WHERE id=?', s1.id)[0].status === 'released', 'receive → released');
ok(Math.abs(after1.balance - before1.balance - (189 * 0.85 + 40)) < 0.01 && Math.abs(before1.pending - after1.pending - (189 * 0.85 + 40)) < 0.01, `pending → withdrawable (+${(189 * 0.85 + 40).toFixed(2)})`);
const other = client();
const ot = await other.csrf('/account/register');
await other('/account/register', { method: 'POST', form: { _csrf: ot, display_name: 'คนอื่น', email: 'other@buyer.local', phone: '0811111111', password: 'pass12345', confirm: 'pass12345' } });
other.t = await other.csrf('/account');
await other(`/account/shipments/${s2.id}/receive`, { method: 'POST', form: { _csrf: other.t } });
ok(q('SELECT status FROM shipments WHERE id=?', s2.id)[0].status === 'shipped', "another buyer can't confirm receipt");

/* ---------- payouts capped at withdrawable ---------- */
const sid2 = bal('demo@handmade2.local');
r = await admin('/admin/payouts', { method: 'POST', form: { _csrf: admin.t, seller_id: sid2, amount: '100' } });
ok(q('SELECT COUNT(*) n FROM payouts WHERE seller_id=?', sid2)[0].n === 0, 'cannot pay out pending money');

/* ---------- late + auto-cancel (DEMO04) and auto-release (DEMO05) ---------- */
r = await admin('/admin/orders?tab=late');
ok(r.text.includes('IF-DEMO04') && r.text.includes('เลยกำหนดเกิน'), 'late parcel flagged to admin (ship-by + 2 days)');
const demo4 = q("SELECT s.id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.code='IF-DEMO04'")[0].id;
const demo5 = q("SELECT s.id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.code='IF-DEMO05'")[0].id;
runJobsAt(1);
ok(q('SELECT status FROM shipments WHERE id=?', demo4)[0].status === 'preparing', 'not auto-cancelled before ship-by + 5 days');
runJobsAt(3);
const d4 = q('SELECT status, auto_note FROM shipments WHERE id=?', demo4)[0];
ok(d4.status === 'cancelled' && d4.auto_note.includes('ยกเลิกอัตโนมัติ'), 'auto-cancel after ship-by + 5 days');
ok(q("SELECT amount, status FROM refunds WHERE shipment_id=?", demo4)[0]?.status === 'pending', 'auto-cancel queues a refund');
ok(q('SELECT status FROM shipments WHERE id=?', demo5)[0].status === 'shipped', 'not auto-released before 7 days (shipped 3 days ago, +3)');
runJobsAt(5);
ok(q('SELECT status FROM shipments WHERE id=?', demo5)[0].status === 'released' && q('SELECT auto_note FROM shipments WHERE id=?', demo5)[0].auto_note.includes('ปล่อยเงินอัตโนมัติ'), 'auto-release 7 days after shipping');

/* ---------- problem report → refund ---------- */
r = await buyer(`/account/shipments/${s2.id}/problem`);
ok(r.status === 200 && r.text.includes('ไม่ตรงตามที่สั่ง'), 'problem form');
r = await buyer(`/account/shipments/${s2.id}/problem?_csrf=${buyer.t}`, { method: 'POST', multipart: { kind: 'damaged', detail: 'สั้น' } });
ok(r.status === 400, 'problem needs detail');
r = await buyer(`/account/shipments/${s2.id}/problem?_csrf=${buyer.t}`, { method: 'POST', multipart: { kind: 'damaged', detail: 'สายกระเป๋าขาด 1 ใบ ตะเข็บหลุด', problem_images: png() } });
ok(q('SELECT status FROM shipments WHERE id=?', s2.id)[0].status === 'problem', 'report → problem');
const [dsp] = q('SELECT * FROM disputes WHERE shipment_id=?', s2.id);
ok(dsp && JSON.parse(dsp.images).length === 1, 'dispute saved with photo');
ok((await shop2(`/files/dispute/${dsp.id}/0`)).status === 200 && (await shop1(`/files/dispute/${dsp.id}/0`)).status === 404, 'photo visible to that shop only');
runJobsAt(30);
ok(q('SELECT status FROM shipments WHERE id=?', s2.id)[0].status === 'problem', 'auto-release skips parcels with an open problem');
r = await admin('/admin/claims');
ok(r.text.includes('สายกระเป๋าขาด') && r.text.includes(code), 'admin claims page lists it');
await admin(`/admin/disputes/${dsp.id}/decide`, { method: 'POST', form: { _csrf: admin.t, decision: 'refund', amount: '450', note: 'สินค้าเสียหายตามรูป คืนค่ากระเป๋า 1 ใบ' } });
ok(q('SELECT status FROM shipments WHERE id=?', s2.id)[0].status === 'refunded', 'decision refund → refunded');
const [rf] = q('SELECT * FROM refunds WHERE shipment_id=?', s2.id);
ok(rf && rf.amount === 450 && rf.status === 'pending', 'refund queued as pending (partial amount)');
r = await buyer(`/account/orders/${code}`);
ok(r.text.includes('รอคืนเงิน') && r.text.includes('กรอกบัญชีรับเงินคืน'), 'buyer sees pending refund and is asked for an account');
await buyer('/account/refund-account', { method: 'POST', form: { _csrf: buyer.t, refund_account: 'พร้อมเพย์ 0890000000 สมใจ', back: `/account/orders/${code}` } });
await admin(`/admin/refunds/${rf.id}/paid`, { method: 'POST', form: { _csrf: admin.t, ref: '' } });
ok(q('SELECT status FROM refunds WHERE id=?', rf.id)[0].status === 'pending', 'refund needs a transfer reference');
r = await admin('/admin/claims');
ok(r.text.includes('พร้อมเพย์ 0890000000 สมใจ'), 'admin sees buyer refund account');
await admin(`/admin/refunds/${rf.id}/paid`, { method: 'POST', form: { _csrf: admin.t, ref: 'KB-REF-001' } });
ok(q('SELECT status, ref FROM refunds WHERE id=?', rf.id)[0].ref === 'KB-REF-001', 'refund marked paid with reference');
const s2stats = statsOf(sid2);
ok(s2stats.pending < 700 && !JSON.stringify(s2stats).includes('NaN'), 'refunded parcel no longer counts as shop money');

/* ---------- seller cancel restores stock + refund ---------- */
const t2 = await buyer.csrf('/item/9');
await buyer('/cart/add/9', { method: 'POST', form: { _csrf: t2, qty: 1, opt_o0: '1' } });
r = await buyer(`/checkout?_csrf=${buyer.t}`, { method: 'POST', multipart: { ack_wait: '1', address_id: addr, slip: png() } });
const code2 = r.loc.split('/')[3].split('?')[0];
const [o2] = q('SELECT * FROM orders WHERE code=?', code2);
await admin(`/admin/orders/${o2.id}/confirm-payment`, { method: 'POST', form: { _csrf: admin.t } });
const stockPaid = q('SELECT stock FROM products WHERE id=9')[0].stock;
const sx = q('SELECT id FROM shipments WHERE order_id=?', o2.id)[0].id;
await shop2(`/seller/shipments/${sx}/cancel`, { method: 'POST', form: { _csrf: shop2.t, note: 'ผ้าสีนี้หมด' } });
ok(q('SELECT status FROM shipments WHERE id=?', sx)[0].status === 'cancelled' && q('SELECT stock FROM products WHERE id=9')[0].stock === stockPaid + 1, 'seller cancel → stock returned');
ok(q('SELECT status FROM refunds WHERE shipment_id=?', sx)[0]?.status === 'pending', 'seller cancel of a paid parcel → refund pending');

/* ---------- POD unchanged: books-only cart is COD ---------- */
const t3 = await buyer.csrf('/item/7');
await buyer('/cart/add/7', { method: 'POST', form: { _csrf: t3, qty: 1 } });
r = await buyer('/checkout');
ok(r.text.includes('เก็บเงินปลายทาง (COD)') && !r.text.includes('name="slip"'), 'books-only checkout: COD, no slip');
r = await buyer(`/checkout?_csrf=${buyer.t}`, { method: 'POST', multipart: { ack_wait: '1', address_id: addr } });
const code3 = r.loc.split('/')[3].split('?')[0];
const [o3] = q('SELECT * FROM orders WHERE code=?', code3);
const [sp3] = q('SELECT * FROM shipments WHERE order_id=?', o3.id);
ok(o3.method === 'cod' && sp3.status === 'placed' && sp3.ship_fee === 50, 'POD: COD order, parcel placed, flat ฿50 shipping');
for (const m of ['start', 'ship', 'deliver']) await admin(`/admin/shipments/${sp3.id}/${m}`, { method: 'POST', form: { _csrf: admin.t, tracking: 'TH555', carrier: 'thaipost' } });
ok(q('SELECT status FROM shipments WHERE id=?', sp3.id)[0].status === 'delivered', 'POD: admin start → ship → deliver as before');
await buyer(`/account/shipments/${sp3.id}/receive`, { method: 'POST', form: { _csrf: buyer.t } });
ok(q('SELECT status FROM shipments WHERE id=?', sp3.id)[0].status === 'delivered', 'POD has no buyer "received" step');
await admin(`/admin/shipments/${sp.id}/start`, { method: 'POST', form: { _csrf: admin.t } });
ok(q('SELECT status FROM shipments WHERE id=?', sp.id)[0].status === 'in_production', 'book parcel in a prepaid order prints normally');

/* ---------- pages render ---------- */
for (const [c, p] of [[admin, '/admin'], [admin, '/admin/orders?tab=all'], [admin, '/admin/claims'], [admin, '/admin/payouts'], [admin, '/admin/settings'], [shop2, '/seller/orders?tab=all'], [shop2, '/seller/sales'], [buyer, `/account/orders/${code}`], [buyer, '/account/orders']]) {
  ok((await c(p)).status === 200, `page ${p}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
