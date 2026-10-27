// Headless audio check (Playwright Chromium, muted, never a visible window): bakes every SFX cue, checks each is non-silent, that every registered weapon / skill and the
// GAME-DESIGN weapon names resolve to their own cue, that every World event type plays, and runs a 900-foe crowd measuring main-thread audio ms per frame (A.event + A.flush +
// Music.update + the music scheduler; summed per call, so with the browser's 0.1 ms timer only the average is exact), live voices and the output peak after the limiter. Usage: node tools/check-audio.js [--seconds=6] [--crowd=900]. Exit 0 pass, 1 fail, 2 harness error.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? +m.split('=')[1] : d; };
const SECS = arg('seconds', 6), CROWD = arg('crowd', 900), ROOT = path.resolve(__dirname, '..');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not next to the repo */ }
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), npx = path.join(la, 'npm-cache', '_npx');
  let dirs = []; try { dirs = fs.readdirSync(npx); } catch (e) { /* no npx cache */ }
  const c = dirs.map((d) => path.join(npx, d, 'node_modules', 'playwright')).filter((d) => fs.existsSync(path.join(d, 'package.json'))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const d of c) { try { return require(d); } catch (e) { /* next */ } }
  throw new Error('playwright not found (npx --yes playwright install chromium)');
}
function serve() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(data); });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, base: 'http://127.0.0.1:' + srv.address().port })));
}

