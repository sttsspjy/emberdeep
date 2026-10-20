// Hero build: experience and levels, boon offers and picks, per-hero build state, companions (orbit blades, wisps, minions).
// world.js calls the hooks below at fixed points (player creation, run start, stratum start, per-tick).
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim;
  const W = ED.World.prototype;

  // ---------------- hooks called by world.js ----------------
  // Called from addPlayer before the first recalc: add build-only fields to the hero (offer queue, companion and dash-boon state).
  W.initBuild = function (p) { p.offers = []; p.picks = 0; p.bladeT = []; p.orbHit = {}; p.wispT = 0; p.dashHit = null; p.dashTrail = 0; };

  // Queue an offer spec {src:'level'|'room'|'class'|'start'|'forge'|'epic', path?}; p.picks mirrors the queue length.
  W.grantOffer = function (p, spec) {
    if (!p || !spec) return;
    p.offers.push({ src: spec.src || 'level', path: spec.path || null });
    p.picks = p.offers.length;
  };

  // Called once per hero from startRun: meta bundle effects that apply at the start of a descent.
  W.onRunStartBuild = function (p) {
    const rk = (id) => (p.meta.up && p.meta.up[ED.UPGRADE_IDX[id]]) || 0;
    const sw = rk('secondwind');
    p.secondWind = sw > 0 ? 1 : 0; p.swPct = sw >= 2 ? 0.7 : 0.4;
    p.rerolls = rk('insight') + (p.meta.mastery >= 8 ? 1 : 0);
    this.grantOffer(p, { src: 'start' });
    for (let i = rk('headstart'); i > 0; i--) this.grantOffer(p, { src: 'level' });
    const arm = rk('armory');
    if (arm) {
      const pool = (p.meta.relics || []).filter(id => (arm >= 2 ? ED.RELICS[id].rar !== 'c' : ED.RELICS[id].rar === 'c') && !p.relics.includes(id));
      if (pool.length) { p.relics.push(this.rng.pick(pool)); this.recalc(p, true); }
    }
  };

  // Called once per hero from enterStratum (after downed/dead heroes are restored).
  W.onStratumBuild = function (p, s) {
    const prov = 0.1 * ((p.meta.up && p.meta.up[ED.UPGRADE_IDX.provisions]) || 0);
    const heal = prov + (p.stats.strataHeal || 0);
    if (s > 1 && heal > 0) this.healPlayer(p, p.maxHp * heal);
    p.angelUsed = false;
    if (p.stats.cloverRerolls && s > 1) p.rerolls += p.stats.cloverRerolls;
  };

  // Called every tick from updatePlayer for a living, standing hero (after hazards).
  W.updatePlayerBuild = function (p, dt) {
    const st = p.stats;
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
    if (st.hemomancy) p.hp = Math.max(1, p.hp - Math.floor(p.hp * 0.04));
  };

  // ---------------- xp, levels and boons ----------------
  W.addXp = function (v) {
    this.xp += v;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level++; this.xpNext = ED.World.xpFor(this.level);
      for (const p of this.players.values()) this.grantOffer(p, { src: 'level' });
      this.emit({ t: 'levelup', level: this.level });
    }
  };

  // ---------------- offers ----------------
  // p.offers is the queue of specs, p.offers[0] the one shown as p.offer (array of boon ids). p.picks === p.offers.length.
  W.updateOffers = function (dt) {
    const safe = this.isSafe();
    for (const p of this.players.values()) {
      while (p.offers.length < p.picks) p.offers.push({ src: 'level', path: null }); // picks bumped outside grantOffer become level offers
      p.picks = p.offers.length;
      if (p.offer) {
        p.offerT += dt;
        // AFK guard so a party is never stuck behind one player (a solo hero may take as long as they like); never auto-evolves
        if (p.offerT > 45 && this.players.size > 1) this.pickBoon(p.pid, Math.max(0, p.offer.findIndex(id => !ED.BOONS[id].evo)));
      } else if (p.offers.length && safe && !p.downed && !p.dead) {
        p.offer = this.rollOffer(p, p.offers[0]); p.offerT = 0;
        this.sendOffer(p);
      }
    }
  };

  // Offer message for the hero's head spec: { to, t:'offer', boons, rerolls, picks, src, path, forge }.
  W.sendOffer = function (p) {
    const sp = p.offers[0];
    this.msgs.push({ to: p.pid, t: 'offer', boons: p.offer, rerolls: p.rerolls, picks: p.picks, src: sp.src, path: sp.path || null, forge: sp.src === 'forge' });
  };

  // Evolution paths the hero may take now: affinity >= EVO_AFFINITY, keystone owned, no evolution yet.
  W.evoPaths = function (p) {
    const out = [];
    if (p.stats.evo) return out;
    for (const k of ED.PATH_IDS) {
      const id = 'evo_' + k;
      if (!ED.BOONS[id] || p.boons[id] || ED.pathAffinity(p.boons, k) < ED.EVO_AFFINITY) continue;
      if (Object.keys(p.boons).some(b => ED.BOONS[b] && ED.BOONS[b].key && ED.BOONS[b].path === k)) out.push(k);
    }
    return out;
  };

  // Boon ids for one offer spec (evolution cards first). A forge spec with nothing to rank up turns into a level spec.
  W.rollOffer = function (p, spec) {
    spec = spec || { src: 'level' };
    const rng = this.rng, s = Math.max(1, this.stratum), luck = p.stats.luck || 0, kind = p.stats.kind;
    const owned = ED.gatePaths(p.boons), aff = {};
    for (const k of ED.PATH_IDS) aff[k] = ED.pathAffinity(p.boons, k);
    const epic = spec.src === 'epic';
    const n = (epic ? 4 : 3) + (p.stats.choices ? 1 : 0);
    const out = [];
    const rank = (id) => ED.BOONS[id].rar;
    const eligible = (id) => {
      const b = ED.BOONS[id];
      if (b.evo || (b.cls && b.cls !== p.cls) || (b.need && b.need !== kind)) return false;
      if ((p.boons[id] || 0) >= (b.max || 5)) return false;
      if (b.duo) return b.duo.every(k => owned.includes(k));
      if (b.gate) return owned.length < ED.MAX_GATES && !owned.includes(b.path);
      if (b.path) return owned.includes(b.path) && (!b.key || aff[b.path] >= ED.KEY_AFFINITY);
      return true;
    };
    const weight = (id) => {
      const b = ED.BOONS[id], r = rank(id);
      let w = r === 'c' ? 60 : r === 'r' ? 30 + 2.5 * s + 60 * luck : r === 'e' ? 10 + 2 * s + 40 * luck : r === 'd' ? 12 : 10;
      if (b.duo || (b.path && !b.gate)) w *= 2.5; // owned path
      if (b.gate) w *= 0.8;
      if (b.cls) w *= 1.4;
      if (epic && b.key) w *= 2;
      return w;
    };
    // weighted draw without replacement until the offer holds n cards
    const draw = (pool) => {
      pool = pool.filter(id => !out.includes(id));
      while (out.length < n && pool.length) { const id = rng.weighted(pool, weight); out.push(id); pool = pool.filter(x => x !== id); }
    };
    const level = ED.BOON_IDS.filter(eligible);
    const rare = (id) => rank(id) !== 'c';
    switch (spec.src) {
      case 'forge': {
        const own = Object.keys(p.boons).filter(id => ED.BOONS[id] && !ED.BOONS[id].evo && p.boons[id] < (ED.BOONS[id].max || 5));
        rng.shuffle(own);
        if (own.length) return own.slice(0, n);
        spec.src = 'level';
        break;
      }
      case 'start':
        for (const k of rng.shuffle(ED.PATH_IDS.filter(k => !owned.includes(k)))) if (out.length < n) out.push(ED.PATH_GATE[k]);
        break;
      case 'class': draw(level.filter(id => ED.BOONS[id].cls)); break;
      case 'epic': draw(level.filter(rare)); break;
      case 'room': {
        const X = spec.path;
        if (!ED.PATHS[X]) break;
        if (owned.includes(X)) draw(level.filter(id => ED.BOONS[id].path === X || (ED.BOONS[id].duo && ED.BOONS[id].duo.includes(X))));
        else if (owned.length < ED.MAX_GATES) out.push(ED.PATH_GATE[X]);
        else draw(level.filter(rare));
        break;
      }
    }
    draw(level);
    if (!out.length) draw(ED.BOON_IDS.filter(id => { const b = ED.BOONS[id]; return !b.cls && !b.path && !b.duo && eligible(id); }));
    if (!out.length) out.push('vigor');
    if (spec.src === 'forge') return out;
    return this.evoPaths(p).map(k => 'evo_' + k).concat(out);
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
    p.offers.shift(); p.picks = p.offers.length; p.offer = null;
    this.emit({ t: 'boon', pid, id, x: p.x, y: p.y });
    if (b.evo) this.emit({ t: 'evolve', pid, path: b.evo, x: p.x, y: p.y });
    this.sendBuild(p);
    this.msgs.push({ to: pid, t: 'offerDone' });
  };

  W.reroll = function (pid) {
    const p = this.players.get(pid);
    if (!p || !p.offer || p.rerolls <= 0 || !p.offers.length || p.offers[0].src === 'forge') return;
    p.rerolls--;
    p.offer = this.rollOffer(p, p.offers[0]);
    this.sendOffer(p);
  };

  // ---------------- allies & companions ----------------
  // Companion damage multiplier: Kindred (compDmg) and the Spirit Feast duo.
  const compMul = (st) => 1 + (st.compDmg || 0) + (st.feast ? 0.2 : 0);

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
        if (a.cd <= 0) {
          a.cd = 0.7;
          // minion hits infuse only with Elemental Bond
          const got = this.hitEnemy(tgt, a.dmg * compMul(owner.stats), { p: owner, kind: 'minion', comp: true, noProc: !owner.stats.compInfuse, knock: 40, kx: (tx - a.x) / (d || 1), ky: (ty - a.y) / (d || 1), raw: true });
          if (got > 0 && owner.stats.soulSiphon) this.soulSiphon(owner);
        }
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
        const n = st.orbit, dmg = (6 + st.weapon.dmg * 0.5) * compMul(st);
        for (let i = 0; i < n; i++) {
          const a = t * 3.2 + i * U.TAU / n;
          const ox = p.x + Math.cos(a) * 44, oy = p.y + Math.sin(a) * 44;
          // Guardian Spirits: a blade destroys one enemy projectile within 12 px, then rests 1 s
          if (st.bladeBlock && (p.bladeT[i] || 0) <= t) {
            for (const pr of this.projs) {
              if (pr.team !== 1 || pr.life <= 0 || U.dist2(ox, oy, pr.x, pr.y) > 144) continue;
              pr.life = 0; p.bladeT[i] = t + 1;
              this.emit({ t: 'deflect', x: Math.round(pr.x), y: Math.round(pr.y) });
              break;
            }
          }
          for (const e of this.enemies) {
            if (e.hp <= 0 || e.spawnT > 0) continue;
            if (U.dist2(ox, oy, e.x, e.y) > (e.r + 10) ** 2) continue;
            const key = e.id;
            if ((p.orbHit[key] || 0) > t) continue;
            p.orbHit[key] = t + 0.4;
            this.hitEnemy(e, dmg, { p, kind: 'orbit', comp: true, knock: 60, kx: Math.cos(a + 1.57), ky: Math.sin(a + 1.57) });
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
            this.spawnProj({ team: 0, kind: 'wisp', comp: true, x: wx, y: wy, a, speed: 330, r: 5, dmg: (5 + st.weapon.dmg * 0.45) * compMul(st), life: 1.2, owner: p.pid, homing: 3, knock: 20 });
          }
        }
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
