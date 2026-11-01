// Home page: background videos play only while on screen (and never when the visitor prefers reduced motion),
// a pause button for the hero video, and count-up numbers in the stats block.
(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection && navigator.connection.saveData;
  const videos = [...document.querySelectorAll('video[data-autoplay]')];
  const toggle = document.querySelector('[data-video-toggle]');
  let userPaused = false;

  const play = v => { if (!userPaused && !calm && !saveData) v.play().catch(() => {}); };
  if (calm || saveData) videos.forEach(v => { v.removeAttribute('autoplay'); v.pause(); });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? play(e.target) : e.target.pause())), { threshold: 0.2 });
    videos.forEach(v => io.observe(v));
  }

  // WCAG 2.2.2: moving content longer than 5 s needs a way to pause it.
  if (toggle) {
    const sync = () => {
      toggle.setAttribute('aria-pressed', String(userPaused));
      const en = document.documentElement.lang === 'en';
      toggle.setAttribute('aria-label', userPaused ? (en ? 'Play video' : 'เล่นวิดีโอ') : (en ? 'Pause video' : 'หยุดวิดีโอ'));
      toggle.innerHTML = userPaused
        ? '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
    };
    if (calm || saveData) userPaused = true;
    toggle.addEventListener('click', () => {
      userPaused = !userPaused;
      videos.forEach(v => (userPaused ? v.pause() : v.play().catch(() => {})));
      sync();
    });
    sync();
  }

  // Count up the stats once they scroll into view.
  const nums = document.querySelectorAll('[data-count]');
  if (!calm && nums.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const end = Number(e.target.dataset.count), t0 = performance.now(), dur = 900;
      const step = t => {
        const k = Math.min(1, (t - t0) / dur);
        e.target.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))).toLocaleString('th-TH');
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), { threshold: 0.6 });
    nums.forEach(n => { n.textContent = '0'; io.observe(n); });
  }
})();
