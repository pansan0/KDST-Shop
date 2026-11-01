// Custom options for handmade products (e.g. bracelet size, bead colour, name on beads).
// Stored as JSON on products.options:
//   { id, type: 'select'|'swatch'|'text'|'range', label, required,
//     values: [{ label, price, color }]          // select / swatch
//     max_len, charset: 'upper'|'any', price      // text: flat extra when filled
//     min, max, step, unit }                      // range
const C = require('./catalog');

const MAX_OPTIONS = 5;
const MAX_VALUES = 12;
const HEX = /^#[0-9a-f]{6}$/i;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const num = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// Seller form → option list. Value lines are "label | +price | #colour" (price and colour optional).
function parseSellerOptions(body) {
  const out = [], errors = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const type = body[`opt_type_${i}`];
    const label = str(body[`opt_label_${i}`], 40);
    if (!C.OPTION_TYPES[type] || !label) continue;
    const o = { id: 'o' + i, type, label, required: !!body[`opt_req_${i}`] };
    if (type === 'select' || type === 'swatch') {
      o.values = String(body[`opt_values_${i}`] || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, MAX_VALUES).map(line => {
        const [name, price, color] = line.split('|').map(s => s.trim());
        return { label: str(name, 30), price: int((price || '').replace(/[+฿,\s]/g, ''), 0, 100000, 0), color: HEX.test(color || '') ? color : '' };
      }).filter(v => v.label);
      if (o.values.length < 2) errors.push(`ตัวเลือก “${label}” ต้องมีอย่างน้อย 2 ค่า (บรรทัดละ 1 ค่า)`);
    } else if (type === 'text') {
      o.max_len = int(body[`opt_maxlen_${i}`], 1, 40, 10);
      o.charset = body[`opt_charset_${i}`] === 'upper' ? 'upper' : 'any';
      o.price = int(body[`opt_price_${i}`], 0, 100000, 0);
    } else {
      o.min = num(body[`opt_min_${i}`], 0, 10000, 0);
      o.max = num(body[`opt_max_${i}`], 0, 10000, 0);
      o.step = num(body[`opt_step_${i}`], 0.1, 1000, 0.5);
      o.unit = str(body[`opt_unit_${i}`], 10);
      if (!(o.max > o.min)) errors.push(`ตัวเลือก “${label}” ค่าสูงสุดต้องมากกว่าค่าต่ำสุด`);
    }
    out.push(o);
  }
  return { options: out, errors };
}

const TEXT_RE = { upper: /^[A-Z0-9 ♥]*$/, any: /^[^<>]*$/ };

// Buyer selection (opt_<id> fields) → { lines: [{label, value}], extra, key, errors }.
function readSelection(options, body) {
  const lines = [], errors = [];
  let extra = 0;
  for (const o of options) {
    const raw = body['opt_' + o.id];
    if (o.type === 'select' || o.type === 'swatch') {
      const idx = raw === undefined || raw === '' ? -1 : parseInt(raw, 10);
      const v = o.values[idx];
      if (!v) { if (o.required) errors.push(`เลือก${o.label}`); continue; }
      lines.push({ label: o.label, value: v.label });
      extra += v.price;
    } else if (o.type === 'text') {
      let t = str(raw, 60);
      if (o.charset === 'upper') t = t.toUpperCase();
      if (!t) { if (o.required) errors.push(`กรอก${o.label}`); continue; }
      if (t.length > o.max_len) errors.push(`${o.label} ยาวได้ไม่เกิน ${o.max_len} ตัว`);
      else if (!TEXT_RE[o.charset].test(t)) errors.push(o.charset === 'upper' ? `${o.label} ใช้ได้เฉพาะ A–Z, 0–9 และ ♥` : `${o.label} มีอักขระที่ใช้ไม่ได้`);
      else { lines.push({ label: o.label, value: t }); extra += o.price; }
    } else {
      if (raw === undefined || raw === '') { if (o.required) errors.push(`ใส่${o.label}`); continue; }
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n < o.min || n > o.max) errors.push(`${o.label} ต้องอยู่ระหว่าง ${o.min}–${o.max} ${o.unit}`);
      else lines.push({ label: o.label, value: `${n} ${o.unit}`.trim() });
    }
  }
  return { lines, extra, key: JSON.stringify(lines), errors };
}

const parse = json => { try { return JSON.parse(json || '[]'); } catch { return []; } };

// Back from stored option list to the seller form's flat fields (for editing).
function toFormFields(options) {
  const f = {};
  options.forEach((o, i) => {
    f[`opt_type_${i}`] = o.type; f[`opt_label_${i}`] = o.label; f[`opt_req_${i}`] = o.required;
    if (o.values) f[`opt_values_${i}`] = o.values.map(v => [v.label, ...(v.price || v.color ? ['+' + v.price] : []), ...(v.color ? [v.color] : [])].join(' | ')).join('\n');
    if (o.type === 'text') Object.assign(f, { [`opt_maxlen_${i}`]: o.max_len, [`opt_charset_${i}`]: o.charset, [`opt_price_${i}`]: o.price });
    if (o.type === 'range') Object.assign(f, { [`opt_min_${i}`]: o.min, [`opt_max_${i}`]: o.max, [`opt_step_${i}`]: o.step, [`opt_unit_${i}`]: o.unit });
  });
  return f;
}

module.exports = { MAX_OPTIONS, parseSellerOptions, readSelection, parse, toFormFields };
