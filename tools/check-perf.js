// Sim cost check (exit 1 on failure): a solo world held at N live foes (300 / 600 / 900, dense around the hero), 600 hero projectiles (piercing, re-hitting every 0.5 s) and 400 gems,
// all six weapon slots firing. Reports ms per tick (average and worst over 600 ticks after 120 warm-up ticks). Gate (ARCHITECTURE §11): average <= 2.5 ms at 900 foes.
// Also audits the foe grid: foesNear must return every live foe touching the query circle (200 random queries per size).
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
const COUNTS = [300, 600, 900], PROJ = 600, GEMS = 400, WARM = 120, TICKS = 600, GATE = 2.5;
let fails = 0;

function setup(n) {
  const w = new ED.World({ seed: 42, stage: 0, players: [{ pid: 'p1', name: 'P', slot: 0, cls: 'ranger', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of w.sdef.timeline) { row.rate = 0; }
  w.sp.swarmT = w.sp.eliteT = Infinity; w.sdef = Object.assign({}, w.sdef, { bosses: [] });
  const p = w.heroes[0], rng = U.RNG(9), ids = ['bat', 'skeleton', 'slime', 'skelknight', 'bonearcher'];
  for (const id of ['knight', 'pyro', 'necro', 'cleric', 'bell']) { const h = ED.HEROES[id]; w.addWeapon(p, h.sig); }
  for (const ws of p.weapons) ws.lvl = 8;
  const top = () => {
    while (w.foes.length < n) { const a = rng.next() * U.TAU, d = 30 + Math.sqrt(rng.next()) * 520, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; if (!ED.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ids[rng.int(0, ids.length - 1)], x, y, { hpMul: 400 }); }
    while (w.projs.length < PROJ) { const a = rng.next() * U.TAU; w.shoot(p, 'longbow', p.x + Math.cos(a) * rng.range(0, 300), p.y + Math.sin(a) * rng.range(0, 300), rng.next() * U.TAU, null, { look: 'arrow', dmg: 5, speed: 120, pierce: 9999, rehit: 0.5, life: 4 }); }
    let gems = 0; for (const g of w.pickups) if (g.k[0] === 'x') gems++;
    while (gems < GEMS) { const a = rng.next() * U.TAU, d = 120 + rng.next() * 900; w.spawnPickup('xp1', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1); gems++; }
  };
  return { w, p, top };
}

const t0 = Date.now();
const rows = [];
for (const n of COUNTS) {
  const { w, p, top } = setup(n);
  let sum = 0, worst = 0, cnt = 0;
  for (let i = 0; i < WARM + TICKS; i++) {
    top();
    const a = i / 60 * 0.5;
    w.input('p1', { mx: Math.cos(a) * 0.3, my: Math.sin(a) * 0.3, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 });
    const s = process.hrtime.bigint();
    w.update(C.TICK);
    const ms = Number(process.hrtime.bigint() - s) / 1e6;
    w.events.length = 0;
    if (i >= WARM) { sum += ms; cnt++; if (ms > worst) worst = ms; }
  }
  // grid audit
  let miss = 0;
  w.foeGrid();
  const rng = U.RNG(n), out = [];
  for (let q = 0; q < 200; q++) {
    const x = p.x + rng.range(-600, 600), y = p.y + rng.range(-600, 600), r = rng.range(10, 300);
    const got = new Set(w.foesNear(x, y, r, out));
    for (const e of w.foes) if (!e.dead && U.dist(x, y, e.x, e.y) <= r + e.r && !got.has(e)) miss++;
  }
  // overlap after separation (pairs closer than half their radii)
  let tight = 0;
  for (let i = 0; i < w.foes.length; i++) for (let j = i + 1; j < w.foes.length; j++) { const a = w.foes[i], b = w.foes[j]; if (U.dist2(a.x, a.y, b.x, b.y) < ((a.r + b.r) * 0.5) ** 2) tight++; }
  const avg = sum / cnt;
  rows.push({ n, avg, worst, foes: w.foes.length, projs: w.projs.length, pickups: w.pickups.length, miss, tight });
  console.log(`foes ${String(n).padStart(4)}: ${avg.toFixed(3)} ms/tick avg, worst ${worst.toFixed(2)} ms  (live ${w.foes.length} foes, ${w.projs.length} projectiles, ${w.pickups.length} pickups; grid misses ${miss}; tight pairs ${tight})`);
  if (miss) { fails++; console.log('FAIL foe grid missed ' + miss + ' foes'); }
}
const last = rows[rows.length - 1];
if (last.avg > GATE) { fails++; console.log(`FAIL ${last.n} foes: ${last.avg.toFixed(3)} ms/tick > ${GATE} ms`); }
console.log(`check-perf: ${fails ? fails + ' failure(s)' : 'pass'} (gate ${GATE} ms/tick at ${last.n} foes) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
