// Headless browser harness: boots the static game in an invisible Playwright browser and runs scripted scenarios against it.
// Usage: node tools/browse.js [--scen=smoke,crowd70,shots,swing] [--cls=knight] [--aim=DEG] [--zoom=N] [--weapon=ID,..] [--browser=chromium|firefox] [--viewport=1920x1080] [--outdir=DIR] [--seconds=N] [--root=DIR]
//   [--quality=low,high] [--ops] [--json] [--seed=1] [--strat=1] [--embers=N] [--mortal] [--software] [--forcepost] [--sync] [--warm=2.5] [--timeout=300]
// Mechanism: headless only (no headed option, no window calls); one browser per invocation, one fresh context per scenario page, all closed at exit, on error and on SIGINT.
//   A read-only node http server on 127.0.0.1 (random port) serves --root (default: this repo). Playwright resolves via require('playwright'), else %LOCALAPPDATA%\npm-cache\_npx\*\node_modules (best match for the installed browsers).
//   The game runs under window.__ED with a seeded Math.random (--seed) and frameCap off; scripted input goes through ED.Input (keys, pressed, mouse) like a player.
//   smoke: profile -> menu shot -> solo run of --cls -> key-event check -> --seconds (20) of circling, attacking the nearest foe, both skills, dash, boon picks, room hops -> run shot; fails on any pageerror or console error.
//   crowdN: N live foes staged in the largest combat room through World.spawnEnemy / enterRoom (room cleared, held locked, topped up to N), hero kept alive; after --warm (2.5) s
//     measures --seconds (6) of main-thread ms per frame (Game.update, Game.render, Render.frame, HUD.draw, Post.render, whole rAF callback; busy% = rAF callback time over wall time, sys% = whole-machine CPU use during the window) at each --quality (low,high);
//     --ops adds a 3 s pass counting canvas/WebGL calls per frame by target (buf = world buffer, screen = visible canvas, other = offscreen bakes).
//   shots: 15 screenshots: boot name screen, menu, Descend, Hearth tabs, Heroes, Settings, Credits, boon offer, a run in combat, the Tab sheet tabs, the pause menu (profile gets 400 embers unless --embers).
//   swing: one contact-sheet PNG per melee weapon of --cls (or per --weapon id, forks as id@fork) (aimed --aim degrees, 0 = right, 90 = down, drawn at --zoom canvas px per world px, 2): 14 frames at fixed times over two consecutive attacks, the hold and the ease back to idle, hero and smear drawn by the game's own renderer.
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
  for (const s of o.scens) if (!/^(smoke|shots|swing|crowd\d{1,4})$/.test(s)) throw new Fail('unknown scenario ' + s + ' (smoke, shots, swing, crowdN)');
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

  // profile with a name, the tutorial off, the hero chosen; embers >= 0 sets the purse
  BR.profile = (cls, embers) => {
    const ED = window.__ED, A = ED.App;
    if (!ED.CLASSES[cls]) throw new Error('unknown hero ' + cls + ' (have ' + ED.CLASS_IDS.join(', ') + ')');
    if (!A.hasProfile) A.createProfile('Tester');
    A.profile.stats.runs = Math.max(A.profile.stats.runs | 0, 5);
    if (embers >= 0) A.profile.embers = embers;
    A.persist();
    A.selectClass(cls);
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

  // contact sheet of the melee swings of `cls` aimed `aimDeg` degrees (0 = right, 90 = down): one PNG per weapon, 14 frames at fixed times (idle, attack 1, attack 2 one weapon-rate later, hold, ease to idle),
  // the hero drawn by Sprites.hero from a fake player and the smear by FX.drawGlow; needs a run (FX.playerAttackAnim reads the world view)
  BR.swingStrip = (cls, aimDeg, zoom, weapons) => {
    const ED = window.__ED, F = ED.FX, view = ED.Game.s.view, out = [], pid = 'sw-fake', face = aimDeg * Math.PI / 180, K2 = zoom, CW = 120 * zoom, CH = 140 * zoom, COLS = zoom > 2 ? 5 : 7;
    F.reset();
    for (const wid of weapons.length ? weapons : ED.CLASSES[cls].weapons) {
      const w = ED.Sprites.weaponArt({ cls, weapon: wid }).w; if (w.kind !== 'melee') continue;
      const p = { pid, cls, slot: 0, weapon: wid, face, moving: false, hp: 1, x: 0, y: 0 };
      view.players.set(pid, p);
      const mk = () => { if (F.anim[pid]) F.anim[pid].atkT = 9; F.playerAttackAnim(pid, face); return Object.assign({}, F.anim[pid]); };
      const S = [mk(), mk()], an = F.anim[pid], t0 = S[0].t0, t1 = S[0].t1, D = S[0].D, st = (f) => t0 + (t1 - t0) * f;
      const fr = [[-1, 9, 'idle'], [0, t0 * 0.9, 'a1 wind'], [0, st(0.3), 'a1 strike'], [0, st(0.6), 'a1 strike'], [0, t1, 'a1 end'], [0, D, 'a1 settled'],
        [1, t0 * 0.9, 'a2 wind'], [1, st(0.3), 'a2 strike'], [1, st(0.6), 'a2 strike'], [1, t1, 'a2 end'], [1, D, 'a2 settled'], [1, D + 0.5, 'hold'], [1, D + 0.9, 'ease'], [1, D + 1.3, 'idle']];
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
          F.slash(0, -10, face, w.range, Math.min(6.3, w.arc), ED.PLAYER_COLORS[0]);
          const sl = F.slashes[F.slashes.length - 1]; sl.life = sl.max - f[1];
          c.globalCompositeOperation = 'lighter'; F.drawGlow(c, 0); c.globalCompositeOperation = 'source-over';
          F.slashes.length = 0;
        }
        c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#d8d4e0'; c.font = '12px monospace'; c.fillText(f[2] + ' ' + (f[1] < 9 ? f[1].toFixed(2) : ''), x0 + 6, y0 + 15);
        c.restore();
      });
      if (!pass) ED.Atlas.tick(10000);
      }
      out.push({ weapon: wid, url: cv.toDataURL('image/png'), side: [S[0].side, S[1].side], times: [t0, t1, D] });
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
    await call(page, 'profile', o.cls, o.embers);
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

