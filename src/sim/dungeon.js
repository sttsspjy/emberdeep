// Deterministic floor generation. Host and clients generate identical floors from (stratum, seed),
// so only the seed crosses the network.
// Tile codes: 0 floor, 1 wall, 2 block (pillar/rock), 3 chasm (blocks walking, not shots), 4 hazard (walkable), 5 door.
(function (ED) {
  'use strict';
  const U = ED.U;
  const T = ED.CONST.TILE;
  const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
  const D = ED.Dungeon = { DIRS, OPP };

  const COMBAT_SIZES = [[17, 13], [19, 13], [21, 13], [21, 15], [23, 15], [19, 15], [25, 15]];
  const SIZE = { start: [15, 11], treasure: [13, 11], shop: [17, 13], event: [15, 11], boss: [27, 19] };
  const COMBAT_COUNT = [3, 3, 2, 2, 2, 1]; // kept short so a full descent fits the 20-minute lantern with room to spare
  const EVENTS = ['fountain', 'altar', 'gamble', 'trial'];

  D.isSolid = (t, locked) => t === 1 || t === 2 || (t === 5 && locked);
  D.blocksShots = (t, locked) => t === 1 || t === 2 || (t === 5 && locked);
  D.walkable = (t) => t === 0 || t === 4 || t === 5;

  D.generate = (stratum, seed) => {
    const rng = U.RNG(seed ^ (stratum * 7919));
    const nCombat = COMBAT_COUNT[stratum - 1] || 3;
    const specials = ['treasure', 'event'];
    if (stratum >= 2) specials.push('shop');
    const total = 1 + nCombat + specials.length + 1;
    let cells = null;
    for (let attempt = 0; attempt < 50 && !cells; attempt++) cells = grow(rng, total);
    const list = Object.values(cells);
    // distances from start
    const key = (x, y) => x + ',' + y;
    const dist = {}; const q = [list[0]]; dist[key(0, 0)] = 0;
    while (q.length) {
      const c = q.shift();
      for (const d in DIRS) {
        const nk = key(c.gx + DIRS[d][0], c.gy + DIRS[d][1]);
        if (cells[nk] && dist[nk] === undefined) { dist[nk] = dist[key(c.gx, c.gy)] + 1; q.push(cells[nk]); }
      }
    }
    const neighbors = (c) => Object.keys(DIRS).filter(d => cells[key(c.gx + DIRS[d][0], c.gy + DIRS[d][1])]).length;
    const others = list.slice(1);
    const deadEnds = others.filter(c => neighbors(c) === 1).sort((a, b) => dist[key(b.gx, b.gy)] - dist[key(a.gx, a.gy)] || rng.next() - 0.5);
    const boss = deadEnds.length ? deadEnds[0] : others.sort((a, b) => dist[key(b.gx, b.gy)] - dist[key(a.gx, a.gy)])[0];
    boss.type = 'boss';
    list[0].type = 'start';
    const pool = deadEnds.filter(c => c !== boss).concat(rng.shuffle(others.filter(c => c !== boss && neighbors(c) !== 1)));
    for (const sp of specials) { const c = pool.find(x => !x.type); if (c) c.type = sp; }
    for (const c of list) if (!c.type) c.type = 'combat';
    // boss room must not hang off a special room directly behind the start: fine either way, but keep start safe.
    const rooms = [];
    list.forEach((c, i) => { c.id = i; });
    for (const c of list) {
      const room = buildRoom(c, stratum, rng.seed(), rng);
      for (const d in DIRS) {
        const n = cells[key(c.gx + DIRS[d][0], c.gy + DIRS[d][1])];
        room.doors[d] = n ? n.id : -1;
      }
      rooms.push(room);
    }
    for (const r of rooms) carveDoors(r);
    for (const r of rooms) { finalizeInterior(r, stratum); decorate(r, stratum); }
    return { stratum, seed, rooms, start: 0, boss: boss.id };
  };

  function grow(rng, total) {
    const cells = {};
    const key = (x, y) => x + ',' + y;
    cells[key(0, 0)] = { gx: 0, gy: 0 };
    let list = [cells[key(0, 0)]];
    let guard = 0;
    while (list.length < total && guard++ < 2000) {
      const base = rng.pick(list);
      const d = rng.pick(Object.keys(DIRS));
      const nx = base.gx + DIRS[d][0], ny = base.gy + DIRS[d][1];
      if (Math.abs(nx) > 3 || Math.abs(ny) > 3 || cells[key(nx, ny)]) continue;
      let occ = 0;
      for (const dd in DIRS) if (cells[key(nx + DIRS[dd][0], ny + DIRS[dd][1])]) occ++;
      if (occ !== 1) continue;
      // keep the start room from becoming a hub with four branches
      if (base === list[0] && list.length > 1 && rng.chance(0.5)) continue;
      const c = { gx: nx, gy: ny };
      cells[key(nx, ny)] = c; list.push(c);
    }
    return list.length >= total ? cells : null;
  }

  function buildRoom(c, stratum, seed, rng) {
    const size = c.type === 'combat' ? rng.pick(COMBAT_SIZES) : SIZE[c.type];
    const w = size[0], h = size[1];
    const tiles = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      tiles[y * w + x] = (x === 0 || x === w - 1 || y <= 1 || y === h - 1) ? 1 : 0;
    }
    return {
      id: c.id, gx: c.gx, gy: c.gy, type: c.type, w, h, tiles, seed, stratum,
      doors: { n: -1, s: -1, e: -1, w: -1 },
      decor: [], torches: [],
      event: c.type === 'event' ? EVENTS[seed % EVENTS.length] : null,
      pattern: 'open',
    };
  }

  D.doorRect = (room, d) => {
    const cx = Math.floor(room.w / 2), cy = Math.floor(room.h / 2) + 1;
    if (d === 'n') return { x0: cx - 1, x1: cx + 1, y0: 0, y1: 1 };
    if (d === 's') return { x0: cx - 1, x1: cx + 1, y0: room.h - 1, y1: room.h - 1 };
    if (d === 'w') return { x0: 0, x1: 0, y0: cy - 1, y1: cy + 1 };
    return { x0: room.w - 1, x1: room.w - 1, y0: cy - 1, y1: cy + 1 };
  };

  function carveDoors(room) {
    for (const d in DIRS) {
      if (room.doors[d] < 0) continue;
      const r = D.doorRect(room, d);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) room.tiles[y * room.w + x] = 5;
    }
  }

  // Spawn point just inside a door, in world units.
  D.entryPoint = (room, d, k) => {
    const r = D.doorRect(room, d);
    const cx = (r.x0 + r.x1 + 1) / 2 * T, cy = (r.y0 + r.y1 + 1) / 2 * T;
    const off = (k || 0) * 18 - 18;
    if (d === 'n') return { x: cx + off, y: 3.2 * T };
    if (d === 's') return { x: cx + off, y: (room.h - 2.2) * T };
    if (d === 'w') return { x: 2.0 * T, y: cy + off };
    return { x: (room.w - 2.0) * T, y: cy + off };
  };
  D.center = (room) => ({ x: room.w * T / 2, y: (room.h / 2 + 0.5) * T });

  // ---------------- interior layout ----------------
  const PATTERNS = ['open', 'pillars4', 'grid', 'center', 'chasm', 'pools', 'cross', 'scatter', 'pools', 'pillars4'];

  function finalizeInterior(room, stratum) {
    const rng = U.RNG(room.seed);
    if (room.type === 'combat') room.pattern = rng.pick(PATTERNS);
    else if (room.type === 'boss') room.pattern = rng.pick(['bossPillars', 'open', 'bossPools']);
    else room.pattern = 'open';
    const backup = room.tiles.slice();
    applyPattern(room, room.pattern, rng);
    if (!connected(room)) { room.tiles = backup; room.pattern = 'open'; }
  }

  function inDoorLane(room, x, y) {
    // keep a 2-tile apron in front of every door and a cross through the centre line clear
    const cx = Math.floor(room.w / 2), cy = Math.floor(room.h / 2) + 1;
    if (Math.abs(x - cx) <= 2 && (y <= 4 || y >= room.h - 4)) return true;
    if (Math.abs(y - cy) <= 2 && (x <= 3 || x >= room.w - 4)) return true;
    return false;
  }

  function setT(room, x, y, v) {
    if (x < 1 || y < 2 || x > room.w - 2 || y > room.h - 2) return;
    if (inDoorLane(room, x, y)) return;
    room.tiles[y * room.w + x] = v;
  }

  function sym(room, x, y, v) {
    // mirror across both axes of the interior so rooms look designed
    const mx = room.w - 1 - x, my = room.h - y;
    setT(room, x, y, v); setT(room, mx, y, v); setT(room, x, my, v); setT(room, mx, my, v);
  }

  function applyPattern(room, p, rng) {
    const w = room.w, h = room.h;
    const hazard = 4;
    if (p === 'pillars4') {
      const px = Math.floor(w / 4), py = Math.floor((h + 2) / 4) + 1;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sym(room, px + dx, py + dy, 2);
    } else if (p === 'grid') {
      for (let y = 4; y < h - 3; y += 3) for (let x = 4; x < w - 3; x += 4) setT(room, x, y, 2);
    } else if (p === 'center') {
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2) + 1;
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) room.tiles[y * w + x] = 2;
    } else if (p === 'chasm') {
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2) + 1;
      const rx = Math.max(2, Math.floor(w / 6)), ry = Math.max(1, Math.floor(h / 6));
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) room.tiles[y * w + x] = 3;
    } else if (p === 'pools' || p === 'bossPools') {
      const n = p === 'bossPools' ? 4 : rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const px = rng.int(3, Math.floor(w / 2) - 2), py = rng.int(4, Math.floor(h / 2));
        const rw = rng.int(1, 2), rh = rng.int(1, 2);
        for (let y = py - rh; y <= py + rh; y++) for (let x = px - rw; x <= px + rw; x++) {
          if ((x - px) * (x - px) / ((rw + 0.5) * (rw + 0.5)) + (y - py) * (y - py) / ((rh + 0.5) * (rh + 0.5)) <= 1.05) sym(room, x, y, hazard);
        }
      }
    } else if (p === 'cross') {
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2) + 1;
      for (let x = cx - 4; x <= cx + 4; x++) if (Math.abs(x - cx) > 1) room.tiles[cy * w + x] = 2;
      for (let y = cy - 3; y <= cy + 3; y++) if (Math.abs(y - cy) > 1) room.tiles[y * w + cx] = 2;
    } else if (p === 'scatter') {
      const n = rng.int(4, 6);
      for (let i = 0; i < n; i++) sym(room, rng.int(2, Math.floor(w / 2) - 1), rng.int(3, Math.floor(h / 2)), 2);
    } else if (p === 'bossPillars') {
      for (const [x, y] of [[5, 5], [w - 6, 5], [5, h - 4], [w - 6, h - 4]]) {
        room.tiles[y * w + x] = 2; room.tiles[y * w + x + 1] = 2; room.tiles[(y + 1) * w + x] = 2; room.tiles[(y + 1) * w + x + 1] = 2;
      }
    }
  }

  function connected(room) {
    const w = room.w, h = room.h, t = room.tiles;
    const seen = new Uint8Array(w * h);
    const c = D.center(room);
    let sx = Math.floor(c.x / T), sy = Math.floor(c.y / T);
    // find any walkable start near centre
    if (!D.walkable(t[sy * w + sx])) {
      let found = false;
      for (let y = 2; y < h - 1 && !found; y++) for (let x = 1; x < w - 1 && !found; x++) if (D.walkable(t[y * w + x])) { sx = x; sy = y; found = true; }
    }
    const q = [sy * w + sx]; seen[sy * w + sx] = 1;
    while (q.length) {
      const i = q.pop(); const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && D.walkable(t[j])) { seen[j] = 1; q.push(j); }
      }
    }
    // every door must be reachable
    for (let i = 0; i < t.length; i++) if (t[i] === 5 && !seen[i]) return false;
    // seal unreachable pockets so nothing spawns inside them
    for (let i = 0; i < t.length; i++) if ((t[i] === 0 || t[i] === 4) && !seen[i]) t[i] = 2;
    return true;
  }

  // ---------------- decoration (cosmetic, deterministic) ----------------
  function decorate(room, stratum) {
    const rng = U.RNG(room.seed ^ 0xdec0);
    const biome = ED.biomeFor(stratum);
    const n = Math.floor(room.w * room.h / 22);
    for (let i = 0; i < n; i++) {
      const x = rng.int(1, room.w - 2), y = rng.int(2, room.h - 2);
      if (room.tiles[y * room.w + x] !== 0) continue;
      room.decor.push({ k: rng.pick(biome.decor), x: x + rng.range(0.15, 0.85), y: y + rng.range(0.2, 0.85), v: rng.next(), s: rng.range(0.7, 1.2) });
    }
    // torches along the top wall face, avoiding the door
    const cx = Math.floor(room.w / 2);
    for (let x = 3; x < room.w - 2; x += rng.int(4, 6)) {
      if (room.doors.n >= 0 && Math.abs(x - cx) <= 2) continue;
      room.torches.push({ x: x + 0.5, y: 1.35 });
    }
  }

  D.tileAt = (room, wx, wy) => {
    const x = Math.floor(wx / T), y = Math.floor(wy / T);
    if (x < 0 || y < 0 || x >= room.w || y >= room.h) return 1;
    return room.tiles[y * room.w + x];
  };

  // Random walkable floor point at least minDist from all given points.
  D.randomFloor = (room, rng, avoid, minDist) => {
    for (let k = 0; k < 80; k++) {
      const x = rng.int(2, room.w - 3), y = rng.int(3, room.h - 3);
      if (room.tiles[y * room.w + x] !== 0) continue;
      const wx = (x + 0.5) * T, wy = (y + 0.5) * T;
      let ok = true;
      if (avoid) for (const a of avoid) if (U.dist2(wx, wy, a.x, a.y) < minDist * minDist) { ok = false; break; }
      if (ok) return { x: wx, y: wy };
    }
    const c = D.center(room);
    return { x: c.x + rng.range(-40, 40), y: c.y + rng.range(-30, 30) };
  };
})(globalThis.ED || (globalThis.ED = {}));
