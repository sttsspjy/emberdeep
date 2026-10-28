// Headless check of heroes Cleric, Shade and Bell (exit 1 on failure). Usage: node tools/check-heroes-b.js
// 1. Signature weapon at 0..9 path ranks (path 0 first) and its path-0 Form refined twice: 10 s each in a foe ring, no exceptions, damage > 0 (prints dps per rank count).
// 2. Q at every skill level 1..4: cast on cooldown at the nearest foe, damage > 0 (prints damage per cast).
// 3. Mechanics: Sanctuary heals an ally, Shadow Step blinks and recasts, Great Peal stuns the screen and pulls gems, Toll / Cathedral bell bodies.
// 4. 60 s solo run per hero with level-ups and Q spam: no exceptions, same digest twice. 5. Crowd cost at 900 foes (informational).
// 6. No-target fire: every signature (no ranks) and its Form on its own hero, standing still facing east with no foe alive, breaks a brazier 60 px ahead
//    within the first fire (0.4 s) + its cooldown + 0.9 s travel; a hero projectile crossing a brazier breaks it and keeps its pierce and its flight.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const HEROES = ['cleric', 'shade', 'bell'];
const player = (cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } });

// World with the spawner silenced: foes come only from ring(); god cheat keeps the hero alive.
function world(clsList, seed) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: clsList.map(player), cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  return w;
}
// Spawns n foes of kind k (HP x hpMul) evenly on a ring of radius r around (x, y).
const HP = { hpMul: 1 };
function ring(w, x, y, n, r, k, hpMul) { HP.hpMul = hpMul || 1; for (let i = 0; i < n; i++) { const a = i / n * U.TAU; w.spawnFoe(k || 'skeleton', x + Math.cos(a) * r, y + Math.sin(a) * r, HP); } }
const step = (w, s) => { for (let i = 0; i < Math.round(s * 60); i++) { w.update(C.TICK); w.events.length = 0; } };
// Runs s seconds: keeps >= keep foes (180 HP skeletons) alive near hero p (rings 90..200 px), walks a slow circle, optional per-tick fn. Returns error or null.
function arena(w, p, s, keep, fn) {
  try {
    for (let tick = 0; tick < s * 60; tick++) {
      if (tick % 20 === 0) { let near = 0; for (const e of w.foes) if (!e.dead && U.dist2(p.x, p.y, e.x, e.y) < 260 * 260) near++; if (near < keep) ring(w, p.x, p.y, 12, 90 + (tick % 7) * 16, 'skeleton', 15); }
      const a = tick / 60 * 0.6;
      w.input(p.pid, { mx: Math.cos(a) * 0.4, my: Math.sin(a) * 0.4, ax: p.x + 60, ay: p.y });
      if (fn) fn(tick);
      w.update(C.TICK);
      w.events.length = 0;
    }
  } catch (e) { return e; }
  return null;
}

// 1. path ranks + Form
for (const cls of HEROES) {
  const h = ED.HEROES[cls], def = ED.WEAPONS[h.sig], form = ED.WEAPONS[def.paths[0].form];
  ok(def.paths.length === 3 && def.paths.every(pa => pa.ranks.length === 3 && pa.ranks.every(l => l.txt.length <= 40)), `${h.sig}: 3 paths x 3 ranks, card lines <= 40 chars`);
  ok(!!form && form.form && form.from === h.sig && form.refine.length === 2, `${h.sig}: path 0 unlocks the Form ${form && form.id} (2 refines)`);
  const dps = [];
  for (let R = 0; R <= 9; R++) {
    const w = world([cls], 10 + R), p = w.heroes[0];
    w.setRanks(p, p.weapons[0], R, false);
    const err = arena(w, p, 10, 30);
    const d = p.dealt[h.sig] || 0; dps.push(Math.round(d / 10));
    ok(!err && d > 0 && p.weapons[0].lvl === 1 + R, `${h.sig} ranks ${p.weapons[0].pr.join('')}: 10 s, dealt ${Math.round(d)}` + (err ? ': ' + err.stack : ''));
  }
  console.log(`     ${h.sig} dps by rank count 0..9: ${dps.join(' ')}`);
  const w = world([cls], 77), p = w.heroes[0];
  w.setRanks(p, p.weapons[0], 3, false);
  ok(w.formsReady(p, p.weapons[0]).some(f => f.id === form.id), `${h.sig} path 0 at rank 3: ${form.id} is ready`);
  w.setRanks(p, p.weapons[0], 6, true);
  const err = arena(w, p, 20, 40);
  const d = p.dealt[form.id] || 0;
  ok(!err && p.weapons[0].id === form.id && p.weapons[0].fl === 2 && d > 0, `${form.id} (ranks 333, refine 2): 20 s, dps ${Math.round(d / 20)}` + (err ? ': ' + err.stack : ''));
}

