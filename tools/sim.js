// Usage: node tools/sim.js <heroes> <runs> <botSkill 0-1> <meta none|mid|max> [classes|-] [pact] [--pick=random|smart|legacy] [--start=random|class|generalist|rotate|<gateId>] [--gates=1|2] [--force=id[@slot],...]
//   [--route=attack|skill1|skill2|element|random|rotate] [--fork=0|1|random|rotate] [--weapon=0|1|2|rotate] [--aimnoise=<angle rad>,<point px>|0] [--seed0=N] [--dark=smart|always|never] [--strata=N] [--from=N] [--boss] [--vet[=charges,rider,dodge,hazard]] [--vetreact=<s>] [--lambda=<x>|auto[:<x0>]] [--out=rows.json] [--pair=rows.json] [--quiet] [--explain]   (parallel batches: tools/simpool.js, fixed quick suite: tools/bal.js)
// Headless simulation harness: loads the game's sim files into this Node context and drives bot heroes through full runs (deterministic per seed: the bot has its own seeded RNG).
// Bot policy: fight, claim room rewards, use rest sites and shops, then take the exit door nextRoom picks (a seeded map heuristic) until the boss.
// Element verbs (botHold, botPerfect, botDischarge, botDash, the Backstab flank): holds, perfect dodges, discharge dashes through charged packs, blinks and flanking at the bot's skill.
// Dark rooms follow --dark: smart (default) enters one while every living hero has at least DARK_HP of max HP, always enters, never skips them.
// Pick policies: 'random' takes a random card; 'smart' takes the card of best marginal value (tools/pick.js: damage and effective health over the next three strata from the sheet model, folded mechanics, milestone value of keystone / evolution / duo; start card, forge, rerolls and relics by the same value);
// 'legacy' is the v3 smart order in smartScore (evolution > keystone > own-path boon > element gate while a slot is free > open General > anything), kept for paired comparison. --explain prints every pick of a single run with its value parts.
// Skill (0-1) is the share of ticks the bot pays attention to floor hazards; the rest of the time it moves on instinct.
// --vet: the veteran preset, a bot that plays like a skilled player (see "veteran preset" below); --vetreact=<s> sets its reaction time (default 0.18); without --vet every number is unchanged.
// The summary reports win rate, pacing, hits and time to kill, hero DPS, damage share by source, cooldown reduction, the dark-room lines and the path lines (see summarize); every mean prints its standard error.
// Its last lines, `boss arrival I..IV` (also each row's `arrive`), read every run at the first entry of each boss room: team level, hero 0's picks by source, and per hero the model's damage on one foe and in a pack and its effective health (tools/model.js assess, hero at rest); power = mean damage x effective health, geometric mean over the runs.
// Per cleared combat / elite / dark room it also reports kills (threat/fodder), peak live foes and the xp dropped against the room budget. Bot fights: nearest threat foe within weapon reach, else the nearest fodder; with 4+ foes within 80 px it steps toward the emptier side (crowd slow).
// --start: how the start offer is picked (default: the best gain under --pick=smart, else uniform over its cards; random: always uniform; class: the class element's gate; a gate id or generalist forces that card; rotate: run i takes fire, ice, lightning, poison, holy, shadow, generalist in turn).
// --gates=1: a hero never takes a second element gate (mono-element arm).
// --force: gate ids (and generalist) replace the start pick, then are taken whenever offered; other boons and relics are granted at run start (a fork id also grants its route card). id@slot limits an id to one hero.
// --route / --fork: the class route card and fork (0 = Heavy / Burst / Focus, 1 = Swift / Guard / Spread) a hero takes (default random, seeded per run and hero). rotate cycles them over the runs so every class meets every route, fork and weapon in one batch:
//   route = floor(i / classes) mod 4, fork = floor(i / (classes x 4)) mod 2, weapon = floor(i / (classes x 4 x 2)) mod 3. --weapon picks the weapon index (default 0).
// Casting follows ED.SKILLS: aim 'dir' throws along the target angle, 'ground' lands on the foe, 'move' runs or blinks through it, 'self' fires around the hero; aim noise shrinks with the bot's skill (angle 0.12 rad, ground point 36 px at skill 0).
// --out=file.json writes one row per run (seed, class, depth, win, boss time to kill and HP lost per stratum, evolution stratum, main path, gates); --pair=file.json prints the mean difference to such a baseline for the same seeds.
// --lambda: the weight of effective health against damage in --pick=smart (tools/pick.js): a number (default 2), or auto[:x0] = x0 times the foe damage lever of each stratum the pick looks ahead to (live tables).
// --from=N: the bots start at stratum N with the build strata 1..N-1 give (skipStrata plays them without fighting); stats, wins and depth then cover strata >= N (depth counts the skipped bosses as beaten, time counts from stratum N, `entry` holds the hero state at each stratum start).
// --fight=boss|twins|mimic (--boss = --fight=boss): one fight per run. The party is walked to stratum --from (default I) as --from does; boss also walks that stratum's rooms and enters its boss room, twins / mimic start that champion fight in one of its combat rooms.
//   The party starts the fight at full health; the run ends with the fight; the `fight` summary line reports kills, wipes (and the boss phase), time to kill, downs and health lost. --bosstype=<boss id> sets the boss of the --from stratum.
// meta: none = fresh profile; mid = half the upgrade ranks, mastery 5; max = every rank, mastery 10. Every relic is always in the pool.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src') + '/';
const files = ['util.js', 'data/biomes.js', 'data/enemies.js', 'data/classes.js', 'data/boons.js', 'data/classboons.js', 'data/relics.js', 'data/meta.js', 'save.js',
  'sim/dungeon.js', 'sim/stats.js', 'sim/world.js', 'sim/combat.js', 'sim/elements.js', 'sim/build.js', 'sim/skills.js', 'sim/class-knight.js', 'sim/class-ranger.js', 'sim/class-pyro.js', 'sim/class-shade.js', 'sim/class-cleric.js', 'sim/class-necro.js', 'sim/class-bell.js',
  'sim/ai.js', 'sim/bosses.js', 'sim/boss-warden.js', 'sim/boss-spore.js', 'sim/rooms.js', 'sim/arena.js', 'sim/boss-king.js', 'sim/boss-hollow.js', 'sim/champions.js', 'sim/sheet.js'];
// Main context, not vm.createContext: inside a vm context every global read (Math, Object, ...) goes through the context interceptor and the sim runs ~3x slower.
for (const f of files) vm.runInThisContext(fs.readFileSync(ROOT + f, 'utf8'), { filename: f });
const ED = globalThis.ED;
const U = ED.U, T = ED.CONST.TILE, D = ED.Dungeon;
const MODEL = require('./model.js')(ED);
const PICK = require('./pick.js')(ED, MODEL); // card values by marginal gain (--pick=smart)
const PICK_SRC = ['start', 'class', 'room', 'epic', 'forge', 'level', 'other']; // pick sources of the boss-arrival read

// Boss-arrival read: team level, hero 0's picks by source (counts in PICK_SRC order) and, per hero at rest, the model's damage on one foe and in a pack and its effective health in the sheet context of the stratum.
function arrivalOf(w, picks) {
  const out = { lvl: w.level, pk: picks.slice(), one: [], pack: [], ehp: [] };
  for (const p of w.players.values()) {
    const a = MODEL.assess(Object.assign({}, p, PICK.AT_REST), ED.Sheet.ctx(w, p));
    out.one.push(a.one); out.pack.push(a.pack); out.ehp.push(a.ehp);
  }
  return out;
}

