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
  const FIGHT_ROOM = { combat: 1, elite: 1, champion: 1 }; // node types that draw a combat room size
  const PATTERN_AREA = 294; // tile area the base pool and scatter counts are written for: both scale by room area / PATTERN_AREA
  const EVENTS = ['fountain', 'altar', 'gamble', 'trial'];
  const REWARD_ODDS = [['boon', 55], ['gold', 15], ['vigor', 10], ['forge', 20]]; // normal combat reward weights
  const MIN_FIGHTS = 3; // the Platino's cue is one of the first MIN_FIGHTS fight clears of a floor

  // ---------------- map (Slay-the-Spire layered graph) ----------------
  // Rows of rooms between the start camp (row 0) and the boss (row ROWS + 1), by stratum; LANES columns; MAP_PATHS paths drawn bottom to top; a row holds ROW_N nodes; the start camp leads to START_N row-1 rooms.
  const ROWS = [15, 15, 15, 6], LANES = 7, MAP_PATHS = [5, 6], ROW_N = [2, 5], START_N = [3, 4], MAP_TRIES = 80;
  // Node type weights of rows without a fixed type (strata I-III) and the first row each may appear on. dark = a harder combat node (§7).
  const NODE_W = { combat: 43, dark: 18, elite: 25, event: 10, shop: 5, rest: 4 };
  const NODE_FROM = { combat: 1, dark: 3, elite: 5, event: 2, shop: 5, rest: 6 };
  const NO_REPEAT = { dark: 1, elite: 1, shop: 1, rest: 1 }; // never on two rows in a row of one path
  // Stratum IV (finale) rows: each node draws from its row's list (both kinds appear in a row of two or more nodes); champion rows name the champion.
  const FINALE = [['combat'], ['combat', 'event'], ['champion:twins'], ['rest', 'shop'], ['champion:mimic'], ['rest']];
  D.ROWS = ROWS; D.LANES = LANES;
  D.rowsOf = (stratum) => ROWS[Math.max(0, Math.min(ROWS.length - 1, stratum - 1))];

  D.isSolid = (t, locked) => t === 1 || t === 2 || (t === 5 && locked);
  D.blocksShots = (t, locked) => t === 1 || t === 2 || (t === 5 && locked);
  D.walkable = (t) => t === 0 || t === 4 || t === 5;
  D.side = (d) => d.charAt(0); // wall side of a door key: exits are 'n0', 'n1', ... (left to right), the entry is 's'
  D.doorWant = (d) => (d && d.charAt(0) === 'n' ? 1 + Number(d.slice(1)) : 0); // co-op door want of exit d (net.js P[26]): 1 + its index, 0 none
  D.wantDoor = (v) => (v > 0 ? 'n' + (v - 1) : null); // the exit key of a door want

  // Paths of the graph: { nodes: [row][lane] = true, edges: Set 'row,lane,nextLane' }. Each path starts on one of START_N lanes and steps to lane - 1, lane or lane + 1 of the next row, never crossing an edge already drawn.
  // Redrawn until every row holds ROW_N nodes; the last try is kept as it is.
  function drawPaths(rng, R) {
    let out = null;
    for (let tr = 0; tr < MAP_TRIES; tr++) {
      const nodes = [], edges = new Set(), lanesOf = (r) => nodes[r] ? Object.keys(nodes[r]).map(Number) : [];
      const mark = (r, l) => { (nodes[r] || (nodes[r] = {}))[l] = true; };
      const starts = rng.shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, rng.int(START_N[0], START_N[1])).sort((a, b) => a - b), nP = rng.int(MAP_PATHS[0], MAP_PATHS[1]);
      const first = rng.shuffle(starts.slice());
      for (let k = 0; k < nP; k++) {
        let l = k < first.length ? first[k] : rng.pick(starts);
        mark(1, l);
        for (let r = 1; r < R; r++) {
          const opts = [l - 1, l, l + 1].filter(n => n >= 0 && n < LANES && !crosses(edges, r, l, n));
          const n = opts.length ? rng.pick(opts) : l;
          edges.add(r + ',' + l + ',' + n); mark(r + 1, n); l = n;
        }
      }
      out = { nodes, edges };
      let ok = lanesOf(1).length >= START_N[0];
      for (let r = 2; r <= R && ok; r++) { const n = lanesOf(r).length; ok = n >= ROW_N[0] && n <= ROW_N[1]; }
      if (ok) break;
    }
    return out;
  }
  // True when an edge from lane a of row r to lane b of row r + 1 would cross one already drawn.
  function crosses(edges, r, a, b) {
    for (let c = Math.max(0, a - 1); c <= Math.min(LANES - 1, a + 1); c++) {
      if (c === a) continue;
      for (let d = Math.max(0, b - 1); d <= Math.min(LANES - 1, b + 1); d++) if ((c - a) * (d - b) < 0 && edges.has(r + ',' + c + ',' + d)) return true;
    }
    return false;
  }

  // Node types. Strata I-III: row 1 combat, the middle row treasure, the last row rest, every other node a weighted draw that keeps the NODE_FROM rows and NO_REPEAT rules against its parents
  // and avoids the types its parents' other children took. Stratum IV follows FINALE.
  function typeNodes(rng, cells, R, stratum) {
    const mid = Math.ceil(R / 2), finale = stratum >= ROWS.length;
    for (let r = 1; r <= R; r++) {
      const row = cells.filter(c => c.row === r);
      if (finale) {
        const kinds = FINALE[r - 1], deal = rng.shuffle(kinds.slice());
        row.forEach((c, i) => { const k = i < deal.length ? deal[i] : rng.pick(kinds), sp = k.split(':'); c.type = sp[0]; if (sp[1]) c.champ = sp[1]; });
        continue;
      }
      for (const c of row) {
        if (r === 1) { c.type = 'combat'; continue; }
        if (r === mid) { c.type = 'treasure'; continue; }
        if (r === R) { c.type = 'rest'; continue; }
        const sib = new Set();
        for (const p of c.parents) for (const o of p.children) if (o !== c && o.type) sib.add(o.type);
        const opts = Object.keys(NODE_W).filter(k => r >= NODE_FROM[k] && !(NO_REPEAT[k] && c.parents.some(p => p.type === k)) && !(k === 'rest' && r === R - 1));
        c.type = rng.weighted(opts, k => NODE_W[k] * (sib.has(k) ? 0.25 : 1));
      }
    }
    for (const c of cells) if (c.type === 'dark') { c.type = 'combat'; c.dark = true; } // a dark node is a combat room flagged dark
  }

  // Floor of a stratum: the start camp, ROWS rows of rooms and the boss. Each room knows its map place (row, lane), its exits (ids left to right by lane: the north doors 'n0', 'n1', ...) and whether it has the south entry door.
  D.generate = (stratum, seed) => {
    const rng = U.RNG(seed ^ (stratum * 7919)), R = D.rowsOf(stratum);
    const { nodes, edges } = drawPaths(rng, R);
    const cells = [{ row: 0, lane: 3, type: 'start', parents: [], children: [] }], at = {};
    for (let r = 1; r <= R; r++) for (const l of Object.keys(nodes[r] || {}).map(Number).sort((a, b) => a - b)) { const c = { row: r, lane: l, parents: [], children: [] }; at[r + ',' + l] = c; cells.push(c); }
    const boss = { row: R + 1, lane: 3, type: 'boss', parents: [], children: [] };
    cells.push(boss);
    const link = (a, b) => { if (a.children.indexOf(b) < 0) { a.children.push(b); b.parents.push(a); } };
    for (const c of cells) if (c.row === 1) link(cells[0], c); else if (c.row === R) link(c, boss);
    for (const e of [...edges].sort()) { const [r, a, b] = e.split(',').map(Number); link(at[r + ',' + a], at[(r + 1) + ',' + b]); }
    for (const c of cells) c.children.sort((a, b) => a.lane - b.lane);
    typeNodes(rng, cells, R, stratum);
    cells.forEach((c, i) => { c.id = i; });
    const rooms = cells.map(c => buildRoom(c, stratum, rng.seed(), rng));
    for (const r of rooms) r.threat = threatOf(r, R);
    assignRewards(rooms, stratum, seed);
    for (const r of rooms) carveDoors(r);
    for (const r of rooms) { finalizeInterior(r, stratum); if (stratum === BELL_STRATUM && r.dark) placeBell(r); decorate(r, stratum); }
    return { stratum, seed, rooms, start: 0, boss: boss.id, rows: R, platino: platinoAt(stratum, seed) };
  };

  // Threat pips (0-3) of a room of a floor with R rows: a fight 1, +1 elite or champion, +1 dark, +1 past the middle row; the boss 3; other rooms 0.
  const FIGHTS = { combat: 1, elite: 1, champion: 1 };
  function threatOf(r, R) {
    if (r.type === 'boss') return 3;
    if (!FIGHTS[r.type]) return 0;
    return Math.min(3, 1 + (r.type === 'elite' || r.type === 'champion' ? 1 : 0) + (r.dark ? 1 : 0) + (2 * r.row > R ? 1 : 0));
  }

  // The Drowned Bell: room.bell { x, y } (world px) in every dark room of stratum BELL_STRATUM (it rings once per hero per run), BELL_UP above the centre on a clear spot (the clear reward keeps the centre); placed before decoration, which keeps breakables BELL_GAP tiles from it.
  const BELL_STRATUM = 3, BELL_UP = 48, BELL_GAP = 2;
  function placeBell(room) {
    const c = D.center(room), m = D.clearSpot(room, c.x, c.y - BELL_UP);
    room.bell = { x: m.x, y: m.y };
  }
  // Platino: one floor in PLATINO_ODDS (own RNG stream) lets it out at the clear of its n-th fight on the floor (n = 1..MIN_FIGHTS; rooms.js counts the clears); -1 otherwise.
  const PLATINO_ODDS = 1 / 8;
  function platinoAt(stratum, seed) {
    const rng = U.RNG((seed ^ 0x6c8e9cf5) + stratum * 7841);
    if (!rng.chance(PLATINO_ODDS)) return -1;
    return rng.int(1, MIN_FIGHTS);
  }

  // Rewards are fixed per floor and shown before entry. Combat (dark included): boon (drawn from the claiming hero's own paths), gold, vigor, forge,
  // each kind getting its REWARD_ODDS share of the floor's combat rooms (rounded by weighted draw on the remainders). Elite: epic at 25%, else relic. Champion: relic.
  function assignRewards(rooms, stratum, seed) {
    const rng = U.RNG((seed ^ 0x5bd1e995) + stratum * 15485863);
    const combat = rooms.filter(r => r.type === 'combat');
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
    for (const r of rooms) if (r.type === 'elite') r.reward = rng.next() < 0.25 ? 'epic' : 'relic'; else if (r.type === 'champion') r.reward = 'relic';
  }

  // A room is wide enough for its north doors: n doors need 6n + 5 tiles (odd widths keep the centre door on the middle tile).
  function buildRoom(c, stratum, seed, rng) {
    const size = FIGHT_ROOM[c.type] ? rng.pick(COMBAT_SIZES) : SIZE[c.type], n = c.children.length;
    let w = Math.max(size[0], n > 1 ? 6 * n + 5 : 0);
    if (!(w & 1)) w++;
    const h = size[1];
    const tiles = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      tiles[y * w + x] = (x === 0 || x === w - 1 || y <= 1 || y === h - 1) ? 1 : 0;
    }
    const doors = {}, doorX = {};
    c.children.forEach((o, i) => { doors['n' + i] = o.id; doorX['n' + i] = Math.floor((i + 1) * w / (n + 1)); });
    if (c.row > 0) doorX.s = Math.floor(w / 2);
    return {
      id: c.id, row: c.row, lane: c.lane, type: c.type, w, h, tiles, seed, stratum,
      dist: c.row / 2, danger: 1 + 0.025 * c.row, reward: null, threat: 0, // dist: depth for the encounter budget (half the map row)
      exits: c.children.map(o => o.id), doors, doorX, entry: c.row > 0, // entry: the sealed south door the party came through
      decor: [], breakables: [], torches: [], dark: !!c.dark, champ: c.champ || null,
      event: c.type === 'event' ? EVENTS[seed % EVENTS.length] : null,
      pattern: 'open',
    };
  }

  // Tile rect of door d: 'n<i>' on the north wall at room.doorX[d] (2 rows deep), 's' on the south wall.
  D.doorRect = (room, d) => {
    const sd = D.side(d), cx = room.doorX && room.doorX[d] !== undefined ? room.doorX[d] : Math.floor(room.w / 2), cy = Math.floor(room.h / 2) + 1;
    if (sd === 'n') return { x0: cx - 1, x1: cx + 1, y0: 0, y1: 1 };
    if (sd === 's') return { x0: cx - 1, x1: cx + 1, y0: room.h - 1, y1: room.h - 1 };
    if (sd === 'w') return { x0: 0, x1: 0, y0: cy - 1, y1: cy + 1 };
    return { x0: room.w - 1, x1: room.w - 1, y0: cy - 1, y1: cy + 1 };
  };

  // Every door key a room draws: its exits, then 's' when it has the sealed entry.
  D.doorList = (room) => room.doorKeys || (room.doorKeys = Object.keys(room.doors).concat(room.entry ? ['s'] : []));

  // Exit doors become door tiles; the entry stays wall (it never opens again).
  function carveDoors(room) {
    for (const d in room.doors) {
      const r = D.doorRect(room, d);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) room.tiles[y * room.w + x] = 5;
    }
  }

  // Spawn point just inside a door, in world units.
  D.entryPoint = (room, d, k) => {
    const r = D.doorRect(room, d), sd = D.side(d);
    const cx = (r.x0 + r.x1 + 1) / 2 * T, cy = (r.y0 + r.y1 + 1) / 2 * T;
    const off = (k || 0) * 18 - 18;
    if (sd === 'n') return { x: cx + off, y: 3.2 * T };
    if (sd === 's') return { x: cx + off, y: (room.h - 2.2) * T };
    if (sd === 'w') return { x: 2.0 * T, y: cy + off };
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
    else if (room.type === 'elite' || room.type === 'champion') room.pattern = rng.pick(ELITE_PATTERNS);
    else if (room.type === 'boss') room.pattern = rng.pick(['bossPillars', 'open', 'bossPools']);
    else room.pattern = 'open';
    const arena = room.type === 'boss' && (ED.ENEMIES[ED.biomeFor(stratum).boss] || {}).arena; // a boss with a fixed arena (arena.js D.layArena) replaces the drawn pattern
    if (arena) { room.pattern = 'arena'; D.layArena(room, arena); return; }
    const backup = room.tiles.slice();
    applyPattern(room, room.pattern, rng);
    if (!connected(room)) { room.tiles = backup; room.pattern = 'open'; }
  }

  function inDoorLane(room, x, y) {
    // keep a 2-tile apron in front of every door (the south entry included) and a cross through the centre line clear
    const cx = Math.floor(room.w / 2), cy = Math.floor(room.h / 2) + 1;
    if (Math.abs(x - cx) <= 2 && y >= room.h - 4) return true;
    if (y <= 4) for (const d in room.doors) if (Math.abs(x - room.doorX[d]) <= 2) return true;
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
    if (room.entry && !seen[(h - 3) * w + Math.floor(w / 2)]) return false; // the spot inside the entry too
    // seal unreachable pockets so nothing spawns inside them
    for (let i = 0; i < t.length; i++) if ((t[i] === 0 || t[i] === 4) && !seen[i]) t[i] = 2;
    return true;
  }

  // ---------------- decoration (cosmetic, deterministic) ----------------
  // Breakables ({ k, x, y, v, s } in tiles, like decor) are the decor kinds of biome.breakable: smashable props, never baked into the floor. Combat, elite and boss rooms hold BREAK_MIN..BREAK_MAX of them, every other room at most BREAK_SPARE.
  const BREAK_MIN = 4, BREAK_MAX = 8, BREAK_SPARE = 3, BREAK_GAP = 1.1; // BREAK_GAP: least distance in tiles between two
  const FIGHT = { combat: 1, elite: 1, champion: 1, boss: 1 };

  // A breakable stands on plain floor, off every door lane, clear of the prop spot (1.5 tiles around the centre; in a room without a fight the whole band its props and signs span), BREAK_GAP from the others in `list` and BELL_GAP from the Drowned Bell.
  function breakFree(room, x, y, list) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (room.tiles[ty * room.w + tx] !== 0 || inDoorLane(room, tx, ty)) return false;
    const cx = room.w / 2, cy = room.h / 2 + 0.5;
    if (FIGHT[room.type] ? Math.hypot(x - cx, y - cy) < 1.5 : Math.abs(x - cx) < 5.8 && Math.abs(y - cy) < 2.9) return false;
    for (const b of list) if (Math.hypot(b.x - x, b.y - y) < BREAK_GAP) return false;
    if (room.bell && Math.hypot(x - room.bell.x / T, y - room.bell.y / T) < BELL_GAP) return false;
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
    // torches along the top wall face, avoiding the doors
    const nearDoor = (x) => { for (const d in room.doors) if (Math.abs(x - room.doorX[d]) <= 2) return true; return false; };
    for (let x = 3; x < room.w - 2; x += rng.int(4, 6)) {
      if (nearDoor(x)) continue;
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