// 2. skills at every level
for (const cls of HEROES) {
  const h = ED.HEROES[cls];
  ok(h.skills.length === 1, `${cls}: one skill (${h.skills[0]})`);
  for (let si = 0; si < 1; si++) {
    const id = h.skills[si], def = ED.SKILLS[id], line = [];
    ok(def.levels.length === 3 && def.levels.every(l => l.txt.length <= 40), `${id}: 3 levels, card lines <= 40 chars`);
    for (let L = 1; L <= 4; L++) {
      const w = world([cls], 30 + L), p = w.heroes[0];
      p.skills[si].lvl = L; p.weapons.length = 0; // skill damage only
      let casts = 0;
      const err = arena(w, p, 20, 30, () => {
        const t = w.nearestFoe(p.x, p.y, 400);
        if (p.skills[si].cd <= 0) { casts++; w.input(p.pid, { q: true, ax: t ? t.x : p.x + 50, ay: t ? t.y : p.y }); }
      });
      const d = p.dealt[id] || 0; line.push(Math.round(d / Math.max(1, casts)));
      ok(!err && d > 0 && casts > 0, `${id} L${L}: ${casts} casts, dealt ${Math.round(d)}` + (err ? ': ' + err.stack : ''));
    }
    console.log(`     ${id} damage per cast by level: ${line.join(' ')}`);
  }
}

// 3. mechanics
const cast = (w, p, slot, x, y) => { w.input(p.pid, { q: true, ax: x, ay: y }); w.update(C.TICK); w.events.length = 0; };
{ // Sanctuary heals an ally inside, not one outside
  const w = world(['cleric', 'knight', 'ranger']), [c, k, r] = w.heroes;
  k.x = c.x + 100; k.y = c.y; r.x = c.x - 300; r.y = c.y; k.hp = 40; r.hp = 40;
  cast(w, c, 0, k.x, k.y); step(w, 2);
  ok(k.hp >= 48 && r.hp === 40, `sanctuary heals the ally inside (${k.hp.toFixed(0)}) and not the one outside (${r.hp.toFixed(0)})`);
}
{ // E is unbound: an E press casts nothing
  const w = world(['cleric']), p = w.heroes[0], sk = p.skills[0];
  w.input(p.pid, { e: true, ax: p.x + 50, ay: p.y }); w.update(C.TICK);
  ok(sk.cd === 0 && !w.events.some(e => e.t === 'skill'), 'an E press casts nothing');
  w.events.length = 0;
}
{ // Shadow Step: blink + recast window
  const w = world(['shade']), p = w.heroes[0], sk = p.skills[0];
  const x0 = p.x, f = w.spawnFoe('skelknight', p.x + 80, p.y);
  cast(w, p, 0, p.x + 160, p.y);
  ok(p.x - x0 > 120 && f.hp < f.maxHp, `shadow step blinks ${Math.round(p.x - x0)} px and cuts the path`);
  step(w, 1);
  ok(f.hp < f.maxHp && sk.cd > 0, 'afterimage, cooldown running at L1');
  const w2 = world(['shade']), p2 = w2.heroes[0], sk2 = p2.skills[0]; sk2.lvl = 4;
  cast(w2, p2, 0, p2.x + 160, p2.y); w2.update(C.TICK);
  ok(sk2.cd === 0, 'L4: recast ready right after the first blink');
  const x1 = p2.x; cast(w2, p2, 0, p2.x + 160, p2.y);
  ok(p2.x - x1 > 150 && sk2.cd > 6, `L4: recast blinks again, full cooldown after (${sk2.cd.toFixed(1)} s)`);
  const w3 = world(['shade']), p3 = w3.heroes[0], sk3 = p3.skills[0]; sk3.lvl = 4;
  cast(w3, p3, 0, p3.x + 160, p3.y); step(w3, 3);
  ok(sk3.cd > 3 && sk3.cd < 5, `L4: unused recast window resumes the cooldown (${sk3.cd.toFixed(1)} s)`);
}

