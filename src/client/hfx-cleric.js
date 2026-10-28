// Cleric visuals (ED.WeaponFx / ED.SkillFx hooks for smite, its Forms and sanctuary); loaded after fx.js. Every hook reads only snapshot-visible zone fields
// (k, x, y, r, a, len, w, t, dur, id) and routes by look name z.k. Ground pass: pillars, afterglow, grounds, aura / halo discs. Top pass (over the actors): censers, beams, rays.
// Censer angle = SW_W x zone age and pulse phase = zone age mod PULSE, the same clocks the sim uses (cleric.js), so clients need no extra wire fields.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const GOLD = 0xffe08a, WHITE = 0xfff6dc, HOLY = 0xffd36b, BRONZE = 0xa08050, SMOKE = 0xfff0c0;
  const SW_W = 3, PULSE = 0.5, BAND_IN = 14, BAND_OUT = 10;
  // 0xRRGGBB + alpha 0..1 -> 0xRRGGBBAA.
  const ca = (c, a) => (((c << 8) | Math.max(0, Math.min(255, Math.round(a * 255)))) >>> 0);
  const O = { flip: false, alpha: 1, rot: 0, sx: 1, sy: 1, add: false, flash: 0 };
  const opt = (alpha, s, add) => { O.alpha = alpha; O.rot = 0; O.sx = O.sy = s || 1; O.add = !!add; O.flip = false; O.flash = 0; return O; };
  const kOf = (z) => (z.dur > 0 ? U.clamp(z.t / z.dur, 0, 1) : 0);
  // Fade in over the first fi s and out over the last fo s of a zone.
  const fade = (z, fi, fo) => Math.min(1, z.t / fi, (z.dur - z.t) / fo);
  const A = () => ED.Atlas;

  // Falling pillar: target ring closing in, a light column whose bright head drops onto the target, brighter as it lands; big (Wrath): spinning sparks.
  // B.zoneLite (2D zone LOD): batched target disc and ring, the core column only.
  function pillar(B, z, t, big) {
    const k = kOf(z), r = z.r, top = z.y - 150 - r, head = top + (z.y - top) * k, cw = Math.round(r * (0.35 + 0.45 * k) * (big ? 1.3 : 1)), lite = B.zoneLite;
    const disc = lite ? B.zcirc : B.circ;
    disc(z.x, z.y, r, ca(HOLY, 0.12 + 0.25 * k), 0);
    disc(z.x, z.y, r * (1.6 - 0.6 * k), ca(WHITE, 0.4 + 0.5 * k), 1);
    if (!lite) B.rect(z.x - cw / 2, top, cw, head - top, ca(GOLD, 0.12 + 0.2 * k));
    B.rect(z.x - Math.max(1, cw / 10), top, Math.max(2, cw / 5), head - top, ca(WHITE, 0.3 + 0.45 * k));
    B.rect(z.x - cw / 2 - 1, head - 6, cw + 2, 6, ca(WHITE, 0.9));
    if (big && !lite) for (let i = 0; i < 4; i++) { const a = t * 3 + i * TAU / 4; B.rect(z.x + Math.cos(a) * r * 1.3 * k - 1, z.y + Math.sin(a) * r * 0.65 * k - 1, 2, 2, ca(WHITE, 0.85)); }
  }
  // Afterglow of a landed pillar: a fading full-height column and a ground burst (small hot core, thin expanding rings; no wide fill). B.zoneLite: batched burst, the core column only.
  function glow(B, z, t) {
    const k = kOf(z), f = 1 - k, r = z.r, top = z.y - 170 - r, lite = B.zoneLite, disc = lite ? B.zcirc : B.circ;
    disc(z.x, z.y, Math.max(2, r * 0.3), ca(WHITE, 0.5 * f), 0);
    if (!lite) { B.circ(z.x, z.y, r * (0.8 + 0.6 * k), ca(WHITE, 0.6 * f), 1); B.rect(z.x - r * 0.25 * f, top, r * 0.5 * f, z.y - top, ca(GOLD, 0.3 * f)); }
    B.rect(z.x - r * 0.06 * f, top, Math.max(1, r * 0.12 * f), z.y - top, ca(WHITE, 0.75 * f));
    disc(z.x, z.y, r * (1.2 + 0.8 * k), ca(GOLD, 0.8 * f), 1);
  }
  // Rising motes inside a circle (deterministic from the zone id and t); cross: small holy crosses instead of squares.
  function motes(B, z, t, n, col, size, cross) {
    for (let i = 0; i < n; i++) {
      const h = U.hash3(z.id, i, 7), ph = (h & 1023) / 1024, a = ((h >>> 10) & 1023) / 1024 * TAU, d = Math.sqrt(((h >>> 20) & 1023) / 1024) * z.r;
      const c = (t * 0.8 + ph) % 1, x = Math.round(z.x + Math.cos(a) * d), y = Math.round(z.y + Math.sin(a) * d * 0.8 - c * 26), al = 0.9 * (1 - c);
      if (cross) { B.rect(x - 1, y - 2, 1, 5, ca(col, al)); B.rect(x - 2, y - 1, 3, 1, ca(col, al)); }
      else B.rect(x, y, size, size + 1, ca(col, al));
    }
  }
  // Consecration holy ground: pulsing fill, 1 px rim, an inner ring, rising healing crosses.
  function ground(B, z, t, cross) {
    const f = fade(z, 0.15, 0.4), pulse = 0.5 + 0.5 * Math.sin(t * 6 + z.id);
    if (B.zoneLite) { B.zcirc(z.x, z.y, z.r, ca(HOLY, 0.16 * f), 0); B.zcirc(z.x, z.y, z.r, ca(GOLD, 0.5 * f), 1); return; } // 2D zone LOD: batched fill + rim
    B.circ(z.x, z.y, z.r, ca(HOLY, (0.07 + 0.04 * pulse) * f), 0);
    B.circ(z.x, z.y, z.r, ca(GOLD, 0.55 * f), 1);
    if (cross) B.circ(z.x, z.y, z.r * (0.5 + 0.1 * pulse), ca(WHITE, 0.25 * f), 1);
    motes(B, z, t, cross ? 4 : 5, WHITE, 1, cross);
  }
  function sanct(B, z, t) {
    const f = fade(z, 0.2, 0.35), pulse = 0.5 + 0.5 * Math.sin(t * 5), r = z.r;
    B.circ(z.x, z.y, r, ca(HOLY, 0.16 * f), 0);
    if (!B.zoneLite) B.circ(z.x, z.y, r * (0.55 + 0.1 * pulse), ca(WHITE, 0.08 * f), 0);
    B.circ(z.x, z.y, r, ca(GOLD, (0.7 + 0.3 * pulse) * f), 2);
    B.circ(z.x, z.y, r - 6, ca(WHITE, 0.45 * f), 1);
    for (let i = 0; i < 10; i++) { const a = t * 0.9 + i * TAU / 10, x = z.x + Math.cos(a) * (r - 13), y = z.y + Math.sin(a) * (r - 13); B.rect(x - 2, y - 2, 4, 4, ca(WHITE, 0.85 * f)); }
    for (let i = 0; i < 6; i++) { const a = -t * 1.4 + i * TAU / 6; B.line(z.x + Math.cos(a) * r * 0.3, z.y + Math.sin(a) * r * 0.3, z.x + Math.cos(a) * r * 0.62, z.y + Math.sin(a) * r * 0.62, 1, ca(GOLD, 0.5 * f)); }
    B.rect(z.x - 2, z.y - 16, 4, 22, ca(WHITE, 0.8 * f)); B.rect(z.x - 8, z.y - 10, 16, 4, ca(WHITE, 0.8 * f));
    if (z.t < 0.3) { const k = z.t / 0.3; B.circ(z.x, z.y, r * (0.4 + 0.8 * k), ca(WHITE, 0.6 * (1 - k)), 0); }
    motes(B, z, t, 14, WHITE, 2, false);
  }
  // Aura: faint disc, 1 px rim, a thin pulse ring per sim pulse, eight rim sparks turning. Halo: the ring wall (bright 2 px ring between thin band edges, turning spokes across
  // the band, sparkles riding it) over a fainter inner disc.
  function aura(B, z, t, halo) {
    const f = Math.min(1, z.t / 0.3), R = z.r, x = z.x, y = z.y, q = (z.t % PULSE) / PULSE;
    if (B.zoneLite) { B.zcirc(x, y, R, ca(HOLY, 0.08 * f), 0); B.zcirc(x, y, R, ca(GOLD, 0.6 * f), halo ? 2 : 1); return; }
    B.circ(x, y, R, ca(HOLY, (halo ? 0.06 : 0.08) * f), 0);
    B.circ(x, y, R * (0.3 + 0.7 * q), ca(WHITE, 0.35 * (1 - q) * f), 1);
    if (!halo) {
      B.circ(x, y, R, ca(GOLD, 0.55 * f), 1);
      for (let i = 0; i < 8; i++) { const a = t * 0.7 + i * TAU / 8; B.rect(x + Math.cos(a) * R - 1, y + Math.sin(a) * R - 1, 2, 2, ca(WHITE, 0.8 * f)); }
      return;
    }
    B.circ(x, y, R - BAND_IN, ca(GOLD, 0.35 * f), 1);
    B.circ(x, y, R + BAND_OUT, ca(GOLD, 0.35 * f), 1);
    B.circ(x, y, R, ca(WHITE, 0.85 * f), 2);
    for (let i = 0; i < 16; i++) {
      const a = -t * 0.9 + i * TAU / 16, c = Math.cos(a), s = Math.sin(a);
      B.line(x + c * (R - BAND_IN), y + s * (R - BAND_IN), x + c * (R + BAND_OUT), y + s * (R + BAND_OUT), 1, ca(GOLD, 0.45 * f));
    }
    const sp = A() && A().has('fx.spark.magic') ? 'fx.spark.magic' : '';
    for (let i = 0; i < 6; i++) {
      const a = t * 1.3 + i * TAU / 6, sx = x + Math.cos(a) * R, sy = y + Math.sin(a) * R;
      if (!sp || !B.spr(sp, A().frameAt(sp, t + i * 0.13), sx, sy, opt(0.9 * f, 0.6, true))) B.rect(sx - 1, sy - 1, 3, 3, ca(WHITE, 0.9 * f));
    }
  }
  // Censers (top pass): z.w of them at angle SW_W x z.t, on a 1 px chain from the hero's hand, swaying lantern sprite with a short smoke trail.
  function censers(B, z, t, halo) {
    const n = z.w | 0; if (!n) return;
    const f = Math.min(1, z.t / 0.3), R = halo ? z.r : z.r * 0.8, a0 = z.t * SW_W, ok = A() && A().has('weapon.lantern');
    for (let i = 0; i < n; i++) {
      const a = a0 + i * TAU / n, cx = z.x + Math.cos(a) * R, cy = z.y + Math.sin(a) * R;
      if (!halo) B.line(z.x, z.y - 8, cx, cy - 6, 1, ca(BRONZE, 0.7 * f));
      for (let j = 1; j <= 3; j++) { const b = a - j * 0.22; B.rect(z.x + Math.cos(b) * R - 1, z.y + Math.sin(b) * R - 2 - j * 2, 2 + (j > 1 ? 1 : 0), 2, ca(SMOKE, (0.55 - j * 0.14) * f)); }
      if (!ok || !B.spr('weapon.lantern', 0, cx, cy, opt(f, 1, false))) { B.circ(cx, cy - 3, 3, ca(GOLD, f), 0); B.rect(cx - 1, cy - 4, 2, 2, ca(WHITE, f)); }
    }
  }
  // Holy beam (top pass) from the hero's chest: gold glow, body, white core, a flare at the hero and the tip. ray: steady (no fade-out), slower flicker.
  function beam(B, z, t, ray) {
    const f = ray ? Math.min(1, z.t / 0.2) : fade(z, 0.06, 0.1), y0 = z.y - 8, ex = z.x + Math.cos(z.a) * z.len, ey = y0 + Math.sin(z.a) * z.len;
    const fl = 0.85 + 0.15 * Math.sin(t * (ray ? 18 : 60) + z.id), w = Math.max(4, Math.round(z.w));
    B.line(z.x, y0, ex, ey, w + 6, ca(HOLY, 0.2 * f));
    B.line(z.x, y0, ex, ey, w, ca(GOLD, 0.6 * f * fl));
    B.line(z.x, y0, ex, ey, Math.max(2, Math.round(w * 0.3)), ca(WHITE, 0.95 * f));
    B.circ(ex, ey, Math.round(w * 0.6 + 2 * Math.sin(t * 30 + z.id)), ca(WHITE, 0.7 * f), 0);
    B.circ(ex, ey, w, ca(GOLD, 0.6 * f), 1);
    B.circ(z.x, y0, Math.round(w * 0.6), ca(WHITE, 0.6 * f), 0);
  }

  const zone = (B, z, t) => {
    switch (z.k) {
      case 'smite': pillar(B, z, t, false); return true;
      case 'wrath': pillar(B, z, t, true); return true;
      case 'pglow': glow(B, z, t); return true;
      case 'hallow': ground(B, z, t, true); return true;
      case 'sanct': sanct(B, z, t); return true;
      case 'aura': aura(B, z, t, false); return true;
      case 'halo': aura(B, z, t, true); return true;
      case 'beam': case 'ray': return true; // drawn in the top pass
      default: return false;
    }
  };
  const top = (B, z, t) => {
    switch (z.k) {
      case 'aura': censers(B, z, t, false); return true;
      case 'halo': censers(B, z, t, true); return true;
      case 'beam': beam(B, z, t, false); return true;
      case 'ray': beam(B, z, t, true); return true;
      default: return false;
    }
  };
  const HOOK = { zone, top };
  for (const id of ['smite', 'wrath', 'halo', 'jray', 'consecration', 'verdict']) ED.WeaponFx[id] = HOOK;
  ED.SkillFx.sanctuary = HOOK;

  // Cleric 'boom' events (pillar landings) skip fx.js's generic blast, whose 0.6-alpha cream flash disc (up to 90 px) per pillar stacked into white blots over the horde:
  // a gold ring at the true radius, a small core flash, a few sparks. Sanctuary (skill) keeps the generic blast.
  const CW = { smite: 1, wrath: 1, halo: 1, jray: 1, consecration: 1, verdict: 1 };
  const F = ED.FX;
  if (F && F.handle) {
    const handle = F.handle;
    F.handle = (ev, ctx) => {
      if (ev.t !== 'boom' || !CW[ev.wid] || ev.team) return handle(ev, ctx);
      const r = ev.r || 20;
      F.ring(ev.x, ev.y, r, 0xffe08aff, 0.3, r * 0.5, r > 60 ? 2 : 1);
      F.flash(ev.x, ev.y, Math.min(r * 0.3, 20), 0xfff6dc00, 0.1, 0.5);
      F.burst(ev.x, ev.y, Math.min(8, 2 + Math.round(r / 15)), 0xffe08a00, Math.min(r, 100) * 2, 0.4, 2, 10);
    };
  }
})(globalThis.ED || (globalThis.ED = {}));
