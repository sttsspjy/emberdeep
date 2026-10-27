// Headless browser harness: boots the static game in an invisible Playwright browser and runs scripted scenarios against it. Never opens a visible window.
// Usage: node tools/browse.js [smoke|crowdN ...] [--scen=smoke,crowd600] [--cls=knight,...] [--seconds=N] [--browser=chromium|firefox] [--viewport=1920x1080] [--outdir=DIR] [--seed=1] [--software] [--quality=high|low] [--timeout=300]
//   smoke: boots, then for each hero (--cls, default all 7) starts a solo stage-1 run, drives it ~--seconds (10) s (circling, Q / E, dash, first card picked) and saves a PNG; fails on any page or console error.
//   crowdN: a knight run (god cheat) held at N live foes around the hero; after 2 s of warm-up measures --seconds (6) s of frame time (rAF interval) and Render.frame ms: p50 / p95 / max.
// Mechanism: a read-only http server on 127.0.0.1 (random port) serves the repo; Playwright resolves via require('playwright'), else the npx cache (%LOCALAPPDATA%\npm-cache\_npx).
//   The page runs with a seeded Math.random. Output: a table on stdout, PNGs and result-<browser>.json in --outdir (default <tmp>/wickdeep-browse). Exit 0 pass, 1 scenario failure, 2 harness error.
// Extending: add a scenario function scenX() returning newResult(...) and route it in main(); in-page helpers live on window.__BR (pageBoot).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

// ---------------- arguments ----------------
const FLAGS = { scen: 's', cls: 's', browser: 's', viewport: 's', outdir: 's', root: 's', quality: 's', seconds: 'n', seed: 'n', timeout: 'n', software: 'b', json: 'b', help: 'b' };
class Fail extends Error { constructor(msg, code) { super(msg); this.code = code || 2; } }
const HEROES = ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell'];
function parseArgs(argv) {
  const o = { scen: '', cls: HEROES.join(','), browser: 'chromium', viewport: '1920x1080', outdir: path.join(os.tmpdir(), 'wickdeep-browse'), root: path.resolve(__dirname, '..'), quality: 'high', seconds: 0, seed: 1, timeout: 300 };
  const pos = [];
  for (const a of argv) {
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m || !FLAGS[m[1]]) throw new Fail('unknown argument: ' + a);
    const k = m[1], t = FLAGS[k];
    if (t === 'b') o[k] = true;
    else if (m[2] === undefined || m[2] === '') throw new Fail('--' + k + ' needs a value');
    else if (t === 'n') { const v = Number(m[2]); if (!isFinite(v)) throw new Fail('--' + k + ' needs a number'); o[k] = v; }
    else o[k] = m[2];
  }
  o.scens = (o.scen ? o.scen.split(',') : []).concat(pos).map(s => s.trim()).filter(Boolean);
  if (!o.scens.length) o.scens = ['smoke'];
  for (const s of o.scens) if (!/^(smoke|crowd\d{1,4})$/.test(s)) throw new Fail('unknown scenario ' + s + ' (smoke, crowdN)');
  if (!['chromium', 'firefox'].includes(o.browser)) throw new Fail('--browser is chromium or firefox');
  const vp = /^(\d{3,5})x(\d{3,5})$/.exec(o.viewport);
  if (!vp) throw new Fail('--viewport is WxH');
  o.vw = +vp[1]; o.vh = +vp[2];
  o.classes = o.cls.split(',').map(s => s.trim()).filter(c => HEROES.includes(c));
  o.root = path.resolve(o.root);
  return o;
}

