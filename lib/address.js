// Buyer address book: Thai province → district → sub-district lookup, validation, formatting and saving.
// Address data: public/data/th-address.json (built from kongvut/thai-province-data, MIT; see th-address.LICENSE.txt).
const { db } = require('../db');
const DATA = require('../public/data/th-address.json');

const str = (v, n) => String(v || '').trim().slice(0, n);
const digits = s => String(s || '').replace(/\D/g, '');

// Lookup tables built once: province → { en, districts: Map(district → Map(subdistrict → zip)) }.
const TREE = new Map(DATA.provinces.map(([th, en, ds]) => [th, { en, districts: new Map(ds.map(([d, subs]) => [d, new Map(subs)])) }]));
const BANGKOK = 'กรุงเทพมหานคร';
const TH = {
  provinces: () => DATA.provinces.map(p => p[0]),
  districts: p => [...(TREE.get(p)?.districts.keys() || [])],
  subdistricts: (p, d) => [...(TREE.get(p)?.districts.get(d)?.keys() || [])],
  zip: (p, d, s) => TREE.get(p)?.districts.get(d)?.get(s) || '',
  // Bangkok uses เขต / แขวง, everywhere else อำเภอ / ตำบล.
  labels: p => (p === BANGKOK ? ['เขต', 'แขวง'] : ['อำเภอ', 'ตำบล']),
};

function readAddress(body) {
  const a = {
    name: str(body.a_name, 100), phone: digits(body.a_phone).slice(0, 15), line: str(body.a_line, 300),
    province: str(body.a_province, 60), district: str(body.a_district, 60), subdistrict: str(body.a_subdistrict, 60),
    postcode: digits(body.a_postcode).slice(0, 5),
  };
  const errors = [];
  if (a.name.length < 2) errors.push('ใส่ชื่อผู้รับ');
  if (a.phone.length < 9) errors.push('เบอร์โทรผู้รับไม่ถูกต้อง');
  if (a.line.length < 3) errors.push('ใส่บ้านเลขที่ ถนน หรือหมู่บ้าน');
  const [dl, sl] = TH.labels(a.province);
  if (!TREE.has(a.province)) errors.push('เลือกจังหวัด');
  else if (!TREE.get(a.province).districts.has(a.district)) errors.push(`เลือก${dl}`);
  else if (!TH.zip(a.province, a.district, a.subdistrict)) errors.push(`เลือก${sl}`);
  // Postcode is pre-filled from the sub-district but stays editable (some areas use a different post office code).
  if (a.postcode.length !== 5) errors.push('รหัสไปรษณีย์ต้องมี 5 หลัก');
  return { address: a, errors };
}

// One-line address for labels and order snapshots. Rows saved before district/sub-district existed only have line + province.
function format(a) {
  if (!a.district) return `${a.line} จ.${a.province} ${a.postcode}`;
  const area = a.province === BANGKOK
    ? `แขวง${a.subdistrict} เขต${a.district} ${BANGKOK}`
    : `ต.${a.subdistrict} อ.${a.district} จ.${a.province}`;
  return `${a.line} ${area} ${a.postcode}`;
}

function saveAddress(userId, a, makeDefault) {
  const first = !db.prepare('SELECT 1 FROM addresses WHERE user_id=?').get(userId);
  const isDefault = first || makeDefault ? 1 : 0;
  return db.transaction(() => {
    if (isDefault) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(userId);
    return db.prepare('INSERT INTO addresses(user_id,name,phone,line,subdistrict,district,province,postcode,is_default,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(userId, a.name, a.phone, a.line, a.subdistrict, a.district, a.province, a.postcode, isDefault, Date.now()).lastInsertRowid;
  })();
}

const listAddresses = userId => db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, created_at DESC').all(userId);
const myAddress = (userId, id) => db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(id, userId);

module.exports = { TH, readAddress, format, saveAddress, listAddresses, myAddress };
