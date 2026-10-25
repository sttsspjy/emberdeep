// Path engines: Burn stacks and the Flame death burst, Frost Shatters, Storm threshold discharges, and the hold-attack verbs (flame cone, ice lance, storm call, finisher).
// combat.js calls addBurn / tickBurn / addCharge / tickCharge / discharge / shatter / pyreBurst; build.js initBuild calls initVerbs; updatePlayerCombat calls updateVerbs; game.js and the bots call playerHold.
(function (ED) {
  'use strict';
  const U = ED.U, St = ED.Stats, C = ED.CONST;
  const W = ED.World.prototype;
  const R = Math.round;

  // Burn: a stack deals BURN_K x Power x the damage stat per second (x 1 + burnMul) for BURN_LIFE s; a foe holds BURN_CAP + burnCap stacks; Wildfire reads BURN_AT stacks of one hero, Smother SMOTHER_AT; WILD_R: Wildfire reach beyond touching.
  // Death burst (Flame): radius PYRE_R + PYRE_RS per stack (x 1 + pyreR); every foe in it takes PYRE_K of the Burn the dead foe still held x (1 + burnMul) x (1 + pyreMul) and catches PYRE_PASS (+ pyrePass) of its stacks; Ember Heart weakens for PYRE_WEAK_T s;
  // Scorched Earth burns the ground SCORCH_T s over SCORCH_K of the burst radius. Charge: held CHARGE_HOLD (+ chargeHold) s, then CHARGE_FADE of it fades per second; at CHARGE_AT x the foe's max HP it discharges DIS_K x the charge;
  // a discharge jumps DIS_JUMP (x 1 + jumpR), DIS_JUMPS (+ jumps) hops; Arc Flash arcs ARC_MUL to uncharged foes and charges them ARC_CHARGE of that. Frost: FREEZE_SET s after a freeze a hit Shatters; SHATTER_R splash of SHATTER_CHILL chill;
  // FROZEN_VULN taken by a frozen foe; BRITTLE_T: a boss's full gauge leaves it Brittle (its next hit Shatters at BRITTLE_K); COLD_CD between Cold Cycle refunds; THERMAL_K: Thermal Shock's payout factor.
  // Holds: CONE_TICK / CONE_ARC / CONE_RANGE (ranged) / CONE_REACH (melee reach factor) / CONE_MUL (attack dps share) / CONE_BURN (Burn factor); LANCE_* (damage at full, least charge, flight px, speed); FIN_MUL, FIN_REACH;
  // STORM_TICK / STORM_RANGE / STORM_MUL / STORM_CHARGE: the Tempest call (a bolt per tick on the foe nearest the aim, attack dps share, charge factor).
  Object.assign(C, {
    BURN_K: 0.15, BURN_LIFE: 4, BURN_CAP: 10, BURN_AT: 5, SMOTHER_AT: 3, WILD_R: 12,
    PYRE_R: 40, PYRE_RS: 4, PYRE_K: 0.5, PYRE_PASS: 0.5, PYRE_WEAK_T: 3, SCORCH_T: 3, SCORCH_K: 0.6,
    CHARGE_HOLD: 3, CHARGE_FADE: 0.4, CHARGE_AT: { trash: 0.1, elite: 0.05, boss: 0.02 }, DIS_K: 2, DIS_JUMP: 120, DIS_JUMPS: 3, ARC_MUL: 0.75, ARC_CHARGE: 0.25,
    FREEZE_SET: 0.2, SHATTER_R: 60, SHATTER_CHILL: 40, FROZEN_VULN: 0.25, BRITTLE_T: 2, BRITTLE_K: 0.5, COLD_CD: 1.5, THERMAL_K: 1.5,
    CONE_TICK: 0.15, CONE_ARC: 0.9, CONE_RANGE: 130, CONE_REACH: 1.5, CONE_MUL: 0.6, CONE_BURN: 3,
    LANCE_MUL: 2.5, LANCE_MIN: 0.3, LANCE_LEN: 320, LANCE_SPEED: 560, FIN_MUL: 2, FIN_REACH: 0.3, REND_K: 1.5,
    STORM_TICK: 0.3, STORM_RANGE: 220, STORM_MUL: 0.6, STORM_CHARGE: 3,
  });

  // Called from initBuild: per-hero verb state. holdOn / holdT / holdTick: the hold-attack verb; coldT: Cold Cycle clock.
  W.initVerbs = function (p) {
    p.holdOn = false; p.holdT = 0; p.holdTick = 0; p.coldT = 0;
  };

  // ---------------- Burn stacks ----------------
  const burnV = (o) => C.BURN_K * o.stats.power * Math.max(0.1, o.stats.dmg); // a stack's damage per second before burnMul
  const ok = (e) => e.hp > 0 && !e.killed && !e.def.invuln && !e.burrowed;
  // Derived fields of e's stacks (e.bsT end times, e.bsO owners): burnN (count), burnPool (damage still to come before burnMul), burn (flag), smother (strongest Smother of a hero holding SMOTHER_AT stacks), wildO (a Wildfire hero holding BURN_AT stacks).
  function burnSync(e, now) {
    const T = e.bsT, O = e.bsO, n = T ? T.length : 0;
    let pool = 0, sm = 0, wo = null;
    for (let i = 0; i < n; i++) {
      const o = O[i];
      pool += burnV(o) * Math.max(0, T[i] - now);
      let first = true, c = 0;
      for (let j = 0; j < n; j++) if (O[j] === o) { if (j < i) { first = false; break; } c++; }
      if (first && c >= C.SMOTHER_AT && o.stats.smother > sm) sm = o.stats.smother;
      if (first && c >= C.BURN_AT && !wo && o.stats.wildfire > 0) wo = o;
    }
    e.burnN = n; e.burnPool = pool; e.burn = n > 0 ? 1 : 0; e.smother = sm; e.wildO = wo;
    if (!n) e.bacc = 0;
  }
  W.burnSync = function (e) { burnSync(e, this.time); };

  // Burn build-up of hero p on e: amount (from damage dealt) fills e.bacc; every BURN_K x Power x dmg x BURN_LIFE of it is one stack of p (a stack is worth what it deals before burnMul). API of every Burn source.
  W.addBurn = function (e, amount, p) {
    if (!(amount > 0) || !p || !ok(e)) return;
    const S = burnV(p) * C.BURN_LIFE;
    if (!(S > 0)) return;
    e.bacc = (e.bacc || 0) + amount;
    if (e.bacc < S) return;
    const cap = C.BURN_CAP + p.stats.burnCap;
    let n = Math.floor(e.bacc / S);
    e.bacc -= n * S;
    if (n > cap) { n = cap; e.bacc = 0; }
    for (let i = 0; i < n; i++) this.burnStack(e, p, 0, true);
    burnSync(e, this.time);
  };

  // One Burn stack of hero p on e for life s (default BURN_LIFE); at the cap the stack that ends first is replaced. noSync: the caller syncs. e.bsS: start times (a missing entry counts as long started).
  W.burnStack = function (e, p, life, noSync) {
    if (!p || !ok(e)) return;
    if (!e.bsT) { e.bsT = []; e.bsO = []; }
    const T = e.bsT, O = e.bsO, S = e.bsS || (e.bsS = []), cap = C.BURN_CAP + p.stats.burnCap;
    if (!T.length) { e.burnTick = 0.5; e.burnLast = this.time; }
    while (T.length >= cap) { let k = 0; for (let i = 1; i < T.length; i++) if (T[i] < T[k]) k = i; T.splice(k, 1); O.splice(k, 1); S.splice(k, 1); }
    S.length = T.length; T.push(this.time + (life > 0 ? life : C.BURN_LIFE)); O.push(p); S.push(this.time);
    e.burnOwner = p;
    if (!noSync) burnSync(e, this.time);
  };

  // Removes a share (0..1, at least one stack while any) of e's stacks, newest first; returns the damage they still held before burnMul (Rupture, Plaguebearer, Thermal Shock pay it at once).
  W.takeBurn = function (e, share) {
    const T = e.bsT, O = e.bsO;
    if (!T || !T.length || !(share > 0)) return 0;
    const now = this.time, n = Math.min(T.length, Math.max(1, Math.round(share * T.length)));
    let got = 0;
    for (let i = 0; i < n; i++) { const k = T.length - 1; got += burnV(O[k]) * Math.max(0, T[k] - now); T.pop(); O.pop(); }
    if (e.bsS) e.bsS.length = T.length;
    burnSync(e, now);
    return got;
  };

  // Copies a share f of src's stacks (newest first, at most max) onto dst with their owners and time left; move: src loses them (while it lives). Returns the stacks copied.
  W.copyBurn = function (src, dst, f, max, move) {
    const T = src.bsT, O = src.bsO;
    if (!T || !T.length || !ok(dst) || !(f > 0)) return 0;
    const now = this.time, n = Math.min(T.length, max || 99, Math.max(1, Math.round(f * T.length)));
    for (let i = 0; i < n; i++) { const k = T.length - 1 - i; if (T[k] > now) this.burnStack(dst, O[k], T[k] - now, true); }
    if (move && src.hp > 0) { T.length -= n; O.length -= n; if (src.bsS) src.bsS.length = T.length; burnSync(src, now); }
    burnSync(dst, now);
    return n;
  };

  // Per-tick Burn (tickStatuses): every 0.5 s each owner's stacks deal its Burn value x the time each stack burned in the last 0.5 s, as one hit (burnLast: the last tick; a stack deals its value x its life); Wildfire passes stacks once a second.
  W.tickBurn = function (e, dt) {
    const T = e.bsT;
    if (!T || !T.length) { if (e.burnN) { e.burn = 0; e.burnN = 0; e.burnPool = 0; e.smother = 0; e.wildO = null; } return; }
    if (e.wildO && (e.wildT = (e.wildT || 0) + dt) >= 1) { e.wildT -= 1; this.wildfire(e, e.wildO); }
    if ((e.burnTick -= dt) > 1e-9) return; // float residue would add a frame to a 0.5 s tick
    e.burnTick += 0.5;
    const now = this.time, O = e.bsO, S = e.bsS || (e.bsS = []), t0 = e.burnLast !== undefined && e.burnLast !== null ? e.burnLast : now - 0.5, n0 = T.length;
    e.burnLast = now;
    for (let i = 0; i < n0 && e.hp > 0; i++) {
      const o = O[i];
      let secs = 0, dup = false;
      for (let j = 0; j < n0; j++) if (O[j] === o) { if (j < i) { dup = true; break; } secs += Math.max(0, Math.min(now, T[j]) - Math.max(t0, S[j] !== undefined ? S[j] : -1e9)); }
      if (!dup && secs > 0) this.hitEnemy(e, secs * burnV(o) * (1 + o.stats.burnMul), { p: o, kind: 'dot', raw: true, noProc: true, crit: false, el: 'fire' });
    }
    if (e.hp <= 0) return;
    let k = 0;
    for (let i = 0; i < T.length; i++) if (T[i] > now + 1e-9) { T[k] = T[i]; O[k] = O[i]; S[k] = S[i]; k++; }
    T.length = k; O.length = k; S.length = k;
    burnSync(e, now);
  };

  // Wildfire: e (holding BURN_AT stacks of o) passes o.stats.wildfire stacks to the nearest foe touching it that holds fewer of o's stacks.
  W.wildfire = function (e, o) {
    const q = this.foeScan(e.x, e.y, e.r + C.WILD_R + 22), mine = (f) => { let c = 0; if (f.bsO) for (const x of f.bsO) if (x === o) c++; return c; }, have = mine(e);
    let best = null, bd = Infinity;
    for (let k = 0; k < q.length; k++) {
      const f = q[k];
      if (f === e || !ok(f) || f.spawnT > 0) continue;
      const d2 = U.dist2(f.x, f.y, e.x, e.y);
      if (d2 < (e.r + f.r + C.WILD_R) ** 2 && d2 < bd && mine(f) < have) { bd = d2; best = f; }
    }
    this.foeEnd();
    if (!best) return;
    for (let i = 0; i < o.stats.wildfire; i++) this.burnStack(best, o, 0, true);
    burnSync(best, this.time);
    this.emit({ t: 'chain', k: 'f', pts: [[R(e.x), R(e.y - 6)], [R(best.x), R(best.y - 6)]] });
  };

  // ---------------- Flame: the death burst ----------------
  // A non-fodder foe e that dies holding Burn stacks (combat.js deathPayoffs): the hero with pyre holding the most stacks on it queues its burst (chain queue, one hop later). Returns whether one was queued.
  W.pyreDeath = function (e) {
    const O = e.bsO, T = e.bsT;
    if (!O || !O.length) return false;
    const now = this.time;
    let h = null, hn = 0;
    for (let i = 0; i < O.length; i++) {
      const o = O[i];
      if (!o.stats.pyre || T[i] <= now) continue;
      let c = 0; for (let j = 0; j < O.length; j++) if (O[j] === o && T[j] > now) c++;
      if (c > hn) { hn = c; h = o; }
    }
    if (!h) return false;
    let pool = 0, n = 0;
    for (let i = 0; i < O.length; i++) if (T[i] > now) { pool += burnV(O[i]) * (T[i] - now); n++; }
    const st = h.stats, r = (C.PYRE_R + C.PYRE_RS * n) * (1 + st.pyreR), amt = pool * C.PYRE_K * (1 + st.burnMul) * (1 + st.pyreMul);
    this.queuePayoff(h, { kind: 'pyre', e, x: e.x, y: e.y, amt, r });
    return true;
  };
  // The burst of a queued pyre entry en { e (the dead foe), x, y, amt, r } by hero p: every other foe within r takes amt as Fire and catches PYRE_PASS (+ pyrePass) of the dead foe's stacks; Ember Heart weakens them (bosses half);
  // Scorched Earth leaves burning ground (zone pfire, a stack per 0.5 s, blocking non-elite paths).
  W.pyreBurst = function (p, en) {
    const st = p.stats, e = en.e, x = en.x, y = en.y, r = en.r, list = [];
    const q = this.foeScan(x, y, r);
    for (let k = 0; k < q.length; k++) { const o = q[k]; if (o !== e && ok(o) && o.spawnT <= 0 && U.dist2(o.x, o.y, x, y) < (r + o.r) ** 2) list.push(o); }
    this.foeEnd();
    this.emit({ t: 'boom', x: R(x), y: R(y), r: R(r), k: 'fire', q: 1 });
    const pass = C.PYRE_PASS + st.pyrePass;
    for (const o of list) {
      if (en.amt > 0) this.hitEnemy(o, en.amt, { p, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true, el: 'fire', x, y, knock: 60, kx: (o.x - x) / (Math.hypot(o.x - x, o.y - y) || 1), ky: (o.y - y) / (Math.hypot(o.x - x, o.y - y) || 1) });
      if (o.hp > 0) this.copyBurn(e, o, pass, 0, false);
      if (st.pyreWeak && o.hp > 0) { const v = st.pyreWeak * (o.boss ? 0.5 : 1); o.weakV = o.weakT > 0 ? Math.max(o.weakV, v) : v; o.weakT = Math.max(o.weakT, C.PYRE_WEAK_T); }
    }
    if (st.scorch) this.addZone({ kind: 'pfire', x, y, r: r * C.SCORCH_K, dur: C.SCORCH_T, dps: 0, stack: 1, owner: p.pid, team: 0, block: 1 });
  };

  // ---------------- Storm: charge and discharge ----------------
  // Charge of hero p on e (HP units): held CHARGE_HOLD + chargeHold s after the last gain, then fading (tickCharge). The last hero to add owns it. At CHARGE_AT of the foe's max HP the owner's discharge is queued (e.disQ until it runs).
  const chargeAt = (e) => e.maxHp * C.CHARGE_AT[e.boss ? 'boss' : e.elite ? 'elite' : 'trash'];
  W.chargeAt = chargeAt;
  W.addCharge = function (e, amount, p) {
    if (!(amount > 0) || !ok(e)) return;
    e.charge += amount;
    if (p) { e.chargeOwner = p; e.chargeT = C.CHARGE_HOLD + p.stats.chargeHold; } else e.chargeT = Math.max(e.chargeT, C.CHARGE_HOLD);
    if (e.chargeOwner && !e.disQ && e.charge >= chargeAt(e)) this.queueDischarge(e, e.chargeOwner);
  };
  // Queues the discharge of e's charge by its owner p (a threshold, a Stormblade crit): chain queue, one hop later.
  W.queueDischarge = function (e, p) {
    e.disQ = true;
    this.queuePayoff(p, { kind: 'dis', e, x: e.x, y: e.y, mul: C.DIS_K, jumps: C.DIS_JUMPS + p.stats.jumps, self: true });
  };
  W.tickCharge = function (e, dt) {
    if (!(e.charge > 0)) return;
    if (e.chargeT > 0) e.chargeT -= dt;
    else { e.charge *= Math.max(0, 1 - C.CHARGE_FADE * dt); if (e.charge < 0.5) { e.charge = 0; e.disQ = false; } }
  };

  // Discharge of e's charge by hero p: charge x mul x (1 + shockMul + capacitor) as Lightning (Superconductor: more on a chilled or frozen foe); Capacitor keeps capKeep of the charge; Plasma adds Burn; Overload stuns;
  // the discharge jumps (one chain hop later) to each foe within DIS_JUMP x (1 + jumpR) that p charged, jumps hops deep (default DIS_JUMPS); Arc Flash arcs ARC_MUL to the uncharged ones there and charges them ARC_CHARGE of it. Returns the damage.
  W.discharge = function (e, p, mul, jumps) {
    const ch = e.charge;
    e.disQ = false;
    if (!(ch > 0) || e.hp <= 0 || !p) return 0;
    if (jumps === undefined) jumps = C.DIS_JUMPS + p.stats.jumps;
    const own = this.openChain(), st = p.stats, k = mul > 0 ? mul : 1, x = e.x, y = e.y, reach = C.DIS_JUMP * (1 + st.jumpR);
    e.charge = ch * st.capKeep; e.chargeT = e.charge > 0 ? C.CHARGE_HOLD + st.chargeHold : 0;
    const dmg = ch * k * (1 + st.shockMul + st.capacitor) * (st.supercon && (e.chill > 0 || e.frozen > 0) ? 1 + st.supercon : 1);
    this.hitEnemy(e, dmg, { p, kind: 'chain', raw: true, noProc: true, crit: false, noGuard: true, el: 'lightning', x, y });
    this.emit({ t: 'chain', k: 'd', pts: [[R(x), R(y) - 24], [R(x), R(y)]] });
    if (st.plasma) this.addBurn(e, dmg * st.plasma, p);
    if (st.arcStun && e.hp > 0) this.stunFoe(e, st.arcStun, true);
    const q = this.foeScan(x, y, reach), near = [];
    for (let i = 0; i < q.length; i++) {
      const o = q[i];
      if (o === e || !ok(o) || o.spawnT > 0) continue;
      const d2 = U.dist2(o.x, o.y, x, y);
      if (d2 < (reach + o.r) ** 2) near.push({ d2, o });
    }
    this.foeEnd();
    near.sort((a, b) => a.d2 - b.d2);
    for (const n of near) {
      const o = n.o;
      if (o.hp <= 0) continue;
      if (o.charge > 0 && o.chargeOwner === p) { if (jumps > 0) this.queuePayoff(p, { kind: 'dis', e: o, x, y, mul: k, jumps: jumps - 1 }); }
      else if (st.arcFlash) {
        this.emit({ t: 'chain', pts: [[R(x), R(y)], [R(o.x), R(o.y)]] });
        const a = dmg * C.ARC_MUL;
        this.hitEnemy(o, a, { p, kind: 'chain', raw: true, noProc: true, crit: false, noGuard: true, el: 'lightning', x, y });
        if (o.hp > 0) this.addCharge(o, a * C.ARC_CHARGE, p);
        if (st.arcStun && o.hp > 0) this.stunFoe(o, st.arcStun, true);
      }
    }
    if (own) this.curChain = null;
    return dmg;
  };

  // ---------------- Frost: Shatter ----------------
  // A direct hero hit on e Shatters when e has been frozen FREEZE_SET s (or is a Brittle boss) and the hero has shatter: returns the damage factor (1 + shatter, a Brittle boss 1 + BRITTLE_K x shatter) or 0.
  W.shatterMul = function (e, st) {
    if (!(st.shatter > 0)) return 0;
    if (e.frozen > 0 && this.time - (e.frozenAt || 0) >= C.FREEZE_SET - 1e-9) return 1 + st.shatter;
    if (e.boss && e.brittle > 0) return 1 + st.shatter * C.BRITTLE_K;
    return 0;
  };
  // The Shatter of hero p on e (after the hit of dmg): the freeze (or the Brittle mark) ends; SHATTER_CHILL to every foe within SHATTER_R; Shatterpoint bursts shatterSplash of the hit there; Absolute Zero freezes the non-boss foes there
  // with no freeze resistance left; Thermal Shock pays out half of e's Burn at THERMAL_K; Cold Cycle takes coldCycle s off every skill cooldown (once per COLD_CD).
  W.shatter = function (e, p, dmg) {
    const st = p.stats, r = C.SHATTER_R;
    e.frozen = 0; e.glacier = false; e.brittle = 0;
    this.emit({ t: 'shatter', x: R(e.x), y: R(e.y), r: st.shatterSplash ? r : 0 });
    const q = this.foeScan(e.x, e.y, r), list = [];
    for (let k = 0; k < q.length; k++) { const o = q[k]; if (o !== e && ok(o) && o.spawnT <= 0 && U.dist2(o.x, o.y, e.x, e.y) <= (r + o.r) ** 2) list.push(o); }
    this.foeEnd();
    for (const o of list) {
      if (st.shatterSplash) this.hitEnemy(o, dmg * st.shatterSplash, { p, kind: 'explode', raw: true, noProc: true, crit: false, noShatter: true, noGuard: true, el: 'ice', x: e.x, y: e.y });
      if (o.hp <= 0) continue;
      if (st.zeroFreeze && !o.boss && !(o.frozen > 0) && !(o.freezeRes > 0)) this.freezeEnemy(o, p);
      else this.addChill(o, C.SHATTER_CHILL, p);
    }
    if (st.thermal && e.burnN > 0) { const got = this.takeBurn(e, 0.5); if (got > 0 && e.hp > 0) this.hitEnemy(e, got * C.THERMAL_K * (1 + st.burnMul), { p, kind: 'chain', raw: true, noProc: true, crit: false, noGuard: true, el: 'fire' }); }
    if (st.coldCycle && this.time >= p.coldT) { p.coldT = this.time + C.COLD_CD; this.refundSkill(p, -1, st.coldCycle); }
  };

  // ---------------- per tick ----------------
  // Called from updatePlayerCombat for a living, standing hero: the hold verb.
  W.updateVerbs = function (p, dt) {
    if (p.holdOn) this.tickHold(p, dt);
  };

  // ---------------- hold-attack verbs (stats.hold, St.HOLD) ----------------
  // on: the hold starts (the hero's client held attack St.HOLD[k].at s) or ends (release). a: the aim.
  W.playerHold = function (p, on, a) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, k = st.hold;
    if (!k || st.weapon.kind === 'bell') return; // a Bellwarden's hold winds the bell: its verb rides a full-wind hurl (bellHold)
    if (typeof a === 'number' && Number.isFinite(a)) p.face = a;
    if (on) {
      if (p.holdOn) return;
      p.holdOn = true; p.holdT = 0; p.holdTick = 0;
      this.emit({ t: 'hold', pid: p.pid, k, on: 1 });
      return;
    }
    if (!p.holdOn) return;
    p.holdOn = false;
    const full = St.holdFull(st), f = full > 0 ? Math.min(1, p.holdT / full) : 1;
    this.emit({ t: 'hold', pid: p.pid, k, on: 0 });
    if (k === 'lance') this.iceLance(p, p.face, Math.max(C.LANCE_MIN, f));
    else if (k === 'finisher' && f >= 1) this.playerAttack(p, p.face, 0, undefined, true);
  };

  // A tick of the held verb: the hold clock, the flame cone every CONE_TICK, the storm call every STORM_TICK, the time limit of the cone and the storm.
  W.tickHold = function (p, dt) {
    const st = p.stats, k = st.hold, H = k && St.HOLD[k];
    if (!H) { p.holdOn = false; return; }
    p.holdT += dt;
    if (H.max > 0 && p.holdT >= H.max) { p.holdOn = false; this.emit({ t: 'hold', pid: p.pid, k, on: 0 }); return; }
    if (k === 'cone' && (p.holdTick -= dt) <= 0) { p.holdTick += C.CONE_TICK; this.flameCone(p); }
    else if (k === 'storm' && (p.holdTick -= dt) <= 0) { p.holdTick += C.STORM_TICK; this.stormCall(p); }
  };

  // The attack's damage per second of hero p (every shot of an attack, at the live attack interval).
  const atkDps = (p) => { const st = p.stats, w = st.weapon; return w.dmg * Math.max(1, (w.n || 1) + st.projN) / St.attackInterval(p); };

  // Cinder Arms: one tick of the flame cone along the hero's facing: CONE_MUL of the attack's damage per second x CONE_TICK to every foe in it (direct weapon hits, no crit), Burn at CONE_BURN x.
  W.flameCone = function (p) {
    const st = p.stats, w = st.weapon, a = p.face || 0, area = 1 + st.area * 0.5;
    const range = w.kind === 'melee' ? w.range * Math.min(ED.CONST.REACH_CAP, area + st.meleeReach) * C.CONE_REACH : C.CONE_RANGE * area;
    const dmg = atkDps(p) * C.CONE_MUL * C.CONE_TICK, add = { fire: st.fireInfuse * (C.CONE_BURN - 1) };
    const q = this.foeScan(p.x, p.y, range), list = [];
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (!ok(e) || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d - e.r <= range && Math.abs(U.angDiff(a, Math.atan2(e.y - p.y, e.x - p.x))) <= C.CONE_ARC / 2 + Math.atan2(e.r, Math.max(d, 1))) list.push(e);
    }
    this.foeEnd();
    for (const e of list) this.hitEnemy(e, dmg, { p, kind: 'weapon', wpn: true, part: 'cone', el: 'fire', crit: false, infAdd: add, x: p.x, y: p.y });
    this.smashArc(p, a, range, C.CONE_ARC);
  };

  // Tempest Arms: one bolt of the storm call on the living foe nearest the hero's aim point (p.aimX / aimY, else 120 px along the facing) within STORM_RANGE of the hero: STORM_MUL of the attack's damage per second x STORM_TICK
  // as a direct Lightning weapon hit (no crit), charging at STORM_CHARGE x.
  W.stormCall = function (p) {
    const st = p.stats, fin = Number.isFinite(p.aimX) && Number.isFinite(p.aimY), ax = fin ? p.aimX : p.x + Math.cos(p.face || 0) * 120, ay = fin ? p.aimY : p.y + Math.sin(p.face || 0) * 120;
    const q = this.foeScan(p.x, p.y, C.STORM_RANGE);
    let best = null, bd = Infinity;
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (!ok(e) || e.spawnT > 0 || U.dist2(e.x, e.y, p.x, p.y) > (C.STORM_RANGE + e.r) ** 2) continue;
      const d2 = U.dist2(e.x, e.y, ax, ay);
      if (d2 < bd) { bd = d2; best = e; }
    }
    this.foeEnd();
    if (!best) return;
    this.emit({ t: 'chain', k: 'd', pts: [[R(best.x), R(best.y) - 70], [R(best.x), R(best.y)]] });
    this.hitEnemy(best, atkDps(p) * C.STORM_MUL * C.STORM_TICK, { p, kind: 'weapon', wpn: true, part: 'storm', el: 'lightning', crit: false, noGuard: true, infAdd: { lightning: st.lightningInfuse * (C.STORM_CHARGE - 1) }, x: best.x, y: best.y });
  };

  // Glacial Arms: an ice lance along a at charge f (LANCE_MIN..1): pierces every foe for LANCE_MUL x f x weapon damage and freezes non-boss foes it hits (spawnProj o.freeze).
  W.iceLance = function (p, a, f) {
    const w = p.stats.weapon;
    this.spawnProj({ team: 0, kind: 'iceshard', x: p.x + Math.cos(a) * 10, y: p.y - 4 + Math.sin(a) * 10, a, speed: C.LANCE_SPEED, r: 7, dmg: w.dmg * C.LANCE_MUL * f, life: C.LANCE_LEN / C.LANCE_SPEED, pierce: 99, owner: p.pid, hk: 'evo', knock: 80, el: 'ice', freeze: true });
    this.emit({ t: 'lance', pid: p.pid, x0: R(p.x), y0: R(p.y - 4), x1: R(p.x + Math.cos(a) * C.LANCE_LEN), y1: R(p.y - 4 + Math.sin(a) * C.LANCE_LEN), k: 1 });
  };

  // A Bellwarden's hold verb on a full-wind hurl landing at (x, y) within radius r: the flame cone bursts (CONE_BURN stacks), the lance freezes non-boss foes, the storm charges them (STORM_CHARGE x the infusion of a weapon hit); the finisher rides the hurl itself (class-bell.js).
  W.bellHold = function (p, x, y, r) {
    const k = p.stats.hold;
    if (k !== 'cone' && k !== 'lance' && k !== 'storm') return;
    const q = this.foeScan(x, y, r), list = [];
    for (let i = 0; i < q.length; i++) { const e = q[i]; if (ok(e) && e.spawnT <= 0 && U.dist2(e.x, e.y, x, y) < (r + e.r) ** 2) list.push(e); }
    this.foeEnd();
    for (const e of list) {
      if (k === 'cone') { for (let i = 0; i < C.CONE_BURN; i++) this.burnStack(e, p, 0, true); this.burnSync(e); }
      else if (k === 'lance') { if (!e.boss) this.freezeEnemy(e, p); }
      else this.addCharge(e, p.stats.weapon.dmg * p.stats.lightningInfuse * C.STORM_CHARGE, p);
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
