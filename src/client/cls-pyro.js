// pyro route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Events of src/sim/class-pyro.js: pyAfter (aftershock queued), pyLava (a Lava Pool begins), pyEcho (Nova echo queued / erupting), pyPull (Collapse), pyMantle (Mantle shield), pyRebirth (Rebirth Flare),
// pyTwin (second Meteor queued), pyComet (Comet leap), pyFlash (Flashpoint crit), pyHeat (cooldown cut / Chain Reaction). Hero state shown from the hero hook: Channel heat, the echo ring, the Comet flight, the Mantle overlay.
// Skill forms: pyWave (Supernova front; sparks ride it from the hero hook), pyPull with sn (its collapse), pyPhoenix and the Phoenix ring zone (pfire tag 10: orbiting flames), pyStorm and pyField (Cataclysm cast and lava field, the big look of CF.lava),
// pyComet with sd and pyDive (Sun Dive: a golden flight with rays, a golden landing).
// Route forms: pyGeyser (Caldera: the geyser column and the widened Lava Pool), pyRing (Fire Dancer: the ring of flame where a dash began; the Channel crown trails sparks while the hero moves),
// White Flame (white sparks rise from foes the hero's Burn has held for whiteT seconds, estimated from the foe's burning flag, plus a white flame glyph in their mark row),
// pyEng (Inferno Engine: n / mx the Heat count, shown as embers circling the hero; go 1 an Inferno cast: a Nova blast at the hero, or a Meteor's heated telegraph (k 1); go 2 the Meteor landing).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, F = ED.FX, Pix = ED.Pix, CF = ED.ClassFx, N = ED.Net, s2 = Pix.s2, FIRE = Pix.RAMP.fire;
  const R = () => ED.Render, A = () => ED.Audio;
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  const lowFx = () => R().quality === 'low';

  // Events a busy fight can send many of per snapshot are capped like the built-in ones.
  Object.assign(N.CAPS, { pyAfter: 6, pyFlash: 6, pyLava: 4, pyPull: 2, pyEcho: 3, pyTwin: 3, pyWave: 3, pyPhoenix: 3, pyStorm: 3, pyField: 3, pyDive: 4, pyGeyser: 6, pyRing: 3, pyEng: 4 });
  Object.assign(N.CAPS_LOCAL, { pyAfter: 3, pyFlash: 3, pyLava: 2, pyPull: 1, pyEcho: 2, pyTwin: 2, pyWave: 2, pyPhoenix: 2, pyStorm: 2, pyField: 2, pyDive: 2, pyGeyser: 3, pyRing: 2, pyEng: 2 });

  // Per-hero client state: chan (Channel estimate for heroes whose sim value this viewer does not own), lastAtk (event clock), t (last frame), steps / full (Channel shown last frame), echo / comet (running timelines),
  // cmUp (the hero's cometT was positive last frame), predAt (F.time a Comet arc was started from the local cast, so the host's pyComet of that cast is not played twice),
  // heat / heatMax / heatAt (Inferno Engine: the Heat count of the last pyEng and when it came; it counts as 0 once no event has refreshed it for 3.5 s).
  const hs = {};
  const stateOf = (pid) => hs[pid] || (hs[pid] = { chan: 0, lastAtk: -9, t: 0, steps: 0, full: false, echo: null, comet: null, trail: 0, orb: 0, cmUp: false, predAt: -9, heat: 0, heatMax: 0, heatAt: -9 });
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
    const big = z.r > 100, ns = big ? (lowFx() ? 6 : 14) : 3; // the Cataclysm field (r140): a pulsing rim and many more sparks
    if (big) { Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 2, FIRE[1], FIRE[3], FIRE[4], 4, (t * 5) & 7), x, y, (0.55 + 0.25 * Math.sin(t * 6)) * fade); R().emit(z.x, z.y - 4, z.r * 0.9, '#ff5a1a', 0.12 * fade); }
    for (let i = 0; i < ns; i++) { const kk = (t * 0.9 + i / ns + z.id * 0.17) % 1, a = i * 2.4 + z.id; c.globalAlpha = Math.max(0.25, Math.ceil((1 - kk) * 4) / 4) * fade; c.fillRect(s2(z.x + Math.cos(a) * z.r * 0.55), s2(z.y + Math.sin(a) * z.r * 0.3 - kk * (big ? 40 : 24)), 2, 2); }
    c.globalAlpha = 1;
  };

  // ---------------- the hero in the air (Comet) ----------------
  // Lift in world px (whole art px) of a hero on its Comet arc; render.js translates the hero sprite and its body effects by it (p.lift). Zero when no flight runs.
  // A joined client's own hero starts its arc on the rising edge of the cometT its cast set locally (game.js), from the leap in p.skillMove, instead of waiting a round trip for the host's pyComet.
  CF.lift = (p) => {
    let s = hs[p.pid];
    if (p.cls === 'pyro' && R() && p.pid === R().local) {
      s = stateOf(p.pid);
      const up = p.cometT > 0;
      if (up && !s.cmUp && !s.comet) predict(p, s);
      s.cmUp = up;
    }
    const cm = s && s.comet;
    if (!cm) return (p.lift = 0);
    const k = (F.time - cm.t0) / cm.d;
    if (k >= 1 || k < 0) { if (k >= 1) s.comet = null; return (p.lift = 0); }
    return (p.lift = Math.round(Math.sin(k * Math.PI) * (cm.sd ? 24 : 17)) * 2);
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
    const ch = typeof p.chanT === 'number' ? p.chanT : (s.chan = F.time - s.lastAtk < ED.chanWindow(p) ? (!p.moving ? s.chan + dt : st.fireDance > 0 ? s.chan : 0) : 0);
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
    if (mine && steps > s.steps && !full) A().play('magic', 0.08 + 0.04 * steps); // a soft tick per step, louder as the heat builds (the cap has its own flare sound)
    s.steps = steps; s.full = full;
    if (steps <= 0) return;
    if (st.fireDance > 0 && p.moving && !low && Math.random() < 0.35) F.part(p.x + (Math.random() - 0.5) * 8, p.y - 2, { kind: 'ember', color: pick([FIRE[2], FIRE[3], FIRE[4]]), a: -1.57, spread: 1.2, sp: 30, life: 0.45, size: 2, drag: 1.4, lt: '#ff8a2a', ltr: 14 }); // Fire Dancer: the held heat sheds sparks as the hero moves
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
    Pix.put(c, Pix.ring(ra, e.k ? 3 : 2, FIRE[2], FIRE[3], FIRE[4], 4, (t * 6) & 7), 0, 0, 0.45 + 0.55 * U.clamp(k, 0, 1));
    if (e.k) { // Supernova: the gathering star - a second, white-hot ring and a glow that swells toward the burst
      Pix.put(c, Pix.ring(Math.max(2, Math.round(rr * 0.55 / 2)), 2, FIRE[3], FIRE[4], '#ffffff', 4, (-t * 8) & 7), 0, 0, 0.5 + 0.5 * U.clamp(k, 0, 1));
      R().light(p.x, p.y - 8, 40 + 90 * U.clamp(k, 0, 1), '#ffd36b', 0.3 + 0.5 * U.clamp(k, 0, 1)); R().emit(p.x, p.y - 8, 20 + 40 * U.clamp(k, 0, 1), '#ffb347', 0.2 + 0.5 * U.clamp(k, 0, 1));
    }
  }

  // Comet: the shadow stays on the ground while the hero arcs; a tail of fire streams back along the leap and embers fall from the body.
  function flight(c, p, s, t, low) {
    const cm = s.comet; if (!cm) return;
    const k = (F.time - cm.t0) / cm.d;
    if (k >= 1 || k < 0) return;
    const lift = p.lift || 0, ux = cm.tx - cm.x0, uy = cm.ty - cm.y0, ul = Math.hypot(ux, uy) || 1, dx = ux / ul, dy = uy / ul, sun = !!cm.sd;
    R().shadow(c, sun ? 13 : 10, 0.4 * (1 - 0.45 * Math.sin(k * Math.PI)));
    for (let j = 1; j <= (low ? 3 : sun ? 10 : 6); j++) { // tail: squares along the way back, the fire ramp fading with distance (Sun Dive: longer, wider, whiter)
      const q = j * 6, a = Math.max(0.25, Math.ceil((1 - j / (sun ? 11 : 7)) * 4) / 4);
      c.globalAlpha = a; c.fillStyle = sun && j < 5 ? '#fff4c0' : FIRE[Math.max(1, 4 - (j >> 1))];
      const sz = j < 3 ? (sun ? 8 : 6) : 4;
      c.fillRect(s2(-dx * q * 1.2 - sz / 2), s2(-dy * q * 0.8 - lift - 12 - sz / 2), sz, sz);
    }
    c.globalAlpha = 1;
    if (sun) { // the sun: a bright core, eight rays turning round it and a wide golden light
      const cy = s2(-lift - 12), rot = t * 5;
      Pix.put(c, Pix.orb(5, FIRE[1], FIRE[3], FIRE[4], '#ffffff'), 0, cy, 0.95);
      c.fillStyle = '#ffe9a0';
      for (let i = 0; i < 8; i++) { const a = rot + i * TAU / 8, l = 9 + (i & 1) * 5; c.globalAlpha = 0.9; c.fillRect(s2(Math.cos(a) * l) - 1, cy + s2(Math.sin(a) * l) - 1, 2, 2); c.fillRect(s2(Math.cos(a) * (l + 5)) - 1, cy + s2(Math.sin(a) * (l + 5)) - 1, 2, 2); }
      c.globalAlpha = 1;
      R().emit(p.x, p.y - lift - 12, 44, '#ffd36b', 0.8); R().light(p.x, p.y - lift - 12, 150, '#ffc24a', 1);
    } else { R().emit(p.x, p.y - lift - 12, 28, '#ff7a2a', 0.65); R().light(p.x, p.y - lift - 12, 90, '#ff8a2a', 0.8); }
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
    const fr = U.clamp(p.shield / Math.max(1, p.maxHp * 0.12), 0.15, 1), rx = 6 + Math.round(4 * fr), ry = Math.round(rx * 1.2), an = R().actorAnchor(p), cyh = s2((an ? an.cy : -12) - (p.lift || 0)); // the body rides the Comet's lift
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
    heatOrbit(c, p, st, s, t, low);
    if (st.whiteHot > 0) whiteFlames(p, st, low);
    if (waves.length) waveFx(p, low);
    if (st.phoenixMul > 0 && !low) phoenixEmbers(p); // Phoenix Form: sparks lift off the ring that follows the hero
  });
  function phoenixEmbers(p) {
    const g = ED.Game && ED.Game.s, v = g && g.view;
    if (!v || Math.random() > 0.6) return;
    for (const z of v.zones) {
      if (z.w !== 10 || !(z.fol === (p.slot | 0) + 1 || z.owner === p.pid)) continue;
      const a = Math.random() * TAU;
      F.part(z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r * 0.92 - 4, { kind: 'ember', color: pick([FIRE[2], FIRE[3], FIRE[4]]), a: -1.57, spread: 1.2, sp: 38, life: 0.8, size: 2, drag: 1.3, lt: '#ff8a2a', ltr: 18 });
    }
  }

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
    if (!ev.go) { s.echo = { t0: F.time, d: ev.d, r: ev.r, k: ev.k }; return; }
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
    if (ev.sn) { // Supernova's collapse: the whole field implodes - a white flash on the centre, a second shrinking ring, sparks pulled in
      F.ring(ev.x, ev.y, ev.r * 0.7, '#ffb347', 0.22, 4, true); F.pop(ev.x, ev.y - 8, ev.r * 0.35, '#ffffff', 0.22, true);
      F.burst(ev.x, ev.y - 6, 14, { color: '#ffe9a0', sp: ev.r * 1.4, life: 0.25, size: 2.4, add: true, drag: 3 });
      if (ev.pid === local) { F.addShake(4); F.punch(0.8, 0.3); }
    }
    A().play(ev.sn ? 'implode' : 'dash', ev.pid === local ? 0.45 : 0.2);
  });

  // ---------------- Supernova ----------------
  // The wave: three rings grow in step with the sim's front (linear from the Nova's radius to the full one), a white flash on the centre and a burst of embers; the hero hook then scatters sparks on the front each frame.
  const waves = [];
  CF.on('pyWave', (ev, ctx, local) => {
    const m = ev.pid === local;
    waves.push({ pid: ev.pid, x: ev.x, y: ev.y, r0: ev.r0, r1: ev.r1, t0: F.time, d: ev.d });
    if (waves.length > 8) waves.shift();
    F.ring(ev.x, ev.y, ev.r1, '#fff4c0', ev.d, 6, false, ev.r0); F.ring(ev.x, ev.y, ev.r1 * 0.93, '#ffb347', ev.d, 4, false, ev.r0 * 0.93); F.ring(ev.x, ev.y, ev.r1 * 0.85, '#ff7a2a', ev.d, 3, false, ev.r0 * 0.85);
    F.pop(ev.x, ev.y - 8, ev.r0 * 0.9, '#fff4c0', 0.32, true);
    SP('fx.blast.red', ev.x, ev.y - 8, { add: true, lt: '#ffd36b', ltr: ev.r1 }); SP('fx.explosion', ev.x, ev.y - 6, { ramp: 'gold' });
    F.burst(ev.x, ev.y - 6, lowFx() ? 16 : 34, { color: '#ffe9a0', sp: ev.r1 * 1.7, life: 0.5, size: 3, add: true }); F.burst(ev.x, ev.y - 8, 12, { kind: 'streak', color: '#ffffff', sp: ev.r1 * 2.4, life: 0.3, size: 1.8 });
    F.punch(1.1, 0.7); if (m) { F.addShake(8); F.hitStop(0.07); F.flash = { color: '#ffe9a0', t: 0.25, a: 0.25 }; }
    A().play('supernova', m ? 1 : 0.5);
  });
  // Sparks and embers riding the front of a running wave of this hero.
  function waveFx(p, low) {
    for (let i = waves.length - 1; i >= 0; i--) {
      const v = waves[i];
      if (v.pid !== p.pid) continue;
      const k = (F.time - v.t0) / v.d;
      if (k > 1.05 || k < 0) { if (k > 1.05) waves.splice(i, 1); continue; }
      const R0 = v.r0 + (v.r1 - v.r0) * Math.min(1, k);
      for (let j = 0, n = low ? 2 : 6; j < n; j++) {
        const a = Math.random() * TAU;
        F.part(v.x + Math.cos(a) * R0, v.y + Math.sin(a) * R0 - 4, { kind: j & 1 ? 'ember' : 'spark', color: pick([FIRE[3], FIRE[4], '#ffffff']), a: a, spread: 0.6, sp: 60, life: 0.35, size: 2, drag: 2.5, add: j & 1 ? false : true, lt: '#ff8a2a', ltr: 18 });
      }
    }
  }

  // ---------------- Phoenix Form ----------------
  CF.on('pyPhoenix', (ev, ctx, local) => {
    const p = ctx.player(ev.pid); if (!p) return;
    const m = ev.pid === local;
    SP('fx.circle.spark', p.x, p.y - 4, { ramp: 'gold', add: true, a: 0.9 });
    F.ring(p.x, p.y - 6, ev.r * 1.2, '#ffc24a', 0.5, 5); F.ring(p.x, p.y - 6, ev.r * 0.7, '#fff4c0', 0.3, 2);
    for (let i = 0; i < 12; i++) { const a = -1.57 + (i / 11 - 0.5) * 2.6; F.part(p.x, p.y - 12, { kind: 'shard', color: pick([FIRE[2], FIRE[3], FIRE[4]]), a, spread: 0.2, sp: 110 + (i % 3) * 25, life: 0.8, size: 2.8, add: true, vz: 60, z: 6, drag: 1.6 }); }
    F.pop(p.x, p.y - 14, ev.r * 0.6, '#ffe9a0', 0.3, true);
    if (m) F.addShake(2.5);
    A().play('phoenix', m ? 0.8 : 0.4);
  });
  // The ring that follows the hero (pfire zone, tag 10, called from render.js): a dashed ring on the ground, tongues of flame turning on it and a warm light; it flares in, and gutters out in its last half second.
  CF.zone.phoenix = (c, z, pass, t) => {
    const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 6), x = s2(z.x), y = s2(z.y), flick = 0.85 + 0.15 * Math.sin(t * 17 + z.id);
    if (fade <= 0.01) return;
    if (pass === 0) {
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 2, FIRE[1], FIRE[2], FIRE[3], 4, (t * 7) & 7), x, y, 0.8 * fade);
      Pix.put(c, Pix.disc(Math.max(1, Math.round(z.r / 2)), FIRE[2]), x, y, 0.07 * fade);
      R().light(z.x, z.y - 6, z.r * 2.4, '#ffb347', 0.8 * fade * flick);
      return;
    }
    if (pass !== 1) return;
    R().glow(c, z.x, z.y - 6, z.r * 1.15, '#ff7a2a', 0.3 * fade);
    const n = Math.max(10, Math.round(z.r / 4.5));
    for (let i = 0; i < n; i++) { // flame tongues round the ring (a second, shorter row just inside it); the whole ring turns, each tongue breathes at its own pace
      const a = i * TAU / n + t * 1.1, h = Pix.hash(i * 3.1 + z.id), rows = 3 + Math.floor((0.5 + 0.5 * Math.sin(t * 9 + i * 1.7)) * 2 * fade + h);
      tongue(c, s2(z.x + Math.cos(a) * z.r), s2(z.y + Math.sin(a) * z.r * 0.92 - 2), Math.min(4, rows), (i & 1) === 0, true);
      if ((i & 1) === 0) tongue(c, s2(z.x + Math.cos(a + 0.12) * (z.r - 6)), s2(z.y + Math.sin(a + 0.12) * (z.r - 6) * 0.92 - 2), 2, false, false);
    }
  };

  // ---------------- Cataclysm ----------------
  // The cast: a wide ring closes on the cursor point and the sky glows; the meteors announce themselves one by one with their own marks.
  CF.on('pyStorm', (ev, ctx, local) => {
    const m = ev.pid === local;
    F.ring(ev.x, ev.y, ev.r + 95, '#ff7a2a', 0.9, 4, true); F.ring(ev.x, ev.y, ev.r * 0.6, '#ffc27a', 0.9, 2, true);
    SP('fx.circle.spark', ev.x, ev.y - 2, { ramp: 'fire', add: true, a: 0.8, speed: 0.8 });
    F.burst(ev.x, ev.y - 4, 8, { kind: 'ember', color: '#ffb347', a: -1.57, spread: 3.4, sp: 50, life: 0.9, size: 2, drag: 1.3, lt: '#ff8a2a', ltr: 22 });
    if (m) { F.punch(0.5, 0.2); if (!lowFx()) F.flash = { color: '#ff4a10', t: 0.25, a: 0.14 }; }
    A().play('cataclysm', m ? 0.8 : 0.35);
  });
  // The craters merge: a molten ring sweeps out to the field's edge, the ground heaves and ash falls.
  CF.on('pyField', (ev, ctx, local) => {
    const m = ev.pid === local;
    F.ring(ev.x, ev.y, ev.r * 1.1, '#ff5a1a', 0.55, 7); F.ring(ev.x, ev.y, ev.r * 0.7, '#ffc24a', 0.4, 4); F.ring(ev.x, ev.y, ev.r * 0.35, '#fff4c0', 0.3, 2);
    F.burst(ev.x, ev.y, lowFx() ? 10 : 22, { kind: 'shard', color: '#ff6a1a', sp: ev.r * 1.7, life: 0.8, size: 3, vz: 130, z: 6, add: true });
    F.burst(ev.x, ev.y - 6, 12, { kind: 'ember', color: '#ffb347', a: -1.57, spread: 3.4, sp: 90, life: 1.1, size: 2, drag: 1.2, lt: '#ff8a2a', ltr: 24 });
    stain(ev.x, ev.y, ev.r * 0.8, '#120503', 0.8, 10); SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'fire' });
    F.pop(ev.x, ev.y - 8, ev.r * 0.5, '#ffb347', 0.3);
    if (m) { F.addShake(7); F.punch(0.6, 0.4); F.hitStop(0.06); }
    A().play('thud', m ? 0.8 : 0.4);
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

  // Comet: the hero leaves the ground in a burst of fire and a rush of air. age = seconds the leap has already run.
  function launch(pid, x0, y0, tx, ty, d, age, m, sd) {
    stateOf(pid).comet = { t0: F.time - age, d, x0, y0, tx, ty, sd: !!sd };
    SP('fx.blast.red', x0, y0 - 6, { add: true, lt: sd ? '#ffd36b' : '#ff8a4a', ltr: sd ? 110 : 70 });
    F.ring(x0, y0, sd ? 40 : 26, sd ? '#ffe9a0' : '#ff7a2a', 0.3, 3); F.burst(x0, y0 - 6, sd ? 20 : 12, { kind: 'streak', color: sd ? '#fff4c0' : '#ffb347', a: Math.atan2(ty - y0, tx - x0) + Math.PI, spread: 1.4, sp: 220, life: 0.25, size: 1.8 });
    F.dust(x0, y0 + 2, 'dust', 2);
    A().play('dash', m ? 0.8 : 0.4); A().play(sd ? 'sundive' : 'fire', m ? 0.6 : 0.3);
    if (sd && m) F.addShake(2.5);
  }
  // The local hero's own cast: the arc from where the leap began to where it ends (p.skillMove: direction, speed, seconds left, seconds run).
  function predict(p, s) {
    const sm = p.skillMove, age = sm ? sm.age || 0 : 0, d = sm ? sm.t + age : p.cometT, sd = p.stats && p.stats.sunDive > 0;
    s.predAt = F.time;
    if (!sm) return launch(p.pid, p.x, p.y, p.x, p.y, d, 0, true, sd);
    launch(p.pid, p.x - sm.dx * sm.speed * age, p.y - sm.dy * sm.speed * age, p.x + sm.dx * sm.speed * sm.t, p.y + sm.dy * sm.speed * sm.t, d, age, true, sd);
  }
  CF.on('pyComet', (ev, ctx, local) => {
    const m = ev.pid === local;
    if (m && F.time - stateOf(ev.pid).predAt < 1) return; // the client started this arc at its own cast
    launch(ev.pid, ev.x, ev.y, ev.tx, ev.ty, ev.d, 0, m, ev.sd);
  });
  // Sun Dive landing: a golden shockwave with a pillar of sparks; the pilot feels it.
  CF.on('pyDive', (ev, ctx, local) => {
    const m = ev.pid === local, r = ev.r;
    F.ring(ev.x, ev.y, r * 1.25, '#ffe9a0', 0.5, 6); F.ring(ev.x, ev.y, r * 0.7, '#ffffff', 0.32, 3);
    F.burst(ev.x, ev.y - 6, 22, { color: '#ffd36b', sp: r * 2.6, life: 0.5, size: 3, add: true }); F.burst(ev.x, ev.y - 8, 12, { kind: 'streak', color: '#fff4c0', a: -1.57, spread: 1.4, sp: 300, life: 0.4, size: 1.8 });
    F.pop(ev.x, ev.y - 10, r * 0.9, '#fff4c0', 0.3, true); SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'gold' });
    if (m) { F.addShake(5); F.punch(0.7, 0.4); F.hitStop(0.05); }
    A().play('sundive', m ? 0.8 : 0.35);
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

  // ---------------- route forms ----------------
  // Caldera: a column of molten streaks and shards shoots up from the geyser, a pale ring spreads, and the Lava Pool's ring swells from its old radius (pr / 1.2) to the new one.
  CF.on('pyGeyser', (ev, ctx, local) => {
    const m = ev.pid === local, n = lowFx() ? 6 : 12;
    F.ring(ev.px, ev.py, ev.pr, '#ff5a1a', 0.5, 3, false, ev.pr / 1.2);
    F.ring(ev.x, ev.y, ev.r, '#ffb347', 0.3, 4); F.ring(ev.x, ev.y, ev.r * 0.55, '#fff4c0', 0.22, 2);
    F.burst(ev.x, ev.y - 4, n, { kind: 'streak', color: '#ffb347', a: -1.57, spread: 0.3, sp: 330, life: 0.45, size: 2.2, drag: 2.2 });
    F.burst(ev.x, ev.y - 2, n, { kind: 'shard', color: '#ff6a1a', a: -1.57, spread: 1.1, sp: ev.r * 1.2, life: 0.85, size: 3, vz: 250, z: 4, add: true });
    F.burst(ev.x, ev.y - 6, 5, { kind: 'ember', color: '#ffe9a0', a: -1.57, spread: 0.6, sp: 120, life: 0.9, size: 2, drag: 1.1, lt: '#ff8a2a', ltr: 22 });
    SP('fx.explosion', ev.x, ev.y - 8, { ramp: 'fire' }); SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'fire', a: 0.7 });
    F.pop(ev.x, ev.y - 12, ev.r * 0.45, '#fff4c0', 0.2, true);
    stain(ev.x, ev.y, ev.r * 0.7, '#120503', 0.7, 8);
    if (m) F.addShake(2.5);
    A().play('thud', m ? 0.6 : 0.3); A().play('fire', m ? 0.35 : 0.15);
  });

  // Fire Dancer: two rings spread from where the dash began and a circle of flame tongues rises on the ring's edge.
  CF.on('pyRing', (ev, ctx, local) => {
    const m = ev.pid === local, n = lowFx() ? 10 : 20;
    F.ring(ev.x, ev.y, ev.r, '#ffc24a', 0.45, 5); F.ring(ev.x, ev.y, ev.r * 0.7, '#ff7a2a', 0.35, 3);
    for (let i = 0; i < n; i++) { const a = i * TAU / n + Math.random() * 0.2; F.part(ev.x + Math.cos(a) * ev.r * 0.9, ev.y + Math.sin(a) * ev.r * 0.7 - 2, { kind: 'ember', color: pick([FIRE[2], FIRE[3], FIRE[4]]), a: -1.57, spread: 0.5, sp: 55, life: 0.7, size: 2, drag: 1.3, add: true, lt: '#ff8a2a', ltr: 20 }); }
    F.burst(ev.x, ev.y, lowFx() ? 6 : 12, { color: '#ffb347', sp: ev.r * 2.2, life: 0.35, size: 2.4, add: true });
    SP('fx.circle.spark', ev.x, ev.y - 2, { ramp: 'fire', add: true, a: 0.9 });
    stain(ev.x, ev.y, ev.r * 0.6, '#1c0a06', 0.5, 5);
    A().play('fire', m ? 0.5 : 0.25); A().play('dash', m ? 0.3 : 0.12);
  });

  // White Flame: the white glyph of a white-hot foe (the hero hook marks the foe e.pyWhiteT each frame it is white-hot).
  const WHITE = { id: 'fx.glyph.whiteflame', ramp: '', stub: '' };
  let whiteOk = false;
  function whiteGlyph() {
    if (whiteOk) return true;
    if (!ED.Atlas || !ED.Atlas.ok) return false;
    const cv = document.createElement('canvas'); cv.width = cv.height = 7;
    const g = cv.getContext('2d'), rows = ['...1...', '..121..', '..131..', '.12321.', '.13331.', '.13331.', '..111..'], col = { 1: '#ffd9a0', 2: '#fff0d0', 3: '#ffffff' };
    for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) { const ch = rows[j][i]; if (ch === '.') continue; g.fillStyle = col[ch]; g.fillRect(i, j, 1, 1); }
    return (whiteOk = Pix.define(WHITE.id, cv, 3, 3));
  }
  CF.mark.push((e) => (F.time - e.pyWhiteT < 0.25 && whiteGlyph() ? WHITE : null));
  // A foe is white-hot once it has burned whiteT seconds in a row (the viewer times the foe's burning flag); white sparks rise from it.
  function whiteFlames(p, st, low) {
    const g = ED.Game && ED.Game.s, v = g && g.view;
    if (!v || !v.enemies) return;
    const now = F.time;
    for (const e of v.enemies) {
      if (e.hp <= 0) continue;
      if (!(e.burn > 0)) { e.pyB0 = 0; continue; }
      if (!(e.pyB0 > 0)) e.pyB0 = now;
      if (now - e.pyB0 < st.whiteT) continue;
      e.pyWhiteT = now;
      if (Math.random() < (low ? 0.1 : 0.3)) F.part(e.x + (Math.random() - 0.5) * e.r, e.y - e.r * 0.3, { kind: 'ember', color: pick(['#ffffff', '#fff4c0', '#ffe9a0']), a: -1.57, spread: 0.5, sp: 42, life: 0.5, size: 2, drag: 1.2, add: true, lt: '#fff4c0', ltr: 14 });
    }
  }

  // Inferno Engine: one ember per stored Heat circles the hero (a full store burns white and wide).
  function heatOrbit(c, p, st, s, t, low) {
    if (!(st.infernoMul > 0)) { s.heat = 0; return; }
    if (F.time - s.heatAt > 3.5) s.heat = 0;
    const n = Math.min(s.heat | 0, 12);
    if (n <= 0) return;
    const mx = Math.max(1, s.heatMax || st.heatMax), fr = Math.min(1, n / mx), full = n >= mx, an = R().actorAnchor(p), cy = s2((an ? an.cy : -12) - (p.lift || 0)), rx = full ? 17 : 14;
    for (let i = 0; i < n; i++) { // a 4 px ember (a white-hot core when full) on a flat ring round the body, a dim trail behind it
      const a = t * (full ? 4.5 : 2.4) + i * TAU / n, x = s2(Math.cos(a) * rx), y = cy + s2(Math.sin(a) * 6), tx = s2(Math.cos(a - 0.35) * rx), ty = cy + s2(Math.sin(a - 0.35) * 6);
      if (!low) { c.globalAlpha = 0.45; c.fillStyle = FIRE[2]; c.fillRect(tx - 1, ty - 1, 2, 2); c.globalAlpha = 1; }
      c.fillStyle = full ? FIRE[4] : FIRE[3 - (i & 1)]; c.fillRect(x - 2, y - 2, 4, 4);
      c.fillStyle = full ? '#ffffff' : FIRE[4]; c.fillRect(x - 1, y - 1, 2, 2);
    }
    R().emit(p.x, p.y - 12, 22 + 16 * fr, '#ff7a2a', 0.25 + 0.5 * fr);
    R().light(p.x, p.y - 14, 40 + 50 * fr, full ? '#ffd36b' : '#ff8a2a', 0.3 + 0.5 * fr);
  }
  CF.on('pyEng', (ev, ctx, local) => {
    const s = stateOf(ev.pid), m = ev.pid === local;
    s.heat = ev.n; s.heatMax = ev.mx; s.heatAt = F.time;
    if (!ev.go) return;
    if (ev.k === 1 && ev.go === 1) { // the heated Meteor: a red ring closes on the target, the sky glows
      F.ring(ev.x, ev.y, ev.r + 40, '#ff4a10', 0.9, 4, true); F.ring(ev.x, ev.y, ev.r, '#ffc24a', 0.9, 2);
      SP('fx.circle.spark', ev.x, ev.y - 2, { ramp: 'gold', add: true, a: 0.85, speed: 0.8 });
      A().play('combust', m ? 0.4 : 0.15);
      return;
    }
    const x = ev.x, y = ev.y, r = ev.r; // the Inferno blast: a white-gold shockwave, a pillar of sparks and a flash
    F.ring(x, y, r * 1.15, '#fff4c0', 0.5, 6); F.ring(x, y, r * 0.8, '#ffc24a', 0.4, 4); F.ring(x, y, r * 0.45, '#ff5a1a', 0.3, 3);
    F.burst(x, y - 6, lowFx() ? 14 : 28, { color: '#ffe9a0', sp: r * 2.4, life: 0.5, size: 3, add: true });
    F.burst(x, y - 8, 10, { kind: 'streak', color: '#ffffff', a: -1.57, spread: 1.2, sp: 320, life: 0.4, size: 1.8 });
    F.pop(x, y - 8, r * 0.7, '#fff4c0', 0.28, true); SP('fx.blast.red', x, y - 8, { add: true, lt: '#ffd36b', ltr: r }); SP('fx.explosion', x, y - 6, { ramp: 'gold' });
    if (m) { F.addShake(6); F.punch(0.8, 0.4); F.hitStop(0.05); }
    A().play('supernova', m ? 0.6 : 0.3);
  });
})(globalThis.ED || (globalThis.ED = {}));
