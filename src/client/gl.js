// ED.Batch: the renderer's only drawing API (ARCHITECTURE §10). This file holds the Canvas2D implementation; a WebGL backend implements the same calls (sprite batching per atlas page).
// Coordinates are world px; begin() sets the camera. Colours: rgba = 0xRRGGBBAA (unsigned), tint / text colour = 0xRRGGBB. Callers y-sort; the batch draws in call order.
// Canvas2D crowd LOD: with Batch.crowd > LOD_CROWD foes on screen, shadows and partial hit flashes are skipped.
(function (ED) {
  'use strict';
  const LOD_CROWD = 250;
  const B = ED.Batch = { mode: '2d', crowd: 0, stats: { spr: 0, shapes: 0 }, ctx: null };
  let c = null, sc = 1, cx = 0, cy = 0;
  const css = new Map(), hex = new Map();
  // 0xRRGGBBAA -> CSS colour (cached).
  const rgbaCss = (v) => {
    let s = css.get(v);
    if (s === undefined) { v >>>= 0; s = 'rgba(' + (v >>> 24) + ',' + ((v >>> 16) & 255) + ',' + ((v >>> 8) & 255) + ',' + ((v & 255) / 255).toFixed(3) + ')'; if (css.size > 512) css.clear(); css.set(v, s); }
    return s;
  };
  const hexCss = (v) => { let s = hex.get(v); if (s === undefined) { s = '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0'); hex.set(v, s); } return s; };
  B.rgbaCss = rgbaCss; B.hexCss = hexCss;

  // Target: the 2D context of the world buffer (render.js).
  B.init = (ctx) => { c = ctx; B.ctx = ctx; };
  // Camera: world (camX, camY) maps to the target's top-left; scale = target px per world px.
  B.begin = (camX, camY, scale) => {
    sc = scale || 1; cx = camX; cy = camY;
    c.setTransform(sc, 0, 0, sc, -cx * sc, -cy * sc);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    B.stats.spr = 0; B.stats.shapes = 0;
  };
  B.end = () => { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; };

  const AO = { flip: false, alpha: 1, rot: 0, variant: '' };
  // Sprite: frame `frame` of atlas anim `id` with its pivot at (x, y). o: { flip, flash (0..1 white), alpha, rot (rad), sx, sy (scale about the pivot), tint (0xRRGGBB multiply; ignored here), add (additive) }.
  B.spr = (id, frame, x, y, o) => {
    const A = ED.Atlas; if (!A.ok) return false;
    B.stats.spr++;
    AO.flip = !!(o && o.flip); AO.alpha = o && o.alpha !== undefined ? o.alpha : 1; AO.rot = (o && o.rot) || 0;
    const fl = (o && o.flash) || 0, add = o && o.add, scaled = o && ((o.sx && o.sx !== 1) || (o.sy && o.sy !== 1));
    AO.variant = fl >= 0.5 || (fl > 0 && B.crowd > LOD_CROWD) ? 'white' : '';
    if (add) c.globalCompositeOperation = 'lighter';
    let ok;
    if (scaled) { c.save(); c.translate(x, y); c.scale(o.sx || 1, o.sy || 1); ok = A.draw(c, id, frame, 0, 0, AO); c.restore(); }
    else ok = A.draw(c, id, frame, x, y, AO);
    if (ok && fl > 0 && fl < 0.5 && B.crowd <= LOD_CROWD) { // partial flash: white overlay at the flash level
      AO.variant = 'white'; AO.alpha *= fl * 2;
      if (scaled) { c.save(); c.translate(x, y); c.scale(o.sx || 1, o.sy || 1); A.draw(c, id, frame, 0, 0, AO); c.restore(); } else A.draw(c, id, frame, x, y, AO);
    }
    if (add) c.globalCompositeOperation = 'source-over';
    return ok;
  };
  B.rect = (x, y, w, h, rgba) => { B.stats.shapes++; c.fillStyle = rgbaCss(rgba); c.fillRect(x, y, w, h); };
  // Disc (lw 0) or ring outline of width lw.
  B.circ = (x, y, r, rgba, lw) => {
    B.stats.shapes++;
    c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
    if (lw > 0) { c.lineWidth = lw; c.strokeStyle = rgbaCss(rgba); c.stroke(); } else { c.fillStyle = rgbaCss(rgba); c.fill(); }
  };
  B.line = (x0, y0, x1, y1, lw, rgba) => { B.stats.shapes++; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineWidth = lw; c.strokeStyle = rgbaCss(rgba); c.lineCap = 'butt'; c.stroke(); };
  // Cone (sector) from (x, y), radius r, centred on angle a, arc wide: filled (lw 0) or outlined.
  B.cone = (x, y, r, a, arc, rgba, lw) => {
    B.stats.shapes++;
    c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, a - arc / 2, a + arc / 2); c.closePath();
    if (lw > 0) { c.lineWidth = lw; c.strokeStyle = rgbaCss(rgba); c.stroke(); } else { c.fillStyle = rgbaCss(rgba); c.fill(); }
  };
  // Soft ground shadow (ellipse rx wide); skipped in a crowd.
  B.shadow = (x, y, rx) => { if (B.crowd > LOD_CROWD) return; c.fillStyle = 'rgba(0,0,0,0.32)'; c.beginPath(); c.ellipse(x, y, rx, rx * 0.4, 0, 0, Math.PI * 2); c.fill(); };
  // Canvas / ImageBitmap blitted to the world rect (floor chunks). src may carry a `ver` number the GL backend uses to re-upload.
  B.img = (src, x, y, w, h) => { if (!src) return; c.imageSmoothingEnabled = false; c.drawImage(src, x, y, w, h); };
  // Pixel-font text at (x, y) (centre; align 'l' / 'r'), k world px per font px, colour 0xRRGGBB.
  B.text = (s, x, y, color, k, align, alpha) => {
    const A = ED.Atlas;
    if (A.font && A.covers(s)) return A.text(c, s, x, y, hexCss(color), k || 1, align, alpha);
    c.font = Math.round(8 * (k || 1)) + 'px "Pixel Operator", monospace'; c.textAlign = align === 'l' ? 'left' : align === 'r' ? 'right' : 'center'; c.textBaseline = 'middle';
    const ga = c.globalAlpha; if (alpha !== undefined) c.globalAlpha = alpha;
    c.fillStyle = hexCss(color); c.fillText(s, x, y); c.globalAlpha = ga;
    return true;
  };
})(globalThis.ED || (globalThis.ED = {}));
