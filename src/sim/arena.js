// Boss and champion arenas, shared by the sim and the client: the fixed layout a boss def's `arena` lays at floor generation, the live state on room.arena (host: written by boss-king.js, boss-hollow.js and champions.js;
// client mirror: decoded from the snapshot row AR) and the rules it adds to hero movement. A kind registers { id (wire), encode(ar) -> array, decode(room, row, ar), slow(room, ar, x, y) -> factor, clear(room, ar) }.
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
  // Distance a ray from (x, y) at angle a travels before a wall or pillar tile (shots' blockers), at most max px, sampled every 6 px.
  A.ray = (room, x, y, a, max) => {
    const c = Math.cos(a), s = Math.sin(a);
    for (let d = 6; d < max; d += 6) if (D.blocksShots(D.tileAt(room, x + c * d, y + s * d), true)) return d;
    return max;
  };
})(globalThis.ED || (globalThis.ED = {}));
