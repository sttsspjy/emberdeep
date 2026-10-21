// Pixel-art helpers of the effects layer (client only): element ramps, luminance-ramp recolours of atlas anims and cached art-grid sprites (discs, orbs, rings, ellipses, puffs) and 2 px row fills of convex shapes (telegraph lanes and cones).
// 1 art px = 2 world px; every sprite here is baked once at art resolution and blitted at x2 with smoothing off, so nothing in the effects layer is anti-aliased except glows and light.
(function (ED) {
  'use strict';
  const U = ED.U, Bmp = ED.Bmp, K = 2;
  const Pix = ED.Pix = { K, baked: 0 };

  // ---------------- ramps ----------------
  // Element ramps, dark -> light (DESIGN-paths 1.1: fire #ff7a2a, ice #7fe3ff, lightning #ffe66b, poison #9be33c, holy #fff0c2 / #ffcf5a, shadow #a070ff, general #d9dfe8).
  const RAMP = {
    fire: ['#4a1006', '#b82c14', '#ff7a2a', '#ffc24a', '#fff4c0'],
    ice: ['#1c3358', '#3a78b0', '#7fe3ff', '#c8f6ff', '#ffffff'],
    lightning: ['#5a4010', '#c49a1c', '#ffe66b', '#fff6b0', '#ffffff'],
    poison: ['#14300c', '#3f7a18', '#9be33c', '#d2ff82', '#f6ffd8'],
    holy: ['#6a4c18', '#e0a82e', '#ffcf5a', '#fff0c2', '#ffffff'],
    shadow: ['#1c0c3a', '#5a2fb0', '#a070ff', '#c9b3ff', '#f2ecff'],
    general: ['#3c4452', '#7a8494', '#d9dfe8', '#f2f5f9', '#ffffff'],
    blood: ['#3c0610', '#9a1228', '#d43a3a', '#ff7a6a', '#ffd8d0'],
    teal: ['#0c3a30', '#2a8a70', '#7dffd9', '#c4ffee', '#ffffff'],
    gold: ['#6a4c18', '#b8861e', '#e8b43a', '#ffd36b', '#ffe9a0'], // like holy but never white: sprites that carry a lot of white keep a gold body
    smoke: ['#2a2540', '#5a5478', '#8a84a8', '#b4aed0', '#dcd8ec'],
    dust: ['#3a3224', '#6a5c44', '#a89870', '#d4c8a0', '#f0e8c8'],
  };
  Pix.RAMP = RAMP;
  const custom = {}; let nCustom = 0;
  // Ramp of a name or of any '#rrggbb' colour (built once, shaded around the colour).
  Pix.ramp = (k) => {
    if (RAMP[k]) return RAMP[k];
    let r = custom[k];
    if (!r) { if (++nCustom > 120) { for (const q in custom) delete custom[q]; nCustom = 1; } r = custom[k] = [U.shade(k, -0.68), U.shade(k, -0.36), k, U.mix(k, '#ffffff', 0.45), U.mix(k, '#ffffff', 0.85)]; }
    return r;
  };
  const s2 = Pix.s2 = (v) => Math.round(v * 0.5) * 2; // world px -> the art grid

  // ---------------- recoloured atlas anims ----------------
  // art.pal (sorted dark -> light) exists for bodies and projectiles only; for fx.* anims it is read from the pixels once. A variant then maps each palette colour to the ramp by luminance rank.
  const lum = (h) => { const c = U.hexToRgb(h); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255; };
  let sg = null;
  function ensurePal(id) {
    const art = ED.ART, At = ED.Atlas;
    if (!art) return false;
    if (art.pal && art.pal[id]) return true;
    const r = At.anim(id); if (!r) return false;
    if (!sg) sg = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const seen = new Set();
    for (const f of r.f) {
      if (!f.w || !f.h) continue;
      sg.canvas.width = f.w; sg.canvas.height = f.h; sg.imageSmoothingEnabled = false;
      sg.drawImage(At.pages[f.p], f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      const d = sg.getImageData(0, 0, f.w, f.h).data;
      for (let o = 0; o < d.length; o += 4) if (d[o + 3] > 0) seen.add((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]);
    }
    const list = []; for (const v of seen) list.push('#' + (0x1000000 + v).toString(16).slice(1));
    list.sort((a, b) => lum(a) - lum(b));
    (art.pal || (art.pal = {}))[id] = list;
    return true;
  }
  const mapper = (rampKey) => (pal) => {
    const ramp = Pix.ramp(rampKey), m = {}, L = [];
    let lo = 1, hi = 0;
    for (const h of pal) { if (h === '#222222') continue; const l = lum(h); L.push(l); if (l < lo) lo = l; if (l > hi) hi = l; }
    let i = 0;
    for (const h of pal) {
      if (h === '#222222') continue;
      const t = hi > lo ? (L[i++] - lo) / (hi - lo) : 0.6, p = t * (ramp.length - 1), a = Math.min(ramp.length - 2, p | 0);
      m[h] = U.mix(ramp[a], ramp[a + 1], p - a);
    }
    return m;
  };
  const varKey = new Map();
  // Registers the recolour of anim `id` through ramp `ramp` (name or colour) and returns its Atlas variant key ('' when the anim is missing).
  Pix.variant = (id, ramp) => {
    if (!ramp) return '';
    const k = id + '|' + ramp;
    let v = varKey.get(k);
    if (v !== undefined) return v;
    v = '';
    if (ED.Atlas.has(id) && ensurePal(id)) { const key = 'pal:' + ramp; if (ED.Atlas.variant(id, key, mapper(ramp))) v = key; }
    if (v || ED.Atlas.ok) varKey.set(k, v); // a missing atlas is not remembered: the page may still be decoding
    return v;
  };
  // Registers a runtime-baked anim `id` from canvas cv (art px; an array of equal-sized canvases makes a multi-frame anim at fps, looping when loop) with pivot (ax, ay) and anchors, so the atlas draws, rotates and recolours it like packed art. False without an atlas; an id already defined stays as it is.
  Pix.define = (id, cv, ax, ay, anchors, fps, loop) => {
    const art = ED.ART, At = ED.Atlas;
    if (!art || !At || !At.ok) return false;
    if (art.anims[id]) return true;
    const cvs = Array.isArray(cv) ? cv : [cv], f = [];
    cvs.forEach((cn, i) => {
      const pg = i ? 'rt:' + id + '#' + i : 'rt:' + id, fk = id + '#' + i;
      At.pages[pg] = cn;
      art.frames[fk] = { p: pg, x: 0, y: 0, w: cn.width, h: cn.height, ox: 0, oy: 0 }; f.push(fk);
      Bmp.from(cn, (b) => { if (At.pages[pg] === cn) At.pages[pg] = b; else Bmp.free(b); }); // the page becomes an ImageBitmap once decoded (cheap blits on Gecko)
    });
    art.anims[id] = { f, fps: fps || 1, loop: !!loop, fw: cvs[0].width, fh: cvs[0].height, ax, ay, anchors: anchors || {} };
    Pix.baked += cvs.length;
    return true;
  };
  const OP = { flip: false, variant: '', alpha: 1, rot: 0, anchor: undefined };
  // Draws frame i of anim `id` (optionally recoloured through `ramp`, mirrored, rotated clockwise by rot radians in 32 steps about its anchor) with the anim's pivot at world (x, y). False when the art is missing.
  Pix.draw = (c, id, ramp, i, x, y, alpha, flip, rot, anchor) => {
    OP.variant = ramp ? Pix.variant(id, ramp) : ''; OP.alpha = alpha === undefined ? 1 : alpha; OP.flip = !!flip; OP.rot = rot || 0; OP.anchor = anchor;
    return ED.Atlas.draw(c, id, i, x, y, OP);
  };

  // ---------------- baked art-grid sprites ----------------
  const cache = new Map(); let nCache = 0, nPx = 0;
  const px32 = (h) => { const c = U.hexToRgb(h); return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0; };
  Pix.px32 = px32;
  // Cached sprite of w x h art px: fill(buf32, w, h) writes packed ABGR pixels. Returns a holder { v, w, h, ox, oy }; v is the canvas until its ImageBitmap is ready.
  Pix.bake = (key, w, h, ox, oy, fill) => {
    let s = cache.get(key); if (s) return s;
    if (nCache >= 700 || nPx > 4e6) { for (const q of cache.values()) Bmp.drop(q); cache.clear(); nCache = 0; nPx = 0; } // bounded by count and by pixels (a held sprite may be drawn one more frame: Bmp frees late)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), im = g.createImageData(w, h);
    fill(new Uint32Array(im.data.buffer), w, h);
    g.putImageData(im, 0, 0);
    s = Bmp.hold(cv); s.w = w; s.h = h; s.ox = ox; s.oy = oy;
    cache.set(key, s); nCache++; nPx += w * h; Pix.baked++;
    return s;
  };
  // The cached holder of `key` (undefined once the cache dropped it): long-lived effects keep keys, never holders.
  Pix.get = (key) => cache.get(key);
  // Blits holder s with its origin at world (x, y) (already on the grid), nearest sampling.
  Pix.put = (c, s, x, y, alpha) => {
    const ga = c.globalAlpha;
    c.imageSmoothingEnabled = false;
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = ga * alpha;
    c.drawImage(s.v, Math.round(x - s.ox * K), Math.round(y - s.oy * K), s.w * K, s.h * K);
    c.globalAlpha = ga; c.imageSmoothingEnabled = true;
  };

  // Orb of radius rArt (art px) with a 1 px rim and three concentric tones (c1 outer, c2, c3 core); the origin is the centre.
  Pix.orb = (rArt, rim, c1, c2, c3) => {
    const R = Math.max(2, rArt), S = 2 * R;
    return Pix.bake('o|' + R + rim + c1 + c2 + c3, S, S, R, R, (b, w) => {
      const a = px32(rim), q = px32(c1), m = px32(c2), z = px32(c3);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - R, y + 0.5 - R);
        if (d > R) continue;
        b[y * w + x] = d > R - 1 ? a : d > R * 0.55 ? q : d > R * 0.3 ? m : z;
      }
      if (R > 2) b[(R - 2) * w + R - 2] = px32('#ffffff');
    });
  };
  // Filled disc (one colour), origin = centre.
  Pix.disc = (rArt, col) => {
    const R = Math.max(1, rArt), S = 2 * R;
    return Pix.bake('d|' + R + col, S, S, R, R, (b, w) => {
      const p = px32(col);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x + 0.5 - R, y + 0.5 - R) <= R) b[y * w + x] = p;
    });
  };
  // Dithered puff of radius rArt (smoke particles); alpha is applied at blit.
  Pix.puff = (rArt, col) => {
    const R = Math.max(1, rArt), S = 2 * R;
    return Pix.bake('p|' + R + col, S, S, R, R, (b, w) => {
      const p = px32(col), p2 = px32(U.shade(col, 0.25));
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R;
        if (d > 1) continue;
        if (d > 0.72 && ((x + y) & 1)) continue; // ragged dithered rim
        b[y * w + x] = d < 0.4 && !((x + y) & 1) ? p2 : p;
      }
    });
  };
  // Ring of outer radius rArt and thickness t (1..3 art px): bands from the outside in are c0, c1, c2; origin = centre. dash > 0 makes 'dash' arcs of that many art px with equal gaps, phase 0..7 shifts them.
  Pix.ring = (rArt, t, c0, c1, c2, dash, phase) => {
    const R = Math.max(2, rArt), S = 2 * R, T = Math.max(1, Math.min(3, t | 0)), dsh = dash | 0, ph = phase | 0;
    return Pix.bake('r|' + R + '|' + T + c0 + c1 + c2 + '|' + dsh + '|' + ph, S, S, R, R, (b, w) => {
      const a = px32(c0), m = px32(c1), z = px32(c2 || c1), step = dsh ? dsh * 2 : 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - R, dy = y + 0.5 - R, d = Math.hypot(dx, dy);
        if (d > R || d <= R - T) continue;
        if (dsh) { const arc = (Math.atan2(dy, dx) + Math.PI) * R + ph * dsh * 0.25; if (((arc % step) + step) % step >= dsh) continue; }
        const band = Math.min(T - 1, (R - d) | 0); // 0 = outermost px
        b[y * w + x] = T === 1 ? m : band === 0 ? a : band === 1 ? m : z;
      }
    });
  };
  // Ellipse ring (rx, ry art px, 1 px line, colour c) or filled ellipse (fill = true); origin = centre. Ground rims and hero shields.
  Pix.ell = (rx, ry, col, fill, dash, phase) => {
    const X = Math.max(2, rx), Y = Math.max(2, ry), W = 2 * X, H = 2 * Y, dsh = dash | 0, ph = phase | 0;
    return Pix.bake('e|' + X + '|' + Y + col + (fill ? 'f' : '') + '|' + dsh + '|' + ph, W, H, X, Y, (b, w) => {
      const p = px32(col);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - X) / X, dy = (y + 0.5 - Y) / Y, d = Math.hypot(dx, dy);
        if (d > 1) continue;
        if (!fill) {
          const inner = Math.hypot((x + 0.5 - X) / (X - 1), (y + 0.5 - Y) / (Y - 1));
          if (inner < 1) continue;
          if (dsh) { const arc = (Math.atan2(dy, dx) + Math.PI) * X + ph * dsh * 0.25; if (((arc % (dsh * 2)) + dsh * 2) % (dsh * 2) >= dsh) continue; }
        }
        b[y * w + x] = p;
      }
    });
  };
  // ---------------- batched squares ----------------
  // sq(col, a, x, y, w) collects a w x w px square (w 2, 4 or 6) centred near (x, y) on the 2 px grid (alpha in quarters); flush(c) fills one path per (colour, side, alpha) in the current compositing mode.
  const sqB = new Map(); // colour -> 16 slots (side 2 / 4 / 6 x alpha quarter), each { n, p: [x, y, ...] }
  Pix.sq = (col, a, x, y, w) => {
    let s = sqB.get(col); if (!s) sqB.set(col, s = []);
    const k = ((w >> 1) & 3) * 4 + (a >= 1 ? 3 : a <= 0.25 ? 0 : Math.ceil(a * 4) - 1);
    let b = s[k]; if (!b) b = s[k] = { n: 0, p: [] };
    const i = b.n * 2; b.p[i] = Math.round((x - w / 2) * 0.5) * 2; b.p[i + 1] = Math.round((y - w / 2) * 0.5) * 2; b.n++;
  };
  Pix.flush = (c) => {
    const ga = c.globalAlpha;
    for (const [col, s] of sqB) for (let k = 0; k < 16; k++) {
      const b = s[k]; if (!b || !b.n) continue;
      const w = (k >> 2) * 2;
      c.globalAlpha = ga * ((k & 3) + 1) / 4; c.fillStyle = col; c.beginPath();
      for (let i = 0, m = b.n * 2; i < m; i += 2) c.rect(b.p[i], b.p[i + 1], w, w);
      c.fill(); b.n = 0;
    }
    c.globalAlpha = ga;
    if (sqB.size > 120) sqB.clear();
  };
  // ---------------- pixel lines ----------------
  // Appends 2-px squares of side w along the segment to the current path (stair-step line on the art grid); fill() draws it.
  Pix.line = (c, x0, y0, x1, y1, w) => {
    const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / K)), h = w / 2;
    for (let i = 0; i <= n; i++) { const t = i / n; c.rect(s2(x0 + dx * t - h) , s2(y0 + dy * t - h), w, w); }
  };

  // Convex polygon p[0..2n) (x, y pairs) as art-grid rows: appends one 2 px tall rect per row to the current path.
  Pix.fillConvex = (c, p, n) => {
    let y0 = 1e9, y1 = -1e9;
    for (let i = 1; i < 2 * n; i += 2) { if (p[i] < y0) y0 = p[i]; if (p[i] > y1) y1 = p[i]; }
    for (let y = Math.floor(y0 / K) * K; y < y1; y += K) {
      const yc = y + 1; let xl = 1e9, xr = -1e9;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ay = p[2 * i + 1], by = p[2 * j + 1];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) { const x = p[2 * i] + (yc - ay) / (by - ay) * (p[2 * j] - p[2 * i]); if (x < xl) xl = x; if (x > xr) xr = x; }
      }
      if (xr > xl) { const a = s2(xl), b = s2(xr); if (b > a) c.rect(a, y, b - a, K); }
    }
  };
  // Outline of polygon p[0..2n) as 2 px squares along its edges (closed when close is set).
  Pix.edge = (c, p, n, close) => { for (let i = 0; i < (close ? n : n - 1); i++) { const j = (i + 1) % n; Pix.line(c, p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1], K); } };
  // Sector (apex x, y; direction a; radius r; opening arc) as a convex fan polygon in `out`; returns the vertex count (arcs over pi are not convex: callers pass at most pi).
  Pix.fan = (out, x, y, a, r, arc) => {
    const seg = Math.max(3, Math.ceil(arc * r / 8)); let n = 0;
    out[n++] = x; out[n++] = y;
    for (let i = 0; i <= seg; i++) { const q = a - arc / 2 + arc * i / seg; out[n++] = x + Math.cos(q) * r; out[n++] = y + Math.sin(q) * r; }
    return n / 2;
  };
  // Packed ABGR with alpha a (0..1).
  Pix.px32a = (h, a) => { const c = U.hexToRgb(h); return (((a * 255) & 255) << 24 | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0; };

  const hs = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  Pix.hash = hs;
})(globalThis.ED || (globalThis.ED = {}));
