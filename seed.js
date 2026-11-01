// Creates the first admin (from .env) and, if SEED_DEMO is on, demo sellers (KDP + 2 handmade shops), a buyer, products and orders.
const bcrypt = require('bcryptjs');
const cfg = require('./config');
const { db } = require('./db');
const C = require('./lib/catalog');

const BRACELET_OPTIONS = [
  { id: 'o0', type: 'select', label: 'ขนาดข้อมือ', required: true, values: [{ label: 'S 15 ซม.', price: 0, color: '' }, { label: 'M 16.5 ซม.', price: 0, color: '' }, { label: 'L 18 ซม.', price: 10, color: '' }] },
  { id: 'o1', type: 'swatch', label: 'สีลูกปัด', required: true, values: [{ label: 'ชมพูพาสเทล', price: 0, color: '#f6b8c8' }, { label: 'ฟ้าน้ำทะเล', price: 0, color: '#9fd3e8' }, { label: 'ขาวมุก', price: 15, color: '#f4efe6' }, { label: 'เขียวมิ้นต์', price: 0, color: '#a8dfc4' }] },
  { id: 'o2', type: 'text', label: 'ตัวอักษรบนลูกปัด', required: false, max_len: 8, charset: 'upper', price: 30 },
];

function seedBase() {
  const now = Date.now();
  if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
    db.prepare(`INSERT INTO users(role,email,password_hash,display_name,created_at) VALUES ('admin',?,?,?,?)`)
      .run(cfg.ADMIN_EMAIL.toLowerCase(), bcrypt.hashSync(cfg.ADMIN_PASSWORD, 12), 'ผู้ดูแลระบบ', now);
    console.log(`[seed] สร้างแอดมินแรก: ${cfg.ADMIN_EMAIL} (เปลี่ยนรหัสผ่านใน .env ก่อนใช้งานจริง)`);
  }
  if (!cfg.SEED_DEMO || db.prepare("SELECT 1 FROM users WHERE email='demo@seller.local'").get()) return;

  const adminId = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get().id;
  const user = (role, email, pw, name, phone, extra = {}) => db.prepare(`INSERT INTO users(role,email,password_hash,display_name,phone,payout_account,payout_name,handmade_status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(role, email, bcrypt.hashSync(pw, 12), name, phone, extra.payout || '', extra.payoutName || '', extra.hm || 'none', now - 30 * C.DAY).lastInsertRowid;

  const kdpSeller = user('seller', 'demo@seller.local', 'seller12345', 'ครูมะปราง (ร้านตัวอย่าง)', '0891112222', { payout: '089-111-2222', payoutName: 'มะปราง ใจดี' });
  const hmSeller = user('seller', 'demo@handmade.local', 'seller12345', 'มะลิทำมือ (ร้านตัวอย่าง)', '0863334444', { payout: '086-333-4444', payoutName: 'มะลิ รักงานฝีมือ', hm: 'approved' });
  const buyer = user('buyer', 'demo@buyer.local', 'buyer12345', 'สมใจ ใจดี (ลูกค้าตัวอย่าง)', '0890000000');

  db.prepare("INSERT INTO seller_applications(seller_id,about,images,status,note,admin_id,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(hmSeller, 'ร้อยลูกปัดเองที่บ้านทุกเส้น ใช้ลูกปัดแก้วและเชือกยางยืดคุณภาพดี สลักชื่อด้วยลูกปัดอักษรอะคริลิก (ข้อมูลตัวอย่าง)', '[]', 'approved', 'ข้อมูลตัวอย่าง', adminId, now - 20 * C.DAY, now - 19 * C.DAY);
  db.prepare('INSERT INTO addresses(user_id,name,phone,line,subdistrict,district,province,postcode,is_default,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)')
    .run(buyer, 'สมใจ ใจดี', '0890000000', '99/1 ถ.สุขุมวิท', 'ศรีราชา', 'ศรีราชา', 'ชลบุรี', '20110', now);

  const ins = db.prepare(`INSERT INTO products(seller_id,kind,title,subtitle,description,category,age,trim,pages,interior,paper,finish,price,keywords,ai,
      materials,made_by,method,lead_days,weekly_capacity,ship_fee,metal,for_kids,small_parts,options,status,rev,palette,submitted_at,created_at,updated_at)
    VALUES (@seller_id,@kind,@title,@subtitle,@description,@category,@age,@trim,@pages,@interior,@paper,@finish,@price,@keywords,@ai,
      @materials,'solo','handmade',@lead_days,@cap,@ship_fee,@metal,@for_kids,@small_parts,@options,@status,1,@palette,@t,@t,@t)`);
  const base = { age: 'all', trim: '8.5x11', pages: 48, interior: 'bw', paper: 'white', finish: 'matte', ai: 0, materials: '', lead_days: 3, cap: 20, ship_fee: 40, metal: 0, for_kids: 0, small_parts: 0, options: '[]', subtitle: '' };
  const items = [
    { seller_id: kdpSeller, kind: 'kdp', title: 'มหาสมุทรแสนสนุก', subtitle: 'สมุดระบายสีสัตว์ทะเล 40 ลาย', description: 'ปลาการ์ตูน เต่าทะเล ปลาหมึก และเพื่อน ๆ ใต้ทะเล ลายเส้นหนาระบายง่ายสำหรับมือเล็ก ๆ พิมพ์หน้าเดียวกันสีซึม', category: 'coloring', age: '3-5', price: 189, keywords: 'สัตว์ทะเล, ระบายสี, เด็กอนุบาล', status: 'approved', palette: 0 },
    { seller_id: kdpSeller, kind: 'kdp', title: 'แมนดาลาคลายเครียด', subtitle: 'ลายแมนดาลา 50 ลายสำหรับผู้ใหญ่', description: 'ลายละเอียดตั้งแต่ระดับง่ายถึงยาก เหมาะกับปากกาเมจิกและสีไม้ ทุกลายพิมพ์หน้าขวาเพียงหน้าเดียว', category: 'coloring', age: 'adult', pages: 104, finish: 'glossy', price: 259, keywords: 'แมนดาลา, ผ่อนคลาย, ผู้ใหญ่', status: 'approved', palette: 2 },
    { seller_id: kdpSeller, kind: 'kdp', title: 'ไดโนเสาร์ตัวจิ๋ว', subtitle: 'ระบายสีและลากเส้นตามรอย', description: 'ไดโนเสาร์ 30 สายพันธุ์ พร้อมแบบฝึกลากเส้นและชื่อภาษาไทย-อังกฤษ', category: 'activity', age: '6-9', trim: '8x10', pages: 64, price: 199, keywords: 'ไดโนเสาร์, ลากเส้น, ฝึกเขียน', ai: 1, status: 'pending', palette: 3 },
    { seller_id: hmSeller, kind: 'handmade', title: 'กำไลลูกปัดสลักชื่อ', subtitle: 'เลือกขนาด สี และตัวอักษรได้เอง', description: 'กำไลลูกปัดแก้วร้อยมือทีละเม็ด ร้อยด้วยเชือกยางยืดเส้นคู่ ใส่สบาย ไม่หลุดง่าย ใส่ชื่อ ชื่อเล่น หรือคำที่ชอบได้สูงสุด 8 ตัวอักษร เหมาะเป็นของขวัญ', category: 'jewelry', price: 159, keywords: 'กำไล, ลูกปัด, ของขวัญ, สลักชื่อ', materials: 'ลูกปัดแก้ว, เชือกยางยืด, ลูกปัดตัวอักษรอะคริลิก', lead_days: 3, cap: 15, ship_fee: 40, small_parts: 1, options: JSON.stringify(BRACELET_OPTIONS), status: 'approved', palette: 4 },
    { seller_id: hmSeller, kind: 'handmade', title: 'ที่คั่นหนังสือผ้าปักมือ', subtitle: 'ลายดอกไม้ไทย ชิ้นเดียวในโลก', description: 'ผ้าฝ้ายปักมือลายดอกพุดและดอกมะลิ เย็บขอบด้วยมือ ใช้คั่นหนังสือหรือแขวนตกแต่ง ลายแต่ละชิ้นต่างกันเล็กน้อยเพราะปักมือ', category: 'paper', price: 89, keywords: 'ที่คั่นหนังสือ, ปักมือ, ผ้าฝ้าย', materials: 'ผ้าฝ้าย, ด้ายปัก', lead_days: 2, cap: 30, ship_fee: 30, status: 'approved', palette: 1 },
    { seller_id: kdpSeller, kind: 'kdp', title: 'ช้างน้อยกลัวฝน', subtitle: 'นิทานภาพสำหรับเด็ก ก่อนนอน', description: 'ช้างน้อยไม่กล้าออกไปเล่นตอนฝนตก จนได้เพื่อนใหม่ชวนเรียนรู้ว่าฝนพาอะไรดี ๆ มาบ้าง ภาพสีทั้งเล่ม ตัวหนังสือใหญ่ อ่านให้ลูกฟังได้', category: 'story', age: '3-5', trim: '8x10', pages: 32, interior: 'color', price: 229, keywords: 'นิทาน, นิทานก่อนนอน, ช้าง', status: 'approved', palette: 1 },
    { seller_id: kdpSeller, kind: 'kdp', title: 'ทะเลสาบที่ไม่มีชื่อ', subtitle: 'นวนิยาย', description: 'ครูหนุ่มย้ายไปสอนโรงเรียนริมทะเลสาบทางเหนือ และพบว่าหมู่บ้านทั้งหมู่บ้านไม่ยอมเรียกชื่อทะเลสาบนั้น นวนิยายเรื่องยาวเกี่ยวกับความทรงจำและการให้อภัย', category: 'novel', age: 'adult', trim: '6x9', pages: 248, paper: 'cream', price: 289, keywords: 'นวนิยาย, ดราม่า, ครู', status: 'approved', palette: 5 },
    { seller_id: hmSeller, kind: 'handmade', title: 'ต่างหูเงินแท้ห่วงเล็ก', subtitle: 'เงิน 925 ดัดมือ', description: 'ต่างหูห่วงเงินแท้ 925 ดัดและขัดด้วยมือ ขนาด 12 มม. เหมาะกับผิวแพ้ง่าย (ข้อมูลตัวอย่างสำหรับทดสอบการตรวจของแอดมิน)', category: 'jewelry', price: 390, keywords: 'ต่างหู, เงินแท้, 925', materials: 'เงินแท้ 925', lead_days: 5, cap: 10, ship_fee: 40, metal: 1, status: 'pending', palette: 5 },
  ];
  const ids = items.map((p, i) => ins.run({ ...base, ...p, t: now - (items.length - i) * C.DAY }).lastInsertRowid);
  const prod = i => ({ ...base, ...items[i], id: ids[i] });

  const kdpChecks = JSON.stringify(Object.fromEntries(C.CHECKS.map(([k]) => [k, 1])));
  for (const i of [0, 1, 3, 4, 5, 6]) {
    const checks = items[i].kind === 'kdp' ? kdpChecks : JSON.stringify(Object.fromEntries(C.checksFor(prod(i)).map(([k]) => [k, 1])));
    db.prepare('INSERT INTO reviews(product_id,rev,admin_id,decision,note,checks,created_at) VALUES (?,1,?,?,?,?,?)').run(ids[i], adminId, 'approved', 'ผ่านเกณฑ์ (ข้อมูลตัวอย่าง)', checks, now - 10 * C.DAY);
  }

  // Demo orders: IF-DEMO01 books only (cash on delivery, delivered); IF-DEMO02 prepaid, one handmade parcel released + one book parcel.
  const order = makeOrder(buyer);
  const t1 = now - 9 * C.DAY;
  order('IF-DEMO01', t1, { method: 'cod' }, [
    { by: 'platform', fee: 50, status: 'delivered', tracking: 'TH0123456789', carrier: 'ไปรษณีย์ไทย', shipped: t1 + 2 * C.DAY, delivered: t1 + 4 * C.DAY, items: [{ p: prod(0), qty: 2, unit: 189 }] },
  ]);
  const t2 = now - 12 * C.DAY;
  order('IF-DEMO02', t2, { method: 'transfer', paid: t2 + 0.2 * C.DAY }, [
    { by: 'seller', seller: hmSeller, fee: 30, prep: 2, status: 'released', tracking: 'TH9988776655', carrier: 'Flash Express', shipped: t2 + 2 * C.DAY, delivered: t2 + 4 * C.DAY, released: t2 + 4 * C.DAY, items: [{ p: prod(4), qty: 1, unit: 89 }] },
    { by: 'platform', fee: 50, status: 'placed', items: [{ p: prod(1), qty: 1, unit: 259 }] },
  ]);
  console.log('[seed] ข้อมูลตัวอย่าง: ผู้ขายหนังสือ demo@seller.local · ร้าน handmade demo@handmade.local (รหัส seller12345) · ผู้ซื้อ demo@buyer.local / buyer12345');
}

// Inserts one demo order. groups: { by, seller, fee, prep, status, carrier, tracking, shipped, delivered, released, items: [{ p, qty, unit, lines, note }] }
function makeOrder(buyer) {
  return (code, t, { method, paid = null, payStatus }, groups) => {
    const all = groups.flatMap(g => g.items);
    const itemsTotal = all.reduce((a, it) => a + it.unit * it.qty, 0), shipTotal = groups.reduce((a, g) => a + g.fee, 0);
    const pay = payStatus || (method === 'cod' ? 'cod' : paid ? 'paid' : 'awaiting');
    const oid = db.prepare(`INSERT INTO orders(code,buyer_id,ship_name,ship_phone,ship_address,method,pay_status,paid_at,items_total,ship_total,total,created_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, buyer, 'สมใจ ใจดี', '0890000000', '99/1 ถ.สุขุมวิท ต.ศรีราชา อ.ศรีราชา จ.ชลบุรี 20110', method, pay, paid, itemsTotal, shipTotal, itemsTotal + shipTotal, t).lastInsertRowid;
    for (const g of groups) {
      const from = paid || t;
      const due = from + (g.by === 'platform' ? 3 : g.prep) * C.DAY;
      const sid = db.prepare(`INSERT INTO shipments(order_id,fulfilled_by,seller_id,status,items_total,ship_fee,prep_days,carrier,tracking,due_at,paid_at,shipped_at,delivered_at,released_at,created_at,updated_at)
                              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(oid, g.by, g.by === 'seller' ? g.seller : null, g.status, g.items.reduce((a, it) => a + it.unit * it.qty, 0), g.fee, g.prep || 0,
          g.carrier || '', g.tracking || '', due, method === 'transfer' && paid ? paid : null, g.shipped || null, g.delivered || null, g.released || null, t, Date.now()).lastInsertRowid;
      for (const it of g.items) {
        db.prepare('INSERT INTO order_items(order_id,shipment_id,product_id,seller_id,kind,title,qty,unit_price,options,note,earn_unit) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(oid, sid, it.p.id, it.p.seller_id, it.p.kind, it.p.title, it.qty, it.unit, JSON.stringify(it.lines || []), it.note || '', C.earnUnit(it.p, it.unit, 15));
      }
    }
  };
}

// Added with sellers-ship-themselves (v3). Runs once on old databases too, so the new flow can be tried without wiping storage/:
// a second handmade shop, shop shipping settings, and orders that put two shops in one cart.
function seedV3() {
  if (!cfg.SEED_DEMO || db.prepare("SELECT 1 FROM users WHERE email='demo@handmade2.local'").get()) return;
  const buyer = db.prepare("SELECT id FROM users WHERE email='demo@buyer.local'").get()?.id;
  const shop1 = db.prepare("SELECT id FROM users WHERE email='demo@handmade.local'").get()?.id;
  const adminId = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id;
  const find = (seller, title) => db.prepare('SELECT * FROM products WHERE seller_id=? AND title=?').get(seller, title);
  const bracelet = shop1 && find(shop1, 'กำไลลูกปัดสลักชื่อ');
  const book = db.prepare("SELECT * FROM products WHERE title='มหาสมุทรแสนสนุก' AND kind='kdp'").get();
  if (!buyer || !shop1 || !adminId || !bracelet || !book) return;
  const now = Date.now();

  db.prepare("UPDATE users SET ship_first=40, ship_next=10, ship_free_over=500, ship_from=? WHERE id=?")
    .run('มะลิทำมือ 12/3 ซ.วัดใหม่ ต.สุรศักดิ์ อ.ศรีราชา จ.ชลบุรี 20110 (ที่อยู่ตัวอย่าง)', shop1);
  const shop2 = db.prepare(`INSERT INTO users(role,email,password_hash,display_name,phone,payout_account,payout_name,handmade_status,ship_first,ship_next,ship_free_over,ship_from,created_at)
      VALUES ('seller','demo@handmade2.local',?,?,?,?,?,'approved',50,15,NULL,?,?)`)
    .run(bcrypt.hashSync('seller12345', 12), 'ฝนผ้าทอ (ร้านตัวอย่าง)', '0875556666', '087-555-6666', 'ฝน ทอผ้าดี',
      'ฝนผ้าทอ 45 ม.2 ต.บ้านบึง อ.บ้านบึง จ.ชลบุรี 20170 (ที่อยู่ตัวอย่าง)', now - 25 * C.DAY).lastInsertRowid;
  db.prepare("INSERT INTO seller_applications(seller_id,about,images,status,note,admin_id,created_at,decided_at) VALUES (?,?,'[]','approved','ข้อมูลตัวอย่าง',?,?,?)")
    .run(shop2, 'ทอผ้าฝ้ายด้วยกี่มือที่บ้าน ย้อมสีธรรมชาติ แล้วเย็บเป็นกระเป๋าและของใช้ (ข้อมูลตัวอย่าง)', adminId, now - 24 * C.DAY, now - 23 * C.DAY);

  const ins = db.prepare(`INSERT INTO products(seller_id,kind,title,subtitle,description,category,price,keywords,materials,made_by,method,lead_days,weekly_capacity,stock,small_parts,options,status,rev,palette,submitted_at,created_at,updated_at)
    VALUES (@seller,'handmade',@title,@subtitle,@description,@category,@price,@keywords,@materials,'solo','handmade',@lead,@cap,@stock,0,@options,'approved',1,@palette,@t,@t,@t)`);
  const BAG_OPTIONS = [{ id: 'o0', type: 'swatch', label: 'สีผ้า', required: true, values: [{ label: 'คราม', price: 0, color: '#3b5b8c' }, { label: 'เปลือกมังคุด', price: 0, color: '#8a4b5c' }, { label: 'ขมิ้น', price: 20, color: '#e0b43a' }] }];
  const bag = ins.run({ seller: shop2, title: 'กระเป๋าผ้าทอมือ', subtitle: 'ผ้าฝ้ายย้อมสีธรรมชาติ มีของพร้อมส่ง', description: 'กระเป๋าสะพายผ้าฝ้ายทอมือ ย้อมครามและเปลือกไม้ บุซับใน มีช่องใส่โทรศัพท์ สีอาจต่างกันเล็กน้อยตามล็อตการย้อม', category: 'bags', price: 450, keywords: 'กระเป๋า, ผ้าทอ, ย้อมคราม', materials: 'ผ้าฝ้ายทอมือ, สีย้อมธรรมชาติ, ซับในผ้าฝ้าย', lead: 2, cap: 10, stock: 4, options: JSON.stringify(BAG_OPTIONS), palette: 3, t: now - 20 * C.DAY }).lastInsertRowid;
  const coaster = ins.run({ seller: shop2, title: 'ที่รองแก้วผ้าทอ ชุด 4 ชิ้น', subtitle: 'ทอตามสั่ง', description: 'ที่รองแก้วผ้าฝ้ายทอมือ 4 ชิ้น ขนาด 10 × 10 ซม. ซับน้ำดี ทอใหม่ทุกชุดหลังมีคำสั่งซื้อ', category: 'home', price: 190, keywords: 'ที่รองแก้ว, ผ้าทอ', materials: 'ผ้าฝ้ายทอมือ', lead: 4, cap: 15, stock: null, options: '[]', palette: 2, t: now - 18 * C.DAY }).lastInsertRowid;
  const getP = id => db.prepare('SELECT * FROM products WHERE id=?').get(id);
  for (const id of [bag, coaster]) {
    const checks = JSON.stringify(Object.fromEntries(C.checksFor(getP(id)).map(([k]) => [k, 1])));
    db.prepare("INSERT INTO reviews(product_id,rev,admin_id,decision,note,checks,created_at) VALUES (?,1,?,'approved','ผ่านเกณฑ์ (ข้อมูลตัวอย่าง)',?,?)").run(id, adminId, checks, now - 15 * C.DAY);
  }

  const order = makeOrder(buyer);
  const lines = [{ label: 'ขนาดข้อมือ', value: 'S 15 ซม.' }, { label: 'สีลูกปัด', value: 'ฟ้าน้ำทะเล' }, { label: 'ตัวอักษรบนลูกปัด', value: 'FON' }];
  // IF-DEMO03: two shops + a book in one cart, slip waiting for admin.
  order('IF-DEMO03', now - 2 * 3600e3, { method: 'transfer' }, [
    { by: 'seller', seller: shop1, fee: 40, prep: 3, status: 'awaiting_payment', items: [{ p: bracelet, qty: 1, unit: 189, lines, note: 'ขอห่อของขวัญ วันเกิดน้อง' }] },
    { by: 'seller', seller: shop2, fee: 50, prep: 2, status: 'awaiting_payment', items: [{ p: getP(bag), qty: 1, unit: 450, lines: [{ label: 'สีผ้า', value: 'คราม' }] }] },
    { by: 'platform', fee: 50, status: 'awaiting_payment', items: [{ p: book, qty: 1, unit: 189 }] },
  ]);
  // IF-DEMO04: paid a week ago, shop 2 still has not shipped → past the ship-by date (late alert, not yet auto-cancelled).
  const t4 = now - 7 * C.DAY;
  order('IF-DEMO04', t4, { method: 'transfer', paid: t4 + 0.1 * C.DAY }, [
    { by: 'seller', seller: shop2, fee: 50, prep: 4, status: 'preparing', items: [{ p: getP(coaster), qty: 1, unit: 190 }] },
  ]);
  // IF-DEMO05: shipped 3 days ago, waiting for the buyer to confirm (or report a problem).
  const t5 = now - 6 * C.DAY;
  order('IF-DEMO05', t5, { method: 'transfer', paid: t5 + 0.1 * C.DAY }, [
    { by: 'seller', seller: shop2, fee: 50, prep: 2, status: 'shipped', carrier: 'J&T Express', tracking: 'JT0001234567', shipped: now - 3 * C.DAY, items: [{ p: getP(bag), qty: 1, unit: 470, lines: [{ label: 'สีผ้า', value: 'ขมิ้น' }] }] },
  ]);
  console.log('[seed] เพิ่มร้าน handmade ที่ 2: demo@handmade2.local / seller12345 และออเดอร์ IF-DEMO03 (2 ร้านในตะกร้าเดียว รอตรวจสลิป), IF-DEMO04 (เลยกำหนดส่ง), IF-DEMO05 (ส่งแล้ว รอลูกค้ากดรับ)');
}

module.exports = function seed() {
  seedBase();
  seedV3();
};
