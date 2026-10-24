// Boon card art (client only, ED.CardArt): one 9-slice frame mask per card kind, rarity metals, idle and pick sprites, icon URLs at 1 icon px = 1 art px.
// Frame masks are 40 x 40 art px, slice 16, edges tiled (border-image repeat, 8 art px period): the card box starts at mask px 8 (the band's outer outline), so
// 8 art px of ornament sit outside the box. d = distance to the mask edge: band outline 8, metal 9-10 (lit on the top and left), outline 11, path line 12.
// Mask chars: o outline, M m d metal (rarity), Y P p q path tones (hi to dark), y X x z second path tones (duo), w white, k soot black, s soot,
// G g gold trim, L l n leather, '.' transparent, '_' cleared. Ornaments are drawn as fills; finish() outlines every fill outside the band.
// Frames bake on first use (ED.PixUI.frame) and publish --fr-card-<kind>[-<extra>]-<metal>[-big]; sprites bake at boot as --fr-cfx-<name>.
(function (ED) {
  'use strict';
  const PU = ED.PixUI, U = ED.U;
  if (!PU) return;
  const CA = ED.CardArt = {};
  const OL = '#222222', N = 40, SL = 16, B = 8; // mask size, slice, band offset

  // ---------------------------------------------------------------- palettes
  const METAL = {
    iron: ['#c9c1b3', '#857d71', '#4b453d'], silver: ['#e8f3ff', '#94b7de', '#48668e'],
    violet: ['#f0dcff', '#b385ec', '#5d3792'], gold: ['#fff2bc', '#e5ad3e', '#875a1b'],
    copper: ['#ffd9b8', '#d9773a', '#7a3a18'], black: ['#8f8288', '#4d4247', '#211a1e'],
  };
  const RAR_METAL = { c: 'iron', r: 'silver', e: 'violet', l: 'gold', d: 'violet', a: 'gold', m: 'copper', t: 'black' };
  CA.metal = (rar) => RAR_METAL[rar] || 'iron';
  const tones = (c) => [U.mix(c, '#ffffff', 0.55), c, U.shade(c, -0.32), U.shade(c, -0.64)];
  const TONE = {
    fire: ['#fff2a8', '#ff7a2a', '#cf461a', '#6e200e'], ice: ['#f2fdff', '#7fe3ff', '#38a2cf', '#1a527a'],
    lightning: ['#fffbe2', '#ffe66b', '#d6a428', '#715210'], poison: ['#dcffa0', '#9be33c', '#58a31c', '#2a5a0f'],
    holy: ['#ffffff', '#fff0c2', '#f2c454', '#8e6a22'], shadow: ['#e4d8ff', '#a070ff', '#6a3dc8', '#331966'],
    general: ['#ffffff', '#d9dfe8', '#8f99a8', '#48505e'],
  };
  const pal = (metal, t1, t2) => {
    const m = METAL[metal] || METAL.iron, o = { o: OL, M: m[0], m: m[1], d: m[2], k: '#0b0806', s: '#2b2118', G: '#ffe08a', g: '#b07a22', w: '#ffffff', L: '#a8754a', l: '#7a5232', n: '#4a2f1c' };
    [o.Y, o.P, o.p, o.q] = t1; if (t2) [o.y, o.X, o.x, o.z] = t2;
    return o;
  };

  // ---------------------------------------------------------------- mask helpers
  const dist = (x, y) => Math.min(x, y, N - 1 - x, N - 1 - y);
  const put = (g, x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N && c && c !== '.') g[y][x] = c; };
  // Pattern along sides ('t', 'b', 'l', 'r'): col(i) gives chars by depth outside the band (index 0 = 1 art px out, up to 8); i = the 8 art px edge tile phase.
  function edge(g, sides, col) {
    for (const s of sides) for (let a = B; a <= N - 1 - B; a++) {
      const cs = col(((a - SL) % 8 + 8) % 8, a);
      if (!cs) continue;
      for (let k = 0; k < cs.length; k++) {
        const dep = B - 1 - k;
        if (s === 't') put(g, a, dep, cs[k]); else if (s === 'b') put(g, a, N - 1 - dep, cs[k]); else if (s === 'l') put(g, dep, a, cs[k]); else put(g, N - 1 - dep, a, cs[k]);
      }
    }
  }
  // A fill pattern (rows of the top-left corner region) mirrored into the corners named in `which`.
  function corner(g, which, rows, x0, y0) {
    x0 = x0 || 0; y0 = y0 || 0;
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) {
      const c = r[i], x = x0 + i, y = y0 + j;
      if (c === '.') continue;
      if (which.includes('tl')) put(g, x, y, c); if (which.includes('tr')) put(g, N - 1 - x, y, c);
      if (which.includes('bl')) put(g, x, N - 1 - y, c); if (which.includes('br')) put(g, N - 1 - x, N - 1 - y, c);
    } });
  }
  // A 2 art px crystal / bolt line from (x0, y0) to (x1, y1) in top-left coords, lit char a, shade char b on the right-hand side.
  function line(pts, x0, y0, x1, y1, a, b) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let t = 0; t <= n; t++) {
      const x = Math.round(x0 + (x1 - x0) * t / n), y = Math.round(y0 + (y1 - y0) * t / n);
      pts.push([x, y, a]); if (t < n - 1 && b) pts.push(Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? [x, y + 1, b] : [x + 1, y, b]);
    }
    return pts;
  }
  const plot = (g, which, pts) => { for (const [x, y, c] of pts) corner(g, which, [c], x, y); };
  // The band (and with big the gold rim, gold line and corner studs); cut: chamfer, round: corner radius, chars: outline, lit, mid, dark, outline.
  function base(o) {
    const g = Array.from({ length: N }, () => Array(N).fill('.')), c = o.cut || 0, R = o.round || 0, ch = o.chars || 'oMmdo';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = Math.min(x, N - 1 - x), v = Math.min(y, N - 1 - y);
      let d = Math.min(u, v);
      if (c) d = Math.min(d, u + v - c);
      if (R && u < R && v < R) d = Math.min(d, Math.round(R - Math.hypot(R - u, R - v)));
      const m = dist(x, y), lit = m === x || m === y, inner = o.big ? 'G' : o.inner;
      const k = d === B ? ch[0] : d === B + 1 ? (lit ? ch[1] : ch[2]) : d === B + 2 ? (lit ? ch[2] : ch[3]) : d === B + 3 ? ch[4] : d === B + 4 && inner ? inner : o.big && d === B - 1 ? 'g' : null;
      if (k) g[y][x] = k;
    }
    if (o.big) corner(g, 'tl tr bl br', ['oooooo', 'oGGGgo', 'oGwGgo', 'oGGggo', 'oggggo', 'oooooo'], B - 1, B - 1);
    return g;
  }
  // Outlines every fill outside the band (4-neighbour), then clears '_' cells.
  function finish(g) {
    const fill = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !'._o'.includes(g[y][x]);
    const add = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] === '.' && dist(x, y) < B && (fill(x - 1, y) || fill(x + 1, y) || fill(x, y - 1) || fill(x, y + 1))) add.push([x, y]);
    for (const [x, y] of add) g[y][x] = 'o';
    for (const r of g) for (let x = 0; x < N; x++) if (r[x] === '_') r[x] = '.';
    return g;
  }
  const rowsOf = (g) => g.map((r) => r.join(''));

  // ---------------------------------------------------------------- kind masks (o: { big })
  const K = {};
  K.fire = (o) => { // jagged ember-tooth crown on soot iron, flame tongues up the top corners, coals under the bottom ones
    const g = base(Object.assign({ inner: 'q' }, o));
    const T = ['pPPPpPPp', 'PYwYPPYP', 'PYYYP.PP', '.PYP..P.', '.PYP....', '..Y.....', '..P.....']; // depth 1 up: two tongues per 8 art px
    edge(g, 't', (i) => T.map((r) => r[i]));
    corner(g, 'tl tr', ['...P....', '...Y....', '..PYP...', '..PYP...', '.PYYYP..', '.PYwYP..', '..PYYPP.', '..pPPPP.', '...pPPP.', '....pPP.', '.....pP.', '......p.'], 0, 2);
    corner(g, 'bl br', ['..qpPp...', '.pPYPPq..', '..qpPPp..', '...qpq...'], 4, 4);
    for (let a = B + 2; a < N - B - 2; a++) { if (a % 7 === 2) put(g, a, B + 1, 's'); if (a % 9 === 4) put(g, a, N - B - 2, 's'); if (a % 11 === 6) { put(g, B + 1, a, 's'); put(g, N - B - 2, a, 's'); } }
    return finish(g);
  };
  K.ice = (o) => { // faceted crystal shards out of every corner, rime on top, icicles under the bottom edge
    const g = base(Object.assign({ inner: 'q' }, o)), pts = [];
    line(pts, 8, 8, 1, 1, 'Y', 'p'); line(pts, 10, 7, 10, 1, 'Y', 'p'); line(pts, 7, 10, 1, 10, 'Y', 'p'); line(pts, 13, 7, 15, 4, 'P', null); line(pts, 7, 13, 4, 15, 'P', null);
    plot(g, 'tl tr bl br', pts);
    const IC = [5, 3, 0, 0, 2, 1, 0, 0];
    edge(g, 'b', (i) => Array.from({ length: IC[i] }, (_, k) => (k === IC[i] - 1 ? 'Y' : i % 2 ? 'p' : 'P')));
    return finish(g);
  };
  K.lightning = (o) => { // angular chevron frame: chamfered corners, a zigzag bolt line round every side, bolts out of the corners
    const g = base(Object.assign({ inner: 'q', cut: 8 }, o)), Z = [1, 2, 3, 4, 5, 4, 3, 2];
    edge(g, 'tblr', (i) => { const h = Z[i], c = Array(h + 1).fill('.'); c[h] = 'Y'; c[h - 1] = 'P'; return c; });
    const pts = [];
    for (const [x, y, c] of [[8, 8, 'P'], [7, 7, 'Y'], [6, 7, 'Y'], [5, 6, 'Y'], [5, 5, 'P'], [4, 4, 'Y'], [3, 4, 'Y'], [2, 3, 'Y'], [2, 2, 'P'], [1, 1, 'w'], [6, 6, 'w']]) pts.push([x, y, c]);
    plot(g, 'tl tr bl br', pts);
    return finish(g);
  };
  K.poison = (o) => { // organic rounded frame, swollen bulbs on the corners, slime on top, drips hanging from the bottom edge
    const g = base(Object.assign({ inner: 'q', round: 12 }, o));
    corner(g, 'tl tr bl br', ['..PPPP..', '.PYYPPp.', 'PYwPPppq', 'PYPPppq.', 'PPPppqq.', 'PppqqPp.', '.pqq.pq.', '..q.....'], 1, 1);
    edge(g, 't', (i) => [['P', 'P', 'p', '.', '.', 'p', '.', '.'][i], ['Y', 'P', '.', '.', '.', '.', '.', '.'][i]]);
    const DR = [0, 6, 5, 0, 0, 3, 3, 0];
    edge(g, 'b', (i) => [['p', 'P', 'p', 'p', 'p', 'P', 'p', 'p'][i]].concat(Array.from({ length: DR[i] }, (_, k) => (k === DR[i] - 1 ? (i % 2 ? 'Y' : 'P') : i % 2 ? 'P' : 'p'))));
    edge(g, 'lr', (i) => [['.', 'p', 'P', 'p', '.', '.', '.', '.'][i], i === 2 ? 'Y' : '.']);
    return finish(g);
  };
  K.holy = (o) => { // cathedral frame: tall pinnacles with crosses on the top corners, small spires along the top edge (the gable and halo are the crest sprite)
    const g = base(Object.assign({ inner: 'q' }, o));
    corner(g, 'tl tr', ['....Y...', '...YwY..', '....Y...', '....P...', '...PYp..', '...PYp..', '..PPYpp.', '..PYYpp.', '.PPYYppq'], 4, -1);
    edge(g, 't', (i) => [['.', '.', 'P', 'P', 'p', '.', '.', '.'][i], ['.', '.', 'P', 'Y', 'p', '.', '.', '.'][i], i === 3 ? 'P' : '.', i === 3 ? 'Y' : '.']);
    corner(g, 'bl br', ['...p...', '..pPp..', '...P...'], 5, 5);
    edge(g, 'b', (i) => [i === 3 ? 'P' : '.']);
    return finish(g);
  };
  K.shadow = (o) => { // torn ragged edge: shreds round every side, bites out of the band, long tatters below
    const g = base(Object.assign({ inner: 'q' }, o));
    const TOP = [2, 0, 1, 3, 0, 0, 2, 1], BOT = [5, 1, 0, 3, 7, 0, 2, 4], SIDE = [1, 0, 2, 0, 0, 3, 0, 1];
    const shred = (h, i) => Array.from({ length: h }, (_, k) => (k === h - 1 ? 'P' : i % 2 ? 'q' : 'p'));
    edge(g, 't', (i) => shred(TOP[i], i)); edge(g, 'b', (i) => shred(BOT[i], i)); edge(g, 'lr', (i) => shred(SIDE[i], i));
    for (let a = B + 2; a < N - B - 2; a++) { const i = ((a - SL) % 8 + 8) % 8; if (i === 5) { g[B][a] = '.'; g[B + 1][a] = 'o'; } if (i === 1) { g[N - 1 - B][a] = '.'; g[N - 2 - B][a] = 'o'; } }
    corner(g, 'tl tr bl br', ['.P......', '..p.....', '..qp....', '...qp...', '....q...'], 2, 2);
    return finish(g);
  };
  K.general = (o) => { // plain riveted steel: raised corner plates with rivets, a rivet every 8 art px on the band
    const g = base(Object.assign({ inner: 'k' }, o));
    corner(g, 'tl tr bl br', ['oooooooooooo', 'oMMMMMMMMMMo', 'oMwmmmmmwmdo', 'oMmmmmmmmmdo', 'oMmmoooooooo', 'oMmmo.......', 'oMmmo.......', 'oMmmo.......', 'oMwmo.......', 'oMmmo.......', 'oddddo......', 'oooooo......'], 4, 4);
    const rivet = (x, y) => { put(g, x, y, 'w'); put(g, x + 1, y, 'm'); put(g, x, y + 1, 'm'); put(g, x + 1, y + 1, 'd'); }; // 2 x 2 on the band
    for (let a = SL; a < N - SL; a++) if (((a - SL) % 8 + 8) % 8 === 3) { rivet(a, B + 1); rivet(a, N - B - 3); rivet(B + 1, a); rivet(N - B - 3, a); }
    return finish(g);
  };
  K.route = (o) => { // heraldic banner: spear finials on the top corners, a dagged (pointed) bottom edge in the class colour
    const g = base(Object.assign({ inner: 'q' }, o));
    corner(g, 'tl tr', ['...Y...', '..YPp..', '.YPPpp.', '..Pqp..', '...q...', '...q...', '..PYp..', '...q...'], 6, 0);
    const D = [1, 2, 3, 4, 4, 3, 2, 1];
    edge(g, 'b', (i) => Array.from({ length: D[i] }, (_, k) => (k === 0 ? 'p' : i < 4 ? 'P' : 'p')));
    edge(g, 't', (i) => [i === 4 ? 'P' : '.']);
    return finish(g);
  };
  K.asc = (o) => { // gilded: gold scroll brackets outside every corner with a gem, gold beads on the edges (the wings are sprites)
    const g = base(Object.assign({ inner: 'G' }, o));
    corner(g, 'tl tr bl br', ['.GG..........', 'GwGGGGGGGGGg.', 'GGPPgggggggg.', '.GPYg........', '.GgPg........', '.Gg.g........', '.Gg..........', '.Gg..........', '.Gg..........', '.Gg..........', '.Gg..........', '.gg..........', '..g..........'], 1, 1);
    edge(g, 'tblr', (i) => ['.', i % 4 === 1 ? 'G' : '.']);
    return finish(g);
  };
  K.purse = (o) => { // leather pouch: gathered top, stitched leather band, metal corner caps
    const g = base(Object.assign({ inner: 'n', round: 8, chars: 'oLlno' }, o));
    for (let a = B + 2; a < N - B - 2; a++) { if (a % 2 === 0) { put(g, a, B + 2, 'Y'); put(g, a, N - B - 3, 'Y'); put(g, B + 2, a, 'Y'); put(g, N - B - 3, a, 'Y'); } }
    edge(g, 't', (i) => [['L', 'L', 'l', 'n', 'L', 'L', 'l', 'n'][i], ['.', 'L', 'l', '.', '.', 'L', 'l', '.'][i]]);
    corner(g, 'tl tr bl br', ['.ooooo', 'oMMMmo', 'oMwmdo', 'oMmddo', 'ommddo', '.oooo.'], B - 2, B - 2);
    return finish(g);
  };
  K.mut = (o) => { // grown: a double helix along the top and bottom bands, cysts swelling out of the corners, nodules on the sides
    const g = base(Object.assign({ inner: 'q', round: 6 }, o));
    edge(g, 'tb', (i) => {
      const v = Math.round(1.6 * Math.sin(i * Math.PI / 4)), a = 2 + v, b = 2 - v, c = Array(5).fill('.');
      if (a === b) { c[a] = 'Y'; return c; }
      if (i % 4 === 2) for (let k = Math.min(a, b) + 1; k < Math.max(a, b); k++) c[k] = 'q'; // the rungs
      c[a] = 'P'; c[b] = 'p';
      return c;
    });
    edge(g, 'lr', (i) => (i === 2 ? ['P', 'Y'] : i === 6 ? ['p'] : null));
    corner(g, 'tl tr bl br', ['..pPp..', '.pPYPp.', 'pPYwYPp', 'pPYYPPp', '.pPPPp.', '..ppp..'], 1, 1);
    return finish(g);
  };
  K.twist = (o) => { // a pact: barbed wire wound round the band, hooked thorns out of every corner (the wax seal is the crest sprite)
    const g = base(Object.assign({ inner: 'q' }, o)), WIRE = ['q', 'p', 'P', 'p', 'q', 'p', 'P', 'p'], pts = [];
    edge(g, 'tblr', (i) => { const c = ['.', WIRE[i], '.', '.']; if (i === 2) { c[0] = 'p'; c[2] = 'P'; c[3] = 'Y'; } if (i === 6) { c[0] = 'q'; c[2] = 'p'; } return c; });
    line(pts, 7, 7, 2, 2, 'P', 'q'); pts.push([1, 1, 'Y'], [3, 1, 'p'], [1, 3, 'p']);
    plot(g, 'tl tr bl br', pts);
    return finish(g);
  };
  // Duo: the first path's mask on the top and left, the second's on the bottom and right, the top-right and bottom-left corners split on the diagonal.
  const SECOND = { Y: 'y', P: 'X', p: 'x', q: 'z' };
  function duo(a, b, o) {
    const A = (K[a] || K.fire)(o), Bm = (K[b] || K.ice)(o), g = A.map((r) => r.slice());
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const cx = x < SL ? 0 : x >= N - SL ? 2 : 1, cy = y < SL ? 0 : y >= N - SL ? 2 : 1;
      let second;
      if (cx === 2 && cy === 0) second = (x - (N - SL)) + y >= SL - 1; // top-right corner
      else if (cx === 0 && cy === 2) second = x + (y - (N - SL)) >= SL - 1; // bottom-left corner
      else second = cx === 2 || cy === 2;
      if (second) { const c = Bm[y][x]; g[y][x] = SECOND[c] || c; }
    }
    return g;
  }

  // ---------------------------------------------------------------- lazy frame bake
  // CSS value of the frame for (kind, metal, opts { a, b: duo paths; cls: route class; big }); bakes it once.
  const made = {};
  CA.frame = (kind, metal, o) => {
    o = o || {};
    const extra = kind === 'duo' ? (o.a || 'fire') + '-' + (o.b || 'ice') : kind === 'route' ? (o.cls || 'knight') : '';
    const name = 'card-' + kind + (extra ? '-' + extra : '') + '-' + metal + (o.big ? '-big' : '');
    if (!made[name]) {
      const big = { big: !!o.big };
      let g, t1, t2;
      if (kind === 'duo') { g = duo(o.a, o.b, big); t1 = TONE[o.a] || TONE.fire; t2 = TONE[o.b] || TONE.ice; }
      else if (kind === 'route') { g = K.route(big); const cl = ED.CLASSES[o.cls]; t1 = tones(cl ? cl.col.c : '#d6aa55'); }
      else { g = (K[kind] || K.general)(big); t1 = kind === 'purse' ? ['#ffe9a0', '#ffd36b', '#b8892c', '#5e4410'] : kind === 'asc' ? tones(ED.RARITY.a.color) : kind === 'mut' ? tones(ED.RARITY.m.color) : kind === 'twist' ? tones(ED.RARITY.t.color) : TONE[kind] || TONE.general; }
      PU.frame(name, { rows: rowsOf(g), pal: pal(metal, t1, t2), slice: SL, border: SL });
      made[name] = 1;
    }
    return 'var(--fr-' + name + ')';
  };
  CA.N = N; CA.SLICE = SL;
  // ---------------------------------------------------------------- sprites (strips bake at boot)
  // strip(n, w, h, fn): n frames of w x h, fn(f, set) draws frame f with set(x, y, ch).
  const strip = (n, w, h, fn) => Array.from({ length: n }, (_, f) => { const g = Array.from({ length: h }, () => Array(w).fill('.')); fn(f, (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; }); return g.map((r) => r.join('')); });
  const sp = (name, rows, p, extra) => PU.frame('cfx-' + name, Object.assign({ rows, pal: Object.assign({ o: OL }, p) }, extra || {}));
  // fire: a spark rises 1 art px per frame and cools (3 x 10, 8 frames)
  sp('spark', strip(8, 3, 10, (f, s) => { const y = 9 - f, c = f < 3 ? 'Y' : f < 5 ? 'P' : f < 7 ? 'p' : null; if (!c) return; s(1, y, c); if (f < 2) { s(1, y + 1, 'P'); } if (f === 3) s(0, y + 1, 'p'); }), { Y: '#fff2a8', P: '#ff7a2a', p: '#a8381a' });
  // ice: frost creeps along an edge from its left end and melts back (16 x 5, 8 frames)
  sp('frost', strip(8, 16, 5, (f, s) => {
    const len = [2, 5, 8, 11, 14, 16, 12, 6][f], fade = f >= 6;
    for (let x = 0; x < len; x++) { s(x, 2, fade && x % 2 ? 'p' : 'I'); if (x % 4 === 1) { s(x, 1, 'P'); s(x, 3, 'P'); } if (x % 8 === 5 && !fade) { s(x, 0, 'I'); s(x, 4, 'I'); } }
  }), { I: '#f2fdff', P: '#9be9ff', p: '#38a2cf' });
  // lightning: a spark that runs around the card edge (5 x 5, 2 frames: plus, cross)
  sp('zap', strip(2, 5, 5, (f, s) => { if (f === 0) { for (let i = 0; i < 5; i++) { s(2, i, i === 2 ? 'w' : 'Y'); s(i, 2, i === 2 ? 'w' : 'Y'); } } else { for (let i = 0; i < 5; i++) { s(i, i, i === 2 ? 'w' : 'P'); s(4 - i, i, i === 2 ? 'w' : 'P'); } } }), { w: '#ffffff', Y: '#ffe66b', P: '#fff6b0' });
  // poison: a bubble rises, swells and pops (6 x 12, 8 frames)
  sp('bubble', strip(8, 6, 12, (f, s) => {
    if (f === 7) return;
    const y = 10 - f * 1.4 | 0;
    if (f === 6) { s(1, y, 'P'); s(4, y, 'P'); s(2, y - 1, 'Y'); s(3, y + 1, 'P'); return; }
    if (f < 2) { s(2, y, 'P'); s(3, y, 'P'); s(2, y - 1, 'Y'); return; }
    for (const [x, yy] of [[2, -1], [3, -1], [1, 0], [4, 0], [1, 1], [4, 1], [2, 2], [3, 2]]) s(x, y + yy, 'P');
    s(2, y, 'Y');
  }), { Y: '#e8ffb8', P: '#9be33c' });
  // poison: a drip swells under an edge, falls and is gone (4 x 12, 8 frames); twist: the same drop in blood off the barbs
  const DRIP = strip(8, 4, 12, (f, s) => {
    const L = [1, 2, 3, 4, 2, 1, 1, 0][f];
    for (let y = 0; y < L; y++) { s(1, y, 'P'); s(2, y, y === L - 1 && f < 4 ? 'P' : 'p'); }
    if (f === 3) { s(1, 4, 'P'); s(2, 4, 'p'); }
    if (f >= 4 && f <= 6) { const y = 4 + (f - 4) * 3; s(1, y, 'P'); s(2, y, 'p'); s(1, y + 1, 'p'); }
  });
  sp('drip', DRIP, { P: '#9be33c', p: '#58a31c' });
  sp('blood', DRIP, { P: '#e8344e', p: '#8a1426' });
  // mut: a cell swells, pinches in two and the halves drift apart (9 x 7, 8 frames; blobs [cx, cy, rx, ry], outlined)
  const CELLS = [[[4, 3, 1, 1]], [[4, 3, 1.6, 1.6]], [[4, 3, 2.3, 2.3]], [[4, 3, 3.2, 2.3]], [[2.6, 3, 2, 2], [5.4, 3, 2, 2]], [[2, 3, 1.8, 1.8], [6, 3, 1.8, 1.8]], [[1.5, 3, 1.2, 1.2], [6.5, 3, 1.2, 1.2]], []];
  sp('cell', strip(8, 9, 7, (f, s) => {
    const W = 9, H = 7, m = [], at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.push(CELLS[f].some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (at(x, y)) { const b = CELLS[f].find(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1), d = (x - b[0]) + (y - b[1]); s(x, y, d < -b[2] * 0.6 ? 'Y' : d > b[2] * 0.7 ? 'p' : 'P'); }
      else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) s(x, y, 'o');
    }
  }), { Y: '#ffe2c8', P: '#ff8a4a', p: '#b4501e' });
  // shadow: a smoke wisp curls up and thins out (6 x 14, 8 frames)
  sp('wisp', strip(8, 6, 14, (f, s) => {
    const n = f < 4 ? f + 2 : 9 - f;
    for (let i = 0; i < n; i++) { const y = 12 - f - i * 2, x = 2 + Math.round(Math.sin((f + i) * 1.1) * 1.4); s(x, y, i ? 'p' : 'q'); if (i % 2) s(x + 1, y, 'q'); }
  }), { p: '#a070ff', q: '#5a2fb0' });
  // asc: prismatic shimmer on the wing feathers (16 x 20, 6 frames; the feather colours cycle)
  const PRISM = ['#ff7a2a', '#ffe66b', '#9be33c', '#7fe3ff', '#a070ff', '#ff5fd2'];
  const WING = [
    '..........oooo..', '........ooGGGGo.', '......ooGGwGGgo.', '.....oGGG1111go.', '....oGG11122ggo.', '...oG1112233go..',
    '..oG11223344go..', '..oG1223344go...', '.oG12234455go...', '.oG1234455go....', '.oG234556go.....', 'oG1234566go.....',
    'oG23456go.......', 'oG3456go........', 'oG456go.........', '.oG56go.........', '.oG6go..........', '..oGo...........', '...o............', '................',
  ];
  sp('wing', Array.from({ length: 6 }, (_, f) => WING.map((r) => r.replace(/[1-6]/g, (c) => String.fromCharCode(65 + ((+c + f) % 6)) /* A..F */))),
    { G: '#ffe08a', g: '#b07a22', w: '#ffffff', A: PRISM[0], B: PRISM[1], C: PRISM[2], D: PRISM[3], E: PRISM[4], F: PRISM[5] });
  // purse: a glint on the clasp coin (5 x 5, 8 frames, mostly dark)
  sp('glint', strip(8, 5, 5, (f, s) => { if (f === 5 || f === 7) { s(2, 2, 'w'); s(1, 2, 'Y'); s(3, 2, 'Y'); s(2, 1, 'Y'); s(2, 3, 'Y'); } else if (f === 6) { for (let i = 0; i < 5; i++) { s(2, i, i === 2 ? 'w' : 'Y'); s(i, 2, i === 2 ? 'w' : 'Y'); } } }), { w: '#ffffff', Y: '#fff0a0' });
  // holy: the light sweep, a stepped diagonal band (8 x 8 tile, repeated down the card)
  sp('sweep', ['....AB..', '...ABA..', '..ABA...', '.ABA....', 'ABA.....', 'BA.....A', 'A.....AB', '.....ABA'], { A: 'rgba(255, 244, 205, 0.06)', B: 'rgba(255, 250, 230, 0.12)' });
  // crests (static sprites centred on the top edge)
  sp('arch', [ // holy: pointed gothic gable with a halo of rays behind (24 x 14)
    '..........YooY..........', '......Y...oYYo...Y......', '...Y.....oYwwYo.....Y...', '........oYwPPwYo........', '.......oYwPppPwYo.......', 'Y.....oYPppqqppPYo.....Y',
    '.....oYPpqo..oqpPYo.....', '....oYPpqo....oqpPYo....', '...oYPpqo......oqpPYo...', '..oYPpqo........oqpPYo..', '.oYPpqo..........oqpPYo.', 'oYPpqo............oqpPYo',
    'oPpqo..............oqpPo', 'oooo................oooo',
  ], { Y: '#fff7dc', w: '#ffffff', P: '#fff0c2', p: '#f2c454', q: '#8e6a22' });
  sp('eye', [ // shadow: eye sigil (14 x 8)
    '....oooooo....', '..ooPPPPPPoo..', '.oPpqqwwqqpPo.', 'oPpqwXXXXwqpPo', 'oPpqwXkkXwqpPo', '.oPpqqXXqqpPo.', '..ooPPPPPPoo..', '....oooooo....',
  ], { P: '#a070ff', p: '#6a3dc8', q: '#331966', w: '#e4d8ff', X: '#ff5fd2', k: '#0b0806' });
  sp('seal', [ // twist: the wax seal of the pact with its sigil ring (14 x 14)
    '.....oooo.....', '...ooPPPPoo...', '..oPPYYPPPPo..', '.oPYYPPPPPPpo.', '.oPYPPkkPPPpo.', 'oPPPPkPPkPPppo', 'oPPPkPPPPkPppo',
    'oPPPkPPPPkPppo', 'oPPPPkPPkPPppo', '.oPPPPkkPPppo.', '.oPPPPPPPpppo.', '..oPpPPpppqo..', '...oopppqoo...', '.....oooo.....',
  ], { Y: '#ff8f9e', P: '#e8344e', p: '#a81c32', q: '#5e0c1a', k: '#5e0c1a' });
  sp('knot', [ // purse: drawstring knot and a coin clasp (16 x 10)
    '...oo......oo...', '..oLLo....oLLo..', '..oLlLo..oLlLo..', '...olLLooLLlo...', '....oolYYloo....', '.....oYwYYYo....', '.....oYYYppo....', '.....oYYppqo....', '......opqqo.....', '.......ooo......',
  ], { L: '#a8754a', l: '#7a5232', Y: '#ffd36b', w: '#fff6c8', p: '#b8892c', q: '#5e4410' });
  // route: heraldic shield behind the class icon (20 x 24); tinted per class at bake time
  const SHIELD = [
    'oooooooooooooooooooo', 'oMMMMMMMMMMMMMMMMMMo', 'oMPPPPPPPPPPPPPPPPdo', 'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo',
    'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo',
    'oMPppppppppppppppqdo', 'oMPppppppppppppppqdo', '.oMPppppppppppppqdo.', '.oMPppppppppppppqdo.', '..oMPppppppppppqdo..', '..oMPPppppppppqqdo..',
    '...oMPPppppppqqdo...', '....oMMPppppqddo....', '.....ooMMPPqddoo....', '.......ooMMddoo.....', '.........oooo.......', '....................',
  ];
  const STREAMER = (f) => { // route: a streamer flying off the crest's side, its wave travelling outward (14 x 7, 4 frames; the left one is mirrored)
    const g = Array.from({ length: 7 }, () => Array(14).fill('.'));
    for (let x = 0; x < 14; x++) {
      const y = 2 + Math.round(Math.sin((x - f * 1.75) * Math.PI / 7) * (x < 3 ? 0.4 : 1.2));
      g[y - 1][x] = 'o'; g[y + 2][x] = 'o';
      g[y][x] = x === 13 ? 'o' : 'P'; g[y + 1][x] = x === 13 ? 'o' : 'p';
      if (x === 12) g[y][x] = 'o';
    }
    return g.map((r) => r.join(''));
  };
  const crestMade = {};
  CA.crest = (cls) => {
    const k = cls || 'knight';
    if (!crestMade[k]) {
      const cl = ED.CLASSES[k], t = tones(cl ? cl.col.c : '#d6aa55'), m = METAL.gold, p = { o: OL, M: m[0], d: m[2], P: t[1], p: t[2], q: t[3] };
      PU.frame('cfx-shield-' + k, { rows: SHIELD, pal: p });
      PU.frame('cfx-streamer-' + k, { rows: [0, 1, 2, 3].map(STREAMER), pal: { o: OL, P: t[1], p: t[2] } });
      crestMade[k] = 1;
    }
    return { shield: 'var(--fr-cfx-shield-' + k + ')', streamer: 'var(--fr-cfx-streamer-' + k + ')' };
  };
  // socket gem in the rarity colour, small (8 x 8) or big with gold prongs (12 x 12); baked per rarity
  const gemMade = {};
  CA.gem = (rar, big) => {
    const k = (rar || 'c') + (big ? '-big' : '');
    if (!gemMade[k]) {
      const c = (ED.RARITY[rar] || ED.RARITY.c).color, p = { o: OL, H: U.mix(c, '#ffffff', 0.6), E: c, L: U.shade(c, -0.4), w: '#ffffff', G: '#ffe08a', g: '#b07a22', k: '#0b0806' };
      PU.frame('cfx-gem-' + k, {
        rows: big ? ['....oooo....', '...oGGGGo...', '..oGoHHoGo..', '.oGoHwHEoGo.', 'oGoHHEEELoGo', 'oGoHEEELLoGo', 'oGoEEELLLogo', 'oGoEELLLkogo', '.ogoELLLkog.', '..ogoLkkogo.', '...oggggo...', '....oooo....']
          : ['..oooo..', '.oHHHEo.', 'oHwHEELo', 'oHHEEELo', 'oHEEELLo', 'oEELLLko', '.oLLLko.', '..oooo..'],
        pal: p,
      });
      gemMade[k] = 1;
    }
    return 'var(--fr-cfx-gem-' + k + ')';
  };
  // rank pip, empty / owned / offered (6 x 6, 3 frames side by side; background-position picks one)
  sp('pip', [['.oooo.', 'oddddo', 'odkkdo', 'odkkdo', 'oddddo', '.oooo.'], ['.oooo.', 'oGGGgo', 'oGwGgo', 'oGGggo', 'oggggo', '.oooo.'], ['.oooo.', 'oYYYPo', 'oYwYPo', 'oYYPPo', 'oPPPPo', '.oooo.']],
    { d: '#4b453d', k: '#0b0806', G: '#ffe08a', g: '#b07a22', w: '#ffffff', Y: '#fff2a8', P: '#ff8a3d' });

  // pick sprites
  sp('burn', ['.o...o..', 'oYo.oYo.', 'YPYoYPYo', 'PpPYPpPY', 'pqpPpqpP', 'qkqpqkqp'], { Y: '#fff2a8', P: '#ff7a2a', p: '#cf461a', q: '#6e200e', k: '#1a0a05' }); // fire: burning edge (8 x 6, repeat-x)
  sp('melt', ['qpPpqpPp', 'pPYPpPYP', 'oPpPoPpo', '.oPo.oPo', '.oPo..o.', '..o.....'], { Y: '#dcffa0', P: '#9be33c', p: '#58a31c', q: '#2a5a0f' }); // poison: melting edge (8 x 6, repeat-x)
  sp('shard', [['..o...', '.oIo..', 'oIPpo.', '.oPpo.', '..opo.', '...o..'], ['...oo.', '..oIPo', '.oIPpo', 'oIPpo.', 'opo...', '.o....'], ['oo....', 'oIoo..', '.oIPo.', '.oPPpo', '..oppo', '...oo.']], { I: '#f2fdff', P: '#9be9ff', p: '#38a2cf' }); // ice: 3 shard looks (6 x 6)
  sp('bolt', ['....oo..', '...oYo..', '...oYo..', '..oYPo..', '..oYo...', '.oYPo...', '.oYPPoo.', 'oYYYYPPo', '.ooPYYPo', '...oPYo.', '...oYo..', '..oYPo..', '..oYo...', '.oYPo...', '.oYo....', 'oYo.....'], { Y: '#ffffff', P: '#ffe66b' }); // lightning: bolt (8 x 16)
  sp('vortex', strip(4, 16, 16, (f, s) => { // shadow: a spiral turning (16 x 16, 4 frames)
    for (let i = 0; i < 46; i++) { const a = i * 0.36 + f * Math.PI / 2, r = 0.5 + i * 0.16, x = Math.round(7.5 + Math.cos(a) * r), y = Math.round(7.5 + Math.sin(a) * r); s(x, y, i < 12 ? 'w' : i < 28 ? 'P' : 'p'); }
  }), { w: '#e4d8ff', P: '#a070ff', p: '#5a2fb0' });
  sp('anvil', [ // general: anvil (20 x 12)
    'oooooooooooooooooo..', 'oMMMMMMMMMMMMMMMMMoo', 'oMwwmmmmmmmmmmmmmdmo', '.oommmmmmmmmmmmmddo.', '...oooommmmmmddoo...', '......ommmmmddo.....',
    '......ommmmmddo.....', '.....ommmmmmmddo....', '....oMmmmmmmmmddo...', '...oMmmmmmmmmmmddo..', '...oooooooooooooooo.', '....................',
  ], { M: '#e8eef6', w: '#ffffff', m: '#8f99a8', d: '#48505e' });
  sp('coin', strip(4, 6, 6, (f, s) => { const w = [3, 2, 1, 2][f]; for (let y = 1; y < 5; y++) for (let x = 3 - w; x < 3 + w; x++) s(x, y, x === 3 - w || x === 2 + w ? 'q' : y === 1 ? 'Y' : 'P'); for (let x = 3 - w; x < 3 + w; x++) { s(x, 0, 'o'); s(x, 5, 'o'); } }), { Y: '#fff6c8', P: '#ffd36b', q: '#b8892c' }); // purse: a coin spinning (6 x 6, 4 frames)

  // ---------------------------------------------------------------- icons
  // Data URL of icon `name` in `color` at its native 16 x 16 art px (show it at whole multiples of 16 device px, pixelated). Cached.
  const icons = {};
  CA.icon = (name, color) => {
    const key = name + '|' + color;
    if (icons[key]) return icons[key];
    const n = ED.Icons.N, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    c.drawImage(ED.Icons.canvas(name, color, n), 0, 0);
    return (icons[key] = cv.toDataURL());
  };
})(globalThis.ED || (globalThis.ED = {}));
