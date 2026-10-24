#!/usr/bin/env node
'use strict';
// Offline art packer: vendored source sheets (art-src/) + tools/art-manifest.js -> src/art/*.js (data-URI atlas pages + metadata).
// Usage: node tools/art.js [--check]   (--check rebuilds in memory and fails if src/art/ differs; run before commit)
// Also writes src/art/fonts.css (art-src/fonts/ -> @font-face data URIs, see the fonts section).
// Zero dependencies; own PNG codec on zlib. Output is deterministic (stable ordering, fixed zlib settings).
// Contract written to ED.ART: { pages, frames, anims, pal, font, swaps }; units are ART pixels (1 art px = 2 world px at draw time).
//   frames[id] = { p: page, x, y, w, h, ox, oy }  trimmed rect in the page; ox/oy = trimmed rect offset inside the logical frame
//   anims[id]  = { f: [frameId..], fps, loop, fw, fh, ax, ay, anchors }  ax/ay = pivot in logical-frame px (feet for bodies/props)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'art-src');
const OUT = path.join(ROOT, 'src', 'art');
const OUTLINE = '#222222';

// ---------------------------------------------------------------- PNG codec
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// decodePNG(buf) -> { w, h, data: Uint8Array RGBA }; colour types 0/2/3/4/6, bit depths 1-16, tRNS, all filters, non-interlaced only.
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, plte = null, trns = null; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; }
    else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
  }
  if (il !== 0) throw new Error('interlaced PNG not supported');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; if (!ch) throw new Error('bad colour type ' + ct);
  const bpp = Math.max(1, (ch * bd) >> 3), stride = (w * ch * bd + 7) >> 3;
  const raw = zlib.inflateSync(Buffer.concat(idat)); if (raw.length !== (stride + 1) * h) throw new Error('bad IDAT length');
  const cur = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], o = y * stride, s = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const x = raw[s + i], a = i >= bpp ? cur[o + i - bpp] : 0, b = y ? cur[o - stride + i] : 0, c = i >= bpp && y ? cur[o - stride + i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('bad filter ' + f);
      }
      cur[o + i] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4), mx = (1 << bd) - 1;
  const sample = (row, idx) => { // idx-th sample of a row (bd 1..8 packed MSB first, 16 -> high byte)
    if (bd === 8) return cur[row + idx]; if (bd === 16) return cur[row + idx * 2];
    const bit = idx * bd; return (cur[row + (bit >> 3)] >> (8 - bd - (bit & 7))) & mx;
  };
  const scale = (v) => (bd === 16 || bd === 8 ? v : Math.round(v * 255 / mx));
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; let r, g, b, a = 255;
      if (ct === 6) { r = sample(row, x * 4); g = sample(row, x * 4 + 1); b = sample(row, x * 4 + 2); a = sample(row, x * 4 + 3); }
      else if (ct === 2) {
        r = sample(row, x * 3); g = sample(row, x * 3 + 1); b = sample(row, x * 3 + 2);
        if (trns && trns.length >= 6 && (bd === 16 ? cur[row + x * 6] * 256 + cur[row + x * 6 + 1] : r) === trns.readUInt16BE(0) && (bd === 16 ? cur[row + x * 6 + 2] * 256 + cur[row + x * 6 + 3] : g) === trns.readUInt16BE(2) && (bd === 16 ? cur[row + x * 6 + 4] * 256 + cur[row + x * 6 + 5] : b) === trns.readUInt16BE(4)) a = 0;
      } else if (ct === 3) { const i = sample(row, x); r = plte[i * 3]; g = plte[i * 3 + 1]; b = plte[i * 3 + 2]; a = trns && i < trns.length ? trns[i] : 255; }
      else if (ct === 0) { const v = sample(row, x); r = g = b = scale(v); if (trns && trns.length >= 2 && (bd === 16 ? cur[row + x * 2] * 256 + cur[row + x * 2 + 1] : v) === trns.readUInt16BE(0)) a = 0; }
      else { r = g = b = sample(row, x * 2); a = sample(row, x * 2 + 1); }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return { w, h, data: out };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out;
}
function filterRows(px, stride, h, bpp) { // per-row filter chosen by minimum sum of absolute (signed) differences
  const out = Buffer.alloc((stride + 1) * h), cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const o = y * stride; let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f]; let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = px[o + i], a = i >= bpp ? px[o + i - bpp] : 0, b = y ? px[o - stride + i] : 0, cc = i >= bpp && y ? px[o - stride + i - bpp] : 0;
        let pr;
        switch (f) { case 0: pr = 0; break; case 1: pr = a; break; case 2: pr = b; break; case 3: pr = (a + b) >> 1; break;
          default: { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; } }
        const v = (x - pr) & 255; c[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    out[y * (stride + 1)] = best; cand[best].copy(out, y * (stride + 1) + 1);
  }
  return out;
}
function deflateBest(raw) {
  let best = null;
  for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
    const z = zlib.deflateSync(raw, { level: 9, memLevel: 9, strategy }); if (!best || z.length < best.length) best = z;
  }
  return best;
}
// encodePNG(w, h, rgba) -> Buffer; indexed (PLTE+tRNS, 1/2/4/8-bit) when <= 256 colours, else RGBA8.
function encodePNG(w, h, rgba) {
  const keys = new Map(); const cols = [];
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3], k = a === 0 ? 0 : ((rgba[i * 4] << 24 | rgba[i * 4 + 1] << 16 | rgba[i * 4 + 2] << 8 | a) >>> 0); // all transparent pixels share one entry
    if (!keys.has(k)) { keys.set(k, 0); cols.push(k); if (cols.length > 256) break; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  let body, parts;
  if (cols.length <= 256) {
    const lum = (k) => ((k >>> 24) * 299 + ((k >>> 16) & 255) * 587 + ((k >>> 8) & 255) * 114);
    cols.sort((a, b) => { const aa = a & 255, ba = b & 255; if ((aa < 255) !== (ba < 255)) return aa < 255 ? -1 : 1; if (aa < 255 && aa !== ba) return aa - ba; return lum(a) - lum(b) || a - b; });
    const idx = new Map(); cols.forEach((k, i) => idx.set(k, i));
    const bd = cols.length <= 2 ? 1 : cols.length <= 4 ? 2 : cols.length <= 16 ? 4 : 8, stride = (w * bd + 7) >> 3, px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, a = rgba[o + 3], i = idx.get(a === 0 ? 0 : ((rgba[o] << 24 | rgba[o + 1] << 16 | rgba[o + 2] << 8 | a) >>> 0));
      if (bd === 8) px[y * stride + x] = i; else { const bit = x * bd; px[y * stride + (bit >> 3)] |= i << (8 - bd - (bit & 7)); }
    }
    const pl = Buffer.alloc(cols.length * 3); let nt = 0;
    cols.forEach((k, i) => { pl[i * 3] = k >>> 24; pl[i * 3 + 1] = (k >>> 16) & 255; pl[i * 3 + 2] = (k >>> 8) & 255; if ((k & 255) < 255) nt = i + 1; });
    ihdr[8] = bd; ihdr[9] = 3; parts = [chunk('IHDR', ihdr), chunk('PLTE', pl)];
    if (nt) { const tr = Buffer.alloc(nt); for (let i = 0; i < nt; i++) tr[i] = cols[i] & 255; parts.push(chunk('tRNS', tr)); }
    body = filterRows(px, stride, h, 1);
  } else {
    const px = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length); const q = Buffer.from(px); // keep colour of fully transparent pixels at 0 for stable output
    for (let i = 0; i < q.length; i += 4) if (!q[i + 3]) q[i] = q[i + 1] = q[i + 2] = 0;
    ihdr[8] = 8; ihdr[9] = 6; parts = [chunk('IHDR', ihdr)]; body = filterRows(q, w * 4, h, 4);
  }
  parts.push(chunk('IDAT', deflateBest(body)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...parts]);
}

