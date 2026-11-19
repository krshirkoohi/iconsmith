/*
 * Iconsmith exporters: turns a design into platform files.
 * Plain browser JavaScript, no dependencies. MIT licence.
 */
(function (global) {
  'use strict';

  const R = global.IconsmithRender;
  const E = global.IconsmithEncoders;

  function blobBytes(blob) {
    return blob.arrayBuffer().then((b) => new Uint8Array(b));
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality);
    });
  }

  /** One export run: caches every rendered size and variant. */
  class Job {
    constructor(settings, art) {
      this.s = settings;
      this.art = art;
      this.canvases = new Map();
      this.pngs = new Map();
    }
    key(size, variant) { return size + '|' + JSON.stringify(variant || {}); }
    canvas(size, variant) {
      const k = this.key(size, variant);
      if (!this.canvases.has(k)) {
        const v = variant || {};
        const settings = v.settings ? Object.assign({}, this.s, v.settings) : this.s;
        this.canvases.set(k, R.render(size, settings, this.art, v));
      }
      return this.canvases.get(k);
    }
    imageData(size, variant) {
      return this.canvas(size, variant).getContext('2d').getImageData(0, 0, size, size);
    }
    async png(size, variant) {
      const k = this.key(size, variant);
      if (!this.pngs.has(k)) {
        let bytes = null;
        if (variant && variant.opaque) bytes = await E.encodeRgbPng(this.imageData(size, variant));
        if (!bytes) bytes = await blobBytes(await canvasBlob(this.canvas(size, variant), 'image/png'));
        this.pngs.set(k, bytes);
      }
      return this.pngs.get(k);
    }
    async jpg(size, background) {
      const src = this.canvas(size);
      const c = R.makeCanvas(size, size);
      const x = c.getContext('2d');
      x.fillStyle = background || '#FFFFFF';
      x.fillRect(0, 0, size, size);
      x.drawImage(src, 0, 0);
      return blobBytes(await canvasBlob(c, 'image/jpeg', 0.92));
    }
  }

  const FLAT = { template: 'flat', opaque: true };
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  const themeColour = (s) => (s.bgType === 'none' ? '#FFFFFF' : s.colorA);

  async function icns(job) {
    const png = {};
    for (const size of [32, 64, 128, 256, 512, 1024]) png[size] = await job.png(size);
    return E.createIcns(png, { 16: job.imageData(16), 32: job.imageData(32) });
  }

  async function ico(job, sizes) {
    const images = [];
    for (const size of sizes) {
      images.push({ size, imageData: job.imageData(size), png: size >= 256 ? await job.png(size) : null });
    }
    return E.createIco(images);
  }

  const ICONSET = [
    [16, '16x16'], [32, '16x16@2x'], [32, '32x32'], [64, '32x32@2x'], [128, '128x128'],
    [256, '128x128@2x'], [256, '256x256'], [512, '256x256@2x'], [512, '512x512'], [1024, '512x512@2x']
  ];

  async function iconset(job, dir) {
    const files = [];
    for (const [size, name] of ICONSET) files.push({ name: `${dir}/icon_${name}.png`, data: await job.png(size) });
    return files;
  }

  async function pngSet(job, base, dir) {
    const files = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
      files.push({ name: `${dir}${base}-${size}.png`, data: await job.png(size) });
    }
    return files;
  }

  async function favicons(job, dir) {
    const s = job.s, files = [];
    const add = async (name, size, variant) => files.push({ name: dir + name, data: await job.png(size, variant) });
    files.push({ name: dir + 'favicon.ico', data: await ico(job, [16, 32, 48]) });
    for (const size of [16, 32, 48, 96]) await add(`favicon-${size}x${size}.png`, size);
    await add('apple-touch-icon.png', 180, FLAT);
    for (const size of [57, 60, 72, 76, 114, 120, 144, 152, 167, 180]) await add(`apple-touch-icon-${size}x${size}.png`, size, FLAT);
    await add('android-chrome-192x192.png', 192);
    await add('android-chrome-512x512.png', 512);
    await add('mstile-144x144.png', 144);
    await add('mstile-150x150.png', 150);
    const colour = themeColour(s);
    files.push({
      name: dir + 'site.webmanifest',
      data: json({
        name: '', short_name: '',
        icons: [
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
        ],
        theme_color: colour, background_color: colour, display: 'standalone'
      })
    });
    files.push({
      name: dir + 'browserconfig.xml',
      data: `<?xml version="1.0" encoding="utf-8"?>\n<browserconfig>\n  <msapplication>\n    <tile>\n      <square150x150logo src="/mstile-150x150.png"/>\n      <TileColor>${colour}</TileColor>\n    </tile>\n  </msapplication>\n</browserconfig>\n`
    });
    files.push({
      name: dir + 'favicon-snippet.html',
      data: [
        '<!-- Paste into <head>. Upload the files to your site root. -->',
        '<link rel="icon" href="/favicon.ico" sizes="any">',
        '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
        '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
        '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/site.webmanifest">',
        `<meta name="msapplication-TileColor" content="${colour}">`,
        '<meta name="msapplication-TileImage" content="/mstile-144x144.png">',
        `<meta name="theme-color" content="${colour}">`,
        ''
      ].join('\n')
    });
    return files;
  }

  const IOS = [
    ['iphone', 20, 2], ['iphone', 20, 3], ['iphone', 29, 2], ['iphone', 29, 3], ['iphone', 40, 2], ['iphone', 40, 3],
    ['iphone', 60, 2], ['iphone', 60, 3], ['ipad', 20, 1], ['ipad', 20, 2], ['ipad', 29, 1], ['ipad', 29, 2],
    ['ipad', 40, 1], ['ipad', 40, 2], ['ipad', 76, 1], ['ipad', 76, 2], ['ipad', 83.5, 2], ['ios-marketing', 1024, 1]
  ];
  const MAC = [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]];

  async function xcode(job, dir) {
    const files = [], seen = new Set();
    const info = { author: 'xcode', version: 1 };

    const ios = `${dir}AppIcon-iOS.appiconset/`;
    for (const [, pt, scale] of IOS) {
      const filename = `Icon-${pt}@${scale}x.png`;
      if (seen.has(filename)) continue;
      seen.add(filename);
      files.push({ name: ios + filename, data: await job.png(Math.round(pt * scale), FLAT) });
    }
    files.push({
      name: ios + 'Contents.json',
      data: json({ images: IOS.map(([idiom, pt, scale]) => ({ filename: `Icon-${pt}@${scale}x.png`, idiom, scale: `${scale}x`, size: `${pt}x${pt}` })), info })
    });

    const watch = `${dir}AppIcon-watchOS.appiconset/`;
    files.push({ name: watch + 'Icon-1024.png', data: await job.png(1024, FLAT) });
    files.push({ name: watch + 'Contents.json', data: json({ images: [{ filename: 'Icon-1024.png', idiom: 'universal', platform: 'watchos', size: '1024x1024' }], info }) });

    const mac = `${dir}AppIcon-macOS.appiconset/`;
    const macImages = [];
    for (const [pt, scale] of MAC) {
      const filename = `icon_${pt}x${pt}${scale === 2 ? '@2x' : ''}.png`;
      files.push({ name: mac + filename, data: await job.png(pt * scale) });
      macImages.push({ filename, idiom: 'mac', scale: `${scale}x`, size: `${pt}x${pt}` });
    }
    files.push({ name: mac + 'Contents.json', data: json({ images: macImages, info }) });
    return files;
  }

  async function android(job, dir) {
    const files = [];
    const densities = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
    const launcher = { template: 'android' };
    const round = { template: 'android', settings: { androidMask: 'circle' } };
    const fg = { template: 'foreground', noLabel: true, noOverlay: true };
    for (const [name, k] of densities) {
      const d = `${dir}res/mipmap-${name}/`;
      files.push({ name: d + 'ic_launcher.png', data: await job.png(Math.round(48 * k), launcher) });
      files.push({ name: d + 'ic_launcher_round.png', data: await job.png(Math.round(48 * k), round) });
      files.push({ name: d + 'ic_launcher_foreground.png', data: await job.png(Math.round(108 * k), fg) });
    }
    const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
    files.push({ name: `${dir}res/mipmap-anydpi-v26/ic_launcher.xml`, data: adaptive });
    files.push({ name: `${dir}res/mipmap-anydpi-v26/ic_launcher_round.xml`, data: adaptive });
    files.push({ name: `${dir}res/values/ic_launcher_background.xml`, data: `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${themeColour(job.s)}</color>\n</resources>\n` });
    files.push({ name: `${dir}play-store-icon-512.png`, data: await job.png(512, FLAT) });
    return files;
  }

  const FORMATS = {
    icns: { label: 'macOS .icns', zip: false, build: async (job, base) => [{ name: `${base}.icns`, data: await icns(job) }] },
    iconset: { label: 'Iconset', zip: true, build: (job, base) => iconset(job, `${base}.iconset`), zipName: (b) => `${b}.iconset.zip` },
    ico: { label: 'Windows .ico', zip: false, build: async (job, base) => [{ name: `${base}.ico`, data: await ico(job, [16, 24, 32, 48, 64, 128, 256]) }] },
    png: { label: 'PNG', zip: false, build: async (job, base) => [{ name: `${base}.png`, data: await job.png(job.s.exportSize) }] },
    jpg: { label: 'JPG', zip: false, build: async (job, base) => [{ name: `${base}.jpg`, data: await job.jpg(job.s.exportSize, job.s.jpgBg) }] },
    pngset: { label: 'PNG sizes', zip: true, build: (job, base) => pngSet(job, base, `${base}-png/`), zipName: (b) => `${b}-png.zip` },
    favicon: { label: 'Favicons', zip: true, build: (job, base) => favicons(job, `${base}-favicons/`), zipName: (b) => `${b}-favicons.zip` },
    xcode: { label: 'Xcode', zip: true, build: (job, base) => xcode(job, `${base}-xcode/`), zipName: (b) => `${b}-xcode.zip` },
    android: { label: 'Android', zip: true, build: (job, base) => android(job, `${base}-android/`), zipName: (b) => `${b}-android.zip` },
    all: {
      label: 'Everything', zip: true, zipName: (b) => `${b}-icons.zip`,
      build: async (job, base) => {
        const d = `${base}-icons/`;
        return [
          { name: `${d}macOS/${base}.icns`, data: await icns(job) },
          ...(await iconset(job, `${d}macOS/${base}.iconset`)),
          { name: `${d}Windows/${base}.ico`, data: await ico(job, [16, 24, 32, 48, 64, 128, 256]) },
          ...(await pngSet(job, base, `${d}PNG/`)),
          ...(await favicons(job, `${d}Web/`)),
          ...(await xcode(job, `${d}Xcode/`)),
          ...(await android(job, `${d}Android/`))
        ];
      }
    }
  };

  /** Export one design. Returns { blob, filename }. */
  async function exportDesign(format, settings, art, base) {
    const f = FORMATS[format];
    if (!f) throw new Error('Unknown format: ' + format);
    const files = await f.build(new Job(settings, art), base);
    if (!f.zip && files.length === 1) {
      const type = format === 'jpg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'application/octet-stream';
      return { blob: new Blob([files[0].data], { type }), filename: files[0].name };
    }
    return { blob: E.createZip(files), filename: f.zipName(base) };
  }

  /** Export many designs into one ZIP. items: [{ base, art }] */
  async function exportBatch(format, settings, items, onProgress) {
    const f = FORMATS[format];
    const all = [];
    const used = new Map();
    for (let i = 0; i < items.length; i++) {
      let base = items[i].base;
      const n = used.get(base) || 0;
      used.set(base, n + 1);
      if (n) base = `${base}-${n + 1}`;
      const files = await f.build(new Job(settings, items[i].art), base);
      all.push(...files);
      if (onProgress) onProgress(i + 1, items.length);
    }
    return { blob: E.createZip(all), filename: `iconsmith-${format}-batch.zip` };
  }

  global.IconsmithExport = { FORMATS, Job, exportDesign, exportBatch, canvasBlob };
})(window);
