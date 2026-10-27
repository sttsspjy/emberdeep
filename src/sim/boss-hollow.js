// Boss 'hollow' (Hollow King, stage 1 final boss). A crown-blade duelist; enrages at ED.CONST.ENRAGE_T (bosses.js: x3 damage and speed; here telegraphs x0.8, floor 0.6 s, shards spin faster).
// P1: three-swing combo (cones that step with him, a thrust lane last), crown throw (out along a warned lane and back to him), blink-and-cleave.
// P2 (66%): 3 crown shards orbit him (harmless for their first second), crown throw sends 3 crowns, skull novas. P3 (33%): 3 more shards on a wider counter-turning ring, double blinks, starfall on every hero.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU, B = ED.Bosses, DT = C.TICK;
  const { tele, line, cone, ring, aim, approach, runner } = B.lib;
  const { T, hz, spot, shot } = B.libB;
  ED.regLook('crown', 'crownshard', 'blinkmark', 'starfall');

  // Orbit shards: per ring { n, R (px), dir } added at phase 2 and 3; spd rad/s (x1.6 enraged), touch damage x boss damage, arm s harmless after appearing, r px.
  const SHARDS = { rings: [{ n: 3, R: 62, dir: 1 }, { n: 3, R: 112, dir: -1 }], spd: 2.0, mul: 0.6, arm: 1.0, r: 8 };
  // Crown: lane length, speed px/s, x boss damage, radius.
  const CROWN = { len: 360, speed: 400, mul: 1.1, r: 9 };
  ED.Bosses.HOLLOW = { SHARDS, CROWN };

  const shardUpd = (w, z, e, st) => {
    st.ang += st.dir * SHARDS.spd * (e.enraged ? 1.6 : 1) * DT;
    z.x = e.x + Math.cos(st.ang) * st.R; z.y = e.y - 10 + Math.sin(st.ang) * st.R;
  };
  const addShards = (w, e, rg) => {
    for (let i = 0; i < rg.n; i++) {
      const ang = i * TAU / rg.n;
      hz(w, e, { look: 'crownshard', x: e.x + Math.cos(ang) * rg.R, y: e.y - 10 + Math.sin(ang) * rg.R, r: SHARDS.r, dur: 1e6 }, { mul: SHARDS.mul, arm: SHARDS.arm, upd: shardUpd, ang, dir: rg.dir, R: rg.R });
    }
  };
  // Crown flight: out for st.out s, then homes back to its King (fast) and vanishes on reaching him; gone if he dies.
  const crownTick = (w, pr, dt) => {
    const st = pr.st, e = st.e;
    if (!e || e.dead || e.id !== st.id) { pr.dead = true; return; }
    if (!st.back && pr.t >= st.out) st.back = true;
    if (st.back) {
      const dx = e.x - pr.x, dy = e.y - 14 - pr.y, d = Math.hypot(dx, dy) || 1, sp = CROWN.speed * 1.15;
      pr.vx = dx / d * sp; pr.vy = dy / d * sp; pr.life = Math.max(pr.life, 0.5);
      if (d < 16) pr.dead = true;
    }
  };

  B.hollow = runner({
    // Three swings: each a cone telegraph that rides with him while he steps in (first 0.35 s); the third is a thrust lane.
    combo: {
      w: 3, wind: 0.6,
      start(w, e) { const s = e.vars.s; s.i = 0; s.next = 0; s.b = false; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.i >= 3) return t >= s.next;
        if (!s.b && t >= s.next) {
          const tg = e.tgt, d = Math.hypot(tg.x - e.x, tg.y - e.y), last = s.i === 2;
          s.b = true; s.a = aim(e); s.t0 = t; s.d = T(e, last ? 0.7 : 0.6); s.step = U.clamp(d - 50, 0, 70) / 0.35;
          if (last) line(w, e, e.x, e.y, s.a, 230, 28, s.d, 1.5, { followSrc: true });
          else cone(w, e, s.a, 92, 2.0, s.d, 1.3);
        }
        if (s.b) {
          if (t - s.t0 < 0.35) { const sp = s.step * (e.enraged ? 1.5 : 1); B.lib.mv(w, e, Math.cos(s.a), Math.sin(s.a), sp, dt); }
          if (t - s.t0 >= s.d) { s.b = false; s.i++; s.next = t + 0.15; }
        }
        return false;
      },
    },
    // Crown throw: warned lane(s), the crown flies out over obstacles and comes back to him. P2+: three crowns in a fan.
    crown: {
      w: 2, wind: 0.7,
      start(w, e) {
        const s = e.vars.s, n = e.vars.phase >= 2 ? 3 : 1, a0 = aim(e);
        s.at = T(e, 0.7); s.a = [];
        for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * 0.45; s.a.push(a); line(w, e, e.x, e.y, a, CROWN.len, 20, s.at, 0); }
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.done && t >= s.at) { s.done = true; for (const a of s.a) shot(w, e, a, CROWN.speed, 'crown', CROWN.mul, CROWN.r, { fly: true, life: 3, tick: crownTick, st: { e, id: e.id, out: CROWN.len / CROWN.speed, back: false } }); }
        return t >= s.at + 1.6;
      },
    },
    // Blink: a mark beside the target (0.7 s), he appears there and cleaves toward the target (0.6 s cone). P3: twice.
    blink: {
      w: 2, wind: 0.7,
      start(w, e) { const s = e.vars.s; s.n = e.vars.phase >= 3 ? 2 : 1; s.i = 0; s.next = 0; s.pd = null; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.pd && s.i < s.n && t >= s.next) {
          const tg = e.tgt, a = w.rng.range(0, TAU), pt = spot(w, tg.x + Math.cos(a) * 64, tg.y + Math.sin(a) * 64, e.r) || { x: e.x, y: e.y };
          s.pd = { x: pt.x, y: pt.y, at: t + T(e, 0.7), done: false, end: 0 };
          tele(w, e, pt.x, pt.y, e.r + 10, s.pd.at - t, 0, { wid: 'blinkmark' });
        }
        const pd = s.pd;
        if (pd && !pd.done && t >= pd.at) {
          pd.done = true; e.x = pd.x; e.y = pd.y; e.face = e.tgt.x >= e.x ? 1 : -1;
          const d = T(e, 0.6); cone(w, e, aim(e), 100, 2.2, d, 1.4); pd.end = t + d + 0.15;
        }
        if (pd && pd.done && t >= pd.end) { s.pd = null; s.i++; s.next = t + 0.1; }
        return s.i >= s.n && !s.pd;
      },
    },
    // Skull nova (P2+): a warned pulse, then three staggered rings of skulls.
    nova: {
      w: 2, phase: 2, wind: 0.7,
      start(w, e) { const s = e.vars.s; s.at = T(e, 0.7); s.k = 0; tele(w, e, e.x, e.y, e.r + 26, s.at, 0, { followSrc: true }); },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.k < 3 && t >= s.at + s.k * 0.45) { ring(w, e, 14, 105, 'skull', (s.k % 2) * TAU / 28, 0.7, 6); s.k++; }
        return t >= s.at + 1.4;
      },
    },
    // Starfall (P3): staggered falling stars on and around every hero.
    starfall: {
      w: 2, phase: 3, wind: 0.6,
      start(w, e) {
        const L = w.living;
        for (let h = 0; h < L.length; h++) for (let j = 0; j < 3; j++) {
          const p = L[h], a = w.rng.range(0, TAU), d = j ? w.rng.range(40, 100) : 0;
          tele(w, e, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 34, T(e, 0.9 + 0.25 * j), 1.0, { wid: 'starfall' });
        }
      },
      update: (w, e, dt, t) => t >= 1.7,
    },
  }, {
    idle: approach(110),
    onPhase(w, e, ph) { const rg = SHARDS.rings[ph - 2]; if (rg) addShards(w, e, rg); },
  });
})(globalThis.ED || (globalThis.ED = {}));
