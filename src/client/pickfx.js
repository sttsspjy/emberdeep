// Pick feedback (client only): the card kind of a boon or relic, its synthesized pick cue (audio.js 'pick') and its themed burst on the picking hero in the world (fx.js 'boon' and 'relic' events).
// Kinds: the four paths (fire, ice, lightning, general), route, relic, purse. Bursts last at most 1.2 s, never flash the screen, run lighter on Low quality and dimmer for an ally's pick.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const P = ED.PickFx = {};
  P.KINDS = ['fire', 'ice', 'lightning', 'general', 'route', 'relic', 'purse'];
  const ELEM = { fire: 1, ice: 1, lightning: 1, general: 1 };
  // Kind of boon id (total): purse > route (any cls card) > its path (a cross-path card: its second path) > 'general' (open boons, unknown ids).
  P.kind = (id) => { const b = ED.BOONS[id], pk = b && (b.path || (b.cross && b.cross[1])); return !b ? 'general' : b.purse ? 'purse' : b.cls ? 'route' : ELEM[pk] ? pk : 'general'; };
  P.kindRelic = () => 'relic';
  // Keystones, evolutions and path gates take the bigger, longer version of their path's feedback.
  P.big = (id) => { const b = ED.BOONS[id]; return !!(b && (b.key || b.evo || b.gate)); };

  // ---------- cue ----------
  // play: the card UI's click (sound now, time marked); heard: the pick event of the local hero, silent when a play marked it within 1.5 s (the mark is consumed), so host-side and bot picks still sound.
  let markT = -1e9;
  const arg = (kind, big) => ({ k: kind, big: !!big });
  P.play = (kind, big, id) => { markT = performance.now(); if (ED.Audio) ED.Audio.play('pick', 1, arg(kind, big, id)); };
  P.heard = (kind, big, id) => { if (performance.now() - markT < 1500) { markT = -1e9; return; } if (ED.Audio) ED.Audio.play('pick', 1, arg(kind, big, id)); };

  // ---------- bursts ----------
  // o: F, x, y (hero feet), n (count factor: ally 0.6, big 1.6), al (pop, beam and sprite alpha: ally 0.45), L (life factor), big, low, dim; rc dims a ring colour for an ally.
  const rc = (o, c) => (o.dim ? U.shade(c, -0.35) : c);
  const nn = (o, k) => Math.max(1, Math.round(k * o.n));
  const SP = (o, id, x, y, opt) => { if (!o.low || opt.keep) o.F.sheet(id, x, y, opt); };
  const PRISM = ['#ff7a2a', '#7fe3ff', '#ffe66b', '#9be33c', '#fff0c2', '#a070ff'];
  const B = {
    fire(o) { // flame column and an ember spray rising
      const F = o.F, x = o.x, y = o.y, c = '#ff7a2a';
      F.burst(x, y - 6, nn(o, 16), { kind: 'ember', color: '#ffb347', a: -1.57, spread: 1.1, sp: 110, vy: -30, life: 0.8 * o.L, size: 2, drag: 1.6, lt: c, ltr: 26 });
      F.burst(x, y - 4, nn(o, 10), { kind: 'streak', color: c, a: -1.57, spread: 0.5, sp: 170, life: 0.35 * o.L, size: 2 });
      for (let i = 0; i < 3; i++) SP(o, 'fx.flame', x + (i - 1) * 9, y + 2, { delay: i * 0.05, lt: c, ltr: 40, keep: i === 1 });
      for (let i = 0; i < 3; i++) SP(o, 'fx.flame', x + (i & 1 ? 3 : -3), y - 10 - i * 10, { delay: 0.04 + i * 0.06, vy: -50, keep: i === 0 }); // the column: flames stacked and rising
      F.beam(x, y, o.big ? 80 : 48, o.big ? 16 : 8, c, o.big ? 0.5 : 0.35, o.al * (o.big ? 1 : 0.7), '#fff4c0');
      F.ring(x, y, 28, rc(o, c), 0.4 * o.L, 3); F.pop(x, y - 14, 22, c, 0.25, false, o.al);
    },
    ice(o) { // shards burst outward and land, a frost ring
      const F = o.F, x = o.x, y = o.y;
      F.burst(x, y - 10, nn(o, 14), { kind: 'shard', color: '#c8f6ff', sp: 150, life: 0.7 * o.L, size: 3, vz: 90, z: 10, drag: 2 });
      F.burst(x, y - 10, nn(o, 8), { kind: 'spark', color: '#7fe3ff', sp: 200, life: 0.3, size: 1.4, drag: 4 });
      SP(o, 'fx.ice.burst', x, y - 10, { add: true, a: o.al, keep: true });
      for (let i = 0; i < 5; i++) { const q = i * TAU / 5 + 0.3; SP(o, 'fx.glint', x + Math.cos(q) * 22, y - 8 + Math.sin(q) * 14, { ramp: 'ice', add: true, delay: i * 0.04 }); }
      F.ring(x, y, 34, rc(o, '#7fe3ff'), 0.5 * o.L, 3); F.ring(x, y, 20, rc(o, '#ffffff'), 0.3, 2); F.pop(x, y - 12, 18, '#bfefff', 0.2, true, o.al);
      if (o.big) F.ring(x, y, 62, rc(o, '#c8f6ff'), 0.6, 4, false, 10);
    },
    lightning(o) { // a short bolt strikes the hero from above, a white flash at the hero only
      const F = o.F, x = o.x, y = o.y, c = '#ffe66b';
      F.zap(x + 12, y - 190, x, y, '#fff6b0', 0.4 * o.L);
      F.pop(x, y - 14, 34, '#fff6b0', 0.22, true, o.al);
      F.burst(x, y - 4, nn(o, 14), { kind: 'spark', color: c, sp: 220, life: 0.35, size: 1.4, drag: 3.5 });
      SP(o, 'fx.blast.blue', x, y - 8, { add: true, ramp: 'lightning', a: o.al, keep: true });
      F.ring(x, y, 36, rc(o, c), 0.3, 3);
      if (o.big) { F.zap(x - 4, y - 120, x - 34, y + 4, c, 0.3); F.zap(x + 4, y - 110, x + 32, y + 2, c, 0.3); SP(o, 'fx.thunder', x, y - 30, { add: true, ramp: 'lightning', keep: true }); }
    },
    general(o) { // anvil stamp: a short impact square at the feet, a bright steel shock ring with a second ring behind it, sparks thrown low and bouncing
      const F = o.F, x = o.x, y = o.y, R = o.big ? 52 : 40;
      SP(o, 'fx.circle.spark', x, y - 2, { ramp: 'general', a: o.al, speed: 1.8, keep: true }); // impact square opening into a star (unlit: stays steel, not a white blob)
      F.ring(x, y, R, rc(o, '#f2f5f9'), 0.4 * o.L, 4, false, 10); F.ring(x, y, R * 0.6, rc(o, '#d9dfe8'), 0.3, 3, false, 6); F.ring(x, y, R + 14, rc(o, '#8f9aa8'), 0.55 * o.L, 2, false, R * 0.5);
      SP(o, 'fx.smoke.ring', x, y + 2, { ramp: 'dust', keep: true });
      F.burst(x, y - 4, nn(o, 16), { kind: 'spark', color: '#ffffff', sp: 210, life: 0.55 * o.L, size: 1.6, vz: 120, z: 4, drag: 1.6 }); // sparks fly low and bounce off the floor
      F.burst(x, y - 6, nn(o, 10), { kind: 'streak', color: '#e8eef6', a: -1.57, spread: 2.4, sp: 260, life: 0.3, size: 2.4 });
      for (let i = 0; i < 4; i++) { const q = i * TAU / 4 + 0.785; SP(o, 'fx.hit.spark', x + Math.cos(q) * R * 0.7, y + Math.sin(q) * R * 0.45, { ramp: 'general', add: true, delay: 0.06 + i * 0.04 }); } // sparks where the ring passes
      F.pop(x, y - 6, 16, '#f2f5f9', 0.14, true, o.al * 0.8);
      if (o.big) F.burst(x, y - 10, nn(o, 6), { kind: 'shard', color: '#d9dfe8', sp: 140, life: 0.6, size: 2.6, vz: 90, z: 8 });
    },
    route(o, b) { // banner streaks rise in the class colour (five ribbons of stepped squares), then the crest flashes over the head
      const F = o.F, x = o.x, y = o.y, cl = b && ED.CLASSES[b.cls], c = cl ? cl.col.c : '#ffd36b', hi = U.mix(c, '#ffffff', 0.35), lo = U.shade(c, -0.3);
      for (const dx of [-16, -8, 0, 8, 16]) {
        const mid = !dx, side = Math.abs(dx) > 8;
        F.burst(x + dx, y - 2, nn(o, mid ? 8 : 6), { kind: 'dot', color: side ? lo : c, a: -1.57, spread: 0.05, sp: mid ? 170 : 130, life: 0.75 * o.L, size: 4, add: false, drag: 1.2 }); // ribbon body (unlit: keeps the class colour)
        F.burst(x + dx, y - 2, nn(o, 3), { kind: 'streak', color: hi, a: -1.57, spread: 0.08, sp: 240, life: 0.4, size: 2, drag: 1 });
        if (!side) F.beam(x + dx, y - 2, mid ? 60 : 42, 6, c, 0.45 * o.L, 0.55 * o.al, c);
      }
      F.ring(x, y, 34, rc(o, c), 0.45, 3);
      SP(o, 'fx.circle.spark', x, y - 40, { ramp: c, add: true, a: o.al, delay: 0.12, keep: true }); // crest flash: a square badge opening into a star
      SP(o, 'fx.spark.magic', x, y - 40, { ramp: c, add: true, a: o.al, delay: 0.2 });
      F.pop(x, y - 40, 12, c, 0.3, true, o.al * 0.8, hi);
    },
    relic(o, b, ev) { // stone-grey dust ring and a glint in the relic's rarity colour over the head
      const F = o.F, x = o.x, y = o.y, r = ED.RELICS[ev.id], c = r ? ED.RARITY[r.rar].color : '#ffb02e';
      SP(o, 'fx.smoke.ring', x, y + 2, { ramp: 'dust', keep: true });
      F.burst(x, y - 2, nn(o, 8), { kind: 'smoke', color: '#8a8478', sp: 60, life: 0.7, size: 5, drag: 3 });
      F.burst(x, y - 4, nn(o, 6), { kind: 'shard', color: '#9a958a', sp: 90, life: 0.6, size: 2.2, vz: 70, z: 4 });
      F.ring(x, y, 30, rc(o, '#a8a49a'), 0.45, 3);
      SP(o, 'fx.glint', x, y - 34, { ramp: c, add: true, a: o.al, speed: 0.8, keep: true }); F.pop(x, y - 34, 22, c, 0.4, true, o.al);
      F.burst(x, y - 30, nn(o, 6), { kind: 'spark', color: c, sp: 90, life: 0.4, size: 1.4, drag: 3 });
    },
    purse(o) { // coins spray up and fall
      const F = o.F, x = o.x, y = o.y;
      F.burst(x, y - 12, nn(o, 18), { kind: 'shard', color: '#ffd36b', a: -1.57, spread: 2.2, sp: 70, life: 0.8, size: 3.4, vz: 170, z: 12, drag: 1 });
      F.burst(x, y - 12, nn(o, 8), { kind: 'shard', color: '#fff0a0', a: -1.57, spread: 2, sp: 60, life: 0.8, size: 2, vz: 150, z: 12, drag: 1, add: true });
      F.burst(x, y - 14, nn(o, 8), { kind: 'spark', color: '#ffe9a0', sp: 120, life: 0.3, size: 1.4 });
      for (let i = 0, m = o.low ? 2 : 5; i < m; i++) { const q = -1.57 + (i - (m - 1) / 2) * 0.45; SP(o, 'pickup.coin', x, y - 20, { loop: true, life: 0.7, vx: Math.cos(q) * 70, vy: Math.sin(q) * 70, fade: true, a: o.al, delay: i * 0.03, keep: true }); } // coins thrown up in a fan
      F.pop(x, y - 14, 18, '#ffd36b', 0.2, true, o.al);
    },
  };
  const BIG_COL = { fire: '#ff7a2a', ice: '#7fe3ff', lightning: '#ffe66b', poison: '#9be33c', holy: '#ffcf5a', shadow: '#a070ff', general: '#d9dfe8' };

  // Themed burst of a 'boon' or 'relic' event at the picking hero (ev.x, ev.y when the hero is not in view); kind defaults to the event's.
  P.burst = (F, ctx, ev, kind) => {
    const p = ctx.player(ev.pid), x = p ? p.x : ev.x, y = p ? p.y : ev.y;
    if (x === undefined || y === undefined) return;
    const relic = ev.t === 'relic', b = relic ? null : ED.BOONS[ev.id], big = !relic && P.big(ev.id), dim = ev.pid !== ctx.localPid;
    kind = kind || (relic ? 'relic' : P.kind(ev.id));
    const o = { F, x, y, big, dim, low: !!(ED.Render && ED.Render.quality === 'low'), n: (dim ? 0.6 : 1) * (big ? 1.6 : 1), al: dim ? 0.45 : 1, L: big ? 1.25 : 1 };
    (B[kind] || B.general)(o, b, ev);
    if (big && BIG_COL[kind]) F.ring(x, y, 64, rc(o, BIG_COL[kind]), 0.7, 4, false, 16);
  };
})(globalThis.ED || (globalThis.ED = {}));
