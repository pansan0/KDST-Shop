// Live royalty calculator; mirrors printCost/royaltyUnit in lib/catalog.js (the server value is authoritative).
(() => {
  const f = document.getElementById('bookForm');
  if (!f) return;
  const P = JSON.parse(f.dataset.pricing);
  const out = document.getElementById('royCalc');
  const thb = n => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const INTERIOR = { bw: 'ขาวดำ', color: 'สี่สี' };
  function update() {
    const pages = parseInt(f.pages.value, 10) || 0, price = parseInt(f.price.value, 10) || 0;
    const per = f.interior.value === 'color' ? P.colorPerPage : P.bwPerPage;
    const base = f.trim.value === '6x9' ? P.baseSmall : P.base;
    const pc = Math.round((base + per * pages) * 100) / 100;
    const ru = Math.round((price * P.royalty - pc) * 100) / 100;
    const min = Math.ceil(pc / P.royalty) + 1;
    out.innerHTML =
      `<div class="ln"><span>ราคาขาย × ${P.royalty * 100}%</span><span class="num">${thb(price * P.royalty)}</span></div>` +
      `<div class="ln"><span>หักค่าพิมพ์ (${pages} หน้า ${INTERIOR[f.interior.value]})</span><span class="num">− ${thb(pc)}</span></div>` +
      `<div class="ln tot ${ru <= 0 ? 'neg' : ''}"><span>คุณได้ต่อเล่ม</span><b class="num">${thb(ru)}</b></div>` +
      `<div class="hint">ราคาต่ำสุดที่ตั้งได้สำหรับสเปกนี้ ${thb(min)}</div>`;
  }
  f.addEventListener('input', update);
  f.addEventListener('change', update);
  update();
})();
