// Combat rules: spawning, damage, deaths, hero attacks and skills, projectiles and area zones.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon;
  const W = ED.World.prototype;

  // ---------------- enemies ----------------
  W.spawnEnemy = function (type, x, y, opts) {
    opts = opts || {};
    const def = ED.ENEMIES[type];
    const s = this.stratum, pact = this.pact;
    let hp = def.hp, dmg = def.dmg;
    if (!def.boss) hp *= 1 + 0.65 * (s - 1) + 0.08 * (s - 1) * (s - 1);
    hp *= this.partyHpMul();
    if (pact >= 1) hp *= 1.25;
    if (def.boss && pact >= 5) hp *= 1.35;
    if (pact >= 10) hp *= 1.2;
    dmg *= (1 + 0.32 * (s - 1) + 0.06 * (s - 1) * (s - 1)) * (pact >= 2 ? 1.25 : 1) * (pact >= 8 ? 1.2 : 1);
    const e = {
      id: U.uid(), type, def, x, y, r: def.r, hp, maxHp: hp, dmg, spd: def.spd * (pact >= 6 ? 1.15 : 1),
      kbx: 0, kby: 0, st: 'move', t: 0, cd: this.rng.range(0.6, 1.6), face: 1, flash: 0, stun: 0, chill: 0,
      burn: 0, burnDps: 0, burnTick: 0, burnOwner: null, mark: 0, frozen: 0, elite: null, ward: 0, wardMax: 0,
      boss: !!def.boss, fly: !!def.fly, target: null, tgtT: 0, aimA: 0, contactCd: 0, spawnT: opts.spawnT || 0,
      phase: 1, vars: {}, strafe: this.rng.sign(), wob: this.rng.range(0, 6.28), exposed: false, recoil: 0,
    };
    if (opts.elite) this.makeElite(e, opts.affix);
    this.enemies.push(e);
    return e;
  };

  W.makeElite = function (e, affix) {
    e.elite = affix || this.rng.pick(ED.AFFIX_IDS);
    e.hp *= 2.6; e.maxHp = e.hp; e.dmg *= 1.25; e.r = Math.round(e.r * 1.22);
    if (e.elite === 'swift') e.spd *= 1.4;
    if (e.elite === 'brutal') e.dmg *= 1.4;
    if (e.elite === 'warded') { e.ward = e.maxHp * 0.45; e.wardMax = e.ward; }
  };

  W.hitEnemy = function (e, base, src) {
    if (!e || e.hp <= 0) return 0;
    const p = src.p || null;
    let dmg = base, crit = false;
    if (p && !src.raw) {
      const st = p.stats;
      crit = src.crit === undefined ? this.rng.chance(st.crit) : !!src.crit;
      let mul = st.dmg;
      if (st.momentum && p.moving) mul += st.momentum;
      if (st.execute && e.hp < e.maxHp * 0.3) mul += st.execute;
      if (st.idol) mul += Math.min(0.4, Math.floor(this.gold / 15) * 0.01);
      if (st.banner) {
        let near = 0;
        for (const q of this.players.values()) if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 200 * 200) near++;
        mul += st.banner * (1 + near);
      }
      if (e.mark > 0) mul += 0.25;
      dmg *= Math.max(0.1, mul);
      if (crit) dmg *= st.critMult;
    } else if (p && src.raw) {
      if (e.mark > 0) dmg *= 1.25;
    }
    if (e.exposed) dmg *= 1.5;
    if (e.ward > 0) { const ab = Math.min(e.ward, dmg * 0.75); e.ward -= ab; dmg -= ab; if (e.ward <= 0) this.emit({ t: 'wardbreak', x: e.x, y: e.y }); }
    if (e.invulnT > 0) dmg = 0;
    if (dmg <= 0) return 0;
    e.hp -= dmg; e.flash = 0.1;
    if (src.knock && !e.boss) {
      const kb = src.knock * (e.elite ? 0.45 : 1) * (e.def.ai === 'tank' ? 0.35 : 1);
      e.kbx += (src.kx || 0) * kb; e.kby += (src.ky || 0) * kb;
    }
    if (src.kind !== 'dot' || dmg >= 3) this.emit({ t: 'hit', x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(dmg), c: crit ? 1 : 0, k: src.kind === 'dot' ? 1 : 0, pid: p ? p.pid : '' });
    if (p) {
      p.dealt += dmg;
      const st = p.stats;
      if (!src.noProc) {
        if (st.leech) this.healPlayer(p, dmg * st.leech, true);
        const burnCh = st.burn + (src.burn || 0);
        if (burnCh && this.rng.chance(burnCh)) this.applyBurn(e, p, st.weapon.dmg * 0.55);
        if (st.chill && this.rng.chance(st.chill)) { e.chill = 2.2; }
        if (st.chain && this.rng.chance(st.chain)) this.chainLightning(e, p, dmg * 0.6);
        if (crit && st.critChain) this.chainLightning(e, p, dmg * 0.5);
        if (crit && st.mark) e.mark = 4;
        if (st.blessed) {
          let low = null;
          for (const q of this.players.values()) if (!q.downed && !q.dead && q.hp < q.maxHp && (!low || q.hp / q.maxHp < low.hp / low.maxHp)) low = q;
          if (low) this.healPlayer(low, st.blessed, true);
        }
      }
    }
    if (e.hp <= 0) this.killEnemy(e, p, src);
    return dmg;
  };

  W.applyBurn = function (e, p, dps) {
    const mul = p && p.stats.combust ? 1.4 : 1;
    e.burn = 3; e.burnDps = Math.max(e.burnDps, dps * mul); e.burnOwner = p;
  };

  W.chainLightning = function (from, p, dmg) {
    const hit = new Set([from.id]);
    const pts = [[Math.round(from.x), Math.round(from.y)]];
    let cur = from;
    for (let i = 0; i < 3; i++) {
      const nx = this.nearestEnemy(cur.x, cur.y, 130, hit);
      if (!nx) break;
      hit.add(nx.id); pts.push([Math.round(nx.x), Math.round(nx.y)]);
      this.hitEnemy(nx, dmg, { p, kind: 'chain', noProc: true, crit: false, raw: true });
      cur = nx;
    }
    if (pts.length > 1) this.emit({ t: 'chain', pts });
  };

  W.killEnemy = function (e, p, src) {
    e.hp = 0;
    const def = e.def, s = this.stratum;
    this.run.kills++;
    if (p) p.kills++;
    this.emit({ t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: e.elite ? 1 : 0, r: e.r });
    if (def.boss) { this.onBossKilled(e); return; }
    const xpMul = 1 + 0.35 * (s - 1);
    this.dropXp(e.x, e.y, def.xp * xpMul * (e.elite ? 3 : 1));
    if (this.rng.chance(e.elite ? 1 : 0.12)) this.dropGold(e.x, e.y, (1 + Math.floor((s - 1) / 2)) * (e.elite ? 3 : this.rng.int(1, 2)));
    let heartCh = 0.05;
    for (const q of this.players.values()) heartCh += (q.stats.hearts || 0) * 0.05;
    if (e.elite) heartCh += 0.4;
    if (this.rng.chance(heartCh)) this.spawnPickup('heart', e.x, e.y, 1);
    if (e.elite) {
      this.run.elitesKilled++; this.run.embers.elites += 2 + Math.floor(s / 2);
      if (e.elite === 'volatile') this.addZone({ kind: 'tele', x: e.x, y: e.y, r: 70, dur: 0.7, team: 1, dmg: e.dmg * 1.2, boom: 'fire' });
    }
    if (def.split) for (let i = 0; i < def.split.n; i++) {
      const c = this.spawnEnemy(def.split.into, e.x + this.rng.range(-8, 8), e.y + this.rng.range(-8, 8));
      c.kbx = this.rng.range(-160, 160); c.kby = this.rng.range(-160, 160); c.cd = 0.6;
    }
    if (def.deathCloud) this.addZone({ kind: 'poison', x: e.x, y: e.y, r: def.deathCloud.r, dur: def.deathCloud.dur, dps: def.deathCloud.dps * (1 + 0.2 * (s - 1)), team: 1 });
    if (p && src.kind !== 'minionBurst') {
      const st = p.stats;
      if (st.killHeal) this.healPlayer(p, st.killHeal, true);
      if (st.chalice && p.chaliceHp < 60) {
        p.chaliceKills++;
        if (p.chaliceKills % 3 === 0) { p.chaliceHp++; this.recalc(p, false); if (p.chaliceHp % 5 === 0) this.sendBuild(p); }
      }
      if (st.burst) this.explode(e.x, e.y, 48 * (1 + st.area * 0.5), st.weapon.dmg * st.burst, 0, p, 'burst', true);
      if (p.cls === 'necro') {
        const ch = 0.12 + (st.weapon.raise || 0);
        if (this.rng.chance(ch)) this.spawnMinion(p, e.x, e.y, 10);
      }
    }
  };

  // ---------------- heroes take damage ----------------
  W.hurtPlayer = function (p, amount, src) {
    src = src || {};
    if (!p || p.downed || p.dead || this.state !== 'play') return false;
    if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillMove) return false;
    if (this.skillBlock(p, amount, src)) return false;
    const st = p.stats;
    if (src.proj && st.mirror && this.rng.chance(st.mirror)) { this.emit({ t: 'block', x: p.x, y: p.y, k: 'mirror' }); return false; }
    if (!src.hazard && st.dodge && this.rng.chance(st.dodge)) { this.emit({ t: 'block', x: p.x, y: p.y, k: 'dodge' }); p.invuln = 0.25; return false; }
    if (!src.hazard && st.aegis && p.aegisT <= 0) { p.aegisT = 10; p.invuln = 0.4; this.emit({ t: 'block', x: p.x, y: p.y, k: 'aegis' }); return false; }
    let dmg = amount * ED.Stats.armorMul(st.armor) * (1 + st.vuln);
    for (const z of this.zones) if (z.kind === 'sanct' && U.dist2(z.x, z.y, p.x, p.y) < z.r * z.r) { dmg *= 0.65; break; }
    if (p.guardT > 0) dmg *= 0.4;
    if (p.wallT > 0) dmg *= 0.6;
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg; p.invuln = src.hazard ? 0.3 : 0.6; p.hurtT = 0.3;
    if (this.boss) p.hitThisBoss = true;
    this.emit({ t: 'hurt', pid: p.pid, v: dmg, x: Math.round(p.x), y: Math.round(p.y) });
    const e = src.e;
    if (e && e.hp > 0) {
      if (st.thorns) this.hitEnemy(e, st.thorns, { p, kind: 'thorns', noProc: true, crit: false });
      if (e.elite === 'vampiric') e.hp = Math.min(e.maxHp, e.hp + dmg * 3);
      if (e.def.chillHit) p.chilled = 1.5;
    }
    if (st.guardian && p.hp > 0 && p.hp < p.maxHp * 0.3 && p.guardCd <= 0) { p.guardT = 3; p.guardCd = 20; this.emit({ t: 'guard', pid: p.pid }); }
    if (st.frozenHeart && p.frozenCd <= 0) {
      p.frozenCd = 8;
      for (const en of this.enemies) if (en.hp > 0 && !en.boss && U.dist2(en.x, en.y, p.x, p.y) < 120 * 120) en.frozen = 1.6;
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 120, c: '#9fefff' });
    }
    if (p.hp <= 0) this.playerLethal(p);
    return true;
  };

  W.playerLethal = function (p) {
    const st = p.stats;
    if (st.phoenix && !p.phoenixUsed) { p.phoenixUsed = true; p.hp = Math.round(p.maxHp * 0.5); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'phoenix', x: p.x, y: p.y }); this.explode(p.x, p.y, 110, 40 + st.weapon.dmg * 2, 0, p, 'fire'); return; }
    if (st.angel && !p.angelUsed) { p.angelUsed = true; p.hp = 1; p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'angel', x: p.x, y: p.y }); return; }
    if (p.secondWind > 0) { p.secondWind--; p.hp = Math.round(p.maxHp * p.swPct); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'wind', x: p.x, y: p.y }); return; }
    p.hp = 0; p.downed = true; p.bleed = this.partySize() > 1 ? 30 : 0.01; p.revive = 0;
    this.emit({ t: 'down', pid: p.pid, x: p.x, y: p.y });
  };

  // Area damage. team 0 = heroes' blast (hurts foes), team 1 = hostile blast (hurts heroes).
  W.explode = function (x, y, r, dmg, team, owner, look, noProc) {
    if (team === 0) {
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0) continue;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < r + e.r) this.hitEnemy(e, dmg, { p: owner, kind: 'explode', knock: 90, kx: (e.x - x) / (d || 1), ky: (e.y - y) / (d || 1), noProc: !!noProc, crit: noProc ? false : undefined });
      }
    } else {
      for (const p of this.players.values()) if (Math.hypot(p.x - x, p.y - y) < r + p.r) this.hurtPlayer(p, dmg, { e: owner && owner.hp !== undefined && owner.def ? owner : null });
    }
    this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r), k: look || 'fire' });
  };

  // ---------------- hero attacks ----------------
  W.playerAttack = function (p, a) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, w = st.weapon;
    p.face = a; p.atkCount++;
    let crit;
    if (p.critStacks > 0) { p.critStacks--; crit = true; }
    const reps = (st.twin && this.rng.chance(Math.min(0.9, st.twin))) ? 2 : 1;
    for (let rep = 0; rep < reps; rep++) {
      if (w.kind === 'melee') this.meleeSwing(p, a + rep * 0.18, w, crit, rep);
      else this.fireWeapon(p, a + rep * 0.06, w, crit);
    }
    if (w.wave && p.atkCount % w.wave.every === 0) {
      this.spawnProj({ team: 0, kind: 'wave', x: p.x, y: p.y, a, speed: 320, r: 16 * (1 + st.area * 0.5), dmg: w.dmg * w.wave.mul, life: 0.55, pierce: 99, owner: p.pid, knock: 120 });
    }
    if (st.gauntlet && p.atkCount % 6 === 0) {
      const tgt = this.nearestEnemy(p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, 220);
      if (tgt) { this.emit({ t: 'bolt', x: Math.round(tgt.x), y: Math.round(tgt.y) }); this.explode(tgt.x, tgt.y, 40, w.dmg * 2.2, 0, p, 'bolt'); }
    }
    this.emit({ t: 'atk', pid: p.pid, a: Math.round(a * 100) / 100, n: p.atkCount });
  };

  W.meleeSwing = function (p, a, w, crit, rep) {
    const st = p.stats;
    const reach = w.range * (1 + st.area * 0.5 + st.meleeReach);
    const arc = Math.min(6.3, w.arc * (1 + st.area * 0.4));
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d - e.r > reach) continue;
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      if (arc < 6.2 && Math.abs(U.angDiff(a, ang)) > arc / 2 + Math.atan2(e.r, Math.max(d, 1))) continue;
      this.hitEnemy(e, w.dmg, { p, kind: 'weapon', crit, knock: w.knock, kx: Math.cos(ang), ky: Math.sin(ang) });
    }
    if (w.deflect) {
      this.projs = this.projs.filter(pr => {
        if (pr.team !== 1) return true;
        const d = Math.hypot(pr.x - p.x, pr.y - p.y);
        if (d > reach + pr.r) return true;
        if (Math.abs(U.angDiff(a, Math.atan2(pr.y - p.y, pr.x - p.x))) > arc / 2 + 0.2) return true;
        this.emit({ t: 'deflect', x: Math.round(pr.x), y: Math.round(pr.y) });
        return false;
      });
    }
    if (w.shock && rep === 0) this.explode(p.x + Math.cos(a) * reach * 0.55, p.y + Math.sin(a) * reach * 0.55, w.shock.r * (1 + st.area * 0.5), w.dmg * w.shock.mul, 0, p, 'shock', true);
    this.emit({ t: 'swing', pid: p.pid, a: Math.round(a * 100) / 100, r: Math.round(reach), arc: Math.round(arc * 100) / 100 });
  };

  W.fireWeapon = function (p, a, w, crit) {
    const st = p.stats;
    const n = w.n + st.projN;
    const sp = n > 1 ? Math.max(w.spread || 0, 0.13) : 0;
    for (let i = 0; i < n; i++) {
      const ang = a + (i - (n - 1) / 2) * sp + (w.jitter ? this.rng.range(-w.jitter, w.jitter) : 0);
      this.spawnProj({
        team: 0, kind: w.proj, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed: w.speed, r: w.r,
        dmg: w.dmg, life: w.life, pierce: w.pierce + st.pierce, owner: p.pid, crit, knock: w.knock || 40,
        explode: w.explode ? { r: w.explode.r * (1 + st.area * 0.5) * (st.combust ? 1.4 : 1), mul: w.explode.mul } : null,
        cloud: w.cloud ? { r: w.cloud.r * (1 + st.area * 0.5), dps: w.cloud.dps, dur: w.cloud.dur } : null,
        homing: (w.homing || 0) + (st.homing || 0), healAlly: w.healAlly || 0, burn: w.burn || 0,
      });
    }
  };

  W.playerDash = function (p, dx, dy) {
    if (!p || p.downed || p.dead) return;
    p.dashDx = dx; p.dashDy = dy;
    if (p.stats.dashBomb) this.addZone({ kind: 'bomb', x: p.x, y: p.y, r: 60, dur: 0.6, team: 0, owner: p.pid, dmg: p.stats.weapon.dmg * 2 });
    this.emit({ t: 'dash', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
  };

  // ---------------- projectiles ----------------
  W.spawnProj = function (o) {
    const pr = {
      id: U.uid(), team: o.team, kind: o.kind, x: o.x, y: o.y, vx: Math.cos(o.a) * o.speed, vy: Math.sin(o.a) * o.speed,
      r: o.r || 5, dmg: o.dmg || 1, life: o.life || 2, pierce: o.pierce || 0, owner: o.owner, src: o.src || null,
      crit: o.crit, knock: o.knock || 0, explode: o.explode || null, cloud: o.cloud || null, homing: o.homing || 0,
      healAlly: o.healAlly || 0, burn: o.burn || 0, hit: null, healed: null, accel: o.accel || 0, turn: o.turn || 0, boom: o.boom || null,
    };
    this.projs.push(pr);
    return pr;
  };

  W.enemyShoot = function (e, a, speed, kind, dmgMul, r, extra) {
    const mul = this.pact >= 8 ? 1.2 : 1;
    return this.spawnProj(Object.assign({ team: 1, kind, x: e.x + Math.cos(a) * e.r * 0.6, y: e.y - 4 + Math.sin(a) * e.r * 0.6, a, speed: speed * mul, r: r || 6, dmg: e.dmg * (dmgMul || 1), life: 4, src: e }, extra || {}));
  };

  W.updateProjectiles = function (dt) {
    const room = this.room, locked = this.locked;
    const keep = [];
    for (const pr of this.projs) {
      pr.life -= dt;
      if (pr.life <= 0) { if (pr.team === 0 && pr.explode) this.projBurst(pr); continue; }
      if (pr.homing) {
        let tgt = null;
        if (pr.team === 0) tgt = this.nearestEnemy(pr.x, pr.y, 240, pr.hit);
        else tgt = this.nearestPlayer(pr.x, pr.y);
        if (tgt) {
          const cur = Math.atan2(pr.vy, pr.vx), want = Math.atan2(tgt.y - pr.y, tgt.x - pr.x);
          const sp = Math.hypot(pr.vx, pr.vy);
          const na = cur + U.clamp(U.angDiff(cur, want), -pr.homing * dt, pr.homing * dt);
          pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
        }
      }
      if (pr.turn) { const cur = Math.atan2(pr.vy, pr.vx) + pr.turn * dt, sp = Math.hypot(pr.vx, pr.vy); pr.vx = Math.cos(cur) * sp; pr.vy = Math.sin(cur) * sp; }
      if (pr.accel) { const f = 1 + pr.accel * dt; pr.vx *= f; pr.vy *= f; }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      const t = D.tileAt(room, pr.x, pr.y);
      if (D.blocksShots(t, locked)) {
        if (pr.team === 0 && pr.explode) this.projBurst(pr);
        else if (pr.team === 0 && pr.cloud) this.addZone({ kind: 'plague', x: pr.x - pr.vx * dt, y: pr.y - pr.vy * dt, r: pr.cloud.r, dur: pr.cloud.dur, dps: pr.cloud.dps, owner: pr.owner, team: 0 });
        this.emit({ t: 'spark', x: Math.round(pr.x), y: Math.round(pr.y), k: ED.PROJ_IDX[pr.kind] || 0 });
        continue;
      }
      let dead = false;
      if (pr.team === 0) {
        const owner = this.players.get(pr.owner);
        for (const e of this.enemies) {
          if (e.hp <= 0 || e.spawnT > 0) continue;
          if (pr.hit && pr.hit.has(e.id)) continue;
          const rr = e.r + pr.r;
          if (U.dist2(pr.x, pr.y, e.x, e.y) > rr * rr) continue;
          if (!pr.hit) pr.hit = new Set();
          pr.hit.add(e.id);
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          this.hitEnemy(e, pr.dmg, { p: owner, kind: pr.kind === 'wisp' ? 'wisp' : 'weapon', crit: pr.crit, knock: pr.knock, kx: pr.vx / sp, ky: pr.vy / sp, burn: pr.burn });
          if (pr.explode) { this.projBurst(pr); dead = true; break; }
          if (pr.cloud) { this.addZone({ kind: 'plague', x: pr.x, y: pr.y, r: pr.cloud.r, dur: pr.cloud.dur, dps: pr.cloud.dps, owner: pr.owner, team: 0 }); dead = true; break; }
          if (pr.pierce-- <= 0) { dead = true; break; }
        }
        if (!dead && pr.healAlly && owner) {
          for (const q of this.players.values()) {
            if (q === owner || q.downed || q.dead || q.hp >= q.maxHp) continue;
            if ((pr.healed && pr.healed.has(q.pid)) || U.dist2(pr.x, pr.y, q.x, q.y) > 20 * 20) continue;
            if (!pr.healed) pr.healed = new Set();
            pr.healed.add(q.pid); this.healPlayer(q, pr.healAlly);
          }
        }
      } else {
        for (const p of this.players.values()) {
          if (p.downed || p.dead) continue;
          const rr = p.r + pr.r - 3;
          if (U.dist2(pr.x, pr.y, p.x, p.y) > rr * rr) continue;
          if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillMove) continue; // shots pass through i-frames
          this.hurtPlayer(p, pr.dmg, { proj: true, e: pr.src });
          if (pr.boom) this.explode(pr.x, pr.y, pr.boom.r, pr.dmg * 0.5, 1, pr.src, pr.boom.k);
          dead = true; break;
        }
      }
      if (!dead) keep.push(pr);
    }
    this.projs = keep;
  };

  W.projBurst = function (pr) {
    const owner = this.players.get(pr.owner);
    if (!owner) return;
    this.explode(pr.x, pr.y, pr.explode.r, pr.dmg * pr.explode.mul, 0, owner, pr.kind === 'fireball' ? 'bigfire' : 'fire', true);
  };

  // ---------------- zones: telegraphs, clouds, fire, sanctuary ----------------
  W.addZone = function (z) {
    z.id = U.uid(); z.t = 0; z.tick = 0;
    this.zones.push(z);
    return z;
  };

  W.updateZones = function (dt) {
    const keep = [];
    for (const z of this.zones) {
      z.t += dt;
      if (z.kind === 'laser' && z.update) z.update(this, z, dt);
      const done = z.t >= z.dur;
      if (z.kind === 'spawn') {
        if (done) {
          const e = this.spawnEnemy(z.type, z.x, z.y, { elite: z.elite, affix: z.affix });
          this.emit({ t: 'spawned', x: Math.round(z.x), y: Math.round(z.y), el: z.elite ? 1 : 0 });
          if (z.after) z.after(e);
          continue;
        }
      } else if (z.kind === 'tele' || z.kind === 'teleLine' || z.kind === 'teleCone' || z.kind === 'bomb' || z.kind === 'decoy') {
        if (done) { this.resolveTele(z); continue; }
      } else if (z.kind === 'laser') {
        if (z.t > z.warm) {
          z.tick -= dt;
          if (z.tick <= 0) {
            z.tick = 0.12;
            const x1 = z.x + Math.cos(z.a) * z.len, y1 = z.y + Math.sin(z.a) * z.len;
            for (const p of this.players.values()) if (U.segDist2(p.x, p.y, z.x, z.y, x1, y1) < (z.w / 2 + p.r) ** 2) this.hurtPlayer(p, z.dmg, { e: z.src });
          }
        }
        if (done) continue;
      } else {
        // damage-over-time fields
        z.tick -= dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          if (z.team === 0) {
            const owner = this.players.get(z.owner);
            for (const e of this.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(z.x, z.y, e.x, e.y) < (z.r + e.r) ** 2) this.hitEnemy(e, z.dps * 0.5, { p: owner, kind: 'dot', noProc: true, crit: false });
          } else if (z.dps) {
            for (const p of this.players.values()) if (U.dist2(z.x, z.y, p.x, p.y) < (z.r + p.r * 0.5) ** 2) this.hurtPlayer(p, z.dps * 0.5, { hazard: true });
          }
        }
        if (done) continue;
      }
      keep.push(z);
    }
    // zones created mid-loop were appended to this.zones and visited by the same for-of
    this.zones = keep;
  };

  W.resolveTele = function (z) {
    if (z.warnOnly) { if (z.onEnd) z.onEnd(this, z); return; }
    if (z.team === 0) {
      const owner = this.players.get(z.owner);
      if (owner) this.explode(z.x, z.y, z.r, z.dmg, 0, owner, z.boom || 'shock', true);
      return;
    }
    if (z.kind === 'tele') {
      for (const p of this.players.values()) if (Math.hypot(p.x - z.x, p.y - z.y) < z.r + p.r * 0.6) this.hurtPlayer(p, z.dmg, { e: z.src });
      this.emit({ t: 'boom', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: z.boom || 'slam' });
    } else if (z.kind === 'teleLine') {
      const x1 = z.x + Math.cos(z.a) * z.len, y1 = z.y + Math.sin(z.a) * z.len;
      for (const p of this.players.values()) if (U.segDist2(p.x, p.y, z.x, z.y, x1, y1) < (z.w / 2 + p.r * 0.6) ** 2) this.hurtPlayer(p, z.dmg, { e: z.src });
    } else if (z.kind === 'teleCone') {
      for (const p of this.players.values()) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d < z.r + p.r && Math.abs(U.angDiff(z.a, Math.atan2(p.y - z.y, p.x - z.x))) < z.arc / 2) this.hurtPlayer(p, z.dmg, { e: z.src });
      }
      this.emit({ t: 'cone', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), a: z.a, arc: z.arc });
    }
    if (z.onEnd) z.onEnd(this, z);
  };

  // ---------------- generic enemy tick (behaviour lives in ai.js) ----------------
  W.updateEnemy = function (e, dt) {
    if (e.hp <= 0) return;
    e.flash -= dt; e.mark -= dt; e.contactCd -= dt; e.invulnT = (e.invulnT || 0) - dt;
    if (e.spawnT > 0) { e.spawnT -= dt; return; }
    if (e.burn > 0) {
      e.burn -= dt; e.burnTick -= dt;
      if (e.burnTick <= 0) { e.burnTick = 0.5; this.hitEnemy(e, e.burnDps * 0.5, { p: e.burnOwner, kind: 'dot', noProc: true, crit: false, raw: true }); if (e.hp <= 0) return; }
    } else e.burnDps = 0;
    e.chill -= dt; e.frozen -= dt; e.stun -= dt;
    if (e.kbx || e.kby) {
      Sim.moveCircle(e, e.kbx * dt, e.kby * dt, this.room, this.locked, e.fly);
      const f = Math.max(0, 1 - 9 * dt); e.kbx *= f; e.kby *= f;
      if (Math.abs(e.kbx) + Math.abs(e.kby) < 4) { e.kbx = 0; e.kby = 0; }
    }
    if (!e.exposed && this.enc && ((!e.boss && this.roomTime > 45) || (e.boss && this.roomTime > 78))) { e.exposed = true; this.emit({ t: 'expose', x: e.x, y: e.y, boss: e.boss ? 1 : 0 }); }
    if (e.exposed) e.hp -= e.maxHp * (e.boss ? 0.012 : 0.04) * dt;
    if (e.hp <= 0) { this.killEnemy(e, null, {}); return; }
    if (e.frozen > 0 || e.stun > 0) return;
    e.slow = e.chill > 0 ? 0.55 : 1;
    e.tgtT -= dt;
    if (e.tgtT <= 0 || !this.alive(e.target)) { e.target = this.nearestPlayer(e.x, e.y); e.tgtT = 0.6; }
    if (!e.target) return;
    const ai = ED.AI[e.def.ai];
    if (ai) ai(this, e, dt);
    // contact damage
    if (e.contactCd <= 0 && e.def.ai !== 'bomber') {
      for (const p of this.players.values()) {
        if (p.downed || p.dead) continue;
        const rr = e.r + p.r - 3;
        if (U.dist2(e.x, e.y, p.x, p.y) < rr * rr) {
          const strong = e.st === 'lunge' || e.st === 'charge';
          if (this.hurtPlayer(p, e.dmg * (strong ? 1 : 0.75) * (e.boss ? 0.8 : 1), { e })) { e.contactCd = 0.8; e.recoil = 0.35; }
          break;
        }
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
