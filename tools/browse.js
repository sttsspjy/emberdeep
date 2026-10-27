// Headless browser harness: boots the static game in an invisible Playwright browser and runs scripted scenarios against it. Never opens a visible window.
// Usage: node tools/browse.js [smoke|shots|crowdN|coop ...] [--scen=a,b] [--cls=knight,...] [--seconds=N] [--browser=chromium|firefox] [--viewport=1920x1080] [--outdir=DIR] [--seed=1]
//                             [--software] [--quality=high|low] [--gate] [--ff=480] [--timeout=600]
//   smoke: for each hero (--cls, default all 7) a solo stage-1 run driven ~--seconds (10) s (circling, Q / E, dash, first card picked); fails on a page or console error,
//          a stalled sim, no Q or E cast, or a signature weapon that dealt nothing.
//   shots: PNGs of title, hero select, stage select, camp, each hero mid-fight at --ff (480) s of sim (ED.Debug.fastForward, god cheat), a level-up overlay, a chest
//          (evolution), a boss fight and the results screen, into a fresh folder <outdir>/shots-<stamp> (printed).
//   crowdN: a knight run (god cheat) held at N live foes; after 2 s of warm-up measures --seconds (6) s, p50 / p95 / max: frame time (rAF interval; the browser runs uncapped,
//          no vsync, when a crowd scenario is requested), main-thread work (all rAF callbacks of a frame), sim ms per 60 Hz tick and Render.frame ms.
//          --software launches without the GPU (software GL: the Canvas2D fallback path). --gate fails crowd900 when GPU-path frame p95 > 8 ms (ARCHITECTURE §11; report-only by default).
//   coop: two pages of one browser context on ?net=local (BroadcastChannel transport): host + guest lobby handshake; when ED.Net.encodeSnap / decodeSnap exist, the host runs a
//         2-hero world and streams snapshots to the guest for --seconds (6) s (decoded heroes / foes, bytes <= 12 KB); otherwise that half is skipped with a note.
// In-page debug API (injected only by this harness, absent in normal play; every call is a no-op without a solo / host run): ED.Debug.{fastForward(sec), give(id, lvl), evolve(wid?),
//   spawnBoss(id?), setTime(sec), levelUp(n), chest(), win(), lose(), god(on), state()}.
// Mechanism: a read-only http server on 127.0.0.1 (random port) serves the repo; Playwright resolves via require('playwright'), else the npx cache (%LOCALAPPDATA%\npm-cache\_npx).
//   The page runs with a seeded Math.random. Output: a table on stdout, PNGs and result-<browser>.json in --outdir (default <tmp>/wickdeep-browse). Exit 0 pass, 1 scenario failure, 2 harness error.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

