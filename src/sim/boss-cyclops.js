// Boss 'cyclops' (Demon Cyclops, stage 2 final boss; art boss.cyclops.*). Enrages at ED.CONST.ENRAGE_T (bosses.js), telegraphs x0.8 (floor 0.6 s).
// P1: eye laser sweep (the swept arc is warned; obstacles cut the beam), stomp (warned circle, then a shockwave ring rolls outward), leap slam with a fire ring.
// P2 (66%): the laser sweeps back over the same arc, double stomps, aimed fire volleys. P3 (33%): a fan of three lasers, triple stomps, spider adds.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU, B = ED.Bosses, DT = C.TICK;
  const { tele, line, cone, ring, aim, approach, runner } = B.lib;
  const { T, hz, rayLen, shot, adds, leapStart, leapTo } = B.libB;
  ED.regLook('eyelaser', 'stompwave');

  // Laser: warm-up s, len (cut by obstacles), w, x boss damage per touch, sweep rad over t s per pass, P3 fan spread rad between beams, eye height px.
  const LASER = { warm: 0.9, len: 360, w: 14, mul: 1.0, sweep: 2.1, t: 1.4, spread: 0.5, eye: 30 };
  // Stomp: warned radius and x boss damage; the wave rolls from r to r + speed x dur, hurting heroes within band px of its rim.
  const STOMP = { r: 86, mul: 1.5, speed: 170, dur: 1.0, band: 7, wmul: 0.8 };
  ED.Bosses.CYCLOPS = { LASER, STOMP };

  const laserUpd = (w, z, e, st) => {
    if (st.back && z.t >= st.pass && !st.rev) { st.rev = true; st.rate = -st.rate; }
    z.x = e.x; z.y = e.y - LASER.eye; z.a += st.rate * DT;
    z.len = rayLen(w, z.x, z.y, z.a, LASER.len);
    e.face = Math.cos(z.a) >= 0 ? 1 : -1;
  };
  const waveUpd = (w, z) => { z.r += STOMP.speed * DT; };
  const waveTest = (w, z, p) => { const d = Math.hypot(p.x - z.x, p.y - z.y); return Math.abs(d - z.r) <= STOMP.band + p.r * 0.7; };
  const stompEnd = (w, z) => { const e = z.src; if (e && !e.dead && e.id === z.srcId) hz(w, e, { look: 'stompwave', x: z.x, y: z.y, r: STOMP.r, dur: STOMP.dur }, { mul: STOMP.wmul, upd: waveUpd, test: waveTest }); };

  B.cyclops = runner({
    // Eye laser: warned arc + start line(s); the beam sweeps across (P2: and back; P3: three beams in a fan).
    laser: {
      w: 3, wind: LASER.warm,
      start(w, e) {
        const s = e.vars.s, ph = e.vars.phase, n = ph >= 3 ? 3 : 1, dir = w.rng.sign(), k = e.enraged ? 1.3 : 1;
        s.warm = T(e, LASER.warm); s.pass = LASER.t / k; s.back = ph >= 2; s.rate = dir * LASER.sweep / s.pass; s.a = []; s.on = false;
        const a0 = aim(e) - dir * LASER.sweep / 2, ex = e.x, ey = e.y - LASER.eye;
        for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * LASER.spread; s.a.push(a); line(w, e, ex, ey, a, LASER.len, LASER.w, s.warm, 0); }
        cone(w, e, aim(e), LASER.len, LASER.sweep + LASER.spread * (n - 1), s.warm, 0);
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.on && t >= s.warm) {
          s.on = true;
          for (const a of s.a) hz(w, e, { look: 'eyelaser', x: e.x, y: e.y - LASER.eye, a, len: LASER.len, w: LASER.w, dur: s.pass * (s.back ? 2 : 1) }, { mul: LASER.mul, upd: laserUpd, rate: s.rate, pass: s.pass, back: s.back, rev: false });
        }
        return t >= s.warm + s.pass * (s.back ? 2 : 1) + 0.3;
      },
    },
    // Stomp x phase: each a warned circle around him, then a rolling shockwave ring.
    stomp: {
      w: 3, wind: 0.8,
      start(w, e) { const s = e.vars.s; s.n = Math.min(3, e.vars.phase); s.i = 0; s.next = 0; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.i < s.n && t >= s.next) { const d = T(e, 0.8); tele(w, e, e.x, e.y, STOMP.r, d, STOMP.mul, { followSrc: true, onEnd: stompEnd }); s.next = t + d + 0.45; s.i++; }
        return s.i >= s.n && t >= s.next;
      },
    },
    // Leap slam onto the target's spot, a ring of fireballs on landing.
    leap: {
      w: 2, wind: 1.19,
      start(w, e) { leapStart(w, e, e.vars.s, 80, 1.19, 1.8); },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (leapTo(e, s, t)) ring(w, e, 12, 110, 'fireball', w.rng.next() * TAU, 0.6, 5);
        return t >= s.fl + 0.55;
      },
    },
    // Gaze (P2+): three aimed volleys, each a warned lane then three fast fireballs down it.
    gaze: {
      w: 2, phase: 2, wind: 0.6,
      start(w, e) { const s = e.vars.s; s.k = 0; s.next = 0; s.fire = -1; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.fire < 0 && s.k < 3 && t >= s.next) { s.a = aim(e); s.fire = t + T(e, 0.6); line(w, e, e.x, e.y, s.a, 420, 16, s.fire - t, 0); }
        if (s.fire >= 0 && t >= s.fire) {
          const j = Math.floor((t - s.fire) / 0.08);
          if (j >= (s.j || 0) && (s.j || 0) < 3) { shot(w, e, s.a, 255, 'fireball', 0.8, 6, { life: 1.9 }); s.j = (s.j || 0) + 1; }
          if (s.j >= 3) { s.j = 0; s.fire = -1; s.k++; s.next = t + 0.25; }
        }
        return s.k >= 3 && t >= s.next;
      },
    },
    // Spider adds (P3), at most once per 15 s.
    adds: {
      w: 1, phase: 3, wind: 0.8, ok: (w, e) => w.time - (e.vars.addT || -99) > 15,
      start(w, e) { e.vars.addT = w.time; adds(w, e, ['cavespider', 'cavespider', 'shroomhulk'], 80, 0.9); },
      update: (w, e, dt, t) => t >= 1.0,
    },
  }, { idle: approach(130) });
})(globalThis.ED || (globalThis.ED = {}));
