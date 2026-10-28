// Headless hero-balance bench: runs a bot runner (runOne of tools/bot.js) over a stage x hero x seed x meta x skill matrix in parallel and writes a report (one row per hero: its weapon).
// Usage: node tools/bench.js [--stages 0,1,2|all] [--heroes all|knight,...] [--seeds N] [--seed0 S] [--meta none|max|none,max]
//                            [--skill 1,0.3] [--maxTime S] [--jobs N] [--low] [--out DIR] [--quick] [--runner MODULE] [--tables pooled|all]
//        node tools/bench.js --resume DIR [any flag above overrides the stored cfg] [--force]   (skips jobs already in DIR/results.jsonl)
//        node tools/bench.js --report DIR [--tables pooled|all]                                (rebuilds summary.json + report.html from DIR/results.jsonl)
//   --skill: bot reflex tiers 0..1 (1 competent, 0.3 sloppy). --quick: --seeds 2 --stages 0. Defaults: all stages, all heroes, 8 seeds from 1,
//   meta none, skill 1,0.3, maxTime 1080, jobs = logical cores - 1. --low: children at low OS priority and default jobs halved (for using the PC meanwhile).
//   --runner: module path exporting runOne(cfg) (default ./bot.js; ./bench-fake.js is a fast deterministic stub). --resume refuses a maxTime other than the stored one or a
//   changed code hash unless --force. --tables all: a stdout table per group (default: only the groups pooled over stages, per meta x skill).
// Mechanism: job key = stage|hero|seed|meta|skill|maxTime; job order: seed outermost, then stage, hero, meta, skill (deterministic, every cell gets seed 1 first).
//   Relative strength: a hero minus the mean of every hero run on the same stage, seed, meta and skill (paired tuples, seeded bootstrap CI).
//   --jobs child processes each run runOne sequentially per job message. Each result, stamped with the child's code hash, is appended to results.jsonl as it arrives (crash-safe);
//   errors go to errors.jsonl (dropped once their key has a result); meta.json holds cfg, code hash, git HEAD (-dirty when the tree has changes) and sessions. Code hash: sha1 of
//   tools/bot-brain.js, tools/bot.js, the runner and every tools/sim.js FILE. At the end: summary.json, report.html (tools/bench-report.js; self-contained, file://) and stdout tables.
//   Exit 1 when the runner fails to load or no job produced a result; 2 on bad flags or a refused resume. Results without skill / hash load as skill 1, hash 'unknown'.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const Report = require('./bench-report.js');
const REPO = path.join(__dirname, '..');
const LOW = os.constants.priority.PRIORITY_LOW;
const BOOT_N = 2000, MIN_PAIRS = 8, SATURATED = 0.95;

// ---------------- arguments ----------------
function parseArgs(argv) {
  const VAL = new Set(['stages', 'heroes', 'seeds', 'seed0', 'meta', 'skill', 'jobs', 'maxTime', 'out', 'resume', 'report', 'runner', 'tables']);
  const BOOL = new Set(['quick', 'low', 'force', 'help']);
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error('unexpected argument: ' + argv[i]);
    const k = m[1];
    if (BOOL.has(k)) { o[k] = true; continue; }
    if (!VAL.has(k)) throw new Error('unknown flag --' + k);
    const v = m[2] !== undefined ? m[2] : argv[++i];
    if (v === undefined || v === '') throw new Error('--' + k + ' needs a value');
    o[k] = v;
  }
  if (o.tables !== undefined && o.tables !== 'pooled' && o.tables !== 'all') throw new Error('--tables is pooled or all');
  return o;
}
const DEFAULTS = { stages: 'all', heroes: 'all', seeds: 8, seed0: 1, meta: 'none', skill: '1,0.3', maxTime: 1080, runner: 'tools/bot.js' };
function cfgFrom(flags, base) {
  // a stored cfg without skill / runner predates them: those benches ran skill 1 on tools/bot.js
  const c = Object.assign({}, DEFAULTS, base ? { skill: '1', runner: DEFAULTS.runner } : {}, base || {});
  if (flags.quick) { c.seeds = 2; c.stages = '0'; }
  for (const k of ['stages', 'heroes', 'meta', 'skill']) if (flags[k] !== undefined) c[k] = flags[k];
  for (const k of ['seeds', 'seed0', 'maxTime']) if (flags[k] !== undefined) {
    const v = Number(flags[k]);
    if (!Number.isInteger(v) || v < (k === 'seed0' ? 0 : 1)) throw new Error('--' + k + ' needs an integer');
    c[k] = v;
  }
  if (flags.runner !== undefined) c.runner = path.relative(REPO, resolveRunner(flags.runner)).replace(/\\/g, '/');
  return c;
}
const list = (s) => String(s).split(',').map(x => x.trim()).filter(Boolean);
// Runner module path: as given (relative to the cwd), else relative to tools/.
function resolveRunner(p) {
  for (const base of [process.cwd(), __dirname]) for (const f of [p, p + '.js']) { const a = path.resolve(base, f); if (fs.existsSync(a) && fs.statSync(a).isFile()) return a; }
  throw new Error('--runner: no module ' + p);
}

