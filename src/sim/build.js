// Hero build: experience and levels, boon offers and picks, per-hero build state, minions.
// world.js calls the hooks below at fixed points (player creation, run start, stratum start, room lock, per-tick).
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim;
  const W = ED.World.prototype;

  // ---------------- hooks called by world.js ----------------
  // Called from addPlayer before the first recalc: add build-only fields to the hero (offer queue, dash-boon state, Holy/Lantern/Aegis timers, Death Knell stacks, Judgment grants, shield accounting).
  W.initBuild = function (p) {
    p.offers = []; p.picks = 0; p.dashHit = null; p.dashTrail = 0; p.boltAt = 0;
    p.knellN = 0; p.knellT = 0; p.holyT = 0; p.lanternT = 0; p.retT = 0; p.castN = 0; p.judgeGot = {}; p.shieldBy = {}; p.toughRoom = false;
  };

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

  // Called from beginEncounter when an elite room locks: Battle Ward shields the hero (once per room, cap = the ward itself).
  W.onRoomLockBuild = function (p, room) {
    const ward = p.stats.roomWard;
    if (ward > 0 && room.type === 'elite') this.addShield(p, p.maxHp * ward, p.maxHp * ward, 'ward');
  };

  // Called every tick from updatePlayer for a living, standing hero (after hazards).
  W.updatePlayerBuild = function (p, dt) {
    const st = p.stats;
    if (st.aegis) p.aegisT = Math.max(0, p.aegisT - dt);
    p.guardCd -= dt; p.guardT -= dt; p.frozenCd -= dt; p.tranceT -= dt; p.wallT -= dt;
    p.holyT -= dt; p.lanternT -= dt; p.retT -= dt;
    if (p.knellT > 0 && (p.knellT -= dt) <= 0) p.knellN = 0;
    this.updateSkills(p, dt);
    this.updatePlayerCombat(p, dt);
  };

  // Called by playerSkill after any skill resolves (slot 0 = K, 1 = L).
  W.onSkillCast = function (p, slot) {
    const st = p.stats, area = 1 + st.area * 0.5;
    if (st.overcharge) this.explode(p.x, p.y, 85 * area, ED.procDmg(ED.BOONS.overcharge, st) * st.overcharge, 0, p, 'shock', true);
    if (st.trance) p.tranceT = 4;
  };

  // ---------------- xp, levels and boons ----------------
  // Every even level grants a level offer; odd levels only raise the level.
  W.addXp = function (v) {
    this.xp += v;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level++; this.xpNext = ED.World.xpFor(this.level);
      const boon = this.level % 2 === 0;
      if (boon) for (const p of this.players.values()) this.grantOffer(p, { src: 'level' });
      this.emit({ t: 'levelup', level: this.level, boon });
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
        // AFK guard so a party is never stuck behind one player (a solo hero may take as long as they like); never auto-evolves and never makes a hero a Generalist (the Generalist card is last in the start offer)
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

  // Evolution paths the hero may take now: affinity >= the path's evolution affinity, keystone owned, no evolution yet.
  W.evoPaths = function (p) {
    const out = [];
    if (p.stats.evo) return out;
    for (const k of ED.PATH_IDS) {
      const id = 'evo_' + k;
      if (!ED.BOONS[id] || p.boons[id] || ED.pathAffinity(p.boons, k) < ED.evoAffinity(k)) continue;
      if (Object.keys(p.boons).some(b => ED.BOONS[b] && ED.BOONS[b].key && ED.BOONS[b].path === k)) out.push(k);
    }
    return out;
  };

  // Stratum (1-6) where the element is resisted / weak (the six elements biject with the six strata).
  const resistStratum = (el) => ED.BIOMES.findIndex(b => b.resist === el) + 1;

  // Weight of an unowned element gate on a room offer: weak soon x2, weak where an owned gate is resisted x2, resisted next stratum x0.5, the class element x2.
  function coverage(p, g, s) {
    let w = 1;
    const cur = ED.biomeFor(s), next = ED.biomeFor(s + 1);
    if (cur.weak === g || next.weak === g) w *= 2;
    if (ED.elementGates(p.boons).some(h => { const rs = resistStratum(h); return rs > 0 && ED.biomeFor(rs).weak === g; })) w *= 2;
    if (next.resist === g && next !== cur) w *= 0.5;
    if (p.stats.element === g) w *= 2;
    return w;
  }

  // Boon ids for one offer spec (evolution card first, then the duo, both prepended on top of the cards). A forge spec with nothing to rank up turns into a level spec.
  // Everyone sees 3 cards (epic 4, Crown +1): the start offer is 3 element gates plus the guaranteed card (Generalist for Knight, Ranger and Shade; the class element's gate for the others);
  // a class spec returns exactly the hero's class boons; room, level and epic offers draw from the hero's own paths (element heroes) or the General path (Generalists) plus open boons.
  W.rollOffer = function (p, spec) {
    spec = spec || { src: 'level' };
    const rng = this.rng, st = p.stats, s = Math.max(1, this.stratum), luck = st.luck || 0, kind = st.kind;
    const gen = ED.isGeneralist(p.boons), els = ED.elementGates(p.boons), aff = {};
    for (const k of ED.PATH_IDS) aff[k] = ED.pathAffinity(p.boons, k);
    const epic = spec.src === 'epic';
    const n = (epic ? 4 : 3) + (st.choices | 0);
    const out = [];
    const rank = (id) => ED.BOONS[id].rar;
    const free = !gen && els.length < ED.MAX_ELEMENTS;
    const eligible = (id) => {
      const b = ED.BOONS[id];
      if (b.evo || b.duo || b.cls || (b.need && b.need !== kind)) return false;
      if ((p.boons[id] || 0) >= ED.maxRank(b, st)) return false;
      if (b.gate) return free && b.path !== 'general' && !els.includes(b.path); // the Generalist gate is only on the start offer
      if (b.path === 'general') return b.key ? gen && aff.general >= ED.KEY_AFFINITY_GENERAL : gen || !!b.openMax; // gated General: Generalists; Keen Eye and Brutality are open at rank 1
      if (b.path) return !gen && els.includes(b.path) && (!b.key || aff[b.path] >= ED.KEY_AFFINITY);
      return true;
    };
    const own = (b) => !!b.path && !b.gate && (b.path === 'general' ? gen : true); // a boon of the hero's own paths
    const weight = (id) => {
      const b = ED.BOONS[id], r = rank(id);
      let w = r === 'c' ? 60 : r === 'r' ? 30 + 2.5 * s + 60 * luck : r === 'e' ? 10 + 2 * s + 40 * luck : 10;
      if (own(b)) w *= 2.5;
      if (b.gate) w *= 0.8;
      if (epic && b.key) w *= 2;
      return w;
    };
    // weighted draw without replacement until the offer holds n cards; at most one element gate per offer
    const draw = (pool) => {
      pool = pool.filter(id => !out.includes(id));
      while (out.length < n && pool.length) {
        const id = rng.weighted(pool, weight);
        out.push(id);
        pool = pool.filter(x => x !== id && !(ED.BOONS[id].gate && ED.BOONS[x].gate));
      }
    };
    const level = ED.BOON_IDS.filter(eligible);
    const rare = (id) => rank(id) !== 'c';
    const openPool = () => ED.BOON_IDS.filter(id => { const b = ED.BOONS[id]; return (b.open || b.openMax) && !b.gate && eligible(id); });
    switch (spec.src) {
      case 'forge': {
        const have = Object.keys(p.boons).filter(id => ED.BOONS[id] && !ED.BOONS[id].evo && p.boons[id] < ED.maxRank(ED.BOONS[id], st));
        rng.shuffle(have);
        if (have.length) return have.slice(0, n);
        spec.src = 'level';
        break;
      }
      case 'start': {
        const gates = ED.ELEMENT_IDS.map(k => ED.PATH_GATE[k]);
        const mine = st.element ? ED.PATH_GATE[st.element] : null; // Pyromancer, Cleric, Necromancer: their own gate is always on the offer
        if (mine) out.push(mine);
        const others = rng.shuffle(gates.filter(id => id !== mine));
        for (let i = 0; i < others.length && out.length < n + (mine ? 1 : 0); i++) out.push(others[i]);
        if (!mine) out.push(ED.PATH_GATE.general); // Knight, Ranger, Shade: the Generalist card comes last
        return out;
      }
      case 'class': {
        const mine = ED.BOON_IDS.filter(id => ED.BOONS[id].cls === p.cls && (p.boons[id] || 0) < (ED.BOONS[id].max || 5));
        if (mine.length) return mine.slice(0, 4);
        spec.src = 'level';
        break;
      }
      case 'epic': draw(level.filter(rare)); break;
      case 'room': {
        if (gen) { draw(level); break; } // gated General (x2.5) plus open General
        if (free) { // card 1: one unowned element gate, weighted by how soon it is weak (shown with a "Weak: stratum" chip)
          const gates = level.filter(id => ED.BOONS[id].gate);
          if (gates.length) out.push(rng.weighted(gates, id => coverage(p, ED.BOONS[id].path, s)));
        }
        draw(level.filter(id => own(ED.BOONS[id])));
        if (out.length < n) draw(openPool().filter(rare)); // the own pool ran dry: open General at rare and up
        if (!out.length) out.push('vigor');
        return this.prependCards(p, out);
      }
    }
    draw(level);
    if (!out.length) draw(openPool());
    if (!out.length) out.push('vigor');
    if (spec.src === 'forge') return out;
    return this.prependCards(p, out);
  };

  // Puts the evolution card (affinity >= its threshold with the keystone owned) and the duo of the hero's two element paths (both at DUO_AFFINITY, not yet taken) in front of the offer; they take no slot.
  W.prependCards = function (p, out) {
    const pre = this.evoPaths(p).map(k => 'evo_' + k);
    const els = ED.elementGates(p.boons);
    if (els.length === 2 && ED.pathAffinity(p.boons, els[0]) >= ED.DUO_AFFINITY && ED.pathAffinity(p.boons, els[1]) >= ED.DUO_AFFINITY) {
      const duo = ED.duoOf(els[0], els[1]);
      if (duo && !p.boons[duo] && !out.includes(duo)) pre.push(duo);
    }
    return pre.concat(out);
  };

  W.pickBoon = function (pid, idx) {
    const p = this.players.get(pid);
    if (!p || !p.offer) return;
    const id = p.offer[U.clamp(idx | 0, 0, p.offer.length - 1)];
    const b = ED.BOONS[id];
    p.boons[id] = (p.boons[id] || 0) + 1;
    this.recalc(p, false);
    if (id === 'generalist') this.forsakeRelics(p);
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

  // ---------------- allies (Necromancer minions) ----------------
  ED.CONST.COMP_MUL = 0.85; // minion damage multiplier

  W.spawnMinion = function (owner, x, y, life) {
    const st = owner.stats;
    const mine = this.allies.filter(a => a.owner === owner.pid);
    if (mine.length >= st.maxMinions) { mine.sort((a, b) => a.life - b.life); mine[0].life = 0; }
    this.allies.push({ id: U.uid(), owner: owner.pid, x, y, r: 9, life, maxLife: life, cd: 0.5, face: 1,
      dmg: ED.procDmg(ED.SKILLS.legion.minion, st) * (1 + st.minionDmg) });
    this.emit({ t: 'raise', x, y });
  };

  // Minions hit physically (untagged, no hero multiplier or crit) and infuse their owner's gates at half strength.
  W.updateAllies = function (dt) {
    const keep = [];
    for (const a of this.allies) {
      a.life -= dt; a.cd -= dt;
      const owner = this.players.get(a.owner);
      if (a.life <= 0 || !owner) {
        if (owner && owner.stats.boneSpikes) this.explode(a.x, a.y, 60, ED.procDmg(ED.BOONS.bonespikes, owner.stats) * owner.stats.dmg, 0, owner, 'bone');
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
          this.hitEnemy(tgt, a.dmg * ED.CONST.COMP_MUL, { p: owner, kind: 'minion', comp: true, knock: 40, kx: (tx - a.x) / (d || 1), ky: (ty - a.y) / (d || 1), raw: true });
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
})(globalThis.ED || (globalThis.ED = {}));
