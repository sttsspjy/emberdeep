// Bench runner check (exit 1 on failure). Usage: node tools/check-bench.js
// Runs tools/bench.js with --runner ./bench-fake.js (stub runOne) on tiny matrices in a temp dir. 1. Job matrix: weapon sets, signature skipped, baseline, fill, skill, deterministic order,
// skill and maxTime in the job key; the stub honours fill and skill. 2. A run writes results.jsonl (code hash per line), meta.json (hash, HEAD, dirty), summary.json, report.html;
// stdout prints pooled tables only (--tables all: every group). 3. --resume runs only missing jobs (extra seeds, torn line); a different maxTime or code hash is refused (exit 2)
// unless --force, which marks mixed code. 4. --report: summary numbers (Wilson, paired deltas vs raw runs, boss slots incl. 'twinhammer', TTK, hurt/min, funnel, damage taken),
// groups per stage x meta x fill x skill, self-contained HTML. 5. Paired deltas use only tuples present in both arms (unbalanced synthetic matrix). 6. Byte-identical reports
// (apart from timestamps), also with the results file shuffled. 7. --help, mmss. 8. A runner that throws on require exits 1; one whose runOne always throws exits 1; stale errors
// are dropped on resume and report. 9. Results without skill / hash load as skill 1, hash 'unknown'. 10. Bad flags exit 2.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const B = require('./bench.js'), ED = require('./sim.js').load(), fake = require('./bench-fake.js');
const BENCH = path.join(__dirname, 'bench.js'), FAKE = ['--runner', './bench-fake.js'];
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const run = (args) => cp.spawnSync(process.execPath, [BENCH, ...args], { cwd: __dirname, encoding: 'utf8', timeout: 120000 });
const parse = (l) => { try { return JSON.parse(l); } catch (e) { return null; } };
const lines = (dir, f) => fs.existsSync(path.join(dir, f || 'results.jsonl')) ? fs.readFileSync(path.join(dir, f || 'results.jsonl'), 'utf8').split('\n').filter(l => l.trim()) : [];
const runs = (dir) => lines(dir).map(parse).filter(Boolean);
const keys = (dir) => runs(dir).map(B.keyOf);
const json = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const near = (a, b, e) => typeof a === 'number' && Math.abs(a - b) < (e || 1e-3);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wickdeep-bench-'));

// 1. matrix
const cfg = { stages: '0', heroes: 'knight', weapons: 'general', seeds: 1, seed0: 1, meta: 'none', fill: 'off', skill: '1', maxTime: 300, baseline: true };
const gen = B.buildJobs(cfg, ED);
const general = ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].sig === null && !ED.WEAPONS[id].evolved);
ok(general.length >= 1 && gen.length === general.length + 1 && gen[0].weapon === null && gen.slice(1).every(j => general.includes(j.weapon)), 'general = non-signature, non-evolved weapons + baseline (' + gen.length + ' jobs)');
const all = B.buildJobs(Object.assign({}, cfg, { weapons: 'all' }), ED);
ok(!all.some(j => j.weapon === ED.HEROES.knight.sig) && all.some(j => j.weapon === ED.HEROES.pyro.sig), 'all: other heroes\' signatures in, own signature out');
ok(B.buildJobs(Object.assign({}, cfg, { weapons: 'none' }), ED).length === 1 && B.buildJobs(Object.assign({}, cfg, { baseline: false }), ED).every(j => j.weapon !== null), 'none = baseline only; --no-baseline drops it');
const big = Object.assign({}, cfg, { stages: 'all', heroes: 'all', seeds: 2, meta: 'none,max', skill: '1,0.3' });
ok(JSON.stringify(B.buildJobs(big, ED)) === JSON.stringify(B.buildJobs(big, ED)) && B.buildJobs(big, ED)[0].seed === 1 && B.buildJobs(big, ED).slice(-1)[0].seed === 2, 'job order is deterministic, seed outermost');
const both = B.buildJobs(Object.assign({}, cfg, { fill: 'off,on' }), ED);
ok(gen.every(j => j.fill === 'off') && both.length === 2 * gen.length && both[0].fill === 'off' && both[1].fill === 'on', '--fill off,on doubles the jobs');
const sk = B.buildJobs(Object.assign({}, cfg, { skill: '1,0.3' }), ED);
ok(sk.length === 2 * gen.length && sk[0].skill === 1 && sk[1].skill === 0.3 && sk.every(j => j.maxTime === 300), '--skill 1,0.3 doubles the jobs, skill innermost; jobs carry skill and maxTime');
ok(B.cfgFrom({}, null).skill === '1,0.3' && B.cfgFrom({}, null).seeds === 8 && B.cfgFrom({}, { seeds: 4, maxTime: 1080 }).skill === '1', 'defaults: skill 1,0.3, 8 seeds; a stored cfg without skill ran skill 1');
const j0 = { stage: 0, cls: 'knight', weapon: 'glaive', seed: 1, meta: 'none', fill: 'off', skill: 1, maxTime: 1080 };
ok(new Set([j0, Object.assign({}, j0, { fill: 'on' }), Object.assign({}, j0, { skill: 0.3 }), Object.assign({}, j0, { maxTime: 600 })].map(B.keyOf)).size === 4, 'fill, skill and maxTime are in the job key');
const fo = fake.runOne(Object.assign({}, j0)), fn = fake.runOne(Object.assign({}, j0, { fill: 'on' }));
ok(fo.fill === 'off' && fn.fill === 'on' && fo.build.weapons.length <= 2 && fn.build.weapons.length > fo.build.weapons.length && fo.skill === 1 && typeof fo.hurt === 'number', 'stub honours fill, echoes skill, reports hurt');
const fk = (s) => [...Array(40).keys()].map(i => fake.runOne(Object.assign({}, j0, { seed: i + 1, skill: s })));
const f1 = fk(1), f3 = fk(0.3);
ok(f1.filter(r => r.won).length > f3.filter(r => r.won).length && mean(f3.map(r => r.hurt / r.time)) > mean(f1.map(r => r.hurt / r.time)) && f1.every(r => r.bosses.every(b => 'spawn' in b)) &&
  f1.some(r => r.bosses.some(b => b.id === 'twinhammer' && b.spawn === null)), 'stub: lower skill = fewer wins, more hurt; bosses carry spawn; twinhammer on odd seeds');