// ---------------- matrix ----------------
function buildJobs(c, ED) {
  const stages = c.stages === 'all' ? ED.STAGES.map((s, i) => i) : list(c.stages).map(s => {
    const i = /^\d+$/.test(s) ? +s : ED.STAGE_IDS.indexOf(s);
    if (!ED.STAGES[i]) throw new Error('unknown stage ' + s);
    return i;
  });
  const heroes = c.heroes === 'all' ? ED.HERO_IDS.slice() : list(c.heroes);
  for (const h of heroes) if (!ED.HEROES[h]) throw new Error('unknown hero ' + h + ' (' + ED.HERO_IDS.join(', ') + ')');
  const metas = list(c.meta);
  for (const m of metas) if (m !== 'none' && m !== 'max') throw new Error('--meta is none, max or none,max');
  const skills = list(c.skill).map(Number);
  if (!skills.length || skills.some(s => !(s >= 0 && s <= 1))) throw new Error('--skill is a list of numbers in 0..1');
  const jobs = [];
  for (let s = c.seed0; s < c.seed0 + c.seeds; s++) for (const st of stages) for (const h of heroes) for (const m of metas) for (const sk of skills) {
    jobs.push({ stage: st, cls: h, seed: s, meta: m, skill: sk, maxTime: c.maxTime });
  }
  return jobs;
}
const keyOf = (r) => [r.stage, r.cls, r.seed, r.meta, r.skill, r.maxTime].join('|');
// Pairing tuple: a hero's runs pair with the other heroes' runs on the same stage, seed, meta and skill.
const tupleOf = (r) => [r.stage, r.seed, r.meta, r.skill].join('|');

