// Client draw hooks for heroes knight, ranger, pyro, necro: ED.WeaponFx / ED.SkillFx entries (dispatch on the zone look z.k) and ED.ZoneActor bodies for minions (y-sorted by render.js).
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

  // ---------------- knight ----------------
  const knightZone = (B, z, t) => {
    if (z.k === 'charge') { // speed streaks behind the hero, shield glow ahead
      const c = Math.cos(z.a), s = Math.sin(z.a), k = life(z, 0.05, 0.1);
      kick(z, 3);
      for (let i = -3; i <= 3; i++) {
        const off = i * z.r * 0.28, len = 40 + 30 * H(z.id, i + 9, Math.floor(t * 30)), bx = z.x - s * off - c * 8, by = z.y - 8 + c * off - s * 8;
        B.line(bx, by, bx - c * len, by - s * len, i ? 1 : 2, rgba(0xd8e6ff, (i ? 120 : 200) * k));
      }
      B.cone(z.x + c * 4, z.y - 8 + s * 4, z.r + 6, z.a, 1.6, rgba(0xfff1d6, 70 * k), 0);
      B.cone(z.x + c * 4, z.y - 8 + s * 4, z.r + 6, z.a, 1.6, rgba(0xffffff, 200 * k), 1.5);
      return true;
    }
    if (z.k === 'bulwark') { // golden dome over the hero, pulsing
      const k = life(z, 0.1, 0.4), pulse = 0.5 + 0.5 * Math.sin(t * 10);
      kick(z, 2);
      B.circ(z.x, z.y - 8, z.r, rgba(0xffd77a, (30 + 20 * pulse) * k), 0);
      B.circ(z.x, z.y - 8, z.r + pulse * 2, rgba(0xffe9a8, 210 * k), 2);
      B.spr('fx.shield.gold', A().frameAt('fx.shield.gold', t), z.x, z.y - 8, o(0.8 * k, 1.4, 0, true));
      return true;
    }
    if (z.k === 'shock') return shock(B, z, 0xd8e6ff, 7);
    return false;
  };
  const crescent = (B, pr, t) => { // sword wave: additive slash sprite along its heading plus a bright edge
    B.spr('fx.slash.arc', 2, pr.x, pr.y, o(0.95, 1.3, pr.a, true));
    B.cone(pr.x - Math.cos(pr.a) * 10, pr.y - Math.sin(pr.a) * 10, 16, pr.a, 1.9, 0xfff1d6c0, 1.5);
    return true;
  };
  const shieldProj = (B, pr, t) => { B.spr('proj.shield', 0, pr.x, pr.y, o(1, 1, (t * 18 + pr.id) % TAU)); return true; };
  ED.WeaponFx.cleave = { proj: crescent };
  ED.WeaponFx.whirlwind = { proj: crescent };
  // render.js looks zones up as WeaponFx[wid] || SkillFx[wid] and projectiles as WeaponFx[wid]: skills that also shoot share one entry in both tables.
  ED.SkillFx.charge = ED.WeaponFx.charge = { zone: knightZone, proj: shieldProj };
  ED.SkillFx.bulwark = { zone: knightZone };

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
    if (z.k === 'snare') { // snaps shut (scale 1.3 -> 1), rope web: rings and radial strands, teeth on the rim
      const k = life(z, 0.08, 0.3), snap = z.t < 0.15 ? 1.3 - 2 * z.t : 1, r = z.r * snap, wob = Math.sin(t * 6) * 1.5;
      kick(z, 2);
      B.circ(z.x, z.y, r, rgba(0x6a5a3a, 40 * k), 0);
      B.circ(z.x, z.y, r, rgba(0xe8e0c8, 220 * k), 2);
      B.circ(z.x, z.y, r * 0.62 + wob, rgba(0xe8e0c8, 150 * k), 1);
      B.circ(z.x, z.y, r * 0.3, rgba(0xe8e0c8, 150 * k), 1);
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU + 0.1, c = Math.cos(a), s = Math.sin(a);
        B.line(z.x, z.y, z.x + c * r, z.y + s * r, 1, rgba(0xe8e0c8, 140 * k));
        B.line(z.x + c * r, z.y + s * r, z.x + Math.cos(a + 0.12) * (r - 7), z.y + Math.sin(a + 0.12) * (r - 7), 2, rgba(0xc8c8d0, 220 * k));
      }
      B.spr('proj.web', 0, z.x, z.y, o(0.9 * k, 1.5));
      return true;
    }
    if (z.k === 'shock') return shock(B, z, 0xf0e6d0, 6);
    return false;
  };
  ED.SkillFx.volley = { zone: rangerZone };
  ED.SkillFx.snare = { zone: rangerZone };

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
    if (z.k === 'flamering') { // ring of flames at the current radius with a hot additive band
      if (z.r < 2) return true;
      const k = life(z, 0.05, 0.12), n = U.clamp(Math.round(TAU * z.r / 11), 10, 72);
      kick(z, 4);
      B.circ(z.x, z.y, z.r, rgba(0xff6a1a, 150 * k), 7);
      B.circ(z.x, z.y, z.r, rgba(0xffe0a0, 200 * k), 2);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + z.id;
        B.spr('fx.flame', A().frameAt('fx.flame', t + i * 0.21), z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r + 4, o(k, 1.3, 0, true));
      }
      return true;
    }
    if (z.k === 'scorch') { // burning band at the ring's full radius
      const k = life(z, 0.2, 0.6), n = U.clamp(Math.round(TAU * z.r / (B.zoneLite ? 48 : 16)), B.zoneLite ? 4 : 10, 48);
      B.circ(z.x, z.y, z.r - 10, rgba(0x4a1a08, 110 * k), 18);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + H(z.id, i, 0) * 0.3, d = z.r - 10 + (H(z.id, i, 1) - 0.5) * 16;
        B.spr('fx.flame', A().frameAt('fx.flame', t + i * 0.17), z.x + Math.cos(a) * d, z.y + Math.sin(a) * d + 4, o(k, 0.9, 0, true));
      }
      return true;
    }
    return false;
  };
  ED.WeaponFx.firebolt = { proj: pyroProj, zone: pyroZone };
  ED.WeaponFx.inferno = { proj: pyroProj, zone: pyroZone };
  ED.SkillFx.meteor = ED.WeaponFx.meteor = { zone: pyroZone, proj: pyroProj };
  ED.SkillFx.flamering = { zone: pyroZone };

  // ---------------- necro ----------------
  const boneProj = (B, pr, t) => {
    B.spr('proj.bone', 0, pr.x, pr.y, o(1, 1.2, pr.a));
    if ((pr.id + Math.floor(t * 60)) % 4 === 0 && ED.FX && ED.FX.part) ED.FX.part(pr.x, pr.y, 0, -8, 0.25, 0xb7a6e0ff, 2);
    return true;
  };
  const necroZone = (B, z, t) => {
    if (z.k === 'minion' || z.k === 'boneknight') { // ground layer: ally ring under the feet (the body is a ZoneActor)
      const k = life(z, 0.2, 0.5);
      B.circ(z.x, z.y, z.r + 2, rgba(0x8a5ad8, 60 * k), 0);
      B.circ(z.x, z.y, z.r + 2, rgba(0xc8a6ff, 170 * k), 1);
      return true;
    }
    if (z.k === 'raise') { // ground erupts: purple ring and bone spikes thrusting up
      const k = U.clamp(z.t / z.dur, 0, 1), up = Math.sin(Math.min(1, k * 2.5) * PI / 2) * (1 - k);
      kick(z, 5);
      B.circ(z.x, z.y, z.r, rgba(0x6a3aa8, 70 * (1 - k)), 0);
      B.circ(z.x, z.y, z.r * (0.6 + 0.4 * U.easeOut(k)), rgba(0xc8a6ff, 230 * (1 - k)), 3);
      const n = U.clamp(Math.round(z.r / 5), 8, 28);
      for (let i = 0; i < n; i++) {
        const a = H(z.id, i, 0) * TAU, d = Math.sqrt(H(z.id, i, 1)) * z.r;
        B.spr('proj.bone', 0, z.x + Math.cos(a) * d, z.y + Math.sin(a) * d - 8 * up, o(1 - k, 1.6 * up + 0.2, -PI / 2 + (H(z.id, i, 2) - 0.5) * 0.6));
      }
      return true;
    }
    if (z.k === 'corpse') { // purple detonation with a skull flash
      const k = U.clamp(z.t / z.dur, 0, 1);
      kick(z, 2.5);
      B.circ(z.x, z.y, z.r * (0.4 + 0.6 * U.easeOut(k)), rgba(0x8a5ad8, 120 * (1 - k)), 0);
      B.circ(z.x, z.y, z.r * (0.4 + 0.6 * U.easeOut(k)), rgba(0xe0c8ff, 230 * (1 - k)), 2);
      B.spr('fx.blast.blue', at('fx.blast.blue', k), z.x, z.y - 4, o(1 - k * 0.5, U.clamp(z.r / 18, 1, 2.5), 0, true));
      if (k < 0.4) B.spr('fx.sigil.skull', 0, z.x, z.y - 12 - k * 20, o(1 - k * 2, 2.5));
      return true;
    }
    return false;
  };
  // Minion body (y-sorted actor): rises out of the ground, walks toward its facing, flashes a slash while z.w > 0, fades before it crumbles.
  const minionBody = (B, z, t) => {
    const big = z.k === 'boneknight', id = big ? 'foe.skelknight.walk' : 'foe.minion.walk', rise = Math.min(1, z.t / 0.3), fade = Math.min(1, (z.dur - z.t) / 0.5);
    const flip = Math.cos(z.a) < 0, hy = z.y - (big ? 14 : 8);
    B.circ(z.x, hy, z.r + 3, rgba(0x7a4ad0, 120 * fade * rise), 0); // purple halo behind the bones marks an ally
    O.flip = flip; O.flash = 0; O.alpha = 0.95 * fade; O.rot = 0; O.sx = 1; O.sy = rise; O.tint = 0x9a7aff; O.add = false;
    if (!B.spr(id, A().frameAt(id, t + z.id * 0.31), z.x, z.y, O)) B.circ(z.x, z.y - z.r, z.r, rgba(0xd8d0f0, 255 * fade), 0);
    // ghost glow over the bones so allies read apart from skeleton foes
    O.alpha = 0.35 * fade; O.add = true;
    B.spr(id, A().frameAt(id, t + z.id * 0.31), z.x, z.y, O);
    if (rise < 1 && Math.random() < 0.5) spark(z.x, z.y, 0x9a8a70ff, 1, 30);
    if (z.w > 0) B.cone(z.x, z.y - 6, z.r + (big ? 26 : 14), z.a, big ? 3.2 : 2.2, rgba(0xe0c8ff, 150 * z.w), 0);
  };
  ED.WeaponFx.boneshard = { proj: boneProj, zone: necroZone };
  ED.WeaponFx.bonestorm = { proj: boneProj, zone: necroZone };
  ED.SkillFx.raise = { zone: necroZone };
  ED.SkillFx.corpseblast = ED.WeaponFx.corpseblast = { zone: necroZone, proj: boneProj };
  const ZA = ED.ZoneActor = ED.ZoneActor || {};
  ZA.minion = minionBody; ZA.boneknight = minionBody;
})(globalThis.ED || (globalThis.ED = {}));
