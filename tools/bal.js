// Usage: node tools/bal.js [--cells=a,b] [--full] [--runs=N] [--power] [--save=file.json] [--pair=file.json] [--jobs=N] [--speed=X] [--nice] [--list] [--flag[=value] ...]
// Fixed quick balance suite: the GAME-DESIGN section 10 cells (fresh random, fresh smart, half-upgraded, fully upgraded, fully upgraded at Pacts 1-5, two and three heroes fully upgraded at Pact 5; every hero in rotation,
// skill 0.75, --pick=smart unless noted) run in one worker pool (tools/simpool.js), one line per cell: wins % +-se, depth +-se, mean win time, target bands, PASS/FAIL (a band is met when the estimate lies inside it;
// a cell with no band for a figure ignores it). Exit code is always 0 (a report). Every cell moves with the veteran bot (--vet, the human proxy; --vet=0 turns it off).
// Bands are the v5 difficulty contract: fresh random <= 1%, half-upgraded 20%, fully upgraded 40%, gentle Pacts 1-3 (35, 31, 27%) and steep Pacts 4-5 (18, 10%); two to four heroes at Pact 5 20% (bots; a human party does better).
// Fresh smart has no band; the order check wants fresh random <= fresh smart <= half-upgraded, and the Pact ladder line prints max and Pacts 1-5 with their monotonic read.
// Optional cells (opt: legacy picks, the v4 half-upgraded duo and trio, four heroes at Pact 5) run only when --cells names them. The default sizes keep the suite near 3 minutes; --full runs the section 10 sign-off sizes
// (384 runs per fresh, mid, max and Pact 5 cell, 192 for Pacts 1-4 and parties). The estimate is printed first: sum(runs x cost) / speed, where cost is the measured seconds of one run in one process and speed is the pool
// throughput (8 workers on the 8-core, 16-thread dev machine finish about 4 runs per single-process run time; --speed=X overrides it).
// --cells=a,b runs only those cells (--list shows every cell, optional ones included). --save=file.json writes one row per run (label = cell id). --pair=file.json prints, per cell, the mean win and depth difference to such a saved baseline over the same seeds (plus sim.js pairReport).
// Every other --flag is forwarded to every cell (e.g. --from=4, --explore=0.4, --seed0=7000, --pick=random, --patch=file.js) and overrides the cell's own flag of that name. With --from=N bands describe whole runs, so verdicts print "-".
// Cell lines for the half-upgraded and fully upgraded cells add the win rate per hero (small samples: about 20 runs per hero at the default size).
// --runs=N sets every cell to N runs. --power adds, under each cell line, the boss-arrival read of every stratum (tools/sim.js: power = model damage x effective health, geometric mean +-se; team level; picks at the last boss reached),
// and after the cells the power ratios smart/rand (knowledge gap), max/smart (Hearth gap) and max/mid (upper Hearth) per stratum: the mean of the per-seed ln ratios over the seeds both cells ran (the same seed is the same hero and floors), +-se.
const os = require('os');
const fs = require('fs');
const sim = require('./sim.js');
const pool = require('./simpool.js');

