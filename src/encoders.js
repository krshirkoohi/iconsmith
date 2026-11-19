/*
 * Iconsmith encoders: ZIP, ICNS and ICO writers.
 * Plain browser JavaScript, no dependencies. MIT licence.
 */
(function (global) {
  'use strict';

  const textEncoder = new TextEncoder();

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function toBytes(data) {
    if (typeof data === 'string') return textEncoder.encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new TypeError('Unsupported data type for archive entry');
  }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /** Create an uncompressed (stored) ZIP archive. files: [{ name, data }] */
  function createZip(files) {
    const stamp = dosDateTime(new Date());
    const parts = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const name = textEncoder.encode(file.name);
      const data = toBytes(file.data);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, stamp.time, true);
      local.setUint16(12, stamp.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, stamp.time, true);
      entry.setUint16(14, stamp.date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  /* ---------- ICNS (macOS) ---------- */

  // Run-length encoding used by the legacy is32/il32 colour channels.
  function icnsRle(plane) {
    const out = [];
    const n = plane.length;
    let i = 0;
    while (i < n) {
      let run = 1;
      while (i + run < n && run < 130 && plane[i + run] === plane[i]) run++;
      if (run >= 3) {
        out.push(0x80 + run - 3, plane[i]);
        i += run;
      } else {
        const start = i;
        let len = 0;
        while (i < n && len < 128) {
          if (i + 2 < n && plane[i] === plane[i + 1] && plane[i] === plane[i + 2]) break;
          i++;
          len++;
        }
        out.push(len - 1);
        for (let k = start; k < start + len; k++) out.push(plane[k]);
      }
    }
    return out;
  }

  function legacyIcnsChunks(imageData) {
    const { width, height, data } = imageData;
    const count = width * height;
    const r = new Uint8Array(count), g = new Uint8Array(count), b = new Uint8Array(count), a = new Uint8Array(count);
    for (let p = 0, q = 0; p < count; p++, q += 4) {
      r[p] = data[q]; g[p] = data[q + 1]; b[p] = data[q + 2]; a[p] = data[q + 3];
    }
    const rgb = Uint8Array.from([...icnsRle(r), ...icnsRle(g), ...icnsRle(b)]);
    return { rgb, mask: a };
  }

  /**
   * Create an .icns file.
   * png: { [size]: Uint8Array } PNG data for 32, 64, 128, 256, 512, 1024.
   * raw: { 16: ImageData, 32: ImageData } for the legacy small sizes.
   */
  function createIcns(png, raw) {
    const entries = [];
    if (raw && raw[16]) {
      const c = legacyIcnsChunks(raw[16]);
      entries.push(['is32', c.rgb], ['s8mk', c.mask]);
    }
    if (raw && raw[32]) {
      const c = legacyIcnsChunks(raw[32]);
      entries.push(['il32', c.rgb], ['l8mk', c.mask]);
    }
    const pngTypes = [
      ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256],
      ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]
    ];
    for (const [type, size] of pngTypes) if (png[size]) entries.push([type, png[size]]);

    const tocLength = 8 + entries.length * 8;
    const total = 8 + tocLength + entries.reduce((n, [, d]) => n + 8 + d.length, 0);
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let p = 0;
    const writeType = (t) => { for (let i = 0; i < 4; i++) out[p + i] = t.charCodeAt(i); p += 4; };
    const writeLength = (n) => { view.setUint32(p, n); p += 4; };

    writeType('icns'); writeLength(total);
    writeType('TOC '); writeLength(tocLength);
    for (const [type, data] of entries) { writeType(type); writeLength(data.length + 8); }
    for (const [type, data] of entries) { writeType(type); writeLength(data.length + 8); out.set(data, p); p += data.length; }
    return out;
  }

  /* ---------- ICO (Windows) ---------- */

  function bmpEntry(imageData) {
    const { width: w, height: h, data } = imageData;
    const maskRow = Math.ceil(w / 32) * 4;
    const pixelBytes = w * h * 4;
    const maskBytes = maskRow * h;
    const out = new Uint8Array(40 + pixelBytes + maskBytes);
    const view = new DataView(out.buffer);
    view.setUint32(0, 40, true);
    view.setInt32(4, w, true);
    view.setInt32(8, h * 2, true);
    view.setUint16(12, 1, true);
    view.setUint16(14, 32, true);
    view.setUint32(20, pixelBytes + maskBytes, true);
    let p = 40;
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4;
        out[p++] = data[q + 2]; out[p++] = data[q + 1]; out[p++] = data[q]; out[p++] = data[q + 3];
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] === 0) out[p + (x >> 3)] |= 0x80 >> (x & 7);
      }
      p += maskRow;
    }
    return out;
  }

  /**
   * Create an .ico file. images: [{ size, imageData, png }]
   * Sizes below 256 use BMP data for the widest compatibility; 256 uses PNG.
   */
  function createIco(images) {
    const sorted = images.slice().sort((a, b) => a.size - b.size);
    const blobs = sorted.map((img) => (img.size >= 256 ? img.png : bmpEntry(img.imageData)));
    const headerLength = 6 + sorted.length * 16;
    const total = headerLength + blobs.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint16(2, 1, true);
    view.setUint16(4, sorted.length, true);
    let offset = headerLength;
    sorted.forEach((img, i) => {
      const e = 6 + i * 16;
      out[e] = img.size >= 256 ? 0 : img.size;
      out[e + 1] = img.size >= 256 ? 0 : img.size;
      view.setUint16(e + 4, 1, true);
      view.setUint16(e + 6, 32, true);
      view.setUint32(e + 8, blobs[i].length, true);
      view.setUint32(e + 12, offset, true);
      out.set(blobs[i], offset);
      offset += blobs[i].length;
    });
    return out;
  }

  /* ---------- PNG without alpha (App Store icons must be opaque RGB) ---------- */

  async function encodeRgbPng(imageData) {
    if (typeof CompressionStream === 'undefined') return null;
    const { width: w, height: h, data } = imageData;
    const stride = w * 3 + 1;
    const raw = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      const o = y * stride;
      raw[o] = 1; // "Sub" filter
      let pr = 0, pg = 0, pb = 0;
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4, p = o + 1 + x * 3;
        const r = data[q], g = data[q + 1], b = data[q + 2];
        raw[p] = (r - pr) & 255; raw[p + 1] = (g - pg) & 255; raw[p + 2] = (b - pb) & 255;
        pr = r; pg = g; pb = b;
      }
    }
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    const chunk = (type, body) => {
      const out = new Uint8Array(12 + body.length);
      const view = new DataView(out.buffer);
      view.setUint32(0, body.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(body, 8);
      view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
      return out;
    };
    const ihdr = new Uint8Array(13);
    const iv = new DataView(ihdr.buffer);
    iv.setUint32(0, w); iv.setUint32(4, h);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
    const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  global.IconsmithEncoders = { crc32, createZip, createIcns, createIco, encodeRgbPng };
})(window);