// ---------------------------------------------------------------- bitmap helpers (RGBA, {w,h,data})
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const unhex = (s) => { s = s.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const lumOf = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
function bmp(w, h) { return { w, h, data: new Uint8Array(w * h * 4) }; }
function cut(sheet, x, y, w, h) {
  const o = bmp(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = x + i, sy = y + j; if (sx < 0 || sy < 0 || sx >= sheet.w || sy >= sheet.h) continue;
    const s = (sy * sheet.w + sx) * 4, d = (j * w + i) * 4; o.data[d] = sheet.data[s]; o.data[d + 1] = sheet.data[s + 1]; o.data[d + 2] = sheet.data[s + 2]; o.data[d + 3] = sheet.data[s + 3];
  }
  return o;
}
function mapPixels(b, fn) { const o = bmp(b.w, b.h); for (let i = 0; i < b.w * b.h; i++) { const r = fn(b.data[i * 4], b.data[i * 4 + 1], b.data[i * 4 + 2], b.data[i * 4 + 3]); o.data[i * 4] = r[0]; o.data[i * 4 + 1] = r[1]; o.data[i * 4 + 2] = r[2]; o.data[i * 4 + 3] = r[3]; } return o; }
function flipX(b) { const o = bmp(b.w, b.h); for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const s = (y * b.w + x) * 4, d = (y * b.w + (b.w - 1 - x)) * 4; for (let k = 0; k < 4; k++) o.data[d + k] = b.data[s + k]; } return o; }
function bbox(b) {
  let x0 = b.w, y0 = b.h, x1 = -1, y1 = -1;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.data[(y * b.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
function padBmp(b, p) { const o = bmp(b.w + 2 * p, b.h + 2 * p); for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const s = (y * b.w + x) * 4, d = ((y + p) * o.w + x + p) * 4; for (let k = 0; k < 4; k++) o.data[d + k] = b.data[s + k]; } return o; }
function stamp(b, col) { // 1 px 4-neighbour outline around opaque pixels (needs a 1 px margin: caller pads)
  const c = unhex(col), o = bmp(b.w, b.h); o.data.set(b.data);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (b.data[(y * b.w + x) * 4 + 3]) continue;
    let n = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < b.w && yy < b.h && b.data[(yy * b.w + xx) * 4 + 3]) { n = true; break; } }
    if (n) { const d = (y * b.w + x) * 4; o.data[d] = c[0]; o.data[d + 1] = c[1]; o.data[d + 2] = c[2]; o.data[d + 3] = 255; }
  }
  return o;
}
function recolour(b, spec) { // spec: { swap: {#src:#dst}, ramp: ['#dark'..'#light'], keep: fn }
  if (spec.swap) { const m = {}; for (const k in spec.swap) m[k.toLowerCase()] = unhex(spec.swap[k]); b = mapPixels(b, (r, g, bl, a) => { if (!a) return [r, g, bl, a]; const t = m[hex(r, g, bl)]; return t ? [t[0], t[1], t[2], a] : [r, g, bl, a]; }); }
  if (spec.ramp) {
    const st = spec.ramp.map(unhex), lo = spec.lo == null ? 0 : spec.lo, hi = spec.hi == null ? 1 : spec.hi;
    b = mapPixels(b, (r, g, bl, a) => {
      if (!a) return [r, g, bl, a]; if (spec.skip && spec.skip.includes(hex(r, g, bl))) return [r, g, bl, a];
      const l = Math.max(0, Math.min(0.999, (lumOf(r, g, bl) - lo) / (hi - lo))) * (st.length - 1), k = Math.floor(l), f = l - k;
      return [Math.round(st[k][0] + (st[k + 1][0] - st[k][0]) * f), Math.round(st[k][1] + (st[k + 1][1] - st[k][1]) * f), Math.round(st[k][2] + (st[k + 1][2] - st[k][2]) * f), a];
    });
  }
  return b;
}

