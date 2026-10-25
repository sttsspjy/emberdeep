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

  // ---------- aimed volley (bosses whose runner keeps it) ----------
  // e.vol runs beside the main state: per living, unhidden hero (else the boss's target) a warn line follows the led aim and locks for the last BOSS_VOL.lock s, then BOSS_VOL.n[phase] shots come BOSS_VOL.gap apart,
  // each angled by World.leadAngle at its release; the heroes' sequences start BOSS_VOL.seq s apart. Flight speed speed + step per stratum (x1.2 under Pact 8+): enemyShoot gets it divided by the factors it re-applies (boss shot factor, Pact 8).
  const VOL_KIND = { bonewarden: 'bone', sporemother: 'spore', drownedking: 'trident', hollowking: 'void' };
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

  // Every boss: its attack table plus the volley (weight 2, all phases; opts.volley false leaves it out); the volley also self-starts every BOSS_OV_GAP s in phase 3 whatever the main state does, never while one runs. The returned function carries the table as .attacks.
  // opts: phases (HP fractions), idle(w, e, dt), tick(w, e, dt) (every tick before the attack state), onPhase(w, e, phase), volley.
  const runner = (attacks, opts) => Object.assign((w, e, dt) => {
    const phases = opts.phases || [0.66, 0.33], vol = opts.volley !== false; // three phases: the last third attacks at the fastest tempo
    while (e.phase - 1 < phases.length && e.hp / e.maxHp < phases[e.phase - 1]) {
      e.phase++; e.invulnT = 1.0; e.st = 'idle'; e.t = 1.3; e.pose = 'roar'; cancelVolley(e); e.ovT = Wd.BOSS_OV_GAP;
      w.emit({ t: 'phase', p: e.phase, x: Math.round(e.x), y: Math.round(e.y), type: e.type });
      if (opts.onPhase) opts.onPhase(w, e, e.phase);
      return;
    }
    if (opts.tick) opts.tick(w, e, dt);
    if (vol) {
      if (e.phase >= 3) e.ovT = (e.ovT === undefined ? Wd.BOSS_OV_GAP : e.ovT) - dt;
      if (e.vol) { if (e.blind > 0) cancelVolley(e); else tickVolley(w, e, dt); } // a blinded boss drops its volley
      else if (e.phase >= 3 && e.ovT <= 0 && !(e.blind > 0) && w.alivePlayers().length) startVolley(w, e);
    }
    if (e.st === 'atk') {
      e.t += dt;
      if (attacks[e.atk].update(w, e, dt, e.t)) {
        e.st = 'idle'; e.pose = 'idle';
        e.t = (e.phase >= 3 ? 0.45 : e.phase === 2 ? 0.7 : 1.05) * ED.pactMul(w.pact, 'bossPause') * w.threat().pause / (e.furyM || 1);
      }
      return;
    }
    e.t -= dt;
    (opts.idle || approach(120))(w, e, dt);
    if (e.t <= 0 && !(e.blind > 0) && w.alivePlayers().length) { // blinded bosses keep moving but start nothing; no attack starts once every hero is down
      const keys = Object.keys(attacks).filter(k => (attacks[k].phase || 1) <= e.phase && k !== e.last && (!attacks[k].ok || attacks[k].ok(w, e)));
      const k = w.rng.weighted(keys.length ? keys : Object.keys(attacks).filter(x => (attacks[x].phase || 1) <= e.phase), x => attacks[x].w || 1);
      e.atk = k; e.last = k; e.st = 'atk'; e.t = 0; e.vars = { wm: e.windMul || 1 };
      if (attacks[k].start) attacks[k].start(w, e);
    }
  }, { attacks: opts.volley === false ? attacks : Object.assign(attacks, { volley: VOLLEY }) });

  // ---------- arena state (boss-raised walls, floor carpet) ----------
  // w.arena (host; a mirror rebuilds it from the snapshot's AR): { walls: [{ x, y, n, hp, cd }] (tiles x..x+n-1 of row y stand as blocks while hp > 0), carpet: Uint8Array(room.w x room.h) of 0/1, or null }.
  // B.applyArena writes the standing walls into room.tiles as tile 2 (only over floor and hazard tiles) and keeps the floor's own tiles in room.baseTiles (the renderer draws those);
  // room.carpet is the carpet (Sim.movePlayer slows on it), room.tver counts wall changes (path caches key on it). Host and mirror run the same code, so a client hero collides with the same walls.
  B.CARPET_SLOW = 0.7; // walking speed factor on a carpet tile
  B.applyArena = (room, ar) => {
    if (!room) return;
    let key = '';
    if (ar && ar.walls) for (const s of ar.walls) if (s.hp > 0) key += s.x + ',' + s.y + ',' + s.n + ';';
    if (key !== (room.awKey || '')) {
      if (!room.baseTiles) room.baseTiles = room.tiles.slice();
      const base = room.baseTiles, tl = room.tiles;
      if (room.awSet) for (const i of room.awSet) tl[i] = base[i];
      const set = [];
      if (ar && ar.walls) for (const s of ar.walls) {
        if (!(s.hp > 0) || s.y < 0 || s.y >= room.h) continue;
        for (let x = s.x; x < s.x + s.n; x++) { const i = s.y * room.w + x; if (x >= 0 && x < room.w && (base[i] === 0 || base[i] === 4)) { tl[i] = 2; set.push(i); } }
      }
      room.awSet = set; room.awKey = key; room.tver = (room.tver | 0) + 1;
    }
    room.carpet = ar && ar.carpet ? ar.carpet : null;
  };
  // Wire form { W: [[x, y, n, hp]], C: carpet bits, 30 per number (tile index order) } and back (prev: the last decoded arena, whose carpet array is reused).
  B.encodeArena = (ar) => {
    const o = {};
    if (ar.walls) o.W = ar.walls.map(s => [s.x, s.y, s.n, s.hp]);
    if (ar.carpet) { const c = ar.carpet, out = []; for (let i = 0; i < c.length; i += 30) { let v = 0; for (let k = 0; k < 30 && i + k < c.length; k++) if (c[i + k]) v |= 1 << k; out.push(v); } o.C = out; }
    return o;
  };
  B.decodeArena = (d, room, prev) => {
    const ar = { walls: d.W ? d.W.map(a => ({ x: a[0], y: a[1], n: a[2], hp: a[3] })) : null, carpet: null };
    if (d.C && room) {
      const n = room.w * room.h, c = prev && prev.carpet && prev.carpet.length === n ? prev.carpet : new Uint8Array(n);
      for (let i = 0; i < n; i++) c[i] = (d.C[(i / 30) | 0] >> (i % 30)) & 1;
      ar.carpet = c;
    }
    return ar;
  };
  // Clears the arena (boss down, room change): walls fall, the carpet goes.
  B.clearArena = (w) => { if (!w.arena) return; w.arena = null; B.applyArena(w.room, null); };

  // Hero hits on standing wall blocks (rooms.js smash hooks, combat.js shots that strike a wall): each block loses 1 hp per hit, at most one hit per WALL_CD s; at 0 it breaks ({t:'wallbreak', x, y, n}).
  const WALL_CD = 0.2;
  const wallHit = (w, s, p) => {
    if (s.cd > w.time) return;
    s.cd = w.time + WALL_CD; s.hp--;
    const T = ED.CONST.TILE;
    w.emit({ t: 'wallhit', x: Math.round((s.x + s.n / 2) * T), y: Math.round((s.y + 0.5) * T), hp: s.hp });
    if (s.hp <= 0) { w.emit({ t: 'wallbreak', x: Math.round((s.x + s.n / 2) * T), y: Math.round((s.y + 0.5) * T), n: s.n }); B.applyArena(w.room, w.arena); }
  };
  // Squared distance from (x, y) to wall block s (px rect).
  const wallD2 = (s, x, y) => { const T = ED.CONST.TILE, cx = U.clamp(x, s.x * T, (s.x + s.n) * T), cy = U.clamp(y, s.y * T, (s.y + 1) * T); return (x - cx) ** 2 + (y - cy) ** 2; };
  Wd.prototype.wallCircle = function (p, x, y, r) {
    const ar = this.arena; if (!ar || !ar.walls) return;
    for (const s of ar.walls) if (s.hp > 0 && wallD2(s, x, y) <= r * r) wallHit(this, s, p);
  };
  Wd.prototype.wallSeg = function (p, x0, y0, x1, y1, r) {
    const ar = this.arena; if (!ar || !ar.walls) return;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
    for (const s of ar.walls) {
      if (!(s.hp > 0)) continue;
      for (let i = 0; i <= n; i++) if (wallD2(s, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) <= r * r) { wallHit(this, s, p); break; }
    }
  };
  Wd.prototype.wallArc = function (p, a, reach, arc) {
    const ar = this.arena; if (!ar || !ar.walls) return;
    const T = ED.CONST.TILE;
    for (const s of ar.walls) {
      if (!(s.hp > 0) || wallD2(s, p.x, p.y) > reach * reach) continue;
      const cx = U.clamp(p.x, s.x * T, (s.x + s.n) * T), cy = U.clamp(p.y, s.y * T, (s.y + 1) * T), d = Math.hypot(cx - p.x, cy - p.y);
      if (arc >= 6.2 || d < 4 || Math.abs(U.angDiff(a, Math.atan2(cy - p.y, cx - p.x))) <= arc / 2 + Math.atan2(T / 2, Math.max(d, 1))) wallHit(this, s, p);
    }
  };

  // Shared pieces for the boss files (boss-*.js).
  B.lib = { tele, drop, line, cone, ring, aim, mv, grow, summon, approach, runner, startVolley, cancelVolley };

  // Bosses I and II live in boss-warden.js and boss-spore.js.

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
