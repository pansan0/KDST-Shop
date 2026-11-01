// Creates the first admin (from .env) and, if SEED_DEMO is on, demo sellers (KDP + handmade), a buyer, products and orders.
const bcrypt = require('bcryptjs');
const cfg = require('./config');
const { db } = require('./db');
const C = require('./lib/catalog');

const BRACELET_OPTIONS = [
  { id: 'o0', type: 'select', label: 'ขนาดข้อมือ', required: true, values: [{ label: 'S 15 ซม.', price: 0, color: '' }, { label: 'M 16.5 ซม.', price: 0, color: '' }, { label: 'L 18 ซม.', price: 10, color: '' }] },
  { id: 'o1', type: 'swatch', label: 'สีลูกปัด', required: true, values: [{ label: 'ชมพูพาสเทล', price: 0, color: '#f6b8c8' }, { label: 'ฟ้าน้ำทะเล', price: 0, color: '#9fd3e8' }, { label: 'ขาวมุก', price: 15, color: '#f4efe6' }, { label: 'เขียวมิ้นต์', price: 0, color: '#a8dfc4' }] },
  { id: 'o2', type: 'text', label: 'ตัวอักษรบนลูกปัด', required: false, max_len: 8, charset: 'upper', price: 30 },
];

module.exports = function seed() {
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

  // Two demo orders from the buyer: one delivered (counts toward seller earnings), one in progress (KDP + bracelet).
  const order = (code, t, groups) => {
    const all = groups.flatMap(g => g.items);
    const itemsTotal = all.reduce((a, it) => a + it.unit * it.qty, 0), shipTotal = groups.reduce((a, g) => a + g.fee, 0);
    const oid = db.prepare(`INSERT INTO orders(code,buyer_id,ship_name,ship_phone,ship_address,items_total,ship_total,total,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(code, buyer, 'สมใจ ใจดี', '0890000000', '99/1 ถ.สุขุมวิท ต.ศรีราชา อ.ศรีราชา จ.ชลบุรี 20110', itemsTotal, shipTotal, itemsTotal + shipTotal, t).lastInsertRowid;
    for (const g of groups) {
      const sid = db.prepare(`INSERT INTO shipments(order_id,fulfilled_by,seller_id,status,items_total,ship_fee,tracking,due_at,shipped_at,delivered_at,created_at,updated_at)
                              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(oid, g.by, g.by === 'seller' ? hmSeller : null, g.status, g.items.reduce((a, it) => a + it.unit * it.qty, 0), g.fee, g.tracking || '',
          t + (g.by === 'platform' ? 3 : 4) * C.DAY, g.shipped || null, g.delivered || null, t, now).lastInsertRowid;
      for (const it of g.items) {
        const p = prod(it.i);
        db.prepare('INSERT INTO order_items(order_id,shipment_id,product_id,seller_id,kind,title,qty,unit_price,options,earn_unit) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(oid, sid, p.id, p.seller_id, p.kind, p.title, it.qty, it.unit, JSON.stringify(it.lines || []), C.earnUnit(p, it.unit, 15));
      }
    }
  };
  const t1 = now - 9 * C.DAY;
  order('IF-DEMO01', t1, [
    { by: 'platform', fee: 50, status: 'delivered', tracking: 'TH0123456789', shipped: t1 + 2 * C.DAY, delivered: t1 + 4 * C.DAY, items: [{ i: 0, qty: 2, unit: 189 }] },
    { by: 'seller', fee: 30, status: 'delivered', tracking: 'KE5550001', shipped: t1 + 2 * C.DAY, delivered: t1 + 5 * C.DAY, items: [{ i: 4, qty: 1, unit: 89 }] },
  ]);
  const t2 = now - 1 * C.DAY;
  order('IF-DEMO02', t2, [
    { by: 'platform', fee: 50, status: 'placed', items: [{ i: 1, qty: 1, unit: 259 }] },
    { by: 'seller', fee: 40, status: 'placed', items: [{ i: 3, qty: 1, unit: 189, lines: [{ label: 'ขนาดข้อมือ', value: 'M 16.5 ซม.' }, { label: 'สีลูกปัด', value: 'ชมพูพาสเทล' }, { label: 'ตัวอักษรบนลูกปัด', value: 'MALI' }] }] },
  ]);
  console.log('[seed] ข้อมูลตัวอย่าง: ผู้ขายหนังสือ demo@seller.local · ร้าน handmade demo@handmade.local (รหัส seller12345) · ผู้ซื้อ demo@buyer.local / buyer12345');
};
