// Enemy behaviours. Every attack is telegraphed (wind-up pose, line, circle or cone) so damage feels fair.
// Wind-ups scale with e.windMul (chill) and shrink for swift elites; blinded foes (e.blind) keep moving but never start an attack.
// Body-hit states (full contact damage): lunge, charge, leap, bash, dive.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon, TAU = U.TAU, VIEW_W = ED.CONST.VIEW_W, VIEW_H = ED.CONST.VIEW_H;
  const AI = ED.AI = {};

  const move = (w, e, dx, dy, speed, dt) => {
    const hit = Sim.moveCircle(e, dx * speed * dt, dy * speed * dt, w.room, w.locked, e.fly);
    if (Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1;
    return hit;
  };
  const toward = (w, e, tx, ty, speed, dt) => { const d = w.pathDir(e, tx, ty); return move(w, e, d[0], d[1], speed, dt); };
  const haste = (e) => (e.hasteT > 0 ? e.haste : 1);
  const sp = (e) => e.spd * (e.slow ?? 1) * haste(e) * (e.exposed ? 1.5 : 1);
  const distT = (e) => Math.hypot(e.target.x - e.x, e.target.y - e.y);
  const hasLos = (w, e) => Sim.los(w.room, e.x, e.y, e.target.x, e.target.y, w.locked);
  const aimAt = (e) => Math.atan2(e.target.y - e.y, e.target.x - e.x);
  // Aimed shots lead the target by World.LEAD of its measured velocity; flightSpd = the final flight speed of a shot of base speed `speed` (Pact 8+ x1.2, x the stratum shot factor, as enemyShoot applies).
  const leadK = (w) => ED.World.LEAD[w.stratum - 1] || 0;
  const flightSpd = (w, e, speed) => speed * (w.pact >= 8 ? 1.2 : 1) * (e.boss ? ED.World.bossShotSpd(w.stratum) : ED.World.shotSpd(w.stratum));
  const lead = (w, e, speed) => ED.World.leadAngle(e.x, e.y - 4, e.target, flightSpd(w, e, speed), leadK(w));
  // Landing point of a lob with flight time fl: the target led by its measured velocity over fl; a point inside a wall is cut back along the lead.
  const lobPoint = (w, e, fl) => {
    const t = e.target, k = leadK(w) * fl, dx = (t.lvx || 0) * k, dy = (t.lvy || 0) * k, px = t.x + dx, py = t.y + dy;
    return (dx || dy) && D.blocksShots(D.tileAt(w.room, px, py), w.locked) ? Sim.castMove(w.room, t.x, t.y, Math.atan2(dy, dx), Math.hypot(dx, dy), 6, w.locked) : { x: px, y: py };
  };
  const rate = (e) => (ED.hasAffix(e, 'swift') ? 0.7 : 1);
  const wind = (e, t) => Math.max(t * rate(e), Math.min(t, 0.4)) * (e.windMul || 1); // every wind-up: swift foes shorten it but never below 0.4 s, chill (windMul) stretches it
  const blind = (e) => e.blind > 0;
  // Ranged foes (not bosses) start an attack only while on the target's screen (minimum view minus a 24 px margin); off-screen they close in instead.
  const onScreen = (w, e) => Math.abs(e.x - e.target.x) <= VIEW_W / 2 - 24 && Math.abs(e.y - e.target.y) <= VIEW_H / 2 - 24;

  // Warn-only line that follows the foe's aim while it winds up.
  const aimLine = (w, e, len, width, dur) => w.addZone({ kind: 'teleLine', x: e.x, y: e.y, a: e.aimA, len, w: width, dur, dmg: 0, team: 1, src: e, warnOnly: true,
    update: (ww, z) => { z.x = e.x; z.y = e.y; z.a = e.aimA; } });
  // Warn-only line fixed at the current aim (charges, dives).
  const fixedLine = (w, e, len, width, dur) => w.addZone({ kind: 'teleLine', x: e.x, y: e.y, a: e.aimA, len, w: width, dur, dmg: 0, team: 1, src: e, warnOnly: true });
  const owned = (w, e, key) => {
    let n = 0;
    for (const x of w.enemies) if (x.hp > 0 && x[key] === e.id) n++;
    for (const z of w.zones) if (z.kind === 'spawn' && z.by === e.id) n++;
    return n;
  };
  // A standable point `dist` px from e along a random heading, at least `clear` px from every avoided hero.
  const spotNear = (w, e, dist, avoid, clear) => {
    for (let k = 0; k < 8; k++) {
      const pt = Sim.castMove(w.room, e.x, e.y, w.rng.range(0, TAU), dist, 10, w.locked);
      if (Math.hypot(pt.x - e.x, pt.y - e.y) < dist * 0.6) continue;
      if (avoid.every(p => U.dist2(pt.x, pt.y, p.x, p.y) >= clear * clear)) return pt;
    }
    return null;
  };

  // Keep-distance movement shared by ranged foes.
  const kite = (w, e, dt, keep) => {
    const d = distT(e);
    if (e.exposed) { toward(w, e, e.target.x, e.target.y, sp(e), dt); return; }
    if (d < keep[0]) {
      const a = Math.atan2(e.y - e.target.y, e.x - e.target.x);
      if (move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.7, dt)) e.strafe = -e.strafe;
    } else if (d > keep[1] || !hasLos(w, e) || !onScreen(w, e)) {
      toward(w, e, e.target.x, e.target.y, sp(e), dt);
    } else {
      e.vars.strafeT = (e.vars.strafeT || 0) - dt;
      if (e.vars.strafeT <= 0) { e.strafe = -e.strafe; e.vars.strafeT = w.rng.range(1.2, 2.4); }
      const a = Math.atan2(e.target.y - e.y, e.target.x - e.x) + Math.PI / 2 * e.strafe;
      if (move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.55, dt)) e.strafe = -e.strafe;
    }
    e.face = e.target.x > e.x ? 1 : -1;
  };

  // Frontal guard: guardA turns toward the target at G.turn rad/s and is mirrored into aimA so it syncs.
  const turnGuard = (e, dt) => {
    const G = e.def.guard, want = aimAt(e);
    if (!e.vars.gInit) { e.vars.gInit = 1; e.guardA = want; }
    e.guardA += U.clamp(U.angDiff(e.guardA, want), -G.turn * dt, G.turn * dt);
    e.aimA = e.guardA;
  };

  // One step of circling the target at radius r (the strafe direction flips on a wall hit).
  const orbitStep = (w, e, dt, r) => {
    const t = e.target, dx = e.x - t.x, dy = e.y - t.y, d = Math.hypot(dx, dy) || 1, k = U.clamp((d - r) / 50, -1, 1);
    const mx = -dy / d * e.strafe - dx / d * k * 0.9, my = dx / d * e.strafe - dy / d * k * 0.9, l = Math.hypot(mx, my) || 1;
    if (move(w, e, mx / l, my / l, sp(e), dt)) e.strafe = -e.strafe;
    e.face = t.x > e.x ? 1 : -1;
  };

  // Telegraphed dive (state 'dive'): fixed aim line, then a straight body-hit dash.
  const diveStart = (w, e, V) => {
    e.aimA = aimAt(e); e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
    e.st = 'windup'; e.t = wind(e, V.windup);
    fixedLine(w, e, V.speed * V.dur + e.r, e.r * 2, e.t);
  };
  const diveTick = (w, e, dt, V) => {
    if (e.st === 'windup') { e.t -= dt; if (e.t <= 0) { e.st = 'dive'; e.t = V.dur; } return true; }
    if (e.st === 'dive') {
      e.t -= dt;
      const hit = move(w, e, Math.cos(e.aimA), Math.sin(e.aimA), V.speed, dt);
      if (hit || e.t <= 0) { e.st = 'move'; e.cd = V.cd * rate(e); }
      return true;
    }
    return false;
  };

  AI.chaser = (w, e, dt) => {
    const L = e.def.lunge, P = e.def.pulse;
    e.cd -= dt;
    if (e.st === 'cast') { e.t -= dt; if (e.t <= 0) { e.st = 'move'; e.cd = P.cd * rate(e); } return; } // shock pulse resolves through its tele zone
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
    if (L && e.cd <= 0 && d < L.range + e.r && hasLos(w, e) && !blind(e)) {
      e.st = 'windup'; e.t = wind(e, L.windup); e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
      return;
    }
    if (P && e.cd <= 0 && d < P.range + e.r && !blind(e)) {
      e.st = 'cast'; e.t = wind(e, P.windup);
      w.addZone({ kind: 'tele', x: e.x, y: e.y, r: P.r, dur: e.t, dmg: e.dmg * P.mul, team: 1, src: e, boom: 'shock', update: (ww, z) => { z.x = e.x; z.y = e.y; } });
      return;
    }
    toward(w, e, e.target.x, e.target.y, sp(e), dt);
  };

  AI.swarm = (w, e, dt) => {
    const V = e.def.dive;
    e.cd -= dt;
    if (V && diveTick(w, e, dt, V)) return;
    if (e.recoil > 0) { e.recoil -= dt; const a = Math.atan2(e.y - e.target.y, e.x - e.target.x); move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.8, dt); return; }
    if (V) {
      const d = distT(e);
      if (e.cd <= 0 && !blind(e) && d > V.min && d < V.range && hasLos(w, e)) { diveStart(w, e, V); return; }
      if (e.cd > 0 && d < V.range + 40) { orbitStep(w, e, dt, V.hover); return; } // circle until the next dive is ready
    }
    e.wob += dt * 5;
    const d = w.pathDir(e, e.target.x, e.target.y);
    const side = Math.sin(e.wob) * 0.7;
    move(w, e, d[0] - d[1] * side, d[1] + d[0] * side, sp(e), dt);
  };

  // Circles the hero on a ring, then dives (starspawn) or fires aimed bursts (drone).
  AI.orbiter = (w, e, dt) => {
    const O = e.def.orbit, V = e.def.dive, B = e.def.burst;
    e.cd -= dt;
    if (V && diveTick(w, e, dt, V)) return;
    if (B) {
      if (e.st === 'aim') {
        e.t -= dt;
        if (e.t > 0.15) e.aimA = lead(w, e, B.speed); // aim locks for the last 0.15 s
        if (e.t <= 0) { e.st = 'cast'; e.vars.shots = B.n; e.vars.gap = 0; }
        return;
      }
      if (e.st === 'cast') {
        e.vars.gap -= dt;
        if (e.vars.gap <= 0) {
          w.enemyShoot(e, e.aimA, B.speed, B.kind, B.mul, 5);
          w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: B.kind });
          e.vars.gap = B.gap;
          if (--e.vars.shots <= 0) { e.st = 'move'; e.cd = B.cd * rate(e) * w.rng.range(0.85, 1.15); }
        }
        return;
      }
    }
    const t = e.target, dx = e.x - t.x, dy = e.y - t.y, d = Math.hypot(dx, dy) || 1;
    if (e.recoil > 0) { e.recoil -= dt; move(w, e, dx / d, dy / d, sp(e) * 0.8, dt); return; }
    orbitStep(w, e, dt, O.r);
    if (blind(e)) return;
    if (V) {
      e.vars.orb = (e.vars.orb ?? w.rng.range(O.t[0], O.t[1])) - dt;
      if (e.vars.orb <= 0 && e.cd <= 0 && d > V.min && d < V.range && hasLos(w, e)) { e.vars.orb = w.rng.range(O.t[0], O.t[1]); diveStart(w, e, V); }
    } else if (B && e.cd <= 0 && d < 420 && hasLos(w, e) && onScreen(w, e)) {
      e.st = 'aim'; e.t = wind(e, B.windup); e.aimA = lead(w, e, B.speed);
      aimLine(w, e, 380, 8, e.t);
    }
  };

  AI.shooter = (w, e, dt) => {
    const S = e.def.shot;
    e.cd -= dt;
    if (e.st === 'aim') {
      e.t -= dt;
      e.aimA = lead(w, e, S.speed);
      if (e.t <= 0) {
        const n = e.vars.fan ? S.fan.n : S.n, spread = e.vars.fan ? S.fan.spread : S.spread;
        for (let i = 0; i < n; i++) w.enemyShoot(e, e.aimA + (i - (n - 1) / 2) * spread, S.speed, S.kind, 1, S.r);
        e.st = 'move'; e.cd = S.cd * rate(e) * w.rng.range(0.85, 1.15);
        w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: S.kind });
      }
      return;
    }
    kite(w, e, dt, e.def.keep);
    if (e.cd <= 0 && hasLos(w, e) && distT(e) < 360 && !blind(e) && onScreen(w, e)) {
      e.vars.shots = (e.vars.shots || 0) + 1;
      e.vars.fan = !!S.fan && e.vars.shots % S.fan.every === 0;
      e.st = 'aim'; e.t = wind(e, S.windup * (e.vars.fan ? 1.2 : 1)); e.aimA = lead(w, e, S.speed);
      if (e.vars.fan) {
        const arc = S.fan.spread * (S.fan.n - 1) + 0.16;
        w.addZone({ kind: 'teleCone', x: e.x, y: e.y, a: e.aimA, r: 230, arc, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true, update: (ww, z) => { z.x = e.x; z.y = e.y; z.a = e.aimA; } });
      }
    }
  };

  AI.turret = (w, e, dt) => {
    const P = e.def.pattern;
    e.cd -= dt;
    e.face = e.target.x > e.x ? 1 : -1;
    if (e.st === 'aim') {
      e.t -= dt;
      if (P.type !== 'laser') e.aimA = P.type === 'spread' ? lead(w, e, P.speed) : aimAt(e);
      if (e.t <= 0) {
        if (P.type === 'spread' && e.vars.glob) {
          // lobbed spore glob: telegraphed landing circle, leaves a slowing mire
          const G = P.glob, fl = wind(e, G.flight), pt = lobPoint(w, e, fl);
          w.addZone({ kind: 'tele', x: pt.x, y: pt.y, r: G.radius, dur: fl, dmg: e.dmg, team: 1, src: e, detached: true, boom: 'spore', lob: [Math.round(e.x), Math.round(e.y - 10)],
            onEnd: (ww, z) => ww.addZone({ kind: 'mire', x: z.x, y: z.y, r: G.radius * 0.9, dur: G.mire, team: 1 }) });
          e.st = 'move'; e.cd = P.cd * rate(e);
        } else if (P.type === 'spread') {
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
        for (let k = 0; k < P.arms; k++) w.enemyShoot(e, e.vars.ang + k * TAU / P.arms, P.speed, P.kind, 0.8, P.r);
      }
      if (e.t <= 0) { e.st = 'move'; e.cd = P.cd * rate(e); }
      return;
    }
    if (e.cd <= 0 && distT(e) < 420 && hasLos(w, e) && !blind(e) && onScreen(w, e)) {
      e.st = 'aim'; e.t = wind(e, P.windup);
      e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      if (P.glob) e.vars.glob = (e.vars.n = (e.vars.n || 0) + 1) % 2 === 0; // spread, glob, spread, ...
      if (P.type === 'laser') w.addZone({ kind: 'teleLine', x: e.x, y: e.y, a: e.aimA, len: P.len, w: P.w, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true });
    }
  };

  AI.charger = (w, e, dt) => {
    const C = e.def.charge, Wb = e.def.web, H = e.def.howl;
    e.cd -= dt;
    if (e.hasteT > 0) e.hasteT -= dt;
    if (Wb) e.vars.wcd = (e.vars.wcd ?? w.rng.range(0.4, 1.4)) - dt;
    if (H) e.vars.hcd = (e.vars.hcd ?? w.rng.range(2, 5)) - dt;
    if (e.st === 'windup') { e.t -= dt; if (e.t <= 0) { e.st = 'charge'; e.t = C.dur; e.vars.trail = 0; } return; }
    if (e.st === 'charge') {
      e.t -= dt;
      const hit = move(w, e, Math.cos(e.aimA), Math.sin(e.aimA), C.speed * haste(e), dt);
      if (C.trail) { e.vars.trail -= dt; if (e.vars.trail <= 0) { e.vars.trail = 0.06; w.addZone({ kind: 'fire', x: e.x, y: e.y, r: 16, dur: 1.8, dps: e.dmg * 0.5, team: 1 }); } }
      if (hit) { e.st = 'move'; e.stun = 0.7; e.cd = C.cd * rate(e); w.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y) }); return; }
      if (e.t <= 0) { e.st = 'move'; e.cd = C.cd * rate(e); }
      return;
    }
    if (e.st === 'aim') { // web shot: the landing circle is the warning, the mire forms where it lands
      e.t -= dt;
      e.aimA = lead(w, e, Wb.speed);
      if (e.t <= 0) {
        const fs = flightSpd(w, e, Wb.speed), d0 = distT(e), tv = (e.target.lvx || 0) * Math.cos(e.aimA) + (e.target.lvy || 0) * Math.sin(e.aimA); // d0 + closing speed x flight time = distance of the lead point
        const pt = Sim.castMove(w.room, e.x, e.y, e.aimA, Math.min(d0 + tv * leadK(w) * d0 / fs, Wb.range[1]), 4, true);
        const dd = Math.max(40, Math.hypot(pt.x - e.x, pt.y - e.y)), fl = dd / fs;
        w.enemyShoot(e, e.aimA, Wb.speed, 'web', 0.35, 6, { life: fl });
        w.addZone({ kind: 'tele', x: pt.x, y: pt.y, r: Wb.r, dur: fl, dmg: 0, team: 1, src: e, detached: true, warnOnly: true,
          onEnd: (ww, z) => ww.addZone({ kind: 'mire', x: z.x, y: z.y, r: Wb.r, dur: Wb.mire, team: 1 }) });
        w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: 'web' });
        e.st = 'move'; e.vars.wcd = Wb.cd * rate(e);
      }
      return;
    }
    if (e.st === 'cast') { // pack howl
      e.t -= dt;
      if (e.t <= 0) {
        for (const o of w.enemies) if (o.hp > 0 && o.type === e.type && U.dist2(o.x, o.y, e.x, e.y) < H.r * H.r) { o.hasteT = H.dur; o.haste = H.mul; }
        w.emit({ t: 'howl', x: Math.round(e.x), y: Math.round(e.y), r: H.r });
        e.st = 'move'; e.vars.hcd = H.cd;
      }
      return;
    }
    const d = distT(e);
    if (Wb && e.vars.wcd <= 0 && d > Wb.range[0] && d < Wb.range[1] && hasLos(w, e) && !blind(e) && onScreen(w, e)) {
      e.st = 'aim'; e.t = wind(e, Wb.windup); e.aimA = lead(w, e, Wb.speed); e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
      return;
    }
    if (e.cd <= 0 && d < C.range && d > 50 && hasLos(w, e) && !blind(e)) {
      e.st = 'windup'; e.t = wind(e, C.windup);
      e.aimA = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
      w.addZone({ kind: 'teleLine', x: e.x, y: e.y, a: e.aimA, len: C.speed * C.dur + e.r, w: e.r * 2, dur: e.t, team: 1, src: e, warnOnly: true, follow: e.id });
      return;
    }
    if (H && e.vars.hcd <= 0 && d < 340 && !blind(e)) {
      let mates = 0;
      for (const o of w.enemies) if (o !== e && o.hp > 0 && o.type === e.type && U.dist2(o.x, o.y, e.x, e.y) < H.r * H.r) mates++;
      if (mates) {
        e.st = 'cast'; e.t = wind(e, H.windup); e.face = e.target.x > e.x ? 1 : -1;
        w.addZone({ kind: 'tele', x: e.x, y: e.y, r: 54, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true, update: (ww, z) => { z.x = e.x; z.y = e.y; } });
        return;
      }
      e.vars.hcd = 1.5;
    }
    if (e.recoil > 0) { e.recoil -= dt; const a = Math.atan2(e.y - e.target.y, e.x - e.target.x); move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.7, dt); return; }
    toward(w, e, e.target.x, e.target.y, sp(e), dt);
  };

  AI.tank = (w, e, dt) => {
    const S = e.def.slam, G = e.def.guard, B = e.def.bash, K = e.def.claw;
    e.cd -= dt;
    if (B) e.vars.bcd = (e.vars.bcd ?? w.rng.range(1.5, 3)) - dt;
    if (G && e.st !== 'bash' && !(e.st === 'windup' && e.vars.atk === 'bash')) turnGuard(e, dt);
    if (e.st === 'windup') {
      e.t -= dt;
      if (e.t <= 0) {
        if (e.vars.atk === 'bash') { e.st = 'bash'; e.t = B.dur; return; }
        e.st = 'move'; e.cd = S.cd * rate(e);
        if (e.vars.atk === 'slam') {
          if (S.ring) for (let i = 0; i < S.ring.n; i++) w.enemyShoot(e, i * TAU / S.ring.n + w.rng.range(0, 0.3), S.ring.speed, S.ring.kind, 0.7, 6);
          if (S.cloud) w.addZone({ kind: 'poison', x: e.x, y: e.y, r: S.radius * 0.8, dur: 3, dps: e.dmg * 0.4, team: 1 });
        }
      }
      return;
    }
    if (e.st === 'bash') { // shield-bash charge: body-hit state
      e.t -= dt;
      const hit = move(w, e, Math.cos(e.aimA), Math.sin(e.aimA), B.speed, dt);
      if (hit) { e.st = 'move'; e.stun = 0.8; e.vars.bcd = B.cd * rate(e); e.cd = Math.max(e.cd, 0.8); w.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y) }); }
      else if (e.t <= 0) { e.st = 'move'; e.vars.bcd = B.cd * rate(e); e.cd = Math.max(e.cd, 0.8); }
      return;
    }
    const d = distT(e);
    if (B && e.vars.bcd <= 0 && d < B.range && d > B.min && hasLos(w, e) && !blind(e)) {
      e.st = 'windup'; e.vars.atk = 'bash'; e.t = wind(e, B.windup);
      e.aimA = aimAt(e); e.guardA = e.aimA; e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
      fixedLine(w, e, B.speed * B.dur + e.r, e.r * 2, e.t);
      return;
    }
    if (e.cd <= 0 && d < S.range + e.r && !blind(e)) {
      const claw = K && (e.vars.n = (e.vars.n || 0) + 1) % 2 === 0; // claw cone every other attack
      e.st = 'windup'; e.vars.atk = claw ? 'claw' : 'slam'; e.t = wind(e, claw ? K.windup : S.windup);
      if (claw) {
        w.addZone({ kind: 'teleCone', x: e.x, y: e.y, a: aimAt(e), r: K.r, arc: K.arc, dur: e.t, dmg: e.dmg * K.mul, team: 1, src: e });
      } else {
        w.addZone({ kind: 'tele', x: e.x, y: e.y, r: S.radius, dur: e.t, dmg: e.dmg * 1.2, team: 1, src: e, boom: 'slam' });
      }
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
        w.dropFoeXp(e);
      }
      return;
    }
    if (distT(e) < 38 + e.r && !blind(e)) { e.st = 'fuse'; e.t = wind(e, e.def.fuse); w.addZone({ kind: 'tele', x: e.x, y: e.y, r: e.def.boom, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true }); return; }
    const d = w.pathDir(e, e.target.x, e.target.y);
    e.wob += dt * 4;
    move(w, e, d[0] + Math.sin(e.wob) * 0.25, d[1] + Math.cos(e.wob) * 0.25, sp(e), dt);
  };

  // Casts of the caster family: ring, wave or homing orbs.
  const fireCast = (w, e, C) => {
    const a0 = C.type === 'ring' ? 0 : C.type === 'wave' ? e.aimA : lead(w, e, C.speed);
    if (C.type === 'ring') {
      const off = w.rng.range(0, 1);
      for (let i = 0; i < C.n; i++) w.enemyShoot(e, (i + off) * TAU / C.n, C.speed, C.kind, 0.9, C.r);
    } else if (C.type === 'wave') {
      for (let i = 0; i < C.n; i++) w.enemyShoot(e, a0 + (i - (C.n - 1) / 2) * 0.17, C.speed, C.kind, 0.9, C.r);
    } else if (C.type === 'homing') {
      for (let i = 0; i < C.n; i++) w.enemyShoot(e, a0 + (i - (C.n - 1) / 2) * 0.8, C.speed, C.kind, 1, C.r, { homing: 1.3, life: 4.5 });
    }
    w.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: C.kind });
  };

  // Retreat step: markers at origin and destination, 'fade' pose for S.windup, then a hop S.dist px away from the hero.
  const stepStart = (w, e, S) => {
    const t = e.target, base = Math.atan2(e.y - t.y, e.x - t.x);
    let best = null, bd = 0;
    for (const off of [0, 0.7, -0.7]) {
      const pt = Sim.castMove(w.room, e.x, e.y, base + off, S.dist, e.r, w.locked), d = Math.hypot(pt.x - t.x, pt.y - t.y);
      if (d > bd) { bd = d; best = pt; }
    }
    if (!best || Math.hypot(best.x - e.x, best.y - e.y) < 60) { e.vars.stepCd = 1.2; return false; }
    e.st = 'fade'; e.t = wind(e, S.windup); e.vars.dest = best;
    w.addZone({ kind: 'tele', x: best.x, y: best.y, r: e.r + 8, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true });
    w.addZone({ kind: 'tele', x: e.x, y: e.y, r: e.r + 8, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true });
    return true;
  };
  const stepTick = (w, e, dt, S) => {
    e.t -= dt;
    if (e.t > 0) return;
    const d = e.vars.dest;
    w.emit({ t: 'blinkfx', x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(d.x), y1: Math.round(d.y) });
    e.x = d.x; e.y = d.y; Sim.resolve(e, w.room, w.locked, e.fly);
    e.st = 'move'; e.vars.stepCd = S.cd; e.cd = Math.max(e.cd, 0.6);
  };

  AI.caster = (w, e, dt) => {
    const C = e.def.cast, S = e.def.step;
    e.cd -= dt;
    e.vars.stepCd = (e.vars.stepCd || 0) - dt;
    if (e.st === 'fade') { stepTick(w, e, dt, S); return; }
    if (e.st === 'cast') {
      e.t -= dt;
      if (C.type === 'wave') e.aimA = lead(w, e, C.speed);
      if (e.t <= 0) { fireCast(w, e, C); e.st = 'move'; e.cd = C.cd * rate(e); }
      return;
    }
    if (S && e.vars.stepCd <= 0 && distT(e) < S.near && stepStart(w, e, S)) return;
    kite(w, e, dt, [100, 230]);
    if (e.cd <= 0 && hasLos(w, e) && !blind(e) && onScreen(w, e)) {
      e.st = 'cast'; e.t = wind(e, C.windup);
      // the wind-up telegraph: a wave casts a cone that follows the led aim; a ring or homing cast a warn circle on the caster
      if (C.type === 'wave') { e.aimA = lead(w, e, C.speed); w.addZone({ kind: 'teleCone', x: e.x, y: e.y, a: e.aimA, r: 230, arc: 0.17 * (C.n - 1) + 0.16, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true, update: (ww, z) => { z.x = e.x; z.y = e.y; z.a = e.aimA; } }); }
      else w.addZone({ kind: 'tele', x: e.x, y: e.y, r: e.r + 30, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true, update: (ww, z) => { z.x = e.x; z.y = e.y; } });
    }
  };

  // Bone Priest: raises skeletons beside itself (telegraphed spawn) or wards the most-hurt ally.
  AI.priest = (w, e, dt) => {
    const P = e.def.priest;
    e.cd -= dt;
    if (e.vars.init === undefined) { e.vars.init = 1; e.cd = w.rng.range(2, 3.5); }
    if (e.st === 'cast') {
      e.t -= dt;
      if (e.t <= 0) {
        const a = e.vars.ally;
        if (a && a.hp > 0) { a.wardMax = Math.max(a.wardMax, a.maxHp * P.ward); a.ward = a.wardMax; w.emit({ t: 'ward', x: Math.round(a.x), y: Math.round(a.y) }); }
        e.vars.ally = null; e.st = 'move'; e.cd = P.cd * rate(e);
      }
      return;
    }
    kite(w, e, dt, [140, 260]);
    if (e.cd > 0 || blind(e) || !onScreen(w, e)) return;
    let ally = null, low = 0.85;
    for (const x of w.enemies) {
      if (x === e || x.hp <= 0 || x.boss || x.burrowed || x.ward > 0 || x.spawnT > 0) continue;
      const f = x.hp / x.maxHp;
      if (f < low) { low = f; ally = x; }
    }
    if (ally) {
      e.st = 'cast'; e.vars.ally = ally; e.t = wind(e, P.windup * 0.7);
      w.addZone({ kind: 'tele', x: ally.x, y: ally.y, r: ally.r + 10, dur: e.t, dmg: 0, team: 1, src: e, warnOnly: true, update: (ww, z) => { z.x = ally.x; z.y = ally.y; } });
      return;
    }
    if (owned(w, e, 'raisedBy') < P.max && (e.vars.raised || 0) < P.total) {
      const pt = spotNear(w, e, 64, [], 0);
      if (pt) {
        e.st = 'cast'; e.t = wind(e, P.windup); e.vars.raised = (e.vars.raised || 0) + 1;
        w.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 12, dur: e.t, type: 'skeleton', by: e.id, after: (en) => { en.raisedBy = e.id; } });
        return;
      }
    }
    e.cd = 1;
  };

  // Mire Worm: burrows (untargetable) toward the hero, marks a spot under the hero, erupts there, then stays exposed.
  AI.burrower = (w, e, dt) => {
    const B = e.def.burrow;
    if (e.vars.init === undefined) { e.vars.init = 1; e.st = 'erupt'; e.t = 0.6; }
    if (e.burrowed) e.contactCd = Math.max(e.contactCd, 0.5); // underground: no contact hits
    const t = e.target;
    e.face = t.x > e.x ? 1 : -1;
    if (e.st === 'erupt') {
      e.t -= dt;
      if (e.t <= 0) { e.st = 'burrow'; e.burrowed = true; e.vars.dig = B.dig; e.vars.spot = null; }
      return;
    }
    const spot = e.vars.spot;
    if (spot) { // creeping under the marker until the eruption
      const d = Math.hypot(spot.x - e.x, spot.y - e.y);
      if (d > 3) Sim.moveCircle(e, (spot.x - e.x) / d * Math.min(sp(e), d / dt) * dt, (spot.y - e.y) / d * Math.min(sp(e), d / dt) * dt, w.room, w.locked, true);
      return;
    }
    e.vars.dig -= dt;
    if (distT(e) > B.near || e.vars.dig > 0 || blind(e) || !hasLos(w, e)) { toward(w, e, t.x, t.y, sp(e), dt); return; }
    const mark = { x: t.x, y: t.y };
    e.vars.spot = mark;
    w.addZone({ kind: 'tele', x: mark.x, y: mark.y, r: B.radius, dur: wind(e, B.tele), dmg: e.dmg * 1.2, team: 1, src: e, boom: 'slam',
      onEnd: (ww) => {
        if (e.hp <= 0) return;
        e.x = mark.x; e.y = mark.y; Sim.resolve(e, ww.room, ww.locked, e.fly);
        e.burrowed = false; e.st = 'erupt'; e.t = B.expose; e.vars.spot = null; e.contactCd = Math.max(e.contactCd, 1);
        const off = ww.rng.range(0, 0.4);
        for (let i = 0; i < B.ring; i++) ww.enemyShoot(e, off + i * TAU / B.ring, 130, 'spore', 0.6, 6);
        ww.emit({ t: 'shoot', x: Math.round(e.x), y: Math.round(e.y), k: 'spore' });
      } });
  };

  // Drowned Reaver: telegraphed leap onto the hero's spot, landing cone after a pause; plain cleave up close.
  AI.leaper = (w, e, dt) => {
    const Lp = e.def.leap, Cl = e.def.cleave;
    e.cd -= dt; e.vars.lcd = (e.vars.lcd ?? w.rng.range(1, 2.5)) - dt;
    if (e.st === 'windup') { // crouch (leap) or raised blade (cleave)
      e.t -= dt;
      if (e.t <= 0) {
        if (e.vars.atk === 'leap') { e.st = 'leap'; e.t = Lp.flight; e.vars.from = [e.x, e.y]; }
        else { e.st = 'move'; e.cd = Cl.cd * rate(e); }
      }
      return;
    }
    if (e.st === 'leap') {
      e.t -= dt;
      const k = U.easeInOut(1 - Math.max(0, e.t) / Lp.flight), to = e.vars.to;
      e.x = U.lerp(e.vars.from[0], to.x, k); e.y = U.lerp(e.vars.from[1], to.y, k);
      if (e.t <= 0) {
        e.x = to.x; e.y = to.y; Sim.resolve(e, w.room, w.locked, e.fly);
        e.aimA = aimAt(e); e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
        e.st = 'idle'; e.t = wind(e, Cl.pause);
        w.addZone({ kind: 'teleCone', x: e.x, y: e.y, a: e.aimA, r: Cl.r, arc: Cl.arc, dur: e.t + wind(e, Cl.post), dmg: e.dmg * Cl.mul, team: 1, src: e });
      }
      return;
    }
    if (e.st === 'idle') { // landing pause, then the cleave swing
      e.t -= dt;
      if (e.t <= 0) { e.st = 'windup'; e.vars.atk = 'cleave'; e.t = wind(e, Cl.post); }
      return;
    }
    if (e.recoil > 0) { e.recoil -= dt; const a = Math.atan2(e.y - e.target.y, e.x - e.target.x); move(w, e, Math.cos(a), Math.sin(a), sp(e) * 0.6, dt); return; }
    const d = distT(e);
    if (!blind(e)) {
      if (e.vars.lcd <= 0 && d > Lp.min && d < Lp.range && hasLos(w, e)) {
        const total = wind(e, Lp.total);
        e.st = 'windup'; e.vars.atk = 'leap'; e.t = Math.max(0.2, total - Lp.flight); e.vars.lcd = Lp.cd * rate(e);
        e.vars.to = { x: e.target.x, y: e.target.y };
        e.aimA = aimAt(e); e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
        w.addZone({ kind: 'tele', x: e.vars.to.x, y: e.vars.to.y, r: Lp.radius, dur: e.t + Lp.flight, dmg: e.dmg * 1.2, team: 1, src: e, boom: 'slam' });
        return;
      }
      if (e.cd <= 0 && d < Cl.range + e.r) {
        e.st = 'windup'; e.vars.atk = 'cleave'; e.t = wind(e, Cl.windup);
        e.aimA = aimAt(e); e.face = Math.cos(e.aimA) > 0 ? 1 : -1;
        w.addZone({ kind: 'teleCone', x: e.x, y: e.y, a: e.aimA, r: Cl.r, arc: Cl.arc, dur: e.t, dmg: e.dmg * Cl.mul, team: 1, src: e });
        return;
      }
    }
    toward(w, e, e.target.x, e.target.y, sp(e), dt);
  };

  // Rift Caller: opens rifts (telegraphed spawn zones) up to a cap, otherwise lobs slow homing orbs.
  AI.summoner = (w, e, dt) => {
    const C = e.def.cast, R = e.def.rift;
    e.cd -= dt;
    e.vars.rcd = (e.vars.rcd ?? w.rng.range(2.5, 4.5)) - dt;
    if (e.st === 'cast') {
      e.t -= dt;
      if (e.t <= 0) {
        if (e.vars.kind === 'orb') { fireCast(w, e, C); e.cd = C.cd * rate(e); } else e.cd = Math.max(e.cd, 1);
        e.st = 'move';
      }
      return;
    }
    kite(w, e, dt, [170, 290]);
    if (blind(e) || !onScreen(w, e)) return;
    if (e.vars.rcd <= 0 && owned(w, e, 'summonedBy') <= R.cap - R.n) {
      const heroes = w.alivePlayers();
      e.st = 'cast'; e.vars.kind = 'rift'; e.t = wind(e, R.windup); e.vars.rcd = R.cd * rate(e);
      for (let i = 0; i < R.n; i++) {
        const pt = spotNear(w, e, 110, heroes, 90) || D.randomFloor(w.room, w.rng, heroes, 100);
        w.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: 14, dur: e.t, type: R.type, by: e.id, after: (en) => { en.summonedBy = e.id; } });
        w.emit({ t: 'rift', x: Math.round(pt.x), y: Math.round(pt.y) });
      }
      return;
    }
    if (e.cd <= 0 && hasLos(w, e)) { e.st = 'cast'; e.vars.kind = 'orb'; e.t = wind(e, C.windup); }
  };

  AI.lobber = (w, e, dt) => {
    const L = e.def.lob;
    e.cd -= dt;
    if (e.st === 'aim') {
      e.t -= dt;
      if (e.t <= 0) {
        const fl = wind(e, L.flight), pt = lobPoint(w, e, fl);
        w.addZone({ kind: 'tele', x: pt.x, y: pt.y, r: L.radius, dur: fl, dmg: e.dmg, team: 1, src: e, detached: true, boom: 'fire', lob: [Math.round(e.x), Math.round(e.y - 10)],
          onEnd: (ww, z) => ww.addZone({ kind: 'fire', x: z.x, y: z.y, r: L.radius * 0.6, dur: L.fire, dps: e.dmg * 0.45, team: 1 }) });
        e.st = 'move'; e.cd = L.cd * rate(e);
      }
      return;
    }
    kite(w, e, dt, e.def.keep);
    if (e.cd <= 0 && distT(e) < 300 && !blind(e) && onScreen(w, e)) { e.st = 'aim'; e.t = wind(e, L.windup); }
  };

  AI.boss = (w, e, dt) => { const b = ED.Bosses[e.type]; if (b) b(w, e, dt); };
})(globalThis.ED || (globalThis.ED = {}));
