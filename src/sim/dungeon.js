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

  const COMBAT_SIZES = [[33, 17], [35, 17], [31, 19], [37, 17], [29, 19], [39, 15], [33, 19]];
  const SIZE = { start: [15, 11], treasure: [13, 11], shop: [17, 13], event: [15, 11], rest: [15, 11], boss: [31, 19] };
  const COMBAT_COUNT = [4, 4, 4, 4, 4, 4]; // normal combat rooms per stratum
  const ELITE_COUNT = [1, 1, 1, 1, 2, 2]; // elite combat rooms per stratum
  const DARK_COUNT = 2; // normal combat rooms per floor flagged `dark` (part of COMBAT_COUNT)
  const PATTERN_AREA = 294; // tile area the base pool and scatter counts are written for: both scale by room area / PATTERN_AREA
  const EVENTS = ['fountain', 'altar', 'gamble', 'trial'];
  const REWARD_ODDS = [['boon', 38], ['gold', 42], ['vigor', 12], ['forge', 8]]; // normal combat reward weights
  const BOUND = 4; // grid cells span -BOUND..BOUND on both axes
  const MIN_BOSS_DIST = 4;
  const ATTEMPTS = 120;

  D.isSolid = (t, locked) => t === 1 || t === 2 || (t === 5 && locked);
  D.blocksShots = (t, locked) => t === 1 || t === 2 || (t === 5 && locked);
  D.walkable = (t) => t === 0 || t === 4 || t === 5;

  const key = (x, y) => x + ',' + y;
  const neighborCount = (cells, c) => Object.keys(DIRS).filter(d => cells[key(c.gx + DIRS[d][0], c.gy + DIRS[d][1])]).length;

  // Floor layout: a tree of `total` cells from (0,0) whose boss is a dead end at BFS distance >= MIN_BOSS_DIST.
  // Late attempts force a spine of that depth first, which always satisfies it (the deepest node of a tree is a dead end).
  function layout(rng, total) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const cells = grow(rng, total, attempt >= ATTEMPTS / 2 ? MIN_BOSS_DIST : 0);
      const lay = cells && analyse(rng, cells);
      if (lay) return lay;
    }
    return analyse(null, combCells(total));
  }

  // BFS distance from the start for every cell; boss = farthest qualifying dead end (ties broken by rng).
  // A tree needs DARK_COUNT dead ends besides the boss and the start (the dark rooms), else it is rejected.
  function analyse(rng, cells) {
    const list = Object.values(cells);
    const dist = {};
    const q = [list[0]]; dist[key(0, 0)] = 0;
    while (q.length) {
      const c = q.shift();
      for (const d in DIRS) {
        const nk = key(c.gx + DIRS[d][0], c.gy + DIRS[d][1]);
        if (cells[nk] && dist[nk] === undefined) { dist[nk] = dist[key(c.gx, c.gy)] + 1; q.push(cells[nk]); }
      }
    }
    for (const c of list) c.dist = dist[key(c.gx, c.gy)];
    let ends = list.slice(1).filter(c => neighborCount(cells, c) === 1 && c.dist >= MIN_BOSS_DIST);
    if (!ends.length || list.slice(1).filter(c => neighborCount(cells, c) === 1).length < DARK_COUNT + 1) return null;
    if (rng) ends = rng.shuffle(ends);
    ends.sort((a, b) => b.dist - a.dist);
    return { cells, list, boss: ends[0] };
  }

  // Deterministic last resort: a spine along +x with teeth above and below (still a tree, inside the bounds).
  function combCells(total) {
    const cells = {};
    const add = (x, y) => { if (Object.keys(cells).length < total) cells[key(x, y)] = { gx: x, gy: y }; };
    for (let x = 0; x <= BOUND; x++) add(x, 0);
    for (const y of [1, -1, 2, -2]) for (const x of [1, 3]) add(x, y);
    add(-1, 0);
    return cells;
  }

  D.generate = (stratum, seed) => {
    const rng = U.RNG(seed ^ (stratum * 7919));
    const nCombat = COMBAT_COUNT[stratum - 1] || 5, nElite = ELITE_COUNT[stratum - 1] || 1;
    const specials = [stratum % 2 ? 'treasure' : 'event', 'shop', 'rest']; // treasure on odd strata, event on even ones
    const total = 2 + specials.length + nCombat + nElite;
    const { cells, list, boss } = layout(rng, total);
    boss.type = 'boss';
    list[0].type = 'start';
    const isLeaf = (c) => neighborCount(cells, c) === 1;
    // dark rooms are normal combat rooms on dead ends other than the boss and the start (off the start->boss path, skipping one cuts off nothing), farther first, ties by their own RNG stream
    const darkRng = U.RNG((seed ^ 0x2545f491) + stratum * 7907);
    for (const c of darkRng.shuffle(list.slice(1).filter(c => c !== boss && isLeaf(c))).sort((a, b) => b.dist - a.dist).slice(0, DARK_COUNT)) { c.type = 'combat'; c.dark = true; }
    const others = list.slice(1).filter(c => c !== boss && !c.dark);
    // utility rooms prefer the remaining dead ends, elite rooms prefer distance >= 3
    const pool = rng.shuffle(others.filter(isLeaf)).concat(rng.shuffle(others.filter(c => !isLeaf(c))));
    for (const sp of specials) pool.shift().type = sp;
    const near = pool.filter(c => c.dist < 3).sort((a, b) => b.dist - a.dist);
    pool.filter(c => c.dist >= 3).concat(near).forEach((c, i) => { c.type = i < nElite ? 'elite' : 'combat'; });
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
    assignRewards(rooms, stratum, seed);
    for (const r of rooms) carveDoors(r);
    for (const r of rooms) { finalizeInterior(r, stratum); decorate(r, stratum); }
    return { stratum, seed, rooms, start: 0, boss: boss.id };
  };

  // Rewards are fixed per floor and shown before entry. Normal combat: boon (drawn from the claiming hero's own paths), gold, vigor, forge,
  // each kind getting its REWARD_ODDS share of the floor's combat rooms (rounded by weighted draw on the remainders). Elite: relic, or epic at 25%.
  function assignRewards(rooms, stratum, seed) {
    const rng = U.RNG((seed ^ 0x5bd1e995) + stratum * 15485863);
    const combat = rooms.filter(r => r.type === 'combat'), elites = rooms.filter(r => r.type === 'elite');
    const total = REWARD_ODDS.reduce((a, o) => a + o[1], 0);
    const quota = REWARD_ODDS.map(o => combat.length * o[1] / total), counts = quota.map(Math.floor);
    const rest = quota.map((q, i) => ({ i, f: q - counts[i] }));
    for (let left = combat.length - counts.reduce((a, c) => a + c, 0); left > 0; left--) {
      const p = rng.weighted(rest, x => x.f); counts[p.i]++; p.f = 0;
    }
    const bag = [];
    counts.forEach((c, i) => { for (let k = 0; k < c; k++) bag.push(REWARD_ODDS[i][0]); });
    rng.shuffle(bag);
    combat.forEach((r, i) => { r.reward = bag[i]; });
    elites.forEach((r) => { r.reward = rng.chance(0.25) ? 'epic' : 'relic'; });
  }

  // Grid growth: each new cell touches exactly one existing cell. `spine` > 0 first lays a straight corridor of that length.
  function grow(rng, total, spine) {
    const cells = {};
    cells[key(0, 0)] = { gx: 0, gy: 0 };
    const list = [cells[key(0, 0)]];
    if (spine) {
      const d = rng.pick(Object.keys(DIRS));
      for (let i = 1; i <= spine; i++) {
        const c = { gx: DIRS[d][0] * i, gy: DIRS[d][1] * i };
        cells[key(c.gx, c.gy)] = c; list.push(c);
      }
    }
    let guard = 0;
    while (list.length < total && guard++ < 2000) {
      const base = rng.pick(list);
      const d = rng.pick(Object.keys(DIRS));
      const nx = base.gx + DIRS[d][0], ny = base.gy + DIRS[d][1];
      if (Math.abs(nx) > BOUND || Math.abs(ny) > BOUND || cells[key(nx, ny)]) continue;
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
    const size = c.type === 'combat' || c.type === 'elite' ? rng.pick(COMBAT_SIZES) : SIZE[c.type];
    const w = size[0], h = size[1];
    const tiles = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      tiles[y * w + x] = (x === 0 || x === w - 1 || y <= 1 || y === h - 1) ? 1 : 0;
    }
    return {
      id: c.id, gx: c.gx, gy: c.gy, type: c.type, w, h, tiles, seed, stratum,
      dist: c.dist, danger: 1 + 0.05 * c.dist, reward: null,
      doors: { n: -1, s: -1, e: -1, w: -1 },
      decor: [], breakables: [], torches: [], dark: !!c.dark,
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

  // Nearest open floor to (wx,wy) whose 3x3 surroundings are all floor (props must never sit inside pillars, chasms or hazards).
  D.clearSpot = (room, wx, wy) => {
    const cx = Math.floor(wx / T), cy = Math.floor(wy / T);
    const free = (x, y) => x >= 1 && y >= 2 && x < room.w - 1 && y < room.h - 1 && room.tiles[y * room.w + x] === 0;
    for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      let ok = true;
      for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) if (!free(cx + dx + i, cy + dy + j)) { ok = false; break; }
      if (ok) return r === 0 ? { x: wx, y: wy } : { x: (cx + dx + 0.5) * T, y: (cy + dy + 0.5) * T };
    }
    return { x: wx, y: wy };
  };

  // ---------------- interior layout ----------------
  const PATTERNS = ['open', 'pillars4', 'grid', 'center', 'chasm', 'pools', 'cross', 'scatter', 'pools', 'pillars4'];
  const ELITE_PATTERNS = ['pillars4', 'grid', 'center', 'chasm', 'pools', 'cross', 'scatter']; // elites always get cover

  function finalizeInterior(room, stratum) {
    const rng = U.RNG(room.seed);
    if (room.type === 'combat') room.pattern = rng.pick(PATTERNS);
    else if (room.type === 'elite') room.pattern = rng.pick(ELITE_PATTERNS);
    else if (room.type === 'boss') room.pattern = rng.pick(['bossPillars', 'open', 'bossPools']);
    else room.pattern = 'open';
    const arena = room.type === 'boss' && (ED.ENEMIES[ED.biomeFor(stratum).boss] || {}).arena; // a boss with a fixed arena (arena.js D.layArena) replaces the drawn pattern
    if (arena) { room.pattern = 'arena'; D.layArena(room, arena); return; }
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
    const w = room.w, h = room.h, area = w * h / PATTERN_AREA;
    const hazard = 4;
    if (p === 'pillars4') {
      const s = Math.max(2, Math.round(2 * Math.sqrt(area))); // block side: block area scales with room area
      const px = Math.floor(w / 4), py = Math.min(Math.floor((h + 2) / 4) + 1, Math.floor(h / 2) - s); // the mirrored blocks keep a 2-row gap
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) sym(room, px + dx, py + dy, 2);
    } else if (p === 'grid') {
      const x0 = (w - 1 - 4 * Math.floor((w - 9) / 4)) >> 1; // columns centred on the room
      for (let y = 4; y < h - 3; y += 3) for (let x = x0; x < w - x0; x += 4) setT(room, x, y, 2);
    } else if (p === 'center') {
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2) + 1, hx = Math.max(1, Math.round(w / 22)), hy = Math.max(1, Math.round(h / 14));
      for (let y = cy - hy; y <= cy + hy; y++) for (let x = cx - hx; x <= cx + hx; x++) room.tiles[y * w + x] = 2;
    } else if (p === 'chasm') {
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2) + 1;
      const rx = Math.max(2, Math.floor(w / 6)), ry = Math.max(1, Math.floor(h / 6));
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) room.tiles[y * w + x] = 3;
    } else if (p === 'pools' || p === 'bossPools') {
      const n = p === 'bossPools' ? 4 : rng.int(Math.round(2 * area), Math.round(3 * area));
      for (let i = 0; i < n; i++) {
        const px = rng.int(3, Math.floor(w / 2) - 2), py = rng.int(4, Math.floor(h / 2));
        const rw = rng.int(1, 2), rh = rng.int(1, 2);
        for (let y = py - rh; y <= py + rh; y++) for (let x = px - rw; x <= px + rw; x++) {
          if ((x - px) * (x - px) / ((rw + 0.5) * (rw + 0.5)) + (y - py) * (y - py) / ((rh + 0.5) * (rh + 0.5)) <= 1.05) sym(room, x, y, hazard);
        }
      }
    } else if (p === 'cross') {
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2) + 1, ax = Math.max(4, Math.round(w * 0.19));
      const ay = Math.max(2, Math.min(Math.round(h * 0.21), cy - 4, h - 4 - cy)); // the vertical arms stop at the door aprons, mirrored about cy
      for (let x = cx - ax; x <= cx + ax; x++) if (Math.abs(x - cx) > 1) room.tiles[cy * w + x] = 2;
      for (let y = cy - ay; y <= cy + ay; y++) if (Math.abs(y - cy) > 1) room.tiles[y * w + cx] = 2;
    } else if (p === 'scatter') {
      const n = rng.int(Math.round(4 * area), Math.round(6 * area));
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
  // Breakables ({ k, x, y, v, s } in tiles, like decor) are the decor kinds of biome.breakable: smashable props, never baked into the floor. Combat, elite and boss rooms hold BREAK_MIN..BREAK_MAX of them, every other room at most BREAK_SPARE.
  const BREAK_MIN = 4, BREAK_MAX = 8, BREAK_SPARE = 3, BREAK_GAP = 1.1; // BREAK_GAP: least distance in tiles between two
  const FIGHT = { combat: 1, elite: 1, boss: 1 };

  // A breakable stands on plain floor, off every door lane, clear of the prop spot (1.5 tiles around the centre; in a room without a fight the whole band its props and signs span) and BREAK_GAP from the others in `list`.
  function breakFree(room, x, y, list) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (room.tiles[ty * room.w + tx] !== 0 || inDoorLane(room, tx, ty)) return false;
    const cx = room.w / 2, cy = room.h / 2 + 0.5;
    if (FIGHT[room.type] ? Math.hypot(x - cx, y - cy) < 1.5 : Math.abs(x - cx) < 5.8 && Math.abs(y - cy) < 2.9) return false;
    for (const b of list) if (Math.hypot(b.x - x, b.y - y) < BREAK_GAP) return false;
    return true;
  }

  function decorate(room, stratum) {
    const rng = U.RNG(room.seed ^ 0xdec0);
    const biome = ED.biomeFor(stratum), brk = biome.breakable || [];
    const n = Math.floor(room.w * room.h / 22);
    for (let i = 0; i < n; i++) {
      const x = rng.int(1, room.w - 2), y = rng.int(2, room.h - 2);
      if (room.tiles[y * room.w + x] !== 0) continue;
      const d = { k: rng.pick(biome.decor), x: x + rng.range(0.15, 0.85), y: y + rng.range(0.2, 0.85), v: rng.next(), s: rng.range(0.7, 1.2) };
      if (brk.indexOf(d.k) < 0) room.decor.push(d);
      else if (breakFree(room, d.x, d.y, room.breakables)) room.breakables.push(d);
    }
    if (FIGHT[room.type] && brk.length) { // top up to BREAK_MIN from a stream of its own (the decor and torch rolls stay as they are)
      const top = U.RNG(room.seed ^ 0xb7ea);
      for (let i = 0; i < 200 && room.breakables.length < BREAK_MIN; i++) {
        const x = top.int(1, room.w - 2), y = top.int(2, room.h - 2);
        const d = { k: top.pick(brk), x: x + top.range(0.15, 0.85), y: y + top.range(0.2, 0.85), v: top.next(), s: top.range(0.7, 1.2) };
        if (breakFree(room, d.x, d.y, room.breakables)) room.breakables.push(d);
      }
    }
    room.breakables.length = Math.min(room.breakables.length, FIGHT[room.type] ? BREAK_MAX : BREAK_SPARE);
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
