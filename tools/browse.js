// Headless browser harness: boots the static game in an invisible Playwright browser and runs scripted scenarios against it. Never opens a visible window.
// Usage: node tools/browse.js [smoke|shots|forms|crowdN|coop|botwatch|lap|ko ...] [--scen=a,b] [--cls=knight,...] [--form=id,...] [--support=id,...|all] [--seconds=N] [--browser=chromium|firefox] [--viewport=1920x1080] [--outdir=DIR] [--seed=1] [--lang=en|ko]
//                             [--software] [--quality=auto|high|low] [--gate] [--prof] [--ff=480] [--timeout=600] [--cos=id,...] [--mobile] [--cpu=N]
//   --mobile (chromium): a landscape phone, device emulation at --viewport (default 844x390) x dpr 3, touch, mobile UA. smoke and shots switch to their phone versions (below);
//          crowdN / late run as usual on the phone. --cpu=N: CDP CPU slowdown of every page from boot (default 4 for crowdN / late with --mobile, else 1).
//   smoke --mobile: title -> hero select -> stage select -> run by taps; a raw touch drag on #tc-stick must move the hero right and stop on release; #tc-dash / #tc-q taps
//          must fire a dash / Q; a level-up card tap must pick; #tc-pause must open the pause overlay; ED.Input.device 'touch', #touch shown, #ov-rotate hidden.
//   shots --mobile: PNGs of title, hero select, stage select, a run at --ff s with the stick held, 4 level-up cards, pause and results into <outdir>/mobile-<stamp>-<WxH>.
//   portrait (implies --mobile): a 390x844 phone; fails unless #ov-rotate shows in a run (title noted).
//   cards (implies --mobile): level-up overlay with 4 cards (and reroll / skip) at --viewport, 740x360 and 667x375; fails on a card or foot button not fully inside the viewport
//          or card name / text below 20 px.
//   --cos: cosmetic ids (src/data/cosmetics.js) the profile owns and wears in every solo run the harness starts (skins apply to their own hero).
//   --lang: display language set right after boot on every page (ED.I18N.set), e.g. sanctum --lang=ko for the Korean banners.
//   smoke: for each hero (--cls, default all 7) a solo stage-1 run driven ~--seconds (16) s (circling, aim at the nearest foe, Q / E, dash, first card picked); fails on a page or console error,
//          a stalled sim, no Q or E cast, or a signature weapon that dealt nothing.
//   shots: PNGs of title, hero select, stage select, camp, the slot lifecycle on a fresh knight run (a level-up with a tune card, an elite-chest path-pick offer, a boss-chest
//          Form offer, the pause build line), each hero mid-fight at --ff (480) s of sim (ED.Debug.fastForward, god cheat), a level-up overlay, a chest, a boss fight and the
//          results screen, into a fresh folder <outdir>/shots-<stamp> (printed).
//   crowdN: a knight run (god cheat) held at N live foes; after 2 s of warm-up measures --seconds (6) s, p50 / p95 / max: frame time (rAF interval; the browser runs uncapped,
//          no vsync, when a crowd scenario is requested), main-thread work (all rAF callbacks of a frame), sim ms per 60 Hz tick and Render.frame ms.
//          --software launches without the GPU (software GL: the Canvas2D fallback path). --gate fails crowd900 when GPU-path frame p95 > 8 ms (ARCHITECTURE §11; report-only by default).
//   late[a|b|c]: staged late game for the render budget: a hero with its Form (tune 5, its path at rank 5) refined (set a: knight whirlwind, b: ranger hail, c: pyro inferno),
//          six max passives, clock 25:00, the stage boss and 900 last-roster foes held at real HP
//          (about 1,000 kills/s); measures like crowdN plus own-zone count / coverage. --gate fails when Render.frame p95 > 4 ms on WebGL or > 8 ms on Canvas2D (GAME-DESIGN §13).
//          --support=id,id: the first two named supports join as Forms (tune 5, path 0 at rank 5). --prof (crowdN / late, chromium): a CPU profile over the measured window,
//          the top 15 functions by self time and the top 10 allocation sites (sampled heap, collected objects included) in the notes.
//   forms: one PNG per hero (--cls) x Form (--form=id,... filters): tune 5, the Form's path at rank 5, the Form refined twice, six max passives, clock 20:00, 400 last-roster foes held at
//          real HP, no boss, no level-ups or offers, --seconds (4) s of play; into a fresh folder <outdir>/forms-<stamp>-<browser>[-soft] (printed). Fails on a page / console error or a Form not taken.
//          --support=id,... (support root or Form id; all: every support root): one PNG per hero Form x support, the support's Form (a root: its first Form) beside the hero's.
//   lap: a knight run (god cheat) with a horde at 19:50, the final boss downed (ED.Debug.lap): PNGs of the VICTORY beat, the Last Light lap ~6 s in (HUD countdown, lap gold) and the results;
//        fails on a page / console error, no lap state or no results screen after the lap.
//   sanctum: a knight run (god cheat) on the Wickdeep (stage 4) at 19:55: PNGs of the entry fade (THE SANCTUM banner), the room ~1.5 s after the teleport and ~5 s into the fight (hero moved to the top-left corner),
//        the Sanctum boss downed (VICTORY), then the results; fails on a page / console error, a missing room, a hero outside it or no win.
//   results: the results screen from synthetic summaries (solo victory with the Last Light lap, 4-hero co-op victory, solo loss) at --viewport; fails on page scroll,
//            Enter inside the input guard leaving the screen, a wrong default focus after it, text below 16 px or a page / console error.
//   coop: two pages of one browser context on ?net=local (BroadcastChannel transport): host + guest through the ED.Net lobby API (host, join, ready, start), then the real co-op
//         run on both peers for --seconds (6) s: the guest's mirror shows 2 heroes and foes, snapshots <= 12 KB.
//   botwatch: ?bot=1&speed=8&seed=--seed with the real tools/bot-brain.js; a knight solo run on stage 0 watched --seconds (20) s: fails on sim time < 3x real time (notes < 6x),
//         a hero that never left a 40 px radius, no automatic level-up pick, no BOT tag, [ / ] not changing the speed, Esc not pausing, a missing file or a page / console error.
//   ko: the UI in Korean (ED.I18N.set('ko')): title, hero select, stage select, camp, wardrobe, achievements, each encyclopedia tab (as met on a fresh profile, then with every entry
//       discovered: each entry's detail audited, one PNG per tab), settings, credits, a knight run (HUD, level-up overlay, chest, pause) and the results; one PNG each into a fresh
//       folder <outdir>/ko-<stamp>-<browser>. Fails on a page / console error, an English source that missed the Korean table (ED.I18N.missing, letterless templates aside), a visible text node with a Latin word of
//       3+ letters (allowlist KO_ALLOW, the player name, anything under [lang="en"] or [translate="no"]) or a box whose text overflows it (scrollWidth > clientWidth); the full list goes to
//       the result JSON (results[].audit).
//   bossart: PNGs of the Wickmother in a stand-in Sanctum (w.sanctum at the hero, foes and spawner off, god cheat; P1 idle and an attack, a kneel, P2 with two sconces lit, P3 mid-burn)
//            and of the Wick-Eater (idle, maw open); fails on a page / console error or a boss that did not spawn. A viewport of 1280x960 shows the whole 720 x 480 room.
// In-page debug API (injected only by this harness, absent in normal play; every call is a no-op without a solo / host run): ED.Debug.{fastForward(sec), give(id, lvl), evolve(wid?),
//   spawnBoss(id?), setTime(sec), levelUp(n), chest(), win() (the run ends won now), lap() (the final boss down now: the Last Light), lose(), god(on), state()}.
// Mechanism: a read-only http server on 127.0.0.1 (random port) serves the repo; Playwright resolves via require('playwright'), else the npx cache (%LOCALAPPDATA%\npm-cache\_npx).
//   The page runs with a seeded Math.random. Output: a table on stdout, PNGs and result-<browser>.json in --outdir (default <tmp>/wickdeep-browse). Exit 0 pass, 1 scenario failure, 2 harness error.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

