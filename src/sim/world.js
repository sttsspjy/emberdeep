// Authoritative simulation. Runs on the host (or locally in solo play); clients mirror it from snapshots.
// Split across files by prototype extension: combat.js (damage, attacks, skills), ai.js (enemy brains),
// bosses.js (boss scripts), rooms.js (encounters, props, interactions).
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

  // Landing point of a ground skill cast from (x0, y0) at (tx, ty): the target clamped to `range`, cut short at the first tile that blocks shots (chasms do not). With `walk` the point is one a body can stand on (minion spawns).
  // Used by the client preview and send, and by the host check; a free ray lands exactly on the target.
  Sim.groundPoint = (room, locked, x0, y0, tx, ty, range, walk) => {
    const dx = tx - x0, dy = ty - y0, dist = Math.hypot(dx, dy);
    if (!(dist > 0) || !(range > 0)) return { x: x0, y: y0 };
    const d = Math.min(dist, range), a = Math.atan2(dy, dx), cs = Math.cos(a), sn = Math.sin(a);
    let lx = x0, ly = y0, free = true;
    for (let s = 8; s < d + 8; s += 8) { // samples every 8 px, the last one exactly at d
      const q = Math.min(s, d), px = x0 + cs * q, py = y0 + sn * q;
      if (D.blocksShots(D.tileAt(room, px, py), locked)) { free = false; break; }
      lx = px; ly = py;
    }
    let g = { x: lx, y: ly };
    if (!free) { g = { x: lx, y: ly, r: 4 }; Sim.resolve(g, room, locked, true); }
    if (!walk) return { x: g.x, y: g.y };
    const dd = Math.hypot(g.x - x0, g.y - y0), e = Sim.castMove(room, x0, y0, a, dd, 9, locked);
    if (Math.hypot(e.x - x0, e.y - y0) >= dd - 8) { const q = { x: g.x, y: g.y, r: 9 }; if (!Sim.resolve(q, room, locked, false)) return { x: q.x, y: q.y }; }
    return e;
  };

  // Dash charges on a controller { dashN charges, dashT seconds to the next }: one charge refills every st.dashCd while below st.dashCharges. Returns the charges refilled.
  Sim.dashTick = (c, st, dt) => {
    const mx = st.dashCharges | 0;
    if (c.dashN > mx) c.dashN = mx;
    if (c.dashN >= mx) { c.dashT = 0; return 0; }
    if (!(c.dashT > 0)) c.dashT = st.dashCd;
    let n = 0;
    c.dashT -= dt;
    while (c.dashT <= 0 && c.dashN < mx) { c.dashN++; n++; c.dashT = c.dashN < mx ? c.dashT + st.dashCd : 0; } // an overshoot carries into the next charge
    return n;
  };
  // Spends one charge (false when none is left); spending from a full set starts the recharge timer.
  Sim.dashTry = (c, st) => {
    if (!(c.dashN >= 1)) return false;
    if (c.dashN >= (st.dashCharges | 0)) c.dashT = st.dashCd;
    c.dashN--;
    return true;
  };

  // Walking-speed factor of a crowd: CROWD.per for every non-boss foe overlapping the hero (distance < foe.r + p.r), never below CROWD.floor. foes: any list of { x, y, r, hp, boss, spawnT }.
  Sim.crowdMul = (p, foes) => {
    if (!foes) return 1;
    let n = 0;
    for (let i = 0; i < foes.length; i++) {
      const e = foes[i];
      if (!(e.hp > 0) || e.boss || e.spawnT > 0) continue;
      const rr = e.r + p.r, dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy < rr * rr) n++;
    }
    const C = ED.CONST.CROWD;
    return Math.max(C.floor, 1 - C.per * n);
  };

  // Hero movement: walking, dash, skill-move, hazards and pull zones. foes (optional): the foes near the hero; a crowd slows the walk (dashes and skill moves ignore it).
  Sim.movePlayer = (p, inp, dt, room, locked, zones, foes) => {
    if (p.downed || p.dead) { p.moving = false; p.skillMove = null; p.skillIfr = false; return; }
    const speed = p.stats.moveSpeed * (ED.Stats.moveRate ? ED.Stats.moveRate(p) : 1);
    if (p.skillMove) { // a skill's own movement { dx, dy, speed, t (seconds left), iframes (untouchable for this long), age }
      const m = p.skillMove;
      Sim.moveCircle(p, m.dx * m.speed * dt, m.dy * m.speed * dt, room, locked, false);
      m.age = (m.age || 0) + dt; m.t -= dt; p.moving = true;
      p.skillIfr = m.age < (m.iframes === undefined ? m.t + m.age : m.iframes);
      if (m.t <= 0) { p.skillMove = null; p.skillIfr = false; }
      return;
    }
    p.skillIfr = false;
    if (p.dashT > 0) {
      p.dashT -= dt; if (p.dashT < 1e-6) p.dashT = 0; // float residue would add a tick past DASH.t at the fixed step
      const ds = ED.CONST.DASH.speed;
      Sim.moveCircle(p, p.dashDx * ds * dt, p.dashDy * ds * dt, room, locked, false);
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
    if (foes) sp *= Sim.crowdMul(p, foes);
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
    this.fx = []; this.msgs = []; this.corpses = []; // corpses: recent non-boss deaths { x, y, t } for Corpse Explosion, cleared with each room
    this.gold = 0; this.xp = 0; this.level = 1; this.xpNext = W.xpFor(1);
    this.time = 0; this.roomTime = 0; this.state = 'play'; this.stratum = 0; this.floorSeed = 0;
    this.locked = false; this.enc = null; this.boss = null; this.pendingStratum = null;
    this.run = { kills: 0, fodderKills: 0, roomsCleared: 0, elitesKilled: 0, bosses: 0, bossCount: 0, revives: 0, maxGold: 0, maxRelics: 0, flawlessBoss: false,
      fullClear: false, roomsVisited: 0, roomsTotal: 0, darkCleared: 0,
      embers: { rooms: 0, elites: 0, bosses: 0, victory: 0 } };
    this.fullClearDone = 0;
    this.roomState = {};
    this.endTimer = -1; this.result = null; this.victory = false;
    this.flowT = 0; this.flow = null; this.tick = 0; this.waitMsg = '';
    this.tutorial = !!opts.tutorial;
    this.chainQ = []; this.chainSeq = 0; this.curChain = null; this.chainPeak = 0; this.chainHops = 0; // forced payoffs of duos and keystones (see combat.js); peak queue length and deepest hop are bot statistics
    for (const pd of opts.players) this.addPlayer(pd);
  };
  W.xpFor = (L) => Math.round(30 + 3 * (L - 1) + 6 * (L - 1) * (L - 1)); // xp from level L to L+1
  W.ELITE = { hp: 2.4, hpStep: 0.4, dmg: 0.9 }; // elite HP multiplier at stratum I (+ hpStep per stratum) and damage multiplier
  W.HAZARD_MUL = 0.5; // floor hazard damage multiplier
  // Dark rooms (room.dark, set by floor gen: 2 opt-in combat dead ends per floor): foe damage multiplier, gold and xp multiplier of everything dropped there, multiplier of the fodder quota.
  W.DARK_DMG = 1.3; W.DARK_LOOT = 1.5; W.DARK_FODDER = 1.5;
  W.DARK_AFFIXES = ['brutal', 'vampiric', 'warded', 'swift']; // affix pool of the extra elite of a dark room's last wave (the volatile affix is left out)
  W.REWARD_UP = { gold: 'vigor', vigor: 'forge', forge: 'epic', boon: 'epic' }; // a dark room's reward goes up one step
  // Stratum behaviour (index s - 1): the share of its target's velocity a foe leads an aimed shot by; foe and boss shot speed factors; non-boss, non-fodder ground speed factor.
  W.LEAD = [0, 0, 0.35, 0.5, 0.7, 0.85];
  W.shotSpd = (s) => 1 + 0.08 * (s - 1);
  W.bossShotSpd = (s) => 1 + 0.1 * (s - 1);
  W.foeSpd = (s) => 1 + 0.04 * (s - 1);
  // Mixed rosters (s >= 2): chance a room's roster also holds the previous biome's foes (at weight 0.35 each); AFFIX2 = chance (index s - 1) that an elite rolls a second affix.
  W.MIX_PREV = 0.6; W.AFFIX2 = [0, 0, 0, 0.35, 0.6, 0.85];
  // Angle from (x, y) toward where target t stands when a shot of this speed reaches it, leading by share L of t's measured velocity (t.lvx / t.lvy; 0 for targets without one); flight time from two refinements, capped at 1.2 s. L 0 aims straight at t.
  W.leadAngle = (x, y, t, speed, L) => {
    let ax = t.x, ay = t.y;
    const vx = (t.lvx || 0) * L, vy = (t.lvy || 0) * L;
    if ((vx || vy) && speed > 0) for (let k = 0; k < 2; k++) { const ti = Math.min(1.2, Math.hypot(ax - x, ay - y) / speed); ax = t.x + vx * ti; ay = t.y + vy * ti; }
    return Math.atan2(ay - y, ax - x);
  };
  // Per-stratum threat on top of the base scales: foe HP, wave budget, `cdRate` = extra cooldown recovery (0.2 = attack timers tick 20% faster, -0.2 = 20% slower) and the boss pause between attacks (x).
  W.THREAT = [{ hp: 2.2, dmg: 0.5, wave: 0.8, cdRate: -0.4, pause: 2 }, { hp: 1.62, dmg: 0.5, wave: 0.75, cdRate: -0.3, pause: 1.7 }, { hp: 1.3, dmg: 0.5, wave: 0.7, cdRate: -0.1, pause: 1.4 }, { hp: 1, dmg: 0.84, wave: 0.66, cdRate: 0, pause: 0.75 }, { hp: 1.07, dmg: 1.19, wave: 0.62, cdRate: 0.15, pause: 0.6 }, { hp: 1.02, dmg: 1.39, wave: 0.6, cdRate: 0.3, pause: 0.6 }];
  // Foe HP multiplier of stratum s: the depth curve times the threat HP.
  W.hpScale = (s) => (1 + 0.65 * (s - 1) + 0.08 * (s - 1) * (s - 1)) * W.THREAT[Math.max(0, Math.min(W.THREAT.length - 1, s - 1))].hp;
  // Wave pacing of combat rooms: seconds before the first wave, spawn telegraph (+ random extra), minimum gap before the next wave, the share of a wave that may still stand when the next one is called, the seconds after which the next wave comes regardless, and the minimum spawn distance from heroes (turrets keep more).
  W.PACE = { first: 0.5, spawn: 0.7, spawnVar: 0.25, gap: 0.9, nextAt: 0.45, maxAge: 6, avoid: 100, avoidTurret: 130 };
  // Horde of a combat or elite room (fodder beside the threat waves): kills to spawn by stratum (x0.6 in an elite room, x(1 + 0.5 (n - 1)) per party, x0.6 at stratum I of the tutorial, x DARK_FODDER in a dark room),
  // fodder per pack, seconds between packs, minimum pack distance from every hero (relaxed in 40 px steps once a pack has waited PACK_WAIT s), live-foe cap (solo, 2+ heroes).
  W.FODDER_Q = [40, 55, 70, 85, 100, 120]; W.PACK_N = [6, 12]; W.PACK_GAP = [2.0, 3.0]; W.PACK_AVOID = 220; W.PACK_WAIT = 4; W.LIVE_CAP = [120, 180];
  // Boss fights. Aimed volley (every boss, bosses.js): shots by phase I-III, telegraph s (x the boss's windMul), s before the first release at which the warn line locks, s between shots, s between the heroes' sequences,
  // flight speed at stratum I (+ step per stratum) and damage x boss damage; in phase 3 a volley also starts every BOSS_OV_GAP s. Fodder trickle after the boss spawns: pack size, s between packs, live-fodder cap (solo, 2+ heroes).
  W.BOSS_VOL = { n: [3, 4, 5], tele: 0.5, lock: 0.15, gap: 0.12, seq: 0.15, speed: 320, step: 20, dmg: 0.6 }; W.BOSS_OV_GAP = 5;
  W.BOSS_PACK_N = [4, 6]; W.BOSS_PACK_GAP = 7; W.BOSS_FODDER_CAP = [20, 30];
  // Boss fury (soft enrage): t = fight seconds at which it starts, by stratum (0 = never), ramp = boss damage multiplier gained per second past t (the pause between attacks divides by the same factor), max = its cap, warn = seconds before t that the boss bar starts warning.
  W.BOSS_FURY = { t: [0, 0, 0, 95, 95, 90], ramp: 0.12, max: 4, warn: 10 };
  W.furyAt = (s) => W.BOSS_FURY.t[Math.max(0, Math.min(W.BOSS_FURY.t.length - 1, s - 1))];
  // Fury multiplier at stratum s after ft fight seconds: 1 while t is 0 or ft <= t, then 1 + ramp x (ft - t) up to max (pure; the client mirror derives it from the synced clock).
  W.furyMul = (s, ft) => { const t = W.furyAt(s); return t > 0 && ft > t ? Math.min(W.BOSS_FURY.max, 1 + W.BOSS_FURY.ramp * (ft - t)) : 1; };
  // Fodder max HP: depth (+25% per stratum) and pact only, no threat lever, party multiplier or elite (pure; the client mirror rebuilds it from the wire fraction).
  W.fodderHp = (def, s, pact) => def.hp * (1 + 0.25 * (s - 1)) * (pact >= 1 ? 1.25 : 1) * (pact >= 10 ? 1.2 : 1);
  // Xp a threat foe is worth before the dark-room multiplier and the room's budget scale (enc.xpK).
  W.threatXp = (def, s, elite) => (def.xp || 0) * (1 + 0.35 * (s - 1)) * (elite ? 3 : 1);
  // Room xp budget by stratum (solo, per room; x DARK_LOOT in a dark room, not scaled by the party): threat drops, fodder motes (FODDER_XP_SHARE of it, spread over the quota) and the clear pile together drop exactly this.
  W.ROOM_XP = { combat: [24, 38, 60, 84, 107, 122], elite: [44, 64, 86, 116, 159, 180] }; W.FODDER_XP_SHARE = 0.5;
  // Gold dropped by a 'gold' room reward (shared with the UI): 15 + 8 per stratum, times the global gold multiplier.
  W.rewardGold = (stratum) => Math.round((15 + 8 * stratum) * W.GOLD_MUL);
  W.GOLD_MUL = 0.65; // every gold drop (kills, rooms, chests, rewards) is scaled by this; shops sell at full price
  W.prototype.threat = function () { return W.THREAT[Math.max(0, Math.min(W.THREAT.length - 1, this.stratum - 1))]; };
  W.prototype.emit = function (ev) { this.fx.push(ev); };
  W.prototype.partySize = function () { return Math.max(1, this.players.size); };
  W.partyHpMul = (size) => { const n = size - 1; return 1 + 0.85 * n + 0.3 * n * (n - 1); }; // foe HP factor of a party of `size` (pure; the sheet reads it too)
  W.dmgScale = (s) => 1 + 0.22 * (s - 1) + 0.03 * (s - 1) * (s - 1); // foe damage factor of stratum s
  W.prototype.partyHpMul = function () { return W.partyHpMul(this.partySize()); };
  W.prototype.alive = function (p) { return p && !p.downed && !p.dead; };
  W.prototype.alivePlayers = function () { const out = []; for (const p of this.players.values()) if (!p.downed && !p.dead) out.push(p); return out; };
  W.prototype.hostiles = function (threatOnly) { let n = 0; for (const e of this.enemies) if (e.hp > 0 && !(threatOnly && e.fodder)) n++; return n; };

  W.prototype.nearestPlayer = function (x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (p.downed || p.dead || p.stealthT > 0) continue;
      const d = U.dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  // Nearest living foe within maxD of (x, y), skipping the ids in exclude; with cone > 0 only foes within cone radians of the direction a0.
  W.prototype.nearestEnemy = function (x, y, maxD, exclude, a0, cone) {
    let best = null, bd = maxD * maxD;
    const q = this.foeScan(x, y, maxD);
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (e.spawnT > 0 || e.def.invuln || e.burrowed || (exclude && exclude.has(e.id))) continue;
      if (cone > 0 && Math.abs(U.angDiff(a0, Math.atan2(e.y - y, e.x - x))) > cone) continue;
      const d = U.dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    this.foeEnd();
    return best;
  };

  // ---------------- foe grid ----------------
  // Uniform grid of this.enemies indices behind foesNear / foeScan / nearestEnemy. update() builds it at tick start and after separate() and drops it at the end of the tick; outside update() every query rebuilds from the live positions.
  // Late list (every query returns it): foes spawned since the build and foes further than GRID_DRIFT from their build position. Foes with r > GRID_BIG are always returned. Query results are ascending in this.enemies index, live (hp > 0) foes only.
  const GRID_CELL = 64, GRID_INV = 1 / GRID_CELL, GRID_DRIFT = 16, GRID_BIG = 22;
  const GRID_MIN = 32; // below this many foes every scan takes all of them and separate() pairs every j > i: the grids cost more than they save
  // Query margin >= 2 x GRID_BIG + 16: a foe's radius (22) + 42 of move allowed between a build and a query (GRID_DRIFT 16 before foeDrift flags it, +26 inside its own updateEnemy call or a hero/zone effect that carries or pulls it).
  const GRID_PAD = 64;

  // Grows the per-index arrays to hold n foes (keeps their contents).
  const fgFit = (g, n) => {
    if (g.cap >= n) return;
    const cap = Math.max(256, 1 << (32 - Math.clz32(n + 63)));
    const grow = (A, old) => { const a = new A(cap); a.set(old); return a; };
    g.mark = grow(Uint8Array, g.mark); g.cell = grow(Int32Array, g.cell); g.items = grow(Int32Array, g.items); g.qi = new Int32Array(cap);
    g.gx = grow(Float32Array, g.gx); g.gy = grow(Float32Array, g.gy); g.bits = new Uint32Array((cap >> 5) + 1); g.cap = cap;
  };

  // Rebuilds the grid from the live positions: counting sort of the live foes into cells (indices ascending in each cell), foes with r > GRID_BIG into the big list, the late list cleared.
  W.prototype.foeGrid = function () {
    const es = this.enemies, n = es.length, room = this.room;
    let g = this.fg;
    if (!g) g = this.fg = { cap: 0, cw: 1, ch: 1, start: new Int32Array(2), cur: new Int32Array(1), mark: new Uint8Array(0), cell: new Int32Array(0), items: new Int32Array(0), qi: new Int32Array(0), gx: new Float32Array(0), gy: new Float32Array(0), bits: new Uint32Array(1), big: [], late: [], pool: [], qd: 0, ok: false, live: false, direct: true, n: 0, es: null };
    const big = g.big, late = g.late, mark = g.mark;
    for (let k = 0; k < late.length; k++) mark[late[k]] = 0;
    late.length = 0; big.length = 0;
    g.n = n; g.es = es; g.ok = true; g.direct = n < GRID_MIN;
    if (g.direct) return g;
    fgFit(g, n);
    const cw = room ? Math.ceil(room.w * T / GRID_CELL) : 1, ch = room ? Math.ceil(room.h * T / GRID_CELL) : 1, nc = cw * ch;
    if (g.start.length < nc + 1) { g.start = new Int32Array(nc + 1); g.cur = new Int32Array(nc); }
    g.cw = cw; g.ch = ch;
    const start = g.start, cur = g.cur, cell = g.cell, items = g.items, gx = g.gx, gy = g.gy;
    start.fill(0, 0, nc + 1);
    for (let i = 0; i < n; i++) {
      const e = es[i];
      gx[i] = e.x; gy[i] = e.y;
      if (e.hp <= 0) { cell[i] = -1; continue; }
      if (e.r > GRID_BIG) { cell[i] = -1; big.push(i); continue; }
      let cx = (e.x * GRID_INV) | 0, cy = (e.y * GRID_INV) | 0;
      if (cx < 0) cx = 0; else if (cx >= cw) cx = cw - 1;
      if (cy < 0) cy = 0; else if (cy >= ch) cy = ch - 1;
      const c = cy * cw + cx;
      cell[i] = c; start[c + 1]++;
    }
    for (let c = 0; c < nc; c++) { start[c + 1] += start[c]; cur[c] = start[c]; }
    for (let i = 0; i < n; i++) { const c = cell[i]; if (c >= 0) items[cur[c]++] = i; }
    return g;
  };

  // The grid when it is current (inside update(), built for this foe array with GRID_MIN or more foes), else a fresh build.
  W.prototype.fgReady = function () {
    const g = this.fg;
    return g && g.live && g.ok && !g.direct && g.es === this.enemies && this.enemies.length >= g.n ? g : this.foeGrid();
  };

  // A foe appended to this.enemies after the build joins the late list.
  W.prototype.foeLate = function (i) {
    const g = this.fg;
    if (!g || !g.ok || g.direct) return;
    fgFit(g, i + 1);
    if (g.mark[i]) return;
    g.mark[i] = 1; g.late.push(i);
  };

  // Foe i moved: once it is further than GRID_DRIFT from its build position it joins the late list.
  W.prototype.foeDrift = function (i) {
    const g = this.fg;
    if (!g.ok || g.direct || i >= g.n || g.mark[i]) return;
    const e = this.enemies[i], dx = e.x - g.gx[i], dy = e.y - g.gy[i];
    if (dx * dx + dy * dy > GRID_DRIFT * GRID_DRIFT) { g.mark[i] = 1; g.late.push(i); }
  };

  // Fills g.qi with the ascending indices of the live foes whose cells overlap the circle (x, y, r + GRID_PAD), plus the big and late lists; returns the count. A wide query takes every live foe.
  W.prototype.fgQuery = function (g, x, y, r) {
    const es = this.enemies, n = es.length;
    fgFit(g, n);
    const qi = g.qi, R = r + GRID_PAD, cw = g.cw, ch = g.ch;
    let x0 = Math.floor((x - R) * GRID_INV), x1 = Math.floor((x + R) * GRID_INV), y0 = Math.floor((y - R) * GRID_INV), y1 = Math.floor((y + R) * GRID_INV), cnt = 0;
    x0 = x0 < 0 ? 0 : x0 >= cw ? cw - 1 : x0; x1 = x1 < 0 ? 0 : x1 >= cw ? cw - 1 : x1;
    y0 = y0 < 0 ? 0 : y0 >= ch ? ch - 1 : y0; y1 = y1 < 0 ? 0 : y1 >= ch ? ch - 1 : y1;
    if (!(R < 4096) || (x1 - x0 + 1) * (y1 - y0 + 1) * 2 > n) {
      for (let i = 0; i < n; i++) if (es[i].hp > 0) qi[cnt++] = i;
      return cnt;
    }
    const bits = g.bits, start = g.start, items = g.items, big = g.big, late = g.late;
    let wlo = 0x7fffffff, whi = -1;
    for (let cy = y0; cy <= y1; cy++) {
      for (let k = start[cy * cw + x0], ke = start[cy * cw + x1 + 1]; k < ke; k++) {
        const i = items[k], wi = i >> 5;
        bits[wi] |= 1 << (i & 31);
        if (wi < wlo) wlo = wi;
        if (wi > whi) whi = wi;
      }
    }
    for (let k = 0; k < big.length; k++) { const i = big[k], wi = i >> 5; bits[wi] |= 1 << (i & 31); if (wi < wlo) wlo = wi; if (wi > whi) whi = wi; }
    for (let k = 0; k < late.length; k++) { const i = late[k]; if (i >= n) continue; const wi = i >> 5; bits[wi] |= 1 << (i & 31); if (wi < wlo) wlo = wi; if (wi > whi) whi = wi; }
    for (let wi = wlo; wi <= whi; wi++) {
      let v = bits[wi];
      if (v === 0) continue;
      bits[wi] = 0;
      const base = wi << 5;
      do {
        const lsb = v & -v;
        const i = base + 31 - Math.clz32(lsb);
        v ^= lsb;
        if (es[i].hp > 0) qi[cnt++] = i;
      } while (v !== 0);
    }
    return cnt;
  };

  // Fills the caller-owned array out with the live foes near the circle (x, y, r): every foe whose centre is within r + its radius is among them, in this.enemies order. Callers keep their own exact test on the live positions.
  // out.n is the foe count at the query: a loop whose body can spawn foes (splits) visits the later ones with foeTail, as a for-of over this.enemies did.
  W.prototype.foesNear = function (x, y, r, out) {
    const es = this.enemies, n = es.length;
    let c = 0;
    if (n < GRID_MIN) { for (let i = 0; i < n; i++) if (es[i].hp > 0) out[c++] = es[i]; }
    else { const g = this.fgReady(), cnt = this.fgQuery(g, x, y, r), qi = g.qi; for (; c < cnt; c++) out[c] = es[qi[c]]; }
    out.length = c; out.n = n;
    return out;
  };

  // foesNear into a pooled array (scans nest through hits and kills); every foeScan is paired with one foeEnd after its loop.
  W.prototype.foeScan = function (x, y, r) {
    const g = this.fg || this.foeGrid(), d = g.qd++;
    return this.foesNear(x, y, r, g.pool[d] || (g.pool[d] = []));
  };
  W.prototype.foeEnd = function () { this.fg.qd--; };

  // Appends the foes spawned since out was filled; true when it added any (loop: `k < out.length || this.foeTail(out)`).
  W.prototype.foeTail = function (out) {
    const es = this.enemies, m = es.length;
    let k = out.n, added = false;
    if (k >= m) return false;
    out.n = m;
    for (; k < m; k++) if (es[k].hp > 0) { out.push(es[k]); added = true; }
    return added;
  };

  // ---------------- players ----------------
  W.prototype.addPlayer = function (pd) {
    const p = {
      pid: pd.pid, name: pd.name || 'Hero', slot: pd.slot | 0, cls: pd.cls, weapon: pd.weapon,
      meta: pd.meta || { up: [], mastery: 1, relics: [] },
      boons: {}, relics: [], stats: null,
      x: 0, y: 0, r: 10, face: 0, vx: 0, vy: 0, mvx: 1, mvy: 0, moving: false, lvx: 0, lvy: 0, lpx: null, lpy: null,
      hp: 1, maxHp: 1, dashT: 0, dashDx: 0, dashDy: 0, dashing: false, skillMove: null,
      invuln: 0, hurtT: 0, downed: false, bleed: 0, revive: 0, dead: false,
      phoenixUsed: false, secondWind: 0, swPct: 0.4, angelUsed: false, aegisT: 0, guardCd: 0, guardT: 0,
      frozenCd: 0, tranceT: 0, atkCount: 0, chaliceKills: 0, chaliceHp: 0, bonusHp: 0,
      picks: 0, offer: null, offerT: 0, rerolls: 0, claimed: {}, shield: 0,
      kills: 0, dealt: 0, hitThisBoss: false, maxRelics: 0, revivesGiven: 0,
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
    this.clearShields(p);
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
    const v = Math.min(p.maxHp - p.hp, amt * p.stats.healMul);
    p.hp += v;
    if (!silent && v >= 1) this.emit({ t: 'heal', pid: p.pid, v: Math.round(v), x: p.x, y: p.y });
    return v;
  };

  // Every shield a hero receives except Battle Ward ('ward') passes one sliding window of SHIELD_WIN_T seconds (10 one-second slots in p.shWin): class sources (any k but 'holy' and 'bone') give at most
  // SHIELD_WIN_CLASS of max HP per window, all sources together SHIELD_WIN_ALL; what the window refuses is logged in p.shieldClip[k].
  Object.assign(ED.CONST, { SHIELD_WIN_T: 10, SHIELD_WIN_CLASS: 0.03, SHIELD_WIN_ALL: 0.06 });
  // Adds amt to p's absorb shield up to cap (a shield above the cap is never lowered); k labels the source in p.shieldBy. Returns the shield gained.
  W.prototype.addShield = function (p, amt, cap, k) {
    if (!p || p.downed || p.dead || !(amt > 0) || !(p.shield < cap)) return 0;
    let gain = Math.min(cap, p.shield + amt) - p.shield;
    if (k !== 'ward') {
      const C = ED.CONST, win = p.shWin, now = Math.floor(this.time);
      let c = 0, a = 0;
      for (let i = 0; i < win.length; i++) { const s = win[i]; if (now - s.sec < C.SHIELD_WIN_T) { c += s.c; a += s.a; } }
      const room = Math.max(0, k === 'holy' || k === 'bone' ? C.SHIELD_WIN_ALL * p.maxHp - a : Math.min(C.SHIELD_WIN_CLASS * p.maxHp - c, C.SHIELD_WIN_ALL * p.maxHp - a));
      if (gain > room) { p.shieldClip[k] = (p.shieldClip[k] || 0) + gain - room; gain = room; }
      if (!(gain > 0)) return 0;
      const sl = win[now % C.SHIELD_WIN_T];
      if (sl.sec !== now) { sl.sec = now; sl.c = 0; sl.a = 0; }
      if (k !== 'holy' && k !== 'bone') sl.c += gain;
      sl.a += gain;
    }
    p.shield += gain;
    p.shieldBy[k] = (p.shieldBy[k] || 0) + gain;
    this.emit({ t: 'shielded', pid: p.pid, v: Math.round(gain * 10) / 10, k });
    return gain;
  };

  // Shields fade by SHIELD_DECAY of max HP per second while no room is locked and outside boss rooms, so income serves only the room it was earned in.
  W.prototype.updateShields = function (dt) {
    if (this.locked || (this.room && this.room.type === 'boss')) return;
    for (const p of this.players.values()) if (p.shield > 0) p.shield = Math.max(0, p.shield - ED.CONST.SHIELD_DECAY * p.maxHp * dt);
  };

  // Every relic can drop; relics no hero holds come first, else the whole list.
  W.prototype.relicPool = function () {
    const held = new Set();
    for (const p of this.players.values()) for (const id of p.relics) held.add(id);
    const pool = ED.RELIC_IDS.filter(id => !held.has(id));
    return pool.length ? pool : ED.RELIC_IDS;
  };
  // A relic roll at least minRar and not in `exclude`, weighted by rarity and stratum.
  W.prototype.rollRelic = function (minRar, exclude) {
    const order = { c: 0, r: 1, e: 2, l: 3 };
    const base = this.relicPool();
    let pool = base.filter(id => order[ED.RELICS[id].rar] >= order[minRar || 'c'] && !(exclude && exclude.has(id)));
    if (!pool.length) pool = base;
    const s = this.stratum;
    const w = { c: 50, r: 34 + s * 3, e: 14 + s * 3, l: 3 + s };
    return this.rng.weighted(pool, id => w[ED.RELICS[id].rar]);
  };

  // Gives p a relic and rebuilds its stats.
  W.prototype.giveRelic = function (p, id) {
    p.relics.push(id);
    this.recalc(p, false);
    this.run.maxRelics = Math.max(this.run.maxRelics, p.relics.length);
    p.maxRelics = Math.max(p.maxRelics, p.relics.length); // the most this hero held
    this.emit({ t: 'relic', pid: p.pid, id, x: p.x, y: p.y });
    this.sendBuild(p);
  };

  // ---------------- run flow ----------------
  W.prototype.startRun = function () {
    for (const p of this.players.values()) {
      this.onRunStartBuild(p);
      this.sendBuild(p);
    }
    this.onPartyStartBuild();
    this.enterStratum(1);
  };

  W.prototype.enterStratum = function (s) {
    this.stratum = s;
    this.floorSeed = this.rng.seed();
    this.floor = D.generate(s, this.floorSeed);
    this.roomState = {};
    for (const r of this.floor.rooms) this.roomState[r.id] = { visited: false, known: false, cleared: false, props: null, broken: 0 };
    this.run.roomsTotal += this.floor.rooms.length;
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
    this.enemies.length = 0; this.projs.length = 0; this.zones.length = 0; this.chainQ.length = 0; this.curChain = null; this.corpses.length = 0;
    if (this.fg) this.fg.ok = false;
    this.boss = null; this.enc = null;
    this.roomId = id;
    this.roomEpoch = (this.roomEpoch || 0) + 1;
    const room = this.room = this.floor.rooms[id];
    const rs = this.roomState[id];
    if (!rs.visited) this.run.roomsVisited++;
    rs.visited = true; rs.known = true;
    for (const d in room.doors) if (room.doors[d] >= 0) this.roomState[room.doors[d]].known = true;
    let k = 0;
    const pos = [];
    for (const p of this.players.values()) {
      const pt = fromDir ? D.entryPoint(room, D.OPP[fromDir], k) : { x: D.center(room).x + (k - 1.5) * 22, y: D.center(room).y + 20 };
      p.x = pt.x; p.y = pt.y; p.vx = 0; p.vy = 0; p.dashT = 0; p.skillMove = null; p.skillIfr = false; p.charge = null; this.clearShields(p); // a thrown shield and a charge in flight end with the room
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
    this.emit({ t: 'room', id, from: fromDir || '', pos, locked: this.locked, ep: this.roomEpoch });
    if (room.dark && !rs.cleared) this.emit({ t: 'dark' });
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
    for (const p of this.players.values()) players[p.pid] = { cls: p.cls, name: p.name, kills: p.kills, dealt: Math.round(p.dealt), emberBonus: p.stats.emberBonus || 0, relics: p.relics.length, evo: p.stats.evo || null, maxRelics: p.maxRelics, revivesGiven: p.revivesGiven };
    return {
      victory: this.victory, retreat: !!this.retreat, abandoned: !!this.abandoned, stratum: this.stratum, time: Math.round(this.time), kills: this.run.kills, fodderKills: this.run.fodderKills,
      roomsCleared: this.run.roomsCleared, elitesKilled: this.run.elitesKilled, bosses: this.run.bosses, bossCount: this.run.bossCount,
      embers: Object.assign({}, this.run.embers), pact: this.pact, party: this.partySize(), level: this.level,
      revives: this.run.revives, flawlessBoss: this.run.flawlessBoss, maxGold: this.run.maxGold, maxRelics: this.run.maxRelics, players,
      evolved: [...this.players.values()].some(p => !!p.stats.evo), fullClear: this.run.fullClear,
      roomsVisited: this.run.roomsVisited, roomsTotal: this.run.roomsTotal, darkCleared: this.run.darkCleared,
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
    const fg = this.foeGrid(); fg.live = true; fg.qd = 0;
    this.updateShields(dt);
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    if (!fg.direct) for (let i = 0; i < fg.n; i++) this.foeDrift(i); // hero effects that carry or pull foes (Sim.moveCircle) move them outside updateEnemy
    this.flowT -= dt;
    if (this.flowT <= 0) { this.computeFlow(); this.flowT = 0.25; }
    this.updateEncounter(dt);
    for (let i = 0; i < this.enemies.length; i++) { this.updateEnemy(this.enemies[i], dt); if (!fg.direct) this.foeDrift(i); }
    this.separate();
    this.foeGrid();
    this.updateAllies(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updateChains();
    this.updatePickups(dt);
    if (this.enemies.some(e => e.hp <= 0)) this.enemies = this.enemies.filter(e => e.hp > 0);
    fg.live = false;
    this.checkDoors(dt);
    this.updateOffers(dt);
    this.checkDefeat();
    this.run.maxGold = Math.max(this.run.maxGold, this.gold);
  };

  W.prototype.updatePlayer = function (p, dt) {
    // p.lvx / p.lvy: measured velocity (px/s, eased over ~0.1 s) from the position change since the last tick, local and remote heroes alike; a jump over 24 px (room change, teleport) resets it. Foes lead their shots by it.
    const jx = p.lpx === null ? 0 : p.x - p.lpx, jy = p.lpy === null ? 0 : p.y - p.lpy;
    if (jx * jx + jy * jy > 576) { p.lvx = 0; p.lvy = 0; } else { const k = Math.min(1, dt * 10); p.lvx += (jx / dt - p.lvx) * k; p.lvy += (jy / dt - p.lvy) * k; }
    p.lpx = p.x; p.lpy = p.y;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtT -= dt;
    if (!p.remote) p.dashing = p.dashT > 0;
    if (p.shields.length && (p.downed || p.dead)) this.clearShields(p);
    if (p.dead) return;
    if (p.downed) {
      let helpers = 0;
      for (const q of this.players.values()) if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 48 * 48) helpers++;
      if (helpers) {
        p.revive += dt * (0.4 + 0.2 * (helpers - 1));
        if (p.revive >= 1) {
          p.downed = false; p.revive = 0; p.hp = Math.round(p.maxHp * 0.35); p.invuln = 1.5;
          this.run.revives++;
          for (const q of this.players.values()) if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 48 * 48) q.revivesGiven++;
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
        const dmg = hz === 'spikes' ? 1.5 : hz === 'poison' ? 1 : hz === 'lava' ? 1.5 : hz === 'void' ? 1.5 : 0; // damage per tick before HAZARD_MUL, in hero health points
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

  // Pushes the overlapping pair a, b apart (movable foes only); returns whether it did.
  const sepPair = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.9;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 < 1e-4) return false;
    const am = a.spd > 0 && !a.boss, bm = b.spd > 0 && !b.boss;
    if (!am && !bm) return false;
    const d = Math.sqrt(d2), push = rr - d;
    const wa = am && bm ? 0.5 : am ? 1 : 0, wb = 1 - wa;
    const ux = dx / d, uy = dy / d;
    a.x -= ux * push * wa; a.y -= uy * push * wa;
    b.x += ux * push * wb; b.y += uy * push * wb;
    return true;
  };

  // Cells of the pair grid behind separate(): its own 32 px grid, relinked whenever a push moves a foe across a cell edge, so it always holds the exact positions.
  const SEP_CELL = 32, SEP_INV = 1 / SEP_CELL, SEP_SLACK = 8;
  const sepCell = (e, cw, ch) => {
    let cx = (e.x * SEP_INV) | 0, cy = (e.y * SEP_INV) | 0;
    if (cx < 0) cx = 0; else if (cx >= cw) cx = cw - 1;
    if (cy < 0) cy = 0; else if (cy >= ch) cy = ch - 1;
    return cy * cw + cx;
  };
  // Fills s.cand with the ascending indices j > i of the foes in the cells within H of (x, y); returns the count.
  const sepGather = (s, cw, ch, x, y, H, i) => {
    const head = s.head, next = s.next, cand = s.cand;
    let x0 = Math.floor((x - H) * SEP_INV), x1 = Math.floor((x + H) * SEP_INV), y0 = Math.floor((y - H) * SEP_INV), y1 = Math.floor((y + H) * SEP_INV), m = 0;
    x0 = x0 < 0 ? 0 : x0 >= cw ? cw - 1 : x0; x1 = x1 < 0 ? 0 : x1 >= cw ? cw - 1 : x1;
    y0 = y0 < 0 ? 0 : y0 >= ch ? ch - 1 : y0; y1 = y1 < 0 ? 0 : y1 >= ch ? ch - 1 : y1;
    for (let cy = y0; cy <= y1; cy++) for (let c = cy * cw + x0, ce = cy * cw + x1; c <= ce; c++) for (let j = head[c]; j >= 0; j = next[j]) if (j > i) cand[m++] = j;
    for (let p = 1; p < m; p++) { const v = cand[p]; let q = p - 1; while (q >= 0 && cand[q] > v) { cand[q + 1] = cand[q]; q--; } cand[q + 1] = v; }
    return m;
  };
  // Moves foe idx to the cell of its position.
  const sepMove = (s, e, idx, cw, ch) => {
    const c = sepCell(e, cw, ch), o = s.cell[idx];
    if (c === o) return;
    const head = s.head, next = s.next;
    if (head[o] === idx) head[o] = next[idx];
    else { let p = head[o]; while (next[p] !== idx) p = next[p]; next[p] = next[idx]; }
    next[idx] = head[c]; head[c] = idx; s.cell[idx] = c;
  };

  // Separates overlapping foes pair by pair in (i, j > i) order. With GRID_MIN or more foes the j come from the pair grid: the foes within 0.9 (a.r + the largest radius) + SEP_SLACK of a, sorted by index
  // and gathered again once a has moved SEP_SLACK; fewer foes pair every j > i. The same pairs move in the same order either way.
  W.prototype.separate = function () {
    const es = this.enemies, n = es.length;
    if (n < GRID_MIN) {
      for (let i = 0; i < n; i++) {
        const a = es[i]; if (a.hp <= 0) continue;
        for (let j = i + 1; j < n; j++) {
          const b = es[j]; if (b.hp <= 0) continue;
          sepPair(a, b);
        }
      }
    } else {
      let s = this.sg;
      if (!s) s = this.sg = { cap: 0, head: new Int32Array(0), next: new Int32Array(0), cell: new Int32Array(0), cand: new Int32Array(0) };
      const room = this.room, cw = Math.ceil(room.w * T / SEP_CELL), ch = Math.ceil(room.h * T / SEP_CELL), nc = cw * ch;
      if (s.head.length < nc) s.head = new Int32Array(nc);
      if (s.cap < n) { const cap = Math.max(256, 1 << (32 - Math.clz32(n + 63))); s.next = new Int32Array(cap); s.cell = new Int32Array(cap); s.cand = new Int32Array(cap); s.cap = cap; }
      const head = s.head, next = s.next, cell = s.cell, cand = s.cand;
      head.fill(-1, 0, nc);
      let rmax = 0;
      for (let i = n - 1; i >= 0; i--) { // descending: each cell's list starts out ascending
        const e = es[i];
        if (e.hp <= 0) { cell[i] = -1; continue; }
        if (e.r > rmax) rmax = e.r;
        const c = sepCell(e, cw, ch);
        cell[i] = c; next[i] = head[c]; head[c] = i;
      }
      for (let i = 0; i < n; i++) {
        if (cell[i] < 0) continue;
        const a = es[i], H = 0.9 * (a.r + rmax) + SEP_SLACK;
        let qx = a.x, qy = a.y, m = sepGather(s, cw, ch, qx, qy, H, i), k = 0;
        while (k < m) {
          const j = cand[k++], b = es[j];
          if (!sepPair(a, b)) continue;
          sepMove(s, a, i, cw, ch); sepMove(s, b, j, cw, ch);
          if (U.dist2(a.x, a.y, qx, qy) > SEP_SLACK * SEP_SLACK) {
            qx = a.x; qy = a.y; m = sepGather(s, cw, ch, qx, qy, H, i); k = 0;
            while (k < m && cand[k] <= j) k++;
          }
        }
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

  // Gold and xp dropped in a dark room are x darkLoot(): DARK_LOOT x (1 + Deep Wick loot x the highest Deep Wick rank in the party).
  W.prototype.darkLoot = function () {
    let r = 0;
    for (const p of this.players.values()) r = Math.max(r, (p.meta.up && p.meta.up[ED.UPGRADE_IDX.deepwick]) || 0);
    return W.DARK_LOOT * (1 + ED.UPGRADES[ED.UPGRADE_IDX.deepwick].loot * r);
  };
  W.prototype.lootMul = function () { return this.room && this.room.dark ? this.darkLoot() : 1; };
  W.prototype.dropGold = function (x, y, total, exact) {
    total = Math.round((exact ? total : total * W.GOLD_MUL) * this.lootMul());
    while (total > 0) { const v = Math.min(total, total > 30 ? 10 : total > 8 ? 4 : 1); this.spawnPickup('gold', x, y, v); total -= v; }
  };
  // Drops total xp (x lootMul unless exact: fodder motes and the clear pile) and returns the amount dropped. In a room with an xp budget (enc.xpBudget) a threat drop is scaled by enc.xpK (the planned waves fill enc.xpThrCap, the budget less the fodder share),
  // its fraction carried in enc.xpThrAcc, and cut to what is left of xpThrCap (unplanned summons); an exact drop is cut to what is left of the budget. enc.xpOut counts everything dropped, enc.xpThr the threat part, enc.xpClip what the cuts removed.
  // A threat foe's xp: its threatXp, except that in a room with an xp budget only the planned wave foes (e.plan) pay; summons and splits drop none there.
  W.prototype.dropFoeXp = function (e) {
    const enc = this.enc;
    if (enc && enc.xpBudget !== undefined && !e.plan) return;
    this.dropXp(e.x, e.y, W.threatXp(e.def, this.stratum, e.elite));
  };
  W.prototype.dropXp = function (x, y, total, exact) {
    const enc = this.enc, led = !!enc && enc.xpBudget !== undefined;
    if (exact) total = Math.round(total);
    else if (led) { enc.xpThrAcc += total * this.lootMul() * enc.xpK; total = Math.floor(enc.xpThrAcc); enc.xpThrAcc -= total; }
    else total = Math.max(1, Math.round(total * this.lootMul()));
    if (led) {
      const left = Math.max(0, exact ? enc.xpBudget - enc.xpOut : enc.xpThrCap - enc.xpThr);
      if (total > left) { enc.xpClip += total - left; total = left; }
      enc.xpOut += total;
      if (!exact) enc.xpThr += total;
    }
    const out = total;
    while (total > 0) { const v = Math.min(total, total > 40 ? 12 : total > 10 ? 4 : 1); this.spawnPickup('xp', x, y, v); total -= v; }
    return out;
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
    else if (pk.kind === 'heart') { this.healPlayer(p, p.maxHp * (0.22 + 0.03 * p.stats.forager) + 1.5); }
  };

  // Marks the stratum fully explored once every non-boss room has been cleared (non-combat rooms clear on entry).
  W.prototype.checkFullClear = function () {
    if (this.fullClearDone === this.stratum) return;
    for (const r of this.floor.rooms) if (r.type !== 'boss' && !this.roomState[r.id].cleared) return;
    this.fullClearDone = this.stratum; this.run.fullClear = true;
  };

})(globalThis.ED || (globalThis.ED = {}));
