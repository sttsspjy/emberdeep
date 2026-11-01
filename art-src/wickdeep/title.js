'use strict';
// Hand-authored pixel art for Wickdeep (CC0, own work): the title wordmark "WICKDEEP" (wax letters, the I a candle with a wick) and its wick flame.
// Letters: '#' = wax, 'w' = wick, '.' = empty; rows 0..13 are the letter body, rows 14+ wax drips. bake(H) shades and outlines them into one bitmap. Read by tools/art-manifest.js.

const GAP = 2; // empty columns between letters (their outlines meet)
const BODY = 14; // letter body rows; drips hang below
const LETTERS = [
  [ // W
    '###.........###',
    '###.........###',
    '###.........###',
    '###.........###',
    '###....#....###',
    '###...###...###',
    '###...###...###',
    '###...###...###',
    '###..#####..###',
    '###..#####..###',
    '####.##.##.####',
    '.######.######.',
    '.#####...#####.',
    '..###.....###..',
    '...##..........',
    '...##..........',
    '...##..........'],
  [ // I: a candle, wick on top, wax running off the rim
    '...w...',
    '...w...',
    '#######',
    '#######',
    '#.###.#',
    '#.###..',
    '#.###..',
    '..###..',
    '..###..',
    '..###..',
    '..###..',
    '..###..',
    '#######',
    '#######'],
  [ // C
    '..######..',
    '.########.',
    '####...###',
    '###.....##',
    '###.......',
    '###.......',
    '###.......',
    '###.......',
    '###.......',
    '###.......',
    '###.....##',
    '####...###',
    '.########.',
    '..######..',
    '..##......',
    '..##......',
    '..##......'],
  [ // K
    '###.....###',
    '###....###.',
    '###...###..',
    '###..###...',
    '###.###....',
    '######.....',
    '#####......',
    '######.....',
    '###.###....',
    '###..###...',
    '###...###..',
    '###....###.',
    '###.....###',
    '###.....###',
    '.........##'],
  [ // D
    '########...',
    '#########..',
    '###...####.',
    '###....###.',
    '###.....###',
    '###.....###',
    '###.....###',
    '###.....###',
    '###.....###',
    '###.....###',
    '###....###.',
    '###...####.',
    '#########..',
    '########...',
    '.##........',
    '.##........'],
  [ // E
    '#########',
    '#########',
    '###......',
    '###......',
    '###......',
    '###......',
    '#######..',
    '#######..',
    '###......',
    '###......',
    '###......',
    '###......',
    '#########',
    '#########',
    '.##......',
    '.##......',
    '.##......',
    '.##......'],
  [ // E
    '#########',
    '#########',
    '###......',
    '###......',
    '###......',
    '###......',
    '#######..',
    '#######..',
    '###......',
    '###......',
    '###......',
    '###......',
    '#########',
    '#########',
    '....##...',
    '....##...'],
  [ // P
    '########..',
    '#########.',
    '###...####',
    '###....###',
    '###....###',
    '###...####',
    '#########.',
    '########..',
    '###.......',
    '###.......',
    '###.......',
    '###.......',
    '###.......',
    '###.......',
    '.##.......',
    '.##.......',
    '.##.......'],
];
// The I's top starts 2 rows below the others (a burnt-down candle).
const DROP = [0, 2, 0, 0, 0, 0, 0, 0];

const PAL = {
  band: ['#fff1cf', '#ffd98e', '#ffbc5c', '#f0913c', '#d06a2a'], // wax body, top to bottom (3 rows each, dithered seams)
  hi: '#fffdf4', // top-edge highlight
  lo: '#a8501e', // bottom-edge shade
  drip: ['#e07e34', '#c8622a'], // drips: neck, lower
  wick: ['#7a4a2a', '#2e1a12'], // wick: tip, stem
  ext: ['#8a3414', '#561e0c'], // extrusion (2 px down)
  out: '#1a0806', // outline
};
// Wick flame, 7 x 11, bottom centre on the wick tip: 4 frames.
const FLAME_PAL = { r: '#b8361a', o: '#ff6a1c', O: '#ff9f34', y: '#ffd866', w: '#fffbe8' };
const FLAME = [
  ['...r...', '...o...', '..oO...', '..oOo..', '.oOOo..', '.oOyOo.', '.oOyOo.', 'oOyywOo', 'oOywwOo', '.oOwOo.', '..ooo..'],
  ['....r..', '...oo..', '...oO..', '..oOOo.', '..oOyo.', '.oOyOo.', '.oOyyOo', 'oOyywOo', 'oOywwOo', '.oOwOo.', '..ooo..'],
  ['...r...', '..ro...', '..oOo..', '..oOo..', '.oOyOo.', '.oOyOo.', '.oyyyo.', 'oOywyOo', 'oOywwOo', '.oOwOo.', '..ooo..'],
  ['.......', '..r....', '..oo...', '.oOo...', '.oOOo..', '.oOyOo.', 'oOyyOo.', 'oOyywOo', 'oOywwOo', '.oOwOo.', '..ooo..'],
];