// ---------------------------------------------------------------- manifest -> frames
function loadSheets(M) {
  const sheets = {};
  for (const key of Object.keys(M.sheets)) {
    const def = M.sheets[key], file = path.join(SRC, def.file);
    if (!fs.existsSync(file)) throw new Error('missing source sheet ' + def.file);
    let s = decodePNG(fs.readFileSync(file));
    const out = [].concat(def.outline || []).map((c) => c.toLowerCase()), edge = [].concat(def.edge || []).map((c) => c.toLowerCase());
    if (def.bin || out.length || edge.length) {
      const src = s, isEdge = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx < 0 || yy < 0 || xx >= src.w || yy >= src.h || src.data[(yy * src.w + xx) * 4 + 3] === 0; });
      s = bmp(src.w, src.h);
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const o = (y * src.w + x) * 4; let r = src.data[o], g = src.data[o + 1], b = src.data[o + 2], a = src.data[o + 3];
        if (def.bin) a = a >= 128 ? 255 : 0;
        if (a) { const k = hex(r, g, b); if (out.includes(k) || (edge.includes(k) && isEdge(x, y))) { [r, g, b] = unhex(OUTLINE); } }
        s.data[o] = r; s.data[o + 1] = g; s.data[o + 2] = b; s.data[o + 3] = a;
      }
    }
    sheets[key] = s;
  }
  return sheets;
}
function parseTileList(M) {
  const names = {}; const file = path.join(SRC, M.tileList);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = line.trim().split(/\s+/); if (m.length === 5) names[m[0]] = [+m[1], +m[2], +m[3], +m[4]]; }
  if (names.zombie_anim_f10 && !names.zombie_anim_f0) names.zombie_anim_f0 = names.zombie_anim_f10; // pack typo
  return names;
}
function asciiBmp(rows, pal) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length)), b = bmp(w, h);
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = row[x]; if (c === '.' || c === ' ') continue; const col = pal[c]; if (!col) throw new Error('ascii map: no colour for "' + c + '"'); const v = unhex(col), d = (y * w + x) * 4; b.data[d] = v[0]; b.data[d + 1] = v[1]; b.data[d + 2] = v[2]; b.data[d + 3] = 255; } });
  return b;
}

