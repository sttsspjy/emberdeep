// Headless browser harness: boots the static game in an invisible Playwright browser and runs scripted scenarios against it.
// Usage: node tools/browse.js [--scen=smoke,crowd70,shots,sheet,screens,swing,picks,cards] [--cls=knight] [--aim=DEG] [--zoom=N] [--weapon=ID,..] [--browser=chromium|firefox] [--viewport=1920x1080] [--outdir=DIR] [--seconds=N] [--root=DIR]
//   [--quality=low,high] [--ops] [--json] [--seed=1] [--strat=1] [--embers=N] [--mortal] [--software] [--forcepost] [--sync] [--warm=2.5] [--timeout=300]
// Mechanism: headless only (no headed option, no window calls); one browser per invocation, one fresh context per scenario page, all closed at exit, on error and on SIGINT.
//   A read-only node http server on 127.0.0.1 (random port) serves --root (default: this repo). Playwright resolves via require('playwright'), else %LOCALAPPDATA%\npm-cache\_npx\*\node_modules (best match for the installed browsers).
//   The game runs under window.__ED with a seeded Math.random (--seed) and frameCap off; scripted input goes through ED.Input (keys, pressed, mouse) like a player.
//   smoke: profile -> menu shot -> solo run of --cls (wielding the first --weapon, an Armory variant included) -> key-event check -> --seconds (20) of circling, attacking the nearest foe, both skills, dash, boon picks, room hops -> run shot; fails on any pageerror or console error.
//   crowdN: N live foes staged in the largest combat room through World.spawnEnemy / enterRoom (room cleared, held locked, topped up to N), hero kept alive; after --warm (2.5) s
//     measures --seconds (6) of main-thread ms per frame (Game.update, Game.render, Render.frame, HUD.draw, Post.render, whole rAF callback; busy% = rAF callback time over wall time, sys% = whole-machine CPU use during the window) at each --quality (low,high);
//     --ops adds a 3 s pass counting canvas/WebGL calls per frame by target (buf = world buffer, screen = visible canvas, other = offscreen bakes).
//   screens: 19 screenshots of every menu screen without a run (name, menu, Descend, Hearth with a buy mid-burst, Armory, Chronicle, Heroes, a staged party lobby and its Hearth,
//     results victory and fallen, the news notice, settings tabs, a confirm dialog, credits, pause); fails when ArrowDown / ArrowRight do not move focus on the menu / Hearth tabs.
//   shots: 16 screenshots: boot name screen, menu, Descend, Hearth tabs (the Armory scrolled into view), Heroes, Settings, Credits, boon offer, a run in combat, the Tab sheet tabs, the pause menu (profile gets 400 embers unless --embers).
//   sheet: a late build staged through the sim (BR.sheetStage: stratum --strat or V, two element paths, one evolved, their duo, open and Ascended boons, a fork at rank 3, six relics, a shield, an ally hero):
//     the Tab sheet Build, Build scrolled to the end, Combat, Map, and Build viewing the ally; fails on a page error or when a sheet column overflows its panel sideways.
//   swing: one contact-sheet PNG per melee weapon of --cls, its Armory variants included (or per --weapon id, forks as id@fork) (aimed --aim degrees, 0 = right, 90 = down, drawn at --zoom canvas px per world px, 2): frames at fixed times over two consecutive attacks (a combo weapon: one per step), the hold and the ease back to idle, hero and smear drawn by the game's own renderer.
//   picks: every boon id resolves to a PickFx card kind; one PNG per pick burst (each kind, fire-big, holy-ally) on the solo hero about 0.25 s after FX.handle gets the 'boon' / 'relic' event;
//     each pick cue (and the Hearth 'buy') rendered in an OfflineAudioContext: voices, peak, rms, audible length; fails on a throw, a silent cue or one longer than 0.9 s.
//   cards: a frame sheet PNG (every card frame mask at 6 x) and one PNG per boon hand staged through the sim (the hero's boons set so the cards are eligible): path gates,
//     every element, open and General, purse, Ascended, keystones, duos, an evolution, the --cls route and fork offers, a 6-card dense hand; mid-pick frames (110 and 230 ms,
//     the hide timer held, animations paused) for poison, holy, ice, lightning, shadow, general, fire-big, route and duo; the fork reveal at rank 2 and 3; a Low quality hand and pick.
//     Fails on a missing card, a card whose kind differs from ED.PickFx.kind, a frame that did not resolve, equal path gate icons, a pick without an effect layer, or Low quality leftovers.
// Output: compact table (or --json on stdout, logs on stderr); result-<browser>.json and the PNGs in --outdir (default <tmp>/wickdeep-browse). Exit 0 pass, 1 scenario failure, 2 harness error.
// Notes: Chromium runs headless on the real GPU (ANGLE D3D11, no window); --software forces SwiftShader, where the game reports Post.soft and skips post at 'high' unless --forcepost. Firefox uses its own headless GL.
//   --sync forces each frame's raster/GPU work to finish before the timer stops. Every external host is blocked (fonts and art are embedded data URIs).
//   Firefox runs with layout.frame_rate 60 (headless rAF is otherwise uncapped). Timings share the machine: read sys% before trusting a number.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

// ---------------- arguments ----------------
const FLAGS = {
  scen: 's', cls: 's', browser: 's', viewport: 's', outdir: 's', root: 's', quality: 's',
  seconds: 'n', seed: 'n', strat: 'n', embers: 'n', warm: 'n', timeout: 'n', aim: 'n', zoom: 'n', weapon: 's',
  json: 'b', ops: 'b', mortal: 'b', forcepost: 'b', software: 'b', sync: 'b', help: 'b',
};
class Fail extends Error { constructor(msg, code) { super(msg); this.code = code || 2; } }
function parseArgs(argv) {
  const o = {
    scen: 'smoke', cls: 'knight', weapon: '', browser: 'chromium', viewport: '1920x1080', outdir: path.join(os.tmpdir(), 'wickdeep-browse'), root: path.resolve(__dirname, '..'),
    quality: '', seconds: 0, seed: 1, strat: 1, embers: -1, warm: 2.5, timeout: 300, aim: 0, zoom: 2,
  };
  for (const a of argv) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m || !FLAGS[m[1]]) throw new Fail('unknown argument: ' + a + '\n(see the usage header of tools/browse.js)');
    const k = m[1], t = FLAGS[k];
    if (t === 'b') o[k] = true;
    else if (m[2] === undefined || m[2] === '') throw new Fail('--' + k + ' needs a value');
    else if (t === 'n') { const v = Number(m[2]); if (!isFinite(v)) throw new Fail('--' + k + ' needs a number'); o[k] = v; }
    else o[k] = m[2];
  }
  if (!['chromium', 'firefox'].includes(o.browser)) throw new Fail('--browser is chromium or firefox');
  const vp = /^(\d{3,5})x(\d{3,5})$/.exec(o.viewport);
  if (!vp) throw new Fail('--viewport is WxH, e.g. 1920x1080');
  o.vw = +vp[1]; o.vh = +vp[2];
  o.scens = o.scen.split(',').map(s => s.trim()).filter(Boolean);
  for (const s of o.scens) if (!/^(smoke|shots|sheet|screens|swing|picks|cards|crowd\d{1,4})$/.test(s)) throw new Fail('unknown scenario ' + s + ' (smoke, shots, sheet, screens, swing, picks, cards, crowdN)');
  if (!o.scens.length) throw new Fail('--scen is empty');
  o.qualities = o.quality ? o.quality.split(',').map(s => s.trim()) : null;
  if (o.qualities && o.qualities.some(q => q !== 'low' && q !== 'high')) throw new Fail('--quality is low, high or low,high');
  o.root = path.resolve(o.root);
  if (!fs.existsSync(path.join(o.root, 'index.html'))) throw new Fail('no index.html in --root ' + o.root);
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
    } catch (e) { /* unreadable browsers.json: score 0 */ }
    cands.push({ dir, score, mt: fs.statSync(dir).mtimeMs });
  }
  cands.sort((a, b) => b.score - a.score || b.mt - a.mt);
  for (const c of cands) { try { return require(c.dir); } catch (e) { /* try the next */ } }
  throw new Fail('playwright not found. Looked for require("playwright") and ' + path.join(npx, '*', 'node_modules', 'playwright') + '.\nInstall once outside the repo: npx --yes playwright install chromium firefox');
}

// ---------------- static server ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
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

