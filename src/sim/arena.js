// Boss and champion arenas, shared by the sim and the client: the fixed layout a boss def's `arena` lays at floor generation, the live state on room.arena (host: written by boss-warden.js and boss-spore.js (kind field),
// boss-king.js (tide), boss-hollow.js (crown) and champions.js (champ); client mirror: decoded from the snapshot row AR) and the rules it adds to hero movement.
// A kind registers { id (wire), encode(ar) -> array, decode(room, row, ar), slow(room, ar, x, y) -> factor, clear(room, ar) }.
(function (ED) {
  'use strict';
  const T = ED.CONST.TILE, D = ED.Dungeon;
  const A = ED.Arena = { kinds: {}, byId: [] };
  A.reg = (k, def) => { A.kinds[k] = def; A.byId[def.id] = k; };

  // Centre tile of arena offsets: (floor(w / 2), floor(h / 2) + 1), where the door lanes cross.
  A.cx = (room) => Math.floor(room.w / 2);
  A.cy = (room) => Math.floor(room.h / 2) + 1;
  const interior = (room, x, y) => x >= 1 && y >= 2 && x <= room.w - 2 && y <= room.h - 2;

  // Floor gen (Dungeon finalizeInterior, a boss room whose boss def has `arena`): pillar tiles (2), room.dais = [{ x, y, w, h }] in tiles, room.lanterns = [{ x, y }] in px (tile centres).
  D.layArena = (room, ar) => {
    const cx = A.cx(room), cy = A.cy(room);
    for (const [dx, dy, w, h] of ar.pillars || []) for (let y = cy + dy; y < cy + dy + h; y++) for (let x = cx + dx; x < cx + dx + w; x++) if (interior(room, x, y)) room.tiles[y * room.w + x] = 2;
    room.dais = (ar.dais || []).map(([dx, dy, w, h]) => ({ x: cx + dx, y: cy + dy, w, h }));
    room.lanterns = (ar.lanterns || []).map(([dx, dy]) => ({ x: (cx + dx + 0.5) * T, y: (cy + dy + 0.5) * T }));
  };

  // Snapshot row of the room's arena: [kind id, ...kind fields], or null without one.
  A.encode = (room) => {
    const ar = room && room.arena, k = ar && A.kinds[ar.k];
    return k ? [k.id].concat(k.encode(ar)) : null;
  };
  // Mirror side: applies a snapshot row to room (null clears the arena).
  A.decode = (room, row) => {
    if (!room) return;
    if (!row) { A.clear(room); return; }
    const k = A.byId[row[0]], def = k && A.kinds[k];
    if (!def) return;
    if (!room.arena || room.arena.k !== k) { A.clear(room); room.arena = { k }; }
    def.decode(room, row, room.arena);
  };
  // Ends the arena of room: the kind restores what it changed (collapsed floor) and room.arena goes.
  A.clear = (room) => {
    const ar = room && room.arena;
    if (!ar) return;
    const k = A.kinds[ar.k];
    if (k && k.clear) k.clear(room, ar);
    room.arena = null;
  };
  // Walking speed factor of a hero at (x, y) (Sim.movePlayer, host and client alike).
  A.slow = (room, x, y) => {
    const ar = room.arena, k = ar && A.kinds[ar.k];
    return k && k.slow ? k.slow(room, ar, x, y) : 1;
  };
  // ---------- kind field: boss-raised walls (Bone Warden) and floor carpet (Sporemother) ----------
  // room.arena { k: 'field', walls: [{ x, y, n, hp, cd }] (tiles x..x+n-1 of row y stand as blocks while hp > 0) or null, lanes (Bone Warden lane plan, host only), carpet: Uint8Array(room.w x room.h) of 0/1 or null }.
  // A.applyField writes the standing walls into room.tiles as tile 2 (only over floor and hazard tiles) and keeps the floor's own tiles in room.baseTiles (the renderer draws those);
  // room.carpet is the carpet (walking x CARPET_SLOW, bots avoid it), room.tver counts wall changes (path caches key on it). Host and mirror run the same code, so a client hero collides with the same walls.
  A.CARPET_SLOW = 0.7;
  A.field = (room) => (room && room.arena && room.arena.k === 'field' ? room.arena : null);
  A.applyField = (room, ar) => {
    if (!room) return;
    let key = '';
    if (ar && ar.walls) for (const s of ar.walls) if (s.hp > 0) key += s.x + ',' + s.y + ',' + s.n + ';';
    if (key !== (room.awKey || '')) {
      if (!room.baseTiles) room.baseTiles = room.tiles.slice();
      const base = room.baseTiles, tl = room.tiles;
      if (room.awSet) for (const i of room.awSet) tl[i] = base[i];
      const set = [];
      if (ar && ar.walls) for (const s of ar.walls) {
        if (!(s.hp > 0) || s.y < 0 || s.y >= room.h) continue;
        for (let x = s.x; x < s.x + s.n; x++) { const i = s.y * room.w + x; if (x >= 0 && x < room.w && (base[i] === 0 || base[i] === 4)) { tl[i] = 2; set.push(i); } }
      }
      room.awSet = set; room.awKey = key; room.tver = (room.tver | 0) + 1;
    }
    room.carpet = ar && ar.carpet ? ar.carpet : null;
  };
  // Starts or updates the field of room (st: { walls, lanes, carpet }; another kind is cleared first) and applies it.
  A.setField = (room, st) => {
    if (room.arena && room.arena.k !== 'field') A.clear(room);
    room.arena = Object.assign(room.arena || { k: 'field', walls: null, lanes: null, carpet: null }, st);
    A.applyField(room, room.arena);
    return room.arena;
  };
  // Wire: [walls [[x, y, n, hp]] or 0, carpet bits 30 per number (tile index order) or 0].
  A.reg('field', {
    id: 4,
    encode: (ar) => {
      let cb = 0;
      if (ar.carpet) { const c = ar.carpet; cb = []; for (let i = 0; i < c.length; i += 30) { let v = 0; for (let k = 0; k < 30 && i + k < c.length; k++) if (c[i + k]) v |= 1 << k; cb.push(v); } }
      return [ar.walls ? ar.walls.map(s => [s.x, s.y, s.n, s.hp]) : 0, cb];
    },
    decode: (room, r, ar) => {
      ar.walls = r[1] ? r[1].map(a => ({ x: a[0], y: a[1], n: a[2], hp: a[3] })) : null;
      if (r[2]) {
        const n = room.w * room.h, c = ar.carpet && ar.carpet.length === n ? ar.carpet : new Uint8Array(n);
        for (let i = 0; i < n; i++) c[i] = (r[2][(i / 30) | 0] >> (i % 30)) & 1;
        ar.carpet = c;
      } else ar.carpet = null;
      A.applyField(room, ar);
    },
    slow: (room, ar, x, y) => (ar.carpet && ar.carpet[Math.floor(y / T) * room.w + Math.floor(x / T)] ? A.CARPET_SLOW : 1),
    clear: (room) => A.applyField(room, null), // the walls fall, the carpet goes
  });

  // Hero hits on standing wall blocks (rooms.js smash hooks, combat.js shots that strike a wall): each block loses 1 hp per hit, at most one hit per WALL_CD s; at 0 it breaks ({t:'wallbreak', x, y, n}).
  const WALL_CD = 0.2, U = ED.U, Wd = ED.World;
  const wallHit = (w, s, p) => {
    if (s.cd > w.time) return;
    s.cd = w.time + WALL_CD; s.hp--;
    w.emit({ t: 'wallhit', x: Math.round((s.x + s.n / 2) * T), y: Math.round((s.y + 0.5) * T), hp: s.hp });
    if (s.hp <= 0) { w.emit({ t: 'wallbreak', x: Math.round((s.x + s.n / 2) * T), y: Math.round((s.y + 0.5) * T), n: s.n }); A.applyField(w.room, A.field(w.room)); }
  };
  // Squared distance from (x, y) to wall block s (px rect).
  const wallD2 = (s, x, y) => { const cx = U.clamp(x, s.x * T, (s.x + s.n) * T), cy = U.clamp(y, s.y * T, (s.y + 1) * T); return (x - cx) ** 2 + (y - cy) ** 2; };
  Wd.prototype.wallCircle = function (p, x, y, r) {
    const ar = A.field(this.room); if (!ar || !ar.walls) return;
    for (const s of ar.walls) if (s.hp > 0 && wallD2(s, x, y) <= r * r) wallHit(this, s, p);
  };
  Wd.prototype.wallSeg = function (p, x0, y0, x1, y1, r) {
    const ar = A.field(this.room); if (!ar || !ar.walls) return;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
    for (const s of ar.walls) {
      if (!(s.hp > 0)) continue;
      for (let i = 0; i <= n; i++) if (wallD2(s, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) <= r * r) { wallHit(this, s, p); break; }
    }
  };
  Wd.prototype.wallArc = function (p, a, reach, arc) {
    const ar = A.field(this.room); if (!ar || !ar.walls) return;
    for (const s of ar.walls) {
      if (!(s.hp > 0) || wallD2(s, p.x, p.y) > reach * reach) continue;
      const cx = U.clamp(p.x, s.x * T, (s.x + s.n) * T), cy = U.clamp(p.y, s.y * T, (s.y + 1) * T), d = Math.hypot(cx - p.x, cy - p.y);
      if (arc >= 6.2 || d < 4 || Math.abs(U.angDiff(a, Math.atan2(cy - p.y, cx - p.x))) <= arc / 2 + Math.atan2(T / 2, Math.max(d, 1))) wallHit(this, s, p);
    }
  };

  // Distance a ray from (x, y) at angle a travels before a wall or pillar tile (shots' blockers), at most max px, sampled every 6 px.
  A.ray = (room, x, y, a, max) => {
    const c = Math.cos(a), s = Math.sin(a);
    for (let d = 6; d < max; d += 6) if (D.blocksShots(D.tileAt(room, x + c * d, y + s * d), true)) return d;
    return max;
  };
})(globalThis.ED || (globalThis.ED = {}));
