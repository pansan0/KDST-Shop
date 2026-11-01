// A short confetti burst on the "order placed" page. Skipped for visitors who prefer reduced motion.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.setAttribute('aria-hidden', 'true');
  document.body.append(c);
  const g = c.getContext('2d');
  const fit = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); };
  fit();
  const colors = ['#2f6a3c', '#b8502a', '#f2c14e', '#86c592', '#f6b8c8', '#9fd3e8'];
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.32,
    vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 12 - 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const age = t - t0;
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1600) / 900);
    for (const b of bits) {
      b.vy += 0.32; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); g.restore();
    }
    if (age < 2500) requestAnimationFrame(frame); else c.remove();
  })(t0);
})();