// ---------------- arguments ----------------
const FLAGS = { scen: 's', cls: 's', browser: 's', viewport: 's', outdir: 's', root: 's', quality: 's', seconds: 'n', seed: 'n', timeout: 'n', ff: 'n', software: 'b', gate: 'b', json: 'b', help: 'b' };
class Fail extends Error { constructor(msg, code) { super(msg); this.code = code || 2; } }
const HEROES = ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell'];
const SCEN_RE = /^(smoke|shots|coop|crowd\d{1,4})$/;
function parseArgs(argv) {
  const o = { scen: '', cls: HEROES.join(','), browser: 'chromium', viewport: '1920x1080', outdir: path.join(os.tmpdir(), 'wickdeep-browse'), root: path.resolve(__dirname, '..'), quality: 'high', seconds: 0, seed: 1, timeout: 600, ff: 480 };
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
  for (const s of o.scens) if (!SCEN_RE.test(s)) throw new Fail('unknown scenario ' + s + ' (smoke, shots, crowdN, coop)');
  if (!['chromium', 'firefox'].includes(o.browser)) throw new Fail('--browser is chromium or firefox');
  const vp = /^(\d{3,5})x(\d{3,5})$/.exec(o.viewport);
  if (!vp) throw new Fail('--viewport is WxH');
  o.vw = +vp[1]; o.vh = +vp[2];
  o.classes = o.cls.split(',').map(s => s.trim()).filter(c => HEROES.includes(c));
  if (!o.classes.length) throw new Fail('--cls names no hero (' + HEROES.join(', ') + ')');
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
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
  const BR = window.__BR = { drive: false, still: false, autoPick: true, crowd: 0, tickMs: null, ev: {}, mine: {}, coop: {}, work: 0, workT: -1, workAcc: 0 };
  const ED = () => window.ED;
  // Main-thread work per frame: the summed run time of every rAF callback sharing one frame timestamp; BR.work holds the last complete frame's total.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t !== BR.workT) { BR.work = BR.workAcc; BR.workAcc = 0; BR.workT = t; }
    const s = performance.now();
    try { cb(t); } finally { BR.workAcc += performance.now() - s; }
  });
  const run = () => { const E = ED(), G = E && E.Game; return G && G.w && (G.mode === 'solo' || G.mode === 'host') ? G.w : null; };
  const meOf = (w) => w.hero(ED().Game.myPid) || w.heroes[0];

  // ED.Debug: tools-only control of the local solo / host run (no-op and null result without one).
  function installDebug(E) {
    const C = E.CONST, D = {};
    // Scripted hero for fastForward: circles, Q every 7 s, E every 11 s, dash every 5 s, picks the first card, walks to a chest on the ground.
    const drive = (w, p, tick) => {
      let mx, my;
      let ch = null, bd = Infinity;
      for (const g of w.pickups) if (!g.dead && g.k === 'chest') { const d = (g.x - p.x) ** 2 + (g.y - p.y) ** 2; if (d < bd) { bd = d; ch = g; } }
      if (ch && bd < 700 * 700) { const d = Math.sqrt(bd) || 1; mx = (ch.x - p.x) / d; my = (ch.y - p.y) / d; }
      else { const a = tick / 60 * 0.7 + p.slot * 1.6; mx = Math.cos(a); my = Math.sin(a); }
      w.input(p.pid, { mx, my, ax: p.x + mx * 80, ay: p.y + my * 80, q: tick % 420 === 30, e: tick % 660 === 60, dash: tick % 300 === 90, pick: p.offer ? 1 : 0 });
    };
    // Steps the sim sec seconds synchronously (all heroes scripted, events discarded except a run end). Returns D.state().
    D.fastForward = (sec) => {
      const w = run(); if (!w) return null;
      const G = E.Game, end = w.time + Math.max(0, +sec || 0);
      let guard = Math.ceil((+sec || 0) * 60 * 4) + 600, tick = w.tick;
      while (w.time < end && w.state === 'play' && guard-- > 0) {
        for (const p of w.heroes) drive(w, p, tick);
        w.update(C.TICK); tick++;
        if (w.state === 'play') w.events.length = 0;
      }
      G.acc = 0; G.syncView();
      if (E.FX && E.FX.clear) E.FX.clear();
      return D.state();
    };
    // Gives weapon or passive id to the local hero at level lvl (default max). A new weapon with all 6 slots full replaces the last slot.
    D.give = (id, lvl) => {
      const w = run(); if (!w) return null;
      const p = meOf(w);
      if (E.WEAPONS[id]) {
        let ws = p.weapons.find(x => x.id === id);
        if (!ws) { if (p.weapons.length >= E.MAX_WEAPONS) p.weapons.pop(); ws = w.addWeapon(p, id); }
        if (!ws) return null;
        ws.lvl = Math.max(1, Math.min(E.weaponMaxLvl(E.WEAPONS[id]), lvl || 99));
      } else if (E.PASSIVES[id]) {
        let ps = p.passives.find(x => x.id === id);
        if (!ps) { if (p.passives.length >= E.MAX_PASSIVES) p.passives.pop(); ps = { id, lvl: 1 }; p.passives.push(ps); }
        ps.lvl = Math.max(1, Math.min(E.PASSIVES[id].max, lvl || 99));
      } else return null;
      w.recalc(p, false);
      return D.state();
    };
    // Evolves weapon wid (default: the first slot whose weapon has an evolution): sets level 8, adds the paired passive, swaps to the evolved id. Returns the new id or null.
    D.evolve = (wid) => {
      const w = run(); if (!w) return null;
      const p = meOf(w), ws = p.weapons.find(x => (wid ? x.id === wid : true) && E.WEAPONS[x.id].evo && E.WEAPONS[E.WEAPONS[x.id].evo]);
      if (!ws) return null;
      const def = E.WEAPONS[ws.id];
      ws.lvl = E.WEAPON_MAX_LVL;
      if (def.pair && E.PASSIVES[def.pair] && !p.passives.some(x => x.id === def.pair)) D.give(def.pair, 1);
      w.evolve(p, ws); w.recalc(p, false);
      return ws.id;
    };
    // Spawns boss id (default: the stage's first boss) about 150 px from the local hero (on screen) with HP for the current minute (at least minute 5). Returns the boss foe id.
    D.spawnBoss = (id) => {
      const w = run(); if (!w) return null;
      const b = (w.sdef.bosses || [])[0];
      id = id || (b && b.id);
      if (!id || !E.FOES[id]) return null;
      const e = w.spawnBoss({ t: Math.max(300, Math.floor(w.time / 60) * 60), id, final: false });
      if (!e) return null;
      const p = meOf(w);
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 - 0.5, x = p.x + Math.cos(a) * 150, y = p.y + Math.sin(a) * 110; if (!E.Arena.blocked(w.arena, x, y, e.r)) { e.x = x; e.y = y; break; } }
      return e.id;
    };
    // Jumps the run clock to sec; swarm / elite / boss timers skip what that time already passed.
    D.setTime = (sec) => {
      const w = run(); if (!w) return null;
      const sd = w.sdef, sp = w.sp || {}, sw = sd.events && sd.events.swarm, el = sd.elites;
      w.time = Math.max(0, +sec || 0);
      if (sw && typeof sp.swarmT === 'number') { sp.swarmT = sw.first; while (sp.swarmT <= w.time) sp.swarmT += sw.every; }
      if (el && typeof sp.eliteT === 'number') { sp.eliteT = el.first; while (sp.eliteT <= w.time) sp.eliteT += el.every; }
      if (typeof sp.bossI === 'number') { let i = 0; while (sd.bosses && sd.bosses[i] && sd.bosses[i].t <= w.time) i++; sp.bossI = i; sp.warnI = i - 1; }
      E.Game.syncView();
      return D.state();
    };
    // Adds the XP for n level-ups (offers appear on the next ticks).
    D.levelUp = (n) => { const w = run(); if (!w) return null; for (let i = 0; i < (n || 1); i++) w.addXp(w.xpNext - w.xp + 1e-6); return w.level; };
    // Opens a chest for the local hero now (evolves a ready weapon first). Returns the chest results.
    D.chest = () => {
      const w = run(); if (!w) return null;
      const p = meOf(w), n = w.events.length;
      w.openChest(p, 1);
      for (let i = n; i < w.events.length; i++) if (w.events[i].t === 'chest') return w.events[i].results;
      return [];
    };
    D.win = () => { const w = run(); if (!w) return false; w.finalDown = true; return true; };
    D.lose = () => { const w = run(); if (!w) return false; w.end(false); return true; };
    D.god = (on) => { const w = run(); if (!w) return false; w.cheats.god = on !== false; return w.cheats.god; };
    D.state = () => {
      const w = run(); if (!w) return null;
      const p = meOf(w);
      return { time: +w.time.toFixed(1), state: w.state, level: w.level, kills: w.kills, foes: w.foes.length, projs: w.projs.length, pickups: w.pickups.length, boss: w.boss ? w.boss.def.id : '', hp: Math.round(p.hp), weapons: p.weapons.map(x => x.id + x.lvl), passives: p.passives.map(x => x.id + x.lvl), offer: !!p.offer };
    };
    E.Debug = D;
  }

  BR.boot = () => new Promise((resolve, reject) => {
    const t0 = performance.now();
    const poll = () => {
      const E = ED();
      if (E && E.App && E.App.state === 'title') {
        installDebug(E);
        // scripted input: wraps ED.Input.read while BR.drive is on
        const I = E.Input, read = I.read;
        I.read = () => {
          const o = read();
          if (!BR.drive) return o;
          const t = performance.now() / 1000, me = E.Game.view && E.Game.view.me;
          o.mx = BR.still ? 0 : Math.cos(t * 0.9); o.my = BR.still ? 0 : Math.sin(t * 0.9);
          o.q = Math.random() < 0.02; o.e = Math.random() < 0.015; o.dash = Math.random() < 0.01;
          o.pick = BR.autoPick && me && me.offer ? 1 : 0;
          return o;
        };
        // sim ms per tick (while measuring) and an event tally (all / the local hero's) for checks
        const G = E.Game, upd = G.update, drain = G.drain;
        G.update = function (dt) { const s = performance.now(), n = upd.call(this, dt); if (n > 0 && BR.tickMs) BR.tickMs.push((performance.now() - s) / n); return n; };
        G.drain = function () {
          const w = G.w;
          if (w) for (const ev of w.events) { BR.ev[ev.t] = (BR.ev[ev.t] || 0) + 1; if (ev.pid === G.myPid) { const k = ev.t === 'skill' ? 'skill' + ev.slot : ev.t; BR.mine[k] = (BR.mine[k] || 0) + 1; } }
          return drain.apply(this, arguments);
        };
        resolve({ gl: !!(E.Post && E.Post.ready), soft: !!(E.Post && E.Post.soft), atlas: !!E.Atlas.ok, batch: E.Batch ? E.Batch.mode || '?' : 'none' });
        return;
      }
      if (performance.now() - t0 > 20000) { reject(new Error('boot timeout: App.state ' + (E && E.App ? E.App.state : 'none'))); return; }
      setTimeout(poll, 50);
    };
    poll();
  });
  BR.settings = (q) => { const E = ED(); E.App.settings.quality = q; E.App.applySettings(); };
  BR.start = (cls, stage, cheats) => {
    const E = ED(); if (!E.App.hasProfile) E.App.createProfile('Bot');
    E.App.startSolo({ cls, stage: stage | 0, seed: cfg.seed, cheats: cheats || null });
    BR.drive = true; BR.still = false; BR.autoPick = true; BR.ev = {}; BR.mine = {};
    return E.App.state;
  };
  BR.state = () => {
    const E = ED(), w = E.Game.w, me = E.Game.view && E.Game.view.me, h = me && E.HEROES[me.cls];
    return { app: E.App.state, time: w ? +w.time.toFixed(1) : 0, foes: w ? w.foes.length : 0, kills: w ? w.kills : 0, level: w ? w.level : 0, hp: me ? Math.round(me.hp) : 0,
      weapons: me ? me.weapons.map(x => x.id + x.lvl) : [], q: BR.mine.skill0 || 0, e: BR.mine.skill1 || 0, sigDealt: me && h ? Math.round(me.dealt[h.sig] || 0) : 0, hits: BR.ev.hit || 0 };
  };
  BR.stop = () => { BR.drive = false; BR.crowd = 0; clearInterval(BR.holdT); const E = ED(); if (E.App.state === 'run') E.App.quitRun(); };
  BR.debug = (name, args) => { const D = ED().Debug; return D && D[name] ? D[name](...(args || [])) : null; };
  BR.visible = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
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
  // Over msec: frame time (rAF interval), main-thread work, sim update ms and Render.frame ms per frame: p50 / p95 / max.
  BR.measure = (msec) => new Promise((resolve) => {
    const E = ED(), fr = [], wk = [], rm = [], um = BR.tickMs = [], fo = [];
    let last = performance.now();
    const t0 = last;
    const step = (now) => {
      fr.push(now - last); last = now; wk.push(BR.work); rm.push(E.Render.ms); fo.push(E.Game.w ? E.Game.w.foes.length : 0);
      if (now - t0 < msec) requestAnimationFrame(step);
      else {
        const st = (a) => { const s = a.slice().sort((x, y) => x - y); return { p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
        BR.tickMs = null;
        resolve({ frames: fr.length, frame: st(fr), work: st(wk.slice(1)), tick: st(um.length ? um : [0]), render: st(rm), foes: Math.round(fo.reduce((a, b) => a + b, 0) / fo.length), usePost: E.Render.usePost, soft: !!(E.Post && E.Post.soft), batch: E.Batch ? E.Batch.mode || '?' : 'none', canvas: [E.Render.canvas.width, E.Render.canvas.height, E.Render.bw, E.Render.bh, E.Render.scale] });
      }
    };
    requestAnimationFrame(step);
  });

  // ---- co-op (two pages, ?net=local) ----
  const C = BR.coop;
  const hasNet = () => { const E = ED(); return E.Net && typeof E.Net.Host === 'function' && typeof E.Net.Client === 'function' && E.Net.mode() === 'local' && E.Net.available(); };
  const codec = () => { const N = ED().Net; return typeof N.encodeSnap === 'function' && typeof N.decodeSnap === 'function'; };
  const meta = () => { const E = ED(); if (!E.App.hasProfile) E.App.createProfile('Bot'); return E.Save.metaBundle(E.App.profile); };
  BR.coopHost = (cls) => new Promise((resolve, reject) => {
    if (!hasNet()) { resolve({ skip: 'ED.Net Host / Client or the local transport is missing' }); return; }
    const E = ED(), to = setTimeout(() => reject(new Error('host open timeout')), 8000);
    C.joined = 0;
    const h = C.host = new E.Net.Host({ name: 'Host', cls, meta: meta() }, {
      status: (s, msg) => { if (s === 'open') { clearTimeout(to); resolve({ code: h.code }); } else if (s === 'error') { clearTimeout(to); reject(new Error(msg)); } },
      code: () => {}, joined: () => { C.joined++; }, left: () => { C.left = (C.left || 0) + 1; }, lobby: (s) => { C.lobby = s; },
      data: (pid, d) => { if (d && d.t === 'input' && E.Game.w) E.Game.w.input(pid, d); },
    });
  });
  BR.coopJoin = (code, cls) => new Promise((resolve, reject) => {
    if (!hasNet()) { resolve({ skip: 'ED.Net Host / Client or the local transport is missing' }); return; }
    const E = ED(), to = setTimeout(() => reject(new Error('join timeout')), 8000);
    C.snaps = 0; C.bytes = 0; C.maxBytes = 0; C.maxHeroes = 0; C.maxFoes = 0; C.decodeErr = '';
    C.view = { me: null, heroes: [], foes: [], projs: [], zones: [], pickups: [], props: null, stage: 0, seed: 0, time: 0, xp: 0, xpNext: 1, level: 1, kills: 0, gold: 0, boss: null, events: [] };
    C.client = new E.Net.Client(code, { name: 'Guest', cls, meta: meta() }, {
      welcome: (d) => { clearTimeout(to); resolve({ pid: d.pid, slot: d.slot }); },
      error: (m) => { clearTimeout(to); reject(new Error(String(m))); },
      lobby: (s) => { C.lobby = s; }, closed: (m) => { C.closedMsg = m || 'closed'; },
      data: (d) => {
        if (!d || d.t !== 'snap') return;
        const b = d.b, n = b && (b.byteLength || 0);
        C.snaps++; C.bytes += n; if (n > C.maxBytes) C.maxBytes = n;
        try { E.Net.decodeSnap(b, C.view); C.maxHeroes = Math.max(C.maxHeroes, C.view.heroes.length); C.maxFoes = Math.max(C.maxFoes, C.view.foes.length); }
        catch (e) { if (!C.decodeErr) C.decodeErr = String(e && e.stack || e).slice(0, 300); }
      },
    });
  });
  BR.coopLobby = () => ({ members: C.lobby ? C.lobby.members.length : 0, joined: C.joined || 0, codec: codec() });
  // Host: starts a world with every lobby member (god cheat) and sends each guest a snapshot every 50 ms.
  BR.coopStart = () => {
    if (!codec()) return { skip: 'ED.Net.encodeSnap / decodeSnap are stubs' };
    const E = ED(), h = C.host;
    h.started = true;
    const players = h.members.map(m => ({ pid: m.pid, name: m.name, slot: m.slot, cls: m.cls, meta: m.meta || { shop: {}, sigs: [] } }));
    E.Game.start({ mode: 'host', seed: cfg.seed, stage: 0, players, myPid: 'host', cheats: { god: true } });
    E.App.state = 'run'; E.UI.show('none');
    BR.drive = true;
    h.broadcast({ t: 'start', seed: cfg.seed, stage: 0 });
    C.sent = 0; C.encMs = 0;
    clearInterval(C.snapT);
    C.snapT = setInterval(() => {
      const w = E.Game.w; if (!w) return;
      for (const pid of h.conns.keys()) { const s = performance.now(), b = E.Net.encodeSnap(w, pid); C.encMs = Math.max(C.encMs, performance.now() - s); h.sendTo(pid, { t: 'snap', b }); C.sent++; }
    }, 50);
    return { players: players.length };
  };
  BR.coopStats = () => ({ snaps: C.snaps || 0, sent: C.sent || 0, maxBytes: C.maxBytes || 0, avgBytes: C.snaps ? Math.round(C.bytes / C.snaps) : 0, maxHeroes: C.maxHeroes || 0, maxFoes: C.maxFoes || 0, decodeErr: C.decodeErr || '', closed: C.closedMsg || '', encMs: +(C.encMs || 0).toFixed(2) });
  BR.coopStop = () => { clearInterval(C.snapT); try { if (C.client) C.client.close(); } catch (e) { /* gone */ } try { if (C.host) C.host.close(); } catch (e) { /* gone */ } BR.drive = false; };
}

// ---------------- run context ----------------
const S = { opt: null, pw: null, browser: null, server: null, closing: false, shotDir: '' };
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
    opts.args = ['--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    if (o.scens.some(s => s.startsWith('crowd'))) opts.args.push('--disable-frame-rate-limit', '--disable-gpu-vsync'); // frame interval = real throughput, not the 60 Hz vsync cap
    if (o.software) opts.args.push('--disable-gpu');
    else opts.args.push('--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist');
  } else opts.firefoxUserPrefs = { 'media.volume_scale': '0.0', 'layout.frame_rate': 60 };
  try { return await S.pw[o.browser].launch(opts); } catch (e) { throw new Fail('could not launch headless ' + o.browser + ': ' + String(e.message).split('\n')[0]); }
}
async function newContext() {
  const o = S.opt;
  const ctx = await S.browser.newContext({ viewport: { width: o.vw, height: o.vh }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'en-US' });
  await ctx.addInitScript({ content: '(' + pageBoot.toString() + ')(' + JSON.stringify({ seed: o.seed }) + ')' });
  const local = S.server.base;
  await ctx.route((u) => u.protocol.startsWith('http') && u.origin !== local, (route) => route.abort('blockedbyclient'));
  return ctx;
}
// A page in ctx with the harness booted; page errors and console errors (local origin) are collected into errors.
async function bootPage(ctx, query, errors, tag) {
  const local = S.server.base, page = await ctx.newPage();
  const add = (kind, text) => { if (errors.length < 40) errors.push({ kind: (tag ? tag + ' ' : '') + kind, text: String(text).replace(/\s+/g, ' ').slice(0, 400) }); };
  page.on('pageerror', (e) => add('pageerror', (e && e.stack) || e));
  page.on('crash', () => add('crash', 'page crashed'));
  page.on('console', (m) => { if (m.type() !== 'error') return; const url = (m.location() && m.location().url) || ''; if (url && !url.startsWith(local) && !url.startsWith('data:') && !url.startsWith('blob:')) return; add('console', m.text()); });
  await page.goto(local + '/index.html' + (query || ''), { waitUntil: 'load' });
  const info = await page.evaluate(() => window.__BR.boot());
  return { page, info };
}
async function openPage(query) {
  const ctx = await newContext(), errors = [];
  const { page, info } = await bootPage(ctx, query, errors);
  return { ctx, page, errors, info };
}
const call = (page, m, ...args) => page.evaluate(([name, a]) => window.__BR[name](...a), [m, args]);
const dbg = (page, m, ...args) => call(page, 'debug', m, args);
const frames = (page, n) => page.evaluate((k) => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n || 2);
async function shoot(page, res, name, dir) {
  const file = dir ? path.join(dir, name + '.png') : path.join(S.opt.outdir, [res.name, S.opt.browser, name].join('-') + '.png');
  await frames(page, 2);
  await page.screenshot({ path: file });
  res.shots.push(file);
  return file;
}
function newResult(name) { return { name, browser: S.opt.browser, ok: true, notes: [], errors: [], shots: [], rows: [], wallMs: 0 }; }
function fail(res, note) { res.ok = false; res.notes.push('FAIL: ' + note); }
const bootNote = (info) => `boot: atlas ${info.atlas}, batch ${info.batch}, webgl post ${info.gl}${info.soft ? ' (software)' : ''}`;