// ---------------- files ----------------
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* torn last line after a crash */ }
  }
  return out;
}
// Results from before skill / code hash existed ran skill 1 on unknown code.
function legacy(r) { if (r.skill === undefined) r.skill = 1; if (!r.hash) r.hash = 'unknown'; return r; }
function readRuns(dir) {
  const byKey = new Map();
  for (const r of readJsonl(path.join(dir, 'results.jsonl'))) byKey.set(keyOf(legacy(r)), r);
  return [...byKey].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(e => e[1]);   // key order: float sums (means) do not depend on the file order
}
const readErrors = (dir) => readJsonl(path.join(dir, 'errors.jsonl')).filter(e => e && e.cfg).map(e => (legacy(e.cfg), e));
// Rewrites errors.jsonl without errors whose job key now has a result; returns the remaining errors.
function pruneErrors(dir, runs) {
  const file = path.join(dir, 'errors.jsonl');
  if (!fs.existsSync(file)) return [];
  const done = new Set(runs.map(keyOf)), all = readErrors(dir), keep = all.filter(e => !done.has(keyOf(e.cfg)));
  if (keep.length !== all.length) fs.writeFileSync(file, keep.map(e => JSON.stringify(e) + '\n').join(''));
  return keep;
}
const readMeta = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (e) { return null; } };
const writeMeta = (dir, meta) => fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
function git(args) {
  try { return cp.execSync('git ' + args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { return null; }
}
function gitInfo() {
  const head = (git('rev-parse --short HEAD') || '?').trim(), st = git('status --porcelain'), dirty = st === null ? null : st.trim() !== '';
  return { head, dirty, commit: head + (dirty ? '-dirty' : '') };
}
// sha1 (12 hex) over the bot, the runner and the sim sources (relative path + contents each).
function codeHash(runner) {
  const { FILES, ROOT } = require('./sim.js');
  const files = [path.join(__dirname, 'bot-brain.js'), path.join(__dirname, 'bot.js')];
  if (runner && !files.includes(path.resolve(runner))) files.push(path.resolve(runner));
  const h = crypto.createHash('sha1');
  for (const f of files.concat(FILES.map(x => path.join(ROOT, x)))) {
    h.update(path.relative(REPO, f).replace(/\\/g, '/') + '\0');
    try { h.update(fs.readFileSync(f)); } catch (e) { h.update('<missing>'); }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
function helpText() {
  const out = [];
  for (const l of fs.readFileSync(__filename, 'utf8').split(/\r?\n/)) { if (!l.startsWith('//')) break; out.push(l.slice(3)); }
  return out.join('\n');
}

// ---------------- main ----------------
function main() {
  let flags;
  try { flags = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (flags.help) { console.log(helpText()); return; }
  const ED = require('./sim.js').load(), tables = flags.tables || 'pooled';
  if (flags.report) {
    const dir = path.resolve(flags.report);
    if (!fs.existsSync(path.join(dir, 'results.jsonl'))) { console.error('no results.jsonl in ' + dir); process.exit(2); }
    finish(dir, ED, tables);
    return;
  }
  const dir = path.resolve(flags.resume || flags.out || path.join(REPO, 'bench-out', stamp()));
  const old = flags.resume ? readMeta(dir) : null;
  if (flags.resume && !old) { console.error('no meta.json in ' + dir); process.exit(2); }
  let c, jobs, runner;
  try { c = cfgFrom(flags, old && old.cfg); runner = path.resolve(REPO, c.runner); jobs = buildJobs(c, ED); } catch (e) { console.error(e.message); process.exit(2); }
  const hash = codeHash(runner), gi = gitInfo();
  if (old) {
    const why = [];
    if (old.cfg && old.cfg.maxTime !== undefined && old.cfg.maxTime !== c.maxTime) why.push('maxTime ' + c.maxTime + ' differs from the stored ' + old.cfg.maxTime);
    if ((old.hash || 'unknown') !== hash) why.push('code hash ' + hash + ' differs from the stored ' + (old.hash || 'unknown') + ' (results would mix code versions)');
    if (why.length && !flags.force) { console.error('resume refused: ' + why.join('; ') + '. --force continues anyway.'); process.exit(2); }
    if (why.length) console.error('warning (--force): ' + why.join('; '));
  }
  fs.mkdirSync(dir, { recursive: true });
  const resFile = path.join(dir, 'results.jsonl');
  if (fs.existsSync(resFile) && fs.statSync(resFile).size && !fs.readFileSync(resFile, 'utf8').endsWith('\n')) fs.appendFileSync(resFile, '\n');   // seal a torn last line
  const have = readRuns(dir), done = new Set(have.map(keyOf));
  pruneErrors(dir, have);
  const todo = jobs.filter(j => !done.has(keyOf(j)));
  const cores = os.cpus().length, low = !!flags.low;
  let nj = Math.max(1, low ? Math.floor(cores / 2) : cores - 1);
  if (flags.jobs !== undefined) {
    nj = Number(flags.jobs);
    if (!Number.isInteger(nj) || nj < 1) { console.error('--jobs needs an integer >= 1'); process.exit(2); }
  }
  nj = Math.max(1, Math.min(nj, todo.length));
  const meta = old || { created: new Date().toISOString(), sessions: [] };
  Object.assign(meta, { cfg: c, hash, head: gi.head, dirty: gi.dirty, commit: gi.commit });
  const sess = { start: new Date().toISOString(), end: null, runs: 0, jobs: nj, low: low || undefined, commit: gi.commit, hash, runner: c.runner, forced: flags.force || undefined };
  meta.sessions.push(sess);
  writeMeta(dir, meta);
  console.log('bench -> ' + dir);
  console.log(jobs.length + ' jobs, ' + (jobs.length - todo.length) + ' already done, ' + todo.length + ' to run on ' + nj + ' processes' + (low ? ' (low priority)' : '') +
    '  code ' + hash + ' @ ' + gi.commit + (c.runner !== DEFAULTS.runner ? '  runner ' + c.runner : ''));
  if (!todo.length) { sess.end = new Date().toISOString(); writeMeta(dir, meta); finish(dir, ED, tables); return; }
  runPool(dir, runner, todo, nj, low, meta, sess, () => {
    finish(dir, ED, tables);
    if (!sess.runs) { console.error('no job produced a result (' + todo.length + ' jobs; see errors.jsonl)'); process.exit(1); }
  });
}

const ECHO = ['stage', 'cls', 'seed', 'meta', 'skill', 'maxTime'];
function runPool(dir, runner, todo, nj, low, meta, sess, onDone) {
  const resFile = path.join(dir, 'results.jsonl'), errFile = path.join(dir, 'errors.jsonl');
  const t0 = Date.now(), total = todo.length, tty = process.stdout.isTTY, nl = tty ? '\n' : '';
  let next = 0, finished = 0, errors = 0, live = 0, closing = false, lastLog = 0;
  const warned = new Set(), kids = new Set();
  const warn = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.error(nl + 'warning: ' + msg); } };
  const progress = () => {
    const el = (Date.now() - t0) / 1000, rate = finished / Math.max(el, 1e-3);
    const eta = rate > 0 ? (total - finished) / rate : 0;
    const line = finished + '/' + total + '  ' + (rate * 60).toFixed(1) + ' runs/min  ETA ' + fmtDur(eta) + '  elapsed ' + fmtDur(el) + (errors ? '  errors ' + errors : '');
    if (tty) process.stdout.write('\r' + line + '   ');
    else if (finished === total || Date.now() - lastLog >= 10000) { lastLog = Date.now(); console.log(line); }
  };
  const feed = (k) => {
    if (closing) return;
    if (next >= total) { k.job = null; k.send({ exit: true }); return; }
    const id = next++;
    k.job = { id, cfg: todo[id] };
    k.send(k.job);
  };
  // The runner could not load (child exited before ready): stop everything, exit 1.
  const fatal = (msg) => {
    closing = true;
    for (const k of kids) k.kill();
    sess.end = new Date().toISOString();
    writeMeta(dir, meta);
    console.error(nl + 'runner failed to start: ' + msg);
    process.exit(1);
  };
  const spawn = () => {
    const k = cp.fork(__filename, ['--child', runner].concat(low ? ['--low'] : []), { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    if (low) try { os.setPriority(k.pid, LOW); } catch (e) { /* the child sets its own */ }
    k.ready = false; k.job = null;
    kids.add(k); live++;
    k.on('message', (m) => {
      if (m.fatal) { k.fatal = m.fatal; return; }
      if (m.ready) {
        k.ready = true; k.hash = m.hash;
        if (m.fake) sess.fake = true;
        if (m.hash !== meta.hash) warn('hash', 'child code hash ' + m.hash + ' differs from ' + meta.hash + ' (files changed since start): results are stamped per child');
        feed(k);
        return;
      }
      const cfg = todo[m.id];
      if (m.error) {
        errors++;
        fs.appendFileSync(errFile, JSON.stringify({ cfg, error: m.error, hash: k.hash }) + '\n');
        console.error(nl + 'error ' + keyOf(cfg) + ': ' + m.error.split('\n')[0]);
      } else {
        const r = Object.assign({ maxTime: cfg.maxTime }, m.result, { hash: k.hash });
        for (const f of ECHO) {
          const a = r[f] === undefined ? null : r[f], b = cfg[f] === undefined ? null : cfg[f];
          if (a !== b) warn('echo-' + f, 'runner echoed ' + f + ' ' + JSON.stringify(a) + ' for ' + JSON.stringify(b) + ': the result keys under the echoed value');
        }
        fs.appendFileSync(resFile, JSON.stringify(r) + '\n');
        sess.runs++;
      }
      finished++;
      sess.end = new Date().toISOString();
      writeMeta(dir, meta);
      progress();
      feed(k);
    });
    // 'close' follows the drained IPC channel, so a fatal message is in before it.
    k.on('close', (code) => {
      kids.delete(k); live--;
      if (closing) return;
      if (!k.ready) { fatal(k.fatal || 'child exited with code ' + code + ' before it was ready'); return; }
      if (k.job) {
        // crashed mid-job: record it, replace the process
        errors++; finished++;
        fs.appendFileSync(errFile, JSON.stringify({ cfg: k.job.cfg, error: 'child exited with code ' + code, hash: k.hash }) + '\n');
        console.error(nl + 'child crashed on ' + keyOf(k.job.cfg));
        progress();
        if (next < total) spawn();
      }
      if (!live) {
        if (tty) process.stdout.write('\n');
        sess.end = new Date().toISOString();
        writeMeta(dir, meta);
        onDone();
      }
    });
  };
  process.on('SIGINT', () => {
    closing = true;
    for (const k of kids) k.kill();
    sess.end = new Date().toISOString();
    writeMeta(dir, meta);
    console.log('\ninterrupted: ' + sess.runs + ' results kept; continue with --resume ' + dir);
    process.exit(130);
  });
  for (let i = 0; i < nj; i++) spawn();
}

// ---------------- aggregation ----------------
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, cen = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, cen - half), Math.min(1, cen + half)];
}
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const num = (x) => typeof x === 'number' && isFinite(x);
const rnd = (x, d) => num(x) ? Math.round(x * d) / d : null;
const r3 = (x) => rnd(x, 1000), r2 = (x) => rnd(x, 100), r1 = (x) => rnd(x, 10);
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Mean of xs with a 95% percentile-bootstrap CI (BOOT_N resamples, RNG seeded by key): { d, lo, hi, n, sig (CI excludes 0) } | null.
function boot(xs, key, round) {
  const n = xs.length;
  if (!n) return null;
  const d = mean(xs);
  if (n < 2) return { d: round(d), lo: null, hi: null, n, sig: false };
  const rng = mulberry(fnv(key)), ms = new Float64Array(BOOT_N);
  for (let b = 0; b < BOOT_N; b++) { let s = 0; for (let i = 0; i < n; i++) s += xs[(rng() * n) | 0]; ms[b] = s / n; }
  ms.sort();
  const lo = ms[Math.floor(0.025 * (BOOT_N - 1))], hi = ms[Math.ceil(0.975 * (BOOT_N - 1))];
  return { d: round(d), lo: round(lo), hi: round(hi), n, sig: lo > 1e-9 || hi < -1e-9 };
}

// Per-run metrics. Boss kills map to schedule slots by id; a kill whose id is no slot's (a multi-body boss's last body, e.g. 'twinhammer') takes the latest still-empty
// slot spawned at or before it. TTK = kill time - spawn time (the slot's schedule time when the spawn is unknown). final: TTK of the last slot in a won run.
function derive(r, ED) {
  if (r._d) return r._d;
  const sched = ED.STAGES[r.stage].bosses, slots = sched.map(() => null), rest = [];
  for (const b of r.bosses || []) { const i = sched.findIndex(s => s.id === b.id); if (i < 0) rest.push(b); else put(i, b); }
  for (const b of rest) { let j = -1; for (let i = 0; i < sched.length; i++) if (!slots[i] && sched[i].t <= b.at) j = i; if (j >= 0) put(j, b); }
  function put(i, b) { const ttk = b.at - (num(b.spawn) ? b.spawn : sched[i].t); if (!slots[i] || b.at > slots[i].at) slots[i] = { at: b.at, ttk }; }
  let hurt = r.hurt;
  if (!num(hurt)) { hurt = 0; for (const v of Object.values(r.taken || {})) hurt += v || 0; }
  const last = slots[slots.length - 1];
  return (r._d = { slots, final: r.won && last ? last.ttk : null, hurtMin: r.time > 0 ? hurt / r.time * 60 : null, killsMin: r.time > 0 ? (r.kills || 0) / r.time * 60 : null });
}
// Fraction of all damage dealt (weapon and class skill) by root weapon id and its Forms.
function share(r, id, ED) {
  if (!id || !r.dealt) return null;
  let tot = 0;
  for (const v of Object.values(r.dealt)) tot += v || 0;
  if (!(tot > 0)) return null;
  let d = r.dealt[id] || 0;
  for (const f of ED.weaponForms(id)) d += r.dealt[f.id] || 0;
  return d / tot;
}
const subject = (r, ED) => ED.HEROES[r.cls].sig;   // the weapon a run measures: the hero's signature (root id; Forms fold in)

function stats(runs, ED, nSlots) {
  const n = runs.length, wins = runs.filter(r => r.won).length, [lo, hi] = wilson(wins, n), D = runs.map(r => derive(r, ED));
  const shares = runs.map(r => share(r, subject(r, ED), ED)).filter(num);
  const formT = runs.map(r => r.evolved && r.evolved[subject(r, ED)]).filter(num);
  const lost = runs.filter(r => !r.won), pick = (f) => D.map(f).filter(num);
  const slotTTK = [];
  for (let i = 0; i < nSlots; i++) slotTTK.push(r1(mean(pick(d => d.slots[i] && d.slots[i].ttk))));
  return { n, wins, win: r3(n ? wins / n : null), lo: r3(lo), hi: r3(hi), finalTTK: r1(mean(pick(d => d.final))), slotTTK,
    hurtMin: r2(mean(pick(d => d.hurtMin))), hpLow: r3(mean(runs.map(r => r.hpLow).filter(num))), lostN: lost.length, lostTime: r1(mean(lost.map(r => r.time).filter(num))),
    killsMin: Math.round(mean(pick(d => d.killsMin)) || 0), level: r1(mean(runs.map(r => r.level).filter(num))),
    share: r3(mean(shares)), formRate: r3(n ? formT.length / n : null), formTime: r1(mean(formT)) };
}

// Paired deltas of hero k over the tuples in tup (tuple -> Map(cls -> run)), for win, final TTK and hurt/min:
// rel = k - mean of every hero (k included) at the same tuple, where at least 2 heroes have a value. A metric pairs only where both sides have a value.
const PM = { win: { f: (r) => r.won ? 1 : 0, round: r3 }, ttk: { f: (r, ED) => derive(r, ED).final, round: r1 }, hurt: { f: (r, ED) => derive(r, ED).hurtMin, round: r2 } };
function paired(tup, k, ED, seedKey) {
  const out = { rel: {} };
  for (const [m, P] of Object.entries(PM)) {
    const xr = [];
    for (const [, hs] of tup) {
      const r = hs.get(k);
      if (!r) continue;
      const v = P.f(r, ED);
      if (!num(v)) continue;
      const all = [];
      for (const [, o] of hs) { const ov = P.f(o, ED); if (num(ov)) all.push(ov); }
      if (all.length >= 2) xr.push(v - mean(all));
    }
    out.rel[m] = boot(xr, seedKey + '|rel|' + m, P.round);
  }
  return out;
}

// One report group: runs of one meta x skill x maxTime on one stage (stage >= 0) or pooled over stages (stage -1).
// g.rows: one per hero (stats + rel); g.cells['cls|stage']: per hero x stage (rel paired over that stage's tuples).
function aggregate(runs, stage, sel, ED, mixedMax) {
  const st = stage >= 0 ? ED.STAGES[stage] : null, stIds = [...new Set(runs.map(r => r.stage))].sort((a, b) => a - b);
  const nSlots = Math.max(...stIds.map(s => ED.STAGES[s].bosses.length));
  const label = (st ? st.name : 'All stages') + ' · meta ' + sel.meta + ' · skill ' + sel.skill + (mixedMax ? ' · max ' + Report.mmss(sel.maxTime) : '');
  const g = Object.assign({ key: [stage, sel.meta, sel.skill, sel.maxTime].join('|'), stage, stageId: st ? st.id : 'all', label }, sel, { n: runs.length, slots: nSlots });
  g.overall = stats(runs, ED, nSlots);
  g.saturated = g.overall.win >= SATURATED;
  const byH = new Map(), byCell = new Map(), tup = new Map();
  for (const r of runs) {
    const t = tupleOf(r);
    if (!byH.has(r.cls)) byH.set(r.cls, []);
    byH.get(r.cls).push(r);
    const ck = r.cls + '|' + r.stage;
    if (!byCell.has(ck)) byCell.set(ck, []);
    byCell.get(ck).push(r);
    if (!tup.has(t)) tup.set(t, new Map());
    tup.get(t).set(r.cls, r);
  }
  const tuples = [...tup].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));   // sorted: bootstrap input order is independent of the results file order
  const stageTuples = new Map();
  for (const e of tuples) { const s = e[1].values().next().value.stage; if (!stageTuples.has(s)) stageTuples.set(s, []); stageTuples.get(s).push(e); }
  g.rows = [];
  for (const [k, rs] of byH) {
    const sig = ED.HEROES[k].sig;
    g.rows.push(Object.assign({ cls: k, name: ED.HEROES[k].name, weapon: sig, wname: ED.WEAPONS[sig].name }, stats(rs, ED, nSlots), paired(tuples, k, ED, g.key + '|' + k)));
  }
  const asc = (a, b) => (num(a) ? (num(b) ? a - b : -1) : num(b) ? 1 : 0);
  g.rows.sort((a, b) => (b.win - a.win) || (b.lo - a.lo) || asc(a.finalTTK, b.finalTTK) || asc(a.hurtMin, b.hurtMin) || a.cls.localeCompare(b.cls));
  g.cells = {};
  for (const [ck, rs] of [...byCell].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const [cls, sn] = ck.split('|'), s = stats(rs, ED, nSlots), p = paired(stageTuples.get(+sn) || [], cls, ED, g.key + '|' + ck);
    g.cells[ck] = { n: s.n, win: s.win, finalTTK: s.finalTTK, hurtMin: s.hurtMin, lostTime: s.lostTime, share: s.share, formRate: s.formRate, rel: p.rel };
  }
  g.heroes = ED.HERO_IDS.filter(h => runs.some(r => r.cls === h));
  g.stages = stIds.map(s => ({ i: s, id: ED.STAGES[s].id, name: ED.STAGES[s].name }));
  const deaths = new Map();
  for (const r of runs) if (!r.won) { const d = r.death || 'timeout'; deaths.set(d, (deaths.get(d) || 0) + 1); }
  const lost = runs.length - g.overall.wins;
  g.deaths = [...deaths].map(([cause, n]) => ({ cause, n, pct: r3(n / Math.max(1, lost)) })).sort((a, b) => b.n - a.n || a.cause.localeCompare(b.cause));
  // Damage taken by source over all runs: top 12 by share, the rest folded into 'other'.
  const taken = new Map();
  let takenTot = 0;
  for (const r of runs) for (const [k, v] of Object.entries(r.taken || {})) { taken.set(k, (taken.get(k) || 0) + v); takenTot += v; }
  const tk = [...taken].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (tk.length > 13) tk.splice(12, tk.length, ['other', tk.slice(12).reduce((a, x) => a + x[1], 0)]);
  g.taken = tk.map(([cause, d]) => ({ cause, perRun: Math.round(d / Math.max(1, runs.length)), pct: r3(d / Math.max(1, takenTot)) }));
  // Boss funnel by schedule slot, each run against its own stage's schedule: reached = lasted to the slot's spawn time or killed it; killed = the slot's boss died.
  g.funnel = [];
  for (let i = 0; i < nSlots; i++) {
    let reached = 0, killed = 0;
    const ttk = [];
    for (const r of runs) {
      const b = ED.STAGES[r.stage].bosses[i], kill = derive(r, ED).slots[i];
      if (!b) continue;
      if (kill || r.time >= b.t) reached++;
      if (kill) { killed++; ttk.push(kill.ttk); }
    }
    const ts = [...new Set(stIds.map(s => ED.STAGES[s].bosses[i] && ED.STAGES[s].bosses[i].t))], fin = i === nSlots - 1;
    const lb = st ? (fin ? 'Final boss' : 'Boss ' + (i + 1)) + ' (' + st.bosses[i].id + ')' : 'Slot ' + (i + 1) + (fin ? ' / final' : '') + " (each stage's schedule)";
    g.funnel.push({ slot: i, label: lb, t: ts.length === 1 ? ts[0] : null, reached, killed, ttk: r1(mean(ttk)) });
  }
  return g;
}

