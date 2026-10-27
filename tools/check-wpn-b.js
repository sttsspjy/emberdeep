// Headless gauntlet for general weapons group B (exit 1 on failure). Usage: node tools/check-wpn-b.js
// 1. Defs: 7 level entries, card lines <= 40 chars, pair is a passive, evo is an evolved def pointing back.
// 2. Each weapon alone (signature removed) at level 1, level 8 and evolved: 20 s against a topped-up ring of foes, god cheat, circle walk: no exceptions, nonzero damage,
//    bounded projectiles / zones; the same seed twice gives the same digest.
// 3. Evolution: level 8 + paired passive is ready; evolve swaps the id and the new form deals damage.
// 4. Evolution payoff: each evolved form deals >= 1.15x its level-8 base on a dense immortal crowd.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const BASES = ['bonespear', 'blight', 'wisp', 'mortar', 'censer', 'ricochet'];
const t0 = Date.now();

// 1. defs
for (const id of BASES) {
  const d = ED.WEAPONS[id], e = d && ED.WEAPONS[d.evo];
  ok(!!d && d.levels.length === 7 && d.levels.every(L => L.txt && L.txt.length <= 40) && d.txt.length <= 40, `${id}: 7 levels, card lines <= 40 chars`);
  ok(!!d && !!ED.PASSIVES[d.pair] && !!e && e.evolved && e.from === id && e.txt.length <= 40, `${id}: pair ${d && d.pair}, evolves to ${d && d.evo}`);
  ok(!!ED.WIMPL[id] && !!ED.WIMPL[d.evo], `${id}: impls registered`);
}

// 2. gauntlet
const roster = ED.FOE_IDS.filter(k => { const f = ED.FOES[k]; return !f.boss && !f.solo && !f.fuse && !f.split; });
function gauntlet(wid, lvl, seed) {
  const w = new ED.World({ seed, stage: 0, players: [{ pid: 'p1', name: 'T', slot: 0, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  const p = w.heroes[0];
  p.weapons.length = 0;
  const ws = w.addWeapon(p, wid); ws.lvl = lvl;
  const out = { dmg: 0, err: null, maxProj: 0, maxZone: 0, digest: 0, w };
  try {
    for (let tick = 0; tick < 20 * 60; tick++) {
      const a = tick / 60 * 0.8;
      w.input('p1', { mx: Math.cos(a), my: Math.sin(a), ax: p.x + 80, ay: p.y, pick: p.offer ? 1 : 0 });
      if (tick % 30 === 0 && w.foes.length < 160) {
        for (let i = 0; i < 24; i++) { const b = w.rng.next() * U.TAU, r = 70 + w.rng.next() * 170; w.spawnFoe(roster[i % roster.length], p.x + Math.cos(b) * r, p.y + Math.sin(b) * r); }
      }
      w.update(C.TICK);
      w.events.length = 0;
      p.offer = null; p.pend = 0; w.paused = false;
      if (w.projs.length > out.maxProj) out.maxProj = w.projs.length;
      if (w.zones.length > out.maxZone) out.maxZone = w.zones.length;
      if (tick % 60 === 0) out.digest = (Math.imul(out.digest, 31) + U.hashStr(w.kills + '|' + w.projs.length + '|' + w.zones.length + '|' + Math.round(p.dealt[wid] || 0))) >>> 0;
    }
  } catch (e) { out.err = e; }
  out.dmg = p.dealt[wid] || 0;
  return out;
}
for (const id of BASES) {
  for (const [wid, lvl] of [[id, 1], [id, 8], [ED.WEAPONS[id].evo, 8]]) {
    const a = gauntlet(wid, lvl, 77), b = gauntlet(wid, lvl, 77);
    ok(!a.err && a.dmg > 0 && a.maxProj < 900 && a.maxZone < 200 && a.digest === b.digest,
      `${wid} L${lvl}: dealt ${Math.round(a.dmg)}, kills ${a.w.kills}, peak projs ${a.maxProj}, zones ${a.maxZone}, deterministic ${a.digest === b.digest}` + (a.err ? ': ' + a.err.stack : ''));
  }
}

// 3. evolution path
for (const id of BASES) {
  const w = new ED.World({ seed: 5, stage: 0, players: [{ pid: 'p1', cls: 'ranger', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  const p = w.heroes[0], ws = w.addWeapon(p, id), d = ED.WEAPONS[id];
  ws.lvl = 8;
  const before = w.weaponReady(p, ws);
  p.passives.push({ id: d.pair, lvl: 1 }); w.recalc(p);
  const ready = w.weaponReady(p, ws);
  w.evolve(p, ws);
  ok(!before && ready && ws.id === d.evo && ws.evo, `${id}: ready only with ${d.pair}, evolves to ${ws.id}`);
}

// 4. evolution payoff: on a dense immortal crowd (500 skeletons, 30 s, slow circle walk, pair passive owned) the evolved form deals >= 1.15x its level-8 base.
const crowd = (id, evo) => {
  const d = ED.WEAPONS[id];
  const w = new ED.World({ seed: 11, stage: 0, players: [{ pid: 'p1', slot: 0, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = () => {};
  const p = w.heroes[0];
  p.weapons.length = 0; const ws = w.addWeapon(p, id); ws.lvl = 8;
  p.passives.push({ id: d.pair, lvl: 1 }); w.recalc(p, true);
  if (evo) w.evolve(p, ws);
  for (let i = 0; i < 500; i++) { const a = i * 2.39996, r = 40 + Math.sqrt(i) * 16; w.spawnFoe('skeleton', p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, { hpMul: 1e5 }); }
  for (let t = 0; t < 30 * 60; t++) {
    const a = t / 60 * 0.5;
    w.input('p1', { mx: Math.cos(a) * 0.5, my: Math.sin(a) * 0.5, ax: p.x + 50, ay: p.y });
    p.offer = null; p.pend = 0; w.paused = false;
    w.update(C.TICK); w.events.length = 0;
  }
  let dmg = 0; for (const k in p.dealt) dmg += p.dealt[k];
  return dmg;
};
for (const id of BASES) {
  const a = crowd(id, false), b = crowd(id, true);
  ok(b >= a * 1.15, `${ED.WEAPONS[id].evo} out-damages ${id} L8 on a dense crowd: ${Math.round(b)} vs ${Math.round(a)} (x${(b / a).toFixed(2)})`);
}

console.log(`check-wpn-b: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
