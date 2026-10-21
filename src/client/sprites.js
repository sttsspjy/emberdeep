// Procedural character art: chunky outlined silhouettes, two-tone shading and glowing eyes.
// Every sprite draws at the entity's ground position (0,0) with the body rising above it.
(function (ED) {
  'use strict';
  const U = ED.U;
  const Sp = ED.Sprites = {};
  const OUT = '#0b0806';
  const WHITE = { a: '#ffffff', b: '#f2f2f2', c: '#ffffff', d: '#ffffff' };

  // ---------- helpers ----------
  const ell = (c, x, y, rx, ry, fill, stroke = true, rot = 0) => { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, U.TAU); c.fillStyle = fill; c.fill(); if (stroke) c.stroke(); };
  const circ = (c, x, y, r, fill, stroke = true) => ell(c, x, y, r, r, fill, stroke);
  const NATIVE_RR = typeof CanvasRenderingContext2D !== 'undefined' && !!CanvasRenderingContext2D.prototype.roundRect; // one native call instead of moveTo + 4 arcTo + closePath
  const rrect = (c, x, y, w, h, r, fill, stroke = true) => {
    c.beginPath();
    if (NATIVE_RR) c.roundRect(x, y, w, h, r);
    else { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    c.fillStyle = fill; c.fill(); if (stroke) c.stroke();
  };
  const poly = (c, pts, fill, stroke = true) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fillStyle = fill; c.fill(); if (stroke) c.stroke(); };
  let halos = null, hQ = 1, hX = 0, hY = 0; // while a foe frame bakes: halos of radius >= HALO_R are recorded in sprite space (drawn live under the frame) so the frame stays small
  const HALO_R = 16;
  const glow = (c, x, y, r, color, a = 0.5) => {
    if (ED.Render && ED.Render.glowSprite) {
      // cached gradient sprite: far cheaper than building a gradient per entity per frame
      const prev = c.globalAlpha;
      if (halos && r >= HALO_R) {
        const m = c.getTransform();
        halos.push({ x: (m.a * x + m.c * y + m.e - hX) / hQ, y: (m.b * x + m.d * y + m.f - hY) / hQ, r: r * Math.hypot(m.a, m.b) / hQ, col: color, a: prev * Math.min(1, a * 1.3) });
        return;
      }
      c.globalAlpha = prev * Math.min(1, a * 1.3);
      c.drawImage(ED.Render.glowSprite(color), x - r, y - r, r * 2, r * 2);
      c.globalAlpha = prev;
      return;
    }
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, U.rgba(color, a)); g.addColorStop(1, U.rgba(color, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, U.TAU); c.fill();
  };
  const eyes = (c, x, y, gap, r, color) => {
    c.fillStyle = color;
    c.beginPath(); c.arc(x - gap, y, r, 0, U.TAU); c.arc(x + gap, y, r, 0, U.TAU); c.fill();
    c.fillStyle = U.rgba(color, 0.3);
    c.beginPath(); c.arc(x - gap, y, r * 2.2, 0, U.TAU); c.arc(x + gap, y, r * 2.2, 0, U.TAU); c.fill();
  };
  let baking = false; // true while a foe flipbook frame is painted: float bob and aimed parts are left to the blitter and the live overlays
  const bobY = (t, e, k, a) => (baking ? 0 : Math.sin(t * k + e.id) * a);
  Sp.shadow = (c, r, a = 0.35) => { c.fillStyle = `rgba(0,0,0,${a})`; c.beginPath(); c.ellipse(0, r * 0.55, r * 1.1, r * 0.42, 0, 0, U.TAU); c.fill(); };
  Sp.glow = glow;

  // ---------- weapons (drawn along +x, rotated by caller) ----------
  const WEAPON = {
    sword(c, C) { rrect(c, 4, -2, 6, 4, 1, '#5a3b22'); rrect(c, 9, -5, 3, 10, 1, C.c); poly(c, [12, -2.5, 30, -1.5, 34, 0, 30, 1.5, 12, 2.5], '#dfe6ee'); c.strokeStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.moveTo(14, -0.6); c.lineTo(29, -0.6); c.stroke(); c.strokeStyle = OUT; },
    hammer(c, C) { rrect(c, 2, -1.8, 24, 3.6, 1, '#6b4a2e'); rrect(c, 22, -8, 9, 16, 2, '#9aa3ad'); rrect(c, 24, -6, 5, 12, 1, '#c7ced6', false); },
    spear(c, C) { rrect(c, -6, -1.6, 38, 3.2, 1, '#7a5532'); poly(c, [32, -4, 44, 0, 32, 4], '#dfe6ee'); rrect(c, 29, -3, 3, 6, 1, C.c); },
    bow(c, C) { c.lineWidth = 3; c.strokeStyle = '#6b4a2e'; c.beginPath(); c.arc(4, 0, 14, -1.2, 1.2); c.stroke(); c.lineWidth = 1; c.strokeStyle = '#eee3c8'; c.beginPath(); c.moveTo(4 + Math.cos(-1.2) * 14, Math.sin(-1.2) * 14); c.lineTo(4 + Math.cos(1.2) * 14, Math.sin(1.2) * 14); c.stroke(); c.lineWidth = 1.6; c.strokeStyle = OUT; },
    crossbow(c, C) { rrect(c, 0, -2, 20, 4, 1, '#6b4a2e'); c.lineWidth = 3; c.strokeStyle = '#4a3a2a'; c.beginPath(); c.arc(14, 0, 10, -1.4, 1.4); c.stroke(); c.lineWidth = 1.6; c.strokeStyle = OUT; poly(c, [18, -1.5, 26, 0, 18, 1.5], '#cfd6de'); },
    staff(c, C, t) { rrect(c, -4, -1.6, 30, 3.2, 1, '#5a3b22'); glow(c, 28, 0, 12, C.c, 0.55); circ(c, 28, 0, 4.5, C.c); circ(c, 27, -1.2, 1.6, '#ffffff', false); },
    wand(c, C) { rrect(c, 0, -1.3, 18, 2.6, 1, '#3a2a40'); glow(c, 20, 0, 9, C.c, 0.6); circ(c, 20, 0, 3, C.c); },
    tome(c, C) { rrect(c, 4, -7, 14, 14, 2, '#6b1d1a'); rrect(c, 6, -6, 10, 12, 1, '#efe2c4', false); glow(c, 11, 0, 12, '#ff8a3d', 0.4); },
    dagger(c, C) { rrect(c, 3, -1.5, 5, 3, 1, '#2b2233'); poly(c, [8, -2.2, 22, 0, 8, 2.2], '#d9dfe8'); },
    scythe(c, C) { rrect(c, -4, -1.4, 30, 2.8, 1, '#3a2a30'); c.beginPath(); c.moveTo(26, -1); c.quadraticCurveTo(30, -18, 14, -22); c.quadraticCurveTo(24, -12, 22, -1); c.closePath(); c.fillStyle = '#cdd4dc'; c.fill(); c.stroke(); },
    mace(c, C) { rrect(c, 2, -1.6, 18, 3.2, 1, '#6b4a2e'); circ(c, 22, 0, 6, '#c9b16a'); for (let i = 0; i < 6; i++) { const a = i * 1.047; poly(c, [22 + Math.cos(a) * 5, Math.sin(a) * 5 - 1.4, 22 + Math.cos(a) * 9, Math.sin(a) * 9, 22 + Math.cos(a) * 5, Math.sin(a) * 5 + 1.4], '#e6d08a'); } },
    lantern(c, C) { c.beginPath(); c.moveTo(6, 0); c.lineTo(12, -6); c.stroke(); rrect(c, 9, -6, 9, 12, 2, '#c9a640'); glow(c, 13.5, 0, 16, '#ffe9a0', 0.55); rrect(c, 11, -4, 5, 8, 1, '#fff6c8', false); },
  };

  // ---------- heroes ----------
  const HEADS = {
    knight(c, C, pc) { rrect(c, -7.5, -27, 15, 13, 5, C.a); rrect(c, -7.5, -21.5, 15, 3, 1, C.d, false); c.fillStyle = '#ffdc8a'; c.fillRect(1.5, -21, 4, 1.6); poly(c, [0, -27, 4, -34, -6, -36, -3, -28], pc); },
    ranger(c, C, pc) { ell(c, 0, -21, 7.5, 7.5, '#e8c4a0'); c.beginPath(); c.moveTo(-9, -16); c.quadraticCurveTo(-9, -31, 0, -31); c.quadraticCurveTo(9, -31, 9, -16); c.lineTo(5, -18); c.quadraticCurveTo(0, -27, -5, -18); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke(); c.fillStyle = '#2a1a10'; c.fillRect(2, -21, 2, 2.2); c.fillRect(5.5, -21, 1.6, 2.2); },
    pyro(c, C, pc) { ell(c, 0, -20, 7, 7, '#e8c4a0'); ell(c, 0, -25.5, 12, 3.4, C.a); poly(c, [-7, -26, 7, -26, 3, -40, -1, -44, -3, -38], C.a); rrect(c, -7, -28, 14, 2.6, 1, pc, false); c.fillStyle = '#2a1a10'; c.fillRect(2, -20.5, 2, 2.2); c.fillRect(5.5, -20.5, 1.6, 2.2); },
    shade(c, C, pc) { c.beginPath(); c.moveTo(-8.5, -14); c.quadraticCurveTo(-9, -31, 0, -31); c.quadraticCurveTo(9, -31, 8.5, -14); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke(); ell(c, 1.5, -20, 5.5, 5, '#0d0b12', false); eyes(c, 2, -20.5, 2.4, 1.2, C.c); rrect(c, -8, -15.5, 16, 3, 1.5, pc, false); },
    cleric(c, C, pc) { ell(c, 0, -20, 7, 7, '#e8c4a0'); poly(c, [-6.5, -24, 6.5, -24, 5, -33, 0, -37, -5, -33], C.a); rrect(c, -1, -35, 2, 9, 0.5, '#d6aa55', false); rrect(c, -4, -31.5, 8, 2, 0.5, '#d6aa55', false); c.strokeStyle = U.rgba('#ffe9a0', 0.7); c.beginPath(); c.ellipse(0, -39, 8, 2.6, 0, 0, U.TAU); c.stroke(); c.strokeStyle = OUT; c.fillStyle = '#2a1a10'; c.fillRect(2, -20.5, 2, 2.2); c.fillRect(5.5, -20.5, 1.6, 2.2); },
    necro(c, C, pc) { c.beginPath(); c.moveTo(-9, -14); c.quadraticCurveTo(-9, -32, 0, -32); c.quadraticCurveTo(9, -32, 9, -14); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke(); ell(c, 1, -20, 5.6, 5.8, '#e6e0cf'); c.fillStyle = '#0b0806'; c.fillRect(-1.6, -21.5, 2.6, 2.6); c.fillRect(2.8, -21.5, 2.6, 2.6); eyes(c, 1.6, -20.2, 2.2, 0.8, C.c); rrect(c, -9, -15, 18, 2.6, 1.3, pc, false); },
  };

  // Weapon art of hero p: { id (base weapon id, before any '@' fork suffix), w (ED.WEAPONS entry), anim (atlas anim id), look, twin (off-hand copy) }. The one place weapon looks are resolved.
  const WART = {}, TWIN = { daggers: 1, twinbows: 1, scythes: 1 };
  Sp.weaponArt = (p) => {
    const cls = ED.CLASSES[p.cls], id = String((p.stats && p.stats.weaponId) || p.weapon || (cls && cls.weapons[0]) || 'longsword');
    let d = WART[id];
    if (!d) {
      const base = id.split('@')[0], w = ED.WEAPONS[base] || ED.WEAPONS[cls.weapons[0]];
      d = WART[id] = { id: base, w, anim: 'weapon.' + base, look: w.look, twin: !!TWIN[base] };
    }
    return d;
  };

  Sp.hero = (c, p, t, anim) => {
    const cls = ED.CLASSES[p.cls]; if (!cls) return;
    if (ED.Actors && ED.Actors.on() && ED.Actors.hero(c, p, t, anim)) return;
    const C = p.flash > 0 ? WHITE : cls.col;
    const pc = ED.PLAYER_COLORS[p.slot] || '#ffffff';
    const face = p.face || 0;
    const dir = Math.cos(face) >= 0 ? 1 : -1;
    c.save();
    c.lineWidth = 1.6; c.strokeStyle = OUT; c.lineJoin = 'round';
    if (p.dead) { c.globalAlpha = 0.5; Sp.shadow(c, 9); poly(c, [-8, -2, 8, -2, 6, 6, -6, 6], '#3a3a3a'); circ(c, 0, -6, 4, '#9a9a9a'); c.restore(); return; }
    Sp.shadow(c, 10);
    if (p.downed) {
      c.rotate(-1.35 * dir); c.translate(-4, 2);
      drawBody(c, p, C, pc, cls, t, 0, dir, null);
      c.restore();
      return;
    }
    if (p.invuln > 0 && !p.dashing && Math.floor(t * 20) % 2 === 0) c.globalAlpha = 0.55;
    if (p.dashing) c.globalAlpha = 0.7;
    if (p.stealthT > 0) c.globalAlpha *= p.pid === (ED.Render && ED.Render.local) ? 0.45 : 0.2; // Vanish: readable to yourself, nearly gone to allies
    const bob = p.moving ? Math.abs(Math.sin(t * 12 + (p.slot || 0))) * 2.2 : Math.sin(t * 2.4) * 0.6;
    drawBody(c, p, C, pc, cls, t, bob, dir, anim);
    c.restore();
  };

  function drawBody(c, p, C, pc, cls, t, bob, dir, anim) {
    const face = p.face || 0;
    const w = ED.WEAPONS[p.weapon] || ED.WEAPONS[cls.weapons[0]];
    // Weapon swing: anticipation (pull back, crouch) -> fast strike (accelerating sweep, lunge) -> follow-through (overshoot, settle). push: -1..1 body lunge along the aim.
    let wa = face, reach = 1, push = 0;
    const swinging = !!anim && anim.atkT < anim.D;
    if (swinging) {
      const u = anim.atkT, t0 = anim.t0, t1 = anim.t1, D = anim.D, side = anim.side || 1;
      const k0 = u < t0 ? u / t0 : 1, k1 = U.clamp((u - t0) / (t1 - t0), 0, 1), k2 = U.clamp((u - t1) / (D - t1), 0, 1), e1 = 1 - Math.pow(1 - k1, 3), e2 = U.easeInOut(k2);
      if (w.kind === 'melee') {
        const spin = w.arc > 6, thrust = w.arc < 1, half = spin ? 0 : thrust ? 0.1 : w.arc * 0.6, pull = thrust ? 0.1 : 0.32, rA = thrust ? 0.72 : 0.92, rS = thrust ? 1.4 : 1.18;
        let off = 0;
        if (u < t0) { off = -side * (half + pull * U.easeOut(k0)); push = -0.55 * k0; reach = 1 - (1 - rA) * k0; if (spin) wa = face - 0.4 * U.easeOut(k0); }
        else if (u < t1) { off = -side * (half + pull) * (1 - e1) + side * half * e1; push = -0.55 + 1.55 * e1; reach = rA + (rS - rA) * e1; if (spin) wa = face - 0.4 + (U.TAU + 0.4) * e1; }
        else { off = side * (half * (1 - e2) + 0.18 * Math.sin(k2 * Math.PI)); push = 1 - e2; reach = rS + (1 - rS) * e2; }
        if (!spin) wa = face + off; else if (u >= t1) wa = face;
      } else { const kick = Math.exp(-u * 26); reach = 1 - 0.22 * kick; push = -0.8 * kick; }
    }
    const behind = Math.sin(wa) < -0.25;
    if (swinging && push) { const L = w.arc < 1 ? 4.6 : 3.2; c.save(); c.translate(Math.cos(face) * push * L, Math.sin(face) * push * L * 0.5); c.scale(1 - 0.04 * push, 1 + 0.06 * push); }
    const drawWeapon = () => {
      c.save(); c.translate(0, -11 - bob); c.rotate(wa); c.scale(reach, Math.cos(wa) < 0 ? -1 : 1);
      const ec = p.stats && p.stats.evo && ED.PATHS[p.stats.evo] ? ED.PATHS[p.stats.evo].color : null; // evolved weapons glow in their path colour
      (WEAPON[w.look] || WEAPON.sword)(c, Object.assign({}, C, { c: ec || cls.col.c }), t);
      if (ec) { glow(c, 20, 0, 24, ec, 0.5 + Math.sin(t * 5) * 0.1); c.strokeStyle = U.rgba(ec, 0.6); c.lineWidth = 2.2; c.beginPath(); c.moveTo(6, 0); c.lineTo(32, 0); c.stroke(); }
      c.restore();
    };
    if (behind) drawWeapon();
    // legs
    const step = p.moving ? Math.sin(t * 12 + (p.slot || 0)) * 3 : 0;
    rrect(c, -5 + step * 0.4, -4, 4, 6, 1.5, C.d || '#222');
    rrect(c, 1 - step * 0.4, -4, 4, 6, 1.5, C.d || '#222');
    // body
    c.save(); c.translate(0, -bob); c.scale(dir, 1);
    const cape = Math.sin(t * 6) * 1.2;
    if (p.cls === 'knight') {
      poly(c, [-7, -16, 7, -16, 9 + cape, -2, -9 - cape, -2], pc);
      rrect(c, -7.5, -17, 15, 14, 4, C.a); rrect(c, -7.5, -8, 15, 3, 1, C.b, false); circ(c, -6, -14, 3.5, C.b);
    } else if (p.cls === 'ranger') {
      poly(c, [-8, -16, 8, -16, 10 + cape, -1, -10 - cape, -1], C.b);
      rrect(c, -6.5, -16, 13, 12, 4, C.a); rrect(c, -7, -16.5, 14, 3.5, 1.5, pc, false); rrect(c, -6.5, -8, 13, 2, 1, C.c, false);
    } else if (p.cls === 'pyro' || p.cls === 'cleric' || p.cls === 'necro') {
      poly(c, [-6, -17, 6, -17, 10 + cape, -1, -10 - cape, -1], C.a);
      poly(c, [-2, -16, 2, -16, 3, -1, -3, -1], p.cls === 'cleric' ? '#d6aa55' : C.b, false);
      rrect(c, -6, -10, 12, 2.2, 1, p.cls === 'necro' ? pc : C.c, false);
      if (p.cls !== 'necro') rrect(c, -6.5, -17.5, 13, 3, 1.5, pc, false);
    } else if (p.cls === 'shade') {
      poly(c, [-6, -16, 6, -16, 8 + cape * 2, 0, 2, -3, -2, 0, -8 - cape, -2], C.a);
      rrect(c, -5.5, -12, 11, 2, 1, C.c, false);
    }
    (HEADS[p.cls] || HEADS.knight)(c, C, pc);
    if (p.mastery10) { c.strokeStyle = U.rgba('#ffd36b', 0.55 + Math.sin(t * 4) * 0.25); c.lineWidth = 1.2; c.beginPath(); c.ellipse(0, -2, 13, 4, 0, 0, U.TAU); c.stroke(); c.strokeStyle = OUT; c.lineWidth = 1.6; }
    c.restore();
    if (!behind) drawWeapon();
    if (swinging && push) c.restore();
  }

  // [anticipation end, strike end, total] seconds of a weapon's attack animation: heavy weapons wind up longer, light ones snap.
  Sp.atkTimes = (w) => { const k = U.clamp(w.rate / 0.42, 0.55, 1.5); return [0.05 * k, 0.12 * k, U.clamp(w.rate * 0.7, 0.2, 0.5)]; };

  Sp.portrait = (canvas, cls, slot, weapon) => {
    if (ED.Actors && ED.Actors.on() && ED.Actors.portrait(canvas, cls, slot, weapon)) return;
    const c = canvas.getContext('2d');
    const s = canvas.width / 56;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const g = c.createRadialGradient(canvas.width / 2, canvas.height * 0.6, 2, canvas.width / 2, canvas.height * 0.6, canvas.width * 0.55);
    g.addColorStop(0, U.rgba(ED.CLASSES[cls].col.c, 0.35)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, canvas.width, canvas.height);
    c.save(); c.translate(canvas.width / 2, canvas.height * 0.86); c.scale(s * 1.25, s * 1.25);
    Sp.hero(c, { cls, slot: slot || 0, weapon: weapon || ED.CLASSES[cls].weapons[0], face: 0.3, moving: false, hp: 1 }, 0.8, null);
    c.restore();
  };

  // ---------- enemies ----------
  const LOOK = {};

  const bowSprite = () => ED.Render.sprite('bow', 3, -16, 20, 16, false, (g) => { g.lineWidth = 1.6; g.strokeStyle = OUT; g.lineJoin = 'round'; g.lineCap = 'round'; WEAPON.bow(g, null); });
  const bowArm = (c, e, C) => { const sp = bowSprite(); c.save(); c.translate(6, -12); c.rotate(e.aimA ? Math.atan2(Math.sin(e.aimA), Math.abs(Math.cos(e.aimA))) : 0); c.drawImage(sp.cv, sp.x, sp.y, sp.w, sp.h); c.restore(); };
  LOOK.skeleton = (c, e, C, t, s) => {
    const bob = Math.abs(Math.sin(t * 9 + e.id)) * 1.5 * s;
    const wind = e.st === 'windup' || e.st === 'aim';
    c.save(); c.scale(s, s);
    const step = Math.sin(t * 9 + e.id) * 2.5;
    c.lineWidth = 1.5;
    c.strokeStyle = OUT; rrect(c, -4.5 + step * 0.3, -6, 3, 7, 1, C.b); rrect(c, 1.5 - step * 0.3, -6, 3, 7, 1, C.b);
    c.translate(0, -bob);
    rrect(c, -6, -17, 12, 11, 3, C.a);
    c.strokeStyle = C.b; c.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-4.5, -14 + i * 2.8); c.lineTo(4.5, -14 + i * 2.8); c.stroke(); }
    c.strokeStyle = OUT; c.lineWidth = 1.5;
    if (e.def.look === 'zombie') { poly(c, [-7, -10, 7, -10, 8, -3, -8, -3], '#3d5a40'); }
    circ(c, 0.5, -22, 6.5, C.a); rrect(c, -3, -18.5, 7, 3.5, 1, C.a);
    c.fillStyle = '#120a08'; c.beginPath(); c.arc(-1.8, -22.5, 1.9, 0, U.TAU); c.arc(2.8, -22.5, 1.9, 0, U.TAU); c.fill();
    eyes(c, 0.5, -22.5, 2.3, wind ? 1.3 : 0.9, C.c);
    if (e.def.bow) { if (!baking) bowArm(c, e, C); }
    else if (e.def.look !== 'zombie') { c.save(); c.translate(6, -12); c.rotate(wind ? -1.2 : 0.4); rrect(c, 0, -1, 14, 2, 1, '#8a8478'); c.restore(); }
    c.restore();
  };
  LOOK.zombie = LOOK.skeleton;

  LOOK.bat = (c, e, C, t, s) => {
    const flap = Math.sin(t * 22 + e.id) ;
    c.save(); c.scale(s, s); c.translate(0, -14 + bobY(t, e, 5, 2));
    c.lineWidth = 1.4;
    for (const sd of [-1, 1]) { c.save(); c.scale(sd, 1); poly(c, [3, -1, 14, -6 - flap * 6, 12, 0, 16, 2 - flap * 3, 8, 4], C.b); c.restore(); }
    ell(c, 0, 0, 5.5, 5, C.a);
    poly(c, [-4, -3, -3, -8, -1, -4], C.a); poly(c, [4, -3, 3, -8, 1, -4], C.a);
    eyes(c, 0, -0.5, 2, 1, C.c);
    c.restore();
  };

  LOOK.slime = (c, e, C, t, s) => {
    const sq = Math.sin(t * 6 + e.id) * 0.12;
    const r = e.def.r * s;
    c.save();
    c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(0, -r * (0.75 - sq * 0.5), r * (1.05 + sq), r * (0.8 - sq), 0, Math.PI, 0); c.lineTo(r * (1.05 + sq), 0); c.quadraticCurveTo(0, r * 0.3, -r * (1.05 + sq), 0); c.closePath();
    c.fillStyle = C.a; c.globalAlpha = 0.92; c.fill(); c.globalAlpha = 1; c.stroke();
    ell(c, 0, -r * 0.35, r * 0.55, r * 0.3, C.b, false);
    ell(c, -r * 0.4, -r * 1.05, r * 0.25, r * 0.14, 'rgba(255,255,255,0.65)', false, -0.4);
    c.fillStyle = C.c; c.beginPath(); c.arc(-r * 0.3, -r * 0.65, r * 0.12, 0, U.TAU); c.arc(r * 0.3, -r * 0.65, r * 0.12, 0, U.TAU); c.fill();
    c.restore();
  };

  LOOK.jelly = (c, e, C, t, s) => {
    const r = e.def.r * s, bob = bobY(t, e, 3, 2);
    const pulse = e.st === 'cast';
    c.save(); c.translate(0, -r - 6 + bob);
    glow(c, 0, 0, pulse ? r * 3.6 : r * 2.2, pulse ? '#ffffff' : C.a, pulse ? 0.7 : 0.25);
    c.strokeStyle = U.rgba(C.a, 0.8); c.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) { const x = (i - 2) * r * 0.35; c.beginPath(); c.moveTo(x, 0); c.quadraticCurveTo(x + Math.sin(t * 3 + i) * 4, r * 0.8, x + Math.sin(t * 3 + i) * 3, r * 1.4); c.stroke(); }
    c.strokeStyle = OUT; c.lineWidth = 1.4;
    c.beginPath(); c.arc(0, 0, r, Math.PI, 0); c.quadraticCurveTo(0, r * 0.35, -r, 0); c.closePath(); c.fillStyle = U.rgba(C.a, 0.85); c.fill(); c.stroke();
    ell(c, 0, -r * 0.45, r * 0.45, r * 0.25, U.rgba(C.c, 0.7), false);
    eyes(c, 0, -r * 0.2, r * 0.28, r * 0.09, '#2a0d24');
    c.restore();
  };

  LOOK.knight = (c, e, C, t, s) => {
    const wind = e.st === 'windup';
    const bob = Math.abs(Math.sin(t * 7 + e.id)) * 1.2;
    const step = Math.sin(t * 7 + e.id) * 2.5;
    const g = !!e.def.guard, behind = g && Math.sin(faceAngle(e)) < -0.3;
    if (behind && !baking) guardArc(c, e, '#8f98a3', 14 * s, 5, '#dfe6ee');
    c.save(); c.scale(s, s); c.lineWidth = 1.6;
    rrect(c, -6 + step * 0.3, -6, 5, 7, 1.5, C.b); rrect(c, 1 - step * 0.3, -6, 5, 7, 1.5, C.b);
    c.translate(0, -bob);
    poly(c, [-9, -21, 9, -21, 11, -4, -11, -4], U.shade(C.b, -0.2));
    rrect(c, -9, -22, 18, 17, 4, C.a);
    circ(c, -9, -19, 5, C.b); circ(c, 9, -19, 5, C.b);
    rrect(c, -6.5, -34, 13, 13, 4, C.a);
    rrect(c, -5, -29, 10, 2.5, 1, '#0b0806', false);
    c.fillStyle = C.c; c.fillRect(-4, -28.6, 3, 1.8); c.fillRect(1, -28.6, 3, 1.8);
    glow(c, 0, -28, 8, C.c, wind ? 0.6 : 0.3);
    c.save(); c.translate(10, -15); c.rotate(wind ? -2.2 : 0.5); rrect(c, -1, -1.5, 22, 3, 1, '#4a4a4a'); poly(c, [16, -6, 26, -2, 26, 2, 16, 6], '#b9c0c8'); c.restore();
    c.restore();
    if (g && !behind && !baking) guardArc(c, e, '#8f98a3', 14 * s, 5, '#dfe6ee');
  };

  LOOK.shroom = (c, e, C, t, s) => {
    const bob = Math.abs(Math.sin(t * 7 + e.id)) * 1.5;
    c.save(); c.scale(s, s); c.lineWidth = 1.5;
    const step = Math.sin(t * 7 + e.id) * 2;
    rrect(c, -5 + step * 0.3, -5, 4, 6, 1.5, '#d8cfc0'); rrect(c, 1 - step * 0.3, -5, 4, 6, 1.5, '#d8cfc0');
    c.translate(0, -bob);
    rrect(c, -6, -14, 12, 11, 4, '#e8dfcf');
    eyes(c, 0, -9, 2.4, 1.1, '#1a0d10');
    c.beginPath(); c.ellipse(0, -15, 13, 9, 0, Math.PI, 0); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    c.fillStyle = C.c; for (const [x, y, r] of [[-6, -19, 2.2], [3, -21, 2.6], [8, -16.5, 1.6], [-1, -16, 1.4]]) { c.beginPath(); c.arc(x, y, r, 0, U.TAU); c.fill(); }
    glow(c, 0, -18, 16, C.c, 0.18);
    c.restore();
  };

  LOOK.hulk = (c, e, C, t, s) => {
    const wind = e.st === 'windup';
    const bob = Math.abs(Math.sin(t * 5 + e.id)) * 1.5;
    c.save(); c.scale(s, s); c.lineWidth = 1.7;
    rrect(c, -8, -6, 6, 7, 2, '#cfc3ae'); rrect(c, 2, -6, 6, 7, 2, '#cfc3ae');
    c.translate(0, -bob);
    rrect(c, -10, -22, 20, 18, 6, '#e3d8c4');
    ell(c, -12, -12 + (wind ? -8 : 0), 4.5, 7, '#d6cab4'); ell(c, 12, -12 + (wind ? -8 : 0), 4.5, 7, '#d6cab4');
    eyes(c, 0, -15, 3.2, 1.3, '#1a0d10');
    c.beginPath(); c.ellipse(0, -22, 17, 12, 0, Math.PI, 0); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    c.fillStyle = C.c; for (const [x, y, r] of [[-8, -27, 3], [4, -30, 3.4], [11, -24, 2], [-2, -24, 1.8]]) { c.beginPath(); c.arc(x, y, r, 0, U.TAU); c.fill(); }
    glow(c, 0, -25, 22, C.c, wind ? 0.35 : 0.15);
    c.restore();
  };

  LOOK.puff = (c, e, C, t, s) => {
    const fuse = e.st === 'fuse';
    const pulse = fuse ? 1 + Math.sin(t * 40) * 0.15 : 1 + Math.sin(t * 4 + e.id) * 0.06;
    const r = e.def.r * s * pulse;
    c.save(); c.translate(0, -r - 5 + bobY(t, e, 3, 2));
    glow(c, 0, 0, r * 2.4, fuse ? '#ff6a3a' : C.a, fuse ? 0.6 : 0.3);
    c.lineWidth = 1.4;
    c.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * U.TAU, rr = i % 2 ? r : r * 1.25; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    c.closePath(); c.fillStyle = fuse && Math.floor(t * 16) % 2 ? '#fff6de' : C.a; c.fill(); c.stroke();
    circ(c, 0, 0, r * 0.55, C.b, false);
    eyes(c, 0, -r * 0.1, r * 0.3, r * 0.12, '#14200a');
    c.restore();
  };

  LOOK.spitter = (c, e, C, t, s) => {
    const aim = e.st === 'aim';
    c.save(); c.scale(s, s); c.lineWidth = 1.6;
    rrect(c, -4, -14, 8, 14, 3, '#e8dfcf');
    const sq = aim ? Math.sin(t * 30) * 1 : 0;
    c.beginPath(); c.ellipse(0, -16, 12 + sq, 9 - sq, 0, Math.PI, 0); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    c.save(); c.translate(0, -16); c.rotate(e.aimA || 0); ell(c, 9, 0, 4, 3.4, '#1a0d10'); c.restore();
    c.fillStyle = C.c; for (const [x, y] of [[-6, -20], [3, -22], [7, -18]]) { c.beginPath(); c.arc(x, y, 1.8, 0, U.TAU); c.fill(); }
    glow(c, 0, -18, 16, C.a, aim ? 0.5 : 0.2);
    c.restore();
  };

  LOOK.spider = (c, e, C, t, s) => {
    const wind = e.st === 'windup', web = e.st === 'aim';
    c.save(); c.scale(s, s); c.lineWidth = 1.6;
    if (web) { c.translate(0, -3); c.rotate(-0.28); glow(c, -9, -8, 11, '#ffffff', 0.7); }
    c.strokeStyle = C.b;
    for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
      const ph = Math.sin(t * 16 + i + (sd > 0 ? 1.5 : 0)) * 2;
      c.beginPath(); c.moveTo(sd * 3, -6 + i * 1.5); c.lineTo(sd * (10 + i), -11 + i * 2 + ph); c.lineTo(sd * (13 + i), -1 + i * 0.5); c.stroke();
    }
    c.strokeStyle = OUT; c.lineWidth = 1.5;
    ell(c, -4, -7, 7, 6, C.a); ell(c, 4, -6, 4.5, 4, C.b);
    c.fillStyle = C.c; for (const [x, y] of [[5, -7], [7, -6.5], [5.5, -5], [7.5, -5]]) { c.beginPath(); c.arc(x, y, wind ? 1.1 : 0.8, 0, U.TAU); c.fill(); }
    c.restore();
  };

  LOOK.wolf = (c, e, C, t, s) => {
    const run = e.st === 'charge' ? 2 : 1;
    const ph = t * 12 * run + e.id;
    c.save(); c.scale(s, s); c.lineWidth = 1.5;
    for (const [x, o] of [[-7, 0], [-3, 1.6], [4, 0.8], [8, 2.4]]) rrect(c, x, -7 + Math.sin(ph + o) * 1.5, 3, 7, 1, C.b);
    poly(c, [-10, -12, -16, -16 + Math.sin(ph) * 2, -12, -9], C.b);
    ell(c, 0, -11, 11, 5.5, C.a);
    if (e.def.charge && e.def.charge.trail) { c.strokeStyle = '#ff8a2a'; c.lineWidth = 1; c.beginPath(); c.moveTo(-6, -13); c.lineTo(-1, -9); c.lineTo(4, -13); c.stroke(); c.strokeStyle = OUT; c.lineWidth = 1.5; }
    const howl = e.st === 'cast';
    c.save(); if (howl) { c.translate(7, -10); c.rotate(-0.75); c.translate(-7, 10); }
    poly(c, [7, -16, 16, -13, 18, -9, 10, -7, 6, -10], C.a);
    poly(c, [8, -15, 9, -21, 12, -15], C.a);
    c.fillStyle = C.c; c.beginPath(); c.arc(12.5, -12.5, 1.2, 0, U.TAU); c.fill();
    glow(c, 12.5, -12.5, howl ? 9 : 4, C.c, e.st === 'windup' || howl ? 0.8 : 0.35);
    c.restore();
    if (howl) { c.strokeStyle = U.rgba(C.c, 0.55); c.lineWidth = 1.2; for (let i = 0; i < 2; i++) { c.beginPath(); c.arc(14, -24, 6 + i * 5 + (t * 20 % 4), -2.2, -0.6); c.stroke(); } c.strokeStyle = OUT; c.lineWidth = 1.5; }
    c.restore();
  };

  LOOK.wisp = (c, e, C, t, s) => {
    const dive = e.st === 'dive', wind = e.st === 'windup';
    c.save(); c.translate(0, -16 + bobY(t, e, 4, 3)); c.scale(s, s);
    if (dive) { const la = faceAngle(e); c.strokeStyle = U.rgba(C.a, 0.7); c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.lineTo(-Math.cos(la) * 22, -Math.sin(la) * 22); c.stroke(); c.lineCap = 'butt'; c.strokeStyle = OUT; c.lineWidth = 1.6; }
    glow(c, 0, 0, wind || dive ? 26 : 18, wind ? '#ffffff' : C.b, wind || dive ? 0.8 : 0.45);
    c.fillStyle = U.rgba(C.a, 0.85);
    c.beginPath(); c.moveTo(-6, 0); c.quadraticCurveTo(-4, 10 + Math.sin(t * 9) * 2, 0, 14); c.quadraticCurveTo(4, 10 + Math.cos(t * 9) * 2, 6, 0); c.closePath(); c.fill();
    c.fillStyle = C.a; c.beginPath(); c.arc(0, -1, 6.5, 0, U.TAU); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, -1, 3.5, 0, U.TAU); c.fill();
    c.fillStyle = '#1a2a40'; c.fillRect(-2.6, -2.4, 1.6, 2.4); c.fillRect(1, -2.4, 1.6, 2.4);
    c.restore();
  };

  LOOK.robed = (c, e, C, t, s) => {
    const cast = e.st === 'cast';
    c.save(); c.scale(s, s); c.translate(0, bobY(t, e, 3, -1)); c.lineWidth = 1.5;
    poly(c, [-6, -18, 6, -18, 10, 0, 4, -2, 0, 0, -4, -2, -10, 0], C.a);
    poly(c, [-2, -18, 2, -18, 3, -1, -3, -1], C.b, false);
    c.beginPath(); c.moveTo(-7.5, -17); c.quadraticCurveTo(-8, -31, 0, -32); c.quadraticCurveTo(8, -31, 7.5, -17); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    ell(c, 1, -22, 4.6, 4.6, '#0b0612', false);
    eyes(c, 1.2, -22.5, 2, 1, C.c);
    const hx = 9, hy = -14 + (cast ? -6 : 0);
    circ(c, hx, hy, 2.4, C.b);
    glow(c, hx, hy - 3, cast ? 14 : 8, C.c, cast ? 0.7 : 0.35);
    circ(c, hx, hy - 3, cast ? 3.6 : 2.4, C.c, false);
    c.restore();
  };

  LOOK.wraith = (c, e, C, t, s) => {
    c.save(); c.scale(s, s); c.translate(0, -8 + bobY(t, e, 2.5, 3));
    c.globalAlpha = 0.88;
    glow(c, 0, -12, 26, C.c, 0.2);
    c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(-9, -18); c.quadraticCurveTo(-10, -34, 0, -34); c.quadraticCurveTo(10, -34, 9, -18);
    for (let i = 0; i <= 6; i++) { const x = 9 - i * 3, y = 2 + Math.sin(t * 6 + i * 1.3) * 3 + (i % 2) * 3; c.lineTo(x, y); }
    c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    ell(c, 0, -24, 5, 5.5, '#05030a', false);
    eyes(c, 0, -24.5, 2.2, 1.1, C.c);
    c.restore();
  };

  LOOK.shade = (c, e, C, t, s) => {
    const wind = e.st === 'windup';
    c.save(); c.scale(s, s); c.globalAlpha = 0.92; c.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) { c.fillStyle = U.rgba(C.b, 0.35 - i * 0.1); c.beginPath(); c.arc(-e.face * (4 + i * 4), -6 - i, 6 - i, 0, U.TAU); c.fill(); }
    c.beginPath(); c.moveTo(-7, -4); c.quadraticCurveTo(-9, -26, 0, -28); c.quadraticCurveTo(9, -26, 7, -4); c.quadraticCurveTo(0, 2 + Math.sin(t * 8) * 2, -7, -4); c.fillStyle = C.a; c.fill(); c.stroke();
    eyes(c, 2, -20, 2.6, wind ? 1.6 : 1.1, C.c);
    c.strokeStyle = C.c; c.lineWidth = 1.2; c.beginPath(); c.moveTo(6, -12); c.lineTo(13, wind ? -22 : -6); c.stroke();
    c.restore();
  };

  LOOK.golem = (c, e, C, t, s) => {
    const wind = e.st === 'windup';
    const bob = Math.abs(Math.sin(t * 5 + e.id)) * 1.2;
    c.save(); c.scale(s, s); c.lineWidth = 1.7;
    rrect(c, -9, -7, 7, 8, 2, C.b); rrect(c, 2, -7, 7, 8, 2, C.b);
    c.translate(0, -bob);
    poly(c, [-12, -24, 12, -24, 14, -6, -14, -6], C.a);
    poly(c, [-10, -24, -2, -24, -4, -14, -12, -16], U.shade(C.a, 0.15), false);
    rrect(c, -7, -33, 14, 10, 3, C.a);
    c.fillStyle = C.c; c.fillRect(-5, -30, 3.4, 2.2); c.fillRect(1.6, -30, 3.4, 2.2);
    glow(c, 0, -15, 10, C.c, wind ? 0.8 : 0.4); circ(c, 0, -15, 3, C.c, false);
    const armY = wind ? -30 : -14;
    rrect(c, -19, armY, 7, 14, 3, C.b); rrect(c, 12, armY, 7, 14, 3, C.b);
    c.restore();
  };

  LOOK.imp = (c, e, C, t, s) => {
    const aim = e.st === 'aim';
    const flap = Math.sin(t * 18 + e.id);
    c.save(); c.scale(s, s); c.translate(0, -6 + bobY(t, e, 6, 2)); c.lineWidth = 1.4;
    for (const sd of [-1, 1]) { c.save(); c.scale(sd, 1); poly(c, [3, -12, 13, -18 - flap * 4, 11, -9, 4, -7], C.b); c.restore(); }
    c.strokeStyle = C.b; c.beginPath(); c.moveTo(-3, -4); c.quadraticCurveTo(-10, 0, -9, -8); c.stroke(); c.strokeStyle = OUT;
    ell(c, 0, -9, 6, 7, C.a);
    poly(c, [-4, -14, -6, -20, -1.5, -15], '#2a1410'); poly(c, [4, -14, 6, -20, 1.5, -15], '#2a1410');
    eyes(c, 0.5, -10, 2.2, 1, C.c);
    if (aim) { glow(c, 6, -16, 12, '#ff9a3a', 0.7); circ(c, 6, -16, 3.5, '#ffb347', false); }
    c.restore();
  };

  LOOK.totem = (c, e, C, t, s) => {
    const firing = e.st === 'spin' || e.st === 'aim';
    c.save(); c.scale(s, s); c.lineWidth = 1.6;
    rrect(c, -9, -26, 18, 26, 3, C.a);
    rrect(c, -10, -6, 20, 6, 2, C.b);
    c.fillStyle = '#0b0806'; c.fillRect(-6, -21, 4, 3); c.fillRect(2, -21, 4, 3); c.fillRect(-4, -14, 8, 3);
    c.fillStyle = C.c; c.fillRect(-5.5, -20.5, 3, 2); c.fillRect(2.5, -20.5, 3, 2);
    const fl = firing ? 1.4 : 1;
    glow(c, 0, -32, 16 * fl, C.c, 0.6);
    c.fillStyle = '#ffcf6a'; c.beginPath(); c.moveTo(-5, -26); c.quadraticCurveTo(-4, -34 * fl, 0, -40 * fl + Math.sin(t * 12) * 2); c.quadraticCurveTo(4, -34 * fl, 5, -26); c.fill();
    c.restore();
  };

  LOOK.eel = (c, e, C, t, s) => {
    c.save(); c.scale(s, s); c.lineWidth = 1.5;
    const segs = 6;
    for (let i = segs; i >= 0; i--) {
      const x = -i * 3.4, y = -8 + Math.sin(t * 10 + e.id - i * 0.8) * 2.5;
      ell(c, x, y, 4.6 - i * 0.4, 4 - i * 0.35, i === 0 ? C.a : (i % 2 ? C.b : C.a));
    }
    poly(c, [2, -11, 9, -8, 2, -5], C.a);
    c.fillStyle = C.c; c.beginPath(); c.arc(4, -9.5, 1, 0, U.TAU); c.fill();
    c.strokeStyle = C.b; c.beginPath(); c.moveTo(3, -12); c.quadraticCurveTo(8, -20, 10, -16); c.stroke();
    glow(c, 10, -16, 7, C.c, 0.7); c.fillStyle = C.c; c.beginPath(); c.arc(10, -16, 1.6, 0, U.TAU); c.fill();
    c.restore();
  };

  LOOK.crab = (c, e, C, t, s) => {
    const wind = e.st === 'windup', behind = Math.sin(faceAngle(e)) < -0.3;
    if (behind && !baking) guardArc(c, e, C.b, 9 * s, 4.5, U.shade(C.a, 0.35));
    c.save(); c.scale(s, s); c.lineWidth = 1.6;
    c.strokeStyle = C.b;
    for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(sd * 6, -5); c.lineTo(sd * (12 + i * 2), -8 + i * 3 + Math.sin(t * 14 + i) * 1.5); c.lineTo(sd * (14 + i * 2), 0); c.stroke(); }
    c.strokeStyle = OUT;
    for (const sd of [-1, 1]) { c.save(); c.translate(sd * 12, -14 + (wind ? -6 : 0)); c.rotate(sd * (wind ? -0.6 : 0.2)); ell(c, 0, 0, 5.5, 4, C.a); poly(c, [sd * 3, -3, sd * 9, -6, sd * 6, 0], C.a); c.restore(); }
    ell(c, 0, -9, 12, 8, C.a);
    ell(c, 0, -12, 8, 3.5, U.shade(C.a, 0.2), false);
    c.beginPath(); c.moveTo(-3, -15); c.lineTo(-4, -20); c.moveTo(3, -15); c.lineTo(4, -20); c.stroke();
    circ(c, -4, -21, 1.8, C.c); circ(c, 4, -21, 1.8, C.c);
    c.restore();
    if (!behind && !baking) guardArc(c, e, C.b, 9 * s, 4.5, U.shade(C.a, 0.35));
  };

  LOOK.star = (c, e, C, t, s) => {
    const dive = e.st === 'dive', wind = e.st === 'windup', spin = wind ? 9 : dive ? 14 : 2;
    c.save(); c.translate(0, -14 + bobY(t, e, 4, 2)); c.scale(s, s);
    if (dive) { const la = faceAngle(e); c.strokeStyle = U.rgba(C.b, 0.75); c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.lineTo(-Math.cos(la) * 26, -Math.sin(la) * 26); c.stroke(); c.lineCap = 'butt'; c.strokeStyle = OUT; c.lineWidth = 1.3; }
    c.rotate(t * spin + e.id);
    glow(c, 0, 0, wind || dive ? 24 : 16, wind ? '#ffffff' : C.b, wind || dive ? 0.85 : 0.45);
    c.lineWidth = 1.3;
    c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 3.6 : 9, a = i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    c.rotate(-(t * spin + e.id));
    circ(c, 0, 0, 3, '#ffffff', false); c.fillStyle = '#3a1a6a'; c.beginPath(); c.arc(0.6, 0, 1.5, 0, U.TAU); c.fill();
    c.restore();
  };

  LOOK.eye = (c, e, C, t, s) => {
    const aim = e.st === 'aim';
    c.save(); c.translate(0, -18 + Math.sin(t * 2 + e.id) * 2); c.scale(s, s); c.lineWidth = 1.5;
    c.strokeStyle = C.b;
    for (let i = 0; i < 5; i++) { const a = Math.PI * 0.2 + i * 0.15 * Math.PI; c.beginPath(); c.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); c.quadraticCurveTo(Math.cos(a) * 14 + Math.sin(t * 4 + i) * 3, Math.sin(a) * 14, Math.cos(a) * 18, Math.sin(a) * 18 + 4); c.stroke(); }
    c.strokeStyle = OUT;
    glow(c, 0, 0, 22, C.c, aim ? 0.6 : 0.25);
    circ(c, 0, 0, 11, '#efe6ff');
    const a = e.aimA || 0;
    circ(c, Math.cos(a) * 4, Math.sin(a) * 4, 5.5, C.c, false);
    c.fillStyle = '#0b0612'; c.beginPath(); c.arc(Math.cos(a) * 5, Math.sin(a) * 5, 2.6, 0, U.TAU); c.fill();
    c.restore();
  };

  LOOK.horror = (c, e, C, t, s) => {
    const wind = e.st === 'windup';
    c.save(); c.scale(s, s); c.lineWidth = 1.7;
    c.strokeStyle = C.b; c.lineWidth = 4;
    for (let i = 0; i < 6; i++) { const a = Math.PI + i * Math.PI / 5; c.beginPath(); c.moveTo(Math.cos(a) * 6, -10 + Math.sin(a) * 4); c.quadraticCurveTo(Math.cos(a) * 16 + Math.sin(t * 3 + i) * 4, -4, Math.cos(a) * 20, 2 + Math.sin(t * 3 + i + 1.3) * 2); c.stroke(); }
    c.lineWidth = 1.7; c.strokeStyle = OUT;
    ell(c, 0, -18 + (wind ? -4 : 0), 15, 14, C.a);
    for (const [x, y, r] of [[-6, -22, 2.6], [5, -24, 3.2], [0, -16, 2], [9, -16, 1.8], [-9, -15, 1.6]]) eyes(c, x, y + (wind ? -4 : 0), 0, r, C.c);
    c.restore();
  };

  // ---------- guard foes: shield arc faces e.aimA (synced); sprite space is mirrored when face < 0 ----------
  const faceAngle = (e) => (e.face < 0 ? Math.PI - (e.aimA || 0) : (e.aimA || 0));
  const guardArc = (c, e, col, lift, width, hi) => {
    const G = e.def.guard, la = faceAngle(e), h = Math.min(G.arc, 2.8) / 2, r = e.r + 4;
    c.save(); c.translate(0, -lift); c.lineCap = 'butt';
    c.strokeStyle = OUT; c.lineWidth = width + 2.6; c.beginPath(); c.arc(0, 0, r, la - h, la + h); c.stroke();
    c.strokeStyle = col; c.lineWidth = width; c.beginPath(); c.arc(0, 0, r, la - h, la + h); c.stroke();
    c.strokeStyle = hi; c.lineWidth = Math.max(1, width * 0.28); c.beginPath(); c.arc(0, 0, r + width * 0.18, la - h * 0.9, la + h * 0.9); c.stroke();
    for (const sd of [-1, 1]) circ(c, Math.cos(la + sd * h) * r, Math.sin(la + sd * h) * r, width * 0.38, hi, false);
    c.restore();
  };

  LOOK.priest = (c, e, C, t, s) => {
    const cast = e.st === 'cast';
    c.save(); c.scale(s, s); c.translate(0, bobY(t, e, 3, -1)); c.lineWidth = 1.5;
    poly(c, [-7, -17, 7, -17, 11, 0, 5, -2, 0, 1, -5, -2, -11, 0], C.a);
    poly(c, [-2.5, -17, 2.5, -17, 3.5, -1, -3.5, -1], '#d9d2b8', false);
    rrect(c, -7.5, -19.5, 15, 3.5, 1.5, C.b, false);
    ell(c, 0.5, -24.5, 5.4, 5.8, '#e6dfc9');
    c.fillStyle = '#120a08'; c.fillRect(-2.6, -26, 2.4, 2.8); c.fillRect(2.2, -26, 2.4, 2.8);
    eyes(c, 0.8, -25, 2, 0.8, C.c);
    poly(c, [-6.5, -28.5, 7.5, -28.5, 4.5, -40, 0.5, -44, -3.5, -40], C.b);
    poly(c, [-1, -41, 2, -41, 2, -29, -1, -29], '#d9c96a', false);
    // arms: raised while casting
    const ay = cast ? -26 : -14;
    c.strokeStyle = C.a; c.lineWidth = 3.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-6, -16); c.lineTo(-10, ay); c.moveTo(6, -16); c.lineTo(10, ay); c.stroke();
    c.strokeStyle = OUT; c.lineWidth = 1.5;
    glow(c, 0, cast ? -32 : -20, cast ? 22 : 8, C.c, cast ? 0.6 : 0.2);
    // crook staff with a bone-green orb
    c.save(); c.translate(12, -1); rrect(c, -1.3, -26, 2.6, 27, 1, '#5a4a32');
    c.beginPath(); c.arc(0, -28, 3.6, Math.PI * 0.2, Math.PI * 1.9); c.strokeStyle = '#5a4a32'; c.lineWidth = 2.2; c.stroke(); c.strokeStyle = OUT; c.lineWidth = 1.5;
    glow(c, 0, -29, cast ? 15 : 9, C.c, cast ? 0.8 : 0.4); circ(c, 0, -29, cast ? 3.4 : 2.4, C.c, false);
    c.restore();
    c.restore();
  };

  // burrowed worm: dirt mound plus a fading dirt trail (positions kept on the entity as it moves)
  const drawMound = (c, e, t) => {
    const tr = e._trail || (e._trail = []), last = tr[tr.length - 1];
    if (!last || Math.hypot(last[0] - e.x, last[1] - e.y) > 9) { tr.push([e.x, e.y, t]); if (tr.length > 10) tr.shift(); }
    const dirt = '#6b5238', lite = '#9a7c58', dark = '#3a2b1d';
    c.save();
    for (const p of tr) {
      const age = t - p[2]; if (age > 1.8) continue;
      const k = 1 - age / 1.8;
      c.globalAlpha = 0.7 * k; ell(c, p[0] - e.x, p[1] - e.y + 2, 4 + 5 * k, 2 + 2.4 * k, dirt, false);
      c.globalAlpha = 0.5 * k; ell(c, p[0] - e.x - 2, p[1] - e.y, 2 + 2 * k, 1 + k, lite, false);
    }
    c.globalAlpha = 1;
    const r = e.r, rise = Math.sin(t * 9 + e.id) * 0.8;
    c.strokeStyle = dark; c.lineWidth = 1.3;
    for (let i = 0; i < 6; i++) { const a = i * 1.07 + 0.4; c.beginPath(); c.moveTo(Math.cos(a) * r * 1.0, 1 + Math.sin(a) * r * 0.42); c.lineTo(Math.cos(a) * r * 1.6, 1 + Math.sin(a) * r * 0.7); c.stroke(); }
    ell(c, 0, 1, r * 1.3, r * 0.55, dark, false);
    c.lineWidth = 1.6; c.strokeStyle = OUT;
    c.beginPath(); c.moveTo(-r * 1.15, 1); c.bezierCurveTo(-r * 1.1, -r * 0.5, -r * 0.7, -r * 0.95 - rise, -r * 0.15, -r * 1.0 - rise); c.bezierCurveTo(r * 0.35, -r * 1.2 - rise, r * 0.95, -r * 0.55, r * 1.15, 1); c.quadraticCurveTo(0, r * 0.5, -r * 1.15, 1); c.closePath();
    c.fillStyle = dirt; c.fill(); c.stroke();
    ell(c, -r * 0.3, -r * 0.62, r * 0.45, r * 0.2, lite, false, -0.25);
    c.fillStyle = dark; for (const [x, y, q] of [[r * 0.35, -r * 0.5, 1.8], [-r * 0.1, -r * 0.2, 1.4], [r * 0.7, -r * 0.2, 1.2]]) { c.beginPath(); c.arc(x, y, q, 0, U.TAU); c.fill(); }
    c.fillStyle = lite; for (const [x, y, q] of [[-r * 1.15, 4, 1.8], [r * 1.05, 5, 1.5], [r * 0.45, 7, 1.2], [-r * 0.6, 7, 1.1]]) { c.beginPath(); c.arc(x, y, q, 0, U.TAU); c.fill(); }
    glow(c, 0, -r * 0.9, r * 1.2, e.def.col.c, 0.18);
    c.restore();
  };

  LOOK.worm = (c, e, C, t, s) => {
    const B = e.def.burrow, t0 = e.t || 0;
    const rise = U.clamp((B.expose - t0) / 0.25, 0, 1), sink = U.clamp(t0 / 0.35, 0, 1), h = Math.min(rise, sink);
    const r = e.def.r * s;
    c.save(); c.lineWidth = 1.6;
    ell(c, 0, 1, r * 1.5, r * 0.65, '#1a120c', false);
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const k = i / (segs - 1), y = -2 - h * (6 + i * 7.5), x = Math.sin(t * 2.6 + e.id + i * 0.8) * (1.5 + i * 0.9) * h;
      ell(c, x, y, r * (0.95 - k * 0.12), r * 0.62, i % 2 ? C.b : C.a);
    }
    const hy = -2 - h * (6 + segs * 7.5), hx = Math.sin(t * 2.6 + e.id + segs * 0.8) * (1.5 + segs * 0.9) * h;
    ell(c, hx, hy, r * 1.2, r * 0.8, C.a);
    ell(c, hx, hy - 1, r * 0.8, r * 0.46, '#2a0f1c', false);
    glow(c, hx, hy - 1, r * 1.4, C.c, 0.45);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * U.TAU;
      poly(c, [hx + Math.cos(a) * r * 0.86, hy + Math.sin(a) * r * 0.5, hx + Math.cos(a + 0.2) * r * 0.5, hy - 1 + Math.sin(a + 0.2) * r * 0.28, hx + Math.cos(a - 0.2) * r * 0.5, hy - 1 + Math.sin(a - 0.2) * r * 0.28], '#f4efe0', false);
    }
    circ(c, hx - r * 0.7, hy - r * 0.55, 1.5, C.c, false); circ(c, hx + r * 0.7, hy - r * 0.55, 1.5, C.c, false);
    c.restore();
  };

  LOOK.sentinel = (c, e, C, t, s) => {
    const wind = e.st === 'windup', bash = e.st === 'bash', la = faceAngle(e), behind = Math.sin(la) < -0.3;
    const bob = bash ? 0 : Math.abs(Math.sin(t * 5 + e.id)) * 1.2, step = Math.sin(t * 5 + e.id) * 2.5;
    if (behind && !baking) guardArc(c, e, C.a, 14 * s, 9, '#eaf8ff');
    c.save(); c.scale(s, s); c.lineWidth = 1.7;
    rrect(c, -8 + step * 0.3, -7, 6, 8, 2, C.b); rrect(c, 2 - step * 0.3, -7, 6, 8, 2, C.b);
    c.translate(0, -bob);
    poly(c, [-12, -26, 12, -26, 14, -6, -14, -6], U.shade(C.b, -0.15));
    rrect(c, -11, -28, 22, 20, 5, C.a);
    rrect(c, -11, -17, 22, 3, 1, C.b, false);
    circ(c, -12, -25, 5.5, C.b); circ(c, 12, -25, 5.5, C.b);
    rrect(c, -7, -41, 14, 14, 5, C.a);
    rrect(c, -5.5, -35, 11, 3, 1, '#0b0806', false);
    c.fillStyle = C.c; c.fillRect(-4.5, -34.6, 3.4, 2); c.fillRect(1.1, -34.6, 3.4, 2);
    glow(c, 0, -34, 10, C.c, wind || bash ? 0.8 : 0.3);
    poly(c, [-2.5, -41, 0, -50, 2.5, -41], C.c);
    c.restore();
    if (!behind && !baking) guardArc(c, e, C.a, 14 * s, 9, '#eaf8ff');
    if ((wind || bash) && !baking) glow(c, Math.cos(la) * (e.r + 4), -14 * s + Math.sin(la) * (e.r + 4), 14, C.c, 0.55);
  };

  // Pupil and barrel follow the aim, so a baked drone leaves them to a live overlay.
  const droneGun = (c, e, C, aim, fire) => {
    const la = faceAngle(e);
    circ(c, Math.cos(la) * 1.6, -1 + Math.sin(la) * 1.6, 2.6, aim || fire ? '#ffd36b' : C.c, false);
    c.save(); c.translate(0, 1); c.rotate(la); rrect(c, 4, -1.6, 9, 3.2, 1, '#3d3128'); if (fire) glow(c, 14, 0, 9, '#ffcf6a', 0.9); c.restore();
  };
  LOOK.drone = (c, e, C, t, s) => {
    const aim = e.st === 'aim', fire = e.st === 'cast', la = faceAngle(e);
    c.save(); c.translate(0, -17 + bobY(t, e, 5, 2)); c.scale(s, s); c.lineWidth = 1.5;
    glow(c, 0, 0, 20, C.c, aim || fire ? 0.6 : 0.22);
    // spinning rotor discs either side
    for (const sd of [-1, 1]) {
      const bx = sd * 11, spin = Math.sin(t * 40 + e.id + sd);
      c.strokeStyle = C.b; c.beginPath(); c.moveTo(sd * 6, -1); c.lineTo(bx, -5); c.stroke(); c.strokeStyle = OUT;
      ell(c, bx, -6, 7, 2 + Math.abs(spin) * 1.2, U.rgba('#d9cdb8', 0.55), false);
      circ(c, bx, -5, 1.6, C.b);
    }
    ell(c, 0, 0, 9, 7.5, C.a);
    rrect(c, -9, -1, 18, 3, 1.5, C.b, false);
    poly(c, [-4, 6, 4, 6, 2, 11, -2, 11], C.b);
    circ(c, 0, -1, 5, '#17100c');
    if (!baking) droneGun(c, e, C, aim, fire);
    c.restore();
  };

  LOOK.reaver = (c, e, C, t, s) => {
    const wind = e.st === 'windup', leap = e.st === 'leap', idle = e.st === 'idle';
    const k = leap ? 1 - U.clamp((e.t || 0) / 0.35, 0, 1) : 0, lift = leap ? Math.sin(k * Math.PI) * 26 : 0;
    const step = Math.sin(t * 7 + e.id) * 2.2, bob = Math.abs(Math.sin(t * 7 + e.id)) * 1.2;
    c.save(); c.scale(s, s); c.translate(0, -lift); c.lineWidth = 1.6;
    if (wind || idle) c.scale(1.06, 0.92);
    rrect(c, -6 + step * 0.3, -7, 5, 8, 1.5, C.b); rrect(c, 1 - step * 0.3, -7, 5, 8, 1.5, C.b);
    c.translate(0, -bob);
    c.strokeStyle = C.b; c.lineWidth = 2.2;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-5 + i * 5, -9); c.quadraticCurveTo(-6 + i * 5 + Math.sin(t * 3.5 + i) * 2, -3, -5 + i * 5 + Math.sin(t * 3.5 + i + 1.1) * 2, 3); c.stroke(); }
    c.strokeStyle = OUT; c.lineWidth = 1.6;
    rrect(c, -9, -24, 18, 17, 5, C.a);
    rrect(c, -9, -13, 18, 3, 1, C.b, false);
    for (const [x, y, q] of [[-4, -20, 2], [3, -17, 1.6], [5, -22, 1.3]]) circ(c, x, y, q, U.shade(C.a, 0.3), false);
    circ(c, 0, -29, 6.5, C.a);
    rrect(c, -6, -30, 12, 3, 1, '#0b0806', false);
    c.fillStyle = C.c; c.fillRect(-4.5, -29.6, 3, 2); c.fillRect(1.5, -29.6, 3, 2);
    glow(c, 0, -29, 8, C.c, wind || leap ? 0.8 : 0.3);
    poly(c, [-6, -33, -9, -38, -3, -34], C.b); poly(c, [6, -33, 9, -38, 3, -34], C.b);
    c.save(); c.translate(8, -17); c.rotate(wind ? -2.1 : leap ? -0.8 : idle ? 0.7 : 0.35);
    rrect(c, -1, -1.4, 6, 2.8, 1, '#4a3a2a'); poly(c, [5, -2.4, 24, -1.2, 28, 2.4, 5, 2.4], '#bfc7c9'); c.restore();
    c.restore();
  };

  LOOK.rift = (c, e, C, t, s) => {
    const cast = e.st === 'cast';
    c.save(); c.scale(s, s); c.translate(0, Math.sin(t * 2.5 + e.id) * -1.5); c.lineWidth = 1.5;
    poly(c, [-7, -18, 7, -18, 11, 0, 5, -3, 0, 0, -5, -3, -11, 0], C.a);
    poly(c, [-2, -18, 2, -18, 3, -1, -3, -1], C.b, false);
    c.beginPath(); c.moveTo(-8, -17); c.quadraticCurveTo(-9, -32, 0, -33); c.quadraticCurveTo(9, -32, 8, -17); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    ell(c, 1, -23, 4.8, 5, '#07030f', false);
    eyes(c, 1.2, -23.5, 2, 1, C.c);
    // floating rift: a vertical tear that widens while the caller channels
    const w = cast ? 7 + Math.sin(t * 24) * 1.2 : 3.4, hy = -43 + Math.sin(t * 3 + e.id) * 1.5, hh = cast ? 13 : 9;
    glow(c, 0, hy, cast ? 26 : 14, C.c, cast ? 0.75 : 0.35);
    c.beginPath(); c.moveTo(0, hy - hh); c.quadraticCurveTo(w, hy, 0, hy + hh); c.quadraticCurveTo(-w, hy, 0, hy - hh); c.closePath();
    c.fillStyle = '#05010c'; c.fill(); c.strokeStyle = C.c; c.stroke(); c.strokeStyle = OUT;
    c.fillStyle = '#ffffff'; for (let i = 0; i < 3; i++) { const a = t * 2 + i * 2.1; c.fillRect(Math.cos(a) * w * 0.4 - 0.5, hy + Math.sin(a * 1.3) * hh * 0.6 - 0.5, 1.2, 1.2); }
    circ(c, 9, -14, 2.4, C.b);
    c.restore();
  };

  LOOK.gloom = (c, e, C, t, s) => {
    c.save(); c.scale(s, s); c.lineWidth = 1.2;
    glow(c, 0, -26, 38, '#1b0b2e', 0.55);
    // tall shroud with a ragged, swaying hem
    c.globalAlpha = 0.93;
    c.beginPath(); c.moveTo(-10, -2); c.quadraticCurveTo(-14, -34, -4, -50); c.quadraticCurveTo(0, -56, 4, -50); c.quadraticCurveTo(14, -34, 10, -2);
    for (let i = 0; i <= 7; i++) c.lineTo(10 - i * 2.9, 4 + Math.sin(t * 4 + i * 1.4 + e.id) * 3.5 + (i % 2) * 4);
    c.closePath(); c.fillStyle = C.a; c.fill(); c.strokeStyle = C.b; c.stroke();
    // trailing wisps behind the drift direction
    c.globalAlpha = 0.5; c.strokeStyle = C.b; c.lineWidth = 3; c.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const y = -12 - i * 9, sw = Math.sin(t * 3 + i * 1.7 + e.id) * 5; c.beginPath(); c.moveTo(-e.face * 8, y); c.quadraticCurveTo(-e.face * (18 + sw), y + 3, -e.face * (28 + i * 3 + sw), y + 9 + Math.sin(t * 5 + i) * 3); c.stroke(); }
    c.globalAlpha = 1; c.lineCap = 'butt';
    // burning eyes
    const ey = -38;
    for (const sd of [-1, 1]) { glow(c, sd * 4 + 1, ey, 9, C.c, 0.85); poly(c, [sd * 4 - 1.4, ey - 1.6, sd * 4 + 4.4, ey + 0.8, sd * 4 - 1, ey + 2.2], '#ffd9a0', false); }
    c.restore();
  };

  // ---------- bosses ----------
  LOOK.b_warden = (c, e, C, t, s) => {
    const dash = e.pose === 'dash', wind = e.pose === 'wind', cast = e.pose === 'cast';
    const bob = Math.abs(Math.sin(t * 6)) * 1.5;
    c.save(); c.lineWidth = 2;
    rrect(c, -10, -10, 7, 12, 2, C.b); rrect(c, 3, -10, 7, 12, 2, C.b);
    c.translate(0, -bob);
    poly(c, [-14, -40, 14, -40, 20 + Math.sin(t * 5) * 2, -6, -20, -6], '#5a1f1a');
    rrect(c, -13, -40, 26, 30, 6, C.a);
    c.strokeStyle = C.b; c.lineWidth = 2; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-9, -34 + i * 5); c.lineTo(9, -34 + i * 5); c.stroke(); }
    c.strokeStyle = OUT;
    circ(c, 0, -50, 12, C.a); rrect(c, -6, -44, 12, 6, 2, C.a);
    poly(c, [-12, -58, -8, -66, -4, -59, 0, -68, 4, -59, 8, -66, 12, -58], '#c9a640');
    c.fillStyle = '#120a08'; c.beginPath(); c.arc(-4.5, -51, 3.4, 0, U.TAU); c.arc(4.5, -51, 3.4, 0, U.TAU); c.fill();
    eyes(c, 0, -51, 4.5, wind || cast ? 2.4 : 1.7, C.c);
    // tower shield
    c.save(); c.translate(dash ? 16 : 14, -26); rrect(c, -4, -18, 12, 34, 3, '#6a5a48'); rrect(c, -1, -14, 6, 26, 2, '#8c7a5e', false); circ(c, 2, -1, 3, '#c9a640'); c.restore();
    if (cast) glow(c, 0, -30, 40, C.c, 0.25);
    c.restore();
  };

  LOOK.b_spore = (c, e, C, t, s) => {
    const cast = e.pose === 'cast';
    const pulse = 1 + Math.sin(t * 2) * 0.03 + (cast ? Math.sin(t * 20) * 0.02 : 0);
    c.save(); c.lineWidth = 2; c.scale(pulse, 1 / pulse);
    c.strokeStyle = '#5b3a6a'; c.lineWidth = 4;
    for (let i = 0; i < 7; i++) { const a = Math.PI * (0.05 + i * 0.15); c.beginPath(); c.moveTo(Math.cos(a) * 12, -4); c.quadraticCurveTo(Math.cos(a) * 30 + Math.sin(t * 2 + i) * 4, 4, Math.cos(a) * 40, 6 + Math.sin(t * 3 + i) * 2); c.stroke(); }
    c.lineWidth = 2; c.strokeStyle = OUT;
    rrect(c, -14, -34, 28, 34, 10, '#efe6d6');
    eyes(c, 0, -20, 6, 2.6, '#2a0d24');
    c.beginPath(); c.moveTo(-6, -12); c.quadraticCurveTo(0, -8, 6, -12); c.stroke();
    c.beginPath(); c.ellipse(0, -36, 38, 24, 0, Math.PI, 0); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    c.beginPath(); c.ellipse(0, -36, 38, 6, 0, 0, Math.PI); c.fillStyle = U.shade(C.a, -0.3); c.fill(); c.stroke();
    for (const [x, y, r] of [[-20, -44, 5], [-4, -52, 6.5], [14, -48, 5], [26, -40, 3.4], [-28, -38, 3], [6, -42, 3]]) { glow(c, x, y, r * 2.6, C.c, 0.35); circ(c, x, y, r, C.c, false); }
    c.restore();
  };

  LOOK.b_rime = (c, e, C, t, s) => {
    const wind = e.pose === 'wind', slam = e.pose === 'slam', air = e.pose === 'air';
    c.save(); c.lineWidth = 2;
    if (air) c.translate(0, -18 - Math.sin(Math.min(1, (e.t || 0) / 1.2) * Math.PI) * 30);
    rrect(c, -14, -12, 10, 13, 3, C.b); rrect(c, 4, -12, 10, 13, 3, C.b);
    poly(c, [-20, -50, 20, -50, 24, -10, -24, -10], C.a);
    poly(c, [-16, -50, -2, -50, -6, -30, -20, -34], '#ffffff', false);
    glow(c, 0, -30, 22, C.c, 0.55); poly(c, [0, -40, 6, -30, 0, -20, -6, -30], C.c);
    poly(c, [-10, -50, -14, -66, -4, -58, 0, -70, 4, -58, 14, -66, 10, -50], C.a);
    c.fillStyle = C.c; c.fillRect(-7, -58, 4, 3); c.fillRect(3, -58, 4, 3);
    const armY = wind ? -62 : slam ? -20 : -40;
    poly(c, [-22, -48, -34, armY, -28, armY + 18, -20, -30], C.b);
    poly(c, [22, -48, 34, armY, 28, armY + 18, 20, -30], C.b);
    c.restore();
  };

  LOOK.b_forge = (c, e, C, t, s) => {
    const wind = e.pose === 'wind', slam = e.pose === 'slam', air = e.pose === 'air', cast = e.pose === 'cast';
    c.save(); c.lineWidth = 2;
    if (air) c.translate(0, -Math.sin(Math.min(1, (e.t || 0) / 1.1) * Math.PI) * 40);
    rrect(c, -11, -12, 9, 13, 3, C.b); rrect(c, 2, -12, 9, 13, 3, C.b);
    poly(c, [-15, -44, 15, -44, 18, -10, -18, -10], C.a);
    c.strokeStyle = '#ff8a2a'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-8, -36); c.lineTo(-2, -26); c.lineTo(-6, -16); c.moveTo(8, -38); c.lineTo(4, -24); c.stroke(); c.strokeStyle = OUT; c.lineWidth = 2;
    circ(c, -15, -40, 7, C.b); circ(c, 15, -40, 7, C.b);
    rrect(c, -9, -60, 18, 17, 4, C.a);
    rrect(c, -7, -53, 14, 3, 1, '#0b0806', false); c.fillStyle = C.c; c.fillRect(-5, -52.6, 4, 2); c.fillRect(1, -52.6, 4, 2);
    glow(c, 0, -64, 16, '#ff9a3a', 0.5);
    c.fillStyle = '#ffcf6a'; c.beginPath(); c.moveTo(-6, -60); c.quadraticCurveTo(0, -78 + Math.sin(t * 14) * 3, 6, -60); c.fill();
    const ha = wind ? -2.4 : slam ? 0.9 : cast ? -1.2 + t * 12 : -0.4;
    c.save(); c.translate(16, -34); c.rotate(ha); rrect(c, -2, -2, 34, 4, 1, '#3a2a20'); rrect(c, 28, -10, 14, 20, 3, '#5a4a40'); glow(c, 35, 0, 14, '#ff7a2a', 0.5); c.restore();
    c.restore();
  };

  LOOK.b_king = (c, e, C, t, s) => {
    const wind = e.pose === 'wind' || e.pose === 'slam', cast = e.pose === 'cast', air = e.pose === 'air';
    c.save(); c.lineWidth = 2;
    c.translate(0, Math.sin(t * 2) * -1.5 - (air ? Math.sin(Math.min(1, (e.t || 0) / 1.0) * Math.PI) * 38 : 0));
    poly(c, [-14, -44, 14, -44, 22, 0, 8, -4, 0, 2, -8, -4, -22, 0], C.a);
    poly(c, [-4, -44, 4, -44, 6, 0, -6, 0], '#e8c66b', false);
    rrect(c, -10, -60, 20, 18, 6, '#8fb5a8');
    c.strokeStyle = '#2f5249'; c.lineWidth = 3;
    for (let i = 0; i < 5; i++) { const x = -8 + i * 4; c.beginPath(); c.moveTo(x, -46); c.quadraticCurveTo(x + Math.sin(t * 3 + i) * 3, -36, x + Math.sin(t * 2 + i) * 2, -28); c.stroke(); }
    c.strokeStyle = OUT; c.lineWidth = 2;
    eyes(c, 0, -53, 4, cast ? 2.2 : 1.6, C.c);
    poly(c, [-11, -60, -9, -72, -4, -64, 0, -74, 4, -64, 9, -72, 11, -60], '#e8c66b');
    const ta = wind ? -1.9 : -0.6;
    c.save(); c.translate(16, -30); c.rotate(ta); rrect(c, -16, -1.8, 46, 3.6, 1, '#c9a640'); poly(c, [28, -7, 40, 0, 28, 7], '#e8e2c8'); poly(c, [28, -7, 34, -9, 30, -3], '#e8e2c8'); poly(c, [28, 7, 34, 9, 30, 3], '#e8e2c8'); c.restore();
    if (cast) glow(c, 0, -40, 50, C.c, 0.2);
    c.restore();
  };

  LOOK.b_hollow = (c, e, C, t, s) => {
    const wind = e.pose === 'wind', cast = e.pose === 'cast', fade = e.pose === 'fade';
    c.save(); c.lineWidth = 2;
    if (fade) c.globalAlpha = 0.35 + Math.sin(t * 30) * 0.15;
    c.translate(0, -6 + Math.sin(t * 1.6) * 3);
    glow(c, 0, -36, 60, '#7a3aff', 0.18);
    c.beginPath(); c.moveTo(-16, -50); c.quadraticCurveTo(-30, -10, -24, 6);
    for (let i = 0; i <= 8; i++) c.lineTo(-24 + i * 6, 6 + Math.sin(t * 5 + i) * 3 + (i % 2) * 4);
    c.quadraticCurveTo(30, -10, 16, -50); c.closePath(); c.fillStyle = C.a; c.fill(); c.stroke();
    poly(c, [-8, -50, 8, -50, 6, -10, -6, -10], C.b, false);
    rrect(c, -10, -70, 20, 22, 7, '#0e0820');
    eyes(c, 0, -60, 4.5, wind || cast ? 2.2 : 1.5, C.c);
    // hollow crown: floating shards
    for (let i = 0; i < 7; i++) {
      const a = t * 0.8 + i * U.TAU / 7, x = Math.cos(a) * 16, y = -78 + Math.sin(a) * 4;
      poly(c, [x - 2.5, y + 4, x, y - 7, x + 2.5, y + 4], Math.sin(a) > 0 ? '#ffd8f4' : '#c98bff');
    }
    if (e.phase >= 3) for (let i = 0; i < 3; i++) {
      const a = (ED.Render.simT ?? t) * 2.2 + i * U.TAU / 3; // sim-time phase: matches hkShards damage in bosses.js
      const x = Math.cos(a) * 74, y = Math.sin(a) * 74 + 6;
      glow(c, x, y, 18, C.c, 0.5); poly(c, [x - 6, y + 6, x, y - 10, x + 6, y + 6], '#ffb8ec');
    }
    c.restore();
  };

  const FROZEN = { a: '#d8f4ff', b: '#9fd6ef', c: '#ffffff' };
  // Ground shadow plus the elite and exposed halos drawn under a foe (lite: single shadow layer).
  Sp.foeBack = (c, e, t, lite) => {
    Sp.shadow(c, e.r, e.def.fly || e.def.gloom ? 0.22 : 0.35, lite);
    if (e.elite) { const col = ED.AFFIXES[e.elite].color; glow(c, 0, -e.r, e.r * 2.6, col, 0.32 + Math.sin(t * 5) * 0.08); }
    if (e.exposed) glow(c, 0, -e.r, e.r * 2.2, '#ff3a3a', 0.25 + Math.sin(t * 9) * 0.1);
  };
  Sp.enemy = (c, e, t) => {
    const def = e.def;
    const C = e.flash > 0 ? WHITE : (e.frozen > 0 ? FROZEN : def.col);
    const s = e.r / def.r;
    c.save();
    c.lineWidth = 1.6; c.strokeStyle = OUT; c.lineJoin = 'round'; c.lineCap = 'round';
    if (e.st === 'burrow') { drawMound(c, e, t); c.restore(); return; }
    Sp.shadow(c, e.r, def.fly || def.gloom ? 0.22 : 0.35);
    if (e.st === 'fade') c.globalAlpha = 0.4 + Math.sin(t * 34) * 0.18;
    if (e.elite) { const col = ED.AFFIXES[e.elite].color; glow(c, 0, -e.r, e.r * 2.6, col, 0.32 + Math.sin(t * 5) * 0.08); }
    if (e.exposed) glow(c, 0, -e.r, e.r * 2.2, '#ff3a3a', 0.25 + Math.sin(t * 9) * 0.1);
    if ((e.st === 'windup' || e.st === 'aim' || e.st === 'cast' || e.pose === 'wind') && Math.floor(t * 14) % 2 === 0) c.translate(Math.sin(t * 60) * 0.8, 0);
    c.scale(e.face < 0 ? -1 : 1, 1);
    (LOOK[def.look] || LOOK.slime)(c, e, C, t, s);
    c.restore();
  };

  // ---------- foe flipbooks ----------
  // FOE[look] says how Render caches a look as frames. P: animation period (s), N: frames per period, ns: pose states, st(e): pose state or -1 (drawn live),
  // rep[state]: the sim state a frame is painted with, pm[state]: period multiplier, fl: [freq, amp, scaled] float bob applied at blit time, face: the look reads e.face (frames per facing),
  // box: sprite extent [x0, y0, x1, y1] at scale 1, over: its big halos wash over the body (drawn after the frame, else under it), pre/post: live overlays (aimed or guarding parts) behind/over the frame.
  // Frame k is painted at time k * P / N with id 0.
  const tw = (k) => U.TAU / k;
  const wind = (e) => (e.st === 'windup' ? 1 : 0), wind2 = (e) => (e.st === 'windup' || e.st === 'aim' ? 1 : 0), calm = () => 0;
  const overlay = (c, e, f) => { c.save(); c.lineWidth = 1.6; c.strokeStyle = OUT; c.lineJoin = 'round'; c.lineCap = 'round'; f(); c.restore(); }; // overlays draw in the foe's own (mirrored) space
  const guardSide = (e) => Math.sin(faceAngle(e)) < -0.3; // shield arc behind the body
  const FOE = {
    skeleton: { P: tw(9), N: 32, ns: 2, st: wind2, rep: ['move', 'windup'],
      post(c, e, C, tq, s) {
        if (!e.def.bow) return;
        const sp = bowSprite(), a = e.aimA ? Math.atan2(Math.sin(e.aimA), Math.abs(Math.cos(e.aimA))) : 0, co = Math.cos(a) * s, si = Math.sin(a) * s;
        c.save(); c.transform(co, si, -si, co, 6 * s, -(12 + Math.abs(Math.sin(tq * 9)) * 1.5 * s) * s); c.drawImage(sp.cv, sp.x, sp.y, sp.w, sp.h); c.restore(); // the bow rides the bobbing body, turned to the aim
      } },
    bat: { P: tw(22), N: 32, ns: 1, st: calm, rep: ['move'], fl: [5, 2, true] },
    slime: { P: tw(6), N: 24, ns: 1, st: calm, rep: ['move'] },
    jelly: { P: tw(3), N: 32, ns: 2, st: (e) => (e.st === 'cast' ? 1 : 0), rep: ['move', 'cast'], fl: [3, 2, false] },
    knight: { P: tw(7), N: 32, ns: 2, st: wind, rep: ['move', 'windup'],
      pre(c, e, C, tq, s) { if (e.def.guard && guardSide(e)) overlay(c, e, () => guardArc(c, e, '#8f98a3', 14 * s, 5, '#dfe6ee')); },
      post(c, e, C, tq, s) { if (e.def.guard && !guardSide(e)) overlay(c, e, () => guardArc(c, e, '#8f98a3', 14 * s, 5, '#dfe6ee')); } },
    shroom: { P: tw(7), N: 32, ns: 1, st: calm, rep: ['move'], over: true },
    hulk: { P: tw(5), N: 24, ns: 2, st: wind, rep: ['move', 'windup'], over: true },
    puff: { P: tw(4), N: 16, ns: 1, st: (e) => (e.st === 'fuse' ? -1 : 0), rep: ['move'], fl: [3, 2, false] },
    spider: { P: tw(16), N: 24, ns: 3, st: (e) => (e.st === 'windup' ? 1 : e.st === 'aim' ? 2 : 0), rep: ['move', 'windup', 'aim'] },
    wolf: { P: tw(12), N: 32, ns: 3, pm: [1, 0.5, 1], st: (e) => (e.st === 'cast' ? -1 : e.st === 'charge' ? 1 : e.st === 'windup' ? 2 : 0), rep: ['move', 'charge', 'windup'] },
    wisp: { P: tw(9), N: 16, ns: 2, st: (e) => (e.st === 'dive' ? -1 : wind(e)), rep: ['move', 'windup'], fl: [4, 3, false] },
    robed: { P: 1, N: 1, ns: 2, st: (e) => (e.st === 'cast' ? 1 : 0), rep: ['move', 'cast'], fl: [3, -1, true] },
    wraith: { P: tw(6), N: 24, ns: 1, st: calm, rep: ['move'], fl: [2.5, 3, true] },
    shade: { P: tw(8), N: 16, ns: 2, st: wind, rep: ['move', 'windup'], face: true },
    golem: { P: tw(5), N: 24, ns: 2, st: wind, rep: ['move', 'windup'] },
    imp: { P: tw(18), N: 24, ns: 2, st: (e) => (e.st === 'aim' ? 1 : 0), rep: ['move', 'aim'], fl: [6, 2, true] },
    totem: { P: tw(12), N: 16, ns: 2, st: (e) => (e.st === 'spin' || e.st === 'aim' ? 1 : 0), rep: ['move', 'spin'] },
    eel: { P: tw(10), N: 24, ns: 1, st: calm, rep: ['move'] },
    crab: { P: tw(14), N: 16, ns: 2, st: wind, rep: ['move', 'windup'],
      pre(c, e, C, tq, s) { if (guardSide(e)) overlay(c, e, () => guardArc(c, e, C.b, 9 * s, 4.5, U.shade(C.a, 0.35))); },
      post(c, e, C, tq, s) { if (!guardSide(e)) overlay(c, e, () => guardArc(c, e, C.b, 9 * s, 4.5, U.shade(C.a, 0.35))); } },
    star: { P: 1, N: 30, ns: 2, st: (e) => (e.st === 'dive' ? -1 : wind(e)), rep: ['move', 'windup'], fl: [4, 2, false],
      spin: (st) => (st === 1 ? 9 : 2), // the body turns by t * spin and repeats every 72 degrees (five points)
      ph: (e, t, st) => (t * (st === 1 ? 9 : 2) + (e.id | 0)) / (U.TAU / 5) },
    horror: { P: tw(3), N: 32, ns: 2, st: wind, rep: ['move', 'windup'] },
    priest: { P: 1, N: 1, ns: 2, st: (e) => (e.st === 'cast' ? 1 : 0), rep: ['move', 'cast'], fl: [3, -1, true], over: true },
    sentinel: { P: tw(5), N: 24, ns: 3, st: (e) => (e.st === 'windup' ? 1 : e.st === 'bash' ? 2 : 0), rep: ['move', 'windup', 'bash'],
      pre(c, e, C, tq, s) { if (guardSide(e)) overlay(c, e, () => guardArc(c, e, C.a, 14 * s, 9, '#eaf8ff')); },
      post(c, e, C, tq, s) {
        const la = faceAngle(e), front = !guardSide(e), hit = e.st === 'windup' || e.st === 'bash';
        if (front || hit) overlay(c, e, () => { if (front) guardArc(c, e, C.a, 14 * s, 9, '#eaf8ff'); if (hit) glow(c, Math.cos(la) * (e.r + 4), -14 * s + Math.sin(la) * (e.r + 4), 14, C.c, 0.55); });
      } },
    drone: { P: tw(40), N: 16, ns: 2, st: (e) => (e.st === 'aim' || e.st === 'cast' ? 1 : 0), rep: ['move', 'aim'], fl: [5, 2, false],
      post(c, e, C, tq, s, dy) { overlay(c, e, () => { c.translate(0, -17 + dy); c.scale(s, s); c.lineWidth = 1.5; droneGun(c, e, C, e.st === 'aim', e.st === 'cast'); }); } },
    reaver: { P: tw(3.5), N: 40, ns: 3, st: (e) => (e.st === 'leap' ? -1 : e.st === 'windup' ? 1 : e.st === 'idle' ? 2 : 0), rep: ['move', 'windup', 'idle'] },
  };
  // Painted extent [x0, y0, x1, y1] of each look at scale 1 over every pose, tint and frame, halos left out (alpha >= 6/255, rounded outward).
  const BOX = { skeleton: [-9, -32, 20, 2], bat: [-17, -27, 17, -8], slime: [-15, -22, 15, 3], jelly: [-14, -31, 14, 1], knight: [-15, -40, 35, 2], shroom: [-14, -27, 14, 2],
    hulk: [-18, -37, 18, 2], puff: [-13, -28, 13, -1], spider: [-22, -20, 17, 3], wolf: [-17, -22, 19, 3], wisp: [-7, -24, 7, 2], robed: [-11, -37, 23, 1], wraith: [-10, -43, 10, 1],
    shade: [-16, -29, 14, 1], golem: [-20, -36, 20, 2], imp: [-14, -34, 18, -7], totem: [-11, -59, 11, 1], eel: [-24, -23, 17, 0], crab: [-23, -31, 23, 1], star: [-10, -24, 10, -1],
    horror: [-23, -37, 23, 7], priest: [-12, -45, 27, 2], sentinel: [-19, -53, 19, 2], drone: [-18, -27, 18, -2], reaver: [-11, -41, 35, 5] };
  for (const k in BOX) FOE[k].box = BOX[k];
  FOE.zombie = FOE.skeleton;
  Sp.FOE = FOE;
  // Foe palette for a tint: 0 own colours, 1 hit flash, 2 frozen.
  Sp.foePal = (e, tint) => (tint === 1 ? WHITE : tint === 2 ? FROZEN : e.def.col);
  // Cache spec of a live foe's look (null: always drawn live).
  Sp.foeSpec = (e) => (e.boss ? null : FOE[e.def.look] || null);
  // Animation frame of foe e at clock t: a per-foe phase offset keeps a crowd out of step.
  Sp.foeFrame = (spec, state, e, t) => {
    const u = spec.ph ? spec.ph(e, t, state) : t / (spec.P * (spec.pm ? spec.pm[state] : 1)) + (e.id | 0) * 0.6180339887;
    const f = ((u - Math.floor(u)) * spec.N + 0.5) | 0;
    return f >= spec.N ? 0 : f;
  };
  // Time at which frame f of a pose state is painted (the clock live overlays follow).
  Sp.foeTq = (spec, state, f) => (spec.spin ? f / spec.N * (U.TAU / 5) / spec.spin(state) : f * spec.P * (spec.pm ? spec.pm[state] : 1) / spec.N);
  // Paints one frame of foe e (sprite space, origin at its feet) into g, whose transform maps sprite units to the frame's texels. Returns the recorded halos (or null).
  Sp.paintFoe = (g, e, spec, state, tint, f) => {
    const def = e.def, px = Object.create(e), m = g.getTransform();
    hQ = m.a; hX = m.e; hY = m.f; halos = [];
    px.id = 0; px.st = spec.rep[state]; px.aimA = 0; px.t = 0; px.flash = 0; px.frozen = 0; px.exposed = false; px.elite = null; px.face = spec.face ? e.face : 1;
    g.lineWidth = 1.6; g.strokeStyle = OUT; g.lineJoin = 'round'; g.lineCap = 'round';
    if (px.face < 0) g.scale(-1, 1);
    let h = null;
    baking = true;
    try { LOOK[def.look](g, px, Sp.foePal(e, tint), Sp.foeTq(spec, state, f), e.r / def.r); h = halos.length ? halos : null; } finally { baking = false; halos = null; }
    return h;
  };

  Sp.minion = (c, a, t) => {
    if (ED.Actors && ED.Actors.on() && ED.Actors.minion(c, a, t)) return;
    const def = ED.ENEMIES.minion, kn = !!(ED.ClassFx.knight && ED.ClassFx.knight(a));
    c.save(); c.globalAlpha = 0.9;
    if (kn) c.scale(1.4, 1.4); // Bone Knight body
    Sp.shadow(c, 9, 0.3);
    glow(c, 0, -10, 16, def.col.c, 0.25);
    c.scale(a.face < 0 ? -1 : 1, 1); c.lineWidth = 1.5; c.strokeStyle = OUT;
    LOOK.skeleton(c, { id: a.id, st: 'move', def }, def.col, t, 0.85);
    c.restore();
    if (ED.ClassFx.minion) ED.ClassFx.minion(c, a, t, kn, a.face < 0);
  };
})(globalThis.ED || (globalThis.ED = {}));
