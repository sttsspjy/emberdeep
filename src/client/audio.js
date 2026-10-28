// Synthesized SFX (no audio files). Every cue is a recipe baked once into AudioBuffers (OfflineAudioContext, 32 kHz mono, n variants, its reverb tail baked in, peak-normalised);
// playback is one BufferSource + Gain (+ StereoPanner) per voice with a random variant and pitch jitter. World events (ARCHITECTURE §5) enter through A.event(ev, myPid) and are
// aggregated per frame: identical cues of one frame become one louder voice (A.flush, once per frame). Voice budget: a cue plays only below its own cap and past its minimum gap;
// above MAXV live voices a higher-priority cue steals the oldest lowest-priority voice. Output: sfx bus + music bus -> master -> compressor -> soft clipper -> speakers.
(function (ED) {
  'use strict';
  const A = ED.Audio = { ctx: null, ready: false, baked: false, vol: { master: 0.7, music: 0.55, sfx: 0.8 }, CUES: {}, musicIn: null, stingIn: null, played: 0 };
  const SR = 32000, IR_LEN = 1.2, MAXV = 40;
  let master, sfxBus, musicBus, duckG, muffle, noiseBuf = null, irBuf = null, panOK = false;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const st = (n) => Math.pow(2, n / 12);

  // ---------------- bake-time synth (any BaseAudioContext; s.t is the variant's start) ----------------
  // T(type, f0, f1, dur, vol, at, att): oscillator gliding f0 -> f1 over att + dur, exponential attack att (5 ms) and decay dur. N(ftype, f0, f1, dur, vol, q, at, att): filtered noise, the filter
  // gliding f0 -> f1. F(f, ratio, idx, dur, vol, at): two-operator FM bell (index decays). B(f, dur, vol, at): brass (saw behind an opening lowpass). vib(osc, rate, cents, at, dur): vibrato.
  function synth(c, out) {
    const s = { t: 0, R: rnd };
    const env = (p, t, a, pk, d) => { p.setValueAtTime(0.0001, t); p.exponentialRampToValueAtTime(Math.max(0.0002, pk), t + a); p.exponentialRampToValueAtTime(0.0001, t + a + d); };
    s.T = (type, f0, f1, dur, vol, at, att) => {
      const t = s.t + (at || 0), a = att || 0.005, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + dur);
      env(g.gain, t, a, vol, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.02);
      return o;
    };
    s.N = (ft, f0, f1, dur, vol, q, at, att) => {
      const t = s.t + (at || 0), a = att || 0.004, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = rnd(0.8, 1.2);
      f.type = ft; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + dur);
      env(g.gain, t, a, vol, dur); src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random() * 0.5); src.stop(t + a + dur + 0.02);
    };
    s.F = (f, ratio, idx, dur, vol, at) => {
      const t = s.t + (at || 0), o = c.createOscillator(), m = c.createOscillator(), mg = c.createGain(), g = c.createGain();
      o.frequency.setValueAtTime(f, t); m.frequency.setValueAtTime(f * ratio, t);
      mg.gain.setValueAtTime(idx * f, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * f * 0.02), t + dur * 0.6);
      m.connect(mg); mg.connect(o.frequency); env(g.gain, t, 0.003, vol, dur); o.connect(g); g.connect(out);
      o.start(t); m.start(t); o.stop(t + dur + 0.03); m.stop(t + dur + 0.03);
    };
    s.B = (f, dur, vol, at) => {
      const t = s.t + (at || 0), o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = o2.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.97, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04); o2.frequency.setValueAtTime(f * 1.006, t);
      lp.type = 'lowpass'; lp.Q.value = 1.5; lp.frequency.setValueAtTime(350, t); lp.frequency.exponentialRampToValueAtTime(f * 7, t + 0.06); lp.frequency.exponentialRampToValueAtTime(f * 3, t + dur);
      env(g.gain, t, 0.03, vol, dur); o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
      o.start(t); o2.start(t); o.stop(t + dur + 0.06); o2.stop(t + dur + 0.06);
    };
    s.vib = (o, rate, cents, at, dur) => { const t = s.t + (at || 0), l = c.createOscillator(), g = c.createGain(); l.frequency.value = rate; g.gain.value = cents; l.connect(g); g.connect(o.detune); l.start(t); l.stop(t + dur); };
    return s;
  }

  // ---------------- cue table ----------------
  // A.def(name, o, f) (other files may add cues; play them with A.play(name)): o = { d seconds (dry), n variants, g playback gain, cap concurrent voices, gap min seconds between plays, pr priority (0 ambient .. 3 alarms), rv baked reverb 0..1, o bake order };
  // f(s, i) draws variant i with the synth s. Cues are baked on A.init; an unbaked cue is silent.
  const C = A.CUES;
  const def = A.def = (name, o, f) => {
    o.name = name; o.f = f; o.n = o.n || 1; o.g = o.g === undefined ? 0.6 : o.g; o.cap = o.cap || 3; o.gap = o.gap || 0; o.pr = o.pr === undefined ? 1 : o.pr; o.rv = o.rv || 0; o.o = o.o === undefined ? 1 : o.o;
    o.bufs = null; o.live = 0; o.last = -9; o.an = 0; o.ag = 0; o.ap = 0; o.ar = 1; o.apr = 0;
    C[name] = o;
    if (A.ready) bakeCue(o).catch((e) => { o.err = String(e && e.message || e); }); // defined after A.init: baked on its own
    return o;
  };

  // ---- combat core ----
  def('hit', { d: 0.16, n: 4, g: 0.3, cap: 4, gap: 0.04, o: 0 }, (s) => { s.N('bandpass', rnd(1800, 2600), 500, 0.05, 0.8, 1.2); s.T('triangle', rnd(190, 230), 70, 0.08, 0.6); s.T('sine', 120, 45, 0.09, 0.7); s.N('lowpass', 1300, 200, 0.06, 0.4); });
  def('crit', { d: 0.32, n: 3, g: 0.34, cap: 3, gap: 0.06, pr: 2, o: 0 }, (s) => {
    s.N('bandpass', 4200, 1400, 0.03, 0.8, 1.4); s.T('triangle', 240, 70, 0.1, 0.6); s.T('sine', 110, 40, 0.12, 0.7);
    s.F(rnd(1500, 1700), 1.41, 1.2, 0.25, 0.35); s.T('sine', 2640, 2400, 0.18, 0.2); s.N('highpass', 5000, 3000, 0.08, 0.35, 0.8);
  });
  def('hit.mass', { d: 0.32, n: 3, g: 0.22, cap: 2, gap: 0.08, o: 0 }, (s) => {
    for (let i = 0; i < 7; i++) s.N('bandpass', rnd(900, 2600), 500, 0.03, rnd(0.4, 0.8), 1.5, rnd(0, 0.14));
    s.T('sine', 110, 42, 0.2, 0.6); s.N('lowpass', 1100, 150, 0.2, 0.5);
  });
  def('die', { d: 0.3, n: 5, g: 0.3, cap: 4, gap: 0.04, o: 0 }, (s) => {
    s.T('sine', rnd(300, 380), 60, 0.14, 0.7); s.N('bandpass', rnd(900, 1400), 300, 0.12, 0.6, 2); s.N('lowpass', 800, 100, 0.18, 0.45); s.T('triangle', rnd(500, 700), 150, 0.05, 0.2, 0.01);
  });
  def('die.mass', { d: 0.5, n: 3, g: 0.3, cap: 2, gap: 0.09, o: 0 }, (s) => {
    for (let i = 0; i < 10; i++) s.N('bandpass', rnd(600, 2200), 400, 0.025, rnd(0.4, 0.9), 2, rnd(0, 0.2));
    s.T('sine', 92, 34, 0.35, 0.8); s.N('lowpass', 1000, 80, 0.4, 0.6); s.T('square', 300, 120, 0.06, 0.1);
  });
  def('die.elite', { d: 1.1, n: 2, g: 0.75, cap: 2, gap: 0.1, pr: 2, rv: 0.3 }, (s) => {
    s.T('sine', 140, 28, 0.7, 1); s.N('lowpass', 2400, 60, 0.8, 0.9); s.F(220, 1.41, 3, 0.8, 0.3); s.N('highpass', 6000, 3000, 0.4, 0.3, 0.8, 0.05);
    [880, 1175, 1568].forEach((f, i) => s.T('sine', f, f, 0.5, 0.12, 0.08 + i * 0.06));
  });
  def('eshoot', { d: 0.14, n: 2, g: 0.16, cap: 3, gap: 0.05, pr: 0, o: 0 }, (s) => { s.T('square', rnd(480, 600), 220, 0.09, 0.4); s.N('bandpass', 1500, 600, 0.06, 0.3, 2); });
  def('chain', { d: 0.26, n: 3, g: 0.45, cap: 3, gap: 0.06 }, (s) => {
    s.T('sawtooth', 2600, 180, 0.1, 0.5); s.N('highpass', 3200, 1500, 0.08, 0.8, 0.6);
    for (let i = 0; i < 3; i++) { s.T('sawtooth', rnd(1200, 2200), 300, 0.03, 0.3, 0.03 + i * 0.03); s.N('highpass', 4000, 2500, 0.02, 0.4, 0.7, 0.03 + i * 0.03); }
    s.T('square', 120, 100, 0.12, 0.08);
  });
  // explosions (r scales gain and pitch at playback)
  def('boom', { d: 0.7, n: 2, g: 0.45, cap: 4, gap: 0.05, rv: 0.15 }, (s) => { s.T('sine', 110, 30, 0.5, 1); s.N('lowpass', 1800, 60, 0.6, 0.9); s.N('bandpass', 800, 200, 0.2, 0.4); });
  def('boom.fire', { d: 0.8, n: 3, g: 0.45, cap: 4, gap: 0.05, rv: 0.15 }, (s) => {
    s.N('lowpass', 2400, 160, 0.5, 1, 1); s.T('sine', 95, 36, 0.4, 0.9); s.N('bandpass', 300, 2000, 0.2, 0.4, 1.1, 0, 0.03);
    for (let i = 0; i < 6; i++) s.N('highpass', rnd(3000, 6000), 2500, 0.012, 0.35, 0.8, rnd(0.03, 0.35));
  });
  def('boom.holy', { d: 0.9, n: 2, g: 0.45, cap: 3, gap: 0.06, rv: 0.3 }, (s) => { s.T('sine', 130, 45, 0.35, 0.9); s.N('lowpass', 1500, 120, 0.3, 0.5); [784, 1175, 1568].forEach((f, i) => s.T('sine', f, f, 0.6 - i * 0.1, 0.25, 0.01 + i * 0.02)); s.N('highpass', 6000, 4000, 0.4, 0.2, 0.8); });
  def('boom.frost', { d: 0.6, n: 2, g: 0.55, cap: 3, gap: 0.06, rv: 0.15 }, (s) => { s.N('highpass', 3800, 1400, 0.3, 1, 0.7); s.T('square', 3200, 800, 0.1, 0.12); [2600, 3400, 4100].forEach((f, i) => s.T('sine', f, f * 0.7, 0.14, 0.2, 0.03 + i * 0.045)); s.T('sine', 140, 60, 0.15, 0.6); });
  def('boom.poison', { d: 0.6, n: 2, g: 0.38, cap: 3, gap: 0.06 }, (s) => { s.N('bandpass', 700, 200, 0.3, 0.9, 3); s.T('sine', 150, 50, 0.25, 0.7); for (let i = 0; i < 5; i++) { const f = rnd(180, 360); s.T('sine', f, f * 2.2, 0.05, 0.35, rnd(0.02, 0.3)); } });
  def('boom.shock', { d: 0.8, n: 2, g: 0.5, cap: 3, gap: 0.06, rv: 0.2 }, (s) => { s.T('sine', 85, 30, 0.6, 1); s.N('bandpass', 2400, 250, 0.5, 0.7, 1, 0, 0.02); s.N('lowpass', 900, 60, 0.5, 0.7); s.F(180, 2.76, 2, 0.4, 0.15); });
  def('boom.dark', { d: 0.7, n: 2, g: 0.42, cap: 3, gap: 0.06, rv: 0.2 }, (s) => { s.T('sawtooth', 120, 40, 0.4, 0.3); s.T('sine', 90, 30, 0.5, 1); s.N('lowpass', 1200, 80, 0.5, 0.8); for (let i = 0; i < 5; i++) s.N('bandpass', rnd(900, 2000), 400, 0.03, 0.5, 3, rnd(0, 0.15)); });
  def('boom.foe', { d: 0.55, n: 3, g: 0.55, cap: 3, gap: 0.06, pr: 2 }, (s) => { s.N('lowpass', 2000, 120, 0.35, 1); s.T('sine', 130, 40, 0.3, 0.9); s.T('square', 700, 150, 0.08, 0.15); s.N('bandpass', 2500, 800, 0.08, 0.5, 2); });
  // ---- hero ----
  def('hurt', { d: 0.34, n: 3, g: 0.85, cap: 2, gap: 0.12, pr: 3, o: 0 }, (s) => { s.T('sawtooth', rnd(180, 210), 70, 0.22, 0.5); s.N('lowpass', 1400, 200, 0.18, 0.8); s.T('sine', 110, 48, 0.16, 0.8); s.N('bandpass', 2600, 1200, 0.04, 0.4, 2); });
  def('heart', { d: 0.5, n: 1, g: 0.5, cap: 1, gap: 0.4, pr: 3 }, (s) => { s.T('sine', 70, 42, 0.14, 1); s.N('lowpass', 400, 120, 0.1, 0.4); s.T('sine', 64, 40, 0.16, 0.8, 0.2); s.N('lowpass', 350, 110, 0.1, 0.3, 1, 0.2); });
  def('dash', { d: 0.24, n: 3, g: 0.7, cap: 2, gap: 0.1, pr: 2, o: 0 }, (s) => { s.N('bandpass', 600, 3500, 0.16, 1, 0.8); s.N('highpass', 2000, 6000, 0.12, 0.3, 0.8, 0.02); s.T('sine', 300, 600, 0.1, 0.1); });
  def('down', { d: 1.1, n: 1, g: 0.7, cap: 1, gap: 0.3, pr: 3, rv: 0.3 }, (s) => { [440, 330, 220].forEach((f, i) => s.T('triangle', f, f * 0.95, 0.3, 0.5, i * 0.14)); s.T('sine', 90, 40, 0.4, 0.8, 0.3); s.N('lowpass', 600, 80, 0.3, 0.5, 1, 0.3); });
  def('dead', { d: 2, n: 1, g: 0.75, cap: 1, gap: 0.5, pr: 3, rv: 0.45 }, (s) => { s.F(98, 1.41, 2, 1.8, 0.6); s.T('sine', 49, 47, 1.8, 0.5); [392, 349, 311, 262].forEach((f, i) => s.T('triangle', f, f * 0.98, 0.45, 0.25, 0.2 + i * 0.25)); });
  def('revive', { d: 0.9, n: 1, g: 0.65, cap: 1, gap: 0.3, pr: 3, rv: 0.35 }, (s) => { [330, 440, 554, 660, 880].forEach((f, i) => s.T('triangle', f, f, 0.3, 0.4, i * 0.07)); s.N('highpass', 5000, 8000, 0.6, 0.2, 0.8, 0.1, 0.1); s.T('sine', 220, 220, 0.6, 0.3, 0, 0.1); });
  // ---- pickups and progress ----
  def('tink', { d: 0.22, n: 1, g: 0.32, cap: 3, gap: 0.03, pr: 2, o: 0 }, (s) => { s.T('sine', 1047, 1047, 0.16, 0.8); s.T('sine', 2094, 2094, 0.07, 0.25); s.T('triangle', 3141, 3141, 0.03, 0.1); });
  def('gem.big', { d: 0.6, n: 1, g: 0.4, cap: 2, gap: 0.1, pr: 2, rv: 0.2 }, (s) => { [1047, 1319, 1568, 2093].forEach((f, i) => s.T('sine', f, f, 0.25, 0.5, i * 0.045)); s.N('highpass', 7000, 5000, 0.25, 0.15, 0.8, 0.1); });
  def('coin', { d: 0.3, n: 2, g: 0.32, cap: 2, gap: 0.05, pr: 2 }, (s) => { const k = rnd(0.97, 1.03); s.T('sine', 2637 * k, 2637 * k, 0.08, 0.5); s.T('sine', 3520 * k, 3520 * k, 0.15, 0.45, 0.05); s.T('square', 5274 * k, 5274 * k, 0.012, 0.06, 0.05); });
  def('heal', { d: 0.7, n: 1, g: 0.45, cap: 1, gap: 0.6, pr: 2, rv: 0.3 }, (s) => { [523, 659, 784, 1046].forEach((f, i) => s.T('sine', f, f * 1.003, 0.35, 0.45, i * 0.06)); s.N('highpass', 6000, 8000, 0.4, 0.12, 0.8, 0.1, 0.1); });
  def('magnet', { d: 1.0, n: 1, g: 0.55, cap: 1, gap: 0.3, pr: 2 }, (s) => { s.N('bandpass', 300, 4000, 0.5, 0.8, 1.5, 0, 0.4); s.T('sine', 200, 1600, 0.4, 0.3, 0, 0.4); s.T('triangle', 400, 3200, 0.4, 0.1, 0, 0.4); });
  def('bomb', { d: 1.4, n: 1, g: 0.85, cap: 1, gap: 0.3, pr: 3, rv: 0.5 }, (s) => {
    s.T('sine', 100, 28, 1, 1); s.N('lowpass', 3000, 60, 1.1, 0.9); [523, 659, 784, 1046].forEach((f) => s.T('sine', f, f, 1.1, 0.18, 0.02, 0.05)); s.N('highpass', 6000, 3000, 0.8, 0.3, 0.8, 0.05);
  });
  def('chest', { d: 1.4, n: 1, g: 0.7, cap: 1, gap: 0.3, pr: 3, rv: 0.3 }, (s) => {
    s.N('bandpass', 400, 900, 0.3, 0.6, 4); s.T('sine', 130, 60, 0.12, 0.6, 0.3); s.N('lowpass', 800, 150, 0.1, 0.4, 1, 0.3);
    [784, 988, 1175, 1568, 2093].forEach((f, i) => s.T('sine', f, f, 0.5, 0.3, 0.38 + i * 0.07)); s.N('highpass', 7000, 4000, 0.6, 0.15, 0.8, 0.4, 0.1);
  });
  def('brazier', { d: 0.6, n: 2, g: 0.45, cap: 2, gap: 0.06 }, (s) => {
    s.N('bandpass', 1400, 400, 0.12, 0.8, 1.5); s.T('sine', 150, 60, 0.12, 0.5); [2800, 3600, 4300, 3200].forEach((f, i) => s.T('triangle', f, f * 0.8, 0.08, 0.12, 0.03 + i * 0.035 + rnd(0, 0.02)));
    s.N('lowpass', 1800, 200, 0.35, 0.4, 1, 0.05, 0.05);
  });
  def('level', { d: 1.3, n: 1, g: 0.65, cap: 1, gap: 0.25, pr: 3, rv: 0.35 }, (s) => {
    [[392, 0], [523, 0.09], [659, 0.18]].forEach(([f, x]) => s.B(f, 0.18, 0.5, x)); s.B(784, 0.7, 0.6, 0.27); s.B(392, 0.7, 0.35, 0.27);
    [1568, 2093, 2637].forEach((f, i) => s.T('sine', f, f, 0.4, 0.15, 0.3 + i * 0.06)); s.T('sine', 98, 98, 0.6, 0.4, 0.27);
  });
  def('offer', { d: 0.3, n: 1, g: 0.35, cap: 1, gap: 0.2, pr: 2 }, (s) => { s.N('bandpass', 800, 3000, 0.2, 0.7, 1.2); s.T('sine', 880, 1320, 0.12, 0.2, 0.05); });
  def('reroll', { d: 0.4, n: 1, g: 0.4, cap: 1, gap: 0.15, pr: 3 }, (s) => { for (let i = 0; i < 6; i++) s.N('bandpass', rnd(1800, 3200), 1200, 0.03, 0.7, 2, i * 0.045); s.T('sine', 660, 990, 0.1, 0.2, 0.25); });
  def('pick.weapon', { d: 0.9, n: 1, g: 0.6, cap: 1, gap: 0.1, pr: 3, rv: 0.25 }, (s) => {
    s.T('square', 1250, 1230, 0.12, 0.25); s.T('sine', 2490, 2480, 0.55, 0.3); s.T('sine', 3720, 3700, 0.35, 0.15); s.N('bandpass', 3200, 1800, 0.05, 0.7, 2.5); s.T('sine', 160, 70, 0.12, 0.7);
    [784, 1175].forEach((f, i) => s.T('sine', f, f, 0.4, 0.25, 0.15 + i * 0.08));
  });
  def('pick.up', { d: 0.6, n: 1, g: 0.55, cap: 1, gap: 0.1, pr: 3, rv: 0.2 }, (s) => { [0, 0.07].forEach((x, i) => { const f = 1100 * st(i * 5); s.T('square', f, f * 0.99, 0.08, 0.2, x); s.T('sine', f * 2, f * 2, 0.4, 0.3, x); s.N('bandpass', 3400, 2000, 0.03, 0.5, 2.5, x); }); s.T('sine', 150, 70, 0.1, 0.5); });
  def('pick.passive', { d: 0.8, n: 1, g: 0.55, cap: 1, gap: 0.1, pr: 3, rv: 0.3 }, (s) => { [1047, 1319, 1568].forEach((f, i) => { s.T('sine', f, f * 0.998, 0.6 - i * 0.1, 0.4, i * 0.07); s.T('sine', f * 2.76, f * 2.75, 0.2, 0.08, i * 0.07); }); });
  def('pick.skill', { d: 0.9, n: 1, g: 0.6, cap: 1, gap: 0.1, pr: 3, rv: 0.3 }, (s) => { s.B(262, 0.16, 0.6); s.B(392, 0.5, 0.7, 0.17); s.T('sine', 196, 196, 0.5, 0.3, 0.17); s.N('bandpass', 800, 1200, 0.1, 0.15, 2); });
  def('pick.misc', { d: 0.6, n: 1, g: 0.45, cap: 1, gap: 0.1, pr: 3 }, (s) => { let x = 0; for (let i = 0; i < 6; i++) { const f = [2637, 2960, 3136, 3520][(Math.random() * 4) | 0]; s.T('sine', f, f, 0.1, 0.35, x); x += 0.07 * Math.pow(0.85, i); } s.T('triangle', 1760, 1700, 0.25, 0.25, x); });
  def('evolve', { d: 2.4, n: 1, g: 0.85, cap: 1, gap: 0.5, pr: 3, rv: 0.5 }, (s) => {
    s.N('bandpass', 200, 3000, 0.1, 0.5, 1.4, 0, 0.6); s.T('sawtooth', 65, 131, 0.1, 0.2, 0, 0.6);
    [262, 330, 392, 523, 659, 784].forEach((f, i) => { s.T('triangle', f, f * 1.003, 1.2, 0.3, 0.6 + i * 0.06); s.T('sine', f * 2, f * 2, 0.9, 0.1, 0.6 + i * 0.06); });
    s.B(131, 1.3, 0.5, 0.6); s.T('sine', 65, 65, 1.4, 0.6, 0.6); s.F(523, 1.41, 1.5, 1.4, 0.25, 0.6); s.N('highpass', 7000, 4000, 1, 0.2, 1, 0.7, 0.1);
  });
  // ---- run events ----
  def('boss.intro', { d: 2.8, n: 1, g: 0.9, cap: 1, gap: 1, pr: 3, rv: 0.45 }, (s) => {
    s.T('sawtooth', 110, 46, 1.6, 0.4, 0, 0.15); s.T('sawtooth', 117, 49, 1.6, 0.3, 0, 0.15); s.N('lowpass', 900, 100, 1.5, 0.6, 1, 0, 0.15);
    s.F(73, 1.41, 3, 2.6, 0.6); s.T('sine', 55, 28, 2, 0.8); s.N('bandpass', 1800, 600, 0.08, 0.5, 2);
  });
  def('boss.phase', { d: 1.5, n: 1, g: 0.8, cap: 1, gap: 0.5, pr: 3, rv: 0.35 }, (s) => { s.T('sawtooth', 130, 55, 1.1, 0.4, 0, 0.1); s.T('sawtooth', 138, 58, 1.1, 0.3, 0, 0.1); s.N('lowpass', 800, 100, 1, 0.5, 1, 0, 0.1); s.T('sine', 62, 34, 0.5, 0.9); s.N('lowpass', 500, 90, 0.4, 0.6); });
  def('boss.enrage', { d: 2.1, n: 1, g: 0.85, cap: 1, gap: 1, pr: 3, rv: 0.3 }, (s) => {
    s.T('sawtooth', 70, 150, 1, 0.4); s.T('sawtooth', 75, 158, 1, 0.35); s.N('bandpass', 300, 1800, 0.9, 0.5, 2);
    [0.95, 1.2].forEach((d) => { s.T('sine', 62, 34, 0.22, 0.9, d); s.N('lowpass', 500, 90, 0.18, 0.5, 1, d); });
  });
  def('boss.die', { d: 3.2, n: 1, g: 0.95, cap: 1, gap: 1, pr: 3, rv: 0.5 }, (s) => {
    s.N('lowpass', 1600, 40, 1.6, 1); s.T('sine', 92, 22, 1.5, 1); s.T('sawtooth', 160, 40, 1.4, 0.25, 0, 0.05); s.F(320, 1.41, 6, 1.4, 0.3); s.F(510, 2.31, 5, 1.1, 0.2, 0.03);
    for (let i = 0; i < 8; i++) s.N('bandpass', rnd(1500, 5000), 1200, 0.08, 0.35, 3, 0.08 + i * 0.09 + rnd(0, 0.04));
    [523, 659, 784].forEach((f, i) => s.T('sine', f, f, 1.6, 0.12, 0.5 + i * 0.08, 0.1));
  });
  def('warn.swarm', { d: 1.6, n: 1, g: 0.7, cap: 1, gap: 2, pr: 3, rv: 0.4 }, (s) => { s.B(110, 0.5, 0.6); s.B(147, 0.8, 0.7, 0.55); s.B(73, 1.3, 0.4); s.N('lowpass', 200, 900, 1.2, 0.5, 1, 0, 0.8); });
  def('warn.elite', { d: 1.3, n: 1, g: 0.65, cap: 1, gap: 2, pr: 3, rv: 0.4 }, (s) => { s.F(147, 1.41, 3, 1.2, 0.6); s.F(208, 1.41, 2, 1, 0.35, 0.02); s.T('sine', 74, 72, 1.2, 0.5); s.N('bandpass', 2000, 700, 0.06, 0.5, 2); });
  def('warn.boss', { d: 2.6, n: 1, g: 0.8, cap: 1, gap: 3, pr: 3, rv: 0.4 }, (s) => {
    [0, 0.45, 0.8, 1.05, 1.25].forEach((x, i) => { s.T('sine', 120, 46, 0.4, 0.6 + i * 0.1, x); s.N('lowpass', 800, 100, 0.12, 0.4 + i * 0.06, 0.7, x); });
    s.B(98, 1.2, 0.5, 1.3); s.B(147, 1.2, 0.4, 1.3); s.B(49, 1.2, 0.35, 1.3);
  });
  def('tele', { d: 0.5, n: 2, g: 0.45, cap: 3, gap: 0.12, pr: 3 }, (s) => { s.N('bandpass', 400, 2400, 0.3, 0.6, 3, 0, 0.25); s.T('sine', 880, 1320, 0.25, 0.25, 0, 0.25); s.T('square', 1760, 1700, 0.03, 0.2, 0.28); s.N('highpass', 4000, 3000, 0.05, 0.3, 0.8, 0.28); });
  def('ui.click', { d: 0.06, n: 2, g: 0.22, cap: 2, gap: 0.03, pr: 3, o: 0 }, (s) => { s.T('triangle', rnd(880, 940), 700, 0.04, 0.6); s.N('highpass', 4000, 3000, 0.015, 0.3, 0.8); });
  def('ui.hover', { d: 0.05, n: 1, g: 0.09, cap: 1, gap: 0.05, pr: 3, o: 0 }, (s) => { s.T('sine', 1400, 1300, 0.03, 0.5); });

  // ---- weapons: 'w.<id>' base and 'w.<id>+' evolved (A.event resolves unknown ids by name keywords) ----
  // o: overrides for both (g: the base gain; the evolved cue plays 1.4x louder)
  const wpn = (id, d, base, evo, o) => {
    const g = (o && o.g) || 0.3;
    def('w.' + id, Object.assign({ d, n: 2, cap: 3, gap: 0.05 }, o, { g }), base);
    def('w.' + id + '+', Object.assign({ d: d + 0.15, n: 2, cap: 3, gap: 0.05, rv: 0.15 }, o, { g: g * 1.4 }), evo);
  };
  const flick = (s, at, v) => { s.N('highpass', 2800, 7500, 0.07, v, 0.7, at); s.T('square', rnd(2000, 2400), 1500, 0.012, 0.2 * v, at + 0.01); };
  const clack = (s, at, v) => { s.N('bandpass', rnd(1900, 2800), 1300, 0.03, v, 5, at); s.T('triangle', rnd(700, 950), 450, 0.045, 0.4 * v, at); };
  const thunk = (s, at, v) => { s.T('sine', 190, 70, 0.14, v, at); s.N('lowpass', 900, 200, 0.1, 0.7 * v, 1, at); s.T('square', 420, 180, 0.03, 0.2 * v, at); };
  const bub = (s, at, v, lo) => { const f = rnd(180, 320) * (lo || 1); s.T('sine', f, f * 2.2, 0.05, v, at); };
  wpn('cleave', 0.22,
    (s) => { s.N('bandpass', 600, 2800, 0.13, 1, 1.6, 0, 0.04); s.N('highpass', 5200, 3000, 0.06, 0.35, 0.8, 0.05); s.T('sine', 170, 90, 0.08, 0.3, 0.05); },
    (s) => { s.N('bandpass', 500, 2600, 0.16, 1, 1.4, 0, 0.05); s.N('bandpass', 2600, 700, 0.16, 0.8, 1.4, 0.17, 0.03); s.T('sawtooth', 90, 140, 0.3, 0.12, 0, 0.05); s.N('highpass', 5000, 3000, 0.1, 0.3, 0.8, 0.1); s.T('sine', 120, 50, 0.15, 0.4, 0.3); }, { g: 0.32 }, { g: 0.36 });
  wpn('longbow', 0.2,
    (s) => { s.T('triangle', rnd(400, 440), 180, 0.14, 0.7); s.N('bandpass', 700, 300, 0.05, 0.6, 2); s.N('highpass', 2500, 6000, 0.14, 0.3, 0.7, 0.02); s.T('sine', 150, 70, 0.08, 0.35); },
    (s) => { for (let i = 0; i < 3; i++) { s.T('triangle', rnd(380, 460), 170, 0.12, 0.6, i * 0.03); s.N('bandpass', 700, 300, 0.04, 0.4, 2, i * 0.03); } s.N('highpass', 2000, 7000, 0.25, 0.45, 0.6, 0.02); s.T('sine', 2600, 1500, 0.25, 0.12, 0.05); }, { g: 0.38 });
  wpn('firebolt', 0.28,
    (s) => { s.N('lowpass', 1800, 400, 0.2, 0.9, 1, 0, 0.03); s.T('sine', 240, 110, 0.16, 0.5); s.N('bandpass', 400, 1600, 0.12, 0.4, 1.2, 0, 0.02); for (let i = 0; i < 3; i++) s.N('highpass', rnd(3500, 6000), 2500, 0.012, 0.35, 0.8, rnd(0.04, 0.2)); },
    (s) => { s.N('lowpass', 2600, 300, 0.4, 1, 0.9, 0, 0.06); s.T('sawtooth', 110, 55, 0.35, 0.25, 0, 0.04); s.T('sine', 90, 40, 0.3, 0.7); for (let i = 0; i < 6; i++) s.N('highpass', rnd(3000, 6000), 2500, 0.012, 0.35, 0.8, rnd(0.04, 0.4)); });
  wpn('boneshard', 0.16,
    (s) => { clack(s, 0, 1); s.N('highpass', 2500, 5500, 0.09, 0.35, 0.7, 0.01); clack(s, 0.035, 0.5); },
    (s) => { for (let i = 0; i < 6; i++) clack(s, i * 0.04 + rnd(0, 0.015), rnd(0.5, 0.9)); s.N('bandpass', 400, 2400, 0.3, 0.5, 1.1, 0, 0.05); s.T('sine', 110, 60, 0.2, 0.35); }, { g: 0.38 });
  wpn('smite', 0.5,
    (s) => { s.N('bandpass', 5000, 900, 0.22, 0.6, 1.4); s.T('sine', 1568, 1560, 0.45, 0.35, 0.02); s.T('sine', 2350, 2345, 0.3, 0.15, 0.02); s.T('sine', 140, 48, 0.2, 0.9, 0.14); s.N('lowpass', 1200, 120, 0.18, 0.6, 0.9, 0.14); },
    (s) => { s.N('bandpass', 5000, 700, 0.25, 0.7, 1.4); [523, 659, 784, 1568].forEach((f, i) => s.T('sine', f, f, 0.7, 0.22, 0.02 + i * 0.03)); s.T('sine', 120, 38, 0.3, 1, 0.14); s.N('lowpass', 800, 60, 0.5, 0.7, 0.8, 0.16); s.N('highpass', 2000, 600, 0.12, 0.5, 0.6, 0.14); }, { g: 0.34 });
  wpn('daggers', 0.12,
    (s) => { flick(s, 0, 1); s.N('bandpass', 4500, 3000, 0.04, 0.3, 3, 0.04); },
    (s) => { flick(s, 0, 1); flick(s, 0.05, 0.8); s.N('bandpass', 900, 400, 0.25, 0.35, 1.2, 0, 0.05); s.T('sine', 180, 120, 0.25, 0.2); }, { g: 0.26, gap: 0.06 }, { g: 0.5 });
  wpn('toll', 0.9,
    (s) => { const j = rnd(0.98, 1.02); s.N('bandpass', 2400, 900, 0.03, 0.6, 2); s.F(392 * j, 1.41, 1.4, 0.7, 0.6); s.T('sine', 196 * j, 195 * j, 0.9, 0.35); s.T('sine', 1082 * j, 1078 * j, 0.25, 0.08); s.T('sine', 90, 45, 0.15, 0.4); },
    (s) => { [392, 494, 587].forEach((f, i) => { s.F(f, 1.41, 1.4, 0.9, 0.45, i * 0.12); s.T('sine', f / 2, f / 2, 1, 0.2, i * 0.12); }); s.T('sine', 98, 97, 1, 0.4); s.N('highpass', 6000, 4000, 0.5, 0.12, 0.8, 0.1); }, { g: 0.34 });
  wpn('lanterns', 0.32,
    (s) => { s.N('bandpass', 260, 1400, 0.25, 0.6, 1.4, 0, 0.08); s.T('sine', 330, 495, 0.3, 0.35, 0, 0.05); s.T('triangle', 660, 990, 0.25, 0.12, 0.05); s.N('highpass', 4000, 6000, 0.1, 0.15, 0.8, 0.08); },
    (s) => { s.N('lowpass', 3000, 400, 0.5, 0.8, 0.9, 0, 0.1); [440, 554, 659, 880].forEach((f, i) => s.T('sine', f, f, 0.5, 0.2, i * 0.03, 0.08)); s.N('bandpass', 300, 3000, 0.3, 0.4, 1.2, 0, 0.1); });
  wpn('chainspark', 0.26,
    (s) => { s.T('sawtooth', 2600, 180, 0.1, 0.5); s.N('highpass', 3200, 1500, 0.08, 0.8, 0.6); for (let i = 0; i < 3; i++) { s.T('sawtooth', rnd(1200, 2200), 300, 0.03, 0.3, 0.03 + i * 0.03); s.N('highpass', 4000, 2500, 0.02, 0.4, 0.7, 0.03 + i * 0.03); } s.T('square', 120, 100, 0.12, 0.08); },
    (s) => { s.N('highpass', 1500, 400, 0.3, 1, 0.5); s.N('lowpass', 600, 60, 0.6, 0.8, 1, 0.05); for (let i = 0; i < 5; i++) s.T('sawtooth', rnd(1500, 2800), 200, 0.06, 0.3, i * 0.035); }, { g: 0.5 });
  wpn('frostring', 0.4,
    (s) => { s.T('sine', 1800, 3000, 0.3, 0.4); [2637, 3136, 3951].forEach((f, i) => s.T('sine', f, f * 0.99, 0.25, 0.25, 0.04 + i * 0.05)); s.N('highpass', 7000, 4000, 0.3, 0.3, 0.8, 0, 0.05); s.N('bandpass', 1200, 3000, 0.25, 0.3, 2, 0, 0.05); },
    (s) => { s.N('highpass', 2800, 1400, 0.04, 1, 0.8); s.T('square', 2600, 1900, 0.025, 0.15); s.T('sine', 110, 50, 0.3, 0.6); [2093, 2637, 3136, 3951].forEach((f, i) => s.T('sine', f, f * 0.98, 0.35, 0.22, 0.03 + i * 0.05)); s.N('highpass', 6500, 3500, 0.4, 0.3, 0.8, 0.02); }, { g: 0.38 });
  wpn('bramble', 0.25,
    (s) => { for (let i = 0; i < 4; i++) s.N('bandpass', rnd(700, 1600), 400, 0.03, 0.7, 3, i * 0.035 + rnd(0, 0.01)); s.T('sawtooth', 110, 80, 0.18, 0.12); s.N('lowpass', 900, 200, 0.15, 0.5); s.T('triangle', 300, 150, 0.06, 0.2); },
    (s) => { for (let i = 0; i < 8; i++) s.N('bandpass', rnd(600, 1600), 350, 0.035, 0.7, 3, i * 0.035 + rnd(0, 0.015)); s.T('sawtooth', 70, 52, 0.45, 0.15, 0, 0.1); s.N('lowpass', 700, 120, 0.35, 0.6); }, { g: 0.42 });
  wpn('glaive', 0.32,
    (s) => { for (let i = 0; i < 4; i++) s.N('bandpass', 1400 + i * 250, 1000, 0.07, 0.6, 5, i * 0.075); s.T('sawtooth', 160, 230, 0.3, 0.1, 0, 0.04); s.T('sine', 340, 460, 0.3, 0.15, 0, 0.04); },
    (s) => { for (let i = 0; i < 6; i++) { s.N('bandpass', 1300 + i * 220, 900, 0.06, 0.55, 5, i * 0.06); s.N('bandpass', 1900 + i * 200, 1200, 0.06, 0.4, 5, 0.03 + i * 0.06); } s.T('sine', 300, 520, 0.4, 0.15, 0, 0.05); });
  wpn('meteorcall', 0.5,
    (s) => { s.T('sine', 3000, 700, 0.45, 0.35, 0, 0.02); s.T('triangle', 1500, 350, 0.45, 0.15); s.N('highpass', 3000, 1200, 0.4, 0.25, 0.8, 0, 0.1); },
    (s) => { for (let i = 0; i < 3; i++) { const k = rnd(0.9, 1.15); s.T('sine', 3400 * k, 900 * k, 0.3, 0.3, i * 0.12, 0.02); s.N('highpass', 7000, 4000, 0.1, 0.15, 0.8, i * 0.12 + 0.05); } });
  wpn('bonespear', 0.22,
    (s) => { s.N('bandpass', 350, 2200, 0.12, 0.9, 1.1, 0, 0.03); s.T('sine', 160, 60, 0.12, 0.5, 0.02); clack(s, 0.1, 0.5); },
    (s) => { s.N('bandpass', 300, 2400, 0.14, 1, 1.1, 0, 0.03); s.T('sine', 130, 45, 0.2, 0.8, 0.02); for (let i = 0; i < 5; i++) s.N('bandpass', rnd(2800, 4800), 2000, 0.02, 0.4, 4, 0.12 + i * 0.035); });
  wpn('blight', 0.35,
    (s) => { for (let i = 0; i < 4; i++) bub(s, i * 0.06 + rnd(0, 0.02), 0.45); s.N('lowpass', 700, 200, 0.25, 0.5, 1.5, 0, 0.05); s.T('sine', 90, 60, 0.2, 0.25); },
    (s) => { for (let i = 0; i < 8; i++) bub(s, i * 0.045 + rnd(0, 0.02), 0.45, 0.75); s.N('lowpass', 500, 150, 0.4, 0.6, 2, 0, 0.08); s.N('highpass', 3000, 2000, 0.3, 0.12, 0.7, 0.05); }, { g: 0.36 });
  wpn('wisp', 0.4,
    (s) => { const o = s.T('triangle', 520, 780, 0.3, 0.35, 0, 0.1); s.vib(o, 7, 30, 0, 0.45); s.T('sine', 1040, 1560, 0.25, 0.15, 0.02, 0.1); s.N('bandpass', 1800, 2600, 0.3, 0.25, 5, 0, 0.1); },
    (s) => { [523, 659, 784].forEach((f, i) => { const o = s.T('triangle', f, f * 1.5, 0.35, 0.25, i * 0.05, 0.12); s.vib(o, 6 + i, 25, 0, 0.6); }); s.N('highpass', 6000, 4000, 0.4, 0.15, 0.8, 0.05, 0.1); });
  wpn('mortar', 0.3,
    (s) => { thunk(s, 0, 1); s.N('bandpass', 2000, 4000, 0.25, 0.2, 2, 0.05, 0.05); },
    (s) => { for (let i = 0; i < 5; i++) thunk(s, i * 0.07, 0.8); s.N('bandpass', 2000, 4000, 0.3, 0.2, 2, 0.1, 0.05); }, { g: 0.36 });
  wpn('censer', 0.35,
    (s) => { for (let i = 0; i < 3; i++) s.N('bandpass', rnd(3000, 4800), 2200, 0.02, 0.25, 5, i * 0.05); s.N('bandpass', 400, 1500, 0.25, 1, 1.2, 0, 0.08); s.N('highpass', 5000, 3500, 0.3, 0.4, 0.7, 0.05, 0.1); s.T('sine', 220, 180, 0.2, 0.25, 0, 0.05); },
    (s) => { for (let i = 0; i < 4; i++) s.N('bandpass', rnd(3000, 4800), 2200, 0.02, 0.25, 5, i * 0.05); s.N('bandpass', 400, 1500, 0.25, 1, 1.2, 0, 0.08); [1175, 1568].forEach((f, i) => s.T('sine', f, f, 0.4, 0.25, 0.1 + i * 0.07)); });
  wpn('ricochet', 0.14,
    (s) => { s.N('bandpass', 1900, 1300, 0.03, 1, 5); s.T('triangle', 760, 520, 0.045, 0.4); s.T('sine', 200, 120, 0.05, 0.3); },
    (s) => { for (let i = 0; i < 4; i++) { s.N('bandpass', rnd(1500, 2400), 1100, 0.03, 0.8, 5, i * 0.05); s.T('triangle', rnd(600, 800), 450, 0.04, 0.3, i * 0.05); } s.N('lowpass', 400, 80, 0.35, 0.6, 1, 0, 0.05); }, { g: 0.42 });
  // generic fallbacks for weapons no keyword matches
  wpn('proj', 0.16, (s) => { s.T('triangle', rnd(800, 950), 300, 0.08, 0.5); s.N('highpass', 3000, 1500, 0.05, 0.3); }, (s) => { s.T('triangle', rnd(700, 850), 250, 0.12, 0.5); s.N('highpass', 2500, 6000, 0.15, 0.4, 0.7); s.T('sine', 140, 70, 0.08, 0.3); });
  wpn('melee', 0.2, (s) => { s.N('bandpass', 700, 2400, 0.12, 1, 1.5, 0, 0.03); s.T('sine', 160, 80, 0.08, 0.3, 0.05); }, (s) => { s.N('bandpass', 500, 2600, 0.18, 1, 1.4, 0, 0.04); s.T('sine', 120, 50, 0.15, 0.5, 0.08); });
  wpn('aura', 0.3, (s) => { s.N('bandpass', 300, 1200, 0.22, 0.6, 1.4, 0, 0.06); s.T('sine', 330, 440, 0.25, 0.3, 0, 0.05); }, (s) => { s.N('bandpass', 250, 1600, 0.3, 0.7, 1.4, 0, 0.08); s.T('sine', 262, 392, 0.35, 0.3, 0, 0.06); s.T('sine', 523, 784, 0.3, 0.12, 0.05, 0.06); });

  // ---- hero skills: 'k.<id>' (k.q / k.e fallbacks); they must sound huge ----
  const skill = (id, d, f, o) => def('k.' + id, Object.assign({ d, n: 1, g: 0.8, cap: 2, gap: 0.2, pr: 3, rv: 0.35 }, o), f);
  skill('charge', 0.5, (s) => {
    s.N('bandpass', 260, 2400, 0.36, 1, 1.1); s.T('sawtooth', 70, 190, 0.32, 0.3); s.T('sine', 120, 48, 0.16, 1);
    [[1450, 0.03], [1700, 0.11], [1250, 0.19]].forEach(([f, x]) => s.T('square', f, f * 0.7, 0.05, 0.15, x)); s.N('highpass', 3800, 2000, 0.07, 0.3, 0.7, 0.02);
  });
  skill('volley', 2.1, (s) => {
    s.T('triangle', 430, 190, 0.2, 0.4); s.N('bandpass', 700, 300, 0.07, 0.5, 2); s.N('highpass', 2200, 6500, 0.28, 0.6, 0.6); s.T('sine', 150, 70, 0.1, 0.4);
    for (let i = 0; i < 5; i++) s.N('bandpass', 2600 + i * 400, 1200, 0.1, 0.18, 3, 0.015 * i);
    s.N('highpass', 3000, 5000, 1.5, 0.25, 0.7, 0.25, 0.3); for (let i = 0; i < 14; i++) s.T('sine', rnd(190, 250), 85, 0.06, rnd(0.15, 0.3), rnd(0.35, 2));
  }, { g: 1 });
  skill('meteor', 0.6, (s) => { s.T('sine', 2400, 300, 0.5, 0.4, 0, 0.02); s.N('bandpass', 4000, 300, 0.5, 0.6, 1.4, 0, 0.05); s.N('lowpass', 300, 900, 0.3, 0.5, 1, 0.1, 0.2); }, { rv: 0.2 });
  skill('corpseblast', 0.8, (s) => { s.T('sine', 160, 35, 0.5, 1); s.N('lowpass', 2000, 80, 0.6, 0.9, 0.8); for (let i = 0; i < 8; i++) s.N('bandpass', rnd(600, 2000), 400, 0.03, 0.5, 2, rnd(0, 0.2)); s.N('bandpass', 600, 200, 0.3, 0.5, 4, 0.02); });
  skill('sanctuary', 1.4, (s) => { [523, 659, 784, 1046].forEach((f, i) => s.T('sine', f, f * 1.002, 1, 0.25, i * 0.06, 0.15)); s.F(1046, 2, 1, 1, 0.2); s.N('highpass', 6000, 8000, 1, 0.15, 0.8, 0.1, 0.3); s.T('sine', 131, 131, 1, 0.3, 0, 0.2); });
  skill('step', 0.6, (s) => { s.N('highpass', 6000, 1000, 0.08, 0.8, 0.7, 0, 0.12); s.T('sine', 1800, 300, 0.12, 0.3, 0, 0.1); s.N('bandpass', 700, 300, 0.3, 0.4, 1.2, 0.2); s.T('sine', 110, 60, 0.2, 0.6, 0.22); });
  skill('peal', 2.8, (s) => {
    const f = 196; s.N('bandpass', 1500, 500, 0.08, 0.6, 2); s.F(f, 1.4, 1.8, 1.8, 0.5);
    [[0.5, 0.35, 2.6], [1, 0.3, 2.3], [1.19, 0.15, 1.5], [2, 0.12, 1.2], [2.4, 0.1, 0.9], [1.012, 0.15, 2]].forEach(([r, v, d]) => s.T('sine', f * r, f * r * 0.995, d, v));
    s.T('sine', 82, 40, 0.5, 0.8); s.N('lowpass', 600, 90, 0.4, 0.6);
  }, { rv: 0.5 });
  skill('q', 0.6, (s) => { s.N('bandpass', 300, 3000, 0.3, 0.9, 1.1, 0, 0.05); s.T('sawtooth', 120, 360, 0.3, 0.2); s.T('sine', 90, 40, 0.3, 0.8, 0.1); });
  skill('e', 0.7, (s) => { s.T('sine', 70, 35, 0.5, 1); s.N('bandpass', 2400, 300, 0.45, 0.6, 1, 0, 0.03); s.F(330, 1.41, 1.5, 0.6, 0.3); });

  // ---------------- bake ----------------
  async function bakeCue(cue) {
    const tail = cue.rv ? IR_LEN : 0.03, stride = cue.d + tail + 0.03, per = Math.ceil(stride * SR);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, c = new OAC(1, per * cue.n, SR);
    const dry = c.createGain(); dry.connect(c.destination);
    if (cue.rv) { const cv = c.createConvolver(), wg = c.createGain(); cv.normalize = true; cv.buffer = irBuf; wg.gain.value = cue.rv; dry.connect(cv); cv.connect(wg); wg.connect(c.destination); }
    const s = synth(c, dry);
    for (let i = 0; i < cue.n; i++) { s.t = i * per / SR + 0.002; cue.f(s, i); }
    const out = await c.startRendering(), d = out.getChannelData(0);
    let pk = 0; for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > pk) pk = a; }
    const k = pk > 1e-5 ? 0.9 / pk : 0, bufs = [];
    for (let v = 0; v < cue.n; v++) {
      const o = v * per; let n = per;
      while (n > 64 && Math.abs(d[o + n - 1]) * k < 0.002) n--; // trim the silent tail (shorter voices free the budget sooner)
      const fade = Math.min(n, Math.round(SR * 0.004)), b = A.ctx.createBuffer(1, n, SR), bd = b.getChannelData(0);
      for (let i = 0; i < n; i++) bd[i] = d[o + i] * k * (i >= n - fade ? (n - i) / fade : 1);
      bufs.push(b);
    }
    cue.bufs = bufs; cue.dur = bufs.reduce((m, b) => Math.max(m, b.duration), 0);
  }
  async function bakeAll() {
    const q = Object.values(C).filter((c) => !c.bufs).sort((a, b) => a.o - b.o), t0 = performance.now();
    const worker = async () => { while (q.length) { const c = q.shift(); try { await bakeCue(c); } catch (e) { c.err = String(e && e.message || e); } } };
    await Promise.all([worker(), worker(), worker()]);
    A.baked = true; A.bakeMs = Math.round(performance.now() - t0);
  }

  // ---------------- graph ----------------
  A.init = () => {
    if (A.ctx) { if (A.ctx.state === 'suspended' && !document.hidden) A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return; }
    A.ctx = ctx;
    const comp = ctx.createDynamicsCompressor(), clip = ctx.createWaveShaper(), curve = new Float32Array(2049);
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.2;
    for (let i = 0; i < curve.length; i++) { const x = i / 1024 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.37 * Math.tanh((a - 0.6) / 0.37)); } // soft clip: linear to 0.6, never past 0.97
    clip.curve = curve;
    master = ctx.createGain(); master.connect(comp); comp.connect(clip); clip.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    duckG = ctx.createGain(); duckG.connect(musicBus);
    muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.5; muffle.connect(duckG);
    A.musicIn = muffle; A.stingIn = musicBus; A.out = clip;
    panOK = typeof ctx.createStereoPanner === 'function';
    noiseBuf = ctx.createBuffer(1, SR, SR); { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    irBuf = ctx.createBuffer(1, Math.floor(SR * IR_LEN), SR); { const d = irBuf.getChannelData(0); let lp = 0; for (let i = 0; i < d.length; i++) { const k = i / d.length; lp += ((Math.random() * 2 - 1) - lp) * (0.6 - 0.45 * k); d[i] = lp * Math.pow(1 - k, 2.4); } }
    A.ready = true;
    A.apply();
    if (window.OfflineAudioContext || window.webkitOfflineAudioContext) bakeAll(); else A.baked = true;
    if (ED.Music && ED.Music.attach) ED.Music.attach(ctx);
    document.addEventListener('visibilitychange', () => { if (!A.ctx) return; if (document.hidden) A.ctx.suspend(); else A.ctx.resume(); });
  };
  // s: settings { master, music, sfx } 0..100 (music and sfx squared: even slider steps sound even).
  A.setVolumes = (s) => { const q = (v) => Math.max(0, Math.min(1, (+v || 0) / 100)); A.vol.master = q(s.master); A.vol.music = q(s.music); A.vol.sfx = q(s.sfx); A.apply(); };
  A.apply = () => {
    if (!A.ready) return;
    const t = A.ctx.currentTime;
    master.gain.setTargetAtTime(A.vol.master, t, 0.02);
    musicBus.gain.setTargetAtTime(A.vol.music * A.vol.music * 0.8, t, 0.02);
    sfxBus.gain.setTargetAtTime(A.vol.sfx * A.vol.sfx, t, 0.02);
  };
  // Ducks the music to lv for dur seconds. Muffle: music lowpass cutoff (Hz) gliding with time constant tc.
  A.duck = (lv, dur) => { if (!A.ready) return; const g = duckG.gain, t = A.ctx.currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(lv, t, 0.06); g.setTargetAtTime(1, t + dur, 0.6); };
  A.muffle = (hz, tc) => { if (A.ready) muffle.frequency.setTargetAtTime(hz, A.ctx.currentTime, tc || 0.3); };
  // Settings preview: one representative cue on the given bus ('sfx').
  A.preview = () => A.play('pick.up');

  // ---------------- voices ----------------
  const V = [], pool = [];
  const free = (i, t, steal) => {
    const r = V[i];
    if (steal) { try { r.g.gain.setTargetAtTime(0, t, 0.008); r.src.stop(t + 0.04); } catch (e) { /* already stopped */ } }
    r.cue.live--; r.src = r.g = r.cue = null; pool.push(r);
    V[i] = V[V.length - 1]; V.length--;
  };
  const prune = (t) => { for (let i = V.length - 1; i >= 0; i--) if (V[i].end <= t) free(i, t, false); };
  // Plays cue (object) at gain g x cue.g, playback rate, pan -1..1, priority pr. Returns 1 played, 0 refused (budget), -1 gap.
  function voice(cue, g, rate, pan, pr) {
    if (!cue || !cue.bufs || !A.ready || A.ctx.state !== 'running') return 0;
    const ctx = A.ctx, t = ctx.currentTime;
    if (t - cue.last < cue.gap) return -1;
    prune(t);
    if (cue.live >= cue.cap) return 0;
    if (V.length >= MAXV) {
      let vi = -1;
      for (let i = 0; i < V.length; i++) if (V[i].pr < pr && (vi < 0 || V[i].pr < V[vi].pr || (V[i].pr === V[vi].pr && V[i].t0 < V[vi].t0))) vi = i;
      if (vi < 0) return 0;
      free(vi, t, true);
    }
    const b = cue.bufs[cue.n > 1 ? (Math.random() * cue.bufs.length) | 0 : 0];
    const src = ctx.createBufferSource(), gn = ctx.createGain();
    src.buffer = b; src.playbackRate.value = rate; gn.gain.value = Math.min(2.5, g * cue.g);
    src.connect(gn);
    if (panOK && (pan > 0.04 || pan < -0.04)) { const p = ctx.createStereoPanner(); p.pan.value = pan; gn.connect(p); p.connect(sfxBus); } else gn.connect(sfxBus);
    src.start(t);
    const r = pool.pop() || {}; r.src = src; r.g = gn; r.cue = cue; r.pr = pr; r.t0 = t; r.end = t + b.duration / rate + 0.01;
    V.push(r); cue.live++; cue.last = t; A.played++;
    return 1;
  }
  A.voices = () => V.length;
  // Stops every live SFX voice (20 ms fade).
  A.hush = () => { if (A.ready) for (let i = V.length - 1; i >= 0; i--) free(i, A.ctx.currentTime, true); };
  // Legacy cue names (older callers) -> cues.
  const ALIAS = { xp: 'tink', gold: 'coin', roar: 'boss.intro', fury: 'boss.enrage', click: 'ui.click', hover: 'ui.hover', skill: 'k.q', swing: 'w.melee', shoot: 'w.proj', victory: null, defeat: null };
  // Direct play by name: vol gain, rate (1), pan (0), pr (cue default).
  A.play = (name, vol, rate, pan, pr) => {
    const n = ALIAS[name] !== undefined ? ALIAS[name] : name, c = n && C[n];
    if (!c) return 0;
    return voice(c, vol === undefined ? 1 : vol, rate || rnd(0.97, 1.03), pan || 0, pr === undefined ? c.pr : pr);
  };

  // ---------------- weapon and skill cue resolution ----------------
  // Weapon id -> cue: 'w.<id>' if defined, else keywords of the id and name (evolved defs use their base's family, '+' variant), else by look / mode.
  const WKEY = [['bone storm', 'boneshard'], ['bonestorm', 'boneshard'], ['shadow fan', 'daggers'], ['shadowfan', 'daggers'], ['spear', 'bonespear'], ['impal', 'bonespear'], ['shard', 'boneshard'],
    ['lantern', 'lanterns'], ['sun wheel', 'lanterns'], ['sunwheel', 'lanterns'], ['chain', 'chainspark'], ['spark', 'chainspark'], ['storm', 'chainspark'], ['frost', 'frostring'], ['glacier', 'frostring'],
    ['bramble', 'bramble'], ['thorn', 'bramble'], ['glaive', 'glaive'], ['moon', 'glaive'], ['meteor', 'meteorcall'], ['star', 'meteorcall'], ['blight', 'blight'], ['plague', 'blight'], ['wisp', 'wisp'],
    ['mortar', 'mortar'], ['barrage', 'mortar'], ['censer', 'censer'], ['ricochet', 'ricochet'], ['avalanche', 'ricochet'], ['cleave', 'cleave'], ['whirl', 'cleave'], ['bow', 'longbow'], ['hail', 'longbow'],
    ['arrow', 'longbow'], ['fire', 'firebolt'], ['inferno', 'firebolt'], ['bone', 'boneshard'], ['smite', 'smite'], ['wrath', 'smite'], ['dagger', 'daggers'], ['knife', 'daggers'], ['toll', 'toll'],
    ['cathedral', 'toll'], ['bell', 'toll']];
  const WC = {};
  const famOf = (id, d) => {
    if (C['w.' + id]) return id;
    const txt = (id + ' ' + (d && d.name || '')).toLowerCase();
    for (const [k, f] of WKEY) if (txt.indexOf(k) >= 0) return f;
    return d && d.mode === 'around' ? 'aura' : d && d.look ? 'proj' : 'melee';
  };
  const wcue = A.wcue = (wid) => {
    let c = WC[wid];
    if (c !== undefined) return c;
    const d = ED.WEAPONS && ED.WEAPONS[wid];
    if (C['w.' + wid]) c = C['w.' + wid];
    else if (d && d.evolved) c = C['w.' + famOf(d.from || wid, ED.WEAPONS[d.from]) + '+'] || C['w.' + famOf(wid, d) + '+'];
    else c = C['w.' + famOf(wid, d)];
    return (WC[wid] = c || C['w.proj']);
  };
  const SKEY = [['charge', 'charge'], ['volley', 'volley'], ['rain', 'volley'], ['meteor', 'meteor'], ['corpse', 'corpseblast'], ['sanctu', 'sanctuary'], ['step', 'step'], ['blink', 'step'], ['peal', 'peal']];
  const SC = {};
  const scue = A.scue = (id, slot) => {
    let c = SC[id];
    if (c !== undefined) return c;
    if (C['k.' + id]) c = C['k.' + id];
    else { const d = ED.SKILLS && ED.SKILLS[id], txt = (id + ' ' + (d && d.name || '')).toLowerCase(); for (const [k, f] of SKEY) if (txt.indexOf(k) >= 0) { c = C['k.' + f]; break; } }
    return (SC[id] = c || C[slot ? 'k.e' : 'k.q']);
  };
  // Boom look -> cue family.
  const BKEY = [['fire', 'boom.fire'], ['meteor', 'boom.fire'], ['flame', 'boom.fire'], ['holy', 'boom.holy'], ['light', 'boom.holy'], ['frost', 'boom.frost'], ['ice', 'boom.frost'], ['poison', 'boom.poison'],
    ['blight', 'boom.poison'], ['shock', 'boom.shock'], ['ring', 'boom.shock'], ['whirl', 'boom.shock'], ['bell', 'boom.shock'], ['skull', 'boom.dark'], ['bone', 'boom.dark'], ['shadow', 'boom.dark']];
  const BC = {};
  const bcue = (look) => { let c = BC[look]; if (c) return c; c = C.boom; const l = String(look || ''); for (const [k, f] of BKEY) if (l.indexOf(k) >= 0) { c = C[f]; break; } return (BC[look] = c); };

  // ---------------- events and per-frame aggregation ----------------
  const H = { n: 0, c: 0, max: 0 }, D = { n: 0 }, G = { n: 0, combo: 0, t: -9 }, K = { t: -9, streak: 0 };
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const SWING = {}; // weapon ids whose sound rides on swing / chain events (their shoot event is skipped)
  let zView = null, zMax = 0; // foe telegraphs: the highest zone id seen in this view
  const dirty = [];
  let lx = 0, ly = 0;
  // Gain and pan for a world position relative to the local hero: full within 280 px, fading to 0.2 at 880 px; pan +-0.7 over 400 px.
  let pp = 0;
  const posGain = (x, y) => { if (x === undefined) { pp = 0; return 1; } const dx = x - lx, dy = y - ly, d = Math.sqrt(dx * dx + dy * dy); pp = Math.max(-0.7, Math.min(0.7, dx / 570)); return d <= 280 ? 1 : Math.max(0.2, 1 - (d - 280) / 750); };
  const heroAt = (pid) => { const v = ED.Game && ED.Game.view, hs = v && v.heroes; if (hs) for (let i = 0; i < hs.length; i++) if (hs[i].pid === pid) return hs[i]; return null; };
  // Adds one occurrence of cue at gain g (pan from the last posGain), priority pr; the loudest occurrence of the frame sets the pan.
  const agg = (c, g, pr) => { if (!c) return; if (!c.an) { dirty.push(c); c.ag = 0; c.apr = 0; } c.an++; if (g > c.ag) { c.ag = g; c.ap = pp; } if (pr > c.apr) c.apr = pr; };
  // Occurrence by a hero (pid): mine full, others 0.45 x distance.
  const aggHero = (c, pid, mine, g) => { if (mine) { pp = 0; agg(c, g, 1); return; } const h = heroAt(pid); agg(c, 0.45 * g * (h ? posGain(h.x, h.y) : 0.6), 0); };

  // One World event (ARCHITECTURE §5). myPid: the local hero's pid.
  A.event = (ev, myPid) => {
    if (!A.ready) return;
    const mine = ev.pid === myPid;
    switch (ev.t) {
      case 'hit': H.n++; if (ev.crit) H.c++; if (ev.dmg > H.max) H.max = ev.dmg; break;
      case 'die': if (ev.boss) break; if (ev.elite) { const g = posGain(ev.x, ev.y); agg(C['die.elite'], g, 2); } else D.n++; break;
      case 'shoot': if (!SWING[ev.wid]) aggHero(wcue(ev.wid), ev.pid, mine, 1); break;
      case 'swing': if (ED.WEAPONS && ED.WEAPONS[ev.wid]) { SWING[ev.wid] = 1; aggHero(wcue(ev.wid), ev.pid, mine, 1); } break;
      case 'chain': { // a chain weapon (Chain Spark family) sounds on its arcs; any other chain is a generic zap
        const c = ED.WEAPONS && ED.WEAPONS[ev.wid] ? wcue(ev.wid) : null;
        if (c && c.name.startsWith('w.chainspark')) { SWING[ev.wid] = 1; aggHero(c, ev.pid, mine, 1); } else aggHero(C.chain, ev.pid, mine, 0.7);
        break;
      }
      case 'boom': {
        const g = posGain(ev.x, ev.y), r = ev.r || 60, c = ev.team === 1 ? C['boom.foe'] : ev.wid === 'bomb' ? null : bcue(ev.look || ev.wid);
        if (c) { agg(c, g * Math.min(1.6, 0.45 + r / 150), ev.team === 1 ? 2 : mine ? 1 : 0); if (r > c.ar || c.an === 1) c.ar = r; }
        break;
      }
      case 'eshoot': agg(C.eshoot, posGain(ev.x, ev.y), 0); break;
      case 'dash': if (mine) { pp = 0; agg(C.dash, 1, 2); } break;
      case 'pickup':
        if (!mine) { if (ev.k === 'chest' || ev.k === 'bomb') { pp = 0; agg(C[ev.k], 0.4, 0); } break; }
        pp = 0;
        if (ev.k === 'xp1' || ev.k === 'xp5') G.n++;
        else if (ev.k === 'xp25') { G.n++; agg(C['gem.big'], 1, 2); }
        else if (ev.k === 'gold') agg(C.coin, 1, 2);
        else if (ev.k === 'food') agg(C.heal, 1, 2);
        else if (ev.k === 'magnet') agg(C.magnet, 1, 2);
        else if (ev.k === 'bomb') agg(C.bomb, 1, 3);
        else if (ev.k === 'chest') agg(C.chest, 1, 3);
        break;
      case 'heal': if (mine && ev.v >= 8) { pp = 0; agg(C.heal, 0.8, 2); } break;
      case 'level': pp = 0; agg(C.level, 1, 3); A.duck(0.5, 0.9); break;
      case 'offer': if (mine) { pp = 0; agg(ev.reroll ? C.reroll : C.offer, 1, 3); } break;
      case 'pick': if (mine) { pp = 0; const k = ev.kind; agg(C[k === 'form' ? 'pick.weapon' : k === 'path' || k === 'refine' || k === 'plvl' ? 'pick.up' : k === 'passive' ? 'pick.passive' : k === 'skill' ? 'pick.skill' : 'pick.misc'], k === 'skip' ? 0.5 : 1, 3); } break;
      case 'evolve': aggHero(C.evolve, ev.pid, mine, mine ? 1 : 1.6); if (mine) A.duck(0.35, 2); break;
      case 'hurt': if (mine) { pp = 0; agg(C.hurt, Math.min(1.3, 0.7 + (ev.dmg || 5) / 25), 3); } else agg(C.hurt, 0.25 * posGain(ev.x, ev.y), 0); break;
      case 'down': aggHero(C.down, ev.pid, mine, mine ? 1 : 2); break;
      case 'dead': aggHero(C.dead, ev.pid, mine, mine ? 1 : 2); break;
      case 'revive': aggHero(C.revive, ev.pid, mine, mine ? 1 : 2); break;
      case 'boss': pp = 0; agg(C[ev.phase === 0 ? 'boss.intro' : ev.phase === -1 ? 'boss.die' : ev.phase === 'enrage' ? 'boss.enrage' : 'boss.phase'], 1, 3); if (ev.phase === 0 || ev.phase === -1) A.duck(0.3, 2.2); break;
      case 'brazier': agg(C.brazier, posGain(ev.x, ev.y), 1); break;
      case 'chest': if (mine) { pp = 0; agg(C.chest, 1, 3); } break;
      case 'warn': pp = 0; agg(C['warn.' + ev.kind], 1, 3); break;
      case 'skill': { const c = scue(ev.id, ev.slot); if (mine) { pp = 0; agg(c, 1, 3); } else { const h = heroAt(ev.pid); agg(c, 0.5 * (h ? posGain(h.x, h.y) : 0.6), 0); } break; }
      default: break;
    }
    if (ED.Music && ED.Music.onEvent && (ev.t === 'boss' || ev.t === 'warn' || ev.t === 'end' || ev.t === 'level')) ED.Music.onEvent(ev, myPid);
  };
  // Legacy entry points (older game.js): a hit and a kill.
  A.hit = (crit) => { H.n++; if (crit) H.c++; };
  A.kill = () => { D.n++; };

  // Once per frame: plays every aggregated cue as one voice (gain grows with log2 of its count), the frame's hits / deaths / gem tinks; then clears the frame.
  A.flush = () => {
    if (!A.ready) return;
    const t = A.ctx.currentTime, v = ED.Game && ED.Game.view, m = v && v.me;
    if (m) { lx = m.x; ly = m.y; }
    if (v && v.zones) { // a new foe telegraph (warn zone, not the hero's) rings a rising warning at its position
      if (v !== zView) { zView = v; zMax = 0; }
      let top = zMax;
      for (let i = 0; i < v.zones.length; i++) { const z = v.zones[i]; if (z.id > zMax) { if (z.id > top) top = z.id; if (z.warn && z.team !== 0 && !z.dead) agg(C.tele, posGain(z.x, z.y), 3); } }
      zMax = top;
    }
    if (H.n) {
      const lg = Math.log2(1 + H.n), w = Math.min(1, H.max / 80);
      voice(C.hit, Math.min(1.9, 0.75 + 0.3 * lg), rnd(1.02, 1.12) - 0.22 * w, 0, 1);
      if (H.c) voice(C.crit, Math.min(1.6, 0.8 + 0.25 * Math.log2(1 + H.c)), rnd(0.96, 1.06), 0, 2);
      if (H.n >= 10) voice(C['hit.mass'], Math.min(1.8, 0.4 * (lg - 2.3)), rnd(0.95, 1.05), 0, 1);
      H.n = H.c = H.max = 0;
    }
    if (D.n) { // deaths: one pop, a crunch for a pile, a streak (kills within 0.5 s of each other) raises the crunch up to 7 semitones
      const n = D.n, lg = Math.log2(1 + n);
      if (t - K.t > 0.5) K.streak = 0;
      K.streak += n; K.t = t;
      voice(C.die, Math.min(2.2, 0.8 + 0.35 * lg), rnd(0.92, 1.1), 0, 1);
      if (n >= 5) voice(C['die.mass'], Math.min(2, 0.5 * (lg - 1.4)), st(Math.min(7, K.streak / 40)) * rnd(0.97, 1.03), 0, 1);
      D.n = 0;
    }
    if (G.n) { // gem tink: each tink climbs one pentatonic step (two for a pile) while tinks follow within 0.4 s, up to two octaves; gems held back by the gap ring next frame
      if (t - G.t > 0.4) G.combo = -1;
      const nx = Math.min(PENTA.length - 1, G.combo + (G.n > 3 ? 2 : 1)), r = voice(C.tink, Math.min(1.5, 0.85 + 0.12 * Math.log2(G.n)), st(PENTA[nx]), 0, 2);
      if (r === 1) { G.combo = nx; G.t = t; }
      if (r !== -1) G.n = 0;
    }
    for (let i = 0; i < dirty.length; i++) {
      const c = dirty[i], n = c.an;
      let rate = rnd(0.96, 1.05);
      if (c.name.startsWith('boom')) rate *= Math.max(0.7, Math.min(1.2, 1.2 - c.ar / 400));
      voice(c, c.ag * Math.min(2, 1 + 0.3 * Math.log2(n)), rate, c.ap, c.apr || c.pr);
      c.an = 0; c.ar = 1;
    }
    dirty.length = 0;
  };

  // ---------------- UI ----------------
  if (typeof document !== 'undefined') {
    let hov = null;
    const btn = (e) => (e.target && e.target.closest ? e.target.closest('button, .btn, .card') : null);
    document.addEventListener('click', (e) => { const b = btn(e); if (b && !b.disabled) A.play('ui.click'); }, true);
    document.addEventListener('pointerover', (e) => { const b = btn(e); if (b !== hov) { hov = b; if (b && !b.disabled) A.play('ui.hover'); } }, true);
    const wake = () => { if (A.ctx && A.ctx.state === 'suspended' && !document.hidden) A.ctx.resume(); };
    document.addEventListener('pointerdown', wake, true); document.addEventListener('keydown', wake, true);
  }
})(globalThis.ED || (globalThis.ED = {}));