function sampleRects(sh, { cw, ch, n }) { // n evenly spaced non-empty cells (row-major) of a cw x ch grid
  const ok = [];
  for (let r = 0; r < sh.h / ch; r++) for (let c = 0; c < sh.w / cw; c++) { const b = cut(sh, c * cw, r * ch, cw, ch); if (bbox(b)) ok.push([c * cw, r * ch, cw, ch]); }
  if (ok.length <= n) return ok;
  return Array.from({ length: n }, (_, i) => ok[Math.round(i * (ok.length - 1) / (n - 1))]);
}
function buildFrames(M, sheets, names) {
  const anims = [], byId = {};
  const grab = (e, key, r) => {
    const sh = sheets[key]; if (!sh) throw new Error(e.id + ': unknown sheet ' + key);
    let rect = r;
    if (typeof r === 'string') { rect = names[r]; if (!rect || key !== 'ox') throw new Error(e.id + ': unknown 0x72 name ' + r); }
    if (rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > sh.w || rect[1] + rect[3] > sh.h) throw new Error(e.id + ': rect outside sheet ' + key + ' ' + JSON.stringify(rect));
    return cut(sh, rect[0], rect[1], rect[2], rect[3]);
  };
  for (const e of M.entries) {
    if (byId[e.id]) throw new Error('duplicate anim id ' + e.id);
    let a;
    if (e.use) {
      const s = byId[e.use]; if (!s) throw new Error(e.id + ': use of unknown or later anim ' + e.use);
      if (e.swap || e.ramp || e.stamp || e.flip) throw new Error(e.id + ': use cannot recolour');
      if (s.e.page !== e.page) throw new Error(e.id + ': use across pages');
      const pick = e.pick || s.fr.map((_, i) => i);
      a = { e, fr: pick.map((i) => s.fr[i]), fw: s.fw, fh: s.fh, use: s, pick };
    } else {
      const cells = [];
      if (e.ascii) for (const rows of e.ascii) cells.push(asciiBmp(rows, e.pal));
      else if (e.frames) for (const [key, r] of e.frames) cells.push(grab(e, key, r));
      else if (e.sample) for (const r of sampleRects(sheets[e.src], e.sample)) cells.push(grab(e, e.src, r));
      else for (const r of e.rects) cells.push(grab(e, e.src, r));
      const fr = cells.map((c) => {
        let b = c;
        if (e.swap || e.ramp) b = recolour(b, { swap: e.swap, ramp: e.ramp, lo: e.lo, hi: e.hi, skip: e.skip });
        if (e.stamp) { b = padBmp(b, 1); b = stamp(b, e.stamp === true ? OUTLINE : e.stamp); }
        if (e.flip) b = flipX(b);
        return b;
      });
      if (!fr.length) throw new Error(e.id + ': no frames');
      if (e.optional && fr.every((b) => !bbox(b))) continue; // grid-generated cells that are blank in the source
      a = { e, fr, fw: Math.max(...fr.map((b) => b.w)), fh: Math.max(...fr.map((b) => b.h)) };
    }
    byId[e.id] = a; anims.push(a);
  }
  return anims;
}

function packPage(items) { // items: [{key, bmp}] -> { w, h, pos: {key:[x,y]}, rgba }
  const G = 1; items = items.slice().sort((a, b) => b.bmp.h - a.bmp.h || b.bmp.w - a.bmp.w || (a.key < b.key ? -1 : 1));
  const area = items.reduce((s, it) => s + (it.bmp.w + G) * (it.bmp.h + G), 0);
  let best = null;
  for (const W of [128, 256, 512, 1024]) {
    if (items.some((it) => it.bmp.w + G > W)) continue;
    let x = 0, y = 0, rowH = 0; const pos = {};
    for (const it of items) { if (x + it.bmp.w + G > W) { x = 0; y += rowH + G; rowH = 0; } pos[it.key] = [x, y]; x += it.bmp.w + G; rowH = Math.max(rowH, it.bmp.h); }
    const H = y + rowH + G, cost = W * H;
    if (!best || cost < best.cost * 0.97 || (cost <= best.cost && W < best.W)) best = { W, H, pos, cost };
  }
  if (!best) throw new Error('page: sprite wider than 1023 px');
  const rgba = new Uint8Array(best.W * best.H * 4);
  for (const it of items) { const [px, py] = best.pos[it.key]; for (let y = 0; y < it.bmp.h; y++) for (let x = 0; x < it.bmp.w; x++) { const s = (y * it.bmp.w + x) * 4, d = ((py + y) * best.W + px + x) * 4; for (let k = 0; k < 4; k++) rgba[d + k] = it.bmp.data[s + k]; } }
  return { w: best.W, h: best.H, pos: best.pos, rgba, area };
}

