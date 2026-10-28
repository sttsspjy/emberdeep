// Boss 'spore' (Sporemother, ED.FOES.spore): arena control. Rooted where she rises, she grows a spore carpet of circular patches (zones, look 'spore') around herself and her pods:
// a grown patch slows a hero standing on it and ticks SM.patch.dps x her damage per second (no i-frames). Four spore pods (boss parts 'sporepod') rise around her after a telegraph and spread
// their own patches; killing a pod clears the carpet around it. Attacks: lashes (a line per hero, a fan of three from phase 2), burst rings (waves of spores after a ring warning),
// a slam when a hero stands close (clears the carpet around her and calms the spread). Phase 2 (66%): pods regrow faster. Phase 3 (33%): she uproots and walks after the heroes,
// painting short-lived carpet where she goes; the spread and pod regrowth stop, bursts spiral.
(function (ED) {
  'use strict';
  const U = ED.U, B = ED.Bosses, L = B.lib, TAU = U.TAU;
  const { line, tele } = L;
  const SM = B.SPORE = {
    patch: { r: [30, 42], grow: 0.8, life: 60, max: 48, dps: 0.3, tick: 0.5, slow: 0.35 }, // radius, s to grow (harmless meanwhile), lifetime, cap (oldest dies), damage x e.dmg per s, hero slow
    spread: { t: 1.4, reach: 240, pod: 110, cap: [22, 5] }, // s per new patch; px of carpet reach around her and around a pod; live patches at most (her, each pod)
    pods: { n: 4, d: [170, 230], first: 0.8, warn: 1.2, regrow: [14, 9], clear: 100 }, // pod ring distance, first growth, spawn telegraph, regrowth s by phase, carpet cleared on death (px)
    lash: { len: 440, w: 26, wind: 0.9, mul: 1.0, fan: 0.32 },
    slam: { r: 125, wind: 1.0, mul: 1.4, near: 150, calm: 4 },
    burst: { n: [10, 14, 16], waves: 3, speed: 98, gap: 0.5, wind: 0.75, mul: 0.7, spin: 0.27 },
    chase: 0.9, paint: { step: 34, life: 10, r: 30 }, // phase 3: walking speed x spd; a patch every `step` px walked
  };
  ED.addFoe('sporepod', { name: 'Spore Pod', look: 'foe.sporepuff', ai: 'boss', boss: true, hp: 60, spd: 0, dmg: 0, r: 12, xp: 5, kb: 0, noElite: true, noContact: true, scale: 2 });

  // ---------- carpet ----------
  // A patch zone (team 1, look 'spore', no direct damage) of radius r at (x, y): grows over SM.patch.grow s, dies with her.
  const patchTick = (w, z) => { const s = z.src; if (s.dead || s.id !== z.srcId) { z.dead = true; return; } z.r = z.st.R * Math.min(1, z.t / SM.patch.grow); };
  function addPatch(w, e, x, y, r, life, src) {
    const v = e.vars;
    if (v.patches.length >= SM.patch.max) { const o = v.patches.shift(); if (!o.z.dead && o.z.id === o.id) o.z.dead = true; }
    if (ED.Arena.blocked(w.arena, x, y, 4)) return null;
    const z = w.zone({ team: 1, look: 'spore', x, y, r: 1, dur: life, src: e, onTick: patchTick, st: { R: r } });
    v.patches.push({ z, id: z.id, x, y, R: r, src: src | 0 });
    return z;
  }
  // Drops dead patches from the list.
  function prune(v) { let n = 0; for (const o of v.patches) if (!o.z.dead && o.z.id === o.id) v.patches[n++] = o; v.patches.length = n; }
  // Clears every patch whose centre lies within r of (x, y).
  function clearAt(w, e, x, y, r) {
    const v = e.vars;
    for (const o of v.patches) if (U.dist2(o.x, o.y, x, y) <= r * r && !o.z.dead && o.z.id === o.id) o.z.dead = true;
    prune(v);
    w.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r), look: 'spore', team: 1 });
  }
  // One growth step of source src (0 her, 1-4 a pod slot) at (sx, sy) with reach R: a patch next to a random patch of that source (or on the source), inside the reach.
  function grow(w, e, src, sx, sy, R) {
    const v = e.vars, own = [];
    for (const o of v.patches) if (o.src === src) own.push(o);
    if (own.length >= SM.spread.cap[src ? 1 : 0]) return;
    for (let k = 0; k < 4; k++) {
      const o = own.length ? own[w.rng.int(0, own.length - 1)] : null, r = w.rng.range(SM.patch.r[0], SM.patch.r[1]);
      const a = w.rng.next() * TAU, d = o ? o.R + r * 0.55 : w.rng.range(0, 20), x = (o ? o.x : sx) + Math.cos(a) * d, y = (o ? o.y : sy) + Math.sin(a) * d;
      if (U.dist2(x, y, sx, sy) > R * R) continue;
      if (addPatch(w, e, x, y, r, SM.patch.life, src)) return;
    }
  }
  // True when hero p stands on a grown patch.
  function onCarpet(v, p) {
    for (const o of v.patches) { const z = o.z; if (z.dead || z.id !== o.id || z.t < SM.patch.grow) continue; const rr = z.r + p.r * 0.5; if (U.dist2(p.x, p.y, z.x, z.y) <= rr * rr) return true; }
    return false;
  }

  // ---------- pods ----------
  // Four slots around her (diagonals, pulled in when an obstacle sits there).
  function podSlots(w, e) {
    const out = [];
    for (let i = 0; i < SM.pods.n; i++) {
      const a = Math.PI / 4 + i * TAU / SM.pods.n;
      let x = e.x + Math.cos(a) * SM.pods.d[1], y = e.y + Math.sin(a) * SM.pods.d[1];
      for (let d = SM.pods.d[1]; d >= SM.pods.d[0]; d -= 15) { x = e.x + Math.cos(a) * d; y = e.y + Math.sin(a) * d; if (!ED.Arena.blocked(w.arena, x, y, 16)) break; }
      const pt = L.inside(w, x, y, 20, {});
      out.push({ x: pt.x, y: pt.y, pod: null, id: 0, pending: false, regrow: 0, reach: 0 });
    }
    return out;
  }
  // Telegraphed pod growth at slot sl (a warning circle; the pod rises when it ends, unless she died).
  function growPod(w, e, sl) {
    sl.pending = true;
    tele(w, e, sl.x, sl.y, 18, SM.pods.warn, 0, { look: 'spore', onEnd: (ww) => { const p = ww.spawnFoe('sporepod', sl.x, sl.y); sl.pending = false; if (p) { sl.pod = p; sl.id = p.id; sl.reach = 0; } } });
  }

  // ---------- attacks ----------
  const burst = {
    w: 2, wind: SM.burst.wind,
    start(w, e) { tele(w, e, e.x, e.y, e.r + 26, SM.burst.wind, 0, { followSrc: true, look: 'spore' }); e.vars.s.k = 0; e.vars.s.a = w.rng.next() * TAU; },
    update(w, e, dt, t) {
      const q = SM.burst, s = e.vars.s, ph = e.vars.phase, n = q.n[ph - 1];
      if (s.k < q.waves && t >= q.wind + s.k * q.gap) { L.ring(w, e, n, q.speed, 'poison', s.a + s.k * q.spin * (ph >= 3 ? 2 : 1), q.mul, 6); s.k++; }
      return t >= q.wind + q.waves * q.gap + 0.3;
    },
  };
  const lash = {
    w: 3, wind: SM.lash.wind,
    start(w, e) {
      const q = SM.lash, fan = e.vars.phase >= 2 ? 1 : 0;
      for (const p of w.living) { const a = Math.atan2(p.y - e.y, p.x - e.x); for (let f = -fan; f <= fan; f++) line(w, e, e.x, e.y, a + f * q.fan, q.len, q.w, q.wind, q.mul, { followSrc: true }); }
    },
    update: (w, e, dt, t) => t >= SM.lash.wind + 0.3,
  };
  const slam = {
    w: 4, wind: SM.slam.wind, ok: (w, e) => L.near(w, e, SM.slam.near),
    start(w, e) {
      const q = SM.slam;
      tele(w, e, e.x, e.y, q.r, q.wind, q.mul, { followSrc: true, look: 'quake', onEnd: (ww, z) => { clearAt(ww, e, z.x, z.y, z.r); e.vars.spT = Math.max(e.vars.spT, q.calm); } });
    },
    update: (w, e, dt, t) => t >= SM.slam.wind + 0.45,
  };

  // ---------- the arena clock: carpet growth and damage, pods ----------
  function tick(w, e, dt) {
    const v = e.vars;
    if (!v.slots) { v.slots = podSlots(w, e); v.patches = []; v.spT = 0.5; v.cpT = SM.patch.tick; v.podT = SM.pods.first; v.paint = { x: e.x, y: e.y }; }
    prune(v);
    for (const sl of v.slots) if (sl.pod && (sl.pod.dead || sl.pod.id !== sl.id)) { // a destroyed pod clears the carpet around itself
      sl.pod = null; sl.regrow = SM.pods.regrow[Math.min(v.phase, 2) - 1];
      clearAt(w, e, sl.x, sl.y, SM.pods.clear);
    }
    if (v.phase < 3) {
      if ((v.spT -= dt) <= 0) { // one patch from her, one from every live pod
        v.spT = SM.spread.t;
        grow(w, e, 0, e.x, e.y, SM.spread.reach);
        for (let i = 0; i < v.slots.length; i++) { const sl = v.slots[i]; if (sl.pod) grow(w, e, i + 1, sl.x, sl.y, SM.spread.pod); }
      }
      if (v.podT > 0 && (v.podT -= dt) <= 0) { for (const sl of v.slots) growPod(w, e, sl); } // the first growth fills every slot
      else if (v.podT <= 0) for (const sl of v.slots) if (!sl.pod && !sl.pending && (sl.regrow -= dt) <= 0) growPod(w, e, sl);
    } else if (U.dist2(e.x, e.y, v.paint.x, v.paint.y) > SM.paint.step * SM.paint.step) { // phase 3: carpet where she walks
      v.paint.x = e.x; v.paint.y = e.y;
      addPatch(w, e, e.x, e.y, SM.paint.r, SM.paint.life);
    }
    for (const p of w.living) if (onCarpet(v, p)) L.slowHero(p, SM.patch.slow, 0.15);
    if ((v.cpT -= dt) <= 0) {
      v.cpT += SM.patch.tick;
      for (const p of w.living) if (onCarpet(v, p)) L.hazard(w, p, e.dmg * SM.patch.dps * SM.patch.tick, e);
    }
  }
  // Rooted in phases 1-2 (turns to face the target); phase 3 walks after it.
  function idle(w, e, dt) {
    const t = e.tgt; if (!t) return;
    e.face = t.x > e.x ? 1 : -1;
    e.vx = e.vy = 0;
    if (e.vars.phase < 3) return;
    if (Math.hypot(t.x - e.x, t.y - e.y) > e.r + 24) w.steer(e, t.x, t.y, SM.chase, dt);
  }
  // Fight over: her pods wither.
  function kill(w, e) {
    const v = e.vars; if (!v || !v.slots) return true;
    for (const sl of v.slots) if (sl.pod && !sl.pod.dead && sl.pod.id === sl.id) w.killFoe(sl.pod, null);
    return true;
  }
  function bar(w, e, b) { let n = 1; const v = e.vars; if (v && v.slots) for (const sl of v.slots) if (sl.pod && !sl.pod.dead && sl.pod.id === sl.id) n++; b.n = n; }

  // Phase 3: she uproots (drawn taller: e.scale 1.15 tells clients she walks).
  function onPhase(w, e, ph) { if (ph === 3) e.scale = 1.15; }

  B.spore = L.runner({ burst, lash, slam }, { idle, tick, kill, bar, onPhase, pause: [1.2, 0.9, 0.6] });
  // Spore pods stand still; they never touch.
  B.sporepod = (w, e) => { e.vx = e.vy = 0; };
  B.SPORE.onCarpet = onCarpet;
})(globalThis.ED || (globalThis.ED = {}));