const DARK_HP = 0.6; // --dark=smart: the bot enters a dark room while every living hero has at least this share of max HP
const SL = Array.from({ length: ED.CONST.STRATA }, (_, i) => i + 1); // stratum numbers 1..STRATA
const zeros = () => SL.map(() => 0), lists = () => SL.map(() => []);
// Seconds a cast of skill slot puts on that slot for hero p.
const botCd = (p, slot) => (slot ? p.stats.skill2Cd : p.stats.skillCd);
// ---------------- element verbs at skill level (the human-proxy policy for each one) ----------------
const TICK = 1 / 60;
// Reach of the Cinder Arms flame cone (elements.js flameCone).
const coneReach = (st) => (st.weapon.kind === 'melee' ? st.weapon.range * (1 + st.area * 0.5 + st.meleeReach) * ED.CONST.CONE_REACH : ED.CONST.CONE_RANGE * (1 + st.area * 0.5));
// Foes within 320 and 0.25 rad of the aim a (an ice lance's line).
const lanePack = (foes, p, a) => { let n = 0; for (const e of foes) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < 320 && Math.abs(U.angDiff(a, Math.atan2(e.y - p.y, e.x - p.x))) < 0.25 + Math.atan2(e.r, Math.max(d, 1))) n++; } return n; };
// A foe attack worth guarding or dodging: a foe shot within 150 flying at the hero, or a foe within 90 in the last 0.2 s of a wind-up. Returns the attacker (a shot's shooter) or null.
function threatOf(w, p) {
  for (const pr of w.projs) {
    if (pr.team !== 1 || pr.dead || U.dist2(pr.x, pr.y, p.x, p.y) > 150 * 150) continue;
    const sp = Math.hypot(pr.vx, pr.vy) || 1, dx = p.x - pr.x, dy = p.y - pr.y, along = (dx * pr.vx + dy * pr.vy) / sp;
    if (along > 0 && Math.abs(dx * pr.vy - dy * pr.vx) / sp < p.r + pr.r + 6) return pr.src && pr.src.hp > 0 ? pr.src : { x: pr.x, y: pr.y };
  }
  for (const e of w.enemies) if (e.hp > 0 && (e.st === 'windup' || e.st === 'aim') && e.t > 0 && e.t <= 0.2 && U.dist2(e.x, e.y, p.x, p.y) < 90 * 90) return e;
  return null;
}
// A hold verb (stats.hold, ED.Stats.HOLD): the press counts c.holdT (attacks go on until the verb starts at its `at`), then the bot holds: the cone while a foe stands in it, the lance, flask and finisher to full and released at the target,
// the guard (no press: a veteran raises it ahead) while an attack comes. Returns true while the hold has the attack.
function botHold(w, p, c, foes, tgt, d, a, inRange, brng, skill) {
  const st = p.stats, k = st.hold, H = k && ED.Stats.HOLD[k];
  if (!H || st.kind === 'bell') return false;
  if (p.holdOn) {
    p.face = a;
    const full = ED.Stats.holdFull(st), ready = !(full > 0) || p.holdT >= full;
    const end = k === 'guard' ? !threatOf(w, p) : k === 'cone' ? d - tgt.r > coneReach(st) : !inRange || ready;
    if (end) { p.aimX = tgt.x; p.aimY = tgt.y; w.playerHold(p, false, a, d); c.holdT = 0; c.holdCd = 0.3 + brng.next() * 0.4 * (1 - skill); }
    return true;
  }
  c.holdCd = (c.holdCd || 0) - TICK;
  if (k === 'guard') { if (threatOf(w, p) && brng.next() < skill) { w.playerHold(p, true, a); return true; } return false; }
  const want = inRange && c.holdCd <= 0 && (k !== 'cone' || d - tgt.r <= coneReach(st)) && (k !== 'lance' || lanePack(foes, p, a) >= 2 || tgt.elite || tgt.boss) && (k !== 'flask' || d <= ED.CONST.FLASK_MAX);
  if (!want) { c.holdT = 0; return false; }
  c.holdT = (c.holdT || 0) + TICK;
  if (c.holdT < H.at) return false;
  w.playerHold(p, true, a);
  return true;
}
// A perfect dodge (Holy): the dash heading through an attack that is about to land (chance skill), or null.
function botPerfect(w, p, c, skill, brng) {
  if (!p.stats.perfectDodge || c.dashN < 1 || p.dashT > 0 || p.skillMove) return null;
  const t = threatOf(w, p);
  if (!t || brng.next() > skill * 0.6) return null;
  const dx = t.x - p.x, dy = t.y - p.y, l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
// A discharge dash (Lightning): through the hero's charged foes within 150 once 3 of them stand (or a charged elite or boss holds 3% of its health), toward their middle; at most one per 0.6 s.
function botDischarge(p, c, foes) {
  if ((c.disT = (c.disT || 0) - TICK) > 0 || c.dashN < 1 || p.dashT > 0 || p.skillMove) return null;
  let n = 0, sx = 0, sy = 0, big = false;
  for (const e of foes) if (e.charge > 0 && e.chargeOwner === p && U.dist2(e.x, e.y, p.x, p.y) < 150 * 150) { n++; sx += e.x; sy += e.y; if ((e.elite || e.boss) && e.charge >= 0.03 * e.maxHp) big = true; }
  if (!(n >= 3 || big)) return null;
  c.disT = 0.6;
  const dx = sx / n - p.x, dy = sy / n - p.y, l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
// A dash of hero p along (dx, dy) as game.js makes it: Storm Step and Umbral Arms blink first (ED.Sim.dashBlink; behind a foe the dash stays there).
function botDash(w, p, c, dx, dy, foes) {
  const st = p.stats, ox = p.x, oy = p.y;
  let blink = false;
  if (st.stormStep || st.stepBehind) {
    const b = ED.Sim.dashBlink(w.room, w.locked, p, st, foes, Math.atan2(dy, dx));
    if (b) { p.x = b.x; p.y = b.y; if (b.behind) { dx = 0; dy = 0; p.face = b.face; blink = true; } else { dx = b.dx; dy = b.dy; } }
  }
  p.dashT = ED.CONST.DASH.t; p.dashDx = dx; p.dashDy = dy; w.playerDash(p, dx, dy, blink, ox, oy); ED.Sim.dashTry(c, st);
}
const PER_HERO_REWARDS = ['boon', 'forge', 'epic', 'vigor'];
const MAX_SECONDS = 60 * 60; // a run that is still going after an hour of game time counts as a loss
// Open General boons in the order a sensible player takes them (damage and defence first).
const NEUTRAL_PREF = ['keen', 'brutal', 'vigor', 'plating', 'focus', 'trance', 'evade', 'wide', 'laststand', 'echo', 'bladedash', 'lightstep'];

// First step toward (tx, ty): the shortest path that stays off floor hazards, else the shortest path (a hero walks around hazards when it can).
function bfsDir(room, locked, sx, sy, tx, ty) { return bfsStep(room, locked, sx, sy, tx, ty, true) || bfsStep(room, locked, sx, sy, tx, ty, false); }
// Walking distance to goal tile g (-1: unreachable) over the tiles a hero may enter (safe: hazards excluded); cached per room, lock state and goal (room.tver counts boss wall changes, arena.fallen the rings of a collapsing arena; either clears the cache).
const fields = new Map(); let fieldRoom = null, fieldVer = 0, fieldFall = 0;
function goalField(room, locked, g, safe) {
  const fall = room.arena ? room.arena.fallen | 0 : 0; // a collapsing arena (boss-hollow.js) turns floor into chasm
  if (room !== fieldRoom || (room.tver | 0) !== fieldVer || fall !== fieldFall) { fields.clear(); fieldRoom = room; fieldVer = room.tver | 0; fieldFall = fall; }
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

// Steers (mx, my) off hazard tiles (and a boss's spore carpet unless carpetOk): standing on one or about to step onto one, the first turn of 35-145 degrees (either side) or the reverse that lands on safe floor.
const carpetAt = (room, x, y) => !!room.carpet && x >= 0 && y >= 0 && !!room.carpet[Math.floor(y / T) * room.w + Math.floor(x / T)];
const badAny = (room, x, y) => D.tileAt(room, x, y) === 4 || carpetAt(room, x, y);
function avoidHazard(room, p, mx, my, carpetOk) {
  const badAt = carpetOk ? (rm, x, y) => D.tileAt(rm, x, y) === 4 : badAny, look = p.r + 12, bad = (dx, dy) => badAt(room, p.x + dx * look, p.y + dy * look) || badAt(room, p.x + dx * look * 0.5, p.y + dy * look * 0.5);
  if (!badAt(room, p.x, p.y) && !bad(mx, my)) return [mx, my];
  const l = Math.hypot(mx, my) || 1, a0 = Math.atan2(my, mx);
  for (const off of [0.6, -0.6, 1.1, -1.1, 1.6, -1.6, 2.1, -2.1, 2.5, -2.5, Math.PI]) {
    const dx = Math.cos(a0 + off), dy = Math.sin(a0 + off);
    if (!bad(dx, dy)) return [dx * l, dy * l];
  }
  return [mx, my];
}

// Crowd escape: with CROWD_N or more foes within CROWD_R of the hero, the unit heading (one of 8) whose point 60 px ahead has the fewest foes within CROWD_R (a wall or chasm there counts 99); null otherwise. near: the foes around the hero (w.foesNear).
const CROWD_R = 80, CROWD_N = 4;
function crowdEscape(w, p, near) {
  const live = (e) => e.hp > 0 && e.spawnT <= 0, r2 = CROWD_R * CROWD_R;
  let n = 0;
  for (const e of near) if (live(e) && U.dist2(e.x, e.y, p.x, p.y) < r2) n++;
  if (n < CROWD_N) return null;
  let best = null, bs = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = k * U.TAU / 8, qx = p.x + Math.cos(a) * 60, qy = p.y + Math.sin(a) * 60, t = D.tileAt(w.room, qx, qy);
    let s = t === 1 || t === 2 || t === 3 || (t === 5 && w.locked) ? 99 : 0;
    for (const e of near) if (live(e) && U.dist2(e.x, e.y, qx, qy) < r2) s++;
    if (s < bs) { bs = s; best = [Math.cos(a), Math.sin(a)]; }
  }
  return best;
}

// ---------------- boss arena habits (Bone Warden lanes, Sporemother carpet and pods) ----------------
// First step (unit vector) of the walk from (x, y) to the nearest walkable tile that `goal(tileIndex)` accepts, or null when none is reachable.
function bfsTo(room, locked, x, y, goal) {
  const w = room.w, n = w * room.h, s = Math.floor(y / T) * w + Math.floor(x / T);
  if (s < 0 || s >= n) return null;
  const tiles = room.tiles, prev = new Int32Array(n).fill(-1), q = new Int32Array(n), ok = (t) => t === 0 || t === 4 || (t === 5 && !locked);
  let qh = 0, qt = 0, hit = -1; prev[s] = s; q[qt++] = s;
  while (qh < qt) {
    const i = q[qh++];
    if (i !== s && goal(i)) { hit = i; break; }
    const cx = i % w;
    for (const j of [cx > 0 ? i - 1 : -1, cx < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < n && prev[j] < 0 && ok(tiles[j])) { prev[j] = i; q[qt++] = j; }
  }
  if (hit < 0) return null;
  let c = hit; while (prev[c] !== s) c = prev[c];
  const dx = (c % w + 0.5) * T - x, dy = (Math.floor(c / w) + 0.5) * T - y, l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
// Arena pieces first: the nearest spore bud within BUD_NEAR px (it would regrow a pod), else the nearest spore pod within POD_NEAR px (breaking one clears the carpet around it). null when none qualifies.
const POD_NEAR = 260, BUD_NEAR = 320;
function arenaTarget(w, foes, p) {
  let best = null, bd = Infinity, pri = 9;
  for (const e of foes) {
    const k = e.type === 'sporebud' ? 0 : e.type === 'sporepod' ? 1 : 9;
    if (k > pri || k === 9) continue;
    const d2 = U.dist2(e.x, e.y, p.x, p.y);
    if (d2 > (k === 1 ? POD_NEAR : BUD_NEAR) ** 2) continue;
    if (k < pri || d2 < bd) { pri = k; bd = d2; best = e; }
  }
  return best;
}
// Lane charge warning (Bone Warden, zone.lane = the band in px) that holds hero p and has been seen for `react` s: the way out of the band, else null.
function laneEscape(w, p, react) {
  for (const z of w.zones) {
    if (!z.lane || z.team !== 1 || z.t < react || p.y < z.lane.y0 - p.r || p.y > z.lane.y1 + p.r) continue;
    const d = bfsTo(w.room, w.locked, p.x, p.y, (i) => { const ty = Math.floor(i / w.room.w) * T; return ty + T <= z.lane.y0 - 2 || ty >= z.lane.y1 + 2; });
    return d ? { d, tl: z.dur - z.t } : null;
  }
  return null;
}
// Plain bot (no --vet) in a boss fight: the way out of a hostile swing cone or strike line that holds hero p and has been seen for `react` s (out of the cone's reach, sideways off the line), else null.
function bossDodge(w, p, react) {
  let ox = 0, oy = 0;
  for (const z of w.zones) {
    if (z.team !== 1 || z.t < react || z.lane) continue;
    if (z.kind === 'teleCone') {
      const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
      if (d < z.r + p.r + 10 && Math.abs(U.angDiff(z.a, Math.atan2(dy, dx))) < z.arc / 2 + 0.25) { ox += dx / d; oy += dy / d; }
    } else if (z.kind === 'teleLine') {
      const ca = Math.cos(z.a), sa = Math.sin(z.a), rx = p.x - z.x, ry = p.y - z.y, along = rx * ca + ry * sa, side = -rx * sa + ry * ca;
      if (along > -p.r && along < z.len + p.r && Math.abs(side) < z.w / 2 + p.r + 8) { const sg = side >= 0 ? 1 : -1; ox += -sa * sg; oy += ca * sg; }
    }
  }
  return ox || oy ? [ox, oy] : null;
}
// Standing on spore carpet: the way to the nearest bare floor tile, else null.
function carpetEscape(w, p) {
  const room = w.room;
  if (!carpetAt(room, p.x, p.y)) return null;
  return bfsTo(room, w.locked, p.x, p.y, (i) => !room.carpet[i] && (room.tiles[i] === 0 || room.tiles[i] === 5));
}

// ---------------- veteran preset (--vet) ----------------
// A skilled player's habits on top of the bot: extra skill charges, dash riders through packs, a look-ahead dodge of shots, telegraphs and body-hit lunges (walk first, dash when walking cannot clear them), a constant watch on the ground.
// --vet turns every feature on, --vet=charges,rider,dodge,hazard only the named ones; without the flag none of this code runs.
const VET_ALL = ['charges', 'rider', 'dodge', 'hazard'];
const parseVet = (v) => (v === undefined || v === '0' || v === 'off' ? null : new Set(v === '1' || v === 'all' ? VET_ALL : String(v).split(',')));
const VH = 1, VDT = 0.05, VN = 20; // look-ahead (s), sample step (s), samples
let VR = 0.18; // reaction time (s), --vetreact=<s>: a shot, telegraph or lunge older than this is dodged; in a lapse of attention (c.attn false) VLAPSE s more
const VLAPSE = 0.3;
const SEEN = new WeakMap(), SWING = new WeakMap(); // first-seen time of each foe shot, wind-up record of each lunging foe
const VDIRS = Array.from({ length: 16 }, (_, k) => [Math.cos(k * U.TAU / 16), Math.sin(k * U.TAU / 16)]);

// Distance a hero of radius r walks from (x, y) along the unit heading (ux, uy) within maxD: walls, chasms and locked doors stop it.
function reachDist(room, locked, x, y, ux, uy, maxD, r) {
  let d = 0;
  for (let s = 6; ; s += 6) {
    const q = Math.min(s, maxD), t = D.tileAt(room, x + ux * (q + r), y + uy * (q + r));
    if (t === 1 || t === 2 || t === 3 || (t === 5 && locked)) break;
    d = q;
    if (q >= maxD) break;
  }
  return d;
}

// Threats to hero p over the next VH seconds, or null when none reaches it: foe shots (flight sampled every VDT), wind-up telegraphs resolving within VH (tl: time left), standing fields, and body-hit lunges and bashes (a foe still, then moving along its aim). Only what the hero had time to see (react seconds) counts.
function vetThreats(w, p, speed, react) {
  const room = w.room, locked = w.locked, R = speed * VH + 60, mhp = p.maxHp, low = 2 - p.hp / mhp;
  const wt = (dmg) => (0.5 + Math.min(2.5, 8 * dmg / mhp)) * low;
  let T = null;
  const get = () => T || (T = { room, pj: [], hm: [], zn: [], ar: [], mv: [], ln: [] });
  if (D.tileAt(room, p.x, p.y) === 4) get(); // standing on a hazard tile: the plan walks off it
  for (const pr of w.projs) {
    if (pr.team !== 1 || pr.dead || pr.ghost) continue;
    let t0 = SEEN.get(pr);
    if (t0 === undefined) SEEN.set(pr, t0 = w.time);
    if (w.time - t0 < react) continue;
    const sp = Math.hypot(pr.vx, pr.vy) || 1, far = sp * Math.min(VH, pr.life) * Math.exp((pr.accel || 0) * VH);
    if (pr.homing) { // a homing shot turns toward the hero: simulated per heading in vetRisk
      if (U.dist2(p.x, p.y, pr.x, pr.y) < (R + far) ** 2) get().hm.push({ x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, rate: pr.homing, n: Math.min(VN, Math.floor((pr.life - 1e-6) / VDT)), hr: p.r + pr.r + 1, wt: wt(pr.dmg) });
      continue;
    }
    if (!pr.turn && U.segDist2(p.x, p.y, pr.x, pr.y, pr.x + pr.vx / sp * far, pr.y + pr.vy / sp * far) > (R + pr.r + p.r) ** 2) continue;
    let x = pr.x, y = pr.y, vx = pr.vx, vy = pr.vy, n = 0;
    const xs = [x], ys = [y], ac = Math.exp((pr.accel || 0) * VDT);
    for (let j = 1; j <= VN && j * VDT < pr.life; j++) {
      if (pr.turn) { const a = Math.atan2(vy, vx) + pr.turn * VDT, s = Math.hypot(vx, vy); vx = Math.cos(a) * s; vy = Math.sin(a) * s; }
      vx *= ac; vy *= ac; x += vx * VDT; y += vy * VDT;
      if (D.blocksShots(D.tileAt(room, x, y), locked)) break;
      xs.push(x); ys.push(y); n = j;
    }
    if (n) get().pj.push({ xs, ys, n, hr: p.r + pr.r + 1, wt: wt(pr.dmg) });
  }
  for (const z of w.zones) {
    if (z.team !== 1 || z.dead) continue;
    const k = z.kind;
    if (k === 'tele' || k === 'teleLine' || k === 'teleCone') {
      const tl = z.dur - z.t;
      if (tl > VH || tl < -0.02 || z.t < react) continue;
      const x1 = z.x + Math.cos(z.a || 0) * (z.len || 0), y1 = z.y + Math.sin(z.a || 0) * (z.len || 0);
      if (k === 'teleLine' ? U.segDist2(p.x, p.y, z.x, z.y, x1, y1) > (z.w / 2 + R) ** 2 : U.dist2(z.x, z.y, p.x, p.y) > (z.r + R) ** 2) continue;
      const s = z.src, laser = !!s && !!s.def && !!s.def.pattern && s.def.pattern.type === 'laser'; // a warn-only line is the caster's aimed shot, dive, charge or beam (4 ticks): weighed by the caster's damage
      get().zn.push({ z, tl: Math.max(0, tl), x1, y1, ext: laser ? 0.4 : 0, wt: z.dmg > 0 ? wt(z.dmg) : s && s.dmg > 0 ? wt(s.dmg * (laser ? 4 : 1)) : 0.35 * low });
    } else if ((k === 'poison' || k === 'fire' || k === 'mire' || k === 'bind') && U.dist2(z.x, z.y, p.x, p.y) < (z.r + R) ** 2) get().ar.push({ x: z.x, y: z.y, r: z.r + p.r * 0.5, wt: k === 'mire' ? 0.12 : k === 'bind' ? 0.35 : 0.5 * low });
    else if (k === 'laser' && z.t < z.dur && U.segDist2(p.x, p.y, z.x, z.y, z.x + Math.cos(z.a) * z.len, z.y + Math.sin(z.a) * z.len) < (z.w / 2 + R) ** 2) get().ln.push({ z, x1: z.x + Math.cos(z.a) * z.len, y1: z.y + Math.sin(z.a) * z.len, left: z.dur - z.t, wt: wt(z.dmg) });
  }
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.spawnT > 0 || e.burrowed) continue;
    const d = e.def, M = d.ai === 'chaser' && d.lunge ? d.lunge : d.ai === 'tank' && d.bash ? d.bash : null;
    if (!M) continue;
    let r = SWING.get(e); // r.ok: the wind-up this state follows lasted `react`, so the hero saw it coming
    if (!r || r.st !== e.st) SWING.set(e, r = { st: e.st, t0: w.time, ok: !!r && r.st === 'windup' && w.time - r.t0 >= react });
    if (U.dist2(e.x, e.y, p.x, p.y) > (R + 140) ** 2) continue;
    const bash = d.ai === 'tank', go = bash ? 'bash' : 'lunge';
    let tw = -1, dur = M.dur;
    if (e.st === 'windup' && (!bash || e.vars.atk === 'bash')) { if (w.time - r.t0 >= react) tw = e.t; } else if (e.st === go && r.ok) { tw = 0; dur = e.t; }
    if (tw < 0 || tw > VH) continue;
    get().mv.push({ x: e.x, y: e.y, ca: Math.cos(e.aimA), sa: Math.sin(e.aimA), tw, sp: M.speed, dur, hr: e.r + p.r + 1, wt: wt(e.dmg) });
  }
  return T;
}

// Risk of hero p taking a heading (ux, uy) at `speed` (px/s; a dash: the dash speed, untouchable for DASH.t) against threats T: summed weights of the hits it would take, plus a small cost for standing on hazard tiles.
// reach = distance the heading allows; the hero stops there.
function vetRisk(T, p, ux, uy, reach, speed, dash) {
  const DT = ED.CONST.DASH.t, DS = ED.CONST.DASH.speed;
  const at = (t) => Math.min(dash ? DS * Math.min(t, DT) : speed * t, reach);
  let risk = 0;
  for (const q of T.pj) {
    for (let j = 1; j <= q.n; j++) {
      const t = j * VDT;
      if (dash && t <= DT) continue;
      const d = at(t);
      if (U.segDist2(p.x + ux * d, p.y + uy * d, q.xs[j - 1], q.ys[j - 1], q.xs[j], q.ys[j]) < q.hr * q.hr) { risk += q.wt; break; }
    }
  }
  for (const q of T.hm) {
    let x = q.x, y = q.y, vx = q.vx, vy = q.vy;
    const sp = Math.hypot(vx, vy);
    for (let j = 1; j <= q.n; j++) {
      const t = j * VDT, d = at(t), hx = p.x + ux * d, hy = p.y + uy * d, cur = Math.atan2(vy, vx);
      const na = cur + U.clamp(U.angDiff(cur, Math.atan2(hy - y, hx - x)), -q.rate * VDT, q.rate * VDT), nx = x + Math.cos(na) * sp * VDT, ny = y + Math.sin(na) * sp * VDT;
      if (!(dash && t <= DT) && U.segDist2(hx, hy, x, y, nx, ny) < q.hr * q.hr) { risk += q.wt; break; }
      vx = Math.cos(na) * sp; vy = Math.sin(na) * sp; x = nx; y = ny;
    }
  }
  for (const q of T.zn) {
    if (dash && q.tl <= DT) continue;
    const z = q.z;
    for (let k = 0; k < (q.ext ? 2 : 1); k++) { // a beam also hits for q.ext s after its warning ends
      const d = at(q.tl + k * q.ext), hx = p.x + ux * d, hy = p.y + uy * d;
      let hit;
      if (z.kind === 'tele') hit = U.dist2(hx, hy, z.x, z.y) < (z.r + p.r * 0.6 + 6) ** 2;
      else if (z.kind === 'teleLine') hit = U.segDist2(hx, hy, z.x, z.y, q.x1, q.y1) < (z.w / 2 + p.r * (z.warnOnly ? 0.9 : 0.6) + 6) ** 2;
      else { const dx = hx - z.x, dy = hy - z.y, dd = Math.hypot(dx, dy); hit = dd < z.r + p.r + 4 && Math.abs(U.angDiff(z.a, Math.atan2(dy, dx))) < z.arc / 2 + 6 / Math.max(dd, 30); }
      if (hit) { risk += q.wt; break; }
    }
  }
  for (const q of T.ln) { // a live beam hits every 0.12 s
    for (let t = 0.06; t <= q.left; t += 0.12) {
      if (dash && t <= DT) continue;
      const d = at(t);
      if (U.segDist2(p.x + ux * d, p.y + uy * d, q.z.x, q.z.y, q.x1, q.y1) < (q.z.w / 2 + p.r) ** 2) risk += q.wt;
    }
  }
  for (const q of T.ar) {
    let n = 0;
    for (let j = 1; j <= VN; j++) { const t = j * VDT; if (dash && t <= DT) continue; const d = at(t); if (U.dist2(p.x + ux * d, p.y + uy * d, q.x, q.y) < q.r * q.r) n++; }
    risk += q.wt * n / VN;
  }
  for (const q of T.mv) {
    for (let j = 1; j <= VN; j++) {
      const t = j * VDT;
      if (t < q.tw || (dash && t <= DT)) continue;
      const m = Math.min(t - q.tw, q.dur) * q.sp, d = at(t);
      if (U.dist2(p.x + ux * d, p.y + uy * d, q.x + q.ca * m, q.y + q.sa * m) < q.hr * q.hr) { risk += q.wt; break; }
    }
  }
  for (let j = 2; j <= VN; j += 2) {
    const t = j * VDT;
    if (dash && t <= DT) continue;
    const d = at(t);
    if (D.tileAt(T.room, p.x + ux * d, p.y + uy * d) === 4) risk += 0.05;
  }
  return risk;
}

// The dodge: (wx, wy) is the heading the fight wants. Keeps it when it is safe, else the safest of staying and 16 headings (a small cost for leaving the wanted heading); when even that risks a real hit, a dash heading that clears it.
// Returns { mx, my, risk (of the wanted heading), dash: [ux, uy] | null }.
function vetPlan(w, p, c, wx, wy, speed, T) {
  const room = w.room, locked = w.locked, wl = Math.hypot(wx, wy), has = wl > 0.05, wux = has ? wx / wl : 0, wuy = has ? wy / wl : 0;
  const risk0 = vetRisk(T, p, wux, wuy, has ? reachDist(room, locked, p.x, p.y, wux, wuy, speed * VH, p.r) : 0, speed, false);
  if (risk0 <= 0.02) return { mx: wx, my: wy, risk: 0, dash: null };
  let best = { mx: 0, my: 0, risk: vetRisk(T, p, 0, 0, 0, speed, false) }, bc = best.risk + (has ? 0.15 : 0);
  for (const [ux, uy] of VDIRS) {
    const r = vetRisk(T, p, ux, uy, reachDist(room, locked, p.x, p.y, ux, uy, speed * VH, p.r), speed, false), cost = r + (has ? 0.3 * (1 - (ux * wux + uy * wuy)) / 2 : 0.12);
    if (cost < bc) { bc = cost; best = { mx: ux, my: uy, risk: r }; }
  }
  let dash = null;
  if (best.risk >= 0.7 && c.dashN >= 1 && !p.skillMove && !(p.dashT > 0)) {
    let br = best.risk - 0.35;
    for (const [ux, uy] of VDIRS) {
      const r = vetRisk(T, p, ux, uy, reachDist(room, locked, p.x, p.y, ux, uy, ED.CONST.DASH.speed * ED.CONST.DASH.t, p.r), speed, true);
      if (r < br) { br = r; dash = [ux, uy]; }
    }
  }
  return { mx: best.mx, my: best.my, risk: risk0, dash };
}

// A dash heading for the owned dash riders, or null: dashDmg needs 3 foes struck by the 72 px path, dashFire 3 foes within 24 px of it, dashCloud / dashBomb the foes within 40 / 60 px of the start (counts add up, 3 are needed).
// The heading must be safe (no hazard landing, no hit waiting) and among equals lands farthest from the foes; one charge stays for dodging when the hero holds several.
function vetRider(w, p, c, foes, T, speed) {
  const st = p.stats, dmg = st.dashDmg > 0, fire = st.dashFire > 0, frost = st.dashCloud > 0, bomb = st.dashBomb > 0;
  if (!(dmg || fire || frost || bomb) || c.dashN < ((st.dashCharges | 0) > 1 ? 2 : 1) || p.skillMove || p.dashT > 0) return null;
  const near = foes.filter(e => U.dist2(e.x, e.y, p.x, p.y) < 160 * 160);
  if (near.length < 3) return null;
  const start = (frost ? near.filter(e => U.dist2(e.x, e.y, p.x, p.y) < (40 + e.r) ** 2).length : 0) + (bomb ? near.filter(e => U.dist2(e.x, e.y, p.x, p.y) < (60 + e.r) ** 2).length : 0);
  const len = ED.CONST.DASH.speed * ED.CONST.DASH.t;
  let best = null, bs = 2.5;
  for (const [ux, uy] of VDIRS) {
    const rd = reachDist(w.room, w.locked, p.x, p.y, ux, uy, len, p.r);
    if (rd < 40) continue;
    const x1 = p.x + ux * rd, y1 = p.y + uy * rd;
    let struck = 0, trail = 0, away = 1e9;
    for (const e of near) {
      const d2 = U.segDist2(e.x, e.y, p.x, p.y, x1, y1);
      if (d2 < (e.r + p.r + 8) ** 2) struck++;
      if (d2 < (e.r + 24) ** 2) trail++;
      away = Math.min(away, Math.hypot(e.x - x1, e.y - y1));
    }
    const n = start + (dmg && struck >= 3 ? struck : 0) + (fire && trail >= 3 ? trail : 0) + away / 1e4;
    if (n <= bs || D.tileAt(w.room, x1, y1) === 4 || (T && vetRisk(T, p, ux, uy, rd, speed, true) >= 0.3)) continue;
    bs = n; best = [ux, uy];
  }
  return best;
}

// ---------------- boss and champion arenas (room.arena, src/sim/arena.js) ----------------
// The bot reads an arena mechanic after its reaction time plus (1 - skill) x MECH_LAG s and misreads it (ignores it) with chance (1 - skill) x MECH_MISS; per mechanic instance (a beam zone, a tide, a lantern need, a ring).
// Drowned King: hides behind a pillar from a Tidal Beam (the King's ray to it stops short), stands where the tide will not reach (unsunk dais or beyond the water's reach), keeps out of the whirlpool core.
// Hollow King: in the dark keeps within a lit lantern's light, walks to the nearest unlit one and hits it when none burns long enough; before a ring falls walks inside the ring that stays.
// Returns null or { goal: {x, y} (where to stand), light: {x, y} (a lantern to hit) }.
const MECH_LAG = 0.8, MECH_MISS = 0.4;
function mechSeen(w, c, key, skill, brng) {
  const m = c.mech || (c.mech = new Map());
  let s = m.get(key);
  if (!s) { if (m.size > 64) m.clear(); m.set(key, s = { t: w.time, ok: brng.next() >= (1 - skill) * MECH_MISS }); }
  return s.ok && w.time - s.t >= VR + (1 - skill) * MECH_LAG;
}
// Pillar blocks of the room (tile 2 clusters inside the walls) as centres and half-diagonals, cached per room.
const PILLARS = new WeakMap();
function pillarsOf(room) {
  let ps = PILLARS.get(room);
  if (ps) return ps;
  ps = [];
  const seen = new Uint8Array(room.w * room.h);
  for (let y = 2; y < room.h - 1; y++) for (let x = 1; x < room.w - 1; x++) {
    const i = y * room.w + x;
    if (seen[i] || room.tiles[i] !== 2) continue;
    let x0 = x, x1 = x, y0 = y, y1 = y; const q = [i]; seen[i] = 1;
    while (q.length) { const j = q.pop(), jx = j % room.w, jy = (j / room.w) | 0; x0 = Math.min(x0, jx); x1 = Math.max(x1, jx); y0 = Math.min(y0, jy); y1 = Math.max(y1, jy); for (const k of [j - 1, j + 1, j - room.w, j + room.w]) if (!seen[k] && room.tiles[k] === 2) { seen[k] = 1; q.push(k); } }
    ps.push({ x: (x0 + x1 + 1) / 2 * T, y: (y0 + y1 + 1) / 2 * T, h: Math.hypot(x1 - x0 + 1, y1 - y0 + 1) / 2 * T });
  }
  PILLARS.set(room, ps);
  return ps;
}
const floorAt = (room, x, y) => D.tileAt(room, x, y) === 0;
// Nearest of the candidate points (Euclidean), or null.
const nearestPt = (p, pts) => { let b = null, bd = Infinity; for (const q of pts) { const d = U.dist2(q.x, q.y, p.x, p.y); if (d < bd) { bd = d; b = q; } } return b; };
function arenaBot(w, p, c, skill, brng) {
  const room = w.room, ar = room && room.arena, boss = w.boss;
  if (!ar || !boss || boss.hp <= 0) return null;
  if (ar.k === 'tide') return tideBot(w, p, c, skill, brng, room, ar, boss);
  if (ar.k === 'crown') return crownBot(w, p, c, skill, brng, room, ar);
  return null;
}
function tideBot(w, p, c, skill, brng, room, ar, boss) {
  const Tm = ED.Arena.tide, TD = Tm.TIDE;
  // where the water of the current tide reaches at its full extent
  const wet = (x, y) => { if (!(ar.st >= 1 && ar.st <= 3)) return false; for (let i = 0; i < 4; i++) if (((ar.m >> i) & 1) && Tm.depth(room, i, x, y) < ar.reach * Tm.span(room, i) + 14) return Tm.daisAt(room, ar, x, y) < 0; return false; };
  const tideOn = ar.st >= 1 && ar.st <= 3 && mechSeen(w, c, 'tide' + ar.n, skill, brng);
  const beam = w.zones.find(z => z.tidal && !z.dead && z.t < z.dur);
  const ox = boss.x, oy = boss.y - 6, hid = (x, y) => ED.Arena.ray(room, ox, oy, Math.atan2(y - oy, x - ox), 2000) < Math.hypot(x - ox, y - oy) - p.r;
  const cc = D.center(room), coreR = Tm.POOL.core + p.r + 16, inCore = (x, y) => ar.pool && Math.hypot(x - cc.x, y - cc.y) < coreR;
  const ok = (x, y) => hid(x, y) && !(tideOn && wet(x, y)) && !inCore(x, y);
  let goal = null;
  const h = c.hide, seen = beam && mechSeen(w, c, 'beam' + beam.id, skill, brng);
  if (seen && h && h.id === beam.id && ok(h.x, h.y)) goal = h; // hold the chosen cover while it still hides from the King
  else if (seen && ok(p.x, p.y)) goal = c.hide = { id: beam.id, x: p.x, y: p.y };
  else if (seen) {
    const spots = [];
    for (const q of pillarsOf(room)) {
      const d = Math.hypot(q.x - ox, q.y - oy) || 1, ux = (q.x - ox) / d, uy = (q.y - oy) / d, k = q.h + p.r + 12;
      for (const s of [0, -0.35, 0.35]) {
        const x = q.x + (ux * Math.cos(s) - uy * Math.sin(s)) * k, y = q.y + (uy * Math.cos(s) + ux * Math.sin(s)) * k;
        if (floorAt(room, x, y) && hid(x, y) && !inCore(x, y)) spots.push({ x, y, wet: tideOn && wet(x, y) });
      }
    }
    const dry = spots.filter(q => !q.wet);
    goal = nearestPt(p, dry.length ? dry : spots);
    if (goal) c.hide = { id: beam.id, x: goal.x, y: goal.y };
  }
  if (!goal && tideOn && wet(p.x, p.y)) {
    if (!c.dry || c.dryT !== ar.n) { // safe spots of this tide: unsunk dais centres and floor beyond the water's reach
      const pts = (room.dais || []).filter((d, i) => !((ar.sunk >> i) & 1)).map(d => ({ x: (d.x + d.w / 2) * T, y: (d.y + d.h / 2) * T }));
      for (let ty = 2; ty < room.h - 1; ty += 2) for (let tx = 1; tx < room.w - 1; tx += 2) { const x = (tx + 0.5) * T, y = (ty + 0.5) * T; if (floorAt(room, x, y) && !wet(x, y)) pts.push({ x, y }); }
      c.dry = pts; c.dryT = ar.n;
    }
    goal = nearestPt(p, c.dry);
  }
  if (ar.pool) { // out of the whirlpool core
    const d = Math.hypot(p.x - cc.x, p.y - cc.y);
    if (d < coreR && mechSeen(w, c, 'pool', skill, brng)) goal = goal || { x: cc.x + (p.x - cc.x) / (d || 1) * (coreR + 20), y: cc.y + (p.y - cc.y) / (d || 1) * (coreR + 20) };
  }
  return goal ? { goal } : null;
}
function crownBot(w, p, c, skill, brng, room, ar) {
  const Cm = ED.Arena.crown, DK = Cm.DARK, ls = room.lanterns || [];
  if (ar.dark && ls.length && mechSeen(w, c, 'dark', skill, brng)) {
    let best = null, bd = Infinity;
    for (let i = 0; i < ls.length; i++) if (ar.lit[i] > 2.5) { const d = U.dist2(ls[i].x, ls[i].y, p.x, p.y); if (d < bd) { bd = d; best = ls[i]; } }
    if (best && bd < (DK.lanR * 0.7) ** 2) return null; // standing in good light: fight on
    if (best && bd < 360 * 360) return { goal: best };
    let un = null; bd = Infinity;
    for (let i = 0; i < ls.length; i++) if (ar.lit[i] >= 0 && ar.lit[i] <= 2.5) { const d = U.dist2(ls[i].x, ls[i].y, p.x, p.y); if (d < bd) { bd = d; un = ls[i]; } }
    if (un) return { goal: un, light: un };
    return best ? { goal: best } : null;
  }
  if (ar.warn >= 0 && mechSeen(w, c, 'ring' + ar.warn, skill, brng)) {
    const lim = Cm.CRUMBLE.fall[ar.warn] - 0.07, q = (x, y) => Cm.qOf(room, Math.floor(x / T), Math.floor(y / T));
    if (q(p.x, p.y) > lim) {
      const pts = [];
      for (let ty = 2; ty < room.h - 1; ty++) for (let tx = 1; tx < room.w - 1; tx++) if (room.tiles[ty * room.w + tx] === 0 && Cm.qOf(room, tx, ty) <= lim) pts.push({ x: (tx + 0.5) * T, y: (ty + 0.5) * T });
      const g = nearestPt(p, pts);
      if (g) return { goal: g };
    }
  }
  return null;
}

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

// BELL_HAUL: px within which a Bellwarden bot winds its bells. PEAL_PACK: foes in the wave that make a bot ring the Peal. PEAL_RES: the Resonance a bot rings it at. BELL_STAND: px from its target's edge a bot keeps (hurl range, past a boss's melee reach).
// LEAP_PACK: foes at an out-of-hand bell that make a bot yank itself there. LINE_W: px either side of a hurl's line a foe counts as on it.
const BELL_HAUL = 220, PEAL_PACK = 3, PEAL_RES = 7, BELL_STAND = 105, LEAP_PACK = 2, LINE_W = 8;
// A Bellwarden bot plays the loop as ED.Bell.cycle models it: attack held while a foe is within BELL_HAUL; a one-tick release when ED.Bell.ready says so, the cursor past the last foe on the line from the hero
// that crosses the most foes within the hurl's reach (aim error by skill); held again at once (the bell reels home as it lands and winds on). c.bellRel: the release tick has passed.
function botBell(w, p, c, foes, tgt, inRange, skill, brng) {
  if (c.bellRel) { c.bellRel = false; p.haulIn = inRange; return; }
  p.haulIn = inRange;
  if (!inRange || !ED.Bell.ready(w, p)) return;
  const st = p.stats, R = ED.CONST.HURL_D, br = st.weapon.br * (1 + 0.5 * st.area);
  let best = tgt, bn = -1, far = 0;
  for (const e of foes) {
    const de = Math.hypot(e.x - p.x, e.y - p.y); if (de > R || de < 1) continue;
    const ux = (e.x - p.x) / de, uy = (e.y - p.y) / de;
    let n = 0, f = de;
    for (const g of foes) { const along = (g.x - p.x) * ux + (g.y - p.y) * uy; if (along < 0 || along > R) continue; const off = Math.abs((g.y - p.y) * ux - (g.x - p.x) * uy); if (off < br + g.r + LINE_W) { n++; f = Math.max(f, along); } }
    if (n > bn) { bn = n; best = e; far = f; }
  }
  const de = Math.hypot(best.x - p.x, best.y - p.y) || 1, a = Math.atan2(best.y - p.y, best.x - p.x) + gauss(brng) * AIM[0] * (1 - skill), k = Math.min(R, Math.max(de, far) + 20);
  p.face = a; p.aimX = p.x + Math.cos(a) * k; p.aimY = p.y + Math.sin(a) * k;
  p.haulIn = false; c.bellRel = true;
}
// Casts slot 0, 1 or 2 of hero p at foe tgt (distance d, angle a) when the skill's aim allows it; returns whether it was cast. Route stats shape the choice: Scattershot casts Volley at close range, Assassinate steps to a wounded foe.
// force (Capacitor detonation): a 'dir' or 'self' skill casts at any distance, a 'ground' skill lands at its range toward the foe; 'move' skills keep their range.
function botCast(w, p, slot, tgt, d, a, foes, brng, skill, force) {
  const st = p.stats, cls = ED.CLASSES[p.cls], id = slot === 2 ? cls.skill3 : slot ? cls.skill2 : cls.skill;
  if (!id || !ED.CAST[id]) return false;
  const N = ED.Stats.skillNums(id, st), sA = AIM[0] * (1 - skill), sP = AIM[1] * (1 - skill);
  let data = null, ang = a;
  if (id === 'step' && st.assassinate) {
    let bd = N.range * N.range;
    for (const e of foes) if (e.hp < e.maxHp * 0.5) { const d2 = U.dist2(e.x, e.y, p.x, p.y); if (d2 < bd) { bd = d2; tgt = e; } }
    d = Math.sqrt(U.dist2(tgt.x, tgt.y, p.x, p.y)); a = ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
  }
  if (id === 'heave') { // Anchor Leap: yank to an out-of-hand bell with LEAP_PACK foes (or an elite or boss) at it; else, every bell in hand, leap at a foe 70-180 px off, or away from it below 35% health
    const r = N.p.slam.r, all = p.bells.every(b => b.s === ED.Bell.STATES.HAND);
    let go = null;
    for (const b of p.bells) { if (b.s === ED.Bell.STATES.HAND) continue; let n = 0, big = false; for (const f of foes) if (U.dist2(f.x, f.y, b.x, b.y) < (r + f.r) ** 2) { n++; if (f.boss || f.elite) big = true; } if (n >= LEAP_PACK || big) { go = b; break; } }
    if (go) { p.aimX = go.x; p.aimY = go.y; ang = Math.atan2(go.y - p.y, go.x - p.x); }
    else if (all && p.hp < 0.35 * p.maxHp && d < 90) { ang = a + Math.PI; p.aimX = p.x + Math.cos(ang) * 200; p.aimY = p.y + Math.sin(ang) * 200; }
    else if (all && d > 70 && d < 180) { ang = a + gauss(brng) * sA; p.aimX = tgt.x; p.aimY = tgt.y; }
    else return false;
    w.playerSkill(p, ang, null, slot);
    return true;
  }
  switch (N.aim) {
    case 'dir':
      if (id === 'shieldthrow') { if (d >= 240 && !force) return false; data = { d: Math.hypot(tgt.x - p.x, tgt.y - (p.y - 4)) }; } else if (!force && d >= (id === 'volley' ? (st.volleyClose ? 110 : 160) : id === 'fireball' ? N.range - 20 : 220)) return false;
      ang = a + gauss(brng) * sA;
      break;
    case 'ground': {
      if (d >= N.range && !force) return false;
      const f = d >= N.range ? (N.range - 1) / d : 1; // a forced cast lands at its range on the line to the foe
      data = { x0: p.x, y0: p.y, x: p.x + (tgt.x - p.x) * f + gauss(brng) * sP, y: p.y + (tgt.y - p.y) * f + gauss(brng) * sP };
      break;
    }
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
      } else if (id === 'peal') { // ring the bells where they are: a foe in a wave and PEAL_RES Resonance or an elite or boss in it, or 2 x PEAL_PACK foes in it at any Resonance
        const r = N.p.wave.r * (1 + ED.CONST.RES_R * Math.min(1, (p.bellRes | 0) / ED.CONST.RES_MAX)), seen = new Set();
        let big = false;
        for (const b of p.bells) for (const f of foes) if (!seen.has(f) && U.dist2(f.x, f.y, b.x, b.y) < (r + f.r) ** 2) { seen.add(f); if (f.boss || f.elite) big = true; }
        const n = seen.size;
        if (!(n >= 2 * PEAL_PACK || (n >= 1 && ((p.bellRes | 0) >= PEAL_RES || big)))) return false;
      } else {
        const q = N.parts.find(x => x.on && x.r > 0), reach = id === 'vanish' || !q ? 160 : q.r + tgt.r + 6;
        if (d >= reach && !force) return false;
      }
    }
  }
  startMove(w, p, N, a, data);
  if (id === 'step') { p.x = data.x1; p.y = data.y1; }
  w.playerSkill(p, ang, data, slot);
  return true;
}

