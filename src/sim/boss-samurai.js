// Boss 'samurai' (Giant Samurai, stage 3 mid-boss; art boss.samurai.*). A swordsman: every cut is a warned lane, cone or circle.
// P1: dash slash (a warned lane, then he crosses it), sword waves (warned cone, then crescents), iaido (a long sheathe, one screen-long cut through the target, he reappears at its end).
// P2 (66%): chained double dashes, 5 waves. P3 (33%): triple dashes, a second wave volley, a crossed iaido (two cuts), spin slashes while he walks in.
(function (ED) {
  'use strict';
  const U = ED.U, B = ED.Bosses;
  const { tele, line, cone, aim, mv, approach, runner } = B.lib;
  const { T, shot, spot } = B.libB;
  ED.regLook('swordwave', 'iaido');

  // Dash: lane width, length = distance to the target + over, clamped to [min, max], x boss damage, seconds to cross.
  const DASH = { w: 30, over: 60, min: 140, max: 280, mul: 1.5, cross: 0.16 };
  // Waves: crescent speed, radius, x boss damage, fan step (rad). Iaido: lane width, length (min, max), x boss damage.
  const WAVE = { speed: 210, r: 10, mul: 1.0, step: 0.28 };
  const IAIDO = { w: 18, min: 260, max: 520, mul: 2.0 };
  const LEAD = 0.35; // dash and iaido lanes aim where the target will be after LEAD s of its current movement (the lane shows the cut exactly)
  ED.Bosses.SAMURAI = { DASH, WAVE, IAIDO, LEAD };
  // Lead point of the target into s.lx, s.ly.
  const lead = (e, s) => { const tg = e.tgt; s.lx = tg.x + (tg.vx || 0) * LEAD; s.ly = tg.y + (tg.vy || 0) * LEAD; };

  B.samurai = runner({
    // Dash slash x phase: warned lane toward the target, then he crosses it in DASH.cross s; re-aims between dashes.
    dash: {
      w: 3, wind: 0.7,
      start(w, e) { const s = e.vars.s; s.n = Math.min(3, e.vars.phase); s.i = 0; s.next = 0; s.d = null; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.d && s.i < s.n && t >= s.next) {
          lead(e, s);
          const a = Math.atan2(s.ly - e.y, s.lx - e.x), L = U.clamp(Math.hypot(s.lx - e.x, s.ly - e.y) + DASH.over, DASH.min, DASH.max), d = T(e, 0.7);
          line(w, e, e.x, e.y, a, L, DASH.w, d, DASH.mul);
          s.d = { a, L, at: t + d };
        }
        const D = s.d;
        if (D && t >= D.at) {
          mv(w, e, Math.cos(D.a), Math.sin(D.a), D.L / DASH.cross, dt);
          if (t >= D.at + DASH.cross) { s.d = null; s.i++; s.next = t + 0.25; }
        }
        return s.i >= s.n && !s.d && t >= s.next;
      },
    },
    // Sword waves: a warned cone, then a fan of crescents (P2+: 5); P3 a second, offset volley.
    waves: {
      w: 2, wind: 0.6,
      start(w, e) { const s = e.vars.s; s.n = e.vars.phase >= 2 ? 5 : 3; s.a = aim(e); s.at = T(e, 0.6); s.k = 0; s.v = e.vars.phase >= 3 ? 2 : 1; cone(w, e, s.a, 130, WAVE.step * (s.n + 1), s.at, 0); },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.k < s.v && t >= s.at + s.k * 0.45) {
          const n = s.n - s.k; // the second volley has one crescent less, so it falls between the first volley's
          for (let i = 0; i < n; i++) shot(w, e, s.a + (i - (n - 1) / 2) * WAVE.step, WAVE.speed, 'swordwave', WAVE.mul, WAVE.r, { life: 2.4 });
          s.k++;
        }
        return s.k >= s.v && t >= s.at + 0.5;
      },
    },
    // Iaido: a 1.1 s sheathe behind a lane through the target (P3: and a crossing lane through the same point); he reappears at the lane's end.
    iaido: {
      w: 2, wind: 1.1,
      start(w, e) {
        const s = e.vars.s; lead(e, s);
        const a = Math.atan2(s.ly - e.y, s.lx - e.x), L = U.clamp(Math.hypot(s.lx - e.x, s.ly - e.y) + 160, IAIDO.min, IAIDO.max);
        s.at = T(e, 1.1); s.a = a; s.L = L;
        line(w, e, e.x, e.y, a, L, IAIDO.w, s.at, IAIDO.mul, { wid: 'iaido' });
        if (e.vars.phase >= 3) { const b = a + Math.PI / 2; line(w, e, s.lx - Math.cos(b) * 200, s.ly - Math.sin(b) * 200, b, 400, IAIDO.w, s.at, IAIDO.mul, { wid: 'iaido' }); }
      },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (!s.done && t >= s.at) {
          s.done = true;
          const pt = spot(w, e.x + Math.cos(s.a) * s.L, e.y + Math.sin(s.a) * s.L, e.r);
          if (pt) { e.x = pt.x; e.y = pt.y; }
          e.face = Math.cos(s.a) >= 0 ? -1 : 1; // lands facing back along the cut
        }
        return t >= s.at + 0.6;
      },
    },
    // Spin (P3): two warned circle slashes while he walks at the target.
    spin: {
      w: 2, phase: 3, wind: 0.65,
      start(w, e) { const s = e.vars.s; s.i = 0; s.next = 0; },
      update(w, e, dt, t) {
        const s = e.vars.s;
        if (s.i < 2 && t >= s.next) { const d = T(e, 0.65); tele(w, e, e.x, e.y, 80, d, 1.3, { followSrc: true }); s.next = t + d + 0.1; s.i++; }
        if (e.tgt) w.steer(e, e.tgt.x, e.tgt.y, 1.2, dt);
        return s.i >= 2 && t >= s.next;
      },
    },
  }, { idle: approach(90) });
})(globalThis.ED || (globalThis.ED = {}));
