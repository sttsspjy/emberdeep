// UI pixel art: ASCII masks for the kit frames and sprites, baked by ED.PixUI.frame into CSS vars (--fr-<name>[-<variant>]) at boot.
// Chars: o = #222222 outline (the art pipeline's), . = transparent; the rest map through each frame's palette (custom property names recolour per token).
(function (ED) {
  'use strict';
  const U = ED.PixUI; if (!U) return;
  const OL = '#222222';

  // plate: soot panel, iron line, brass corner brackets with a rivet. slice 6, visible frame 3.
  U.frame('panel', {
    rows: [
      '.oooooooooooooo.',
      'oBBBBBLLLLBBBBBo',
      'oBbkkkkkkkkkkbBo',
      'oBkbffffffffbkBo',
      'oBkffffffffffkBo',
      'oBkffffffffffkBo',
      'oLkffffffffffkLo',
      'oLkffffffffffkLo',
      'oLkffffffffffkLo',
      'oLkffffffffffkLo',
      'oBkffffffffffkBo',
      'oBkffffffffffkBo',
      'oBkbffffffffbkBo',
      'oBbkkkkkkkkkkbBo',
      'oBBBBBLLLLBBBBBo',
      '.oooooooooooooo.',
    ],
    pal: { o: OL, B: '--brass-hi', b: '--brass', L: '--line-hi', k: '#0b0806', f: '--panel-solid' },
    slice: 6, border: 3,
    variants: { dim: { B: '--brass', b: '--line-hi', L: '--line' }, gold: { B: '--gold', b: '--gold-lo', L: '--gold-lo' }, ember: { B: '--ember-hi', b: '--ember', L: '--ember-lo' } },
  });

  // button: brass corner pixels, highlight row, shade row. slice 4, visible frame 2.
  const BTN = {
    pal: { o: OL, B: '--brass', L: '--line-hi', h: '#3e2f23', f: '#2c2119', d: '#1d1511' },
    variants: {
      hot: { B: '--brass-hi', L: '--brass', h: '#4d3a2b', f: '#382a1f', d: '#241a13' },
      primary: { B: '#ffe0bd', L: '--ember-hi', h: '#ffc58f', f: '--ember', d: '--ember-lo' },
      'primary-hot': { B: '#fff0dc', L: '#ffd5a8', h: '#ffd8b0', f: '#ff9a52', d: '#c95d22' },
      danger: { B: '#a03a2c', L: '#7a2a20', h: '#7a2d22', f: '#5a1f18', d: '#3b120d' },
      'danger-hot': { B: '#ef8070', L: '#d2574a', h: '#8e3428', f: '#6e271e', d: '#4a1610' },
      ghost: { B: '--line-hi', L: '--line', h: 'transparent', f: 'transparent', d: 'transparent' },
      'ghost-hot': { B: '--brass', L: '--line-hi', h: 'rgba(255, 214, 160, 0.06)', f: 'rgba(255, 214, 160, 0.06)', d: 'rgba(255, 214, 160, 0.06)' },
      off: { B: '#3a2c22', L: '#3a2c22', h: '#221a14', f: '#1d1612', d: '#161009' },
    },
  };
  U.frame('btn', Object.assign({
    rows: [
      '.oooooooooo.',
      'oBBBLLLLBBBo',
      'oBhhhhhhhhBo',
      'oBffffffffBo',
      'oLffffffffLo',
      'oLffffffffLo',
      'oLffffffffLo',
      'oLffffffffLo',
      'oBffffffffBo',
      'oBddddddddBo',
      'oBBBLLLLBBBo',
      '.oooooooooo.',
    ],
    slice: 4, border: 2,
  }, BTN));
  // menu button: longer brass brackets. slice 5, visible frame 2.
  U.frame('menu', Object.assign({
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
      'oBddddddddddBo',
      'oBBBBLLLLBBBBo',
      '.oooooooooooo.',
    ],
    slice: 5, border: 2,
  }, BTN));

  // well: sunken field (inputs, selects, tracks); shadow on the top and left. slice 3, visible frame 2.
  U.frame('well', {
    rows: [
      '.ooooooo.',
      'oLLLLLLLo',
      'oLdddddLo',
      'oLdffffLo',
      'oLdffffLo',
      'oLdffffLo',
      'oLdffffLo',
      'oLLLLLLLo',
      '.ooooooo.',
    ],
    pal: { o: OL, L: '--line-hi', d: '#070504', f: '#0f0a07' },
    slice: 3, border: 2,
    variants: { focus: { L: '--ember-hi' }, on: { L: '--ember', d: '#3a1a08', f: '#5a2d12' } },
  });

  // keycap: brass rim, two-row lip at the bottom. slice 3 (visible 2 top and sides, 3 bottom).
  U.frame('kbd', {
    rows: [
      '.ooooooo.',
      'oBBBBBBBo',
      'oBfffffBo',
      'oBfffffBo',
      'oBfffffBo',
      'oBfffffBo',
      'obbbbbbbo',
      'obbbbbbbo',
      '.ooooooo.',
    ],
    pal: { o: OL, B: '--brass', f: '#2c2119', b: '#5a4128' },
    slice: 3, border: 2,
  });

  // focus caret: ember arrow pointing right (mirror with scaleX(-1)).
  U.frame('caret', {
    rows: ['oo...', 'oEo..', 'oEEo.', 'oEHEo', 'oEEo.', 'oEo..', 'oo...'],
    pal: { o: OL, E: '--ember', H: '--ember-hi' },
    variants: { dark: { E: '#1b0f08', H: '#4a2410', o: 'transparent' }, danger: { E: '--danger', H: '#ff9a88' } },
  });
  // gem: small ember diamond (dividers, markers).
  U.frame('gem', {
    rows: ['..o..', '.oHo.', 'oHEEo', '.oLo.', '..o..'],
    pal: { o: OL, H: '--ember-hi', E: '--ember', L: '--ember-lo' },
    variants: { brass: { H: '--brass-hi', E: '--brass', L: '#5a4128' } },
  });
  // chev: down arrow (select boxes).
  U.frame('chev', { rows: ['ooooooo', 'oEEEEEo', '.oEEEo.', '..oEo..', '...o...'], pal: { o: OL, E: '--brass-hi' } });
  // knob: slider thumb.
  U.frame('knob', {
    rows: ['...o...', '..oHo..', '.oHHEo.', 'oHHEEEo', '.oEELo.', '..oLo..', '...o...'],
    pal: { o: OL, H: '#ffe0bd', E: '--ember-hi', L: '--ember' },
  });
  // ember: 4-frame flame strip (inline currency icon; .px-strip animates it).
  U.frame('ember', {
    rows: [
      ['..o...', '.oHo..', '.oHHo.', 'oHYHHo', 'oEYYHo', 'oEHYEo', 'oLEEEo', '.oooo.'],
      ['...o..', '..oHo.', '.oHHo.', 'oHHYHo', 'oEYYHo', 'oEYHEo', 'oLEEEo', '.oooo.'],
      ['..o...', '..oo..', '.oHHo.', 'oHYHHo', 'oHYYEo', 'oEHYEo', 'oLEEEo', '.oooo.'],
      ['...o..', '..oHo.', '.oHHHo', 'oHHYHo', 'oEYYEo', 'oEHYEo', 'oLEEEo', '.oooo.'],
    ],
    pal: { o: OL, Y: '#fff3c4', H: '--ember-hi', E: '--ember', L: '--ember-lo' },
  });
  // dither: 2 x 2 checker for stepped scrims (background-size: calc(2 * var(--p))).
  U.frame('dither', { rows: ['o.', '.o'], pal: { o: 'rgba(3, 2, 2, 0.4)' } });
})(globalThis.ED || (globalThis.ED = {}));
