// Ranger visuals: Longbow and its Forms (ED.WeaponFx: arrow / bolt sprites at whole-number scales, thin streaks) and the Volley arrow rain (ED.SkillFx); loaded after fx.js.
// Everything derives from render-visible fields (projectiles: x, y, a, r, id, t; zones: x, y, r, t, dur, k, id) and view time.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0xffffff, add: false };
  const o = (alpha, sc, rot, tint) => { O.flash = 0; O.alpha = alpha; O.rot = rot || 0; O.sx = O.sy = sc || 1; O.tint = tint === undefined ? 0xffffff : tint; return O; };
  const H = (a, b, c) => U.hash3(a, b, c) / 4294967296;
  const rgba = (rgb, a) => (((rgb & 0xffffff) << 8) | (U.clamp(Math.round(a), 0, 255))) >>> 0;
  const life = (z, fin, fout) => Math.max(0, Math.min(1, z.t / (fin || 0.12), (z.dur - z.t) / (fout || 0.3)));
  const seen = new Int32Array(64); let seenI = 0;
  const kick = (z, v) => {
    if (z.t > 0.25) return;
    for (let i = 0; i < seen.length; i++) if (seen[i] === z.id) return;
    seen[seenI = (seenI + 1) & 63] = z.id;
    if (ED.FX && ED.FX.addShake) ED.FX.addShake(v, ED.Render ? ED.Render.crowd : 0);
  };

  // Streak of len px behind projectile pr (1 px line).
  const streak = (B, pr, len, col) => { const c = Math.cos(pr.a), s = Math.sin(pr.a); B.line(pr.x - c * 4, pr.y - s * 4, pr.x - c * (4 + len), pr.y - s * (4 + len), 1, col); };
  // Arrow: scale 1 (splits and plain arrows) or 2 (heavy bolts, radius >= 7) with a pale streak; tint per Form.
  const arrow = (tint, len) => (B, pr) => {
    const big = pr.r >= 7;
    if (big) streak(B, pr, 14, 0xfff1d6c0); else if (len) streak(B, pr, len, 0xf0e6d070);
    B.spr('proj.arrow', 0, pr.x, pr.y, o(1, big ? 2 : 1, pr.a, tint));
    return true;
  };
  ED.WeaponFx.longbow = { proj: arrow(0xffffff, 0) };
  ED.WeaponFx.hail = { proj: arrow(0xffffff, 0) };
  ED.WeaponFx.galeshot = { proj: arrow(0xe8f4ff, 10) };
  ED.WeaponFx.rebound = { proj: arrow(0xffe8a0, 6) };
  // Seeker: green-tinted arrow with a 2-dot trail along its heading.
  ED.WeaponFx.seeker = { proj: (B, pr) => {
    const c = Math.cos(pr.a), s = Math.sin(pr.a);
    B.circ(pr.x - c * 7, pr.y - s * 7, 1, 0x9fd38ac0, 0); B.circ(pr.x - c * 11, pr.y - s * 11, 0.5, 0x9fd38a80, 0);
    B.spr('proj.arrow', 0, pr.x, pr.y, o(1, 1, pr.a, 0xc8f0b0));
    return true;
  } };
  // Ballista: the bolt sprite at x2 (x3 for heavy bolts, radius >= 16) with a double dust wake; small Longbow arrows (its shards) as plain arrows.
  ED.WeaponFx.ballista = { proj: (B, pr) => {
    if (pr.r < 7) { B.spr('proj.arrow', 0, pr.x, pr.y, o(1, 1, pr.a)); return true; }
    const sc = pr.r >= 16 ? 3 : 2, c = Math.cos(pr.a), s = Math.sin(pr.a), w = pr.r * 0.6;
    for (let i = -1; i <= 1; i += 2) B.line(pr.x - c * 8 - s * w * i, pr.y - s * 8 + c * w * i, pr.x - c * 30 - s * w * i * 0.5, pr.y - s * 30 + c * w * i * 0.5, 1, 0xe8dcc090);
    streak(B, pr, 24, 0xfff1d6e0);
    B.spr('proj.bolt', 0, pr.x, pr.y, o(1, sc, pr.a));
    return true;
  } };

  // Volley: thin rim, arrows dropping in 0.35 s cycles at hashed spots (count by area), dust rings where they land.
  const rain = (B, z, t) => {
    if (z.k !== 'arrows') return false;
    const k = life(z, 0.1, 0.25), n = U.clamp(Math.round(z.r * z.r / 200), 10, 48);
    kick(z, 2);
    B.circ(z.x, z.y, z.r, rgba(0xd8d0c0, 22 * k), 0);
    B.circ(z.x, z.y, z.r, rgba(0xf0e6d0, 110 * k), 1);
    for (let i = 0; i < n; i++) {
      const ph = H(z.id, i, 0), c = t / 0.35 + ph, cyc = Math.floor(c), f = c - cyc;
      const a = H(z.id, i, cyc) * TAU, d = Math.sqrt(H(z.id, i + 77, cyc)) * z.r, x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d;
      if (f < 0.8) B.spr('proj.arrow', 0, x + (1 - f) * 10, y - (1 - f / 0.8) * 70, o(k, 1, PI / 2 - 0.15));
      else B.circ(x, y, 2 + (f - 0.8) * 20, rgba(0xe8dcc0, 160 * k * (1 - f) * 5), 1);
    }
    return true;
  };
  ED.SkillFx.volley = { zone: rain };
})(globalThis.ED || (globalThis.ED = {}));