// ---------------- arguments ----------------
const FLAGS = { scen: 's', cls: 's', form: 's', support: 's', cos: 's', browser: 's', viewport: 's', outdir: 's', root: 's', quality: 's', lang: 's', seconds: 'n', seed: 'n', timeout: 'n', ff: 'n', cpu: 'n', software: 'b', gate: 'b', prof: 'b', json: 'b', help: 'b', mobile: 'b' };
class Fail extends Error { constructor(msg, code) { super(msg); this.code = code || 2; } }
const HEROES = ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell'];
const SCEN_RE = /^(smoke|shots|coop|botwatch|lap|sanctum|bossart|results|ko|crowd\d{1,4}|late[abc]?|forms|portrait|cards)$/;
// --mobile: a landscape phone (Chromium device emulation); the UA is a stock Android Chrome string.
const PHONE = { dpr: 3, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36' };
// Latin words allowed on Korean screens: the game name, stat abbreviations, key and button names.
const KO_ALLOW = ['Wickdeep', 'HP', 'DPS', 'XP', 'Esc', 'Enter', 'Space', 'Shift', 'Tab', 'Ctrl', 'Alt', 'LMB', 'RMB', 'MMB', 'Mouse', 'Up', 'Down', 'Left', 'Right', 'Arrow', 'Backspace', 'English'];
function parseArgs(argv) {
  const o = { scen: '', cls: HEROES.join(','), form: '', support: '', cos: '', browser: 'chromium', viewport: '', outdir: path.join(os.tmpdir(), 'wickdeep-browse'), root: path.resolve(__dirname, '..'), quality: 'high', seconds: 0, seed: 1, timeout: 600, ff: 480 };
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
  for (const s of o.scens) if (!SCEN_RE.test(s)) throw new Fail('unknown scenario ' + s + ' (smoke, shots, forms, crowdN, late[a|b|c], coop, botwatch, lap, sanctum, results, ko, bossart, portrait, cards)');
  if (!['chromium', 'firefox'].includes(o.browser)) throw new Fail('--browser is chromium or firefox');
  if (o.scens.some(s => s === 'portrait' || s === 'cards')) o.mobile = true;
  if ((o.mobile || o.cpu) && o.browser !== 'chromium') throw new Fail('--mobile / --cpu need chromium (device emulation, CDP)');
  if (o.cpu !== undefined && !(o.cpu >= 1)) throw new Fail('--cpu is a slowdown factor >= 1');
  o.viewport = o.viewport || (o.mobile ? '844x390' : '1920x1080');
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
  const BAD = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]); // Chromium's restricted ports (ERR_UNSAFE_PORT): re-picked
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    const pick = () => srv.listen(0, '127.0.0.1', () => { const port = srv.address().port; if (BAD.has(port)) srv.close(pick); else resolve({ srv, base: 'http://127.0.0.1:' + port, missing }); });
    pick();
  });
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
    // Scripted hero for fastForward: circles, aims at the nearest foe in view (else ahead of the walk), Q every 7 s, E every 11 s, dash every 5 s, picks the first card,
    // walks to a chest on the ground.
    const drive = (w, p, tick) => {
      let mx, my;
      let ch = null, bd = Infinity;
      for (const g of w.pickups) if (!g.dead && g.k === 'chest') { const d = (g.x - p.x) ** 2 + (g.y - p.y) ** 2; if (d < bd) { bd = d; ch = g; } }
      if (ch && bd < 700 * 700) { const d = Math.sqrt(bd) || 1; mx = (ch.x - p.x) / d; my = (ch.y - p.y) / d; }
      else { const a = tick / 60 * 0.7 + p.slot * 1.6; mx = Math.cos(a); my = Math.sin(a); }
      let t = null, td = Infinity;
      for (const e of w.foes) if (!e.dead && E.inView(p, e.x, e.y, 0)) { const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < td) { td = d; t = e; } }
      w.input(p.pid, { mx, my, ax: t ? t.x : p.x + mx * 80, ay: t ? t.y : p.y + my * 80, q: tick % 420 === 30, e: tick % 660 === 60, dash: tick % 300 === 90, pick: p.offer ? 1 : 0 });
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
    // Gives weapon or passive id to the local hero. Weapon: a hero root replaces the hero weapon, a support root takes a free support slot (else replaces the last support);
    // a root spends lvl - 1 steps (tune first, then the picked path's ranks, else path 0; default all), a Form fills its path, takes it and refines it fully. Passive: level lvl (default max).
    D.give = (id, lvl) => {
      const w = run(); if (!w) return null;
      const p = meOf(w);
      if (E.WEAPONS[id]) {
        const rid = E.weaponRoot(id), d = E.WEAPONS[id];
        let ws = p.weapons.find(x => x.root === rid);
        if (!ws && E.WEAPONS[rid].support) {
          const sup = p.weapons.filter(x => E.WEAPONS[x.root].support);
          if (sup.length >= E.MAX_WEAPONS - 1) p.weapons.splice(p.weapons.indexOf(sup[sup.length - 1]), 1);
          ws = w.addWeapon(p, rid);
        } else if (!ws) { const sup = p.weapons.splice(0).filter(x => E.WEAPONS[x.root].support); ws = w.addWeapon(p, rid); p.weapons.push(...sup); }
        if (!ws) return null;
        if (d.form) {
          const f = E.weaponForms(rid).find(x => x.id === id);
          if (f && !ws.evo) w.setForm(p, ws, id, 0);
          while (w.refineForm(p, ws));
        } else if (!ws.evo) {
          const want = Math.max(0, Math.min(E.TUNE_MAX + E.PATH_MAX, (lvl || 99) - 1)); // tune steps first, then path ranks (the picked path, else path 0)
          w.setRanks(p, ws, Math.min(want, E.TUNE_MAX), want > E.TUNE_MAX ? (ws.path >= 0 ? ws.path : 0) : -1, want - E.TUNE_MAX);
        }
      } else if (E.PASSIVES[id]) {
        let ps = p.passives.find(x => x.id === id);
        if (!ps) { if (p.passives.length >= E.MAX_PASSIVES) p.passives.pop(); ps = { id, lvl: 1 }; p.passives.push(ps); }
        ps.lvl = Math.max(1, Math.min(E.PASSIVES[id].max, lvl || 99));
      } else return null;
      w.recalc(p, false);
      return D.state();
    };
    // Takes Form fid (default: the hero weapon's first Form) on the local hero: tune full, its path to rank 5, then swaps to it. Returns the weapon id now held or null.
    D.evolve = (fid) => {
      const w = run(); if (!w) return null;
      const p = meOf(w), ws = p.weapons[0];
      if (!ws) return null;
      const f = E.weaponForms(ws.root).find(x => !fid || x.id === fid);
      if (!f) return null;
      if (!ws.evo) w.setForm(p, ws, f.id, 0);
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
    // Jumps the run clock to sec; flock / swarm / elite / boss timers skip what that time already passed.
    D.setTime = (sec) => {
      const w = run(); if (!w) return null;
      const sd = w.sdef, sp = w.sp || {}, sw = sd.events && sd.events.swarm, fl = sd.events && sd.events.flock, el = sd.elites;
      w.time = Math.max(0, +sec || 0);
      if (sw && typeof sp.swarmT === 'number') { sp.swarmT = sw.first; while (sp.swarmT <= w.time) sp.swarmT += sw.every; }
      if (fl && typeof sp.flockT === 'number') { sp.flockT = fl.first; while (sp.flockT <= w.time) sp.flockT += fl.every; }
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
    D.win = () => { const w = run(); if (!w) return false; w.end(true); return true; };
    // Final boss down now (the Last Light: victory beat, calm, lap) 120 px right of the local hero; the run clock jumps to 20:00 first when earlier.
    D.lap = () => { const w = run(); if (!w) return false; if (w.time < 1200) D.setTime(1200); const p = meOf(w); w.payGold(E.CONST.GOLD.final); w.startLap(p.x + 120, p.y); return true; };
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
          if (!BR.still && me && t % 4 < 1.5) { // every 4 s, 1.5 s walking at the nearest foe (melee closes in)
            let best = null, bd = 1e12; for (const f of E.Game.view.foes) { if (f.dead) continue; const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2; if (d < bd) { bd = d; best = f; } }
            if (best) { const l = Math.sqrt(bd) || 1; o.mx = (best.x - me.x) / l; o.my = (best.y - me.y) / l; }
          }
          o.q = Math.random() < 0.02; o.dash = Math.random() < 0.01;
          o.pick = BR.autoPick && me && me.offer ? 1 : 0;
          return o;
        };
        // scripted aim: the nearest foe in view (else ahead of the walk) while BR.drive is on
        const AF = E.AimFx, point = AF.point;
        AF.point = (me, inp) => {
          if (!BR.drive) return point(me, inp);
          const V = E.Game.view; let best = null, bd = 1e12;
          if (V) for (const f of V.foes) { if (f.dead) continue; const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2; if (d < bd) { bd = d; best = f; } }
          if (best) { AF.wx = best.x; AF.wy = best.y; } else { AF.wx = me.x + inp.mx * 80; AF.wy = me.y + inp.my * 80; }
          return AF;
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
    if (cfg.cos) { const p = E.App.profile; for (const id of cfg.cos.split(',')) if (E.COS_BY[id] && p.cos.indexOf(id) < 0) p.cos.push(id); for (const id of cfg.cos.split(',')) E.Save.wear(p, id); }
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
  // Korean audit of the visible DOM UI: text nodes with a Latin word (3+ letters) not in allow, and boxes whose text overflows them (scrollWidth > clientWidth).
  BR.audit = (allow) => {
    const ok = new Set(allow), latin = [], over = [], seen = new Set();
    const tag = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const tw = document.createTreeWalker(document.getElementById('ui'), NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim(), el = n.parentElement;
      if (!t || !el || !shown(el) || el.closest('[lang="en"], [translate="no"], script, style')) continue;
      const bad = (t.match(/[A-Za-z]{3,}/g) || []).filter(wd => !ok.has(wd));
      if (bad.length) latin.push({ el: tag(el), words: [...new Set(bad)].join(' '), text: t.slice(0, 80) });
      let box = el; while (box && box.clientWidth === 0) box = box.parentElement;
      if (box && !seen.has(box)) {
        seen.add(box);
        if (box.scrollWidth > box.clientWidth + 1) over.push({ el: tag(box), sw: box.scrollWidth, cw: box.clientWidth, text: box.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) });
      }
    }
    return { latin, over };
  };
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
        const pc = E.Post && E.Post.canvas;
        resolve({ frames: fr.length, frame: st(fr), work: st(wk.slice(1)), tick: st(um.length ? um : [0]), render: st(rm), foes: Math.round(fo.reduce((a, b) => a + b, 0) / fo.length), usePost: E.Render.usePost, soft: !!(E.Post && E.Post.soft), batch: E.Batch ? E.Batch.mode || '?' : 'none', canvas: [E.Render.canvas.width, E.Render.canvas.height, E.Render.bw, E.Render.bh, E.Render.scale],
          dpr: window.devicePixelRatio, post: pc ? [pc.width, pc.height] : null, q: E.Render.quality, auto: E.Render.autoNote || '' });
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
const S = { opt: null, pw: null, browser: null, server: null, closing: false, shotDir: '', cpu: 1 }; // cpu: CDP CPU slowdown of the pages the current scenario opens
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
// vp: { w, h } overrides the viewport (portrait check); with --mobile the context is a touch phone at PHONE.dpr.
async function newContext(vp) {
  const o = S.opt, w = vp ? vp.w : o.vw, h = vp ? vp.h : o.vh;
  const dev = o.mobile ? { deviceScaleFactor: PHONE.dpr, isMobile: true, hasTouch: true, userAgent: PHONE.ua } : { deviceScaleFactor: 1 };
  const ctx = await S.browser.newContext(Object.assign({ viewport: { width: w, height: h }, serviceWorkers: 'block', locale: 'en-US' }, dev));
  await ctx.addInitScript({ content: '(' + pageBoot.toString() + ')(' + JSON.stringify({ seed: o.seed, cos: o.cos }) + ')' });
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
  if (S.cpu > 1) await (await cdpOf(page)).send('Emulation.setCPUThrottlingRate', { rate: S.cpu }); // throttled from boot on (the quality auto-pick runs under it)
  await page.goto(local + '/index.html' + (query || ''), { waitUntil: 'load' });
  const info = await page.evaluate(() => window.__BR.boot());
  if (S.opt.lang) await page.evaluate((l) => window.ED.I18N.set(l), S.opt.lang);
  return { page, info };
}
async function openPage(query) {
  const ctx = await newContext(), errors = [];
  const { page, info } = await bootPage(ctx, query, errors);
  return { ctx, page, errors, info };
}
// One CDP session per page (CPU throttling, raw touch events).
async function cdpOf(page) { if (!page.__cdp) page.__cdp = await page.context().newCDPSession(page); return page.__cdp; }
// Raw touch on page at CSS px (x, y): type touchStart | touchMove | touchEnd (one finger, id 1).
async function touch(page, type, x, y) { await (await cdpOf(page)).send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] }); }
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
  const o = S.opt, res = newResult('smoke'), secs = o.seconds || 16;
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
    // slot lifecycle on a fresh knight run (first card picked; chest popups awaited out so the offer header shows)
    let k = 5;
    const offerShot = async (name, prep, want) => {
      const got = await page.evaluate(prep);
      await page.waitForFunction(() => { const el = document.getElementById('ov-offer'); return el && !el.hidden; }, null, { timeout: 3000 }).catch(() => {});
      await page.waitForFunction(() => document.getElementById('ov-chest').hidden, null, { timeout: 6000 }).catch(() => {});
      await wait(700);
      const title = await page.locator('#offer-title').innerText().catch(() => '');
      need(await call(page, 'visible', 'ov-offer') && want.test(title), name + ': offer "' + title + '" (' + got + ')');
      res.notes.push(name + ': ' + title + ' | ' + got);
      await shot(`${String(k++).padStart(2, '0')}-${name}`);
      await page.evaluate(() => { window.__BR.autoPick = true; }); // scripted input owns the pick key while driving
      await page.waitForFunction(() => document.getElementById('ov-offer').hidden, null, { timeout: 3000 }).catch(() => {});
      await page.evaluate(() => { window.__BR.autoPick = false; });
    };
    await call(page, 'start', 'knight', 0, { god: true });
    await page.evaluate(() => { window.__BR.autoPick = false; window.__BR.still = true; });
    await wait(800);
    await offerShot('levelup-tune', () => { const E = window.ED, w = E.Game.w, p = w.heroes[0]; for (const id of E.WEAPON_IDS) if (E.WEAPONS[id].support && !E.WEAPONS[id].evolved) p.banned.push('w:' + id); w.addXp(w.xpNext - w.xp + 1); return 'supports banned: the level-2 weapon card is a tune card'; }, /^Level \d+!$/);
    await offerShot('path-pick', () => { const w = window.ED.Game.w, p = w.heroes[0]; p.banned.length = 0; w.setRanks(p, p.weapons[0], window.ED.TUNE_MAX); w.openChest(p, 1); return 'tune ' + p.weapons[0].tune; }, /^Choose a path · /);
    await offerShot('form-fork', () => { const w = window.ED.Game.w, p = w.heroes[0], ws = p.weapons[0]; w.setRanks(p, ws, window.ED.TUNE_MAX, ws.path, window.ED.PATH_MAX); w.time = Math.max(w.time, 600); w.openChest(p, 2); return 'path ' + ws.path + ' rank ' + ws.pr[ws.path]; }, /^Choose a Form · /);
    await page.evaluate(() => {
      const E = window.ED, w = E.Game.w, p = w.heroes[0], ws = p.weapons[0], sup = E.WEAPON_IDS.filter(id => E.WEAPONS[id].support && !E.WEAPONS[id].evolved);
      w.refineForm(p, ws);
      const a = w.addWeapon(p, sup[0]), b = w.addWeapon(p, sup[1]);
      if (a) w.setRanks(p, a, E.TUNE_MAX); // path-ready: 'path: pick at a chest'
      if (b) w.setRanks(p, b, 3);
    });
    await page.keyboard.press('Escape');
    await wait(400);
    const lines = await page.locator('#pause-build .pb-line').allInnerTexts().catch(() => []);
    need(await call(page, 'visible', 'ov-pause') && lines.length === 3, 'pause build: ' + lines.length + ' weapon lines');
    res.notes.push('pause build: ' + lines.join(' / '));
    await shot(`${String(k++).padStart(2, '0')}-pause-build`);
    await page.keyboard.press('Escape');
    await call(page, 'stop'); await wait(200);
    // heroes mid-fight; the first hero's run also gives the level-up, chest, boss and results shots
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
      await wait(1700); // input guard and count-up
      await shot(`${String(k++).padStart(2, '0')}-results`);
      await page.click('#btn-res-back').catch(() => {});
    }
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Last Light: VICTORY beat and lap PNGs, then the run's end.
async function scenLap() {
  const o = S.opt, res = newResult('lap');
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info));
    await call(page, 'settings', o.quality);
    await call(page, 'start', 'knight', 0, { god: true, might: 40 });
    await dbg(page, 'setTime', 1190);
    await wait(4000); // the horde at 19:5x
    if (!(await dbg(page, 'lap'))) fail(res, 'lap did not start');
    await wait(500);
    await shoot(page, res, 'victory');
    await wait(8500);
    const st = await page.evaluate(() => { const w = window.ED.Game.w, v = window.ED.Game.view; return { lap: w.lap && Object.assign({}, w.lap), won: w.won, state: w.state, foes: w.foes.length, view: v.lap && Object.assign({}, v.lap) }; });
    res.notes.push('lap: ' + JSON.stringify(st));
    if (!st.lap || !st.won || !st.view || st.view.ph !== 2) fail(res, 'no Last Light lap state');
    await shoot(page, res, 'lastlight');
    await page.evaluate(() => { const w = window.ED.Game.w; w.time = w.lap.t0 + w.lap.dur - 0.5; });
    await page.waitForFunction(() => window.ED.App.state === 'results', null, { timeout: 8000 }).catch(() => {});
    if (!(await call(page, 'visible', 'scr-results'))) fail(res, 'results screen not shown after the lap');
    await shoot(page, res, 'results');
    await call(page, 'stop');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// The Sanctum: entry fade, the room, the fight, the win, the results.