// 2. a fresh run: stages 0,1 x knight, pyro x baseline, lanterns, firebolt (pyro's signature: skipped) x seed 1 x skill 1, 0.3 = 2 * (3 + 2) * 2 = 20 jobs
const dir = path.join(tmp, 'a');
const M = [...FAKE, '--stages', '0,1', '--heroes', 'knight,pyro', '--weapons', 'lanterns,firebolt', '--meta', 'none', '--jobs', '2', '--maxTime', '1080'];
let r = run([...M, '--seeds', '1', '--out', dir]);
ok(r.status === 0, 'fake bench exits 0' + (r.status ? ': ' + r.stderr : ''));
ok(lines(dir).length === 20 && new Set(keys(dir)).size === 20, 'results.jsonl has 20 distinct runs (got ' + lines(dir).length + ')');
ok(['meta.json', 'summary.json', 'report.html'].every(f => fs.existsSync(path.join(dir, f))), 'meta.json, summary.json, report.html written');
const meta0 = json(dir, 'meta.json');
ok(/^[0-9a-f]{12}$/.test(meta0.hash) && runs(dir).every(x => x.hash === meta0.hash) && typeof meta0.dirty === 'boolean' && meta0.commit === meta0.head + (meta0.dirty ? '-dirty' : '') && meta0.cfg.runner === 'tools/bench-fake.js',
  'meta.json: code hash, HEAD, dirty, runner; every result stamped with the hash');
ok(meta0.hash === B.codeHash(path.join(__dirname, 'bench-fake.js')) && meta0.hash !== B.codeHash(path.join(__dirname, 'bot.js')), 'code hash covers the runner file');
ok(/runs\/min/.test(r.stdout) && /ETA/.test(r.stdout) && /All stages · meta none · fill off · skill 1 /.test(r.stdout) && /All stages · meta none · fill off · skill 0\.3 /.test(r.stdout) &&
  !/The Ossuary · meta/.test(r.stdout) && /baseline\s+\d/.test(r.stdout), 'stdout: progress line and pooled tables only, one per skill');
r = run(['--report', dir, '--tables', 'all']);
ok(r.status === 0 && /The Ossuary · meta none · fill off · skill 1 /.test(r.stdout) && /The Glowmire · meta none · fill off · skill 0\.3 /.test(r.stdout), '--tables all prints every group');

