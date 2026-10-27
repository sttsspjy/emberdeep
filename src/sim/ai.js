// Foe brains: ED.AI[name] = fn(w, e, dt), called by updateFoes for a foe with a living target (e.tgt) that is not stunned, frozen or rushing.
// Open arena: straight-line steering (obstacles slide via ED.Arena.move), no line of sight. State: e.st (0 move, 1 wind-up, 2 act), e.stT (s in state), e.acd (attack cooldown), e.aa (locked angle).
// Telegraph rule: every attack beyond contact shows a warn zone (team 1, >= 0.6 s) for its whole wind-up and resolves from the brain at the wind-up end with the aim locked at its start;
// the zone itself carries no damage, dies with its caster and is dropped when a stun or freeze cancels the attack (w.foeCancel). Ranged attacks start only on the target's screen.
// Elites widen attacks (shape, not numbers): ranged +2 shots (ring x1.5), charge / dive x1.35 longer, slam x1.5 radius plus a shot ring. Kinds: GAME-DESIGN §7.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const AI = ED.AI = {};
  const VX = ED.CONST.VIEW_W / 2 - 20, VY = ED.CONST.VIEW_H / 2 - 14; // on-screen box around the target

  const onScreen = (e, t) => Math.abs(e.x - t.x) <= VX && Math.abs(e.y - t.y) <= VY;
  // Scratch zone options (w.zone copies every field): one telegraph per attack start, no allocation.
  const Z = { team: 1, warn: true, dmg: 0, x: 0, y: 0, r: 0, a: 0, len: 0, w: 0, arc: 0, dur: 0.6, src: null, followSrc: false, look: 'tele' };
  const warn = (w, e, x, y, r, a, len, wd, arc, dur, follow) => {
    Z.x = x; Z.y = y; Z.r = r; Z.a = a; Z.len = len; Z.w = wd; Z.arc = arc; Z.dur = Math.max(0.6, dur); Z.src = e; Z.followSrc = follow;
    const z = w.zone(Z); Z.src = null;
    e.tz = z; e.tzId = z.id;
    return z;
  };
  const W6 = (wind) => Math.max(0.6, wind); // wind-up as shown: never under the 0.6 s telegraph minimum
  const start = (e, wind) => { e.st = 1; e.stT = 0; return W6(wind); };
  const ELITE_RING = { n: 8, speed: 120, look: 'orb', dmg: 6 }; // shot ring an elite brute's slam adds when its def has none
  const done = (w, e, cd) => { e.st = 0; e.stT = 0; e.tz = null; e.acd = cd * w.rng.range(0.85, 1.15); };
  const faceTo = (e, x) => { if (x < e.x - 0.5) e.face = -1; else if (x > e.x + 0.5) e.face = 1; };
  // Straight dash along e.aa at speed px/s (slow applies); true when it hit an obstacle or the bounds.
  const dash = (w, e, speed, dt) => {
    const v = speed * (e.slowT > 0 ? 1 - e.slowK : 1);
    e.vx = Math.cos(e.aa) * v; e.vy = Math.sin(e.aa) * v; faceTo(e, e.x + e.vx);
    return !!ED.Arena.move(w.arena, e, e.vx * dt, e.vy * dt, e.r);
  };

  // Chaser (and splitter): straight at the nearest hero.
  AI.chaser = (w, e, dt) => { w.steer(e, e.tgt.x, e.tgt.y, 1, dt); };

  // Swarmer: straight at the nearest hero with a sideways wobble (packs spread instead of stacking in a line).
  AI.swarm = (w, e, dt) => {
    const t = e.tgt, a = Math.atan2(t.y - e.y, t.x - e.x) + Math.sin(e.age * 3 + e.id * 1.7) * 0.6;
    w.steer(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, 1, dt);
  };

  // Brute: slow walker; in reach it plants and slams a circle around itself (def.slam); some slams also throw a shot ring.
  AI.brute = (w, e, dt) => {
    const S = e.def.slam, t = e.tgt;
    if (!S) { AI.chaser(w, e, dt); return; }
    const R = S.r * (e.elite ? 1.5 : 1);
    if (e.st === 1) {
      e.stT += dt;
      if (e.stT >= W6(S.wind)) {
        w.foeBlast(e, e.x, e.y, R, e.dmg * S.mul, 'shock');
        const ring = S.ring || (e.elite ? ELITE_RING : null);
        if (ring) { const n = ring.n, off = w.rng.next() * TAU, d = ring.dmg * w.foeDmgK() * (e.elite ? 1.5 : 1); for (let i = 0; i < n; i++) w.foeShoot(e, off + i * TAU / n, ring.speed, ring.look, d, 5); }
        done(w, e, S.cd);
      }
      return;
    }
    e.acd -= dt;
    const d = w.steer(e, t.x, t.y, 1, dt);
    if (e.acd <= 0 && d < R * 0.75 + t.r) warn(w, e, e.x, e.y, R, 0, 0, 0, 0, start(e, S.wind), true);
  };

  // Ranged: holds def.range from the target (closes in, backs off, strafes), then a telegraphed shot: aim line (one shot), cone (fan) or circle (ring).
  AI.ranged = (w, e, dt) => {
    const S = e.def.shot, t = e.tgt, ring = S.spread === 'ring';
    if (e.st === 1) {
      e.stT += dt; faceTo(e, t.x);
      if (e.stT >= W6(S.wind)) {
        const dmg = S.dmg * w.foeDmgK() * (e.elite ? 1.5 : 1);
        if (ring) { const n = e.elite ? Math.round(S.n * 1.5) : S.n; for (let i = 0; i < n; i++) w.foeShoot(e, e.aa + i * TAU / n, S.speed, S.look, dmg, 4); }
        else { const n = S.n + (e.elite ? 2 : 0), sp = S.spread || 0.2; for (let i = 0; i < n; i++) w.foeShoot(e, e.aa + (i - (n - 1) / 2) * sp, S.speed, S.look, dmg, 4); }
        done(w, e, S.cd);
      }
      return;
    }
    e.acd -= dt;
    const dx = t.x - e.x, dy = t.y - e.y, d = Math.hypot(dx, dy) || 1, R = e.def.range || 160, vis = onScreen(e, t);
    if (d > R + 20 || !vis) w.steer(e, t.x, t.y, 1, dt);
    else if (d < R - 50) w.steer(e, e.x - dx, e.y - dy, 0.7, dt);
    else { const s = (e.id & 1) ? 1 : -1; w.steer(e, e.x - dy / d * 50 * s, e.y + dx / d * 50 * s, 0.35, dt); }
    faceTo(e, t.x);
    if (e.acd > 0 || !vis || d > R + 70) return;
    e.aa = Math.atan2(dy, dx);
    const dur = start(e, S.wind), n = S.n + (e.elite ? 2 : 0);
    if (ring) warn(w, e, e.x, e.y, e.r + 30, 0, 0, 0, 0, dur, true);
    else if (n > 1) warn(w, e, e.x, e.y, Math.min(d + 40, 240), e.aa, 0, 0, (S.spread || 0.2) * (n - 1) + 0.2, dur, true);
    else warn(w, e, e.x, e.y, 0, e.aa, Math.min(d + 60, 280), 8, 0, dur, true);
  };

  // Exploder: rushes in with a wobble; on contact range it stops, shows its blast circle for def.fuse s and bursts (killing it first cancels the blast).
  AI.exploder = (w, e, dt) => {
    const B = e.def.boom, t = e.tgt, R = B.r * (e.elite ? 1.5 : 1);
    if (e.st === 1) {
      e.stT += dt;
      if (e.stT >= W6(e.def.fuse || 0.7)) {
        w.foeBlast(e, e.x, e.y, R, B.dmg * w.foeDmgK() * (e.elite ? 1.5 : 1), B.look);
        e.tz = null;
        w.killFoe(e, null);
      }
      return;
    }
    const a = Math.atan2(t.y - e.y, t.x - e.x) + Math.sin(e.age * 4 + e.id) * 0.3;
    w.steer(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, 1, dt);
    const rr = e.r + t.r + 20;
    if ((t.x - e.x) * (t.x - e.x) + (t.y - e.y) * (t.y - e.y) < rr * rr) { e.vx = e.vy = 0; warn(w, e, e.x, e.y, R, 0, 0, 0, 0, start(e, e.def.fuse || 0.7), true); }
  };

  // Charger: chases; in range it plants, shows its charge lane, then dashes straight along it (contact hurts on the way) and stops early at an obstacle.
  AI.charger = (w, e, dt) => {
    const C = e.def.charge, t = e.tgt, dur = C.dur * (e.elite ? 1.35 : 1);
    if (e.st === 1) { e.stT += dt; if (e.stT >= W6(C.wind)) { e.st = 2; e.stT = 0; e.cd = 0; e.tz = null; } return; }
    if (e.st === 2) { e.stT += dt; if (dash(w, e, C.speed, dt) || e.stT >= dur) done(w, e, C.cd); return; }
    e.acd -= dt;
    const d = w.steer(e, t.x, t.y, 1, dt);
    if (e.acd <= 0 && d > 50 && d < C.range && onScreen(e, t)) {
      e.aa = Math.atan2(t.y - e.y, t.x - e.x); e.vx = e.vy = 0;
      warn(w, e, e.x, e.y, 0, e.aa, C.speed * dur + e.r, e.r * 2 + 6, 0, start(e, C.wind), true);
    }
  };

  // Diver: circles the target at def.dive.hover px (direction by id parity), then shows a lane and dives through the target's spot.
  AI.diver = (w, e, dt) => {
    const V = e.def.dive, t = e.tgt, dur = V.dur * (e.elite ? 1.35 : 1);
    if (e.st === 1) { e.stT += dt; faceTo(e, t.x); if (e.stT >= W6(V.wind)) { e.st = 2; e.stT = 0; e.cd = 0; e.tz = null; } return; }
    if (e.st === 2) { e.stT += dt; if (dash(w, e, V.speed, dt) || e.stT >= dur) done(w, e, V.cd); return; }
    e.acd -= dt;
    const dx = e.x - t.x, dy = e.y - t.y, d = Math.hypot(dx, dy) || 1, s = (e.id & 1) ? 1 : -1, k = U.clamp((d - V.hover) / 40, -1, 1);
    const mx = -dy / d * s - dx / d * k, my = dx / d * s - dy / d * k;
    w.steer(e, e.x + mx * 60, e.y + my * 60, 1, dt);
    faceTo(e, t.x);
    if (e.acd <= 0 && d < V.range && d > 50 && onScreen(e, t)) {
      e.aa = Math.atan2(-dy, -dx); e.vx = e.vy = 0;
      warn(w, e, e.x, e.y, 0, e.aa, V.speed * dur + e.r, e.r * 2 + 4, 0, start(e, V.wind), true);
    }
  };

  // Bosses: ED.Bosses[def.id](w, e, dt) (src/sim/bosses.js runner), chaser when the boss has no script.
  AI.boss = (w, e, dt) => { const b = ED.Bosses[e.def.id]; if (typeof b === 'function') b(w, e, dt); else AI.chaser(w, e, dt); };
})(globalThis.ED || (globalThis.ED = {}));
