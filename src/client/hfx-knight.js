// Knight visuals (pixel only: atlas sprites + Batch primitives): crescents, gale crescents and spiral blades (projectiles), crack / cut / shock / charge zones,
// a blade glint orbiting a knight holding a spin Form (HeroFx). Everything derives from render-visible fields and view time; per-zone variation from U.hash3(z.id, i, ...).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const o = (alpha, sc, rot, add, tint) => { O.flip = false; O.flash = 0; O.alpha = alpha; O.rot = rot || 0; O.sx = O.sy = sc || 1; O.tint = tint || 0; O.add = !!add; return O; };
  const H = (a, b, c) => U.hash3(a, b, c) / 4294967296;
  const A = () => ED.Atlas;
  const nf = (id) => { const r = A().anim(id); return r ? r.n : 1; };
  const at = (id, k) => Math.max(0, Math.min(nf(id) - 1, Math.floor(k * nf(id))));
  const rgba = (rgb, a) => (((rgb & 0xffffff) << 8) | (U.clamp(Math.round(a), 0, 255))) >>> 0;
  const life = (z, fin, fout) => Math.max(0, Math.min(1, z.t / (fin || 0.12), (z.dur - z.t) / (fout || 0.3)));
  // Shake once per zone id, the first frame it is drawn (young zones only).
  const seen = new Int32Array(64); let seenI = 0;
  const kick = (z, v) => {
    if (z.t > 0.25) return;
    for (let i = 0; i < seen.length; i++) if (seen[i] === z.id) return;
    seen[seenI = (seenI + 1) & 63] = z.id;
    if (ED.FX && ED.FX.addShake) ED.FX.addShake(v, ED.Render ? ED.Render.crowd : 0);
  };
  const STEEL = 0xd8e6ff, WIND = 0xc8f0e0, EARTH = 0x2a1a10, DUST = 0xc8a878;

  // ---------------- projectiles ----------------
  // Crescent (Cleave waves, Tempest blades): additive slash sprite along the heading, scaled by its radius, plus a 1 px bright edge.
  const crescent = (B, pr) => {
    const sc = U.clamp(pr.r / 9, 0.8, 2.2);
    B.spr('fx.slash.arc', 2, pr.x, pr.y, o(0.95, sc, pr.a, true));
    B.cone(pr.x - Math.cos(pr.a) * 8 * sc, pr.y - Math.sin(pr.a) * 8 * sc, 13 * sc, pr.a, 1.9, rgba(0xfff1d6, 190), 1);
    return true;
  };
  // Gale crescent: a wide pale-green wind blade (two stacked slash frames) with a short pixel trail.
  const galeProj = (B, pr, t) => {
    const sc = U.clamp(pr.r / 9, 1.2, 3), c = Math.cos(pr.a), s = Math.sin(pr.a);
    B.spr('fx.slash.arc', 3, pr.x - c * 6, pr.y - s * 6, o(0.5, sc, pr.a, true, WIND));
    B.spr('fx.slash.arc', 2, pr.x, pr.y, o(1, sc, pr.a, true, WIND));
    B.cone(pr.x - c * 10 * sc, pr.y - s * 10 * sc, 16 * sc, pr.a, 2.1, rgba(0xffffff, 200), 1);
    for (let i = 1; i <= 3; i++) B.rect(Math.round(pr.x - c * i * 9 + ((pr.id + i) % 3 - 1) * 4), Math.round(pr.y - s * i * 9), 2, 1, rgba(WIND, 200 - i * 50));
    return true;
  };
  const shieldProj = (B, pr, t) => { B.spr('proj.shield', 0, pr.x, pr.y, o(1, 1, (t * 18 + pr.id) % TAU)); return true; };
  const knightProj = (B, pr, t) => (pr.k === 'gale' ? galeProj(B, pr, t) : crescent(B, pr));

  // ---------------- zones ----------------
  // Crack: a jagged dark fissure grows along the line until it erupts at dur (dust puffs and rock flecks along it in the last 30%).
  const SEG = 7;
  const crackZone = (B, z, t) => {
    const k = U.clamp(z.t / z.dur, 0, 1), c = Math.cos(z.a), s = Math.sin(z.a), nx = -s, ny = c, L = z.len * Math.min(1, k * 1.6);
    let px = z.x, py = z.y;
    for (let i = 1; i <= SEG; i++) {
      const f = i / SEG; if (f * z.len > L + 1) break;
      const j = i === SEG ? 0 : (H(z.id, i, 1) - 0.5) * 7, qx = z.x + c * f * z.len + nx * j, qy = z.y + s * f * z.len + ny * j;
      B.line(px, py, qx, qy, 3, rgba(EARTH, 210));
      B.line(px, py, qx, qy, 1, rgba(0xff9a4a, 80 + 150 * k));
      px = qx; py = qy;
    }
    if (k > 0.7) {
      const e = (k - 0.7) / 0.3, n = Math.max(2, Math.round(z.len / 34));
      kick(z, 2);
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n, x = z.x + c * f * z.len, y = z.y + s * f * z.len;
        B.spr('fx.puff', at('fx.puff', e), x, y - 2, o(1 - e * 0.5, 1 + z.w / 24));
        B.rect(Math.round(x + (H(z.id, i, 3) - 0.5) * 10), Math.round(y - 4 - e * 14 * H(z.id, i, 4)), 2, 2, rgba(DUST, 255 * (1 - e)));
      }
    }
    return true;
  };
  // Cut: a wind line that grows behind its crescent (260 px/s), thin bright core over a pale band with drifting streaks, fading out over the last 0.4 s.
  const cutZone = (B, z, t) => {
    const k = life(z, 0.05, 0.4), c = Math.cos(z.a), s = Math.sin(z.a), L = Math.min(z.len, 14 + z.t * 260), ex = z.x + c * L, ey = z.y + s * L;
    if (k <= 0) return true;
    B.line(z.x, z.y, ex, ey, Math.max(2, Math.round(z.w * 0.6)), rgba(WIND, 46 * k));
    B.line(z.x, z.y, ex, ey, 1, rgba(0xffffff, 170 * k));
    const n = Math.max(2, Math.round(L / 30));
    for (let i = 0; i < n; i++) {
      const f = ((H(z.id, i, 5) + t * 0.8) % 1), x = z.x + c * f * L, y = z.y + s * f * L, off = (H(z.id, i, 6) - 0.5) * z.w;
      B.line(x - s * off, y + c * off, x - s * off + c * 6, y + c * off + s * 6, 1, rgba(WIND, 200 * k));
    }
    return true;
  };
  // Shock (charge impact / quake): thin expanding ring + shock sprite at the centre.
  const shockZone = (B, z) => {
    const k = U.clamp(z.t / z.dur, 0, 1), r = z.r * (0.25 + 0.75 * U.easeOut(k));
    kick(z, z.r > 80 ? 4 : 2);
    B.circ(z.x, z.y, r, rgba(STEEL, 40 * (1 - k)), 0);
    B.circ(z.x, z.y, r, rgba(STEEL, 230 * (1 - k)), 2);
    if (k < 0.5) B.spr('fx.ring.shock', at('fx.ring.shock', k * 2), z.x, z.y - 6, o(1 - k, z.r > 80 ? 2 : 1, 0, true));
    return true;
  };
  // Charge: speed streaks behind the hero, shield glow ahead.
  const chargeZone = (B, z, t) => {
    const c = Math.cos(z.a), s = Math.sin(z.a), k = life(z, 0.05, 0.1);
    kick(z, 3);
    for (let i = -3; i <= 3; i++) {
      const off = i * z.r * 0.28, len = 40 + 30 * H(z.id, i + 9, Math.floor(t * 30)), bx = z.x - s * off - c * 8, by = z.y - 8 + c * off - s * 8;
      B.line(bx, by, bx - c * len, by - s * len, 1, rgba(STEEL, (i ? 120 : 220) * k));
    }
    B.cone(z.x + c * 4, z.y - 8 + s * 4, z.r + 6, z.a, 1.6, rgba(0xfff1d6, 60 * k), 0);
    B.cone(z.x + c * 4, z.y - 8 + s * 4, z.r + 6, z.a, 1.6, rgba(0xffffff, 210 * k), 1);
    return true;
  };
  const knightZone = (B, z, t) => {
    if (z.k === 'crack') return crackZone(B, z, t);
    if (z.k === 'cut') return cutZone(B, z, t);
    if (z.k === 'shock') return shockZone(B, z, t);
    if (z.k === 'charge') return chargeZone(B, z, t);
    return false;
  };
  for (const id of ['cleave', 'whirlwind', 'colossus', 'gale', 'earthsplitter', 'tempest']) ED.WeaponFx[id] = { proj: knightProj, zone: knightZone };
  // render.js looks zones up as WeaponFx[wid] || SkillFx[wid] and projectiles as WeaponFx[wid]: skills that also shoot share one entry in both tables.
  ED.SkillFx.charge = ED.WeaponFx.charge = { zone: knightZone, proj: shieldProj };

  // ---------------- hero ----------------
  // Spin Forms: two steel glints orbit the knight at its blade's reach (whirlwind fastest), a dust ring for Earthsplitter.
  const SPIN = { whirlwind: 9, earthsplitter: 5, tempest: 7 };
  ED.HeroFx.knight = (B, p, t) => {
    const ws = p.weapons && p.weapons[0], w = ws && SPIN[ws.id];
    if (!w || p.dead || p.downed) return;
    for (let i = 0; i < 2; i++) {
      const a = t * w + i * PI, x = p.x + Math.cos(a) * 20, y = p.y - 8 + Math.sin(a) * 10;
      B.spr('fx.glint', A().frameAt('fx.glint', t + i * 0.2), x, y, o(0.8, 1, 0, true));
    }
    if (ws.id === 'earthsplitter' && p.moving && (Math.floor(t * 20) & 3) === 0) B.rect(Math.round(p.x + Math.cos(t * 7) * 10), Math.round(p.y + 1), 2, 1, rgba(DUST, 160));
  };
})(globalThis.ED || (globalThis.ED = {}));
