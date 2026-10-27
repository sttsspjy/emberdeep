// Headless check for heroes Knight, Ranger, Pyro, Necro (exit 1 on failure). Usage: node tools/check-heroes-a.js
// Per hero (god cheat, from 4:00 so the horde is dense): 4 phases of 15 s with skill level 1..4 and signature level 2/4/6/8, then 20 s evolved (pair passive owned).
// Q and E are held every tick (cast on cooldown), aimed at the nearest foe; fodder rings keep targets near the hero. Each phase: no exception, both skills cast, the signature and both skills deal damage.
// Extras: these signatures (base and evolved) on other heroes (Bone Shard / Bone Storm raise minions for them too), Cleave aims inside the facing cone, shape flags reach
// the effective numbers, necro minions rise / obey the cap and Corpse Blast detonates,
// same seed -> same digest, no NaN positions.
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
  w.input(p.pid, { mx: Math.cos(a) * 0.6, my: Math.sin(a) * 0.6, ax: e ? e.x : p.x + 80, ay: e ? e.y : p.y, q: true, e: true });
}
// Sets skill levels to L and the signature to weapon level wl (or its evolution).
function setup(w, p, L, wl, evo) {
  for (const sk of p.skills) sk.lvl = L;
  const ws = p.weapons[0], def = ED.WEAPONS[ED.HEROES[p.cls].sig];
  ws.lvl = wl;
  if (evo && ws.id === def.id) {
    if (!p.passives.some(x => x.id === def.pair)) { p.passives.push({ id: def.pair, lvl: 1 }); w.recalc(p); }
    ok(w.weaponReady(p, ws), `${p.cls}: ${def.id} is evolution-ready at level 8 + ${def.pair}`);
    w.evolve(p, ws);
  }
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
  const h = ED.HEROES[p.cls], wid = p.weapons[0].id, [q, e] = h.skills;
  ok(!err && !nan, `${p.cls} ${tag}: no exception, finite positions` + (err ? ': ' + err.stack : ''));
  ok((casts[q] || 0) > 0 && (casts[e] || 0) > 0, `${p.cls} ${tag}: casts ${q} ${casts[q] || 0}, ${e} ${casts[e] || 0}`);
  ok(d(wid) > 0 && d(q) > 0 && d(e) > 0, `${p.cls} ${tag}: dealt ${wid} ${d(wid)}, ${q} ${d(q)}, ${e} ${d(e)}`);
  out.maxMin = Math.max(out.maxMin, maxMin);
}
function runHero(cls, seed) {
  const w = new ED.World({ seed, stage: 0, players: [{ pid: 'p1', name: 'T', slot: 0, cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.time = 240;
  const p = w.heroes[0], out = { digest: 0, maxMin: 0, w, p };
  for (let L = 1; L <= 4; L++) { setup(w, p, L, L * 2, false); phase(w, p, 15, `skill lvl ${L}, ${p.weapons[0].id} lvl ${L * 2}`, out); }
  setup(w, p, 4, 8, true);
  phase(w, p, 20, `evolved ${p.weapons[0].id}`, out);
  return out;
}

for (const cls of HEROES) {
  const r = runHero(cls, 4242);
  const h = ED.HEROES[cls], def = ED.WEAPONS[h.sig];
  ok(r.p.weapons[0].id === def.evo, `${cls}: signature evolved into ${def.evo}`);
  ok(def.levels.length === 7 && def.levels.every(l => l.txt.length <= 40), `${cls}: ${def.id} has 7 level cards, lines <= 40 chars`);
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
// Signatures carried by other heroes (meta.sigs unlock): base and evolved forms on a cleric and a bell, 15 s, no exception, all deal damage.
for (const [cls, ids] of [['cleric', ['longbow', 'firebolt', 'boneshard', 'cleave']], ['bell', ['hail', 'inferno', 'bonestorm', 'whirlwind']]]) {
  const w = new ED.World({ seed: 9, stage: 0, players: [{ pid: 'p1', cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } }), p = w.heroes[0];
  w.time = 240;
  for (const id of ids) { const ws = w.addWeapon(p, id); if (ws) ws.lvl = 8; }
  let err = null, maxMin = 0;
  try { for (let i = 0; i < 900; i++) { drive(w, p, i); if (i % 60 === 0) feed(w, p); w.update(C.TICK); w.events.length = 0; maxMin = Math.max(maxMin, ED.Necro.liveMinions(p)); } } catch (e) { err = e; }
  const dealt = ids.map(id => id + ' ' + Math.round(p.dealt[id] || 0));
  ok(!err && ids.every(id => p.dealt[id] > 0), `${cls} carrying ${ids.join(', ')}: ${dealt.join(', ')}` + (err ? ': ' + err.stack : ''));
  ok(maxMin > 0, `${cls} carrying ${ids[2]}: the slain rise (peak ${maxMin} minions)`);
}
// Cleave aims at a foe inside the facing cone, holds while the only foe is behind, swings back at it once it has the back swing.
{
  const w = new ED.World({ seed: 3, stage: 0, players: [{ pid: 'p1', cls: 'knight' }], cheats: { god: true } }), p = w.heroes[0];
  w.foes.length = 0; p.mdir = 0;
  const ws = p.weapons[0], fire = () => { w.events.length = 0; const r = ED.WIMPL.cleave.fire(w, p, ws, ED.Stats.weapon(p, 0)); const ev = w.events.find(e => e.t === 'swing'); return r ? (ev ? ev.a : NaN) : null; };
  const put = (a) => { for (const e of w.foes) e.dead = true; w.spawnFoe(FODDER, p.x + Math.cos(a) * 40, p.y - 4 + Math.sin(a) * 40); };
  put(1.2); const a1 = fire();
  put(Math.PI); const a2 = fire();
  ws.lvl = 3; const a3 = fire();
  ok(a1 !== null && Math.abs(U.angDiff(a1, 1.2)) < 0.15, `knight: Cleave swings at a foe 69 deg off its facing (a ${a1 && a1.toFixed(2)})`);
  ok(a2 === null, 'knight: Cleave holds while the only foe is behind');
  ok(a3 !== null, 'knight: Cleave 3 swings at a foe behind');
}
// Shape flags reach the effective numbers.
{
  const w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight' }, { pid: 'p2', cls: 'ranger', slot: 1 }, { pid: 'p3', cls: 'pyro', slot: 2 }, { pid: 'p4', cls: 'necro', slot: 3 }], cheats: { god: true } });
  const [k, r, py, n] = w.heroes;
  for (const p of w.heroes) { p.weapons[0].lvl = 8; for (const sk of p.skills) sk.lvl = 4; }
  const S = (p) => ED.Stats.weapon(p, 0), N = (p, i) => ED.Stats.skill(p, i);
  ok(S(k).back && S(k).wave === 3 && S(k).n === 3, 'knight: Cleave 8 swings back, 3 waves, 3 swings');
  ok(S(r).back && S(r).ring === 4 && S(r).n === 4 && S(r).pierce === 2, 'ranger: Longbow 8 fires behind, ring every 4th, 4 arrows, pierce 2');
  ok(S(py).embers === 4 && S(py).n === 4 && S(py).pierce === 1, 'pyro: Fire Bolt 8 throws embers, 4 bolts, pierce 1');
  ok(S(n).mshot && S(n).homing === 3 && S(n).n === 5 && Math.abs(S(n).rise - 0.1) < 1e-9, 'necro: Bone Shard 8 minion shots, homing, 5 shards, rise 10%');
  ok(N(k, 0).shards === 10 && N(k, 0).quake && N(k, 1).pulse && N(k, 1).end, 'knight: Charge quake + shards, Bulwark pulse + end');
  ok(N(r, 0).follow && N(r, 0).flank === 2 && N(r, 1).pull && N(r, 1).boom > 0, 'ranger: Volley follow + flank, Snare pull + boom');
  ok(N(py, 0).shards === 10 && N(py, 0).extra === 2 && N(py, 1).twice && N(py, 1).scorch, 'pyro: Meteor shards + extra, Flame Ring twice + scorch');
  ok(N(n, 0).n === 8 && N(n, 0).quake && N(n, 0).knight && N(n, 1).shards && N(n, 1).rerise, 'necro: Raise 8 + quake + knight, Corpse Blast shards + rerise');
  // Corpse Blast detonates minions in view.
  const nn = n; nn.x = nn.y = 1600; w.time = 300;
  for (let i = 0; i < 6; i++) ED.Necro.raise(w, nn, 1600 + i * 10, 1620, 'raise', false, 15);
  const before = ED.Necro.liveMinions(nn);
  const res = ED.CAST.corpseblast(w, nn, 1600, 1600, ED.Stats.skill(nn, 1), nn.skills[1]);
  ok(before === 6 && res.n >= 6, `necro: Corpse Blast detonates ${res.n} (minions before ${before}), rerise keeps ${ED.Necro.liveMinions(nn)}`);
  // Hard cap: raising 30 leaves at most 24.
  for (let i = 0; i < 30; i++) ED.Necro.raise(w, nn, 1600, 1600, 'raise', false, 15);
  ok(ED.Necro.liveMinions(nn) === 24, 'necro: minion hard cap 24 (oldest fall)');
}
console.log(`check-heroes-a: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
