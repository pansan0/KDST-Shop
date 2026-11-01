// English mode checks against a fresh seeded server. usage: BASE=http://localhost:3100 node e2e-en.mjs
const B = process.env.BASE || 'http://localhost:3100';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
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
  c.csrf = async p => (await c(p)).text.match(/name="_csrf" value="([^"]+)"/)?.[1];
  return c;
}
const b = client();
let r = await b('/');
ok(r.text.includes('<html lang="th"') && r.text.includes('สินค้าทั้งหมด') && r.text.includes('>EN<'), 'Thai by default with an EN switch');
r = await b('/lang/en?back=/item/4');
ok(r.status === 302 && r.loc === '/item/4', 'switch sets the cookie and returns to the page');
r = await b('/lang/en?back=//evil.example');
ok(r.loc === '/', 'switch refuses off-site redirects');
r = await b('/');
ok(r.text.includes('<html lang="en"') && r.text.includes('All products') && r.text.includes('Shop by category') && r.text.includes('>ไทย<'), 'home in English');
ok(r.text.includes('Colouring books') && r.text.includes('Arrives in 7–14 days') && r.text.includes('Made in 3 days + 1–3 days delivery'), 'catalogue labels and waiting times translated');
ok(r.text.includes('มหาสมุทรแสนสนุก') && r.text.includes('มะลิทำมือ (ร้านตัวอย่าง)'), 'product and shop names left as typed');
r = await b('/item/4');
ok(r.text.includes('Add to cart') && r.text.includes('Note to the maker (optional)') && r.text.includes('Made in 3 days + 1–3 days shipping'), 'product page in English');
ok(r.text.includes('เลือกขนาด สี และตัวอักษรได้เอง'), 'seller subtitle not mistaken for UI text');
ok(r.text.includes('aria-label="View larger image"') && r.text.includes('placeholder="e.g. gift wrap please / softer colours"'), 'attributes translated');
let t = await b.csrf('/account/login');
await b('/account/login', { method: 'POST', form: { _csrf: t, email: 'demo@buyer.local', password: 'buyer12345' } });
t = await b.csrf('/account');
r = await b('/cart/add/4', { method: 'POST', form: { _csrf: t, qty: 1 } });
ok(r.status === 400 && r.text.includes('Please fix the following') && r.text.includes('Choose: ขนาดข้อมือ'), 'validation errors in English (seller option label kept)');
r = await b('/cart/add/1', { method: 'POST', form: { _csrf: t, qty: 1 } });
r = await b('/cart');
ok(r.text.includes('Added “มหาสมุทรแสนสนุก” to your cart') && r.text.includes('Go to checkout') && r.text.includes('Books only: cash on delivery'), 'cart + flash toast in English');
r = await b('/checkout');
ok(r.text.includes('Where should we send it?') && r.text.includes('Cash on delivery (COD)') && r.text.includes('Place order'), 'checkout in English');
const addr = r.text.match(/name="address_id" value="(\d+)"/)[1];
r = await b(`/checkout?_csrf=${t}`, { method: 'POST', multipart: { address_id: addr } });
ok(r.status === 400 && r.text.includes('Please confirm you understand the waiting time'), 'checkout error in English');
r = await b(`/checkout?_csrf=${t}`, { method: 'POST', multipart: { ack_wait: '1', address_id: addr } });
ok(r.status === 302 && r.loc.includes('?new=1'), 'order placed in English mode');
r = await b(r.loc);
ok(r.text.includes('Order placed') && r.text.includes('Your order number') && r.text.includes('Shipped by KDST Shop'), 'order page in English');
r = await b('/account/orders/IF-DEMO05');
ok(/\d{1,2} [A-Z][a-z]{2} 20\d\d, \d\d:\d\d/.test(r.text) && !/(ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย|ต\.ค|พ\.ย|ธ\.ค)\./.test(r.text), 'dates in English, Gregorian year, no Thai months');
ok(r.text.includes('Received') && r.text.includes('Report a problem') && r.text.includes('If you do not confirm or report a problem within 7 days'), 'handmade order actions in English');
r = await b('/account');
ok(r.text.includes('My account') && r.text.includes('Address book') && r.text.includes('Change password'), 'account page in English');
const s = client();
await s('/lang/en');
t = await s.csrf('/seller/login');
r = await s('/seller/login');
ok(r.text.includes('<html lang="th"') && r.text.includes('เข้าสู่ระบบผู้ขาย') && !r.text.includes('lang-switch'), 'seller portal stays Thai, no switch');
r = await b('/lang/th?back=/');
r = await b('/');
ok(r.text.includes('<html lang="th"') && r.text.includes('สินค้าทั้งหมด'), 'switch back to Thai');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
