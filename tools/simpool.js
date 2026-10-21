// Usage: node tools/simpool.js <heroes> <runs> <botSkill> <meta none|mid|max[,...]> [classes|-] [pact] [--pick=smart|random] [--force=id,id] [--seed0=N] [--explore=minLight] [--strata=N] [--jobs=N] [--patch=file.js] [--detail]
// Parallel batch runs of tools/sim.js bots across worker processes (default: cores - 1) at idle priority. One result line per meta profile;
// --detail prints the full sim.js summary of each. --patch=file.js loads a module exporting function (ED) that edits tables (ED.World.THREAT, ED.ENEMIES, ...) in every worker.
// Results are deterministic per seed, so the same command always prints the same numbers regardless of --jobs.
require('os').setPriority(19);
const cp = require('child_process');
const os = require('os');
const path = require('path');
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
  const pick = flags.pick || process.env.PICK || 'random', seed0 = +(flags.seed0 || 1000), force = flags.force ? flags.force.split(',') : [];
  const exploreMin = flags.explore === undefined ? undefined : +flags.explore, maxStratum = flags.strata === undefined ? undefined : +flags.strata;
  const jobs = [];
  for (const meta of metas) {
    const { up, mastery } = sim.metaProfile(meta);
    for (let i = 0; i < runs; i++) jobs.push({ label: meta, seed: seed0 + i * 7, n, cls: [cls[i % cls.length]].concat(cls), skill, up, pact, mastery, pick, force, exploreMin, maxStratum });
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
    console.log(`pick=${pick}${force.length ? ' force=' + force.join(',') : ''}${exploreMin === undefined ? '' : ' explore=' + exploreMin}${maxStratum === undefined ? '' : ' strata<=' + maxStratum + ' (capped runs: wins and depth do not apply)'} heroes=${n} pact=${pact} runs=${runs} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${W} workers)`);
    for (const meta of metas) {
      const rs = all[meta], wins = rs.filter(r => r.victory).length;
      if (flags.detail) console.log(`\n== ${meta}\n` + sim.summarize(rs));
      else console.log(`${meta.padEnd(5)} wins ${wins}/${rs.length} (${(100 * wins / rs.length).toFixed(0)}%) depth ${(rs.reduce((s, r) => s + r.stratum, 0) / rs.length).toFixed(2)} winners ${wins ? sim.ED.U.fmtTime(rs.filter(r => r.victory).reduce((s, r) => s + r.time, 0) / wins) : '-'} rooms ${(100 * rs.reduce((s, r) => s + r.rooms.visited, 0) / rs.reduce((s, r) => s + r.rooms.total, 0)).toFixed(0)}% gloom downs ${(rs.reduce((s, r) => s + r.downedBy.filter(k => k.startsWith('gloom@')).length, 0) / rs.length).toFixed(2)}/run, ${(100 * rs.reduce((s, r) => s + (r.dmgBy.gloom || 0), 0) / Math.max(1, rs.reduce((s, r) => s + Object.values(r.dmgBy).reduce((x, y) => x + y, 0), 0))).toFixed(0)}% of damage taken, flares ${(rs.reduce((s, r) => s + r.flares, 0) / rs.length).toFixed(2)}/run`);
    }
  };
}