async function scenSanctum() {
  const o = S.opt, res = newResult('sanctum');
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info) + (o.software ? ', launched without GPU' : ''));
    await call(page, 'settings', o.quality);
    await call(page, 'start', 'knight', 3, { god: true, might: 20 });
    await dbg(page, 'setTime', 1196);
    await page.waitForFunction(() => { const w = window.ED.Game.w; return w.sanctum && w.time >= w.sanctum.t0 - 0.8; }, null, { timeout: 20000 }).catch(() => {});
    await shoot(page, res, 'sanctum-enter' + (o.software ? '-soft' : ''));
    await page.waitForFunction(() => { const w = window.ED.Game.w; return w.sanctum && w.sanctum.st === 1 && w.time >= w.sanctum.t0 + 1.5; }, null, { timeout: 20000 }).catch(() => {});
    const st = await page.evaluate(() => {
      const w = window.ED.Game.w, R = w.arena.room, v = window.ED.Game.view;
      return { st: w.sanctum && w.sanctum.st, room: !!R && !!v.props.room, foes: w.foes.filter(e => !e.dead).length, boss: w.boss ? w.boss.def.id : '',
        inside: !!R && w.heroes.every(p => p.x >= R.x0 && p.x <= R.x1 && p.y >= R.y0 && p.y <= R.y1), cam: [window.ED.Render.camX, window.ED.Render.camY] };
    });
    res.notes.push('sanctum: ' + JSON.stringify(st));
    if (st.st !== 1 || !st.room || !st.boss || !st.inside) fail(res, 'no Sanctum room / boss, or a hero outside it');
    await shoot(page, res, 'sanctum-room' + (o.software ? '-soft' : ''));
    await wait(4000);
    await page.evaluate(() => { const w = window.ED.Game.w, R = w.arena.room, p = w.heroes[0]; p.x = R.x0 + 40; p.y = R.y0 + 60; }); // the wall corner in view
    await wait(1000);
    await shoot(page, res, 'sanctum-fight' + (o.software ? '-soft' : ''));
    const banked = await page.evaluate(() => { const w = window.ED.Game.w, p = w.heroes[0]; for (let k = 0; k < 6 && w.bossList.length; k++) { const e = w.bossList[0]; e.invulnT = 0; w.killFoe(e, w.src(p, p.weapons[0].id, 'x')); } return w.won && w.sanctum.st === 2 && !w.lap; });
    if (!banked) fail(res, 'Sanctum boss death did not bank the win (or started a lap)');
    await wait(900);
    await shoot(page, res, 'sanctum-victory' + (o.software ? '-soft' : ''));
    await page.waitForFunction(() => window.ED.App.state === 'results', null, { timeout: 10000 }).catch(() => {});
    if (!(await call(page, 'visible', 'scr-results'))) fail(res, 'results screen not shown after the Sanctum win');
    await shoot(page, res, 'sanctum-results');
    await call(page, 'stop');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Wickmother phases and the Wick-Eater, staged in the live run (page-side harness: the room at the hero, every foe and the spawner off).
