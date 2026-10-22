// cleric route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js; the wave look is a body replacement, ED.ClassFx.shotBody[kind] of render.js shotBody).
// Everything is read from what the snapshot already carries: events (skill hf / au, hturn, solar, verdict, chain k 'b'), the foe flags (Judged), the hero flags (glBuff, embolden) and the zone follow slot (z.fol); the cards a hero owns come from its boons.
// Skill forms (rank 3): Wrath of Heaven (nova ring, falling pillars, a turning sun wheel on the Sanctuary: zone w 8), Radiant Aegis (wings, pulse rings, a haloed aura: zone w 9), Hammerstorm (golden afterimages round the hammers), Final Judgment (gold echo chains between Judged foes, a bigger Verdict).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, Pix = ED.Pix, CFX = ED.ClassFx;
  const GOLD = '#ffcf5a', PALE = '#ffe9a0', HOLY = 'holy';
  const FX = () => ED.FX, R = () => ED.Render;
  const lowFx = () => !!(R() && R().quality === 'low');
  const SP = (id, x, y, o) => FX().sheet(id, x, y, o); // atlas sprite effect; a no-op while the art is missing (every effect below also has a procedural part)
  const view = () => { const s = ED.Game && ED.Game.s; return s ? s.view : null; };

  // Does any Cleric in the viewed party own a stat (a card of the Cleric routes)? Cached per frame.
  let stampT = -1; const has = {};
  function partyHas(key) {
    const F = FX();
    if (F.time !== stampT) {
      stampT = F.time; for (const k in has) has[k] = null;
      const v = view();
      if (v) for (const p of v.players.values()) if (p.cls === 'cleric' && p.stats) for (const k of KEYS) if (p.stats[k] && !has[k]) has[k] = p;
    }
    return has[key] || null;
  }
  const KEYS = ['verdict', 'waveBig', 'waveHome', 'sanctJudge', 'aura', 'guardLight', 'auraDmg', 'storm', 'fjEcho', 'aegis'];

  // ---------------- sounds ----------------
  const bell = (n, v) => { if (ED.Audio) ED.Audio.play('bell', v, n); };

  // ---------------- events ----------------
  // Sanctuary cast: Holy Fury slams a light pillar down and stuns the foes inside (their stars come from the foe flags); Aura of Faith lights a ring around the Cleric; Hallowed Ground marks the circle with a sigil ring.
  CFX.on('skill', (ev, ctx, local) => {
    if (ev.k !== 'sanctuary') return;
    const F = FX(), p = ctx.player(ev.pid), st = p && p.stats; if (!st) return;
    const mine = ev.pid === local, m = mine ? 1 : 0.7, r = ED.Stats.skillNums('sanctuary', st).p.zone.r;
    if (ev.hf) {
      F.beam(ev.x, ev.y, 260, 30 * m, GOLD, 0.34); F.pop(ev.x, ev.y - 10, r * 0.55, PALE, 0.28, true);
      F.ring(ev.x, ev.y, r, PALE, 0.42, 5); F.ring(ev.x, ev.y, r * 0.55, '#ffffff', 0.3, 3);
      SP('fx.ring.shock', ev.x, ev.y - 4, { ramp: HOLY, add: true, a: m }); SP('fx.blast.red', ev.x, ev.y - 6, { ramp: HOLY, add: true, a: m, lt: PALE, ltr: r * 0.9 });
      if (!lowFx()) F.burst(ev.x, ev.y - 6, 16, { kind: 'streak', color: PALE, a: -1.57, spread: 3.1, sp: r * 2.2, life: 0.35, size: 2 });
      if (mine) { F.addShake(5); F.hitStop(0.05); F.punch(0.5, 0.2); }
      if (ED.Audio) { ED.Audio.play('heavy', 0.7 * m); bell(-7, 0.9 * m); }
    }
    if (ev.au) {
      F.ring(p.x, p.y, r * 0.5, PALE, 0.5, 3); F.pop(p.x, p.y - 12, 34, PALE, 0.3);
      for (let i = 0, n = lowFx() ? 4 : 8; i < n; i++) { const a = i * TAU / n; F.part(p.x, p.y - 10, { color: PALE, a, sp: 70, life: 0.5, size: 2, add: true, drag: 2 }); }
      bell(7, 0.7 * m);
    }
    if (st.sanctJudge) { // sigil ring: eight gold marks on the circle's edge flare as the Judgment settles on it
      F.ring(ev.x, ev.y, r * 0.8, '#fff3c4', 0.6, 2);
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; SP('fx.glint', ev.x + Math.cos(a) * r * 0.8, ev.y + Math.sin(a) * r * 0.8 * 0.72 - 4, { ramp: HOLY, add: true, delay: i * 0.03 }); }
    }
  });

  // A Judgment hammer turns at the end of a leg (1, 3), flies out again from the hand (2, Second Flight) or is caught (4).
  CFX.on('hturn', (ev, ctx, local) => {
    const F = FX(), mine = ev.pid === local, m = mine ? 1 : 0.6, A = ED.Audio;
    if (ev.n === 2 || ev.n === 4) { // at the hand
      F.ring(ev.x, ev.y - 6, 16, PALE, 0.22, 3); F.pop(ev.x, ev.y - 6, 16, PALE, 0.16, true);
      SP('fx.spark.magic', ev.x, ev.y - 8, { ramp: HOLY, add: true, a: m });
      if (ev.n === 4) { F.burst(ev.x, ev.y - 6, 4, { color: PALE, sp: 50, vy: -30, life: 0.4, size: 1.8, add: true, drag: 2 }); if (A) A.play('catch', 0.5 * m, false); } else if (A) { A.play('dash', 0.4 * m); bell(12, 0.5 * m); }
    } else { // at the far end
      F.pop(ev.x, ev.y - 6, 18, PALE, 0.16, true); F.burst(ev.x, ev.y - 6, 5, { kind: 'spark', color: '#ffe6a8', sp: 150, life: 0.2, size: 1.4, drag: 5 });
      SP('fx.hit.spark', ev.x, ev.y - 8, { ramp: HOLY, add: true });
      if (A) A.play('deflect', 0.45 * m);
    }
  });

  // Solar Flare: the wave ends in a sun burst.
  CFX.on('solar', (ev, ctx, local) => {
    const F = FX(), m = ev.pid === local ? 1 : 0.7, r = ev.r || 50;
    F.ring(ev.x, ev.y, r, PALE, 0.34, 4); F.ring(ev.x, ev.y, r * 0.6, '#ffffff', 0.22, 2); F.pop(ev.x, ev.y - 6, r * 0.8, PALE, 0.22, true);
    SP('fx.burst', ev.x, ev.y - 6, { ramp: HOLY, add: true, a: m, lt: PALE, ltr: r * 1.4 });
    if (!lowFx()) { F.burst(ev.x, ev.y - 6, 8, { kind: 'streak', color: PALE, sp: r * 3, life: 0.28, size: 1.6 }); F.burst(ev.x, ev.y - 6, 6, { color: GOLD, sp: r * 1.2, life: 0.4, size: 2.4, add: true }); }
    if (ev.pid === local) F.addShake(1.5);
    bell(14, 0.5 * m);
  });

  // Verdict: a Judged foe's death bursts in light (r70) that stuns the foes in it.
  CFX.on('verdict', (ev, ctx, local) => {
    const F = FX(), mine = ev.pid === local, m = mine ? 1 : 0.7, r = ev.r || 70;
    F.beam(ev.x, ev.y, 200, 20 * m, GOLD, 0.3); F.ring(ev.x, ev.y, r, PALE, 0.4, 5); F.ring(ev.x, ev.y, r * 0.55, '#ffffff', 0.28, 3); F.pop(ev.x, ev.y - 8, r * 0.7, PALE, 0.24, true);
    SP('fx.explosion', ev.x, ev.y - 6, { ramp: HOLY, add: true, a: m, lt: PALE, ltr: r * 1.5 });
    SP('fx.circle.white', ev.x, ev.y - 2, { ramp: HOLY, add: true, a: 0.8 * m });
    if (!lowFx()) F.burst(ev.x, ev.y - 8, 10, { kind: 'streak', color: '#fff3c4', sp: r * 3, life: 0.3, size: 1.8 });
    if (mine) { F.addShake(2.5); F.hitStop(0.04); }
    if (ED.Audio) { ED.Audio.play('heavy', 0.45 * m); bell(-5, 0.8 * m); }
  });

  // Prism beam (and the Sunburst jump): a gold line from the Smite to its target, a flare at both ends and a high bell; the line itself is drawn by the chain handler of fx.js.
  CFX.on('chain', (ev) => {
    if (ev.k !== 'b') return;
    const F = FX(), a = ev.pts[0], b = ev.pts[ev.pts.length - 1];
    SP('fx.glint', a[0], a[1] - 8, { ramp: HOLY, add: true, speed: 1.3 }); SP('fx.glint', b[0], b[1] - 8, { ramp: HOLY, add: true, speed: 1.3 });
    F.ring(b[0], b[1] - 4, 18, PALE, 0.25, 3); F.pop(b[0], b[1] - 8, 20, '#ffffff', 0.18, true);
    if (!lowFx()) F.burst(b[0], b[1] - 8, 5, { kind: 'spark', color: PALE, sp: 130, life: 0.22, size: 1.5, drag: 5 });
    bell(19, 0.35);
  });

  // Litany: the 6th attack of a Crusader at rank 3 sends a fan of three waves; a wing flash opens at the hand.
  CFX.on('atk', (ev, ctx) => {
    if (!ev.n || ev.n % 6) return;
    const p = ctx.player(ev.pid), st = p && p.stats; if (!st || !st.litany) return;
    const F = FX(), a = ev.a || 0, x = p.x + Math.cos(a) * 16, y = p.y - 12 + Math.sin(a) * 16;
    SP('fx.spark.magic', x, y, { ramp: HOLY, add: true }); F.ring(x, y, 22, PALE, 0.3, 3);
    for (const d of [-0.25, 0, 0.25]) F.part(x, y, { kind: 'streak', color: PALE, a: a + d, sp: 260, life: 0.2, size: 1.6, drag: 3 });
  });

  // ---------------- foe mark: Judged foes of a Verdict party deal less (a cracked guard in gold) ----------------
  const WEAK = { id: 'fx.glyph.corroded', ramp: 'gold', stub: 'weak' };
  CFX.mark.push((e) => (e.judged > 0 && partyHas('verdict') ? WEAK : null));

  // ---------------- heroes: Aura of Faith halo, Embolden glints, Guardian Light sword ----------------
  const auraOf = (p) => { const v = view(); if (!v) return null; for (const z of v.zones) if (z.kind === 'sanct' && (z.fol === (p.slot | 0) + 1 || z.follow === p.pid)) return z; return null; };
  const fillC = (c, col, a, rects) => { c.globalAlpha = a; c.fillStyle = col; c.beginPath(); for (let i = 0; i < rects.length; i += 4) c.rect(rects[i], rects[i + 1], rects[i + 2], rects[i + 3]); c.fill(); };
  const q4 = (a) => Math.max(0.25, Math.ceil(a * 4) / 4);
  const rects = [];

  // An arrowhead of five 2 px squares (tip at x, y) 10 px wide, appended to rects.
  const chevron = (x, y) => { rects.push(x, y, 2, 2, x - 2, y + 2, 2, 2, x + 2, y + 2, 2, 2, x - 4, y + 4, 2, 2, x + 4, y + 4, 2, 2); };

  CFX.hero.push((c, p, t, low) => {
    if (p.dead || p.downed) return;
    const ga = c.globalAlpha, slot = p.slot | 0, s2 = Pix.s2, Rn = R();
    // Aura of Faith: a gold ring on the ground and a bright ring with orbiting motes around the Cleric's waist
    if (p.cls === 'cleric' && p.stats && p.stats.aura && auraOf(p)) {
      const z = auraOf(p), fade = Math.min(1, z.dur ? (z.dur - z.t) * 2 : 1, z.t * 5), an = Rn && Rn.actorAnchor ? Rn.actorAnchor(p) : null;
      Pix.put(c, Pix.ell(11, 5, PALE, false, 3, (t * 6) & 7), 0, 2, 0.9 * fade);
      const y = s2(an ? an.cy : -22) + 8 + Math.round(Math.sin(t * 2.2)) * 2; // waist height: the overhead rows belong to the name label, the head to the hero
      Pix.put(c, Pix.ell(9, 3, GOLD, false, 3, (t * 5) & 7), 0, y, 0.85 * fade); Pix.put(c, Pix.ell(8, 2, PALE, false, 2, (-t * 6) & 7), 0, y, 0.6 * fade);
      if (!low) { rects.length = 0; for (let i = 0; i < 4; i++) { const a = t * 2.4 + i * TAU / 4; rects.push(s2(Math.cos(a) * 20), s2(y + Math.sin(a) * 7) - 2, 2, 2); } fillC(c, '#fff3c4', fade, rects); }
      if (Rn && !low) Rn.emit(p.x, p.y + y, 18, PALE, 0.22 * fade);
      if (p.stats.aegis) { const flap = Math.round(Math.sin(t * 3 + slot) * 1) * 2; Pix.put(c, aegisWing(true), -14, y - 8 + flap, 0.95 * fade); Pix.put(c, aegisWing(false), 14, y - 8 + flap, 0.95 * fade); } // Radiant Aegis: a pair of wings at the shoulders
      c.globalAlpha = ga;
    }
    // Embolden: gold arrowheads rise along the body of an ally inside a Cleric's aura, over a gold ring on the ground
    if (p.embolden || p.auraT > 0) {
      Pix.put(c, Pix.ell(9, 4, GOLD, false, 3, (t * 5) & 7), 0, 2, 0.9);
      for (let i = 0; i < 3; i++) {
        const ph = (t * 1.1 + i / 3 + slot * 0.17) % 1, x = [-8, 0, 8][i], y = s2(-2 - ph * 44), a0 = q4(Math.sin(ph * Math.PI));
        rects.length = 0; chevron(x, y); fillC(c, GOLD, a0, rects); rects.length = 0; rects.push(x, y, 2, 2); fillC(c, '#ffffff', a0, rects);
      }
      if (Rn && !low) Rn.emit(p.x, p.y - 12, 24, GOLD, 0.2);
      c.globalAlpha = ga;
    }
    // Guardian Light: a golden sword stands at the hero's side, glints, and a ring pulses at the feet
    if (p.glBuff || p.glT > 0) {
      const bob = Math.round(Math.sin(t * 3 + slot)) * 2, x = 14, y = s2(-22) + bob;
      rects.length = 0; rects.push(x - 2, y - 14, 4, 18, x - 6, y + 4, 12, 2, x - 2, y + 6, 4, 4, x - 2, y + 10, 4, 2); fillC(c, GOLD, 1, rects);
      rects.length = 0; rects.push(x - 2, y - 14, 2, 18, x - 6, y + 4, 12, 2); fillC(c, '#ffffff', 1, rects);
      rects.length = 0; rects.push(x - 4, y + 4, 2, 2, x + 2, y + 4, 2, 2); fillC(c, '#a87a1c', 1, rects);
      if (((t * 2 + slot * 0.3) % 1) < 0.2) { rects.length = 0; rects.push(x - 8, y - 14, 16, 2, x - 2, y - 20, 4, 14); fillC(c, '#ffffff', 1, rects); }
      Pix.put(c, Pix.ell(11, 5, GOLD, false), 0, 2, 0.65 + 0.25 * Math.sin(t * 4 + slot));
      if (Rn && !low) Rn.emit(p.x + x, p.y + y, 18, GOLD, 0.25);
      c.globalAlpha = ga;
    }
  });

  // ---------------- waves: Sunhammer's sun disc, Crusader's winged crescent ----------------
  // ED.ClassFx.shotBody.wave(c, pr, t, x, y, foe, col) replaces the body of a wave shot and returns true, or returns false for the default crescent.
  const sunSprite = (R2, ph) => Pix.bake('sun|' + R2 + '|' + ph, 2 * R2 + 2, 2 * R2 + 2, R2 + 1, R2 + 1, (b, w) => {
    const rp = Pix.RAMP.holy, c0 = Pix.px32(rp[1]), c1 = Pix.px32(rp[2]), c2 = Pix.px32(rp[3]), c3 = Pix.px32(rp[0]), S = 2 * R2 + 2; // cream core (never white), gold body, dark rim
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2, d = Math.hypot(dx, dy) / R2;
      if (d > 1) continue;
      if (d <= 0.24) b[y * w + x] = c2;
      else if (d <= 0.5) b[y * w + x] = c1;
      else if (d <= 0.72) b[y * w + x] = c0;
      else if (d <= 0.8) b[y * w + x] = c3;
      else if (d > 0.86 && Math.cos(12 * Math.atan2(dy, dx) + ph * TAU / 4 * 0.5) > 0.5) b[y * w + x] = d > 0.95 ? c1 : c0;
    }
  });
  const wingSprite = (R2, st) => Pix.bake('wing|' + R2 + '|' + st, 2 * R2 + 8, 2 * R2 + 8, R2 + 4, R2 + 4, (b, w) => { // a thin crescent with a white edge and two feathers trailing from each tip
    const rp = Pix.RAMP.holy, c1 = Pix.px32(rp[2]), c2 = Pix.px32(rp[3]), c3 = Pix.px32('#ffffff'), S = 2 * R2 + 8, th = st / 32 * TAU, co = Math.cos(th), si = Math.sin(th);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = x + 0.5 - S / 2, py = y + 0.5 - S / 2, lx = px * co + py * si + 0.4 * R2, ly = -px * si + py * co, d = Math.hypot(lx, ly), ang = Math.atan2(ly, lx);
      if (d <= R2 && d > R2 - 2.2 && Math.abs(ang) < 1.05) b[y * w + x] = d > R2 - 1 ? c3 : c2;
      else if (d <= R2 - 2.2 && d > R2 - 4 && Math.abs(ang) < 0.7) b[y * w + x] = c1;
      else if (Math.abs(ang) >= 1.05 && Math.abs(ang) < 1.5 && d <= R2 + 0.5 && d > R2 - 1.4 - (Math.abs(ang) - 1.05) * 3 && lx < 0.4 * R2 + 2) b[y * w + x] = c1; // tip feathers sweep backwards
    }
  });
  (CFX.shotBody || (CFX.shotBody = {})).wave = (c, pr, t, x, y, foe) => {
    if (foe) return false;
    const heading = Math.round(Math.atan2(pr.vy, pr.vx) / TAU * 32) & 31;
    if (pr.r >= 26) { // Sunhammer: the sun disc turns as it rolls
      const R2 = Math.max(8, Math.round(pr.r / 2) - 1);
      Pix.put(c, sunSprite(R2, (t * 8) & 3), Pix.s2(x), Pix.s2(y), 0.85); // translucent: the foe under the sun stays readable
      Pix.put(c, wingSprite(R2 + 1, heading), Pix.s2(x), Pix.s2(y), 0.85);
      return true;
    }
    if (partyHas('waveHome')) { Pix.put(c, wingSprite(Math.max(5, Math.round(pr.r / 2)), heading), Pix.s2(x), Pix.s2(y)); return true; }
    return false;
  };

  // ---------------- skill forms ----------------
  const s2 = Pix.s2, away = (ctx, x, y) => { const me = ctx.player(ctx.localPid); return me ? Math.hypot(me.x - x, me.y - y) : 9999; }; // far events do not shake the screen

  // Wrath of Heaven: the cast is a nova over the whole circle - three rings, a column of light, a radial burst of streaks, a heavy shake and hit-stop for the Cleric who cast it.
  CFX.on('skill', (ev, ctx, local) => {
    if (ev.k !== 'sanctuary' || !ev.wr) return;
    const F = FX(), p = ctx.player(ev.pid), st = p && p.stats; if (!st) return;
    const mine = ev.pid === local, m = mine ? 1 : 0.7, r = ED.Stats.skillNums('sanctuary', st).p.zone.r, d = away(ctx, ev.x, ev.y);
    F.beam(ev.x, ev.y, 420, 54 * m, '#fff3c4', 0.5); F.beam(ev.x, ev.y, 420, 22 * m, '#ffffff', 0.36, 1, '#ffffff');
    F.ring(ev.x, ev.y, r * 1.05, GOLD, 0.55, 7); F.ring(ev.x, ev.y, r * 0.72, PALE, 0.42, 5); F.ring(ev.x, ev.y, r * 0.38, '#ffffff', 0.3, 3);
    F.pop(ev.x, ev.y - 8, r * 0.9, '#fff3c4', 0.36, true);
    SP('fx.ring.shock', ev.x, ev.y - 4, { ramp: HOLY, add: true, a: m, speed: 0.8 }); SP('fx.explosion', ev.x, ev.y - 6, { ramp: HOLY, add: true, a: 0.9 * m, lt: PALE, ltr: r * 1.4 });
    if (!lowFx()) { F.burst(ev.x, ev.y - 6, 28, { kind: 'streak', color: PALE, sp: r * 3, life: 0.4, size: 2 }); F.burst(ev.x, ev.y - 6, 16, { color: GOLD, sp: r * 1.1, life: 0.7, size: 2.6, add: true, drag: 1.4 }); }
    F.dust(ev.x, ev.y, 'dust', 4);
    if (mine) { F.addShake(8); F.hitStop(0.08); F.punch(1, 0.4); } else if (d < 450) F.addShake(2.5);
    if (ED.Audio) { ED.Audio.play('heavy', 0.9 * m); ED.Audio.play('boom', 0.35 * m); bell(-9, 1 * m); bell(3, 0.6 * m); }
  });
  // A pillar of light falls on a foe: a white-gold column from above, a ring and a flash at its foot, streaks flung upward, a short shake for the Cleric.
  CFX.on('pillar', (ev, ctx, local) => {
    const F = FX(), mine = ev.pid === local, m = mine ? 1 : 0.7;
    F.beam(ev.x, ev.y, 360, 26 * m, GOLD, 0.3); F.beam(ev.x, ev.y, 360, 10 * m, '#ffffff', 0.22, 1, '#ffffff');
    F.ring(ev.x, ev.y, 30, PALE, 0.3, 4); F.ring(ev.x, ev.y, 16, '#ffffff', 0.2, 2); F.pop(ev.x, ev.y - 8, 30, '#ffffff', 0.18, true);
    SP('fx.hit.spark', ev.x, ev.y - 8, { ramp: HOLY, add: true, a: m }); SP('fx.glint', ev.x, ev.y - 14, { ramp: HOLY, add: true, speed: 1.4 });
    if (!lowFx()) F.burst(ev.x, ev.y - 6, 7, { kind: 'streak', color: PALE, a: -1.57, spread: 2.6, sp: 210, life: 0.3, size: 1.8 });
    if (mine) { F.addShake(1.4); F.hitStop(0.02); }
    if (ED.Audio) { ED.Audio.play('deflect', 0.4 * m); bell(8 + (ev.x & 7), 0.45 * m); }
  });
  // The Wrath Sanctuary (zone 'sanct' with w 8, drawn over the plain one): a sun wheel of twelve rays turning on the ground, a second dashed ring, a bright eye and light motes that climb in columns.
  CFX.zone.wrath = (c, z, pass, t) => {
    const R = ED.Render, fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5), x = s2(z.x), y = s2(z.y), rp = Pix.RAMP.holy;
    if (pass === 0) {
      R.light(z.x, z.y, z.r * 2.4, '#fff3c4', 0.55 * fade);
      c.fillStyle = rp[3]; c.beginPath();
      for (let i = 0, n = 12, a0 = t * 0.5; i < n; i++) {
        const a = a0 + i * TAU / n, ca = Math.cos(a), sa = Math.sin(a), far = z.r * (i & 1 ? 0.97 : 0.72);
        for (let r = z.r * 0.3; r < far; r += 7) { c.globalAlpha = (0.9 - (r / z.r) * 0.45) * fade; c.rect(s2(z.x + ca * r), s2(z.y + sa * r * 0.92), 2, 2); }
      }
      c.fill(); c.globalAlpha = 1;
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * 0.56 / 2)), 1, rp[2], rp[3], rp[3], 5, (-t * 4) & 7), x, y, 0.75 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * 0.2 / 2)), 2, rp[2], rp[3], '#ffffff', 3, (t * 6) & 7), x, y, 0.9 * fade);
    } else if (pass === 1) {
      R.glow(c, z.x, z.y, z.r * 0.7, '#fff3c4', 0.28 * fade); R.glow(c, z.x, z.y, 22 + 6 * Math.sin(t * 5), '#ffffff', 0.5 * fade);
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 10; i++) { const kk = (t * 0.7 + i * 0.1 + z.id * 0.13) % 1, a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / 10) * z.r * 0.9; c.globalAlpha = Math.max(0.25, Math.ceil(Math.sin(kk * Math.PI) * 4) / 4) * fade; c.fillRect(s2(z.x + Math.cos(a) * rr), s2(z.y + Math.sin(a) * rr * 0.8 - kk * 46), 2, 4); }
      c.globalAlpha = 1;
    }
  };

  // An angel's wing (9 x 9 art px, right side; the left one is its mirror): gold feathers with a pale edge and a dark rim.
  const WING = ['.....oo..', '....o11o.', '...o122o.', '..o1222o.', '.o12222o.', '.o1222o..', '..o122o..', '...o11o..', '....oo...'];
  const aegisWing = (left) => {
    const rp = Pix.RAMP.holy;
    return Pix.bake('aegiswing|' + (left ? 'l' : 'r'), 9, 9, 4, 5, (b, w) => {
      const col = { o: Pix.px32(rp[0]), 1: Pix.px32(rp[2]), 2: Pix.px32(rp[3]) };
      for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) { const ch = WING[y][left ? 8 - x : x]; if (ch !== '.') b[y * w + x] = col[ch]; }
    });
  };
  // Radiant Aegis aura (zone 'sanct' with w 9): an inner ring, a bright halo and six small wings turning round the rim.
  CFX.zone.aegis = (c, z, pass, t) => {
    const R = ED.Render, fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5), x = s2(z.x), y = s2(z.y), rp = Pix.RAMP.holy;
    if (pass === 0) {
      R.light(z.x, z.y, z.r * 1.7, '#ffe9a0', 0.4 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * 0.64 / 2)), 1, rp[2], rp[3], rp[3], 6, (t * 5) & 7), x, y, 0.6 * fade);
      for (let i = 0, n = 6; i < n; i++) { const a = t * 0.6 + i * TAU / n; Pix.put(c, aegisWing(Math.cos(a) < 0), s2(z.x + Math.cos(a) * z.r), s2(z.y + Math.sin(a) * z.r * 0.92) - 4, 0.9 * fade); }
    } else if (pass === 1) R.glow(c, z.x, z.y, z.r * 0.8, '#ffe9a0', 0.22 * fade);
  };
  // A pulse of the Aegis: two rings sweeping out to the circle, a flash at the Cleric and a bright chime.
  CFX.on('aegis', (ev, ctx, local) => {
    const F = FX(), mine = ev.pid === local, m = mine ? 1 : 0.7;
    F.ring(ev.x, ev.y, ev.r, PALE, 0.45, 5); F.ring(ev.x, ev.y, ev.r * 0.62, '#ffffff', 0.34, 3); F.pop(ev.x, ev.y - 8, ev.r * 0.35, '#ffe9a0', 0.22, true);
    SP('fx.ring.shock', ev.x, ev.y - 4, { ramp: HOLY, add: true, a: 0.8 * m, speed: 1.2 });
    if (!lowFx()) for (let i = 0; i < 10; i++) { const a = i * TAU / 10; F.part(ev.x + Math.cos(a) * ev.r * 0.3, ev.y + Math.sin(a) * ev.r * 0.3, { color: PALE, a, sp: ev.r * 1.5, life: 0.3, size: 2, add: true, drag: 3 }); }
    if (mine) { F.addShake(2); F.punch(0.3, 0); }
    if (ED.Audio) { ED.Audio.play('deflect', 0.35 * m); bell(12, 0.7 * m); bell(19, 0.4 * m); }
  });

  // Hammerstorm: the cast fans five bright streaks and a ring at the hand; every hammer in flight trails gold afterimages and a turning ring of light.
  CFX.on('skill', (ev, ctx, local) => {
    if (ev.k !== 'judgment' || !ev.st) return;
    const F = FX(), mine = ev.pid === local, m = mine ? 1 : 0.7;
    for (let i = 0; i < 5; i++) F.part(ev.x, ev.y - 10, { kind: 'streak', color: i & 1 ? GOLD : PALE, a: ev.a + (i - 2) * 0.25, sp: 460, life: 0.26, size: 2, drag: 4 });
    F.ring(ev.x, ev.y - 8, 40, GOLD, 0.3, 4); F.pop(ev.x, ev.y - 10, 34, PALE, 0.22, true); SP('fx.spark.magic', ev.x, ev.y - 10, { ramp: HOLY, add: true, a: m });
    if (mine) { F.addShake(3); F.punch(0.4, 0.2); }
    if (ED.Audio) { ED.Audio.play('heavy', 0.6 * m); bell(-3, 0.7 * m); bell(9, 0.5 * m); }
  });
  (CFX.shot || (CFX.shot = {})).hammer = (c, pr, t, x, y) => {
    if (pr.team !== 0 || !partyHas('storm')) return;
    const sp = Math.hypot(pr.vx, pr.vy) || 1, ux = pr.vx / sp, uy = pr.vy / sp, rp = Pix.RAMP.holy;
    for (let i = 1; i <= 3; i++) Pix.draw(c, 'proj.hammer', '', 0, x - ux * i * 9, y - uy * i * 9, 0.34 - i * 0.08, false, t * 16 - i * 0.7);
    Pix.put(c, Pix.ring(Math.max(3, Math.round(pr.r / 3) + 2), 1, rp[2], rp[3], rp[3], 3, (t * 9 + pr.id) & 7), x, y, 0.8);
    c.fillStyle = '#fff3c4'; c.fillRect(s2(x - ux * 14 + uy * Math.sin(t * 20 + pr.id) * 5) - 1, s2(y - uy * 14 - ux * Math.sin(t * 20 + pr.id) * 5) - 1, 2, 2);
  };
  CFX.on('hturn', (ev, ctx, local) => { // a Hammerstorm hammer turns: a wider flash than a lone hammer's
    const p = ctx.player(ev.pid), st = p && p.stats; if (!st || !st.storm) return;
    const F = FX(); F.ring(ev.x, ev.y - 6, 30, GOLD, 0.24, 4); F.pop(ev.x, ev.y - 6, 26, '#ffffff', 0.14, true);
    if (ev.pid === local && ev.n !== 2 && ev.n !== 4) F.addShake(0.9);
  });

  // Final Judgment: an echo is a gold chain from the struck foe to the one it reaches, a flash at the receiver and a thin chime; Judged foes of such a party wear linked rings over their heads.
  CFX.on('echo', (ev, ctx, local) => {
    const F = FX(), m = ev.pid === local ? 1 : 0.6;
    F.bolts.push({ pts: [[ev.x0, ev.y0 - 8], [ev.x1, ev.y1 - 8]], life: 0.2, max: 0.2, color: GOLD, st: true }); if (F.bolts.length > 24) F.bolts.shift();
    F.pop(ev.x1, ev.y1 - 8, 18, '#fff3c4', 0.14, true); F.ring(ev.x1, ev.y1 - 4, 16, GOLD, 0.2, 2);
    if (!lowFx()) F.burst(ev.x1, ev.y1 - 8, 3, { kind: 'spark', color: PALE, sp: 110, life: 0.2, size: 1.5, drag: 5 });
    bell(16, 0.25 * m);
  });
  const BOUND = { id: '', ramp: '', stub: 'bound' };
  CFX.mark.push((e) => (e.judged > 0 && partyHas('fjEcho') ? BOUND : null));
  CFX.on('verdict', (ev, ctx, local) => { // a Final Judgment burst (radius 110): a second ring, a column and a heavy thud
    if ((ev.r || 0) < 100) return;
    const F = FX(), mine = ev.pid === local, m = mine ? 1 : 0.7, r = ev.r;
    F.beam(ev.x, ev.y, 360, 44 * m, '#fff3c4', 0.4); F.ring(ev.x, ev.y, r * 1.1, GOLD, 0.5, 6); F.ring(ev.x, ev.y, r * 0.5, '#ffffff', 0.3, 3); F.pop(ev.x, ev.y - 8, r * 0.8, '#fff3c4', 0.28, true);
    if (!lowFx()) F.burst(ev.x, ev.y - 6, 18, { kind: 'streak', color: PALE, sp: r * 3.2, life: 0.34, size: 2 });
    if (mine) { F.addShake(5); F.hitStop(0.06); F.punch(0.6, 0.3); } else if (away(ctx, ev.x, ev.y) < 400) F.addShake(2);
    if (ED.Audio) { ED.Audio.play('heavy', 0.5 * m); bell(-9, 0.7 * m); }
  });
})(globalThis.ED || (globalThis.ED = {}));
