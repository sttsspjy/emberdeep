// ranger route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Deadeye far-shot spark, Quickdraw frost streak, Flurry fan, Scattershot hop and caltrops, Hail of Thorns glints, Skyfall and Second Shower landings, Splitting Bolt split, Hunter's Mark glyph and leap, Contagion threads.
// Skill forms: Death Mark (waves, red-tinged arrows, bursts), Thornburst (the ring), Starfall Barrage (falling stars, star landings), Storm of Thorns (thorn ring on the Rain, bramble patches).
(function (ED) {
  'use strict';
  const F = ED.FX, CFX = ED.ClassFx, A = ED.Audio;
  if (!F || !CFX) return;
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  const Pix = ED.Pix;
  const low = () => !!(ED.Render && ED.Render.quality === 'low');
  let tinkT = 0, threadT = 0;
  // Motes that fly from (x0, y0) to (x1, y1) in t seconds (n of them, staggered).
  function fly(x0, y0, x1, y1, col, n, t) {
    for (let i = 0; i < n; i++) F.part(x0, y0, { color: col, size: 2, life: t, add: true, drag: 0, vx: (x1 - x0) / t, vy: (y1 - y0) / t }, 0, t * (0.55 + 0.15 * i));
  }
  // Distance from the viewing hero to (x, y), 9999 when it is unknown: far events do not shake the screen.
  const away = (ctx, x, y) => { const me = ctx.player(ctx.localPid); return me ? Math.hypot(me.x - x, me.y - y) : 9999; };

  // ---- hits: Deadeye's far shot rings (a bright star and a high tink); Quickdraw's slow drags a frosted streak off the foe ----
  CFX.on('hit', (ev, ctx, local) => {
    if (ev.f) {
      F.pop(ev.x, ev.y, 18, '#fff6d8', 0.15, true);
      F.burst(ev.x, ev.y, 5, { kind: 'spark', color: '#fff3c4', sp: 190, life: 0.22, size: 1.5, drag: 5 });
      SP('fx.hit.spark', ev.x, ev.y, { add: true, ramp: 'gold', speed: 1.2 });
      if (F.time - tinkT > 0.05) { tinkT = F.time; A.play('deflect', ev.pid === local ? 0.4 : 0.18); }
    }
    if (ev.sl) {
      F.burst(ev.x, ev.y + 4, 3, { kind: 'streak', color: '#dff1ff', a: Math.PI, spread: 0.5, sp: 110, life: 0.4, size: 1.5, drag: 3 });
      if (!low()) { SP('fx.glint', ev.x - 6, ev.y + 4, { add: true, ramp: 'ice', delay: 0.07, a: 0.9 }); SP('fx.glint', ev.x + 7, ev.y + 8, { add: true, ramp: 'ice', delay: 0.12, a: 0.9 }); }
    }
  });

  // ---- Flurry: every nth attack fans three streaks out of the bow ----
  CFX.on('atk', (ev, ctx, local) => {
    const p = ctx.player(ev.pid), n = p && p.stats && p.stats.flurry;
    if (!n || ev.n % n) return;
    const mx = p.x + Math.cos(ev.a) * 14, my = p.y - 10 + Math.sin(ev.a) * 14;
    for (let s = -1; s <= 1; s++) F.burst(mx, my, 2, { kind: 'streak', color: '#e8f0ff', a: ev.a + s * 0.12, spread: 0.04, sp: 380, life: 0.16, size: 1.7, drag: 6 });
    F.pop(mx, my, 13, '#dfe9ff', 0.1);
    A.play('shoot', ev.pid === local ? 0.5 : 0.22);
  });

  // ---- skill casts: Scattershot's hop (dust, a kick of streaks; Caltrops spill shards), Hail of Thorns' glints in the Rain ----
  CFX.on('skill', (ev, ctx, local) => {
    const p = ctx.player(ev.pid), st = p && p.stats;
    if (!st) return;
    if (ev.k === 'volley' && st.thornburst > 0) { // Thornburst: a full ring of arrows leaves the bow
      const n = Math.min(24, Math.round(st.thornburst)), mine = ev.pid === local;
      for (let i = 0; i < n; i++) F.part(ev.x, ev.y - 8, { kind: 'streak', color: i & 1 ? '#d2ff82' : '#9be33c', a: ev.a + i * Math.PI * 2 / n, sp: 360, life: 0.24, size: 1.8, drag: 5 });
      F.ring(ev.x, ev.y - 6, 70, '#9be33c', 0.35, 4); F.ring(ev.x, ev.y - 6, 36, '#ffffff', 0.22, 2); F.pop(ev.x, ev.y - 8, 36, '#d2ff82', 0.18, true);
      F.burst(ev.x, ev.y - 4, 8, { kind: 'shard', color: '#7fbf3a', sp: 130, life: 0.5, size: 2.2, vz: 70, z: 2 });
      A.play('shoot', mine ? 0.7 : 0.3);
      if (mine) F.addShake(2);
    }
    if (ev.k === 'volley' && st.volleyHop) {
      const mine = ev.pid === local;
      F.dust(ev.x, ev.y + 2, 'dust', 3);
      F.burst(ev.x, ev.y - 6, 4, { kind: 'streak', color: '#e8e2c8', a: ev.a + Math.PI, spread: 0.5, sp: 260, life: 0.2, size: 1.6 });
      A.play('dash', mine ? 0.55 : 0.25); A.play('shoot', mine ? 0.5 : 0.2); // whoosh and bowstring twang
      if (st.caltrops) { F.burst(ev.x, ev.y - 2, 12, { kind: 'shard', color: '#cfd6de', sp: 120, life: 0.55, size: 2, vz: 80, z: 3 }); A.play('spark', mine ? 0.5 : 0.25); }
    } else if (ev.k === 'rain' && st.rainHail && ev.tx !== undefined) {
      const r = ED.skillRadius('rain', st);
      F.ring(ev.tx, ev.ty, r, '#9be33c', 0.5, 2);
      for (let i = 0, n = low() ? 3 : 7; i < n; i++) { const a = i * 2.4 + ev.tx, d = Math.sqrt((i + 0.5) / n) * r * 0.85; SP('fx.glint', ev.tx + Math.cos(a) * d, ev.ty + Math.sin(a) * d * 0.7 - 6, { ramp: 'poison', add: true, delay: 0.4 + i * 0.07 }); }
    }
  });

  // ---- Skyfall and Twin Sky land (k 0 / 1): a ring and shock on the ground, dust, splinters, a thud; the Second Shower (k 2) starts with a ring and a falling streak ----
  CFX.on('skyfx', (ev, ctx) => {
    const d = away(ctx, ev.x, ev.y);
    if (ev.k === 2) {
      F.ring(ev.x, ev.y, ev.r, '#e8d8b0', 0.35, 3);
      F.burst(ev.x, ev.y - 30, 8, { kind: 'streak', color: '#e8d8b0', a: Math.PI / 2, spread: 1.2, sp: 300, life: 0.3, size: 1.7 });
      if (d < 420) A.play('shoot', 0.4);
      return;
    }
    if (ev.k === 3) { // Starfall Barrage: a gold star lands - bright ring, radial streaks, gold shards
      F.ring(ev.x, ev.y, ev.r, '#ffd36b', 0.4, 4); F.ring(ev.x, ev.y, ev.r * 0.55, '#ffffff', 0.25, 2);
      F.pop(ev.x, ev.y - 6, ev.r * 0.8, '#ffe9a0', 0.22, true);
      F.burst(ev.x, ev.y - 2, 10, { kind: 'streak', color: '#fff3c4', sp: ev.r * 3, life: 0.26, size: 1.8, drag: 4 });
      F.burst(ev.x, ev.y, 7, { kind: 'shard', color: '#ffd36b', sp: ev.r * 1.3, life: 0.5, size: 2.2, vz: 100, z: 3, add: true });
      F.dust(ev.x, ev.y, 'dust', 2);
      SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'gold', delay: 0.02 });
      if (d < 360) { F.addShake(1.6); F.punch(0.2, 0); }
      A.play('thud', d < 360 ? 0.55 : 0.2);
      return;
    }
    F.ring(ev.x, ev.y, ev.r, '#e8d8b0', 0.4, 4); F.ring(ev.x, ev.y, ev.r * 0.6, '#ffffff', 0.25, 2);
    F.pop(ev.x, ev.y - 6, ev.r * 0.7, '#fff3d0', 0.2);
    F.dust(ev.x, ev.y, 'dust', ev.k ? 3 : 5);
    SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'dust', delay: 0.02 });
    F.burst(ev.x, ev.y, 12, { kind: 'shard', color: '#e8d8b0', sp: ev.r * 1.2, life: 0.5, size: 2, vz: 90, z: 4 });
    F.burst(ev.x, ev.y - 4, 8, { kind: 'streak', color: '#fff3d0', a: -Math.PI / 2, spread: 2.4, sp: 230, life: 0.25, size: 1.6 });
    if (d < 360) { F.addShake(ev.k ? 2 : 4); F.punch(0.3, 0); }
    A.play('thud', d < 360 ? (ev.k ? 0.5 : 0.85) : 0.25);
  });

  // ---- Hunter's Mark leaps (Relentless Hunt): a red thread from the dead foe to the new mark, motes along it, a flare where it lands ----
  CFX.on('hunt', (ev, ctx, local) => {
    const mine = ev.pid === local, m = mine ? 1 : 0.7;
    if (F.bolts.length < 24) F.bolts.push({ pts: [[ev.x0, ev.y0 + 8], [ev.x1, ev.y1 + 8]], life: 0.22, max: 0.22, color: '#ff5a4a', st: true });
    fly(ev.x0, ev.y0, ev.x1, ev.y1, '#ff8a7a', low() ? 1 : 3, 0.26);
    F.pop(ev.x1, ev.y1, 16 * m, '#ff7a6a', 0.18);
    SP('fx.circle.spark', ev.x1, ev.y1 + 6, { ramp: 'blood', add: true, speed: 1.4, a: mine ? 1 : 0.6 });
    A.play('guardhit', 0.22 * m);
  });

  // ---- Splitting Bolt: a flare and two streaks where the shot breaks (+-0.3 rad) ----
  CFX.on('split', (ev, ctx, local) => {
    F.pop(ev.x, ev.y, 14, '#ffe9b0', 0.12, true);
    for (let s = -1; s <= 1; s += 2) F.burst(ev.x, ev.y, 3, { kind: 'streak', color: '#fff0c8', a: ev.a + s * 0.3, spread: 0.12, sp: 300, life: 0.16, size: 1.6 });
    F.burst(ev.x, ev.y, 4, { kind: 'spark', color: '#ffd36b', sp: 150, life: 0.2, size: 1.4, drag: 5 });
    A.play('shoot', ev.pid === local ? 0.45 : 0.2);
  });

  // ---- Contagion (chain k 'c'): a poison-green thread from the dead foe to each foe that catches its statuses, violet motes along it ----
  CFX.on('chain', (ev) => {
    if (ev.k !== 'c') return;
    if (ev.pts.length < 2) return true;
    const a = ev.pts[0], b = ev.pts[1];
    if (F.bolts.length < 24) F.bolts.push({ pts: [[a[0], a[1]], [b[0], b[1]]], life: 0.3, max: 0.3, color: '#9be33c', st: true });
    fly(a[0], a[1] - 8, b[0], b[1] - 8, '#c9b3ff', low() ? 1 : 3, 0.3);
    F.pop(b[0], b[1] - 8, 12, '#c9b3ff', 0.16);
    if (!low()) SP('fx.puff', b[0], b[1] - 8, { ramp: 'poison', speed: 1.2, a: 0.8 });
    if (F.time - threadT > 0.1) { threadT = F.time; A.play('magic', 0.18); }
    return true; // the built-in chain bolt would draw a second, blue line
  });

  // ---- Hunter's Mark: a red crosshair in the overhead glyph row of every marked foe (host and solo foes carry mark, mirror foes marked); the atlas has no crosshair, the render.js GLYPH.cross stub is the art ----
  const MARK = { id: '', ramp: '', stub: 'cross' };
  CFX.mark.push((e) => (e.marked || e.mark > 0 ? MARK : null));
  // ---- Death Mark: waves 2 and 3 are a fan of streaks and a flash at the bow; a marked foe's death throws four red streaks and a flare ----
  CFX.on('wave', (ev, ctx, local) => {
    const mine = ev.pid === local, mx = ev.x + Math.cos(ev.a) * 14, my = ev.y - 10 + Math.sin(ev.a) * 14;
    for (let s = -2; s <= 2; s++) F.burst(mx, my, 1, { kind: 'streak', color: s & 1 ? '#ffb0a0' : '#ff7a6a', a: ev.a + s * 0.25, spread: 0.04, sp: 420, life: 0.16, size: 1.7, drag: 6 });
    F.pop(mx, my, 14, '#ff8a7a', 0.1);
    A.play('shoot', mine ? 0.5 : 0.2);
  });
  CFX.on('dmburst', (ev, ctx, local) => {
    const mine = ev.pid === local;
    for (let i = 0; i < 4; i++) F.burst(ev.x, ev.y - 6, 2, { kind: 'streak', color: '#ff7a6a', a: Math.PI / 4 + i * Math.PI / 2, spread: 0.08, sp: 320, life: 0.22, size: 1.8, drag: 5 });
    F.pop(ev.x, ev.y - 6, 18, '#ff5a4a', 0.16, true);
    if (!low()) SP('fx.circle.spark', ev.x, ev.y, { ramp: 'blood', add: true, speed: 1.6, a: mine ? 1 : 0.6 });
    if (F.time - tinkT > 0.06) { tinkT = F.time; A.play('guardhit', mine ? 0.3 : 0.14); }
  });
  // Volley arrows of a Death Mark Ranger carry a red tail, a Thornburst Ranger's a green one (Volley arrows fly at 480 px/s; the tail is drawn after the arrow body).
  CFX.shot.arrow = (c, pr, t, x, y) => {
    if (pr.team !== 0) return;
    const sp = Math.hypot(pr.vx, pr.vy);
    if (sp < 470 || sp > 490) return;
    const g = ED.Game && ED.Game.s, v = g ? g.view : null;
    if (!v) return;
    let col = '';
    for (const p of v.players.values()) if (p.cls === 'ranger' && p.stats) { if (p.stats.deathMark > 0) col = '#ff6a5a'; else if (p.stats.thornburst > 0) col = '#9be33c'; }
    if (!col) return;
    const ux = pr.vx / sp, uy = pr.vy / sp;
    c.fillStyle = col;
    for (let i = 1; i <= 3; i++) { c.globalAlpha = 0.8 - i * 0.2; c.fillRect(Pix.s2(x - ux * i * 7) - 1, Pix.s2(y - uy * i * 7) - 1, 2, 2); }
    c.globalAlpha = 1;
  };

  // ---- Starfall Barrage (zone 'starfall': r, dur = seconds until it lands): a faint ring from the cast, a closing ring and a gold star plunging in the last 0.5 s ----
  CFX.zone.starfall = (c, z, pass, t) => {
    const R = ED.Render, left = z.dur - z.t, q = left > 0.5 ? 0 : 1 - left / 0.5, u = (1 - q) * (1 - q), sx = z.x + u * 60, sy = z.y - u * 260, x = Pix.s2(z.x), y = Pix.s2(z.y);
    if (pass === 0) {
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 1, '#a8841e', '#ffd36b', '#ffe9a0', 3, (t * 6) & 7), x, y, 0.2 + 0.7 * q);
      if (q > 0) {
        Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * (1 - q * 0.75) / 2)), 1, '#a8841e', '#ffd36b', '#ffe9a0'), x, y, 0.35 + 0.5 * q);
        Pix.put(c, Pix.disc(Math.max(1, Math.round(z.r / 2)), '#ffd36b'), x, y, 0.06 + 0.14 * q);
        R.light(sx, sy, 50 + 70 * q, '#ffd36b', 0.5 + 0.5 * q);
      }
    } else if (pass === 1) {
      if (q > 0) R.glow(c, sx, sy, 20 + 18 * q, '#ffe9a0', 0.85);
    } else if (pass === 2 && q > 0) { // the star and its trail, airborne
      c.fillStyle = '#ffd36b'; c.beginPath();
      for (let i = 1; i <= 6; i++) { const kk = i / 6, tx = sx - (z.x - sx) / Math.max(1, Math.hypot(z.x - sx, z.y - sy)) * kk * 40, ty = sy - (z.y - sy) / Math.max(1, Math.hypot(z.x - sx, z.y - sy)) * kk * 40; c.globalAlpha = 1 - kk; c.rect(Pix.s2(tx), Pix.s2(ty), i < 3 ? 4 : 2, i < 3 ? 4 : 2); }
      c.fill(); c.globalAlpha = 1;
      Pix.put(c, Pix.orb(4, '#5a3c08', '#e8b43a', '#ffd36b', '#ffffff'), Pix.s2(sx), Pix.s2(sy));
    }
  };

  // ---- Storm of Thorns: a dashed green ring and rim thorns turning on the Rain (zone 'rain' with w 5), and the bramble patches it leaves (zone 'bramble') ----
  CFX.zone.thornstorm = (c, z, pass, t) => {
    const R = ED.Render, fade = Math.min(1, (z.dur - z.t) * 2.5, z.t * 4), x = Pix.s2(z.x), y = Pix.s2(z.y);
    if (pass === 0) {
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 2, '#3f7a18', '#9be33c', '#d2ff82', 4, (-t * 5) & 7), x, y, 0.85 * fade);
      c.fillStyle = '#9be33c'; c.globalAlpha = fade; c.beginPath();
      const n = Math.max(10, Math.round(z.r / 7));
      for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n + t * 0.5, px = Pix.s2(z.x + Math.cos(a) * (z.r + 3)), py = Pix.s2(z.y + Math.sin(a) * (z.r + 3) * 0.8); c.rect(px - 1, py - 4, 2, 4); c.rect(px - 3, py - 2, 6, 2); }
      c.fill(); c.globalAlpha = 1;
    } else if (pass === 1) R.glow(c, z.x, z.y, z.r * 1.0, '#7fbf3a', 0.16 * fade);
  };
  CFX.zone.bramble = (c, z, pass, t) => {
    const R = ED.Render, fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5), grow = Math.min(1, z.t * 5), n = Math.max(6, Math.round(z.r / 5));
    if (pass !== 0) return;
    R.light(z.x, z.y, z.r * 1.3, '#7fbf3a', 0.18 * fade);
    Pix.put(c, Pix.disc(Math.max(1, Math.round(z.r / 2)), '#1f3a10'), Pix.s2(z.x), Pix.s2(z.y), 0.22 * fade);
    Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 1, '#3f7a18', '#9be33c', '#9be33c', 3, 0), Pix.s2(z.x), Pix.s2(z.y), 0.6 * fade);
    c.globalAlpha = fade;
    for (let i = 0; i < n; i++) { // a thorn: a stem with a side barb and a bright tip, leaning with the patch
      const a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / n) * z.r * 0.85, px = Pix.s2(z.x + Math.cos(a) * rr), py = Pix.s2(z.y + Math.sin(a) * rr * 0.7), h = Math.round((6 + (i % 3) * 2) * grow / 2) * 2, lean = (i & 1) ? 2 : -2;
      c.fillStyle = '#2f5a14'; c.fillRect(px, py - h, 2, h); c.fillRect(px + lean, py - h + 2, 2, 2); c.fillRect(px - lean, py - Math.round(h / 2 / 2) * 2, 2, 2);
      c.fillStyle = '#b8f060'; c.fillRect(px, py - h - 2, 2, 2);
    }
    c.globalAlpha = 1;
  };
})(globalThis.ED || (globalThis.ED = {}));
