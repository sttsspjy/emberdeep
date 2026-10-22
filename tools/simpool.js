// Usage: node tools/simpool.js <heroes> <runs> <botSkill> <meta none|mid|max[,...]> [classes|-] [pact] [--pick=smart|legacy|random] [--start=random|class|generalist|rotate|<gateId>] [--gates=1|2] [--force=id[@slot],...] [--route=attack|skill1|skill2|element|random|rotate] [--fork=0|1|random|rotate] [--weapon=0|1|2|rotate]
//   [--seed0=N] [--dark=smart|always|never] [--strata=N] [--jobs=N] [--patch=file.js] [--out=rows.json] [--pair=rows.json] [--detail] [--nice]   (every flag of tools/sim.js is forwarded)
// Parallel batch runs of tools/sim.js bots across worker processes (default: cores - 1) at normal priority (--nice: idle priority, which Windows may throttle to a crawl while the machine is unattended). One result line per meta profile;
// --detail prints the full sim.js summary of each. --patch=file.js loads a module exporting function (ED) that edits tables (ED.World.THREAT, ED.ENEMIES, ...) in every worker.
// --out writes one row per run for paired measurement; --pair prints the paired mean difference to such a baseline file.
// Results are deterministic per seed, so the same command always prints the same numbers regardless of --jobs.
if (process.argv.includes('--nice')) require('os').setPriority(19); // workers inherit the priority class
const cp = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sim = require('./sim.js');

if (process.argv[2] === '--worker') {
  // { patch } edits the tables once; each { i, job } runs one bot and answers { i, r }; the worker exits when the parent disconnects
  process.on('message', (m) => {
    if (m.patch) require(path.resolve(m.patch))(sim.ED);
    if (m.job) process.send({ i: m.i, r: sim.runBot(m.job) });
  });
} else {
  const flags = {}, args = [];
  for (const a of process.argv.slice(2)) { const m = /^--([a-z0-9]+)(?:=(.*))?$/i.exec(a); if (m) flags[m[1]] = m[2] === undefined ? '1' : m[2]; else args.push(a); }
  const n = +(args[0] || 1), runs = +(args[1] || 48), skill = +(args[2] || 0.75), metas = (args[3] || 'none').split(',');
  const cls = (args[4] && args[4] !== '-' ? args[4] : 'knight,ranger,pyro,shade,cleric,necro').split(','), pact = +(args[5] || 0);
  const o = sim.optsFromFlags(flags), pick = o.pick, seed0 = +(flags.seed0 || 1000), force = o.force, maxStratum = o.maxStratum;
  const jobs = [];
  for (const meta of metas) {
    const { up, mastery, relics } = sim.metaProfile(meta);
    for (let i = 0; i < runs; i++) jobs.push(Object.assign({ label: meta, seed: seed0 + i * 7, n, cls: [cls[i % cls.length]].concat(cls), skill, up, pact, mastery, relics }, sim.jobOpts(o, i, cls.length)));
  }
  // job queue: each worker takes the next job when it finishes one; results are reported in job order (output independent of --jobs and timing)
  const W = Math.max(1, Math.min(+(flags.jobs || os.cpus().length - 1), jobs.length));
  const res = new Array(jobs.length); let next = 0, left = jobs.length; const t0 = Date.now();
  for (let k = 0; k < W; k++) {
    const c = cp.fork(__filename, ['--worker']);
    const feed = () => { if (next < jobs.length) { c.send({ i: next, job: jobs[next] }); next++; } else c.disconnect(); };
    c.on('message', (m) => { res[m.i] = m.r; if (--left === 0) report(); feed(); });
    if (flags.patch) c.send({ patch: flags.patch });
    feed();
  }
  const report = () => {
    const all = {};
    jobs.forEach((j, i) => (all[j.label] = all[j.label] || []).push(res[i]));
    const rows = jobs.map((j, i) => sim.rowOf(res[i], j.label, j.seed));
    if (flags.out) fs.writeFileSync(flags.out, JSON.stringify(rows));
    console.log(`pick=${pick}${o.route ? ' route=' + o.route : ''}${o.fork !== undefined ? ' fork=' + o.fork : ''}${o.weapon !== undefined ? ' weapon=' + o.weapon : ''}${o.start ? ' start=' + o.start : ''}${o.gates ? ' gates=' + o.gates : ''}${force.length ? ' force=' + force.join(',') : ''}${o.dark ? ' dark=' + o.dark : ''}${maxStratum === undefined ? '' : ' strata<=' + maxStratum + ' (capped runs: wins and depth do not apply)'} heroes=${n} pact=${pact} runs=${runs} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${W} workers)`);
    for (const meta of metas) {
      const rs = all[meta], wins = rs.filter(r => r.victory).length;
      if (flags.detail) console.log(`\n== ${meta}\n` + sim.summarize(rs));
      else if (o.route || o.fork !== undefined || o.weapon !== undefined) console.log(sim.classLines(rs));
      if (!flags.detail) console.log(`${meta.padEnd(5)} wins ${wins}/${rs.length} (${(100 * wins / rs.length).toFixed(0)}% +-${(100 * Math.sqrt(wins / rs.length * (1 - wins / rs.length) / rs.length)).toFixed(1)}) depth ${(rs.reduce((s, r) => s + r.stratum, 0) / rs.length).toFixed(2)} +-${Math.sqrt(rs.reduce((s, r, _, a) => s + (r.stratum - a.reduce((x, y) => x + y.stratum, 0) / a.length) ** 2, 0) / (rs.length - 1) / rs.length).toFixed(2)} winners ${wins ? sim.ED.U.fmtTime(rs.filter(r => r.victory).reduce((s, r) => s + r.time, 0) / wins) : '-'} rooms ${(100 * rs.reduce((s, r) => s + r.rooms.visited, 0) / rs.reduce((s, r) => s + r.rooms.total, 0)).toFixed(0)}% dark rooms entered ${(rs.reduce((s, r) => s + r.dark.reduce((x, y) => x + y, 0), 0) / rs.length).toFixed(2)}/run`);
    }
    if (flags.pair) console.log(sim.pairReport(rows, JSON.parse(fs.readFileSync(flags.pair, 'utf8'))));
  };
}
