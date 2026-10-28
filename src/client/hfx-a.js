// Client draw hooks for heroes knight, ranger, pyro: ED.WeaponFx / ED.SkillFx entries (dispatch on the zone look z.k). Necro lives in hfx-necro.js.
// Everything derives from render-visible fields (zones: x, y, r, a, w, t, dur, k, id; projectiles: x, y, a, k, id) and view time; per-zone variation comes from U.hash3(z.id, i, ...).
// The first frame a big effect is seen adds screen shake (seen-id ring).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const o = (alpha, sc, rot, add, flip) => { O.flip = !!flip; O.flash = 0; O.alpha = alpha; O.rot = rot || 0; O.sx = O.sy = sc || 1; O.tint = 0; O.add = !!add; return O; };
  const H = (a, b, c) => U.hash3(a, b, c) / 4294967296;
  const A = () => ED.Atlas;
  const nf = (id) => { const r = A().anim(id); return r ? r.n : 1; };
  // Frame of a one-shot anim at progress k (0..1).
  const at = (id, k) => Math.max(0, Math.min(nf(id) - 1, Math.floor(k * nf(id))));
  const rgba = (rgb, a) => (((rgb & 0xffffff) << 8) | (U.clamp(Math.round(a), 0, 255))) >>> 0;
  const life = (z, fin, fout) => Math.max(0, Math.min(1, z.t / (fin || 0.12), (z.dur - z.t) / (fout || 0.3)));

  // Shake once per zone id, the first frame it is drawn (young zones only).
  const seen = new Int32Array(128); let seenI = 0;
  const kick = (z, v) => {
    if (z.t > 0.25) return;
    for (let i = 0; i < seen.length; i++) if (seen[i] === z.id) return;
    seen[seenI = (seenI + 1) & 127] = z.id;
    if (ED.FX && ED.FX.addShake) ED.FX.addShake(v, ED.Render ? ED.Render.crowd : 0);
  };
  const spark = (x, y, col, n, sp) => { if (ED.FX && ED.FX.part) for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = (sp || 40) * (0.3 + Math.random()); ED.FX.part(x, y, Math.cos(a) * s, Math.sin(a) * s - 20, 0.3 + Math.random() * 0.3, col, 2); } };

  // ---------------- shared zone looks ----------------
  // Fire pool / crater: dark scorch disc, flickering flames scattered inside (count by area), ember sparks; crater opens with an explosion.
  // B.zoneLite (2D zone LOD): batched disc + rim, and the crater impact.
  function firePool(B, z, t, crater) {
    const k = life(z, 0.15, 0.5), r = z.r, lite = B.zoneLite;
    if (r < 1 || k <= 0) return true;
    if (lite) { B.zcirc(z.x, z.y, r, rgba(crater ? 0x5a1a08 : 0x8a2a0c, 110 * k), 0); B.zcirc(z.x, z.y, r, rgba(0xff8a3d, 150 * k), 1); }
    else {
      B.circ(z.x, z.y, r, rgba(crater ? 0x2a0c04 : 0x4a1a08, 120 * k), 0);
      B.circ(z.x, z.y, r * 0.75, rgba(0xff6a1a, 46 * k), 0);
      B.circ(z.x, z.y, r, rgba(0xff8a3d, 150 * k), 1);
    }
    const n = lite ? 0 : U.clamp(Math.round(r * r / 150), 3, crater ? 26 : 18);
    for (let i = 0; i < n; i++) {
      const a = H(z.id, i, 1) * TAU, d = Math.sqrt(H(z.id, i, 2)) * r * 0.85;
      const fx = z.x + Math.cos(a) * d, fy = z.y + Math.sin(a) * d * 0.9 + 4;
      B.spr('fx.flame', A().frameAt('fx.flame', t + i * 0.137), fx, fy, o(k, 0.8 + H(z.id, i, 3) * 0.7, 0, true));
    }
    if (crater && z.t < 0.6) { // impact: a cluster of explosions over the crater (pixel scale kept <= 3)
      kick(z, 6);
      const m = U.clamp(Math.round(r / 14), 3, 9);
      B.circ(z.x, z.y, r * (0.6 + z.t), rgba(0xfff0c0, 200 * (1 - z.t / 0.6)), 3);
      for (let i = 0; i < m; i++) {
        const a = H(z.id, i, 5) * TAU, d = (i ? 0.35 + 0.5 * H(z.id, i, 6) : 0) * r, kk = (z.t - i * 0.03) / 0.5;
        if (kk > 0 && kk < 1) B.spr('fx.explosion', at('fx.explosion', kk), z.x + Math.cos(a) * d, z.y + Math.sin(a) * d - 6, o(1, i ? 2 : 3, 0, true));
      }
    }
    if (!lite && Math.random() < 0.15 * k) spark(z.x + (Math.random() - 0.5) * r, z.y + (Math.random() - 0.5) * r, 0xffb04aff, 1, 30);
    return true;
  }
  // Expanding shockwave: thick fading ring, faint fill, shock sprite at the centre.
  function shock(B, z, col, lw) {
    const k = U.clamp(z.t / z.dur, 0, 1), e = U.easeOut(k), r = z.r * (0.25 + 0.75 * e);
    kick(z, 4);
    B.circ(z.x, z.y, r, rgba(col, 40 * (1 - k)), 0);
    B.circ(z.x, z.y, r, rgba(col, 230 * (1 - k)), Math.max(1, (lw || 6) * (1 - k)));
    B.circ(z.x, z.y, r * 0.8, rgba(0xffffff, 120 * (1 - k)), 1);
    if (k < 0.5) B.spr('fx.ring.shock', at('fx.ring.shock', k * 2), z.x, z.y - 6, o(1 - k, 2, 0, true));
    return true;
  }

  // ---------------- ranger ----------------
  const rangerZone = (B, z, t) => {
    if (z.k === 'arrows') { // arrow rain: arrows drop in 0.35 s cycles at hashed spots, dust where they land
      const k = life(z, 0.1, 0.25), n = U.clamp(Math.round(z.r * z.r / 220), 10, 34);
      kick(z, 2);
      B.circ(z.x, z.y, z.r, rgba(0xd8d0c0, 26 * k), 0);
      B.circ(z.x, z.y, z.r, rgba(0xf0e6d0, 110 * k), 1);
      for (let i = 0; i < n; i++) {
        const ph = H(z.id, i, 0), c = t / 0.35 + ph, cyc = Math.floor(c), f = c - cyc;
        const a = H(z.id, i, cyc) * TAU, d = Math.sqrt(H(z.id, i + 77, cyc)) * z.r, x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d;
        if (f < 0.8) B.spr('proj.arrow', 0, x + (1 - f) * 10, y - (1 - f / 0.8) * 70, o(k, 1, PI / 2 - 0.15));
        else B.circ(x, y, 2 + (f - 0.8) * 20, rgba(0xe8dcc0, 160 * k * (1 - f) * 5), 1);
      }
      return true;
    }
    if (z.k === 'shock') return shock(B, z, 0xf0e6d0, 6);
    return false;
  };
  ED.SkillFx.volley = { zone: rangerZone };

  // ---------------- pyro ----------------
  const fireTrail = (B, pr, t, sc) => {
    B.circ(pr.x, pr.y, 6 * sc, 0xff8a3d40, 0);
    B.spr('proj.fireball', A().frameAt('proj.fireball', t), pr.x, pr.y, o(1, sc, pr.a + PI / 4));
    if ((pr.id + Math.floor(t * 60)) % 3 === 0 && ED.FX && ED.FX.part) ED.FX.part(pr.x - Math.cos(pr.a) * 6, pr.y - Math.sin(pr.a) * 6, -Math.cos(pr.a) * 20, -Math.sin(pr.a) * 20 - 10, 0.3, 0xffb04aff, 2);
    return true;
  };
  const pyroProj = (B, pr, t) => {
    if (pr.k === 'ember') { B.spr('fx.ember', A().frameAt('fx.ember', t + pr.id * 0.1), pr.x, pr.y, o(1, 0.8, 0, true)); return true; }
    return fireTrail(B, pr, t, pr.k === 'fireball' ? 1 : 0.8);
  };
  const pyroZone = (B, z, t) => {
    if (z.k === 'firepool') return firePool(B, z, t, false);
    if (z.k === 'crater') return firePool(B, z, t, true);
    if (z.k === 'meteor') { // falling meteor with a growing target shadow
      const k = U.clamp(z.t / z.dur, 0, 1), fy = (1 - k) * (1 - k) * 220, fx = (1 - k) * 60;
      B.circ(z.x, z.y, z.r, rgba(0xff6a2a, 30 + 60 * k), 0);
      B.circ(z.x, z.y, z.r, rgba(0xffb04a, 200), 1.5);
      B.circ(z.x, z.y, z.r * k, rgba(0x000000, 70), 0);
      B.spr('proj.fireball', A().frameAt('proj.fireball', t), z.x + fx, z.y - 10 - fy, o(1, 2.2 + z.r / 60, PI / 2 + 0.26));
      B.circ(z.x + fx, z.y - 10 - fy, 12 + z.r / 10, 0xff8a3d50, 0);
      if (ED.FX && ED.FX.part && Math.random() < 0.7) ED.FX.part(z.x + fx + (Math.random() - 0.5) * 10, z.y - 10 - fy, (Math.random() - 0.5) * 20, -40, 0.35, 0xffb04aff, 3);
      return true;
    }
    return false;
  };
  ED.WeaponFx.firebolt = { proj: pyroProj, zone: pyroZone };
  ED.WeaponFx.inferno = { proj: pyroProj, zone: pyroZone };
  ED.SkillFx.meteor = ED.WeaponFx.meteor = { zone: pyroZone, proj: pyroProj };
})(globalThis.ED || (globalThis.ED = {}));