function build() {
  const M = require('./art-manifest.js');
  const sheets = loadSheets(M), names = parseTileList(M);
  const anims = buildFrames(M, sheets, names);
  // font glyphs become anims too (one frame each) under the font page
  const fontDef = M.font, fontSheet = sheets[fontDef.src], glyphIds = {};
  const fontAnims = [];
  for (const [ch, [cx, cy]] of Object.entries(fontDef.cells)) {
    let b = cut(fontSheet, cx * fontDef.cw, cy * fontDef.ch, fontDef.cw, fontDef.ch);
    b = mapPixels(b, (r, g, bl, a) => (a ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const ov = fontDef.override && fontDef.override[ch]; // hand-drawn glyph rows ('#' = ink) in place of the sheet's cell
    if (ov) { b = bmp(fontDef.cw, fontDef.ch); for (let y = 0; y < ov.length; y++) for (let x = 0; x < ov[y].length; x++) if (ov[y][x] === '#') { const d = (y * b.w + x) * 4; b.data[d] = b.data[d + 1] = b.data[d + 2] = b.data[d + 3] = 255; } }
    const id = 'font.' + (ch.charCodeAt(0)).toString(16).padStart(2, '0'); glyphIds[ch] = id;
    fontAnims.push({ e: { id, page: fontDef.page, set: id, pivot: 'tl', fps: 0, loop: false, font: true }, fr: [b], fw: fontDef.cw, fh: fontDef.ch });
  }
  const all = anims.concat(fontAnims);
  // union bbox per set -> anchors
  const sets = {};
  for (const a of all) {
    const s = a.e.set || a.e.id; (sets[s] = sets[s] || []).push(a);
  }
  const meta = { frames: {}, anims: {}, pal: {} }, pages = {}, pagePlans = {};
  const byPage = {};
  for (const a of all) (byPage[a.e.page] = byPage[a.e.page] || []).push(a);
  for (const pg of M.pages) if (!byPage[pg]) byPage[pg] = [];
  for (const pg of Object.keys(byPage)) if (!M.pages.includes(pg)) throw new Error('unknown page ' + pg);
  // trimmed bitmaps with content-hash dedupe per page
  const trimmed = new Map(); // anim -> [{x0,y0,w,h,key}]
  for (const pg of M.pages) {
    const items = new Map();
    for (const a of byPage[pg]) {
      const list = a.fr.map((b, i) => {
        const bb = bbox(b); if (!bb) return { empty: true, key: null };
        const t = cut(b, bb.x0, bb.y0, bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1);
        const key = crypto.createHash('sha1').update(t.w + 'x' + t.h).update(t.data).digest('hex').slice(0, 16);
        if (!items.has(key)) items.set(key, { key, bmp: t });
        return { x0: bb.x0, y0: bb.y0, w: t.w, h: t.h, key };
      });
      trimmed.set(a, list);
    }
    pagePlans[pg] = { items: [...items.values()] };
  }
  for (const pg of M.pages) {
    const plan = pagePlans[pg];
    if (!plan.items.length) { pages[pg] = null; continue; }
    const packed = packPage(plan.items); plan.packed = packed;
    const png = encodePNG(packed.w, packed.h, packed.rgba);
    pages[pg] = { w: packed.w, h: packed.h, png, nFrames: plan.items.length, uri: 'data:image/png;base64,' + png.toString('base64') };
  }
  // anchors
  const colourSet = (a) => { const m = new Map(); for (const b of a.fr) for (let i = 0; i < b.w * b.h; i++) if (b.data[i * 4 + 3] > 0) m.set(hex(b.data[i * 4], b.data[i * 4 + 1], b.data[i * 4 + 2]), 1); return m; };
  const setList = Object.entries(sets);
  for (const pass of [0, 1]) for (const [sname, members] of setList) { // pass 0 = anims with their own frames, pass 1 = anims that reuse another anim's frames
    let ux0 = 1e9, uy0 = 1e9, ux1 = -1, uy1 = -1;
    const core = members.some((a) => a.e.core !== false) ? members.filter((a) => a.e.core !== false) : members; // core:false anims (attack, death...) do not move the shared anchor
    for (const a of core) for (const t of trimmed.get(a)) { if (t.empty) continue; ux0 = Math.min(ux0, t.x0); uy0 = Math.min(uy0, t.y0); ux1 = Math.max(ux1, t.x0 + t.w - 1); uy1 = Math.max(uy1, t.y0 + t.h - 1); }
    if (ux1 < 0) { ux0 = 0; uy0 = 0; ux1 = 0; uy1 = 0; }
    for (const a of members) {
      if ((a.use ? 1 : 0) !== pass) continue;
      const e = a.e, plan = pagePlans[e.page], list = trimmed.get(a); let ids = [];
      if (a.use) { const src = meta.anims[a.use.e.id]; ids = a.pick.map((i) => src.f[i]); }
      else list.forEach((t, i) => {
        const fid = a.fr.length === 1 ? e.id : e.id + '.' + i; ids.push(fid);
        if (t.empty) meta.frames[fid] = { p: e.page, x: 0, y: 0, w: 0, h: 0, ox: 0, oy: 0 };
        else { const pos = plan.packed.pos[t.key]; meta.frames[fid] = { p: e.page, x: pos[0], y: pos[1], w: t.w, h: t.h, ox: t.x0, oy: t.y0 }; }
      });
      const pv = e.pivot || 'feet'; let ax, ay;
      const feetX = Math.floor((ux0 + ux1 + 1) / 2), feetY = uy1 + 1;
      if (Array.isArray(pv)) { ax = pv[0]; ay = pv[1]; }
      else if (pv === 'tl') { ax = 0; ay = 0; }
      else if (pv === 'centre') { ax = Math.floor(a.fw / 2); ay = Math.floor(a.fh / 2); }
      else if (pv === 'grip') { ax = e.anchors.grip[0]; ay = e.anchors.grip[1]; }
      else { ax = feetX; ay = feetY; }
      const anchors = {};
      let at = uy0; // head line: the set union, or the anim's own when a foe/boss pose stands more than 3 art px under it (a shorter idle); smaller steps keep the union so direction sets do not wobble
      if (/^(foe|boss)\./.test(e.id) && !e.anchorsFrom) { let own = 1e9; for (const fid of ids) { const q = meta.frames[fid]; if (q.h > 0) own = Math.min(own, q.oy); } if (own < 1e9 && own - uy0 > 3) at = own; }
      anchors.centre = [Math.floor((ux0 + ux1 + 1) / 2), Math.floor((at + uy1 + 1) / 2)]; anchors.top = at;
      if (e.anchors) for (const k of Object.keys(e.anchors)) anchors[k] = e.anchors[k];
      if (e.handRel) anchors.hand = [feetX + e.handRel[0], feetY + e.handRel[1]];
      if (e.head) anchors.head = a.fr.map((b) => headAt(b, e.head === true ? [] : e.head));
      if (e.eye === 'auto') anchors.eye = [[anchors.centre[0], at + Math.round((uy1 - at + 1) * 0.3)]];
      else if (Array.isArray(e.eye)) anchors.eye = e.eye;
      if (anchors.grip) { // tip = opaque pixel of frame 0 farthest from the grip (ties: top, then left)
        const b = a.fr[0]; let best = null;
        for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.data[(y * b.w + x) * 4 + 3]) { const d = (x - anchors.grip[0]) ** 2 + (y - anchors.grip[1]) ** 2; if (!best || d > best.d) best = { d, x, y }; }
        if (best) anchors.tip = [best.x, best.y];
      }
      if (e.anchorsFrom) { // centre/top/eye follow another anim's, translated by the pivot difference (keeps HP bar and eye glow fixed across sets)
        const src = meta.anims[e.anchorsFrom]; if (!src) throw new Error(e.id + ': anchorsFrom unknown or later anim ' + e.anchorsFrom);
        const dx = ax - src.ax, dy = ay - src.ay;
        anchors.centre = [src.anchors.centre[0] + dx, src.anchors.centre[1] + dy]; anchors.top = src.anchors.top + dy;
        if (src.anchors.eye) anchors.eye = src.anchors.eye.map(([x, y]) => [x + dx, y + dy]);
      }
      const rec = { f: ids, fps: e.fps || 0, loop: !!e.loop, fw: a.fw, fh: a.fh, ax, ay, anchors };
      meta.anims[e.id] = rec;
      if (!e.font && !/^(fx|fxbig)\./.test(e.id)) meta.pal[e.id] = [...colourSet(a).keys()].sort((p, q) => { const A = unhex(p), B = unhex(q); return lumOf(...A) - lumOf(...B) || (p < q ? -1 : 1); });
    }
  }
  const fontOut = { h: fontDef.h, gap: fontDef.gap, space: fontDef.space, glyphs: glyphIds };
  return { meta, pages, fontOut, swaps: resolveSwaps(M.swaps || {}, meta.pal), M };
}
// Hat seat of a body frame: [x, y] = centre of the first row (from the top) holding >= 7 pixels (a hat's width) that are neither outline nor a skip colour, y one row
// below it (a hat drawn with its bottom edge there overlaps that row); null for an empty frame.
function headAt(b, skip) {
  const no = new Set([OUTLINE].concat(skip.map((c) => c.toLowerCase())));
  for (let y = 0; y < b.h; y++) {
    let x0 = -1, x1 = -1, n = 0;
    for (let x = 0; x < b.w; x++) { const d = (y * b.w + x) * 4; if (!b.data[d + 3] || no.has(hex(b.data[d], b.data[d + 1], b.data[d + 2]))) continue; n++; if (x0 < 0) x0 = x; x1 = x; }
    if (n >= 7) return [Math.floor((x0 + x1 + 1) / 2), y + 1];
  }
  return null;
}
// Swap entries with `ash` (ramp stops dark to light) become { base, key }: every colour of the hero.<cls>.* anims except the outline and the key
// colours, ranked by luminance onto the ramp (cls = the swap id before the first dot).
function resolveSwaps(swaps, pal) {
  const out = {};
  for (const id of Object.keys(swaps)) {
    const sw = swaps[id];
    if (!sw.ash) { out[id] = sw; continue; }
    const pre = 'hero.' + id.split('.')[0] + '.', key = sw.key.map((c) => c.toLowerCase()), set = new Set();
    for (const aid of Object.keys(pal)) if (aid.startsWith(pre)) for (const h of pal[aid]) if (h !== OUTLINE && !key.includes(h)) set.add(h);
    if (!set.size) throw new Error('swap ' + id + ': no hero colours');
    const list = [...set].sort((p, q) => lumOf(...unhex(p)) - lumOf(...unhex(q)) || (p < q ? -1 : 1)), st = sw.ash.map(unhex), base = {};
    list.forEach((h, i) => {
      const t = (i + 0.5) / list.length * (st.length - 1), k = Math.min(st.length - 2, Math.floor(t)), f = t - k;
      base[h] = hex(...st[k].map((v, j) => Math.round(v + (st[k + 1][j] - v) * f)));
    });
    out[id] = { base, key: sw.key };
  }
  return out;
}

// ---------------------------------------------------------------- fonts
// art-src/fonts/*.ttf -> src/art/fonts.css (@font-face, WOFF 1.0 data URIs). px = font units per font pixel (the outline grid).
// Each font is re-gridded to 1 em = 16 font px (unitsPerEm = 16 * px; outlines untouched), so every family is crisp at font-size = 16n device px.
// Vertical metrics: hhea = OS/2 typo = win, rounded to whole font px, line gap 0, USE_TYPO_METRICS set (same line box on every platform).
const FONTS = [
  { family: 'Pixel Operator', file: 'pixel-operator/PixelOperator.ttf', px: 100, weight: '100 549' },
  { family: 'Pixel Operator', file: 'pixel-operator/PixelOperator-Bold.ttf', px: 100, weight: '550 1000' },
  { family: 'Pixel Operator 8', file: 'pixel-operator/PixelOperator8.ttf', px: 100, weight: '100 549' },
  { family: 'Pixel Operator 8', file: 'pixel-operator/PixelOperator8-Bold.ttf', px: 100, weight: '550 1000' },
  { family: 'Pixel Operator Mono', file: 'pixel-operator/PixelOperatorMono.ttf', px: 100, weight: '100 1000' },
];
const FONT_NOTICE = [
  'Pixel Operator, Pixel Operator 8, Pixel Operator Mono: Jayvee Enaguas (HarvettFox96), CC0 1.0 (art-src/fonts/pixel-operator/LICENSE.txt).',
];
const pad4 = (n) => (n + 3) & ~3;
function sfntSum(buf) { let s = 0; const b = buf.length & 3 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length & 3))]) : buf; for (let i = 0; i < b.length; i += 4) s = (s + b.readUInt32BE(i)) >>> 0; return s; }
function sfntRead(buf) {
  const n = buf.readUInt16BE(4), tabs = [];
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; tabs.push({ tag: buf.toString('latin1', o, o + 4), data: Buffer.from(buf.subarray(buf.readUInt32BE(o + 8), buf.readUInt32BE(o + 8) + buf.readUInt32BE(o + 12))) }); }
  return { flavor: buf.readUInt32BE(0), tabs: tabs.sort((a, b) => (a.tag < b.tag ? -1 : 1)) };
}
function sfntWrite(flavor, tabs) { // tabs sorted by tag; returns the TTF bytes (head.checksumAdjustment must be 0 on entry)
  const n = tabs.length, es = Math.floor(Math.log2(n)), sr = 16 << es, hdr = Buffer.alloc(12 + 16 * n);
  hdr.writeUInt32BE(flavor, 0); hdr.writeUInt16BE(n, 4); hdr.writeUInt16BE(sr, 6); hdr.writeUInt16BE(es, 8); hdr.writeUInt16BE(n * 16 - sr, 10);
  let off = hdr.length; const body = [];
  tabs.forEach((t, i) => { const o = 12 + i * 16; t.sum = sfntSum(t.data); hdr.write(t.tag, o, 'latin1'); hdr.writeUInt32BE(t.sum, o + 4); hdr.writeUInt32BE(off, o + 8); hdr.writeUInt32BE(t.data.length, o + 12); body.push(t.data, Buffer.alloc(pad4(t.data.length) - t.data.length)); off += pad4(t.data.length); });
  return Buffer.concat([hdr, ...body]);
}
function woffWrite(flavor, tabs, sfntSize) { // WOFF 1.0: per-table zlib streams (stored raw when not smaller); t.sum from sfntWrite
  const n = tabs.length, hdr = Buffer.alloc(44 + 20 * n), body = [];
  let off = hdr.length;
  tabs.forEach((t, i) => {
    const z = zlib.deflateSync(t.data, { level: 9 }), d = z.length < t.data.length ? z : t.data, o = 44 + i * 20;
    hdr.write(t.tag, o, 'latin1'); hdr.writeUInt32BE(off, o + 4); hdr.writeUInt32BE(d.length, o + 8); hdr.writeUInt32BE(t.data.length, o + 12); hdr.writeUInt32BE(t.sum, o + 16);
    body.push(d, Buffer.alloc(pad4(d.length) - d.length)); off += pad4(d.length);
  });
  hdr.write('wOFF', 0, 'latin1'); hdr.writeUInt32BE(flavor, 4); hdr.writeUInt32BE(off, 8); hdr.writeUInt16BE(n, 12); hdr.writeUInt32BE(sfntSize, 16); hdr.writeUInt16BE(1, 20);
  return Buffer.concat([hdr, ...body]);
}
// regridFont(ttf, px) -> WOFF bytes: unitsPerEm = 16 * px, unified whole-pixel vertical metrics, fresh checksums.
function regridFont(ttf, px) {
  const { flavor, tabs } = sfntRead(ttf), T = {}; for (const t of tabs) T[t.tag] = t.data;
  const head = T.head, hhea = T.hhea, os2 = T['OS/2'], r = (v) => Math.round(v / px) * px;
  head.writeUInt32BE(0, 8); head.writeUInt16BE(16 * px, 18);
  const asc = r(hhea.readInt16BE(4)), desc = r(hhea.readInt16BE(6));
  hhea.writeInt16BE(asc, 4); hhea.writeInt16BE(desc, 6); hhea.writeInt16BE(0, 8);
  if (os2) {
    os2.writeInt16BE(asc, 68); os2.writeInt16BE(desc, 70); os2.writeInt16BE(0, 72); os2.writeUInt16BE(asc, 74); os2.writeUInt16BE(-desc, 76);
    if (os2.readUInt16BE(0) >= 4) os2.writeUInt16BE(os2.readUInt16BE(62) | 0x80, 62);
  }
  const sfnt = sfntWrite(flavor, tabs);
  head.writeUInt32BE((0xb1b0afba - sfntSum(sfnt)) >>> 0, 8);
  return { woff: woffWrite(flavor, tabs, sfnt.length), asc: asc / px, desc: -desc / px };
}
function buildFonts() {
  const nl = '\n', rows = [];
  let css = '/* Generated by tools/art.js from art-src/fonts/ - do not edit. 1 em = 16 font px for every family: crisp at font-size = 16n device px.' + nl;
  for (const l of FONT_NOTICE) css += '   ' + l + nl;
  css += '*/' + nl;
  for (const f of FONTS) {
    const ttf = fs.readFileSync(path.join(SRC, 'fonts', f.file)), out = regridFont(ttf, f.px);
    css += '@font-face { font-family: "' + f.family + '"; src: url(data:font/woff;base64,' + out.woff.toString('base64') + ') format("woff"); font-weight: ' + f.weight + (f.range ? '; unicode-range: ' + f.range : '') + '; font-style: normal; font-display: block; }' + nl;
    rows.push({ file: f.file, ttf: ttf.length, woff: out.woff.length, asc: out.asc, desc: out.desc });
  }
  return { css, rows };
}

