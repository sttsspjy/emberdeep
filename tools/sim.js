// Usage: node tools/sim.js <heroes> <runs> <botSkill 0-1> <meta none|mid|max> [classes|-] [pact] [--pick=random|smart] [--force=id,id] [--seed0=N] [--explore=minLight] [--quiet]   (parallel batches: tools/simpool.js)
// Headless simulation harness: loads the game's sim files in a VM and drives bot heroes through full runs (deterministic per seed: the bot has its own seeded RNG).
// Bot policy: fight, claim room rewards, use rest sites and shops, then explore unvisited rooms nearest-first while entering the next one
// (its light cost paid) leaves the lantern at least EXPLORE_MIN_LIGHT full, else head for the boss (the exploration/lantern trade-off).
// Pick policies: 'random' takes a random card; 'smart' (PICK=smart) follows the build order in smartScore (evolution > keystone > duo > owned path > gate while < 2 paths > neutral).
// --force: boon/relic ids granted at run start (a gate id replaces the random start pick; other boons and relics are added) for fairness tests.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src') + '/';
const files = ['util.js', 'data/biomes.js', 'data/enemies.js', 'data/classes.js', 'data/boons.js', 'data/classboons.js', 'data/relics.js', 'data/meta.js', 'save.js',
  'sim/dungeon.js', 'sim/stats.js', 'sim/world.js', 'sim/combat.js', 'sim/build.js', 'sim/skills.js', 'sim/ai.js', 'sim/bosses.js', 'sim/rooms.js'];
const ctx = { console, Math, Date, Object, Array, Set, Map, JSON, Uint8Array, Int16Array, Int32Array, Number, String, Error, parseInt, isNaN };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of files) vm.runInContext(fs.readFileSync(ROOT + f, 'utf8'), ctx, { filename: f });
const ED = ctx.ED;
const U = ED.U, T = ED.CONST.TILE, D = ED.Dungeon;

const EXPLORE_MIN_LIGHT = 0.3; // the bot stops exploring when the next room would leave the lantern below this fraction, and goes for the boss
const PER_HERO_REWARDS = ['class', 'forge', 'epic', 'vigor'];
const MAX_SECONDS = 60 * 60; // a run that is still going after an hour of game time counts as a loss
// Neutral boons in the order a sensible player takes them (damage and defence first).
const NEUTRAL_PREF = ['edge', 'quick', 'vigor', 'plating', 'focus', 'evade', 'wide', 'fleet', 'magnet', 'thorns', 'lightstep', 'bounty'];

// First step toward (tx, ty): the shortest path that stays off floor hazards, else the shortest path (a hero walks around hazards when it can).
function bfsDir(room, locked, sx, sy, tx, ty) { return bfsStep(room, locked, sx, sy, tx, ty, true) || bfsStep(room, locked, sx, sy, tx, ty, false); }
function bfsStep(room, locked, sx, sy, tx, ty, safe) {
  const w = room.w, h = room.h;
  const s = Math.floor(sy / T) * w + Math.floor(sx / T), g = Math.floor(ty / T) * w + Math.floor(tx / T);
  if (s === g || s < 0 || s >= w * h || g < 0 || g >= w * h) return [tx - sx, ty - sy];
  const prev = new Int32Array(w * h).fill(-1); prev[s] = s;
  const q = [s];
  while (q.length) {
    const i = q.shift(); if (i === g) break;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || prev[j] >= 0) continue;
      const t = room.tiles[j];
      if (t === 0 || (t === 4 && !safe) || (t === 5 && !locked)) { prev[j] = i; q.push(j); }
    }
  }
  if (prev[g] < 0) return safe ? null : [tx - sx, ty - sy];
  let c = g;
  while (prev[c] !== s && c !== s) c = prev[c];
  const nx = (c % w + 0.5) * T, ny = (Math.floor(c / w) + 0.5) * T;
  return [nx - sx, ny - sy];
}

// Steers (mx, my) off hazard tiles: standing on one or about to step onto one, the first turn of 35-145 degrees (either side) or the reverse that lands on safe floor.
function avoidHazard(room, p, mx, my) {
  const look = p.r + 12, bad = (dx, dy) => D.tileAt(room, p.x + dx * look, p.y + dy * look) === 4 || D.tileAt(room, p.x + dx * look * 0.5, p.y + dy * look * 0.5) === 4;
  if (D.tileAt(room, p.x, p.y) !== 4 && !bad(mx, my)) return [mx, my];
  const l = Math.hypot(mx, my) || 1, a0 = Math.atan2(my, mx);
  for (const off of [0.6, -0.6, 1.1, -1.1, 1.6, -1.6, 2.1, -2.1, 2.5, -2.5, Math.PI]) {
    const dx = Math.cos(a0 + off), dy = Math.sin(a0 + off);
    if (!bad(dx, dy)) return [dx * l, dy * l];
  }
  return [mx, my];
}

// Direction perpendicular to the Gloom's lunge line, on the side the hero already stands.
function sidestep(g, p) { const a = g.aimA, side = ((p.x - g.x) * -Math.sin(a) + (p.y - g.y) * Math.cos(a)) >= 0 ? 1 : -1; return [-Math.sin(a) * side, Math.cos(a) * side]; }