// 3. resume
r = run(['--resume', dir, '--seeds', '2']);
ok(r.status === 0 && /40 jobs, 20 already done, 20 to run/.test(r.stdout), 'resume with 2 seeds runs only the 20 missing jobs');
ok(lines(dir).length === 40 && new Set(keys(dir)).size === 40, 'results.jsonl now has 40 distinct runs');
r = run(['--resume', dir]);
ok(r.status === 0 && /0 to run/.test(r.stdout) && lines(dir).length === 40, 'resume of a finished dir runs nothing (stored cfg and runner reused)');
const kept = lines(dir).slice(0, 30);
fs.writeFileSync(path.join(dir, 'results.jsonl'), kept.join('\n') + '\n' + kept[29].slice(0, 40));   // crash: 10 runs lost, a torn last line
r = run(['--resume', dir]);
ok(r.status === 0 && /30 already done, 10 to run/.test(r.stdout) && new Set(keys(dir)).size === 40, 'torn jsonl after a crash: resume reruns the 10 missing jobs');
const meta = json(dir, 'meta.json');
ok(meta.sessions.length === 4 && meta.cfg.seeds === 2 && meta.sessions.every(s => s.end && /^[0-9a-f]{12}$/.test(s.hash) && (s.fake || !s.runs)), 'meta.json: 4 sessions with hash and stub flag, stored cfg updated');

// 3b. refusals on copies
const cMax = path.join(tmp, 'max'); fs.cpSync(dir, cMax, { recursive: true });
r = run(['--resume', cMax, '--maxTime', '600']);
ok(r.status === 2 && /maxTime 600 differs from the stored 1080/.test(r.stderr) && runs(cMax).length === 40, 'resume with another maxTime is refused (exit 2)' + (r.status !== 2 ? ': ' + r.status + ' ' + r.stderr + r.stdout.slice(0, 300) : ''));
r = run(['--resume', cMax, '--maxTime', '600', '--force']);
const Smax = json(cMax, 'summary.json');
ok(r.status === 0 && /40 jobs, 0 already done, 40 to run/.test(r.stdout) && runs(cMax).length === 80 && Smax.groups.some(g => g.maxTime === 600 && / · max 10:00/.test(g.label)) && Smax.groups.some(g => g.maxTime === 1080),
  '--force runs the new maxTime as separate jobs and groups (label shows max)');
const cHash = path.join(tmp, 'hash'); fs.cpSync(dir, cHash, { recursive: true });
const mh = json(cHash, 'meta.json'); mh.hash = 'deadbeefdead'; fs.writeFileSync(path.join(cHash, 'meta.json'), JSON.stringify(mh));
fs.writeFileSync(path.join(cHash, 'results.jsonl'), runs(cHash).map(x => JSON.stringify(Object.assign(x, { hash: 'deadbeefdead' })) + '\n').join(''));
r = run(['--resume', cHash, '--seeds', '3']);
ok(r.status === 2 && /code hash [0-9a-f]{12} differs from the stored deadbeefdead/.test(r.stderr) && runs(cHash).length === 40, 'resume with a changed code hash is refused (exit 2)');
r = run(['--resume', cHash, '--seeds', '3', '--force']);
const Sh = json(cHash, 'summary.json');
ok(r.status === 0 && Sh.meta.mixed && Sh.meta.hashes.deadbeefdead === 40 && Sh.meta.hashes[meta.hash] === 20 && /MIXED CODE/.test(r.stdout) && fs.readFileSync(path.join(cHash, 'report.html'), 'utf8').includes('Mixed code: results come from'),
  '--force resumes; summary, stdout and report flag mixed code');
ok(run(['--resume', cHash]).status === 0, 'after --force the stored hash is the current one');

