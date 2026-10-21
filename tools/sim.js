// Usage: node tools/sim.js <heroes> <runs> <botSkill 0-1> <meta none|mid|max> [classes|-] [pact] [--pick=random|smart] [--start=random|class|generalist|rotate|<gateId>] [--gates=1|2] [--force=id[@slot],...]
//   [--route=attack|skill1|skill2|element|random|rotate] [--fork=0|1|random|rotate] [--weapon=0|1|2|rotate] [--mastery=smart|fork] [--aimnoise=<angle rad>,<point px>|0] [--seed0=N] [--explore=minLight] [--strata=N] [--out=rows.json] [--pair=rows.json] [--quiet]   (parallel batches: tools/simpool.js)
// Headless simulation harness: loads the game's sim files into this Node context and drives bot heroes through full runs (deterministic per seed: the bot has its own seeded RNG).
// Bot policy: fight, claim room rewards, use rest sites and shops, then explore unvisited rooms nearest-first while entering the next one
// (its light cost paid) leaves the lantern at least EXPLORE_MIN_LIGHT full, else head for the boss (the exploration/lantern trade-off).
// Pick policies: 'random' takes a random card; 'smart' (PICK=smart) follows the build order in smartScore (evolution > keystone > duo > own-path boon > element gate while a slot is free > open General > anything).
// Skill (0-1) is the share of ticks the bot pays attention (floor hazards, lantern flare) and the chance it reads a Gloom lunge telegraph; the rest of the time it moves on instinct.
// The summary reports win rate, pacing, hits and time to kill, hero DPS, damage share by source, cooldown reduction, the lantern/Gloom lines and the path lines (see summarize); every mean prints its standard error.
// --start: how the start offer is picked (default random: uniform over its cards; class: the class element's gate; a gate id or generalist forces that card; rotate: run i takes fire, ice, lightning, poison, holy, shadow, generalist in turn).
// --gates=1: a hero never takes a second element gate (mono-element arm).
// --force: gate ids (and generalist) replace the start pick, then are taken whenever offered; other boons and relics are granted at run start (a fork id also grants its route card). id@slot limits an id to one hero.
// --route / --fork: the class route card and fork (0 = Heavy / Burst / Focus, 1 = Swift / Guard / Spread) a hero takes (default random, seeded per run and hero). rotate cycles them over the runs so every class meets every route, fork and weapon in one batch:
//   route = floor(i / classes) mod 4, fork = floor(i / (classes x 4)) mod 2, weapon = floor(i / (classes x 4 x 2)) mod 3. --weapon picks the weapon index (default 0).
// --mastery: smart (default) scores a fork rank-up in the mastery offers like any card (rank 2: 700, rank 3: 760, below evolutions, keystones and duos); fork always takes the fork.
// Casting follows ED.SKILLS: aim 'dir' throws along the target angle, 'ground' lands on the foe, 'move' runs or blinks through it, 'self' fires around the hero; aim noise shrinks with the bot's skill (angle 0.12 rad, ground point 36 px at skill 0).
// --out=file.json writes one row per run (seed, class, depth, win, boss time to kill and HP lost per stratum, evolution stratum, main path, gates); --pair=file.json prints the mean difference to such a baseline for the same seeds.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src') + '/';
const files = ['util.js', 'data/biomes.js', 'data/enemies.js', 'data/classes.js', 'data/boons.js', 'data/classboons.js', 'data/relics.js', 'data/meta.js', 'save.js',
  'sim/dungeon.js', 'sim/stats.js', 'sim/world.js', 'sim/combat.js', 'sim/build.js', 'sim/skills.js', 'sim/class-knight.js', 'sim/class-ranger.js', 'sim/class-pyro.js', 'sim/class-shade.js', 'sim/class-cleric.js', 'sim/class-necro.js',
  'sim/ai.js', 'sim/bosses.js', 'sim/rooms.js', 'sim/sheet.js'];
// Main context, not vm.createContext: inside a vm context every global read (Math, Object, ...) goes through the context interceptor and the sim runs ~3x slower.
for (const f of files) vm.runInThisContext(fs.readFileSync(ROOT + f, 'utf8'), { filename: f });
const ED = globalThis.ED;
const U = ED.U, T = ED.CONST.TILE, D = ED.Dungeon;

const EXPLORE_MIN_LIGHT = 0.3; // the bot stops exploring when the next room would leave the lantern below this fraction, and goes for the boss
const PER_HERO_REWARDS = ['boon', 'forge', 'epic', 'vigor'];
const MAX_SECONDS = 60 * 60; // a run that is still going after an hour of game time counts as a loss
// Open General boons in the order a sensible player takes them (damage and defence first).
const NEUTRAL_PREF = ['edge', 'quick', 'keen', 'brutal', 'vigor', 'stalwart', 'plating', 'battleward', 'focus', 'evade', 'wide', 'mending', 'forager', 'fleet', 'magnet', 'thorns', 'lightstep', 'bounty'];