// ---------------- in-page harness (injected into every page before the game scripts; serialised, so it may not use Node variables) ----------------
function pageBoot(cfg) {
  let ms = (cfg.seed >>> 0) || 1;
  const reseed = () => { ms = (cfg.seed >>> 0) || 1; };
  Math.random = function () { ms = (ms + 0x6D2B79F5) >>> 0; let t = ms; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const BR = window.__BR = {};
  const sleep = (n) => new Promise(r => setTimeout(r, n));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const stat = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), n = s.length, q = (k) => s[Math.min(n - 1, Math.floor(k * n))];
    let sum = 0; for (const v of a) sum += v;
    return { n, mean: r3(sum / n), p50: r3(q(0.5)), p95: r3(q(0.95)), max: r3(s[n - 1]) };
  };
  const M = { on: false, upd: [], rnd: [], wld: [], hud: [], post: [], frm: [], foes: [], ts: [] };
  const D = { on: false, flow: false, t0: 0, tq: 0, te: 0, td: 0, hops: 0, offers: 0, picks: 0, room: -1, epoch: -1, roomAt: 0, acts: { atk: 0, skill: 0, skill2: 0, dash: 0, interact: 0 } };
  const ST = { n: 0, t: 0, burst: true, rng: null, roster: [], k: 0, spawned: 0 };
  let ops = null, hooked = false;

  // waits for the game to boot, the art pages to decode and the web fonts
  BR.boot = async () => {
    const t0 = performance.now();
    while (!(window.__ED && window.__ED.App && window.__ED.App.state !== 'boot')) {
      if (performance.now() - t0 > 30000) throw new Error('game did not boot within 30 s');
      await sleep(50);
    }
    const ED = window.__ED;
    if (ED.Atlas && ED.Atlas.ready) await Promise.race([ED.Atlas.ready.then(() => 1, () => 0), sleep(5000)]);
    if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(3000)]);
    return true;
  };

  BR.info = () => {
    const ED = window.__ED, R = ED.Render, P = ED.Post;
    let gl = '';
    try {
      const g = document.createElement('canvas').getContext('webgl'), d = g && g.getExtension('WEBGL_debug_renderer_info');
      gl = g ? String(d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'no webgl';
    } catch (e) { gl = 'error: ' + e.message; }
    return {
      ua: navigator.userAgent, gl, dpr: window.devicePixelRatio, inner: [innerWidth, innerHeight], quality: R.quality, canvas: [R.W, R.H, R.dpr, R.bw, R.bh, R.scale],
      post: P ? { ready: !!P.ready, soft: !!P.soft, lost: !!P.lost, error: P.error || null, usePost: !!R.usePost(), posting: !!R.posting } : null,
    };
  };

  // profile with a name, the tutorial off, the hero chosen; embers >= 0 sets the purse; weapon (a weapon id of the hero, an Armory variant included): mastery 6, the variant owned, the weapon chosen
  BR.profile = (cls, embers, weapon) => {
    const ED = window.__ED, A = ED.App;
    if (!ED.CLASSES[cls]) throw new Error('unknown hero ' + cls + ' (have ' + ED.CLASS_IDS.join(', ') + ')');
    if (!A.hasProfile) A.createProfile('Tester');
    A.profile.stats.runs = Math.max(A.profile.stats.runs | 0, 5);
    if (embers >= 0) A.profile.embers = embers;
    if (weapon) {
      if (ED.weaponIndex(cls, weapon) < 0) throw new Error('unknown weapon ' + weapon + ' of ' + cls + ' (have ' + ED.weaponChoices(cls).join(', ') + ')');
      const ci = ED.CLASS_IDS.indexOf(cls), ai = ED.ARMORY[cls].findIndex(e => e.id === weapon);
      A.profile.mastery[ci] = Math.max(A.profile.mastery[ci] | 0, ED.MASTERY_XP[5]);
      if (ai >= 0) A.profile.armory[cls][ai] = 1;
    }
    A.persist();
    A.selectClass(cls);
    if (weapon) { A.sel.weapon = weapon; A.saveSel(); if (A.weaponFor(cls) !== weapon) throw new Error('the weapon choice ' + weapon + ' did not hold'); }
    return A.state;
  };
  BR.settings = (quality) => {
    const ED = window.__ED, A = ED.App;
    A.settings.frameCap = 'off';
    if (cfg.forcepost && ED.Post) ED.Post.soft = false;
    A.settings.quality = quality;
    A.applySettings();
    if (cfg.forcepost || cfg.sync) ED.Render.resize();
    ED.Render.syncWorld = !!cfg.sync;
    if (ED.Post) ED.Post.sync = !!cfg.sync;
    return BR.info();
  };
  BR.start = () => { const A = window.__ED.App; reseed(); A.startSolo(); return A.state; }; // reseeded: the same floor for the same --seed

  // per-metric timers, the rAF callback timer and the stage tick (after Game.update, outside its timer)
  BR.install = () => {
    if (hooked) return;
    hooked = true;
    const ED = window.__ED;
    const timed = (obj, key, arr) => {
      const f = obj[key];
      obj[key] = function () { if (!M.on) return f.apply(this, arguments); const t = performance.now(); try { return f.apply(this, arguments); } finally { M[arr].push(performance.now() - t); } };
    };
    timed(ED.Game, 'update', 'upd'); timed(ED.Game, 'render', 'rnd'); timed(ED.Render, 'frame', 'wld'); timed(ED.HUD, 'draw', 'hud'); if (ED.Post) timed(ED.Post, 'render', 'post');
    const upd = ED.Game.update;
    ED.Game.update = function (dt) { const r = upd.apply(this, arguments); stageTick(dt); return r; };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => raf((ts) => {
      if (!M.on && !ops) { fn(ts); return; }
      const a = performance.now();
      try { fn(ts); } finally { if (M.on) { M.ts.push(ts); M.frm.push(performance.now() - a); } if (ops) ops.frames++; }
    });
    const sb = ED.UI.showBoons, pb = ED.UI.pickBoon;
    ED.UI.showBoons = function () { D.offers++; return sb.apply(this, arguments); };
    ED.UI.pickBoon = function () { D.picks++; return pb.apply(this, arguments); };
    const act = ED.Game.act;
    ED.Game.act = function (a) {
      if (a) { const k = a.t === 'skill' ? (a.slot ? 'skill2' : 'skill') : a.t; if (k in D.acts) D.acts[k]++; }
      return act.apply(this, arguments);
    };
  };

  function stageTick(dt) {
    const ED = window.__ED, s = ED.Game.s;
    if (!s || !s.world) return;
    const w = s.world;
    if (!cfg.mortal) {
      for (const p of w.players.values()) if (!p.dead) { p.hp = p.maxHp; p.downed = false; }
      w.light = w.lightMax;
    }
    if (ST.n <= 0 || !w.room) return;
    w.locked = true;
    if (M.on) {
      let alive = 0;
      for (const e of w.enemies) if (e.hp > 0 && !e.def.gloom) alive++;
      M.foes.push(alive);
    }
    ST.t -= dt;
    if (ST.t > 0) return;
    ST.t = 0.1;
    let alive = 0;
    for (const e of w.enemies) if (e.hp > 0 && !e.def.gloom) alive++;
    if (alive > ST.n * 1.25) {
      let extra = alive - ST.n;
      for (let i = w.enemies.length - 1; i >= 0 && extra > 0; i--) { const e = w.enemies[i]; if (e.hp > 0 && !e.boss && !e.def.gloom) { e.killed = true; e.hp = 0; extra--; } }
      return;
    }
    let need = ST.n - alive;
    if (!ST.burst) need = Math.min(need, 24);
    ST.burst = false;
    if (need <= 0 || !ST.roster.length) return;
    const avoid = []; for (const p of w.players.values()) avoid.push(p);
    while (need-- > 0) {
      const pt = ED.Dungeon.randomFloor(w.room, ST.rng, avoid, 80);
      w.spawnEnemy(ST.roster[ST.k++ % ST.roster.length], pt.x, pt.y);
      ST.spawned++;
    }
  }

  // stages n live foes in the largest combat room of stratum `strat`; n = 0 releases the stage
  BR.stage = (n, strat) => {
    const ED = window.__ED, s = ED.Game.s;
    if (!s || !s.world) throw new Error('no run to stage in');
    const w = s.world;
    if (!n) { ST.n = 0; return null; }
    if (strat && strat !== w.stratum) w.enterStratum(strat);
    let best = null;
    for (const r of w.floor.rooms) if ((r.type === 'combat' || r.type === 'elite') && (!best || r.w * r.h > best.w * best.h)) best = r;
    if (!best) for (const r of w.floor.rooms) if (r.type !== 'boss' && r.type !== 'start' && (!best || r.w * r.h > best.w * best.h)) best = r;
    if (!best) throw new Error('no stageable room');
    w.roomState[best.id].cleared = true;
    w.enterRoom(best.id, null);
    ST.roster = ED.biomeFor(w.stratum).enemies.map(r => r[0]).filter(id => { const d = ED.ENEMIES[id]; return d && !d.boss && !d.gloom && !d.ally && !d.minion; });
    ST.rng = ED.U.RNG(cfg.seed * 7919 + 13); ST.k = 0; ST.spawned = 0; ST.burst = true; ST.t = 0; ST.n = n;
    return { room: best.id, w: best.w, h: best.h, stratum: w.stratum, roster: ST.roster.length };
  };

  // scripted hero: orbits the nearest foe (the room centre when none), attacks it, casts both skills, dashes, takes boon offers, hops combat rooms when `flow`
  BR.drive = (on, flow) => {
    D.on = !!on; D.flow = !!flow; D.t0 = performance.now(); D.tq = D.te = D.td = 0;
    if (!on) { const I = window.__ED.Input; for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Mouse0']) I.keys.delete(k); }
  };
  setInterval(() => {
    if (!D.on) return;
    const ED = window.__ED, s = ED && ED.Game && ED.Game.s;
    if (!s || !s.world || !s.me) return;
    const w = s.world, me = s.me, I = ED.Input, R = ED.Render, T = ED.CONST.TILE;
    const t = (performance.now() - D.t0) / 1000;
    if (s.offerOpen) ED.UI.boonConfirm();
    if (D.flow) {
      const cmb = (r) => r.type === 'combat' || r.type === 'elite';
      if (D.room !== w.roomId || D.epoch !== w.roomEpoch) { D.room = w.roomId; D.epoch = w.roomEpoch; D.roomAt = t; }
      const here = t - D.roomAt, rs = w.roomState[w.roomId];
      let go = here > 30;
      if (!cmb(w.room) && here > 0.9 && (!(me.picks | 0) || here > 8)) go = true;
      if (cmb(w.room) && rs && rs.cleared && w.hostiles() === 0 && here > 3 && !s.offerOpen) go = true;
      if (go && !w.pendingStratum && w.state === 'play') {
        const rooms = w.floor.rooms.filter(cmb);
        let nxt = rooms.find(r => r.id !== w.roomId && !w.roomState[r.id].cleared);
        if (!nxt) { nxt = rooms.find(r => r.id !== w.roomId) || rooms[0]; if (nxt) w.roomState[nxt.id].cleared = false; }
        if (nxt) { w.enterRoom(nxt.id, null); D.hops++; }
      }
    }
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) I.keys.delete(k);
    if (me.dead || me.downed || !w.room) return;
    let tgt = null, bd = 1e12;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.burrowed || (e.def && e.def.gloom)) continue;
      const d = (e.x - me.x) * (e.x - me.x) + (e.y - me.y) * (e.y - me.y);
      if (d < bd) { bd = d; tgt = e; }
    }
    const ax = tgt ? tgt.x : w.room.w * T / 2, ay = tgt ? tgt.y : w.room.h * T / 2;
    const dx = ax - me.x, dy = ay - me.y, d = Math.hypot(dx, dy) || 1, sg = Math.floor(t / 1.2) % 2 ? 1 : -1;
    const want = tgt ? 90 : 110;
    let mx = -dy / d * sg, my = dx / d * sg; // tangent: circles the anchor
    if (d > want * 1.5) { mx = dx / d; my = dy / d; } else if (d > want) { mx += dx / d * 0.6; my += dy / d * 0.6; } else if (d < want * 0.6) { mx -= dx / d * 0.6; my -= dy / d * 0.6; }
    if (mx > 0.35) I.keys.add('KeyD'); else if (mx < -0.35) I.keys.add('KeyA');
    if (my > 0.35) I.keys.add('KeyS'); else if (my < -0.35) I.keys.add('KeyW');
    const px = tgt ? tgt.x : me.x + mx * 100, py = tgt ? tgt.y : me.y + my * 100, sp = R.toScreen(px, py);
    I.mouse.x = sp.x / (R.dpr || 1); I.mouse.y = sp.y / (R.dpr || 1); I.mouse.moved = performance.now(); I.mouse.inside = true;
    if (tgt) I.keys.add('Mouse0'); else I.keys.delete('Mouse0');
    if (t >= D.tq) { I.pressed.add('KeyQ'); D.tq = t + 1.3; }
    if (t >= D.te) { I.pressed.add('KeyE'); D.te = t + 1.9; }
    if (t >= D.td) { I.pressed.add('Space'); D.td = t + 2.4; }
  }, 33);

  // contact sheet of the melee swings of `cls` aimed `aimDeg` degrees (0 = right, 90 = down): one PNG per weapon (its Armory variants included), frames at fixed times (idle, then per attack wind, strike, end, settled,
  // then hold and ease to idle): two attacks, or one per step of a combo weapon (each drawn with its step's form); the hero drawn by Sprites.hero from a fake player and the smear (a slam: FX.slam) by FX.drawGlow; needs a run (FX.playerAttackAnim reads the world view)
  BR.swingStrip = (cls, aimDeg, zoom, weapons) => {
    const ED = window.__ED, F = ED.FX, view = ED.Game.s.view, out = [], pid = 'sw-fake', face = aimDeg * Math.PI / 180, K2 = zoom, CW = 120 * zoom, CH = 140 * zoom, COLS = zoom > 2 ? 5 : 7;
    F.reset();
    for (const wid of weapons.length ? weapons : ED.weaponChoices(cls)) {
      const w = ED.Sprites.weaponArt({ cls, weapon: wid }).w; if (w.kind !== 'melee') continue;
      const p = { pid, cls, slot: 0, weapon: wid, face, moving: false, hp: 1, x: 0, y: 0 }, fst = { weapon: w }, nA = w.combo ? w.combo.steps.length : 2;
      const sw = (k) => (w.combo ? ED.Stats.stepWeapon(fst, k) : null);
      view.players.set(pid, p);
      const mk = (k) => { if (F.anim[pid]) F.anim[pid].atkT = 9; F.playerAttackAnim(pid, face, sw(k)); return Object.assign({}, F.anim[pid]); };
      const S = []; for (let k = 0; k < nA; k++) S.push(mk(k));
      const an = F.anim[pid], t0 = S[0].t0, t1 = S[0].t1, D = S[0].D, st = (f) => t0 + (t1 - t0) * f, fr = [[-1, 9, 'idle']];
      for (let k = 0; k < nA; k++) { const a = 'a' + (k + 1); fr.push([k, t0 * 0.9, a + ' wind'], [k, st(0.3), a + ' strike'], [k, st(0.6), a + ' strike'], [k, t1, a + ' end'], [k, D, a + ' settled']); }
      fr.push([nA - 1, D + 0.5, 'hold'], [nA - 1, D + 0.9, 'ease'], [nA - 1, D + 1.3, 'idle']);
      const cv = document.createElement('canvas'); cv.width = COLS * CW; cv.height = Math.ceil(fr.length / COLS) * CH;
      const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      for (let pass = 0; pass < 2; pass++) { // the first pass queues every weapon rotation, Atlas.tick bakes them all, the second pass is the one kept
      fr.forEach((f, i) => {
        const x0 = (i % COLS) * CW, y0 = Math.floor(i / COLS) * CH;
        c.save(); c.beginPath(); c.rect(x0, y0, CW, CH); c.clip();
        c.fillStyle = '#2b2733'; c.fillRect(x0, y0, CW, CH);
        c.setTransform(K2, 0, 0, K2, x0 + CW / 2, y0 + CH * 0.62);
        if (f[0] >= 0) { Object.assign(an, S[f[0]]); an.atkT = f[1]; } else { Object.assign(an, S[0]); an.atkT = 9; }
        F.lastAnim = an;
        ED.Sprites.hero(c, p, 0, an);
        if (f[0] >= 0 && f[1] >= an.t0 && f[1] < an.D + 0.1) {
          const ws = sw(f[0]) || w;
          if (ws.ahead) { F.slam(0, -10, face, ws.range, ws.ahead.r, ED.PLAYER_COLORS[0], true); F.rings.length = 0; F.pops.length = 0; } else F.slash(0, -10, face, ws.range, Math.min(6.3, ws.arc), ED.PLAYER_COLORS[0]);
          const sl = F.slashes[F.slashes.length - 1]; sl.life = sl.max - f[1];
          c.globalCompositeOperation = 'lighter'; F.drawGlow(c, 0); c.globalCompositeOperation = 'source-over';
          F.slashes.length = 0;
        }
        c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#d8d4e0'; c.font = '12px monospace'; c.fillText(f[2] + ' ' + (f[1] < 9 ? f[1].toFixed(2) : ''), x0 + 6, y0 + 15);
        c.restore();
      });
      if (!pass) ED.Atlas.tick(10000);
      }
      out.push({ weapon: wid, url: cv.toDataURL('image/png'), side: S.map(q => q.side), times: [t0, t1, D] });
      view.players.delete(pid);
    }
    return out;
  };

  BR.runState = () => {
    const ED = window.__ED, A = ED.App, s = ED.Game.s, w = s && s.world, me = s && s.me;
    return {
      app: A.state, world: w ? w.state : null, time: w ? r3(w.time) : 0, stratum: w ? w.stratum : 0, room: w && w.room ? w.room.type : null, roomId: w ? w.roomId : -1,
      kills: w ? w.run.kills : 0, roomsCleared: w ? w.run.roomsCleared : 0, level: w ? w.level : 0, hp: me ? Math.round(me.hp) : 0, dead: me ? !!me.dead : null,
      foes: w ? w.hostiles() : 0, offers: D.offers, picks: D.picks, hops: D.hops, acts: Object.assign({}, D.acts), cls: me ? me.cls : null, skill2: me ? !!ED.CLASSES[me.cls].skill2 : false,
    };
  };

  // opens a boon offer when one is queued; true when the overlay is up
  BR.offerOpen = () => { const s = window.__ED.Game.s; return !!(s && s.offerOpen); };
  BR.take = () => { const ED = window.__ED; if (ED.Game.s && ED.Game.s.offerOpen) ED.UI.boonConfirm(); return BR.offerOpen(); };

  // late build on the solo hero at stratum `strat`: two element paths (the first evolved, the second at its keystone), their duo, open boons, two Ascended, the first route with its first fork at rank 3,
  // six relics, level 14, a shield, half the floor explored, and an ally hero (second class) beside the hero; returns a summary
  BR.sheetStage = (strat) => {
    const ED = window.__ED, s = ED.Game.s, w = s && s.world;
    if (!w) throw new Error('no run to stage the sheet in');
    if (strat && strat !== w.stratum) w.enterStratum(strat);
    const p = s.me, B = ED.BOONS, cls = p.cls, els = ED.ELEMENT_IDS.filter(e => e !== ED.CLASSES[cls].element).slice(0, 2), boons = {};
    const pathIds = (path) => Object.keys(B).filter(id => B[id].path === path && !B[id].open && !B[id].cls);
    for (const [i, el] of els.entries()) {
      const ids = pathIds(el), gate = ids.find(id => B[id].gate), key = ids.find(id => B[id].key), evo = ids.find(id => B[id].evo);
      boons[gate] = 1;
      const want = i === 0 ? ED.EVO_AFFINITY : ED.KEY_AFFINITY;
      for (const id of ids) { if (B[id].gate || B[id].key || B[id].evo || B[id].need === (ED.CLASSES[cls].kind === 'melee' ? 'proj' : 'melee')) continue; if (ED.pathAffinity(boons, el) + 1 >= want) break; boons[id] = Math.min(B[id].max || 5, Math.max(1, want - 1 - ED.pathAffinity(boons, el))); }
      if (key) boons[key] = 1;
      if (i === 0 && evo) boons[evo] = 1;
    }
    const duo = ED.duoOf(els[0], els[1]); if (duo) boons[duo] = 1;
    Object.keys(B).filter(id => B[id].open && !B[id].purse && !B[id].asc && !B[id].cls).slice(0, 4).forEach((id, i) => { boons[id] = Math.min(B[id].max || 5, i + 1); });
    Object.keys(B).filter(id => B[id].asc).slice(0, 2).forEach(id => { boons[id] = 1; });
    const route = ED.CLASS_CARDS[cls][ED.ROUTES[0]]; boons[route.t1] = 1; boons[route.forks[0]] = Math.min(3, B[route.forks[0]].max || 3);
    p.boons = boons; p.relics = Object.keys(ED.RELICS).slice(0, 6);
    w.recalc(p, true); w.sendBuild(p);
    p.shield = Math.round(p.maxHp * 0.18 * 10) / 10 + 0.4;
    w.level = Math.max(w.level | 0, 14); if (ED.World.xpFor) { w.xpNext = ED.World.xpFor(w.level); w.xp = Math.floor(w.xpNext * 0.62); } w.gold = 347;
    p.hp = Math.max(1, Math.ceil(p.maxHp * 0.7) - 0.3);
    const rooms = w.floor.rooms; rooms.forEach((r, i) => { if (i % 2 === 0) { w.roomState[r.id].visited = true; w.roomState[r.id].known = true; w.roomState[r.id].cleared = true; } else w.roomState[r.id].known = i % 4 === 1; });
    let ally = null;
    if (!w.players.has('ally')) {
      const ac = ED.CLASS_IDS.find(c => c !== cls);
      ally = w.addPlayer({ pid: 'ally', name: 'Wren', slot: 1, cls: ac, weapon: ED.weaponChoices(ac)[0] });
      ally.x = p.x + 30; ally.y = p.y; ally.hp = Math.ceil(ally.maxHp * 0.6);
    }
    return { cls, els, boons: Object.keys(boons).length, relics: p.relics.length, stratum: w.stratum, ally: ally && ally.cls };
  };

  // cards: a boon offer staged through the sim (the hero's boons set so the cards are eligible, the hand sent as the sim's own offer message); returns each card's kind
  BR.cardHand = (boons, ids, spec) => {
    const ED = window.__ED, s = ED.Game.s, w = s && s.world, p = s && s.me;
    if (!w || !p) throw new Error('no run to stage cards in');
    for (const id of ids) if (!ED.BOONS[id]) throw new Error('unknown boon ' + id);
    ED.UI.hideBoons();
    p.boons = Object.assign({}, boons); w.recalc(p, false); w.sendBuild(p);
    p.offers = [Object.assign({ src: 'level', path: null }, spec || {})]; p.picks = 1; p.offer = ids.slice(); p.offerT = 0;
    w.sendOffer(p);
    return ids.map(id => ED.PickFx.kind(id) + (ED.PickFx.big(id) ? '+big' : ''));
  };
  // the shown hand: per card its kind, whether its frame resolved, its icon URL, its box; plus the overlay's low flag
  BR.cardDom = () => {
    const cards = [...document.querySelectorAll('#boon-cards .boon-card')];
    return { open: !document.getElementById('ov-boon').hidden, low: document.getElementById('ov-boon').classList.contains('low'), cards: cards.map(c => { const r = c.getBoundingClientRect(); return { kind: c.dataset.kind, frame: getComputedStyle(c, '::after').borderImageSource !== 'none', icon: (c.querySelector('.bc-icon') || {}).src || '', w: r.width, h: r.height }; }) };
  };
  // the pick of card i through UI.pickBoon with its hide timer held; every animation paused at t ms (cardSeek moves them, cardRelease resumes and runs the held hide)
  BR.cardPick = (i, t) => {
    const ED = window.__ED, st = window.setTimeout;
    let cb = null;
    window.setTimeout = (f) => { cb = f; return 1e9; };
    try { ED.UI.pickBoon(i); } finally { window.setTimeout = st; }
    BR._held = cb;
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
    return { held: !!cb, fx: document.querySelectorAll('#ov-boon .pick-fx').length };
  };
  BR.cardSeek = (t) => { for (const a of document.getAnimations()) a.currentTime = t; return true; };
  BR.cardRelease = () => { for (const a of document.getAnimations()) a.play(); const cb = BR._held; BR._held = null; if (cb) cb(); return !document.getElementById('ov-boon').hidden; };
  // the fork rank reveal of fork `id` at `rank`, its unfurl finished; returns its box
  BR.forkShow = (id, rank) => {
    const ED = window.__ED, el = document.getElementById('ov-fork');
    ED.UI.forkReveal({ id, rank });
    for (const a of el.getAnimations({ subtree: true })) { if (a.animationName === 'fork-out') a.pause(); else a.finish(); }
    const r = el.getBoundingClientRect();
    return { shown: !el.hidden, x: r.left, y: r.top, w: r.width, h: r.height };
  };
  // every card frame mask (kinds x metals, the big trims, three duo splits, a route frame per hero) drawn at 6 x on one sheet: PNG data URL
  BR.cardSheet = (cls) => {
    const ED = window.__ED, CA = ED.CardArt, PU = ED.PixUI, Z = 5, M = ['iron', 'silver', 'violet', 'gold'], rows = [];
    for (const k of ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow', 'general', 'asc', 'purse']) rows.push([k, M.map(m => CA.frame(k, m, {})).concat(k === 'asc' || k === 'purse' ? [] : [CA.frame(k, 'gold', { big: true })])]);
    rows.push(['route', M.map(m => CA.frame('route', m, { cls }))]);
    rows.push(['duo', [['fire', 'ice'], ['holy', 'shadow'], ['lightning', 'poison'], ['ice', 'fire']].map(([a, b]) => CA.frame('duo', 'violet', { a, b }))]);
    const cw = CA.N * Z + 12, cv = document.createElement('canvas'); cv.width = 90 + cw * 5; cv.height = rows.length * cw + 12;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.fillStyle = '#15100d'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = '16px "Pixel Operator", monospace'; g.fillStyle = '#f6ecda';
    rows.forEach(([label, vars], j) => {
      g.fillText(label, 8, j * cw + 30);
      vars.forEach((v, i) => { const name = /--fr-([\w-]+)/.exec(v)[1], rec = PU.frames[name]; if (rec) g.drawImage(rec.img.base, 90 + i * cw, j * cw + 6, CA.N * Z, CA.N * Z); });
    });
    return cv.toDataURL();
  };

  // picks: every boon id resolves to a PickFx kind; a pick burst (name: kind, kind-big or kind-ally) fired through FX.handle on a cleared effect layer; the pick cues rendered offline
  BR.pickKinds = () => {
    const ED = window.__ED, P = ED.PickFx, bad = [], by = {};
    for (const id in ED.BOONS) { const k = P.kind(id); if (!P.KINDS.includes(k)) bad.push(id + ':' + k); by[k] = (by[k] || 0) + 1; }
    return { bad, by, n: Object.keys(ED.BOONS).length };
  };
  BR.pickBurst = (name) => {
    const ED = window.__ED, P = ED.PickFx, s = ED.Game.s, me = s.me, [kind, v] = name.split('-'), big = v === 'big';
    let id = kind === 'relic' ? Object.keys(ED.RELICS)[0] : null;
    if (!id) for (const k in ED.BOONS) if (P.kind(k) === kind && P.big(k) === big && (kind !== 'route' || ED.BOONS[k].cls === me.cls)) { id = k; break; }
    if (!id) throw new Error('no card of kind ' + name);
    ED.FX.reset();
    ED.FX.handle({ t: kind === 'relic' ? 'relic' : 'boon', pid: v === 'ally' ? 'ally-fake' : me.pid, id, x: me.x, y: me.y }, s.fxCtx);
    const R = ED.Render, d = R.dpr || 1, sp = R.toScreen(me.x, me.y);
    return { id, x: sp.x / d, y: sp.y / d, k: R.scale / d };
  };
  // list: [{ label, cue, arg }], one cue every 1.5 s of an OfflineAudioContext; per cue: voices spawned, peak, rms, audible length (last sample above 1e-3)
  BR.pickAudio = async (list) => {
    const ED = window.__ED, A = ED.Audio, sr = 22050, step = 1.5, oc = new OfflineAudioContext(1, Math.ceil(sr * step * list.length), sr), rows = [];
    A.attach(oc, { offline: true });
    list.forEach((c, i) => {
      A.clock = i * step + 0.05;
      let err = null;
      try { A.play(c.cue, 1, c.arg); } catch (e) { err = String((e && e.message) || e); }
      rows.push({ label: c.label, voices: A.voices(), err });
    });
    A.ready = false; A.clock = null; // the game schedules nothing more into the offline graph
    const d = (await oc.startRendering()).getChannelData(0);
    rows.forEach((r, i) => {
      const a = Math.floor((i * step + 0.05) * sr), b = Math.min(d.length, Math.floor((i + 1) * step * sr));
      let pk = 0, last = a, ss = 0;
      for (let j = a; j < b; j++) { const x = Math.abs(d[j]); if (x > pk) pk = x; if (x > 1e-3) last = j; ss += x * x; }
      r.peak = r3(pk); r.rms = Math.round(1e4 * Math.sqrt(ss / Math.max(1, b - a))) / 1e4; r.len = r3((last - a) / sr);
    });
    return rows;
  };

  BR.measure = async (n) => {
    for (const k in M) if (Array.isArray(M[k])) M[k] = [];
    const ED = window.__ED, w = ED.Game.s && ED.Game.s.world, k0 = w ? w.run.kills : 0, t0 = performance.now();
    M.on = true; await sleep(n); M.on = false;
    const secs = (performance.now() - t0) / 1000, R = ED.Render;
    const d = []; for (let i = 1; i < M.ts.length; i++) d.push(M.ts[i] - M.ts[i - 1]);
    let busy = 0; for (const v of M.frm) busy += v;
    return {
      secs: r3(secs), frames: M.frm.length, fps: r3(M.frm.length / secs), busyPct: r3(busy / (secs * 10)), kills: w ? w.run.kills - k0 : 0,
      update: stat(M.upd), render: stat(M.rnd), world: stat(M.wld), hud: stat(M.hud), post: stat(M.post), frame: stat(M.frm), raf: stat(d), foes: stat(M.foes),
      staged: ST.n, spawned: ST.spawned, info: BR.info(), canvas: [R.W, R.H, R.dpr, R.bw, R.bh, R.scale],
    };
  };

  // counts draw calls per rAF frame: wrappers go on the 2D and WebGL prototypes for this window only, so the timing pass stays clean
  BR.ops = async (n) => {
    const ED = window.__ED, R = ED.Render;
    ops = { frames: 0, c: {} };
    const tag = (cv) => (cv === R.canvas ? 'screen' : cv && cv.width === R.bw && cv.height === R.bh ? 'buf' : 'other');
    const undo = [];
    const wrap = (proto, keys, tagger) => {
      for (const k of keys) {
        const f = proto[k];
        if (typeof f !== 'function') continue;
        proto[k] = function () { if (ops) { const key = tagger(this) + '.' + k; ops.c[key] = (ops.c[key] || 0) + 1; } return f.apply(this, arguments); };
        undo.push(() => { proto[k] = f; });
      }
    };
    const K2 = ['drawImage', 'fillRect', 'strokeRect', 'clearRect', 'fill', 'stroke', 'clip', 'fillText', 'strokeText', 'measureText', 'arc', 'ellipse', 'putImageData', 'getImageData', 'createLinearGradient', 'createRadialGradient', 'createPattern', 'setTransform', 'save', 'restore'];
    wrap(CanvasRenderingContext2D.prototype, K2, (c) => tag(c.canvas));
    if (window.OffscreenCanvasRenderingContext2D) wrap(OffscreenCanvasRenderingContext2D.prototype, K2, () => 'offscreen');
    for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (G) wrap(G.prototype, ['texImage2D', 'texSubImage2D', 'drawArrays', 'readPixels'], () => 'gl');
    const cc = document.createElement.bind(document);
    document.createElement = function (t) { if (ops && String(t).toLowerCase() === 'canvas') ops.c['dom.createCanvas'] = (ops.c['dom.createCanvas'] || 0) + 1; return cc(t); };
    undo.push(() => { document.createElement = cc; });
    const cib = window.createImageBitmap.bind(window);
    window.createImageBitmap = function () { if (ops) ops.c['dom.createImageBitmap'] = (ops.c['dom.createImageBitmap'] || 0) + 1; return cib.apply(window, arguments); };
    undo.push(() => { window.createImageBitmap = cib; });
    await sleep(n);
    const o = ops; ops = null;
    for (const u of undo) u();
    const f = Math.max(1, o.frames), per = {};
    let total = 0;
    for (const k of Object.keys(o.c).sort((a, b) => o.c[b] - o.c[a])) { per[k] = r3(o.c[k] / f); if (!/^(gl|dom)\./.test(k)) total += o.c[k]; }
    return { frames: o.frames, perFrame: per, canvasCallsPerFrame: r3(total / f) };
  };
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
  } else {
    opts.firefoxUserPrefs = { 'privacy.reduceTimerPrecision': false, 'privacy.resistFingerprinting': false, 'media.volume_scale': '0.0', 'layout.frame_rate': 60 }; // headless Firefox otherwise ticks rAF uncapped (120-180 Hz)
  }
  try { return await S.pw[o.browser].launch(opts); } catch (e) {
    throw new Fail('could not launch headless ' + o.browser + ': ' + String(e.message).split('\n')[0] + '\nInstall the browsers once: npx --yes playwright install chromium firefox');
  }
}

