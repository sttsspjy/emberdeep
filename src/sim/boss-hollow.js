// The Hollow King, the finale. Phase 1: a duel (crown-blade combos with telegraphed steps, the crown thrown out and back, blinks). Phase 2: the light goes out; each hero sees DARK.vis around them,
// the star lanterns of the arena light for DARK.litT s when a hero hit reaches them, the King takes DARK.shroud damage outside every light and hunts the hero farthest from a lit lantern (an ambush from the dark).
// Phase 3: the light returns and the arena breaks ring by ring from the outside in (each ring warns, then falls into the void); past the last ring the pause between his attacks keeps shrinking (the time check).
// No summons and no fodder trickle. Loaded after rooms.js: lantern hits ride on the breakable-smash hooks.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon, T = ED.CONST.TILE, TAU = U.TAU, A = ED.Arena, B = ED.Bosses, W = ED.World.prototype;
  const { line, cone, ring, aim, mv, approach, runner, drop } = B.lib;

  // Darkness: vis = light radius around each hero (px), lanR = lantern light radius, litT = seconds a lantern burns after a hit, shroud = damage factor on the King outside every light, hitR = lantern hit radius.
  const DARK = { vis: 72, lanR: 130, litT: 14, shroud: 0.4, hitR: 14 };
  // Collapse: ring k falls where q = max(|dx| / half width, |dy| / half height) of the interior exceeds fall[k], at[k] s into phase 3 after warn s of warning; a hero on a falling tile drops for dmg of max health
  // and climbs out at the nearest standing tile. late: past the last ring the pause between attacks x (1 - step) every `every` s, down to min.
  const CRUMBLE = { fall: [0.78, 0.6, 0.44], at: [6, 19, 32], warn: 3, dmg: 0.2, late: { every: 8, step: 0.12, min: 0.5 } };

  // Interior ring coordinate of tile (tx, ty): 0 at the centre, near 1 at the walls.
  const qOf = (room, tx, ty) => Math.max(Math.abs(tx + 0.5 - room.w / 2) / ((room.w - 2) / 2), Math.abs(ty + 0.5 - (room.h + 1) / 2) / ((room.h - 3) / 2));
  // Collapses rings until n have fallen: floor and hazard tiles past the ring's limit become chasm (3); ar.orig keeps [index, tile] pairs for clear.
  const fallTo = (room, ar, n) => {
    if (!ar.orig) ar.orig = [];
    while ((ar.fallen | 0) < Math.min(n, CRUMBLE.fall.length)) {
      const lim = CRUMBLE.fall[ar.fallen | 0];
      for (let ty = 2; ty <= room.h - 2; ty++) for (let tx = 1; tx <= room.w - 2; tx++) {
        const i = ty * room.w + tx, t = room.tiles[i];
        if ((t === 0 || t === 4) && qOf(room, tx, ty) > lim) { ar.orig.push(i, t); room.tiles[i] = 3; }
      }
      ar.fallen = (ar.fallen | 0) + 1;
    }
  };
  // Wire: [dark, rings fallen, ring warning + 1 (0 none), warning seconds x10, then per lantern its seconds left x10 (0 unlit, -1 fallen)].
  A.reg('crown', {
    id: 2,
    encode: (ar) => [ar.dark ? 1 : 0, ar.fallen | 0, ar.warn + 1, Math.round(ar.wt * 10)].concat(ar.lit.map(v => (v < 0 ? -1 : Math.ceil(v * 10)))),
    decode: (room, r, ar) => { ar.dark = !!r[1]; fallTo(room, ar, r[2]); ar.warn = r[3] - 1; ar.wt = r[4] / 10; ar.lit = r.slice(5).map(v => (v < 0 ? -1 : v / 10)); },
    clear: (room, ar) => { const o = ar.orig; if (o) for (let j = 0; j < o.length; j += 2) room.tiles[o[j]] = o[j + 1]; ar.orig = null; ar.fallen = 0; },
  });
  // A lit lantern's light reaches (x, y) (plus pad px).
  const lit = (room, ar, x, y, pad) => {
    const ls = room.lanterns || [];
    for (let i = 0; i < ls.length; i++) if (ar.lit[i] > 0 && U.dist2(ls[i].x, ls[i].y, x, y) < (DARK.lanR + (pad || 0)) ** 2) return true;
    return false;
  };
  A.crown = { DARK, CRUMBLE, qOf, lit };

  // ---------- lanterns: a hero hit lights one (the breakable-smash hooks every hero hit already calls) ----------
  const light = (w, i) => {
    const ar = w.room.arena, L = w.room.lanterns[i];
    if (!(ar.lit[i] > 0)) w.emit({ t: 'lantern', i, x: Math.round(L.x), y: Math.round(L.y) });
    ar.lit[i] = DARK.litT;
  };
  const darkAr = (w) => { const ar = w.room && w.room.arena; return ar && ar.k === 'crown' && ar.dark ? ar : null; };
  const lanCircle = (w, x, y, r) => { const ar = darkAr(w); if (!ar) return; const ls = w.room.lanterns; for (let i = 0; i < ls.length; i++) if (ar.lit[i] >= 0 && U.dist2(ls[i].x, ls[i].y, x, y) <= (DARK.hitR + r) ** 2) light(w, i); };
  const lanSeg = (w, x0, y0, x1, y1, r) => { const ar = darkAr(w); if (!ar) return; const ls = w.room.lanterns; for (let i = 0; i < ls.length; i++) if (ar.lit[i] >= 0 && U.segDist2(ls[i].x, ls[i].y, x0, y0, x1, y1) <= (DARK.hitR + r) ** 2) light(w, i); };
  const lanArc = (w, p, a, reach, arc) => {
    const ar = darkAr(w); if (!ar) return;
    const ls = w.room.lanterns;
    for (let i = 0; i < ls.length; i++) {
      if (ar.lit[i] < 0) continue;
      const dx = ls[i].x - p.x, dy = ls[i].y - p.y, d = Math.hypot(dx, dy);
      if (d - DARK.hitR > reach) continue;
      if (arc < 6.2 && Math.abs(U.angDiff(a, Math.atan2(dy, dx))) > arc / 2 + Math.atan2(DARK.hitR, Math.max(d, 1))) continue;
      light(w, i);
    }
  };
  const sc = W.smashCircle, ss = W.smashSeg, sa = W.smashArc;
  W.smashCircle = function (p, x, y, r) { lanCircle(this, x, y, r); return sc.call(this, p, x, y, r); };
  W.smashSeg = function (p, x0, y0, x1, y1, r) { lanSeg(this, x0, y0, x1, y1, r); return ss.call(this, p, x0, y0, x1, y1, r); };
  W.smashArc = function (p, a, reach, arc) { lanArc(this, p, a, reach, arc); return sa.call(this, p, a, reach, arc); };

  // ---------- the arena tick ----------
  // Nearest standing floor tile centre to (x, y) (the climb-out spot of a fall).
  const safeSpot = (room, x, y) => {
    let best = null, bd = Infinity;
    for (let ty = 2; ty <= room.h - 2; ty++) for (let tx = 1; tx <= room.w - 2; tx++) {
      if (room.tiles[ty * room.w + tx] !== 0) continue;
      const cx = (tx + 0.5) * T, cy = (ty + 0.5) * T, d = U.dist2(cx, cy, x, y);
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    }
    return best || D.center(room);
  };
  // A ring fell: heroes on it drop and climb out (downed ones are carried), foes on it fall, the King steps back onto the floor, lanterns and breakables on it are gone.
  const ringFell = (w, e, ar) => {
    const room = w.room, rs = w.roomState[w.roomId];
    for (const p of w.players.values()) {
      if (p.dead || D.tileAt(room, p.x, p.y) !== 3) continue;
      const x0 = p.x, y0 = p.y, pt = safeSpot(room, p.x, p.y);
      p.x = pt.x; p.y = pt.y; p.vx = 0; p.vy = 0; p.dashT = 0; p.skillMove = null;
      if (!p.downed) { w.hurtPlayer(p, p.maxHp * CRUMBLE.dmg, { hazard: true, x: x0, y: y0 }); p.invuln = Math.max(p.invuln, 1); }
      if (p.remote) w.msgs.push({ to: p.pid, t: 'blink', x: Math.round(p.x), y: Math.round(p.y) });
      w.emit({ t: 'fall', pid: p.pid, x0: Math.round(x0), y0: Math.round(y0), x: Math.round(p.x), y: Math.round(p.y) });
    }
    for (const f of w.enemies) if (f !== e && f.hp > 0 && !f.fly && D.tileAt(room, f.x, f.y) === 3) w.killEnemy(f, null, {});
    if (D.tileAt(room, e.x, e.y) === 3) { const pt = safeSpot(room, e.x, e.y); w.emit({ t: 'blinkfx', x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(pt.x), y1: Math.round(pt.y) }); e.x = pt.x; e.y = pt.y; }
    room.lanterns.forEach((L, i) => { if (D.tileAt(room, L.x, L.y) === 3) ar.lit[i] = -1; });
    room.breakables.forEach((b, i) => {
      if ((rs.broken >> i) & 1 || D.tileAt(room, b.x * T, b.y * T) !== 3) return;
      rs.broken |= 1 << i; w.emit({ t: 'smash', i, x: Math.round(b.x * T), y: Math.round(b.y * T), k: b.k, r: w.roomId });
    });
  };
  // Phase 3 orbit: three shards circle the King at 74 px and hurt heroes they touch.
  const shards = (w, e) => {
    for (let i = 0; i < 3; i++) {
      const a = w.time * 2.2 + i * TAU / 3, x = e.x + Math.cos(a) * 74, y = e.y + Math.sin(a) * 74;
      for (const p of w.players.values()) if (U.dist2(x, y, p.x, p.y) < (p.r + 10) ** 2) w.hurtPlayer(p, e.dmg * 0.8, { e });
    }
  };
  const tick = (w, e, dt) => {
    const room = w.room;
    let ar = room.arena;
    if (!ar || ar.k !== 'crown') ar = room.arena = { k: 'crown', dark: false, lit: (room.lanterns || []).map(() => 0), fallen: 0, warn: -1, wt: 0, p3: 0, orig: null };
    e.noFodder = true;
    if (ar.dark) {
      for (let i = 0; i < ar.lit.length; i++) if (ar.lit[i] > 0) ar.lit[i] = Math.max(0, ar.lit[i] - dt);
      let seen = lit(room, ar, e.x, e.y, e.r);
      if (!seen) for (const p of w.players.values()) if (!p.dead && U.dist2(p.x, p.y, e.x, e.y) < (DARK.vis + e.r) ** 2) { seen = true; break; }
      e.dmgTakenMul = seen ? 1 : DARK.shroud;
    } else e.dmgTakenMul = 1;
    if (e.phase >= 3) {
      ar.p3 += dt;
      const C = CRUMBLE, k = ar.fallen | 0;
      if (k < C.at.length) {
        if (ar.warn < 0 && ar.p3 >= C.at[k] - C.warn) { ar.warn = k; ar.wt = 0; w.emit({ t: 'crumble', k, st: 0 }); }
        if (ar.warn >= 0) {
          ar.wt += dt;
          if (ar.p3 >= C.at[k]) { fallTo(room, ar, k + 1); ar.warn = -1; ar.wt = 0; ringFell(w, e, ar); w.emit({ t: 'crumble', k, st: 1 }); }
        }
      }
      shards(w, e);
    }
  };
  const onPhase = (w, e, ph) => {
    const ar = w.room.arena;
    if (!ar) return;
    if (ph === 2) { ar.dark = true; for (let i = 0; i < ar.lit.length; i++) if (ar.lit[i] >= 0) ar.lit[i] = 0; w.emit({ t: 'lightsout', x: Math.round(e.x), y: Math.round(e.y) }); }
    else if (ph === 3) { ar.dark = false; ar.p3 = 0; e.dmgTakenMul = 1; w.emit({ t: 'dawn', x: Math.round(e.x), y: Math.round(e.y) }); }
  };
  // Pause factor: x0.9 in the dark; past the last ring x(1 - step) per `every` s, down to min.
  const pauseMul = (w, e) => {
    const ar = w.room.arena, L = CRUMBLE.late;
    if (!ar) return 1;
    if (ar.dark) return 0.9;
    if (e.phase < 3 || (ar.fallen | 0) < CRUMBLE.at.length) return 1;
    return Math.max(L.min, 1 - L.step * Math.floor((ar.p3 - CRUMBLE.at[CRUMBLE.at.length - 1]) / L.every + 1));
  };
  // The hunted hero: living, outside every lit lantern's light, the one farthest from a lit lantern (null when every hero stands in light).
  const prey = (w) => {
    const room = w.room, ar = room.arena, ls = room.lanterns || [];
    let best = null, bd = -1;
    for (const p of w.alivePlayers()) {
      if (p.stealthT > 0 || lit(room, ar, p.x, p.y, 0)) continue;
      let d = 1e9;
      for (let i = 0; i < ls.length; i++) if (ar.lit[i] > 0) d = Math.min(d, U.dist2(ls[i].x, ls[i].y, p.x, p.y));
      if (d > bd) { bd = d; best = p; }
    }
    return best;
  };
  const tell = (w, e, k, x, y) => w.emit({ t: 'tell', k, x: Math.round(x === undefined ? e.x : x), y: Math.round(y === undefined ? e.y : y) });

  B.hollowking = runner({
    // Three crown-blade swings: each a telegraphed step toward the target (warn lane, then a short dash), then a slash cone; the third is a long thrust lane.
    combo: {
      w: 3, ok: (w, e) => e.phase !== 2,
      start(w, e) { e.vars.i = 0; e.vars.next = 0; e.vars.n = 3; tell(w, e, 'combo'); },
      update(w, e, dt, t) {
        const v = e.vars, k = v.wm;
        if (v.i < v.n && t >= v.next && !v.b) {
          const a = aim(e), step = U.clamp(Math.hypot(e.target.x - e.x, e.target.y - e.y) - 70, 0, 90);
          line(w, e, e.x, e.y, a, step + e.r, e.r * 1.4, 0.35 * k, 0, true);
          v.b = { at: t + 0.35 * k, a, step, last: v.i === v.n - 1 };
          e.pose = 'wind';
        }
        const b = v.b;
        if (!b) return v.i >= v.n;
        if (!b.go && t >= b.at) { b.go = true; b.until = t + 0.12; e.pose = 'dash'; }
        if (b.go && !b.swung) {
          if (t < b.until) mv(w, e, Math.cos(b.a), Math.sin(b.a), b.step / 0.12, dt);
          else {
            b.swung = true; e.pose = 'wind';
            const a2 = aim(e);
            if (b.last) line(w, e, e.x, e.y, a2, 280, 34, 0.55 * k, 1.5);
            else cone(w, e, a2, 118, 2.1, 0.45 * k, 1.25, () => { e.pose = 'slam'; });
            b.end = t + (b.last ? 0.55 : 0.45) * k + 0.2;
          }
        }
        if (b.swung && t >= b.end) { v.b = null; v.i++; v.next = t + 0.1; e.pose = 'idle'; }
        return v.i >= v.n && !v.b;
      },
    },
    // The crown flies out along a warned lane, stops at its end (or a wall) and flies back to the King.
    crown: {
      w: 2, ok: (w, e) => e.phase !== 2,
      start(w, e) { e.pose = 'wind'; const k = e.vars.wm; e.vars.a = aim(e); e.vars.at = 0.6 * k; line(w, e, e.x, e.y, e.vars.a, 420, 22, e.vars.at, 0, true); tell(w, e, 'crown'); },
      update(w, e, dt, t) {
        const v = e.vars, sp = 520, life = 420 / sp;
        if (!v.out && t >= v.at) { v.out = w.enemyShoot(e, v.a, sp, 'orb', 1.1, 10, { life }); e.pose = 'cast'; }
        if (v.out && !v.back && t >= v.at + life) {
          const q = v.out, a = Math.atan2(e.y - q.y, e.x - q.x), d = Math.hypot(e.x - q.x, e.y - q.y);
          v.back = w.spawnProj({ team: 1, kind: 'orb', x: q.x, y: q.y, a, speed: q.vx || q.vy ? Math.hypot(q.vx, q.vy) : sp, r: 10, dmg: e.dmg * 1.1, life: Math.max(0.2, d / sp), src: e });
          q.dead = true;
        }
        return !!v.back && t >= v.at + life + 0.6;
      },
    },
    blink: {
      w: 2, ok: (w, e) => e.phase !== 2,
      start(w, e) { e.vars.n = e.phase >= 3 ? 2 : 1; e.vars.i = 0; e.vars.next = 0; },
      update(w, e, dt, t) {
        const k = e.vars.wm;
        if (e.vars.i < e.vars.n && t >= e.vars.next && !e.vars.pending) {
          const p = e.target, pt = Sim.castMove(w.room, p.x, p.y, w.rng.range(0, TAU), 70, e.r, true);
          e.vars.pending = { x: pt.x, y: pt.y, at: t + 0.6 * k };
          e.pose = 'fade';
          w.addZone({ kind: 'tele', x: pt.x, y: pt.y, r: e.r + 6, dur: 0.6 * k, dmg: 0, team: 1, src: e, warnOnly: true });
          tell(w, e, 'blink', pt.x, pt.y);
        }
        const pd = e.vars.pending;
        if (pd && t >= pd.at && !pd.done) {
          pd.done = true;
          w.emit({ t: 'blinkfx', x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(pd.x), y1: Math.round(pd.y) });
          e.x = pd.x; e.y = pd.y; e.pose = 'wind';
          cone(w, e, aim(e), 125, 2.0, 0.55 * k, 1.4, () => { e.pose = 'slam'; });
          pd.end = t + 0.2 + 0.55 * k;
        }
        if (pd && pd.done && t >= pd.end) { e.vars.pending = null; e.vars.i++; e.vars.next = t + 0.2; }
        return e.vars.i >= e.vars.n && !e.vars.pending;
      },
    },
    // Phase 2 hunt: the King fades out and steps from the dark beside the hunted hero (a bright ring marks the spot for the whole wind-up), then cleaves.
    stalk: {
      w: 4, ok: (w, e) => e.phase === 2 && !!prey(w),
      start(w, e) {
        const p = prey(w), k = e.vars.wm;
        e.target = p; e.pose = 'fade';
        const pt = Sim.castMove(w.room, p.x, p.y, Math.atan2(e.y - p.y, e.x - p.x) + w.rng.range(-0.8, 0.8), 64, e.r, true);
        e.vars.pt = pt; e.vars.at = 0.9 * k;
        w.addZone({ kind: 'tele', x: pt.x, y: pt.y, r: e.r + 8, dur: e.vars.at, dmg: 0, team: 1, src: e, warnOnly: true });
        tell(w, e, 'stalk', pt.x, pt.y);
      },
      update(w, e, dt, t) {
        const v = e.vars;
        if (!v.done && t >= v.at) {
          v.done = true;
          w.emit({ t: 'blinkfx', x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(v.pt.x), y1: Math.round(v.pt.y) });
          e.x = v.pt.x; e.y = v.pt.y; e.pose = 'wind';
          cone(w, e, aim(e), 130, 2.2, 0.5 * v.wm, 1.5, () => { e.pose = 'slam'; });
          v.end = t + 0.5 * v.wm + 0.25;
        }
        return !!v.done && t >= v.end;
      },
    },
    orbs: {
      w: 2, ok: (w, e) => e.phase === 2,
      start(w, e) { e.pose = 'cast'; tell(w, e, 'orbs'); },
      update(w, e, dt, t) {
        if (!e.vars.fired && t > 0.5 * e.vars.wm) {
          e.vars.fired = true;
          const n = 6, a0 = aim(e);
          for (let i = 0; i < n; i++) w.enemyShoot(e, a0 + (i - (n - 1) / 2) * (TAU / n), 95, 'orb', 0.9, 9, { homing: 1.1, life: 6 });
        }
        return t > 0.7 + 0.5 * e.vars.wm;
      },
    },
    nova: {
      w: 1, phase: 2,
      start(w, e) { e.pose = 'cast'; tell(w, e, 'nova'); },
      update(w, e, dt, t) {
        const k = e.vars.k || 0;
        if (k < 3 && t > 0.6 * e.vars.wm + k * 0.5) { ring(w, e, 16, 110, 'void', (k % 2) * TAU / 32, 0.6, 7); e.vars.k = k + 1; }
        return t > 2.2;
      },
    },
    // Phase 3: four beams turn around the King after a warm-up.
    laser: {
      w: 3, phase: 3,
      start(w, e) {
        e.pose = 'wind';
        const k = e.vars.wm, warm = 1.0 * k, a0 = aim(e) + Math.PI / 4, dir = w.rng.sign();
        e.vars.warm = warm;
        for (let i = 0; i < 4; i++) {
          const a = a0 + i * TAU / 4;
          line(w, e, e.x, e.y, a, 760, 16, warm, 0, true);
          w.addZone({ kind: 'laser', x: e.x, y: e.y, a, len: 760, w: 16, warm, dur: warm + 2.4, dmg: e.dmg * 0.7, team: 1, src: e,
            update: (ww, z, ddt) => { z.x = e.x; z.y = e.y; if (z.t > z.warm) z.a += dir * 0.75 * ddt; } });
        }
        tell(w, e, 'laser');
      },
      update(w, e, dt, t) { if (t > e.vars.warm) e.pose = 'cast'; return t > e.vars.warm + 2.5; },
    },
    // Phase 3: stars fall on and around every hero (staggered landing circles), more once the last ring is gone.
    starfall: {
      w: 3, phase: 3,
      start(w, e) {
        e.pose = 'cast';
        const k = e.vars.wm, ar = w.room.arena, late = ar && (ar.fallen | 0) >= CRUMBLE.at.length, n = late ? 5 : 3;
        for (const p of w.alivePlayers()) for (let j = 0; j < n; j++) {
          const pt = j ? Sim.castMove(w.room, p.x, p.y, w.rng.range(0, TAU), w.rng.range(40, 110), 8, true) : { x: p.x, y: p.y };
          if (D.tileAt(w.room, pt.x, pt.y) === 3) continue;
          drop(w, e, pt.x, pt.y, 36, (0.9 + j * 0.2) * k, 1.0, 'shadow');
        }
        tell(w, e, 'starfall');
      },
      update(w, e, dt, t) { return t > 1.9 * e.vars.wm; },
    },
  }, { idle: approach(110), phases: [0.6, 0.3], tick, onPhase, pauseMul });
})(globalThis.ED || (globalThis.ED = {}));