{ // Great Peal: stuns the screen, pulls gems at L4
  const w = world(['bell']), p = w.heroes[0]; p.weapons.length = 0; p.skills[0].lvl = 4;
  ring(w, p.x, p.y, 40, 150, 'skeleton', 50); ring(w, p.x, p.y, 40, 300, 'skeleton', 50);
  w.spawnPickup('xp5', p.x + 250, p.y, 5);
  cast(w, p, 0, p.x, p.y); step(w, 0.55);
  let n = 0, s = 0; for (const e of w.foes) if (!e.dead && U.dist(p.x, p.y, e.x, e.y) < 330) { n++; if (e.stunT > 0) s++; }
  const g = w.pickups.find(x => x.k === 'xp5');
  ok(n > 0 && s === n, `great peal stuns every foe within 330 px (${s}/${n})`);
  ok(!g || g.pull === p.pid, 'great peal L4 pulls gems');
}
{ // Toll / Cathedral bell bodies
  const w = world(['bell']), p = w.heroes[0], ws = p.weapons[0];
  step(w, 0.2);
  ok(w.zones.filter(z => z.k === 'tollb').length === 1, 'toll: one bell orbits');
  w.setRanks(p, ws, 1, false); step(w, 0.2);
  ok(w.zones.filter(z => z.k === 'tollb').length === 2, 'toll Carillon rank 1: two bells orbit');
  w.setRanks(p, ws, 2, true); step(w, 0.5);
  const nb = w.weaponS(p, 0).n | 0;
  ok(ws.id === 'cathedral' && nb >= 3 && w.zones.filter(z => z.k === 'cathb').length === nb && !w.zones.some(z => z.k === 'tollb'), `cathedral: ${nb} bells (3 + Carillon), toll bells gone`);
}

// 4. 60 s runs with level-ups and Q / E spam, determinism
function full(cls, seed) {
  const w = new ED.World({ seed, stage: 0, players: [player(cls, 0)], cheats: { god: true } });
  let digest = 0, err = null;
  try {
    for (let tick = 0; tick < 3600; tick++) {
      const p = w.heroes[0], a = tick / 60 * 0.7;
      w.input(p.pid, { mx: Math.cos(a), my: Math.sin(a), ax: p.x + Math.cos(a * 3) * 120, ay: p.y + Math.sin(a * 3) * 120, q: tick % 30 === 0, dash: tick % 300 === 90, pick: p.offer ? 1 : 0 });
      w.update(C.TICK); w.events.length = 0;
      if (tick % 60 === 0) { let s = w.kills + '|' + w.level + '|' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + '|' + w.foes.length + '|' + w.projs.length + '|' + w.zones.length; digest = (Math.imul(digest, 31) + U.hashStr(s)) >>> 0; }
    }
  } catch (e) { err = e; }
  return { w, digest, err };
}
for (const cls of HEROES) {
  const a = full(cls, 41), b = full(cls, 41), p = a.w.heroes[0];
  ok(!a.err && !b.err, `${cls}: 60 s run, kills ${a.w.kills}, level ${a.w.level}, weapon ${p.weapons.map(x => x.id + ' ' + x.pr.join('')).join(' ')}` + (a.err ? ': ' + a.err.stack : ''));
  ok(a.digest === b.digest, `${cls}: same digest twice (${a.digest})`);
}

