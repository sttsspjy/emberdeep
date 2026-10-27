// ED.World: host-authoritative survival run. Fixed step 1/60, deterministic per seed (w.rng only; entity ids from w.nextId()).
// Tick order (ARCHITECTURE §5): inputs -> heroes -> spawner -> foes -> grid + separation -> weapons -> skills -> projectiles -> zones -> pickups/progress -> bosses -> hit flush -> compaction -> run state.
// Entity arrays (heroes, foes, projs, zones, pickups) are pooled and compacted in place once per tick: a dead object may be reused under a new id, so holders keep (object, id) and check both.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST;

  // cfg: { seed, stage (index), players: [{ pid, name, slot, cls, meta: { shop, sigs } }], mode: 'survival', cheats: { god, might, xp } (checks and tools only) }
  const W = ED.World = function (cfg) {
    this.seed = (cfg.seed >>> 0) || 1; this.stage = cfg.stage | 0; this.sdef = ED.STAGES[this.stage] || ED.STAGES[0]; this.mode = cfg.mode || 'survival';
    this.rng = U.RNG(this.seed ^ 0xa11ce);
    this.nid = 1;
    this.arena = ED.Arena.generate(this.stage, this.seed);
    this.time = 0; this.tick = 0; this.state = 'play'; this.paused = false;
    this.heroes = []; this.byPid = {}; this.living = [];
    this.foes = []; this.projs = []; this.zones = []; this.pickups = []; this.events = [];
    this.xp = 0; this.level = 1; this.xpNext = W.xpFor(1); this.gold = 0; this.kills = 0;
    this.boss = null; this.bossId = 0; this.finalDown = false;
    this.cheats = cfg.cheats || {};
    this.initCombat(); this.initFoes(); this.initSpawner(); this.initProgress(); this.initBosses();
    for (const pd of cfg.players || []) this.addHero(pd);
    this.partyN = Math.max(1, this.heroes.length);
    this.refreshLiving();
  };
  Object.assign(W.prototype, ED.Grid);

  // XP to go from level L to L + 1 (GAME-DESIGN §6).
  W.xpFor = (L) => (L <= 20 ? 5 + 8 * (L - 1) : 157 + 15 * (L - 20));

  W.prototype.nextId = function () { return this.nid++; };
  W.prototype.minute = function () { return Math.floor(this.time / 60); };
  W.prototype.emit = function (ev) { this.events.push(ev); return ev; };
  W.prototype.solo = function () { return this.heroes.length === 1; };
  W.prototype.hero = function (pid) { return this.byPid[pid] || null; };
  W.prototype.alive = function (p) { return !!p && !p.dead && !p.downed; };
  W.prototype.refreshLiving = function () { const L = this.living; L.length = 0; for (const p of this.heroes) if (!p.dead && !p.downed) L.push(p); return L; };
  // Nearest living hero to (x, y), or null.
  W.prototype.nearestHero = function (x, y) {
    let best = null, bd = Infinity;
    for (const p of this.living) { const d = U.dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  // Party HP factor for foes and bosses (GAME-DESIGN §7-8).
  W.prototype.partyHp = function () { return 1 + 0.5 * (this.partyN - 1); };

  // ---------------- heroes ----------------
  W.prototype.addHero = function (pd) {
    const h = ED.HEROES[pd.cls] || ED.HEROES[ED.HERO_IDS[0]], c = this.arena.size / 2, slot = pd.slot | 0;
    const p = {
      pid: pd.pid, slot, cls: h.id, name: pd.name || 'Hero', meta: pd.meta || { shop: {}, sigs: [] },
      x: c + (slot % 2 ? 24 : -24) * (slot > 0 ? 1 : 0), y: c + (slot >= 2 ? 24 : 0), vx: 0, vy: 0, face: 0, mdir: 0, mvx: 0, mvy: 0, moving: false, r: C.HERO_R,
      hp: 1, maxHp: 1, stats: null, statsV: 0, weapons: [], passives: [], skills: [],
      dashCd: 0, dashT: 0, dashDx: 1, dashDy: 0, invuln: 0, hurtT: 0, dr: 0, slowT: 0, slowK: 0, downed: false, bleed: 0, revive: 0, dead: false, revUsed: 0,
      kills: 0, dealt: {}, offer: null, pend: 0, rerolls: 0, skips: 0, pickInv: 0,
      in: { mx: 0, my: 0, ax: c + 100, ay: c, dash: false, q: false, e: false, pick: 0, reroll: false, skip: false },
    };
    this.heroes.push(p); this.byPid[p.pid] = p;
    this.recalc(p, true);
    p.rerolls = p.stats.rerolls | 0; p.skips = p.stats.skips | 0;
    if (h.sig && ED.WEAPONS[h.sig]) this.addWeapon(p, h.sig);
    for (const id of h.skills || []) if (ED.SKILLS[id]) p.skills.push({ id, lvl: 1, cd: 0, cdMax: ED.SKILLS[id].cd || 10, N: null });
    const hk = ED.HOOK[p.cls]; if (hk && hk.init) hk.init(this, p);
    return p;
  };
  // Recomputes p.stats (after any pick); fill: start at full HP, else a max HP gain heals the same amount.
  W.prototype.recalc = function (p, fill) {
    const old = p.maxHp;
    p.stats = ED.Stats.compute(p); p.statsV++;
    p.maxHp = p.stats.maxHp;
    if (fill) p.hp = p.maxHp; else { if (p.maxHp > old) p.hp += p.maxHp - old; p.hp = Math.min(p.hp, p.maxHp); }
  };
  W.prototype.heal = function (p, v) {
    if (!this.alive(p)) return 0;
    const h = Math.min(v, p.maxHp - p.hp); p.hp += h;
    if (h >= 1) this.emit({ t: 'heal', pid: p.pid, v: Math.round(h) });
    return h;
  };

  // Latches one input frame for hero pid; applied at the next tick. Edge flags (dash, q, e, reroll, skip) stay set until a tick consumes them; pick is 1..4.
  W.prototype.input = function (pid, inp) {
    const p = this.byPid[pid]; if (!p || !inp) return;
    const I = p.in;
    if (inp.mx !== undefined) { const l = Math.hypot(inp.mx, inp.my); I.mx = l > 1 ? inp.mx / l : inp.mx; I.my = l > 1 ? inp.my / l : inp.my; }
    if (inp.ax !== undefined && isFinite(inp.ax) && isFinite(inp.ay)) { I.ax = inp.ax; I.ay = inp.ay; }
    if (inp.dash) I.dash = true;
    if (inp.q) I.q = true;
    if (inp.e) I.e = true;
    if (inp.reroll) I.reroll = true;
    if (inp.skip) I.skip = true;
    if (inp.pick >= 1 && inp.pick <= 4) I.pick = inp.pick | 0;
  };

  W.prototype.updateHeroes = function (dt) {
    const A = this.arena, D = C.DASH;
    for (const p of this.heroes) {
      if (p.dead) continue;
      const I = p.in;
      p.invuln -= dt; p.hurtT -= dt; p.dashCd -= dt; p.pickInv -= dt;
      if (p.downed) {
        p.bleed -= dt;
        let helpers = 0;
        for (const q of this.living) if (q !== p && U.dist2(q.x, q.y, p.x, p.y) <= 40 * 40) helpers++;
        p.revive = helpers ? p.revive + dt / 2.5 : Math.max(0, p.revive - dt / 2.5);
        if (p.revive >= 1) { p.downed = false; p.revive = 0; p.hp = Math.round(p.maxHp * 0.4); p.invuln = 2; this.emit({ t: 'revive', pid: p.pid }); }
        else if (p.bleed <= 0) { p.dead = true; this.emit({ t: 'dead', pid: p.pid }); }
        I.dash = I.q = I.e = false;
        continue;
      }
      if (p.stats.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);
      p.face = Math.atan2(I.ay - p.y, I.ax - p.x);
      if (I.dash && p.dashCd <= 0 && p.dashT <= 0) {
        const l = Math.hypot(I.mx, I.my);
        if (l > 0.1) { p.dashDx = I.mx / l; p.dashDy = I.my / l; } else { p.dashDx = Math.cos(p.face); p.dashDy = Math.sin(p.face); }
        p.dashT = D.t; p.dashCd = D.cd;
        this.emit({ t: 'dash', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), a: Math.atan2(p.dashDy, p.dashDx) });
      }
      I.dash = false;
      if (p.dashT > 0) {
        const step = Math.min(dt, p.dashT), v = D.dist / D.t;
        p.vx = p.dashDx * v; p.vy = p.dashDy * v;
        ED.Arena.move(A, p, p.vx * step, p.vy * step, p.r);
        p.dashT -= dt; p.moving = true;
      } else {
        const sp = p.stats.speed * (p.slowT > 0 ? 1 - (p.slowK || 0) : 1);
        p.vx = I.mx * sp; p.vy = I.my * sp;
        p.moving = Math.abs(I.mx) + Math.abs(I.my) > 0.05;
        if (p.moving) { ED.Arena.move(A, p, p.vx * dt, p.vy * dt, p.r); p.mdir = Math.atan2(I.my, I.mx); p.mvx = I.mx; p.mvy = I.my; }
      }
      if (p.slowT > 0) p.slowT -= dt;
      const hk = ED.HOOK[p.cls]; if (hk && hk.tick) hk.tick(this, p, dt);
    }
  };

  // Hero p reached 0 HP: a Revival charge revives (solo), co-op heroes go down (20 s bleed-out, revived by a teammate within 40 px for 2.5 s at 40% HP), solo dies.
  W.prototype.heroDown = function (p) {
    if (p.downed || p.dead) return;
    if (p.revUsed < (p.stats.revival | 0)) {
      p.revUsed++; p.hp = Math.round(p.maxHp * 0.5); p.invuln = 2;
      this.blast(p, '', p.x, p.y, 160, 0, { knock: 400, team: 0, look: 'holy' });
      this.emit({ t: 'revive', pid: p.pid, charge: true });
      return;
    }
    p.hp = 0; p.dashT = 0;
    if (this.solo()) { p.dead = true; this.emit({ t: 'dead', pid: p.pid }); return; }
    p.downed = true; p.bleed = 20; p.revive = 0;
    this.emit({ t: 'down', pid: p.pid });
  };

  // ---------------- tick ----------------
  W.prototype.update = function (dt) {
    if (this.events.length > 6000) this.events.length = 0; // nobody drained the event list (headless use)
    this.applyPicks();
    if (this.state !== 'play') return;
    if (this.paused) { this.paused = this.solo() && this.heroes.some(p => p.offer); if (this.paused) return; }
    this.tick++; this.time += dt;
    this.refreshLiving();
    this.updateHeroes(dt);
    this.refreshLiving();
    this.updateSpawner(dt);
    this.updateFoes(dt);
    this.separate();
    this.foeGrid();
    this.updateWeapons(dt);
    this.updateSkills(dt);
    this.updateProjs(dt);
    this.updateZones(dt);
    this.updatePickups(dt);
    this.updateProgress(dt);
    this.updateBosses(dt);
    this.flushHits();
    this.compact();
    this.runState();
  };

  const compactArr = (arr, pool) => {
    let n = 0;
    for (let i = 0; i < arr.length; i++) { const o = arr[i]; if (o.dead) { if (pool) pool.push(o); } else arr[n++] = o; }
    arr.length = n;
  };
  W.prototype.compact = function () {
    const before = this.foes.length;
    compactArr(this.foes, this.foePool);
    if (this.foes.length !== before && this.fg) this.fg.valid = false;
    compactArr(this.projs, this.projPool);
    compactArr(this.zones, this.zonePool);
    compactArr(this.pickups, this.pickPool);
  };

  W.prototype.runState = function () {
    this.refreshLiving();
    if (this.finalDown) { this.end(true); return; }
    if (!this.living.length && !this.cheats.god) this.end(false);
  };
  W.prototype.end = function (won) {
    if (this.state !== 'play') return;
    this.state = won ? 'won' : 'lost';
    this.emit({ t: 'end', won, summary: this.summary() });
  };
  W.prototype.summary = function () {
    return {
      won: this.state === 'won', time: this.time, kills: this.kills, level: this.level, gold: this.gold, stage: this.stage,
      perHero: this.heroes.map(p => ({ pid: p.pid, cls: p.cls, name: p.name, kills: p.kills, dealt: Object.assign({}, p.dealt), weapons: p.weapons.map(ws => ws.id) })),
    };
  };
})(globalThis.ED || (globalThis.ED = {}));
