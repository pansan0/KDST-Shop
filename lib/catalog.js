// Labels, pricing rules, review checklists and status maps shared by routes and views.
const KINDS = { kdp: 'หนังสือพิมพ์ตามสั่ง', handmade: 'งาน Handmade' };

// Category keys must be unique across both kinds (the storefront filters on one `cat` param).
const CATS = {
  coloring: 'สมุดระบายสี', story: 'นิทาน', novel: 'นวนิยาย', short: 'เรื่องสั้น / รวมเรื่อง', comic: 'การ์ตูน', nonfiction: 'หนังสือความรู้',
  activity: 'หนังสือกิจกรรม', journal: 'สมุดบันทึก / แพลนเนอร์', sketch: 'สมุดสเก็ตช์',
};
const HM_CATS = { jewelry: 'เครื่องประดับ', home: 'ของตกแต่งบ้าน', bags: 'กระเป๋าและงานผ้า', paper: 'งานกระดาษทำมือ', toys: 'ตุ๊กตาและของเล่น' };
const ALL_CATS = { ...CATS, ...HM_CATS };

const AGES = { '3-5': '3–5 ปี', '6-9': '6–9 ปี', '10-12': '10–12 ปี', teen: 'วัยรุ่น', adult: 'ผู้ใหญ่', all: 'ทุกวัย' };
const TRIMS = { '8.5x11': '8.5 × 11 นิ้ว (Letter)', A4: 'A4 · 210 × 297 มม.', '8x10': '8 × 10 นิ้ว', '6x9': '6 × 9 นิ้ว' };
const PAPER = { white: 'กระดาษขาว 100 แกรม', cream: 'กระดาษถนอมสายตา 80 แกรม' };
const FINISH = { matte: 'ปกด้าน', glossy: 'ปกมัน' };
const INTERIOR = { bw: 'ขาวดำ', color: 'สี่สี' };

const MADE_BY = { solo: 'ทำเองคนเดียว', team: 'ทีมเล็ก (ไม่เกิน 20 คน)' };
const METHOD = { handmade: 'ทำมือทั้งชิ้น', assembled: 'ประกอบด้วยมือ', altered: 'ดัดแปลงด้วยมือ' };
const OPTION_TYPES = { select: 'เลือกหนึ่งค่า', swatch: 'เลือกสี', text: 'ข้อความ', range: 'ตัวเลขช่วง' };

const PRODUCT_STATUS = {
  draft: ['ร่าง', 'neutral'], pending: ['รอตรวจ', 'warn'], approved: ['วางขายแล้ว', 'good'],
  changes: ['ต้องแก้ไข', 'warn'], rejected: ['ไม่อนุมัติ', 'bad'], suspended: ['ถูกระงับ', 'bad'], archived: ['ปิดการขาย', 'neutral'],
};
const APP_STATUS = { none: ['ยังไม่สมัคร', 'neutral'], applied: ['รอพิจารณา', 'warn'], approved: ['อนุมัติแล้ว', 'good'], rejected: ['ไม่ผ่าน', 'bad'] };

// One order is split into shipments: Inkfold ships every KDP book, each handmade seller ships their own items.
const SHIP_STATUS = {
  placed: ['รอดำเนินการ', 'warn'], in_production: ['กำลังผลิต', 'info'], shipped: ['จัดส่งแล้ว', 'info'],
  delivered: ['ได้รับแล้ว · เก็บเงินแล้ว', 'good'], cancelled: ['ยกเลิกแล้ว', 'bad'], returned: ['ตีกลับ', 'bad'],
};
const shipStatus = s => {
  if (s.status === 'in_production') return [s.fulfilled_by === 'platform' ? 'กำลังพิมพ์' : 'กำลังทำ', 'info'];
  return SHIP_STATUS[s.status] || [s.status, 'neutral'];
};
const SHIP_STEP = { placed: 1, in_production: 2, shipped: 3, delivered: 4, cancelled: 0, returned: 0 };
const OPEN_SHIP = ['placed', 'in_production', 'shipped'];