function summarize(dir, ED, errs) {
  const runs = readRuns(dir), meta = readMeta(dir) || {};
  const errors = errs || readErrors(dir);
  const uniq = (f, cmp) => [...new Set(runs.map(f))].sort(cmp);
  const metas = uniq(r => r.meta, (a, b) => (a === 'none' ? -1 : b === 'none' ? 1 : a.localeCompare(b)));
  const skills = uniq(r => r.skill, (a, b) => b - a), maxes = uniq(r => r.maxTime, (a, b) => a - b), stages = uniq(r => r.stage, (a, b) => a - b);
  const groups = [];
  for (const m of metas) for (const sk of skills) for (const mt of maxes) {
    const sel = { meta: m, skill: sk, maxTime: mt }, rs0 = runs.filter(r => r.meta === m && r.skill === sk && r.maxTime === mt);
    for (const s of stages) { const rs = rs0.filter(r => r.stage === s); if (rs.length) groups.push(aggregate(rs, s, sel, ED, maxes.length > 1)); }
    if (rs0.length && new Set(rs0.map(r => r.stage)).size > 1) groups.push(aggregate(rs0, -1, sel, ED, maxes.length > 1));
  }
  let wall = 0;
  for (const s of meta.sessions || []) if (s.end) wall += (Date.parse(s.end) - Date.parse(s.start)) / 1000;
  const cpuMs = runs.reduce((a, r) => a + (r.ms || 0), 0), hashes = {};
  for (const r of runs) hashes[r.hash] = (hashes[r.hash] || 0) + 1;
  const sess = meta.sessions || [];
  return {
    meta: { generated: new Date().toISOString(), created: meta.created, commit: meta.commit, commits: [...new Set(sess.map(s => s.commit))], hash: meta.hash || 'unknown', hashes,
      mixed: Object.keys(hashes).length > 1, legacy: hashes.unknown || 0, cfg: meta.cfg, sessions: sess, runs: runs.length, errors: errors.length, wall: Math.round(wall),
      avgRunMs: runs.length ? Math.round(cpuMs / runs.length) : null, fake: sess.some(s => s.fake), boot: BOOT_N, minPairs: MIN_PAIRS, saturated: SATURATED },
    heroes: ED.HERO_IDS.map(id => ({ id, name: ED.HEROES[id].name, sig: ED.HEROES[id].sig })),
    weapons: Object.fromEntries(ED.WEAPON_IDS.map(id => [id, ED.WEAPONS[id].name])),
    groups,
  };
}

