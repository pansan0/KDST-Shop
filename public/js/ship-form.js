// Seller "บันทึกการจัดส่ง" forms: show the free-text carrier name only when "อื่น ๆ" is picked.
document.querySelectorAll('.shipform').forEach(f => {
  const sel = f.querySelector('[data-carrier]'), other = f.querySelector('[data-carrier-other]');
  const sync = () => { other.hidden = sel.value !== 'other'; other.querySelector('input').required = sel.value === 'other'; };
  sel.addEventListener('change', sync);
  sync();
});
