// Thai / English for customer-facing pages.
// Views stay written in Thai. When a customer picks English, the rendered HTML is translated on the way out:
// every text node and translatable attribute is looked up in lib/i18n-en.js (exact text first, then patterns).
// Anything not in the dictionary (product names, shop names, addresses typed by people) is left as is.
// Seller and admin portals are always Thai.
const C = require('./catalog');
const { EXACT, PATTERNS } = require('./i18n-en');

const LANGS = ['th', 'en'];
// Thai letters, not the baht sign (U+0E3F) which also appears in English prices.
const THAI = /[ก-ฺเ-๛]/;
const isCustomerPath = p => !/^\/(seller|admin)(\/|$)/.test(p);
const missing = new Set();

function translate(text) {
  if (!THAI.test(text)) return text;
  if (Object.prototype.hasOwnProperty.call(EXACT, text)) return EXACT[text];
  for (const [re, fn] of PATTERNS) {
    const m = text.match(re);
    if (m) return fn(m, translate);
  }
  // Composite labels like "นิทาน · 3–5 ปี": translate each part on its own.
  if (text.includes(' · ')) {
    const parts = text.split(' · ');
    const out = parts.map(p => translate(p) ?? p);
    if (out.some((p, i) => p !== parts[i])) return out.join(' · ');
  }
  return null; // not translated
}

// Keeps surrounding whitespace and separator punctuation ("· ", " ·", "+ ") outside the lookup.
function translateNode(raw) {
  const m = raw.match(/^(\s*(?:[·]\s*)?)([\s\S]*?)((?:\s*[·])?\s*)$/);
  const core = m[2].replace(/\s+/g, ' ');
  if (!core || !THAI.test(core)) return raw;
  const t = translate(core);
  if (t == null) {
    // I18N_DEBUG=1 lists text with no English (mostly product/shop names, which is expected).
    if (process.env.I18N_DEBUG && !missing.has(core)) { missing.add(core); console.log(`[i18n] no English for: ${core}`); }
    return raw;
  }
  return m[1] + t + m[3];
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const ATTR = /(\s(?:placeholder|aria-label|title|alt|data-confirm))="([^"]*)"/g;
const attrSub = (all, attr, val) => (THAI.test(val) ? `${attr}="${esc(translateNode(unesc(val)))}"` : all);
const attrs = tag => tag.replace(ATTR, attrSub);

// Translate text nodes and a few attributes; leave <script>, <style>, <textarea> and form values alone.
function translateHtml(html) {
  return html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<textarea[\s\S]*?<\/textarea>)/).map((chunk, i) => {
    // Skipped blocks: keep their content, but a <textarea>'s own attributes (placeholder, aria-label) still get translated.
    if (i % 2) return chunk.startsWith('<textarea') ? chunk.replace(/^<textarea[^>]*>/, tag => attrs(tag)) : chunk;
    return chunk
      .replace(/>([^<>]+)</g, (all, text) => (THAI.test(text) ? '>' + esc(translateNode(unesc(text))) + '<' : all))
      .replace(ATTR, attrSub);
  }).join('');
}

// Dates for English pages: Gregorian year, English month names, still Bangkok time.
const C_EN = Object.assign(Object.create(C), {
  dt: t => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '–'),
  day: t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }),
});

// Express middleware: pick the language, expose it to views, translate rendered customer pages.
function i18n(req, res, next) {
  const fromCookie = String(req.headers.cookie || '').match(/(?:^|;\s*)lang=(th|en)\b/)?.[1];
  const lang = isCustomerPath(req.path) && fromCookie === 'en' ? 'en' : 'th';
  res.locals.lang = lang;
  res.locals.langSwitch = isCustomerPath(req.path);
  if (lang === 'en') {
    res.locals.C = C_EN;
    const render = res.render.bind(res);
    res.render = (view, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      render(view, opts, (err, html) => {
        if (cb) return cb(err, err ? html : translateHtml(html));
        if (err) return req.next(err);
        res.send(translateHtml(html));
      });
    };
  }
  next();
}

// GET /lang/:code?back=/path → remember the choice for a year and go back.
function switchLang(req, res) {
  const lang = LANGS.includes(req.params.code) ? req.params.code : 'th';
  res.cookie('lang', lang, { maxAge: 365 * 864e5, sameSite: 'lax', httpOnly: false });
  const back = typeof req.query.back === 'string' && /^\/(?![\/\\])/.test(req.query.back) && isCustomerPath(req.query.back) ? req.query.back : '/';
  res.redirect(back);
}

module.exports = { i18n, switchLang, translate, translateHtml, missing };
