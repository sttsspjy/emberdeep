// Hero build: experience and levels, boon offers and picks, per-hero build state, companions (orbit blades, wisps, minions).
// world.js calls the hooks below at fixed points (player creation, run start, stratum start, per-tick).
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim;
  const W = ED.World.prototype;

  // ---------------- hooks called by world.js ----------------
  // Called from addPlayer before the first recalc: add build-only fields to the hero.
  W.initBuild = function (p) { /* no extra fields yet */ };

  // Called once per hero from startRun: meta bundle effects that apply at the start of a descent.
  W.onRunStartBuild = function (p) {
    const rk = (id) => (p.meta.up && p.meta.up[ED.UPGRADE_IDX[id]]) || 0;
    const sw = rk('secondwind');
    p.secondWind = sw > 0 ? 1 : 0; p.swPct = sw >= 2 ? 0.7 : 0.4;
    p.rerolls = rk('insight') + (p.meta.mastery >= 8 ? 1 : 0);
    p.picks += rk('headstart');
    const arm = rk('armory');
    if (arm) {
      const pool = (p.meta.relics || []).filter(id => (arm >= 2 ? ED.RELICS[id].rar !== 'c' : ED.RELICS[id].rar === 'c') && !p.relics.includes(id));
      if (pool.length) { p.relics.push(this.rng.pick(pool)); this.recalc(p, true); }
    }
  };

  // Called once per hero from enterStratum (after downed/dead heroes are restored).
  W.onStratumBuild = function (p, s) {
    const prov = 0.15 * ((p.meta.up && p.meta.up[ED.UPGRADE_IDX.provisions]) || 0);
    const heal = prov + (p.stats.strataHeal || 0);
    if (s > 1 && heal > 0) this.healPlayer(p, p.maxHp * heal);
    p.angelUsed = false;
    if (p.stats.cloverRerolls && s > 1) p.rerolls += p.stats.cloverRerolls;
  };

  // Called every tick from updatePlayer for a living, standing hero (after hazards).
  W.updatePlayerBuild = function (p, dt) {
    const st = p.stats;
    if (st.regen > 0) this.healPlayer(p, st.regen * dt, true);
    if (st.aegis) p.aegisT = Math.max(0, p.aegisT - dt);
    p.guardCd -= dt; p.guardT -= dt; p.frozenCd -= dt; p.tranceT -= dt; p.wallT -= dt;
    this.updateSkills(p, dt);
    this.updatePlayerCombat(p, dt);
  };

  // Called by playerSkill after any skill resolves (slot 0 = K, 1 = L).
  W.onSkillCast = function (p, slot) {
    const st = p.stats, area = 1 + st.area * 0.5;
    if (st.overcharge) this.explode(p.x, p.y, 85 * area, st.weapon.dmg * 1.5 * st.overcharge + 10, 0, p, 'shock', true);
    if (st.trance) p.tranceT = 4;
  };

  // ---------------- xp, levels and boons ----------------
  W.addXp = function (v) {
    this.xp += v;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level++; this.xpNext = ED.World.xpFor(this.level);
      for (const p of this.players.values()) p.picks++;
      this.emit({ t: 'levelup', level: this.level });
    }
  };

  W.updateOffers = function (dt) {
    const safe = this.isSafe();
    for (const p of this.players.values()) {
      if (p.offer) {
        p.offerT += dt;
        // AFK guard so a party is never stuck behind one player (a solo hero may take as long as they like)
        if (p.offerT > 45 && this.players.size > 1) this.pickBoon(p.pid, 0);
      } else if (p.picks > 0 && safe && !p.downed && !p.dead) {
        p.offer = this.rollBoons(p); p.offerT = 0;
        this.msgs.push({ to: p.pid, t: 'offer', boons: p.offer, rerolls: p.rerolls, picks: p.picks });
      }
    }
  };

  W.rollBoons = function (p) {
    const n = 3 + (p.stats.choices ? 1 : 0);
    const kind = p.stats.kind;
    const epic = p.epicNext;
    let pool = ED.BOON_IDS.filter(id => {
      const b = ED.BOONS[id];
      if (b.cls && b.cls !== p.cls) return false;
      if (b.need && b.need !== kind) return false;
      if ((p.boons[id] || 0) >= (b.max || 5)) return false;
      if (epic && b.rar === 'c') return false;
      return true;
    });
    if (pool.length < n) pool = ED.BOON_IDS.filter(id => !ED.BOONS[id].cls || ED.BOONS[id].cls === p.cls);
    const luck = p.stats.luck || 0, s = this.stratum;
    const w = { c: 60, r: 28 + luck * 60 + s * 2.5, e: 8 + luck * 40 + s * 2 };
    const out = [];
    for (let i = 0; i < n && pool.length; i++) {
      const id = this.rng.weighted(pool, x => w[ED.BOONS[x].rar] * (ED.BOONS[x].cls ? 1.7 : 1) * ((p.boons[x] || 0) > 0 ? 1.15 : 1));
      out.push(id); pool = pool.filter(x => x !== id);
    }
    return out;
  };

  W.pickBoon = function (pid, idx) {
    const p = this.players.get(pid);
    if (!p || !p.offer) return;
    const id = p.offer[U.clamp(idx | 0, 0, p.offer.length - 1)];
    const b = ED.BOONS[id];
    p.boons[id] = (p.boons[id] || 0) + 1;
    this.recalc(p, false);
    if (b.heal) this.healPlayer(p, b.heal);
    if (b.mods.charges) p.chargeBonus = true;
    p.picks = Math.max(0, p.picks - 1); p.offer = null; p.epicNext = false;
    this.emit({ t: 'boon', pid, id, x: p.x, y: p.y });
    this.sendBuild(p);
    this.msgs.push({ to: pid, t: 'offerDone' });
  };

  W.reroll = function (pid) {
    const p = this.players.get(pid);
    if (!p || !p.offer || p.rerolls <= 0) return;
    p.rerolls--;
    p.offer = this.rollBoons(p);
    this.msgs.push({ to: pid, t: 'offer', boons: p.offer, rerolls: p.rerolls, picks: p.picks });
  };

  // ---------------- allies & companions ----------------
  W.spawnMinion = function (owner, x, y, life) {
    const st = owner.stats;
    const mine = this.allies.filter(a => a.owner === owner.pid);
    if (mine.length >= st.maxMinions) { mine.sort((a, b) => a.life - b.life); mine[0].life = 0; }
    this.allies.push({ id: U.uid(), owner: owner.pid, x, y, r: 9, life, maxLife: life, cd: 0.5, face: 1,
      dmg: (6 + st.weapon.dmg * 0.6) * (1 + st.minionDmg) });
    this.emit({ t: 'raise', x, y });
  };

  W.updateAllies = function (dt) {
    const keep = [];
    for (const a of this.allies) {
      a.life -= dt; a.cd -= dt;
      const owner = this.players.get(a.owner);
      if (a.life <= 0 || !owner) {
        if (owner && owner.stats.boneSpikes) this.explode(a.x, a.y, 60, owner.stats.weapon.dmg * 1.5 * owner.stats.dmg, 0, owner, 'bone');
        this.emit({ t: 'puff', x: a.x, y: a.y, c: '#7dffd9' });
        continue;
      }
      const tgt = this.nearestEnemy(a.x, a.y, 400);
      let tx, ty;
      if (tgt) { tx = tgt.x; ty = tgt.y; } else { tx = owner.x + Math.cos(a.id) * 30; ty = owner.y + Math.sin(a.id) * 30; }
      const d = Math.hypot(tx - a.x, ty - a.y);
      if (tgt && d < a.r + tgt.r + 6) {
        if (a.cd <= 0) { a.cd = 0.7; this.hitEnemy(tgt, a.dmg, { p: owner, kind: 'minion', noProc: true, knock: 40, kx: (tx - a.x) / (d || 1), ky: (ty - a.y) / (d || 1), raw: true }); }
      } else if (d > 6) {
        const dir = this.pathDir(a, tx, ty);
        Sim.moveCircle(a, dir[0] * 105 * dt, dir[1] * 105 * dt, this.room, this.locked, false);
        a.face = dir[0] >= 0 ? 1 : -1;
      }
      keep.push(a);
    }
    this.allies = keep;
  };

  W.updateCompanions = function (dt) {
    const t = this.time;
    for (const p of this.players.values()) {
      if (p.downed || p.dead) continue;
      const st = p.stats;
      if (st.orbit > 0) {
        const n = st.orbit, dmg = 6 + st.weapon.dmg * 0.5;
        for (let i = 0; i < n; i++) {
          const a = t * 3.2 + i * U.TAU / n;
          const ox = p.x + Math.cos(a) * 44, oy = p.y + Math.sin(a) * 44;
          for (const e of this.enemies) {
            if (e.hp <= 0 || e.spawnT > 0) continue;
            if (U.dist2(ox, oy, e.x, e.y) > (e.r + 10) ** 2) continue;
            const key = e.id;
            if ((p.orbHit[key] || 0) > t) continue;
            p.orbHit[key] = t + 0.4;
            this.hitEnemy(e, dmg, { p, kind: 'orbit', knock: 60, kx: Math.cos(a + 1.57), ky: Math.sin(a + 1.57) });
          }
        }
      }
      if (st.wisp > 0) {
        p.wispT -= dt;
        if (p.wispT <= 0) {
          p.wispT = 1.1 / st.wisp;
          const tgt = this.nearestEnemy(p.x, p.y, 280);
          if (tgt) {
            const k = Math.floor(t * 10) % st.wisp;
            const wa = t * 1.6 + k * U.TAU / st.wisp;
            const wx = p.x + Math.cos(wa) * 26, wy = p.y - 14 + Math.sin(wa) * 10;
            const a = U.angle(wx, wy, tgt.x, tgt.y);
            this.spawnProj({ team: 0, kind: 'wisp', x: wx, y: wy, a, speed: 330, r: 5, dmg: 5 + st.weapon.dmg * 0.45, life: 1.2, owner: p.pid, homing: 3, knock: 20 });
          }
        }
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
