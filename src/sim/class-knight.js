// Knight: Shield Charge (a contact sweep at CHARGE_SPEED), Shield Throw (a thrown shield that ricochets, stuns, swats shots and returns) and the Knight route cards that act on them.
// Cleave, Parry, Brace, Brand and the shared engines live in combat.js; this file owns the two skills, the shield's flight and the Knight hook table ED.CLS.knight.
// Skill forms (rank 3): Avalanche (carry + slam + cracks), Iron Phalanx (wide band + War Banner), Aegis Tempest (three shields + vortex), Bastion (two orbiting shields).
// Route forms (rank 3): Earthsplitter (a fissure per Cleave), Thousand Edges (blade waves per Cleave), Doombrand (Mark at 4 ailments, Brand counts 6), Bloodquake (a strike detonates the Bleed pool); they run through the hook table at the end.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, Sim = ED.Sim, C = ED.CONST;
  const W = ED.World.prototype;
  const fin = (v) => typeof v === 'number' && isFinite(v);

  // CARRY_STEP: px per tick a carried foe moves toward the front of the Charge. PHALANX_HALF: half width of the Iron Phalanx band.
  // VORTEX_R / VORTEX_SPIN: spin radius and seconds per turn of the Aegis Tempest shields; VORTEX_PULL: px/s pull of the vortex. ORBIT_R / BASTION_R: orbit radius of Shield Orbit and of Bastion.
  const CARRY_STEP = 30, PHALANX_HALF = 35, VORTEX_R = 24, VORTEX_SPIN = 0.4, ORBIT_R = 44, BASTION_R = 60;

  // ---------------- Shield Charge ----------------
  // Cast: stores the path (origin accepted within 48 px of the host's hero, length clamped to the skill's range and clipped at walls), makes the hero untouchable for the run, starts Brace (Vanguard) and recalls thrown shields.
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
    for (const s of p.shields) this.shieldBack(s); // a shield in flight (or spinning in a vortex) flies back through the pack; an orbiting one stays
    return { tx: Math.round(end.x), ty: Math.round(end.y) };
  };

  // Each tick the sweep covers the path from where it was to where the hero is by now: foes within their radius + the part's reach take the impact once (Crush on shield-stunned foes, bosses take its bossMul), then the stun (a boss is never stunned).
  // Avalanche carries the non-elite foes it hits along with the front of the run (elites are knocked sideways, bosses stand); Iron Phalanx widens the band and destroys enemy shots in it.
  // At the end of the path: Juggernaut's shockwave or Avalanche's slam and cracks, Iron Phalanx's War Banner, Shield Bash's free shield, Rallying Charge's shields, and Follow-Through's Cleave.
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
    if (st.bash) this.throwShield(p, c.a, C.THROW_MAX, st.bash, { x: c.x1, y: c.y1 - 4 }, true, null);
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

  // ---------------- Shield Throw ----------------
  // p.shields = [{ pr (the ghost projectile), leg: 'out' | 'chase' | 'back' | 'orbit' | 'hold' | 'gather' | 'vortex', t (total flight; paused while held), legT, flown, d (straight distance), a, hit (foes struck this leg), strikes, tgt, room, mul, noStun,
  //   grp ({ strikes (non-fodder foes struck: the catch), open, size, ended, list (the shields of one cast), any, lx, ly (the last foe struck), vz (the vortex zone) }), lastFoe, orbitA, orbitDur, orbitSeen, own, dead, vx, vy, vA }]
  // A new throw launches the shield that is orbiting the hero (Shield Orbit) before it spawns another. Aegis Tempest shields that end their ricochets wait ('hold') for the others, then 'gather' at the last foe struck and spin ('vortex').
  ED.CAST.shieldthrow = function (p, a, data, st, N) {
    const d = U.clamp(fin(data.d) ? data.d : C.THROW_MAX, N.rangeMin, N.range), n = st.tempest > 0 ? Math.round(st.tempest) : st.twinShield > 0 ? 2 : 1, m = st.twinShield > 0 ? st.twinShield : 1;
    const grp = { strikes: 0, open: n, size: n, ended: 0, list: [], any: false, lx: 0, ly: 0, vz: null };
    let orb = p.shields.find(s => s.leg === 'orbit') || null;
    const launch = (aa, mul) => { const re = orb; orb = null; this.throwShield(p, aa, d, mul, null, false, grp, re); };
    if (n === 1) launch(a, 1);
    else for (let i = 0; i < n; i++) launch(a + (i - (n - 1) / 2) * (n === 2 ? 0.44 : 0.26), m);
    return { d: Math.round(d) };
  };

  // Launches a shield from the hero (or origin {x, y}) along a for d px at damage factor mul; noStun: Shield Bash. grp joins the shields of one cast (their strikes count together for the catch).
  // reuse: an orbiting shield of p that flies this throw in place of a new one.
  W.throwShield = function (p, a, d, mul, origin, noStun, grp, reuse) {
    const st = p.stats, N = ED.Stats.skillNums('shieldthrow', st), q = N.p.strike;
    const x = (origin ? origin.x : p.x) + Math.cos(a) * 10, y = (origin ? origin.y : p.y - 4) + Math.sin(a) * 10;
    let pr;
    if (reuse) { pr = reuse.pr; pr.x = x; pr.y = y; } else pr = this.spawnProj({ team: 0, kind: 'shield', ghost: true, x, y, a, speed: C.THROW_SPEED, r: q.r, dmg: 0, life: 99, pierce: 999, owner: p.pid });
    const g = grp || { strikes: 0, open: 1, size: 1, ended: 0, list: [], any: false, lx: 0, ly: 0, vz: null };
    const s = { pr, leg: 'out', t: 0, legT: 0, flown: 0, d: U.clamp(d, N.rangeMin, N.range), a, hit: new Set(), strikes: 0, tgt: null, room: this.room, mul, noStun: !!noStun, grp: g, lastFoe: null, orbitA: 0, orbitDur: 0, orbitSeen: null, own: p, dead: false, vx: 0, vy: 0, vA: 0 };
    g.list.push(s);
    if (reuse) { reuse.dead = true; p.shields[p.shields.indexOf(reuse)] = s; } else p.shields.push(s);
    p.shieldOut = true;
    return s;
  };

  // The shield turns for home with a fresh hit set (the return part hits each foe it passes once). A shield waiting in a vortex group flies home too.
  W.shieldBack = function (s) {
    if (s.leg === 'back' || s.leg === 'orbit') return;
    s.leg = 'back'; s.hit = new Set(); s.legT = 0; s.tgt = null;
  };

  W.dropShield = function (p, i) {
    p.shields[i].pr.dead = true; p.shields[i].dead = true;
    p.shields.splice(i, 1);
    p.shieldOut = p.shields.length > 0;
  };

  // Clears every shield; a living Knight with Bastion remembers that it had an orbit (CLS.knight.tick brings the pair back, so a new room keeps it).
  W.clearShields = function (p) {
    p.bastionKeep = !p.downed && !p.dead && !!(p.stats && p.stats.bastion > 0) && p.shields.some(s => s.leg === 'orbit');
    for (const s of p.shields) { s.pr.dead = true; s.dead = true; }
    p.shields.length = 0;
    p.shieldOut = false;
  };

  // A shield in orbit around the hero at angle A (Bastion's pair): its own cast group, no strikes of its own.
  function spawnOrbit(w, p, A) {
    const q = ED.Stats.skillNums('shieldthrow', p.stats).p.strike, g = { strikes: 0, open: 0, size: 1, ended: 0, list: [], any: false, lx: 0, ly: 0, vz: null };
    const pr = w.spawnProj({ team: 0, kind: 'shield', ghost: true, x: p.x + Math.cos(A) * BASTION_R, y: p.y - 4 + Math.sin(A) * BASTION_R, a: A + Math.PI / 2, speed: C.THROW_SPEED, r: q.r, dmg: 0, life: 99, pierce: 999, owner: p.pid });
    const s = { pr, leg: 'orbit', t: 0, legT: 0, flown: 0, d: 0, a: 0, hit: new Set(), strikes: 0, tgt: null, room: w.room, mul: 1, noStun: false, grp: g, lastFoe: null, orbitA: A, orbitDur: Infinity, orbitSeen: new Map(), own: p, dead: false, vx: 0, vy: 0, vA: 0 };
    g.list.push(s); p.shields.push(s); p.shieldOut = true;
    return s;
  }

  // Next ricochet target after foe e: the nearest living foe within RIC_R of it that is not in this leg's hit set and has a clear line.
  function nextTarget(w, s, e, A) {
    let best = null, bd = (C.RIC_R * A) ** 2;
    for (const o of w.enemies) {
      if (o === e || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || o.invulnT > 0 || s.hit.has(o.id)) continue;
      const d2 = U.dist2(o.x, o.y, e.x, e.y);
      if (d2 < bd && Sim.los(w.room, e.x, e.y, o.x, o.y, w.locked)) { bd = d2; best = o; }
    }
    return best;
  }

  // The end of a shield's ricochets: Aegis Tempest shields wait for their group (when a foe was struck), every other shield turns for home.
  function chainEnd(w, p, s) {
    const g = s.grp;
    if (p.stats.tempest > 0 && g.size > 1 && g.any && !g.vz) { s.leg = 'hold'; s.legT = 0; s.hit = new Set(); s.tgt = null; tryVortex(w, p, g); } else w.shieldBack(s);
  }

  // The vortex starts once every shield of the cast is waiting or already flying home.
  function tryVortex(w, p, g) {
    if (g.vz || !g.any) return;
    let hold = 0;
    for (const x of g.list) { if (x.dead) continue; if (x.leg === 'hold') hold++; else if (x.leg !== 'back') return; }
    if (hold) startVortex(w, p, g);
  }

  // The waiting shields fly to the last foe struck and spin there for the vortex part's duration. The zone (kind 'vortex', warm = seconds until the shields arrive) pulls non-boss foes toward its centre
  // and strikes every foe inside each q.every seconds; when it ends the shields fly home. It ends early when no shield spins any more.
  function startVortex(w, p, g) {
    const q = ED.Stats.skillNums('shieldthrow', p.stats).p.vortex, px = g.lx, py = g.ly, hold = g.list.filter(x => !x.dead && x.leg === 'hold'), pid = p.pid, pull = q.pull;
    let gather = 0;
    hold.forEach((s, k) => {
      const A0 = k * U.TAU / hold.length;
      s.leg = 'gather'; s.legT = 0; s.vx = px + Math.cos(A0) * VORTEX_R; s.vy = py + Math.sin(A0) * VORTEX_R; s.vA = A0;
      gather = Math.max(gather, Math.hypot(s.vx - s.pr.x, s.vy - s.pr.y) / C.CHASE_SPEED);
    });
    g.vz = w.addZone({ kind: 'vortex', x: px, y: py, r: q.r, dur: gather + q.dur, warm: Math.round(gather * 100) / 100, team: 0, owner: pid, custom: true, acc: 0,
      update: (world, z, dt) => {
        const ow = world.players.get(pid);
        if (!ow || !g.list.some(x => !x.dead && (x.leg === 'gather' || x.leg === 'vortex'))) { z.dur = z.t; return; }
        if (z.t < gather) return;
        const N = ED.Stats.skillNums('shieldthrow', ow.stats), v = N.p.vortex, hitNow = (z.acc += dt) >= v.every;
        if (hitNow) z.acc -= v.every;
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0) continue;
          const dx = z.x - e.x, dy = z.y - e.y, d2 = dx * dx + dy * dy;
          if (d2 >= (z.r + e.r) ** 2) continue;
          const d = Math.sqrt(d2);
          if (hitNow) world.hitEnemy(e, v.dmg, world.partSrc(ow, N, 'vortex', { x: z.x, y: z.y, kx: -dx / (d || 1), ky: -dy / (d || 1), noGuard: true, infK: 1 + ow.stats.ruinInf }));
          if (!e.boss && e.hp > 0 && d > 6) { const stp = Math.min(d - 4, pull * dt); Sim.moveCircle(e, dx / d * stp, dy / d * stp, world.room, world.locked, e.fly); }
        }
      },
      onEnd: (world) => { for (const x of g.list) if (!x.dead && (x.leg === 'gather' || x.leg === 'vortex')) { x.t = Math.min(x.t, C.THROW_FLIGHT - 1.2); world.shieldBack(x); } } });
  }

  // A strike on foe e: damage and stun (a guarded strike does neither the stun nor the Crush mark but still counts), Brand's seal, the carried statuses, then the ricochet or the end of the chain.
  // The catch counts the non-fodder foes struck; the vortex centres on the last foe struck (fodder too).
  function strike(w, p, s, e, N, A) {
    const st = p.stats, q = N.p.strike, pr = s.pr, d = Math.hypot(e.x - pr.x, e.y - pr.y) || 1;
    s.hit.add(e.id); s.strikes++;
    if (!e.fodder) s.grp.strikes++;
    s.grp.any = true; s.grp.lx = e.x; s.grp.ly = e.y;
    if (st.carry && s.lastFoe && s.lastFoe !== e) w.moveStatuses(s.lastFoe, e, st.carry);
    const mul = s.mul * (1 + st.gather * (s.strikes - 1));
    const src = w.partSrc(p, N, 'strike', { x: pr.x, y: pr.y, kx: (e.x - pr.x) / d, ky: (e.y - pr.y) / d, mul: mul === 1 ? undefined : mul, infK: 1 + st.ruinInf });
    w.hitEnemy(e, q.dmg, src);
    if (e.hp > 0) {
      if (!src.guarded && !s.noStun && !e.boss) { const dur = w.stunFoe(e, q.stun, false); if (dur > 0) e.shieldStunT = dur; }
      if (st.seal) e.sealT = Math.max(e.sealT, st.seal);
    }
    s.lastFoe = e;
    const next = s.strikes < q.n ? nextTarget(w, s, e, A) : null;
    w.emit({ t: 'ric', x0: Math.round(pr.x), y0: Math.round(pr.y), x1: Math.round(next ? next.x : pr.x), y1: Math.round(next ? next.y : pr.y), n: s.strikes, g: src.guarded ? 1 : 0, pid: p.pid });
    if (next) { s.leg = 'chase'; s.legT = 0; s.tgt = next; } else chainEnd(w, p, s);
  }

  // The catch: the shield of the last shield of a cast to come home shields the hero (CATCH_PER of max HP per foe struck of the whole cast, at most CATCH_MAX, once per KWARD_CD); Shield Orbit keeps it circling.
  // Bastion: the orbit never times out, and the shield takes the place opposite the one already orbiting (the first catch also spawns the second shield).
  function catchShield(w, p, s, i) {
    const st = p.stats;
    s.grp.open--;
    let v = 0;
    if (s.grp.open <= 0 && s.grp.strikes > 0 && p.kWardT <= 0) {
      v = w.addShield(p, Math.min(C.CATCH_MAX, C.CATCH_PER * s.grp.strikes) * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class');
      if (v > 0) p.kWardT = C.KWARD_CD;
    }
    w.emit({ t: 'catch', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y - 4), v: Math.round(v * 10) / 10 });
    if (st.orbit > 0) {
      s.leg = 'orbit'; s.legT = 0; s.orbitA = Math.atan2(s.pr.y - (p.y - 4), s.pr.x - p.x); s.orbitDur = st.bastion > 0 ? Infinity : st.orbit; s.orbitSeen = new Map(); s.hit = new Set();
      if (st.bastion > 0) {
        const other = p.shields.find(x => x !== s && x.leg === 'orbit');
        if (other) s.orbitA = other.orbitA + Math.PI; else spawnOrbit(w, p, s.orbitA + Math.PI);
      }
    } else w.dropShield(p, i);
  }

  // Flight of every shield of p: legs, strikes, the swat of enemy shots, the catch. The ghost projectile is moved here (pr.x/y and the current velocity for clients), updateProjectiles skips it.
  W.updateShieldThrow = function (p, dt) {
    const st = p.stats, N = ED.Stats.skillNums('shieldthrow', st), room = this.room, locked = this.locked, A = 1 + 0.5 * st.area;
    const hx = p.x, hy = p.y - 4;
    for (let i = p.shields.length - 1; i >= 0; i--) {
      const s = p.shields[i], pr = s.pr;
      if (s.room !== room) { if (s.leg === 'orbit' && st.bastion > 0) s.room = room; else { this.dropShield(p, i); continue; } }
      if (s.leg !== 'hold' && s.leg !== 'gather' && s.leg !== 'vortex') s.t += dt;
      s.legT += dt;
      if (s.t >= C.THROW_FLIGHT - 0.4 && (s.leg === 'out' || s.leg === 'chase')) chainEnd(this, p, s); // the catch is forced at THROW_FLIGHT: head home early enough to arrive
      let nx = pr.x, ny = pr.y, sp = 0, ang = s.a;
      if (s.leg === 'out') {
        sp = C.THROW_SPEED; const stp = sp * dt;
        nx += Math.cos(s.a) * stp; ny += Math.sin(s.a) * stp; s.flown += stp;
        if (D.blocksShots(D.tileAt(room, nx, ny), locked)) { nx = pr.x; ny = pr.y; chainEnd(this, p, s); } else if (s.flown >= s.d) chainEnd(this, p, s);
      } else if (s.leg === 'chase') {
        const t = s.tgt;
        if (!t || t.hp <= 0 || s.legT > C.CHASE_T) chainEnd(this, p, s);
        else {
          sp = C.CHASE_SPEED; const dx = t.x - pr.x, dy = t.y - pr.y, dist = Math.hypot(dx, dy) || 1, stp = sp * dt;
          ang = Math.atan2(dy, dx);
          if (dist <= stp) { nx = t.x; ny = t.y; } else { nx += dx / dist * stp; ny += dy / dist * stp; }
          if (D.blocksShots(D.tileAt(room, nx, ny), locked)) { nx = pr.x; ny = pr.y; chainEnd(this, p, s); }
        }
      }
      if (s.leg === 'gather') {
        sp = C.CHASE_SPEED; const dx = s.vx - pr.x, dy = s.vy - pr.y, dist = Math.hypot(dx, dy) || 1, stp = sp * dt;
        ang = Math.atan2(dy, dx);
        if (dist <= stp) { nx = s.vx; ny = s.vy; s.leg = 'vortex'; s.legT = 0; s.orbitA = s.vA; sp = 0; } else { nx += dx / dist * stp; ny += dy / dist * stp; }
      } else if (s.leg === 'vortex') {
        const vz = s.grp.vz;
        s.orbitA += dt * (U.TAU / VORTEX_SPIN);
        nx = (vz ? vz.x : pr.x) + Math.cos(s.orbitA) * VORTEX_R; ny = (vz ? vz.y : pr.y) + Math.sin(s.orbitA) * VORTEX_R; ang = s.orbitA + Math.PI / 2; sp = VORTEX_R * U.TAU / VORTEX_SPIN;
      }
      if (s.leg === 'back') {
        sp = C.CHASE_SPEED; const dx = hx - pr.x, dy = hy - pr.y, dist = Math.hypot(dx, dy) || 1, stp = sp * dt;
        ang = Math.atan2(dy, dx);
        if (dist <= p.r + 10 || s.t >= C.THROW_FLIGHT) { pr.x = hx; pr.y = hy; catchShield(this, p, s, i); if (s.leg !== 'orbit') continue; sp = 0; }
        else if (dist <= stp) { nx = hx; ny = hy; } else { nx = pr.x + dx / dist * stp; ny = pr.y + dy / dist * stp; }
      }
      if (s.leg === 'orbit') {
        const R = st.bastion > 0 ? BASTION_R : ORBIT_R;
        s.orbitA += dt * (U.TAU / 0.9);
        nx = hx + Math.cos(s.orbitA) * R; ny = hy + Math.sin(s.orbitA) * R; ang = s.orbitA + Math.PI / 2; sp = R * U.TAU / 0.9;
        if (s.legT >= s.orbitDur) { this.dropShield(p, i); continue; }
      }
      pr.x = nx; pr.y = ny; pr.vx = Math.cos(ang) * sp; pr.vy = Math.sin(ang) * sp;
      this.smashCircle(p, nx, ny, pr.r);
      // foes touched
      if (s.leg === 'out' || s.leg === 'chase') {
        let hit = null, bd = Infinity;
        for (const e of this.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || e.invulnT > 0 || s.hit.has(e.id)) continue;
          const d2 = U.dist2(pr.x, pr.y, e.x, e.y);
          if (d2 <= (e.r + pr.r) ** 2 && d2 < bd) { bd = d2; hit = e; }
        }
        if (hit) strike(this, p, s, hit, N, A);
      } else if (s.leg === 'back' || s.leg === 'orbit') {
        const rq = s.leg === 'back' ? N.p.return : N.p.orbit;
        if (s.leg === 'back' || rq.on) {
          for (const e of this.enemies) {
            if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || e.invulnT > 0) continue;
            if (U.dist2(pr.x, pr.y, e.x, e.y) > (e.r + pr.r) ** 2) continue;
            if (s.leg === 'back') { if (s.hit.has(e.id)) continue; s.hit.add(e.id); } else { if ((s.orbitSeen.get(e.id) || -9) > this.time - rq.every) continue; s.orbitSeen.set(e.id, this.time); }
            const d = Math.hypot(e.x - pr.x, e.y - pr.y) || 1;
            this.hitEnemy(e, rq.dmg, this.partSrc(p, N, s.leg === 'back' ? 'return' : 'orbit', { x: pr.x, y: pr.y, kx: (e.x - pr.x) / d, ky: (e.y - pr.y) / d, mul: s.leg === 'back' && s.mul !== 1 ? s.mul : undefined, infK: 1 + st.ruinInf, knock: s.leg === 'back' ? rq.knock : 40 }));
            if (s.leg === 'orbit' && st.orbitStun && e.hp > 0) this.stunFoe(e, st.orbitStun, true); // the orbit's contact stuns (repeating: skipped on a stun cooldown)
          }
        }
      }
      // shot swat: enemy projectiles within the shield's radius + 4 are destroyed on every leg
      for (const o of this.projs) {
        if (o.team !== 1 || o.life <= 0 || U.dist2(o.x, o.y, pr.x, pr.y) > (pr.r + 4) ** 2) continue;
        o.life = 0;
        this.emit({ t: 'deflect', x: Math.round(o.x), y: Math.round(o.y) });
        if (s.leg === 'orbit') {
          if (!(st.bastion > 0)) s.orbitDur -= 0.75;
          const rf = N.p.reflect;
          if (rf.on) {
            const tg = this.nearestEnemy(pr.x, pr.y, rf.range);
            if (tg) this.spawnProj({ team: 0, kind: 'shard', x: pr.x, y: pr.y, a: Math.atan2(tg.y - pr.y, tg.x - pr.x), speed: 420, r: 5, dmg: rf.dmg, life: 0.8, pierce: 0, owner: p.pid, knock: 60, hk: 'skill', part: 'shieldthrow.reflect' });
          }
        }
      }
    }
    if (st.bastion > 0) { // the pair keeps exactly opposite, whichever of the two the loop moved first
      const o = p.shields.filter(x => x.leg === 'orbit');
      if (o.length === 2) {
        const b = o[1], pr = b.pr;
        b.orbitA = o[0].orbitA + Math.PI;
        pr.x = hx + Math.cos(b.orbitA) * BASTION_R; pr.y = hy + Math.sin(b.orbitA) * BASTION_R; pr.vx = Math.cos(b.orbitA + Math.PI / 2) * BASTION_R * U.TAU / 0.9; pr.vy = Math.sin(b.orbitA + Math.PI / 2) * BASTION_R * U.TAU / 0.9;
      }
    }
  };

  // ---------------- route forms: Earthsplitter, Thousand Edges, Doombrand, Bloodquake ----------------
  // Fodder: these only damage, spread statuses and mark; none grants a refund, a shield or a stack, so a fodder foe takes part like any other.
  // FISSURE_*: reach, width and delay of an Earthsplitter fissure. BLADE_*: reach, half width and speed of a Thousand Edges wave; FAN: angle between the waves of a Parry fan.
  // DOOM_AT / DOOM_T / DOOM_EVERY: ailments that Doombrand a foe, seconds it stays Marked, seconds between scans. BQUAKE_AT / BQUAKE_R / BQUAKE_CD: ailments, burst radius and per-foe cooldown of Bloodquake.
  const FISSURE_LEN = 180, FISSURE_W = 36, FISSURE_T = 0.25, BLADE_LEN = 180, BLADE_R = 12, BLADE_SPEED = 480, FAN = 0.35;
  const DOOM_AT = 4, DOOM_T = 4, DOOM_EVERY = 0.1, BQUAKE_AT = 3, BQUAKE_R = 80, BQUAKE_CD = 1;
  const BQUAKE_PARTS = new Set(['charge.impact', 'shieldthrow.strike']);

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

  // Bloodquake: a Charge impact or Throw strike on a foe with BQUAKE_AT ailments and a Bleed pool pays the pool x (1 + bleedMul) x (1 + bloodquakeMul) at once (a foe the strike just killed takes nothing) and bursts bloodquakeSplash of the amount paid to foes within BQUAKE_R as new Bleed (SPREAD_CAP of their HP at most).
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
    init(p) { p.bastionKeep = false; p.fx0 = 0; p.parry0 = 0; p.doomT = 0; p.bquakeFxT = -99; },
    // Bastion: after a room change the orbiting pair returns to the hero. Doombrand scans the foes every DOOM_EVERY s.
    tick(p, dt) {
      if (p.stats.doombrand > 0 && (p.doomT -= dt) <= 0) { p.doomT = DOOM_EVERY; doombrand(this, p); }
      if (!p.bastionKeep) return;
      p.bastionKeep = false;
      if (p.stats.bastion > 0 && !p.shields.length) { spawnOrbit(this, p, 0); spawnOrbit(this, p, Math.PI); }
    },
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
    // Bloodquake: a Charge or Throw strike on a foe with enough ailments (once per BQUAKE_CD per foe).
    hitDone(p, e, dmg, crit, src) {
      if (p.stats.bloodquake > 0 && src.part && BQUAKE_PARTS.has(src.part) && !(e.bquakeT > this.time) && this.ailments(e) >= BQUAKE_AT) bloodquake(this, p, e);
    },
    // Ruin Spreads: a foe killed by a shield strike hands its statuses on (queued, one hop at a time; see runPayoff 'spread')
    // Return to Sender (secret): a boss felled by the returning leg of a thrown shield.
    kill(e, p, src) {
      if (e.boss && p && p.cls === 'knight' && src && src.part === 'shieldthrow.return') this.secretP(p, 'heroSecret');
      if (!p || p.cls !== 'knight' || !p.stats.ruinSpread || !src || !src.part || src.part.indexOf('shieldthrow.') !== 0) return;
      this.queuePayoff(p, { kind: 'spread', e, x: e.x, y: e.y, f: p.stats.ruinSpread, n: 2, r: 80 });
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
