// Ranger visuals: Longbow and its Forms (ED.WeaponFx: arrow / bolt sprites at whole-number scales, thin streaks) and the Vault leap (ED.SkillFx); loaded after fx.js.
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

  // ---------------- Q: Vault ----------------
  // vault (follows the hero during the leap, a = heading): a ground shadow, green speed streaks and a dust wake behind; vland: a dust ring bursting out to z.r plus a gold
  // gem-pull ring closing in from 200 px; caltrops: a dim rim and hashed iron spikes (2 px crosses) scattered inside, fading out.
  const LEAF = 0x9fd38a, GOLD = 0xffd27a, DUST = 0xd8c8a8, IRON = 0xb8c0c8;
  const vault = (B, z, t) => {
    const k = life(z, 0.04, 0.08), c = Math.cos(z.a), s = Math.sin(z.a), f = U.clamp(z.t / z.dur, 0, 1), h = Math.sin(PI * f) * 18;
    kick(z, 3);
    B.circ(z.x, z.y + 2, 9 - h * 0.25, rgba(0x000000, 90 * k), 0);
    for (let i = -2; i <= 2; i++) {
      const off = i * 5, len = 26 + 22 * H(z.id, i + 5, Math.floor(t * 30)), bx = z.x - s * off - c * 6, by = z.y - 8 - h + c * off - s * 6;
      B.line(bx, by, bx - c * len, by - s * len, 1, rgba(i ? LEAF : 0xffffff, (i ? 150 : 230) * k));
    }
    for (let i = 1; i <= 3; i++) B.circ(z.x - c * i * 12, z.y - s * i * 12, 3 + i, rgba(DUST, (110 - i * 25) * k), 0);
    return true;
  };
  const vland = (B, z, t) => {
    const k = U.clamp(z.t / z.dur, 0, 1), r = z.r * U.easeOut(k), al = 1 - k;
    kick(z, 3);
    B.circ(z.x, z.y, r, rgba(DUST, 60 * al), 0);
    B.circ(z.x, z.y, r, rgba(0xfff1d6, 220 * al), 2);
    B.circ(z.x, z.y, 200 * (1 - U.easeOut(k)), rgba(GOLD, 200 * al), 1);
    for (let i = 0; i < 10; i++) { const a = (i + H(z.id, i, 1)) / 10 * TAU; B.rect(Math.round(z.x + Math.cos(a) * r), Math.round(z.y + Math.sin(a) * r * 0.8 - 6 * k), 2, 2, rgba(DUST, 230 * al)); }
    return true;
  };
  const caltrops = (B, z, t) => {
    const k = life(z, 0.1, 0.5), n = B.zoneLite ? 10 : U.clamp(Math.round(z.r * z.r / 120), 12, 40);
    B.circ(z.x, z.y, z.r, rgba(IRON, 40 * k), 1);
    for (let i = 0; i < n; i++) {
      const a = H(z.id, i, 2) * TAU, d = Math.sqrt(H(z.id, i, 3)) * z.r * 0.95, x = Math.round(z.x + Math.cos(a) * d), y = Math.round(z.y + Math.sin(a) * d), gl = (Math.floor(t * 4 + i) % 9) === 0;
      B.rect(x - 1, y, 3, 1, rgba(IRON, 220 * k)); B.rect(x, y - 1, 1, 3, rgba(gl ? 0xffffff : IRON, 220 * k));
    }
    return true;
  };
  ED.SkillFx.vault = { zone: (B, z, t) => (z.k === 'vault' ? vault(B, z, t) : z.k === 'vland' ? vland(B, z, t) : z.k === 'caltrops' ? caltrops(B, z, t) : false) };
})(globalThis.ED || (globalThis.ED = {}));
