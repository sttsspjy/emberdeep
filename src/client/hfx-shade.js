// Shade visuals: stabs, the mark, shadow cuts, blooms, executes, thrown / fan / pinning daggers (Twin Daggers and its Forms) and Shadow Step (afterimage, blink slash).
// Hooks read only snapshot-visible fields (zone: k, x, y, r, a, len, w, t, dur, id; projectile: k, x, y, a, id) and route by look name. Pixel art only: atlas sprites and Batch primitives.
// Stab-type zones draw in the top pass (over the horde); the ground pass returns true for them so the default zone fill is skipped.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const PALE = 0xfff1d6, STEEL = 0xd8e0f0, VIOLET = 0x8a6bd6, LILAC = 0xc8b0ff, DUSK = 0x4a2f7a, BLOOD = 0xff4a5a, WHITE = 0xffffff;
  const ca = (c, a) => (((c << 8) | Math.max(0, Math.min(255, Math.round(a * 255)))) >>> 0);
  const O = { flip: false, alpha: 1, rot: 0, sx: 1, sy: 1, add: false, flash: 0 };
  const opt = (alpha, rot, s, add, flip) => { O.alpha = alpha; O.rot = rot || 0; O.sx = O.sy = s || 1; O.add = !!add; O.flip = !!flip; O.flash = 0; return O; };
  const kOf = (z) => (z.dur > 0 ? U.clamp(z.t / z.dur, 0, 1) : 0);

  // ---------------- projectiles ----------------
  // Knife along its flight with a short trail; add: an additive glow copy.
  function knife(B, pr, len, col, add) {
    const c = Math.cos(pr.a), s = Math.sin(pr.a);
    B.line(pr.x - c * len, pr.y - s * len, pr.x, pr.y, 2, ca(col, 0.45));
    if (!B.spr('proj.knife', 0, pr.x, pr.y, opt(1, pr.a, 1, false))) B.circ(pr.x, pr.y, 2, ca(PALE, 1), 0);
    if (add) B.spr('proj.knife', 0, pr.x, pr.y, opt(0.6, pr.a, 1.3, true));
  }
  // Returning dagger: spins end over end inside a 1 px blur ring.
  function spinner(B, pr, t, col) {
    B.circ(pr.x, pr.y, 5, ca(col, 0.35), 1);
    if (!B.spr('proj.knife', 0, pr.x, pr.y, opt(1, t * 22 + pr.id, 1, false))) B.circ(pr.x, pr.y, 2, ca(PALE, 1), 0);
  }
  function proj(B, pr, t) {
    if (pr.k === 'rknife') spinner(B, pr, t, STEEL);
    else if (pr.k === 'sknife') { spinner(B, pr, t, VIOLET); B.spr('proj.knife', 0, pr.x, pr.y, opt(0.5, t * 22 + pr.id, 1.3, true)); }
    else if (pr.k === 'pknife') knife(B, pr, 10, BLOOD, false);
    else knife(B, pr, 8, VIOLET, true);
    return true;
  }

  // ---------------- stabs and cuts (top pass) ----------------
  // Thrust: the blade shoots from 35% to full length in the first 30% of its life, then fades; tip = the knife sprite; crit: blood-red body, wider, a glint at the tip.
  function stab(B, z, t, body, crit) {
    const k = kOf(z), ext = k < 0.3 ? 0.35 + 0.65 * k / 0.3 : 1, f = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
    const c = Math.cos(z.a), s = Math.sin(z.a), L = z.len * ext, tx = z.x + c * L, ty = z.y + s * L;
    B.line(z.x + c * L * 0.3, z.y + s * L * 0.3, tx, ty, Math.max(1, Math.round(z.w * (crit ? 0.4 : 0.25))), ca(body, 0.55 * f));
    B.line(z.x + c * L * 0.55, z.y + s * L * 0.55, tx, ty, 1, ca(WHITE, 0.9 * f));
    B.spr('proj.knife', 0, tx - c * 4, ty - s * 4, opt(f, z.a, 1, false));
    if (crit) B.spr('fx.glint', ED.Atlas.frameAt('fx.glint', z.t * 2), tx, ty, opt(f, 0, 1, true));
  }
  // Shadow X cut: two crossing slashes of length z.w through the centre (white core over violet), the cutx sprite, fading over the zone's life.
  function xcut(B, z, t) {
    const k = kOf(z), f = 1 - k, h = z.w / 2;
    for (let i = 0; i < 2; i++) {
      const b = z.a + i * Math.PI / 2, c = Math.cos(b) * h, s = Math.sin(b) * h;
      B.line(z.x - c, z.y - s, z.x + c, z.y + s, 2, ca(VIOLET, 0.8 * f));
      B.line(z.x - c * 0.8, z.y - s * 0.8, z.x + c * 0.8, z.y + s * 0.8, 1, ca(WHITE, f));
    }
    B.spr('fx.cutx', ED.Atlas.frameAt('fx.cutx', z.t), z.x, z.y, opt(0.8 * f, z.a, Math.max(0.5, z.w / 32), true));
  }
  // Bloom: z.w blades radiating from the struck foe out to z.r, growing in the first 40% of the life, then fading.
  function petals(B, z, t) {
    const k = kOf(z), g = Math.min(1, k / 0.4), f = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6, n = Math.max(3, z.w | 0), r1 = 4 + (z.r - 4) * g;
    for (let i = 0; i < n; i++) {
      const b = z.a + (i + 0.5) * TAU / n, c = Math.cos(b), s = Math.sin(b);
      B.line(z.x + c * 4, z.y - 6 + s * 4, z.x + c * r1, z.y - 6 + s * r1, 2, ca(VIOLET, 0.75 * f));
      B.line(z.x + c * r1 * 0.5, z.y - 6 + s * r1 * 0.5, z.x + c * r1, z.y - 6 + s * r1, 1, ca(LILAC, f));
    }
    B.circ(z.x, z.y - 6, 2, ca(WHITE, f), 0);
  }
  // Mark: a thin pulsing ring at the foe's feet, four crosshair ticks closing in and the skull sigil bobbing above.
  function mark(B, z, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 8 + z.id), r = z.r + pulse, ti = 3 + 2 * pulse, fin = Math.min(1, z.t / 0.15);
    B.circ(z.x, z.y - 4, r, ca(BLOOD, 0.75 * fin), 1);
    for (let i = 0; i < 4; i++) {
      const b = i * Math.PI / 2 + t * 1.5, c = Math.cos(b), s = Math.sin(b);
      B.line(z.x + c * (r + 2), z.y - 4 + s * (r + 2), z.x + c * (r + 2 + ti), z.y - 4 + s * (r + 2 + ti), 1, ca(PALE, 0.9 * fin));
    }
    const sy = z.y - z.r * 2 - 14 + Math.round(Math.sin(t * 4 + z.id));
    if (!B.spr('fx.sigil.skull', 0, z.x, sy, opt(0.9 * fin, 0, 1, false))) B.circ(z.x, sy, 3, ca(LILAC, fin), 0);
  }
  // Execute pop: the skull sigil rising and fading; burst (w = 1): a blood ring growing to z.r.
  function execPop(B, z, t) {
    const k = kOf(z), f = 1 - k;
    if (z.w) B.circ(z.x, z.y - 4, z.r * (0.4 + 0.6 * k), ca(BLOOD, 0.8 * f), 1);
    if (!B.spr('fx.sigil.skull', 0, z.x, z.y - 16 - 10 * k, opt(f, 0, 1, false))) B.circ(z.x, z.y - 16 - 10 * k, 3, ca(PALE, f), 0);
  }
  const TOP = { stab: 1, stabx: 1, tcut: 1, mcut: 1, petal: 1, smark: 1, sexec: 1 };
  function top(B, z, t) {
    switch (z.k) {
      case 'stab': stab(B, z, t, STEEL, false); return true;
      case 'stabx': stab(B, z, t, BLOOD, true); return true;
      case 'tcut': stab(B, z, t, LILAC, false); return true;
      case 'mcut': xcut(B, z, t); return true;
      case 'petal': petals(B, z, t); return true;
      case 'smark': mark(B, z, t); return true;
      case 'sexec': execPop(B, z, t); return true;
    }
    return false;
  }

  // ---------------- Shadow Step ----------------
  function afterimage(B, z, t) {
    const k = kOf(z), flick = 0.45 + 0.15 * Math.sin(t * 40 + z.id), flip = Math.cos(z.a) > 0;
    B.circ(z.x, z.y - 4, z.r, ca(DUSK, 0.12 + 0.3 * k), 0);
    B.circ(z.x, z.y - 4, z.r, ca(VIOLET, 0.5 + 0.5 * k), 1);
    B.circ(z.x, z.y - 4, z.r * (1 - k), ca(LILAC, 0.8), 1);
    if (!B.spr('hero.shade.idle', 0, z.x, z.y, opt(flick, 0, 1, false, flip))) B.circ(z.x, z.y - 8, 7, ca(VIOLET, flick), 0);
    B.spr('hero.shade.idle', 0, z.x + 2, z.y, opt(0.35, 0, 1, true, flip));
    for (let i = 0; i < 6; i++) { const h = U.hash3(z.id, i, 3), a = (h & 1023) / 1024 * TAU, c = (t * 1.5 + (h >>> 12 & 255) / 256) % 1; B.rect(z.x + Math.cos(a) * 10 * c, z.y - 10 - c * 18, 2, 2, ca(VIOLET, 1 - c)); }
  }
  function stepcut(B, z, t) {
    const k = kOf(z), f = 1 - k, ex = z.x + Math.cos(z.a) * z.len, ey = z.y - 6 + Math.sin(z.a) * z.len;
    B.line(z.x, z.y - 6, ex, ey, Math.max(1, z.w * f), ca(DUSK, 0.5 * f));
    B.line(z.x, z.y - 6, ex, ey, Math.max(1, z.w * 0.3 * f), ca(VIOLET, 0.9 * f));
    B.line(z.x, z.y - 6, ex, ey, 1, ca(WHITE, f));
    const nx = -Math.sin(z.a), ny = Math.cos(z.a);
    for (let i = 1; i < 6; i++) { const m = i / 6, x = z.x + (ex - z.x) * m, y = z.y - 6 + (ey - z.y + 6) * m, s = (i % 2 ? 1 : -1) * z.w * 0.7 * f; B.line(x - nx * s, y - ny * s, x + nx * s, y + ny * s, 1, ca(LILAC, 0.8 * f)); }
  }
  function ground(B, z, t) {
    if (TOP[z.k]) return true;
    if (z.k === 'afterimg') { afterimage(B, z, t); return true; }
    if (z.k === 'stepcut') { stepcut(B, z, t); return true; }
    return false;
  }

  const FX = { proj, zone: ground, top };
  for (const id of ['daggers', 'shadowfan', 'thousand', 'assassinate', 'lotus', 'reaper']) ED.WeaponFx[id] = FX;
  ED.WeaponFx.step = FX; ED.SkillFx.step = FX;
})(globalThis.ED || (globalThis.ED = {}));
