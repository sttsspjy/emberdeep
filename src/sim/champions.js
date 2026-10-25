// Champion rooms (stratum IV, room.champ 'twins' | 'mimic'), started by W.startChampion(room) when the room locks; the fight ends when every foe is down and roomCleared pays the room's reward.
// Twins: the Lancer (thrust, sweep) and the Hammer (slam, leap, quake) act alone and every COMBO s together: the Lancer reels heroes in or binds one, the Hammer lands on the spot.
// A fallen twin rises at REVIVE_HP of its health after REVIVE s while the other stands (the survivor rages meanwhile); both down ends the fight.
// Mimic: copies the party's heroes, telegraphed patterns per hero class (COPY; the Bellwarden's join when that class exists); at SPLIT of its health it splits into two weaker copies that share the classes.
// Champion HP is the def's HP x the stratum's elite factor (World.ELITE); hero stuns on them last ELITE_STUN as on elites.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon, TAU = U.TAU, A = ED.Arena, B = ED.Bosses, W = ED.World.prototype, Wd = ED.World;
  const { line, cone, aim, mv, tele, drop, approach, ring } = B.lib;

  const C = ED.Champions = {
    REVIVE: 10, REVIVE_HP: 0.5, RAGE: { pause: 0.6, dmg: 1.25 }, COMBO: [7, 9], SPLIT: 0.5, COPY_DMG: 0.8, PAUSE: [0.7, 1.1],
    COPY: { knight: ['charge', 'shield'], ranger: ['volley', 'rain'], pyro: ['fireball', 'meteor'], shade: ['step', 'knives'], cleric: ['lance', 'smite'], necro: ['raise', 'spear'] },
  };
  const isChamp = (e) => !!(e && e.def && e.def.champ);
  // Champions take hero stuns like elites.
  const stun0 = W.stunFoe;
  W.stunFoe = function (e, dur, repeating) { return stun0.call(this, e, isChamp(e) ? dur * ED.CONST.ELITE_STUN : dur, repeating); };

  // Wire of the 'champ' arena: per mimic foe [id, class index] (the class it copies, drawn over it).
  A.reg('champ', {
    id: 3,
    encode: (ar) => [].concat(...ar.m),
    decode: (room, r, ar) => { ar.m = []; for (let i = 1; i + 1 < r.length; i += 2) ar.m.push([r[i], r[i + 1]]); },
  });

  // HP of a champion: x the stratum's elite factor, times frac.
  const setup = (w, e, frac) => {
    const k = Wd.ELITE.hp + Wd.ELITE.hpStep * (w.stratum - 1);
    e.maxHp *= k; e.hp = e.maxHp * (frac || 1); e.dmgBase = e.dmg;
    e.mode = 'idle'; e.t = 1; e.st = 'move'; e.force = null; e.vars = { wm: 1 };
    return e;
  };

  // ---------- the attack runner of one champion ----------
  // table[k] = { w (weight), ok(w, e), start(w, e), update(w, e, dt, t) -> done }. e.mode: 'idle' | 'atk'; e.force names an attack the director queued; e.st carries the drawn pose (windup, charge, cast, move).
  const brain = (table, idle) => (w, e, dt) => {
    if (e.mode === 'atk') {
      e.t += dt;
      if (table[e.atk].update(w, e, dt, e.t)) { e.mode = 'idle'; e.st = 'move'; e.t = w.rng.range(C.PAUSE[0], C.PAUSE[1]) * (e.rage ? C.RAGE.pause : 1); }
      return;
    }
    e.t -= dt;
    idle(w, e, dt);
    let k = null;
    if (e.force && table[e.force]) k = e.force;
    else if (e.t <= 0 && !(e.blind > 0) && w.alivePlayers().length) {
      const keys = Object.keys(table).filter(id => table[id].w && id !== e.last && (!table[id].ok || table[id].ok(w, e)));
      if (keys.length) k = w.rng.weighted(keys, id => table[id].w);
    }
    if (!k) return;
    e.force = null; e.atk = k; e.last = k; e.mode = 'atk'; e.t = 0; e.vars = Object.assign({ wm: e.windMul || 1 }, e.queued || {}); e.queued = null;
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
  // A shot out along a warned lane that turns back to its caster at the lane's end.
  const boomerang = (w, e, t, v, kind, len, sp, mul, r) => {
    const life = len / sp;
    if (!v.out && t >= v.at) v.out = w.enemyShoot(e, v.a, sp, kind, mul, r, { life });
    if (v.out && !v.back && t >= v.at + life) {
      const q = v.out, d = Math.hypot(e.x - q.x, e.y - q.y);
      v.back = w.spawnProj({ team: 1, kind, x: q.x, y: q.y, a: Math.atan2(e.y - q.y, e.x - q.x), speed: Math.hypot(q.vx, q.vy) || sp, r, dmg: e.dmg * mul, life: Math.max(0.2, d / sp), src: e });
      q.dead = true;
    }
    return !!v.back && t >= v.at + life + 0.4;
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

  // ---------- Mimic ----------
  const MIMIC = {
    charge: { start(w, e) { pose(e, 'windup'); const v = e.vars; v.a = aim(e); v.at = 0.75 * v.wm; line(w, e, e.x, e.y, v.a, 330, e.r * 2 + 6, v.at, 0, true); }, update(w, e, dt, t) { return dashAlong(w, e, dt, t, e.vars, 520, 0.55, 0.3); } },
    shield: { start(w, e) { pose(e, 'windup'); const v = e.vars; v.a = aim(e); v.at = 0.6 * v.wm; line(w, e, e.x, e.y, v.a, 360, 22, v.at, 0, true); }, update(w, e, dt, t) { if (t >= e.vars.at) pose(e, 'cast'); return boomerang(w, e, t, e.vars, 'shield', 360, 480, 1.1, 9); } },
    volley: {
      start(w, e) { pose(e, 'windup'); const v = e.vars, a0 = aim(e); v.at = 0.7 * v.wm; v.as = [-2, -1, 0, 1, 2].map(i => a0 + i * 0.22); for (const a of v.as) line(w, e, e.x, e.y, a, 560, 12, v.at, 0, true); },
      update(w, e, dt, t) { const v = e.vars; if (!v.fired && t >= v.at) { v.fired = true; pose(e, 'cast'); for (const a of v.as) w.enemyShoot(e, a, 460, 'arrow', 0.9, 5); } return t >= v.at + 0.4; },
    },
    rain: {
      start(w, e) { pose(e, 'cast'); const k = e.vars.wm; for (const p of w.alivePlayers()) for (let j = 0; j < 4; j++) { const pt = j ? Sim.castMove(w.room, p.x, p.y, w.rng.range(0, TAU), w.rng.range(40, 100), 8, true) : { x: p.x, y: p.y }; drop(w, e, pt.x, pt.y, 40, (0.9 + j * 0.18) * k, 0.9, 'shock'); } },
      update(w, e, dt, t) { return t > 1.6 * e.vars.wm; },
    },
    fireball: {
      start(w, e) { pose(e, 'cast'); const p = e.target, k = e.vars.wm; tele(w, e, p.x, p.y, 60, 1.0 * k, 1.2, 'fire', (ww, z) => ww.addZone({ kind: 'fire', x: z.x, y: z.y, r: 50, dur: 3, dps: e.dmg * 0.4, team: 1 })); },
      update(w, e, dt, t) { return t > 1.3 * e.vars.wm; },
    },
    meteor: {
      start(w, e) { pose(e, 'cast'); const p = e.target; tele(w, e, p.x, p.y, 100, 1.5 * e.vars.wm, 1.6, 'bigfire'); w.emit({ t: 'tell', k: 'meteor', x: Math.round(p.x), y: Math.round(p.y) }); },
      update(w, e, dt, t) { return t > 1.8 * e.vars.wm; },
    },
    step: {
      start(w, e) { pose(e, 'windup'); const v = e.vars, p = e.target; v.at = 0.7 * v.wm; v.pt = Sim.castMove(w.room, p.x, p.y, Math.atan2(p.y - e.y, p.x - e.x), 50, e.r, true); w.addZone({ kind: 'tele', x: v.pt.x, y: v.pt.y, r: e.r + 6, dur: v.at, dmg: 0, team: 1, src: e, warnOnly: true }); },
      update(w, e, dt, t) {
        const v = e.vars;
        if (!v.done && t >= v.at) { v.done = true; w.emit({ t: 'blinkfx', x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(v.pt.x), y1: Math.round(v.pt.y) }); e.x = v.pt.x; e.y = v.pt.y; cone(w, e, aim(e), 100, 1.8, 0.35 * v.wm, 1.3, () => pose(e, 'slam')); v.end = t + 0.35 * v.wm + 0.3; }
        return !!v.done && t >= v.end;
      },
    },
    knives: {
      start(w, e) { pose(e, 'windup'); const v = e.vars; v.a = aim(e); v.at = 0.55 * v.wm; w.addZone({ kind: 'teleCone', x: e.x, y: e.y, a: v.a, r: 300, arc: 1.2, dur: v.at, dmg: 0, team: 1, src: e, warnOnly: true }); },
      update(w, e, dt, t) { const v = e.vars; if (!v.fired && t >= v.at) { v.fired = true; pose(e, 'cast'); for (let i = -3; i <= 3; i++) w.enemyShoot(e, v.a + i * 0.17, 400, 'knife', 0.8, 5); } return t >= v.at + 0.35; },
    },
    lance: {
      start(w, e) { pose(e, 'windup'); e.vars.at = 0.9 * e.vars.wm; line(w, e, e.x, e.y, aim(e), 600, 22, e.vars.at, 1.4); },
      update(w, e, dt, t) { if (t >= e.vars.at) pose(e, 'cast'); return t >= e.vars.at + 0.3; },
    },
    smite: {
      start(w, e) { pose(e, 'cast'); const k = e.vars.wm; for (const p of w.alivePlayers()) drop(w, e, p.x, p.y, 44, 1.0 * k, 1.2, 'shock'); for (let j = 0; j < 2; j++) { const pt = D.randomFloor(w.room, w.rng, null, 0); drop(w, e, pt.x, pt.y, 44, 1.2 * k, 1.2, 'shock'); } },
      update(w, e, dt, t) { return t > 1.5 * e.vars.wm; },
    },
    raise: {
      ok: (w) => w.hostiles(true) < 5,
      start(w, e) { pose(e, 'cast'); const avoid = w.alivePlayers(); for (let j = 0; j < 2; j++) { const pt = D.randomFloor(w.room, w.rng, avoid, 110); w.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 16, dur: 0.95 * e.vars.wm, type: 'skeleton' }); } },
      update(w, e, dt, t) { return t > 1.3 * e.vars.wm; },
    },
    spear: {
      start(w, e) { pose(e, 'windup'); const v = e.vars, a0 = aim(e); v.at = 0.7 * v.wm; v.as = [-0.3, 0, 0.3].map(d => a0 + d); for (const a of v.as) line(w, e, e.x, e.y, a, 600, 14, v.at, 0, true); },
      update(w, e, dt, t) { const v = e.vars; if (!v.fired && t >= v.at) { v.fired = true; pose(e, 'cast'); for (const a of v.as) w.enemyShoot(e, a, 520, 'bone', 1.0, 6); } return t >= v.at + 0.4; },
    },
    // Bellwarden: the bell swung around on its chain (a ring around the mimic), Heave (the bell flung down a lane, landing in a circle), Peal (a warned shockwave ring of shots).
    chain: {
      ok: (w, e) => !!e.target && U.dist2(e.x, e.y, e.target.x, e.target.y) < 160 * 160,
      start(w, e) { pose(e, 'windup'); tele(w, e, e.x, e.y, 96, 0.8 * e.vars.wm, 1.2, 'slam', () => pose(e, 'slam')); },
      update(w, e, dt, t) { return t > 0.8 * e.vars.wm + 0.35; },
    },
    heave: {
      start(w, e) {
        pose(e, 'windup');
        const v = e.vars, a = aim(e), d = U.clamp(Math.hypot(e.target.x - e.x, e.target.y - e.y), 80, 300), pt = Sim.castMove(w.room, e.x, e.y, a, d, 8, true);
        line(w, e, e.x, e.y, a, Math.hypot(pt.x - e.x, pt.y - e.y), 16, 0.7 * v.wm, 0, true);
        tele(w, e, pt.x, pt.y, 54, 1.0 * v.wm, 1.3, 'slam');
      },
      update(w, e, dt, t) { if (t >= 0.7 * e.vars.wm) pose(e, 'cast'); return t > 1.0 * e.vars.wm + 0.3; },
    },
    peal: {
      start(w, e) { pose(e, 'cast'); e.vars.at = 0.7 * e.vars.wm; w.addZone({ kind: 'tele', x: e.x, y: e.y, r: 70, dur: e.vars.at, dmg: 0, team: 1, src: e, warnOnly: true }); },
      update(w, e, dt, t) { const v = e.vars; if (!v.fired && t >= v.at) { v.fired = true; ring(w, e, 16, 150, 'void', 0, 0.7, 6); w.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y), big: 1 }); } return t >= v.at + 0.4; },
    },
  };
  if (ED.CLASSES.bell) C.COPY.bell = ['chain', 'heave', 'peal'];
  // The mimic's table: each move it copies has weight 1; ok also needs the move's own check.
  const MTABLE = {};
  for (const k in MIMIC) MTABLE[k] = Object.assign({}, MIMIC[k], { w: 1, ok: (w, e) => !!e.copies && e.copies.some(c => (C.COPY[c] || []).includes(k)) && (!MIMIC[k].ok || MIMIC[k].ok(w, e)) });
  const mimicBrain = brain(MTABLE, approach(130));
  const lanceBrain = brain(LANCE, approach(70)), hammerBrain = brain(HAMMER, approach(60));
  ED.AI.champion = (w, e, dt) => {
    if (e.type === 'twinlance') lanceBrain(w, e, dt);
    else if (e.type === 'twinhammer') hammerBrain(w, e, dt);
    else if (e.type === 'mimic') {
      mimicBrain(w, e, dt);
      if (e.mode === 'atk' && e.atk) { const cls = e.copies.find(c => (C.COPY[c] || []).includes(e.atk)); if (cls && cls !== e.cls) { e.cls = cls; w.emit({ t: 'mimic', x: Math.round(e.x), y: Math.round(e.y), cls }); } }
    }
  };

  // ---------- the encounter ----------
  // Locks the room and queues the champion fight: the foes land in telegraphed spawns after 1 s.
  W.startChampion = function (room) {
    this.locked = true;
    this.enc = { kind: 'champ', champ: room.champ === 'mimic' ? 'mimic' : 'twins', t: 1, spawned: false, foes: {}, rev: null, comboT: C.COMBO[0], combo: 0 };
    room.arena = { k: 'champ', m: [] };
    this.emit({ t: 'lock' });
    this.emit({ t: 'champ', k: this.enc.champ });
  };
  const live = (e) => !!e && e.hp > 0 && !e.killed;
  W.updateChampion = function (enc, dt) {
    const room = this.room, c = D.center(room); // enc.t counts down in updateEncounter
    if (!enc.spawned) {
      if (enc.t > 0) return;
      enc.spawned = true;
      const at = (dx) => D.clearSpot(room, c.x + dx, c.y);
      const put = (type, dx, key, then) => { const pt = at(dx); this.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 22, dur: 1.2, type, after: (en) => { setup(this, en); enc.foes[key] = en; if (then) then(en); } }); };
      if (enc.champ === 'twins') { put('twinlance', -70, 'lance'); put('twinhammer', 70, 'hammer'); }
      else put('mimic', 0, 'm0', (en) => { en.copies = classesOf(this); en.cls = en.copies[0]; });
      return;
    }
    if (enc.champ === 'twins') this.twinsTick(enc, dt);
    else for (const k in enc.foes) { const e = enc.foes[k]; if (live(e) && !e.split && e.hp <= e.maxHp * C.SPLIT) this.mimicSplit(enc, e); }
    if (room.arena && room.arena.k === 'champ') room.arena.m = Object.values(enc.foes).filter(e => live(e) && e.type === 'mimic').map(e => [e.id, Math.max(0, ED.CLASS_IDS.indexOf(e.cls))]);
    const keys = Object.keys(enc.foes);
    if (keys.length && keys.every(k => !live(enc.foes[k])) && !enc.rev && this.hostiles() === 0 && !this.zones.some(z => z.kind === 'spawn')) {
      A.clear(room);
      this.roomCleared();
    }
  };
  const classesOf = (w) => { const out = []; for (const p of w.players.values()) if (!out.includes(p.cls)) out.push(p.cls); return out.length ? out : ['knight']; };

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

  // Mimic split: the mimic and a new copy each keep half of the health left (dmg x COPY_DMG) and share the classes.
  W.mimicSplit = function (enc, e) {
    const pt = Sim.castMove(this.room, e.x, e.y, this.rng.range(0, TAU), 60, e.r, this.locked);
    const cp = setup(this, this.spawnEnemy('mimic', pt.x, pt.y), 1);
    const half = e.hp / 2, cls = e.copies;
    for (const m of [e, cp]) { m.split = true; m.maxHp = e.maxHp / 2; m.hp = half; m.dmgBase = e.dmgBase * C.COPY_DMG; m.dmg = m.dmgBase; m.r = Math.max(10, Math.round(e.def.r * 0.85)); }
    e.copies = cls.length > 1 ? cls.filter((c, i) => i % 2 === 0) : cls.slice();
    cp.copies = cls.length > 1 ? cls.filter((c, i) => i % 2 === 1) : cls.slice();
    e.cls = e.copies[0]; cp.cls = cp.copies[0];
    enc.foes['m' + Object.keys(enc.foes).length] = cp;
    this.emit({ t: 'msplit', x: Math.round(e.x), y: Math.round(e.y), x1: Math.round(cp.x), y1: Math.round(cp.y) });
  };
})(globalThis.ED || (globalThis.ED = {}));
