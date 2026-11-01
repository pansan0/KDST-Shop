const B = process.env.BASE; let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function client() { const jar = new Map(); const c = async (p, { method = 'GET', form, multipart } = {}) => {
  let body, headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (form) { body = new URLSearchParams(form); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  if (multipart) { body = new FormData(); for (const [k, v] of Object.entries(multipart)) Array.isArray(v) ? body.append(k, v[0], v[1]) : body.append(k, v); }
  const r = await fetch(B + p, { method, redirect: 'manual', headers, body });
  for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return { status: r.status, loc: r.headers.get('location'), type: r.headers.get('content-type'), text: await r.text() }; };
  c.login = async (area, email, pw) => { const t = (await c(`/${area}/login`)).text.match(/name="_csrf" value="([^"]+)"/)[1]; await c(`/${area}/login`, { method: 'POST', form: { _csrf: t, email, password: pw } }); };
  return c; }
const png = () => [new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'slip.png'];
const txt = () => [new Blob(['hello'], { type: 'text/plain' }), 'x.txt'];
const ad = client(); await ad.login('admin', 'admin@inkfold.local', 'admin12345');
let r = await ad('/admin/payouts');
const t = r.text.match(/_csrf=([^"&]+)"/)?.[1];
const sellerId = r.text.match(/name="seller_id" value="(\d+)"/)?.[1];
const bal = Number(r.text.match(/name="amount"[^>]*value="([\d.]+)"/)?.[1]);
ok(t && sellerId && bal > 0 && r.text.includes('name="payout_slip"') && r.text.includes('enctype="multipart/form-data"'), 'payout form takes a slip file');
await ad(`/admin/payouts?_csrf=${t}`, { method: 'POST', multipart: { seller_id: sellerId, amount: '1', ref: 'BADTYPE', payout_slip: txt() } });
r = await ad('/admin/payouts');
ok(r.text.includes('ชนิดไฟล์ไม่ถูกต้อง') && !r.text.includes('BADTYPE'), 'wrong file type refused, nothing recorded');
await ad(`/admin/payouts?_csrf=${t}`, { method: 'POST', multipart: { seller_id: sellerId, amount: String(bal + 999), ref: 'TOOMUCH', payout_slip: png() } });
r = await ad('/admin/payouts');
ok(r.text.includes('ยอดเกินที่ค้างจ่าย') && !r.text.includes('TOOMUCH'), 'over-balance refused even with a slip');
await ad(`/admin/payouts?_csrf=${t}`, { method: 'POST', multipart: { seller_id: sellerId, amount: '1', ref: 'NOSLIP' } });
await ad(`/admin/payouts?_csrf=${t}`, { method: 'POST', multipart: { seller_id: sellerId, amount: '2', ref: 'WITHSLIP', payout_slip: png() } });
r = await ad('/admin/payouts');
const ids = [...r.text.matchAll(/\/files\/payout\/(\d+)/g)].map(m => m[1]);
ok(r.text.includes('พร้อมสลิป') && r.text.includes('NOSLIP') && r.text.includes('WITHSLIP') && ids.length === 1, 'payout recorded with slip; one without');
const pid = ids[0];
let f = await ad(`/files/payout/${pid}`);
ok(f.status === 200 && f.type.startsWith('image/png'), 'admin can open the slip');
await ad(`/admin/payouts?_csrf=no`, { method: 'POST', multipart: { seller_id: sellerId, amount: '1', ref: 'NOCSRF' } });
ok(!(await ad('/admin/payouts')).text.includes('NOCSRF'), 'CSRF required');
const later = [...r.text.matchAll(/\/admin\/payouts\/(\d+)\/slip/g)].map(m => m[1]).find(id => id !== pid);
await ad(`/admin/payouts/${later}/slip?_csrf=${t}`, { method: 'POST', multipart: { payout_slip: png() } });
r = await ad('/admin/payouts');
ok([...r.text.matchAll(/\/files\/payout\/(\d+)/g)].length === 2 && r.text.includes('แนบสลิปแล้ว'), 'slip attached later from history');
// who can see it
const owner = (await (async () => { const db = r.text; return db; })());
const sellers = { 2: ['demo@seller.local'], 3: ['demo@handmade.local'], 7: ['demo@handmade2.local'] };
const me = client(); await me.login('seller', sellers[sellerId][0], 'seller12345');
r = await me('/seller/sales');
ok(r.text.includes(`/files/payout/${pid}`) && r.text.includes('ดูสลิป'), 'seller sees slip link in sales');
f = await me(`/files/payout/${pid}`);
ok(f.status === 200, 'seller opens own payout slip');
const other = client(); await other.login('seller', sellerId === '3' ? 'demo@handmade2.local' : 'demo@handmade.local', 'seller12345');
ok((await other(`/files/payout/${pid}`)).status === 404, 'other seller cannot open it');
const buyer = client(); await buyer.login('account', 'demo@buyer.local', 'buyer12345');
ok((await buyer(`/files/payout/${pid}`)).status === 404 && (await client()(`/files/payout/${pid}`)).status === 404, 'buyer and guests cannot open it');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
