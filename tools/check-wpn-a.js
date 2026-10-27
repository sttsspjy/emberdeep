// Headless check of general weapons group A (exit 1 on failure). Usage: node tools/check-wpn-a.js
// 1. Defs: 7 level entries, card lines <= 40 chars, pair passive and evolution exist, evolved defs flagged.
// 2. Each weapon alone (signature removed) at level 1, level 8 and evolved: 20 s against a topped-up horde, hero walking a circle, god cheat, no level-ups:
//    no exceptions, nonzero damage, bounded projectile / zone counts; the level-8 run repeated gives the same digest.
// 3. Evolution: level 8 + paired passive is evolution-ready and w.evolve swaps to the evolved id.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
const IDS = ['lanterns', 'chainspark', 'frostring', 'bramble', 'glaive', 'meteorcall'];
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };

// 1. defs
for (const id of IDS) {
  const d = ED.WEAPONS[id], e = d && ED.WEAPONS[d.evo];
  ok(d && d.levels.length === 7 && d.txt.length <= 40 && d.levels.every(l => l.txt && l.txt.length <= 40 && l.mods), `${id}: 7 levels, card lines <= 40 chars`);
  ok(d && ED.PASSIVES[d.pair] && e && e.evolved && e.from === id && e.txt.length <= 40, `${id}: pair ${d && d.pair}, evolves to ${d && d.evo}`);
}

// 2. horde runs
const SEC = 20;
function run(id, lvl, seed) {
  const w = new ED.World({ seed, stage: 0, players: [{ pid: 'p1', name: 'P1', slot: 0, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  const p = w.heroes[0];
  w.addXp = () => {};
  p.weapons.length = 0;
  const ws = w.addWeapon(p, id); ws.lvl = lvl;
  const out = { w, dealt: 0, maxProjs: 0, maxZones: 0, err: null, digest: 0, ms: 0 };
  const rng = U.RNG(seed ^ 0x5eed);
  const top = () => { // keep >= 140 foes within 320 px (spawned 60-300 px out)
    let n = 0; for (const e of w.foes) if (!e.dead && U.dist2(e.x, e.y, p.x, p.y) < 320 * 320) n++;
    for (; n < 140; n++) { const a = rng.range(0, U.TAU), d = rng.range(60, 300); w.spawnFoe(rng.chance(0.85) ? 'skeleton' : 'slime', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, { hpMul: 4 }); }
  };
  const t0 = process.hrtime.bigint();
  try {
    for (let tick = 0; tick < SEC * 60; tick++) {
      if (tick % 30 === 0) top();
      const a = tick / 60 * 0.9;
      w.input('p1', { mx: Math.cos(a), my: Math.sin(a), ax: p.x + 50, ay: p.y });
      w.update(C.TICK);
      w.events.length = 0;
      if (w.projs.length > out.maxProjs) out.maxProjs = w.projs.length;
      if (w.zones.length > out.maxZones) out.maxZones = w.zones.length;
      if (tick % 60 === 0) {
        let s = 0; for (const e of w.foes) s += e.x * 3 + e.y + e.hp;
        out.digest = (Math.imul(out.digest, 31) + U.hashStr(w.kills + '|' + s.toFixed(2) + '|' + w.projs.length + '|' + w.zones.length)) >>> 0;
      }
    }
  } catch (e) { out.err = e; }
  out.ms = Number(process.hrtime.bigint() - t0) / 1e6 / (SEC * 60);
  out.dealt = p.dealt[id] || 0;
  return out;
}
for (const base of IDS) {
  for (const [id, lvl] of [[base, 1], [base, 8], [ED.WEAPONS[base].evo, 8]]) {
    const r = run(id, lvl, 4242);
    ok(!r.err && r.dealt > 0 && r.maxProjs < 1500 && r.maxZones < 1500,
      `${id} L${lvl}: dealt ${Math.round(r.dealt)}, kills ${r.w.kills}, max projs ${r.maxProjs}, max zones ${r.maxZones}, ${r.ms.toFixed(2)} ms/tick` + (r.err ? ': ' + r.err.stack : ''));
    if (lvl === 8 && id === base) { const r2 = run(id, lvl, 4242); ok(!r2.err && r2.digest === r.digest, `${id} L8 deterministic (${r.digest} / ${r2.digest})`); }
  }
}

// 3. evolution path
for (const id of IDS) {
  const w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', name: 'P1', slot: 0, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  const p = w.heroes[0], ws = w.addWeapon(p, id), def = ED.WEAPONS[id];
  ws.lvl = 8;
  const before = w.weaponReady(p, ws);
  p.passives.push({ id: def.pair, lvl: 1 }); w.recalc(p);
  const ready = w.weaponReady(p, ws);
  if (ready) w.evolve(p, ws);
  let err = null;
  try { for (let i = 0; i < 120; i++) { w.update(C.TICK); w.events.length = 0; } } catch (e) { err = e; }
  ok(!before && ready && ws.id === def.evo && !err, `${id}: evolves to ${def.evo} with ${def.pair}` + (err ? ': ' + err.stack : ''));
}

console.log(`check-wpn-a: ${fails ? fails + ' failure(s)' : 'all passed'}`);
process.exitCode = fails ? 1 : 0;