// A fresh context and page of the shared browser, with the in-page harness injected and every page error and console error collected.
async function openPage() {
  const o = S.opt;
  const ctx = await S.browser.newContext({ viewport: { width: o.vw, height: o.vh }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'en-US' });
  await ctx.addInitScript({ content: '(' + pageBoot.toString() + ')(' + JSON.stringify({ seed: o.seed, mortal: !!o.mortal, forcepost: !!o.forcepost, sync: !!o.sync }) + ')' });
  const local = S.server.base;
  await ctx.route((u) => u.protocol.startsWith('http') && u.origin !== local, (route) => route.abort('blockedbyclient'));
  const page = await ctx.newPage();
  const errors = [];
  const add = (kind, text, url) => { if (errors.length < 40) errors.push({ kind, text: String(text).replace(/\s+/g, ' ').slice(0, 400), url: url || '' }); };
  page.on('pageerror', (e) => add('pageerror', (e && e.stack) || e));
  page.on('crash', () => add('crash', 'page crashed'));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (url && !url.startsWith(local) && !url.startsWith('data:') && !url.startsWith('blob:')) return; // external fetch (blocked hosts): not a game bug
    add('console', m.text(), url);
  });
  await page.goto(local + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => window.__BR.boot());
  return { ctx, page, errors };
}

