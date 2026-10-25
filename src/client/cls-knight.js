// knight route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Events: block k 'bulwark' (a blocked attack), bash (the Bulwark cone), parry, ward (Rallying Charge) and the boom 'shock' of Juggernaut / Oathbreaker; hero hook: Brace plate, Hold the Line ring, the raised Bulwark's arc, Riposte shimmer, Charge streaks.
// Everything is pixel art on the 2 px grid. Skill forms: Avalanche (quake slam, crack fissures), Iron Phalanx (wide streaks, War Banner), Aegis Tempest (vortex zone).
// Route forms: Earthsplitter (the fissure zone and its 'fissure' event), Thousand Edges (the 'blade' shot body), Doombrand (a foe mark glyph), Bloodquake (the 'bquake' event).
(function (ED) {
  'use strict';
  const CFX = ED.ClassFx, F = ED.FX, U = ED.U, Pix = ED.Pix, TAU = U.TAU, s2 = Pix.s2;
  const GOLD = '#ffd36b', PALE = '#fff3c4';
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  const gview = () => (ED.Game && ED.Game.s ? ED.Game.s.view : null);
  const blockT = {}, parryT = {}, chargeEnd = {}; // by pid: world-effect clock of the last Bulwark block / parry, and the path of the last Shield Charge { x, y, t0, t1 }

  function bossAt(x, y) {
    const v = gview(); if (!v) return false;
    for (const e of v.enemies) if (e.boss && Math.abs(e.x - x) < e.r + 24 && Math.abs(e.y - y) < e.r + 24) return true;
    return false;
  }
  const heroOf = (ctx, pid) => ctx.player(pid);

  // ---- Bulwark ----
  // A block: gold sparks and a spark sprite off the shield face (the facing of the blocking hero), a clank that climbs with the power stored, a 30 ms hit-stop and a 1 px shake for the local Knight; the hero hook flashes the shield.
  CFX.on('block', (ev, ctx, local) => {
    if (ev.k !== 'bulwark') return;
    const p = heroOf(ctx, ev.pid), a = p ? p.face || 0 : 0, x = (p ? p.x : ev.x) + Math.cos(a) * 14, y = (p ? p.y : ev.y) - 8 + Math.sin(a) * 8, mine = ev.pid === local;
    blockT[ev.pid] = F.time;
    F.burst(x, y, 6, { kind: 'spark', color: '#ffe6a8', a, spread: 1.6, sp: 190, life: 0.22, size: 1.6, drag: 5 });
    SP('fx.hit.spark', x, y, { ramp: 'gold', add: true, speed: 1.3, lt: GOLD, ltr: 26 });
    F.pop(x, y, 12, PALE, 0.12, true);
    ED.Audio.play('bwblock', mine ? 0.9 : 0.4, { n: ev.n });
    if (mine) { F.hitStop(0.03); F.addShake(1); }
  });
  // The bash: a gold cone sweep over its reach and arc, steel streaks and dust along the front, a thump; it grows with the power stored (n), a free Shield Bash (f) is lighter.
  CFX.on('bash', (ev, ctx, local) => {
    const mine = ev.pid === local, a = ev.a || 0, n = ev.n | 0, k = 1 + 0.15 * n, fx = ev.x + Math.cos(a) * ev.r * 0.55, fy = ev.y - 6 + Math.sin(a) * ev.r * 0.45;
    F.slash(ev.x, ev.y - 6, a, ev.r, ev.arc, n > 0 ? GOLD : '#e8e2c8', 0.22);
    F.burst(fx, fy, Math.round(6 * k), { kind: 'streak', color: PALE, a, spread: ev.arc * 0.6, sp: 260 * k, life: 0.22, size: 1.8 });
    F.burst(fx, fy + 6, 4, { kind: 'shard', color: '#9a8a6a', a, spread: 1.2, sp: 120, life: 0.4, size: 2.2, vz: 70, z: 2 });
    F.pop(ev.x + Math.cos(a) * 16, ev.y - 10 + Math.sin(a) * 10, 18 * k, n > 0 ? GOLD : PALE, 0.16, n > 0);
    if (n >= 4 || (bossAt(fx, fy) && n > 0)) F.ring(fx, fy, ev.r * 0.6, GOLD, 0.3, 3);
    ED.Audio.play('bwbash', (mine ? 0.9 : 0.4) * (ev.f ? 0.7 : 1), { n });
    if (mine) { F.hitStop(ev.f ? 0.03 : 0.05 + 0.01 * Math.min(4, n)); F.addShake(ev.f ? 1.5 : 2 + Math.min(3, n * 0.75)); }
  });
  // A Shield Charge: its path for the Rally / Juggernaut effects and speed streaks.
  CFX.on('skill', (ev, ctx) => {
    if (ev.k === 'charge') {
      const len = ev.tx !== undefined ? Math.hypot(ev.tx - ev.x, ev.ty - ev.y) : 100;
      chargeEnd[ev.pid] = { x: ev.tx !== undefined ? ev.tx : ev.x, y: ev.ty !== undefined ? ev.ty : ev.y, t0: F.time, t1: F.time + len / ED.CONST.CHARGE_SPEED };
      F.burst(ev.x, ev.y - 8, 8, { kind: 'streak', color: '#e8e2c8', a: (ev.a || 0) + Math.PI, spread: 0.5, sp: 220, life: 0.25, size: 1.8 });
      const hp = ctx.player(ev.pid), hs = hp && hp.stats;
      if (hs && hs.avalanche > 0) { F.dust(ev.x, ev.y + 2, 'dust', 5); F.burst(ev.x, ev.y - 4, 10, { kind: 'shard', color: '#9a8a6a', a: (ev.a || 0) + Math.PI, spread: 1.4, sp: 150, life: 0.5, size: 2.6, vz: 90, z: 2 }); } // Avalanche: the run kicks up rubble
      if (hs && hs.phalanx > 0) F.burst(ev.x, ev.y - 8, 6, { kind: 'spark', color: '#ffe6a8', a: (ev.a || 0), spread: 2.4, sp: 160, life: 0.25, size: 1.6, drag: 5 });
    }
  });
  // A hit by the charging hero: the shield rings off the foe (spark, short streaks along the run, 2 px shake for the local knight).
  CFX.on('hit', (ev, ctx, local) => {
    const ce = chargeEnd[ev.pid];
    if (!ce || ev.k || F.time < ce.t0 || F.time > ce.t1 + 0.12) return;
    const p = heroOf(ctx, ev.pid), a = p ? (p.face || 0) : 0;
    SP('fx.hit.spark', ev.x, ev.y + 4, { ramp: 'gold', add: true, speed: 1.2 });
    F.burst(ev.x, ev.y + 4, 4, { kind: 'streak', color: '#e8e2c8', a, spread: 1.1, sp: 240, life: 0.2, size: 1.6 });
    if (ev.pid === local) F.addShake(2);
  });
  // Rallying Charge: where the charge ended, a gold ring of radius 100 and rising banners; motes fly to the allies it shields.
  CFX.on('ward', (ev, ctx) => {
    let pid = null;
    for (const k in chargeEnd) { const c = chargeEnd[k]; if (F.time - c.t1 < 0.5 && Math.abs(c.x - ev.x) < 6 && Math.abs(c.y - ev.y) < 6) { pid = k; break; } }
    const p = pid ? heroOf(ctx, pid) || heroOf(ctx, +pid) : null;
    if (!p || !p.stats || !p.stats.rally) return;
    F.ring(ev.x, ev.y, 100, GOLD, 0.6, 5); F.ring(ev.x, ev.y, 60, '#ffe9a0', 0.4, 2);
    F.pop(ev.x, ev.y - 6, 40, GOLD, 0.25);
    for (let i = 0; i < 4; i++) { const q = i * TAU / 4 + 0.6; SP('deco.banner.yellow', ev.x + Math.cos(q) * 70, ev.y + Math.sin(q) * 40 - 6, { frame: 0, life: 0.8, fade: true, vy: -16, delay: i * 0.06 }); }
    for (const q of ctx.players()) if (!q.dead && !q.downed && U.dist2(q.x, q.y, ev.x, ev.y) < 100 * 100) for (let i = 0; i < 3; i++) F.part(ev.x + (Math.random() - 0.5) * 20, ev.y - 6, { color: '#ffe9a0', size: 2, life: 0.5, add: true, drag: 0, vx: (q.x - ev.x) / 0.45, vy: (q.y - 10 - ev.y) / 0.45 }, 0, 0.45);
  });
  // The Knight whose Oathbreaker made this boom: its radius is 72 x area and it lies 0.9 x the Cleave reach (weapon range x 1.4) from that hero, 0.55 x for a warhammer's own shock.
  function oathOf(ev, ctx) {
    for (const p of ctx.players()) {
      const st = p.stats, w = st && st.weapon;
      if (p.cls !== 'knight' || !st || !st.cShock || !w || w.kind !== 'melee') continue;
      const reach = w.range * (1 + st.area * 0.5 + st.meleeReach) * 1.4;
      if (Math.abs(ev.r - Math.round(72 * (1 + st.area * 0.5))) <= 1 && Math.abs(Math.hypot(ev.x - p.x, ev.y - p.y) - reach * 0.9) < 13) return p;
    }
    return null;
  }
  // Shockwaves: Juggernaut (the end of a Charge) and Oathbreaker (the tip of a Cleave) get a gold ring pair, a ground crack of dust and a heavier shake.
  CFX.on('boom', (ev, ctx, local) => {
    if (ev.k !== 'shock') return;
    let jug = null;
    for (const k in chargeEnd) { const c = chargeEnd[k]; if (F.time - c.t1 < 0.3 && F.time >= c.t0 && Math.abs(c.x - ev.x) < 8 && Math.abs(c.y - ev.y) < 8) { const p = heroOf(ctx, k) || heroOf(ctx, +k); if (p && p.stats && p.stats.jugShock) { jug = p; break; } } }
    if (!jug && !oathOf(ev, ctx)) return;
    ev.kfx = 1; // the gold pair below replaces the generic rings of this boom
    F.ring(ev.x, ev.y, ev.r, GOLD, 0.35, 4); F.ring(ev.x, ev.y, ev.r * 0.6, PALE, 0.25, 2);
    F.burst(ev.x, ev.y, jug ? 10 : 6, { kind: 'shard', color: '#9a8a6a', sp: ev.r * 1.8, life: 0.5, size: 3, vz: 90, z: 2 });
    if (jug) F.addShake(jug.pid === local ? 3 : 1);
  });
  // Parry: a white ring and cross flash at the foe whose attack broke, the hero flashes (Riposte shimmer follows), 80 ms hit-stop.
  CFX.on('parry', (ev, ctx, local) => {
    parryT[ev.pid] = F.time;
    F.ring(ev.x, ev.y, 22, '#ffffff', 0.25, 3);
    F.burst(ev.x, ev.y, 8, { kind: 'spark', color: '#ffffff', sp: 220, life: 0.25, size: 1.6, drag: 5 });
    F.pop(ev.x, ev.y, 22, '#ffffff', 0.18, true);
    SP('fx.cutx', ev.x, ev.y - 2, { add: true, ramp: 'general' });
    const p = heroOf(ctx, ev.pid);
    if (p) { F.pop(p.x, p.y - 12, 16, '#ffffff', 0.14); SP('fx.glint', p.x + Math.cos(p.face || 0) * 14, p.y - 14 + Math.sin(p.face || 0) * 8, { add: true, speed: 1.3 }); }
    ED.Audio.play('parry', ev.pid === local ? 0.9 : 0.5);
    if (ev.pid === local) { F.hitStop(0.08); F.addShake(2); }
  });

  // ---- hero hook: Brace plate, Hold the Line ring, catch glint, Riposte shimmer, Charge streaks (hero feet frame, lit pass) ----
  function braced(p, view) {
    if (p.braceT > 0) return 1;
    if (!view) return 0;
    for (const z of view.zones) if (z.kind === 'sanct' && z.w === 7 && U.dist2(z.x, z.y, p.x, p.y) < z.r * z.r) return 2; // inside a War Banner
    for (const q of view.players.values()) if (q !== p && q.braceT > 0 && q.stats && q.stats.braceAura && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 10000) return 2;
    return 0;
  }
  CFX.hero.push((c, p, t, low) => {
    if (p.cls !== 'knight' || p.dead) return;
    const st = p.stats, R = ED.Render, rp = Pix.ramp(GOLD), view = gview();
    if (!p.downed) {
      const b = braced(p, view);
      if (b) { // feet planted: a dashed gold plate under the boots and a warm glow; Hold the Line adds the aura ring of radius 100
        const a = b === 1 ? 0.85 : 0.5, pulse = 0.85 + 0.15 * Math.sin(t * 6);
        Pix.put(c, Pix.ell(9, 4, GOLD, false, 3, (t * 5) & 7), 0, 2, a * pulse);
        Pix.put(c, Pix.ell(7, 3, GOLD, true), 0, 2, 0.12 * a);
        R.emit(p.x, p.y - 4, 22, GOLD, 0.16 * a * pulse);
        if (b === 1 && st && st.braceAura && !low) Pix.put(c, Pix.ring(50, 1, rp[2], rp[3], rp[3], 3, (t * 3) & 7), 0, 2, 0.25);
      }
      if (p.bulwarkOn) { // the raised Bulwark: a dashed gold arc over the covered front (180 degrees with Shield Wall), brighter with each stored block, white for 0.1 s after a block
        const a = p.face || 0, arc = st && st.shieldWall > 0 ? Math.PI : 120 * Math.PI / 180, n = p.blocks | 0, bt = blockT[p.pid], hot = bt !== undefined && F.time - bt < 0.1;
        c.fillStyle = hot ? '#ffffff' : n > 0 ? GOLD : '#e8e2c8'; c.globalAlpha = hot ? 1 : 0.55 + 0.1 * Math.min(4, n); c.beginPath();
        for (let i = 0; i <= 8; i++) { const q = a - arc / 2 + arc * i / 8; c.rect(s2(Math.cos(q) * 18) - 1, s2(-9 + Math.sin(q) * 13) - 1, 2, i % 2 ? 2 : 4); }
        c.fill(); c.globalAlpha = 1;
        R.emit(p.x + Math.cos(a) * 14, p.y - 9 + Math.sin(a) * 10, 16 + 3 * n, GOLD, 0.15 + 0.05 * Math.min(4, n));
      }
      const pt = parryT[p.pid];
      if (pt !== undefined && F.time - pt < 0.22) { const k = (F.time - pt) / 0.22; Pix.put(c, Pix.ell(8 + Math.round(k * 5), 4 + Math.round(k * 2), '#ffffff', false), 0, 2, 1 - k); R.emit(p.x, p.y - 10, 26, '#ffffff', 0.3 * (1 - k)); } // the Riposte flash: a white ring spreads from the boots
      if (st && st.riposte && p.critStacks > 0 && Math.floor(t * 12) % 2 === 0) { // Riposte readied: the blade glints white
        const a = (p.face || 0) + Math.sin(t * 7) * 0.5, d = 16 + (Math.floor(t * 9) % 3) * 4;
        c.fillStyle = '#ffffff'; c.fillRect(s2(Math.cos(a) * d) - 1, s2(-12 + Math.sin(a) * d * 0.6) - 1, 2, 2);
        c.fillRect(s2(Math.cos(a + 1.3) * (d - 6)) - 1, s2(-12 + Math.sin(a + 1.3) * (d - 6) * 0.6) - 1, 2, 2);
      }
    }
    const ch = F.chargeT[p.pid];
    if (ch !== undefined && F.time - ch < 0.45 && chargeEnd[p.pid] && F.time <= chargeEnd[p.pid].t1 + 0.05) { // Shield Charge: pixel speed lines trail behind the runner
      const f = p.face || 0, k = 1 - (F.time - ch) / 0.45, cx = Math.cos(f), cy = Math.sin(f);
      c.globalAlpha = Math.max(0.3, k); c.fillStyle = '#e8e2c8'; c.beginPath();
      const wide = st && st.phalanx > 0 ? 3 : 1, sp = wide > 1 ? 12 : 8; // Iron Phalanx: seven lines across the 70 px band
      for (let i = -wide; i <= wide; i++) { const ox = -cy * i * sp, oy = cx * i * sp * 0.6, l0 = 12 + (i & 1) * 6, l1 = 26 - Math.abs(i) * 3; Pix.line(c, -cx * l0 + ox, -10 - cy * l0 * 0.6 + oy, -cx * (l0 + l1) + ox, -10 - cy * (l0 + l1) * 0.6 + oy, 2); }
      c.fill(); c.globalAlpha = 1;
    }
  });

  // ---- foe mark: Ruin Seal ---- a gold sigil in the overhead glyph row of every Sealed foe (host and solo foes carry sealT, mirror foes sealed); the atlas has no seal sprite, the render.js GLYPH.seal stub is the art.
  const SEAL = { id: '', ramp: '', stub: 'seal' };
  CFX.mark.push((e) => (e.sealed || e.sealT > 0 ? SEAL : null));

  // ---- skill forms ----
  const away = (ctx, x, y) => { const me = ctx.player(ctx.localPid); return me ? Math.hypot(me.x - x, me.y - y) : 9999; }; // far events do not shake the screen
  const jag = (z, i, amp) => Math.sin(i * 2.1 + z.id * 1.7) * amp + Math.sin(i * 5.3 + z.id) * amp * 0.5; // a fixed wobble along a crack

  // Avalanche slam: three gold rings, a dust cloud, rock shards thrown up, a column of white streaks, a heavy shake and hit-stop for the Knight who made it.
  CFX.on('quake', (ev, ctx, local) => {
    const mine = ev.pid === local, r = ev.r, d = away(ctx, ev.x, ev.y), A = ED.Audio;
    F.ring(ev.x, ev.y, r, GOLD, 0.55, 6); F.ring(ev.x, ev.y, r * 0.62, PALE, 0.42, 4); F.ring(ev.x, ev.y, r * 0.3, '#ffffff', 0.3, 3);
    F.burst(ev.x, ev.y, 26, { kind: 'shard', color: '#9a8a6a', sp: r * 2.2, life: 0.75, size: 3, vz: 150, z: 2 });
    F.burst(ev.x, ev.y, 12, { kind: 'smoke', color: '#8a7a5a', sp: r * 1.2, life: 1.0, size: 8, drag: 2.5 });
    F.burst(ev.x, ev.y - 4, 18, { kind: 'streak', color: PALE, a: -Math.PI / 2, spread: 2.8, sp: 340, life: 0.38, size: 2 });
    F.pop(ev.x, ev.y - 6, r * 0.85, GOLD, 0.32, true);
    SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'gold', speed: 0.8 });
    F.dust(ev.x, ev.y, 'dust', 6);
    A.play('thud', mine ? 1 : d < 400 ? 0.7 : 0.3); A.play('heavy', mine ? 0.9 : 0.35);
    if (mine) { F.addShake(9); F.hitStop(0.1); F.punch(0.9, 0.4); } else if (d < 400) F.addShake(3);
  });
  // A crack erupts: shards and a flash along its length, a short shake close by.
  CFX.on('crack', (ev, ctx, local) => {
    const cs = Math.cos(ev.a), sn = Math.sin(ev.a);
    for (let d = 10; d <= ev.len; d += 26) {
      const x = ev.x + cs * d, y = ev.y + sn * d;
      F.burst(x, y, 3, { kind: 'shard', color: '#b8a070', sp: 70, life: 0.5, size: 2.4, vz: 120, z: 2 });
      F.burst(x, y - 2, 2, { kind: 'streak', color: '#fff3c4', a: -Math.PI / 2, spread: 1.2, sp: 260, life: 0.25, size: 1.8 });
      if (d % 52 < 26) F.pop(x, y - 4, 14, GOLD, 0.16);
    }
    if (away(ctx, ev.x, ev.y) < 300) F.addShake(ev.pid === local ? 1.5 : 0.6);
    if (ev.pid === local) ED.Audio.play('thud', 0.4);
  });
  // The glowing fissure that runs outward for 0.3 s before it erupts (zone 'crack': x, y the slam, a the direction, len and w its size).
  CFX.zone.crack = (c, z, pass, t, k) => {
    const g = Math.min(1, k * 1.8), n = Math.max(3, Math.round(z.len / 6)), cs = Math.cos(z.a), sn = Math.sin(z.a), hot = k > 0.7 && Math.floor(t * 30) % 2 === 0;
    const pt = (i) => { const d = i / n * z.len, j = jag(z, i, 3); return [z.x + cs * d - sn * j, z.y + sn * d * 0.8 + cs * j]; };
    if (pass === 0) {
      c.globalAlpha = 0.9; c.fillStyle = '#120c07'; c.beginPath();
      for (let i = 0, m = Math.floor(n * g); i < m; i++) { const a = pt(i), b = pt(i + 1); Pix.line(c, a[0], a[1], b[0], b[1], 10 - Math.round(i / n * 4)); }
      c.fill();
      c.globalAlpha = 1; c.fillStyle = hot ? '#ffffff' : '#ff9a2a'; c.beginPath();
      for (let i = 0, m = Math.floor(n * g); i < m; i++) { const a = pt(i), b = pt(i + 1); Pix.line(c, a[0], a[1], b[0], b[1], 4); }
      c.fill(); c.fillStyle = hot ? '#ffffff' : '#ffe9a0'; c.beginPath();
      for (let i = 0, m = Math.floor(n * g); i < m; i++) { const a = pt(i), b = pt(i + 1); Pix.line(c, a[0], a[1], b[0], b[1], 2); }
      c.fill();
    } else if (pass === 1) {
      for (let i = 2; i < n * g; i += 4) { const a = pt(i); ED.Render.glow(c, a[0], a[1], 26, hot ? '#ffffff' : '#ff9a2a', 0.55); }
    }
  };

  // War Banner plant: a gold ring the size of the banner, a pulse of steel sparks and a rising flare; the local Knight feels a thud.
  CFX.on('banner', (ev, ctx, local) => {
    const mine = ev.pid === local;
    F.ring(ev.x, ev.y, ev.r, GOLD, 0.6, 5); F.ring(ev.x, ev.y, ev.r * 0.5, PALE, 0.4, 3);
    F.burst(ev.x, ev.y, 14, { kind: 'spark', color: '#e8e2c8', sp: ev.r * 1.5, life: 0.35, size: 1.8, drag: 4 });
    F.burst(ev.x, ev.y - 6, 8, { color: GOLD, sp: 40, vy: -90, life: 0.7, size: 2.2, add: true, drag: 1.2 });
    F.pop(ev.x, ev.y - 20, 40, GOLD, 0.3, true);
    ED.Audio.play('clang', mine ? 0.9 : 0.5); ED.Audio.play('thud', mine ? 0.7 : 0.3);
    if (mine) { F.addShake(4); F.hitStop(0.05); }
  });
  // The banner itself (a 'sanct' zone with w 7, drawn through render.js): a dashed ring and a faint steel disc on the ground, a pole with a waving gold pennant, motes rising round the rim.
  CFX.zone.banner = (c, z, pass, t, k) => {
    const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5), rp = Pix.ramp(GOLD), x = s2(z.x), y = s2(z.y), R = ED.Render;
    if (pass === 0) {
      Pix.put(c, Pix.disc(Math.max(1, Math.round(z.r / 2)), '#8a95a6'), x, y, 0.12 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 2, rp[2], rp[3], rp[3], 4, (t * 5) & 7), x, y, 0.85 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * 0.31)), 1, rp[1], rp[2], rp[2], 3, (-t * 4) & 7), x, y, 0.35 * fade);
      R.light(z.x, z.y, z.r * 1.5, '#ffe39a', 0.5 * fade);
      c.globalAlpha = fade; // the pole and its pennant (a dark outline under both), feet at the centre
      c.fillStyle = '#120c07'; c.fillRect(x - 4, y - 66, 8, 68); c.fillRect(x - 2, y - 70, 4, 4);
      c.fillStyle = '#8a7a5c'; c.fillRect(x - 2, y - 64, 4, 64); c.fillStyle = '#ffe9a0'; c.fillRect(x - 2, y - 68, 4, 4);
      for (let i = 0; i < 12; i++) { // the pennant: 12 columns of 20 px, each swaying a little more than the last, a red stripe through the gold
        const off = s2(Math.sin(t * 5 + i * 0.6 + z.id) * (1 + i * 0.25)), cx = x + 2 + i * 2, top = y - 62 + off, h = 22 - Math.floor(i * 0.8) * 2;
        c.fillStyle = '#120c07'; c.fillRect(cx, top - 2, 2, h + 4);
        c.fillStyle = rp[3]; c.fillRect(cx, top, 2, h); c.fillStyle = '#a82a2a'; c.fillRect(cx, top + 8, 2, 4); c.fillStyle = rp[4]; c.fillRect(cx, top, 2, 2);
      }
      c.globalAlpha = 1;
    } else if (pass === 1) {
      R.glow(c, z.x, z.y - 40, 44, '#ffd36b', 0.4 * fade);
      c.fillStyle = '#fff3c4';
      for (let i = 0; i < 8; i++) { const kk = (t * 0.5 + i * 0.125 + z.id * 0.1) % 1, a = i * 2.39996 + z.id; c.globalAlpha = Math.max(0.25, Math.ceil(Math.sin(kk * Math.PI) * 4) / 4) * fade; c.fillRect(s2(z.x + Math.cos(a) * z.r * 0.92), s2(z.y + Math.sin(a) * z.r * 0.92 * 0.8 - kk * 26), 2, 2); }
      c.globalAlpha = 1;
    }
  };

  // Aegis Tempest vortex (zone 'vortex': r, warm = seconds until it turns, 0 for the bash's): inward-spiralling arms of steel and gold motes, a bright eye, a dashed rim.
  CFX.zone.vortex = (c, z, pass, t, k) => {
    const on = z.t >= z.warm, fade = Math.min(1, (z.dur - z.t) * 3, on ? 1 : 0.35 + z.t / Math.max(0.05, z.warm) * 0.5), rp = Pix.ramp(GOLD), x = s2(z.x), y = s2(z.y), R = ED.Render, low = R.quality === 'low';
    if (pass === 0) {
      Pix.put(c, Pix.disc(Math.max(1, Math.round(z.r / 2)), '#9fb4cc'), x, y, 0.1 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 2, rp[2], rp[3], rp[3], 4, (t * 7) & 7), x, y, 0.85 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * 0.34)), 1, '#9fb4cc', '#dff1ff', '#ffffff', 3, (-t * 9) & 7), x, y, 0.7 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * 0.17)), 1, '#9fb4cc', '#dff1ff', '#ffffff', 2, (t * 11) & 7), x, y, 0.8 * fade);
      R.light(z.x, z.y, z.r * 1.4, '#cfe6ff', 0.7 * fade);
    } else if (pass === 1) {
      R.glow(c, z.x, z.y, z.r * 0.5, '#bfe3ff', 0.35 * fade);
      const arms = low ? 3 : 4, per = low ? 8 : 12;
      for (let a = 0; a < arms; a++) for (let i = 0; i < per; i++) {
        const u = 1 - ((i / per + t * 0.8) % 1), rad = z.r * (0.12 + 0.88 * u), ang = a * U.TAU / arms + t * 4 + (1 - u) * 5;
        c.globalAlpha = Math.max(0.25, Math.ceil((1 - u) * 4) / 4) * fade * 0.9; c.fillStyle = i % 3 === 0 ? '#ffe9a0' : '#dff1ff';
        const sz = u < 0.5 ? 4 : 2;
        c.fillRect(s2(z.x + Math.cos(ang) * rad) - (sz - 2) / 2, s2(z.y + Math.sin(ang) * rad * 0.8) - (sz - 2) / 2, sz, sz);
      }
      c.globalAlpha = 1;
    }
  };

  // ---- route forms: Earthsplitter, Thousand Edges, Doombrand, Bloodquake (runtime bakes, no atlas art) ----
  // Earthsplitter fissure: the host's 'crack' zone with arc 1 (z.x, z.y, a, len, w) draws a dark earth crack that runs outward over its 0.25 s and flares pale as it is about to strike; its eruption is the 'fissure' event (dust column, rubble and a short shake along the line).
  const EARTH = '#b8a070', CRACK = '#1d130a';
  const crackAvalanche = CFX.zone.crack;
  CFX.zone.crack = (c, z, pass, t, k, view) => {
    if (!(z.arc > 0)) return crackAvalanche(c, z, pass, t, k, view);
    const g = Math.min(1, k * 2.2), n = Math.max(3, Math.round(z.len / 6)), cs = Math.cos(z.a), sn = Math.sin(z.a), flare = k > 0.6 && Math.floor(t * 30) % 2 === 0;
    const pt = (i) => { const d = i / n * z.len, j = jag(z, i, 4); return [z.x + cs * d - sn * j, z.y + sn * d * 0.8 + cs * j]; };
    if (pass === 0) {
      const m = Math.floor(n * g);
      c.globalAlpha = 0.9; c.fillStyle = '#120c07'; c.beginPath();
      for (let i = 0; i < m; i++) { const a = pt(i), b = pt(i + 1); Pix.line(c, a[0], a[1], b[0], b[1], 12 - Math.round(i / n * 6)); }
      c.fill(); c.globalAlpha = 1; c.fillStyle = flare ? PALE : CRACK; c.beginPath();
      for (let i = 0; i < m; i++) { const a = pt(i), b = pt(i + 1); Pix.line(c, a[0], a[1], b[0], b[1], 6 - Math.round(i / n * 2)); }
      c.fill(); c.fillStyle = flare ? '#ffffff' : '#6a4a22'; c.beginPath();
      for (let i = 0; i < m; i++) { const a = pt(i), b = pt(i + 1); Pix.line(c, a[0], a[1], b[0], b[1], 2); }
      c.fill();
    } else if (pass === 1 && k > 0.5) {
      for (let i = 3; i < n * g; i += 5) { const a = pt(i); ED.Render.glow(c, a[0], a[1], 18, flare ? PALE : '#c8a050', 0.3 * (k - 0.5) * 2); }
    }
  };
  CFX.on('fissure', (ev, ctx, local) => {
    const cs = Math.cos(ev.a), sn = Math.sin(ev.a), mine = ev.pid === local;
    for (let d = 14; d <= ev.len; d += 22) {
      const x = ev.x + cs * d, y = ev.y + sn * d;
      F.burst(x, y, 2, { kind: 'shard', color: EARTH, sp: 80, life: 0.5, size: 2.4, vz: 130, z: 2 });
      F.burst(x, y - 2, 2, { kind: 'streak', color: PALE, a: -Math.PI / 2, spread: 1, sp: 240, life: 0.22, size: 1.8 });
      if (d % 44 < 22) F.dust(x, y, 'dust', 2);
    }
    F.pop(ev.x + cs * ev.len * 0.5, ev.y + sn * ev.len * 0.5 - 4, 26, GOLD, 0.14);
    if (away(ctx, ev.x, ev.y) < 300) F.addShake(mine ? 2 : 0.8);
    ED.Audio.play('thud', mine ? 0.7 : 0.3); ED.Audio.play('heavy', mine ? 0.5 : 0.2);
  });

  // Thousand Edges wave (the 'blade' shot of the hero's team): a steel crescent, 24 wide, opening backwards, baked per heading step.
  const BLADE_LO = '#7f93ad', BLADE_MID = '#dff1ff';
  const bladeSprite = (R2, st) => Pix.bake('blade|' + R2 + '|' + st, 2 * R2 + 6, 2 * R2 + 6, R2 + 3, R2 + 3, (b, w) => {
    const S = 2 * R2 + 6, th = st / 32 * TAU, co = Math.cos(th), si = Math.sin(th), c0 = Pix.px32(BLADE_LO), c1 = Pix.px32(BLADE_MID), c2 = Pix.px32('#ffffff');
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = x + 0.5 - S / 2, py = y + 0.5 - S / 2, lx = px * co + py * si + 0.45 * R2, ly = -px * si + py * co, d = Math.hypot(lx, ly), ang = Math.atan2(ly, lx);
      if (d > R2 || d <= R2 - 4 || Math.abs(ang) > 1.15 - (R2 - d) * 0.12) continue;
      const band = R2 - d;
      b[y * w + x] = band < 1 ? c2 : band < 2 ? c1 : band < 3 ? c0 : Pix.px32('#3c4a5e');
    }
  });
  (CFX.shotBody || (CFX.shotBody = {})).blade = (c, pr, t, x, y, foe) => {
    if (foe) return false;
    Pix.put(c, bladeSprite(Math.max(6, Math.round(pr.r / 2) + 2), Math.round(Math.atan2(pr.vy, pr.vx) / TAU * 32) & 31), Pix.s2(x), Pix.s2(y));
    return true;
  };

  // Doombrand mark: a branded blood-red ring with an ember core in the overhead row of a Marked foe that holds 4 or more ailments while a Doombrand Knight is in the viewed party (the Marked crosshair of cls-ranger.js shows too).
  let brandOk = false, doomStamp = -1, doomHas = false;
  const BRAND = { id: 'fx.glyph.doombrand', ramp: '', stub: '' };
  function brandGlyph() {
    if (brandOk) return true;
    if (!ED.Atlas || !ED.Atlas.ok) return false;
    const cv = document.createElement('canvas'); cv.width = cv.height = 7;
    const g = cv.getContext('2d'), rows = ['..111..', '.12221.', '1223221', '1234321', '1223221', '.12221.', '..111..'], col = { 1: '#3c0610', 2: '#d43a3a', 3: '#ff7a6a', 4: '#ffe9a0' };
    for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) { const ch = rows[j][i]; if (ch === '.') continue; g.fillStyle = col[ch]; g.fillRect(i, j, 1, 1); }
    return (brandOk = Pix.define(BRAND.id, cv, 3, 3));
  }
  function partyDoom(v) {
    if (F.time !== doomStamp) { doomStamp = F.time; doomHas = false; for (const p of v.players.values()) if (p.cls === 'knight' && p.stats && p.stats.doombrand > 0) { doomHas = true; break; } }
    return doomHas;
  }
  CFX.mark.push((e) => {
    if (!(e.marked || e.mark > 0)) return null;
    const v = gview();
    if (!v || !partyDoom(v) || (e.ailN !== undefined ? e.ailN : v.ailments ? v.ailments(e) : 0) < 4) return null;
    return brandGlyph() ? BRAND : null;
  });

  // Bloodquake: the detonated foe bursts in a blood-red ring of the burst radius, a spray of droplets, a flash and a dull thud.
  CFX.on('bquake', (ev, ctx, local) => {
    const mine = ev.pid === local;
    F.ring(ev.x, ev.y, ev.r, '#d43a3a', 0.4, 4); F.ring(ev.x, ev.y, ev.r * 0.55, '#ff7a6a', 0.28, 2);
    F.burst(ev.x, ev.y, 12, { color: '#c8283a', sp: ev.r * 2.2, life: 0.5, size: 2.4, vz: 70, z: 2, drag: 2 });
    F.burst(ev.x, ev.y, 5, { kind: 'streak', color: '#ff9a8a', sp: 260, life: 0.2, size: 1.8 });
    F.pop(ev.x, ev.y, 30, '#ff5a5a', 0.2, true);
    SP('fx.circle.spark', ev.x, ev.y, { ramp: 'blood', add: true, speed: 1.2 });
    ED.Audio.play('thud', mine ? 0.8 : 0.35); ED.Audio.play('guardhit', mine ? 0.5 : 0.2);
    if (mine) F.addShake(2);
  });
})(globalThis.ED || (globalThis.ED = {}));