// ---------------- scenarios ----------------
async function scenSmoke() {
  const o = S.opt, res = newResult('smoke'), secs = o.seconds || 10;
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info));
    await call(page, 'settings', o.quality);
    await shoot(page, res, 'title');
    for (const cls of o.classes) {
      await call(page, 'start', cls, 0);
      await wait(secs * 1000);
      const st = await call(page, 'state');
      res.rows.push(Object.assign({ cls }, st));
      if (st.app !== 'run' && st.app !== 'results') fail(res, cls + ': app state ' + st.app);
      if (!(st.time > secs * 0.5)) fail(res, cls + ': sim time ' + st.time + ' s after ' + secs + ' s');
      if (secs >= 8 && (!st.q || !st.e)) fail(res, `${cls}: Q cast ${st.q}, E cast ${st.e}`);
      if (secs >= 8 && !(st.sigDealt > 0)) fail(res, cls + ': signature weapon dealt no damage');
      await shoot(page, res, cls);
      await call(page, 'stop');
      await wait(300);
    }
    await shoot(page, res, 'results');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Screens, every hero mid-fight at --ff s, level-up overlay, chest, boss, results: PNGs into a fresh folder.
async function scenShots() {
  const o = S.opt, res = newResult('shots');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = S.shotDir = path.join(o.outdir, 'shots-' + stamp + '-' + o.browser);
  fs.mkdirSync(dir, { recursive: true });
  res.notes.push('folder ' + dir);
  const { ctx, page, errors, info } = await openPage();
  const shot = (name) => shoot(page, res, name, dir);
  const need = (cond, note) => { if (!cond) fail(res, note); };
  try {
    res.notes.push(bootNote(info));
    await call(page, 'settings', o.quality);
    // menus through real clicks
    await page.fill('#inp-name', 'Tester').catch(() => {});
    await shot('01-title');
    await page.click('#btn-play');
    need(await call(page, 'visible', 'scr-hero'), 'hero select not shown');
    await shot('02-hero-select');
    await page.click('#btn-hero-next');
    need(await call(page, 'visible', 'scr-stage'), 'stage select not shown');
    await shot('03-stage-select');
    await page.click('#btn-stage-back'); await page.click('#btn-hero-back');
    await page.evaluate(() => { const A = window.ED.App; A.profile.gold = 2400; A.persist(); });
    await page.click('#btn-camp');
    need(await call(page, 'visible', 'scr-camp'), 'camp not shown');
    await shot('04-camp');
    await page.click('#btn-camp-back');
    // heroes mid-fight; the first hero's run also gives the level-up, chest, boss and results shots
    let k = 5;
    for (let i = 0; i < o.classes.length; i++) {
      const cls = o.classes[i], tag = String(k++).padStart(2, '0');
      await call(page, 'start', cls, 0, { god: true });
      const t0 = Date.now(), st = await dbg(page, 'fastForward', o.ff);
      const ffMs = Date.now() - t0;
      await wait(1500);
      need(st && st.state === 'play' && st.time >= o.ff - 1, `${cls}: fast-forward reached ${st ? st.time + ' s (' + st.state + ')' : 'nothing'}`);
      need(await call(page, 'visible', 'game'), cls + ': canvas hidden');
      await shot(`${tag}-fight-${cls}`);
      res.rows.push(Object.assign({ cls, ffMs }, await dbg(page, 'state')));
      if (i > 0) { await call(page, 'stop'); await wait(200); continue; }
      // level-up overlay
      await page.evaluate(() => { window.__BR.autoPick = false; });
      await dbg(page, 'levelUp', 1);
      await page.waitForFunction(() => { const el = document.getElementById('ov-offer'); return el && !el.hidden; }, null, { timeout: 3000 }).catch(() => {});
      need(await call(page, 'visible', 'ov-offer'), 'level-up overlay not shown');
      await shot(`${String(k++).padStart(2, '0')}-levelup`);
      await page.evaluate(() => { window.__BR.autoPick = true; });
      await page.waitForFunction(() => document.getElementById('ov-offer').hidden, null, { timeout: 3000 }).catch(() => {});
      // chest: evolve-ready signature weapon, then a chest
      const sig = await page.evaluate(() => { const E = window.ED, me = E.Game.view.me; return E.HEROES[me.cls].sig; });
      const def = await page.evaluate((id) => { const d = window.ED.WEAPONS[id]; return d ? { evo: d.evo || '', pair: d.pair || '' } : null; }, sig);
      if (def && def.evo) { await dbg(page, 'give', sig, 8); if (def.pair) await dbg(page, 'give', def.pair, 1); }
      const chest = await dbg(page, 'chest');
      await wait(450);
      need(Array.isArray(chest) && chest.length > 0, 'chest gave nothing');
      res.notes.push('chest: ' + JSON.stringify(chest));
      await shot(`${String(k++).padStart(2, '0')}-chest`);
      // boss fight
      await page.evaluate(() => { window.__BR.still = true; });
      const bid = await dbg(page, 'spawnBoss');
      need(bid, 'boss did not spawn');
      await wait(2000);
      await shot(`${String(k++).padStart(2, '0')}-boss`);
      res.notes.push('boss: ' + JSON.stringify(await dbg(page, 'state')));
      // results
      await dbg(page, 'win');
      await page.waitForFunction(() => window.ED.App.state === 'results', null, { timeout: 5000 }).catch(() => {});
      need(await call(page, 'visible', 'scr-results'), 'results screen not shown');
      await shot(`${String(k++).padStart(2, '0')}-results`);
      await page.click('#btn-res-back').catch(() => {});
    }
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

async function scenCrowd(sc) {
  const o = S.opt, n = +sc.slice(5), res = newResult(sc), secs = o.seconds || 6;
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info) + (o.software ? ', launched without GPU' : ''));
    await call(page, 'settings', o.quality);
    await call(page, 'start', 'knight', 0, { god: true });
    await call(page, 'hold', n);
    await wait(2000);
    const m = await call(page, 'measure', secs * 1000);
    res.rows.push(Object.assign({ quality: o.quality }, m));
    const gpu = !o.software && !m.soft && (m.batch !== '2d' || m.usePost);
    if (n >= 900) {
      const over = m.frame.p95 > 8;
      res.notes.push(`gate (GPU path frame p95 <= 8 ms): ${gpu ? (over ? 'OVER' : 'ok') : 'n/a (not the GPU path)'} — p95 ${m.frame.p95} ms`);
      if (o.gate && gpu && over) fail(res, `frame p95 ${m.frame.p95} ms > 8 ms`);
    }
    if (m.foes < n * 0.8) res.notes.push(`held only ${m.foes} of ${n} foes on average`);
    await shoot(page, res, 'crowd' + (o.software ? '-soft' : ''));
    await call(page, 'stop');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Host + guest pages in one context over the BroadcastChannel transport.
async function scenCoop() {
  const o = S.opt, res = newResult('coop'), secs = o.seconds || 6, errors = [];
  const ctx = await newContext();
  try {
    const H = await bootPage(ctx, '?net=local', errors, 'host'), G = await bootPage(ctx, '?net=local', errors, 'guest');
    res.notes.push(bootNote(H.info));
    const host = await call(H.page, 'coopHost', o.classes[0]);
    if (host.skip) { res.notes.push('SKIP: ' + host.skip); return res; }
    const guest = await call(G.page, 'coopJoin', host.code, o.classes[1] || 'ranger');
    if (guest.skip) { res.notes.push('SKIP: ' + guest.skip); return res; }
    await wait(400);
    const lob = await call(H.page, 'coopLobby');
    res.rows.push({ kind: 'lobby', code: host.code, guestPid: guest.pid, slot: guest.slot, members: lob.members });
    if (lob.members !== 2) fail(res, 'lobby has ' + lob.members + ' members, expected 2');
    if (!lob.codec) { res.notes.push('SKIP run: ED.Net.encodeSnap / decodeSnap are stubs (lobby handshake checked only)'); }
    else {
      const st = await call(H.page, 'coopStart');
      if (st.skip) res.notes.push('SKIP run: ' + st.skip);
      else {
        await wait(secs * 1000);
        const s = await call(G.page, 'coopStats'), h = await call(H.page, 'coopStats');
        res.rows.push(Object.assign({ kind: 'run' }, s, { sent: h.sent, encMs: h.encMs }));
        if (s.decodeErr) fail(res, 'decodeSnap threw: ' + s.decodeErr);
        if (s.snaps < secs * 20 * 0.5) fail(res, `guest decoded ${s.snaps} snapshots in ${secs} s (expected ~${secs * 20})`);
        if (s.maxHeroes !== 2) fail(res, 'guest view had ' + s.maxHeroes + ' heroes, expected 2');
        if (!s.maxFoes) fail(res, 'guest view never had foes');
        if (s.maxBytes > 12288) fail(res, `snapshot ${s.maxBytes} B > 12 KB`);
        if (s.closed) fail(res, 'guest lost the host: ' + s.closed);
        await shoot(H.page, res, 'host');
        await shoot(G.page, res, 'guest');
      }
    }
    await call(G.page, 'coopStop'); await call(H.page, 'coopStop');
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
      if (r.name === 'smoke') out.push(`  ${w.cls.padEnd(7)} t ${w.time}s foes ${w.foes} kills ${w.kills} lvl ${w.level} hp ${w.hp} Q ${w.q} E ${w.e} sig dmg ${w.sigDealt} weapons ${w.weapons.join(',')}`);
      else if (r.name === 'shots') out.push(`  ${w.cls.padEnd(7)} ff ${(w.ffMs / 1000).toFixed(1)} s wall -> t ${w.time}s lvl ${w.level} foes ${w.foes} projs ${w.projs} kills ${w.kills} weapons ${w.weapons.join(',')} passives ${w.passives.join(',')}`);
      else if (r.name === 'coop') out.push('  ' + Object.entries(w).map(([k, v]) => k + ' ' + v).join(', '));
      else out.push(`  ${w.quality}: foes ${w.foes}, frames ${w.frames}, frame ms p50/p95/max ${tri(w.frame)}, work ms ${tri(w.work)}, sim ms/tick ${tri(w.tick)}, render ms ${tri(w.render)}, batch ${w.batch}, post ${w.usePost ? 'on' : 'off'}${w.soft ? ' (software)' : ''}, canvas ${w.canvas.join('x')}`);
    }
    if (r.name !== 'shots') for (const f of r.shots) out.push('  shot ' + f);
    else out.push(`  ${r.shots.length} shots`);
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
    log(`browse: headless ${S.opt.browser} ${S.browser.version()}, ${S.opt.vw}x${S.opt.vh}${S.opt.software ? ', no GPU' : ''}`);
    for (const sc of S.opt.scens) {
      const t0 = Date.now();
      let r;
      try { r = sc === 'smoke' ? await scenSmoke() : sc === 'shots' ? await scenShots() : sc === 'coop' ? await scenCoop() : await scenCrowd(sc); }
      catch (e) { if (e instanceof Fail) throw e; r = newResult(sc); fail(r, 'harness error: ' + String(e && e.message || e).split(/\r?\n/)[0]); }
      r.wallMs = Date.now() - t0;
      if (S.server.missing.size) { r.missing = [...S.server.missing]; fail(r, 'missing files: ' + r.missing.join(', ')); S.server.missing.clear(); }
      results.push(r);
    }
  } finally { clearTimeout(dog); await cleanup(); }
  const file = path.join(S.opt.outdir, 'result-' + S.opt.browser + '.json');
  fs.writeFileSync(file, JSON.stringify({ tool: 'tools/browse.js', browser: S.opt.browser, viewport: [S.opt.vw, S.opt.vh], seed: S.opt.seed, software: !!S.opt.software, results }, null, 1));
  console.log(table(results) + (S.shotDir ? '\nshots folder ' + S.shotDir : '') + '\nresult ' + file);
  return results.every(r => r.ok) ? 0 : 1;
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup().then(() => process.exit(130)); });
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e instanceof Fail ? 'browse: ' + e.message : e); process.exitCode = e instanceof Fail ? e.code : 2; });
