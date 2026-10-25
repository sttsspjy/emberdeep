// Element verbs: Burn stacks, dash discharges, perfect dodges, Backstabs, toxic clouds, the ice wall, the decoy and the hold-attack verbs (flame cone, ice lance, flask, guard, finisher).
// combat.js calls addBurn / tickBurn / addCharge / tickCharge / discharge / isBackstab / turnFoe / perfectDodge / guardFront; build.js initBuild calls initVerbs; updatePlayerCombat calls updateVerbs; playerDash calls onDashVerbs; game.js and the bots call playerHold.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, St = ED.Stats, C = ED.CONST;
  const W = ED.World.prototype;
  const R = Math.round;

  // Burn: a stack deals BURN_K x Power x the damage stat per second (x 1 + burnMul) for BURN_LIFE s; a foe holds BURN_CAP + burnCap stacks; Wildfire and Smother read BURN_AT stacks of one hero; WILD_R: Wildfire reach beyond touching; FIREWALK_R: Firewalk spread radius.
  // GROUND_T / GROUND_R: burning ground of a dash (life, radius). Charge: held CHARGE_HOLD (+ chargeHold) s, then CHARGE_FADE of it fades per second; a dash discharges at DIS_K x the charge within DIS_R of its path; a discharge jumps DIS_JUMP, DIS_JUMPS hops (+ TEMPEST_JUMPS);
  // Conductor arcs at ARC_MUL; TEMPEST_CD between Tempest dash refunds. Venom: VENOM_WEAK less damage, VENOM_SLOW slower, VENOM_DOT x Power per second at full Venom; VENOM_UP: the Venom share the sheet assumes on a foe you keep hitting.
  // Clouds: CLOUD_R radius, CLOUD_T s, CLOUD_V Venom per 0.5 s tick; Toxic Wake drops a WAKE_R cloud for WAKE_T s every WAKE_STEP px walked. Holy: PD_SHIELD of max HP shields the dodger, PD_REFUND_CD between Swift Grace refunds, PD_STRIKE_T window of Divine Riposte.
  // Shadow: BACK_ARC off the foe's facing counts as behind; foes turn FACE_TURN (bosses FACE_TURN_BOSS) rad/s; BACK_T window of Umbral Step; DECOY_T / DECOY_R of Phantom Step; BEHIND_R / BEHIND_CONE of Umbral Arms' step, BEHIND_T for its crit.
  // Ice: WALL_T / WALL_W of Glacier Step, SHATTER_R splash, COLD_CD between Cold Cycle refunds. Holds: CONE_TICK / CONE_ARC / CONE_RANGE (ranged) / CONE_REACH (melee reach factor) / CONE_MUL (attack dps share) / CONE_BURN (Burn factor);
  // LANCE_* (damage at full, least charge, flight px, speed); FLASK_* (damage, radius, cloud s, range, Venom factor); GUARD_ARC, GUARD_MUL (reflected shot x weapon); FIN_MUL, FIN_REACH. STORM_R / STORM_CONE: Storm Step blink reach and aim cone.
  Object.assign(C, {
    BURN_K: 0.15, BURN_LIFE: 4, BURN_CAP: 10, BURN_AT: 5, WILD_R: 12, FIREWALK_R: 50, GROUND_T: 2, GROUND_R: 22,
    CHARGE_HOLD: 3, CHARGE_FADE: 0.4, DIS_K: 2, DIS_R: 50, DIS_JUMP: 120, DIS_JUMPS: 3, TEMPEST_JUMPS: 2, ARC_MUL: 0.5, TEMPEST_CD: 1.5,
    VENOM_WEAK: 0.3, VENOM_SLOW: 0.3, VENOM_DOT: 0.4, VENOM_UP: 0.6, CLOUD_R: 40, CLOUD_T: 3, CLOUD_V: 12, WAKE_STEP: 40, WAKE_R: 30, WAKE_T: 2,
    PD_SHIELD: 0.02, PD_REFUND_CD: 2, PD_STRIKE_T: 1.5,
    BACK_ARC: 100 * Math.PI / 180, FACE_TURN: 4, FACE_TURN_BOSS: 2, BACK_T: 1.5, DECOY_T: 2, DECOY_R: 200, BEHIND_R: 200, BEHIND_CONE: 0.6, BEHIND_T: 1,
    WALL_T: 2.5, WALL_W: 10, SHATTER_R: 60, COLD_CD: 0.5,
    CONE_TICK: 0.15, CONE_ARC: 0.9, CONE_RANGE: 130, CONE_REACH: 1.5, CONE_MUL: 0.6, CONE_BURN: 3,
    LANCE_MUL: 2.5, LANCE_MIN: 0.3, LANCE_LEN: 320, LANCE_SPEED: 560, FLASK_MUL: 1.5, FLASK_R: 70, FLASK_T: 4, FLASK_MAX: 240, FLASK_V: 2,
    GUARD_ARC: 120 * Math.PI / 180, GUARD_MUL: 2, FIN_MUL: 2, FIN_REACH: 0.3, STORM_R: 220, STORM_CONE: 0.5,
  });

  // Called from initBuild: per-hero verb state. holdOn / holdT / holdTick: the hold-attack verb; pdT: perfect dodge window after a dash (pdSet: attackers already dodged this dash); pdRefT / pdStrikeT: Swift Grace and Divine Riposte clocks;
  // backN / backT: Umbral Step Backstabs left; behindT: Umbral Arms crit until; dsX / dsY: where the dash started; disX / disY: path swept so far; dashRefT: Tempest refund clock; coldT: Cold Cycle clock; wakeX / wakeY: last Toxic Wake drop;
  // touchSet: burning foes Firewalk already spread this dash.
  W.initVerbs = function (p) {
    p.holdOn = false; p.holdT = 0; p.holdTick = 0; p.pdT = 0; p.pdSet = null; p.pdRefT = 0; p.pdStrikeT = -99; p.backN = 0; p.backT = 0; p.behindT = -99;
    p.wasDash = false; p.dsX = 0; p.dsY = 0; p.disX = 0; p.disY = 0; p.dashRefT = 0; p.coldT = 0; p.wakeX = null; p.wakeY = 0; p.touchSet = null;
  };

  // ---------------- Burn stacks ----------------
  const burnV = (o) => C.BURN_K * o.stats.power * Math.max(0.1, o.stats.dmg); // a stack's damage per second before burnMul
  const ok = (e) => e.hp > 0 && !e.killed && !e.def.invuln && !e.burrowed;
  // Derived fields of e's stacks (e.bsT end times, e.bsO owners): burnN (count), burnPool (damage still to come before burnMul), burn (flag), smother (strongest Smother of a hero holding BURN_AT stacks), wildO (a Wildfire hero holding BURN_AT stacks).
  function burnSync(e, now) {
    const T = e.bsT, O = e.bsO, n = T ? T.length : 0;
    let pool = 0, sm = 0, wo = null;
    for (let i = 0; i < n; i++) {
      const o = O[i];
      pool += burnV(o) * Math.max(0, T[i] - now);
      let first = true, c = 0;
      for (let j = 0; j < n; j++) if (O[j] === o) { if (j < i) { first = false; break; } c++; }
      if (first && c >= C.BURN_AT) { if (o.stats.smother > sm) sm = o.stats.smother; if (!wo && o.stats.wildfire > 0) wo = o; }
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

  // Removes a share (0..1, at least one stack while any) of e's stacks, newest first; returns the damage they still held before burnMul (Rupture and Plaguebearer pay it at once).
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

  // ---------------- Charge ----------------
  // Charge of hero p on e (HP units): held CHARGE_HOLD + chargeHold s after the last gain, then fading (tickCharge). The last hero to add owns it. A dash discharges it (dashSweep).
  W.addCharge = function (e, amount, p) {
    if (!(amount > 0) || !ok(e)) return;
    e.charge += amount;
    if (p) { e.chargeOwner = p; e.chargeT = C.CHARGE_HOLD + p.stats.chargeHold; } else e.chargeT = Math.max(e.chargeT, C.CHARGE_HOLD);
  };
  W.tickCharge = function (e, dt) {
    if (!(e.charge > 0)) return;
    if (e.chargeT > 0) e.chargeT -= dt;
    else { e.charge *= Math.max(0, 1 - C.CHARGE_FADE * dt); if (e.charge < 0.5) e.charge = 0; }
  };

  // Discharge of e's charge by hero p: charge x mul x (1 + shockMul) as Lightning; Overload stuns; Conductor arcs to arcs uncharged foes within DIS_JUMP for ARC_MUL;
  // the discharge jumps (one chain hop later) to each foe within DIS_JUMP that p charged, jumps hops deep (default DIS_JUMPS). Returns the damage.
  W.discharge = function (e, p, mul, jumps) {
    const ch = e.charge;
    if (!(ch > 0) || e.hp <= 0 || !p) return 0;
    if (jumps === undefined) jumps = C.DIS_JUMPS;
    const own = this.openChain(), st = p.stats, k = mul > 0 ? mul : 1;
    e.charge = 0; e.chargeT = 0;
    const dmg = ch * k * (1 + st.shockMul), x = e.x, y = e.y;
    this.hitEnemy(e, dmg, { p, kind: 'chain', raw: true, noProc: true, crit: false, noGuard: true, el: 'lightning', x, y });
    this.emit({ t: 'chain', k: 'd', pts: [[R(x), R(y) - 24], [R(x), R(y)]] });
    if (st.arcStun && e.hp > 0) this.stunFoe(e, st.arcStun, true);
    const q = this.foeScan(x, y, C.DIS_JUMP), near = [];
    for (let i = 0; i < q.length; i++) {
      const o = q[i];
      if (o === e || !ok(o) || o.spawnT > 0) continue;
      const d2 = U.dist2(o.x, o.y, x, y);
      if (d2 < (C.DIS_JUMP + o.r) ** 2) near.push({ d2, o });
    }
    this.foeEnd();
    near.sort((a, b) => a.d2 - b.d2);
    let arcs = st.arcs | 0;
    for (const n of near) {
      const o = n.o;
      if (o.hp <= 0) continue;
      if (o.charge > 0 && o.chargeOwner === p) { if (jumps > 0) this.queuePayoff(p, { kind: 'dis', e: o, x, y, mul: k, jumps: jumps - 1 }); }
      else if (arcs > 0) {
        arcs--;
        this.emit({ t: 'chain', pts: [[R(x), R(y)], [R(o.x), R(o.y)]] });
        this.hitEnemy(o, dmg * C.ARC_MUL, { p, kind: 'chain', raw: true, noProc: true, crit: false, el: 'lightning', x, y });
        if (st.arcStun && o.hp > 0) this.stunFoe(o, st.arcStun, true);
      }
    }
    if (own) this.curChain = null;
    return dmg;
  };

  // ---------------- dash ----------------
  // Called from playerDash: the dash starts (blink: the client blinked behind a foe with Umbral Arms; ox, oy: where it began, accepted within 260 px). Toxic cloud, decoy, Umbral Step, the swept path and the dodge set reset.
  W.onDashVerbs = function (p, blink, ox, oy) {
    const st = p.stats, near = Number.isFinite(ox) && Number.isFinite(oy) && U.dist2(ox, oy, p.x, p.y) < 260 * 260, x = near ? ox : p.x, y = near ? oy : p.y;
    p.pdSet = null; p.touchSet = null; p.dsX = x; p.dsY = y; p.disX = x; p.disY = y;
    if (st.dashBack) { p.backN = st.dashBack; p.backT = C.BACK_T; }
    if (st.dashCloud) this.toxicCloud(p, x, y, C.CLOUD_R, C.CLOUD_T, C.CLOUD_V);
    if (st.decoy) this.spawnDecoy(p, x, y);
    if (st.stepBehind && blink) p.behindT = this.time + C.BEHIND_T;
  };

  // A toxic cloud of hero p at (x, y): radius r and length dur grown by Miasma, v Venom per 0.5 s tick to every foe in it (zone kind plague, no damage).
  W.toxicCloud = function (p, x, y, r, dur, v) {
    const st = p.stats;
    return this.addZone({ kind: 'plague', x, y, r: r * (1 + st.cloudR), dur: dur + st.cloudT, dps: 0, venom: v, owner: p.pid, team: 0 });
  };

  // Phantom Step: a decoy (zone kind decoy, tag w 3) where the dash started; non-boss foes within DECOY_R go for it (a position-only stand-in) for DECOY_T s.
  W.spawnDecoy = function (p, x, y) {
    const stand = { x, y, vx: 0, vy: 0, decoy: true };
    this.addZone({ kind: 'decoy', x, y, r: 14, dur: C.DECOY_T, team: 0, owner: p.pid, custom: true, w: 3,
      update: (w) => {
        for (const e of w.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.boss || e.def.invuln) continue;
          if (e.target === stand) { e.tgtT = Math.max(e.tgtT, 0.25); continue; }
          if (U.dist2(e.x, e.y, x, y) < C.DECOY_R * C.DECOY_R) { e.target = stand; e.tgtT = 0.3; }
        }
      },
      onEnd: (w) => { for (const e of w.enemies) if (e.target === stand) e.tgtT = 0; } });
  };

  // Every tick of a dashing hero (updateVerbs): the path swept since the last tick discharges p's charged foes within DIS_R (not the ones this dash's Thunderstep just struck); Firewalk spreads Burn from foes it touches.
  W.dashSweep = function (p) {
    const st = p.stats, x0 = p.disX, y0 = p.disY, x1 = p.x, y1 = p.y;
    p.disX = x1; p.disY = y1;
    const fire = st.firewalk > 0, R0 = Math.max(C.DIS_R, p.r + 30), q = this.foeScan((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + R0), dis = [], walk = [];
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (!ok(e) || e.spawnT > 0) continue;
      const d2 = U.segDist2(e.x, e.y, x0, y0, x1, y1);
      if (e.charge > 0 && e.chargeOwner === p && d2 < (C.DIS_R + e.r) ** 2 && !(p.dashHit && p.dashHit.has(e.id))) dis.push(e);
      if (fire && e.burnN > 0 && d2 < (p.r + e.r + 8) ** 2 && !(p.touchSet && p.touchSet.has(e.id))) { (p.touchSet || (p.touchSet = new Set())).add(e.id); walk.push(e); }
    }
    this.foeEnd();
    for (const e of walk) this.firewalk(p, e); // after the scan: a foe lit by this sweep's copy does not copy back
    const jumps = C.DIS_JUMPS + (st.evo === 'lightning' ? C.TEMPEST_JUMPS : 0);
    for (const e of dis) if (e.hp > 0 && this.discharge(e, p, C.DIS_K, jumps) > 0 && st.evo === 'lightning' && this.time >= p.dashRefT) { p.dashRefT = this.time + C.TEMPEST_CD; this.msgs.push({ to: p.pid, t: 'dashRefund' }); }
  };

  // Firewalk: e's Burn stacks (up to firewalk) are copied to every foe within FIREWALK_R of it.
  W.firewalk = function (p, e) {
    const q = this.foeScan(e.x, e.y, C.FIREWALK_R), to = [];
    for (let k = 0; k < q.length; k++) { const o = q[k]; if (o !== e && ok(o) && o.spawnT <= 0 && U.dist2(o.x, o.y, e.x, e.y) < (C.FIREWALK_R + o.r) ** 2) to.push(o); }
    this.foeEnd();
    for (const o of to) { this.copyBurn(e, o, 1, p.stats.firewalk, false); this.emit({ t: 'chain', k: 'f', pts: [[R(e.x), R(e.y - 6)], [R(o.x), R(o.y - 6)]] }); }
  };

  // The dash ended: the perfect dodge window opens (pdWin s); Glacier Step raises its wall along the dash (a solid segment zone: world.js pushSolids keeps foes out, solidStops breaks foe shots).
  W.dashEnd = function (p) {
    const st = p.stats;
    p.pdT = st.perfectDodge ? st.pdWin : 0;
    if (st.iceWall) {
      const len = Math.hypot(p.x - p.dsX, p.y - p.dsY);
      if (len >= 16) this.addZone({ kind: 'icewall', x: p.dsX, y: p.dsY, a: Math.atan2(p.y - p.dsY, p.x - p.dsX), len, w: C.WALL_W, r: 0, dur: C.WALL_T, team: 0, owner: p.pid, custom: true, solid: true });
    }
  };

  // ---------------- Holy: perfect dodges ----------------
  // A foe attack on hero p negated by the dash (or its window, or the guard): src.e attacked (a hazard, a dead foe or plain body contact outside a full-contact state is no attack). Smites the attacker for its Radiance + pdPow x Power and shields the dodger
  // (PD_SHIELD, the Holy window), once per attacker per dash; Swift Grace returns the dash charge, Divine Riposte readies its strike. Returns whether the attack counts as dodged (one already dodged this dash does too).
  W.perfectDodge = function (p, src) {
    const st = p.stats, e = src.e;
    if (!st.perfectDodge || !e || !e.def || e.hp <= 0 || src.hazard || (src.contact && !src.full)) return false;
    if (!p.pdSet) p.pdSet = new Set();
    if (p.pdSet.has(e.id)) return true;
    p.pdSet.add(e.id);
    const amt = (e.rad || 0) + st.pdPow * st.power;
    e.rad = 0;
    const own = this.openChain();
    this.smite(e, p, amt);
    if (own) this.curChain = null;
    this.addShield(p, p.maxHp * C.PD_SHIELD, p.maxHp * st.holyCap, 'holy');
    this.emit({ t: 'pdodge', pid: p.pid, x: R(p.x), y: R(p.y) });
    if (st.pdRefund && this.time >= p.pdRefT) { p.pdRefT = this.time + C.PD_REFUND_CD; this.msgs.push({ to: p.pid, t: 'dashRefund' }); }
    if (st.pdStrike) p.pdStrikeT = this.time + C.PD_STRIKE_T;
    return true;
  };
  // True when hero p guards (Hallowed Arms hold; a Bellwarden: p.bellGuard) and (x, y) lies within GUARD_ARC of its facing.
  W.guardFront = function (p, x, y) {
    return !!((p.holdOn && p.stats.hold === 'guard') || p.bellGuard) && Math.abs(U.angDiff(p.face || 0, Math.atan2(y - p.y, x - p.x))) <= C.GUARD_ARC / 2;
  };
  // A foe shot reflected by the guard: it flies back toward its shooter as a Holy hero shot at GUARD_MUL x weapon damage.
  W.reflectShot = function (p, pr) {
    const s = pr.src, a = s && s.hp > 0 ? Math.atan2(s.y - p.y, s.x - p.x) : Math.atan2(-pr.vy, -pr.vx), sp = Math.max(300, Math.hypot(pr.vx, pr.vy));
    this.spawnProj({ team: 0, kind: 'holy', x: p.x + Math.cos(a) * 12, y: p.y - 4 + Math.sin(a) * 12, a, speed: sp, r: 6, dmg: p.stats.weapon.dmg * C.GUARD_MUL, life: 1.2, pierce: 0, owner: p.pid, hk: 'evo', knock: 60, el: 'holy' });
    this.emit({ t: 'block', x: R(p.x), y: R(p.y), k: 'guard' });
  };

  // ---------------- Shadow: Backstabs ----------------
  // A hit of hero p on e (origin src.x/y, else the hero) is a Backstab when: it is a minion's, Umbral Step has one left, the foe is stunned, frozen or blinded, it targets something else, or the hit comes from more than BACK_ARC off its facing.
  W.isBackstab = function (e, p, src) {
    if (src.kind === 'minion') return true;
    if (p.backN > 0 && p.backT > 0) { p.backN--; return true; }
    if (e.stun > 0 || e.frozen > 0 || e.blind > 0 || e.target !== p) return true;
    const ox = src.x !== undefined ? src.x : p.x, oy = src.y !== undefined ? src.y : p.y;
    return Math.abs(U.angDiff(e.faceA || 0, Math.atan2(oy - e.y, ox - e.x))) > C.BACK_ARC;
  };
  // A foe's facing: toward its attack aim in an attack state, else toward its target; it turns at most FACE_TURN (bosses FACE_TURN_BOSS) rad/s.
  W.turnFoe = function (e, dt) {
    const t = e.target, busy = !e.boss && e.st !== 'move' && e.st !== 'idle';
    const want = busy ? e.aimA || 0 : t ? Math.atan2(t.y - e.y, t.x - e.x) : e.faceA;
    const turn = (e.boss ? C.FACE_TURN_BOSS : C.FACE_TURN) * dt;
    e.faceA = (e.faceA || 0) + U.clamp(U.angDiff(e.faceA || 0, want), -turn, turn);
  };

  // ---------------- per tick ----------------
  // Called from updatePlayerCombat for a living, standing hero: verb timers, the dash sweep and its end, the hold verb, Toxic Wake.
  W.updateVerbs = function (p, dt) {
    const st = p.stats;
    if (p.backT > 0 && (p.backT -= dt) <= 0) p.backN = 0;
    if (p.pdT > 0) p.pdT -= dt;
    if (p.dashing) { this.dashSweep(p); p.wasDash = true; }
    else if (p.wasDash) { p.wasDash = false; this.dashEnd(p); }
    if (p.holdOn) this.tickHold(p, dt);
    if (st.toxicWake && !p.dashing) {
      if (p.wakeX === null || U.dist2(p.x, p.y, p.wakeX, p.wakeY) > 400 * 400) { p.wakeX = p.x; p.wakeY = p.y; }
      else if (U.dist2(p.x, p.y, p.wakeX, p.wakeY) >= C.WAKE_STEP * C.WAKE_STEP) { p.wakeX = p.x; p.wakeY = p.y; this.toxicCloud(p, p.x, p.y, C.WAKE_R, C.WAKE_T, C.CLOUD_V * 0.5); }
    }
  };

  // ---------------- hold-attack verbs (stats.hold, St.HOLD) ----------------
  // on: the hold starts (the hero's client held attack St.HOLD[k].at s) or ends (release). a: the aim; d: the cursor distance on release (the flask lands there).
  W.playerHold = function (p, on, a, d) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, k = st.hold;
    if (!k || st.weapon.kind === 'bell') return; // a Bellwarden's hold winds the bell: its verb rides a full-wind hurl (bellHold)
    if (typeof a === 'number' && Number.isFinite(a)) p.face = a;
    if (on) {
      if (p.holdOn) return;
      p.holdOn = true; p.holdT = 0; p.holdTick = 0;
      if (k === 'guard') p.pdSet = null;
      this.emit({ t: 'hold', pid: p.pid, k, on: 1 });
      return;
    }
    if (!p.holdOn) return;
    p.holdOn = false;
    const full = St.holdFull(st), f = full > 0 ? Math.min(1, p.holdT / full) : 1;
    this.emit({ t: 'hold', pid: p.pid, k, on: 0 });
    if (k === 'lance') this.iceLance(p, p.face, Math.max(C.LANCE_MIN, f));
    else if (k === 'flask' && f >= 1) this.flask(p, p.face, d);
    else if (k === 'finisher' && f >= 1) this.playerAttack(p, p.face, 0, undefined, true);
  };

  // A tick of the held verb: the hold clock, the flame cone every CONE_TICK, the time limit of the cone and the guard.
  W.tickHold = function (p, dt) {
    const st = p.stats, k = st.hold, H = k && St.HOLD[k];
    if (!H) { p.holdOn = false; return; }
    p.holdT += dt;
    if (H.max > 0 && p.holdT >= H.max) { p.holdOn = false; this.emit({ t: 'hold', pid: p.pid, k, on: 0 }); return; }
    if (k === 'cone' && (p.holdTick -= dt) <= 0) { p.holdTick += C.CONE_TICK; this.flameCone(p); }
  };

  // Cinder Arms: one tick of the flame cone along the hero's facing: CONE_MUL of the attack's damage per second x CONE_TICK to every foe in it (direct weapon hits, no crit), Burn at CONE_BURN x.
  W.flameCone = function (p) {
    const st = p.stats, w = st.weapon, a = p.face || 0, area = 1 + st.area * 0.5;
    const range = w.kind === 'melee' ? w.range * (area + st.meleeReach) * C.CONE_REACH : C.CONE_RANGE * area;
    const dmg = w.dmg * Math.max(1, (w.n || 1) + st.projN) / St.attackInterval(p) * C.CONE_MUL * C.CONE_TICK, add = { fire: st.fireInfuse * (C.CONE_BURN - 1) };
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

  // Glacial Arms: an ice lance along a at charge f (LANCE_MIN..1): pierces every foe for LANCE_MUL x f x weapon damage and freezes non-boss foes it hits (spawnProj o.freeze).
  W.iceLance = function (p, a, f) {
    const w = p.stats.weapon;
    this.spawnProj({ team: 0, kind: 'iceshard', x: p.x + Math.cos(a) * 10, y: p.y - 4 + Math.sin(a) * 10, a, speed: C.LANCE_SPEED, r: 7, dmg: w.dmg * C.LANCE_MUL * f, life: C.LANCE_LEN / C.LANCE_SPEED, pierce: 99, owner: p.pid, hk: 'evo', knock: 80, el: 'ice', freeze: true });
    this.emit({ t: 'lance', pid: p.pid, x0: R(p.x), y0: R(p.y - 4), x1: R(p.x + Math.cos(a) * C.LANCE_LEN), y1: R(p.y - 4 + Math.sin(a) * C.LANCE_LEN), k: 1 });
  };

  // Venomous Arms: a flask lobbed along a to the cursor distance d (<= FLASK_MAX, cut at walls), landing 0.4 s later: FLASK_MUL x weapon damage as Poison within FLASK_R and a FLASK_T s toxic cloud building FLASK_V x Venom.
  W.flask = function (p, a, d) {
    const fin = Number.isFinite, dist = U.clamp(fin(d) ? d : fin(p.aimX) && fin(p.aimY) ? Math.hypot(p.aimX - p.x, p.aimY - p.y) : 160, 30, C.FLASK_MAX);
    const g = Sim.groundPoint(this.room, this.locked, p.x, p.y, p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist, C.FLASK_MAX, false);
    this.flaskAt(p, g.x, g.y, R(p.x), R(p.y - 10));
  };
  // The flask's landing at (x, y), lobbed from (lx, ly) (a friendly 'tele' zone with the lob arc).
  W.flaskAt = function (p, x, y, lx, ly) {
    const r = C.FLASK_R * (1 + p.stats.area * 0.5);
    this.addZone({ kind: 'tele', x, y, r, dur: 0.4, team: 0, owner: p.pid, custom: true, lob: [lx, ly], room: this.room,
      onEnd: (w, z) => {
        if (z.room !== w.room) return;
        const o = w.players.get(z.owner);
        if (!o) return;
        w.explode(z.x, z.y, r, o.stats.weapon.dmg * C.FLASK_MUL, 0, o, 'acid', false, { kind: 'evo', el: 'poison' });
        w.toxicCloud(o, z.x, z.y, r, C.FLASK_T, C.CLOUD_V * C.FLASK_V);
      } });
  };

  // A Bellwarden's hold verb on a full-wind hurl landing at (x, y) within radius r: the flame cone bursts (CONE_BURN stacks), the lance freezes non-boss foes, the flask leaves its cloud; the finisher and the guard ride the hurl itself (class-bell.js).
  W.bellHold = function (p, x, y, r) {
    const k = p.stats.hold;
    if (k === 'flask') { this.toxicCloud(p, x, y, C.FLASK_R * (1 + p.stats.area * 0.5), C.FLASK_T, C.CLOUD_V * C.FLASK_V); return; }
    if (k !== 'cone' && k !== 'lance') return;
    const q = this.foeScan(x, y, r), list = [];
    for (let i = 0; i < q.length; i++) { const e = q[i]; if (ok(e) && e.spawnT <= 0 && U.dist2(e.x, e.y, x, y) < (r + e.r) ** 2) list.push(e); }
    this.foeEnd();
    for (const e of list) { if (k === 'cone') { for (let i = 0; i < C.CONE_BURN; i++) this.burnStack(e, p, 0, true); this.burnSync(e); } else if (!e.boss) this.freezeEnemy(e, p); }
  };

  // ---------------- client-side dash blinks (pure: the client moves its own hero, the host takes the reported spot) ----------------
  // Where a dash along (dx, dy) of hero p with stats st blinks first, or null: Umbral Arms behind the nearest foe within BEHIND_R and BEHIND_CONE of the aim a ({ behind: true }: the dash is spent there);
  // Storm Step to the near side of the charged foe (e.charge > 0 or e.charged) nearest the aim within STORM_R and STORM_CONE. foes: the foes the client sees; walls cut the blink (no blink through them).
  Sim.dashBlink = (room, locked, p, st, foes, a) => {
    if (!st.stormStep && !st.stepBehind) return null;
    const pick = (cone, rMax, want) => {
      let best = null, bd = Infinity;
      for (const e of foes) {
        if (!(e.hp > 0) || e.spawnT > 0 || (e.def && e.def.invuln) || e.burrowed || !want(e)) continue;
        const ex = e.x - p.x, ey = e.y - p.y, d = Math.hypot(ex, ey);
        if (d > rMax || d < 1 || Math.abs(U.angDiff(a, Math.atan2(ey, ex))) > cone) continue;
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    };
    const reach = (x, y) => { // castMove walks 8 px steps: an end within 10 px of the spot is a free path; the spot itself is resolved out of solids
      const d = Math.hypot(x - p.x, y - p.y), end = Sim.castMove(room, p.x, p.y, Math.atan2(y - p.y, x - p.x), d, p.r, locked);
      if (Math.hypot(end.x - p.x, end.y - p.y) < d - 10) return null;
      const q = { x, y, r: p.r }; Sim.resolve(q, room, locked, false); return q;
    };
    if (st.stepBehind) {
      const e = pick(C.BEHIND_CONE, C.BEHIND_R, () => true);
      if (e) {
        const d = Math.hypot(e.x - p.x, e.y - p.y), ux = (e.x - p.x) / d, uy = (e.y - p.y) / d, k = e.r + p.r + 6, end = reach(e.x + ux * k, e.y + uy * k);
        if (end) return { x: end.x, y: end.y, face: Math.atan2(-uy, -ux), behind: true };
      }
    }
    if (st.stormStep) {
      const e = pick(C.STORM_CONE, C.STORM_R, (f) => f.charge > 0 || !!f.charged);
      if (e) {
        const d = Math.hypot(e.x - p.x, e.y - p.y), ux = (e.x - p.x) / d, uy = (e.y - p.y) / d, k = e.r + p.r + 4, end = reach(e.x - ux * k, e.y - uy * k);
        if (end) return { x: end.x, y: end.y, dx: ux, dy: uy };
      }
    }
    return null;
  };
})(globalThis.ED || (globalThis.ED = {}));
