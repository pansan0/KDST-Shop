// End-to-end smoke test against a running dev server (fresh seed). node e2e.mjs
const B = process.env.BASE || 'http://localhost:3000';
let fails = 0;
const png = () => [new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'x.png'];
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

function client() {
  const jar = new Map();
  const c = async (path, { method = 'GET', form, multipart } = {}) => {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    if (multipart) { body = new FormData(); for (const [k, v] of Object.entries(multipart)) Array.isArray(v) ? body.append(k, v[0], v[1]) : body.append(k, v); }
    const r = await fetch(B + path, { method, headers, body, redirect: 'manual' });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    const text = await r.text();
    return { status: r.status, loc: r.headers.get('location'), text };
  };
  c.csrf = async (path = '/') => (await c(path)).text.match(/name="_csrf" value="([^"]+)"/)?.[1];
  c.login = async (base, email, password, next = '') => {
    const t = await c.csrf(`${base}/login`);
    return c(`${base}/login`, { method: 'POST', form: { _csrf: t, email, password, next } });
  };
  return c;
}

// --- anonymous
const anon = client();
let r = await anon('/');
ok(r.status === 200 && r.text.includes('กำไลลูกปัดสลักชื่อ') && r.text.includes('มหาสมุทรแสนสนุก'), 'storefront lists KDP + handmade');
ok(r.text.includes('badge hot'), 'storefront shows ขายดี badge');
r = await anon('/?cat=handmade');
ok(r.text.includes('กำไลลูกปัด') && !r.text.includes('มหาสมุทรแสนสนุก'), 'handmade filter');
r = await anon('/item/4');
ok(r.status === 200 && r.text.includes('สีลูกปัด') && r.text.includes('data-preview'), 'bracelet page shows options');
ok(r.text.includes('ไม่เหมาะกับเด็กอายุต่ำกว่า 3 ปี'), 'small-parts warning shown');
r = await anon('/item/8');
ok(r.status === 404, 'pending earrings not public');
r = await anon('/book/1');
ok(r.status === 301 && r.loc === '/item/1', 'old /book URL redirects');
let t = await anon.csrf('/item/4');
r = await anon('/cart/add/4', { method: 'POST', form: { _csrf: t, qty: 1 } });
ok(r.status === 302 && r.loc.startsWith('/account/login?next=%2Fitem%2F4'), 'anonymous add-to-cart → buyer login');
r = await anon('/cart');
ok(r.status === 302 && r.loc.startsWith('/account/login'), 'cart needs login');

