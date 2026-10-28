// Boss 'weaver' (Rift Weaver, stage 3 mid-boss; art foe.riftcaller scaled): a void caster who keeps range and fills the ground with rifts and threads.
// P1: rift gates (warned circles around the target open into portals that fire void bolts at the nearest hero), weave (warned threads crossing the target), blink (warned landing circle, then a bolt ring).
// P2 (66%): 3 gates, a second weave through the same point (rotated) and threads that stay as live strands, telegraphed adds. P3 (33%): 4 gates firing faster, 4 threads per weave, a second bolt ring on landing.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, B = ED.Bosses;
  const { tele, line, approach, runner } = B.lib;
  const { T, hz, spot, adds } = B.libB;
  ED.regLook('rift', 'riftgate', 'strand', 'voidbolt');
  ED.addFoe('weaver', { name: 'Rift Weaver', look: 'foe.riftcaller', ai: 'boss', boss: true, hp: 0, spd: 40, dmg: 2, r: 20, xp: 25, kb: 0, noElite: true, scale: 3.2 });

  // Gates: count per phase, ring radius around the target, warn s, portal life s, first bolt s after opening, s between bolts per phase, bolt speed / radius / x boss damage, gate radius.
  const GATE = { n: [2, 3, 4], ring: 150, warn: 0.9, life: 3.2, first: 0.6, every: [0.9, 0.8, 0.6], speed: 128, br: 6, mul: 0.8, r: 18 };
  // Weave: threads per phase, length, width, warn s, x boss damage; P2+ a second weave after again s, threads stay hold s as strands (width sw, x boss damage per touch).
  const WEAVE = { n: [3, 3, 4], len: 520, w: 24, warn: 0.9, mul: 1.6, again: 0.55, hold: 2.6, sw: 10, smul: 0.6 };
  // Blink: landing circle radius / warn s / x boss damage, distance from the target, bolt ring size / speed / x boss damage.
  const BLINK = { r: 60, warn: 0.75, mul: 1.6, dist: [170, 230], n: 12, speed: 119, bmul: 0.8 };
  const ADDS = ['voideye', 'gloom'];
  B.WEAVER = { GATE, WEAVE, BLINK, ADDS };

  // Live portal: fires a void bolt at the nearest living hero every st.every s from GATE.first on.
  const gateUpd = (w, z, e, st) => {
    if (z.t < st.next) return;
    st.next += st.every;
    const p = w.nearestHero(z.x, z.y); if (!p) return;
    const pr = B.lib.shot(w, e, z.x, z.y - 6, Math.atan2(p.y - z.y + 6, p.x - z.x), GATE.speed, 'voidbolt', e.dmg * GATE.mul, GATE.br);
    pr.wid = 'voidbolt';
  };
  const openGate = (w, z) => { const e = z.src; if (e && !e.dead && e.id === z.srcId) hz(w, e, { look: 'riftgate', x: z.x, y: z.y, r: GATE.r, dur: GATE.life }, { mul: 0, upd: gateUpd, next: GATE.first, every: z.st }); };
  // A resolved thread stays as a live strand (P2+).
  const strand = (w, z) => { const e = z.src; if (z.st && e && !e.dead && e.id === z.srcId) hz(w, e, { look: 'strand', x: z.x, y: z.y, a: z.a, len: z.len, w: WEAVE.sw, dur: WEAVE.hold }, { mul: WEAVE.smul }); };
  // n threads crossing (x, y), the first at angle a0.
  const weave = (w, e, x, y, a0, n, keep) => {
    const d = T(e, WEAVE.warn), h = WEAVE.len / 2;
    for (let i = 0; i < n; i++) { const a = a0 + i * Math.PI / n; line(w, e, x - Math.cos(a) * h, y - Math.sin(a) * h, a, WEAVE.len, WEAVE.w, d, WEAVE.mul, { st: keep ? 1 : 0, onEnd: strand }); }
    return d;
  };

  B.weaver = runner({
    // Rift gates: warned circles on a ring around the target; each opens into a portal that shoots at the nearest hero.
    gates: {
      w: 3, wind: 0.8,
      start(w, e) {
        const s = e.vars.s, ph = e.vars.phase, n = GATE.n[ph - 1], tg = e.tgt, a0 = w.rng.next() * TAU;
        s.d = T(e, GATE.warn);
        if (!tg) return;
        for (let i = 0; i < n; i++) {
          const pt = spot(w, tg.x + Math.cos(a0 + i * TAU / n) * GATE.ring, tg.y + Math.sin(a0 + i * TAU / n) * GATE.ring, GATE.r);
          if (pt) tele(w, e, pt.x, pt.y, GATE.r, s.d, 0, { look: 'rift', st: GATE.every[ph - 1], onEnd: openGate });
        }
      },
      update: (w, e, dt, t) => t >= e.vars.s.d + 0.4,
    },
    // Weave: threads cross where the target stands; P2+ a second weave through the same point (rotated half a step) and strands that stay.
    weave: {
      w: 3, wind: 0.9,
      start(w, e) {
        const s = e.vars.s, ph = e.vars.phase, tg = e.tgt;
        s.x = tg ? tg.x : e.x; s.y = tg ? tg.y : e.y; s.n = WEAVE.n[ph - 1]; s.a0 = w.rng.next() * Math.PI; s.two = ph >= 2; s.k = 0;
        s.d = weave(w, e, s.x, s.y, s.a0, s.n, s.two);
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.two && !s.k && t >= WEAVE.again) { s.k = 1; weave(w, e, s.x, s.y, s.a0 + Math.PI / s.n / 2, s.n, true); }
        return t >= (s.two ? WEAVE.again : 0) + s.d + 0.3;
      },
    },
    // Blink: a warned landing circle near the target; he appears there and fires a bolt ring (P3: a second, offset ring).
    blink: {
      w: 2, wind: 0.75,
      start(w, e) {
        const s = e.vars.s, tg = e.tgt, a = w.rng.next() * TAU, d = w.rng.range(BLINK.dist[0], BLINK.dist[1]);
        const pt = (tg && spot(w, tg.x + Math.cos(a) * d, tg.y + Math.sin(a) * d, e.r)) || { x: e.x, y: e.y };
        s.x = pt.x; s.y = pt.y; s.d = T(e, BLINK.warn); s.k = 0; s.rings = e.vars.phase >= 3 ? 2 : 1; s.off = w.rng.next() * TAU;
        tele(w, e, pt.x, pt.y, BLINK.r, s.d, BLINK.mul, { look: 'rift' });
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.k === 0 && t >= s.d) { e.x = s.x; e.y = s.y; s.k = 1; }
        if (s.k >= 1 && s.k <= s.rings && t >= s.d + (s.k - 1) * 0.35) {
          for (let i = 0; i < BLINK.n; i++) { const pr = B.lib.shot(w, e, e.x, e.y - 14, s.off + (i + (s.k - 1) * 0.5) * TAU / BLINK.n, BLINK.speed, 'voidbolt', e.dmg * BLINK.bmul, GATE.br); pr.wid = 'voidbolt'; }
          s.k++;
        }
        if (e.tgt) e.face = e.tgt.x >= e.x ? 1 : -1;
        return s.k > s.rings && t >= s.d + 0.5;
      },
    },
    // Adds (P2+): telegraphed void eyes and glooms around him.
    adds: { w: 1, phase: 2, wind: 0.9, start(w, e) { adds(w, e, ADDS, 90, 0.9); }, update: (w, e, dt, t) => t >= 1.1 },
  }, { idle: approach(170), onPhase(w, e, ph) { if (ph >= 2) B.lib.force(e, 'gates'); } });
})(globalThis.ED || (globalThis.ED = {}));
