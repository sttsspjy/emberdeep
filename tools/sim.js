// Usage: node tools/sim.js <heroes> <runs> <botSkill 0-1> <meta none|mid|max> [classes|-] [pact] [--pick=random|smart] [--force=id,id] [--seed0=N] [--explore=minLight] [--quiet]   (parallel batches: tools/simpool.js)
// Headless simulation harness: loads the game's sim files in a VM and drives bot heroes through full runs (deterministic per seed: the bot has its own seeded RNG).
// Bot policy: fight, claim room rewards, use rest sites and shops, then explore unvisited rooms nearest-first while the lantern
// is at least 30% full and head for the boss once it dims (the exploration/lantern trade-off).
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

const EXPLORE_MIN_LIGHT = 0.3; // below this light fraction the bot stops exploring and goes for the boss
const PER_HERO_REWARDS = ['class', 'forge', 'epic', 'vigor'];
const MAX_SECONDS = 60 * 60; // a run that is still going after an hour of game time counts as a loss
// Neutral boons in the order a sensible player takes them (damage and defence first).
const NEUTRAL_PREF = ['edge', 'quick', 'vigor', 'plating', 'focus', 'evade', 'wide', 'fleet', 'magnet', 'thorns', 'lightstep', 'bounty'];

function bfsDir(room, locked, sx, sy, tx, ty) {
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
      if (t === 0 || t === 4 || (t === 5 && !locked)) { prev[j] = i; q.push(j); }
    }
  }
  if (prev[g] < 0) return [tx - sx, ty - sy];
  let c = g;
  while (prev[c] !== s && c !== s) c = prev[c];
  const nx = (c % w + 0.5) * T, ny = (Math.floor(c / w) + 0.5) * T;
  return [nx - sx, ny - sy];
}

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

