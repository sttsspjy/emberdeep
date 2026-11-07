// Headless check for heroes Knight, Ranger, Pyro, Necro (exit 1 on failure). Usage: node tools/check-heroes-a.js
// Per hero (god cheat, from 4:00 so the horde is dense): 5 phases of 15 s with skill level 1..5 and no tune / path 0 at rank 1 / 3 / 5 / 5 (tune full), then 20 s in path 0's first Form, refined twice.
// Q is held every tick (cast on cooldown), aimed at the nearest foe; fodder rings keep targets near the hero. Each phase: no exception, the skill casts, the weapon deals damage, the skill none.
// Extras: Bone Shard / Bone Storm on other heroes (the slain rise for them too), Cleave aims inside the facing cone (no foe: along it), each path's shape flags reach the effective numbers,
// skills carry no damage, necro minions rise / obey the cap, same seed -> same digest, no NaN positions.
// Auto aim: every cursor-mode def has a style; nearest (elites / bosses within 300 px first, braziers too), facing, random (seeded), crowd (Cleave) and their no-target fallbacks; face / stick-less dash / Q points
// (self, facing, densest) in auto; every path at rank 5 and every Form in auto: damage, Q casts, same digest twice.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const HEROES = ['knight', 'ranger', 'pyro', 'necro'];