// Value in [0, 1) of the relic on prop x for hero p (PICK.relicValue), cached on the prop per hero until the hero's stat block or the stratum changes.
function relicScore(w, p, x) {
  const c = x.botVal || (x.botVal = {}), e = c[p.pid];
  if (e && e.st === p.stats && e.s === w.stratum) return e.v;
  const v = PICK.relicValue(w, p, x.item);
  c[p.pid] = { st: p.stats, s: w.stratum, v };
  return v;
}

// Next prop worth walking to, or null. Per-hero rewards respect p.claimed; shop and rest choices follow HP.
function wantedProp(w, p) {
  const hurt = p.hp < p.maxHp * 0.6;
  let best = null, bs = 0;
  for (const x of w.props) {
    if (x.state) continue;
    let s = 0;
    switch (x.kind) {
      case 'reward': s = PER_HERO_REWARDS.includes(x.item) && p.claimed[x.group] ? 0 : 9; break;
      case 'chest': s = 8; break;
      case 'relic': s = p.claimed[x.group] ? 0 : 7 + (w.botSmart ? relicScore(w, p, x) : 0); break;
      case 'campfire': s = !p.claimed[x.group] && hurt ? 8 : 0; break;
      case 'anvil': s = !p.claimed[x.group] && !hurt ? 8 : 0; break;
      case 'fountain': s = 5; break;
      case 'altar': s = p.hp > p.maxHp * 0.6 ? 5 : 0; break;
      case 'shop':
        if (w.gold < x.price) break;
        if (x.stype === 'potion') s = p.hp < p.maxHp * 0.7 ? 6 : 0;
        else s = x.stype === 'relic' ? 6 + (w.botSmart ? relicScore(w, p, x) : 0) : 7;
        break;
      default: break;
    }
    if (s > bs) { bs = s; best = x; }
  }
  return best;
}

