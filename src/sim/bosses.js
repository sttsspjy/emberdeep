// Boss scripts. Each boss cycles weighted attacks; phase thresholds unlock harder patterns.
// Every telegraph/wind-up time is scaled by e.vars.wm (the boss's windMul when the attack began, set by the runner).
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon, TAU = U.TAU;
  const B = ED.Bosses = {}, Wd = ED.World;

  // ---------- helpers ----------
  const tele = (w, e, x, y, r, dur, mul, boom, onEnd) => w.addZone({ kind: 'tele', x, y, r, dur, dmg: e.dmg * mul, team: 1, src: e, boom, onEnd });
  // Ground burst the boss has already launched (spikes, spore fields, mire, fire rain): runs on its own clock, ignores the boss being frozen or dead.
  const drop = (...a) => { const z = tele(...a); z.detached = true; return z; };
  const line = (w, e, x, y, a, len, width, dur, mul, warnOnly) => w.addZone({ kind: 'teleLine', x, y, a, len, w: width, dur, dmg: e.dmg * mul, team: 1, src: e, warnOnly });
  const cone = (w, e, a, r, arc, dur, mul, onEnd) => w.addZone({ kind: 'teleCone', x: e.x, y: e.y, a, r, arc, dur, dmg: e.dmg * mul, team: 1, src: e, onEnd });
  const ring = (w, e, n, speed, kind, off, mul, r) => { for (let i = 0; i < n; i++) w.enemyShoot(e, off + i * TAU / n, speed, kind, mul, r); w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: kind }); };
  const aim = (e) => (e.target ? Math.atan2(e.target.y - e.y, e.target.x - e.x) : e.aimA || 0); // late tele callbacks can fire with every hero down
  const mv = (w, e, dx, dy, speed, dt) => { const hit = Sim.moveCircle(e, dx * speed * dt, dy * speed * dt, w.room, w.locked, false); if (Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1; return hit; };
  // A summon list grown by one entry per living hero beyond the first (at most 3), each drawn from the list itself.
  const grow = (w, list) => {
    const extra = Math.min(3, w.alivePlayers().length - 1);
    if (extra <= 0) return list;
    const out = list.slice();
    for (let i = 0; i < extra; i++) out.push(list[w.rng.int(0, list.length - 1)]);
    return out;
  };
  // Queues telegraphed spawn zones; returns how long the attack should last.
  const summon = (w, e, list) => {
    const avoid = [...w.players.values()], dur = 0.95 * e.vars.wm;
    for (const type of grow(w, list)) {
      const pt = D.randomFloor(w.room, w.rng, avoid, 110);
      w.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 16, dur, type });
    }
    return dur + 0.35;
  };
  const approach = (pref) => (w, e, dt) => {
    const d = Math.hypot(e.target.x - e.x, e.target.y - e.y);
    e.pose = 'idle';
    if (d > pref) { const dir = w.pathDir(e, e.target.x, e.target.y); mv(w, e, dir[0], dir[1], e.spd * e.slow, dt); }
    else { const a = aim(e) + Math.PI / 2 * e.strafe; if (mv(w, e, Math.cos(a), Math.sin(a), e.spd * 0.4 * e.slow, dt)) e.strafe = -e.strafe; e.face = e.target.x > e.x ? 1 : -1; }
  };

  // ---------- aimed volley (every boss) ----------
  // e.vol runs beside the main state: per living, unhidden hero (else the boss's target) a warn line follows the led aim and locks for the last BOSS_VOL.lock s, then BOSS_VOL.n[phase] shots come BOSS_VOL.gap apart,
  // each angled by World.leadAngle at its release; the heroes' sequences start BOSS_VOL.seq s apart. Flight speed speed + step per stratum (x1.2 under Pact 8+): enemyShoot gets it divided by the factors it re-applies (boss shot factor, Pact 8).
  const VOL_KIND = { bonewarden: 'bone', sporemother: 'spore', rimeheart: 'ice', forgelord: 'fire', drownedking: 'trident', hollowking: 'void' };
  const volSpeed = (w) => (Wd.BOSS_VOL.speed + Wd.BOSS_VOL.step * (w.stratum - 1)) * (w.pact >= 8 ? 1.2 : 1);
  const volAim = (w, e, tg) => Wd.leadAngle(e.x, e.y - 4, tg, volSpeed(w), Wd.LEAD[U.clamp(w.stratum - 1, 0, Wd.LEAD.length - 1)]);
  const volShot = (w, e, kind, tg) => {
    w.enemyShoot(e, volAim(w, e, tg), volSpeed(w) / (Wd.bossShotSpd(w.stratum) * (w.pact >= 8 ? 1.2 : 1)), kind, Wd.BOSS_VOL.dmg, 6);
    w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: kind });
  };
  const startVolley = (w, e) => {
    const hs = w.alivePlayers().filter(p => !(p.stealthT > 0)), tgs = hs.length ? hs : e.target ? [e.target] : [], V = Wd.BOSS_VOL;
    if (!tgs.length) return false;
    const v = e.vol = { t: 0, n: V.n[Math.min(e.phase, V.n.length) - 1], kind: VOL_KIND[e.type] || 'bone', tele: V.tele * (e.windMul || 1), seqs: [] };
    tgs.forEach((tg, i) => {
      const at = v.tele + i * V.seq;
      const z = w.addZone({ kind: 'teleLine', x: e.x, y: e.y - 4, a: volAim(w, e, tg), len: 640, w: 14, dur: at, dmg: 0, team: 1, src: e, warnOnly: true,
        update: (ww, zz) => { zz.x = e.x; zz.y = e.y - 4; if (v.t < at - V.lock && (tg.ghost || ww.alive(tg))) zz.a = volAim(ww, e, tg); } });
      v.seqs.push({ tg, at, k: 0, z });
    });
    e.ovT = Wd.BOSS_OV_GAP;
    return true;
  };
  const cancelVolley = (e) => { if (e.vol) for (const sq of e.vol.seqs) sq.z.dead = true; e.vol = null; };
  const tickVolley = (w, e, dt) => {
    const v = e.vol, V = Wd.BOSS_VOL;
    let more = false;
    v.t += dt;
    for (const sq of v.seqs) {
      while (sq.k < v.n && v.t >= sq.at + sq.k * V.gap) { sq.k++; if (sq.tg.ghost || w.alive(sq.tg)) volShot(w, e, v.kind, sq.tg); }
      if (sq.k < v.n) more = true;
    }
    if (!more) e.vol = null;
  };
  // The attack-table entry: the main state waits until the volley it started ends.
  const VOLLEY = {
    w: 2, ok: (w, e) => !e.vol,
    start(w, e) { e.pose = 'wind'; if (!e.vol) startVolley(w, e); },
    update(w, e) { const v = e.vol; if (v) e.pose = v.t < v.tele ? 'wind' : 'cast'; return !v; },
  };

  // Every boss: its attack table plus the volley (weight 2, all phases); the volley also self-starts every BOSS_OV_GAP s in phase 3 whatever the main state does, never while one runs. The returned function carries the table as .attacks.
  const runner = (attacks, opts) => Object.assign((w, e, dt) => {
    const phases = opts.phases || [0.66, 0.33]; // three phases: the last third attacks at the fastest tempo
    while (e.phase - 1 < phases.length && e.hp / e.maxHp < phases[e.phase - 1]) {
      e.phase++; e.invulnT = 1.0; e.st = 'idle'; e.t = 1.3; e.pose = 'roar'; cancelVolley(e); e.ovT = Wd.BOSS_OV_GAP;
      w.emit({ t: 'phase', p: e.phase, x: Math.round(e.x), y: Math.round(e.y), type: e.type });
      if (opts.onPhase) opts.onPhase(w, e, e.phase);
      return;
    }
    if (opts.tick) opts.tick(w, e, dt);
    if (e.phase >= 3) e.ovT = (e.ovT === undefined ? Wd.BOSS_OV_GAP : e.ovT) - dt;
    if (e.vol) { if (e.blind > 0) cancelVolley(e); else tickVolley(w, e, dt); } // a blinded boss drops its volley
    else if (e.phase >= 3 && e.ovT <= 0 && !(e.blind > 0) && w.alivePlayers().length) startVolley(w, e);
    if (e.st === 'atk') {
      e.t += dt;
      if (attacks[e.atk].update(w, e, dt, e.t)) {
        e.st = 'idle'; e.pose = 'idle';
        e.t = (e.phase >= 3 ? 0.45 : e.phase === 2 ? 0.7 : 1.05) * (w.pact >= 5 ? 0.8 : 1) * w.threat().pause;
      }
      return;
    }
    e.t -= dt;
    (opts.idle || approach(120))(w, e, dt);
    if (e.t <= 0 && !(e.blind > 0) && w.alivePlayers().length) { // blinded bosses keep moving but start nothing; no attack starts once every hero is down
      const keys = Object.keys(attacks).filter(k => (attacks[k].phase || 1) <= e.phase && k !== e.last && (!attacks[k].ok || attacks[k].ok(w, e)));
      const k = w.rng.weighted(keys.length ? keys : Object.keys(attacks), x => attacks[x].w || 1);
      e.atk = k; e.last = k; e.st = 'atk'; e.t = 0; e.vars = { wm: e.windMul || 1 };
      if (attacks[k].start) attacks[k].start(w, e);
    }
  }, { attacks: Object.assign(attacks, { volley: VOLLEY }) });

  // ---------- I. The Bone Warden ----------
  B.bonewarden = runner({
    charge: {
      w: 3,
      start(w, e) { e.vars.n = e.phase >= 2 ? 2 : 1; e.vars.i = 0; e.vars.sub = 'aim'; e.vars.st = 0; e.vars.aimT = 0.75 * e.vars.wm; e.aimA = aim(e); e.pose = 'wind'; line(w, e, e.x, e.y, e.aimA, 420, e.r * 2, e.vars.aimT, 0, true); },
      update(w, e, dt, t) {
        if (e.vars.sub === 'aim') { if (t >= e.vars.st + e.vars.aimT) { e.vars.sub = 'go'; e.vars.st = t; e.pose = 'dash'; e.st2 = 'charge'; } return false; }
        const hit = mv(w, e, Math.cos(e.aimA), Math.sin(e.aimA), 440, dt);
        if (hit || t - e.vars.st > 0.95) {
          if (hit) { w.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y), big: 1 }); ring(w, e, 10, 150, 'bone', w.rng.range(0, 1), 0.7, 6); }
          e.vars.i++;
          if (e.vars.i < e.vars.n) { e.vars.sub = 'aim'; e.vars.st = t + 0.25; e.aimA = aim(e); e.pose = 'wind'; line(w, e, e.x, e.y, e.aimA, 420, e.r * 2, 0.25 + e.vars.aimT, 0, true); }
          else { e.pose = 'idle'; return t - e.vars.st > 0.5 || hit; }
        }
        return false;
      },
    },
    ring: {
      w: 3,
      start(w, e) { e.pose = 'cast'; },
      update(w, e, dt, t) {
        const n = e.phase >= 2 ? 16 : 12, k = e.vars.k || 0;
        if (k < 3 && t > 0.5 * e.vars.wm + k * 0.55) { ring(w, e, n, 135, 'bone', (k % 2) * TAU / n / 2, 0.8, 6); e.vars.k = k + 1; }
        return t > 2.2 + 0.5 * (e.vars.wm - 1);
      },
    },
    summon: {
      w: 2, ok: (w) => w.hostiles(true) < 6,
      start(w, e) { e.pose = 'cast'; e.vars.end = summon(w, e, e.phase >= 2 ? ['skeleton', 'skeleton', 'bat', 'bat', 'bat'] : ['skeleton', 'skeleton', 'skeleton']); },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
    spiral: {
      w: 2, phase: 2,
      start(w, e) { e.pose = 'cast'; e.vars.a = w.rng.range(0, TAU); e.vars.f = 0; },
      update(w, e, dt, t) {
        e.vars.a += 2.1 * dt; e.vars.f -= dt;
        if (e.vars.f <= 0 && t > 0.4 * e.vars.wm) { e.vars.f = 0.11; for (let k = 0; k < 2; k++) w.enemyShoot(e, e.vars.a + k * Math.PI, 150, 'bone', 0.7, 6); }
        return t > 2.9;
      },
    },
    // Bone spikes erupt outward in lines fanned around the hero; the gap between lines is the safe lane.
    spikes: {
      w: 3,
      start(w, e) {
        e.pose = 'cast';
        const lines = e.phase >= 2 ? 3 : 2, a0 = aim(e), k = e.vars.wm;
        for (let li = 0; li < lines; li++) {
          const a = a0 + (li - (lines - 1) / 2) * 0.52;
          for (let i = 1; i <= 9; i++) {
            const x = e.x + Math.cos(a) * (e.r + i * 40), y = e.y + Math.sin(a) * (e.r + i * 40);
            if (D.blocksShots(D.tileAt(w.room, x, y), true)) break;
            drop(w, e, x, y, 24, (0.85 + i * 0.07) * k, 0.9, 'bone');
          }
        }
      },
      update(w, e, dt, t) { return t > 1.9 * e.vars.wm; },
    },
  }, { idle: approach(110) });

  // ---------- II. The Sporemother ----------
  B.sporemother = runner({
    burst: {
      w: 3, start(w, e) { e.pose = 'cast'; },
      update(w, e, dt, t) {
        const n = e.phase >= 2 ? 14 : 10, k = e.vars.k || 0;
        if (k < 4 && t > 0.45 * e.vars.wm + k * 0.45) { ring(w, e, n, 118, 'spore', k * 0.27, 0.8, 7); e.vars.k = k + 1; }
        return t > 2.4;
      },
    },
    fields: {
      w: 3,
      start(w, e) {
        e.pose = 'cast';
        const pts = [];
        for (const p of w.alivePlayers()) pts.push({ x: p.x, y: p.y });
        const n = e.phase >= 2 ? 7 : 5;
        while (pts.length < n) pts.push(D.randomFloor(w.room, w.rng, null, 0));
        for (const pt of pts) drop(w, e, pt.x, pt.y, 54, 1.25 * e.vars.wm, 0.8, 'spore', (ww, z) => ww.addZone({ kind: 'poison', x: z.x, y: z.y, r: 54, dur: 6, dps: e.dmg * 0.5, team: 1 }));
      },
      update(w, e, dt, t) { return t > 1.6 * e.vars.wm; },
    },
    brood: {
      w: 2, ok: (w) => w.hostiles(true) < 7,
      start(w, e) { e.pose = 'cast'; e.vars.end = summon(w, e, e.phase >= 2 ? ['sporepuff', 'sporepuff', 'sporepuff', 'sporepuff', 'myconid'] : ['sporepuff', 'sporepuff', 'sporepuff', 'myconid']); },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
    spiral: {
      w: 3, phase: 2,
      start(w, e) { e.pose = 'cast'; e.vars.a = 0; e.vars.f = 0; },
      update(w, e, dt, t) {
        e.vars.a += 1.6 * dt; e.vars.f -= dt;
        if (e.vars.f <= 0 && t > 0.3 * e.vars.wm) { e.vars.f = 0.13; for (let k = 0; k < 3; k++) w.enemyShoot(e, e.vars.a + k * TAU / 3, 130, 'spore', 0.7, 7); }
        return t > 3.2;
      },
    },
    // Mire pools: telegraphed bursts that leave a slowing mire (45% slower) for 7 s.
    mire: {
      w: 3,
      start(w, e) {
        e.pose = 'cast';
        const pts = [];
        for (const p of w.alivePlayers()) pts.push({ x: p.x, y: p.y });
        const n = e.phase >= 2 ? 4 : 3;
        while (pts.length < n) pts.push(D.randomFloor(w.room, w.rng, null, 0));
        for (const pt of pts) drop(w, e, pt.x, pt.y, 58, 1.2 * e.vars.wm, 0.7, 'spore', (ww, z) => ww.addZone({ kind: 'mire', x: z.x, y: z.y, r: 58, dur: 7, team: 1 }));
      },
      update(w, e, dt, t) { return t > 1.5 * e.vars.wm; },
    },
  }, {
    idle: (w, e, dt) => {
      e.pose = 'idle';
      const c = D.center(w.room);
      const tx = (c.x * 2 + e.target.x) / 3, ty = (c.y * 2 + e.target.y) / 3;
      const d = Math.hypot(tx - e.x, ty - e.y);
      if (d > 20) mv(w, e, (tx - e.x) / d, (ty - e.y) / d, e.spd, dt);
    },
  });

  // ---------- III. Rimeheart Colossus ----------
  B.rimeheart = runner({
    slam: {
      w: 3,
      start(w, e) {
        e.pose = 'wind';
        tele(w, e, e.x, e.y, 120, 1.0 * e.vars.wm, 1.3, 'ice', (ww) => {
          e.pose = 'slam';
          ring(ww, e, 16, 150, 'ice', w.rng.range(0, 1), 0.75, 6);
          if (e.phase >= 2) e.vars.second = ww.time + 0.4;
        });
      },
      update(w, e, dt, t) {
        if (e.vars.second && w.time >= e.vars.second) { ring(w, e, 16, 120, 'ice', TAU / 32, 0.75, 6); e.vars.second = 0; }
        return t > 0.9 + 1.0 * e.vars.wm;
      },
    },
    spikes: {
      w: 3,
      start(w, e) {
        e.pose = 'cast';
        for (const p of w.alivePlayers()) {
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          for (let i = 1; i <= 8; i++) {
            const x = e.x + Math.cos(a) * (e.r + i * 38), y = e.y + Math.sin(a) * (e.r + i * 38);
            if (D.blocksShots(D.tileAt(w.room, x, y), true)) break;
            drop(w, e, x, y, 26, (0.6 + i * 0.09) * e.vars.wm, 0.9, 'ice');
          }
        }
      },
      update(w, e, dt, t) { return t > 1.7 * e.vars.wm; },
    },
    breath: {
      w: 3,
      start(w, e) { e.vars.n = e.phase >= 2 ? 2 : 1; e.vars.i = 0; e.vars.next = 0; },
      update(w, e, dt, t) {
        if (e.vars.i < e.vars.n && t >= e.vars.next) {
          const a = aim(e), k = e.vars.wm; e.pose = 'wind';
          cone(w, e, a, 240, 1.15, 0.9 * k, 1.0, (ww) => {
            e.pose = 'cast';
            for (let j = 0; j < 14; j++) ww.enemyShoot(e, a + ww.rng.range(-0.55, 0.55), ww.rng.range(160, 270), 'ice', 0.6, 5);
          });
          e.vars.i++; e.vars.next = t + 0.25 + 0.9 * k;
        }
        return e.vars.i >= e.vars.n && t > e.vars.next;
      },
    },
    leap: {
      w: 2, phase: 2,
      start(w, e) {
        e.pose = 'air';
        const tx = e.target.x, ty = e.target.y, fl = 1.2 * e.vars.wm;
        e.vars.from = [e.x, e.y]; e.vars.to = [tx, ty]; e.vars.fl = fl;
        tele(w, e, tx, ty, 92, fl, 1.4, 'ice', (ww) => { e.pose = 'slam'; ring(ww, e, 12, 160, 'ice', 0, 0.7, 6); });
      },
      update(w, e, dt, t) {
        const k = Math.min(1, t / e.vars.fl);
        e.x = U.lerp(e.vars.from[0], e.vars.to[0], U.easeInOut(k)); e.y = U.lerp(e.vars.from[1], e.vars.to[1], U.easeInOut(k));
        if (k >= 1) Sim.resolve(e, w.room, w.locked, false);
        return t > e.vars.fl + 0.4;
      },
    },
    // Ice wall: a line of ice shards sweeps from the Colossus toward the hero with a 3-tile gap; phase 2 sends a second wall with the gap moved.
    wall: {
      w: 2,
      start(w, e) {
        e.pose = 'cast';
        const T = ED.CONST.TILE, room = w.room, tg = e.target, k = e.vars.wm;
        const vert = Math.abs(tg.x - e.x) >= Math.abs(tg.y - e.y); // vertical wall when the hero stands to the side
        const lo = 1.3 * T, hi = (vert ? room.h : room.w) * T - 1.3 * T;
        const base = U.clamp(vert ? e.x : e.y, 1.5 * T, (vert ? room.w : room.h) * T - 1.5 * T);
        const dir = vert ? (tg.x > e.x ? 0 : Math.PI) : (tg.y > e.y ? Math.PI / 2 : -Math.PI / 2);
        const n = e.phase >= 2 ? 2 : 1;
        let gap = U.clamp((vert ? tg.y : tg.x) + w.rng.range(-60, 60), lo + 70, hi - 70);
        e.vars.walls = [];
        for (let i = 0; i < n; i++) {
          if (i) gap = U.clamp(gap + w.rng.sign() * w.rng.range(120, 170), lo + 70, hi - 70);
          const at = (0.95 + i * 1.0) * k;
          e.vars.walls.push({ at, gap, base, vert, dir, done: false });
          const a = vert ? Math.PI / 2 : 0, x0 = vert ? base : lo, y0 = vert ? lo : base;
          const g0 = gap - 48, g1 = gap + 48;
          line(w, e, x0, y0, a, g0 - lo, 20, at, 0, true);
          line(w, e, vert ? base : g1, vert ? g1 : base, a, hi - g1, 20, at, 0, true);
        }
      },
      update(w, e, dt, t) {
        const T = ED.CONST.TILE, room = w.room;
        for (const wl of e.vars.walls) {
          if (wl.done || t < wl.at) continue;
          wl.done = true;
          const lo = 1.3 * T, hi = (wl.vert ? room.h : room.w) * T - 1.3 * T;
          for (let c = lo; c <= hi; c += 22) {
            if (Math.abs(c - wl.gap) < 48) continue;
            w.spawnProj({ team: 1, kind: 'ice', x: wl.vert ? wl.base : c, y: wl.vert ? c : wl.base, a: wl.dir, speed: 105, r: 7, dmg: e.dmg * 0.8, life: 9, src: e });
          }
          w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: 'ice' });
        }
        return t > e.vars.walls[e.vars.walls.length - 1].at + 0.5;
      },
    },
  }, { idle: approach(120) });

  // ---------- IV. The Forgelord ----------
  B.forgelord = runner({
    leap: {
      w: 3,
      start(w, e) {
        e.pose = 'air';
        const fl = 1.1 * e.vars.wm;
        e.vars.from = [e.x, e.y]; e.vars.to = [e.target.x, e.target.y]; e.vars.fl = fl;
        tele(w, e, e.target.x, e.target.y, 88, fl, 1.4, 'bigfire', (ww, z) => {
          e.pose = 'slam';
          ring(ww, e, 12, 160, 'fire', ww.rng.range(0, 1), 0.7, 6);
          if (e.phase >= 2) ww.addZone({ kind: 'fire', x: z.x, y: z.y, r: 70, dur: 4, dps: e.dmg * 0.5, team: 1 });
        });
      },
      update(w, e, dt, t) {
        const k = Math.min(1, t / e.vars.fl);
        e.x = U.lerp(e.vars.from[0], e.vars.to[0], U.easeInOut(k)); e.y = U.lerp(e.vars.from[1], e.vars.to[1], U.easeInOut(k));
        if (k >= 1) Sim.resolve(e, w.room, w.locked, false);
        return t > e.vars.fl + 0.4;
      },
    },
    spiral: {
      w: 3,
      start(w, e) { e.pose = 'cast'; e.vars.a = w.rng.range(0, TAU); e.vars.f = 0; },
      update(w, e, dt, t) {
        const arms = e.phase >= 2 ? 3 : 2;
        e.vars.a += 2.0 * dt; e.vars.f -= dt;
        if (e.vars.f <= 0 && t > 0.35 * e.vars.wm) { e.vars.f = 0.1; for (let k = 0; k < arms; k++) w.enemyShoot(e, e.vars.a + k * TAU / arms, 155, 'fire', 0.7, 6); }
        return t > 3.0;
      },
    },
    rain: {
      w: 3,
      start(w, e) {
        e.pose = 'cast';
        const n = e.phase >= 2 ? 12 : 8;
        const ps = w.alivePlayers();
        for (let i = 0; i < n; i++) {
          const p = ps[i % ps.length];
          const x = p.x + w.rng.range(-110, 110), y = p.y + w.rng.range(-90, 90);
          if (D.tileAt(w.room, x, y) === 1) continue;
          drop(w, e, x, y, 40, w.rng.range(1.0, 1.7) * e.vars.wm, 0.9, 'fire', (ww, z) => ww.addZone({ kind: 'fire', x: z.x, y: z.y, r: 34, dur: 4, dps: e.dmg * 0.45, team: 1 }));
        }
      },
      update(w, e, dt, t) { return t > 1.9 * e.vars.wm; },
    },
    hammer: {
      w: 2,
      start(w, e) { e.pose = 'wind'; cone(w, e, aim(e), 135, 1.7, 0.7 * e.vars.wm, 1.45, () => { e.pose = 'slam'; }); },
      update(w, e, dt, t) { return t > 0.35 + 0.7 * e.vars.wm; },
    },
    totems: {
      w: 2, phase: 2, ok: (w) => w.enemies.filter(x => x.type === 'flameturret' && x.hp > 0).length < 2,
      start(w, e) { e.pose = 'cast'; e.vars.end = summon(w, e, ['flameturret', 'flameturret']); },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
    // Releases Ember Drones (they orbit the hero and fire aimed bursts).
    drones: {
      w: 2, ok: (w) => w.enemies.filter(x => x.type === 'drone' && x.hp > 0).length < 3,
      start(w, e) { e.pose = 'cast'; e.vars.end = summon(w, e, e.phase >= 2 ? ['drone', 'drone', 'drone'] : ['drone', 'drone']); },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
  }, { idle: approach(90) });

  // ---------- V. The Drowned King ----------
  B.drownedking = runner({
    tide: {
      w: 3,
      start(w, e) {
        e.pose = 'cast';
        const T = ED.CONST.TILE, room = w.room;
        const fromLeft = w.rng.chance(0.5);
        e.vars.side = fromLeft;
        const x = fromLeft ? 1.2 * T : (room.w - 1.2) * T;
        e.vars.at = 0.85 * e.vars.wm;
        line(w, e, x, 2 * T, Math.PI / 2, (room.h - 3) * T, 24, e.vars.at, 0, true);
        const rows = room.h - 3, gapN = e.phase >= 2 ? 1 : 2;
        const gaps = [];
        for (let g = 0; g < gapN; g++) gaps.push(w.rng.int(2, rows - 4));
        e.vars.gaps = gaps; e.vars.x = x;
      },
      update(w, e, dt, t) {
        if (!e.vars.fired && t > e.vars.at) {
          e.vars.fired = true;
          const T = ED.CONST.TILE, room = w.room;
          const a = e.vars.side ? 0 : Math.PI;
          for (let y = 2.3 * T; y < (room.h - 1) * T; y += 20) {
            const row = Math.floor(y / T) - 2;
            if (e.vars.gaps.some(g => row >= g && row <= g + 2)) continue;
            w.spawnProj({ team: 1, kind: 'water', x: e.vars.x, y, a, speed: 135 * (w.pact >= 8 ? 1.18 : 1), r: 7, dmg: e.dmg * 0.9, life: 9, src: e });
          }
          w.emit({ t: 'shoot', x: Math.round(e.vars.x), y: Math.round(e.y), k: 'water' });
        }
        return t > e.vars.at + 0.55;
      },
    },
    trident: {
      w: 3,
      start(w, e) {
        e.pose = 'wind';
        const n = e.phase >= 2 ? 5 : 3, a0 = aim(e);
        e.vars.at = 0.8 * e.vars.wm; e.vars.angles = [];
        for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * 0.33; e.vars.angles.push(a); line(w, e, e.x, e.y, a, 640, 18, e.vars.at, 0, true); }
      },
      update(w, e, dt, t) {
        if (!e.vars.fired && t > e.vars.at) { e.vars.fired = true; e.pose = 'cast'; for (const a of e.vars.angles) w.enemyShoot(e, a, 520, 'trident', 1.2, 7); }
        return t > e.vars.at + 0.5;
      },
    },
    whirl: {
      w: 2,
      start(w, e) { e.pose = 'cast'; w.addZone({ kind: 'pull', x: e.x, y: e.y, r: 320, str: 70, dur: 3.3, team: 1 }); e.vars.a = 0; e.vars.f = 0; },
      update(w, e, dt, t) {
        e.vars.a += 1.4 * dt; e.vars.f -= dt;
        if (e.vars.f <= 0 && t > 0.3 * e.vars.wm) { e.vars.f = 0.16; for (let k = 0; k < 2; k++) w.enemyShoot(e, e.vars.a + k * Math.PI, 125, 'water', 0.7, 7); }
        return t > 3.4;
      },
    },
    eels: {
      w: 2, ok: (w) => w.hostiles(true) < 6,
      start(w, e) { e.pose = 'cast'; e.vars.end = summon(w, e, e.phase >= 2 ? ['eel', 'eel', 'eel', 'jelly'] : ['eel', 'eel', 'eel']); },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
    // Reaver leap: the King vaults onto the hero's spot (landing circle), then cleaves a cone.
    leap: {
      w: 2,
      start(w, e) {
        e.pose = 'air';
        const k = e.vars.wm, fl = 1.0 * k, tx = e.target.x, ty = e.target.y;
        e.vars.from = [e.x, e.y]; e.vars.to = [tx, ty]; e.vars.fl = fl; e.vars.end = fl + 0.55 * k + 0.4;
        tele(w, e, tx, ty, 78, fl, 1.3, 'slam', (ww) => {
          e.pose = 'wind'; ring(ww, e, 10, 150, 'water', ww.rng.range(0, 1), 0.7, 6);
          cone(ww, e, aim(e), 125, 1.7, 0.55 * k, 1.2, () => { e.pose = 'slam'; });
        });
      },
      update(w, e, dt, t) {
        if (t <= e.vars.fl) {
          const k = Math.min(1, t / e.vars.fl);
          e.x = U.lerp(e.vars.from[0], e.vars.to[0], U.easeInOut(k)); e.y = U.lerp(e.vars.from[1], e.vars.to[1], U.easeInOut(k));
          if (k >= 1) Sim.resolve(e, w.room, w.locked, false);
        }
        return t > e.vars.end;
      },
    },
  }, { idle: approach(140) });

  // ---------- VI. The Hollow King ----------
  const hkShards = (w, e) => {
    if (e.phase < 3) return;
    for (let i = 0; i < 3; i++) {
      const a = w.time * 2.2 + i * TAU / 3;
      const x = e.x + Math.cos(a) * 74, y = e.y + Math.sin(a) * 74;
      for (const p of w.players.values()) if (U.dist2(x, y, p.x, p.y) < (p.r + 10) ** 2) w.hurtPlayer(p, e.dmg * 0.8, { e });
    }
  };
  B.hollowking = runner({
    orbs: {
      w: 3,
      start(w, e) { e.pose = 'cast'; },
      update(w, e, dt, t) {
        if (!e.vars.fired && t > 0.5 * e.vars.wm) {
          e.vars.fired = true;
          const n = 4 + e.phase * 2, a0 = aim(e);
          for (let i = 0; i < n; i++) w.enemyShoot(e, a0 + (i - (n - 1) / 2) * (TAU / n), 95, 'orb', 0.9, 9, { homing: 1.1, life: 6 });
        }
        return t > 0.7 + 0.5 * e.vars.wm;
      },
    },
    blink: {
      w: 3,
      start(w, e) { e.vars.n = e.phase >= 2 ? 2 : 1; e.vars.i = 0; e.vars.next = 0; },
      update(w, e, dt, t) {
        const k = e.vars.wm;
        if (e.vars.i < e.vars.n && t >= e.vars.next && !e.vars.pending) {
          const p = e.target;
          const a = w.rng.range(0, TAU);
          const pt = Sim.castMove(w.room, p.x, p.y, a, 70, e.r, true);
          e.vars.pending = { x: pt.x, y: pt.y, at: t + 0.6 * k };
          e.pose = 'fade';
          w.addZone({ kind: 'tele', x: pt.x, y: pt.y, r: e.r + 6, dur: 0.6 * k, dmg: 0, team: 1, src: e, warnOnly: true });
        }
        const pd = e.vars.pending;
        if (pd && t >= pd.at && !pd.done) {
          pd.done = true;
          w.emit({ t: 'blinkfx', x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(pd.x), y1: Math.round(pd.y) });
          e.x = pd.x; e.y = pd.y; e.pose = 'wind';
          cone(w, e, aim(e), 125, 2.0, 0.55 * k, 1.4, () => { e.pose = 'slam'; });
          pd.end = t + 0.2 + 0.55 * k;
        }
        if (pd && pd.done && t >= pd.end) { e.vars.pending = null; e.vars.i++; e.vars.next = t + 0.2; }
        return e.vars.i >= e.vars.n && !e.vars.pending;
      },
    },
    laser: {
      w: 3,
      start(w, e) {
        e.pose = 'wind';
        const k = e.vars.wm, warm = 1.0 * k;
        const a0 = aim(e) + Math.PI / 2, beams = e.phase >= 3 ? 4 : 2, dir = w.rng.sign();
        e.vars.dir = dir; e.vars.warm = warm;
        for (let i = 0; i < beams; i++) {
          const a = a0 + i * TAU / beams;
          line(w, e, e.x, e.y, a, 760, 16, warm, 0, true);
          w.addZone({ kind: 'laser', x: e.x, y: e.y, a, len: 760, w: 16, warm, dur: warm + 2.4, dmg: e.dmg * 0.7, team: 1, src: e,
            update: (ww, z, ddt) => { z.x = e.x; z.y = e.y; if (z.t > z.warm) z.a += dir * 0.75 * ddt; } });
        }
      },
      update(w, e, dt, t) { if (t > e.vars.warm) e.pose = 'cast'; return t > e.vars.warm + 2.5; },
    },
    shades: {
      w: 2, ok: (w) => w.hostiles(true) < 6,
      start(w, e) { e.pose = 'cast'; e.vars.end = summon(w, e, e.phase >= 3 ? ['shade', 'shade', 'shade', 'starspawn', 'starspawn'] : ['shade', 'shade', 'shade']); },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
    nova: {
      w: 3, phase: 2,
      start(w, e) { e.pose = 'cast'; },
      update(w, e, dt, t) {
        const k = e.vars.k || 0;
        if (k < 4 && t > 0.45 * e.vars.wm + k * 0.45) { ring(w, e, 18, 118, 'void', (k % 2) * TAU / 36, 0.75, 7); e.vars.k = k + 1; }
        return t > 2.4;
      },
    },
    // Rifts tear open around the heroes: telegraphed spawn zones for starspawn, each ending in a void ring.
    rift: {
      w: 2, ok: (w) => w.hostiles(true) < 8,
      start(w, e) {
        e.pose = 'cast';
        const dur = 1.2 * e.vars.wm, n = e.phase >= 3 ? 4 : e.phase >= 2 ? 3 : 2, hs = w.alivePlayers();
        e.vars.end = dur + 0.5;
        for (let i = 0; i < n; i++) {
          const h = hs[i % hs.length];
          let pt = Sim.castMove(w.room, h.x, h.y, w.rng.range(0, TAU), w.rng.range(80, 140), 10, true);
          if (Math.hypot(pt.x - h.x, pt.y - h.y) < 50) pt = D.randomFloor(w.room, w.rng, hs, 90);
          w.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 16, dur, type: 'starspawn', after: (en) => {
            const off = w.rng.range(0, 1);
            for (let j = 0; j < 6; j++) w.spawnProj({ team: 1, kind: 'void', x: en.x, y: en.y, a: off + j * TAU / 6, speed: 110, r: 6, dmg: e.dmg * 0.5, life: 4, src: e });
          } });
          w.emit({ t: 'rift', x: Math.round(pt.x), y: Math.round(pt.y) });
        }
      },
      update(w, e, dt, t) { return t > e.vars.end; },
    },
  }, { idle: approach(160), phases: [0.6, 0.3], tick: hkShards });
})(globalThis.ED || (globalThis.ED = {}));
