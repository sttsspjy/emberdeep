// Boss 'twins' (The Twins): the Lancer (ED.FOES.twins, the spawned boss) and the Hammer ('twinhammer', added by the spawn hook) share the boss HP half and half and one phase clock (combined HP).
// Lancer: thrust (a warned lane, then a dash along it; twice from phase 2), sweep (cone). Hammer: slam (cone + shard ring), leap (lands on a warned circle + shard ring), quake (a stepping line of
// circle warnings; three lines from phase 2). Every TW.combo s while both stand and idle they act together: the Lancer reels heroes in (warned ring, then a pull) or binds a hero's ground
// (warned circle, then a slowing web) and the Hammer lands on that spot. A fallen twin rises at TW.reviveHp of its health after TW.revive s (a warned revive circle) unless the survivor falls
// first; the survivor rages meanwhile (x TW.rage.dmg damage, shorter pauses). The fight ends when both are down at once.
(function (ED) {
  'use strict';
  const U = ED.U, B = ED.Bosses, L = B.lib, TAU = U.TAU, DT = ED.CONST.TICK;
  const { line, cone, tele, aim, dist, mv } = L;
  const TW = B.TWINS = {
    revive: 8, reviveHp: 0.5, rage: { pause: 0.55, dmg: 1.25 }, combo: [[8, 10], [6, 7.5]],
    thrust: { len: 300, wind: 0.7, wind2: 0.6, speed: 368, dur: 0.6, rest: 0.35, mul: 1.2 }, // second thrust (phase 2) warns wind2 s
    sweep: { r: 108, arc: 2.4, wind: 0.65, mul: 1.2, near: 150 },
    reel: { r: 220, wind: 1.0, step: 170, dur: 0.7 }, // pull speed px/s
    bind: { r: 46, wind: 0.8, dur: 1.5, slow: 0.88, mul: 0.5 },
    slam: { r: 135, arc: 2.0, wind: 0.75, mul: 1.4, n: [10, 14], speed: 128, smul: 0.6, near: 170 },
    leap: { fl: 1.38, r: 85, mul: 1.3, n: 8, speed: 136, smul: 0.6 },
    quake: { n: 6, step: 42, r: 30, wind: 0.7, inc: 0.08, mul: 1.0, fan: 0.4 },
  };
  ED.addFoe('twinhammer', { name: 'Twin Hammer', look: 'foe.skelknight', ai: 'boss', boss: true, hp: 0, spd: 38, dmg: 2, r: 18, xp: 25, kb: 0, noElite: true });

  // Pair P = { L, Lid, H, Hid (bodies), half (max HP each), dmg (base damage), comboT, combo, phase, rev (revive zone), revId }.
  const up = (P, k) => { const f = P[k]; return f && !f.dead && f.id === P[k + 'id'] ? f : null; };
  const frac = (w, e) => {
    const P = e.vars && e.vars.pair; if (!P) return e.hp / e.maxHp;
    const a = up(P, 'L'), b = up(P, 'H');
    return ((a ? Math.max(0, a.hp) : 0) + (b ? Math.max(0, b.hp) : 0)) / (2 * P.half);
  };

  // ---------- Lancer ----------
  // Warns the thrust lane toward the target (wind s); the dash follows.
  const aimThrust = (w, e, s, wind, t) => { s.a = aim(e); s.hit = []; s.go = t + wind; s.sub = 'wind'; line(w, e, e.x, e.y, s.a, TW.thrust.len, e.r * 2, wind, 0, { followSrc: true }); };
  const LANCE = {
    thrust: {
      w: 3, wind: TW.thrust.wind,
      start(w, e) { const s = e.vars.s; s.n = e.vars.phase >= 2 ? 2 : 1; s.k = 0; aimThrust(w, e, s, TW.thrust.wind, 0); },
      update(w, e, dt, t) {
        const s = e.vars.s, q = TW.thrust;
        if (s.sub === 'wind') { e.st = 1; if (t >= s.go) s.sub = 'dash'; return false; }
        if (s.sub === 'dash') {
          e.st = 2;
          const blocked = mv(w, e, Math.cos(s.a), Math.sin(s.a), q.speed, dt);
          L.ram(w, e, s.hit, e.dmg * q.mul, 4);
          if (blocked || t >= s.go + q.dur) { if (++s.k < s.n) aimThrust(w, e, s, q.wind2, t); else { s.sub = 'rest'; s.go = t + q.rest; } }
          return false;
        }
        e.st = 0;
        return t >= s.go;
      },
    },
    sweep: {
      w: 2, wind: TW.sweep.wind, ok: (w, e) => dist(e) < TW.sweep.near,
      start(w, e) { const q = TW.sweep; cone(w, e, aim(e), q.r, q.arc, q.wind, q.mul); },
      update: (w, e, dt, t) => t >= TW.sweep.wind + 0.35,
    },
    // Combo: a warned ring around the Lancer, then a pull drags heroes within it toward him.
    reel: {
      w: 0, wind: TW.reel.wind,
      start(w, e) { tele(w, e, e.x, e.y, TW.reel.r, TW.reel.wind, 0, { followSrc: true, look: 'pull' }); },
      update(w, e, dt, t) {
        const s = e.vars.s, q = TW.reel;
        if (!s.done && t >= q.wind) { s.done = true; w.zone({ team: 1, look: 'pull', x: e.x, y: e.y, r: q.r, dur: q.dur, src: e, followSrc: true, onTick: (ww, z) => { const f = z.src; if (f.dead || f.id !== z.srcId) { z.dead = true; return; } L.pull(ww, z.x, z.y, z.r, q.step * DT); } }); }
        return t >= q.wind + q.dur + 0.2;
      },
    },
    // Combo: a warned circle under a hero, then the ground binds (walking x (1 - slow) for dur s; a dash still leaves).
    bind: {
      w: 0, wind: TW.bind.wind,
      start(w, e) {
        const s = e.vars.s, q = TW.bind, f = s.fq || e.tgt || e;
        tele(w, e, f.x, f.y, q.r, q.wind, q.mul, { look: 'bind', onEnd: (ww, z) => ww.zone({ team: 1, look: 'bind', x: z.x, y: z.y, r: q.r, dur: q.dur, onTick: (w2, z2) => { for (const p of w2.living) if (U.dist2(p.x, p.y, z2.x, z2.y) <= z2.r * z2.r) L.slowHero(p, q.slow, 0.1); } }) });
      },
      update: (w, e, dt, t) => t >= TW.bind.wind + 0.3,
    },
  };

  // ---------- Hammer ----------
  // Leap to s.fq (or the target): the landing circle warns for the whole flight; impact sends a shard ring. e.st 4 while airborne.
  const leapStart = (w, e, q) => {
    const s = e.vars.s, f = s.fq || e.tgt || e, pt = L.inside(w, f.x, f.y, e.r + 4, {});
    s.fx = e.x; s.fy = e.y; s.tx = pt.x; s.ty = pt.y; s.fl = (s.fq && s.fq.fl) || q.fl; s.landed = false;
    tele(w, e, pt.x, pt.y, (s.fq && s.fq.r) || q.r, s.fl, q.mul, { look: 'quake', onEnd: (ww) => { L.ringAt(ww, e, pt.x, pt.y, q.n, q.speed, 'orb', ww.rng.next(), q.smul, 5); } });
  };
  const leapStep = (w, e, t) => { const s = e.vars.s; if (!L.leapTo(w, e, s, t)) { e.st = 4; return false; } e.st = 0; return t >= s.fl + 0.45; };
  // Abort (phase change): an airborne Hammer lands at once on its warned spot.
  const leapEnd = (w, e) => { const s = e.vars.s; if (s && s.tx !== undefined && !s.landed) { e.x = s.tx; e.y = s.ty; s.landed = true; } ED.Arena.collide(w.arena, e, e.r); };
  const HAMMER = {
    slam: {
      w: 3, wind: TW.slam.wind, ok: (w, e) => dist(e) < TW.slam.near,
      start(w, e) {
        const q = TW.slam, n = q.n[Math.min(2, e.vars.phase) - 1];
        cone(w, e, aim(e), q.r, q.arc, q.wind, q.mul, { look: 'quake', onEnd: (ww) => L.ring(ww, e, n, q.speed, 'orb', ww.rng.next(), q.smul, 5) });
      },
      update: (w, e, dt, t) => t >= TW.slam.wind + 0.4,
    },
    leap: { w: 2, wind: TW.leap.fl, start(w, e) { leapStart(w, e, TW.leap); }, update: (w, e, dt, t) => leapStep(w, e, t), end: leapEnd },
    // Combo: lands on the spot the Lancer marked (fq: { x, y, fl, r }).
    crush: { w: 0, wind: TW.leap.fl, start(w, e) { leapStart(w, e, TW.leap); }, update: (w, e, dt, t) => leapStep(w, e, t), end: leapEnd },
    quake: {
      w: 2, wind: TW.quake.wind,
      start(w, e) {
        const q = TW.quake, a0 = aim(e), fan = e.vars.phase >= 2 ? 1 : 0;
        for (let f = -fan; f <= fan; f++) {
          const a = a0 + f * q.fan;
          for (let i = 1; i <= q.n; i++) {
            const x = e.x + Math.cos(a) * (e.r + i * q.step), y = e.y + Math.sin(a) * (e.r + i * q.step);
            if (ED.Arena.blocked(w.arena, x, y, 2)) break;
            tele(w, e, x, y, q.r, q.wind + i * q.inc, q.mul, { look: 'quake', detached: true });
          }
        }
      },
      update: (w, e, dt, t) => t >= TW.quake.wind + TW.quake.n * TW.quake.inc + 0.4,
    },
  };

  // ---------- the pair: rage, spacing, combos ----------
  function tick(w, e, dt) {
    const v = e.vars, P = v.pair; if (!P) return;
    const a = up(P, 'L'), b = up(P, 'H'), alone = !(a && b);
    e.dmg = P.dmg * (alone ? TW.rage.dmg : 1) * (e.enraged ? 3 : 1);
    v.rage = alone ? TW.rage.pause : 1;
    if (alone || e !== a) return;
    // keep the two bodies apart (bosses skip the horde separation)
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, m = a.r + b.r;
    if (d < m && b.vars.st !== 'atk') { const k = (m - d) / 2; ED.Arena.move(w.arena, a, -dx / d * k, -dy / d * k, a.r); ED.Arena.move(w.arena, b, dx / d * k, dy / d * k, b.r); }
    if ((P.comboT -= dt) > 0 || v.st !== 'idle' || b.vars.st !== 'idle' || v.force || b.vars.force) return;
    const p = a.tgt || w.nearestHero(a.x, a.y); if (!p) return;
    const cr = TW.combo[Math.min(2, P.phase) - 1];
    P.comboT = w.rng.range(cr[0], cr[1]);
    if (P.combo++ % 2 === 0) { // reel: the pull drags heroes to the Lancer, the Hammer lands in front of him as it ends
      const ang = Math.atan2(p.y - a.y, p.x - a.x), pt = L.inside(w, a.x + Math.cos(ang) * 46, a.y + Math.sin(ang) * 46, b.r + 4, {});
      L.force(a, 'reel'); L.force(b, 'crush', { x: pt.x, y: pt.y, fl: 1.6, r: 95 });
    } else { // bind: the hero's ground binds, the Hammer lands there while it holds
      L.force(a, 'bind', { x: p.x, y: p.y }); L.force(b, 'crush', { x: p.x, y: p.y, fl: 1.5, r: 80 });
    }
  }
  function onPhase(w, e, ph) { const P = e.vars.pair; if (P && ph > P.phase) P.phase = ph; }
  const phaseEv = (w, e, ph) => { const P = e.vars.pair; return !P || ph > P.phase; }; // one phase event per pair

  // Spawn hook (the Lancer): halves its HP and brings the Hammer in beside it.
  function spawn(w, e) {
    const half = Math.max(1, Math.round(e.maxHp / 2));
    e.maxHp = e.hp = half;
    let x = e.x + 70, y = e.y;
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; x = e.x + Math.cos(a) * 70; y = e.y + Math.sin(a) * 70; if (!ED.Arena.blocked(w.arena, x, y, 20)) break; }
    const h = w.spawnFoe('twinhammer', x, y);
    h.maxHp = h.hp = half; h.final = e.final;
    const P = { L: e, Lid: e.id, H: h, Hid: h.id, half, dmg: e.dmg, comboT: TW.combo[0][0], combo: 0, phase: 1, rev: null, revId: 0 };
    const va = L.vars(e), vb = L.vars(h);
    va.pair = vb.pair = P; va.role = 'L'; vb.role = 'H'; vb.t = 1.8;
    w.addBossBody(h);
  }
  // A fallen twin rises at (x, y).
  function rise(w, P, role, x, y) {
    P.rev = null;
    const f = w.spawnFoe(role === 'L' ? 'twins' : 'twinhammer', x, y);
    if (!f) return;
    f.maxHp = P.half; f.hp = Math.max(1, Math.round(P.half * TW.reviveHp)); f.hpQ = Math.round(255 * f.hp / f.maxHp); f.dmg = P.dmg; f.invulnT = 0.6;
    const o = up(P, role === 'L' ? 'H' : 'L'); if (o) f.final = o.final;
    const v = L.vars(f); v.pair = P; v.role = role; v.phase = P.phase; v.t = 1.0;
    P[role] = f; P[role + 'id'] = f.id;
    w.addBossBody(f);
    w.emit({ t: 'boss', id: 'twins', fid: f.id, phase: 'rise' });
  }
  // Kill hook: with the partner standing, a revive circle starts (false keeps the fight going); both down ends it.
  function kill(w, e) {
    const P = e.vars && e.vars.pair; if (!P) return true;
    const role = e.vars.role, other = up(P, role === 'L' ? 'H' : 'L');
    if (!other || other.hp <= 0) return true;
    const pt = L.inside(w, e.x, e.y, e.r + 4, {});
    const z = tele(w, other, pt.x, pt.y, 28, TW.revive, 0, { look: 'revive', onEnd: (ww) => rise(ww, P, role, pt.x, pt.y) });
    P.rev = z; P.revId = z.id;
    w.emit({ t: 'boss', id: 'twins', fid: e.id, phase: 'fall' });
    return false;
  }
  function bar(w, e, b) {
    const P = e.vars && e.vars.pair; if (!P) return;
    const f = frac(w, e);
    b.id = 'twins'; b.name = 'The Twins'; b.q = f > 0 ? Math.max(1, Math.round(255 * f)) : 0; b.phase = P.phase;
    b.n = (up(P, 'L') ? 1 : 0) + (up(P, 'H') ? 1 : 0);
    b.rev = P.rev && !P.rev.dead && P.rev.id === P.revId ? Math.min(1, P.rev.t / P.rev.dur) : -1;
  }

  const common = { phases: [0.5], frac, tick, onPhase, phaseEv, kill, bar, pause: [1.0, 0.75] };
  B.twins = L.runner(LANCE, Object.assign({ idle: L.approach(80), spawn }, common));
  B.twinhammer = L.runner(HAMMER, Object.assign({ idle: L.approach(60) }, common));
})(globalThis.ED || (globalThis.ED = {}));