// ---------------- in-page steps ----------------
async function pageBake() {
  const E = window.ED, A = E.Audio;
  A.init();
  if (A.ctx.state !== 'running') { try { await A.ctx.resume(); } catch (e) { /* stays suspended */ } }
  const t0 = performance.now();
  while (!A.baked && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50));
  const bad = [], cues = Object.values(A.CUES);
  let bytes = 0;
  for (const c of cues) {
    if (!c.bufs) { bad.push(c.name + ': ' + (c.err || 'not baked')); continue; }
    for (const b of c.bufs) { bytes += b.length * 4; const d = b.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); if (pk < 0.05) bad.push(c.name + ': silent variant'); }
  }
  return { baked: A.baked, ms: A.bakeMs, cues: cues.length, mb: +(bytes / 1048576).toFixed(1), bad, state: A.ctx.state };
}
function pageResolve() {
  const E = window.ED, A = E.Audio, bad = [];
  for (const id of Object.keys(E.WEAPONS)) { const c = A.wcue(id); if (!c || !c.bufs) bad.push('weapon ' + id + ' has no cue'); else if (/^w\.(proj|melee|aura)/.test(c.name)) bad.push('weapon ' + id + ' fell back to ' + c.name); }
  for (const id of Object.keys(E.SKILLS)) { const c = A.scue(id, 0); if (!c || c.name !== 'k.' + id) bad.push('skill ' + id + ' -> ' + (c && c.name)); }
  // GAME-DESIGN §4 general weapons and evolutions by name (ids unknown to this lane): [name, mode, expected family, evolved name]
  const G = [['Orbit Lanterns', 'around', 'lanterns', 'Sun Wheel'], ['Chain Spark', 'nearest', 'chainspark', 'Storm Crown'], ['Frost Ring', 'around', 'frostring', 'Glacier'], ['Bramble Trail', 'facing', 'bramble', 'Thornwood'],
    ['Glaive', 'nearest', 'glaive', 'Twin Moons'], ['Meteor Call', 'random', 'meteorcall', 'Starfall'], ['Bone Spear', 'facing', 'bonespear', 'Impaler'], ['Blight Pool', 'around', 'blight', 'Plague Field'],
    ['Wisp', 'nearest', 'wisp', 'Wisp Choir'], ['Mortar', 'densest', 'mortar', 'Barrage'], ['Censer', 'around', 'censer', 'Holy Censer'], ['Ricochet', 'nearest', 'ricochet', 'Avalanche'],
    ['Fire Bolt', 'nearest', 'firebolt', 'Inferno'], ['Bone Shard', 'nearest', 'boneshard', 'Bone Storm'], ['Smite', 'random', 'smite', 'Wrath'], ['Twin Daggers', 'facing', 'daggers', 'Shadow Fan'], ['Toll', 'around', 'toll', 'Cathedral']];
  G.forEach(([name, mode, fam, evo], i) => {
    const b = 'zzw' + i, e = 'zze' + i;
    E.WEAPONS[b] = { id: b, name, mode, look: 'dot' }; E.WEAPONS[e] = { id: e, name: evo, mode, evolved: true, from: b };
    const cb = A.wcue(b), ce = A.wcue(e);
    if (!cb || cb.name !== 'w.' + fam) bad.push(name + ' -> ' + (cb && cb.name) + ' (want w.' + fam + ')');
    if (!ce || ce.name !== 'w.' + fam + '+') bad.push(evo + ' -> ' + (ce && ce.name) + ' (want w.' + fam + '+)');
    delete E.WEAPONS[b]; delete E.WEAPONS[e];
  });
  return bad;
}
async function pageEvents() {
  const E = window.ED, A = E.Audio, wid = Object.keys(E.WEAPONS)[0], sk = Object.keys(E.SKILLS)[0];
  const EV = [{ t: 'hit', id: 1, x: 0, y: 0, dmg: 20, crit: false }, { t: 'hit', id: 1, x: 0, y: 0, dmg: 40, crit: true }, { t: 'die', id: 2, k: 0, x: 0, y: 0 }, { t: 'die', id: 3, k: 0, x: 0, y: 0, elite: true },
    { t: 'shoot', pid: 'p1', wid }, { t: 'swing', pid: 'p1', wid: 'cleave', x: 0, y: 0, a: 0, r: 50, arc: 2, look: 'slash' }, { t: 'chain', pid: 'p1', wid: 'zz', pts: [] }, { t: 'skill', pid: 'p1', id: sk, slot: 0, x: 0, y: 0, a: 0 },
    { t: 'boom', pid: 'p1', wid, x: 0, y: 0, r: 80, look: 'fire' }, { t: 'boom', x: 0, y: 0, r: 40, look: 'fire', team: 1 }, { t: 'eshoot', id: 4, x: 0, y: 0, look: 'orb' }, { t: 'dash', pid: 'p1', x: 0, y: 0, a: 0 },
    { t: 'pickup', k: 'xp1', pid: 'p1', x: 0, y: 0, val: 1 }, { t: 'pickup', k: 'xp25', pid: 'p1', x: 0, y: 0, val: 25 }, { t: 'pickup', k: 'gold', pid: 'p1', x: 0, y: 0, val: 3 }, { t: 'pickup', k: 'food', pid: 'p1', x: 0, y: 0, val: 30 },
    { t: 'pickup', k: 'magnet', pid: 'p1', x: 0, y: 0 }, { t: 'pickup', k: 'bomb', pid: 'p1', x: 0, y: 0 }, { t: 'pickup', k: 'chest', pid: 'p1', x: 0, y: 0 }, { t: 'heal', pid: 'p1', v: 30 }, { t: 'level', level: 2 },
    { t: 'offer', pid: 'p1' }, { t: 'offer', pid: 'p1', reroll: true }, { t: 'pick', pid: 'p1', kind: 'weapon', id: wid, lvl: 1 }, { t: 'pick', pid: 'p1', kind: 'wlvl', id: wid, lvl: 2 }, { t: 'pick', pid: 'p1', kind: 'passive', id: 'might', lvl: 1 },
    { t: 'pick', pid: 'p1', kind: 'skill', id: sk, lvl: 2 }, { t: 'pick', pid: 'p1', kind: 'gold', id: '' }, { t: 'evolve', pid: 'p1', wid, from: wid }, { t: 'hurt', pid: 'p1', dmg: 6, x: 0, y: 0 }, { t: 'down', pid: 'p1' },
    { t: 'dead', pid: 'p1' }, { t: 'revive', pid: 'p1' }, { t: 'boss', id: 'warden', fid: 9, phase: 0 }, { t: 'boss', id: 'warden', fid: 9, phase: 1 }, { t: 'boss', id: 'warden', fid: 9, phase: 'enrage' },
    { t: 'boss', id: 'warden', fid: 9, phase: -1 }, { t: 'brazier', id: 5, x: 0, y: 0, pid: 'p1' }, { t: 'chest', pid: 'p1', results: [] }, { t: 'warn', kind: 'swarm' }, { t: 'warn', kind: 'elite' }, { t: 'warn', kind: 'boss', id: 'warden' }];
  const silent = [];
  for (const ev of EV) {
    A.hush(); for (const c of Object.values(A.CUES)) c.last = -9; // each event alone: no live voices, no gaps
    const n0 = A.played; A.event(ev, 'p1'); A.flush();
    if (A.played === n0) silent.push(ev.t + (ev.k ? ':' + ev.k : ev.kind ? ':' + ev.kind : ev.phase !== undefined ? ':' + ev.phase : ''));
    await new Promise((r) => setTimeout(r, 30));
  }
  // a new foe telegraph zone in the view rings 'tele'
  const G = E.Game, v0 = G.view;
  A.hush(); G.view = { zones: [{ id: 5, warn: true, team: 0, x: 0, y: 0 }], heroes: [] }; A.flush(); // the hero's own warn zone: silent
  const n1 = A.played; G.view.zones.push({ id: 9, warn: true, team: 1, x: 0, y: 0 }); A.flush();
  if (A.played !== n1 + 1) silent.push('telegraph zone');
  G.view = v0;
  return { n: EV.length + 1, silent, running: A.ctx.state === 'running' };
}
// Music: every track schedules, the controller picks run / boss / final tracks per stage and level, muffles at low HP, and a run's end holds for its stinger.
function pageMusic() {
  const E = window.ED, M = E.Music, A = E.Audio, bad = [], t = () => A.ctx.currentTime;
  for (const k of M.Score.TRACKS()) { try { M.eng.play(k, t(), 3); M.eng.pump(t() + 1.5, t()); } catch (e) { bad.push(k + ': ' + e.message); } }
  M.eng.stop(t()); M.track = null; M.bumpT = 0; M.lv = 0; // no warning bump from the event step
  const me = { hp: 20, maxHp: 100 }, v = { stage: 0, foes: new Array(300), boss: null, me, time: 0, zones: [], heroes: [] };
  const want = (cond, what) => { if (!cond) bad.push(what + ' (track ' + M.track + ', lv ' + M.lv + ', muffle ' + M.mu + ')'); };
  M.update(v, 1 / 60); want(M.track === 'run1' && M.lv === 2 && M.mu < 20000, 'stage 1, 300 foes, 20% HP');
  v.stage = 1; v.foes.length = 10; me.hp = 100; M.update(v, 1 / 60); want(M.track === 'run2' && M.lv === 0 && M.mu === 20000, 'stage 2, 10 foes, full HP: new track at level 0');
  v.stage = 2; v.boss = { hp: 90, maxHp: 100 }; M.update(v, 1 / 60); want(M.track === 'boss4', 'stage 3 boss');
  v.boss = { hp: 10, maxHp: 100, final: true }; M.update(v, 1 / 60); want(M.track === 'final4' && M.lv === 3, 'final boss at 10%');
  M.onEvent({ t: 'end', won: true }); want(M.track === null && M.hold > t() + 3, 'victory stinger hold');
  M.hold = 0;
  return bad;
}
function pageCrowd(n) {
  const E = window.ED, A = E.Audio, M = E.Music;
  if (!E.App.hasProfile) E.App.createProfile('Bot');
  E.App.startSolo({ cls: 'knight', stage: 0, seed: 7, cheats: { god: true, might: 4 } });
  const W = window.__AU = { ms: 0, frames: [], voices: 0, peak: 0, ev: 0, pumps: [], mx: {} };
  const wrap = (o, k) => { const f = o[k]; W.mx[k] = 0; o[k] = function () { const t = performance.now(); const r = f.apply(this, arguments), d = performance.now() - t; W.ms += d; if (W.on && d > W.mx[k]) W.mx[k] = +d.toFixed(2); return r; }; };
  const ev0 = A.event; W.mx.event = 0; A.event = function (e, p) { W.ev++; const t = performance.now(); ev0(e, p); const d = performance.now() - t; W.ms += d; if (W.on && d > W.mx.event) W.mx.event = +d.toFixed(2); };
  wrap(A, 'flush'); wrap(M, 'update');
  const pu = M.eng.pump; M.eng.pump = function (a, b) { const t = performance.now(); pu(a, b); const d = performance.now() - t; W.ms += d; if (W.on) W.pumps.push(d); }; // the music scheduler (100 ms timer)
  const an = A.ctx.createAnalyser(); an.fftSize = 2048; A.out.connect(an); const buf = new Float32Array(2048);
  const step = () => {
    if (!W.on) return;
    W.frames.push(W.ms); W.ms = 0; W.voices = Math.max(W.voices, A.voices());
    an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > W.peak) W.peak = a; }
    requestAnimationFrame(step);
  };
  W.hold = setInterval(() => { // keep n foes on a ring around the hero, and the hero moving
    const w = E.Game.w; if (!w) return;
    const me = w.heroes[0], ids = w.sdef.timeline[0].roster.map((r) => r[0]);
    for (let k = 0; w.foes.length < n && k < 300; k++) { const a = Math.random() * 6.283, d = 120 + Math.random() * 210, x = me.x + Math.cos(a) * d, y = me.y + Math.sin(a) * d; if (!E.Arena.blocked(w.arena, x, y, 10)) w.spawnFoe(ids[(Math.random() * ids.length) | 0], x, y); }
    if (me.offer) w.input(me.pid, { pick: 1 });
  }, 100);
  return new Promise((r) => setTimeout(() => { W.on = true; W.frames.length = 0; W.peak = 0; W.ev = 0; requestAnimationFrame(step); r(); }, 2000));
}
function pageCrowdEnd() {
  const W = window.__AU, E = window.ED, s = W.frames.slice().sort((a, b) => a - b), q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3);
  W.on = false; clearInterval(W.hold);
  const w = E.Game.w;
  const P = W.pumps.sort((a, b) => a - b), r = { mx: W.mx, pump: P.length ? [+P[P.length >> 1].toFixed(2), +P[P.length - 1].toFixed(2)] : [0, 0], frames: s.length, avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), p50: q(0.5), p95: q(0.95), max: q(1), voices: W.voices, peak: +W.peak.toFixed(3), evPerFrame: Math.round(W.ev / s.length), foes: w ? w.foes.length : 0, kills: w ? w.kills : 0, track: E.Music.track, lv: E.Music.lv };
  if (E.App.state === 'run') E.App.quitRun();
  return r;
}
// Storm: per frame 900 deaths, 200 hits, 60 booms, 40 shots of each weapon, for 2 s; peak after the limiter and live voices.
function pageStorm() {
  const E = window.ED, A = E.Audio, an = A.ctx.createAnalyser(), buf = new Float32Array(2048), wids = Object.keys(E.WEAPONS);
  an.fftSize = 2048; A.out.connect(an);
  let peak = 0, voices = 0, ms = 0, frames = 0;
  const hit = { t: 'hit', id: 1, x: 0, y: 0, dmg: 30, crit: false }, die = { t: 'die', id: 1, k: 0, x: 0, y: 0 }, boom = { t: 'boom', pid: 'p1', wid: wids[0], x: 30, y: 0, r: 90, look: 'fire' };
  const sh = wids.map((wid) => ({ t: 'shoot', pid: 'p1', wid }));
  return new Promise((res) => {
    const t0 = performance.now();
    const step = () => {
      const t = performance.now();
      for (let i = 0; i < 900; i++) A.event(die, 'p1');
      for (let i = 0; i < 200; i++) { hit.crit = (i & 7) === 0; A.event(hit, 'p1'); }
      for (let i = 0; i < 60; i++) A.event(boom, 'p1');
      for (const e of sh) for (let i = 0; i < 40; i++) A.event(e, 'p1');
      A.flush(); ms += performance.now() - t; frames++;
      voices = Math.max(voices, A.voices());
      an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      if (performance.now() - t0 < 2000) requestAnimationFrame(step); else res({ frames, msPerFrame: +(ms / frames).toFixed(3), voices, peak: +peak.toFixed(3) });
    };
    requestAnimationFrame(step);
  });
}

