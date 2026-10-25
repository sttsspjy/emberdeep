// Knight: Shield Charge (a contact sweep at CHARGE_SPEED), Bulwark (a held shield that blocks frontal attacks, then bashes a cone) and the Knight route cards that act on them.
// Cleave, Parry, Brace, Brand and the shared engines live in combat.js; this file owns the two skills and the Knight hook table ED.CLS.knight.
// Skill forms (rank 3): Avalanche (carry + slam + cracks), Iron Phalanx (wide band + War Banner), Aegis Tempest (a vortex at the bash tip), Bastion (a longer hold that shields).
// Route forms (rank 3): Earthsplitter (a fissure per Cleave), Thousand Edges (blade waves per Cleave), Doombrand (Mark at 4 ailments, Brand counts 6), Bloodquake (a strike detonates the Bleed pool); they run through the hook table at the end.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, Sim = ED.Sim, C = ED.CONST;
  const W = ED.World.prototype;
  const fin = (v) => typeof v === 'number' && isFinite(v);

  // CARRY_STEP: px per tick a carried foe moves toward the front of the Charge. PHALANX_HALF: half width of the Iron Phalanx band.
  const CARRY_STEP = 30, PHALANX_HALF = 35;

  // ---------------- Shield Charge ----------------
  // Cast: stores the path (origin accepted within 48 px of the host's hero, length clamped to the skill's range and clipped at walls), makes the hero untouchable for the run, starts Brace (Vanguard) and lowers a raised Bulwark (no bash).
  ED.CAST.charge = function (p, a, data, st, N) {
    let x0 = p.x, y0 = p.y;
    if (fin(data.x0) && fin(data.y0) && U.dist2(data.x0, data.y0, p.x, p.y) <= 48 * 48) { x0 = data.x0; y0 = data.y0; }
    let len = fin(data.x1) && fin(data.y1) ? Math.hypot(data.x1 - x0, data.y1 - y0) : N.range;
    len = U.clamp(len, 1, N.range);
    const end = Sim.castMove(this.room, x0, y0, a, len, p.r, this.locked);
    len = Math.max(1, Math.hypot(end.x - x0, end.y - y0));
    p.charge = { x0, y0, x1: end.x, y1: end.y, a, t0: this.time, len, s: 0, hit: new Set(), carry: st.avalanche > 0 ? [] : null };
    p.invuln = Math.max(p.invuln, len / C.CHARGE_SPEED + 0.1);
    if (st.brace && this.time >= p.braceAt + C.BRACE_CD) { p.braceT = st.brace; p.braceAt = this.time; }
    this.clearShields(p);
    return { tx: Math.round(end.x), ty: Math.round(end.y) };
  };

  // Each tick the sweep covers the path from where it was to where the hero is by now: foes within their radius + the part's reach take the impact once (Crush on shield-stunned foes, bosses take its bossMul), then the stun (a boss is never stunned).
  // Avalanche carries the non-elite foes it hits along with the front of the run (elites are knocked sideways, bosses stand); Iron Phalanx widens the band and destroys enemy shots in it.
  // At the end of the path: Juggernaut's shockwave or Avalanche's slam and cracks, Iron Phalanx's War Banner, Shield Bash's free bash along the run, Rallying Charge's shields, and Follow-Through's Cleave.
  W.updateCharge = function (p, dt) {
    const c = p.charge, st = p.stats, N = ED.Stats.skillNums('charge', st), q = N.p.impact;
    const s0 = c.s, s1 = Math.min(c.len, (this.time - c.t0) * C.CHARGE_SPEED), ca = Math.cos(c.a), sa = Math.sin(c.a);
    c.s = s1;
    const ax = c.x0 + ca * s0, ay = c.y0 + sa * s0, bx = c.x0 + ca * s1, by = c.y0 + sa * s1, reach = st.phalanx > 0 ? PHALANX_HALF : q.reach;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || c.hit.has(e.id)) continue;
      if (U.segDist2(e.x, e.y, ax, ay, bx, by) >= (e.r + reach) ** 2) continue;
      c.hit.add(e.id);
      const o = { kx: ca, ky: sa, mul: e.shieldStunT > 0 ? 1 + C.CRUSH : undefined, infK: 1 + st.ruinInf }, lat = (e.x - c.x0) * -sa + (e.y - c.y0) * ca;
      if (c.carry && e.elite) { const side = lat < 0 ? -1 : 1; o.kx = -sa * side; o.ky = ca * side; } // Avalanche: an elite is knocked aside, not carried
      this.hitEnemy(e, q.dmg, this.partSrc(p, N, 'impact', o));
      if (c.carry && !e.boss && !e.elite) { e.kbx = 0; e.kby = 0; if (e.hp > 0) c.carry.push({ e, lat: U.clamp(lat, -reach, reach) }); }
      if (e.hp > 0) {
        this.stunFoe(e, q.stun + st.chargeStun, false);
        if (st.seal) e.sealT = Math.max(e.sealT, st.seal);
      }
    }
    this.smashSeg(p, ax, ay, bx, by, reach);
    if (c.carry) carryFoes(this, p, c, bx, by, ca, sa);
    if (st.phalanx > 0) {
      for (const o of this.projs) {
        if (o.team !== 1 || o.life <= 0 || U.segDist2(o.x, o.y, ax, ay, bx, by) >= (PHALANX_HALF + o.r) ** 2) continue;
        o.life = 0;
        this.emit({ t: 'deflect', x: Math.round(o.x), y: Math.round(o.y) });
      }
    }
    if (s1 < c.len) return;
    p.charge = null;
    const sh = N.p.shock;
    if (sh.on) this.explode(c.x1, c.y1, sh.r, sh.dmg, 0, p, 'shock', true, { part: 'charge.shock', knock: sh.knock });
    if (N.p.quake.on) avalanche(this, p, c, N, st);
    if (st.phalanx > 0) plantBanner(this, p, c, N, st);
    if (st.bash) bash(this, p, c.a, true, c.x1, c.y1);
    if (st.rally) {
      if (p.kWardT <= 0 && this.addShield(p, st.rally * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class') > 0) p.kWardT = C.KWARD_CD;
      for (const q2 of this.players.values()) {
        if (q2 === p || q2.downed || q2.dead || q2.rallyT > 0 || U.dist2(q2.x, q2.y, c.x1, c.y1) > 100 * 100) continue;
        if (this.addShield(q2, st.rally * q2.maxHp, C.CLASS_SHIELD_CAP * q2.maxHp, 'class') > 0) q2.rallyT = 8;
      }
      this.emit({ t: 'ward', x: Math.round(c.x1), y: Math.round(c.y1) });
    }
    if (st.chargeCleave) p.cleaveNext = this.time + 1.5;
  };

  // Avalanche: every foe carried by the run keeps to the front of the hero, spread across the band by the offset it was struck at.
  function carryFoes(w, p, c, bx, by, ca, sa) {
    let k = 0;
    for (let i = 0; i < c.carry.length; i++) {
      const m = c.carry[i], e = m.e;
      if (e.hp <= 0 || e.killed) continue;
      c.carry[k++] = m;
      const ahead = p.r + e.r + 4, dx = bx + ca * ahead - sa * m.lat - e.x, dy = by + sa * ahead + ca * m.lat - e.y, d = Math.hypot(dx, dy);
      if (d > 1) { const step = Math.min(d, CARRY_STEP); Sim.moveCircle(e, dx / d * step, dy / d * step, w.room, w.locked, e.fly); }
      e.kbx = 0; e.kby = 0;
    }
    c.carry.length = k;
  }

  // Avalanche slam at the end of the run: a hit of the quake part on every foe in its circle (bosses take its bossMul and are never stunned), then 3 cracks run outward (clipped at walls)
  // and erupt after their delay on the foes along them; a foe is struck by at most one crack.
  function avalanche(w, p, c, N, st) {
    const q = N.p.quake, k = N.p.crack, x = c.x1, y = c.y1, infK = 1 + st.ruinInf, pid = p.pid, struck = new Set();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d >= q.r + e.r) continue;
      w.hitEnemy(e, q.dmg, w.partSrc(p, N, 'quake', { kx: (e.x - x) / (d || 1), ky: (e.y - y) / (d || 1), x, y, crit: false, noGuard: true, infK }));
      if (e.hp > 0 && !e.boss) w.stunFoe(e, q.stun, false);
    }
    w.emit({ t: 'quake', x: Math.round(x), y: Math.round(y), r: Math.round(q.r), pid });
    for (let i = 0; i < k.n; i++) {
      const ang = c.a + i * U.TAU / k.n, end = Sim.castMove(w.room, x, y, ang, k.len, 4, w.locked), len = Math.hypot(end.x - x, end.y - y);
      if (len < 12) continue;
      w.addZone({ kind: 'crack', x, y, a: ang, len, w: k.w, dur: k.delay, team: 0, owner: pid, custom: true,
        onEnd: (world, z) => {
          const ow = world.players.get(pid);
          if (!ow) return;
          const cs = Math.cos(z.a), sn = Math.sin(z.a), x1 = z.x + cs * z.len, y1 = z.y + sn * z.len;
          for (const e of world.enemies) {
            if (e.hp <= 0 || e.spawnT > 0 || struck.has(e.id) || U.segDist2(e.x, e.y, z.x, z.y, x1, y1) >= (z.w / 2 + e.r) ** 2) continue;
            struck.add(e.id);
            world.hitEnemy(e, k.dmg, world.partSrc(ow, N, 'crack', { kx: cs, ky: sn, x: z.x, y: z.y, crit: false, noGuard: true, infK }));
          }
          world.emit({ t: 'crack', x: Math.round(z.x), y: Math.round(z.y), a: Math.round(z.a * 100) / 100, len: Math.round(z.len), pid });
        } });
    }
  }

  // Iron Phalanx: where the run ends a 0.4 s stun pulse and a War Banner. The banner is a 'sanct' zone (w 7) so hurtPlayer's damage reduction (the owner's Brace, at most 40%) covers every hero inside;
  // each tick foes inside are slowed and weakened (bosses half as much), and every 0.5 s they take half of the banner part's damage per second (a zone tick: no crit, no procs).
  function plantBanner(w, p, c, N, st) {
    const q = N.p.banner, x = c.x1, y = c.y1, pid = p.pid;
    for (const e of w.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, x, y) < (q.r + e.r) ** 2) w.stunFoe(e, q.stun, false);
    w.emit({ t: 'banner', x: Math.round(x), y: Math.round(y), r: Math.round(q.r), pid });
    w.addZone({ kind: 'sanct', w: 7, x, y, r: q.r, dur: q.dur, dr: Math.min(0.4, st.braceDR), team: 0, owner: pid, custom: true, ticks: 0,
      update: (world, z) => {
        const ow = world.players.get(pid), sl = ow ? ow.stats.bannerSlow : st.bannerSlow, wk = ow ? ow.stats.bannerWeak : st.bannerWeak;
        const tick = z.t >= 0.5 * (z.ticks + 1) - 1e-9, dmg = tick && ow ? ED.Stats.skillNums('charge', ow.stats).p.banner.dmg * 0.5 : 0;
        if (tick) z.ticks++;
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          const v = e.boss ? wk / 2 : wk;
          world.slowEnemy(e, e.boss ? sl / 2 : sl, 0.3);
          if (!(e.weakT > 0) || v > e.weakV) e.weakV = v;
          e.weakT = Math.max(e.weakT, 0.3);
          if (dmg > 0) world.hitEnemy(e, dmg, { p: ow, kind: 'dot', noProc: true, crit: false, part: 'charge.banner', zone: true });
        }
      } });
  }

  // ---------------- Bulwark ----------------
  // BW_ARC / WALL_ARC: arc (rad) the raised shield covers (Shield Wall: WALL_ARC); BW_SEEN: seconds within which one foe's melee and contact hits count as one block; BW_NEAR: an attack whose origin lies this close to the hero is placed at its attacker; BW_RECOIL: seconds a foe whose body hit was blocked backs away.
  // BW_WARD: Bastion's shield per raise at most (share of max HP); RET_SPEED: px/s of a shot Return to Sender sends back; CARRY_R / CARRY_N: reach and receivers of Ruinous Blows' spread from each struck foe.
  const BW_ARC = 120 * Math.PI / 180, WALL_ARC = Math.PI, BW_SEEN = 0.6, BW_NEAR = 16, BW_RECOIL = 0.35, BW_WARD = 0.02, RET_SPEED = 460, CARRY_R = 60, CARRY_N = 2;
  const R = Math.round, r2 = (v) => Math.round(v * 100) / 100;

  // The press: raises the shield toward a (rejected while it is up). The release (W.skillRelease), the hold limit (skillNums hold, Bastion's longer) or the tick at that limit bashes; p.face aims the block and the bash.
  ED.CAST.bulwark = function (p, a) {
    if (p.bulwarkOn) return false;
    lower(p);
    p.bulwarkOn = true; p.face = a;
    return {};
  };

  // Ends a raise with no bash and clears its state.
  function lower(p) { p.bulwarkOn = false; p.bulwarkT = 0; p.blocks = 0; p.blockSeen.clear(); p.bwWard = -1; }

  // Ends a raised Bulwark with no bash: a down or a room change (world.js), a Shield Charge cast.
  W.clearShields = function (p) { if (p.bulwarkOn) lower(p); };

  // The bash from (x, y) toward a: every foe in the cone (the part's r and arc) takes the bash part x (1 + blockMul x the blocks stored) and its knockback; a struck foe left standing is stunned (not a boss, not a guarded hit; shieldStunT marks it for Crush)
  // and sealed (Ruin Seal); Ruinous Blows moves carry of each struck foe's statuses to the CARRY_N nearest unstruck foes within CARRY_R; Aegis Tempest opens its vortex at the tip.
  // free: Shield Bash at the end of a Charge (part 'charge.bash', bash x the part, no stored power, no stun, no vortex); a full bash (blocks at blockMax) tags its hits full.
  function bash(w, p, a, free, x, y) {
    const st = p.stats, N = ED.Stats.skillNums('bulwark', st), q = N.p.bash, n = free ? 0 : p.blocks, full = !free && n >= N.blockMax;
    const mul = free ? st.bash : 1 + N.blockMul * n, half = q.arc / 2, struck = [];
    if (!free) lower(p);
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d >= q.r + e.r) continue;
      const ea = Math.atan2(e.y - y, e.x - x);
      if (d > e.r && Math.abs(U.angDiff(a, ea)) > half + Math.asin(Math.min(1, e.r / d))) continue;
      const src = w.partSrc(p, N, 'bash', { kx: Math.cos(ea), ky: Math.sin(ea), x, y, mul: mul === 1 ? undefined : mul, infK: 1 + st.ruinInf, full });
      if (free) src.part = 'charge.bash';
      w.hitEnemy(e, q.dmg, src);
      if (e.hp <= 0) continue;
      struck.push(e);
      if (!free && !src.guarded) { const dur = w.stunFoe(e, q.stun, false); if (dur > 0) e.shieldStunT = dur; }
      if (st.seal) e.sealT = Math.max(e.sealT, st.seal);
    }
    if (st.carry > 0 && struck.length) {
      const hit = new Set(struck);
      for (const e of struck) {
        const near = [];
        for (const o of w.enemies) { if (hit.has(o) || o.hp <= 0 || o.spawnT > 0) continue; const d2 = U.dist2(o.x, o.y, e.x, e.y); if (d2 < (CARRY_R + o.r) ** 2) near.push({ o, d2 }); }
        near.sort((u, v) => u.d2 - v.d2 || u.o.id - v.o.id);
        for (let i = 0; i < CARRY_N && i < near.length; i++) w.moveStatuses(e, near[i].o, st.carry);
      }
    }
    w.smashCircle(p, x + Math.cos(a) * q.r * 0.5, y + Math.sin(a) * q.r * 0.5, q.r * 0.5);
    if (!free && N.p.vortex.on) { const tip = Sim.castMove(w.room, x, y, a, q.r, 4, w.locked); vortex(w, p, tip.x, tip.y, Math.max(1, n)); }
    w.emit({ t: 'bash', pid: p.pid, x: R(x), y: R(y), a: r2(a), r: R(q.r), arc: r2(q.arc), n, f: free ? 1 : 0 });
  }

  // Aegis Tempest: a 'vortex' zone at (x, y) for the vortex part's duration; it pulls non-boss foes toward its centre at the part's pull px/s and strikes every foe inside each `every` s for the part's damage x k (the blocks the bash stored, at least 1).
  function vortex(w, p, x, y, k) {
    const q = ED.Stats.skillNums('bulwark', p.stats).p.vortex, pid = p.pid;
    w.addZone({ kind: 'vortex', x, y, r: q.r, dur: q.dur, warm: 0, team: 0, owner: pid, custom: true, acc: 0,
      update: (world, z, dt) => {
        const ow = world.players.get(pid);
        if (!ow) { z.dur = z.t; return; }
        const N = ED.Stats.skillNums('bulwark', ow.stats), v = N.p.vortex, hitNow = (z.acc += dt) >= v.every - 1e-9;
        if (hitNow) z.acc -= v.every;
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0) continue;
          const dx = z.x - e.x, dy = z.y - e.y, d2 = dx * dx + dy * dy;
          if (d2 >= (z.r + e.r) ** 2) continue;
          const d = Math.sqrt(d2);
          if (hitNow) world.hitEnemy(e, v.dmg * k, world.partSrc(ow, N, 'vortex', { x: z.x, y: z.y, kx: -dx / (d || 1), ky: -dy / (d || 1), noGuard: true, infK: 1 + ow.stats.ruinInf }));
          if (!e.boss && e.hp > 0 && d > 6) { const stp = Math.min(d - 4, v.pull * dt); Sim.moveCircle(e, dx / d * stp, dy / d * stp, world.room, world.locked, e.fly); }
        }
      } });
  }

  // True when p's raised shield stops the foe attack src: its origin (a moving shot: back along its flight; else src.x/y, else its foe; an origin within BW_NEAR of the hero is placed at the attacker) lies within the covered arc of p.face. Hazards are never blocked.
  // Every shot counts; one foe's melee and contact hits count once per BW_SEEN (its contact clock is pushed back as well). A counted block stores power (up to blockMax), Shield Wall stuns the attacker (a repeating stun),
  // Return to Sender sends a blocked shot back at its shooter, Bastion shields the hero.
  function block(w, p, src) {
    if (!p.bulwarkOn || !src || src.hazard) return false;
    const e = src.e && src.e.def ? src.e : null, pr = src.pr || null, st = p.stats;
    let ox, oy;
    if (pr && (pr.vx || pr.vy)) { ox = p.x - pr.vx; oy = p.y - pr.vy; } // a shot comes from where it flies from
    else if (fin(src.x) && fin(src.y)) { ox = src.x; oy = src.y; } else if (pr) { ox = pr.x; oy = pr.y; } else if (e) { ox = e.x; oy = e.y; } else return false;
    if (U.dist2(ox, oy, p.x, p.y) < BW_NEAR * BW_NEAR) { if (!e) return false; ox = e.x; oy = e.y; }
    if (Math.abs(U.angDiff(p.face || 0, Math.atan2(oy - p.y, ox - p.x))) > (st.shieldWall > 0 ? WALL_ARC : BW_ARC) / 2) return false;
    if (!pr && !src.proj && e) {
      e.contactCd = Math.max(e.contactCd || 0, BW_SEEN);
      if (src.contact) e.recoil = Math.max(e.recoil || 0, BW_RECOIL); // a body blocked by the shield backs off instead of walking through
      if ((p.blockSeen.get(e.id) || -1) > w.time) return true;
      p.blockSeen.set(e.id, w.time + BW_SEEN);
    }
    const N = ED.Stats.skillNums('bulwark', st);
    if (p.blocks < N.blockMax) p.blocks++;
    if (st.wallStun > 0 && e && e.hp > 0) w.stunFoe(e, st.wallStun, true);
    if (st.sendBack > 0 && pr && e && e.hp > 0) sendBack(w, p, e, N);
    if (st.bastionWard > 0) ward(w, p, st);
    w.emit({ t: 'block', k: 'bulwark', pid: p.pid, x: R(p.x), y: R(p.y), n: p.blocks });
    return true;
  }

  // Return to Sender: a shard flies from the shield at the shooter for the reflect part (a hero shot: it can crit and builds statuses).
  function sendBack(w, p, e, N) {
    const a = Math.atan2(e.y - p.y, e.x - p.x), d = Math.hypot(e.x - p.x, e.y - p.y);
    w.spawnProj({ team: 0, kind: 'shard', x: p.x + Math.cos(a) * 12, y: p.y - 4 + Math.sin(a) * 12, a, speed: RET_SPEED, r: 5, dmg: N.p.reflect.dmg, life: Math.min(1.5, d / RET_SPEED + 0.25), pierce: 0, owner: p.pid, knock: 60, hk: 'skill', part: 'bulwark.reflect' });
  }

  // Bastion: each block shields the hero bastionWard of max HP, at most BW_WARD per raise (class window); a raise shields only when the self-shield clock kWardT (KWARD_CD) had run out at its first block.
  function ward(w, p, st) {
    if (p.bwWard < 0) { if (p.kWardT > 0) return; p.bwWard = 0; p.kWardT = C.KWARD_CD; }
    const v = Math.min(st.bastionWard, BW_WARD - p.bwWard);
    if (!(v > 1e-9)) return;
    p.bwWard += v;
    w.addShield(p, v * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class');
  }

  // ---------------- route forms: Earthsplitter, Thousand Edges, Doombrand, Bloodquake ----------------
  // Fodder: these only damage, spread statuses and mark; none grants a refund, a shield or a stack, so a fodder foe takes part like any other.
  // FISSURE_*: reach, width and delay of an Earthsplitter fissure. BLADE_*: reach, half width and speed of a Thousand Edges wave; FAN: angle between the waves of a Parry fan.
  // DOOM_AT / DOOM_T / DOOM_EVERY: ailments that Doombrand a foe, seconds it stays Marked, seconds between scans. BQUAKE_AT / BQUAKE_R / BQUAKE_CD: ailments, burst radius and per-foe cooldown of Bloodquake.
  const FISSURE_LEN = 180, FISSURE_W = 36, FISSURE_T = 0.25, BLADE_LEN = 180, BLADE_R = 12, BLADE_SPEED = 480, FAN = 0.35;
  const DOOM_AT = 4, DOOM_T = 4, DOOM_EVERY = 0.1, BQUAKE_AT = 3, BQUAKE_R = 80, BQUAKE_CD = 1;
  const BQUAKE_PARTS = new Set(['charge.impact', 'bulwark.bash', 'charge.bash']), BASH_PARTS = new Set(['bulwark.bash', 'charge.bash']);

  // True when the attack whose events began at w.fx[p.fx0] swung a Cleave (meleeSwing emits one 'swing' event with k 'cleave' per Cleave).
  function cleaved(w, p) {
    for (let i = p.fx0; i < w.fx.length; i++) { const ev = w.fx[i]; if (ev.t === 'swing' && ev.k === 'cleave' && ev.pid === p.pid) return true; }
    return false;
  }

  // Earthsplitter: a 'crack' zone (arc 1 marks the fissure look) from the hero along a, clipped at walls (castMove walks in 8 px steps, so it looks 4 px past the reach); when it ends every foe on it takes `fissure` x the weapon damage once and a repeating stun of cStun.
  function fissure(w, p, a) {
    const end = Sim.castMove(w.room, p.x, p.y, a, FISSURE_LEN + 4, 4, w.locked), len = Math.min(FISSURE_LEN, Math.hypot(end.x - p.x, end.y - p.y)), pid = p.pid;
    if (len < 12) return;
    w.addZone({ kind: 'crack', x: p.x, y: p.y, a, len, w: FISSURE_W, arc: 1, dur: FISSURE_T, team: 0, owner: pid, custom: true,
      onEnd: (world, z) => {
        const ow = world.players.get(pid);
        if (!ow || !(ow.stats.fissure > 0)) return;
        const st = ow.stats, cs = Math.cos(z.a), sn = Math.sin(z.a), x1 = z.x + cs * z.len, y1 = z.y + sn * z.len;
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || U.segDist2(e.x, e.y, z.x, z.y, x1, y1) >= (z.w / 2 + e.r) ** 2) continue;
          world.hitEnemy(e, st.weapon.dmg * st.fissure, { p: ow, kind: 'explode', wpn: true, noProc: true, crit: false, noGuard: true, x: z.x, y: z.y, kx: cs, ky: sn, part: 'fissure' });
          if (e.hp > 0) world.stunFoe(e, st.cStun, true);
        }
        world.emit({ t: 'fissure', x: Math.round(z.x), y: Math.round(z.y), a: Math.round(z.a * 100) / 100, len: Math.round(z.len), pid });
      } });
  }

  // Thousand Edges: one piercing blade wave along a (a Parry: three, FAN apart) at bladeWave x the weapon damage; each wave is an ordinary hero shot (it can crit and builds statuses).
  function bladeWaves(w, p, a, st, parried) {
    const n = parried ? 3 : 1, dmg = st.weapon.dmg * st.bladeWave;
    for (let i = 0; i < n; i++) {
      w.spawnProj({ team: 0, kind: 'blade', x: p.x, y: p.y - 4, a: a + (i - (n - 1) / 2) * FAN, speed: BLADE_SPEED, r: BLADE_R, dmg, life: BLADE_LEN / BLADE_SPEED, pierce: 99, owner: p.pid, knock: 40, wpn: true, part: 'bladewave' });
    }
  }

  // Doombrand: every foe holding DOOM_AT ailments (from any hero) stays Marked for DOOM_T s at brandMark. The Mark is shared with Hunter's Mark: the strongest value wins (a tie keeps the existing one) and only a Hunter's Mark keeps markBy, which owns the leap.
  function doombrand(w, p) {
    const v = p.stats.brandMark;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || w.ailments(e) < DOOM_AT) continue;
      if (!(e.mark > 0) || v > e.markV) { e.markV = v; e.markBy = 0; }
      e.mark = Math.max(e.mark, DOOM_T);
    }
  }

  // Bloodquake: a Charge impact or a bash on a foe with BQUAKE_AT ailments and a Bleed pool pays the pool x (1 + bleedMul) x (1 + bloodquakeMul) at once (a foe the strike just killed takes nothing) and bursts bloodquakeSplash of the amount paid to foes within BQUAKE_R as new Bleed (SPREAD_CAP of their HP at most).
  function bloodquake(w, p, e) {
    const st = p.stats, pool = e.bleedPool;
    if (!(pool > 0)) return;
    e.bquakeT = w.time + BQUAKE_CD; e.bleedPool = 0;
    const paid = pool * (1 + st.bleedMul) * (1 + st.bloodquakeMul);
    if (e.hp > 0) w.hitEnemy(e, paid, { p, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true, bleed: true, part: 'bloodquake' });
    const give = paid * st.bloodquakeSplash, cap = C.SPREAD_CAP;
    for (const o of w.enemies) {
      if (o === e || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || U.dist2(o.x, o.y, e.x, e.y) >= (BQUAKE_R + o.r) ** 2) continue;
      w.addBleed(o, Math.min(give, cap * o.maxHp), p);
    }
    if (!(w.time - p.bquakeFxT < 0.05)) { p.bquakeFxT = w.time; w.emit({ t: 'bquake', x: Math.round(e.x), y: Math.round(e.y - e.r * 0.5), r: BQUAKE_R, pid: p.pid }); } // one burst cue per 50 ms: a crowd detonates in the same tick
  }

  // ---------------- Knight hook table ----------------
  ED.CLS.knight = {
    // fx0 / parry0: where the attack's events began and Parry's clock before it (attackOpts and attack pair up); doomT: seconds to the next Doombrand scan; bquakeFxT: world time of the last Bloodquake cue.
    init(p) { p.fx0 = 0; p.parry0 = 0; p.doomT = 0; p.bquakeFxT = -99; },
    // Doombrand scans the foes every DOOM_EVERY s. A raised Bulwark counts its seconds and bashes at its hold limit.
    tick(p, dt) {
      if (p.stats.doombrand > 0 && (p.doomT -= dt) <= 0) { p.doomT = DOOM_EVERY; doombrand(this, p); }
      if (p.bulwarkOn && (p.bulwarkT += dt) >= ED.Stats.skillNums('bulwark', p.stats).hold - 1e-9) bash(this, p, p.face || 0, false, p.x, p.y);
    },
    // The Bulwark release bashes toward a; with the shield already down it does nothing (the host's hold limit may have bashed first).
    release(p, a) { if (p.bulwarkOn) bash(this, p, fin(a) ? a : p.face || 0, false, p.x, p.y); },
    block(p, src) { return block(this, p, src); },
    // Earthsplitter and Thousand Edges follow the Cleave of the attack just made, and a Parry in it: attackOpts notes the start, attack reads what the swing did.
    attackOpts(p, st) {
      if (st.fissure > 0 || st.bladeWave > 0) { p.fx0 = this.fx.length; p.parry0 = p.parryT; }
      return null;
    },
    attack(p, a, st) {
      if (!(st.fissure > 0 || st.bladeWave > 0) || !cleaved(this, p)) return;
      if (st.fissure > 0) fissure(this, p, a);
      if (st.bladeWave > 0) bladeWaves(this, p, a, st, p.parryT > p.parry0);
    },
    // Doombrand: Brand counts brandCap ailments (combat.js adds the first 4).
    hitMul(p, e) {
      const st = p.stats;
      if (!(st.brandCap > 4) || !(st.brand > 0)) return 0;
      const n = this.ailments(e);
      return n > 4 ? st.brand * (Math.min(st.brandCap, n) - 4) : 0;
    },
    // Bloodquake: a Charge impact or a bash on a foe with enough ailments (once per BQUAKE_CD per foe).
    hitDone(p, e, dmg, crit, src) {
      if (p.stats.bloodquake > 0 && src.part && BQUAKE_PARTS.has(src.part) && !(e.bquakeT > this.time) && this.ailments(e) >= BQUAKE_AT) bloodquake(this, p, e);
    },
    // Ruin Spreads: a foe killed by a bash hands its statuses on (queued, one hop at a time; see runPayoff 'spread')
    // Unbroken (secret): a boss felled by a Bulwark bash with full stored power.
    kill(e, p, src) {
      if (e.boss && p && p.cls === 'knight' && src && src.part === 'bulwark.bash' && src.full) this.secretP(p, 'heroSecret');
      if (!p || p.cls !== 'knight' || !p.stats.ruinSpread || !src || !BASH_PARTS.has(src.part)) return;
      this.queuePayoff(p, { kind: 'spread', e, x: e.x, y: e.y, f: p.stats.ruinSpread, n: 2, r: 80 });
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
