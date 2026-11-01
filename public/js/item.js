// Product page: live price for chosen options, bead preview for name text, qty stepper.
// The server recomputes the price from the option list; this is display only.
(() => {
  const f = document.getElementById('addForm');
  if (!f) return;
  const base = Number(f.dataset.base);
  const opts = JSON.parse(f.dataset.options || '[]');
  const thb = n => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const clamp = v => Math.max(1, Math.min(20, parseInt(v, 10) || 1));
  const swatch = opts.find(o => o.type === 'swatch');

  function update() {
    let extra = 0, bead = '#f4efe6';
    for (const o of opts) {
      const el = f.elements['opt_' + o.id];
      if (!el) continue;
      if (o.values) {
        const v = o.values[Number(el.value)];
        if (el.value !== '' && v) { extra += v.price; if (o === swatch && v.color) bead = v.color; }
      } else if (o.type === 'text' && el.value.trim()) extra += o.price;
    }
    const each = base + extra, qty = clamp(f.qty.value);
    document.getElementById('livePrice').textContent = thb(each);
    document.getElementById('barPrice').textContent = thb(each * qty);
    f.querySelectorAll('[data-preview]').forEach(box => {
      const t = f.elements[box.dataset.preview].value;
      box.replaceChildren(...[...t].map(ch => {
        const b = document.createElement('span');
        b.textContent = ch === ' ' ? '' : ch;
        b.style.background = bead;
        return b;
      }));
    });
  }
  f.querySelectorAll('[data-upper]').forEach(el => el.addEventListener('input', () => {
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(pos, pos);
  }));
  f.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    f.qty.value = clamp(clamp(f.qty.value) + Number(b.dataset.step));
    update();
  }));
  f.addEventListener('input', update);
  f.addEventListener('change', update);
  update();
  if (f.querySelector('.flash.bad')) f.scrollIntoView({ block: 'start' });
})();
