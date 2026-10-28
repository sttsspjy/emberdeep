// Headless browser harness: boots the static game in an invisible Playwright browser and runs scripted scenarios against it. Never opens a visible window.
// Usage: node tools/browse.js [smoke|shots|crowdN|coop|botwatch ...] [--scen=a,b] [--cls=knight,...] [--seconds=N] [--browser=chromium|firefox] [--viewport=1920x1080] [--outdir=DIR] [--seed=1]
//                             [--software] [--quality=high|low] [--gate] [--ff=480] [--timeout=600]
//   smoke: for each hero (--cls, default all 7) a solo stage-1 run driven ~--seconds (10) s (circling, Q / E, dash, first card picked); fails on a page or console error,
//          a stalled sim, no Q or E cast, or a signature weapon that dealt nothing.
//   shots: PNGs of title, hero select, stage select, camp, each hero mid-fight at --ff (480) s of sim (ED.Debug.fastForward, god cheat), a level-up overlay, a chest
//          (evolution), a boss fight and the results screen, into a fresh folder <outdir>/shots-<stamp> (printed).
//   crowdN: a knight run (god cheat) held at N live foes; after 2 s of warm-up measures --seconds (6) s, p50 / p95 / max: frame time (rAF interval; the browser runs uncapped,
//          no vsync, when a crowd scenario is requested), main-thread work (all rAF callbacks of a frame), sim ms per 60 Hz tick and Render.frame ms.
//          --software launches without the GPU (software GL: the Canvas2D fallback path). --gate fails crowd900 when GPU-path frame p95 > 8 ms (ARCHITECTURE §11; report-only by default).
//   late[a|b|c]: staged late game for the render budget: a hero with its Form, every path at rank 3 and the Form refined (set a: knight whirlwind, b: ranger hail, c: pyro inferno),
//          six max passives, clock 25:00, the stage boss and 900 last-roster foes held at real HP
//          (about 1,000 kills/s); measures like crowdN plus own-zone count / coverage. --gate fails when Render.frame p95 > 4 ms on WebGL or > 8 ms on Canvas2D (GAME-DESIGN §13).
//   coop: two pages of one browser context on ?net=local (BroadcastChannel transport): host + guest through the ED.Net lobby API (host, join, ready, start), then the real co-op
//         run on both peers for --seconds (6) s: the guest's mirror shows 2 heroes and foes, snapshots <= 12 KB.
//   botwatch: ?bot=1&speed=8&seed=--seed with the real tools/bot-brain.js; a knight solo run on stage 0 watched --seconds (20) s: fails on sim time < 3x real time (notes < 6x),
//         a hero that never left a 40 px radius, no automatic level-up pick, no BOT tag, [ / ] not changing the speed, Esc not pausing, a missing file or a page / console error.
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
const SCEN_RE = /^(smoke|shots|coop|botwatch|crowd\d{1,4}|late[abc]?)$/;
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
  for (const s of o.scens) if (!SCEN_RE.test(s)) throw new Fail('unknown scenario ' + s + ' (smoke, shots, crowdN, late[a|b|c], coop, botwatch)');
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
    // Gives weapon or passive id to the local hero. Weapon: a root replaces the hero's weapon if needed and spends lvl - 1 path ranks (path 0 first; default all 9);
    // a Form ranks the paths it needs, takes it and refines it fully. Passive: level lvl (default max).
    D.give = (id, lvl) => {
      const w = run(); if (!w) return null;
      const p = meOf(w);
      if (E.WEAPONS[id]) {
        const rid = E.weaponRoot(id), d = E.WEAPONS[id];
        let ws = p.weapons.find(x => x.root === rid);
        if (!ws) { p.weapons.length = 0; ws = w.addWeapon(p, rid); }
        if (!ws) return null;
        if (d.form) {
          const f = E.weaponForms(rid).find(x => x.id === id);
          if (f && !ws.evo) { for (const i of f.need) while (w.rankPath(p, ws, i)); w.takeForm(p, ws, id); }
          while (w.refineForm(p, ws));
        } else {
          const want = Math.max(0, Math.min(9, (lvl || 99) - 1));
          let have = ws.pr[0] + ws.pr[1] + ws.pr[2];
          for (let i = 0; i < 3 && have < want; i++) while (have < want && w.rankPath(p, ws, i)) have++;
        }
      } else if (E.PASSIVES[id]) {
        let ps = p.passives.find(x => x.id === id);
        if (!ps) { if (p.passives.length >= E.MAX_PASSIVES) p.passives.pop(); ps = { id, lvl: 1 }; p.passives.push(ps); }
        ps.lvl = Math.max(1, Math.min(E.PASSIVES[id].max, lvl || 99));
      } else return null;
      w.recalc(p, false);
      return D.state();
    };
    // Takes Form fid (default: the hero weapon's first Form) on the local hero: ranks the paths it needs and swaps to it. Returns the weapon id now held or null.
    D.evolve = (fid) => {
      const w = run(); if (!w) return null;
      const p = meOf(w), ws = p.weapons[0];
      if (!ws) return null;
      const f = E.weaponForms(ws.root).find(x => !fid || x.id === fid);
      if (!f) return null;
      if (!ws.evo) { for (const i of f.need) while (w.rankPath(p, ws, i)); w.takeForm(p, ws, f.id); }
      w.recalc(p, false);
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
    // Opens an elite chest for the local hero now. Returns the chest results.
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
          if (!BR.still && me && t % 4 < 1.5) { // every 4 s, 1.5 s walking at the nearest foe (melee weapons swing along the walk)
            let best = null, bd = 1e12; for (const f of E.Game.view.foes) { if (f.dead) continue; const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2; if (d < bd) { bd = d; best = f; } }
            if (best) { const l = Math.sqrt(bd) || 1; o.mx = (best.x - me.x) / l; o.my = (best.y - me.y) / l; }
          }
          o.q = Math.random() < 0.02; o.dash = Math.random() < 0.01;
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
      weapons: me ? me.weapons.map(x => x.id + x.lvl) : [], q: BR.mine.skill0 || 0, sigDealt: me && h ? Math.round(me.dealt[h.sig] || 0) : 0, hits: BR.ev.hit || 0 };
  };
  BR.stop = () => { BR.drive = false; BR.crowd = 0; clearInterval(BR.holdT); const E = ED(); if (E.App.state === 'run') E.App.quitRun(); };
  BR.debug = (name, args) => { const D = ED().Debug; return D && D[name] ? D[name](...(args || [])) : null; };
  BR.visible = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
  // Keeps n foes alive on a ring 120-330 px around the hero (spawned directly; foes stay put when far by recycling). late: the last timeline roster at real HP, refilled every 50 ms.
  BR.hold = (n, late) => {
    BR.crowd = n;
    clearInterval(BR.holdT);
    BR.holdT = setInterval(() => {
      const E = ED(), w = E.Game.w; if (!w || !BR.crowd) return;
      const me = w.heroes[0], tl = w.sdef.timeline, ids = tl[late ? tl.length - 1 : 0].roster.map(r => r[0]).filter(id => !E.FOES[id].boss);
      for (let k = 0; w.foes.length < BR.crowd && k < (late ? 300 : 200); k++) { const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 210, x = me.x + Math.cos(a) * d, y = me.y + Math.sin(a) * d; if (!E.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ids[k % ids.length], x, y, { hpMul: late ? 1 : 40 }); }
    }, late ? 50 : 100);
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

  // ---- co-op (two pages, ?net=local): the real lobby API (ED.Net.host / join / setReady / start) and the real run session on both peers ----
  const C = BR.coop;
  const hasNet = () => { const E = ED(); return E.Net && typeof E.Net.host === 'function' && E.Net.mode() === 'local' && E.Net.available(); };
  const ensure = () => { const E = ED(); if (!E.App.hasProfile) E.App.createProfile('Bot'); };
  const until = (test, ms, what) => new Promise((resolve, reject) => {
    const t0 = performance.now();
    const iv = setInterval(() => { const r = test(); if (r) { clearInterval(iv); resolve(r); } else if (performance.now() - t0 > ms) { clearInterval(iv); reject(new Error(what + ' timeout (' + JSON.stringify(ED().Net.lobby) + ')')); } }, 30);
  });
  BR.coopHost = async (cls) => {
    if (!hasNet()) return { skip: 'ED.Net lobby API or the local transport is missing' };
    const E = ED(); ensure(); E.App.sel.cls = cls;
    E.Net.host('Host', cls);
    await until(() => E.Net.lobby.status === 'open' || E.Net.lobby.status === 'error', 8000, 'host open');
    if (E.Net.lobby.status === 'error') throw new Error(E.Net.lobby.error);
    return { code: E.Net.lobby.code };
  };
  BR.coopJoin = async (code, cls) => {
    if (!hasNet()) return { skip: 'ED.Net lobby API or the local transport is missing' };
    const E = ED(); ensure(); E.App.sel.cls = cls;
    C.maxHeroes = 0; C.maxFoes = 0;
    E.Net.join(code, 'Guest', cls);
    await until(() => E.Net.lobby.status === 'open' || E.Net.lobby.status === 'error', 8000, 'join');
    if (E.Net.lobby.status === 'error') throw new Error(E.Net.lobby.error);
    E.Net.setReady(true);
    clearInterval(C.sample);
    C.sample = setInterval(() => { const v = E.Game.mode === 'client' && E.Game.view; if (v) { C.maxHeroes = Math.max(C.maxHeroes, v.heroes.length); C.maxFoes = Math.max(C.maxFoes, v.foes.length); } }, 100);
    const L = E.Net.lobby, m = L.members.find(x => x.pid === L.me);
    return { pid: L.me, slot: m ? m.slot : -1 };
  };
  BR.coopLobby = () => { const L = ED().Net.lobby; return { members: L.members.length, ready: L.canStart, codec: true }; };
  // Host: starts the party's run (god cheat) once every guest is ready; both peers enter the run through ED.App.enterRun.
  BR.coopStart = async () => {
    const E = ED();
    await until(() => E.Net.lobby.canStart, 5000, 'guest ready');
    if (!E.Net.start({ god: true }, cfg.seed)) return { skip: 'ED.Net.start refused' };
    BR.drive = true;
    return { players: E.Game.w ? E.Game.w.heroes.length : 0 };
  };
  BR.coopStats = () => {
    const E = ED(), n = E.Game.netStats ? E.Game.netStats() : {};
    if (n.mode === 'host') return { mode: 'host', clients: n.clients.length, sent: n.clients.reduce((a, c) => a + (c.bytes ? 1 : 0), 0), encMs: 0 };
    return { snaps: n.snaps || 0, maxBytes: n.maxBytes || 0, avgBytes: n.snaps ? Math.round(n.bytes / n.snaps) : 0, maxHeroes: C.maxHeroes || 0, maxFoes: C.maxFoes || 0,
      corrMean: n.corrN ? +(n.corrSum / n.corrN).toFixed(2) : 0, decodeErr: '', closed: E.Game.mode === 'client' ? '' : 'guest left the run' };
  };
  BR.coopStop = () => { clearInterval(C.sample); BR.drive = false; try { ED().Net.leave(); } catch (e) { /* gone */ } };
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
    if (o.scens.some(s => s.startsWith('crowd') || s.startsWith('late'))) opts.args.push('--disable-frame-rate-limit', '--disable-gpu-vsync'); // frame interval = real throughput, not the 60 Hz vsync cap
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
      if (secs >= 8 && !st.q) fail(res, `${cls}: Q cast ${st.q}`);
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
      await wait(700); // card pop-in animation
      await shot(`${String(k++).padStart(2, '0')}-levelup`);
      await page.evaluate(() => { window.__BR.autoPick = true; });
      await page.waitForFunction(() => document.getElementById('ov-offer').hidden, null, { timeout: 3000 }).catch(() => {});
      // chest: an elite chest (levels a passive or the skill)
      await dbg(page, 'give', 'might', 1);
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

const LATE = { a: ['knight', 'whirlwind'], b: ['ranger', 'hail'], c: ['pyro', 'inferno'] };
async function scenLate(sc) {
  const o = S.opt, set = sc.slice(4) || 'a', res = newResult(sc), secs = o.seconds || 6;
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info) + (o.software ? ', launched without GPU' : ''));
    await call(page, 'settings', o.quality);
    await call(page, 'start', LATE[set][0], 0, { god: true });
    await wait(500);
    const prep = await page.evaluate((F) => {
      const E = window.ED, D = E.Debug, w = E.Game.w, p = w.heroes[0];
      D.give(F, 1);
      const ws = p.weapons[0];
      if (ws) { for (let i = 0; i < 3; i++) while (w.rankPath(p, ws, i)); }
      for (const id of ['might', 'reach', 'duration', 'multishot', 'haste', 'velocity']) D.give(id, 99);
      D.setTime(1500);
      const boss = D.spawnBoss();
      return { weapons: p.weapons.map(x => x.id + ':' + x.pr.join('') + 'r' + x.fl), form: !!(ws && ws.id === F), passives: p.passives.length, boss };
    }, LATE[set][1]);
    res.notes.push('staged: ' + LATE[set][0] + ' ' + prep.weapons.join(',') + ', ' + prep.passives + ' passives' + (prep.boss ? ', boss' : ', no boss'));
    if (!prep.form || prep.passives < 6) fail(res, 'staging gave form ' + prep.form + ', ' + prep.passives + ' of 6 passives');
    await call(page, 'hold', 900, true);
    await wait(2500);
    const m = await call(page, 'measure', secs * 1000);
    const z = await page.evaluate(() => { const B = window.ED.Batch; return { n: B.zoneN, load: +B.zoneLoad.toFixed(2), lite: B.zoneLite, union: B.zoneUnion }; });
    res.rows.push(Object.assign({ quality: o.quality }, m));
    const lim = m.batch === 'gl' ? 4 : 8, over = m.render.p95 > lim;
    res.notes.push(`own zones in view ${z.n}, coverage ${z.load}x view, 2D zone LOD ${z.lite ? (z.union ? 'on (union paths)' : 'on') : 'off'}`);
    res.notes.push(`gate (Render.frame p95 <= ${lim} ms, ${m.batch}): ${over ? 'OVER' : 'ok'} — p95 ${m.render.p95} ms`);
    if (o.gate && over) fail(res, `render p95 ${m.render.p95} ms > ${lim} ms`);
    await shoot(page, res, sc + (o.software ? '-soft' : ''));
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
        res.rows.push(Object.assign({ kind: 'run' }, s));
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

