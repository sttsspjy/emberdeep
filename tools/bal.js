// Usage: node tools/bal.js [--cells=a,b] [--full] [--save=file.json] [--pair=file.json] [--jobs=N] [--speed=X] [--nice] [--list] [--flag[=value] ...]
// Fixed quick balance suite: the GAME-DESIGN section 10 cells (fresh random, fresh smart, half-upgraded, fully upgraded, Pact 5, two and three heroes; six heroes in rotation, skill 0.75, --pick=smart unless noted) plus the fresh legacy-pick cell
// run in one worker pool (tools/simpool.js), one line per cell: wins % +-se, depth +-se, mean win time, target bands, PASS/FAIL (a band is met when the estimate lies inside it; a cell with no band for a figure ignores it). Exit code is always 0 (a report).
// Every cell moves with the veteran bot (--vet, the human proxy; --vet=0 turns it off). Bands are the v4 difficulty contract: fresh random <= 1%, fresh smart 10-20%, a small Hearth (max at most half the knowledge gap above fresh smart),
// party rows solo-first (bot check only). The Hearth rule is checked on the fresh and max cells: (max - fresh smart) <= 1/2 x (fresh smart - fresh random), in win points.
// The default sizes keep the suite near 2 minutes; --full runs the section 10 sign-off sizes (384 runs per solo cell, 192 for parties) in under 15 minutes. The estimate is printed first: sum(runs x cost) / speed, where cost is the measured
// seconds of one run in one process and speed is the pool throughput (8 workers on the 8-core, 16-thread dev machine finish about 5 runs per single-process run time; --speed=X overrides it).
// --cells=a,b runs only those cells (--list shows them). --save=file.json writes one row per run (label = cell id). --pair=file.json prints, per cell, the mean win and depth difference to such a saved baseline over the same seeds (plus sim.js pairReport).
// Every other --flag is forwarded to every cell (e.g. --from=4, --explore=0.4, --seed0=7000, --pick=random, --patch=file.js) and overrides the cell's own flag of that name. With --from=N bands describe whole runs, so verdicts print "-".
// Cell lines for the half-upgraded and fully upgraded cells add the win rate per hero (small samples: about 20 runs per hero at the default size).
const os = require('os');
const fs = require('fs');
const sim = require('./sim.js');
const pool = require('./simpool.js');

// id; title; heroes; meta; pact; flags; runs (default / --full); cost (seconds of one run in one process); win and depth bands as [lo, hi] (win in 0..1); byHero adds the per-hero line.
const CELLS = [
  { id: 'rand', title: 'fresh, random picks', n: 1, meta: 'none', pact: 0, flags: { pick: 'random', vet: '1' }, runs: [120, 384], cost: 0.5, win: [0, 0.01] },
  { id: 'smart', title: 'fresh, smart picks', n: 1, meta: 'none', pact: 0, flags: { pick: 'smart', vet: '1' }, runs: [120, 384], cost: 0.5, win: [0.10, 0.20] },
  { id: 'legacy', title: 'fresh, v3 smart picks', n: 1, meta: 'none', pact: 0, flags: { pick: 'legacy' }, runs: [60, 192], cost: 0.45 },
  { id: 'mid', title: 'half-upgraded', n: 1, meta: 'mid', pact: 0, flags: { pick: 'smart', vet: '1' }, runs: [120, 384], cost: 0.6, win: [0.12, 0.24], byHero: true },
  { id: 'max', title: 'fully upgraded', n: 1, meta: 'max', pact: 0, flags: { pick: 'smart', vet: '1' }, runs: [120, 384], cost: 0.55, win: [0.15, 0.27], byHero: true },
  { id: 'pact5', title: 'fully upgraded, Pact 5', n: 1, meta: 'max', pact: 5, flags: { pick: 'smart', vet: '1' }, runs: [120, 384], cost: 0.6, win: [0.05, 0.15] },
  { id: 'duo', title: 'two heroes, half-upgraded', n: 2, meta: 'mid', pact: 0, flags: { pick: 'smart', vet: '1' }, runs: [60, 192], cost: 0.9, win: [0.10, 0.35] },
  { id: 'trio', title: 'three heroes, half-upgraded', n: 3, meta: 'mid', pact: 0, flags: { pick: 'smart', vet: '1' }, runs: [60, 192], cost: 1.65, win: [0.10, 0.35] },
];
const SPEED = 5, OWN = new Set(['cells', 'full', 'save', 'pair', 'jobs', 'speed', 'nice', 'list']);
const U = sim.ED.U;