// First step toward (tx, ty): the shortest path that stays off floor hazards, else the shortest path (a hero walks around hazards when it can).
function bfsDir(room, locked, sx, sy, tx, ty) { return bfsStep(room, locked, sx, sy, tx, ty, true) || bfsStep(room, locked, sx, sy, tx, ty, false); }
// Walking distance to goal tile g (-1: unreachable) over the tiles a hero may enter (safe: hazards excluded); cached per room, lock state and goal (room tiles never change after floor generation).
const fields = new Map(); let fieldRoom = null;
function goalField(room, locked, g, safe) {
  if (room !== fieldRoom) { fields.clear(); fieldRoom = room; }
  const key = g * 4 + (locked ? 2 : 0) + (safe ? 1 : 0);
  let f = fields.get(key);
  if (f) return f;
  const w = room.w, n = w * room.h, tiles = room.tiles;
  const ok = (t) => t === 0 || (t === 4 && !safe) || (t === 5 && !locked);
  f = new Int32Array(n).fill(-1);
  if (ok(tiles[g])) {
    const q = new Int32Array(n); let qh = 0, qt = 0;
    f[g] = 0; q[qt++] = g;
    while (qh < qt) {
      const i = q[qh++], x = i % w, d = f[i] + 1;
      if (x > 0 && f[i - 1] < 0 && ok(tiles[i - 1])) { f[i - 1] = d; q[qt++] = i - 1; }
      if (x < w - 1 && f[i + 1] < 0 && ok(tiles[i + 1])) { f[i + 1] = d; q[qt++] = i + 1; }
      if (i - w >= 0 && f[i - w] < 0 && ok(tiles[i - w])) { f[i - w] = d; q[qt++] = i - w; }
      if (i + w < n && f[i + w] < 0 && ok(tiles[i + w])) { f[i + w] = d; q[qt++] = i + w; }
    }
  }
  if (fields.size >= 256) fields.clear();
  fields.set(key, f);
  return f;
}
// First step of the breadth-first path (neighbour order W, E, N, S): the first neighbour of s with the least distance to g.
function bfsStep(room, locked, sx, sy, tx, ty, safe) {
  const w = room.w, n = w * room.h;
  const s = Math.floor(sy / T) * w + Math.floor(sx / T), g = Math.floor(ty / T) * w + Math.floor(tx / T);
  if (s === g || s < 0 || s >= n || g < 0 || g >= n) return [tx - sx, ty - sy];
  const f = goalField(room, locked, g, safe), x = s % w;
  let c = -1, best = 1e9;
  if (x > 0 && f[s - 1] >= 0 && f[s - 1] < best) { best = f[s - 1]; c = s - 1; }
  if (x < w - 1 && f[s + 1] >= 0 && f[s + 1] < best) { best = f[s + 1]; c = s + 1; }
  if (s - w >= 0 && f[s - w] >= 0 && f[s - w] < best) { best = f[s - w]; c = s - w; }
  if (s + w < n && f[s + w] >= 0 && f[s + w] < best) { best = f[s + w]; c = s + w; }
  if (c < 0) return safe ? null : [tx - sx, ty - sy];
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

// Aim noise: Gaussian draws from the bot rng (Box-Muller), sigma = AIM_SIGMA x (1 - bot skill).
const AIM = [0.12, 36]; // sigma of the angle (rad) and of the ground point (px) at skill 0; --aimnoise=<A>,<P> sets them, --aimnoise=0 turns the noise off
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(U.TAU * rng.next());

// The movement a cast starts (a human's client does this): Shield Charge's run, a hop away from the target, a leap to the ground point; clipped at walls, untouchable for the move's i-frame window.
function startMove(w, p, N, a, data) {
  const mv = N.move;
  if (!mv) return;
  let dx, dy, dist, t = mv.t;
  if (mv.k === 'charge') { dist = Math.hypot(data.x1 - data.x0, data.y1 - data.y0); dx = Math.cos(a); dy = Math.sin(a); t = dist / mv.speed; }
  else if (mv.k === 'hop') { dx = Math.cos(a) * mv.dir; dy = Math.sin(a) * mv.dir; dist = mv.dist; }
  else if (mv.k === 'leap' && data && data.x !== undefined) { dist = Math.hypot(data.x - p.x, data.y - p.y); dx = (data.x - p.x) / (dist || 1); dy = (data.y - p.y) / (dist || 1); }
  if (!(dist > 4)) return;
  const end = ED.Sim.castMove(w.room, p.x, p.y, Math.atan2(dy, dx), dist, p.r, w.locked), real = Math.hypot(end.x - p.x, end.y - p.y);
  if (real < 4) return;
  p.skillMove = { dx: (end.x - p.x) / real, dy: (end.y - p.y) / real, speed: real / t, t, iframes: mv.iframes === undefined ? t : mv.iframes, age: 0 };
}

// Casts slot 0 or 1 of hero p at foe tgt (distance d, angle a) when the skill's aim allows it; returns whether it was cast. Route stats shape the choice: Scattershot casts Volley at close range, Assassinate steps to a wounded foe.
function botCast(w, p, slot, tgt, d, a, foes, brng, skill) {
  const st = p.stats, id = slot ? ED.CLASSES[p.cls].skill2 : ED.CLASSES[p.cls].skill;
  if (!id || !ED.CAST[id]) return false;
  const N = ED.Stats.skillNums(id, st), sA = AIM[0] * (1 - skill), sP = AIM[1] * (1 - skill);
  let data = null, ang = a;
  if (id === 'step' && st.assassinate) {
    let bd = N.range * N.range;
    for (const e of foes) if (e.hp < e.maxHp * 0.5) { const d2 = U.dist2(e.x, e.y, p.x, p.y); if (d2 < bd) { bd = d2; tgt = e; } }
    d = Math.sqrt(U.dist2(tgt.x, tgt.y, p.x, p.y)); a = ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
  }
  switch (N.aim) {
    case 'dir':
      if (id === 'shieldthrow') { if (d >= 240) return false; data = { d: Math.hypot(tgt.x - p.x, tgt.y - (p.y - 4)) }; } else if (d >= (id === 'volley' ? (st.volleyClose ? 110 : 160) : 220)) return false;
      ang = a + gauss(brng) * sA;
      break;
    case 'ground':
      if (d >= N.range) return false;
      data = { x0: p.x, y0: p.y, x: tgt.x + gauss(brng) * sP, y: tgt.y + gauss(brng) * sP };
      break;
    case 'move': {
      if (d >= N.range + 10) return false;
      const e2 = ED.Sim.castMove(w.room, p.x, p.y, a, U.clamp(d + 40, N.rangeMin, N.range), p.r, w.locked);
      data = { x0: p.x, y0: p.y, x1: e2.x, y1: e2.y };
      break;
    }
    default: { // self
      if (id === 'harvest') {
        const mine = w.allies.filter(q => q.owner === p.pid);
        if (mine.length ? !mine.some(m => foes.some(f => U.dist2(m.x, m.y, f.x, f.y) < (N.p.burst.r + f.r) ** 2)) : d >= 220) return false;
      } else {
        const q = N.parts.find(x => x.on && x.r > 0), reach = id === 'vanish' || !q ? 160 : q.r + tgt.r + 6;
        if (d >= reach) return false;
      }
    }
  }
  startMove(w, p, N, a, data);
  if (id === 'step') { p.x = data.x1; p.y = data.y1; }
  w.playerSkill(p, ang, data, slot);
  return true;
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
      case 'reward': s = PER_HERO_REWARDS.includes(x.item) ? (p.claimed[x.group] ? 0 : 9) : (x.item === 'oil' && lightFrac > 0.85 ? 3 : 9); break;
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

// Stratum (1-6) where an element is weak / resisted.
const weakStratum = (el) => ED.BIOMES.findIndex(b => b.weak === el) + 1, resistStratum = (el) => ED.BIOMES.findIndex(b => b.resist === el) + 1;

// Score of an element gate card: 500, +20 when the stratum that is weak to it is not behind us, -20 when the stratum that resists it is not, +30 when it is weak where an owned gate is resisted, plus seeded jitter 0-15.
function gateScore(p, el, stratum, rng) {
  let s = 500 + (weakStratum(el) >= stratum ? 20 : 0) - (resistStratum(el) >= stratum ? 20 : 0);
  if (ED.elementGates(p.boons).some(h => resistStratum(h) === weakStratum(el))) s += 30;
  return s + rng.next() * 15;
}

// Card score for the smart policy: evolution > keystone > duo > boon of an own path (deepest path first) > element gate while a slot is free (not for a Generalist) > open General > class > anything.
function smartScore(p, id, ctx, rng) {
  const b = ED.BOONS[id];
  if (b.evo) return 1000;
  const gen = ED.isGeneralist(p.boons), els = ED.elementGates(p.boons), aff = (k) => ED.pathAffinity(p.boons, k);
  const rar = b.rar === 'r' ? 3 : b.rar === 'e' ? 4 : 1;
  if (b.key) return 900 + aff(b.path);
  if (b.duo) return 850;
  if (b.path && !b.gate && (b.path === 'general' ? gen : els.includes(b.path))) return 600 + 10 * aff(b.path) + rar;
  if (b.gate) return !gen && b.path !== 'general' && els.length < ctx.gatesCap ? gateScore(p, b.path, ctx.w.stratum, rng) : 50; // over the --gates cap a gate is the last choice
  const n = NEUTRAL_PREF.indexOf(id);
  if (n >= 0) return 400 - n;
  if (b.route) return b.tier === 2 ? [650, 700, 760][Math.min(2, p.boons[id] || 0)] : 650; // a fork rank-up: rank 2 = 700, rank 3 = 760 (below evolutions 1000, keystones 900 and duos 850)
  if (b.cls) return 300 + rar;
  return 100 + rar;
}

// The start card a --start / --force request names for hero p, or null.
function wantedStart(p, ctx) {
  const st = ctx.start;
  if (!st || st === 'random') return null;
  if (st === 'class') return p.stats.element ? ED.PATH_GATE[p.stats.element] : null;
  return st === 'generalist' ? 'generalist' : ED.BOONS[st] && ED.BOONS[st].gate ? st : null;
}

// Index of the card to take. Start offer: the requested card, else uniform over the cards. Forge: rank up the boon of the most-invested path (stacked boons first); a forced gate is taken whenever it is offered;
// class cards follow --route / --fork when they carry such fields.
function pickIndex(p, spec, policy, rng, ctx) {
  const offer = p.offer, src = spec && spec.src;
  for (const f of ctx.force) { if (f.slot !== null && f.slot !== p.slot) continue; const i = offer.indexOf(f.id); if (i >= 0) return i; }
  if (src === 'start') {
    const want = wantedStart(p, ctx), i = want ? offer.indexOf(want) : -1;
    return i >= 0 ? i : Math.floor(rng.next() * offer.length);
  }
  if (src === 'class') { // route card, then the fork of that route; mastery offers take the fork with --mastery=fork, else score every card
    const ct = spec.ctier | 0;
    if (ct === 1) { const i = offer.findIndex(id => ED.BOONS[id].route === p.botRoute); if (i >= 0) return i; }
    if (ct === 2) { const i = offer.indexOf(ED.CLASS_CARDS[p.cls][p.botRoute].forks[p.botFork]); if (i >= 0) return i; }
    if (ct === 3 && ctx.cardMastery === 'fork' && ED.BOONS[offer[0]].route) return 0;
  }
  if (policy !== 'smart') return Math.floor(rng.next() * offer.length);
  const forge = src === 'forge';
  let best = 0, bs = -1e9;
  offer.forEach((id, i) => {
    const b = ED.BOONS[id];
    const s = forge ? (b.route && b.tier === 2 && (p.boons[id] || 0) === 2 ? 10000 : b.path ? 100 * ED.pathAffinity(p.boons, b.path) + 10 * (p.boons[id] || 0) + (b.key ? 5 : 0) : (p.boons[id] || 0)) : smartScore(p, id, ctx, rng); // forge: a fork rank-up that reaches rank 3 first
    const sc = s + rng.next() * 0.5;
    if (sc > bs) { bs = sc; best = i; }
  });
  return best;
}

// Damage-report buckets: weapon (swings, shots, blasts, evolution strikes), skill, minion, dash, one per element (fire: burn ticks, combust, Firedamp; ice: shatter, Thermal Shock, Black Ice; lightning: arcs, bolts, Wrath bolts;
// poison: acid; holy: Smites, Beacon, lance, retribution; shadow: Tolls, Reaper blasts, Reap health), bleed, ground fields.
const BUCKETS = ['weapon', 'skill', 'minion', 'dash', 'fire', 'ice', 'lightning', 'poison', 'holy', 'shadow', 'bleed', 'field'];
const BUCKET_KIND = { thermal: 'ice', blackice: 'ice', firedamp: 'fire', reaper: 'shadow', toll: 'shadow', wrath: 'lightning', smite: 'holy', retribution: 'holy', chain: 'lightning' };
const PAYOFF_KINDS = new Set(['chain', 'thermal', 'blackice', 'firedamp', 'reaper', 'toll', 'wrath', 'smite', 'retribution']);
function dmgSource(src, k) {
  if (k === 'minion') return 'minion';
  if (k === 'skill') return 'skill';
  if (k === 'dash') return 'dash';
  if (src.bleed) return 'bleed';
  if (BUCKET_KIND[k]) return BUCKET_KIND[k];
  if (k === 'dot' && !src.raw) return 'field';
  return src.el && BUCKETS.includes(src.el) ? src.el : 'weapon';
}

const median = (a) => { if (!a.length) return NaN; a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };

// One paired-measurement row of a finished run (--out/--pair): depth = bosses beaten + the share of the death stratum's combat and elite rooms cleared, boss time to kill and HP lost per stratum (fraction of max HP).
function rowOf(r, label, seed) {
  const kills = r.bossTry.filter(b => b.kill).length, ROOMS = [6, 6, 7, 8, 8, 8];
  const inS = r.clears.filter(c => c.s === r.stratum).length;
  const depth = r.victory ? 6 : kills + Math.min(1, inS / ROOMS[Math.max(0, r.stratum - 1)]);
  return { label, seed, cls: r.cls, route: r.route.route, fork: r.route.fork, rank: r.route.rank, wi: r.wi, win: r.victory ? 1 : 0, depth: Math.round(depth * 1000) / 1000, bossTtk: [1, 2, 3, 4, 5, 6].map(s => r.bossTimes[s] === undefined ? null : r.bossTimes[s]),
    hpLost: [1, 2, 3, 4, 5, 6].map(s => r.dmgStrata[s - 1] === undefined ? null : Math.round(1000 * r.dmgStrata[s - 1] / Math.max(1, r.maxHp)) / 1000), evoS: r.evoAt ? r.evoAt.s : null, main: r.main, gates: r.gates.length, gen: r.gen ? 1 : 0 };
}

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
  AIM[0] = opts.aimNoise ? opts.aimNoise[0] : 0.12; AIM[1] = opts.aimNoise ? opts.aimNoise[1] : 36;
  const forced = (opts.force || []).map(f => { const m = /^([a-z_]+)(?:@(\d+))?$/.exec(f); return m ? { id: m[1], slot: m[2] === undefined ? null : +m[2] } : null; }).filter(Boolean);
  const ctx = { force: forced.filter(f => ED.BOONS[f.id] && ED.BOONS[f.id].gate), gatesCap: opts.gates || 2, start: opts.start || 'random', cardMastery: opts.cardMastery || 'smart', w: null };
  const players = [];
  for (let i = 0; i < opts.n; i++) {
    const cls = opts.cls[i % opts.cls.length];
    players.push({ pid: 'p' + i, name: 'Bot' + i, slot: i, cls, weapon: ED.CLASSES[cls].weapons[opts.weapon || 0],
      meta: { up: opts.up || ED.UPGRADES.map(() => 0), mastery: opts.mastery || 1, relics: ED.RELIC_IDS.filter(id => ED.RELICS[id].start) } });
  }
  const w = new ED.World({ seed: opts.seed, pact: opts.pact || 0, players, tutorial: opts.tutorial });
  ctx.w = w;
  w.startRun();
  for (const p of w.players.values()) { // route and fork of each hero: the flags, else seeded uniform per run and hero
    const rr = U.RNG((opts.seed ^ 0x5a17 ^ Math.imul(p.slot + 1, 7919)) >>> 0);
    const r1 = Math.floor(rr.next() * 4), f1 = Math.floor(rr.next() * 2);
    p.botRoute = ED.ROUTES.includes(opts.route) ? opts.route : ED.ROUTES[r1];
    p.botFork = opts.fork === 0 || opts.fork === 1 ? opts.fork : f1;
  }
  const htkBare = hitsToKill(w, w.players.values().next().value, 1);
  // the requested start card (first forced gate, else --start=<gate|generalist>) replaces the start pick; a Generalist card exists only for heroes without a class element
  for (const p of w.players.values()) {
    const f = ctx.force.find(x => x.slot === null || x.slot === p.slot), id = f ? f.id : ctx.start === 'generalist' || (ED.BOONS[ctx.start] && ED.BOONS[ctx.start].gate) ? ctx.start : null;
    if (id && p.offers.length && p.offers[0].src === 'start' && (id !== 'generalist' || !p.stats.element)) { p.offer = [id]; w.pickBoon(p.pid, 0); }
  }
  for (const f of forced) {
    for (const p of w.players.values()) {
      if (f.slot !== null && f.slot !== p.slot) continue;
      if (ED.RELICS[f.id]) w.giveRelic(p, f.id);
      else if (ED.BOONS[f.id] && !ED.BOONS[f.id].gate) {
        const b = ED.BOONS[f.id];
        if (b.route) { if (b.cls !== p.cls) continue; if (b.tier === 2) p.boons[ED.CLASS_CARDS[p.cls][b.route].t1] = 1; } // a fork id also grants its route card
        p.boons[f.id] = (p.boons[f.id] || 0) + 1; w.recalc(p, false);
      }
    }
  }
  const rec = { flares: 0, gloomHits: 0, gloomSecs: 0, turn: {}, clears: [], bossTimes: [], dmgBy: {}, downedBy: [], dealtStrata: [], heal: {}, dmgByS: {}, spawns: {}, offers: {}, relicsBy: {}, goldIn: 0, roomDmg: 0, dmgStrata: [], hpFrac: [], healSrc: 'other' };
  rec.evoAt = null; // { s: stratum, lvl: team level } when hero 0 takes its evolution
  rec.keyAt = null; rec.duoAt = null; // stratum when hero 0 takes its keystone / duo
  rec.cnt = { smite: 0, reap: 0, toll: 0, lance: 0, dashHits: 0, reapHp: 0, kills0: 0, refunds: 0, parries: 0, staggers: 0, rics: 0, gRics: 0, catches: 0, casts: {} };
  rec.parts = {}; rec.projDmgS = []; rec.maxHost = 0; // damage by skill part / source, hero damage taken from shots per stratum (fraction of max HP), most foes standing in the current room
  rec.smokeSeen = new Set(); rec.upt = { brace: [0, 0], sanct: [0, 0], stun: [0, 0], smoke: [0, 0, 0], mom: [0, 0] }; rec.peak = { projs: 0, zones: 0 }; // uptimes as [on, of] tick counts, peak shots and zones of hero 0
  rec.venom = { own: 0, ally: 0, corrode: 0, base: 0 }; // damage added by the Venom vulnerability, split by who dealt it, and the corrode part of it
  rec.shield = { gained: {}, absorbed: {}, holyBoss: 0 }; rec.bossSecs = 0;
  const shMix = new Map(); for (const p of w.players.values()) shMix.set(p.pid, {}); // shield composition per hero by source (absorption is attributed pro rata)
  const p0id = w.players.keys().next().value;
  // damage metrics: hero damage by source per stratum, combat seconds, observed hits/time to kill, analytic hits to kill, cooldown reduction
  Object.assign(rec, { src: [], combatS: [0, 0, 0, 0, 0, 0], hits: [[], [], [], [], [], []], ttk: [[], [], [], [], [], []], ttkElite: [[], [], [], [], [], []], htk: [[], [], [], [], [], []], htkBare, bossTry: [] });
  const hit0 = w.hitEnemy, VAMP = ED.CONST.VENOM_AMP, VALLY = ED.CONST.VENOM_ALLY;
  w.hitEnemy = function (e, base, src) {
    // Venom term of the vulnerability sum, read before the hit (the hit may clear it): its share of the damage dealt is the bonus Venom added
    const sp = src && src.p, vTerm = sp && e.venom > 0 ? e.venom / 100 * (VAMP + e.corrode) * ((e.venomBy & (1 << sp.slot)) ? 1 : VALLY) * (sp.stats.cryotoxin && e.frozen > 0 ? 2 : 1) : 0;
    const mine = vTerm > 0 && (e.venomBy & (1 << sp.slot)) ? 1 : 0, cor = vTerm > 0 ? e.corrode / (VAMP + e.corrode) : 0;
    const vTot = vTerm > 0 ? 1 + vTerm + (e.mark > 0 ? e.markV : 0) + (e.judged > 0 || e.vulnT > 0 ? 0.2 : 0) + (e.frozen > 0 ? 0.25 : 0) + (e.sunder && e.sunderOwner === sp.pid ? 0.04 * e.sunder : 0) : 1;
    const sg0 = e.staggerT, d = hit0.call(this, e, base, src);
    if (!(d > 0)) return d;
    if (e.staggerT > sg0 + 0.5) rec.cnt.staggers++;
    const k = (src && src.kind) || 'weapon', bucket = rec.src[this.stratum - 1] || (rec.src[this.stratum - 1] = Object.fromEntries(BUCKETS.map(b => [b, 0])));
    const direct = k !== 'dot' && !PAYOFF_KINDS.has(k) && !(src && src.raw && k === 'explode');
    if (src && src.p) { bucket[dmgSource(src, k)] += d; const pn = src.part || (src.wpn ? 'weapon' : k); rec.parts[pn] = (rec.parts[pn] || 0) + d; }
    if (k === 'dash') rec.cnt.dashHits++;
    if (src && src.p) { rec.venom.base += d; if (vTerm > 0) { const bonus = d * vTerm / vTot; if (mine) rec.venom.own += bonus; else rec.venom.ally += bonus; rec.venom.corrode += bonus * cor; } }
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
    const n0 = this.fx.length, was = p.downed || p.dead, sh0 = p.shield;
    const r = hurt0.call(this, p, amount, src);
    const e = src && (src.e || (src.pr && src.pr.src));
    const who = e ? e.type : src && src.hazard ? (src.x !== undefined ? 'zone' : 'tile') : 'other';
    for (let i = n0; i < this.fx.length; i++) if (this.fx[i].t === 'hurt') { rec.dmgBy[who] = (rec.dmgBy[who] || 0) + this.fx[i].v; const bs = rec.dmgByS[this.stratum] || (rec.dmgByS[this.stratum] = {}); bs[who] = (bs[who] || 0) + this.fx[i].v; rec.roomDmg += this.fx[i].v; rec.dmgStrata[this.stratum - 1] = (rec.dmgStrata[this.stratum - 1] || 0) + this.fx[i].v; rec.hpFrac[this.stratum - 1] = (rec.hpFrac[this.stratum - 1] || 0) + this.fx[i].v / p.maxHp; if (src && (src.proj || src.pr)) rec.projDmgS[this.stratum - 1] = (rec.projDmgS[this.stratum - 1] || 0) + this.fx[i].v / p.maxHp; }
    if (sh0 > p.shield) { // shield absorbed this hit: attribute it to the sources in the shield's make-up
      const ab = sh0 - p.shield, mix = shMix.get(p.pid);
      let tot = 0; for (const k in mix) tot += mix[k];
      for (const k in mix) { const take = tot > 0 ? ab * mix[k] / tot : 0; mix[k] -= take; rec.shield.absorbed[k] = (rec.shield.absorbed[k] || 0) + take; if (k === 'holy' && this.boss) rec.shield.holyBoss += take / p.maxHp; }
    }
    if (who === 'gloom') rec.gloomHits++;
    if (!was && p.downed) rec.downedBy.push(who + '@s' + this.stratum);
    return r;
  };
  // shield make-up by source: gains (addShield, the boss door) add to it, decay scales it
  const add0 = w.addShield, door0 = w.bossLantern, dec0 = w.updateShields, reap0 = w.checkReap;
  w.addShield = function (p, amt, cap, k) { const g = add0.call(this, p, amt, cap, k); if (g > 0) { const m = shMix.get(p.pid); m[k] = (m[k] || 0) + g; rec.shield.gained[k] = (rec.shield.gained[k] || 0) + g; } return g; };
  w.bossLantern = function () {
    const before = [...this.players.values()].map(p => p.shield || 0);
    door0.call(this);
    let i = 0;
    for (const p of this.players.values()) { const g = (p.shield || 0) - before[i++]; if (g > 0) { const m = shMix.get(p.pid); m.door = (m.door || 0) + g; rec.shield.gained.door = (rec.shield.gained.door || 0) + g; } }
  };
  w.updateShields = function (dt) {
    const before = [...this.players.values()].map(p => p.shield);
    dec0.call(this, dt);
    let i = 0;
    for (const p of this.players.values()) { const b = before[i++]; if (b > 0 && p.shield < b) { const f = p.shield / b, m = shMix.get(p.pid); for (const k in m) m[k] *= f; } }
  };
  // a Reap kills without a hitEnemy call: its health counts as shadow damage
  w.checkReap = function (e) { const hp = e.hp; reap0.call(this, e); if (e.killed && hp > 0 && e.doomOwner) { rec.cnt.reapHp += hp; const bk = rec.src[this.stratum - 1] || (rec.src[this.stratum - 1] = Object.fromEntries(BUCKETS.map(b => [b, 0]))); bk.shadow += hp; } };
  // heal totals by source: callers that heal are wrapped to label the amount healPlayer returns
  const heal0 = w.healPlayer;
  w.healPlayer = function (p, amt, silent) { const v = heal0.call(this, p, amt, silent); rec.heal[rec.healSrc] = (rec.heal[rec.healSrc] || 0) + v; return v; };
  for (const [fn, label] of [['heroProcs', 'hit'], ['tickStatuses', 'dot'], ['collect', 'pickup'], ['interact', 'prop'], ['killEnemy', 'kill'], ['onStratumBuild', 'stratum'], ['updatePlayerBuild', 'regen'], ['onEnemyKilledSkill', 'skillkill'], ['playerSkill', 'skill'], ['pickBoon', 'boon'], ['updateProjectiles', 'proj'], ['updateAllies', 'minion']]) {
    const f0 = w[fn];
    w[fn] = function (...a) { const prev = rec.healSrc; rec.healSrc = label; try { return f0.apply(this, a); } finally { rec.healSrc = prev; } };
  }
  // offers by source and relics by room type (room.type of the hero's room when the relic was taken)
  const spawn0 = w.spawnEnemy;
  w.spawnEnemy = function (type, x, y, o) { rec.spawns[type] = (rec.spawns[type] || 0) + 1; return spawn0.call(this, type, x, y, o); };
  const grant0 = w.grantOffer, give0 = w.giveRelic, drop0 = w.dropGold;
  w.grantOffer = function (p, spec) { const k = spec && spec.src === 'room' ? 'room' : spec && spec.src || 'level'; rec.offers[k] = (rec.offers[k] || 0) + 1; return grant0.call(this, p, spec); };
  w.giveRelic = function (p, id) { const k = this.room ? this.room.type : '?'; rec.relicsBy[k] = (rec.relicsBy[k] || 0) + 1; return give0.call(this, p, id); };
  w.dropGold = function (x, y, total, exact) { rec.goldIn += Math.round(exact ? total : total * ED.World.GOLD_MUL); return drop0.call(this, x, y, total, exact); };
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
      if (p.offer) { w.pickBoon(p.pid, pickIndex(p, p.offers[0], policy, brng, ctx)); }
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
        const ideal = p.stats.melee ? (p.stats.weapon.range * 0.6 + tgt.r) : (p.stats.deadeye ? 230 : 170); // Deadeye keeps its distance
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
        const a = Math.atan2(tgt.y - p.y, tgt.x - p.x), st = p.stats;
        const inRange = st.melee ? d - tgt.r < st.weapon.range : d < 380;
        if (st.channel && (c.holdT = (c.holdT || 0) - dt) <= 0) { c.hold = brng.next() < skill; c.holdT = 0.5; } // Pyroclast: the choice to stand still is renewed every 0.5 s (a roll per tick would break Channel within a few ticks)
        if (st.channel && !danger && inRange && c.hold) { mx = 0; my = 0; } // plant the feet while nothing threatens
        if (c.atk <= 0 && inRange) {
          w.playerAttack(p, a + gauss(brng) * AIM[0] * (1 - skill));
          c.atk = Math.max(c.atk, -dt) + ED.Stats.attackInterval(p); // carries the overshoot of this tick, as the client does
        }
        if (c.skill <= 0 && botCast(w, p, 0, tgt, d, a, foes, brng, skill)) c.skill = st.skillCd;
        if (c.skill2 <= 0 && st.skill2Cd && botCast(w, p, 1, tgt, d, a, foes, brng, skill)) c.skill2 = st.skill2Cd;
        if (danger && c.dash <= 0 && brng.next() < skill * 0.5) { p.dashT = 0.17; p.dashDx = mx; p.dashDy = my; w.playerDash(p, mx, my); c.dash = p.stats.dashCd; }
        else if (!danger && c.dash <= 0 && d <= 90 && (p.stats.dashDmg || p.stats.dashFire || p.stats.dashFrost || p.stats.dashBomb) && brng.next() < skill * 0.5) { // dash rider: dash through the target
          const l2 = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1, ddx = (tgt.x - p.x) / l2, ddy = (tgt.y - p.y) / l2;
          p.dashT = 0.17; p.dashDx = ddx; p.dashDy = ddy; w.playerDash(p, ddx, ddy); c.dash = p.stats.dashCd;
        }
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
    if (w.boss && w.boss.hp > 0) rec.bossSecs += dt;
    w.update(dt);
    if (w.locked) rec.maxHost = Math.max(rec.maxHost, w.hostiles());
    if (w.locked && w.hostiles() > 0) { // uptimes while a fight is on, hero 0
      const h0 = w.players.get(p0id), u = rec.upt;
      u.brace[1]++; if (h0.braceT > 0) u.brace[0]++;
      u.sanct[1]++; for (const z of w.zones) if (z.kind === 'sanct' && U.dist2(z.x, z.y, h0.x, h0.y) < z.r * z.r) { u.sanct[0]++; break; }
      u.mom[1]++; u.mom[0] += h0.momN | 0;
      for (const e of w.enemies) if (e.hp > 0 && !e.boss && !e.elite && e.spawnT <= 0 && !e.def.gloom) { u.stun[1]++; if (e.stun > 0) u.stun[0]++; }
      for (const z of w.zones) if (z.kind === 'smoke' && z.owner === p0id) for (const e of w.enemies) if (e.hp > 0 && !e.boss && e.spawnT <= 0 && U.dist2(z.x, z.y, e.x, e.y) < (z.r + e.r) ** 2) { // blind seconds per foe per smoke, as a share of Vanish's cooldown
        const key = z.id + ':' + e.id;
        if (!rec.smokeSeen.has(key)) { rec.smokeSeen.add(key); u.smoke[1]++; u.smoke[2] += ED.Stats.skillNums('vanish', h0.stats).cdEff; }
        if (e.blind > 0) u.smoke[0] += dt;
      }
    }
    if (w.tick % 6 === 0) {
      let np = 0, nz = 0;
      for (const pr of w.projs) if (pr.team === 0 && pr.owner === p0id && !pr.ghost) np++;
      for (const z of w.zones) if (z.owner === p0id && z.team === 0) nz++;
      if (np > rec.peak.projs) rec.peak.projs = np; if (nz > rec.peak.zones) rec.peak.zones = nz;
    }
    for (const m of w.msgs) if (m.t === 'refund' && ctl[m.to]) { const k = ctl[m.to]; rec.cnt.refunds++; if (m.slot === 1) k.skill2 = m.s ? k.skill2 - m.s : 0; else k.skill = m.s ? k.skill - m.s : 0; } // cooldown refunds { slot, s }
    for (const ev of w.fx) {
      if (ev.t === 'smite') rec.cnt.smite++; else if (ev.t === 'reap') rec.cnt.reap++; else if (ev.t === 'toll') rec.cnt.toll++; else if (ev.t === 'lance') rec.cnt.lance++;
      else if (ev.t === 'parry') rec.cnt.parries++;
      else if (ev.t === 'ric' && ev.pid === p0id) { rec.cnt.rics++; if (ev.g) rec.cnt.gRics++; } else if (ev.t === 'catch' && ev.pid === p0id) rec.cnt.catches++;
      else if (ev.t === 'skill' && ev.pid === p0id) rec.cnt.casts[ev.k] = (rec.cnt.casts[ev.k] || 0) + 1;
      if (ev.t === 'boon' && ev.pid === p0id) { const b = ED.BOONS[ev.id]; if (b.key && !rec.keyAt) rec.keyAt = w.stratum; if (b.duo && !rec.duoAt) rec.duoAt = w.stratum; }
      if (ev.t === 'room') { rec.roomDmg = 0; rec.maxHost = 0; }
      if (ev.t === 'clear' && !ev.trial && w.room && w.room.type === 'combat') rec.htk[w.stratum - 1].push(hitsToKill(w, w.players.values().next().value, w.stratum));
      if (ev.t === 'evolve' && ev.pid === p0id && !rec.evoAt) rec.evoAt = { s: w.stratum, lvl: w.level };
      if (ev.t === 'bossSpawn') { bossStart = w.time; rec.bossTry.push({ s: w.stratum, tier: w.bossTier, kill: false }); }
      if (ev.t === 'bossDown') { rec.bossTry[rec.bossTry.length - 1].kill = true; rec.bossTimes[w.stratum] = Math.round(w.time - bossStart); log.push(`  boss ${ev.type} down in ${(w.time - bossStart).toFixed(0)}s (t=${U.fmtTime(w.time)}, lvl ${w.level})`); }
      if (ev.t === 'clear' && !ev.trial && w.room && (w.room.type === 'combat' || w.room.type === 'elite')) rec.clears.push({ s: w.stratum, type: w.room.type, t: Math.round(w.roomTime * 10) / 10, d: Math.round(1000 * rec.roomDmg / Math.max(1, w.players.values().next().value.maxHp)) / 1000, n: rec.maxHost });
      if (ev.t === 'stratum') {
        const dealt = totalDealt();
        if (ev.s > 1) { strata.push(Math.round(w.time - stratumStart)); rec.dealtStrata.push(Math.round(dealt - dealt0)); log.push(`  stratum ${ev.s - 1} took ${(w.time - stratumStart).toFixed(0)}s`); }
        stratumStart = w.time; dealt0 = dealt;
      }
    }
    w.fx.length = 0; w.msgs.length = 0;
    if (w.roomTime > 150 && w.locked && !w.boss) { log.push('  STUCK in room ' + w.roomId + ' type ' + w.room.type + ' hostiles ' + w.hostiles()); break; }
    if (w.roomTime > 420 && !w.locked && w.state === 'play') { log.push('  IDLE in room ' + w.roomId + ' type ' + w.room.type); break; }
    if (opts.maxStratum && w.stratum > opts.maxStratum) break; // --strata=N: stop on entering stratum N+1 (strata 1..N play out exactly as in a full run)
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
    endRoom: w.room ? w.room.type : '', evo: p0.stats.evo || null, gates: ED.gatePaths(p0.boons), boonCount: Object.values(p0.boons).reduce((a, b) => a + b, 0), keystones: Object.keys(p0.boons).filter(id => ED.BOONS[id].key).length,
    gen: ED.isGeneralist(p0.boons), elGates: ED.elementGates(p0.boons), startPath: ED.gatePaths(p0.boons)[0] || null, keyAt: rec.keyAt, duoAt: rec.duoAt, duo: Object.keys(p0.boons).some(id => ED.BOONS[id].duo), duoIds: Object.keys(p0.boons).filter(id => ED.BOONS[id].duo), relicIds: p0.relics.slice(),
    cnt: rec.cnt, kills0: p0.kills, venom: rec.venom, shield: rec.shield, bossSecs: rec.bossSecs, hpFrac: rec.hpFrac, chainPeak: w.chainPeak, chainHops: w.chainHops, rerolls: p0.rerolls,
    route: ED.classRoute(p0.boons, p0.cls), wi: ED.CLASSES[p0.cls].weapons.indexOf(p0.weapon), parts: rec.parts, projDmgS: rec.projDmgS, upt: rec.upt, peak: rec.peak, clip: Object.assign({}, p0.shieldClip), braceOn: p0.stats.brace > 0, hexOn: p0.stats.hex > 0 };
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
// Standard error of the mean, and "mean +-se" text.
const se = (a) => { if (a.length < 2) return NaN; const m = avg(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1) / a.length); };
const ms = (a, d = 1) => (a.length ? avg(a).toFixed(d) + (a.length > 1 ? ' +-' + se(a).toFixed(d) : '') : '-');
const pctOf = (a, b) => (b ? Math.round(100 * a / b) : 0);

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
  lines.push('wins by hero: ' + [...new Set(results.map(r => r.cls))].map(c => { const rs = results.filter(r => r.cls === c); return `${c} ${Math.round(100 * rs.filter(r => r.victory).length / rs.length)}% (depth ${f1(avg(rs.map(r => r.stratum)))})`; }).join(', '));
  lines.push(`deaths by stratum [${hist.join(' ')}] (${atBoss} of ${n - wins.length} at a boss)`);
  lines.push(`wins ${wins.length}/${n} (${(100 * wins.length / n).toFixed(0)}% +-${(100 * Math.sqrt(wins.length / n * (1 - wins.length / n) / n)).toFixed(1)}) avg depth ${ms(results.map(r => r.stratum), 2)} depth incl. partial stratum ${ms(results.map(r => rowOf(r).depth), 2)} avg time ${U.fmtTime(avg(results.map(r => r.time)))} winners ${wins.length ? U.fmtTime(avg(wins.map(r => r.time))) : '-'} lvl ${f1(avg(results.map(r => r.level)))} (winners ${wins.length ? f1(avg(wins.map(r => r.level))) : '-'})`);
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
    return BUCKETS.map(k => k + ' ' + Math.round(100 * (t[k] || 0) / (tot || 1)) + '%').join(' ');
  };
  lines.push(`damage share (all strata | strata IV-VI): all ${share(results, 0)} | ${share(results, 3)}`);
  lines.push('  by main path (strata IV-VI): ' + ED.PATH_IDS.map(k => { const rs = results.filter(r => r.main === k); return `${k} (${rs.length}) ${share(rs, 3)}`; }).join(' | '));
  lines.push('  weapon share by main path (all strata; each path should keep at least 20%): ' + ED.PATH_IDS.map(k => { const rs = results.filter(r => r.main === k); const sh = (b) => { let t = 0, a = 0; for (const r of rs) for (const o of r.src) if (o) for (const x in o) { a += o[x]; if (x === b) t += o[x]; } return a ? Math.round(100 * t / a) : NaN; }; return `${k} ${Number.isFinite(sh('weapon')) ? sh('weapon') + '%' : '-'}`; }).join(' | '));
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
  const deep = (r, t) => r.aff.filter(v => v >= t).length, spread = (f) => [0, 1, 2].map(k => pct(results.filter(r => f(r) === k).length, n)).join('/');
  const offersPer = results.map(r => Object.values(r.offers).reduce((a, b) => a + b, 0) / Math.max(1, r.stratum));
  lines.push(`pacing: offers/run ${f1(avgOffers)} (per stratum ${ms(offersPer, 2)}) | evolved ${pct(evolved.length, n)}% (${ED.PATH_IDS.map(k => k + " " + results.filter(r => r.evo === k).length).join(", ")}) at stratum [${qs(evolved.map(r => r.evoAt.s))}] team lvl [${qs(evolved.map(r => r.evoAt.lvl))}] | of ${reachIV.length} runs reaching IV: evolved ${pct(reachIV.filter(r => r.evo).length, reachIV.length)}% (by IV entry ${pct(reachIV.filter(r => r.evoAt && r.evoAt.s < 4).length, reachIV.length)}%) | affinity median top3 [${[0, 1, 2].map(i => qs(results.map(r => r.aff[i])).split(' ')[1]).join(' ')}] main-path lead (top - 2nd) quartiles [${qs(results.map(r => r.aff[0] - r.aff[1]))}] | runs with 0/1/2 paths at aff>=4: ${spread(r => deep(r, 4))}% at aff>=5: ${spread(r => deep(r, 5))}% | element gates 0/1/2: ${spread(r => r.elGates.length)}% (Generalist runs ${pct(results.filter(r => r.gen).length, n)}%)`);
  // path lines: evolution / keystone / duo pacing, wins by main path and start, status payoffs, shields
  const elemRuns = results.filter(r => !r.gen && r.elGates.length), genRuns = results.filter(r => r.gen);
  const medS = (a) => (a.length ? median(a) : NaN), withS = (rs, key) => rs.filter(r => r[key]).map(r => (key === 'evoAt' ? r.evoAt.s : r[key]));
  lines.push(`evolution stratum quartiles: element mains [${qs(withS(elemRuns, 'evoAt'))}] (${withS(elemRuns, 'evoAt').length}/${elemRuns.length} evolved; by IV entry ${pct(elemRuns.filter(r => r.stratum >= 4 && r.evoAt && r.evoAt.s < 4).length, elemRuns.filter(r => r.stratum >= 4).length)}% of those reaching IV) | Generalist [${qs(withS(genRuns, 'evoAt'))}] (${withS(genRuns, 'evoAt').length}/${genRuns.length}) | per path ${ED.PATH_IDS.map(k => { const a = results.filter(r => r.evoAt && r.evo === k).map(r => r.evoAt.s); return `${k} [${qs(a)}] n=${a.length}`; }).join(' ')}`);
  const two = elemRuns.filter(r => r.elGates.length === 2), duoRuns = two.filter(r => r.duo);
  lines.push(`keystone stratum quartiles [${qs(withS(results, 'keyAt'))}] (${withS(results, 'keyAt').length}/${n} took one) | duo (2-gate runs ${two.length}): taken ${pct(duoRuns.length, two.length)}%, by the end of IV ${pct(two.filter(r => r.duoAt && r.duoAt <= 4).length, two.length)}%, stratum quartiles [${qs(duoRuns.map(r => r.duoAt))}]`);
  const duoCnt = {}; for (const r of results) for (const id of r.duoIds) duoCnt[id] = (duoCnt[id] || 0) + 1;
  lines.push('duo picks: ' + (Object.entries(duoCnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ') || '-') + ' | path relics held at run end (share of runs): ' + ['fang', 'embercharm', 'frostshard', 'stormidol', 'halo', 'gravecandle', 'wardrum', 'crest', 'wispjar', 'venomgland', 'chalice', 'bloodstone'].map(id => `${id} ${pct(results.filter(r => r.relicIds.includes(id)).length, n)}%`).join(' '));
  const grp = (rs) => (rs.length ? `${rs.length} runs wins ${pct(rs.filter(r => r.victory).length, rs.length)}% depth ${ms(rs.map(r => r.stratum), 2)}` : '0 runs');
  lines.push('by main path: ' + ED.PATH_IDS.map(k => `${k} (${grp(results.filter(r => r.main === k))})`).join(' | '));
  const sel = results.filter(r => ['knight', 'ranger', 'shade'].includes(r.cls));
  lines.push(`Knight/Ranger/Shade: Generalist (${grp(sel.filter(r => r.gen))}) vs element (${grp(sel.filter(r => !r.gen))}) | by start path: ${ED.PATH_IDS.map(k => `${k} ${results.filter(r => r.startPath === k).length}`).join(' ')}`);
  const per = (f) => ms(results.map(f), 1);
  lines.push(`per run: smites ${per(r => r.cnt.smite)} reaps ${per(r => r.cnt.reap)} (${pct(results.reduce((a, r) => a + r.cnt.reap, 0), results.reduce((a, r) => a + r.kills, 0))}% of kills; reap health ${f1(avg(results.map(r => r.cnt.reapHp)))}) tolls ${per(r => r.cnt.toll)} lances ${per(r => r.cnt.lance)} dash-rider hits ${per(r => r.cnt.dashHits)} downs ${per(r => r.downedBy.length)} | chain queue peak ${f1(avg(results.map(r => r.chainPeak)))} (max ${Math.max(...results.map(r => r.chainPeak))}) hops ${f1(avg(results.map(r => r.chainHops)))} (max ${Math.max(...results.map(r => r.chainHops))})`);
  const pois = results.filter(r => r.elGates.includes('poison'));
  lines.push(`Venom bonus (${pois.length} Poison runs): ${f1(100 * pois.reduce((a, r) => a + r.venom.own + r.venom.ally, 0) / Math.max(1, pois.reduce((a, r) => a + r.venom.base, 0)))}% of damage dealt (per run: own ${Math.round(pois.reduce((a, r) => a + r.venom.own, 0) / Math.max(1, pois.length))} vs ally ${Math.round(pois.reduce((a, r) => a + r.venom.ally, 0) / Math.max(1, pois.length))}), corrode part ${pct(pois.reduce((a, r) => a + r.venom.corrode, 0), pois.reduce((a, r) => a + r.venom.own + r.venom.ally, 0))}% of the bonus`);
  const shSum = (key) => { const o = {}; for (const r of results) for (const k in r.shield[key]) o[k] = (o[k] || 0) + r.shield[key][k] / n; return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + Math.round(v)).join(', ') || '-'; };
  const holyMains = results.filter(r => r.main === 'holy' && r.bossSecs > 0);
  lines.push(`shield per run (HP) gained: ${shSum('gained')} | absorbed: ${shSum('absorbed')} | Holy absorbed per boss-fight second (${holyMains.length} Holy mains): ${ms(holyMains.map(r => 100 * r.shield.holyBoss / r.bossSecs), 2)}% max HP/s (limit 0.5, design ceiling 1)`);
  const classBoss = [...new Set(results.map(r => r.cls))].map(c => c + ' [' + S.map(s => f1(avg(results.filter(r => r.cls === c).map(r => r.bossTimes[s]).filter(v => v !== undefined)))).join(' ') + ']');
  lines.push('boss time to kill by class and stratum (s): ' + classBoss.join(' '));
  lines.push(`hp lost per stratum (fraction of max HP, runs that played it) [${S.map(s => ms(results.map(r => r.hpFrac[s - 1]).filter(v => v !== undefined), 2)).join(' | ')}]`);
  lines.push(`damage taken ${top(dmg, 5).map(([k, v]) => `${k} ${(100 * v / dTot).toFixed(0)}%`).join(', ')}; first downed by ${top(downed, 5).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const byS = S.map(k => { const o = {}; for (const r of results) for (const who in (r.dmgByS[k] || {})) o[who] = (o[who] || 0) + r.dmgByS[k][who]; const t = Object.values(o).reduce((x, y) => x + y, 0) || 1; return `${k}: ` + Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([w, v]) => `${w} ${Math.round(100 * v / t)}%`).join(' '); });
  lines.push('damage taken by stratum: ' + byS.join(' | '));
  const downsAll = results.reduce((a, r) => a + r.downedBy.length, 0), downsGloom = results.reduce((a, r) => a + r.downedBy.filter(k => k.startsWith('gloom@')).length, 0);
  lines.push(classLines(results));
  lines.push(`gloom: downs ${f2(downsGloom / n)}/run (${(100 * downsGloom / Math.max(1, downsAll)).toFixed(0)}% of ${f2(downsAll / n)} downs/run), damage ${(100 * (dmg.gloom || 0) / dTot).toFixed(0)}% of taken, flares ${f2(avg(results.map(r => r.flares)))}/run, Gloom out ${Math.round(avg(results.map(r => r.gloomSecs)))} s/run, ${f2(avg(results.map(r => r.gloomHits)))} touches/run`);
  return lines.join('\n');
}

// Class route lines (DESIGN-classes section 12): arms per class x route, per fork and per class x weapon, damage share by skill part, HP lost per combat and elite room, shots, shields, heal, uptimes, counts and peaks.
const bossT = (rs, s) => rs.map(r => r.bossTimes[s]).filter(v => v !== undefined);
const meanOf = (a) => (a.length ? avg(a) : NaN);
function classLines(results) {
  const out = [], n = results.length, classes = [...new Set(results.map(r => r.cls))], depth = (r) => rowOf(r).depth, pc1 = (v) => (Number.isFinite(v) ? (100 * v).toFixed(1) + '%' : '-');
  const arm = (rs) => `${rs.length} runs, depth ${ms(rs.map(depth), 2)}, boss time to kill II ${ms(bossT(rs, 2), 0)} IV ${ms(bossT(rs, 4), 0)}`;
  const roomD = (rs, type) => { const a = rs.flatMap(r => r.clears.filter(c => c.type === type).map(c => 100 * c.d)); return a.length ? ms(a, 1) + '%' : '-'; };
  const withRoute = results.filter(r => r.route.route);
  if (withRoute.length) {
    out.push('class route arms (class route: runs, depth, boss time to kill s):');
    for (const c of classes) for (const rt of ED.ROUTES) { const rs = results.filter(r => r.cls === c && r.route.route === rt); if (rs.length) out.push(`  ${c} ${rt}: ${arm(rs)}`); }
    const forks = [...new Set(withRoute.map(r => r.route.fork).filter(Boolean))].sort();
    out.push('forks (runs, depth, boss time to kill, rank-3 reach of those that beat the stratum IV boss, HP lost per combat / elite room, pack (>= 4 foes) clear s):');
    for (const f of forks) {
      const rs = results.filter(r => r.route.fork === f), iv = rs.filter(r => r.bossTimes[4] !== undefined), pk = rs.flatMap(r => r.clears.filter(c => c.type === 'combat' && c.n >= 4).map(c => c.t));
      out.push(`  ${f} ${ED.BOONS[f].name} [${ED.BOONS[f].tag}]: ${arm(rs)}, rank 3 ${iv.length ? Math.round(100 * iv.filter(r => r.route.rank >= 3).length / iv.length) + '%' : '-'} (${iv.length}), room hp lost ${roomD(rs, 'combat')} / ${roomD(rs, 'elite')}, pack clear ${ms(pk, 1)}`);
    }
  }
  const byW = classes.map(c => [c, [0, 1, 2].map(i => results.filter(r => r.cls === c && r.wi === i)).map((rs, i) => ({ i, rs }))]);
  if (new Set(results.map(r => r.wi)).size > 1) {
    out.push('weapons (class weapon: runs, boss time to kill II / IV, ratio of the mean to the class median):');
    for (const [c, ws] of byW) {
      const act = ws.filter(x => x.rs.length), m2 = median(act.map(x => meanOf(bossT(x.rs, 2)))), m4 = median(act.map(x => meanOf(bossT(x.rs, 4))));
      for (const x of act) out.push(`  ${c} ${ED.CLASSES[c].weapons[x.i]}: ${x.rs.length} runs, II ${ms(bossT(x.rs, 2), 0)} (x${f2(meanOf(bossT(x.rs, 2)) / m2)}) IV ${ms(bossT(x.rs, 4), 0)} (x${f2(meanOf(bossT(x.rs, 4)) / m4)})`);
    }
  }
  const pt = {}; let ptt = 0;
  for (const r of results) for (const k in r.parts) { pt[k] = (pt[k] || 0) + r.parts[k]; ptt += r.parts[k]; }
  out.push('damage share by part: ' + Object.entries(pt).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + ' ' + Math.round(1000 * v / (ptt || 1)) / 10 + '%').join(', '));
  out.push(`room hp lost (% max HP) combat ${roomD(results, 'combat')} elite ${roomD(results, 'elite')} | shots hp lost per stratum (% max HP) [${[1, 2, 3, 4, 5, 6].map(s => ms(results.map(r => r.projDmgS[s - 1]).filter(v => v !== undefined).map(v => 100 * v), 1)).join(' | ')}]`);
  const sh = (key) => { const o = {}; for (const r of results) for (const k in r.shield[key]) o[k] = (o[k] || 0) + r.shield[key][k] / n; return o; };
  const clip = {}; for (const r of results) for (const k in r.clip) clip[k] = (clip[k] || 0) + r.clip[k] / n;
  const fo = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ') || '-';
  const bossShield = results.reduce((a, r) => a + r.bossSecs, 0), time = results.reduce((a, r) => a + r.time, 0);
  const healS = {}; for (const r of results) for (const k in r.heal) healS[k] = (healS[k] || 0) + r.heal[k];
  out.push(`shield per run (HP) gained: ${fo(sh('gained'))} | absorbed: ${fo(sh('absorbed'))} | clipped by the window: ${fo(clip)} | heal per second by source: ${Object.entries(healS).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' ' + (v / Math.max(1, time)).toFixed(2)).join(', ') || '-'} (boss fight time ${Math.round(bossShield)} s)`);
  const up = (key, filt) => { const rs = results.filter(filt || (() => true)); const on = rs.reduce((a, r) => a + r.upt[key][0], 0), of = rs.reduce((a, r) => a + r.upt[key][1], 0); return of ? pc1(on / of) + ' (' + rs.length + ' runs)' : '-'; };
  out.push(`uptimes in fights: Brace ${up('brace', r => r.braceOn)} | Sanctuary DR ${up('sanct', r => r.cls === 'cleric')} | trash stun ${up('stun')} | smoke blind per foe ${(() => { const rs = results.filter(r => r.cls === 'shade'), b = rs.reduce((a, r) => a + r.upt.smoke[0], 0), cd = rs.reduce((a, r) => a + r.upt.smoke[2], 0); return cd ? pc1(b / cd) + ' of the cooldown' : '-'; })()} | Momentum mean stacks ${(() => { const rs = results.filter(r => r.cls === 'shade'), on = rs.reduce((a, r) => a + r.upt.mom[0], 0), of = rs.reduce((a, r) => a + r.upt.mom[1], 0); return of ? (on / of).toFixed(2) : '-'; })()}`);
  const knights = results.filter(r => r.cnt.casts.shieldthrow), strikes = knights.reduce((a, r) => a + r.cnt.rics, 0), casts = knights.reduce((a, r) => a + r.cnt.casts.shieldthrow, 0);
  out.push(`counts per run: refunds ${f2(avg(results.map(r => r.cnt.refunds)))} parries ${f2(avg(results.map(r => r.cnt.parries)))} staggers ${f1(avg(results.map(r => r.cnt.staggers)))} catches ${f1(avg(knights.map(r => r.cnt.catches)))} | Shield Throw strikes per cast ${casts ? (strikes / casts).toFixed(2) : '-'} (guarded ${strikes ? Math.round(100 * knights.reduce((a, r) => a + r.cnt.gRics, 0) / strikes) : 0}%) | peak shots per hero ${f1(avg(results.map(r => r.peak.projs)))} (max ${Math.max(...results.map(r => r.peak.projs))}) live zones ${f1(avg(results.map(r => r.peak.zones)))} (max ${Math.max(...results.map(r => r.peak.zones))})`);
  return out.join('\n');
}

// Hearth profile of a bot: none (fresh), mid (half the ranks, mastery 5) or max (every rank, mastery 10).
const metaProfile = (meta) => ({
  up: meta === 'max' ? ED.UPGRADES.map(u => u.costs.length) : meta === 'mid' ? ED.UPGRADES.map(u => Math.ceil(u.costs.length / 2)) : ED.UPGRADES.map(() => 0),
  mastery: meta === 'max' ? 10 : meta === 'mid' ? 5 : 1,
});

// Run options shared by both command lines, from the parsed --flags.
const optsFromFlags = (flags) => ({
  pick: flags.pick || process.env.PICK || 'random', start: flags.start, gates: flags.gates === undefined ? undefined : +flags.gates, route: flags.route, fork: flags.fork === undefined || isNaN(+flags.fork) ? flags.fork : +flags.fork,
  weapon: flags.weapon === undefined || isNaN(+flags.weapon) ? flags.weapon : +flags.weapon, cardMastery: flags.mastery,
  aimNoise: flags.aimnoise === undefined ? undefined : flags.aimnoise.split(',').map(Number).concat([0]).slice(0, 2).map(v => (Number.isFinite(v) ? v : 0)),
  force: flags.force ? flags.force.split(',') : [], exploreMin: flags.explore === undefined ? undefined : +flags.explore, maxStratum: flags.strata === undefined ? undefined : +flags.strata,
});

// Expands the rotating flags for run i of a batch over nc classes: route = floor(i / nc) mod 4, fork = floor(i / (nc x 4)) mod 2, weapon = floor(i / (nc x 8)) mod 3, start = the six gates then generalist.
const ROT_START = ['kindle', 'frostbite', 'staticcharge', 'envenom', 'consecrate', 'doommark', 'generalist'];
function jobOpts(o, i, nc) {
  const r = Object.assign({}, o);
  if (o.route === 'rotate') r.route = ED.ROUTES[Math.floor(i / nc) % 4];
  if (o.fork === 'rotate') r.fork = Math.floor(i / (nc * 4)) % 2;
  if (o.weapon === 'rotate') r.weapon = Math.floor(i / (nc * 8)) % 3;
  if (o.start === 'rotate') r.start = ROT_START[i % 7];
  return r;
}

// Mean difference (this - baseline) +- standard error over the runs both row sets hold (matched on label, seed and class): depth, boss time to kill and HP lost per stratum.
function pairReport(rows, base) {
  const key = (r) => r.label + '|' + r.seed + '|' + r.cls, bm = new Map(base.map(r => [key(r), r]));
  const fmt = (a, d) => (a.length ? `${avg(a) >= 0 ? '+' : ''}${avg(a).toFixed(d)}${a.length > 1 ? ' +-' + se(a).toFixed(d) : ''}` : '-');
  return [...new Set(rows.map(r => r.label))].map(lab => {
    const pairs = rows.filter(r => r.label === lab && bm.has(key(r))).map(r => [r, bm.get(key(r))]);
    const diff = (f) => pairs.map(([a, b]) => { const x = f(a), y = f(b); return x === null || y === null || x === undefined || y === undefined ? NaN : x - y; }).filter(Number.isFinite);
    const idx = [0, 1, 2, 3, 4, 5];
    return `paired vs baseline [${lab}] ${pairs.length} of ${rows.filter(r => r.label === lab).length} runs matched: depth ${fmt(diff(r => r.depth), 2)} | boss time to kill by stratum (s) [${idx.map(i => fmt(diff(r => r.bossTtk[i]), 0)).join(' | ')}] | hp lost per stratum (fraction of max HP) [${idx.map(i => fmt(diff(r => r.hpLost[i]), 2)).join(' | ')}]`;
  }).join('\n');
}

module.exports = { runBot, summarize, classLines, metaProfile, rowOf, optsFromFlags, jobOpts, pairReport, ED };
if (require.main === module) {
  const flags = {}, args = [];
  for (const a of process.argv.slice(2)) { const m = /^--([a-z0-9]+)(?:=(.*))?$/i.exec(a); if (m) flags[m[1]] = m[2] === undefined ? '1' : m[2]; else args.push(a); }
  const n = +(args[0] || 1), runs = +(args[1] || 5), skill = +(args[2] || 0.75), meta = args[3] || 'none';
  const cls = (args[4] && args[4] !== '-' ? args[4] : 'knight,ranger,pyro,shade,cleric,necro').split(','); // '-' = every hero
  const { up, mastery } = metaProfile(meta);
  const o = optsFromFlags(flags), pick = o.pick, force = o.force, seed0 = +(flags.seed0 || 1000);
  const results = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = runBot(Object.assign({ seed: seed0 + i * 7, n, cls: [cls[i % cls.length]].concat(cls), skill, up, pact: +(args[5] || 0), mastery }, jobOpts(o, i, cls.length)));
    results.push(r);
    if (!flags.quiet) {
      console.log(`run ${i} ${cls[i % cls.length]}: ${r.victory ? 'WIN' : r.state} stratum ${r.stratum} time ${U.fmtTime(r.time)} lvl ${r.level} kills ${r.kills} relics ${r.relics} rooms ${r.rooms.visited}/${r.rooms.total} lightAtBoss [${r.lightAtBoss.join(' ')}] strata [${r.strata.map(U.fmtTime).join(' ')}] (${Date.now() - t0}ms)`);
      for (const l of r.log) console.log(l);
    }
  }
  console.log(`\npick=${pick}${o.start ? ' start=' + o.start : ''}${o.gates ? ' gates=' + o.gates : ''}${force.length ? ' force=' + force.join(',') : ''}${flags.strata ? ' strata<=' + flags.strata + ' (capped runs: win, depth and death lines do not apply)' : ''}\n` + summarize(results));
  const rows = results.map((r, i) => rowOf(r, meta, seed0 + i * 7));
  if (flags.out) fs.writeFileSync(flags.out, JSON.stringify(rows));
  if (flags.pair) console.log(pairReport(rows, JSON.parse(fs.readFileSync(flags.pair, 'utf8'))));
}
