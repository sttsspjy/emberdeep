// Bell visuals (ED.WeaponFx / ED.SkillFx, routed by zone look k): bells (tollb glacb carb cathb), chimes, rings (tollw tollf cathw glacw underw chimew pealw), frost ground (rime).
// Pixel art: atlas bell sprites at integer scale, thin Batch rings and whole-px rects; reads only snapshot zone fields (k, x, y, r, t, dur, id). B.zoneLite (2D zone LOD): fill + rim via zcirc.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const BRONZE = 0xe6c27a, GOLD = 0xffe08a, WHITE = 0xfff6dc, ICE = 0x9fdcff, ICEW = 0xe8f8ff, TEAL = 0x4fb3a9, DEEP = 0x1f5048;
  // 0xRRGGBB + alpha 0..1 -> 0xRRGGBBAA.
  const ca = (c, a) => (((c << 8) | Math.max(0, Math.min(255, Math.round(a * 255)))) >>> 0);
  const O = { flip: false, alpha: 1, rot: 0, sx: 1, sy: 1, add: false, flash: 0, tint: 0xffffff };
  const opt = (alpha, s, tint) => { O.alpha = alpha; O.sx = O.sy = s; O.tint = tint || 0xffffff; O.flip = false; O.rot = 0; O.add = false; O.flash = 0; return O; };
  const kOf = (z) => (z.dur > 0 ? U.clamp(z.t / z.dur, 0, 1) : 0);
  const q = Math.round;

  // Bell sprite hanging at (x, y - lift) (grip pivot), integer scale s, a 1 px sway from the zone id; fallback disc without art.
  function bellSpr(B, id, x, y, lift, s, t, ph, tint) {
    B.shadow(q(x), q(y + 3), 5 * s);
    const sway = Math.sin(t * 6 + ph) > 0 ? 1 : 0;
    if (!B.spr(id, 0, q(x) + sway, q(y - lift), opt(1, s, tint))) B.circ(q(x), q(y - 4), 5 * s, ca(BRONZE, 1), 0);
  }
  // Expanding / closing ring: faint fill, a band of lw px in col, a 1 px inner line in hi; fades over the ring's life.
  function ring(B, z, col, hi, lw, fill) {
    if (z.r < 2) return;
    const f = 1 - kOf(z) * kOf(z), x = q(z.x), y = q(z.y);
    if (B.zoneLite) { B.zcirc(x, y, z.r, ca(col, fill * f), 0); B.zcirc(x, y, z.r, ca(col, 0.9 * f), lw); return; }
    if (fill > 0) B.circ(x, y, z.r, ca(col, fill * f), 0);
    B.circ(x, y, z.r, ca(col, 0.9 * f), lw);
    if (z.r > lw + 3) B.circ(x, y, z.r - lw - 1, ca(hi, 0.7 * f), 1);
  }
  // n whole-px marks on the rim of z (ice crystals / inward chevron tips), rotated by the zone id.
  function rimMarks(B, z, n, col, size, inward) {
    if (B.zoneLite || z.r < 8) return;
    const f = 1 - kOf(z), a0 = (z.id % 16) / 16 * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * TAU / n, c = Math.cos(a), s = Math.sin(a), x = z.x + c * z.r, y = z.y + s * z.r;
      if (inward) B.line(q(x), q(y), q(x - c * 6), q(y - s * 6), 1, ca(col, 0.9 * f));
      else B.rect(q(x) - (size >> 1), q(y) - (size >> 1), size, size, ca(col, 0.95 * f));
    }
  }
  // Frost ground: pale fill, 1 px rim, a few twinkling ice pixels (hash of zone id).
  function rime(B, z, t) {
    const f = Math.min(1, z.t / 0.15, (z.dur - z.t) / 0.4), x = q(z.x), y = q(z.y);
    if (B.zoneLite) { B.zcirc(x, y, z.r, ca(ICE, 0.16 * f), 0); B.zcirc(x, y, z.r, ca(ICE, 0.5 * f), 1); return; }
    B.circ(x, y, z.r, ca(ICE, 0.16 * f), 0);
    B.circ(x, y, z.r, ca(ICEW, 0.5 * f), 1);
    for (let i = 0; i < 6; i++) {
      const h = U.hash3(z.id, i, 11), a = (h & 1023) / 1024 * TAU, d = Math.sqrt(((h >>> 10) & 1023) / 1024) * (z.r - 2);
      if (Math.sin(t * 5 + i * 1.7) > 0.2) B.rect(q(z.x + Math.cos(a) * d), q(z.y + Math.sin(a) * d * 0.6), 1, 1, ca(ICEW, f));
    }
  }
  // Chime: a handbell on a 1 px cord from a small hook, a ring pulse when it rings (every 0.6 s from 0.15 s); fades in its last 0.5 s.
  function chime(B, z, t) {
    const f = Math.min(1, z.t / 0.15, (z.dur - z.t) / 0.5), x = q(z.x), y = q(z.y), ph = ((z.t - 0.15) % 0.6 + 0.6) % 0.6;
    if (!B.zoneLite) B.rect(x, y - 22, 1, 10, ca(DEEP, 0.9 * f));
    if (!B.spr('weapon.handbells', 0, x + (ph < 0.15 ? 1 : 0), y - 13, opt(f, 1))) B.circ(x, y - 9, 3, ca(BRONZE, f), 0);
    if (ph < 0.2) B.circ(x, y - 8, 4 + q(ph * 30), ca(WHITE, 0.8 * f * (1 - ph / 0.2)), 1);
  }
  // Great Peal: opening flash, a 3 px bronze band, white and gold inner lines.
  function peal(B, z) {
    if (z.r < 2) return;
    const f = 1 - kOf(z), x = q(z.x), y = q(z.y);
    if (z.t < 0.18 && !B.zoneLite) B.circ(x, y, 40 + z.r * 0.3, ca(WHITE, 0.45 * (1 - z.t / 0.18)), 0);
    if (B.zoneLite) { B.zcirc(x, y, z.r, ca(BRONZE, 0.08 * f), 0); B.zcirc(x, y, z.r, ca(BRONZE, 0.95 * f), 3); return; }
    B.circ(x, y, z.r, ca(BRONZE, 0.08 * f), 0);
    B.circ(x, y, z.r, ca(BRONZE, 0.95 * f), 3);
    B.circ(x, y, z.r - 4, ca(WHITE, 0.85 * f), 1);
    B.circ(x, y, z.r * 0.9, ca(GOLD, 0.45 * f), 1);
  }

  function bellZone(B, z, t) {
    switch (z.k) {
      case 'tollb': bellSpr(B, 'weapon.bronzebell', z.x, z.y, 10, 1, t, z.id, 0); return true;
      case 'glacb': if (!B.zoneLite) B.circ(q(z.x), q(z.y - 4), 9, ca(ICE, 0.22), 0); bellSpr(B, 'weapon.bronzebell', z.x, z.y, 10, 1, t, z.id, ICE); return true;
      case 'carb': bellSpr(B, 'weapon.handbells', z.x, z.y, 8, 2, t, z.id, 0); return true;
      case 'cathb': if (!B.zoneLite) B.circ(q(z.x), q(z.y - 8), 14, ca(GOLD, 0.16 + 0.08 * Math.sin(t * 7 + z.id)), 1); bellSpr(B, 'weapon.greatbell', z.x, z.y, 18, 2, t, z.id, 0); return true;
      case 'chime': chime(B, z, t); return true;
      case 'tollw': ring(B, z, BRONZE, WHITE, 2, 0.08); return true;
      case 'tollf': ring(B, z, ICE, ICEW, 2, 0.08); return true;
      case 'cathw': ring(B, z, GOLD, WHITE, 3, 0.1); return true;
      case 'glacw': ring(B, z, ICE, ICEW, 2, 0.12); rimMarks(B, z, 10, ICEW, 2, false); return true;
      case 'underw': ring(B, z, TEAL, WHITE, 2, 0.1); rimMarks(B, z, 12, TEAL, 0, true); return true;
      case 'chimew': ring(B, z, WHITE, GOLD, 1, 0.05); return true;
      case 'rime': rime(B, z, t); return true;
      case 'pealw': peal(B, z); return true;
      default: return false;
    }
  }
  const fx = { zone: bellZone };
  for (const id of ['toll', 'cathedral', 'glaciertoll', 'carillon', 'undertow', 'windchime']) ED.WeaponFx[id] = fx;
  ED.SkillFx.peal = fx;
})(globalThis.ED || (globalThis.ED = {}));