const { flags, args } = pool.parseArgs(process.argv.slice(2));
const extra = {};
for (const k in flags) if (!OWN.has(k)) extra[k] = flags[k];
const want = flags.cells ? flags.cells.split(',') : CELLS.map(c => c.id);
const bad = want.filter(id => !CELLS.some(c => c.id === id));
if (bad.length) { console.log('unknown cell ' + bad.join(', ') + '; cells: ' + CELLS.map(c => c.id).join(', ')); process.exit(0); }
const cells = CELLS.filter(c => want.includes(c.id)), full = !!flags.full;
const runsOf = (c) => c.runs[full ? 1 : 0];
const workers = Math.max(1, +(flags.jobs || Math.min(os.cpus().length - 1, 8))); // simpool's default of cores - 1 gains nothing over 6 to 8 on the dev machine
const speed = +(flags.speed || Math.min(workers, SPEED));
const estimate = Math.round(cells.reduce((s, c) => s + runsOf(c) * c.cost, 0) / speed + 2);
const forwarded = Object.keys(extra).map(k => '--' + k + (extra[k] === '1' ? '' : '=' + extra[k])).join(' ');

if (flags.list) {
  for (const c of cells) console.log(`${c.id.padEnd(6)} ${c.title.padEnd(30)} heroes ${c.n} meta ${c.meta} pact ${c.pact} runs ${c.runs[0]} / ${c.runs[1]} (${c.cost}s each) win ${c.win ? band(c.win, 100, '%') : '-'} depth ${c.depth ? band(c.depth, 1, '') : '-'}`);
  console.log(`estimate ${estimate} s (${full ? 'full' : 'default'} sizes, ${workers} workers, speed ${speed})`);
  process.exit(0);
}

function band(b, k, unit) { return b[0] === 0 ? `<=${b[1] * k}${unit}` : `${b[0] * k}-${b[1] * k}${unit}`; }
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const se = (a) => { if (a.length < 2) return NaN; const m = avg(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1) / a.length); };
const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const inBand = (v, b) => !b || (v >= b[0] - 1e-9 && v <= b[1] + 1e-9);

// jobs per cell (simpool's job builder), longest cells first so the pool's tail is short; results come back by job index
const plan = [];
for (const c of cells) {
  const cf = Object.assign({}, c.flags, extra);
  const j = pool.makeJobs([String(c.n), String(runsOf(c)), '0.75', c.meta, '-', String(c.pact)], cf);
  for (const job of j.jobs) { job.label = c.id; plan.push({ c, job }); }
}
plan.sort((a, b) => b.c.cost - a.c.cost);
const from = +(extra.from || 0);
console.log(`bal ${full ? 'full' : 'quick'}: ${cells.map(c => c.id).join(',')} | ${plan.length} runs | estimate ~${estimate} s (${workers} workers, speed ${f(speed, 1)})${forwarded ? ' | forwarded ' + forwarded : ''}${from > 1 ? ` | from stratum ${from}: wins and depth cover strata >= ${from}, bands do not apply` : ''}`);

