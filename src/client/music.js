// Synthesized adaptive music (no audio files). ED.Music drives a sequencer engine (Score, ported from the legacy score) on the music bus of ED.Audio.
// Tracks: 'title' (menus), 'run<n>' per stage, 'boss<n>' and 'final<n>' (the final boss); theme n: 1 Ossuary, 2 Glowmire, 4 Abyss (by ED.STAGES id). A switch lands on the next bar
// while the old track fades over a bar. Level 0..3 sets the layer mix (pad, arp, bass, drums, perc, lead): in a run from the alive foe count (60 / 220 / 480), at least 1 from minute 8,
// raised for 8-12 s by swarm / elite / boss warnings; during a boss from its HP (above 66% 1, above 33% 2, else 3; enraged 3). Rises at once, falls one step after 4 s lower.
// Hero HP under 30% muffles the music and beats a heart; downed muffles harder; the solo pause muffles. Stingers: a mid-boss killed, victory, defeat (then the menu track).
// Cost: notes are scheduled from a 100 ms timer 0.4 s ahead; ED.Music.update(view, dt) per frame only reads counts.
(function (ED) {
  'use strict';
  const S = {};
  const LAYERS = ['pad', 'arp', 'bass', 'drums', 'perc', 'lead'];
  const LITE_OFF = { pad: 1, arp: 1, lead: 1 };
  const TAU = { pad: 0.9, arp: 0.4, bass: 0.3, drums: 0.2, perc: 0.3, lead: 0.5 };
  const ONE = { pad: 1, arp: 1, bass: 1, drums: 1, perc: 1, lead: 1 };
  const HEAVY = { pad: 0.9, arp: 1.05, bass: 1.1, drums: 1.12, perc: 1.2, lead: 1.1 };
  // layer multipliers per level 0..3: a run opens on pad, bass and drums, adds arp and perc at 1, the lead at 2, goes heavy at 3; a boss plays its phase (1..3)
  const LVT = {
    calm: [ONE, ONE, ONE, ONE],
    run: [{ pad: 1, arp: 0, bass: 0.9, drums: 0.85, perc: 0, lead: 0 }, { pad: 1, arp: 0.9, bass: 1, drums: 1, perc: 0.7, lead: 0 }, ONE, HEAVY],
    boss: [{ pad: 1, arp: 1, bass: 1, drums: 0.95, perc: 0.75, lead: 0.85 }, { pad: 1, arp: 1, bass: 1, drums: 0.95, perc: 0.75, lead: 0.85 }, ONE, HEAVY],
  };
  const GDEF = { calm: { pad: 0.36, arp: 0.54, bass: 0.16, drums: 0.72, perc: 3.5, lead: 0.6 }, run: { pad: 0.28, arp: 0.5, bass: 0.21, drums: 0.84, perc: 0.46, lead: 0.6 }, boss: { pad: 0.29, arp: 0.48, bass: 0.22, drums: 0.78, perc: 0.42, lead: 0.68 } }; // layer gains per kind (a piece's g multiplies them)
  const Q = { m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], tt: [0, 6, 7], cl: [0, 1, 6], dim: [0, 3, 6], p5: [0, 7, 12] };
  const VEL = { x: 1, X: 1.35, o: 0.5, g: 0.28 };
  const TOK = { 1: 0, 2: 2, 4: 5, 5: 7, 7: 10, 8: 12, b: 1, t: 6 }; // bass tokens: semitones above the chord root ('3' = the chord's third)
  const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  // pattern helpers: an 8-bar list (bar 4 and bar 8 fills), a pattern on bar 1 / bar 8 / bars 4 and 8 only, a bar of S steps with hits at given steps
  const bars = (a, f4, f8) => [a, a, a, f4 || a, a, a, a, f8 || a];
  const once = (a) => [a, '', '', '', '', '', '', ''];
  const at8 = (a) => ['', '', '', '', '', '', '', a];

  // ---------------- pieces ----------------
  // kind calm | run | boss (level table) · S steps (16ths) per bar · root MIDI tonic · scale semitones · prog 8 bars [offset, chord] · lead.m motif [step, scale degree, steps] over two bars (developed per 8-bar cycle)
  // arp.p pattern over chord tones seq (index >= chord size = octave up) · bass.p / drums / perc patterns (x X o g hit, . rest; an array is per bar of the 8-bar cycle, or alternates) · drums / perc entries [voice, pattern, min level]
  // stab chord stab at each bar start from level stab.lv · amb ambience of the pad layer · drive bass distortion · pump sidechain duck of pad and arp per kick · g layer gains · rev / dly sends · lp tone cutoff · sparse explore lead (phrases 1 and 3 rest)
  const AEO = [0, 2, 3, 5, 7, 8, 10], DOR = [0, 2, 3, 5, 7, 9, 10], LOC = [0, 1, 3, 5, 6, 8, 10];
  const THEME = {
    1: [[0, 4, 6], [6, 3, 2], [8, 2, 4], [16, 1, 4], [20, 0, 12]],
    2: [[0, 4, 2], [2, 2, 2], [4, 0, 2], [6, 2, 2], [8, 4, 2], [10, 5, 2], [12, 4, 2], [14, 6, 4], [18, 5, 2], [20, 4, 2], [22, 2, 6]],
    4: [[0, 0, 8], [8, 3, 6], [14, 2, 4], [18, 1, 2], [20, 0, 12]],
  };
  const COMBAT = {
    1: { id: 'ossuary-c', bpm: 132, root: 45, scale: AEO, lp: 9000, rev: 0.22, dly: 0.75, dsend: 0.16, drive: 2.5, pump: 0.45,
      prog: [[0, 'm'], [0, 'm'], [8, 'M'], [8, 'M'], [5, 'm'], [5, 'm'], [7, 'M'], [7, 'M']],
      pad: { v: 'strings', oct: 12, open: 1 }, arp: { v: 'sqpl', p: 'xxxxxxxxxxxxxxxx', seq: [0, 1, 2, 3, 2, 1], oct: 24 }, lead: { v: 'slead', oct: 12, m: THEME[1] },
      bass: { v: 'reese', oct: -12, p: bars('1.1.8.1.1.1.8.1.', null, '1.1.8.1.1.5.b.5.') },
      drums: [['kick', bars('x.....x...x.....', 'x.....x...x...x.', 'x.....x...x.x.x.')], ['snare', bars('....x.......x...', '....x.......x.xx', '....x...x.xxXXXX')], ['hat', 'x.o.x.o.x.o.x.o.'], ['hat', '.g.g.g.g.g.g.g.g', 2], ['crash', once('X...............')], ['tom', at8('........x.x.o.o.')]],
      perc: [['wood', '..x..x....x..x..'], ['ohat', '......o.......o.', 1], ['taiko', 'X.......X.......', 2]], g: { pad: 1.5 } },
    2: { id: 'glowmire-c', bpm: 128, root: 50, scale: DOR, lp: 9000, rev: 0.25, dly: 0.75, dsend: 0.2, drive: 1.6, pump: 0.55,
      prog: [[0, 'm7'], [0, 'm7'], [10, 'M'], [10, 'M'], [5, 'M'], [5, 'M'], [7, 'm'], [7, 'm']],
      pad: { v: 'pad', oct: 12, open: 1 }, arp: { v: 'pluck', p: 'x.xx.xx.x.xx.xx.', seq: [0, 1, 2, 3, 4, 3], oct: 24 }, lead: { v: 'slead', oct: 12, m: THEME[2] },
      bass: { v: 'acid', oct: -12, p: ['1.181.1.1.8.1.5.', '1.181.1.1.8.7.5.'] },
      drums: [['kick', bars('x...x...x...x...', null, 'x...x...x...x.x.')], ['clap', bars('....x.......x...', null, '....x.......x.xx')], ['hat', 'xoxoxoxoxoxoxoxo'], ['ohat', '..x...x...x...x.'], ['crash', once('X...............')], ['snare', at8('........o.o.xxXX')]],
      perc: [['shk', 'g.g.g.g.g.g.g.g.'], ['tom', '......x.......x.', 1], ['drop', '...x.......x....', 2]], g: { pad: 0.6, arp: 0.65, bass: 1.3, perc: 1.3 } },
    4: { id: 'abyss-c', bpm: 140, root: 41, scale: LOC, lp: 10000, rev: 0.25, dly: 0.75, dsend: 0.16, drive: 4, pump: 0.5,
      prog: [[0, 'm'], [0, 'm'], [1, 'M'], [1, 'M'], [6, 'p5'], [6, 'p5'], [10, 'm'], [1, 'M']],
      pad: { v: 'strings', oct: 12, open: 1 }, arp: { v: 'sqpl', p: 'xxxxxxxxxxxxxxxx', seq: [0, 1, 2, 1, 3, 1], oct: 24 }, lead: { v: 'slead', oct: 24, m: THEME[4] },
      bass: { v: 'reese', oct: 0, p: bars('1.1.1.1.1.1.t.1.', null, '1.1.1.1.t.t.b.b.') },
      drums: [['kick', bars('x...x...x...x.x.', null, 'x...x...x.x.xxxx')], ['clap', '....x.......x...'], ['snare', bars('....x.......x...', '....x.......x.xx', '....x...x.xxXXXX')], ['hat', 'xxoxxxoxxxoxxxox'], ['crash', once('X...............')]],
      perc: [['anvil', '..x.......x.....'], ['ohat', '......o.......o.', 1], ['taiko', 'X.......X.......', 2]], g: { pad: 1.5 } },
  };
  const BOSS = {
    1: { id: 'warden', bpm: 150, root: 45, scale: AEO, lp: 9500, rev: 0.2, dly: 0.75, dsend: 0.12, drive: 3.5, pump: 0.5,
      prog: [[0, 'm'], [0, 'm'], [1, 'M'], [0, 'm'], [8, 'M'], [5, 'm'], [7, 'M'], [1, 'M']],
      pad: { v: 'choir', oct: 12, open: 1 }, arp: { v: 'sqpl', p: 'xxxxxxxxxxxxxxxx', seq: [0, 2, 1, 3, 2, 4], oct: 24 },
      lead: { v: 'brass', oct: 12, m: [[0, 0, 6], [6, 4, 2], [8, 3, 2], [10, 2, 2], [12, 0, 4], [16, 0, 2], [18, 0, 2], [20, 1, 2], [22, 0, 2], [24, 3, 4], [28, 2, 2], [30, 1, 2]] },
      bass: { v: 'reese', oct: -12, p: ['1.11.11.1.11.11.', '1.11.11.1.11.8.5'] }, stab: { v: 'brass', oct: 12, lv: 1 },
      drums: [['kick', 'x...x...x...x...'], ['kick', '..x...x...x...xx', 2], ['snare', bars('....x.......x...', '....x.......x.x.', '....x...x.x.xxxx')], ['hat', 'xoxoxoxoxoxoxoxo'], ['crash', ['X...............', '', 'x...............', '', 'X...............', '', 'x...............', '']]],
      perc: [['taiko', 'X.......X.......'], ['anvil', '....x.......x...', 1], ['tom', at8('........xxxxxxxx'), 1]], g: { lead: 0.75 } },
    2: { id: 'sporemother', bpm: 148, root: 50, scale: DOR, lp: 9000, rev: 0.25, dly: 0.75, dsend: 0.18, drive: 2.2, pump: 0.55,
      prog: [[0, 'm'], [0, 'm'], [10, 'M'], [10, 'M'], [8, 'M'], [8, 'M'], [7, 'M'], [7, 'M']],
      pad: { v: 'pad', oct: 12, open: 1 }, arp: { v: 'pluck', p: 'x.xxx.xxx.xxx.xx', seq: [0, 1, 2, 3, 2, 1], oct: 24 },
      lead: { v: 'slead', oct: 12, m: [[0, 0, 3], [3, 2, 3], [6, 4, 2], [8, 3, 6], [16, 0, 3], [19, 2, 3], [22, 5, 2], [24, 4, 8]] },
      bass: { v: 'acid', oct: -12, p: ['1.181.181.181.1.', '1.181.181.18.5.7'] }, stab: { v: 'brass', oct: 12, lv: 2 },
      drums: [['kick', 'x...x...x...x...'], ['kick', '.......x.......x', 1], ['clap', bars('....x.......x...', null, '....x.......x.xx')], ['hat', 'xoxoxoxoxoxoxoxo'], ['ohat', '..x...x...x...x.'], ['crash', ['X...............', '', '', '', 'X...............', '', '', '']]],
      perc: [['tom', 'x..x..x...x..x..'], ['wood', '..x...x...x...x.', 1], ['drop', '.....x.......x..', 2]], g: { pad: 0.6, arp: 0.55, bass: 1.35 } },
    4: { id: 'hollowking', bpm: 156, root: 41, scale: LOC, lp: 10000, rev: 0.3, dly: 0.75, dsend: 0.16, drive: 4.5, pump: 0.5,
      prog: [[0, 'm'], [0, 'tt'], [1, 'M'], [6, 'p5'], [0, 'm'], [10, 'cl'], [1, 'M'], [6, 'p5']],
      pad: { v: 'choir', oct: 12, open: 1 }, arp: { v: 'sqpl', p: 'xxxxxxxxxxxxxxxx', seq: [0, 1, 2, 3, 2, 1], oct: 24 },
      lead: { v: 'slead', oct: 24, m: [[0, 0, 4], [4, 4, 4], [8, 0, 2], [10, 1, 2], [12, 4, 4], [16, 5, 2], [18, 4, 2], [20, 1, 2], [22, 0, 2], [24, 4, 8]] },
      bass: { v: 'reese', oct: 0, p: ['1.11.11.1.11.t.t', '1.11.11.1.11.b.b'] }, stab: { v: 'brass', oct: 12, lv: 0 },
      drums: [['kick', 'x.x.x.x.x.x.x.x.'], ['kick', '.x.x.x.x.x.x.x.x', 2], ['clap', '....x.......x...'], ['snare', bars('....x.......x...', '....x.......x.xx', '....x...xxxxXXXX')], ['hat', 'xoxoxoxoxoxoxoxo'], ['crash', ['X...............', '', 'x...............', '', 'X...............', '', 'x...............', '']]],
      perc: [['anvil', 'x.......x.......'], ['taiko', '....X.......X...', 1], ['tom', at8('xxxxxxxxxxxxxxxx'), 2]], g: { drums: 0.85 } },
  };
  const CAMP = { id: 'title', kind: 'calm', bpm: 76, S: 16, root: 50, scale: [0, 2, 4, 5, 7, 9, 11], lp: 4800, rev: 0.4, dly: 0.75, dsend: 0.26, amb: 'crackle',
    prog: [[0, 'add9'], [0, 'add9'], [9, 'm7'], [9, 'm7'], [5, 'M7'], [7, 'sus4'], [0, 'add9'], [0, 'add9']],
    pad: { v: 'pad', oct: 12, open: 0 }, lead: { v: 'pluck', oct: 12, m: [[0, 4, 3], [4, 2, 2], [6, 4, 2], [8, 5, 4], [12, 4, 4], [16, 2, 4], [20, 1, 2], [22, 2, 2], [24, 0, 8]] }, arp: null,
    bass: { v: 'sub', oct: -12, p: ['1.......5.......', '1.......5...1...'] },
    drums: [['kick', 'o.......g.......']], perc: [['shk', 'o.g.o.g.o.g.o.g.'], ['wood', '....g.......g...']],
    g: { pad: 0.6, drums: 1.7, perc: 0.6, lead: 1.5 } };

  const merge = (a, b) => Object.assign({}, a, b);
  // final boss: 6 bpm faster, harder drive, double kicks, taiko, a chord stab on every bar
  const finalOf = (B) => merge(B, { id: B.id + '-f', bpm: B.bpm + 6, drive: B.drive * 1.4, pump: B.pump + 0.06, stab: { v: 'brass', oct: 12, lv: 0 },
    drums: B.drums.concat([['kick', '......x.......xx', 2]]), perc: B.perc.concat([['taiko', '....X.......X...', 1]]) });
  const CACHE = {};
  // Piece for a track key ('title', 'run<n>', 'boss<n>', 'final<n>'); null for 'none' or an unknown key.
  S.piece = (key) => {
    if (CACHE[key]) return CACHE[key];
    if (key === 'title') return (CACHE[key] = CAMP);
    const m = /^(run|boss|final)(\d)$/.exec(key || ''), n = m && +m[2];
    if (!m || !COMBAT[n]) return null;
    return (CACHE[key] = m[1] === 'run' ? merge(COMBAT[n], { kind: 'run', S: 16 }) : merge(m[1] === 'boss' ? BOSS[n] : finalOf(BOSS[n]), { kind: 'boss', S: 16 }));
  };
  S.TRACKS = () => { const o = ['title']; for (const n of [1, 2, 4]) o.push('run' + n, 'boss' + n, 'final' + n); return o; };

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
  const curves = {};
  const driveCurve = (k) => curves[k] || (curves[k] = (() => { const c = new Float32Array(1024), n = Math.tanh(k); for (let i = 0; i < c.length; i++) c[i] = Math.tanh(k * (i / 511.5 - 1)) / n; return c; })());

  // ---------------- engine ----------------
  S.create = (ctx, out, opts) => {
    opts = opts || {};
    const sr = ctx.sampleRate, eng = { ctx, out, run: null, cur: null, runs: [] };
    const nb = ctx.createBuffer(1, sr * 2, sr), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const sout = opts.sting || out, offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    const lite = () => !!(opts.lite && opts.lite());
    // glue: a compressor and a soft clipper (linear below 0.6, a tanh knee above, never past 0.95) over every track and, separately, over the stingers
    const CLIP = new Float32Array(2049);
    for (let i = 0; i < CLIP.length; i++) { const x = i / 1024 - 1, a = Math.abs(x); CLIP[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.35 * Math.tanh((a - 0.6) / 0.35)); }
    const chain = (dst, makeup) => {
      const c = ctx.createDynamicsCompressor(), mk = ctx.createGain(), sh = ctx.createWaveShaper();
      c.threshold.value = -16; c.knee.value = 10; c.ratio.value = 4; c.attack.value = 0.004; c.release.value = 0.18;
      mk.gain.value = makeup; sh.curve = CLIP; c.connect(mk); mk.connect(sh); sh.connect(dst); return c;
    };
    const glue = chain(out, 0.95), sglue = chain(sout, 1);
    // shared reverb: a decaying, progressively darker noise tail
    let rev = null;
    {
      const len = Math.floor(sr * 2.4), ir = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const k = i / len; lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.45 * k); d[i] = lp * Math.pow(1 - k, 2.6) * 1.6; } }
      rev = ctx.createConvolver(); rev.buffer = ir; const ro = ctx.createGain(); ro.gain.value = 0.5; rev.connect(ro); ro.connect(glue); eng.rev = rev;
    }
    const vib = ctx.createGain(); vib.gain.value = 14; // shared vibrato (cents) for sustained voices
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.1; lfo.connect(vib); lfo.start();

    const gn = (dst, v) => { const g = ctx.createGain(); if (v !== undefined) g.gain.value = v; g.connect(dst); return g; };
    const flt = (type, f, q, dst) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; b.connect(dst); return b; };
    const osc = (type, f, t0, t1, dst, det) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (det) o.detune.value = det; o.connect(dst); o.start(t0); o.stop(t1); return o; };
    const nz = (t0, dur, dst) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.connect(dst); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur); return s; };
    const ex = (p, t, a, pk, d) => { p.setValueAtTime(0.0001, t); p.exponentialRampToValueAtTime(Math.max(0.0002, pk), t + a); p.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const sus = (p, t, a, pk, hold, rel) => { hold = Math.max(a, hold); p.setValueAtTime(0.0001, t); p.exponentialRampToValueAtTime(Math.max(0.0002, pk), t + a); p.setValueAtTime(Math.max(0.0002, pk), t + hold); p.exponentialRampToValueAtTime(0.0001, t + hold + rel); };
    const sweep = (p, t, f0, f1, d) => { p.setValueAtTime(f0, t); p.exponentialRampToValueAtTime(f1, t + d); };

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
        const a = 0.03 + 0.05 * Math.min(1, dur), e = t + dur + 0.3, g = gn(d), lp = flt('lowpass', f * 1.5, 1.5, g);
        lp.frequency.setValueAtTime(f * 1.4, t); lp.frequency.linearRampToValueAtTime(f * 5, t + a * 3); lp.frequency.linearRampToValueAtTime(f * 3, t + Math.max(a * 3, dur));
        sus(g.gain, t, a, 0.17 * v, dur, 0.25); osc('sawtooth', f, t, e, lp, -5); osc('sawtooth', f, t, e, lp, 5);
      },
      marimba(t, f, dur, v, d) {
        const g = gn(d), g2 = gn(d); ex(g.gain, t, 0.002, 0.34 * v, 0.55); osc('sine', f, t, t + 0.8, g); ex(g2.gain, t, 0.002, 0.14 * v, 0.07); osc('sine', f * 3.98, t, t + 0.2, g2);
      },
      pluck(t, f, dur, v, d) { // harp-like: triangle behind a closing lowpass
        const g = gn(d), lp = flt('lowpass', Math.min(f * 8, 6000), 0.7, g);
        sweep(lp.frequency, t, Math.min(f * 8, 6000), Math.max(320, f * 1.3), 0.5);
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
      pulse(t, f, dur, v, d) { // soft saw and sine pulse behind a low lowpass: audible harmonics without a bright edge
        const e = t + dur + 0.12, g = gn(d), lp = flt('lowpass', 900, 0.8, g);
        sweep(lp.frequency, t, Math.min(1400, f * 12), Math.max(260, f * 4), 0.18);
        sus(g.gain, t, 0.006, 0.42 * v, dur * 0.8, 0.12); osc('sawtooth', f, t, e, lp); osc('sine', f, t, e, gn(g, 0.9));
      },
      sawb(t, f, dur, v, d) { // sawtooth bass with a plucked lowpass
        const e = t + dur + 0.15, g = gn(d), lp = flt('lowpass', f * 2.2, 3, g);
        sweep(lp.frequency, t, Math.max(f * 7, 900), Math.max(f * 2.2, 300), 0.14);
        sus(g.gain, t, 0.008, 0.34 * v, dur * 0.9, 0.1); osc('sawtooth', f, t, e, lp, -6); osc('sawtooth', f, t, e, lp, 9); osc('sine', f, t, e, gn(g, 0.8));
      },
      reese(t, f, dur, v, d) { // two detuned saws behind a closing lowpass over a sine sub (the run's drive shaper follows on the bass layer)
        const e = t + dur + 0.1, g = gn(d), lp = flt('lowpass', f * 6, 1.4, g);
        sweep(lp.frequency, t, Math.min(f * 16, 4200), Math.max(f * 3.5, 260), Math.min(0.22, dur + 0.05));
        sus(g.gain, t, 0.004, 0.3 * v, dur * 0.88, 0.06); osc('sawtooth', f, t, e, lp, -16); osc('sawtooth', f, t, e, lp, 16); osc('sawtooth', f * 2, t, e, gn(lp, 0.35), 7); osc('sine', f, t, e, gn(g, 1.1));
      },
      acid(t, f, dur, v, d) { // saw through a resonant lowpass that snaps shut, over a sine sub
        const e = t + dur + 0.1, g = gn(d), lp = flt('lowpass', f * 4, 9, g);
        sweep(lp.frequency, t, Math.min(f * 22, 5200), Math.max(f * 2, 180), 0.17);
        sus(g.gain, t, 0.004, 0.24 * v, dur * 0.85, 0.05); osc('sawtooth', f, t, e, lp); osc('sine', f, t, e, gn(g, 1.3));
      },
      wetb(t, f, dur, v, d) { // sine and detuned triangles with a downward glide
        const e = t + dur + 0.35, g = gn(d), lp = flt('lowpass', 560, 1.1, g); sus(g.gain, t, 0.015, 0.5 * v, dur, 0.3);
        const o = osc('sine', f, t, e, lp); o.frequency.setValueAtTime(f * 1.12, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        osc('triangle', f, t, e, gn(lp, 0.5), 11); osc('triangle', f, t, e, gn(lp, 0.5), -11); osc('sawtooth', f * 2, t, e, gn(flt('lowpass', 700, 0.7, g), 0.25));
      },
      sqpl(t, f, dur, v, d) { // square pluck for arps: a fast closing lowpass
        const g = gn(d), lp = flt('lowpass', f * 3, 2, g);
        sweep(lp.frequency, t, Math.min(f * 9, 9000), Math.max(f * 1.4, 300), 0.12);
        ex(g.gain, t, 0.003, 0.15 * v, 0.2); osc('square', f, t, t + 0.3, lp); osc('sawtooth', f * 1.003, t, t + 0.3, gn(lp, 0.5));
      },
      slead(t, f, dur, v, d) { // saw lead: two detuned saws and a sub octave square, shared vibrato, a soft lowpass
        const e = t + dur + 0.25, g = gn(d), lp = flt('lowpass', Math.min(f * 6, 4200), 1.2, g);
        sweep(lp.frequency, t, Math.min(f * 10, 7000), Math.min(f * 5, 3600), 0.15);
        sus(g.gain, t, 0.012, 0.12 * v, dur * 0.95, 0.2);
        for (const c of [-9, 9]) { const o = osc('sawtooth', f, t, e, lp, c); vib.connect(o.detune); }
        osc('square', f / 2, t, e, gn(lp, 0.35));
      },
      lead(t, f, dur, v, d) { // saw and square pair, short pluck
        const e = t + dur + 0.1, g = gn(d), lp = flt('lowpass', f * 4, 2.5, g);
        sweep(lp.frequency, t, f * 6, f * 2, 0.2); ex(g.gain, t, 0.006, 0.17 * v, Math.max(0.15, dur));
        osc('sawtooth', f, t, e, lp, -7); osc('square', f, t, e, gn(lp, 0.5), 7);
      },
      whistle(t, f, dur, v, d) { // thin sine with vibrato
        const g = gn(d), o = osc('sine', f, t, t + dur + 1, g); sus(g.gain, t, Math.min(0.8, dur * 0.5), 0.2 * v, dur, 0.9); vib.connect(o.detune);
      },
    };
    // ---- percussion: (t, velocity, destination) ----
    const thump = (t, v, d, f0, f1, pd, pk, dec) => { const g = gn(d), o = osc('sine', f0, t, t + dec + 0.15, g); ex(g.gain, t, 0.002, pk * v, dec); sweep(o.frequency, t, f0, f1, pd); };
    const hiss = (t, v, d, type, f, q, pk, dec) => { const g = gn(d); ex(g.gain, t, 0.002, pk * v, dec); nz(t, dec + 0.05, flt(type, f, q, g)); };
    const DR = {
      kick(t, v, d) { thump(t, v, d, 165, 46, 0.11, 0.95, 0.3); const g = gn(d), o = osc('triangle', 1100, t, t + 0.04, g); ex(g.gain, t, 0.001, 0.28 * v, 0.018); sweep(o.frequency, t, 1100, 140, 0.025); hiss(t, v, d, 'highpass', 3200, 0.7, 0.14, 0.012); },
      snare(t, v, d) { hiss(t, v, d, 'bandpass', 1800, 0.7, 0.55, 0.15); hiss(t, v, d, 'highpass', 5200, 0.7, 0.24, 0.08); const g = gn(d), o = osc('triangle', 230, t, t + 0.15, g); ex(g.gain, t, 0.002, 0.4 * v, 0.07); sweep(o.frequency, t, 230, 160, 0.06); },
      clap(t, v, d) { for (const [x, k] of [[0, 0.6], [0.011, 0.7], [0.022, 1]]) hiss(t + x, v, d, 'bandpass', 1250, 1.3, 0.55 * k, x < 0.02 ? 0.012 : 0.13); },
      hat(t, v, d) { hiss(t, v, d, 'highpass', 7600, 0.8, 0.26, 0.032); },
      ohat(t, v, d) { hiss(t, v, d, 'highpass', 6800, 0.8, 0.22, 0.22); },
      crash(t, v, d) { hiss(t, v, d, 'highpass', 3600, 0.6, 0.32, 1.3); hiss(t, v, d, 'bandpass', 5400, 1.4, 0.16, 0.5); },
      taiko(t, v, d) { thump(t, v, d, 120, 46, 0.22, 0.7, 0.45); hiss(t, v, d, 'lowpass', 800, 0.7, 0.35, 0.09); },
      tom(t, v, d) { thump(t, v, d, 120, 70, 0.16, 0.7, 0.3); hiss(t, v, d, 'lowpass', 900, 0.7, 0.18, 0.05); },
      frame(t, v, d) { thump(t, v, d, 190, 118, 0.12, 0.45, 0.24); hiss(t, v, d, 'bandpass', 1000, 1.2, 0.2, 0.05); },
      wood(t, v, d) { thump(t, v, d, 300, 190, 0.06, 0.4, 0.12); hiss(t, v, d, 'bandpass', 1800, 2, 0.12, 0.03); },
      shk(t, v, d) { const ng = gn(d); ex(ng.gain, t, 0.008, 0.2 * v, 0.05); nz(t, 0.1, flt('highpass', 5500, 0.7, ng)); },
      anvil(t, v, d) { const k = 0.97 + Math.random() * 0.06; for (const [f, a, L] of [[880, 1, 0.5], [1370, 0.7, 0.36], [2210, 0.5, 0.22], [3140, 0.3, 0.14]]) { const g = gn(d); ex(g.gain, t, 0.001, 0.22 * a * v, L); osc('sine', f * k, t, t + L + 0.1, g); } hiss(t, v, d, 'bandpass', 4200, 1.5, 0.3, 0.03); },
      tick(t, v, d) { const g = gn(d); ex(g.gain, t, 0.001, 0.3 * v, 0.06); osc('sine', 4300, t, t + 0.1, g); hiss(t, v, d, 'highpass', 9000, 0.7, 0.45, 0.025); },
      hb(t, v, d) { thump(t, v, d, 70, 36, 0.18, 0.85, 0.26); const g2 = gn(d), o2 = osc('triangle', 130, t, t + 0.2, g2); ex(g2.gain, t, 0.004, 0.3 * v, 0.1); sweep(o2.frequency, t, 130, 75, 0.1); },
      drop(t, v, d) { const g = gn(d), o = osc('sine', 600, t, t + 0.3, g); ex(g.gain, t, 0.004, 0.3 * v, 0.14); sweep(o.frequency, t, 600 + Math.random() * 300, 1500 + Math.random() * 600, 0.07); },
    };
    eng.VOX = VOX; eng.DR = DR;

    // ---- ambience of the pad layer, once per bar ----
    const AMB = {
      none() { },
      toll(r, t, bar) { if (bar % 2 === 0) VOX.bell(t, midiHz(r.P.root + (bar % 4 === 2 ? 7 : 0)), 6, 0.7, r.lay.pad); },
      drip(r, t) { for (let i = 0; i < 2; i++) if (r.rng() < 0.7) DR.drop(t + r.rng() * r.bar, 0.6, r.lay.pad); },
      wave(r, t) { const g = gn(r.lay.pad), f = flt('bandpass', 250, 1.2, g); sus(g.gain, t, r.bar * 0.45, 0.2, r.bar * 0.55, r.bar * 0.6); f.frequency.setValueAtTime(240, t); f.frequency.linearRampToValueAtTime(720, t + r.bar * 0.5); f.frequency.linearRampToValueAtTime(260, t + r.bar * 1.1); nz(t, r.bar * 1.7, f); },
      drone(r, t, bar) { if (bar % 2) return; const f = midiHz(r.P.root - 12); VOX.sub(t, f * 1.012, r.bar * 2, 0.5, r.lay.pad); VOX.sub(t, f * 1.414, r.bar * 2, 0.38, r.lay.pad); }, // a tritone above the root, beating against it
      crackle(r, t) { for (let i = 0; i < 5; i++) if (r.rng() < 0.6) { const at = t + r.rng() * r.bar, g = gn(r.lay.pad); ex(g.gain, at, 0.001, 0.05 + r.rng() * 0.06, 0.012); nz(at, 0.03, flt('highpass', 2500 + r.rng() * 2500, 0.7, g)); } },
    };

    // ---- runs ----
    const chordAt = (P, bi) => (P.ch || (P.ch = P.prog.map(c => ({ off: c[0], key: c[0] + c[1], iv: Q[c[1]] }))))[bi % P.prog.length];
    const duckAt = (r, t, v) => { const g = r.duck.gain, a = r.P.pump * Math.min(1, v); g.setTargetAtTime(1 - a, t, 0.004); g.setTargetAtTime(1, t + 0.03, 0.09); };
    function hits(r, list, bi, pos, t, d) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i]; if ((e[2] | 0) > r.lv) continue;
        const pat = e[1], p = Array.isArray(pat) ? pat[bi % pat.length] : pat, v = p && VEL[p[pos]];
        if (!v) continue;
        DR[e[0]](t, v * (0.92 + 0.16 * r.rng()), d);
        if (e[0] === 'kick' && r.duck) duckAt(r, t, v);
      }
    }
    const degMidi = (P, d, oct) => { const L = P.scale.length, o = Math.floor(d / L); return P.root + oct + P.scale[d - o * L] + 12 * o; };
    function buildMotif(r, cyc) {
      const P = r.P, M = P.lead, span = P.S * 2, rng = mulberry(hash(P.id) + cyc * 977), pick = (a) => a[(rng() * a.length) | 0];
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
    const HAS = { pad: (P) => !!P.pad, arp: (P) => !!P.arp, bass: (P) => !!P.bass, drums: (P) => !!(P.drums && P.drums.length), perc: (P) => !!(P.perc && P.perc.length), lead: (P) => !!P.lead };
    // Sets each layer's target for level lv (instant: at once, for a run's first downbeat); Low quality zeroes pad, arp and lead.
    function applyLevel(r, lv, t, instant) {
      const P = r.P, kind = P.kind || 'calm', T = LVT[kind][lv], G = GDEF[kind], lt = r.lite = lite();
      for (const k of LAYERS) {
        const g = lt && LITE_OFF[k] ? 0 : (T[k] || 0) * G[k] * (P.g && P.g[k] !== undefined ? P.g[k] : 1), p = r.lay[k].gain;
        r.act[k] = g > 0.01 && HAS[k](P);
        p.cancelScheduledValues(t);
        if (instant) p.setValueAtTime(Math.max(0.0001, g), t); else p.setTargetAtTime(Math.max(0.0001, g), t, TAU[k]);
      }
      r.lv = lv;
    }
    function makeRun(P, sig, t0, lv, soft) {
      const nodes = [], reg = (n) => { nodes.push(n); return n; };
      const bus = reg(gn(glue, 0)); bus.gain.setValueAtTime(0.0001, t0);
      if (soft) bus.gain.setTargetAtTime(1, t0, 0.45); else bus.gain.linearRampToValueAtTime(1, t0 + 0.012);
      const lp = reg(flt('lowpass', P.lp || 9000, 0.5, bus)), mix = reg(gn(lp)), lt = lite();
      if (P.dly && !lt) {
        const dn = reg(ctx.createDelay(2)); dn.delayTime.value = 60 / P.bpm * P.dly;
        const fb = reg(gn(dn, 0.34)), dl = reg(flt('lowpass', 2300, 0.3, fb)), ds = reg(gn(dn, P.dsend || 0.2));
        dn.connect(dl); dl.connect(lp); mix.connect(ds);
      }
      if (rev && P.rev && !lt) { const rs = reg(gn(rev, P.rev)); bus.connect(rs); }
      const dk = P.pump ? reg(gn(mix)) : null, lay = {};
      for (const k of LAYERS) { lay[k] = reg(gn((k === 'pad' || k === 'arp') && dk ? dk : mix, 0.0001)); }
      if (P.drive) { // bass layer -> tanh drive -> level trim -> mix
        lay.bass.disconnect(); const sh = reg(ctx.createWaveShaper()); sh.curve = driveCurve(P.drive); sh.oversample = lt ? 'none' : '2x';
        lay.bass.connect(sh); sh.connect(reg(gn(mix, 0.75 / (1 + 0.12 * P.drive))));
      }
      if (opts.tap) for (const k of LAYERS) opts.tap(k, lay[k]);
      const sd = 60 / P.bpm / 4, r = { P, sig, bus, nodes, lay, act: {}, k: 0, next: t0, t0, sd, bar: sd * P.S, rng: mulberry(hash(P.id)), cyc: -1, mm: null, padUntil: 0, arp: 0, lv: -1,
        until: Infinity, fadeAt: 0, dead: false, duck: dk, lite: false, prev: null };
      applyLevel(r, lv, t0, true);
      return r;
    }
    // first grid point (bar, or half bar when the bar is over 1.9 s) of run r at or after t
    const gridAt = (r, t) => { const gs = r.bar > 1.9 ? r.P.S / 2 : r.P.S, kf = r.k + (t - r.next) / r.sd; return r.next + (Math.ceil(kf / gs - 1e-6) * gs - r.k) * r.sd; };
    function fadeAt(r, tb) { const len = Math.min(2.2, r.bar); r.dead = true; r.fadeAt = tb; r.until = tb + len; r.bus.gain.setTargetAtTime(0.0001, tb, len / 4); }
    function fadeNow(r, t) { r.dead = true; r.fadeAt = t; r.bus.gain.cancelScheduledValues(t); r.bus.gain.setTargetAtTime(0.0001, t, 0.35); r.until = Math.min(r.until, t + 1.6); }
    function kill(r, t) { r.dead = true; r.until = t; r.bus.gain.cancelScheduledValues(t); r.bus.gain.setValueAtTime(0, t); }
    function revive(r, t) { r.dead = false; r.until = Infinity; r.fadeAt = 0; r.bus.gain.cancelScheduledValues(t); r.bus.gain.setTargetAtTime(1, t, 0.12); }

    function stepAt(r, k, t) {
      const P = r.P, S = P.S, bar = (k / S) | 0, pos = k - bar * S, bi = bar % 8, cyc = (bar / 8) | 0, lay = r.lay;
      if (pos === 0 && r.lite !== lite()) applyLevel(r, r.lv, t);
      const act = r.act, lv = r.lv;
      if (r.cyc !== cyc) { r.cyc = cyc; r.mm = P.lead ? buildMotif(r, cyc) : null; }
      if (P.swing && (pos & 1)) t += P.swing * r.sd;
      const ch = chordAt(P, bi);
      if (pos === 0) {
        r.arp = 0;
        if (act.pad && bar >= r.padUntil) {
          let n = 1; while (bi + n < 8 && n < 3 && chordAt(P, bi + n).key === ch.key) n++;
          r.padUntil = bar + n;
          const base = P.root + ch.off + P.pad.oct, dur = n * r.bar;
          for (let i = 0; i < ch.iv.length; i++) VOX[P.pad.v](t, midiHz(base + ch.iv[i] - (i === 0 && P.pad.open ? 12 : 0)), dur, 0.85, lay.pad);
        }
        if (act.pad) AMB[P.amb || 'none'](r, t, bar);
        if (P.stab && act.perc && lv >= P.stab.lv) for (let i = 0; i < ch.iv.length; i++) VOX[P.stab.v](t, midiHz(P.root + ch.off + P.stab.oct + ch.iv[i]), r.sd * 3, 0.8, lay.perc);
      }
      if (act.lead) {
        const evs = r.mm[bi * S + pos];
        if (evs) for (let i = 0; i < evs.length; i++) {
          const e = evs[i];
          if (P.sparse && (e.ph & 1)) continue; // explore: the motif answers itself with silence
          if (P.kind === 'run' && lv < 2 && e.ph === 2) continue; // a run below level 2 leaves bars 5-6 to the arp
          VOX[P.lead.v](t, midiHz(e.m), e.len * r.sd * 0.95, e.vel * (0.9 + 0.2 * r.rng()), lay.lead);
        }
      }
      if (act.bass) {
        const pat = P.bass.p, p = pat[bi % pat.length], c = p[pos];
        if (c && c !== '.') {
          let n = pos + 1; while (n < S && p[n] === '.') n++;
          const semi = c === '3' ? ch.iv[1] : TOK[c] || 0;
          VOX[P.bass.v](t, midiHz(P.root + ch.off + semi + P.bass.oct), (n - pos) * r.sd * 0.92, (pos % 4 ? 0.85 : 1.05) * (0.94 + 0.12 * r.rng()), lay.bass);
        }
      }
      if (act.drums) hits(r, P.drums, bi, pos, t, lay.drums);
      if (act.perc) hits(r, P.perc, bi, pos, t, lay.perc);
      if (act.arp) {
        const A = P.arp, c = A.p[pos % A.p.length];
        if (c && c !== '.') {
          let n = pos + 1; while (n < S && A.p[n % A.p.length] === '.') n++;
          const ci = A.seq[r.arp++ % A.seq.length], note = P.root + ch.off + ch.iv[ci % ch.iv.length] + 12 * Math.floor(ci / ch.iv.length) + A.oct;
          VOX[A.v](t, midiHz(note), (n - pos) * r.sd * 0.9, 0.9 + 0.2 * r.rng(), lay.arp);
        }
      }
    }

    // ---- control ----
    eng.play = (track, t, lv) => {
      const sig = track || 'none', P = S.piece(sig), cur = eng.run;
      lv = Math.max(0, Math.min(3, lv | 0));
      if (cur && cur.sig === sig) return;
      let ref = cur;
      if (cur && cur.t0 > t) { kill(cur, t); ref = cur.prev; } // a switch whose downbeat is still ahead never sounded: dropped, the track it replaced is current again
      if (ref && ref.sig === sig && ref.until > t) { revive(ref, t); eng.run = ref; eng.cur = sig; return; } // still scheduling: brought back, never restarted
      if (ref && ref.until <= t) ref = null;
      eng.run = null; eng.cur = null;
      if (!P) { if (ref) fadeNow(ref, t); return; }
      let tb = t + 0.05;
      if (ref) { if (ref.dead && ref.fadeAt > t) tb = ref.fadeAt; else if (!ref.dead) { tb = gridAt(ref, t + 0.06); fadeAt(ref, tb); } }
      const r = makeRun(P, sig, tb, lv, !ref || ref.dead && ref.fadeAt <= t);
      r.prev = ref; eng.runs.push(r); eng.run = r; eng.cur = sig;
    };
    eng.level = (n, t) => { const r = eng.run; n = Math.max(0, Math.min(3, n | 0)); if (r && n !== r.lv) applyLevel(r, n, Math.max(t, r.t0), t < r.t0); };
    eng.stop = (t) => { const r = eng.run; if (r) { if (r.t0 > t) { kill(r, t); if (r.prev && r.prev.until > t) fadeNow(r.prev, t); } else fadeNow(r, t); } eng.run = null; eng.cur = null; };
    // Schedules every step starting before `until`; `now` (the context clock) resynchronises a run the page stalled behind and retires faded runs.
    eng.pump = (until, now) => {
      const clock = now || until;
      for (let i = eng.runs.length - 1; i >= 0; i--) {
        const r = eng.runs[i];
        if (r.prev && r.t0 < clock) r.prev = null;
        if (now && r.next < now - 0.15 && r.until > now) { const skip = Math.ceil((now - r.next) / r.sd); r.k += skip; r.next += skip * r.sd; }
        const end = Math.min(until, r.until);
        while (r.next < end) { stepAt(r, r.k, r.next); r.k++; r.next += r.sd; }
        if (r.until + 4 < clock) { eng.runs.splice(i, 1); if (!offline) for (const n of r.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } }
      }
    };

    // ---- stingers (boss | victory | defeat, in the playing track's key; D without one) -> seconds ----
    eng.sting = (kind, t) => {
      const bus = gn(sglue, 0.75), P = eng.run && eng.run.P, root = P ? 48 + (((P.root - 48) % 12) + 12) % 12 : 50, m = (n) => midiHz(root + n);
      if (rev) { const rs = gn(rev, 0.3); bus.connect(rs); }
      let dur;
      if (kind === 'boss') { // boss defeated: a snare roll, then a brass call over a held major chord
        dur = 4.4;
        for (let i = 0; i < 12; i++) DR.snare(t + i * 0.07, 0.3 + i * 0.05, bus);
        const T = t + 0.86; DR.kick(T, 1.2, bus); DR.crash(T, 1, bus); DR.taiko(T, 1.2, bus);
        [[0, 0, 0.2], [7, 0.22, 0.2], [12, 0.44, 0.24], [16, 0.7, 2.4]].forEach(([n, x, d]) => { VOX.brass(T + x, m(n - 12), d, 1.1, bus); VOX.slead(T + x, m(n), d, 0.8, bus); });
        [0, 4, 7, 12].forEach((n, i) => { VOX.strings(T, m(n - 12), 3, 1, bus); VOX.celesta(T + 0.7 + i * 0.1, m(n + 12), 1.6, 0.8, bus); });
        VOX.reese(T, m(-24), 2.6, 0.9, bus); VOX.bell(T + 0.7, m(-12), 3, 0.7, bus); DR.kick(T + 0.7, 1, bus); DR.crash(T + 0.7, 0.6, bus);
      } else if (kind === 'victory') { // the run won: timpani and snare roll, a rising brass call, a held major chord with bell, choir and sparkle
        dur = 6.5;
        for (let i = 0; i < 16; i++) DR.snare(t + i * 0.08, 0.25 + i * 0.04, bus);
        [0, 0.28, 0.54, 0.74, 0.9, 1.02, 1.12, 1.2].forEach((x, i) => DR.taiko(t + x, 0.5 + i * 0.08, bus));
        [[0, 0, 0.34], [7, 0.4, 0.34], [12, 0.8, 0.4], [16, 1.25, 0.3]].forEach(([n, x, d]) => { VOX.brass(t + x, m(n - 12), d, 1.1, bus); VOX.brass(t + x, m(n - 24), d, 0.9, bus); });
        const T = t + 1.6; DR.taiko(T, 1.4, bus); DR.kick(T, 1.2, bus); DR.crash(T, 1.1, bus); DR.anvil(T, 0.7, bus);
        [0, 4, 7, 12, 16].forEach((n, i) => { VOX.strings(T, m(n - 12), 3.6, 1.1, bus); VOX.choir(T, m(n - 12), 3.4, 0.6, bus); VOX.celesta(T + 0.15 + i * 0.13, m(n + 12), 2, 0.9, bus); });
        VOX.brass(T, m(-24), 3.2, 1, bus); VOX.brass(T, m(-17), 3.2, 0.8, bus); VOX.bell(T, m(-12), 4.5, 0.8, bus); VOX.sub(T, m(-36), 3, 0.8, bus);
      } else { // defeat: a falling minor line over tolling bells and a sub drop
        dur = 8;
        [[0, 0], [-2, 1.2], [-4, 2.4], [-5, 3.6], [-7, 4.8]].forEach(([n, x]) => VOX.strings(t + x, m(n - 12), 1.6, 1, bus));
        [0, 3, 7].forEach(n => VOX.strings(t, m(n - 24), 5, 0.7, bus));
        [0, 1.9, 3.8, 5.7].forEach((x, i) => VOX.bell(t + x, m(-24), 5, 0.9 - i * 0.12, bus));
        const g = gn(bus), o = osc('sine', 90, t, t + 3, g); ex(g.gain, t, 0.05, 0.6, 2.6); sweep(o.frequency, t, 90, 30, 2.8);
        const ng = gn(bus); sus(ng.gain, t, 1.5, 0.12, 2.5, 3); nz(t, 7, flt('lowpass', 320, 0.8, ng));
      }
      if (!offline) setTimeout(() => { try { bus.disconnect(); } catch (e) { /* gone */ } }, (dur + 3) * 1000);
      return dur;
    };
    return eng;
  };

  // ---------------- controller ----------------
  const M = ED.Music = { eng: null, track: null, lv: 0, low: 0, bump: 0, bumpT: 0, hold: 0, hb: 0, mu: 20000, Score: S };
  const THEME_OF = { ossuary: 1, glowmire: 2, abyss: 4 };
  const themeOf = (v) => { const sd = ED.STAGES && ED.STAGES[v.stage | 0]; return (sd && THEME_OF[sd.id]) || [1, 2, 4][(v.stage | 0) % 3]; };
  const lite = () => !!(ED.Render && ED.Render.quality === 'low');
  // Called by ED.Audio.init once the audio graph exists.
  M.attach = (ctx) => {
    if (M.eng) return;
    M.eng = S.create(ctx, ED.Audio.musicIn, { sting: ED.Audio.stingIn, lite });
    setInterval(pump, 100);
  };
  const play = (key, lv, t) => { if (M.track === key) return; M.track = key; M.lv = lv; M.low = 0; M.eng.play(key, t, lv); };
  // Requested level: rises at once, falls one step after 4 s lower.
  const level = (raw, t) => {
    if (raw > M.lv) { M.lv = raw; M.low = 0; M.eng.level(raw, t); }
    else if (raw < M.lv) { if (!M.low) M.low = t; else if (t - M.low >= 4) { M.lv--; M.low = t; M.eng.level(M.lv, t); } }
    else M.low = 0;
  };
  function pump() {
    const A = ED.Audio, c = A.ctx;
    if (!M.eng || !c || c.state !== 'running') return;
    const t = c.currentTime;
    if (!(ED.App && ED.App.state === 'run') && t >= M.hold) { play('title', 0, t); if (M.mu !== 20000) { M.mu = 20000; A.muffle(20000, 0.2); } }
    M.eng.pump(t + 0.4, t);
  }
  // Once per frame in a run with the view model (ARCHITECTURE §10).
  M.update = (v, dt) => {
    const A = ED.Audio;
    if (!M.eng || !A.ready || !v) return;
    const t = A.ctx.currentTime;
    if (t < M.hold) return; // a run-end stinger is playing
    const b = v.boss && !v.boss.dead ? v.boss : null;
    let raw;
    if (b) { const hs = b.maxHp ? b.hp / b.maxHp : b.hpQ !== undefined ? b.hpQ / 255 : 1; raw = b.enraged ? 3 : hs > 0.66 ? 1 : hs > 0.33 ? 2 : 3; }
    else { const n = v.foes ? v.foes.length : 0; raw = n < 60 ? 0 : n < 220 ? 1 : n < 480 ? 2 : 3; if (v.time >= 480 && raw < 1) raw = 1; }
    if (t < M.bumpT && M.bump > raw) raw = M.bump;
    play((b ? (b.final ? 'final' : 'boss') : 'run') + themeOf(v), raw, t);
    level(raw, t);
    const me = v.me, G = ED.Game, paused = !!(G && (G.paused || (G.w && G.w.paused)));
    let hz = 20000;
    if (me) {
      const hs = me.maxHp ? me.hp / me.maxHp : 1;
      if (me.downed || me.dead) hz = 420;
      else if (hs < 0.3) {
        hz = 900 + 6000 * hs;
        if (!paused && (M.hb -= dt) <= 0) { M.hb = hs < 0.15 ? 0.6 : 0.85; A.play('heart', 0.6 + 2 * (0.3 - hs)); }
      }
    }
    if (paused) hz = Math.min(hz, 1400);
    if (Math.abs(hz - M.mu) > 1) { M.mu = hz; A.muffle(hz, 0.25); }
  };
  // World events forwarded by ED.Audio.event: warnings raise the level for a while; a mid-boss kill and the run's end play stingers.
  M.onEvent = (ev) => {
    const A = ED.Audio;
    if (!M.eng || !A.ready) return;
    const t = A.ctx.currentTime;
    if (ev.t === 'warn') { const k = ev.kind === 'boss' ? 3 : Math.min(3, M.lv + 1); if (k > M.bump || t >= M.bumpT) M.bump = k; M.bumpT = t + (ev.kind === 'boss' ? 12 : ev.kind === 'swarm' ? 10 : 8); }
    else if (ev.t === 'boss' && ev.phase === -1 && !ev.final) { const d = M.eng.sting('boss', t + 0.4); A.duck(0.3, d * 0.6); }
    else if (ev.t === 'end') { const d = M.eng.sting(ev.won ? 'victory' : 'defeat', t + 0.3); M.eng.stop(t + 0.3); M.track = null; M.hold = t + d + 0.5; M.mu = 20000; A.muffle(20000, 0.2); }
  };
  M.stop = () => { if (M.eng && ED.Audio.ctx) { M.eng.stop(ED.Audio.ctx.currentTime); M.track = null; } };
})(globalThis.ED || (globalThis.ED = {}));
