// Client draw hooks for heroes cleric, shade, bell: registers ED.WeaponFx / ED.SkillFx entries (see util.js). Every hook reads only snapshot-visible fields
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

  // ---------------- cleric ----------------
  // Falling pillar: target ring closing in, a light column whose bright head drops onto the target, brighter as it lands.
  // B.zoneLite (2D zone LOD): batched target disc and ring, the core column only.
  function pillar(B, z, t, big) {
    const k = kOf(z), r = z.r, top = z.y - 150 - r, head = top + (z.y - top) * k, cw = r * (0.35 + 0.45 * k) * (big ? 1.3 : 1), lite = B.zoneLite;
    const disc = lite ? B.zcirc : B.circ;
    disc(z.x, z.y, r, ca(HOLY, 0.12 + 0.25 * k), 0);
    disc(z.x, z.y, r * (1.6 - 0.6 * k), ca(WHITE, 0.4 + 0.5 * k), 1.5);
    if (!lite) B.rect(z.x - cw / 2, top, cw, head - top, ca(GOLD, 0.18 + 0.3 * k));
    B.rect(z.x - cw / 5, top, cw / 2.5, head - top, ca(WHITE, 0.35 + 0.5 * k));
    B.rect(z.x - cw / 2 - 1, head - 6, cw + 2, 8, ca(WHITE, 0.9));
    if (big && !lite) for (let i = 0; i < 4; i++) { const a = t * 3 + i * TAU / 4; B.line(z.x, z.y, z.x + Math.cos(a) * r * 1.4 * k, z.y + Math.sin(a) * r * 0.7 * k, 1, ca(WHITE, 0.7)); }
  }
  // Afterglow of a landed pillar: a fading full-height column and a ground burst. B.zoneLite: batched burst, the core column only.
  function glow(B, z, t) {
    const k = kOf(z), f = 1 - k, r = z.r, top = z.y - 170 - r, lite = B.zoneLite, disc = lite ? B.zcirc : B.circ;
    disc(z.x, z.y, r * (1 + 0.6 * k), ca(WHITE, 0.55 * f), 0);
    if (!lite) B.rect(z.x - r * 0.45 * f, top, r * 0.9 * f, z.y - top, ca(GOLD, 0.55 * f));
    B.rect(z.x - r * 0.15 * f, top, r * 0.3 * f, z.y - top, ca(WHITE, 0.9 * f));
    disc(z.x, z.y, r * (1.2 + 0.8 * k), ca(GOLD, 0.8 * f), 2);
  }
  // Rising motes inside a circle (deterministic from the zone id and t).
  function motes(B, z, t, n, col, size) {
    for (let i = 0; i < n; i++) {
      const h = U.hash3(z.id, i, 7), ph = (h & 1023) / 1024, a = ((h >>> 10) & 1023) / 1024 * TAU, d = Math.sqrt(((h >>> 20) & 1023) / 1024) * z.r;
      const c = (t * 0.8 + ph) % 1, x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d * 0.8 - c * 26;
      B.rect(x, y, size, size + 1, ca(col, 0.9 * (1 - c)));
    }
  }
  function conse(B, z, t) {
    const f = fade(z, 0.15, 0.4), pulse = 0.5 + 0.5 * Math.sin(t * 6 + z.id);
    if (B.zoneLite) { B.zcirc(z.x, z.y, z.r, ca(HOLY, 0.18 * f), 0); B.zcirc(z.x, z.y, z.r, ca(GOLD, 0.55 * f), 1); return; } // 2D zone LOD: batched fill + rim
    B.circ(z.x, z.y, z.r, ca(HOLY, (0.14 + 0.06 * pulse) * f), 0);
    B.circ(z.x, z.y, z.r, ca(GOLD, 0.55 * f), 1);
    motes(B, z, t, 5, WHITE, 1);
  }
  function sanct(B, z, t) {
    const f = fade(z, 0.2, 0.35), pulse = 0.5 + 0.5 * Math.sin(t * 5), r = z.r;
    B.circ(z.x, z.y, r, ca(HOLY, 0.16 * f), 0);
    if (!B.zoneLite) B.circ(z.x, z.y, r * (0.55 + 0.1 * pulse), ca(WHITE, 0.08 * f), 0);
    B.circ(z.x, z.y, r, ca(GOLD, (0.7 + 0.3 * pulse) * f), 3);
    B.circ(z.x, z.y, r - 6, ca(WHITE, 0.45 * f), 1);
    for (let i = 0; i < 10; i++) { const a = t * 0.9 + i * TAU / 10, x = z.x + Math.cos(a) * (r - 13), y = z.y + Math.sin(a) * (r - 13); B.rect(x - 2, y - 2, 4, 4, ca(WHITE, 0.85 * f)); }
    for (let i = 0; i < 6; i++) { const a = -t * 1.4 + i * TAU / 6; B.line(z.x + Math.cos(a) * r * 0.3, z.y + Math.sin(a) * r * 0.3, z.x + Math.cos(a) * r * 0.62, z.y + Math.sin(a) * r * 0.62, 1, ca(GOLD, 0.5 * f)); }
    B.rect(z.x - 2, z.y - 16, 4, 22, ca(WHITE, 0.8 * f)); B.rect(z.x - 8, z.y - 10, 16, 4, ca(WHITE, 0.8 * f));
    if (z.t < 0.3) { const k = z.t / 0.3; B.circ(z.x, z.y, r * (0.4 + 0.8 * k), ca(WHITE, 0.6 * (1 - k)), 0); }
    motes(B, z, t, 14, WHITE, 2);
  }

  const clericZone = (B, z, t) => {
    switch (z.k) {
      case 'smite': pillar(B, z, t, false); return true;
      case 'wrath': pillar(B, z, t, true); return true;
      case 'pglow': glow(B, z, t); return true;
      case 'conse': conse(B, z, t); return true;
      case 'sanct': sanct(B, z, t); return true;

      default: return false;
    }
  };
  reg(['smite', 'wrath', 'sanctuary'], { zone: clericZone });

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
