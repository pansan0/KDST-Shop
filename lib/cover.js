// Generates a placeholder image (SVG) for products without an uploaded one:
// line-art flowers with a title box for books, a bead bracelet for handmade items.
const PALS = ['#bfe3f2', '#ffd9a8', '#d9cff5', '#c9efc4', '#ffc9d3', '#fff0a6'];
const BEADS = ['#f6b8c8', '#9fd3e8', '#f4efe6', '#a8dfc4', '#ffd27f', '#c9b6f0'];
const xml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function rng(seed) {
  let h = (seed * 2654435761) >>> 0 || 7;
  return () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return h / 0x7fffffff; };
}

function bookSvg(book) {
  const r = rng(book.id);
  let g = '';
  for (let i = 0; i < 4; i++) {
    const cx = 15 + r() * 70, cy = 10 + r() * 70, s = 8 + r() * 13, n = 6 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) g += `<ellipse cx="${cx.toFixed(1)}" cy="${(cy - s * 0.62).toFixed(1)}" rx="${(s * 0.28).toFixed(1)}" ry="${(s * 0.55).toFixed(1)}" transform="rotate(${(k * 360 / n).toFixed(0)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
    g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(s * 0.24).toFixed(1)}"/>`;
  }
  const bg = PALS[(book.palette || 0) % PALS.length];
  const title = xml((book.title || '').slice(0, 28));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><rect width="100" height="130" fill="${bg}"/>` +
    `<g fill="#fff" fill-opacity=".55" stroke="#19213b" stroke-width="1.1">${g}</g>` +
    `<rect x="6" y="104" width="88" height="18" rx="2" fill="#fff" stroke="#19213b" stroke-width="1.2"/>` +
    `<text x="50" y="116.5" font-family="sans-serif" font-size="7" text-anchor="middle" fill="#19213b">${title}</text></svg>`;
}

// Same 8.5:11 frame as book covers so the storefront grid stays even. White background, product centred (main-image rule).
function handmadeSvg(p) {
  const r = rng(p.id);
  const n = 22, cx = 50, cy = 62, R = 30;
  let beads = '';
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const col = BEADS[Math.floor(r() * BEADS.length)];
    beads += `<circle cx="${(cx + R * Math.cos(a)).toFixed(1)}" cy="${(cy + R * Math.sin(a)).toFixed(1)}" r="4.6" fill="${col}" stroke="#2b2b2b" stroke-width=".6"/>`;
  }
  const tint = PALS[(p.palette || 0) % PALS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><rect width="100" height="130" fill="#ffffff"/>` +
    `<ellipse cx="50" cy="100" rx="32" ry="5" fill="${tint}" opacity=".7"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#bbb" stroke-width=".6"/>${beads}</svg>`;
}

const coverSvg = p => (p.kind === 'handmade' ? handmadeSvg(p) : bookSvg(p));

module.exports = { coverSvg, PALS };