// Next prop worth walking to, or null. Per-hero rewards respect p.claimed; shop and rest choices follow the lantern and HP.
function wantedProp(w, p) {
  const lightFrac = w.lightMax ? w.light / w.lightMax : 1;
  const hurt = p.hp < p.maxHp * 0.6;
  let best = null, bs = 0;
  for (const x of w.props) {
    if (x.state) continue;
    let s = 0;
    switch (x.kind) {
      case 'reward': s = (x.item.startsWith('boon:') || PER_HERO_REWARDS.includes(x.item)) ? (p.claimed[x.group] ? 0 : 9) : (x.item === 'oil' && lightFrac > 0.85 ? 3 : 9); break;
      case 'chest': s = 8; break;
      case 'relic': s = p.claimed[x.group] ? 0 : 7; break;
      case 'campfire': s = !p.claimed[x.group] && hurt ? 8 : 0; break;
      case 'anvil': s = !p.claimed[x.group] && !hurt ? 8 : 0; break;
      case 'fountain': s = 5; break;
      case 'altar': s = p.hp > p.maxHp * 0.6 ? 5 : 0; break;
      case 'shop':
        if (w.gold < x.price) break;
        if (x.stype === 'oil') s = lightFrac < 0.4 ? 10 : 0;
        else if (x.stype === 'potion') s = p.hp < p.maxHp * 0.7 ? 6 : 0;
        else s = x.stype === 'relic' ? 6 : 7;
        break;
      default: break;
    }
    if (s > bs) { bs = s; best = x; }
  }
  return best;
}

// Direction toward the next room to visit: the nearest unvisited non-boss room while entering it (its light cost paid) leaves the lantern at or above minLight, else the boss.
// rec.turn[stratum] logs the light when it first heads for the boss.
function exploreDir(w, p, rec, minLight) {
  const room = w.room, fl = w.floor;
  const frac = w.lightMax ? w.light / w.lightMax : 1;
  const search = (target) => { // BFS from the current room: nearest unvisited non-boss room (target null) or the target room
    const prev = {}; prev[room.id] = -1; const q = [room.id];
    while (q.length) {
      const id = q.shift(); const r = fl.rooms[id];
      if (id !== room.id && ((target === null && !w.roomState[id].visited && r.type !== 'boss') || id === target)) return { found: id, prev };
      for (const dd in r.doors) { const n = r.doors[dd]; if (n >= 0 && prev[n] === undefined) { if (fl.rooms[n].type === 'boss' && target === null) continue; prev[n] = id; q.push(n); } }
    }
    return { found: null, prev };
  };
  let hit = search(null);
  const exploring = hit.found !== null && (!w.lightMax || (w.light - ED.World.roomCost(fl.rooms[hit.found].type)) / w.lightMax >= (minLight ?? EXPLORE_MIN_LIGHT));
  if (!exploring) {
    if (rec && !rec.turn[w.stratum]) rec.turn[w.stratum] = { light: Math.round(frac * 100) / 100, explored: hit.found === null };
    hit = search(fl.boss);
  }
  const { found, prev } = hit;
  if (found === null) return null;
  let step = found; while (prev[step] !== room.id) step = prev[step];
  const dd = Object.keys(room.doors).find(k => room.doors[k] === step);
  const r = D.doorRect(room, dd);
  const gx = (r.x0 + r.x1 + 1) / 2 * T + (dd === 'e' ? 30 : dd === 'w' ? -30 : 0), gy = (r.y0 + r.y1 + 1) / 2 * T + (dd === 's' ? 30 : dd === 'n' ? -30 : 0);
  return bfsDir(room, w.locked, p.x, p.y, U.clamp(gx, 4, room.w * T - 4), U.clamp(gy, 4, room.h * T - 4));
}

// Card score for the smart policy: evolution > keystone > duo > boon of an owned path (deepest path first) > gate while fewer than 2 paths > neutral > class > anything.
function smartScore(p, id) {
  const b = ED.BOONS[id];
  if (b.evo) return 1000;
  const owned = ED.gatePaths(p.boons), aff = (k) => ED.pathAffinity(p.boons, k);
  const rar = b.rar === 'r' ? 3 : b.rar === 'e' ? 4 : 1;
  if (b.key) return 900 + aff(b.path);
  if (b.duo) return 800;
  if (b.path && !b.gate && owned.includes(b.path)) return 600 + 10 * aff(b.path) + rar;
  if (b.gate && owned.length < 2) return 500;
  const n = NEUTRAL_PREF.indexOf(id);
  if (n >= 0) return 400 - n;
  if (b.cls) return 300 + rar;
  if (b.gate) return 250;
  return 100 + rar;
}

// Index of the card to take. Forge: rank up the boon of the most-invested path (stacked boons first); a forced gate is taken whenever it is offered.
function pickIndex(p, spec, policy, rng, force) {
  const offer = p.offer;
  for (const f of force) { const i = offer.indexOf(f); if (i >= 0) return i; }
  if (policy !== 'smart') return Math.floor(rng.next() * offer.length);
  const forge = spec && spec.src === 'forge';
  let best = 0, bs = -1e9;
  offer.forEach((id, i) => {
    const b = ED.BOONS[id];
    const s = forge ? (b.path ? 100 * ED.pathAffinity(p.boons, b.path) + 10 * (p.boons[id] || 0) + (b.key ? 5 : 0) : (p.boons[id] || 0)) : smartScore(p, id);
    const sc = s + rng.next() * 0.5;
    if (sc > bs) { bs = sc; best = i; }
  });
  return best;
}

// Damage-report bucket of a hero hit: companions, class skills, Storm arcs (discharges, thunderbolts, lightning), status payouts (burn/bleed ticks, combust, shatter, thermal), ground fields, else weapon (swings, shots, blasts, dashes, evolution strikes).
function dmgSource(src, k) {
  if (src.comp || k === 'orbit' || k === 'wisp' || k === 'minion') return 'comp';
  if (k === 'skill') return 'skill';
  if (k === 'chain' || src.el === 'storm') return 'storm';
  if (k === 'dot') return src.raw ? 'status' : 'field';
  if (k === 'explode' && src.raw) return 'status';
  return 'weapon';
}

const median = (a) => { if (!a.length) return NaN; a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };

