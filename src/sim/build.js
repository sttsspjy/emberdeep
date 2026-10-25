// Hero build: experience and levels, boon offers and picks, per-hero build state, minions.
// world.js calls the hooks below at fixed points (player creation, run start, stratum start, room lock, per-tick).
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim;
  const W = ED.World.prototype;

  // ---------------- hooks called by world.js ----------------
  // Called from addPlayer before the first recalc: add build-only fields to the hero (offer queue, fork ranks due, dash-boon state, Holy/Lantern timers, Judgment grants, shield accounting) and the element verb state (elements.js initVerbs).
  W.initBuild = function (p) {
    p.offers = []; p.picks = 0; p.forkDue = 0; p.dashHit = null; p.dashFx = -1; p.dashFy = 0; p.dashTrail = 0; p.boltAt = 0;
    p.holyT = 0; p.lanternT = 0; p.castN = 0; p.judgeGot = {}; p.shieldBy = {}; p.toughRoom = false;
    this.initVerbs(p);
    p.sec = { platino: false, contrarian: false, thread: false, heroSecret: false, bellRung: false }; // secret run fields (world.js secretP)
    p.ctrN = 0; p.ctrOff = false; p.ctrEl = {}; // Against the Grain: counted element-path cards, broken for the run, stratum -> its one element
    p.bellS = 0; // Drowned Bell: 0 not rung, 1 rung (watching health), 2 broken, 3 kept (rooms.js)
  };

  // Against the Grain: each stratum takes one element (the first element-path card of the stratum sets it to its element, not used on an earlier stratum); a card without that element,
  // or a first card whose elements were all used before, breaks it for the run. p.sec.contrarian holds at CONTRARIAN_N counted cards.
  const CONTRARIAN_N = 8;
  W.contrarianPick = function (p, b) {
    const els = b.path && ED.PATHS[b.path] && ED.PATHS[b.path].element ? [b.path] : null;
    if (!els) return;
    const s = this.stratum, ce = p.ctrEl || (p.ctrEl = {});
    if (!ce[s]) { const used = Object.keys(ce).filter(k => +k !== s).map(k => ce[k]); ce[s] = els.find(el => used.indexOf(el) < 0) || null; if (!ce[s]) { p.ctrOff = true; ce[s] = '-'; } }
    if (els.indexOf(ce[s]) >= 0) p.ctrN++; else p.ctrOff = true;
    p.sec.contrarian = !p.ctrOff && p.ctrN >= CONTRARIAN_N;
  };

  // Queue an offer spec {src:'level'|'room'|'class'|'start'|'forge'|'epic', path?}; p.picks mirrors the queue length.
  W.grantOffer = function (p, spec) {
    if (!p || !spec) return;
    p.offers.push({ src: spec.src || 'level', path: spec.path || null });
    p.picks = p.offers.length;
  };

  // Called once per hero from startRun: meta bundle effects that apply at the start of a descent.
  // Hearth upgrade entry and the hero's rank in it.
  const hearth = (id) => ED.UPGRADES[ED.UPGRADE_IDX[id]];
  const rankOf = (p, id) => (p.meta.up && p.meta.up[ED.UPGRADE_IDX[id]]) || 0;

  // Second Wind revive health, Insight rerolls and the start offer; Head Start (xp) and Stash (gold) are party values: the highest rank among the heroes (xp, level and gold are shared).
  W.onRunStartBuild = function (p) {
    const sw = rankOf(p, 'secondwind');
    p.secondWind = sw > 0 ? 1 : 0; p.swPct = sw > 0 ? hearth('secondwind').pct[Math.min(sw, 2) - 1] : 0;
    const ins = rankOf(p, 'insight');
    p.rerolls = (ins > 0 ? hearth('insight').rerolls[Math.min(ins, 3) - 1] : 0) + (p.meta.mastery >= 8 ? 1 : 0);
    this.grantOffer(p, { src: 'start' });
    const gold = rankOf(p, 'stash') * hearth('stash').gold;
    if (gold > this.gold) this.gold = gold;
  };

  // Called once from startRun after every hero's onRunStartBuild: the party begins with the highest Head Start rank's xp (a level-up grants its offers as usual).
  W.onPartyStartBuild = function () {
    let r = 0;
    for (const p of this.players.values()) r = Math.max(r, rankOf(p, 'headstart'));
    if (r > 0) this.addXp(r * hearth('headstart').xp);
  };

  // Called once per hero from enterStratum (after downed/dead heroes are restored).
  W.onStratumBuild = function (p, s) {
    const prov = hearth('provisions').heal * rankOf(p, 'provisions');
    const heal = prov + (p.stats.strataHeal || 0);
    if (s > 1 && heal > 0) this.healPlayer(p, p.maxHp * heal);
    p.angelUsed = false;
    if (p.stats.cloverRerolls && s > 1) p.rerolls += p.stats.cloverRerolls;
    if (p.rh && p.rh.stratum) this.relicFire(p, 'stratum', s);
  };

  // Called every tick from updatePlayer for a living, standing hero (after hazards).
  W.updatePlayerBuild = function (p, dt) {
    const st = p.stats;
    if (st.aegis) p.aegisT = Math.max(0, p.aegisT - dt);
    p.guardCd -= dt; p.guardT -= dt; p.frozenCd -= dt; p.tranceT -= dt;
    p.holyT -= dt; p.lanternT -= dt;
    if (p.rh && p.rh.tick) this.relicFire(p, 'tick', dt);
    this.updateSkills(p, dt);
    this.updatePlayerCombat(p, dt);
  };

  // Called by playerSkill after skill 1 or skill 2 resolves (slot 0 or 1).
  W.onSkillCast = function (p) {
    if (p.stats.trance) p.tranceT = 4;
  };

  // ---------------- xp, levels and boons ----------------
  // Every even level grants a level offer; odd levels only raise the level. Team level 3 grants every hero the class route offer (cls: 1 on the event); boss I grants the fork offer, bosses II and III its ranks 2 and 3 (rooms.js, W.grantForkRank).
  W.addXp = function (v) {
    this.xp += v;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level++; this.xpNext = ED.World.xpFor(this.level);
      const boon = this.level % 2 === 0, route = this.level === 3;
      if (boon) for (const p of this.players.values()) this.grantOffer(p, { src: 'level' });
      if (route) for (const p of this.players.values()) this.grantOffer(p, { src: 'class' });
      this.emit({ t: 'levelup', level: this.level, boon, cls: route ? 1 : 0 });
      this.relicAll('level', this.level);
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
        // AFK guard so a party is never stuck behind one player (a solo hero may take as long as they like); never auto-evolves and never makes a hero a Generalist (the Generalist card is last in the start offer);
        // a route or fork pick is seeded random
        if (p.offerT > 45 && this.players.size > 1) {
          const sp = p.offers[0], cl = sp && sp.src === 'class';
          this.pickBoon(p.pid, cl ? this.rng.int(0, p.offer.length - 1) : Math.max(0, p.offer.findIndex(id => !ED.BOONS[id].evo)));
        }
      } else if (p.offers.length && safe && !p.downed && !p.dead) {
        p.offer = this.rollOffer(p, p.offers[0]); p.offerT = 0;
        this.sendOffer(p);
      }
    }
  };

  // Offer message for the hero's head spec: { to, t:'offer', boons, rerolls, picks, src, path, forge, ctier (class offers: 1 route, 2 fork), route }.
  W.sendOffer = function (p) {
    const sp = p.offers[0], m = { to: p.pid, t: 'offer', boons: p.offer, rerolls: p.rerolls, picks: p.picks, src: sp.src, path: sp.path || null, forge: sp.src === 'forge', ctier: sp.src === 'class' ? sp.ctier | 0 : 0, route: sp.route || null };
    this.msgs.push(m);
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

  // Weight of an unowned element gate on a room offer: the class element x2 (no stratum favours an element).
  const coverage = (p, g) => (p.stats.element === g ? 2 : 1);

  // Stat keys that stun, freeze or blind foes (Frostbite, Overload and the route stats); the Opportunist gate also reads Heavy Stagger and the hero's skill parts.
  const DAZE_KEYS = ['iceInfuse', 'arcStun', 'waveStun', 'sanctStun', 'cStun', 'chargeStun', 'orbitStun', 'knightStun', 'cometStun', 'parry'];
  // True when the hero can stun, freeze or blind a foe: a Heavy weapon fork, a DAZE_KEYS stat above 0, or a stun / blind part of its two skills (a gated part needs its stat: skyfall, verdict, afterimage).
  W.canDaze = function (p) {
    const st = p.stats, cl = ED.CLASSES[p.cls];
    if (st.heavy || DAZE_KEYS.some(k => st[k] > 0)) return true;
    for (const sid of [cl.skill, cl.skill2]) {
      const sk = ED.SKILLS[sid];
      if (sk) for (const d of sk.parts) if ((d.stun || d.blind || d.id === 'blind') && (!d.if || st[d.if] > 0)) return true;
    }
    return false;
  };

  // Boon ids for one offer spec (the evolution card prepended on top of the cards). A forge spec with nothing to rank up turns into a level spec.
  // Everyone sees 3 cards (epic 4, Crown +1): the start offer is 3 element gates plus the guaranteed card (Generalist for Knight, Ranger and Shade; the class element's gate for the others);
  // a class spec returns exactly the cards of the hero's next route step (no draw padding, no evolution prepended): the 4 route cards or the 2 forks of the chosen route (a hero that holds a fork gets a level offer);
  // room, level and epic offers draw from the hero's own paths (element heroes) or the General path (Generalists) plus open boons.
  // The forge offers owned boons below their max rank, never route or fork cards. A card at its max rank is never offered; a draw that finds no card (pool exhausted) offers the Purse, which no pool draws.
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
    const daze = () => this.canDaze(p);
    const eligible = (id) => {
      const b = ED.BOONS[id];
      if (b.evo || b.cls || b.purse || (b.need && b.need !== kind)) return false;
      if ((p.boons[id] || 0) >= ED.maxRank(b, st)) return false;
      if (id === 'opportunist' && !daze()) return false; // nothing to stun, freeze or blind: the card would do nothing
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
        const have = Object.keys(p.boons).filter(id => ED.BOONS[id] && !ED.BOONS[id].evo && !ED.BOONS[id].route && p.boons[id] < ED.maxRank(ED.BOONS[id], st));
        rng.shuffle(have);
        if (have.length) return have.slice(0, n);
        spec.src = 'level';
        break;
      }
      case 'start': {
        const gates = ED.ELEMENT_IDS.map(k => ED.PATH_GATE[k]);
        const mine = st.element ? ED.PATH_GATE[st.element] : null; // Pyromancer, Cleric, Necromancer, Bellwarden: their own gate is always on the offer
        if (mine) out.push(mine);
        const others = rng.shuffle(gates.filter(id => id !== mine));
        for (let i = 0; i < others.length && out.length < n + (mine ? 1 : 0); i++) out.push(others[i]);
        if (!mine) out.push(ED.PATH_GATE.general); // Knight, Ranger, Shade: the Generalist card comes last
        return out;
      }
      case 'class': {
        const tbl = ED.CLASS_CARDS[p.cls], rt = ED.classRoute(p.boons, p.cls);
        if (!tbl) { spec.src = 'level'; break; }
        if (!rt.route) { spec.ctier = 1; return ED.ROUTES.map(r => tbl[r].t1); }
        if (rt.fork) { spec.src = 'level'; break; } // the fork is held: its ranks come from W.grantForkRank
        spec.route = rt.route; spec.ctier = 2;
        return tbl[rt.route].forks.slice();
      }
      case 'epic': draw(level.filter(rare)); break;
      case 'room': {
        if (gen) { draw(level); break; } // gated General (x2.5) plus open General
        if (free) { // card 1: one unowned element gate (the class element weighs double)
          const gates = level.filter(id => ED.BOONS[id].gate);
          if (gates.length) out.push(rng.weighted(gates, id => coverage(p, ED.BOONS[id].path)));
        }
        draw(level.filter(id => own(ED.BOONS[id])));
        if (out.length < n) draw(openPool().filter(rare)); // the own pool ran dry: open boons at rare and up
        if (!out.length) out.push('purse');
        return this.prependCards(p, out);
      }
    }
    draw(level);
    if (!out.length) draw(openPool());
    if (!out.length) out.push('purse');
    if (spec.src === 'forge') return out;
    return this.prependCards(p, out);
  };

  // Puts the evolution card (affinity >= its threshold with the keystone owned) in front of the offer; it takes no slot.
  W.prependCards = function (p, out) {
    return this.evoPaths(p).map(k => 'evo_' + k).concat(out);
  };

  W.pickBoon = function (pid, idx) {
    const p = this.players.get(pid);
    if (!p || !p.offer) return;
    const id = p.offer[U.clamp(idx | 0, 0, p.offer.length - 1)];
    const b = ED.BOONS[id];
    if (b.purse) { // gold, no rank: the party gold gains a gold room's reward
      const v = ED.World.rewardGold(this.stratum);
      this.gold += v; this.emit({ t: 'gold', v, pid }); this.emit({ t: 'boon', pid, id, x: p.x, y: p.y });
      p.offers.shift(); p.picks = p.offers.length; p.offer = null;
      this.msgs.push({ to: pid, t: 'offerDone' });
      return;
    }
    const gain = (p.boons[id] || 0) < ED.maxRank(b, p.stats); // a pick of a card at its max rank pays nothing but still ends the offer
    if (gain) {
      p.boons[id] = (p.boons[id] || 0) + 1;
      this.recalc(p, false);
      if (b.heal) this.healPlayer(p, b.heal);
      if (b.mods.charges) p.chargeBonus = true;
      this.contrarianPick(p, b);
    }
    p.offers.shift(); p.picks = p.offers.length; p.offer = null;
    if (gain) {
      this.emit({ t: 'boon', pid, id, x: p.x, y: p.y });
      if (p.rh && p.rh.boon) this.relicFire(p, 'boon', id);
      if (b.evo) this.emit({ t: 'evolve', pid, path: b.evo, x: p.x, y: p.y });
      this.sendBuild(p);
    }
    this.msgs.push({ to: pid, t: 'offerDone' });
    if (gain && b.route && b.tier === 2) while (p.forkDue > 0) { p.forkDue--; if (p.boons[id] < b.max) this.rankFork(p, id); } // ranks granted at bosses before the fork was taken
  };

  // Fork ranks are auto-granted at bosses II and III (rank 2, rank 3). A hero that holds a fork below its max rank gains one rank at once; a hero without a fork banks it in p.forkDue, applied when the fork card is picked.
  W.grantForkRank = function (p) {
    if (!p) return;
    const rt = ED.classRoute(p.boons, p.cls);
    if (!rt.fork) p.forkDue++;
    else if (rt.rank < ED.BOONS[rt.fork].max) this.rankFork(p, rt.fork);
  };

  // One rank on fork card `id`: stats and build resent, { to, t: 'forkRank', id, rank } to the hero and a forkRank event for the effects.
  W.rankFork = function (p, id) {
    const rank = p.boons[id] = (p.boons[id] || 0) + 1;
    this.recalc(p, false);
    this.sendBuild(p);
    this.msgs.push({ to: p.pid, t: 'forkRank', id, rank });
    this.emit({ t: 'forkRank', pid: p.pid, id, rank, x: p.x, y: p.y });
  };

  // A reroll redraws the head offer; a forge, route or fork pick refuses at no cost.
  W.reroll = function (pid) {
    const p = this.players.get(pid);
    if (!p || !p.offer || p.rerolls <= 0 || !p.offers.length || p.offers[0].src === 'forge') return;
    if (p.offers[0].src === 'class') return;
    p.rerolls--;
    p.offer = this.rollOffer(p, p.offers[0]);
    this.sendOffer(p);
  };
})(globalThis.ED || (globalThis.ED = {}));
