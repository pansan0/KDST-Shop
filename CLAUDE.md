# Inkfold: marketplace หนังสือ Print-on-Demand (แบบ KDP) + งาน Handmade

โปรเจกต์รายวิชา Software Engineering (02739321-64) ของกลุ่ม ม.เกษตรศาสตร์ ศรีราชา
ชื่อบนปกรายงานคือ "ระบบขายสินค้า KDP" ระบบชื่อ Inkfold

3 บทบาทแยกกัน คล้าย Amazon:
- **ผู้ซื้อ** สมัครสมาชิก ใส่ตะกร้า สั่งซื้อแบบเก็บเงินปลายทาง (COD) อย่างเดียว ติดตามพัสดุ
- **ผู้ขาย** ลงขาย 2 แบบ: **หนังสือ KDP** (ส่ง PDF แล้ว Inkfold พิมพ์และส่ง ผู้ขายได้ค่าลิขสิทธิ์) หรือ **Handmade** (ต้องผ่านใบสมัครก่อน ผู้ขายทำและส่งเอง ลูกค้าเลือกตัวเลือกคัสตอมได้)
- **แอดมิน** ตรวจสินค้าตามเช็กลิสต์มาตรฐานสากลก่อนวางขาย คัดกรองผู้ขาย handmade พิมพ์และส่งหนังสือ ยืนยันเก็บเงินปลายทาง บันทึกการโอนเงินให้ผู้ขายด้วยมือ

ร่างออกแบบอยู่ที่ `docs/design-marketplace.md`

## รันและทดสอบ (Windows, Node 24 · ทดสอบกับ Node 22 แล้วก็ใช้ได้)

```
npm install
copy .env.example .env
npm run dev          # http://localhost:3000
```

- หน้าร้าน `/` · ผู้ซื้อ `/account` · ผู้ขาย `/seller` · แอดมิน `/admin`
- บัญชีทดลอง (seed):
  - แอดมิน `admin@inkfold.local` / `admin12345`
  - ผู้ขายหนังสือ `demo@seller.local` / `seller12345` (ยังไม่ได้สิทธิ์ handmade)
  - ร้าน handmade `demo@handmade.local` / `seller12345` (มีกำไลคัสตอม และต่างหูเงินรอตรวจ)
  - ผู้ซื้อ `demo@buyer.local` / `buyer12345`
- ล้างข้อมูล: หยุดเซิร์ฟเวอร์ ลบโฟลเดอร์ `storage/` แล้วรันใหม่ (seed สร้างข้อมูลตัวอย่างให้)
- schema เวอร์ชัน 2 (`PRAGMA user_version`) ถ้าเจอฐานข้อมูลเก่าที่มีตาราง `books` เซิร์ฟเวอร์จะหยุดและบอกให้ลบ `storage/`
- ต้องใช้ `better-sqlite3` ^12.11 ขึ้นไป (เวอร์ชัน 11 ไม่มี prebuilt สำหรับ Node 24 บน Windows และจะพยายามคอมไพล์จนล้ม)

## Stack และโครงสร้าง

Express 4 + EJS (server-rendered) + SQLite (better-sqlite3) + express-session (เก็บใน SQLite) + bcryptjs + multer 2
ไม่มี frontend framework: JS ฝั่ง client มีแค่ไฟล์เล็ก ๆ ใน `public/js/`

