// UI pixel grid and frame kit (client only, ED.PixUI).
// Grid: k = whole device px per UI art px (largest k that fits 480 x 270 art px), published as CSS vars on :root; font tokens are whole multiples of 16 device px
// (src/art/fonts.css re-grids every font to 16 font px per em, so any family is crisp at any token). Frames: ASCII masks baked once to PNG data URLs (CSS vars).
// Text snap: DOM glyph edges land on whole pixels only at one origin fraction per platform (P.bias); P.snap shifts single-line labels there by text-indent.
(function (ED) {
  'use strict';
  const doc = document, root = doc.documentElement;
  const GW = 480, GH = 270;
  const P = ED.PixUI = { k: 4, p: 4, dpr: 1, t: 1, bias: 0, biased: false, frames: {} };
  const subs = [];
  // fn(P) runs after every grid change (resize, zoom, dpr change).
  P.on = (fn) => { subs.push(fn); };

  // ---------------------------------------------------------------- grid and font tokens
  const remPx = (w, h) => Math.min(36, Math.max(13, Math.min(w / 110, h / 62))); // = style.css html font-size
  let sig = '';
  function grid() {
    const dpr = window.devicePixelRatio || 1, w = window.innerWidth || 1280, h = window.innerHeight || 720;
    const k = Math.max(1, Math.floor(Math.min(w * dpr / GW, h * dpr / GH)));
    const rem = remPx(w, h), m = (r) => Math.max(1, Math.round(r * rem * dpr / 16)); // nearest whole multiple of 16 device px to r rem
    const t = m(1.08), xl = Math.max(t, m(1.75)), x2 = Math.max(xl, m(2.4)), title = Math.max(1, Math.round(1.7 * rem * dpr / 9)); // title: cap 9 font px ≈ 1.7rem
    const s = [dpr, k, t, xl, x2, title].join();
    if (s === sig) return; sig = s;
    const css = (dev) => (dev / dpr) + 'px', st = root.style;
    Object.assign(P, { k, dpr, t, p: k / dpr, pf: Math.max(1, Math.round(k / 2)) / dpr, xl, x2, title });
    st.setProperty('--k', k); st.setProperty('--dpr', dpr); st.setProperty('--t', t);
    st.setProperty('--p', css(k)); st.setProperty('--pf', css(Math.max(1, Math.round(k / 2)))); st.setProperty('--dp', css(1));
    st.setProperty('--fu', css(16));
    for (const [n, v] of [['xs', t], ['sm', t], ['md', t], ['lg', t], ['xl', xl], ['2xl', x2]]) st.setProperty('--fs-' + n, css(16 * v));
    st.setProperty('--fs-title', css(16 * title)); st.setProperty('--fs-word', css(48 * k)); st.setProperty('--fs-menu', css(16 * Math.max(2, xl))); // wordmark: 1 font px = 3 art px; menu items: 2+ device px per font px
    for (const fn of subs) fn(P);
    queueSnap();
  }

  // ---------------------------------------------------------------- frames
  // P.frame(name, { rows, pal, slice, border, variants }) bakes a mask and publishes it.
  //   rows: array of equal-length strings (one frame) or an array of such arrays (an animation strip, frames side by side, all the same size).
  //   pal: { char: colour }; colour is any CSS colour or a custom property name ('--ember'); '.', ' ' and unmapped chars are transparent.
  //   slice: border-image slice in art px; border: visible frame thickness in art px (default slice); variants: { suffix: { char: colour } } over pal.
  // Publishes on :root: --fr-<name>[-<variant>]: url(data:...), and numbers --fr-<name>-s / -b / -w / -h / -n (slice, border, frame w, frame h, frames).
  // Returns the record { w, h, n, s, b, img: { base|variant: canvas }, url: { base|variant: dataURL } }.
  const tok = (c) => (c && c[0] === '-' ? getComputedStyle(root).getPropertyValue(c).trim() || 'transparent' : c);
  function bake(frames, pal) {
    const h = frames[0].length, w = frames[0][0].length, n = frames.length, cv = doc.createElement('canvas');
    cv.width = w * n; cv.height = h;
    const g = cv.getContext('2d'), col = {};
    for (const ch in pal) col[ch] = tok(pal[ch]);
    frames.forEach((rows, f) => rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) { const c = col[row[x]]; if (!c || c === 'transparent') continue; g.fillStyle = c; g.fillRect(f * w + x, y, 1, 1); }
    }));
    return cv;
  }
  P.frame = (name, def) => {
    const frames = Array.isArray(def.rows[0]) ? def.rows : [def.rows], h = frames[0].length, w = frames[0][0].length;
    for (const fr of frames) if (fr.length !== h || fr.some((r) => r.length !== w)) throw new Error('PixUI.frame ' + name + ': rows must be ' + w + ' x ' + h);
    const rec = { w, h, n: frames.length, s: def.slice || 0, b: def.border == null ? def.slice || 0 : def.border, img: {}, url: {}, def };
    const vars = Object.assign({ base: {} }, def.variants || {}), st = root.style;
    for (const v in vars) {
      const cv = bake(frames, Object.assign({}, def.pal, vars[v]));
      rec.img[v] = cv; rec.url[v] = cv.toDataURL();
      st.setProperty('--fr-' + name + (v === 'base' ? '' : '-' + v), 'url("' + rec.url[v] + '")');
    }
    for (const [kk, val] of [['s', rec.s], ['b', rec.b], ['w', w], ['h', h], ['n', rec.n]]) st.setProperty('--fr-' + name + '-' + kk, val);
    return (P.frames[name] = rec);
  };
  // Variants mapping char to every path colour: { fire: { [ch]: '--path-fire' }, ... } (merge into variants).
  P.PATHS = ['fire', 'ice', 'lightning', 'holy', 'shadow', 'general']; // the four paths plus the class-only elements (ED.pathInfo)
  P.pathVariants = (ch, prefix) => { const o = {}; for (const p of P.PATHS) o[(prefix || '') + p] = { [ch]: '--path-' + p }; return o; };
  // Rebakes every frame (after a colour token changed).
  P.rebake = () => { for (const name in P.frames) P.frame(name, P.frames[name].def); };
  // 9-slice draw on a canvas at an integer scale (HUD): x, y, w, h in canvas px; corners and edges at sc px per art px, centre stretched.
  P.nine = (ctx, name, variant, x, y, w, h, sc) => {
    const r = P.frames[name]; if (!r) return; const img = r.img[variant || 'base'] || r.img.base, s = r.s, fw = r.w, fh = r.h, d = s * sc;
    const sx = [0, s, fw - s], sw = [s, fw - 2 * s, s], dx = [x, x + d, x + w - d], dw = [d, w - 2 * d, d];
    const sy = [0, s, fh - s], sh = [s, fh - 2 * s, s], dy = [y, y + d, y + h - d], dh = [d, h - 2 * d, d];
    const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (dw[i] > 0 && dh[j] > 0) ctx.drawImage(img, sx[i], sy[j], sw[i], sh[j], dx[i], dy[j], dw[i], dh[j]);
    ctx.imageSmoothingEnabled = sm;
  };

  // ---------------------------------------------------------------- text bias and snapping
  // P.bias: fraction of a device px for a DOM text origin so glyph edges land on whole pixels. Measured in headless Chromium 148 on Windows (DOM text is crisp at
  // origin x = n + 0.5, both LCD and grayscale) and Firefox (n + 0). Canvas readback disagrees with what the compositor shows, so this is a platform table, not a probe.
  P.bias = /Windows/.test(navigator.userAgent) && /Chrome\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent) ? 0.5 : 0;
  function ready() { P.biased = true; queueSnap(); }
  // Shifts the first line of each label in `els` by text-indent (inline style) so its first glyph origin sits at a whole device px + bias.
  // Default targets: SNAP selectors plus [data-px-snap]; for single-line labels (later lines of wrapped text keep their own origins). Hidden elements are skipped.
  P.SNAP = '.logo-word, .logo-kicker, .menu-btn, .btn, .sec-title, .plate-h, .card-title, .pp-name, .title-home, kbd, [data-px-snap]';
  function firstText(el) {
    const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    return w.nextNode();
  }
  const rng = doc.createRange();
  function originX(tn) { const i = tn.data.search(/\S/); rng.setStart(tn, i); rng.setEnd(tn, i + 1); const r = rng.getClientRects(); return r.length ? r[0].left : null; }
  // Two layout reads per call (all reads, then all writes): centred text moves by half its indent, so a second pass doubles those.
  P.snap = (els) => {
    if (!P.biased) return;
    const dpr = P.dpr, want = P.bias, todo = [];
    const need = (x) => { let d = ((want - (x * dpr) % 1) % 1 + 1) % 1; if (d > 0.5) d -= 1; return d; }; // device px, smallest move
    for (const el of els) {
      if (!el.offsetParent) continue;
      const tn = firstText(el), x = tn && originX(tn); if (x == null) continue;
      const d = need(x); if (Math.abs(d) >= 0.06) todo.push({ el, tn, x, d, ind: parseFloat(el.style.textIndent) || 0 });
    }
    for (const o of todo) o.el.style.textIndent = (o.ind + o.d / dpr) + 'px';
    for (const o of todo) { const x = originX(o.tn); o.moved = x == null ? 0 : (x - o.x) * dpr; }
    for (const o of todo) if (Math.abs(o.moved) > 0.02 && Math.abs(o.moved - o.d) > 0.06) o.el.style.textIndent = (o.ind + o.d * o.d / o.moved / dpr) + 'px';
  };
  P.snapAll = () => { if (P.biased) P.snap(doc.querySelectorAll(P.SNAP)); };
  let snapT = 0; // bursts of DOM changes coalesce into one pass 80 ms after the first
  function queueSnap() { if (snapT) return; snapT = setTimeout(() => { snapT = 0; P.snapAll(); }, 80); }
  P.queueSnap = queueSnap;

  // ---------------------------------------------------------------- boot
  grid();
  window.addEventListener('resize', grid);
  if (window.matchMedia) { const mq = () => { const q = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)'); q.addEventListener('change', () => { grid(); mq(); }, { once: true }); }; mq(); }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(ready, ready); else ready();
  const ui = doc.getElementById('ui');
  if (ui && window.MutationObserver) new MutationObserver(queueSnap).observe(ui, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
})(globalThis.ED || (globalThis.ED = {}));
