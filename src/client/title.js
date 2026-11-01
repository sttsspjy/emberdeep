// Title screen art (client only): the pixel wordmark (title.logo, title.flame on its wick, wax drops falling from the long drips) and the backdrop
//   (stage-1 floor fading into darkness, the unlocked heroes in a candle-lit arc flanking the menu panel, rising embers, foe eyes blinking at the edges).
// Both canvases draw art px and are upscaled by an integer device-px factor (CSS image-rendering: pixelated); they are menu scenes (ED.UI.addScene), so they redraw
//   only while the title shows. Backdrop 30 fps (Low quality: 15 fps, fewer embers); prefers-reduced-motion: one still frame per fit.
// ED.Title.mount() (UI.renderTitle): rebuilds the hero lineup and refits on the next frame; ED.Title.perf() -> { bg, logo } mean draw ms.
(function (ED) {
  'use strict';
  const U = ED.U, $ = (id) => document.getElementById(id);
  const Ti = ED.Title = {};
  const LOGO_TOP = 9, LOGO_BOT = 14; // art px above the wordmark (flame) and below it (falling drops; overlapped by the kicker)
  const BG_ART_W = 380; // backdrop width in art px the integer scale aims at
  const EMBERS = 48, EMBERS_LOW = 18, EYES = 7;
  const rm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const still = () => !!(rm && rm.matches);
  const low = () => !!(ED.Render && ED.Render.quality === 'low');
  const dprOf = () => window.devicePixelRatio || 1;
  // Small seeded generator (stable frames for screenshots; client-only art).
  let seed = 0x2f6e2b1;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const perf = { bg: 0, bgN: 0, logo: 0, logoN: 0 };
  Ti.perf = () => ({ bg: perf.bgN ? +(perf.bg / perf.bgN).toFixed(3) : 0, logo: perf.logoN ? +(perf.logo / perf.logoN).toFixed(3) : 0 });

  // ---------------- wordmark ----------------
  const LG = { cv: null, g: null, k: 0, dirty: true, tick: -1, drop: null, next: 2.5, lastT: 0 };
  // Integer scale: about 56% of the viewport width, lowered until the title screen fits without scrolling.
  function fitLogo() {
    const A = ED.Atlas, r = A.anim('title.logo'), cv = LG.cv, scr = $('scr-title');
    LG.dirty = false;
    if (!r) return;
    const W = r.fw, H = LOGO_TOP + r.fh + LOGO_BOT, d = dprOf();
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const size = (k) => { const s = cv.style; s.width = (W * k / d) + 'px'; s.height = (H * k / d) + 'px'; s.marginBottom = (-(LOGO_BOT - 1) * k / d) + 'px'; };
    const wk = r.anchors.wick, h1 = cv.parentNode.style; // flame halo centre (CSS vars of h1.logo::after)
    h1.setProperty('--fx', ((wk[0] + 0.5) * 100 / W).toFixed(2) + '%'); h1.setProperty('--fy', ((LOGO_TOP + wk[1] - 4) * 100 / H).toFixed(2) + '%');
    let k = Math.max(2, Math.floor(0.56 * scr.clientWidth * d / W));
    for (; k > 2; k--) { size(k); if (scr.scrollHeight <= scr.clientHeight) break; }
    size(k); LG.k = k; LG.tick = -1;
    BG.dirty = true; // the panel moved
  }
  const DROP_COL = ['#ffd98e', '#e07e34', '#c8622a'], OUT = '#1a0806';
  function drawDrop(g, x, y) {
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = OUT; g.fillRect(x - 1, y, 4, 2); g.fillRect(x, y - 1, 2, 4);
    g.fillStyle = DROP_COL[1]; g.fillRect(x, y, 2, 2);
    g.fillStyle = DROP_COL[0]; g.fillRect(x, y, 1, 1);
    g.fillStyle = DROP_COL[2]; g.fillRect(x + 1, y + 1, 1, 1);
  }
  function drawLogo(t) {
    if (LG.dirty) fitLogo();
    const A = ED.Atlas, r = A.anim('title.logo'); if (!r) return;
    const st = still(), dt = Math.min(0.1, Math.max(0, t - LG.lastT)); LG.lastT = t;
    const drips = r.anchors.drips || [];
    // drops: hang at a drip tip (0.7 s), then fall and thin out
    if (!st && drips.length) {
      if (!LG.drop && (LG.next -= dt) <= 0) LG.drop = { i: Math.floor(rnd() * drips.length), y: 0, v: 0, hang: 0.7 };
      const dp = LG.drop;
      if (dp) { if (dp.hang > 0) dp.hang -= dt; else { dp.v += 70 * dt; dp.y += dp.v * dt; } if (dp.y > LOGO_BOT - 3) { LG.drop = null; LG.next = 3 + rnd() * 4; } }
    }
    const fr = st ? 0 : A.frameAt('title.flame', t), tick = st ? 0 : LG.drop ? Math.floor(t * 30) : fr;
    if (tick === LG.tick) return;
    LG.tick = tick;
    const t0 = performance.now(), g = LG.g, cv = LG.cv, wk = r.anchors.wick;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false;
    A.draw(g, 'title.logo', 0, 0, LOGO_TOP);
    A.draw(g, 'title.flame', fr, wk[0], LOGO_TOP + wk[1]);
    const dp = LG.drop;
    if (dp) { const p = drips[dp.i]; if (dp.hang > 0.35) { g.fillStyle = DROP_COL[1]; g.fillRect(p[0], LOGO_TOP + p[1] - 1, 2, 1); } else drawDrop(g, p[0], LOGO_TOP + p[1] - 1 + dp.y); }
    perf.logo += performance.now() - t0; perf.logoN++;
  }

  // ---------------- backdrop ----------------
  const BG = { cv: null, g: null, k: 0, W: 0, H: 0, dirty: true, tick: -1, lastT: 0, floor: null, shade: null, pool: null, dark: null, heroes: [], candles: [], panel: null, logoBox: null };
  const EM = { x: new Float32Array(EMBERS), y: new Float32Array(EMBERS), vy: new Float32Array(EMBERS), ph: new Float32Array(EMBERS), life: new Float32Array(EMBERS), max: new Float32Array(EMBERS) };
  const EY = Array.from({ length: EYES }, () => ({ x: 0, y: 0, gap: 3, col: 0, st: 0, t: 0, dur: 0, blink: 0 }));
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const q = (v, x, y, n) => { const s = v * n, f = Math.floor(s); return Math.min(n, f + (s - f > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0)) / n; }; // ordered dither of v (0..1) to n steps
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const artRect = (el, d, k) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width ? { x0: b.left * d / k, y0: b.top * d / k, x1: b.right * d / k, y1: b.bottom * d / k } : null; };
  // Hero arc: alternating left / right of the panel, stepping outward and up (a ring seen from the front); candles between and beside them.
  function placeLineup() {
    const W = BG.W, H = BG.H, pn = BG.panel || { x0: W * 0.36, x1: W * 0.64, y1: H * 0.9 }, n = BG.heroes.length;
    const base = H - Math.max(9, Math.round(H * 0.075)), perSide = Math.max(1, Math.ceil(n / 2));
    const room = Math.max(40, Math.min(pn.x0, W - pn.x1) - 14), step = Math.max(17, Math.min(28, Math.floor(room / (perSide + 0.6))));
    BG.candles.length = 0;
    BG.heroes.forEach((h) => {
      const i = h.n, side = i % 2 ? 1 : -1, j = i >> 1, edge = side < 0 ? pn.x0 : pn.x1;
      h.x = Math.round(edge + side * (12 + j * step)); h.y = base - j * 6; h.flip = side > 0; h.off = i * 0.37;
    });
    BG.heroes.sort((a, b) => a.y - b.y); // back to front
    for (const side of [-1, 1]) {
      const edge = side < 0 ? pn.x0 : pn.x1, cnt = Math.max(1, BG.heroes.filter((h) => (h.n % 2 ? 1 : -1) === side).length);
      for (let j = 0; j <= cnt; j++) BG.candles.push({ x: Math.round(edge + side * (12 + (j - 0.5) * step)), y: base - j * 6 + 7, h: 3 + ((j * 7 + (side > 0 ? 3 : 0)) % 4), ph: rnd() * 6 });
    }
    BG.light = { x: W / 2, y: base - 4, rx: Math.max(W * 0.3, Math.abs(BG.candles.reduce((m, c) => Math.max(m, Math.abs(c.x - W / 2)), 0)) + 34), ry: 0 };
    BG.light.ry = Math.min(H * 0.62, BG.light.rx * 0.62);
  }
  // Stage-1 floor with sparse decor and a few props in the outer dark; cached at art size.
  function buildFloor() {
    const A = ED.Atlas, W = BG.W, H = BG.H, th = ED.STAGES[0].theme, c = BG.floor = mkCanvas(W, H), g = c.getContext('2d');
    g.imageSmoothingEnabled = false; g.fillStyle = th.pal.bg; g.fillRect(0, 0, W, H);
    let tot = 0; for (const f of th.floor) tot += f[1];
    for (let ty = 0; ty * 16 < H; ty++) for (let tx = 0; tx * 16 < W; tx++) {
      let r = U.hash3(tx, ty, 91) % tot, id = th.floor[0][0];
      for (const f of th.floor) { r -= f[1]; if (r < 0) { id = f[0]; break; } }
      A.draw(g, id, 0, tx * 16, ty * 16);
    }
    const deco = th.deco.filter((d) => !/candle/.test(d)), nd = Math.round(W * H / 5200);
    const lb = BG.logoBox;
    for (let k = 0; k < nd; k++) {
      const x = 6 + U.hash3(k, 1, 17) % (W - 12), y = 10 + U.hash3(k, 2, 17) % (H - 14);
      if (lb && x > lb.x0 - 12 && x < lb.x1 + 12 && y < lb.y1 + 24) continue; // keep the wordmark's backdrop clean
      A.draw(g, deco[U.hash3(k, 3, 17) % deco.length], 0, x, y);
    }
    const PROPS = ['prop.pillar', 'prop.grave.0', 'prop.pillar.broken', 'prop.grave.2', 'prop.coffin', 'prop.grave.1'];
    PROPS.forEach((id, k) => { if (!A.has(id)) return; const side = k % 2 ? 1 : -1, fx = 0.05 + 0.09 * ((k >> 1) % 2) + 0.02 * (k >> 2); A.draw(g, id, 0, Math.round(side < 0 ? W * fx : W * (1 - fx)), Math.round(H * (0.38 + 0.13 * (k >> 1)))); });
  }
  // Darkness (black, dithered alpha) and the warm candle pool (additive), from the main ring light and each candle.
  function buildLight() {
    const W = BG.W, H = BG.H, L = BG.light, cs = BG.candles, n = W * H;
    if (!BG.dark || BG.dark.length !== n) BG.dark = new Float32Array(n);
    const sh = BG.shade = mkCanvas(W, H), pl = BG.pool = mkCanvas(W, H), sg = sh.getContext('2d'), pg = pl.getContext('2d');
    const si = sg.createImageData(W, H), pi = pg.createImageData(W, H), sd = si.data, pd = pi.data, lb = BG.logoBox;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - L.x) / L.rx, dy = (y - L.y) / L.ry; let lit = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)); lit *= lit;
      for (let k = 0; k < cs.length; k++) { const c = cs[k], ex = (x - c.x) / 30, ey = (y - c.y + 4) / 20, v = 1 - Math.sqrt(ex * ex + ey * ey); if (v > 0) lit = Math.max(lit, v * v * 0.85); }
      if (lb) { const ex = (x - (lb.x0 + lb.x1) / 2) / ((lb.x1 - lb.x0) * 0.7), ey = (y - (lb.y0 + lb.y1) / 2) / ((lb.y1 - lb.y0) * 1.1), v = 1 - Math.sqrt(ex * ex + ey * ey); if (v > 0) lit = Math.max(lit, v * 0.32); }
      const ex = Math.min(x, W - 1 - x) / (W * 0.16), vig = Math.min(1, ex), i = y * W + x;
      lit *= 0.35 + 0.65 * vig;
      const dark = 1 - Math.min(1, lit); BG.dark[i] = dark;
      sd[i * 4 + 3] = Math.round(255 * q(0.12 + 0.86 * dark, x, y, 7));
      const w = q(Math.min(1, lit * 1.1), x, y, 6);
      pd[i * 4] = 255; pd[i * 4 + 1] = 128; pd[i * 4 + 2] = 48; pd[i * 4 + 3] = Math.round(120 * w * w);
    }
    sg.putImageData(si, 0, 0); pg.putImageData(pi, 0, 0);
  }
  function fitBg() {
    const cv = BG.cv, scr = $('scr-title'), d = dprOf(), vw = scr.clientWidth, vh = scr.clientHeight;
    BG.dirty = false;
    if (!vw || !vh) return;
    const k = BG.k = Math.max(2, Math.round(vw * d / BG_ART_W)), W = BG.W = Math.ceil(vw * d / k), H = BG.H = Math.ceil(vh * d / k);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    cv.style.width = (W * k / d) + 'px'; cv.style.height = (H * k / d) + 'px';
    BG.panel = artRect(scr.querySelector('.title-panel'), d, k);
    BG.logoBox = artRect(LG.cv, d, k);
    if (BG.logoBox) BG.logoBox.y1 -= (LOGO_BOT - 1) * LG.k / k; // the drop margin hangs over the kicker
    placeLineup(); buildFloor(); buildLight();
    for (let i = 0; i < EMBERS; i++) spawnEmber(i, true);
    for (const e of EY) { placeEye(e); e.st = rnd() < 0.5 ? 2 : 0; e.t = rnd() * 3; e.dur = 2 + rnd() * 3; }
    BG.tick = -1;
  }
  function spawnEmber(i, any) {
    const cs = BG.candles, W = BG.W, H = BG.H;
    if (cs.length && rnd() < 0.6) { const c = cs[Math.floor(rnd() * cs.length)]; EM.x[i] = c.x + (rnd() - 0.5) * 10; EM.y[i] = c.y - 6 - rnd() * 4; }
    else { EM.x[i] = rnd() * W; EM.y[i] = H * (0.75 + rnd() * 0.3); }
    EM.vy[i] = 7 + rnd() * 13; EM.ph[i] = rnd() * 6.28; EM.max[i] = 3 + rnd() * 6; EM.life[i] = any ? rnd() * EM.max[i] : 0;
    if (any) EM.y[i] -= EM.vy[i] * EM.life[i];
  }
  // Eyes take a dark spot outside the panel and the wordmark.
  function placeEye(e) {
    const W = BG.W, H = BG.H, pn = BG.panel, lb = BG.logoBox;
    for (let k = 0; k < 24; k++) {
      const x = 3 + Math.floor(rnd() * (W - 9)), y = Math.floor(H * (0.12 + rnd() * 0.66));
      if (pn && x > pn.x0 - 8 && x < pn.x1 + 8 && y > pn.y0 - 8) continue;
      if (lb && x > lb.x0 - 6 && x < lb.x1 + 6 && y > lb.y0 - 6 && y < lb.y1 + 6) continue;
      if (BG.dark[y * W + x] < 0.82) continue;
      e.x = x; e.y = y; e.gap = rnd() < 0.3 ? 4 : 3; e.col = rnd() < 0.25 ? 1 : 0; return;
    }
    e.x = -10;
  }
  const EYE_COL = [['#4a0c08', '#a01c12', '#ff4430'], ['#3a2a06', '#8a6a10', '#ffd040']];
  const EMB_COL = ['#7a2a10', '#d8541c', '#ff9a3d', '#ffe9a0'];
  function stepBg(dt) {
    const n = low() ? EMBERS_LOW : EMBERS;
    for (let i = 0; i < n; i++) {
      EM.life[i] += dt; EM.y[i] -= EM.vy[i] * dt;
      if (EM.life[i] >= EM.max[i] || EM.y[i] < -2) spawnEmber(i, false);
    }
    for (const e of EY) { // st: 0 hidden, 1 opening, 2 open, 3 closing
      e.t += dt;
      if (e.st === 2 && (e.blink -= dt) < -0.14) e.blink = 1.5 + rnd() * 3;
      if (e.t < e.dur) continue;
      e.t = 0;
      if (e.st === 0) { placeEye(e); e.st = 1; e.dur = 0.5; }
      else if (e.st === 1) { e.st = 2; e.dur = 2.5 + rnd() * 4; e.blink = 1 + rnd() * 2; }
      else if (e.st === 2) { e.st = 3; e.dur = 0.5; }
      else { e.st = 0; e.dur = 1.5 + rnd() * 4; }
    }
  }
  const SHADOW = 'rgba(0,0,0,0.45)';
  // Candle c (feet at c.x, c.y; c.h wax px): a 2 px wax stick, wick, and a 1-2 px flame that flickers.
  const CAN = ['#1a0c10', '#fff6dc', '#e2c08f', '#a8764e', '#2e1a12', '#ffd866', '#ff9a34', '#fffbe8'];
  function drawCandle(g, c, t) {
    const x = c.x - 1, y = c.y - c.h, f = Math.floor(t * 8 + c.ph * 3) % 3;
    g.fillStyle = CAN[0]; g.fillRect(x - 1, y, 4, c.h + 1); g.fillRect(x, y - 1, 2, c.h + 3);
    g.fillStyle = CAN[2]; g.fillRect(x, y, 2, c.h);
    g.fillStyle = CAN[3]; g.fillRect(x + 1, y + 1, 1, c.h - 1);
    g.fillStyle = CAN[1]; g.fillRect(x, y, 1, 1);
    g.fillStyle = CAN[4]; g.fillRect(x + 1, y - 1, 1, 1);
    g.fillStyle = CAN[6]; g.fillRect(x + (f === 2 ? 0 : 1), y - 3, 1, 2);
    g.fillStyle = f === 1 ? CAN[7] : CAN[5]; g.fillRect(x + (f === 2 ? 0 : 1), y - 2 - (f === 0 ? 1 : 0), 1, 1);
    if (f === 0) { g.fillStyle = CAN[6]; g.fillRect(x + 1, y - 4, 1, 1); }
  }
  function drawBg(t) {
    if (BG.dirty) fitBg();
    if (!BG.W) return;
    const st = still(), fps = low() ? 15 : 30, tick = st ? 0 : Math.floor(t * fps);
    if (tick === BG.tick) return;
    const dt = BG.tick < 0 ? 0 : Math.min(0.1, Math.max(0, t - BG.lastT)); BG.tick = tick; BG.lastT = t;
    if (!st) stepBg(dt);
    const t0 = performance.now(), A = ED.Atlas, g = BG.g, W = BG.W, H = BG.H;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(BG.floor, 0, 0);
    g.drawImage(BG.shade, 0, 0);
    const tt = st ? 0 : t;
    g.fillStyle = SHADOW;
    for (const h of BG.heroes) { g.fillRect(h.x - 6, h.y - 1, 12, 2); g.fillRect(h.x - 4, h.y + 1, 8, 1); }
    for (const c of BG.candles) drawCandle(g, c, tt);
    for (const h of BG.heroes) { h.o.flip = h.flip; A.draw(g, h.id, A.frameAt(h.id, tt + h.off), h.x, h.y, h.o); }
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = st ? 0.85 : 0.78 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) + 0.06 * Math.sin(t * 13.7);
    g.drawImage(BG.pool, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    const n = low() ? EMBERS_LOW : EMBERS;
    for (let i = 0; i < n; i++) {
      const f = EM.life[i] / EM.max[i], x = Math.round(EM.x[i] + Math.sin(EM.ph[i] + EM.life[i] * 2.2) * 2.5), y = Math.round(EM.y[i]);
      g.fillStyle = EMB_COL[f < 0.2 ? 3 : f < 0.55 ? 2 : f < 0.85 ? 1 : 0]; g.fillRect(x, y, 1, 1);
    }
    for (const e of EY) {
      if (e.st === 0 || e.x < 0 || (e.st === 2 && e.blink < 0)) continue;
      const lv = e.st === 2 ? 2 : Math.min(2, Math.floor((e.st === 1 ? e.t / e.dur : 1 - e.t / e.dur) * 3)), cols = EYE_COL[e.col];
      g.fillStyle = cols[lv]; g.fillRect(e.x, e.y, 1, 1); g.fillRect(e.x + e.gap, e.y, 1, 1);
      if (lv === 2) { g.fillStyle = cols[0]; g.fillRect(e.x, e.y + 1, 1, 1); g.fillRect(e.x + e.gap, e.y + 1, 1, 1); }
    }
    perf.bg += performance.now() - t0; perf.bgN++;
  }

  // ---------------- mount ----------------
  let bound = false;
  Ti.mount = () => {
    const UI = ED.UI, A = ED.App, p = A && A.profile;
    if (!LG.cv) {
      LG.cv = $('title-logo'); LG.g = LG.cv.getContext('2d'); LG.cv._scene = drawLogo;
      BG.cv = $('title-bg'); BG.g = BG.cv.getContext('2d'); BG.cv._scene = drawBg;
    }
    if (!bound) {
      bound = true;
      const dirty = () => { LG.dirty = true; BG.dirty = true; };
      window.addEventListener('resize', dirty);
      if (rm && rm.addEventListener) rm.addEventListener('change', dirty);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(dirty);
    }
    BG.heroes = ED.HERO_IDS.filter((c) => ED.HEROES[c] && p && UI.M.heroOpen(p, c)).map((c, n) => ({ id: UI.heroIcon(c), n, x: 0, y: 0, off: 0, flip: false, o: { flip: false, variant: UI.heroVar(c) } }));
    LG.dirty = true; BG.dirty = true; LG.tick = -1;
    UI.addScene(BG.cv); UI.addScene(LG.cv);
  };
})(globalThis.ED || (globalThis.ED = {}));