```
server.js            app, session, CSRF (multipart ส่ง _csrf ทาง query string)
config.js            อ่าน .env เอง ไม่ใช้ dotenv
db.js                schema ทั้งหมด + settings + sellerStats / sellerMetrics
seed.js              แอดมินแรก + ข้อมูลตัวอย่าง
lib/auth.js          loadUser, requireRole, PREFIX (buyer → /account), safeNext, rate limit ล็อกอิน
lib/auth-routes.js   login/register/logout/password ใช้ร่วมทั้ง /account /seller /admin
lib/catalog.js       หมวด ตัวเลือก สถานะ เช็กลิสต์มาตรฐาน (checksFor) สูตรราคา
lib/options.js       ตัวเลือกคัสตอม handmade: แปลงฟอร์มผู้ขาย ↔ JSON, ตรวจค่าที่ผู้ซื้อเลือก
lib/orders.js        ตะกร้า แยกพัสดุ สั่งซื้อ COD และ state machine ของพัสดุ (ที่เดียวที่เปลี่ยนสถานะพัสดุ)
lib/address.js       สมุดที่อยู่ผู้ซื้อ + ตรวจ จังหวัด → อำเภอ/เขต → ตำบล/แขวง จากข้อมูลจริง
public/data/th-address.json  77 จังหวัด 928 อำเภอ 7,436 ตำบล + รหัสไปรษณีย์ (จาก kongvut/thai-province-data, MIT)
public/js/address.js ช่องค้นหาจังหวัด และเติมรายการอำเภอ ตำบล รหัสไปรษณีย์ให้
lib/upload.js        multer: ตรวจชนิดไฟล์ + ขนาด
lib/cover.js         ภาพแทนเมื่อยังไม่มีรูป (ปกหนังสือ / กำไลลูกปัด)
routes/store.js      หน้าร้าน หน้าสินค้า ตะกร้า ชำระเงิน
routes/account.js    พอร์ทัลผู้ซื้อ: คำสั่งซื้อ ยกเลิก สมุดที่อยู่ โปรไฟล์
routes/seller.js     พอร์ทัลผู้ขาย: สินค้า 2 แบบ ใบสมัคร handmade จัดส่ง handmade ยอดขาย
routes/admin.js      พอร์ทัลแอดมิน
routes/files.js      ส่งไฟล์แบบตรวจสิทธิ์ (PDF เนื้อใน ปก PDF และรูปใบสมัครไม่เปิดสาธารณะ)
views/{store,account,seller,admin,auth,partials}/
```

## กฎของระบบ (อย่าทำให้เสีย)

- **บทบาท:** `users.role` = `buyer` | `seller` | `admin` ล็อกอินคนละหน้า ใน browser เดียวล็อกอินได้ทีละบทบาท ตะกร้าและชำระเงินต้องเป็นผู้ซื้อ (ไม่มี guest checkout)
- **สมัครแอดมิน:** ต้องมี `ADMIN_INVITE_CODE` ใน .env ถ้าว่างคือปิดรับสมัคร
- **สินค้า** (`products.kind` = `kdp` | `handmade`): `draft → pending → approved | changes | rejected` · `approved ⇄ archived` · แอดมินระงับได้ (`suspended`)
  - การแก้ไขสินค้าที่ส่งตรวจไปแล้วทุกครั้งจะเพิ่ม `rev` และกลับไป `pending` (ถูกซ่อนจากหน้าร้าน)
  - อนุมัติได้เมื่อติ๊กเช็กลิสต์ครบตาม `C.checksFor(product)`: KDP 9 ข้อ, handmade 8 ข้อ + ข้อโลหะ (ถ้า `metal`) + ข้อเด็ก (ถ้า `for_kids` หรือ `small_parts`)
  - ลงขาย handmade ได้เมื่อ `users.handmade_status = 'approved'` (ผ่านใบสมัครใน `seller_applications`)
- **คำสั่งซื้อ:** 1 order แยกเป็นหลาย `shipments`: หนังสือ KDP ทุกเล่มรวมเป็นพัสดุของ Inkfold (`fulfilled_by='platform'`) งาน handmade แยกพัสดุต่อร้าน (`'seller'`) สถานะของ order คำนวณจากพัสดุ (`orderState`)
- **สถานะพัสดุ:** `placed → in_production → shipped → delivered | returned` · `cancelled` ได้จาก `placed` / `in_production`
  - ผู้ซื้อยกเลิกได้เฉพาะ `placed` · ผู้ขายทำ start / ship / cancel ได้เฉพาะพัสดุ handmade ของตัวเอง · `delivered` และ `returned` แอดมินเป็นคนกด (เงิน COD เข้าบัญชีขนส่งของ Inkfold)
  - ตีกลับครบ `return_limit` ครั้ง → `users.cod_blocked=1`
  - เปลี่ยนสถานะผ่าน `ORD.moveShipment()` เท่านั้น
