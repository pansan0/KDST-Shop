// Thai address picker: searchable province box, then district → sub-district lists, postcode filled in.
// The real values live in the plain <select>s (they post and validate without JS); this file only enhances them.
(() => {
  const boxes = document.querySelectorAll('[data-address]');
  if (!boxes.length) return;
  let dataP;
  const load = () => (dataP ||= fetch('/static/data/th-address.json').then(r => r.json()).then(d => new Map(d.provinces.map(([th, en, ds]) => [th, { en, ds: new Map(ds.map(([n, subs]) => [n, new Map(subs)])) }]))));
  const BKK = 'กรุงเทพมหานคร';
  // Page language (set by the server on <html lang>): province names stay Thai, the UI text follows the page.
  const EN = document.documentElement.lang === 'en';
  const labels = p => (EN ? ['District', 'Subdistrict'] : p === BKK ? ['เขต', 'แขวง'] : ['อำเภอ', 'ตำบล']);
  const pickText = l => (EN ? 'Choose a ' + l.toLowerCase() : 'เลือก' + l);
  const norm = s => s.toLowerCase().replace(/\s+/g, '');

  function fill(sel, names, placeholder) {
    sel.replaceChildren(new Option(placeholder, ''), ...names.map(n => new Option(n, n)));
    sel.disabled = !names.length;
  }

  boxes.forEach(box => {
    const prov = box.querySelector('[data-level=province]');
    const dist = box.querySelector('[data-level=district]');
    const sub = box.querySelector('[data-level=subdistrict]');
    const zip = box.querySelector('[data-level=postcode]');
    let tree = null;
    const setLabels = () => {
      const [dl, sl] = labels(prov.value);
      box.querySelector('[data-label=district]').textContent = dl;
      box.querySelector('[data-label=subdistrict]').textContent = sl;
      return [dl, sl];
    };
    const onProvince = () => {
      const [dl, sl] = setLabels();
      fill(dist, tree && prov.value ? [...tree.get(prov.value).ds.keys()] : [], pickText(dl));
      fill(sub, [], pickText(sl));
      zip.value = '';
    };
    const onDistrict = () => {
      const [, sl] = labels(prov.value);
      const d = tree?.get(prov.value)?.ds.get(dist.value);
      fill(sub, d ? [...d.keys()] : [], pickText(sl));
      zip.value = '';
    };
    const onSub = () => { zip.value = tree?.get(prov.value)?.ds.get(dist.value)?.get(sub.value) || zip.value; };
    dist.addEventListener('change', onDistrict);
    sub.addEventListener('change', onSub);

    /* ---- searchable province combobox (ARIA 1.2 combobox + listbox) ---- */
    const id = prov.id + '-list';
    const wrap = document.createElement('div');
    wrap.className = 'combo';
    const input = document.createElement('input');
    Object.assign(input, { type: 'text', autocomplete: 'off', placeholder: EN ? 'Type to search, e.g. Chon Buri' : 'พิมพ์ค้นหาจังหวัด เช่น ชลบุรี', value: prov.value });
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-label', EN ? 'Province' : 'จังหวัด');
    const list = document.createElement('ul');
    list.id = id;
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.append(input, list);
    prov.after(wrap);
    prov.hidden = true;
    // Point the label at the search box, and move "required" there: a hidden required <select> blocks submit silently.
    box.querySelector(`label[for="${prov.id}"]`).htmlFor = input.id = prov.id + '-search';
    if (prov.required) { input.required = true; prov.required = false; }

    const all = [...prov.options].filter(o => o.value).map(o => o.value);
    let shown = [], active = -1;
    const render = () => {
      const q = norm(input.value);
      const en = p => (tree?.get(p)?.en || '').toLowerCase().replace(/\s+/g, '');
      shown = !q || q === norm(prov.value) ? all
        : all.filter(p => norm(p).includes(q) || en(p).includes(q)).sort((a, b) => norm(b).startsWith(q) - norm(a).startsWith(q));
      list.replaceChildren(...(shown.length ? shown.map((p, i) => {
        const li = document.createElement('li');
        li.id = `${id}-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(p === prov.value));
        li.textContent = p;
        li.addEventListener('mousedown', e => { e.preventDefault(); choose(p); });
        return li;
      }) : [Object.assign(document.createElement('li'), { className: 'combo-empty', textContent: EN ? 'No province found' : 'ไม่พบจังหวัดนี้' })]));
      setActive(shown.length ? 0 : -1);
    };
    const setActive = i => {
      active = i;
      [...list.children].forEach((li, j) => li.classList.toggle('on', j === i));
      if (i >= 0) { input.setAttribute('aria-activedescendant', `${id}-${i}`); list.children[i].scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const open = () => { render(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    function choose(p) {
      const changed = p !== prov.value;
      prov.value = p;
      input.value = p;
      input.setCustomValidity('');
      close();
      if (changed) onProvince();
      dist.focus();
    }
    input.addEventListener('focus', () => { input.select(); open(); });
    input.addEventListener('input', open);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); else setActive(Math.min(shown.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
      else if (e.key === 'Enter' && !list.hidden) { e.preventDefault(); if (shown[active]) choose(shown[active]); }
      else if (e.key === 'Escape') { close(); input.value = prov.value; }
    });
    input.addEventListener('blur', () => {
      // Typed an exact name without picking from the list → accept it; otherwise snap back to the last valid choice.
      const exact = all.find(p => norm(p) === norm(input.value));
      if (exact && exact !== prov.value) choose(exact);
      else input.value = prov.value;
      close();
    });

    load().then(t => { tree = t; if (!dist.options.length || dist.options.length === 1) { if (prov.value) onProvince(); } });
  });
})();