// Bot watch mode: the page runs the bot (ED.Bot) at speed 8; sim time against real time, movement, automatic picks, speed keys and pause.
async function scenBotwatch() {
  const o = S.opt, res = newResult('botwatch'), secs = o.seconds || 20;
  const { ctx, page, errors, info } = await openPage('?bot=1&speed=8&seed=' + (o.seed >>> 0));
  const need = (cond, note) => { if (!cond) fail(res, note); };
  const st = () => page.evaluate(() => {
    const E = window.ED, A = E.App, G = E.Game, w = G.w, me = w && w.hero(G.myPid), B = A.bot;
    return { app: A.state, real: performance.now() / 1000, time: w ? w.time : -1, x: me ? me.x : 0, y: me ? me.y : 0, level: w ? w.level : 0, kills: w ? w.kills : 0, hp: me ? Math.round(me.hp) : 0,
      picks: window.__BR.mine.pick || 0, botPicks: B ? B.picks : -1, speed: B ? B.speed : 0, rate: B ? +B.rate.toFixed(2) : 0, tag: (G.view && G.view.botTag) || '', paused: !!G.paused, offerShown: !document.getElementById('ov-offer').hidden };
  });
  try {
    res.notes.push(bootNote(info));
    await call(page, 'settings', o.quality);
    const loaded = await page.waitForFunction(() => !!window.ED.Bot || !!(window.ED.App.bot && window.ED.App.bot.err), null, { timeout: 5000 }).then(() => page.evaluate(() => !!window.ED.Bot), () => false);
    if (!loaded) { fail(res, 'ED.Bot not available (tools/bot-brain.js missing or broken): ' + await page.evaluate(() => (window.ED.App.bot && window.ED.App.bot.err) || 'timeout')); return res; }
    const started = await page.evaluate(() => { const A = window.ED.App; if (!A.hasProfile) A.createProfile('Bot'); A.startSolo({ cls: 'knight', stage: 0 }); return A.state === 'run' && !!window.ED.Game.bot; });
    need(started, 'bot run did not start: ' + await page.evaluate(() => document.getElementById('title-msg').textContent));
    if (!started) return res;
    const a = await st();
    let b = a, maxD = 0, offerSeen = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) {
      await wait(500);
      const s = await st();
      if (s.app !== 'run') break;
      b = s; maxD = Math.max(maxD, Math.hypot(s.x - a.x, s.y - a.y)); if (s.offerShown) offerSeen++;
    }
    const real = b.real - a.real, sim = b.time - a.time, ratio = real > 0 ? sim / real : 0;
    res.rows.push({ real: +real.toFixed(1), sim: +sim.toFixed(1), ratio: +ratio.toFixed(2), rate: b.rate, tag: b.tag, maxD: Math.round(maxD), level: b.level, kills: b.kills, hp: b.hp, picks: b.picks, botPicks: b.botPicks, ended: b.app !== 'run' });
    const now = await st();
    if (b.app !== 'run' || now.app !== 'run') res.notes.push('run ended before ' + secs + ' s (state ' + now.app + '); measured over the live part');
    need(real >= 3, 'run was live for only ' + real.toFixed(1) + ' s');
    need(ratio > 3, `sim ran ${ratio.toFixed(2)}x real time (need > 3x)`);
    if (ratio <= 6) res.notes.push(`note: sim ran ${ratio.toFixed(2)}x real time (speed 8, below 6x on this machine)`);
    need(maxD > 40, 'hero never moved more than ' + Math.round(maxD) + ' px from the start');
    need(b.picks >= 1, 'no level-up card was picked automatically');
    need(b.botPicks === b.picks, `HUD pick counter ${b.botPicks} != pick events ${b.picks}`);
    need(/^BOT \u00d78/.test(b.tag), 'HUD tag is "' + b.tag + '"');
    need(offerSeen === 0, 'offer overlay was visible in ' + offerSeen + ' samples');
    await shoot(page, res, 'botwatch');
    if ((await st()).app === 'run') {
      await page.keyboard.press('BracketRight'); await frames(page, 3);
      const up = await st();
      await page.keyboard.press('BracketLeft'); await frames(page, 3); await page.keyboard.press('BracketLeft'); await frames(page, 3);
      const down = await st();
      need(up.speed === 16 && down.speed === 4, `speed keys: ] -> ${up.speed} (want 16), [ [ -> ${down.speed} (want 4)`);
      await page.keyboard.press('Escape'); await frames(page, 3);
      const p0 = await st(); await wait(500); const p1 = await st();
      need(p0.paused && p1.time === p0.time, `Esc: paused ${p0.paused}, sim ${p0.time.toFixed(2)} -> ${p1.time.toFixed(2)} s`);
      await page.keyboard.press('Escape'); await frames(page, 3); await wait(300);
      const p2 = await st();
      need(!p2.paused && p2.time > p1.time, 'Esc again did not resume');
      await call(page, 'stop'); await wait(300);
      need((await st()).app === 'results', 'quit did not reach the results screen');
    }
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
      if (r.name === 'smoke') out.push(`  ${w.cls.padEnd(7)} t ${w.time}s foes ${w.foes} kills ${w.kills} lvl ${w.level} hp ${w.hp} Q ${w.q} sig dmg ${w.sigDealt} weapons ${w.weapons.join(',')}`);
      else if (r.name === 'shots') out.push(`  ${w.cls.padEnd(7)} ff ${(w.ffMs / 1000).toFixed(1)} s wall -> t ${w.time}s lvl ${w.level} foes ${w.foes} projs ${w.projs} kills ${w.kills} weapons ${w.weapons.join(',')} passives ${w.passives.join(',')}`);
      else if (r.name === 'coop' || r.name === 'botwatch') out.push('  ' + Object.entries(w).map(([k, v]) => k + ' ' + v).join(', '));
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
      try { r = sc === 'smoke' ? await scenSmoke() : sc === 'shots' ? await scenShots() : sc === 'coop' ? await scenCoop() : sc === 'botwatch' ? await scenBotwatch() : sc.startsWith('late') ? await scenLate(sc) : await scenCrowd(sc); }
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