// 5. crowd cost: maxed Form + skill L4 cast on cooldown inside a held 900-foe crowd, 10 s. Informational (shared CPU); fails only above 8 ms/tick average.
for (const cls of HEROES) {
  const w = world([cls], 9), p = w.heroes[0];
  p.passives.push({ id: 'reach', lvl: 5 }, { id: 'multishot', lvl: 5 }, { id: 'duration', lvl: 5 }); w.setRanks(p, p.weapons[0], 9, true);
  for (const sk of p.skills) sk.lvl = 4;
  const rng = U.RNG(3);
  let tot = 0, worst = 0, n = 0, err = null;
  try {
    for (let tick = 0; tick < 600; tick++) {
      for (let k = 0; w.foes.length < 900 && k < 300; k++) { const a = rng.next() * U.TAU, d = 60 + rng.next() * 380; w.spawnFoe('skeleton', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, HP); }
      HP.hpMul = 40;
      const t = w.nearestFoe(p.x, p.y, 300), a = tick / 60;
      w.input(p.pid, { mx: Math.cos(a) * 0.5, my: Math.sin(a) * 0.5, ax: t ? t.x : p.x + 80, ay: t ? t.y : p.y, q: p.skills[0].cd <= 0 });
      const t0 = process.hrtime.bigint();
      w.update(C.TICK);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      w.events.length = 0;
      if (tick >= 60) { tot += ms; n++; if (ms > worst) worst = ms; }
    }
  } catch (e) { err = e; }
  ok(!err && tot / n < 8, `${cls} crowd 900 (${p.weapons[0].id}, skills L4): ${(tot / n).toFixed(2)} ms/tick avg, worst ${worst.toFixed(1)} ms, zones ${w.zones.length}, projs ${w.projs.length}` + (err ? ': ' + err.stack : ''));
}

// 6. no-target fire, braziers
{
  // World with no foes, the hero at rest facing east (mdir 0), brazier 0 moved 60 px ahead (before the first tick builds the brazier buckets).
  const setup = (cls, wid) => {
    const w = world([cls], 11), p = w.heroes[0], b = w.arena.braziers[0];
    w.foes.length = 0; p.mdir = 0; p.weapons.length = 0; w.addWeapon(p, wid);
    b.x = Math.round(p.x + 60); b.y = Math.round(p.y); b.broken = false;
    return { w, p, b };
  };
  for (const cls of ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell']) {
    const sig = ED.HEROES[cls].sig;
    for (const wid of [sig, ED.WEAPONS[sig].paths[0].form]) {
      const { w, p, b } = setup(cls, wid), lim = 0.4 + w.weaponS(p, 0).cd + 0.9;
      let t = 0, shots = 0, err = null;
      try {
        for (; t < lim && !b.broken; t += C.TICK) {
          w.update(C.TICK);
          for (const ev of w.events) if (ev.t === 'shoot') shots++;
          w.events.length = 0;
          if (w.foes.some(e => !e.dead)) throw new Error('a foe spawned');
        }
      } catch (e) { err = e; }
      ok(!err && shots > 0 && b.broken, `${wid}: fires with no foe (${shots} shot${shots === 1 ? '' : 's'}) and breaks a brazier 60 px ahead` +
        (b.broken ? ` in ${t.toFixed(2)} s` : ` (not within ${lim.toFixed(2)} s)`) + (err ? ': ' + err.message : ''));
    }
  }
  const { w, p, b } = setup('ranger', 'longbow');
  p.weapons.length = 0;
  const pr = w.shoot(p, 'longbow', b.x - 40, b.y, 0, null, { look: 'arrow', dmg: 5, speed: 300, pierce: 1, life: 1 });
  for (let i = 0; i < 18; i++) { w.update(C.TICK); w.events.length = 0; }
  ok(b.broken && !pr.dead && pr.pierce === 1 && pr.x > b.x + 20, `hero projectile breaks a brazier without spending pierce (broken ${b.broken}, alive ${!pr.dead}, pierce ${pr.pierce}, x +${Math.round(pr.x - b.x)})`);
  const b2 = w.arena.braziers[1], e = w.foeShoot({ id: 1, x: b2.x - 40, y: b2.y + 4, r: 8 }, 0, 300, 'bolt', 1, 4);
  for (let i = 0; i < 18; i++) { w.update(C.TICK); w.events.length = 0; }
  ok(!b2.broken && e, 'foe projectiles never break braziers');
}

console.log(`check-heroes-b: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
