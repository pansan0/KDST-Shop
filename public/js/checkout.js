// Checkout: show the new-address fields only when "ที่อยู่ใหม่" is picked.
(() => {
  const box = document.querySelector('[data-new-address]');
  if (!box) return;
  const form = box.closest('form');
  const sync = () => { box.hidden = (form.querySelector('[name=address_id]:checked') || {}).value !== 'new'; };
  form.addEventListener('change', sync);
  sync();
})();