async function scenShots() {
  const o = S.opt, res = newResult('shots'), q = qualitiesOr(['high'])[0];
  const { ctx, page, errors } = await openPage();
  const tryShot = async (name, fn) => { try { if (fn) await fn(); await wait(450); await shoot(page, res, name); } catch (e) { notes(res, 'shot ' + name + ' skipped: ' + String(e.message).split('\n')[0]); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev((quality) => { const A = window.__ED.App; A.settings.frameCap = 'off'; A.settings.quality = quality; A.applySettings(); }, q);
    await tryShot('01-boot-name');
    await call(page, 'profile', o.cls, o.embers >= 0 ? o.embers : 400);
    await tryShot('02-menu', () => wait(500));
    for (const [n, tab] of [['03-descend', 'descend'], ['04-hearth-upgrades', 'upgrades']]) await tryShot(n, () => ev((t) => window.__ED.App.enterHearth(t), tab));
    // 05: three ranks bought (Refund buttons) and Reset all armed by one click
    await tryShot('05-hearth-refunds', () => ev(() => {
      const E = window.__ED, p = E.App.profile; let n = 0;
      for (const u of E.UPGRADES) if (n < 3 && E.Save.buyUpgrade(p, u.id)) n++;
      E.App.afterMetaChange(); E.App.enterHearth('upgrades');
      const b = document.querySelector('.btn-reset'); if (b) b.click();
    }));
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

// ---------------- output ----------------
const f1 = (v) => (typeof v === 'number' ? v.toFixed(1) : '-');
const tri = (s) => (s ? [s.p50, s.p95, s.max].map(f1).join('/') : '-');
const pad = (s, n) => String(s).padEnd(n);
function table(results) {
  const out = [];
  for (const r of results) {
    out.push(`${r.name} [${r.browser}${r.name === 'shots' ? '' : ', ' + r.cls}] ${r.ok ? 'PASS' : 'FAIL'}  ${(r.wallMs / 1000).toFixed(1)} s`);
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
      try { r = sc === 'smoke' ? await scenSmoke() : sc === 'shots' ? await scenShots() : sc === 'swing' ? await scenSwing() : await scenCrowd(sc); } catch (e) { if (e instanceof Fail) throw e; r = newResult(sc); r.ok = false; r.notes.push('FAIL: harness error: ' + String(e && e.message || e).split(/\r?\n/)[0]); r.stack = String(e && e.stack || e); }
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
