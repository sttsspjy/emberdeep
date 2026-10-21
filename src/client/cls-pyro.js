// pyro route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Events of src/sim/class-pyro.js: pyAfter (aftershock queued), pyLava (a Lava Pool begins), pyEcho (Nova echo queued / erupting), pyPull (Collapse), pyMantle (Mantle shield), pyRebirth (Rebirth Flare),
// pyTwin (second Meteor queued), pyComet (Comet leap), pyFlash (Flashpoint crit), pyHeat (cooldown cut / Chain Reaction). Hero state shown from the hero hook: Channel heat, the echo ring, the Comet flight, the Mantle overlay.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, F = ED.FX, Pix = ED.Pix, CF = ED.ClassFx, N = ED.Net, s2 = Pix.s2, FIRE = Pix.RAMP.fire;
  const R = () => ED.Render, A = () => ED.Audio;
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  const lowFx = () => R().quality === 'low';

  // Events a busy fight can send many of per snapshot are capped like the built-in ones.
  Object.assign(N.CAPS, { pyAfter: 6, pyFlash: 6, pyLava: 4, pyPull: 2, pyEcho: 3, pyTwin: 3 });
  Object.assign(N.CAPS_LOCAL, { pyAfter: 3, pyFlash: 3, pyLava: 2, pyPull: 1, pyEcho: 2, pyTwin: 2 });

  // Per-hero client state: chan (Channel estimate for heroes whose sim value this viewer does not own), lastAtk (event clock), t (last frame), steps / full (Channel shown last frame), echo / comet (running timelines).
  const hs = {};
  const stateOf = (pid) => hs[pid] || (hs[pid] = { chan: 0, lastAtk: -9, t: 0, steps: 0, full: false, echo: null, comet: null, trail: 0, orb: 0 });
  CF.on('atk', (ev) => { stateOf(ev.pid).lastAtk = F.time; });

  const pick = (a) => a[(Math.random() * a.length) | 0];
  const wt = (ev, local, k) => (ev.pid === local ? 1 : k === undefined ? 0.45 : k); // sound weight: your own hero full, allies softer
  // Ground stain (the pixel blotches fx.js keeps in F.stains): same record as its private addStain.
  function stain(x, y, r, col, a, life) {
    if (F.stains.length >= 32) F.stains.shift();
    const W = U.clamp(Math.round(r * 1.8), 4, 44), v = (Math.random() * 3) | 0;
    F.stains.push({ x, y, r, key: 'st|' + col + '|' + v + '|' + W, col, v, W, a: a || 0.5, life: life || 6, max: life || 6 });
  }

  // ---------------- molten ground of a Lava Pool ----------------
  // 4 baked frames per radius: a dark crust over a Worley cell net, the cracks glowing red to yellow with a phase per cell; a ragged darker rim.
  function lavaSprite(rA, f) {
    const W = rA * 2, H = Math.max(4, Math.round(rA * 1.5));
    return Pix.bake('lava|' + rA + '|' + f, W, H, rA, H >> 1, (b, w, h) => {
      const crustA = Pix.px32('#1c0a06'), crustB = Pix.px32('#34100a'), g1 = Pix.px32('#b82c14'), g2 = Pix.px32('#ff7a2a'), g3 = Pix.px32('#ffc24a'), rim = Pix.px32('#0c0402'), cs = 4.5;
      const hx = (a, c) => Pix.hash(a * 12.9898 + c * 78.233 + rA * 3.1);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2), d = Math.hypot(dx, dy), n = Pix.hash(x * 7.3 + y * 3.1 + rA);
        if (d > 0.94 + (n - 0.5) * 0.2) continue;
        if (d > 0.82 + (n - 0.5) * 0.2) { b[y * w + x] = rim; continue; }
        const gx = Math.floor(x / cs), gy = Math.floor(y / cs);
        let f1 = 9, f2 = 9, id = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const cx = (gx + ox + hx(gx + ox, gy + oy)) * cs, cy = (gy + oy + hx(gy + oy + 5, gx + ox + 3)) * cs, dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (dd < f1) { f2 = f1; f1 = dd; id = (gx + ox) * 31 + (gy + oy); } else if (dd < f2) f2 = dd;
        }
        const edge = f2 - f1, br = 0.5 + 0.5 * Math.sin(f * 1.5708 + Pix.hash(id) * TAU);
        b[y * w + x] = edge < 0.9 ? (br > 0.66 ? g3 : br > 0.33 ? g2 : g1) : edge < 1.5 && br > 0.5 ? g1 : n > 0.55 ? crustB : crustA;
      }
    });
  }
  // Called by render.js for a pfire zone tagged as a Lava Pool: pass 0 the ground under the actors, pass 1 the same ground again additively (the cracks glow) with a halo and rising sparks.
  CF.lava = (c, z, pass, t) => {
    const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5), rA = Math.max(3, Math.round(z.r / 2)), f = ((t * 4) | 0) & 3, x = s2(z.x), y = s2(z.y);
    if (fade <= 0.01) return;
    if (pass === 0) { Pix.put(c, lavaSprite(rA, f), x, y, fade); R().light(z.x, z.y - 4, z.r * 2.4, '#ff5a1a', 0.9 * fade); return; }
    if (pass !== 1) return;
    Pix.put(c, lavaSprite(rA, f), x, y, 0.55 * fade);
    R().glow(c, z.x, z.y - 2, z.r * 1.5, '#ff4a10', 0.4 * fade);
    c.fillStyle = '#ffc24a';
    for (let i = 0; i < 3; i++) { const kk = (t * 0.9 + i / 3 + z.id * 0.17) % 1, a = i * 2.4 + z.id; c.globalAlpha = Math.max(0.25, Math.ceil((1 - kk) * 4) / 4) * fade; c.fillRect(s2(z.x + Math.cos(a) * z.r * 0.55), s2(z.y + Math.sin(a) * z.r * 0.3 - kk * 24), 2, 2); }
    c.globalAlpha = 1;
  };

  // ---------------- the hero in the air (Comet) ----------------
  // Lift in world px (whole art px) of a hero on its Comet arc; render.js translates the hero sprite by it. Zero when no flight runs.
  CF.lift = (p) => {
    const s = hs[p.pid], cm = s && s.comet;
    if (!cm) return (p.lift = 0);
    const k = (F.time - cm.t0) / cm.d;
    if (k >= 1 || k < 0) { if (k >= 1) s.comet = null; return (p.lift = 0); }
    return (p.lift = Math.round(Math.sin(k * Math.PI) * 17) * 2);
  };

  // ---------------- hero hook ----------------
  // One pixel flame tongue standing at (x, y) (world px, on the 2 px grid): rows of the fire ramp, widest at the base; hot = white tip.
  function tongue(c, x, y, rows, hot, wide) {
    const rp = FIRE;
    c.fillStyle = rp[1]; c.fillRect(x - (wide ? 3 : 2), y - 2, wide ? 6 : 4, 2);
    c.fillStyle = rp[2]; c.fillRect(x - 2, y - 4, 4, 2); if (wide) { c.fillStyle = rp[3]; c.fillRect(x - 1, y - 4, 2, 2); }
    if (rows >= 3) { c.fillStyle = rp[3]; c.fillRect(x - 1, y - 6, 2, 2); }
    if (rows >= 4) { c.fillStyle = hot ? rp[4] : rp[3]; c.fillRect(x - 1, y - 8, 2, 2); }
  }

  // Channel: the hero's heat, one flame tongue per step in a crown over the head, a glow and a dashed ring at the feet that grow to the cap; a full cap blazes white; losing it snaps a burst of embers.
  function channel(c, p, st, s, t, dt, low) {
    if (!(st.channel > 0)) { s.steps = 0; s.full = false; return; }
    const ch = typeof p.chanT === 'number' ? p.chanT : (s.chan = !p.moving && F.time - s.lastAtk < ED.chanWindow(p) ? s.chan + dt : 0);
    const max = Math.max(1, Math.round(st.chanCap / st.channel)), steps = Math.min(max, Math.floor(ch / Math.max(0.05, st.chanStep))), fr = steps / max, full = steps >= max;
    const mine = R() && p.pid === R().local;
    if (s.steps >= 2 && steps === 0) { // the heat is lost
      F.burst(p.x, p.y - 16, 4 + 2 * s.steps, { kind: 'ember', color: '#ff9a3a', a: -1.57, spread: 3.4, sp: 70, life: 0.7, size: 2, drag: 1.3, lt: '#ff8a2a', ltr: 22 });
      F.ring(p.x, p.y - 6, 20 + 3 * s.steps, '#ff7a2a', 0.25, 2);
      SP('fx.puff', p.x, p.y - 18, { ramp: 'smoke', a: 0.7 });
      if (mine && s.steps >= 3) A().play('fire', 0.25);
    }
    if (full && !s.full) { // the cap: a flare (Overheat: a blast of light)
      F.ring(p.x, p.y - 8, st.overheat ? 34 : 24, '#ffc24a', 0.35, 3);
      F.pop(p.x, p.y - 16, st.overheat ? 28 : 20, '#fff4c0', 0.22, true);
      SP('fx.spark.magic', p.x, p.y - 14, { ramp: 'fire', add: true, a: 0.9 });
      if (st.overheat) { SP('fx.blast.red', p.x, p.y - 12, { add: true, a: 0.8 }); F.burst(p.x, p.y - 14, 10, { kind: 'spark', color: '#ffe9a0', sp: 150, life: 0.3, size: 1.5, drag: 4 }); }
      if (mine) A().play(st.overheat ? 'skill' : 'magic', 0.5);
    }
    s.steps = steps; s.full = full;
    if (steps <= 0) return;
    const an = R().actorAnchor(p), top = s2(an ? an.top : -26), rp = FIRE;
    Pix.put(c, Pix.ell(8, 4, rp[2], false, 2, (t * 8) & 7), 0, 2, 0.2 + 0.55 * fr);
    const tg = low ? Math.min(steps, 3) : steps, hot = full ? 1 : 0;
    for (let i = 0; i < tg; i++) {
      const th = -Math.PI + (i + 0.5) / Math.max(tg, 1) * Math.PI, x = s2(Math.cos(th) * 11 * (0.7 + 0.3 * fr)), y = s2(top + 8 + Math.sin(th) * 6);
      const rows = 2 + Math.floor(Pix.hash(i * 3.7 + Math.floor(t * 9)) * (full ? 3 : 2.4));
      tongue(c, x, y, Math.min(4, rows + (fr >= 0.6 ? 1 : 0)), hot, fr >= 0.6);
    }
    if (full) { c.fillStyle = rp[4]; for (let i = 0; i < 3; i++) { const a = t * 3 + i * TAU / 3; c.fillRect(s2(Math.cos(a) * 13), s2(top + 12 + Math.sin(a) * 6), 2, 2); } }
    R().emit(p.x, p.y + top * 0.55, 16 + 20 * fr, '#ff7a2a', 0.2 + 0.45 * fr);
    R().light(p.x, p.y - 14, 36 + 40 * fr, '#ff8a2a', 0.2 + 0.5 * fr);
  }

  // Twin Nova: a dotted ring closing on the hero over the echo's delay (it erupts where the hero then stands).
  function echoRing(c, p, s, t) {
    const e = s.echo; if (!e) return;
    const k = (F.time - e.t0) / e.d;
    if (k >= 1.1 || k < 0) { if (k >= 1.1) s.echo = null; return; }
    const rr = e.r * (1 - 0.7 * U.clamp(k, 0, 1)), ra = Math.max(2, Math.round(rr / 2));
    Pix.put(c, Pix.ring(ra, 2, FIRE[2], FIRE[3], FIRE[4], 4, (t * 6) & 7), 0, 0, 0.45 + 0.55 * U.clamp(k, 0, 1));
  }

  // Comet: the shadow stays on the ground while the hero arcs; a tail of fire streams back along the leap and embers fall from the body.
  function flight(c, p, s, t, low) {
    const cm = s.comet; if (!cm) return;
    const k = (F.time - cm.t0) / cm.d;
    if (k >= 1 || k < 0) return;
    const lift = p.lift || 0, ux = cm.tx - cm.x0, uy = cm.ty - cm.y0, ul = Math.hypot(ux, uy) || 1, dx = ux / ul, dy = uy / ul;
    R().shadow(c, 10, 0.4 * (1 - 0.45 * Math.sin(k * Math.PI)));
    for (let j = 1; j <= (low ? 3 : 6); j++) { // tail: squares along the way back, the fire ramp fading with distance
      const q = j * 6, a = Math.max(0.25, Math.ceil((1 - j / 7) * 4) / 4);
      c.globalAlpha = a; c.fillStyle = FIRE[Math.max(1, 4 - (j >> 1))];
      const sz = j < 3 ? 6 : 4;
      c.fillRect(s2(-dx * q * 1.2 - sz / 2), s2(-dy * q * 0.8 - lift - 12 - sz / 2), sz, sz);
    }
    c.globalAlpha = 1;
    R().emit(p.x, p.y - lift - 12, 28, '#ff7a2a', 0.65); R().light(p.x, p.y - lift - 12, 90, '#ff8a2a', 0.8);
    if (t - s.trail > (low ? 0.06 : 0.03)) {
      s.trail = t;
      F.part(p.x - dx * 6 + (Math.random() - 0.5) * 6, p.y - lift - 12, { kind: 'ember', color: pick([FIRE[2], FIRE[3], FIRE[4]]), a: -1.57, spread: 3.2, sp: 24, life: 0.5, size: 2, lt: '#ff8a2a', ltr: 22, drag: 1.2 });
      if (!low) F.part(p.x - dx * 10, p.y - lift - 10, { kind: 'spark', color: '#ffe9a0', a: Math.atan2(-dy, -dx), spread: 1, sp: 90, life: 0.22, size: 1.4, drag: 4 });
    }
  }

  // Phoenix Mantle: the shield bubble reads gold-orange with a ring of fire turning around it and embers rising off it.
  function mantleOverlay(c, p, st, t, low) {
    if (!(st.mantle > 0) || !(p.shield > 0)) return;
    F.holyT[p.pid] = F.time + 0.15; // the built-in bubble turns gold while this is set
    const fr = U.clamp(p.shield / Math.max(1, p.maxHp * 0.12), 0.15, 1), rx = 6 + Math.round(4 * fr), ry = Math.round(rx * 1.2), an = R().actorAnchor(p), cyh = s2(an ? an.cy : -12);
    Pix.put(c, Pix.ell(rx + 2, ry + 2, FIRE[2], false, 2, (t * 6) & 7), 0, cyh, 0.55 + 0.25 * fr);
    if (low) return;
    c.fillStyle = FIRE[3];
    for (let i = 0; i < 3; i++) { const kk = (t * 0.8 + i / 3) % 1, a = i * 2.1 + t * 1.5; c.globalAlpha = Math.max(0.25, Math.ceil((1 - kk) * 4) / 4); c.fillRect(s2(Math.cos(a) * (rx + 1)), s2(cyh + ry - kk * (ry * 2 + 6)), 2, 2); }
    c.globalAlpha = 1;
  }

  CF.hero.push((c, p, t, low) => {
    const st = p.stats;
    if (p.cls !== 'pyro' || !st || p.dead) return;
    const s = stateOf(p.pid), dt = U.clamp(t - s.t, 0, 0.1);
    s.t = t;
    if (p.downed) { s.steps = 0; s.full = false; return; }
    channel(c, p, st, s, t, dt, low);
    echoRing(c, p, s, t);
    flight(c, p, s, t, low);
    mantleOverlay(c, p, st, t, low);
  });

  // ---------------- events ----------------
  // Aftershock queued: a spark circle spans the delay at the blast, a ring closes on it, embers lift off the ground and a scorch mark stays.
  CF.on('pyAfter', (ev, ctx, local) => {
    const m = ev.pid === local;
    SP('fx.circle.spark', ev.x, ev.y - 2, { ramp: 'fire', add: true, a: m ? 0.9 : 0.55 });
    F.ring(ev.x, ev.y, Math.max(16, ev.r), '#ff7a2a', ev.d, 2, true);
    F.burst(ev.x, ev.y, 3, { kind: 'ember', color: '#ff9a3a', a: -1.57, spread: 3, sp: 26, life: 0.5, size: 1.6, drag: 1.2 });
    stain(ev.x, ev.y, ev.r * 0.55, '#1c0a06', 0.55, 4);
  });
  // Magma blast (the aftershock): chunks of molten rock fly out and embers rise, with a heavy thud under the boom.
  CF.on('boom', (ev, ctx, local) => {
    if (ev.k !== 'magma') return;
    F.burst(ev.x, ev.y, 7, { kind: 'shard', color: '#ff6a1a', sp: ev.r * 2.2, life: 0.7, size: 2.8, vz: 110, z: 6, add: true });
    F.burst(ev.x, ev.y, 6, { kind: 'ember', color: '#ffb347', a: -1.57, spread: 3.4, sp: 70, life: 0.9, size: 2, drag: 1.3, lt: '#ff8a2a', ltr: 22 });
    SP('fx.glint', ev.x, ev.y - 6, { ramp: 'fire', add: true, speed: 1.2 });
    stain(ev.x, ev.y, ev.r * 0.7, '#120503', 0.7, 8);
    A().play('thud', 0.3);
  });
  CF.on('pyLava', (ev) => {
    F.burst(ev.x, ev.y, 4, { kind: 'ember', color: '#ff7a2a', a: -1.57, spread: 3.4, sp: 40, life: 0.8, size: 2, drag: 1.3, lt: '#ff6a1a', ltr: 22 });
    SP('fx.puff', ev.x, ev.y - 4, { ramp: 'dust', a: 0.6 });
  });

  // Twin Nova: the echo is announced by the ring closing on the hero; Collapse sucks streaks in; the second eruption is a thinner, paler ring.
  CF.on('pyEcho', (ev, ctx, local) => {
    const s = stateOf(ev.pid), m = ev.pid === local;
    if (!ev.go) { s.echo = { t0: F.time, d: ev.d, r: ev.r }; return; }
    s.echo = null;
    F.ring(ev.x, ev.y, ev.r, '#ffb347', 0.4, 2); F.ring(ev.x, ev.y, ev.r * 0.6, '#fff4c0', 0.28, 1);
    F.burst(ev.x, ev.y, 14, { color: '#ff9a3a', sp: ev.r * 2.2, life: 0.4, size: 3, add: true });
    F.pop(ev.x, ev.y - 6, ev.r * 0.3, '#ffb347', 0.16);
    SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'fire', a: 0.7 });
    for (let i = 0, k = lowFx() ? 5 : 10; i < k; i++) { const a = i * TAU / k + 0.3, d = ev.r * 0.85; SP('fx.ember', ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d * 0.7 - 4, { delay: 0.04 + i * 0.012, vy: -14, add: false, lt: '#ff8a2a', ltr: 24 }); }
    if (m) F.addShake(2);
    A().play('boom', m ? 0.4 : 0.2);
  });
  CF.on('pyPull', (ev, ctx, local) => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n + Math.random() * 0.3, d = ev.r * (0.75 + Math.random() * 0.25);
      F.part(ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d * 0.7 - 6, { kind: 'streak', color: '#ffb347', a: a + Math.PI, spread: 0.05, sp: Math.min(ev.px * 6, d / 0.16), life: 0.17, size: 2, drag: 0 });
    }
    F.ring(ev.x, ev.y, ev.r, '#fff4c0', 0.16, 2, true);
    A().play('dash', ev.pid === local ? 0.45 : 0.2);
  });

  // Phoenix Mantle: the built-in blue bubble pop is replaced by a gold-orange one with rising feathers of fire.
  CF.on('shielded', (ev, ctx) => {
    const p = ctx.player(ev.pid);
    if (ev.k === 'class' && p && p.stats && p.stats.mantle > 0) (F.shieldT || (F.shieldT = {}))[ev.pid] = F.time;
  });
  CF.on('pyMantle', (ev, ctx, local) => {
    const p = ctx.player(ev.pid); if (!p) return;
    const m = ev.pid === local;
    SP('fx.shield.gold', p.x, p.y - 12, { ramp: 'fire', a: m ? 1 : 0.7, pid: ev.pid, fdy: -12 });
    SP('fx.circle.spark', p.x, p.y - 4, { ramp: 'fire', add: true, a: 0.8 });
    F.ring(p.x, p.y - 6, 22, '#ffb347', 0.4, 3);
    for (let i = 0; i < 6; i++) { const side = i & 1 ? 1 : -1; F.part(p.x + side * 4, p.y - 14, { kind: 'shard', color: pick([FIRE[2], FIRE[3]]), a: -1.57 + side * (0.5 + i * 0.12), spread: 0.4, sp: 70, life: 0.7, size: 2.4, add: true, vz: 40, z: 6, drag: 1.4 }); }
    F.pop(p.x, p.y - 14, 22, '#ffc24a', 0.22);
    A().play('heal', m ? 0.4 : 0.2); A().play('fire', m ? 0.35 : 0.15);
  });
  // Rebirth Flare: a phoenix of fire opens its wings from the hero, knocking the room back.
  CF.on('pyRebirth', (ev, ctx, local) => {
    const m = ev.pid === local, r = ev.r;
    F.ring(ev.x, ev.y, r, '#ff7a2a', 0.45, 5); F.ring(ev.x, ev.y, r * 0.65, '#fff4c0', 0.3, 3);
    F.burst(ev.x, ev.y - 8, 24, { color: '#ffb347', sp: r * 2.4, life: 0.5, size: 3, add: true });
    F.burst(ev.x, ev.y - 12, 12, { kind: 'streak', color: '#fff4c0', sp: r * 3, life: 0.3, size: 1.8 });
    for (let i = 0; i < 10; i++) { const side = i & 1 ? 1 : -1; F.part(ev.x, ev.y - 12, { kind: 'shard', color: pick([FIRE[2], FIRE[3], FIRE[4]]), a: -0.35 + (side < 0 ? Math.PI + 0.7 : 0), spread: 1.1, sp: 120 + Math.random() * 60, life: 0.7, size: 2.8, add: true, vz: 50, z: 8, drag: 2 }); }
    SP('fx.blast.red', ev.x, ev.y - 8, { add: true, lt: '#ff8a4a', ltr: 80 }); SP('fx.explosion', ev.x, ev.y - 6, { ramp: 'gold' }); SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'fire' });
    F.pop(ev.x, ev.y - 12, r * 0.7, '#ffe9a0', 0.3, true); F.punch(0.6, 0.3); if (m) F.addShake(4);
    A().play('combust', m ? 0.8 : 0.4); A().play('boon', m ? 0.3 : 0.15);
  });

  // Twin Meteor: an ember line links the first impact to the second target.
  CF.on('pyTwin', (ev, ctx, local) => {
    F.bolts.push({ pts: [[ev.x0, ev.y0], [ev.x1, ev.y1]], life: 0.35, max: 0.35, color: '#ffb347', st: true }); if (F.bolts.length > 24) F.bolts.shift();
    F.ring(ev.x1, ev.y1, 40, '#ff7a2a', ev.d, 2, true);
    F.pop(ev.x0, ev.y0, 16, '#ffb347', 0.16);
  });

  // Comet: the hero leaves the ground in a burst of fire and a rush of air.
  CF.on('pyComet', (ev, ctx, local) => {
    const s = stateOf(ev.pid), m = ev.pid === local;
    s.comet = { t0: F.time, d: ev.d, x0: ev.x, y0: ev.y, tx: ev.tx, ty: ev.ty };
    SP('fx.blast.red', ev.x, ev.y - 6, { add: true, lt: '#ff8a4a', ltr: 70 });
    F.ring(ev.x, ev.y, 26, '#ff7a2a', 0.3, 3); F.burst(ev.x, ev.y - 6, 12, { kind: 'streak', color: '#ffb347', a: Math.atan2(ev.ty - ev.y, ev.tx - ev.x) + Math.PI, spread: 1.4, sp: 220, life: 0.25, size: 1.8 });
    F.dust(ev.x, ev.y + 2, 'dust', 2);
    A().play('dash', m ? 0.8 : 0.4); A().play('fire', m ? 0.6 : 0.3);
  });

  // Flashpoint: a forced crit on a burning foe flares white-hot.
  CF.on('pyFlash', (ev, ctx, local) => {
    const m = ev.pid === local;
    F.pop(ev.x, ev.y, 18, '#fff4c0', 0.2, true);
    F.burst(ev.x, ev.y, 6, { kind: 'spark', color: '#ffe9a0', sp: 190, life: 0.25, size: 1.5, drag: 5 });
    SP('fx.hit.spark', ev.x, ev.y, { add: true, ramp: 'fire' });
    A().play('deflect', m ? 0.3 : 0.12);
  });

  // Heat Engine: embers run up from the hero and the cut slot pulses; a Chain Reaction names itself and rings.
  CF.on('pyHeat', (ev, ctx, local) => {
    const p = ctx.player(ev.pid); if (!p) return;
    const m = ev.pid === local, g = ED.Game && ED.Game.s, ctl = g && g.ctl;
    const cooling = !ctl || !m || (ev.slot === 1 ? ctl.skill2Cd > 0.05 : ctl.charges < g.me.stats.maxCharges);
    if (m && cooling && ED.HUD && ED.HUD.flashSlot) ED.HUD.flashSlot(ev.slot, ev.full ? 0.7 : 0.35);
    F.burst(p.x, p.y - 18, ev.full ? 14 : Math.min(8, 2 + ev.n), { kind: 'ember', color: '#ffb347', a: -1.57, spread: 1.2, sp: 90, life: 0.6, size: 1.8, drag: 1.1, lt: '#ff8a2a', ltr: 18 });
    if (ev.full) {
      F.ring(p.x, p.y - 8, 34, '#ffc24a', 0.4, 3); F.pop(p.x, p.y - 14, 24, '#fff4c0', 0.22, true); SP('fx.circle.spark', p.x, p.y - 4, { ramp: 'gold', add: true });
      if (m) F.text(p.x, p.y - 40, 'Chain Reaction', '#ffc24a', 10, { pop: true, life: 1.1, max: 1.1 });
      A().play('level', m ? 0.35 : 0.15);
    } else A().play('click', m ? 0.5 : 0.2);
  });
})(globalThis.ED || (globalThis.ED = {}));
