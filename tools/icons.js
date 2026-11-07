#!/usr/bin/env node
'use strict';
// PWA icon builder: the lit brazier (prop.brazier frame 0 from the generated atlas src/art/*.js) on the dark page colour with a stepped ember halo,
// nearest-neighbour upscaled by an integer factor -> icons/*.png. Deterministic (art.js PNG encoder).
// Usage: node tools/icons.js [--check]   (--check rebuilds in memory and fails if icons/ differs)
// Maskable: the sprite's half-diagonal stays inside 95% of the 40% safe-zone radius.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { decodePNG, encodePNG, unhex, ROOT } = require('./art.js');

const OUT = path.join(ROOT, 'icons');
const SPRITE = 'prop.brazier';
const BG = unhex('#0b0908');
const HALO = [[4.5, unhex('#3c1f0f')], [6.5, unhex('#29160c')], [8.5, unhex('#1a100a')]]; // [radius in sprite px, colour], inner first
const ICONS = [ // file, size, sprite fill (fraction of the canvas height), maskable
  ['icon-192.png', 192, 0.72, false],
  ['icon-512.png', 512, 0.72, false],
  ['apple-touch-180.png', 180, 0.72, false],
  ['maskable-512.png', 512, 0, true],
];

function loadSprite() {
  const ctx = { ED: {} }; ctx.globalThis = ctx; vm.createContext(ctx);
  const dir = path.join(ROOT, 'src', 'art');
  for (const f of ['meta.js', 'world.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: 'src/art/' + f });
  const A = ctx.ED.ART, an = A.anims[SPRITE];
  if (!an) throw new Error('anim ' + SPRITE + ' missing from src/art');
  const fr = A.frames[an.f[0]], pg = decodePNG(Buffer.from(A.pages[fr.p].split(',')[1], 'base64'));
  const px = new Uint8Array(an.fw * an.fh * 4); // logical frame, RGBA
  for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
    const s = ((fr.y + y) * pg.w + fr.x + x) * 4, d = ((fr.oy + y) * an.fw + fr.ox + x) * 4;
    for (let k = 0; k < 4; k++) px[d + k] = pg.data[s + k];
  }
  const c = an.anchors && an.anchors.centre;
  return { w: an.fw, h: an.fh, px, cx: c ? c[0] : an.fw / 2, cy: c ? c[1] - 4 : an.fh / 2 }; // halo centred on the flame, above the bowl
}

function icon(sp, size, fill, maskable) {
  const S = maskable ? Math.floor(0.95 * 0.4 * size / Math.hypot(sp.w / 2, sp.h / 2)) : Math.floor(fill * size / sp.h);
  const ox = Math.floor((size - sp.w * S) / 2), oy = Math.floor((size - sp.h * S) / 2);
  const o = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const lx = Math.floor((x - ox) / S), ly = Math.floor((y - oy) / S), d = (y * size + x) * 4;
    let col = BG;
    const r = Math.hypot(lx + 0.5 - sp.cx, ly + 0.5 - sp.cy);
    for (const [hr, hc] of HALO) if (r <= hr) { col = hc; break; }
    o[d] = col[0]; o[d + 1] = col[1]; o[d + 2] = col[2]; o[d + 3] = 255;
    if (lx >= 0 && ly >= 0 && lx < sp.w && ly < sp.h) {
      const s = (ly * sp.w + lx) * 4;
      if (sp.px[s + 3] >= 128) { o[d] = sp.px[s]; o[d + 1] = sp.px[s + 1]; o[d + 2] = sp.px[s + 2]; }
    }
  }
  return encodePNG(size, size, o);
}

function main() {
  const check = process.argv.includes('--check'), sp = loadSprite();
  let bad = 0;
  if (!check) fs.mkdirSync(OUT, { recursive: true });
  for (const [file, size, fill, mask] of ICONS) {
    const png = icon(sp, size, fill, mask), f = path.join(OUT, file);
    if (check) { if (!fs.existsSync(f) || !fs.readFileSync(f).equals(png)) { console.error('DIFF icons/' + file); bad++; } continue; }
    fs.writeFileSync(f, png);
    console.log('icons/' + file.padEnd(20) + (size + 'px').padStart(6) + (png.length / 1024).toFixed(1).padStart(7) + ' KB');
  }
  if (bad) { console.error('icons --check failed: run node tools/icons.js'); process.exit(1); }
  if (check) console.log('icons --check ok');
}

main();
