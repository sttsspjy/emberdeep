// Sim cost check (exit 1 on failure). Usage: node tools/check-perf.js [--split] [--ticks=600]
// A solo world held at N live foes (300 / 600 / 900, dense around the hero), 600 hero projectiles (piercing, re-hitting every 0.5 s) and 400 gems, all six weapon slots firing
// at max level. Reports ms per tick (average, p95 and the worst tick with its time) over --ticks (600) ticks after 120 warm-up ticks.
// Gate (ARCHITECTURE §11): average <= 2.5 ms per tick at 900 foes; every row must actually hold its foe / projectile / gem counts.
// --split: one more 900-foe pass with each World tick phase timed (wrapped prototype methods; adds overhead, so the gate pass stays unwrapped).
// Also audits the foe grid: foesNear must return every live foe touching the query circle (200 random queries per size).
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST, W = ED.World.prototype;
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? Number(a.split('=')[1]) : d; };
const COUNTS = [300, 600, 900], PROJ = 600, GEMS = 400, WARM = 120, TICKS = arg('ticks', 600), GATE = 2.5, SPLIT = process.argv.includes('--split');
const PHASES = ['applyPicks', 'updateHeroes', 'updateSpawner', 'updateFoes', 'separate', 'foeGrid', 'updateWeapons', 'updateSkills', 'updateProjs', 'updateZones', 'updatePickups', 'updateProgress', 'updateBosses', 'flushHits', 'compact', 'runState'];
let fails = 0;

function setup(n) {
  const w = new ED.World({ seed: 42, stage: 0, players: [{ pid: 'p1', name: 'P', slot: 0, cls: 'ranger', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of w.sdef.timeline) { row.rate = 0; }
  w.sp.swarmT = w.sp.eliteT = Infinity; w.sdef = Object.assign({}, w.sdef, { bosses: [] });
  const p = w.heroes[0], rng = U.RNG(9), ids = ['bat', 'skeleton', 'slime', 'skelknight', 'bonearcher', 'bulwark', 'bonecaller', 'stalker', 'mirecrab', 'colossus'].filter(id => ED.FOES[id]);
  for (const ws of p.weapons) w.setRanks(p, ws, 9, true);
  w.recalc(p, true);
  const top = () => {
    while (w.foes.length < n) { const a = rng.next() * U.TAU, d = 30 + Math.sqrt(rng.next()) * 520, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; if (!ED.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ids[rng.int(0, ids.length - 1)], x, y, { hpMul: 400 }); }
    while (w.projs.length < PROJ) { const a = rng.next() * U.TAU; w.shoot(p, 'longbow', p.x + Math.cos(a) * rng.range(0, 300), p.y + Math.sin(a) * rng.range(0, 170), rng.next() * U.TAU, null, { look: 'arrow', dmg: 5, speed: 120, pierce: 9999, rehit: 0.5, life: 4 }); }
    let gems = 0; for (const g of w.pickups) if (g.k[0] === 'x') gems++;
    while (gems < GEMS) { const a = rng.next() * U.TAU, d = 120 + rng.next() * 900; w.spawnPickup('xp1', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1); gems++; }
  };
  return { w, p, top };
}
// Runs WARM + ticks ticks at n foes; returns per-tick ms samples (after warm-up) and the minimum live counts seen right before a measured tick.
function measure(n, ticks) {
  const { w, p, top } = setup(n), ms = [], low = { foes: Infinity, projs: Infinity, gems: Infinity };
  for (let i = 0; i < WARM + ticks; i++) {
    top();
    if (i >= WARM) {
      let gems = 0; for (const g of w.pickups) if (g.k[0] === 'x') gems++;
      low.foes = Math.min(low.foes, w.foes.length); low.projs = Math.min(low.projs, w.projs.length); low.gems = Math.min(low.gems, gems);
    }
    const a = i / 60 * 0.5;
    w.input('p1', { mx: Math.cos(a) * 0.3, my: Math.sin(a) * 0.3, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 });
    const s = process.hrtime.bigint();
    w.update(C.TICK);
    const t = Number(process.hrtime.bigint() - s) / 1e6;
    w.events.length = 0;
    if (i >= WARM) ms.push(t);
  }
  return { w, p, ms, low };
}

const t0 = Date.now();
const rows = [];
for (const n of COUNTS) {
  const { w, p, ms, low } = measure(n, TICKS);
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
  const avg = ms.reduce((a, b) => a + b, 0) / ms.length, sorted = ms.slice().sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)];
  let wi = 0; for (let i = 1; i < ms.length; i++) if (ms[i] > ms[wi]) wi = i;
  rows.push({ n, avg, p95, worst: ms[wi], miss, tight });
  console.log(`foes ${String(n).padStart(4)}: ${avg.toFixed(3)} ms/tick avg, p95 ${p95.toFixed(2)} ms, worst ${ms[wi].toFixed(2)} ms (tick ${WARM + wi})  (held >= ${low.foes} foes, ${low.projs} projectiles, ${low.gems} gems; grid misses ${miss}; tight pairs ${tight})`);
  if (miss) { fails++; console.log('FAIL foe grid missed ' + miss + ' foes'); }
  if (low.foes < n || low.projs < PROJ || low.gems < GEMS) { fails++; console.log(`FAIL ${n}-foe row did not hold its load (foes ${low.foes}/${n}, projectiles ${low.projs}/${PROJ}, gems ${low.gems}/${GEMS})`); }
}
const last = rows[rows.length - 1];
if (last.avg > GATE) { fails++; console.log(`FAIL ${last.n} foes: ${last.avg.toFixed(3)} ms/tick > ${GATE} ms`); }

if (SPLIT) {
  const acc = {}, orig = {};
  for (const k of PHASES) {
    if (typeof W[k] !== 'function') continue;
    const f = orig[k] = W[k]; acc[k] = 0;
    W[k] = function () { const s = process.hrtime.bigint(); try { return f.apply(this, arguments); } finally { acc[k] += Number(process.hrtime.bigint() - s) / 1e6; } };
  }
  const n = COUNTS[COUNTS.length - 1], ticks = Math.min(TICKS, 300), r = measure(n, ticks);
  for (const k in orig) W[k] = orig[k];
  const tot = r.ms.reduce((a, b) => a + b, 0) / ticks, parts = Object.keys(acc).map(k => [k, acc[k] / (WARM + ticks)]).sort((a, b) => b[1] - a[1]);
  console.log(`split at ${n} foes (${ticks} ticks, wrapped: ${tot.toFixed(3)} ms/tick): ` + parts.filter(x => x[1] >= 0.005).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', '));
}
console.log(`check-perf: ${fails ? fails + ' failure(s)' : 'pass'} (gate ${GATE} ms/tick avg at ${last.n} foes) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
