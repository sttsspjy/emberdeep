// World renderer: camera, cached room art, coloured light accumulation, zones, props, entities, projectiles and the hand-off to the WebGL present / post pass.
// The whole world is drawn into one small offscreen buffer at 1 buffer px = 1 world px (buffer origin = integer world px R.ix / R.iy); the present step upscales it to the
// screen (sharp-bilinear in WebGL, nearest on the 2D fallback) and applies the fractional camera offset (R.fx / R.fy), so scrolling stays smooth.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, Sp = ED.Sprites, Bmp = ED.Bmp, AC = ED.Actors, Pix = ED.Pix;
  const R = ED.Render = { cam: { x: 0, y: 0 }, scale: 2, W: 0, H: 0, dpr: 1, bw: 1, bh: 1, ix: 0, iy: 0, fx: 0, fy: 0, ox: 0, oy: 0, shx: 0, shy: 0, bakeScale: 1, quality: 'high', lightLevel: 1, posting: false, stats: { n: 0, world: 0, post: 0 } };
  const BQ = R.bakeScale; // texels per world px of baked sprites and room art (world resolution)
  const glowCache = {}, lightCache = {};
  const PIX_MAX = 8.4e6, PIX_SOFT = 1.1e6; // screen canvas pixel caps: 3840x2160 renders native on every quality (the world costs buffer pixels, the present is one blit or quad); PIX_SOFT: software-rasterised canvases (no GPU)
  let buf, bctx, lightCv, lctx, vignetteH, shadowH, lightN = 0, glowN = 0, presenting2D = null;
  const bufs = [], bctxs = []; let bi = 0, wPrev = false, prevO = null, bwLast = 0, bwMs = 16.7; // two alternating world buffers (see R.endWorld); bwMs = smoothed frame interval
  const lights = [], rimSrc = [], glowQ = [], rimOut = { dx: 0, dy: 0, col: '', s: 0 };
  let rimN = 0; // live entries of rimSrc (filled by last frame's lighting pass)
  let nl = 0, ng = 0, stN = 0, shDX = 0, shDY = 0; // lights/glows queued this frame (stN: status lights); shadow skew away from the nearest light

  R.init = (canvas) => {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d', { alpha: false }); // visible canvas: shows the world only on the 2D present path
    for (let i = 0; i < 2; i++) { const w = document.createElement('canvas'); bufs.push(w); bctxs.push(w.getContext('2d', { alpha: false })); } // the world buffers
    buf = bufs[0]; bctx = bctxs[0];
    lightCv = document.createElement('canvas');
    lctx = lightCv.getContext('2d');
    const sc = document.createElement('canvas'); sc.width = 64; sc.height = 32;
    const sg = sc.getContext('2d'); sg.translate(32, 16); sg.scale(1, 0.5);
    const sr = sg.createRadialGradient(0, 0, 0, 0, 0, 32);
    sr.addColorStop(0, 'rgba(0,0,0,0.95)'); sr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); sr.addColorStop(0.8, 'rgba(0,0,0,0.14)'); sr.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = sr; sg.fillRect(-32, -32, 64, 64);
    shadowH = Bmp.hold(sc);
    Sp.shadow = R.shadow; // every sprite and prop shadow becomes the cached soft blob
    if (ED.Post) ED.Post.init(canvas);
    window.addEventListener('resize', R.resize);
    R.resize();
  };

  R.setQuality = (q) => { R.quality = q; R.resize(); };
  R.usePost = () => !!(ED.Post && ED.Post.ready && R.quality !== 'low' && !ED.Post.soft); // post on a software GL context costs more than the whole frame

  // The visible #game canvas carries the world only on the 2D present path; while WebGL presents it shrinks to a never-redrawn 1x1 transparent layer that still receives pointer events.
  function setPresent(on2d) {
    if (on2d === presenting2D) return;
    presenting2D = on2d;
    const cv = R.canvas;
    if (on2d) { cv.width = R.W; cv.height = R.H; cv.style.opacity = ''; }
    else { cv.width = 1; cv.height = 1; cv.style.opacity = '0'; }
  }

  R.resize = () => {
    const cssW = window.innerWidth, cssH = window.innerHeight;
    const low = R.quality === 'low';
    let dpr = window.devicePixelRatio || 1;
    dpr = Math.max(0.5, Math.min(dpr, Math.sqrt((ED.Post && ED.Post.soft ? PIX_SOFT : PIX_MAX) / (cssW * cssH)))); // native device px (no CSS stretch that would blur art pixels); capped at 8.4 MP, 1.1 MP without a GPU
    R.dpr = dpr;
    R.W = Math.round(cssW * dpr); R.H = Math.round(cssH * dpr);
    R.scale = Math.max(0.5, Math.floor(2 * Math.min(R.W / ED.CONST.VIEW_W, R.H / ED.CONST.VIEW_H)) / 2); // screen px per world px, in half steps: one art px (2 world px) is a whole number of screen px
    R.bw = Math.ceil(R.W / R.scale) + 2; R.bh = Math.ceil(R.H / R.scale) + 2; // buffer covers the view plus a 2 px margin for the fractional offset
    for (const w of bufs) { w.width = R.bw; w.height = R.bh; }
    wPrev = false;
    const div = low ? 3 : 2;
    lightCv.width = Math.ceil(R.bw / div); lightCv.height = Math.ceil(R.bh / div);
    R.lightDiv = div;
    Bmp.drop(vignetteH);
    const vc = document.createElement('canvas'); vc.width = 256; vc.height = 256;
    const v = vc.getContext('2d'), vg = v.createRadialGradient(128, 128, 60, 128, 128, 182);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = vg; v.fillRect(0, 0, 256, 256);
    vignetteH = Bmp.hold(vc);
    if (ED.Post) { ED.Post.setVisible(R.quality !== 'low' && !ED.Post.soft); ED.Post.resize(R.W, R.H, R.bw, R.bh); }
    presenting2D = null; setPresent(!R.usePost());
    ED.Tiles.clear(); sprClear();
  };

  R.glowSprite = (color) => {
    const h = glowCache[color]; if (h) return h.v;
    if (++glowN > 300) { for (const k in glowCache) { Bmp.drop(glowCache[k]); delete glowCache[k]; } glowN = 1; }
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, U.rgba(color, 0.9)); gr.addColorStop(0.35, U.rgba(color, 0.35)); gr.addColorStop(1, U.rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache[color] = Bmp.hold(cv);
    return cv;
  };
  R.glow = (c, x, y, r, color, a) => {
    c.globalAlpha = a === undefined ? 1 : a;
    c.drawImage(R.glowSprite(color), x - r, y - r, r * 2, r * 2);
    c.globalAlpha = 1;
  };

  // Light for this frame (world coords). Any draw code may call it before the lighting step; lights are tinted additive
  // pools in the light buffer that is multiplied over the scene. k > 1 overexposes the core.
  R.light = (x, y, r, color, k) => {
    if (nl >= 220) return;
    let L = lights[nl]; if (!L) L = lights[nl] = {};
    L.x = x; L.y = y; L.r = r; L.c = color; L.k = k === undefined ? 1 : k; nl++;
  };
  // Emissive halo drawn additively after lighting (world coords); what bloom picks up.
  R.emit = (x, y, r, color, a) => {
    if (ng >= 400) return;
    let g = glowQ[ng]; if (!g) g = glowQ[ng] = {};
    g.x = x; g.y = y; g.r = r; g.c = color; g.a = a; ng++;
  };

  // Soft cached contact shadow at the current origin; replaces the hard ellipse every sprite used.
  R.shadow = (c, r, a = 0.35, lite) => {
    const w = r * 2.7, h = r * 1.25, y = r * 0.6;
    c.globalAlpha = Math.min(1, a * 1.9);
    c.drawImage(shadowH.v, -w / 2 + shDX * r, y - h / 2 + shDY * r, w, h);
    if (!lite) { c.globalAlpha = Math.min(1, a * 1.1); c.drawImage(shadowH.v, -w * 0.3 + shDX * r * 0.4, y - h * 0.3 + shDY * r * 0.4, w * 0.6, h * 0.6); }
    c.globalAlpha = 1;
  };

  // Screen (device px of the visible canvas) <-> world, exact for the last frame's mapping: camera, scale and screen shake (R.shx / R.shy, device px).
  R.toScreen = (x, y) => ({ x: (x - R.cam.x) * R.scale + R.W / 2 + R.shx, y: (y - R.cam.y) * R.scale + R.H / 2 + R.shy });
  R.toWorld = (sx, sy) => ({ x: (sx - R.W / 2 - R.shx) / R.scale + R.cam.x, y: (sy - R.H / 2 - R.shy) / R.scale + R.cam.y });

  R.updateCamera = (view, focus, dt, snap) => {
    const room = view.room; if (!room) return;
    const rw = room.w * T, rh = room.h * T;
    const vw = R.W / R.scale, vh = R.H / R.scale;
    let tx = focus ? focus.x : rw / 2, ty = focus ? focus.y - 10 : rh / 2;
    tx = vw >= rw ? rw / 2 : U.clamp(tx, vw / 2, rw - vw / 2);
    ty = vh >= rh ? rh / 2 : U.clamp(ty, vh / 2 - 8, rh - vh / 2 + 8);
    if (snap) { R.cam.x = tx; R.cam.y = ty; }
    else { const k = Math.min(1, dt * 8); R.cam.x += (tx - R.cam.x) * k; R.cam.y += (ty - R.cam.y) * k; }
  };

  // Starts a frame: returns the world buffer context (identity transform, buffer px). The buffer origin is set by R.setView (R.frame) or stays at world (0, 0) (camp).
  R.beginWorld = () => {
    Bmp.sweep();
    const now = performance.now();
    if (bwLast) bwMs += (Math.min(50, now - bwLast) - bwMs) * 0.05;
    bwLast = now;
    R.posting = R.usePost();
    if (bufs[0].width !== R.bw || bufs[0].height !== R.bh) { for (const w of bufs) { w.width = R.bw; w.height = R.bh; } wPrev = false; }
    bi ^= 1; buf = bufs[bi]; bctx = bctxs[bi];
    const c = bctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.imageSmoothingEnabled = true;
    R.ix = R.iy = 0; R.fx = R.fy = 0; R.shx = R.shy = 0; R.ox = R.oy = 0;
    return c;
  };
  // Sets the view of this frame: x0 / y0 = world position of the screen's top-left corner (fractional). The buffer starts at its floor; the remainder is applied when presenting.
  R.setView = (x0, y0) => {
    R.ix = Math.floor(x0); R.iy = Math.floor(y0); R.fx = x0 - R.ix; R.fy = y0 - R.iy; R.ox = -x0 * R.scale; R.oy = -y0 * R.scale;
  };
  // Presents the finished frame: WebGL post when active, else a nearest-neighbour blit to the visible canvas. Above ~100 Hz post shows the previous frame's buffer with its own
  // view and grade (one short frame of latency) so the texture upload never waits on the raster just issued; at lower rates it shows the current one.
  R.endWorld = (o) => {
    const c = bctx, t0 = performance.now();
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    let shown = false;
    if (R.posting) {
      o.scale = R.scale; o.fx = R.fx; o.fy = R.fy;
      shown = wPrev && bwMs < 10 && prevO ? ED.Post.render(bufs[bi ^ 1], prevO) : ED.Post.render(buf, o);
    }
    wPrev = R.posting; prevO = o;
    if (shown) setPresent(false);
    else {
      setPresent(true);
      const g = R.ctx; g.imageSmoothingEnabled = false;
      g.drawImage(buf, R.fx, R.fy, R.W / R.scale, R.H / R.scale, 0, 0, R.W, R.H);
    }
    R.stats.post += performance.now() - t0;
    R.posting = false;
  };
  // Post parameters from the FX state (chromatic aberration, flashes) and the lantern.
  R.postOpts = (biome, t, extra) => {
    const F = ED.FX;
    return Object.assign({ biome, t, aberr: F.aberr || 0, flash: F.kick > 0.01 ? [1, 0.92, 0.8, F.kick * 0.22] : null, lightLevel: 0.6 + 0.4 * R.lightLevel }, extra); // post-process darkening (saturation, vignette) stays mild
  };

  // ---------------- light buffer (buffer-pixel space, reused by the camp) ----------------
  function lightSprite(color) {
    const h = lightCache[color]; if (h) return h.v;
    if (++lightN > 90) { for (const k in lightCache) { Bmp.drop(lightCache[k]); delete lightCache[k]; } lightN = 1; }
    const s = document.createElement('canvas'); s.width = s.height = 96;
    const g = s.getContext('2d'), gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, U.rgba(color, 0.95)); gr.addColorStop(0.16, U.rgba(color, 0.74)); gr.addColorStop(0.4, U.rgba(color, 0.42));
    gr.addColorStop(0.66, U.rgba(color, 0.17)); gr.addColorStop(0.86, U.rgba(color, 0.05)); gr.addColorStop(1, U.rgba(color, 0)); // long soft shoulder: pools blend instead of ending in a hard edge
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    lightCache[color] = Bmp.hold(s);
    return s;
  }
  R.lightBegin = (rgb) => {
    lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1;
    lctx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
    lctx.fillRect(0, 0, lightCv.width, lightCv.height);
    lctx.globalCompositeOperation = 'lighter';
  };
  // Adds a coloured pool at buffer pixel (sx, sy) with radius rr (px).
  R.lightAdd = (sx, sy, rr, color, k) => {
    const div = R.lightDiv; sx /= div; sy /= div; rr /= div;
    if (sx + rr < 0 || sy + rr < 0 || sx - rr > lightCv.width || sy - rr > lightCv.height || k <= 0.01) return;
    const spr = lightSprite(color);
    lctx.globalAlpha = Math.min(1, k); lctx.drawImage(spr, sx - rr, sy - rr, rr * 2, rr * 2);
    if (k > 1) { lctx.globalAlpha = Math.min(1, k - 1); lctx.drawImage(spr, sx - rr, sy - rr, rr * 2, rr * 2); }
  };
  R.lightEnd = (c) => {
    lctx.globalAlpha = 1; lctx.globalCompositeOperation = 'source-over';
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = true; c.globalCompositeOperation = 'multiply';
    c.drawImage(lightCv, 0, 0, R.bw, R.bh);
    c.restore();
  };
  // Ambient colour: palette darkColor gives the hue, darkness gives the level; a lower lantern deepens it.
  const ambCache = {}, ambOut = [0, 0, 0];
  R.ambient = (biome, extraDark, redden) => {
    const P = biome.pal;
    let tint = ambCache[biome.id];
    if (!tint) {
      const d = U.hexToRgb(P.darkColor), m = Math.max(d[0], d[1], d[2], 1), n = d.map(v => 0.72 + 0.28 * (v / m));
      const lum = 0.299 * n[0] + 0.587 * n[1] + 0.114 * n[2];
      tint = ambCache[biome.id] = n.map(v => v / lum);
    }
    const dark = U.clamp(P.darkness + extraDark, 0, 0.92);
    const lum = (R.quality === 'low' ? 0.22 : 0.18) + 0.5 * (1 - dark), o = ambOut; // shared result: consumed by lightBegin right away
    for (let i = 0; i < 3; i++) o[i] = U.clamp(tint[i] * lum, 0, 1);
    if (redden > 0) { o[0] = o[0] * (1 + redden * 0.5); o[1] *= 1 - redden * 0.45; o[2] *= 1 - redden * 0.45; }
    for (let i = 0; i < 3; i++) o[i] = U.clamp(o[i], 0, 1) * 255;
    return o;
  };

  // ---------------- main frame ----------------
  R.frame = (view, local, t, dt) => {
    const t0 = performance.now(), c = R.beginWorld(), room = view.room, F = ED.FX, S = R.scale;
    const biome = ED.biomeFor(view.stratum || 1), P = biome.pal;
    ED.Atlas.tick();
    const atlasOn = AC.on();
    if (atlasOn) AC.begin(view, t);
    curView = view;
    foeTick(view.stratum || 1);
    c.fillStyle = P.void; c.fillRect(0, 0, R.bw, R.bh);
    nl = 0; ng = 0; stN = 0; R.local = local;
    { const me = view.players && view.players.get(local); R.mainPath = me ? ED.mainPath(me.boons) : null; } // path of 'boon' door and prop glyphs
    R.simT = view.renderT || view.time || 0; // sim-time clock for hazards drawn from sim state: interpolated host time on clients, world time otherwise
    if (!room) { R.endWorld(R.postOpts(biome, t)); return; }
    let swx = 0, swy = 0; // screen shake in world px
    if (F.shake > 0) { const a = F.shake * 0.55; swx = (Math.sin(t * 71) + Math.sin(t * 43 + 1.7) * 0.6) * a * 0.62; swy = (Math.cos(t * 67) + Math.sin(t * 51 + 0.4) * 0.6) * a * 0.62; }
    R.shx = swx * S; R.shy = swy * S;
    R.setView(R.cam.x - R.W / (2 * S) - swx, R.cam.y - R.H / (2 * S) - swy);
    const ix = R.ix, iy = R.iy, low = R.quality === 'low';
    c.setTransform(1, 0, 0, 1, -ix, -iy);
    // ---- lit pass ----
    const art = ED.Tiles.get(room, BQ);
    c.drawImage(art, 0, 0, art.width / BQ, art.height / BQ);
    drawRoomDynamics(c, view, room, biome, t, 0);
    drawDoors(c, view, room, P, t);
    drawZones(c, view, t, 0);
    drawPickups(c, view, t, 0);
    const artProps = R.propArt();
    if (!artProps) drawProps(c, view, local, t);
    let dn = 0, nFoe = 0;
    for (const p of view.players.values()) qDraw(dn++, p.y, 0, p);
    for (const e of view.enemies) if (e.hp > 0) { qDraw(dn++, e.y, 1, e); nFoe++; }
    for (const a of view.allies) qDraw(dn++, a.y, 2, a);
    for (const s of ED.Tiles.statics(room)) qDraw(dn++, s.key, 3, s); // tall pieces of the room art (columns, standing decor, door arch)
    if (artProps) for (const p of view.props) qDraw(dn++, p.y, 4, p); // pixel-art props sort with the entities
    crowdLod(view, local, nFoe, dn);
    for (const z of view.zones) if ((z.kind === 'fire' || z.kind === 'pfire') && fireFade(z) > 0.01) { // fire flames: kind 5 entries (3 and 4 are the room's statics and props), d = flame index
      const nf = fireCount(z), vis = Math.max(1, Math.ceil(nf * fireFade(z)));
      for (let i = 0; i < vis; i++) { flamePos(z, i); qDraw(dn, flY, 5, z); drawPool[dn++].d = i; }
    }
    drawList.length = dn; drawList.sort(byY);
    for (const it of drawList) {
      if (it.k === 3) { ED.Tiles.drawStatic(c, room, biome, it.o, view, t); continue; }
      if (it.k === 4) { shDX = shDY = 0; drawProp(c, it.o, view, local, t); continue; }
      if (it.k === 5) { drawFlame(c, it.o, it.d, t); continue; }
      const o = it.o, rim = low ? null : rimLight(o.x, o.y, it.k === 0 ? 16 : 0), still = atlasOn && it.k < 2 && AC.still(o), px = still ? Math.round(o.x / 2) * 2 : Math.round(o.x), py = still ? Math.round(o.y / 2) * 2 : Math.round(o.y); // feet on the buffer pixel grid (the 2 px art grid while standing still)
      if (rim) { shDX = -rim.dx * 0.28; shDY = -rim.dy * 0.12; } else { shDX = 0; shDY = 0; }
      if (it.k === 1) { // foe: atlas art (pose offsets are art-px steps), else the procedural look with pose offset, lean and squash (F.xform) in one matrix with the mirror
        const bx = px - ix, by = py - iy;
        if (!(atlasOn && AC.foe(c, o, t, !it.full, bx, by))) {
          const X = F.xform(o), m = o.face < 0 ? -1 : 1;
          if (X) { const cr = Math.cos(X.rot), sr = Math.sin(X.rot); c.setTransform(m * cr * X.sx, m * sr * X.sx, -sr * X.sy, cr * X.sy, bx + X.dx, by + X.dy); } else c.setTransform(m, 0, 0, 1, bx, by);
          foe(c, o, t, !it.full);
        }
        c.setTransform(1, 0, 0, 1, bx, by);
        if (rim && rim.s > 0.35 && it.full) R.glowOnce(c, 0, -o.r * 1.2, o.r * 1.5, rim.col, 0.14 * rim.s, rim.dx * o.r * 0.55, rim.dy * o.r * 0.4);
        drawStatus(c, o, t, it.full);
        c.setTransform(1, 0, 0, 1, -ix, -iy);
      } else {
        c.save(); c.translate(px, py);
        if (it.k === 0) {
          Sp.hero(c, o, t, F.anim[o.pid]);
          if (rim && rim.s > 0.35 && !o.dead) R.glowOnce(c, 0, -12, 17, rim.col, 0.15 * rim.s, rim.dx * 7, rim.dy * 5); // lit-side rim stand-in (additive glow toward the light)
        } else Sp.minion(c, o, t);
        c.restore();
      }
      if (it.k === 0) { c.save(); c.translate(px, py); drawHeroFx(c, o, t); c.restore(); }
      if (it.k === 0 && !o.dead && !low) F.dashTrail && F.dashTrail(o, t);
    }
    shDX = shDY = 0;
    drawProjectiles(c, view, t, 0);
    F.drawWorld(c);
    if (!low) drawMotes(c, view, room, biome, t, dt, 0);
    // ---- lighting ----
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawLighting(c, view, room, biome, local, t, ix, iy);
    // ---- unlit sprite pass: opaque pixel art (shots, zone sprites, sprite effects) keeps its colours in any light ----
    c.setTransform(1, 0, 0, 1, -ix, -iy);
    drawZones(c, view, t, 2);
    drawProjectiles(c, view, t, 2);
    F.drawSprites(c);
    // ---- emissive pass (unlit, additive: bloom catches it) ----
    c.setTransform(1, 0, 0, 1, -ix, -iy);
    c.globalCompositeOperation = 'lighter';
    const emis = ED.Tiles.emissive(room, BQ);
    if (emis) { c.globalAlpha = 0.82 + Math.sin(t * 2.1) * 0.1 + Math.sin(t * 5.3) * 0.05; c.drawImage(emis, 0, 0, emis.width / emis.px, emis.height / emis.px); c.globalAlpha = 1; }
    drawRoomDynamics(c, view, room, biome, t, 1);
    drawPickups(c, view, t, 1);
    drawZones(c, view, t, 1);
    drawProjectiles(c, view, t, 1);
    if (!low) drawMotes(c, view, room, biome, t, dt, 1);
    const eyeA = 0.2 + P.darkness * 0.5;
    for (let i = 0; i < dn; i++) {
      const it = drawList[i], e = it.o; if (it.k !== 1 || e.burrowed) continue;
      const an = atlasOn ? AC.anchor(e) : null;
      if (it.full) { if (an) { for (const ey of an.eye) R.glow(c, e.x + ey[0], e.y + ey[1], 5 + e.r * 0.5, e.def.col.c, eyeA); } else R.glow(c, e.x, e.y - e.r * (e.def.fly ? 2.2 : 1.7), 5 + e.r * 0.5, e.def.col.c, eyeA); }
      const wp = atlasOn ? AC.windupP(e) : F.windupP(e); if (wp > 0.05) R.glow(c, e.x, e.y + (an ? an.cy : -e.r * 1.2), e.r * (1.5 + wp), wp > 0.8 ? '#ffd0a0' : '#ff5a3a', 0.12 + 0.5 * wp * wp);
    }
    for (let i = 0; i < ng; i++) { const g = glowQ[i]; R.glow(c, g.x, g.y, g.r, g.c, g.a); }
    F.drawGlow(c, t);
    c.globalCompositeOperation = 'source-over';
    // ---- overlays above lighting ----
    drawOverheads(c, view, local, t);
    if (ED.AimFx) ED.AimFx.draw(c, view);
    F.drawTexts(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (R.syncWorld) c.getImageData(0, 0, 1, 1); // benchmarking: force the 2D raster to finish
    R.stats.world += performance.now() - t0; R.stats.n++;
    R.endWorld(R.postOpts(biome, t, view.pact > 0 ? { vig: 0.42 + Math.min(0.2, view.pact * 0.02) } : null));
  };

  // Y-sorted entity list: items are pooled by index, so a frame allocates nothing.
  const drawList = [], drawPool = [], byY = (a, b) => a.y - b.y;
  const qDraw = (i, y, k, o) => { let it = drawPool[i]; if (!it) it = drawPool[i] = { y: 0, k: 0, o: null, full: true, d: 0 }; it.y = y; it.k = k; it.o = o; it.full = true; drawList[i] = it; };

  // One-shot additive-style glow drawn at an offset (rim-light stand-in for plain enemies).
  R.glowOnce = (c, x, y, r, color, a, dx, dy) => {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    R.glow(c, x + dx, y + dy, r, color, a); c.globalCompositeOperation = prev;
  };

  // Strongest nearby light as seen from (x, y): direction toward it, colour and strength 0..1 (null when none).
  function rimLight(x, y, skip) {
    let best = null, bs = 0.12;
    for (let i = 0; i < rimN; i++) {
      const L = rimSrc[i];
      const dx = L.x - x, dy = L.y - y, d2 = dx * dx + dy * dy;
      if (d2 < skip * skip || d2 < 400) continue;
      const s = Math.min(1.2, L.k) * L.r * L.r / (d2 + L.r * L.r) - 0.12;
      if (s > bs) { bs = s; best = L; }
    }
    if (!best) return null;
    const dx = best.x - x, dy = best.y - y, d = Math.hypot(dx, dy) || 1;
    rimOut.dx = dx / d; rimOut.dy = dy / d; rimOut.col = best.c; rimOut.s = Math.min(1, bs * 1.6);
    return rimOut; // shared: consumed before the next call
  }

  // ---------------- room details ----------------
  function drawRoomDynamics(c, view, room, biome, t, pass) {
    if (ED.Tiles.drawDyn(c, room, biome, t, pass, R.quality === 'low')) return; // art rooms animate their own torches, pools and spikes
    const P = biome.pal;
    if (pass === 0) {
      // spike traps cycle
      if (biome.hazard === 'spikes') {
        const up = (t % 1.8) < 0.7, warn = !up && (t % 1.8) > 1.45;
        for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (room.tiles[y * room.w + x] === 4) {
          if (up) {
            c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x * T + 4, y * T + 6, T - 8, T - 8);
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
              const px = x * T + 8 + i * 8, py = y * T + 8 + j * 8;
              c.fillStyle = '#8a8676'; c.beginPath(); c.moveTo(px - 2.4, py + 1.5); c.lineTo(px, py - 6); c.lineTo(px + 2.4, py + 1.5); c.fill();
              c.fillStyle = '#e4dfcc'; c.beginPath(); c.moveTo(px - 0.6, py + 1.5); c.lineTo(px, py - 6); c.lineTo(px + 2.4, py + 1.5); c.fill();
            }
          } else if (warn) { c.fillStyle = 'rgba(255,90,60,0.22)'; c.fillRect(x * T + 2, y * T + 2, T - 4, T - 4); }
        }
      }
      return;
    }
    // torch flames (biome-tinted fire), flickering
    for (const tc of room.torches) {
      const x = tc.x * T, y = tc.y * T - 6, f = Math.sin(t * 13 + x) * 1.2 + Math.sin(t * 23 + x * 1.7) * 0.7;
      c.fillStyle = U.rgba(P.light, 0.95); c.beginPath(); c.moveTo(x - 3.8, y + 2); c.quadraticCurveTo(x - 3.4, y - 6 + f, x + f * 0.3, y - 11 + f); c.quadraticCurveTo(x + 3.4, y - 6 - f, x + 3.8, y + 2); c.fill();
      c.fillStyle = U.mix(P.light, '#ffffff', 0.72); c.beginPath(); c.ellipse(x, y - 1.5, 1.8, 3.6 + f * 0.2, 0, 0, U.TAU); c.fill();
      R.glow(c, x, y - 4, 22 + f * 2, P.light, 0.5);
    }
    // glows from room lights (fungus, lava, candles...)
    for (const d of ED.Tiles.dynamics(room)) {
      if (d.k === 'torch') continue;
      const fl = d.k === 'hz' ? 0.55 + Math.sin(t * 1.6 + d.x * 0.07 + d.y * 0.05) * 0.25 : 0.7 + Math.sin(t * 2 + d.x) * 0.2;
      R.glow(c, d.x, d.y, d.r * 0.55, d.color, (biome.hazard === 'water' && d.k === 'hz' ? 0.09 : 0.22) * fl);
    }
    if (biome.hazard === 'water' && R.quality !== 'low') {
      c.strokeStyle = 'rgba(160,240,255,0.3)'; c.lineWidth = 0.8;
      for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (room.tiles[y * room.w + x] === 4) { const k = (t * 0.6 + (x + y) * 0.3) % 1; c.globalAlpha = 1 - k; c.beginPath(); c.ellipse(x * T + 16, y * T + 16, 4 + k * 10, 2 + k * 5, 0, 0, U.TAU); c.stroke(); }
      c.globalAlpha = 1;
    }
    if (biome.hazard === 'lava' && R.quality !== 'low') {
      // drifting bubbles on the lava
      for (const d of ED.Tiles.dynamics(room)) {
        if (d.k !== 'hz') continue;
        for (let i = 0; i < 2; i++) {
          const k = (t * 0.35 + d.x * 0.013 + i * 0.5) % 1, bx = d.x + Math.sin(d.y * 0.3 + i * 3 + t * 0.6) * 9, by = d.y + Math.cos(d.x * 0.2 + i * 2) * 7;
          c.globalAlpha = Math.sin(k * Math.PI) * 0.7; c.fillStyle = '#ffdc7a'; c.beginPath(); c.arc(bx, by, 0.8 + k * 2.2, 0, U.TAU); c.fill();
        }
      }
      c.globalAlpha = 1;
    }
  }

  function drawDoors(c, view, room, P, t) {
    if (!view.locked) {
      // open exits: a soft biome-coloured pool beckons from each doorway
      for (const d in room.doors) {
        if (room.doors[d] < 0) continue;
        const r = ED.Dungeon.doorRect(room, d), cx = (r.x0 + r.x1 + 1) / 2 * T, cy = (r.y0 + r.y1 + 1) / 2 * T, k = 0.7 + Math.sin(t * 1.8 + cx * 0.01) * 0.1;
        R.light(cx, cy, 80, P.accent, 0.3 * k); R.emit(cx, cy, 30, P.accent, 0.16 * k);
      }
      for (const pv of doorPreviews(view, room, t)) { R.light(pv.x, pv.y, 62, pv.color, 0.55); R.emit(pv.x, pv.y, 22, pv.color, 0.32 + Math.sin(t * 2.4 + pv.x * 0.02) * 0.08); }
      return;
    }
    for (const d in room.doors) {
      if (room.doors[d] < 0) continue;
      const r = ED.Dungeon.doorRect(room, d);
      const x0 = r.x0 * T, y0 = r.y0 * T, x1 = (r.x1 + 1) * T, y1 = (r.y1 + 1) * T;
      const pulse = 0.55 + Math.sin(t * 4) * 0.2, w = x1 - x0, h = y1 - y0, ns = d === 'n' || d === 's';
      if (ED.Tiles.drawGate(c, room, ED.biomeFor(view.stratum || 1), d)) { R.light((x0 + x1) / 2, (y0 + y1) / 2, 70, P.accent, 0.35 * pulse); R.emit((x0 + x1) / 2, (y0 + y1) / 2, 42, P.accent, 0.5 * pulse); continue; }
      const ds = sprite('dr' + (ns ? 'h' : 'v') + w + '|' + h, 0, 0, w, h, false, (g) => { // dark gate with iron bars, baked per size
        g.fillStyle = 'rgba(14,8,6,0.92)'; g.fillRect(0, 0, w, h);
        const bar = (a, b, c2, d2) => {
          g.strokeStyle = '#1a1412'; g.lineWidth = 4.2; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke();
          g.strokeStyle = '#6a5a50'; g.lineWidth = 2.4; g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(a - 0.8, b); g.lineTo(c2 - 0.8, d2); g.stroke();
        };
        if (ns) { for (let x = 8; x < w; x += 12) bar(x, 0, x, h); } else { for (let y = 8; y < h; y += 12) bar(0, y, w, y); }
      });
      c.drawImage(ds.cv, x0, y0, ds.w, ds.h);
      R.light((x0 + x1) / 2, (y0 + y1) / 2, 70, P.accent, 0.35 * pulse);
      R.emit((x0 + x1) / 2, (y0 + y1) / 2, 42, P.accent, 0.5 * pulse);
    }
  }

  // ---------------- baked sprites ----------------
  // Vector overlays (telegraphs, statuses, shots, flames, labels) are painted once into small canvases at world resolution and blitted afterwards:
  // one drawImage replaces dozens of path ops. Cached by shape key; bounded by pixel count. A baked canvas is drawn until its ImageBitmap is ready, then swapped (Gecko pays per source canvas, not per bitmap);
  // every sprite is tracked in `live` and its bitmap released (closed two frames later) when the cache drops it.
  const spr = new Map(), txtCache = new Map(), live = new Set();
  let sprPx = 0, sprGen = 0, bakeLeft = 0;
  const SPR_PX_MAX = 16e6, BAKE_PER_FRAME = 10, NF_POISON = 16;
  const numC = new Map();
  function freeSp(s) { if (s && !s.dead) { s.dead = true; live.delete(s); Bmp.free(s.cv); } }
  function dropText() { for (const s of txtCache.values()) freeSp(s); for (const s of numC.values()) freeSp(s); txtCache.clear(); numC.clear(); }
  function sprClear() { for (const s of live) { s.dead = true; Bmp.free(s.cv); } live.clear(); spr.clear(); dropText(); sprPx = 0; sprGen++; }
  if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', dropText); // text baked with a fallback face is rebuilt once the webfont arrives
  // Bakes paint(g) into a canvas covering the box [x0,x1] x [y0,y1] of the painter's local space (add: additive compositing, so the blit equals drawing the parts additively).
  // Returns { cv, x, y, w, h }: the draw rectangle in the same local space (1 texel = 1 buffer pixel; the box snaps outward to the texel grid).
  function bake(x0, y0, x1, y1, add, paint) {
    const Q = BQ; x0 = Math.floor(x0 * Q) / Q; y0 = Math.floor(y0 * Q) / Q; x1 = Math.ceil(x1 * Q) / Q; y1 = Math.ceil(y1 * Q) / Q;
    const cw = Math.max(1, Math.round((x1 - x0) * Q)), ch = Math.max(1, Math.round((y1 - y0) * Q));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    g.setTransform(Q, 0, 0, Q, -x0 * Q, -y0 * Q);
    if (add) g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    paint(g);
    sprPx += cw * ch;
    const s = { cv, x: x0, y: y0, w: cw / Q, h: ch / Q, dead: false };
    live.add(s);
    Bmp.from(cv, (b) => { if (s.dead) Bmp.free(b); else s.cv = b; });
    return s;
  }
  // Keyed sprite: baked on first use.
  function sprite(key, x0, y0, x1, y1, add, paint) {
    let s = spr.get(key);
    if (s) return s;
    if (sprPx > SPR_PX_MAX) sprClear();
    s = bake(x0, y0, x1, y1, add, paint); spr.set(key, s);
    return s;
  }
  // Animation frame i (of nf) of series `arr`, baked lazily: at most BAKE_PER_FRAME new bakes per render, otherwise the nearest earlier frame stands in.
  function frameOf(arr, base, i, nf, make) {
    let s = arr[base + i];
    if (s) return s;
    if (bakeLeft <= 0) for (let d = 1; d < nf; d++) { s = arr[base + (i + nf - d) % nf]; if (s) return s; }
    bakeLeft--;
    if (sprPx > SPR_PX_MAX) sprClear();
    return (arr[base + i] = make());
  }
  // Blit with the sprite origin at world (x, y), snapped to the buffer pixel grid (crisp bars and text); the base transform is an integer translation.
  function blit(c, s, x, y) { c.drawImage(s.cv, Math.round(x + s.x), Math.round(y + s.y), s.w, s.h); }
  // Per-shape sprite arrays for foes (see drawStatus): shared by every foe with the same silhouette; reset when the cache is dropped.
  const geoms = new Map();

  // ---------------- foe flipbooks ----------------
  // Foes are painted once per (look frame, pose, tint, size, facing) into small canvases at world resolution (Sp.FOE) and blitted: one drawImage replaces ~120 path ops.
  // Float bob and the windup shake apply at blit time; aimed parts and shield arcs are live overlays. Frames bake lazily on the shared per-frame budget: until a frame exists
  // the nearest baked one stands in and a group with none yet is drawn live. Foe pixels have their own cap (least recently used looks go first); the cache is cleared on stratum change and whenever the shared cache is.
  const foeTC = new Map(), FOE_PX_MAX = 16e6, FOE_WARM = 4;
  let foePx = 0, foeGen = 0, foeStratum = 0, foeFr = 0, warmQ = [], warmI = 0;
  R.foeCache = true;
  function freeLook(tc) { for (const grp of tc) if (grp) for (const sp of grp) freeSp(sp); }
  function foeClear() { for (const tc of foeTC.values()) freeLook(tc); foeTC.clear(); foePx = 0; warmQ.length = 0; warmI = 0; }
  function foeFrames(e, spec, state, tint) {
    if (foeGen !== sprGen) { foeGen = sprGen; foeClear(); }
    let tc = foeTC.get(e.def); if (!tc) { foeTC.set(e.def, tc = []); tc.px = 0; }
    tc.u = foeFr;
    const v = (((e.r * 3 + tint) * spec.ns + state) << 1) | (spec.face && e.face < 0 ? 1 : 0);
    return tc[v] || (tc[v] = []);
  }
  function foeBake(e, spec, state, tint, f) {
    const Q = BQ, s = e.r / e.def.r, b = spec.box, pad = 1.2;
    const x0 = Math.floor((b[0] * s - pad) * Q) / Q, y0 = Math.floor((b[1] * s - pad) * Q) / Q; // origin on the pixel grid: the blit copies texels 1:1
    let halos = null;
    const sp = bake(x0, y0, x0 + Math.ceil((b[2] * s + pad) * Q - x0 * Q) / Q, y0 + Math.ceil((b[3] * s + pad) * Q - y0 * Q) / Q, false, (g) => { halos = Sp.paintFoe(g, e, spec, state, tint, f); });
    const px = sp.cv.width * sp.cv.height; foePx += px; sprPx -= px; foeTC.get(e.def).px += px; // foe pixels are budgeted apart from the shared cache
    sp.halos = halos; // big soft glows of the frame, drawn live under it
    return sp;
  }
  function foeSprite(e, spec, state, tint, f) {
    const grp = foeFrames(e, spec, state, tint);
    let sp = grp[f];
    if (sp) return sp;
    if (bakeLeft > 0 && foePx < FOE_PX_MAX) { bakeLeft--; return (grp[f] = foeBake(e, spec, state, tint, f)); }
    const n = spec.N;
    for (let d = 1; d <= n >> 1; d++) { sp = grp[(f + n - d) % n] || grp[(f + d) % n]; if (sp) return sp; }
    return null;
  }
  function foeHalos(c, hs, dy) {
    for (const h of hs) { c.globalAlpha = h.a; c.drawImage(R.glowSprite(h.col), h.x - h.r, h.y + dy - h.r, h.r * 2, h.r * 2); }
    c.globalAlpha = 1;
  }
  // Draws foe e at the current transform (its feet, x mirrored when it faces left): the cached frame when there is one, else the live sprite. lite: single shadow layer.
  // The transform is left changed (shake, mirror): the caller resets it.
  function foe(c, e, t, lite) {
    const spec = R.foeCache ? Sp.foeSpec(e) : null;
    if (spec && e.st !== 'fade' && e.st !== 'burrow' && e.r === (e.r | 0)) {
      const state = spec.st(e);
      if (state >= 0) {
        const tint = e.flash > 0 ? 1 : e.frozen > 0 ? 2 : 0; // a frozen foe holds its pose
        let f = tint === 2 ? 0 : Sp.foeFrame(spec, state, e, t);
        if (tint === 1) f -= f % (spec.N >> 4 || 1); // a hit flash lasts ~0.1 s: slightly coarser frames bake fewer variants
        const sp = foeSprite(e, spec, state, tint, f);
        if (sp) {
          const mir = e.face < 0;
          if (mir) shDX = -shDX; // the shadow skew is in screen space
          Sp.foeBack(c, e, t, lite);
          if (mir) shDX = -shDX;
          const s = e.r / e.def.r, fl = spec.fl, dy = fl ? Math.sin(t * fl[0] + e.id) * fl[1] * (fl[2] ? s : 1) : 0;
          let tq = 0, C = null;
          if (spec.pre || spec.post) { tq = Sp.foeTq(spec, state, f); C = Sp.foePal(e, tint); }
          const sx = (e.st === 'windup' || e.st === 'aim' || e.st === 'cast' || e.pose === 'wind') && Math.floor(t * 14) % 2 === 0 ? Math.sin(t * 60) * 0.8 : 0;
          if (sx) c.translate(mir ? -sx : sx, 0); // telegraph shake
          if (mir && spec.face) c.scale(-1, 1); // the frames of this look carry their facing
          if (sp.halos && !spec.over) foeHalos(c, sp.halos, dy);
          if (spec.pre) spec.pre(c, e, C, tq, s, dy);
          c.drawImage(sp.cv, sp.x, sp.y + dy, sp.w, sp.h);
          if (sp.halos && spec.over) foeHalos(c, sp.halos, dy);
          if (spec.post) spec.post(c, e, C, tq, s, dy);
          return;
        }
      }
    }
    if (e.face < 0) c.scale(-1, 1); // Sp.enemy mirrors itself
    Sp.enemy(c, e, t);
  }
  R.foeStats = () => { let n = 0; for (const tc of foeTC.values()) for (const g of tc) if (g) n += g.filter(Boolean).length; return { frames: n, px: foePx, mb: +(foePx * 4 / 1048576).toFixed(1), sharedPx: sprPx }; };
  R.drawFoe = (c, e, t, lite) => { c.save(); if (e.face < 0) c.scale(-1, 1); foe(c, e, t, lite); c.restore(); };
  // Anchors { cx, cy, top, eye: [[x, y]...] } of a foe or hero in world px from its feet: its current atlas anim, else the procedural sizes. The fallback object is shared: read it before the next call.
  const ancFb = { cx: 0, cy: 0, top: 0, eye: [[0, 0]] };
  R.actorAnchor = (o) => {
    const a = AC.on() ? AC.anchor(o) : null;
    if (a) return a;
    const r = o.r || 10, fb = ancFb, d = o.def, fly = !!(d && d.fly);
    if (!d) { fb.cx = 0; fb.cy = -14; fb.top = -38; fb.eye[0][0] = 2; fb.eye[0][1] = -26; return fb; }
    const bh = fly ? r * 2.6 : (LOOK_H[d.look] || r * 2.7) * (r / d.r);
    fb.cx = 0; fb.cy = fly ? -r * 1.7 : -bh * 0.5; fb.top = -bh; fb.eye[0][0] = 0; fb.eye[0][1] = -r * (fly ? 2.2 : 1.7);
    return fb;
  };
  R.sprite = sprite;
  R.bakeBudget = (n) => { bakeLeft = n; }; // frames the shared cache may bake before the next frame resets it
  // Entering a stratum drops the old roster's frames and queues the new roster's idle frames, FOE_WARM baked per rendered frame.
  function foeTick(stratum) {
    if (AC.on()) { if (stratum !== foeStratum) { foeStratum = stratum; AC.warm(stratum); } AC.pump(); return; } // atlas art: recoloured sheets are queued per stratum, no flipbooks
    if (foeGen !== sprGen) { foeGen = sprGen; foeStratum = 0; } // the shared cache was dropped (resize, overflow): frames are rebuilt
    if (stratum !== foeStratum) {
      foeStratum = stratum; foeClear();
      const defs = [];
      for (const [id] of ED.biomeFor(stratum).enemies) { const d = ED.ENEMIES[id]; if (d && Sp.FOE[d.look] && defs.indexOf(d) < 0) defs.push(d); }
      for (let f = 0; f < 40; f++) for (const d of defs) if (f < Sp.FOE[d.look].N) warmQ.push({ def: d, r: d.r, face: 1, id: 0, st: 'move', f });
    } else if (foePx >= FOE_PX_MAX) { // over the cap: drop the least recently used looks down to 70%
      for (const [d, tc] of [...foeTC].sort((a, b) => a[1].u - b[1].u)) { if (foePx < FOE_PX_MAX * 0.7) break; foeTC.delete(d); foePx -= tc.px; freeLook(tc); }
    }
    foeFr++;
    for (let k = 0; k < FOE_WARM && warmI < warmQ.length; k++, warmI++) {
      const w = warmQ[warmI], spec = Sp.FOE[w.def.look], grp = foeFrames(w, spec, 0, 0);
      if (!grp[w.f]) grp[w.f] = foeBake(w, spec, 0, 0, w.f);
    }
  }
  // Above CROWD_N live foes only elites, bosses and the NEAR_N foes nearest the hero keep full detail (rim light, second shadow layer, eye glow) and FX bursts thin out.
  const CROWD_N = 30, NEAR_N = 12;
  let nearD = new Float64Array(128);
  function crowdLod(view, local, n, dn) {
    ED.FX.crowd = n > CROWD_N ? Math.max(0.5, CROWD_N / n) : 1;
    if (n <= CROWD_N) return;
    const me = view.players.get(local), cx = me ? me.x : R.cam.x, cy = me ? me.y : R.cam.y;
    if (nearD.length < n) nearD = new Float64Array(n * 2);
    let m = 0;
    for (let i = 0; i < dn; i++) { const it = drawList[i]; if (it.k !== 1) continue; const dx = it.o.x - cx, dy = it.o.y - cy; it.d = dx * dx + dy * dy; nearD[m++] = it.d; }
    const thr = nearD.subarray(0, m).sort()[NEAR_N - 1];
    for (let i = 0; i < dn; i++) { const it = drawList[i]; if (it.k === 1) it.full = !!(it.o.elite || it.o.boss) || it.d <= thr; }
  }

  // ---------------- zones ----------------
  // Three passes: 0 = everything on the ground (fills, rims, rings, caltrops, smoke, the Sanctuary circle; lit by the scene and drawn before the actors), 1 = unlit additive edges and glows, 2 = unlit airborne sprites drawn over the actors (falling arrows, the meteor, a lobbed orb). Everything is pixel art on the 2 px grid:
  // pixel disc / ring sprites (ED.Pix, cached), telegraph lanes and cones filled in 2 px rows straight from their geometry (exact for any angle, nothing cached), atlas sprites for flames, smoke and arrows.
  // Hero zones (pfire, plague, sanct, rain...) get a dashed bright rim and a 0.25 fill, hostile zones a solid rim.
  const RED = '#ff3a22', GOLD = '#ffc94a';
  const TRING = { 0: ['#b81c10', '#ff5a3a', '#ffb080'], 1: ['#a87a1c', '#ffc94a', '#fff0b0'] }; // telegraph ring bands: hostile, friendly
  const sx2 = (v) => Pix.s2(v);
  const ringPut = (c, x, y, r, th, bands, a, dash, ph) => Pix.put(c, Pix.ring(Math.max(2, Math.round(r / 2)), th, bands[0], bands[1], bands[2], dash, ph), sx2(x), sx2(y), a);
  const discPut = (c, x, y, r, col, a) => Pix.put(c, Pix.disc(Math.max(1, Math.round(r / 2)), col), sx2(x), sx2(y), a);
  const gb = (col) => { const rp = Pix.ramp(col); return [rp[2], rp[3], rp[4]]; }; // ring bands of a colour
  const poly = [];
  // Lane polygon (origin x, y; direction a; from distance off to len; width w) into `poly`; returns the vertex count.
  function lanePoly(x, y, a, off, len, w) {
    const co = Math.cos(a), si = Math.sin(a), h = w / 2;
    poly[0] = x + co * off + si * h; poly[1] = y + si * off - co * h; poly[2] = x + co * len + si * h; poly[3] = y + si * len - co * h;
    poly[4] = x + co * len - si * h; poly[5] = y + si * len + co * h; poly[6] = x + co * off - si * h; poly[7] = y + si * off + co * h;
    return 4;
  }
  // Ground blob of a poison pool (two tones with alpha) baked per (kind, radius, frame): six orbiting lobes over a darker core, ragged dithered rim, on the art grid.
  function poolSprite(plague, rA, f) {
    const H = Math.round(rA * 1.64);
    return Pix.bake('pool|' + (plague ? 1 : 0) + '|' + rA + '|' + f, rA * 2, H, rA, H / 2, (b, w) => {
      const p0 = f / NF_POISON * 1.05, lobe = Pix.px32a(plague ? '#4a7a2a' : '#2f5a1c', 0.4), core = Pix.px32a('#1c3a12', 0.34), rb = rA;
      for (let y = 0; y < H; y++) for (let x = 0; x < rA * 2; x++) {
        const px = x + 0.5 - rA, py = y + 0.5 - H / 2;
        let v = 0;
        if ((px * px) / ((rb * 0.8) ** 2) + (py * py) / ((rb * 0.55) ** 2) <= 1) v = core;
        for (let i = 0; i < 6 && v !== lobe; i++) {
          const a = i * 1.05 + p0, ca = Math.cos(a), sa = Math.sin(a), qx = px - ca * rb * 0.35, qy = py - sa * rb * 0.24, u = qx * ca + qy * sa, vv = -qx * sa + qy * ca;
          if ((u * u) / ((rb * 0.55) ** 2) + (vv * vv) / ((rb * 0.38) ** 2) <= 1) v = lobe;
        }
        if (v && ((x + y) & 1) === 0 && Math.hypot(px, py / 0.7) > rb * 0.8) continue;
        if (v) b[y * w + x] = v;
      }
    });
  }
  // Scorch / mire patch: a static ragged ground ellipse (two tones), baked per (colour, radius).
  function patchSprite(col, rA) {
    return Pix.bake('patch|' + col + '|' + rA, rA * 2, Math.max(2, Math.round(rA * 1.4)), rA, Math.max(1, Math.round(rA * 0.7)), (b, w, h) => {
      const p = Pix.px32a(col, 0.55);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot((x + 0.5 - w / 2) / (w * 0.5), (y + 0.5 - h / 2) / (h * 0.5)), n = Pix.hash(x * 7.3 + y * 3.1 + rA);
        if (d < 0.8 + (n - 0.5) * 0.35) b[y * w + x] = p;
      }
    });
  }
  // Stand-in flame when the atlas has no fx.flame: three stacked pixel blocks in the fire ramp (feet at x, y), h in art px.
  function flameStub(c, x, y, f, ramp, a, h) {
    const rp = Pix.ramp(ramp || 'fire'), ga = c.globalAlpha, tip = 2 + ((f & 3) === 1 ? 2 : 0);
    c.globalAlpha = ga * a;
    c.fillStyle = rp[2]; c.fillRect(x - 3, y - 2 * h, 6, 2 * h); c.fillStyle = rp[3]; c.fillRect(x - 1, y - 2 * h - 2, 2, 2 * h); c.fillStyle = rp[4]; c.fillRect(x - 1, y - 2 * h - tip, 2, 2);
    c.globalAlpha = ga;
  }
  // Fire-zone flames (fx.flame loop) stand on a golden-angle spiral. R.frame queues them in the y-sorted actor list, so a foe in the fire hides the flames behind it and not those in front.
  const fireFade = (z) => Math.min(1, (z.dur - z.t) * 2, z.t * 5), fireCount = (z) => Math.max(3, Math.round(z.r / 9));
  let flX = 0, flY = 0;
  function flamePos(z, i) {
    const a = i * 2.39996 + (z.id & 1) * 2.1, rr = Math.sqrt((i + 0.5) / fireCount(z)) * z.r * 0.7;
    flX = z.x + Math.cos(a) * rr; flY = z.y + Math.sin(a) * rr * 0.62;
  }
  function drawFlame(c, z, i, t) {
    flamePos(z, i);
    const pf = z.kind === 'pfire', fade = fireFade(z), f = (t * 12 + z.id + i * 3) | 0, x = sx2(flX), y = sx2(flY) + 4; // the sprite's pivot is its feet
    if (!Pix.draw(c, 'fx.flame', pf ? '#ffb347' : '', f, x, y, fade)) flameStub(c, x, y, f, pf ? '#ffb347' : 'fire', fade, 3);
  }
  function drawZones(c, view, t, pass) {
    if (pass === 0) bakeLeft = BAKE_PER_FRAME;
    if (!view.zones.length) return;
    const At = ED.Atlas;
    for (const z of view.zones) {
      const k = z.dur ? U.clamp(z.t / z.dur, 0, 1) : 0, x = Math.round(z.x), y = Math.round(z.y);
      switch (z.kind) {
        case 'spawn': {
          const col = z.elite ? '#ffb13a' : '#b8a0ff', rr = z.r || 14;
          if (pass === 0) { // ground decals: shadow, smoke ring and spark circle sit under whatever stands on the spawn point
            Pix.put(c, Pix.ell(Math.round(rr * 1.1 / 2), Math.max(2, Math.round(rr * 0.6 / 2)), '#0a0414', true), sx2(z.x), sx2(z.y), 0.4); R.light(z.x, z.y, (z.r || 16) * 2.4, col, 0.55);
            Pix.draw(c, 'fx.smoke.ring', z.elite ? 'holy' : 'shadow', Math.min(7, (k * 8) | 0), sx2(z.x), sx2(z.y) + 2, 0.9);
            if (!Pix.draw(c, 'fx.circle.spark', col, Math.min(5, (k * 6) | 0), sx2(z.x), sx2(z.y) - 4)) ringPut(c, z.x, z.y - 4, rr * (0.4 + k * 0.8), 1, gb(col), 0.9);
          } else if (pass === 1) R.glow(c, z.x, z.y, 28 * (0.4 + k), col, 0.55);
          break;
        }
        case 'tele': {
          const fr = z.team === 0, col = fr ? GOLD : RED, B = TRING[fr ? 1 : 0];
          const lobX = z.lob ? U.lerp(z.lob[0], z.x, k) : 0, lobY = z.lob ? U.lerp(z.lob[1], z.y, k) : 0, lobH = z.lob ? Math.sin(k * Math.PI) * 70 : 0;
          if (pass === 0) {
            if (z.lob) { Pix.put(c, Pix.ell(3, 2, '#000000', true), sx2(lobX), sx2(lobY), 0.3); R.light(lobX, lobY - lobH, 54, '#ff8a2a', 0.8); }
            discPut(c, z.x, z.y, z.r, col, fr ? 0.1 : 0.15);
            R.light(z.x, z.y, z.r * 1.6, col, (fr ? 0.28 : 0.42) * (0.6 + k * 0.6));
            break;
          }
          if (pass === 2) { if (z.lob) Pix.put(c, Pix.orb(3, '#1a0604', '#ff6a1a', '#ffc27a', '#fff4c0'), sx2(lobX), sx2(lobY - lobH)); break; }
          if (z.lob) R.glow(c, lobX, lobY - lobH, 20, '#ff8a2a', 0.8);
          const flash = k > 0.82 ? 0.5 + Math.sin(t * 40) * 0.5 : 0;
          ringPut(c, z.x, z.y, z.r, 2, B, 0.9); // outer ring, ten spokes turning on it, the filling ring inside
          c.fillStyle = fr ? '#fff0b0' : '#ffb080'; c.beginPath();
          for (let i = 0; i < 10; i++) { const a = t * 0.6 + i * U.TAU / 10; c.rect(sx2(z.x + Math.cos(a) * (z.r - 6)), sx2(z.y + Math.sin(a) * (z.r - 6)), 2, 2); c.rect(sx2(z.x + Math.cos(a) * (z.r - 10)), sx2(z.y + Math.sin(a) * (z.r - 10)), 2, 2); }
          c.fill();
          ringPut(c, z.x, z.y, Math.max(2, z.r * k), 1, B, 0.55 + flash * 0.4);
          if (flash) discPut(c, z.x, z.y, z.r, col, 0.18 * flash);
          break;
        }
        case 'bomb': {
          if (pass === 0) {
            Pix.put(c, Pix.orb(3, '#0b0806', '#3a3a44', '#5a5a66', '#8a8a96'), sx2(z.x), sx2(z.y - 4));
            R.light(z.x, z.y, z.r * 1.2, GOLD, 0.3);
          } else if (pass === 1) {
            const fl = Math.floor(t * 12) % 2; c.fillStyle = fl ? '#ffd36b' : '#ff6a2a'; c.fillRect(sx2(z.x + 4), sx2(z.y - 11), 2, 2);
            R.glow(c, z.x + 4, z.y - 11, 10, '#ffb347', 0.8);
            ringPut(c, z.x, z.y, Math.max(2, z.r * k), 1, TRING[1], 0.7);
            ringPut(c, z.x, z.y, z.r, 1, TRING[1], 0.3);
          }
          break;
        }
        case 'decoy': {
          const df = ED.ClassFx.zone.decoy; if (df) { df(c, z, pass, t, k, view); break; } // the Shade's Afterimage (cls-shade.js)
          if (pass === 0) {
            const a = 0.5 + Math.sin(t * 20) * 0.2;
            if (!Pix.draw(c, 'hero.shade.idle', 'shadow', (t * 6.7) | 0, sx2(z.x), sx2(z.y), a)) Pix.put(c, Pix.ell(4, 6, '#2a1f44', true), sx2(z.x), sx2(z.y - 12), a);
            R.light(z.x, z.y - 10, 60, '#b78cff', 0.5);
          } else if (pass === 1) R.glow(c, z.x, z.y - 12, 24 + k * 20, '#b78cff', 0.7);
          break;
        }
        case 'teleLine': {
          if (pass === 0) {
            c.fillStyle = 'rgba(255,58,34,0.15)'; c.beginPath(); Pix.fillConvex(c, poly, lanePoly(z.x, z.y, z.a, 0, z.len, z.w)); c.fill();
            if (k > 0) { c.fillStyle = 'rgba(255,58,34,0.32)'; c.beginPath(); Pix.fillConvex(c, poly, lanePoly(z.x, z.y, z.a, 0, z.len * k, z.w)); c.fill(); }
            R.light(z.x + Math.cos(z.a) * z.len * 0.5, z.y + Math.sin(z.a) * z.len * 0.5, Math.max(z.len * 0.55, 40), RED, 0.32);
          } else if (pass === 1) {
            const co = Math.cos(z.a), si = Math.sin(z.a);
            c.fillStyle = '#ffaa78'; c.globalAlpha = 0.9; c.beginPath(); Pix.edge(c, poly, lanePoly(z.x, z.y, z.a, 0, z.len, z.w), true); c.fill(); // pixel outline of the lane
            c.globalAlpha = 0.85; c.fillStyle = '#ff9664'; c.beginPath();
            for (let v = -z.w / 2; v <= z.w / 2; v += 2) c.rect(sx2(z.x + co * z.len * k - si * v), sx2(z.y + si * z.len * k + co * v), 2, 2); // the bar that fills the lane
            const hv = Math.max(2, Math.min(4, z.w / 2 - 2)); // chevrons running along the lane: tip at u, two 2 px arms back to v = +-hv, in lane-local (u, v) coordinates
            for (let u = (t * 50) % 24 + hv; u < z.len * k; u += 24) {
              const tx = z.x + co * u, ty = z.y + si * u, ex = co * hv, ey = si * hv, fx = -si * hv, fy = co * hv;
              Pix.line(c, tx - ex - fx, ty - ey - fy, tx, ty, 2); Pix.line(c, tx - ex + fx, ty - ey + fy, tx, ty, 2);
            }
            c.fill(); c.globalAlpha = 1;
          }
          break;
        }
        case 'teleCone': {
          const arc = Math.min(Math.PI, z.arc), nv = () => Pix.fan(poly, z.x, z.y, z.a, z.r, arc);
          if (pass === 0) {
            c.fillStyle = 'rgba(255,58,34,0.16)'; c.beginPath(); Pix.fillConvex(c, poly, nv()); c.fill();
            if (k > 0) { c.fillStyle = 'rgba(255,58,34,0.34)'; c.beginPath(); Pix.fillConvex(c, poly, Pix.fan(poly, z.x, z.y, z.a, Math.max(2, z.r * k), arc)); c.fill(); }
            R.light(z.x + Math.cos(z.a) * z.r * 0.5, z.y + Math.sin(z.a) * z.r * 0.5, z.r * 0.9, RED, 0.3);
          } else if (pass === 1) {
            c.fillStyle = '#ffaa78'; c.globalAlpha = 0.9; c.beginPath(); Pix.edge(c, poly, nv(), true); c.fill();
            if (k > 0.02) { const rk = z.r * k, seg = Math.max(3, Math.ceil(arc * rk / 4)); c.globalAlpha = 0.8; c.fillStyle = '#ff9664'; c.beginPath(); for (let i = 0; i <= seg; i++) { const a = z.a - arc / 2 + arc * i / seg; c.rect(sx2(z.x + Math.cos(a) * rk), sx2(z.y + Math.sin(a) * rk), 2, 2); } c.fill(); } // the arc that grows
            c.globalAlpha = 1;
          }
          break;
        }
        case 'laser': {
          const active = z.t > (z.warm || 0), co = Math.cos(z.a), si = Math.sin(z.a), x1 = z.x + co * z.len, y1 = z.y + si * z.len;
          if (pass === 0) { if (active) for (let i = 0; i < 4; i++) R.light(z.x + co * z.len * (i + 0.5) / 4, z.y + si * z.len * (i + 0.5) / 4, 90, '#ff5ae0', 0.75); break; }
          if (pass !== 1) break;
          if (active) { // three pixel bands along the beam, the core flickering
            const fl = 0.85 + Math.sin(t * 60) * 0.15, w1 = Pix.s2(z.w * 3.2), w2 = Pix.s2(z.w * 2), w3 = Math.max(2, Pix.s2(z.w * 0.66));
            c.fillStyle = 'rgba(255,60,210,0.22)'; c.beginPath(); Pix.line(c, z.x, z.y, x1, y1, Math.max(4, w1)); c.fill();
            c.fillStyle = 'rgba(255,100,225,0.55)'; c.beginPath(); Pix.line(c, z.x, z.y, x1, y1, Math.max(4, w2)); c.fill();
            c.fillStyle = 'rgba(255,225,252,' + 0.95 * fl + ')'; c.beginPath(); Pix.line(c, z.x, z.y, x1, y1, w3); c.fill();
            R.glow(c, z.x, z.y, z.w * 3, '#ff7ae8', 0.9); R.glow(c, x1, y1, z.w * 2.5, '#ff7ae8', 0.6);
          } else { c.fillStyle = 'rgba(255,120,230,0.7)'; c.beginPath(); for (let u = 0, i = 0; u < z.len; u += 2, i++) if ((i + ((t * 10) | 0)) % 6 < 3) c.rect(sx2(z.x + co * u), sx2(z.y + si * u), 2, 2); c.fill(); }
          break;
        }
        case 'poison': case 'plague': {
          const plague = z.kind === 'plague', fade = Math.min(1, (z.dur - z.t) * 2, z.t * 4);
          if (pass === 0) {
            const rA = Math.max(3, Math.round(z.r / 2)), f = Math.floor(t * 0.35 / 1.05 % 1 * NF_POISON);
            if (plague) discPut(c, z.x, z.y, z.r, '#9be33c', 0.25 * fade); // hero cloud: 0.25 fill, dashed bright rim
            Pix.put(c, poolSprite(plague, rA, f), sx2(z.x), sx2(z.y), fade);
            if (plague) ringPut(c, z.x, z.y, z.r, 1, gb('#9be33c'), 0.9 * fade, 3, (t * 6) & 7); else ringPut(c, z.x, z.y, z.r, 1, ['#2f5a1c', '#4a7a2a', '#6a9a3a'], 0.7 * fade);
            R.light(z.x, z.y, z.r * 1.6, plague ? '#a6ff6a' : '#7ad44a', 0.34 * fade);
          } else if (pass === 1) {
            R.glow(c, z.x, z.y, z.r * 1.15, plague ? '#a6ff6a' : '#7ad44a', 0.28 * fade);
            c.fillStyle = '#d6ffb0';
            for (let i = 0; i < 5; i++) { const kk = (t * 0.5 + i * 0.21 + z.id * 0.13) % 1, a = i * 2.4 + z.id; c.globalAlpha = Math.max(0.25, Math.ceil(Math.sin(kk * Math.PI) * 0.8 * fade * 4) / 4); c.beginPath(); bubble(c, sx2(z.x + Math.cos(a) * z.r * 0.5 * (0.4 + kk * 0.4)), sx2(z.y + Math.sin(a) * z.r * 0.3 - kk * 12)); c.fill(); }
            c.globalAlpha = 1;
          }
          break;
        }
        case 'mire': {
          const fade = Math.min(1, (z.dur - z.t) * 1.5, z.t * 3);
          if (pass === 0) {
            const rA = Math.max(3, Math.round(z.r / 2));
            Pix.put(c, patchSprite('#1b2a1a', rA), sx2(z.x), sx2(z.y), fade);
            for (let i = 0; i < 3; i++) { const kk = (t * 0.4 + i / 3 + z.id * 0.1) % 1; Pix.put(c, Pix.ell(Math.max(2, Math.round((3 + kk * z.r * 0.28) / 2)), Math.max(2, Math.round((1.5 + kk * z.r * 0.16) / 2)), '#9fc07a', false), sx2(z.x + Math.cos(i * 2 + z.id) * z.r * 0.3), sx2(z.y + Math.sin(i * 3 + z.id) * z.r * 0.2), (1 - kk) * 0.5 * fade); }
          } else if (pass === 1) {
            c.fillStyle = '#c8e8a0';
            for (let i = 0; i < 4; i++) { const kk = (t * 0.45 + i * 0.27 + z.id * 0.17) % 1, a = i * 2.3 + z.id * 1.7; c.globalAlpha = Math.max(0.25, Math.ceil(Math.sin(kk * Math.PI) * 0.7 * fade * 4) / 4); c.fillRect(sx2(z.x + Math.cos(a) * z.r * 0.55), sx2(z.y + Math.sin(a) * z.r * 0.35 - kk * 5), 2, 2); }
            c.globalAlpha = 1;
            R.glow(c, z.x, z.y, z.r * 0.9, '#6a9a5a', 0.12 * fade);
          }
          break;
        }
        case 'fire': case 'pfire': {
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5), pf = z.kind === 'pfire';
          if (pass === 0) {
            if (pf) discPut(c, z.x, z.y, z.r, '#ffb347', 0.25 * fade);
            Pix.put(c, patchSprite('#120804', Math.max(3, Math.round(z.r * 0.95 / 2))), sx2(z.x), sx2(z.y), fade * 0.9);
            if (fade > 0.01) { if (pf) ringPut(c, z.x, z.y, z.r, 1, gb('#ffb347'), 0.9 * fade, 3, (t * 6) & 7); else ringPut(c, z.x, z.y, z.r, 1, ['#8a2a10', '#ff6a1a', '#ffb070'], 0.8 * fade); }
            R.light(z.x, z.y - 6, z.r * 2.2, pf ? '#ffb347' : '#ff6a1a', 0.85 * fade);
            break; // the flames are y-sorted with the actors (R.frame queues them, drawFlame draws them)
          }
          if (pass === 1) {
            R.glow(c, z.x, z.y - 4, z.r * 1.5, pf ? '#ffb347' : '#ff5a1a', 0.6 * fade);
            c.fillStyle = '#ffd36b'; // sparks rising off the patch
            for (let i = 0; i < 4; i++) { const kk = (t * 0.9 + i * 0.25 + z.id * 0.17) % 1, a = i * 2.4 + z.id; c.globalAlpha = Math.max(0.25, Math.ceil((1 - kk) * 4) / 4) * fade; c.fillRect(sx2(z.x + Math.cos(a) * z.r * 0.6), sx2(z.y + Math.sin(a) * z.r * 0.3 - kk * 26), 2, 2); }
            c.globalAlpha = 1;
          }
          break;
        }
        case 'sanct': {
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5);
          if (pass === 0) { // ground: fill, dashed rim and the CodeManu protection circle at its native 2 px density under the actors
            R.light(z.x, z.y, z.r * 1.9, '#ffe9a0', 0.8 * fade); discPut(c, z.x, z.y, z.r, '#ffe9a0', 0.25 * fade);
            ringPut(c, z.x, z.y, z.r, 2, TRING[1], 0.9 * fade, 4, (t * 6) & 7);
            Pix.draw(c, 'fxbig.protection', 'gold', (t * 12) | 0, sx2(z.x), sx2(z.y), 0.5 * fade);
            break;
          }
          if (pass === 1) {
            R.glow(c, z.x, z.y, z.r * 1.05, '#ffe9a0', 0.3 * fade);
            c.fillStyle = '#fff3c4'; // gold motes rising inside the circle
            for (let i = 0; i < 8; i++) { const kk = (t * 0.45 + i * 0.125 + z.id * 0.11) % 1, a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / 8) * z.r * 0.85; c.globalAlpha = Math.max(0.25, Math.ceil(Math.sin(kk * Math.PI) * 4) / 4) * fade; c.fillRect(sx2(z.x + Math.cos(a) * rr), sx2(z.y + Math.sin(a) * rr * 0.8 - kk * 22), 2, 2); }
            c.globalAlpha = 1;
          }
          break;
        }
        case 'rain': case 'skyfall': { // Rain of Arrows: faint ground disc, then arrows falling inside the circle (Skyfall: one curtain landing together)
          const sky = z.kind === 'skyfall', fade = sky ? 1 : Math.min(1, (z.dur - z.t) * 2.5, z.t * 4), warm = !sky && z.t < 0.35;
          if (pass === 0) {
            discPut(c, z.x, z.y, z.r, '#e8d8b0', (warm ? 0.12 : 0.25) * fade);
            ringPut(c, z.x, z.y, warm ? Math.max(2, z.r * (1.4 - z.t / 0.35 * 0.4)) : z.r, 1, gb('#e8d8b0'), 0.9 * fade, 3, (t * 6) & 7);
            R.light(z.x, z.y - 8, z.r * 1.5, '#d8c890', (warm ? 0.3 : 0.45) * fade); // lit rim: the light keeps the aim circle readable in dark rooms
            break;
          }
          if (pass === 1) { R.glow(c, z.x, z.y, z.r * 0.9, '#e8d8b0', 0.12 * fade); break; }
          if (warm) break; // pass 2: only the falling arrows (airborne)
          const n = R.quality === 'low' ? 7 : Math.max(8, Math.round(z.r / 5)), hasA = At.has('proj.arrow');
          for (let i = 0; i < n; i++) {
            const kk = sky ? k : (t * 2.3 + i * 0.381 + z.id * 0.17) % 1, a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / n) * z.r * 0.94, gx = z.x + Math.cos(a) * rr, gy = z.y + Math.sin(a) * rr, hy = gy - (sky ? 150 : 70) * (1 - kk) * (1 - kk) - 4;
            if (kk < 0.9 && (sky || kk >= 0.12)) { const al = Math.min(1, kk * 5) * fade; if (hasA) Pix.draw(c, 'proj.arrow', '', 0, sx2(gx), sx2(hy - 6), al, false, Math.PI / 2); else { c.fillStyle = '#f2ead0'; c.fillRect(sx2(gx), sx2(hy - 14), 2, 12); } }
            else if (kk >= 0.9) { const d = (kk - 0.9) * 50; c.globalAlpha = Math.max(0.25, (1 - kk) * 8) * fade; c.fillStyle = '#d4c8a0'; c.beginPath(); c.rect(sx2(gx - d), sx2(gy), 2, 2); c.rect(sx2(gx + d), sx2(gy), 2, 2); c.rect(sx2(gx), sx2(gy - d * 0.5), 2, 2); c.fill(); c.globalAlpha = 1; }
          }
          break;
        }
        case 'meteor': { // friendly telegraph: growing shadow and rings on the ground, a fireball plunging from above
          const q = U.clamp(z.t / Math.max(0.1, z.dur), 0, 1), u = (1 - q) * (1 - q), fx = z.x + u * 70, fy = z.y - u * 280;
          if (pass === 0) {
            discPut(c, z.x, z.y, z.r, '#ff7a2a', 0.07 + 0.12 * q);
            Pix.put(c, Pix.ell(Math.max(2, Math.round((5 + q * q * z.r * 0.5) / 2)), Math.max(2, Math.round((2.5 + q * q * z.r * 0.26) / 2)), '#000000', true), sx2(z.x), sx2(z.y), 0.15 + 0.3 * q);
            R.light(fx, fy, 60 + 90 * q, '#ff8a2a', 0.55 + 0.5 * q); R.light(z.x, z.y, z.r * 1.4, '#ff6a1a', 0.3 + 0.4 * q * q);
            ringPut(c, z.x, z.y, z.r, 1, gb('#ff8a2a'), 0.9, 4, (t * 6) & 7); // ground marks: dashed rim, the closing ring and a reticle whose arms converge as the meteor lands
            ringPut(c, z.x, z.y, Math.max(2, z.r * q), 1, ['#a84a10', '#ff6a1a', '#ffc27a'], 0.55 + (q > 0.8 ? 0.4 * Math.sin(t * 40) : 0));
            { const cx = sx2(z.x), cy = sx2(z.y), d = 4 + Math.round((1 - q) * 4) * 2;
              c.globalAlpha = 0.85; c.fillStyle = q > 0.8 && Math.sin(t * 40) > 0 ? '#ffffff' : '#ffc27a'; c.beginPath();
              c.rect(cx, cy, 2, 2); c.rect(cx - d - 4, cy, 4, 2); c.rect(cx + d + 2, cy, 4, 2); c.rect(cx, cy - d - 4, 2, 4); c.rect(cx, cy + d + 2, 2, 4);
              c.fill(); c.globalAlpha = 1; }
            break;
          }
          if (pass === 1) { R.glow(c, fx, fy, 24 + 22 * q, '#ff6a1a', 0.85); break; }
          const dx = z.x - fx, dy = z.y - fy, dl = Math.hypot(dx, dy) || 1, hd = Math.atan2(dy, dx), dir = shotDir('proj.fireball');
          c.fillStyle = '#ff9a3a'; c.beginPath(); // ember trail behind the fireball
          for (let i = 1; i <= 6; i++) { const kk = i / 6, tx = fx - dx / dl * kk * 44, ty = fy - dy / dl * kk * 44; c.globalAlpha = 1 - kk; c.rect(sx2(tx + Math.sin(i * 5 + t * 20) * 4), sx2(ty + Math.cos(i * 3 + t * 17) * 4), i < 3 ? 4 : 2, i < 3 ? 4 : 2); }
          c.fill(); c.globalAlpha = 1;
          if (!Pix.draw(c, 'proj.fireball', '', (t * 12) | 0, Math.round(fx), Math.round(fy), 1, false, hd - dir)) Pix.put(c, Pix.orb(4 + Math.round(q * 4), '#1a0604', '#ff6a1a', '#ffc27a', '#fff4c0'), sx2(fx), sx2(fy));
          break;
        }
        case 'smoke': { // Vanish cloud: billowing violet-grey puffs (fx.smoke loops), translucent so the hero inside stays readable
          const fade = Math.min(1, (z.dur - z.t) * 1.5, z.t * 3);
          if (pass === 0) {
            discPut(c, z.x, z.y - 2, z.r * 0.95, '#3a3552', 0.3 * fade);
            const n = R.quality === 'low' ? 6 : 9;
            for (let i = 0; i < n; i++) {
              const a = i * 0.83 + z.id, wob = 0.55 + 0.3 * Math.sin(t * 0.8 + i * 1.7), rr = z.r * wob * 0.7, px = z.x + Math.cos(a + t * 0.2) * rr, py = z.y - 8 + Math.sin(a + t * 0.2) * rr * 0.62;
              if (!Pix.draw(c, 'fx.smoke', 'smoke', ((t * 5 + i * 2) | 0) % 6, sx2(px), sx2(py), 0.55 * fade)) discPut(c, px, py, z.r * 0.3, '#6a6484', 0.42 * fade);
            }
            ringPut(c, z.x, z.y, z.r, 1, gb('#b4a8dc'), 0.7 * fade, 3, (t * 4) & 7);
          } else if (pass === 1) R.glow(c, z.x, z.y - 6, z.r * 0.95, '#8a7cc0', 0.1 * fade);
          break;
        }
        case 'shards': { // Caltrops: pixel caltrops scattered over a slowing patch
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5);
          if (pass === 0) { // ground: caltrops lie under whatever walks over them
            discPut(c, z.x, z.y, z.r, '#cfd6de', 0.1 * fade); R.light(z.x, z.y, z.r * 1.4, '#cfd6de', 0.3 * fade);
            ringPut(c, z.x, z.y, z.r, 1, gb('#cfd6de'), 0.85 * fade, 3, 0);
            const n = Math.max(6, Math.round(z.r / 5));
            c.globalAlpha = fade; c.fillStyle = '#cfd6de'; c.beginPath();
            for (let i = 0; i < n; i++) { const a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / n) * z.r * 0.85, cx = sx2(z.x + Math.cos(a) * rr), cy = sx2(z.y + Math.sin(a) * rr * 0.7); c.rect(cx - 2, cy - 4, 4, 2); c.rect(cx - 4, cy - 2, 2, 4); c.rect(cx - 2, cy - 2, 4, 4); c.rect(cx + 2, cy - 2, 2, 4); c.rect(cx - 2, cy + 2, 4, 2); }
            c.fill(); c.globalAlpha = 1;
          }
          break;
        }
        case 'pull': {
          if (pass !== 1) break;
          c.fillStyle = '#6fe6ff';
          for (let i = 0; i < 4; i++) { const rr = ((t * 60 + i * 70) % 280), rad = z.r * (1 - rr / 280); c.globalAlpha = Math.max(0.25, Math.ceil((rr / 280) * 4) / 4) * 0.6; c.beginPath(); for (let a = 0; a < 3.5; a += 2 / Math.max(8, rad)) c.rect(sx2(z.x + Math.cos(t * 2 + i + a) * rad), sx2(z.y + Math.sin(t * 2 + i + a) * rad), 2, 2); c.fill(); }
          c.globalAlpha = 1;
          break;
        }
        default: {
          const zf = ED.ClassFx.zone[z.kind]; if (zf) { zf(c, z, pass, t, k, view); break; }
          // unknown kinds: friendly (team 0) areas get a gold sigil disc; hostile ones a faint red mark
          if (!z.r) break;
          const fade = z.dur ? Math.min(1, (z.dur - z.t) * 2, z.t * 5) : 1;
          const fr = z.team === 0, col = fr ? '#ffe39a' : RED;
          if (pass === 0) {
            discPut(c, z.x, z.y, z.r, col, (fr ? 0.1 : 0.12) * fade);
            ringPut(c, z.x, z.y, z.r, 1, gb(col), 0.75 * fade, fr ? 3 : 4, (t * 6) & 7);
            if (fr) ringPut(c, z.x, z.y, z.r * 0.62, 1, gb(col), 0.4 * fade);
            R.light(z.x, z.y, z.r * 1.7, col, 0.45 * fade);
          } else if (pass === 1) R.glow(c, z.x, z.y, z.r * 1.05, col, 0.18 * fade);
        }
      }
    }
  }

  // ---------------- pickups & props ----------------
  const NOP = () => {};
  // Pickups are cached 16x16 sprites (outlined, drawn once at 4x). Pass 0 (lit): ground blob and lights. Pass 1 (after lighting): halos (additive), then
  // the opaque sprites, so shards and coins read in any light; fast-moving (magnetised) pickups leave a short trail.
  const pkSpr = {}, pkTrail = new Map(); let pkFrame = 0, glintH = null;
  const PK_COL = { gold: '#ffc94a', xp: '#7dffd9', heart: '#ff4a5a' };
  function pickSprite(kind) {
    const h = pkSpr[kind]; if (h) return h.v;
    const s = document.createElement('canvas'); s.width = s.height = 16;
    const g = s.getContext('2d'); g.translate(8, 8); g.lineJoin = 'round'; g.lineWidth = 0.9; g.strokeStyle = '#0b0806';
    if (kind === 'xp') {
      g.fillStyle = '#34dcb0'; g.beginPath(); g.moveTo(0, -7); g.lineTo(-4, -1); g.lineTo(0, 6); g.closePath(); g.fill();
      g.fillStyle = '#b4ffe9'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4, -1); g.lineTo(0, 6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(0, -7); g.lineTo(4, -1); g.lineTo(0, 6); g.lineTo(-4, -1); g.closePath(); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(0, -7); g.lineTo(1.7, -3.2); g.lineTo(-0.7, -2.2); g.closePath(); g.fill();
    } else if (kind === 'gold') {
      g.fillStyle = '#c98a1a'; g.beginPath(); g.arc(0, 0, 4.4, 0, U.TAU); g.fill(); g.stroke();
      g.fillStyle = '#ffd84f'; g.beginPath(); g.arc(0, 0, 3.4, 0, U.TAU); g.fill();
      g.strokeStyle = '#d99a1e'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, 0, 2.2, 0, U.TAU); g.stroke();
      g.fillStyle = '#fff6c0'; g.beginPath(); g.ellipse(-1.2, -1.5, 1.3, 0.8, -0.5, 0, U.TAU); g.fill();
    } else {
      g.scale(0.3, 0.3); g.lineWidth = 3.2; g.fillStyle = '#ff4a5a';
      g.beginPath(); g.moveTo(0, 18); g.bezierCurveTo(-24, 2, -22, -20, -8, -20); g.quadraticCurveTo(-2, -20, 0, -12); g.quadraticCurveTo(2, -20, 8, -20); g.bezierCurveTo(22, -20, 24, 2, 0, 18); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(-9, -8, 4, 6, -0.6, 0, U.TAU); g.fill();
    }
    pkSpr[kind] = Bmp.hold(s); // snapshot after painting
    return s;
  }
  function glintSprite() {
    if (glintH) return glintH.v;
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const g = cv.getContext('2d'); g.translate(8, 8); g.scale(0.5, 0.5); g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -15); g.lineTo(1.3, -1.3); g.lineTo(15, 0); g.lineTo(1.3, 1.3); g.lineTo(0, 15); g.lineTo(-1.3, 1.3); g.lineTo(-15, 0); g.lineTo(-1.3, -1.3); g.closePath(); g.fill();
    glintH = Bmp.hold(cv);
    return cv;
  }
  function drawPickups(c, view, t, pass) {
    const pks = view.pickups;
    if (pass === 0) {
      let n = 0; // light budget: a big pile of coins must not starve other lights
      for (const pk of pks) {
        const lit = n++ < 14, L = lit ? R.light : NOP, k = pk.kind, big = k === 'heart';
        if (k === 'gold') L(pk.x, pk.y - 4, 28, '#ffd36b', 0.5);
        else if (k === 'xp') L(pk.x, pk.y - 4, 26, '#7dffd9', 0.5);
        else L(pk.x, pk.y - 6, 36, '#ff4a5a', 0.6);
        c.globalAlpha = 0.55; c.drawImage(shadowH.v, pk.x - 7, pk.y - (big ? 9 : 6), 14, big ? 12 : 9);
      }
      c.globalAlpha = 1;
      return;
    }
    if (!pks.length) return;
    const fr = ++pkFrame; let n = 0;
    // motion since the last frame: magnetised pickups (> 150 px/s) get a trail
    for (const pk of pks) {
      let s = pkTrail.get(pk.id);
      if (!s) { s = { x: pk.x, y: pk.y, t, v: 0, dx: 0, dy: 0, f: fr }; pkTrail.set(pk.id, s); }
      else { const dt = t - s.t; if (dt > 0.0005) { const dx = (pk.x - s.x) / dt, dy = (pk.y - s.y) / dt; s.dx += (dx - s.dx) * 0.5; s.dy += (dy - s.dy) * 0.5; s.v = Math.hypot(s.dx, s.dy); s.x = pk.x; s.y = pk.y; s.t = t; } s.f = fr; }
    }
    if (pkTrail.size > pks.length + 48) for (const [id, s] of pkTrail) if (s.f !== fr) pkTrail.delete(id);
    for (const pk of pks) { // halos and trails (context is additive)
      const k = pk.kind, big = k === 'heart', bob =Math.sin(t * 5 + pk.id) * 1.5, y = pk.y - (big ? 7 : 5) + bob, col = PK_COL[k], s = pkTrail.get(pk.id);
      if (n++ < 70) R.glow(c, pk.x, y, big ? 15 : 11, col, k === 'xp' ? 0.75 + Math.sin(t * 6 + pk.id) * 0.15 : 0.6);
      if (s && s.v > 150) for (let i = 1; i <= 3; i++) R.glow(c, pk.x - s.dx / s.v * i * 5, y - s.dy / s.v * i * 5 * 0.7, 6 - i, col, 0.62 - i * 0.16);
    }
    c.globalCompositeOperation = 'source-over';
    const AT_ = ED.Atlas, art = AT_.ok && AT_.has('pickup.coin') && AT_.has('pickup.heart') && AT_.has('pickup.xp');
    for (const pk of pks) {
      const k = pk.kind, bob = Math.sin(t * 5 + pk.id) * 1.5, spr = art ? null : pickSprite(k);
      if (art) { // pixel sprites on the buffer pixel grid: coin 4-frame spin, heart, xp gem
        const y = Math.round((pk.y - 3 + bob) / 2) * 2, x = Math.round(pk.x / 2) * 2; // on the 2-px art grid
        if (k === 'gold') AT_.draw(c, 'pickup.coin', AT_.frameAt('pickup.coin', t + (pk.id % 7) * 0.13), x, y);
        else if (k === 'xp') AT_.draw(c, 'pickup.xp', 0, x, y);
        else AT_.draw(c, 'pickup.heart', 0, x, y);
      } else if (k === 'gold') { const w = Math.max(2, Math.round(8 * Math.max(0.2, Math.abs(Math.cos(t * 4 + pk.id))))); c.drawImage(spr, Math.round(pk.x - w), Math.round(pk.y - 12 + bob), w * 2, 16); }
      else if (k === 'xp') { const p = Math.round(16 * (1 + Math.sin(t * 6 + pk.id) * 0.05)); c.drawImage(spr, Math.round(pk.x - p / 2), Math.round(pk.y - 13 + bob - (p - 16) / 2), p, p); }
      else c.drawImage(spr, Math.round(pk.x - 8), Math.round(pk.y - 14 + bob), 16, 16);
    }
    c.globalCompositeOperation = 'lighter';
    for (const pk of pks) { // twinkle
      const k = pk.kind; if (k !== 'xp' && k !== 'gold') continue;
      const q = Math.sin(t * (k === 'gold' ? 2.6 : 1.9) + pk.id * 1.7);
      if (q < 0.88) continue;
      const a = (q - 0.88) / 0.12, sz = 6 + a * 6;
      if (art && AT_.has('fx.glint')) { AT_.draw(c, 'fx.glint', Math.min(6, Math.floor(a * 7)), Math.round(pk.x + 1), Math.round(pk.y - 10 + Math.sin(t * 5 + pk.id) * 1.5), { alpha: a * 0.9 }); continue; }
      c.globalAlpha = a * 0.9; c.drawImage(glintSprite(), pk.x - sz / 2 + 1, pk.y - 10 - sz / 2 + Math.sin(t * 5 + pk.id) * 1.5, sz, sz);
    }
    c.globalAlpha = 1;
  }

  const PROP_LABEL = {
    chest: () => 'Open', fountain: () => 'Drink (heal party 50%)', altar: (p, me) => `Pay 20% health for an epic boon`,
    gamble: (p) => `Offer ${p.price} gold for a random relic`, trial: () => 'Begin the trial (elite fight, rare relic)', portal: () => 'Descend',
  };
  R.propPrompt = (p, view) => {
    if (p.kind === 'relic') return 'Take ' + ED.RELICS[p.item].name;
    if (p.kind === 'shop') { const name = p.stype === 'relic' ? ED.RELICS[p.item].name : p.stype === 'boon' ? 'Epic boon' : p.stype === 'oil' ? 'Lantern oil' : p.stype === 'forge' ? 'Forge' : 'Healing draught'; return `Buy ${name} — ${p.price}g`; }
    if (p.kind === 'reward') {
      if (p.item === 'gold') { const amt = ED.World.rewardGold ? ED.World.rewardGold(view.stratum, ED.World.DREAD[view.dread ? view.dread.tier | 0 : 0].gold) : 0; return amt ? `Claim: ${amt} gold` : 'Claim: Gold'; }
      return 'Claim: ' + R.rewardLabel(p.item);
    }
    if (p.kind === 'campfire') return 'Rest at the campfire';
    if (p.kind === 'anvil') return 'Temper at the anvil';
    return PROP_LABEL[p.kind] ? PROP_LABEL[p.kind](p) : null;
  };
  const REWARD_DESC = { gold: 'Gold for the whole party, more when the lantern is low.', vigor: 'Permanently raises your maximum health and heals you.', forge: 'Rank up one of your boons.', oil: 'Refills part of the lantern for the whole party.', boon: 'A boon from your paths (a new path while you have a free slot).', epic: 'Choose from epic boons.', relic: 'A hoard of relics: each hero takes one.' };
  const SHOP_DESC = { boon: 'Grants an extra boon pick with no common options.', oil: 'Lantern oil: refills part of the lantern for the whole party.', forge: 'Forge: rank up one of your boons.', potion: 'Heals a good chunk of your health.' };
  // Longer explanation shown above the prompt (null when there is none).
  R.propDesc = (p) => {
    if (p.kind === 'reward') {
      return REWARD_DESC[String(p.item)] || null;
    }
    if (p.kind === 'campfire') return 'Rest: recover a chunk of your health. One use per hero.';
    if (p.kind === 'anvil') return 'Temper: rank up one of your boons. One use per hero.';
    if (p.kind === 'shop') return SHOP_DESC[p.stype] || null;
    return null;
  };
  R.interactable = (p) => !p.state && p.kind !== 'sign' && p.kind !== 'merchant';

  const PATH_COL = { fire: '#ff7a2a', ice: '#7fe3ff', lightning: '#ffe66b', poison: '#9be33c', holy: '#fff0c2', shadow: '#a070ff', general: '#d9dfe8' };
  // Colour of a reward-type string such as 'boon', 'gold', 'oil', 'relic' (unknown -> warm white). 'boon' wears the colour of the local hero's deepest path (R.mainPath).
  function rewardColor(s) {
    s = String(s || '');
    if (s === 'boon') return PATH_COL[R.mainPath] || '#ffe9a0';
    return { gold: '#ffd36b', vigor: '#ff4a5a', forge: '#ff9a3a', oil: '#ffb35c', epic: '#c98bff', relic: '#ffb02e', campfire: '#ff9a3a', anvil: '#ffb066' }[s] || '#ffe9a0';
  }
  R.rewardColor = rewardColor;
  const REWARD_LABEL = { boon: 'Boon', gold: 'Gold', vigor: 'Vigor', forge: 'Forge', oil: 'Lantern oil', relic: 'Relic hoard', epic: 'Epic boon', campfire: 'Rest', anvil: 'Temper' };
  // Short name of a reward string: 'boon' -> 'Boon'.
  R.rewardLabel = (s) => REWARD_LABEL[String(s || '')] || 'Reward';
  // [icon, colour] for a reward string; 'boon' shows the icon of the local hero's deepest path (a Generalist sees General).
  R.rewardIcon = (s, cls) => {
    s = String(s || '');
    if (s === 'boon') { const pa = ED.PATHS[R.mainPath]; return pa ? [pa.icon, pa.color] : ['star', '#ffe9a0']; }
    return { gold: ['coin', '#ffd36b'], vigor: ['heart', '#ff4a5a'], forge: ['anvil', '#ff9a3a'], oil: ['oil', '#ffb35c'], epic: ['star', '#c98bff'], relic: ['chest', '#ffb02e'], campfire: ['campfire', '#ff9a3a'], anvil: ['anvil', '#ffb066'] }[s] || ['star', '#ffe9a0'];
  };
  // Map/door glyph of a floor room: { icon, color, badge? } (null for plain rooms). Elite rooms add a skull badge.
  R.roomIcon = (rm, cls) => {
    if (!rm) return null;
    const T2 = { boss: ['skull', '#ff5a3a'], shop: ['coin', '#ffd36b'], treasure: ['chest', '#ffd36b'], event: ['star', '#7dffd9'], rest: ['campfire', '#ff9a3a'] }[rm.type];
    if (T2) return { icon: T2[0], color: T2[1] };
    if (!rm.reward) return rm.type === 'elite' ? { icon: 'skull', color: '#ff7a3a' } : null;
    const ri = R.rewardIcon(rm.reward, cls);
    return { icon: ri[0], color: ri[1], badge: rm.type === 'elite' ? 'skull' : null };
  };

  // Reward previews over the doors of the current room: neighbours not yet cleared, bobbing in front of each doorway, with the lantern light the room costs (boss door: the heal on offer).
  const dpList = [], dpPool = [];
  function doorPreviews(view, room, t) {
    const out = dpList; let n = 0; // pooled: the list is consumed before the next call
    out.length = 0;
    if (view.locked || !view.floor) return out;
    const me = view.players.get(R.local), cls = me ? me.cls : null, h = room.h * T, w = room.w * T, Wd = ED.World, lm = view.lightMax, lf = lm > 0 ? U.clamp(view.light / lm, 0, 1) : 0;
    for (const d in room.doors) {
      const id = room.doors[d]; if (id < 0) continue;
      const nb = view.floor.rooms[id], st = view.roomState && view.roomState[id];
      if (!nb || (st && st.cleared)) continue;
      const ri = R.roomIcon(nb, cls); if (!ri) continue;
      const r = ED.Dungeon.doorRect(room, d), cx = (r.x0 + r.x1 + 1) / 2 * T, cy = (r.y0 + r.y1 + 1) / 2 * T;
      let x = cx, y = cy;
      if (d === 'n') y = T - 2; else if (d === 's') y = h - T - 6; else if (d === 'w') x = T * 0.5 + 6; else x = w - T * 0.5 - 6;
      let o = dpPool[n]; if (!o) o = dpPool[n] = { x: 0, y: 0, color: '', ri: null, d: '', lab: '', lc: '' };
      o.x = x; o.y = y + Math.sin(t * 2.2 + x * 0.03 + y * 0.02) * 1.8; o.color = ri.color; o.ri = ri; o.d = d; o.lab = ''; o.lc = '';
      if (lm > 0) { // lantern label: the light an unvisited room costs (red when it drops the tier), or the boss-door heal
        if (nb.type === 'boss') { const hp = Math.round(Wd.bossLight(lf, view.stratum).heal * 100); if (hp > 0) { o.lab = '+' + hp + '%'; o.lc = '#86d38f'; } }
        else if (!(st && st.visited)) { const cost = Wd.roomCost(nb.type); if (cost > 0) { o.lab = '−' + cost; o.lc = Wd.tierOf(Math.max(0, view.light - cost) / lm) > Wd.tierOf(lf) ? '#ff7a5a' : '#ffd9a0'; } }
      }
      out[n++] = o;
    }
    return out;
  }
  // Icon pass of the door previews (screen-space-sized, unlit); fades when a hero walks up to the doorway.
  function drawDoorPreviews(c, view, room, t) {
    const list = doorPreviews(view, room, t); if (!list.length) return;
    for (const pv of list) {
      let near = 1e9; for (const p of view.players.values()) if (!p.dead) near = Math.min(near, Math.hypot(p.x - pv.x, p.y - pv.y));
      const a = U.clamp((near - 22) / 46, 0.22, 0.95), qx = Math.round(pv.x), qy = Math.round(pv.y);
      c.globalAlpha = a;
      c.drawImage(ED.Icons.canvas(pv.ri.icon, pv.color, 22), qx - 11, qy - 11); // icons are drawn at their cached size: 1 texel = 1 buffer px
      if (pv.ri.badge) c.drawImage(ED.Icons.canvas('skull', '#ff7a3a', 12), qx + 3, qy + 2);
      if (pv.lab) { // lantern label on the room side of the icon; stays readable up close
        c.globalAlpha = Math.max(a, 0.7);
        const tw = R.labelW(pv.lab), lx = Math.round(pv.x - (tw + 13) / 2), ly = Math.round(pv.d === 's' ? pv.y - 18 : pv.y + 18);
        c.drawImage(ED.Icons.canvas('lantern', pv.lc, 11), lx, ly - 5);
        R.label(c, pv.lab, lx + 13 + tw / 2, ly, pv.lc);
      }
    }
    c.globalAlpha = 1;
  }

  // ---- pixel-art props (feet at the prop point) ----
  R.propArt = () => { const a = ED.Atlas; return !!(a && a.ok && a.has('prop.chest.closed') && a.has('prop.plinth.stone') && a.has('prop.merchant')); };
  const propOpen = new Map(); // prop id -> { open, t0 }: when its state turned on (chest and mimic opening animations)
  // Seconds since the prop's state turned on (0 while off); a prop first seen open counts as long open.
  function openAge(p, t) {
    let r = propOpen.get(p.id);
    if (!r) { if (propOpen.size > 300) propOpen.clear(); r = { open: !!p.state, t0: p.state ? -99 : 0 }; propOpen.set(p.id, r); }
    if (p.state && !r.open) { r.open = true; r.t0 = t; } else if (!p.state) r.open = false;
    return p.state ? t - r.t0 : 0;
  }
  const orbDone = new Set(); let ironOk = false, merchOk = false;
  const stoneVk = {}, CAMP_STONE = ['#5f7160', '#8d977f', '#abc2bc'], PEDESTAL = ['#4e484a', '#5f7160', '#8d977f', '#d6d3c4']; // stratum id -> { sprite id -> Atlas draw options } of stone props
  // Draw options of stone prop `id` wearing the stratum's wall stone (only the palette hexes in `only` when given); undefined until the atlas can build it.
  function stoneOf(id, view, only) {
    const b = ED.biomeFor(view.stratum || 1), m = stoneVk[b.id] || (stoneVk[b.id] = {});
    let o = m[id];
    if (!o) { const k = ED.Tiles.stoneKey ? ED.Tiles.stoneKey(id, b, only) : ''; if (k) o = m[id] = { variant: k }; }
    return o;
  }
  // Key of the Atlas variant of the shrine pedestal whose orb wears colour hex and whose base wears the stratum's stone ('' while the atlas cannot build it).
  function orbKey(hex, view) {
    const b = ED.biomeFor(view.stratum || 1), key = 'pal:orb' + b.id + hex;
    if (orbDone.has(key)) return key;
    const src = ['#965340', '#d14b34', '#e46d3a', '#ffffff'], to = [U.shade(hex, -0.5), U.shade(hex, -0.2), hex, U.mix(hex, '#ffffff', 0.7)];
    if (!ED.Atlas.variant('prop.shrine.3', key, (pal) => { const m = ED.Tiles.stoneMap ? ED.Tiles.stoneMap(pal, b, PEDESTAL) : {}; src.forEach((s, i) => { m[s] = to[i]; }); return m; })) return '';
    orbDone.add(key); return key;
  }
  // Swirling portal vortex: 12 frames of an ellipse painted pixel by pixel on the 2-px art grid.
  const NF_PORTAL = 12; let portalS = [], portalGen = -1;
  function portalFrame(f) {
    if (portalGen !== sprGen) { portalS = []; portalGen = sprGen; }
    return frameOf(portalS, 0, f, NF_PORTAL, () => bake(-28, -36, 28, 36, false, (g) => {
      for (let j = -16; j <= 16; j++) for (let i = -13; i <= 13; i++) {
        const nx = i / 12, ny = j / 15, r = Math.hypot(nx, ny); if (r > 1.12) continue;
        let col;
        if (r > 1.0) col = '#12062a';
        else if (r > 0.9) col = r > 0.95 ? '#e8c8ff' : '#9a6aff';
        else if (r < 0.2) col = '#05010c';
        else { const v = Math.sin(Math.atan2(ny, nx) * 3 + r * 8 - f * 0.5236) * 0.5 + 0.5; col = ['#1a0a38', '#3a1a78', '#7a4ae0', '#d8a8ff'][Math.min(3, Math.floor(v * (1.6 + r * 2.4)))]; }
        g.fillStyle = col; g.fillRect(i * 2, j * 2, 2, 2);
      }
    }));
  }
  // Dashed ground ring of the trial altar, 3 dash phases (pixel dots on the art grid).
  function trialRing(ph) {
    return sprite('trialring' + ph, -30, -16, 30, 16, false, (g) => {
      for (let i = 0; i < 48; i++) { if ((i + ph) % 3 === 2) continue; const a = i / 48 * U.TAU; g.fillStyle = i % 6 < 3 ? '#ff6a4a' : '#ffb08a'; g.fillRect(Math.round(Math.cos(a) * 13) * 2, Math.round(Math.sin(a) * 6) * 2, 2, 2); }
    });
  }
  const ELEM_HEX = ['#ff7a2a', '#7fe3ff', '#ffe66b', '#9be33c', '#fff0c2', '#a070ff'];
  // Draws prop p as pixel art and issues its lights; returns false for kinds without art.
  function propArt(c, p, view, local, t, G, L) {
    const A_ = ED.Atlas;
    switch (p.kind) {
      case 'chest': {
        Sp.shadow(c, 14);
        if (!p.state) { G(0, -8, 30 + Math.sin(t * 3) * 4, '#ffd36b', 0.4); L(0, -10, 90, '#ffd36b', 0.7); A_.draw(c, 'prop.chest.closed', 0, 0, 0); }
        else { const age = openAge(p, t); if (age < 0.4) A_.draw(c, 'prop.chest.open', Math.min(2, Math.floor(age * 8)), 0, 0); else A_.draw(c, 'prop.chest.empty', 2, 0, 0); }
        return true;
      }
      case 'gamble': {
        Sp.shadow(c, 14);
        if (!p.state) { G(0, -12, 28, '#ffd36b', 0.45); L(0, -12, 90, '#ffd36b', 0.7); A_.draw(c, 'prop.mimic.closed', 0, 0, 0); }
        else A_.draw(c, 'prop.mimic.open', Math.min(2, Math.floor(openAge(p, t) * 8)), 0, 0);
        return true;
      }
      case 'relic': case 'shop': {
        if (p.state) c.globalAlpha = 0.35;
        Sp.shadow(c, 12, 0.3);
        A_.draw(c, 'prop.plinth.stone', 0, 0, 0, stoneOf('prop.plinth.stone', view));
        if (!p.state) {
          const bob = Math.sin(t * 3 + p.id) * 2;
          let col = '#ffffff', icon = null, flask = null;
          if (p.kind === 'relic' || p.stype === 'relic') { const r = ED.RELICS[p.item]; col = ED.RARITY[r.rar].color; icon = ED.Icons.relicCanvas(p.item, 20); }
          else if (p.stype === 'boon') { col = ED.RARITY.e.color; icon = ED.Icons.canvas('star', col, 20); }
          else if (p.stype === 'oil') { col = '#ffb35c'; flask = 'pickup.flask.yellow'; }
          else if (p.stype === 'forge') { col = '#ff9a3a'; icon = ED.Icons.canvas('anvil', col, 20); }
          else { col = '#ff4a5a'; flask = 'pickup.flask.red'; }
          G(0, -42 + bob, 24, col, 0.65); L(0, -42, 80, col, 0.8);
          if (flask) A_.draw(c, flask, 0, 0, Math.round(-30 + bob)); else c.drawImage(icon, -10, Math.round(-56 + bob));
          if (p.kind === 'shop') R.label(c, p.price + 'g', 0, 9, view.gold >= p.price ? '#ffd36b' : '#a07060', 8);
        }
        return true;
      }
      case 'merchant': {
        Sp.shadow(c, 11);
        G(10, -16, 34, '#ffcf6a', 0.4); L(8, -16, 100, '#ffcf6a', 0.7);
        A_.draw(c, 'prop.crate', 0, -26, 0); A_.draw(c, 'prop.bag', 0, 24, 0);
        if (!merchOk) merchOk = A_.variant('prop.merchant', 'pal:brown', () => ({ '#314152': '#4a3322', '#417089': '#8a5e34' })); // trader's robe in merchant brown
        A_.draw(c, 'prop.merchant', A_.frameAt('prop.merchant', t), 0, 0, merchOk ? { variant: 'pal:brown' } : undefined);
        return true;
      }
      case 'fountain': {
        Sp.shadow(c, 18);
        if (!p.state) {
          G(0, -26, 34, '#6fe6ff', 0.4); L(0, -26, 110, '#6fe6ff', 0.75);
          const f = A_.frameAt('tile.fountain.mid.blue', t);
          A_.draw(c, 'tile.fountain.basin.blue', f, -16, -32); A_.draw(c, 'tile.fountain.mid.blue', f, -16, -64); A_.draw(c, 'tile.fountain.top.1', 0, -16, -96);
        } else { c.globalAlpha *= 0.7; A_.draw(c, 'tile.fountain.basin.blue', 0, -16, -32); A_.draw(c, 'tile.fountain.mid.blue', 0, -16, -64); A_.draw(c, 'tile.fountain.top.1', 0, -16, -96); }
        return true;
      }
      case 'altar': case 'reward': {
        const reward = p.kind === 'reward';
        let hex = reward ? rewardColor(p.reward || p.rw || p.item || p.what) : (PATH_COL[R.mainPath] || ELEM_HEX[(view.room ? view.room.seed >>> 0 : 0) % 6]);
        const bob = Math.sin(t * 2.6 + p.id) * 2.5;
        Sp.shadow(c, 14);
        if (!reward && p.state) A_.draw(c, 'prop.plinth.stone', 0, 0, 0, stoneOf('prop.plinth.stone', view));
        else {
          const vk = orbKey(hex, view); A_.draw(c, 'prop.shrine.3', 0, 0, 0, vk ? { variant: vk } : undefined);
          G(0, reward ? -30 + bob : -22, 34, hex, reward ? 0.7 : 0.55 + Math.sin(t * 4) * 0.15); L(0, reward ? -28 : -18, reward ? 120 : 100, hex, reward ? 0.95 : 0.8);
          if (reward) {
            const me = view.players.get(local), ri = R.rewardIcon(p.item, me ? me.cls : null);
            c.drawImage(ED.Icons.canvas(ri[0], ri[1], 24), -12, Math.round(-62 + bob));
            for (let i = 0; i < 3; i++) { const a = t * 1.5 + i * 2.1; G(Math.cos(a) * 15, -40 + bob + Math.sin(a) * 6, 5, hex, 0.8); }
          } else for (let i = 0; i < 3; i++) { const k = (t * 0.8 + i / 3) % 1; c.fillStyle = U.rgba(hex, 0.8 * (1 - k)); c.fillRect(Math.round((-4 + i * 4 + Math.sin(t * 3 + i) * 1.5) / 2) * 2, Math.round((-34 - k * 14) / 2) * 2, 2, 2); }
        }
        return true;
      }
      case 'trial': {
        Sp.shadow(c, 12);
        if (!p.state) {
          c.globalAlpha *= 0.6 + Math.sin(t * 4) * 0.25; const rs = trialRing(Math.floor(t * 3) % 3); c.drawImage(rs.cv, rs.x, rs.y + 4, rs.w, rs.h); c.globalAlpha = 1;
          G(0, -28, 30, '#ff6a4a', 0.5); L(0, -28, 100, '#ff6a4a', 0.75);
        }
        A_.draw(c, 'prop.trial', 0, 0, 0);
        return true;
      }
      case 'portal': {
        G(0, -22, 74, '#c98bff', 0.65); L(0, -22, 190, '#c98bff', 1);
        Sp.shadow(c, 20, 0.4);
        const s = portalFrame(Math.floor(t * 8) % NF_PORTAL); blit(c, s, 0, -24);
        return true;
      }
      case 'sign': Sp.shadow(c, 9, 0.3); A_.draw(c, 'prop.sign', 0, 0, 0); return true;
      case 'campfire': {
        Sp.shadow(c, 18, 0.3);
        A_.draw(c, 'prop.campfire', 0, 0, 0, stoneOf('prop.campfire', view, CAMP_STONE));
        G(0, -14, 46, '#ff8a3d', 0.6 + Math.sin(t * 9) * 0.06); L(0, -14, 170, '#ff9a4a', 1.1);
        for (const [dx, dy, ph] of [[-8, -20, 0], [8, -22, 0.37], [0, -28, 0.71]]) A_.draw(c, 'fx.flame', A_.frameAt('fx.flame', t + ph), dx, dy);
        return true;
      }
      case 'anvil': {
        Sp.shadow(c, 12);
        if (!ironOk) ironOk = A_.variant('prop.anvil', 'pal:iron', () => ({ '#262b44': '#171a26', '#52607c': '#3d465e', '#8b9bb4': '#69748f', '#c0cbdc': '#9aa5be', '#e4edf9': '#bcc8e0' })); // darker iron than the pack's near-white
        A_.draw(c, 'prop.anvil', 0, 0, 0, ironOk ? { variant: 'pal:iron' } : undefined);
        if (!p.state) { G(0, -14, 26, '#ff9a3a', 0.5); L(0, -14, 80, '#ff9a3a', 0.7); }
        return true;
      }
      default: return false;
    }
  }
  function drawProps(c, view, local, t) { for (const p of view.props) drawProp(c, p, view, local, t); }
  // One prop at its feet point: pixel art when the atlas is loaded (drawn in the y-sorted entity list), else the procedural drawing.
  function drawProp(c, p, view, local, t) {
    {
      const done = !!(R.claimed && p.group && R.claimed[p.group] && (p.kind === 'campfire' || p.kind === 'anvil' || (p.kind === 'reward' && /^(boon$|forge$|epic$|vigor$)/.test(p.item)))); // this hero already used it
      const G = done ? () => {} : (dx, dy, r, col, a) => R.emit(p.x + dx, p.y + dy, r, col, a), L = done ? () => {} : (dx, dy, r, col, k) => R.light(p.x + dx, p.y + dy, r, col, k);
      const art = R.propArt(); // pixel props sit on the 2-px art grid
      c.save(); c.translate(art ? Math.round(p.x / 2) * 2 : Math.round(p.x), art ? Math.round(p.y / 2) * 2 : Math.round(p.y));
      if (done) c.globalAlpha = 0.4;
      c.lineWidth = 1.5; c.strokeStyle = '#0b0806';
      if (art && propArt(c, p, view, local, t, G, L)) { c.restore(); return; }
      switch (p.kind) {
        case 'chest': {
          Sp.shadow(c, 14);
          if (!p.state) { G(0, -8, 30 + Math.sin(t * 3) * 4, '#ffd36b', 0.4); L(0, -10, 90, '#ffd36b', 0.7); }
          c.fillStyle = '#7a4a22'; c.fillRect(-14, -14, 28, 14); c.strokeRect(-14, -14, 28, 14);
          c.fillStyle = '#9a6030'; c.fillRect(-14, -14, 28, 3);
          c.fillStyle = '#c9a640'; c.fillRect(-14, -9, 28, 3); c.fillRect(-14, -14, 3, 14); c.fillRect(11, -14, 3, 14);
          if (p.state) { c.fillStyle = '#5a3418'; c.fillRect(-14, -26, 28, 10); c.strokeRect(-14, -26, 28, 10); c.fillStyle = '#ffd36b'; c.globalAlpha = 0.5; c.fillRect(-12, -15, 24, 3); c.globalAlpha = 1; }
          else { c.fillStyle = '#8a5a2a'; c.beginPath(); c.moveTo(-14, -14); c.quadraticCurveTo(0, -26, 14, -14); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#b07a3a'; c.beginPath(); c.moveTo(-12, -15); c.quadraticCurveTo(0, -24, 12, -15); c.lineTo(8, -15); c.quadraticCurveTo(0, -21, -8, -15); c.fill(); c.fillStyle = '#e6c24a'; c.fillRect(-3, -15, 6, 7); c.fillStyle = '#fff0a0'; c.fillRect(-3, -15, 6, 1.5); }
          break;
        }
        case 'relic': case 'shop': {
          if (p.state) { c.globalAlpha = 0.35; }
          Sp.shadow(c, 11, 0.3);
          c.fillStyle = '#3a3330'; c.fillRect(-9, -6, 18, 8); c.strokeRect(-9, -6, 18, 8);
          c.fillStyle = '#4c4440'; c.fillRect(-11, -9, 22, 4); c.strokeRect(-11, -9, 22, 4);
          c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(-11, -9, 22, 1.2);
          if (!p.state) {
            const bob = Math.sin(t * 3 + p.id) * 2;
            let col = '#ffffff', icon = null;
            if (p.kind === 'relic' || p.stype === 'relic') { const r = ED.RELICS[p.item]; col = ED.RARITY[r.rar].color; icon = ED.Icons.relicCanvas(p.item, 20); }
            else if (p.stype === 'boon') { col = ED.RARITY.e.color; icon = ED.Icons.canvas('star', col, 20); }
            else if (p.stype === 'oil') { col = '#ffb35c'; icon = ED.Icons.canvas('oil', col, 20); }
            else if (p.stype === 'forge') { col = '#ff9a3a'; icon = ED.Icons.canvas('anvil', col, 20); }
            else { col = '#ff4a5a'; icon = ED.Icons.canvas('potion', col, 20); }
            G(0, -22 + bob, 24, col, 0.65); L(0, -22, 80, col, 0.8);
            c.drawImage(icon, -10, Math.round(-32 + bob));
            if (p.kind === 'shop') R.label(c, p.price + 'g', 0, 9, view.gold >= p.price ? '#ffd36b' : '#a07060', 8);
          }
          break;
        }
        case 'merchant': {
          Sp.shadow(c, 11);
          G(10, -16, 34, '#ffcf6a', 0.4); L(8, -16, 100, '#ffcf6a', 0.7);
          c.fillStyle = '#4a3a5a'; c.beginPath(); c.moveTo(-9, 0); c.lineTo(-7, -18); c.quadraticCurveTo(0, -30, 7, -18); c.lineTo(9, 0); c.closePath(); c.fill(); c.stroke();
          c.fillStyle = '#5e4a72'; c.beginPath(); c.moveTo(-7, -18); c.quadraticCurveTo(0, -30, 7, -18); c.lineTo(3, -18); c.quadraticCurveTo(0, -25, -3, -18); c.fill();
          c.fillStyle = '#1a1220'; c.beginPath(); c.ellipse(0, -18, 4.5, 4, 0, 0, U.TAU); c.fill();
          c.fillStyle = '#ffd36b'; c.fillRect(-2.5, -19, 1.6, 1.6); c.fillRect(1, -19, 1.6, 1.6);
          c.fillStyle = '#c9a640'; c.fillRect(8, -18, 5, 7); c.fillStyle = '#fff3c4'; c.fillRect(9, -17, 3, 5);
          c.fillStyle = '#6a4a22'; c.fillRect(-16, -8, 8, 8); c.strokeRect(-16, -8, 8, 8);
          break;
        }
        case 'fountain': {
          Sp.shadow(c, 18);
          c.fillStyle = '#5a6a72'; c.beginPath(); c.ellipse(0, -4, 18, 8, 0, 0, U.TAU); c.fill(); c.stroke();
          c.fillStyle = '#7a8a92'; c.beginPath(); c.ellipse(0, -5.5, 18, 6.5, 0, Math.PI, 0); c.fill();
          c.fillStyle = p.state ? '#2a3a40' : '#4fc8e8'; c.beginPath(); c.ellipse(0, -5, 14, 5.5, 0, 0, U.TAU); c.fill();
          c.fillStyle = '#6a7a82'; c.fillRect(-3, -22, 6, 17); c.strokeRect(-3, -22, 6, 17);
          if (!p.state) {
            G(0, -10, 34, '#6fe6ff', 0.4); L(0, -10, 110, '#6fe6ff', 0.75);
            c.fillStyle = 'rgba(180,240,255,0.85)'; for (let i = 0; i < 4; i++) { const k = (t * 1.5 + i / 4) % 1; c.fillRect(-1 + Math.sin(i * 2) * 6 * k, -22 + k * 16, 1.5, 3); }
            c.strokeStyle = 'rgba(200,250,255,0.5)'; c.lineWidth = 0.8; const k2 = (t * 0.7) % 1; c.globalAlpha = 1 - k2; c.beginPath(); c.ellipse(0, -5, 4 + k2 * 10, 1.6 + k2 * 4, 0, 0, U.TAU); c.stroke(); c.globalAlpha = 1;
          }
          break;
        }
        case 'altar': {
          Sp.shadow(c, 14);
          c.fillStyle = '#3a2a2a'; c.fillRect(-14, -12, 28, 12); c.strokeRect(-14, -12, 28, 12);
          c.fillStyle = '#5a3a3a'; c.fillRect(-16, -16, 32, 5); c.strokeRect(-16, -16, 32, 5);
          if (!p.state) {
            const pl = 0.55 + Math.sin(t * 4) * 0.15;
            G(0, -20, 32, '#d43a5a', pl); L(0, -18, 100, '#d43a5a', 0.8);
            c.fillStyle = '#d43a5a'; c.beginPath(); c.ellipse(0, -16, 9, 2.5, 0, 0, U.TAU); c.fill();
            c.fillStyle = 'rgba(255,120,140,0.7)'; for (let i = 0; i < 3; i++) { const k = (t * 0.8 + i / 3) % 1; c.globalAlpha = 1 - k; c.fillRect(-4 + i * 4 + Math.sin(t * 3 + i) * 1.5, -17 - k * 14, 1.6, 2.4); } c.globalAlpha = 1;
          }
          break;
        }
        case 'gamble': {
          Sp.shadow(c, 12);
          c.fillStyle = '#4a4038'; c.fillRect(-10, -8, 20, 8); c.strokeRect(-10, -8, 20, 8);
          c.fillStyle = p.state ? '#6a5a40' : '#e6c24a'; c.beginPath(); c.arc(0, -18, 8, 0, U.TAU); c.fill(); c.stroke();
          c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(-2.5, -20.5, 3, 0, U.TAU); c.fill();
          c.fillStyle = p.state ? '#6a5a40' : '#e6c24a'; c.fillRect(-5, -12, 10, 5);
          if (!p.state) { G(0, -18, 28, '#ffd36b', 0.45); L(0, -18, 90, '#ffd36b', 0.7); }
          break;
        }
        case 'trial': {
          Sp.shadow(c, 12);
          c.fillStyle = '#4a4a52'; c.fillRect(-6, -30, 12, 30); c.strokeRect(-6, -30, 12, 30);
          c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(-6, -30, 3, 30);
          c.strokeStyle = p.state ? '#555' : '#ff6a4a'; c.lineWidth = 2.5;
          c.beginPath(); c.moveTo(-12, -40); c.lineTo(12, -16); c.moveTo(12, -40); c.lineTo(-12, -16); c.stroke();
          if (!p.state) { G(0, -28, 30, '#ff6a4a', 0.5); L(0, -28, 100, '#ff6a4a', 0.75); }
          break;
        }
        case 'portal': {
          const r = 22 + Math.sin(t * 3) * 2;
          G(0, -10, 74, '#c98bff', 0.65); L(0, -10, 190, '#c98bff', 1);
          c.save(); c.translate(0, -10);
          c.fillStyle = 'rgba(20,6,40,0.85)'; c.beginPath(); c.ellipse(0, 0, r, r * 1.25, 0, 0, U.TAU); c.fill();
          for (let i = 0; i < 5; i++) { c.strokeStyle = U.rgba(i % 2 ? '#ffd8f4' : '#9a6aff', 0.85); c.lineWidth = 2.5; c.beginPath(); c.ellipse(0, 0, r - i * 4, (r - i * 4) * 1.25, 0, t * (2 + i * 0.5) + i, t * (2 + i * 0.5) + i + 4); c.stroke(); }
          c.fillStyle = 'rgba(8,2,20,0.95)'; c.beginPath(); c.ellipse(0, 0, 8, 10, 0, 0, U.TAU); c.fill();
          c.restore();
          break;
        }
        case 'sign': {
          Sp.shadow(c, 9, 0.3);
          c.fillStyle = '#5a4a3a'; c.fillRect(-1.5, -12, 3, 12);
          c.fillStyle = '#8a6a4a'; c.fillRect(-11, -22, 22, 12); c.strokeRect(-11, -22, 22, 12);
          c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(-11, -22, 22, 2);
          c.fillStyle = '#3a2a1a'; c.fillRect(-7, -18, 14, 1.2); c.fillRect(-7, -15, 10, 1.2);
          break;
        }
        case 'reward': {
          // generic reward plinth; the colour follows the reward string when the prop carries one
          const col = rewardColor(p.reward || p.rw || p.item || p.what), bob = Math.sin(t * 2.6 + p.id) * 2.5;
          Sp.shadow(c, 14);
          c.fillStyle = '#3a3330'; c.fillRect(-11, -7, 22, 9); c.strokeRect(-11, -7, 22, 9);
          c.fillStyle = '#524a44'; c.fillRect(-13, -10, 26, 4); c.strokeRect(-13, -10, 26, 4);
          G(0, -26 + bob, 34, col, 0.7); L(0, -24, 120, col, 0.95);
          const me = view.players.get(local), ri = R.rewardIcon(p.item, me ? me.cls : null);
          c.drawImage(ED.Icons.canvas(ri[0], ri[1], 24), -12, Math.round(-38 + bob));
          for (let i = 0; i < 3; i++) { const a = t * 1.5 + i * 2.1; G(Math.cos(a) * 15, -26 + bob + Math.sin(a) * 6, 5, col, 0.8); }
          break;
        }
        case 'campfire': {
          Sp.shadow(c, 14);
          c.fillStyle = '#2a1a10'; for (let i = 0; i < 4; i++) { c.save(); c.rotate(-0.7 + i * 0.5); c.fillRect(-9, -1.6, 18, 3.2); c.restore(); }
          G(0, -8, 46, '#ff8a3d', 0.6 + Math.sin(t * 9) * 0.06); L(0, -8, 170, '#ff9a4a', 1.1);
          for (let i = 0; i < 3; i++) { const fl = Math.sin(t * 10 + i * 1.7), h = 15 - i * 3.4; c.fillStyle = ['#ff6a1a', '#ffb347', '#fff1c4'][i]; c.beginPath(); c.moveTo(-6 + i * 1.5, -1); c.quadraticCurveTo(-3 + fl, -h * 0.6, fl * 1.5, -h); c.quadraticCurveTo(3 + fl, -h * 0.6, 6 - i * 1.5, -1); c.fill(); }
          break;
        }
        case 'anvil': {
          Sp.shadow(c, 12);
          c.fillStyle = '#34343a'; c.fillRect(-9, -5, 18, 5); c.strokeRect(-9, -5, 18, 5);
          c.fillRect(-4.5, -11, 9, 6); c.strokeRect(-4.5, -11, 9, 6);
          c.fillStyle = '#4a4a52'; c.beginPath(); c.moveTo(-17, -14); c.quadraticCurveTo(-10, -14, -7, -17); c.lineTo(12, -17); c.lineTo(12, -11); c.lineTo(-5, -11); c.quadraticCurveTo(-11, -11, -17, -14); c.closePath(); c.fill(); c.stroke();
          c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(-7, -17, 19, 1.5);
          if (!p.state) { G(0, -14, 26, '#ff9a3a', 0.5); L(0, -14, 80, '#ff9a3a', 0.7); }
          break;
        }
        default: break;
      }
      c.restore();
    }
  }

  // ---------------- status overlays (foes) and hero effects ----------------
  const LOOK_H = { priest: 44, rift: 44, sentinel: 48, knight: 34, golem: 36, hulk: 30, robed: 30, wraith: 36, reaver: 34, drone: 24, worm: 40, horror: 36, shade: 30, imp: 24, totem: 30, skeleton: 28, zombie: 28, wolf: 20, crab: 20, spider: 14, slime: 18, spitter: 28, shroom: 26, eel: 18 }; // approximate sprite heights at def.r (used without atlas anchors)
  const BURN_K = [0, 0.85, 1.1, 1.4]; // light scale per burn level
  const hash1 = Pix.hash;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const s2 = Pix.s2;
  let curView = null; // view of the frame being drawn: the host reads Radiance and the Reap line of its own foes from it
  // Status light + halo, capped per frame (fewer on low quality).
  const stLight = (x, y, r, col, k) => { if (stN < (R.quality === 'low' ? 8 : 26)) { stN++; R.light(x, y, r, col, k); R.emit(x, y, r * 0.45, col, k * 0.5); } };
  // Overlay geometry of a foe silhouette: radius r, body centre cy, half-height hh and top (feet-relative world px, up is negative) plus its baked status sprites; shared by every foe of that shape.
  // The numbers come from the atlas anchors (R.actorAnchor) when the actor drawing provides them, else from the per-look heights.
  function foeGeom(e) {
    const r = e.r, an = R.actorAnchor ? R.actorAnchor(e) : null;
    let cy, top;
    if (an) { cy = an.cy; top = an.top; }
    else { const fly = !!e.def.fly, bh = fly ? r * 2.6 : (LOOK_H[e.def.look] || r * 2.7) * (r / e.def.r); cy = fly ? -r * 1.7 : -bh * 0.5; top = -bh; }
    let G = e._sg;
    if (!G || G.r !== r || G.cy !== cy || G.top !== top) {
      const key = r + '|' + ((cy * 2) | 0) + '|' + ((top * 2) | 0);
      G = geoms.get(key);
      if (!G) geoms.set(key, G = { r, cy, top, hh: Math.max(6, an ? cy - top : -top * 0.56), gen: -1, chill: null, frozen: null });
      e._sg = G;
    }
    if (G.gen !== sprGen) { G.gen = sprGen; G.chill = []; G.frozen = null; }
    return G;
  }
  const lazy = (arr, i, make) => arr[i] || (arr[i] = (sprPx > SPR_PX_MAX && sprClear(), make()));
  // Pixel ice crystal (2 art px wide, 4 tall) with its tip at (x, y).
  function crystal(g, x, y) {
    g.fillStyle = '#e8fbff'; g.fillRect(x, y, 2, 2); g.fillRect(x - 2, y + 2, 2, 6);
    g.fillStyle = '#7fe3ff'; g.fillRect(x, y + 2, 4, 6); g.fillRect(x, y + 8, 2, 2);
  }
  // Chill: a dithered frost haze over the body plus 2-4 ice crystals on its edge, static per (chill step 1..8, layout 0..3).
  function chillSprite(G, cb, v) {
    return lazy(G.chill, cb * 4 + v, () => {
      const r = G.r, cy = G.cy, hh = G.hh, ch = cb / 8, n = 2 + Math.round(ch * 2), xe = Math.ceil(r + 10), y0 = Math.floor(cy - hh - 8), y1 = Math.ceil(cy + hh + 6);
      return bake(-xe, y0, xe, y1, false, (g) => {
        for (let y = y0; y < y1; y += 2) for (let x = -xe; x < xe; x += 2) {
          const dx = (x + 1) / (r * 1.0), dy = (y + 1 - cy) / (hh * 1.0), d = dx * dx + dy * dy;
          if (d > 1 || BAYER[((y >> 1) & 3) * 4 + ((x >> 1) & 3)] / 16 >= (0.1 + 0.32 * ch) * (1.25 - d * 0.7)) continue;
          g.fillStyle = (x + y) & 2 ? 'rgba(200,246,255,0.7)' : 'rgba(159,239,255,0.55)'; g.fillRect(x, y, 2, 2);
        }
        for (let i = 0; i < n; i++) { const a = i * 2.4 + v * 1.9; crystal(g, s2(Math.cos(a) * r * 0.95), s2(cy + Math.sin(a) * hh * 0.95) - 4); }
      });
    });
  }
  // Frozen shell: a pixel ice block around the silhouette (translucent fill, 1 px rim, two glints, crown spikes), static per silhouette.
  function frozenSprite(G) {
    if (G.frozen) return G.frozen;
    if (sprPx > SPR_PX_MAX) sprClear();
    const r = G.r, cy = G.cy, w = r * 1.45, h = G.hh, xe = Math.ceil(w + 8), y0 = Math.floor(cy - h - 8), y1 = Math.ceil(cy + h + 6);
    const poly = [[-w, cy - h * 0.7], [-w * 0.55, cy - h], [w * 0.6, cy - h * 0.95], [w, cy - h * 0.6], [w * 0.9, cy + h * 0.8], [w * 0.4, cy + h], [-w * 0.5, cy + h * 0.95], [-w, cy + h * 0.6]];
    const inside = (x, y) => { let c2 = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c2 = !c2; } return c2; };
    return (G.frozen = bake(-xe, y0, xe, y1, false, (g) => {
      const cols = Math.ceil(2 * xe / 2), rows = Math.ceil((y1 - y0) / 2), ins = new Uint8Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ins[j * cols + i] = inside(-xe + i * 2 + 1, y0 + j * 2 + 1) ? 1 : 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (!ins[j * cols + i]) continue;
        const rim = i === 0 || j === 0 || i === cols - 1 || j === rows - 1 || !ins[j * cols + i - 1] || !ins[j * cols + i + 1] || !ins[(j - 1) * cols + i] || !ins[(j + 1) * cols + i];
        g.fillStyle = rim ? '#f0fdff' : 'rgba(191,234,255,0.36)'; g.fillRect(-xe + i * 2, y0 + j * 2, 2, 2);
      }
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let k = 0; k < 5; k++) { g.fillRect(s2(-w * 0.62 + k * w * 0.13), s2(cy - h * 0.65 + k * h * 0.28), 2, 2); if (k < 3) g.fillRect(s2(w * 0.28 + k * w * 0.1), s2(cy - h * 0.75 + k * h * 0.3), 2, 2); }
    }));
  }
  // Pixel bubble ring (plus-shaped, hollow) at the even point (x, y), added to the current path.
  const bubble = (c, x, y) => { c.rect(x, y - 2, 2, 2); c.rect(x, y + 2, 2, 2); c.rect(x - 2, y, 2, 2); c.rect(x + 2, y, 2, 2); };
  // Chevron (V) of 5 squares with its tip at (x, y), added to the current path.
  const chevron = (c, x, y) => { c.rect(x - 4, y - 4, 2, 2); c.rect(x - 2, y - 2, 2, 2); c.rect(x, y, 2, 2); c.rect(x + 2, y - 2, 2, 2); c.rect(x + 4, y - 4, 2, 2); };
  // Gold Radiance halo under a foe: an ellipse ring of three 120 degree segments, the first `lvl` lit.
  function radSprite(rx, lvl) {
    const ry = Math.max(2, Math.round(rx * 0.45));
    return Pix.bake('rad|' + rx + '|' + lvl, rx * 2, ry * 2, rx, ry, (b, w) => {
      const lit = Pix.px32('#ffcf5a'), dim = Pix.px32('#7a5a20');
      for (let y = 0; y < ry * 2; y++) for (let x = 0; x < rx * 2; x++) {
        const dx = (x + 0.5 - rx) / rx, dy = (y + 0.5 - ry) / ry, d = Math.hypot(dx, dy);
        if (d > 1 || Math.hypot((x + 0.5 - rx) / (rx - 1), (y + 0.5 - ry) / (ry - 1)) < 1) continue;
        const seg = Math.floor(((Math.atan2(dy, dx) + Math.PI * 1.5) % U.TAU) / (U.TAU / 3));
        b[y * w + x] = seg < lvl ? lit : dim;
      }
    });
  }
  const venomOf = (e) => e.venomLvl !== undefined ? e.venomLvl : ED.Net.venomLevel(e);
  const doomOf = (e) => e.doomLine !== undefined ? e.doomLine : (e.boss ? e.doom : curView && curView.doomLine ? curView.doomLine(e) : 0);
  // Pixel stand-ins (2 px per char; 1 = body, 2 = accent) for the overhead glyphs while the atlas lacks them.
  const GLYPH = {
    skull: { rows: ['.111.', '11111', '12121', '11111', '.1.1.'], c: { 1: '#d9c8ff', 2: '#1c0c3a' } },
    guard: { rows: ['11111', '11211', '12211', '.121.', '..1..'], c: { 1: '#9be33c', 2: '#26340f' } },
    star: { rows: ['.1.', '111', '.1.'], c: { 1: '#ffe66b' } },
  };
  function glyphStub(c, g, cx, bottom) {
    const rows = g.rows, x0 = cx - rows[0].length, y0 = bottom - rows.length * 2;
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) { const ch = rows[j][i]; if (ch === '.') continue; c.fillStyle = g.c[ch]; c.fillRect(x0 + i * 2, y0 + j * 2, 2, 2); }
  }
  // Overhead status marks of a foe, drawn with the HP bars above the lighting. Layout bottom-up from the bar line (bosses have no bar): ward bar and an elite's name, then the Venom pips on their own line,
  // then one row of glyphs left to right: stun stars, Doom skull (the Reap is near), Corroded cracked guard, Charge bolt. Nothing shares a point, whatever the combination.
  const xg = []; // class glyphs of the foe being drawn (ED.ClassFx.mark)
  function drawMarks(c, e, t) {
    const vl = venomOf(e), dl = doomOf(e), skull = dl > 0 && !e.boss && e.hp < 1.5 * dl, stun = e.stun > 0, chg = e.charge > 0, cor = vl >= 5;
    const xm = ED.ClassFx.mark; let xn = 0;
    for (let i = 0; i < xm.length; i++) { const g = xm[i](e); if (g) xg[xn++] = g; }
    if (!(vl > 0 || skull || stun || chg || xn)) return;
    const G = foeGeom(e), r = G.r, id = e.id | 0, af = e.elite ? ED.AFFIXES[e.elite] : null;
    let b = e.boss ? s2(G.top) - 4 : s2(Math.min(G.top - 6, -(r * 2.6 + (e.def.fly ? 14 : 4)))) - 2; // bottom of the free space
    if (!e.boss) { if (e.ward > 0) b -= (R.scale >= 2 ? 2 : 3) + 1; if (af) b -= Math.ceil(R.labelH()) + 4; }
    const ox = Math.round(e.x), oy = Math.round(e.y) + b; // marks are laid out in the foe's feet frame with the baseline b, drawn at (ox, oy + ...)
    b = 0;
    if (vl > 0) { // four pips on a dark plate; Corroded lights all four bright
      const x0 = s2(ox - 11);
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x0 - 2, oy - 4, 26, 6);
      for (let i = 0; i < 4; i++) { c.fillStyle = cor ? '#c8ff5a' : i < vl ? '#9be33c' : '#26340f'; c.fillRect(x0 + i * 6, oy - 2, 4, 2); }
      b = -6;
    } else b = -2;
    const n = (stun ? 1 : 0) + (skull ? 1 : 0) + (cor ? 1 : 0) + (chg ? 1 : 0) + xn;
    if (n) {
      const w = (stun ? 26 : 0) + (skull ? 14 : 0) + (cor ? 14 : 0) + (chg ? 6 : 0) + xn * 14 + (n - 1) * 2;
      let x = s2(ox - w / 2);
      const by = oy + b; // bottom of the glyph row
      if (stun) { // three stars orbiting on a flat ellipse
        for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.094 + id, sx = s2(x + 13 + Math.cos(a) * 8), sy = by - 5 + Math.round(Math.sin(a) * 2); if (!Pix.draw(c, 'fx.star.stun', '', 0, sx, sy)) glyphStub(c, GLYPH.star, sx, sy + 3); }
        x += 28;
      }
      if (skull) { const up = Math.sin(t * 4 + id) > 0 ? 2 : 0, sx = x + 6, sy = by - 7 - up; if (!Pix.draw(c, 'fx.sigil.skull', 'shadow', 0, sx, sy)) glyphStub(c, GLYPH.skull, sx, sy + 5); x += 16; }
      if (cor) { const up = Math.sin(t * 5 + id) > 0 ? 2 : 0, sx = x + 6, sy = by - 7 - up; if (!Pix.draw(c, 'fx.glyph.corroded', '', 0, sx, sy)) glyphStub(c, GLYPH.guard, sx, sy + 5); x += 16; }
      if (chg && ((t * 3 + id) | 0) % 2 === 0) { c.fillStyle = '#ffe66b'; c.fillRect(x + 2, by - 8, 4, 2); c.fillRect(x, by - 6, 4, 2); c.fillRect(x + 2, by - 4, 2, 2); c.fillRect(x, by - 2, 4, 2); }
      if (chg) x += 8;
      for (let i = 0; i < xn; i++) { const g = xg[i], up = Math.sin(t * 4 + id + i) > 0 ? 2 : 0, sx = x + 6, sy = by - 7 - up; if (!Pix.draw(c, g.id, g.ramp || '', 0, sx, sy) && GLYPH[g.stub]) glyphStub(c, GLYPH[g.stub], sx, sy + 5); x += 16; }
    }
  }
  // Drawn at the foe's origin right after its sprite. Element colours: Burn fire, Chill and Freeze ice, Charge lightning, Venom poison, Radiance holy, Doom shadow, Bleed red; pixel art on the 2 px grid.
  // Chill, Freeze and Radiance halos are baked sprites (one blit each); the rest are atlas sprites and 2 px squares batched into one path per kind.
  function drawStatus(c, e, t, full) { // full = false (crowd LOD): the moving decoration (embers, bubbles, drips, motes, smoke) is skipped, every status keeps its icon, sprite or ring
    if (e.burrowed || e.hp <= 0) return;
    const G = foeGeom(e), r = G.r, id = e.id | 0, cy = G.cy, hh = G.hh;
    let s;
    if (e.ward > 0) {
      const sh = 0.5 + 0.2 * Math.sin(t * 4 + id), rx = Math.max(3, Math.round(r * 1.35 / 2)), ry = Math.max(3, Math.round(hh * 1.2 / 2));
      Pix.put(c, Pix.ell(rx, ry, '#7fc8ff', true), 0, s2(cy), sh * 0.22); Pix.put(c, Pix.ell(rx, ry, '#bfe3ff', false), 0, s2(cy), Math.ceil((sh + 0.25) * 4) / 4);
    }
    if (e.frozen > 0) {
      s = frozenSprite(G); c.drawImage(s.cv, s.x, s.y, s.w, s.h);
      stLight(e.x, e.y + cy, r * 3.2, '#8fe8ff', 0.5);
    } else if (e.chill > 0) {
      const ch = U.clamp(e.chill / 100, 0.1, 1);
      s = chillSprite(G, Math.max(1, Math.round(ch * 8)), id & 3); c.drawImage(s.cv, s.x, s.y, s.w, s.h);
      if (R.actorTint) R.actorTint(c, e, '#c8f6ff', 0.15 + 0.2 * ch); // optional: the actor drawing tints its own silhouette
      stLight(e.x, e.y + cy, r * 2.6, '#7fe3ff', 0.15 + 0.35 * ch);
    }
    const bl = e.burnLvl !== undefined ? e.burnLvl : ED.Net.burnLevel(e); // clients get the level in the snapshot, host/solo derive it from the pool: same flames
    if (bl > 0) { // micro flames (fx.ember loop) on the shoulders and head, staggered frames, plus rising embers
      const f = (t * 12 + id) | 0;
      for (let i = 0; i < bl; i++) { const fx = s2((i - (bl - 1) / 2) * r * 0.8), fy = s2(cy - hh * (i & 1 ? 0.15 : 0.55)); if (!Pix.draw(c, 'fx.ember', '', f + i * 3, fx, fy)) flameStub(c, fx, fy + 4, f + i * 3, 'fire', 1, 2); }
      if (full) {
        c.fillStyle = '#ff9a3a'; c.beginPath();
        for (let i = 0; i < 2 + bl; i++) { const ph = (t * 1.1 + i * 0.37 + id * 0.17) % 1; if (ph > 0.15) c.rect(s2(Math.sin(i * 2.3 + id) * r * 0.7), s2(cy - hh * 0.4 - ph * (hh + 12)), 2, 2); }
        c.fill();
      }
      stLight(e.x, e.y - r, r * 3.2, '#ff7a2a', 0.5 * BURN_K[bl]);
    }
    if (e.charge > 0) { // two to three yellow sparks (plus-shaped, white core) re-rolled at 15 Hz around the body (the bolt glyph over the head is an overhead mark)
      const q = Math.floor(t * 15) + id * 7, ns = full ? 3 : 1;
      c.fillStyle = '#ffe66b'; c.beginPath();
      for (let i = 0; i < ns; i++) { const a = hash1(q * 3.1 + i * 5.7) * U.TAU, x = s2(Math.cos(a) * r * 0.85), y = s2(cy + Math.sin(a) * hh * 0.85); c.rect(x - 2, y, 6, 2); c.rect(x, y - 2, 2, 6); }
      c.fill();
      c.fillStyle = '#ffffff'; c.beginPath();
      for (let i = 0; i < ns; i++) { const a = hash1(q * 3.1 + i * 5.7) * U.TAU; c.rect(s2(Math.cos(a) * r * 0.85), s2(cy + Math.sin(a) * hh * 0.85), 2, 2); }
      c.fill();
      stLight(e.x, e.y + cy, r * 2.6, '#ffe66b', 0.45);
    }
    if (e.bleedPool > 0) { // red drips (1x2 art px) falling from the body
      c.fillStyle = '#c4182e'; c.beginPath();
      for (let i = 0, n = full ? 3 : 1; i < n; i++) { const ph = (t * 1.6 + id * 0.13 + i * 0.37) % 1; c.rect(s2((i - 1) * r * 0.55), s2(cy - hh * 0.2 + ph * hh * 1.1), 2, ph > 0.5 ? 4 : 2); }
      c.fill();
    }
    const vl = venomOf(e);
    if (vl > 0) { // bubbles rise from the body (one per pip; Corroded: acid drips); the pips and the cracked-guard glyph are overhead marks
      c.fillStyle = '#9be33c'; c.beginPath();
      const nb = full ? Math.min(vl, 4) : 0;
      for (let i = 0; i < nb; i++) { const ph = (t * 0.7 + i / nb + id * 0.13) % 1; bubble(c, s2(Math.sin(i * 2.7 + id) * r * 0.7), s2(cy + hh * 0.3 - ph * (hh + 10))); }
      if (vl >= 5 && full) for (let i = 0; i < 3; i++) { const ph = (t * 1.3 + id * 0.1 + i * 0.33) % 1; c.rect(s2((i - 1) * r * 0.6), s2(cy - hh * 0.3 + ph * hh * 1.2), 2, 4); }
      c.fill();
      stLight(e.x, e.y + cy, r * 2.2, '#9be33c', vl >= 5 ? 0.4 : 0.22);
    }
    const rl = e.radLvl !== undefined ? e.radLvl : (curView && curView.smiteAt ? ED.Net.radLevel(curView, e) : 0);
    if (rl > 0) { // gold halo ring under the foe (0..3 segments lit) and rising motes
      Pix.put(c, radSprite(Math.max(4, Math.round(r * 1.1 / 2)), rl), 0, 0);
      c.fillStyle = '#ffe9a0'; c.beginPath();
      for (let i = 0; i < (full ? 2 : 0); i++) { const ph = (t * 0.8 + i * 0.5 + id * 0.1) % 1; if (ph < 0.85) c.rect(s2(Math.sin(i * 3.1 + id) * r * 0.7), s2(-ph * (hh * 1.4)), 2, 2); }
      c.fill();
      stLight(e.x, e.y + cy, r * 2.2, '#ffcf5a', 0.2 + 0.08 * rl);
    }
    const dl = doomOf(e);
    if (dl > 0) { // violet smoke sinking into the ground (the skull sigil over the head, once the Reap is near, is an overhead mark)
      for (let i = 0; i < (full ? 3 : 0); i++) {
        const ph = (t * 0.7 + i / 3 + id * 0.1) % 1, x = s2(Math.sin(ph * 5 + i * 2 + id) * r * 0.55), y = s2(cy + hh * 0.3 + ph * (-cy - hh * 0.3));
        c.globalAlpha = Math.max(0.25, Math.ceil((1 - ph) * 4) / 4); c.fillStyle = '#5a2fb0'; c.fillRect(x - 2, y - 2, 4, 4); c.fillStyle = '#c9b3ff'; c.fillRect(x - 2, y - 2, 2, 2);
      }
      c.globalAlpha = 1;
      stLight(e.x, e.y + cy, r * 2.2, '#a070ff', 0.25);
    }
    if (e.judged > 0) { // gold ring on the ground with four cross marks turning around it
      const rx = Math.max(4, Math.round(r * 1.5 / 2)), rot = t * 1.2;
      Pix.put(c, Pix.ell(rx, Math.max(2, Math.round(rx * 0.5)), '#ffd36b', false), 0, -2, 0.85);
      c.fillStyle = '#fff3c4'; c.beginPath();
      for (let i = 0; i < 4; i++) { const a = rot + i * U.TAU / 4, x = s2(Math.cos(a) * rx * 2), y = s2(Math.sin(a) * rx) - 2; c.rect(x - 2, y, 6, 2); c.rect(x, y - 2, 2, 6); }
      c.fill();
      stLight(e.x, e.y, r * 2.4, '#ffd36b', 0.35);
    }
    if (e.vulnT > 0) { // takes +20% damage (Hailthorns, Smokescreen): two pink chevrons dripping down beside the body
      const x = s2(r * 0.95 + 6), hv = hh * 1.1;
      c.fillStyle = '#ff8ed0';
      for (let i = 0; i < 2; i++) {
        const ph = (t * 1.3 + i * 0.5 + id * 0.17) % 1;
        c.globalAlpha = Math.max(0.25, Math.ceil(Math.sin(ph * Math.PI) * 4) / 4); c.beginPath(); chevron(c, x, s2(cy - hh * 0.55 + ph * hv)); c.fill();
      }
      c.globalAlpha = 1;
    }
    if (e.blind > 0 && full) { // smoke curling off the head and dim motes circling it
      const hy = cy - hh * 0.95;
      c.fillStyle = '#a09ac0'; c.strokeStyle = '#2a2540';
      for (let i = 0; i < 3; i++) { const ph = (t * 0.8 + i / 3 + id * 0.1) % 1, w = 2 + ((ph * 3) | 0) * 2; c.globalAlpha = Math.max(0.25, Math.ceil((1 - ph) * 4) / 4); c.fillRect(s2(Math.sin(ph * 6.28 + i * 2) * r * 0.5) - w / 2, s2(hy - ph * 10), w, w); }
      c.globalAlpha = 1; c.fillStyle = '#cfc8f0'; c.beginPath();
      for (let i = 0; i < 3; i++) { const a = t * 3 + i * U.TAU / 3 + id; c.rect(s2(Math.cos(a) * r * 0.9), s2(hy + 2 + Math.sin(a) * 3), 2, 2); }
      c.fill();
    }
  }

  // Drawn at the hero's origin after the sprite: evolution aura, shield, ambush glint.
  function drawHeroFx(c, p, t) {
    if (p.dead) return;
    if (p.dashing) p._dsh = 1;
    else if (p._dsh) { // a dash or charge ends in a dust ring; a Shield Charge also in an impact flare
      p._dsh = 0; const FX = ED.FX, ct = FX.chargeT[p.pid];
      FX.dust(p.x, p.y + 2, 'dust', 1);
      if (ct !== undefined && FX.time - ct < 0.7) FX.chargeHit(p.x + Math.cos(p.face || 0) * 16, p.y - 10, p.face || 0, p.pid === R.local);
    }
    const st = p.stats, evo = st && st.evo, low = R.quality === 'low', a0 = p.stealthT > 0 ? (p.pid === R.local ? 0.45 : 0.2) : 1;
    if (a0 < 1) c.globalAlpha = a0;
    if (evo && !p.downed && PATH_COL[evo]) {
      const col = PATH_COL[evo];
      Pix.put(c, Pix.ell(8, 4, col, false, 2, (t * 8) & 7), 0, 2, 0.65); // dashed rim under the hero, the dashes turning
      if (!low) { c.fillStyle = col; c.beginPath(); for (let i = 0; i < 3; i++) { const a = t * 1.8 + i * U.TAU / 3, x = Pix.s2(Math.cos(a) * 17), y = Pix.s2(-11 + Math.sin(a) * 7); c.rect(x, y - 2, 2, 6); c.rect(x - 2, y, 6, 2); } c.fill(); } // orbiting pixel diamonds
      R.emit(p.x, p.y - 10, 24, col, 0.2 + Math.sin(t * 3 + (p.slot || 0)) * 0.05); R.light(p.x, p.y - 10, 62, col, 0.28);
    }
    if (p.shield > 0) {
      const fr = U.clamp(p.shield / Math.max(1, p.maxHp * 0.12), 0.15, 1), rx = 6 + Math.round(4 * fr), ry = Math.round(rx * 1.2), an = R.actorAnchor ? R.actorAnchor(p) : null, cyh = Pix.s2(an ? an.cy : -12); // ring full at a 12% shield (the Holy ceiling)
      const holy = ED.FX.holyT && ED.FX.holyT[p.pid] > ED.FX.time, pulse = Math.round(Math.sin(t * 4 + (p.slot || 0))); // a recent Holy grant tints the bubble gold
      Pix.put(c, Pix.ell(rx, ry, holy ? '#ffcf5a' : '#9fd0ff', true), 0, cyh, 0.1 + 0.14 * fr); Pix.put(c, Pix.ell(rx + (pulse > 0 ? 1 : 0), ry + (pulse > 0 ? 1 : 0), holy ? '#fff0c2' : '#e8f4ff', false), 0, cyh, Math.ceil((0.5 + 0.3 * fr) * 4) / 4);
      c.fillStyle = '#ffffff'; c.fillRect(Pix.s2(-rx * 1.3), Pix.s2(cyh - ry * 1.6), 4, 2); c.fillRect(Pix.s2(-rx * 1.7), Pix.s2(cyh - ry * 1.2), 2, 4); // glint on the upper left
    }
    if (p.ambush && !p.downed) R.emit(p.x, p.y - 12, 22, '#b78cff', 0.3 + Math.sin(t * 9) * 0.12);
    const xh = ED.ClassFx.hero; for (let i = 0; i < xh.length; i++) xh[i](c, p, t, low);
    c.globalAlpha = 1;
  }

  // ---------------- projectiles ----------------
  // Three passes per frame: 0 registers scene lights, 1 (additive) draws halos, 2 (unlit, after the lighting) draws trails and bodies. Hero shots are atlas sprites rotated through the atlas's 32 baked steps or pixel orbs;
  // foe bullets are pixel orbs sized to their hitbox (disc of r/2 art px, 1 px dark rim, three element tones). Trails are 2 px squares on the art grid; only the halos are soft.
  const SHOT = { // atlas shots: anim, spin (rad/s; 0 = along the heading), q = quarter turns only
    arrow: { id: 'proj.arrow' }, bolt: { id: 'proj.bolt' }, knife: { id: 'proj.knife' }, trident: { id: 'proj.trident' }, thorn: { id: 'proj.thorn' }, fireball: { id: 'proj.fireball' },
    bone: { id: 'proj.bone', spin: 14 }, hammer: { id: 'proj.hammer', spin: 16 }, shield: { id: 'proj.shield', spin: 14 }, skull: { id: 'proj.skull', spin: 8, q: 1 }, web: { id: 'proj.web', spin: 3 },
  };
  const DIAMOND = { shard: 1, iceshard: 1 }, CRESCENT = { wave: 1, crescent: 1, bloodscythe: 1 };
  const SOLID = { arrow: 1, bolt: 1, knife: 1, trident: 1, thorn: 1, bone: 1, hammer: 1, shield: 1, skull: 1, web: 1 }; // sprite shots: a small halo only
  const TRAIL = { arrow: '#e8d8b0', bolt: '#cfd6de', knife: '#d9dfe8', trident: '#e8c66b', thorn: '#9cff6a', shield: '#ffe9a0', hammer: '#ffe9a0' }; // plain sprite trails; the others trail their element colour
  const NOTRAIL = { bone: 1, skull: 1, web: 1 }, HALO = { skull: '#a070ff' }; // HALO: shots whose glow is not their team / element colour (the violet skull)
  const FLAME = { fire: 1, firebolt: 1, fireball: 1, droneshot: 1, crescent: 1 }; // ember trails flicker through the fire ramp
  const dirOf = {};
  // Canvas angle the art points along as drawn (anchors.dir is degrees clockwise from screen up).
  function shotDir(id) {
    let d = dirOf[id];
    if (d === undefined) { const a = ED.Atlas.anim(id); if (!a) return 0; d = dirOf[id] = a.anchors && a.anchors.dir !== undefined ? (a.anchors.dir - 90) * Math.PI / 180 : 0; }
    return d;
  }
  // Pixel lozenge (shard / iceshard shots) or crescent (wave shots) pointing along step / 32 turns, baked per (size, colour, step, team). A foe's lozenge is as wide as its hitbox (half-width rA art px).
  function diamondSprite(rA, col, st, foe) {
    const rp = Pix.ramp(col), L = Math.max(3, rA * 1.7), W = foe ? Math.max(rA, 1.6) : Math.max(1.6, rA * 0.7), S = Math.ceil(L) * 2 + 2, th = st / 32 * U.TAU, co = Math.cos(th), si = Math.sin(th);
    return Pix.bake('dm|' + rA + col + st + (foe ? 'f' : ''), S, S, S / 2, S / 2, (b, w) => {
      const c0 = Pix.px32(rp[2]), c1 = Pix.px32(rp[3]), c2 = Pix.px32('#ffffff');
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = x + 0.5 - S / 2, py = y + 0.5 - S / 2, d = Math.abs(px * co + py * si) / L + Math.abs(-px * si + py * co) / W;
        if (d <= 1) b[y * w + x] = d > 0.72 ? c0 : d > 0.36 ? c1 : c2;
      }
    });
  }
  function crescentSprite(rA, col, st) {
    const rp = Pix.ramp(col), R2 = Math.max(4, rA), S = 2 * R2 + 4, th = st / 32 * U.TAU, co = Math.cos(th), si = Math.sin(th);
    return Pix.bake('cr|' + R2 + col + st, S, S, S / 2, S / 2, (b, w) => {
      const c0 = Pix.px32(rp[2]), c1 = Pix.px32(rp[3]), c2 = Pix.px32('#ffffff');
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = x + 0.5 - S / 2, py = y + 0.5 - S / 2, lx = px * co + py * si + 0.4 * R2, ly = -px * si + py * co, d = Math.hypot(lx, ly);
        if (d > R2 || d <= R2 - 3 || Math.abs(Math.atan2(ly, lx)) > 0.95) continue;
        const band = R2 - d;
        b[y * w + x] = band < 1 ? c0 : band < 2 ? c1 : c2;
      }
    });
  }
  const orbOf = (pr, foe, col) => { const rp = Pix.ramp(col); return Pix.orb(Math.max(2, Math.round(pr.r / 2)), foe ? '#1a0604' : rp[0], rp[1], rp[2], rp[3]); }; // dark body, element colour, light core, one white glint
  // Pixel trail of one shot: up to three squares behind it along its motion (ember colours flicker for fire shots).
  function shotTrail(pr, t, kind, col) {
    if (NOTRAIL[kind]) return;
    const sp = Math.hypot(pr.vx, pr.vy); if (sp < 30) return;
    const ux = pr.vx / sp, uy = pr.vy / sp, y = pr.y - 6, n = sp > 280 ? 3 : 2, big = pr.r >= 5 && !SHOT[kind], rp = FLAME[kind] ? Pix.RAMP.fire : null, wavy = kind === 'soul' || kind === 'spectral';
    for (let i = 1; i <= n; i++) {
      const tc = rp ? rp[2 + ((i + Math.floor(t * 14 + pr.id)) & 1)] : (TRAIL[kind] || col), w = Math.sin(t * 18 + i * 1.7 + pr.id) * 3 * (wavy ? 1 : 0); // soul wisps sway across the heading
      Pix.sq(tc, 0.75 - i * 0.2, pr.x - ux * i * 5 - uy * w, y - uy * i * 5 + ux * w, i === 1 && big ? 4 : 2);
    }
    if (kind === 'void') Pix.sq(col, 0.5, pr.x - ux * 14 + uy * (Math.floor(t * 20 + pr.id) & 1 ? 3 : -3), y - uy * 14 - ux * (Math.floor(t * 20 + pr.id) & 1 ? 3 : -3), 2); // dithered tail
    if (kind === 'plague') Pix.sq('#d6ff8a', 0.6, pr.x - ux * 12 + uy * Math.sin(t * 9 + pr.id) * 4, y - uy * 12 - ux * Math.sin(t * 9 + pr.id) * 4, 4); // bubble
  }
  const prebaked = {};
  function shotBody(c, pr, t, kind, foe, col) {
    const sh = SHOT[kind], x = Math.round(pr.x), y = Math.round(pr.y - 6), At = ED.Atlas;
    if (FLAME[kind] && kind !== 'crescent') { const sp = Math.hypot(pr.vx, pr.vy) || 1; Pix.draw(c, 'fx.ember', '', (t * 12 + pr.id) | 0, x - pr.vx / sp * 9, y - pr.vy / sp * 9, 0.9); } // a micro flame licks behind fire shots
    if (sh && At.has(sh.id)) {
      if (!prebaked[sh.id]) { prebaked[sh.id] = 1; for (let f = 0, n = At.anim(sh.id).n; f < n; f++) At.prebake(sh.id, f); } // all 32 rotation steps are baked in the background (Atlas.tick) the first time a shot kind shows up
      let rot = sh.spin ? t * sh.spin + (pr.id & 7) : Math.atan2(pr.vy, pr.vx) - shotDir(sh.id);
      if (sh.q) rot = Math.round(rot / (Math.PI / 2)) * Math.PI / 2;
      if (kind === 'shield') for (let i = 3; i >= 1; i--) Pix.draw(c, sh.id, '', 0, x - pr.vx * 0.03 * i, y - pr.vy * 0.03 * i, 0.36 - i * 0.09, false, rot - 14 * 0.03 * i); // three fading ghost copies
      Pix.draw(c, sh.id, '', At.frameAt(sh.id, t + pr.id * 0.13), x, y, 1, false, rot);
      return;
    }
    if (CRESCENT[kind]) { Pix.put(c, crescentSprite(Math.max(4, Math.round((pr.r || 14) / 2)), col, Math.round(Math.atan2(pr.vy, pr.vx) / U.TAU * 32) & 31), x, y); return; }
    if (DIAMOND[kind]) { Pix.put(c, diamondSprite(Math.max(2, Math.round(pr.r / 2)), col, Math.round(Math.atan2(pr.vy, pr.vx) / U.TAU * 32) & 31, foe), x, y); return; }
    Pix.put(c, orbOf(pr, foe, col), x, y);
  }
  function drawProjectiles(c, view, t, pass) {
    const ps = view.projs; if (!ps.length) return;
    const FX = ED.FX;
    if (pass === 0) { let n = 0; for (const pr of ps) { if (n++ >= 40) break; const foe = pr.team === 1; R.light(pr.x, pr.y - 6, (foe ? 46 : 40) + pr.r * 2.5, HALO[pr.kind] || FX.projColor(pr.kind), foe ? 0.8 : 0.7); } return; }
    if (pass === 1) { // halos (additive): sprite shots a small one, orbs a larger one; foe bullets glow hotter
      for (const pr of ps) {
        const foe = pr.team === 1, kind = pr.kind, y = pr.y - 6;
        if (SOLID[kind]) R.glow(c, pr.x, y, foe ? 15 : 10, HALO[kind] || (foe ? '#ff5a3a' : FX.projColor(kind)), foe ? 0.5 : 0.3);
        else R.glow(c, pr.x, y, pr.r * 2.2 + 7, FX.projColor(kind), foe ? 0.7 : 0.5);
      }
      return;
    }
    for (const pr of ps) shotTrail(pr, t, pr.kind, FX.projColor(pr.kind));
    Pix.flush(c);
    for (const pr of ps) shotBody(c, pr, t, pr.kind, pr.team === 1, FX.projColor(pr.kind));
  }

  // ---------------- ambient motes ----------------
  const motes = []; let moteKey = '';
  function drawMotes(c, view, room, biome, t, dt, pass) {
    const pt = biome.particle; if (!pt) return;
    const kind = pt.kind, lit = kind === 'dust' || kind === 'snow';
    if (pass !== (lit ? 0 : 1)) return; // lit kinds draw before the lighting multiply, glowing kinds after it
    const key = room.stratum + ':' + room.seed, rw = room.w * T, rh = room.h * T;
    if (key !== moteKey) {
      moteKey = key; motes.length = 0;
      const n = Math.round(22 + (pt.rate || 8) * 3.5), hot = ED.Tiles.dynamics(room).filter(d => d.k === 'hz');
      for (let i = 0; i < n; i++) {
        const m = { x: Math.random() * rw, y: Math.random() * rh, ph: Math.random() * U.TAU, sz: 0.7 + Math.random() * 1.6, sp: 0.5 + Math.random(), age: Math.random(), col: Math.random() < 0.5 ? pt.color : (pt.color2 || pt.color) };
        if (kind === 'ember' && hot.length && Math.random() < 0.7) { const h = hot[(Math.random() * hot.length) | 0]; m.x = h.x + (Math.random() - 0.5) * 24; m.y = h.y + (Math.random() - 0.5) * 24; }
        motes.push(m);
      }
    }
    if (dt > 0) {
      for (const m of motes) {
        m.age += dt * 0.12 * m.sp;
        switch (kind) {
          case 'snow': m.y += (14 + m.sz * 9) * dt; m.x += Math.sin(t * 0.8 + m.ph) * 8 * dt - 3 * dt; break;
          case 'ember': m.y -= (10 + m.sz * 12) * dt; m.x += Math.sin(t * 1.6 + m.ph) * 9 * dt + 3 * dt; break;
          case 'bubble': m.y -= (6 + m.sz * 5) * dt; m.x += Math.sin(t * 1.2 + m.ph) * 6 * dt; break;
          case 'spore': m.y -= (3 + m.sz * 2) * dt; m.x += Math.sin(t * 0.7 + m.ph) * 7 * dt; break;
          default: m.x += Math.sin(t * 0.4 + m.ph) * 6 * dt + 2 * dt; m.y += Math.cos(t * 0.5 + m.ph * 1.3) * 5 * dt - 1.5 * dt;
        }
        if (m.y < -4) m.y = rh + 2; if (m.y > rh + 4) m.y = -2; if (m.x < -4) m.x = rw + 2; if (m.x > rw + 4) m.x = -2;
      }
    }
    for (const m of motes) {
      const tw = 0.5 + Math.sin(t * 2.2 * m.sp + m.ph) * 0.5;
      switch (kind) {
        case 'dust': c.globalAlpha = 0.18 + tw * 0.22; c.fillStyle = '#e8dcc0'; c.fillRect(m.x, m.y, m.sz * 0.8, m.sz * 0.8); break;
        case 'snow': c.globalAlpha = 0.5 + tw * 0.3; c.fillStyle = '#ffffff'; c.beginPath(); c.arc(m.x, m.y, m.sz * 0.7, 0, U.TAU); c.fill(); break;
        case 'ember': { const f = 1 - (m.age % 1) * 0.4; c.globalAlpha = (0.35 + tw * 0.5) * f; c.fillStyle = m.col; c.fillRect(m.x, m.y, m.sz, m.sz); break; }
        case 'bubble': c.globalAlpha = 0.3 + tw * 0.25; c.strokeStyle = m.col; c.lineWidth = 0.7; c.beginPath(); c.arc(m.x, m.y, m.sz * 1.4, 0, U.TAU); c.stroke(); break;
        default: c.globalAlpha = 0.25 + tw * 0.55; R.glow(c, m.x, m.y, 3 + m.sz * 2.2, m.col, 0.9);
      }
    }
    c.globalAlpha = 1;
  }

  // ---------------- lighting ----------------
  function rimAdd(x, y, r, col, k) { if (rimN < 40) { let L = rimSrc[rimN]; if (!L) L = rimSrc[rimN] = { x: 0, y: 0, r: 0, c: '', k: 0 }; L.x = x; L.y = y; L.r = r; L.c = col; L.k = k; rimN++; } }
  function drawLighting(c, view, room, biome, local, t, ix, iy) { // lights are added in buffer px: world position minus the buffer origin
    const P = biome.pal, ll = R.lightLevel, dv = R.lightDiv;
    const amb = R.ambient(biome, (1 - ll) * 0.1, view.pact > 0 ? Math.min(0.5, view.pact * 0.05) : 0);
    R.lightBegin(amb);
    const gm = ED.Tiles.glowmap(room, BQ);
    if (gm) { lctx.globalAlpha = 0.5; lctx.drawImage(gm, -ix / dv, -iy / dv, gm.width / gm.px / dv, gm.height / gm.px / dv); lctx.globalAlpha = 1; }
    rimN = 0;
    const src = rimAdd;
    // hero lanterns: warm core plus a wider tinted fill; radius shrinks by at most 15% and flickers as the lantern fails
    for (const p of view.players.values()) {
      if (p.dead) continue;
      const base = (p.stats ? p.stats.lightR : 175) * (p.downed ? 0.6 : 1) * (0.85 + 0.15 * ll);
      const fl = 1 + Math.sin(t * 7 + (p.slot || 0)) * 0.03 + Math.sin(t * 19 + (p.slot || 0) * 2) * 0.02 * (1 + (1 - ll) * 3);
      const col = U.mix('#ffc27a', ED.PLAYER_COLORS[p.slot] || '#ffc27a', 0.12);
      R.lightAdd(p.x - ix, p.y - 10 - iy, base * 1.15 * fl, U.mix(col, P.light, 0.2), 0.9);
      R.lightAdd(p.x - ix, p.y - 10 - iy, base * 0.52 * fl, '#ffd9a0', 0.45);
      src(p.x, p.y - 10, base * 0.9, col, 0.9);
    }
    // torches, fungus, lava and other fixed room lights
    for (const d of ED.Tiles.dynamics(room)) {
      let k;
      if (d.k === 'torch') k = 0.95 + Math.sin(t * 11 + d.x) * 0.06 + Math.sin(t * 17.3 + d.x * 2.1) * 0.05;
      else if (d.k === 'hz') k = 0.6 + Math.sin(t * 1.5 + d.x * 0.07 + d.y * 0.05) * 0.15;
      else k = 0.6 + Math.sin(t * 2 + d.x) * 0.1;
      if (d.k === 'hz' && biome.hazard === 'water') k *= 0.45;
      const r = d.r * (d.k === 'torch' ? 1.25 : 0.85);
      R.lightAdd(d.x - ix, d.y - iy, r, d.color, k);
      if (d.k === 'torch') src(d.x, d.y, r, d.color, k);
    }
    for (const e of view.enemies) {
      if (e.hp <= 0 || !(e.boss || e.elite)) continue;
      R.light(e.x, e.y - e.r, e.r * (e.boss ? 5 : 4), e.boss ? e.def.col.c : ED.AFFIXES[e.elite].color, e.boss ? 0.6 : 0.5);
    }
    for (let i = 0; i < nl; i++) {
      const L = lights[i];
      R.lightAdd(L.x - ix, L.y - iy, L.r, L.c, L.k);
      if (L.k * L.r >= 60) src(L.x, L.y, L.r, L.c, L.k);
    }
    if (AC.on() && R.actorFloor !== false) AC.floor(lctx, drawList, drawList.length, 1 / dv); // actors never fall below half their colour (before the vignette: the final darkening still applies)
    if (!R.posting) { lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1; lctx.drawImage(vignetteH.v, 0, 0, lightCv.width, lightCv.height); } // vignette (black, alpha) darkens the light buffer: same result as a full-screen overlay at buffer cost
    R.lightEnd(c);
  }

  // ---------------- world text and overhead info (names, bars, prompts) ----------------
  // With the pixel font (ED.Atlas.font) text is glyph blits at 2 world px per font px (1 art px = 2 world px; 4 only for the pop frames of big numbers); strings the font cannot spell
  // (non-Latin names) and the no-font case use outlined canvas text baked once per (string, colour, size).
  const LBL = 10; // nominal label height without the pixel font, world px
  let mctx = null;
  const fontK = (size) => ((size || LBL) >= 26 ? 4 : 2);
  const PF = (str) => ED.Atlas.covers(str);
  const PX = (str) => (/[\u2212\u2013\u2014]/.test(str) ? str.replace(/[\u2212\u2013\u2014]/g, '-') : str); // typographic minus / dashes -> the font's hyphen
  const fbPx = (size) => (ED.Atlas.font ? ED.Atlas.font.h * 2 : size || LBL) * 0.9; // canvas-font px of the fallback for a nominal label height
  // Outlined text baked once per (string, colour, size in px); sprite origin = text centre.
  function textSprite(str, color, fs) {
    const key = color + '|' + fs + '|' + str;
    let s = txtCache.get(key);
    if (s) return s;
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    const font = '800 ' + fs.toFixed(2) + 'px "Alegreya Sans", sans-serif';
    mctx.font = font;
    const hw = mctx.measureText(str).width / 2 + fs * 0.45, hh = fs * 0.85;
    s = bake(-hw, -hh, hw, hh, false, (g) => { g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = Math.max(2, fs * 0.3); g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(str, 0, 0); g.fillStyle = color; g.fillText(str, 0, 0); });
    if (txtCache.size > 200) dropText();
    txtCache.set(key, s);
    return s;
  }
  R.labelH = (size) => (ED.Atlas.font ? ED.Atlas.font.h * fontK(size) : size || LBL);
  R.labelW = (str, size) => {
    if (PF(PX(str))) return ED.Atlas.textW(PX(str), fontK(size));
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    mctx.font = '800 ' + fbPx(size).toFixed(2) + 'px "Alegreya Sans", sans-serif';
    return Math.ceil(mctx.measureText(str).width + fbPx(size) * 0.9);
  };
  // Label centred at world (x, y) in the current (integer-translated) transform; size = nominal height in world px.
  R.label = (c, str, x, y, color, size, alpha) => {
    const ps = PX(str);
    if (PF(ps) && ED.Atlas.text(c, ps, Math.round(x), Math.round(y), color, fontK(size), 'c', alpha)) return;
    const ts = textSprite(str, color, fbPx(size));
    if (alpha !== undefined && alpha !== 1) { const ga = c.globalAlpha; c.globalAlpha = ga * alpha; blit(c, ts, x, y); c.globalAlpha = ga; } else blit(c, ts, x, y);
  };
  // Floating damage number baked once per (string, colour, size in half units, crit); R.drawNum scales it to the animated size. Sprite origin = text centre, .fs = baked font size.
  R.numSprite = (str, color, size, crit, ol) => {
    const bs = Math.round(size * 2) / 2, key = bs + (crit ? 'c' : 'n') + (ol || '') + color + str;
    let s = numC.get(key);
    if (s) return s;
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    const font = '800 ' + bs + 'px "Alegreya Sans", system-ui, sans-serif'; mctx.font = font;
    const hw = mctx.measureText(str).width / 2 + bs * 0.4, hh = bs * 0.75;
    s = bake(-hw, -hh, hw, hh, false, (g) => {
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = crit ? 3 : 2; g.strokeStyle = crit ? 'rgba(40,10,0,0.95)' : 'rgba(0,0,0,0.85)'; g.strokeText(str, 0, 0);
      if (ol) { g.lineWidth = 1.5; g.strokeStyle = ol; g.strokeText(str, 0, 0); } // element rim between the dark outline and the fill
      g.fillStyle = color; g.fillText(str, 0, 0);
      if (crit) { g.fillStyle = 'rgba(255,255,255,0.4)'; g.save(); g.beginPath(); g.rect(-bs * 3, -bs * 0.6, bs * 6, bs * 0.55); g.clip(); g.fillText(str, 0, 0); g.restore(); }
    });
    s.fs = bs;
    if (numC.size > 160) dropText();
    numC.set(key, s);
    return s;
  };
  // One floating text t (FX.texts entry) at its animated size fs and alpha a: pixel-font glyphs, else the baked number scaled.
  R.drawNum = (c, t, fs, a) => {
    if (PF(t.s)) { ED.Atlas.text(c, t.s, Math.round(t.x), Math.round(t.y), t.color, fontK(fs), 'c', a); return; }
    const sp = R.numSprite(t.s, t.color, t.size, t.crit, t.ol), q = fs / sp.fs;
    c.globalAlpha = a; c.drawImage(sp.cv, Math.round(t.x + sp.x * q), Math.round(t.y + sp.y * q), sp.w * q, sp.h * q);
  };
  // HP bar (frame, dark base, fill, sheen) baked per colour / width / fill px / height; sprite origin = bar left-top.
  function barSprite(bc, w, fw, h) {
    return sprite('hb' + bc + '|' + w + '|' + fw + '|' + h, -1, -1, w + 1, h + 1, false, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(-1, -1, w + 2, h + 2);
      g.fillStyle = U.shade(bc, -0.35); g.fillRect(0, 0, w, h);
      g.fillStyle = bc; g.fillRect(0, 0, fw, h);
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(0, 0, fw, Math.max(1, Math.floor(h * 0.4)));
    });
  }
  // Hero labels placed this frame (x, y, half-width), so stacked heroes never print their names over each other.
  const lbl = new Float32Array(24); let lblN = 0;
  // Returns y for a label of width w and height lh centred near (x, y): steps up by lh until it clears every placed label, then registers it.
  function placeLabel(x, y, w, lh) {
    for (let k = 0; k < 6; k++) {
      let hit = false;
      for (let i = 0; i < lblN * 3; i += 3) if (Math.abs(lbl[i] - x) < lbl[i + 2] + w / 2 && Math.abs(lbl[i + 1] - y) < lh * 0.95) { hit = true; break; }
      if (!hit) break;
      y -= lh;
    }
    if (lblN < 8) { lbl[lblN * 3] = x; lbl[lblN * 3 + 1] = y; lbl[lblN * 3 + 2] = w / 2; lblN++; }
    return y;
  }
  function drawOverheads(c, view, local, t) {
    if (view.room) drawDoorPreviews(c, view, view.room, t);
    // enemy bars and elite labels: one blit each on the buffer pixel grid
    const bh = R.scale >= 2 ? 2 : 3, lhh = R.labelH();
    const lp = view.players.get(local), cuePips = ED.HUD.wantsPips(lp), cueParry = !!(lp && lp.stats && lp.stats.parry);
    if (cuePips || cueParry) for (const e of view.enemies) { // class route cues of the local hero: ailment pips under the bar (Brand, Open Veins, Contagion, Gangrene), the Parry rim on a foe in the last 0.3 s of a wind-up
      if (e.hp <= 0 || e.boss || e.burrowed) continue;
      if (cuePips && e.ailN) ED.HUD.foePips(c, e, Math.round(e.x - (e.elite ? 15 : 9)), Math.round(e.y - e.r * 2.6 - (e.def.fly ? 14 : 4)) + bh + 2);
      if (cueParry && (e.st === 'windup' || e.st === 'aim' || e.st === 'cast') && e.t > 0 && e.t <= ED.CONST.PARRY_WIN) { c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 1; c.beginPath(); c.ellipse(Math.round(e.x), Math.round(e.y), e.r + 2, (e.r + 2) * 0.5, 0, 0, U.TAU); c.stroke(); }
    }
    for (const e of view.enemies) {
      if (e.hp <= 0 || e.boss || e.burrowed) continue;
      const frac = e.hp / e.maxHp;
      if (frac >= 0.999 && !e.elite) continue;
      const an = AC.on() ? AC.anchor(e) : null; // bar 6 px over the top of the sprite
      const w = e.elite ? 30 : 18, y = an ? Math.round(e.y + an.top) - 6 : Math.round(e.y - e.r * 2.6 - (e.def.fly ? 14 : 4)), af = e.elite ? ED.AFFIXES[e.elite] : null, bx = Math.round(e.x - w / 2);
      blit(c, barSprite(af ? af.color : '#e2513f', w, Math.round(U.clamp(frac, 0, 1) * w), bh), bx, y);
      if (e.ward > 0) { c.fillStyle = '#7fc8ff'; c.fillRect(bx, y - 1 - bh, Math.max(1, Math.round(w * (e.ward / (e.wardMax || 1)))), Math.max(1, bh - 1)); }
      if (af) R.label(c, af.name + ' ' + e.def.name, e.x, y - 2 - lhh / 2 - (e.ward > 0 ? bh : 0), af.color);
    }
    for (const e of view.enemies) if (e.hp > 0 && !e.burrowed) drawMarks(c, e, t);
    // hero names (the local hero first; a name that would overlap another steps up) and revive rings with a DOWN / REVIVE label
    const multi = view.players.size > 1, lh = lhh * 1.1;
    lblN = 0;
    for (let pass = 0; pass < 2; pass++) for (const p of view.players.values()) {
      if ((p.pid === local) !== (pass === 0)) continue;
      const col = ED.PLAYER_COLORS[p.slot] || '#fff', px = Math.round(p.x), py = Math.round(p.y);
      if (multi && !p.dead) {
        const ha = AC.on() && !p.downed ? AC.anchor(p) : null, dy = ha ? Math.round(ha.top) + 38 : 0; // name and bar ride the top of the sprite (the procedural hero is 38 px tall)
        R.label(c, p.name, px, placeLabel(px, py - 47 + dy, R.labelW(p.name), lh), col);
        if (p.pid !== local && !p.downed) { const fr = p.hp / p.maxHp; c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(px - 11, py - 39 + dy, 22, 3); c.fillStyle = fr > 0.35 ? '#86d38f' : '#e2513f'; c.fillRect(px - 10, py - 38 + dy, Math.round(20 * fr), 1); }
      }
      if (p.downed) {
        c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.beginPath(); c.arc(px, py - 8, 20, 0, U.TAU); c.stroke();
        c.strokeStyle = '#86d38f'; c.beginPath(); c.arc(px, py - 8, 20, -Math.PI / 2, -Math.PI / 2 + U.TAU * (p.revive || 0)); c.stroke();
        const str = p.pid === local ? 'DOWN' : 'REVIVE';
        R.label(c, str, px, placeLabel(px, py - (multi ? 47 + lh : 34), R.labelW(str), lh), '#ff8a7a'); // stacked over the name in co-op
      }
    }
    // nearest sign within reach (one at a time); the HUD draws its text in screen space with the current key bindings
    const me = view.players.get(local);
    let sign = null, sd = 90 * 90;
    if (me) for (const p of view.props) { if (p.kind === 'sign') { const d = U.dist2(p.x, p.y, me.x, me.y); if (d < sd) { sd = d; sign = p; } } }
    R.sign = sign;
  }
})(globalThis.ED || (globalThis.ED = {}));