// Review checklists. KDP follows print-file specs + KDP content guidelines; handmade follows
// Amazon Handmade / Etsy listing rules and EU/US/TH product-safety limits (seller declares, admin checks evidence).
const CHECKS = [
  ['trim', 'ขนาดหน้าตรงกับที่ระบุ และเผื่อระยะตัดตก (bleed) 3 มม.'],
  ['pages', 'จำนวนหน้าในไฟล์ตรงกับที่กรอก (ขั้นต่ำ 24 หน้า)'],
  ['lines', 'ลายเส้นคมชัด 300 dpi ไม่แตกเป็นพิกเซล ไม่มีพื้นเทาจากการสแกน'],
  ['margin', 'เส้นและข้อความอยู่ในระยะปลอดภัย 6 มม. จากขอบ'],
  ['ip', 'ไม่มีตัวละคร โลโก้ หรือภาพติดลิขสิทธิ์ของผู้อื่น'],
  ['cover', 'ปกอ่านชื่อเรื่องได้ชัด และตรงกับเนื้อใน'],
  ['age', 'เนื้อหาเหมาะกับช่วงอายุที่ระบุ'],
  ['content', 'ไม่ใช่เนื้อหาที่ทำให้ผู้อ่านผิดหวัง (หน้าว่างโดยไม่บอก, ก็อปงาน public domain โดยไม่เพิ่มคุณค่า)'],
  ['ai_disclosed', 'เปิดเผยการใช้ภาพ AI ตามจริง'],
];
const HM_CHECKS = [
  ['accurate', 'ชื่อ คำอธิบาย และรูปตรงกับของจริง ไม่ยัดคำค้น ไม่อ้างสรรพคุณเกินจริง'],
  ['main_image', 'รูปหลักพื้นขาว สินค้าเต็มกรอบราว 85% ด้านยาว ≥ 1000 px ไม่มีลายน้ำหรือข้อความทับ'],
  ['ip', 'ไม่ละเมิดลิขสิทธิ์หรือเครื่องหมายการค้า (ตัวละคร โลโก้แบรนด์)'],
  ['prohibited', 'ไม่ใช่สินค้าต้องห้าม เช่น ชิ้นส่วนสัตว์คุ้มครองตาม CITES (งาช้าง กระดองเต่า ปะการัง)'],
  ['materials', 'ระบุวัสดุครบและตรงจริง คำอ้างโลหะมีค่า (เงิน 925 / ทองแท้) เป็นจริง'],
  ['handmade', 'เป็นงานทำ ประกอบ หรือดัดแปลงด้วยมือของผู้ขายจริง ไม่ใช่ของโรงงานซื้อมาขายต่อ / dropship'],
  ['lead', 'ระยะเวลาผลิตและกำลังผลิตต่อสัปดาห์สมเหตุสมผล'],
  ['options', 'ตัวเลือกคัสตอมมีขอบเขตชัด (ความยาวข้อความ ช่วงขนาด) และไม่มีข้อความที่ละเมิดผู้อื่น'],
];
const HM_CHECKS_METAL = [['metal', 'โลหะที่สัมผัสผิวนาน: นิกเกิลปล่อย ≤ 0.5 µg/cm²/สัปดาห์, ตะกั่ว < 0.05%, แคดเมียม < 0.01% (EU REACH Annex XVII) มีเอกสารหรือคำยืนยันจากผู้ขาย']];
const HM_CHECKS_KIDS = [['kids', 'สินค้าเด็ก: ตะกั่วในวัสดุ ≤ 100 ppm (US CPSIA) · ชิ้นส่วนเล็กติดคำเตือน "ไม่เหมาะกับเด็กต่ำกว่า 3 ปี" (EN 71-1 / 16 CFR 1501)']];
function checksFor(p) {
  if (p.kind !== 'handmade') return CHECKS;
  return [...HM_CHECKS, ...(p.metal ? HM_CHECKS_METAL : []), ...(p.for_kids || p.small_parts ? HM_CHECKS_KIDS : [])];
}

// KDP pricing: seller earns price × 60% − print cost. Keep in sync with public/js/book-form.js.
const ROYALTY = 0.6;
const MIN_PAGES = 24;
const MAX_PAGES = 600;
const PRINT = { bwPerPage: 0.45, colorPerPage: 2.2, base: 28, baseSmall: 20 };
const round2 = n => Math.round(n * 100) / 100;

function printCost(b) {
  const per = b.interior === 'color' ? PRINT.colorPerPage : PRINT.bwPerPage;
  const base = b.trim === '6x9' ? PRINT.baseSmall : PRINT.base;
  return round2(base + per * (Number(b.pages) || 0));
}
const royaltyUnit = b => round2((Number(b.price) || 0) * ROYALTY - printCost(b));
const minPrice = b => Math.ceil(printCost(b) / ROYALTY) + 1;
// Handmade: seller earns (price + option extras) minus the marketplace fee (percent, from settings).
const handmadeEarn = (unitPrice, feePct) => round2(unitPrice * (1 - feePct / 100));
const earnUnit = (p, unitPrice, feePct) => (p.kind === 'kdp' ? royaltyUnit(p) : handmadeEarn(unitPrice, feePct));

const thb = n => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const dt = t => (t ? new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '–');
const day = t => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
const DAY = 864e5;

// Every product is made to order. Buyers are always told to expect 7–14 days for production + delivery,
// so a handmade seller's production time is capped to leave room for shipping.
const WAIT = { min: 7, max: 14, text: 'รอผลิตและจัดส่ง 7–14 วัน' };
const MAX_LEAD_DAYS = 10;
const waitRange = from => [from + WAIT.min * DAY, from + WAIT.max * DAY];

module.exports = {
  KINDS, CATS, HM_CATS, ALL_CATS, AGES, TRIMS, PAPER, FINISH, INTERIOR, MADE_BY, METHOD, OPTION_TYPES,
  PRODUCT_STATUS, APP_STATUS, SHIP_STATUS, SHIP_STEP, OPEN_SHIP, shipStatus,
  CHECKS, HM_CHECKS, checksFor,
  ROYALTY, MIN_PAGES, MAX_PAGES, PRINT, printCost, royaltyUnit, minPrice, handmadeEarn, earnUnit, round2,
  thb, dt, day, DAY, WAIT, MAX_LEAD_DAYS, waitRange,
};
