// Boss 'king' (Drowned King, stage 2 mid-boss) and ED.Bosses.libB, the hazard helpers shared by boss-hollow.js, boss-cyclops.js and boss-samurai.js (they load after this file).
// P1: Tidal Beam (one beam sweeps the aim arc; obstacles cut it), trident fan, leap slam, telegraphed adds. P2 (66%): two opposite beams, 5 tridents, the whirlpool (pull + core).
// P3 (33%): a standing whirlpool follows the King for the rest of the fight, beams turn a half circle each (a full spin between the two), more adds.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU, B = ED.Bosses, DT = C.TICK;
  const { tele, line, cone, ring, aim, approach, runner } = B.lib;
  ED.regLook('tidebeam', 'whirlpool', 'waterorb', 'summon');

  // ---------- libB ----------
  // Telegraph length: s x 0.8 while enraged, never under the 0.6 s floor.
  const T = (e, s) => Math.max(0.6, s * (e.enraged ? 0.8 : 1));
  // Hazard zone tick (every frame): dies with its caster, runs st.upd(w, z, e, st), then once z.t >= st.arm hurts living heroes touching it (st.test(w, z, p) or the zone shape) for e.dmg x st.mul.
  const hzTick = (w, z) => {
    const e = z.src, st = z.st;
    if (!e || e.dead || e.id !== z.srcId) { z.dead = true; return; }
    if (st.upd) st.upd(w, z, e, st);
    if (z.dead || z.t < st.arm || !(st.mul > 0)) return;
    const L = w.living, dmg = e.dmg * st.mul;
    for (let i = 0; i < L.length; i++) { const p = L[i]; if (st.test ? st.test(w, z, p) : w.zoneHas(z, p.x, p.y, p.r * 0.7)) w.hurtHero(p, dmg, z); }
  };
  // Live hostile hazard (not a telegraph): zone fields o ({ look, x, y, r, a, len, w, arc, dur }); look doubles as wid so ED.SkillFx[look] draws it. st: { mul, arm, upd, test, ...state }.
  const hz = (w, e, o, st) => {
    st.mul = st.mul || 0; st.arm = st.arm || 0; st.upd = st.upd || null; st.test = st.test || null;
    return w.zone({ team: 1, look: o.look, wid: o.look, x: o.x !== undefined ? o.x : e.x, y: o.y !== undefined ? o.y : e.y, r: o.r || 0, a: o.a || 0, len: o.len || 0, w: o.w || 0, arc: o.arc || 0, dur: o.dur || 1, src: e, st, onTick: hzTick });
  };
  // Length of a ray from (x, y) along a until an obstacle or the arena edge (6 px steps), at most max.
  const rayLen = (w, x, y, a, max) => {
    const A = w.arena, c = Math.cos(a), s = Math.sin(a);
    for (let d = 12; d < max; d += 6) if (ED.Arena.blocked(A, x + c * d, y + s * d, 1)) return d;
    return max;
  };
  // A free spot for a body of radius r at (x, y), else the nearest free one on rings around it; null when none.
  const spot = (w, x, y, r) => {
    const A = w.arena, m = r + 24;
    x = U.clamp(x, m, A.size - m); y = U.clamp(y, m, A.size - m);
    if (!ED.Arena.blocked(A, x, y, r)) return { x, y };
    for (let d = r * 1.5; d <= r * 6; d += r) for (let k = 0; k < 12; k++) {
      const a = k / 12 * TAU, px = U.clamp(x + Math.cos(a) * d, m, A.size - m), py = U.clamp(y + Math.sin(a) * d, m, A.size - m);
      if (!ED.Arena.blocked(A, px, py, r)) return { x: px, y: py };
    }
    return null;
  };
  // Telegraphed adds: a 'summon' circle per add on a ring of radius rad around e, the foe appears when it resolves (none if the boss died first). One extra add per hero beyond the first (max 3).
  const spawnAdd = (w, z) => { if (ED.FOES[z.st] && !ED.Arena.blocked(w.arena, z.x, z.y, 8)) w.spawnFoe(z.st, z.x, z.y); };
  const adds = (w, e, ids, rad, dur) => {
    ids = ids.filter(id => ED.FOES[id]);
    if (!ids.length) return 0;
    const n = ids.length + Math.min(3, w.partyN - 1), a0 = w.rng.next() * TAU;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * TAU, x = e.x + Math.cos(a) * rad, y = e.y + Math.sin(a) * rad;
      if (ED.Arena.blocked(w.arena, x, y, 8)) continue;
      tele(w, e, x, y, 12, T(e, dur), 0, { look: 'summon', wid: 'summon', st: ids[i % ids.length], onEnd: spawnAdd }); k++;
    }
    return k;
  };
  // Pulls living, non-dashing heroes within r toward (x, y): str px/s at the centre, half at the rim (obstacles still block).
  const pull = (w, x, y, r, str, dt) => {
    const L = w.living;
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (p.dashT > 0) continue;
      const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
      if (d > r || d < 3) continue;
      const k = str * dt * (1 - 0.5 * d / r) / d;
      ED.Arena.move(w.arena, p, dx * k, dy * k, p.r);
    }
  };
  // Foe shot tagged with its look as wid (ED.WeaponFx[look] draws it). o: { life, fly (passes obstacles), tick(w, pr, dt), st }.
  const shot = (w, e, a, speed, look, mul, r, o) => {
    const pr = w.foeShoot(e, a, speed, look, e.dmg * mul, r);
    pr.wid = look;
    if (o) { if (o.life) pr.life = o.life; if (o.fly) pr.solid = false; if (o.tick) { pr.tick = o.tick; pr.st = o.st || null; } }
    return pr;
  };
  // Leap: e flies from its spot to (tx, ty) over fl s (ease in-out) after start(); returns true on the landing tick.
  const leapTo = (e, s, t) => {
    if (s.landed) return false;
    const q = U.easeInOut(Math.min(1, t / s.fl));
    e.x = U.lerp(s.fx, s.tx, q); e.y = U.lerp(s.fy, s.ty, q); e.face = s.tx >= s.fx ? 1 : -1;
    if (q >= 1) { s.landed = true; return true; }
    return false;
  };
  // Sets up a telegraphed leap onto the target's spot (landing circle r, x mul damage); s gets { fx, fy, tx, ty, fl }.
  const leapStart = (w, e, s, r, fl, mul) => {
    const t = e.tgt, pt = (t && spot(w, t.x, t.y, e.r)) || { x: e.x, y: e.y };
    s.fx = e.x; s.fy = e.y; s.tx = pt.x; s.ty = pt.y; s.fl = T(e, fl); s.landed = false;
    tele(w, e, pt.x, pt.y, r, s.fl, mul);
  };
  B.libB = { T, hz, rayLen, spot, adds, pull, shot, leapStart, leapTo };

  // ---------- Drowned King ----------
  // Beam: warm-up s, len (cut by obstacles), w, damage x boss damage per touch (0.5 s hit invulnerability limits it), sweep rad over t s (P1-2), P3 turns spin rad/s for a half circle.
  const BEAM = { warm: 1.0, len: 330, w: 18, mul: 0.9, sweep: 1.9, t: 1.7, spin: 0.85 };
  // Whirlpool attack (P1-2): radius, pull px/s at the centre, core radius and its damage x boss damage, seconds, a water ring every gap s (each warned 0.6 s). P3 standing pool: r3, str3.
  const POOL = { r: 175, str: 50, core: 38, mul: 0.6, dur: 3.6, gap: 1.3, r3: 210, str3: 28 };
  ED.Bosses.KING = { BEAM, POOL };

  const beamUpd = (w, z, e, st) => {
    z.x = e.x; z.y = e.y - 12; z.a += st.rate * DT;
    z.len = rayLen(w, z.x, z.y, z.a, BEAM.len);
    e.face = Math.cos(z.a) >= 0 ? 1 : -1;
  };
  const poolUpd = (w, z, e, st) => { z.x = e.x; z.y = e.y; if (z.t >= st.arm) pull(w, z.x, z.y, z.r, st.str, DT); };
  const coreTest = (w, z, p) => U.dist2(z.x, z.y, p.x, p.y) <= (POOL.core + p.r * 0.7) ** 2;
  const standingPool = (w, e) => hz(w, e, { look: 'whirlpool', r: POOL.r3, dur: 1e6 }, { mul: POOL.mul, arm: 1.0, upd: poolUpd, test: coreTest, str: POOL.str3 });

  const chase = approach(140);
  B.king = runner({
    // Tidal Beam: warm-up shows the swept arc (cone) and the start line; then the beam turns from the start line across it. P2: a second beam opposite. P3: both turn a half circle (P3 has no arc cone: the start lines plus a lead cone in the turning direction).
    beam: {
      w: 3, wind: BEAM.warm,
      start(w, e) {
        const s = e.vars.s, ph = e.vars.phase, spin = ph >= 3, dir = w.rng.sign(), n = ph >= 2 ? 2 : 1;
        const dur = (spin ? Math.PI / BEAM.spin : BEAM.t) / (e.enraged ? 1.3 : 1), rate = dir * (spin ? Math.PI : BEAM.sweep) / dur;
        const a0 = aim(e) - (spin ? 0 : rate * dur / 2);
        s.warm = T(e, BEAM.warm); s.dur = dur; s.rate = rate; s.a = []; s.on = false;
        for (let i = 0; i < n; i++) {
          const a = a0 + i * Math.PI;
          s.a.push(a);
          line(w, e, e.x, e.y - 12, a, BEAM.len, BEAM.w, s.warm, 0);
          if (spin) cone(w, e, a + dir * 0.45, BEAM.len, 0.9, s.warm, 0);
          else cone(w, e, a + rate * s.dur / 2, BEAM.len, Math.abs(rate * s.dur), s.warm, 0);
        }
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.on && t >= s.warm) { s.on = true; for (const a of s.a) hz(w, e, { look: 'tidebeam', x: e.x, y: e.y - 12, a, len: BEAM.len, w: BEAM.w, dur: s.dur }, { mul: BEAM.mul, upd: beamUpd, rate: s.rate }); }
        return t >= s.warm + s.dur + 0.3;
      },
    },
    // Trident fan: 3 (P2+: 5) warned lanes, then fast tridents along them.
    trident: {
      w: 3, wind: 0.75,
      start(w, e) {
        const s = e.vars.s; s.n = e.vars.phase >= 2 ? 5 : 3; s.a = aim(e); s.at = T(e, 0.75);
        for (let i = 0; i < s.n; i++) line(w, e, e.x, e.y, s.a + (i - (s.n - 1) / 2) * 0.3, 420, 14, s.at, 0);
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.done && t >= s.at) { s.done = true; for (let i = 0; i < s.n; i++) shot(w, e, s.a + (i - (s.n - 1) / 2) * 0.3, 323, 'trident', 1.1, 6, { life: 1.9 }); }
        return t >= s.at + 0.35;
      },
    },
    // Leap slam onto the target's spot, a ring of water orbs on landing.
    leap: {
      w: 2, wind: 1.19, ok: (w, e) => e.vars.phase < 3,
      start(w, e) { leapStart(w, e, e.vars.s, 72, 1.19, 1.6); },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (leapTo(e, s, t)) ring(w, e, 12, 102, 'waterorb', w.rng.next() * TAU, 0.6, 5);
        return t >= s.fl + 0.5;
      },
    },
    // Whirlpool (P2): pull toward the King, a core that hurts, two warned water rings while it spins.
    whirl: {
      w: 3, phase: 2, wind: 0.9, ok: (w, e) => e.vars.phase < 3,
      start(w, e) { const s = e.vars.s; s.at = T(e, 0.9); s.i = 0; tele(w, e, e.x, e.y, POOL.r, s.at, 0, { followSrc: true }); },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.z && t >= s.at) s.z = hz(w, e, { look: 'whirlpool', r: POOL.r, dur: POOL.dur }, { mul: POOL.mul, upd: poolUpd, test: coreTest, str: POOL.str });
        const tw = s.at + 0.4 + s.i * POOL.gap;
        if (s.z && s.i < 2 && t >= tw && !s.w) { s.w = true; tele(w, e, e.x, e.y, e.r + 18, 0.6, 0, { followSrc: true }); }
        if (s.w && t >= tw + 0.6) { s.w = false; s.i++; ring(w, e, 10, 81, 'waterorb', w.rng.next() * TAU, 0.6, 5); }
        return t >= s.at + POOL.dur;
      },
    },
    // Adds from the mire (telegraphed), at most once per 14 s.
    adds: {
      w: 1, wind: 0.8, ok: (w, e) => w.time - (e.vars.addT || -99) > 14,
      start(w, e) { e.vars.addT = w.time; adds(w, e, e.vars.phase >= 2 ? ['glowslime', 'myconid', 'spitter'] : ['myconid', 'glowslime'], 70, 0.9); },
      update: (w, e, dt, t) => t >= 1.0,
    },
  }, {
    // P3: a 1 s warning ring, then the standing whirlpool for the rest of the fight.
    onPhase(w, e, ph) { if (ph === 3) { tele(w, e, e.x, e.y, POOL.r3, 1.0, 0, { followSrc: true }); e.vars.poolT = 1.0; } },
    tick(w, e, dt) { const v = e.vars; if (v.poolT > 0 && (v.poolT -= dt) <= 0) standingPool(w, e); },
    idle(w, e, dt) { if (e.vars.phase < 3) chase(w, e, dt); else { w.steer(e, e.tgt.x, e.tgt.y, 0.4, dt); } },
  });
})(globalThis.ED || (globalThis.ED = {}));
