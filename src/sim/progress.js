// Pickups, party XP / levels, card offers and chests (GAME-DESIGN §6, §9; ARCHITECTURE §8).
// Pickup k: 'xp1' | 'xp5' | 'xp25' (val = XP) | 'gold' (val coins) | 'food' (val HP) | 'magnet' | 'bomb' | 'chest' (val 1 elite, 2 boss). Gems merge into the nearest gem above GEM_CAP on the ground.
// Gems and gold are pulled inside the hero's pickup radius; food, magnet, bomb and chests need a touch. Pulled pickups fly to the hero with an accelerating curve.
// Card: { kind: 'weapon'|'wlvl'|'passive'|'plvl'|'skill'|'gold'|'heal', id, lvl (level after the pick), name, txt (<= 40 chars), sub (second line or ''), icon }.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, W = ED.World.prototype;
  const GEM_CAP = 350, TOUCH = 6;

  W.initProgress = function () { this.pickPool = []; this.gemCount = 0; };
  const gemKind = (v) => (v >= 25 ? 'xp25' : v >= 5 ? 'xp5' : 'xp1');
  const isGem = (k) => k === 'xp1' || k === 'xp5' || k === 'xp25';

  W.spawnPickup = function (k, x, y, val) {
    const g = this.pickPool.pop() || {};
    g.id = this.nextId(); g.k = k; g.x = x; g.y = y; g.val = val || 1; g.vx = 0; g.vy = 0; g.pull = ''; g.t = 0; g.dead = false;
    this.pickups.push(g);
    if (isGem(k)) this.gemCount++;
    return g;
  };
  // XP gem of value v at (x, y); above GEM_CAP gems on the ground it merges into the nearest free gem.
  W.dropGem = function (x, y, v) {
    if (this.gemCount >= GEM_CAP) {
      let best = null, bd = Infinity;
      for (const g of this.pickups) { if (g.dead || g.pull || !isGem(g.k)) continue; const d = U.dist2(x, y, g.x, g.y); if (d < bd) { bd = d; best = g; } }
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
      for (const p of this.living) {
        const R = gem || g.k === 'gold' ? p.stats.pickup : p.r + 10;
        if (U.dist2(p.x, p.y, g.x, g.y) <= R * R) { g.pull = p.pid; g.t = 0; break; }
      }
    }
    this.gemCount = gems;
    const B = this.arena.braziers;
    for (const p of this.living) for (let i = 0; i < B.length; i++) { const b = B[i]; if (!b.broken && U.dist2(p.x, p.y, b.x, b.y) <= (p.r + b.r + 4) ** 2) this.breakBrazier(b, p); }
  };

  W.collect = function (p, g) {
    g.dead = true;
    const k = g.k;
    if (isGem(k)) this.addXp(g.val * (1 + p.stats.growth) * (this.cheats.xp || 1));
    else if (k === 'gold') this.gold += Math.round(g.val * (1 + p.stats.greed));
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
  // Inputs that act on offers (also while paused): pick 1-4, reroll (p.rerolls), skip (p.skips).
  W.applyPicks = function () {
    for (const p of this.heroes) {
      const I = p.in;
      if (p.offer && !p.dead) {
        if (I.pick) this.pickCard(p, I.pick - 1);
        else if (I.reroll && p.rerolls > 0) { p.rerolls--; p.offer = this.makeOffer(p); this.emit({ t: 'offer', pid: p.pid, reroll: true }); }
        else if (I.skip && p.skips > 0) { p.skips--; p.offer = null; this.emit({ t: 'pick', pid: p.pid, kind: 'skip', id: '' }); }
        if (this.solo()) I.dash = I.q = I.e = false; // presses made while the solo game is paused on cards do not fire afterwards
      }
      I.pick = 0; I.reroll = false; I.skip = false;
    }
    if (this.paused && this.solo() && !this.heroes.some(p => p.offer)) this.paused = false;
  };

  const passiveCard = (p, id, lvl) => {
    const d = ED.PASSIVES[id], evo = ED.WEAPON_IDS.filter(w => ED.WEAPONS[w].pair === id && !ED.WEAPONS[w].evolved && ED.WEAPONS[w].evo);
    const mine = evo.filter(w => p.weapons.some(ws => ws.id === w)), show = (mine.length ? mine : evo).slice(0, 2).map(w => ED.WEAPONS[w].name);
    return { kind: lvl > 1 ? 'plvl' : 'passive', id, lvl, name: d.name, txt: d.txt, sub: show.length ? 'Evolves: ' + show.join(', ') : '', icon: d.icon };
  };
  // Draws 3 cards (4 when a luck roll succeeds) without repeats, weighted: weapon level 4, new weapon 3, passive level 3, new passive 2, skill 1.5. Gold / heal when nothing is left.
  W.makeOffer = function (p) {
    const pool = [], sigs = (p.meta && p.meta.sigs) || [];
    if (p.weapons.length < ED.MAX_WEAPONS) for (const id of ED.WEAPON_IDS) {
      const d = ED.WEAPONS[id];
      if (d.evolved || p.weapons.some(ws => ws.id === id)) continue;
      if (d.sig && d.sig !== p.cls && sigs.indexOf(d.sig) < 0) continue;
      if (p.weapons.some(ws => ED.WEAPONS[ws.id].evolved && ED.WEAPONS[ws.id].from === id)) continue;
      pool.push({ w: 3, c: { kind: 'weapon', id, lvl: 1, name: d.name, txt: d.txt || 'New weapon', sub: '', icon: d.icon } });
    }
    for (const ws of p.weapons) {
      const d = ED.WEAPONS[ws.id];
      if (ws.lvl >= ED.weaponMaxLvl(d)) continue;
      const L = d.levels[ws.lvl - 1];
      pool.push({ w: 4, c: { kind: 'wlvl', id: ws.id, lvl: ws.lvl + 1, name: d.name, txt: (L && L.txt) || 'Level up', sub: '', icon: d.icon } });
    }
    if (p.passives.length < ED.MAX_PASSIVES) for (const id of ED.PASSIVE_IDS) if (!p.passives.some(ps => ps.id === id)) pool.push({ w: 2, c: passiveCard(p, id, 1) });
    for (const ps of p.passives) if (ps.lvl < ED.PASSIVES[ps.id].max) pool.push({ w: 3, c: passiveCard(p, ps.id, ps.lvl + 1) });
    for (const sk of p.skills) {
      const d = ED.SKILLS[sk.id];
      if (sk.lvl >= ED.skillMaxLvl(d)) continue;
      pool.push({ w: 1.5, c: { kind: 'skill', id: sk.id, lvl: sk.lvl + 1, name: d.name, txt: d.levels[sk.lvl - 1].txt, sub: '', icon: d.icon } });
    }
    const n = 3 + (this.rng.next() < p.stats.luck ? 1 : 0), out = [];
    while (out.length < n && pool.length) {
      const it = this.rng.weighted(pool, x => x.w);
      pool.splice(pool.indexOf(it), 1); out.push(it.c);
    }
    if (!out.length) out.push({ kind: 'gold', id: 'gold', lvl: 0, name: 'Gold', txt: '+25 gold', sub: '', icon: 'pickup.coin' }, { kind: 'heal', id: 'heal', lvl: 0, name: 'Meal', txt: '+30 HP', sub: '', icon: 'pickup.heart' });
    return out;
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
    else if (c.kind === 'passive') { if (p.passives.length < ED.MAX_PASSIVES) p.passives.push({ id: c.id, lvl: 1 }); }
    else if (c.kind === 'plvl') { const ps = p.passives.find(x => x.id === c.id); if (ps) ps.lvl = Math.min(ED.PASSIVES[ps.id].max, ps.lvl + 1); }
    else if (c.kind === 'skill') { const sk = p.skills.find(x => x.id === c.id); if (sk) sk.lvl = Math.min(ED.skillMaxLvl(ED.SKILLS[sk.id]), sk.lvl + 1); }
    else if (c.kind === 'gold') this.gold += 25;
    else if (c.kind === 'heal') this.heal(p, 30);
  };

  // Chest: evolves the first evolution-ready weapon, else levels 1-3 random owned items (luck adds chances). Emits 'chest' { pid, results: [{ kind: 'evo'|'wlvl'|'plvl'|'gold', id }] }.
  W.openChest = function (p) {
    const results = [], ready = p.weapons.find(ws => this.weaponReady(p, ws));
    if (ready) { const from = ready.id; this.evolve(p, ready); results.push({ kind: 'evo', id: ready.id, from }); }
    else {
      const n = 1 + (this.rng.next() < 0.3 + p.stats.luck ? 1 : 0) + (this.rng.next() < 0.1 + p.stats.luck / 2 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const opts = [];
        for (const ws of p.weapons) if (ws.lvl < ED.weaponMaxLvl(ED.WEAPONS[ws.id])) opts.push({ kind: 'wlvl', id: ws.id });
        for (const ps of p.passives) if (ps.lvl < ED.PASSIVES[ps.id].max) opts.push({ kind: 'plvl', id: ps.id });
        if (!opts.length) { this.gold += 25; results.push({ kind: 'gold', id: 'gold' }); continue; }
        const c = opts[this.rng.int(0, opts.length - 1)];
        this.applyCard(p, c); results.push(c);
      }
      this.recalc(p, false);
    }
    this.emit({ t: 'chest', pid: p.pid, results });
  };
})(globalThis.ED || (globalThis.ED = {}));
