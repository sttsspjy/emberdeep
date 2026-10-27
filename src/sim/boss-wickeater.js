// Boss 'wickeater' (The Wick-Eater, stage 3 final boss; art foe.horror scaled): a void maw that eats light. Enrages at ED.CONST.ENRAGE_T (bosses.js), telegraphs x0.8 (floor 0.6 s).
// P1: devour (warned cone, then it inhales: heroes in the cone are dragged toward a warned bite), closing dark (a ring of darkness shrinks onto its cast spot; walk through a gap or dash),
// lashes (a warned fan of lanes toward the target), bloom (a warned pulse, then spiralling rings of void orbs).
// P2 (66%): two closing rings with offset gaps, 5 lashes, 4 bloom rings, telegraphed adds. P3 (33%): it swells (x1.2 size), three rings, 7 lashes plus an interleaved second fan, 6 bloom rings.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, B = ED.Bosses, DT = ED.CONST.TICK;
  const { tele, line, cone, aim, approach, runner, force } = B.lib;
  const { T, hz, adds } = B.libB;
  ED.regLook('maw', 'inhale', 'darkring', 'voidorb');
  ED.addFoe('wickeater', { name: 'The Wick-Eater', look: 'foe.horror', ai: 'boss', boss: true, hp: 0, spd: 40, dmg: 2, r: 26, xp: 25, kb: 0, noElite: true, scale: 3.4 });

  // Devour: cone radius / arc, warn s, inhale s, pull px/s at the mouth (half at the rim), bite radius and x boss damage.
  const DEVOUR = { r: 230, arc: 1.3, warn: 0.9, suck: 1.3, pull: 60, bite: 60, mul: 2.6 };
  // Closing dark: start radius (warned, still), end radius, warn s, close s, band half-width px, gaps per ring (zone w carries it to clients), gap half-width rad,
  // x boss damage per touch, rings per phase, s between rings.
  const DARK = { r0: 300, r1: 30, warn: 1.0, close: 2.2, band: 9, gaps: 3, gap: 0.42, mul: 1.4, n: [1, 2, 3], every: 0.9 };
  // Lashes: lanes per phase, length, width, fan step rad, warn s, x boss damage; P3 a second fan between the first one's lanes after again s.
  const LASH = { n: [3, 5, 7], len: 300, w: 22, step: 0.3, warn: 0.85, mul: 1.5, again: 0.45 };
  // Bloom: warned pulse radius past the body / warn s / x boss damage, rings per phase, orbs per ring, speed, s between rings, twist rad per ring, x boss damage, orb radius.
  const BLOOM = { pad: 40, warn: 0.8, pmul: 1.2, rings: [3, 4, 6], n: 14, speed: 120, gap: 0.3, twist: 0.11, mul: 0.9, r: 6 };
  const ADDS = ['starspawn', 'shade', 'voideye'];
  const SWELL = 1.2; // P3 size factor
  B.WICK = { DEVOUR, DARK, LASH, BLOOM, ADDS, SWELL };

  // Mouth point of e toward a.
  const mouth = (e, a, out) => { out.x = e.x + Math.cos(a) * e.r; out.y = e.y - 6 + Math.sin(a) * e.r; return out; };
  // Inhale: drags living, non-dashing heroes inside the cone toward the mouth (z.x, z.y).
  const inhaleUpd = (w, z) => {
    const L = w.living;
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (p.dashT > 0) continue;
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
      if (d > z.r || d < 8 || Math.abs(U.angDiff(z.a, Math.atan2(-dy, -dx))) > z.arc / 2) continue;
      const k = DEVOUR.pull * DT * (1 - 0.5 * d / z.r) / d;
      ED.Arena.move(w.arena, p, dx * k, dy * k, p.r);
    }
  };
  // Closing ring: still while warned (z.r = r0), then shrinks to r1; a hero on the band outside every gap is hit.
  const darkUpd = (w, z, e, st) => { if (z.t >= st.arm) z.r = DARK.r0 - (DARK.r0 - DARK.r1) * Math.min(1, (z.t - st.arm) / DARK.close); };
  const darkTest = (w, z, p) => {
    const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy);
    if (Math.abs(d - z.r) > DARK.band + p.r * 0.7) return false;
    const a = Math.atan2(dy, dx), n = z.w;
    for (let i = 0; i < n; i++) if (Math.abs(U.angDiff(z.a + i * TAU / n, a)) <= DARK.gap) return false;
    return true;
  };
  const darkRing = (w, e, x, y, a) => { const arm = T(e, DARK.warn); return hz(w, e, { look: 'darkring', x, y, r: DARK.r0, w: DARK.gaps, a, dur: arm + DARK.close }, { mul: DARK.mul, arm, upd: darkUpd, test: darkTest }); };
  const lashFan = (w, e, a0, n) => { const d = T(e, LASH.warn); for (let i = 0; i < n; i++) line(w, e, e.x, e.y - 6, a0 + (i - (n - 1) / 2) * LASH.step, LASH.len, LASH.w, d, LASH.mul); return d; };
  const MP = { x: 0, y: 0 };

  B.wickeater = runner({
    // Devour: a warned cone and bite; the maw then inhales for DEVOUR.suck s and bites when the bite warning resolves.
    devour: {
      w: 3, wind: 0.9,
      start(w, e) {
        const s = e.vars.s, a = aim(e), m = mouth(e, a, MP);
        s.a = a; s.d = T(e, DEVOUR.warn); s.on = false; e.face = Math.cos(a) >= 0 ? 1 : -1;
        cone(w, e, a, DEVOUR.r, DEVOUR.arc, s.d, 0);
        tele(w, e, m.x, m.y, DEVOUR.bite, s.d + DEVOUR.suck, DEVOUR.mul, { look: 'maw' });
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.on && t >= s.d) { s.on = true; const m = mouth(e, s.a, MP); hz(w, e, { look: 'inhale', x: m.x, y: m.y, r: DEVOUR.r, a: s.a, arc: DEVOUR.arc, dur: DEVOUR.suck }, { mul: 0, upd: inhaleUpd }); }
        return t >= s.d + DEVOUR.suck + 0.35;
      },
    },
    // Closing dark: rings shrink onto its cast spot one after another, each with gaps offset from the last.
    dark: {
      w: 2, wind: 1.0,
      start(w, e) { const s = e.vars.s; s.n = DARK.n[e.vars.phase - 1]; s.i = 0; s.next = 0; s.x = e.x; s.y = e.y; s.a = w.rng.next() * TAU; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.i < s.n && t >= s.next) { darkRing(w, e, s.x, s.y, s.a + s.i * TAU / DARK.gaps / 2); s.i++; s.next = t + DARK.every; }
        return s.i >= s.n && t >= s.next + 0.2;
      },
    },
    // Lashes: a warned fan of lanes toward the target (P3: a second fan between them).
    lash: {
      w: 3, wind: 0.85,
      start(w, e) { const s = e.vars.s; s.a = aim(e); s.two = e.vars.phase >= 3; s.k = 0; s.d = lashFan(w, e, s.a, LASH.n[e.vars.phase - 1]); e.face = Math.cos(s.a) >= 0 ? 1 : -1; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.two && !s.k && t >= LASH.again) { s.k = 1; lashFan(w, e, s.a, LASH.n[e.vars.phase - 1] - 1); }
        return t >= (s.two ? LASH.again : 0) + s.d + 0.3;
      },
    },
    // Bloom: a warned pulse around the body, then rings of void orbs, each turned a little further (a spiral).
    bloom: {
      w: 2, wind: 0.8,
      start(w, e) { const s = e.vars.s; s.d = T(e, BLOOM.warn); s.k = 0; s.n = BLOOM.rings[e.vars.phase - 1]; s.off = w.rng.next() * TAU; s.dir = w.rng.sign(); tele(w, e, e.x, e.y, e.r + BLOOM.pad, s.d, BLOOM.pmul, { followSrc: true }); },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.k < s.n && t >= s.d + s.k * BLOOM.gap) {
          const off = s.off + s.dir * s.k * BLOOM.twist;
          for (let i = 0; i < BLOOM.n; i++) { const pr = B.lib.shot(w, e, e.x, e.y - 12, off + i * TAU / BLOOM.n, BLOOM.speed, 'voidorb', e.dmg * BLOOM.mul, BLOOM.r); pr.wid = 'voidorb'; }
          s.k++;
        }
        return s.k >= s.n && t >= s.d + s.n * BLOOM.gap + 0.2;
      },
    },
    // Adds (P2+): telegraphed abyss foes around it.
    adds: { w: 1, phase: 2, wind: 0.9, start(w, e) { adds(w, e, ADDS, 110, 0.9); }, update: (w, e, dt, t) => t >= 1.1 },
  }, {
    idle: approach(110),
    onPhase(w, e, ph) {
      if (ph === 2) force(e, 'bloom');
      if (ph === 3) { e.scale = e.def.scale * SWELL; e.r = Math.round(e.def.r * SWELL); force(e, 'dark'); }
    },
  });
})(globalThis.ED || (globalThis.ED = {}));