function finish(dir, ED, tables) {
  const errs = pruneErrors(dir, readRuns(dir));
  const S = summarize(dir, ED, errs);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(S, null, 1));
  fs.writeFileSync(path.join(dir, 'report.html'), Report.build(S));
  printTables(S, tables || 'pooled');
  console.log('\n' + S.meta.runs + ' runs' + (S.meta.errors ? ', ' + S.meta.errors + ' errors (errors.jsonl)' : '') + ', wall ' + fmtDur(S.meta.wall));
  console.log('report: ' + path.join(dir, 'report.html'));
}

// ---------------- text output ----------------
function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + 'h' + String(m).padStart(2, '0') + 'm' : m + 'm') + String(x).padStart(2, '0') + 's';
}
const { mmss } = Report;
const pct = (x) => num(x) ? Math.round(x * 100) + '%' : '-';
const sgn = (x, f) => num(x) ? (x > 0 ? '+' : '') + f(x) : '-';
// Paired delta as "d [lo,hi]", then '~' below MIN_PAIRS pairs, else '*' when the CI excludes 0.
const dfmt = (p, f) => !p ? '-' : sgn(p.d, f) + (num(p.lo) ? ' [' + f(p.lo) + ',' + f(p.hi) + ']' : '') + (p.n < MIN_PAIRS ? '~' : p.sig ? '*' : '');
// Groups pooled over stages, plus single-stage groups whose selection has no pooled group.
function tableGroups(S, mode) {
  if (mode === 'all') return S.groups;
  const pooled = new Set(S.groups.filter(g => g.stage < 0).map(g => g.key.slice(g.key.indexOf('|'))));
  return S.groups.filter(g => g.stage < 0 || !pooled.has(g.key.slice(g.key.indexOf('|'))));
}
function printTables(S, mode) {
  const ip = (x) => String(Math.round(x * 100)), is = (x) => String(Math.round(x)), i1 = (x) => x.toFixed(1);
  const cols = [['hero', 10], ['n', 4], ['win', 5], ['95% CI', 9], ['finTTK', 6], ['hurt/m', 6], ['lostT', 5], ['rel dWin pt', 15], ['rel dTTK s', 15], ['rel dHurt/m', 17], ['dmg', 4], ['form', 4]];
  if (S.meta.mixed) console.log('\nMIXED CODE: results from ' + Object.keys(S.meta.hashes).length + ' code hashes (' + Object.entries(S.meta.hashes).map(([h, n]) => h + ' x' + n).join(', ') + ')');
  if (S.meta.legacy) console.log('\n' + S.meta.legacy + ' results predate skill / code hash: loaded as skill 1, hash unknown');
  for (const g of tableGroups(S, mode)) {
    console.log('\n' + g.label + '  (' + g.n + ' runs, win ' + pct(g.overall.win) + ')' + (g.saturated ? '  -- win % saturated: compare TTK / hurt' : ''));
    console.log(cols.map(([h, w], i) => i ? h.padStart(w) : h.padEnd(w)).join(' '));
    for (const s of g.rows) {
      const v = [s.cls, s.n, pct(s.win), pct(s.lo) + '-' + pct(s.hi), num(s.finalTTK) ? Math.round(s.finalTTK) + 's' : '-', num(s.hurtMin) ? s.hurtMin.toFixed(1) : '-', mmss(s.lostTime),
        dfmt(s.rel.win, ip), dfmt(s.rel.ttk, is), dfmt(s.rel.hurt, i1), pct(s.share), pct(s.formRate)];
      console.log(v.map((x, i) => i ? String(x).padStart(cols[i][1]) : String(x).padEnd(cols[i][1])).join(' '));
    }
  }
  console.log('\nrel = minus the mean of every hero on the same stage/seed/meta/skill (paired), 95% bootstrap CI, * = CI excludes 0, ~ = fewer than ' + MIN_PAIRS + ' pairs. form = runs that took a Form.');
}

// ---------------- entry ----------------
function child() {
  const runner = process.argv[3];
  if (process.argv[4] === '--low') try { os.setPriority(LOW); } catch (e) { /* not permitted: parent already tried on our pid */ }
  let mod;
  try {
    mod = require(runner);
    if (!mod || typeof mod.runOne !== 'function') throw new Error(runner + ' exports no runOne(cfg)');
  } catch (e) { process.send({ fatal: String(e && e.stack || e) }, () => process.exit(1)); return; }
  process.on('message', (m) => {
    if (m.cfg) {
      let res;
      try { res = { id: m.id, result: mod.runOne(m.cfg) }; } catch (e) { res = { id: m.id, error: String(e && e.stack || e) }; }
      process.send(res);
    }
    if (m.exit) process.exit(0);
  });
  process.send({ ready: true, hash: codeHash(runner), fake: !!mod.fake });
}

if (require.main === module) { if (process.argv[2] === '--child') child(); else main(); }
module.exports = { buildJobs, keyOf, tupleOf, wilson, boot, derive, summarize, helpText, mmss, codeHash, cfgFrom };
