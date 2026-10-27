// ImageBitmap helpers (ED.Bmp) and the pixel-art atlas runtime (ED.Atlas). Client only; nothing here touches the sim.
// ED.ART (src/art/*.js) holds data-URI pages plus frame / anim tables in art px; 1 art px = 1 world px. Pages decode once into ImageBitmaps;
// recoloured variants, rotated sprites and tinted font sheets are cached ImageBitmaps built lazily (a canvas stands in until createImageBitmap resolves).
(function (ED) {
  'use strict';
  const K = 1; // world px per art px (the view is ~640x360 world px, integer-scaled to the screen)

  // ---------------- ImageBitmap helper ----------------
  // Gecko pays ~13 us per distinct source canvas per drawImage; ImageBitmaps do not. Callers bake into a canvas, draw it until Bmp.from resolves, then swap it.
  const dead = []; let sweepN = 0;
  const Bmp = ED.Bmp = {
    ok: typeof createImageBitmap === 'function', made: 0, freed: 0, pending: 0,
    // Converts canvas cv; done(bitmap) runs once ready (never on failure). The owner must free the bitmap itself when it was evicted meanwhile.
    from(cv, done) {
      if (!Bmp.ok || !cv || !(cv.width > 0) || !(cv.height > 0) || cv.width * cv.height > 16e6) return;
      Bmp.pending++;
      createImageBitmap(cv).then((b) => { Bmp.pending--; Bmp.made++; done(b); }, () => { Bmp.pending--; });
    },
    // Holder { v, dead }: v is the canvas now and the ImageBitmap once ready. Callers draw h.v and release with Bmp.drop(h).
    hold(cv) { const h = { v: cv, dead: false }; Bmp.from(cv, (b) => { if (h.dead) Bmp.free(b); else h.v = b; }); return h; },
    drop(h) { if (h && !h.dead) { h.dead = true; Bmp.free(h.v); } },
    // Closes an evicted bitmap two sweeps later, so a reference still held by the frame in flight stays valid.
    free(b) { if (b && typeof b.close === 'function') dead.push(b, sweepN); },
    sweep() {
      sweepN++;
      let n = 0;
      for (let i = 0; i < dead.length; i += 2) {
        if (sweepN - dead[i + 1] >= 2) { try { dead[i].close(); } catch (e) { /* already closed */ } Bmp.freed++; }
        else { dead[n++] = dead[i]; dead[n++] = dead[i + 1]; }
      }
      dead.length = n;
    },
  };

  // ---------------- pages ----------------
  const art = ED.ART && ED.ART.pages && ED.ART.frames ? ED.ART : null;
  const A = ED.Atlas = { K, pages: {}, ok: false, ready: Promise.resolve(false), font: null, rotBaked: 0, varBuilt: 0 };

  function decodePage(name, uri) {
    return new Promise((resolve) => {
      const img = new Image();
      const done = () => (Bmp.ok ? createImageBitmap(img) : Promise.resolve(img)).then((b) => { A.pages[name] = b; resolve(true); }, () => resolve(false));
      img.src = uri;
      if (img.decode) img.decode().then(done, () => resolve(false)); else { img.onload = done; img.onerror = () => resolve(false); }
    });
  }
  if (art) {
    A.ready = Promise.all(Object.keys(art.pages).map((k) => (typeof art.pages[k] === 'string' ? decodePage(k, art.pages[k]) : Promise.resolve(false)))).then((r) => {
      A.ok = r.some(Boolean);
      if (A.ok && art.font) try { initFont(); } catch (e) { A.font = null; }
      return A.ok;
    }, () => false);
  }

  // ---------------- anim / frame access ----------------
  const recs = new Map();
  // Resolved record of anim `id` (or of a lone frame id): { id, f: [frame meta], n, fps, loop, ax, ay, fw, fh, anchors }; null when absent or its page is missing.
  function rec(id) {
    let r = recs.get(id);
    if (r !== undefined) return r;
    r = null;
    if (art) {
      const a = art.anims && art.anims[id];
      if (a && a.f && a.f.length) {
        const fr = []; let ok = true;
        for (const fid of a.f) { const f = art.frames[fid]; if (!f || !A.pages[f.p]) { ok = false; break; } fr.push(f); }
        if (ok) r = { id, f: fr, n: fr.length, fps: a.fps || 8, loop: a.loop !== false, ax: a.ax || 0, ay: a.ay || 0, fw: a.fw, fh: a.fh, anchors: a.anchors || {}, vars: null, rots: null };
      } else {
        const f = art.frames[id];
        if (f && A.pages[f.p]) r = { id, f: [f], n: 1, fps: 1, loop: false, ax: f.ox + f.w / 2, ay: f.oy + f.h, fw: f.ox + f.w, fh: f.oy + f.h, anchors: {}, vars: null, rots: null };
      }
    }
    if (r || A.ok) recs.set(id, r); // a miss before the pages decode is retried later
    return r;
  }
  // Named anchor of a record as [x, y] in untrimmed-frame art px (accepts [x, y], { x, y } or a list of those; the first entry of a list wins).
  function anchorPt(r, name) {
    let v = name ? r.anchors[name] : null;
    if (Array.isArray(v) && Array.isArray(v[0])) v = v[0];
    if (Array.isArray(v)) return v.length >= 2 ? v : null;
    return v && typeof v === 'object' && v.x !== undefined ? [v.x, v.y] : null;
  }
  A.has = (id) => !!rec(id);
  A.anim = (id) => rec(id);
  A.forget = (id) => recs.delete(id); // drops a cached record (a runtime anim registered under an id probed earlier)
  A.frame = (id, i) => { const r = rec(id); return r ? r.f[((i | 0) % r.n + r.n) % r.n] : null; };
  // Frame index of anim `id` at time t seconds (by its fps; looping anims wrap, others hold the last frame).
  A.frameAt = (id, t) => {
    const r = rec(id); if (!r) return 0;
    const k = Math.floor(t * r.fps);
    return r.loop ? ((k % r.n) + r.n) % r.n : Math.max(0, Math.min(r.n - 1, k));
  };

  // ---------------- pixel work ----------------
  let scv = null, sg = null;
  function scratch(w, h) {
    if (!scv) { scv = document.createElement('canvas'); sg = scv.getContext('2d', { willReadFrequently: true }); }
    if (scv.width !== w || scv.height !== h) { scv.width = w; scv.height = h; } else sg.clearRect(0, 0, w, h);
    sg.imageSmoothingEnabled = false;
    return sg;
  }
  // RGBA pixels of frame f drawn at (pad, pad) inside a (w + 2 pad) x (h + 2 pad) buffer.
  function readFrame(f, pad) { return readRect(A.pages[f.p], f.x, f.y, f.w, f.h, pad); }
  function readRect(src, sx, sy, w, h, pad) {
    const g = scratch(w + 2 * pad, h + 2 * pad);
    g.drawImage(src, sx, sy, w, h, pad, pad, w, h);
    return g.getImageData(0, 0, w + 2 * pad, h + 2 * pad);
  }
  const hexInt = (h) => { // '#rrggbb' -> packed little-endian RGBA with full alpha
    const v = parseInt(h.slice(1), 16); return ((255 << 24) | ((v & 255) << 16) | (((v >> 8) & 255) << 8) | (v >> 16)) >>> 0;
  };

  // ---------------- variants: whole-anim recoloured sheets ----------------
  // key: 'white' | 'frozen' | 'grey' | 'outline:#rrggbb' | 'pal:<name>' (make() returns { '#src': '#dst' }, called once). One sheet per (anim, key).
  function variantRec(r, key, make) {
    const vs = r.vars || (r.vars = {});
    let v = vs[key];
    if (v !== undefined) return v;
    const kind = key.split(':')[0];
    if (kind === 'pal' && !make) return null; // palette maps must be registered with Atlas.variant first
    v = vs[key] = buildVariant(r, key, kind, make);
    return v;
  }
  function buildVariant(r, key, kind, make) {
    let map = null, oc = 0;
    if (kind === 'pal') {
      const m = make(art.pal && art.pal[r.id] || []); map = new Map();
      for (const k in m) map.set(hexInt(k), hexInt(m[k]));
    } else if (kind === 'outline') oc = hexInt(key.slice(8) || '#222222');
    else if (kind !== 'white' && kind !== 'frozen' && kind !== 'grey') return null;
    const pad = kind === 'outline' ? 1 : 0, rects = [];
    let W = 0, H = 0;
    for (const f of r.f) { rects.push({ x: W + 1, y: 1 }); W += f.w + 2; H = Math.max(H, f.h + 2); }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    for (let i = 0; i < r.n; i++) {
      const f = r.f[i], im = readFrame(f, 1), px = new Uint32Array(im.data.buffer), d = im.data, w = f.w + 2, h = f.h + 2;
      if (kind === 'outline') {
        const src = px.slice();
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const o = y * w + x; if ((src[o] >>> 24) !== 0) continue;
          if ((x > 0 && (src[o - 1] >>> 24) > 0) || (x < w - 1 && (src[o + 1] >>> 24) > 0) || (y > 0 && (src[o - w] >>> 24) > 0) || (y < h - 1 && (src[o + w] >>> 24) > 0)) px[o] = oc;
        }
      } else if (kind === 'pal') {
        for (let o = 0; o < px.length; o++) { const v = px[o]; if ((v >>> 24) === 0) continue; const a = v & 0xff000000, m = map.get((v | 0xff000000) >>> 0); if (m !== undefined) px[o] = ((m & 0x00ffffff) | a) >>> 0; }
      } else {
        for (let o = 0; o < d.length; o += 4) {
          if (d[o + 3] === 0) continue;
          if (kind === 'white') { d[o] = d[o + 1] = d[o + 2] = 255; continue; }
          const l = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) / 255;
          if (kind === 'grey') { const q = 22 + l * 190; d[o] = d[o + 1] = d[o + 2] = q; }
          else { const q = Math.min(1, l * 1.2); d[o] = 30 + q * 190; d[o + 1] = 70 + q * 170; d[o + 2] = 110 + q * 145; if (q > 0.82) { d[o] = 235; d[o + 1] = 248; d[o + 2] = 255; } }
        }
      }
      g.putImageData(im, rects[i].x - 1, rects[i].y - 1);
    }
    const v = { src: cv, rects, pad };
    A.varBuilt++;
    Bmp.from(cv, (b) => { if (r.vars && r.vars[key] === v) v.src = b; else Bmp.free(b); });
    return v;
  }
  // Registers / returns the recoloured sheet of anim `id` for `key`; Atlas.draw(..., { variant: key }) then draws from it. Returns false when `id` is unknown.
  A.variant = (id, key, make) => { const r = rec(id); return !!(r && variantRec(r, key, make)); };

  // ---------------- RotSprite-lite ----------------
  const NSTEP = 32, rotCache = new Map(), rotQueue = [], rotNeed = [], rotPend = new Set(); let rotLeft = 4; // rotNeed: bakes a draw asked for past the per-frame allowance (worked before rotQueue, the background prebake)
  function scale2x(src, w, h) {
    const dst = new Uint32Array(w * h * 4), W2 = w * 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const P = src[y * w + x], a = y > 0 ? src[(y - 1) * w + x] : P, b = x < w - 1 ? src[y * w + x + 1] : P, c = x > 0 ? src[y * w + x - 1] : P, d = y < h - 1 ? src[(y + 1) * w + x] : P;
      const o = y * 2 * W2 + x * 2;
      dst[o] = c === a && c !== d && a !== b ? a : P; dst[o + 1] = a === b && a !== c && b !== d ? b : P;
      dst[o + W2] = d === c && d !== b && c !== a ? c : P; dst[o + W2 + 1] = b === d && b !== a && d !== c ? d : P;
    }
    return dst;
  }
  const rotKey = (id, i, step, flip, anchor, variant) => id + '|' + i + '|' + step + '|' + (flip ? 1 : 0) + '|' + (anchor || '') + '|' + (variant || '');
  // Frame i of anim `id` rotated clockwise by step / 32 turns about the anim's anchor (optionally mirrored first, optionally from a recoloured variant sheet): Scale2x twice, nearest rotation, 4x4 majority downsample.
  // Returns { src, sx, sy, w, h, ox, oy } (rect of the rotated image in art px, anchor position inside it). A canvas stands in until its ImageBitmap is ready.
  A.rotSprite = (id, i, step, flip, anchor, variant) => {
    const r = rec(id); if (!r) return null;
    i = ((i | 0) % r.n + r.n) % r.n; step = ((step | 0) % NSTEP + NSTEP) % NSTEP;
    if (variant && !variantRec(r, variant)) variant = '';
    const key = rotKey(id, i, step, flip, anchor, variant);
    return rotCache.get(key) || bakeRot(r, i, step, !!flip, anchor, variant, key);
  };
  function bakeRot(r, i, step, flip, anchor, variant, key) {
    const f = r.f[i], v = variant ? variantRec(r, variant) : null, pad = v ? v.pad : 0;
    const w = f.w + 2 * pad, h = f.h + 2 * pad;
    const im = v ? readRect(v.src, v.rects[i].x - pad, v.rects[i].y - pad, w, h, 0) : readFrame(f, 0);
    let px = new Uint32Array(im.data.buffer);
    for (let o = 0; o < px.length; o++) if ((px[o] >>> 24) === 0) px[o] = 0;
    if (flip) for (let y = 0; y < h; y++) for (let x = 0; x < w >> 1; x++) { const a = y * w + x, b = y * w + w - 1 - x, t = px[a]; px[a] = px[b]; px[b] = t; }
    const an = anchorPt(r, anchor), axa = an ? an[0] : r.ax, aya = an ? an[1] : r.ay;
    const ax0 = axa - f.ox + pad, ax = flip ? w - ax0 : ax0, ay = aya - f.oy + pad; // pivot inside the (mirrored, padded) trimmed frame, art px
    const big = scale2x(scale2x(px, w, h), w * 2, h * 2), bw = w * 4, bh = h * 4;
    const R = Math.max(Math.hypot(ax, ay), Math.hypot(w - ax, ay), Math.hypot(ax, h - ay), Math.hypot(w - ax, h - ay)), Hh = Math.ceil(R) + 1, D = Hh * 2, D4 = D * 4;
    const th = step / NSTEP * Math.PI * 2, co = Math.cos(th), si = Math.sin(th), rot = new Uint32Array(D4 * D4), pcx = ax * 4, pcy = ay * 4, c0 = Hh * 4;
    for (let y = 0; y < D4; y++) {
      const ry = y + 0.5 - c0;
      for (let x = 0; x < D4; x++) {
        const rx = x + 0.5 - c0, sx = Math.floor(rx * co + ry * si + pcx), sy = Math.floor(-rx * si + ry * co + pcy);
        if (sx >= 0 && sy >= 0 && sx < bw && sy < bh) rot[y * D4 + x] = big[sy * bw + sx];
      }
    }
    const cv = document.createElement('canvas'); cv.width = cv.height = D;
    const g = cv.getContext('2d'), out = g.createImageData(D, D), o32 = new Uint32Array(out.data.buffer), blk = new Uint32Array(16);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      let n = 0;
      for (let yy = 0; yy < 4; yy++) { const b = (y * 4 + yy) * D4 + x * 4; blk[n++] = rot[b]; blk[n++] = rot[b + 1]; blk[n++] = rot[b + 2]; blk[n++] = rot[b + 3]; }
      let best = 0, bc = 0;
      for (let a = 0; a < 16; a++) { let c = 0; const v = blk[a]; for (let b = 0; b < 16; b++) if (blk[b] === v) c++; if (c > bc || (c === bc && v !== 0 && best === 0)) { bc = c; best = v; } }
      o32[y * D + x] = best;
    }
    g.putImageData(out, 0, 0);
    const s = { src: cv, sx: 0, sy: 0, w: D, h: D, ox: Hh, oy: Hh };
    if (rotCache.size >= 2400) { for (const v of rotCache.values()) Bmp.free(v.src); rotCache.clear(); }
    rotCache.set(key, s); A.rotBaked++;
    Bmp.from(cv, (b) => { if (rotCache.get(key) === s) s.src = b; else Bmp.free(b); });
    return s;
  }
  // Queues all 32 angles of a frame to bake in the background (Atlas.tick spends a small time budget per frame on the queue).
  A.prebake = (id, i, flip, anchor, variant) => { if (rec(id)) for (let s = 1; s < NSTEP; s++) rotQueue.push([id, i | 0, s, !!flip, anchor, variant]); };
  // Per frame: resets the inline bake allowance and works the prebake queue for at most `ms` milliseconds.
  A.tick = (ms) => {
    rotLeft = 4;
    if (!rotNeed.length && !rotQueue.length) return;
    const t0 = performance.now(), lim = ms === undefined ? 1.5 : ms;
    while (rotNeed.length && performance.now() - t0 < lim) { const q = rotNeed.shift(); rotPend.delete(rotKey(q[0], q[1], q[2], q[3], q[4], q[5])); A.rotSprite(q[0], q[1], q[2], q[3], q[4], q[5]); }
    while (rotQueue.length && performance.now() - t0 < lim) { const q = rotQueue.shift(); A.rotSprite(q[0], q[1], q[2], q[3], q[4], q[5]); }
  };

  // ---------------- draw ----------------
  // Draws frame i of anim `id` with its feet anchor (ax, ay) at world (x, y), 1 art px = 1 world px, nearest sampling.
  // o: { flip, variant (key of Atlas.variant / built-in), alpha, rot (radians, clockwise, quantised to 32 steps about the anchor), anchor (name in anim.anchors to pivot on instead of the feet) }.
  A.draw = (c, id, i, x, y, o) => {
    const r = rec(id); if (!r) return false;
    i = ((i | 0) % r.n + r.n) % r.n;
    const f = r.f[i], flip = !!(o && o.flip), v = o && o.variant ? variantRec(r, o.variant) : null, vk = v ? o.variant : '';
    let src, sx, sy, sw, sh, pad = 0, dxl, dyt, dw, dh;
    const an = o && o.anchor ? anchorPt(r, o.anchor) : null, ax = an ? an[0] : r.ax, ay = an ? an[1] : r.ay;
    if (o && o.rot) {
      const st = Math.round(o.rot / (Math.PI * 2) * NSTEP) & (NSTEP - 1);
      if (st) {
        const an2 = o.anchor || '';
        const rk = rotKey(id, i, st, flip, an2, vk);
        let s = rotCache.get(rk);
        if (!s) {
          if (rotLeft > 0) { rotLeft--; s = A.rotSprite(id, i, st, flip, an2, vk); }
          else {
            for (let d = 1; d < NSTEP && !s; d++) s = rotCache.get(rotKey(id, i, (st + d) & 31, flip, an2, vk)) || rotCache.get(rotKey(id, i, (st - d) & 31, flip, an2, vk));
            if (!s && !rotPend.has(rk)) { rotPend.add(rk); rotNeed.push([id, i, st, flip, an2, vk]); } // nothing of this sprite is baked and the frame's allowance is spent: the unrotated frame stands in until Atlas.tick bakes it
          }
        }
        if (s) return blitTo(c, s.src, s.sx, s.sy, s.w, s.h, x - s.ox * K, y - s.oy * K, s.w * K, s.h * K, false, o);
      }
    }
    src = A.pages[f.p]; sx = f.x; sy = f.y; sw = f.w; sh = f.h;
    if (v) { src = v.src; const q = v.rects[i]; pad = v.pad; sx = q.x - pad; sy = q.y - pad; sw = f.w + 2 * pad; sh = f.h + 2 * pad; }
    dxl = flip ? x + (ax - f.ox - f.w - pad) * K : x + (f.ox - ax - pad) * K;
    dyt = y + (f.oy - ay - pad) * K; dw = sw * K; dh = sh * K;
    return blitTo(c, src, sx, sy, sw, sh, dxl, dyt, dw, dh, flip, o);
  };
  function blitTo(c, src, sx, sy, sw, sh, dx, dy, dw, dh, flip, o) {
    dx = Math.round(dx); dy = Math.round(dy);
    const ga = c.globalAlpha, al = o && o.alpha !== undefined ? o.alpha : 1;
    c.imageSmoothingEnabled = false;
    if (al !== 1) c.globalAlpha = ga * al;
    if (flip) { const m = 2 * dx + dw; c.transform(-1, 0, 0, 1, m, 0); c.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh); c.transform(-1, 0, 0, 1, m, 0); } // mirror about the rect centre and undo it (a flip is its own inverse)
    else c.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    if (al !== 1) c.globalAlpha = ga;
    c.imageSmoothingEnabled = true;
    return true;
  }

  // ---------------- pixel font ----------------
  // ED.ART.font = { h, gap, space, glyphs: { char: frameId } }. Glyphs are drawn at (pen, top + oy) and the pen advances by w + gap (ox is not used); a space advances by font.space.
  // A tinted sheet (every glyph with a 1 px dark outline) is built per colour; text is glyph blits from it.
  const fsheets = new Map(), OUTLINE = '#120a06';
  let fmask = null; // white glyph sheet: cells of (w + 4) x (h + 2), glyph at cell + (2, 1)
  function initFont() {
    const F = art.font, g = {}; let W = 0, H = F.h + 2;
    for (const ch in F.glyphs) { const f = art.frames[F.glyphs[ch]]; if (!f || !A.pages[f.p]) continue; g[ch] = { f, cx: W, w: f.w, h: f.h, oy: f.oy || 0 }; W += f.w + 4; H = Math.max(H, f.h + 2); }
    const cv = document.createElement('canvas'); cv.width = Math.max(1, W); cv.height = H;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    for (const ch in g) { const q = g[ch]; c.drawImage(A.pages[q.f.p], q.f.x, q.f.y, q.f.w, q.f.h, q.cx + 2, 1, q.f.w, q.f.h); }
    fmask = cv;
    A.font = { h: F.h, gap: F.gap === undefined ? 1 : F.gap, g, space: F.space || Math.max(2, Math.round(F.h * 0.5)) };
  }
  function fontSheet(color) {
    let s = fsheets.get(color);
    if (s) return s;
    const m = fmask, cv = document.createElement('canvas'); cv.width = m.width; cv.height = m.height;
    const c = cv.getContext('2d'), t = document.createElement('canvas'); t.width = m.width; t.height = m.height;
    const tg = t.getContext('2d'); tg.drawImage(m, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = OUTLINE; tg.fillRect(0, 0, t.width, t.height);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) c.drawImage(t, dx, dy);
    tg.globalCompositeOperation = 'copy'; tg.drawImage(m, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, t.width, t.height);
    c.drawImage(t, 0, 0);
    s = { src: cv };
    if (fsheets.size > 48) { for (const v of fsheets.values()) Bmp.free(v.src); fsheets.clear(); }
    fsheets.set(color, s);
    Bmp.from(cv, (b) => { if (fsheets.get(color) === s) s.src = b; else Bmp.free(b); });
    return s;
  }
  // True when a pixel font is loaded and has a glyph for every non-space character of `s` (callers draw other strings, e.g. non-Latin player names, with canvas text).
  A.covers = (s) => {
    const F = A.font; if (!F) return false;
    for (let i = 0; i < s.length; i++) if (s[i] !== ' ' && !F.g[s[i]]) return false;
    return true;
  };
  // Width in world px of `s` at k world px per font px (outline excluded): glyph widths plus gaps, spaces advance by font.space.
  A.textW = (s, k) => {
    const F = A.font; if (!F) return 0;
    let w = 0, last = 0;
    for (let i = 0; i < s.length; i++) { const q = F.g[s[i]]; last = q ? F.gap : 0; w += q ? q.w + F.gap : F.space; }
    return (w - last) * (k || 2);
  };
  // Draws `s` in `color` with a 1 px dark outline; (x, y) is the text centre (align 'l' / 'r': left / right edge, vertically centred). k: world px per font px (default 2; callers pass even values so font px stay on the art grid).
  // Returns false when no pixel font is loaded, so callers fall back to canvas text.
  A.text = (c, s, x, y, color, k, align, alpha) => {
    const F = A.font; if (!F) return false;
    k = k || 2;
    const w = A.textW(s, k);
    let px = align === 'l' ? x : align === 'r' ? x - w : x - w / 2;
    const py = y - F.h * k / 2, sh = fontSheet(color), ga = c.globalAlpha;
    c.imageSmoothingEnabled = false;
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = ga * alpha;
    for (let i = 0; i < s.length; i++) {
      const q = F.g[s[i]];
      if (!q) { px += F.space * k; continue; }
      c.drawImage(sh.src, q.cx + 1, 0, q.w + 2, q.h + 2, Math.round(px - k), Math.round(py + (q.oy - 1) * k), (q.w + 2) * k, (q.h + 2) * k); // the sheet cell keeps 1 px of outline around the glyph
      px += (q.w + F.gap) * k;
    }
    c.globalAlpha = ga; c.imageSmoothingEnabled = true;
    return true;
  };
})(globalThis.ED || (globalThis.ED = {}));