// ---------------------------------------------------------------- emit
const jstr = (o) => JSON.stringify(o);
function emitFiles(res) {
  const files = {}; const nl = '\n'; // LF: the repo index stores LF; autocrlf converts on checkout
  const header = '// Generated by tools/art.js from art-src/ and tools/art-manifest.js - do not edit. Art px units (1 art px = 2 world px).' + nl;
  // anchors/anim rows: one line per anim for reviewable diffs
  const sorted = (o) => Object.keys(o).sort();
  let m = header + '(function (ED) {' + nl + "  'use strict';" + nl + '  ED.ART = { pages: {}, frames: {}, anims: {}, pal: {}, font: ' + jstr(res.fontOut) + ', swaps: ' + jstr(res.swaps) + ' };' + nl + '  const A = ED.ART;' + nl;
  m += '  A.frames = {' + nl; for (const k of sorted(res.meta.frames)) { const f = res.meta.frames[k]; m += '    ' + jstr(k) + ': ' + jstr(f) + ',' + nl; } m += '  };' + nl;
  m += '  A.anims = {' + nl; for (const k of sorted(res.meta.anims)) m += '    ' + jstr(k) + ': ' + jstr(res.meta.anims[k]) + ',' + nl; m += '  };' + nl;
  m += '  A.pal = {' + nl; for (const k of sorted(res.meta.pal)) m += '    ' + jstr(k) + ': ' + jstr(res.meta.pal[k]) + ',' + nl; m += '  };' + nl;
  m += '})(globalThis.ED || (globalThis.ED = {}));' + nl;
  files['meta.js'] = m;
  for (const pg of res.M.pages) {
    if (!res.pages[pg]) continue;
    files[pg + '.js'] = header + "globalThis.ED.ART.pages." + pg + ' = ' + jstr(res.pages[pg].uri) + ';' + nl;
  }
  return files;
}
function normNl(s) { return s.replace(/\r\n/g, '\n'); }

