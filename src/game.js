// Run session (client side): owns the World on solo / host, reads local input into w.input, steps the fixed 60 Hz sim, drains events into FX / audio / HUD / UI,
// and keeps the view model ED.Game.view (ARCHITECTURE §10) that render.js and hud.js read. On solo / host the view arrays alias the World arrays;
// a co-op client fills them from snapshots (net lane: ED.Net.decodeSnap), with the same render-visible field names.
(function (ED) {
  'use strict';
  const C = ED.CONST, STEP = C.TICK, MAX_STEPS = 8;
  const G = ED.Game = { w: null, mode: 'off', myPid: 'p1', view: null, paused: false, acc: 0, onEnd: null, onEvent: null };

  const blankView = () => ({ me: null, heroes: [], foes: [], projs: [], zones: [], pickups: [], props: null, stage: 0, seed: 0, time: 0, xp: 0, xpNext: 1, level: 1, kills: 0, gold: 0, boss: null, events: [] });

  // cfg: { mode: 'solo' | 'host', seed, stage, players: [{ pid, name, slot, cls, meta }], myPid, cheats }
  G.start = (cfg) => {
    G.mode = cfg.mode || 'solo'; G.myPid = cfg.myPid || cfg.players[0].pid; G.paused = false; G.acc = 0; G.ended = false;
    const w = G.w = new ED.World({ seed: cfg.seed, stage: cfg.stage, players: cfg.players, cheats: cfg.cheats });
    const v = G.view = blankView();
    v.heroes = w.heroes; v.foes = w.foes; v.projs = w.projs; v.zones = w.zones; v.pickups = w.pickups; v.props = w.arena;
    v.stage = w.stage; v.seed = w.seed; v.me = w.hero(G.myPid);
    ED.FX.clear();
    G.syncView();
    return w;
  };
  G.stop = () => { G.w = null; G.mode = 'off'; G.view = null; };
  G.syncView = () => {
    const w = G.w, v = G.view; if (!w || !v) return;
    v.time = w.time; v.xp = w.xp; v.xpNext = w.xpNext; v.level = w.level; v.kills = w.kills; v.gold = w.gold; v.boss = w.boss; v.me = w.hero(G.myPid);
  };

  // Local input -> World (once per frame; edge flags latch until the next tick consumes them).
  const IN = { mx: 0, my: 0, ax: 0, ay: 0, dash: false, q: false, e: false, pick: 0, reroll: false, skip: false };
  G.control = (inp) => {
    const w = G.w, me = w && w.hero(G.myPid);
    if (!me) return;
    const aim = ED.AimFx.point(me, inp);
    IN.mx = inp.mx; IN.my = inp.my; IN.ax = aim.wx; IN.ay = aim.wy;
    IN.dash = inp.dash; IN.q = inp.q; IN.e = inp.e; IN.pick = inp.pick; IN.reroll = inp.reroll; IN.skip = inp.skip;
    w.input(G.myPid, IN);
  };
  // Card pick from the UI (click): 0-based index.
  G.pick = (i) => { if (G.w) G.w.input(G.myPid, { pick: i + 1 }); };
  G.reroll = () => { if (G.w) G.w.input(G.myPid, { reroll: true }); };
  G.skip = () => { if (G.w) G.w.input(G.myPid, { skip: true }); };
  G.banish = (i) => { if (G.w) G.w.input(G.myPid, { banish: i + 1 }); };

  // Advances the sim by real time dt (fixed steps) and routes its events. Returns the number of steps run.
  G.update = (dt) => {
    const w = G.w; if (!w || G.paused) return 0;
    G.acc = Math.min(G.acc + dt, STEP * MAX_STEPS);
    let n = 0;
    while (G.acc >= STEP) { G.acc -= STEP; w.update(STEP); n++; G.drain(); }
    G.syncView();
    return n;
  };
  G.drain = () => {
    const w = G.w, evs = w.events, ctx = { me: G.myPid, crowd: ED.Render.crowd || 0 };
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      ED.FX.handle(ev, ctx);
      sound(ev);
      if (G.onEvent) G.onEvent(ev);
      if (ev.t === 'end' && !G.ended) { G.ended = true; if (G.onEnd) G.onEnd(ev.summary); }
    }
    evs.length = 0;
  };

  // Event -> audio cue (the audio lane maps these properly; hits and deaths go through the per-frame aggregation).
  const A = () => ED.Audio;
  function sound(ev) {
    const a = A(); if (!a || !a.ready) return;
    const mine = ev.pid === G.myPid;
    switch (ev.t) {
      case 'hit': a.hit(ev.crit, true, Math.min(1, ev.dmg / 60), 0, 'blade', false); break;
      case 'die': a.kill(ED.FOE_IDS[ev.k] || 'x', 8, true); break;
      case 'hurt': if (mine) a.play('hurt'); break;
      case 'pickup': if (ev.k === 'gold') a.play('gold'); else if (ev.k === 'chest') a.play('chest'); else if (ev.k === 'food') a.play('heal'); else a.play('xp'); break;
      case 'level': a.play('level'); break;
      case 'skill': a.play('skill', mine ? 1 : 0.5); break;
      case 'dash': if (mine) a.play('dash'); break;
      case 'boom': a.play('boom', ev.r > 150 ? 1 : 0.4); break;
      case 'swing': a.play('swing', 0.5); break;
      case 'evolve': a.play('evolve'); break;
      case 'boss': if (ev.phase === 0) a.play('roar'); break;
      case 'down': a.play('down'); break;
      case 'revive': a.play('revive'); break;
      default: break;
    }
  }
})(globalThis.ED || (globalThis.ED = {}));