async function scenBossArt() {
  const o = S.opt, res = newResult('bossart');
  const { ctx, page, errors, info } = await openPage();
  const stage = (fn, arg) => page.evaluate(fn, arg);
  try {
    res.notes.push(bootNote(info));
    await call(page, 'settings', o.quality);
    await call(page, 'start', 'knight', 0, { god: true });
    await page.evaluate(() => { window.__BR.still = true; window.__BR.autoPick = true; });
    await wait(600);
    const id = await stage(() => {
      const E = window.ED, w = E.Game.w, p = w.heroes[0];
      w.time = 1200; w.updateSpawner = () => {};
      for (const f of w.foes) w.despawnFoe(f);
      w.sanctum = { st: 1, t0: w.time, x: p.x, y: p.y, w: 720, h: 480 };
      const e = w.spawnBoss({ t: 1200, id: 'wickmother', final: true });
      p.y = w.sanctum.y + 60;
      return e ? e.id : 0;
    });
    if (!id) fail(res, 'Wickmother did not spawn');
    const ph = (k) => stage((k) => { const w = window.ED.Game.w, e = w.boss, v = e && e.vars; if (!v) return null; return { ph: v.phase, dy: Math.round(w.heroes[0].y - e.y), cy: Math.round(e.y - w.sanctum.y), kneel: +v.kneelT.toFixed(1), head: v.head ? v.head.k : '', hands: v.H.map(H => H.a ? H.a.k : H.st), zones: w.zones.filter(z => !z.dead && z.team === 1).map(z => z.k).join(',') }; }, k);
    await wait(3500); await shoot(page, res, 'wm-p1');
    await wait(2500); await shoot(page, res, 'wm-p1-attack');
    res.notes.push('p1 ' + JSON.stringify(await ph()));
    await stage(() => { const w = window.ED.Game.w, v = w.boss.vars; for (const H of v.H) if (H.e && !H.e.dead) w.hitFoe(H.e, 1e8, w.src(null, 'test')); });
    await wait(1500); await shoot(page, res, 'wm-kneel');
    res.notes.push('kneel ' + JSON.stringify(await ph()));
    await stage(() => { const w = window.ED.Game.w, e = w.boss; w.hitFoe(e, (e.hp - e.maxHp * 0.6) / e.takeMul, w.src(null, 'test')); });
    await wait(1500);
    await stage(() => { const v = window.ED.Game.w.boss.vars; v.sc[0].lit = true; v.sc[3].lit = true; v.sc[1].prog = 0.5; });
    await wait(3000); await shoot(page, res, 'wm-p2');
    res.notes.push('p2 ' + JSON.stringify(await ph()));
    await stage(() => { const w = window.ED.Game.w, e = w.boss, v = e.vars; for (const sc of v.sc) sc.lit = true; });
    await wait(400);
    await stage(() => { const w = window.ED.Game.w, e = w.boss; w.hitFoe(e, (e.hp - e.maxHp * 0.3) / e.takeMul, w.src(null, 'test')); });
    await wait(1000);
    await stage(() => { const w = window.ED.Game.w, v = w.boss.vars; v.burn0 = w.time - 60; });
    await wait(3000); await shoot(page, res, 'wm-p3');
    res.notes.push('p3 ' + JSON.stringify(await ph()));
    // the Wick-Eater
    const we = await stage(() => {
      const E = window.ED, w = E.Game.w, p = w.heroes[0], b = w.boss;
      if (b && !b.dead) { w.bossList.length = 0; w.boss = null; for (const f of w.foes) w.despawnFoe(f); }
      for (const z of w.zones) if (z.team === 1) z.dead = true;
      w.sanctum = null;
      const e = w.spawnBoss({ t: 1200, id: 'wickeater', final: true });
      if (e) { e.x = p.x + 110; e.y = p.y - 10; E.Bosses.lib.vars(e).t = 5; }
      return e ? e.id : 0;
    });
    if (!we) fail(res, 'Wick-Eater did not spawn');
    await wait(3200); await shoot(page, res, 'we-idle');
    await stage(() => { const e = window.ED.Game.w.boss; if (e) window.ED.Bosses.lib.force(e, 'devour'); });
    await wait(700); await shoot(page, res, 'we-devour');
    await call(page, 'stop');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// ---------------- phone (--mobile) ----------------
// Taps element #id when it is shown; false when it is missing or hidden.
async function tapId(page, id) { if (!(await call(page, 'visible', id))) return false; await page.tap('#' + id, { timeout: 3000 }); return true; }
const mineOf = (page, k) => page.evaluate((key) => window.__BR.mine[key] || 0, k);
const heroAt = (page) => page.evaluate(() => { const v = window.ED.Game.view, m = v && v.me; return m ? { x: m.x, y: m.y } : null; });
// Title -> hero select -> stage select -> run, all by taps; true once App.state is 'run' (god cheat on, event tallies reset).
async function tapIntoRun(page, need, shot) {
  await page.fill('#inp-name', 'Tester').catch(() => {});
  if (shot) await shot('01-title');
  need(await tapId(page, 'btn-play'), 'title: #btn-play not tappable');
  await wait(300);
  if (shot) await shot('02-hero-select');
  need(await tapId(page, 'btn-hero-next'), 'hero select: #btn-hero-next not tappable');
  await wait(300);
  if (shot) await shot('03-stage-select');
  need(await tapId(page, 'btn-start'), 'stage select: #btn-start not tappable');
  await page.waitForFunction(() => window.ED.App.state === 'run', null, { timeout: 8000 }).catch(() => {});
  const ok = await page.evaluate(() => window.ED.App.state === 'run');
  if (ok) await page.evaluate(() => { window.__BR.ev = {}; window.__BR.mine = {}; window.ED.Debug.god(true); });
  return need(ok, 'no run after the start tap');
}
// Holds the floating stick: a raw touch at 35% / 60% of #tc-stick dragged dx CSS px over 6 moves, held ms, released. Returns the hero's world move { dx, dy } or null without #tc-stick.
async function stickDrag(page, dx, ms) {
  const box = await page.locator('#tc-stick').boundingBox().catch(() => null);
  if (!box) return null;
  const x = box.x + box.width * 0.35, y = box.y + box.height * 0.6, a = await heroAt(page);
  await touch(page, 'touchStart', x, y);
  for (let i = 1; i <= 6; i++) { await touch(page, 'touchMove', x + dx * i / 6, y); await wait(16); }
  await wait(ms);
  const b = await heroAt(page);
  await touch(page, 'touchEnd');
  return a && b ? { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y) } : null;
}
// Level-up overlay up with n cards (pads the sim offer with copies of its last card), pop-in finished. Returns the card count shown.
async function levelUpCards(page, n) {
  await page.evaluate(() => window.ED.Debug.levelUp(1));
  await page.waitForFunction(() => { const el = document.getElementById('ov-offer'); return el && !el.hidden; }, null, { timeout: 3000 }).catch(() => {});
  if (n) await page.evaluate((k) => { const p = window.ED.Game.w.heroes[0]; if (p.offer) while (p.offer.length < k) p.offer.push(Object.assign({}, p.offer[p.offer.length - 1])); }, n);
  await wait(900);
  return page.evaluate(() => document.querySelectorAll('#offer-cards .offer-card').length);
}

// Phone smoke: menus by taps, a stage-1 run steered by a raw touch drag on #tc-stick, #tc-dash / #tc-q taps, a level-up card tapped, #tc-pause; #ov-rotate hidden in landscape.
async function scenMobileSmoke() {
  const o = S.opt, res = newResult('m-smoke');
  const { ctx, page, errors, info } = await openPage();
  const need = (cond, note) => { if (!cond) fail(res, note); return !!cond; };
  try {
    res.notes.push(bootNote(info) + `, ${o.vw}x${o.vh} dpr ${PHONE.dpr}`);
    await call(page, 'settings', o.quality);
    if (!(await tapIntoRun(page, need))) return res;
    await wait(800);
    const dev = await page.evaluate(() => window.ED.Input && window.ED.Input.device), shown = await call(page, 'visible', 'touch');
    res.notes.push(`Input.device ${dev}, #touch ${shown ? 'shown' : 'hidden'}, #ov-rotate ${(await call(page, 'visible', 'ov-rotate')) ? 'SHOWN' : 'hidden'}`);
    need(dev === 'touch', 'ED.Input.device is ' + dev + ' after taps');
    need(shown, '#touch hidden in the run');
    need(!(await call(page, 'visible', 'ov-rotate')), '#ov-rotate shown in landscape');
    const mv = await stickDrag(page, 70, 1200);
    res.notes.push('stick drag +70 px x, 1.2 s: hero moved ' + JSON.stringify(mv));
    if (need(mv, '#tc-stick missing')) need(mv.dx > 15 && mv.dx > Math.abs(mv.dy), 'stick drag right did not move the hero right');
    await wait(300);
    const still = await heroAt(page); await wait(400); const still2 = await heroAt(page);
    need(still && still2 && Math.abs(still2.x - still.x) + Math.abs(still2.y - still.y) < 2, 'hero still moving after the stick was released');
    for (const [id, k] of [['tc-dash', 'dash'], ['tc-q', 'skill0']]) {
      const n0 = await mineOf(page, k), tapped = await tapId(page, id);
      await wait(400);
      const n1 = await mineOf(page, k);
      res.notes.push(`${id}: ${tapped ? 'tapped' : 'MISSING'}, ${k} events ${n0} -> ${n1}`);
      need(tapped && n1 > n0, id + ' tap fired no ' + k);
    }
    const cards = await levelUpCards(page, 0), p0 = await mineOf(page, 'pick');
    if (need(cards > 0, 'level-up overlay shows no cards')) {
      await page.locator('#offer-cards .offer-card').first().tap({ timeout: 3000 });
      await page.waitForFunction(() => document.getElementById('ov-offer').hidden, null, { timeout: 3000 }).catch(() => {});
      const p1 = await mineOf(page, 'pick');
      res.notes.push(`level-up: ${cards} cards, first tapped, pick events ${p0} -> ${p1}`);
      need(p1 > p0 && (await page.evaluate(() => document.getElementById('ov-offer').hidden)), 'card tap did not pick');
    }
    need(await tapId(page, 'tc-pause'), '#tc-pause not tappable');
    await wait(300);
    need(await call(page, 'visible', 'ov-pause'), 'pause overlay not shown after #tc-pause');
    await shoot(page, res, 'm-pause');
    if (await tapId(page, 'btn-resume')) { await wait(300); need(!(await call(page, 'visible', 'ov-pause')), 'Resume tap left the pause overlay up'); }
    await shoot(page, res, 'm-run');
    await call(page, 'stop');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Phone shots: title, hero select, stage select, a run at --ff s (stick held), level-up cards, pause, results into <outdir>/mobile-<stamp>.
async function scenMobileShots() {
  const o = S.opt, res = newResult('m-shots');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = S.shotDir = path.join(o.outdir, 'mobile-' + stamp + '-' + o.vw + 'x' + o.vh);
  fs.mkdirSync(dir, { recursive: true });
  res.notes.push('folder ' + dir);
  const { ctx, page, errors, info } = await openPage();
  const shot = (name) => shoot(page, res, name, dir);
  const need = (cond, note) => { if (!cond) fail(res, note); return !!cond; };
  try {
    res.notes.push(bootNote(info));
    await call(page, 'settings', o.quality);
    if (!(await tapIntoRun(page, need, shot))) return res;
    await dbg(page, 'fastForward', o.ff);
    await wait(1000);
    const box = await page.locator('#tc-stick').boundingBox().catch(() => null);
    if (box) { await touch(page, 'touchStart', box.x + box.width * 0.35, box.y + box.height * 0.6); await touch(page, 'touchMove', box.x + box.width * 0.35 + 50, box.y + box.height * 0.6 - 20); await wait(500); }
    await shot('04-run');
    if (box) await touch(page, 'touchEnd');
    res.notes.push('cards: ' + (await levelUpCards(page, 4)));
    await shot('05-levelup');
    await page.locator('#offer-cards .offer-card').first().tap({ timeout: 3000 }).catch(() => {});
    await wait(400);
    need(await tapId(page, 'tc-pause'), '#tc-pause not tappable');
    await wait(400);
    await shot('06-pause');
    await tapId(page, 'btn-resume');
    await dbg(page, 'win');
    await page.waitForFunction(() => window.ED.App.state === 'results', null, { timeout: 5000 }).catch(() => {});
    await wait(1700);
    need(await call(page, 'visible', 'scr-results'), 'results screen not shown');
    await shot('07-results');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Portrait phone (390 x 844): #ov-rotate shown on the title and in a run.
async function scenPortrait() {
  const res = newResult('portrait');
  const ctx = await newContext({ w: 390, h: 844 }), errors = [];
  try {
    const { page, info } = await bootPage(ctx, '', errors);
    res.notes.push(bootNote(info) + ', 390x844');
    const title = await call(page, 'visible', 'ov-rotate');
    await shoot(page, res, 'portrait-title');
    await call(page, 'start', 'knight', 0, { god: true });
    await page.evaluate(() => { window.__BR.drive = false; });
    await wait(800);
    const run = await call(page, 'visible', 'ov-rotate');
    res.notes.push(`#ov-rotate: title ${title ? 'shown' : 'hidden'}, run ${run ? 'shown' : 'hidden'}`);
    if (!run) fail(res, '#ov-rotate hidden in a portrait run');
    await shoot(page, res, 'portrait-run');
    await call(page, 'stop');
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Level-up layout on landscape phones (--viewport, 740x360, 667x375): 4 cards fully inside the viewport, card name / text >= 20 px, shown foot buttons inside the viewport.
async function scenCards() {
  const o = S.opt, res = newResult('cards');
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info));
    const sizes = [...new Set([o.vw + 'x' + o.vh, '740x360', '667x375'])];
    for (const sz of sizes) {
      const [w, h] = sz.split('x').map(Number);
      await page.setViewportSize({ width: w, height: h });
      await call(page, 'start', 'knight', 0, { god: true });
      await page.evaluate(() => { const B = window.__BR, p = window.ED.Game.w.heroes[0]; B.drive = false; B.autoPick = false; p.rerolls = 2; p.skips = 2; window.ED.Input.device = 'touch'; }); // reroll / skip shown
      await wait(600);
      const shown = await levelUpCards(page, 4);
      const m = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight, outside = (el) => { const b = el.getBoundingClientRect(); return b.width < 1 || b.left < -0.5 || b.top < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5; };
        const cards = [...document.querySelectorAll('#offer-cards .offer-card')], foot = document.getElementById('offer-foot');
        const fonts = cards.flatMap(c => [...c.querySelectorAll('.card-name, .card-txt')]).map(e => parseFloat(getComputedStyle(e).fontSize));
        const btns = foot && !foot.hidden ? [...foot.querySelectorAll('.btn')].filter(b => !b.hidden) : [];
        return { n: cards.length, out: cards.filter(outside).length, minFont: fonts.length ? Math.min(...fonts) : 0, clipped: cards.filter(c => c.scrollHeight > c.clientHeight + 1).length, foot: btns.length, footOut: btns.filter(outside).length,
          h: cards.length ? Math.round(Math.max(...cards.map(c => c.getBoundingClientRect().bottom)) - Math.min(...cards.map(c => c.getBoundingClientRect().top))) : 0 };
      });
      res.notes.push(`${sz}: ${m.n} cards (${shown} shown), ${m.out} outside the viewport, rows height ${m.h} px, min name/text font ${m.minFont} px, ${m.clipped} with clipped text, foot buttons ${m.foot} (${m.footOut} outside)`);
      if (m.n < 4) fail(res, `${sz}: ${m.n} cards`);
      if (m.out) fail(res, `${sz}: ${m.out} card(s) not fully inside the viewport`);
      if (m.minFont < 20) fail(res, `${sz}: card text ${m.minFont} px < 20 px`);
      if (m.footOut) fail(res, `${sz}: ${m.footOut} reroll / skip button(s) outside the viewport`);
      await shoot(page, res, 'cards-' + sz);
      await call(page, 'stop');
      await wait(300);
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
    const m = await profiled(page, res, () => call(page, 'measure', secs * 1000));
    res.rows.push(Object.assign({ quality: o.quality, cpu: S.cpu }, m));
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
    const sups = o.support ? (await supportForms(page, o.support)).slice(0, 2) : [];
    await call(page, 'start', LATE[set][0], 0, { god: true });
    await wait(500);
    const prep = await page.evaluate(([F, SF]) => {
      const E = window.ED, D = E.Debug, w = E.Game.w, p = w.heroes[0];
      D.give(F, 1);
      const ws = p.weapons[0];
      for (const id of SF) D.give(id);
      for (const id of ['might', 'reach', 'duration', 'multishot', 'haste', 'velocity']) D.give(id, 99);
      D.setTime(1500);
      const boss = D.spawnBoss();
      return { weapons: p.weapons.map(x => x.id + ':' + x.pr.join('') + 'r' + x.fl), form: !!(ws && ws.id === F), sups: SF.every(id => p.weapons.some(x => x.id === id)), passives: p.passives.length, boss };
    }, [LATE[set][1], sups]);
    res.notes.push('staged: ' + LATE[set][0] + ' ' + prep.weapons.join(',') + ', ' + prep.passives + ' passives' + (prep.boss ? ', boss' : ', no boss'));
    if (!prep.form || !prep.sups || prep.passives < 6) fail(res, 'staging gave form ' + prep.form + ', supports ' + prep.sups + ', ' + prep.passives + ' of 6 passives');
    await call(page, 'hold', 900, true);
    await wait(2500);
    const m = await profiled(page, res, () => call(page, 'measure', secs * 1000));
    const z = await page.evaluate(() => { const B = window.ED.Batch; return { n: B.zoneN, load: +B.zoneLoad.toFixed(2), lite: B.zoneLite, union: B.zoneUnion }; });
    res.rows.push(Object.assign({ quality: o.quality, cpu: S.cpu }, m));
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

// Runs fn; with --prof on chromium records a CPU profile meanwhile and notes the top 15 functions by self time (ms over the window, file:line).
async function profiled(page, res, fn) {
  if (!S.opt.prof || S.opt.browser !== 'chromium') return fn();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const out = await fn();
  const { profile } = await cdp.send('Profiler.stop');
  const heap = (await cdp.send('HeapProfiler.stopSampling')).profile, alloc = new Map();
  const walk = (n) => { const f = n.callFrame, k = (f.functionName || '(anon)') + ' ' + (f.url || '').split('/').pop() + ':' + (f.lineNumber + 1); if (n.selfSize) alloc.set(k, (alloc.get(k) || 0) + n.selfSize); for (const c of n.children || []) walk(c); };
  walk(heap.head);
  [...alloc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, b]) => res.notes.push('alloc ' + (b / 1024).toFixed(0).padStart(6) + ' KB  ' + k));
  const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n])), dt = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => { const n = byId.get(id), f = n.callFrame, k = (f.functionName || '(anon)') + ' ' + (f.url || '').split('/').pop() + ':' + (f.lineNumber + 1); self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, ms]) => res.notes.push('prof ' + ms.toFixed(0).padStart(6) + ' ms  ' + k));
  await cdp.detach();
  return out;
}
// Support Form ids named by spec ('all': every support root; a root: its first Form) on a booted page. Throws when none.
async function supportForms(page, spec) {
  const ids = await page.evaluate((a) => {
    const E = window.ED, roots = a === 'all' ? E.WEAPON_IDS.filter(id => E.WEAPONS[id].support && !E.WEAPONS[id].evolved) : a.split(',').map(x => x.trim());
    return roots.map(id => (E.WEAPONS[id] && !E.WEAPONS[id].evolved ? (E.weaponForms(id)[0] || {}).id : id)).filter(id => id && E.WEAPONS[id] && E.WEAPONS[id].support);
  }, spec);
  if (!ids.length) throw new Fail('--support names no support weapon');
  return ids;
}

