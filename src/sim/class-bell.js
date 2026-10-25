// Bellwarden: the chained bell (weapon kind 'bell': wind, hurl, reel), Anchor Leap and Peal, Resonance, the Bellwarden route cards that act on them and the hook table ED.CLS.bell.
// Each bell { x, y, vx, vy, s, hit, ... } in p.bells has a state s: HAND (a point mass on a chain anchored at the hero, moving in the hero's frame: carried by the hero's step, (vx, vy) its velocity about the hero),
// FLY (a hurl in flight), ANCHOR (lying still) or REEL (dragged home along the ground); FLY, ANCHOR and REEL bells live in the world frame (never carried).
// Wind (attack held): HAND bells are driven round their orbit (ORBIT_K of the chain); the bell's wind is its speed over WIND_FULL of the weapon's own top speed (at most 1). A winding strike deals at most WIND_CAP of the weapon,
// costs the bell `loss` of its speed and never counts as an attack. Release at WIND_GO wind or more hurls the most-wound bell toward the aim; less lets every bell drop and trail.
// A hurl flies at HURL_SPEED to the cursor (at most HURL_D x wind px), strikes every foe on its path and in its impact once at HURL_K x wind^2, counts as an attack and lies anchored where it lands.
// A press while a bell lies anchored reels it home at REEL_SPEED (never slowed by hits): each foe on the line is struck once at REEL_K of the hurl and dragged up to REEL_DRAG px toward the hero (not bosses).
// Resonance (p.bellRes, stacks up to RES_MAX): +1 per non-horde foe a hurl or reel strikes and +1 per hurl that strikes one; Peal spends it. The motion reads no RNG: it is a pure function of the inputs and the room.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, Sim = ED.Sim, C = ED.CONST;
  const W = ED.World.prototype;

  // BELL_MIN / BELL_REF / BELL_CAP: px/s a winding strike needs, the speed of a x1 strike, the speed limit. BELL_DRAG: share of speed lost per second at haul 1 (exponential; x the weapon's haul, so a heavy bell spins up and runs down slower). BELL_SUB: substeps per tick.
  // ORBIT_K: the wound chain's share of its length. HAUL_T: seconds the chain takes to shorten or let out fully at haul 1. HAUL_ACC: px/s2 of orbit drive at haul 1 and the weapon's own rate (x the attack-rate gain^RATE_POW). HAUL_HOLD: attack intervals one 'atk' action holds the wind when no input flag is set.
  // BELL_HITS: winding strikes per second one hero may make. CHAIN_R: half-width (px) of a wound chain: a foe it sweeps across closer in is struck as by the bell (once a revolution). BELL_WALL: speed a trailing bell keeps off a wall (weapon.wall overrides). BOSS_LOSS: factor on a strike's speed cost against a boss.
  // WIND_CAP: the most a winding strike deals (x the weapon). WIND_FULL: wind 1 as a share of the weapon's own top speed. WIND_GO: the least wind that hurls. WIND_MOVE: the hero's speed factor while winding. JUGGLE_T: seconds the other wound bells keep winding after a juggled hurl.
  // HURL_D / HURL_MIN / HURL_SPEED / HURL_K: farthest hurl at full wind, nearest, flight px/s, the strike factor at full wind (x wind^2). IMPACT_R: impact radius. PATH_KNOCK: knockback of a strike on the hurl's path over the impact's (the bell passes through; the impact throws foes out, a reel strike drags instead). BOUNCES: wall ricochets of a hurl that keeps its speed off walls (weapon.wall >= 1).
  // REEL_SPEED / REEL_K / REEL_DRAG / REEL_KEEP: reel px/s, a reel strike over its hurl's, px a reel drags a foe, wind a reeled bell comes home with. LEASH: px an anchored bell lies from the hero before the chain drags it.
  // RES_MAX / RES_K / RES_R: Resonance stacks, Peal damage per stack, Peal radius at full Resonance. RES_HOLD / RES_DECAY: seconds Resonance holds after its last gain, then seconds per stack lost.
  // LEAP_D / LEAP_T: a leap from the hand (px toward the cursor, flight s); YANK_SPEED / YANK_T0 / YANK_T1: px/s and the flight time limits of a yank to the anchored bell; LEAP_IFR: untouchable seconds past the landing.
  // HOOK_CD / PEAL_SH_CD: seconds between Tether Hook shields / Warding Toll shields. SWAT_K: Warding Toll swat radius over the Peal's. SPIN_EVERY: seconds between two Wrecking Spin strikes on one foe. BOLT_EVERY: seconds between Skybreaker bolts. WIRE_W: Toll of the Storm's live-wire half-width px.
  Object.assign(C, { BELL_MIN: 140, BELL_REF: 320, BELL_CAP: 900, BELL_DRAG: 2.5, BELL_SUB: 4, ORBIT_K: 0.85, HAUL_T: 0.25, HAUL_ACC: 1700, RATE_POW: 0.6, HAUL_HOLD: 1.6,
    BELL_HITS: 60, CHAIN_R: 3, BELL_WALL: 0.5, BOSS_LOSS: 1, ARC_LONE: 1,
    WIND_CAP: 0.6, WIND_FULL: 0.9, WIND_GO: 0.5, WIND_MOVE: 0.7, JUGGLE_T: 0.5,
    HURL_D: 200, HURL_MIN: 40, HURL_SPEED: 800, HURL_K: 2.5, IMPACT_R: 40, PATH_KNOCK: 0.25, BOUNCES: 3,
    REEL_SPEED: 700, REEL_K: 0.5, REEL_DRAG: 60, REEL_KEEP: 0.4, LEASH: 280,
    RES_MAX: 10, RES_K: 0.15, RES_R: 0.25, RES_HOLD: 6, RES_DECAY: 0.5,
    LEAP_D: 110, LEAP_T: 0.28, YANK_SPEED: 900, YANK_T0: 0.15, YANK_T1: 0.35, LEAP_IFR: 0.1,
    HOOK_CD: 8, PEAL_SH_CD: 10, SWAT_K: 1.5, SPIN_EVERY: 0.4, BOLT_EVERY: 1, WIRE_W: 20 });
  const HAND = 0, FLY = 1, ANCHOR = 2, REEL = 3; // bell states (wire format: net.js N.bellRow)

  const blocked = (w, x, y) => D.blocksShots(D.tileAt(w.room, x, y), w.locked);
  const orbitOf = (wp) => C.ORBIT_K * wp.chain; // the wound chain length (px)
  const bellR = (st) => st.weapon.br * (1 + 0.5 * st.area);
  const speedMul = (sp) => U.clamp(sp / C.BELL_REF, 0.4, 1.8);
  // Attack-rate gain of the hero now (>= 1 with attack speed, Battle Trance, War Drum): it shortens the per-foe lockout and drives the wind harder (x its RATE_POW power).
  const rateGain = (p) => p.stats.weapon.rate / ED.Stats.attackInterval(p);
  // Orbit drive of a wound bell (px/s2): HAUL_ACC x haul x rate gain^RATE_POW x (1 + haulAcc: Pendulum).
  const driveOf = (p, st) => C.HAUL_ACC * st.weapon.haul * Math.pow(rateGain(p), C.RATE_POW) * (1 + st.haulAcc);
  const dragOf = (wp) => C.BELL_DRAG * wp.haul;
  // Top speed of a wound bell with drive A and drag D on an orbit of radius R: the drive against D plus the chain's substep drag (NUM_K x v^2 / R^2, the radial part each substep projection removes), at most BELL_CAP.
  const NUM_K = 1 / (2 * 60 * C.BELL_SUB);
  const topSpeed = (A, R, D) => { const k2 = NUM_K / (R * R); let v = A / D; for (let i = 0; i < 40; i++) v = A / (D + k2 * v * v); return Math.min(C.BELL_CAP, v); };
  // Speed of wind 1: WIND_FULL of the weapon's own top speed (its own drive, no attack speed or Pendulum: those wind it faster), cached on the stat block.
  const windRef = (st) => st.bellRef || (st.bellRef = C.WIND_FULL * topSpeed(C.HAUL_ACC * st.weapon.haul, orbitOf(st.weapon), dragOf(st.weapon)));
  const relV = (b) => Math.hypot(b.vx, b.vy);
  const windOf = (st, b) => Math.min(1, relV(b) / windRef(st));
  const hurlK = (wind) => C.HURL_K * wind * wind; // strike factor of a hurl at this wind
  const reelSpeed = (st) => C.REEL_SPEED * (st.swift ? 1.3 : 1);
  // The strike-speed infusion of Storm Bronze (the part of wInfLightning above Static Charge's own rate), cached on the stat block.
  const bellInf = (st) => { if (st.bwInf === undefined) { const r = Math.max(0, st.wInfLightning - st.lightningInfuse); st.bwInf = r > 0 ? { lightning: r } : null; } return st.bwInf || undefined; };
  const winding = (st) => (st.windCap > 0 ? st.windCap : C.WIND_CAP); // Perpetual Motion raises the cap

  // ---------------- the analytic model (the sheet and the bots) ----------------
  // ED.Bell.cycle(st, n, lockout, gain): one wind -> hurl -> reel loop of a standing hero with n foes spaced on its orbit, the bell home at the first (it reels in along the hurl line): the bell winds from REEL_KEEP wind (stepped at MODEL_DT; it strikes each foe as it
  // reaches it, at most once per lockout, at the winding factor, losing `loss` of its speed) until wind 1, or WIND_GO wind or more that has not grown for PLATEAU s (a crowd drains it), at most MODEL_TW s; then it flies to the foe (the cursor on it: the orbit; a pack: MODEL_D px, at most its reach), waits MODEL_WAIT s anchored and is reeled home to the orbit.
  // Each bell runs its own loop (juggled bells take turns), so a weapon of nb bells makes nb loops per T.
  // Returns { T (s per loop of one bell), tw (s winding), windN (winding strikes of that bell per loop on each foe), nb, windMul (their mean factor), k (mean hurl strike factor, Full Swing included), kReel, full (1 at full wind), wind, top, d (hurl px) }; cached on the stat block.
  const MODEL_DT = 1 / 120, MODEL_TW = 2.5, MODEL_D = 150, MODEL_WAIT = 0, PLATEAU = 0.3, MODEL_FOE_R = 12; // MODEL_FOE_R: the foe radius (a strike lands as the bell's edge touches it, that much angle early)
  ED.Bell = {
    cycle(st, n, lockout, gain) {
      const w = st.weapon, nf = Math.max(1, n | 0), g = gain || 1, lock = lockout || w.rate, key = nf + ':' + lock.toFixed(4) + ':' + g.toFixed(4), memo = st.bellM || (st.bellM = {});
      if (memo[key]) return memo[key];
      const R = orbitOf(w), A = C.HAUL_ACC * w.haul * Math.pow(g, C.RATE_POW) * (1 + st.haulAcc), ref = windRef(st), cap = winding(st);
      const keep = st.perpetual > 0 ? 1 : 1 - w.loss, k2 = NUM_K / (R * R), D = dragOf(w), ca = Math.min(U.TAU / nf / 2, (bellR(st) + MODEL_FOE_R) / R);
      const last = new Array(nf).fill(-9), gap = U.TAU / nf;
      let v = C.REEL_KEEP * ref, th = 0, next = 0, m = 0, t = 0, hits = 0, sum = 0, best = v, tb = 0;
      for (; t < MODEL_TW && v < ref; t += MODEL_DT) {
        v = Math.min(C.BELL_CAP, v + (A - (D + k2 * v * v) * v) * MODEL_DT);
        th += v * MODEL_DT / R;
        while (th >= next - (m ? ca : 0)) {
          const j = m++ % nf;
          next += gap;
          if (v < C.BELL_MIN || t - last[j] < lock) continue;
          last[j] = t; hits++; sum += Math.min(cap, speedMul(v)); v *= keep;
        }
        if (v > best * 1.01) { best = v; tb = t; } else if (v >= C.WIND_GO * ref && t - tb > PLATEAU) break;
      }
      const wind = Math.min(1, v / ref), full = wind >= 1 ? 1 : 0, d = Math.min(nf > 1 ? MODEL_D : Math.max(C.HURL_MIN, R), C.HURL_D * wind), k = hurlK(wind) * (full ? 1 + st.fullSwing : 1), nb = w.n || 1;
      const T = t + d / C.HURL_SPEED + MODEL_WAIT + Math.max(0, d - R) / reelSpeed(st);
      return (memo[key] = { T, tw: t, windN: hits / nf, nb, windMul: hits ? sum / hits : 0, k, kReel: C.REEL_K * hurlK(wind) * (full ? 1 + st.fullSwing : 1), full, wind, top: topSpeed(A, R, D), d });
    },
    speedMul, rateGain, orbit: orbitOf, windRef, hurlK, PLATEAU, MODEL_D,
    // The release rule of the model (the sheet's staged loops and the bots): true once the most-wound hand bell is at full wind, or at WIND_GO or more without growing for PLATEAU s; the tracking (p.bellPlV / p.bellPlT) restarts then.
    ready(w, p) {
      let v = 0;
      for (const b of p.bells) if (b.s === HAND) v = Math.max(v, windOf(p.stats, b));
      if (!(v > 0)) { p.bellPlV = 0; p.bellPlT = w.time; return false; }
      if (!(v <= (p.bellPlV || 0) * 1.01)) { p.bellPlV = v; p.bellPlT = w.time; }
      const go = v >= 1 || (v >= C.WIND_GO && w.time - p.bellPlT > PLATEAU);
      if (go) { p.bellPlV = 0; p.bellPlT = w.time; }
      return go;
    },
    // Mean Resonance at a Peal cast on cooldown from loops on one foe (hurl +2: the strike and the hurl's own stack; reel +1), at most RES_MAX; the Peal's damage factor is 1 + RES_K x it.
    pealRes(st, p) {
      const cy = ED.Bell.cycle(st, 1, p ? ED.Stats.attackInterval(p) : st.atkInterval, p ? rateGain(p) : 1), cd = ED.Stats.skillNums('peal', st).cdEff;
      return Math.min(C.RES_MAX, 3 * cd / cy.T);
    },
    // Seconds of an Anchor Leap the bell does not wind (the flight; the bell lies or rides with the hero meanwhile).
    busy(st) { return { heave: (C.LEAP_T + C.YANK_T1) / 2, peal: 0 }; },
  };

  // ---------------- bells ----------------
  const newBell = (x, y) => ({ x, y, vx: 0, vy: 0, s: HAND, hit: new Map(), wallT: 0, k: 0, fly: null, reel: null, reelQ: false, tickT: 0 });
  // Lays out the hero's bells at rest around it (a new room, a new weapon, the first tick): evenly spaced, half a chain out, still, in hand.
  function resetBells(w, p, wp) {
    const n = wp.n || 1;
    p.bells.length = 0;
    p.bellL = wp.chain; p.haul = 0; p.bellLeap = null; p.bellRoom = w.room; p.bellPx = p.x; p.bellPy = p.y; p.juggleT = -99; p.spinT = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + i * U.TAU / n, d = wp.chain * 0.5;
      let x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (blocked(w, x, y)) { x = p.x; y = p.y; }
      p.bells.push(newBell(x, y));
    }
  }
  // Every bell out of the hand comes home at once (room change, the hero downed, a boss phase change): on its orbit on the side it lay, still; a flight, reel or leap in progress ends.
  function snapHome(w, p) {
    const O = orbitOf(p.stats.weapon);
    for (const b of p.bells) {
      if (b.s !== HAND) { const a = Math.atan2(b.y - p.y, b.x - p.x); b.x = p.x + Math.cos(a) * O; b.y = p.y + Math.sin(a) * O; if (blocked(w, b.x, b.y)) { b.x = p.x; b.y = p.y; } }
      b.s = HAND; b.vx = 0; b.vy = 0; b.fly = null; b.reel = null; b.reelQ = false;
    }
    p.bellLeap = null; p.bellPx = p.x; p.bellPy = p.y;
  }

  // Turning sense of a wind, fixed when it starts: the way the first hand bell already swings about the hero (when it swings faster than BELL_MIN / 2 px/s), else the last one.
  function spinOf(p) {
    const b = p.bells.find(x => x.s === HAND);
    if (!b) return p.bellSpin;
    const rx = b.x - p.x, ry = b.y - p.y, d = Math.hypot(rx, ry);
    if (d < 2) return p.bellSpin;
    const vt = (rx * b.vy - ry * b.vx) / d; // tangential speed about the hero
    return Math.abs(vt) > C.BELL_MIN / 2 ? (vt > 0 ? 1 : -1) : p.bellSpin;
  }

  // Carries the hand bells by the hero's step since the last tick (a jump of 24 px or more, a room change or a teleport, is not carried); a wall in the way holds a free bell back.
  function carry(w, p, wound) {
    const dx = p.x - p.bellPx, dy = p.y - p.bellPy;
    p.bellPx = p.x; p.bellPy = p.y;
    if (!(dx || dy) || dx * dx + dy * dy >= 576) return;
    for (const b of p.bells) {
      if (b.s !== HAND) continue;
      if (wound || !blocked(w, b.x + dx, b.y + dy)) { b.x += dx; b.y += dy; }
      else if (!blocked(w, b.x + dx, b.y)) b.x += dx;
      else if (!blocked(w, b.x, b.y + dy)) b.y += dy;
    }
  }

  // True while the hero holds attack: the input flag p.haulIn when the input layer sets it, else the hold window of the last 'atk' action; never during a leap.
  const hauling = (w, p) => !p.bellLeap && (p.haulIn !== undefined ? !!p.haulIn : w.time < p.haulUntil);
  const live = (e) => e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed && !(e.invulnT > 0);
  const addRes = (w, p, n) => { if (n > 0) { p.bellRes = Math.min(C.RES_MAX, p.bellRes + n); p.bellResAt = w.time; } };

  // One substep h of hand bell b: the orbit drive (wound), drag (trail: also the hero's motion), the move with wall bounces, the chain (length Lc, changing at Ldot px/s), then the foes it overlaps.
  function stepHand(w, p, b, h, Lc, Ldot, drive, foes, trail) {
    const st = p.stats, wp = st.weapon, hx = p.x, hy = p.y, a0 = Math.atan2(b.y - hy, b.x - hx);
    let rx = b.x - hx, ry = b.y - hy, d = Math.hypot(rx, ry);
    if (drive > 0) {
      if (d < 2) { rx = Math.cos(p.face || 0) * 2; ry = Math.sin(p.face || 0) * 2; d = 2; }
      const s = p.bellSpin || 1;
      b.vx += -ry / d * s * drive * h; b.vy += rx / d * s * drive * h;
    }
    const f = Math.exp(-dragOf(wp) * h); b.vx *= f; b.vy *= f;
    if (trail) { b.vx -= (p.lvx || 0) * (1 - f); b.vy -= (p.lvy || 0) * (1 - f); }
    let sp = relV(b);
    if (sp > C.BELL_CAP) { b.vx *= C.BELL_CAP / sp; b.vy *= C.BELL_CAP / sp; sp = C.BELL_CAP; }
    // move: a wound bell whirls over walls; a free one (out of a wall) bounces off them axis by axis
    const keep = wp.wall !== undefined ? wp.wall : C.BELL_WALL, solid = !(drive > 0) && !blocked(w, b.x, b.y);
    let nx = b.x + b.vx * h, ny = b.y + b.vy * h;
    if (solid && blocked(w, nx, b.y)) { b.vx = -b.vx * keep; nx = b.x; }
    if (solid && blocked(w, nx, ny)) { b.vy = -b.vy * keep; ny = b.y; }
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
    // winding strikes (a Wrecking Spin: its spin strikes)
    const br = bellR(st), spin = p.spinT > 0;
    for (let i = 0; i < foes.length; i++) {
      const e = foes[i];
      if (!live(e)) continue;
      const rr = br + e.r;
      let lash = false;
      if (U.dist2(e.x, e.y, b.x, b.y) >= rr * rr) { // not on the bell: the wound chain sweeping across a foe closer in strikes it as the bell (a foe at the hero's feet is not out of reach)
        if (!(drive > 0)) continue;
        const df = Math.hypot(e.x - hx, e.y - hy);
        if (df >= Math.hypot(b.x - hx, b.y - hy)) continue;
        const sw = U.angDiff(a0, Math.atan2(b.y - hy, b.x - hx)), da = U.angDiff(a0, Math.atan2(e.y - hy, e.x - hx)), wa = df > e.r + C.CHAIN_R ? Math.asin((e.r + C.CHAIN_R) / df) : 0; // the chain's sweep this substep against the foe's bearing
        if (da < Math.min(0, sw) - wa || da > Math.max(0, sw) + wa) continue;
        lash = true;
      }
      sp = relV(b);
      if (sp < C.BELL_MIN || p.bellTok < 1) continue;
      const last = b.hit.get(e.id), lock = spin ? C.SPIN_EVERY : ED.Stats.attackInterval(p);
      if (last !== undefined && w.time - last < lock - 1e-9) continue;
      b.hit.set(e.id, w.time);
      if (spin) spinStrike(w, p, b, e, sp); else windStrike(w, p, b, e, sp, lash);
    }
  }

  // ---------------- strikes ----------------
  // A winding strike of bell b at speed sp on foe e: the weapon at min(WIND_CAP, speed factor), the speed it costs (none with Perpetual Motion). It is no attack: no attack count, crit stack, ring, evolution or proc counter. lash: struck by the chain.
  function windStrike(w, p, b, e, sp, lash) {
    const st = p.stats, wp = st.weapon, f = Math.min(winding(st), speedMul(sp)), ux = b.vx / sp, uy = b.vy / sp;
    p.bellTok -= 1;
    w.hitEnemy(e, wp.dmg, { p, kind: 'weapon', wpn: false, mul: f, infAdd: bellInf(st), knock: wp.knock * Math.min(1.5, speedMul(sp)), kx: ux, ky: uy, x: b.x, y: b.y, part: 'bell.wind' });
    if (!(st.perpetual > 0)) { const keep = 1 - wp.loss * (e.boss ? C.BOSS_LOSS : 1); b.vx *= keep; b.vy *= keep; }
    w.emit({ t: 'bstrike', pid: p.pid, x: Math.round(lash ? e.x : b.x), y: Math.round(lash ? e.y : b.y), v: Math.round(sp), h: 0, c: lash ? 1 : 0 }); // c: struck by the chain
  }
  // Wrecking Spin: a spin strike (part heave.spin) of the whirling bell.
  function spinStrike(w, p, b, e, sp) {
    const N = ED.Stats.skillNums('heave', p.stats), d = Math.hypot(b.vx, b.vy) || 1;
    p.bellTok -= 1;
    w.hitEnemy(e, N.p.spin.dmg, w.partSrc(p, N, 'spin', { kx: b.vx / d, ky: b.vy / d, x: b.x, y: b.y }));
    w.emit({ t: 'bstrike', pid: p.pid, x: Math.round(b.x), y: Math.round(b.y), v: Math.round(sp), h: 0, c: 0 });
  }
  // A hurl or reel strike on foe e (fl: the hurl's record, or the reel's: { k, crit, ms, twin, full, part }): the weapon hit at k (the Finisher x FIN_MUL and its Bleed floor, Lightning Rod on a charged foe), Twin Fang's second hit,
  // the ring of a ring weapon, the evolution (W.evoHit), Resonance from a non-horde foe, the route riders. kn: share of the knockback (a path strike PATH_KNOCK, the impact 1, a reel strike 0). Returns the hit's source.
  function heavyStrike(w, p, b, e, fl, kx, ky, kn) {
    const st = p.stats, wp = st.weapon, hurl = fl.part === 'bell.hurl', charged = e.charge > 0;
    const mul = fl.k * (hurl && st.rod > 0 && charged ? 1 + st.rod : 1), infAdd = bellInf(st), knock = wp.knock * Math.min(1.5, fl.k) * kn;
    const src = { p, kind: 'weapon', wpn: !!fl.full, mul: fl.ms ? mul * C.FIN_MUL : mul, crit: fl.crit || fl.ms || undefined, bleedMin: fl.ms ? 0.5 : undefined, infAdd, knock, kx, ky, x: b.x, y: b.y, part: fl.part }; // ms: the Finisher; wpn: a full-wind hurl (a Heavy bell's Stagger)
    w.hitEnemy(e, wp.dmg, src);
    if (fl.twin && e.hp > 0) w.hitEnemy(e, wp.dmg, { p, kind: 'weapon', mul, crit: fl.crit || undefined, infAdd, knock, kx, ky, x: b.x, y: b.y, part: fl.part });
    w.emit({ t: 'bstrike', pid: p.pid, x: Math.round(b.x), y: Math.round(b.y), v: Math.round(fl.k * C.BELL_REF), h: 0, c: 0 }); // the hurl's own weight (hit-stop, shake) rides the 'hurl' event
    if (w.evoHit) w.evoHit(p, e, Math.atan2(ky, kx), src);
    if (wp.ring) ringOf(w, p, b, e, wp.dmg * mul * wp.ring.mul, wp.ring.r * (1 + 0.5 * st.area));
    if (!e.fodder) { addRes(w, p, 1); fl.res = true; }
    if (hurl && st.rod > 0 && charged && e.hp > 0 && e.charge > 0) { w.discharge(e, p, 1); if (st.rodStun > 0 && e.hp > 0 && !(e.bwRodT > w.time)) { e.bwRodT = w.time + 1; w.stunFoe(e, st.rodStun, false); } } // Lightning Rod (Grounded: once a second per foe)
    if (!hurl && st.chainArc > 0) chainArc(w, p, e, wp.dmg * mul * st.chainArc, infAdd);
    if (hurl && st.hurlCarry > 0 && e.hp > 0 && !e.boss && fl.carry) fl.carry.push({ e, left: st.hurlCarry }); // Unstoppable
    return src;
  }

  // A ring weapon (Storm Bell): every other foe within r of the bell takes dmg (a weapon shock: no crit, no procs).
  function ringOf(w, p, b, e0, dmg, r) {
    const q = w.foeScan(b.x, b.y, r), list = [];
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (e !== e0 && live(e) && U.dist2(e.x, e.y, b.x, b.y) < (r + e.r) ** 2) list.push(e); }
    w.foeEnd();
    for (const e of list) { const d = Math.hypot(e.x - b.x, e.y - b.y) || 1; w.hitEnemy(e, dmg, { p, kind: 'explode', wpn: true, noProc: true, crit: false, noGuard: true, knock: 60, kx: (e.x - b.x) / d, ky: (e.y - b.y) / d, x: b.x, y: b.y, part: 'bell.ring' }); }
    w.emit({ t: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: Math.round(r), k: 'shock' });
  }

  // Chain Toll: a reel strike arcs to the nearest other foe within 90 of e (Forked Toll: arcN more, each from the last), a Lightning hit of dmg that charges like the strike.
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

  // ---------------- hurl ----------------
  // Hurls hand bell b from the hero's hand toward the aim (p.face; the cursor p.aimX / p.aimY sets the length, HURL_MIN .. HURL_D x wind): the record b.fly { tx, ty, x0, y0 (leg start), left (px to fly), k, full, crit, ms, twin, bolt, hit (struck this leg), carry, legs }.
  // The hurl is an attack: the attack count (Twin Fang), the crit stack it spends, Swift's Flow; a full-wind hurl carries the hold verb (the Finisher: fl.ms, x FIN_MUL; the others land with it: W.bellHold).
  function hurl(w, p, b) {
    const st = p.stats, wind = windOf(st, b), full = wind >= 1, a = p.face || 0, fin = Number.isFinite(p.aimX) && Number.isFinite(p.aimY);
    const want = fin ? Math.hypot(p.aimX - p.x, p.aimY - p.y) : C.HURL_D, dist = U.clamp(want, C.HURL_MIN, Math.max(C.HURL_MIN, C.HURL_D * wind));
    const tx = p.x + Math.cos(a) * dist, ty = p.y + Math.sin(a) * dist, left = dist;
    b.x = p.x; b.y = p.y;
    let crit = false, ms = false;
    if (!w.pred) { // a client's prediction (game.js BELL_W) spends nothing the host decides
      p.atkCount++; p.lastAtkT = w.time; p.stealthT = 0;
      if (p.critStacks > 0) { p.critStacks--; crit = true; }
      if (full && st.hold === 'finisher') ms = true; // the Finisher rides a full-wind hurl
    }
    b.s = FLY; b.vx = (tx - b.x) / left * C.HURL_SPEED; b.vy = (ty - b.y) / left * C.HURL_SPEED;
    b.fly = { tx, ty, x0: b.x, y0: b.y, left, k: hurlK(wind) * (full ? 1 + st.fullSwing : 1), full, crit, ms, twin: !!st.twinEvery && p.atkCount % st.twinEvery === 0,
      hit: new Set(), carry: [], legs: 0, res: false, part: 'bell.hurl' };
  }

  // One substep h of a flying bell: it moves toward its target, striking every foe its swept path touches (once a leg), carrying Unstoppable's foes; a wall ends the flight there, or (weapon.wall >= 1) turns it with the distance left, BOUNCES times.
  function stepFly(w, p, b, h, foes) {
    const st = p.stats, fl = b.fly, br = bellR(st), sp = relV(b) || 1, step = Math.min(fl.left, C.HURL_SPEED * h), ux = b.vx / sp, uy = b.vy / sp;
    let nx = b.x + ux * step, ny = b.y + uy * step;
    if (blocked(w, nx, ny)) {
      if (st.weapon.wall >= 1 && fl.legs < C.BOUNCES) { // ricochet: mirror the blocked axis, fly the distance left from here
        if (blocked(w, nx, b.y)) b.vx = -b.vx;
        if (blocked(w, b.x, ny) || !blocked(w, nx, b.y)) b.vy = -b.vy;
        fl.legs++; fl.x0 = b.x; fl.y0 = b.y; fl.hit = new Set();
        return;
      }
      land(w, p, b); return;
    }
    for (let i = 0; i < foes.length; i++) {
      const e = foes[i];
      if (!live(e) || fl.hit.has(e.id) || U.segDist2(e.x, e.y, b.x, b.y, nx, ny) >= (br + e.r) ** 2) continue;
      fl.hit.add(e.id);
      heavyStrike(w, p, b, e, fl, ux, uy, C.PATH_KNOCK);
    }
    for (const g of fl.carry) { if (g.e.hp <= 0 || g.left <= 0) continue; const m = Math.min(g.left, step); g.left -= m; Sim.moveCircle(g.e, ux * m, uy * m, w.room, w.locked, g.e.fly); g.e.kbx = 0; g.e.kby = 0; }
    b.x = nx; b.y = ny; fl.left -= step;
    if (fl.left <= 1e-6) land(w, p, b);
  }

  // A hurl lands where the bell is: every foe within the impact radius not yet struck this leg takes the hurl strike; the Wrecking Ball shock, Thunder Gauntlet's bolt and Skybreaker's first bolt; the event; then it lies anchored
  // (a press made in flight reels it at once).
  function land(w, p, b) {
    const st = p.stats, fl = b.fly, area = 1 + 0.5 * st.area, x = b.x, y = b.y;
    const r = C.IMPACT_R * area * (fl.full && st.heavy ? 1.2 : 1) * (fl.full ? 1 + st.fullR : 1), q = w.foeScan(x, y, r), list = [];
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (live(e) && !fl.hit.has(e.id) && U.dist2(e.x, e.y, x, y) < (r + e.r) ** 2) list.push(e); }
    w.foeEnd();
    const sp = relV(b) || 1;
    for (const e of list) { fl.hit.add(e.id); const d = Math.hypot(e.x - x, e.y - y) || 1; heavyStrike(w, p, b, e, fl, d > 1 ? (e.x - x) / d : b.vx / sp, d > 1 ? (e.y - y) / d : b.vy / sp, 1); }
    if (fl.res) addRes(w, p, 1); // the hurl's own stack: it struck a foe that is not a horde foe
    const sd = st.weapon.dmg * fl.k;
    if (st.wreck > 0) { // Wrecking Ball: the impact cracks the ground (Demolisher: a Full Swing quakes twice as wide, stronger, knocking foes away)
      const quake = fl.full && st.demolish > 0;
      w.explode(x, y, (quake ? 140 : 70) * area, sd * (st.wreck + (quake ? st.demolish : 0)), 0, p, 'shock', true, { wpn: false, stun: st.wreckStun, knock: quake ? 220 : 0, part: 'bell.wreck' });
    }
    if (st.stormBolt > 0) skyBolt(w, p, x, y);
    w.emit({ t: 'hurl', pid: p.pid, x: Math.round(x), y: Math.round(y), k: Math.round(fl.k * 100) / 100 });
    if (fl.full && st.hold) w.bellHold(p, x, y, r);
    b.s = ANCHOR; b.vx = 0; b.vy = 0; b.k = fl.k; b.fly = null; b.tickT = w.time + C.BOLT_EVERY;
    w.smashCircle(p, x, y, r);
    if (b.reelQ) { b.reelQ = false; startReel(w, p, b); }
  }

  // Skybreaker: a thunderbolt (radius 50) on the anchored bell for stormBolt of the weapon, charging what it strikes for half.
  function skyBolt(w, p, x, y) {
    const st = p.stats;
    w.emit({ t: 'bolt', x: Math.round(x), y: Math.round(y) });
    w.explode(x, y, 50 * (1 + 0.5 * st.area), st.weapon.dmg * st.stormBolt, 0, p, 'bolt', false, { clsEl: st.element || undefined, infAdd: { lightning: 0.5 }, part: 'bell.storm' });
  }

  // ---------------- reel ----------------
  // An anchored bell starts home: the record b.reel { k (strike factor), hit (struck), drag ([{ e, left }]) }, the event, the evolution along the line and Toll of the Storm's live wire
  // (every foe within WIRE_W of the chain takes tollStorm of the reel strike as Lightning, once a reel).
  function startReel(w, p, b) {
    const st = p.stats;
    b.s = REEL; b.reel = { k: C.REEL_K * (b.k || hurlK(C.WIND_GO)), hit: new Set(), drag: [], part: 'bell.reel' };
    w.emit({ t: 'reel', pid: p.pid, x0: Math.round(b.x), y0: Math.round(b.y), x1: Math.round(p.x), y1: Math.round(p.y) });
    if (st.tollStorm > 0) {
      const d = Math.hypot(b.x - p.x, b.y - p.y), q = w.foeScan((p.x + b.x) / 2, (p.y + b.y) / 2, d / 2 + C.WIRE_W), list = [];
      for (let k = 0; k < q.length; k++) { const e = q[k]; if (live(e) && U.segDist2(e.x, e.y, p.x, p.y, b.x, b.y) < (C.WIRE_W + e.r) ** 2) list.push(e); }
      w.foeEnd();
      for (const e of list) w.hitEnemy(e, st.weapon.dmg * b.reel.k * st.tollStorm, { p, kind: 'explode', el: 'lightning', crit: false, noGuard: true, infAdd: { lightning: 0.5 }, x: e.x, y: e.y, part: 'bell.wire' });
      if (list.length) w.emit({ t: 'chain', pts: [[Math.round(p.x), Math.round(p.y)], [Math.round(b.x), Math.round(b.y)]] });
    }
  }
  // One substep h of a reeled bell: straight toward the hero at the reel speed (over walls: the chain drags it), striking each foe on its swept path once and dragging non-boss foes with it up to REEL_DRAG px;
  // within the orbit it is back in hand, swinging at REEL_KEEP wind along the turning sense.
  function stepReel(w, p, b, h, foes, O) {
    const st = p.stats, rl = b.reel, dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy), v = reelSpeed(st);
    if (d <= O + 1e-6) { reelIn(w, p, b, foes); home(w, p, b, O); return; }
    const ux = dx / d, uy = dy / d, step = Math.min(d - O, v * h), nx = b.x + ux * step, ny = b.y + uy * step, br = bellR(st);
    b.vx = ux * v; b.vy = uy * v;
    for (const g of rl.drag) { if (g.e.hp <= 0 || g.left <= 0) continue; const m = Math.min(g.left, step); g.left -= m; Sim.moveCircle(g.e, ux * m, uy * m, w.room, w.locked, g.e.fly); g.e.kbx = 0; g.e.kby = 0; }
    for (let i = 0; i < foes.length; i++) {
      const e = foes[i];
      if (!live(e) || rl.hit.has(e.id) || U.segDist2(e.x, e.y, b.x, b.y, nx, ny) >= (br + e.r) ** 2) continue;
      rl.hit.add(e.id);
      heavyStrike(w, p, b, e, rl, ux, uy, 0);
      if (e.hp > 0 && !e.boss) rl.drag.push({ e, left: C.REEL_DRAG });
    }
    b.x = nx; b.y = ny;
    if (d - step <= O + 1e-6) { reelIn(w, p, b, foes); home(w, p, b, O); }
  }
  // The reel's last stretch into the hand: each foe between the bell and the hero not yet struck by this reel takes the reel strike.
  function reelIn(w, p, b, foes) {
    const rl = b.reel, br = bellR(p.stats), dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < foes.length; i++) {
      const e = foes[i];
      if (!live(e) || rl.hit.has(e.id) || U.segDist2(e.x, e.y, b.x, b.y, p.x, p.y) >= (br + e.r) ** 2) continue;
      rl.hit.add(e.id);
      heavyStrike(w, p, b, e, rl, dx / d, dy / d, 0);
    }
  }
  // The bell is back in hand on the orbit, swinging at REEL_KEEP wind.
  function home(w, p, b, O) {
    const a = Math.atan2(b.y - p.y, b.x - p.x), s = p.bellSpin || 1, v = C.REEL_KEEP * windRef(p.stats);
    b.x = p.x + Math.cos(a) * O; b.y = p.y + Math.sin(a) * O;
    if (blocked(w, b.x, b.y)) { b.x = p.x; b.y = p.y; }
    b.s = HAND; b.reel = null; b.vx = -Math.sin(a) * s * v; b.vy = Math.cos(a) * s * v;
  }

  // An anchored bell each tick: dragged by the chain when the hero walks past LEASH; Skybreaker's bolt every BOLT_EVERY s.
  function anchorTick(w, p, b) {
    const st = p.stats, dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
    if (d > C.LEASH) { const k = C.LEASH / d, nx = p.x + dx * k, ny = p.y + dy * k; if (!blocked(w, nx, ny)) { b.x = nx; b.y = ny; } else if (d > C.LEASH + 120) { b.x = nx; b.y = ny; } }
    if (st.stormBolt > 0 && w.time >= b.tickT) { b.tickT = w.time + C.BOLT_EVERY; skyBolt(w, p, b.x, b.y); }
  }

  // ---------------- Anchor Leap (skill id heave) ----------------
  // The bell out of the hand nearest the cursor (a flight lands where it is, a reel stops), else null.
  function anchorOf(w, p) {
    let best = null, bd = Infinity;
    const ax = Number.isFinite(p.aimX) ? p.aimX : p.x + Math.cos(p.face || 0) * 100, ay = Number.isFinite(p.aimY) ? p.aimY : p.y + Math.sin(p.face || 0) * 100;
    for (const b of p.bells) { if (b.s === HAND) continue; const d = U.dist2(b.x, b.y, ax, ay); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  // Where an Anchor Leap of hero p toward angle a lands: { x, y, t (flight s), bell (the bell yanked to, or null) }: the bell out of the hand nearest the cursor (its spot), else LEAP_D x (1 + leapR) toward the cursor (its distance, at least 40), cut at walls.
  ED.Bell.leapTarget = (w, p, a) => {
    const b = anchorOf(w, p);
    if (b) { const d = Math.hypot(b.x - p.x, b.y - p.y); return { x: b.x, y: b.y, t: U.clamp(d / C.YANK_SPEED, C.YANK_T0, C.YANK_T1), bell: b }; }
    const st = p.stats, fin = Number.isFinite(p.aimX) && Number.isFinite(p.aimY), max = C.LEAP_D * (1 + st.leapR), want = fin ? Math.hypot(p.aimX - p.x, p.aimY - p.y) : max;
    const end = Sim.castMove(w.room, p.x, p.y, a, U.clamp(want, 40, max), p.r, w.locked);
    return { x: end.x, y: end.y, t: C.LEAP_T, bell: null };
  };
  // Cast: the hero flies to the leap target (the hero's own client moves it: a hero this world moves gets its skillMove here), untouchable for the flight and LEAP_IFR (+ leapIfr) after; a flight or reel of the bell
  // it yanks to ends where the bell is. data { x, y } (the client's target) is taken within 64 px of this world's. The slam lands with the hero (queued).
  ED.CAST.heave = function (p, a, data, st, N) {
    if (st.weapon.kind !== 'bell' || p.bellLeap) return false;
    if (p.bellRoom !== this.room || !p.bells.length) resetBells(this, p, st.weapon);
    const b0 = anchorOf(this, p);
    if (b0 && b0.s === FLY) land(this, p, b0);
    if (b0 && b0.s === REEL) { b0.s = ANCHOR; b0.vx = 0; b0.vy = 0; b0.reel = null; }
    const g = ED.Bell.leapTarget(this, p, a), fin = (v) => typeof v === 'number' && isFinite(v);
    let x = g.x, y = g.y;
    if (data && fin(data.x) && fin(data.y) && U.dist2(data.x, data.y, x, y) <= 64 * 64) { x = data.x; y = data.y; }
    const bi = g.bell ? p.bells.indexOf(g.bell) : -1;
    p.bellLeap = { at: this.time + g.t, x, y, bi };
    if (!p.remote) p.skillMove = ED.leapMove(this.room, this.locked, p, x, y, { t: g.t, iframes: g.t + C.LEAP_IFR + st.leapIfr });
    p.bellQ.push({ at: this.time + g.t, k: 'slam', x, y, bi, room: this.room });
    return { tx: Math.round(x), ty: Math.round(y), d: Math.round(g.t * 100) / 100, y2: bi >= 0 ? 1 : 0 };
  };
  // The slam where the leap lands: the slam part on every foe within its radius (Ground Breaker's stun, Anchor Chain's Shackle, Undertow's pull, Tether Hook's shield); the bell yanked to is back in hand;
  // Wrecker: every hand bell at full wind; Wrecking Spin: the bells whirl by themselves for spinDur.
  function slam(w, p, o) {
    const st = p.stats, N = ED.Stats.skillNums('heave', st), q = N.p.slam;
    p.bellLeap = null;
    if (o.room !== w.room) return;
    if (st.hookPull > 0) pullTo(w, p, o.x, o.y, st.hookPull);
    let struck = 0;
    w.skillBlast(p, o.x, o.y, q.r, q.dmg, w.partSrc(p, N, 'slam'), (e) => {
      struck++;
      if (e.hp <= 0) return;
      if (st.smashStun > 0) w.stunFoe(e, st.smashStun, false);
      if (st.shackle > 0) { w.slowEnemy(e, 0.5, st.shackle); e.weakV = Math.max(e.weakT > 0 ? e.weakV : 0, st.shackleWeak); e.weakT = Math.max(e.weakT, st.shackle); }
    });
    w.emit({ t: 'bsmash', pid: p.pid, x: Math.round(o.x), y: Math.round(o.y), r: Math.round(q.r) });
    if (struck && st.hookShield > 0 && p.hookT <= 0 && w.addShield(p, st.hookShield * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class') > 0) p.hookT = C.HOOK_CD;
    const b = o.bi >= 0 ? p.bells[o.bi] : null, O = orbitOf(st.weapon);
    if (b && b.s !== HAND) home(w, p, b, O);
    if (st.wrecker > 0) { const v = windRef(st), s = p.bellSpin || 1; for (const h of p.bells) if (h.s === HAND) { const a = Math.atan2(h.y - p.y, h.x - p.x); h.vx = -Math.sin(a) * s * v; h.vy = Math.cos(a) * s * v; } }
    if (N.p.spin.on) p.spinT = N.p.spin.dur;
    p.bellPx = p.x; p.bellPy = p.y;
  }
  // Undertow: every non-boss foe within r of (x, y) is dragged to it (up to r px, never through walls).
  function pullTo(w, p, x, y, r) {
    const q = w.foeScan(x, y, r), list = [];
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (live(e) && !e.boss && U.dist2(e.x, e.y, x, y) < r * r) list.push(e); }
    w.foeEnd();
    for (const e of list) { const d = Math.hypot(x - e.x, y - e.y); if (d > e.r) Sim.moveCircle(e, (x - e.x) * (1 - e.r / d), (y - e.y) * (1 - e.r / d), w.room, w.locked, e.fly); }
    if (list.length) w.emit({ t: 'bhook', pid: p.pid, x: Math.round(x), y: Math.round(y), n: list.length });
  }

  // ---------------- Peal ----------------
  // Cast: every bell rings a wave around itself where it is (in hand or anchored far away): the wave part x (1 + RES_K x Resonance), radius x (1 + RES_R x Resonance / RES_MAX); a foe is struck by one wave per cast;
  // struck foes are stunned (wave stun + pealStun; never bosses); Thunderclap charges and discharges them; Warding Toll swats shots and shields per foe struck; Reverberation rings again; Thunder Toll calls bolts; Ward Bell leaves a ward.
  // Resonance empties; p.pealResLast holds the factor this cast used (>= 1).
  ED.CAST.peal = function (p, a, data, st, N) {
    if (st.weapon.kind !== 'bell') return false;
    if (p.bellRoom !== this.room || !p.bells.length) resetBells(this, p, st.weapon);
    const q = N.p.wave, seen = new Set(), res = p.bellRes, f = 1 + C.RES_K * res, r = q.r * (1 + C.RES_R * res / C.RES_MAX);
    p.pealResLast = f; p.bellRes = 0;
    let struck = 0;
    for (const b of p.bells) {
      struck += pealWave(this, p, N, 'wave', b.x, b.y, r, q.dmg * f, f, seen);
      this.emit({ t: 'peal', pid: p.pid, x: Math.round(b.x), y: Math.round(b.y), r: Math.round(r), v: res });
      if (N.p.echo.on) p.bellQ.push({ at: this.time + N.p.echo.delay, k: 'echo', x: b.x, y: b.y, dmg: N.p.echo.dmg * f, f, r: N.p.echo.r * r / q.r, room: this.room });
      if (st.pealSwat > 0) swat(this, b.x, b.y, r * C.SWAT_K);
      if (N.p.bolt.on) tollBolts(this, p, N, b.x, b.y, N.p.bolt.dmg * f);
      if (N.p.ward.on) wardZone(this, p, b.x, b.y, r, N.p.ward.dur);
    }
    if (st.pealShield > 0 && struck > 0 && p.pealT <= 0 && this.addShield(p, Math.min(st.pealCap, st.pealShield * struck) * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class') > 0) p.pealT = C.PEAL_SH_CD;
    return { v: res };
  };

  // One Peal wave (part pid of N, centre x, y, radius r, damage dmg, Resonance factor f) on every foe not yet in seen: the hit, the stun (the wave's), Thunderclap's charge and discharge. Returns the foes struck that are not horde foes.
  function pealWave(w, p, N, pid, x, y, r, dmg, f, seen) {
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
  // A moving bell destroys every enemy shot its path this tick (from b.px, b.py) passes within its radius of.
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
          if (!(e.weakT > 0) || wk > e.weakV) e.weakV = wk;
          e.weakT = Math.max(e.weakT, 0.3);
        }
      } });
  }

  // Queued effects: Reverberation echoes and Anchor Leap slams.
  function runQueue(w, p) {
    const q = p.bellQ;
    for (let i = 0; i < q.length;) {
      const o = q[i];
      if (o.at > w.time) { i++; continue; }
      q.splice(i, 1);
      if (o.k === 'echo') { if (o.room === w.room) { const N = ED.Stats.skillNums('peal', p.stats); pealWave(w, p, N, 'echo', o.x, o.y, o.r, o.dmg, o.f, new Set()); w.emit({ t: 'peal', pid: p.pid, x: Math.round(o.x), y: Math.round(o.y), r: Math.round(o.r), v: 0, e: 1 }); } }
      else if (o.k === 'slam') slam(w, p, o);
    }
  }

  // Moves under the hero's own feet: a hero that winds walks at WIND_MOVE (Slipstream: full speed). Wraps ED.Stats.moveRate, which the sim and every client's own movement read.
  const moveRate0 = ED.Stats.moveRate;
  ED.Stats.moveRate = (p) => moveRate0(p) * (p.bellWind && !(p.stats.slipstream > 0) ? C.WIND_MOVE : 1);

  // ---------------- Bellwarden hook table ----------------
  ED.CLS.bell = {
    // bells: p.bells (see the file header), p.bellL (hand chain length now), p.haul (0..1 wound amount), p.bellSpin (turning sense of the wind), p.bellHauled (held last tick), p.haulUntil (end of the 'atk' hold window), p.haulIn (input flag; undefined until the input layer sets it),
    // p.haulPress / p.bellPressN (presses counted by the input layer / seen here: a tap shorter than a tick still reels), p.haulNear (input: an interactable in range, a release does not hurl), p.bellWind (winding: the move factor), p.bellWhirl (a hand bell wound at strike speed), p.juggleT (the other wound bells wind until then),
    // p.bellLeap (an Anchor Leap in flight), p.spinT (Wrecking Spin left), p.bellTok (winding strike budget), p.bellQ (queued effects), p.hookT / p.pealT (shield cooldowns), p.bellRoom (the room the bells are in), p.bellPx / p.bellPy (where the hand bells were last carried to),
    // p.bellRes / p.bellResAt (Resonance and when it last grew), p.pealResLast (the last Peal's Resonance factor), p.bellTickT (world time of the last tick: a gap means the hero was down), p.bellBossId / p.bellPhase (the boss phase seen).
    init(p) { p.bells = []; p.bellL = 0; p.haul = 0; p.bellSpin = 1; p.haulUntil = -99; p.bellLeap = null; p.bellTok = 0; p.bellQ = []; p.hookT = 0; p.pealT = 0; p.bellRoom = null; p.bellHauled = false; p.bellWhirl = false; p.bellWind = false;
      p.bellPressN = 0; p.juggleT = -99; p.spinT = 0; p.bellRes = 0; p.bellResAt = -99; p.pealResLast = 1; p.bellTickT = undefined; p.bellBossId = -1; p.bellPhase = 0; },

    // Every bell out of the hand comes home (the hero is down: world.js calls it while p.downed).
    down(p) { if (p.bells && p.bells.length && p.stats.weapon.kind === 'bell') snapHome(this, p); p.bellWind = false; },

    // The bells each tick: snaps home, presses and releases (reel, hurl), the hand chain length, the strike budget, the foes in reach gathered once, then BELL_SUB substeps move every bell by its state.
    tick(p, dt) {
      const st = p.stats, wp = st.weapon;
      if (wp.kind !== 'bell') { if (p.bells.length) p.bells.length = 0; p.bellWhirl = false; p.bellWind = false; return; }
      if (p.hookT > 0) p.hookT -= dt;
      if (p.pealT > 0) p.pealT -= dt;
      if (p.spinT > 0) p.spinT -= dt;
      if (p.bellRoom !== this.room || p.bells.length !== (wp.n || 1)) resetBells(this, p, wp);
      if (p.bellTickT !== undefined && this.time - p.bellTickT > dt * 2.5) snapHome(this, p); // ticks were missed: the hero was down
      p.bellTickT = this.time;
      const bo = this.boss;
      if (bo && bo.hp > 0) { if (p.bellBossId === bo.id && p.bellPhase !== bo.phase) snapHome(this, p); p.bellBossId = bo.id; p.bellPhase = bo.phase; }
      if (p.bellRes > 0 && this.time - p.bellResAt > C.RES_HOLD) { p.bellRes--; p.bellResAt += C.RES_DECAY; }
      if (p.bellQ.length) runQueue(this, p);
      const L = wp.chain, O = orbitOf(wp), haul = hauling(this, p), pressN = p.haulPress | 0;
      const press = (haul && !p.bellHauled) || pressN > p.bellPressN, release = !haul && p.bellHauled;
      p.bellPressN = pressN;
      if (haul && !p.bellHauled) p.bellSpin = spinOf(p);
      p.bellHauled = haul;
      p.bellGuard = haul && st.hold === 'guard' && p.bells.some(b => b.s === HAND && windOf(st, b) >= 1); // Hallowed Arms: a guard while a hand bell winds at full wind (elements.js guardFront)
      if (press) for (const b of p.bells) { if (b.s === ANCHOR) startReel(this, p, b); else if (b.s === FLY) b.reelQ = true; }
      if (release && !p.bellLeap && !p.haulNear) { // the most-wound hand bell flies at WIND_GO wind or more; the other wound bells keep winding JUGGLE_T (never with an interactable in range: the attack interacts)
        let best = null, bw = -1;
        for (const b of p.bells) if (b.s === HAND) { const v = windOf(st, b); if (v > bw) { bw = v; best = b; } }
        if (best && bw >= C.WIND_GO) { hurl(this, p, best); if (p.bells.some(b => b.s === HAND)) p.juggleT = this.time + C.JUGGLE_T; }
      }
      const hand = p.bells.some(b => b.s === HAND), driven = hand && (haul || this.time < p.juggleT || p.spinT > 0);
      p.bellWind = haul && hand;
      if (p.bellWind && st.swift) p.flowT = C.FLOW_T; // a Swift bell gives Flow while it winds
      const target = driven ? O : L, L0 = p.bellL, rate = (L - O) * wp.haul / C.HAUL_T;
      const Lc = L0 < target ? Math.min(target, L0 + rate * dt) : Math.max(target, L0 - rate * dt), Ldot = (Lc - L0) / dt;
      p.bellL = Lc;
      p.haul = U.clamp((L - Lc) / (L - O), 0, 1);
      p.bellTok = Math.min(C.BELL_HITS * 0.1, p.bellTok + C.BELL_HITS * dt);
      const drive = driven ? (p.spinT > 0 ? driveOf(p, st) * 2 : driveOf(p, st)) : 0;
      // the foes the moving bells can reach this tick (a pooled scan copied out: strikes may kill, spawn and scan again)
      let reach = Lc + C.BELL_CAP / 60;
      for (const b of p.bells) if (b.s === FLY || b.s === REEL) reach = Math.max(reach, Math.hypot(b.x - p.x, b.y - p.y) + C.HURL_SPEED / 60);
      reach += bellR(st) + 40;
      const q = this.foeScan(p.x, p.y, reach), foes = p.bellFoes || (p.bellFoes = []);
      foes.length = 0;
      for (let k = 0; k < q.length; k++) if (q[k].hp > 0) foes.push(q[k]);
      this.foeEnd();
      const h = dt / C.BELL_SUB, trail = !driven;
      carry(this, p, driven);
      for (const b of p.bells) { b.px = b.x; b.py = b.y; }
      for (let s = 0; s < C.BELL_SUB; s++) for (const b of p.bells) {
        if (b.s === HAND) stepHand(this, p, b, h, Lc, Ldot, drive, foes, trail);
        else if (b.s === FLY) stepFly(this, p, b, h, foes);
        else if (b.s === REEL) stepReel(this, p, b, h, foes, O);
      }
      let whirl = false;
      for (const b of p.bells) {
        if (b.hit.size > 48) for (const [id, t] of b.hit) if (this.time - t > 1) b.hit.delete(id);
        if (b.s === ANCHOR) { anchorTick(this, p, b); continue; }
        if (b.s === HAND && relV(b) < C.BELL_MIN) continue;
        if (b.s === HAND && driven) whirl = true;
        this.smashCircle(p, b.x, b.y, bellR(st));
        swatPath(this, b, bellR(st));
      }
      p.bellWhirl = whirl;
      foes.length = 0;
    },

    // The weapon attack of a bell (combat.js playerAttack): an 'atk' action holds the wind for HAUL_HOLD attack intervals (when no input flag drives it).
    weaponAttack(p, a) {
      p.face = a; p.stealthT = 0;
      p.haulUntil = this.time + C.HAUL_HOLD * ED.Stats.attackInterval(p);
    },
  };
  ED.Bell.STATES = { HAND, FLY, ANCHOR, REEL };
  ED.Bell.windOf = windOf;
})(globalThis.ED || (globalThis.ED = {}));