const P = 1, X = 2; // outline pad, extrusion depth
// Layout of the wordmark in bitmap px: { W, H, m (0 empty, 1 wax, 2 wick per px), wick: [x, y] (wick tip), drips: [[x, y]..] (just below each drip of 3+ rows: where a falling drop starts) }.
function layout() {
  let w = 0, h = 0; const at = [];
  LETTERS.forEach((L, i) => { at.push(w); w += L[0].length + (i < LETTERS.length - 1 ? GAP : 0); h = Math.max(h, DROP[i] + L.length); });
  const W = w + 2 * P, Hh = h + X + 2 * P, m = new Uint8Array(W * Hh);
  let wick = null;
  LETTERS.forEach((L, i) => L.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) {
    const c = row[rx]; if (c === '.') continue;
    const x = at[i] + rx + P, y = DROP[i] + ry + P; m[y * W + x] = c === 'w' ? 2 : 1;
    if (c === 'w' && !wick) wick = [x, y];
  } }));
  const wax = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && m[y * W + x] === 1;
  const drips = [];
  for (let x = 0; x < W; x++) for (let y = P + BODY + 2; y < Hh; y++) if (wax(x, y) && !wax(x, y + 1) && !wax(x - 1, y)) drips.push([x, y + X + 2]);
  return { W, H: Hh, m, wax, wick, drips };
}
// Bakes the wordmark bitmap: banded wax with a top highlight and lit left edges, a 2 px extrusion below, a 1 px outline.
function bake(H) {
  const { W, H: Hh, m, wax } = layout();
  const mk = (x, y) => (x < 0 || y < 0 || x >= W || y >= Hh ? 0 : m[y * W + x]);
  const b = H.bmp(W, Hh), put = (x, y, col) => { const v = H.unhex(col), d = (y * W + x) * 4; b.data[d] = v[0]; b.data[d + 1] = v[1]; b.data[d + 2] = v[2]; b.data[d + 3] = 255; };
  const band = (ly) => Math.min(4, Math.floor(ly / 3));
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const v = mk(x, y), ly = y - P; // ly: row in the letter grid
    if (v === 2) { put(x, y, mk(x, y - 1) === 2 ? PAL.wick[1] : PAL.wick[0]); continue; }
    if (v === 1) {
      let col;
      if (ly >= BODY) col = !wax(x - 1, y) ? (wax(x, y + 1) ? PAL.band[3] : PAL.band[1]) : ly - BODY < 2 ? PAL.drip[0] : PAL.drip[1]; // bead highlight on the drip's tip
      else if (!wax(x, y - 1)) col = PAL.hi;
      else if (!wax(x, y + 1)) col = PAL.lo;
      else if (!wax(x - 1, y)) col = PAL.band[Math.max(0, band(ly) - 1)];
      else { const bi = band(ly); col = bi > 0 && ly % 3 === 0 && (x + y) % 2 === 0 ? PAL.band[bi - 1] : PAL.band[bi]; }
      put(x, y, col); continue;
    }
    if (wax(x, y - 1)) put(x, y, PAL.ext[0]);
    else if (wax(x, y - 2)) put(x, y, PAL.ext[1]);
  }
  return H.stamp(b, PAL.out);
}
// Anchors of title.logo (bitmap px).
const marks = () => { const l = layout(); return { wick: l.wick, drips: l.drips }; };

module.exports = { LETTERS, PAL, FLAME, FLAME_PAL, bake, marks };
