// Knight: Shield Charge (a contact sweep at CHARGE_SPEED), Shield Throw (a thrown shield that ricochets, stuns, swats shots and returns) and the Knight route cards that act on them.
// Cleave, Parry, Brace, Brand and the shared engines live in combat.js; this file owns the two skills, the shield's flight and the Knight hook table ED.CLS.knight.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, Sim = ED.Sim, C = ED.CONST;
  const W = ED.World.prototype;
  const fin = (v) => typeof v === 'number' && isFinite(v);

  // ---------------- Shield Charge ----------------
  // Cast: stores the path (origin accepted within 48 px of the host's hero, length clamped to the skill's range and clipped at walls), makes the hero untouchable for the run, starts Brace (Vanguard) and recalls thrown shields.
  ED.CAST.charge = function (p, a, data, st, N) {
    let x0 = p.x, y0 = p.y;
    if (fin(data.x0) && fin(data.y0) && U.dist2(data.x0, data.y0, p.x, p.y) <= 48 * 48) { x0 = data.x0; y0 = data.y0; }
    let len = fin(data.x1) && fin(data.y1) ? Math.hypot(data.x1 - x0, data.y1 - y0) : N.range;
    len = U.clamp(len, 1, N.range);
    const end = Sim.castMove(this.room, x0, y0, a, len, p.r, this.locked);
    len = Math.max(1, Math.hypot(end.x - x0, end.y - y0));
    p.charge = { x0, y0, x1: end.x, y1: end.y, a, t0: this.time, len, s: 0, hit: new Set() };
    p.invuln = Math.max(p.invuln, len / C.CHARGE_SPEED + 0.1);
    if (st.brace && this.time >= p.braceAt + C.BRACE_CD) { p.braceT = st.brace; p.braceAt = this.time; }
    for (const s of p.shields) if (s.leg === 'out' || s.leg === 'chase') this.shieldBack(s); // a shield in flight flies back through the pack
    return { tx: Math.round(end.x), ty: Math.round(end.y) };
  };

  // Each tick the sweep covers the path from where it was to where the hero is by now: foes within their radius + the part's reach take the impact once (Crush on shield-stunned foes), then the stun.
  // At the end of the path: Juggernaut's shockwave, Shield Bash's free shield, Rallying Charge's shields, and Follow-Through's Cleave.
  W.updateCharge = function (p, dt) {
    const c = p.charge, st = p.stats, N = ED.Stats.skillNums('charge', st), q = N.p.impact;
    const s0 = c.s, s1 = Math.min(c.len, (this.time - c.t0) * C.CHARGE_SPEED), ca = Math.cos(c.a), sa = Math.sin(c.a);
    c.s = s1;
    const ax = c.x0 + ca * s0, ay = c.y0 + sa * s0, bx = c.x0 + ca * s1, by = c.y0 + sa * s1;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || c.hit.has(e.id)) continue;
      if (U.segDist2(e.x, e.y, ax, ay, bx, by) >= (e.r + q.reach) ** 2) continue;
      c.hit.add(e.id);
      this.hitEnemy(e, q.dmg, this.partSrc(p, N, 'impact', { kx: ca, ky: sa, mul: e.shieldStunT > 0 ? 1 + C.CRUSH : undefined, infK: 1 + st.ruinInf }));
      if (e.hp > 0) {
        this.stunFoe(e, q.stun + st.chargeStun, false);
        if (st.seal) e.sealT = Math.max(e.sealT, st.seal);
      }
    }
    if (s1 < c.len) return;
    p.charge = null;
    const sh = N.p.shock;
    if (sh.on) this.explode(c.x1, c.y1, sh.r, sh.dmg, 0, p, 'shock', true, { part: 'charge.shock', knock: sh.knock });
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

  // ---------------- Shield Throw ----------------
  // p.shields = [{ pr (the ghost projectile), leg: 'out' | 'chase' | 'back' | 'orbit', t (total flight), legT, flown, d (straight distance), a, hit (foes struck this leg), strikes, tgt, room, mul, noStun, grp ({ strikes, open }: one cast), lastFoe, orbitA, orbitDur, orbitSeen }]
  // A new throw launches the shield that is orbiting the hero (Shield Orbit) before it spawns another.
  ED.CAST.shieldthrow = function (p, a, data, st, N) {
    const d = U.clamp(fin(data.d) ? data.d : C.THROW_MAX, N.rangeMin, N.range), twin = st.twinShield > 0;
    const grp = { strikes: 0, open: twin ? 2 : 1 };
    let orb = p.shields.find(s => s.leg === 'orbit') || null;
    const launch = (aa, mul) => { const re = orb; orb = null; this.throwShield(p, aa, d, mul, null, false, grp, re); };
    if (twin) { launch(a - 0.22, st.twinShield); launch(a + 0.22, st.twinShield); } else launch(a, 1);
    return { d: Math.round(d) };
  };

  // Launches a shield from the hero (or origin {x, y}) along a for d px at damage factor mul; noStun: Shield Bash. grp joins the shields of one cast (their strikes count together for the catch).
  // reuse: an orbiting shield of p that flies this throw in place of a new one.
  W.throwShield = function (p, a, d, mul, origin, noStun, grp, reuse) {
    const st = p.stats, N = ED.Stats.skillNums('shieldthrow', st), q = N.p.strike;
    const x = (origin ? origin.x : p.x) + Math.cos(a) * 10, y = (origin ? origin.y : p.y - 4) + Math.sin(a) * 10;
    let pr;
    if (reuse) { pr = reuse.pr; pr.x = x; pr.y = y; } else pr = this.spawnProj({ team: 0, kind: 'shield', ghost: true, x, y, a, speed: C.THROW_SPEED, r: q.r, dmg: 0, life: 99, pierce: 999, owner: p.pid });
    const s = { pr, leg: 'out', t: 0, legT: 0, flown: 0, d: U.clamp(d, N.rangeMin, N.range), a, hit: new Set(), strikes: 0, tgt: null, room: this.room, mul, noStun: !!noStun, grp: grp || { strikes: 0, open: 1 }, lastFoe: null, orbitA: 0, orbitDur: 0, orbitSeen: null };
    if (reuse) p.shields[p.shields.indexOf(reuse)] = s; else p.shields.push(s);
    p.shieldOut = true;
    return s;
  };

  // The shield turns for home with a fresh hit set (the return part hits each foe it passes once).
  W.shieldBack = function (s) {
    if (s.leg === 'back' || s.leg === 'orbit') return;
    s.leg = 'back'; s.hit = new Set(); s.legT = 0; s.tgt = null;
  };

  W.dropShield = function (p, i) {
    p.shields[i].pr.dead = true;
    p.shields.splice(i, 1);
    p.shieldOut = p.shields.length > 0;
  };

  W.clearShields = function (p) {
    for (const s of p.shields) s.pr.dead = true;
    p.shields.length = 0;
    p.shieldOut = false;
  };

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

  // A strike on foe e: damage and stun (a guarded strike does neither the stun nor the Crush mark but still counts), Brand's seal, the carried statuses, then the ricochet or the turn for home.
  function strike(w, p, s, e, N, A) {
    const st = p.stats, q = N.p.strike, pr = s.pr, d = Math.hypot(e.x - pr.x, e.y - pr.y) || 1;
    s.hit.add(e.id); s.strikes++; s.grp.strikes++;
    if (st.carry && s.lastFoe && s.lastFoe !== e) w.moveStatuses(s.lastFoe, e, st.carry);
    let mul = s.mul * (1 + st.gather * (s.strikes - 1));
    if (e.boss) mul *= q.bossMul;
    const src = w.partSrc(p, N, 'strike', { x: pr.x, y: pr.y, kx: (e.x - pr.x) / d, ky: (e.y - pr.y) / d, mul: mul === 1 ? undefined : mul, infK: 1 + st.ruinInf });
    w.hitEnemy(e, q.dmg, src);
    if (e.hp > 0) {
      if (!src.guarded && !s.noStun && !e.boss) { const dur = w.stunFoe(e, q.stun, false); if (dur > 0) e.shieldStunT = dur; }
      if (st.seal) e.sealT = Math.max(e.sealT, st.seal);
    }
    s.lastFoe = e;
    const next = s.strikes < q.n ? nextTarget(w, s, e, A) : null;
    w.emit({ t: 'ric', x0: Math.round(pr.x), y0: Math.round(pr.y), x1: Math.round(next ? next.x : pr.x), y1: Math.round(next ? next.y : pr.y), n: s.strikes, g: src.guarded ? 1 : 0, pid: p.pid });
    if (next) { s.leg = 'chase'; s.legT = 0; s.tgt = next; } else w.shieldBack(s);
  }

  // The catch: the shield of the last shield of a cast to come home shields the hero (CATCH_PER of max HP per foe struck of the whole cast, at most CATCH_MAX, once per KWARD_CD); Shield Orbit keeps it circling.
  function catchShield(w, p, s, i) {
    const st = p.stats;
    s.grp.open--;
    let v = 0;
    if (s.grp.open <= 0 && s.grp.strikes > 0 && p.kWardT <= 0) {
      v = w.addShield(p, Math.min(C.CATCH_MAX, C.CATCH_PER * s.grp.strikes) * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class');
      if (v > 0) p.kWardT = C.KWARD_CD;
    }
    w.emit({ t: 'catch', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y - 4), v: Math.round(v * 10) / 10 });
    if (st.orbit > 0) { s.leg = 'orbit'; s.legT = 0; s.orbitA = Math.atan2(s.pr.y - (p.y - 4), s.pr.x - p.x); s.orbitDur = st.orbit; s.orbitSeen = new Map(); s.hit = new Set(); } else w.dropShield(p, i);
  }

  // Flight of every shield of p: legs, strikes, the swat of enemy shots, the catch. The ghost projectile is moved here (pr.x/y and the current velocity for clients), updateProjectiles skips it.
  W.updateShieldThrow = function (p, dt) {
    const st = p.stats, N = ED.Stats.skillNums('shieldthrow', st), room = this.room, locked = this.locked, A = 1 + 0.5 * st.area;
    const hx = p.x, hy = p.y - 4;
    for (let i = p.shields.length - 1; i >= 0; i--) {
      const s = p.shields[i], pr = s.pr;
      if (s.room !== room) { this.dropShield(p, i); continue; }
      s.t += dt; s.legT += dt;
      if (s.t >= C.THROW_FLIGHT - 0.4 && (s.leg === 'out' || s.leg === 'chase')) this.shieldBack(s); // the catch is forced at THROW_FLIGHT: head home early enough to arrive
      let nx = pr.x, ny = pr.y, sp = 0, ang = s.a;
      if (s.leg === 'out') {
        sp = C.THROW_SPEED; const stp = sp * dt;
        nx += Math.cos(s.a) * stp; ny += Math.sin(s.a) * stp; s.flown += stp;
        if (D.blocksShots(D.tileAt(room, nx, ny), locked)) { nx = pr.x; ny = pr.y; this.shieldBack(s); } else if (s.flown >= s.d) this.shieldBack(s);
      } else if (s.leg === 'chase') {
        const t = s.tgt;
        if (!t || t.hp <= 0 || s.legT > C.CHASE_T) this.shieldBack(s);
        else {
          sp = C.CHASE_SPEED; const dx = t.x - pr.x, dy = t.y - pr.y, dist = Math.hypot(dx, dy) || 1, stp = sp * dt;
          ang = Math.atan2(dy, dx);
          if (dist <= stp) { nx = t.x; ny = t.y; } else { nx += dx / dist * stp; ny += dy / dist * stp; }
          if (D.blocksShots(D.tileAt(room, nx, ny), locked)) { nx = pr.x; ny = pr.y; this.shieldBack(s); }
        }
      }
      if (s.leg === 'back') {
        sp = C.CHASE_SPEED; const dx = hx - pr.x, dy = hy - pr.y, dist = Math.hypot(dx, dy) || 1, stp = sp * dt;
        ang = Math.atan2(dy, dx);
        if (dist <= p.r + 10 || s.t >= C.THROW_FLIGHT) { pr.x = hx; pr.y = hy; catchShield(this, p, s, i); if (s.leg !== 'orbit') continue; sp = 0; }
        else if (dist <= stp) { nx = hx; ny = hy; } else { nx = pr.x + dx / dist * stp; ny = pr.y + dy / dist * stp; }
      }
      if (s.leg === 'orbit') {
        s.orbitA += dt * (U.TAU / 0.9);
        nx = hx + Math.cos(s.orbitA) * 44; ny = hy + Math.sin(s.orbitA) * 44; ang = s.orbitA + Math.PI / 2; sp = 44 * U.TAU / 0.9;
        if (s.legT >= s.orbitDur) { this.dropShield(p, i); continue; }
      }
      pr.x = nx; pr.y = ny; pr.vx = Math.cos(ang) * sp; pr.vy = Math.sin(ang) * sp;
      // foes touched
      if (s.leg === 'out' || s.leg === 'chase') {
        let hit = null, bd = Infinity;
        for (const e of this.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || e.invulnT > 0 || s.hit.has(e.id)) continue;
          const d2 = U.dist2(pr.x, pr.y, e.x, e.y);
          if (d2 <= (e.r + pr.r) ** 2 && d2 < bd) { bd = d2; hit = e; }
        }
        if (hit) strike(this, p, s, hit, N, A);
      } else {
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
          s.orbitDur -= 0.75;
          const rf = N.p.reflect;
          if (rf.on) {
            const tg = this.nearestEnemy(pr.x, pr.y, rf.range);
            if (tg) this.spawnProj({ team: 0, kind: 'shard', x: pr.x, y: pr.y, a: Math.atan2(tg.y - pr.y, tg.x - pr.x), speed: 420, r: 5, dmg: rf.dmg, life: 0.8, pierce: 0, owner: p.pid, knock: 60, hk: 'skill', part: 'shieldthrow.reflect' });
          }
        }
      }
    }
  };

  // ---------------- Knight hook table ----------------
  ED.CLS.knight = {
    // Ruin Spreads: a foe killed by a shield strike hands its statuses on (queued, one hop at a time; see runPayoff 'spread')
    kill(e, p, src) {
      if (!p || p.cls !== 'knight' || !p.stats.ruinSpread || !src || !src.part || src.part.indexOf('shieldthrow.') !== 0) return;
      this.queuePayoff(p, { kind: 'spread', e, x: e.x, y: e.y, f: p.stats.ruinSpread, n: 2, r: 80 });
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
