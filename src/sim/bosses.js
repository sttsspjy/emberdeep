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
  // opts: phases (HP fractions), idle(w, e, dt) (movement between attacks), tick(w, e, dt) (every tick before the attack state), onPhase(w, e, phase), volley, pauseMul(w, e) (factor on the pause after an attack).
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
        e.t = (e.phase >= 3 ? 0.45 : e.phase === 2 ? 0.7 : 1.05) * ED.pactMul(w.pact, 'bossPause') * w.threat().pause / (e.furyM || 1) * (opts.pauseMul ? opts.pauseMul(w, e) : 1);
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

  // Shared pieces for the boss files: I boss-warden.js, II boss-spore.js, III boss-king.js, IV boss-hollow.js (arena state: arena.js).
  B.lib = { tele, drop, line, cone, ring, aim, mv, grow, summon, approach, runner, startVolley, cancelVolley };
})(globalThis.ED || (globalThis.ED = {}));
