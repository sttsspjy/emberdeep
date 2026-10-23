// Menu screen pixel art: frames and sprites for the menu screens (tabs, Hearth plaque, Armory rack, results banner, buy burst), baked by ED.PixUI.frame into CSS vars,
// and the title backdrop: an ordered-dither falloff baked per grid change (--menu-vign, one texel per art px, anchored at the viewport's top-left).
(function (ED) {
  'use strict';
  const U = ED.PixUI; if (!U) return;
  const OL = '#222222';
  // rows of w x h chars from fn(x, y) -> char
  const grid = (w, h, fn) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)).join(''));

  // tab: open at the bottom so the active tab joins the panel below it (slice 5 5 0 5). Base = active; off = inactive, off-hot = inactive hover.
  U.frame('tab', {
    rows: [
      '.oooooooooooo.',
      'oBBBBLLLLBBBBo',
      'oBhhhhhhhhhhBo',
      'oBffffffffffBo',
      'oBffffffffffBo',
      'oLffffffffffLo',
      'oLffffffffffLo',
      'oLffffffffffLo',
      'oLffffffffffLo',
      'oBffffffffffBo',
      'oBffffffffffBo',
      'oBffffffffffBo',
    ],
    pal: { o: OL, B: '--brass-hi', L: '--brass', h: '#2a1f17', f: '--panel-solid' },
    slice: 5, border: 2,
    variants: { off: { B: '--line-hi', L: '--line', h: '#120d0a', f: '#0e0a08' }, 'off-hot': { B: '--brass', L: '--line-hi', h: '#1d1510', f: '#15100c' } },
  });

  // Hearth plaque: brick frame (two courses, staggered joints, lit from the top-left) around warm soot. slice 7, visible 7. Variants: max (gold mortar), ash (locked).
  U.frame('plaque', {
    rows: grid(30, 30, (x, y) => {
      const W = 29, d = Math.min(x, y, W - x, W - y), horiz = Math.min(y, W - y) <= Math.min(x, W - x);
      if ((x === 0 || x === W) && (y === 0 || y === W)) return '.';
      if (d === 0) return 'o';
      if (d >= 7) return 'f';
      if (d === 6) return 'k';
      if (d === 3) return 'm';
      const a = (horiz ? x : y) + (d <= 2 ? 0 : 4), lit = horiz ? y < 15 : x < 15, top = d === 1 || d === 4; // bricks 7 long, joints every 8, the inner course offset by 4
      if (a % 8 === 0) return 'm';
      if (a % 8 === 7) return 'D';
      return top ? (lit ? 'H' : 'R') : (lit ? 'R' : 'D');
    }),
    pal: { o: OL, H: '#a65a3b', R: '#7f3d27', D: '#5a291b', m: '#24160f', k: '#0b0806', f: '#19110d' },
    slice: 7, border: 7,
    variants: { max: { m: '--gold-lo', H: '#c9744a' }, ash: { H: '#5c4c44', R: '#43372f', D: '#2c231f', m: '#1a1512', f: '#120e0c' } },
  });

  // Armory rack: riveted iron frame, cold fill. slice 5, visible 4. Variants: own (brass rivets), off (locked).
  U.frame('rack', {
    rows: grid(20, 20, (x, y) => {
      const W = 19, d = Math.min(x, y, W - x, W - y), horiz = Math.min(y, W - y) <= Math.min(x, W - x);
      if ((x === 0 || x === W) && (y === 0 || y === W)) return '.';
      if (d === 0) return 'o';
      if (d >= 4) return 'f';
      if (d === 3) return 'k';
      const a = horiz ? x : y;
      if (d === 2 && (a === 2 || a === W - 2 || a % 10 === 0)) return 'r';
      if (d === 1) return (horiz ? y < 10 : x < 10) ? 'I' : 'J';
      return 'i';
    }),
    pal: { o: OL, I: '#8d96a1', J: '#3a3f46', i: '#5b626c', r: '#c9d1da', k: '#0a0b0c', f: '#131416' },
    slice: 5, border: 4,
    variants: { own: { r: '--brass-hi', I: '#9a958c' }, on: { I: '--ember-hi', J: '--ember-lo', r: '#ffe0bd', i: '#6b6560' }, off: { I: '#4a5058', J: '#24272b', i: '#363a40', r: '#5b626c', f: '#0f1011' } },
  });

  // Results banner: cloth band with gold trims and swallow-tail ribbon ends behind it; 50 art px tall, ends 16 art px each (slice 0 16, the element is exactly 50 art px tall).
  {
    const H = 50, E = 16, M = 4, W = E * 2 + M;
    const band = (x, y) => y >= 2 && y <= 47 && x >= 10 && x <= W - 11;
    const tail = (x, y) => { if (y < 12 || y > 49) return false; const ex = Math.min(x, W - 1 - x), notch = Math.round(6 - Math.abs(y - 30.5) * 6 / 19); return ex >= notch && ex <= 12; };
    const shape = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (band(x, y) || tail(x, y));
    U.frame('banner', {
      rows: grid(W, H, (x, y) => {
        if (band(x, y)) {
          const ex = Math.min(x, W - 1 - x);
          if (y === 2 || y === 47 || ex === 10) return 'o';
          if (y === 3 || y === 46 || ex === 11) return 'G';
          if (y === 4 || y === 45) return 'g';
          return y < 25 ? 'C' : 'c';
        }
        if (tail(x, y)) return (y === 12 || y === 49 || !shape(x - 1, y) || !shape(x + 1, y)) ? 'o' : y > 47 ? 't' : 'T';
        return (shape(x - 1, y) || shape(x + 1, y) || shape(x, y - 1) || shape(x, y + 1)) ? 'o' : '.';
      }),
      pal: { o: OL, G: '--gold', g: '--gold-lo', C: '#9a3218', c: '#7c2612', T: '#5e1b0d', t: '#43120a' },
      slice: 0, border: 0,
      variants: { fall: { G: '#a8998a', g: '#5d4f44', C: '#2f2725', c: '#252020', T: '#1b1716', t: '#141110' } },
    });
  }

  // ember glow behind a plaque's ember: dithered warm halo, two frames (steps flicker). 14 x 12 art px.
  U.frame('glow', {
    rows: [0, 1].map((f) => grid(14, 12, (x, y) => {
      const dx = (x - 6.5) / (f ? 5.5 : 6.5), dy = (y - 6.5) / (f ? 4.5 : 5.5), d = dx * dx + dy * dy;
      if (d > 1 || (x + y) % 2) return '.';
      return d < 0.35 ? 'a' : 'b';
    })),
    pal: { a: 'rgba(255, 150, 70, 0.42)', b: 'rgba(255, 120, 50, 0.22)' },
  });

  // buy burst: 6-frame strip of ember sparks thrown up and out from the ember at (20, 18), 41 x 26 art px.
  {
    const W = 41, H = 26, ox = 20, oy = 18, N = 16, cols = ['Y', 'Y', 'H', 'E', 'L', 'L'];
    const parts = Array.from({ length: N }, (_, i) => { const a = Math.PI * (1.08 + 0.84 * ((i * 7) % N) / (N - 1)), s = 2.2 + ((i * 5) % 4) * 0.9; return { vx: Math.cos(a) * s * 1.3, vy: Math.sin(a) * s }; });
    U.frame('burst', {
      rows: cols.map((c, f) => {
        const px = new Map();
        const put = (x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H && !px.has(x + ',' + y)) px.set(x + ',' + y, ch); };
        const t = f + 1;
        if (f === 0) { for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) put(ox + dx, oy + dy, 'Y'); put(ox, oy, 'W'); }
        if (f === 1) for (const [dx, dy] of [[0, -3], [-3, 0], [3, 0], [-2, -2], [2, -2]]) put(ox + dx, oy + dy, 'H');
        parts.forEach((p, i) => {
          if (f >= 4 && i % 2) return;
          const x = ox + p.vx * t, y = oy + p.vy * t + 0.35 * t * t;
          put(x, y, c === 'Y' && i % 3 === 0 ? 'W' : c);
          if (f < 4) put(x - p.vx * 0.5, y - p.vy * 0.5 - 0.35 * t, f < 2 ? 'H' : 'L');
        });
        return grid(W, H, (x, y) => px.get(x + ',' + y) || '.');
      }),
      pal: { W: '#fff8e0', Y: '#fff3c4', H: '--ember-hi', E: '--ember', L: '--ember-lo' },
    });
  }

  // lock dither: denser 2 x 2 checker for locked or unavailable items
  U.frame('lockdither', { rows: ['o.', '.o'], pal: { o: 'rgba(8, 5, 4, 0.5)' } });
  // padlock: inline lock glyph (7 x 9 art px; .px-lock shows it at 2 font px per art px)
  U.frame('lock', {
    rows: ['..ooo..', '.oSSSo.', 'oSo.oSo', 'oSo.oSo', 'ooooooo', 'oLLLLLo', 'oLLoLLo', 'oDDoDDo', 'ooooooo'],
    pal: { o: OL, S: '#a8998a', L: '--ember-hi', D: '--ember-lo' },
  });

  // ---------------------------------------------------------------- title backdrop
  // Elliptical darkening behind the menu column: 4x4 Bayer ordered dither between 5 alpha levels, one texel per art px, so the falloff has no edge.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  let vsig = '';
  function vignette(P) {
    const dpr = P.dpr || 1, w = Math.ceil((window.innerWidth || 1280) * dpr / P.k), h = Math.ceil((window.innerHeight || 720) * dpr / P.k), s = w + 'x' + h;
    if (s === vsig) return; vsig = s;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data, LV = 4, AMAX = 0.62;
    const cx = w / 2, cy = h * 0.47, rx = Math.max(w * 0.27, 150), ry = h * 0.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const e = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry), v = Math.min(1, Math.max(0, (1.75 - e) / 0.95)); // 1 inside the core, 0 beyond 1.75 radii
      const q = Math.min(LV, Math.floor(v * LV + BAYER[(y & 3) * 4 + (x & 3)] / 16));
      if (!q) continue;
      const i = (y * w + x) * 4; d[i] = 4; d[i + 1] = 2; d[i + 2] = 2; d[i + 3] = Math.round(255 * AMAX * q / LV);
    }
    g.putImageData(img, 0, 0);
    const st = document.documentElement.style;
    st.setProperty('--menu-vign', 'url("' + cv.toDataURL() + '")');
    st.setProperty('--menu-vw', w); st.setProperty('--menu-vh', h);
  }
  vignette(U);
  U.on(vignette);
  window.addEventListener('resize', () => vignette(U)); // a resize that keeps k still changes the art size
})(globalThis.ED || (globalThis.ED = {}));