async function main() {
  const pw = loadPlaywright(), { srv, base } = await serve();
  const browser = await pw.chromium.launch({ headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  const fails = [], errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e && e.stack || e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.ED && window.ED.App && window.ED.App.state === 'title', null, { timeout: 30000 });
    const bk = await page.evaluate(pageBake);
    console.log(`bake: ${bk.cues} cues in ${bk.ms} ms, ${bk.mb} MB, context ${bk.state}`);
    if (!bk.baked) fails.push('bake did not finish'); for (const b of bk.bad) fails.push('bake ' + b);
    const rs = await page.evaluate(pageResolve);
    console.log(`resolve: ${rs.length ? rs.length + ' problem(s)' : 'every weapon, skill and GAME-DESIGN weapon name has its own cue'}`);
    for (const b of rs) fails.push('resolve ' + b);
    const ev = await page.evaluate(pageEvents);
    console.log(`events: ${ev.n} sample events, silent: ${ev.silent.join(', ') || 'none'}${ev.running ? '' : ' (context not running: playback untested)'}`);
    if (ev.running) for (const s of ev.silent) fails.push('event ' + s + ' played no voice');
    const mu = await page.evaluate(pageMusic);
    console.log(`music: ${mu.length ? mu.length + ' problem(s)' : 'all tracks schedule; run / boss / final per stage, levels, muffle and stinger hold behave'}`);
    for (const b of mu) fails.push('music ' + b);
    const storm = await page.evaluate(pageStorm);
    console.log(`storm (900 deaths + 200 hits + 60 booms + 40 shots per weapon per frame): ${storm.frames} frames, ${storm.msPerFrame} ms/frame audio, max voices ${storm.voices}, output peak ${storm.peak}`);
    if (storm.voices > 40) fails.push('storm voices ' + storm.voices + ' > 40');
    if (storm.peak > 1) fails.push('storm output peak ' + storm.peak + ' > 1');
    await page.evaluate(pageCrowd, CROWD);
    await page.waitForTimeout(SECS * 1000);
    const cr = await page.evaluate(pageCrowdEnd);
    console.log(`crowd ${CROWD}: foes ${cr.foes}, kills ${cr.kills}, ${cr.frames} frames, ${cr.evPerFrame} events/frame, audio main-thread ms/frame avg ${cr.avg} p50 ${cr.p50} p95 ${cr.p95} max ${cr.max}, max voices ${cr.voices}, peak ${cr.peak}, music ${cr.track} lv ${cr.lv}, scheduler ms median/max ${cr.pump.join('/')}, worst single call ms ${JSON.stringify(cr.mx)}`);
    if (cr.avg > 0.5) fails.push('crowd audio avg ' + cr.avg + ' ms/frame > 0.5');
    if (cr.peak > 1) fails.push('crowd output peak ' + cr.peak + ' > 1');
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
  for (const e of errors) fails.push('page error: ' + e);
  for (const f of fails) console.log('FAIL ' + f);
  console.log(fails.length ? 'check-audio: FAIL' : 'check-audio: PASS');
  return fails.length ? 1 : 0;
}
main().then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 2; });
