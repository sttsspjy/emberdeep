// Headless check for heroes Knight, Ranger, Pyro, Necro (exit 1 on failure). Usage: node tools/check-heroes-a.js
// Per hero (god cheat, from 4:00 so the horde is dense): 4 phases of 15 s with skill level 1..4 and 0 / 3 / 6 / 9 path ranks (path 0 first), then 20 s in the path-0 Form, refined twice.
// Q is held every tick (cast on cooldown), aimed at the nearest foe; fodder rings keep targets near the hero. Each phase: no exception, the skill casts, the weapon and the skill deal damage.
// Extras: Bone Shard / Bone Storm on other heroes (the slain rise for them too), Cleave aims inside the facing cone (no foe: along it), path shape flags reach the effective numbers,
// skill damage scales with the weapon and the party level, necro minions rise / obey the cap and Corpse Blast detonates, same seed -> same digest, no NaN positions.
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
  ok(d(wid) > 0 && d(q) > 0, `${p.cls} ${tag}: dealt ${wid} ${d(wid)}, ${q} ${d(q)}`);
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
// Cleave aims at a foe inside the facing cone, falls back to the nearest foe in reach (behind), swings along the facing with no foe in reach.
{
  const w = new ED.World({ seed: 3, stage: 0, players: [{ pid: 'p1', cls: 'knight' }], cheats: { god: true } }), p = w.heroes[0];
  w.foes.length = 0; p.mdir = 0;
  const ws = p.weapons[0], fire = () => { w.events.length = 0; const r = ED.WIMPL.cleave.fire(w, p, ws, ED.Stats.weapon(p, 0)); const ev = w.events.find(e => e.t === 'swing'); return r ? (ev ? ev.a : NaN) : null; };
  const put = (a) => { for (const e of w.foes) e.dead = true; w.spawnFoe(FODDER, p.x + Math.cos(a) * 40, p.y - 4 + Math.sin(a) * 40); };
  put(1.2); const a1 = fire();
  put(Math.PI); const a2 = fire();
  for (const e of w.foes) e.dead = true; w.spawnFoe(FODDER, p.x + 300, p.y); const a3 = fire();
  ok(a1 !== null && Math.abs(U.angDiff(a1, 1.2)) < 0.15, `knight: Cleave swings at a foe 69 deg off its facing (a ${a1 && a1.toFixed(2)})`);
  ok(a2 !== null && Math.abs(U.angDiff(a2, Math.PI)) < 0.15, `knight: Cleave swings at the only foe, behind (a ${a2 && a2.toFixed(2)})`);
  ok(a3 !== null && Math.abs(U.angDiff(a3, 0)) < 1e-9, `knight: Cleave swings along its facing with no foe in reach (a ${a3 && a3.toFixed(2)})`);
}
// Path shape flags reach the effective numbers (every path at rank 3, no Form).
{
  const w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight' }, { pid: 'p2', cls: 'ranger', slot: 1 }, { pid: 'p3', cls: 'pyro', slot: 2 }, { pid: 'p4', cls: 'necro', slot: 3 }], cheats: { god: true } });
  const [k, r, py, n] = w.heroes;
  for (const p of w.heroes) { w.setRanks(p, p.weapons[0], 9, false); for (const sk of p.skills) sk.lvl = 4; }
  const S = (p) => ED.Stats.weapon(p, 0), N = (p, i) => ED.Stats.skill(p, i);
  ok(S(k).back && S(k).wave === 3 && S(k).n === 3, 'knight: Cleave 333 swings back, 3 waves, 3 swings');
  ok(S(r).heavy === 2 && S(r).two && S(r).n === 5 && S(r).pierce === 12 && S(r).bounce === 4 && S(r).kshot === 1, 'ranger: Longbow 333 heavy every 2nd, two targets, 5 arrows, pierce 12, 4 bounces, kill shots');
  ok(S(py).embers === 6 && S(py).n === 4 && S(py).pierce === 1, 'pyro: Fire Bolt 333 throws 6 embers, 4 bolts, pierce 1');
  ok(S(n).mshot && S(n).homing === 3 && S(n).n === 5 && S(n).pierce === 6 && Math.abs(S(n).rise - 0.14) < 1e-9, 'necro: Bone Shard 333 minion shots, homing, 5 shards, pierce 6, rise 14%');
  ok(N(k, 0).shards === 10 && N(k, 0).quake, 'knight: Charge quake + shards');
  ok(N(r, 0).pin && N(r, 0).follow && N(r, 0).flank === 2, 'ranger: Volley pin + follow + flank');
  ok(N(py, 0).shards === 10 && N(py, 0).extra === 2, 'pyro: Meteor shards + extra');
  ok(N(n, 0).shards && N(n, 0).rerise, 'necro: Corpse Blast shards + rerise');
  // Skill damage: base x levels x might x weapon factor x (1 + 0.05 (party level - 1)).
  const q = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'pyro' }] }), h = q.heroes[0], base = ED.SKILLS.meteor.base.dmg;
  const n1 = q.skillN(h, 0).dmg;
  q.level = 11; const n11 = q.skillN(h, 0).dmg;
  q.rankPath(h, h.weapons[0], 2); q.recalc(h, false); const nw = q.skillN(h, 0).dmg; // embers rank 1: +25% weapon damage
  ok(Math.abs(n1 - base) < 1e-9 && Math.abs(n11 / n1 - 1.5) < 1e-9 && Math.abs(nw / n11 - 1.25) < 1e-9 && Math.abs(ED.Stats.weaponMul(h) - 1.25) < 1e-9,
    `skill damage scales: level 1 ${n1}, party level 11 x${(n11 / n1).toFixed(2)}, +25% weapon dmg x${(nw / n11).toFixed(2)}`);
  q.setRanks(h, h.weapons[0], 9, true);
  ok(Math.abs(ED.Stats.weaponMul(h) - ED.Stats.weapon(h, 0).dmg / ED.WEAPONS.firebolt.base.dmg) < 1e-9 && ED.Stats.weaponMul(h) > 26 / 16, 'Form base counts in the weapon factor (' + ED.Stats.weaponMul(h).toFixed(2) + ')');
  // Corpse Blast detonates minions in view.
  const nn = n; nn.x = nn.y = 1600; w.time = 300;
  for (let i = 0; i < 6; i++) ED.Necro.raise(w, nn, 1600 + i * 10, 1620, 'boneshard', false, 15);
  const before = ED.Necro.liveMinions(nn);
  const res = ED.CAST.corpseblast(w, nn, 1600, 1600, ED.Stats.skill(nn, 0), nn.skills[0]);
  ok(before === 6 && res.n >= 6, `necro: Corpse Blast detonates ${res.n} (minions before ${before}), rerise keeps ${ED.Necro.liveMinions(nn)}`);
  // Hard cap: raising 30 leaves at most 24.
  for (let i = 0; i < 30; i++) ED.Necro.raise(w, nn, 1600, 1600, 'boneshard', false, 15);
  ok(ED.Necro.liveMinions(nn) === 24, 'necro: minion hard cap 24 (oldest fall)');
}
console.log(`check-heroes-a: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
