// Enemy behaviours. Every attack is telegraphed (wind-up pose, line, circle or cone) so damage feels fair.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon;
  const AI = ED.AI = {};

  const move = (w, e, dx, dy, speed, dt) => {
    const hit = Sim.moveCircle(e, dx * speed * dt, dy * speed * dt, w.room, w.locked, e.fly);
    if (Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1;
    return hit;
  };
  const toward = (w, e, tx, ty, speed, dt) => { const d = w.pathDir(e, tx, ty); return move(w, e, d[0], d[1], speed, dt); };
  const sp = (e) => e.spd * e.slow * (e.exposed ? 1.5 : 1);
  const distT = (e) => Math.hypot(e.target.x - e.x, e.target.y - e.y);
  const hasLos = (w, e) => Sim.los(w.room, e.x, e.y, e.target.x, e.target.y, w.locked);
  const rate = (e) => (e.elite === 'swift' ? 0.7 : 1);

  // Keep-distance movement shared by ranged foes.
  const kite = (w, e, dt, keep) => {
    const d = distT(e);
    if (e.exposed) { toward(w, e, e.target.x, e.target.y, sp(e), dt); return; }
    if (d < keep[0]) {
      const a = Math.atan2(e.y - e.target.y, e.x - e.target.x);
      if (move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.7, dt)) e.strafe = -e.strafe;
    } else if (d > keep[1] || !hasLos(w, e)) {
      toward(w, e, e.target.x, e.target.y, sp(e), dt);
    } else {
      e.vars.strafeT = (e.vars.strafeT || 0) - dt;
      if (e.vars.strafeT <= 0) { e.strafe = -e.strafe; e.vars.strafeT = w.rng.range(1.2, 2.4); }
      const a = Math.atan2(e.target.y - e.y, e.target.x - e.x) + Math.PI / 2 * e.strafe;
      if (move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.55, dt)) e.strafe = -e.strafe;
    }
    e.face = e.target.x > e.x ? 1 : -1;
  };

  AI.chaser = (w, e, dt) => {
    const L = e.def.lunge;
    e.cd -= dt;
    if (e.recoil > 0) { e.recoil -= dt; const a = Math.atan2(e.y - e.target.y, e.x - e.target.x); move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.6, dt); return; }
    if (e.st === 'windup') {
      e.t -= dt;
      if (e.t <= 0) { e.st = 'lunge'; e.t = L.dur; }
      return;
    }
    if (e.st === 'lunge') {
      e.t -= dt;
      move(w, e, Math.cos(e.aimA), Math.sin(e.aimA), L.speed, dt);
      if (e.t <= 0) { e.st = 'move'; e.cd = L.cd * rate(e); }
      return;
    }
    const d = distT(e);
    if (L && e.cd <= 0 && d < L.range + e.r && hasLos(w, e)) {
      e.st = 'windup'; e.t = L.windup * rate(e); e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
      return;
    }
    toward(w, e, e.target.x, e.target.y, sp(e), dt);
  };

  AI.swarm = (w, e, dt) => {
    if (e.recoil > 0) { e.recoil -= dt; const a = Math.atan2(e.y - e.target.y, e.x - e.target.x); move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.8, dt); return; }
    e.wob += dt * 5;
    const d = w.pathDir(e, e.target.x, e.target.y);
    const side = Math.sin(e.wob) * 0.7;
    move(w, e, d[0] - d[1] * side, d[1] + d[0] * side, sp(e), dt);
  };

  AI.shooter = (w, e, dt) => {
    const S = e.def.shot;
    e.cd -= dt;
    if (e.st === 'aim') {
      e.t -= dt;
      e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      if (e.t <= 0) {
        for (let i = 0; i < S.n; i++) w.enemyShoot(e, e.aimA + (i - (S.n - 1) / 2) * S.spread, S.speed, S.kind, 1, S.r);
        e.st = 'move'; e.cd = S.cd * rate(e) * w.rng.range(0.85, 1.15);
        w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: S.kind });
      }
      return;
    }
    kite(w, e, dt, e.def.keep);
    if (e.cd <= 0 && hasLos(w, e) && distT(e) < 360) { e.st = 'aim'; e.t = S.windup; }
  };

  AI.turret = (w, e, dt) => {
    const P = e.def.pattern;
    e.cd -= dt;
    e.face = e.target.x > e.x ? 1 : -1;
    if (e.st === 'aim') {
      e.t -= dt;
      if (P.type !== 'laser') e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      if (e.t <= 0) {
        if (P.type === 'spread') {
          for (let i = 0; i < P.n; i++) w.enemyShoot(e, e.aimA + (i - (P.n - 1) / 2) * P.spread, P.speed, P.kind, 1, P.r);
          e.st = 'move'; e.cd = P.cd * rate(e);
          w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: P.kind });
        } else if (P.type === 'spiral') {
          e.st = 'spin'; e.t = P.dur; e.vars.fire = 0; e.vars.ang = e.aimA;
        } else if (P.type === 'laser') {
          w.addZone({ kind: 'laser', x: e.x, y: e.y, a: e.aimA, len: P.len, w: P.w, dur: P.dur + 0.05, warm: 0.05, dmg: e.dmg, team: 1, src: e });
          e.st = 'move'; e.cd = P.cd * rate(e);
        }
      }
      return;
    }
    if (e.st === 'spin') {
      e.t -= dt; e.vars.fire -= dt; e.vars.ang += P.turn * dt;
      if (e.vars.fire <= 0) {
        e.vars.fire = P.rate;
        for (let k = 0; k < P.arms; k++) w.enemyShoot(e, e.vars.ang + k * U.TAU / P.arms, P.speed, P.kind, 0.8, P.r);
      }
      if (e.t <= 0) { e.st = 'move'; e.cd = P.cd * rate(e); }
      return;
    }
    if (e.cd <= 0 && distT(e) < 420 && hasLos(w, e)) {
      e.st = 'aim'; e.t = P.windup;
      e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      if (P.type === 'laser') w.addZone({ kind: 'teleLine', x: e.x, y: e.y, a: e.aimA, len: P.len, w: P.w, dur: P.windup, dmg: 0, team: 1, src: e, warnOnly: true });
    }
  };

  AI.charger = (w, e, dt) => {
    const C = e.def.charge;
    e.cd -= dt;
    if (e.st === 'windup') { e.t -= dt; if (e.t <= 0) { e.st = 'charge'; e.t = C.dur; e.vars.trail = 0; } return; }
    if (e.st === 'charge') {
      e.t -= dt;
      const hit = move(w, e, Math.cos(e.aimA), Math.sin(e.aimA), C.speed, dt);
      if (C.trail) { e.vars.trail -= dt; if (e.vars.trail <= 0) { e.vars.trail = 0.06; w.addZone({ kind: 'fire', x: e.x, y: e.y, r: 16, dur: 1.8, dps: e.dmg * 0.5, team: 1 }); } }
      if (hit) { e.st = 'move'; e.stun = 0.7; e.cd = C.cd * rate(e); w.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y) }); return; }
      if (e.t <= 0) { e.st = 'move'; e.cd = C.cd * rate(e); }
      return;
    }
    const d = distT(e);
    if (e.cd <= 0 && d < C.range && d > 50 && hasLos(w, e)) {
      e.st = 'windup'; e.t = C.windup * rate(e);
      e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
      w.addZone({ kind: 'teleLine', x: e.x, y: e.y, a: e.aimA, len: C.speed * C.dur + e.r, w: e.r * 2, dur: e.t, team: 1, src: e, warnOnly: true, follow: e.id });
      return;
    }
    if (e.recoil > 0) { e.recoil -= dt; const a = Math.atan2(e.y - e.target.y, e.x - e.target.x); move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.7, dt); return; }
    toward(w, e, e.target.x, e.target.y, sp(e), dt);
  };

  AI.tank = (w, e, dt) => {
    const S = e.def.slam;
    e.cd -= dt;
    if (e.st === 'windup') {
      e.t -= dt;
      if (e.t <= 0) {
        e.st = 'move'; e.cd = S.cd * rate(e);
        if (S.ring) for (let i = 0; i < S.ring.n; i++) w.enemyShoot(e, i * U.TAU / S.ring.n + w.rng.range(0, 0.3), S.ring.speed, S.ring.kind, 0.7, 6);
        if (S.cloud) w.addZone({ kind: 'poison', x: e.x, y: e.y, r: S.radius * 0.8, dur: 3, dps: e.dmg * 0.4, team: 1 });
      }
      return;
    }
    const d = distT(e);
    if (e.cd <= 0 && d < S.range + e.r) {
      e.st = 'windup'; e.t = S.windup * rate(e);
      w.addZone({ kind: 'tele', x: e.x, y: e.y, r: S.radius, dur: e.t, dmg: e.dmg * 1.2, team: 1, src: e, boom: 'slam' });
      return;
    }
    toward(w, e, e.target.x, e.target.y, sp(e), dt);
  };

  AI.bomber = (w, e, dt) => {
    if (e.st === 'fuse') {
      e.t -= dt;
      if (e.t <= 0) {
        w.explode(e.x, e.y, e.def.boom, e.dmg, 1, e, 'spore');
        if (e.def.look === 'puff') w.addZone({ kind: 'poison', x: e.x, y: e.y, r: e.def.boom * 0.7, dur: 2.2, dps: e.dmg * 0.3, team: 1 });
        e.hp = 0;
        w.emit({ t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: 0, r: e.r });
        w.dropXp(e.x, e.y, e.def.xp);
      }
      return;
    }
    if (distT(e) < 38 + e.r) { e.st = 'fuse'; e.t = e.def.fuse; w.addZone({ kind: 'tele', x: e.x, y: e.y, r: e.def.boom, dur: e.def.fuse, dmg: 0, team: 1, warnOnly: true }); return; }
    const d = w.pathDir(e, e.target.x, e.target.y);
    e.wob += dt * 4;
    move(w, e, d[0] + Math.sin(e.wob) * 0.25, d[1] + Math.cos(e.wob) * 0.25, sp(e), dt);
  };

  AI.caster = (w, e, dt) => {
    const C = e.def.cast;
    e.cd -= dt;
    e.vars.blink = (e.vars.blink ?? w.rng.range(2, e.def.blink)) - dt;
    if (e.st === 'cast') {
      e.t -= dt;
      if (e.t <= 0) {
        const a0 = Math.atan2(e.target.y - e.y, e.target.x - e.x);
        if (C.type === 'ring') {
          const off = w.rng.range(0, 1);
          for (let i = 0; i < C.n; i++) w.enemyShoot(e, (i + off) * U.TAU / C.n, C.speed, C.kind, 0.9, C.r);
        } else if (C.type === 'wave') {
          for (let i = 0; i < C.n; i++) w.enemyShoot(e, a0 + (i - (C.n - 1) / 2) * 0.17, C.speed, C.kind, 0.9, C.r);
        } else if (C.type === 'homing') {
          for (let i = 0; i < C.n; i++) w.enemyShoot(e, a0 + (i - (C.n - 1) / 2) * 0.8, C.speed, C.kind, 1, C.r, { homing: 1.3, life: 4.5 });
        }
        w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: C.kind });
        e.st = 'move'; e.cd = C.cd * rate(e);
      }
      return;
    }
    if (e.vars.blink <= 0) {
      e.vars.blink = e.def.blink;
      const pts = [...w.players.values()].filter(p => !p.dead);
      const pt = D.randomFloor(w.room, w.rng, pts, 130);
      w.emit({ t: 'blinkfx', x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(pt.x), y1: Math.round(pt.y) });
      e.x = pt.x; e.y = pt.y;
      return;
    }
    kite(w, e, dt, [100, 230]);
    if (e.cd <= 0 && hasLos(w, e)) { e.st = 'cast'; e.t = C.windup; }
  };

  AI.lobber = (w, e, dt) => {
    const L = e.def.lob;
    e.cd -= dt;
    if (e.st === 'aim') {
      e.t -= dt;
      if (e.t <= 0) {
        const tx = e.target.x + (e.target.vx || 0) * 0.3, ty = e.target.y + (e.target.vy || 0) * 0.3;
        w.addZone({ kind: 'tele', x: tx, y: ty, r: L.radius, dur: L.flight, dmg: e.dmg, team: 1, src: e, boom: 'fire', lob: [Math.round(e.x), Math.round(e.y - 10)],
          onEnd: (ww, z) => ww.addZone({ kind: 'fire', x: z.x, y: z.y, r: L.radius * 0.6, dur: L.fire, dps: e.dmg * 0.45, team: 1 }) });
        e.st = 'move'; e.cd = L.cd * rate(e);
      }
      return;
    }
    kite(w, e, dt, e.def.keep);
    if (e.cd <= 0 && distT(e) < 300) { e.st = 'aim'; e.t = L.windup; }
  };

  AI.boss = (w, e, dt) => { const b = ED.Bosses[e.type]; if (b) b(w, e, dt); };
})(globalThis.ED || (globalThis.ED = {}));
