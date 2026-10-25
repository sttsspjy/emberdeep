// Champion rooms (stratum IV, room.champ 'twins' | 'colossus'), started by W.startChampion(room) when the room locks; the fight ends when every foe is down and roomCleared pays the room's reward.
// Twins: the Lancer (thrust, sweep) and the Hammer (slam, leap, quake) act alone and every COMBO s together: the Lancer reels heroes in or binds one, the Hammer lands on the spot.
// A fallen twin rises at REVIVE_HP of its health after REVIVE s while the other stands (the survivor rages meanwhile); both down ends the fight.
// Clockwork Colossus: one machine of four foes, the Gear Core (the anchor, type colossus) and three parts at fixed offsets (COL.OFF) that take their own hits: Cannon Arm, Saw Arm, Lantern Eye.
// It stands mid-arena top (colAnchor) and shuffles sideways, never chases; its body never hurts on touch. The director (W.colossusTick) starts moves from the standing parts and escalations from the stumps of broken ones;
// a part that breaks drops its running moves and its beams. The core takes COL.ARMOR (nothing below COL.FLOOR of its health) until COL.OPEN_AT parts are broken, then COL.OPEN: the final phase
// (pauses x COL.FINAL, a second light move of another part may start COL.GAP2 s into the first). Every damaging move starts with a telegraph (zones tagged z.neon for the client's neon style).
// Champion HP is the def's HP x the stratum's elite factor (World.ELITE); hero stuns on them last ELITE_STUN as on elites.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon, TAU = U.TAU, A = ED.Arena, B = ED.Bosses, W = ED.World.prototype, Wd = ED.World, T = ED.CONST.TILE;
  const { line, cone, aim, mv, tele, drop, approach } = B.lib;

  const C = ED.Champions = {
    REVIVE: 10, REVIVE_HP: 0.5, RAGE: { pause: 0.6, dmg: 1.25 }, COMBO: [7, 9], PAUSE: [0.7, 1.1],
    // Colossus: part centres from the core (px), resting aims (rad); core armour; pauses between moves (x BROKE per broken part, x FINAL once open); anchor TOP tiles down, shuffle RANGE px at SPD; arm turn rate (rad/s).
    COL: {
      PARTS: ['cannon', 'saw', 'eye'], TYPE: { cannon: 'colcannon', saw: 'colsaw', eye: 'coleye' },
      OFF: { core: [0, 0], cannon: [-64, 6], saw: [64, 6], eye: [0, -46] }, REST: { cannon: 2.2, saw: 0.94, eye: Math.PI / 2 },
      ARMOR: 0.2, FLOOR: 0.4, OPEN: 1.5, OPEN_AT: 2,
      PAUSE: [1.3, 1.8], BROKE: 0.88, FINAL: 0.65, GAP2: 0.7, BREATH: 1.0, OPENED: 1.6, FIRST: 1.5,
      TOP: 6.5, RANGE: 64, SPD: 24, TURN: 8,
      // Moves: warn (s, x windMul), damage x the source's dmg (mul); shots in px/s before the stratum and Pact 8 factors; [armoured, open] counts.
      MV: {
        spiral: { warn: 0.9, n: 16, gap: 0.1, step: 0.33, speed: 150, mul: 0.3, arms: [2, 3] }, // Cannon: arms of bolts turning out of the muzzle
        fan: { warn: 0.8, re: 0.5, spread: 0.16, speed: 300, mul: 0.35, n: [7, 9] }, // Cannon: a warned fan of n lanes, then one more re-aimed at the hero
        ring: { warn: 0.8, n: 20, gap: 0.5, speed: 135, mul: 0.3, waves: [2, 3] }, // Cannon: rings of n bolts, each offset half a step
        sweep: { warn: 0.85, near: 240, r: 170, arc: 2.2, mul: 0.85 }, // Saw: a cone swing at a hero within near
        roll: { warn: 0.9, w: 34, speed: 540, split: 0.32, mul: 0.7 }, // Saw: a warned lane, then a rolling saw (two lanes final)
        beam: { warn: 1.0, arc: 1.9, t: 1.5, fast: 1.2, w: 14, mul: 0.3 }, // Eye: a laser sweeping arc rad across the hero in t s (fast final)
        grid: { warn: 1.1, gap: 96, lead: 0.5, w: 16, mul: 0.45 }, // Eye: rows and columns of beams across the room; the second wave shows lead s before the first fires
        vent: { warn: 1.5, gap: 110, n: 3, w: 18, mul: 0.45 }, // Cannon stump: n slow beams of one orientation around the hero
        stomp: { warn: 0.9, r: 110, mul: 0.8, n: 22, gap: 0.5, speed: 170, smul: 0.3, waves: [1, 2] }, // Saw stump: a stomp circle, then shockwave rings
        blind: { warn: 0.8, over: 0.2, t: 1.1, fast: 0.9, w: 16, mul: 0.3 }, // Eye stump: a laser from the socket across the whole lower half (horizon + over), alternating sides
      },
    },
  };
  const isChamp = (e) => !!(e && e.def && e.def.champ);
  // Champions take hero stuns like elites.
  const stun0 = W.stunFoe;
  W.stunFoe = function (e, dur, repeating) { return stun0.call(this, e, isChamp(e) ? dur * ED.CONST.ELITE_STUN : dur, repeating); };

  // Wire of the 'champ' arena: [] for the twins; the Colossus: [broken bits (1 cannon, 2 saw, 4 eye), core open 0/1, move states (2 bits each: cannon, saw, eye, core; 0 idle, 1 winding up, 2 firing), cannon, saw and eye aims (rad)].
  A.reg('champ', {
    id: 3,
    encode: (ar) => (ar.c ? [ar.c.b, ar.c.o, ar.c.s, ar.c.a[0], ar.c.a[1], ar.c.a[2]] : []),
    decode: (room, r, ar) => { ar.c = r.length > 6 ? { b: r[1], o: r[2], s: r[3], a: [r[4], r[5], r[6]] } : null; },
  });

  // HP of a champion: x the stratum's elite factor, times frac.
  const setup = (w, e, frac) => {
    const k = Wd.ELITE.hp + Wd.ELITE.hpStep * (w.stratum - 1);
    e.maxHp *= k; e.hp = e.maxHp * (frac || 1); e.dmgBase = e.dmg;
    e.mode = 'idle'; e.t = 1; e.st = 'move'; e.force = null; e.vars = { wm: 1 };
    return e;
  };

  // ---------- the attack runner of one champion ----------
  // table[k] = { w (weight, or w(w, e)), ok(w, e), start(w, e), update(w, e, dt, t) -> done }. e.mode: 'idle' | 'atk'; e.force names an attack the director queued (e.vars.forced); e.st carries the drawn pose (windup, charge, cast, move).
  // The pause after an attack is PAUSE x RAGE.pause while raging x e.pauseK.
  const brain = (table, idle) => (w, e, dt) => {
    if (e.mode === 'atk') {
      e.t += dt;
      if (table[e.atk].update(w, e, dt, e.t)) { e.mode = 'idle'; e.st = 'move'; e.t = w.rng.range(C.PAUSE[0], C.PAUSE[1]) * (e.rage ? C.RAGE.pause : 1) * (e.pauseK || 1); }
      return;
    }
    e.t -= dt;
    idle(w, e, dt);
    let k = null;
    if (e.force && table[e.force]) k = e.force;
    else if (e.t <= 0 && !(e.blind > 0) && w.alivePlayers().length) {
      const keys = Object.keys(table).filter(id => table[id].w && id !== e.last && (!table[id].ok || table[id].ok(w, e)));
      if (keys.length) k = w.rng.weighted(keys, id => (typeof table[id].w === 'function' ? table[id].w(w, e) : table[id].w));
    }
    if (!k) return;
    const forced = k === e.force;
    e.force = null; e.atk = k; e.last = k; e.mode = 'atk'; e.t = 0; e.vars = Object.assign({ wm: e.windMul || 1, forced }, e.queued || {}); e.queued = null;
    table[k].start(w, e);
  };
  const pose = (e, st) => { e.st = st; };
  // A charge along the warned lane: dash at speed for dur s (full body contact), done after rest s more.
  const dashAlong = (w, e, dt, t, v, speed, dur, rest) => {
    if (t < v.at) return false;
    if (t < v.at + dur) { pose(e, 'charge'); if (mv(w, e, Math.cos(v.a), Math.sin(v.a), speed, dt) && !v.thud) { v.thud = true; w.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y), big: 1 }); } return false; }
    pose(e, 'move');
    return t >= v.at + dur + rest;
  };

  // ---------- Twins ----------
  const LANCE = {
    thrust: {
      w: 3,
      start(w, e) { pose(e, 'windup'); const v = e.vars; v.a = aim(e); v.at = 0.7 * v.wm; line(w, e, e.x, e.y, v.a, 300, e.r * 2, v.at, 0, true); },
      update(w, e, dt, t) { return dashAlong(w, e, dt, t, e.vars, 460, 0.6, 0.35); },
    },
    sweep: {
      w: 2, ok: (w, e) => !!e.target && U.dist2(e.x, e.y, e.target.x, e.target.y) < 150 * 150,
      start(w, e) { pose(e, 'windup'); cone(w, e, aim(e), 105, 2.4, 0.55 * e.vars.wm, 1.2, () => pose(e, 'slam')); },
      update(w, e, dt, t) { return t > 0.55 * e.vars.wm + 0.35; },
    },
    // Combo: a ring warns around the Lancer, then a pull drags heroes within it toward him.
    reel: {
      w: 0,
      start(w, e) { pose(e, 'cast'); const v = e.vars; v.at = 1.0 * v.wm; w.addZone({ kind: 'tele', x: e.x, y: e.y, r: 220, dur: v.at, dmg: 0, team: 1, src: e, warnOnly: true }); w.emit({ t: 'tell', k: 'reel', x: Math.round(e.x), y: Math.round(e.y) }); },
      update(w, e, dt, t) {
        const v = e.vars;
        if (!v.pulled && t >= v.at) { v.pulled = true; w.addZone({ kind: 'pull', x: e.x, y: e.y, r: 220, str: 170, dur: 0.7, team: 1 }); }
        return t >= v.at + 0.9;
      },
    },
    // Combo: a circle warns under a hero, then binds the ground there (walking x0.12 for 1.5 s; a dash still leaves).
    bind: {
      w: 0,
      start(w, e) {
        pose(e, 'cast');
        const v = e.vars, p = v.p || e.target;
        v.at = 0.8 * v.wm;
        tele(w, e, p.x, p.y, 46, v.at, 0.5, 'shadow', (ww, z) => ww.addZone({ kind: 'bind', x: z.x, y: z.y, r: 46, dur: 1.5, team: 1 }));
        w.emit({ t: 'tell', k: 'bind', x: Math.round(p.x), y: Math.round(p.y) });
      },
      update(w, e, dt, t) { return t >= e.vars.at + 0.3; },
    },
  };
  const HAMMER = {
    slam: {
      w: 3, ok: (w, e) => !!e.target && U.dist2(e.x, e.y, e.target.x, e.target.y) < 170 * 170,
      start(w, e) {
        pose(e, 'windup');
        cone(w, e, aim(e), 135, 2.0, 0.75 * e.vars.wm, 1.4, (ww) => { pose(e, 'slam'); for (let i = 0; i < 10; i++) ww.enemyShoot(e, i * TAU / 10, 150, 'void', 0.6, 6); ww.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y), big: 1 }); });
      },
      update(w, e, dt, t) { return t > 0.75 * e.vars.wm + 0.4; },
    },
    leap: {
      w: 2,
      start(w, e) { const v = e.vars; v.to = v.to || [e.target.x, e.target.y]; v.fl = v.fl || 1.1 * v.wm; v.r = v.r || 85; leapStart(w, e, v); },
      update(w, e, dt, t) { return leapStep(w, e, t, e.vars); },
    },
    // Lands on the spot the director named (e.queued: to, fl, r).
    crush: {
      w: 0,
      start(w, e) { leapStart(w, e, e.vars); },
      update(w, e, dt, t) { return leapStep(w, e, t, e.vars); },
    },
    quake: {
      w: 2,
      start(w, e) {
        pose(e, 'windup');
        const a = aim(e), k = e.vars.wm;
        for (let i = 1; i <= 6; i++) {
          const x = e.x + Math.cos(a) * (e.r + i * 42), y = e.y + Math.sin(a) * (e.r + i * 42);
          if (D.blocksShots(D.tileAt(w.room, x, y), true)) break;
          drop(w, e, x, y, 30, (0.7 + i * 0.08) * k, 1.0, 'slam');
        }
      },
      update(w, e, dt, t) { return t > 1.4 * e.vars.wm; },
    },
  };
  function leapStart(w, e, v) {
    pose(e, 'leap');
    v.from = [e.x, e.y];
    tele(w, e, v.to[0], v.to[1], v.r, v.fl, 1.3, 'slam', (ww) => { pose(e, 'slam'); for (let i = 0; i < 8; i++) ww.enemyShoot(e, i * TAU / 8 + 0.2, 160, 'void', 0.6, 6); ww.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y), big: 1 }); });
  }
  function leapStep(w, e, t, v) {
    if (t <= v.fl) {
      const k = Math.min(1, t / v.fl);
      e.x = U.lerp(v.from[0], v.to[0], U.easeInOut(k)); e.y = U.lerp(v.from[1], v.to[1], U.easeInOut(k));
      if (k >= 1) { Sim.resolve(e, w.room, w.locked, false); pose(e, 'move'); }
    }
    return t > v.fl + 0.45;
  }

  // ---------- Clockwork Colossus ----------
  const COL = C.COL, MV = COL.MV, BIT = { cannon: 1, saw: 2, eye: 4 }, NEON = { cannon: 1, saw: 2, eye: 3, core: 4 };
  const live = (e) => !!e && e.hp > 0 && !e.killed;
  const neon = (z, k) => { z.neon = NEON[k]; return z; }; // the part colour the client draws this telegraph or beam in
  // A shot of e's from (x, y) (the stratum and Pact 8 shot speed as enemyShoot).
  const shotAt = (w, e, x, y, a, sp, kind, mul, r) => w.spawnProj({ team: 1, kind, x, y, a, speed: sp * (w.pact >= 8 ? 1.2 : 1) * Wd.shotSpd(w.stratum), r, dmg: e.dmg * mul, life: 5, src: e });
  const volley = (w, e, x, y, n, a0, sp, kind, mul) => { for (let i = 0; i < n; i++) shotAt(w, e, x, y, a0 + i * TAU / n, sp, kind, mul, 6); w.emit({ t: 'shoot', x: Math.round(x), y: Math.round(y), k: kind }); };
  const foeOf = (w, e) => { const t = e.target; if (t && !t.ghost && w.alive(t)) return t; return w.nearestPlayer(e.x, e.y) || t || { x: e.x, y: e.y + 120 }; };
  const aimAt = (e, p) => Math.atan2(p.y - e.y, p.x - e.x);
  const reach = (w, x, y, a) => A.ray(w.room, x, y, a, 1200);
  // A warned lane (warnOnly teleLine) that becomes a beam as the warning ends (a laser zone of 0.3 s: one tick, hero i-frames outlast it).
  const beamLane = (w, e, k, x, y, a, len, width, warn, mul) => {
    const z = neon(line(w, e, x, y, a, len, width, warn, 0, true), k);
    z.onEnd = (ww) => { if (e.hp > 0) ww.addZone(neon({ kind: 'laser', x, y, a, len, w: width, warm: 0, dur: 0.3, dmg: e.dmg * mul, team: 1, src: e }, k)); };
    return z;
  };
  // Parallel beam lanes across the room's interior: rows (dir 0) or columns (dir 1), gap px apart; around (cx, cy) n lanes (one within gap / 2 of it), else every lane from a random phase.
  const gridWave = (w, e, k, dir, P, warn, around) => {
    const room = w.room, x0 = T, x1 = (room.w - 1) * T, y0 = 2 * T, y1 = (room.h - 1) * T, lo = dir ? x0 : y0, hi = dir ? x1 : y1, vs = [];
    if (around) { const c = (dir ? around.x : around.y) + w.rng.range(-P.gap / 2, P.gap / 2); for (let i = 0; i < P.n; i++) vs.push(c + (i - (P.n - 1) / 2) * P.gap); }
    else for (let v = lo + w.rng.range(8, P.gap); v < hi - 8; v += P.gap) vs.push(v);
    for (const v of vs) {
      if (v < lo + 8 || v > hi - 8) continue;
      if (dir) beamLane(w, e, k, v, y0, Math.PI / 2, y1 - y0, P.w, warn, P.mul); else beamLane(w, e, k, x0, v, 0, x1 - x0, P.w, warn, P.mul);
    }
    w.emit({ t: 'colhum', x: Math.round(e.x), y: Math.round(e.y) });
  };
  // A laser from at() (a function: [x, y], read every tick) starting at a0, warm s of warning, then turning rate rad/s for t s; its length stops at the first wall or pillar.
  const laserSweep = (w, col, e, k, at, a0, rate, t, warm, P) => {
    const o = at();
    w.addZone(neon({ kind: 'laser', x: o[0], y: o[1], a: a0, len: reach(w, o[0], o[1], a0), w: P.w, warm, dur: warm + t, dmg: e.dmg * P.mul, team: 1, src: e, arc: rate * t,
      update: (ww, z, ddt) => { const q = at(); z.x = q[0]; z.y = q[1]; if (z.t > z.warm) z.a += rate * ddt; z.len = reach(ww, z.x, z.y, z.a); col.want.eye = z.a; } }, k));
    w.emit({ t: 'colhum', x: Math.round(o[0]), y: Math.round(o[1]) });
  };
  // Rolling saw (zone gsaw, custom): from (x, y) along a over len in dur s; C.gsawAt(z) is its centre (host and client alike). It hurts each hero it touches once.
  C.gsawAt = (z) => { const u = Math.min(1, z.t / z.dur) * z.len; return { x: z.x + Math.cos(z.a) * u, y: z.y + Math.sin(z.a) * u }; };
  function gsawTick(w, z) {
    const q = C.gsawAt(z);
    for (const p of w.players.values()) {
      if (p.downed || p.dead || z.hit.has(p.pid)) continue;
      const rr = z.r + p.r - 3;
      if (U.dist2(q.x, q.y, p.x, p.y) < rr * rr && w.hurtPlayer(p, z.dmg, { e: z.src, x: q.x, y: q.y })) z.hit.add(p.pid);
    }
  }
  // Fan lanes of the cannon e at hero p (warned dur s), its aim kept in col.want.
  const fanLanes = (w, col, e, m, p, dur) => {
    const a0 = aimAt(e, p); m.as = [];
    for (let i = 0; i < m.n; i++) { const a = a0 + (i - (m.n - 1) / 2) * MV.fan.spread; m.as.push(a); neon(line(w, e, e.x, e.y, a, 560, 12, dur, 0, true), 'cannon'); }
    col.want.cannon = a0;
  };
  const fanFire = (w, e, m) => { for (const a of m.as) shotAt(w, e, e.x, e.y - 4, a, MV.fan.speed, 'cbolt', MV.fan.mul, 6); w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: 'cbolt' }); };

  // Moves: part (whose aim and glow they drive), stump (an escalation of that part once broken: cast by the core), heavy (never the second of two at once), ok(w, col, e), start(w, col, m, e), update(w, col, m, e, dt) -> done.
  // m: { id, part, src, t (s since the start; stalls while src is frozen or stunned), k (src windMul at the start), at (first damaging moment, for the wire's move state) }.
  const MOVES = C.MOVES = {
    spiral: {
      part: 'cannon', heavy: true,
      start(w, col, m, e) { const P = MV.spiral; m.at = P.warn * m.k; m.arms = P.arms[col.open ? 1 : 0]; m.a0 = w.rng.range(0, TAU); m.dir = w.rng.sign(); m.n = 0; neon(tele(w, e, e.x, e.y, 64, m.at, 0, null), 'cannon').warnOnly = true; },
      update(w, col, m, e) {
        const P = MV.spiral;
        while (m.n < P.n && m.t >= m.at + m.n * P.gap) {
          const a = m.a0 + m.dir * m.n * P.step;
          for (let j = 0; j < m.arms; j++) shotAt(w, e, e.x, e.y - 4, a + j * TAU / m.arms, P.speed, 'cbolt', P.mul, 6);
          col.want.cannon = a;
          if (m.n % 4 === 0) w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: 'cbolt' });
          m.n++;
        }
        return m.n >= P.n && m.t >= m.at + P.n * P.gap + 0.3;
      },
    },
    fan: {
      part: 'cannon',
      start(w, col, m, e) { m.n = MV.fan.n[col.open ? 1 : 0]; m.at = MV.fan.warn * m.k; m.shots = 0; fanLanes(w, col, e, m, foeOf(w, e), m.at); },
      update(w, col, m, e) {
        if (m.shots === 0 && m.t >= m.at) { fanFire(w, e, m); m.shots = 1; m.at2 = m.t + MV.fan.re * m.k; fanLanes(w, col, e, m, foeOf(w, e), MV.fan.re * m.k); }
        else if (m.shots === 1 && m.t >= m.at2) { fanFire(w, e, m); m.shots = 2; }
        return m.shots === 2 && m.t >= m.at2 + 0.3;
      },
    },
    ring: {
      part: 'cannon',
      start(w, col, m, e) { m.at = MV.ring.warn * m.k; m.waves = MV.ring.waves[col.open ? 1 : 0]; m.n = 0; m.a0 = w.rng.range(0, TAU); neon(tele(w, e, e.x, e.y, 52, m.at, 0, null), 'cannon').warnOnly = true; },
      update(w, col, m, e) {
        const P = MV.ring;
        while (m.n < m.waves && m.t >= m.at + m.n * P.gap) { volley(w, e, e.x, e.y - 4, P.n, m.a0 + (m.n % 2) * Math.PI / P.n, P.speed, 'cbolt', P.mul); m.n++; }
        return m.n >= m.waves && m.t >= m.at + m.waves * P.gap;
      },
    },
    sweep: {
      part: 'saw', ok: (w, col, e) => { const p = foeOf(w, e); return U.dist2(p.x, p.y, e.x, e.y) < MV.sweep.near ** 2; },
      start(w, col, m, e) { const P = MV.sweep; m.a = aimAt(e, foeOf(w, e)); m.at = P.warn * m.k; m.side = w.rng.sign(); neon(cone(w, e, m.a, P.r, P.arc, m.at, P.mul), 'saw'); },
      update(w, col, m) { col.want.saw = m.a + m.side * MV.sweep.arc / 2 * (m.t < m.at ? -1 : 1); return m.t >= m.at + 0.4; },
    },
    roll: {
      part: 'saw',
      start(w, col, m, e) {
        const P = MV.roll, a0 = aimAt(e, foeOf(w, e));
        m.at = P.warn * m.k; m.lanes = (col.open ? [-P.split, P.split] : [0]).map(d => ({ a: a0 + d, len: Math.max(80, reach(w, e.x, e.y, a0 + d)) }));
        for (const l of m.lanes) neon(line(w, e, e.x, e.y, l.a, l.len, P.w, m.at, 0, true), 'saw');
        col.want.saw = a0;
      },
      update(w, col, m, e) {
        const P = MV.roll;
        if (!m.rolled && m.t >= m.at) {
          m.rolled = true;
          for (const l of m.lanes) w.addZone(neon({ kind: 'gsaw', custom: true, team: 1, x: e.x, y: e.y, a: l.a, len: l.len, w: P.w, r: P.w / 2, dur: l.len / P.speed, dmg: e.dmg * P.mul, src: e, hit: new Set(), update: gsawTick }, 'saw'));
          w.emit({ t: 'colsaw', x: Math.round(e.x), y: Math.round(e.y) });
        }
        return !!m.rolled && m.t >= m.at + 0.35;
      },
    },
    beam: {
      part: 'eye',
      start(w, col, m, e) {
        const P = MV.beam, a = aimAt(e, foeOf(w, e)), dir = w.rng.sign(), t = col.open ? P.fast : P.t;
        m.at = P.warn * m.k; m.end = m.at + t;
        laserSweep(w, col, e, 'eye', () => [e.x, e.y], a - dir * P.arc / 2, dir * P.arc / t, t, m.at, P);
      },
      update(w, col, m) { return m.t >= m.end + 0.3; },
    },
    grid: {
      part: 'eye', heavy: true,
      start(w, col, m, e) { m.at = MV.grid.warn * m.k; m.dir = w.rng.int(0, 1); m.two = false; gridWave(w, e, 'eye', m.dir, MV.grid, m.at); },
      update(w, col, m, e) {
        const P = MV.grid;
        if (!m.two && m.t >= m.at - P.lead) { m.two = true; m.end = m.t + P.warn * m.k; gridWave(w, e, 'eye', 1 - m.dir, P, P.warn * m.k); }
        return m.two && m.t >= m.end + 0.35;
      },
    },
    vent: {
      part: 'cannon', stump: true, heavy: true,
      start(w, col, m, e) { m.at = MV.vent.warn * m.k; gridWave(w, e, 'cannon', col.ventDir = 1 - (col.ventDir | 0), MV.vent, m.at, foeOf(w, e)); },
      update(w, col, m) { return m.t >= m.at + 0.35; },
    },
    stomp: {
      part: 'saw', stump: true,
      start(w, col, m, e) { const P = MV.stomp; m.at = P.warn * m.k; m.waves = P.waves[col.open ? 1 : 0]; m.n = 0; m.a0 = w.rng.range(0, TAU); neon(tele(w, e, e.x, e.y + 20, P.r, m.at, P.mul, 'slam'), 'core'); },
      update(w, col, m, e) {
        const P = MV.stomp;
        while (m.n < m.waves && m.t >= m.at + m.n * P.gap) {
          if (m.n === 0) w.emit({ t: 'colstomp', x: Math.round(e.x), y: Math.round(e.y + 20) });
          volley(w, e, e.x, e.y + 20, P.n, m.a0 + (m.n % 2) * Math.PI / P.n, P.speed, 'cspark', P.smul); m.n++;
        }
        return m.n >= m.waves && m.t >= m.at + m.waves * P.gap;
      },
    },
    blind: {
      part: 'eye', stump: true, heavy: true,
      start(w, col, m, e) {
        const P = MV.blind, dir = col.blindDir = -(col.blindDir || -1), arc = Math.PI + 2 * P.over, t = col.open ? P.fast : P.t;
        m.at = P.warn * m.k; m.end = m.at + t;
        laserSweep(w, col, e, 'core', () => [col.x + COL.OFF.eye[0], col.y + COL.OFF.eye[1]], dir > 0 ? -P.over : Math.PI + P.over, dir * arc / t, t, m.at, P);
      },
      update(w, col, m) { return m.t >= m.end + 0.25; },
    },
  };

  // Anchor of the Colossus in room: near the centre column, COL.TOP tiles down; the spot whose footprint (with the shuffle range) holds the fewest non-floor tiles. range: the shuffle range there (0 when walls are near).
  const colAnchor = (room) => {
    const c = D.center(room), blocked = (x, y, ext) => {
      let n = 0;
      for (let py = y - 72; py <= y + 44; py += T / 2) for (let px = x - 100 - ext; px <= x + 100 + ext; px += T / 2) { const t = D.tileAt(room, px, py); if (t !== 0 && t !== 4) n++; }
      return n;
    };
    let best = null;
    for (const dy of [0, T, -T / 2, 2 * T]) for (const dx of [0, -2 * T, 2 * T, -4 * T, 4 * T]) {
      const x = c.x + dx, y = COL.TOP * T + dy, full = blocked(x, y, COL.RANGE), s = full ? 1000 + blocked(x, y, 0) : 0;
      if (!best || s < best.s) best = { x, y, s, range: full ? 0 : COL.RANGE };
      if (!s) return best;
    }
    return best;
  };
  const place = (col, e) => { const o = COL.OFF[e.def.colo]; e.x = col.x + o[0]; e.y = col.y + o[1]; e.kbx = 0; e.kby = 0; };
  const tempo = (col) => (col.open ? COL.FINAL : 1) * Math.pow(COL.BROKE, col.nb);

  ED.AI.champion = (w, e, dt) => {
    if (e.type === 'twinlance') lanceBrain(w, e, dt);
    else if (e.type === 'twinhammer') hammerBrain(w, e, dt);
    else if (e.def.colo) { e.noTouch = true; const col = w.enc && w.enc.col; if (col) place(col, e); } // moves come from W.colossusTick; knockback and pulls never shift a piece
  };
  const lanceBrain = brain(LANCE, approach(70)), hammerBrain = brain(HAMMER, approach(60));

  // ---------- the encounter ----------
  // Locks the room and queues the champion fight: the foes land in telegraphed spawns after 1 s.
  W.startChampion = function (room) {
    this.locked = true;
    this.enc = { kind: 'champ', champ: room.champ === 'colossus' ? 'colossus' : 'twins', t: 1, spawned: false, foes: {}, rev: null, comboT: C.COMBO[0], combo: 0, col: null };
    room.arena = { k: 'champ', c: null };
    this.emit({ t: 'lock' });
    this.emit({ t: 'champ', k: this.enc.champ });
  };
  W.updateChampion = function (enc, dt) {
    const room = this.room, c = D.center(room); // enc.t counts down in updateEncounter
    if (!enc.spawned) {
      if (enc.t > 0) return;
      enc.spawned = true;
      const at = (dx) => D.clearSpot(room, c.x + dx, c.y);
      const put = (type, dx, key) => { const pt = at(dx); this.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 22, dur: 1.2, type, after: (en) => { setup(this, en); enc.foes[key] = en; } }); };
      if (enc.champ === 'twins') { put('twinlance', -70, 'lance'); put('twinhammer', 70, 'hammer'); }
      else { const h = colAnchor(room); this.addZone({ kind: 'spawn', x: h.x, y: h.y, r: 60, dur: 1.4, type: 'colossus', after: (en) => this.colossusBuild(enc, en, h) }); }
      return;
    }
    if (enc.champ === 'twins') this.twinsTick(enc, dt);
    else if (enc.col) this.colossusTick(enc, dt);
    const keys = Object.keys(enc.foes);
    if (keys.length && keys.every(k => !live(enc.foes[k])) && !enc.rev && this.hostiles() === 0 && !this.zones.some(z => z.kind === 'spawn')) {
      A.clear(room);
      this.roomCleared();
    }
  };

  // Twins: revive, rage and the combo director.
  W.twinsTick = function (enc, dt) {
    const L = enc.foes.lance, H = enc.foes.hammer, room = this.room;
    if (!L || !H) return;
    const lUp = live(L), hUp = live(H);
    if (enc.rev) {
      const partner = enc.rev.type === 'twinlance' ? H : L;
      if (!live(partner)) { enc.rev.dead = true; enc.rev = null; }
    } else if (lUp !== hUp) {
      const down = lUp ? H : L, up = lUp ? L : H, key = lUp ? 'hammer' : 'lance';
      const pt = D.clearSpot(room, down.x, down.y);
      up.rage = true; up.dmg = up.dmgBase * C.RAGE.dmg;
      this.emit({ t: 'twinfall', x: Math.round(pt.x), y: Math.round(pt.y), s: C.REVIVE });
      enc.rev = this.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 24, dur: C.REVIVE, type: down.type, revive: 1, after: (en) => {
        setup(this, en, C.REVIVE_HP); enc.foes[key] = en; enc.rev = null;
        const sv = enc.foes[key === 'hammer' ? 'lance' : 'hammer'];
        if (live(sv)) { sv.rage = false; sv.dmg = sv.dmgBase; }
        this.emit({ t: 'twinrise', x: Math.round(en.x), y: Math.round(en.y) });
      } });
    }
    if (!(lUp && hUp)) return;
    if ((enc.comboT -= dt) > 0 || L.mode === 'atk' || H.mode === 'atk' || L.stun > 0 || H.stun > 0 || L.frozen > 0 || H.frozen > 0) return;
    const p = L.target && !L.target.ghost && this.alive(L.target) ? L.target : this.nearestPlayer(L.x, L.y);
    if (!p) return;
    enc.comboT = this.rng.range(C.COMBO[0], C.COMBO[1]);
    if (enc.combo++ % 2 === 0) { // reel: the pull drags heroes to the Lancer, the Hammer lands in front of him as it ends
      const a = Math.atan2(p.y - L.y, p.x - L.x), spot = Sim.castMove(room, L.x, L.y, a, 46, H.r, this.locked);
      L.force = 'reel'; L.queued = null;
      H.force = 'crush'; H.queued = { to: [spot.x, spot.y], fl: 1.6, r: 95 };
    } else { // bind: the hero's ground binds, the Hammer lands there while it holds
      L.force = 'bind'; L.queued = { p };
      H.force = 'crush'; H.queued = { to: [p.x, p.y], fl: 1.5, r: 80 };
    }
  };

  // Colossus: the core lands in its spawn; the parts stand at their offsets the same tick (enc.foes core, cannon, saw, eye).
  W.colossusBuild = function (enc, core, h) {
    setup(this, core); core.noTouch = true;
    const col = enc.col = { core, parts: {}, all: [core], x: h.x, y: h.y, hx: h.x, range: h.range, b: 0, nb: 0, open: false, runs: [], pause: COL.FIRST, last: null, down: false,
      ang: Object.assign({}, COL.REST), want: Object.assign({}, COL.REST), blindDir: -1, ventDir: 0 };
    enc.foes.core = core;
    for (const k of COL.PARTS) {
      const o = COL.OFF[k], e = setup(this, this.spawnEnemy(COL.TYPE[k], h.x + o[0], h.y + o[1]));
      e.noTouch = true; col.parts[k] = e; col.all.push(e); enc.foes[k] = e;
    }
    if (this.room.arena) this.room.arena.c = { b: 0, o: 0, s: 0, a: COL.PARTS.map(k => COL.REST[k]) };
  };
  // Colossus director, every tick: breaks, the core's armour, the shuffle, the moves, the arena wire.
  W.colossusTick = function (enc, dt) {
    const col = enc.col, core = col.core;
    if (col.down) return;
    if (!live(core)) { this.colossusDown(col); return; }
    for (const k of COL.PARTS) if (!(col.b & BIT[k]) && !live(col.parts[k])) this.colossusBreak(col, k);
    if (!col.open && core.hp < core.maxHp * COL.FLOOR) core.hp = core.maxHp * COL.FLOOR;
    core.dmgTakenMul = col.open ? COL.OPEN : core.hp > core.maxHp * COL.FLOOR + 1e-6 ? COL.ARMOR : 0;
    if (!col.runs.length && !(core.stun > 0 || core.frozen > 0)) { // shuffle toward the nearest hero's column within the range
      const p = this.nearestPlayer(col.x, col.y);
      if (p) { const d = U.clamp(p.x, col.hx - col.range, col.hx + col.range) - col.x; col.x += Math.sign(d) * Math.min(Math.abs(d), COL.SPD * dt); }
    }
    for (const e of col.all) if (live(e)) place(col, e);
    let fin = false;
    for (const m of col.runs) {
      const e = m.src;
      if (!live(e)) { m.done = true; continue; }
      if (e.frozen > 0 || e.stun > 0) continue;
      m.t += dt;
      if (MOVES[m.id].update(this, col, m, e, dt)) { m.done = true; fin = true; }
    }
    if (col.runs.some(m => m.done)) col.runs = col.runs.filter(m => !m.done);
    if (fin) col.pause = Math.max(col.pause, this.rng.range(COL.PAUSE[0], COL.PAUSE[1]) * tempo(col));
    col.pause -= dt;
    if (col.pause <= 0 && col.runs.length < (col.open ? 2 : 1) && (!col.runs.length || col.runs[0].t >= COL.GAP2) && this.alivePlayers().length) {
      const id = this.colossusPick(col);
      if (id) this.colossusStart(col, id);
    }
    let s = 0;
    for (const m of col.runs) { const st = m.t < (m.at || 0) ? 1 : 2; s |= st << (2 * COL.PARTS.indexOf(m.part)); if (m.id === 'stomp') s |= st << 6; }
    for (const k of COL.PARTS) {
      if (!col.runs.some(m => m.part === k)) col.want[k] = COL.REST[k];
      const d = U.angDiff(col.ang[k], col.want[k]);
      col.ang[k] += U.clamp(d, -COL.TURN * dt, COL.TURN * dt);
    }
    if (this.room.arena && this.room.arena.k === 'champ') this.room.arena.c = { b: col.b, o: col.open ? 1 : 0, s, a: COL.PARTS.map(k => Math.round(col.ang[k] * 100) / 100) };
  };
  // A move for the director: part moves of standing parts, escalations of broken ones, from a source neither frozen, stunned nor blind; not the last one when another fits.
  // The second of two at once is light and of another part.
  W.colossusPick = function (col) {
    const first = col.runs[0], ids = [];
    for (const id in MOVES) {
      const M = MOVES[id], broken = !!(col.b & BIT[M.part]), e = M.stump ? col.core : col.parts[M.part];
      if (M.stump ? !broken : broken) continue;
      if (!live(e) || e.stun > 0 || e.frozen > 0 || e.blind > 0) continue;
      if (first && (M.heavy || M.part === first.part)) continue;
      if (M.ok && !M.ok(this, col, e)) continue;
      ids.push(id);
    }
    const pool = ids.length > 1 ? ids.filter(id => id !== col.last) : ids;
    return pool.length ? this.rng.weighted(pool, id => (MOVES[id].stump ? 1.3 : 1)) : null;
  };
  W.colossusStart = function (col, id) {
    const M = MOVES[id], e = M.stump ? col.core : col.parts[M.part], m = { id, part: M.part, src: e, t: 0, k: e.windMul || 1, at: 0 };
    col.runs.push(m); col.last = id; col.pause = 0;
    M.start(this, col, m, e);
    this.emit({ t: 'colmv', k: id, x: Math.round(e.x), y: Math.round(e.y) });
  };
  // A part broke: its moves and beams stop, a breather, and the second break opens the core.
  W.colossusBreak = function (col, k) {
    const e = col.parts[k];
    col.b |= BIT[k]; col.nb++;
    col.runs = col.runs.filter(m => m.src !== e);
    for (const z of this.zones) if (z.src === e && z.kind === 'laser') z.dead = true;
    this.emit({ t: 'colbreak', k: COL.PARTS.indexOf(k), x: Math.round(e.x), y: Math.round(e.y) });
    col.pause = Math.max(col.pause, COL.BREATH);
    if (!col.open && col.nb >= COL.OPEN_AT) { col.open = true; col.pause = Math.max(col.pause, COL.OPENED); this.emit({ t: 'colopen', x: Math.round(col.core.x), y: Math.round(col.core.y) }); }
  };
  // The core fell: the standing parts fall with it, its telegraphs, beams and saws go.
  W.colossusDown = function (col) {
    col.down = true; col.runs = [];
    for (const e of col.all) if (live(e)) this.killEnemy(e, null, {});
    for (const z of this.zones) if (z.team === 1 && col.all.includes(z.src)) z.dead = true;
    this.emit({ t: 'coldown', x: Math.round(col.x), y: Math.round(col.y) });
  };
})(globalThis.ED || (globalThis.ED = {}));