const t0 = Date.now();
pool.runPool(plan.map(p => p.job), { jobs: workers, patch: flags.patch }).then((res) => {
  const by = {}, rows = [];
  plan.forEach((p, i) => { (by[p.c.id] = by[p.c.id] || []).push(res[i]); rows.push(sim.rowOf(res[i], p.c.id, p.job.seed)); });
  rows.sort((a, b) => cells.findIndex(c => c.id === a.label) - cells.findIndex(c => c.id === b.label) || a.seed - b.seed);
  if (flags.save) fs.writeFileSync(flags.save, JSON.stringify(rows));
  let pass = 0, judged = 0;
  for (const c of cells) {
    const rs = by[c.id], n = rs.length, wins = rs.filter(r => r.victory), p = wins.length / n;
    const depth = rs.map(r => r.stratum), wt = wins.length ? U.fmtTime(avg(wins.map(r => r.time))) : '-';
    const miss = [];
    if (!inBand(p, c.win)) miss.push('win');
    if (!inBand(avg(depth), c.depth)) miss.push('depth');
    const banded = from <= 1 && (c.win || c.depth), verdict = !banded ? '-' : miss.length ? 'FAIL(' + miss.join(',') + ')' : 'PASS';
    if (banded) { judged++; if (!miss.length) pass++; }
    console.log(`${c.id.padEnd(6)} n=${String(n).padEnd(4)} win ${f(100 * p, 1).padStart(5)}% +-${f(100 * Math.sqrt(p * (1 - p) / n), 1)}  depth ${f(avg(depth), 2)} +-${f(se(depth), 2)}  win time ${wt.padStart(5)}  target win ${c.win ? band(c.win, 100, '%') : '-'} depth ${c.depth ? band(c.depth, 1, '') : '-'}  ${verdict}`);
    if (c.byHero) {
      const heroes = [...new Set(rs.map(r => r.cls))];
      console.log('       by hero: ' + heroes.map(h => { const hr = rs.filter(r => r.cls === h); return `${h} ${Math.round(100 * hr.filter(r => r.victory).length / hr.length)}%`; }).join(' ') + ` (${Math.round(n / heroes.length)} runs each)`);
    }
  }
  const winRate = (id) => (by[id] ? by[id].filter(r => r.victory).length / by[id].length : NaN);
  if (from <= 1 && by.rand && by.smart && by.max) { // difficulty contract: the Hearth gap (max - fresh, smart picks) is at most half the knowledge gap (smart - random, fresh)
    const sdiff = (a, b) => 100 * Math.sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n), P = (id) => ({ p: winRate(id), n: by[id].length });
    const know = 100 * (winRate('smart') - winRate('rand')), hearth = 100 * (winRate('max') - winRate('smart')), ok = hearth <= know / 2;
    judged++; if (ok) pass++;
    console.log(`gaps (win points): knowledge (smart - random, fresh) ${know >= 0 ? '+' : ''}${f(know, 1)} +-${f(sdiff(P('smart'), P('rand')), 1)} | Hearth (max - fresh, smart) ${hearth >= 0 ? '+' : ''}${f(hearth, 1)} +-${f(sdiff(P('max'), P('smart')), 1)} | Hearth <= 1/2 knowledge: ${ok ? 'PASS' : 'FAIL'}`);
  }
  console.log(`${judged ? pass + '/' + judged + ' PASS' : 'no verdicts'} in ${((Date.now() - t0) / 1000).toFixed(0)} s (estimated ${estimate} s)`);
  if (flags.pair) {
    const base = JSON.parse(fs.readFileSync(flags.pair, 'utf8')), key = (r) => r.label + '|' + r.seed + '|' + r.cls, bm = new Map(base.map(r => [key(r), r]));
    const d = (a, g) => `${a.length ? (avg(a) >= 0 ? '+' : '') + f(avg(a), g) : '-'}${a.length > 1 ? ' +-' + f(se(a), g) : ''}`;
    for (const c of cells) {
      const pairs = rows.filter(r => r.label === c.id && bm.has(key(r))).map(r => [r, bm.get(key(r))]);
      console.log(`paired ${c.id.padEnd(6)} ${pairs.length} runs matched: win ${d(pairs.map(([a, b]) => 100 * (a.win - b.win)), 1)} points, depth ${d(pairs.map(([a, b]) => a.depth - b.depth), 2)}`);
    }
    console.log(sim.pairReport(rows, base));
  }
}, (e) => { console.error(e.message); });