async function scenForms() {
  const o = S.opt, res = newResult('forms'), secs = o.seconds || 4, only = o.form ? o.form.split(',').map(x => x.trim()) : null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = S.shotDir = path.join(o.outdir, 'forms-' + stamp + '-' + o.browser + (o.software ? '-soft' : ''));
  fs.mkdirSync(dir, { recursive: true });
  res.notes.push('folder ' + dir);
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info) + (o.software ? ', launched without GPU' : ''));
    await call(page, 'settings', o.quality);
    const sups = o.support ? await supportForms(page, o.support) : [''];
    for (const cls of o.classes) {
      const forms = await page.evaluate((c) => { const E = window.ED; return E.weaponForms(E.HEROES[c].sig).map(f => f.id); }, cls);
      for (const fid of forms) for (const sid of sups) {
        if (only && !only.includes(fid)) continue;
        await call(page, 'start', cls, 0, { god: true });
        await wait(300);
        const prep = await page.evaluate(([F, SF]) => {
          const E = window.ED, D = E.Debug, w = E.Game.w, p = w.heroes[0], ws = p.weapons[0];
          w.setForm(p, ws, F, 2);
          if (SF) D.give(SF);
          for (const id of ['might', 'reach', 'duration', 'multishot', 'haste', 'velocity']) D.give(id, 99);
          D.setTime(1200);
          w.addXp = w.updateProgress = () => {}; p.pend = p.pendForm = p.pendPath = 0; p.offer = null; w.paused = false; // no level-ups, offers or their overlay: the shot shows only this build
          w.recalc(p, false);
          const s = SF ? p.weapons.find(x => x.id === SF) : null;
          return { id: ws.id, pr: ws.pr.join(''), fl: ws.fl, passives: p.passives.length, sup: s ? s.id + ':' + s.pr.join('') + 'r' + s.fl : '', first: p.weapons[0] === ws, held: p.weapons.map(x => x.id).join('+') };
        }, [fid, sid]);
        if (prep.id !== fid || !prep.first) fail(res, `${cls}: Form ${fid} not taken (holds ${prep.id})`);
        if (sid && !prep.sup) fail(res, `${cls}: support Form ${sid} not taken`);
        await call(page, 'hold', 400, true);
        await wait(secs * 1000);
        await shoot(page, res, `${cls}-${fid}` + (sid ? '+' + sid : ''), dir);
        const looks = await page.evaluate(() => { const v = window.ED.Game.view, n = {}; for (const z of v.zones) if (!z.dead) n[z.k] = (n[z.k] || 0) + 1; for (const q of v.projs) if (!q.dead) n['p:' + q.k] = (n['p:' + q.k] || 0) + 1; return Object.entries(n).map(([k, c]) => k + ' ' + c).join(', '); });
        res.rows.push(Object.assign({ cls, form: fid, sup: prep.sup, held: prep.held, pr: prep.pr, fl: prep.fl, passives: prep.passives, looks }, await dbg(page, 'state')));
        await call(page, 'stop');
        await wait(150);
      }
    }
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
      else if (r.name === 'forms') out.push(`  ${w.cls.padEnd(7)} ${w.form.padEnd(14)} paths ${w.pr} refine ${w.fl} foes ${w.foes} kills ${w.kills} | ${w.looks}`);
      else if (r.name === 'ko') out.push(`  ${w.screen.padEnd(10)} latin ${String(w.latin).padStart(3)}  overflow ${String(w.over).padStart(2)}${w.sample ? '  e.g. ' + w.sample : ''}`);
      else if (r.name === 'coop' || r.name === 'botwatch') out.push('  ' + Object.entries(w).map(([k, v]) => k + ' ' + v).join(', '));
      else out.push(`  ${w.quality}: foes ${w.foes}, frames ${w.frames}, frame ms p50/p95/max ${tri(w.frame)}, work ms ${tri(w.work)}, sim ms/tick ${tri(w.tick)}, render ms ${tri(w.render)}, batch ${w.batch}, post ${w.usePost ? 'on' : 'off'}${w.soft ? ' (software)' : ''}, canvas ${w.canvas.join('x')}${w.post ? ', post canvas ' + w.post.join('x') : ''}, dpr ${w.dpr}${w.q && w.q !== w.quality ? ', resolved ' + w.q : ''}${w.auto ? ' (' + w.auto + ')' : ''}${w.cpu > 1 ? ', cpu x' + w.cpu : ''}`);
    }
    if (r.name !== 'shots' && r.name !== 'forms' && r.name !== 'ko') for (const f of r.shots) out.push('  shot ' + f);
    else out.push(`  ${r.shots.length} shots`);
  }
  return out.join('\n');
}

