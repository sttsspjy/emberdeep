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
  function pillar(B, z, t, big) {
    const k = kOf(z), r = z.r, top = z.y - 150 - r, head = top + (z.y - top) * k, cw = r * (0.35 + 0.45 * k) * (big ? 1.3 : 1);
    B.circ(z.x, z.y, r, ca(HOLY, 0.12 + 0.25 * k), 0);
    B.circ(z.x, z.y, r * (1.6 - 0.6 * k), ca(WHITE, 0.4 + 0.5 * k), 1.5);
    B.rect(z.x - cw / 2, top, cw, head - top, ca(GOLD, 0.18 + 0.3 * k));
    B.rect(z.x - cw / 5, top, cw / 2.5, head - top, ca(WHITE, 0.35 + 0.5 * k));
    B.rect(z.x - cw / 2 - 1, head - 6, cw + 2, 8, ca(WHITE, 0.9));
    if (big) for (let i = 0; i < 4; i++) { const a = t * 3 + i * TAU / 4; B.line(z.x, z.y, z.x + Math.cos(a) * r * 1.4 * k, z.y + Math.sin(a) * r * 0.7 * k, 1, ca(WHITE, 0.7)); }
  }
  // Afterglow of a landed pillar: a fading full-height column and a ground burst.
  function glow(B, z, t) {
    const k = kOf(z), f = 1 - k, r = z.r, top = z.y - 170 - r;
    B.circ(z.x, z.y, r * (1 + 0.6 * k), ca(WHITE, 0.55 * f), 0);
    B.rect(z.x - r * 0.45 * f, top, r * 0.9 * f, z.y - top, ca(GOLD, 0.55 * f));
    B.rect(z.x - r * 0.15 * f, top, r * 0.3 * f, z.y - top, ca(WHITE, 0.9 * f));
    B.circ(z.x, z.y, r * (1.2 + 0.8 * k), ca(GOLD, 0.8 * f), 2);
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
    B.circ(z.x, z.y, z.r, ca(HOLY, (0.14 + 0.06 * pulse) * f), 0);
    B.circ(z.x, z.y, z.r, ca(GOLD, 0.55 * f), 1);
    motes(B, z, t, 5, WHITE, 1);
  }
  function sanct(B, z, t) {
    const f = fade(z, 0.2, 0.35), pulse = 0.5 + 0.5 * Math.sin(t * 5), r = z.r;
    B.circ(z.x, z.y, r, ca(HOLY, 0.16 * f), 0);
    B.circ(z.x, z.y, r * (0.55 + 0.1 * pulse), ca(WHITE, 0.08 * f), 0);
    B.circ(z.x, z.y, r, ca(GOLD, (0.7 + 0.3 * pulse) * f), 3);
    B.circ(z.x, z.y, r - 6, ca(WHITE, 0.45 * f), 1);
    for (let i = 0; i < 10; i++) { const a = t * 0.9 + i * TAU / 10, x = z.x + Math.cos(a) * (r - 13), y = z.y + Math.sin(a) * (r - 13); B.rect(x - 2, y - 2, 4, 4, ca(WHITE, 0.85 * f)); }
    for (let i = 0; i < 6; i++) { const a = -t * 1.4 + i * TAU / 6; B.line(z.x + Math.cos(a) * r * 0.3, z.y + Math.sin(a) * r * 0.3, z.x + Math.cos(a) * r * 0.62, z.y + Math.sin(a) * r * 0.62, 1, ca(GOLD, 0.5 * f)); }
    B.rect(z.x - 2, z.y - 16, 4, 22, ca(WHITE, 0.8 * f)); B.rect(z.x - 8, z.y - 10, 16, 4, ca(WHITE, 0.8 * f));
    if (z.t < 0.3) { const k = z.t / 0.3; B.circ(z.x, z.y, r * (0.4 + 0.8 * k), ca(WHITE, 0.6 * (1 - k)), 0); }
    motes(B, z, t, 14, WHITE, 2);
  }
  // Judgment beam: wide gold glow, bright body, white core, a flare at the hero and the tip.
  function beam(B, z, t) {
    const f = fade(z, 0.08, 0.12), ex = z.x + Math.cos(z.a) * z.len, ey = z.y - 8 + Math.sin(z.a) * z.len, y0 = z.y - 8, fl = 0.85 + 0.15 * Math.sin(t * 60);
    B.line(z.x, y0, ex, ey, z.w * 1.8, ca(HOLY, 0.22 * f));
    B.line(z.x, y0, ex, ey, z.w, ca(GOLD, 0.6 * f * fl));
    B.line(z.x, y0, ex, ey, z.w * 0.4, ca(WHITE, 0.95 * f));
    B.circ(z.x, y0, z.w * 0.8, ca(WHITE, 0.8 * f), 0);
    B.circ(ex, ey, z.w * (0.9 + 0.3 * Math.sin(t * 40)), ca(WHITE, 0.7 * f), 0);
    B.circ(ex, ey, z.w * 1.6, ca(GOLD, 0.6 * f), 2);
  }
  const clericZone = (B, z, t) => {
    switch (z.k) {
      case 'smite': pillar(B, z, t, false); return true;
      case 'wrath': pillar(B, z, t, true); return true;
      case 'pglow': glow(B, z, t); return true;
      case 'conse': conse(B, z, t); return true;
      case 'sanct': sanct(B, z, t); return true;
      case 'judge': beam(B, z, t); return true;
      default: return false;
    }
  };
  reg(['smite', 'wrath', 'sanctuary', 'judgment'], { zone: clericZone });

  // ---------------- shade ----------------
  // Knife with a motion trail; violet: the Shadow Fan / afterimage tint (additive glow).
  function knife(B, pr, t, len, col, add) {
    const c = Math.cos(pr.a), s = Math.sin(pr.a);
    B.line(pr.x - c * len, pr.y - s * len, pr.x, pr.y, 2, ca(col, 0.45));
    if (!B.spr('proj.knife', 0, pr.x, pr.y, opt(1, pr.a, 1, false))) B.circ(pr.x, pr.y, 2, ca(PALE, 1), 0);
    if (add) B.spr('proj.knife', 0, pr.x, pr.y, opt(0.6, pr.a, 1.3, true));
  }
  function afterimage(B, z, t) {
    const k = kOf(z), flick = 0.45 + 0.15 * Math.sin(t * 40 + z.id), flip = Math.cos(z.a) > 0;
    B.circ(z.x, z.y - 4, z.r, ca(DUSK, 0.12 + 0.3 * k), 0);
    B.circ(z.x, z.y - 4, z.r, ca(VIOLET, 0.5 + 0.5 * k), 1.5);
    B.circ(z.x, z.y - 4, z.r * (1 - k), ca(0xc8b0ff, 0.8), 1);
    if (!B.spr('hero.shade.idle', 0, z.x, z.y, opt(flick, 0, 1, false, flip))) B.circ(z.x, z.y - 8, 7, ca(VIOLET, flick), 0);
    B.spr('hero.shade.idle', 0, z.x + 2, z.y, opt(0.35, 0, 1, true, flip));
    for (let i = 0; i < 6; i++) { const h = U.hash3(z.id, i, 3), a = (h & 1023) / 1024 * TAU, c = (t * 1.5 + (h >>> 12 & 255) / 256) % 1; B.rect(z.x + Math.cos(a) * 10 * c, z.y - 10 - c * 18, 2, 2, ca(VIOLET, 1 - c)); }
  }
  function stepcut(B, z, t) {
    const k = kOf(z), f = 1 - k, ex = z.x + Math.cos(z.a) * z.len, ey = z.y - 6 + Math.sin(z.a) * z.len;
    B.line(z.x, z.y - 6, ex, ey, z.w * f, ca(DUSK, 0.5 * f));
    B.line(z.x, z.y - 6, ex, ey, Math.max(1, z.w * 0.3 * f), ca(VIOLET, 0.9 * f));
    B.line(z.x, z.y - 6, ex, ey, 1, ca(0xffffff, f));
    const nx = -Math.sin(z.a), ny = Math.cos(z.a);
    for (let i = 1; i < 6; i++) { const m = i / 6, x = z.x + (ex - z.x) * m, y = z.y - 6 + (ey - z.y + 6) * m, s = (i % 2 ? 1 : -1) * z.w * 0.7 * f; B.line(x - nx * s, y - ny * s, x + nx * s, y + ny * s, 1, ca(0xc8b0ff, 0.8 * f)); }
  }
  const shadeZone = (B, z, t) => {
    if (z.k === 'afterimg') { afterimage(B, z, t); return true; }
    if (z.k === 'stepcut') { stepcut(B, z, t); return true; }
    return false;
  };
  reg(['daggers'], { proj: (B, pr, t) => { knife(B, pr, t, 8, PALE, false); return true; } });
  reg(['shadowfan'], { proj: (B, pr, t) => { knife(B, pr, t, 12, VIOLET, true); return true; } });
  reg(['fan'], { proj: (B, pr, t) => { knife(B, pr, t, 14, 0xc8b0ff, false); return true; } });
  reg(['step'], { zone: shadeZone, proj: (B, pr, t) => { knife(B, pr, t, 10, VIOLET, true); return true; } });

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
    B.circ(z.x, z.y, z.r, ca(col, fill * f), 0);
    B.circ(z.x, z.y, z.r, ca(col, 0.9 * f), band);
    B.circ(z.x, z.y, Math.max(1, z.r - band - 2), ca(WHITE, 0.6 * f), 1);
    B.circ(z.x, z.y, z.r * 0.82, ca(col, 0.35 * f), 1);
  }
  function peal(B, z, t) {
    if (z.r < 2) return;
    const k = kOf(z), f = 1 - k;
    if (z.t < 0.18) B.circ(z.x, z.y, 40 + z.r * 0.3, ca(WHITE, 0.5 * (1 - z.t / 0.18)), 0);
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
      case 'hurlw': waveRing(B, z, 4, BRONZE, 0.14); return true;
      case 'pealw': peal(B, z, t); return true;
      case 'hurlb': {
        const f = fade(z, 0.05, 0.2);
        B.circ(z.x, z.y, 18, ca(DUSK, 0.25 * f), 0);
        for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + z.id; B.line(z.x, z.y, z.x + Math.cos(a) * 22, z.y + Math.sin(a) * 11, 1, ca(0x2a1a10, 0.6 * f)); }
        bellSpr(B, 'weapon.greatbell', z.x, z.y, t, z.id, 1.6, 0.6);
        return true;
      }
      default: return false;
    }
  }
  // Thrown bell: spinning great bell, speed streaks behind, a faint drag swirl.
  function bellProj(B, pr, t) {
    const c = Math.cos(pr.a), s = Math.sin(pr.a);
    B.circ(pr.x, pr.y, 30, ca(BRONZE, 0.1), 0);
    for (let i = 0; i < 3; i++) { const o = (i - 1) * 5; B.line(pr.x - c * 26 - s * o, pr.y - s * 26 + c * o, pr.x - c * 8 - s * o, pr.y - s * 8 + c * o, 1, ca(PALE, 0.6)); }
    if (!B.spr('weapon.greatbell', 0, pr.x, pr.y - 6, opt(1, t * 14 + pr.id, 1.5, false))) B.circ(pr.x, pr.y, 7, ca(BRONZE, 1), 0);
    return true;
  }
  reg(['toll', 'cathedral', 'peal'], { zone: bellZone });
  reg(['hurl'], { zone: bellZone, proj: bellProj });
})(globalThis.ED || (globalThis.ED = {}));
