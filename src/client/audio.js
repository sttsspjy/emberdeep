// Synthesized sound: every effect and the adaptive score (score.js) are built from oscillators and noise, so the game ships no audio files.
// Effects pass a voice budget (priority: hero hurt > own crits > own hits and kills > others); hits, impacts, DoT ticks (per element) and deaths of one frame are aggregated into one layered cue each (A.hit, A.impact, A.dot, A.kill, A.flush).
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
  // Struck metal: a sine carrier at f, its frequency modulated by a sine at f x ratio (index idx x f, decaying to 2% over 0.6 dur): inharmonic bell partials; two voices.
  const fmBell = (f, ratio, idx, dur, vol, at) => {
    const ctx = A.ctx, t = at || now(), end = t + dur + 0.05;
    if (ends.length + 2 > CAP[prio]) return;
    ends.push(end, end);
    const o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); m.type = 'sine'; m.frequency.setValueAtTime(f * ratio, t);
    mg.gain.setValueAtTime(idx * f, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * f * 0.02), t + dur * 0.6);
    m.connect(mg); mg.connect(o.frequency);
    env(g, t, 0.004, vol, dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); m.start(t); o.stop(end); m.stop(end);
  };
  const lite = () => !!(ED.Render && ED.Render.quality === 'low');
  const rnd = (a, b) => a + Math.random() * (b - a);

  const GAP = { hit: 0.035, ohit: 0.035, crit: 0.05, xp: 0.03, gold: 0.04, eshoot: 0.05, shoot: 0.03, die: 0.03, spark: 0.05, boom: 0.06, swing: 0.03, step: 0.1, freeze: 0.05, shatter: 0.06, combust: 0.06, guardhit: 0.06, block: 0.05, clang: 0.03, throw: 0.08, catch: 0.08, parry: 0.1, bell: 0.06, charge: 0.2, chargehit: 0.2, volley: 0.15, raincast: 0.15, smash: 0.05, dark: 0.5, fury: 1, dcharge: 0.08, blossom: 0.05, implode: 0.2, pick: 0.08, bstrike: 0.07, rattle: 0.06, peal: 0.08, heave: 0.15, reel: 0.2, bsmash: 0.08, bhurl: 0.06, bdrag: 0.15, blood: 0.15, ignite: 0.08, icecrack: 0.08, zap: 0.08 };
  const PRIO = { secret: 2, drownbell: 3, hurt: 3, down: 3, revive: 3, dark: 3, lock: 3, roar: 3, fury: 3, victory: 3, defeat: 3, crit: 2, level: 2, boon: 2, relic: 2, pick: 2, shop: 2, ohit: 0, spark: 0, eshoot: 0, xp: 0, gold: 0, spawn: 0 };
  // arg: cue-specific parameter (hit and crit: { w damage share, el element, n hits this frame }; clang: { n, g }; victory: 'boss' for the short one; pick: a card kind or { k kind, big })
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
    prio = 3; const clear = kind === 'clear', d = A.score.sting(kind, t + 0.02);
    A.duck(kind === 'defeat' ? 0.2 : clear ? 0.45 : 0.3, d * (clear ? 0.6 : 0.75));
  }

  function cue(name, v, arg, t) {
    switch (name) {
      case 'swing': noise('bandpass', 1800, 500, 0.12, 0.22 * v, 1.5); break;
      case 'heavy': noise('bandpass', 900, 200, 0.2, 0.3 * v, 1.2); tone('sine', 120, 50, 0.18, 0.2 * v); break;
      case 'shoot': tone('triangle', rnd(800, 950), 300, 0.08, 0.12 * v); noise('highpass', 3000, 1500, 0.05, 0.05 * v); break;
      case 'fire': noise('lowpass', 1200, 300, 0.2, 0.18 * v); tone('sine', 220, 80, 0.18, 0.1 * v); break;
      case 'magic': tone('sine', rnd(600, 700), rnd(1200, 1400), 0.12, 0.08 * v); tone('triangle', 300, 600, 0.12, 0.05 * v); break;
      case 'hit': case 'ohit': case 'crit': hitCue(name === 'crit' || !!(arg && arg.c), arg || {}, v, t); break;
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
      case 'clear': sting('clear', t); break; // room cleared: the short victory stinger
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
      // Knight: a blocked attack clanks off the raised shield (two semitones higher per stored block, arg n); the bash lands with a body thump and a ring (higher with the power stored, arg n); clang: a metal strike (arg { n, g: guarded, a dull clank })
      case 'bwblock': { const k = Math.pow(2, 2 * Math.min(6, (arg && arg.n) || 1) / 12); tone('square', 420 * k, 300 * k, 0.08, 0.08 * v); noise('bandpass', 1600 * k, 700, 0.07, 0.14 * v, 2); tone('sine', 110, 60, 0.12, 0.18 * v); break; }
      case 'bwbash': { const k = Math.pow(2, 2 * Math.min(6, (arg && arg.n) || 0) / 12); tone('sine', 95, 38, 0.24, 0.32 * v); noise('lowpass', 800, 120, 0.18, 0.26 * v, 1); tone('square', 660 * k, 560 * k, 0.12, 0.06 * v); tone('square', 990 * k, 880 * k, 0.1, 0.04 * v); break; }
      case 'throw': noise('highpass', 1200, 4200, 0.18, 0.2 * v, 0.7); tone('sine', 260, 520, 0.12, 0.05 * v); break;
      case 'clang': {
        const n = arg && arg.n ? Math.min(6, arg.n) : 1;
        if (arg && arg.g) { tone('square', 210, 150, 0.1, 0.1 * v); noise('lowpass', 700, 200, 0.1, 0.14 * v, 1); break; }
        const k = Math.pow(2, 2 * (n - 1) / 12);
        tone('square', 880 * k, 800 * k, 0.12, 0.07 * v); tone('square', 1320 * k * 1.01, 1180 * k, 0.1, 0.05 * v); noise('bandpass', 2400 * k, 1500, 0.08, 0.12 * v, 3); tone('sine', 140, 70, 0.08, 0.1 * v);
        break;
      }
      case 'drownbell': // the Drowned Bell: a low bronze strike with inharmonic partials, a beating pair for the crack and a long tail
        noise('bandpass', 1800, 600, 0.06, 0.25 * v, 2); tone('sine', 196, 194, 2.6, 0.2 * v); tone('sine', 199.5, 197, 2.4, 0.12 * v); tone('sine', 196 * 2.4, 196 * 2.38, 1.6, 0.08 * v);
        tone('sine', 196 * 3.01, 196 * 2.99, 1.1, 0.05 * v); tone('triangle', 196 * 4.2, 196 * 4.15, 0.7, 0.03 * v); tone('sine', 98, 96, 2.2, 0.12 * v);
        break;
      // Bellwarden (arg of bstrike { v: bell speed px/s, h: Heavy Strike, c: the chain struck }; peal { v, e: an echo }; rattle: speed share 0..1): a bronze strike higher and louder with speed (a Heavy Strike a fifth lower with a thump), the Peal a long toll in the
      // Drowned Bell's partials (hum, prime, minor-third tierce, nominal, the 2.4 partial, a beating pair) over an FM strike, the chain's rattle, the Heave's whoosh and its reel's ratchet, the Wrecker's crash
      case 'bstrike': {
        if (arg && arg.c) { noise('bandpass', rnd(3200, 4400), 2000, 0.03, 0.12 * v, 4); tone('square', rnd(1800, 2400), 1500, 0.03, 0.035 * v); break; } // the chain lashing a foe: an iron clank
        const vk = Math.min(1.8, ((arg && arg.v) || 0) / 320), h = !!(arg && arg.h), f = (h ? 262 : 392) * Math.pow(2, (vk - 1) * 2 / 12) * rnd(0.98, 1.02), g = (0.45 + 0.4 * Math.min(1, vk / 1.4)) * v;
        noise('bandpass', 2600, 900, 0.03, 0.16 * g, 2); fmBell(f, 1.41, h ? 2.2 : 1.4, h ? 0.8 : 0.32, 0.1 * g); tone('sine', f * 2.76, f * 2.7, h ? 0.35 : 0.16, 0.035 * g);
        if (h) { tone('sine', 120, 52, 0.22, 0.26 * g); noise('lowpass', 900, 120, 0.16, 0.18 * g); }
        break;
      }
      case 'peal': {
        const vk = Math.min(1, ((arg && arg.v) || 0) / 320), e = !!(arg && arg.e), f = e ? 294 : 196, g = (0.6 + 0.4 * vk) * v * (e ? 0.5 : 1), d = e ? 1.2 : 2.6;
        noise('bandpass', 1500, 500, 0.08, 0.3 * g, 2); fmBell(f, 1.4, 1.8, d * 0.7, 0.12 * g);
        tone('sine', f * 0.5, f * 0.495, d, 0.16 * g); tone('sine', f, f * 0.995, d * 0.9, 0.12 * g); tone('sine', f * 1.19, f * 1.185, d * 0.6, 0.06 * g); tone('sine', f * 2, f * 1.99, d * 0.5, 0.05 * g); tone('sine', f * 2.4, f * 2.38, d * 0.35, 0.04 * g);
        if (!e) { tone('sine', 82, 40, 0.5, 0.25 * g); noise('lowpass', 600, 90, 0.4, 0.18 * g); if (!lite()) tone('sine', f * 1.012, f * 1.005, d * 0.8, 0.06 * g); }
        break;
      }
      case 'rattle': { const k = typeof arg === 'number' ? arg : 0.5; for (let i = 0, n = lite() ? 2 : 3; i < n; i++) { const at = t + i * (0.03 - 0.012 * k) + Math.random() * 0.01; noise('bandpass', rnd(3000, 5200), 2200, 0.02, 0.06 * v, 4, null, at); if (!i) tone('square', rnd(2400, 3400), 1900, 0.015, 0.02 * v, null, at); } break; }
      case 'heave': noise('bandpass', 300, 2600, 0.28, 0.24 * v, 1.2); tone('sine', 160, 80, 0.2, 0.14 * v); [0.02, 0.07, 0.12].forEach((d) => noise('bandpass', rnd(3200, 4800), 2400, 0.02, 0.06 * v, 4, null, t + d)); break;
      case 'reel': for (let i = 0; i < 6; i++) { const at = t + i * 0.05; noise('bandpass', 2400 + i * 300, 1600, 0.02, 0.07 * v, 4, null, at); if (!(i & 1)) tone('square', 900 + i * 120, 700, 0.02, 0.025 * v, null, at); } break;
      case 'bsmash': tone('sine', 120, 35, 0.35, 0.4 * v); noise('lowpass', 1600, 100, 0.3, 0.3 * v); fmBell(150, 1.41, 1.6, 0.6, 0.08 * v); break;
      case 'bhurl': { // a hurled bell lands (arg: speed factor k 0.4-2.5): an impact thump and crash under a bronze FM clang that drops a few semitones and rings longer with k; a full-wind hurl adds a low boom and a debris rattle
        const k = Math.max(0.4, Math.min(2.5, +arg || 1)), g = (0.55 + 0.25 * k) * v, f = 196 * Math.pow(2, -(k - 1) * 3 / 12) * rnd(0.98, 1.02);
        tone('sine', 140, 38, 0.3 + 0.08 * k, 0.32 * g); noise('lowpass', 1400, 90, 0.28 + 0.05 * k, 0.26 * g); noise('bandpass', 2200, 700, 0.05, 0.18 * g, 2);
        fmBell(f, 1.41, 1.8 + 0.3 * k, 0.7 + 0.25 * k, 0.11 * g); tone('sine', f * 2.76, f * 2.7, 0.3, 0.035 * g);
        if (k >= 1.5 && !lite()) { tone('sine', 62, 34, 0.4, 0.22 * g); noise('highpass', 3000, 1200, 0.12, 0.08 * g, 0.8, null, t + 0.03); }
        break;
      }
      case 'bdrag': // a reel drags the bell home: chain links rattling over a ground scrape
        for (let i = 0, n = lite() ? 4 : 7; i < n; i++) { const at = t + i * 0.045 + Math.random() * 0.012; noise('bandpass', rnd(2800, 5000), 2000, 0.02, 0.06 * v, 4, null, at); if (!(i & 1)) tone('square', rnd(2200, 3200), 1800, 0.015, 0.02 * v, null, at); }
        noise('lowpass', 700, 220, 0.32, 0.12 * v, 1.2); tone('sine', 90, 70, 0.3, 0.06 * v);
        break;
      case 'blood': tone('sine', 70, 48, 0.14, 0.3 * v); noise('lowpass', 500, 120, 0.1, 0.16 * v, 1); tone('sine', 66, 44, 0.16, 0.24 * v, null, t + 0.17); noise('bandpass', 1200, 400, 0.08, 0.06 * v, 2, null, t + 0.02); break; // Bloodprice cast: a heartbeat (two low thumps) with a wet edge
      case 'secret': [988, 1319, 1976].forEach((f, i) => tone('sine', f, f * 1.003, 0.5 - i * 0.1, 0.07 * v, null, t + i * 0.09)); tone('triangle', 494, 492, 0.6, 0.04 * v); break; // a secret uncovered: a soft rising three-note chime over a low hum
      case 'platino': [1568, 2093, 2637, 3136].forEach((f, i) => tone('sine', f, f * 1.01, 0.18, 0.06 * v, null, t + i * 0.05)); noise('highpass', 6000, 4000, 0.25, 0.03 * v); break; // the Platino caught
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
      // status applied to a fresh foe (A.applied): Burn ignites with a whoosh and a whoomp, Frost cracks like ice with a glassy ring, Storm zaps down with a chatter
      case 'ignite': noise('bandpass', 280, 2400, 0.16, 0.22 * v, 1.1, null, t, 0.04); tone('sine', 120, 55, 0.14, 0.16 * v, null, t + 0.02); for (let i = 0; i < 2; i++) noise('highpass', rnd(3500, 6000), 2500, 0.01, 0.12 * v, 0.8, null, t + 0.05 + Math.random() * 0.12); break;
      case 'icecrack': noise('highpass', 2800, 1500, 0.03, 0.24 * v, 0.8); tone('square', 2600, 1900, 0.025, 0.04 * v); noise('bandpass', 1200, 600, 0.05, 0.1 * v, 3, null, t + 0.005); tone('sine', 3300, 2950, 0.14, 0.06 * v, null, t + 0.01); tone('sine', 4450, 4300, 0.09, 0.035 * v, null, t + 0.03); break;
      case 'zap': tone('sawtooth', 2600, 180, 0.09, 0.08 * v); noise('highpass', 3000, 1500, 0.06, 0.22 * v, 0.6); tone('square', 1700, 1650, 0.02, 0.04 * v, null, t + 0.04); tone('sawtooth', rnd(1100, 1500), 300, 0.04, 0.05 * v, null, t + 0.06); break;
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
    general(v, t) { // anvil clang
      tone('square', 1250, 1230, 0.12, 0.07 * v, null, t); tone('sine', 2490, 2480, 0.55, 0.07 * v, null, t); tone('sine', 3720, 3700, 0.35, 0.04 * v, null, t); tone('triangle', 1870, 1860, 0.4, 0.04 * v, null, t);
      noise('bandpass', 3200, 1800, 0.05, 0.22 * v, 2.5, null, t); tone('sine', 160, 70, 0.12, 0.22 * v, null, t);
    },
    route(v, t) { // horn call: a fourth below, then the held fifth
      noise('bandpass', 800, 1200, 0.1, 0.04 * v, 2, null, t); brass(262, 0.16, 0.2 * v, t); brass(392, 0.42, 0.22 * v, t + 0.17); tone('sine', 196, 196, 0.5, 0.06 * v, null, t + 0.17);
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
  };
  const ROOT = { fire: 110, ice: 784, lightning: 147, general: 262, route: 196, relic: 131, purse: 1318 };
  // arg: kind string or { k, big }. big: 15% louder plus a held root and fifth over a low rumble.
  function pickCue(arg, v, t) {
    const o = typeof arg === 'string' ? { k: arg } : arg || {}, k = PICK[o.k] ? o.k : 'general', lo = lite(), vv = v * (o.big ? 1.15 : 1);
    PICK[k](vv, t, lo);
    if (o.big) { const r = ROOT[k]; tone('sine', r, r, 0.75, 0.1 * v, null, t + 0.04, 0.05); tone('triangle', r * 1.5, r * 1.5, 0.7, 0.04 * v, null, t + 0.06); noise('lowpass', 400, 60, 0.7, 0.1 * v, 1, null, t); }
  }

  // ---------- aggregated hits, impacts and deaths ----------
  // A.hit / A.impact / A.kill collect the frame's events; A.flush (once per frame) turns each group into one layered cue. Reset after every flush.
  const acc = { hit: 0, hitW: 0, hitEl: 0, hitM: '', hitH: 0, crit: 0, critW: 0, critEl: 0, critM: '', critH: 0, oth: 0, othC: 0, othW: 0, othM: '', die: 0, dieMine: 0, imp: {}, types: {} };
  const win = {}; // per foe type: start of the 100 ms window and voices played in it
  let streakN = 0, streakT = -9, crunchT = -9;
  // m: material of the hero's weapon (fx.js matOf: blade, blunt, arrow, magic), h: a heavy weapon hit; the frame's heaviest hit (largest w) sets element and material
  A.hit = (crit, mine, w, el, m, h) => {
    if (!mine) { acc.oth++; if (crit) acc.othC++; if (w > acc.othW) { acc.othW = w; acc.othM = m; } return; }
    if (crit) { acc.crit++; if (w >= acc.critW) { acc.critW = w; acc.critEl = el; acc.critM = m; } if (h) acc.critH = 1; } else { acc.hit++; if (w >= acc.hitW) { acc.hitW = w; acc.hitEl = el; acc.hitM = m; } if (h) acc.hitH = 1; }
  };
  A.impact = (cls, mine, el) => { const k = acc.imp[cls] || (acc.imp[cls] = { n: 0, m: 0, el: 0 }); k.n++; if (mine) k.m++; k.el = el; };
  A.kill = (type, r, mine) => { acc.die++; if (mine) acc.dieMine++; const k = acc.types[type] || (acc.types[type] = { n: 0, r: 10 }); k.n++; k.r = r; };

  // ---------- weapon hits ----------
  // Material layer by weapon (g loudness, w damage share, lo Low quality: one voice): blade an FM clang and a shing, blunt a dull body and gritty grains, arrow a woody knock and the shaft's quiver, magic a hiss, sparks and a zing.
  const MAT = {
    blade(w, g, t, lo) { noise('bandpass', 5200, 2600, 0.06 + 0.03 * w, 0.1 * g, 2, null, t); if (!lo) fmBell(rnd(1250, 1550) * (1.15 - 0.2 * w), 1.47, 1.1, 0.12 + 0.08 * w, 0.06 * g, t); },
    blunt(w, g, t, lo) {
      noise('lowpass', 1500, 220, 0.08 + 0.05 * w, 0.2 * g, 0.9, null, t);
      if (!lo) { for (let i = 0; i < 3; i++) noise('bandpass', rnd(900, 1700), 600, 0.014, rnd(0.07, 0.11) * g, 2, null, t + 0.004 + i * rnd(0.008, 0.014)); tone('square', 150 - 30 * w, 80, 0.04, 0.04 * g, null, t); }
    },
    arrow(w, g, t, lo) { tone('triangle', 360 - 80 * w, 130, 0.05 + 0.02 * w, 0.16 * g, null, t); if (!lo) { noise('bandpass', 1200, 500, 0.04, 0.12 * g, 3, null, t); tone('sine', rnd(190, 230), rnd(170, 200), 0.09, 0.04 * g, null, t + 0.01); } },
    magic(w, g, t, lo) {
      noise('highpass', 3200, 6500, 0.09 + 0.04 * w, 0.08 * g, 0.7, null, t);
      if (!lo) { for (let i = 0; i < 3; i++) noise('highpass', rnd(4000, 7000), 3000, 0.008, rnd(0.06, 0.1) * g, 0.8, null, t + Math.random() * 0.07); tone('sine', rnd(650, 800), rnd(1400, 1700), 0.07, 0.05 * g, null, t); }
    },
  };
  // One aggregated hit cue (o: { w damage share, el element, n hits this frame, m material, h heavy }): a transient click, a pitched body (lower and longer with w), a sub thump, the material layer, a crit ring, an element tail;
  // a heavy or crit hit adds a boom (a low sine drop over a noise body); n hits grow the layers by log2(1 + n) and add a mass thump from 3. Low quality keeps transient, body, sub, boom and one material voice.
  function hitCue(crit, o, v, t) {
    const w = o.w !== undefined ? Math.min(1.4, o.w) : 0.5, el = o.el | 0, n = o.n || 1, lg = Math.log2(1 + n), g = v * Math.min(1.9, 1 + 0.3 * (lg - 1)), lo = lite();
    noise('bandpass', crit ? 4200 : rnd(2600, 3400), 1400, 0.02, (crit ? 0.24 : 0.14 + 0.06 * w) * g, 1.4, null, t);
    tone('triangle', (crit ? 240 : 205) - 75 * w, 58, 0.07 + 0.08 * w + 0.02 * lg, (0.15 + 0.13 * w) * g, null, t);
    tone('sine', 100 - 20 * w, 36, 0.08 + 0.07 * w, (0.12 + 0.16 * w) * g, null, t);
    (MAT[o.m] || MAT.blunt)(w, g, t, lo);
    if (crit || o.h) { const k = o.h ? 1 : 0.75; tone('sine', 150, 34, 0.22 + 0.08 * k, 0.32 * k * v, null, t); noise('lowpass', 1100, 70, 0.18 + 0.05 * k, 0.24 * k * v, 0.8, null, t); }
    if (n >= 3) { tone('sine', 115, 44, 0.16 + 0.03 * lg, Math.min(0.26, 0.05 + 0.04 * lg) * v, null, t); noise('lowpass', 1100, 150, 0.1 + 0.03 * lg, Math.min(0.16, 0.03 + 0.03 * lg) * v, 1, null, t); }
    if (lo) return;
    if (crit) tone('sine', 1320, 1180, 0.2, 0.05 * v, null, t);
    if (el === 1) noise('lowpass', 2600, 500, 0.16, 0.1 * v, 1, null, t);
    else if (el === 2) tone('sine', rnd(2600, 3200), 3800, 0.09, 0.06 * v, null, t);
    else if (el === 3) { tone('sawtooth', 1600, 300, 0.07, 0.05 * v, null, t); noise('highpass', 4500, 2500, 0.05, 0.05 * v, 1, null, t); }
    else if (el === 4) noise('bandpass', 420, 180, 0.1, 0.12 * v, 1.5, null, t);
  }

  // ---------- damage over time ----------
  // A.dot(el, v, a): a DoT tick of element el this frame (v 1 own, 0.5 an ally's; a: foes of el that ticked within the last 0.6 s, fx.js). A.bed(el, a): a foes in view carry el's status (fx.js feeds Burn, fodder included, which sends no ticks).
  // A.flush plays one cue per element, at most one per 0.12 s: loudness 1 + 0.45 log2(a) up to 2.6, grains 1 + 1.6 log2(1 + a) up to 7 (Low quality 2) spread over 0.14 s; no tick for 0.3 s while foes still carry it: its bed at v 0.6.
  const dacc = {}, bedN = {}, dotT = {};
  A.dot = (el, v, a) => { const k = dacc[el] || (dacc[el] = { n: 0, v: 0, a: 0 }); k.n++; if (v > k.v) k.v = v; if (a > k.a) k.a = a; };
  A.bed = (el, a) => { bedN[el] = a; };
  // Status application on a foe without that status for 1.5 s (fx.js): Burn ignite, Frost ice crack, Storm zap; one per element per 80 ms (GAP).
  const APPLY = { 1: 'ignite', 2: 'icecrack', 3: 'zap' };
  A.applied = (el, mine) => { const c = APPLY[el]; if (c) A.play(c, mine ? 1 : 0.5, null, mine ? 1 : 0); };
  // Tick timbre by element (L loudness, G grains): Burn a breathy roar (a low rumble once loud), crackle pops and a sizzle; Frost a crack and glassy tinks; Storm zaps over a mains buzz; Bleed wet squelches;
  // the class flavours soft: a holy chime, a shadow hiss; physical a tap (index = hit-event el, combat.js EL_IDX; 5 unused).
  const at = (t) => t + Math.random() * 0.14;
  const DOT = [
    (L, G, t) => tone('triangle', rnd(900, 1100), 700, 0.03, 0.05 * L, null, t),
    (L, G, t, lo) => {
      noise('bandpass', rnd(500, 700), 320, 0.2, 0.06 * L, 0.8, null, t, 0.04);
      if (L >= 1.3) noise('lowpass', 260, 120, 0.24, 0.08 * L, 1, null, t, 0.05);
      for (let i = 0; i < G; i++) noise('highpass', rnd(2500, 6000), 2000, rnd(0.005, 0.012), rnd(0.08, 0.16) * L, 0.8, null, at(t));
      if (!lo) noise('highpass', 6500, 5000, 0.12, 0.03 * L, 0.7, null, t);
    },
    (L, G, t, lo) => {
      noise('bandpass', 3400, 2200, 0.02, 0.12 * L, 4, null, t);
      for (let i = 0; i < Math.ceil(G / 2); i++) { const f = rnd(2600, 4400); tone('sine', f, f * 0.97, 0.05, 0.06 * L, null, at(t)); }
      if (!lo) tone('triangle', rnd(5200, 6000), 4800, 0.03, 0.025 * L, null, t + 0.02);
    },
    (L, G, t, lo) => {
      for (let i = 0; i < Math.ceil(G / 2); i++) { const a = at(t); tone('sawtooth', rnd(1800, 2600), 260, 0.03, 0.05 * L, null, a); noise('highpass', 3500, 2000, 0.02, 0.08 * L, 0.7, null, a); }
      if (!lo) tone('square', 110, 100, 0.09, 0.025 * L, null, t);
    },
    (L, G, t) => {
      noise('bandpass', 1300, 280, 0.07, 0.2 * L, 6, null, t); tone('sine', rnd(200, 240), 100, 0.06, 0.08 * L, null, t);
      for (let i = 1; i < Math.ceil(G / 2); i++) noise('bandpass', rnd(900, 1400), 260, 0.05, 0.12 * L, 6, null, at(t));
    },
    null,
    (L, G, t) => tone('sine', [1568, 1760, 2093][(Math.random() * 3) | 0], 0, 0.14, 0.035 * L, null, t),
    (L, G, t) => { noise('bandpass', 500, 200, 0.12, 0.08 * L, 1.5, null, t); tone('sine', 120, 80, 0.1, 0.05 * L, null, t); },
  ];
  function dotCue(el, a, v, t) {
    if (t - (dotT[el] || -9) < 0.12) return;
    dotT[el] = t; prio = v >= 1 ? 1 : 0;
    const lo = lite(), L = Math.min(2.6, 1 + 0.45 * Math.log2(Math.max(1, a))) * v, G = Math.min(lo ? 2 : 7, 1 + Math.round(1.6 * Math.log2(1 + a)));
    (DOT[el] || DOT[0])(L, G, t, lo);
  }

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
  // Skill impact of one class (or of an element, key e1-e4: a Flame burst, a Frost shatter, a Storm chain, a Bleed burst), aggregated over the frame: n foes struck (m by the local hero); loudness and layers grow with log2(1 + n).
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
      case 'e1': // Flame burst: a whoomp, a rising whoosh, crackles
        noise('lowpass', 2400, 160, 0.3, 0.24 * v * s); tone('sine', 95, 38, 0.26, 0.26 * v * s); noise('bandpass', 300, 2000, 0.18, 0.1 * v * s, 1.1, null, t, 0.03);
        for (let i = 0; i < L + 1; i++) noise('highpass', rnd(3000, 6000), 2500, 0.01, 0.1 * v, 0.8, null, t + 0.03 + Math.random() * 0.15);
        break;
      case 'e2': // Frost shatter: a glass burst, falling glassy partials, a thump
        noise('highpass', 3600, 1400, 0.22, 0.2 * v * s, 0.7); tone('sine', 140, 60, 0.1, 0.16 * v * s);
        for (let i = 0; i < L + 1; i++) { const f = rnd(2400, 4200); tone('sine', f, f * 0.7, 0.12, 0.05 * v, null, t + 0.02 + i * 0.035); }
        break;
      case 'e3': // Storm chain: a crack and a falling zap per arm, a rumble from 3 foes
        for (let i = 0; i < L; i++) { const at = t + i * 0.018; noise('highpass', 2600, 900, 0.05, 0.16 * v * s, 0.6, null, at); tone('sawtooth', rnd(1800, 2600), 200, 0.07, 0.06 * v, null, at); }
        if (lg >= 2) noise('lowpass', 500, 70, 0.4, Math.min(0.2, 0.06 * lg) * v, 1, null, t + 0.02);
        break;
      case 'e4': noise('bandpass', 1400, 260, 0.1, 0.26 * v * s, 5); tone('sine', 150, 55, 0.14, 0.24 * v * s); noise('lowpass', 800, 150, 0.12, 0.12 * v * s, 4, null, t + 0.02); break; // Bleed burst: a wet slap and a thump
      default: tone('sine', 120, 50, 0.18, 0.22 * v * s); noise('lowpass', 1400, 200, 0.12, 0.16 * v * s);
    }
  }

  A.flush = () => {
    const quiet = !A.ready || !live();
    const t = quiet ? 0 : now();
    if (!quiet) prune(t);
    if (!quiet && acc.crit) A.play('crit', 1, { w: acc.critW, el: acc.critEl, n: acc.crit, m: acc.critM, h: acc.critH }, 2);
    if (!quiet && acc.hit) A.play('hit', 1, { w: acc.hitW, el: acc.hitEl, n: acc.hit, m: acc.hitM, h: acc.hitH }, 1);
    if (!quiet && acc.oth) A.play('ohit', 0.5, { w: acc.othW, el: 0, n: acc.oth, c: acc.othC > 0, m: acc.othM }, 0);
    for (const cls in acc.imp) { const k = acc.imp[cls]; if (k.n && !quiet) impact(cls, k, t); k.n = 0; k.m = 0; }
    for (const el in dacc) { const k = dacc[el]; if (k.n && !quiet) dotCue(+el, Math.max(k.a, bedN[el] || 0), k.v, t); k.n = k.v = k.a = 0; }
    if (!quiet) for (const el in bedN) if (bedN[el] > 0 && t - (dotT[el] || -9) > 0.3) dotCue(+el, bedN[el], 0.6, t);
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
    acc.hit = acc.crit = acc.oth = acc.othC = acc.die = acc.dieMine = acc.hitH = acc.critH = 0; acc.hitW = acc.critW = acc.othW = 0;
    for (const type in acc.types) acc.types[type].n = 0;
  };

  // ---------- adaptive score ----------
  // Tracks are 'camp', 'none' or { s: stratum, c: context } (ED.Score.sig). Compared by value: asking for the playing track again is a no-op; lv: the new track's starting level.
  const trackSig = (key) => (ED.Score ? ED.Score.sig(key) : typeof key === 'string' ? key : 's' + ((key && key.s) || 1) + ((key && key.c) || ''));
  const L = { cur: 0, low: 0 }, HOLD = [0, 2.5, 3.5]; // intensity actually played, and when the requested level first fell below it
  A.music = (key, lv) => {
    if (!A.ready) { A.track = key; return; }
    const sig = trackSig(key);
    if (A.track !== null && trackSig(A.track) === sig && (A.score && A.score.cur || 'none') === sig) return;
    A.track = key; L.cur = Math.max(0, Math.min(2, lv | 0)); L.low = 0;
    if (!A.score) return;
    if (sig === 'none') A.score.stop(now()); else A.score.play(key, now(), L.cur);
  };
  // Requested level of the playing track: 0 calm, 1 fight, 2 heavy (a boss track: its phase): rises at once, falls one step after it has stayed lower for HOLD seconds.
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
