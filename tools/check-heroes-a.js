// Headless check for heroes Knight, Ranger, Pyro, Necro (exit 1 on failure). Usage: node tools/check-heroes-a.js
// Per hero (god cheat, from 4:00 so the horde is dense): 4 phases of 15 s with skill level 1..4 and 0 / 3 / 6 / 9 path ranks (path 0 first), then 20 s in the path-0 Form, refined twice.
// Q is held every tick (cast on cooldown), aimed at the nearest foe; fodder rings keep targets near the hero. Each phase: no exception, the skill casts, the weapon deals damage, the skill none.
// Extras: Bone Shard / Bone Storm on other heroes (the slain rise for them too), Cleave aims inside the facing cone (no foe: along it), path shape flags reach the effective numbers,
// skills carry no damage, necro minions rise / obey the cap, same seed -> same digest, no NaN positions.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const HEROES = ['knight', 'ranger', 'pyro', 'necro'];

function drive(w, p, tick) {
  const e = w.nearestFoe(p.x, p.y, 300), a = tick / 60 * 0.6;
  p.offer = null; p.pend = 0; // no card picks: the phase setup owns the build
  w.input(p.pid, { mx: Math.cos(a) * 0.6, my: Math.sin(a) * 0.6, ax: e ? e.x : p.x + 80, ay: e ? e.y : p.y, q: true });
}
// Sets skill levels to L, spends `ranks` more path ranks (path 0 first); form: takes the path-0 Form and refines it twice.
function setup(w, p, L, ranks, form) {
  for (const sk of p.skills) sk.lvl = L;
  const ws = p.weapons[0], def = ED.WEAPONS[ED.HEROES[p.cls].sig];
  if (form) {
    const ready = w.formsReady(p, ws).map(f => f.id);
    ok(ready.indexOf(def.paths[0].form) >= 0, `${p.cls}: ${def.paths[0].form} is ready with path 0 at rank 3 (ready: ${ready.join(',')})`);
  }
  w.setRanks(p, ws, ranks, form);
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
  for (let L = 1; L <= 4; L++) { setup(w, p, L, L > 1 ? 3 : 0, false); phase(w, p, 15, `skill lvl ${L}, ${p.weapons[0].id} ranks ${p.weapons[0].pr.join('')}`, out); }
  setup(w, p, 4, 0, true);
  phase(w, p, 20, `Form ${p.weapons[0].id} refine ${p.weapons[0].fl}`, out);
  return out;
}