// Korean UI audit: every screen and overlay in Korean, one PNG and one BR.audit each; fails on errors, Latin words or overflowing text.
async function scenKo() {
  const o = S.opt, res = newResult('ko');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = S.shotDir = path.join(o.outdir, 'ko-' + stamp + '-' + o.browser);
  fs.mkdirSync(dir, { recursive: true });
  res.notes.push('folder ' + dir);
  const { ctx, page, errors, info } = await openPage();
  res.audit = [];
  let k = 1, nl = 0, no = 0;
  // noShot: audit only (rows of the same screen name merge).
  const audit = async (name, noShot) => {
    await wait(noShot ? 30 : 250);
    const a = await page.evaluate((allow) => window.__BR.audit(allow), KO_ALLOW.concat(['Tester']));
    res.audit.push({ screen: name, latin: a.latin, over: a.over });
    const row = res.rows.find(r => r.screen === name);
    if (row) { row.latin += a.latin.length; row.over += a.over.length; if (!row.sample) row.sample = a.latin.slice(0, 3).map(x => x.words).join(' | '); }
    else res.rows.push({ screen: name, latin: a.latin.length, over: a.over.length, sample: a.latin.slice(0, 3).map(x => x.words).join(' | ') });
    nl += a.latin.length; no += a.over.length;
    if (!noShot) await shoot(page, res, String(k++).padStart(2, '0') + '-' + name, dir);
  };
  const click = async (sel) => { await page.click(sel); await wait(150); };
  const need = (cond, note) => { if (!cond) fail(res, note); };
  try {
    res.notes.push(bootNote(info));
    await call(page, 'settings', o.quality);
    const lang = await page.evaluate(() => { window.ED.I18N.set('ko'); return window.ED.I18N.lang + ' / ' + document.documentElement.lang + ' / stored ' + window.ED.App.settings.lang; });
    res.notes.push('lang: ' + lang);
    need(lang === 'ko / ko / stored ko', 'language did not switch to ko');
    await page.fill('#inp-name', 'Tester').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await audit('title');
    await click('#btn-play'); need(await call(page, 'visible', 'scr-hero'), 'hero select not shown'); await audit('hero');
    await click('#btn-hero-next'); need(await call(page, 'visible', 'scr-stage'), 'stage select not shown'); await audit('stage');
    await click('#btn-stage-back'); await click('#btn-hero-back');
    await page.evaluate(() => { const A = window.ED.App; A.profile.gold = 2400; A.persist(); });
    await click('#btn-camp'); need(await call(page, 'visible', 'scr-camp'), 'camp not shown'); await audit('camp');
    await click('#btn-wardrobe'); need(await call(page, 'visible', 'scr-wardrobe'), 'wardrobe not shown'); await audit('wardrobe');
    await click('#btn-wd-back'); await click('#btn-camp-back');
    await click('#btn-achieve'); need(await call(page, 'visible', 'scr-achieve'), 'achievements not shown'); await audit('achieve');
    await click('#btn-ach-back');
    await click('#btn-codex'); need(await call(page, 'visible', 'scr-codex'), 'encyclopedia not shown');
    const tabs = await page.locator('#cx-tabs button').count();
    for (let i = 0; i < tabs; i++) { await page.locator('#cx-tabs button').nth(i).click(); await wait(100); await audit('codex-' + (i + 1)); }
    // every entry discovered (a stage best too): each detail pane audited, the tab's PNG on its last entry
    await page.evaluate(() => { const E = window.ED, p = E.App.profile; p.seen = { heroes: E.HERO_IDS.slice(), weapons: E.WEAPON_IDS.slice(), passives: E.PASSIVE_IDS.slice(), foes: E.FOE_IDS.slice(), stages: E.STAGE_IDS.slice() }; p.best[E.STAGE_IDS[0]] = { time: 754, kills: 3120, level: 31, won: true }; E.Codex.renderCodex(); });
    for (let i = 0; i < tabs; i++) {
      await page.locator('#cx-tabs button').nth(i).click(); await wait(80);
      const n = await page.locator('#cx-list .cx-item').count();
      for (let j = 0; j < n; j++) { await page.locator('#cx-list .cx-item').nth(j).click(); await audit('codex-all-' + (i + 1), j < n - 1); }
    }
    await click('#btn-codex-back');
    await click('#btn-settings'); need(await call(page, 'visible', 'ov-settings'), 'settings not shown'); await audit('settings');
    await click('#btn-settings-close');
    await click('#btn-credits'); need(await call(page, 'visible', 'ov-credits'), 'credits not shown'); await audit('credits');
    await click('#btn-credits-close');
    // round trip: English back, then Korean again (DOM sources cached on first apply)
    const back = await page.evaluate(() => { const I = window.ED.I18N, q = (id) => document.getElementById(id).textContent; I.set('en'); const en = q('btn-play') + ' / ' + q('btn-settings'); I.set('ko'); return en + ' | ' + q('btn-play'); });
    res.notes.push('round trip: ' + back);
    need(/^Play solo \/ Settings \| /.test(back) && !/Play solo$/.test(back), 'switching back to English (and again to Korean) did not relabel the title');
    // run: HUD, level-up overlay, chest, pause, results
    await call(page, 'start', 'knight', 0, { god: true });
    await page.evaluate(() => { window.__BR.autoPick = false; window.__BR.still = true; });
    await wait(1200);
    await audit('run-hud');
    await dbg(page, 'levelUp', 1);
    await page.waitForFunction(() => { const el = document.getElementById('ov-offer'); return el && !el.hidden; }, null, { timeout: 3000 }).catch(() => {});
    need(await call(page, 'visible', 'ov-offer'), 'level-up overlay not shown');
    await wait(700);
    await audit('levelup');
    await page.evaluate(() => { window.__BR.autoPick = true; });
    await page.waitForFunction(() => document.getElementById('ov-offer').hidden, null, { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => { window.__BR.autoPick = false; });
    await dbg(page, 'give', 'might', 1);
    const chest = await dbg(page, 'chest');
    need(Array.isArray(chest) && chest.length > 0, 'chest gave nothing');
    await wait(300);
    await audit('chest');
    await page.waitForFunction(() => document.getElementById('ov-chest').hidden, null, { timeout: 6000 }).catch(() => {});
    await page.keyboard.press('Escape'); await wait(300);
    need(await call(page, 'visible', 'ov-pause'), 'pause not shown');
    await audit('pause');
    await page.keyboard.press('Escape'); await wait(200);
    await dbg(page, 'win');
    await page.waitForFunction(() => window.ED.App.state === 'results', null, { timeout: 5000 }).catch(() => {});
    need(await call(page, 'visible', 'scr-results'), 'results screen not shown');
    await wait(1700);
    await audit('results');
    const missAll = await page.evaluate(() => [...window.ED.I18N.missing]), miss = missAll.filter(s => /[A-Za-z]{2,}/.test(s.replace(/\{\d+\}/g, '')));
    res.notes.push('table misses: ' + missAll.length + (missAll.length ? ' (' + missAll.slice(0, 6).map(s => JSON.stringify(s)).join(', ') + ')' : ''));
    if (miss.length) fail(res, miss.length + ' English source(s) missed the Korean table: ' + miss.slice(0, 8).map(s => JSON.stringify(s)).join(', '));
  } finally { res.errors = errors; await ctx.close(); }
  if (nl) fail(res, nl + ' text node(s) with Latin words');
  if (no) fail(res, no + ' box(es) with overflowing text');
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
}

// Results screen from synthetic summaries (no run): a solo 21:05 knight victory with a Form, two supports, six passives, four bosses and the Last Light lap, a 4-hero co-op victory,
// and a solo 7:30 loss; one PNG each. Fails on page scroll, Enter pressed at once leaving the screen, no default focus once the guard ends, or a page / console error.
async function scenResults() {
  const o = S.opt, res = newResult('results');
  const { ctx, page, errors, info } = await openPage();
  try {
    res.notes.push(bootNote(info));
    const show = (variant) => page.evaluate((v) => {
      const E = window.ED, U = E.U, hero = E.HEROES.knight, root = hero.sig, form = (E.weaponForms(root)[0] || {}).id || root;
      const sup = E.WEAPON_IDS.filter(id => E.WEAPONS[id].support && !E.WEAPONS[id].evolved).slice(0, 2), pas = Object.keys(E.PASSIVES).slice(0, 6), sk = hero.skills[0];
      const won = v !== 'lost', time = won ? 1265 : 450, mins = Math.floor(time / 60) + (time % 60 >= 1 ? 1 : 0);
      const tl = []; for (let i = 0; i < Math.min(25, mins); i++) tl.push({ k: Math.round(40 + i * i * 9 + (i % 3) * 60 + (i >= 20 ? 2600 : 0)), d: Math.round(9000 * (i + 1) * (i + 1)), lv: Math.min(40, 2 + Math.round(i * 1.75)) });
      const stage = E.STAGES[0], bosses = stage.bosses.filter(b => b.t <= time).map((b, i) => ({ id: b.id, f: b.final ? 1 : 0, t0: b.t, t1: won || i < 1 ? b.t + 28 + i * 9 : -1 }));
      const heroOf = (pid, cls, name, k) => {
        const h = E.HEROES[cls], r = h.sig, f = (E.weaponForms(r)[0] || {}).id;
        const main = won && f ? f : r, dealt = {}; dealt[main] = Math.round(1.8e6 * k); dealt[h.skills[0]] = Math.round(2.4e5 * k);
        sup.forEach((s, i) => { dealt[s] = Math.round((3.1e5 - i * 1.2e5) * k); });
        dealt.bomb = Math.round(21000 * k);
        const kw = {}; kw[main] = Math.round(31000 * k); kw[h.skills[0]] = Math.round(2100 * k); sup.forEach((s, i) => { kw[s] = Math.round((5400 - i * 2000) * k); }); kw.bomb = 600;
        return { pid, cls, name, kills: Object.values(kw).reduce((a, b) => a + b, 0), dealt, kw, weapons: [main].concat(sup),
          build: [{ id: main, tune: 5, path: 0, pr: [5, 0, 0], fl: won ? 2 : 0, t0: 0 }].concat(sup.map((s, i) => ({ id: s, tune: 5 - i * 2, path: i ? -1 : 1, pr: i ? [0, 0, 0] : [0, 3, 0], fl: 0, t0: 140 + i * 260 }))),
          ranks: 4, form: won, pas: pas.map((id, i) => [id, Math.max(1, E.PASSIVES[id].max - i % 3)]), sk: [[h.skills[0], 3]],
          taken: Math.round(1840 * k), healed: Math.round(960 * k), top: { v: Math.round(48210 * k), id: main }, downs: k < 1 ? 1 : 0, revs: k < 1 ? 0 : 2, goldGot: Math.round(310 * k) };
      };
      const perHero = v === 'coop' ? [heroOf('host', 'knight', 'Tester', 1), heroOf('p2', 'ranger', 'Robin', 0.8), heroOf('p3', 'pyro', 'Ash', 0.6), heroOf('p4', 'cleric', 'Mira', 0.4)] : [heroOf('host', 'knight', 'Tester', 1)];
      const kills = tl.reduce((a, e) => a + e.k, 0);
      const sum = { won, time, kills, level: tl[tl.length - 1].lv, gold: won ? 612 : 88, stage: 0, tl, bosses, lap: won ? { t0: 1205, dur: 60, kills: 8551, gold: 57 } : null, perHero };
      const gained = { news: won ? [{ kind: 'ach', id: (E.ACHIEVEMENTS && E.ACHIEVEMENTS[0] || {}).id || '', txt: 'Achievement: First Light (+50 gold)' }, { kind: 'hero', id: 'shade', txt: 'Hero unlocked: Shade' }] : [], records: won ? ['time', 'kills'] : [] };
      E.Game.myPid = 'host'; E.UI.lastMode = v === 'coop' ? 'host' : 'solo'; E.App.state = 'results';
      E.UI.renderResults(sum, gained); E.UI.show('results');
      return { form, root, sup, sk, tl: tl.length, bosses: bosses.length };
    }, variant);
    for (const v of ['solo', 'coop', 'lost']) {
      const got = await show(v);
      await page.keyboard.press('Enter'); // inside the input guard: must do nothing
      await wait(200);
      if (!(await call(page, 'visible', 'scr-results'))) { fail(res, v + ': Enter inside the guard left the results screen'); continue; }
      const early = await page.evaluate(() => document.activeElement && document.activeElement.id);
      await wait(1700);
      const st = await page.evaluate(() => {
        const s = document.getElementById('scr-results'), q = (sel) => [...s.querySelectorAll(sel)];
        const over = q('.res-panel, .res-pane').filter(el => el.scrollHeight > el.clientHeight + 2).map(el => el.className + ' ' + el.scrollHeight + '/' + el.clientHeight);
        return { scroll: s.scrollHeight - s.clientHeight, body: document.documentElement.scrollHeight - innerHeight, focus: document.activeElement && document.activeElement.id, rows: q('.bar-row').length, tiles: q('.tile').length, over,
          minFont: Math.min(...q('span, b, button').filter(el => el.offsetParent && el.textContent.trim()).map(el => parseFloat(getComputedStyle(el).fontSize))) };
      });
      res.notes.push(`${v}: ${JSON.stringify(got)} | rows ${st.rows}, tiles ${st.tiles}, min font ${st.minFont}px, focus ${early || '-'} -> ${st.focus}${st.over.length ? ', inner scroll ' + st.over.join('; ') : ''}`);
      if (st.scroll > 1 || st.body > 1) fail(res, `${v}: page scrolls (${st.scroll} / ${st.body} px)`);
      if (early && early !== '') fail(res, `${v}: ${early} focused inside the guard`);
      if (st.focus !== (v === 'coop' ? 'btn-res-back' : 'btn-res-again')) fail(res, `${v}: default focus after the guard is ${st.focus}`);
      if (st.minFont < 16) fail(res, `${v}: text below 16 px (${st.minFont})`);
      await page.mouse.move(Math.round(o.vw * 0.3), Math.round(o.vh * 0.98));
      await shoot(page, res, v);
      if (v === 'solo') { await page.mouse.move(Math.round(o.vw * 0.75), Math.round(o.vh * 0.45)); await shoot(page, res, v + '-hover'); }
    }
  } finally { res.errors = errors; await ctx.close(); }
  if (res.errors.length) fail(res, res.errors.length + ' page or console error(s)');
  return res;
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
    log(`browse: headless ${S.opt.browser} ${S.browser.version()}, ${S.opt.vw}x${S.opt.vh}${S.opt.mobile ? ' phone (dpr ' + PHONE.dpr + ', touch)' : ''}${S.opt.software ? ', no GPU' : ''}`);
    for (const sc of S.opt.scens) {
      const t0 = Date.now();
      S.cpu = S.opt.cpu !== undefined ? S.opt.cpu : S.opt.mobile && /^(crowd|late)/.test(sc) ? 4 : 1;
      let r;
      try { r = sc === 'smoke' ? await (S.opt.mobile ? scenMobileSmoke() : scenSmoke()) : sc === 'shots' ? await (S.opt.mobile ? scenMobileShots() : scenShots()) : sc === 'portrait' ? await scenPortrait() : sc === 'cards' ? await scenCards() : sc === 'forms' ? await scenForms() : sc === 'coop' ? await scenCoop() : sc === 'botwatch' ? await scenBotwatch() : sc === 'lap' ? await scenLap() : sc === 'sanctum' ? await scenSanctum() : sc === 'bossart' ? await scenBossArt() : sc === 'results' ? await scenResults() : sc === 'ko' ? await scenKo() : sc.startsWith('late') ? await scenLate(sc) : await scenCrowd(sc); }
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
