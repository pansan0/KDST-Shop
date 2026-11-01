// Time-based rules for handmade parcels (all day counts come from admin settings):
//   release_days      shipped, no problem reported → money released to the shop
//                     (prepaid book parcels the buyer never confirmed count as delivered after the same wait)
//   auto_cancel_days  still not shipped this long after the ship-by date → cancelled, refund queued, stock returned
// (late_alert_days only flags parcels on admin pages; see lateCutoff.)
// Runs on startup, every few minutes, and (throttled) when admin/seller/buyer pages load.
const { db, getSettings } = require('../db');
const C = require('./catalog');
const ORD = require('./orders');

const days = (settings, key, d) => Math.max(0, Number(settings[key] ?? d));
const lateCutoff = (now = Date.now()) => now - days(getSettings(), 'late_alert_days', 2) * C.DAY;

function runJobs(now = Date.now()) {
  const st = getSettings();
  const out = { released: 0, cancelled: 0, delivered: 0 };
  const releaseDays = days(st, 'release_days', 7), cancelDays = days(st, 'auto_cancel_days', 5);
  const toRelease = db.prepare(`${ORD.SHIP_SELECT} WHERE s.status='shipped' AND s.fulfilled_by='seller' AND o.method='transfer' AND s.shipped_at<?`)
    .all(now - releaseDays * C.DAY);
  for (const s of toRelease) {
    const r = ORD.moveShipment('system', 0, s.id, 'release', { auto: `ปล่อยเงินอัตโนมัติ: ครบ ${releaseDays} วันหลังจัดส่งโดยไม่มีการแจ้งปัญหา` });
    if (!r.error) out.released++;
  }
  const toDeliver = db.prepare(`${ORD.SHIP_SELECT} WHERE s.status='shipped' AND s.fulfilled_by='platform' AND o.method='transfer' AND s.shipped_at<?`)
    .all(now - releaseDays * C.DAY);
  for (const s of toDeliver) {
    const r = ORD.moveShipment('system', 0, s.id, 'receive', { auto: `ยืนยันได้รับอัตโนมัติ: ครบ ${releaseDays} วันหลังจัดส่ง` });
    if (!r.error) out.delivered++;
  }
  const toCancel = db.prepare(`${ORD.SHIP_SELECT} WHERE s.status='preparing' AND s.due_at<?`).all(now - cancelDays * C.DAY);
  for (const s of toCancel) {
    const note = `ยกเลิกอัตโนมัติ: ร้านไม่ส่งพัสดุภายใน ${cancelDays} วันหลังวันกำหนดส่ง ระบบจะคืนเงินให้`;
    const r = ORD.moveShipment('system', 0, s.id, 'cancel', { note, auto: note });
    if (!r.error) out.cancelled++;
  }
  if (out.released || out.cancelled || out.delivered) console.log(`[jobs] ปล่อยเงิน ${out.released} พัสดุ · หนังสือยืนยันได้รับ ${out.delivered} พัสดุ · ยกเลิกอัตโนมัติ ${out.cancelled} พัสดุ`);
  return out;
}

let last = 0;
// Express middleware: run at most once a minute when someone opens a page.
const jobsOnRequest = (req, res, next) => {
  if (Date.now() - last > 60e3) { last = Date.now(); try { runJobs(); } catch (e) { console.error('[jobs]', e); } }
  next();
};
function startJobs() {
  try { runJobs(); } catch (e) { console.error('[jobs]', e); }
  setInterval(() => { try { runJobs(); last = Date.now(); } catch (e) { console.error('[jobs]', e); } }, 10 * 60e3).unref();
}

module.exports = { runJobs, startJobs, jobsOnRequest, lateCutoff };
