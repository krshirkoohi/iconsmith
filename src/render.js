/*
 * Iconsmith render engine: image processing and procedural icon templates.
 * All templates are drawn in a 1024-unit coordinate space, then scaled.
 * Plain browser JavaScript, no dependencies. MIT licence.
 */
(function (global) {
  'use strict';

  const UNIT = 1024;
  const MAX_SOURCE = 1536;

  const FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", -apple-system, "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace'
  };
  const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"';

  const DEFAULTS = Object.freeze({
    template: 'macos',
    shadow: true,
    source: 'image',
    glyph: '🚀',
    glyphColor: '#2783DE',
    glyphFont: 'system',
    fit: 'contain',
    scale: 100,
    offsetX: 0,
    offsetY: 0,
    bgType: 'gradient',
    colorA: '#FFFFFF',
    colorB: '#E6E5E3',
    folderColor: '#4AA3EE',
    folderStyle: 'auto',
    androidMask: 'circle',
    overlay: 'none',
    badgeText: '★',
    badgeColor: '#E56458',
    badgeTextColor: '#FFFFFF',
    badgeCorner: 'br',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    removeBg: false,
    bgTolerance: 15,
    bgSoftness: 10,
    trim: true,
    label: '',
    labelStyle: 'pill',
    labelColor: '#FFFFFF',
    labelBg: '#2C2C2B',
    labelSize: 12,
    labelPos: 'bottom',
    labelFont: 'system',
    exportSize: 1024,
    jpgBg: '#FFFFFF'
  });

  const TEMPLATES = [
    { id: 'macos', name: 'macOS', group: 'Platforms' },
    { id: 'ios', name: 'iOS', group: 'Platforms' },
    { id: 'watchos', name: 'watchOS', group: 'Platforms' },
    { id: 'android', name: 'Android', group: 'Platforms' },
    { id: 'folder', name: 'Folder', group: 'Mac' },
    { id: 'document', name: 'Document', group: 'Mac' },
    { id: 'drive', name: 'Drive', group: 'Mac' },
    { id: 'disc', name: 'Disc', group: 'Mac' },
    { id: 'plain', name: 'Plain', group: 'Shapes' },
    { id: 'circle', name: 'Round', group: 'Shapes' },
    { id: 'square', name: 'Square', group: 'Shapes' },
    { id: 'badge', name: 'Badge', group: 'Shapes' },
    { id: 'sticker', name: 'Sticker', group: 'Objects' },
    { id: 'vinyl', name: 'Vinyl', group: 'Objects' },
    { id: 'floppy', name: 'Floppy', group: 'Objects' },
    { id: 'photo', name: 'Polaroid', group: 'Objects' }
  ];

  /* ---------- helpers ---------- */

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const n = parseInt(m ? m[1] : '000000', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  }

  function mix(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }

  function shade(hex, amount) {
    return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount);
  }

  function squirclePath(ctx, box, n) {
    const exp = 2 / (n || 5);
    const a = box.w / 2, b = box.h / 2, cx = box.x + a, cy = box.y + b;
    const steps = 256;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      const x = cx + a * Math.sign(c) * Math.pow(Math.abs(c), exp);
      const y = cy + b * Math.sign(s) * Math.pow(Math.abs(s), exp);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Continuous-curvature rounded rectangle (the "smooth corner" shape used by
  // Apple app icons). Bezier constants from the widely published iOS 7 approximation.
  function continuousRectPath(ctx, x, y, w, h, r) {
    const k = 1.52866483, a = 1.08849323, b = 0.86840689, c = 0.66993427, d = 0.065496, e = 0.37282392, f = 0.18278246;
    r = Math.min(r, Math.min(w, h) / 2 / k);
    const L = x, T = y, R = x + w, B = y + h;
    ctx.beginPath();
    ctx.moveTo(L + k * r, T);
    ctx.lineTo(R - k * r, T);
    ctx.bezierCurveTo(R - a * r, T, R - b * r, T, R - c * r, T + d * r);
    ctx.bezierCurveTo(R - e * r, T + f * r, R - f * r, T + e * r, R - d * r, T + c * r);
    ctx.bezierCurveTo(R, T + b * r, R, T + a * r, R, T + k * r);
    ctx.lineTo(R, B - k * r);
    ctx.bezierCurveTo(R, B - a * r, R, B - b * r, R - d * r, B - c * r);
    ctx.bezierCurveTo(R - f * r, B - e * r, R - e * r, B - f * r, R - c * r, B - d * r);
    ctx.bezierCurveTo(R - b * r, B, R - a * r, B, R - k * r, B);
    ctx.lineTo(L + k * r, B);
    ctx.bezierCurveTo(L + a * r, B, L + b * r, B, L + c * r, B - d * r);
    ctx.bezierCurveTo(L + e * r, B - f * r, L + f * r, B - e * r, L + d * r, B - c * r);
    ctx.bezierCurveTo(L, B - b * r, L, B - a * r, L, B - k * r);
    ctx.lineTo(L, T + k * r);
    ctx.bezierCurveTo(L, T + a * r, L, T + b * r, L + d * r, T + c * r);
    ctx.bezierCurveTo(L + f * r, T + e * r, L + e * r, T + f * r, L + c * r, T + d * r);
    ctx.bezierCurveTo(L + b * r, T, L + a * r, T, L + k * r, T);
    ctx.closePath();
  }

  function cornerRectPath(ctx, x, y, w, h, tl, tr, br, bl) {
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.arcTo(x + w, y, x + w, y + h, tr);
    ctx.arcTo(x + w, y + h, x, y + h, br);
    ctx.arcTo(x, y + h, x, y, bl);
    ctx.arcTo(x, y, x + w, y, tl);
    ctx.closePath();
  }

  // Android adaptive icon masks (as offered by launchers).
  function androidMaskPath(ctx, kind, b) {
    if (kind === 'squircle') squirclePath(ctx, b, 4);
    else if (kind === 'rounded') roundRectPath(ctx, b.x, b.y, b.w, b.h, b.w * 0.16);
    else if (kind === 'teardrop') cornerRectPath(ctx, b.x, b.y, b.w, b.h, b.w / 2, b.w / 2, b.w * 0.1, b.w / 2);
    else circlePath(ctx, b);
  }

  function isLight(hex) {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
  }

  function circlePath(ctx, box) {
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, 0, Math.PI * 2);
    ctx.closePath();
  }

  /* ---------- sources ---------- */

  function sourceFromImage(img, isSvg) {
    let w = img.naturalWidth || img.width || UNIT;
    let h = img.naturalHeight || img.height || UNIT;
    let k = Math.min(1, MAX_SOURCE / Math.max(w, h));
    if (isSvg && Math.max(w, h) < UNIT) k = UNIT / Math.max(w, h);
    const c = makeCanvas(w * k, h * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function downscale(canvas, max) {
    const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
    if (k === 1) return canvas;
    const c = makeCanvas(canvas.width * k, canvas.height * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }

  function renderGlyph(s) {
    const size = 1200;
    const c = makeCanvas(size, size);
    const x = c.getContext('2d');
    const text = String(s.glyph || '').trim() || '★';
    let px = 760;
    const family = (FONTS[s.glyphFont] || FONTS.system) + ', ' + EMOJI_FONTS;
    x.font = `700 ${px}px ${family}`;
    const w = x.measureText(text).width;
    if (w > 1080) { px *= 1080 / w; x.font = `700 ${px}px ${family}`; }
    x.fillStyle = s.glyphColor;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, size / 2, size / 2);
    return c;
  }

  /* ---------- processing ---------- */

  function applyTuning(d, s) {
    const doHue = s.hue !== 0, sat = 1 + s.saturation / 100;
    const c = s.contrast * 2.55, cf = (259 * (c + 255)) / (255 * (259 - c));
    const br = s.brightness * 1.28;
    const h = (s.hue * Math.PI) / 180, cos = Math.cos(h), sin = Math.sin(h);
    const m = [
      0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072
    ];
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (doHue) {
        const r2 = m[0] * r + m[1] * g + m[2] * b;
        const g2 = m[3] * r + m[4] * g + m[5] * b;
        const b2 = m[6] * r + m[7] * g + m[8] * b;
        r = r2; g = g2; b = b2;
      }
      if (sat !== 1) {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      }
      if (c !== 0) { r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128; }
      if (br !== 0) { r += br; g += br; b += br; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }

  // Flood-fill removal of a flat background that touches the image edges.
  function removeBackground(img, tolerance, softness) {
    const { width: w, height: h, data: d } = img;
    const buckets = new Map();
    const visitBorder = (fn) => {
      for (let x = 0; x < w; x++) { fn(x); fn((h - 1) * w + x); }
      for (let y = 1; y < h - 1; y++) { fn(y * w); fn(y * w + w - 1); }
    };
    visitBorder((p) => {
      const q = p * 4;
      if (d[q + 3] < 16) return;
      const key = ((d[q] >> 4) << 8) | ((d[q + 1] >> 4) << 4) | (d[q + 2] >> 4);
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += d[q]; e.g += d[q + 1]; e.b += d[q + 2];
      buckets.set(key, e);
    });
    let best = null;
    for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
    if (!best) return; // border already transparent
    const br = best.r / best.n, bg = best.g / best.n, bb = best.b / best.n;
    const t0 = tolerance * 2.2, t1 = t0 + softness * 2.2 + 1;
    const dist = (q) => (d[q + 3] < 16 ? 0 : Math.sqrt((d[q] - br) ** 2 + (d[q + 1] - bg) ** 2 + (d[q + 2] - bb) ** 2));
    const seen = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    const consider = (p) => {
      if (seen[p]) return;
      const q = p * 4, dd = dist(q);
      if (dd <= t0) { seen[p] = 1; d[q + 3] = 0; queue[tail++] = p; }
      else if (dd < t1) { seen[p] = 1; d[q + 3] = Math.round(d[q + 3] * ((dd - t0) / (t1 - t0))); }
    };
    visitBorder(consider);
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p / w) | 0;
      if (x > 0) consider(p - 1);
      if (x < w - 1) consider(p + 1);
      if (y > 0) consider(p - w);
      if (y < h - 1) consider(p + w);
    }
  }

  function alphaBounds(img) {
    const { width: w, height: h, data: d } = img;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function buildMips(canvas) {
    const mips = [canvas];
    let cur = canvas;
    while (Math.min(cur.width, cur.height) > 24) {
      const next = makeCanvas(cur.width / 2, cur.height / 2);
      const x = next.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, next.width, next.height);
      mips.push(next);
      cur = next;
    }
    return mips;
  }

  function artKey(s) {
    return JSON.stringify([s.brightness, s.contrast, s.saturation, s.hue, s.removeBg, s.bgTolerance, s.bgSoftness, s.trim]);
  }

  function glyphKey(s) {
    return JSON.stringify([s.glyph, s.glyphColor, s.glyphFont, artKey(s)]);
  }

  /** Apply tuning, background removal and trimming. Returns an art object. */
  function processArt(source, s, isGlyph) {
    const w = source.width, h = source.height;
    let canvas = makeCanvas(w, h);
    let ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    if (s.brightness || s.contrast || s.saturation || s.hue) applyTuning(img.data, s);
    if (s.removeBg && !isGlyph) removeBackground(img, s.bgTolerance, s.bgSoftness);
    ctx.putImageData(img, 0, 0);

    let transparent = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) transparent++;
    const hasAlpha = transparent > (w * h) / 200;

    if (s.trim || isGlyph) {
      const b = alphaBounds(img);
      if (b && (b.w < w || b.h < h)) {
        const cropped = makeCanvas(b.w, b.h);
        cropped.getContext('2d').drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        canvas = cropped;
      }
    }
    return { canvas, mips: buildMips(canvas), hasAlpha, emboss: null };
  }

  function embossOf(art) {
    if (art.emboss) return art.emboss;
    const src = art.canvas, w = src.width, h = src.height;
    const c = makeCanvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0);
    const img = x.getImageData(0, 0, w, h), d = img.data;
    if (art.hasAlpha) {
      // Keep the silhouette, but carve out near-white details so they stay visible.
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        if (l > 0.82) d[i + 3] = Math.round(d[i + 3] * Math.max(0, 1 - (l - 0.82) / 0.12));
        d[i] = d[i + 1] = d[i + 2] = 0;
      }
    } else {
      const lum = new Float32Array(w * h);
      let lo = 255, hi = 0;
      for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        lum[p] = l; if (l < lo) lo = l; if (l > hi) hi = l;
      }
      const range = Math.max(1, hi - lo);
      for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
        const ink = (hi - lum[p]) / range;
        d[i] = d[i + 1] = d[i + 2] = 0;
        d[i + 3] = Math.round(Math.pow(ink, 1.1) * d[i + 3]);
      }
    }
    x.putImageData(img, 0, 0);
    art.emboss = { canvas: c, mips: buildMips(c) };
    return art.emboss;
  }

  /* ---------- drawing ---------- */

  function pickMip(art, pixelWidth) {
    let best = art.mips[0];
    for (const m of art.mips) { if (m.width >= pixelWidth) best = m; else break; }
    return best;
  }

  function place(art, box, s, pad) {
    const aw = art.canvas.width, ah = art.canvas.height;
    let inner = box;
    if (s.fit !== 'cover' && pad) {
      inner = { x: box.x + (box.w * pad) / 2, y: box.y + (box.h * pad) / 2, w: box.w * (1 - pad), h: box.h * (1 - pad) };
    }
    let k = s.fit === 'cover' ? Math.max(inner.w / aw, inner.h / ah) : Math.min(inner.w / aw, inner.h / ah);
    k *= s.scale / 100;
    const w = aw * k, h = ah * k;
    return {
      x: box.x + box.w / 2 - w / 2 + (s.offsetX / 100) * box.w,
      y: box.y + box.h / 2 - h / 2 + (s.offsetY / 100) * box.h,
      w, h
    };
  }

  function drawArt(ctx, art, r, u) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pickMip(art, r.w * u), r.x, r.y, r.w, r.h);
  }

  function shadowOn(ctx, s, u, blur, y, alpha) {
    if (!s.shadow) return;
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur * u;
    ctx.shadowOffsetY = y * u;
  }

  function paintFor(ctx, s, box, fallback) {
    if (s.bgType === 'none') return fallback || null;
    if (s.bgType === 'solid') return s.colorA;
    const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    g.addColorStop(0, s.colorA);
    g.addColorStop(1, s.colorB);
    return g;
  }

  // Draws art into a full-size offscreen layer, so it can be tinted or outlined.
  function artLayer(S, u, art, r) {
    const layer = makeCanvas(S, S);
    const x = layer.getContext('2d');
    x.setTransform(u, 0, 0, u, 0, 0);
    drawArt(x, art, r, u);
    return layer;
  }

  function tint(layer, colour) {
    const x = layer.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = colour;
    x.fillRect(0, 0, layer.width, layer.height);
    return layer;
  }

  function blit(ctx, layer, dx, dy, alpha) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.drawImage(layer, dx || 0, dy || 0);
    ctx.restore();
  }

  function drawLabel(ctx, s, face, yOverride) {
    const text = String(s.label || '').trim();
    if (!text) return;
    const family = (FONTS[s.labelFont] || FONTS.system) + ', ' + EMOJI_FONTS;
    const pill = s.labelStyle === 'pill';
    let px = (s.labelSize / 100) * UNIT;
    ctx.font = `700 ${px}px ${family}`;
    let w = ctx.measureText(text).width;
    const maxW = face.w * 0.86 - (pill ? px * 0.9 : 0);
    if (w > maxW) { px *= maxW / w; ctx.font = `700 ${px}px ${family}`; w = ctx.measureText(text).width; }
    const pos = s.labelPos;
    const x = face.x + face.w / 2;
    const y = yOverride !== undefined ? yOverride
      : pos === 'top' ? face.y + face.h * 0.2
      : pos === 'middle' ? face.y + face.h / 2
      : face.y + face.h * 0.8;
    ctx.save();
    ctx.shadowColor = 'transparent';
    if (pill) {
      const padX = px * 0.45, ph = px * 1.4;
      roundRectPath(ctx, x - w / 2 - padX, y - ph / 2, w + padX * 2, ph, ph / 2);
      ctx.fillStyle = s.labelBg;
      ctx.fill();
    }
    ctx.fillStyle = s.labelColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + px * 0.04);
    ctx.restore();
  }

  function drawOverlay(ctx, s, u) {
    if (s.overlay === 'alias') {
      const x = 84, y = 708, w = 232;
      ctx.save();
      if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 12 * u; ctx.shadowOffsetY = 4 * u; }
      roundRectPath(ctx, x, y, w, w, 46);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = '#1D1D1F';
      ctx.fillStyle = '#1D1D1F';
      ctx.lineWidth = 32;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 62, y + w - 52);
      ctx.bezierCurveTo(x + 58, y + 126, x + 92, y + 98, x + 138, y + 96);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 192, y + 96);
      ctx.lineTo(x + 126, y + 44);
      ctx.lineTo(x + 126, y + 148);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    } else if (s.overlay === 'badge') {
      const D = 340, m = 34;
      const cx = s.badgeCorner.endsWith('l') ? m + D / 2 : UNIT - m - D / 2;
      const cy = s.badgeCorner.startsWith('t') ? m + D / 2 : UNIT - m - D / 2;
      ctx.save();
      if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 14 * u; ctx.shadowOffsetY = 5 * u; }
      ctx.beginPath(); ctx.arc(cx, cy, D / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, D / 2 - 18, 0, Math.PI * 2);
      ctx.fillStyle = s.badgeColor;
      ctx.fill();
      const text = String(s.badgeText || '').trim();
      if (text) {
        const family = FONTS.system + ', ' + EMOJI_FONTS;
        let px = D * 0.5;
        ctx.font = `700 ${px}px ${family}`;
        const w = ctx.measureText(text).width, max = D * 0.66;
        if (w > max) { px *= max / w; ctx.font = `700 ${px}px ${family}`; }
        ctx.fillStyle = s.badgeTextColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cx, cy + px * 0.05);
      }
      ctx.restore();
    }
  }

  /* ---------- templates ---------- */

  const draw = {
    plain(ctx, s, art, u) {
      const box = { x: 0, y: 0, w: UNIT, h: UNIT };
      if (art) {
        ctx.save();
        shadowOn(ctx, s, u, 24, 10, 0.3);
        drawArt(ctx, art, place(art, box, s, 0.12), u);
        ctx.restore();
      }
      return { face: box };
    },

    // macOS (Big Sur and later) grid: 1024 canvas, 824 x 824 body, 100 margin, radius 185.4.
    macos(ctx, s, art, u) {
      const body = { x: 100, y: 100, w: 824, h: 824 };
      const shape = () => continuousRectPath(ctx, body.x, body.y, body.w, body.h, 185.4);
      const paint = paintFor(ctx, s, body);
      if (paint) {
        ctx.save();
        shadowOn(ctx, s, u, 28, 12, 0.3);
        shape();
        ctx.fillStyle = paint;
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      shape();
      ctx.clip();
      if (art) drawArt(ctx, art, place(art, body, s, 0.28), u);
      if (paint) {
        shape();
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,0.07)';
        ctx.stroke();
      }
      ctx.restore();
      return { face: body };
    },

    // iOS / iPadOS: full-bleed opaque square; the system applies this mask.
    ios(ctx, s, art, u) {
      const body = { x: 0, y: 0, w: UNIT, h: UNIT };
      ctx.save();
      continuousRectPath(ctx, 0, 0, UNIT, UNIT, UNIT * 0.2237);
      ctx.clip();
      ctx.fillStyle = paintFor(ctx, s, body, '#FFFFFF');
      ctx.fillRect(0, 0, UNIT, UNIT);
      if (art) drawArt(ctx, art, place(art, body, s, 0.3), u);
      ctx.restore();
      return { face: body };
    },

    // watchOS: full-bleed circle.
    watchos(ctx, s, art, u) {
      const body = { x: 0, y: 0, w: UNIT, h: UNIT };
      ctx.save();
      circlePath(ctx, body);
      ctx.clip();
      ctx.fillStyle = paintFor(ctx, s, body, '#FFFFFF');
      ctx.fillRect(0, 0, UNIT, UNIT);
      if (art) drawArt(ctx, art, place(art, body, s, 0.36), u);
      ctx.restore();
      return { face: body };
    },

    // Android launcher: 48dp canvas, 44dp mask keyline, art in the 66/72 safe zone.
    android(ctx, s, art, u) {
      const d = (UNIT * 44) / 48, o = (UNIT - d) / 2;
      const body = { x: o, y: o, w: d, h: d };
      const paint = paintFor(ctx, s, body, '#FFFFFF');
      ctx.save();
      shadowOn(ctx, s, u, 14, 7, 0.26);
      androidMaskPath(ctx, s.androidMask, body);
      ctx.fillStyle = paint;
      ctx.fill();
      ctx.restore();
      ctx.save();
      androidMaskPath(ctx, s.androidMask, body);
      ctx.clip();
      if (art) drawArt(ctx, art, place(art, body, s, 0.36), u);
      ctx.restore();
      return { face: body };
    },

    square(ctx, s, art, u) {
      const body = { x: 80, y: 72, w: 864, h: 864 };
      const paint = paintFor(ctx, s, body);
      if (paint) {
        ctx.save();
        shadowOn(ctx, s, u, 26, 12, 0.26);
        roundRectPath(ctx, body.x, body.y, body.w, body.h, 150);
        ctx.fillStyle = paint;
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      roundRectPath(ctx, body.x, body.y, body.w, body.h, 150);
      ctx.clip();
      if (art) drawArt(ctx, art, place(art, body, s, 0.3), u);
      ctx.restore();
      return { face: body };
    },

    circle(ctx, s, art, u) {
      const body = { x: 72, y: 64, w: 880, h: 880 };
      const paint = paintFor(ctx, s, body);
      if (paint) {
        ctx.save();
        shadowOn(ctx, s, u, 26, 12, 0.26);
        circlePath(ctx, body);
        ctx.fillStyle = paint;
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      circlePath(ctx, body);
      ctx.clip();
      if (art) drawArt(ctx, art, place(art, body, s, 0.34), u);
      ctx.restore();
      return { face: body };
    },

    folder(ctx, s, art, u, S) {
      const base = s.folderColor;
      const r = 34;
      const back = () => {
        ctx.beginPath();
        ctx.moveTo(96, 196 + r);
        ctx.quadraticCurveTo(96, 196, 96 + r, 196);
        ctx.lineTo(380, 196);
        ctx.bezierCurveTo(404, 196, 416, 204, 430, 220);
        ctx.lineTo(450, 242);
        ctx.bezierCurveTo(458, 250, 466, 254, 484, 254);
        ctx.lineTo(928 - r, 254);
        ctx.quadraticCurveTo(928, 254, 928, 254 + r);
        ctx.lineTo(928, 848 - r);
        ctx.quadraticCurveTo(928, 848, 928 - r, 848);
        ctx.lineTo(96 + r, 848);
        ctx.quadraticCurveTo(96, 848, 96, 848 - r);
        ctx.closePath();
      };
      const front = { x: 96, y: 318, w: 832, h: 530 };

      ctx.save();
      shadowOn(ctx, s, u, 22, 10, 0.22);
      back();
      ctx.fillStyle = shade(base, -0.16);
      ctx.fill();
      ctx.restore();

      ctx.save();
      if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.16)'; ctx.shadowBlur = 8 * u; ctx.shadowOffsetY = -2 * u; }
      roundRectPath(ctx, front.x, front.y, front.w, front.h, r);
      const g = ctx.createLinearGradient(0, front.y, 0, front.y + front.h);
      g.addColorStop(0, shade(base, 0.12));
      g.addColorStop(1, shade(base, -0.03));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRectPath(ctx, front.x, front.y, front.w, front.h, r);
      ctx.clip();
      ctx.fillStyle = shade(base, 0.38);
      ctx.globalAlpha = 0.75;
      ctx.fillRect(front.x, front.y, front.w, 5);
      ctx.globalAlpha = 1;

      if (art) {
        const box = { x: 246, y: 404, w: 532, h: 364 };
        const rect = place(art, box, s, 0);
        const emboss = s.folderStyle === 'emboss' || (s.folderStyle === 'auto' && art.hasAlpha);
        if (emboss) {
          const mask = embossOf(art);
          blit(ctx, tint(artLayer(S, u, mask, rect), '#ffffff'), 0, Math.max(1, 3 * u), 0.4);
          blit(ctx, tint(artLayer(S, u, mask, rect), shade(base, -0.34)), 0, 0, 0.92);
        } else if (art.hasAlpha) {
          ctx.save();
          shadowOn(ctx, s, u, 10, 4, 0.22);
          drawArt(ctx, art, rect, u);
          ctx.restore();
        } else {
          ctx.save();
          shadowOn(ctx, s, u, 12, 5, 0.25);
          roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 22);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.restore();
          ctx.save();
          roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 22);
          ctx.clip();
          drawArt(ctx, art, rect, u);
          ctx.restore();
        }
      }
      ctx.restore();
      return { face: front };
    },

    document(ctx, s, art, u) {
      const x0 = 212, y0 = 96, x1 = 812, y1 = 928, fold = 176, r = 30;
      const page = () => {
        ctx.beginPath();
        ctx.moveTo(x0 + r, y0);
        ctx.lineTo(x1 - fold, y0);
        ctx.lineTo(x1, y0 + fold);
        ctx.lineTo(x1, y1 - r);
        ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
        ctx.lineTo(x0 + r, y1);
        ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
        ctx.lineTo(x0, y0 + r);
        ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
        ctx.closePath();
      };
      const face = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const paint = paintFor(ctx, s, face, '#FFFFFF');
      const paper = s.bgType === 'none' ? '#FFFFFF' : s.colorA;

      ctx.save();
      shadowOn(ctx, s, u, 22, 10, 0.2);
      page();
      ctx.fillStyle = paint;
      ctx.fill();
      ctx.restore();

      ctx.save();
      page();
      ctx.clip();
      if (art) drawArt(ctx, art, place(art, { x: 282, y: 300, w: 460, h: 480 }, s, 0), u);
      ctx.restore();

      ctx.save();
      page();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1 - fold, y0);
      ctx.lineTo(x1 - fold, y0 + fold - 24);
      ctx.quadraticCurveTo(x1 - fold, y0 + fold, x1 - fold + 24, y0 + fold);
      ctx.lineTo(x1, y0 + fold);
      ctx.closePath();
      if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.14)'; ctx.shadowBlur = 10 * u; ctx.shadowOffsetY = 4 * u; }
      ctx.fillStyle = shade(paper, -0.12);
      ctx.fill();
      ctx.restore();
      return { face };
    },

    photo(ctx, s, art, u) {
      const frame = { x: 152, y: 92, w: 720, h: 840 };
      const pic = { x: 188, y: 128, w: 648, h: 648 };
      ctx.save();
      ctx.translate(512, 512);
      ctx.rotate((-4 * Math.PI) / 180);
      ctx.translate(-512, -512);

      ctx.save();
      shadowOn(ctx, s, u, 26, 12, 0.28);
      roundRectPath(ctx, frame.x, frame.y, frame.w, frame.h, 10);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(pic.x, pic.y, pic.w, pic.h);
      ctx.clip();
      ctx.fillStyle = paintFor(ctx, s, pic, '#E9E8E6');
      ctx.fillRect(pic.x, pic.y, pic.w, pic.h);
      if (art) drawArt(ctx, art, place(art, pic, s, 0.12), u);
      ctx.restore();

      if (s.labelPos === 'bottom') drawLabel(ctx, s, frame, pic.y + pic.h + (frame.y + frame.h - pic.y - pic.h) / 2);
      else drawLabel(ctx, s, pic);
      ctx.restore();
      return { face: frame, labelDone: true };
    },

    sticker(ctx, s, art, u, S) {
      const box = { x: 0, y: 0, w: UNIT, h: UNIT };
      if (!art) return { face: box };
      const rect = place(art, box, s, 0.2);
      const layer = artLayer(S, u, art, rect);
      const outline = makeCanvas(S, S);
      const ox = outline.getContext('2d');
      const radius = 24 * u;
      for (const k of [1, 0.5]) {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          ox.drawImage(layer, Math.cos(a) * radius * k, Math.sin(a) * radius * k);
        }
      }
      tint(outline, '#FFFFFF');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 20 * u; ctx.shadowOffsetY = 8 * u; }
      ctx.drawImage(outline, 0, 0);
      ctx.restore();
      blit(ctx, layer);
      return { face: box };
    },

    badge(ctx, s, art, u) {
      const cx = 512, cy = 504, R = 456, bumps = 20, depth = 24;
      const seal = () => {
        ctx.beginPath();
        for (let i = 0; i <= 480; i++) {
          const t = (i / 480) * Math.PI * 2;
          const rr = R - depth * (0.5 - 0.5 * Math.cos(bumps * t));
          const x = cx + rr * Math.cos(t), y = cy + rr * Math.sin(t);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };
      const outer = { x: cx - R, y: cy - R, w: R * 2, h: R * 2 };
      const ri = R - 78;
      const inner = { x: cx - ri, y: cy - ri, w: ri * 2, h: ri * 2 };
      const base = s.bgType === 'none' ? '#F2C94C' : s.colorA;
      ctx.save();
      shadowOn(ctx, s, u, 24, 10, 0.26);
      seal();
      ctx.fillStyle = paintFor(ctx, s, outer, '#F2C94C');
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, ri + 18, 0, Math.PI * 2);
      ctx.lineWidth = 12;
      ctx.strokeStyle = isLight(base) ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.7)';
      ctx.stroke();
      circlePath(ctx, inner);
      ctx.clip();
      if (art) drawArt(ctx, art, place(art, inner, s, 0.3), u);
      ctx.restore();
      return { face: inner };
    },

    disc(ctx, s, art, u) {
      const cx = 512, cy = 512, R = 470, hub = 150, hole = 52;
      const box = { x: cx - R, y: cy - R, w: R * 2, h: R * 2 };
      const ring = (outer, inner) => {
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
      };
      ctx.save();
      shadowOn(ctx, s, u, 22, 10, 0.25);
      ring(R, hole);
      const silver = ctx.createRadialGradient(cx, cy, hole, cx, cy, R);
      silver.addColorStop(0, '#F5F5F7');
      silver.addColorStop(0.6, '#DCDDE2');
      silver.addColorStop(1, '#C5C7CD');
      ctx.fillStyle = silver;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ring(R - 8, hub + 16);
      ctx.clip();
      const paint = paintFor(ctx, s, box);
      if (paint) { ctx.fillStyle = paint; ctx.fillRect(box.x, box.y, box.w, box.h); }
      if (art) {
        const cover = s.fit === 'cover';
        const target = cover ? box : { x: 212, y: 96, w: 600, h: 236 };
        drawArt(ctx, art, place(art, target, s, cover ? 0 : 0.04), u);
      }
      if (ctx.createConicGradient) {
        const g = ctx.createConicGradient(-Math.PI / 3, cx, cy);
        const stops = [[0, '255,255,255', 0], [0.08, '190,225,255', 0.38], [0.16, '255,255,255', 0], [0.32, '255,255,255', 0],
          [0.4, '255,205,240', 0.3], [0.48, '255,255,255', 0], [0.58, '255,255,255', 0], [0.66, '205,255,225', 0.38],
          [0.74, '255,255,255', 0], [0.9, '255,255,255', 0], [0.96, '255,255,255', 0.3], [1, '255,255,255', 0]];
        stops.forEach(([at, rgb, a]) => g.addColorStop(at, `rgba(${rgb},${a})`));
        ctx.globalAlpha = art && !art.hasAlpha && s.fit === 'cover' ? 0.45 : 0.9;
        ctx.fillStyle = g;
        ctx.fillRect(box.x, box.y, box.w, box.h);
      }
      ctx.restore();

      ctx.save();
      ring(hub + 16, hole);
      ctx.fillStyle = 'rgba(236,237,241,0.94)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.beginPath(); ctx.arc(cx, cy, hub + 16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, hub - 34, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.arc(cx, cy, hole, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.beginPath(); ctx.arc(cx, cy, R - 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return { face: box };
    },

    vinyl(ctx, s, art, u) {
      const cx = 512, cy = 512, R = 470, lr = 178;
      const label = { x: cx - lr, y: cy - lr, w: lr * 2, h: lr * 2 };
      ctx.save();
      shadowOn(ctx, s, u, 24, 10, 0.32);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = '#161617';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      for (let r = lr + 22; r < R - 14; r += 9) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      if (ctx.createConicGradient) {
        const g = ctx.createConicGradient(-Math.PI / 4, cx, cy);
        [[0, 0], [0.12, 0.16], [0.24, 0], [0.5, 0], [0.62, 0.16], [0.74, 0], [1, 0]].forEach(([at, a]) => g.addColorStop(at, `rgba(255,255,255,${a})`));
        ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      circlePath(ctx, label);
      ctx.clip();
      ctx.fillStyle = paintFor(ctx, s, label, '#E56458');
      ctx.fillRect(label.x, label.y, label.w, label.h);
      if (art) drawArt(ctx, art, place(art, label, s, 0.34), u);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return { face: label };
    },

    floppy(ctx, s, art, u) {
      const x0 = 128, y0 = 112, x1 = 896, y1 = 912, r = 34, cut = 58;
      const body = () => {
        ctx.beginPath();
        ctx.moveTo(x0 + r, y0);
        ctx.lineTo(x1 - cut, y0);
        ctx.lineTo(x1, y0 + cut);
        ctx.lineTo(x1, y1 - r);
        ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
        ctx.lineTo(x0 + r, y1);
        ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
        ctx.lineTo(x0, y0 + r);
        ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
        ctx.closePath();
      };
      const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const base = s.bgType === 'none' ? '#3A3A3C' : s.colorA;
      ctx.save();
      shadowOn(ctx, s, u, 22, 10, 0.26);
      body();
      ctx.fillStyle = paintFor(ctx, s, box, '#3A3A3C');
      ctx.fill();
      ctx.restore();
      ctx.save();
      body();
      ctx.clip();
      ctx.fillStyle = shade(base, isLight(base) ? -0.08 : 0.08);
      ctx.fillRect(296, y0, 456, 286);
      const metal = ctx.createLinearGradient(0, y0, 0, 384);
      metal.addColorStop(0, '#EDEEF1');
      metal.addColorStop(1, '#B8BAC1');
      roundRectPath(ctx, 330, y0 - 20, 392, 290, 14);
      ctx.fillStyle = metal;
      ctx.fill();
      roundRectPath(ctx, 566, 150, 84, 190, 10);
      ctx.fillStyle = 'rgba(28,28,30,0.85)';
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(166, 838, 46, 46);
      const label = { x: 216, y: 468, w: 592, h: y1 - 468 };
      cornerRectPath(ctx, label.x, label.y, label.w, label.h + 40, 20, 20, 0, 0);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.fillStyle = 'rgba(39,131,222,0.85)';
      ctx.fillRect(label.x, label.y + 20, label.w, 10);
      ctx.beginPath();
      ctx.rect(label.x, label.y + 30, label.w, label.h - 30);
      ctx.clip();
      if (art) drawArt(ctx, art, place(art, { x: 236, y: 504, w: 552, h: 384 }, s, 0.06), u);
      ctx.restore();
      return { face: { x: 216, y: 498, w: 592, h: y1 - 498 } };
    },

    drive(ctx, s, art, u) {
      const front = { x: 112, y: 318, w: 800, h: 456 };
      ctx.save();
      shadowOn(ctx, s, u, 26, 14, 0.28);
      roundRectPath(ctx, front.x, front.y, front.w, front.h, 44);
      ctx.fillStyle = '#C9CBD1';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(176, 262); ctx.lineTo(848, 262); ctx.lineTo(912, 362); ctx.lineTo(112, 362);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 36;
      const lid = ctx.createLinearGradient(0, 250, 0, 360);
      lid.addColorStop(0, '#FBFBFC');
      lid.addColorStop(1, '#E2E3E7');
      ctx.fillStyle = lid;
      ctx.strokeStyle = lid;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRectPath(ctx, front.x, front.y + 40, front.w, front.h - 40, 40);
      const silver = ctx.createLinearGradient(0, front.y, 0, front.y + front.h);
      silver.addColorStop(0, '#E9EAED');
      silver.addColorStop(1, '#C3C5CB');
      ctx.fillStyle = paintFor(ctx, s, front, silver);
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(front.x, front.y + front.h - 54, front.w, 54);
      if (art) drawArt(ctx, art, place(art, { x: 172, y: 392, w: 680, h: 300 }, s, 0.08), u);
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.arc(848, 746, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#46A171';
      ctx.shadowColor = 'rgba(70,161,113,0.8)';
      ctx.shadowBlur = 10 * u;
      ctx.fill();
      ctx.restore();
      return { face: { x: front.x, y: front.y + 40, w: front.w, h: front.h - 94 } };
    },

    // Internal: full-bleed opaque square (iOS, Play Store, apple-touch-icon).
    flat(ctx, s, art, u) {
      const box = { x: 0, y: 0, w: UNIT, h: UNIT };
      ctx.fillStyle = paintFor(ctx, s, box, '#FFFFFF');
      ctx.fillRect(0, 0, UNIT, UNIT);
      if (art) drawArt(ctx, art, place(art, box, s, 0.3), u);
      return { face: box };
    },

    // Internal: Android adaptive icon foreground inside the 66/108 safe zone.
    foreground(ctx, s, art, u) {
      const box = { x: 199, y: 199, w: 626, h: 626 };
      if (art) drawArt(ctx, art, place(art, box, s, 0.08), u);
      return { face: box };
    }
  };

  /**
   * Render an icon at S x S pixels. Returns a canvas.
   * opts.canvas reuses an existing canvas; opts.template overrides the template.
   */
  function render(S, s, art, opts) {
    opts = opts || {};
    const canvas = opts.canvas || makeCanvas(S, S);
    if (canvas.width !== S || canvas.height !== S) { canvas.width = S; canvas.height = S; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const u = S / UNIT;
    ctx.setTransform(u, 0, 0, u, 0, 0);
    const id = opts.template || s.template;
    const fn = draw[id] || draw.macos;
    const result = fn(ctx, s, art, u, S) || {};
    if (!result.labelDone && !opts.noLabel) drawLabel(ctx, s, result.face || { x: 0, y: 0, w: UNIT, h: UNIT });
    if (!opts.noOverlay) drawOverlay(ctx, s, u);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  global.IconsmithRender = {
    UNIT, DEFAULTS, TEMPLATES, FONTS,
    makeCanvas, shade, mix, hexToRgb,
    sourceFromImage, downscale, renderGlyph,
    processArt, artKey, glyphKey, render
  };
})(window);