// Weapon hits to kill a regular foe of stratum s: median over the roster (weighted) of ceil(foe HP / expected hit), expected hit = weapon damage x damage stat x crit factor (party and pact excluded).
function hitsToKill(w, p, s) {
  const st = p.stats, per = st.weapon.dmg * st.dmg * (1 + st.crit * (st.critMult - 1));
  const rows = ED.biomeFor(s).enemies.filter(([id]) => { const d = ED.ENEMIES[id]; return d && !d.boss && !d.gloom && !d.ally && !d.minion; })
    .map(([id, wt]) => ({ h: Math.ceil(ED.ENEMIES[id].hp * ED.World.hpScale(s) / per), wt })).sort((a, b) => a.h - b.h);
  const tot = rows.reduce((a, r) => a + r.wt, 0);
  let acc = 0;
  for (const r of rows) { acc += r.wt; if (acc >= tot / 2) return r.h; }
  return NaN;
}

// Damage per second of the starting weapon with no boons (every attack hits once).
const bareDps = (cls, weapon) => { const wp = ED.WEAPONS[weapon]; return wp.dmg * (wp.n || 1) / wp.rate; };

function runBot(opts) {
  U.resetUid(1);
  const brng = U.RNG((opts.seed ^ 0xb07b07) >>> 0), policy = opts.pick || process.env.PICK || 'random';
  const force = (opts.force || []).filter(id => ED.BOONS[id] && ED.BOONS[id].gate);
  const players = [];
  for (let i = 0; i < opts.n; i++) {
    const cls = opts.cls[i % opts.cls.length];
    players.push({ pid: 'p' + i, name: 'Bot' + i, slot: i, cls, weapon: ED.CLASSES[cls].weapons[opts.weapon || 0],
      meta: { up: opts.up || ED.UPGRADES.map(() => 0), mastery: opts.mastery || 1, relics: ED.RELIC_IDS.filter(id => ED.RELICS[id].start) } });
  }
  const w = new ED.World({ seed: opts.seed, pact: opts.pact || 0, players, tutorial: opts.tutorial });
  w.startRun();
  const htkBare = hitsToKill(w, w.players.values().next().value, 1);
  for (const id of opts.force || []) {
    for (const p of w.players.values()) {
      if (ED.RELICS[id]) w.giveRelic(p, id);
      else if (ED.BOONS[id] && !ED.BOONS[id].gate) { p.boons[id] = (p.boons[id] || 0) + 1; w.recalc(p, false); }
    }
  }
  const rec = { flares: 0, gloomHits: 0, gloomSecs: 0, turn: {}, clears: [], bossTimes: [], dmgBy: {}, downedBy: [], dealtStrata: [], heal: {}, dmgByS: {}, spawns: {}, offers: {}, relicsBy: {}, goldIn: 0, roomDmg: 0, dmgStrata: [], healSrc: 'other' };
  rec.evoAt = null; // { s: stratum, lvl: team level } when hero 0 takes its evolution
  const p0id = w.players.keys().next().value;
  // damage metrics: hero damage by source per stratum, combat seconds, observed hits/time to kill, analytic hits to kill, cooldown reduction
  Object.assign(rec, { src: [], combatS: [0, 0, 0, 0, 0, 0], hits: [[], [], [], [], [], []], ttk: [[], [], [], [], [], []], ttkElite: [[], [], [], [], [], []], htk: [[], [], [], [], [], []], htkBare, bossTry: [] });
  const hit0 = w.hitEnemy;
  w.hitEnemy = function (e, base, src) {
    const d = hit0.call(this, e, base, src);
    if (!(d > 0)) return d;
    const k = (src && src.kind) || 'weapon', bucket = rec.src[this.stratum - 1] || (rec.src[this.stratum - 1] = { weapon: 0, skill: 0, storm: 0, status: 0, comp: 0, field: 0 });
    const direct = k !== 'dot' && k !== 'chain' && !(src && src.raw && k === 'explode');
    if (src && src.p) bucket[dmgSource(src, k)] += d;
    if (!e.boss && !e.def.minion) {
      if (e._t0 === undefined) { e._t0 = this.time; e._n = 0; }
      if (direct) e._n++;
      if (e.killed) { (e.elite ? rec.ttkElite : rec.ttk)[this.stratum - 1].push(this.time - e._t0); if (!e.elite) rec.hits[this.stratum - 1].push(e._n); }
    }
    return d;
  };
  // wrap hurtPlayer to attribute the damage that landed (armor, shield and dodge already applied) to the source foe
  const hurt0 = w.hurtPlayer;
  w.hurtPlayer = function (p, amount, src) {
    const n0 = this.fx.length, was = p.downed || p.dead;
    const r = hurt0.call(this, p, amount, src);
    const e = src && (src.e || (src.pr && src.pr.src));
    const who = e ? e.type : src && src.hazard ? (src.x !== undefined ? 'zone' : 'tile') : 'other';
    for (let i = n0; i < this.fx.length; i++) if (this.fx[i].t === 'hurt') { rec.dmgBy[who] = (rec.dmgBy[who] || 0) + this.fx[i].v; const bs = rec.dmgByS[this.stratum] || (rec.dmgByS[this.stratum] = {}); bs[who] = (bs[who] || 0) + this.fx[i].v; rec.roomDmg += this.fx[i].v; rec.dmgStrata[this.stratum - 1] = (rec.dmgStrata[this.stratum - 1] || 0) + this.fx[i].v; }
    if (who === 'gloom') rec.gloomHits++;
    if (!was && p.downed) rec.downedBy.push(who + '@s' + this.stratum);
    return r;
  };
  // heal totals by source: callers that heal are wrapped to label the amount healPlayer returns
  const heal0 = w.healPlayer;
  w.healPlayer = function (p, amt, silent) { const v = heal0.call(this, p, amt, silent); rec.heal[rec.healSrc] = (rec.heal[rec.healSrc] || 0) + v; return v; };
  for (const [fn, label] of [['heroProcs', 'hit'], ['tickStatuses', 'dot'], ['collect', 'pickup'], ['interact', 'prop'], ['killEnemy', 'kill'], ['onStratumBuild', 'stratum'], ['updatePlayerBuild', 'regen'], ['onEnemyKilledSkill', 'skillkill'], ['playerSkill', 'skill'], ['pickBoon', 'boon'], ['updateProjectiles', 'proj'], ['updateAllies', 'minion']]) {
    const f0 = w[fn];
    w[fn] = function (...a) { const prev = rec.healSrc; rec.healSrc = label; try { return f0.apply(this, a); } finally { rec.healSrc = prev; } };
  }
  const sus0 = w.sustainHeal; // capped combat sustain is labelled 'sus:' + the calling source
  w.sustainHeal = function (...a) { const prev = rec.healSrc; rec.healSrc = 'sus:' + prev; try { return sus0.apply(this, a); } finally { rec.healSrc = prev; } };
  // offers by source and relics by room type (room.type of the hero's room when the relic was taken)
  const spawn0 = w.spawnEnemy;
  w.spawnEnemy = function (type, x, y, o) { rec.spawns[type] = (rec.spawns[type] || 0) + 1; return spawn0.call(this, type, x, y, o); };
  const grant0 = w.grantOffer, give0 = w.giveRelic, drop0 = w.dropGold;
  w.grantOffer = function (p, spec) { const k = spec && spec.src === 'room' ? 'room' : spec && spec.src || 'level'; rec.offers[k] = (rec.offers[k] || 0) + 1; return grant0.call(this, p, spec); };
  w.giveRelic = function (p, id) { const k = this.room ? this.room.type : '?'; rec.relicsBy[k] = (rec.relicsBy[k] || 0) + 1; return give0.call(this, p, id); };
  w.dropGold = function (x, y, total) { rec.goldIn += Math.round(total); return drop0.call(this, x, y, total); };
  const ctl = {};
  for (const p of w.players.values()) ctl[p.pid] = { atk: 0, skill: 0, skill2: 0, dash: 0, goal: null, gl: {}, attn: true, attnT: 0 };
  const dt = 1 / 60;
  let steps = 0;
  const maxSteps = 60 * MAX_SECONDS;
  const log = [];
  const strata = []; // seconds spent per stratum
  let stratumStart = 0, bossStart = 0, dealt0 = 0;
  const totalDealt = () => { let d = 0; for (const p of w.players.values()) d += p.dealt; return d; };
  while (w.state !== 'over' && steps < maxSteps) {
    steps++;
    for (const p of w.players.values()) {
      const c = ctl[p.pid];
      c.atk -= dt; c.skill -= dt; c.skill2 -= dt; c.dash -= dt; c.goal = null;
      if (p.offer) { w.pickBoon(p.pid, pickIndex(p, p.offers[0], policy, brng, force)); }
      if (p.downed || p.dead) continue;
      let mx = 0, my = 0;
      const foes = w.enemies.filter(e => e.hp > 0 && e.spawnT <= 0 && !e.def.gloom);
      const glooms = w.enemies.filter(e => e.hp > 0 && e.def.gloom && e.spawnT <= 0);
      let gloom = null; // the nearest Gloom drives flare and keep-away
      for (const g of glooms) if (!gloom || U.dist2(g.x, g.y, p.x, p.y) < U.dist2(gloom.x, gloom.y, p.x, p.y)) gloom = g;
      if (gloom && c.attn && U.dist2(gloom.x, gloom.y, p.x, p.y) < 120 * 120 && !p.downed && w.flare(p)) rec.flares++; // lantern flare when the Gloom closes in on a tick the bot pays attention (needs the light; no flare while it is still far)
      const skill = opts.skill ?? 0.75;
      // the bot reads each Gloom lunge telegraph with probability `skill` (decided once per wind-up) and sidesteps the line of the nearest one it read
      let dg = null;
      for (const g of glooms) {
        if (g.st !== 'windup') { delete c.gl[g.id]; continue; }
        if (c.gl[g.id] === undefined) c.gl[g.id] = brng.next() < skill;
        if (c.gl[g.id] && U.dist2(g.x, g.y, p.x, p.y) < 260 * 260 && (!dg || U.dist2(g.x, g.y, p.x, p.y) < U.dist2(dg.x, dg.y, p.x, p.y))) dg = g;
      }
      if (foes.length) {
        let tgt = null, bd = 1e9;
        for (const e of foes) { const d = U.dist2(e.x, e.y, p.x, p.y); if (d < bd) { bd = d; tgt = e; } }
        const d = Math.sqrt(bd);
        const ideal = p.stats.melee ? (p.stats.weapon.range * 0.6 + tgt.r) : 170;
        let dir;
        if (d > ideal + 10) dir = bfsDir(w.room, w.locked, p.x, p.y, tgt.x, tgt.y);
        else if (d < ideal - 20) dir = [p.x - tgt.x, p.y - tgt.y];
        else dir = [-(tgt.y - p.y), tgt.x - p.x];
        // dodge projectiles
        let danger = false;
        for (const pr of w.projs) if (pr.team === 1 && U.dist2(pr.x, pr.y, p.x, p.y) < 55 * 55) { danger = true; dir = [dir[0] + (p.x - pr.x) * 2, dir[1] + (p.y - pr.y) * 2]; }
        for (const z of w.zones) if ((z.kind === 'tele' || z.kind === 'poison' || z.kind === 'fire') && z.team === 1 && U.dist2(z.x, z.y, p.x, p.y) < (z.r + 12) ** 2) { danger = true; dir = [p.x - z.x + dir[0] * 0.2, p.y - z.y + dir[1] * 0.2]; }
        if (gloom && U.dist2(gloom.x, gloom.y, p.x, p.y) < 90 * 90) { danger = true; dir = [p.x - gloom.x, p.y - gloom.y]; }
        if (dg) { danger = true; dir = sidestep(dg, p); }
        const l = Math.hypot(dir[0], dir[1]) || 1; mx = dir[0] / l; my = dir[1] / l;
        if (brng.next() > skill) { mx += (brng.next() - 0.5) * 1.5; my += (brng.next() - 0.5) * 1.5; }
        const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
        const inRange = p.stats.melee ? d - tgt.r < p.stats.weapon.range : d < 380;
        if (c.atk <= 0 && inRange) {
          w.playerAttack(p, a);
          c.atk = p.stats.atkInterval / (ED.Stats.attackRate ? ED.Stats.attackRate(p) : 1 + (p.tranceT > 0 ? p.stats.trance : 0));
        }
        if (c.skill <= 0 && d < 160) {
          const sk = ED.CLASSES[p.cls].skill;
          let data = null;
          if (sk === 'charge') { const e2 = ED.Sim.castMove(w.room, p.x, p.y, a, 150, p.r, w.locked); data = { x0: p.x, y0: p.y, x1: e2.x, y1: e2.y }; p.skillMove = { dx: Math.cos(a), dy: Math.sin(a), speed: 600, t: 0.25 }; }
          if (sk === 'step') { const e2 = ED.Sim.castMove(w.room, p.x, p.y, a, 140, p.r, w.locked); data = { x0: p.x, y0: p.y, x1: e2.x, y1: e2.y }; p.x = e2.x; p.y = e2.y; }
          w.playerSkill(p, a, data, 0); c.skill = p.stats.skillCd;
        }
        // second skill (L) runs on its own cooldown once heroes define one
        if (c.skill2 <= 0 && p.stats.skill2Cd && ED.CLASSES[p.cls].skill2 && d < 220) {
          w.playerSkill(p, a, { x: tgt.x, y: tgt.y }, 1); c.skill2 = p.stats.skill2Cd;
        }
        if (danger && c.dash <= 0 && brng.next() < skill * 0.5) { p.dashT = 0.17; p.dashDx = mx; p.dashDy = my; w.playerDash(p, mx, my); c.dash = p.stats.dashCd; }
      } else if (!w.locked) {
        // loot first, then the portal, then the next room to visit
        const pr = wantedProp(w, p);
        const portal = w.props.find(x => x.kind === 'portal' && !x.state);
        const goal = pr || portal; c.goal = goal;
        let dir = null;
        if (goal) {
          if (U.dist(goal.x, goal.y, p.x, p.y) < 40) w.interact(p.pid, goal.id);
          dir = bfsDir(w.room, w.locked, p.x, p.y, goal.x, goal.y);
        } else dir = exploreDir(w, p, rec, opts.exploreMin);

        if (gloom && U.dist2(gloom.x, gloom.y, p.x, p.y) < 110 * 110) {
          dir = [p.x - gloom.x, p.y - gloom.y];
          if (c.dash <= 0 && U.dist2(gloom.x, gloom.y, p.x, p.y) < 60 * 60) { const l2 = Math.hypot(dir[0], dir[1]) || 1; p.dashT = 0.17; p.dashDx = dir[0] / l2; p.dashDy = dir[1] / l2; w.playerDash(p, p.dashDx, p.dashDy); c.dash = p.stats.dashCd; }
        }
        if (dg) dir = sidestep(dg, p);
        if (dir) { const l = Math.hypot(dir[0], dir[1]) || 1; mx = dir[0] / l; my = dir[1] / l; }
      }
      // floor hazards: the bot watches the ground on a share `skill` of its ticks (redrawn every 0.25 s) and steers off or around hazard tiles
      if ((c.attnT -= dt) <= 0) { c.attn = brng.next() < skill; c.attnT = 0.25; }
      if (c.attn && (mx || my)) { const v = avoidHazard(w.room, p, mx, my); mx = v[0]; my = v[1]; }
      if (opts.trace) opts.trace(w, p, mx, my, foes, c);
      ED.Sim.movePlayer(p, { mx, my }, dt, w.room, w.locked, w.zones);
    }
    if (w.enemies.some(e => e.def.gloom && e.hp > 0)) rec.gloomSecs += dt;
    if (w.locked && w.stratum >= 1 && w.hostiles() > 0) rec.combatS[w.stratum - 1] += dt;
    w.update(dt);
    for (const ev of w.fx) {
      if (ev.t === 'room') rec.roomDmg = 0;
      if (ev.t === 'clear' && !ev.trial && w.room && w.room.type === 'combat') rec.htk[w.stratum - 1].push(hitsToKill(w, w.players.values().next().value, w.stratum));
      if (ev.t === 'evolve' && ev.pid === p0id && !rec.evoAt) rec.evoAt = { s: w.stratum, lvl: w.level };
      if (ev.t === 'bossSpawn') { bossStart = w.time; rec.bossTry.push({ s: w.stratum, tier: w.bossTier, kill: false }); }
      if (ev.t === 'bossDown') { rec.bossTry[rec.bossTry.length - 1].kill = true; rec.bossTimes[w.stratum] = Math.round(w.time - bossStart); log.push(`  boss ${ev.type} down in ${(w.time - bossStart).toFixed(0)}s (t=${U.fmtTime(w.time)}, lvl ${w.level})`); }
      if (ev.t === 'clear' && !ev.trial && w.room && (w.room.type === 'combat' || w.room.type === 'elite')) rec.clears.push({ s: w.stratum, type: w.room.type, t: Math.round(w.roomTime * 10) / 10, d: Math.round(100 * rec.roomDmg / Math.max(1, w.players.values().next().value.maxHp)) / 100 });
      if (ev.t === 'stratum') {
        const dealt = totalDealt();
        if (ev.s > 1) { strata.push(Math.round(w.time - stratumStart)); rec.dealtStrata.push(Math.round(dealt - dealt0)); log.push(`  stratum ${ev.s - 1} took ${(w.time - stratumStart).toFixed(0)}s`); }
        stratumStart = w.time; dealt0 = dealt;
      }
    }
    w.fx.length = 0; w.msgs.length = 0;
    if (w.roomTime > 150 && w.locked && !w.boss) { log.push('  STUCK in room ' + w.roomId + ' type ' + w.room.type + ' hostiles ' + w.hostiles()); break; }
    if (w.roomTime > 420 && !w.locked && w.state === 'play') { log.push('  IDLE in room ' + w.roomId + ' type ' + w.room.type); break; }
  }
  strata.push(Math.round(w.time - stratumStart));
  rec.dealtStrata.push(Math.round(totalDealt() - dealt0));
  const p0 = [...w.players.values()][0];
  const sum = w.summary ? w.summary() : null;
  return { flares: rec.flares, gloomHits: rec.gloomHits, gloomSecs: rec.gloomSecs, state: w.state, victory: w.victory, stratum: w.stratum, time: w.time, level: w.level, kills: w.run.kills, relics: p0.relics.length, log, sum, hp: p0.hp | 0, maxHp: p0.maxHp,
    rooms: { visited: w.run.roomsVisited, total: w.run.roomsTotal }, lightAtBoss: w.run.lightAtBoss.slice(), strata, light: w.light / w.lightMax,
    clears: rec.clears, dmgByS: rec.dmgByS, spawns: rec.spawns, heal: rec.heal, offers: rec.offers, relicsBy: rec.relicsBy, goldIn: rec.goldIn, dmgStrata: rec.dmgStrata, bossTimes: rec.bossTimes.slice(), turn: rec.turn, dmgBy: rec.dmgBy, downedBy: rec.downedBy, dealtStrata: rec.dealtStrata,
    evoAt: rec.evoAt, aff: ED.PATH_IDS.map(k => ED.pathAffinity(p0.boons, k)).sort((a, b) => b - a),
    bossTry: rec.bossTry, cls: p0.cls, main: ED.PATH_IDS.map(k => [k, ED.pathAffinity(p0.boons, k)]).sort((a, b) => b[1] - a[1])[0][0], heroes: players.length, bare: avg(players.map(p => bareDps(p.cls, p.weapon))), src: rec.src, combatS: rec.combatS, hits: rec.hits, ttk: rec.ttk, ttkElite: rec.ttkElite, htk: rec.htk, htkBare: rec.htkBare, cdr: p0.stats.cdr, cdrAfter: ED.Stats.cdrEff ? ED.Stats.cdrEff(p0.stats.cdr) : p0.stats.cdr,
    endRoom: w.room ? w.room.type : '', evo: p0.stats.evo || null, gates: ED.gatePaths(p0.boons), boonCount: Object.values(p0.boons).reduce((a, b) => a + b, 0), keystones: Object.keys(p0.boons).filter(id => ED.BOONS[id].key).length };
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

// One-block summary of a batch of runBot results: win rate, depth, pacing per stratum, lantern, damage sources.
function summarize(results) {
  const n = results.length, wins = results.filter(r => r.victory), S = [1, 2, 3, 4, 5, 6];
  const clear = (type, s) => avg(results.flatMap(r => r.clears.filter(c => c.type === type && (s === 0 || c.s === s)).map(c => c.t)));
  const bossT = (s) => avg(results.map(r => r.bossTimes[s]).filter(v => v !== undefined));
  const strataSum = [], strataN = [];
  let bossLight = 0, nBoss = 0, bossLightless = 0, vis = 0, tot = 0;
  const turns = [], dmg = {}, downed = {};
  let floors = 0, lanternEnded = 0;
  for (const r of results) {
    vis += r.rooms.visited; tot += r.rooms.total;
    for (const l of r.lightAtBoss) { bossLight += l; nBoss++; if (l <= 0) bossLightless++; }
    r.strata.forEach((t, k) => { strataSum[k] = (strataSum[k] || 0) + t; strataN[k] = (strataN[k] || 0) + 1; });
    for (const s in r.turn) { turns.push(r.turn[s].light); floors++; if (!r.turn[s].explored) lanternEnded++; }
    for (const k in r.dmgBy) dmg[k] = (dmg[k] || 0) + r.dmgBy[k];
    for (const k of r.downedBy.slice(0, 1)) downed[k.split('@')[0]] = (downed[k.split('@')[0]] || 0) + 1; // the first downing of each run
  }
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k);
  const dTot = Object.values(dmg).reduce((a, b) => a + b, 0) || 1;
  const lines = [];
  const hist = S.map(k => results.filter(r => !r.victory && r.stratum === k).length), atBoss = results.filter(r => !r.victory && r.endRoom === 'boss').length;
  lines.push(`deaths by stratum [${hist.join(' ')}] (${atBoss} of ${n - wins.length} at a boss)`);
  lines.push(`wins ${wins.length}/${n} (${(100 * wins.length / n).toFixed(0)}%) avg depth ${(avg(results.map(r => r.stratum))).toFixed(2)} avg time ${U.fmtTime(avg(results.map(r => r.time)))} winners ${wins.length ? U.fmtTime(avg(wins.map(r => r.time))) : '-'} lvl ${f1(avg(results.map(r => r.level)))} (winners ${wins.length ? f1(avg(wins.map(r => r.level))) : '-'})`);
  lines.push(`rooms visited ${(100 * vis / Math.max(1, tot)).toFixed(0)}% (${(vis / n).toFixed(1)}/run) light at boss ${nBoss ? (bossLight / nBoss).toFixed(2) : '-'} (Lightless ${bossLightless}/${nBoss}) light when heading for boss ${turns.length ? avg(turns).toFixed(2) : '-'} (lantern ended exploration on ${floors ? Math.round(100 * lanternEnded / floors) : 0}% of floors) avg stratum time [${strataSum.map((t, k) => U.fmtTime(t / strataN[k])).join(' ')}]`);
  lines.push(`clear s  combat [${S.map(s => f1(clear('combat', s))).join(' ')}] all ${f1(clear('combat', 0))}  elite [${S.map(s => f1(clear('elite', s))).join(' ')}] all ${f1(clear('elite', 0))}  boss [${S.map(s => f1(bossT(s))).join(' ')}]`);
  const flat = (key, s) => results.flatMap(r => r[key][s - 1]);
  const medClear = (type, s) => median(results.flatMap(r => r.clears.filter(c => c.type === type && c.s === s).map(c => c.t)));
  lines.push(`clear s median combat [${S.map(s => f1(medClear('combat', s))).join(' ')}] elite [${S.map(s => f1(medClear('elite', s))).join(' ')}]`);
  lines.push(`regular foe: weapon hits to kill [${S.map(s => f1(avg(flat('htk', s)))).join(' ')}] (start weapon, no boons, stratum I: ${f1(avg(results.map(r => r.htkBare)))}) | observed direct hits per kill [${S.map(s => f1(avg(flat('hits', s)))).join(' ')}] | time to kill s [${S.map(s => f1(median(flat('ttk', s)))).join(' ')}] | elite time to kill s median [${S.map(s => f1(median(flat('ttkElite', s)))).join(' ')}] mean [${S.map(s => f1(avg(flat('ttkElite', s)))).join(' ')}]`);
  const dpsRatio = (r, s) => { const d = r.src[s - 1] ? Object.values(r.src[s - 1]).reduce((a, b) => a + b, 0) : 0; return r.combatS[s - 1] >= 5 ? d / r.combatS[s - 1] / r.heroes / r.bare : NaN; };
  const dpsOf = (rs, s) => median(rs.map(r => dpsRatio(r, s)).filter(v => Number.isFinite(v)));
  lines.push(`hero dps x bare weapon (median, combat seconds only, overkill included) by stratum [${S.map(s => f1(dpsOf(results, s))).join(' ')}] | ${[...new Set(results.map(r => r.cls))].map(c => c + ' [' + S.map(s => f1(dpsOf(results.filter(r => r.cls === c), s))).join(' ') + ']').join(' ')}`);
  const share = (rs, from) => {
    const t = {}; let tot = 0;
    for (const r of rs) for (let i = from; i < 6; i++) if (r.src[i]) for (const k in r.src[i]) { t[k] = (t[k] || 0) + r.src[i][k]; tot += r.src[i][k]; }
    return ['weapon', 'skill', 'storm', 'status', 'comp', 'field'].map(k => k + ' ' + Math.round(100 * (t[k] || 0) / (tot || 1)) + '%').join(' ');
  };
  const stormRuns = results.filter(r => r.main === 'storm'), otherRuns = results.filter(r => r.main !== 'storm');
  lines.push(`damage share (all strata | strata IV-VI): all ${share(results, 0)} | ${share(results, 3)}`);
  lines.push(`  Storm-main builds (${stormRuns.length}) ${share(stormRuns, 0)} | ${share(stormRuns, 3)}; other builds (${otherRuns.length}) ${share(otherRuns, 0)} | ${share(otherRuns, 3)}`);
  lines.push('  by main path (strata IV-VI): ' + ED.PATH_IDS.map(k => { const rs = results.filter(r => r.main === k); return `${k} (${rs.length}) ${share(rs, 3)}`; }).join(' | '));
  const tries = results.flatMap(r => r.bossTry);
  lines.push('boss fights won by the lantern tier at the door (Bright/Dim/Dark/Lightless): ' + [0, 1, 2, 3].map(t => { const a = tries.filter(x => x.tier === t); return `${a.length ? Math.round(100 * a.filter(x => x.kill).length / a.length) : '-'}% of ${a.length}`; }).join(' | '));
  const cd = results.map(r => r.cdr);
  lines.push(`cooldown reduction at run end (raw stat): mean ${f2(avg(cd))} max ${f2(Math.max(...cd))} above 0.4 in ${Math.round(100 * cd.filter(v => v > 0.4).length / n)}% above 0.65 in ${Math.round(100 * cd.filter(v => v > 0.65).length / n)}% | effective after the soft cap mean ${f2(avg(results.map(r => r.cdrAfter)))}`);
  lines.push(`dealt/stratum [${S.map(s => Math.round(avg(results.map(r => r.dealtStrata[s - 1]).filter(v => v !== undefined)))).join(' ')}]  evo ${(100 * results.filter(r => r.evo).length / n).toFixed(0)}% keystones ${f1(avg(results.map(r => r.keystones)))} boons ${f1(avg(results.map(r => r.boonCount)))} relics ${f1(avg(results.map(r => r.relics)))}`);
  const dmgTot = {}, healTot = {};
  for (const r of results) { r.dmgStrata.forEach((v, i) => { dmgTot[i] = (dmgTot[i] || 0) + v; }); for (const k in r.heal) healTot[k] = (healTot[k] || 0) + r.heal[k]; }
  const hSum = Object.values(healTot).reduce((a, b) => a + b, 0) || 1;
  lines.push(`room dmg taken (fraction of max HP) combat ${f2(avg(results.flatMap(r => r.clears.filter(c => c.type === 'combat').map(c => c.d))))} elite ${f2(avg(results.flatMap(r => r.clears.filter(c => c.type === 'elite').map(c => c.d))))}; per run dmg taken ${Math.round(Object.values(dmg).reduce((a, b) => a + b, 0) / n)} healed ${Math.round(hSum / n)} (${top(healTot, 14).map(([k, v]) => k + ' ' + (100 * v / hSum).toFixed(0) + '%').join(', ')})`);
  const sumBy = (key) => { const o = {}; for (const r of results) for (const k in r[key]) o[k] = (o[k] || 0) + r[key][k] / n; return o; };
  const fmtO = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ');
  lines.push(`offers/run: ${fmtO(sumBy('offers'))} | relics by room: ${fmtO(sumBy('relicsBy'))} | gold earned ${Math.round(avg(results.map(r => r.goldIn)))}`);
  // build pacing: total offers, when the evolution lands (stratum / team level quartiles), evolved share of the runs that reach stratum IV, affinity spread
  const qs = (a) => { a = a.slice().sort((x, y) => x - y); return a.length ? [0.25, 0.5, 0.75].map(q => a[Math.min(a.length - 1, Math.floor(q * a.length))]).join(' ') : '-'; };
  const evolved = results.filter(r => r.evoAt), reachIV = results.filter(r => r.stratum >= 4), pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
  const avgOffers = avg(results.map(r => Object.values(r.offers).reduce((a, b) => a + b, 0)));
  const deep = (r, t) => r.aff.filter(v => v >= t).length, spread = (f) => [0, 1, 2, 3].map(k => pct(results.filter(r => f(r) === k).length, n)).join('/');
  lines.push(`pacing: offers/run ${f1(avgOffers)} (${f1(avgOffers / Math.max(1, avg(results.map(r => r.stratum))))} per stratum) | evolved ${pct(evolved.length, n)}% (${ED.PATH_IDS.map(k => k + " " + results.filter(r => r.evo === k).length).join(", ")}) at stratum [${qs(evolved.map(r => r.evoAt.s))}] team lvl [${qs(evolved.map(r => r.evoAt.lvl))}] | of ${reachIV.length} runs reaching IV: evolved ${pct(reachIV.filter(r => r.evo).length, reachIV.length)}% (by IV entry ${pct(reachIV.filter(r => r.evoAt && r.evoAt.s < 4).length, reachIV.length)}%) | affinity median top3 [${[0, 1, 2].map(i => qs(results.map(r => r.aff[i])).split(' ')[1]).join(' ')}] main-path lead (top - 2nd) quartiles [${qs(results.map(r => r.aff[0] - r.aff[1]))}] | runs with 0/1/2/3 paths at aff>=4: ${spread(r => deep(r, 4))}% at aff>=6: ${spread(r => deep(r, 6))}% | gates 0/1/2/3: ${spread(r => r.gates.length)}%`);
  lines.push(`damage taken ${top(dmg, 5).map(([k, v]) => `${k} ${(100 * v / dTot).toFixed(0)}%`).join(', ')}; first downed by ${top(downed, 5).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const byS = S.map(k => { const o = {}; for (const r of results) for (const who in (r.dmgByS[k] || {})) o[who] = (o[who] || 0) + r.dmgByS[k][who]; const t = Object.values(o).reduce((x, y) => x + y, 0) || 1; return `${k}: ` + Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([w, v]) => `${w} ${Math.round(100 * v / t)}%`).join(' '); });
  lines.push('damage taken by stratum: ' + byS.join(' | '));
  const downsAll = results.reduce((a, r) => a + r.downedBy.length, 0), downsGloom = results.reduce((a, r) => a + r.downedBy.filter(k => k.startsWith('gloom@')).length, 0);
  lines.push(`gloom: downs ${f2(downsGloom / n)}/run (${(100 * downsGloom / Math.max(1, downsAll)).toFixed(0)}% of ${f2(downsAll / n)} downs/run), damage ${(100 * (dmg.gloom || 0) / dTot).toFixed(0)}% of taken, flares ${f2(avg(results.map(r => r.flares)))}/run, Gloom out ${Math.round(avg(results.map(r => r.gloomSecs)))} s/run, ${f2(avg(results.map(r => r.gloomHits)))} touches/run`);
  return lines.join('\n');
}

// Hearth profile of a bot: none (fresh), mid (half the ranks, mastery 5) or max (every rank, mastery 10).
const metaProfile = (meta) => ({
  up: meta === 'max' ? ED.UPGRADES.map(u => u.costs.length) : meta === 'mid' ? ED.UPGRADES.map(u => Math.ceil(u.costs.length / 2)) : ED.UPGRADES.map(() => 0),
  mastery: meta === 'max' ? 10 : meta === 'mid' ? 5 : 1,
});

module.exports = { runBot, summarize, metaProfile, ED };
if (require.main === module) {
  const flags = {}, args = [];
  for (const a of process.argv.slice(2)) { const m = /^--([a-z0-9]+)(?:=(.*))?$/i.exec(a); if (m) flags[m[1]] = m[2] === undefined ? '1' : m[2]; else args.push(a); }
  const n = +(args[0] || 1), runs = +(args[1] || 5), skill = +(args[2] || 0.75), meta = args[3] || 'none';
  const cls = (args[4] && args[4] !== '-' ? args[4] : 'knight,ranger,pyro,shade,cleric,necro').split(','); // '-' = every hero
  const { up, mastery } = metaProfile(meta);
  const pick = flags.pick || process.env.PICK || 'random', seed0 = +(flags.seed0 || 1000), force = flags.force ? flags.force.split(',') : [];
  const results = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = runBot({ seed: seed0 + i * 7, n, cls: [cls[i % cls.length]].concat(cls), skill, up, pact: +(args[5] || 0), mastery, pick, force, exploreMin: flags.explore === undefined ? undefined : +flags.explore });
    results.push(r);
    if (!flags.quiet) {
      console.log(`run ${i} ${cls[i % cls.length]}: ${r.victory ? 'WIN' : r.state} stratum ${r.stratum} time ${U.fmtTime(r.time)} lvl ${r.level} kills ${r.kills} relics ${r.relics} rooms ${r.rooms.visited}/${r.rooms.total} lightAtBoss [${r.lightAtBoss.join(' ')}] strata [${r.strata.map(U.fmtTime).join(' ')}] (${Date.now() - t0}ms)`);
      for (const l of r.log) console.log(l);
    }
  }
  console.log(`\npick=${pick}${force.length ? ' force=' + force.join(',') : ''}\n` + summarize(results));
}