// ---------------- playwright ----------------
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not installed next to the repo */ }
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const store = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(la, 'ms-playwright');
  const npx = path.join(la, 'npm-cache', '_npx');
  const cands = [];
  let dirs = [];
  try { dirs = fs.readdirSync(npx); } catch (e) { /* no npx cache */ }
  for (const d of dirs) {
    const dir = path.join(npx, d, 'node_modules', 'playwright');
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    let score = 0;
    try {
      const bj = JSON.parse(fs.readFileSync(path.join(npx, d, 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
      for (const b of bj.browsers) if (/^(chromium-headless-shell|firefox)$/.test(b.name) && fs.existsSync(path.join(store, b.name.replace(/-/g, '_') + '-' + b.revision))) score++;
    } catch (e) { /* unreadable browsers.json */ }
    cands.push({ dir, score, mt: fs.statSync(dir).mtimeMs });
  }
  cands.sort((a, b) => b.score - a.score || b.mt - a.mt);
  for (const c of cands) { try { return require(c.dir); } catch (e) { /* next */ } }
  throw new Fail('playwright not found. Install once outside the repo: npx --yes playwright install chromium firefox');
}

// ---------------- static server ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serve(root) {
  const missing = new Set();
  const srv = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let p;
    try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
    if (p.includes('\0')) { res.writeHead(400); res.end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(root, '.' + p);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { missing.add(p); res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port, missing })); });
}

