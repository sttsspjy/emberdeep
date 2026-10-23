// Pick feedback (client only): the card kind of a boon or relic, its synthesized pick cue (audio.js 'pick') and its themed burst on the picking hero in the world (fx.js 'boon' and 'relic' events).
// Kinds: the six elements, general, route, duo, asc, relic, purse. Bursts last at most 1.2 s, never flash the screen, run lighter on Low quality and dimmer for an ally's pick.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const P = ED.PickFx = {};
  P.KINDS = ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow', 'general', 'route', 'duo', 'asc', 'relic', 'purse'];
  const ELEM = { fire: 1, ice: 1, lightning: 1, poison: 1, holy: 1, shadow: 1, general: 1 };
  // Kind of boon id (total): purse > asc > duo > route (any cls card) > its path > 'general' (open boons, unknown ids).
  P.kind = (id) => { const b = ED.BOONS[id]; return !b ? 'general' : b.purse ? 'purse' : b.asc ? 'asc' : b.duo ? 'duo' : b.cls ? 'route' : ELEM[b.path] ? b.path : 'general'; };
  P.kindRelic = () => 'relic';
  // Keystones, evolutions and path gates take the bigger, longer version of their path's feedback.
  P.big = (id) => { const b = ED.BOONS[id]; return !!(b && (b.key || b.evo || b.gate)); };

  // ---------- cue ----------
  // play: the card UI's click (sound now, time marked); heard: the pick event of the local hero, silent when a play marked it within 1.5 s (the mark is consumed), so host-side and bot picks still sound.
  let markT = -1e9;
  const arg = (kind, big, id) => { const b = id ? ED.BOONS[id] : null; return { k: kind, big: !!big, els: kind === 'duo' && b && b.duo ? b.duo : null }; };
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
    poison(o) { // green bubbles rise, drips fall and the ring sinks inward
      const F = o.F, x = o.x, y = o.y, c = '#9be33c';
      F.burst(x, y - 8, nn(o, 24), { color: c, a: -1.57, spread: 1.8, sp: 50, vy: -28, life: 0.8 * o.L, size: 5, add: true, drag: 1.5 });
      F.burst(x, y - 6, nn(o, 10), { color: '#d2ff82', a: -1.57, spread: 2, sp: 30, vy: -18, life: 0.7, size: 2, add: true, drag: 1 });
      F.burst(x, y - 20, nn(o, 12), { kind: 'drop', color: '#3f7a18', sp: 35, life: 0.8 * o.L, size: 3, z: 18, vz: 30, drag: 1 });
      for (let i = 0; i < 4; i++) SP(o, 'fx.puff', x + (i - 1.5) * 9, y - 6 - (i & 1) * 8, { ramp: 'poison', vy: -22, delay: i * 0.06, speed: 0.6, a: o.al, keep: i < 2 }); // bubbles swelling and popping
      F.ring(x, y, 34, rc(o, c), 0.55 * o.L, 3, true); F.pop(x, y - 10, 28, c, 0.3, false, o.al * 0.8);
      if (o.big) F.ring(x, y, 58, rc(o, '#d2ff82'), 0.6, 3, true);
    },
    holy(o) { // a light pillar beams up, a halo over the head, motes rise
      const F = o.F, x = o.x, y = o.y;
      F.beam(x, y, o.big ? 140 : 110, o.big ? 22 : 18, '#ffcf5a', 0.6 * o.L, o.al, '#ffffff');
      F.ring(x, y - 34, 12, rc(o, '#fff0c2'), 0.7 * o.L, 2, false, 10); F.ring(x, y, 40, rc(o, '#ffcf5a'), 0.5 * o.L, 3);
      SP(o, 'fx.circle.spark', x, y - 4, { ramp: 'holy', add: true, a: o.al, keep: true });
      F.burst(x, y - 6, nn(o, 14), { color: '#fff0c2', a: -1.57, spread: 0.8, sp: 70, vy: -40, life: 0.8 * o.L, size: 2, add: true, drag: 1.2 });
      F.pop(x, y - 30, 20, '#fff0c2', 0.3, true, o.al);
    },
    shadow(o) { // smoke and motes implode into the hero, a shrinking ring, a collapse flash
      const F = o.F, x = o.x, y = o.y, R = o.big ? 64 : 46, T = 0.45, k = Math.ceil(12 * o.n * (o.low ? 0.5 : 1) * F.crowd);
      for (let i = 0; i < k; i++) {
        const q = i * TAU / k + Math.random() * 0.4, cx = Math.cos(q) * R, cy = Math.sin(q) * R * 0.7, sm = i % 3 === 0;
        F.part(x + cx, y - 10 + cy, { kind: sm ? 'smoke' : 'dot', color: sm ? '#5a2fb0' : (i & 1 ? '#a070ff' : '#c9b3ff'), size: sm ? 5 : 2.4, add: !sm, drag: 0, vx: -cx / T, vy: -cy / T }, 0, T);
      }
      for (let i = 0, m = o.low ? 3 : 6; i < m; i++) { const q = i * TAU / m + 0.4, cx = Math.cos(q) * R, cy = Math.sin(q) * R * 0.7; SP(o, 'fx.puff', x + cx, y - 8 + cy, { ramp: '#5a2fb0', a: 0.8 * o.al, vx: -cx / T, vy: -cy / T, speed: 0.33 / T, keep: true }); } // smoke puffs drawn into the hero
      F.ring(x, y - 6, R, rc(o, '#a070ff'), T, 3, true); F.ring(x, y - 6, R * 1.4, rc(o, '#5a2fb0'), T, 2, true);
      F.pop(x, y - 12, 14, '#5a2fb0', 0.5, false, o.al * 0.6);
      SP(o, 'fx.circle.spark', x, y - 6, { ramp: 'shadow', add: true, delay: T - 0.05, a: o.al, keep: true });
      if (o.big) SP(o, 'fx.soul.violet', x, y - 10, { add: true, delay: T - 0.1, keep: true });
    },
    general(o) { // steel sparks and a stamp ring
      const F = o.F, x = o.x, y = o.y;
      F.burst(x, y - 10, nn(o, 18), { kind: 'spark', color: '#f2f5f9', a: -1.57, spread: 2.6, sp: 230, vy: -20, life: 0.35, size: 1.4, drag: 3 });
      F.burst(x, y - 10, nn(o, 10), { kind: 'streak', color: '#d9dfe8', sp: 220, life: 0.3, size: 2.4 });
      F.ring(x, y, 34, rc(o, '#d9dfe8'), 0.25, 4, false, 14); F.ring(x, y, 22, rc(o, '#ffffff'), 0.18, 2);
      SP(o, 'fx.smoke.ring', x, y + 2, { ramp: 'dust', keep: true }); SP(o, 'fx.hit.spark', x, y - 14, {}); SP(o, 'fx.ring.shock', x, y - 2, { ramp: 'general', add: true, a: o.al, keep: true });
      F.pop(x, y - 12, 24, '#ffffff', 0.18, true, o.al);
      if (o.big) F.burst(x, y - 10, nn(o, 6), { kind: 'shard', color: '#d9dfe8', sp: 140, life: 0.6, size: 2.6, vz: 90, z: 8 });
    },
    route(o, b) { // three banner columns of rising streaks in the class colour
      const F = o.F, x = o.x, y = o.y, cl = b && ED.CLASSES[b.cls], c = cl ? cl.col.c : '#ffd36b', hi = U.mix(c, '#ffffff', 0.6);
      for (const dx of [-12, 0, 12]) {
        F.burst(x + dx, y - 4, nn(o, 5), { kind: 'streak', color: c, a: -1.57, spread: 0.15, sp: 220, life: 0.45, size: 2.4, drag: 1.2 });
        F.beam(x + dx, y - 4, dx ? 40 : 54, 5, c, 0.4 * o.L, 0.8 * o.al, hi);
      }
      F.ring(x, y, 32, rc(o, c), 0.45, 3);
      SP(o, 'fx.spark.magic', x, y - 28, { ramp: c, add: true, a: o.al, keep: true });
      F.pop(x, y - 16, 20, c, 0.25, false, o.al);
    },
    asc(o) { // prismatic burst in the six element colours and a big ring
      const F = o.F, x = o.x, y = o.y, c = ED.RARITY.a.color;
      for (let i = 0; i < 6; i++) F.burst(x, y - 12, nn(o, 4), { color: PRISM[i], a: i * TAU / 6, spread: 1, sp: 160, life: 0.7, size: 2.4, add: true, drag: 2 });
      F.burst(x, y - 10, nn(o, 8), { kind: 'streak', color: '#ffd0f4', a: -1.57, spread: 1.4, sp: 240, life: 0.35, size: 1.8 });
      F.ring(x, y, 70, rc(o, c), 0.6 * o.L, 4, false, 12); F.ring(x, y, 40, rc(o, '#ffffff'), 0.35, 2);
      SP(o, 'fx.circle.spark', x, y - 4, { ramp: c, add: true, a: o.al, keep: true }); SP(o, 'fx.ring.shock', x, y - 6, { ramp: '#c9b3ff', add: true });
      F.pop(x, y - 14, 30, '#ff9ae6', 0.3, true, o.al);
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
    if (kind === 'duo') { const d = (b && b.duo) || ['fire', 'ice']; o.n *= 0.7; B[d[0]](o, b, ev); B[d[1]](o, b, ev); F.ring(x, y, 46, rc(o, ED.RARITY.d.color), 0.5, 3); }
    else (B[kind] || B.general)(o, b, ev);
    if (big && BIG_COL[kind]) F.ring(x, y, 64, rc(o, BIG_COL[kind]), 0.7, 4, false, 16);
  };
})(globalThis.ED || (globalThis.ED = {}));
