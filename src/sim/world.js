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
    this.gloomT = null; this.gloomOut = false; this.bossTier = 0; this.fullClearDone = 0;
    this.roomState = {};
    this.endTimer = -1; this.result = null; this.victory = false;
    this.flowT = 0; this.flow = null; this.tick = 0; this.waitMsg = '';
    this.tutorial = !!opts.tutorial;
    for (const pd of opts.players) this.addPlayer(pd);
  };
  W.xpFor = (L) => Math.round(30 + 3 * (L - 1) + 6 * (L - 1) * (L - 1)); // xp from level L to L+1
  // Dread tiers by light fraction (>= 0.5, >= 0.25, > 0, 0): foe hp/damage, elite chance, wave budget, room gold & embers.
  W.DREAD = [
    { tier: 0, hp: 1, dmg: 1, elite: 0, wave: 1, gold: 1 },
    { tier: 1, hp: 1.2, dmg: 1, elite: 0.12, wave: 1.08, gold: 1.5 },
    { tier: 2, hp: 1.45, dmg: 1.1, elite: 0.25, wave: 1.2, gold: 2 },
    { tier: 3, hp: 1.8, dmg: 1.25, elite: 0.4, wave: 1.3, gold: 2 },
  ];
  // Per-stratum threat on top of the base scales: foe HP, wave budget, `cdRate` = extra cooldown recovery (0.2 = attack timers tick 20% faster, -0.2 = 20% slower) and the boss pause between attacks (x).
  W.THREAT = [{ hp: 3, dmg: 0.5, wave: 1, cdRate: -0.4, pause: 2 }, { hp: 3, dmg: 0.6, wave: 1, cdRate: -0.3, pause: 1.7 }, { hp: 3, dmg: 1, wave: 1.05, cdRate: -0.1, pause: 1.4 }, { hp: 1.6, dmg: 1, wave: 1.1, cdRate: 0, pause: 1.2 }, { hp: 4, dmg: 1, wave: 1.2, cdRate: 0.15, pause: 1 }, { hp: 2.55, dmg: 1, wave: 1.3, cdRate: 0.3, pause: 0.9 }];
  W.DRAIN_SECS = [250, 220, 205, 200, 200, 200]; // seconds for a full unupgraded lantern to burn out, per stratum

  // Gold dropped by a 'gold' room reward (shared with the UI): 15 + 8 per stratum, times the dread gold bonus and the global gold multiplier.
  W.rewardGold = (stratum, dreadGold) => Math.round((15 + 8 * stratum) * (dreadGold || 1) * W.GOLD_MUL);
  W.GOLD_MUL = 0.65; // every gold drop (kills, rooms, chests, rewards) is scaled by this; shops sell at full price
  W.prototype.threat = function () { return W.THREAT[Math.max(0, Math.min(W.THREAT.length - 1, this.stratum - 1))]; };
  W.prototype.emit = function (ev) { this.fx.push(ev); };
  W.prototype.partySize = function () { return Math.max(1, this.players.size); };
  W.prototype.partyHpMul = function () { const n = this.partySize() - 1; return 1 + 1.1 * n + 0.35 * n * (n - 1); };
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

  // Heals up to max HP; healing beyond it feeds the blood shield (cap maxHp x bloodShield). Returns the HP actually restored.
  W.prototype.healPlayer = function (p, amt, silent) {
    if (!p || p.downed || p.dead) return 0;
    const raw = amt * p.stats.healMul, cap = p.maxHp * (p.stats.bloodShield || 0);
    if (p.hp >= p.maxHp && !(cap > 0 && raw > 0)) return 0;
    const v = Math.min(p.maxHp - p.hp, raw);
    p.hp += v;
    if (cap > 0 && raw > v) p.shield = Math.min(cap, (p.shield || 0) + raw - v);
    if (!silent && v >= 1) this.emit({ t: 'heal', pid: p.pid, v: Math.round(v), x: p.x, y: p.y });
    return v;
  };

  W.prototype.relicPool = function () {
    // Shared progression: relics unlocked by ANY party member can drop for everyone.
    const set = new Set();
    for (const p of this.players.values()) for (const id of (p.meta.relics || [])) set.add(id);
    if (!set.size) ED.RELIC_IDS.filter(id => ED.RELICS[id].start).forEach(id => set.add(id));
    const held = new Set();
    for (const p of this.players.values()) for (const id of p.relics) held.add(id);
    let pool = [...set].filter(id => !held.has(id));
    if (!pool.length) pool = [...set];
    return pool;
  };
  W.prototype.rollRelic = function (minRar, exclude) {
    const order = { c: 0, r: 1, e: 2, l: 3 };
    let pool = this.relicPool().filter(id => order[ED.RELICS[id].rar] >= order[minRar || 'c'] && !(exclude && exclude.has(id)));
    if (!pool.length) pool = this.relicPool();
    const s = this.stratum;
    const w = { c: 50, r: 34 + s * 3, e: 14 + s * 3, l: 3 + s };
    return this.rng.weighted(pool, id => w[ED.RELICS[id].rar]);
  };

  W.prototype.giveRelic = function (p, id) {
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
    this.lightMax = this.lanternMax(); this.light = this.lightMax; this.updateDread();
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
    this.enemies.length = 0; this.projs.length = 0; this.zones.length = 0;
    this.boss = null; this.enc = null;
    this.roomId = id;
    this.roomEpoch = (this.roomEpoch || 0) + 1;
    const room = this.room = this.floor.rooms[id];
    const rs = this.roomState[id];
    if (!rs.visited) this.run.roomsVisited++;
    rs.visited = true; rs.known = true;
    this.gloomT = null; this.gloomOut = false;
    if (room.type === 'boss' && !rs.cleared) { this.bossTier = this.dread.tier; this.run.lightAtBoss.push(Math.round(this.light / this.lightMax * 100) / 100); }
    for (const d in room.doors) if (room.doors[d] >= 0) this.roomState[room.doors[d]].known = true;
    let k = 0;
    const pos = [];
    for (const p of this.players.values()) {
      const pt = fromDir ? D.entryPoint(room, D.OPP[fromDir], k) : { x: D.center(room).x + (k - 1.5) * 22, y: D.center(room).y + 20 };
      p.x = pt.x; p.y = pt.y; p.vx = 0; p.vy = 0; p.dashT = 0; p.skillMove = null;
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
    this.emit({ t: 'room', id, from: fromDir || '', pos, locked: this.locked, ep: this.roomEpoch });
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
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.flowT -= dt;
    if (this.flowT <= 0) { this.computeFlow(); this.flowT = 0.25; }
    this.updateEncounter(dt);
    for (let i = 0; i < this.enemies.length; i++) this.updateEnemy(this.enemies[i], dt);
    this.separate();
    this.updateAllies(dt);
    this.updateCompanions(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
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
        if (dmg) this.hurtPlayer(p, dmg * (1 + 0.2 * (s - 1)), { hazard: true });
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
        const heal = pk.kind === 'heart' || pk.kind === 'orb';
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
      Sim.resolve({ x: pk.x, y: pk.y, r: 4 }, this.room, this.locked, true);
      keep.push(pk);
    }
    this.pickups = keep;
  };

  W.prototype.collect = function (p, pk) {
    if (pk.kind === 'gold') { const v = Math.max(1, Math.round(pk.val * (1 + p.stats.gold))); this.gold += v; this.emit({ t: 'gold', v, pid: p.pid }); }
    else if (pk.kind === 'xp') { this.addXp(pk.val * (1 + p.stats.xp)); this.emit({ t: 'xp', pid: p.pid }); }
    else if (pk.kind === 'heart') { this.healPlayer(p, p.maxHp * 0.22 + 6); }
    else if (pk.kind === 'orb') { this.healPlayer(p, p.maxHp * pk.val); }
  };

  // ---------------- lantern and dread ----------------
  // Best Deep Wick rank in the party sets the lantern capacity.
  W.prototype.lanternMax = function () {
    let rank = 0;
    for (const p of this.players.values()) rank = Math.max(rank, (p.meta.up && p.meta.up[ED.UPGRADE_IDX.deepwick]) || 0);
    return 100 * (1 + 0.06 * rank);
  };

  // Burns the lantern outside boss rooms (the boss room freezes the tier) and, Lightless, stalks regular rooms with a Gloom.
  W.prototype.updateLantern = function (dt) {
    const room = this.room;
    if (!room) return;
    if (room.type !== 'boss') {
      this.light = Math.max(0, this.light - dt * 100 / (W.DRAIN_SECS[this.stratum - 1] || 300));
      this.updateDread();
    }
    if (this.dread.tier === 3 && room.type !== 'boss' && room.type !== 'start' && !this.gloomOut && ED.ENEMIES.gloom) {
      this.gloomT = (this.gloomT === null ? 4 : this.gloomT) - dt;
      if (this.gloomT <= 0) { this.gloomOut = true; this.spawnGloom(); }
    } else if (this.dread.tier < 3) this.gloomT = null;
  };

  // Recomputes the dread tier from the light fraction; w.dread carries the multipliers read at spawn and at room rewards.
  W.prototype.updateDread = function () {
    const f = this.lightMax > 0 ? this.light / this.lightMax : 0;
    const tier = f >= 0.5 ? 0 : f >= 0.25 ? 1 : f > 0 ? 2 : 3;
    if (tier === this.dread.tier) return;
    this.dread = Object.assign({}, W.DREAD[tier]);
    this.emit({ t: 'dread', tier });
  };

  W.prototype.addLight = function (amt, x, y) {
    this.light = Math.min(this.lightMax, this.light + amt);
    this.updateDread();
    this.emit({ t: 'oil', x, y, v: amt });
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
    if (best) this.addZone({ kind: 'spawn', x: best.x, y: best.y, r: ED.ENEMIES.gloom.r + 4, dur: 1.5, type: 'gloom', elite: false, gloom: true });
  };

  // Marks the stratum fully explored once every non-boss room has been cleared (non-combat rooms clear on entry).
  W.prototype.checkFullClear = function () {
    if (this.fullClearDone === this.stratum) return;
    for (const r of this.floor.rooms) if (r.type !== 'boss' && !this.roomState[r.id].cleared) return;
    this.fullClearDone = this.stratum; this.run.fullClear = true;
  };

})(globalThis.ED || (globalThis.ED = {}));