// ---------------- in-page harness (serialised into the page before the game scripts; may not use Node variables) ----------------
function pageBoot(cfg) {
  let ms = (cfg.seed >>> 0) || 1;
  Math.random = () => { ms = (ms + 0x6d2b79f5) | 0; let t = Math.imul(ms ^ (ms >>> 15), 1 | ms); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const BR = window.__BR = { drive: false, crowd: 0, frames: [], renderMs: [] };
  const ED = () => window.ED;
  BR.boot = () => new Promise((resolve, reject) => {
    const t0 = performance.now();
    const poll = () => {
      const E = ED();
      if (E && E.App && E.App.state === 'title') {
        // scripted input: wraps ED.Input.read while BR.drive is on
        const I = E.Input, read = I.read;
        I.read = () => {
          const o = read();
          if (!BR.drive) return o;
          const t = performance.now() / 1000, me = E.Game.view && E.Game.view.me;
          o.mx = Math.cos(t * 0.9); o.my = Math.sin(t * 0.9);
          o.q = Math.random() < 0.02; o.e = Math.random() < 0.015; o.dash = Math.random() < 0.01;
          o.pick = me && me.offer ? 1 : 0;
          return o;
        };
        resolve({ gl: !!(E.Post && E.Post.ready), soft: !!(E.Post && E.Post.soft), atlas: !!E.Atlas.ok });
        return;
      }
      if (performance.now() - t0 > 20000) { reject(new Error('boot timeout: App.state ' + (E && E.App ? E.App.state : 'none'))); return; }
      setTimeout(poll, 50);
    };
    poll();
  });
  BR.settings = (q) => { const E = ED(); E.App.settings.quality = q; E.App.applySettings(); };
  BR.start = (cls, stage, cheats) => { const E = ED(); if (!E.App.hasProfile) E.App.createProfile('Bot'); E.App.startSolo({ cls, stage: stage | 0, seed: cfg.seed, cheats: cheats || null }); BR.drive = true; return E.App.state; };
  BR.state = () => { const E = ED(), w = E.Game.w, me = E.Game.view && E.Game.view.me; return { app: E.App.state, time: w ? +w.time.toFixed(1) : 0, foes: w ? w.foes.length : 0, kills: w ? w.kills : 0, level: w ? w.level : 0, hp: me ? Math.round(me.hp) : 0, weapons: me ? me.weapons.map(x => x.id + x.lvl) : [] }; };
  BR.stop = () => { BR.drive = false; BR.crowd = 0; const E = ED(); if (E.App.state === 'run') E.App.quitRun(); };
  // Keeps n foes alive on a ring 120-330 px around the hero (spawned directly; foes stay put when far by recycling).
  BR.hold = (n) => {
    BR.crowd = n;
    clearInterval(BR.holdT);
    BR.holdT = setInterval(() => {
      const E = ED(), w = E.Game.w; if (!w || !BR.crowd) return;
      const me = w.heroes[0], ids = w.sdef.timeline[0].roster.map(r => r[0]);
      for (let k = 0; w.foes.length < BR.crowd && k < 200; k++) { const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 210, x = me.x + Math.cos(a) * d, y = me.y + Math.sin(a) * d; if (!E.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ids[k % ids.length], x, y, { hpMul: 40 }); }
    }, 100);
  };
  // Frame time (rAF interval) and Render.frame ms over `msec`: p50 / p95 / max.
  BR.measure = (msec) => new Promise((resolve) => {
    const E = ED(), fr = [], rm = [], fo = [];
    let last = performance.now();
    const t0 = last;
    const step = (now) => {
      fr.push(now - last); last = now; rm.push(E.Render.ms); fo.push(E.Game.w ? E.Game.w.foes.length : 0);
      if (now - t0 < msec) requestAnimationFrame(step);
      else {
        const st = (a) => { const s = a.slice().sort((x, y) => x - y); return { p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
        resolve({ frames: fr.length, frame: st(fr), render: st(rm), foes: Math.round(fo.reduce((a, b) => a + b, 0) / fo.length), usePost: E.Render.usePost, canvas: [E.Render.canvas.width, E.Render.canvas.height, E.Render.bw, E.Render.bh, E.Render.scale] });
      }
    };
    requestAnimationFrame(step);
  });
}

// ---------------- run context ----------------
const S = { opt: null, pw: null, browser: null, server: null, closing: false };
const log = (...a) => console.error(...a);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function cleanup() {
  if (S.closing) return;
  S.closing = true;
  try { if (S.browser) await S.browser.close(); } catch (e) { /* already gone */ }
  try { if (S.server) S.server.srv.close(); } catch (e) { /* already closed */ }
}
async function launch() {
  const o = S.opt, opts = { headless: true };
  if (o.browser === 'chromium') {
    opts.args = ['--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
    if (!o.software) opts.args.push('--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist');
  } else opts.firefoxUserPrefs = { 'media.volume_scale': '0.0', 'layout.frame_rate': 60 };
  try { return await S.pw[o.browser].launch(opts); } catch (e) { throw new Fail('could not launch headless ' + o.browser + ': ' + String(e.message).split('\n')[0]); }
}
// A fresh context and page with the harness injected; page errors and console errors are collected.
async function openPage() {
  const o = S.opt;
  const ctx = await S.browser.newContext({ viewport: { width: o.vw, height: o.vh }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'en-US' });
  await ctx.addInitScript({ content: '(' + pageBoot.toString() + ')(' + JSON.stringify({ seed: o.seed }) + ')' });
  const local = S.server.base;
  await ctx.route((u) => u.protocol.startsWith('http') && u.origin !== local, (route) => route.abort('blockedbyclient'));
  const page = await ctx.newPage();
  const errors = [];
  const add = (kind, text) => { if (errors.length < 40) errors.push({ kind, text: String(text).replace(/\s+/g, ' ').slice(0, 400) }); };
  page.on('pageerror', (e) => add('pageerror', (e && e.stack) || e));
  page.on('crash', () => add('crash', 'page crashed'));
  page.on('console', (m) => { if (m.type() !== 'error') return; const url = (m.location() && m.location().url) || ''; if (url && !url.startsWith(local) && !url.startsWith('data:') && !url.startsWith('blob:')) return; add('console', m.text()); });
  await page.goto(local + '/index.html', { waitUntil: 'load' });
  const info = await page.evaluate(() => window.__BR.boot());
  return { ctx, page, errors, info };
}
const call = (page, m, ...args) => page.evaluate(([name, a]) => window.__BR[name](...a), [m, args]);
async function shoot(page, res, name) {
  const file = path.join(S.opt.outdir, [res.name, S.opt.browser, name].join('-') + '.png');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: file });
  res.shots.push(file);
  return file;
}
function newResult(name) { return { name, browser: S.opt.browser, ok: true, notes: [], errors: [], shots: [], rows: [], wallMs: 0 }; }
function fail(res, note) { res.ok = false; res.notes.push('FAIL: ' + note); }

// ---------------- scenarios ----------------
async function scenSmoke() {
  const o = S.opt, res = newResult('smoke'), secs = o.seconds || 10;
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(`boot: atlas ${info.atlas}, webgl post ${info.gl}${info.soft ? ' (software)' : ''}`);
    await call(page, 'settings', o.quality);
    await shoot(page, res, 'title');
    for (const cls of o.classes) {
      await call(page, 'start', cls, 0);
      await wait(secs * 1000);
      const st = await call(page, 'state');
      res.rows.push(Object.assign({ cls }, st));
      if (st.app !== 'run' && st.app !== 'results') fail(res, cls + ': app state ' + st.app);
      if (!(st.time > secs * 0.5)) fail(res, cls + ': sim time ' + st.time + ' s after ' + secs + ' s');
      await shoot(page, res, cls);
      await call(page, 'stop');
      await wait(300);
    }
    await shoot(page, res, 'results');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}
async function scenCrowd(sc) {
  const o = S.opt, n = +sc.slice(5), res = newResult(sc), secs = o.seconds || 6;
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(`boot: webgl post ${info.gl}${info.soft ? ' (software)' : ''}`);
    await call(page, 'settings', o.quality);
    await call(page, 'start', 'knight', 0, { god: true });
    await call(page, 'hold', n);
    await wait(2000);
    const m = await call(page, 'measure', secs * 1000);
    res.rows.push(Object.assign({ quality: o.quality }, m));
    await shoot(page, res, 'crowd');
    await call(page, 'stop');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// ---------------- output ----------------
const tri = (s) => (s ? [s.p50, s.p95, s.max].join('/') : '-');
function table(results) {
  const out = [];
  for (const r of results) {
    out.push(`${r.name} [${r.browser}] ${r.ok ? 'PASS' : 'FAIL'}  ${(r.wallMs / 1000).toFixed(1)} s`);
    for (const n of r.notes) out.push('  ' + n);
    for (const e of r.errors) out.push(`  ${e.kind}: ${e.text}`);
    for (const w of r.rows) {
      if (r.name === 'smoke') out.push(`  ${w.cls.padEnd(7)} t ${w.time}s foes ${w.foes} kills ${w.kills} lvl ${w.level} hp ${w.hp} weapons ${w.weapons.join(',')}`);
      else out.push(`  ${w.quality}: foes ${w.foes}, frames ${w.frames}, frame ms p50/p95/max ${tri(w.frame)}, render ms ${tri(w.render)}, post ${w.usePost ? 'on' : 'off'}, canvas ${w.canvas.join('x')}`);
    }
    for (const f of r.shots) out.push('  shot ' + f);
  }
  return out.join('\n');
}

async function main() {
  delete process.env.PWDEBUG; // Playwright's debug mode would open a headed browser
  S.opt = parseArgs(process.argv.slice(2));
  if (S.opt.help) { for (const l of fs.readFileSync(__filename, 'utf8').split(/\r?\n/)) { if (!l.startsWith('//')) break; console.log(l.slice(3)); } return 0; }
  fs.mkdirSync(S.opt.outdir, { recursive: true });
  S.pw = loadPlaywright();
  S.server = await serve(S.opt.root);
  const dog = setTimeout(() => { log('timeout after ' + S.opt.timeout + ' s'); cleanup().then(() => process.exit(2)); }, S.opt.timeout * 1000);
  const results = [];
  try {
    S.browser = await launch();
    log(`browse: headless ${S.opt.browser} ${S.browser.version()}, ${S.opt.vw}x${S.opt.vh}`);
    for (const sc of S.opt.scens) {
      const t0 = Date.now();
      let r;
      try { r = sc === 'smoke' ? await scenSmoke() : await scenCrowd(sc); } catch (e) { if (e instanceof Fail) throw e; r = newResult(sc); fail(r, 'harness error: ' + String(e && e.message || e).split(/\r?\n/)[0]); }
      r.wallMs = Date.now() - t0;
      if (S.server.missing.size) { r.missing = [...S.server.missing]; fail(r, 'missing files: ' + r.missing.join(', ')); }
      results.push(r);
    }
  } finally { clearTimeout(dog); await cleanup(); }
  const file = path.join(S.opt.outdir, 'result-' + S.opt.browser + '.json');
  fs.writeFileSync(file, JSON.stringify({ tool: 'tools/browse.js', browser: S.opt.browser, viewport: [S.opt.vw, S.opt.vh], seed: S.opt.seed, results }, null, 1));
  console.log(table(results) + '\nresult ' + file);
  return results.every(r => r.ok) ? 0 : 1;
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup().then(() => process.exit(130)); });
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e instanceof Fail ? 'browse: ' + e.message : e); process.exitCode = e instanceof Fail ? e.code : 2; });
