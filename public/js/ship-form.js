// Seller "บันทึกการจัดส่ง" forms: show the free-text carrier name only when "อื่น ๆ" is picked.
document.querySelectorAll('.shipform').forEach(f => {
  const other = f.querySelector('[data-carrier-other]');
  const sync = () => {
    const on = (f.querySelector('[data-carrier]:checked') || {}).value === 'other';
    other.hidden = !on;
    other.querySelector('input').required = on;
  };
  f.addEventListener('change', sync);
  sync();
});