// whole-machine CPU use (browser included) over a window: a high value outside the browser means another job is skewing the timings
const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a[0] += t.user + t.nice + t.sys + t.irq; a[1] += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, [0, 0]);
const cpuBusy = (a) => { const b = cpuTimes(); return Math.round(1000 * (b[0] - a[0]) / Math.max(1, b[1] - a[1])) / 10; };
const call = (page, m, ...args) => page.evaluate(([name, a]) => window.__BR[name](...a), [m, args]);
const tag = () => S.opt.browser;

async function shoot(page, res, name) {
  const file = path.join(S.opt.outdir, [res.name, tag(), S.opt.cls, name].join('-') + '.png');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: file });
  res.shots.push(file);
  return file;
}

function newResult(name) { return { name, browser: S.opt.browser, cls: S.opt.cls, ok: true, notes: [], errors: [], shots: [], rows: [], wallMs: 0 }; }
function fail(res, note) { res.ok = false; res.notes.push('FAIL: ' + note); }
function qualitiesOr(def) { return S.opt.qualities || def; }

// ---------------- scenarios ----------------
async function scenSmoke() {
  const o = S.opt, res = newResult('smoke'), secs = o.seconds || 20, q = qualitiesOr(['high'])[0];
  const { ctx, page, errors } = await openPage();
  try {
    await call(page, 'profile', o.cls, o.embers, o.weapon ? o.weapon.split(',')[0] : ''); // --weapon: the smoke run wields it
    await wait(900);
    const menu = await page.evaluate(() => ({ state: window.__ED.App.state, title: !document.getElementById('scr-title').hidden, menu: !document.getElementById('title-menu').hidden }));
    if (menu.state !== 'title' || !menu.title || !menu.menu) fail(res, 'menu not shown: ' + JSON.stringify(menu));
    await shoot(page, res, 'menu');
    res.info = await call(page, 'settings', q);
    await call(page, 'install');
    const st = await call(page, 'start');
    if (st !== 'run') fail(res, 'run did not start (state ' + st + ')');
    await wait(500);
    await page.keyboard.down('KeyD');
    const held = await page.evaluate(() => window.__ED.Input.keys.has('KeyD'));
    await page.keyboard.up('KeyD');
    if (!held) fail(res, 'a real KeyD event did not reach ED.Input');
    await call(page, 'drive', true, true);
    await wait(secs * 600);
    await shoot(page, res, 'run');
    await wait(secs * 400);
    await call(page, 'drive', false, false);
    const rs = await call(page, 'runState');
    res.run = rs;
    if (rs.app !== 'run') notes(res, 'run ended before the script did (app ' + rs.app + ')');
    if (rs.time < secs * 0.5) fail(res, 'world time advanced ' + rs.time + ' s in ' + secs + ' s of wall time');
    if (!rs.kills) notes(res, 'no kill in ' + secs + ' s');
    if (rs.cls !== o.cls) fail(res, 'ran as ' + rs.cls + ', not ' + o.cls);
    if (secs >= 10) for (const k of ['atk', 'skill', 'dash']) if (!rs.acts[k]) fail(res, 'scripted input never produced a ' + k + ' action');
    if (secs >= 10 && rs.skill2 && !rs.acts.skill2) fail(res, 'scripted input never produced a skill2 action');
    res.rows.push({ quality: q, ...rs });
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}
function notes(res, n) { res.notes.push(n); }

async function scenCrowd(name) {
  const o = S.opt, n = +name.slice(5), res = newResult(name), secs = o.seconds || 6;
  if (!(n > 0)) throw new Fail('crowd needs a foe count, e.g. crowd70');
  for (const q of qualitiesOr(['low', 'high'])) {
    const { ctx, page, errors } = await openPage();
    try {
      await call(page, 'profile', o.cls, o.embers);
      const info = await call(page, 'settings', q);
      await call(page, 'install');
      await call(page, 'start');
      await wait(1200);
      const stg = await call(page, 'stage', n, o.strat);
      await call(page, 'drive', true, false);
      await wait(o.warm * 1000);
      const cpu0 = cpuTimes();
      const m = await call(page, 'measure', secs * 1000);
      m.sysBusyPct = cpuBusy(cpu0);
      let ops = null;
      if (o.ops) ops = await call(page, 'ops', 3000);
      const rs = await call(page, 'runState');
      await call(page, 'drive', false, false);
      const row = { quality: q, stage: stg, ...m, ops, run: rs, gl: info.gl, postAfter: m.info.post };
      res.rows.push(row);
      if (m.foes && m.foes.mean < n * 0.75) fail(res, q + ': only ' + m.foes.mean + ' of ' + n + ' foes were live on average');
      if (rs.app !== 'run') notes(res, q + ': run ended during the measure (app ' + rs.app + ')');
    } finally { for (const e of errors) res.errors.push(Object.assign({ quality: q }, e)); await ctx.close(); }
  }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

async function scenSwing() {
  const o = S.opt, res = newResult('swing'), q = qualitiesOr(['high'])[0];
  const { ctx, page, errors } = await openPage();
  try {
    await call(page, 'profile', o.cls, o.embers);
    await call(page, 'settings', q);
    await call(page, 'install');
    if ((await call(page, 'start')) !== 'run') fail(res, 'run did not start');
    await wait(400);
    const strips = await call(page, 'swingStrip', o.cls, o.aim, o.zoom, o.weapon ? o.weapon.split(',') : []);
    if (!strips.length) notes(res, o.cls + ' has no melee weapon');
    for (const s of strips) {
      const file = path.join(o.outdir, ['swing', tag(), o.cls, s.weapon.replace('@', '-'), 'aim' + o.aim].join('-') + '.png');
      fs.writeFileSync(file, Buffer.from(s.url.split(',')[1], 'base64'));
      res.shots.push(file);
      notes(res, `${s.weapon}: sides ${s.side.join('/')}, strike ${s.times.map(v => v.toFixed(3)).join('/')} s`);
    }
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

const PICK_SHOTS = ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow', 'general', 'route', 'duo', 'asc', 'relic', 'purse', 'fire-big', 'holy-ally'];
const PICK_CUES = ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow', 'general', 'route', 'asc', 'relic', 'purse'].map(k => ({ label: k, cue: 'pick', arg: k }))
  .concat([{ label: 'duo fire+ice', cue: 'pick', arg: { k: 'duo', els: ['fire', 'ice'] } }, { label: 'duo (no pair)', cue: 'pick', arg: 'duo' }, { label: 'fire big', cue: 'pick', arg: { k: 'fire', big: true } },
    { label: 'holy big', cue: 'pick', arg: { k: 'holy', big: true } }, { label: 'buy (hearth)', cue: 'buy' }]);
async function scenPicks() {
  const o = S.opt, res = newResult('picks'), q = qualitiesOr(['high'])[0];
  const { ctx, page, errors } = await openPage();
  try {
    await call(page, 'profile', o.cls, o.embers);
    await call(page, 'settings', q);
    await call(page, 'install');
    if ((await call(page, 'start')) !== 'run') fail(res, 'run did not start');
    await wait(1200);
    for (let i = 0; i < 6 && await call(page, 'offerOpen'); i++) { await call(page, 'take'); await wait(400); }
    await wait(1400);
    const kk = await call(page, 'pickKinds');
    if (kk.bad.length) fail(res, 'boon ids without a pick kind: ' + kk.bad.slice(0, 8).join(', '));
    notes(res, `${kk.n} boon ids: ` + Object.entries(kk.by).map(([k, n]) => k + ' ' + n).join(', '));
    for (const name of PICK_SHOTS) {
      const r = await call(page, 'pickBurst', name);
      await wait(220); // the shot lands about 0.25 s after the burst
      const w = Math.round(220 * r.k), h = Math.round(280 * r.k), x = Math.max(0, Math.min(o.vw - w, Math.round(r.x - w / 2))), y = Math.max(0, Math.min(o.vh - h, Math.round(r.y - 220 * r.k)));
      const file = path.join(o.outdir, ['picks', tag(), o.cls, q, name].join('-') + '.png');
      await page.screenshot({ path: file, clip: { x, y, width: Math.min(w, o.vw), height: Math.min(h, o.vh) } });
      res.shots.push(file);
      notes(res, `burst ${name}: ${r.id}`);
      await wait(1000);
    }
    const rows = await call(page, 'pickAudio', PICK_CUES);
    for (const r of rows) {
      notes(res, `cue ${r.label}: ${r.voices} voices, peak ${r.peak}, rms ${r.rms}, ${r.len} s${r.err ? ', error ' + r.err : ''}`);
      if (r.err) fail(res, 'cue ' + r.label + ' threw: ' + r.err);
      else if (!(r.peak > 0.003)) fail(res, 'cue ' + r.label + ' rendered silent');
      else if (r.len > 0.9) fail(res, 'cue ' + r.label + ' lasts ' + r.len + ' s (over 0.9 s)');
    }
    res.rows = rows;
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// cards: hands staged through the sim that show every card kind; boons = the hero's build for the hand (so the cards are eligible), pick = [card index, kind] for mid-pick frames
const R = (ids, n) => Object.fromEntries(ids.map((id, i) => [id, Array.isArray(n) ? n[i] : n || 1]));
const CARD_HANDS = (cls) => [
  { name: 'gates', spec: { src: 'start' }, boons: {}, ids: ['kindle', 'frostbite', 'staticcharge', 'envenom'], distinctIcons: true, pick: [3, 'poison'] },
  { name: 'gates2', spec: { src: 'start' }, boons: {}, ids: ['consecrate', 'doommark', 'generalist'], distinctIcons: true, pick: [0, 'holy'] },
  { name: 'fire-ice', spec: { src: 'room' }, boons: R(['kindle', 'fuel', 'stoke', 'searing', 'frostbite', 'deepcold', 'brittle', 'coldsnap'], [1, 2, 2, 1, 1, 1, 1, 1]), ids: ['wildfire', 'shatter', 'conflag', 'thermalshock'], pick: [1, 'ice'] },
  { name: 'storm', spec: { src: 'room' }, boons: R(['staticcharge', 'conductor', 'highvoltage', 'shortcircuit', 'envenom', 'potency', 'caustic', 'fester'], [1, 2, 1, 1, 1, 2, 1, 1]), ids: ['overload', 'sporeburst', 'thunderhead', 'galvanic'], pick: [0, 'lightning'] },
  { name: 'light', spec: { src: 'room' }, boons: R(['consecrate', 'fervor', 'zealotry', 'sanctity', 'doommark', 'malignance', 'malice'], [1, 2, 2, 1, 1, 2, 1]), ids: ['beacon', 'deathknell', 'radiantaegis', 'wrathofheaven'], pick: [1, 'shadow'] },
  { name: 'open', spec: { src: 'epic' }, boons: { generalist: 1, keen: 1 }, ids: ['asc_edge', 'edge', 'brutal', 'purse'], pick: [1, 'general'] },
  { name: 'evo', spec: { src: 'room' }, boons: R(['kindle', 'fuel', 'stoke', 'searing', 'wildfire', 'conflag'], [1, 2, 3, 2, 2, 1]), ids: ['evo_fire', 'cindertrail', 'vigor'], pick: [0, 'fire-big'] },
  { name: 'route', spec: { src: 'class', ctier: 1 }, boons: {}, ids: ['atk', 's1', 's2', 'el'].map(k => cls[0] + '_' + k), pick: [0, 'route'] },
  { name: 'fork', spec: { src: 'class', ctier: 2 }, boons: { [cls[0] + '_atk']: 1 }, ids: [cls[0] + '_atk_h', cls[0] + '_atk_s'] },
  { name: 'dense6', spec: { src: 'epic' }, boons: R(['kindle', 'fuel', 'stoke', 'frostbite', 'deepcold', 'brittle'], [1, 2, 2, 1, 2, 1]), ids: ['searing', 'permafrost', 'thermalshock', 'asc_quick', 'plating', 'purse'], pick: [2, 'duo'] },
];
async function scenCards() {
  const o = S.opt, res = newResult('cards'), q = qualitiesOr(['high'])[0], cls = o.cls;
  const { ctx, page, errors } = await openPage();
  try {
    await call(page, 'profile', cls, o.embers);
    await call(page, 'settings', q);
    await call(page, 'install');
    if ((await call(page, 'start')) !== 'run') fail(res, 'run did not start');
    await wait(1200);
    const sheet = path.join(o.outdir, ['cards', tag(), cls, 'frames'].join('-') + '.png');
    fs.writeFileSync(sheet, Buffer.from((await call(page, 'cardSheet', cls)).split(',')[1], 'base64'));
    res.shots.push(sheet);
    const seen = new Set();
    for (const h of CARD_HANDS(cls)) {
      const kinds = await call(page, 'cardHand', h.boons, h.ids, h.spec);
      await wait(900);
      const d = await call(page, 'cardDom');
      if (!d.open || d.cards.length !== h.ids.length) { fail(res, `hand ${h.name}: overlay ${d.open ? 'open' : 'closed'} with ${d.cards.length} of ${h.ids.length} cards`); continue; }
      d.cards.forEach((c, i) => { if (c.kind !== kinds[i].split('+')[0]) fail(res, `hand ${h.name}: card ${h.ids[i]} shows kind ${c.kind}, PickFx says ${kinds[i]}`); if (!c.frame) fail(res, `hand ${h.name}: card ${h.ids[i]} has no frame`); seen.add(kinds[i]); });
      if (h.distinctIcons && new Set(d.cards.map(c => c.icon)).size !== d.cards.length) fail(res, `hand ${h.name}: path gate icons are not distinct (path colours)`);
      notes(res, `hand ${h.name}: ${h.ids.map((id, i) => id + ' ' + kinds[i]).join(', ')}; card ${Math.round(d.cards[0].w)}x${Math.round(d.cards[0].h)} px`);
      await shoot(page, res, h.name);
      if (h.pick) {
        const [i, label] = h.pick, ph = await call(page, 'cardPick', i, 110);
        if (!ph.held) fail(res, `hand ${h.name}: the pick set no hide timer`);
        if (!ph.fx) fail(res, `hand ${h.name}: the pick made no effect layer`);
        await shoot(page, res, 'pick-' + label + '-110ms');
        await call(page, 'cardSeek', 230);
        await shoot(page, res, 'pick-' + label + '-230ms');
        if (await call(page, 'cardRelease')) fail(res, `hand ${h.name}: the overlay stayed up after the pick animation`);
        await wait(300);
      }
    }
    for (const k of ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow', 'general', 'route', 'duo', 'asc', 'purse', 'fire+big']) if (![...seen].some(s => s === k || (k === 'fire+big' && /\+big$/.test(s)))) fail(res, 'no hand showed a ' + k + ' card');
    // fork reveal: rank 2 (small, silver) and rank 3 (big, gold)
    await page.evaluate(() => window.__ED.UI.hideBoons());
    for (const rank of [2, 3]) {
      const f = await call(page, 'forkShow', cls[0] + '_atk_h', rank);
      if (!f.shown) { fail(res, 'fork reveal rank ' + rank + ' not shown'); continue; }
      await wait(150);
      const file = path.join(o.outdir, ['cards', tag(), cls, 'fork-rank' + rank].join('-') + '.png');
      const pad = 80, x = Math.max(0, Math.floor(f.x - pad)), y = Math.max(0, Math.floor(f.y - pad));
      await page.screenshot({ path: file, clip: { x, y, width: Math.min(o.vw - x, Math.ceil(f.w + 2 * pad)), height: Math.min(o.vh - y, Math.ceil(f.h + 2 * pad)) } });
      res.shots.push(file);
    }
    await page.evaluate(() => { document.getElementById('ov-fork').hidden = true; });
    // Low quality: idle sprites hidden, no effect layer, the overlay gone within 0.3 s of a pick
    await call(page, 'settings', 'low');
    await call(page, 'cardHand', R(['kindle', 'fuel'], [1, 1]), ['stoke', 'searing', 'vigor'], { src: 'room' });
    await wait(900);
    const low = await page.evaluate(() => { const s = document.querySelector('#boon-cards .ca-spark'); return { low: document.getElementById('ov-boon').classList.contains('low'), spark: s ? getComputedStyle(s).display : 'none' }; });
    if (!low.low || low.spark !== 'none') fail(res, 'Low quality: overlay low ' + low.low + ', idle spark display ' + low.spark);
    await shoot(page, res, 'low');
    await page.evaluate(() => window.__ED.UI.pickBoon(0));
    await wait(40);
    const fxN = await page.evaluate(() => document.querySelectorAll('#ov-boon .pick-fx').length);
    await wait(260);
    const up = await page.evaluate(() => !document.getElementById('ov-boon').hidden);
    if (fxN) fail(res, 'Low quality made a pick effect layer');
    if (up) fail(res, 'Low quality: the overlay was still up 0.3 s after a pick');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

async function scenShots() {
  const o = S.opt, res = newResult('shots'), q = qualitiesOr(['high'])[0];
  const { ctx, page, errors } = await openPage();
  const tryShot = async (name, fn) => { try { if (fn) await fn(); await wait(450); await shoot(page, res, name); } catch (e) { notes(res, 'shot ' + name + ' skipped: ' + String(e.message).split('\n')[0]); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev((quality) => { const A = window.__ED.App; A.settings.frameCap = 'off'; A.settings.quality = quality; A.applySettings(); }, q);
    await tryShot('01-boot-name');
    await call(page, 'profile', o.cls, o.embers >= 0 ? o.embers : 400, o.weapon ? o.weapon.split(',')[0] : ''); // --weapon: owned and chosen (the Descend and Hearth shots show it)
    await tryShot('02-menu', () => wait(500));
    for (const [n, tab] of [['03-descend', 'descend'], ['04-hearth-upgrades', 'upgrades']]) await tryShot(n, () => ev((t) => window.__ED.App.enterHearth(t), tab));
    // 05: three ranks bought (Refund buttons) and Reset all armed by one click
    await tryShot('05-hearth-refunds', () => ev(() => {
      const E = window.__ED, p = E.App.profile; let n = 0;
      for (const u of E.UPGRADES) if (n < 3 && E.Save.buyUpgrade(p, u.id)) n++;
      E.App.afterMetaChange(); E.App.enterHearth('upgrades');
      const b = document.querySelector('.btn-reset'); if (b) b.click();
    }));
    // 05b: the Armory sections of the Upgrades page scrolled into view (an owned variant, buyable and locked entries)
    await tryShot('05b-hearth-armory', () => ev(() => { const E = window.__ED; E.App.enterHearth('upgrades'); const h = [...document.querySelectorAll('.tier-head')].find(x => /Armory/.test(x.textContent)); if (h) h.scrollIntoView({ block: 'start' }); }));
    for (const [n, tab] of [['06-hearth-chronicle', 'chronicle'], ['07-heroes', 'heroes']]) await tryShot(n, () => ev((t) => window.__ED.App.enterHearth(t), tab));
    await tryShot('08-settings', () => ev(() => { window.__ED.App.goHome(); window.__ED.UI.openSettings(); }));
    await tryShot('09-credits', () => ev(() => { window.__ED.UI.closeSettings(); document.getElementById('mm-credits').click(); }));
    await ev(() => { document.getElementById('btn-credits-close').click(); });
    await call(page, 'install');
    await ev(() => window.__ED.App.enterHearth('descend'));
    await call(page, 'start');
    await tryShot('10-boon-offer', async () => { await wait(1100); if (!(await call(page, 'offerOpen'))) throw new Error('no boon offer open'); });
    await call(page, 'drive', true, true);
    await wait(1800);
    await tryShot('11-run-combat', () => wait((o.seconds || 9) * 1000));
    await call(page, 'drive', false, false);
    for (const [n, tab] of [['12-sheet-build', 'build'], ['13-sheet-combat', 'combat'], ['14-sheet-map', 'map']]) {
      await tryShot(n, () => ev((t) => { const UI = window.__ED.UI; UI.toggleSheet(true); UI.sheetTab(t); }, tab));
    }
    await ev(() => window.__ED.UI.toggleSheet(false));
    await tryShot('15-pause', () => ev(() => window.__ED.App.togglePause(true)));
    res.run = await call(page, 'runState');
    res.info = await call(page, 'info');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  if (res.shots.length < 8) fail(res, 'only ' + res.shots.length + ' screenshots were taken');
  return res;
}

async function scenSheet() {
  const o = S.opt, res = newResult('sheet'), q = qualitiesOr(['high'])[0];
  const { ctx, page, errors } = await openPage();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await call(page, 'profile', o.cls, o.embers);
    await call(page, 'settings', q);
    if ((await call(page, 'start')) !== 'run') fail(res, 'run did not start');
    await wait(1100);
    for (let i = 0; i < 6 && await call(page, 'offerOpen'); i++) { await call(page, 'take'); await wait(300); }
    const st = await call(page, 'sheetStage', o.strat > 1 ? o.strat : 5);
    notes(res, `staged ${st.cls}: paths ${st.els.join('+')}, ${st.boons} boons, ${st.relics} relics, stratum ${st.stratum}, ally ${st.ally}`);
    await wait(300);
    // sideways overflow: a sheet element wider than its column, or text spilling past its box
    const audit = () => ev(() => {
      const bad = [], cols = [...document.querySelectorAll('#ov-sheet .sh-col')].filter(c => c.offsetParent);
      for (const c of cols) {
        const cr = c.getBoundingClientRect(), inn = c.querySelector('.sh-in');
        if (inn && inn.scrollWidth > inn.clientWidth + 1) bad.push(c.dataset.col + ': scrollWidth ' + inn.scrollWidth + ' > ' + inn.clientWidth);
        for (const n of c.querySelectorAll('*')) { const r = n.getBoundingClientRect(); if (r.width && (r.right > cr.right + 1 || r.left < cr.left - 1)) { bad.push((c.dataset.col || '?') + ': ' + n.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' outside ' + Math.round(cr.left) + '..' + Math.round(cr.right)); break; } }
      }
      const head = document.querySelector('#ov-sheet .sh-head'), hr = head.getBoundingClientRect();
      for (const n of head.querySelectorAll('*')) { const r = n.getBoundingClientRect(); if (r.width && (r.right > hr.right + 1 || r.bottom > hr.bottom + 1)) { bad.push('header: ' + (n.id || n.className) + ' spills'); break; } }
      return bad;
    });
    const shot = async (name, fn) => { await ev(fn); await wait(700); const bad = await audit(); for (const b of bad) fail(res, name + ' overflow: ' + b); await shoot(page, res, name); };
    await shot('build', () => { const UI = window.__ED.UI; UI.toggleSheet(true); UI.sheetTab('build'); });
    await shot('build-end', () => { for (const c of document.querySelectorAll('#shp-build .sh-in')) c.scrollTop = c.scrollHeight; });
    await shot('combat', () => window.__ED.UI.sheetTab('combat'));
    await shot('combat-end', () => { for (const c of document.querySelectorAll('#shp-combat .sh-in')) c.scrollTop = c.scrollHeight; });
    await shot('map', () => window.__ED.UI.sheetTab('map'));
    await shot('ally', () => { const r = document.querySelector('#ov-sheet .sh-party:not(.me)'); if (r) r.click(); window.__ED.UI.sheetTab('build'); });
    // real key events: E / Q switch tabs, S moves the focus down, Tab closes
    const navState = () => ev(() => { const S = window.__ED.UI.sheetState; return { tab: S.tab, focus: S.focusKey, open: !document.getElementById('ov-sheet').hidden }; });
    const n0 = await navState();
    await page.keyboard.press('KeyE'); await wait(250);
    const n1 = await navState();
    await page.keyboard.press('KeyQ'); await wait(250);
    await page.keyboard.press('KeyS'); await wait(250);
    const n2 = await navState();
    await page.keyboard.press('Tab'); await wait(250);
    const n3 = await navState();
    notes(res, `keys: ${n0.tab} -E-> ${n1.tab} -Q-> ${n2.tab}; focus ${n0.focus} -S-> ${n2.focus}; Tab closes: ${!n3.open}`);
    if (n1.tab !== 'combat' || n2.tab !== 'build') fail(res, 'E / Q did not switch the sheet tabs');
    if (!n2.focus || n2.focus === n0.focus) fail(res, 'S did not move the sheet focus');
    if (n3.open) fail(res, 'Tab did not close the sheet');
    await ev(() => window.__ED.UI.toggleSheet(false));
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Every menu screen without a run: name screen, menu, Descend, Hearth (a buy mid-burst, refunds, Armory, Chronicle), Heroes, a staged party lobby and its Hearth,
// results (victory with an evolution, fallen), the news notice, settings tabs, a confirm dialog, pause, credits; checks keyboard focus on the menu and the Hearth tabs.
async function scenScreens() {
  const o = S.opt, res = newResult('screens');
  const { ctx, page, errors } = await openPage();
  const tryShot = async (name, fn, settle) => { try { if (fn) await fn(); await wait(settle == null ? 450 : settle); await shoot(page, res, name); } catch (e) { notes(res, 'shot ' + name + ' skipped: ' + String(e.message).split('\n')[0]); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const focused = () => ev(() => { const a = document.activeElement; return a ? (a.id || a.dataset.tab || a.dataset.stab || a.className) : ''; });
  try {
    await ev(() => { const A = window.__ED.App; A.settings.frameCap = 'off'; A.applySettings(); });
    await tryShot('01-name');
    await call(page, 'profile', o.cls, o.embers >= 0 ? o.embers : 400, o.weapon ? o.weapon.split(',')[0] : '');
    await tryShot('02-menu', () => ev(() => { window.__ED.App.goHome(); document.getElementById('mm-descend').focus(); }), 600);
    await page.keyboard.press('ArrowDown');
    if ((await focused()) !== 'mm-hearth') fail(res, 'ArrowDown on the menu did not focus Hearth (focus: ' + (await focused()) + ')');
    await tryShot('03-descend', () => ev(() => window.__ED.App.enterHearth('descend')));
    // 04: one rank bought by a click, shot inside the 0.45 s burst
    await tryShot('04-hearth-buy', () => ev(() => { window.__ED.App.enterHearth('upgrades'); const b = document.querySelector('#up-grid .buy:not(:disabled)'); if (!b) throw new Error('nothing affordable'); b.click(); }), 120);
    const burst = await ev(() => !!document.querySelector('#up-grid .up-card.burst .up-ember'));
    if (!burst) fail(res, 'the bought plaque has no .burst after the click');
    await tryShot('05-hearth-upgrades', () => ev(() => { const E = window.__ED, p = E.App.profile; let n = 0; for (const u of E.UPGRADES) if (n < 2 && E.Save.buyUpgrade(p, u.id)) n++; E.App.afterMetaChange(); document.querySelector('#hearth-tabs .tab.on').focus(); }));
    await page.keyboard.press('ArrowRight');
    if ((await focused()) !== 'chronicle') fail(res, 'ArrowRight on the Hearth tabs did not focus Chronicle (focus: ' + (await focused()) + ')');
    await tryShot('06-hearth-armory', () => ev(() => { const h = [...document.querySelectorAll('#up-grid .tier-head')].find(x => /Armory/.test(x.textContent)); if (h) h.scrollIntoView({ block: 'start' }); }));
    await tryShot('07-hearth-chronicle', () => ev(() => window.__ED.App.enterHearth('chronicle')));
    await tryShot('08-heroes', () => ev(() => window.__ED.App.enterHearth('heroes')));
    // 09: a staged lobby (no network): this profile hosts, a second hero waits
    await tryShot('09-lobby', () => ev(() => {
      const E = window.__ED, A = E.App, UI = E.UI;
      A.state = 'lobby'; UI.show('lobby');
      A.lobbyState = { code: 'K7QX2', pact: 0, members: [
        { slot: 0, pid: 'host', name: A.profile.name, cls: A.sel.cls, weapon: A.sel.weapon, isHost: true, ready: true },
        { slot: 1, pid: 'p2', name: 'Brann', cls: 'ranger', weapon: E.CLASSES.ranger.weapons[0], ready: false },
        { slot: 2, pid: 'p3', name: 'Ysolde', cls: 'cleric', weapon: E.CLASSES.cleric.weapons[0], ready: true }] };
      UI.renderLobby(A.lobbyState, 'host', true); UI.lobbyStatus('Party open. Share the code or the invite link.');
    }));
    await tryShot('10-party-hearth', () => ev(() => window.__ED.UI.openPartyHearth()));
    // 11, 12: results from Save.applyRun on synthetic summaries
    const results = (win) => ev((w) => {
      const E = window.__ED, A = E.App, UI = E.UI;
      document.getElementById('ov-hearth').hidden = true; A.lobbyState = null;
      const run = w ? { victory: true, stratum: 6, time: 1534, level: 22, roomsCleared: 40, roomsTotal: 52, roomsVisited: 47, kills: 1800, bossCount: 6, party: 1, pact: 0, cls: A.sel.cls, myEvo: { path: 'fire', weapon: 'Longsword' }, evolved: true, embers: { rooms: 80, elites: 30, bosses: 60, victory: 40 } }
        : { victory: false, stratum: 2, time: 512, level: 7, roomsCleared: 9, roomsTotal: 26, roomsVisited: 14, kills: 300, bossCount: 1, party: 1, pact: 0, cls: A.sel.cls, embers: { rooms: 18, elites: 5, bosses: 10, victory: 0 } };
      const r = E.Save.applyRun(A.profile, run);
      A.state = 'results'; UI.renderResults(run, r); UI.show('results');
    }, win);
    await tryShot('11-results-victory', () => results(true));
    await tryShot('12-results-fallen', () => results(false));
    await tryShot('13-news', () => ev(() => { const E = window.__ED, A = E.App; A.profile.news = 1; A.profile.refunded = 120; A.goHome(); }));
    await ev(() => document.getElementById('btn-news-close').click());
    for (const [n, tab] of [['14-settings-sound', 'sound'], ['15-settings-controls', 'controls'], ['16-settings-profile', 'profile']]) await tryShot(n, () => ev((t) => window.__ED.UI.openSettings(t), tab));
    await tryShot('17-modal', () => ev(() => document.getElementById('btn-reset').click()));
    await ev(() => { document.getElementById('modal').hidden = true; window.__ED.UI.closeSettings(); });
    await tryShot('18-credits', () => ev(() => document.getElementById('mm-credits').click()));
    await ev(() => document.getElementById('btn-credits-close').click());
    await tryShot('19-pause', () => ev(() => { document.getElementById('pause-note').textContent = 'The Deep waits for you.'; document.getElementById('ov-pause').hidden = false; document.getElementById('btn-resume').focus(); }));
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  if (res.shots.length < 15) fail(res, 'only ' + res.shots.length + ' screenshots were taken');
  return res;
}

// ---------------- output ----------------
const f1 = (v) => (typeof v === 'number' ? v.toFixed(1) : '-');
const tri = (s) => (s ? [s.p50, s.p95, s.max].map(f1).join('/') : '-');
const pad = (s, n) => String(s).padEnd(n);
function table(results) {
  const out = [];
  for (const r of results) {
    out.push(`${r.name} [${r.browser}${r.name === 'shots' || r.name === 'screens' ? '' : ', ' + r.cls}] ${r.ok ? 'PASS' : 'FAIL'}  ${(r.wallMs / 1000).toFixed(1)} s`);
    for (const n of r.notes) out.push('  ' + n);
    for (const e of r.errors) out.push(`  ${e.kind}${e.quality ? ' (' + e.quality + ')' : ''}: ${e.text}`);
    if (r.name.startsWith('crowd')) {
      out.push('  ' + pad('quality', 8) + pad('foes', 7) + pad('fps', 7) + pad('busy%', 7) + pad('sys%', 7) + pad('update p50/p95/max', 22) + pad('render', 20) + pad('world', 20) + pad('hud', 18) + pad('post', 18) + 'frame (rAF callback)');
      for (const w of r.rows) out.push('  ' + pad(w.quality, 8) + pad(f1(w.foes && w.foes.mean), 7) + pad(f1(w.fps), 7) + pad(f1(w.busyPct), 7) + pad(f1(w.sysBusyPct), 7) + pad(tri(w.update), 22) + pad(tri(w.render), 20) + pad(tri(w.world), 20) + pad(tri(w.hud), 18) + pad(tri(w.post), 18) + tri(w.frame));
      for (const w of r.rows) {
        const p = w.postAfter;
        if (w.stage) out.push(`  ${w.quality}: stage room ${w.stage.w}x${w.stage.h} tiles (id ${w.stage.room}), stratum ${w.stage.stratum}, ${w.stage.roster} foe types, ${w.spawned} spawned, ${w.kills} killed`);
        out.push(`  ${w.quality}: canvas ${w.canvas.slice(0, 2).join('x')} buf ${w.canvas[3]}x${w.canvas[4]} scale ${w.canvas[5]}, post ${p ? (p.usePost ? 'ON' : 'off') + (p.soft ? ' (software GL)' : '') + (p.error ? ' error ' + p.error : '') : 'n/a'}, GL ${w.gl}`);
        if (w.ops) out.push(`  ${w.quality} ops/frame: ${w.ops.canvasCallsPerFrame} canvas calls; ` + Object.entries(w.ops.perFrame).slice(0, 8).map(([k, v]) => k + ' ' + v).join(', '));
      }
    } else if (r.run) {
      const s = r.run;
      out.push(`  app ${s.app}, world ${s.time} s, ${s.cls}, stratum ${s.stratum}, ${s.kills} kills, ${s.roomsCleared} rooms cleared, ${s.hops} room hops, level ${s.level}, offers ${s.offers}/picks ${s.picks}`);
      out.push(`  actions: ${Object.entries(s.acts).map(([k, v]) => k + ' ' + v).join(', ')}`);
    }
    for (const f of r.shots) out.push('  shot ' + f);
  }
  return out.join('\n');
}

// ---------------- main ----------------
async function main() {
  delete process.env.PWDEBUG; // Playwright's debug mode would open a headed browser
  S.opt = parseArgs(process.argv.slice(2));
  if (S.opt.help) { const head = []; for (const l of fs.readFileSync(__filename, 'utf8').split(/\r?\n/)) { if (!l.startsWith('//')) break; head.push(l.slice(3)); } console.log(head.join('\n')); return 0; }
  fs.mkdirSync(S.opt.outdir, { recursive: true });
  const t0 = Date.now();
  S.pw = loadPlaywright();
  S.server = await serve(S.opt.root);
  log('playwright + server ready in ' + (Date.now() - t0) + ' ms');
  const dog = setTimeout(() => { log('timeout after ' + S.opt.timeout + ' s'); cleanup().then(() => process.exit(2)); }, S.opt.timeout * 1000);
  const results = [];
  try {
    const tl = Date.now();
    S.browser = await launch();
    const bv = S.browser.version();
    log(`browse: headless ${S.opt.browser} ${bv}, ${S.opt.vw}x${S.opt.vh}, root ${S.opt.root} (launch ${Date.now() - tl} ms)`);
    for (const sc of S.opt.scens) {
      const t0 = Date.now();
      log('scenario ' + sc + ' ...');
      let r;
      try { r = sc === 'smoke' ? await scenSmoke() : sc === 'shots' ? await scenShots() : sc === 'sheet' ? await scenSheet() : sc === 'screens' ? await scenScreens() : sc === 'swing' ? await scenSwing() : sc === 'picks' ? await scenPicks() : sc === 'cards' ? await scenCards() : await scenCrowd(sc); } catch (e) { if (e instanceof Fail) throw e; r = newResult(sc); r.ok = false; r.notes.push('FAIL: harness error: ' + String(e && e.message || e).split(/\r?\n/)[0]); r.stack = String(e && e.stack || e); }
      r.wallMs = Date.now() - t0;
      r.browserVersion = bv;
      if (S.server.missing.size) r.missing = [...S.server.missing];
      results.push(r);
    }
  } finally { clearTimeout(dog); const tc = Date.now(); await cleanup(); log('browser closed in ' + (Date.now() - tc) + ' ms'); }
  const file = path.join(S.opt.outdir, 'result-' + S.opt.browser + '.json');
  const doc = { tool: 'tools/browse.js', node: process.version, browser: S.opt.browser, viewport: [S.opt.vw, S.opt.vh], root: S.opt.root, seed: S.opt.seed, results };
  fs.writeFileSync(file, JSON.stringify(doc, null, 1));
  if (S.opt.json) console.log(JSON.stringify(doc));
  else console.log(table(results) + '\nresult ' + file);
  return results.every(r => r.ok) ? 0 : 1;
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup().then(() => process.exit(130)); });
main().then((code) => { process.exitCode = code; }, (e) => {
  console.error(e instanceof Fail ? 'browse: ' + e.message : e);
  process.exitCode = e instanceof Fail ? e.code : 2;
});
