// Bellwarden: the chained bell (weapon kind 'bell': chain physics, the Haul, strikes), Heave and Peal, the Bellwarden route cards that act on them and the hook table ED.CLS.bell.
// Each bell { x, y, vx, vy, hit } in p.bells is a point mass on a chain anchored at the hero, moving in the hero's frame: every tick it is carried by the hero's step, (vx, vy) is its velocity about the hero.
// It loses BELL_DRAG of that speed per second (an unhauled bell also feels the drag of the hero's own motion, p.lvx / p.lvy, so it trails a walking hero), a taut chain removes its outward speed
// and pulls it in while the chain shortens; walls bounce a free bell, a hauled one whirls over them. Haul (the held attack input, p.haulIn, else HAUL_HOLD attack intervals after each 'atk' action) shortens the chain to its orbit (HAUL_K of its length, at most BELL_ORBIT) and drives the bell along its orbit.
// A strike: a bell at BELL_MIN px/s or more overlapping a foe (each foe once per attack interval per bell), the weapon's dmg x clamp(speed / BELL_REF, 0.4, 1.8) through hitEnemy, costing the bell `loss` of its speed;
// a hauled chain sweeping a foe closer in strikes it as the bell. Knockback runs along the swing.
// The motion runs in BELL_SUB substeps per tick from the class tick and reads no RNG: it is a pure function of the hero's inputs and the room.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, Sim = ED.Sim, C = ED.CONST;
  const W = ED.World.prototype;

  // BELL_MIN / BELL_REF / BELL_CAP: px/s a strike needs, the speed of a x1 strike, the speed limit. BELL_DRAG: share of speed lost per second (exponential). BELL_SUB: substeps per tick.
  // HAUL_K / BELL_ORBIT: chain share while hauled and the longest hauled chain (px; foes at a hero's side stay within reach). HAUL_T: seconds the chain takes to shorten or let out fully at haul 1. HAUL_ACC: px/s2 of orbit drive at haul 1 and the weapon's own rate (x the attack-rate gain to the power RATE_POW: damage and strikes both grow with speed, so damage per second follows the gain about linearly). HAUL_HOLD: attack intervals one 'atk' action holds the Haul.
  // BELL_HITS: strikes per second one hero may make (the hit-event budget). CHAIN_R: half-width (px) of a hauled chain: a foe it sweeps across is struck as by the bell (once a revolution). HEAVE_W: px a Heaved bell's path is wider than the bell. WRECK_D: px of a Wrecker flight in the sheet (it stops at the first foe). ARC_LONE: a Chain Toll arc with no other foe near strikes the struck foe at this share. BELL_WALL: speed a wall bounce keeps (weapon.wall overrides). BOSS_LOSS: factor on a strike's speed cost against a boss. HEAVY_K: a Heavy Strike's least speed as a share of the hauled bell's top speed (full swing).
  // HEAVE_SPEED / HEAVE_T: launch speed and longest flight of a Heave; REEL_SPEED: px/s the chain reels back in after it. HOOK_CD / PEAL_SH_CD: seconds between Tether Hook shields / Warding Toll shields. PEAL_REST: a Peal at rest as a share of one at full swing.
  // SPIN_SPEED: px/s of the Wrecking Spin; SWAT_K: Warding Toll swat radius over the Peal's; WALL_CD: seconds between two Demolisher wall shocks of one bell. WHIRL_DR: damage the hero takes less while it hauls a bell flying at BELL_MIN or more.
  Object.assign(C, { BELL_MIN: 140, BELL_REF: 320, BELL_CAP: 900, BELL_DRAG: 2.5, BELL_SUB: 4, HAUL_K: 0.6, BELL_ORBIT: 30, HAUL_T: 0.25, HAUL_ACC: 1290, RATE_POW: 0.6, HAUL_HOLD: 1.6,
    BELL_HITS: 60, CHAIN_R: 3, HEAVE_W: 16, WRECK_D: 80, ARC_LONE: 1, BELL_WALL: 0.5, BOSS_LOSS: 1, HEAVY_K: 0.9, HEAVE_SPEED: 700, HEAVE_T: 0.45, REEL_SPEED: 1200, HOOK_CD: 8, PEAL_SH_CD: 10, PEAL_REST: 0.6 / 1.4, SPIN_SPEED: 900, SWAT_K: 1.5, WALL_CD: 0.3, WHIRL_DR: 0.45 });

  const blocked = (w, x, y) => D.blocksShots(D.tileAt(w.room, x, y), w.locked);
  const orbitOf = (wp) => Math.min(C.HAUL_K * wp.chain, C.BELL_ORBIT); // the hauled chain length (px)
  const bellR = (st) => st.weapon.br * (1 + 0.5 * st.area);
  const speedMul = (sp) => U.clamp(sp / C.BELL_REF, 0.4, 1.8);
  // Attack-rate gain of the hero now (>= 1 with attack speed, Battle Trance, War Drum): it shortens the per-foe lockout and drives the haul harder (x its RATE_POW power).
  const rateGain = (p) => p.stats.weapon.rate / ED.Stats.attackInterval(p);
  // Orbit drive of a hauled bell (px/s2): HAUL_ACC x haul x rate gain^RATE_POW x (1 + haulAcc: Pendulum), Perpetual Motion's top speed on top.
  const driveOf = (p, st) => C.HAUL_ACC * st.weapon.haul * Math.pow(rateGain(p), C.RATE_POW) * (1 + st.haulAcc) * (1 + st.perpetual);
  // Top speed of a hauled bell with drive A on an orbit of radius R: the drive against BELL_DRAG plus the chain's substep drag (NUM_K x v^2 / R^2, the radial part each substep projection removes), at most BELL_CAP.
  const NUM_K = 1 / (2 * 60 * C.BELL_SUB);
  const topSpeed = (A, R) => { const k2 = NUM_K / (R * R); let v = A / C.BELL_DRAG; for (let i = 0; i < 40; i++) v = A / (C.BELL_DRAG + k2 * v * v); return Math.min(C.BELL_CAP, v); };
  // The strike-speed infusion of Storm Bronze (the part of wInfLightning above Static Charge's own rate), cached on the stat block.
  const bellInf = (st) => { if (st.bwInf === undefined) { const r = Math.max(0, st.wInfLightning - st.lightningInfuse); st.bwInf = r > 0 ? { lightning: r } : null; } return st.bwInf || undefined; };

  // ---------------- the analytic model (the sheet and the bots) ----------------
  // ED.Bell.model(st, n, lockout, gain): the hauled bell of a standing hero striking n foes spaced evenly on its orbit (radius orbitOf), stepped at MODEL_DT for MODEL_T s from the top speed (the last
  // MODEL_MEAS s measured): the drive A = HAUL_ACC x haul x gain^RATE_POW x (1 + haulAcc) x (1 + perpetual) against the drag of topSpeed; the bell strikes each foe as it reaches it (at most once per lockout) and loses the weapon's loss share of its speed. Every bell of the weapon does the same, so a foe takes n bells x the strikes of one.
  // Returns { v (mean strike speed), sps (strikes per second on one foe, every bell), mul (mean damage factor of a strike: speed and Heavy Strikes), heavy (share of Heavy Strikes), hmul (mean factor of a Heavy Strike), top (top speed) }; cached on the stat block.
  const MODEL_DT = 1 / 120, MODEL_T = 10, MODEL_MEAS = 7;
  ED.Bell = {
    model(st, n, lockout, gain) {
      const w = st.weapon, nf = Math.max(1, n | 0), g = gain || 1, lock = lockout || w.rate, key = nf + ':' + lock.toFixed(4) + ':' + g.toFixed(4), memo = st.bellM || (st.bellM = {});
      if (memo[key]) return memo[key];
      const R = orbitOf(w), A = C.HAUL_ACC * w.haul * Math.pow(g, C.RATE_POW) * (1 + st.haulAcc) * (1 + st.perpetual);
      const keep = 1 - w.loss * (1 - Math.min(1, st.strikeKeep)), k2 = NUM_K / (R * R), top = topSpeed(A, R), HV = C.HEAVY_K * top;
      let v = top, th = 0, next = 0, sumMul = 0, sumV = 0, heavy = 0, sumH = 0, cnt = 0, t0 = 0, t1 = 0;
      const last = new Array(nf).fill(-9), gap = U.TAU / nf;
      for (let t = 0; t < MODEL_T; t += MODEL_DT) {
        v = Math.min(C.BELL_CAP, v + (A - (C.BELL_DRAG + k2 * v * v) * v) * MODEL_DT);
        th += v * MODEL_DT / R;
        while (th >= next) {
          const j = Math.round(next / gap) % nf;
          next += gap;
          if (t - last[j] < lock) continue;
          last[j] = t;
          const hv = st.heavyHit > 0 && v >= HV;
          if (t >= MODEL_T - MODEL_MEAS) { const m = speedMul(v) * (hv ? 1 + st.heavyHit : 1); sumMul += m; sumV += v; if (hv) { heavy++; sumH += m; } if (!cnt) t0 = t; t1 = t; cnt++; }
          v *= keep;
        }
      }
      const nb = w.n || 1;
      return (memo[key] = { v: sumV / Math.max(1, cnt), sps: nb * (cnt > 1 ? (cnt - 1) / (t1 - t0) : cnt / MODEL_MEAS) / nf, mul: cnt ? sumMul / cnt : 0, heavy: cnt ? heavy / cnt : 0, hmul: heavy ? sumH / heavy : 0, top });
    },
    speedMul, rateGain, orbit: orbitOf,
    // Seconds of a cast the bell does not strike as a weapon: a Heave's flight (at most HEAVE_T), Wrecking Spin and reel back to the orbit; a Peal's spin-up from rest (the drag's time constant).
    busy(st) {
      const N = ED.Stats.skillNums('heave', st), reach = st.wrecker > 0 ? Math.min(C.WRECK_D, N.range * (1 + st.heaveR)) : N.range * (1 + st.heaveR), spin = N.p.spin.on ? N.p.spin.dur : 0; // Wrecker stops at the first foe (WRECK_D)
      return { heave: Math.min(C.HEAVE_T, reach / C.HEAVE_SPEED) + spin + Math.max(0, reach - orbitOf(st.weapon)) / C.REEL_SPEED, peal: 1 / C.BELL_DRAG };
    },
  };

  // ---------------- bells ----------------
  // Lays out the hero's bells at rest around it (a new room, a new weapon, the first tick): evenly spaced, half a chain out, still.
  function resetBells(w, p, wp) {
    const n = wp.n || 1;
    p.bells.length = 0;
    p.bellL = wp.chain; p.haul = 0; p.heave = null; p.bellRoom = w.room; p.bellPx = p.x; p.bellPy = p.y;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + i * U.TAU / n, d = wp.chain * 0.5;
      let x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (blocked(w, x, y)) { x = p.x; y = p.y; }
      p.bells.push({ x, y, vx: 0, vy: 0, hit: new Map(), wallT: 0 });
    }
  }

  // Turning sense of a Haul, fixed when it starts: the way the first bell already swings about the hero (when it swings faster than BELL_MIN / 2 px/s), else the last one.
  function spinOf(p) {
    const b = p.bells[0], rx = b.x - p.x, ry = b.y - p.y, d = Math.hypot(rx, ry);
    if (d < 2) return p.bellSpin;
    const vt = (rx * b.vy - ry * b.vx) / d; // tangential speed about the hero
    return Math.abs(vt) > C.BELL_MIN / 2 ? (vt > 0 ? 1 : -1) : p.bellSpin;
  }

  // A bell's speed about its hero (what strikes read) and its scaling by k.
  const relV = (p, b) => Math.hypot(b.vx, b.vy);
  const scaleRel = (p, b, k) => { b.vx *= k; b.vy *= k; };
  // Carries the bells by the hero's step since the last tick (a jump of 24 px or more, a room change or a teleport, is not carried); a wall in the way holds a free bell back.
  function carry(w, p) {
    const dx = p.x - p.bellPx, dy = p.y - p.bellPy;
    p.bellPx = p.x; p.bellPy = p.y;
    if (!(dx || dy) || dx * dx + dy * dy >= 576) return;
    for (const b of p.bells) {
      if (p.bellHauled || !blocked(w, b.x + dx, b.y + dy)) { b.x += dx; b.y += dy; }
      else if (!blocked(w, b.x + dx, b.y)) b.x += dx;
      else if (!blocked(w, b.x, b.y + dy)) b.y += dy;
    }
  }

  // True while the hero hauls: the input flag p.haulIn when the input layer sets it, else the hold window of the last 'atk' action; never during a Heave.
  const hauling = (w, p) => !p.heave && (p.haulIn !== undefined ? !!p.haulIn : w.time < p.haulUntil);

  // One substep h of bell b: the orbit drive (hauled), drag (trail: also the hero's motion), the move with wall bounces, the chain (length Lc, changing at Ldot px/s), then the foes it overlaps.
  function stepBell(w, p, b, h, Lc, Ldot, drive, foes, drag, trail) {
    const st = p.stats, wp = st.weapon, hx = p.x, hy = p.y, a0 = Math.atan2(b.y - hy, b.x - hx);
    let rx = b.x - hx, ry = b.y - hy, d = Math.hypot(rx, ry);
    if (drive > 0) {
      if (d < 2) { rx = Math.cos(p.face || 0) * 2; ry = Math.sin(p.face || 0) * 2; d = 2; }
      const s = p.bellSpin || 1;
      b.vx += -ry / d * s * drive * h; b.vy += rx / d * s * drive * h;
    }
    if (drag) { const f = Math.exp(-C.BELL_DRAG * h); b.vx *= f; b.vy *= f; if (trail) { b.vx -= (p.lvx || 0) * (1 - f); b.vy -= (p.lvy || 0) * (1 - f); } }
    let sp = relV(p, b);
    if (sp > C.BELL_CAP) { scaleRel(p, b, C.BELL_CAP / sp); sp = C.BELL_CAP; }
    // move: a hauled bell whirls over walls; a free or Heaved one (out of a wall) bounces off them axis by axis
    const keep = wp.wall !== undefined ? wp.wall : C.BELL_WALL, solid = !(drive > 0) && !blocked(w, b.x, b.y);
    let nx = b.x + b.vx * h, ny = b.y + b.vy * h, wall = false;
    if (solid && blocked(w, nx, b.y)) { b.vx = -b.vx * keep; nx = b.x; wall = true; }
    if (solid && blocked(w, nx, ny)) { b.vy = -b.vy * keep; ny = b.y; wall = true; }
    if (wall && sp >= p.bellHv && st.demolish > 0 && b.wallT <= w.time) { b.wallT = w.time + C.WALL_CD; wreckShock(w, p, nx, ny, wp.dmg * speedMul(sp) * (1 + st.heavyHit), true); }
    if (wall && p.heave && p.heave.phase === 'fly') p.heave.wall = true;
    // the chain: a taut chain holds the bell at Lc and lets it move outward no faster than the chain grows
    rx = nx - hx; ry = ny - hy; d = Math.hypot(rx, ry);
    if (d > Lc && d > 0) {
      const ux = rx / d, uy = ry / d;
      nx = hx + ux * Lc; ny = hy + uy * Lc;
      for (let k = 1; k < 8 && solid && blocked(w, nx, ny); k++) { nx = hx + ux * Lc * (1 - k / 8); ny = hy + uy * Lc * (1 - k / 8); } // never inside a wall: slide toward the hero
      const vr = b.vx * ux + b.vy * uy;
      if (vr > Ldot) { b.vx += (Ldot - vr) * ux; b.vy += (Ldot - vr) * uy; }
    }
    b.x = nx; b.y = ny;
    // hooked foes ride the bell
    const hv = p.heave;
    if (hv && hv.hooks.length) for (const e of hv.hooks) if (e.hp > 0) { Sim.moveCircle(e, b.x - e.x, b.y - e.y, w.room, w.locked, e.fly); e.kbx = 0; e.kby = 0; }
    // strikes
    const br = bellR(st);
    for (let i = 0; i < foes.length; i++) {
      const e = foes[i];
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || e.invulnT > 0 || e.hookedBy === p) continue;
      const rr = br + (hv ? C.HEAVE_W : 0) + e.r; // a Heaved bell strikes a wider path (HEAVE_W)
      let lash = false;
      if (U.dist2(e.x, e.y, b.x, b.y) >= rr * rr) { // not on the bell: the hauled chain sweeping across a foe closer in strikes it as the bell (a foe at the hero's feet is not out of reach)
        if (hv ? hv.phase !== 'spin' : !(drive > 0)) continue; // a hauled chain, or the long chain of a Wrecking Spin
        const df = Math.hypot(e.x - hx, e.y - hy);
        if (df >= Math.hypot(b.x - hx, b.y - hy)) continue;
        const sw = U.angDiff(a0, Math.atan2(b.y - hy, b.x - hx)), da = U.angDiff(a0, Math.atan2(e.y - hy, e.x - hx)), wa = df > e.r + C.CHAIN_R ? Math.asin((e.r + C.CHAIN_R) / df) : 0; // the chain's sweep this substep against the foe's bearing (a foe over the hero: its centre)
        if (da < Math.min(0, sw) - wa || da > Math.max(0, sw) + wa) continue;
        lash = true;
      }
      if (hv) { heaveContact(w, p, b, e, hv); continue; }
      sp = relV(p, b);
      if (sp < C.BELL_MIN || p.bellTok < 1) continue;
      const last = b.hit.get(e.id);
      if (last !== undefined && w.time - last < ED.Stats.attackInterval(p) - 1e-9) continue;
      b.hit.set(e.id, w.time);
      strike(w, p, b, e, sp, lash);
    }
  }

  // ---------------- strikes ----------------
  // A strike of bell b at speed sp on foe e: the weapon hit (Heavy Strike bonus, crit stacks, Masterstroke, Twin Fang), the speed it costs, then everything a weapon attack carries (a ring weapon's ring,
  // the evolution, Thunder Gauntlet) and the route riders; each strike counts as an attack (p.atkCount). lash: struck by the chain (the event sits on the foe).
  function strike(w, p, b, e, sp, lash) {
    const st = p.stats, wp = st.weapon, f = speedMul(sp), heavy = st.heavyHit > 0 && sp >= p.bellHv;
    const ux = b.vx / sp, uy = b.vy / sp; // knock along the swing (foes stay in the bell's reach)
    p.bellTok -= 1; p.atkCount++; p.lastAtkT = w.time;
    let crit, mul = f * (heavy ? 1 + st.heavyHit : 1) * (st.rod > 0 && e.charge > 0 ? 1 + st.rod : 1), bleedMin; // Lightning Rod: +rod on a charged foe
    if (p.critStacks > 0) { p.critStacks--; crit = true; }
    const ms = st.masterstroke && p.atkCount % 4 === 0;
    if (ms) crit = true;
    const sd = wp.dmg * mul, infAdd = bellInf(st), knock = wp.knock * Math.min(1.5, f) * (heavy ? 1.5 * (1 + st.heavyKnock) : 1); // Unstoppable: heavyKnock
    const src = { p, kind: 'weapon', wpn: true, mul: ms ? mul * 1.3 : mul, crit, bleedMin: ms ? 0.5 : bleedMin, infAdd, knock, kx: ux, ky: uy, x: b.x, y: b.y };
    w.hitEnemy(e, wp.dmg, src);
    if (st.twinEvery && p.atkCount % st.twinEvery === 0) w.hitEnemy(e, wp.dmg, { p, kind: 'weapon', wpn: true, mul, crit, infAdd, knock, kx: ux, ky: uy, x: b.x, y: b.y });
    const keep = 1 - wp.loss * (e.boss ? C.BOSS_LOSS : 1) * (1 - Math.min(1, st.strikeKeep)); // Counterweight / Perpetual Motion (strikeKeep) remove a share of the cost
    scaleRel(p, b, keep);
    w.emit({ t: 'bstrike', pid: p.pid, x: Math.round(lash ? e.x : b.x), y: Math.round(lash ? e.y : b.y), v: Math.round(sp), h: heavy ? 1 : 0, c: lash ? 1 : 0 }); // c: struck by the chain
    const area = 1 + 0.5 * st.area, a = Math.atan2(e.y - p.y, e.x - p.x);
    if (wp.ring) ringOf(w, p, b, e, sd * wp.ring.mul, wp.ring.r * area);
    if (st.evo === 'general' && src.critOut && e.hp > 0) w.hitEnemy(e, wp.dmg, { p, kind: 'weapon', wpn: true, mul: mul * 0.6, infAdd, knock: knock * 0.5, kx: ux, ky: uy, x: b.x, y: b.y }); // Masterwork Arms: a spectral strike
    bellEvo(w, p, e, a, sd);
    if (st.gauntlet && p.atkCount % 6 === 0) {
      const tg = e.hp > 0 ? e : w.nearestEnemy(e.x, e.y, 220);
      if (tg) { w.emit({ t: 'bolt', x: Math.round(tg.x), y: Math.round(tg.y) }); w.explode(tg.x, tg.y, 40, sd * 2.2, 0, p, 'bolt', false, { el: 'lightning' }); }
    }
    if (st.wreck > 0) wreckShock(w, p, e.x, e.y, sd, heavy);
    if (st.chainArc > 0) chainArc(w, p, e, sd * st.chainArc, infAdd);
    if (st.rod > 0 && e.hp > 0 && e.charge > 0 && (e.bwRod = (e.bwRod | 0) + 1) >= 4) { e.bwRod = 0; w.discharge(e, p, 1); if (st.rodStun > 0 && e.hp > 0) w.stunFoe(e, st.rodStun, true); }
    if (st.stormBolt > 0 && p.atkCount % 3 === 0) { w.emit({ t: 'bolt', x: Math.round(e.x), y: Math.round(e.y) }); w.explode(e.x, e.y, 50 * area, sd * st.stormBolt, 0, p, 'bolt', false, { clsEl: st.element || undefined, infAdd: { lightning: 0.5 }, part: 'bell.storm' }); }
    if (st.tollStorm > 0 && e.hp <= 0) w.explode(e.x, e.y, 90 * area, sd * st.tollStorm, 0, p, 'bolt', false, { el: 'lightning', infAdd: { lightning: 0.5 }, part: 'bell.toll' });
  }

  // A ring weapon (Storm Bell): every other foe within r of the bell takes dmg (a weapon shock: no crit, no procs).
  function ringOf(w, p, b, e0, dmg, r) {
    const q = w.foeScan(b.x, b.y, r), list = [];
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (e !== e0 && e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed && U.dist2(e.x, e.y, b.x, b.y) < (r + e.r) ** 2) list.push(e); }
    w.foeEnd();
    for (const e of list) { const d = Math.hypot(e.x - b.x, e.y - b.y) || 1; w.hitEnemy(e, dmg, { p, kind: 'explode', wpn: true, noProc: true, crit: false, noGuard: true, knock: 60, kx: (e.x - b.x) / d, ky: (e.y - b.y) / d, x: b.x, y: b.y, part: 'bell.ring' }); }
    w.emit({ t: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: Math.round(r), k: 'shock' });
  }

  // Evolutions on a strike (every Nth strike as the Nth attack): Cinder Arms bursts the strike in flame (radius 40, 50%), Glacial / Tempest Arms fire their shards and bolt from the hero at the foe,
  // Venomous Arms bursts acid on the foe, Hallowed Arms a lance through it, Umbral Arms queues a twin strike 0.15 s later at 40%. sd: the strike's weapon damage (speed and Heavy Strike included).
  function bellEvo(w, p, e, a, sd) {
    const st = p.stats, evo = st.evo;
    if (!evo || evo === 'general') return;
    const n = p.atkCount, ws = { kind: 'bell', dmg: sd };
    if (evo === 'fire') w.explode(e.x, e.y, 40 * (1 + 0.5 * st.area), sd * 0.5, 0, p, 'fire', false, { kind: 'evo', wpn: true });
    else if (evo === 'ice' || evo === 'lightning') w.evoAttack(p, a, ws, evo);
    else if (evo === 'poison' && n % 3 === 0) w.acidBurst(p, e.x, e.y);
    else if (evo === 'holy' && n % 3 === 0) w.holyLance(p, a, ws);
    else if (evo === 'shadow') p.bellQ.push({ at: w.time + 0.15, k: 'twin', e, dmg: sd * 0.4 });
  }

  // Wrecking Ball: a shock (radius 50, Demolisher 80) at (x, y) for wreck (+ demolish) of the strike's damage sd, twice that and a repeating stun of wreckStun from a Heavy Strike; a weapon shock (no crit, no procs, no knockback: the pack stays in the bell's reach).
  function wreckShock(w, p, x, y, sd, heavy) {
    const st = p.stats, r = (st.demolish > 0 ? 80 : 50) * (1 + 0.5 * st.area);
    w.explode(x, y, r, sd * (st.wreck + st.demolish) * (heavy ? 2 : 1), 0, p, 'shock', true, { wpn: true, stun: heavy ? st.wreckStun : 0, knock: 0, part: 'bell.wreck' });
  }

  // Chain Toll: the strike arcs to the nearest other foe within 90 of e (Forked Toll: arcN more, each from the last), a Lightning hit of dmg that charges like the strike.
  function chainArc(w, p, e, dmg, infAdd) {
    const seen = new Set([e.id]), pts = [[Math.round(e.x), Math.round(e.y)]];
    let from = e;
    for (let j = 0; j <= (p.stats.arcN | 0); j++) {
      const o = w.nearestEnemy(from.x, from.y, 90, seen);
      if (!o) { if (j === 0 && e.hp > 0) w.hitEnemy(e, dmg * C.ARC_LONE, { p, kind: 'explode', el: 'lightning', crit: false, noGuard: true, infAdd, x: e.x, y: e.y, part: 'bell.arc' }); break; } // no other foe: the arc grounds back into the struck foe
      seen.add(o.id); pts.push([Math.round(o.x), Math.round(o.y)]);
      w.hitEnemy(o, dmg, { p, kind: 'explode', el: 'lightning', crit: false, noGuard: true, infAdd, x: from.x, y: from.y, part: 'bell.arc' });
      from = o;
    }
    if (pts.length > 1) w.emit({ t: 'chain', pts });
  }

  // ---------------- Heave ----------------
  // Cast: every bell is flung from the hero toward the cursor at HEAVE_SPEED (bells fanned 0.15 rad apart) on a chain let out to the skill's range x (1 + heaveR).
  // p.heave = { phase 'fly' | 'spin' | 'reel', t, reach, a, v0 (the fastest bell's speed at the cast), hit (struck in flight), reel (struck on the way back), hooks (Tether Hook), wall }.
  ED.CAST.heave = function (p, a, data, st, N) {
    if (st.weapon.kind !== 'bell') return false;
    if (p.bellRoom !== this.room || !p.bells.length) resetBells(this, p, st.weapon);
    const n = p.bells.length, reach = N.range * (1 + st.heaveR), v0 = Math.max(...p.bells.map(b => relV(p, b)));
    p.bells.forEach((b, i) => {
      const aa = a + (i - (n - 1) / 2) * 0.15;
      b.x = p.x + Math.cos(aa) * 6; b.y = p.y + Math.sin(aa) * 6; b.vx = Math.cos(aa) * C.HEAVE_SPEED; b.vy = Math.sin(aa) * C.HEAVE_SPEED;
    });
    p.heave = { phase: 'fly', t: 0, reach, a, v0, hit: new Set(), reel: new Set(), hooks: [], wall: false, spinT: 0 };
    p.bellL = reach;
    return { r: Math.round(reach) };
  };

  // A bell in a Heave touches foe e: in flight a Heave strike (each foe once; Tether Hook catches the first 1 + hookN that are neither elite nor boss), on the way back a Reel strike (each foe once),
  // in a Wrecking Spin a spin strike (each foe once per spin `every`).
  function heaveContact(w, p, b, e, hv) {
    const st = p.stats, N = ED.Stats.skillNums('heave', st), sp = Math.hypot(b.vx, b.vy) || 1, o = { kx: b.vx / sp, ky: b.vy / sp, x: b.x, y: b.y };
    if (hv.phase === 'fly') {
      if (hv.hit.has(e.id)) return;
      hv.hit.add(e.id);
      w.hitEnemy(e, N.p.strike.dmg, w.partSrc(p, N, 'strike', o));
      if (st.wrecker > 0 && !hv.stop) { hv.stop = true; hv.reach = Math.max(orbitOf(st.weapon), Math.hypot(b.x - p.x, b.y - p.y)); } // Wrecker: the flight stops at the first foe struck (the smash and a Wrecking Spin happen there)
      if (st.hook > 0 && e.hp > 0 && !e.boss && !e.elite && hv.hooks.length < 1 + (st.hookN | 0)) { hv.hooks.push(e); e.hookedBy = p; e.kbx = 0; e.kby = 0; }
    } else if (hv.phase === 'reel') {
      if (hv.reel.has(e.id) || hv.hooks.includes(e)) return;
      hv.reel.add(e.id);
      w.hitEnemy(e, N.p.reel.dmg, w.partSrc(p, N, 'reel', o));
    } else {
      const q = N.p.spin, last = b.hit.get(e.id);
      if (last !== undefined && w.time - last < q.every - 1e-9) return;
      b.hit.set(e.id, w.time);
      w.hitEnemy(e, q.dmg, w.partSrc(p, N, 'spin', o));
    }
  }

  // The Heave's phases each tick: the flight ends after HEAVE_T, at a wall, at the first foe struck (Wrecker) or when every bell is at the end of its chain (Wrecker smashes there); a Wrecking Spin swings the bells around at SPIN_SPEED for spinDur;
  // then the chain reels in at REEL_SPEED to its length now, and the Heave ends (hooked foes land: stun, shield, Shackle). Returns the chain length and its rate of change this tick.
  function heaveTick(w, p, hv, dt, target) {
    const st = p.stats;
    hv.t += dt;
    if (hv.phase === 'fly') {
      const done = hv.t >= C.HEAVE_T || hv.wall || hv.stop || p.bells.every(b => Math.hypot(b.x - p.x, b.y - p.y) >= hv.reach - 2);
      if (done) {
        const N = ED.Stats.skillNums('heave', st);
        if (N.p.smash.on) for (const b of p.bells) {
          const q = N.p.smash;
          w.skillBlast(p, b.x, b.y, q.r, q.dmg, w.partSrc(p, N, 'smash'), (e) => { if (e.hp > 0 && st.smashStun > 0) w.stunFoe(e, st.smashStun, false); });
          w.emit({ t: 'bsmash', pid: p.pid, x: Math.round(b.x), y: Math.round(b.y), r: Math.round(q.r) });
        }
        if (N.p.spin.on) {
          hv.phase = 'spin'; hv.spinT = N.p.spin.dur;
          const s = p.bellSpin || 1;
          for (const b of p.bells) { const rx = b.x - p.x, ry = b.y - p.y, d = Math.hypot(rx, ry) || 1; b.vx = -ry / d * s * C.SPIN_SPEED; b.vy = rx / d * s * C.SPIN_SPEED; }
        } else hv.phase = 'reel';
      }
      return { L: hv.reach, Ldot: 0 };
    }
    if (hv.phase === 'spin') {
      hv.spinT -= dt;
      for (const b of p.bells) { const sp = Math.hypot(b.vx, b.vy) || 1; b.vx *= C.SPIN_SPEED / sp; b.vy *= C.SPIN_SPEED / sp; }
      if (hv.spinT <= 0) hv.phase = 'reel';
      return { L: hv.reach, Ldot: 0 };
    }
    const L = Math.max(target, p.bellL - C.REEL_SPEED * dt);
    if (L <= target + 1e-6) endHeave(w, p, hv);
    return { L, Ldot: -C.REEL_SPEED };
  }

  // End of a Heave: the bells swing on round the hero (spin sense p.bellSpin) at the speed they had at the cast, at least a third of their own; each hooked foe lands stunned (hookStun), Shackled (Anchor Chain: slowed 50%, weakened shackleWeak); one hook shields the hero (hookShield, once per HOOK_CD).
  function endHeave(w, p, hv) {
    const st = p.stats;
    p.heave = null;
    const s = p.bellSpin || 1;
    for (const b of p.bells) { const rx = b.x - p.x, ry = b.y - p.y, d = Math.hypot(rx, ry) || 1, v = Math.max(hv.v0 || 0, 0.3 * relV(p, b)); b.vx = -ry / d * s * v; b.vy = rx / d * s * v; }
    let any = false;
    for (const e of hv.hooks) {
      e.hookedBy = null;
      if (e.hp <= 0) continue;
      any = true;
      w.stunFoe(e, st.hookStun, false);
      if (st.shackle > 0) { w.slowEnemy(e, 0.5, st.shackle); e.weakV = Math.max(e.weakT > 0 ? e.weakV : 0, st.shackleWeak); e.weakT = Math.max(e.weakT, st.shackle); }
    }
    if (any) {
      w.emit({ t: 'bhook', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), n: hv.hooks.length });
      if (st.hookShield > 0 && p.hookT <= 0 && w.addShield(p, st.hookShield * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class') > 0) p.hookT = C.HOOK_CD;
    }
  }

  // ---------------- Peal ----------------
  // Cast: every bell stops dead and rings a wave of the wave part around itself, x (PEAL_REST + (1 - PEAL_REST) x min(1, speed / BELL_REF)) by the speed it had; a foe is struck by one wave per cast.
  // Struck foes are stunned (wave stun + pealStun; never bosses); Thunderclap charges them for half of the hit and discharges that Charge (only) at 1 + clap; Warding Toll swats shots and shields per foe struck; Reverberation rings again later;
  // Thunder Toll calls bolts on the most charged foes near the bell; Ward Bell leaves a ward zone.
  ED.CAST.peal = function (p, a, data, st, N) {
    if (st.weapon.kind !== 'bell') return false;
    if (p.bellRoom !== this.room || !p.bells.length) resetBells(this, p, st.weapon);
    const q = N.p.wave, seen = new Set();
    let struck = 0, top = 0;
    for (const b of p.bells) {
      const sp = relV(p, b), m = C.PEAL_REST + (1 - C.PEAL_REST) * Math.min(1, sp / C.BELL_REF);
      top = Math.max(top, sp);
      scaleRel(p, b, 0);
      struck += pealWave(this, p, N, 'wave', b.x, b.y, q.r, q.dmg * m, seen);
      this.emit({ t: 'peal', pid: p.pid, x: Math.round(b.x), y: Math.round(b.y), r: Math.round(q.r), v: Math.round(sp) });
      if (N.p.echo.on) p.bellQ.push({ at: this.time + N.p.echo.delay, k: 'echo', x: b.x, y: b.y, dmg: N.p.echo.dmg * m, room: this.room });
      if (st.pealSwat > 0) swat(this, b.x, b.y, q.r * C.SWAT_K);
      if (N.p.bolt.on) tollBolts(this, p, N, b.x, b.y, N.p.bolt.dmg * m);
      if (N.p.ward.on) wardZone(this, p, b.x, b.y, N.p.ward.r, N.p.ward.dur);
    }
    if (st.pealShield > 0 && struck > 0 && p.pealT <= 0 && this.addShield(p, Math.min(st.pealCap, st.pealShield * struck) * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class') > 0) p.pealT = C.PEAL_SH_CD;
    return { v: Math.round(top) };
  };

  // One Peal wave (part pid of N, centre x, y, radius r, damage dmg) on every foe not yet in seen: the hit, the stun (the wave's), Thunderclap's charge and discharge. Returns the foes struck that are not horde foes.
  function pealWave(w, p, N, pid, x, y, r, dmg, seen) {
    const st = p.stats, wave = pid === 'wave', q = w.foeScan(x, y, r), list = [];
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (!seen.has(e.id) && e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed && U.dist2(e.x, e.y, x, y) < (r + e.r) ** 2) list.push(e); }
    w.foeEnd();
    let n = 0;
    for (const e of list) {
      seen.add(e.id);
      const d = Math.hypot(e.x - x, e.y - y) || 1, ch0 = e.charge > 0 ? e.charge : 0;
      w.hitEnemy(e, dmg, w.partSrc(p, N, pid, { kx: (e.x - x) / d, ky: (e.y - y) / d, x, y, noGuard: true, infAdd: st.clap > 0 ? { lightning: 0.5 } : undefined }));
      if (!e.fodder) n++;
      if (e.hp <= 0) continue;
      if (wave) w.stunFoe(e, N.p.wave.stun + st.pealStun, false);
      if (st.clap > 0 && e.charge > ch0) { e.charge -= ch0; w.discharge(e, p, 1 + st.clap); if (e.hp > 0) e.charge = ch0; } // Thunderclap discharges the Charge this wave left; the foe keeps what it held before
    }
    w.smashCircle(p, x, y, r);
    return n;
  }

  // Warding Toll: every enemy shot within r of (x, y) is destroyed.
  function swat(w, x, y, r) {
    for (const o of w.projs) {
      if (o.team !== 1 || o.life <= 0 || U.dist2(o.x, o.y, x, y) > r * r) continue;
      o.life = 0;
      w.emit({ t: 'deflect', x: Math.round(o.x), y: Math.round(o.y) });
    }
  }

  // A flying bell destroys every enemy shot its path this tick (from b.px, b.py) passes within its radius of.
  function swatPath(w, b, r) {
    for (const o of w.projs) {
      if (o.team !== 1 || o.life <= 0 || U.segDist2(o.x, o.y, b.px, b.py, b.x, b.y) > (r + (o.r || 4)) ** 2) continue;
      o.life = 0;
      w.emit({ t: 'deflect', x: Math.round(o.x), y: Math.round(o.y) });
    }
  }

  // Thunder Toll: a bolt (radius 50 x area) of dmg on each of the tollN foes holding the most Charge within 220 of (x, y).
  function tollBolts(w, p, N, x, y, dmg) {
    const st = p.stats, r = N.p.bolt.r, q = w.foeScan(x, y, 220), list = [];
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (e.hp > 0 && e.charge > 0 && U.dist2(e.x, e.y, x, y) < 220 * 220) list.push(e); }
    w.foeEnd();
    list.sort((a, b) => b.charge - a.charge || a.id - b.id);
    for (let i = 0; i < list.length && i < (st.tollN | 0); i++) {
      const e = list[i];
      w.emit({ t: 'bolt', x: Math.round(e.x), y: Math.round(e.y) });
      w.skillBlast(p, e.x, e.y, r, dmg, w.partSrc(p, N, 'bolt'));
    }
  }

  // Ward Bell: a custom zone (kind 'bward', radius r, dur s) that weakens the foes inside by wardWeak (not bosses) while they stand in it.
  function wardZone(w, p, x, y, r, dur) {
    const pid = p.pid, wk = p.stats.wardWeak;
    w.addZone({ kind: 'bward', x, y, r, dur, team: 0, owner: pid, custom: true,
      update: (world, z) => {
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.boss || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          const v = wk;
          if (!(e.weakT > 0) || v > e.weakV) e.weakV = v;
          e.weakT = Math.max(e.weakT, 0.3);
        }
      } });
  }

  // Queued effects: Reverberation echoes and Umbral Arms twin strikes.
  function runQueue(w, p) {
    const q = p.bellQ;
    for (let i = 0; i < q.length;) {
      const o = q[i];
      if (o.at > w.time) { i++; continue; }
      q.splice(i, 1);
      if (o.k === 'echo') { if (o.room === w.room) { const N = ED.Stats.skillNums('peal', p.stats); pealWave(w, p, N, 'echo', o.x, o.y, N.p.echo.r, o.dmg, new Set()); w.emit({ t: 'peal', pid: p.pid, x: Math.round(o.x), y: Math.round(o.y), r: Math.round(N.p.echo.r), v: 0, e: 1 }); } }
      else if (o.k === 'twin' && o.e.hp > 0) w.hitEnemy(o.e, o.dmg, { p, kind: 'evo', crit: undefined, infAdd: { shadow: p.stats.shadowInfuse }, x: o.e.x, y: o.e.y, knock: 40 });
    }
  }

  // ---------------- Bellwarden hook table ----------------
  ED.CLS.bell = {
    // bells: p.bells (see the file header), p.bellL (chain length now), p.haul (0..1 haul amount), p.bellSpin (turning sense of the Haul), p.bellHauled (hauled last tick), p.haulUntil (end of the 'atk' hold window), p.haulIn (input flag; undefined until the input layer sets it),
    // p.heave (a Heave in progress), p.bellTok (strike budget), p.bellQ (queued effects), p.hookT / p.pealT (shield cooldowns), p.bellRoom (the room the bells are in), p.bellHv (full-swing speed), p.bellPx / p.bellPy (the hero's place the bells were last carried to), p.bellWhirl (hauling a bell at strike speed: hurtMul).
    init(p) { p.bells = []; p.bellL = 0; p.haul = 0; p.bellSpin = 1; p.haulUntil = -99; p.heave = null; p.bellTok = 0; p.bellQ = []; p.hookT = 0; p.pealT = 0; p.bellRoom = null; p.bellHv = C.BELL_CAP; p.bellHauled = false; p.bellWhirl = false; },

    // The bells' motion and strikes: the chain length follows the Haul (or the Heave), the strike budget refills, the foes near the hero are gathered once, then BELL_SUB substeps move every bell.
    tick(p, dt) {
      const st = p.stats, wp = st.weapon;
      if (wp.kind !== 'bell') { if (p.bells.length) p.bells.length = 0; p.bellWhirl = false; return; }
      if (p.hookT > 0) p.hookT -= dt;
      if (p.pealT > 0) p.pealT -= dt;
      if (p.bellRoom !== this.room || p.bells.length !== (wp.n || 1)) resetBells(this, p, wp);
      if (p.bellQ.length) runQueue(this, p);
      const L = wp.chain, O = orbitOf(wp), haul = hauling(this, p), target = haul ? O : L, L0 = p.bellL;
      if (haul && !p.bellHauled) p.bellSpin = spinOf(p);
      p.bellHauled = haul;
      let Lc, Ldot;
      if (p.heave) { const r = heaveTick(this, p, p.heave, dt, target); Lc = r.L; Ldot = r.Ldot; }
      else {
        const rate = (L - O) * wp.haul / C.HAUL_T;
        Lc = L0 < target ? Math.min(target, L0 + rate * dt) : Math.max(target, L0 - rate * dt);
        Ldot = (Lc - L0) / dt;
      }
      p.bellL = Lc;
      p.haul = p.heave ? 0 : U.clamp((L - Lc) / (L - O), 0, 1);
      p.bellTok = Math.min(C.BELL_HITS * 0.1, p.bellTok + C.BELL_HITS * dt);
      const A = driveOf(p, st), drive = !p.heave && haul ? A : 0, drag = !(p.heave && p.heave.phase !== 'reel');
      p.bellHv = C.HEAVY_K * topSpeed(A, O); // full swing: the least speed of a Heavy Strike
      // the foes the bells can reach this tick (a pooled scan copied out: strikes may kill, spawn and scan again)
      const reach = Lc + C.BELL_CAP / 60 + bellR(st) + 40, q = this.foeScan(p.x, p.y, reach), foes = p.bellFoes || (p.bellFoes = []);
      foes.length = 0;
      for (let k = 0; k < q.length; k++) if (q[k].hp > 0) foes.push(q[k]);
      this.foeEnd();
      const h = dt / C.BELL_SUB;
      const trail = !p.heave && !haul;
      carry(this, p);
      for (const b of p.bells) { b.px = b.x; b.py = b.y; }
      let whirl = false;
      for (let s = 0; s < C.BELL_SUB; s++) for (const b of p.bells) stepBell(this, p, b, h, Lc, Ldot, drive, foes, drag, trail);
      for (const b of p.bells) {
        if (b.hit.size > 48) for (const [id, t] of b.hit) if (this.time - t > 1) b.hit.delete(id);
        if (relV(p, b) < C.BELL_MIN) continue;
        if (haul || (p.heave && p.heave.phase === 'spin')) whirl = true; // hauled, or swung round the hero by a Wrecking Spin
        this.smashCircle(p, b.x, b.y, bellR(st));
        swatPath(this, b, bellR(st));
      }
      p.bellWhirl = whirl;
      foes.length = 0;
    },

    // The whirling bell turns blows aside: WHIRL_DR less damage taken while hauling a bell at strike speed (p.bellWhirl, set each tick).
    hurtMul(p) { return p.bellWhirl ? 1 - C.WHIRL_DR : 1; },

    // The weapon attack of a bell (combat.js playerAttack): an 'atk' action holds the Haul for HAUL_HOLD attack intervals; a Swift bell gives Flow while hauled.
    weaponAttack(p, a) {
      p.face = a; p.stealthT = 0;
      p.haulUntil = this.time + C.HAUL_HOLD * ED.Stats.attackInterval(p);
      if (p.stats.swift) p.flowT = C.FLOW_T;
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