// Value of a map room for the bot party: healthy (every living hero at DARK_HP of max HP or more) it prefers boon rewards, elites and dark rooms; hurt (any below HURT_HP) it prefers rest sites. Dark rooms follow the policy (smart: when healthy).
const HURT_HP = 0.5;
function roomValue(w, r, policy, healthy, hurt) {
  if (r.dark) return policy === 'never' ? -100 : policy === 'always' ? 100 : healthy ? 8 : -4;
  switch (r.type) {
    case 'rest': return hurt ? 12 : 2;
    case 'elite': return healthy ? 7 : hurt ? -2 : 3;
    case 'shop': return w.gold >= 100 ? 6 : 2;
    case 'treasure': return 8;
    case 'event': return 4;
    case 'combat': return r.reward === 'boon' ? 6 : r.reward === 'vigor' || r.reward === 'forge' ? 5 : 4;
    default: return 5; // champion, boss: the only way on
  }
}
// The exit to take, as { step: room id, dd: door key }, or null: the exit with the best path value V(n) = value(n) + LOOK x max V(child) (the whole graph ahead, each row further counting LOOK less),
// plus seeded jitter per floor and room. The pick holds for the room (w.botExit).
const LOOK = 0.6;
// The fewest dark rooms on any start-to-boss path of a floor.
function minDark(fl) {
  const M = new Map(), f = (id) => { if (M.has(id)) return M.get(id); const r = fl.rooms[id], k = r.exits || [], v = (r.dark ? 1 : 0) + (k.length ? Math.min(...k.map(f)) : 0); M.set(id, v); return v; };
  return f(fl.start);
}
function nextRoom(w, policy) {
  const room = w.room, fl = w.floor;
  if (!room.exits || !room.exits.length) return null;
  if (w.botExit && w.botExit.ep === w.roomEpoch) return w.botExit.nx;
  const live = [...w.players.values()].filter(q => !q.dead && !q.downed), frac = (q) => q.hp / Math.max(1, q.maxHp);
  const healthy = live.every(q => frac(q) >= DARK_HP), hurt = live.some(q => frac(q) < HURT_HP), jit = U.RNG((w.floorSeed ^ (room.id * 2654435761)) >>> 0);
  const V = new Map(), pathV = (id) => {
    if (V.has(id)) return V.get(id);
    const r = fl.rooms[id], kids = r.exits || [], v = roomValue(w, r, policy, healthy, hurt) + (kids.length ? LOOK * Math.max(...kids.map(pathV)) : 0);
    V.set(id, v); return v;
  };
  let best = null, bs = -1e9;
  for (const id of room.exits) {
    const s = pathV(id) + jit.next() * 2;
    if (s > bs) { bs = s; best = id; }
  }
  const nx = { step: best, dd: Object.keys(room.doors).find(k => room.doors[k] === best) };
  w.botExit = { ep: w.roomEpoch, nx };
  return nx;
}

// Direction toward the door of nextRoom, or null.
function exploreDir(w, p, policy) {
  const room = w.room, nx = nextRoom(w, policy);
  if (!nx) return null;
  const dd = nx.dd, sd = D.side(dd), r = D.doorRect(room, dd);
  const gx = (r.x0 + r.x1 + 1) / 2 * T + (sd === 'e' ? 30 : sd === 'w' ? -30 : 0), gy = (r.y0 + r.y1 + 1) / 2 * T + (sd === 's' ? 30 : sd === 'n' ? -30 : 0);
  return bfsDir(room, w.locked, p.x, p.y, U.clamp(gx, 4, room.w * T - 4), U.clamp(gy, 4, room.h * T - 4));
}

// Score of an element gate card: 500 plus seeded jitter 0-15 (no stratum favours an element).
function gateScore(p, el, stratum, rng) {
  return 500 + rng.next() * 15;
}