let AUTO = false; // drive in auto aim (the aim point is still sent: ignored by the sim)
function drive(w, p, tick) {
  const e = w.nearestFoe(p.x, p.y, 300), a = tick / 60 * 0.6;
  p.offer = null; p.pend = 0; // no card picks: the phase setup owns the build
  w.input(p.pid, { mx: Math.cos(a) * 0.6, my: Math.sin(a) * 0.6, ax: e ? e.x : p.x + 80, ay: e ? e.y : p.y, q: true, auto: AUTO });
}
// Sets skill levels to L (cooldown ready) and path 0 to rank `rank` (tune full; 0: no change); form: takes path 0's first Form and refines it twice.
function setup(w, p, L, rank, form) {
  for (const sk of p.skills) { sk.lvl = L; sk.cd = 0; }
  const ws = p.weapons[0], def = ED.WEAPONS[ED.HEROES[p.cls].sig], fid = def.paths[0].forms[0];
  if (form) {
    const ready = w.formsReady(p, ws).map(f => f.id);
    ok(ready.indexOf(fid) >= 0, `${p.cls}: ${fid} is ready with path 0 at rank ${ED.PATH_MAX} (ready: ${ready.join(',')})`);
    w.setForm(p, ws, fid, 2);
  } else if (rank) w.setRanks(p, ws, ED.TUNE_MAX, 0, rank);
}
// Keeps targets near the hero: 30 foes on a 110-200 px ring once a second while fewer than 120 are within 250 px.
const FODDER = ED.FOE_IDS.find(id => !ED.FOES[id].boss && !ED.FOES[id].brute && !ED.FOES[id].range);
function feed(w, p) {
  let near = 0;
  for (const e of w.foes) if (!e.dead && U.dist2(e.x, e.y, p.x, p.y) < 250 * 250) near++;
  if (near >= 120) return;
  for (let i = 0; i < 30; i++) { const a = i / 30 * U.TAU, d = 110 + (i % 4) * 30; w.spawnFoe(FODDER, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); }
}
function phase(w, p, secs, tag, out) {
  const before = Object.assign({}, p.dealt), casts = {};
  let err = null, nan = false, maxMin = 0;
  try {
    for (let i = 0; i < secs * 60 && w.state === 'play'; i++) {
      drive(w, p, w.tick);
      if (i % 60 === 0) feed(w, p);
      w.update(C.TICK);
      for (const ev of w.events) if (ev.t === 'skill') casts[ev.id] = (casts[ev.id] || 0) + 1;
      w.events.length = 0;
      if (!isFinite(p.x) || !isFinite(p.y)) nan = true;
      for (const z of w.zones) if (!isFinite(z.x) || !isFinite(z.y) || !isFinite(z.r)) nan = true;
      for (const pr of w.projs) if (!isFinite(pr.x) || !isFinite(pr.y)) nan = true;
      if (p.minions) maxMin = Math.max(maxMin, ED.Necro.liveMinions(p));
      out.digest = (Math.imul(out.digest, 31) + U.hashStr(w.kills + '|' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + '|' + w.foes.length + '|' + w.zones.length)) >>> 0;
    }
  } catch (e) { err = e; }
  const d = (id) => Math.round((p.dealt[id] || 0) - (before[id] || 0));
  const h = ED.HEROES[p.cls], wid = p.weapons[0].id, q = h.skills[0];
  ok(!err && !nan, `${p.cls} ${tag}: no exception, finite positions` + (err ? ': ' + err.stack : ''));
  ok((casts[q] || 0) > 0 && Object.keys(casts).length === 1, `${p.cls} ${tag}: casts ${q} ${casts[q] || 0} (only Q)`);
  ok(d(wid) > 0 && d(q) === 0, `${p.cls} ${tag}: dealt ${wid} ${d(wid)}, ${q} ${d(q)} (utility Q)`);
  out.maxMin = Math.max(out.maxMin, maxMin);
}
function runHero(cls, seed) {
  const w = new ED.World({ seed, stage: 0, players: [{ pid: 'p1', name: 'T', slot: 0, cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.time = 240;
  const p = w.heroes[0], out = { digest: 0, maxMin: 0, w, p };
  for (let L = 1; L <= 5; L++) { setup(w, p, L, [0, 1, 3, 5, 5][L - 1], false); phase(w, p, 15, `skill lvl ${L}, ${p.weapons[0].id} tune ${p.weapons[0].tune} ranks ${p.weapons[0].pr.join('')}`, out); }
  setup(w, p, 5, 0, true);
  phase(w, p, 20, `Form ${p.weapons[0].id} refine ${p.weapons[0].fl}`, out);
  return out;
}

for (const cls of HEROES) {
  const r = runHero(cls, 4242);
  const h = ED.HEROES[cls], def = ED.WEAPONS[h.sig], fd = ED.WEAPONS[def.paths[0].forms[0]], ws = r.p.weapons[0];
  ok(ws.id === fd.id && ws.evo && ws.fl === 2 && ws.pr.join('') === '500' && ws.tune === 5 && ws.lvl === 14, `${cls}: signature took the Form ${fd.id}, refined twice (lvl ${ws.lvl})`);
  ok(def.paths.length === 3 && def.paths.every(pa => pa.id && pa.name && pa.ranks.length === 3 && pa.ranks.every(l => l.txt.length <= 40)) && !def.levels && !def.pair && !def.evo,
    `${cls}: ${def.id} has 3 paths x 3 rank cards, lines <= 40 chars, no levels / pair / evo`);
  ok(fd.form && fd.evolved && fd.from === def.id && fd.refine.length === 2 && fd.refine.every(l => l.txt.length <= 40) && fd.txt.length <= 40, `${cls}: Form ${fd.id} from ${def.id}, 2 refine cards`);
  ok(h.skills.length === 1, `${cls}: one skill (${h.skills[0]})`);
  for (const id of h.skills) { const s = ED.SKILLS[id]; ok(s.levels.length === 4 && s.levels.every(l => l.txt.length <= 40), `${cls}: ${id} has 4 level cards, lines <= 40 chars`); }
  if (cls === 'necro') {
    ok(r.maxMin > 0 && r.maxMin <= 24, `necro: minions rose (peak ${r.maxMin}, hard cap 24)`);
    ok((r.p.dealt.boneshard || 0) + (r.p.dealt.bonestorm || 0) > 0, 'necro: kill-rise minions credit the signature');
  }
  if (cls === 'necro' || cls === 'pyro') {
    const r2 = runHero(cls, 4242);
    ok(r.digest === r2.digest, `${cls}: same seed -> same digest (${r.digest} / ${r2.digest})`);
  }
}
// Bone Shard / Bone Storm swapped onto a cleric and a bell (impls do not assume their hero), 15 s, no exception, deal damage, the slain rise.
for (const [cls, id] of [['cleric', 'boneshard'], ['bell', 'bonestorm']]) {
  const w = new ED.World({ seed: 9, stage: 0, players: [{ pid: 'p1', cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } }), p = w.heroes[0];
  w.time = 240;
  p.weapons.length = 0; const ws = w.addWeapon(p, id); w.setRanks(p, ws, ED.TUNE_MAX, 0, ED.PATH_MAX);
  let err = null, maxMin = 0;
  try { for (let i = 0; i < 900; i++) { drive(w, p, i); if (i % 60 === 0) feed(w, p); w.update(C.TICK); w.events.length = 0; maxMin = Math.max(maxMin, ED.Necro.liveMinions(p)); } } catch (e) { err = e; }
  ok(!err && p.dealt[id] > 0 && ws.root === 'boneshard', `${cls} carrying ${id}: dealt ${Math.round(p.dealt[id] || 0)}` + (err ? ': ' + err.stack : ''));
  ok(maxMin > 0, `${cls} carrying ${id}: the slain rise (peak ${maxMin} minions)`);
}
// Cleave swings along the cursor: past a foe off the line, away from the only foe (behind), with no foe; a cursor on the hero falls back to the movement direction.
{
  const w = new ED.World({ seed: 3, stage: 0, players: [{ pid: 'p1', cls: 'knight' }], cheats: { god: true } }), p = w.heroes[0];
  w.foes.length = 0; p.mdir = 0.5;
  const ws = p.weapons[0], fire = () => { w.events.length = 0; const r = ED.WIMPL.cleave.fire(w, p, ws, ED.Stats.weapon(p, 0)); const ev = w.events.find(e => e.t === 'swing'); return r ? (ev ? ev.a : NaN) : null; };
  const put = (a) => { for (const e of w.foes) e.dead = true; w.spawnFoe(FODDER, p.x + Math.cos(a) * 40, p.y - 4 + Math.sin(a) * 40); };
  const aim = (x, y) => { p.in.ax = p.x + x; p.in.ay = p.y + y; };
  put(1.2); aim(100, 0); const a1 = fire();
  put(Math.PI); aim(0, -100); const a2 = fire();
  for (const e of w.foes) e.dead = true; aim(-60, 60); const a3 = fire();
  aim(2, 1); const a4 = fire();
  ok(a1 !== null && Math.abs(U.angDiff(a1, 0)) < 1e-9, `knight: Cleave swings at the cursor, not at a foe 69 deg off it (a ${a1 && a1.toFixed(2)})`);
  ok(a2 !== null && Math.abs(U.angDiff(a2, -Math.PI / 2)) < 1e-9, `knight: Cleave swings at the cursor with the only foe behind (a ${a2 && a2.toFixed(2)})`);
  ok(a3 !== null && Math.abs(U.angDiff(a3, 3 * Math.PI / 4)) < 1e-9, `knight: Cleave swings at the cursor with no foe (a ${a3 && a3.toFixed(2)})`);
  ok(a4 !== null && Math.abs(U.angDiff(a4, 0.5)) < 1e-9, `knight: a cursor on the hero swings along the movement direction (a ${a4 && a4.toFixed(2)})`);
}
// Cursor aim: Longbow, Fire Bolt and Bone Shard fire along the cursor with a foe 90 deg off it; Smite's Lance sweep starts
// SWEEP_ARC / 2 before the cursor dir; Smite pillars with no foe stride out along the cursor dir.
for (const [cls, wid] of [['ranger', 'longbow'], ['pyro', 'firebolt'], ['necro', 'boneshard']]) {
  const w = new ED.World({ seed: 3, stage: 0, players: [{ pid: 'p1', cls }], cheats: { god: true } }), p = w.heroes[0], ws = p.weapons[0];
  w.foes.length = 0; w.updateSpawner = () => {}; const e = w.spawnFoe(FODDER, p.x, p.y + 80); e.spd = 0;
  p.in.ax = p.x - 70; p.in.ay = p.y - 70; ws.cd = 0; w.update(C.TICK);
  const q = w.projs.find(x => !x.dead && x.p === p && x.wid === wid);
  ok(q && Math.abs(U.angDiff(q.a, -3 * Math.PI / 4)) < 1e-6, `${wid}: fires along the cursor, not at the foe 90 deg off (a ${q && q.a.toFixed(2)})`);
}
{
  const w = new ED.World({ seed: 3, stage: 0, players: [{ pid: 'p1', cls: 'cleric' }], cheats: { god: true } }), p = w.heroes[0], ws = p.weapons[0];
  w.foes.length = 0; w.updateSpawner = () => {}; w.setRanks(p, ws, ED.TUNE_MAX, 2, 1);
  p.in.ax = p.x; p.in.ay = p.y + 100; ws.cd = 99;
  let z = null; for (let i = 0; i < 60 && !z; i++) { w.update(C.TICK); w.events.length = 0; z = w.zones.find(o => !o.dead && o.k === 'beam'); }
  ok(z && Math.abs(U.angDiff(z.a, Math.PI / 2 - 1.9 / 2)) < 0.15, `smite: the Lance sweep starts centred on the cursor dir with no foe (a ${z && z.a.toFixed(2)})`);
  p.in.ax = p.x - 100; p.in.ay = p.y; ws.cd = 0; w.update(C.TICK);
  const pl = w.zones.filter(o => !o.dead && o.wid === 'smite' && o.k !== 'beam');
  ok(pl.length > 0 && pl.every(o => o.x < p.x - 20 && Math.abs(o.y - p.y) < 2), `smite: with no foe, pillars stride out along the cursor dir (${pl.map(o => Math.round(o.x - p.x) + ',' + Math.round(o.y - p.y)).join(' ')})`);
}
// Path shape flags reach the effective numbers (each path at rank 5 in its own world, no Form); skills at level 5.
{
  const four = (i) => {
    const v = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight' }, { pid: 'p2', cls: 'ranger', slot: 1 }, { pid: 'p3', cls: 'pyro', slot: 2 }, { pid: 'p4', cls: 'necro', slot: 3 }], cheats: { god: true } });
    for (const p of v.heroes) { if (i >= 0) v.setRanks(p, p.weapons[0], ED.TUNE_MAX, i, ED.PATH_MAX); for (const sk of p.skills) sk.lvl = 5; }
    return v;
  };
  const w = four(-1), [k, r, py, n] = w.heroes, P = [0, 1, 2].map(i => four(i).heroes);
  const S = (p) => ED.Stats.weapon(p, 0), N = (p, i) => ED.Stats.skill(p, i);
  ok(S(P[0][0]).slam === 1 && S(P[1][0]).back && S(P[1][0]).spin && S(P[1][0]).n === 2 && S(P[2][0]).ret && S(P[2][0]).wave === 3 && !S(P[0][0]).back && !S(P[1][0]).wave,
    'knight: Greatblade 5 slams; Whirl 5 swings back, spins, 2 swings; Edge Wave 5 3 returning waves; no flag from another path');
  ok(S(P[0][1]).two && S(P[0][1]).n === 5 && S(P[1][1]).heavy === 2 && S(P[1][1]).pierce === S(r).pierce + 4 && S(P[2][1]).bounce === 4 && S(P[2][1]).kshot === 1,
    'ranger: Spread 5 two targets, 5 arrows; Piercer 5 heavy every 2nd, pierce +4; Ricochet 5 4 bounces, kill shots');
  ok(S(P[0][2]).flare > 0 && S(P[1][2]).shells === 2 && S(P[1][2]).cluster === 4 && S(P[2][2]).combust === 3 && S(P[2][2]).cemb === 3 && S(P[2][2]).spread === 1,
    'pyro: Blaze 5 flare; Mortar 5 shells 2, bomblets 4; Combustion 5 death blasts, embers 3, leaps');
  ok(S(P[0][3]).cap === S(n).cap + 2 && S(P[0][3]).raise === 2 && S(P[0][3]).over === 4 && S(P[1][3]).split === 3 && S(P[1][3]).homing === 3 && S(P[1][3]).n === 4 && S(P[2][3]).pools === 2 && S(P[2][3]).pburst === 1,
    'necro: Legion 5 cap +2, raise 2, 4 over the cap; Shards 5 4 homing shards splitting in 3; Plague 5 2 pools that burst');
  ok(Math.abs(N(k, 0).r - 60) < 1e-9 && Math.abs(N(k, 0).dur - 8) < 1e-9 && Math.abs(N(k, 0).cd - 20) < 1e-9 && N(k, 0).follow === true, 'knight: Aegis Ward wider, longer, cooldown 20 s, follows (L5)');
  ok(N(r, 0).dist === 220 && N(r, 0).charges === 2 && N(r, 0).caltrops === 1 && N(r, 0).gemAll === true, 'ranger: Vault farther, 2 charges, caltrops, pulls every gem on screen (L5)');
  ok(Math.abs(N(py, 0).r - 182) < 1e-9 && N(py, 0).flee === 3.5 && N(py, 0).gem === 200 && N(py, 0).again === true, 'pyro: Flashpoint wider, longer flee, gem pull, second flash (L5)');
  ok(N(n, 0).len === 200 && N(n, 0).ring === 80 && N(n, 0).taunt === 160 && Math.abs(N(n, 0).dur - 10) < 1e-9 && N(n, 0).mire === 0.5, 'necro: Bone Wall longer, ring, taunt, 2x duration + 50% slow (L5)');
  // Utility skills: no skill carries a damage number.
  ok(Object.keys(ED.SKILLS).every(id => !ED.SKILLS[id].base || ED.SKILLS[id].base.dmg === undefined) && w.heroes.every(p => !(N(p, 0).dmg > 0)), 'skills carry no damage');
  const nn = n; nn.x = nn.y = 1600; w.time = 300;
  // Hard cap: raising 30 leaves at most 24.
  for (let i = 0; i < 30; i++) ED.Necro.raise(w, nn, 1600, 1600, 'boneshard', false, 15);
  ok(ED.Necro.liveMinions(nn) === 24, 'necro: minion hard cap 24 (oldest fall)');
}
// ---------------- auto aim ----------------
// Scene: spawner silenced, every brazier broken, hero at the arena centre in auto aim; foes placed by hand.
function scene(cls, seed) {
  const w = new ED.World({ seed: seed || 9, stage: 0, players: [{ pid: 'p1', name: 'A', slot: 0, cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  for (const b of w.arena.braziers) b.broken = true;
  w.input('p1', { auto: true }); w.update(C.TICK); w.events.length = 0;
  return { w, p: w.heroes[0] };
}
const clear = (w) => { for (const e of w.foes) if (!e.dead) w.despawnFoe(e); w.compact(); w.foeGrid(); };
const near = (a, b, e) => Math.abs(U.angDiff(a, b)) < (e || 0.05);
{
  const STY = new Set(['nearest', 'facing', 'random', 'crowd']);
  const dir = ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].mode === 'cursor');
  ok(dir.every(id => STY.has(ED.WEAPONS[id].autoAim)) && ED.WEAPON_IDS.every(id => !ED.WEAPONS[id].autoAim || STY.has(ED.WEAPONS[id].autoAim)),
    `auto aim: every cursor-mode weapon / Form (${dir.length}) has an autoAim style; every style is valid`);
  const { w, p } = scene('knight');
  clear(w); p.mdir = 1.1;
  w.spawnFoe(FODDER, p.x + 100, p.y); w.spawnFoe(FODDER, p.x - 60, p.y + 30);
  ok(near(w.aimDir(p), Math.atan2(30, -60)) && Math.abs(w.aimD - Math.hypot(60, 30)) < 0.5, 'auto nearest (default style): toward the nearest foe in view, aimD its distance');
  const b = w.arena.braziers[0], bx = b.x, by = b.y; b.x = p.x; b.y = p.y - 40; b.broken = false;
  ok(near(w.aimDir(p), -Math.PI / 2), 'auto nearest: an intact brazier nearer than every foe is the target');
  b.broken = true; b.x = bx; b.y = by;
  ok(near(w.autoDir(p, { autoAim: 'facing' }, false), 1.1), 'auto facing: the heading (p.mdir), foes or not');
  const el = w.spawnFoe(FODDER, p.x + 200, p.y - 100, { elite: true });
  ok(el.elite && near(w.aimDir(p), Math.atan2(-100, 200)), 'auto nearest: an elite within 300 px comes before nearer foes');
  w.despawnFoe(el);
  clear(w); w.spawnFoe(FODDER, p.x + 400, p.y);
  ok(w.aimDir(p) === 1.1 && w.aimD === 0, 'auto nearest: no foe in view -> p.mdir');
  // random: same seed, same picks; every pick is a foe in view; picks vary
  const picks = (seed) => {
    const S = scene('knight', seed); clear(S.w);
    for (let i = 0; i < 6; i++) S.w.spawnFoe(FODDER, S.p.x - 150 + i * 60, S.p.y + (i % 2 ? 50 : -50));
    S.w.spawnFoe(FODDER, S.p.x + 500, S.p.y);
    const out = [];
    for (let i = 0; i < 24; i++) out.push(S.w.autoDir(S.p, { autoAim: 'random' }, false).toFixed(6));
    const legal = S.w.foes.filter(e => !e.dead && ED.inView(S.p, e.x, e.y, 0)).map(e => Math.atan2(e.y - S.p.y, e.x - S.p.x));
    return { out, ok: out.every(a => legal.some(l => near(+a, l, 1e-5))) };
  };
  const r1 = picks(31), r2 = picks(31);
  ok(r1.ok && r1.out.join() === r2.out.join() && new Set(r1.out).size >= 3, `auto random: picks foes in view (${new Set(r1.out).size} distinct of 6), same seed -> same picks`);
  clear(w); p.mdir = 0.3;
  ok(w.autoDir(p, { autoAim: 'random' }, false) === 0.3, 'auto random: no foe -> p.mdir');
  // crowd (Cleave): one foe east, six west, all in reach -> west; none in reach -> the nearest in view; none -> p.mdir
  w.aimWs = p.weapons[0]; w.aimS = w.weaponS(p, 0);
  w.spawnFoe(FODDER, p.x + 38, p.y - 4);
  for (let i = 0; i < 6; i++) w.spawnFoe(FODDER, p.x - 44, p.y - 4 + (i - 2.5) * 9);
  const cw = w.aimDir(p);
  ok(Math.abs(U.angDiff(cw, Math.PI)) < 0.3, `auto crowd: Cleave turns to the six foes west over the one east (${cw.toFixed(2)} rad)`);
  clear(w); w.spawnFoe(FODDER, p.x, p.y + 150);
  ok(near(w.aimDir(p), Math.PI / 2), 'auto crowd: none in reach -> the nearest foe in view');
  clear(w);
  ok(w.aimDir(p) === 0.3, 'auto crowd: none in view -> p.mdir');
  w.aimWs = null; w.aimS = null;
}
// face, dash and Q in auto
{
  const { w, p } = scene('knight');
  clear(w); p.mdir = Math.PI / 2;
  w.spawnFoe(FODDER, p.x - 40, p.y - 4, { hpMul: 50 });
  for (let i = 0; i < 90 && !(w.time - p.aimT < 0.5); i++) { w.input('p1', { auto: true, mx: 0, my: 0, ax: p.x + 100, ay: p.y }); w.update(C.TICK); w.events.length = 0; }
  w.update(C.TICK); w.events.length = 0;
  ok(near(p.face, Math.PI, 0.3), `auto face: the hero faces its weapon's target (${p.face.toFixed(2)} rad), not the cursor`);
  clear(w);
  for (let i = 0; i < 60; i++) { w.update(C.TICK); w.events.length = 0; }
  ok(p.face === p.mdir, 'auto face: no target for 0.6 s -> the heading');
  p.dashCd = 0; p.mdir = Math.PI / 2;
  w.input('p1', { auto: true, mx: 0, my: 0, ax: p.x + 100, ay: p.y, dash: true }); w.update(C.TICK); w.events.length = 0;
  ok(p.dashT > 0 && p.dashDy > 0.99, 'auto dash without a stick: along the heading, not the cursor');
  const cast = (cls, setup) => {
    const S = scene(cls); clear(S.w); S.p.skills[0].cd = 0; if (setup) setup(S.w, S.p);
    S.w.input('p1', { auto: true, q: true, ax: S.p.x + 100, ay: S.p.y }); S.w.update(C.TICK);
    const ev = S.w.events.find(e => e.t === 'skill'); S.w.events.length = 0;
    return { ev, w: S.w, p: S.p };
  };
  let c = cast('knight');
  ok(c.ev && c.ev.x === Math.round(c.p.x) && c.ev.y === Math.round(c.p.y), 'auto Q self (Aegis Ward): cast at the hero');
  c = cast('ranger', (w2, p2) => { p2.mdir = Math.PI; });
  ok(c.ev && c.p.vault && c.p.vault.x1 < c.p.vault.x0 - 100 && Math.abs(c.p.vault.y1 - c.p.vault.y0) < 1, 'auto Q facing (Vault): leaps along the heading, not toward the cursor');
  c = cast('necro', (w2, p2) => { for (let i = 0; i < 8; i++) w2.spawnFoe(FODDER, p2.x - 150 + (i % 4) * 8, p2.y + 40 + (i >> 2) * 8); w2.spawnFoe(FODDER, p2.x + 60, p2.y); });
  ok(c.ev && Math.hypot(c.ev.x - (c.p.x - 138), c.ev.y - (c.p.y + 44)) < 20, `auto Q densest (Bone Wall): on the cluster (${c.ev && (c.ev.x - Math.round(c.p.x))}, ${c.ev && (c.ev.y - Math.round(c.p.y))})`);
}
// auto runs: every path at rank 5 and every Form (refine 2), 8 s each in a foe ring with Q held: no exception, damage, Q casts; run again silently: same digest
function quiet(w, p, secs, out) {
  for (let i = 0; i < secs * 60 && w.state === 'play'; i++) {
    drive(w, p, w.tick);
    if (i % 60 === 0) feed(w, p);
    w.update(C.TICK); w.events.length = 0;
    out.digest = (Math.imul(out.digest, 31) + U.hashStr(w.kills + '|' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + '|' + w.foes.length + '|' + w.zones.length)) >>> 0;
  }
}
AUTO = true;
for (const cls of HEROES) {
  const sig = ED.HEROES[cls].sig, builds = [0, 1, 2].map(i => ({ path: i })).concat(ED.weaponForms(sig).map(f => ({ form: f.id })));
  const dig = [0, 0];
  for (let pass = 0; pass < 2; pass++) for (const b of builds) {
    const w = new ED.World({ seed: 600, stage: 0, players: [{ pid: 'p1', name: 'T', slot: 0, cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
    w.time = 240;
    const p = w.heroes[0], ws = p.weapons[0], out = { digest: 0, maxMin: 0 };
    if (b.form) w.setForm(p, ws, b.form, 2); else w.setRanks(p, ws, ED.TUNE_MAX, b.path, ED.PATH_MAX);
    if (pass) quiet(w, p, 8, out);
    else { phase(w, p, 8, `auto ${ws.id}${b.form ? ' refine 2' : ' path ' + b.path + ' rank 5'}`, out); ok(p.in.auto, `${cls} auto ${ws.id}: runs in auto aim`); }
    dig[pass] = (Math.imul(dig[pass], 31) + out.digest) >>> 0;
  }
  ok(dig[0] === dig[1], `${cls} auto: same seed -> same digest (${dig[0]})`);
}
AUTO = false;
console.log(`check-heroes-a: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
