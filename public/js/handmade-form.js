// Handmade product form: show only the fields for each option's type, show safety declarations
// only when relevant, and preview what the seller earns per piece (server value is authoritative).
(() => {
  const f = document.getElementById('hmForm');
  if (!f) return;
  const fee = Number(f.dataset.fee);
  const thb = n => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });

  function sync() {
    f.querySelectorAll('[data-opt]').forEach(box => {
      const t = box.querySelector('[data-type]').value;
      box.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(t); });
    });
    const metal = f.metal.checked, kids = f.small_parts.checked || f.for_kids.checked;
    document.getElementById('declare_metal_box').hidden = !metal;
    document.getElementById('declare_kids_box').hidden = !kids;
    const price = parseInt(f.price.value, 10) || 0, ship = parseInt(f.ship_fee.value, 10) || 0;
    const earn = Math.round(price * (1 - fee / 100) * 100) / 100;
    document.getElementById('earnCalc').innerHTML =
      `<div class="ln"><span>ราคาตั้งต้น</span><span class="num">${thb(price)}</span></div>` +
      `<div class="ln"><span>หักค่าธรรมเนียมร้าน ${fee}%</span><span class="num">− ${thb(price - earn)}</span></div>` +
      `<div class="ln"><span>ค่าส่งที่ได้คืน (ต่อพัสดุ)</span><span class="num">+ ${thb(ship)}</span></div>` +
      `<div class="ln tot"><span>คุณได้ต่อชิ้น (ไม่รวมค่าส่ง)</span><b class="num">${thb(earn)}</b></div>` +
      '<div class="hint">ราคาตัวเลือกเพิ่มเติมก็หักค่าธรรมเนียมในอัตราเดียวกัน ยอดเข้าบัญชีเมื่อพัสดุส่งถึงและเก็บเงินแล้ว</div>';
  }
  f.addEventListener('input', sync);
  f.addEventListener('change', sync);
  sync();
})();