// Direction toward the next room to visit: nearest unvisited non-boss room while the lantern holds, else the boss. rec.turn[stratum] logs the light when it first heads for the boss.
function exploreDir(w, p, rec, minLight) {
  const room = w.room, fl = w.floor;
  const frac = w.lightMax ? w.light / w.lightMax : 1;
  const exploring = !w.lightMax || frac >= (minLight ?? EXPLORE_MIN_LIGHT);
  const unvisited = fl.rooms.some(r => !w.roomState[r.id].visited && r.type !== 'boss');
  const target = unvisited && exploring ? null : fl.boss;
  if (target !== null && rec && !rec.turn[w.stratum]) rec.turn[w.stratum] = { light: Math.round(frac * 100) / 100, explored: !unvisited };
  const prev = {}; prev[room.id] = -1; const q = [room.id]; let found = null;
  while (q.length) {
    const id = q.shift(); const r = fl.rooms[id];
    if (id !== room.id && ((target === null && !w.roomState[id].visited && r.type !== 'boss') || id === target)) { found = id; break; }
    for (const dd in r.doors) { const n = r.doors[dd]; if (n >= 0 && prev[n] === undefined) { if (fl.rooms[n].type === 'boss' && target === null) continue; prev[n] = id; q.push(n); } }
  }
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
  for (const id of opts.force || []) {
    for (const p of w.players.values()) {
      if (ED.RELICS[id]) w.giveRelic(p, id);
      else if (ED.BOONS[id] && !ED.BOONS[id].gate) { p.boons[id] = (p.boons[id] || 0) + 1; w.recalc(p, false); }
    }
  }
  const rec = { turn: {}, clears: [], bossTimes: [], dmgBy: {}, downedBy: [], dealtStrata: [], heal: {}, dmgByS: {}, spawns: {}, offers: {}, relicsBy: {}, goldIn: 0, roomDmg: 0, dmgStrata: [], healSrc: 'other' };
  // wrap hurtPlayer to attribute the damage that landed (armor, shield and dodge already applied) to the source foe
  const hurt0 = w.hurtPlayer;
  w.hurtPlayer = function (p, amount, src) {
    const n0 = this.fx.length, was = p.downed || p.dead;
    const r = hurt0.call(this, p, amount, src);
    const e = src && (src.e || (src.pr && src.pr.src));
    const who = e ? e.type : src && src.hazard ? (src.x !== undefined ? 'zone' : 'tile') : 'other';
    for (let i = n0; i < this.fx.length; i++) if (this.fx[i].t === 'hurt') { rec.dmgBy[who] = (rec.dmgBy[who] || 0) + this.fx[i].v; const bs = rec.dmgByS[this.stratum] || (rec.dmgByS[this.stratum] = {}); bs[who] = (bs[who] || 0) + this.fx[i].v; rec.roomDmg += this.fx[i].v; rec.dmgStrata[this.stratum - 1] = (rec.dmgStrata[this.stratum - 1] || 0) + this.fx[i].v; }
    if (!was && p.downed) rec.downedBy.push(who + '@s' + this.stratum);
    return r;
  };
  // heal totals by source: callers that heal are wrapped to label the amount healPlayer returns
  const heal0 = w.healPlayer;
  w.healPlayer = function (p, amt, silent) { const v = heal0.call(this, p, amt, silent); rec.heal[rec.healSrc] = (rec.heal[rec.healSrc] || 0) + v; return v; };
  for (const [fn, label] of [['leechHeal', 'leech'], ['collect', 'pickup'], ['interact', 'prop'], ['killEnemy', 'kill'], ['onStratumBuild', 'stratum'], ['updatePlayerBuild', 'regen'], ['onEnemyKilledSkill', 'skillkill'], ['playerSkill', 'skill'], ['pickBoon', 'boon'], ['updateProjectiles', 'proj'], ['updateAllies', 'minion']]) {
    const f0 = w[fn];
    w[fn] = function (...a) { const prev = rec.healSrc; rec.healSrc = label; try { return f0.apply(this, a); } finally { rec.healSrc = prev; } };
  }
  // offers by source and relics by room type (room.type of the hero's room when the relic was taken)
  const spawn0 = w.spawnEnemy;
  w.spawnEnemy = function (type, x, y, o) { rec.spawns[type] = (rec.spawns[type] || 0) + 1; return spawn0.call(this, type, x, y, o); };
  const grant0 = w.grantOffer, give0 = w.giveRelic, drop0 = w.dropGold;
  w.grantOffer = function (p, spec) { const k = spec && spec.src === 'room' ? 'room' : spec && spec.src || 'level'; rec.offers[k] = (rec.offers[k] || 0) + 1; return grant0.call(this, p, spec); };
  w.giveRelic = function (p, id) { const k = this.room ? this.room.type : '?'; rec.relicsBy[k] = (rec.relicsBy[k] || 0) + 1; return give0.call(this, p, id); };
  w.dropGold = function (x, y, total) { rec.goldIn += Math.round(total); return drop0.call(this, x, y, total); };
  const ctl = {};
  for (const p of w.players.values()) ctl[p.pid] = { atk: 0, skill: 0, skill2: 0, dash: 0, goal: null };
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
      const gloom = w.enemies.find(e => e.hp > 0 && e.def.gloom && e.spawnT <= 0);
      const skill = opts.skill ?? 0.75;
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
        if (dir) { const l = Math.hypot(dir[0], dir[1]) || 1; mx = dir[0] / l; my = dir[1] / l; }
      }
      if (opts.trace) opts.trace(w, p, mx, my, foes, c);
      ED.Sim.movePlayer(p, { mx, my }, dt, w.room, w.locked, w.zones);
    }
    w.update(dt);
    for (const ev of w.fx) {
      if (ev.t === 'room') rec.roomDmg = 0;
      if (ev.t === 'bossSpawn') bossStart = w.time;
      if (ev.t === 'bossDown') { rec.bossTimes[w.stratum] = Math.round(w.time - bossStart); log.push(`  boss ${ev.type} down in ${(w.time - bossStart).toFixed(0)}s (t=${U.fmtTime(w.time)}, lvl ${w.level})`); }
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
  return { state: w.state, victory: w.victory, stratum: w.stratum, time: w.time, level: w.level, kills: w.run.kills, relics: p0.relics.length, log, sum, hp: p0.hp | 0, maxHp: p0.maxHp,
    rooms: { visited: w.run.roomsVisited, total: w.run.roomsTotal }, lightAtBoss: w.run.lightAtBoss.slice(), strata, light: w.light / w.lightMax,
    clears: rec.clears, dmgByS: rec.dmgByS, spawns: rec.spawns, heal: rec.heal, offers: rec.offers, relicsBy: rec.relicsBy, goldIn: rec.goldIn, dmgStrata: rec.dmgStrata, bossTimes: rec.bossTimes.slice(), turn: rec.turn, dmgBy: rec.dmgBy, downedBy: rec.downedBy, dealtStrata: rec.dealtStrata,
    endRoom: w.room ? w.room.type : '', evo: p0.evo || null, gates: ED.gatePaths(p0.boons), boonCount: Object.values(p0.boons).reduce((a, b) => a + b, 0), keystones: Object.keys(p0.boons).filter(id => ED.BOONS[id].key).length };
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
  lines.push(`dealt/stratum [${S.map(s => Math.round(avg(results.map(r => r.dealtStrata[s - 1]).filter(v => v !== undefined)))).join(' ')}]  evo ${(100 * results.filter(r => r.evo).length / n).toFixed(0)}% keystones ${f1(avg(results.map(r => r.keystones)))} boons ${f1(avg(results.map(r => r.boonCount)))} relics ${f1(avg(results.map(r => r.relics)))}`);
  const dmgTot = {}, healTot = {};
  for (const r of results) { r.dmgStrata.forEach((v, i) => { dmgTot[i] = (dmgTot[i] || 0) + v; }); for (const k in r.heal) healTot[k] = (healTot[k] || 0) + r.heal[k]; }
  const hSum = Object.values(healTot).reduce((a, b) => a + b, 0) || 1;
  lines.push(`room dmg taken (fraction of max HP) combat ${f2(avg(results.flatMap(r => r.clears.filter(c => c.type === 'combat').map(c => c.d))))} elite ${f2(avg(results.flatMap(r => r.clears.filter(c => c.type === 'elite').map(c => c.d))))}; per run dmg taken ${Math.round(Object.values(dmg).reduce((a, b) => a + b, 0) / n)} healed ${Math.round(hSum / n)} (${top(healTot, 6).map(([k, v]) => k + ' ' + (100 * v / hSum).toFixed(0) + '%').join(', ')})`);
  const sumBy = (key) => { const o = {}; for (const r of results) for (const k in r[key]) o[k] = (o[k] || 0) + r[key][k] / n; return o; };
  const fmtO = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ');
  lines.push(`offers/run: ${fmtO(sumBy('offers'))} | relics by room: ${fmtO(sumBy('relicsBy'))} | gold earned ${Math.round(avg(results.map(r => r.goldIn)))}`);
  lines.push(`damage taken ${top(dmg, 5).map(([k, v]) => `${k} ${(100 * v / dTot).toFixed(0)}%`).join(', ')}; first downed by ${top(downed, 5).map(([k, v]) => `${k} ${v}`).join(', ')}`);
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