// Card score for the legacy policy: evolution > keystone > duo > boon of an own path (deepest path first) > element gate while a slot is free (not for a Generalist) > open General > class > anything.
function smartScore(p, id, ctx, rng) {
  const b = ED.BOONS[id];
  if (b.evo) return 1000;
  const gen = ED.isGeneralist(p.boons), els = ED.elementGates(p.boons), aff = (k) => ED.pathAffinity(p.boons, k);
  const rar = b.rar === 'r' ? 3 : b.rar === 'e' ? 4 : 1;
  if (b.key) return 900 + aff(b.path);
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

// Index of the card to take, or -1 (smart policy: reroll; call again with noReroll). A forced gate is taken whenever it is offered; class cards follow --route / --fork.
// Start offer: the requested card, else the best gain (smart, no --start) or uniform over the cards. smart: the card of best marginal gain (tools/pick.js); legacy: the v3 order below (forge: rank up the boon of the most-invested path); random: uniform.
function pickIndex(p, spec, policy, rng, ctx, noReroll) {
  const offer = p.offer, src = spec && spec.src;
  for (const f of ctx.force) { if (f.slot !== null && f.slot !== p.slot) continue; const i = offer.indexOf(f.id); if (i >= 0) return i; }
  if (src === 'start') {
    const want = wantedStart(p, ctx), i = want ? offer.indexOf(want) : -1;
    if (i >= 0) return i;
    return policy === 'smart' && ctx.startAuto ? PICK.chooseIndex(ctx.w, p, spec, rng, ctx, true) : Math.floor(rng.next() * offer.length);
  }
  if (src === 'class') { // route card, then the fork of that route
    const ct = spec.ctier | 0;
    if (ct === 1) { const i = offer.findIndex(id => ED.BOONS[id].route === p.botRoute); if (i >= 0) return i; }
    if (ct === 2) { const i = offer.indexOf(ED.CLASS_CARDS[p.cls][p.botRoute].forks[p.botFork]); if (i >= 0) return i; }
  }
  if (policy === 'smart') return PICK.chooseIndex(ctx.w, p, spec, rng, ctx, noReroll);
  if (policy !== 'legacy') return Math.floor(rng.next() * offer.length);
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

// One run's boss arrival as a record: team level, picks by source, damage (mean of one foe and pack, averaged over the heroes), effective health (mean over the heroes), power = damage x health.
function arrivalRun(a) {
  const mean = (v) => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length), dmg = mean(a.one.map((o, i) => (o + a.pack[i]) / 2)), ehp = mean(a.ehp);
  return { lvl: a.lvl, pk: a.pk, dmg, ehp, pow: dmg * ehp };
}

const median = (a) => { if (!a.length) return NaN; a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };

// One paired-measurement row of a finished run (--out/--pair): depth = bosses beaten + the share of the death stratum's combat and elite rooms cleared, boss time to kill and HP lost per stratum (fraction of max HP).
function rowOf(r, label, seed) {
  const kills = r.bossTry.filter(b => b.kill).length, ROOMS = SL.map(s => Math.round(D.rowsOf(s) * 0.7)); // combat-type rooms on a path (about 70% of the rows)
  const inS = r.clears.filter(c => c.s === r.stratum).length;
  const depth = r.victory ? SL.length : (r.from > 1 ? r.from - 1 : 0) + kills + Math.min(1, inS / ROOMS[Math.max(0, r.stratum - 1)]);
  return Object.assign({ label, seed, cls: r.cls, route: r.route.route, fork: r.route.fork, rank: r.route.rank, wi: r.wi, win: r.victory ? 1 : 0, depth: Math.round(depth * 1000) / 1000, bossTtk: SL.map(s => r.bossTimes[s] === undefined ? null : r.bossTimes[s]),
    hpLost: SL.map(s => r.dmgStrata[s - 1] === undefined ? null : Math.round(1000 * r.dmgStrata[s - 1] / Math.max(1, r.maxHp)) / 1000), evoS: r.evoAt ? r.evoAt.s : null, main: r.main, gates: r.gates.length, gen: r.gen ? 1 : 0,
    arrive: SL.map(s => { const a = r.arrive && r.arrive[s - 1]; if (!a) return null; const q = arrivalRun(a); return { lvl: q.lvl, pk: q.pk, dmg: Math.round(q.dmg * 10) / 10, ehp: Math.round(q.ehp), pow: Math.round(q.pow) }; }) }, r.from > 1 ? { from: r.from } : null);
}

// Weapon hits to kill a regular foe of stratum s: median over the roster (weighted) of ceil(foe HP / expected hit), expected hit = weapon damage x damage stat x crit factor (party and pact excluded).
function hitsToKill(w, p, s) {
  const st = p.stats, per = st.weapon.dmg * st.dmg * (1 + st.crit * (st.critMult - 1));
  const rows = ED.biomeFor(s).enemies.filter(([id]) => { const d = ED.ENEMIES[id]; return d && !d.boss && !d.ally && !d.minion; })
    .map(([id, wt]) => ({ h: Math.ceil(ED.ENEMIES[id].hp * ED.World.hpScale(s) / per), wt })).sort((a, b) => a.h - b.h);
  const tot = rows.reduce((a, r) => a + r.wt, 0);
  let acc = 0;
  for (const r of rows) { acc += r.wt; if (acc >= tot / 2) return r.h; }
  return NaN;
}

// Damage per second of the starting weapon with no boons (every attack hits once).
const bareDps = (cls, weapon) => { const wp = ED.WEAPONS[weapon]; return wp.dmg * (wp.n || 1) / wp.rate; };

// Resolves hero p's open offer with the pick policy (one reroll when the policy asks for it).
function takeOffer(w, p, policy, brng, ctx) {
  let ix = pickIndex(p, p.offers[0], policy, brng, ctx);
  if (ix < 0) { w.reroll(p.pid); ix = pickIndex(p, p.offers[0], policy, brng, ctx, true); }
  w.pickBoon(p.pid, ix);
}

// Hero p at a stratum start: team level, boon ranks, relics, gold, max HP, HP, keystones, evolved.
const entryOf = (w, p) => ({ level: w.level, boons: Object.values(p.boons).reduce((a, b) => a + b, 0), relics: p.relics.length, gold: w.gold, maxHp: p.maxHp, hp: Math.round(p.hp), keys: Object.keys(p.boons).filter(id => ED.BOONS[id].key).length, evo: p.stats.evo ? 1 : 0 });

// --from=N stage start: plays strata 1..N-1 without fighting and leaves the party at the start of stratum N.
// Each floor is its real Dungeon.generate floor. The rooms are the bot's exploration route (nextRoom with the --dark policy), entered with World.enterRoom;
// every foe dies the tick it exists, so the room's own wave timers, kill drops (xp, gold, hearts), clear reward and boss reward run as in play. Between rooms the bot claims every prop wantedProp names and picks every offer with its
// pick policy; the portal starts the next floor. Heroes are untouchable, hero 0 collects every pickup. Returns { t0 (game time at the end), from, keyAt, duoAt, evoAt (hero 0, first stratum), bad (reason the walk stopped early, or null) }.
// fight (--fight): 'boss' also walks stratum `from` the same way and enters its boss room; 'twins' / 'mimic' enter a combat room of stratum `from` (marked cleared, so no waves) and start that champion fight there.
// Both heal the party to full first; out.fight names the fight started.
function skipStrata(w, from, ctx, policy, brng, darkPolicy, fight) {
  const dt = 1 / 60, heroes = [...w.players.values()], lead = heroes[0], out = { t0: 0, from, keyAt: null, duoAt: null, evoAt: null, bad: null };
  const tick = () => {
    for (const p of heroes) { if (p.offer) takeOffer(w, p, policy, brng, ctx); p.invuln = 1; }
    for (const e of w.enemies.slice()) if (e.hp > 0) w.killEnemy(e, lead, { kind: 'weapon' });
    w.update(dt);
    for (const pk of w.pickups) w.collect(lead, pk);
    for (const ev of w.fx) {
      if (ev.pid !== lead.pid) continue;
      if (ev.t === 'boon') { const b = ED.BOONS[ev.id]; if (b.key && !out.keyAt) out.keyAt = w.stratum; } else if (ev.t === 'evolve' && !out.evoAt) out.evoAt = { s: w.stratum, lvl: w.level };
    }
    w.pickups.length = 0; w.fx.length = 0; w.msgs.length = 0;
  };
  const settle = () => { for (let i = 0; i < 900 && heroes.some(p => p.offer || p.offers.length); i++) tick(); };
  const claim = () => {
    for (let guard = 0; guard < 80; guard++) {
      let did = false;
      for (const p of heroes) {
        const pr = wantedProp(w, p);
        if (!pr) continue;
        p.x = pr.x; p.y = pr.y; w.interact(p.pid, pr.id); did = true;
        tick();
      }
      if (!did) break;
    }
    settle();
  };
  const hop = () => { const nx = nextRoom(w, darkPolicy); return nx ? [nx.step, nx.dd] : null; }; // the bot's route (exploreDir's room choice)
  for (let s = 1; s < from && w.state === 'play' && !out.bad; s++) {
    settle();
    claim();
    for (let rooms = 0; rooms < 40 && w.state === 'play' && !w.props.some(x => x.kind === 'portal'); rooms++) {
      const h = hop();
      if (!h) break;
      w.enterRoom(h[0], h[1]);
      for (let i = 0; i < 60 * 150 && w.locked && w.state === 'play'; i++) tick();
      claim();
    }
    const portal = w.props.find(x => x.kind === 'portal' && !x.state);
    if (!portal) { out.bad = `no portal on stratum ${s} (room ${w.roomId} ${w.room.type})`; break; }
    lead.x = portal.x; lead.y = portal.y; w.interact(lead.pid, portal.id);
    for (let i = 0; i < 600 && w.stratum === s && w.state === 'play'; i++) tick();
    if (w.stratum === s) out.bad = `stuck on stratum ${s}`;
  }
  let bossHop = null;
  if (fight === 'boss' && w.state === 'play' && !out.bad) {
    settle();
    claim();
    for (let rooms = 0; rooms < 40 && w.state === 'play'; rooms++) {
      const h = hop();
      if (!h) break;
      if (w.floor.rooms[h[0]].type === 'boss') { bossHop = h; break; }
      w.enterRoom(h[0], h[1]);
      for (let i = 0; i < 60 * 150 && w.locked && w.state === 'play'; i++) tick();
      claim();
    }
    if (!bossHop) out.bad = `no way to the boss of stratum ${from}`;
  }
  for (const p of heroes) p.invuln = 0;
  settle();
  w.fx.length = 0; w.msgs.length = 0;
  w.run.kills = 0; w.run.fodderKills = 0; w.run.roomsVisited = 1; w.run.roomsTotal = w.floor.rows + 2; // the run's stats start at stratum N
  if (fight && !out.bad) for (const p of heroes) { p.hp = p.maxHp; p.downed = false; p.dead = false; }
  out.t0 = w.time;
  if (bossHop) { w.enterRoom(bossHop[0], bossHop[1]); out.fight = 'boss'; }
  else if ((fight === 'twins' || fight === 'mimic') && !out.bad) {
    const room = w.floor.rooms.find(r => r.type === 'combat' && !r.dark) || w.floor.rooms.find(r => r.type === 'elite');
    const dd = room && Object.keys(room.doors).find(k => room.doors[k] >= 0);
    if (!room || !dd) out.bad = `no combat room on stratum ${from}`;
    else { w.roomState[room.id].cleared = true; room.champ = fight; w.enterRoom(room.id, D.OPP[dd]); w.startChampion(room); out.fight = fight; }
  }
  return out;
}

function runBot(opts) {
  U.resetUid(1);
  const brng = U.RNG((opts.seed ^ 0xb07b07) >>> 0), policy = opts.pick || process.env.PICK || 'random';
  VR = opts.vetReact >= 0 ? opts.vetReact : 0.18;
  PICK.setLambda(opts.lambda);
  const vet = parseVet(opts.vet), vetC = !!vet && vet.has('charges'), vetR = !!vet && vet.has('rider'), vetD = !!vet && vet.has('dodge'), vetH = !!vet && vet.has('hazard');
  AIM[0] = opts.aimNoise ? opts.aimNoise[0] : 0.12; AIM[1] = opts.aimNoise ? opts.aimNoise[1] : 36;
  const forced = (opts.force || []).map(f => { const m = /^([a-z_]+)(?:@(\d+))?$/.exec(f); return m ? { id: m[1], slot: m[2] === undefined ? null : +m[2] } : null; }).filter(Boolean);
  const ctx = { force: forced.filter(f => ED.BOONS[f.id] && ED.BOONS[f.id].gate), gatesCap: opts.gates || 2, start: opts.start || 'random', startAuto: !opts.start, explain: !!opts.explain, w: null };
  const players = [];
  for (let i = 0; i < opts.n; i++) {
    const cls = opts.cls[i % opts.cls.length];
    players.push({ pid: 'p' + i, name: 'Bot' + i, slot: i, cls, weapon: typeof opts.weapon === 'string' && ED.weaponIndex(cls, opts.weapon) >= 0 ? opts.weapon : ED.CLASSES[cls].weapons[opts.weapon || 0], // a weapon index, or a weapon id of the hero (an Armory variant)
      meta: { up: opts.up || ED.UPGRADES.map(() => 0), mastery: opts.mastery || 1 } });
  }
  const bossS = Math.max(1, Math.min(opts.from | 0, ED.CONST.STRATA)), boss0 = ED.BIOMES[bossS - 1].boss; // --bosstype: the boss of the --from stratum for this run (restored at the end)
  if (opts.bosstype && ED.ENEMIES[opts.bosstype] && ED.ENEMIES[opts.bosstype].boss) ED.BIOMES[bossS - 1].boss = opts.bosstype;
  const w = new ED.World({ seed: opts.seed, pact: opts.pact || 0, players, tutorial: opts.tutorial });
  ctx.w = w; w.botSmart = policy === 'smart';
  w.startRun();
  for (const p of w.players.values()) { // route and fork of each hero: the flags, else seeded uniform per run and hero
    const rr = U.RNG((opts.seed ^ 0x5a17 ^ Math.imul(p.slot + 1, 7919)) >>> 0);
    const r1 = Math.floor(rr.next() * 4), f1 = Math.floor(rr.next() * 2);
    p.botRoute = ED.ROUTES.includes(opts.route) ? opts.route : ED.ROUTES[r1];
    p.botFork = opts.fork === 0 || opts.fork === 1 ? opts.fork : f1;
  }
  const htkBare = hitsToKill(w, w.players.values().next().value, 1);
  const pickN = PICK_SRC.map(() => 0), pickLead = w.players.keys().next().value, pick0 = w.pickBoon; // hero 0's picks by offer source, counted from the start pick on (the --from walk included)
  const purse = SL.map(() => [0, 0, 0]); // hero 0's offers per stratum: [offers, offers showing the Purse, Purse picks] (pool exhaustion)
  w.pickBoon = function (pid, idx) {
    const p = this.players.get(pid);
    if (pid === pickLead && p && p.offer) {
      const k = PICK_SRC.indexOf(p.offers[0] && p.offers[0].src); pickN[k < 0 ? PICK_SRC.length - 1 : k]++;
      const ps = purse[Math.min(ED.CONST.STRATA, Math.max(1, this.stratum)) - 1]; ps[0]++; if (p.offer.includes('purse')) { ps[1]++; if (p.offer[idx] === 'purse') ps[2]++; }
    }
    return pick0.call(this, pid, idx);
  };
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
  const skip = opts.from > 1 || opts.fight ? skipStrata(w, Math.max(1, Math.min(opts.from | 0, ED.CONST.STRATA)), ctx, policy, brng, opts.dark, opts.fight) : null; // --from: strata 1..N-1 are played before the recorders below are installed
  const rec = { dark: zeros(), left: [], clears: [], bossTimes: [], dmgBy: {}, downedBy: [], dealtStrata: [], heal: {}, dmgByS: {}, spawns: {}, offers: {}, relicsBy: {}, goldIn: 0, roomDmg: 0, dmgStrata: [], hpFrac: [], healSrc: 'other' };
  rec.evoAt = null; // { s: stratum, lvl: team level } when hero 0 takes its evolution
  rec.dmgByHero = {}; // health lost per hero (pid)
  const fightRec = skip && skip.fight ? { k: skip.fight, t0: skip.fight === 'boss' ? null : w.time, t: null, kill: false, ph: 0 } : null; // --fight: { kind, start, seconds to the kill, kill, boss phase reached }
  rec.arrive = []; // per stratum (index = stratum - 1): arrivalOf at the first entry of the boss room
  rec.keyAt = null; rec.duoAt = null; // stratum when hero 0 takes its keystone / duo
  rec.cnt = { smite: 0, reap: 0, toll: 0, lance: 0, dashHits: 0, pdodge: 0, shatter: 0, back: 0, direct: 0, holds: 0, dis: 0, reapHp: 0, kills0: 0, refunds: 0, parries: 0, staggers: 0, rics: 0, gRics: 0, catches: 0, casts: {} };
  rec.parts = {}; rec.projDmgS = []; rec.maxHost = 0; // damage by skill part / source, hero damage taken from shots per stratum (fraction of max HP), most foes standing in the current room
  rec.smokeSeen = new Set(); rec.upt = { brace: [0, 0], sanct: [0, 0], stun: [0, 0], smoke: [0, 0, 0], mom: [0, 0] }; rec.peak = { projs: 0, zones: 0 }; // uptimes as [on, of] tick counts, peak shots and zones of hero 0
  rec.shield = { gained: {}, absorbed: {}, holyBoss: 0 }; rec.bossSecs = 0;
  const shMix = new Map(); for (const p of w.players.values()) shMix.set(p.pid, {}); // shield composition per hero by source (absorption is attributed pro rata)
  const p0id = w.players.keys().next().value;
  rec.entry = {}; // hero state at the start of each stratum (stratum -> entryOf)
  if (skip) { rec.evoAt = skip.evoAt; rec.keyAt = skip.keyAt; rec.duoAt = skip.duoAt; rec.entry[w.stratum] = entryOf(w, w.players.get(p0id)); }
  // damage metrics: hero damage by source per stratum, combat seconds, observed hits/time to kill, analytic hits to kill, cooldown reduction
  Object.assign(rec, { src: [], combatS: zeros(), hits: lists(), ttk: lists(), ttkElite: lists(), htk: lists(), htkBare, bossTry: [] });
  const hit0 = w.hitEnemy;
  w.hitEnemy = function (e, base, src) {
    const sg0 = e.staggerT, d = hit0.call(this, e, base, src);
    if (!(d > 0)) return d;
    if (e.staggerT > sg0 + 0.5) rec.cnt.staggers++;
    const k = (src && src.kind) || 'weapon', bucket = rec.src[this.stratum - 1] || (rec.src[this.stratum - 1] = Object.fromEntries(BUCKETS.map(b => [b, 0])));
    const direct = k !== 'dot' && !PAYOFF_KINDS.has(k) && !(src && src.raw && k === 'explode');
    if (src && src.p) { bucket[dmgSource(src, k)] += d; const pn = src.part || (src.wpn ? 'weapon' : k); rec.parts[pn] = (rec.parts[pn] || 0) + d; }
    if (k === 'dash') rec.cnt.dashHits++;
    if (src && src.p && src.p.pid === p0id && direct) { rec.cnt.direct++; if (src.back) rec.cnt.back++; } // hero 0's direct hits and the Backstabs among them
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
    for (let i = n0; i < this.fx.length; i++) if (this.fx[i].t === 'hurt') { rec.dmgByHero[p.pid] = (rec.dmgByHero[p.pid] || 0) + this.fx[i].v; rec.dmgBy[who] = (rec.dmgBy[who] || 0) + this.fx[i].v; const bs = rec.dmgByS[this.stratum] || (rec.dmgByS[this.stratum] = {}); bs[who] = (bs[who] || 0) + this.fx[i].v; rec.roomDmg += this.fx[i].v; rec.dmgStrata[this.stratum - 1] = (rec.dmgStrata[this.stratum - 1] || 0) + this.fx[i].v; rec.hpFrac[this.stratum - 1] = (rec.hpFrac[this.stratum - 1] || 0) + this.fx[i].v / p.maxHp; if (src && (src.proj || src.pr)) rec.projDmgS[this.stratum - 1] = (rec.projDmgS[this.stratum - 1] || 0) + this.fx[i].v / p.maxHp; }
    if (sh0 > p.shield) { // shield absorbed this hit: attribute it to the sources in the shield's make-up
      const ab = sh0 - p.shield, mix = shMix.get(p.pid);
      let tot = 0; for (const k in mix) tot += mix[k];
      for (const k in mix) { const take = tot > 0 ? ab * mix[k] / tot : 0; mix[k] -= take; rec.shield.absorbed[k] = (rec.shield.absorbed[k] || 0) + take; if (k === 'holy' && this.boss) rec.shield.holyBoss += take / p.maxHp; }
    }
    if (!was && p.downed) rec.downedBy.push(who + '@s' + this.stratum);
    return r;
  };
  // shield make-up by source: gains (addShield) add to it, decay scales it
  const add0 = w.addShield, dec0 = w.updateShields, reap0 = w.checkReap;
  w.addShield = function (p, amt, cap, k) { const g = add0.call(this, p, amt, cap, k); if (g > 0) { const m = shMix.get(p.pid); m[k] = (m[k] || 0) + g; rec.shield.gained[k] = (rec.shield.gained[k] || 0) + g; } return g; };
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
  // per-room tally: kills (threat / fodder) and the xp dropped, counted from the pickups a drop appends
  rec.room = { th: 0, fo: 0, xp: 0, clip: 0 };
  const kill1 = w.killEnemy, xp1 = w.dropXp;
  w.killEnemy = function (e, p, src) { if (!e.killed && !e.boss) { if (e.fodder) rec.room.fo++; else rec.room.th++; } return kill1.call(this, e, p, src); };
  w.dropXp = function (x, y, total, exact) {
    const n0 = this.pickups.length, r = xp1.call(this, x, y, total, exact);
    for (let i = n0; i < this.pickups.length; i++) if (this.pickups[i].kind === 'xp') rec.room.xp += this.pickups[i].val;
    if (this.enc && this.enc.xpClip) rec.room.clip = this.enc.xpClip;
    return r;
  };
  const ctl = {};
  for (const p of w.players.values()) ctl[p.pid] = { atk: 0, skill: 0, skill2: 0, skill3: 0, chg3: p.stats.skill3Charges, dashN: p.stats.dashCharges, dashT: 0, goal: null, attn: true, attnT: 0, chg: p.stats.maxCharges, mchg: p.stats.maxCharges, vgap: 0, appT: 0 };
  const dt = 1 / 60, touch = [], crowd = [];
  let steps = 0;
  const maxSteps = 60 * MAX_SECONDS;
  const log = skip && skip.bad ? ['  FROM: ' + skip.bad] : [];
  const strata = skip ? new Array(skip.from - 1) : []; // seconds spent per stratum (index = stratum - 1; the skipped strata stay empty)
  if (skip) rec.dealtStrata = new Array(skip.from - 1);
  let stratumStart = skip ? skip.t0 : 0, bossStart = 0, dealt0 = 0;
  const totalDealt = () => { let d = 0; for (const p of w.players.values()) d += p.dealt; return d; };
  while (w.state !== 'over' && steps < maxSteps) {
    steps++;
    for (const p of w.players.values()) {
      const c = ctl[p.pid];
      c.atk -= dt; c.skill2 -= dt; ED.Sim.dashTick(c, p.stats, dt); c.goal = null;
      if (vetC) { // skill charges as the client keeps them: a charge refills each skillCd while below the maximum, a new maximum (Echo) grants its charge at once
        const mc = p.stats.maxCharges;
        if (mc > c.mchg) c.chg += mc - c.mchg;
        c.mchg = mc; c.chg = Math.min(c.chg, mc); c.vgap -= dt;
        if (c.chg < mc) { c.skill -= dt; while (c.skill <= 0 && c.chg < mc) { c.chg++; c.skill = c.chg < mc ? c.skill + botCd(p, 0) : 0; } }
      } else c.skill -= dt;
      { const m3 = p.stats.skill3Charges; c.chg3 = Math.min(c.chg3, m3); if (c.chg3 < m3) { c.skill3 -= dt; while (c.skill3 <= 0 && c.chg3 < m3) { c.chg3++; c.skill3 = c.chg3 < m3 ? c.skill3 + p.stats.skill3Cd : 0; } } } // skill 3 charges as the client keeps them
      if (p.offer) takeOffer(w, p, policy, brng, ctx);
      if (p.downed || p.dead) continue;
      let mx = 0, my = 0;
      const foes = w.enemies.filter(e => e.hp > 0 && e.spawnT <= 0);
      const skill = opts.skill ?? 0.75;
      if (!foes.length && p.haulIn) p.haulIn = false; // a Bellwarden stops winding with no foe left
      if (foes.length) {
        // target: the nearest threat foe when it is within weapon reach (or when no fodder stands), else the nearest fodder
        let tgt = null, bd = 1e9, nf = null, fd = 1e9;
        for (const e of foes) { const d2 = U.dist2(e.x, e.y, p.x, p.y); if (e.fodder) { if (d2 < fd) { fd = d2; nf = e; } } else if (d2 < bd) { bd = d2; tgt = e; } }
        const close = p.stats.melee || p.stats.kind === 'bell', reachW = p.stats.kind === 'bell' ? ED.Bell.orbit(p.stats.weapon) + p.stats.weapon.br + 20 : p.stats.weapon.range; // a bell fights at its orbit, like a melee weapon
        if (nf && (!tgt || Math.sqrt(bd) - (close ? tgt.r : 0) >= (close ? reachW : 380))) { tgt = nf; bd = fd; }
        const piece = w.boss ? arenaTarget(w, foes, p) : null; // boss fights: spore buds and pods before the boss
        if (piece) { tgt = piece; bd = U.dist2(piece.x, piece.y, p.x, p.y); }
        const d = Math.sqrt(bd);
        const bell = p.stats.kind === 'bell', ideal = bell ? BELL_STAND + tgt.r : p.stats.melee ? (p.stats.weapon.range * 0.6 + tgt.r) : (p.stats.deadeye ? 230 : 170); // Deadeye keeps its distance; a Bellwarden circles at hurl range
        if (vetH) c.appT = d > ideal + 30 ? c.appT + dt : 0; // seconds spent closing in without arriving
        let dir;
        if (d > ideal + 10) dir = bfsDir(w.room, w.locked, p.x, p.y, tgt.x, tgt.y);
        else if (d < ideal - 20) dir = [p.x - tgt.x, p.y - tgt.y];
        else dir = [-(tgt.y - p.y), tgt.x - p.x];
        if (p.stats.backstab > 0 && !bell && !tgt.boss && d < ideal + 120 && brng.next() < skill) { const fa = tgt.faceA || 0, bx = tgt.x - Math.cos(fa) * ideal, by = tgt.y - Math.sin(fa) * ideal; dir = Math.hypot(bx - p.x, by - p.y) > 6 ? [bx - p.x, by - p.y] : [0, 0]; } // Backstab: stand behind the foe's facing
        const ag = arenaBot(w, p, c, skill, brng); // boss arena mechanics: where to stand, a lantern to hit
        if (ag && ag.goal) { const gd = Math.hypot(ag.goal.x - p.x, ag.goal.y - p.y); dir = gd > 8 ? bfsDir(w.room, w.locked, p.x, p.y, ag.goal.x, ag.goal.y) : [0, 0]; }
        // dodge projectiles
        let danger = false;
        if (!vetD) { // --vet dodge: the look-ahead plan below replaces these
          for (const pr of w.projs) if (pr.team === 1 && U.dist2(pr.x, pr.y, p.x, p.y) < 55 * 55) { danger = true; dir = [dir[0] + (p.x - pr.x) * 2, dir[1] + (p.y - pr.y) * 2]; }
          for (const z of w.zones) if ((z.kind === 'tele' || z.kind === 'poison' || z.kind === 'fire') && z.team === 1 && U.dist2(z.x, z.y, p.x, p.y) < (z.r + 12) ** 2) { danger = true; dir = [p.x - z.x + dir[0] * 0.2, p.y - z.y + dir[1] * 0.2]; }
          if (w.boss && c.attn) { const bd = bossDodge(w, p, VR); if (bd) { danger = true; dir = [bd[0] + dir[0] * 0.1, bd[1] + dir[1] * 0.1]; } } // boss fights: out of swing cones and strike lines it has seen
        }
        let l = Math.hypot(dir[0], dir[1]) || 1;
        const esc = crowdEscape(w, p, w.foesNear(p.x, p.y, CROWD_R + 60, crowd));
        if (esc) { dir = [esc[0] + dir[0] / l * 0.35, esc[1] + dir[1] / l * 0.35]; l = Math.hypot(dir[0], dir[1]) || 1; } // out of a crowd (the walking slow), keeping a little of the chase
        mx = dir[0] / l; my = dir[1] / l;
        if (brng.next() > skill) { mx += (brng.next() - 0.5) * 1.5; my += (brng.next() - 0.5) * 1.5; }
        c.tgt = tgt; c.carpetOk = !!w.boss && p.stats.melee && (tgt === w.boss || tgt === piece); // a melee hero walks through spore carpet to reach the boss or a pod
        let forced = null; // boss arena: an attentive bot walks out of a lane charge's band (dashing in its last 0.3 s) and off spore carpet unless it is hitting the boss in melee
        if (w.boss && c.attn) {
          const le = laneEscape(w, p, VR);
          if (le) { mx = le.d[0]; my = le.d[1]; danger = true; forced = le; }
          else if (!(c.carpetOk && d - tgt.r < p.stats.weapon.range + 10)) { const ce = carpetEscape(w, p); if (ce) { mx = ce[0]; my = ce[1]; } }
        }
        let plan = null, T = null;
        const spd = vetD || vetR ? p.stats.moveSpeed * ED.Stats.moveRate(p) : 0;
        if (vetD || vetR) T = vetThreats(w, p, spd, c.attn ? VR : VR + VLAPSE);
        if (vetD && T && !forced) { plan = vetPlan(w, p, c, mx, my, spd, T); mx = plan.mx; my = plan.my; danger = plan.risk > 0.02; }
        const a = Math.atan2(tgt.y - p.y, tgt.x - p.x), st = p.stats;
        const inRange = bell ? d < BELL_HAUL : st.melee ? d - tgt.r < st.weapon.range : d < 380; // a bell: wind (attack held) while a foe is near
        let atkA = a, atkIn = inRange, atkD = d;
        if (ag && ag.light) { atkD = Math.hypot(ag.light.x - p.x, ag.light.y - p.y); atkA = Math.atan2(ag.light.y - p.y, ag.light.x - p.x); atkIn = st.melee ? atkD < st.weapon.range + 8 : atkD < 320; } // swings and shots go at the lantern
        const held = !bell && !(ag && ag.light) && botHold(w, p, c, foes, tgt, atkD, atkA, atkIn, brng, skill);
        if (held && p.holdOn) rec.cnt.holds += p.pid === p0id && p.holdT === 0 ? 1 : 0;
        if (bell) botBell(w, p, c, foes, tgt, inRange, skill, brng);
        else if (!held && c.atk <= 0 && atkIn) {
          p.atkD = atkD; // the cursor on the target (a lobbed weapon lands there)
          w.playerAttack(p, atkA + gauss(brng) * AIM[0] * (1 - skill));
          c.atk = Math.max(c.atk, -dt) + ED.Stats.stepInterval(p); // carries the overshoot of this tick, as the client does
        }
        if (vetC) { if (c.chg > 0 && c.vgap <= 0 && !p.skillMove && botCast(w, p, 0, tgt, d, a, foes, brng, skill)) { if (c.chg === st.maxCharges) c.skill = botCd(p, 0); c.chg--; c.vgap = 0.35; } }
        else if (c.skill <= 0 && botCast(w, p, 0, tgt, d, a, foes, brng, skill)) c.skill = botCd(p, 0);
        if (c.skill2 <= 0 && st.skill2Cd && botCast(w, p, 1, tgt, d, a, foes, brng, skill)) c.skill2 = botCd(p, 1);
        if (c.chg3 > 0 && !p.skillMove && botCast(w, p, 2, tgt, d, a, foes, brng, skill)) { if (c.chg3 === st.skill3Charges) c.skill3 = st.skill3Cd; c.chg3--; } // skill 3 (Fireball): charges like skill 1
        let dd = null; // --vet: the dash heading of the dodge plan, else of a rider dash through a pack
        if (forced && forced.tl < 0.3 && c.dashN >= 1 && !(p.dashT > 0) && !p.skillMove) dd = forced.d;
        else if ((dd = botPerfect(w, p, c, skill, brng))) rec.cnt.pdodge += p.pid === p0id ? 1 : 0; // Holy: dash through the attack
        else if ((dd = botDischarge(p, c, foes))) rec.cnt.dis += p.pid === p0id ? 1 : 0; // Lightning: dash through the charged pack
        else if (vetD && plan && plan.dash) dd = plan.dash; else if (vetR && !danger) dd = vetRider(w, p, c, foes, T, spd);
        if (dd) botDash(w, p, c, dd[0], dd[1], foes);
        else if (!vetD && danger && c.dashN >= 1 && brng.next() < skill * 0.5) botDash(w, p, c, mx, my, foes);
        else if (!vetR && !danger && c.dashN >= 1 && d <= 90 && (p.stats.dashDmg || p.stats.dashFire || p.stats.dashBomb || p.stats.dashCloud || p.stats.decoy || p.stats.stepBehind) && brng.next() < skill * 0.5) { // dash rider: dash through the target
          const l2 = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1;
          botDash(w, p, c, (tgt.x - p.x) / l2, (tgt.y - p.y) / l2, foes);
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
        } else dir = exploreDir(w, p, opts.dark);
        if (dir) { const l = Math.hypot(dir[0], dir[1]) || 1; mx = dir[0] / l; my = dir[1] / l; }
      }
      // floor hazards: the bot watches the ground on a share `skill` of its ticks (redrawn every 0.25 s) and steers off or around hazard tiles
      if ((c.attnT -= dt) <= 0) { c.attn = brng.next() < (vetD ? 1 - (1 - skill) / 2 : skill); c.attnT = 0.25; } // --vet dodge: half the lapses
      if ((c.attn || (vetH && foes.length && c.appT < 3)) && (mx || my)) { const v = avoidHazard(w.room, p, mx, my, c.carpetOk); mx = v[0]; my = v[1]; } // --vet hazard: always watches the ground in a fight, unless 3 s of closing in on a foe have not arrived (it stands across hazard floor)
      if (opts.trace) opts.trace(w, p, mx, my, foes, c);
      ED.Sim.movePlayer(p, { mx, my }, dt, w.room, w.locked, w.zones, w.foesNear(p.x, p.y, 40, touch));
    }
    if (w.locked && w.stratum >= 1 && w.hostiles() > 0) rec.combatS[w.stratum - 1] += dt;
    if (w.boss && w.boss.hp > 0) rec.bossSecs += dt;
    w.update(dt);
    if (w.boss && w.boss.furyM > 1 && rec.bossTry.length) rec.bossTry[rec.bossTry.length - 1].m = w.boss.furyM; // the last fury multiplier seen alive = the one at the kill or at death
    if (w.locked) rec.maxHost = Math.max(rec.maxHost, w.hostiles());
    if (w.locked && w.hostiles() > 0) { // uptimes while a fight is on, hero 0
      const h0 = w.players.get(p0id), u = rec.upt;
      u.brace[1]++; if (h0.braceT > 0) u.brace[0]++;
      u.sanct[1]++; for (const z of w.zones) if (z.kind === 'sanct' && U.dist2(z.x, z.y, h0.x, h0.y) < z.r * z.r) { u.sanct[0]++; break; }
      u.mom[1]++; u.mom[0] += h0.momN | 0;
      for (const e of w.enemies) if (e.hp > 0 && !e.boss && !e.elite && e.spawnT <= 0) { u.stun[1]++; if (e.stun > 0) u.stun[0]++; }
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
    for (const m of w.msgs) if (m.t === 'dashRefund' && ctl[m.to]) { const k = ctl[m.to]; k.dashN = Math.min(w.players.get(m.to).stats.dashCharges | 0, k.dashN + ((m.n | 0) || 1)); } // dash charges back { n } (Umbral Arms), as game.js
    for (const m of w.msgs) if (m.t === 'refund' && ctl[m.to]) { // cooldown refunds { slot, s } as the client applies them (slot -1: the Ember cut on every slot, not counted as a refund)
      const k = ctl[m.to], hp = w.players.get(m.to), sl = m.slot;
      if (sl !== -1) rec.cnt.refunds++;
      if (sl === 1 || sl === -1) k.skill2 = m.s ? k.skill2 - m.s : 0;
      if (sl === 0 || sl === -1) { if (vetC && !m.s) k.chg = Math.min(k.mchg, k.chg + 1); else if (!vetC || k.chg < k.mchg) k.skill = m.s ? k.skill - m.s : 0; }
      if ((sl === 2 || sl === -1) && hp) { if (!m.s) k.chg3 = Math.min(hp.stats.skill3Charges, k.chg3 + 1); else if (k.chg3 < hp.stats.skill3Charges) k.skill3 -= m.s; }
    }
    for (const ev of w.fx) {
      if (ev.t === 'shatter') rec.cnt.shatter++;
      if (ev.t === 'smite') rec.cnt.smite++; else if (ev.t === 'reap') rec.cnt.reap++; else if (ev.t === 'toll') rec.cnt.toll++; else if (ev.t === 'lance') rec.cnt.lance++;
      else if (ev.t === 'parry') rec.cnt.parries++;
      else if (ev.t === 'ric' && ev.pid === p0id) { rec.cnt.rics++; if (ev.g) rec.cnt.gRics++; } else if (ev.t === 'catch' && ev.pid === p0id) rec.cnt.catches++;
      else if (ev.t === 'skill' && ev.pid === p0id) rec.cnt.casts[ev.k] = (rec.cnt.casts[ev.k] || 0) + 1;
      if (ev.t === 'boon' && ev.pid === p0id) { const b = ED.BOONS[ev.id]; if (b.key && !rec.keyAt) rec.keyAt = w.stratum; }
      if (ev.t === 'room') { rec.roomDmg = 0; rec.maxHost = 0; rec.room = { th: 0, fo: 0, xp: 0, clip: 0 }; if (w.room && w.room.type === 'boss' && !rec.arrive[w.stratum - 1]) rec.arrive[w.stratum - 1] = arrivalOf(w, pickN); }
      if (ev.t === 'clear' && !ev.trial && w.room && w.room.type === 'combat') rec.htk[w.stratum - 1].push(hitsToKill(w, w.players.values().next().value, w.stratum));
      if (ev.t === 'evolve' && ev.pid === p0id && !rec.evoAt) rec.evoAt = { s: w.stratum, lvl: w.level };
      if (ev.t === 'dark') rec.dark[w.stratum - 1]++;
      if (ev.t === 'descend') rec.left.push({ s: w.stratum, rows: w.floor.rows, visited: w.floor.rooms.filter(r => w.roomState[r.id].visited).length, dark: w.floor.rooms.filter(r => r.dark && w.roomState[r.id].visited).length, minDark: minDark(w.floor) }); // the path walked when the party takes the portal: rooms visited (start and boss included), dark rooms among them, and the fewest dark rooms any path holds
      if (ev.t === 'bossSpawn') { bossStart = w.time; rec.bossTry.push({ s: w.stratum, kill: false, fury: false, m: 1 }); }
      if (ev.t === 'fury') rec.bossTry[rec.bossTry.length - 1].fury = true;
      if (fightRec) { // --fight: the fight's clock and its end
        if (ev.t === 'bossSpawn' && fightRec.t0 === null) fightRec.t0 = w.time;
        if (fightRec.t0 !== null && fightRec.t === null && ((ev.t === 'bossDown' && fightRec.k === 'boss') || (ev.t === 'clear' && fightRec.k !== 'boss'))) { fightRec.kill = true; fightRec.t = w.time - fightRec.t0; }
      }
      if (ev.t === 'bossDown') { rec.bossTry[rec.bossTry.length - 1].kill = true; rec.bossTimes[w.stratum] = Math.round(w.time - bossStart); log.push(`  boss ${ev.type} down in ${(w.time - bossStart).toFixed(0)}s (t=${U.fmtTime(w.time)}, lvl ${w.level})`); }
      if (ev.t === 'clear' && !ev.trial && w.room && (w.room.type === 'combat' || w.room.type === 'elite')) rec.clears.push({ s: w.stratum, type: w.room.type, dark: !!w.room.dark, t: Math.round(w.roomTime * 10) / 10, d: Math.round(1000 * rec.roomDmg / Math.max(1, w.players.values().next().value.maxHp)) / 1000, n: rec.maxHost,
        th: rec.room.th, fo: rec.room.fo, xp: rec.room.xp, clip: rec.room.clip, bud: w.roomXp && ED.World.ROOM_XP[w.room.type] ? w.roomXp(w.room, w.room.type) : null });
      if (ev.t === 'stratum') {
        const dealt = totalDealt();
        if (ev.s > 1) { strata.push(Math.round(w.time - stratumStart)); rec.dealtStrata.push(Math.round(dealt - dealt0)); log.push(`  stratum ${ev.s - 1} took ${(w.time - stratumStart).toFixed(0)}s`); }
        stratumStart = w.time; dealt0 = dealt; rec.entry[ev.s] = entryOf(w, w.players.get(p0id));
      }
    }
    w.fx.length = 0; w.msgs.length = 0;
    if (w.roomTime > 150 && w.locked && !w.boss) { log.push('  STUCK in room ' + w.roomId + ' type ' + w.room.type + ' hostiles ' + w.hostiles()); break; }
    if (w.roomTime > 420 && !w.locked && w.state === 'play') { log.push('  IDLE in room ' + w.roomId + ' type ' + w.room.type); break; }
    if (opts.maxStratum && w.stratum > opts.maxStratum) break; // --strata=N: stop on entering stratum N+1 (strata 1..N play out exactly as in a full run)
    if (fightRec && fightRec.kill) break; // --fight: the run ends with the fight
    if (fightRec && w.boss) fightRec.ph = w.boss.phase;
  }
  strata.push(Math.round(w.time - stratumStart));
  rec.dealtStrata.push(Math.round(totalDealt() - dealt0));
  if (fightRec) Object.assign(fightRec, { downs: rec.downedBy.length, hp: [...w.players.values()].reduce((a, q) => a + (rec.dmgByHero[q.pid] || 0) / q.maxHp, 0) / w.players.size, s: w.stratum, type: fightRec.k === 'boss' ? ED.biomeFor(w.stratum).boss : fightRec.k });
  ED.BIOMES[bossS - 1].boss = boss0;
  const p0 = [...w.players.values()][0];
  const sum = w.summary ? w.summary() : null;
  return { fight: fightRec, dark: rec.dark, left: rec.left, state: w.state, victory: w.victory, stratum: w.stratum, time: w.time - (skip ? skip.t0 : 0), from: skip ? skip.from : 0, entry: rec.entry, level: w.level, kills: w.run.kills, relics: p0.relics.length, log, sum, hp: p0.hp | 0, maxHp: p0.maxHp,
    rooms: { visited: w.run.roomsVisited, total: w.run.roomsTotal }, strata,
    arrive: rec.arrive, clears: rec.clears, dmgByS: rec.dmgByS, spawns: rec.spawns, heal: rec.heal, offers: rec.offers, relicsBy: rec.relicsBy, goldIn: rec.goldIn, dmgStrata: rec.dmgStrata, bossTimes: rec.bossTimes.slice(), dmgBy: rec.dmgBy, downedBy: rec.downedBy, dealtStrata: rec.dealtStrata,
    evoAt: rec.evoAt, aff: ED.PATH_IDS.map(k => ED.pathAffinity(p0.boons, k)).sort((a, b) => b - a),
    bossTry: rec.bossTry, cls: p0.cls, main: ED.PATH_IDS.map(k => [k, ED.pathAffinity(p0.boons, k)]).sort((a, b) => b[1] - a[1])[0][0], heroes: players.length, bare: avg(players.map(p => bareDps(p.cls, p.weapon))), src: rec.src, combatS: rec.combatS, hits: rec.hits, ttk: rec.ttk, ttkElite: rec.ttkElite, htk: rec.htk, htkBare: rec.htkBare, cdr: p0.stats.cdr, cdrAfter: ED.Stats.cdrEff ? ED.Stats.cdrEff(p0.stats.cdr) : p0.stats.cdr,
    endRoom: w.room ? w.room.type : '', evo: p0.stats.evo || null, gates: ED.gatePaths(p0.boons), boonCount: Object.values(p0.boons).reduce((a, b) => a + b, 0), keystones: Object.keys(p0.boons).filter(id => ED.BOONS[id].key).length,
    gen: ED.isGeneralist(p0.boons), elGates: ED.elementGates(p0.boons), startPath: ED.gatePaths(p0.boons)[0] || null, keyAt: rec.keyAt, boonIds: Object.keys(p0.boons), relicIds: p0.relics.slice(),
    cnt: rec.cnt, kills0: p0.kills, shield: rec.shield, bossSecs: rec.bossSecs, hpFrac: rec.hpFrac, chainPeak: w.chainPeak, chainHops: w.chainHops, rerolls: p0.rerolls,
    purse, route: ED.classRoute(p0.boons, p0.cls), wi: ED.weaponIndex(p0.cls, p0.weapon), parts: rec.parts, projDmgS: rec.projDmgS, upt: rec.upt, peak: rec.peak, clip: Object.assign({}, p0.shieldClip), braceOn: p0.stats.brace > 0, hexOn: p0.stats.hex > 0 };
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
// Standard error of the mean, and "mean +-se" text.
const se = (a) => { if (a.length < 2) return NaN; const m = avg(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1) / a.length); };
const ms = (a, d = 1) => (a.length ? avg(a).toFixed(d) + (a.length > 1 ? ' +-' + se(a).toFixed(d) : '') : '-');
const pctOf = (a, b) => (b ? Math.round(100 * a / b) : 0);

// Boss-arrival figures of stratum s over the runs that reached its boss room: n, idx (their indices in results), the per-run records (arrivalRun), ln power per run, and the geometric mean power with its standard error (delta method: gm x se of the mean ln).
function arrivalStats(results, s) {
  const idx = [], runs = [];
  results.forEach((r, k) => { const a = r.arrive && r.arrive[s - 1]; if (a) { idx.push(k); runs.push(arrivalRun(a)); } });
  const ln = runs.map(q => Math.log(Math.max(1e-9, q.pow))), gm = runs.length ? Math.exp(avg(ln)) : NaN;
  return { n: runs.length, idx, runs, ln, gm, gmSe: gm * se(ln) };
}
const ROMAN = SL.map(U.roman);
// Compact power figure (k = thousand, M = million).
const fmtPow = (v) => (!Number.isFinite(v) ? '-' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : v.toFixed(0));
// The summary line of one stratum's boss arrival: team level, picks (total and by source), damage, effective health, power (geometric mean), each with its standard error.
function arrivalLine(s, a) {
  const q = a.runs, d0 = (v) => (Math.abs(v) < 100 ? 1 : 0), dm = q.map(x => x.dmg), em = q.map(x => x.ehp);
  const src = PICK_SRC.map((k, i) => { const v = q.map(x => x.pk[i]), e = se(v); return [k, avg(v), e]; }).filter(x => x[0] !== 'other' || x[1] > 0).map(([k, m, e]) => `${k} ${m.toFixed(1)}${e >= 0.05 ? ' +-' + e.toFixed(1) : ''}`);
  return `boss arrival ${ROMAN[s - 1]} (${a.n} runs): team lvl ${ms(q.map(x => x.lvl), 1)} | picks ${ms(q.map(x => x.pk.reduce((u, v) => u + v, 0)), 1)} (${src.join(', ')}) | dmg (mean of one foe and pack) ${ms(dm, d0(avg(dm)))} | ehp ${ms(em, d0(avg(em)))} | power (dmg x ehp, geometric mean) ${fmtPow(a.gm)}${Number.isFinite(a.gmSe) ? ' +-' + fmtPow(a.gmSe) : ''}`;
}

// One-block summary of a batch of runBot results: win rate, depth, pacing per stratum, dark rooms, damage sources.
function summarize(results) {
  const n = results.length, wins = results.filter(r => r.victory), S = SL;
  const clear = (type, s) => avg(results.flatMap(r => r.clears.filter(c => c.type === type && (s === 0 || c.s === s)).map(c => c.t)));
  const bossT = (s) => avg(results.map(r => r.bossTimes[s]).filter(v => v !== undefined));
  const strataSum = [], strataN = [];
  let vis = 0, tot = 0;
  const dmg = {}, downed = {};
  for (const r of results) {
    vis += r.rooms.visited; tot += r.rooms.total;
    r.strata.forEach((t, k) => { strataSum[k] = (strataSum[k] || 0) + t; strataN[k] = (strataN[k] || 0) + 1; });
    for (const k in r.dmgBy) dmg[k] = (dmg[k] || 0) + r.dmgBy[k];
    for (const k of r.downedBy.slice(0, 1)) downed[k.split('@')[0]] = (downed[k.split('@')[0]] || 0) + 1; // the first downing of each run
  }
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k);
  const dTot = Object.values(dmg).reduce((a, b) => a + b, 0) || 1;
  const lines = [];
  const from = results[0].from, entries = results.map(r => r.entry && r.entry[from || 4]).filter(Boolean);
  if (from) lines.push(`FROM STRATUM ${from}: strata 1..${from - 1} were skipped, so wins, depth, times, counts and rates below cover strata >= ${from} only (depth counts the skipped bosses as beaten)`);
  if (entries.length) lines.push(`entry to stratum ${from || 4} (${entries.length} runs): team lvl ${ms(entries.map(e => e.level))} boons ${ms(entries.map(e => e.boons))} relics ${ms(entries.map(e => e.relics))} gold ${ms(entries.map(e => e.gold), 0)} max HP ${ms(entries.map(e => e.maxHp), 0)} hp ${ms(entries.map(e => e.hp / e.maxHp), 2)} keystones ${ms(entries.map(e => e.keys))} evolved ${pctOf(entries.filter(e => e.evo).length, entries.length)}%`);
  const hist =S.map(k => results.filter(r => !r.victory && r.stratum === k).length), atBoss = results.filter(r => !r.victory && r.endRoom === 'boss').length;
  lines.push('wins by hero: ' + [...new Set(results.map(r => r.cls))].map(c => { const rs = results.filter(r => r.cls === c); return `${c} ${Math.round(100 * rs.filter(r => r.victory).length / rs.length)}% (depth ${f1(avg(rs.map(r => r.stratum)))})`; }).join(', '));
  lines.push(`deaths by stratum [${hist.join(' ')}] (${atBoss} of ${n - wins.length} at a boss)`);
  lines.push(`wins ${wins.length}/${n} (${(100 * wins.length / n).toFixed(0)}% +-${(100 * Math.sqrt(wins.length / n * (1 - wins.length / n) / n)).toFixed(1)}) avg depth ${ms(results.map(r => r.stratum), 2)} depth incl. partial stratum ${ms(results.map(r => rowOf(r).depth), 2)} avg time ${U.fmtTime(avg(results.map(r => r.time)))} winners ${wins.length ? U.fmtTime(avg(wins.map(r => r.time))) : '-'} lvl ${f1(avg(results.map(r => r.level)))} (winners ${wins.length ? f1(avg(wins.map(r => r.level))) : '-'})`);
  const darkS = S.map(s => avg(results.map(r => r.dark[s - 1] || 0)));
  lines.push(`rooms visited ${(100 * vis / Math.max(1, tot)).toFixed(0)}% (${(vis / n).toFixed(1)}/run) dark rooms entered ${f2(darkS.reduce((a, b) => a + b, 0))}/run, per stratum [${darkS.map(f2).join(' ')}] avg stratum time [${strataSum.map((t, k) => U.fmtTime(t / strataN[k])).join(' ')}]`);
  lines.push(`clear s  combat [${S.map(s => f1(clear('combat', s))).join(' ')}] all ${f1(clear('combat', 0))}  elite [${S.map(s => f1(clear('elite', s))).join(' ')}] all ${f1(clear('elite', 0))}  boss [${S.map(s => f1(bossT(s))).join(' ')}]`);
  const fur = SL.filter(s => ED.World.furyAt(s) > 0).map(s => { const fs = results.flatMap(r => r.bossTry.filter(b => b.s === s)); return `${U.roman(s)} ${pctOf(fs.filter(b => b.fury).length, fs.length)}% x${f2(avg(fs.map(b => b.m)))} (${fs.length} fights)`; });
  lines.push('boss fury, fights that reached it and mean multiplier at the kill or death: ' + fur.join(' | '));
  const flat = (key, s) => results.flatMap(r => r[key][s - 1]);
  const medClear = (type, s) => median(results.flatMap(r => r.clears.filter(c => c.type === type && c.s === s).map(c => c.t)));
  lines.push(`clear s median combat [${S.map(s => f1(medClear('combat', s))).join(' ')}] elite [${S.map(s => f1(medClear('elite', s))).join(' ')}]`);
  lines.push(`regular foe: weapon hits to kill [${S.map(s => f1(avg(flat('htk', s)))).join(' ')}] (start weapon, no boons, stratum I: ${f1(avg(results.map(r => r.htkBare)))}) | observed direct hits per kill [${S.map(s => f1(avg(flat('hits', s)))).join(' ')}] | time to kill s [${S.map(s => f1(median(flat('ttk', s)))).join(' ')}] | elite time to kill s median [${S.map(s => f1(median(flat('ttkElite', s)))).join(' ')}] mean [${S.map(s => f1(avg(flat('ttkElite', s)))).join(' ')}]`);
  const dpsRatio = (r, s) => { const d = r.src[s - 1] ? Object.values(r.src[s - 1]).reduce((a, b) => a + b, 0) : 0; return r.combatS[s - 1] >= 5 ? d / r.combatS[s - 1] / r.heroes / r.bare : NaN; };
  const dpsOf = (rs, s) => median(rs.map(r => dpsRatio(r, s)).filter(v => Number.isFinite(v)));
  lines.push(`hero dps x bare weapon (median, combat seconds only, overkill included) by stratum [${S.map(s => f1(dpsOf(results, s))).join(' ')}] | ${[...new Set(results.map(r => r.cls))].map(c => c + ' [' + S.map(s => f1(dpsOf(results.filter(r => r.cls === c), s))).join(' ') + ']').join(' ')}`);
  const share = (rs, from) => {
    const t = {}; let tot = 0;
    for (const r of rs) for (let i = from; i < SL.length; i++) if (r.src[i]) for (const k in r.src[i]) { t[k] = (t[k] || 0) + r.src[i][k]; tot += r.src[i][k]; }
    return BUCKETS.map(k => k + ' ' + Math.round(100 * (t[k] || 0) / (tot || 1)) + '%').join(' ');
  };
  lines.push(`damage share (all strata | strata III-IV): all ${share(results, 0)} | ${share(results, 2)}`);
  lines.push('  by main path (strata III-IV): ' + ED.PATH_IDS.map(k => { const rs = results.filter(r => r.main === k); return `${k} (${rs.length}) ${share(rs, 2)}`; }).join(' | '));
  lines.push('  weapon share by main path (all strata; each path should keep at least 20%): ' + ED.PATH_IDS.map(k => { const rs = results.filter(r => r.main === k); const sh = (b) => { let t = 0, a = 0; for (const r of rs) for (const o of r.src) if (o) for (const x in o) { a += o[x]; if (x === b) t += o[x]; } return a ? Math.round(100 * t / a) : NaN; }; return `${k} ${Number.isFinite(sh('weapon')) ? sh('weapon') + '%' : '-'}`; }).join(' | '));
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
  const pShare = S.map(s => { let o = 0, h = 0, t = 0; for (const r of results) if (r.purse) { o += r.purse[s - 1][0]; h += r.purse[s - 1][1]; t += r.purse[s - 1][2]; } return o ? `${ROMAN[s - 1]} ${pct(h, o)}%/${pct(t, o)}%` : `${ROMAN[s - 1]} -`; });
  lines.push(`pool exhaustion (hero 0, offers showing the Purse / Purse picks) by stratum: ${pShare.join(' ')}`);
  // path lines: evolution / keystone pacing, wins by main path and start, status payoffs, shields
  const elemRuns = results.filter(r => !r.gen && r.elGates.length), genRuns = results.filter(r => r.gen);
  const medS = (a) => (a.length ? median(a) : NaN), withS = (rs, key) => rs.filter(r => r[key]).map(r => (key === 'evoAt' ? r.evoAt.s : r[key]));
  lines.push(`evolution stratum quartiles: element mains [${qs(withS(elemRuns, 'evoAt'))}] (${withS(elemRuns, 'evoAt').length}/${elemRuns.length} evolved; by IV entry ${pct(elemRuns.filter(r => r.stratum >= 4 && r.evoAt && r.evoAt.s < 4).length, elemRuns.filter(r => r.stratum >= 4).length)}% of those reaching IV) | Generalist [${qs(withS(genRuns, 'evoAt'))}] (${withS(genRuns, 'evoAt').length}/${genRuns.length}) | per path ${ED.PATH_IDS.map(k => { const a = results.filter(r => r.evoAt && r.evo === k).map(r => r.evoAt.s); return `${k} [${qs(a)}] n=${a.length}`; }).join(' ')}`);
  lines.push(`keystone stratum quartiles [${qs(withS(results, 'keyAt'))}] (${withS(results, 'keyAt').length}/${n} took one)`);
  const grp = (rs) => (rs.length ? `${rs.length} runs wins ${pct(rs.filter(r => r.victory).length, rs.length)}% depth ${ms(rs.map(r => r.stratum), 2)}` : '0 runs');
  lines.push('by main path: ' + ED.PATH_IDS.map(k => `${k} (${grp(results.filter(r => r.main === k))})`).join(' | '));
  const sel = results.filter(r => ['knight', 'ranger', 'shade'].includes(r.cls));
  lines.push(`Knight/Ranger/Shade: Generalist (${grp(sel.filter(r => r.gen))}) vs element (${grp(sel.filter(r => !r.gen))}) | by start path: ${ED.PATH_IDS.map(k => `${k} ${results.filter(r => r.startPath === k).length}`).join(' ')}`);
  const per = (f) => ms(results.map(f), 1);
  lines.push(`per run: smites ${per(r => r.cnt.smite)} reaps ${per(r => r.cnt.reap)} (${pct(results.reduce((a, r) => a + r.cnt.reap, 0), results.reduce((a, r) => a + r.kills, 0))}% of kills; reap health ${f1(avg(results.map(r => r.cnt.reapHp)))}) tolls ${per(r => r.cnt.toll)} lances ${per(r => r.cnt.lance)} dash-rider hits ${per(r => r.cnt.dashHits)} downs ${per(r => r.downedBy.length)} | chain queue peak ${f1(avg(results.map(r => r.chainPeak)))} (max ${Math.max(...results.map(r => r.chainPeak))}) hops ${f1(avg(results.map(r => r.chainHops)))} (max ${Math.max(...results.map(r => r.chainHops))})`);
  lines.push(`verbs per run (hero 0): perfect dodges ${per(r => r.cnt.pdodge)} discharge dashes ${per(r => r.cnt.dis)} shatters (every hero) ${per(r => r.cnt.shatter)} holds ${per(r => r.cnt.holds)} | Backstab share of direct hits (Shadow runs) ${pct(results.filter(r => r.elGates.includes('shadow')).reduce((a, r) => a + r.cnt.back, 0), results.filter(r => r.elGates.includes('shadow')).reduce((a, r) => a + r.cnt.direct, 0))}%`);
  const shSum = (key) => { const o = {}; for (const r of results) for (const k in r.shield[key]) o[k] = (o[k] || 0) + r.shield[key][k] / n; return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + Math.round(v)).join(', ') || '-'; };
  const holyMains = results.filter(r => r.main === 'holy' && r.bossSecs > 0);
  lines.push(`shield per run (HP) gained: ${shSum('gained')} | absorbed: ${shSum('absorbed')} | Holy absorbed per boss-fight second (${holyMains.length} Holy mains): ${ms(holyMains.map(r => 100 * r.shield.holyBoss / r.bossSecs), 2)}% max HP/s (limit 0.5, design ceiling 1)`);
  const classBoss = [...new Set(results.map(r => r.cls))].map(c => c + ' [' + S.map(s => f1(avg(results.filter(r => r.cls === c).map(r => r.bossTimes[s]).filter(v => v !== undefined)))).join(' ') + ']');
  lines.push('boss time to kill by class and stratum (s): ' + classBoss.join(' '));
  lines.push(`hp lost per stratum (fraction of max HP, runs that played it) [${S.map(s => ms(results.map(r => r.hpFrac[s - 1]).filter(v => v !== undefined), 2)).join(' | ')}]`);
  lines.push(`damage taken ${top(dmg, 5).map(([k, v]) => `${k} ${(100 * v / dTot).toFixed(0)}%`).join(', ')}; first downed by ${top(downed, 5).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const byS = S.map(k => { const o = {}; for (const r of results) for (const who in (r.dmgByS[k] || {})) o[who] = (o[who] || 0) + r.dmgByS[k][who]; const t = Object.values(o).reduce((x, y) => x + y, 0) || 1; return `${k}: ` + Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([w, v]) => `${w} ${Math.round(100 * v / t)}%`).join(' '); });
  lines.push('damage taken by stratum: ' + byS.join(' | '));
  const grpOf = { combat: (c) => c.type === 'combat' && !c.dark, elite: (c) => c.type === 'elite' && !c.dark, dark: (c) => c.dark };
  const perS = (g, f) => S.map(s => { const cs = results.flatMap(r => r.clears.filter(c => c.s === s && grpOf[g](c))); return cs.length ? f(cs) : '-'; });
  const roomLine = (label, f) => `${label}: ` + Object.keys(grpOf).map(g => `${g} [${perS(g, f).join(' ')}]`).join(' ');
  lines.push(roomLine('kills per cleared room by stratum (threat/fodder)', (cs) => `${f1(avg(cs.map(c => c.th)))}/${f1(avg(cs.map(c => c.fo)))}`));
  lines.push(roomLine('peak live foes per room by stratum (mean/max)', (cs) => `${f1(avg(cs.map(c => c.n)))}/${Math.max(...cs.map(c => c.n))}`));
  lines.push(roomLine('room xp dropped by stratum (mean/budget, rooms off budget, mean threat xp cut by the budget)', (cs) => `${f1(avg(cs.map(c => c.xp)))}${cs[0].bud === null ? '' : '/' + f1(avg(cs.map(c => c.bud))) + ' off ' + cs.filter(c => Math.abs(c.xp - c.bud) > 0.5).length + ' cut ' + f1(avg(cs.map(c => c.clip)))}`));
  lines.push(classLines(results));
  const darkC = results.flatMap(r => r.clears.filter(c => c.dark)), normC = results.flatMap(r => r.clears.filter(c => c.type === 'combat' && !c.dark));
  lines.push(`dark rooms: ${darkC.length} cleared in ${n} runs | clear s ${f1(avg(darkC.map(c => c.t)))} vs normal combat ${f1(avg(normC.map(c => c.t)))} | room hp lost ${f2(avg(darkC.map(c => c.d)))} vs ${f2(avg(normC.map(c => c.d)))} (fraction of max HP)`);
  for (const s of SL) { const a = arrivalStats(results, s); if (a.n) lines.push(arrivalLine(s, a)); }
  return lines.join('\n');
}

// Class route lines (docs/GAME-DESIGN.md section 10): arms per class x route, per fork and per class x weapon, damage share by skill part, HP lost per combat and elite room, shots, shields, heal, uptimes, counts and peaks.
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
  out.push(`room hp lost (% max HP) combat ${roomD(results, 'combat')} elite ${roomD(results, 'elite')} | shots hp lost per stratum (% max HP) [${SL.map(s => ms(results.map(r => r.projDmgS[s - 1]).filter(v => v !== undefined).map(v => 100 * v), 1)).join(' | ')}]`);
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
  weapon: flags.weapon === undefined || isNaN(+flags.weapon) ? flags.weapon : +flags.weapon, explain: !!flags.explain,
  aimNoise: flags.aimnoise === undefined ? undefined : flags.aimnoise.split(',').map(Number).concat([0]).slice(0, 2).map(v => (Number.isFinite(v) ? v : 0)),
  force: flags.force ? flags.force.split(',') : [], dark: flags.dark, maxStratum: flags.strata === undefined ? undefined : +flags.strata, vet: flags.vet, vetReact: flags.vetreact === undefined ? undefined : +flags.vetreact,
  from: flags.from === undefined ? undefined : +flags.from, lambda: flags.lambda, fight: flags.fight || (flags.boss ? 'boss' : undefined), bosstype: flags.bosstype,
});

// --fight summary: per fight type the fights, kills, party wipes (and the boss phase they died in), seconds to the kill (mean +-se, median), hero downs per fight and health lost per hero (fraction of max HP).
function fightLine(results) {
  const by = {};
  for (const r of results) if (r.fight) (by[r.fight.type] || (by[r.fight.type] = [])).push(r.fight);
  return Object.entries(by).map(([type, fs]) => {
    const kills = fs.filter(f => f.kill), wipes = fs.filter(f => !f.kill), ph = [1, 2, 3].map(k => wipes.filter(f => f.ph === k).length);
    return `fight ${type} (stratum ${fs[0].s}): ${fs.length} fights, ${kills.length} kills, wipes ${pctOf(wipes.length, fs.length)}% (in phase 1/2/3: ${ph.join('/')}) | time to kill ${ms(kills.map(f => f.t))} s median ${f1(median(kills.map(f => f.t)))} | downs per fight ${f2(avg(fs.map(f => f.downs)))} | hp lost per hero ${f2(avg(fs.map(f => f.hp)))}`;
  }).join('\n');
}

// Heroes of run i over the class list cls (n heroes): the lead is cls[i mod L]; partners are the other heroes in list order rotated by floor(i / L) mod (L - 1), so over L x (L - 1) runs every lead meets every partner in each slot.
// A solo run keeps [lead].concat(cls) (its seeds and rows are unchanged).
const partyOf = (cls, i, n) => {
  const L = cls.length, lead = cls[i % L];
  if (n <= 1 || L < 2) return [lead].concat(cls);
  const rest = cls.filter((c, k) => k !== i % L), k = Math.floor(i / L) % rest.length;
  return [lead].concat(rest.slice(k), rest.slice(0, k));
};
// Expands the rotating flags for run i of a batch over nc classes: route = floor(i / nc) mod 4, fork = floor(i / (nc x 4)) mod 2, weapon = floor(i / (nc x 8)) mod 3, start = floor(i / nc) mod 7 (the six gates then generalist; by run block, so it never locks to a hero).
const ROT_START = ['kindle', 'frostbite', 'staticcharge', 'envenom', 'consecrate', 'doommark', 'generalist'];
function jobOpts(o, i, nc) {
  const r = Object.assign({}, o);
  if (o.route === 'rotate') r.route = ED.ROUTES[Math.floor(i / nc) % 4];
  if (o.fork === 'rotate') r.fork = Math.floor(i / (nc * 4)) % 2;
  if (o.weapon === 'rotate') r.weapon = Math.floor(i / (nc * 8)) % 3;
  if (o.start === 'rotate') r.start = ROT_START[Math.floor(i / nc) % ROT_START.length];
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

module.exports = { fightLine, arenaBot, partyOf, runBot, summarize, classLines, metaProfile, rowOf, optsFromFlags, jobOpts, pairReport, ED, parseVet, vetThreats, vetRisk, vetPlan, vetRider, arrivalStats, fmtPow, ROMAN, PICK_SRC };
if (require.main === module) {
  const flags = {}, args = [];
  for (const a of process.argv.slice(2)) { const m = /^--([a-z0-9]+)(?:=(.*))?$/i.exec(a); if (m) flags[m[1]] = m[2] === undefined ? '1' : m[2]; else args.push(a); }
  const n = +(args[0] || 1), runs = +(args[1] || 5), skill = +(args[2] || 0.75), meta = args[3] || 'none';
  const cls = (args[4] && args[4] !== '-' ? args[4] : ED.CLASS_IDS.join(',')).split(','); // '-' = every hero
  const { up, mastery } = metaProfile(meta);
  const o = optsFromFlags(flags), pick = o.pick, force = o.force, seed0 = +(flags.seed0 || 1000);
  const results = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = runBot(Object.assign({ seed: seed0 + i * 7, n, cls: partyOf(cls, i, n), skill, up, pact: +(args[5] || 0), mastery }, jobOpts(o, i, cls.length)));
    results.push(r);
    if (!flags.quiet) {
      console.log(`run ${i} ${cls[i % cls.length]}: ${r.victory ? 'WIN' : r.state} stratum ${r.stratum} time ${U.fmtTime(r.time)} lvl ${r.level} kills ${r.kills} relics ${r.relics} rooms ${r.rooms.visited}/${r.rooms.total} dark [${r.dark.join(' ')}] strata [${r.strata.map(U.fmtTime).join(' ')}] (${Date.now() - t0}ms)`);
      for (const l of r.log) console.log(l);
    }
  }
  console.log(`\npick=${pick}${o.vet && o.vet !== '0' ? ' vet=' + o.vet + (o.vetReact >= 0 ? ' react=' + o.vetReact : '') : ''}${o.start ? ' start=' + o.start : ''}${o.gates ? ' gates=' + o.gates : ''}${force.length ? ' force=' + force.join(',') : ''}${flags.strata ? ' strata<=' + flags.strata + ' (capped runs: win, depth and death lines do not apply)' : ''}${o.from > 1 ? ' from=' + o.from : ''}\n` + summarize(results));
  if (o.fight) console.log(fightLine(results));
  const rows = results.map((r, i) => rowOf(r, meta, seed0 + i * 7));
  if (flags.out) fs.writeFileSync(flags.out, JSON.stringify(rows));
  if (flags.pair) console.log(pairReport(rows, JSON.parse(fs.readFileSync(flags.pair, 'utf8'))));
}
