// knight route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Events: ric (a shield strike), catch, parry, deflect (a shot swatted), ward (Rallying Charge) and the boom 'shock' of Juggernaut / Oathbreaker; hero hook: Brace plate, Hold the Line ring, catch glint, Riposte shimmer, Charge streaks;
// shot hook: the thrown shield's rim glint and the Shield Orbit ring. Everything is pixel art on the 2 px grid.
(function (ED) {
  'use strict';
  const CFX = ED.ClassFx, F = ED.FX, U = ED.U, Pix = ED.Pix, TAU = U.TAU, s2 = Pix.s2;
  const GOLD = '#ffd36b', PALE = '#fff3c4', STEEL = '#b8bec6';
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  const gview = () => (ED.Game && ED.Game.s ? ED.Game.s.view : null);
  const catchT = {}, castT = {}, parryT = {}, chargeEnd = {}; // by pid: world-effect clock of the last catch / throw / parry, and the path of the last Shield Charge { x, y, t0, t1 }

  function bossAt(x, y) {
    const v = gview(); if (!v) return false;
    for (const e of v.enemies) if (e.boss && Math.abs(e.x - x) < e.r + 24 && Math.abs(e.y - y) < e.r + 24) return true;
    return false;
  }
  const heroOf = (ctx, pid) => ctx.player(pid);

  // ---- Shield Throw ----
  // A strike: white-gold star, six metal sparks and a spark sprite at the shield, a gold line to the next foe, 45 ms hit-stop and a 2 px shake (3 px on a boss). A guarded strike is a grey spark and a dull clank.
  CFX.on('ric', (ev, ctx, local) => {
    const mine = ev.pid === local, x = ev.x0, y = ev.y0 - 4, A = ED.Audio;
    if (ev.g) {
      F.burst(x, y, 4, { kind: 'spark', color: STEEL, sp: 120, life: 0.2, size: 1.4, drag: 5 });
      SP('fx.hit.spark', x, y, { ramp: 'general', speed: 1.1 });
      A.play('clang', mine ? 0.8 : 0.4, { n: ev.n, g: 1 });
      return;
    }
    if (ev.x1 !== ev.x0 || ev.y1 !== ev.y0) F.bolts.push({ pts: [[ev.x0, ev.y0 - 4], [ev.x1, ev.y1 - 4]], life: 0.12, max: 0.12, color: '#ffe9a0', st: true });
    F.burst(x, y, 6, { kind: 'spark', color: '#ffe6a8', sp: 210, life: 0.25, size: 1.6, drag: 5 });
    F.pop(x, y, 16, PALE, 0.14, true);
    SP('fx.hit.spark', x, y, { ramp: 'gold', add: true, speed: 1.2, lt: GOLD, ltr: 34 });
    if (ev.n > 1) SP('fx.glint', x, y - 6, { ramp: 'holy', add: true, delay: 0.03 });
    A.play('clang', mine ? 0.9 : 0.45, { n: ev.n });
    if (mine) { F.hitStop(0.045); F.addShake(bossAt(x, y) ? 3 : 2); }
  });
  // The catch: gold ring and flash at the hero, a glint that lingers on the off-hand shield (hero hook), motes when it shields.
  CFX.on('catch', (ev, ctx, local) => {
    const mine = ev.pid === local;
    catchT[ev.pid] = F.time;
    F.ring(ev.x, ev.y - 4, 18, GOLD, 0.25, 3); F.pop(ev.x, ev.y - 4, 18, '#ffe9a0', 0.16);
    SP('fx.glint', ev.x, ev.y - 10, { ramp: 'holy', add: true, speed: 1.3 });
    if (ev.v > 0) { F.burst(ev.x, ev.y - 10, 6, { color: '#ffe9a0', sp: 40, vy: -40, life: 0.5, size: 1.8, add: true, drag: 1.5 }); F.ring(ev.x, ev.y - 4, 28, '#bfe3ff', 0.3, 2); }
    ED.Audio.play('catch', mine ? 0.9 : 0.4, ev.v > 0);
  });
  // A swatted shot: gold spark where the shield met it (the generic white burst follows).
  CFX.on('deflect', (ev) => {
    const v = gview(); if (!v) return;
    for (const pr of v.projs) if (pr.kind === 'shield' && pr.team === 0 && Math.abs(pr.x - ev.x) < 30 && Math.abs(pr.y - ev.y) < 30) {
      F.burst(ev.x, ev.y, 4, { kind: 'spark', color: '#ffe6a8', sp: 170, life: 0.2, size: 1.5, drag: 5 });
      SP('fx.hit.spark', ev.x, ev.y, { ramp: 'gold', add: true, speed: 1.4 });
      return;
    }
  });
  // The cast of a Shield Throw: a flash at the off hand; a Shield Charge: its path for the Rally / Juggernaut effects and speed streaks.
  CFX.on('skill', (ev, ctx) => {
    if (ev.k === 'shieldthrow') { castT[ev.pid] = F.time; SP('fx.glint', ev.x + Math.cos(ev.a || 0) * 10, ev.y - 14 + Math.sin(ev.a || 0) * 6, { ramp: 'holy', add: true, speed: 1.4 }); }
    else if (ev.k === 'charge') {
      const len = ev.tx !== undefined ? Math.hypot(ev.tx - ev.x, ev.ty - ev.y) : 100;
      chargeEnd[ev.pid] = { x: ev.tx !== undefined ? ev.tx : ev.x, y: ev.ty !== undefined ? ev.ty : ev.y, t0: F.time, t1: F.time + len / ED.CONST.CHARGE_SPEED };
      F.burst(ev.x, ev.y - 8, 8, { kind: 'streak', color: '#e8e2c8', a: (ev.a || 0) + Math.PI, spread: 0.5, sp: 220, life: 0.25, size: 1.8 });
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
    for (const q of view.players.values()) if (q !== p && q.braceT > 0 && q.stats && q.stats.braceAura && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 10000) return 2;
    return 0;
  }
  CFX.hero.push((c, p, t, low) => {
    if (p.cls !== 'knight' || p.dead) return;
    const st = p.stats, R = ED.Render, rp = Pix.ramp(GOLD), sg = Math.cos(p.face || 0) < 0 ? -1 : 1, view = gview();
    if (!p.downed) {
      const b = braced(p, view);
      if (b) { // feet planted: a dashed gold plate under the boots and a warm glow; Hold the Line adds the aura ring of radius 100
        const a = b === 1 ? 0.85 : 0.5, pulse = 0.85 + 0.15 * Math.sin(t * 6);
        Pix.put(c, Pix.ell(9, 4, GOLD, false, 3, (t * 5) & 7), 0, 2, a * pulse);
        Pix.put(c, Pix.ell(7, 3, GOLD, true), 0, 2, 0.12 * a);
        R.emit(p.x, p.y - 4, 22, GOLD, 0.16 * a * pulse);
        if (b === 1 && st && st.braceAura && !low) Pix.put(c, Pix.ring(50, 1, rp[2], rp[3], rp[3], 3, (t * 3) & 7), 0, 2, 0.25);
      }
      const ct = catchT[p.pid];
      if (ct !== undefined && F.time - ct < 0.45) { // glint on the shield: the sprite plays through its frames (sparkle at the rim)
        const age = F.time - ct, A = ED.Atlas, fr = A.frameAt('fx.glint', age);
        Pix.draw(c, 'fx.glint', 'holy', fr, -10 * sg, -17, 1 - age / 0.6);
      }
      const pt = parryT[p.pid];
      if (pt !== undefined && F.time - pt < 0.22) { const k = (F.time - pt) / 0.22; Pix.put(c, Pix.ell(8 + Math.round(k * 5), 4 + Math.round(k * 2), '#ffffff', false), 0, 2, 1 - k); R.emit(p.x, p.y - 10, 26, '#ffffff', 0.3 * (1 - k)); } // the Riposte flash: a white ring spreads from the boots
      const cs = castT[p.pid];
      if (cs !== undefined && F.time - cs < 0.15) { c.fillStyle = '#ffffff'; c.globalAlpha = 1 - (F.time - cs) / 0.15; c.fillRect(s2(-10 * sg) - 2, s2(-17) - 2, 6, 6); c.globalAlpha = 1; } // the shield leaves the hand in a white flash
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
      for (let i = -1; i <= 1; i++) { const ox = -cy * i * 8, oy = cx * i * 5, l0 = 12 + (i & 1) * 6, l1 = 26 - Math.abs(i) * 6; Pix.line(c, -cx * l0 + ox, -10 - cy * l0 * 0.6 + oy, -cx * (l0 + l1) + ox, -10 - cy * (l0 + l1) * 0.6 + oy, 2); }
      c.fill(); c.globalAlpha = 1;
    }
  });

  // ---- shot hook: the thrown shield ----
  // Rim glint: a white pixel circling the rim every other 80 ms; Shield Orbit (a shield circling its owner at about 307 px/s) also gets a dashed gold ring along its path.
  CFX.shot.shield = (c, pr, t, x, y) => {
    if (pr.team !== 0) return;
    if (Math.floor(t * 12.5 + (pr.id & 3)) & 1) { const a = t * 9 + pr.id, gx = x + Math.cos(a) * 9, gy = y + Math.sin(a) * 9; c.fillStyle = '#ffffff'; c.fillRect(s2(gx) - 1, s2(gy) - 1, 2, 2); }
    const sp = Math.hypot(pr.vx, pr.vy);
    if (sp > 270 && sp < 345) {
      const v = gview(); if (!v) return;
      let best = null, bd = 60 * 60;
      for (const p of v.players.values()) { if (p.cls !== 'knight' || !p.shieldOut || !p.stats || !(p.stats.orbit > 0)) continue; const d = U.dist2(p.x, p.y - 4, pr.x, pr.y); if (d < bd && d > 25 * 25) { bd = d; best = p; } } // only a Knight with Shield Orbit circles a shield
      if (best) { const rp = Pix.ramp(GOLD); Pix.put(c, Pix.ring(22, 1, rp[2], rp[3], rp[3], 3, (t * 4) & 7), s2(best.x), s2(best.y - 4), 0.3); }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
