const PAGE_EN = document.documentElement.lang === 'en'; // page language, set by the server
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
  if (e.submitter) setTimeout(() => { e.submitter.disabled = true; e.submitter.dataset.label = e.submitter.textContent; e.submitter.classList.add('busy'); e.submitter.textContent = PAGE_EN ? 'Sending…' : 'กำลังส่ง…'; }, 0);
});

(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Flash message → toast. Success/info fade out on their own; warnings and errors stay until closed.
  const flash = document.querySelector('main > .flash[role="status"]');
  if (flash) {
    const box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('aria-live', 'polite');
    const t = flash.cloneNode(true);
    t.classList.add('toast');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-x';
    close.setAttribute('aria-label', PAGE_EN ? 'Dismiss' : 'ปิดข้อความ');
    close.textContent = '×';
    const dismiss = () => { t.classList.add('out'); setTimeout(() => box.remove(), 300); };
    close.addEventListener('click', dismiss);
    t.append(close);
    box.append(t);
    document.body.append(box);
    flash.remove();
    if (!t.classList.contains('bad') && !t.classList.contains('warn')) setTimeout(dismiss, 4500);
  }

  // Fade/slide elements in as they scroll into view.
  const items = document.querySelectorAll('[data-reveal]');
  if (calm || !('IntersectionObserver' in window)) items.forEach(el => el.classList.add('shown'));
  else {
    document.documentElement.classList.add('reveal-on');
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('shown'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => io.observe(el));
  }

  // Header shadow once the page scrolls; back-to-top button on long pages.
  const top = document.querySelector('.top');
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'to-top';
  up.setAttribute('aria-label', PAGE_EN ? 'Back to top' : 'กลับขึ้นด้านบน');
  up.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  up.addEventListener('click', () => window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' }));
  document.body.append(up);
  const onScroll = () => {
    const y = window.scrollY;
    if (top) top.classList.toggle('scrolled', y > 8);
    up.classList.toggle('on', y > 900);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
