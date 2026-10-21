// Synthesized sound: every effect and the generative score are built from oscillators and noise,
// so the game ships no audio files and stays tiny.
(function (ED) {
  'use strict';
  const A = ED.Audio = { ctx: null, ready: false, last: {}, vol: { master: 0.7, music: 0.55, sfx: 0.8 }, track: null };
  let noiseBuf = null, master, musicBus, sfxBus, delay, delayFb, musicFilter;

  A.init = () => {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = A.ctx = new AC();
    master = ctx.createGain(); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 2400; musicFilter.connect(musicBus);
    delay = ctx.createDelay(1.0); delay.delayTime.value = 0.38;
    delayFb = ctx.createGain(); delayFb.gain.value = 0.36;
    delay.connect(delayFb); delayFb.connect(delay); delay.connect(musicFilter);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    A.ready = true;
    A.apply();
    setInterval(schedule, 100);
  };

  A.setVolumes = (s) => { A.vol.master = s.master / 100; A.vol.music = s.music / 100; A.vol.sfx = s.sfx / 100; A.apply(); };
  A.apply = () => {
    if (!A.ready) return;
    master.gain.value = A.vol.master * 0.9;
    musicBus.gain.value = A.vol.music * 0.55;
    sfxBus.gain.value = A.vol.sfx * 0.8;
  };

  // ---------- primitives ----------
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const tone = (type, f0, f1, dur, vol, bus, at) => {
    const ctx = A.ctx, t = at || ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
    return g;
  };
  const noise = (ftype, f0, f1, dur, vol, q, bus, at) => {
    const ctx = A.ctx, t = at || ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = ftype; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); env(g, t, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  };

  const GAP = { hit: 0.035, xp: 0.03, gold: 0.04, eshoot: 0.05, shoot: 0.03, die: 0.03, spark: 0.05, boom: 0.06, swing: 0.03, step: 0.1, freeze: 0.05, shatter: 0.06, combust: 0.06, guardhit: 0.06, block: 0.05, clang: 0.03, throw: 0.08, catch: 0.08, parry: 0.1 };
  // arg: cue-specific parameter (dread: the new tier)
  A.play = (name, vol, arg) => {
    if (!A.ready || A.ctx.state !== 'running') return;
    const now = A.ctx.currentTime;
    if (GAP[name] && now - (A.last[name] || 0) < GAP[name]) return;
    A.last[name] = now;
    const v = vol === undefined ? 1 : vol;
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'swing': noise('bandpass', 1800, 500, 0.12, 0.22 * v, 1.5); break;
      case 'heavy': noise('bandpass', 900, 200, 0.2, 0.3 * v, 1.2); tone('sine', 120, 50, 0.18, 0.2 * v); break;
      case 'shoot': tone('triangle', r(800, 950), 300, 0.08, 0.12 * v); noise('highpass', 3000, 1500, 0.05, 0.05 * v); break;
      case 'fire': noise('lowpass', 1200, 300, 0.2, 0.18 * v); tone('sine', 220, 80, 0.18, 0.1 * v); break;
      case 'magic': tone('sine', r(600, 700), r(1200, 1400), 0.12, 0.08 * v); tone('triangle', 300, 600, 0.12, 0.05 * v); break;
      case 'hit': case 'crit': { // layers: body thump (lower and longer with damage share w), click, element tail; crits add a ringing partial
        const w = arg && arg.w !== undefined ? Math.min(1.4, arg.w) : 0.5, el = arg && arg.el | 0, crit = name === 'crit';
        noise('bandpass', crit ? 3200 : r(1600, 2400), 700, 0.05 + 0.02 * w, (crit ? 0.2 : 0.14 + 0.07 * w) * v, crit ? 3 : 2);
        tone('sine', (crit ? 230 : 190) - 70 * w, 52, 0.07 + 0.07 * w, (0.12 + 0.12 * w) * v);
        if (crit) { tone('square', 520, 140, 0.09, 0.07 * v); tone('sine', 1320, 1180, 0.2, 0.05 * v); }
        if (el === 1) noise('lowpass', 2600, 500, 0.16, 0.1 * v, 1);
        else if (el === 2) tone('sine', r(2600, 3200), 3800, 0.09, 0.06 * v);
        else if (el === 3) { tone('sawtooth', 1600, 300, 0.07, 0.05 * v); noise('highpass', 4500, 2500, 0.05, 0.05 * v); }
        else if (el === 4) noise('bandpass', 420, 180, 0.1, 0.12 * v, 1.5);
        else tone('square', r(1700, 2100), 1200, 0.035, 0.03 * v);
        break;
      }
      case 'die': { // arg: the foe's radius; bigger foes fall lower and longer
        const sz = Math.max(0.6, Math.min(1.7, (arg || 10) / 11));
        tone('sine', r(280, 340) / sz, 50, 0.2 + 0.1 * sz, 0.16 * v); noise('lowpass', 900 / sz, 120, 0.2 * sz, 0.12 * v); noise('bandpass', 1500, 400, 0.08, 0.07 * v, 1.2);
        break;
      }
      case 'hurt': tone('sawtooth', 190, 70, 0.22, 0.18 * v); noise('lowpass', 1400, 200, 0.18, 0.2 * v); break;
      case 'gold': tone('sine', 1320, 1320, 0.05, 0.08 * v); tone('sine', 1760, 1760, 0.07, 0.07 * v, null, A.ctx.currentTime + 0.05); break;
      case 'xp': tone('sine', r(880, 1100), r(1300, 1500), 0.05, 0.04 * v); break;
      case 'heal': [523, 659, 784].forEach((f, i) => tone('sine', f, f, 0.18, 0.06 * v, null, A.ctx.currentTime + i * 0.05)); break;
      case 'level': [392, 523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.22, 0.09 * v, null, A.ctx.currentTime + i * 0.07)); break;
      case 'boon': [659, 988, 1318].forEach((f, i) => tone('sine', f, f * 1.01, 0.35, 0.08 * v, null, A.ctx.currentTime + i * 0.06)); break;
      case 'relic': [523, 784, 1046, 1568].forEach((f, i) => tone('sine', f, f, 0.5, 0.07 * v, null, A.ctx.currentTime + i * 0.08)); noise('highpass', 6000, 3000, 0.4, 0.03 * v); break;
      case 'lock': noise('lowpass', 300, 80, 0.45, 0.35 * v); tone('sine', 70, 40, 0.4, 0.25 * v); break;
      case 'unlock': noise('lowpass', 500, 150, 0.35, 0.22 * v); [392, 523].forEach((f, i) => tone('triangle', f, f, 0.2, 0.07 * v, null, A.ctx.currentTime + 0.1 + i * 0.08)); break;
      case 'boom': noise('lowpass', 900, 60, 0.5, 0.38 * v); tone('sine', 90, 30, 0.45, 0.3 * v); break;
      case 'eshoot': tone('square', r(480, 560), 240, 0.09, 0.035 * v); break;
      case 'dash': noise('highpass', 900, 3500, 0.16, 0.14 * v, 0.7); break;
      case 'skill': tone('sawtooth', 200, 800, 0.22, 0.08 * v); noise('bandpass', 600, 2500, 0.25, 0.12 * v); break;
      case 'roar': tone('sawtooth', 110, 48, 1.3, 0.22 * v); tone('sawtooth', 116, 51, 1.3, 0.18 * v); noise('lowpass', 700, 100, 1.2, 0.25 * v); break;
      case 'click': tone('triangle', 900, 700, 0.04, 0.06 * v); break;
      case 'hover': tone('sine', 1200, 1100, 0.03, 0.025 * v); break;
      case 'chest': noise('bandpass', 400, 900, 0.3, 0.12 * v, 4); [784, 988, 1175].forEach((f, i) => tone('sine', f, f, 0.3, 0.07 * v, null, A.ctx.currentTime + 0.25 + i * 0.07)); break;
      case 'deflect': tone('square', 2400, 1800, 0.06, 0.06 * v); tone('sine', 3200, 3000, 0.1, 0.05 * v); break;
      case 'down': [440, 330, 220].forEach((f, i) => tone('triangle', f, f * 0.95, 0.25, 0.1 * v, null, A.ctx.currentTime + i * 0.12)); break;
      case 'revive': [330, 440, 554, 660].forEach((f, i) => tone('triangle', f, f, 0.2, 0.09 * v, null, A.ctx.currentTime + i * 0.08)); break;
      case 'portal': tone('sine', 200, 900, 1.2, 0.12 * v); tone('sine', 300, 1350, 1.2, 0.08 * v); noise('bandpass', 400, 3000, 1.2, 0.08 * v, 3); break;
      case 'buy': tone('sine', 988, 988, 0.06, 0.08 * v); tone('sine', 1318, 1318, 0.12, 0.08 * v, null, A.ctx.currentTime + 0.07); break;
      case 'deny': tone('square', 200, 150, 0.12, 0.05 * v); break;
      case 'thud': tone('sine', 80, 35, 0.25, 0.3 * v); noise('lowpass', 400, 80, 0.2, 0.2 * v); break;
      case 'spark': noise('highpass', 4000, 2000, 0.04, 0.04 * v); break;
      case 'bolt': noise('highpass', 2500, 600, 0.25, 0.25 * v, 0.5); tone('sawtooth', 1200, 200, 0.2, 0.06 * v); break;
      case 'victory': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone('triangle', f, f, 0.6, 0.1 * v, null, A.ctx.currentTime + i * 0.12)); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.7, 0.1 * v, null, A.ctx.currentTime + i * 0.22)); break;
      case 'spawn': noise('bandpass', 300, 1200, 0.3, 0.05 * v, 2); break;
      case 'freeze': tone('sine', 1900, 2900, 0.1, 0.08 * v); tone('triangle', 3100, 2400, 0.16, 0.05 * v, null, A.ctx.currentTime + 0.04); noise('highpass', 6500, 3500, 0.12, 0.07 * v); break;
      case 'shatter': noise('highpass', 3800, 1400, 0.3, 0.26 * v, 0.7); tone('square', 3200, 800, 0.1, 0.06 * v); [2600, 3400, 4100].forEach((f, i) => tone('sine', f, f * 0.7, 0.12, 0.04 * v, null, A.ctx.currentTime + 0.03 + i * 0.045)); break;
      case 'combust': noise('lowpass', 2000, 180, 0.4, 0.3 * v); tone('sawtooth', 170, 45, 0.32, 0.12 * v); tone('sine', 80, 32, 0.3, 0.22 * v); break;
      case 'guardhit': tone('square', 1700, 1450, 0.05, 0.07 * v); tone('sine', 2650, 2550, 0.2, 0.05 * v); noise('bandpass', 2200, 1200, 0.06, 0.1 * v, 3); break;
      case 'ambush': noise('bandpass', 3200, 700, 0.1, 0.2 * v, 2); tone('sawtooth', 720, 140, 0.13, 0.1 * v); tone('sine', 90, 45, 0.12, 0.18 * v); break;
      case 'evolve': [262, 330, 392, 523, 659].forEach((f, i) => { tone('triangle', f, f * 1.005, 0.9, 0.08 * v, null, A.ctx.currentTime + i * 0.07); tone('sine', f * 2, f * 2, 0.7, 0.03 * v, null, A.ctx.currentTime + i * 0.07); }); tone('sine', 131, 131, 1.0, 0.12 * v); noise('highpass', 7000, 4000, 0.6, 0.03 * v, 1, null, A.ctx.currentTime + 0.3); break;
      case 'dread': { // low bell, deeper and more dissonant per tier
        const tier = arg | 0, f = [196, 147, 110, 73][Math.min(3, tier)];
        tone('sine', f, f, 1.8, 0.2 * v); tone('sine', f * 2.76, f * 2.76, 1.2, 0.07 * v); tone('sine', f * 5.4, f * 5.4, 0.7, 0.03 * v);
        if (tier >= 2) tone('sine', f * 0.5, f * 0.47, 1.8, 0.18 * v);
        if (tier >= 3) { tone('sine', f * 1.414, f * 1.414, 1.6, 0.08 * v); noise('lowpass', 260, 60, 1.6, 0.14 * v); }
        break;
      }
      case 'claim': [784, 1175, 1568].forEach((f, i) => tone('sine', f, f, 0.3, 0.06 * v, null, A.ctx.currentTime + i * 0.05)); noise('highpass', 6000, 4000, 0.25, 0.025 * v); break;
      case 'oil': noise('lowpass', 400, 1800, 0.3, 0.12 * v); tone('sine', 220, 440, 0.4, 0.08 * v); [660, 880].forEach((f, i) => tone('sine', f, f, 0.4, 0.05 * v, null, A.ctx.currentTime + 0.08 + i * 0.07)); break;
      case 'block': tone('sine', 150, 70, 0.14, 0.26 * v); noise('bandpass', 900, 300, 0.1, 0.16 * v, 1.5); tone('square', 1250, 900, 0.05, 0.05 * v); break;
      case 'howl': tone('sawtooth', 300, 185, 0.9, 0.09 * v); tone('sawtooth', 312, 192, 0.9, 0.07 * v); tone('sine', 150, 90, 0.9, 0.12 * v); noise('lowpass', 600, 150, 0.8, 0.08 * v); break;
      case 'rift': tone('sine', 950, 110, 0.55, 0.1 * v); tone('triangle', 60, 40, 0.6, 0.18 * v); noise('bandpass', 200, 3200, 0.45, 0.1 * v, 4); break;
      // Knight: the shield leaves the hand, rings off each foe (two semitones higher per ricochet; guarded strike: a dull clank), comes home with a leather thump (and a chime when it shields), a parry rings sharp
      case 'throw': noise('highpass', 1200, 4200, 0.18, 0.2 * v, 0.7); tone('sine', 260, 520, 0.12, 0.05 * v); break;
      case 'clang': {
        const n = arg && arg.n ? Math.min(6, arg.n) : 1;
        if (arg && arg.g) { tone('square', 210, 150, 0.1, 0.1 * v); noise('lowpass', 700, 200, 0.1, 0.14 * v, 1); break; }
        const k = Math.pow(2, 2 * (n - 1) / 12);
        tone('square', 880 * k, 800 * k, 0.12, 0.07 * v); tone('square', 1320 * k * 1.01, 1180 * k, 0.1, 0.05 * v); noise('bandpass', 2400 * k, 1500, 0.08, 0.12 * v, 3); tone('sine', 140, 70, 0.08, 0.1 * v);
        break;
      }
      case 'catch': tone('sine', 140, 70, 0.14, 0.3 * v); noise('lowpass', 500, 150, 0.1, 0.16 * v, 1); if (arg) [1318, 1760].forEach((f, i) => tone('sine', f, f, 0.22, 0.06 * v, null, A.ctx.currentTime + 0.03 + i * 0.06)); break;
      case 'parry': tone('square', 1500, 700, 0.12, 0.09 * v); tone('sine', 2400, 2200, 0.25, 0.07 * v); noise('bandpass', 3000, 1200, 0.1, 0.16 * v, 3); tone('sine', 110, 55, 0.15, 0.22 * v); break;
      default: break;
    }
  };

  // ---------- generative score ----------
  const M = { on: false, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 66, pad: 'triangle', lead: 'sine', boss: false, next: 0, step: 0, idx: 3, padNodes: [] };
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // Tracks are 'camp', 'none' or { s: stratum, boss }. Compared by value: asking for the playing track again is a no-op.
  const trackSig = (key) => (typeof key === 'string' ? key : 's' + ((key && key.s) || 1) + (key && key.boss ? 'b' : ''));
  A.music = (key) => {
    if (!A.ready) { A.track = key; return; }
    if (A.track !== null && trackSig(A.track) === trackSig(key) && M.on) return;
    A.track = key;
    let cfg;
    if (key === 'camp') cfg = { root: 50, scale: [0, 2, 4, 7, 9], bpm: 56, pad: 'sine', lead: 'triangle' };
    else if (key === 'none') cfg = null;
    else cfg = ED.biomeFor(key.s || 1).music;
    stopPad();
    if (!cfg) { M.on = false; return; }
    Object.assign(M, cfg, { on: true, boss: !!(key && key.boss), next: A.ctx.currentTime + 0.1, step: 0, idx: 2 });
    startPad();
  };

  function stopPad() {
    const t = A.ctx.currentTime;
    for (const n of M.padNodes) { try { n.g.gain.setTargetAtTime(0.0001, t, 0.6); n.o.stop(t + 2.5); } catch (e) { /* already stopped */ } }
    M.padNodes = [];
  }
  function startPad() {
    const ctx = A.ctx, t = ctx.currentTime;
    const notes = [M.root - 12, M.root - 5, M.root];
    for (const n of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = M.pad; o.frequency.value = midi(n); o.detune.value = (Math.random() - 0.5) * 12;
      f.type = 'lowpass'; f.frequency.value = M.pad === 'sawtooth' ? 420 : 900;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(M.pad === 'sawtooth' ? 0.035 : 0.06, t + 2.5);
      o.connect(f); f.connect(g); g.connect(musicFilter);
      o.start(t);
      M.padNodes.push({ o, g });
    }
  }

  function schedule() {
    if (!M.on || !A.ctx || A.ctx.state !== 'running') return;
    const ctx = A.ctx, beat = 60 / M.bpm / 2;
    while (M.next < ctx.currentTime + 0.3) {
      const t = M.next;
      M.step++;
      // melody: a wandering walk over the stratum's scale
      if (Math.random() < (M.boss ? 0.7 : 0.42)) {
        M.idx = Math.max(0, Math.min(M.scale.length * 2 - 1, M.idx + Math.floor(Math.random() * 5) - 2));
        const oct = Math.floor(M.idx / M.scale.length), deg = M.scale[M.idx % M.scale.length];
        const f = midi(M.root + 12 + oct * 12 + deg);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = M.lead; o.frequency.value = f;
        env(g, t, 0.01, M.boss ? 0.05 : 0.045, M.boss ? 0.35 : 0.9);
        o.connect(g); g.connect(musicFilter); g.connect(delay);
        o.start(t); o.stop(t + 1.2);
      }
      if (M.boss && M.step % 2 === 0) {
        // war-drum pulse for boss fights
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
        env(g, t, 0.005, M.step % 8 === 0 ? 0.32 : 0.18, 0.2);
        o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.3);
      }
      if (M.step % 16 === 0) {
        // low bell every bar
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = midi(M.root - 12 + M.scale[Math.floor(Math.random() * M.scale.length)]);
        env(g, t, 0.02, 0.07, 2.2);
        o.connect(g); g.connect(musicFilter); o.start(t); o.stop(t + 2.4);
      }
      M.next += beat;
    }
  }
})(globalThis.ED || (globalThis.ED = {}));
