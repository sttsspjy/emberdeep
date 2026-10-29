// Pyro visuals (loaded after fx.js): ED.WeaponFx for firebolt / inferno / firestorm / wildfire / pyre / napalm and the Flashpoint skill.
// Zones dispatch on the look z.k: firepool, pyre (charging fuse), napalm (fire line, z.len / z.w), shell / bomblet (lob from z.a / z.w), flash (Flashpoint).
// Projectiles dispatch on pr.k: fireball, ember, seed. Everything derives from render-visible fields and view time; per-zone variation from U.hash3(z.id, i, ...).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const o = (alpha, sc, rot, add) => { O.flip = false; O.flash = 0; O.alpha = alpha; O.rot = rot || 0; O.sx = O.sy = sc || 1; O.tint = 0; O.add = !!add; return O; };
  const H = (a, b, c) => U.hash3(a, b, c) / 4294967296;
  const A = () => ED.Atlas;
  const rgba = (rgb, a) => (((rgb & 0xffffff) << 8) | (U.clamp(Math.round(a), 0, 255))) >>> 0;
  const life = (z, fin, fout) => Math.max(0, Math.min(1, z.t / (fin || 0.12), (z.dur - z.t) / (fout || 0.3)));
  const part = (x, y, vx, vy, l, col, sz) => { if (ED.FX && ED.FX.part) ED.FX.part(x, y, vx, vy, l, col, sz); };
  // Shake once per zone id, the first frame it is drawn (young zones only).
  const seen = new Int32Array(64); let seenI = 0;
  const kick = (z, v) => {
    if (z.t > 0.25) return;
    for (let i = 0; i < seen.length; i++) if (seen[i] === z.id) return;
    seen[seenI = (seenI + 1) & 63] = z.id;
    if (ED.FX && ED.FX.addShake) ED.FX.addShake(v, ED.Render ? ED.Render.crowd : 0);
  };

  // ---------------- ground fire ----------------
  // Fire pool: scorch disc, hot core, thin rim, flickering flames scattered inside (count by area), rising sparks.
  function firePool(B, z, t) {
    const k = life(z, 0.15, 0.5), r = z.r, lite = B.zoneLite;
    if (r < 1 || k <= 0) return true;
    if (lite) { B.zcirc(z.x, z.y, r, rgba(0x8a2a0c, 110 * k), 0); B.zcirc(z.x, z.y, r, rgba(0xff8a3d, 150 * k), 1); }
    else {
      B.circ(z.x, z.y, r, rgba(0x4a1a08, 120 * k), 0);
      B.circ(z.x, z.y, r * 0.7, rgba(0xff6a1a, 46 * k), 0);
      B.circ(z.x, z.y, r, rgba(0xff8a3d, 150 * k), 1);
    }
    const n = lite ? 0 : U.clamp(Math.round(r * r / 150), 3, 18);
    for (let i = 0; i < n; i++) {
      const a = H(z.id, i, 1) * TAU, d = Math.sqrt(H(z.id, i, 2)) * r * 0.85;
      B.spr('fx.flame', A().frameAt('fx.flame', t + i * 0.137), z.x + Math.cos(a) * d, z.y + Math.sin(a) * d * 0.9 + 4, o(k, 1 + (H(z.id, i, 3) > 0.6 ? 1 : 0), 0, true));
    }
    if (!lite && Math.random() < 0.12 * k) part(z.x + (Math.random() - 0.5) * r, z.y + (Math.random() - 0.5) * r, 0, -30, 0.4, 0xffb04aff, 1);
    return true;
  }
  // Pyre: a fuse that gathers heat over its life: the disc darkens to white-hot, an outer ring closes in, flames multiply and stretch; sparks spiral up near the end.
  function pyre(B, z, t) {
    const k = U.clamp(z.t / z.dur, 0, 1), r = z.r, pulse = 0.5 + 0.5 * Math.sin(t * (10 + 20 * k));
    if (B.zoneLite) { B.zcirc(z.x, z.y, r, rgba(0x8a2a0c, 90 + 80 * k), 0); B.zcirc(z.x, z.y, r * (1.4 - 0.4 * k), rgba(0xffd070, 200), 1); return true; }
    B.circ(z.x, z.y, r, rgba(0x3a1006, 90), 0);
    B.circ(z.x, z.y, r * (0.3 + 0.5 * k), rgba(0xff8a2a, 50 + 70 * k * pulse), 0);
    B.circ(z.x, z.y, r * 0.25 * k, rgba(0xfff0c0, 200 * k), 0);
    B.circ(z.x, z.y, r * (1.4 - 0.4 * k), rgba(0xffd070, 120 + 120 * k), 1);
    const n = U.clamp(Math.round(r / 5 * (0.4 + k)), 3, 14);
    for (let i = 0; i < n; i++) {
      const a = H(z.id, i, 1) * TAU + t * (0.5 + k), d = (0.2 + 0.7 * H(z.id, i, 2)) * r * (1 - 0.4 * k);
      O.flip = false; O.flash = 0; O.alpha = 0.6 + 0.4 * k; O.rot = 0; O.sx = 1; O.sy = 1 + Math.round(k); O.tint = 0; O.add = true;
      B.spr('fx.flame', A().frameAt('fx.flame', t * (1 + k) + i * 0.21), z.x + Math.cos(a) * d, z.y + Math.sin(a) * d * 0.8 + 4, O);
    }
    if (k > 0.6 && Math.random() < 0.6) { const a = Math.random() * TAU; part(z.x + Math.cos(a) * r * 0.6, z.y + Math.sin(a) * r * 0.4, -Math.sin(a) * 30, -50, 0.35, 0xffe08aff, 1); }
    return true;
  }
  // Napalm fire line (z.x, z.y along z.a for z.len, width z.w): scorched strip, a hot core line, flames standing along it, smoke.
  function napalm(B, z, t) {
    const k = life(z, 0.15, 0.5), c = Math.cos(z.a), s = Math.sin(z.a), ex = z.x + c * z.len, ey = z.y + s * z.len;
    if (k <= 0) return true;
    B.line(z.x, z.y, ex, ey, z.w, rgba(0x3a1006, 140 * k));
    B.line(z.x, z.y, ex, ey, Math.max(1, Math.round(z.w * 0.35)), rgba(0xff7a20, 120 * k));
    if (B.zoneLite) return true;
    const n = U.clamp(Math.round(z.len / 9), 3, 24);
    for (let i = 0; i < n; i++) {
      const q = (i + 0.5) / n, off = (H(z.id, i, 1) - 0.5) * z.w * 0.7;
      B.spr('fx.flame', A().frameAt('fx.flame', t + i * 0.173), z.x + c * z.len * q - s * off, z.y + s * z.len * q + c * off + 4, o(k, H(z.id, i, 2) > 0.5 ? 2 : 1, 0, true));
    }
    if (Math.random() < 0.15 * k) { const q = Math.random(); part(z.x + c * z.len * q, z.y + s * z.len * q - 6, 0, -24, 0.6, 0x5a5048a0, 2); }
    return true;
  }
  // Shell / bomblet in flight: landing reticle (rim + closing ring + ticks), ground shadow, a lobbed shell on a parabola from the launch point (z.x + cos z.a * z.w, ...) with a smoke trail.
  const P2 = [0, 0];
  const lobAt = (lx, ly, x, y, h, q) => { P2[0] = lx + (x - lx) * q; P2[1] = ly + (y - ly) * q - 4 * h * q * (1 - q); };
  function lob(B, z, t, big) {
    const k = U.clamp(z.dur > 0 ? z.t / z.dur : 1, 0, 1), lx = z.x + Math.cos(z.a) * z.w, ly = z.y + Math.sin(z.a) * z.w, h = (big ? 0.45 : 0.3) * z.w + (big ? 22 : 10);
    if (big) {
      B.circ(z.x, z.y, z.r, rgba(0xffb040, 10 + 22 * k), 0);
      B.circ(z.x, z.y, z.r, rgba(0xffd070, 110 + 120 * k), 1);
      if (!B.zoneLite) {
        B.circ(z.x, z.y, Math.max(1, z.r * (1 - k)), rgba(0xfff0b0, 180), 1);
        for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + t * 2, cc = Math.cos(a), ss = Math.sin(a); B.line(z.x + cc * z.r * 0.8, z.y + ss * z.r * 0.8, z.x + cc * z.r * 1.1, z.y + ss * z.r * 1.1, 1, rgba(0xffd070, 200)); }
      }
    } else B.circ(z.x, z.y, z.r, rgba(0xffb040, 60 + 100 * k), 1);
    const sz = big ? 3.5 : 2;
    B.circ(lx + (z.x - lx) * k, ly + (z.y - ly) * k, sz, 0x00000050, 0);
    if (!B.zoneLite) for (let j = 1; j <= 3; j++) { const q = k - j * 0.06; if (q <= 0) break; lobAt(lx, ly, z.x, z.y, h, q); B.circ(P2[0], P2[1], sz * (0.5 + j * 0.25), rgba(0xd8d0c8, 110 - j * 30), 0); }
    lobAt(lx, ly, z.x, z.y, h, k);
    B.spr('proj.fireball', A().frameAt('proj.fireball', t), P2[0], P2[1], o(1, 1, Math.atan2(z.y - ly, z.x - lx) + PI / 4));
    B.circ(P2[0], P2[1], sz, 0x2e2a28ff, 0);
    return true;
  }
  // Flashpoint (Q, zone 'flash', r = flash radius): a white-hot disc that dies in 0.15 s, an orange shock front racing out to z.r, 16 rays, flames flung outward; a light screen flash.
  function flash(B, z, t) {
    const k = U.clamp(z.t / z.dur, 0, 1), f = U.easeOut(Math.min(1, z.t / 0.25)), r = Math.max(4, z.r * f), al = 1 - k, core = Math.max(0, 1 - z.t / 0.15);
    kick(z, 6);
    if (z.t < 0.05 && ED.FX && ED.FX.screen) ED.FX.screen(0xffe0b000, 0.3, 0.25);
    if (core > 0) B.circ(z.x, z.y - 6, z.r * 0.6, rgba(0xfff6e0, 200 * core), 0);
    B.circ(z.x, z.y - 6, r, rgba(0xff8a3d, 40 * al), 0);
    B.circ(z.x, z.y - 6, r, rgba(0xffb04a, 240 * al), 3);
    B.circ(z.x, z.y - 6, r + 3, rgba(0xfff0c0, 180 * al), 1);
    for (let i = 0; i < 16; i++) {
      const a = (i + H(z.id, i, 1) * 0.5) / 16 * TAU, r0 = r * (0.35 + 0.2 * H(z.id, i, 2)), r1 = r * (0.8 + 0.3 * H(z.id, i, 3));
      B.line(z.x + Math.cos(a) * r0, z.y - 6 + Math.sin(a) * r0, z.x + Math.cos(a) * r1, z.y - 6 + Math.sin(a) * r1, 1, rgba(0xfff0c0, 220 * al));
    }
    if (!B.zoneLite) for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * TAU + z.id, d = r * 0.9;
      B.spr('fx.flame', A().frameAt('fx.flame', t + i * 0.13), z.x + Math.cos(a) * d, z.y + Math.sin(a) * d * 0.9, o(al, 2, 0, true));
    }
    return true;
  }
  const ZONE = {
    firepool: firePool, pyre, napalm,
    shell: (B, z, t) => lob(B, z, t, true), bomblet: (B, z, t) => lob(B, z, t, false), flash,
  };

  // ---------------- projectiles ----------------
  const fireball = (B, pr, t, sc) => {
    B.spr('proj.fireball', A().frameAt('proj.fireball', t), pr.x, pr.y, o(1, sc, pr.a + PI / 4));
    if ((pr.id + Math.floor(t * 60)) % 3 === 0) part(pr.x - Math.cos(pr.a) * 6, pr.y - Math.sin(pr.a) * 6, -Math.cos(pr.a) * 20, -Math.sin(pr.a) * 20 - 10, 0.3, 0xffb04aff, 1);
    return true;
  };
  const PROJ = {
    fireball: (B, pr, t) => fireball(B, pr, t, 1),
    ember: (B, pr, t) => { B.spr('fx.ember', A().frameAt('fx.ember', t + pr.id * 0.1), pr.x, pr.y, o(1, 1, 0, true)); return true; },
    // Wildfire seed: an ember-wrapped fireball leaving a green-gold spark trail
    seed: (B, pr, t) => {
      B.spr('fx.ember', A().frameAt('fx.ember', t * 1.5 + pr.id * 0.1), pr.x, pr.y, o(1, 2, 0, true));
      B.spr('proj.fireball', A().frameAt('proj.fireball', t), pr.x, pr.y, o(1, 1, pr.a + PI / 4));
      if ((pr.id + Math.floor(t * 60)) % 2 === 0) part(pr.x, pr.y, (Math.random() - 0.5) * 30, -20, 0.35, 0xffe060ff, 1);
      return true;
    },
  };

  const HOOK = {
    proj(B, pr, t) { const f = PROJ[pr.k]; return f ? f(B, pr, t) : false; },
    zone(B, z, t) { const f = ZONE[z.k]; return f ? f(B, z, t) : false; },
  };
  for (const id of ['firebolt', 'inferno', 'firestorm', 'wildfire', 'pyre', 'napalm']) ED.WeaponFx[id] = HOOK;
  ED.SkillFx.flashpoint = HOOK;

  // ---------------- explosions ----------------
  // Pyro 'boom' events skip fx.js's generic blast (explosion sprite up to 4x and a filled flash disc up to 90 px, which buried the horde under stacked blasts):
  // the ring at the true radius, a small core flash, the explosion sprite at whole scale 1, sparks; blasts over 200 px keep a light screen flash.
  const PW = { firebolt: 1, inferno: 1, firestorm: 1, wildfire: 1, pyre: 1, napalm: 1 };
  const F = ED.FX;
  if (F && F.handle) {
    const handle = F.handle;
    F.handle = (ev, ctx) => {
      if (ev.t !== 'boom' || !PW[ev.wid] || ev.team) return handle(ev, ctx);
      const col = 0xff8a3d00, r = ev.r || 20;
      F.ring(ev.x, ev.y, r, (col | 0xff) >>> 0, r > 200 ? 0.5 : 0.3, r * 0.4, r > 60 ? 2 : 1);
      F.flash(ev.x, ev.y, Math.min(r * 0.3, 24), col, 0.1, 0.45);
      if (r >= 24) F.sprite('fx.explosion', ev.x, ev.y, 1, 0, 0, 0.85);
      F.burst(ev.x, ev.y, Math.min(12, 3 + Math.round(r / 12)), col, Math.min(r, 120) * 2.2, 0.45, 2, 10);
      if (r > 200) { F.screen(col, 0.2, 0.25); if (ctx && ev.pid === ctx.me) F.addShake(5, 0); }
    };
  }
})(globalThis.ED || (globalThis.ED = {}));
