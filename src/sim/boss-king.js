// The Drowned King. The tide floods the arena from a telegraphed edge (warn, rise, hold, ebb); flooded floor slows heroes and ticks, raised dais stay dry. The Tidal Beam sweeps from the King and stops at walls and pillars.
// Phase 2: the middle dais sink and tides come from two opposite edges at once. Phase 3: a whirlpool at the centre pulls heroes in (its core hurts), the King holds the centre, the beam turns a full circle and drowned foes wade in with each tide.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon, T = ED.CONST.TILE, TAU = U.TAU, A = ED.Arena, B = ED.Bosses;
  const { drop, line, cone, ring, aim, mv, summon, approach, runner, grow, tele } = B.lib;

  // Tide: first = s from the spawn to the first warning, calm = s between the ebb and the next warning by phase, warn s, rise / ebb px/s, hold s, reach = share of the edge's span the water covers by phase
  // (phases 2-3 flood two opposite edges), slow = walking factor in water, a hero in water takes dmg x boss damage every tick s (no hit invulnerability), adds = drowned foes per tide in phase 3 (grown by the party).
  const TIDE = { first: 6, calm: [3, 3, 2.5], warn: 2.2, rise: 170, hold: 2.5, ebb: 360, reach: [0.6, 0.35, 0.3], slow: 0.7, tick: 0.5, dmg: 0.15, adds: ['drowned', 'drowned'] };
  const SUNK = 0x30; // dais bit mask that sinks in phase 2 (room.dais 4 and 5, the middle pair)
  // Whirlpool (phase 3): pull speed toward the room centre (px/s) within r, a core of radius core that hurts dmg x boss damage every tick s.
  const POOL = { str: 40, r: 560, core: 60, dmg: 0.45, tick: 0.5 };
  // Tidal Beam: warm-up s (x windMul), width, damage x boss damage per hit, length cap, sweep arc and its seconds (phases 1-2; phase 2 sends two opposite beams), phase 3 a full turn in spin s.
  const BEAM = { warm: 1.5, w: 22, dmg: 1.1, len: 900, sweep: 2.4, t: 3, spin: 5.5 };

  // Depth (px) of (x, y) from the inner line of edge i (0 n, 1 s, 2 e, 3 w) and the span (px) the water crosses from that edge.
  const depth = (room, i, x, y) => (i === 0 ? y - 2 * T : i === 1 ? (room.h - 1) * T - y : i === 2 ? (room.w - 1) * T - x : x - T);
  const span = (room, i) => (i < 2 ? room.h - 3 : room.w - 2) * T;
  // Index of the unsunk dais under (x, y), or -1.
  const daisAt = (room, ar, x, y) => {
    const ds = room.dais; if (!ds) return -1;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    for (let i = 0; i < ds.length; i++) { const d = ds[i]; if (!((ar.sunk >> i) & 1) && tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return i; }
    return -1;
  };
  // Water covers (x, y): a tide is up (rise, hold, ebb), (x, y) lies within front x span of one of its edges, and no dais holds it.
  const flooded = (room, ar, x, y) => {
    if (ar.st < 2 || !(ar.front > 0)) return false;
    for (let i = 0; i < 4; i++) if (((ar.m >> i) & 1) && depth(room, i, x, y) < ar.front * span(room, i)) return daisAt(room, ar, x, y) < 0;
    return false;
  };
  // Wire: [edge mask, state (0 calm, 1 warn, 2 rise, 3 hold, 4 ebb), front x1000, sunk mask, whirlpool, state seconds x10].
  A.reg('tide', {
    id: 1,
    encode: (ar) => [ar.m, ar.st, Math.round(ar.front * 1000), ar.sunk, ar.pool ? 1 : 0, Math.round(ar.t * 10)],
    decode: (room, r, ar) => { ar.m = r[1]; ar.st = r[2]; ar.front = r[3] / 1000; ar.sunk = r[4]; ar.pool = !!r[5]; ar.t = r[6] / 10; },
    slow: (room, ar, x, y) => (flooded(room, ar, x, y) ? TIDE.slow : 1),
  });
  A.tide = { TIDE, POOL, BEAM, depth, span, daisAt, flooded };

  // A floor point within two tiles of edge i at least 110 px from every hero (null after 20 tries).
  const edgeSpot = (w, room, i, heroes) => {
    for (let k = 0; k < 20; k++) {
      const tx = i === 2 ? room.w - 2 - w.rng.int(0, 1) : i === 3 ? 1 + w.rng.int(0, 1) : w.rng.int(2, room.w - 3);
      const ty = i === 0 ? 2 + w.rng.int(0, 1) : i === 1 ? room.h - 2 - w.rng.int(0, 1) : w.rng.int(3, room.h - 3);
      if (room.tiles[ty * room.w + tx] !== 0) continue;
      const x = (tx + 0.5) * T, y = (ty + 0.5) * T;
      if (heroes.every(p => U.dist2(p.x, p.y, x, y) > 110 * 110)) return { x, y };
    }
    return null;
  };
  // Phase 3: drowned foes come in along the flooding edges (telegraphed spawns).
  const tideAdds = (w, ar) => {
    const room = w.room, heroes = w.alivePlayers(), edges = [0, 1, 2, 3].filter(i => (ar.m >> i) & 1), list = grow(w, TIDE.adds.filter(t => ED.ENEMIES[t]));
    list.forEach((type, j) => { const pt = edgeSpot(w, room, edges[j % edges.length], heroes); if (pt) w.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 16, dur: 0.95, type }); });
  };
  // Hero damage that grants no hit invulnerability (water and the whirlpool core tick on their own clocks).
  const soak = (w, p, dmg, x, y) => { const inv = p.invuln; if (w.hurtPlayer(p, dmg, { hazard: true, x, y })) p.invuln = inv; };

  // Arena tick (host): the tide cycle, water and whirlpool damage, and the fodder trickle (none in phase 3, the tide brings foes).
  const tick = (w, e, dt) => {
    const room = w.room, ph = Math.min(3, e.phase);
    let ar = room.arena;
    if (!ar || ar.k !== 'tide') ar = room.arena = { k: 'tide', m: 0, st: 0, t: 0, front: 0, next: TIDE.first, sunk: 0, pool: false, reach: TIDE.reach[0], sp: 1, tk: {}, poolT: 0 };
    ar.t += dt;
    if (ar.st === 0) {
      if ((ar.next -= dt) <= 0) {
        ar.m = ph >= 2 ? (w.rng.chance(0.5) ? 0x3 : 0xc) : 1 << w.rng.int(0, 3);
        ar.st = 1; ar.t = 0; ar.front = 0; ar.reach = TIDE.reach[ph - 1]; ar.sp = span(room, ar.m & 0x3 ? 0 : 2); ar.n = (ar.n | 0) + 1;
        w.emit({ t: 'tide', m: ar.m, st: 1 });
      }
    } else if (ar.st === 1) {
      if (ar.t >= TIDE.warn) { ar.st = 2; ar.t = 0; w.emit({ t: 'tide', m: ar.m, st: 2 }); if (ph >= 3) tideAdds(w, ar); }
    } else if (ar.st === 2) {
      ar.front += TIDE.rise / ar.sp * dt;
      if (ar.front >= ar.reach) { ar.front = ar.reach; ar.st = 3; ar.t = 0; }
    } else if (ar.st === 3) {
      if (ar.t >= TIDE.hold) { ar.st = 4; ar.t = 0; }
    } else if ((ar.front -= TIDE.ebb / ar.sp * dt) <= 0) { ar.front = 0; ar.st = 0; ar.t = 0; ar.m = 0; ar.next = TIDE.calm[ph - 1]; }
    for (const p of w.players.values()) {
      if (p.downed || p.dead || p.dashing || !flooded(room, ar, p.x, p.y)) { delete ar.tk[p.pid]; continue; }
      ar.tk[p.pid] = (ar.tk[p.pid] === undefined ? 0.2 : ar.tk[p.pid]) - dt;
      if (ar.tk[p.pid] <= 0) { ar.tk[p.pid] = TIDE.tick; soak(w, p, e.dmg * TIDE.dmg, p.x, p.y); }
    }
    if (ar.pool && (ar.poolT -= dt) <= 0) {
      ar.poolT = POOL.tick;
      const c = D.center(room);
      for (const p of w.players.values()) if (!p.downed && !p.dead && U.dist2(p.x, p.y, c.x, c.y) < (POOL.core + p.r) ** 2) soak(w, p, e.dmg * POOL.dmg, c.x, c.y);
    }
    e.noFodder = ph >= 3;
  };

  const onPhase = (w, e, ph) => {
    const room = w.room, ar = room.arena;
    if (!ar) return;
    if (ph === 2) {
      ar.sunk |= SUNK;
      for (let i = 0; i < (room.dais || []).length; i++) if ((SUNK >> i) & 1) { const d = room.dais[i]; w.emit({ t: 'sink', x: Math.round((d.x + d.w / 2) * T), y: Math.round((d.y + d.h / 2) * T), w: d.w * T, h: d.h * T }); }
    } else if (ph === 3 && !ar.pool) {
      ar.pool = true; ar.poolT = POOL.tick;
      const c = D.center(room);
      w.addZone({ kind: 'pull', x: c.x, y: c.y, r: POOL.r, str: POOL.str, dur: 1e6, team: 1 });
      w.emit({ t: 'pool', x: Math.round(c.x), y: Math.round(c.y) });
    }
  };

  const chase = approach(140);
  B.drownedking = runner({
    // Tidal Beam: a beam (two opposite ones in phase 2) sweeps BEAM.sweep around the aim, phase 3 a full turn; its length stops at the first wall or pillar, so a pillar between hero and King is cover.
    beam: {
      w: 3,
      start(w, e) {
        e.pose = 'wind';
        const k = e.vars.wm, warm = BEAM.warm * k, spin = e.phase >= 3, dir = w.rng.sign();
        const sweep = spin ? TAU : BEAM.sweep, t = spin ? BEAM.spin : BEAM.t, rate = dir * sweep / t, n = e.phase === 2 ? 2 : 1, a0 = aim(e) - (spin ? 0 : dir * sweep / 2);
        e.vars.warm = warm; e.vars.end = warm + t + 0.3;
        for (let i = 0; i < n; i++) {
          w.addZone({ kind: 'laser', x: e.x, y: e.y - 6, a: a0 + i * Math.PI, len: BEAM.len, w: BEAM.w, warm, dur: warm + t, dmg: e.dmg * BEAM.dmg, team: 1, src: e, arc: rate * t, tidal: true,
            update: (ww, z, ddt) => { z.x = e.x; z.y = e.y - 6; if (z.t > z.warm) z.a += rate * ddt; z.len = A.ray(ww.room, z.x, z.y, z.a, BEAM.len); } });
        }
        w.emit({ t: 'tell', k: 'beam', x: Math.round(e.x), y: Math.round(e.y) });
      },
      update(w, e, dt, t) { e.pose = t > e.vars.warm ? 'cast' : 'wind'; return t > e.vars.end; },
    },
    trident: {
      w: 3,
      start(w, e) {
        e.pose = 'wind';
        const n = e.phase >= 2 ? 5 : 3, a0 = aim(e);
        e.vars.at = 0.8 * e.vars.wm; e.vars.angles = [];
        for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * 0.33; e.vars.angles.push(a); line(w, e, e.x, e.y, a, 640, 18, e.vars.at, 0, true); }
      },
      update(w, e, dt, t) {
        if (!e.vars.fired && t > e.vars.at) { e.vars.fired = true; e.pose = 'cast'; for (const a of e.vars.angles) w.enemyShoot(e, a, 520, 'trident', 1.2, 7); }
        return t > e.vars.at + 0.5;
      },
    },
    // The King vaults onto the hero's spot (landing circle), a ring of water on landing, then a cleaving cone.
    leap: {
      w: 2, ok: (w, e) => e.phase < 3,
      start(w, e) {
        e.pose = 'air';
        const k = e.vars.wm, fl = 1.0 * k, tx = e.target.x, ty = e.target.y;
        e.vars.from = [e.x, e.y]; e.vars.to = [tx, ty]; e.vars.fl = fl; e.vars.end = fl + 0.55 * k + 0.4;
        tele(w, e, tx, ty, 78, fl, 1.3, 'slam', (ww) => {
          e.pose = 'wind'; ring(ww, e, 10, 150, 'water', ww.rng.range(0, 1), 0.7, 6);
          cone(ww, e, aim(e), 125, 1.7, 0.55 * k, 1.2, () => { e.pose = 'slam'; });
        });
      },
      update(w, e, dt, t) {
        if (t <= e.vars.fl) {
          const k = Math.min(1, t / e.vars.fl);
          e.x = U.lerp(e.vars.from[0], e.vars.to[0], U.easeInOut(k)); e.y = U.lerp(e.vars.from[1], e.vars.to[1], U.easeInOut(k));
          if (k >= 1) Sim.resolve(e, w.room, w.locked, false);
        }
        return t > e.vars.end;
      },
    },
    // Geysers erupt under every hero and around them (staggered landing circles).
    geyser: {
      w: 2, phase: 2,
      start(w, e) {
        e.pose = 'cast';
        const k = e.vars.wm;
        for (const p of w.alivePlayers()) for (let j = 0; j < 3; j++) {
          const pt = j ? Sim.castMove(w.room, p.x, p.y, w.rng.range(0, TAU), w.rng.range(45, 95), 8, true) : { x: p.x, y: p.y };
          drop(w, e, pt.x, pt.y, 40, (0.95 + j * 0.25) * k, 1.0, 'ice');
        }
      },
      update(w, e, dt, t) { return t > 1.7 * e.vars.wm; },
    },
    eels: {
      w: 1, ok: (w, e) => e.phase < 3 && w.hostiles(true) < 6,
      start(w, e) { e.pose = 'cast'; e.vars.end = summon(w, e, e.phase >= 2 ? ['eel', 'eel', 'jelly'] : ['eel', 'eel']); },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
  }, {
    tick, onPhase,
    idle: (w, e, dt) => { // phase 3: holds the centre of the whirlpool
      if (e.phase < 3) { chase(w, e, dt); return; }
      const c = D.center(w.room), d = Math.hypot(c.x - e.x, c.y - e.y);
      e.pose = 'idle';
      if (d > 10) { const dir = w.pathDir(e, c.x, c.y); mv(w, e, dir[0], dir[1], e.spd * e.slow, dt); } else e.face = e.target.x > e.x ? 1 : -1;
    },
  });
})(globalThis.ED || (globalThis.ED = {}));
