// Client draw hooks for bosses warden, spore, twins: ED.BossFx entries (body art by e.st: 0 idle, 1 wind-up, 2 act, 3 vulnerable, 4 airborne; e.stT s into the attack) and ED.ZoneFx entries
// (zone draw by look name, read by render.js: return true to replace the default). Only render-visible fields are read (snapshot-safe).
(function (ED) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const ZF = ED.ZoneFx = ED.ZoneFx || {};
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const reset = () => { O.flip = false; O.flash = 0; O.alpha = 1; O.rot = 0; O.sx = 1; O.sy = 1; O.tint = 0; O.add = false; return O; };
  const A = () => ED.Atlas;
  const rgba = (rgb, a) => (((rgb & 0xffffff) * 256) + Math.max(0, Math.min(255, Math.round(a)))) >>> 0;
  // Angle from e to its nearest living hero in the view (facing when none).
  const toHero = (e) => {
    const v = ED.Game && ED.Game.view, hs = v ? v.heroes : null;
    let best = null, bd = Infinity;
    if (hs) for (const p of hs) { if (p.dead || p.downed) continue; const d = (p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y); if (d < bd) { bd = d; best = p; } }
    return best ? Math.atan2(best.y - e.y, best.x - e.x) : (e.face < 0 ? PI : 0);
  };
  // Shared wind-up / vulnerable cues: a pulsing red ring under the feet while winding up, a gold ring and 'x1.5' while open to punishment.
  const cues = (B, e, t, rx, top) => {
    if (e.st === 1) { const p = 0.5 + 0.5 * Math.sin(t * 24); B.circ(e.x, e.y, rx + 4 + 3 * p, rgba(0xff3a2a, 140 + 100 * p), 2); }
    else if (e.st === 3) { const p = 0.5 + 0.5 * Math.sin(t * 10); B.circ(e.x, e.y, rx + 6 + 4 * p, rgba(0xffd24a, 200), 2); B.text('x1.5', e.x, e.y - top - 10 - 2 * p, 0xffd24a, 2); }
    if (e.enraged) B.circ(e.x, e.y, rx + 8, rgba(0xff2020, 200), 2);
  };
  // Frame of a non-looping attack anim: frames 0-2 held through the wind-up, the rest cycling while acting.
  const atkFrame = (id, e, t) => { const r = A().anim(id), n = r ? (r.n || (r.f && r.f.length) || 1) : 1; if (e.st === 1) return Math.min(n - 1, Math.min(2, Math.floor(e.stT * 6))); return n > 3 ? 3 + Math.floor(t * 14) % (n - 3) : n - 1; };

  // ---------- Bone Warden ----------
  ED.BossFx.warden = {
    draw(B, e, t) {
      const At = A(), o = reset();
      B.shadow(e.x, e.y, e.r * 1.1);
      cues(B, e, t, e.r, 52);
      o.flip = e.face < 0; o.flash = ED.Actors.hitFlash(e) ? 1 : (e.st === 1 && Math.floor(t * 12) % 2 ? 0.4 : 0);
      let id, f;
      if (e.st === 3) { id = 'boss.bonewarden.hit'; f = Math.min(3, Math.floor(e.stT * 4) % 4); }
      else if (e.st === 1 || e.st === 2) { id = 'boss.bonewarden.attack'; f = atkFrame(id, e, t); }
      else { id = At.has('boss.bonewarden.walk') ? 'boss.bonewarden.walk' : 'boss.bonewarden.idle'; f = At.frameAt(id, t); }
      if (!B.spr(id, f, e.x, e.y, o)) { B.circ(e.x, e.y - e.r, e.r, o.flash === 1 ? 0xffffffff : 0xb8b0a0ff, 0); B.circ(e.x, e.y - e.r, e.r, 0xffd27aff, 2); }
      return true;
    },
  };
  // Spectral sword: a ghost blade sinks onto its warned line as the warning fills (the default telegraph draws over it).
  ZF.sword = (B, z, t) => {
    if (!z.warn) return false;
    const k = Math.min(1, z.t / (z.dur || 1)), cx = z.x + Math.cos(z.a) * z.len / 2, cy = z.y + Math.sin(z.a) * z.len / 2, o = reset();
    o.rot = z.a + PI / 2; o.sx = o.sy = 3; o.alpha = 0.25 + 0.6 * k; o.flash = k > 0.8 ? 1 : 0.5;
    if (!B.spr('weapon.longsword', 0, cx, cy - 40 * (1 - k), o)) B.line(cx, cy - 40 * (1 - k) - 20, cx, cy - 40 * (1 - k) + 20, 3, rgba(0xd8e6ff, 120 + 120 * k));
    return false;
  };
  ZF.quake = (B, z, t) => { // warned slam circles: cracks radiate as the warning fills
    if (!z.warn || z.len > 0) return false;
    const k = Math.min(1, z.t / (z.dur || 1)), n = 6, r = z.r || 30;
    for (let i = 0; i < n; i++) { const a = i * TAU / n + (z.id % 7) * 0.3; B.line(z.x, z.y, z.x + Math.cos(a) * r * k, z.y + Math.sin(a) * r * k, 1, rgba(0xffe0b0, 90 + 120 * k)); }
    return false;
  };

  // ---------- Sporemother ----------
  ED.BossFx.spore = {
    draw(B, e, t) {
      const At = A(), o = reset(), rooted = !(e.scale > 1.05);
      if (rooted) for (let i = 0; i < 7; i++) { const a = i * TAU / 7 + e.id * 0.37, l = e.r * (1.2 + 0.25 * Math.sin(t * 2 + i)); B.line(e.x, e.y - 2, e.x + Math.cos(a) * l, e.y + Math.sin(a) * l * 0.5, 2, 0x3d5a2aff); }
      B.shadow(e.x, e.y, e.r * 1.2);
      cues(B, e, t, e.r, 58 * (e.scale || 1));
      o.flip = e.face < 0; o.sx = o.sy = e.scale || 1; o.flash = ED.Actors.hitFlash(e) ? 1 : (e.st === 1 && Math.floor(t * 12) % 2 ? 0.4 : 0);
      let id, f;
      if (e.st === 1) { id = 'boss.sporemother.charge'; f = At.frameAt(id, e.stT); }
      else if (e.st === 2) { id = 'boss.sporemother.attack'; f = atkFrame(id, e, t); }
      else { id = rooted ? 'boss.sporemother.idle' : 'boss.sporemother.walk'; f = At.frameAt(id, t); }
      if (!B.spr(id, f, e.x, e.y, o)) { B.circ(e.x, e.y - e.r, e.r, o.flash === 1 ? 0xffffffff : 0x6a4a8cff, 0); B.circ(e.x, e.y - e.r, e.r, 0x7fe39aff, 2); }
      return true;
    },
  };
  // Spore pod: a pulsing bulb with a glow, bursting colour on hit.
  ED.BossFx.sporepod = {
    draw(B, e, t) {
      const p = 0.5 + 0.5 * Math.sin(t * 4 + e.id), o = reset();
      B.circ(e.x, e.y - 8, 16 + 3 * p, rgba(0x7fe39a, 40 + 30 * p), 0);
      B.shadow(e.x, e.y, 10);
      o.sx = o.sy = 2 + 0.15 * p; o.flash = ED.Actors.hitFlash(e) ? 1 : 0;
      if (!B.spr('foe.sporepuff.idle', A().frameAt('foe.sporepuff.idle', t), e.x, e.y, o)) { B.circ(e.x, e.y - 10, 11 + p, o.flash === 1 ? 0xffffffff : 0x4a8a3aff, 0); B.circ(e.x - 3, e.y - 13, 2, 0xc9ffd9ff, 0); B.circ(e.x + 4, e.y - 8, 2, 0xc9ffd9ff, 0); }
      return true;
    },
  };
  // Carpet patch (look 'spore', not a warning): a dark mossy disc with drifting spores; while it grows only its rim shows. Warnings in this look use the default telegraph.
  ZF.spore = (B, z, t) => {
    if (z.warn) return false;
    const R = z.r, grown = z.t >= 0.8;
    B.circ(z.x, z.y, R, grown ? 0x3a5a22b8 : 0x3a5a2250, 0);
    if (grown) B.circ(z.x + R * 0.15, z.y + R * 0.1, R * 0.6, 0x24401ab0, 0);
    B.circ(z.x, z.y, R, grown ? 0x9fe37ad0 : 0x9fe37a70, 1);
    if (grown) for (let i = 0; i < 3; i++) {
      const a = (z.id * 2.3 + i * 2.1) % TAU, d = R * (0.3 + 0.2 * i), y = z.y + Math.sin(a) * d - ((t * 8 + i * 5 + z.id) % 10);
      B.rect(Math.round(z.x + Math.cos(a) * d), Math.round(y), 2, 2, 0xb8ff9ac0);
    }
    return true;
  };

  // ---------- The Twins ----------
  // Body: the knight sprite at 1.5x over a coloured ring, the weapon drawn in the hand by state (raised on wind-up, swung at the nearest hero on act). Airborne (st 4): lifted over a wide shadow.
  const twin = (wpn, col, rest, wind) => ({
    draw(B, e, t) {
      const At = A(), o = reset(), sc = 1.5, air = e.st === 4, lift = air ? 18 + 4 * Math.sin(t * 9) : 0, y = e.y - lift, f = e.face < 0 ? -1 : 1;
      B.shadow(e.x, e.y, e.r * (air ? 1.4 : 1));
      B.circ(e.x, e.y, e.r + 2, rgba(col, 170), 2);
      cues(B, e, t, e.r, 54);
      o.flip = f < 0; o.sx = o.sy = sc; o.flash = ED.Actors.hitFlash(e) ? 1 : (e.st === 1 && Math.floor(t * 12) % 2 ? 0.4 : 0);
      const id = e.st ? 'foe.skelknight.walk' : 'foe.skelknight.idle';
      if (!B.spr(id, At.frameAt(id, t + e.id * 0.3), e.x, y, o)) B.circ(e.x, y - 20, 16, o.flash === 1 ? 0xffffffff : rgba(col, 255), 0);
      const w = reset();
      w.sx = w.sy = 1.4;
      w.rot = e.st === 1 ? f * wind : e.st === 2 ? toHero(e) + PI / 2 : f * rest;
      if (!B.spr(wpn, 0, e.x + f * 10, y - 16, w)) B.line(e.x + f * 10, y - 16, e.x + f * 10 + Math.sin(w.rot) * 26, y - 16 - Math.cos(w.rot) * 26, 3, rgba(col, 255));
      return true;
    },
  });
  ED.BossFx.twins = twin('weapon.glaive', 0x5fb8ff, 0.35, -(PI / 2 + 0.6));
  ED.BossFx.twinhammer = twin('weapon.alt.big_hammer', 0xff6a4a, 0.5, -0.4);
  // Revive circle: a skull sigil over a filling purple dial (the fallen twin rises when it closes).
  ZF.revive = (B, z, t) => {
    const k = Math.min(1, z.t / (z.dur || 1)), p = 0.5 + 0.5 * Math.sin(t * 8), o = reset();
    B.circ(z.x, z.y, z.r, rgba(0x8a3ad0, 50 + 40 * p), 0);
    if (k > 0.01) B.cone(z.x, z.y, z.r, -PI / 2 + k * PI, k * TAU, rgba(0xc58aff, 110), 0);
    B.circ(z.x, z.y, z.r, rgba(0xc58aff, 220), 2);
    o.sx = o.sy = 3; o.alpha = 0.6 + 0.4 * p;
    if (!B.spr('fx.sigil.skull', 0, z.x, z.y - 6, o)) B.circ(z.x, z.y - 6, 6, 0xffffffcc, 0);
    B.text('RISING', z.x, z.y - z.r - 8, 0xc58aff, 1.5);
    return true;
  };
  // Pull (after its warning): eight spokes spinning inward.
  ZF.pull = (B, z, t) => {
    if (z.warn) return false;
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 - t * 5, r0 = z.r * (1 - ((t * 2 + i / 8) % 1)); B.line(z.x + Math.cos(a) * r0, z.y + Math.sin(a) * r0, z.x + Math.cos(a + 0.3) * (r0 - 18), z.y + Math.sin(a + 0.3) * (r0 - 18), 2, 0xbfe4ffb0); }
    B.circ(z.x, z.y, z.r, 0xbfe4ff60, 1);
    return true;
  };
  // Bind web (after its warning): spokes and two rings in pale white.
  ZF.bind = (B, z) => {
    if (z.warn) return false;
    B.circ(z.x, z.y, z.r, 0xe8e8f040, 0);
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; B.line(z.x, z.y, z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r, 1, 0xe8e8f0c0); }
    B.circ(z.x, z.y, z.r * 0.5, 0xe8e8f0c0, 1); B.circ(z.x, z.y, z.r, 0xe8e8f0e0, 1);
    return true;
  };
})(globalThis.ED || (globalThis.ED = {}));
