const B = process.env.BASE; let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function client() { const jar = new Map(); const c = async (p, { method = 'GET', form } = {}) => {
  const r = await fetch(B + p, { method, redirect: 'manual', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
  for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return { status: r.status, loc: r.headers.get('location'), text: await r.text() }; };
  c.login = async (area, email, pw) => { const t = (await c(`/${area}/login`)).text.match(/name="_csrf" value="([^"]+)"/)[1]; await c(`/${area}/login`, { method: 'POST', form: { _csrf: t, email, password: pw } }); c.t = (await c(`/${area}`)).text.match(/name="_csrf" value="([^"]+)"/)?.[1] || (await c(`/${area}/orders`)).text.match(/name="_csrf" value="([^"]+)"/)[1]; };
  return c; }
const ad = client(); await ad.login('admin', 'admin@inkfold.local', 'admin12345');
let r = await ad('/admin/orders?tab=platform');
// find a platform parcel in production, or start one
let id = r.text.match(/\/admin\/shipments\/(\d+)\/ship/)?.[1];
if (!id) { const st = r.text.match(/\/admin\/shipments\/(\d+)\/start/)[1]; await ad(`/admin/shipments/${st}/start`, { method: 'POST', form: { _csrf: ad.t } }); r = await ad('/admin/orders?tab=platform'); id = r.text.match(/\/admin\/shipments\/(\d+)\/ship/)[1]; }
const form = r.text.slice(r.text.indexOf(`/admin/shipments/${id}/ship`)).split('</form>')[0];
ok(/name="carrier" value="flash"/.test(form) && form.includes('/static/img/carriers/') && form.includes('name="carrier_other"'), 'admin ship form has carrier chips with logos + other');
ok(r.text.includes('/static/js/ship-form.js'), 'ship-form.js loaded on admin orders');
r = await ad(`/admin/shipments/${id}/ship`, { method: 'POST', form: { _csrf: ad.t, tracking: 'NOCARRIER1' } });
r = await ad('/admin/orders?tab=platform');
ok(r.text.includes('เลือกบริษัทขนส่ง') && !r.text.includes('NOCARRIER1'), 'ship without carrier is refused');
await ad(`/admin/shipments/${id}/ship`, { method: 'POST', form: { _csrf: ad.t, carrier: 'other', carrier_other: '', tracking: 'NOCARRIER2' } });
r = await ad('/admin/orders?tab=all');
ok(!r.text.includes('NOCARRIER2'), '"other" without a name is refused');
await ad(`/admin/shipments/${id}/ship`, { method: 'POST', form: { _csrf: ad.t, carrier: 'flash', tracking: 'KDSTFL777' } });
r = await ad('/admin/orders?tab=all');
const cell = r.text.slice(r.text.indexOf('KDSTFL777') - 600, r.text.indexOf('KDSTFL777'));
ok(r.text.includes('KDSTFL777') && cell.includes('Flash Express') && cell.includes('carriers/'), 'shipped with Flash Express, logo shown to admin');
const bu = client(); await bu.login('account', 'demo@buyer.local', 'buyer12345');
let found = false;
for (const code of (await bu('/account/orders')).text.match(/IF-[0-9A-Z]+/g)) { const p = (await bu(`/account/orders/${code}`)).text; if (p.includes('KDSTFL777')) { found = p.includes('Flash Express'); break; } }
ok(found, 'buyer sees carrier name with tracking number');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