// 4. report rebuild and summary
fs.unlinkSync(path.join(dir, 'report.html'));
r = run(['--report', dir]);
ok(r.status === 0 && fs.existsSync(path.join(dir, 'report.html')), '--report rebuilds report.html');
const S = json(dir, 'summary.json'), raw = runs(dir);
ok(S.meta.runs === 40 && S.groups.length === 6 && S.groups.map(g => g.stage + '/' + g.skill).join() === '0/1,1/1,-1/1,0/0.3,1/0.3,-1/0.3', 'summary: 40 runs, groups stage 0, 1, all per skill 1, 0.3');
const g0 = S.groups[0], R0 = raw.filter(x => x.stage === 0 && x.skill === 1);
const W = (w, h) => R0.filter(x => (x.weapon || 'baseline') === w && (!h || x.cls === h));
const pairOn = (a, b, f) => { const out = []; for (const x of a) { const y = b.find(z => z.cls === x.cls && z.seed === x.seed); if (y && f(x) !== null && f(y) !== null) out.push(f(x) - f(y)); } return out; };
const winf = (x) => x.won ? 1 : 0;
const lan = g0.weapons.find(w => w.weapon === 'lanterns'), fire = g0.weapons.find(w => w.weapon === 'firebolt');
ok(lan.n === 4 && near(lan.base.win.d, mean(pairOn(W('lanterns'), W('baseline'), winf))) && lan.base.win.n === 4, 'lanterns vs baseline: n and paired Δ win match the raw runs');
ok(fire.heroes === 1 && fire.base.win.n === 2 && near(fire.base.win.d, mean(pairOn(W('firebolt'), W('baseline', 'knight'), winf))), 'firebolt Δ pairs only with the knight baseline');
// rel: knight tuples have lanterns + firebolt; pyro tuples have lanterns only (fewer than 2 forced weapons: no reference)
const relL = W('lanterns', 'knight').map(x => winf(x) - (winf(x) + winf(W('firebolt').find(y => y.seed === x.seed))) / 2);
ok(lan.rel.win.n === 2 && near(lan.rel.win.d, mean(relL)) && g0.cells['pyro|lanterns'].rel.win === null, 'relative strength: weapon minus the hero mean over forced weapons, same tuple; needs 2 forced weapons');
const D = R0.map(x => B.derive(x, ED));
ok(D.every(d => d.slots.length === 3) && R0.every((x, i) => !x.bosses.some(b => b.id === 'twinhammer') || D[i].slots[1] !== null), 'twinhammer kill (no spawn) maps to the twins slot');
const fin = R0.filter(x => x.won).map(x => { const b = x.bosses[x.bosses.length - 1]; return b.at - b.spawn; });
ok(fin.length ? near(g0.overall.finalTTK, Math.round(mean(fin) * 10) / 10, 0.051) : g0.overall.finalTTK === null, 'final TTK = mean(at - spawn) of the last boss over won runs');
ok(near(g0.overall.hurtMin, Math.round(mean(R0.map(x => x.hurt / x.time * 60)) * 100) / 100, 0.006), 'hurt/min = mean(hurt / time * 60)');
const lost = R0.filter(x => !x.won);
ok(g0.overall.lostN === lost.length && (lost.length ? near(g0.overall.lostTime, Math.round(mean(lost.map(x => x.time)) * 10) / 10, 0.051) : g0.overall.lostTime === null), 'lost survival: mean time of lost runs only');
const twinsKilled = R0.filter(x => x.bosses.some(b => b.id === 'twins' || b.id === 'twinhammer')).length;
ok(g0.funnel.length === 3 && g0.funnel[1].killed === twinsKilled && g0.funnel.every(f => f.killed <= f.reached && f.reached <= g0.n), 'funnel counts twinhammer kills in the twins slot');
const gp = S.groups[2];
ok(gp.stage === -1 && /each stage's schedule/.test(gp.funnel[0].label) && gp.funnel[0].t === 300, 'pooled funnel is labelled per stage schedule');
const [lo, hi] = B.wilson(5, 10);
ok(near(lo, 0.2366) && near(hi, 0.7634) && B.wilson(0, 0).join() === '0,0', 'Wilson 95% interval');
const wsorted = g0.weapons.every((w, i, a) => !i || a[i - 1].win > w.win || (a[i - 1].win === w.win && a[i - 1].lo >= w.lo));
ok(wsorted && g0.baseline.length === 2 && g0.cells['pyro|firebolt'] === undefined && !('time' in g0.weapons[0]), 'ranking: win then Wilson lower bound; no avg-time field; no own-signature cell');
const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
ok(['howto', 'ranking', 'heatmap', 'baseline', 'deaths', 'funnel', 'meta'].every(id => html.includes('<section id="' + id + '"')), 'report has howto, ranking, heatmap, baseline, deaths, funnel, meta sections');
ok(!/<script[^>]+src=|<link[^>]+href=|https?:\/\/(?!www\.w3)/.test(html) && /prefers-color-scheme:dark/.test(html), 'report is self-contained, with a dark scheme');
const body = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
ok(!/<\/script>/i.test(body) && /not the forced weapon alone/.test(html) && /class skills included/.test(html) && /Fill off: the bot takes no other weapons/.test(html),
  'embedded data cannot close the script tag; semantics note present');
let syntaxOk = true;
try { new Function(body); } catch (e) { syntaxOk = false; }
ok(syntaxOk, 'page script parses');
const tsum = g0.taken.reduce((a, t) => a + t.pct, 0);
ok(g0.fill === 'off' && g0.taken.length > 0 && Math.abs(tsum - 1) < 0.01, 'damage taken by source: shares sum to 1');

// 5. paired deltas over common tuples only (synthetic unbalanced matrix): baseline seeds 1-10 (wins 1-5), glaive seeds 6-10 (wins all), censer seeds 1-10 (loses 8-10)
const syn = path.join(tmp, 'syn'); fs.mkdirSync(syn);
const mk = (weapon, seed, won) => ({ stage: 0, stageId: 'ossuary', cls: 'knight', weapon, seed, meta: 'none', fill: 'off', skill: 1, maxTime: 1080, hash: 'h', won, time: won ? 920 : 500,
  level: 50, kills: 1000, gold: 0, death: won ? null : 'bat', bosses: won ? [{ id: 'warden', at: 320, spawn: 300 }, { id: 'twins', at: 630, spawn: 600 }, { id: 'hollow', at: 920 - (weapon === 'glaive' ? 10 : 0), spawn: 900 }] : [],
  dealt: { cleave: 100 }, taken: { bat: 10 }, hurt: won ? 46 : 50, build: { weapons: [], passives: [] }, evolved: {}, hpLow: 0.5, ticks: 1, ms: 1 });
const sr = [];
for (let s = 1; s <= 10; s++) sr.push(mk(null, s, s <= 5), mk('censer', s, s <= 7));
for (let s = 6; s <= 10; s++) sr.push(mk('glaive', s, true));
fs.writeFileSync(path.join(syn, 'results.jsonl'), sr.map(x => JSON.stringify(x) + '\n').join(''));
const Sy = B.summarize(syn, ED), gy = Sy.groups[0], gl = gy.weapons.find(w => w.weapon === 'glaive'), ce = gy.weapons.find(w => w.weapon === 'censer');
ok(gl.base.win.n === 5 && gl.base.win.d === 1 && gl.base.win.lo === 1 && gl.base.win.sig && gl.win === 1, 'unbalanced: glaive vs baseline pairs seeds 6-10 only (+100 pt, not the unpaired +50)');
ok(ce.base.win.n === 10 && near(ce.base.win.d, 0.2), 'censer vs baseline pairs all 10 seeds (+20 pt)');
ok(gl.rel.win.n === 5 && near(gl.rel.win.d, 0.3) && ce.rel.win.n === 5 && near(ce.rel.win.d, -0.3), 'relative strength over the 5 tuples with both weapons: glaive +30 pt, censer -30 pt');
ok(gl.rel.ttk.n === 2 && near(gl.rel.ttk.d, -5) && gl.base.ttk === null, 'TTK pairs need both arms won: glaive 5 s faster than the weapon mean on seeds 6-7, no baseline wins on 6-10');
ok(gy.cells['knight|glaive'].base.win.n === 5 && gy.cells['knight|glaive'].rel.win.n === 5 && gy.weapons.find(w => w.weapon === 'baseline').base.win === null, 'cells pair the same way; the baseline has no Δ vs itself');
ok(gl.base.win.lo <= gl.base.win.d && ce.base.win.lo <= ce.base.win.d && ce.base.win.d <= ce.base.win.hi && ce.base.win.lo > 0 === ce.base.win.sig, 'CI brackets the mean; sig = CI excludes 0');

// 6. determinism
const strip = (s) => s.replace(/"generated":\s*"[^"]*"/g, '"generated":""');
const snap = (d) => [strip(fs.readFileSync(path.join(d, 'summary.json'), 'utf8')), strip(fs.readFileSync(path.join(d, 'report.html'), 'utf8'))];
run(['--report', dir]); const s1 = snap(dir);
run(['--report', dir]); const s2 = snap(dir);
const shuf = path.join(tmp, 'shuf'); fs.cpSync(dir, shuf, { recursive: true });
const sl = lines(shuf), perm = sl.map((l, i) => [(i * 7919) % 101, l]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
fs.writeFileSync(path.join(shuf, 'results.jsonl'), perm.join('\n') + '\n');
run(['--report', shuf]); const s3 = snap(shuf);
ok(s1[0] === s2[0] && s1[1] === s2[1], 'two --report runs are byte-identical apart from the timestamp (seeded bootstrap)');
ok(s1[0] === s3[0] && s1[1] === s3[1], 'report is identical with the results file shuffled');

// 7. --help, mmss
r = run(['--help']);
ok(r.status === 0 && /^Headless weapon-balance bench/.test(r.stdout) && /Mechanism:/.test(r.stdout) && !/use strict|---------------- |Runner module path/.test(r.stdout), '--help prints only the header comment block');
ok(B.mmss(59.6) === '1:00' && B.mmss(119.5) === '2:00' && B.mmss(61.2) === '1:01' && B.mmss(0) === '0:00' && B.mmss(null) === '–', 'mmss rounds total seconds first (no m:60)');

// 8. runner failures and stale errors
const boom = path.join(tmp, 'boom.js'); fs.writeFileSync(boom, 'throw new Error("runner boom on require");\n');
r = run(['--runner', boom, '--stages', '0', '--heroes', 'knight', '--weapons', 'none', '--seeds', '1', '--jobs', '2', '--out', path.join(tmp, 'boom')]);
ok(r.status === 1 && /runner failed to start/.test(r.stderr) && /runner boom on require/.test(r.stderr), 'a runner that throws on require: error printed, exit 1');
const thr = path.join(tmp, 'thr.js'); fs.writeFileSync(thr, 'module.exports = { runOne() { throw new Error("job boom"); } };\n');
const td = path.join(tmp, 'thr');
r = run(['--runner', thr, '--stages', '0', '--heroes', 'knight', '--weapons', 'lanterns', '--seeds', '1', '--skill', '1', '--jobs', '2', '--out', td]);
ok(r.status === 1 && /no job produced a result/.test(r.stderr) && lines(td, 'errors.jsonl').length === 2, 'a runner whose runOne always throws: errors.jsonl, exit 1');
r = run(['--resume', td, ...FAKE, '--force']);
ok(r.status === 0 && lines(td).length === 2 && lines(td, 'errors.jsonl').length === 0 && json(td, 'summary.json').meta.errors === 0, 'resume with a working runner drops the now-stale errors');
fs.appendFileSync(path.join(dir, 'errors.jsonl'), JSON.stringify({ cfg: raw[0], error: 'old' }) + '\n' + JSON.stringify({ cfg: Object.assign({}, raw[0], { seed: 99 }), error: 'open' }) + '\n');
r = run(['--report', dir]);
ok(r.status === 0 && lines(dir, 'errors.jsonl').length === 1 && JSON.parse(lines(dir, 'errors.jsonl')[0]).error === 'open' && json(dir, 'summary.json').meta.errors === 1, '--report drops errors whose key has a result');

// 9. legacy results (no skill, no hash)
const leg = path.join(tmp, 'leg'); fs.mkdirSync(leg);
fs.writeFileSync(path.join(leg, 'results.jsonl'), raw.filter(x => x.skill === 1).map(x => { const y = Object.assign({}, x); delete y.skill; delete y.hash; return JSON.stringify(y) + '\n'; }).join(''));
r = run(['--report', leg]);
const Sl = json(leg, 'summary.json');
ok(r.status === 0 && Sl.meta.runs === 20 && Sl.meta.legacy === 20 && Sl.meta.hashes.unknown === 20 && Sl.groups.every(g => g.skill === 1) && /predate skill/.test(r.stdout), 'legacy results load as skill 1, hash unknown');

// 10. bad input
ok(run(['--heroes', 'nobody', '--out', path.join(tmp, 'b')]).status === 2 && run(['--bogus']).status === 2 && run(['--report', path.join(tmp, 'none')]).status === 2 &&
  run([...FAKE, '--skill', '2', '--out', path.join(tmp, 'c')]).status === 2 && run(['--tables', 'some', '--report', dir]).status === 2 && run(['--runner', 'nope.js']).status === 2,
'bad hero, unknown flag, missing dir, bad skill, bad --tables, missing runner exit 2');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`check-bench: ${fails ? fails + ' failure(s)' : 'all passed'}`);
process.exitCode = fails ? 1 : 0;
