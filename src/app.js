/*
 * Iconsmith app: UI wiring. Plain browser JavaScript, no dependencies. MIT licence.
 */
(function () {
  'use strict';

  const R = window.IconsmithRender;
  const X = window.IconsmithExport;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const STORE = 'iconsmith.settings.v1';
  const dpr = () => Math.min(3, window.devicePixelRatio || 1);

  const FOLDER_COLOURS = [
    ['Blue', '#4AA3EE'], ['Graphite', '#8E8E93'], ['Red', '#E5534B'], ['Orange', '#F0913A'], ['Yellow', '#F2C94C'],
    ['Green', '#4CB86E'], ['Teal', '#3BB3C3'], ['Purple', '#9A6AE0'], ['Pink', '#E86FA8'], ['Dark', '#3D6A99']
  ];
  const BG_COLOURS = [
    ['White', '#FFFFFF'], ['Ink', '#2C2C2B'], ['Blue', '#2783DE'], ['Green', '#46A171'], ['Orange', '#D5803B'],
    ['Red', '#E56458'], ['Purple', '#8E5CD9'], ['Yellow', '#F2C94C'], ['Pink', '#E86FA8'], ['Teal', '#2FA7B8']
  ];

  /* ---------- state ---------- */

  function loadSettings() {
    const s = Object.assign({}, R.DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      for (const k of Object.keys(s)) if (k in saved && typeof saved[k] === typeof s[k]) s[k] = saved[k];
    } catch (e) { /* ignore */ }
    if (!R.TEMPLATES.some((t) => t.id === s.template)) s.template = R.DEFAULTS.template;
    return s;
  }

  const state = { s: loadSettings(), items: [], current: -1, busy: false };
  const glyphCache = { key: '', art: null };
  let nextId = 1;

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state.s)); } catch (e) { /* ignore */ }
  }

  function artFor(item, thumb) {
    const key = R.artKey(state.s);
    if (thumb) {
      if (item.thumbKey !== key) { item.thumbArt = R.processArt(item.thumbSource, state.s); item.thumbKey = key; }
      return item.thumbArt;
    }
    if (item.artKey !== key) { item.art = R.processArt(item.source, state.s); item.artKey = key; }
    return item.art;
  }

  function glyphArt() {
    const key = R.glyphKey(state.s);
    if (glyphCache.key !== key) { glyphCache.art = R.processArt(R.renderGlyph(state.s), state.s, true); glyphCache.key = key; }
    return glyphCache.art;
  }

  function currentItem() { return state.items[state.current] || null; }

  function currentArt(thumb) {
    if (state.s.source === 'glyph') return glyphArt();
    const item = currentItem();
    return item ? artFor(item, thumb) : null;
  }

  function currentBase() {
    if (state.s.source === 'glyph') return 'icon';
    const item = currentItem();
    return item ? item.base : 'icon';
  }

  /* ---------- toast ---------- */

  let toastTimer = 0;
  function toast(message, ms) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 3600);
  }

  /* ---------- rendering ---------- */

  const preview = $('#preview');
  const sizeCanvases = [];
  const templateCanvases = new Map();
  let frame = 0;

  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  function draw() {
    const art = currentArt(false);
    const css = preview.clientWidth || 400;
    R.render(Math.min(1024, Math.round(css * dpr())), state.s, art, { canvas: preview });
    preview.setAttribute('aria-label', `Icon preview, ${templateName(state.s.template)} template`);
    for (const { size, canvas } of sizeCanvases) R.render(Math.round(size * dpr()), state.s, art, { canvas });
    $('#emptyHint').hidden = !!art;

    const thumbArt = currentArt(true);
    for (const t of R.TEMPLATES) {
      R.render(Math.round(56 * dpr()), state.s, thumbArt, { canvas: templateCanvases.get(t.id), template: t.id });
    }
    renderBatch();
  }

  function templateName(id) {
    const t = R.TEMPLATES.find((x) => x.id === id);
    return t ? t.name : id;
  }

  function buildSizeStrip() {
    const strip = $('#sizeStrip');
    for (const size of [16, 32, 64, 128]) {
      const fig = document.createElement('figure');
      const c = document.createElement('canvas');
      c.style.width = c.style.height = size + 'px';
      c.setAttribute('aria-hidden', 'true');
      const cap = document.createElement('figcaption');
      cap.textContent = `${size} px`;
      fig.append(c, cap);
      strip.append(fig);
      sizeCanvases.push({ size, canvas: c });
    }
  }

  function buildTemplateGrid() {
    const root = $('#templateGrid');
    const groups = [];
    for (const t of R.TEMPLATES) {
      let g = groups.find((x) => x.name === t.group);
      if (!g) { g = { name: t.group, items: [] }; groups.push(g); }
      g.items.push(t);
    }
    for (const g of groups) {
      const wrap = document.createElement('div');
      wrap.className = 'tgroup';
      const h = document.createElement('h3');
      h.textContent = g.name;
      const grid = document.createElement('div');
      grid.className = 'tgrid';
      for (const t of g.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tbtn';
        b.dataset.template = t.id;
        const c = document.createElement('canvas');
        c.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = t.name;
        b.append(c, label);
        b.addEventListener('click', () => set('template', t.id));
        templateCanvases.set(t.id, c);
        grid.append(b);
      }
      wrap.append(h, grid);
      root.append(wrap);
    }
  }

  function buildSwatches() {
    for (const box of $$('[data-swatch-target]')) {
      const target = box.dataset.swatchTarget;
      const list = target === 'folderColor' ? FOLDER_COLOURS : BG_COLOURS;
      for (const [name, hex] of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.setProperty('--c', hex);
        b.dataset.colour = hex;
        b.setAttribute('aria-label', name);
        b.title = name;
        b.addEventListener('click', () => {
          if (target === 'colorA') {
            const b2 = hex === '#FFFFFF' ? '#E6E5E3' : R.shade(hex, -0.18);
            Object.assign(state.s, { colorA: hex, colorB: b2 });
            if (state.s.bgType === 'none') state.s.bgType = 'gradient';
            save(); syncUI(); schedule();
          } else {
            set(target, hex);
          }
        });
        box.append(b);
      }
    }
  }

  /* ---------- batch ---------- */

  const batchCanvases = new Map();

  function renderBatch() {
    const card = $('#batchCard');
    card.hidden = state.items.length < 2;
    if (card.hidden) return;
    $('#batchCount').textContent = `${state.items.length} images`;
    for (const item of state.items) {
      const c = batchCanvases.get(item.id);
      if (c) R.render(Math.round(48 * dpr()), state.s, artFor(item, true), { canvas: c });
    }
  }

  function rebuildBatchList() {
    const list = $('#batchList');
    list.textContent = '';
    batchCanvases.clear();
    state.items.forEach((item, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'batch-item';
      b.setAttribute('aria-pressed', String(i === state.current && state.s.source === 'image'));
      b.title = item.name;
      const c = document.createElement('canvas');
      c.setAttribute('aria-hidden', 'true');
      const span = document.createElement('span');
      span.textContent = item.base;
      b.append(c, span);
      b.addEventListener('click', () => {
        state.current = i;
        state.s.source = 'image';
        save(); syncUI(); rebuildBatchList(); schedule();
      });
      batchCanvases.set(item.id, c);
      li.append(b);
      list.append(li);
    });
  }

  /* ---------- controls ---------- */

  function set(key, value) {
    state.s[key] = value;
    save();
    syncUI();
    schedule();
  }

  function readControl(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.dataset.type === 'number') return Number(el.value);
    return el.value;
  }

  function bindControls() {
    for (const el of $$('[data-setting]')) {
      const key = el.dataset.setting;
      const live = el.type === 'range' || el.type === 'text' || el.type === 'color';
      el.addEventListener(live ? 'input' : 'change', () => {
        if (el.type === 'radio' && !el.checked) return;
        set(key, readControl(el));
      });
    }
  }

  function formatValue(key, el) {
    const v = state.s[key];
    const unit = el.dataset.unit || '';
    if (unit) return `${v}${unit}`;
    return v > 0 && key !== 'bgTolerance' && key !== 'bgSoftness' && key !== 'labelSize' ? `+${v}` : String(v);
  }

  function syncUI() {
    const s = state.s;
    for (const el of $$('[data-setting]')) {
      const v = s[el.dataset.setting];
      if (el.type === 'radio') el.checked = String(v) === el.value;
      else if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el || el.type === 'range') el.value = String(v);
    }
    for (const out of $$('output[data-for]')) out.textContent = formatValue(out.dataset.for, out);
    for (const el of $$('[data-show]')) {
      const [key, values] = el.dataset.show.split('=');
      el.hidden = !values.split(',').includes(String(s[key]));
    }
    for (const b of $$('.tbtn')) b.setAttribute('aria-pressed', String(b.dataset.template === s.template));
    for (const box of $$('[data-swatch-target]')) {
      const v = String(s[box.dataset.swatchTarget]).toUpperCase();
      for (const sw of $$('.swatch', box)) sw.setAttribute('aria-pressed', String(sw.dataset.colour.toUpperCase() === v));
    }
    for (const el of $$('[data-size-label]')) el.textContent = `${s.exportSize} px`;
    const item = currentItem();
    const showName = s.source === 'image' && item;
    $('#sourceName').textContent = showName ? item.name : s.source === 'glyph' ? 'Emoji or text' : '';
    $('#removeCurrent').hidden = !showName;
  }

  /* ---------- files ---------- */

  const IMAGE_NAME = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|heif|tiff?)$/i;

  async function decodeFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return R.sourceFromImage(img, file.type === 'image/svg+xml' || /\.svg$/i.test(file.name));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => (f.type && f.type.startsWith('image/')) || IMAGE_NAME.test(f.name));
    if (!files.length) { toast('Those files are not images this browser can read.'); return; }
    const failed = [];
    let first = -1;
    for (const file of files) {
      try {
        const source = await decodeFile(file);
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'icon';
        state.items.push({ id: nextId++, name: file.name, base, source, thumbSource: R.downscale(source, 256), artKey: '', thumbKey: '' });
        if (first < 0) first = state.items.length - 1;
      } catch (e) {
        failed.push(file.name);
      }
    }
    if (first >= 0) {
      state.current = first;
      state.s.source = 'image';
      save();
      syncUI();
      rebuildBatchList();
      schedule();
    }
    if (failed.length) toast(`Could not read ${failed.join(', ')}. Try PNG or JPG.`);
    else if (files.length > 1) toast(`Added ${files.length} images. Use Batch to export them all.`);
  }

  function removeCurrent() {
    if (state.current < 0) return;
    state.items.splice(state.current, 1);
    state.current = Math.min(state.current, state.items.length - 1);
    syncUI();
    rebuildBatchList();
    schedule();
  }

  /* ---------- export ---------- */

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const b of $$('.export-btn, #batchExport')) b.disabled = busy;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  async function exportFormat(format) {
    if (state.busy) return;
    const art = currentArt(false);
    if (!art && (state.s.template === 'plain' || state.s.template === 'sticker')) {
      toast('Add an image or some emoji first.');
      return;
    }
    setBusy(true);
    toast('Exporting…', 60000);
    try {
      await nextFrame();
      const { blob, filename } = await X.exportDesign(format, Object.assign({}, state.s), art, currentBase());
      download(blob, filename);
      toast(`Saved ${filename}`);
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportBatch() {
    if (state.busy || state.items.length < 2) return;
    const format = $('#batchFormat').value;
    setBusy(true);
    try {
      const items = [];
      for (let i = 0; i < state.items.length; i++) {
        toast(`Preparing ${i + 1} of ${state.items.length}…`, 60000);
        await nextFrame();
        items.push({ base: state.items[i].base, art: artFor(state.items[i], false) });
      }
      const { blob, filename } = await X.exportBatch(format, Object.assign({}, state.s), items, (n, total) => toast(`Exported ${n} of ${total}…`, 60000));
      download(blob, filename);
      toast(`Saved ${filename}`);
    } catch (e) {
      console.error(e);
      toast(`Batch export failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyImage() {
    const canvas = R.render(1024, state.s, currentArt(false));
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': X.canvasBlob(canvas, 'image/png') })]);
      toast('Copied. In Finder, press ⌘I on a file or folder, click its icon, then press ⌘V.', 6000);
    } catch (e) {
      toast('This browser cannot copy images here. Export a PNG instead.');
    }
  }

  /* ---------- events ---------- */

  function bindEvents() {
    $('#fileInput').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
    $('#removeCurrent').addEventListener('click', removeCurrent);
    $('#resetBtn').addEventListener('click', () => {
      state.s = Object.assign({}, R.DEFAULTS, { source: state.s.source, glyph: state.s.glyph });
      save(); syncUI(); schedule();
      toast('Style reset.');
    });
    $('#recentre').addEventListener('click', () => {
      Object.assign(state.s, { scale: 100, offsetX: 0, offsetY: 0 });
      save(); syncUI(); schedule();
    });
    $('#resetTuning').addEventListener('click', () => {
      Object.assign(state.s, { brightness: 0, contrast: 0, saturation: 0, hue: 0, removeBg: false });
      save(); syncUI(); schedule();
    });
    for (const b of $$('.export-btn')) b.addEventListener('click', () => exportFormat(b.dataset.format));
    $('#batchExport').addEventListener('click', exportBatch);
    $('#copyBtn').addEventListener('click', copyImage);
    for (const r of $$('input[name="previewBg"]')) {
      r.addEventListener('change', () => { if (r.checked) $('#dropZone').dataset.bg = r.value; });
    }

    const overlay = $('#dropOverlay');
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.hidden = false; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      loadFiles(e.dataTransfer.files);
    });
    document.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); loadFiles(files); }
    });
    window.addEventListener('resize', schedule);
  }

  function init() {
    buildSizeStrip();
    buildTemplateGrid();
    buildSwatches();
    bindControls();
    bindEvents();
    syncUI();
    schedule();
  }

  init();

  // Small hook for automated tests and power users.
  window.Iconsmith = { state, loadFiles, exportFormat, exportBatch, set };
})();
