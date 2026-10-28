// Boss 'warden' (Bone Warden, ED.FOES.warden): a sword duelist. Strings of telegraphed swings end in a ground slam that leaves him stuck WD.stuck s taking x WD.punish damage (e.st 3: the punish window).
// A lone lunge closes on a hero who keeps away. Phase 2 (66%): longer strings with lunges and the wide sweep, the slam throws a ring of bone shards, and a bone wave fans out at range.
// Phase 3 (33%): spectral swords fall on telegraphed lines through every hero every WD.swords.gap s while he keeps dueling.
(function (ED) {
  'use strict';
  const U = ED.U, B = ED.Bosses, L = B.lib, TAU = U.TAU;
  const { line, cone, tele, aim, dist, mv } = L;
  const WD = B.WARDEN = {
    swing: { r: 96, arc: 2.0, wind: 0.65, mul: 1.1 }, // wide swing
    cut: { r: 112, arc: 1.3, wind: 0.6, mul: 1.0 }, // fast narrow cut
    sweep: { r: 128, arc: 4.4, wind: 0.85, mul: 1.2 }, // only behind him is safe
    slam: { r: 100, off: 26, wind: 0.9, mul: 1.5, n: 14, speed: 106, smul: 0.6 }, // circle centred `off` px ahead; phase 2+: a shard ring of n from the impact
    lunge: { len: 240, w: 46, wind: 0.7, speed: 496, mul: 1.2 }, // warn line, then a dash along it (a hero he passes takes the hit)
    step: { t: 0.2, d: 48 }, // glide toward the target before each swing (s, stop distance)
    gap: 0.14, // pause between swings
    stuck: 1.4, punish: 1.5, // the punish window after the slam
    wave: { n: 7, spread: 0.2, speed: 162, wind: 0.8, mul: 0.8, r: 70 }, // phase 2: a fan of bone shards after a cone warning
    swords: { gap: 2.6, wind: 1.1, w: 30, len: 380, mul: 0.9, first: 1.2 }, // phase 3: s between drops, wind-up, line width and length
  };
  // Swing strings by phase; every one ends in the slam.
  const SEQ = [
    [['swing', 'cut', 'slam'], ['cut', 'swing', 'slam']],
    [['swing', 'cut', 'slam'], ['lunge', 'sweep', 'slam'], ['cut', 'cut', 'swing', 'slam']],
    [['swing', 'cut', 'swing', 'slam'], ['lunge', 'cut', 'sweep', 'slam'], ['cut', 'swing', 'cut', 'slam']],
  ];

  // One move of a string: starts its telegraph, returns its wind-up length.
  function startMove(w, e, m) {
    const s = e.vars.s, a = aim(e);
    s.a = a; e.face = Math.cos(a) >= 0 ? 1 : -1;
    if (m === 'swing' || m === 'cut' || m === 'sweep') { const q = WD[m]; cone(w, e, a, q.r, q.arc, q.wind, q.mul); return q.wind; }
    if (m === 'slam') {
      const q = WD.slam, ph = e.vars.phase;
      tele(w, e, e.x + Math.cos(a) * q.off, e.y + Math.sin(a) * q.off, q.r, q.wind, q.mul, { look: 'quake', onEnd: ph >= 2 ? (ww, z) => L.ringAt(ww, e, z.x, z.y, q.n, q.speed, 'bone', ww.rng.next(), q.smul, 5) : null });
      return q.wind;
    }
    const q = WD.lunge;
    line(w, e, e.x, e.y, a, q.len, q.w, q.wind, 0, { followSrc: true });
    s.left = q.len; s.hit = [];
    return q.wind;
  }
  // The lunge's dash along s.a; heroes he touches take the hit once. True when it ends.
  function dashStep(w, e, dt) {
    const s = e.vars.s, q = WD.lunge, step = Math.min(s.left, q.speed * dt);
    const blocked = mv(w, e, Math.cos(s.a), Math.sin(s.a), step / dt, dt);
    s.left -= step;
    L.ram(w, e, s.hit, e.dmg * q.mul, 6);
    return !!blocked || s.left <= 0;
  }

  // The string: step, wind-up, release (or dash), and after the slam the punish window.
  const combo = {
    w: 2, wind: 0.16, ok: (w, e) => dist(e) < 230,
    start(w, e) {
      const s = e.vars.s, list = SEQ[Math.min(e.vars.phase, 3) - 1];
      s.seq = list[w.rng.int(0, list.length - 1)]; s.i = 0; s.sub = 'step'; s.until = WD.step.t;
    },
    update(w, e, dt, t) {
      const s = e.vars.s;
      if (s.sub === 'step') {
        if (dist(e) > WD.step.d && e.tgt) w.steer(e, e.tgt.x, e.tgt.y, WD.step.d / WD.step.t / e.spd, dt);
        e.st = 0;
        if (t >= s.until) { s.sub = 'wind'; s.until = t + startMove(w, e, s.seq[s.i]); }
        return false;
      }
      if (s.sub === 'wind') {
        e.st = 1;
        if (t < s.until) return false;
        const m = s.seq[s.i];
        if (m === 'lunge') { s.sub = 'dash'; return false; }
        if (m === 'slam') { s.sub = 'stuck'; s.until = t + WD.stuck; e.takeMul = WD.punish; return false; }
        s.sub = 'gap'; s.until = t + WD.gap; return false;
      }
      if (s.sub === 'dash') { e.st = 2; if (dashStep(w, e, dt)) { s.sub = 'gap'; s.until = t + WD.gap; } return false; }
      if (s.sub === 'gap') { e.st = 2; if (t >= s.until) { s.i++; s.sub = 'step'; s.until = t + WD.step.t; } return false; }
      e.st = 3; // stuck: the punish window
      return t >= s.until;
    },
    end(w, e) { e.takeMul = 1; },
  };
  const combo2 = Object.assign({}, combo); // two keys share the string: the runner never repeats its last key
  // A lone lunge closes the distance to a hero that keeps away.
  const lunge = {
    w: 3, wind: WD.lunge.wind, ok: (w, e) => dist(e) >= 150,
    start(w, e) { const s = e.vars.s; s.until = startMove(w, e, 'lunge'); s.sub = 'wind'; },
    update(w, e, dt, t) {
      const s = e.vars.s;
      if (s.sub === 'wind') { if (t >= s.until) s.sub = 'dash'; return false; }
      if (s.sub === 'dash') { if (dashStep(w, e, dt)) { s.sub = 'end'; s.until = t + 0.35; } return false; }
      e.st = 0;
      return t >= s.until;
    },
  };
  // Phase 2+: a cone warning toward the target, then a fan of bone shards.
  const wave = {
    w: 2, phase: 2, wind: WD.wave.wind,
    start(w, e) { const s = e.vars.s, q = WD.wave; s.a = aim(e); cone(w, e, s.a, q.r, q.spread * (q.n - 1) + 0.3, q.wind, 0); },
    update(w, e, dt, t) {
      const s = e.vars.s, q = WD.wave;
      if (!s.done && t >= q.wind) { s.done = true; for (let i = 0; i < q.n; i++) w.foeShoot(e, s.a + (i - (q.n - 1) / 2) * q.spread, q.speed, 'bone', e.dmg * q.mul, 5); }
      return t >= q.wind + 0.4;
    },
  };

  // Spectral swords (phase 3): one line per living hero (two when solo) through a point near the hero at a random angle; each strikes on its own clock.
  function swords(w, e) {
    const q = WD.swords, hs = w.living, n = hs.length + (hs.length === 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const p = hs[i % hs.length], extra = i >= hs.length;
      const cx = p.x + (extra ? w.rng.range(-90, 90) : w.rng.range(-30, 30)), cy = p.y + (extra ? w.rng.range(-70, 70) : w.rng.range(-30, 30)), a = w.rng.range(0, Math.PI);
      line(w, e, cx - Math.cos(a) * q.len / 2, cy - Math.sin(a) * q.len / 2, a, q.len, q.w, q.wind, q.mul, { look: 'sword', detached: true });
    }
  }
  function tick(w, e, dt) {
    const v = e.vars;
    if (v.phase >= 3 && w.living.length) { v.swT -= dt; if (v.swT <= 0) { v.swT = WD.swords.gap; swords(w, e); } }
  }
  function onPhase(w, e, ph) {
    e.takeMul = 1;
    if (ph === 3) e.vars.swT = WD.swords.first;
  }

  B.warden = L.runner({ combo, combo2, lunge, wave }, { idle: L.approach(64), tick, onPhase });
})(globalThis.ED || (globalThis.ED = {}));
