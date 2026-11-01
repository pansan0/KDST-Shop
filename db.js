const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

fs.mkdirSync(path.join(cfg.DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(cfg.DATA_DIR, 'inkfold.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// v2 = marketplace (buyers, cart, shipments, handmade). v1 databases are not migrated: demo data only.
// v3 = handmade sellers ship themselves: prepaid transfer orders, stock, shop shipping fees, disputes, refunds.
const SCHEMA_VERSION = 3;
const version = db.pragma('user_version', { simple: true });
if (version < SCHEMA_VERSION && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='books'").get()) {
  console.error(`\nฐานข้อมูลใน ${cfg.DATA_DIR} เป็นเวอร์ชันเก่า (มีตาราง books)\nหยุดเซิร์ฟเวอร์ ลบหรือย้ายโฟลเดอร์ storage/ แล้วรันใหม่ ระบบจะสร้างข้อมูลตัวอย่างให้\n`);
  process.exit(1);
}

// orders and shipments are also rebuilt by the v3 migration below (their CHECK constraints changed).
const ORDERS_SQL = (name = 'orders') => `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  ship_name TEXT NOT NULL,
  ship_phone TEXT NOT NULL,
  ship_address TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cod' CHECK (method IN ('cod','transfer')),
  pay_status TEXT NOT NULL DEFAULT 'cod' CHECK (pay_status IN ('cod','awaiting','rejected','paid')),
  slip_file TEXT,
  slip_note TEXT DEFAULT '',
  paid_at INTEGER,
  items_total INTEGER NOT NULL,
  ship_total INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)`;
const SHIPMENTS_SQL = (name = 'shipments') => `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  fulfilled_by TEXT NOT NULL CHECK (fulfilled_by IN ('platform','seller')),
  seller_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK (status IN ('awaiting_payment','placed','in_production','preparing','shipped','delivered','released','problem','refunded','cancelled','returned')),
  items_total INTEGER NOT NULL,
  ship_fee INTEGER NOT NULL,
  prep_days INTEGER NOT NULL DEFAULT 0,      -- handmade: longest preparation time in this parcel
  carrier TEXT DEFAULT '',
  tracking TEXT DEFAULT '',
  note TEXT DEFAULT '',
  cancelled_by TEXT,
  due_at INTEGER NOT NULL,                  -- must be handed to the courier by this time
  paid_at INTEGER,
  shipped_at INTEGER,
  delivered_at INTEGER,                     -- buyer has it (delivered / received)
  released_at INTEGER,                      -- handmade: money moved from pending to withdrawable
  auto_note TEXT DEFAULT '',                -- set when the system moved the parcel on its own
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

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
  ship_first INTEGER NOT NULL DEFAULT 40,   -- handmade shop shipping: first piece
  ship_next INTEGER NOT NULL DEFAULT 10,    -- each extra piece
  ship_free_over INTEGER,                   -- free shipping at this shop subtotal (null = never)
  ship_from TEXT DEFAULT '',                -- sender address printed on labels
  refund_account TEXT DEFAULT '',           -- buyer: where to send refunds
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
  stock INTEGER,                            -- null = made to order (no stock count)
  ship_fee INTEGER NOT NULL DEFAULT 40,     -- unused since v3 (shop-level shipping)
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

${ORDERS_SQL()};

${SHIPMENTS_SQL()};
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
  note TEXT DEFAULT '',                     -- buyer's custom-order message
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

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('not_received','damaged','wrong')),
  detail TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','refund','release')),
  decision_note TEXT DEFAULT '',
  admin_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS disputes_shipment ON disputes(shipment_id);

-- Money owed back to buyers. No bank link: admin transfers by hand and records the reference, like payouts.
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  shipment_id INTEGER REFERENCES shipments(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  ref TEXT DEFAULT '',
  admin_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);
`);
/* ---------- migrations for databases created by older versions (keep their data) ---------- */
const hasCol = (t, c) => db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c);
const addCol = (t, c, def) => { if (!hasCol(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
addCol('products', 'cover_pdf', 'TEXT');
addCol('addresses', 'district', "TEXT NOT NULL DEFAULT ''");
addCol('addresses', 'subdistrict', "TEXT NOT NULL DEFAULT ''");
// v3
addCol('products', 'stock', 'INTEGER');
addCol('users', 'ship_first', 'INTEGER NOT NULL DEFAULT 40');
addCol('users', 'ship_next', 'INTEGER NOT NULL DEFAULT 10');
addCol('users', 'ship_free_over', 'INTEGER');
addCol('users', 'ship_from', "TEXT DEFAULT ''");
addCol('users', 'refund_account', "TEXT DEFAULT ''");
addCol('order_items', 'note', "TEXT DEFAULT ''");
addCol('payouts', 'slip_file', 'TEXT'); // transfer slip the admin attaches when paying a seller

// SQLite cannot change a CHECK constraint in place, so orders and shipments are rebuilt (copy → drop → rename).
// A copy of the whole database is written next to it first.
const tableSql = t => db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t)?.sql || '';
function rebuild(table, makeSql) {
  const oldCols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map(r => r.name);
  db.exec(makeSql(`${table}_v3`));
  const newCols = new Set(db.prepare(`SELECT name FROM pragma_table_info('${table}_v3')`).all().map(r => r.name));
  const cols = oldCols.filter(c => newCols.has(c)).join(',');
  db.exec(`INSERT INTO ${table}_v3 (${cols}) SELECT ${cols} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_v3 RENAME TO ${table};`);
}
const needOrders = !tableSql('orders').includes("'transfer'");
const needShipments = !tableSql('shipments').includes("'awaiting_payment'");
if (needOrders || needShipments) {
  const backup = path.join(cfg.DATA_DIR, `inkfold.before-v3-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`[db] อัปเกรดฐานข้อมูลเป็น v3 (สำรองไว้ที่ ${backup})`);
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    if (needOrders) rebuild('orders', ORDERS_SQL);
    if (needShipments) rebuild('shipments', SHIPMENTS_SQL);
    db.exec(`CREATE INDEX IF NOT EXISTS shipments_order ON shipments(order_id);
             CREATE INDEX IF NOT EXISTS shipments_seller ON shipments(seller_id);
             CREATE INDEX IF NOT EXISTS shipments_status ON shipments(status);`);
    const bad = db.pragma('foreign_key_check');
    if (bad.length) throw new Error('foreign key check failed after v3 migration: ' + JSON.stringify(bad.slice(0, 3)));
  })();
  db.pragma('foreign_keys = ON');
}
db.pragma(`user_version = ${SCHEMA_VERSION}`);

const DEFAULT_SETTINGS = {
  store_name: 'KDST Shop',
  shipping: '50',       // flat fee per Inkfold (KDP) shipment
  hm_fee_pct: '15',     // marketplace fee on handmade items
  cod_limit: '3000',    // max COD order total
  return_limit: '2',    // refused COD parcels before COD is blocked for a buyer
  promptpay: '081-234-5678',               // where buyers transfer (orders with handmade items)
  account_name: 'KDST Shop (บัญชีตัวอย่าง)',
  release_days: '7',       // handmade: money released this many days after the tracking number, if no problem is reported
  late_alert_days: '2',    // flag a handmade parcel to admin this many days after its ship-by date
  auto_cancel_days: '5',   // cancel + refund a handmade parcel still not shipped this many days after its ship-by date
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

// Seller money. Handmade sellers also keep the shipping fee of parcels they ship.
//   earned  (ถอนได้)  books and legacy COD handmade: delivered · prepaid handmade: released
//   pending (รอปล่อย) prepaid handmade that is paid but not released yet: preparing / shipped / problem
// Refunded and cancelled parcels count for nothing. balance = earned − payouts.
const EARNED = "s.status IN ('delivered','released')";
const PENDING = "s.status IN ('preparing','shipped','problem') AND o.method='transfer'";
function sellerStats(sellerId) {
  const items = where => db.prepare(`SELECT COALESCE(SUM(i.qty),0) units, COALESCE(SUM(i.qty*i.earn_unit),0) amt
      FROM order_items i JOIN shipments s ON s.id=i.shipment_id JOIN orders o ON o.id=s.order_id WHERE i.seller_id=? AND ${where}`).get(sellerId);
  const fees = where => db.prepare(`SELECT COALESCE(SUM(s.ship_fee),0) amt FROM shipments s JOIN orders o ON o.id=s.order_id
      WHERE s.seller_id=? AND s.fulfilled_by='seller' AND ${where}`).get(sellerId).amt;
  const r2 = n => Math.round(n * 100) / 100;
  const done = items(EARNED), wait = items(PENDING);
  const p = db.prepare('SELECT COALESCE(SUM(amount),0) paid FROM payouts WHERE seller_id=?').get(sellerId);
  const earned = r2(done.amt + fees(EARNED));
  return { units: done.units, earned, pending: r2(wait.amt + fees(PENDING)), paid: p.paid, balance: r2(earned - p.paid) };
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
