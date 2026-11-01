const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

fs.mkdirSync(path.join(cfg.DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(cfg.DATA_DIR, 'inkfold.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// v2 = marketplace (buyers, cart, shipments, handmade). v1 databases are not migrated: demo data only.
const SCHEMA_VERSION = 2;
const version = db.pragma('user_version', { simple: true });
if (version < SCHEMA_VERSION && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='books'").get()) {
  console.error(`\nฐานข้อมูลใน ${cfg.DATA_DIR} เป็นเวอร์ชันเก่า (มีตาราง books)\nหยุดเซิร์ฟเวอร์ ลบหรือย้ายโฟลเดอร์ storage/ แล้วรันใหม่ ระบบจะสร้างข้อมูลตัวอย่างให้\n`);
  process.exit(1);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin','seller','buyer')),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  payout_account TEXT DEFAULT '',
  payout_name TEXT DEFAULT '',
  payout_bank TEXT DEFAULT '',
  handmade_status TEXT NOT NULL DEFAULT 'none' CHECK (handmade_status IN ('none','applied','approved','rejected')),
  cod_blocked INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('kdp','handmade')),
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  age TEXT NOT NULL DEFAULT 'all',
  price INTEGER NOT NULL DEFAULT 199,
  keywords TEXT DEFAULT '',
  cover_file TEXT,          -- image shown in the store (JPG/PNG)
  cover_pdf TEXT,           -- KDP print cover when the seller uploads it as PDF
  preview_files TEXT NOT NULL DEFAULT '[]',
  -- KDP print spec
  trim TEXT NOT NULL DEFAULT '8.5x11',
  pages INTEGER NOT NULL DEFAULT 48,
  interior TEXT NOT NULL DEFAULT 'bw',
  paper TEXT NOT NULL DEFAULT 'white',
  finish TEXT NOT NULL DEFAULT 'matte',
  ai INTEGER NOT NULL DEFAULT 0,
  pdf_file TEXT,
  pdf_name TEXT,
  pdf_size INTEGER,
  -- handmade
  materials TEXT DEFAULT '',
  made_by TEXT NOT NULL DEFAULT 'solo',
  method TEXT NOT NULL DEFAULT 'handmade',
  lead_days INTEGER NOT NULL DEFAULT 3,
  weekly_capacity INTEGER NOT NULL DEFAULT 20,
  ship_fee INTEGER NOT NULL DEFAULT 40,
  metal INTEGER NOT NULL DEFAULT 0,
  for_kids INTEGER NOT NULL DEFAULT 0,
  small_parts INTEGER NOT NULL DEFAULT 0,
  options TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','approved','changes','rejected','suspended','archived')),
  rev INTEGER NOT NULL DEFAULT 0,
  palette INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS products_status ON products(status);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL,
  note TEXT DEFAULT '',
  checks TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_applications (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  about TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','approved','rejected')),
  note TEXT DEFAULT '',
  admin_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  line TEXT NOT NULL,                 -- house no., road, village
  subdistrict TEXT NOT NULL DEFAULT '',  -- ตำบล / แขวง
  district TEXT NOT NULL DEFAULT '',     -- อำเภอ / เขต
  province TEXT NOT NULL,
  postcode TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  added_at INTEGER NOT NULL,
  UNIQUE (buyer_id, product_id, options)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  ship_name TEXT NOT NULL,
  ship_phone TEXT NOT NULL,
  ship_address TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cod' CHECK (method IN ('cod')),
  items_total INTEGER NOT NULL,
  ship_total INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  fulfilled_by TEXT NOT NULL CHECK (fulfilled_by IN ('platform','seller')),
  seller_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed','in_production','shipped','delivered','cancelled','returned')),
  items_total INTEGER NOT NULL,
  ship_fee INTEGER NOT NULL,
  tracking TEXT DEFAULT '',
  note TEXT DEFAULT '',
  cancelled_by TEXT,
  due_at INTEGER NOT NULL,
  shipped_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS shipments_seller ON shipments(seller_id);
CREATE INDEX IF NOT EXISTS shipments_status ON shipments(status);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  earn_unit REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_seller ON order_items(seller_id);
CREATE INDEX IF NOT EXISTS order_items_shipment ON order_items(shipment_id);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  ref TEXT DEFAULT '',
  note TEXT DEFAULT '',
  admin_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);
`);
// Columns added after v2 shipped (keep existing data).
const hasCol = (t, c) => db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c);
if (!hasCol('products', 'cover_pdf')) db.exec('ALTER TABLE products ADD COLUMN cover_pdf TEXT');
if (!hasCol('addresses', 'district')) db.exec("ALTER TABLE addresses ADD COLUMN district TEXT NOT NULL DEFAULT ''");
if (!hasCol('addresses', 'subdistrict')) db.exec("ALTER TABLE addresses ADD COLUMN subdistrict TEXT NOT NULL DEFAULT ''");
db.pragma(`user_version = ${SCHEMA_VERSION}`);

const DEFAULT_SETTINGS = {
  store_name: 'Inkfold',
  shipping: '50',       // flat fee per Inkfold (KDP) shipment
  hm_fee_pct: '15',     // marketplace fee on handmade items
  cod_limit: '3000',    // max COD order total
  return_limit: '2',    // refused COD parcels before COD is blocked for a buyer
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

// Seller earnings count once a shipment is delivered (COD collected). Handmade sellers also keep the shipping fee they charged.
function sellerStats(sellerId) {
  const s = db.prepare(`SELECT COALESCE(SUM(i.qty),0) units, COALESCE(SUM(i.qty*i.earn_unit),0) earned
                        FROM order_items i JOIN shipments s ON s.id=i.shipment_id
                        WHERE i.seller_id=? AND s.status='delivered'`).get(sellerId);
  const f = db.prepare(`SELECT COALESCE(SUM(ship_fee),0) fees FROM shipments WHERE seller_id=? AND fulfilled_by='seller' AND status='delivered'`).get(sellerId);
  const p = db.prepare('SELECT COALESCE(SUM(amount),0) paid FROM payouts WHERE seller_id=?').get(sellerId);
  const earned = Math.round((s.earned + f.fees) * 100) / 100;
  return { units: s.units, earned, paid: p.paid, balance: Math.round((earned - p.paid) * 100) / 100 };
}

// Seller performance (Amazon-style): late shipment, seller-cancel and refusal rates over their own shipments.
function sellerMetrics(sellerId) {
  const m = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN shipped_at IS NOT NULL THEN 1 ELSE 0 END) shipped,
      SUM(CASE WHEN shipped_at > due_at THEN 1 ELSE 0 END) late,
      SUM(CASE WHEN status='cancelled' AND cancelled_by='seller' THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN status='returned' THEN 1 ELSE 0 END) returned
    FROM shipments WHERE seller_id=? AND fulfilled_by='seller'`).get(sellerId);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return { total: m.total, late: pct(m.late, m.shipped), cancelled: pct(m.cancelled, m.total), returned: pct(m.returned, m.shipped) };
}

module.exports = { db, getSettings, setSetting, sellerStats, sellerMetrics };