// id; title; heroes; meta; pact; flags; runs (default / --full; multiples of the 7 heroes, so each leads as often); cost (seconds of one run in one process); win and depth bands as [lo, hi] (win in 0..1); byHero adds the per-hero line; opt: only when --cells names it.
const SMART = { pick: 'smart', vet: '1' };
const pactCell = (k, mid) => ({ id: 'pact' + k, title: 'fully upgraded, Pact ' + k, n: 1, meta: 'max', pact: k, flags: SMART, runs: [28, 196], cost: 1.7, win: [mid - 0.04, mid + 0.04] });
const CELLS = [
  { id: 'rand', title: 'fresh, random picks', n: 1, meta: 'none', pact: 0, flags: { pick: 'random', vet: '1' }, runs: [49, 385], cost: 1.3, win: [0, 0.01] },
  { id: 'smart', title: 'fresh, smart picks', n: 1, meta: 'none', pact: 0, flags: SMART, runs: [35, 385], cost: 1.6 },
  { id: 'mid', title: 'half-upgraded', n: 1, meta: 'mid', pact: 0, flags: SMART, runs: [63, 385], cost: 1.8, win: [0.17, 0.23], byHero: true },
  { id: 'max', title: 'fully upgraded', n: 1, meta: 'max', pact: 0, flags: SMART, runs: [63, 385], cost: 1.9, win: [0.36, 0.44], byHero: true },
  pactCell(1, 0.35), pactCell(2, 0.31), pactCell(3, 0.27), pactCell(4, 0.18),
  { id: 'pact5', title: 'fully upgraded, Pact 5', n: 1, meta: 'max', pact: 5, flags: SMART, runs: [49, 385], cost: 1.7, win: [0.07, 0.13] },
  { id: 'duo5', title: 'two heroes, fully upgraded, Pact 5', n: 2, meta: 'max', pact: 5, flags: SMART, runs: [28, 196], cost: 3.2, win: [0.15, 0.25] },
  { id: 'trio5', title: 'three heroes, fully upgraded, Pact 5', n: 3, meta: 'max', pact: 5, flags: SMART, runs: [21, 196], cost: 5.4, win: [0.15, 0.25] },
  { id: 'quad5', title: 'four heroes, fully upgraded, Pact 5', n: 4, meta: 'max', pact: 5, flags: SMART, runs: [49, 98], cost: 7.5, win: [0.15, 0.25], opt: true },
  { id: 'legacy', title: 'fresh, v3 smart picks', n: 1, meta: 'none', pact: 0, flags: { pick: 'legacy' }, runs: [63, 196], cost: 1.4, opt: true },
  { id: 'duo', title: 'two heroes, half-upgraded', n: 2, meta: 'mid', pact: 0, flags: SMART, runs: [63, 196], cost: 3, opt: true },
  { id: 'trio', title: 'three heroes, half-upgraded', n: 3, meta: 'mid', pact: 0, flags: SMART, runs: [63, 196], cost: 5, opt: true },
];
const SPEED = 4, OWN = new Set(['cells', 'full', 'runs', 'power', 'save', 'pair', 'jobs', 'speed', 'nice', 'list']);
const U = sim.ED.U;

const { flags, args } = pool.parseArgs(process.argv.slice(2));
const extra = {};
for (const k in flags) if (!OWN.has(k)) extra[k] = flags[k];
const want = flags.cells ? flags.cells.split(',') : CELLS.filter(c => !c.opt || flags.list).map(c => c.id);
const bad = want.filter(id => !CELLS.some(c => c.id === id));
if (bad.length) { console.log('unknown cell ' + bad.join(', ') + '; cells: ' + CELLS.map(c => c.id).join(', ')); process.exit(0); }
const cells = CELLS.filter(c => want.includes(c.id)), full = !!flags.full;
const runsOf = (c) => (+flags.runs > 0 ? +flags.runs : c.runs[full ? 1 : 0]);
const workers = Math.max(1, +(flags.jobs || Math.min(os.cpus().length - 1, 8))); // simpool's default of cores - 1 gains nothing over 6 to 8 on the dev machine
const speed = +(flags.speed || Math.min(workers, SPEED));
const estimate = Math.round(cells.reduce((s, c) => s + runsOf(c) * c.cost, 0) / speed + 2);
const forwarded = Object.keys(extra).map(k => '--' + k + (extra[k] === '1' ? '' : '=' + extra[k])).join(' ');

if (flags.list) {
  for (const c of cells) console.log(`${c.id.padEnd(6)} ${(c.title + (c.opt ? ' (opt)' : '')).padEnd(42)} heroes ${c.n} meta ${c.meta} pact ${c.pact} runs ${c.runs[0]} / ${c.runs[1]} (${c.cost}s each) win ${c.win ? band(c.win, 100, '%') : '-'} depth ${c.depth ? band(c.depth, 1, '') : '-'}`);
  console.log(`estimate ${Math.round(cells.filter(c => !c.opt || flags.cells).reduce((s, c) => s + runsOf(c) * c.cost, 0) / speed + 2)} s for the ${flags.cells ? 'named' : 'default'} cells (${full ? 'full' : 'default'} sizes, ${workers} workers, speed ${speed})`);
  process.exit(0);
}

function band(b, k, unit) { const r = (v) => Math.round(v * k * 100) / 100; return b[0] === 0 ? `<=${r(b[1])}${unit}` : `${r(b[0])}-${r(b[1])}${unit}`; }
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const se = (a) => { if (a.length < 2) return NaN; const m = avg(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1) / a.length); };
const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const inBand = (v, b) => !b || (v >= b[0] - 1e-9 && v <= b[1] + 1e-9);