// --- buyer signs up
const buyer = client();
t = await buyer.csrf('/account/register');
r = await buyer('/account/register', { method: 'POST', form: { _csrf: t, display_name: 'ผู้ทดสอบ', email: 'e2e@buyer.local', phone: '0812345678', password: 'pass12345', confirm: 'pass12345', next: '/item/4' } });
ok(r.status === 302 && r.loc === '/item/4', 'buyer register → back to item');
t = await buyer.csrf('/item/4');
r = await buyer('/cart/add/4', { method: 'POST', form: { _csrf: t, qty: 1 } });
ok(r.status === 400 && r.text.includes('เลือกขนาดข้อมือ') && r.text.includes('เลือกสีลูกปัด'), 'required options enforced');
r = await buyer('/cart/add/4', { method: 'POST', form: { _csrf: t, qty: 1, opt_o0: '2', opt_o1: '2', opt_o2: 'mali♥' } });
ok(r.status === 302 && r.loc === '/cart', 'bracelet added with options');
r = await buyer('/cart/add/4', { method: 'POST', form: { _csrf: t, qty: 1, opt_o0: '0', opt_o1: '0', opt_o2: 'มะลิ' } });
ok(r.status === 400 && r.text.includes('A–Z'), 'charset rule enforced');
r = await buyer('/cart/add/1', { method: 'POST', form: { _csrf: t, qty: 2 } });
ok(r.status === 302, 'KDP book added');
r = await buyer('/cart');
// bracelet 159 + L 10 + ขาวมุก 15 + text 30 = 214; book 2×189 = 378; ship 40 + 50
ok(r.text.includes('฿214') && r.text.includes('฿378') && r.text.includes('฿682'), 'cart totals (214 + 378 + 90 ship = 682)');
ok(r.text.includes('พัสดุจาก KDST Shop') && r.text.includes('พัสดุจากร้าน มะลิทำมือ'), 'cart split into 2 shipments');
ok(r.text.includes('MALI♥'), 'text option upper-cased');
r = await buyer('/checkout', { method: 'POST', form: { _csrf: t, ack_wait: '1', address_id: 'new', a_name: 'ผู้ทดสอบ', a_phone: '081', a_line: 'สั้น', a_province: '', a_postcode: '1' } });
ok(r.status === 400 && r.text.includes('รหัสไปรษณีย์ต้องมี 5 หลัก'), 'address validation');
r = await buyer('/checkout', { method: 'POST', form: { _csrf: t, address_id: 'new', a_name: 'ผู้ทดสอบ', a_phone: '0812345678', a_line: '1 ถ.สุขุมวิท', a_province: 'ชลบุรี', a_district: 'ศรีราชา', a_subdistrict: 'ทุ่งสุขลา', a_postcode: '20230' } });
ok(r.status === 400 && r.text.includes('ติ๊กยืนยันว่ารับทราบระยะเวลารอสินค้า'), 'checkout requires acknowledging the waiting time');
ok((await anon('/')).text.includes('ได้รับใน 7–14 วัน') && (await anon('/item/1')).text.includes('รอผลิตและจัดส่ง 7–14 วัน') && (await anon('/item/4')).text.includes('เตรียมสินค้า 3 วัน + ขนส่ง 1–3 วัน'), 'wait notice: books 7–14 days, handmade prep + transit');
ok((await buyer('/cart')).text.includes('รอผลิตและจัดส่ง 7–14 วัน'), 'wait notice in cart');
r = await buyer('/checkout', { method: 'POST', form: { _csrf: t, ack_wait: '1', address_id: 'new', a_name: 'ผู้ทดสอบ', a_phone: '0812345678', a_line: '1 ถ.สุขุมวิท', a_province: 'ชลบุรี', a_district: 'บางละมุง', a_subdistrict: 'ทุ่งสุขลา', a_postcode: '20230' } });
ok(r.status === 400 && r.text.includes('เลือกตำบล') && r.text.includes('<option selected>บางละมุง</option>'), 'sub-district must belong to district; lists re-filled after error');
r = await buyer(`/checkout?_csrf=${t}`, { method: 'POST', multipart: { slip: png(), ack_wait: '1', address_id: 'new', a_name: 'ผู้ทดสอบ', a_phone: '0812345678', a_line: '1 ถ.สุขุมวิท', a_province: 'ชลบุรี', a_district: 'ศรีราชา', a_subdistrict: 'ทุ่งสุขลา', a_postcode: '20230', save_address: '1' } });
ok(r.status === 302 && /^\/account\/orders\/IF-[0-9A-F]{8}\?new=1$/.test(r.loc), 'checkout → order page');
const code = r.loc.split('/')[3].split('?')[0];
r = await buyer(r.loc);
ok(r.text.includes('สั่งซื้อเรียบร้อย') && r.text.includes('ส่งโดย KDST Shop') && r.text.includes('ส่งโดยร้าน มะลิทำมือ'), 'order page shows both shipments');
ok(r.text.includes('คาดว่าจะได้รับ'), 'order page shows expected delivery range');
r = await buyer('/cart');
ok(r.text.includes('ตะกร้ายังว่าง'), 'cart emptied after order');
r = await buyer('/account');
ok(r.text.includes('1 ถ.สุขุมวิท ต.ทุ่งสุขลา อ.ศรีราชา จ.ชลบุรี 20230') && r.text.includes('ที่อยู่หลัก'), 'address saved as default, Thai format');
ok((r.text.match(/<select id="a_province"[\s\S]*?<\/select>/)[0].match(/<option>/g) || []).length === 77, 'province list has 77 provinces');
r = await buyer('/account/addresses', { method: 'POST', form: { _csrf: t, a_name: 'ที่ทำงาน', a_phone: '0812345678', a_line: '88 อาคารเอ ชั้น 5', a_province: 'กรุงเทพมหานคร', a_district: 'คลองเตย', a_subdistrict: 'พระโขนง', a_postcode: '10110' } });
r = await buyer('/account');
ok(r.text.includes('88 อาคารเอ ชั้น 5 แขวงพระโขนง เขตคลองเตย กรุงเทพมหานคร 10110'), 'Bangkok uses แขวง/เขต');
r = await buyer('/account/addresses', { method: 'POST', form: { _csrf: t, a_name: 'x y', a_phone: '0812345678', a_line: '1', a_province: 'ไม่มีจังหวัดนี้', a_district: 'a', a_subdistrict: 'b', a_postcode: '10110' } });
ok(r.status === 400 && r.text.includes('เลือกจังหวัด'), 'unknown province rejected');
r = await buyer('/static/data/th-address.json');
ok(r.status === 200 && JSON.parse(r.text).provinces.length === 77, 'address data served to the browser');
const ordAddr = (await buyer(`/account/orders/${code}`)).text;
ok(ordAddr.includes('ต.ทุ่งสุขลา อ.ศรีราชา จ.ชลบุรี 20230'), 'order snapshot uses formatted address');
// Cart had handmade → transfer order. Admin confirms the slip; shipIds[0] = Inkfold parcel, shipIds[1] = handmade parcel.
const adm = client();
await adm.login('/admin', 'admin@inkfold.local', 'admin12345');
const at0 = await adm.csrf('/admin');
const slipPage = (await adm('/admin/orders?tab=slips')).text;
const row = slipPage.split('<tr>').find(x => x.includes(code));
const orderId = row.match(/\/admin\/orders\/(\d+)\/confirm-payment/)[1];
const idFor = label => Number([...row.matchAll(/\/admin\/shipments\/(\d+)\/cancel"[\s\S]*?ยกเลิก([^<]*)<\/button>/g)].find(m => m[2].includes(label))[1]);
const shipIds = [idFor('KDST Shop'), idFor('มะลิทำมือ')];
ok(shipIds.every(Boolean), 'admin slip queue shows both parcels');
r = await buyer(`/account/shipments/${shipIds[1]}/cancel`, { method: 'POST', form: { _csrf: t } });
ok((await buyer(`/account/orders/${code}`)).text.includes('รอยืนยันการชำระ'), 'buyer cannot cancel a prepaid handmade parcel');
await adm(`/admin/orders/${orderId}/confirm-payment`, { method: 'POST', form: { _csrf: at0 } });
r = await buyer(`/account/shipments/${shipIds[0]}/cancel`, { method: 'POST', form: { _csrf: t } });
r = await buyer(`/account/orders/${code}`);
ok(r.text.includes('ผู้ซื้อยกเลิกเอง') && r.text.includes('รอคืนเงิน'), 'buyer cancelled paid book parcel → refund pending');
r = await buyer('/seller');
ok(r.status === 302 && r.loc.startsWith('/seller/login'), 'buyer cannot open seller portal');
r = await buyer('/admin');
ok(r.status === 302 && r.loc.startsWith('/admin/login'), 'buyer cannot open admin portal');

// --- handmade seller fulfils
const hm = client();
r = await hm.login('/seller', 'demo@handmade.local', 'seller12345');
ok(r.status === 302 && r.loc === '/seller', 'handmade seller login');
r = await hm('/seller/orders');
ok(r.text.includes(code) && r.text.includes('MALI♥') && r.text.includes('20230'), 'seller sees production sheet + address');
t = await hm.csrf('/seller/orders');
r = await hm(`/seller/shipments/${shipIds[1]}/ship`, { method: 'POST', form: { _csrf: t, tracking: 'X1' } });
r = await hm('/seller/orders');
ok(r.text.includes('เลือกบริษัทขนส่ง'), 'shipping needs a carrier');
await hm(`/seller/shipments/${shipIds[1]}/ship`, { method: 'POST', form: { _csrf: t, carrier: 'kerry', tracking: 'KE999' } });
r = await hm(`/seller/shipments/${shipIds[1]}/deliver`, { method: 'POST', form: { _csrf: t } });
ok(r.status === 302, 'seller deliver route ignored');
r = await hm('/seller/orders?tab=shipped');
ok(r.text.includes('KE999'), 'seller shipped with tracking');
r = await hm(`/seller/shipments/${shipIds[0]}/start`, { method: 'POST', form: { _csrf: t } });
r = await hm('/seller/orders');
ok(r.text.includes('ไม่ใช่พัสดุของร้านคุณ') || r.text.includes('ทำรายการนี้ไม่ได้') || r.text.includes('ไม่มีสิทธิ์'), "seller can't touch platform shipment");
for (const p of ['/seller', '/seller/sales', '/seller/account', '/seller/products/new?kind=handmade', '/seller/products/4/edit', '/seller/products/new?kind=kdp', '/seller/handmade/apply']) {
  r = await hm(p); ok(r.status === 200, `seller page ${p}`);
}
r = await hm('/seller/products/4/edit');
ok(r.text.includes('ขาวมุก | +15 | #f4efe6'), 'option builder round-trips values');
// create a handmade draft with an option via multipart
t = await hm.csrf('/seller/products/new?kind=handmade');
r = await hm(`/seller/products?kind=handmade&_csrf=${t}`, { method: 'POST', multipart: { action: 'draft', title: 'สร้อยทดสอบ', price: '120', category: 'jewelry', lead_days: '2', weekly_capacity: '5', ship_fee: '30', opt_type_0: 'select', opt_label_0: 'ความยาว', opt_values_0: '40 ซม.\n45 ซม. | +10' } });
ok(r.status === 302 && r.loc === '/seller', 'handmade draft saved');
r = await hm(`/seller/products?kind=handmade&_csrf=${t}`, { method: 'POST', multipart: { action: 'submit', title: 'สร้อยส่งตรวจ', price: '120', category: 'jewelry', metal: '1', opt_type_0: 'select', opt_label_0: 'ความยาว', opt_values_0: 'เส้นเดียว' } });
ok(r.status === 400 && r.text.includes('อย่างน้อย 2 ค่า') && r.text.includes('นิกเกิล') && r.text.includes('รูปหลัก'), 'handmade submit validation');
r = await hm(`/seller/products?kind=handmade&_csrf=${t}`, { method: 'POST', multipart: { action: 'submit', title: 'ช้า', price: '120', category: 'jewelry', lead_days: '20' } });
ok(r.status === 400 && r.text.includes('ระยะเวลาเตรียมสินค้าต้องอยู่ระหว่าง 1–14 วัน'), 'handmade preparation time 1–14 days');

// --- KDP-only seller cannot list handmade
const kdp = client();
await kdp.login('/seller', 'demo@seller.local', 'seller12345');
r = await kdp('/seller/products/new?kind=handmade');
ok(r.status === 302 && r.loc === '/seller/handmade/apply', 'unapproved seller → handmade application');
r = await kdp('/seller/orders');
ok(r.status === 200, 'kdp seller orders page');

// --- admin
const ad = client();
r = await ad.login('/admin', 'admin@inkfold.local', 'admin12345');
ok(r.status === 302 && r.loc === '/admin', 'admin login');
for (const p of ['/admin', '/admin/products', '/admin/products?status=all&kind=handmade', '/admin/products/8', '/admin/products/1', '/admin/orders', '/admin/orders?tab=cod', '/admin/orders?tab=late', '/admin/orders?tab=all', '/admin/orders?tab=slips', '/admin/claims', '/admin/sellers', '/admin/buyers', '/admin/payouts', '/admin/settings']) {
  r = await ad(p); ok(r.status === 200, `admin page ${p}`);
}
r = await ad('/admin/products/8');
ok(r.text.includes('ck_metal') && r.text.includes('REACH') && !r.text.includes('ck_kids'), 'earrings checklist includes metal, not kids');
r = await ad('/admin/products/3');
ok(r.text.includes('ck_content') && r.text.includes('ck_trim'), 'KDP checklist');
t = await ad.csrf('/admin');
r = await ad('/admin/products/8/review', { method: 'POST', form: { _csrf: t, decision: 'approved', ck_accurate: 1 } });
r = await ad('/admin/products/8');
ok(r.text.includes('ติ๊กเช็กลิสต์มาตรฐานให้ครบ'), 'approve blocked without full checklist');
const all = { accurate: 1, main_image: 1, ip: 1, prohibited: 1, materials: 1, handmade: 1, lead: 1, options: 1, metal: 1 };
r = await ad('/admin/products/8/review', { method: 'POST', form: { _csrf: t, decision: 'approved', ...Object.fromEntries(Object.keys(all).map(k => ['ck_' + k, 1])) } });
r = await anon('/item/8');
ok(r.status === 200, 'earrings live after full checklist');
r = await ad('/admin/orders?tab=hm_shipped');
ok(r.text.includes('KE999'), 'admin sees shipped handmade parcel');
r = await buyer(`/account/shipments/${shipIds[1]}/receive`, { method: 'POST', form: { _csrf: await buyer.csrf('/account') } });
ok(r.status === 302, 'buyer confirms receipt');
r = await hm('/seller/sales');
// seed: bookmark 89×0.85=75.65 + ship 30 → 105.65; new bracelet 214×0.85=181.9 + ship 40 → 327.55
ok(r.text.includes('฿327.55'), 'seller withdrawable = items × 85% + own shipping fees');
r = await buyer(`/account/orders/${code}`);
ok(r.text.includes('ได้รับแล้ว · ปล่อยเงินให้ร้านแล้ว'), 'buyer sees received / released');

// --- COD refusal blocks buyer after 2 returns
for (let n = 0; n < 2; n++) {
  t = await buyer.csrf('/item/1');
  await buyer('/cart/add/1', { method: 'POST', form: { _csrf: t, qty: 1 } });
  const addr = (await buyer('/checkout')).text.match(/name="address_id" value="(\d+)"/)[1];
  r = await buyer('/checkout', { method: 'POST', form: { _csrf: t, ack_wait: '1', address_id: addr } });
  const c2 = r.loc.split('/')[3].split('?')[0];
  const sid = (await buyer(`/account/orders/${c2}`)).text.match(/\/account\/shipments\/(\d+)\/cancel/)[1];
  const at = await ad.csrf('/admin');
  for (const m of ['start', 'ship', 'return']) await ad(`/admin/shipments/${sid}/${m}`, { method: 'POST', form: { _csrf: at, tracking: 'R' + n, carrier: 'flash' } });
}
t = await buyer.csrf('/item/1');
await buyer('/cart/add/1', { method: 'POST', form: { _csrf: t, qty: 1 } });
r = await buyer('/cart');
ok(r.text.includes('ถูกระงับการเก็บเงินปลายทาง'), 'buyer COD blocked after 2 refusals');
r = await ad('/admin/buyers');
ok(r.text.includes('ปิดสิทธิ์'), 'admin sees blocked buyer');

// --- security
const ev = client();
r = await ev.login('/account', 'demo@buyer.local', 'buyer12345', '//evil.example');
ok(r.loc === '/', 'open redirect blocked');
r = await client().login('/account', 'demo@buyer.local', 'buyer12345', '/admin');
ok(r.loc === '/', 'buyer next cannot point into admin');
r = await ev(`/account/orders/${code}`);
ok(r.status === 404, "buyer can't see another buyer's order");
r = await ev(`/account/shipments/${shipIds[1]}/cancel`, { method: 'POST', form: { _csrf: await ev.csrf('/account') } });
r = await ev('/account/orders');
ok(r.text.includes('ไม่พบพัสดุ'), "buyer can't cancel another buyer's shipment");
r = await ev('/cart/add/1', { method: 'POST', form: { qty: 1 } });
ok(r.status === 403, 'CSRF enforced');
r = await anon('/files/pdf/1');
ok(r.status === 404, 'PDF not public');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
