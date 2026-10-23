// Synthesized sound: every effect and the adaptive score (score.js) are built from oscillators and noise, so the game ships no audio files.
// Effects pass a voice budget (priority: hero hurt > own crits > own hits and kills > others); hits, impacts and deaths of one frame are aggregated into one layered cue (A.hit, A.impact, A.kill, A.flush).
(function (ED) {
  'use strict';
  const A = ED.Audio = { ctx: null, ready: false, last: {}, vol: { master: 0.7, music: 0.55, sfx: 0.8 }, track: null, clock: null, offline: false, score: null };
  let noiseBuf, master, musicBus, sfxBus, duck;

  // Builds the bus graph on any BaseAudioContext; a bounce passes { offline: true } and drives A.clock itself.
  A.attach = (ctx, o) => {
    o = o || {};
    A.ctx = ctx; A.offline = !!o.offline;
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(2049); // soft limiter: linear below 0.5, tanh knee above, never past 0.86
    for (let i = 0; i < curve.length; i++) { const x = (i / 1024) - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a <= 0.5 ? a : 0.5 + 0.45 * Math.tanh((a - 0.5) / 0.45)); }
    shaper.curve = curve;
    master = ctx.createGain(); master.connect(shaper); shaper.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    duck = ctx.createGain(); duck.connect(musicBus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    A.score = ED.Score ? ED.Score.create(ctx, duck, { sting: musicBus, lite: () => !!(ED.Render && ED.Render.quality === 'low') }) : null;
    A.ready = true;
    A.apply();
  };
  A.init = () => {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    A.attach(new AC());
    setInterval(A.pump, 100);
  };
  A.pump = () => { if (A.score && A.ctx.state === 'running') A.score.pump(A.ctx.currentTime + 0.4, A.ctx.currentTime); };

  A.setVolumes = (s) => { A.vol.master = s.master / 100; A.vol.music = s.music / 100; A.vol.sfx = s.sfx / 100; A.apply(); };
  A.apply = () => {
    if (!A.ready) return;
    master.gain.value = A.vol.master * 0.9;
    musicBus.gain.value = A.vol.music * 0.55;
    sfxBus.gain.value = A.vol.sfx * 0.8;
  };
  const now = () => (A.clock !== null ? A.clock : A.ctx.currentTime);
  const live = () => A.ctx.state === 'running' || A.offline;
  // Ducks the music to lv for dur seconds (stingers).
  A.duck = (lv, dur) => { if (!A.ready) return; const g = duck.gain, t = now(); g.cancelScheduledValues(t); g.setTargetAtTime(lv, t, 0.08); g.setTargetAtTime(1, t + dur, 0.7); };

  // ---------- voice budget ----------
  // Every oscillator and noise source is one voice; a cue of priority p (0 others, 1 own hits and kills, 2 own crits, 3 hero hurt and alarms) may only spawn while fewer than CAP[p] voices are alive.
  const CAP = [24, 32, 40, 48], ends = [];
  let prio = 1;
  const reserve = (end) => { if (ends.length >= CAP[prio]) return false; ends.push(end); return true; };
  const prune = (t) => { let n = 0; for (let i = 0; i < ends.length; i++) if (ends[i] > t) ends[n++] = ends[i]; ends.length = n; };
  A.voices = () => ends.length;

  // ---------- primitives ----------
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  // att (optional): attack in seconds, for swells; the voice then lasts att + dur and its sweep spans both.
  const tone = (type, f0, f1, dur, vol, bus, at, att) => {
    const ctx = A.ctx, t = at || now(), d = dur + (att || 0);
    if (!reserve(t + d + 0.05)) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d);
    env(g, t, att || 0.005, vol, dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + d + 0.05);
  };
  const noise = (ftype, f0, f1, dur, vol, q, bus, at, att) => {
    const ctx = A.ctx, t = at || now(), d = dur + (att || 0);
    if (!reserve(t + d + 0.05)) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = ftype; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d);
    const g = ctx.createGain(); env(g, t, att || 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
  };
  // Brass voice: a sawtooth through a lowpass that opens on the attack (the blat) and settles; one voice.
  const brass = (f, dur, vol, at) => {
    const ctx = A.ctx, t = at || now();
    if (!reserve(t + dur + 0.05)) return;
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.97, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    lp.type = 'lowpass'; lp.Q.value = 1.5; lp.frequency.setValueAtTime(350, t); lp.frequency.exponentialRampToValueAtTime(f * 7, t + 0.05); lp.frequency.exponentialRampToValueAtTime(f * 3, t + dur);
    env(g, t, 0.03, vol, dur);
    o.connect(lp); lp.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  };
  const lite = () => !!(ED.Render && ED.Render.quality === 'low');
  const rnd = (a, b) => a + Math.random() * (b - a);

  const GAP = { hit: 0.035, ohit: 0.035, crit: 0.05, xp: 0.03, gold: 0.04, eshoot: 0.05, shoot: 0.03, die: 0.03, spark: 0.05, boom: 0.06, swing: 0.03, step: 0.1, freeze: 0.05, shatter: 0.06, combust: 0.06, guardhit: 0.06, block: 0.05, clang: 0.03, throw: 0.08, catch: 0.08, parry: 0.1, bell: 0.06, charge: 0.2, chargehit: 0.2, volley: 0.15, raincast: 0.15, smash: 0.05, dark: 0.5, fury: 1, dcharge: 0.08, blossom: 0.05, implode: 0.2, pick: 0.08 };
  const PRIO = { hurt: 3, down: 3, revive: 3, dark: 3, lock: 3, roar: 3, fury: 3, victory: 3, defeat: 3, crit: 2, level: 2, boon: 2, relic: 2, pick: 2, shop: 2, ohit: 0, spark: 0, eshoot: 0, xp: 0, gold: 0, spawn: 0 };
  // arg: cue-specific parameter (hit and crit: { w damage share, el element, n hits this frame }; clang: { n, g }; victory: 'boss' for the short one; pick: a card kind or { k kind, big, els: a duo's two elements })
  A.play = (name, vol, arg, pr) => {
    if (!A.ready || !live()) return;
    const t = now();
    if (GAP[name] && t - (A.last[name] || -9) < GAP[name]) return;
    A.last[name] = t;
    prune(t); prio = pr !== undefined ? pr : PRIO[name] !== undefined ? PRIO[name] : 1;
    cue(name, vol === undefined ? 1 : vol, arg, t);
  };

  function sting(kind, t) {
    if (!A.score) { [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.6, 0.1, null, t + i * 0.12)); return; }
    prio = 3; A.duck(kind === 'defeat' ? 0.2 : 0.3, A.score.sting(kind, t + 0.02) * 0.75);
  }

  function cue(name, v, arg, t) {
    switch (name) {
      case 'swing': noise('bandpass', 1800, 500, 0.12, 0.22 * v, 1.5); break;
      case 'heavy': noise('bandpass', 900, 200, 0.2, 0.3 * v, 1.2); tone('sine', 120, 50, 0.18, 0.2 * v); break;
      case 'shoot': tone('triangle', rnd(800, 950), 300, 0.08, 0.12 * v); noise('highpass', 3000, 1500, 0.05, 0.05 * v); break;
      case 'fire': noise('lowpass', 1200, 300, 0.2, 0.18 * v); tone('sine', 220, 80, 0.18, 0.1 * v); break;
      case 'magic': tone('sine', rnd(600, 700), rnd(1200, 1400), 0.12, 0.08 * v); tone('triangle', 300, 600, 0.12, 0.05 * v); break;
      case 'hit': case 'ohit': case 'crit': { // layers: body thump (lower and longer with damage share w), click, element tail; crits add a ringing partial; n hits of one frame grow body and loudness by log2(1 + n) and add a mass thump
        const w = arg && arg.w !== undefined ? Math.min(1.4, arg.w) : 0.5, el = arg && arg.el | 0, crit = name === 'crit' || !!(arg && arg.c), n = (arg && arg.n) || 1, lg = Math.log2(1 + n), sc = Math.min(1.9, 1 + 0.3 * (lg - 1));
        noise('bandpass', crit ? 3200 : rnd(1600, 2400), 700, 0.05 + 0.02 * w, (crit ? 0.2 : 0.14 + 0.07 * w) * v * sc, crit ? 3 : 2);
        tone('sine', (crit ? 230 : 190) - 70 * w, 52, 0.07 + 0.07 * w + 0.02 * lg, (0.12 + 0.12 * w) * v * sc);
        if (crit) { tone('square', 520, 140, 0.09, 0.07 * v); tone('sine', 1320, 1180, 0.2, 0.05 * v); }
        if (n >= 3) { tone('sine', 115, 44, 0.16 + 0.03 * lg, Math.min(0.26, 0.05 + 0.04 * lg) * v); noise('lowpass', 1100, 150, 0.1 + 0.03 * lg, Math.min(0.16, 0.03 + 0.03 * lg) * v); }
        if (el === 1) noise('lowpass', 2600, 500, 0.16, 0.1 * v, 1);
        else if (el === 2) tone('sine', rnd(2600, 3200), 3800, 0.09, 0.06 * v);
        else if (el === 3) { tone('sawtooth', 1600, 300, 0.07, 0.05 * v); noise('highpass', 4500, 2500, 0.05, 0.05 * v); }
        else if (el === 4) noise('bandpass', 420, 180, 0.1, 0.12 * v, 1.5);
        else tone('square', rnd(1700, 2100), 1200, 0.035, 0.03 * v);
        break;
      }
      case 'die': dieVoice(arg, v, t); break;
      case 'hurt': tone('sawtooth', 190, 70, 0.22, 0.26 * v); noise('lowpass', 1400, 200, 0.18, 0.3 * v); tone('sine', 110, 48, 0.16, 0.22 * v); break;
      case 'gold': tone('sine', 1320, 1320, 0.05, 0.08 * v); tone('sine', 1760, 1760, 0.07, 0.07 * v, null, t + 0.05); break;
      case 'xp': tone('sine', rnd(880, 1100), rnd(1300, 1500), 0.05, 0.04 * v); break;
      case 'heal': [523, 659, 784].forEach((f, i) => tone('sine', f, f, 0.18, 0.06 * v, null, t + i * 0.05)); break;
      case 'level': [392, 523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.22, 0.09 * v, null, t + i * 0.07)); break;
      case 'boon': [659, 988, 1318].forEach((f, i) => tone('sine', f, f * 1.01, 0.35, 0.08 * v, null, t + i * 0.06)); break;
      case 'relic': [523, 784, 1046, 1568].forEach((f, i) => tone('sine', f, f, 0.5, 0.07 * v, null, t + i * 0.08)); noise('highpass', 6000, 3000, 0.4, 0.03 * v); break;
      case 'lock': noise('lowpass', 300, 80, 0.45, 0.35 * v); tone('sine', 70, 40, 0.4, 0.25 * v); break;
      case 'unlock': noise('lowpass', 500, 150, 0.35, 0.22 * v); [392, 523].forEach((f, i) => tone('triangle', f, f, 0.2, 0.07 * v, null, t + 0.1 + i * 0.08)); break;
      case 'boom': noise('lowpass', 900, 60, 0.5, 0.38 * v); tone('sine', 90, 30, 0.45, 0.3 * v); break;
      case 'eshoot': tone('square', rnd(480, 560), 240, 0.09, 0.035 * v); break;
      case 'dash': noise('highpass', 900, 3500, 0.16, 0.14 * v, 0.7); break;
      case 'skill': tone('sawtooth', 200, 800, 0.22, 0.08 * v); noise('bandpass', 600, 2500, 0.25, 0.12 * v); break;
      case 'roar': tone('sawtooth', 110, 48, 1.3, 0.22 * v); tone('sawtooth', 116, 51, 1.3, 0.18 * v); noise('lowpass', 700, 100, 1.2, 0.25 * v); break;
      case 'fury': tone('sawtooth', 70, 150, 1, 0.2 * v); tone('sawtooth', 75, 158, 1, 0.16 * v); noise('bandpass', 300, 1800, 0.9, 0.2 * v, 2); [0.95, 1.2].forEach((d) => { tone('sine', 62, 34, 0.22, 0.32 * v, null, t + d); noise('lowpass', 500, 90, 0.18, 0.2 * v, 1, null, t + d); }); break; // boss fury: a rising detuned growl, then two heavy heartbeats
      case 'click': tone('triangle', 900, 700, 0.04, 0.06 * v); break;
      case 'hover': tone('sine', 1200, 1100, 0.03, 0.025 * v); break;
      case 'chest': noise('bandpass', 400, 900, 0.3, 0.12 * v, 4); [784, 988, 1175].forEach((f, i) => tone('sine', f, f, 0.3, 0.07 * v, null, t + 0.25 + i * 0.07)); break;
      case 'deflect': tone('square', 2400, 1800, 0.06, 0.06 * v); tone('sine', 3200, 3000, 0.1, 0.05 * v); break;
      case 'down': [440, 330, 220].forEach((f, i) => tone('triangle', f, f * 0.95, 0.25, 0.1 * v, null, t + i * 0.12)); break;
      case 'revive': [330, 440, 554, 660].forEach((f, i) => tone('triangle', f, f, 0.2, 0.09 * v, null, t + i * 0.08)); break;
      case 'portal': tone('sine', 200, 900, 1.2, 0.12 * v); tone('sine', 300, 1350, 1.2, 0.08 * v); noise('bandpass', 400, 3000, 1.2, 0.08 * v, 3); break;
      case 'shop': // in-run shop purchase (0.45 s): three coins drop and bounce on a counter, then a two-note register clink
        [0, 0.06, 0.11].forEach((d, i) => { const f = 2400 + i * 260; tone('sine', f, f * 0.98, 0.06, 0.07 * v, null, t + d); tone('square', f * 1.5, f * 1.45, 0.02, 0.025 * v, null, t + d); noise('highpass', 5200, 3000, 0.02, 0.05 * v, 1, null, t + d); });
        tone('sine', 260, 120, 0.06, 0.12 * v, null, t + 0.02);
        tone('triangle', 1568, 1568, 0.22, 0.07 * v, null, t + 0.2); tone('triangle', 2093, 2093, 0.22, 0.06 * v, null, t + 0.26); noise('bandpass', 3800, 2600, 0.03, 0.07 * v, 4, null, t + 0.2);
        break;
      case 'buy': // Hearth purchase: an anvil strike, then an ember whoosh with a few crackles
        tone('square', 880, 870, 0.1, 0.07 * v); tone('sine', 1760, 1750, 0.5, 0.07 * v); tone('sine', 2640, 2630, 0.3, 0.035 * v); noise('bandpass', 2600, 1400, 0.05, 0.2 * v, 2.5); tone('sine', 130, 60, 0.14, 0.22 * v);
        noise('bandpass', 300, 2400, 0.25, 0.14 * v, 1.2, null, t + 0.05, 0.15);
        for (let i = 0; i < 3; i++) noise('highpass', rnd(3500, 6000), 2500, 0.012, 0.06 * v, 0.8, null, t + 0.2 + Math.random() * 0.3);
        break;
      case 'pick': pickCue(arg, v, t); break;
      case 'deny': tone('square', 200, 150, 0.12, 0.05 * v); break;
      case 'thud': tone('sine', 80, 35, 0.25, 0.3 * v); noise('lowpass', 400, 80, 0.2, 0.2 * v); break;
      case 'spark': noise('highpass', 4000, 2000, 0.04, 0.04 * v); break;
      case 'bolt': noise('highpass', 2500, 600, 0.25, 0.25 * v, 0.5); tone('sawtooth', 1200, 200, 0.2, 0.06 * v); break;
      case 'victory': sting(arg === 'boss' ? 'boss' : 'victory', t); break;
      case 'defeat': sting('defeat', t); break;
      case 'spawn': noise('bandpass', 300, 1200, 0.3, 0.05 * v, 2); break;
      case 'freeze': tone('sine', 1900, 2900, 0.1, 0.08 * v); tone('triangle', 3100, 2400, 0.16, 0.05 * v, null, t + 0.04); noise('highpass', 6500, 3500, 0.12, 0.07 * v); break;
      case 'shatter': noise('highpass', 3800, 1400, 0.3, 0.26 * v, 0.7); tone('square', 3200, 800, 0.1, 0.06 * v); [2600, 3400, 4100].forEach((f, i) => tone('sine', f, f * 0.7, 0.12, 0.04 * v, null, t + 0.03 + i * 0.045)); break;
      case 'combust': noise('lowpass', 2000, 180, 0.4, 0.3 * v); tone('sawtooth', 170, 45, 0.32, 0.12 * v); tone('sine', 80, 32, 0.3, 0.22 * v); break;
      case 'guardhit': tone('square', 1700, 1450, 0.05, 0.07 * v); tone('sine', 2650, 2550, 0.2, 0.05 * v); noise('bandpass', 2200, 1200, 0.06, 0.1 * v, 3); break;
      case 'ambush': noise('bandpass', 3200, 700, 0.1, 0.2 * v, 2); tone('sawtooth', 720, 140, 0.13, 0.1 * v); tone('sine', 90, 45, 0.12, 0.18 * v); break;
      // Shade: an execution slices low and wet, a whirl sweeps up and back, a rupture pops, a refund ticks up twice, a veil swells like breath
      case 'exec': noise('bandpass', 2600, 300, 0.14, 0.24 * v, 2.5); tone('sawtooth', 190, 55, 0.16, 0.12 * v); tone('sine', 80, 38, 0.16, 0.22 * v); break;
      case 'whirl': noise('bandpass', 500, 2800, 0.16, 0.2 * v, 2); noise('bandpass', 2800, 600, 0.16, 0.16 * v, 2, null, t + 0.1); tone('triangle', 400, 900, 0.2, 0.05 * v); break;
      case 'rupt': noise('lowpass', 2000, 180, 0.18, 0.26 * v, 1); tone('sine', 150, 55, 0.14, 0.2 * v); noise('highpass', 4200, 2200, 0.08, 0.08 * v); break;
      case 'sref': tone('sine', 880, 1320, 0.07, 0.09 * v); tone('sine', 1320, 1760, 0.1, 0.09 * v, null, t + 0.07); break;
      case 'veil': noise('highpass', 3200, 1400, 0.3, 0.06 * v, 0.7); tone('triangle', 330, 520, 0.28, 0.07 * v); tone('sine', 660, 780, 0.3, 0.04 * v); break;
      // Skill forms. Pyromancer: Supernova swells and bursts, its collapse sucks in; Phoenix Form rises on a bright chord; Cataclysm rumbles; Sun Dive screams past. Shade: a blossom cut chimes higher with every blink (arg n), Eclipse is a low shadow, the clone breathes out
      case 'supernova': noise('lowpass', 2600, 110, 0.75, 0.42 * v); tone('sine', 120, 26, 0.65, 0.42 * v); tone('sawtooth', 200, 900, 0.3, 0.1 * v); noise('highpass', 3000, 7000, 0.45, 0.12 * v); [660, 990, 1320].forEach((f, i) => tone('sine', f, f, 0.5, 0.05 * v, null, t + 0.05 + i * 0.05)); break;
      case 'implode': noise('bandpass', 2400, 180, 0.24, 0.22 * v, 1.5); tone('sine', 760, 80, 0.24, 0.13 * v); break;
      case 'phoenix': tone('triangle', 520, 1040, 0.4, 0.08 * v); noise('lowpass', 1800, 300, 0.45, 0.15 * v); [880, 1175, 1568].forEach((f, i) => tone('sine', f, f * 1.01, 0.5, 0.06 * v, null, t + 0.06 + i * 0.07)); break;
      case 'sundive': noise('highpass', 800, 6000, 0.42, 0.2 * v, 0.7); tone('sawtooth', 160, 720, 0.4, 0.08 * v); tone('sine', 1320, 1760, 0.35, 0.05 * v); break;
      case 'cataclysm': tone('sawtooth', 92, 38, 1.0, 0.14 * v); noise('lowpass', 520, 70, 1.0, 0.26 * v); tone('sine', 58, 38, 0.9, 0.22 * v); break;
      case 'blossom': { const k = Math.pow(2, 2 * (Math.min(6, arg | 0) - 1) / 12); noise('bandpass', 3600 * k, 900, 0.07, 0.18 * v, 3); tone('triangle', 1175 * k, 880 * k, 0.12, 0.06 * v); tone('sine', 120, 55, 0.08, 0.14 * v); break; }
      case 'eclipse': tone('sine', 82, 52, 1.2, 0.22 * v); tone('sine', 123, 96, 1.2, 0.1 * v); noise('lowpass', 320, 110, 1.0, 0.1 * v); tone('sine', 1640, 1560, 0.5, 0.03 * v, null, t + 0.1); break;
      case 'umbral': noise('highpass', 2400, 900, 0.3, 0.07 * v, 0.7); tone('sine', 220, 330, 0.3, 0.07 * v); tone('triangle', 440, 330, 0.3, 0.05 * v); break;
      case 'evolve': [262, 330, 392, 523, 659].forEach((f, i) => { tone('triangle', f, f * 1.005, 0.9, 0.08 * v, null, t + i * 0.07); tone('sine', f * 2, f * 2, 0.7, 0.03 * v, null, t + i * 0.07); }); tone('sine', 131, 131, 1.0, 0.12 * v); noise('highpass', 7000, 4000, 0.6, 0.03 * v, 1, null, t + 0.3); break;
      case 'claim': [784, 1175, 1568].forEach((f, i) => tone('sine', f, f, 0.3, 0.06 * v, null, t + i * 0.05)); noise('highpass', 6000, 4000, 0.25, 0.025 * v); break;
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
      case 'catch': tone('sine', 140, 70, 0.14, 0.3 * v); noise('lowpass', 500, 150, 0.1, 0.16 * v, 1); if (arg) [1318, 1760].forEach((f, i) => tone('sine', f, f, 0.22, 0.06 * v, null, t + 0.03 + i * 0.06)); break;
      case 'bell': { // Cleric: a struck golden bell (arg: semitones above A5; lower for slams, higher for beams), with a bright partial and a soft fifth
        const k = Math.pow(2, ((arg | 0) || 0) / 12);
        tone('sine', 880 * k, 876 * k, 0.55, 0.09 * v); tone('sine', 880 * k * 2.76, 870 * k * 2.76, 0.3, 0.04 * v); tone('triangle', 880 * k * 1.5, 880 * k * 1.5, 0.4, 0.025 * v);
        break;
      }
      case 'parry': tone('square', 1500, 700, 0.12, 0.09 * v); tone('sine', 2400, 2200, 0.25, 0.07 * v); noise('bandpass', 3000, 1200, 0.1, 0.16 * v, 3); tone('sine', 110, 55, 0.15, 0.22 * v); break;
      // Knight Shield Charge: plate rattle and a rising whoosh with a boot stomp at the start; a slam with a metal ring where it ends
      case 'charge':
        noise('bandpass', 260, 2400, 0.36, 0.26 * v, 1.1); tone('sawtooth', 70, 190, 0.32, 0.09 * v); tone('sine', 120, 48, 0.16, 0.34 * v);
        [[1450, 0.03], [1700, 0.11], [1250, 0.19]].forEach(([f, x]) => tone('square', f, f * 0.7, 0.05, 0.045 * v, null, t + x)); noise('highpass', 3800, 2000, 0.07, 0.07 * v, 0.7, null, t + 0.02);
        break;
      case 'chargehit':
        tone('sine', 150, 32, 0.42, 0.55 * v); tone('sine', 78, 28, 0.5, 0.35 * v); noise('lowpass', 2400, 120, 0.32, 0.4 * v); noise('bandpass', 3000, 900, 0.09, 0.22 * v, 2);
        tone('square', 1180, 700, 0.12, 0.09 * v); tone('sine', 2350, 2200, 0.35, 0.06 * v); noise('highpass', 4200, 2000, 0.18, 0.1 * v, 0.8, null, t + 0.03);
        break;
      // Ranger Volley: bowstring snap, a fan of arrow whips and a rush; Rain of Arrows: a lighter release and a whistle that falls onto the first tick
      case 'volley':
        tone('triangle', 430, 190, 0.2, 0.12 * v); noise('bandpass', 700, 300, 0.07, 0.16 * v, 2); noise('highpass', 2200, 6500, 0.28, 0.2 * v, 0.6); tone('sine', 150, 70, 0.1, 0.12 * v);
        for (let i = 0; i < 5; i++) noise('bandpass', 2600 + i * 400, 1200, 0.1, 0.05 * v, 3, null, t + 0.015 * i);
        break;
      case 'raincast':
        tone('triangle', 380, 170, 0.16, 0.11 * v); noise('bandpass', 700, 300, 0.07, 0.13 * v, 2); noise('highpass', 1800, 5200, 0.2, 0.12 * v, 0.6);
        tone('sine', 2900, 780, 0.46, 0.07 * v, null, t + 0.08); tone('triangle', 1450, 420, 0.46, 0.035 * v, null, t + 0.08);
        break;
      // wired by later features: a breaking urn or crate, entering a dark door, a dash charge refilled
      case 'smash':
        noise('bandpass', 1400, 400, 0.12, 0.3 * v, 1.5); tone('sine', 150, 60, 0.12, 0.2 * v); noise('highpass', 3500, 6000, 0.1, 0.1 * v);
        [2800, 3600, 4300, 3200].forEach((f, i) => tone('triangle', f, f * 0.8, 0.08, 0.035 * v, null, t + 0.03 + i * 0.035 + Math.random() * 0.02));
        break;
      case 'dark':
        tone('sine', 55, 48, 1.6, 0.2 * v); tone('sine', 58.3, 50, 1.6, 0.15 * v); tone('sine', 233, 228, 1.4, 0.05 * v); noise('lowpass', 200, 700, 1.3, 0.12 * v); tone('sine', 311, 305, 1.5, 0.05 * v, null, t + 0.2);
        break;
      case 'dcharge': tone('sine', 1760, 1760, 0.06, 0.05 * v); tone('sine', 2637, 2637, 0.05, 0.025 * v, null, t + 0.035); break;
      default: break;
    }
  }

  // ---------- pick cues ----------
  // One cue per card kind (src/client/pickfx.js), each under 0.9 s; Low quality drops repeated layers.
  const PICK = {
    fire(v, t, lo) { // crackle over a whoomp
      noise('lowpass', 2400, 200, 0.4, 0.3 * v, 1, null, t, 0.05); tone('sine', 90, 45, 0.35, 0.28 * v, null, t, 0.03); tone('sawtooth', 160, 60, 0.25, 0.06 * v, null, t);
      for (let i = 0, n = lo ? 4 : 8; i < n; i++) noise('highpass', rnd(3000, 6000), 2500, 0.012, rnd(0.05, 0.12) * v, 0.8, null, t + 0.03 + Math.random() * 0.5);
    },
    ice(v, t, lo) { // glassy chime: three bell strikes climbing, an inharmonic partial each, a frost sparkle
      [1568, 2093, 2637].forEach((f, i) => { tone('sine', f, f * 0.998, 0.7 - i * 0.12, 0.12 * v, null, t + i * 0.07); if (!lo) tone('sine', f * 2.76, f * 2.75, 0.25, 0.04 * v, null, t + i * 0.07); });
      noise('highpass', 8000, 5000, 0.2, 0.03 * v, 1, null, t);
    },
    lightning(v, t, lo) { // zap crack, a falling sawtooth, chatter and a short rumble
      noise('highpass', 2500, 900, 0.09, 0.35 * v, 0.6, null, t); tone('sawtooth', 2200, 140, 0.16, 0.08 * v, null, t); tone('square', 1800, 1700, 0.03, 0.05 * v, null, t);
      for (let i = 0, n = lo ? 1 : 3; i < n; i++) tone('sawtooth', rnd(900, 1400), 300, 0.04, 0.05 * v, null, t + 0.05 + i * 0.04);
      noise('lowpass', 500, 70, 0.6, 0.14 * v, 1, null, t + 0.08);
    },
    poison(v, t, lo) { // bubbling gurgle: rising bloops over a resonant slosh
      for (let i = 0, n = lo ? 4 : 7; i < n; i++) { const f = rnd(180, 320); tone('sine', f, f * 2.6, 0.05, 0.11 * v, null, t + i * 0.065 + Math.random() * 0.03); }
      noise('lowpass', 500, 160, 0.55, 0.12 * v, 4, null, t); tone('sine', 70, 55, 0.4, 0.12 * v, null, t);
    },
    holy(v, t, lo) { // struck bell over a swelling choir pad
      tone('sine', 1046, 1044, 0.8, 0.14 * v, null, t); tone('sine', 2887, 2870, 0.35, 0.03 * v, null, t); tone('triangle', 1569, 1569, 0.5, 0.02 * v, null, t);
      [523, 659, 784].forEach((f) => { tone('triangle', f, f, 0.45, 0.06 * v, null, t, 0.3); if (!lo) tone('sawtooth', f * 1.003, f * 1.003, 0.45, 0.008 * v, null, t, 0.3); });
    },
    shadow(v, t) { // reverse whoosh: a swell that cuts off into a low implosion
      noise('bandpass', 300, 2600, 0.04, 0.26 * v, 1.4, null, t, 0.42); tone('sine', 110, 330, 0.04, 0.08 * v, null, t, 0.4);
      tone('sine', 140, 45, 0.2, 0.25 * v, null, t + 0.44); noise('lowpass', 800, 120, 0.15, 0.12 * v, 1, null, t + 0.44); tone('triangle', 233, 220, 0.3, 0.03 * v, null, t + 0.46);
    },
    general(v, t) { // anvil clang
      tone('square', 1250, 1230, 0.12, 0.07 * v, null, t); tone('sine', 2490, 2480, 0.55, 0.07 * v, null, t); tone('sine', 3720, 3700, 0.35, 0.04 * v, null, t); tone('triangle', 1870, 1860, 0.4, 0.04 * v, null, t);
      noise('bandpass', 3200, 1800, 0.05, 0.22 * v, 2.5, null, t); tone('sine', 160, 70, 0.12, 0.22 * v, null, t);
    },
    route(v, t) { // horn call: a fourth below, then the held fifth
      noise('bandpass', 800, 1200, 0.1, 0.04 * v, 2, null, t); brass(262, 0.16, 0.2 * v, t); brass(392, 0.42, 0.22 * v, t + 0.17); tone('sine', 196, 196, 0.5, 0.06 * v, null, t + 0.17);
    },
    asc(v, t, lo) { // rising chord, each note a detuned pair that shimmers
      [523, 659, 784, 1046, 1318].forEach((f, i) => { const at = t + i * 0.06, d = 0.55 - i * 0.04; tone('sine', f, f, d, 0.08 * v, null, at); if (!lo) tone('sine', f * 1.006, f * 1.006, d, 0.05 * v, null, at); });
      noise('highpass', 6000, 9000, 0.45, 0.035 * v, 0.7, null, t + 0.1, 0.15); tone('triangle', 262, 262, 0.7, 0.06 * v, null, t);
    },
    relic(v, t, lo) { // chain rattle, then a stone thunk
      for (let i = 0, n = lo ? 4 : 7; i < n; i++) { const at = t + i * 0.035 + Math.random() * 0.015; noise('bandpass', rnd(3000, 5000), 2000, 0.03, 0.08 * v, 4, null, at); if (!(i & 1)) tone('square', rnd(2600, 4200), rnd(1800, 2600), 0.025, 0.035 * v, null, at); }
      tone('sine', 120, 45, 0.22, 0.3 * v, null, t + 0.3); noise('lowpass', 700, 120, 0.15, 0.2 * v, 1, null, t + 0.3); tone('square', 300, 160, 0.05, 0.04 * v, null, t + 0.3);
    },
    purse(v, t, lo) { // coin jingle cascade: tings at shrinking gaps, a last chink
      const F = [2637, 2960, 3136, 3520, 3951];
      let at = t;
      for (let i = 0, n = lo ? 5 : 8; i < n; i++) { const f = F[(Math.random() * F.length) | 0]; tone('sine', f, f, 0.12, 0.1 * v, null, at); if (!lo) tone('sine', f * 1.5, f * 1.5, 0.06, 0.04 * v, null, at); at += 0.08 * Math.pow(0.82, i); }
      tone('triangle', 1760, 1700, 0.25, 0.08 * v, null, at);
    },
    duo(v, t) { tone('sine', 880, 880, 0.4, 0.1 * v, null, t); tone('sine', 1320, 1320, 0.4, 0.1 * v, null, t + 0.05); }, // no element pair given: a two-note chime
  };
  const ROOT = { fire: 110, ice: 784, lightning: 147, poison: 98, holy: 523, shadow: 82, general: 262, route: 196, asc: 262, duo: 220, relic: 131, purse: 1318 };
  // arg: kind string or { k, big, els }. duo with els: both element cues layered 50 ms apart; big: 15% louder plus a held root and fifth over a low rumble.
  function pickCue(arg, v, t) {
    const o = typeof arg === 'string' ? { k: arg } : arg || {}, k = PICK[o.k] ? o.k : 'general', lo = lite(), vv = v * (o.big ? 1.15 : 1);
    if (k === 'duo' && o.els && PICK[o.els[0]] && PICK[o.els[1]]) { PICK[o.els[0]](vv * 0.75, t, lo); PICK[o.els[1]](vv * 0.75, t + 0.05, lo); }
    else PICK[k](vv, t, lo);
    if (o.big) { const r = ROOT[k]; tone('sine', r, r, 0.75, 0.1 * v, null, t + 0.04, 0.05); tone('triangle', r * 1.5, r * 1.5, 0.7, 0.04 * v, null, t + 0.06); noise('lowpass', 400, 60, 0.7, 0.1 * v, 1, null, t); }
  }

  // ---------- aggregated hits, impacts and deaths ----------
  // A.hit / A.impact / A.kill collect the frame's events; A.flush (once per frame) turns each group into one layered cue. Reset after every flush.
  const acc = { hit: 0, hitW: 0, hitEl: 0, crit: 0, critW: 0, critEl: 0, oth: 0, othC: 0, othW: 0, die: 0, dieMine: 0, imp: {}, types: {} };
  const win = {}; // per foe type: start of the 100 ms window and voices played in it
  let streakN = 0, streakT = -9, crunchT = -9;
  A.hit = (crit, mine, w, el) => {
    if (!mine) { acc.oth++; if (crit) acc.othC++; if (w > acc.othW) acc.othW = w; return; }
    if (crit) { acc.crit++; if (w > acc.critW) acc.critW = w; acc.critEl = el; } else { acc.hit++; if (w > acc.hitW) acc.hitW = w; acc.hitEl = el; }
  };
  A.impact = (cls, mine, el) => { const k = acc.imp[cls] || (acc.imp[cls] = { n: 0, m: 0, el: 0 }); k.n++; if (mine) k.m++; k.el = el; };
  A.kill = (type, r, mine) => { acc.die++; if (mine) acc.dieMine++; const k = acc.types[type] || (acc.types[type] = { n: 0, r: 10 }); k.n++; k.r = r; };

  // One foe's death: bigger foes (radius r) fall lower and longer; pitch jitters per voice.
  function dieVoice(r, v, t) {
    const sz = Math.max(0.6, Math.min(1.7, (r || 10) / 11)), j = rnd(0.9, 1.12);
    tone('sine', rnd(280, 340) * j / sz, 50, 0.2 + 0.1 * sz, 0.16 * v, null, t); noise('lowpass', 900 / sz, 120, 0.2 * sz, 0.12 * v, 1, null, t); noise('bandpass', 1500 * j, 400, 0.08, 0.07 * v, 1.2, null, t);
  }
  // Multi-kill crunch: k scales the pitch (a streak climbs up to an octave).
  function crunch(k, v, t) {
    noise('bandpass', 1300 * k, 500 * k, 0.07, 0.13 * v, 2.5, null, t); tone('square', 300 * k, 120 * k, 0.06, 0.05 * v, null, t); tone('sine', 150 * k, 60, 0.07, 0.1 * v, null, t);
  }
  const MILESTONES = [10, 25, 50, 100];
  // Skill impact of one class, aggregated over the frame: n foes struck (m by the local hero); loudness and layers grow with log2(1 + n).
  function impact(cls, k, t) {
    const key = 'i' + cls;
    if (t - (A.last[key] || -9) < 0.06) return;
    A.last[key] = t;
    prio = k.m ? 1 : 0;
    const v = k.m ? 1 : 0.5, lg = Math.log2(1 + k.n), s = Math.min(1.6, 0.8 + 0.25 * lg), L = Math.min(4, 1 + (lg | 0));
    switch (cls) {
      case 'ranger': // arrow thunks: one per layer, a little apart, over a whip of fletching
        for (let i = 0; i < L; i++) { const at = t + i * 0.011 + Math.random() * 0.01; tone('sine', rnd(190, 250), 85, 0.07, 0.2 * v * s, null, at); noise('bandpass', rnd(1100, 1600), 500, 0.05, 0.16 * v * s, 1.5, null, at); tone('triangle', rnd(1800, 2400), 900, 0.025, 0.05 * v, null, at); }
        noise('highpass', 5000, 3000, 0.05, 0.05 * v * s, 0.8); if (lg >= 2) tone('sine', 100, 50, 0.16, 0.08 * lg * v);
        break;
      case 'knight': tone('sine', 130, 50, 0.2, 0.3 * v * s); noise('lowpass', 1500, 200, 0.14, 0.2 * v * s); tone('square', 640, 420, 0.07, 0.05 * v); if (lg >= 2) tone('sine', 70, 35, 0.3, 0.14 * lg * v); break;
      case 'pyro': noise('lowpass', 2200, 200, 0.28, 0.2 * v * s); tone('sine', 85, 40, 0.25, 0.22 * v * s); for (let i = 0; i < L; i++) noise('highpass', rnd(3500, 6000), 2500, 0.03, 0.05 * v, 0.7, null, t + Math.random() * 0.12); break;
      case 'cleric': tone('sine', [784, 988, 1175, 1568][(Math.random() * 4) | 0], 0, 0.4, 0.07 * v * s); tone('sine', 2160, 2100, 0.2, 0.025 * v); tone('sine', 100, 60, 0.12, 0.15 * v * s); if (lg >= 2) tone('sine', 1568, 0, 0.5, 0.04 * v, null, t + 0.04); break;
      case 'shade': noise('bandpass', 3400, 700, 0.07, 0.2 * v * s, 2.5); tone('sawtooth', 240, 70, 0.09, 0.08 * v); tone('sine', 90, 45, 0.1, 0.18 * v * s); break;
      case 'necro': for (let i = 0; i < L + 1; i++) tone('triangle', rnd(1400, 2600), 900, 0.03, 0.06 * v, null, t + Math.random() * 0.06); noise('lowpass', 600, 150, 0.1, 0.12 * v * s); tone('sine', 110, 60, 0.12, 0.14 * v * s); break;
      default: tone('sine', 120, 50, 0.18, 0.22 * v * s); noise('lowpass', 1400, 200, 0.12, 0.16 * v * s);
    }
  }

  A.flush = () => {
    const quiet = !A.ready || !live();
    const t = quiet ? 0 : now();
    if (!quiet) prune(t);
    if (!quiet && acc.crit) A.play('crit', 1, { w: acc.critW, el: acc.critEl, n: acc.crit }, 2);
    if (!quiet && acc.hit) A.play('hit', 1, { w: acc.hitW, el: acc.hitEl, n: acc.hit }, 1);
    if (!quiet && acc.oth) A.play('ohit', 0.5, { w: acc.othW, el: 0, n: acc.oth, c: acc.othC > 0 }, 0);
    for (const cls in acc.imp) { const k = acc.imp[cls]; if (k.n && !quiet) impact(cls, k, t); k.n = 0; k.m = 0; }
    if (acc.die && !quiet) {
      const n = acc.die, lg = Math.log2(1 + n), v = acc.dieMine ? 1 : 0.7;
      prio = acc.dieMine ? 1 : 0;
      let i = 0;
      for (const type in acc.types) { // per-type voice cap: two in any 100 ms
        const k = acc.types[type], w = win[type] || (win[type] = { t: -9, c: 0 });
        if (!k.n) continue;
        if (t - w.t > 0.1) { w.t = t; w.c = 0; }
        if (w.c < 2 && i < 3) { w.c++; i++; dieVoice(k.r, v * 0.7 / (1 + 0.4 * (i - 1)), t); }
      }
      if (n >= 2) { // body: grows with log2(1 + n)
        tone('sine', 100, 40, 0.18 + 0.04 * lg, Math.min(0.3, 0.07 + 0.05 * lg) * v, null, t); noise('lowpass', 900, 100, 0.15 + 0.05 * lg, Math.min(0.2, 0.05 + 0.04 * lg) * v, 1, null, t);
        if (n >= 6) { noise('highpass', 2800, 1200, 0.14, Math.min(0.12, 0.04 * lg) * v, 0.8, null, t); tone('sine', 55, 30, 0.35, 0.14 * v, null, t); }
      }
      if (t - streakT > 0.5) streakN = 0;
      const prev = streakN; streakN += n; streakT = t;
      if (streakN >= 4 && t - crunchT > 0.09) { crunchT = t; crunch(Math.pow(2, Math.min(12, (streakN - 3) * 0.5) / 12), v, t); }
      for (const m of MILESTONES) if (prev < m && streakN >= m) { const k = 1 + MILESTONES.indexOf(m) * 0.12; tone('sine', 784 * k, 0, 0.5, 0.08 * v, null, t); tone('sine', 1176 * k, 0, 0.45, 0.06 * v, null, t + 0.06); tone('sine', 1568 * k, 0, 0.4, 0.05 * v, null, t + 0.12); }
    }
    acc.hit = acc.crit = acc.oth = acc.othC = acc.die = acc.dieMine = 0; acc.hitW = acc.critW = acc.othW = 0;
    for (const type in acc.types) acc.types[type].n = 0;
  };

  // ---------- adaptive score ----------
  // Tracks are 'camp', 'none' or { s: stratum, boss }. Compared by value: asking for the playing track again is a no-op.
  const trackSig = (key) => (typeof key === 'string' ? key : 's' + ((key && key.s) || 1) + (key && key.boss ? 'b' : ''));
  const L = { cur: 0, low: 0 }, HOLD = [0, 2.5, 3.5]; // intensity actually played, and when the requested level first fell below it
  A.music = (key) => {
    if (!A.ready) { A.track = key; return; }
    const sig = trackSig(key);
    if (A.track !== null && trackSig(A.track) === sig && (A.score && A.score.cur || 'none') === sig) return;
    A.track = key; L.cur = 0; L.low = 0;
    if (!A.score) return;
    if (sig === 'none') A.score.stop(now()); else A.score.play(key, now(), 0);
  };
  // Requested music level 0 explore, 1 combat, 2 heavy (a boss piece: its phase): rises at once, falls one step after it has stayed lower for HOLD seconds.
  A.setIntensity = (raw) => {
    if (!A.ready || !A.score || !A.score.cur) return;
    const t = A.ctx.currentTime;
    if (raw > L.cur) { L.cur = raw; L.low = 0; A.score.level(L.cur, t); }
    else if (raw < L.cur) {
      if (!L.low) L.low = t;
      else if (t - L.low >= HOLD[L.cur]) { L.cur--; L.low = t; A.score.level(L.cur, t); }
    } else L.low = 0;
  };
})(globalThis.ED || (globalThis.ED = {}));