// --power: the boss-arrival read of a cell's runs (sim.arrivalStats) per stratum: power +-se, team level (runs that reached the boss room), and the picks by source at the last boss reached.
function powerLines(rs) {
  const st = sim.ROMAN.map((_, i) => sim.arrivalStats(rs, i + 1)), per = (g) => st.map((a, i) => sim.ROMAN[i] + ' ' + (a.n ? g(a) : '-')).join(' | ');
  const out = [`power (model dmg x ehp at boss arrival, geometric mean +-se): ${per(a => sim.fmtPow(a.gm) + (a.n > 1 ? ' +-' + sim.fmtPow(a.gmSe) : ''))}`, `team lvl at boss arrival (runs): ${per(a => f(avg(a.runs.map(q => q.lvl)), 1) + ' (' + a.n + ')')}`];
  let k = st.length - 1;
  while (k >= 0 && !st[k].n) k--;
  if (k >= 0) {
    const q = st[k].runs, tot = avg(q.map(x => x.pk.reduce((u, v) => u + v, 0)));
    out.push(`picks at boss ${sim.ROMAN[k]}: ${f(tot, 1)} (${sim.PICK_SRC.map((s, j) => [s, avg(q.map(x => x.pk[j]))]).filter(x => x[0] !== 'other' || x[1] > 0).map(x => x[0] + ' ' + f(x[1], 1)).join(', ')})`);
  }
  return out;
}

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
  const by = {}, seedsOf = {}, rows = [];
  plan.forEach((p, i) => { (by[p.c.id] = by[p.c.id] || []).push(res[i]); (seedsOf[p.c.id] = seedsOf[p.c.id] || []).push(p.job.seed); rows.push(sim.rowOf(res[i], p.c.id, p.job.seed)); });
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
    if (flags.power) powerLines(rs).forEach(l => console.log('       ' + l));
  }
  const winRate = (id) => (by[id] ? by[id].filter(r => r.victory).length / by[id].length : NaN);
  const ratioOf = (a, b, s) => { // power of cell b over cell a at stratum s: exp of the mean per-seed ln difference over the seeds both cells reached, se from the same differences
    const A = sim.arrivalStats(by[a], s), B = sim.arrivalStats(by[b], s), ma = new Map(A.idx.map((k, j) => [seedsOf[a][k], A.ln[j]])), d = [];
    B.idx.forEach((k, j) => { const v = ma.get(seedsOf[b][k]); if (v !== undefined) d.push(B.ln[j] - v); });
    const r = Math.exp(avg(d));
    return { n: d.length, r, se: r * se(d) };
  };
  const sdiff = (a, b) => 100 * Math.sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n), P = (id) => ({ p: winRate(id), n: by[id].length });
  const gap = (a, b) => { const d = 100 * (winRate(b) - winRate(a)); return `${d >= 0 ? '+' : ''}${f(d, 1)} +-${f(sdiff(P(b), P(a)), 1)}`; };
  if (from <= 1 && by.rand && by.smart && by.mid) { // difficulty contract: fresh random <= fresh smart <= half-upgraded (smart has no band of its own)
    const ok = winRate('rand') <= winRate('smart') && winRate('smart') <= winRate('mid');
    judged++; if (ok) pass++;
    console.log(`gaps (win points): knowledge (smart - random, fresh) ${gap('rand', 'smart')} | lower Hearth (mid - fresh, smart) ${gap('smart', 'mid')}${by.max ? ' | upper Hearth (max - mid) ' + gap('mid', 'max') : ''} | random <= smart <= mid: ${ok ? 'PASS' : 'FAIL'}`);
  }
  const ladder = ['max', 'pact1', 'pact2', 'pact3', 'pact4', 'pact5'].filter(id => by[id]);
  if (ladder.length > 2) { // Pact ladder: each Pact level should cost win rate (report only; a quick-size step is within noise)
    const mono = ladder.every((id, i) => i === 0 || winRate(id) <= winRate(ladder[i - 1]));
    console.log(`Pact ladder (win %): ${ladder.map(id => id + ' ' + f(100 * winRate(id), 1)).join(' > ')} | monotonic: ${mono ? 'yes' : 'no'}`);
  }
  if (flags.power) {
    for (const [a, b, name] of [['rand', 'smart', 'smart/rand (knowledge gap, fresh)'], ['smart', 'max', 'max/smart (Hearth gap, smart picks)'], ['mid', 'max', 'max/mid (upper Hearth, smart picks)']]) {
      if (!by[a] || !by[b]) continue;
      const rs = sim.ROMAN.map((_, i) => ratioOf(a, b, i + 1));
      console.log(`power ratio ${name}, paired by seed: ${rs.map((x, i) => sim.ROMAN[i] + ' ' + (x.n ? 'x' + f(x.r, 2) + (x.n > 1 ? ' +-' + f(x.se, 2) : '') : '-')).join(' | ')} (pairs ${rs[0].n}..${rs[5].n})`);
    }
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