- **เงินผู้ขาย:** ล็อกไว้ใน `order_items.earn_unit` ตอนสั่งซื้อ นับเมื่อพัสดุ `delivered`
  - KDP: `ราคาขาย × 0.6 − ค่าพิมพ์` โดยค่าพิมพ์ = 28 บาท (6×9 นิ้ว 20 บาท) + 0.45/หน้า ขาวดำ หรือ 2.2/หน้า สี่สี
  - Handmade: `(ราคา + ราคาตัวเลือก) × (1 − hm_fee_pct/100)` + ค่าส่งของพัสดุที่ร้านส่งเอง
  - ถ้าแก้สูตร KDP ต้องแก้ทั้ง `lib/catalog.js` และ `public/js/book-form.js` · สูตร handmade ต้องตรงกับ `public/js/handmade-form.js`
- **ระยะรอ:** สินค้าทุกชิ้นผลิตหลังสั่ง ต้องแจ้งลูกค้าเสมอว่า "รอผลิตและจัดส่ง 7–14 วัน" (`C.WAIT`, `C.waitRange`) ที่การ์ดสินค้า หน้าสินค้า ตะกร้า หน้าชำระเงิน (ต้องติ๊ก `ack_wait` ก่อนสั่ง) และหน้าคำสั่งซื้อ · ระยะผลิต handmade ไม่เกิน `C.MAX_LEAD_DAYS` (10 วัน)
- **ไฟล์ปก:** `cover_file` = รูปที่แสดงหน้าร้าน (JPG/PNG เท่านั้น เพราะใช้ใน `<img>`) · `cover_pdf` = ปกสำหรับพิมพ์ ถ้าผู้ขายส่งปกเป็น PDF (เฉพาะ KDP ต้องแนบภาพหน้าร้านคู่กัน ไม่เปิดสาธารณะ) · handmade รับรูปหลักเป็นภาพเท่านั้น
- **ตัวเลือกคัสตอม:** เก็บเป็น JSON ใน `products.options` ราคาและตัวเลือกที่ผู้ซื้อเลือกล็อกไว้ใน `order_items` ราคาฝั่ง client (`item.js`) ใช้แสดงผลเท่านั้น
- **PDPA:** ผู้ขาย handmade เห็นชื่อ เบอร์ ที่อยู่ผู้ซื้อเฉพาะพัสดุของตัวเอง ระหว่างจัดส่ง และ 30 วันหลังส่งถึง
- **ความปลอดภัย:** ทุก POST ต้องมี CSRF token · ใช้ `<%= %>` (escape) ใน EJS ไม่ใช้ `<%-` กับข้อมูลจากผู้ใช้ · SQL ใช้ prepared statement เสมอ · `safeNext` ยอมให้ redirect เฉพาะ path ในพื้นที่ของบทบาทนั้น

## ภาษาและสไตล์

- UI และข้อความทั้งหมดเป็นภาษาไทย ฟอนต์ IBM Plex Sans Thai + Mitr
- หน้าร้านและพอร์ทัลผู้ซื้อ: พื้นขาว เขียวใบไม้ ครีม ส้มอิฐ (CSS ใต้ `.portal-store`) · แอดมินแถบบนสีเข้ม · ผู้ขายสีอ่อน
- คุยกับเจ้าของโปรเจกต์เป็นภาษาไทย

## งานที่ยังไม่ได้ทำ

- เชื่อม payment gateway (ตอนนี้ COD อย่างเดียว)
- รีวิวและให้ดาวสินค้า
- ส่งอีเมลแจ้งสถานะ และรีเซ็ตรหัสผ่านทางอีเมล
- ตรวจขนาดหน้า PDF อัตโนมัติ
- เชื่อมระบบขนส่ง (เลขพัสดุและยอด COD กรอกด้วยมือ)

## เอกสารประกอบ

รายงาน Word มีหัวข้อ บทนำ ปัญหา วัตถุประสงค์ ขอบเขตและข้อจำกัด ประโยชน์ที่คาดว่าจะได้รับ
และ diagram 4 แบบ: Use Case, Activity, State Chart, Class ถ้าแก้ระบบจนพฤติกรรมเปลี่ยน ให้บอกเจ้าของว่า diagram ไหนต้องอัปเดต
