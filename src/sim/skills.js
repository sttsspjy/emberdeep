// Hero skills: the class skills on K (slot 0) and L (slot 1), their per-hero state and the damage they block.
(function (ED) {
  'use strict';
  const U = ED.U;
  const W = ED.World.prototype;

  ED.CONST.SANCT_HEAL = 0.07; // Sanctuary: allies within 180 heal this fraction of max HP
  ED.CONST.SANCT_DR = 0.85; // Sanctuary: damage multiplier of an ally standing inside the zone
  const BULWARK_HALF = 1.309; // ±75°
  const HAMMER_OUT = 0.55, HAMMER_SPEED = 360, HAMMER_BACK = 420;
  const NO_HIT = { has: () => true, add: () => {} }; // hammer pr.hit: updateProjectiles never collides with it, updateHammers does

  // Area hit on foes (kind 'skill': infusions and hemomancy apply; ground blasts ignore guard). Calls onHit(e, dealt) per foe struck.
  function blast(world, p, x, y, r, dmg, knock, onHit) {
    for (const e of world.enemies) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d >= r + e.r) continue;
      const dealt = world.hitEnemy(e, dmg, { p, kind: 'skill', knock, kx: (e.x - x) / (d || 1), ky: (e.y - y) / (d || 1), noGuard: true, x, y });
      if (onHit) onHit(e, dealt);
    }
  }

  // How each skill is aimed until ED.SKILLS[id] carries it: 'dir' flies toward the cursor, 'ground' lands on it (clamped to `range`), 'move' travels toward it, 'self' ignores it.
  const AIM = {
    charge: { aim: 'move', range: 150 }, step: { aim: 'move', range: 140 }, volley: { aim: 'dir' }, nova: { aim: 'self' },
    sanctuary: { aim: 'ground', range: 200 }, legion: { aim: 'ground', range: 160 }, bulwark: { aim: 'dir' },
    rain: { aim: 'ground', range: 260 }, meteor: { aim: 'ground', range: 300 }, vanish: { aim: 'self' }, judgment: { aim: 'dir' }, harvest: { aim: 'dir' },
  };
  const AIM_DIR = { aim: 'dir', range: 0 };
  ED.skillAim = (id) => { const d = ED.SKILLS[id]; return (d && d.aim) ? d : (AIM[id] || AIM_DIR); };
  // Area radius of a ground skill for a hero's stats: the sim and the client's landing preview read the same numbers.
  ED.skillRadius = (id, st) => {
    const area = 1 + st.area * 0.5;
    return id === 'rain' ? 80 * area * (st.barrage ? 1.4 : 1) : id === 'meteor' ? 95 * area : id === 'sanctuary' ? 100 * area : id === 'legion' ? 35 : 0;
  };

  // Landing point of a ground skill: from the client's origin (accepted within 48 px of the host's hero) to its {x, y}, else along the aim at min(200, range); clamped to range and cut at walls.
  function targetPoint(world, p, a, data, range) {
    const fin = (v) => typeof v === 'number' && isFinite(v);
    let x0 = p.x, y0 = p.y;
    if (fin(data.x0) && fin(data.y0) && U.dist2(data.x0, data.y0, p.x, p.y) <= 48 * 48) { x0 = data.x0; y0 = data.y0; }
    let tx = x0 + Math.cos(a) * Math.min(200, range), ty = y0 + Math.sin(a) * Math.min(200, range);
    if (fin(data.x) && fin(data.y)) { tx = data.x; ty = data.y; }
    return ED.Sim.groundPoint(world.room, world.locked, x0, y0, tx, ty, range);
  }
  // targetPoint pushed out of walls for a body of radius r (zone centres, minion spawns).
  function spotPoint(world, p, a, data, id, r) {
    const t = targetPoint(world, p, a, data, ED.skillAim(id).range);
    const probe = { x: t.x, y: t.y, r };
    ED.Sim.resolve(probe, world.room, world.locked, false);
    return probe;
  }

  // Called from addPlayer: per-hero skill state (p.stats is not built yet).
  W.initSkills = function (p) {
    p.bulwarkT = 0; p.bulwarkEnd = 0; p.blocks = 0; p.blockSeen = {};
    p.stealthT = 0; p.ambush = false; p.ambushT = 0;
    p.hammers = []; p.critStacks = 0;
  };

  // Called from hurtPlayer before damage lands. Return true when a skill fully blocks the hit.
  // Bulwark blocks hits whose origin lies within ±75° of p.face (all sides with mirrorguard); hazards never.
  W.skillBlock = function (p, amount, src) {
    if (!(p.bulwarkT > 0) || !src || src.hazard) return false;
    const pr = src.pr, foe = src.e;
    let ox, oy;
    if (typeof src.x === 'number' && typeof src.y === 'number') { ox = src.x; oy = src.y; }
    else if (pr) { ox = pr.x; oy = pr.y; }
    else if (foe) { ox = foe.x; oy = foe.y; }
    else return false;
    if (U.dist2(ox, oy, p.x, p.y) < 16) return false; // no usable direction
    const st = p.stats;
    if (!st.mirrorguard && Math.abs(U.angDiff(p.face, Math.atan2(oy - p.y, ox - p.x))) > BULWARK_HALF) return false;
    // repeated hits from one non-projectile source (contact, beams) count once per 0.6 s
    if (!pr) {
      const key = foe ? foe.id : 0;
      if (foe) foe.contactCd = Math.max(foe.contactCd || 0, 1.0);
      if ((p.blockSeen[key] || 0) > this.time) return true;
      p.blockSeen[key] = this.time + 0.6;
    }
    if (p.blocks < 6) p.blocks++;
    if (pr && pr.team === 1) { // reflect: the projectile turns friendly and flies back
      pr.team = 0; pr.owner = p.pid; pr.vx = -pr.vx; pr.vy = -pr.vy;
      pr.dmg = (15 + st.weapon.dmg) * (st.mirrorguard ? 2.5 : 1);
      pr.hit = null; pr.life = 2; pr.pierce = 0; pr.src = null; pr.crit = false;
      pr.explode = null; pr.cloud = null; pr.boom = null; pr.homing = 0; pr.turn = 0; pr.accel = 0; pr.burn = 0; pr.healAlly = 0;
    }
    this.emit({ t: 'block', x: Math.round(p.x), y: Math.round(p.y), k: 'bulwark' });
    return true;
  };

  // Called every tick from updatePlayerBuild for a living, standing hero.
  W.updateSkills = function (p, dt) {
    if (p.bulwarkT > 0) {
      if (this.time - p.bulwarkEnd > 0.25) p.bulwarkT = 0; // stale: the hero was down, no bash
      else if ((p.bulwarkT -= dt) <= 0) { p.bulwarkT = 0; this.bulwarkBash(p); }
    }
    if (p.stealthT > 0) p.stealthT = Math.max(0, p.stealthT - dt);
    if (p.ambush && (p.ambushT -= dt) <= 0) p.ambush = false;
    if (p.hammers.length) this.updateHammers(p, dt);
  };

  // Bulwark release: cone r70 arc 1.6 toward p.face, +25% per counted block, knock 220 (bastion stuns 1.2 s).
  W.bulwarkBash = function (p) {
    const st = p.stats, w = st.weapon, a = p.face, r = 70 * (1 + st.area * 0.5), arc = 1.6;
    const dmg = (20 + 1.2 * w.dmg) * (1 + 0.25 * p.blocks);
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d - e.r > r) continue;
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      if (Math.abs(U.angDiff(a, ang)) > arc / 2 + Math.atan2(e.r, Math.max(d, 1))) continue;
      this.hitEnemy(e, dmg, { p, kind: 'skill', knock: 220, kx: Math.cos(ang), ky: Math.sin(ang) });
      if (st.bastion && e.hp > 0 && !e.boss) e.stun = Math.max(e.stun, 1.2);
    }
    p.blocks = 0;
    this.emit({ t: 'cone', x: Math.round(p.x), y: Math.round(p.y), r: Math.round(r), a, arc });
  };

  // Judgment hammers: flight out for 0.55 s, then back to the hero; each leg hits a foe once (own hit set, pr.hit is blanked).
  W.throwHammer = function (p, a) {
    const st = p.stats, area = 1 + st.area * 0.5;
    const pr = this.spawnProj({ team: 0, kind: 'hammer', x: p.x, y: p.y - 4, a, speed: HAMMER_SPEED, r: 18 * area, dmg: 0, life: 2.2, pierce: 999, owner: p.pid });
    pr.hit = NO_HIT;
    p.hammers.push({ pr, leg: 0, t: 0, hit: new Set(), x: p.x, y: p.y, room: this.room });
  };

  W.updateHammers = function (p, dt) {
    const st = p.stats, dmg = 18 + 1.4 * st.weapon.dmg, keep = [];
    for (const h of p.hammers) {
      if (h.room !== this.room) continue; // room changed: projectiles were cleared
      if (this.projs.indexOf(h.pr) < 0) { // wall hit on the way out: turn around from the last free position
        if (h.leg !== 0) continue;
        const a = Math.atan2(p.y - h.y, p.x - h.x);
        h.pr = this.spawnProj({ team: 0, kind: 'hammer', x: h.x, y: h.y, a, speed: HAMMER_BACK, r: h.pr.r, dmg: 0, life: 2.2, pierce: 999, owner: p.pid });
        h.pr.hit = NO_HIT; h.leg = 1; h.hit.clear();
      }
      const pr = h.pr;
      h.t += dt;
      if (h.leg === 0 && h.t >= HAMMER_OUT) { h.leg = 1; h.hit.clear(); }
      if (h.leg === 1) {
        const dx = p.x - pr.x, dy = p.y - 4 - pr.y, d = Math.hypot(dx, dy) || 1;
        if (d < p.r + 8 || h.t > 2.1) { pr.life = 0; continue; }
        pr.vx = dx / d * HAMMER_BACK; pr.vy = dy / d * HAMMER_BACK;
      }
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0 || h.hit.has(e.id)) continue;
        if (U.dist2(pr.x, pr.y, e.x, e.y) > (e.r + pr.r) ** 2) continue;
        h.hit.add(e.id);
        e.judged = Math.max(e.judged || 0, 4); e.judgeUntil = this.time + 4; e.judgeOwner = p.pid;
        this.hitEnemy(e, dmg, { p, kind: 'skill', knock: 90, kx: pr.vx / sp, ky: pr.vy / sp, x: pr.x, y: pr.y });
      }
      h.x = pr.x; h.y = pr.y;
      keep.push(h);
    }
    p.hammers = keep;
  };

  // Meteor: friendly telegraph zone, then impact r95, Burn 50% of the impact, crater; Twin Meteor chains one more.
  W.castMeteor = function (p, x, y, delay, twin) {
    this.addZone({ kind: 'meteor', x, y, r: ED.skillRadius('meteor', p.stats), dur: delay, team: 0, owner: p.pid, custom: true,
      onEnd: (w, z) => {
        const o = w.players.get(z.owner); if (!o) return;
        const st = o.stats, dmg = 30 + 3.5 * st.weapon.dmg;
        blast(w, o, z.x, z.y, z.r, dmg, 220, (e, dealt) => { if (e.hp > 0 && dealt > 0) w.addBurn(e, dealt * 0.5, o); });
        w.emit({ t: 'boom', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: 'bigfire' });
        w.addZone({ kind: 'pfire', x: z.x, y: z.y, r: 60 * (1 + st.area * 0.5), dur: st.moltenCore ? 9 : 3, dps: (8 + 0.8 * st.weapon.dmg) * (st.moltenCore ? 2 : 1), owner: o.pid, team: 0 });
        if (st.twinMeteor && !twin) {
          const t = w.nearestEnemy(z.x, z.y, 500);
          if (t) w.castMeteor(o, t.x, t.y, 0.6, true);
        }
      } });
  };

  // Called from killEnemy for every slain foe (p = credited hero or null).
  W.onEnemyKilledSkill = function (e, p, src) {
    if (e.judgeUntil > this.time) { // Judged foe: heals allies within 160 by 3% max HP (through the sustain cap); Verdict explodes it
      for (const q of this.players.values()) if (!q.downed && !q.dead && U.dist2(q.x, q.y, e.x, e.y) < 160 * 160) this.sustainHeal(q, q.maxHp * 0.03);
      const o = this.players.get(e.judgeOwner);
      if (o && o.stats.verdict) {
        const r = 70 * (1 + o.stats.area * 0.5);
        blast(this, o, e.x, e.y, r, 60 + 1.5 * o.stats.weapon.dmg, 90);
        this.emit({ t: 'boom', x: Math.round(e.x), y: Math.round(e.y), r: Math.round(r), k: 'shock' });
      }
    }
    if (p && src && src.ambush && p.stats.nightsEdge) this.msgs.push({ to: p.pid, t: 'refund', slot: 1 });
  };

  // Soul Siphon: a minion hit heals its owner 0.15% max HP through the sustain cap. Called by updateAllies.
  W.soulSiphon = function (p) { this.sustainHeal(p, p.maxHp * 0.0015); };

  // Slot 1 skills. Each returns false to reject the cast (no cost) or an object of extra event fields.
  const SLOT2 = {
    bulwark(p, a, data, st) {
      if (p.bulwarkT > 0) return false;
      const dur = 1.4 * (st.bastion ? 1.5 : 1);
      p.face = a; p.bulwarkT = dur; p.bulwarkEnd = this.time + dur; p.blocks = 0; p.blockSeen = {};
      return {};
    },
    rain(p, a, data, st, w) {
      const t = targetPoint(this, p, a, data, ED.skillAim('rain').range);
      const r = ED.skillRadius('rain', st), dur = 2 + (st.barrage ? 1 : 0), dmg = 4 + 0.45 * w.dmg, hail = !!st.hailthorns;
      const n = Math.round(dur / 0.25);
      let k = 0;
      this.addZone({ kind: 'rain', x: t.x, y: t.y, r, dur: 0.35 + dur, team: 0, owner: p.pid, custom: true,
        update: (world, z) => {
          if (z.t < 0.35) return;
          const o = world.players.get(z.owner); if (!o) return;
          const tick = k < n && z.t >= 0.35 + 0.25 * k;
          if (tick) k++;
          for (const e of world.enemies) {
            if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
            if (hail) { world.slowEnemy(e, 0.5, 0.3); e.vulnT = Math.max(e.vulnT || 0, 0.3); }
            if (tick) world.hitEnemy(e, dmg, { p: o, kind: 'skill', noGuard: true, x: z.x, y: z.y });
          }
        } });
      return { tx: Math.round(t.x), ty: Math.round(t.y) };
    },
    meteor(p, a, data) {
      const t = targetPoint(this, p, a, data, ED.skillAim('meteor').range);
      this.castMeteor(p, t.x, t.y, 0.9, false);
      return { tx: Math.round(t.x), ty: Math.round(t.y) };
    },
    vanish(p, a, data, st, w, area) {
      const smoke = !!st.smokescreen, r = 75 * area * (smoke ? 1.4 : 1);
      p.stealthT = 2.5; p.ambush = true; p.ambushT = 3;
      this.addZone({ kind: 'smoke', x: p.x, y: p.y, r, dur: 3 + (smoke ? 2 : 0), team: 0, owner: p.pid, custom: true,
        update: (world, z) => {
          for (const e of world.enemies) {
            if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
            world.slowEnemy(e, 0.4, 0.3);
            e.blind = Math.max(e.blind || 0, 0.3);
            if (smoke) e.vulnT = Math.max(e.vulnT || 0, 0.3);
          }
        } });
      for (let i = 0; i < 6; i++) { const an = i * U.TAU / 6; this.emit({ t: 'puff', x: Math.round(p.x + Math.cos(an) * r * 0.5), y: Math.round(p.y + Math.sin(an) * r * 0.5), c: '#8a86a0' }); }
      return {};
    },
    judgment(p, a, data, st) {
      if (st.twinHammer) { this.throwHammer(p, a - 0.2); this.throwHammer(p, a + 0.2); } else this.throwHammer(p, a);
      return {};
    },
    harvest(p, a, data, st, w, area) {
      const mine = this.allies.filter(q => q.owner === p.pid);
      const r = 60 * area, dmg = (24 + 1.8 * w.dmg) * (st.grimHarvest ? 1.5 : 1);
      for (const m of mine) {
        blast(this, p, m.x, m.y, r, dmg, 90);
        this.emit({ t: 'boom', x: Math.round(m.x), y: Math.round(m.y), r: Math.round(r), k: 'bone' });
      }
      if (mine.length) { const gone = new Set(mine); this.allies = this.allies.filter(q => !gone.has(q)); this.healPlayer(p, p.maxHp * 0.03 * mine.length); }
      const n = st.grimHarvest ? 2 : mine.length ? 1 : 2;
      for (let i = 0; i < n; i++) { const an = a + (i - (n - 1) / 2) * 0.9; this.spawnMinion(p, p.x + Math.cos(an) * 26, p.y + Math.sin(an) * 26, 12); }
      return {};
    },
  };

  // data: { x0, y0, x1, y1 } for movement skills (performed by the hero's own client); { x0, y0, x, y } for ground skills (cast origin and aimed point, see targetPoint).
  W.playerSkill = function (p, a, data, slot) {
    if (!p || p.downed || p.dead) return;
    slot = slot === 1 ? 1 : 0;
    const cls = ED.CLASSES[p.cls];
    const skill = slot ? cls.skill2 : cls.skill;
    if (!skill || (slot && !SLOT2[skill])) return;
    const st = p.stats, w = st.weapon;
    const area = 1 + st.area * 0.5;
    data = data || {};
    let extra = null;
    if (slot === 1) {
      extra = SLOT2[skill].call(this, p, a, data, st, w, area);
      if (!extra) return;
    } else if (skill === 'charge') {
      const x0 = data.x0 ?? p.x, y0 = data.y0 ?? p.y, x1 = data.x1 ?? p.x + Math.cos(a) * 150, y1 = data.y1 ?? p.y + Math.sin(a) * 150;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + 26) ** 2) {
          this.hitEnemy(e, 20 + w.dmg * 1.6, { p, kind: 'skill', knock: 260, kx: Math.cos(a), ky: Math.sin(a) });
          if (!e.boss) e.stun = Math.max(e.stun, 1.0);
        }
      }
      if (st.shieldwall) p.wallT = 3;
      if (st.quake) this.addZone({ kind: 'tele', x: x1, y: y1, r: 95 * area, dur: 0.3, team: 0, owner: p.pid, dmg: w.dmg * 2.5, boom: 'shock' });
      p.invuln = Math.max(p.invuln, 0.35);
    } else if (skill === 'volley') {
      const n = 7 + (st.arrowStorm ? 5 : 0), spread = 1.2;
      for (let i = 0; i < n; i++) {
        const ang = a + (i / (n - 1) - 0.5) * spread;
        this.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y - 4, a: ang, speed: 480, r: 5, dmg: w.dmg * 1.2 * (st.arrowStorm ? 1.5 : 1) + 4, life: 0.8, pierce: 1 + st.pierce, owner: p.pid, knock: 60 });
      }
    } else if (skill === 'nova') {
      const r = 105 * area * (st.combust ? 1.2 : 1);
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < r + e.r) { this.hitEnemy(e, 22 + w.dmg * 2.5, { p, kind: 'skill', knock: 200, kx: (e.x - p.x) / (d || 1), ky: (e.y - p.y) / (d || 1) }); if (e.hp > 0) this.addBurn(e, (w.dmg * 0.8 + 4) * 3, p); }
      }
      this.emit({ t: 'nova', x: p.x, y: p.y, r, c: '#ff7a2a' });
      if (st.phoenixNova) { this.healPlayer(p, p.maxHp * 0.12); this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: r * 0.8, dur: 3, dps: 8 + w.dmg, owner: p.pid, team: 0 }); }
    } else if (skill === 'step') {
      const x0 = data.x0 ?? p.x, y0 = data.y0 ?? p.y, x1 = data.x1 ?? p.x, y1 = data.y1 ?? p.y;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + 20) ** 2) this.hitEnemy(e, 12 + w.dmg * 2.2, { p, kind: 'skill', crit: true, knock: 60, kx: Math.cos(a), ky: Math.sin(a) });
      }
      p.critStacks = 3;
      if (st.decoy) this.addZone({ kind: 'decoy', x: x0, y: y0, r: 80 * area, dur: 1.4, team: 0, owner: p.pid, dmg: w.dmg * 3, boom: 'shadow' });
      this.emit({ t: 'blink', pid: p.pid, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) });
    } else if (skill === 'sanctuary') { // ground skill: the zone lands at the aimed point; the caster always heals, allies within 180 of the zone
      const g = spotPoint(this, p, a, data, skill, 4), r = ED.skillRadius(skill, st);
      for (const q of this.players.values()) if (!q.downed && !q.dead && (q === p || U.dist2(q.x, q.y, g.x, g.y) < 180 * 180)) this.healPlayer(q, q.maxHp * ED.CONST.SANCT_HEAL);
      this.addZone({ kind: 'sanct', x: g.x, y: g.y, r, dur: 3.5, dps: (10 + w.dmg * 1.2) * (st.wrath ? 3 : 1), owner: p.pid, team: 0 });
      if (st.wrath) for (const e of this.enemies) if (e.hp > 0 && !e.boss && U.dist2(e.x, e.y, g.x, g.y) < r * r) e.stun = Math.max(e.stun, 1.2);
      extra = { x: Math.round(g.x), y: Math.round(g.y) };
    } else if (skill === 'legion') { // ground skill: 3 minions fan out around the aimed point
      const g = spotPoint(this, p, a, data, skill, 4);
      for (let i = 0; i < 3; i++) {
        const an = a + (i - 1) * 0.9, m = { x: g.x + Math.cos(an) * 26, y: g.y + Math.sin(an) * 26, r: 9 };
        ED.Sim.resolve(m, this.room, this.locked, false);
        this.spawnMinion(p, m.x, m.y, 12);
      }
      extra = { x: Math.round(g.x), y: Math.round(g.y) };
    }
    this.onSkillCast(p, slot);
    this.emit(Object.assign({ t: 'skill', pid: p.pid, k: skill, a: Math.round(a * 100) / 100, x: Math.round(p.x), y: Math.round(p.y), slot }, extra));
  };
})(globalThis.ED || (globalThis.ED = {}));
