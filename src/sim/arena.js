// Open arena: deterministic props from (stage, seed) and circle collision against the bounds and the obstacles. Pure; clients rebuild the same arena from the seed.
// ED.Arena.generate(stage, seed) -> A = { size, obstacles: [{id, x, y, r, look}], braziers: [{id, x, y, r, hp, broken, look}], deco: [{x, y, look}], cell, cw, cells: [[obstacle index]] }.
// Obstacles come in clusters of 1-4 circles (gaps 18-60 px) so the field has chokepoints; nothing within arena.clear of the centre (the party start).
(function (ED) {
  'use strict';
  const U = ED.U;
  const Ar = ED.Arena = {};
  const CELL = 128, PAD = 40; // bucket size; obstacles are bucketed with this margin so any body up to PAD radius finds them from its own cell

  Ar.generate = (stage, seed) => {
    const sd = ED.STAGES[stage] || ED.STAGES[0], th = sd.theme, ar = sd.arena, size = ar.size || ED.CONST.ARENA;
    const rng = U.RNG((seed ^ 0xa7e4a11) >>> 0), c = size / 2;
    const A = { size, obstacles: [], braziers: [], deco: [], cell: CELL, cw: Math.ceil(size / CELL), cells: null };
    const free = (x, y, r, gap) => {
      if (x < r + 60 || y < r + 60 || x > size - r - 60 || y > size - r - 60) return false;
      if (Math.hypot(x - c, y - c) < ar.clear + r) return false;
      for (const o of A.obstacles) if (Math.hypot(o.x - x, o.y - y) < o.r + r + gap) return false;
      return true;
    };
    const nObs = rng.int(ar.obstacles[0], ar.obstacles[1]);
    let guard = 0;
    while (A.obstacles.length < nObs && guard++ < 600) {
      let x = rng.range(80, size - 80), y = rng.range(80, size - 80);
      const members = Math.min(nObs - A.obstacles.length, rng.int(1, 4));
      for (let m = 0; m < members; m++) {
        const kind = th.obstacles[rng.int(0, th.obstacles.length - 1)], r = Math.round(rng.range(kind.r[0], kind.r[1]));
        if (m > 0) { const prev = A.obstacles[A.obstacles.length - 1], a = rng.next() * U.TAU, d = prev.r + r + rng.range(18, 60); x = prev.x + Math.cos(a) * d; y = prev.y + Math.sin(a) * d; }
        if (!free(x, y, r, m > 0 ? 16 : 120)) { if (m === 0) break; continue; }
        A.obstacles.push({ id: A.obstacles.length, x: Math.round(x), y: Math.round(y), r, look: kind.look });
      }
    }
    const nBr = rng.int(ar.braziers[0], ar.braziers[1]);
    guard = 0;
    while (A.braziers.length < nBr && guard++ < 400) {
      const x = rng.range(120, size - 120), y = rng.range(120, size - 120);
      if (!free(x, y, 10, 30)) continue;
      if (A.braziers.some(b => Math.hypot(b.x - x, b.y - y) < 320)) continue;
      A.braziers.push({ id: A.braziers.length, x: Math.round(x), y: Math.round(y), r: 8, hp: 1, broken: false, look: th.brazier });
    }
    const nDeco = Math.round(size * size / 26000);
    for (let i = 0; i < nDeco; i++) A.deco.push({ x: Math.round(rng.range(16, size - 16)), y: Math.round(rng.range(16, size - 16)), look: th.deco[rng.int(0, th.deco.length - 1)] });
    // obstacle buckets
    const cw = A.cw; A.cells = new Array(cw * cw);
    for (let i = 0; i < A.cells.length; i++) A.cells[i] = null;
    A.obstacles.forEach((o, i) => {
      const x0 = U.clamp(Math.floor((o.x - o.r - PAD) / CELL), 0, cw - 1), x1 = U.clamp(Math.floor((o.x + o.r + PAD) / CELL), 0, cw - 1);
      const y0 = U.clamp(Math.floor((o.y - o.r - PAD) / CELL), 0, cw - 1), y1 = U.clamp(Math.floor((o.y + o.r + PAD) / CELL), 0, cw - 1);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const k = cy * cw + cx; (A.cells[k] || (A.cells[k] = [])).push(i); }
    });
    return A;
  };

  // Obstacle indices whose bucket covers (x, y), or null.
  Ar.near = (A, x, y) => {
    const cw = A.cw; let cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    if (cx < 0) cx = 0; else if (cx >= cw) cx = cw - 1;
    if (cy < 0) cy = 0; else if (cy >= cw) cy = cw - 1;
    return A.cells[cy * cw + cx];
  };

  // Pushes circle e (x, y) of radius r out of the obstacles and inside the bounds. Returns the obstacle it touched (or the bound as true), else null.
  // A body heading straight into an obstacle slides along it: the push-out leaves the tangential part of its motion.
  Ar.collide = (A, e, r) => {
    let hit = null;
    const list = Ar.near(A, e.x, e.y);
    if (list) for (let k = 0; k < list.length; k++) {
      const o = A.obstacles[list[k]], dx = e.x - o.x, dy = e.y - o.y, m = o.r + r, d2 = dx * dx + dy * dy;
      if (d2 >= m * m) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-3) { e.x = o.x + m; continue; }
      e.x = o.x + dx / d * m; e.y = o.y + dy / d * m; hit = o;
    }
    const s = A.size;
    if (e.x < r) { e.x = r; hit = hit || true; } else if (e.x > s - r) { e.x = s - r; hit = hit || true; }
    if (e.y < r) { e.y = r; hit = hit || true; } else if (e.y > s - r) { e.y = s - r; hit = hit || true; }
    return hit;
  };

  // Moves e by (dx, dy) then collides. A body pressed straight into an obstacle gets a sideways nudge (side by e.id parity) so crowds flow around pillars.
  Ar.move = (A, e, dx, dy, r) => {
    e.x += dx; e.y += dy;
    const o = Ar.collide(A, e, r);
    if (o && o !== true) {
      const nx = e.x - o.x, ny = e.y - o.y, d = Math.hypot(nx, ny) || 1, along = (dx * nx + dy * ny) / d;
      if (along < 0) { const s = (e.id & 1) ? 1 : -1, l = Math.hypot(dx, dy) * 0.6; e.x += -ny / d * s * l; e.y += nx / d * s * l; Ar.collide(A, e, r); }
    }
    return o;
  };

  // True when a circle at (x, y) of radius r overlaps an obstacle or leaves the arena.
  Ar.blocked = (A, x, y, r) => {
    if (x < r || y < r || x > A.size - r || y > A.size - r) return true;
    const list = Ar.near(A, x, y);
    if (list) for (let k = 0; k < list.length; k++) { const o = A.obstacles[list[k]]; if (U.dist2(x, y, o.x, o.y) < (o.r + r) * (o.r + r)) return true; }
    return false;
  };

  // True when the segment (x0, y0)-(x1, y1) passes through an obstacle (radius pad added); checks the buckets along the segment.
  Ar.segBlocked = (A, x0, y0, x1, y1, pad) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / CELL)), seen = Ar._seen || (Ar._seen = new Set());
    seen.clear();
    for (let i = 0; i <= n; i++) {
      const list = Ar.near(A, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
      if (list) for (const k of list) { if (seen.has(k)) continue; seen.add(k); const o = A.obstacles[k]; if (U.segDist2(o.x, o.y, x0, y0, x1, y1) < (o.r + (pad || 0)) ** 2) return true; }
    }
    return false;
  };
})(globalThis.ED || (globalThis.ED = {}));
