// Authoritative simulation. Runs on the host (or locally in solo play); clients mirror it from snapshots.
// Split across files by prototype extension: combat.js (damage, attacks, skills), ai.js (enemy brains),
// bosses.js (boss scripts), rooms.js (encounters, props, interactions). This file also owns the lantern and dread tiers.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, D = ED.Dungeon;
  const Sim = ED.Sim = {};

  // ---------------- shared movement / collision (also used by clients for their own hero) ----------------
  const solidFor = (t, locked, fly) => t === 1 || t === 2 || (t === 5 && locked) || (t === 3 && !fly);

  Sim.resolve = (e, room, locked, fly) => {
    const r = e.r;
    const x0 = Math.floor((e.x - r) / T), x1 = Math.floor((e.x + r) / T);
    const y0 = Math.floor((e.y - r) / T), y1 = Math.floor((e.y + r) / T);
    let hit = false;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = (tx < 0 || ty < 0 || tx >= room.w || ty >= room.h) ? 1 : room.tiles[ty * room.w + tx];
      if (!solidFor(t, locked, fly)) continue;
      const cx = U.clamp(e.x, tx * T, tx * T + T), cy = U.clamp(e.y, ty * T, ty * T + T);
      const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-4) { const d = Math.sqrt(d2), push = r - d; e.x += dx / d * push; e.y += dy / d * push; }
      else {
        const l = e.x - tx * T, rr = tx * T + T - e.x, u = e.y - ty * T, dd = ty * T + T - e.y;
        const m = Math.min(l, rr, u, dd);
        if (m === l) e.x = tx * T - r; else if (m === rr) e.x = tx * T + T + r; else if (m === u) e.y = ty * T - r; else e.y = ty * T + T + r;
      }
    }
    return hit;
  };

  Sim.moveCircle = (e, dx, dy, room, locked, fly) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(2, e.r * 0.5)));
    let hit = false;
    for (let i = 0; i < steps; i++) {
      e.x += dx / steps; if (Sim.resolve(e, room, locked, fly)) hit = true;
      e.y += dy / steps; if (Sim.resolve(e, room, locked, fly)) hit = true;
    }
    return hit;
  };

  Sim.los = (room, x0, y0, x1, y1, locked) => {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 10);
    for (let i = 1; i < n; i++) {
      const t = D.tileAt(room, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
      if (D.blocksShots(t, locked)) return false;
    }
    return true;
  };

  // Furthest point along a ray that a circle of radius r can stand on.
  Sim.castMove = (room, x, y, a, maxD, r, locked) => {
    const probe = { x, y, r };
    let lastX = x, lastY = y;
    for (let d = 8; d <= maxD; d += 8) {
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      const t = D.tileAt(room, px, py);
      if (t === 1 || t === 2 || (t === 5 && locked)) break;
      if (t !== 3) { lastX = px; lastY = py; }
    }
    probe.x = lastX; probe.y = lastY; Sim.resolve(probe, room, locked, false);
    return { x: probe.x, y: probe.y };
  };

  // Hero movement: walking, dash, skill-move, hazards and pull zones.
  Sim.movePlayer = (p, inp, dt, room, locked, zones) => {
    if (p.downed || p.dead) { p.moving = false; return; }
    const speed = p.stats.moveSpeed * (ED.Stats.moveRate ? ED.Stats.moveRate(p) : 1);
    if (p.skillMove) {
      const m = p.skillMove;
      Sim.moveCircle(p, m.dx * m.speed * dt, m.dy * m.speed * dt, room, locked, false);
      m.t -= dt; p.moving = true;
      if (m.t <= 0) p.skillMove = null;
      return;
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      Sim.moveCircle(p, p.dashDx * 430 * dt, p.dashDy * 430 * dt, room, locked, false);
      p.moving = true;
      return;
    }
    let mx = inp.mx || 0, my = inp.my || 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const tile = D.tileAt(room, p.x, p.y);
    const hz = tile === 4 ? ED.biomeFor(room.stratum).hazard : null;
    let sp = speed;
    if (hz === 'water') sp *= 0.62;
    if (hz === 'poison') sp *= 0.85;
    if (zones) for (const z of zones) if (z.kind === 'mire' && z.team === 1 && U.dist2(z.x, z.y, p.x, p.y) < z.r * z.r) { sp *= 0.55; break; }
    const accel = hz === 'ice' ? 3.2 : 22;
    p.vx = (p.vx || 0) + (mx * sp - (p.vx || 0)) * Math.min(1, accel * dt);
    p.vy = (p.vy || 0) + (my * sp - (p.vy || 0)) * Math.min(1, accel * dt);
    let px = p.vx, py = p.vy;
    if (zones) for (const z of zones) {
      if (z.kind !== 'pull') continue;
      const d = Math.hypot(z.x - p.x, z.y - p.y);
      if (d < z.r && d > 4) { const k = (z.str || 0) / d; px += (z.x - p.x) * k; py += (z.y - p.y) * k; }
    }
    Sim.moveCircle(p, px * dt, py * dt, room, locked, false);
    p.moving = len > 0.1;
    if (p.moving) { p.mvx = mx; p.mvy = my; }
  };

  // ---------------- World ----------------
  const W = ED.World = function (opts) {
    this.seed = (opts.seed >>> 0) || 1;
    this.rng = U.RNG(this.seed ^ 0xa11ce);
    this.pact = opts.pact | 0;
    this.players = new Map();
    this.enemies = []; this.projs = []; this.pickups = []; this.zones = []; this.allies = []; this.props = [];
    this.fx = []; this.msgs = [];
    this.gold = 0; this.xp = 0; this.level = 1; this.xpNext = W.xpFor(1);
    this.time = 0; this.roomTime = 0; this.state = 'play'; this.stratum = 0; this.floorSeed = 0;
    this.locked = false; this.enc = null; this.boss = null; this.pendingStratum = null;
    this.run = { kills: 0, roomsCleared: 0, elitesKilled: 0, bosses: 0, bossCount: 0, revives: 0, maxGold: 0, maxRelics: 0, flawlessBoss: false,
      lightlessBoss: false, fullClear: false, roomsVisited: 0, roomsTotal: 0, lightAtBoss: [],
      embers: { rooms: 0, elites: 0, bosses: 0, victory: 0 } };
    this.light = 100; this.lightMax = 100; this.dread = Object.assign({}, W.DREAD[0]); // lantern and dread tier (see updateLantern)
    this.gloomT = null; this.gloomN = 0; this.deepRooms = 0; this.bossTier = 0; this.fullClearDone = 0;
    this.roomState = {};
    this.endTimer = -1; this.result = null; this.victory = false;
    this.flowT = 0; this.flow = null; this.tick = 0; this.waitMsg = '';
    this.tutorial = !!opts.tutorial;
    this.chainQ = []; this.chainSeq = 0; this.curChain = null; this.chainPeak = 0; this.chainHops = 0; // forced payoffs of duos and keystones (see combat.js); peak queue length and deepest hop are bot statistics
    for (const pd of opts.players) this.addPlayer(pd);
  };
  W.xpFor = (L) => Math.round(30 + 3 * (L - 1) + 6 * (L - 1) * (L - 1)); // xp from level L to L+1
  // Dread tiers by light fraction (>= 0.5, >= 0.25, > 0, 0): foe hp (1 in every tier: darkness never adds HP) and damage multipliers, elite chance added to a room's, wave budget multiplier, room gold & embers multiplier,
  // chance (up) that a cleared room's reward is upgraded, seconds after entering a room until the Gloom hunts (gloom 0 = none), Glooms hunting at once (glooms), healing multiplier (heal).
  W.DREAD = [
    { tier: 0, hp: 1, dmg: 1, elite: 0, wave: 1, gold: 1, up: 0, gloom: 0, glooms: 0, heal: 1 },
    { tier: 1, hp: 1, dmg: 1.1, elite: 0.2, wave: 1, gold: 1.25, up: 0, gloom: 0, glooms: 0, heal: 1 },
    { tier: 2, hp: 1, dmg: 1.6, elite: 0.4, wave: 1, gold: 1.5, up: 0.12, gloom: 8, glooms: 1, heal: 0.7 },
    { tier: 3, hp: 1, dmg: 2.3, elite: 0.6, wave: 1, gold: 1.75, up: 0.2, gloom: 3, glooms: 1, heal: 0.5 },
  ];
  W.ELITE = { hp: 2.4, hpStep: 0.4, dmg: 0.9 }; // elite HP multiplier at stratum I (+ hpStep per stratum) and damage multiplier
  W.HAZARD_MUL = 0.5; // floor hazard damage multiplier
  W.LANTERN_MUL = [1.3, 1.2, 1.1, 1, 1, 1]; // lantern size per stratum: the first strata are bright
  W.GLOOM_GAP = 4; // seconds between the Glooms of one room when its tier hunts with more than one
  W.GLOOM_STEP = 1; W.GLOOM_MAX = 3; // Lightless hunts with 1 + floor(deepRooms / GLOOM_STEP) Glooms, at most GLOOM_MAX
  W.DEEP = 0.28; W.DEEP_MAX = 5; // every new room entered Dark or Lightless raises foe damage by DEEP for the rest of the stratum (up to DEEP_MAX rooms)
  W.GLOOM_HIT = 0.19; // Gloom touch damage as a fraction of the toughest living hero's max HP
  W.OIL_LIGHT = 35; // light gained from a lantern oil reward or shop oil
  W.FLARE = { cost: 6, banish: 12, blind: 1.5, r: 160 }; // lantern flare (F): light spent, seconds the Gloom stays away, foe blind seconds, blind radius
  W.DARK_AFFIXES = ['brutal', 'vampiric', 'warded', 'swift']; // affix pool of elites made at Dark and Lightless (the volatile affix is left out)
  W.ELITE_BODIES = 4; // plain-foe budget one elite displaces from its wave in any tier but Bright
  W.REWARD_UP = { gold: 'vigor', vigor: 'forge', forge: 'epic', boon: 'epic' }; // darkness upgrades a room reward one step
  // Per-stratum threat on top of the base scales: foe HP, wave budget, `cdRate` = extra cooldown recovery (0.2 = attack timers tick 20% faster, -0.2 = 20% slower) and the boss pause between attacks (x).
  W.THREAT = [{ hp: 2.2, dmg: 0.5, wave: 0.8, cdRate: -0.4, pause: 2 }, { hp: 1.62, dmg: 0.5, wave: 0.75, cdRate: -0.3, pause: 1.7 }, { hp: 1.3, dmg: 0.5, wave: 0.7, cdRate: -0.1, pause: 1.4 }, { hp: 1, dmg: 0.4, wave: 0.66, cdRate: 0, pause: 1.2 }, { hp: 1.07, dmg: 0.8, wave: 0.62, cdRate: 0.15, pause: 1 }, { hp: 1.02, dmg: 1, wave: 0.6, cdRate: 0.3, pause: 0.9 }];
  // Foe HP multiplier of stratum s: the depth curve times the threat HP.
  W.hpScale = (s) => (1 + 0.65 * (s - 1) + 0.08 * (s - 1) * (s - 1)) * W.THREAT[Math.max(0, Math.min(W.THREAT.length - 1, s - 1))].hp;
  // Wave pacing of combat rooms: seconds before the first wave, spawn telegraph (+ random extra), minimum gap before the next wave, the share of a wave that may still stand when the next one is called, the seconds after which the next wave comes regardless, and the minimum spawn distance from heroes (turrets keep more).
  W.PACE = { first: 0.5, spawn: 0.7, spawnVar: 0.25, gap: 0.9, nextAt: 0.45, maxAge: 6, avoid: 100, avoidTurret: 130 };
  W.DRAIN_SECS = [2500, 2200, 2050, 2000, 2000, 2000]; // seconds for a full unupgraded lantern to burn out on the slow per-second drain, per stratum
  // Entering a room not yet visited costs this much light (of 100, not scaled by Deep Wick); revisits, the start room and the boss room are free. Shown on doors and the map.
  W.ROOM_COST = { combat: 12, elite: 17, treasure: 8, shop: 8, event: 8, rest: 8 };
  W.roomCost = (type) => W.ROOM_COST[type] || 0;
  // Dread tier of a light fraction.
  W.tierOf = (f) => f >= 0.5 ? 0 : f >= 0.25 ? 1 : f > 0 ? 2 : 3;
  // Boss-door reward for the light left (fraction f): every living hero heals `heal` and gains a `shield` (both fractions of max HP); the party gains `gold` and `embers`.
  W.bossLight = (f, stratum) => ({ heal: 0.5 * f, shield: 0.8 * f, gold: Math.round(f * (10 + 5 * stratum)), embers: Math.round(f * (2 + stratum)) });

  // Gold dropped by a 'gold' room reward (shared with the UI): 15 + 8 per stratum, times the dread gold bonus and the global gold multiplier.
  W.rewardGold = (stratum, dreadGold) => Math.round((15 + 8 * stratum) * (dreadGold || 1) * W.GOLD_MUL);
  W.GOLD_MUL = 0.65; // every gold drop (kills, rooms, chests, rewards) is scaled by this; shops sell at full price
  W.prototype.threat = function () { return W.THREAT[Math.max(0, Math.min(W.THREAT.length - 1, this.stratum - 1))]; };
  W.prototype.emit = function (ev) { this.fx.push(ev); };
  W.prototype.partySize = function () { return Math.max(1, this.players.size); };
  W.prototype.partyHpMul = function () { const n = this.partySize() - 1; return 1 + 0.9 * n + 0.3 * n * (n - 1); };
  W.prototype.alive = function (p) { return p && !p.downed && !p.dead; };
  W.prototype.alivePlayers = function () { const out = []; for (const p of this.players.values()) if (!p.downed && !p.dead) out.push(p); return out; };
  W.prototype.hostiles = function () { let n = 0; for (const e of this.enemies) if (e.hp > 0 && !e.def.gloom) n++; return n; };

  W.prototype.nearestPlayer = function (x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (p.downed || p.dead || p.stealthT > 0) continue;
      const d = U.dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  W.prototype.nearestEnemy = function (x, y, maxD, exclude) {
    let best = null, bd = maxD * maxD;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || (exclude && exclude.has(e.id))) continue;
      const d = U.dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  // ---------------- players ----------------
  W.prototype.addPlayer = function (pd) {
    const p = {
      pid: pd.pid, name: pd.name || 'Hero', slot: pd.slot | 0, cls: pd.cls, weapon: pd.weapon,
      meta: pd.meta || { up: [], mastery: 1, relics: [] },
      boons: {}, relics: [], stats: null,
      x: 0, y: 0, r: 10, face: 0, vx: 0, vy: 0, mvx: 1, mvy: 0, moving: false,
      hp: 1, maxHp: 1, dashT: 0, dashDx: 0, dashDy: 0, dashing: false, skillMove: null,
      invuln: 0, hurtT: 0, downed: false, bleed: 0, revive: 0, dead: false,
      phoenixUsed: false, secondWind: 0, swPct: 0.4, angelUsed: false, aegisT: 0, guardCd: 0, guardT: 0,
      frozenCd: 0, tranceT: 0, wallT: 0, atkCount: 0, chaliceKills: 0, chaliceHp: 0, bonusHp: 0,
      picks: 0, offer: null, offerT: 0, rerolls: 0, claimed: {}, shield: 0,
      kills: 0, dealt: 0, hitThisBoss: false,
      remote: !!pd.remote, connected: true,
    };
    this.initBuild(p);
    this.initSkills(p);
    this.players.set(p.pid, p);
    this.recalc(p, true);
    return p;
  };

  W.prototype.removePlayer = function (pid) {
    const p = this.players.get(pid);
    if (!p) return;
    this.players.delete(pid);
    this.allies = this.allies.filter(a => a.owner !== pid);
    this.emit({ t: 'left', pid, name: p.name });
  };

  W.prototype.recalc = function (p, fill) {
    const prev = p.maxHp;
    p.stats = ED.Stats.compute({ cls: p.cls, weapon: p.weapon, boons: p.boons, relics: p.relics, meta: p.meta, pact: this.pact, chaliceHp: p.chaliceHp, bonusHp: p.bonusHp });
    p.maxHp = p.stats.maxHp;
    if (fill) p.hp = p.maxHp;
    else if (p.maxHp > prev && !p.downed && !p.dead) p.hp += p.maxHp - prev;
    p.hp = Math.min(p.hp, p.maxHp);
  };

  W.prototype.buildOf = function (p) { return { pid: p.pid, boons: Object.assign({}, p.boons), relics: p.relics.slice(), chaliceHp: p.chaliceHp, bonusHp: p.bonusHp }; };
  W.prototype.sendBuild = function (p) { this.emit({ t: 'build', b: this.buildOf(p) }); };

  // Heals up to max HP (no heal ever overflows into a shield). Returns the HP actually restored.
  W.prototype.healPlayer = function (p, amt, silent) {
    if (!p || p.downed || p.dead || p.hp >= p.maxHp) return 0;
    const v = Math.min(p.maxHp - p.hp, amt * p.stats.healMul * (this.dread.heal ?? 1));
    p.hp += v;
    if (!silent && v >= 1) this.emit({ t: 'heal', pid: p.pid, v: Math.round(v), x: p.x, y: p.y });
    return v;
  };

  // Adds amt (x the dread heal multiplier) to p's absorb shield up to cap (a shield above the cap is never lowered); k labels the source in p.shieldBy. Returns the shield gained.
  W.prototype.addShield = function (p, amt, cap, k) {
    if (!p || p.downed || p.dead || !(amt > 0) || !(p.shield < cap)) return 0;
    const to = Math.min(cap, p.shield + amt * (this.dread.heal ?? 1)), gain = to - p.shield;
    p.shield = to;
    p.shieldBy[k] = (p.shieldBy[k] || 0) + gain;
    this.emit({ t: 'shielded', pid: p.pid, v: Math.round(gain * 10) / 10, k });
    return gain;
  };

  // Shields fade by SHIELD_DECAY of max HP per second while no room is locked and outside boss rooms, so income serves only the room it was earned in.
  W.prototype.updateShields = function (dt) {
    if (this.locked || (this.room && this.room.type === 'boss')) return;
    for (const p of this.players.values()) if (p.shield > 0) p.shield = Math.max(0, p.shield - ED.CONST.SHIELD_DECAY * p.maxHp * dt);
  };

  // Relics any party member has unlocked can drop for everyone (shared progression); with nobody holding any unlocks, the start relics.
  W.prototype.unlockedRelics = function () {
    const set = new Set();
    for (const p of this.players.values()) for (const id of (p.meta.relics || [])) set.add(id);
    if (!set.size) ED.RELIC_IDS.filter(id => ED.RELICS[id].start).forEach(id => set.add(id));
    return set;
  };
  W.prototype.relicPool = function () {
    const set = this.unlockedRelics();
    const held = new Set();
    for (const p of this.players.values()) for (const id of p.relics) held.add(id);
    let pool = [...set].filter(id => !held.has(id));
    if (!pool.length) pool = [...set];
    return pool;
  };
  // A relic roll at least minRar. forHero: only relics that fit that hero (no element relics for a Generalist); without it, relics that fit at least one living hero, an element some living hero follows weighs x2 and any other element x0.5.
  // noElement: element relics are left out (the first picks of a hoard or shop for each Generalist in the party).
  W.prototype.rollRelic = function (minRar, exclude, forHero, noElement) {
    const order = { c: 0, r: 1, e: 2, l: 3 };
    const heroes = forHero ? [forHero] : this.alivePlayers();
    const fits = (id) => (!ED.RELICS[id].el || !noElement) && (!heroes.length || heroes.some(q => ED.relicFits(q, id)));
    const base = this.relicPool().filter(fits);
    let pool = base.filter(id => order[ED.RELICS[id].rar] >= order[minRar || 'c'] && !(exclude && exclude.has(id)));
    if (!pool.length) pool = base.length ? base : this.relicPool();
    const s = this.stratum;
    const w = { c: 50, r: 34 + s * 3, e: 14 + s * 3, l: 3 + s };
    const owned = new Set();
    if (!forHero) for (const q of heroes) for (const k of ED.elementGates(q.boons)) owned.add(k);
    return this.rng.weighted(pool, id => { const r = ED.RELICS[id]; return w[r.rar] * (r.el && !forHero ? (owned.has(r.el) ? 2 : 0.5) : 1); });
  };

  // A Generalist forsakes an element relic: it becomes a random unowned non-element relic of the same rarity (else the next rarity down, else 40 gold). Returns the new id or null.
  W.prototype.transmuteRelic = function (p, id) {
    const order = ['c', 'r', 'e', 'l'], set = this.unlockedRelics(), held = new Set();
    for (const q of this.players.values()) for (const x of q.relics) held.add(x);
    for (let i = order.indexOf(ED.RELICS[id].rar); i >= 0; i--) {
      const pool = [...set].filter(x => !ED.RELICS[x].el && ED.RELICS[x].rar === order[i] && !held.has(x));
      if (pool.length) return this.rng.pick(pool);
    }
    this.gold += 40;
    return null;
  };

  // A Generalist who owns element relics swaps each one (Armory, or any picked before the Generalist gate).
  W.prototype.forsakeRelics = function (p) {
    for (let i = 0; i < p.relics.length; i++) {
      const id = p.relics[i];
      if (ED.relicFits(p, id)) continue;
      const to = this.transmuteRelic(p, id);
      this.msgs.push({ to: p.pid, t: 'toast', text: to ? `A Generalist forsakes element relics: ${ED.RELICS[id].name} becomes ${ED.RELICS[to].name}.` : `A Generalist forsakes element relics: ${ED.RELICS[id].name} is sold for 40 gold.` });
      if (to) p.relics[i] = to; else { p.relics.splice(i, 1); i--; }
    }
    this.recalc(p, false);
    this.sendBuild(p);
  };

  // Gives p a relic; a Generalist's element relic transmutes (the price paid stays paid).
  W.prototype.giveRelic = function (p, id) {
    if (!ED.relicFits(p, id)) {
      const to = this.transmuteRelic(p, id);
      this.msgs.push({ to: p.pid, t: 'toast', text: to ? `A Generalist forsakes element relics: ${ED.RELICS[id].name} becomes ${ED.RELICS[to].name}.` : `A Generalist forsakes element relics: ${ED.RELICS[id].name} is sold for 40 gold.` });
      if (!to) return;
      id = to;
    }
    p.relics.push(id);
    this.recalc(p, false);
    this.run.maxRelics = Math.max(this.run.maxRelics, p.relics.length);
    this.emit({ t: 'relic', pid: p.pid, id, x: p.x, y: p.y });
    this.sendBuild(p);
  };

  // ---------------- run flow ----------------
  W.prototype.startRun = function () {
    for (const p of this.players.values()) {
      this.onRunStartBuild(p);
      this.sendBuild(p);
    }
    this.enterStratum(1);
  };

  W.prototype.enterStratum = function (s) {
    this.stratum = s;
    this.floorSeed = this.rng.seed();
    this.floor = D.generate(s, this.floorSeed);
    this.roomState = {};
    for (const r of this.floor.rooms) this.roomState[r.id] = { visited: false, known: false, cleared: false, props: null };
    this.run.roomsTotal += this.floor.rooms.length;
    this.lightMax = this.lanternMax(); this.light = this.lightMax; this.updateDread(); this.deepRooms = 0;
    this.allies.length = 0;
    for (const p of this.players.values()) {
      if (p.dead) { p.dead = false; p.downed = false; p.hp = Math.round(p.maxHp * 0.3); p.invuln = 2; }
      if (p.downed) { p.downed = false; p.hp = Math.max(p.hp, Math.round(p.maxHp * 0.3)); }
      this.onStratumBuild(p, s);
    }
    this.emit({ t: 'stratum', s, seed: this.floorSeed });
    this.enterRoom(this.floor.start, null);
  };

  W.prototype.enterRoom = function (id, fromDir) {
    this.collectAll();
    this.enemies.length = 0; this.projs.length = 0; this.zones.length = 0; this.chainQ.length = 0; this.curChain = null;
    this.boss = null; this.enc = null;
    this.roomId = id;
    this.roomEpoch = (this.roomEpoch || 0) + 1;
    const room = this.room = this.floor.rooms[id];
    const rs = this.roomState[id];
    let cost = 0, atBoss = false;
    if (!rs.visited) { this.run.roomsVisited++; cost = W.roomCost(room.type); }
    rs.visited = true; rs.known = true;
    if (cost > 0) { this.light = Math.max(0, this.light - cost); this.updateDread(); } // paid before the room's encounter is planned
    this.gloomT = null; this.gloomN = 0;
    if (cost > 0 && this.dread.tier >= 2) this.deepRooms++;
    if (room.type === 'boss' && !rs.cleared) { this.bossTier = this.dread.tier; this.run.lightAtBoss.push(Math.round(this.light / this.lightMax * 100) / 100); atBoss = true; }
    for (const d in room.doors) if (room.doors[d] >= 0) this.roomState[room.doors[d]].known = true;
    let k = 0;
    const pos = [];
    for (const p of this.players.values()) {
      const pt = fromDir ? D.entryPoint(room, D.OPP[fromDir], k) : { x: D.center(room).x + (k - 1.5) * 22, y: D.center(room).y + 20 };
      p.x = pt.x; p.y = pt.y; p.vx = 0; p.vy = 0; p.dashT = 0; p.skillMove = null;
      p.toughRoom = room.type === 'elite' || room.type === 'boss'; // War Drum doubles in these rooms
      pos.push([p.pid, Math.round(p.x), Math.round(p.y)]);
      k++;
    }
    for (const a of this.allies) { const o = this.players.get(a.owner); if (o) { a.x = o.x + this.rng.range(-20, 20); a.y = o.y + this.rng.range(-20, 20); } }
    if (!rs.props) rs.props = this.makeProps(room);
    this.props = rs.props;
    this.roomTime = 0;
    this.locked = false;
    if (!rs.cleared) this.beginEncounter(room, rs);
    this.checkFullClear();
    this.computeFlow();
    this.emit({ t: 'room', id, from: fromDir || '', pos, locked: this.locked, ep: this.roomEpoch, lc: cost });
    if (atBoss) this.bossLantern();
  };

  W.prototype.collectAll = function () {
    // Leaving a room vacuums up gold and experience so nothing is ever lost to a door.
    for (const pk of this.pickups) {
      if (pk.kind === 'gold') this.gold += pk.val;
      else if (pk.kind === 'xp') this.addXp(pk.val);
    }
    this.pickups.length = 0;
    this.run.maxGold = Math.max(this.run.maxGold, this.gold);
  };

  W.prototype.endRun = function (victory) {
    if (this.state !== 'play') return;
    this.victory = victory;
    this.state = 'ending';
    this.endTimer = victory ? 4.5 : 2.8;
    this.emit({ t: victory ? 'victory' : 'defeat' });
  };

  W.prototype.summary = function () {
    const players = {};
    for (const p of this.players.values()) players[p.pid] = { cls: p.cls, name: p.name, kills: p.kills, dealt: Math.round(p.dealt), emberBonus: p.stats.emberBonus || 0, relics: p.relics.length, evo: p.stats.evo || null };
    return {
      victory: this.victory, retreat: !!this.retreat, abandoned: !!this.abandoned, stratum: this.stratum, time: Math.round(this.time), kills: this.run.kills,
      roomsCleared: this.run.roomsCleared, elitesKilled: this.run.elitesKilled, bosses: this.run.bosses, bossCount: this.run.bossCount,
      embers: Object.assign({}, this.run.embers), pact: this.pact, party: this.partySize(), level: this.level,
      revives: this.run.revives, flawlessBoss: this.run.flawlessBoss, maxGold: this.run.maxGold, maxRelics: this.run.maxRelics, players,
      evolved: [...this.players.values()].some(p => !!p.stats.evo), lightlessBoss: this.run.lightlessBoss, fullClear: this.run.fullClear,
      roomsVisited: this.run.roomsVisited, roomsTotal: this.run.roomsTotal, lightAtBoss: this.run.lightAtBoss.slice(),
    };
  };

  // ---------------- main tick ----------------
  W.prototype.update = function (dt) {
    if (this.state === 'over') return;
    if (this.state === 'ending') {
      this.endTimer -= dt;
      this.updateProjectiles(dt); this.updateZones(dt);
      if (this.endTimer <= 0) { this.state = 'over'; this.result = this.summary(); this.emit({ t: 'end', summary: this.result }); }
      return;
    }
    this.tick++; this.time += dt; this.roomTime += dt;
    if (this.pendingStratum) {
      this.pendingStratum.t -= dt;
      if (this.pendingStratum.t <= 0) { const s = this.pendingStratum.s; this.pendingStratum = null; this.enterStratum(s); }
      return;
    }
    this.updateLantern(dt);
    this.updateShields(dt);
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.flowT -= dt;
    if (this.flowT <= 0) { this.computeFlow(); this.flowT = 0.25; }
    this.updateEncounter(dt);
    for (let i = 0; i < this.enemies.length; i++) this.updateEnemy(this.enemies[i], dt);
    this.separate();
    this.updateAllies(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updateChains();
    this.updatePickups(dt);
    if (this.enemies.some(e => e.hp <= 0)) this.enemies = this.enemies.filter(e => e.hp > 0);
    this.checkDoors(dt);
    this.updateOffers(dt);
    this.checkDefeat();
    this.run.maxGold = Math.max(this.run.maxGold, this.gold);
  };

  W.prototype.updatePlayer = function (p, dt) {
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtT -= dt;
    if (!p.remote) p.dashing = p.dashT > 0;
    if (p.dead) return;
    if (p.downed) {
      let helpers = 0;
      for (const q of this.players.values()) if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 48 * 48) helpers++;
      if (helpers) {
        p.revive += dt * (0.4 + 0.2 * (helpers - 1));
        if (p.revive >= 1) {
          p.downed = false; p.revive = 0; p.hp = Math.round(p.maxHp * 0.35); p.invuln = 1.5;
          this.run.revives++;
          this.emit({ t: 'revived', pid: p.pid, x: p.x, y: p.y });
        }
      } else p.revive = Math.max(0, p.revive - dt * 0.15);
      p.bleed -= dt * (helpers ? 0.3 : 1);
      if (p.downed && p.bleed <= 0) { p.downed = false; p.dead = true; this.emit({ t: 'dead', pid: p.pid, x: p.x, y: p.y }); }
      return;
    }
    // hazards
    const tile = D.tileAt(this.room, p.x, p.y);
    if (tile === 4 && !p.dashing) {
      const hz = ED.biomeFor(this.stratum).hazard;
      p.hzT = (p.hzT || 0) - dt;
      if (p.hzT <= 0) {
        const s = this.stratum;
        const dmg = hz === 'spikes' ? 6 : hz === 'poison' ? 4 : hz === 'lava' ? 6 : hz === 'void' ? 6 : 0; // damage per tick; every floor hazard stays near 7-10 damage per second
        if (dmg) this.hurtPlayer(p, dmg * (1 + 0.2 * (s - 1)) * W.HAZARD_MUL, { hazard: true });
        p.hzT = hz === 'spikes' ? 0.9 : 0.6;
      }
    }
    this.updatePlayerBuild(p, dt);
  };

  W.prototype.checkDefeat = function () {
    if (this.state !== 'play' || this.players.size === 0) return;
    for (const p of this.players.values()) if (!p.downed && !p.dead) return;
    this.endRun(false);
  };

  // ---------------- flow field for ground pathing ----------------
  W.prototype.computeFlow = function () {
    const room = this.room; if (!room) return;
    const w = room.w, h = room.h, n = w * h;
    if (!this.flow || this.flow.length !== n) { this.flow = new Int16Array(n); this._q = new Int32Array(n); }
    const f = this.flow, q = this._q;
    f.fill(-1);
    let qh = 0, qt = 0;
    for (const p of this.players.values()) {
      if (p.downed || p.dead) continue;
      // a stealthed hero seeds the field from the last spot seen in this room (none: not at all)
      if (p.stealthT > 0) { if (p.seenEp !== this.roomEpoch) continue; } else { p.seenX = p.x; p.seenY = p.y; p.seenEp = this.roomEpoch; }
      const tx = Math.floor(p.seenX / T), ty = Math.floor(p.seenY / T);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const i = ty * w + tx;
      if (f[i] === -1) { f[i] = 0; q[qt++] = i; }
    }
    const tiles = room.tiles, locked = this.locked;
    while (qh < qt) {
      const i = q[qh++], x = i % w, d = f[i] + 1;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j < 0 || j >= n || f[j] !== -1) continue;
        const t = tiles[j];
        if (t === 0 || t === 4 || (t === 5 && !locked)) { f[j] = d; q[qt++] = j; }
      }
    }
  };

  // Desired unit direction from (x,y) toward the target, using line of sight or the flow field.
  W.prototype.pathDir = function (e, tx, ty) {
    const room = this.room;
    if (e.fly || Sim.los(room, e.x, e.y, tx, ty, this.locked)) {
      const d = Math.hypot(tx - e.x, ty - e.y) || 1;
      return [(tx - e.x) / d, (ty - e.y) / d];
    }
    const w = room.w, f = this.flow;
    const cx = Math.floor(e.x / T), cy = Math.floor(e.y / T);
    const here = f ? f[cy * w + cx] : -1;
    let best = here >= 0 ? here : 9999, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= room.h) continue;
      const v = f[ny * w + nx];
      if (v < 0) continue;
      if (dx && dy && (f[cy * w + nx] < 0 || f[ny * w + cx] < 0)) continue; // no corner cutting
      if (v < best) { best = v; bx = dx; by = dy; }
    }
    if (!bx && !by) {
      const d = Math.hypot(tx - e.x, ty - e.y) || 1;
      return [(tx - e.x) / d, (ty - e.y) / d];
    }
    const gx = (cx + bx + 0.5) * T, gy = (cy + by + 0.5) * T;
    const d = Math.hypot(gx - e.x, gy - e.y) || 1;
    return [(gx - e.x) / d, (gy - e.y) / d];
  };

  W.prototype.separate = function () {
    const es = this.enemies, n = es.length;
    for (let i = 0; i < n; i++) {
      const a = es[i]; if (a.hp <= 0 || a.def.gloom) continue;
      for (let j = i + 1; j < n; j++) {
        const b = es[j]; if (b.hp <= 0 || b.def.gloom) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-4) continue;
        const am = a.spd > 0 && !a.boss, bm = b.spd > 0 && !b.boss;
        if (!am && !bm) continue;
        const d = Math.sqrt(d2), push = rr - d;
        const wa = am && bm ? 0.5 : am ? 1 : 0, wb = 1 - wa;
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push * wa; a.y -= uy * push * wa;
        b.x += ux * push * wb; b.y += uy * push * wb;
      }
    }
    for (const e of es) if (e.hp > 0 && e.spd > 0) Sim.resolve(e, this.room, this.locked, e.fly);
  };

  W.prototype.isSafe = function () { return !this.locked && this.hostiles() === 0 && !this.pendingStratum; };

  // ---------------- doors ----------------
  W.prototype.checkDoors = function () {
    this.waitMsg = '';
    if (this.locked || this.state !== 'play' || this.pendingStratum) return;
    const room = this.room;
    for (const p of this.players.values()) {
      if (p.downed || p.dead) continue;
      for (const d in room.doors) {
        if (room.doors[d] < 0) continue;
        const r = D.doorRect(room, d);
        const inside = p.x > r.x0 * T - 2 && p.x < (r.x1 + 1) * T + 2 && p.y > r.y0 * T - 2 && p.y < (r.y1 + 1) * T + 2;
        const deep = d === 'n' ? p.y < 1.6 * T : d === 's' ? p.y > (room.h - 1) * T + 4 : d === 'w' ? p.x < T - 2 : p.x > (room.w - 1) * T + 2;
        if (!inside || !deep) continue;
        const choosing = [...this.players.values()].filter(q => q.offer);
        if (choosing.length) { this.waitMsg = 'Waiting for ' + choosing.map(q => q.name).join(', ') + ' to choose a boon'; return; }
        this.enterRoom(room.doors[d], d);
        return;
      }
    }
  };

  // ---------------- pickups ----------------
  W.prototype.spawnPickup = function (kind, x, y, val) {
    const a = this.rng.range(0, U.TAU), sp = this.rng.range(30, 110);
    this.pickups.push({ id: U.uid(), kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, val, t: 0 });
  };

  W.prototype.dropGold = function (x, y, total, exact) {
    total = Math.round(exact ? total : total * W.GOLD_MUL);
    while (total > 0) { const v = Math.min(total, total > 30 ? 10 : total > 8 ? 4 : 1); this.spawnPickup('gold', x, y, v); total -= v; }
  };
  W.prototype.dropXp = function (x, y, total) {
    total = Math.max(1, Math.round(total));
    while (total > 0) { const v = Math.min(total, total > 40 ? 12 : total > 10 ? 4 : 1); this.spawnPickup('xp', x, y, v); total -= v; }
  };

  W.prototype.updatePickups = function (dt) {
    const safe = this.isSafe();
    const keep = [];
    for (const pk of this.pickups) {
      pk.t += dt;
      pk.vx *= Math.max(0, 1 - 4 * dt); pk.vy *= Math.max(0, 1 - 4 * dt);
      let target = null, bd = Infinity;
      for (const p of this.players.values()) {
        if (p.downed || p.dead) continue;
        const heal = pk.kind === 'heart';
        if (heal && p.hp >= p.maxHp) continue;
        const d = U.dist2(pk.x, pk.y, p.x, p.y);
        const range = (heal ? 34 : p.stats.pickupR);
        if ((d < range * range || (safe && !heal && pk.t > 0.6)) && d < bd) { bd = d; target = p; }
      }
      if (target && pk.t > 0.25) {
        const d = Math.sqrt(bd) || 1, sp = 260 + pk.t * 120;
        pk.vx = (target.x - pk.x) / d * sp; pk.vy = (target.y - pk.y) / d * sp;
        if (d < target.r + 8) { this.collect(target, pk); continue; }
      }
      pk.x += pk.vx * dt; pk.y += pk.vy * dt;
      keep.push(pk);
    }
    this.pickups = keep;
  };

  W.prototype.collect = function (p, pk) {
    if (pk.kind === 'gold') { const v = Math.max(1, Math.round(pk.val * (1 + p.stats.gold))); this.gold += v; this.emit({ t: 'gold', v, pid: p.pid }); }
    else if (pk.kind === 'xp') { this.addXp(pk.val * (1 + p.stats.xp)); this.emit({ t: 'xp', pid: p.pid }); }
    else if (pk.kind === 'heart') { this.healPlayer(p, p.maxHp * (0.22 + 0.03 * p.stats.forager) + 6); }
  };

  // ---------------- lantern and dread ----------------
  // Best Deep Wick rank in the party sets the lantern capacity.
  W.prototype.lanternMax = function () {
    let rank = 0;
    for (const p of this.players.values()) rank = Math.max(rank, (p.meta.up && p.meta.up[ED.UPGRADE_IDX.deepwick]) || 0);
    return 100 * (1 + 0.06 * rank) * (W.LANTERN_MUL[this.stratum - 1] || 1);
  };

  // Burns the lantern slowly outside boss rooms (the boss room freezes the tier; no drain while a safe room waits on a boon pick) and, Lightless, stalks regular rooms with a Gloom.
  W.prototype.updateLantern = function (dt) {
    const room = this.room;
    if (!room) return;
    const hold = this.offerHold(); // an open boon pick in a safe room pauses both the drain and the Gloom's delay
    if (room.type !== 'boss' && !hold) {
      this.light = Math.max(0, this.light - dt * 100 / (W.DRAIN_SECS[this.stratum - 1] || 800));
      this.updateDread();
    }
    const gl = this.dread.gloom;
    if (gl > 0 && room.type !== 'boss' && room.type !== 'start' && this.gloomN < this.gloomWant() && ED.ENEMIES.gloom) {
      this.gloomT = (this.gloomT === null ? (this.gloomN ? W.GLOOM_GAP : gl) : this.gloomT) - (hold ? 0 : dt);
      if (this.gloomT <= 0) { this.gloomN++; this.gloomT = null; this.spawnGloom(); }
    } else if (!(gl > 0)) this.gloomT = null;
  };

  // Glooms hunting in this room: the tier's count; Lightless adds one per GLOOM_STEP dark rooms entered this stratum (this one included).
  W.prototype.gloomWant = function () {
    const n = this.dread.glooms || 1;
    return this.dread.tier >= 3 ? Math.min(W.GLOOM_MAX, n + Math.floor(this.deepRooms / W.GLOOM_STEP)) : n;
  };

  // Recomputes the dread tier from the light fraction; w.dread carries the multipliers read at spawn and at room rewards.
  W.prototype.updateDread = function () {
    const f = this.lightMax > 0 ? this.light / this.lightMax : 0;
    const tier = W.tierOf(f);
    if (tier === this.dread.tier) return;
    this.dread = Object.assign({}, W.DREAD[tier]);
    this.emit({ t: 'dread', tier });
  };

  // True while the room is safe and a hero has a boon offer open.
  W.prototype.offerHold = function () {
    if (!this.isSafe()) return false;
    for (const p of this.players.values()) if (p.offer) return true;
    return false;
  };

  // Any light gained banishes the Gloom (it hunts again once the lantern is Dark or Lightless, after its usual delay).
  W.prototype.addLight = function (amt, x, y) {
    this.light = Math.min(this.lightMax, this.light + amt);
    this.updateDread();
    this.emit({ t: 'oil', x, y, v: amt });
    if (amt > 0) this.banishGloom(null);
  };

  // Removes the Gloom and its spawn telegraph; `hold` = seconds until it may return (null: the tier's delay).
  W.prototype.banishGloom = function (hold) {
    for (const e of this.enemies) if (e.def.gloom && e.hp > 0) { e.hp = 0; this.emit({ t: 'banish', x: Math.round(e.x), y: Math.round(e.y) }); }
    this.zones = this.zones.filter(z => !z.gloom);
    this.gloomN = 0; this.gloomT = hold;
  };

  // Lantern flare (F): spends light to banish the Gloom for FLARE.banish seconds and blind the foes around the hero. Returns whether it fired.
  W.prototype.flare = function (p) {
    const F = W.FLARE, room = this.room;
    if (!p || p.downed || p.dead || this.state !== 'play' || this.pendingStratum || !room || room.type === 'boss' || this.light < F.cost || this.time < (this.flareAt || 0)) return false;
    this.flareAt = this.time + 1;
    this.light -= F.cost; this.updateDread();
    this.banishGloom(F.banish);
    for (const e of this.enemies) if (e.hp > 0 && !e.boss && !e.def.gloom && U.dist2(e.x, e.y, p.x, p.y) < F.r * F.r) e.blind = Math.max(e.blind || 0, F.blind);
    this.emit({ t: 'flare', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), r: F.r });
    return true;
  };

  // Dim and darker: each elite displaces ELITE_BODIES of plain-foe budget from its wave (fewer, nastier bodies; one plain foe always stays); Dark and Lightless elites roll from DARK_AFFIXES.
  W.prototype.darkWaves = function (waves) {
    const dr = this.dread;
    if (dr.tier === 0) return waves;
    for (const wv of waves) {
      let owe = 0;
      for (const it of wv) if (it.elite) { owe += W.ELITE_BODIES; if (dr.tier >= 2) it.affix = this.rng.pick(W.DARK_AFFIXES); }
      for (let i = wv.length - 1; i >= 0 && owe > 0 && wv.filter(x => !x.elite).length > 1; i--) {
        if (wv[i].elite) continue;
        owe -= ED.ENEMIES[wv[i].type].cost || 2; wv.splice(i, 1);
      }
    }
    return waves;
  };

  // Dark and Lightless: a cleared room's reward may be upgraded one step (chance dread.up); announced by an 'upgrade' event at the reward's spot.
  W.prototype.darkReward = function (item, x, y) {
    if (!(this.dread.up > 0) || !this.rng.chance(this.dread.up)) return item;
    const to = W.REWARD_UP[item];
    if (!to) return item;
    this.emit({ t: 'upgrade', to, x: Math.round(x), y: Math.round(y) });
    return to;
  };

  // Entering the boss room turns the light left into a reward (see W.bossLight): heals and shields the living heroes, drops gold, adds embers.
  W.prototype.bossLantern = function () {
    const f = this.lightMax > 0 ? this.light / this.lightMax : 0;
    if (f <= 0) return;
    const R = W.bossLight(f, this.stratum), heroes = this.alivePlayers();
    for (const p of heroes) {
      this.healPlayer(p, p.maxHp * R.heal);
      const to = Math.max(p.shield || 0, p.maxHp * R.shield);
      p.shieldBy.door = (p.shieldBy.door || 0) + (to - (p.shield || 0)); p.shield = to;
    }
    this.run.embers.rooms += R.embers;
    if (R.gold > 0 && heroes.length) this.dropGold(heroes[0].x, heroes[0].y, R.gold, true);
    this.emit({ t: 'wick', f: Math.round(f * 100), heal: Math.round(R.heal * 100), shield: Math.round(R.shield * 100), gold: R.gold, embers: R.embers });
  };

  // Telegraphed spawn at the floor point farthest from every living hero.
  W.prototype.spawnGloom = function () {
    const room = this.room, heroes = this.alivePlayers();
    let best = null, bd = -1;
    for (let ty = 2; ty < room.h - 1; ty++) for (let tx = 1; tx < room.w - 1; tx++) {
      if (room.tiles[ty * room.w + tx] !== 0) continue;
      const x = (tx + 0.5) * T, y = (ty + 0.5) * T;
      let d = Infinity;
      for (const p of heroes) d = Math.min(d, U.dist2(x, y, p.x, p.y));
      if (d > bd) { bd = d; best = { x, y }; }
    }
    if (best) this.addZone({ kind: 'spawn', x: best.x, y: best.y, r: ED.ENEMIES.gloom.r + 4, dur: 1.5, type: 'gloom', elite: false, gloom: true,
      after: (e) => { e.dmg = W.GLOOM_HIT * Math.max(1, ...heroes.map(p => p.maxHp)); } }); // a touch takes GLOOM_HIT of the toughest hero's max HP
  };

  // Marks the stratum fully explored once every non-boss room has been cleared (non-combat rooms clear on entry).
  W.prototype.checkFullClear = function () {
    if (this.fullClearDone === this.stratum) return;
    for (const r of this.floor.rooms) if (r.type !== 'boss' && !this.roomState[r.id].cleared) return;
    this.fullClearDone = this.stratum; this.run.fullClear = true;
  };

})(globalThis.ED || (globalThis.ED = {}));
