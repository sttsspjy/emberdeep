// ED.Batch: the renderer's only drawing API (ARCHITECTURE §10). Two backends implement the same calls; B.use('gl' | '2d') swaps them in place (callers keep calling ED.Batch.*):
//  'gl': WebGL instanced quads on post.js's context into a world-size FBO texture (B.out) that Post.render composites. One program draws sprites, text and shapes (SDF rect / disc / ring /
//        cone / soft ellipse); premultiplied blending lets normal and additive instances share a draw, so a frame is one draw per texture switch (atlas pages are packed into one texture).
//        Flash, tint and the 'grey' / 'frozen' variants are shader work; 'pal:*' / 'outline:*' variant sheets (ED.Atlas.variant), runtime pages (ED.Pix.define), font and small img() sources
//        are uploaded once into a dynamic region of the atlas texture (shelf allocator, reset when full); large img() sources (floor chunks) get their own textures.
//  '2d': Canvas2D through ED.Atlas.draw with crowd LOD (above LOD_CROWD foes on screen: no shadows, no partial flashes), zone LOD (zcirc / zflush) and view-rect culling.
// Coordinates are world px; begin() sets the camera. Colours: rgba = 0xRRGGBBAA (unsigned), tint / text colour = 0xRRGGBB. Callers y-sort; the batch draws in call order.
// B.ctx: the 2D context to draw on directly (2d: the world buffer; gl: a transparent bridge canvas uploaded and composited in call order at the next Batch call; costs one upload per use).
(function (ED) {
  'use strict';
  const LOD_CROWD = 250, PI = Math.PI;
  // zoneLoad / zoneN / zoneLite: own-team zone coverage (sum of disc areas / view area), count and the 2D zone LOD flag, set by render.js each frame for the zone hooks.
  // zoneUnion: zcirc batches union paths (render.js sets it when the 2D canvas is software-rasterised).
  const B = ED.Batch = { mode: '2d', crowd: 0, stats: { spr: 0, shapes: 0, draws: 0, inst: 0 }, out: { tex: null, w: 0, h: 0 }, glError: '', zoneLoad: 0, zoneN: 0, zoneLite: false, zoneUnion: false };
  let c = null, sc = 1, cx = 0, cy = 0, vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0;
  const css = new Map(), hex = new Map();
  // 0xRRGGBBAA -> CSS colour (cached).
  const rgbaCss = (v) => {
    let s = css.get(v);
    if (s === undefined) { v >>>= 0; s = 'rgba(' + (v >>> 24) + ',' + ((v >>> 16) & 255) + ',' + ((v >>> 8) & 255) + ',' + ((v & 255) / 255).toFixed(3) + ')'; if (css.size > 512) css.clear(); css.set(v, s); }
    return s;
  };
  const hexCss = (v) => { let s = hex.get(v); if (s === undefined) { s = '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0'); if (hex.size > 512) hex.clear(); hex.set(v, s); } return s; };
  B.rgbaCss = rgbaCss; B.hexCss = hexCss;
  const viewRect = (camX, camY, w, h) => { vx0 = camX - 2; vy0 = camY - 2; vx1 = camX + w / sc + 2; vy1 = camY + h / sc + 2; };

  // ---- pixel geometry, shared by both backends: shapes are hard-edged at world px (no AA), a pixel is in a shape when its centre is ----
  // Discs / rings / cones: outer diameter D = round(2r + lw) px (lw rounded, >= 1 px), centred on a pixel (odd D) or a pixel corner (even D); a ring is the outer lw px of the disc.
  // Lines: width round(lw) (>= 1), ends snapped like D; widths <= 3 px are measured along the minor axis (exactly lw px per column / row, Bresenham-like).
  // Rects: edges rounded to whole px. Shadows: ellipse rx x 0.4 rx on a whole px centre.
  const snap = (v, d) => ((d & 1) ? Math.floor(v) + 0.5 : Math.round(v));
  const lwPx = (lw) => (lw > 0 ? Math.max(1, Math.round(lw)) : 0);
  let gx = 0, gy = 0, gr = 0, gw = 0; // circGeo out: centre, outer radius, ring width (0 = fill)
  function circGeo(x, y, r, lw) { let l = lwPx(lw); const d = Math.max(1, Math.round(2 * r + l)); if (2 * l >= d) l = 0; gr = d / 2; gw = l; gx = snap(x, d); gy = snap(y, d); }
  let lx0 = 0, ly0 = 0, lc = 1, ls = 0, lhl = 0, lht = 0, lmx = 0, lmy = 0; // lineGeo out: snapped start, direction, half length (ends inclusive), half thickness, midpoint
  function lineGeo(x0, y0, x1, y1, lw) {
    const l = Math.max(1, Math.round(lw)); x0 = snap(x0, l); y0 = snap(y0, l); x1 = snap(x1, l); y1 = snap(y1, l);
    const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
    lx0 = x0; ly0 = y0; lc = len > 0 ? dx / len : 1; ls = len > 0 ? dy / len : 0; lhl = len / 2 + 0.49; lmx = (x0 + x1) / 2; lmy = (y0 + y1) / 2;
    lht = l <= 3 ? l / 2 * Math.max(Math.abs(lc), Math.abs(ls)) : l / 2;
  }
  // Pie SDF (same as the WebGL shader): local frame along the cone axis (lx) / across it (ly), radius R, half-arc sin / cos sh, ch.
  function pieD(lx, ly, R, sh, ch) {
    const px = Math.abs(ly), py = lx, l1 = Math.sqrt(px * px + py * py) - R, t = Math.max(0, Math.min(R, px * sh + py * ch)), mx = px - sh * t, my = py - ch * t;
    return Math.max(l1, Math.sqrt(mx * mx + my * my) * Math.sign(ch * px - sh * py));
  }

  // Target: the 2D context of the world buffer (render.js).
  B.init = (ctx) => { c = ctx; };
  Object.defineProperty(B, 'ctx', { get: () => (B.mode === 'gl' ? bridgeCtx() : c), enumerable: true });

  // ================= Canvas2D backend =================
  const D = {};
  // Camera: world (camX, camY) maps to the target's top-left; scale = target px per world px; bg (0xRRGGBB, optional) clears the target first.
  D.begin = (camX, camY, scale, bg) => {
    sc = scale || 1; cx = camX; cy = camY;
    if (bg !== undefined) { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = hexCss(bg); c.fillRect(0, 0, c.canvas.width, c.canvas.height); }
    c.setTransform(sc, 0, 0, sc, -cx * sc, -cy * sc);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    viewRect(camX, camY, c.canvas.width, c.canvas.height);
    B.stats.spr = 0; B.stats.shapes = 0; B.stats.draws = 0; B.stats.inst = 0;
  };
  D.end = () => { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; };
  // Global alpha multiplier (0..1) for every following draw until the next fade() or begin().
  D.fade = (k) => { c.globalAlpha = k; };

  const AO = { flip: false, alpha: 1, rot: 0, variant: '' };
  // Sprite: frame `frame` of atlas anim `id` with its pivot at (x, y). o: { flip, flash (0..1 white), alpha, rot (rad), sx, sy (scale about the pivot), tint (0xRRGGBB multiply; gl only), add (additive), variant (Atlas variant key) }.
  // Returns false when the art is missing (callers draw a fallback); true when drawn or culled.
  D.spr = (id, frame, x, y, o) => {
    const A = ED.Atlas; if (!A.ok) return false;
    const m = o ? Math.max(Math.abs(o.sx || 1), Math.abs(o.sy || 1)) * 96 : 96;
    if (x < vx0 - m || x > vx1 + m || y < vy0 - m || y > vy1 + m) return A.has(id);
    B.stats.spr++;
    AO.flip = !!(o && o.flip); AO.alpha = o && o.alpha !== undefined ? o.alpha : 1; AO.rot = (o && o.rot) || 0;
    const fl = (o && o.flash) || 0, add = o && o.add, scaled = o && ((o.sx && o.sx !== 1) || (o.sy && o.sy !== 1));
    AO.variant = fl >= 0.5 || (fl > 0 && B.crowd > LOD_CROWD) ? 'white' : (o && o.variant) || '';
    if (add) c.globalCompositeOperation = 'lighter';
    let ok;
    if (scaled) { c.save(); c.translate(Math.round(x), Math.round(y)); c.scale(o.sx || 1, o.sy || 1); ok = A.draw(c, id, frame, 0, 0, AO); c.restore(); }
    else ok = A.draw(c, id, frame, x, y, AO);
    if (ok && fl > 0 && fl < 0.5 && B.crowd <= LOD_CROWD) { // partial flash: white overlay at the flash level
      AO.variant = 'white'; AO.alpha *= fl * 2;
      if (scaled) { c.save(); c.translate(Math.round(x), Math.round(y)); c.scale(o.sx || 1, o.sy || 1); A.draw(c, id, frame, 0, 0, AO); c.restore(); } else A.draw(c, id, frame, x, y, AO);
    }
    if (add) c.globalCompositeOperation = 'source-over';
    return ok;
  };
  // Shapes are scan-converted into whole-px rects of one path (axis-aligned integer rects rasterise without AA) and filled once, so a shape never blends with itself.
  // Run merger: a row span equal to the slot's span on the row above extends that rect downwards; slot = span index within the row.
  const RN = 4, RUN = new Float64Array(RN * 4); // per slot: x0, x1 (inclusive px), y0, rows
  let rx0 = 0, rx1 = 0, ry0 = 0, ry1 = 0, pt = null; // clip rect in whole px (view rect); pt: rect target (the context or a Path2D being built)
  function runPut(s, x0, x1, y) {
    if (x0 < rx0) x0 = rx0; if (x1 > rx1) x1 = rx1; if (x0 > x1) return;
    if (s >= RN) { pt.rect(x0, y, x1 - x0 + 1, 1); return; }
    const o = s * 4;
    if (RUN[o + 3] > 0 && RUN[o] === x0 && RUN[o + 1] === x1 && RUN[o + 2] + RUN[o + 3] === y) { RUN[o + 3]++; return; }
    if (RUN[o + 3] > 0) pt.rect(RUN[o], RUN[o + 2], RUN[o + 1] - RUN[o] + 1, RUN[o + 3]);
    RUN[o] = x0; RUN[o + 1] = x1; RUN[o + 2] = y; RUN[o + 3] = 1;
  }
  function runEnd() { for (let o = 0; o < RN * 4; o += 4) if (RUN[o + 3] > 0) { pt.rect(RUN[o], RUN[o + 2], RUN[o + 1] - RUN[o] + 1, RUN[o + 3]); RUN[o + 3] = 0; } }
  const clipRows = () => { rx0 = Math.floor(vx0); rx1 = Math.ceil(vx1); ry0 = Math.floor(vy0); ry1 = Math.ceil(vy1); pt = c; };
  const FR = { rect: (x, y, w, h) => c.fillRect(x, y, w, h) }; // rect target: direct fillRect (a shape's rects never overlap)
  const fillBegin = (css) => { clipRows(); c.fillStyle = css; pt = FR; };
  const fillEnd = () => { runEnd(); pt = c; };
  // Disc / ring spans of circGeo's output (gx, gy, gr, gw) into the open path.
  function circSpans() {
    const R = gr, R2 = R * R, Ri = R - gw, Ri2 = Ri * Ri, ya = Math.max(ry0, Math.ceil(gy - R - 0.5)), yb = Math.min(ry1, Math.floor(gy + R - 0.5));
    for (let y = ya; y <= yb; y++) {
      const dy = y + 0.5 - gy, h2 = R2 - dy * dy; if (h2 < 0) continue;
      const hw = Math.sqrt(h2), x0 = Math.ceil(gx - hw - 0.5), x1 = Math.floor(gx + hw - 0.5); if (x0 > x1) continue;
      const i2 = Ri2 - dy * dy;
      if (gw > 0 && Ri > 0 && i2 >= 0) {
        const hi = Math.sqrt(i2), i0 = Math.ceil(gx - hi - 0.5), i1 = Math.floor(gx + hi - 0.5);
        if (i0 <= i1) { runPut(0, x0, i0 - 1, y); runPut(1, i1 + 1, x1, y); continue; }
      }
      runPut(0, x0, x1, y);
    }
  }
  // dx range where lo <= k * dx + q <= hi (open lower bound when lowOpen and k = 0); false when empty. Out: ia, ib.
  let ia = 0, ib = 0;
  function slab(k, q, lo, hi, lowOpen) {
    if (Math.abs(k) < 1e-9) { if (lowOpen ? q > lo && q <= hi : q >= lo && q <= hi) { ia = -1e9; ib = 1e9; return true; } return false; }
    const a = (lo - q) / k, b = (hi - q) / k; ia = Math.min(a, b); ib = Math.max(a, b); return true;
  }
  // Rotated-rect spans of lineGeo's output into the open path.
  // Per row: dx in [lo, hi] with along |lc dx + ls dy| <= lhl and across -lht < lc dy - ls dx <= lht; both bounds are linear in dy (coefficients precomputed).
  function lineSpans() {
    const ey = lhl * Math.abs(ls) + lht * Math.abs(lc), ya = Math.max(ry0, Math.floor(lmy - ey - 1)), yb = Math.min(ry1, Math.ceil(lmy + ey + 1));
    const ac = Math.abs(lc) > 1e-9, as = Math.abs(ls) > 1e-9, ic = ac ? 1 / lc : 0, is = as ? 1 / ls : 0;
    const p = -ls * ic, a0 = Math.min(-lhl * ic, lhl * ic), a1 = -a0, q = lc * is, b0 = Math.min(-lht * is, lht * is), b1 = -b0;
    for (let y = ya; y <= yb; y++) {
      const dy = y + 0.5 - lmy;
      let lo = -1e9, hi = 1e9;
      if (ac) { lo = a0 + p * dy; hi = a1 + p * dy; } else if (Math.abs(ls * dy) > lhl) continue;
      if (as) { const l2 = b0 + q * dy, h2 = b1 + q * dy; if (l2 > lo) lo = l2; if (h2 < hi) hi = h2; } else { const v = lc * dy; if (v <= -lht || v > lht) continue; }
      if (lo > hi) continue;
      runPut(0, Math.ceil(lmx + lo - 0.5), Math.floor(lmx + hi - 0.5), y);
    }
  }
  D.rect = (x, y, w, h, rgba) => {
    let x0 = Math.round(x), x1 = Math.round(x + w), y0 = Math.round(y), y1 = Math.round(y + h);
    if (x1 < x0) { const s = x0; x0 = x1; x1 = s; } if (y1 < y0) { const s = y0; y0 = y1; y1 = s; }
    if (x0 === x1 || y0 === y1 || x0 > vx1 || y0 > vy1 || x1 < vx0 || y1 < vy0) return;
    B.stats.shapes++; c.fillStyle = rgbaCss(rgba); c.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  // Disc / ring paths: circGeo's shape as a Path2D of whole-px rects with its box at (0, 0), cached by (D, width) and filled translated by whole px (one fill call per shape).
  const PATH_MAX = 1024, PC = new Map(), PM = typeof DOMMatrix !== 'undefined' ? new DOMMatrix() : null;
  function shapePath() {
    const d = gr * 2, key = d * 64 + Math.min(63, gw);
    let p = PC.get(key); if (p) return p;
    if (PC.size >= 1500) PC.clear();
    const sx = gx, sy = gy, a0 = rx0, a1 = rx1, b0 = ry0, b1 = ry1, st = pt; gx = gr; gy = gr;
    p = new Path2D(); pt = p; rx0 = -1; rx1 = d + 1; ry0 = -1; ry1 = d + 1;
    circSpans(); runEnd();
    gx = sx; gy = sy; rx0 = a0; rx1 = a1; ry0 = b0; ry1 = b1; pt = st; PC.set(key, p);
    return p;
  }
  // Disc (lw 0) or ring of width lw centred on radius r.
  D.circ = (x, y, r, rgba, lw) => {
    const e = r + (lw > 0 ? lw : 0) / 2 + 1;
    if (x + e < vx0 || x - e > vx1 || y + e < vy0 || y - e > vy1) return;
    B.stats.shapes++; circGeo(x, y, r, lw); c.fillStyle = rgbaCss(rgba);
    if (gr * 2 <= PATH_MAX) { const p = shapePath(), ox = gx - gr, oy = gy - gr; c.translate(ox, oy); c.fill(p); c.translate(-ox, -oy); return; }
    clipRows(); c.beginPath(); circSpans(); runEnd(); c.fill();
  };
  D.line = (x0, y0, x1, y1, lw, rgba) => {
    if (Math.max(x0, x1) + lw < vx0 || Math.min(x0, x1) - lw > vx1 || Math.max(y0, y1) + lw < vy0 || Math.min(y0, y1) - lw > vy1) return;
    B.stats.shapes++; lineGeo(x0, y0, x1, y1, lw);
    fillBegin(rgbaCss(rgba)); lineSpans(); fillEnd();
  };
  // Polyline through n points P[0..2n) (x, y pairs), width lw: per-segment lines (joints drawn twice, as on WebGL).
  D.poly = (P, n, lw, rgba) => {
    if (n < 2) return;
    let x0 = P[0], x1 = P[0], y0 = P[1], y1 = P[1];
    for (let i = 1; i < n; i++) { const x = P[i * 2], y = P[i * 2 + 1]; if (x < x0) x0 = x; else if (x > x1) x1 = x; if (y < y0) y0 = y; else if (y > y1) y1 = y; }
    if (x1 + lw < vx0 || x0 - lw > vx1 || y1 + lw < vy0 || y0 - lw > vy1) return;
    B.stats.shapes++; fillBegin(rgbaCss(rgba));
    for (let i = 0; i + 1 < n; i++) { lineGeo(P[i * 2], P[i * 2 + 1], P[i * 2 + 2], P[i * 2 + 3], lw); lineSpans(); runEnd(); }
    pt = c;
  };
  // Cone (sector) from (x, y), radius r, centred on angle a, arc wide: filled (lw 0) or outlined (lw px inside the sector of radius r + lw / 2). Per-pixel pie SDF inside the disc's row spans.
  D.cone = (x, y, r, a, arc, rgba, lw) => {
    const e = r + (lw > 0 ? lw : 0) / 2 + 1;
    if (r <= 0 || x + e < vx0 || x - e > vx1 || y + e < vy0 || y - e > vy1) return;
    B.stats.shapes++; fillBegin(rgbaCss(rgba)); circGeo(x, y, r, lw);
    const h = Math.min(PI, Math.max(0, arc / 2)), sh = Math.sin(h), ch = Math.cos(h), ca = Math.cos(a), sa = Math.sin(a), R = gr, w = gw;
    const ya = Math.max(ry0, Math.ceil(gy - R - 0.5)), yb = Math.min(ry1, Math.floor(gy + R - 0.5));
    // arc <= PI: convex pie = disc ∩ two edge half-planes (signed distances k1 * dx + q1, k2 * dx + q2 >= 0); an outline removes the pie shrunk by w (disc R - w, edges >= w).
    const k1 = sh * ca + ch * sa, k2 = sh * ca - ch * sa, m1 = sh * sa - ch * ca, m2 = sh * sa + ch * ca, Ri = R - w;
    for (let y = ya; y <= yb; y++) {
      const dy = y + 0.5 - gy, h2 = R * R - dy * dy; if (h2 < 0) continue;
      const hw = Math.sqrt(h2), x0 = Math.max(rx0, Math.ceil(gx - hw - 0.5)), x1 = Math.min(rx1, Math.floor(gx + hw - 0.5));
      if (h <= PI / 2) {
        let a0 = -hw, b0 = hw;
        if (!slab(k1, m1 * dy, 0, 1e9, false)) continue; if (ia > a0) a0 = ia; if (ib < b0) b0 = ib;
        if (!slab(k2, m2 * dy, 0, 1e9, false)) continue; if (ia > a0) a0 = ia; if (ib < b0) b0 = ib;
        const o0 = Math.max(x0, Math.ceil(gx + a0 - 0.5)), o1 = Math.min(x1, Math.floor(gx + b0 - 0.5)); if (o0 > o1) continue;
        const i2 = Ri * Ri - dy * dy;
        if (w > 0 && Ri > 0 && i2 >= 0) {
          let a1 = -Math.sqrt(i2), b1 = -a1, ok = slab(k1, m1 * dy, w, 1e9, false);
          if (ok) { if (ia > a1) a1 = ia; if (ib < b1) b1 = ib; ok = slab(k2, m2 * dy, w, 1e9, false); }
          if (ok) { if (ia > a1) a1 = ia; if (ib < b1) b1 = ib; }
          const i0 = Math.ceil(gx + a1 - 0.5), i1 = Math.floor(gx + b1 - 0.5);
          if (ok && i0 <= i1) { runPut(0, o0, Math.min(o1, i0 - 1), y); runPut(1, Math.max(o0, i1 + 1), o1, y); continue; }
        }
        runPut(0, o0, o1, y); continue;
      }
      let s = 0, st = 0, on = false; // arc > PI (non-convex): per-pixel pie SDF
      for (let xi = x0; xi <= x1 + 1; xi++) {
        let v = false;
        if (xi <= x1) { const dx = xi + 0.5 - gx, d = pieD(dx * ca + dy * sa, dy * ca - dx * sa, R, sh, ch); v = d <= 0 && (w <= 0 || d > -w); }
        if (v && !on) { st = xi; on = true; } else if (!v && on) { runPut(s++, st, xi - 1, y); on = false; }
      }
    }
    fillEnd();
  };
  // Zone LOD disc / ring (lw 0 = fill). With B.zoneUnion (a software-rasterised canvas): collected per colour (alpha in steps of 8) and width, then drawn by zflush()
  // as one path per bucket, fills before rings, so overlapping ground discs cost their union once; otherwise drawn at once.
  // Buckets and their coordinate arrays persist across frames (no per-frame allocation).
  const ZB = new Map();
  D.zcirc = (x, y, r, rgba, lw) => {
    if (!B.zoneUnion) { D.circ(x, y, r, rgba, lw); return; }
    if (x + r < vx0 || x - r > vx1 || y + r < vy0 || y - r > vy1) return;
    const a = Math.min(255, ((rgba & 255) + 4) & ~7); if (!a) return;
    const col = ((rgba & 0xffffff00) | a) >>> 0, w = lwPx(lw), key = col * 64 + Math.min(63, w);
    let b = ZB.get(key);
    if (!b) { b = { col, lw: w, n: 0, p: new Float32Array(96) }; ZB.set(key, b); }
    if (b.n * 3 + 3 > b.p.length) { const q = new Float32Array(b.p.length * 2); q.set(b.p); b.p = q; }
    const o = b.n++ * 3; b.p[o] = x; b.p[o + 1] = y; b.p[o + 2] = r;
  };
  // Union: every bucket is scan-converted in JS into one buffer-size RGBA layer (fills, then rings; a later bucket overwrites an earlier one where they overlap),
  // then the layer's dirty rect is put and composited once (B.fade applies). Overlaps cost nothing extra and the canvas rasterises no paths.
  let zl = null, zlc = null, zim = null, z32 = null;
  D.zflush = () => {
    const W = c.canvas.width, H = c.canvas.height;
    if (!zl || zl.width !== W || zl.height !== H) { zl = zl || document.createElement('canvas'); zl.width = W; zl.height = H; zlc = zl.getContext('2d'); zim = zlc.createImageData(W, H); z32 = new Uint32Array(zim.data.buffer); }
    let dx0 = W, dy0 = H, dx1 = -1, dy1 = -1;
    for (let pass = 0; pass < 2; pass++) for (const b of ZB.values()) {
      if (!b.n || (b.lw > 0) !== (pass === 1)) continue;
      const P = b.p, v = b.col, col = (((v & 255) << 24) | (((v >>> 8) & 255) << 16) | (((v >>> 16) & 255) << 8) | (v >>> 24)) >>> 0; // 0xRRGGBBAA -> little-endian RGBA bytes
      for (let i = 0, o = 0; i < b.n; i++, o += 3) {
        circGeo((P[o] - cx) * sc, (P[o + 1] - cy) * sc, P[o + 2] * sc, b.lw * sc);
        const R = gr, Ri = R - gw, ya = Math.max(0, Math.ceil(gy - R - 0.5)), yb = Math.min(H - 1, Math.floor(gy + R - 0.5));
        if (ya > yb) continue;
        if (ya < dy0) dy0 = ya; if (yb > dy1) dy1 = yb;
        for (let y = ya; y <= yb; y++) {
          const dy = y + 0.5 - gy, h2 = R * R - dy * dy; if (h2 < 0) continue;
          const hw = Math.sqrt(h2); let x0 = Math.max(0, Math.ceil(gx - hw - 0.5)), x1 = Math.min(W - 1, Math.floor(gx + hw - 0.5)); if (x0 > x1) continue;
          if (x0 < dx0) dx0 = x0; if (x1 > dx1) dx1 = x1;
          const row = y * W, i2 = Ri * Ri - dy * dy;
          if (gw > 0 && Ri > 0 && i2 >= 0) {
            const hi = Math.sqrt(i2), i0 = Math.ceil(gx - hi - 0.5), i1 = Math.floor(gx + hi - 0.5);
            if (i0 <= i1) { for (let x = x0; x < i0 && x <= x1; x++) z32[row + x] = col; for (let x = Math.max(x0, i1 + 1); x <= x1; x++) z32[row + x] = col; continue; }
          }
          z32.fill(col, row + x0, row + x1 + 1);
        }
      }
      B.stats.shapes++; b.n = 0;
    }
    if (ZB.size > 256) ZB.clear();
    if (dx1 < dx0) return;
    const w = dx1 - dx0 + 1, h = dy1 - dy0 + 1;
    zlc.putImageData(zim, 0, 0, dx0, dy0, w, h);
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(zl, dx0, dy0, w, h, dx0, dy0, w, h); c.setTransform(sc, 0, 0, sc, -cx * sc, -cy * sc);
    z32.fill(0, dy0 * W, (dy1 + 1) * W);
  };
  // Ground shadow (hard ellipse rx x 0.4 rx, 32 % black); skipped in a crowd.
  D.shadow = (x, y, rx) => {
    if (B.crowd > LOD_CROWD || x + rx < vx0 || x - rx > vx1 || y < vy0 || y > vy1 + rx) return;
    fillBegin('rgba(0,0,0,0.32)'); x = Math.round(x); y = Math.round(y);
    const ry = rx * 0.4, ya = Math.max(ry0, Math.ceil(y - ry - 0.5)), yb = Math.min(ry1, Math.floor(y + ry - 0.5));
    for (let row = ya; row <= yb; row++) { const dy = (row + 0.5 - y) * 2.5, h2 = rx * rx - dy * dy; if (h2 < 0) continue; const hw = Math.sqrt(h2); runPut(0, Math.ceil(x - hw - 0.5), Math.floor(x + hw - 0.5), row); }
    fillEnd();
  };
  // Canvas / ImageBitmap blitted to the world rect (floor chunks, baked effect sprites), optional alpha. A canvas whose content changes carries a `ver` number (gl re-uploads on change).
  D.img = (src, x, y, w, h, alpha) => {
    if (!src || x > vx1 || y > vy1 || x + w < vx0 || y + h < vy0) return;
    x = Math.round(x); y = Math.round(y);
    c.imageSmoothingEnabled = false;
    if (alpha !== undefined && alpha !== 1) { const ga = c.globalAlpha; c.globalAlpha = ga * alpha; c.drawImage(src, x, y, w, h); c.globalAlpha = ga; } else c.drawImage(src, x, y, w, h);
  };
  // Pixel-font text at (x, y) (centre; align 'l' / 'r'), k world px per font px, colour 0xRRGGBB.
  D.text = (s, x, y, color, k, align, alpha) => {
    const A = ED.Atlas;
    if (A.font && A.covers(s)) return A.text(c, s, x, y, hexCss(color), k || 1, align, alpha);
    c.font = Math.round(8 * (k || 1)) + 'px "Pixel Operator", monospace'; c.textAlign = align === 'l' ? 'left' : align === 'r' ? 'right' : 'center'; c.textBaseline = 'middle';
    const ga = c.globalAlpha; if (alpha !== undefined) c.globalAlpha = alpha;
    c.fillStyle = hexCss(color); c.fillText(s, x, y); c.globalAlpha = ga;
    return true;
  };

  // ================= WebGL backend =================
  const G = {};
  const STRIDE = 14, CAP = 32768, SW = 1024, DYN_W = 1024, DYN_AREA = 192 * 192, DYN_SIDE = 512;
  const K_SPR = 0, K_RECT = 1, K_CIRC = 2, K_CONE = 3, K_SHADOW = 4, K_LINE = 5;
  const ab = new ArrayBuffer(CAP * STRIDE * 4), f32 = new Float32Array(ab), u32 = new Uint32Array(ab);
  let gl = null, gl2 = false, ext = null, glGen = -1, failGen = -2, prog = null, UL = null, cornerBuf = null, instBuf = null;
  let mainTex = null, TW = 0, TH = 0, packed = false, packFail = false, fbo = null, fboTex = null, tw = 0, th = 0;
  let base = 0, n = 0, curTex = null, curTW = 1, curTH = 1, frameN = 0, dgen = 0, dynY = 0, seg = false, segVer = 0, bridge = null, bctx2 = null, fadeK = 1;
  const shelves = [], regs = new Map(), FG = {}, textCache = new Map(), bridgeKey = { bridge: true };
  let fontCv = null;

  const VS = `attribute vec2 corner;attribute vec4 a0;attribute vec4 a1;attribute vec4 a2;attribute vec4 col;attribute vec4 misc;
uniform vec2 cam,vsz,tinv;
varying vec2 vuv,vl;varying vec4 vcol,vp,vx;
void main(){
  vec2 l=a0.zw+corner*a1.xy;
  float c=cos(a1.z),s=sin(a1.z);
  vec2 p=a0.xy+vec2(l.x*c-l.y*s,l.x*s+l.y*c)-cam;
  gl_Position=vec4(p/vsz*2.-1.,0.,1.);
  vuv=mix(a2.xy,a2.zw,corner)*tinv;vl=l;vp=a2;vcol=col;vx=vec4(misc.x,misc.y/255.,misc.z,misc.w);
}`;
  // vx: kind, flash, additive, variant mode (1 grey, 2 frozen). Shapes: vl = local px from the pivot in the shape frame (at the world-px fragment centre), vp = shape params;
  // hard edges (on / off per pixel, no AA), same tests as the Canvas2D scan conversion: rect |vl| <= half size; disc / pie d <= 0 (ring / outline: d > -width); shadow ellipse; line slab.
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D tex;
varying vec2 vuv,vl;varying vec4 vcol,vp,vx;
void main(){
  float k=vx.x,a;vec3 rgb;
  if(k<.5){
    vec4 t=texture2D(tex,vuv);rgb=t.rgb;
    if(vx.w>.5){float l=dot(rgb,vec3(.299,.587,.114));
      if(vx.w<1.5)rgb=vec3((22.+l*190.)/255.);
      else{float q=min(1.,l*1.2);rgb=q>.82?vec3(.922,.973,1.):vec3(30.+q*190.,70.+q*170.,110.+q*145.)/255.;}}
    rgb=mix(rgb,vec3(1.),vx.y)*vcol.rgb;a=t.a*vcol.a;
  }else{
    bool on;rgb=vcol.rgb;
    if(k<1.5)on=abs(vl.x)<=vp.x&&abs(vl.y)<=vp.y;
    else if(k<3.5){float d;
      if(k<2.5)d=length(vl)-vp.x;
      else{vec2 p=vec2(abs(vl.y),vl.x),cs=vec2(sin(vp.z),cos(vp.z));
        float l1=length(p)-vp.x,m=length(p-cs*clamp(dot(p,cs),0.,vp.x));
        d=max(l1,m*sign(cs.y*p.x-cs.x*p.y));}
      on=d<=0.&&(vp.y<=0.||d>-vp.y);}
    else if(k<4.5)on=length(vl*vec2(1.,2.5))<=vp.x;
    else on=abs(vl.x)<=vp.x&&vl.y>-vp.y&&vl.y<=vp.y;
    a=on?vcol.a:0.;
  }
  gl_FragColor=vec4(rgb*a,a*(1.-vx.z));
}`;
  const ATTR = ['corner', 'a0', 'a1', 'a2', 'col', 'misc'];

  const divisor = (loc, d) => (gl2 ? gl.vertexAttribDivisor(loc, d) : ext.vertexAttribDivisorANGLE(loc, d));
  const drawInst = (cnt) => (gl2 ? gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cnt) : ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, cnt));
  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('batch shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function newTex(filter) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  // Builds program and buffers on post.js's context (generation Post.gen). False when WebGL or instancing is unavailable.
  function glSetup() {
    const P = ED.Post, g = P && P.gl ? P.gl() : null;
    failGen = P ? P.gen : -2;
    if (!g || g.isContextLost()) return false;
    try {
      gl = g; gl2 = typeof WebGL2RenderingContext !== 'undefined' && g instanceof WebGL2RenderingContext;
      ext = gl2 ? null : g.getExtension('ANGLE_instanced_arrays');
      if (!gl2 && !ext) throw new Error('no instancing');
      if (g.getParameter(g.MAX_TEXTURE_SIZE) < 2048) throw new Error('max texture size < 2048');
      const p = g.createProgram();
      g.attachShader(p, shader(g.VERTEX_SHADER, VS)); g.attachShader(p, shader(g.FRAGMENT_SHADER, FS));
      ATTR.forEach((a, i) => g.bindAttribLocation(p, i, a));
      g.linkProgram(p);
      if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error('batch link: ' + g.getProgramInfoLog(p));
      prog = p; UL = { cam: g.getUniformLocation(p, 'cam'), vsz: g.getUniformLocation(p, 'vsz'), tinv: g.getUniformLocation(p, 'tinv'), tex: g.getUniformLocation(p, 'tex') };
      cornerBuf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, cornerBuf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), g.STATIC_DRAW);
      instBuf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, instBuf); g.bufferData(g.ARRAY_BUFFER, ab.byteLength, g.STREAM_DRAW);
      regs.clear(); packed = false; packFail = false; mainTex = null; fbo = null; fboTex = null; tw = th = 0; B.out.tex = null;
      glGen = P.gen; B.glError = '';
      return true;
    } catch (err) { B.glError = String(err && err.message || err); gl = null; return false; }
  }
  const glReady = () => !!gl && glGen === ED.Post.gen && !gl.isContextLost();

  // Packs the decoded atlas pages (shelves, tallest first) into the left SW px of one texture; the right DYN_W px are the dynamic region.
  function pack() {
    const A = ED.Atlas, art = ED.ART, names = Object.keys(art && art.pages || {}).filter((k) => A.pages[k]);
    names.sort((a, b) => A.pages[b].height - A.pages[a].height);
    let x = 0, y = 0, rowH = 0, sw = SW;
    for (const k of names) sw = Math.max(sw, A.pages[k].width);
    const pos = [];
    for (const k of names) {
      const p = A.pages[k];
      if (x + p.width > sw) { x = 0; y += rowH + 1; rowH = 0; }
      pos.push([k, x, y]); x += p.width + 1; rowH = Math.max(rowH, p.height);
    }
    const need = y + rowH, max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    TW = sw + DYN_W; TH = max >= 4096 ? 4096 : 2048; while (TH < need) TH *= 2;
    if (TW > max || TH > max) { packFail = true; B.glError = 'atlas does not fit a ' + max + ' px texture'; return false; }
    mainTex = newTex(gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TW, TH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, px, py] of pos) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, gl.RGBA, gl.UNSIGNED_BYTE, A.pages[k]);
      regs.set(k, { kind: 0, tex: mainTex, tw: TW, th: TH, x: px, y: py, w: A.pages[k].width, h: A.pages[k].height, ver: undefined, used: 0, gen: 0 });
    }
    dynReset();
    packed = true;
    return true;
  }
  function dynReset() {
    dgen++; dynY = 0; shelves.length = 0;
    for (const [k, e] of regs) if (e.kind === 1) regs.delete(k);
  }
  // Rect of w x h (plus a 1 px gutter) in the dynamic region, or null when full.
  function dynAlloc(w, h) {
    const gw = w + 2, gh = (h + 2 + 7) & ~7;
    if (gw > DYN_W || gh > TH) return null;
    for (let i = 0; i < shelves.length; i++) { const s = shelves[i]; if (s.h === gh && s.x + gw <= DYN_W) { const x = s.x; s.x += gw; return [TW - DYN_W + x + 1, s.y + 1]; } }
    if (dynY + gh > TH) return null;
    shelves.push({ y: dynY, h: gh, x: gw });
    dynY += gh;
    return [TW - DYN_W + 1, dynY - gh + 1];
  }
  function upload(e, src, inPlace) {
    if (inPlace && curTex === e.tex && n) flush(); // queued instances may sample the old content
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    try {
      if (e.kind === 2 && (e.aw !== e.w || e.ah !== e.h)) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); e.aw = e.w; e.ah = e.h; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, e.x, e.y, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch (err) { return false; } // a closed ImageBitmap
    return true;
  }
  // Texture region holding `src` (cache key `key`; re-uploaded when `ver` changes): small sources go to the dynamic region, large ones to their own texture. Null when unusable.
  function region(key, src, ver) {
    let e = regs.get(key);
    if (e && (e.kind === 0 || (e.kind === 1 && e.gen === dgen) || e.kind === 2) && e.ver === ver) { e.used = frameN; return e; }
    const w = src.width | 0, h = src.height | 0;
    if (!(w > 0 && h > 0)) return null;
    if (e && e.kind === 2) { if (curTex === e.tex && n) flush(); e.w = w; e.h = h; e.ver = ver; e.used = frameN; e.tw = w; e.th = h; upload(e, src, true); return e; }
    if (w * h <= DYN_AREA && w <= DYN_SIDE && h <= DYN_SIDE) {
      const inPlace = !!(e && e.kind === 1 && e.gen === dgen && e.w === w && e.h === h);
      if (!inPlace) {
        let p = dynAlloc(w, h);
        if (!p) { flush(); dynReset(); p = dynAlloc(w, h); if (!p) return null; }
        e = { kind: 1, tex: mainTex, tw: TW, th: TH, x: p[0], y: p[1], w, h, ver, used: frameN, gen: dgen };
        regs.set(key, e);
      }
      e.ver = ver;
      if (!upload(e, src, inPlace)) { regs.delete(key); return null; }
      return e;
    }
    e = { kind: 2, tex: newTex(gl.NEAREST), tw: w, th: h, x: 0, y: 0, w, h, aw: 0, ah: 0, ver, used: frameN, gen: 0 };
    regs.set(key, e);
    if (!upload(e, src)) { gl.deleteTexture(e.tex); regs.delete(key); return null; }
    return e;
  }
  const pageReg = (name) => { const e = regs.get(name); if (e && (e.kind === 0 || e.kind === 2 || e.gen === dgen)) return e; const src = ED.Atlas.pages[name]; return src ? region(name, src, undefined) : null; };

  // World-size render target (LINEAR: post samples it with a sharp-bilinear upscale).
  function target(w, h) {
    if (fbo && tw === w && th === h) return;
    if (!fboTex) fboTex = newTex(gl.LINEAR); else gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (!fbo) fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    tw = w; th = h; B.out.tex = fboTex; B.out.w = w; B.out.h = h;
  }
  // GL target size in px (the world buffer size).
  B.size = (w, h) => { if (B.mode === 'gl' && glReady()) target(w, h); };

  function ptrs(off) {
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const S = STRIDE * 4;
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S, off); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S, off + 16);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, off + 32); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, S, off + 48);
    gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, false, S, off + 52);
  }
  function flush() {
    if (!n) return;
    const o = base * STRIDE, len = n * STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    if (gl2) gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, f32, o, len); else gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, f32.subarray(o, o + len));
    ptrs(o * 4);
    gl.bindTexture(gl.TEXTURE_2D, curTex); gl.uniform2f(UL.tinv, 1 / curTW, 1 / curTH);
    drawInst(n);
    B.stats.draws++; B.stats.inst += n;
    base += n; n = 0;
  }
  const setTex = (e) => { if (e.tex !== curTex) { flush(); curTex = e.tex; } curTW = e.tw; curTH = e.th; }; // an own texture re-sized in place flushed before its size changed
  function push(px, py, lx, ly, lw, lh, rot, p4, a, b, cc, d, col, misc) {
    if (base + n >= CAP) { flush(); gl.bufferData(gl.ARRAY_BUFFER, ab.byteLength, gl.STREAM_DRAW); base = 0; }
    const o = (base + n) * STRIDE; n++;
    if (fadeK < 1) col = ((col & 0x00ffffff) | (Math.round((col >>> 24) * fadeK) << 24)) >>> 0;
    f32[o] = px; f32[o + 1] = py; f32[o + 2] = lx; f32[o + 3] = ly; f32[o + 4] = lw; f32[o + 5] = lh; f32[o + 6] = rot; f32[o + 7] = p4;
    f32[o + 8] = a; f32[o + 9] = b; f32[o + 10] = cc; f32[o + 11] = d; u32[o + 12] = col; u32[o + 13] = misc;
  }
  // 0xRRGGBB + alpha byte / 0xRRGGBBAA -> little-endian RGBA bytes.
  const tintLE = (t, a) => (((t >>> 16) & 255) | (t & 0xff00) | ((t & 255) << 16) | (a << 24)) >>> 0;
  const rgbaLE = (v) => (((v >>> 24) & 255) | (((v >>> 16) & 255) << 8) | (((v >>> 8) & 255) << 16) | ((v & 255) << 24)) >>> 0;

  G.begin = (camX, camY, scale, bg) => {
    sc = scale || 1; cx = camX; cy = camY; frameN++;
    if (!tw) target(c ? c.canvas.width : 640, c ? c.canvas.height : 360);
    viewRect(camX, camY, tw, th);
    B.stats.spr = 0; B.stats.shapes = 0; B.stats.draws = 0; B.stats.inst = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, tw, th);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
    if (bg !== undefined) { gl.clearColor(((bg >>> 16) & 255) / 255, ((bg >>> 8) & 255) / 255, (bg & 255) / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.useProgram(prog); gl.uniform2f(UL.cam, camX, camY); gl.uniform2f(UL.vsz, tw / sc, th / sc); gl.uniform1i(UL.tex, 0);
    gl.activeTexture(gl.TEXTURE0); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0); divisor(0, 0);
    for (let i = 1; i < ATTR.length; i++) { gl.enableVertexAttribArray(i); divisor(i, 1); }
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, ab.byteLength, gl.STREAM_DRAW); // orphan last frame's instances
    base = 0; n = 0; curTex = mainTex; curTW = TW; curTH = TH; seg = false; fadeK = 1;
  };
  G.fade = (k) => { if (seg) closeSeg(); fadeK = k; };
  G.end = () => {
    if (seg) closeSeg();
    flush();
    for (let i = 1; i < ATTR.length; i++) { divisor(i, 0); gl.disableVertexAttribArray(i); }
    gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (frameN % 60 === 0) for (const [k, e] of regs) if (e.kind === 2 && frameN - e.used > 120) { gl.deleteTexture(e.tex); regs.delete(k); }
  };

  G.spr = (id, frame, x, y, o) => {
    if (seg) closeSeg();
    const A = ED.Atlas, r = A.anim(id); if (!r) return false;
    const i = ((frame | 0) % r.n + r.n) % r.n, f = r.f[i];
    let fl = 0, al = 1, rot = 0, sx = 1, sy = 1, tint = 0xffffff, add = 0, mode = 0, flip = false, vk = '';
    if (o) { fl = o.flash || 0; if (o.alpha !== undefined) al = o.alpha; rot = o.rot || 0; if (o.sx) sx = o.sx; if (o.sy) sy = o.sy; if (o.tint) tint = o.tint; add = o.add ? 1 : 0; flip = !!o.flip; vk = o.variant || ''; }
    if (al <= 0) return true;
    let e = null, ux = 0, uy = 0, pad = 0;
    if (vk) {
      if (vk === 'white') fl = 1; else if (vk === 'grey') mode = 1; else if (vk === 'frozen') mode = 2;
      else if (A.variant(id, vk)) { const v = r.vars && r.vars[vk]; if (v && v.src) { e = region(v, v.src, undefined); if (e) { pad = v.pad; ux = e.x + v.rects[i].x - pad; uy = e.y + v.rects[i].y - pad; } } }
    }
    if (!e) { e = pageReg(f.p); if (!e) return false; ux = e.x + f.x; uy = e.y + f.y; }
    const sw = f.w + 2 * pad, sh = f.h + 2 * pad, px = Math.round(x), py = Math.round(y);
    let lx = f.ox - r.ax - pad, u0 = ux, u1 = ux + sw;
    if (flip) { lx = -lx - sw; u0 = ux + sw; u1 = ux; }
    lx *= sx; const ly = (f.oy - r.ay - pad) * sy, lw = sw * sx, lh = sh * sy;
    const ex = Math.max(Math.abs(lx), Math.abs(lx + lw)), ey = Math.max(Math.abs(ly), Math.abs(ly + lh)), rx = rot ? ex + ey : ex, ry = rot ? rx : ey;
    if (px + rx < vx0 || px - rx > vx1 || py + ry < vy0 || py - ry > vy1) return true;
    B.stats.spr++;
    setTex(e);
    push(px, py, lx, ly, lw, lh, rot, 0, u0, uy, u1, uy + sh, tintLE(tint, Math.round(Math.min(1, al) * 255)), (K_SPR | (Math.round(Math.min(1, fl * 2) * 255) << 8) | (add << 16) | (mode << 24)) >>> 0);
    return true;
  };
  G.rect = (x, y, w, h, rgba) => {
    if (seg) closeSeg();
    let x0 = Math.round(x), x1 = Math.round(x + w), y0 = Math.round(y), y1 = Math.round(y + h);
    if (x1 < x0) { const s = x0; x0 = x1; x1 = s; } if (y1 < y0) { const s = y0; y0 = y1; y1 = s; }
    if (x0 === x1 || y0 === y1 || x0 > vx1 || y0 > vy1 || x1 < vx0 || y1 < vy0) return;
    B.stats.shapes++;
    const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
    push(x0 + hx, y0 + hy, -hx - 1, -hy - 1, 2 * hx + 2, 2 * hy + 2, 0, 0, hx, hy, 0, 0, rgbaLE(rgba), K_RECT);
  };
  G.zcirc = (x, y, r, rgba, lw) => G.circ(x, y, r, rgba, lw);
  G.zflush = () => {};
  G.circ = (x, y, r, rgba, lw) => {
    if (seg) closeSeg();
    const e = r + (lw > 0 ? lw : 0) / 2 + 1;
    if (x + e < vx0 || x - e > vx1 || y + e < vy0 || y - e > vy1) return;
    B.stats.shapes++; circGeo(x, y, r, lw);
    const ext = gr + 1;
    push(gx, gy, -ext, -ext, 2 * ext, 2 * ext, 0, 0, gr, gw, 0, 0, rgbaLE(rgba), K_CIRC);
  };
  G.line = (x0, y0, x1, y1, lw, rgba) => {
    if (seg) closeSeg();
    const dx = x1 - x0, dy = y1 - y0;
    if (dx * dx + dy * dy < 1e-4 || Math.max(x0, x1) + lw < vx0 || Math.min(x0, x1) - lw > vx1 || Math.max(y0, y1) + lw < vy0 || Math.min(y0, y1) - lw > vy1) return;
    B.stats.shapes++; lineGeo(x0, y0, x1, y1, lw);
    push(lmx, lmy, -lhl - 1, -lht - 1, 2 * lhl + 2, 2 * lht + 2, Math.atan2(ls, lc), 0, lhl, lht, 0, 0, rgbaLE(rgba), K_LINE);
  };
  G.poly = (P, n, lw, rgba) => { for (let i = 0; i + 1 < n; i++) G.line(P[i * 2], P[i * 2 + 1], P[i * 2 + 2], P[i * 2 + 3], lw, rgba); };
  G.cone = (x, y, r, a, arc, rgba, lw) => {
    if (seg) closeSeg();
    const e = r + (lw > 0 ? lw : 0) / 2 + 1;
    if (r <= 0 || x + e < vx0 || x - e > vx1 || y + e < vy0 || y - e > vy1) return;
    B.stats.shapes++; circGeo(x, y, r, lw);
    const ext = gr + 1;
    push(gx, gy, -ext, -ext, 2 * ext, 2 * ext, a, 0, gr, gw, Math.min(PI, Math.max(0, arc / 2)), 0, rgbaLE(rgba), K_CONE);
  };
  G.shadow = (x, y, rx) => {
    if (seg) closeSeg();
    if (x + rx < vx0 || x - rx > vx1 || y + rx < vy0 || y - rx > vy1) return;
    push(Math.round(x), Math.round(y), -rx - 2, -rx * 0.4 - 2, 2 * rx + 4, rx * 0.8 + 4, 0, 0, rx, 0, 0, 0, 0x52000000, K_SHADOW);
  };
  G.img = (src, x, y, w, h, alpha) => {
    if (seg) closeSeg();
    if (!src || x > vx1 || y > vy1 || x + w < vx0 || y + h < vy0) return;
    const e = region(src, src, src.ver); if (!e) return;
    setTex(e);
    const al = alpha === undefined ? 255 : Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    push(Math.round(x), Math.round(y), 0, 0, w, h, 0, 0, e.x, e.y, e.x + e.w, e.y + e.h, tintLE(0xffffff, al), K_SPR);
  };

  // White glyph sheet with a 1 px dark outline (cell (w + 2) x (h + 2), glyph at +1, +1); text tints it per instance.
  function buildFont() {
    const A = ED.Atlas, F = A.font; if (!F) return null;
    let x = 0, y = 0, rowH = 0; const W = 256;
    for (const ch in F.g) { const q = F.g[ch]; if (x + q.w + 2 > W) { x = 0; y += rowH; rowH = 0; } FG[ch] = { x, y }; x += q.w + 2; rowH = Math.max(rowH, q.h + 2); }
    const H = y + rowH, mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = Math.max(1, h); return cv; };
    const m = mk(W, H), mg = m.getContext('2d');
    for (const ch in F.g) { const q = F.g[ch]; mg.drawImage(A.pages[q.f.p], q.f.x, q.f.y, q.f.w, q.f.h, FG[ch].x + 1, FG[ch].y + 1, q.f.w, q.f.h); }
    const t = mk(W, H), tg = t.getContext('2d'), cv = mk(W, H), g = cv.getContext('2d');
    tg.drawImage(m, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#120a06'; tg.fillRect(0, 0, W, H);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) g.drawImage(t, dx, dy);
    tg.globalCompositeOperation = 'copy'; tg.drawImage(m, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#ffffff'; tg.fillRect(0, 0, W, H);
    g.drawImage(t, 0, 0);
    return cv;
  }
  // Canvas-text fallback (strings the pixel font does not cover), cached per string / colour / size.
  function textImg(s, color, k) {
    const key = s + '|' + color + '|' + k;
    let cv = textCache.get(key);
    if (!cv) {
      if (textCache.size > 64) textCache.clear();
      cv = document.createElement('canvas');
      const g = cv.getContext('2d'), font = Math.round(8 * k) + 'px "Pixel Operator", monospace';
      g.font = font; const w = Math.ceil(g.measureText(s).width) + 4, h = Math.ceil(10 * k) + 4;
      cv.width = w; cv.height = h;
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = hexCss(color); g.fillText(s, w / 2, h / 2);
      textCache.set(key, cv);
    }
    return cv;
  }
  G.text = (s, x, y, color, k, align, alpha) => {
    if (seg) closeSeg();
    const A = ED.Atlas, F = A.font; k = k || 1;
    if (!F || !A.covers(s)) {
      const cv = textImg(s, color, k), w = cv.width, h = cv.height;
      G.img(cv, align === 'l' ? x - 2 : align === 'r' ? x - w + 2 : x - w / 2, y - h / 2, w, h, alpha);
      return true;
    }
    if (!fontCv) { fontCv = buildFont(); if (!fontCv) return false; }
    const w = A.textW(s, k), py = y - F.h * k / 2;
    if (y + F.h * k < vy0 || y - F.h * k > vy1) return true;
    const e = region(fontCv, fontCv, undefined); if (!e) return false;
    setTex(e);
    let px = align === 'l' ? x : align === 'r' ? x - w : x - w / 2;
    const col = tintLE(color >>> 0, Math.round(Math.max(0, Math.min(1, alpha === undefined ? 1 : alpha)) * 255));
    for (let i = 0; i < s.length; i++) {
      const q = F.g[s[i]];
      if (!q) { px += F.space * k; continue; }
      const gp = FG[s[i]], gw = q.w + 2, gh = q.h + 2;
      if (gp) push(Math.round(px - k), Math.round(py + (q.oy - 1) * k), 0, 0, gw * k, gh * k, 0, 0, e.x + gp.x, e.y + gp.y, e.x + gp.x + gw, e.y + gp.y + gh, col, K_SPR);
      px += (q.w + F.gap) * k;
    }
    B.stats.spr++;
    return true;
  };

  // ---- B.ctx bridge (gl mode): direct 2D drawing lands on a transparent canvas composited in call order ----
  function bridgeCtx() {
    if (!bridge || bridge.width !== tw || bridge.height !== th) { bridge = bridge || document.createElement('canvas'); bridge.width = Math.max(1, tw); bridge.height = Math.max(1, th); bctx2 = bridge.getContext('2d'); }
    if (!seg) {
      seg = true;
      bctx2.setTransform(1, 0, 0, 1, 0, 0); bctx2.clearRect(0, 0, bridge.width, bridge.height);
      bctx2.globalAlpha = fadeK; bctx2.globalCompositeOperation = 'source-over';
      bctx2.setTransform(sc, 0, 0, sc, -cx * sc, -cy * sc);
    }
    return bctx2;
  }
  function closeSeg() {
    seg = false; segVer++;
    const e = region(bridgeKey, bridge, segVer); if (!e) return;
    setTex(e);
    const fk = fadeK; fadeK = 1; // the bridge content already carries the fade (globalAlpha)
    push(cx, cy, 0, 0, bridge.width / sc, bridge.height / sc, 0, 0, 0, 0, bridge.width, bridge.height, 0xffffffff, K_SPR);
    fadeK = fk;
  }

  // Checks: RGBA pixels of the last GL frame (top row first) as { w, h, data }, or null outside gl mode.
  B.readPixels = () => {
    if (B.mode !== 'gl' || !glReady() || !fbo) return null;
    const data = new Uint8Array(tw * th * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w: tw, h: th, data };
  };

  // ================= backend switch =================
  // Selects the backend; 'gl' needs post.js's WebGL context and the decoded atlas, and returns false (staying on '2d') when either is missing or setup failed.
  B.use = (m) => {
    if (m === 'gl') {
      const P = ED.Post;
      if (!glReady()) { if (!P || failGen === P.gen || !glSetup()) { B.use('2d'); return false; } }
      if (!packed) { if (packFail || !ED.Atlas.ok || !pack()) { B.use('2d'); return false; } }
      if (B.mode !== 'gl') { Object.assign(B, G); B.mode = 'gl'; }
      return true;
    }
    if (B.mode !== '2d') { if (gl && seg) seg = false; Object.assign(B, D); B.mode = '2d'; }
    return true;
  };
  Object.assign(B, D);
})(globalThis.ED || (globalThis.ED = {}));
