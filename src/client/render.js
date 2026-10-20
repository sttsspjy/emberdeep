// World renderer: camera, cached room art, coloured light accumulation, zones, props, entities, projectiles and the
// hand-off to the WebGL post pass. The world is drawn to an offscreen canvas (R.wctx) when post is active, else straight
// to the visible canvas (R.ctx); either way R.ctx ends the frame as the layer the HUD draws on.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, Sp = ED.Sprites;
  const R = ED.Render = { cam: { x: 0, y: 0 }, scale: 2, W: 0, H: 0, dpr: 1, quality: 'high', lightLevel: 1, posting: false, stats: { n: 0, world: 0, post: 0 } };
  const glowCache = {}, lightCache = {}, trailCache = {};
  let lightCv, lctx, vignette, shadowCv, rimCv, rimCtx, lightN = 0;
  const lights = [], rimSrc = [], glowQ = [], rimOut = { dx: 0, dy: 0, col: '', s: 0 };
  let rimN = 0; // live entries of rimSrc (filled by last frame's lighting pass)
  let nl = 0, ng = 0, stN = 0, shDX = 0, shDY = 0; // lights/glows queued this frame (stN: status lights); shadow skew away from the nearest light

  R.init = (canvas) => {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d', { alpha: true });
    R.world = document.createElement('canvas');
    R.wctx = R.world.getContext('2d', { alpha: false });
    lightCv = document.createElement('canvas');
    lctx = lightCv.getContext('2d');
    rimCv = document.createElement('canvas'); rimCtx = rimCv.getContext('2d');
    shadowCv = document.createElement('canvas'); shadowCv.width = 64; shadowCv.height = 32;
    const sg = shadowCv.getContext('2d'); sg.translate(32, 16); sg.scale(1, 0.5);
    const sr = sg.createRadialGradient(0, 0, 0, 0, 0, 32);
    sr.addColorStop(0, 'rgba(0,0,0,0.95)'); sr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); sr.addColorStop(0.8, 'rgba(0,0,0,0.14)'); sr.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = sr; sg.fillRect(-32, -32, 64, 64);
    Sp.shadow = R.shadow; // every sprite and prop shadow becomes the cached soft blob
    if (ED.Post) ED.Post.init(canvas);
    window.addEventListener('resize', R.resize);
    R.resize();
  };

  R.setQuality = (q) => { R.quality = q; R.resize(); };
  R.usePost = () => !!(ED.Post && ED.Post.ready && R.quality !== 'low');

  R.resize = () => {
    const cssW = window.innerWidth, cssH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, R.quality === 'low' ? 1 : 1.5);
    while (cssW * cssH * dpr * dpr > 2.8e6 && dpr > 0.6) dpr -= 0.1;
    R.dpr = dpr;
    R.canvas.width = Math.round(cssW * dpr); R.canvas.height = Math.round(cssH * dpr);
    R.W = R.canvas.width; R.H = R.canvas.height;
    R.world.width = R.W; R.world.height = R.H;
    R.scale = Math.min(R.W / ED.CONST.VIEW_W, R.H / ED.CONST.VIEW_H);
    const div = R.quality === 'low' ? 5 : 3;
    lightCv.width = Math.ceil(R.W / div); lightCv.height = Math.ceil(R.H / div);
    R.lightDiv = div;
    vignette = document.createElement('canvas'); vignette.width = 256; vignette.height = 256;
    const v = vignette.getContext('2d'), vg = v.createRadialGradient(128, 128, 60, 128, 128, 182);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = vg; v.fillRect(0, 0, 256, 256);
    if (ED.Post) { ED.Post.setVisible(R.quality !== 'low'); ED.Post.resize(R.W, R.H); }
    ED.Tiles.clear();
  };

  R.glowSprite = (color) => {
    if (glowCache[color]) return glowCache[color];
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, U.rgba(color, 0.9)); gr.addColorStop(0.35, U.rgba(color, 0.35)); gr.addColorStop(1, U.rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache[color] = cv;
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
  R.shadow = (c, r, a = 0.35) => {
    const w = r * 2.7, h = r * 1.25, y = r * 0.6;
    c.globalAlpha = Math.min(1, a * 1.9);
    c.drawImage(shadowCv, -w / 2 + shDX * r, y - h / 2 + shDY * r, w, h);
    c.globalAlpha = Math.min(1, a * 1.1);
    c.drawImage(shadowCv, -w * 0.3 + shDX * r * 0.4, y - h * 0.3 + shDY * r * 0.4, w * 0.6, h * 0.6);
    c.globalAlpha = 1;
  };

  R.toScreen = (x, y) => ({ x: (x - R.cam.x) * R.scale + R.W / 2, y: (y - R.cam.y) * R.scale + R.H / 2 });
  R.toWorld = (sx, sy) => ({ x: (sx - R.W / 2) / R.scale + R.cam.x, y: (sy - R.H / 2) / R.scale + R.cam.y });

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

  // Target context for this frame's world drawing: the offscreen canvas when post is active, else the visible one.
  R.beginWorld = () => {
    R.posting = R.usePost();
    if (R.posting && (R.world.width !== R.W || R.world.height !== R.H)) { R.world.width = R.W; R.world.height = R.H; }
    return R.posting ? R.wctx : R.ctx;
  };
  // Hands the finished world to post; the visible canvas is left transparent for the HUD (or holds the world on fallback).
  R.endWorld = (o) => {
    if (!R.posting) return;
    const c = R.ctx, t0 = performance.now(); c.setTransform(1, 0, 0, 1, 0, 0);
    if (ED.Post.render(R.world, o)) c.clearRect(0, 0, R.W, R.H);
    else { c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.drawImage(R.world, 0, 0); }
    R.stats.post += performance.now() - t0;
    R.posting = false;
  };
  // Post parameters from the FX state (chromatic aberration, flashes) and the lantern.
  R.postOpts = (biome, t, extra) => {
    const F = ED.FX;
    return Object.assign({ biome, t, aberr: F.aberr || 0, flash: F.kick > 0.01 ? [1, 0.92, 0.8, F.kick * 0.22] : null, lightLevel: 0.6 + 0.4 * R.lightLevel }, extra); // post-process darkening (saturation, vignette) stays mild
  };

  // ---------------- light buffer (device-pixel space, reused by the camp) ----------------
  function lightSprite(color) {
    let s = lightCache[color]; if (s) return s;
    if (++lightN > 90) { for (const k in lightCache) delete lightCache[k]; lightN = 0; }
    s = lightCache[color] = document.createElement('canvas'); s.width = s.height = 96;
    const g = s.getContext('2d'), gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, U.rgba(color, 0.95)); gr.addColorStop(0.16, U.rgba(color, 0.74)); gr.addColorStop(0.4, U.rgba(color, 0.42));
    gr.addColorStop(0.66, U.rgba(color, 0.17)); gr.addColorStop(0.86, U.rgba(color, 0.05)); gr.addColorStop(1, U.rgba(color, 0)); // long soft shoulder: pools blend instead of ending in a hard edge
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    return s;
  }
  R.lightBegin = (rgb) => {
    lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1;
    lctx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
    lctx.fillRect(0, 0, lightCv.width, lightCv.height);
    lctx.globalCompositeOperation = 'lighter';
  };
  // Adds a coloured pool at device pixel (sx, sy) with radius rr (px).
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
    c.drawImage(lightCv, 0, 0, R.W, R.H);
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
    const t0 = performance.now(), c = R.beginWorld(), room = view.room, F = ED.FX;
    const biome = ED.biomeFor(view.stratum || 1), P = biome.pal;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = P.void; c.fillRect(0, 0, R.W, R.H);
    nl = 0; ng = 0; stN = 0; R.local = local;
    R.simT = view.renderT || view.time || 0; // sim-time clock for hazards drawn from sim state: interpolated host time on clients, world time otherwise
    if (!room) { R.endWorld(R.postOpts(biome, t)); return; }
    let sx = 0, sy = 0;
    if (F.shake > 0) { const a = F.shake * R.scale * 0.55; sx = (Math.sin(t * 71) + Math.sin(t * 43 + 1.7) * 0.6) * a * 0.62; sy = (Math.cos(t * 67) + Math.sin(t * 51 + 0.4) * 0.6) * a * 0.62; }
    const ox = Math.round(-R.cam.x * R.scale + R.W / 2 + sx), oy = Math.round(-R.cam.y * R.scale + R.H / 2 + sy);
    const low = R.quality === 'low';
    c.setTransform(R.scale, 0, 0, R.scale, ox, oy);
    // ---- lit pass ----
    const art = ED.Tiles.get(room, R.scale);
    c.drawImage(art, 0, 0, art.width / R.scale, art.height / R.scale);
    drawRoomDynamics(c, view, room, biome, t, 0);
    drawDoors(c, view, room, P, t);
    drawZones(c, view, t, 0);
    drawPickups(c, view, t, 0);
    drawProps(c, view, local, t);
    let dn = 0;
    for (const p of view.players.values()) qDraw(dn++, p.y, 0, p);
    for (const e of view.enemies) if (e.hp > 0) qDraw(dn++, e.y, 1, e);
    for (const a of view.allies) qDraw(dn++, a.y, 2, a);
    drawList.length = dn; drawList.sort(byY);
    for (const it of drawList) {
      const o = it.o, rim = low ? null : rimLight(o.x, o.y, it.k === 0 ? 16 : 0);
      if (rim) { shDX = -rim.dx * 0.28; shDY = -rim.dy * 0.12; } else { shDX = 0; shDY = 0; }
      if (it.k === 0 && rim && !o.dead) drawHeroRim(c, o, view, t, ox, oy, rim);
      else {
        c.save(); c.translate(o.x, o.y);
        if (it.k === 0) { drawCompanions(c, o, view, t, true); Sp.hero(c, o, t, F.anim[o.pid]); drawCompanions(c, o, view, t, false); }
        else if (it.k === 1) { const X = F.xform(o); if (X) { c.save(); c.translate(X.dx, X.dy); c.rotate(X.rot); c.scale(X.sx, X.sy); Sp.enemy(c, o, t); c.restore(); } else Sp.enemy(c, o, t); if (rim && rim.s > 0.35) R.glowOnce(c, 0, -o.r * 1.2, o.r * 1.5, rim.col, 0.14 * rim.s, rim.dx * o.r * 0.55, rim.dy * o.r * 0.4); drawStatus(c, o, t); }
        else Sp.minion(c, o, t);
        c.restore();
      }
      if (it.k === 0) { c.save(); c.translate(o.x, o.y); drawHeroFx(c, o, t); c.restore(); }
      if (it.k === 0 && !o.dead && !low) F.dashTrail && F.dashTrail(o, t);
    }
    shDX = shDY = 0;
    drawProjectiles(c, view, t, 0);
    F.drawWorld(c);
    if (!low) drawMotes(c, view, room, biome, t, dt, 0);
    // ---- lighting ----
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawLighting(c, view, room, biome, local, t, ox, oy);
    if (!R.posting) c.drawImage(vignette, 0, 0, R.W, R.H);
    // ---- emissive pass (unlit, additive: bloom catches it) ----
    c.setTransform(R.scale, 0, 0, R.scale, ox, oy);
    c.globalCompositeOperation = 'lighter';
    const emis = ED.Tiles.emissive(room, R.scale);
    if (emis) { c.globalAlpha = 0.82 + Math.sin(t * 2.1) * 0.1 + Math.sin(t * 5.3) * 0.05; c.drawImage(emis, 0, 0, emis.width / emis.px, emis.height / emis.px); c.globalAlpha = 1; }
    drawRoomDynamics(c, view, room, biome, t, 1);
    drawPickups(c, view, t, 1);
    drawZones(c, view, t, 1);
    drawProjectiles(c, view, t, 1);
    if (!low) drawMotes(c, view, room, biome, t, dt, 1);
    const eyeA = 0.2 + P.darkness * 0.5;
    for (const e of view.enemies) if (e.hp > 0 && !e.burrowed) {
      R.glow(c, e.x, e.y - e.r * (e.def.fly ? 2.2 : 1.7), 5 + e.r * 0.5, e.def.col.c, eyeA);
      const wp = F.windupP(e); if (wp > 0.05) R.glow(c, e.x, e.y - e.r * 1.2, e.r * (1.5 + wp), wp > 0.8 ? '#ffd0a0' : '#ff5a3a', 0.12 + 0.5 * wp * wp);
    }
    for (let i = 0; i < ng; i++) { const g = glowQ[i]; R.glow(c, g.x, g.y, g.r, g.c, g.a); }
    F.drawGlow(c, t);
    c.globalCompositeOperation = 'source-over';
    // ---- overlays above lighting ----
    drawOverheads(c, view, local, t);
    F.drawTexts(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (R.syncWorld) c.getImageData(0, 0, 1, 1); // benchmarking: force the 2D raster to finish
    R.stats.world += performance.now() - t0; R.stats.n++;
    R.endWorld(R.postOpts(biome, t, view.pact > 0 ? { vig: 0.42 + Math.min(0.2, view.pact * 0.02) } : null));
  };

  // Y-sorted entity list: items are pooled by index, so a frame allocates nothing.
  const drawList = [], drawPool = [], byY = (a, b) => a.y - b.y;
  const qDraw = (i, y, k, o) => { let it = drawPool[i]; if (!it) it = drawPool[i] = { y: 0, k: 0, o: null }; it.y = y; it.k = k; it.o = o; drawList[i] = it; };

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

  // Heroes render into a scratch canvas so a lit-side rim can be composited with 'source-atop' onto the sprite only.
  function drawHeroRim(c, p, view, t, ox, oy, rim) {
    const s = R.scale, sw = Math.ceil(160 * s), sh = Math.ceil(140 * s);
    if (rimCv.width !== sw || rimCv.height !== sh) { rimCv.width = sw; rimCv.height = sh; }
    const dx = p.x * s + ox, dy = p.y * s + oy, ix = Math.floor(dx), iy = Math.floor(dy);
    const cx = Math.round(80 * s), cy = Math.round(100 * s), rc = rimCtx;
    rc.setTransform(1, 0, 0, 1, 0, 0); rc.globalCompositeOperation = 'source-over'; rc.globalAlpha = 1; rc.clearRect(0, 0, sw, sh);
    rc.setTransform(s, 0, 0, s, cx + (dx - ix), cy + (dy - iy));
    drawCompanions(rc, p, view, t, true); Sp.hero(rc, p, t, ED.FX.anim[p.pid]); drawCompanions(rc, p, view, t, false);
    rc.setTransform(1, 0, 0, 1, 0, 0); rc.globalCompositeOperation = 'source-atop';
    const mx = cx, my = cy - 16 * s, g = rc.createLinearGradient(mx + rim.dx * 13 * s, my + rim.dy * 13 * s, mx - rim.dx * 3 * s, my - rim.dy * 3 * s);
    g.addColorStop(0, U.rgba(rim.col, 0.62 * rim.s)); g.addColorStop(0.55, U.rgba(rim.col, 0.14 * rim.s)); g.addColorStop(1, U.rgba(rim.col, 0));
    rc.fillStyle = g; rc.fillRect(0, 0, sw, sh);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(rimCv, ix - cx, iy - cy); c.restore();
  }

  // ---------------- room details ----------------
  function drawRoomDynamics(c, view, room, biome, t, pass) {
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
      const pulse = 0.55 + Math.sin(t * 4) * 0.2;
      c.fillStyle = 'rgba(14,8,6,0.92)'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      const bar = (a, b, c2, d2) => {
        c.strokeStyle = '#1a1412'; c.lineWidth = 4.2; c.beginPath(); c.moveTo(a, b); c.lineTo(c2, d2); c.stroke();
        c.strokeStyle = '#6a5a50'; c.lineWidth = 2.4; c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(a - 0.8, b); c.lineTo(c2 - 0.8, d2); c.stroke();
      };
      if (d === 'n' || d === 's') { for (let x = x0 + 8; x < x1; x += 12) bar(x, y0, x, y1); }
      else { for (let y = y0 + 8; y < y1; y += 12) bar(x0, y, x1, y); }
      R.light((x0 + x1) / 2, (y0 + y1) / 2, 70, P.accent, 0.35 * pulse);
      R.emit((x0 + x1) / 2, (y0 + y1) / 2, 42, P.accent, 0.5 * pulse);
    }
  }

  // ---------------- zones ----------------
  // pass 0: ground decals and fills (lit by the scene); pass 1: unlit emissive edges, flames and beams.
  const zfade = (z) => Math.min(1, (z.dur - z.t) * 2, z.t * 5);
  const RED = '#ff3a22', GOLD = '#ffc94a';
  function drawZones(c, view, t, pass) {
    for (const z of view.zones) {
      const k = z.dur ? U.clamp(z.t / z.dur, 0, 1) : 0;
      switch (z.kind) {
        case 'spawn': {
          const col = z.elite ? '#ffb13a' : '#b8a0ff';
          if (pass === 0) { c.fillStyle = 'rgba(10,4,20,0.35)'; c.beginPath(); c.ellipse(z.x, z.y, (z.r || 14) * 1.1, (z.r || 14) * 0.6, 0, 0, U.TAU); c.fill(); R.light(z.x, z.y, (z.r || 16) * 2.4, col, 0.55); break; }
          c.save(); c.translate(z.x, z.y);
          c.strokeStyle = U.rgba(col, 0.9); c.lineWidth = 1.8;
          for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0, 0, (z.r || 14) * (0.4 + k * 0.8), t * 4 + i * 2.1, t * 4 + i * 2.1 + 1.4); c.stroke(); }
          R.glow(c, 0, 0, 28 * (0.4 + k), col, 0.7);
          c.restore();
          break;
        }
        case 'tele': {
          const fr = z.team === 0, col = fr ? GOLD : RED, hi = fr ? '#fff0b0' : '#ffb080';
          if (pass === 0) {
            if (z.lob) { const px = U.lerp(z.lob[0], z.x, k), py = U.lerp(z.lob[1], z.y, k) - Math.sin(k * Math.PI) * 70; R.light(px, py, 54, '#ff8a2a', 0.8); c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(U.lerp(z.lob[0], z.x, k), U.lerp(z.lob[1], z.y, k), 5, 2.5, 0, 0, U.TAU); c.fill(); }
            c.fillStyle = U.rgba(col, fr ? 0.1 : 0.15); c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.fill();
            c.fillStyle = U.rgba(col, fr ? 0.2 : 0.3); c.beginPath(); c.arc(z.x, z.y, Math.max(0.1, z.r * k), 0, U.TAU); c.fill();
            R.light(z.x, z.y, z.r * 1.6, col, (fr ? 0.28 : 0.42) * (0.6 + k * 0.6));
            break;
          }
          if (z.lob) {
            const px = U.lerp(z.lob[0], z.x, k), py = U.lerp(z.lob[1], z.y, k) - Math.sin(k * Math.PI) * 70;
            R.glow(c, px, py, 20, '#ff8a2a', 0.95); c.fillStyle = '#ffe0a0'; c.beginPath(); c.arc(px, py, 4.5, 0, U.TAU); c.fill();
          }
          const flash = k > 0.82 ? 0.5 + Math.sin(t * 40) * 0.5 : 0;
          c.strokeStyle = U.rgba(col, 0.22); c.lineWidth = 6; c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.stroke();
          c.strokeStyle = U.rgba(hi, 0.9); c.lineWidth = 1.6; c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.stroke();
          c.strokeStyle = U.rgba(col, 0.55 + flash * 0.4); c.lineWidth = 1.6; c.beginPath(); c.arc(z.x, z.y, Math.max(0.1, z.r * k), 0, U.TAU); c.stroke();
          c.strokeStyle = U.rgba(hi, 0.7); c.lineWidth = 1.2;
          for (let i = 0; i < 10; i++) { const a = i * U.TAU / 10 + t * 0.6; c.beginPath(); c.moveTo(z.x + Math.cos(a) * (z.r - 5), z.y + Math.sin(a) * (z.r - 5)); c.lineTo(z.x + Math.cos(a) * (z.r + 1), z.y + Math.sin(a) * (z.r + 1)); c.stroke(); }
          if (flash) { c.fillStyle = U.rgba(col, 0.18 * flash); c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.fill(); }
          break;
        }
        case 'bomb': {
          if (pass === 0) {
            c.fillStyle = '#26262b'; c.beginPath(); c.arc(z.x, z.y - 4, 6, 0, U.TAU); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.arc(z.x - 2, z.y - 6, 2, 0, U.TAU); c.fill();
            R.light(z.x, z.y, z.r * 1.2, GOLD, 0.3);
          } else {
            const fl = Math.floor(t * 12) % 2; c.fillStyle = fl ? '#ffd36b' : '#ff6a2a'; c.beginPath(); c.arc(z.x + 4, z.y - 11, 2.2, 0, U.TAU); c.fill();
            R.glow(c, z.x + 4, z.y - 11, 10, '#ffb347', 0.8);
            c.strokeStyle = U.rgba(GOLD, 0.7); c.lineWidth = 1.2; c.beginPath(); c.arc(z.x, z.y, Math.max(0.1, z.r * k), 0, U.TAU); c.stroke();
            c.strokeStyle = U.rgba(GOLD, 0.25); c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.stroke();
          }
          break;
        }
        case 'decoy': {
          if (pass === 0) {
            c.save(); c.globalAlpha = 0.5 + Math.sin(t * 20) * 0.2; c.translate(z.x, z.y);
            c.fillStyle = '#2a1f44'; c.beginPath(); c.ellipse(0, -12, 7, 12, 0, 0, U.TAU); c.fill(); c.restore();
            R.light(z.x, z.y - 10, 60, '#b78cff', 0.5);
          } else R.glow(c, z.x, z.y - 12, 24 + k * 20, '#b78cff', 0.7);
          break;
        }
        case 'teleLine': {
          if (pass === 0) {
            c.save(); c.translate(z.x, z.y); c.rotate(z.a);
            c.fillStyle = 'rgba(255,58,34,0.15)'; c.fillRect(0, -z.w / 2, z.len, z.w);
            c.fillStyle = 'rgba(255,58,34,0.32)'; c.fillRect(0, -z.w / 2, z.len * k, z.w);
            c.restore();
            R.light(z.x + Math.cos(z.a) * z.len * 0.5, z.y + Math.sin(z.a) * z.len * 0.5, Math.max(z.len * 0.55, 40), RED, 0.32);
          } else {
            c.save(); c.translate(z.x, z.y); c.rotate(z.a);
            c.strokeStyle = 'rgba(255,58,34,0.25)'; c.lineWidth = 5; c.strokeRect(0, -z.w / 2, z.len, z.w);
            c.strokeStyle = 'rgba(255,170,120,0.9)'; c.lineWidth = 1.4; c.strokeRect(0, -z.w / 2, z.len, z.w);
            c.fillStyle = 'rgba(255,150,100,0.85)'; c.fillRect(z.len * k - 1, -z.w / 2, 2, z.w);
            c.strokeStyle = 'rgba(255,150,100,0.6)'; c.lineWidth = 1.2;
            for (let x = (t * 50) % 24; x < z.len * k; x += 24) { c.beginPath(); c.moveTo(x - 4, -3); c.lineTo(x, 0); c.lineTo(x - 4, 3); c.stroke(); }
            c.restore();
          }
          break;
        }
        case 'teleCone': {
          if (pass === 0) {
            c.save(); c.translate(z.x, z.y);
            c.fillStyle = 'rgba(255,58,34,0.16)'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, z.r, z.a - z.arc / 2, z.a + z.arc / 2); c.closePath(); c.fill();
            c.fillStyle = 'rgba(255,58,34,0.34)'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, Math.max(0.1, z.r * k), z.a - z.arc / 2, z.a + z.arc / 2); c.closePath(); c.fill();
            c.restore();
            R.light(z.x + Math.cos(z.a) * z.r * 0.5, z.y + Math.sin(z.a) * z.r * 0.5, z.r * 0.9, RED, 0.3);
          } else {
            c.save(); c.translate(z.x, z.y);
            c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, z.r, z.a - z.arc / 2, z.a + z.arc / 2); c.closePath();
            c.strokeStyle = 'rgba(255,58,34,0.25)'; c.lineWidth = 5; c.stroke();
            c.strokeStyle = 'rgba(255,170,120,0.9)'; c.lineWidth = 1.4; c.stroke();
            c.strokeStyle = 'rgba(255,150,100,0.7)'; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, Math.max(0.1, z.r * k), z.a - z.arc / 2, z.a + z.arc / 2); c.stroke();
            c.restore();
          }
          break;
        }
        case 'laser': {
          const active = z.t > (z.warm || 0);
          if (pass === 0) { if (active) for (let i = 0; i < 4; i++) R.light(z.x + Math.cos(z.a) * z.len * (i + 0.5) / 4, z.y + Math.sin(z.a) * z.len * (i + 0.5) / 4, 90, '#ff5ae0', 0.75); break; }
          c.save(); c.translate(z.x, z.y); c.rotate(z.a);
          if (active) {
            const fl = 0.85 + Math.sin(t * 60) * 0.15;
            c.fillStyle = 'rgba(255,60,210,0.22)'; c.fillRect(0, -z.w * 1.6, z.len, z.w * 3.2);
            c.fillStyle = 'rgba(255,100,225,0.55)'; c.fillRect(0, -z.w, z.len, z.w * 2);
            c.fillStyle = `rgba(255,225,252,${0.95 * fl})`; c.fillRect(0, -z.w / 3, z.len, z.w * 0.66);
            R.glow(c, 0, 0, z.w * 3, '#ff7ae8', 0.9); R.glow(c, z.len, 0, z.w * 2.5, '#ff7ae8', 0.6);
          } else { c.strokeStyle = 'rgba(255,120,230,0.6)'; c.lineWidth = 1.2; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(0, 0); c.lineTo(z.len, 0); c.stroke(); c.setLineDash([]); }
          c.restore();
          break;
        }
        case 'poison': case 'plague': {
          const plague = z.kind === 'plague', fade = Math.min(1, (z.dur - z.t) * 2, z.t * 4);
          if (pass === 0) {
            c.fillStyle = U.rgba(plague ? '#4a7a2a' : '#2f5a1c', 0.36 * fade);
            for (let i = 0; i < 6; i++) { const a = i * 1.05 + t * 0.35; c.beginPath(); c.ellipse(z.x + Math.cos(a) * z.r * 0.35, z.y + Math.sin(a) * z.r * 0.24, z.r * 0.55, z.r * 0.38, a, 0, U.TAU); c.fill(); }
            c.fillStyle = U.rgba('#1c3a12', 0.3 * fade); c.beginPath(); c.ellipse(z.x, z.y, z.r * 0.8, z.r * 0.55, 0, 0, U.TAU); c.fill();
            R.light(z.x, z.y, z.r * 1.6, plague ? '#a6ff6a' : '#7ad44a', 0.34 * fade);
          } else {
            R.glow(c, z.x, z.y, z.r * 1.15, plague ? '#a6ff6a' : '#7ad44a', 0.28 * fade);
            c.fillStyle = U.rgba('#d6ffb0', 0.8 * fade);
            for (let i = 0; i < 5; i++) { const kk = (t * 0.5 + i * 0.21 + z.id * 0.13) % 1, a = i * 2.4 + z.id; c.globalAlpha = Math.sin(kk * Math.PI) * 0.8 * fade; c.beginPath(); c.arc(z.x + Math.cos(a) * z.r * 0.5 * (0.4 + kk * 0.4), z.y + Math.sin(a) * z.r * 0.3 - kk * 12, 1 + kk * 1.4, 0, U.TAU); c.fill(); }
            c.globalAlpha = 1;
          }
          break;
        }
        case 'mire': {
          const fade = Math.min(1, (z.dur - z.t) * 1.5, z.t * 3);
          if (pass === 0) {
            c.save(); c.translate(z.x, z.y);
            c.fillStyle = U.rgba('#1b2a1a', 0.62 * fade); c.beginPath(); c.ellipse(0, 0, z.r, z.r * 0.7, 0, 0, U.TAU); c.fill();
            c.fillStyle = U.rgba('#2e4a2a', 0.5 * fade);
            for (let i = 0; i < 6; i++) { const a = i * 1.05 + z.id; c.beginPath(); c.ellipse(Math.cos(a) * z.r * 0.4, Math.sin(a) * z.r * 0.28, z.r * 0.4, z.r * 0.26, a + t * 0.12, 0, U.TAU); c.fill(); }
            c.strokeStyle = U.rgba('#0c140c', 0.7 * fade); c.lineWidth = 2; c.beginPath(); c.ellipse(0, 0, z.r * 0.97, z.r * 0.68, 0, 0, U.TAU); c.stroke();
            c.strokeStyle = U.rgba('#9fc07a', 0.18 * fade); c.lineWidth = 1;
            for (let i = 0; i < 3; i++) { const kk = (t * 0.4 + i / 3 + z.id * 0.1) % 1; c.globalAlpha = (1 - kk) * 0.9; c.beginPath(); c.ellipse(Math.cos(i * 2 + z.id) * z.r * 0.3, Math.sin(i * 3 + z.id) * z.r * 0.2, 3 + kk * z.r * 0.28, 1.5 + kk * z.r * 0.16, 0, 0, U.TAU); c.stroke(); }
            c.globalAlpha = 1; c.restore();
          } else {
            c.fillStyle = U.rgba('#c8e8a0', 0.65 * fade);
            for (let i = 0; i < 4; i++) { const kk = (t * 0.45 + i * 0.27 + z.id * 0.17) % 1, a = i * 2.3 + z.id * 1.7; c.globalAlpha = Math.sin(kk * Math.PI) * 0.7 * fade; c.beginPath(); c.arc(z.x + Math.cos(a) * z.r * 0.55, z.y + Math.sin(a) * z.r * 0.35 - kk * 5, 0.8 + kk * 1.6, 0, U.TAU); c.fill(); }
            c.globalAlpha = 1;
            R.glow(c, z.x, z.y, z.r * 0.9, '#6a9a5a', 0.12 * fade);
          }
          break;
        }
        case 'fire': case 'pfire': {
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5), pf = z.kind === 'pfire';
          if (pass === 0) {
            c.fillStyle = `rgba(18,8,4,${0.4 * fade})`; c.beginPath(); c.ellipse(z.x, z.y, z.r * 0.95, z.r * 0.62, 0, 0, U.TAU); c.fill();
            R.light(z.x, z.y - 6, z.r * 2.2, pf ? '#ffb347' : '#ff6a1a', 0.85 * fade);
            break;
          }
          R.glow(c, z.x, z.y - 4, z.r * 1.5, pf ? '#ffb347' : '#ff5a1a', 0.6 * fade);
          const nf = Math.max(3, Math.round(z.r / 9));
          for (let i = 0; i < nf; i++) {
            const a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / nf) * z.r * 0.7;
            const fx = z.x + Math.cos(a) * rr, fy = z.y + Math.sin(a) * rr * 0.62, ph = t * 11 + i * 1.9 + z.id;
            const h = (7 + Math.sin(ph) * 2.4 + (i % 3) * 1.8) * fade, w = 3.2 + (i % 2);
            c.fillStyle = U.rgba(pf ? '#ffb347' : '#ff6a1a', 0.85 * fade); c.beginPath(); c.moveTo(fx - w, fy); c.quadraticCurveTo(fx - w * 0.6 + Math.sin(ph * 1.3), fy - h * 0.7, fx + Math.sin(ph) * 1.5, fy - h * 1.7); c.quadraticCurveTo(fx + w * 0.6, fy - h * 0.7, fx + w, fy); c.fill();
            c.fillStyle = U.rgba('#fff0b8', 0.9 * fade); c.beginPath(); c.moveTo(fx - w * 0.5, fy); c.quadraticCurveTo(fx, fy - h * 0.9, fx + Math.sin(ph) * 0.8, fy - h * 1.05); c.quadraticCurveTo(fx + w * 0.3, fy - h * 0.4, fx + w * 0.5, fy); c.fill();
          }
          break;
        }
        case 'sanct': {
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5);
          if (pass === 0) { R.light(z.x, z.y, z.r * 1.9, '#ffe9a0', 0.8 * fade); break; }
          c.save(); c.translate(z.x, z.y);
          R.glow(c, 0, 0, z.r * 1.05, '#ffe9a0', 0.32 * fade);
          c.strokeStyle = U.rgba('#fff3c4', 0.85 * fade); c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, z.r, 0, U.TAU); c.stroke();
          c.strokeStyle = U.rgba('#ffe9a0', 0.3 * fade); c.lineWidth = 5; c.stroke();
          c.rotate(t * 0.8); c.strokeStyle = U.rgba('#ffe9a0', 0.7 * fade); c.lineWidth = 1.2; c.beginPath();
          for (let i = 0; i < 6; i++) { const a = i * U.TAU / 6; c.moveTo(Math.cos(a) * z.r * 0.7, Math.sin(a) * z.r * 0.7); c.lineTo(Math.cos(a + 2.09) * z.r * 0.7, Math.sin(a + 2.09) * z.r * 0.7); }
          c.stroke(); c.restore();
          break;
        }
        case 'rain': { // Rain of Arrows: faint ground disc, then arrows falling inside the circle
          const fade = Math.min(1, (z.dur - z.t) * 2.5, z.t * 4), warm = z.t < 0.35;
          if (pass === 0) {
            c.fillStyle = U.rgba('#e8d8b0', (warm ? 0.05 : 0.09) * fade); c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.fill();
            if (!warm) R.light(z.x, z.y - 8, z.r * 1.5, '#d8c890', 0.32 * fade);
            break;
          }
          c.strokeStyle = U.rgba('#e8d8b0', 0.7 * fade); c.lineWidth = 1.3; c.setLineDash([6, 5]); c.lineDashOffset = -t * 14; c.beginPath(); c.arc(z.x, z.y, warm ? Math.max(0.1, z.r * (1.4 - z.t / 0.35 * 0.4)) : z.r, 0, U.TAU); c.stroke(); c.setLineDash([]);
          if (warm) break;
          const n = R.quality === 'low' ? 7 : Math.max(8, Math.round(z.r / 5));
          c.lineCap = 'round';
          for (let i = 0; i < n; i++) {
            const kk = (t * 2.3 + i * 0.381 + z.id * 0.17) % 1, a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / n) * z.r * 0.94;
            const gx = z.x + Math.cos(a) * rr, gy = z.y + Math.sin(a) * rr, hy = gy - 70 * (1 - kk) * (1 - kk) - 4, hx = gx + 6 * (1 - kk);
            c.strokeStyle = U.rgba('#f2ead0', 0.85 * fade * Math.min(1, kk * 4)); c.lineWidth = 1.4; c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx - 3.2, hy - 15); c.stroke();
            c.fillStyle = U.rgba('#ffffff', 0.9 * fade * Math.min(1, kk * 4)); c.fillRect(hx - 1, hy - 1, 2, 2.4);
            if (kk > 0.9) { c.strokeStyle = U.rgba('#e8d8b0', (1 - kk) * 8 * fade); c.lineWidth = 0.9; c.beginPath(); c.ellipse(gx, gy, 2 + (kk - 0.9) * 40, 1 + (kk - 0.9) * 18, 0, 0, U.TAU); c.stroke(); }
          }
          c.lineCap = 'butt';
          break;
        }
        case 'meteor': { // friendly telegraph: growing shadow and ring on the ground, a fireball plunging from above
          const q = U.clamp(z.t / Math.max(0.1, z.dur), 0, 1), fx = z.x + (1 - q) * (1 - q) * 70, fy = z.y - (1 - q) * (1 - q) * 280;
          if (pass === 0) {
            c.fillStyle = U.rgba('#ff7a2a', 0.07 + 0.12 * q); c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.fill();
            c.fillStyle = 'rgba(0,0,0,' + (0.15 + 0.3 * q) + ')'; c.beginPath(); c.ellipse(z.x, z.y, 5 + q * q * z.r * 0.5, 2.5 + q * q * z.r * 0.26, 0, 0, U.TAU); c.fill();
            R.light(fx, fy, 60 + 90 * q, '#ff8a2a', 0.55 + 0.5 * q); R.light(z.x, z.y, z.r * 1.4, '#ff6a1a', 0.2 + 0.4 * q * q);
            break;
          }
          c.strokeStyle = U.rgba('#ff8a2a', 0.25); c.lineWidth = 6; c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.stroke();
          c.strokeStyle = U.rgba('#ffc27a', 0.9); c.lineWidth = 1.5; c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.stroke();
          c.strokeStyle = U.rgba('#ff6a1a', 0.55 + (q > 0.8 ? 0.4 * Math.sin(t * 40) : 0)); c.beginPath(); c.arc(z.x, z.y, Math.max(0.1, z.r * q), 0, U.TAU); c.stroke();
          const rad = 7 + 11 * q;
          c.strokeStyle = U.rgba('#ff7a2a', 0.5); c.lineWidth = rad * 0.9; c.lineCap = 'round'; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx - (z.x - fx) * 0.5 - 6, fy - (z.y - fy) * 0.5 - 30); c.stroke(); c.lineCap = 'butt';
          R.glow(c, fx, fy, rad * 3.2, '#ff6a1a', 0.85);
          c.fillStyle = '#ffd88a'; c.beginPath(); c.arc(fx, fy, rad * 0.85, 0, U.TAU); c.fill();
          c.fillStyle = '#ff6a1a'; c.beginPath(); c.arc(fx + rad * 0.15, fy + rad * 0.15, rad * 0.6, 0, U.TAU); c.fill();
          c.fillStyle = '#ffffff'; c.beginPath(); c.arc(fx - rad * 0.2, fy - rad * 0.2, rad * 0.28, 0, U.TAU); c.fill();
          break;
        }
        case 'smoke': { // Vanish cloud: billowing grey-violet puffs, translucent so the hero inside stays readable
          const fade = Math.min(1, (z.dur - z.t) * 1.5, z.t * 3);
          if (pass === 0) {
            const n = R.quality === 'low' ? 6 : 10;
            c.fillStyle = U.rgba('#3a3552', 0.3 * fade); c.beginPath(); c.ellipse(z.x, z.y - 2, z.r * 0.95, z.r * 0.66, 0, 0, U.TAU); c.fill();
            for (let i = 0; i < n; i++) {
              const a = i * 0.83 + z.id, wob = 0.55 + 0.3 * Math.sin(t * 0.8 + i * 1.7), rr = z.r * wob * 0.7, px = z.x + Math.cos(a + t * 0.2) * rr, py = z.y - 8 + Math.sin(a + t * 0.2) * rr * 0.62;
              const pr = z.r * (0.3 + 0.07 * Math.sin(t * 1.3 + i * 2.1));
              c.fillStyle = U.rgba(i % 2 ? '#6a6484' : '#8f89a8', 0.42 * fade); c.beginPath(); c.ellipse(px, py, pr, pr * 0.75, 0, 0, U.TAU); c.fill();
              c.fillStyle = U.rgba('#c4bedc', 0.16 * fade); c.beginPath(); c.ellipse(px - pr * 0.2, py - pr * 0.3, pr * 0.6, pr * 0.4, 0, 0, U.TAU); c.fill();
            }
            break;
          }
          R.glow(c, z.x, z.y - 6, z.r * 0.95, '#8a7cc0', 0.1 * fade);
          c.strokeStyle = U.rgba('#b4a8dc', 0.35 * fade); c.lineWidth = 1; c.setLineDash([3, 6]); c.lineDashOffset = t * 6; c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.stroke(); c.setLineDash([]);
          break;
        }
        case 'pull': {
          if (pass === 0) break;
          c.save(); c.translate(z.x, z.y);
          c.strokeStyle = 'rgba(111,230,255,0.4)'; c.lineWidth = 2;
          for (let i = 0; i < 4; i++) { const rr = ((t * 60 + i * 70) % 280); c.beginPath(); c.arc(0, 0, z.r * (1 - rr / 280), t * 2 + i, t * 2 + i + 3.5); c.stroke(); }
          c.restore();
          break;
        }
        default: {
          // unknown kinds: friendly (team 0) areas get a gold sigil disc; hostile ones a faint red mark
          if (!z.r) break;
          const fade = z.dur ? Math.min(1, (z.dur - z.t) * 2, z.t * 5) : 1;
          const fr = z.team === 0, col = fr ? '#ffe39a' : RED;
          if (pass === 0) {
            c.fillStyle = U.rgba(col, (fr ? 0.1 : 0.12) * fade); c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.fill();
            R.light(z.x, z.y, z.r * 1.7, col, 0.45 * fade);
          } else {
            c.save(); c.translate(z.x, z.y);
            R.glow(c, 0, 0, z.r * 1.05, col, 0.18 * fade);
            c.strokeStyle = U.rgba(col, 0.75 * fade); c.lineWidth = 1.4; c.setLineDash([7, 5]); c.lineDashOffset = -t * 12; c.beginPath(); c.arc(0, 0, z.r, 0, U.TAU); c.stroke(); c.setLineDash([]);
            if (fr) { c.rotate(t * 0.5); c.strokeStyle = U.rgba(col, 0.4 * fade); c.lineWidth = 1; c.beginPath(); c.arc(0, 0, z.r * 0.62, 0, U.TAU); for (let i = 0; i < 4; i++) { const a = i * U.TAU / 4; c.moveTo(Math.cos(a) * z.r * 0.62, Math.sin(a) * z.r * 0.62); c.lineTo(Math.cos(a) * z.r * 0.9, Math.sin(a) * z.r * 0.9); } c.stroke(); }
            c.restore();
          }
        }
      }
    }
  }

  // ---------------- pickups & props ----------------
  const NOP = () => {};
  // Pickups are cached 16x16 sprites (outlined, drawn once at 4x). Pass 0 (lit): ground blob and lights. Pass 1 (after lighting): halos (additive), then
  // the opaque sprites, so shards and coins read in any light; fast-moving (magnetised) pickups leave a short trail.
  const pkSpr = {}, pkTrail = new Map(); let pkFrame = 0;
  const PK_COL = { gold: '#ffc94a', xp: '#7dffd9', orb: '#ff2a4a', heart: '#ff4a5a' };
  function pickSprite(kind) {
    let s = pkSpr[kind]; if (s) return s;
    s = pkSpr[kind] = document.createElement('canvas'); s.width = s.height = 64;
    const g = s.getContext('2d'); g.translate(32, 32); g.scale(4, 4); g.lineJoin = 'round'; g.lineWidth = 0.9; g.strokeStyle = '#0b0806';
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
    } else if (kind === 'orb') {
      g.fillStyle = '#e01a38'; g.beginPath(); g.moveTo(0, -7.5); g.quadraticCurveTo(5.5, -1, 4.6, 2.6); g.quadraticCurveTo(3.6, 6, 0, 6); g.quadraticCurveTo(-3.6, 6, -4.6, 2.6); g.quadraticCurveTo(-5.5, -1, 0, -7.5); g.fill(); g.stroke();
      g.fillStyle = '#ff6a80'; g.beginPath(); g.ellipse(1.2, 2.6, 2.2, 2.4, 0, 0, U.TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(-1.8, 0.4, 1.1, 2.2, 0.3, 0, U.TAU); g.fill();
    } else {
      g.scale(0.3, 0.3); g.lineWidth = 3.2; g.fillStyle = '#ff4a5a';
      g.beginPath(); g.moveTo(0, 18); g.bezierCurveTo(-24, 2, -22, -20, -8, -20); g.quadraticCurveTo(-2, -20, 0, -12); g.quadraticCurveTo(2, -20, 8, -20); g.bezierCurveTo(22, -20, 24, 2, 0, 18); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(-9, -8, 4, 6, -0.6, 0, U.TAU); g.fill();
    }
    return s;
  }
  let glintSpr = null;
  function glintSprite() {
    if (glintSpr) return glintSpr;
    glintSpr = document.createElement('canvas'); glintSpr.width = glintSpr.height = 32;
    const g = glintSpr.getContext('2d'); g.translate(16, 16); g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -15); g.lineTo(1.3, -1.3); g.lineTo(15, 0); g.lineTo(1.3, 1.3); g.lineTo(0, 15); g.lineTo(-1.3, 1.3); g.lineTo(-15, 0); g.lineTo(-1.3, -1.3); g.closePath(); g.fill();
    return glintSpr;
  }
  function drawPickups(c, view, t, pass) {
    const pks = view.pickups;
    if (pass === 0) {
      let n = 0; // light budget: a big pile of orbs must not starve other lights
      for (const pk of pks) {
        const lit = n++ < 14, L = lit ? R.light : NOP, k = pk.kind, big = k === 'orb' || k === 'heart';
        if (k === 'gold') L(pk.x, pk.y - 4, 28, '#ffd36b', 0.5);
        else if (k === 'xp') L(pk.x, pk.y - 4, 26, '#7dffd9', 0.5);
        else if (k === 'orb') L(pk.x, pk.y - 6, 34, '#ff2a4a', 0.65);
        else L(pk.x, pk.y - 6, 36, '#ff4a5a', 0.6);
        c.globalAlpha = 0.55; c.drawImage(shadowCv, pk.x - 7, pk.y - (big ? 9 : 6), 14, big ? 12 : 9);
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
      const k = pk.kind, big = k === 'orb' || k === 'heart', bob = Math.sin(t * 5 + pk.id) * 1.5, y = pk.y - (big ? 7 : 5) + bob, col = PK_COL[k], s = pkTrail.get(pk.id);
      if (n++ < 70) R.glow(c, pk.x, y, big ? 15 : 11, col, k === 'xp' ? 0.75 + Math.sin(t * 6 + pk.id) * 0.15 : 0.6);
      if (s && s.v > 150) for (let i = 1; i <= 3; i++) R.glow(c, pk.x - s.dx / s.v * i * 5, y - s.dy / s.v * i * 5 * 0.7, 6 - i, col, 0.62 - i * 0.16);
    }
    c.globalCompositeOperation = 'source-over';
    for (const pk of pks) {
      const k = pk.kind, bob = Math.sin(t * 5 + pk.id) * 1.5, spr = pickSprite(k);
      if (k === 'gold') { const w = 8 * Math.max(0.2, Math.abs(Math.cos(t * 4 + pk.id))); c.drawImage(spr, pk.x - w, pk.y - 12 + bob, w * 2, 16); }
      else if (k === 'xp') { const p = 1 + Math.sin(t * 6 + pk.id) * 0.05; c.drawImage(spr, pk.x - 8 * p, pk.y - 13 + bob - 8 * (p - 1), 16 * p, 16 * p); }
      else if (k === 'orb') { const p = 0.9 + Math.sin(t * 6 + pk.id) * 0.06; c.drawImage(spr, pk.x - 8 * p, pk.y - 15 + bob, 16 * p, 16); }
      else c.drawImage(spr, pk.x - 8, pk.y - 14 + bob, 16, 16);
    }
    c.globalCompositeOperation = 'lighter';
    for (const pk of pks) { // twinkle
      const k = pk.kind; if (k !== 'xp' && k !== 'gold') continue;
      const q = Math.sin(t * (k === 'gold' ? 2.6 : 1.9) + pk.id * 1.7);
      if (q < 0.88) continue;
      const a = (q - 0.88) / 0.12, sz = 6 + a * 6;
      c.globalAlpha = a * 0.9; c.drawImage(glintSprite(), pk.x - sz / 2 + 1, pk.y - 10 - sz / 2 + Math.sin(t * 5 + pk.id) * 1.5, sz, sz);
    }
    c.globalAlpha = 1;
  }

  const PROP_LABEL = {
    chest: () => 'Open', fountain: () => 'Drink (heal party 50%)', altar: (p, me) => `Bleed 20% health for an epic boon`,
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
  const REWARD_DESC = { gold: 'Gold for the whole party, more when the lantern is low.', vigor: 'Permanently raises your maximum health and heals you.', forge: 'Rank up one of your boons.', oil: 'Refills part of the lantern for the whole party.', class: 'Choose a technique unique to your hero.', epic: 'Choose from epic boons.', relic: 'A hoard of relics: each hero takes one.' };
  const SHOP_DESC = { boon: 'Grants an extra boon pick with no common options.', oil: 'Lantern oil: refills part of the lantern for the whole party.', forge: 'Forge: rank up one of your boons.', potion: 'Heals a good chunk of your health.' };
  // Longer explanation shown above the prompt (null when there is none).
  R.propDesc = (p) => {
    if (p.kind === 'reward') {
      const s = String(p.item);
      if (s.indexOf('boon:') === 0) { const pa = ED.PATHS[s.slice(5)]; return pa ? `Choose a ${pa.name} boon. Opens the path if you have a free slot.` : null; }
      return REWARD_DESC[s] || null;
    }
    if (p.kind === 'campfire') return 'Rest: recover a chunk of your health. One use per hero.';
    if (p.kind === 'anvil') return 'Temper: rank up one of your boons. One use per hero.';
    if (p.kind === 'shop') return SHOP_DESC[p.stype] || null;
    return null;
  };
  R.interactable = (p) => !p.state && p.kind !== 'sign' && p.kind !== 'merchant';

  const PATH_COL = { pyre: '#ff7a2a', rime: '#7fe3ff', storm: '#ffe66b', steel: '#d9dfe8', blood: '#d43a5a', spirit: '#b78cff' };
  // Colour of a reward-type string such as 'boon:pyre', 'gold', 'oil', 'relic' (unknown -> warm white).
  function rewardColor(s) {
    s = String(s || '');
    if (s.indexOf('boon:') === 0) return PATH_COL[s.slice(5)] || '#ffe9a0';
    return { gold: '#ffd36b', vigor: '#ff4a5a', forge: '#ff9a3a', oil: '#ffb35c', class: '#c98bff', epic: '#c98bff', relic: '#ffb02e', campfire: '#ff9a3a', anvil: '#ffb066' }[s] || '#ffe9a0';
  }
  R.rewardColor = rewardColor;
  const REWARD_LABEL = { gold: 'Gold', vigor: 'Vigor', forge: 'Forge', oil: 'Lantern oil', class: 'Class technique', relic: 'Relic hoard', epic: 'Epic boon', campfire: 'Rest', anvil: 'Temper' };
  // Short name of a reward string: 'boon:pyre' -> 'Boon of Pyre'.
  R.rewardLabel = (s) => {
    s = String(s || '');
    if (s.indexOf('boon:') === 0) { const pa = ED.PATHS[s.slice(5)]; return 'Boon of ' + (pa ? pa.name : 'the Deep'); }
    return REWARD_LABEL[s] || 'Reward';
  };
  // [icon, colour] for a reward string; cls (a hero class id) picks the glyph of 'class' rewards.
  R.rewardIcon = (s, cls) => {
    s = String(s || '');
    if (s.indexOf('boon:') === 0) { const pa = ED.PATHS[s.slice(5)]; return pa ? [pa.icon, pa.color] : ['star', '#ffe9a0']; }
    if (s === 'class') { const k = ED.CLASSES[cls]; return k ? [k.icon, k.col.c] : ['scroll', '#c98bff']; }
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
      const a = U.clamp((near - 22) / 46, 0.22, 0.95);
      c.globalAlpha = a;
      c.drawImage(ED.Icons.canvas(pv.ri.icon, pv.color, 64), pv.x - 11, pv.y - 11, 22, 22);
      if (pv.ri.badge) c.drawImage(ED.Icons.canvas('skull', '#ff7a3a', 64), pv.x + 3, pv.y + 2, 12, 12);
      if (pv.lab) { // lantern label on the room side of the icon; stays readable up close
        c.save(); c.globalAlpha = Math.max(a, 0.7);
        c.font = '800 9.5px "Alegreya Sans", sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
        const tw = c.measureText(pv.lab).width, lx = pv.x - (tw + 13) / 2, ly = pv.d === 's' ? pv.y - 18 : pv.y + 18;
        c.drawImage(ED.Icons.canvas('lantern', pv.lc, 64), lx, ly - 5.5, 11, 11);
        c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.9)'; c.strokeText(pv.lab, lx + 13, ly); c.fillStyle = pv.lc; c.fillText(pv.lab, lx + 13, ly); c.restore();
      }
    }
    c.globalAlpha = 1;
  }

  function drawProps(c, view, local, t) {
    for (const p of view.props) {
      const done = !!(R.claimed && p.group && R.claimed[p.group] && (p.kind === 'campfire' || p.kind === 'anvil' || (p.kind === 'reward' && /^(boon:|class$|forge$|epic$|vigor$)/.test(p.item)))); // this hero already used it
      const G = done ? () => {} : (dx, dy, r, col, a) => R.emit(p.x + dx, p.y + dy, r, col, a), L = done ? () => {} : (dx, dy, r, col, k) => R.light(p.x + dx, p.y + dy, r, col, k);
      c.save(); c.translate(p.x, p.y);
      if (done) c.globalAlpha = 0.4;
      c.lineWidth = 1.5; c.strokeStyle = '#0b0806';
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
            if (p.kind === 'relic' || p.stype === 'relic') { const r = ED.RELICS[p.item]; col = ED.RARITY[r.rar].color; icon = ED.Icons.relicCanvas(p.item, 64); }
            else if (p.stype === 'boon') { col = ED.RARITY.e.color; icon = ED.Icons.canvas('star', col, 64); }
            else if (p.stype === 'oil') { col = '#ffb35c'; icon = ED.Icons.canvas('oil', col, 64); }
            else if (p.stype === 'forge') { col = '#ff9a3a'; icon = ED.Icons.canvas('anvil', col, 64); }
            else { col = '#ff4a5a'; icon = ED.Icons.canvas('potion', col, 64); }
            G(0, -22 + bob, 24, col, 0.65); L(0, -22, 80, col, 0.8);
            c.drawImage(icon, -10, -32 + bob, 20, 20);
            if (p.kind === 'shop') {
              const can = view.gold >= p.price;
              c.font = '800 8px "Alegreya Sans", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
              c.lineWidth = 2.5; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(p.price + 'g', 0, 9);
              c.fillStyle = can ? '#ffd36b' : '#a07060'; c.fillText(p.price + 'g', 0, 9);
            }
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
          c.drawImage(ED.Icons.canvas(ri[0], ri[1], 64), -12, -38 + bob, 24, 24);
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
  const LOOK_H = { priest: 44, rift: 44, sentinel: 48, knight: 34, golem: 36, hulk: 30, robed: 30, wraith: 36, reaver: 34, drone: 24, worm: 40, horror: 36, shade: 30, imp: 24, totem: 30, skeleton: 28, zombie: 28, wolf: 20, crab: 20, spider: 14, slime: 18, spitter: 28, shroom: 26, eel: 18 }; // approximate sprite heights at def.r
  const BURN_K = [0, 0.85, 1.1, 1.4]; // flame scale per burn level
  const hash1 = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  // Status light + halo, capped per frame (fewer on low quality).
  const stLight = (x, y, r, col, k) => { if (stN < (R.quality === 'low' ? 8 : 26)) { stN++; R.light(x, y, r, col, k); R.emit(x, y, r * 0.45, col, k * 0.5); } };
  // Drawn at the foe's origin right after its sprite. Colours follow the path colours: burn Pyre, chill/freeze Rime, charge Storm, bleed Blood.
  function drawStatus(c, e, t) {
    if (e.burrowed || e.hp <= 0) return;
    const r = e.r, id = e.id | 0, fly = !!e.def.fly, bh = fly ? r * 2.6 : (LOOK_H[e.def.look] || r * 2.7) * (r / e.def.r), cy = fly ? -r * 1.7 : -bh * 0.5, hh = bh * 0.56; // bh: sprite height; cy/hh: body centre and half-height
    if (e.ward > 0) {
      const sh = 0.22 + 0.12 * Math.sin(t * 4 + id);
      c.fillStyle = U.rgba('#7fc8ff', sh * 0.35); c.strokeStyle = U.rgba('#bfe3ff', sh + 0.2); c.lineWidth = 1.2;
      c.beginPath(); c.ellipse(0, cy, r * 1.35, hh * 1.2, 0, 0, U.TAU); c.fill(); c.stroke();
      c.strokeStyle = U.rgba('#ffffff', 0.5); c.beginPath(); c.arc(0, cy, r * 1.3, t * 2 + id, t * 2 + id + 0.9); c.stroke();
    }
    if (e.frozen > 0) {
      const w = r * 1.5, h = hh;
      c.fillStyle = U.rgba('#bfeaff', 0.4); c.strokeStyle = U.rgba('#f0fdff', 0.95); c.lineWidth = 1.5; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-w, cy - h * 0.7); c.lineTo(-w * 0.55, cy - h); c.lineTo(w * 0.6, cy - h * 0.95); c.lineTo(w, cy - h * 0.6); c.lineTo(w * 0.9, cy + h * 0.8); c.lineTo(w * 0.4, cy + h); c.lineTo(-w * 0.5, cy + h * 0.95); c.lineTo(-w, cy + h * 0.6); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = U.rgba('#ffffff', 0.55); c.lineWidth = 1; c.beginPath(); c.moveTo(-w * 0.6, cy - h * 0.7); c.lineTo(-w * 0.2, cy + h * 0.5); c.moveTo(w * 0.2, cy - h * 0.8); c.lineTo(w * 0.55, cy - h * 0.1); c.stroke();
      c.fillStyle = U.rgba('#ffffff', 0.4); c.fillRect(-w * 0.8, cy - h * 0.5, 2, h * 0.9);
      stLight(e.x, e.y + cy, r * 3.2, '#8fe8ff', 0.5);
    } else if (e.chill > 0) {
      const ch = U.clamp(e.chill / 100, 0.1, 1), n = 2 + Math.round(ch * 5);
      c.fillStyle = U.rgba('#9fefff', 0.1 + 0.26 * ch); c.beginPath(); c.ellipse(0, cy, r * 1.0, hh * 0.9, 0, 0, U.TAU); c.fill();
      c.fillStyle = U.rgba('#e8fbff', 0.85); c.strokeStyle = U.rgba('#7fe3ff', 0.9); c.lineWidth = 0.8;
      for (let i = 0; i < n; i++) { const a = i * 2.4 + id, x = Math.cos(a) * r * 0.95, y = cy + Math.sin(a) * hh * 0.95, s = 1.8 + ch * 2; c.beginPath(); c.moveTo(x, y - s * 1.6); c.lineTo(x + s * 0.8, y + s * 0.5); c.lineTo(x - s * 0.8, y + s * 0.5); c.closePath(); c.fill(); c.stroke(); }
      stLight(e.x, e.y + cy, r * 2.6, '#7fe3ff', 0.15 + 0.35 * ch);
    }
    const bl = e.burnLvl !== undefined ? e.burnLvl : ED.Net.burnLevel(e); // clients get the level in the snapshot, host/solo derive it from the pool: same flames
    if (bl > 0) {
      const k = BURN_K[bl], n = R.quality === 'low' ? 3 : 5;
      for (let i = 0; i < n; i++) {
        const a = i * 1.9 + id, fx = Math.cos(a) * r * 0.8, fy = -bh * 0.12 - (i % 3) * bh * 0.2 + Math.sin(a) * r * 0.1;
        const ph = t * 12 + i * 2.1 + id, h = (r * 0.8 + 3 + Math.sin(ph) * 1.6) * k, w = r * 0.34 + 1.5;
        c.fillStyle = U.rgba('#ff5a14', 0.88); c.beginPath(); c.moveTo(fx - w, fy); c.quadraticCurveTo(fx - w * 0.6 + Math.sin(ph * 1.3), fy - h * 0.7, fx + Math.sin(ph) * 1.4, fy - h * 1.6); c.quadraticCurveTo(fx + w * 0.6, fy - h * 0.7, fx + w, fy); c.fill();
        c.fillStyle = U.rgba('#ffd36b', 0.92); c.beginPath(); c.moveTo(fx - w * 0.5, fy); c.quadraticCurveTo(fx, fy - h * 0.85, fx + Math.sin(ph) * 0.8, fy - h); c.quadraticCurveTo(fx + w * 0.3, fy - h * 0.4, fx + w * 0.5, fy); c.fill();
      }
      stLight(e.x, e.y - r, r * 3.2, '#ff7a2a', 0.5 * k);
    }
    if (e.charge > 0) {
      const sd = Math.floor(t * 18) + id * 7;
      c.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const a = hash1(sd * 0.7 + i * 3.1) * U.TAU, x0 = Math.cos(a) * r * 0.75, y0 = cy + Math.sin(a) * hh * 0.9, a2 = a + (hash1(sd + i) - 0.5) * 1.2, len = 6 + hash1(sd * 1.3 + i) * 6;
        const x1 = x0 + Math.cos(a2) * len * 0.5 + (hash1(sd + i * 9) - 0.5) * 5, y1 = y0 + Math.sin(a2) * len * 0.5 + (hash1(sd + i * 5) - 0.5) * 5, x2 = x0 + Math.cos(a2) * len, y2 = y0 + Math.sin(a2) * len;
        c.strokeStyle = U.rgba('#ffe66b', 0.95); c.lineWidth = 1.3; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        c.strokeStyle = '#ffffff'; c.lineWidth = 0.5; c.stroke();
      }
      stLight(e.x, e.y + cy, r * 2.6, '#ffe66b', 0.45);
    }
    if (e.bleedPool > 0) {
      c.strokeStyle = U.rgba('#a8142c', 0.9); c.lineWidth = 1.2; c.beginPath(); c.moveTo(-r * 0.5, cy - hh * 0.4); c.lineTo(r * 0.1, cy + hh * 0.05); c.moveTo(-r * 0.15, cy - hh * 0.5); c.lineTo(r * 0.45, cy - hh * 0.05); c.stroke();
      for (let i = 0; i < 3; i++) { const ph = (t * 1.6 + i * 0.37 + id * 0.13) % 1; c.fillStyle = U.rgba('#c4182e', 1 - ph * 0.6); c.beginPath(); c.ellipse((i - 1) * r * 0.55, cy - hh * 0.2 + ph * hh * 1.1, 1.1, 1.8 + ph * 1.5, 0, 0, U.TAU); c.fill(); }
    }
    if (e.judged > 0) {
      c.save(); c.translate(0, -1); c.scale(1, 0.5);
      const rr = r * 1.5, rot = t * 1.2;
      c.strokeStyle = U.rgba('#ffd36b', 0.85); c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, rr, 0, U.TAU); c.stroke();
      c.strokeStyle = U.rgba('#fff3c4', 0.8); c.lineWidth = 1.1; c.beginPath();
      for (let i = 0; i < 6; i++) { const a = rot + i * U.TAU / 6; c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); c.lineTo(Math.cos(a) * rr * 1.18, Math.sin(a) * rr * 1.18); }
      for (let i = 0; i < 3; i++) { const a = -rot + i * U.TAU / 3; c.lineTo(Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62); }
      c.closePath(); c.stroke(); c.restore();
      stLight(e.x, e.y, r * 2.4, '#ffd36b', 0.35);
    }
    if (e.vulnT > 0) { // takes +20% damage (Hailthorns, Smokescreen): two pink chevrons dripping down beside the body, apart from the Judgment ring
      const x = r * 0.95 + 5, hv = hh * 1.1;
      c.strokeStyle = '#ff8ed0'; c.lineWidth = 1.3; c.lineJoin = 'round'; c.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const ph = (t * 1.3 + i * 0.5 + id * 0.17) % 1, y = cy - hh * 0.55 + ph * hv;
        c.globalAlpha = Math.sin(ph * Math.PI) * 0.8;
        c.beginPath(); c.moveTo(x - 3.2, y - 2.6); c.lineTo(x, y + 0.6); c.lineTo(x + 3.2, y - 2.6); c.stroke();
      }
      c.globalAlpha = 1;
    }
    if (e.blind > 0) { // smoke curling off the head and dim motes circling it
      const hy = cy - hh * 0.95;
      for (let i = 0; i < 3; i++) { const ph = (t * 0.8 + i / 3 + id * 0.1) % 1; c.fillStyle = U.rgba('#a09ac0', 0.85 * (1 - ph)); c.strokeStyle = U.rgba('#2a2540', 0.6 * (1 - ph)); c.lineWidth = 0.8; c.beginPath(); c.arc(Math.sin(ph * 6.28 + i * 2) * r * 0.5, hy - ph * 10, 2.2 + ph * 3.4, 0, U.TAU); c.fill(); c.stroke(); }
      for (let i = 0; i < 3; i++) { const a = t * 3 + i * U.TAU / 3 + id; c.fillStyle = U.rgba('#cfc8f0', 0.9); c.fillRect(Math.cos(a) * r * 0.9 - 1, hy + 2 + Math.sin(a) * 3 - 1, 2, 2); }
    }
  }

  // Drawn at the hero's origin after the sprite: evolution aura, blood shield, ambush glint, Bulwark.
  function drawHeroFx(c, p, t) {
    if (p.dead) return;
    const st = p.stats, evo = st && st.evo, low = R.quality === 'low', a0 = p.stealthT > 0 ? (p.pid === R.local ? 0.45 : 0.2) : 1;
    if (a0 < 1) c.globalAlpha = a0;
    if (evo && !p.downed && PATH_COL[evo]) {
      const col = PATH_COL[evo];
      c.strokeStyle = U.rgba(col, 0.55); c.lineWidth = 1.2; c.setLineDash([4, 5]); c.lineDashOffset = -t * 10; c.beginPath(); c.ellipse(0, 1, 15, 6.5, 0, 0, U.TAU); c.stroke(); c.setLineDash([]);
      if (!low) for (let i = 0; i < 3; i++) { const a = t * 1.8 + i * U.TAU / 3, x = Math.cos(a) * 17, y = -11 + Math.sin(a) * 7; c.fillStyle = U.rgba(col, 0.95); c.beginPath(); c.moveTo(x, y - 2.4); c.lineTo(x + 1.6, y); c.lineTo(x, y + 2.4); c.lineTo(x - 1.6, y); c.closePath(); c.fill(); }
      R.emit(p.x, p.y - 10, 24, col, 0.2 + Math.sin(t * 3 + (p.slot || 0)) * 0.05); R.light(p.x, p.y - 10, 62, col, 0.28);
    }
    if (p.shield > 0) {
      const fr = U.clamp(p.shield / Math.max(1, p.maxHp * 0.25), 0.15, 1), rr = 12 + 9 * fr, wob = Math.sin(t * 4 + (p.slot || 0)) * 0.6;
      c.fillStyle = U.rgba('#d43a5a', 0.1 + 0.14 * fr); c.strokeStyle = U.rgba('#ffc4d0', 0.5 + 0.3 * fr); c.lineWidth = 1.3;
      c.beginPath(); c.ellipse(0, -12, rr + wob, rr * 1.2 - wob, 0, 0, U.TAU); c.fill(); c.stroke();
      c.strokeStyle = U.rgba('#ffffff', 0.55); c.beginPath(); c.arc(0, -12, rr * 0.8, -2.5, -1.6); c.stroke();
    }
    if (p.ambush && !p.downed) R.emit(p.x, p.y - 12, 22, '#b78cff', 0.3 + Math.sin(t * 9) * 0.12);
    if (p.bulwarkT > 0 && !p.downed) {
      const a = p.face || 0, mir = st && st.mirrorguard, rr = 22, half = mir ? Math.PI : 1.309, fl = p.bulwarkT < 0.25 && p.bulwarkT !== 1 ? 0.5 + 0.5 * Math.sin(t * 40) : 1;
      c.save(); c.translate(0, -10); c.globalAlpha = (a0 < 1 ? a0 : 1) * fl; c.lineCap = 'round';
      c.strokeStyle = '#0b0806'; c.lineWidth = 8; c.beginPath(); c.arc(0, 0, rr, a - half, a + half); c.stroke();
      c.strokeStyle = '#d9b44a'; c.lineWidth = 5.4; c.beginPath(); c.arc(0, 0, rr, a - half, a + half); c.stroke();
      c.strokeStyle = '#fff3c4'; c.lineWidth = 1.6; c.beginPath(); c.arc(0, 0, rr + 1.4, a - half * 0.92, a + half * 0.92); c.stroke();
      c.fillStyle = '#fff6c8'; for (const q of [-half * 0.85, 0, half * 0.85]) { c.beginPath(); c.arc(Math.cos(a + q) * rr, Math.sin(a + q) * rr, 1.6, 0, U.TAU); c.fill(); }
      c.restore();
      R.emit(p.x + Math.cos(a) * rr, p.y - 10 + Math.sin(a) * rr, 22, '#ffe9a0', 0.4 * fl); R.light(p.x + Math.cos(a) * rr, p.y - 10 + Math.sin(a) * rr, 56, '#ffe9a0', 0.45);
    }
    c.globalAlpha = 1;
  }

  // ---------------- companions (orbit blades / wisps drawn around heroes) ----------------
  function drawCompanions(c, p, view, t, back) {
    if (!p.stats || p.downed || p.dead) return;
    const ht = view.time !== undefined ? view.time : t;
    const n = p.stats.orbit || 0;
    for (let i = 0; i < n; i++) {
      const a = ht * 3.2 + i * U.TAU / n;
      const ox = Math.cos(a) * 44, oy = Math.sin(a) * 44;
      if ((oy < 0) !== back) continue;
      c.save(); c.translate(ox, oy - 6); c.rotate(a * 3);
      R.glow(c, 0, 0, 14, '#cfe6ff', 0.5);
      c.fillStyle = '#e6eef6'; c.strokeStyle = '#0b0806'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, -8); c.quadraticCurveTo(6, -2, 0, 8); c.quadraticCurveTo(2, 0, 0, -8); c.fill(); c.stroke();
      c.restore();
      if (!back) R.light(p.x + ox, p.y + oy - 6, 34, '#cfe6ff', 0.35);
    }
    const nw = p.stats.wisp || 0;
    for (let i = 0; i < nw; i++) {
      const a = ht * 1.6 + i * U.TAU / nw;
      const ox = Math.cos(a) * 26, oy = Math.sin(a) * 10 - 14;
      if ((Math.sin(a) < 0) !== back) continue;
      R.glow(c, ox, oy, 12, '#bff0ff', 0.8);
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ox, oy, 2.4, 0, U.TAU); c.fill();
      if (!back) R.light(p.x + ox, p.y + oy, 44, '#bff0ff', 0.55);
    }
  }

  // ---------------- projectiles ----------------
  function trailSprite(color) {
    let s = trailCache[color]; if (s) return s;
    s = trailCache[color] = document.createElement('canvas'); s.width = 64; s.height = 16;
    const g = s.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, U.rgba(color, 0)); gr.addColorStop(0.7, U.rgba(color, 0.45)); gr.addColorStop(1, U.rgba(color, 0.9));
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 8); g.lineTo(64, 0); g.lineTo(64, 16); g.closePath(); g.fill();
    return s;
  }
  const FIRE_KINDS = { fire: 1, firebolt: 1, fireball: 1, droneshot: 1, crescent: 1 };
  // pass 0: solid bodies (lit with the scene); pass 1: halos, cores and trails (emissive, additive context).
  function drawProjectiles(c, view, t, pass) {
    let n = 0;
    for (const pr of view.projs) {
      const a = Math.atan2(pr.vy, pr.vx), col = ED.FX.projColor(pr.kind), foe = pr.team === 1;
      const sp = Math.min(520, Math.hypot(pr.vx, pr.vy));
      c.save(); c.translate(pr.x, pr.y - 6);
      if (pass === 0) {
        if (n++ < 40) R.light(pr.x, pr.y - 6, (foe ? 46 : 40) + pr.r * 2.5, col, foe ? 0.8 : 0.7);
        switch (pr.kind) {
          case 'arrow': case 'bolt': case 'trident':
            c.rotate(a);
            c.fillStyle = pr.kind === 'trident' ? '#e8c66b' : '#8a6a42'; c.fillRect(-9, -0.9, pr.kind === 'trident' ? 18 : 12, 1.8);
            c.fillStyle = '#d8d0c0'; c.beginPath(); c.moveTo(-9, 0); c.lineTo(-12, -2.6); c.lineTo(-6.5, 0); c.lineTo(-12, 2.6); c.closePath(); c.fill();
            c.fillStyle = '#eef2f6'; c.beginPath(); c.moveTo(pr.kind === 'trident' ? 13 : 7, -2.8); c.lineTo(pr.kind === 'trident' ? 19 : 11, 0); c.lineTo(pr.kind === 'trident' ? 13 : 7, 2.8); c.fill();
            break;
          case 'knife': c.rotate(a); c.fillStyle = '#d9dfe8'; c.beginPath(); c.moveTo(-4, -1.6); c.lineTo(7, 0); c.lineTo(-4, 1.6); c.fill(); c.fillStyle = '#2b2233'; c.fillRect(-7, -1, 3, 2); break;
          case 'bone': case 'skull':
            c.rotate(t * 14 + pr.id); c.fillStyle = '#efe8d4'; c.fillRect(-5, -1.3, 10, 2.6); c.beginPath(); c.arc(-5, 0, 2.2, 0, U.TAU); c.arc(5, 0, 2.2, 0, U.TAU); c.fill();
            break;
          case 'hammer': c.rotate(t * 16 + pr.id); c.fillStyle = '#8a6a42'; c.fillRect(-1, -9, 2, 14); c.fillStyle = '#d8dde4'; c.fillRect(-6, -11, 12, 7); c.fillStyle = '#fff'; c.fillRect(-6, -11, 12, 1.5); break;
          case 'thorn': c.rotate(a); c.fillStyle = '#4a7a2a'; c.beginPath(); c.moveTo(-5, -1.6); c.lineTo(8, 0); c.lineTo(-5, 1.6); c.fill(); break;
          case 'web': c.rotate(t * 3); c.strokeStyle = 'rgba(235,235,245,0.85)'; c.lineWidth = 0.8; for (let i = 0; i < 4; i++) { const aa = i * Math.PI / 4; c.beginPath(); c.moveTo(Math.cos(aa) * 5, Math.sin(aa) * 5); c.lineTo(-Math.cos(aa) * 5, -Math.sin(aa) * 5); c.stroke(); } c.beginPath(); c.arc(0, 0, 3, 0, U.TAU); c.stroke(); break;
          default: break;
        }
        c.restore(); continue;
      }
      // ---- emissive pass ----
      const trail = trailSprite(col);
      switch (pr.kind) {
        case 'arrow': case 'bolt': case 'trident': {
          c.rotate(a);
          c.drawImage(trail, -26 - sp * 0.03, -2.6, 30 + sp * 0.03, 5.2);
          if (foe) R.glow(c, 0, 0, 16, '#ff5a3a', 0.6); else R.glow(c, 6, 0, 9, col, 0.35);
          break;
        }
        case 'knife': c.rotate(a); c.drawImage(trail, -24, -2, 26, 4); R.glow(c, 3, 0, 8, '#cfd8ff', 0.4); break;
        case 'bone': case 'skull': R.glow(c, 0, 0, 13, '#ff5a3a', 0.4); break;
        case 'hammer': R.glow(c, 0, 0, 16, '#ffe9a0', 0.7); break;
        case 'thorn': c.rotate(a); c.drawImage(trail, -20, -2, 22, 4); R.glow(c, 0, 0, 9, '#9cff6a', 0.4); break;
        case 'web': R.glow(c, 0, 0, 10, '#ffffff', 0.3); break;
        case 'ice': case 'shard': case 'iceshard': case 'spectral': {
          c.rotate(a); c.drawImage(trail, -34, -4, 36, 8);
          R.glow(c, 0, 0, 16, col, 0.7);
          c.fillStyle = '#f4fdff'; c.beginPath(); c.moveTo(-6, -2.5); c.lineTo(8, 0); c.lineTo(-6, 2.5); c.closePath(); c.fill();
          c.fillStyle = U.rgba(col, 0.9); c.beginPath(); c.moveTo(-2, -1.2); c.lineTo(8, 0); c.lineTo(-2, 1.2); c.closePath(); c.fill();
          break;
        }
        case 'wave': case 'crescent': case 'bloodscythe': {
          c.rotate(a);
          const rr = pr.r || 14, fl = 0.85 + Math.sin(t * 30 + pr.id) * 0.15;
          c.strokeStyle = U.rgba(col, 0.35 * fl); c.lineWidth = 7; c.beginPath(); c.arc(-rr * 0.4, 0, rr, -1, 1); c.stroke();
          c.strokeStyle = U.rgba(col, 0.85 * fl); c.lineWidth = 3.2; c.beginPath(); c.arc(-rr * 0.4, 0, rr, -0.95, 0.95); c.stroke();
          c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.2; c.beginPath(); c.arc(-rr * 0.4, 0, rr, -0.8, 0.8); c.stroke();
          R.glow(c, 0, 0, rr * 1.6, col, 0.4);
          break;
        }
        default: {
          const r = Math.max(2.5, pr.r), fl = FIRE_KINDS[pr.kind] ? 0.85 + Math.sin(t * 25 + pr.id) * 0.15 : 1;
          c.save(); c.rotate(a); c.drawImage(trail, -r * 4 - sp * 0.04, -r * 1.05, r * 4 + sp * 0.04, r * 2.1); c.restore();
          R.glow(c, 0, 0, r * 3.4 * fl, col, foe ? 0.85 : 0.7);
          if (foe) { c.fillStyle = 'rgba(30,6,6,0.75)'; c.beginPath(); c.arc(0, 0, r + 1.6, 0, U.TAU); c.fill(); }
          c.fillStyle = col; c.beginPath(); c.arc(0, 0, r, 0, U.TAU); c.fill();
          c.fillStyle = U.mix(col, '#ffffff', 0.7); c.beginPath(); c.arc(0, 0, r * 0.62, 0, U.TAU); c.fill();
          c.fillStyle = '#ffffff'; c.beginPath(); c.arc(-r * 0.15, -r * 0.15, r * 0.3, 0, U.TAU); c.fill();
        }
      }
      c.restore();
    }
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
  function drawLighting(c, view, room, biome, local, t, ox, oy) {
    const P = biome.pal, ll = R.lightLevel, s = R.scale;
    const amb = R.ambient(biome, (1 - ll) * 0.1, view.pact > 0 ? Math.min(0.5, view.pact * 0.05) : 0);
    R.lightBegin(amb);
    const gm = ED.Tiles.glowmap(room, s);
    if (gm) { lctx.globalAlpha = 0.5; lctx.drawImage(gm, ox / R.lightDiv, oy / R.lightDiv, gm.width / gm.px * s / R.lightDiv, gm.height / gm.px * s / R.lightDiv); lctx.globalAlpha = 1; }
    rimN = 0;
    const src = rimAdd;
    // hero lanterns: warm core plus a wider tinted fill; radius shrinks by at most 15% and flickers as the lantern fails
    for (const p of view.players.values()) {
      if (p.dead) continue;
      const base = (p.stats ? p.stats.lightR : 175) * (p.downed ? 0.6 : 1) * (0.85 + 0.15 * ll);
      const fl = 1 + Math.sin(t * 7 + (p.slot || 0)) * 0.03 + Math.sin(t * 19 + (p.slot || 0) * 2) * 0.02 * (1 + (1 - ll) * 3);
      const col = U.mix('#ffc27a', ED.PLAYER_COLORS[p.slot] || '#ffc27a', 0.12);
      R.lightAdd(p.x * s + ox, (p.y - 10) * s + oy, base * 1.15 * fl * s, U.mix(col, P.light, 0.2), 0.9);
      R.lightAdd(p.x * s + ox, (p.y - 10) * s + oy, base * 0.52 * fl * s, '#ffd9a0', 0.45);
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
      R.lightAdd(d.x * s + ox, d.y * s + oy, r * s, d.color, k);
      if (d.k === 'torch') src(d.x, d.y, r, d.color, k);
    }
    for (const e of view.enemies) {
      if (e.hp <= 0 || !(e.boss || e.elite)) continue;
      R.light(e.x, e.y - e.r, e.r * (e.boss ? 5 : 4), e.boss ? e.def.col.c : ED.AFFIXES[e.elite].color, e.boss ? 0.6 : 0.5);
    }
    for (let i = 0; i < nl; i++) {
      const L = lights[i];
      R.lightAdd(L.x * s + ox, L.y * s + oy, L.r * s, L.c, L.k);
      if (L.k * L.r >= 60) src(L.x, L.y, L.r, L.c, L.k);
    }
    R.lightEnd(c);
  }

  // ---------------- overhead info (names, bars, prompts) ----------------
  function drawOverheads(c, view, local, t) {
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (view.room) drawDoorPreviews(c, view, view.room, t);
    // enemy bars
    for (const e of view.enemies) {
      if (e.hp <= 0 || e.boss || e.burrowed) continue;
      const frac = e.hp / e.maxHp;
      if (frac >= 0.999 && !e.elite) continue;
      const w = e.elite ? 30 : 18, y = e.y - e.r * 2.6 - (e.def.fly ? 14 : 4);
      c.fillStyle = 'rgba(0,0,0,0.72)'; c.fillRect(e.x - w / 2 - 1, y - 1, w + 2, 4);
      const bc = e.elite ? ED.AFFIXES[e.elite].color : '#e2513f';
      c.fillStyle = U.shade(bc, -0.35); c.fillRect(e.x - w / 2, y, w, 2);
      c.fillStyle = bc; c.fillRect(e.x - w / 2, y, w * frac, 2);
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(e.x - w / 2, y, w * frac, 0.8);
      if (e.ward > 0) { c.fillStyle = '#7fc8ff'; c.fillRect(e.x - w / 2, y - 3, w * (e.ward / (e.wardMax || 1)), 1.5); }
      if (e.elite) {
        c.font = '800 7px "Alegreya Sans", sans-serif';
        c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,0.85)';
        const label = ED.AFFIXES[e.elite].name + ' ' + e.def.name;
        c.strokeText(label, e.x, y - 6); c.fillStyle = ED.AFFIXES[e.elite].color; c.fillText(label, e.x, y - 6);
      }
    }
    // hero names & revive rings
    const multi = view.players.size > 1;
    for (const p of view.players.values()) {
      const col = ED.PLAYER_COLORS[p.slot] || '#fff';
      if (multi && !p.dead) {
        c.font = '800 7px "Alegreya Sans", sans-serif'; c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,0.85)';
        c.strokeText(p.name, p.x, p.y - 44); c.fillStyle = col; c.fillText(p.name, p.x, p.y - 44);
        if (p.pid !== local) { const fr = p.hp / p.maxHp; c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(p.x - 11, p.y - 39, 22, 3); c.fillStyle = fr > 0.35 ? '#86d38f' : '#e2513f'; c.fillRect(p.x - 10.5, p.y - 38.5, 21 * fr, 2); }
      }
      if (p.downed) {
        c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y - 8, 20, 0, U.TAU); c.stroke();
        c.strokeStyle = '#86d38f'; c.beginPath(); c.arc(p.x, p.y - 8, 20, -Math.PI / 2, -Math.PI / 2 + U.TAU * (p.revive || 0)); c.stroke();
        c.font = '800 7px "Alegreya Sans", sans-serif'; c.fillStyle = '#ff8a7a'; c.fillText(p.pid === local ? 'DOWN' : 'REVIVE', p.x, p.y - 34);
      }
    }
    // nearest sign within reach (one at a time); the HUD draws its text in screen space with the current key bindings
    const me = view.players.get(local);
    let sign = null, sd = 90 * 90;
    if (me) for (const p of view.props) { if (p.kind === 'sign') { const d = U.dist2(p.x, p.y, me.x, me.y); if (d < sd) { sd = d; sign = p; } } }
    R.sign = sign;
  }
})(globalThis.ED || (globalThis.ED = {}));
