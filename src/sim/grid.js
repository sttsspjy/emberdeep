// Foe spatial grid + separation, mixed into ED.World.prototype by world.js (ED.Grid).
// Uniform 32 px grid over the arena (counting sort of w.foes indices). Foes with r > BIG sit in a list every query returns; foes appended after a build (index >= g.n) are returned too.
// Queries return live foes (not dead) whose cell overlaps the circle grown by PAD (drift since the build); callers keep their own exact test. The grid is rebuilt after foe movement and after
// separation each tick, and lazily by any query once compaction invalidated it.
(function (ED) {
  'use strict';
  const CELL = 32, INV = 1 / CELL, BIG = 24, PAD = 24;
  const G = ED.Grid = { CELL, BIG, PAD };

  const fit = (g, n) => {
    if (g.cap >= n) return;
    const cap = Math.max(256, 1 << (32 - Math.clz32(n + 63)));
    g.items = new Int32Array(cap); g.cell = new Int32Array(cap); g.cap = cap;
  };

  // Rebuilds the grid from the live positions of w.foes.
  G.foeGrid = function () {
    const es = this.foes, n = es.length, size = this.arena.size;
    let g = this.fg;
    if (!g) {
      const cw = Math.ceil(size / CELL), nc = cw * cw;
      g = this.fg = { cw, nc, start: new Int32Array(nc + 1), cur: new Int32Array(nc), cap: 0, items: null, cell: null, big: [], pool: [], qd: 0, n: 0, valid: false };
    }
    fit(g, n);
    const cw = g.cw, nc = g.nc, start = g.start, cur = g.cur, cell = g.cell, items = g.items, big = g.big;
    big.length = 0; start.fill(0);
    for (let i = 0; i < n; i++) {
      const e = es[i];
      if (e.dead) { cell[i] = -1; continue; }
      if (e.r > BIG) { cell[i] = -1; big.push(i); continue; }
      let cx = (e.x * INV) | 0, cy = (e.y * INV) | 0;
      if (cx < 0) cx = 0; else if (cx >= cw) cx = cw - 1;
      if (cy < 0) cy = 0; else if (cy >= cw) cy = cw - 1;
      const c = cy * cw + cx; cell[i] = c; start[c + 1]++;
    }
    for (let c = 0; c < nc; c++) { start[c + 1] += start[c]; cur[c] = start[c]; }
    for (let i = 0; i < n; i++) { const c = cell[i]; if (c >= 0) items[cur[c]++] = i; }
    g.n = n; g.valid = true;
    return g;
  };
  G.gridOk = function () { const g = this.fg; return g && g.valid ? g : this.foeGrid(); };

  // Fills the caller-owned array out with the live foes near the circle (x, y, r) (a superset: exact tests are the caller's). out.n = foe count at the query (see foeTail).
  G.foesNear = function (x, y, r, out) {
    const g = this.gridOk(), es = this.foes, n = es.length, cw = g.cw, R = r + PAD;
    let c = 0;
    let x0 = Math.floor((x - R) * INV), x1 = Math.floor((x + R) * INV), y0 = Math.floor((y - R) * INV), y1 = Math.floor((y + R) * INV);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= cw) x1 = cw - 1; if (y1 >= cw) y1 = cw - 1;
    if (x0 <= x1 && y0 <= y1) {
      const start = g.start, items = g.items;
      for (let cy = y0; cy <= y1; cy++) {
        for (let k = start[cy * cw + x0], ke = start[cy * cw + x1 + 1]; k < ke; k++) { const e = es[items[k]]; if (!e.dead) out[c++] = e; }
      }
    }
    const big = g.big;
    for (let k = 0; k < big.length; k++) { const e = es[big[k]]; if (e && !e.dead) out[c++] = e; }
    for (let i = g.n; i < n; i++) { const e = es[i]; if (!e.dead) out[c++] = e; }
    out.length = c; out.n = n;
    return out;
  };
  // foesNear into a pooled array; every foeScan pairs with one foeEnd after its loop (scans nest through hits and kills).
  G.foeScan = function (x, y, r) { const g = this.gridOk(), d = g.qd++; return this.foesNear(x, y, r, g.pool[d] || (g.pool[d] = [])); };
  G.foeEnd = function () { this.fg.qd--; };
  // Appends the foes spawned since `out` was filled; true when it added any (loop: `k < out.length || w.foeTail(out)`).
  G.foeTail = function (out) {
    const es = this.foes, m = es.length;
    let k = out.n, added = false;
    if (k >= m) return false;
    out.n = m;
    for (; k < m; k++) if (!es[k].dead) { out.push(es[k]); added = true; }
    return added;
  };
  // Nearest live foe to (x, y) within maxD (centre distance), skipping foes for which skip(e) is true; null when none. Searches outward (96 px, doubling).
  G.nearestFoe = function (x, y, maxD, skip) {
    let r = Math.min(maxD, 96);
    for (;;) {
      const q = this.foeScan(x, y, r);
      let best = null, bd = r * r;
      for (let k = 0; k < q.length; k++) {
        const e = q[k]; if (skip && skip(e)) continue;
        const dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = e; }
      }
      this.foeEnd();
      if (best || r >= maxD) return best;
      r = Math.min(maxD, r * 2);
    }
  };

  // Pushes overlapping pair a, b apart to 0.9 (ra + rb); bosses and still foes (spd 0) do not move. Returns whether it pushed.
  const sepPair = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.9, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return false;
    const am = a.spd > 0 && !a.boss, bm = b.spd > 0 && !b.boss;
    if (!am && !bm) return false;
    let d = Math.sqrt(d2), ux, uy;
    if (d < 1e-3) { ux = (a.id & 1) ? 1 : -1; uy = 0; d = 0; } else { ux = dx / d; uy = dy / d; }
    const push = rr - d, wa = am && bm ? 0.5 : am ? 1 : 0, wb = 1 - wa;
    a.x -= ux * push * wa; a.y -= uy * push * wa;
    b.x += ux * push * wb; b.y += uy * push * wb;
    return true;
  };

  // Separation pass: every live foe against the foes of its 3x3 build cells with a higher index (deterministic pair order), big foes against a scan,
  // foes pushed off living heroes (heroes do not move), then every foe resolved against the obstacles and bounds.
  G.separate = function () {
    const es = this.foes, n = es.length, g = this.foeGrid(), cw = g.cw, start = g.start, items = g.items, cell = g.cell, Ar = ED.Arena, A = this.arena;
    for (let i = 0; i < n; i++) {
      const c = cell[i]; if (c < 0) continue;
      const a = es[i], cx = c % cw, cy = (c / cw) | 0;
      const x0 = cx > 0 ? cx - 1 : 0, x1 = cx < cw - 1 ? cx + 1 : cx, y0 = cy > 0 ? cy - 1 : 0, y1 = cy < cw - 1 ? cy + 1 : cy;
      for (let yy = y0; yy <= y1; yy++) {
        for (let k = start[yy * cw + x0], ke = start[yy * cw + x1 + 1]; k < ke; k++) { const j = items[k]; if (j > i) sepPair(a, es[j]); }
      }
    }
    const big = g.big;
    for (let k = 0; k < big.length; k++) {
      const a = es[big[k]], q = this.foeScan(a.x, a.y, a.r + BIG);
      for (let m = 0; m < q.length; m++) if (q[m] !== a) sepPair(a, q[m]);
      this.foeEnd();
    }
    for (const p of this.heroes) {
      if (p.dead || p.downed) continue;
      const q = this.foeScan(p.x, p.y, p.r + BIG);
      for (let m = 0; m < q.length; m++) {
        const e = q[m]; if (e.boss || !(e.spd > 0)) continue;
        const dx = e.x - p.x, dy = e.y - p.y, rr = (e.r + p.r) * 0.85, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-3; e.x = p.x + dx / d * rr; e.y = p.y + dy / d * rr;
      }
      this.foeEnd();
    }
    for (let i = 0; i < n; i++) { const e = es[i]; if (!e.dead && e.spd > 0) Ar.collide(A, e, e.r); }
    g.valid = false;
  };
})(globalThis.ED || (globalThis.ED = {}));
