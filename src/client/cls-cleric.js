// cleric route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js; the wave look uses ED.ClassFx.shot, see render.js shotBody).
// Everything is read from what the snapshot already carries: events (skill hf / au, hturn, solar, verdict, chain k 'b'), the foe flags (Judged), the hero flags (glBuff, embolden) and the zone follow slot (z.fol); the cards a hero owns come from its boons.
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
  const KEYS = ['verdict', 'waveBig', 'waveHome', 'sanctJudge', 'aura', 'guardLight', 'auraDmg'];

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
  const WEAK = { id: 'fx.glyph.corroded', ramp: 'gold', stub: 'guard' };
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
    // Aura of Faith: a gold ring on the ground and a bright halo with orbiting motes over the Cleric's head
    if (p.cls === 'cleric' && p.stats && p.stats.aura && auraOf(p)) {
      const z = auraOf(p), fade = Math.min(1, z.dur ? (z.dur - z.t) * 2 : 1, z.t * 5), top = Rn && Rn.actorAnchor ? Rn.actorAnchor(p).top : -50;
      Pix.put(c, Pix.ell(11, 5, PALE, false, 3, (t * 6) & 7), 0, 2, 0.9 * fade);
      const y = s2(top) - 4 + Math.round(Math.sin(t * 2.2)) * 2;
      Pix.put(c, Pix.ell(9, 3, GOLD, false), 0, y, 0.7 * fade); Pix.put(c, Pix.ell(8, 2, '#ffffff', false), 0, y, fade);
      if (!low) { rects.length = 0; for (let i = 0; i < 4; i++) { const a = t * 2.4 + i * TAU / 4; rects.push(s2(Math.cos(a) * 20), s2(y + Math.sin(a) * 7) - 2, 2, 2); } fillC(c, '#fff3c4', fade, rects); }
      if (Rn && !low) Rn.emit(p.x, p.y + y, 18, PALE, 0.22 * fade);
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
  // ED.ClassFx.shot.wave(c, pr, t, x, y, foe, col) draws the shot and returns true, or returns false for the default crescent.
  const sunSprite = (R2, ph) => Pix.bake('sun|' + R2 + '|' + ph, 2 * R2 + 2, 2 * R2 + 2, R2 + 1, R2 + 1, (b, w) => {
    const rp = Pix.RAMP.holy, c0 = Pix.px32(rp[1]), c1 = Pix.px32(rp[2]), c2 = Pix.px32(rp[3]), c3 = Pix.px32('#ffffff'), S = 2 * R2 + 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2, d = Math.hypot(dx, dy) / R2;
      if (d > 1) continue;
      if (d <= 0.24) b[y * w + x] = c3;
      else if (d <= 0.5) b[y * w + x] = c2;
      else if (d <= 0.72) b[y * w + x] = c1;
      else if (d <= 0.8) b[y * w + x] = c0;
      else if (d > 0.86 && Math.cos(12 * Math.atan2(dy, dx) + ph * TAU / 4 * 0.5) > 0.5) b[y * w + x] = d > 0.95 ? c2 : c1;
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
  (CFX.shot || (CFX.shot = {})).wave = (c, pr, t, x, y, foe) => {
    if (foe) return false;
    const heading = Math.round(Math.atan2(pr.vy, pr.vx) / TAU * 32) & 31;
    if (pr.r >= 26) { // Sunhammer: the sun disc turns as it rolls
      const R2 = Math.max(8, Math.round(pr.r / 2) - 1);
      Pix.put(c, sunSprite(R2, (t * 8) & 3), x, y);
      Pix.put(c, wingSprite(R2 + 1, heading), x, y, 0.85);
      return true;
    }
    if (partyHas('waveHome')) { Pix.put(c, wingSprite(Math.max(5, Math.round(pr.r / 2)), heading), x, y); return true; }
    return false;
  };
})(globalThis.ED || (globalThis.ED = {}));
