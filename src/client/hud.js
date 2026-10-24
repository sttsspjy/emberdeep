// Screen-space HUD on its own canvas (#hud) on the UI pixel grid: hero block, ability slots, party, map, xp, boss bar, prompts, signs, messages, banners; panels fade while the world is under them.
// Grid: k = whole canvas px per UI art px (largest k that fits 480 x 270 art px; = ED.PixUI.k at device resolution), f = fine px round(k / 2). Layout lengths follow the rem unit u and snap to k.
// Text: pixel fonts rasterised once per string to a 1-bit mask (one sample per font px) and blown up to n canvas px per font px, so glyphs are crisp on any rasteriser. Panels are PixUI 9-slice frames.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const H = ED.HUD = {};
  // Families with their whole-font-px vertical metrics (src/art/fonts.css: 16 font px per em): b Pixel Operator (400 body, 700 labels, titles and banners).
  const FM = {
    b: { f: '"Pixel Operator", "Segoe UI", system-ui, sans-serif', asc: 13, desc: 3, cap: 9 },
  };
  const K = { line: '#4a3626', brass: '#8a6a42', brassHi: '#c9a063', ember: '#ff8a3d', emberHi: '#ffb56b', gold: '#f0cf8a', bone: '#f6ecda', muted: '#c5b49d', faint: '#8f7f6c', danger: '#ef5a46', good: '#8fdc98', warm: '#ffd9a0', ol: '#222222', sh: '#0b0806', trough: '#120c09', panel: '#17110d' };

  let cv = null, c = null, W = 0, Hh = 0, hd = 1, u = 13, cssW = 0, cssH = 0, lowQ = false, shown = false, dtc = 0, rk = 1, lastDpr = 0;
  let k = 2, f = 1, tS = 1, tV = 1, tT = 2, tB = 2, tJ = 1, tJ2 = 1; // grid (art px, fine px) and text multiples (labels, values, panel titles, banner titles, big banners, centre notes)
  let frameN = 0, drawSeq = 0, lastDrawT = 0, dtAcc = 0, fdt = 0, forceDirty = true; // redraw scheduling (see H.draw)
  const L = {}; // layout rects in canvas px, rebuilt with the grid
  const ghost = {}, slotFx = [];
  // Panel fade: a panel eases to FADE_MIN alpha while a hero, foe or pickup is under it (held FADE_HOLD s after the last overlap), then back. ga = alpha of the panel being drawn.
  const FADE_MIN = 0.35, FADE_RATE = (1 - FADE_MIN) / 0.15, FADE_HOLD = 0.2, FP_MAX = 640;
  const fade = {}, fp = new Float32Array(FP_MAX * 3); // fp: x, y, radius of each world object in canvas px
  let ga = 1, fpN = 0;
  const mk = (w, h) => { const e = document.createElement('canvas'); e.width = Math.max(1, w); e.height = Math.max(1, h); return e; };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const q = (v) => Math.round(v / k) * k; // nearest whole art px
  const qf = (v) => Math.round(v / f) * f; // nearest whole fine px
  const step = (t, hz) => Math.floor(t * hz) & 1; // stepped pulse: 0 / 1 at hz half-periods per second

  // ---------------- cached art ----------------
  // Every cached image is a canvas first and swaps to an ImageBitmap once ready (Gecko pays per source canvas, not per bitmap); entries are { cv, ... } objects released on eviction.
  const Bmp = ED.Bmp, art = new Map(), caps = new Map(), wraps = new Map(), texts = new Map(), wcache = new Map();
  const hold = (e) => { const g = e.cv; Bmp.from(g, (b) => { if (e.dead) Bmp.free(b); else e.cv = b; }); return e; };
  const dropMap = (m) => { for (const e of m.values()) { e.dead = true; Bmp.free(e.cv); } m.clear(); };
  let medal = null, medalKey = '';
  const dropArt = () => { dropMap(art); dropMap(caps); dropMap(texts); wraps.clear(); wcache.clear(); if (medal) { medal.dead = true; Bmp.free(medal.cv); } medal = null; medalKey = ''; forceDirty = true; };
  const readable = (g, w, h) => { try { const d = g.getImageData && g.getImageData(0, 0, w, h); return d && d.data ? d : null; } catch (e) { return null; } };

  // Frame `name` (src/client/uiart.js) as a 9-slice at sc canvas px per art px; a flat plate where the kit is absent (headless checks).
  function frame(g, name, v, x, y, w, h, sc) {
    const P = ED.PixUI;
    if (P && P.frames[name]) { P.nine(g, name, v, x, y, w, h, sc); return; }
    g.fillStyle = K.ol; g.fillRect(x, y, w, h); g.fillStyle = K.panel; g.fillRect(x + sc, y + sc, w - 2 * sc, h - 2 * sc);
  }
  // Rect ring of thickness th inside (x, y, w, h); notched leaves the four corner pixels out.
  function ring(g, x, y, w, h, th, col, notched) {
    const n = notched ? th : 0; g.fillStyle = col;
    g.fillRect(x + n, y, w - 2 * n, th); g.fillRect(x + n, y + h - th, w - 2 * n, th); g.fillRect(x, y + th, th, h - 2 * th); g.fillRect(x + w - th, y + th, th, h - 2 * th);
  }
  // Icon `name` (16 x 16 icon px) at j canvas px per icon px (the icon canvas baked at that size, drawn 1:1).
  const icon = (g, name, col, x, y, j) => g.drawImage(ED.Icons.canvas(name, col, 16 * j), Math.round(x), Math.round(y));
  // Pixel alpha to 0 / 255 (drops soft glows and partial edges of a sprite canvas); no-op where readback is unavailable.
  function binarize(cvs) {
    const g = cvs.getContext('2d'), d = readable(g, cvs.width, cvs.height); if (!d) return;
    const a = d.data; for (let i = 3; i < a.length; i += 4) a[i] = a[i] > 127 ? 255 : 0;
    g.putImageData(d, 0, 0);
  }

  // ---------------- text ----------------
  // 1-bit glyph mask of s (one cell per font px): fillText at TS canvas px per font px, sampled at each cell centre (immune to the rasteriser's sub-pixel origin and horizontal AA).
  const TS = 4, mc = document.createElement('canvas').getContext('2d'); // mc measures at 16 px (1 font px = 1 px)
  let rcv = null, rg = null;
  function maskOf(s, fam, wt) {
    const m = FM[fam], font = wt + ' ' + 16 * TS + 'px ' + m.f;
    if (!rcv) { rcv = mk(256, 64); rg = rcv.getContext('2d', { willReadFrequently: true }); }
    rg.font = font;
    const adv = Math.max(1, Math.round(rg.measureText(s).width / TS)), w = adv + 2, h = m.asc + m.desc, cw = w * TS, ch = h * TS;
    if (rcv.width < cw || rcv.height < ch) { rcv.width = Math.max(rcv.width, cw); rcv.height = Math.max(rcv.height, ch); }
    rg.font = font; rg.textBaseline = 'alphabetic'; rg.textAlign = 'left'; rg.clearRect(0, 0, cw, ch); rg.fillStyle = '#fff';
    rg.fillText(s, TS, m.asc * TS);
    const id = readable(rg, cw, ch); if (!id) return null;
    const d = id.data, a = new Uint8Array(w * h), o = TS >> 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = d[((y * TS + o) * cw + x * TS + o) * 4 + 3] > 127 ? 1 : 0;
    return { a, w, h, adv };
  }
  const rgbs = new Map();
  function rgbaOf(col) {
    let v = rgbs.get(col); if (v) return v;
    mc.fillStyle = '#000'; mc.fillStyle = col; const s = String(mc.fillStyle);
    let m;
    if (s[0] === '#') v = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
    else if ((m = /rgba?\(([^)]+)\)/.exec(s))) { const p = m[1].split(',').map(Number); v = [p[0], p[1], p[2], Math.round((p[3] === undefined ? 1 : p[3]) * 255)]; }
    else v = [255, 255, 255, 255];
    rgbs.set(col, v); return v;
  }
  // Text sprite of s at n canvas px per font px. fx: 0 hard drop shadow (1 font px down), 1 outline (8 neighbours), 2 none.
  // Returns { cv, w, h, ox (glyph origin x), base (baseline y), adv }.
  function textArt(s, n, col, fam, wt, fx) {
    const key = fam + wt + '|' + n + '|' + col + '|' + fx + '|' + s; let e = texts.get(key); if (e) return e;
    if (texts.size > 450) dropMap(texts);
    const m = FM[fam], M = maskOf(s, fam, wt);
    if (!M) { // no readback (headless checks): plain canvas text
      mc.font = wt + ' ' + 16 * n + 'px ' + m.f; const ad = mc.measureText(s).width, cvs = mk(Math.ceil(ad) + 4 * n, (m.asc + m.desc + 2) * n), g = cvs.getContext('2d');
      g.font = mc.font; g.textBaseline = 'alphabetic'; g.fillStyle = col; g.fillText(s, 2 * n, (m.asc + 1) * n);
      e = hold({ cv: cvs, w: cvs.width, h: cvs.height, ox: 2 * n, base: (m.asc + 1) * n, adv: ad }); texts.set(key, e); return e;
    }
    const mw = M.w + 2, mh = M.h + 2, cw = mw * n, ch = mh * n, cvs = mk(cw, ch), g = cvs.getContext('2d'), img = g.createImageData(cw, ch), px = img.data;
    const ink = (x, y) => (x >= 1 && y >= 1 && x <= M.w && y <= M.h ? M.a[(y - 1) * M.w + x - 1] : 0);
    const fc = rgbaOf(col), sc = rgbaOf(K.sh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      let p = null;
      if (ink(x, y)) p = fc;
      else if (fx === 1 ? ink(x - 1, y - 1) || ink(x, y - 1) || ink(x + 1, y - 1) || ink(x - 1, y) || ink(x + 1, y) || ink(x - 1, y + 1) || ink(x, y + 1) || ink(x + 1, y + 1) : fx === 0 && ink(x, y - 1)) p = sc;
      if (!p) continue;
      for (let yy = y * n; yy < y * n + n; yy++) for (let xx = x * n; xx < x * n + n; xx++) { const i = (yy * cw + xx) * 4; px[i] = p[0]; px[i + 1] = p[1]; px[i + 2] = p[2]; px[i + 3] = p[3]; }
    }
    g.putImageData(img, 0, 0);
    e = hold({ cv: cvs, w: cw, h: ch, ox: 2 * n, base: (m.asc + 1) * n, adv: M.adv * n }); texts.set(key, e); return e;
  }
  // Draws s into context g with its cap height centred on y; al: 'left' (x = glyph origin), 'center', 'right'. n: px of g per font px (whole, so glyphs stay crisp). Returns the advance in px of g.
  // Shared with other canvases (aim.js landing labels); the sprite lives in the HUD text cache.
  H.pixText = (g, s, x, y, n, col, fam, al, wt, fx) => {
    s = String(s); fam = fam || 'b';
    const e = textArt(s, n, col, fam, wt || 700, fx === undefined ? 0 : fx), gx = al === 'center' ? x - e.adv / 2 : al === 'right' ? x - e.adv : x;
    g.drawImage(e.cv, Math.round(gx) - e.ox, Math.round(y + FM[fam].cap * n / 2) - e.base);
    return e.adv;
  };
  const T = (s, x, y, n, col, fam, al, wt, fx) => H.pixText(c, s, x, y, n, col, fam, al, wt, fx);
  // Advance width of s at n canvas px per font px (cached per string and font).
  function adv(s, n, wt, fam) {
    const m = FM[fam || 'b'], fnt = (wt || 700) + ' 16px ' + m.f, key = fnt + '|' + s; let w = wcache.get(key);
    if (w === undefined) { if (wcache.size > 800) wcache.clear(); mc.font = fnt; w = Math.round(mc.measureText(s).width); wcache.set(key, w); }
    return w * n;
  }
  // Word-wrap to maxW px, at most maxLines (last line gets an ellipsis). Cached per string and size.
  function wrap(s, maxW, n, wt, maxLines) {
    const key = s + '|' + Math.round(maxW) + '|' + n + '|' + (wt || 700) + '|' + (maxLines || 0); let r = wraps.get(key); if (r) return r;
    if (wraps.size > 160) wraps.clear();
    const A = (t) => adv(t, n, wt);
    r = []; let cur = '';
    for (const w of String(s).split(' ')) { const t = cur ? cur + ' ' + w : w; if (A(t) > maxW && cur) { r.push(cur); cur = w; } else cur = t; }
    if (cur) r.push(cur);
    if (maxLines && r.length > maxLines) { r.length = maxLines; let l = r[maxLines - 1]; while (l.length > 1 && A(l + '…') > maxW) l = l.slice(0, -1); r[maxLines - 1] = l + '…'; }
    wraps.set(key, r); return r;
  }
  // Flat chip: 1 fine px outline, 1 fine px rim in col, fill tinted from col; fa = tint strength.
  function chipBox(x, y, w, h, col, fa) {
    c.fillStyle = K.ol; c.fillRect(x, y, w, h);
    c.fillStyle = col; c.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
    c.fillStyle = U.mix(K.trough, col, fa === undefined ? 0.18 : fa); c.fillRect(x + 2 * f, y + 2 * f, w - 4 * f, h - 4 * f);
  }
  const chipH = () => FM.b.cap * tS + 8 * f;

  // Keycap (cached per label): hot = ember cap for the interact prompt. Returns { cv, w, h }.
  function capArt(label, hot) {
    const key = label + '|' + (hot ? 1 : 0) + '|' + k + '|' + tS; let e = caps.get(key); if (e) return e;
    if (caps.size > 60) dropMap(caps);
    const h = FM.b.cap * tS + 9 * f, w = Math.max(h, adv(label, tS) + 8 * f), g = mk(w, h), x = g.getContext('2d');
    frame(x, 'hkey', hot ? 'hot' : 'base', 0, 0, w, h, f);
    const t = textArt(label, tS, hot ? '#1b0f08' : K.gold, 'b', 700, 2);
    x.drawImage(t.cv, Math.round((w - t.adv) / 2) - t.ox, 4 * f + FM.b.cap * tS - t.base);
    e = hold({ cv: g, w, h }); caps.set(key, e); return e;
  }

  // Hero medallion: pixel disc with a stepped class-colour glow, the portrait (alpha binarized), a 2 art px ring in the player colour with a lit upper-left arc. Returns { cv, w, h }.
  function medallion(me) {
    const wid = (me.stats && me.stats.weaponId) || me.weapon, skin = ED.Cos ? ED.Cos.skin(me) : '', D = Math.max(12, Math.round(4.9 * u / k / 2) * 2), key = me.cls + '|' + me.slot + '|' + wid + '|' + skin + '|' + k + '|' + D; // the held fork and the worn skin show in the portrait
    if (medalKey === key && medal) return medal;
    if (medal) { medal.dead = true; Bmp.free(medal.cv); }
    const R = D / 2, col = ED.PLAYER_COLORS[me.slot] || K.gold, cc = ED.CLASSES[me.cls].col.c, hi = U.mix(col, '#ffffff', 0.4);
    const bg = mk(D, D), bx = bg.getContext('2d'), rgc = mk(D, D), rx = rgc.getContext('2d'), mask = mk(D, D), mx = mask.getContext('2d');
    const g1 = U.mix(K.panel, cc, 0.3), g2 = U.mix(K.panel, cc, 0.16);
    mx.fillStyle = '#fff';
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, d = Math.hypot(dx, dy); if (d >= R) continue;
      if (d >= R - 1) { rx.fillStyle = K.ol; rx.fillRect(x, y, 1, 1); } else if (d >= R - 3) { rx.fillStyle = dx + dy < -R * 0.9 ? hi : col; rx.fillRect(x, y, 1, 1); } else if (d >= R - 4) { rx.fillStyle = K.sh; rx.fillRect(x, y, 1, 1); }
      if (d < R - 3) { mx.fillRect(x, y, 1, 1); const gd = Math.hypot(dx, dy - R * 0.2); bx.fillStyle = gd < R * 0.42 ? g1 : gd < R * 0.68 ? g2 : K.panel; bx.fillRect(x, y, 1, 1); }
    }
    const S = D * k, out = mk(S, S), og = out.getContext('2d'), pc = mk(S, S), pg = pc.getContext('2d');
    ED.Sprites.portrait(pc, me.cls, me.slot, wid, skin); binarize(pc);
    pg.imageSmoothingEnabled = false; pg.globalCompositeOperation = 'destination-in'; pg.drawImage(mask, 0, 0, S, S); pg.globalCompositeOperation = 'source-over';
    og.imageSmoothingEnabled = false; og.drawImage(bg, 0, 0, S, S); og.drawImage(pc, 0, 0); og.drawImage(rgc, 0, 0, S, S);
    medal = hold({ cv: out, w: S, h: S }); medalKey = key; return medal;
  }

  // Path ring at art resolution: band [ri, R) lit clockwise from the top to `lit` (0..1) in col, a bone keystone tick through the band and the outer outline at angle kt (0..1). Size 2R + 2.
  function ringArt(R, ri, col, lit, kt) {
    const key = 'r' + R + '|' + ri + '|' + col + '|' + lit + '|' + kt; let e = art.get(key); if (e) return e;
    if (art.size > 160) dropMap(art);
    const D = 2 * R + 2, o = R + 1, g = mk(D, D), x = g.getContext('2d'), dim = K.line, lo = U.mix(col, '#000000', 0.35);
    for (let py = 0; py < D; py++) for (let px = 0; px < D; px++) {
      const dx = px + 0.5 - o, dy = py + 0.5 - o, d = Math.hypot(dx, dy); if (d >= R + 1) continue;
      if (d < ri - 1) { x.fillStyle = K.trough; x.fillRect(px, py, 1, 1); continue; } // dark disc behind the icon
      let a = Math.atan2(dx, -dy); if (a < 0) a += TAU;
      let da = Math.abs(a - kt * TAU); if (da > Math.PI) da = TAU - da;
      const tick = kt > 0 && da * d < 0.75; // a 1 px radial line through both outlines and the band
      x.fillStyle = tick ? K.bone : d >= R || d < ri ? K.ol : a / TAU < lit ? (d < ri + 1 ? lo : col) : dim; x.fillRect(px, py, 1, 1);
    }
    e = hold({ cv: g, D }); art.set(key, e); return e;
  }
  // Cooldown wedge at art resolution: n x n, the remaining fraction (fr = steps / WEDGE) darkened clockwise from the top, whole pixels.
  const WEDGE = 48;
  function wedgeArt(n, st) {
    const key = 'w' + n + '|' + st; let e = art.get(key); if (e) return e;
    if (art.size > 160) dropMap(art);
    const g = mk(n, n), x = g.getContext('2d'), h = n / 2, fr = st / WEDGE; x.fillStyle = 'rgba(6,4,3,0.74)';
    for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) { let a = Math.atan2(px + 0.5 - h, h - py - 0.5); if (a < 0) a += TAU; if (a / TAU < fr) x.fillRect(px, py, 1, 1); }
    e = hold({ cv: g }); art.set(key, e); return e;
  }

  // ---------------- bars ----------------
  // Bar frame: 1 art px notched outline, trough; returns the inner rect (1 fine px inside the trough).
  function barFrame(x, y, w, h) {
    ring(c, x, y, w, h, k, K.ol, true); c.fillStyle = K.trough; c.fillRect(x + k, y + k, w - 2 * k, h - 2 * k);
    return { x: x + k + f, y: y + k + f, w: w - 2 * k - 2 * f, h: h - 2 * k - 2 * f };
  }
  // Stepped column fill: base colour, 1 fine px light top row and dark bottom row when tall enough.
  function band(x, y, w, h, col, top) {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = col; c.fillRect(x, y, w, h);
    if (h >= 3 * f) { if (top) { c.fillStyle = U.mix(col, '#ffffff', 0.38); c.fillRect(x, y, w, f); } c.fillStyle = U.mix(col, '#000000', 0.38); c.fillRect(x, y + h - f, w, f); }
  }
  // Segmented health bar: one segment per `per` HP (1, 2, 5, ... so segments stay 4 fine px apart); each segment fills from the bottom by its share of HP,
  // the damage ghost (pale) and the shield (pale blue, after the health, moved back over it when it would pass the end) stack above in the same columns.
  // o: { hp, max, sh, gh, col, empty }. Returns the inner rect.
  const PER = [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000];
  function hpBar(x, y, w, h, o) {
    const r = barFrame(x, y, w, h), max = Math.max(1, o.max), hp = U.clamp(o.hp, 0, max), sh = Math.max(0, o.sh || 0), gh = Math.max(hp, Math.min(max, o.gh || 0));
    let per = PER[PER.length - 1];
    for (const p of PER) if (r.w / Math.ceil(max / p) >= 4 * f) { per = p; break; }
    const segs = Math.ceil(max / per), s0 = Math.max(0, Math.min(hp, max - sh)), s1 = Math.min(max, s0 + sh), ih = r.h;
    const qh = (v) => (v <= 0 ? 0 : Math.min(ih, Math.max(f, qf(v * ih)))); // filled height of a column share, whole fine px, at least one row
    const span = (sx, w2, lo, hi, col, top) => { if (hi <= lo) return; const yb = r.y + ih - qh(lo), yt = Math.min(yb - f, r.y + ih - qh(hi)); band(sx, yt, w2, yb - yt, col, top); };
    const empty = o.empty || '#2b1712', sCol = '#cfe3ff';
    for (let i = 0; i < segs; i++) {
      const sx = r.x + Math.round(i * r.w / segs), ex = r.x + Math.round((i + 1) * r.w / segs) - (i < segs - 1 ? f : 0), sw = ex - sx, a = i * per, b = Math.min(max, a + per), bw = b - a;
      if (sw <= 0) continue;
      const fr = (v) => clamp01((v - a) / bw);
      c.fillStyle = empty; c.fillRect(sx, r.y, sw, ih);
      span(sx, sw, fr(hp), fr(gh), '#d99a80', false);
      span(sx, sw, 0, fr(hp), o.col, true);
      if (sh > 0) span(sx, sw, fr(s0), fr(s1), sCol, true);
    }
    return r;
  }
  // Continuous bar: fill quantized to fine px, optional ghost and n decorative segment notches. Returns the inner rect.
  function fillBar(x, y, w, h, frac, col, ghostF, n) {
    const r = barFrame(x, y, w, h), fw = qf(r.w * clamp01(frac));
    if (ghostF > frac) { c.fillStyle = '#d99a80'; c.fillRect(r.x, r.y, qf(r.w * clamp01(ghostF)), r.h); }
    band(r.x, r.y, fw, r.h, col, true);
    if (n > 1) { c.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 1; i < n; i++) c.fillRect(r.x + qf(r.w * i / n), r.y, f, r.h); }
    return r;
  }

  // Weapon name with its evolution prefix ('Cinder Longsword'); falls back to the class name before stats exist.
  H.weaponName = (p) => {
    const st = p.stats, w = st && st.weapon, ep = st && st.evo && ED.PATHS[st.evo];
    return w ? (ep ? ep.evo + ' ' : '') + w.name : ED.CLASSES[p.cls].name;
  };

  // Hero status chips as a flat [label, colour, ...] list shared by the redraw signature and the drawing: item states, Brace, Momentum, Channel, Hexed foes, the next Cleave.
  const CHIPS = [];
  const cleaveNext = (me, st, view) => st.cleave > 0 && st.weapon.kind === 'melee' && ((view.time || 0) < (me.cleaveNext || 0) || ((me.atkCount | 0) + 1) % (3 + st.cleaveN) === 0);
  function chipList(view, me) {
    const st = me.stats, o = CHIPS; o.length = 0;
    if (!st) return o;
    if (st.aegis && (me.aegisT || 0) <= 0) o.push('Aegis', '#7fc8ff');
    if ((me.guardT || 0) > 0) o.push('Last Stand', '#ffd36b');
    if ((me.critStacks || 0) > 0) o.push('Crit ×' + me.critStacks, '#b78cff');
    if ((me.secondWind || 0) > 0) o.push('Second Wind', '#86d38f');
    if (st.phoenix && !me.phoenixUsed) o.push('Phoenix', '#ffb02e');
    if (st.brace) {
      const t = view.time || 0, wait = (me.braceAt || -99) + ED.CONST.BRACE_CD - t;
      if ((me.braceT || 0) > 0) o.push('Braced ' + me.braceT.toFixed(1) + ' s', '#ffd36b'); else if (wait > 0) o.push('Brace ' + Math.ceil(wait) + ' s', '#8f7f6c');
    }
    if (st.cleave > 0 && cleaveNext(me, st, view)) o.push('Cleave next', '#ffd36b');
    if ((me.momN | 0) > 0) o.push('Momentum ×' + me.momN, '#b78cff');
    if (st.channel > 0 && (me.chanT || 0) > 0) o.push('Channel +' + Math.round(100 * Math.min(st.chanCap, st.channel * Math.floor(me.chanT / Math.max(0.05, st.chanStep)))) + '%', '#ff9a3a');
    if (st.hex > 0) { let n = 0; for (const e of view.enemies) if (e.hexed || e.hexT > 0) n++; if (n) o.push('Hexed ' + n, '#7dffd9'); }
    if (me.boons && me.boons.capacitor > 0) { let n = 0; for (const e of view.enemies) if (e.charge > 0 && e.hp > 0) n++; if (n) o.push('Charged ' + n, '#ffe66b'); } // Capacitor: foes your next cast detonates
    if (me.glBuff || (me.glT || 0) > 0) o.push('Guardian Light', '#ffcf5a'); // Cleric buffs on any hero: Guardian Light, Embolden
    if (me.embolden || (me.auraT || 0) > 0) o.push('Emboldened', '#ffcf5a');
    return o;
  }
  // Metronome beat shown for a hero holding the Twist: 0 = none, else 1 + attacks since the last x3 beat (0-3; net.js P[25]).
  const metroBeat = (me) => (me.stats && me.stats.twMetro > 0 ? 1 + U.clamp(me.metroN | 0, 0, 3) : 0);
  H.cues = { beat: metroBeat, chips: (view, me) => chipList(view, me).slice() }; // headless checks
  const shieldOut = (p) => !!(p.shieldOut || (p.shields && p.shields.length));
  // Route sigil: the icon of the hero's route card in the class colour (nothing before the level-3 pick); returns its id for the redraw signature.
  const routeIcon = (p) => { const rt = p.boons ? ED.classRoute(p.boons, p.cls) : null; return rt && rt.t1 ? ED.BOONS[rt.t1].icon : ''; };
  // Ailment pips of a foe (the host's count, 1 to 4) for a hero who owns Brand, Open Veins, Contagion or Gangrene: small squares under the foe's bar at (x, y), drawn into the world context c.
  H.wantsPips = (p) => { const st = p && p.stats; return !!(st && (st.brand || st.veins || st.contagion || st.festerHit)); };
  H.foePips = (c, e, x, y) => {
    const n = Math.min(4, e.ailN | 0);
    if (!n) return;
    for (let i = 0; i < 4; i++) { c.fillStyle = i < n ? '#ffd36b' : 'rgba(0,0,0,0.55)'; c.fillRect(x + i * 3, y, 2, 2); }
  };
  // Shield amount as shown: one decimal under 10 ("0.7", "1.4"), whole above.
  const shTxt = (s) => (s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s)));

  // ---------------- canvas + layout ----------------
  // Creates #hud above #game on first use and keeps it at device resolution (a whole fraction of it when capped by pixel count or Low quality, shown pixelated); returns false when unusable.
  function sync() {
    const R = ED.Render;
    if (!cv) {
      const game = document.getElementById('game'); if (!game) return false;
      cv = document.createElement('canvas'); cv.id = 'hud'; cv.setAttribute('aria-hidden', 'true');
      game.parentNode.insertBefore(cv, game.nextSibling);
      c = cv.getContext('2d');
      if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', dropArt);
      if (document.fonts && document.fonts.load) for (const fnt of ['400 16px', '700 16px']) document.fonts.load(fnt + ' ' + FM.b.f).catch(() => {}); // canvas text only triggers a load on first use
    }
    const w = window.innerWidth, h = window.innerHeight, soft = !!(ED.Post && ED.Post.soft), low = R.quality === 'low' || soft;
    if (!shown) { cv.style.display = 'block'; shown = true; document.body.classList.add('hud-on'); forceDirty = true; }
    const dpr = window.devicePixelRatio || 1;
    if (w !== cssW || h !== cssH || low !== lowQ || dpr !== lastDpr) {
      cssW = w; cssH = h; lowQ = low; lastDpr = dpr;
      // software raster: at most 1.1 MP like the world canvas; else device px / j for the smallest j within 2x (Low 1.5x) dpr and 6 MP, so a capped HUD scales by a whole factor
      if (soft) hd = Math.min(1, Math.sqrt(1.1e6 / (w * h)));
      else { let j = 1; while (j < 8 && (dpr / j > (low ? 1.5 : 2) + 1e-6 || w * h * (dpr / j) * (dpr / j) > 6e6)) j++; hd = dpr / j; }
      cv.width = W = Math.round(w * hd); cv.height = Hh = Math.round(h * hd);
      if (cv.style) cv.style.imageRendering = hd < dpr - 1e-3 ? 'pixelated' : '';
      u = U.clamp(Math.min(w / 110, h / 62), 13, 36) * hd;
      k = Math.max(1, Math.floor(Math.min(W / 480, Hh / 270))); f = Math.max(1, Math.round(k / 2));
      tS = Math.max(1, Math.round(1.08 * u / 16)); tV = Math.max(tS, Math.round(1.5 * u / 16)); tT = Math.max(2, Math.round(1.75 * u / 16)); tB = Math.max(2, Math.round(0.19 * u));
      tJ = Math.max(1, Math.round(2.4 * u / 9)); tJ2 = Math.max(1, Math.round(2.1 * u / 9)); // big banners and centre notes: cap 9 font px ≈ 2.4u / 2.1u
      c.imageSmoothingEnabled = false;
      dropArt(); layout();
    }
    rk = hd / (R.dpr || 1);
    return true;
  }
  H.dirty = () => { forceDirty = true; }; // next draw repaints (tests, external invalidation)
  H.bossBar = (view, t) => bossBar(view, t); // draws the boss bar into the HUD canvas as set up by the last draw (tests)
  H.flashSlot = (i, t) => { const fx = slotFx[i] || (slotFx[i] = { r: false, t: 0 }); fx.t = Math.max(fx.t, t || 0.5); forceDirty = true; }; // white outline pulse on ability slot i (a cooldown cut)
  H.clear = () => { if (cv && shown) { cv.style.display = 'none'; shown = false; document.body.classList.remove('hud-on'); } };
  H.grid = () => ({ k, f, u, hd, tS, tV, tT }); // current grid and text multiples (tests)

  function layout() {
    const m = Math.max(2 * k, q(u * 1.2)), fl = (v) => Math.floor(v / k) * k;
    L.m = m;
    L.hw = q(u * 33); L.hh = Math.max(12 * k, q(u * 6.4)); L.hx = m; L.hy = fl(Hh - m - L.hh);
    L.ss = q(u * 4); L.sg = Math.max(k, q(u * 0.5)); L.sx = m; L.sy = L.hy - q(u * 1.1) - L.ss;
    L.ch = chipH(); L.cy = L.sy - q(u * 0.5) - L.ch;
    L.pw = q(u * 18); L.ph = Math.max(12 * k, q(u * 3.5));
    L.mw = q(u * 19); L.mx = fl(W - m - L.mw); L.my = m;
    L.xw = U.clamp(W - 2 * (L.hx + L.hw + u * 1.5), u * 22, u * 40); L.xh = Math.max(12 * k, q(u * 3.6)); L.xx = q(Math.max((W - L.xw) / 2, L.hx + L.hw + u * 0.8)); L.xw = fl(Math.min(L.xw, W - m - L.xx)); L.xy = fl(Hh - m - L.xh);
    L.bw = q(Math.min(u * 55, W - 2 * (L.mw + m * 2))); // boss plate width, clear of the map column
  }

  // ---------------- panel fade ----------------
  // Screen points of every living hero, foe and pickup (same affine as R.toScreen, taken once per frame).
  function focusPoints(view) {
    const R = ED.Render, a = R.toScreen(0, 0), b = R.toScreen(1, 0), sc = (b.x - a.x) * rk, ox = a.x * rk, oy = a.y * rk;
    let n = 0;
    const put = (x, y, r) => { if (n < FP_MAX) { const i = n++ * 3; fp[i] = ox + x * sc; fp[i + 1] = oy + y * sc; fp[i + 2] = r * sc; } };
    for (const p of view.players.values()) if (!p.dead) put(p.x, p.y - 12, 14);
    for (const e of view.enemies) if (e.hp > 0 && !e.burrowed) { // circle over the body's drawn height: the atlas anchor, else the procedural size
      const an = R.actorAnchor ? R.actorAnchor(e) : null, tp = an ? an.top : -e.r - (e.def.fly ? 8 : 0);
      put(e.x, e.y + tp * 0.5, Math.max(e.r * 1.3, -tp * 0.6));
    }
    for (const kk of view.pickups) put(kk.x, kk.y - 6, 8);
    const s = ED.Game.s, I = ED.Input, m = I.mouse; // the cursor while attacking or previewing a ground skill (screen space, radius 1.2u)
    if (s && s.aim && s.aim.pointer && m.inside && n < FP_MAX && (s.aim.ground.length || I.held('attack'))) { const i = n++ * 3; fp[i] = m.x * R.dpr * rk; fp[i + 1] = m.y * R.dpr * rk; fp[i + 2] = 1.2 * u; }
    fpN = n;
  }
  // Steps panel f's fade once per frame against the focus points (its rect is the one it was last drawn with).
  function stepFade(fd) {
    if (fd.n === frameN) return;
    fd.n = frameN;
    const x = fd.x, y = fd.y, w = fd.w, h = fd.h, mg = u * 0.4;
    let hit = false;
    for (let i = 0, n = fpN * 3; i < n; i += 3) { const r = fp[i + 2] + mg; if (fp[i] + r > x && fp[i] - r < x + w && fp[i + 1] + r > y && fp[i + 1] - r < y + h) { hit = true; break; } }
    if (hit) fd.hold = FADE_HOLD; else if (fd.hold > 0) fd.hold -= fdt;
    const tgt = fd.hold > 0 ? FADE_MIN : 1, st = FADE_RATE * fdt;
    fd.a = fd.a < tgt ? Math.min(tgt, fd.a + st) : Math.max(tgt, fd.a - st);
  }
  // Panels drawn last time keep fading on frames that skip the redraw, so the HUD knows when their alpha moved.
  function fadeTick() { for (const key in fade) { const fd = fade[key]; if (fd.seq === drawSeq) stepFade(fd); } }
  // Starts drawing panel `key` (canvas-px rect) at its faded alpha; endFade() restores full alpha.
  function fadeStart(key, x, y, w, h) {
    const fd = fade[key] || (fade[key] = { a: 1, hold: 0, n: -1, seq: -1, drawn: 1, x, y, w, h });
    fd.x = x; fd.y = y; fd.w = w; fd.h = h; fd.seq = drawSeq;
    stepFade(fd); fd.drawn = fd.a;
    c.globalAlpha = ga = fd.a;
  }
  const endFade = () => { c.globalAlpha = ga = 1; };

  // ---------------- redraw scheduling ----------------
  // The HUD canvas keeps its pixels between frames: it is redrawn only when a signature of the displayed values changed, when an animation runs (at most 60 redraws per second),
  // or every STALE seconds as a safety net. Stepped values (cooldown wedge steps and seconds, pulse phases, fury fill) are part of the signature; easing ghosts and fades set `anim`.
  const SG_MAX = 768, STALE = 0.25, ANIM_GAP = 0.0158;
  let sg = new Float64Array(SG_MAX), prevSg = new Float64Array(SG_MAX), sgN = 0, prevN = -1, anim = false;
  const ids = new Map();
  const sid = (s) => { let i = ids.get(s); if (i === undefined) { if (ids.size > 4000) { ids.clear(); forceDirty = true; } i = ids.size + 1; ids.set(s, i); } return i; };
  const sp = (v) => { if (sgN < SG_MAX) sg[sgN++] = v; };
  const pipList = [];
  // Owned path gates with their affinity as [id, affinity, ...] (shared by the hero block's signature).
  function pips(me) {
    pipList.length = 0;
    const gates = me.boons ? ED.gatePaths(me.boons) : [];
    for (const g of gates) pipList.push(g, ED.pathAffinity(me.boons, g));
    return pipList;
  }
  const cdText = (s) => (s >= 10 ? String(Math.ceil(s)) : s.toFixed(1));
  const spCd = (secs, total) => { if (secs > 0.04 && total > 0) { sp(Math.round(WEDGE * clamp01(secs / total))); sp(sid(cdText(secs))); } else sp(-1); }; // wedge step and seconds label
  const floorIds = new WeakMap(); let floorN = 0;
  function buildSig(view, me, ctl, extra, t) {
    const F = ED.FX, I = ED.Input, R = ED.Render;
    sp(F.fade > 0 ? 1 : 0); if (F.fade > 0) anim = true;
    sp(F.flash ? 1 : 0); if (F.flash) anim = true;
    sp(me ? 1 : 0);
    if (!me) return;
    sp(me.downed ? 1 : 0); sp(me.dead ? 1 : 0); sp(view.stratum | 0); sp(view.pact | 0); sp(view.players.size);
    // hero block
    const st = me.stats, frac = me.maxHp > 0 ? me.hp / me.maxHp : 0, cls = ED.CLASSES[me.cls], gk = 'p' + me.pid;
    sp(sid(me.name)); sp(sid(me.cls)); sp(me.slot | 0); sp(sid(String(me.weapon))); sp(Math.ceil(me.hp)); sp(me.maxHp); sp(Math.round((me.shield || 0) * 20)); sp(Math.round(frac * 1024)); sp(sid(H.weaponName(me)));
    if (ghost[gk] !== undefined && ghost[gk] > frac + 0.0005) anim = true; // damage ghost easing out
    sp(frac < 0.3 && me.hp > 0 ? 2 + step(t, 4) : 0); // low-health blink phase
    const scd = ctl.skillCd > 0 && ctl.charges <= 0 ? ctl.skillCd : 0;
    sp(sid(I.label('skill1'))); spCd(scd, st ? st.skillCd : 1); sp(ctl.charges | 0); sp(st ? st.maxCharges | 0 : 1); sp(st ? Math.round(st.skillCd * 100) : 0);
    const s2 = cls.skill2 && ED.SKILLS[cls.skill2], cd2 = ctl.skill2Cd > 0 ? ctl.skill2Cd : 0;
    if (s2) { sp(sid(I.label('skill2'))); spCd(cd2, Math.max(0.1, (st && st.skill2Cd) || s2.cd)); sp(shieldOut(me) ? 1 : 0); sp(Math.round(((st && st.skill2Cd) || s2.cd) * 100)); }
    const dmx = st ? st.dashCharges | 0 : 1, dsw = ctl.dashN < dmx && ctl.dashT > 0 ? ctl.dashT : 0; // dash recharge wedge: seconds to the next charge
    sp(sid(I.label('dash'))); sp(ctl.dashN | 0); sp(dmx); spCd(dsw, st ? st.dashCd : 1); sp(st ? Math.round(st.dashCd * 100) : 0);
    for (const fx of slotFx) if (fx && fx.t > 0) anim = true; // ready flash
    const pl = pips(me); sp(pl.length); for (let i = 0; i < pl.length; i += 2) { sp(sid(pl[i])); sp(pl[i + 1]); } sp(sid(st && st.evo || ''));
    const ch = chipList(view, me); sp(ch.length); for (let i = 0; i < ch.length; i += 2) sp(sid(ch[i]));
    const mb = metroBeat(me); sp(mb); if (mb === 4) sp(step(t, 4)); // Metronome beat and the x3 pulse
    sp(sid(routeIcon(me)));
    // party
    for (const p of view.players.values()) {
      if (p.pid === me.pid) continue;
      sp(sid(p.pid)); sp(sid(p.name)); sp(sid(p.cls)); sp(sid(routeIcon(p))); sp(p.slot | 0); sp(p.dead ? 1 : 0); sp(p.downed ? 1 : 0); sp(p.maxHp | 0); sp(Math.round((p.dead ? 0 : p.downed ? clamp01(p.revive || 0) : p.hp / p.maxHp) * 512)); sp(Math.round((p.shield || 0) * 20));
    }
    // map
    const fl = view.floor;
    if (fl) {
      let id = floorIds.get(fl); if (!id) floorIds.set(fl, id = ++floorN);
      sp(id); sp(view.roomId | 0);
      const rs = view.roomState || {}; let h = 0;
      for (const r of fl.rooms) { const s = rs[r.id]; h = (h * 7 + (s ? (s.known ? 1 : 0) | (s.visited ? 2 : 0) | (s.cleared ? 4 : 0) : 0)) | 0; }
      sp(h);
    } else sp(0);
    // xp
    sp(view.level | 0); sp(Math.round(view.xp / (view.xpNext || 1) * 1024)); sp(view.gold | 0); sp(ctl.picks | 0); sp(ctl.offerOpen ? 1 : 0); sp(sid(view.waitMsg || ''));
    sp((ctl.picks | 0) > 0 && !ctl.offerOpen ? step(t, 2.5) : -1); // pending-boon pill glow phase
    // relics
    const rl = me.relics; sp(rl ? rl.length : 0); if (rl) for (let i = 0; i < rl.length; i++) sp(sid(rl[i]));
    // boss bar
    let boss = null; const en = view.enemies;
    for (let i = 0; i < en.length; i++) if (en[i].boss && en[i].hp > 0) { boss = en[i]; break; }
    if (boss) { const fr = boss.hp / boss.maxHp; sp(boss.id); sp(Math.round(fr * 1024)); sp(boss.exposed ? 1 : 0); sp(sid(boss.def.name)); if (ghost.boss !== undefined && ghost.boss > fr + 0.0005) anim = true;
      const fz = ED.World.furyAt(view.stratum | 0);
      if (fz > 0) { const fc = boss.furyT || 0, fm = boss.furyM || 1; sp(Math.round(fc * 2)); sp(Math.round(fm * 10)); if (fc >= fz - ED.World.BOSS_FURY.warn) sp(step(t, fc > fz ? 1.5 + 0.5 * fm : 2.5)); } // fury track fill, label and pulse phase (from `warn` seconds before the start)
    } else sp(0);
    // prompt and sign (their screen position follows the world)
    const pr = extra.prompt;
    if (pr) { const s = R.toScreen(pr.x, pr.y - 46); sp(1); sp(sid(pr.text)); sp(sid(pr.desc || '')); sp(sid(pr.color || '')); sp(pr.can === false ? 1 : 0); sp(sid(I.hint('attack'))); sp(Math.round(s.x * rk)); sp(Math.round(s.y * rk)); } else sp(0);
    const sg2 = R.sign;
    if (sg2) { const s = R.toScreen(sg2.x, me.y >= sg2.y ? sg2.y - 36 : sg2.y + 8); sp(1); sp(sid(ED.Input.fill(String(sg2.text)))); sp(me.y >= sg2.y ? 1 : 0); sp(Math.round(s.x * rk)); sp(Math.round(s.y * rk)); } else sp(0);
    // messages and banner
    const ms = F.msgs; sp(ms.length);
    for (let i = 0; i < ms.length; i++) { sp(sid(ms[i].text)); sp(sid(ms[i].color)); if (ms[i].t < 1) anim = true; }
    const b = F.banner;
    if (b && !extra.offerOpen) { sp(1); sp(sid(b.title)); sp(sid(b.sub || '')); sp(sid(b.style)); anim = true; } else sp(0);
    sp(extra.offerOpen ? 1 : 0);
  }
  // True when the HUD must be repainted this frame.
  function schedule(view, me, ctl, extra, t) {
    sgN = 0; anim = false;
    buildSig(view, me, ctl, extra, t);
    let changed = forceDirty || sgN !== prevN;
    if (!changed) for (let i = 0; i < sgN; i++) if (sg[i] !== prevSg[i]) { changed = true; break; }
    if (!changed) for (const key in fade) { const fd = fade[key]; if (fd.seq === drawSeq && Math.abs(fd.a - fd.drawn) > 0.004) { anim = true; break; } }
    if (!changed) {
      if (anim ? dtAcc < ANIM_GAP : t - lastDrawT < STALE) return false;
    }
    const tmp = prevSg; prevSg = sg; sg = tmp; prevN = sgN; forceDirty = false;
    return true;
  }

  // ---------------- main draw ----------------
  H.draw = (_c, view, me, ctl, t, dt, extra) => {
    if (!sync()) return;
    frameN++; dtAcc += dt; fdt = dt;
    if (me) { focusPoints(view); fadeTick(); }
    if (!schedule(view, me, ctl, extra, t)) return;
    dtc = dtAcc; dtAcc = 0; lastDrawT = t; drawSeq++;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = ga = 1; c.clearRect(0, 0, W, Hh);
    const F = ED.FX;
    if (F.flash) { c.fillStyle = U.rgba(F.flash.color, F.flash.a * (F.flash.t / 0.3)); c.fillRect(0, 0, W, Hh); }
    if (me && me.downed) { // stepped red vignette: four bands from the edges inward
      const bw = q(Math.min(W, Hh) * 0.06);
      for (let i = 0; i < 4; i++) ring(c, i * bw, i * bw, W - 2 * i * bw, Hh - 2 * i * bw, bw, 'rgba(90,0,0,' + (0.5 - i * 0.12).toFixed(2) + ')', false);
    }
    if (me) {
      const biome = ED.biomeFor(view.stratum);
      const chips = heroBlock(view, me, ctl, t);
      party(view, me);
      mapBlock(view, biome, t);
      xpBlock(view, ctl, extra, t);
      relics(me);
      bossBar(view, t);
      if (extra.prompt) prompt(extra.prompt);
      centerNotes(view, me, t);
      signPanel(me);
      messages(chips);
      banners(F, biome, extra);
    }
    if (F.fade > 0) { c.fillStyle = `rgba(0,0,0,${Math.min(1, F.fade)})`; c.fillRect(0, 0, W, Hh); }
  };

  // ---------------- hero block (bottom-left) ----------------
  function heroBlock(view, me, ctl, t) {
    const cls = ED.CLASSES[me.cls], st = me.stats, I = ED.Input;
    const x = L.hx, y = L.hy, w = L.hw, h = L.hh;
    fadeStart('hero', x, L.sy, w + q(u * 2.5), Hh - L.sy);
    const frac = me.maxHp > 0 ? me.hp / me.maxHp : 0, low = frac < 0.3 && me.hp > 0, blink = low && step(t, 4);
    frame(c, 'hpanel', blink ? 'danger' : 'base', x, y, w, h, k);
    const med = medallion(me); c.drawImage(med.cv, x + q(u * 0.8), y + q((h - med.h) / 2));
    const bx = x + q(u * 6.4), bw = x + w - q(u * 1.0) - bx, ny = y + q(u * 1.55);
    const evoP = st && st.evo && ED.PATHS[st.evo];
    const wname = evoP || (st && st.weaponId && (st.weaponId.indexOf('@') > 0 || ED.weaponBase(st.weaponId) !== st.weaponId)) ? H.weaponName(me) : cls.name; // an evolved, forked or Armory variant weapon shows its name
    const sig = routeIcon(me), js = Math.max(1, Math.round(1.6 * u / 16));
    const full = ED.Cos ? ED.Cos.nameOf(me) : me.name; // the Wardrobe title rides the name when it fits beside the weapon line
    T(full !== me.name && adv(full, tV) + adv(wname, tS) + 16 * js + 6 * f > bw ? me.name : full, bx, ny, tV, K.gold, 'b', 'left', 700);
    T(wname, bx + bw, ny, tS, evoP ? evoP.color : K.muted, 'b', 'right', 700);
    if (sig) icon(c, sig, cls.col.c, bx + bw - adv(wname, tS) - 16 * js - f * 2, ny - 8 * js, js);
    const gk = 'p' + me.pid; ghost[gk] = ghost[gk] === undefined ? frac : Math.max(frac, ghost[gk] - dtc * 0.35);
    const by = y + q(u * 2.8), bh = q(u * 2.4), shield = me.shield || 0;
    // number plate at the bar's right end, sharing its outline column: dark inset, width fixed by max HP plus a shield slot so the segments never move
    const pad = 4 * f, ng = 2 * f, pw = q(adv(me.maxHp + '/' + me.maxHp, tV) + ng + adv('+0.0', tV) + 2 * pad + 2 * k + 2 * f), plx = bx + bw - pw;
    hpBar(bx, by, bw - pw + k, bh, { hp: me.hp, max: me.maxHp, sh: shield, gh: ghost[gk] * me.maxHp, col: low ? (blink ? '#ff5a3a' : '#b8301f') : '#d9443a' });
    ring(c, plx, by, pw, bh, k, K.ol, true); c.fillStyle = K.sh; c.fillRect(plx + k, by + k, pw - 2 * k, bh - 2 * k);
    ring(c, plx + k, by + k, pw - 2 * k, bh - 2 * k, f, low && blink ? '#8a2a1c' : K.line, false);
    const hs = Math.ceil(me.hp) + '/' + me.maxHp, ss = shield >= 0.05 ? '+' + shTxt(shield) : '', hc = low ? (blink ? '#ffd0c4' : '#ff7a5e') : '#ffffff';
    const ha = textArt(hs, tV, hc, 'b', 700, 0).adv, tw = ha + (ss ? ng + textArt(ss, tV, '#cfe3ff', 'b', 700, 0).adv : 0), tx = plx + Math.round((pw - tw) / 2), ty = by + bh / 2; // HP and shield centred together
    T(hs, tx, ty, tV, hc, 'b', 'left', 700);
    if (ss) T(ss, tx + ha + ng, ty, tV, '#cfe3ff', 'b', 'left', 700);

    // ability slots
    let i = 0;
    const sk = ED.SKILLS[cls.skill];
    const scd = ctl.skillCd > 0 && ctl.charges <= 0 ? ctl.skillCd : 0, mx = st ? st.maxCharges : 1;
    slot(i++, I.label('skill1'), scd, st ? st.skillCd : sk.cd, ctl.charges > 0, sk.icon, cls.col.c, ctl.charges, mx);
    const s2 = cls.skill2 && ED.SKILLS[cls.skill2];
    if (s2) {
      const tot = Math.max(0.1, (st && st.skill2Cd) || s2.cd), up = shieldOut(me), cd2 = ctl.skill2Cd > 0 ? ctl.skill2Cd : 0; // a thrown shield lights the slot until it is caught
      slot(i++, I.label('skill2'), cd2, tot, cd2 <= 0 && !up, s2.icon, up ? '#ffe9a0' : cls.col.c, 0, 1);
    }
    const dmx = st ? st.dashCharges | 0 : 1, dcd = ctl.dashN < dmx && ctl.dashT > 0 ? ctl.dashT : 0; // the wedge is the next charge; the slot is lit while one is left
    slot(i++, I.label('dash'), dcd, st ? st.dashCd : 1, ctl.dashN > 0, 'wing', '#bfe9ff', ctl.dashN, dmx);

    // path rings: each owned gate with its affinity ring (keystone tick, evolution at full); a star on the evolved path
    const gates = me.boons ? ED.gatePaths(me.boons) : [];
    const jr = Math.max(1, Math.round(1.9 * u / 16)), ri = Math.ceil(8 * jr / k) + 1, R = ri + 2, D = (2 * R + 2) * k;
    const gap = Math.max(D + k, q(u * 3.2)), px0 = L.sx + i * (L.ss + L.sg) + q(u * 0.3), py = L.sy + q((L.ss - D) / 2);
    for (let g = 0; g < gates.length; g++) {
      const P = ED.PATHS[gates[g]], aff = ED.pathAffinity(me.boons, gates[g]), gx = px0 + g * gap, evolved = st && st.evo === gates[g], evoAff = ED.evoAffinity(gates[g]);
      const rg2 = ringArt(R, ri, P.color, Math.round(64 * clamp01(aff / evoAff)) / 64, ED.keyAffinity(gates[g]) / evoAff);
      c.drawImage(rg2.cv, gx, py, D, D);
      icon(c, P.icon, P.color, gx + (D - 16 * jr) / 2, py + (D - 16 * jr) / 2, jr);
      const nt = String(aff), cw = adv(nt, tS) + 6 * f, chh = FM.b.cap * tS + 6 * f, cx = gx + D - cw + f, cy = py + D - chh + f;
      chipBox(cx, cy, cw, chh, P.color, 0.08); T(nt, cx + cw / 2, cy + chh / 2, tS, P.color, 'b', 'center', 700, 2);
      if (evolved) icon(c, 'star', '#ffd36b', gx + D - 12 * f, py - 4 * f, f);
    }

    // status chips above the slots
    let sx = L.sx, any = false;
    const chip = (label, col) => { const cw = adv(label, tS) + 10 * f; chipBox(sx, L.cy, cw, L.ch, col); T(label, sx + cw / 2, L.cy + L.ch / 2, tS, col, 'b', 'center', 700, 2); sx += cw + q(u * 0.4); any = true; };
    const cl = chipList(view, me);
    for (let kk = 0; kk < cl.length; kk += 2) chip(cl[kk], cl[kk + 1]);
    const mb = metroBeat(me);
    if (mb) { // Metronome: 'Beat' and four pips, one lit per attack since the last x3 beat; the 4th is the x3 beat, ringed gold, filled and pulsing when the next attack is it
      const lab = 'Beat', d = Math.max(4 * f, qf(L.ch * 0.42)), gp = 2 * f, n = mb - 1, hot = n === 3, col = hot ? '#ffd36b' : K.muted;
      const cw = adv(lab, tS) + 4 * d + 3 * gp + 16 * f, px0 = sx + adv(lab, tS) + 10 * f, py = L.cy + qf((L.ch - d) / 2);
      chipBox(sx, L.cy, cw, L.ch, col, hot ? 0.3 : 0.12); T(lab, sx + 5 * f + adv(lab, tS) / 2, L.cy + L.ch / 2, tS, col, 'b', 'center', 700, 2);
      for (let i = 0; i < 4; i++) {
        const x = px0 + i * (d + gp), last = i === 3;
        c.fillStyle = last ? '#ffd36b' : K.ol; c.fillRect(x, py, d, d);
        c.fillStyle = last ? (hot ? (step(t, 4) ? '#fff4d6' : '#ffd36b') : '#3a2a10') : i < n ? K.bone : '#2a1d15'; c.fillRect(x + f, py + f, d - 2 * f, d - 2 * f);
      }
      if (hot && step(t, 4)) ring(c, px0 + 3 * (d + gp) - f, py - f, d + 2 * f, d + 2 * f, f, '#fff4d6', false);
      sx += cw + q(u * 0.4); any = true;
    }
    endFade();
    return any;
  }

  // One ability slot: well frame, icon, stepped cooldown wedge + seconds, ready rim in the slot colour and flash, charge pips, keycap.
  function slot(i, key, secs, total, ready, ic, col, charges, maxCharges) {
    const x = L.sx + i * (L.ss + L.sg), y = L.sy, s = L.ss, b = 2 * k, n = (s - 2 * b) / k, fx = slotFx[i] || (slotFx[i] = { r: ready, t: 0 });
    if (ready && !fx.r) fx.t = 0.5; fx.r = ready; if (fx.t > 0) fx.t -= dtc;
    frame(c, 'hslot', ready ? 'ready' : 'off', x, y, s, s, k);
    const j = Math.max(1, Math.floor((s - 2 * b) / 16)), Z = 16 * j;
    c.globalAlpha = ga * (ready ? 1 : 0.42); icon(c, ic, col, x + (s - Z) / 2, y + (s - Z) / 2, j); c.globalAlpha = ga;
    if (secs > 0.04 && total > 0) {
      c.drawImage(wedgeArt(n, Math.round(WEDGE * clamp01(secs / total))).cv, x + b, y + b, n * k, n * k);
      T(cdText(secs), x + s / 2, y + s / 2, tV, K.bone, 'b', 'center', 700, 1);
    }
    if (ready) ring(c, x + k, y + k, s - 2 * k, s - 2 * k, k, col, false);
    if (fx.t > 0 && step(fx.t, 10)) ring(c, x, y, s, s, 2 * k, '#fff4d6', true);
    if (maxCharges > 1) { // charge pips, top-left inside the rim
      const d = 4 * f;
      for (let kk = 0; kk < maxCharges; kk++) { const px = x + b + f + kk * (d + f), py = y + b + f; c.fillStyle = K.ol; c.fillRect(px, py, d, d); c.fillStyle = kk < charges ? K.emberHi : '#2a1d15'; c.fillRect(px + f, py + f, d - 2 * f, d - 2 * f); }
    }
    const kc = capArt(key, false); c.drawImage(kc.cv, Math.round(x + (s - kc.w) / 2), y + s - qf(kc.h * 0.45));
  }

  // ---------------- party (top-left column) ----------------
  function party(view, me) {
    let ty = L.m;
    for (const p of view.players.values()) {
      if (p.pid === me.pid) continue;
      const x = L.m, w = L.pw, h = L.ph, col = ED.PLAYER_COLORS[p.slot] || K.bone, out = p.dead || p.downed;
      fadeStart('p' + p.pid, x, ty, w, h);
      frame(c, 'hpanel', 'dim', x, ty, w, h, k);
      c.fillStyle = col; c.fillRect(x + 3 * k, ty + 3 * k, k, h - 6 * k);
      const ny = ty + q(u * 1.0);
      const label = p.dead ? 'Fallen' : p.downed ? 'DOWN' : ED.CLASSES[p.cls].name, psg = routeIcon(p), js = Math.max(1, Math.round(1.6 * u / 16));
      const rx = x + w - Math.max(7 * k, q(u * 1.1)); // clear of the frame's corner bracket
      const full = ED.Cos ? ED.Cos.nameOf(p) : p.name, room = rx - adv(label, tS) - (psg && !out ? 16 * js + 2 * f : 0) - 4 * f - (x + q(u * 1.1)); // the Wardrobe title rides the name when it fits
      T(full !== p.name && adv(full, tS) > room ? p.name : full, x + q(u * 1.1), ny, tS, col, 'b', 'left', 700);
      T(label, rx, ny, tS, out ? '#ff8a7a' : K.muted, 'b', 'right', 700);
      if (psg && !out) icon(c, psg, ED.CLASSES[p.cls].col.c, rx - adv(label, tS) - 16 * js - 2 * f, ny - 8 * js, js);
      const bx = x + q(u * 1.1), bw = rx - bx, by = ty + q(u * 1.85), bh = Math.max(4 * k, q(u * 0.95));
      if (p.dead || p.downed) fillBar(bx, by, bw, bh, p.dead ? 0 : clamp01(p.revive || 0), '#f0c060', 0, 0);
      else hpBar(bx, by, bw, bh, { hp: p.hp, max: p.maxHp, sh: p.shield || 0, gh: 0, col: '#7fcf8a', empty: '#16261a' });
      endFade();
      ty += h + q(u * 0.55);
    }
  }

  // ---------------- map + stratum (top-right) ----------------
  // The panel height follows the floor: cells are as large as the panel width allows (at most 4.2u, grid height within 17u). Weak / resists share a row when both fit, else stack.
  function mapBlock(view, biome, t) {
    const x = L.mx, y = L.my, w = L.mw, fl = view.floor, G = fl && gridOf(fl), ix = x + q(u * 1.1), iw = w - 2 * q(u * 1.1);
    const ty = y + q(u * 1.6), ry = ty + q(u * 1.45), wkE = ED.PATHS[biome.weak], rsE = ED.PATHS[biome.resist], js = Math.max(1, Math.round(1.4 * u / 16)), Z = 16 * js;
    const grp = (lab, P) => adv(lab, tS) + 2 * f + Z + 2 * f + adv(P.name, tS); // label, icon, element name
    const two = wkE && rsE && grp('Weak', wkE) + q(u * 1) + grp('Resists', rsE) > iw, rowH = Math.max(Z, FM.b.cap * tS) + q(u * 0.5);
    const ay = ry + q(u * 1.5), top = (wkE && rsE ? ay + (two ? rowH : 0) + q(u * 1.1) : ry + q(u * 1.2)) - y, mw = w - q(u * 1.2);
    const hCap = Math.max(u * 6, Math.min(u * 17, Hh - 2 * L.m - top - u * 1.3)), cell = G ? Math.min(mw / G.cols, hCap / G.rows, 4.2 * u) : 0, mh = G ? Math.ceil(G.rows * cell) : u * 4;
    L.mh = q(top + mh + u * 0.7);
    fadeStart('map', x, y, w, L.mh);
    frame(c, 'hpanel', 'base', x, y, w, L.mh, k);
    T(biome.name, x + w / 2, ty, tT, biome.pal.ui, 'b', 'center', 700);
    T('Stratum ' + U.roman(view.stratum), ix, ry, tS, K.muted, 'b', 'left', 700);
    if (view.pact > 0) T('Pact ' + view.pact, ix + iw, ry, tS, '#ff7a56', 'b', 'right', 700);
    // stratum affinity: foes are weak to one element and resist another
    if (wkE && rsE) {
      for (let kk = 0; kk < 2; kk++) {
        const P = kk ? rsE : wkE, lab = kk ? 'Resists' : 'Weak', gy = ay + (two && kk ? rowH : 0), ax = two || !kk ? ix : ix + iw - grp(lab, P);
        T(lab, ax, gy, tS, K.faint, 'b', 'left', 700);
        const lx = ax + adv(lab, tS) + 2 * f;
        icon(c, P.icon, P.color, lx, gy - Z / 2, js);
        T(P.name, lx + Z + 2 * f, gy, tS, P.color, 'b', 'left', 700);
      }
    }
    H.drawMap(c, view, x + q(u * 0.6), y + top, mw, mh, u, t, f);
    endFade();
  }

  // ---------------- xp, gold, picks (bottom-centre) ----------------
  function xpBlock(view, ctl, extra, t) {
    const x = L.xx, y = L.xy, w = L.xw, h = L.xh, my = y + h / 2;
    fadeStart('xp', x, y, w, h);
    frame(c, 'hpanel', 'base', x, y, w, h, k);
    T('Lv ' + view.level, x + q(u * 1.3), my, tV, K.gold, 'b', 'left', 700);
    const jc = Math.max(1, Math.round(1.9 * u / 16)), gx = x + w - q(u * 1.1) - adv(String(view.gold), tV), cx = gx - 16 * jc - 2 * f;
    const bx = x + q(u * 1.3) + adv('Lv 00', tV) + q(u * 0.8), bw = cx - q(u * 0.9) - bx, bh = Math.max(4 * k, q(u * 1.3));
    fillBar(bx, q(my - bh / 2), bw, bh, view.xp / view.xpNext, '#4fd0b0', 0, 0);
    icon(c, 'coin', '#ffd36b', cx, my - 8 * jc, jc);
    T(String(view.gold), gx, my, tV, '#ffd36b', 'b', 'left', 700);
    endFade();
    let ay = y - q(u * 0.7);
    if ((ctl.picks || 0) > 0 && !ctl.offerOpen) {
      const s = ctl.picks + ' boon' + (ctl.picks > 1 ? 's' : '') + ' ready', hi = step(t, 2.5), ph = chipH() + 2 * f;
      const cw = adv(s, tS) + 12 * f, px = q(x + (w - cw) / 2);
      chipBox(px, ay - ph, cw, ph, hi ? '#ffe0bd' : K.emberHi, hi ? 0.34 : 0.2);
      T(s, px + cw / 2, ay - ph / 2, tS, hi ? '#ffe0bd' : K.emberHi, 'b', 'center', 700, 2); ay -= ph + q(u * 0.6);
    }
    if (view.waitMsg) T(view.waitMsg, x + w / 2, ay - q(u * 0.9), tS, K.gold, 'b', 'center', 700, 1);
  }

  // ---------------- relics (bottom-right) ----------------
  function relics(me) {
    const n = me.relics ? me.relics.length : 0; if (!n) return;
    const j = Math.max(1, Math.round(2.5 * u / 16)), s = 16 * j, g = Math.max(f, q(u * 0.35)), per = U.clamp(Math.floor((W - L.m - (L.xx + L.xw) - u) / (s + g)), 1, 9), rows = Math.ceil(n / per); // icons per row: the room right of the xp plate
    const rx = Math.floor((W - L.m) / k) * k, ry = Math.floor((Hh - L.m) / k) * k;
    fadeStart('relics', rx - Math.min(n, per) * (s + g), ry - rows * (s + g) + g, Math.min(n, per) * (s + g), rows * (s + g));
    for (let i = 0; i < n; i++) {
      const col = i % per, row = Math.floor(i / per), inRow = Math.min(per, n - row * per);
      c.drawImage(ED.Icons.relicCanvas(me.relics[i], s), rx - (inRow - col) * (s + g) + g, ry - s - row * (s + g));
    }
    endFade();
  }

  // ---------------- boss bar (top-centre) ----------------
  function bossBar(view, t) {
    let boss = null; const en = view.enemies;
    for (let i = 0; i < en.length; i++) if (en[i].boss && en[i].hp > 0) { boss = en[i]; break; }
    if (!boss) return;
    const FZ = ED.World.furyAt(view.stratum | 0), FU = ED.World.BOSS_FURY, fc = boss.furyT || 0, fm = boss.furyM || 1, fon = FZ > 0 && fc > FZ, fwarn = FZ > 0 && !fon && fc >= FZ - FU.warn; // fury: strata with a start time only
    const pw = L.bw, ins = q(u * 1.5), bw = pw - 2 * ins, ph = q(u * (FZ > 0 ? 6.5 : 5.6)), x = q((W - pw) / 2), y = L.m, pu = fon || fwarn ? step(t, fon ? 1.5 + 0.5 * fm : 2.5) : 0;
    fadeStart('boss', x, y, pw, ph);
    frame(c, 'hpanel', fon && pu ? 'fury' : 'base', x, y, pw, ph, k);
    const ny = y + q(u * 1.65);
    T(boss.def.name, x + pw / 2, ny, tT, K.bone, 'b', 'center', 700);
    const fr = boss.hp / boss.maxHp;
    ghost.boss = ghost.boss === undefined || ghost.bossId !== boss.id ? fr : Math.max(fr, ghost.boss - dtc * 0.2); ghost.bossId = boss.id;
    const marks = boss.type === 'hollowking' ? [0.6, 0.3] : [0.66, 0.33], by = y + q(u * 3.0), bh = Math.max(5 * k, q(u * 1.7)), bx = x + ins;
    const r = fillBar(bx, by, bw, bh, fr, boss.exposed ? '#ff9a3a' : '#c0392b', ghost.boss, 20);
    for (const mk2 of marks) { const mx = r.x + qf(r.w * mk2) - k; c.fillStyle = K.ol; c.fillRect(mx - f, by - k - f, 2 * k + 2 * f, bh + 2 * k + 2 * f); c.fillStyle = K.gold; c.fillRect(mx, by - k, 2 * k, bh + 2 * k); } // phase marks: gold posts through the bar
    if (FZ > 0) { // fury track under the bar: fight time up to the cap (start + the ramp's length), a notch at the start; it pulses from `warn` s before the start and burns past it
      const end = FZ + (FU.max - 1) / FU.ramp, ty = by + bh + q(u * 0.55), th = Math.max(2 * f, qf(u * 0.4));
      c.fillStyle = '#000'; c.fillRect(bx - f, ty - f, bw + 2 * f, th + 2 * f); c.fillStyle = '#26120b'; c.fillRect(bx, ty, bw, th);
      c.fillStyle = fon ? U.rgba('#ff5a1a', 0.75 + 0.25 * pu) : fwarn ? U.rgba('#ffb56b', 0.55 + 0.45 * pu) : '#b88a4a'; c.fillRect(bx, ty, qf(bw * clamp01(fc / end)), th);
      c.fillStyle = fon || fwarn ? '#ffd9a0' : K.gold; c.fillRect(bx + qf(bw * FZ / end) - f, ty - f, 2 * f, th + 2 * f);
    }
    if (fon) T('Fury ×' + fm.toFixed(1), x + pw - ins, ny, tS, '#ff8a3d', 'b', 'right', 700);
    if (boss.exposed) T('Exposed', fon ? x + ins : x + pw - ins, ny, tS, '#ffb870', 'b', fon ? 'left' : 'right', 700); // beside the fury label, not under it
    endFade();
  }

  // ---------------- interaction prompt ----------------
  function prompt(pr) {
    const s = ED.Render.toScreen(pr.x, pr.y - 46), sx = s.x * rk, sy = s.y * rk, key = ED.Input.hint('attack');
    const kc = capArt(key, true), ph = Math.max(kc.h + 6 * k, q(u * 2.6));
    const w = q(kc.w + adv(pr.text, tS) + u * 2.6), x = q(U.clamp(sx - w / 2, L.m, W - L.m - w)), y = q(sy - ph / 2);
    frame(c, 'hsmall', 'hot', x, y, w, ph, k);
    c.drawImage(kc.cv, x + q(u * 0.8), y + q((ph - kc.h) / 2));
    T(pr.text, x + q(u * 0.8) + kc.w + q(u * 0.8), y + ph / 2, tS, pr.can === false ? '#c08070' : K.bone, 'b', 'left', 700);
    if (pr.desc) {
      const dw = q(u * 25), lines = wrap(pr.desc, dw - u * 2, tS, 400, 5), lh = q((FM.b.asc + FM.b.desc + 4) * tS), dh = q(lines.length * lh + u * 1.3);
      const dx = q(U.clamp(sx - dw / 2, L.m, W - L.m - dw)), dy = q(Math.max(L.m, y - u * 0.8 - dh));
      frame(c, 'hsmall', 'base', dx, dy, dw, dh, k);
      if (pr.color) ring(c, dx + k, dy + k, dw - 2 * k, dh - 2 * k, k, pr.color, true);
      for (let i = 0; i < lines.length; i++) T(lines[i], dx + dw / 2, dy + (dh - lines.length * lh) / 2 + lh * (i + 0.5), tS, '#efe3cd', 'b', 'center', 400);
    }
  }

  // ---------------- tutorial / stratum sign (screen space, bindings substituted) ----------------
  // Panel sits on the side of the sign away from the hero so it never covers them.
  function signPanel(me) {
    const R = ED.Render, sg = R.sign; if (!sg) return;
    R.sign = null;
    const text = ED.Input.fill(sg.text), above = me.y >= sg.y, s = R.toScreen(sg.x, above ? sg.y - 36 : sg.y + 8), sx = s.x * rk, sy = s.y * rk;
    const w = q(u * 25), lines = wrap(text, w - u * 2.4, tS, 400, 6), lh = q((FM.b.asc + FM.b.desc + 4) * tS), h = q(lines.length * lh + u * 1.6);
    const x = q(U.clamp(sx - w / 2, L.m, W - L.m - w)), y = q(U.clamp(above ? sy - h : sy, L.m, Hh - L.m - h));
    frame(c, 'hsmall', 'base', x, y, w, h, k);
    for (let i = 0; i < lines.length; i++) T(lines[i], x + w / 2, y + (h - lines.length * lh) / 2 + lh * (i + 0.5), tS, '#efe3cd', 'b', 'center', 400);
  }

  // ---------------- centre notes: down / fallen ----------------
  function centerNotes(view, me) {
    const y = q(Hh * 0.32), sy = y + q(FM.b.cap * tJ2 / 2 + u * 1.6);
    if (me.downed) {
      T('You are down', W / 2, y, tJ2, '#ff8a7a', 'b', 'center', 700, 1);
      if (view.players.size > 1) T('Stay calm. An ally can revive you by standing close.', W / 2, sy, tS, K.bone, 'b', 'center', 700, 1);
    } else if (me.dead) {
      T('Fallen', W / 2, y, tJ2, '#cfc6b6', 'b', 'center', 700, 1);
      T('You will rise again when your party reaches the next stratum.', W / 2, sy, tS, K.bone, 'b', 'center', 700, 1);
    }
  }

  // ---------------- message feed (above the hero block, newest at the bottom, 4 lines max) ----------------
  function messages(chips) {
    const ms = ED.FX.msgs; if (!ms.length) return;
    const lh = q((FM.b.asc + FM.b.desc + 3) * tS), maxW = u * 30, pad = q(u * 0.8);
    let y = (chips ? L.cy : L.sy) - q(u * 0.7), used = 0;
    for (let i = ms.length - 1; i >= 0 && used < 4; i--) {
      const m = ms[i], lines = wrap(m.text, maxW, tS, 700, Math.min(2, 4 - used)), n = lines.length;
      let mw = 0; for (let kk = 0; kk < n; kk++) mw = Math.max(mw, adv(lines[kk], tS));
      const a = Math.min(1, m.t), h = n * lh + 2 * k;
      c.globalAlpha = a * 0.7; c.fillStyle = '#0c0806'; c.fillRect(L.m, y - h, q(mw + pad + u * 0.8), h);
      c.globalAlpha = a; c.fillStyle = m.color; c.fillRect(L.m, y - h, k, h);
      for (let kk = 0; kk < n; kk++) T(lines[kk], L.m + pad, y - h + k + lh * (kk + 0.5), tS, m.color, 'b', 'left', 700);
      y -= h + q(u * 0.35); used += n;
    }
    c.globalAlpha = 1;
  }

  // ---------------- banners ----------------
  function banners(F, biome, extra) {
    const b = F.banner; if (!b || extra.offerOpen) return;
    const a = Math.min(1, b.t * 3, (b.dur - b.t) * 2);
    c.globalAlpha = Math.max(0, a);
    const cy = q(b.style === 'small' || b.style === 'level' ? Hh * 0.24 : Hh * 0.3);
    if (b.style === 'stratum' || b.style === 'boss' || b.style === 'victory') {
      const band2 = q(u * 5.5), bs = q(band2 / 3); // stepped scrim: three flat bands each side of the centre line
      for (let i = 0; i < 3; i++) { c.fillStyle = 'rgba(0,0,0,' + (0.62 - i * 0.2).toFixed(2) + ')'; c.fillRect(0, cy - (i + 1) * bs, W, bs); c.fillRect(0, cy + i * bs, W, bs); }
      const col = b.style === 'boss' ? '#ff6a4a' : b.style === 'victory' ? '#ffd36b' : biome.pal.ui;
      const tc = cy + q(u * 0.4), half = FM.b.cap * tJ / 2;
      if (b.sub) T(b.sub, W / 2, tc - half - q(u * 1.4), tS, col, 'b', 'center', 700);
      T(b.title, W / 2, tc, tJ, '#f6ecd8', 'b', 'center', 700, 1);
      const rw = q(u * 10 * Math.min(1, b.t * 2)); c.fillStyle = col; c.fillRect(W / 2 - rw, tc + half + q(u * 0.9), rw * 2, k);
      if (b.style === 'boss' && F.bossQuote) T('"' + F.bossQuote.text + '"', W / 2, tc + half + q(u * 2.2), tS, '#d8cbb8', 'b', 'center', 400, 1);
    } else {
      T(b.title, W / 2, cy, tB, b.style === 'level' ? '#ffd36b' : K.bone, 'b', 'center', 700, 1);
      if (b.sub) T(b.sub, W / 2, cy + q(FM.b.cap * tB / 2 + u * 1.3), tS, '#d8cbb8', 'b', 'center', 700, 1);
    }
    c.globalAlpha = 1;
  }

  // ---------------- minimap / full map of the current floor ----------------
  // Room-grid bounds of the whole floor (known or not, so the scale holds for the stratum), cached per floor.
  const grids = new WeakMap();
  function gridOf(fl) {
    let G = grids.get(fl); if (G) return G;
    let minX = 99, maxX = -99, minY = 99, maxY = -99;
    for (const r of fl.rooms) { minX = Math.min(minX, r.gx); maxX = Math.max(maxX, r.gx); minY = Math.min(minY, r.gy); maxY = Math.max(maxY, r.gy); }
    G = { minX, minY, cols: maxX - minX + 1, rows: maxY - minY + 1 }; grids.set(fl, G); return G;
  }
  // g: target context; un: text unit in px of g (cells scale with it); pk: pixel size of lines and rims (default from the cell). The grid is centred in the w x h box; every rect is whole px,
  // icons are drawn at whole multiples of 16 px (nearest), smaller ones at their size.
  H.drawMap = (g, view, x, y, w, h, un, t, pk) => {
    const fl = view.floor; if (!fl) return;
    const rs = view.roomState || {}, G = gridOf(fl), minX = G.minX, minY = G.minY, cols = G.cols, rows = G.rows;
    const cell = Math.max(4, Math.floor(Math.min(w / cols, h / rows, 4.2 * un))), px = pk || Math.max(1, Math.round(cell / 16));
    const ox = Math.round(x + (w - cols * cell) / 2), oy = Math.round(y + (h - rows * cell) / 2), s = Math.max(2 * px, Math.round(cell * 0.8 / px) * px), so = Math.floor((cell - s) / 2);
    const rx0 = (r) => ox + (r.gx - minX) * cell + so, ry0 = (r) => oy + (r.gy - minY) * cell + so, th = Math.max(px, Math.round(cell * 0.1 / px) * px);
    const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    const ic2 = (name, col, ix, iy, z) => { const j = Math.min(Math.floor((z + 2 * px) / 16), Math.round(z / 16)); if (j >= 1) icon(g, name, col, ix + (z - 16 * j) / 2, iy + (z - 16 * j) / 2, j); else g.drawImage(ED.Icons.canvas(name, col, 64), Math.round(ix), Math.round(iy), Math.round(z), Math.round(z)); };
    g.fillStyle = '#6b5a48';
    for (const r of fl.rooms) {
      const st = rs[r.id]; if (!st || !st.known) continue;
      const n1 = r.doors.e, n2 = r.doors.s, c0x = rx0(r) + (s - th) / 2, c0y = ry0(r) + (s - th) / 2;
      if (n1 >= 0 && rs[n1] && rs[n1].known) g.fillRect(Math.round(c0x), Math.round(c0y), rx0(fl.rooms[n1]) - rx0(r), th);
      if (n2 >= 0 && rs[n2] && rs[n2].known) g.fillRect(Math.round(c0x), Math.round(c0y), th, ry0(fl.rooms[n2]) - ry0(r));
    }
    const ICON = { boss: ['skull', '#ff5a3a'], shop: ['coin', '#ffd36b'], treasure: ['chest', '#ffd36b'], event: ['star', '#7dffd9'], elite: ['skull', '#ff7a3a'], rest: ['campfire', '#ff9a3a'] };
    const meP = ED.Game.s && ED.Game.s.me, cls = meP ? meP.cls : null;
    for (const r of fl.rooms) {
      const st = rs[r.id]; if (!st || !st.known) continue;
      const rx = rx0(r), ry = ry0(r), cur = r.id === view.roomId;
      g.fillStyle = cur ? '#fff3c4' : K.ol; g.fillRect(rx, ry, s, s);
      g.fillStyle = cur ? '#e6c27a' : st.visited ? (st.cleared ? '#5a4a3c' : '#8a3a2a') : '#3c3028'; g.fillRect(rx + px, ry + px, s - 2 * px, s - 2 * px);
      const icn = ICON[r.type], open = !st.cleared, z = s - 2 * px; // utility rooms keep their glyph; a cleared elite room loses it
      if (icn && (open || r.type !== 'elite')) ic2(icn[0], icn[1], rx + px, ry + px, z);
      if (open && r.reward && (r.type === 'combat' || r.type === 'elite')) { // reward preview: whole icon in plain combat rooms, a corner badge in elite rooms
        const ri = ED.Render.rewardIcon((r.dark && ED.World.REWARD_UP[r.reward]) || r.reward, cls), big = r.type === 'combat', zb = big ? z : Math.max(16, Math.floor(s * 0.5)); // a dark room previews its stepped-up reward
        ic2(ri[0], ri[1], big ? rx + px : rx + s - zb, big ? ry + px : ry + s - zb, zb);
      }
      if (r.dark && !st.visited) { const zd = Math.max(16, Math.floor(s * 0.5)); ic2('skull', '#a070ff', rx + s - zd, ry + s - zd, zd); } // dark-room mark, bottom-right of its cell
    }
    g.imageSmoothingEnabled = sm;
  };
})(globalThis.ED || (globalThis.ED = {}));