function main() {
  const check = process.argv.includes('--check');
  const t0 = Date.now(), res = build(), files = emitFiles(res), fonts = buildFonts();
  files['fonts.css'] = fonts.css;
  if (check) {
    let bad = 0;
    for (const [name, text] of Object.entries(files)) {
      const f = path.join(OUT, name);
      if (!fs.existsSync(f) || normNl(fs.readFileSync(f, 'utf8')) !== normNl(text)) { console.error('DIFF src/art/' + name); bad++; }
    }
    for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) if (f.endsWith('.js') && !files[f]) { console.error('STALE src/art/' + f); bad++; }
    if (bad) { console.error('art --check failed: run node tools/art.js'); process.exit(1); }
    console.log('art --check ok (' + (Date.now() - t0) + ' ms)'); return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.js') && !files[f]) fs.unlinkSync(path.join(OUT, f));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), text);
  let total = 0;
  console.log('page        px           frames   png KB   js KB');
  for (const pg of res.M.pages) {
    const p = res.pages[pg]; if (!p) continue;
    const js = Buffer.byteLength(files[pg + '.js']); total += js;
    console.log(pg.padEnd(11), (p.w + 'x' + p.h).padEnd(12), String(p.nFrames).padStart(6), (p.png.length / 1024).toFixed(1).padStart(8), (js / 1024).toFixed(1).padStart(7));
  }
  const metaKB = Buffer.byteLength(files['meta.js']) / 1024; total += Buffer.byteLength(files['meta.js']);
  console.log('meta.js'.padEnd(11), ''.padEnd(12), ''.padStart(6), ''.padStart(8), metaKB.toFixed(1).padStart(7));
  for (const f of fonts.rows) console.log('font ' + f.file.padEnd(52) + ' ttf ' + (f.ttf / 1024).toFixed(1).padStart(6) + ' KB  woff ' + (f.woff / 1024).toFixed(1).padStart(6) + ' KB  asc ' + f.asc + ' desc ' + f.desc + ' font px');
  console.log('fonts.css ' + (Buffer.byteLength(fonts.css) / 1024).toFixed(1) + ' KB');
  console.log('total data URIs + meta: ' + (total / 1024).toFixed(1) + ' KB; anims ' + Object.keys(res.meta.anims).length + ', frames ' + Object.keys(res.meta.frames).length + ' (' + (Date.now() - t0) + ' ms)');
}

module.exports = { decodePNG, encodePNG, build, emitFiles, cut, hex, unhex, bbox, mapPixels, loadSheets, parseTileList, SRC, ROOT };
if (require.main === module) main();