for (const cls of HEROES) {
  const r = runHero(cls, 4242);
  const h = ED.HEROES[cls], def = ED.WEAPONS[h.sig], fd = ED.WEAPONS[def.paths[0].form], ws = r.p.weapons[0];
  ok(ws.id === fd.id && ws.evo && ws.fl === 2 && ws.pr.join('') === '333' && ws.lvl === 13, `${cls}: signature took the Form ${fd.id}, refined twice (lvl ${ws.lvl})`);
  ok(def.paths.length === 3 && def.paths.every(pa => pa.id && pa.name && pa.ranks.length === 3 && pa.ranks.every(l => l.txt.length <= 40)) && !def.levels && !def.pair && !def.evo,
    `${cls}: ${def.id} has 3 paths x 3 rank cards, lines <= 40 chars, no levels / pair / evo`);
  ok(fd.form && fd.evolved && fd.from === def.id && fd.refine.length === 2 && fd.refine.every(l => l.txt.length <= 40) && fd.txt.length <= 40, `${cls}: Form ${fd.id} from ${def.id}, 2 refine cards`);
  ok(h.skills.length === 1, `${cls}: one skill (${h.skills[0]})`);
  for (const id of h.skills) { const s = ED.SKILLS[id]; ok(s.levels.length === 3 && s.levels.every(l => l.txt.length <= 40), `${cls}: ${id} has 3 level cards, lines <= 40 chars`); }
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
  p.weapons.length = 0; const ws = w.addWeapon(p, id); w.setRanks(p, ws, 9, false);
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
  w.foes.length = 0; w.updateSpawner = () => {}; w.rankPath(p, ws, 2); w.recalc(p, false);
  p.in.ax = p.x; p.in.ay = p.y + 100; ws.cd = 99;
  let z = null; for (let i = 0; i < 60 && !z; i++) { w.update(C.TICK); w.events.length = 0; z = w.zones.find(o => !o.dead && o.k === 'beam'); }
  ok(z && Math.abs(U.angDiff(z.a, Math.PI / 2 - 1.9 / 2)) < 0.15, `smite: the Lance sweep starts centred on the cursor dir with no foe (a ${z && z.a.toFixed(2)})`);
  p.in.ax = p.x - 100; p.in.ay = p.y; ws.cd = 0; w.update(C.TICK);
  const pl = w.zones.filter(o => !o.dead && o.wid === 'smite' && o.k !== 'beam');
  ok(pl.length > 0 && pl.every(o => o.x < p.x - 20 && Math.abs(o.y - p.y) < 2), `smite: with no foe, pillars stride out along the cursor dir (${pl.map(o => Math.round(o.x - p.x) + ',' + Math.round(o.y - p.y)).join(' ')})`);
}
// Path shape flags reach the effective numbers (every path at rank 3, no Form).
{
  const w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight' }, { pid: 'p2', cls: 'ranger', slot: 1 }, { pid: 'p3', cls: 'pyro', slot: 2 }, { pid: 'p4', cls: 'necro', slot: 3 }], cheats: { god: true } });
  const [k, r, py, n] = w.heroes;
  for (const p of w.heroes) { w.setRanks(p, p.weapons[0], 9, false); for (const sk of p.skills) sk.lvl = 4; }
  const S = (p) => ED.Stats.weapon(p, 0), N = (p, i) => ED.Stats.skill(p, i);
  ok(S(k).back && S(k).spin && S(k).ret && S(k).slam === 1 && S(k).wave === 3 && S(k).n === 2, 'knight: Cleave 333 swings back, spins, slams, 3 returning waves, 2 swings');
  ok(S(r).heavy === 2 && S(r).two && S(r).n === 5 && S(r).pierce === 12 && S(r).bounce === 4 && S(r).kshot === 1, 'ranger: Longbow 333 heavy every 2nd, two targets, 5 arrows, pierce 12, 4 bounces, kill shots');
  ok(S(py).shells === 2 && S(py).cluster === 4 && S(py).combust === 3 && S(py).cemb === 3 && S(py).spread === 1 && S(py).flare > 0, 'pyro: Fire Bolt 333 shells 2, bomblets 4, death blasts, embers 3, leaps, flare');
  ok(S(n).cap === 5 && S(n).raise === 2 && S(n).over === 4 && S(n).split === 3 && S(n).homing === 3 && S(n).n === 4 && S(n).pools === 2 && S(n).pburst === 1,
    'necro: Bone Shard 333 cap 5, raise 2, 4 over the cap, 4 homing shards splitting in 3, 2 pools that burst');
  ok(N(k, 0).stun === 1 && N(k, 0).ring === 3 && Math.abs(N(k, 0).r - 156) < 1e-9, 'knight: Bulwark Shove wider, stuns, leaves a ring');
  ok(N(r, 0).dist === 220 && N(r, 0).charges === 2 && N(r, 0).caltrops === 1, 'ranger: Vault farther, 2 charges, caltrops');
  ok(Math.abs(N(py, 0).r - 182) < 1e-9 && N(py, 0).flee === 3.5 && N(py, 0).gem === 200, 'pyro: Flashpoint wider, longer flee, gem pull');
  ok(N(n, 0).len === 200 && N(n, 0).ring === 80 && N(n, 0).taunt === 160, 'necro: Bone Wall longer, ring, taunt');
  // Utility skills: no skill carries a damage number.
  ok(Object.keys(ED.SKILLS).every(id => !ED.SKILLS[id].base || ED.SKILLS[id].base.dmg === undefined) && w.heroes.every(p => !(N(p, 0).dmg > 0)), 'skills carry no damage');
  const nn = n; nn.x = nn.y = 1600; w.time = 300;
  // Hard cap: raising 30 leaves at most 24.
  for (let i = 0; i < 30; i++) ED.Necro.raise(w, nn, 1600, 1600, 'boneshard', false, 15);
  ok(ED.Necro.liveMinions(nn) === 24, 'necro: minion hard cap 24 (oldest fall)');
}
console.log(`check-heroes-a: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
