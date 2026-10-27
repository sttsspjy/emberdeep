// Renderer check (exit 1 on failure, 2 harness error): boots the game in headless Chromium (never a visible window) and checks ED.Batch's two backends.
//  1. backend: quality high on a hardware WebGL context selects Batch 'gl' (WebGL2 or ANGLE_instanced_arrays); quality low selects '2d'.
//  2. parity: one paused frame (light crowd, a hostile telegraph, elites, text) rendered by both backends; the share of pixels whose max channel differs by > 48 must stay <= PARITY.
//  3. features: tint + additive, variants (grey, frozen, outline, a Pix palette ramp), a runtime page (Pix.define), small and large img(), non-Latin canvas text, the B.ctx bridge,
//     cone / ring shapes; each must change the pixels of its box in both backends.
//  4. context loss: WEBGL_lose_context drops to '2d' without errors; restoring returns to 'gl'.
//  5. crowd900: 900 foes + 600 projectiles + 400 gems held in view; Render.frame ms and rAF frame ms p50 / p95 / max per backend, plus GL draws and instances per frame.
//  6. webgl1: a second page forced onto WebGL1 + ANGLE_instanced_arrays (window.ED_GL1) repeats backend, parity and features.
// Usage: node tools/check-gl.js [--seconds=N (5)] [--software]. Screens and result-gl.json go to <tmp>/wickdeep-browse. Perf numbers are reported, not gated (the merge step gates them).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(os.tmpdir(), 'wickdeep-browse'), PARITY = 0.06;
const arg = (k, d) => { const a = process.argv.find(s => s.startsWith('--' + k)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const SECS = +arg('seconds', 5), SOFT = !!arg('software', false);

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not next to the repo */ }
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), npx = path.join(la, 'npm-cache', '_npx');
  let dirs = []; try { dirs = fs.readdirSync(npx); } catch (e) { /* no npx cache */ }
  const c = dirs.map(d => path.join(npx, d, 'node_modules', 'playwright')).filter(d => fs.existsSync(path.join(d, 'package.json'))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const d of c) { try { return require(d); } catch (e) { /* next */ } }
  throw new Error('playwright not found (npx --yes playwright install chromium)');
}
function serve() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---------------- in-page helpers (serialised; no Node variables) ----------------
function inPage() {
  let ms = 1;
  Math.random = () => { ms = (ms + 0x6d2b79f5) | 0; let t = Math.imul(ms ^ (ms >>> 15), 1 | ms); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const H = window.__GL = {};
  const E = () => window.ED;
  const frames = (k) => new Promise(r => { const f = () => (k-- > 0 ? requestAnimationFrame(f) : r()); f(); });
  H.boot = () => new Promise((res, rej) => { const t0 = performance.now(); const poll = () => { const e = E(); if (e && e.App && e.App.state === 'title') res({ post: !!e.Post.ready, soft: !!e.Post.soft, gl2: !!e.Post.gl2 }); else if (performance.now() - t0 > 20000) rej(new Error('boot timeout')); else setTimeout(poll, 50); }; poll(); });
  H.quality = async (q) => { const e = E(); e.App.settings.quality = q; e.App.applySettings(); await frames(3); return { mode: e.Batch.mode, gpu: e.Render.gpu, err: e.Batch.glError }; };
  H.start = (cls) => { const e = E(); if (!e.App.hasProfile) e.App.createProfile('Bot'); e.App.startSolo({ cls, stage: 0, seed: 7, cheats: { god: true } }); return e.App.state; };
  // A fixed scene: n foes (every 25th elite) around the hero, a hostile telegraph, then the sim and FX frozen.
  H.scene = async (n) => {
    const e = E(), w = e.Game.w, p = w.heroes[0], ids = w.sdef.timeline[0].roster.map(r => r[0]);
    for (const row of w.sdef.timeline) row.rate = 0;
    w.sp.swarmT = w.sp.eliteT = Infinity;
    for (let k = 0; w.foes.length < n && k < 4 * n; k++) { const a = Math.random() * 6.283, d = 40 + Math.random() * 170, x = p.x + Math.cos(a) * d * 1.6, y = p.y + Math.sin(a) * d; if (!e.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ids[k % ids.length], x, y, { hpMul: 50, elite: k % 25 === 0 }); }
    w.zone({ team: 1, warn: true, x: p.x + 80, y: p.y - 40, r: 46, dur: 2, k: 'tele', detached: true });
    w.zone({ team: 1, warn: true, x: p.x - 150, y: p.y + 30, len: 140, w: 26, a: 0.4, dur: 2, k: 'tele', detached: true });
    await frames(20);
    e.Game.paused = true; e.FX.clear(); e.FX.shake = 0;
    for (const f of w.foes) f.flash = 0;
    await frames(3);
    return { foes: w.foes.length, zones: w.zones.length };
  };
  // Max-channel diff > 48 share between the gl frame (FBO readback) and the 2d frame (buffer canvas).
  H.parity = async () => {
    const e = E();
    await H.quality('high'); await frames(2);
    const g = e.Batch.readPixels(); if (!g) return { err: 'no gl frame (mode ' + e.Batch.mode + ')' };
    await H.quality('low'); await frames(2);
    const c = e.Render.bctx.getImageData(0, 0, e.Render.bw, e.Render.bh).data;
    if (g.w !== e.Render.bw || g.h !== e.Render.bh) return { err: 'size ' + g.w + 'x' + g.h + ' vs ' + e.Render.bw + 'x' + e.Render.bh };
    let bad = 0, soft = 0, bg = 0; const N = g.w * g.h, b0 = c[0], b1 = c[1], b2 = c[2];
    for (let i = 0; i < N * 4; i += 4) {
      const d = Math.max(Math.abs(g.data[i] - c[i]), Math.abs(g.data[i + 1] - c[i + 1]), Math.abs(g.data[i + 2] - c[i + 2]));
      if (d > 48) bad++; if (d > 6) soft++;
      if (g.data[i] === b0 && g.data[i + 1] === b1 && g.data[i + 2] === b2) bg++;
    }
    return { diff: bad / N, soft: soft / N, flat: bg / N, w: g.w, h: g.h };
  };
  // Draws each feature in its own 24 px box right of the hero (through ED.HeroFx) and reports which boxes changed against a frame without them.
  const FEAT = ['tint+add', 'grey', 'frozen', 'outline', 'pal ramp', 'runtime page', 'img small', 'img large', 'text non-latin', 'ctx bridge', 'cone+ring'];
  H.features = async (keep) => {
    const e = E(), p = e.Game.w.heroes[0], A = e.Atlas, Pix = e.Pix, id = 'hero.knight.idle';
    const small = document.createElement('canvas'); small.width = small.height = 10; const sg = small.getContext('2d'); sg.fillStyle = '#ff2020'; sg.fillRect(0, 0, 10, 10);
    const big = document.createElement('canvas'); big.width = 300; big.height = 220; const bg2 = big.getContext('2d'); bg2.fillStyle = '#20ff40'; bg2.fillRect(0, 0, 300, 220);
    const rt = document.createElement('canvas'); rt.width = rt.height = 12; const rg = rt.getContext('2d'); rg.fillStyle = '#4060ff'; rg.fillRect(0, 0, 12, 12);
    Pix.define('test.rt', rt, 6, 12);
    const pal = Pix.variant(id, 'fire');
    const read = async (on) => {
      e.HeroFx.ranger = on ? (B, h) => {
        const bx = (i) => h.x + 40 + (i % 4) * 24, by = (i) => h.y - 60 + Math.floor(i / 4) * 30;
        B.spr(id, 0, bx(0), by(0), { tint: 0xff4040, add: true });
        B.spr(id, 0, bx(1), by(1), { variant: 'grey' });
        B.spr(id, 0, bx(2), by(2), { variant: 'frozen' });
        B.spr(id, 0, bx(3), by(3), { variant: 'outline:#ff00ff' });
        B.spr(id, 0, bx(4), by(4), { variant: pal || 'none' });
        B.spr('test.rt', 0, bx(5), by(5));
        B.img(small, bx(6) - 5, by(6) - 10, 10, 10);
        B.img(big, bx(7) - 8, by(7) - 16, 16, 12);
        B.text('Ωμ', bx(8), by(8) - 8, 0xffffff, 1);
        const c = B.ctx; c.fillStyle = '#ffff00'; c.fillRect(bx(9) - 6, by(9) - 14, 12, 12);
        B.cone(bx(10), by(10) - 8, 10, -1.2, 1.4, 0x40c0ffff, 2); B.circ(bx(10), by(10) - 8, 6, 0xffffffff, 1);
      } : undefined;
      await frames(3);
      const R = e.Render;
      let px;
      if (e.Batch.mode === 'gl') px = e.Batch.readPixels(); else px = { w: R.bw, h: R.bh, data: R.bctx.getImageData(0, 0, R.bw, R.bh).data };
      return { px, cx: R.camX, cy: R.camY, hx: p.x, hy: p.y };
    };
    const a = await read(false), b = await read(true);
    if (!keep) e.HeroFx.ranger = undefined;
    const out = {};
    FEAT.forEach((name, i) => {
      const x0 = Math.round(b.hx + 40 + (i % 4) * 24 - 11 - b.cx), y0 = Math.round(b.hy - 60 + Math.floor(i / 4) * 30 - 22 - b.cy);
      let ch = 0;
      for (let y = y0; y < y0 + 26; y++) for (let x = x0; x < x0 + 22; x++) {
        if (x < 0 || y < 0 || x >= b.px.w || y >= b.px.h) continue;
        const o = (y * b.px.w + x) * 4;
        if (Math.abs(a.px.data[o] - b.px.data[o]) + Math.abs(a.px.data[o + 1] - b.px.data[o + 1]) + Math.abs(a.px.data[o + 2] - b.px.data[o + 2]) > 30) ch++;
      }
      out[name] = ch;
    });
    return { mode: e.Batch.mode, pal: pal, changed: out };
  };
  H.lose = async () => {
    const e = E(), x = e.Post.gl().getExtension('WEBGL_lose_context'); if (!x) return { skip: true };
    x.loseContext(); await frames(4); const lost = e.Batch.mode;
    x.restoreContext(); await frames(12);
    return { lost, back: e.Batch.mode };
  };
  // Holds 900 foes, 600 projectiles and 400 gems in view (unpaused sim, god hero) and measures msec of frames.
  H.crowd = (msec) => new Promise((resolve) => {
    const e = E(), w = e.Game.w, p = w.heroes[0], ids = w.sdef.timeline[0].roster.map(r => r[0]);
    e.Game.paused = false;
    const top = () => {
      for (let k = 0; w.foes.length < 900 && k < 400; k++) { const a = Math.random() * 6.283, d = 30 + Math.random() * 300, x = p.x + Math.cos(a) * d * 1.3, y = p.y + Math.sin(a) * d * 0.6; if (!e.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ids[k % ids.length], x, y, { hpMul: 400 }); }
      while (w.projs.length < 600) { const a = Math.random() * 6.283, d = Math.random() * 280; w.shoot(p, p.weapons[0].id, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.6, Math.random() * 6.283, null, { look: 'arrow', dmg: 1, speed: 60, pierce: 9999, rehit: 0.5, life: 4 }); }
      let gems = 0; for (const g of w.pickups) if (g.k[0] === 'x') gems++;
      let tele = 0; for (const z of w.zones) if (z.warn && z.team === 1 && !z.dead) tele++;
      if (tele < 2) { const a = Math.random() * 6.283; w.zone({ team: 1, warn: true, x: p.x + Math.cos(a) * 90, y: p.y + Math.sin(a) * 50, r: 50, dur: 2.5, detached: true }); w.zone({ team: 1, warn: true, x: p.x - 40, y: p.y + 20, len: 200, w: 24, a: a, dur: 2.5, detached: true }); }
      for (; gems < 400; gems++) { const a = Math.random() * 6.283, d = 90 + Math.random() * 220; w.spawnPickup('xp1', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.55, 1); }
    };
    top();
    const iv = setInterval(top, 50);
    const fr = [], rm = [], dr = [], ins = [], fo = [], pj = [], gm = [];
    let last = performance.now(), warm = 60;
    const t0 = last;
    const step = (now) => {
      if (warm > 0) { warm--; last = now; requestAnimationFrame(step); return; }
      fr.push(now - last); last = now; rm.push(e.Render.ms); dr.push(e.Batch.stats.draws); ins.push(e.Batch.stats.inst); fo.push(e.Render.crowd); pj.push(w.projs.length); gm.push(w.pickups.length);
      if (now - t0 < msec) { requestAnimationFrame(step); return; }
      clearInterval(iv);
      const st = (a) => { const s = a.slice().sort((x, y) => x - y); return [s[Math.floor(s.length * 0.5)], s[Math.floor(s.length * 0.95)], s[s.length - 1]].map(v => +v.toFixed(2)); };
      const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
      resolve({ mode: e.Batch.mode, frames: fr.length, frame: st(fr), render: st(rm), draws: avg(dr), inst: avg(ins), onScreen: avg(fo), projs: avg(pj), pickups: avg(gm) });
    };
    requestAnimationFrame(step);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  delete process.env.PWDEBUG;
  const pw = loadPlaywright(), srv = await serve(), base = 'http://127.0.0.1:' + srv.address().port;
  const args = ['--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
  if (!SOFT) args.push('--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist');
  const browser = await pw.chromium.launch({ headless: true, args });
  let fails = 0;
  const out = { browser: browser.version() }, errors = [];
  const fail = (m) => { fails++; console.log('FAIL ' + m); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await ctx.addInitScript({ content: '(' + inPage.toString() + ')()' });
    await ctx.route(u => u.protocol.startsWith('http') && u.origin !== base, r => r.abort('blockedbyclient'));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e && e.stack || e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const call = (m, ...a) => page.evaluate(([n, x]) => window.__GL[n](...x), [m, a]);
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    out.boot = await call('boot');
    console.log(`check-gl: chromium ${out.browser}, post ${out.boot.post}${out.boot.soft ? ' (software)' : ''}, webgl2 ${out.boot.gl2}`);
    await call('start', 'ranger');
    // 1. backend selection
    const hi = await call('quality', 'high'), lo = await call('quality', 'low');
    out.backend = { high: hi, low: lo };
    console.log(`backend: high -> ${hi.mode}${hi.err ? ' (' + hi.err + ')' : ''}, low -> ${lo.mode}`);
    const hw = out.boot.post && !out.boot.soft;
    if (hw && hi.mode !== 'gl') fail('quality high on a hardware context did not select the gl batch');
    if (lo.mode !== '2d') fail('quality low did not select the 2d batch');
    // 2. parity
    out.scene = await call('scene', 120);
    if (hw) {
      const p = await call('parity');
      out.parity = p;
      if (p.err) fail('parity: ' + p.err);
      else {
        console.log(`parity: ${(p.diff * 100).toFixed(2)} % pixels differ (> 48), ${(p.soft * 100).toFixed(2)} % (> 6), ${(p.flat * 100).toFixed(1)} % flat background, ${p.w}x${p.h}`);
        if (p.diff > PARITY) fail(`gl and 2d frames differ on ${(p.diff * 100).toFixed(2)} % of pixels (> ${PARITY * 100} %)`);
        if (p.flat > 0.9) fail('gl frame is nearly empty');
      }
      await call('quality', 'high');
      await page.screenshot({ path: path.join(OUT, 'check-gl-scene-gl.png') });
      await call('quality', 'low');
      await page.screenshot({ path: path.join(OUT, 'check-gl-scene-2d.png') });
    }
    // 3. features
    for (const q of hw ? ['high', 'low'] : ['low']) {
      await call('quality', q);
      const f = await call('features', true);
      await page.screenshot({ path: path.join(OUT, 'check-gl-features-' + f.mode + '.png'), clip: { x: 960, y: 300, width: 420, height: 260 } });
      await page.evaluate(() => { window.ED.HeroFx.ranger = undefined; });
      const miss = Object.keys(f.changed).filter(k => f.changed[k] < 4);
      console.log(`features ${f.mode}: ${miss.length ? 'missing ' + miss.join(', ') : 'all ' + Object.keys(f.changed).length + ' drawn'} (pal ramp key '${f.pal}')`);
      out['features_' + f.mode] = f;
      if (miss.length) fail(`${f.mode} backend did not draw: ${miss.join(', ')}`);
    }
    // 4. context loss
    if (hw) {
      await call('quality', 'high');
      const l = await call('lose');
      out.lose = l;
      if (!l.skip) { console.log(`context loss: lost -> ${l.lost}, restored -> ${l.back}`); if (l.lost !== '2d' || l.back !== 'gl') fail('context loss did not fall back to 2d and return to gl'); }
    }
    // 5. crowd900
    out.crowd = {};
    for (const q of hw ? ['high', 'low'] : ['low']) {
      await call('quality', q);
      const r = await call('crowd', SECS * 1000);
      out.crowd[q] = r;
      console.log(`crowd900 ${r.mode}: on screen ${r.onScreen} foes, ${r.projs} projectiles, ${r.pickups} pickups; render ms p50/p95/max ${r.render.join('/')}, frame ms ${r.frame.join('/')}${r.mode === 'gl' ? `, ${r.draws} draws, ${r.inst} instances` : ''}`);
      await page.screenshot({ path: path.join(OUT, 'check-gl-crowd-' + r.mode + '.png') });
      await page.evaluate(() => { window.ED.Game.paused = true; });
    }
    await ctx.close();
    // 6. webgl1
    if (hw) {
      const c1 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await c1.addInitScript({ content: 'window.ED_GL1 = true;(' + inPage.toString() + ')()' });
      await c1.route(u => u.protocol.startsWith('http') && u.origin !== base, r => r.abort('blockedbyclient'));
      const p1 = await c1.newPage();
      p1.on('pageerror', e => errors.push('webgl1: ' + String(e && e.stack || e).slice(0, 300)));
      p1.on('console', m => { if (m.type() === 'error') errors.push('webgl1: ' + m.text().slice(0, 300)); });
      const c = (m, ...a) => p1.evaluate(([n, x]) => window.__GL[n](...x), [m, a]);
      await p1.goto(base + '/index.html', { waitUntil: 'load' });
      const b1 = await c('boot');
      await c('start', 'ranger');
      const m = await c('quality', 'high');
      await c('scene', 120);
      const par = await c('parity');
      await c('quality', 'high');
      const f = await c('features');
      const miss = Object.keys(f.changed).filter(k => f.changed[k] < 4);
      out.webgl1 = { boot: b1, mode: m, parity: par, features: f };
      console.log(`webgl1: webgl2 ${b1.gl2}, high -> ${m.mode}, parity ${par.err || (par.diff * 100).toFixed(2) + ' %'}, features ${miss.length ? 'missing ' + miss.join(', ') : 'all drawn'}`);
      if (b1.gl2 || m.mode !== 'gl') fail('webgl1 page did not run the gl batch on WebGL1');
      if (par.err || par.diff > PARITY) fail('webgl1 parity: ' + (par.err || par.diff));
      if (miss.length) fail('webgl1 features missing: ' + miss.join(', '));
      await c1.close();
    }
  } finally { await browser.close(); srv.close(); }
  if (errors.length) { fail(errors.length + ' page error(s)'); for (const e of errors.slice(0, 10)) console.log('  ' + e); }
  out.errors = errors;
  fs.writeFileSync(path.join(OUT, 'result-gl.json'), JSON.stringify(out, null, 1));
  console.log(`check-gl: ${fails ? fails + ' failure(s)' : 'pass'} (screens in ${OUT})`);
  return fails ? 1 : 0;
}
main().then(c => { process.exitCode = c; }, e => { console.error('check-gl: ' + (e && e.stack || e)); process.exitCode = 2; });
