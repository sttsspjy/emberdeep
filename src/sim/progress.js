// Pickups, party XP / levels, card offers, banish / reroll / skip, chests, gold and the per-weapon damage table (GAME-DESIGN §6, §9; ARCHITECTURE §8).
// Pickup k: 'xp1' | 'xp5' | 'xp25' (val = XP) | 'gold' (val coins) | 'food' (val HP) | 'magnet' | 'bomb' | 'chest' (val 1 elite, 2 boss). Gems merge into the nearest gem above GEM_CAP on the ground.
// Gems and gold are pulled inside the hero's pickup radius; food, magnet, bomb and chests need a touch. Pulled pickups fly to the hero with an accelerating curve.
// Braziers break on a hero's touch (weapon hits: combat.js) and relight RELIGHT s after breaking, once no living hero is within RELIGHT_R px.
// Card: { kind: 'weapon'|'wlvl'|'passive'|'plvl'|'skill'|'gold'|'heal', id, lvl (level after the pick), name, txt (<= 40 chars), sub (second line or ''), icon, evo (true: the pick makes a weapon evolution-ready), val (gold / heal amount) }.
// Hero fields (initHeroProgress): rerolls, skips, banishes (counts from meta stats), banned (card keys 'w:id' | 'p:id' | 's:id' removed from this run's pool).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, W = ED.World.prototype;
  const GEM_CAP = 350, TOUCH = 6, GOLD_CARD = 25, HEAL_CARD = 30, RELIGHT = 60, RELIGHT_R = 700;

  W.initProgress = function () { this.pickPool = []; this.gemCount = 0; };
  W.initHeroProgress = function (p) { p.rerolls = p.stats.rerolls | 0; p.skips = p.stats.skips | 0; p.banishes = p.stats.banishes | 0; p.banned = []; };
  const gemKind = (v) => (v >= 25 ? 'xp25' : v >= 5 ? 'xp5' : 'xp1');
  const isGem = (k) => k === 'xp1' || k === 'xp5' || k === 'xp25';
  // Gold multiplier of hero p: greed adds fully, luck adds half (GAME-DESIGN §5 Fortune: more gold).
  W.goldMul = function (p) { return 1 + p.stats.greed + 0.5 * p.stats.luck; };

  W.spawnPickup = function (k, x, y, val) {
    const g = this.pickPool.pop() || {};
    g.id = this.nextId(); g.k = k; g.x = x; g.y = y; g.val = val || 1; g.vx = 0; g.vy = 0; g.pull = ''; g.t = 0; g.dead = false;
    this.pickups.push(g);
    if (isGem(k)) this.gemCount++;
    return g;
  };
  // XP gem of value v at (x, y); with GEM_CAP or more gems on the ground it merges into the nearest gem not being vacuumed. Returns the gem.
  W.dropGem = function (x, y, v) {
    if (this.gemCount >= GEM_CAP) {
      let best = null, bd = Infinity;
      const list = this.pickups;
      for (let i = 0; i < list.length; i++) { const g = list[i]; if (g.dead || g.pull || !isGem(g.k)) continue; const d = U.dist2(x, y, g.x, g.y); if (d < bd) { bd = d; best = g; } }
      if (best) { best.val += v; best.k = gemKind(best.val); return best; }
    }
    return this.spawnPickup(gemKind(v), x, y, v);
  };

  W.updatePickups = function (dt) {
    const list = this.pickups, n = list.length;
    let gems = 0;
    for (let i = 0; i < n; i++) {
      const g = list[i];
      if (g.dead) continue;
      const gem = isGem(g.k);
      if (gem) gems++;
      if (g.pull) {
        const p = this.byPid[g.pull];
        if (!this.alive(p)) { g.pull = ''; continue; }
        g.t += dt;
        const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy) || 1, sp = 160 + 900 * g.t * g.t;
        if (d <= p.r + TOUCH || sp * dt >= d) { this.collect(p, g); continue; }
        g.vx = dx / d * sp; g.vy = dy / d * sp; g.x += g.vx * dt; g.y += g.vy * dt;
        continue;
      }
      for (let h = 0; h < this.living.length; h++) {
        const p = this.living[h], R = gem || g.k === 'gold' ? p.stats.pickup : p.r + 10;
        if (U.dist2(p.x, p.y, g.x, g.y) <= R * R) { g.pull = p.pid; g.t = 0; break; }
      }
    }
    this.gemCount = gems;
    const B = this.arena.braziers;
    for (const p of this.living) for (let i = 0; i < B.length; i++) { const b = B[i]; if (!b.broken && U.dist2(p.x, p.y, b.x, b.y) <= (p.r + b.r + 4) ** 2) this.breakBrazier(b, p); }
    // relight (checked once a second): a brazier broken RELIGHT s ago lights again while no living hero is within RELIGHT_R px
    if (this.tick % 60 === 0) for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.broken || this.time - b.t < RELIGHT) continue;
      let near = false;
      for (let h = 0; h < this.living.length && !near; h++) { const p = this.living[h]; near = U.dist2(p.x, p.y, b.x, b.y) < RELIGHT_R * RELIGHT_R; }
      if (!near) { b.broken = false; b.hp = 1; }
    }
  };

  // Hero p collects pickup g: gems -> party XP (x the collector's growth), gold (x goldMul), food heal, magnet (vacuums every gem on the map), holy bomb (kills every non-elite, non-boss foe in view), chest.
  W.collect = function (p, g) {
    g.dead = true;
    const k = g.k;
    if (isGem(k)) this.addXp(g.val * (1 + p.stats.growth) * (this.cheats.xp || 1));
    else if (k === 'gold') this.gold += Math.round(g.val * this.goldMul(p));
    else if (k === 'food') this.heal(p, g.val);
    else if (k === 'magnet') { for (const q of this.pickups) if (!q.dead && isGem(q.k)) { q.pull = p.pid; q.t = 0; } }
    else if (k === 'bomb') {
      const hw = C.VIEW_W / 2 + 20, hh = C.VIEW_H / 2 + 20;
      for (const e of this.foes) if (!e.dead && !e.elite && !e.boss && Math.abs(e.x - p.x) <= hw && Math.abs(e.y - p.y) <= hh) { const s = this.src(p, 'bomb', 'bomb'); s.crit = false; this.hitFoe(e, e.hp, s); }
      this.emit({ t: 'boom', pid: p.pid, wid: 'bomb', x: Math.round(p.x), y: Math.round(p.y), r: 360, look: 'holy' });
    } else if (k === 'chest') this.openChest(p, g.val);
    this.emit({ t: 'pickup', k, pid: p.pid, x: Math.round(g.x), y: Math.round(g.y), val: g.val });
  };

  // ---------------- XP and offers ----------------
  // Party XP: every level-up queues one card offer (p.pend) for each hero that is not dead (downed heroes pick after revival).
  W.addXp = function (v) {
    this.xp += v;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level++; this.xpNext = ED.World.xpFor(this.level);
      this.emit({ t: 'level', level: this.level });
      for (const p of this.heroes) if (!p.dead) p.pend++;
    }
  };
  W.updateProgress = function () {
    for (const p of this.heroes) {
      if (!this.alive(p) || p.offer || p.pend <= 0) continue;
      p.pend--; p.offer = this.makeOffer(p);
      this.emit({ t: 'offer', pid: p.pid });
      if (this.solo()) this.paused = true;
    }
  };
  // Inputs that act on offers (also while paused): pick 1-4, banish 1-4 (p.banishes), reroll (p.rerolls), skip (p.skips).
  W.applyPicks = function () {
    for (const p of this.heroes) {
      const I = p.in;
      if (p.offer && !p.dead) {
        if (I.pick) this.pickCard(p, I.pick - 1);
        else if (I.banish) this.banishCard(p, I.banish - 1);
        else if (I.reroll && p.rerolls > 0) { p.rerolls--; p.offer = this.makeOffer(p); this.emit({ t: 'offer', pid: p.pid, reroll: true }); }
        else if (I.skip && p.skips > 0) { p.skips--; p.offer = null; this.emit({ t: 'pick', pid: p.pid, kind: 'skip', id: '' }); }
        if (this.solo()) I.dash = I.q = I.e = false; // presses made while the solo game is paused on cards do not fire afterwards
      }
      I.pick = 0; I.banish = 0; I.reroll = false; I.skip = false;
    }
    if (this.paused && this.solo() && !this.heroes.some(p => p.offer)) this.paused = false;
  };

  // ---------------- cards ----------------
  const cardKey = (c) => (c.kind === 'weapon' || c.kind === 'wlvl' ? 'w:' : c.kind === 'passive' || c.kind === 'plvl' ? 'p:' : c.kind === 'skill' ? 's:' : '') + c.id;
  W.cardKey = cardKey;
  const owns = (p, wid) => p.weapons.some(ws => ws.id === wid);
  const ownsP = (p, pid) => p.passives.some(ps => ps.id === pid);
  const pairName = (d) => (d.pair && ED.PASSIVES[d.pair] ? ED.PASSIVES[d.pair].name : '');

  const weaponCard = (d) => ({ kind: 'weapon', id: d.id, lvl: 1, name: d.name, txt: d.txt || 'New weapon', sub: d.evo && pairName(d) ? 'Evolves with ' + pairName(d) : '', icon: d.icon, evo: false, val: 0 });
  const wlvlCard = (p, ws) => {
    const d = ED.WEAPONS[ws.id], lvl = ws.lvl + 1, L = d.levels[ws.lvl - 1];
    let sub = '', evo = false;
    if (!d.evolved && d.evo && ED.WEAPONS[d.evo] && lvl >= ED.WEAPON_MAX_LVL) {
      if (d.pair && ownsP(p, d.pair)) { evo = true; sub = 'Evolution ready: open a chest'; } else if (pairName(d)) sub = 'Evolves with ' + pairName(d);
    }
    return { kind: 'wlvl', id: ws.id, lvl, name: d.name, txt: (L && L.txt) || 'Level up', sub, icon: d.icon, evo, val: 0 };
  };
  // Passive card: line per level (def.lines) or def.txt; second line names the weapons it evolves (owned first), or the weapon this pick makes ready.
  const passiveCard = (p, id, lvl) => {
    const d = ED.PASSIVES[id], txt = (d.lines && d.lines[lvl - 1]) || d.txt;
    let sub = '', evo = false;
    if (lvl === 1) {
      for (const ws of p.weapons) { const wd = ED.WEAPONS[ws.id]; if (!wd.evolved && wd.evo && wd.pair === id && ws.lvl >= ED.WEAPON_MAX_LVL) { evo = true; sub = 'Ready: ' + wd.name + ' evolves'; break; } }
    }
    if (!sub) {
      const sigs = (p.meta && p.meta.sigs) || [];
      const all = ED.WEAPON_IDS.filter(w => { const wd = ED.WEAPONS[w]; return wd.pair === id && !wd.evolved && wd.evo && (!wd.sig || wd.sig === p.cls || sigs.indexOf(wd.sig) >= 0); }); // only weapons this hero can be offered
      const mine = all.filter(w => owns(p, w)), show = (mine.length ? mine : all).slice(0, 2).map(w => ED.WEAPONS[w].name);
      if (show.length) sub = 'Evolves: ' + show.join(', ');
    }
    return { kind: lvl > 1 ? 'plvl' : 'passive', id, lvl, name: d.name, txt, sub, icon: d.icon, evo, val: 0 };
  };
  const skillCard = (sk) => { const d = ED.SKILLS[sk.id]; return { kind: 'skill', id: sk.id, lvl: sk.lvl + 1, name: d.name, txt: (d.levels[sk.lvl - 1] && d.levels[sk.lvl - 1].txt) || 'Upgrade', sub: '', icon: d.icon, evo: false, val: 0 }; };
  W.goldCard = function (p) { return { kind: 'gold', id: 'gold', lvl: 0, name: 'Gold', txt: '+' + Math.round(GOLD_CARD * this.goldMul(p)) + ' gold', sub: '', icon: 'pickup.coin', evo: false, val: Math.round(GOLD_CARD * this.goldMul(p)) }; };
  const healCard = () => ({ kind: 'heal', id: 'heal', lvl: 0, name: 'Meal', txt: '+' + HEAL_CARD + ' HP', sub: '', icon: 'pickup.heart', evo: false, val: HEAL_CARD });

  // Weighted card pool of hero p ([{ w, c }]), without banned keys and keys in `skip` (cards already shown).
  // Weights: weapon level 4 (+2 with every weapon slot full, +3 when it makes an evolution ready); new weapon 3; passive level 3 (+1.5 with every passive slot full);
  // new passive 2 (+1.5 when it pairs an owned weapon, +4 when it makes an evolution ready); skill upgrade 1.5 (+1 with every slot full).
  W.cardPool = function (p, skip) {
    const pool = [], sigs = (p.meta && p.meta.sigs) || [], ban = p.banned || [];
    const wFull = p.weapons.length >= ED.MAX_WEAPONS, pFull = p.passives.length >= ED.MAX_PASSIVES;
    const take = (w, c) => { const k = cardKey(c); if (ban.indexOf(k) < 0 && (!skip || skip.indexOf(k) < 0)) pool.push({ w, c }); };
    if (!wFull) for (const id of ED.WEAPON_IDS) {
      const d = ED.WEAPONS[id];
      if (d.evolved || owns(p, id)) continue;
      if (d.sig && d.sig !== p.cls && sigs.indexOf(d.sig) < 0) continue;
      if (p.weapons.some(ws => ED.WEAPONS[ws.id].evolved && ED.WEAPONS[ws.id].from === id)) continue;
      take(3, weaponCard(d));
    }
    for (const ws of p.weapons) {
      const d = ED.WEAPONS[ws.id];
      if (ws.lvl >= ED.weaponMaxLvl(d)) continue;
      const c = wlvlCard(p, ws);
      take(4 + (wFull ? 2 : 0) + (c.evo ? 3 : 0), c);
    }
    if (!pFull) for (const id of ED.PASSIVE_IDS) {
      if (ownsP(p, id)) continue;
      const c = passiveCard(p, id, 1), pairs = p.weapons.some(ws => { const wd = ED.WEAPONS[ws.id]; return !wd.evolved && wd.evo && wd.pair === id; });
      take(2 + (pairs ? 1.5 : 0) + (c.evo ? 4 : 0), c);
    }
    for (const ps of p.passives) if (ps.lvl < ED.PASSIVES[ps.id].max) take(3 + (pFull ? 1.5 : 0), passiveCard(p, ps.id, ps.lvl + 1));
    for (const sk of p.skills) {
      const d = ED.SKILLS[sk.id];
      if (!d || sk.lvl >= ED.skillMaxLvl(d)) continue;
      take(1.5 + (wFull && pFull ? 1 : 0), skillCard(sk));
    }
    return pool;
  };
  // Offer of hero p: 3 cards (a 4th when a luck roll succeeds), weighted draw without repeats; missing cards are filled with Gold, then Meal.
  W.makeOffer = function (p) {
    const pool = this.cardPool(p, null), n = 3 + (this.rng.next() < p.stats.luck ? 1 : 0), out = [];
    while (out.length < n && pool.length) {
      const it = this.rng.weighted(pool, x => x.w);
      pool.splice(pool.indexOf(it), 1); out.push(it.c);
    }
    if (out.length < n) out.push(this.goldCard(p));
    if (out.length < n) out.push(healCard());
    return out;
  };
  // Banishes card i of p's offer: its item leaves this run's pool and a fresh card replaces it (dropped when the pool is empty). Gold / Meal cannot be banished. Returns true when done.
  W.banishCard = function (p, i) {
    const c = p.offer && p.offer[i];
    if (!c || p.banishes <= 0 || c.kind === 'gold' || c.kind === 'heal') return false;
    p.banishes--; p.banned.push(cardKey(c));
    p.offer = p.offer.slice(); // a new array: the host resends offers when the reference changes
    const shown = p.offer.map(cardKey), pool = this.cardPool(p, shown);
    if (pool.length) p.offer[i] = this.rng.weighted(pool, x => x.w).c;
    else {
      p.offer.splice(i, 1);
      if (!p.offer.some(x => x.kind === 'gold')) p.offer.push(this.goldCard(p));
      if (!p.offer.some(x => x.kind === 'heal')) p.offer.push(healCard());
    }
    this.emit({ t: 'offer', pid: p.pid, banish: true });
    return true;
  };
  W.pickCard = function (p, i) {
    const c = p.offer && p.offer[i];
    if (!c) return false;
    this.applyCard(p, c);
    p.offer = null;
    this.recalc(p, false);
    if (!this.solo()) p.invuln = Math.max(p.invuln, 1);
    this.emit({ t: 'pick', pid: p.pid, kind: c.kind, id: c.id, lvl: c.lvl });
    return true;
  };
  W.applyCard = function (p, c) {
    if (c.kind === 'weapon') this.addWeapon(p, c.id);
    else if (c.kind === 'wlvl') { const ws = p.weapons.find(x => x.id === c.id); if (ws) ws.lvl = Math.min(ED.weaponMaxLvl(ED.WEAPONS[ws.id]), ws.lvl + 1); }
    else if (c.kind === 'passive') { if (p.passives.length < ED.MAX_PASSIVES && !ownsP(p, c.id)) p.passives.push({ id: c.id, lvl: 1 }); }
    else if (c.kind === 'plvl') { const ps = p.passives.find(x => x.id === c.id); if (ps) ps.lvl = Math.min(ED.PASSIVES[ps.id].max, ps.lvl + 1); }
    else if (c.kind === 'skill') { const sk = p.skills.find(x => x.id === c.id); if (sk) sk.lvl = Math.min(ED.skillMaxLvl(ED.SKILLS[sk.id]), sk.lvl + 1); }
    else if (c.kind === 'gold') this.gold += c.val || GOLD_CARD;
    else if (c.kind === 'heal') this.heal(p, c.val || HEAL_CARD);
  };

  // ---------------- chests ----------------
  // Chest opened by p (val 1 elite, 2 boss): evolves the first evolution-ready weapon; otherwise 1 roll + one at 30% + luck + one at 10% + luck / 2, each levelling a random owned
  // weapon (weight 2) or passive (weight 1) below max (an item maxed by a roll leaves the pool); with nothing to level a roll pays 25 gold x goldMul.
  // Emits 'chest' { pid, val, results: [{ kind: 'evo'|'wlvl'|'plvl'|'gold', id, from (evo: base weapon id), lvl, name, icon, txt, val (gold) }] } and returns results.
  W.openChest = function (p, val) {
    const results = [], ready = p.weapons.find(ws => this.weaponReady(p, ws));
    if (ready) {
      const from = ready.id; this.evolve(p, ready);
      const d = ED.WEAPONS[ready.id];
      results.push({ kind: 'evo', id: ready.id, from, lvl: ready.lvl, name: d.name, icon: d.icon, txt: (ED.WEAPONS[from].name || from) + ' evolved', val: 0 });
    } else {
      const L = Math.min(1, p.stats.luck), n = 1 + (this.rng.next() < 0.3 + L ? 1 : 0) + (this.rng.next() < 0.1 + L / 2 ? 1 : 0);
      const opts = [];
      for (const ws of p.weapons) if (ws.lvl < ED.weaponMaxLvl(ED.WEAPONS[ws.id])) opts.push({ w: 2, kind: 'wlvl', id: ws.id });
      for (const ps of p.passives) if (ps.lvl < ED.PASSIVES[ps.id].max) opts.push({ w: 1, kind: 'plvl', id: ps.id });
      for (let k = 0; k < n; k++) {
        if (!opts.length) { const g = Math.round(GOLD_CARD * this.goldMul(p)); this.gold += g; results.push({ kind: 'gold', id: 'gold', lvl: 0, name: 'Gold', icon: 'pickup.coin', txt: '+' + g + ' gold', val: g }); continue; }
        const o = this.rng.weighted(opts, x => x.w);
        let r;
        if (o.kind === 'wlvl') {
          const ws = p.weapons.find(x => x.id === o.id), d = ED.WEAPONS[ws.id], c = wlvlCard(p, ws);
          ws.lvl++;
          r = { kind: 'wlvl', id: ws.id, lvl: ws.lvl, name: d.name, icon: d.icon, txt: c.txt, val: 0 };
          if (ws.lvl >= ED.weaponMaxLvl(d)) opts.splice(opts.indexOf(o), 1);
        } else {
          const ps = p.passives.find(x => x.id === o.id), d = ED.PASSIVES[ps.id];
          ps.lvl++;
          r = { kind: 'plvl', id: ps.id, lvl: ps.lvl, name: d.name, icon: d.icon, txt: (d.lines && d.lines[ps.lvl - 1]) || d.txt, val: 0 };
          if (ps.lvl >= d.max) opts.splice(opts.indexOf(o), 1);
        }
        results.push(r);
      }
    }
    this.recalc(p, false);
    this.emit({ t: 'chest', pid: p.pid, val: val | 0, results });
    return results;
  };

  // ---------------- results ----------------
  // Damage table of one hero (a World.summary() perHero entry or a live hero): [{ id, kind: 'weapon'|'skill'|'other', name, icon, dmg, frac (share of the total) }], largest first.
  // Damage dealt by a weapon before its evolution is folded into the evolved weapon's row.
  ED.dmgRows = (h) => {
    const m = Object.assign({}, h.dealt || {}), ids = (h.weapons || []).map(x => (typeof x === 'string' ? x : x.id));
    for (const id of ids) { const d = ED.WEAPONS[id]; if (d && d.evolved && d.from && m[d.from]) { m[id] = (m[id] || 0) + m[d.from]; delete m[d.from]; } }
    let total = 0;
    const rows = [];
    for (const id in m) {
      const v = m[id]; if (!(v > 0)) continue;
      total += v;
      const wd = ED.WEAPONS[id], sd = ED.SKILLS && ED.SKILLS[id];
      rows.push(wd ? { id, kind: 'weapon', name: wd.name, icon: wd.icon, dmg: Math.round(v), frac: 0 }
        : sd ? { id, kind: 'skill', name: sd.name, icon: sd.icon, dmg: Math.round(v), frac: 0 }
          : { id, kind: 'other', name: id === 'bomb' ? 'Holy Bomb' : 'Other', icon: id === 'bomb' ? 'pickup.bomb' : '', dmg: Math.round(v), frac: 0 });
    }
    for (const r of rows) r.frac = total > 0 ? r.dmg / total : 0;
    rows.sort((a, b) => b.dmg - a.dmg || (a.id < b.id ? -1 : 1));
    return rows;
  };
})(globalThis.ED || (globalThis.ED = {}));
