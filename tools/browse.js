// Headless browser harness: boots the static game in an invisible Playwright browser and runs scripted scenarios against it.
// Usage: node tools/browse.js [--scen=smoke,crowd70,boss,shots,sheet,screens,wardrobe,cosmetics,swing,picks,cards,bell,arenas,verbs] [--cls=knight] [--aim=DEG] [--zoom=N] [--weapon=ID,..] [--browser=chromium|firefox] [--viewport=1920x1080] [--outdir=DIR] [--seconds=N] [--root=DIR]
//   [--quality=low,high] [--ops] [--json] [--seed=1] [--strat=1] [--embers=N] [--mortal] [--software] [--forcepost] [--sync] [--warm=2.5] [--timeout=300]
// Mechanism: headless only (no headed option, no window calls); one browser per invocation, one fresh context per scenario page, all closed at exit, on error and on SIGINT.
//   A read-only node http server on 127.0.0.1 (random port) serves --root (default: this repo). Playwright resolves via require('playwright'), else %LOCALAPPDATA%\npm-cache\_npx\*\node_modules (best match for the installed browsers).
//   The game runs under window.__ED with a seeded Math.random (--seed) and frameCap off; scripted input goes through ED.Input (keys, pressed, mouse) like a player.
//   smoke: profile -> menu shot -> solo run of --cls (wielding the first --weapon, an Armory variant included) -> key-event check -> --seconds (20) of circling, attacking the nearest foe, every skill (skill 3 too), dash, boon picks, room hops -> run shot; fails on any pageerror or console error.
//   crowdN: N live foes staged in the largest combat room through World.spawnEnemy / enterRoom (room cleared, held locked, topped up to N), hero kept alive; after --warm (2.5) s
//     measures --seconds (6) of main-thread ms per frame (Game.update, Game.render, Render.frame, HUD.draw, Post.render, whole rAF callback; busy% = rAF callback time over wall time, sys% = whole-machine CPU use during the window) at each --quality (low,high);
//     --ops adds a 3 s pass counting canvas/WebGL calls per frame by target (buf = world buffer, screen = visible canvas, other = offscreen bakes).
//   screens: 19 screenshots of every menu screen without a run (name, menu, Descend, Hearth with a buy mid-burst, Armory, Chronicle, Heroes, a staged party lobby and its Hearth,
//     results victory and fallen, the news notice, settings tabs, a confirm dialog, credits, pause); fails when ArrowDown / ArrowRight do not move focus on the menu / Hearth tabs.
//   boss: the boss room of stratum --strat (the hero driven, kept alive unless --mortal): a shot per phase (HP set to 0.6 then 0.3 of max), each after the phase's arena has formed; the hero stands still through phase 1, then fights.
//   wardrobe: 9 screenshots: the Descend roster (a riddle hero as a silhouette named ??? with its hint; a locked Knight copy stands in while the data has none), the Wardrobe (a skin bought through its chip and the confirm, worn at once;
//     ArrowRight along a row; the Blue Hearth worn), the Chronicle secrets block, the riddle hero on the Heroes page (fails if its name shows), the party Hearth Wardrobe, results with secrets from Save.applyRun.
//   cosmetics: Hearthsitter counts only on the Hearth section; every Wardrobe item owned; 9 preview shots (one hovered item per slot; fails on a blank preview, a wrong title caption or a loop that keeps running once hidden);
//     the camp and Hearth with the Blue Hearth and its ghost; a 4-hero party in different sets in a staged fight at High and Low (pets, coin trails, titles, crowns, sheens, auras, skins), Last Embers, the in-run secret toast; Game.render ms with and without the sets.
//   shots: 16 screenshots: boot name screen, menu, Descend, Hearth tabs (the Armory scrolled into view), Heroes, Settings, Credits, boon offer, a run in combat, the Tab sheet tabs, the pause menu (profile gets 400 embers unless --embers).
//   sheet: a late build staged through the sim (BR.sheetStage: stratum --strat or III, two element paths (one evolved, one at its keystone), open boons, a fork at rank 3, six relics, a shield, an ally hero, half the map walked):
//     the Tab sheet Build, Build scrolled to the end, Combat, Map, and Build viewing the ally, then the cleared room of the floor with the most exit doors (BR.doorStage);
//     fails on a page error, when a sheet column overflows its panel sideways, or when no room has 3 exit doors.
//   swing: one contact-sheet PNG per melee weapon of --cls, its Armory variants included (or per --weapon id, forks as id@fork, ranged ones too) (aimed --aim degrees, 0 = right, 90 = down, drawn at --zoom canvas px per world px, 2): frames at fixed times over two consecutive attacks (a combo weapon: one per step), the hold and the ease back to idle, hero and smear drawn by the game's own renderer.
//   picks: every boon id resolves to a PickFx card kind; one PNG per pick burst (each kind, fire-big, fire-ally) on the solo hero about 0.25 s after FX.handle gets the 'boon' / 'relic' event;
//     each pick cue (and the Hearth 'buy') rendered in an OfflineAudioContext: voices, peak, rms, audible length; fails on a throw, a silent cue or one longer than 0.9 s.
//   cards: a frame sheet PNG (every card frame mask at 6 x) and one PNG per boon hand staged through the sim (the hero's boons set so the cards are eligible): path gates,
//     every element, open and General, purse, keystones, an evolution, the --cls route and fork offers, a 6-card dense hand; mid-pick frames (110 and 230 ms,
//     the hide timer held, animations paused) for lightning, ice, general, fire-big and route; the fork reveal at rank 2 and 3; a Low quality hand and pick.
//     Fails on a missing card, a card whose kind differs from ED.PickFx.kind, a frame that did not resolve, equal path gate icons, a pick without an effect layer, or Low quality leftovers.
//   bell: the hero, Anchor Leap and Peal icons and screenshots of the Bellwarden (unlocked for the run; --weapon picks the bell): winding in a staged fight with Full Swing, a hurl in flight, the bell anchored, a reel, an Anchor Leap, a Peal, four Bellwardens in the crowd at High and Low quality,
//     and a client's view from a two-peer net check in the same page (host World + client Game, JSON snapshots, 50 ms each way); fails on bad bells, missing bell events or a client that drifts from the host (see scenBell).
//   verbs: one screenshot per path verb staged in the largest combat room (still foes in front of the hero, input through ED.Input like a player): the flame cone, Burn stacks, a death burst on Scorched Earth,
//     the ice lance charging and flying, a Shatter, a threshold discharge, the storm call, the finisher charging and striking;
//     fails on a page error or a verb whose zone, event or state did not appear.
//   arenas: 18 screenshots staged through the sim (BR.arena, heroes unhurt): the Drowned King (phase 1, tide warning, tide, beam warm-up and sweep, phases 2 and 3), the Hollow King (phase 1, duel, dark phase 2, a lit lantern,
//     phase 3, a ring warning, fallen rings) and the champion rooms (twins, a twin combo, mimic, mimic split); fails on a page error or a step without its fight.
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
  for (const s of o.scens) if (!/^(smoke|boss|shots|sheet|screens|wardrobe|cosmetics|swing|picks|cards|bell|arenas|verbs|crowd\d{1,4})$/.test(s)) throw new Fail('unknown scenario ' + s + ' (smoke, boss, shots, sheet, screens, wardrobe, cosmetics, swing, picks, cards, bell, arenas, verbs, crowdN)');
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
  const D = { on: false, flow: false, t0: 0, tq: 0, te: 0, tr: 0, td: 0, hops: 0, offers: 0, picks: 0, room: -1, epoch: -1, roomAt: 0, acts: { atk: 0, skill: 0, skill2: 0, skill3: 0, dash: 0, interact: 0 } };
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
      if (a) { const k = a.t === 'skill' ? (a.slot === 2 ? 'skill3' : a.slot ? 'skill2' : 'skill') : a.t; if (k in D.acts) D.acts[k]++; }
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

  // enters the boss room of stratum strat (the boss spawns on its own); hp: set the boss to that fraction of max HP (its phase change follows); returns the boss state
  BR.bossStage = (strat, hp) => {
    const ED = window.__ED, w = ED.Game.s.world;
    if (hp === undefined) {
      if (strat !== w.stratum) w.enterStratum(strat);
      const r = w.floor.rooms.find(q => q.type === 'boss'); if (!r) throw new Error('no boss room');
      w.enterRoom(r.id, null);
    } else if (w.boss) w.boss.hp = Math.min(w.boss.hp, w.boss.maxHp * hp);
    const b = w.boss, ar = window.__ED.Arena.field(w.room);
    return b ? { type: b.type, phase: b.phase, hp: Math.round(b.hp), walls: (ar && ar.walls ? ar.walls.filter(q => q.hp > 0).length : 0), carpet: (ar && ar.carpet ? ar.carpet.reduce((a, v) => a + v, 0) : 0) } : null;
  };

  // scripted hero: orbits the nearest foe (the room centre when none), attacks it, casts both skills, dashes, takes boon offers, hops combat rooms when `flow`
  BR.drive = (on, flow) => {
    D.on = !!on; D.flow = !!flow; D.t0 = performance.now(); D.tq = D.te = D.tr = D.td = 0;
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
    if (t >= D.tr) { I.pressed.add('KeyR'); D.tr = t + 0.7; } // skill 3 (a hero without one casts skill 1)
    if (t >= D.td) { I.pressed.add('Space'); D.td = t + 2.4; }
  }, 33);

  // contact sheet of the melee swings of `cls` aimed `aimDeg` degrees (0 = right, 90 = down): one PNG per weapon (its Armory variants included), frames at fixed times (idle, then per attack wind, strike, end, settled,
  // then hold and ease to idle): two attacks, or one per step of a combo weapon (each drawn with its step's form); the hero drawn by Sprites.hero from a fake player and the smear (a slam: FX.slam) by FX.drawGlow; needs a run (FX.playerAttackAnim reads the world view)
  BR.swingStrip = (cls, aimDeg, zoom, weapons) => {
    const ED = window.__ED, F = ED.FX, view = ED.Game.s.view, out = [], pid = 'sw-fake', face = aimDeg * Math.PI / 180, K2 = zoom, CW = 120 * zoom, CH = 140 * zoom, COLS = zoom > 2 ? 5 : 7;
    F.reset();
    for (const wid of weapons.length ? weapons : ED.weaponChoices(cls)) {
      const w = ED.Sprites.weaponArt({ cls, weapon: wid }).w; if (w.kind !== 'melee' && !weapons.length) continue; // a ranged weapon only when named by --weapon
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
        if (w.kind === 'melee' && f[0] >= 0 && f[1] >= an.t0 && f[1] < an.D + 0.1) {
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
      foes: w ? w.hostiles() : 0, offers: D.offers, picks: D.picks, hops: D.hops, acts: Object.assign({}, D.acts), cls: me ? me.cls : null, skill2: me ? !!ED.CLASSES[me.cls].skill2 : false, skill3: me ? !!ED.CLASSES[me.cls].skill3 : false,
    };
  };

  // opens a boon offer when one is queued; true when the overlay is up
  BR.offerOpen = () => { const s = window.__ED.Game.s; return !!(s && s.offerOpen); };
  BR.take = () => { const ED = window.__ED; if (ED.Game.s && ED.Game.s.offerOpen) ED.UI.boonConfirm(); return BR.offerOpen(); };

  // arenas scenario: one staging step per screenshot. 'king' / 'hollow' enter that boss's room (its stratum) and wait for the boss; 'twins' / 'mimic' start that champion fight in a combat room;
  // the other steps force a mechanic on the running fight (tide warning, beam, phases, a lit lantern, a ring warning, a mimic split). Heroes stay unhurt, the boss unkillable.
  let god = 0;
  setInterval(() => { const s = god && window.__ED.Game.s; if (s && s.world) for (const p of s.world.players.values()) { p.hp = p.maxHp; p.invuln = 1; p.downed = false; } }, 50);
  BR.arena = (step) => {
    const ED = window.__ED, s = ED.Game.s, w = s && s.world;
    if (!w) throw new Error('no run');
    god = 1;
    const T = ED.CONST.TILE, me = s.me, b = w.boss, ar = w.room && w.room.arena;
    const enter = (id) => {
      const st = ED.BIOMES.findIndex(x => x.boss === id) + 1;
      if (st !== w.stratum) w.enterStratum(st);
      const room = w.floor.rooms.find(r => r.type === 'boss');
      const d = Object.keys(room.doors).find(k => room.doors[k] >= 0);
      w.enterRoom(room.id, ED.Dungeon.OPP[d]);
      return room.id;
    };
    const force = (k) => { b.st = 'atk'; b.atk = k; b.t = 0; b.vars = { wm: 1 }; b.pose = 'idle'; ED.Bosses[b.type].attacks[k].start(w, b); };
    const toPhase = (f) => { b.hp = b.maxHp * f; };
    if (step === 'king' || step === 'hollow') return enter(step === 'king' ? 'drownedking' : 'hollowking');
    if (step === 'twins' || step === 'mimic') {
      if (w.stratum !== 4) w.enterStratum(4);
      const room = w.floor.rooms.find(r => r.type === 'combat' && !r.dark);
      w.roomState[room.id].cleared = true; room.champ = step; w.enterRoom(room.id, null); w.startChampion(room);
      return room.id;
    }
    if (!b && step !== 'split') return 'no boss';
    if (b && !b.staged) { b.staged = true; b.hp = b.maxHp = 1e7; }
    if (step === 'fight') { me.x = b.x + 160; me.y = b.y + 40; return b.type; }
    if (step === 'tide') { ar.next = 0; return 'tide'; }
    if (step === 'beam') { force('beam'); return 'beam'; }
    if (step === 'p2') { toPhase(0.5); return 2; }
    if (step === 'p3') { toPhase(0.2); return 3; }
    if (step === 'lantern') { const L = w.room.lanterns[1]; me.x = L.x - 30; me.y = L.y + 20; w.smashCircle(me, L.x, L.y, 8); return ar.lit.join(); }
    if (step === 'ring') { ar.p3 = ED.Arena.crown.CRUMBLE.at[0] - ED.Arena.crown.CRUMBLE.warn + 0.1; return 'ring'; }
    if (step === 'fall') { ar.p3 = ED.Arena.crown.CRUMBLE.at[1] - 0.05; return 'fall'; }
    if (step === 'split') { const m = w.enemies.find(e => e.type === 'mimic'); if (m) m.hp = m.maxHp * 0.45; return !!m; }
    if (step === 'off') { god = 0; return 0; }
    throw new Error('unknown arena step ' + step);
  };

  // late build on the solo hero at stratum `strat`: two element paths (the first evolved, the second at its keystone), open boons, the first route with its first fork at rank 3,
  // six relics, level 14, a shield, the first-exit path walked up to half the rows (the hero in its last room), and an ally hero (second class) beside the hero; returns a summary
  BR.sheetStage = (strat) => {
    const ED = window.__ED, s = ED.Game.s, w = s && s.world;
    if (!w) throw new Error('no run to stage the sheet in');
    if (strat && strat !== w.stratum) w.enterStratum(strat);
    const p = s.me, B = ED.BOONS, cls = p.cls, els = ED.ELEMENT_IDS.filter(e => e !== ED.CLASSES[cls].element).slice(0, 2), boons = {};
    const pathIds = (path) => Object.keys(B).filter(id => B[id].path === path && !B[id].open && !B[id].cls && !B[id].retired);
    for (const [i, el] of els.entries()) {
      const ids = pathIds(el), gate = ids.find(id => B[id].gate), key = ids.find(id => B[id].key), evo = ids.find(id => B[id].evo);
      boons[gate] = 1;
      const want = i === 0 ? ED.EVO_AFFINITY : ED.KEY_AFFINITY;
      for (const id of ids) { if (B[id].gate || B[id].key || B[id].evo || B[id].need === (ED.CLASSES[cls].kind === 'melee' ? 'proj' : 'melee')) continue; if (ED.pathAffinity(boons, el) + 1 >= want) break; boons[id] = Math.min(B[id].max || 5, Math.max(1, want - 1 - ED.pathAffinity(boons, el))); }
      if (key) boons[key] = 1;
      if (i === 0 && evo) boons[evo] = 1;
    }
    Object.keys(B).filter(id => B[id].open && !B[id].purse && !B[id].cls).slice(0, 4).forEach((id, i) => { boons[id] = Math.min(B[id].max || 5, i + 1); });
    const route = ED.CLASS_CARDS[cls][ED.ROUTES[0]]; boons[route.t1] = 1; boons[route.forks[0]] = Math.min(3, B[route.forks[0]].max || 3);
    p.boons = boons; p.relics = Object.keys(ED.RELICS).slice(0, 6);
    w.recalc(p, true); w.sendBuild(p);
    p.shield = Math.round(p.maxHp * 0.18 * 10) / 10 + 0.4;
    w.level = Math.max(w.level | 0, 14); if (ED.World.xpFor) { w.xpNext = ED.World.xpFor(w.level); w.xp = Math.floor(w.xpNext * 0.62); } w.gold = 347;
    p.hp = Math.max(1, Math.ceil(p.maxHp * 0.7) - 0.3);
    const rooms = w.floor.rooms; let at = rooms[w.floor.start];
    while (at.row < (w.floor.rows / 2 | 0) && at.exits.length) { w.roomState[at.id].visited = w.roomState[at.id].cleared = true; at = rooms[at.exits[0]]; }
    w.roomState[at.id].cleared = true; w.enterRoom(at.id, 's');
    let ally = null;
    if (!w.players.has('ally')) {
      const ac = ED.CLASS_IDS.find(c => c !== cls);
      ally = w.addPlayer({ pid: 'ally', name: 'Wren', slot: 1, cls: ac, weapon: ED.weaponChoices(ac)[0] });
      ally.x = p.x + 30; ally.y = p.y; ally.hp = Math.ceil(ally.maxHp * 0.6);
    }
    return { cls, els, boons: Object.keys(boons).length, relics: p.relics.length, stratum: w.stratum, ally: ally && ally.cls };
  };

  // the room of the current floor with the most exit doors (a map room before the start camp on a tie), cleared so its doors stand open; the hero 5.5 tiles below its north wall; returns a summary
  BR.doorStage = () => {
    const ED = window.__ED, s = ED.Game.s, w = s && s.world;
    if (!w) throw new Error('no run to stage the doors in');
    let best = null;
    for (const r of w.floor.rooms) if (r.type !== 'boss' && (!best || r.exits.length > best.exits.length || (r.exits.length === best.exits.length && best.row === 0 && r.row > 0))) best = r;
    w.roomState[best.id].cleared = true; w.enterRoom(best.id, 's');
    const p = s.me, T = ED.CONST.TILE; p.x = best.w * T / 2; p.y = 5.5 * T;
    for (const q of w.players.values()) if (q !== p) { q.x = p.x + 40; q.y = p.y; }
    return { room: best.id, type: best.type, row: best.row, exits: best.exits.length, names: best.exits.map(id => ED.Render.roomName ? ED.Render.roomName(w.floor.rooms[id]) : w.floor.rooms[id].type) };
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
  // verbs: step 'room' enters the largest combat room (cleared, hero centred); any other step sets the step's boons, lines up still foes to the hero's right and starts the verb
  // (keys: Mouse0 held for holds; 'release' lets go of Mouse0); returns { ok, what } read back from the sim
  const VB = { cone: { kindle: 1, evo_fire: 1 }, stacks: { kindle: 1 }, burst: { kindle: 1, scorched: 1 }, lance: { frostbite: 1, evo_ice: 1 }, shatter: { frostbite: 1 }, discharge: { staticcharge: 1, conductor: 1 },
    storm: { staticcharge: 1, evo_lightning: 1 }, finisher: { generalist: 1, masterstroke: 1 } };
  BR.verb = (step) => {
    const ED = window.__ED, s = ED.Game.s, w = s && s.world, I = ED.Input, R = ED.Render, T = ED.CONST.TILE;
    if (!w) throw new Error('no run');
    const me = s.me, aimAt = (x, y) => { const sp = R.toScreen(x, y); I.mouse.x = sp.x / (R.dpr || 1); I.mouse.y = sp.y / (R.dpr || 1); I.mouse.moved = performance.now(); I.mouse.inside = true; };
    if (step === 'room') {
      god = 1;
      let best = null;
      for (const r of w.floor.rooms) if ((r.type === 'combat' || r.type === 'elite') && (!best || r.w * r.h > best.w * best.h)) best = r;
      w.roomState[best.id].cleared = true; w.enterRoom(best.id, null);
      return { ok: true, what: 'room ' + best.id };
    }
    if (step === 'release') { I.keys.delete('Mouse0'); return { ok: true, what: 'released' }; }
    if (step === 'off') { I.keys.delete('Mouse0'); god = 0; return { ok: true, what: 'off' }; }
    I.keys.delete('Mouse0');
    me.boons = Object.assign({}, VB[step]); w.recalc(me, true); w.sendBuild(me);
    w.enemies.length = 0; w.zones.length = 0; w.projs.length = 0;
    const free = (x, y) => { for (let dx = -20; dx <= 300; dx += 8) for (const dy of [-44, 0, 44]) if (ED.Dungeon.tileAt(w.room, x + dx, y + dy) !== 0) return false; return true; };
    let cx = 0, cy = 0; // a clear lane 320 px long and 88 px tall nearest the room centre: the hero at its left end
    for (let best = Infinity, y = 3 * T; y < (w.room.h - 3) * T; y += T / 2) for (let x = 3 * T; x < w.room.w * T - 300; x += T / 2) { const d = Math.hypot(x + 120 - w.room.w * T / 2, y - w.room.h * T / 2); if (d < best && free(x, y)) { best = d; cx = x + 90; cy = y; } }
    me.x = cx - 90; me.y = cy; me.vx = me.vy = 0;
    const foes = [70, 120, 170].map((dx, i) => { const e = w.spawnEnemy(ED.biomeFor(w.stratum).enemies[0][0], me.x + dx, me.y + (i - 1) * 28); e.spawnT = 0; e.spd = 0; e.cd = 9999; e.hp = e.maxHp = 1e6; e.target = me; return e; });
    const e0 = foes[0];
    const charge = () => { for (const e of foes) { e.charge = 60; e.chargeOwner = me; e.chargeT = 3; } };
    BR._go = () => { // after the camera has followed the hero: aim (screen coordinates) and act
      aimAt(e0.x + 40, e0.y);
      s.ctl.dashN = me.stats.dashCharges; s.ctl.dashT = 0; s.ctl.atkCd = 0;
      switch (step) {
        case 'cone': case 'lance': case 'storm': case 'finisher': I.keys.add('Mouse0'); break;
        case 'stacks': for (const e of foes) for (let i = 0; i < 3 + foes.indexOf(e) * 3; i++) w.burnStack(e, me, 0); break;
        case 'burst': for (let i = 0; i < 6; i++) w.burnStack(e0, me, 0); w.killEnemy(e0, me, {}); break;
        case 'shatter': w.freezeEnemy(e0, me); e0.frozenAt = w.time - 1; w.hitEnemy(e0, 20, { p: me, kind: 'weapon' }); break;
        case 'discharge': charge(); w.addCharge(e0, e0.maxHp, me); break;
      }
      return true;
    };
    return { ok: true, what: step };
  };
  BR.verbGo = () => { const g = BR._go; BR._go = null; return g ? g() : false; };
  // the sim state a verb step should have left: true when its zone, event or state is there
  BR.verbSeen = (step) => {
    const ED = window.__ED, s = ED.Game.s, w = s.world, me = s.me, z = (k) => w.zones.some(q => q.kind === k && !q.dead), f = (t) => (BR._fx || []).some(v => v.t === t);
    switch (step) {
      case 'cone': case 'storm': case 'finisher': case 'lance': return !!me.holdOn;
      case 'stacks': return w.enemies.some(e => e.burnN >= 6);
      case 'burst': return f('boom') && z('pfire');
      case 'shatter': case 'discharge': return f({ shatter: 'shatter', discharge: 'chain' }[step]);
      case 'lance-shot': return w.projs.some(q => q.kind === 'iceshard' && q.team === 0) || f('lance');
      case 'finisher-hit': return f('finisher');
    }
    return false;
  };
  // every card frame mask (kinds x metals, the big trims, a route frame per hero) drawn at 6 x on one sheet: PNG data URL
  BR.cardSheet = (cls) => {
    const ED = window.__ED, CA = ED.CardArt, PU = ED.PixUI, Z = 5, M = ['iron', 'silver', 'violet', 'gold'], rows = [];
    for (const k of ['fire', 'ice', 'lightning', 'general', 'purse']) rows.push([k, M.map(m => CA.frame(k, m, {})).concat(k === 'purse' ? [] : [CA.frame(k, 'gold', { big: true })])]);
    rows.push(['route', M.map(m => CA.frame('route', m, { cls }))]);
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

  // ---- bell: the Bellwarden ----
  // the hero unlocked on the profile (its riddle is not part of the scenario); every FX event counted by type (bstrike with h counted as 'bstrike.h', skill events as 'skill.<k>')
  BR.bellUnlock = () => { const A = window.__ED.App; if (!A.hasProfile) A.createProfile('Tester'); A.profile.bellUnlocked = true; A.persist(); return true; };
  BR.bellCount = () => {
    const F = window.__ED.FX;
    if (!BR._bev) { BR._bev = {}; const h = F.handle; F.handle = function (ev) { if (ev) { const k = ev.t === 'bstrike' && ev.h ? 'bstrike.h' : ev.t === 'skill' ? 'skill.' + ev.k : ev.t; BR._bev[k] = (BR._bev[k] || 0) + 1; } return h.apply(this, arguments); }; }
    return Object.assign({}, BR._bev);
  };
  // boons on the solo hero
  BR.bellBoons = (boons) => { const s = window.__ED.Game.s, w = s.world, p = s.me; p.boons = Object.assign({}, boons); w.recalc(p, true); w.sendBuild(p); return Object.keys(p.boons); };
  // the local hero's bells: count, states (ED.Bell.STATES), the most-wound hand bell's wind and the hurl threshold, whirl, an Anchor Leap in flight, Resonance, top speed, chain, the farthest hand bell and the farthest bell
  // from the hero, the leash, all numbers finite
  BR.bellState = () => {
    const ED = window.__ED, s = ED.Game.s, p = s.me, b = p.bells || [], C = ED.CONST, ref = p.stats && p.stats.weapon.kind === 'bell' ? ED.Bell.windRef(p.stats) : 0;
    let sp = 0, far = 0, farAll = 0, wind = 0, fin = true;
    for (const q of b) {
      const v = Math.hypot(q.vx, q.vy), d = Math.hypot(q.x - p.x, q.y - p.y);
      sp = Math.max(sp, v); farAll = Math.max(farAll, d);
      if (q.s === ED.Bell.STATES.HAND) { far = Math.max(far, d); if (ref > 0) wind = Math.max(wind, Math.min(1, v / ref)); }
      for (const x of [q.x, q.y, q.vx, q.vy, q.ox, q.oy]) if (x !== undefined && !isFinite(x)) fin = false;
    }
    return { n: b.length, s: b.map((q) => q.s), wind: r3(wind), go: C.WIND_GO, whirl: !!p.bellWhirl, leap: !!p.bellLeap, res: p.bellRes | 0, sp: Math.round(sp), L: Math.round(p.bellL || 0), far: Math.round(far), farAll: Math.round(farAll),
      leash: C.LEASH, fin, charges: s.ctl.charges, cd2: r3(s.ctl.skill2Cd) };
  };
  // input: hold or release the attack (wind; a release hurls, a press reels), tap a skill key, put the cursor at world (x, y)
  BR.bellInput = (o) => {
    const ED = window.__ED, I = ED.Input, R = ED.Render, s = ED.Game.s;
    if (o.haul !== undefined) { if (o.haul) I.keys.add('Mouse0'); else I.keys.delete('Mouse0'); }
    if (o.key) I.pressed.add(o.key);
    if (o.move !== undefined) { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) I.keys.delete(k); if (o.move) I.keys.add(o.move); }
    if (o.at) { const sp = R.toScreen(o.at[0], o.at[1]); I.mouse.x = sp.x / (R.dpr || 1); I.mouse.y = sp.y / (R.dpr || 1); I.mouse.moved = performance.now(); I.mouse.inside = true; }
    return s ? { x: Math.round(s.me.x), y: Math.round(s.me.y) } : null;
  };
  // three more Bellwardens winding beside the solo hero (weapons: their weapon ids), for the four-hero crowd shot
  BR.bellParty = (weapons) => {
    const ED = window.__ED, s = ED.Game.s, w = s.world, me = s.me, out = [];
    weapons.forEach((wid, i) => {
      const pid = 'bp' + i; if (w.players.has(pid)) return;
      const a = w.addPlayer({ pid, name: 'Bell ' + (i + 2), slot: i + 1, cls: 'bell', weapon: wid });
      const ang = i * 2.1 + 0.6; a.x = me.x + Math.cos(ang) * 70; a.y = me.y + Math.sin(ang) * 50; a.haulIn = true; a.face = ang + Math.PI;
      ED.Sim.resolve(a, w.room, w.locked, false); out.push(a.stats.weaponId);
    });
    return out;
  };
  // Two peers in one page: a host World (hero h0 winding in place, hero c1 the client's) steps at 60 Hz and sends snapshots at 20 Hz through JSON, each way delayed lat s;
  // this page runs Game as the client of c1 (prediction and reconciliation of its own bells, interpolation of h0's) under scripted input; ring: four still foes around c1 (host strikes slow its bell). Returns the client's reconcile stats and bell checks.
  BR.bellNet = async (secs, lat, ring) => {
    const ED = window.__ED, G = ED.Game, N = ED.Net, I = ED.Input, meta = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
    const players = [{ pid: 'h0', name: 'Host', slot: 0, cls: 'bell', weapon: 'greatbell', meta: meta() }, { pid: 'c1', name: 'Client', slot: 1, cls: 'bell', weapon: 'bronzebell', meta: meta() }];
    const w = new ED.World({ seed: cfg.seed, pact: 0, players: players.map(p => Object.assign({ remote: p.pid !== 'h0' }, p)) });
    w.startRun();
    const later = (f) => setTimeout(f, lat * 1000);
    const net = { send: (m) => { const d = JSON.parse(JSON.stringify(m)); later(() => {
      const p = w.players.get('c1'); if (!p) return;
      if (d.t === 'in') { p.x = +d.x; p.y = +d.y; p.face = +d.f || 0; p.moving = !!d.mv; p.vx = +d.vx || 0; p.vy = +d.vy || 0; if (d.h !== undefined) { p.haulIn = !!d.h; p.haulPress = d.hp | 0; p.haulNear = !!d.nh; p.inSeq = d.q | 0; p.inT = w.time; } } // as game.js applies a client's input
      else if (d.t === 'act') G.applyAction(w, 'c1', d.a);
    }); }, sendTo: () => {}, broadcast: () => {} };
    G.start('client', { localPid: 'c1', players, pact: 0, net });
    const h0 = w.players.get('h0'); h0.haulIn = true;
    let steps = 0, snaps = 0, foes = 0, hauledSeen = 0, remoteBad = 0, remoteN = 0;
    const hz0 = performance.now(), host = setInterval(() => { while (steps < (performance.now() - hz0) * 0.06) hostStep(); }, 8); // 60 steps per second of wall time, as a real host
    const hostStep = () => {
      for (const p of w.players.values()) { p.hp = p.maxHp; p.downed = false; }
      if (ring && !foes && steps > 30) { // a ring of still, tough foes around the client's hero: its bells strike and lose speed on the host
        const c1 = w.players.get('c1'), type = ED.biomeFor(w.stratum).enemies.map(q => q[0]).find(id => { const d = ED.ENEMIES[id]; return d && !d.boss && !d.gloom && !d.ally && !d.minion && !d.fly; });
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4, e = w.spawnEnemy(type, c1.x + Math.cos(a) * 44, c1.y + Math.sin(a) * 44); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 1e6; foes++; }
      }
      w.update(1 / 60); steps++;
      w.msgs.length = 0;
      if (steps % 3 === 0) { const d = JSON.parse(JSON.stringify(N.encodeSnap(w, w.fx, snaps % 30 === 0))); w.fx.length = 0; snaps++; later(() => G.onClientData(d)); }
    };
    const t0 = performance.now(), el = () => (performance.now() - t0) / 1000;
    let w0 = null; // the client's correction totals after 1 s (the host world ran before the client's first snapshot: the first corrections settle that)
    try {
      I.keys.add('Mouse0');
      while (el() < secs) {
        const t = el(), s = G.s, R = ED.Render;
        if (!s || !s.me) break;
        const sp = R.toScreen(s.me.x + 80, s.me.y - 20); I.mouse.x = sp.x / (R.dpr || 1); I.mouse.y = sp.y / (R.dpr || 1); I.mouse.moved = performance.now(); I.mouse.inside = true;
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) I.keys.delete(k);
        if (t > 1.5 && t < 2.3) I.keys.add('KeyD'); else if (t > 2.3 && t < 3.1) I.keys.add('KeyA');
        if (t > 3.1 && t < 3.7) I.keys.delete('Mouse0'); else I.keys.add('Mouse0');
        if (Math.abs(t - 4.2) < 0.03) I.pressed.add('KeyQ');
        if (Math.abs(t - 5.6) < 0.03) I.pressed.add('KeyE');
        if (!w0 && t > 1 && s.bp) w0 = { rn: s.bp.rn, re: s.bp.re, rb: s.bp.rb };
        const rp = s.mirror.players.get('h0');
        if (rp && rp.bells) { remoteN++; if (rp.bellHauled) hauledSeen++; for (const b of rp.bells) { const d = Math.hypot(b.ox, b.oy); if (!isFinite(d) || d > rp.stats.weapon.chain * 1.9 + 12) remoteBad++; } }
        await sleep(16);
      }
    } finally { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Mouse0']) I.keys.delete(k); }
    BR._bellHost = host; // stopped by bellNetEnd, after the screenshot
    const s = G.s, B = s && s.bp, p = s && s.me;
    let fin = !!p && !!p.bells && p.bells.length === 1, far = 0;
    if (p && p.bells) for (const b of p.bells) { for (const v of [b.x, b.y, b.vx, b.vy, b.ox, b.oy]) if (!isFinite(v)) fin = false; if (b.s === ED.Bell.STATES.HAND) far = Math.max(far, Math.hypot(b.x - p.x, b.y - p.y)); }
    const hostC1 = w.players.get('c1');
    const m = B && w0 && B.rn > w0.rn ? B.rn - w0.rn : 0;
    return { steps, snaps, sent: B ? B.seq : 0, rn: m, err: m ? r3((B.re - w0.re) / m) : null, bias: m ? r3((B.rb - w0.rb) / m) : null, snapsToHost: B ? B.rs : 0, stateSnaps: B ? B.rss | 0 : 0, fin, far: Math.round(far), chain: p ? p.stats.weapon.chain : 0,
      remoteN, remoteHauled: hauledSeen, remoteBad, hostStrikes: hostC1 ? hostC1.atkCount | 0 : 0, hostHaul: hostC1 ? !!hostC1.haulIn : null, version: N.VERSION };
  };
  // the Bellwarden's icons (hero, Heave, Peal) side by side at 128 px: PNG data URL
  BR.bellIcons = () => {
    const ED = window.__ED, cv = document.createElement('canvas'), ids = ['bell', 'heave', 'peal'], col = ED.CLASSES.bell.col.c;
    cv.width = ids.length * 136 + 8; cv.height = 144;
    const g = cv.getContext('2d'); g.fillStyle = '#15100d'; g.fillRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false;
    ids.forEach((id, i) => g.drawImage(ED.Icons.canvas(id, col, 128), 8 + i * 136, 8, 128, 128));
    return cv.toDataURL('image/png');
  };
  // Standing Bellwardens outside a run (no p.bells: camp, Wardrobe preview): each bell weapon, then the Bronze Bell with its worn sheen, at 4 canvas px per world px.
  BR.bellIdle = (t) => {
    const ED = window.__ED, ws = ['bronzebell', 'greatbell', 'handbells', 'chimes', 'bronzebell'], cv = document.createElement('canvas'), M = 4;
    cv.width = ws.length * 50 * M; cv.height = 50 * M;
    const g = cv.getContext('2d'); g.fillStyle = '#15100d'; g.fillRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false;
    if (ED.Atlas && ED.Atlas.tick) ED.Atlas.tick(4);
    ws.forEach((wid, i) => {
      const hero = { pid: 'idle' + i, cls: 'bell', slot: i & 3, weapon: wid, face: 0, moving: false, hp: 1, maxHp: 1, wear: i === 4 ? { tints: ['bronzebell'] } : undefined };
      g.save(); g.setTransform(M, 0, 0, M, (i * 50 + 18) * M, 40 * M); ED.Sprites.hero(g, hero, t, null); g.restore();
    });
    return cv.toDataURL('image/png');
  };
  BR.bellNetEnd = () => { clearInterval(BR._bellHost); BR._bellHost = null; window.__ED.Game.stop(); return true; };

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
    { // the skills recharge with the script idle, the cursor 150 px right of the hero: a 640 x 440 crop of the aim previews
      await wait(3000);
      const hc = await page.evaluate(() => { const ED = window.__ED, me = ED.Game.s && ED.Game.s.me, R = ED.Render, I = ED.Input; if (!me) return null; const p = R.toScreen(me.x, me.y), q = R.toScreen(me.x + 150, me.y), d = R.dpr || 1; I.mouse.x = q.x / d; I.mouse.y = q.y / d; I.mouse.moved = performance.now(); I.mouse.inside = true; return { x: p.x / d, y: p.y / d }; });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      if (hc) { const file = path.join(S.opt.outdir, [res.name, tag(), S.opt.cls, 'aim'].join('-') + '.png'); await page.screenshot({ path: file, clip: { x: Math.max(0, hc.x - 320), y: Math.max(0, hc.y - 220), width: 640, height: 440 } }); res.shots.push(file); }
    }
    res.run = rs;
    if (rs.app !== 'run') notes(res, 'run ended before the script did (app ' + rs.app + ')');
    if (rs.time < secs * 0.5) fail(res, 'world time advanced ' + rs.time + ' s in ' + secs + ' s of wall time');
    if (!rs.kills) notes(res, 'no kill in ' + secs + ' s');
    if (rs.cls !== o.cls) fail(res, 'ran as ' + rs.cls + ', not ' + o.cls);
    if (secs >= 10) for (const k of ['atk', 'skill', 'dash']) if (!rs.acts[k]) fail(res, 'scripted input never produced a ' + k + ' action');
    if (secs >= 10 && rs.skill2 && !rs.acts.skill2) fail(res, 'scripted input never produced a skill2 action');
    if (secs >= 10 && rs.skill3 && !rs.acts.skill3) fail(res, 'scripted input never produced a skill3 action');
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

// arenas: screenshots of each Drowned King and Hollow King phase and both champion fights, staged through BR.arena (waits in ms after each step); fails on a page error or a step without its fight.
async function scenVerbs() {
  const o = S.opt, res = newResult('verbs'), q = qualitiesOr(['high'])[0];
  // [step, ms before the shot, shot name, state to check (default the step)]
  const PLAN = [['cone', 900, 'flame-cone'], ['release', 300, ''], ['stacks', 500, 'burn-stacks'], ['burst', 260, 'death-burst'], ['lance', 800, 'lance-charge'], ['release', 90, 'lance-flight', 'lance-shot'],
    ['shatter', 120, 'shatter'], ['discharge', 200, 'discharge'], ['storm', 800, 'storm-call'], ['release', 300, ''], ['finisher', 1200, 'finisher-charge'], ['release', 90, 'finisher-strike', 'finisher-hit']];
  const { ctx, page, errors } = await openPage();
  try {
    await call(page, 'profile', o.cls, o.embers);
    await call(page, 'settings', q);
    await call(page, 'install');
    if ((await call(page, 'start')) !== 'run') fail(res, 'run did not start');
    await wait(600);
    await call(page, 'verb', 'room');
    await wait(500);
    await page.evaluate(() => { const ED = window.__ED, h = ED.FX.handle; window.__BR._fx = []; ED.FX.handle = function (ev) { window.__BR._fx.push(ev); if (window.__BR._fx.length > 400) window.__BR._fx.shift(); return h.apply(this, arguments); }; });
    for (const [step, ms, name, check] of PLAN) {
      const r = await call(page, 'verb', step);
      if (step !== 'release') { await wait(250); await page.evaluate(() => { window.__BR._fx.length = 0; }); await call(page, 'verbGo'); }
      await wait(ms);
      if (name) {
        const seen = await call(page, 'verbSeen', check || step);
        if (!seen) fail(res, `${name}: no ${check || step} in the sim`);
        notes(res, `${name}: ${r.what}${seen ? '' : ' (missing)'}`);
        await shoot(page, res, name);
      }
    }
    await call(page, 'verb', 'off');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

async function scenArenas() {
  const o = S.opt, res = newResult('arenas'), q = qualitiesOr(['high'])[0];
  const PLAN = [['king', 6500, 'king-p1'], ['tide', 900, 'king-tide-warn'], ['', 3000, 'king-tide'], ['beam', 900, 'king-beam-warm'], ['', 1100, 'king-beam'], ['p2', 1500, 'king-p2'], ['p3', 2500, 'king-p3'],
    ['hollow', 6500, 'hollow-p1'], ['fight', 700, 'hollow-duel'], ['p2', 2500, 'hollow-p2-dark'], ['lantern', 700, 'hollow-p2-lantern'], ['p3', 1500, 'hollow-p3'], ['ring', 1200, 'hollow-p3-ring'], ['fall', 900, 'hollow-p3-fallen'],
    ['twins', 3500, 'twins'], ['', 2500, 'twins-combo'], ['mimic', 3500, 'mimic'], ['split', 900, 'mimic-split']];
  const { ctx, page, errors } = await openPage();
  try {
    await call(page, 'profile', o.cls, o.embers);
    await call(page, 'settings', q);
    await call(page, 'install');
    if ((await call(page, 'start')) !== 'run') fail(res, 'run did not start');
    await wait(600);
    for (const [step, ms, name] of PLAN) {
      if (step) { const r = await call(page, 'arena', step); if (r === 'no boss' || r === false) fail(res, step + ': ' + r); notes(res, step + ' ' + r); }
      await wait(ms);
      await shoot(page, res, name);
    }
    await call(page, 'arena', 'off');
  } finally { res.errors = errors; await ctx.close(); }
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

const PICK_SHOTS = ['fire', 'ice', 'lightning', 'general', 'route', 'relic', 'purse', 'fire-big', 'fire-ally'];
const PICK_CUES = ['fire', 'ice', 'lightning', 'general', 'route', 'relic', 'purse'].map(k => ({ label: k, cue: 'pick', arg: k }))
  .concat([{ label: 'fire big', cue: 'pick', arg: { k: 'fire', big: true } },
    { label: 'ice big', cue: 'pick', arg: { k: 'ice', big: true } }, { label: 'buy (hearth)', cue: 'buy' }]);
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
  { name: 'gates', spec: { src: 'start' }, boons: {}, ids: ['generalist', 'kindle', 'frostbite', 'staticcharge'], distinctIcons: true, pick: [3, 'lightning'] },
  { name: 'fire-ice', spec: { src: 'room' }, boons: R(['kindle', 'stoke', 'kindling', 'frostbite', 'deepcold', 'glacier'], [1, 2, 1, 1, 1, 1]), ids: ['fanflames', 'shatterpoint', 'wildfire', 'thermal'], pick: [1, 'ice'] },
  { name: 'storm', spec: { src: 'room' }, boons: R(['staticcharge', 'conductor', 'highvoltage', 'kindle', 'stoke'], [1, 1, 1, 1, 1]), ids: ['overload', 'longfuse', 'plasma', 'smother'] },
  { name: 'cross', spec: { src: 'room' }, boons: R(['generalist', 'keen', 'frostbite', 'deepcold'], [1, 1, 1, 1]), ids: ['icebreaker', 'brutal', 'permafrost', 'glacier'] },
  { name: 'open', spec: { src: 'epic' }, boons: { generalist: 1, keen: 1 }, ids: ['brutal', 'focus', 'wide', 'purse'], pick: [0, 'general'] },
  { name: 'evo', spec: { src: 'room' }, boons: R(['kindle', 'stoke', 'kindling', 'wildfire', 'smother'], [1, 3, 2, 1, 1]), ids: ['evo_fire', 'fanflames', 'vigor'], pick: [0, 'fire-big'] },
  { name: 'route', spec: { src: 'class', ctier: 1 }, boons: {}, ids: ['atk', 's1', 's2', 'el'].map(k => cls[0] + '_' + k), pick: [0, 'route'] },
  { name: 'fork', spec: { src: 'class', ctier: 2 }, boons: { [cls[0] + '_atk']: 1 }, ids: [cls[0] + '_atk_h', cls[0] + '_atk_s'] },
  { name: 'dense6', spec: { src: 'epic' }, boons: R(['kindle', 'stoke', 'frostbite', 'deepcold'], [1, 2, 1, 2]), ids: ['wildfire', 'permafrost', 'coldcycle', 'focus', 'plating', 'purse'], pick: [2, 'ice'] },
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
    for (const k of ['fire', 'ice', 'lightning', 'general', 'route', 'purse', 'fire+big']) if (![...seen].some(s => s === k || (k === 'fire+big' && /\+big$/.test(s)))) fail(res, 'no hand showed a ' + k + ' card');
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
    await call(page, 'cardHand', R(['kindle', 'kindling'], [1, 1]), ['stoke', 'wildfire', 'vigor'], { src: 'room' });
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

async function scenBoss() {
  const o = S.opt, res = newResult('boss'), q = qualitiesOr(['high'])[0], st = Math.max(1, o.strat | 0);
  const { ctx, page, errors } = await openPage();
  try {
    await call(page, 'profile', o.cls, o.embers);
    res.info = await call(page, 'settings', q);
    await call(page, 'install');
    if ((await call(page, 'start')) !== 'run') throw new Error('run did not start');
    await wait(600);
    await call(page, 'bossStage', st);
    for (const [ph, hp, ms] of [[1, undefined, 9000], [2, 0.6, 6000], [3, 0.3, 5000]]) {
      if (hp !== undefined) await call(page, 'bossStage', st, hp);
      await wait(ms);
      const b = await call(page, 'bossStage', st, 1);
      if (!b) { fail(res, 'no boss in phase ' + ph); break; }
      res.rows.push(Object.assign({ shot: 'phase' + ph }, b));
      if (b.phase !== ph) fail(res, 'boss in phase ' + b.phase + ', expected ' + ph);
      await shoot(page, res, 's' + st + '-' + b.type + '-phase' + ph);
      if (ph === 1) await call(page, 'drive', true, false);
    }
    await call(page, 'drive', false, false);
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
    const st = await call(page, 'sheetStage', o.strat > 1 ? o.strat : 3);
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
    const ds = await call(page, 'doorStage');
    notes(res, `doors: room ${ds.room} (${ds.type}, row ${ds.row}), ${ds.exits} exits: ${ds.names.join(' | ')}`);
    if (ds.exits < 3) fail(res, 'no room of the floor has 3 exit doors');
    await wait(900); await shoot(page, res, 'doors');
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
    if ((await focused()) !== 'wardrobe') fail(res, 'ArrowRight on the Hearth tabs did not focus Wardrobe (focus: ' + (await focused()) + ')');
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

async function scenWardrobe() {
  const o = S.opt, res = newResult('wardrobe');
  const { ctx, page, errors } = await openPage();
  const tryShot = async (name, fn, settle) => { try { if (fn) await fn(); await wait(settle == null ? 450 : settle); await shoot(page, res, name); } catch (e) { notes(res, 'shot ' + name + ' skipped: ' + String(e.message).split('\n')[0]); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(() => { const A = window.__ED.App; A.settings.frameCap = 'off'; A.applySettings(); });
    await call(page, 'profile', 'knight', 1000, '');
    // a riddle hero for the roster when the data has none: a locked copy of the Knight with an unlock hint (removed again before the results)
    const staged = await ev(() => {
      const E = window.__ED;
      if (E.CLASS_IDS.some(c => E.CLASSES[c].unlock && E.CLASSES[c].unlock.hint)) return false;
      E.CLASSES.zz_riddle = Object.assign({}, E.CLASSES.knight, { name: 'Riddle', unlock: { bell: true, text: '???', hint: 'In the drowned Sanctum, a bell waits for a hand that will not let go.' } });
      E.CLASS_IDS.push('zz_riddle'); E.ARMORY.zz_riddle = []; E.COS_SCOPE.zz_riddle = []; E.App.profile.mastery.push(0); E.App.profile.wear.zz_riddle = { tints: [] };
      return true;
    });
    if (staged) notes(res, 'no riddle hero in the data: a locked Knight copy stands in');
    await ev(() => {
      const E = window.__ED, p = E.App.profile;
      p.mastery[0] = E.MASTERY_XP[6]; p.mastery[2] = E.MASTERY_XP[9]; p.evo.longsword = 3; p.evo.warhammer = 1;
      for (const id of ['hearthsitter', 'platino', 'knight']) E.Save.grantSecret(p, id);
      E.App.persist();
    });
    await tryShot('w1-descend-roster', () => ev(() => window.__ED.App.enterHearth('descend')));
    // from 720 px tall the Descend screen fits without scrolling: the solo button ends inside the window
    const fit = await ev(() => ({ bottom: Math.round(document.getElementById('btn-solo').getBoundingClientRect().bottom), h: innerHeight, w: innerWidth }));
    notes(res, `Descend: solo button bottom ${fit.bottom} of ${fit.h} px`);
    if (fit.h >= 720 && fit.w >= 1200 && fit.bottom > fit.h) fail(res, `the Descend screen scrolls at ${fit.w}x${fit.h} (solo button bottom ${fit.bottom})`);
    await tryShot('w2-wardrobe', () => ev(() => window.__ED.App.enterHearth('wardrobe')));
    // buy the first skin through its chip and the confirm dialog; it is worn at once
    await tryShot('w3-buy-confirm', () => ev(() => { const b = document.querySelector('#wardrobe-view .wd-item.open'); if (!b) throw new Error('no skin for sale'); b.click(); }), 200);
    await ev(() => document.getElementById('modal-yes').click());
    const after = await ev(() => { const p = window.__ED.App.profile; return { cos: p.cos.slice(), skin: p.wear.knight.skin }; });
    if (after.cos.indexOf('skin.knight.a') < 0 || after.skin !== 'skin.knight.a') fail(res, 'buying the first Knight skin: ' + JSON.stringify(after));
    await tryShot('w4-wardrobe-bought', null, 120);
    // keyboard: ArrowRight moves along a slot row
    const moved = await ev(() => { const row = document.querySelector('#wardrobe-view .wd-items'); const a = row.querySelector('.wd-item'); a.focus(); a.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true })); return document.activeElement !== a && row.contains(document.activeElement); });
    if (!moved) fail(res, 'ArrowRight did not move focus along a Wardrobe row');
    const camp = await ev(() => { const b = [...document.querySelectorAll('#wardrobe-view .wd-item')].find(x => x.dataset.fk === 'w:camp:camp.bluehearth'); if (!b) return 'missing'; b.click(); return window.__ED.App.profile.wear.camp; });
    if (camp !== 'camp.bluehearth') fail(res, 'wearing the Blue Hearth: ' + camp);
    await tryShot('w5-wardrobe-scrolled', () => ev(() => { const s = [...document.querySelectorAll('#wardrobe-view .wd-slot')].pop(); if (s) s.scrollIntoView({ block: 'end' }); }));
    await tryShot('w6-chronicle-secrets', () => ev(() => { window.__ED.App.enterHearth('chronicle'); document.getElementById('secret-list').scrollIntoView({ block: 'center' }); }));
    const secretsTxt = await ev(() => document.getElementById('secret-list').textContent);
    if (!/The Platino/.test(secretsTxt) || !/secrets remain/.test(secretsTxt) || /Exact Change/.test(secretsTxt)) fail(res, 'secret list: ' + secretsTxt.slice(0, 160));
    await tryShot('w7-heroes-riddle', () => ev(() => { const E = window.__ED; E.App.enterHearth('heroes'); const id = E.CLASS_IDS.find(c => E.CLASSES[c].unlock && E.CLASSES[c].unlock.hint); E.UI.heroSel = id; E.UI.renderHearth(); }));
    const leak = await ev(() => { const E = window.__ED, id = E.CLASS_IDS.find(c => E.CLASSES[c].unlock && E.CLASSES[c].unlock.hint); const t = document.getElementById('scr-hearth').textContent; return t.indexOf(E.CLASSES[id].name) >= 0 || /victory|Hollow King/i.test(document.getElementById('heroes-view').textContent); });
    if (leak) fail(res, 'the riddle hero\'s name or condition shows on the Heroes page');
    await tryShot('w8-party-wardrobe', () => ev(() => {
      const E = window.__ED, A = E.App, UI = E.UI;
      A.state = 'lobby'; UI.show('lobby');
      A.lobbyState = { code: 'K7QX2', pact: 0, members: [{ slot: 0, pid: 'host', name: A.profile.name, cls: A.sel.cls, weapon: A.sel.weapon, isHost: true, ready: true }] };
      UI.renderLobby(A.lobbyState, 'host', true); UI.phTab = 'wardrobe'; UI.openPartyHearth();
    }));
    await tryShot('w9-results-secrets', () => ev((st) => {
      const E = window.__ED, A = E.App, UI = E.UI;
      document.getElementById('ov-hearth').hidden = true; A.lobbyState = null;
      if (st) { E.CLASS_IDS.pop(); delete E.CLASSES.zz_riddle; }
      const run = { victory: true, stratum: 6, time: 1534, level: 22, roomsCleared: 40, roomsTotal: 52, roomsVisited: 47, kills: 1800, bossCount: 6, party: 1, pact: 10, cls: 'knight', gold777: true, evolved: true, weapon: 'warhammer', embers: { rooms: 80, elites: 30, bosses: 60, victory: 40 }, me: { thread: true, bellRung: true } };
      const r = E.Save.applyRun(A.profile, run);
      A.state = 'results'; UI.renderResults(run, r); UI.show('results');
    }, staged));
    const resTxt = await ev(() => document.getElementById('res-progress').textContent);
    if (!/Secret found: Exact Change/.test(resTxt) || !/Secret found: Hollow Crown/.test(resTxt)) fail(res, 'results lack the secrets: ' + resTxt.replace(/\s+/g, ' ').slice(0, 200));
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  if (res.shots.length < 8) fail(res, 'only ' + res.shots.length + ' screenshots were taken');
  return res;
}

// bell: the Bellwarden (unlocked on the profile) wielding --weapon (default its first) in a staged fight of 14 foes with Full Swing: wind, a full-wind hurl (in flight, anchored), a tap that reels it home, a hurl and an Anchor Leap to it, a Peal,
// a four-Bellwarden crowd (High and Low quality), then a two-peer net check in the same page (BR.bellNet: host World + client Game over JSON with 50 ms each way). Fails on a page error, a non-finite or runaway bell
// (a hand bell off its chain, any bell past the leash), a full-wind release that does not hurl, a hurl that never anchors, a tap that does not reel, a bell that never comes home, no strike / hurl / reel / Peal / Anchor Leap event,
// a client whose bells drift from the host's (after 1 s: mean phase error over 0.3 rad, a lead or lag over 0.08 rad on open floor or 0.2 among foes, phase snaps beyond the first; state snaps are reported), remote bells that never show the host's wind,
// or no hurl on the host from the client's input.
async function scenBell() {
  const o = S.opt, cls0 = o.cls, q = qualitiesOr(['high'])[0], wid = o.weapon ? o.weapon.split(',')[0] : '';
  o.cls = 'bell'; // shot names and the result row name the Bellwarden
  const res = newResult('bell'), { ctx, page, errors } = await openPage(), FLY = 1, ANCHOR = 2, REEL = 3, HAND = 0; // ED.Bell.STATES
  const st = () => call(page, 'bellState');
  const waitFor = async (pred, ms) => { const t0 = Date.now(); let s; do { s = await st(); if (pred(s)) return s; await wait(100); } while (Date.now() - t0 < ms); return s; };
  try {
    await call(page, 'bellUnlock');
    await call(page, 'profile', 'bell', o.embers, wid);
    await call(page, 'settings', q);
    await call(page, 'install');
    await call(page, 'bellCount');
    const icons = path.join(o.outdir, ['bell', tag(), 'bell', 'icons'].join('-') + '.png');
    fs.writeFileSync(icons, Buffer.from((await call(page, 'bellIcons')).split(',')[1], 'base64')); res.shots.push(icons);
    await call(page, 'bellIdle', 0); await wait(400); await call(page, 'bellIdle', 0.4); await wait(300);
    const idle = path.join(o.outdir, ['bell', tag(), 'bell', 'idle'].join('-') + '.png');
    fs.writeFileSync(idle, Buffer.from((await call(page, 'bellIdle', 0.9)).split(',')[1], 'base64')); res.shots.push(idle);
    if ((await call(page, 'start')) !== 'run') fail(res, 'run did not start');
    await wait(1100);
    for (let i = 0; i < 6 && await call(page, 'offerOpen'); i++) { await call(page, 'take'); await wait(300); }
    const stg = await call(page, 'stage', 14, o.strat);
    notes(res, `staged room ${stg.w}x${stg.h}, stratum ${stg.stratum}; boons ${(await call(page, 'bellBoons', { b_atk: 1 })).join(', ')}`);
    const bad = (s) => !s.fin || s.far > s.L * 2 + 20 || s.farAll > s.leash + 140; // a hand bell off its chain, any bell past the leash's drag, a non-finite number
    await call(page, 'drive', true, false);
    let whirl = 0, worst = null;
    for (let i = 0; i < 25; i++) { await wait(120); const s = await st(); if (s.whirl) whirl++; if (bad(s)) worst = s; }
    await shoot(page, res, 'wind');
    await call(page, 'drive', false, false);
    if (!whirl) fail(res, 'the wound bell never reached strike speed in 3 s of driving');
    // a hurl at full wind toward a point 150 px to the right: the bell flies, lies anchored, and a tap reels it home
    const me = await call(page, 'bellInput', { haul: true });
    await call(page, 'bellInput', { at: [me.x + 150, me.y] });
    const hurl = async (tag) => {
      const wd = await waitFor((s) => s.wind >= 1, 4000);
      if (!(wd.wind >= wd.go)) { fail(res, `${tag}: the bell wound to ${wd.wind} in 4 s, below the hurl threshold ${wd.go}`); return false; }
      await call(page, 'bellInput', { haul: false });
      const fl = await waitFor((s) => s.s.includes(FLY) || s.s.includes(ANCHOR), 500);
      if (!fl.s.includes(FLY) && !fl.s.includes(ANCHOR)) { fail(res, `${tag}: a release at wind ${wd.wind} did not hurl (states ${fl.s})`); return false; }
      return true;
    };
    if (await hurl('hurl')) {
      await shoot(page, res, 'hurl');
      const an = await waitFor((s) => s.s.includes(ANCHOR), 1500);
      if (bad(an)) worst = an;
      if (!an.s.includes(ANCHOR)) fail(res, 'the hurled bell never lay anchored (states ' + an.s + ')');
      else {
        await shoot(page, res, 'anchor');
        await call(page, 'bellInput', { haul: true }); await wait(50); await call(page, 'bellInput', { haul: false });
        const rl = await waitFor((s) => s.s.includes(REEL) || s.s.every((x) => x === HAND), 400);
        if (!rl.s.includes(REEL) && !rl.s.every((x) => x === HAND)) fail(res, 'a tap did not reel the anchored bell (states ' + rl.s + ')');
        else if (rl.s.includes(REEL)) await shoot(page, res, 'reel');
        const hm = await waitFor((s) => s.s.every((x) => x === HAND), 2000);
        if (!hm.s.every((x) => x === HAND)) fail(res, 'the reeled bell never came home (states ' + hm.s + ')');
      }
    }
    // Anchor Leap to an anchored bell, then a Peal at full wind
    await waitFor((s) => s.charges > 0, 7000);
    await call(page, 'bellInput', { haul: true });
    if (await hurl('leap')) {
      await waitFor((s) => s.s.includes(ANCHOR), 1500);
      await call(page, 'bellInput', { key: 'KeyQ' });
      const lp = await waitFor((s) => s.leap, 500);
      await shoot(page, res, 'leap');
      if (!lp.leap) notes(res, 'leap shot: the hero was not in an Anchor Leap (states ' + lp.s + ')');
    }
    const fin = await waitFor((s) => s.cd2 <= 0 && !s.leap, 12000);
    if (bad(fin)) worst = fin;
    if (worst) fail(res, 'a bell left its chain or went non-finite: ' + JSON.stringify(worst));
    await call(page, 'bellInput', { haul: true });
    await wait(1600);
    await call(page, 'bellInput', { key: 'KeyE' });
    await wait(90);
    await shoot(page, res, 'peal');
    await call(page, 'bellInput', { haul: false });
    // four Bellwardens winding in the crowd, High then Low quality
    notes(res, 'party weapons: ' + (await call(page, 'bellParty', ['greatbell', 'handbells', 'chimes'])).join(', '));
    await call(page, 'bellInput', { haul: true });
    await wait(1500);
    await shoot(page, res, 'party4');
    await call(page, 'settings', 'low');
    await wait(900);
    await shoot(page, res, 'party4-low');
    await call(page, 'settings', q);
    await call(page, 'bellInput', { haul: false });
    await call(page, 'stage', 0);
    const ev = await call(page, 'bellCount');
    notes(res, 'events: ' + ['bstrike', 'hurl', 'reel', 'chain', 'peal', 'skill.heave', 'skill.peal', 'deflect', 'hit'].map(k => k + ' ' + (ev[k] | 0)).join(', '));
    for (const k of ['bstrike', 'hurl', 'reel', 'peal', 'skill.heave', 'skill.peal']) if (!ev[k]) fail(res, 'no ' + k + ' event');
    // two peers in one page: open floor (prediction alone), then a ring of foes (host strikes slow the bell: reconciliation)
    for (const ring of [false, true]) {
      const nt = await call(page, 'bellNet', ring ? 7 : 5, 0.05, ring), tag = ring ? 'foes' : 'open';
      if (ring) await shoot(page, res, 'net-client');
      await call(page, 'bellNetEnd');
      notes(res, `net v${nt.version} ${tag}: ${nt.steps} host steps, ${nt.snaps} snapshots, ${nt.sent} inputs; client corrections after 1 s ${nt.rn}, phase error mean ${nt.err} rad (signed ${nt.bias}), phase snaps ${nt.snapsToHost}, state snaps ${nt.stateSnaps}; own hand bell max ${nt.far} px (chain ${nt.chain}); hurls on the host from the client ${nt.hostStrikes}; remote wind seen ${nt.remoteHauled}/${nt.remoteN}`);
      if (!nt.fin || nt.far > nt.chain * 2 + 20) fail(res, tag + ': the client\'s predicted bell is non-finite or off its chain');
      if (!(nt.rn > 0)) fail(res, tag + ': the client never reconciled its bell against a snapshot');
      else if (nt.err > 0.3 || Math.abs(nt.bias) > (ring ? 0.2 : 0.08)) fail(res, `${tag}: client bell phase error ${nt.err} rad on average (signed ${nt.bias})`); // noise: about one 60 Hz step of orbit; bias: the strikes the client learns of a round trip late (foes)
      if (nt.snapsToHost > 1) fail(res, tag + ': the client snapped its hand bell to the host ' + nt.snapsToHost + ' times');
      if (!nt.remoteHauled || nt.remoteBad) fail(res, `${tag}: remote bells: wind seen ${nt.remoteHauled}, ${nt.remoteBad} off their chain`);
      if (ring && !nt.hostStrikes) fail(res, 'the client\'s release never hurled on the host');
    }
  } finally { res.errors = errors; o.cls = cls0; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Wardrobe cosmetics in play: Hearthsitter counts on the Hearth section only; every item owned; the Wardrobe preview per hovered item (a non-blank canvas, its loop stops when the pane hides);
// the camp with the Blue Hearth and its ghost; a 4-hero party (Knight, Ranger, Pyromancer, Bellwarden), each in a different set, in a staged fight at High and Low quality (pets, coin trails, titles,
// crowns, sheens, auras, skins), Last Embers on a fallen hero, the in-run secret toast; frame ms of the party with and without the sets.
async function scenCosmetics() {
  const o = S.opt, res = newResult('cosmetics');
  const { ctx, page, errors } = await openPage();
  const tryShot = async (name, fn, settle) => { try { if (fn) await fn(); await wait(settle == null ? 450 : settle); await shoot(page, res, name); } catch (e) { notes(res, 'shot ' + name + ' skipped: ' + String(e.message).split('\n')[0]); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(() => { const A = window.__ED.App; A.settings.frameCap = 'off'; A.settings.quality = 'high'; A.applySettings(); });
    await call(page, 'profile', 'knight', 2000, '');
    // Hearthsitter: 3 s from the line on the title screen grants nothing; on the Hearth section it does (no input reaches the headless page)
    const still = await ev(async () => {
      const E = window.__ED, A = E.App, sl = (n) => new Promise(r => setTimeout(r, n)), has = () => E.secretHas(A.profile, 'hearthsitter');
      A.goHome(); A.stillT = 177; await sl(3500); const title = has(), tT = A.stillT;
      A.enterHearth('descend'); A.stillT = 177; await sl(3500); const desc = has();
      A.enterHearth('upgrades'); A.stillT = 177; await sl(3500); const hearth = has();
      return { title, tT, desc, hearth };
    });
    if (still.title || still.desc || !still.hearth) fail(res, 'Hearthsitter must count on the Hearth section only: ' + JSON.stringify(still));
    // every Wardrobe item owned
    await ev(() => {
      const E = window.__ED, p = E.App.profile;
      for (const s of E.SECRETS) E.Save.grantSecret(p, s.id);
      p.mastery = p.mastery.map(() => E.MASTERY_XP[E.MASTERY_XP.length - 1]);
      for (const c of E.CLASS_IDS) for (const w of E.CLASSES[c].weapons) p.evo[w] = 3;
      p.cos = E.COSMETICS.filter(c => c.gate.cost).map(c => c.id);
      p.bellUnlocked = true;
      E.App.persist();
    });
    // Wardrobe preview: hover items of each slot; the preview canvas draws the hovered set
    await ev(() => window.__ED.App.enterHearth('wardrobe'));
    const hov = async (fk, name) => { // the preview element alone, after 0.5 s of its animation
      try {
        await ev((k) => { const b = [...document.querySelectorAll('#wardrobe-view .wd-item')].find(x => x.dataset.fk === k); if (!b) throw new Error('no chip ' + k); b.dispatchEvent(new MouseEvent('mouseenter')); document.querySelector('#wardrobe-view .wd-port').scrollIntoView({ block: 'center' }); }, fk);
        await wait(500);
        const file = path.join(o.outdir, [res.name, tag(), o.cls, name].join('-') + '.png');
        await page.locator('#wardrobe-view .wd-port').screenshot({ path: file }); res.shots.push(file);
      } catch (e) { notes(res, 'shot ' + name + ' skipped: ' + String(e.message).split('\n')[0]); }
      return ev(() => { const cv = document.querySelector('#wardrobe-view .wd-prev'); if (!cv) return -1; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
    };
    for (const [fk, nm] of [['w:skin:skin.knight.b', 'c01-preview-skin'], ['w:hat:hat.crown', 'c02-preview-crown'], ['w:pet:pet.platino', 'c03-preview-pet'], ['w:trail:trail.coins', 'c04-preview-trail'],
      ['w:death:death.embers', 'c05-preview-embers'], ['w:title:title.contrarian', 'c06-preview-title'], ['w:tint:tint.longsword', 'c07-preview-tint'], ['w:camp:camp.bluehearth', 'c08-preview-bluehearth'], ['w:aura:aura.gilded', 'c09-preview-gilded']]) {
      const n = await hov(fk, nm);
      if (n <= 50) fail(res, `preview of ${fk} is blank (${n} opaque samples)`);
    }
    const cap = await ev(() => { const b = [...document.querySelectorAll('#wardrobe-view .wd-item')].find(x => x.dataset.fk === 'w:title:title.many'); b.dispatchEvent(new MouseEvent('mouseenter')); const c = document.querySelector('#wardrobe-view .wd-cap'); return c ? c.textContent : ''; });
    if (cap !== 'Tester, One of Many') fail(res, 'preview title caption: ' + JSON.stringify(cap));
    const petPng = await ev(() => { // review sheet at 4 canvas px per world px: the two source frames, the two pet frames (0.6 box-shrink), a pet frame in the silver 'general' ramp
      const E = window.__ED, A = E.Atlas, id = E.Sprites.fitAnim('cos.platino', 0.6), cv = document.createElement('canvas'), c = cv.getContext('2d'); cv.width = 320; cv.height = 150; c.fillStyle = '#5a5a64'; c.fillRect(0, 0, 320, 150); c.imageSmoothingEnabled = false;
      cv.width = 640; c.fillRect(0, 0, 640, 150); c.imageSmoothingEnabled = false;
      c.setTransform(4, 0, 0, 4, 0, 0); A.draw(c, 'cos.platino', 0, 20, 36, {}); A.draw(c, 'cos.platino', 1, 56, 36, {}); A.draw(c, id, 0, 90, 36, {}); A.draw(c, id, 1, 114, 36, {});
      A.draw(c, id, 0, 138, 36, { variant: E.Pix.variant(id, 'general') });
      return { id, url: cv.toDataURL('image/png') };
    });
    { const file = path.join(o.outdir, [res.name, tag(), o.cls, 'c00-pet-frames'].join('-') + '.png'); fs.writeFileSync(file, Buffer.from(petPng.url.split(',')[1], 'base64')); res.shots.push(file); notes(res, 'pet look ' + petPng.id); }
    const loop = await ev(async () => { const E = window.__ED, sl = (n) => new Promise(r => setTimeout(r, n)); const on = E.Cos.previewOn(); E.App.enterHearth('upgrades'); await sl(200); const off = E.Cos.previewOn(); return { on, off }; });
    if (!loop.on || loop.off) fail(res, 'the preview loop must run on the Wardrobe and stop once it hides: ' + JSON.stringify(loop));
    // the worn sets: one per hero, all different; the Blue Hearth at the camp
    await ev(() => {
      const E = window.__ED, p = E.App.profile, S = E.Save;
      const set = (c, o) => { for (const k of Object.keys(o)) { if (k === 'tints') for (const w of o.tints) S.wear(p, c, 'tint', 'tint.' + w, true); else S.wear(p, c, k, o[k]); } };
      set('knight', { skin: 'skin.knight.a', hat: 'hat.crown', aura: 'aura.gilded', trail: 'trail.coins', title: 'title.contrarian', tints: [E.CLASSES.knight.weapons[0]] });
      set('ranger', { skin: 'skin.ranger.secret', pet: 'pet.platino', death: 'death.embers', title: 'title.many', aura: null });
      set('pyro', { skin: 'skin.unkindled', hat: 'hat.crown', trail: 'trail.coins', aura: null, tints: [E.CLASSES.pyro.weapons[0]] });
      if (E.CLASSES.bell) set('bell', { skin: 'skin.bell.b', pet: 'pet.platino', aura: 'aura.gilded', title: 'title.contrarian', tints: [E.CLASSES.bell.weapons[0]] });
      S.wear(p, null, 'camp', 'camp.bluehearth');
      E.App.persist();
    });
    await tryShot('c10-camp-bluehearth', () => ev(() => window.__ED.App.goHome()), 900);
    await tryShot('c11-hearth-bluehearth', () => ev(() => window.__ED.App.enterHearth('upgrades')), 700);
    // a 4-hero party in a staged fight
    await call(page, 'install');
    const party = await ev(() => {
      const E = window.__ED, A = E.App, p = A.profile, ids = ['knight', 'ranger', 'pyro', E.CLASSES.bell ? 'bell' : 'shade'];
      const players = ids.map((c, i) => ({ pid: i ? 'q' + i : 'solo', name: ['Tester', 'Mira', 'Oskar', 'Wren'][i], slot: i, cls: c, weapon: E.CLASSES[c].weapons[0], meta: E.Save.metaBundle(p, c), wear: E.Save.wearBundle(p, c) }));
      A.beginRun('solo', { localPid: 'solo', seed: 7, pact: 0, tutorial: false, players });
      return players.map(q => q.cls + ':' + Object.values(q.wear).filter(v => v && (!Array.isArray(v) || v.length)).length);
    });
    notes(res, 'party sets (items worn): ' + party.join(' '));
    await wait(1200);
    await call(page, 'stage', 24, 1);
    await call(page, 'drive', true, false);
    // the other heroes walk circles around the local one (their pets follow, their trails drop coins)
    await ev(() => { const E = window.__ED; window.__cosWalk = setInterval(() => { const s = E.Game.s; if (!s || !s.world) return; const me = s.me, t = performance.now() / 1000; let i = 0; for (const p of s.world.players.values()) { if (p === me || p.dead) continue; i++; const a = t * 1.3 + i * 2.1; p.x = me.x + Math.cos(a) * 70; p.y = me.y + Math.sin(a) * 45; p.face = a + Math.PI / 2; p.moving = true; } }, 16); });
    await tryShot('c12-party-fight-high', null, 3000);
    const chk = await ev(() => { const E = window.__ED, s = E.Game.s; return { players: s.view.players.size, worn: [...s.view.players.values()].map(p => p.cls + ':' + (p.wear ? (p.wear.skin || '-') : 'none')) }; });
    notes(res, 'in run: ' + chk.worn.join(' '));
    if (chk.worn.some(w => /none$/.test(w))) fail(res, 'a hero runs without its set: ' + chk.worn.join(' '));
    // Last Embers: the Ranger falls
    const emb0 = await ev(() => window.__ED.FX.sheets.filter(q => q.id === 'fx.ember').length);
    await tryShot('c13-last-embers', () => ev(() => { const s = window.__ED.Game.s, p = s.world.players.get('q1'); p.hp = 0; p.dead = true; }), 280);
    const emb1 = await ev(() => window.__ED.FX.sheets.filter(q => q.id === 'fx.ember').length);
    if (emb1 - emb0 < 3) fail(res, `Last Embers: the fallen Ranger scattered ${emb1 - emb0} ember sprites`);
    // the in-run secret toast (a world field: everyone's)
    const toast = await ev(async () => { const E = window.__ED; E.Game.localEvent({ t: 'secret', pid: null }); E.Game.localEvent({ t: 'secret', pid: 'q2' }); await new Promise(r => setTimeout(r, 120)); return [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent); });
    if (toast.filter(x => x === 'Secret found').length !== 1) fail(res, 'secret toasts (one for the party, none for another hero): ' + JSON.stringify(toast));
    await tryShot('c14-secret-toast', null, 200);
    // frame ms with and without the sets (High)
    const cost = await ev(async () => {
      const E = window.__ED, s = E.Game.s, keep = new Map();
      const m1 = await window.__BR.measure(3000);
      for (const p of s.world.players.values()) { keep.set(p.pid, p.wear); p.wear = null; }
      const m0 = await window.__BR.measure(3000);
      for (const p of s.world.players.values()) p.wear = keep.get(p.pid);
      return { on: m1.render, off: m0.render };
    });
    res.rows.push({ quality: 'high', sets: 'on', ms: cost.on }, { quality: 'high', sets: 'off', ms: cost.off });
    notes(res, `Game.render ms p50/p95 with sets ${cost.on && cost.on.p50}/${cost.on && cost.on.p95}, without ${cost.off && cost.off.p50}/${cost.off && cost.off.p95}`);
    await ev(() => { const A = window.__ED.App; A.settings.quality = 'low'; A.applySettings(); });
    await tryShot('c15-party-fight-low', null, 2500);
    const costLow = await ev(async () => (await window.__BR.measure(3000)).render);
    notes(res, `Low quality Game.render ms p50/p95 with sets ${costLow && costLow.p50}/${costLow && costLow.p95}`);
    await ev(() => { clearInterval(window.__cosWalk); });
    await call(page, 'drive', false, false);
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  if (res.shots.length < 12) fail(res, 'only ' + res.shots.length + ' screenshots were taken');
  return res;
}

// ---------------- output ----------------
const f1 =(v) => (typeof v === 'number' ? v.toFixed(1) : '-');
const tri = (s) => (s ? [s.p50, s.p95, s.max].map(f1).join('/') : '-');
const pad = (s, n) => String(s).padEnd(n);
function table(results) {
  const out = [];
  for (const r of results) {
    out.push(`${r.name} [${r.browser}${r.name === 'shots' || r.name === 'screens' || r.name === 'wardrobe' ? '' : ', ' + r.cls}] ${r.ok ? 'PASS' : 'FAIL'}  ${(r.wallMs / 1000).toFixed(1)} s`);
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
      try { r = sc === 'smoke' ? await scenSmoke() : sc === 'boss' ? await scenBoss() : sc === 'shots' ? await scenShots() : sc === 'sheet' ? await scenSheet() : sc === 'screens' ? await scenScreens() : sc === 'wardrobe' ? await scenWardrobe() : sc === 'cosmetics' ? await scenCosmetics() : sc === 'swing' ? await scenSwing() : sc === 'picks' ? await scenPicks() : sc === 'cards' ? await scenCards() : sc === 'bell' ? await scenBell() : sc === 'arenas' ? await scenArenas() : sc === 'verbs' ? await scenVerbs() : await scenCrowd(sc); } catch (e) { if (e instanceof Fail) throw e; r = newResult(sc); r.ok = false; r.notes.push('FAIL: harness error: ' + String(e && e.message || e).split(/\r?\n/)[0]); r.stack = String(e && e.stack || e); }
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
