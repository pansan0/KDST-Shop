// Ask before destructive actions: <form data-confirm="...">
document.addEventListener('submit', e => {
  const msg = e.target.dataset && e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
// Prevent double submits on slow uploads.
document.addEventListener('submit', e => {
  if (e.defaultPrevented) return;
  const f = e.target;
  setTimeout(() => f.querySelectorAll('button').forEach(b => { if (b !== e.submitter) b.disabled = true; }), 0);
  if (e.submitter) setTimeout(() => { e.submitter.disabled = true; e.submitter.dataset.label = e.submitter.textContent; e.submitter.textContent = 'กำลังส่ง…'; }, 0);
});
