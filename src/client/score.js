// Composed adaptive score, client only: one piece per stratum, a camp piece, a boss variant of each stratum piece and three stingers.
// ED.Score.create(ctx, out, opts) -> engine on any BaseAudioContext (the game's AudioContext or an OfflineAudioContext bounce):
//   play(track, t, lv) starts a piece (crossfading the old one) · level(n, t) sets the layer mix 0 explore, 1 combat, 2 heavy · pump(until, now) schedules notes up to `until` · stop(t) · sting(kind, t) -> seconds.
// Layers (pad, mot, bass, perc, drums, lead) are gain nodes; a layer with a zero target schedules no notes, and a level change never restarts the piece.
(function (ED) {
  'use strict';
  const S = ED.Score = {};
  const LAYERS = ['pad', 'mot', 'bass', 'perc', 'drums', 'lead'];
  const TAU = { pad: 0.9, mot: 0.5, bass: 0.45, perc: 0.3, drums: 0.25, lead: 0.5 };
  const LV = [{ pad: 1, mot: 0.85, bass: 0, perc: 0, drums: 0, lead: 0 }, { pad: 0.9, mot: 1, bass: 1, perc: 1, drums: 0, lead: 0 }, { pad: 0.8, mot: 1, bass: 1, perc: 1, drums: 1, lead: 1 }];
  const LVB = [{ pad: 0.9, mot: 0.85, bass: 1, perc: 1, drums: 0, lead: 0 }, { pad: 0.9, mot: 1, bass: 1, perc: 1, drums: 0.9, lead: 0 }, { pad: 0.9, mot: 1, bass: 1, perc: 1, drums: 1, lead: 1 }];
  const LVC = { pad: 1, mot: 1, bass: 0.8, perc: 0.45, drums: 0, lead: 0 };
  const Q = { m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], tt: [0, 6, 7], cl: [0, 1, 6], dim: [0, 3, 6] };
  const VEL = { x: 1, X: 1.35, o: 0.5, g: 0.28 };
  const TOK = { 1: 0, 2: 2, 4: 5, 5: 7, 7: 10, 8: 12, b: 1, t: 6 };
  const BASS_BOSS = ['1.1.11.1.1.1.11.', '1.1.11.1.1.1.5.b'];
  const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---------------- pieces ----------------
  // S steps (16ths) per bar · root MIDI tonic · scale semitones · prog 8 bars [offset, chord] · mot.m phrase [step, scale degree, steps] over two bars · bass.p / perc / drums bar patterns (x X o g hit, . rest; an array alternates per bar, 8 entries = a fill on bar 8)
  // lead.p arp pattern over chord tones seq (index >= chord size = octave up) · amb ambience of the pad layer · g layer mix · rev / dly sends · lp tone cutoff · bossBpm bpm of the boss variant.
  const PIECES = {
    1: { id: 'ossuary', bpm: 58, S: 16, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], lp: 5200, rev: 0.32, dly: 1.5, dsend: 0.22, bossBpm: 104, amb: 'toll',
      prog: [[0, 'm'], [0, 'm'], [8, 'M'], [0, 'm'], [5, 'm'], [0, 'm'], [7, 'M'], [0, 'm']],
      pad: { v: 'strings', oct: 12, open: 1 },
      mot: { v: 'brass', oct: 0, m: [[0, 4, 6], [6, 3, 2], [8, 2, 4], [16, 1, 4], [20, 0, 12]] },
      bass: { v: 'brass', oct: -12, p: ['1.......1.1.....', '1.......1...5...'] },
      perc: [['frame', 'x.......x.....o.']],
      drums: [['taiko', 'X.......x.......'], ['frame', '....x.......x...'], ['tom', ['', '', '', '', '', '', '', '........x.x.xxxx']]],
      lead: { v: 'fmbell', p: '..x.....x.....x.', seq: [2, 1, 0, 1], oct: 24 },
      g: { pad: 1.29, mot: 0.83, bass: 0.99, perc: 1.6, drums: 1.55, lead: 0.92 }, bg: { pad: 1.33, mot: 0.75, bass: 0.76, perc: 0.83, drums: 0.92, lead: 0.61 } },
    2: { id: 'glowmire', bpm: 96, S: 14, root: 50, scale: [0, 2, 3, 5, 7, 9, 10], lp: 6800, rev: 0.42, dly: 0.75, dsend: 0.3, bossBpm: 118, amb: 'drip',
      prog: [[0, 'm7'], [0, 'm7'], [5, 'M'], [0, 'm7'], [0, 'm7'], [10, 'M'], [5, 'M'], [7, 'm']],
      pad: { v: 'pad', oct: 12, open: 1 },
      mot: { v: 'marimba', oct: 12, m: [[0, 4, 2], [2, 2, 2], [4, 0, 2], [6, 2, 2], [8, 4, 2], [10, 5, 2], [12, 4, 2], [14, 6, 4], [18, 5, 2], [20, 4, 2], [22, 2, 6]] },
      bass: { v: 'wetb', oct: -12, p: ['1.....1...5...', '1.....1...1.5.'] },
      perc: [['shk', 'X.x.x.X.x.X.x.'], ['wood', 'x.....o...o...']],
      drums: [['tom', 'x.....x...x...'], ['shk', '.o.o.o.o.o.o.o']],
      lead: { v: 'pluck', p: 'x.x.x.x.x.x.x.', seq: [0, 2, 1, 3], oct: 24 },
      g: { pad: 0.56, mot: 1.29, bass: 0.31, perc: 1.6, drums: 1.38, lead: 0.74 }, bg: { pad: 0.46, mot: 1.2, bass: 0.33, perc: 0.78, drums: 0.69, lead: 0.7 } },
    3: { id: 'sanctum', bpm: 68, S: 12, root: 48, scale: [0, 2, 3, 5, 7, 8, 10], lp: 1500, rev: 0.7, dly: 1.5, dsend: 0.36, bossBpm: 108, amb: 'wave',
      prog: [[0, 'm'], [0, 'm'], [8, 'M7'], [3, 'M'], [5, 'm7'], [0, 'm'], [7, 'sus4'], [0, 'm']],
      pad: { v: 'strings', oct: 12, open: 1 },
      mot: { v: 'fmbell', oct: 12, m: [[0, 0, 6], [6, 4, 3], [9, 3, 3], [12, 2, 6], [18, 0, 6]] },
      bass: { v: 'sub', oct: -12, p: ['1...........', '1.....5.....'] },
      perc: [['tom', 'x.....o.....']],
      drums: [['tom', 'x.....x.o.o.'], ['shk', 'o.o.o.o.o.o.'], ['tom', ['', '', '', '', '', '', '', 'x.x.x.xxxxxx']]],
      lead: { v: 'celesta', p: 'x...x...x...', seq: [2, 1, 0], oct: 24 },
      g: { pad: 1.22, mot: 1.32, bass: 0.25, perc: 1.3, drums: 1.08, lead: 0.76 }, bg: { pad: 1.15, mot: 0.99, bass: 0.24, perc: 0.79, drums: 0.85, lead: 0.45 } },
    4: { id: 'abyss', bpm: 60, S: 20, root: 41, scale: [0, 1, 3, 6, 7, 10], lp: 2600, rev: 0.7, dly: 1.5, dsend: 0.3, bossBpm: 100, amb: 'drone',
      prog: [[0, 'tt'], [0, 'cl'], [1, 'm'], [6, 'tt'], [0, 'tt'], [10, 'cl'], [6, 'cl'], [0, 'tt']],
      pad: { v: 'choir', oct: 12, open: 1 },
      mot: { v: 'whistle', oct: 12, m: [[0, 0, 8], [8, 3, 6], [14, 2, 4], [18, 1, 2], [20, 0, 14], [34, 3, 6]] },
      bass: { v: 'sub', oct: -12, p: ['1...................', '1.........t.........'] },
      perc: [['hb', 'x..o......x..o......']],
      drums: [['tom', 'x.........x...x.....'], ['hb', '..g.....g.....g.....'], ['anvil', ['', '', '', '', '', '', '', '..............x.....']]],
      lead: { v: 'fmbell', p: '....x.........x.....', seq: [4, 0, 3], oct: 12 },
      g: { pad: 0.46, mot: 0.74, bass: 0.32, perc: 1.23, drums: 1.6, lead: 0.96 }, bg: { pad: 0.83, mot: 0.79, bass: 0.29, perc: 0.77, drums: 0.88, lead: 0.6 } },
    camp: { id: 'camp', bpm: 64, S: 16, root: 50, scale: [0, 2, 4, 5, 7, 9, 11], lp: 4800, rev: 0.4, dly: 0.75, dsend: 0.26, camp: 1, amb: 'crackle',
      prog: [[0, 'add9'], [0, 'add9'], [9, 'm7'], [9, 'm7'], [5, 'M7'], [7, 'sus4'], [0, 'add9'], [0, 'add9']],
      pad: { v: 'pad', oct: 12, open: 0 },
      mot: { v: 'pluck', oct: 12, m: [[0, 4, 3], [4, 2, 2], [6, 4, 2], [8, 5, 4], [12, 4, 4], [16, 2, 4], [20, 1, 2], [22, 2, 2], [24, 0, 8]] },
      bass: { v: 'sub', oct: -12, p: ['1.......5.......'] },
      perc: [['shk', 'o.......o.......']], drums: [], lead: null,
      g: { pad: 0.34, mot: 1.82, bass: 0.19, perc: 1.6, drums: 0, lead: 0 } },
  };
  // Boss variant: same key, scale, chords and voices, 4/4 at bossBpm, a doom call, war drums and brass stabs.
  const BOSS_MOT = [[0, 0, 6], [6, 4, 2], [8, 3, 2], [10, 2, 2], [12, 0, 4], [16, 0, 2], [18, 0, 2], [20, 1, 2], [22, 0, 2], [24, 3, 4], [28, 2, 2], [30, 1, 2]];
  const bossOf = (P) => Object.assign({}, P, { id: P.id + '-boss', boss: 1, S: 16, bpm: P.bossBpm, swing: 0, amb: 'none', rev: P.rev * 0.8,
    mot: Object.assign({}, P.mot, { m: BOSS_MOT }), bass: Object.assign({}, P.bass, { p: BASS_BOSS }),
    perc: [['taiko', ['X...x...X...x...', 'X...x...X.x.x...']], ['tom', '..o...o...o...o.']],
    drums: [['tom', '..xx..xx..xx..xx'], ['snare', '....x.......x...'], ['shk', 'o.o.o.o.o.o.o.o.'], ['anvil', ['', '', '', '', '', '', '', '........x.x.x.x.']]],
    lead: Object.assign({}, P.lead, { p: 'x.xxx.xxx.xxx.xx', seq: [0, 1, 2, 1, 0, 2], oct: P.lead.oct }),
    g: P.bg });
  const BOSSES = {};
  S.PIECES = PIECES;
  // Piece for a track key ('camp', { s, boss }); null for 'none'.
  S.piece = (key) => {
    if (!key || key === 'none') return null;
    if (key === 'camp') return PIECES.camp;
    const s = Math.max(1, Math.min(ED.CONST.STRATA, (key.s | 0) || 1));
    return key.boss ? (BOSSES[s] || (BOSSES[s] = bossOf(PIECES[s]))) : PIECES[s];
  };

  // ---------------- motif ----------------
  const OPS = {
    id: (m) => m,
    up: (m) => m.map(n => [n[0], n[1] + 2, n[2]]),
    dn: (m) => m.map(n => [n[0], n[1] - 2, n[2]]),
    inv: (m) => { const c = m[0][1]; return m.map(n => [n[0], 2 * c - n[1], n[2]]); },
    half: (m) => m.slice(0, Math.max(3, Math.ceil(m.length * 0.6))),
    shift: (m, span) => m.map(n => [(n[0] + 4) % span, n[1], n[2]]).sort((a, b) => a[0] - b[0]),
    orn: (m) => { const o = []; for (const n of m) { o.push(n); if (n[2] >= 4) { o[o.length - 1] = [n[0], n[1], n[2] - 1]; o.push([n[0] + n[2] - 1, n[1] - 1, 1]); } } return o; },
    cad: (m, span) => { const o = m.map(n => n.slice()), l = o[o.length - 1]; l[1] = 0; l[2] = span - l[0]; return o; },
  };

  // ---------------- engine ----------------
  S.create = (ctx, out, opts) => {
    opts = opts || {};
    const sr = ctx.sampleRate, eng = { ctx, out, run: null, cur: null, lv: 0 };
    const nb = ctx.createBuffer(1, sr * 2, sr), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const sout = opts.sting || out, offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    const lite = () => !!(opts.lite && opts.lite());
    // shared reverb: a decaying, progressively darker noise tail
    let rev = null;
    {
      const len = Math.floor(sr * 2.4), ir = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const k = i / len; lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.45 * k); d[i] = lp * Math.pow(1 - k, 2.6) * 1.6; } }
      rev = ctx.createConvolver(); rev.buffer = ir; const ro = ctx.createGain(); ro.gain.value = 0.5; rev.connect(ro); ro.connect(out); eng.rev = rev;
    }
    const vib = ctx.createGain(); vib.gain.value = 14; // shared vibrato (cents) for sustained voices
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.1; lfo.connect(vib); lfo.start();

    const gn = (dst, v) => { const g = ctx.createGain(); if (v !== undefined) g.gain.value = v; g.connect(dst); return g; };
    const flt = (type, f, q, dst) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; b.connect(dst); return b; };
    const osc = (type, f, t0, t1, dst, det) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (det) o.detune.value = det; o.connect(dst); o.start(t0); o.stop(t1); return o; };
    const nz = (t0, dur, dst) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.connect(dst); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur); return s; };
    const ex = (p, t, a, pk, d) => { p.setValueAtTime(0.0001, t); p.exponentialRampToValueAtTime(Math.max(0.0002, pk), t + a); p.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const sus = (p, t, a, pk, hold, rel) => { hold = Math.max(a, hold); p.setValueAtTime(0.0001, t); p.exponentialRampToValueAtTime(Math.max(0.0002, pk), t + a); p.setValueAtTime(Math.max(0.0002, pk), t + hold); p.exponentialRampToValueAtTime(0.0001, t + hold + rel); };

    // ---- pitched voices: (t, Hz, seconds, velocity, destination) ----
    const VOX = {
      strings(t, f, dur, v, d) { // two detuned saws behind a lowpass, slow bow
        const a = Math.min(0.45, dur * 0.4), e = t + dur + 0.8, g = gn(d), lp = flt('lowpass', Math.min(f * 4, 2400), 0.4, g);
        sus(g.gain, t, a, 0.1 * v, dur, 0.7); osc('sawtooth', f, t, e, lp, -8); osc('sawtooth', f, t, e, lp, 8);
      },
      pad(t, f, dur, v, d) { // soft triangle and sine bed
        const a = Math.min(1.2, dur * 0.45), e = t + dur + 1.6, g = gn(d), lp = flt('lowpass', Math.min(f * 3, 1800), 0.3, g);
        sus(g.gain, t, a, 0.16 * v, dur, 1.4); osc('triangle', f, t, e, lp, -5); osc('triangle', f, t, e, lp, 6); osc('sine', f * 2, t, e, lp);
      },
      glass(t, f, dur, v, d) { // sine stack, cold and bright
        const a = Math.min(1.4, dur * 0.45), e = t + dur + 1.6, g = gn(d);
        sus(g.gain, t, a, 0.1 * v, dur, 1.4); osc('sine', f, t, e, g); osc('sine', f * 2.003, t, e, gn(g, 0.5)); osc('sine', f * 3.01, t, e, gn(g, 0.22));
      },
      choir(t, f, dur, v, d) { // detuned saws through two vowel formants, shared vibrato
        const a = Math.min(1.0, dur * 0.4), e = t + dur + 1.3, g = gn(d), oh = f < 150, F = oh ? [450, 800, 5, 2.4] : [800, 1150, 4, 2];
        sus(g.gain, t, a, 0.16 * v, dur, 1.2);
        const b1 = flt('bandpass', F[0], 6, gn(g, F[2])), b2 = flt('bandpass', F[1], 8, gn(g, F[3]));
        for (const c of [-11, 11]) { const o = osc('sawtooth', f, t, e, b1, c); o.connect(b2); vib.connect(o.detune); }
      },
      brass(t, f, dur, v, d) { // detuned saws with an opening lowpass
        const a = 0.05 + 0.05 * Math.min(1, dur), e = t + dur + 0.3, g = gn(d), lp = flt('lowpass', f * 1.5, 1.5, g);
        lp.frequency.setValueAtTime(f * 1.4, t); lp.frequency.linearRampToValueAtTime(f * 5, t + a * 3); lp.frequency.linearRampToValueAtTime(f * 3, t + Math.max(a * 3, dur));
        sus(g.gain, t, a, 0.17 * v, dur, 0.25); osc('sawtooth', f, t, e, lp, -5); osc('sawtooth', f, t, e, lp, 5);
      },
      marimba(t, f, dur, v, d) {
        const g = gn(d), g2 = gn(d); ex(g.gain, t, 0.002, 0.34 * v, 0.55); osc('sine', f, t, t + 0.8, g); ex(g2.gain, t, 0.002, 0.14 * v, 0.07); osc('sine', f * 3.98, t, t + 0.2, g2);
      },
      pluck(t, f, dur, v, d) { // harp-like: triangle behind a closing lowpass
        const g = gn(d), lp = flt('lowpass', Math.min(f * 8, 6000), 0.7, g);
        lp.frequency.setValueAtTime(Math.min(f * 8, 6000), t); lp.frequency.exponentialRampToValueAtTime(Math.max(320, f * 1.3), t + 0.5);
        ex(g.gain, t, 0.004, 0.3 * v, 0.7); osc('triangle', f, t, t + 0.9, lp); osc('sine', f * 2, t, t + 0.9, gn(lp, 0.3));
      },
      celesta(t, f, dur, v, d) {
        const g = gn(d), g2 = gn(d); ex(g.gain, t, 0.003, 0.26 * v, 1.2); osc('sine', f, t, t + 1.4, g); osc('sine', f * 2, t, t + 1.4, gn(g, 0.35)); ex(g2.gain, t, 0.002, 0.1 * v, 0.25); osc('sine', f * 4.07, t, t + 0.4, g2);
      },
      fmbell(t, f, dur, v, d) { // two-operator bell: the modulator index decays
        const c = ctx.createOscillator(), m = ctx.createOscillator(), g = gn(d), mg = gn(c.frequency), L = Math.min(2.4, Math.max(0.8, dur * 1.5));
        c.frequency.value = f; m.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 1.8, t); mg.gain.exponentialRampToValueAtTime(f * 0.03, t + L * 0.8);
        ex(g.gain, t, 0.003, 0.3 * v, L); c.connect(g); m.connect(mg); c.start(t); m.start(t); c.stop(t + L + 0.1); m.stop(t + L + 0.1);
      },
      bell(t, f, dur, v, d) { // tolled bell: five inharmonic partials with their own decays
        for (const [r, a, k] of [[0.5, 0.5, 1], [1, 1, 0.85], [1.2, 0.5, 0.55], [1.5, 0.35, 0.4], [2, 0.4, 0.3]]) { const g = gn(d); ex(g.gain, t, 0.004, 0.22 * a * v, dur * k); osc('sine', f * r, t, t + dur * k + 0.1, g); }
      },
      sub(t, f, dur, v, d) { // sine with a faint octave
        const e = t + dur + 0.3, g = gn(d); sus(g.gain, t, 0.03, 0.62 * v, dur, 0.25); osc('sine', f, t, e, g); osc('triangle', f * 2, t, e, gn(g, 0.3));
      },
      sawb(t, f, dur, v, d) { // sawtooth bass with a plucked lowpass
        const e = t + dur + 0.15, g = gn(d), lp = flt('lowpass', f * 2.2, 3, g);
        lp.frequency.setValueAtTime(Math.max(f * 7, 900), t); lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2.2, 300), t + 0.14);
        sus(g.gain, t, 0.008, 0.34 * v, dur * 0.9, 0.1); osc('sawtooth', f, t, e, lp, -6); osc('sawtooth', f, t, e, lp, 9);
      },
      wetb(t, f, dur, v, d) { // sine and detuned triangles with a downward glide
        const e = t + dur + 0.35, g = gn(d), lp = flt('lowpass', 560, 1.1, g); sus(g.gain, t, 0.015, 0.5 * v, dur, 0.3);
        const o = osc('sine', f, t, e, lp); o.frequency.setValueAtTime(f * 1.12, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        osc('triangle', f, t, e, gn(lp, 0.5), 11); osc('triangle', f, t, e, gn(lp, 0.5), -11);
      },
      lead(t, f, dur, v, d) { // saw and square pair, short pluck
        const e = t + dur + 0.1, g = gn(d), lp = flt('lowpass', f * 4, 2.5, g);
        lp.frequency.setValueAtTime(f * 6, t); lp.frequency.exponentialRampToValueAtTime(f * 2, t + 0.2); ex(g.gain, t, 0.006, 0.17 * v, Math.max(0.15, dur));
        osc('sawtooth', f, t, e, lp, -7); osc('square', f, t, e, gn(lp, 0.5), 7);
      },
      whistle(t, f, dur, v, d) { // thin sine with vibrato
        const g = gn(d), o = osc('sine', f, t, t + dur + 1, g); sus(g.gain, t, Math.min(0.8, dur * 0.5), 0.2 * v, dur, 0.9); vib.connect(o.detune);
      },
    };
    // ---- percussion: (t, velocity, destination) ----
    const DR = {
      taiko(t, v, d) { const g = gn(d), o = osc('sine', 120, t, t + 0.6, g); ex(g.gain, t, 0.003, 0.7 * v, 0.45); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.22); const ng = gn(d); ex(ng.gain, t, 0.002, 0.35 * v, 0.09); nz(t, 0.14, flt('lowpass', 800, 0.7, ng)); },
      tom(t, v, d) { const g = gn(d), o = osc('sine', 92, t, t + 0.5, g); ex(g.gain, t, 0.003, 0.65 * v, 0.34); o.frequency.setValueAtTime(92, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18); const ng = gn(d); ex(ng.gain, t, 0.002, 0.18 * v, 0.06); nz(t, 0.1, flt('lowpass', 500, 0.7, ng)); },
      frame(t, v, d) { const g = gn(d), o = osc('sine', 190, t, t + 0.4, g); ex(g.gain, t, 0.003, 0.45 * v, 0.24); o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(118, t + 0.12); const ng = gn(d); ex(ng.gain, t, 0.002, 0.2 * v, 0.05); nz(t, 0.09, flt('bandpass', 1000, 1.2, ng)); },
      wood(t, v, d) { const g = gn(d), o = osc('sine', 260, t, t + 0.3, g); ex(g.gain, t, 0.002, 0.4 * v, 0.12); o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(190, t + 0.06); const ng = gn(d); ex(ng.gain, t, 0.001, 0.12 * v, 0.03); nz(t, 0.06, flt('bandpass', 1800, 2, ng)); },
      kick(t, v, d) { const g = gn(d), o = osc('sine', 110, t, t + 0.4, g); ex(g.gain, t, 0.002, 0.7 * v, 0.26); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.1); },
      shk(t, v, d) { const ng = gn(d); ex(ng.gain, t, 0.008, 0.2 * v, 0.05); nz(t, 0.1, flt('highpass', 5500, 0.7, ng)); },
      anvil(t, v, d) { const k = 0.97 + Math.random() * 0.06; for (const [f, a, L] of [[880, 1, 0.5], [1370, 0.7, 0.36], [2210, 0.5, 0.22], [3140, 0.3, 0.14]]) { const g = gn(d); ex(g.gain, t, 0.001, 0.26 * a * v, L); osc('sine', f * k, t, t + L + 0.1, g); } const ng = gn(d); ex(ng.gain, t, 0.001, 0.3 * v, 0.03); nz(t, 0.08, flt('bandpass', 4200, 1.5, ng)); },
      snare(t, v, d) { const ng = gn(d); ex(ng.gain, t, 0.002, 0.5 * v, 0.17); nz(t, 0.25, flt('bandpass', 1900, 0.8, ng)); const g = gn(d), o = osc('sine', 210, t, t + 0.2, g); ex(g.gain, t, 0.002, 0.3 * v, 0.09); o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(130, t + 0.08); },
      tick(t, v, d) { const g = gn(d); ex(g.gain, t, 0.001, 0.3 * v, 0.06); osc('sine', 4300, t, t + 0.1, g); const ng = gn(d); ex(ng.gain, t, 0.001, 0.45 * v, 0.025); nz(t, 0.05, flt('highpass', 9000, 0.7, ng)); },
      hb(t, v, d) { const g = gn(d), o = osc('sine', 70, t, t + 0.4, g); ex(g.gain, t, 0.006, 0.85 * v, 0.26); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.18); const g2 = gn(d), o2 = osc('triangle', 130, t, t + 0.2, g2); ex(g2.gain, t, 0.004, 0.3 * v, 0.1); o2.frequency.setValueAtTime(130, t); o2.frequency.exponentialRampToValueAtTime(75, t + 0.1); },
      drop(t, v, d) { const g = gn(d), o = osc('sine', 600, t, t + 0.3, g); ex(g.gain, t, 0.004, 0.3 * v, 0.14); o.frequency.setValueAtTime(600 + Math.random() * 300, t); o.frequency.exponentialRampToValueAtTime(1500 + Math.random() * 600, t + 0.07); },
    };
    eng.VOX = VOX; eng.DR = DR;

    // ---- ambience of the pad layer, once per bar ----
    const AMB = {
      none() { },
      toll(r, t, bar) { if (bar % 2 === 0) VOX.bell(t, midiHz(r.P.root + (bar % 4 === 2 ? 7 : 0)), 6, 0.7, r.lay.pad); },
      drip(r, t) { for (let i = 0; i < 2; i++) if (r.rng() < 0.7) DR.drop(t + r.rng() * r.bar, 0.6, r.lay.pad); },
      glint(r, t) { const P = r.P; for (let i = 0; i < 2; i++) if (r.rng() < 0.6) VOX.celesta(t + r.rng() * r.bar, midiHz(P.root + 24 + P.scale[(r.rng() * P.scale.length) | 0]), 1.5, 0.4, r.lay.pad); },
      rumble(r, t) { const g = gn(r.lay.pad); sus(g.gain, t, r.bar * 0.4, 0.22, r.bar * 0.5, r.bar * 0.6); nz(t, r.bar * 1.6, flt('lowpass', 150, 0.8, g)); },
      wave(r, t) { const g = gn(r.lay.pad), f = flt('bandpass', 250, 1.2, g); sus(g.gain, t, r.bar * 0.45, 0.2, r.bar * 0.55, r.bar * 0.6); f.frequency.setValueAtTime(240, t); f.frequency.linearRampToValueAtTime(720, t + r.bar * 0.5); f.frequency.linearRampToValueAtTime(260, t + r.bar * 1.1); nz(t, r.bar * 1.7, f); },
      drone(r, t, bar) { if (bar % 2) return; const f = midiHz(r.P.root - 12); VOX.sub(t, f * 1.012, r.bar * 2, 0.6, r.lay.pad); VOX.sub(t, f * 1.414, r.bar * 2, 0.45, r.lay.pad); }, // a tritone above the bass, beating against it
      crackle(r, t) { for (let i = 0; i < 5; i++) if (r.rng() < 0.6) { const at = t + r.rng() * r.bar, g = gn(r.lay.pad); ex(g.gain, at, 0.001, 0.05 + r.rng() * 0.06, 0.012); nz(at, 0.03, flt('highpass', 2500 + r.rng() * 2500, 0.7, g)); } },
    };

    // ---- runs ----
    const chordAt = (P, bi) => (P.ch || (P.ch = P.prog.map(c => ({ off: c[0], key: c[0] + c[1], iv: Q[c[1]] }))))[bi % P.prog.length];
    function hits(r, list, bi, pos, t, d) { for (let i = 0; i < list.length; i++) { const pat = list[i][1], p = Array.isArray(pat) ? pat[bi % pat.length] : pat, v = p && VEL[p[pos]]; if (v) DR[list[i][0]](t, v * (0.92 + 0.16 * r.rng()), d); } }
    const degMidi = (P, d, oct) => { const L = P.scale.length, o = Math.floor(d / L); return P.root + oct + P.scale[d - o * L] + 12 * o; };
    function buildMotif(r, cyc) {
      const P = r.P, M = P.mot, span = P.S * 2, rng = mulberry(hash(P.id) + cyc * 977), pick = (a) => a[(rng() * a.length) | 0];
      const form = cyc === 0 ? ['id', 'up', 'id', 'half'] : ['id', pick(['up', 'dn', 'inv', 'shift', 'orn']), cyc % 2 ? 'id' : pick(['id', 'orn']), pick(['half', 'orn', 'half'])];
      const mm = new Array(P.S * 8);
      for (let ph = 0; ph < 4; ph++) {
        let notes = OPS[form[ph]](M.m, span);
        if (ph === 3) notes = OPS.cad(notes, span);
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i], st = ph * span + n[0];
          if (st >= P.S * 8 || n[0] >= span) continue;
          (mm[st] || (mm[st] = [])).push({ m: degMidi(P, n[1], M.oct), len: n[2], ph, vel: i === 0 ? 1.1 : 0.95 });
        }
      }
      return mm;
    }
    function applyLevel(r, lv, t) {
      const T = r.P.camp ? LVC : (r.P.boss ? LVB : LV)[lv];
      for (const k of LAYERS) {
        const g = (T[k] || 0) * ((r.P.g && r.P.g[k]) || 0), p = r.lay[k].gain;
        r.act[k] = g > 0.01 && !(k === 'lead' && !r.P.lead);
        p.cancelScheduledValues(t); p.setTargetAtTime(Math.max(0.0001, g), t, TAU[k]);
      }
      r.lv = lv;
    }
    function makeRun(P, t0, lv) {
      const nodes = [], reg = (n) => { nodes.push(n); return n; };
      const bus = reg(gn(out)); bus.gain.setValueAtTime(0.0001, t0); bus.gain.setTargetAtTime(1, t0, 0.55);
      const lp = reg(flt('lowpass', P.lp || 9000, 0.5, bus)), mix = reg(gn(lp));
      if (P.dly && !lite()) {
        const dn = reg(ctx.createDelay(2)); dn.delayTime.value = 60 / P.bpm * P.dly;
        const fb = reg(gn(dn, 0.36)), dl = reg(flt('lowpass', 2300, 0.3, fb)), ds = reg(gn(dn, P.dsend || 0.2));
        dn.connect(dl); dl.connect(lp); mix.connect(ds);
      }
      if (rev && P.rev && !lite()) { const rs = reg(gn(rev, P.rev)); bus.connect(rs); }
      const lay = {}; for (const k of LAYERS) { lay[k] = reg(gn(mix)); lay[k].gain.value = 0.0001; }
      const sd = 60 / P.bpm / 4, r = { P, bus, nodes, lay, act: {}, k: 0, next: t0, sd, bar: sd * P.S, rng: mulberry(hash(P.id)), cyc: -1, mm: null, padUntil: 0, arp: 0, lv: -1, dead: false };
      applyLevel(r, lv, t0);
      return r;
    }
    function fadeOut(r, t) {
      r.dead = true; r.bus.gain.cancelScheduledValues(t); r.bus.gain.setTargetAtTime(0, t, 0.45);
      if (!offline) setTimeout(() => { for (const n of r.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } }, 4500);
    }

    function stepAt(r, k, t) {
      const P = r.P, S = P.S, bar = (k / S) | 0, pos = k - bar * S, bi = bar % 8, cyc = (bar / 8) | 0, act = r.act, lay = r.lay;
      if (r.cyc !== cyc) { r.cyc = cyc; r.mm = buildMotif(r, cyc); }
      if (P.swing && (pos & 1)) t += P.swing * r.sd;
      const ch = chordAt(P, bi);
      if (pos === 0) {
        r.arp = 0;
        if (act.pad && bar >= r.padUntil) {
          let n = 1; while (bi + n < 8 && n < 3 && chordAt(P, bi + n).key === ch.key) n++;
          r.padUntil = bar + n;
          const base = P.root + ch.off + P.pad.oct, dur = n * r.bar, v = 0.85;
          for (let i = 0; i < ch.iv.length; i++) VOX[P.pad.v](t, midiHz(base + ch.iv[i] - (i === 0 && P.pad.open ? 12 : 0)), dur, v, lay.pad);
        }
        if (act.pad) AMB[P.amb](r, t, bar);
        if (P.boss && act.drums) for (let i = 0; i < ch.iv.length; i++) VOX.brass(t, midiHz(P.root + ch.off + 12 + ch.iv[i]), r.sd * 3, 0.9, lay.drums);
      }
      if (act.mot) {
        const evs = r.mm[bi * S + pos];
        if (evs) for (let i = 0; i < evs.length; i++) { const e = evs[i]; if (r.lv === 0 && !P.camp && (e.ph & 1)) continue; VOX[P.mot.v](t, midiHz(e.m), e.len * r.sd * 0.95, e.vel * (0.9 + 0.2 * r.rng()), lay.mot); }
      }
      if (act.bass) {
        const pat = P.bass.p, p = pat[bi % pat.length], c = p[pos];
        if (c && c !== '.') {
          let n = pos + 1; while (n < S && p[n] === '.') n++;
          const semi = c === '3' ? ch.iv[1] : TOK[c];
          VOX[P.bass.v](t, midiHz(P.root + ch.off + semi + P.bass.oct), (n - pos) * r.sd * 0.92, 0.9 + 0.2 * r.rng(), lay.bass);
        }
      }
      if (act.perc) hits(r, P.perc, bi, pos, t, lay.perc);
      if (act.drums) hits(r, P.drums, bi, pos, t, lay.drums);
      if (act.lead) {
        const L = P.lead, c = L.p[pos];
        if (c && c !== '.') {
          let n = pos + 1; while (n < S && L.p[n] === '.') n++;
          const ci = L.seq[r.arp++ % L.seq.length], note = P.root + ch.off + ch.iv[ci % ch.iv.length] + 12 * Math.floor(ci / ch.iv.length) + L.oct;
          VOX[L.v](t, midiHz(note), (n - pos) * r.sd * 0.9, 0.9 + 0.2 * r.rng(), lay.lead);
        }
      }
    }

    // ---- control ----
    eng.play = (track, t, lv) => {
      const P = S.piece(track);
      if (eng.run) fadeOut(eng.run, t);
      eng.run = null; eng.cur = null;
      if (!P) return;
      eng.run = makeRun(P, t + 0.05, Math.max(0, Math.min(2, lv | 0)));
      eng.cur = typeof track === 'string' ? track : 's' + ((track.s | 0) || 1) + (track.boss ? 'b' : '');
    };
    eng.level = (n, t) => { const r = eng.run; n = Math.max(0, Math.min(2, n | 0)); eng.lv = n; if (r && !r.P.camp && n !== r.lv) applyLevel(r, n, t); };
    eng.stop = (t) => { if (eng.run) fadeOut(eng.run, t); eng.run = null; eng.cur = null; };
    // Schedules every step starting before `until`; `now` (the context clock) resynchronises a run the page stalled behind.
    eng.pump = (until, now) => {
      const r = eng.run; if (!r) return;
      if (now && r.next < now - 0.15) { const skip = Math.ceil((now - r.next) / r.sd); r.k += skip; r.next += skip * r.sd; }
      while (r.next < until) { stepAt(r, r.k, r.next); r.k++; r.next += r.sd; }
    };

    // ---- stingers ----
    eng.sting = (kind, t) => {
      const bus = gn(sout, 1.6), root = 62, m = (n) => midiHz(root + n);
      if (rev) { const rs = gn(rev, 0.35); bus.connect(rs); }
      let dur;
      if (kind === 'victory') { // timpani roll, a rising brass call, then a held D major chord with a bell and celesta sparkle
        dur = 6.2;
        [0, 0.28, 0.54, 0.74, 0.9, 1.02, 1.12, 1.2].forEach((x, i) => DR.taiko(t + x, 0.5 + i * 0.08, bus));
        [[0, 0, 0.34], [7, 0.4, 0.34], [12, 0.8, 0.4], [16, 1.25, 0.3]].forEach(([n, x, d]) => { VOX.brass(t + x, m(n - 12), d, 1.1, bus); VOX.brass(t + x, m(n - 24), d, 0.9, bus); });
        DR.taiko(t + 1.6, 1.4, bus); DR.anvil(t + 1.6, 0.8, bus);
        [0, 4, 7, 12, 16].forEach((n, i) => { VOX.strings(t + 1.6, m(n - 12), 3.6, 1.1, bus); VOX.celesta(t + 1.75 + i * 0.13, m(n + 12), 2, 0.9, bus); });
        VOX.brass(t + 1.6, m(-24), 3.2, 1, bus); VOX.brass(t + 1.6, m(-17), 3.2, 0.8, bus); VOX.bell(t + 1.6, m(-12), 4.5, 0.8, bus);
      } else if (kind === 'boss') { // short brass triumph
        dur = 3.4;
        [0, 0.26, 0.52].forEach(x => DR.taiko(t + x, 1.0, bus));
        [[0, 0, 0.26], [7, 0.26, 0.26], [12, 0.52, 1.6]].forEach(([n, x, d]) => { VOX.brass(t + x, m(n - 12), d, 1.1, bus); VOX.brass(t + x, m(n - 24), d, 0.9, bus); });
        [0, 4, 7, 12].forEach((n, i) => { VOX.strings(t + 0.52, m(n - 12), 1.8, 1, bus); VOX.celesta(t + 0.6 + i * 0.1, m(n + 12), 1.6, 0.8, bus); });
        VOX.bell(t + 0.52, m(-12), 3, 0.7, bus);
      } else { // defeat: a falling minor line over tolling bells and a sub drop
        dur = 8;
        [[0, 0], [-2, 1.2], [-4, 2.4], [-5, 3.6], [-7, 4.8]].forEach(([n, x]) => VOX.strings(t + x, m(n - 12), 1.6, 1, bus));
        [0, 3, 7].forEach(n => VOX.strings(t, m(n - 24), 5, 0.7, bus));
        [0, 1.9, 3.8, 5.7].forEach((x, i) => VOX.bell(t + x, m(-24), 5, 0.9 - i * 0.12, bus));
        const g = gn(bus), o = osc('sine', 90, t, t + 3, g); ex(g.gain, t, 0.05, 0.6, 2.6); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 2.8);
        const ng = gn(bus); sus(ng.gain, t, 1.5, 0.12, 2.5, 3); nz(t, 7, flt('lowpass', 320, 0.8, ng));
      }
      if (!offline) setTimeout(() => { try { bus.disconnect(); } catch (e) { /* gone */ } }, (dur + 3) * 1000);
      return dur;
    };
    return eng;
  };
})(globalThis.ED || (globalThis.ED = {}));
