// Client draw hooks for the bell (until its own file takes over): registers ED.WeaponFx / ED.SkillFx entries (see util.js). Every hook reads only snapshot-visible fields
// (zone: k, x, y, r, a, len, w, t, dur, warn, id; projectile: k, x, y, a, id) and routes by look name k, so one object serves both tables for each id.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const GOLD = 0xffe08a, WHITE = 0xfff6dc, HOLY = 0xffd36b, VIOLET = 0x8a6bd6, DUSK = 0x4a2f7a, BRONZE = 0xe6c27a, PALE = 0xfff1d6;
  // 0xRRGGBB + alpha 0..1 -> 0xRRGGBBAA.
  const ca = (c, a) => (((c << 8) | Math.max(0, Math.min(255, Math.round(a * 255)))) >>> 0);
  const O = { flip: false, alpha: 1, rot: 0, sx: 1, sy: 1, add: false, flash: 0 };
  const opt = (alpha, rot, s, add, flip) => { O.alpha = alpha; O.rot = rot || 0; O.sx = O.sy = s || 1; O.add = !!add; O.flip = !!flip; O.flash = 0; return O; };
  const kOf = (z) => (z.dur > 0 ? U.clamp(z.t / z.dur, 0, 1) : 0);
  // Fade in over the first fi s and out over the last fo s of a zone.
  const fade = (z, fi, fo) => Math.min(1, z.t / fi, (z.dur - z.t) / fo);
  const reg = (ids, o) => { for (const id of ids) { ED.WeaponFx[id] = o; ED.SkillFx[id] = o; } };


  // ---------------- bell ----------------
  // Swinging bell sprite hanging from (x, y - h); s = scale.
  function bellSpr(B, id, x, y, t, ph, s, swing) {
    B.shadow(x, y + 4, 6 * s);
    if (!B.spr(id, 0, x, y - 10 * s, opt(1, Math.sin(t * 9 + ph) * swing, s, false))) B.circ(x, y - 4, 6 * s, ca(BRONZE, 1), 0);
  }
  // Shockwave ring at the zone's current radius (grows in the sim): a bright band, a thin echo inside, a faint fill.
  function waveRing(B, z, band, col, fill) {
    if (z.r < 2) return;
    const k = kOf(z), f = 1 - k * k;
    if (B.zoneLite) { B.zcirc(z.x, z.y, z.r, ca(col, fill * f), 0); B.zcirc(z.x, z.y, z.r, ca(col, 0.9 * f), band); return; } // 2D zone LOD: batched fill + band
    B.circ(z.x, z.y, z.r, ca(col, fill * f), 0);
    B.circ(z.x, z.y, z.r, ca(col, 0.9 * f), band);
    B.circ(z.x, z.y, Math.max(1, z.r - band - 2), ca(WHITE, 0.6 * f), 1);
    B.circ(z.x, z.y, z.r * 0.82, ca(col, 0.35 * f), 1);
  }
  function peal(B, z, t) {
    if (z.r < 2) return;
    const k = kOf(z), f = 1 - k;
    if (z.t < 0.18) B.circ(z.x, z.y, 40 + z.r * 0.3, ca(WHITE, 0.5 * (1 - z.t / 0.18)), 0);
    if (B.zoneLite) { B.zcirc(z.x, z.y, z.r, ca(BRONZE, 0.1 * f), 0); B.zcirc(z.x, z.y, z.r, ca(BRONZE, 0.95 * f), 7); return; }
    B.circ(z.x, z.y, z.r, ca(BRONZE, 0.1 * f), 0);
    B.circ(z.x, z.y, z.r, ca(BRONZE, 0.95 * f), 7);
    B.circ(z.x, z.y, z.r - 5, ca(WHITE, 0.9 * f), 2);
    B.circ(z.x, z.y, z.r * 0.9, ca(GOLD, 0.5 * f), 2);
    B.circ(z.x, z.y, z.r * 0.75, ca(GOLD, 0.25 * f), 1);
  }
  function bellZone(B, z, t) {
    switch (z.k) {
      case 'tollb': bellSpr(B, 'weapon.bronzebell', z.x, z.y, t, z.id, 1.25, 0.5); return true;
      case 'cathb': B.circ(z.x, z.y - 6, 13, ca(GOLD, 0.18 + 0.1 * Math.sin(t * 7 + z.id)), 0); bellSpr(B, 'weapon.greatbell', z.x, z.y, t, z.id, 1.5, 0.45); return true;
      case 'tollw': waveRing(B, z, 3, BRONZE, 0.1); return true;
      case 'cathw': waveRing(B, z, 4, GOLD, 0.12); return true;
      case 'pealw': peal(B, z, t); return true;
      default: return false;
    }
  }
  reg(['toll', 'cathedral', 'peal'], { zone: bellZone });
})(globalThis.ED || (globalThis.ED = {}));
