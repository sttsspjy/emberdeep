// Necro visuals (ED.WeaponFx / ED.SkillFx / ED.ZoneActor hooks; loaded after hfx-b.js): bone shards and splinters, blight globs, minion ground rings and bodies
// (skeleton, Bone Knight, archer, ghoul; y-sorted by render.js), Bone Knight slams, blight / plague pools, Corpse Blast detonations.
// Everything derives from render-visible fields (zones: x, y, r, a, w, t, dur, k, id; projectiles: x, y, a, k, id) and view time; pixel art only (atlas sprites, thin rings).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const o = (alpha, sc, rot, add, flip, tint) => { O.flip = !!flip; O.flash = 0; O.alpha = alpha; O.rot = rot || 0; O.sx = O.sy = sc || 1; O.tint = tint || 0; O.add = !!add; return O; };
  const A = () => ED.Atlas;
  const nf = (id) => { const r = A().anim(id); return r ? r.n : 1; };
  const at = (id, k) => Math.max(0, Math.min(nf(id) - 1, Math.floor(k * nf(id))));
  const rgba = (rgb, a) => (((rgb & 0xffffff) << 8) | (U.clamp(Math.round(a), 0, 255))) >>> 0;
  const life = (z, fin, fout) => Math.max(0, Math.min(1, z.t / (fin || 0.12), (z.dur - z.t) / (fout || 0.3)));
  const hr = (i, s) => U.hash3(i | 0, Math.floor(s * 1000) | 0, 7) / 4294967296;
  // Shake once per zone id, the first frame it is drawn (young zones only).
  const seen = new Int32Array(128); let seenI = 0;
  const kick = (z, v) => {
    if (z.t > 0.25) return;
    for (let i = 0; i < seen.length; i++) if (seen[i] === z.id) return;
    seen[seenI = (seenI + 1) & 127] = z.id;
    if (ED.FX && ED.FX.addShake) ED.FX.addShake(v, ED.Render ? ED.Render.crowd : 0);
  };
  const spark = (x, y, col, n, sp) => { if (ED.FX && ED.FX.part) for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = (sp || 40) * (0.3 + Math.random()); ED.FX.part(x, y, Math.cos(a) * s, Math.sin(a) * s - 20, 0.3 + Math.random() * 0.3, col, 2); } };

  // ---------------- projectiles ----------------
  // Bone shard (splinters: half size); blight glob: green-tinted skull with a dripping trail.
  const boneProj = (B, pr, t) => {
    if (pr.k === 'glob') {
      B.spr('proj.skull', 0, pr.x, pr.y, o(1, 1, 0, false, false, 0x7fe34a));
      if ((pr.id + Math.floor(t * 60)) % 3 === 0 && ED.FX && ED.FX.part) ED.FX.part(pr.x, pr.y, 0, 10, 0.3, 0x7fe34aff, 2);
      return true;
    }
    B.spr('proj.bone', 0, pr.x, pr.y, o(1, pr.r < 4 ? 0.7 : 1.2, pr.a));
    if ((pr.id + Math.floor(t * 60)) % 4 === 0 && ED.FX && ED.FX.part) ED.FX.part(pr.x, pr.y, 0, -8, 0.25, 0xb7a6e0ff, 2);
    return true;
  };

  // ---------------- zones (ground pass) ----------------
  // Blight / plague pool: wobbling disc, off-centre inner pool, 1 px rim, popping bubbles; plague adds a violet core and rising spores. B.zoneLite: disc + rim only.
  function pool(B, z, t, plague) {
    const g = U.easeOut(Math.min(1, z.t / 0.18)), f = z.dur > 0 ? z.t / z.dur : 0, fade = f > 0.8 ? Math.max(0, (1 - f) / 0.2) : 1;
    const ph = z.id * 0.618, r = z.r * (0.4 + 0.6 * g) * (1 + 0.03 * Math.sin(t * 3 + ph * 6));
    if (B.zoneLite) { B.zcirc(z.x, z.y, r, rgba(plague ? 0x5a6a30 : 0x4a8a30, 110 * fade), 0); B.zcirc(z.x, z.y, r, rgba(plague ? 0xc8ff4a : 0xa8ff6a, 160 * fade), 1); return true; }
    B.circ(z.x, z.y, r, rgba(plague ? 0x4f7a1e : 0x3f8f2a, 95 * fade), 0);
    B.circ(z.x + Math.cos(ph * 7) * r * 0.15, z.y + Math.sin(ph * 7) * r * 0.12, r * 0.62, rgba(plague ? 0x8a4fc0 : 0x7fd34a, 75 * fade), 0);
    B.circ(z.x, z.y, r, rgba(plague ? 0xc8ff4a : 0xa8ff6a, 160 * fade), 1);
    const nb = plague ? 6 : 4;
    for (let i = 0; i < nb; i++) {
      const v = t * 0.9 + hr(i, ph), cyc = Math.floor(v), q = v - cyc, a = hr(i * 13 + cyc, ph) * TAU, d = r * 0.75 * Math.sqrt(hr(i * 7 + cyc, ph + 1));
      const bx = Math.round(z.x + Math.cos(a) * d), by = Math.round(z.y + Math.sin(a) * d);
      B.rect(bx, by - Math.round(q * 3), 1 + Math.round(q * 2), 1 + Math.round(q * 2), rgba(0xd8ffa0, (1 - q) * 220 * fade));
      if (plague && i < 3) B.rect(bx, by - Math.round(q * 16), 1, 1, rgba(0xd8a8ff, (1 - q) * 255 * fade));
    }
    return true;
  }
  const necroZone = (B, z, t) => {
    const k = z.k;
    if (k === 'minion' || k === 'boneknight' || k === 'bonearcher' || k === 'ghoul') { // ground layer: ally ring under the feet (the body is a ZoneActor)
      const a = life(z, 0.2, 0.5), col = k === 'ghoul' ? 0x6ad84a : 0x8a5ad8;
      B.circ(z.x, z.y, z.r + 2, rgba(col, 60 * a), 0);
      B.circ(z.x, z.y, z.r + 2, rgba(k === 'ghoul' ? 0xb8ff8a : 0xc8a6ff, 170 * a), 1);
      return true;
    }
    if (k === 'blight') return pool(B, z, t, false);
    if (k === 'plague') return pool(B, z, t, true);
    if (k === 'boneslam') { // Bone Knight slam: expanding pale ring, dust ring sprite, stun stars
      const q = U.clamp(z.t / z.dur, 0, 1);
      kick(z, 1.5);
      B.circ(z.x, z.y, z.r * (0.3 + 0.7 * U.easeOut(q)), rgba(0xe8dcc8, 200 * (1 - q)), 1);
      B.spr('fx.smoke.ring', at('fx.smoke.ring', q), z.x, z.y, o(0.8 * (1 - q), U.clamp(z.r / 24, 1, 3)));
      return true;
    }
    if (k === 'corpse') { // purple detonation with a skull flash
      const q = U.clamp(z.t / z.dur, 0, 1);
      kick(z, 2.5);
      B.circ(z.x, z.y, z.r * (0.4 + 0.6 * U.easeOut(q)), rgba(0x8a5ad8, 120 * (1 - q)), 0);
      B.circ(z.x, z.y, z.r * (0.4 + 0.6 * U.easeOut(q)), rgba(0xe0c8ff, 230 * (1 - q)), 1);
      B.spr('fx.blast.blue', at('fx.blast.blue', q), z.x, z.y - 4, o(1 - q * 0.5, U.clamp(z.r / 18, 1, 2.5), 0, true));
      if (q < 0.4) B.spr('fx.sigil.skull', 0, z.x, z.y - 12 - q * 20, o(1 - q * 2, 2));
      return true;
    }
    return false;
  };

  // ---------------- minion bodies (y-sorted actors) ----------------
  // Rises out of the ground, walks toward its facing, flashes its strike while z.w > 0, fades before it crumbles. Allies wear a halo and a ghost glow (violet; ghouls green).
  const BODY = { minion: 'foe.minion.walk', boneknight: 'foe.skelknight.walk', bonearcher: 'foe.bonearcher.walk', ghoul: 'foe.drowned.walk' };
  const minionBody = (B, z, t) => {
    const k = z.k, id = BODY[k], big = k === 'boneknight', ghoul = k === 'ghoul', rise = Math.min(1, z.t / 0.3), fade = Math.min(1, (z.dur - z.t) / 0.5);
    const flip = Math.cos(z.a) < 0, hy = z.y - (big ? 14 : 8), tint = ghoul ? 0x8aff6a : 0x9a7aff, f = A().frameAt(id, t + z.id * 0.31);
    B.circ(z.x, hy, z.r + 3, rgba(ghoul ? 0x4aa83a : 0x7a4ad0, 120 * fade * rise), 0);
    O.flip = flip; O.flash = 0; O.alpha = 0.95 * fade; O.rot = 0; O.sx = 1; O.sy = rise; O.tint = tint; O.add = false;
    if (!B.spr(id, f, z.x, z.y, O)) B.circ(z.x, z.y - z.r, z.r, rgba(0xd8d0f0, 255 * fade), 0);
    O.alpha = 0.35 * fade; O.add = true;
    B.spr(id, f, z.x, z.y, O);
    if (rise < 1 && Math.random() < 0.5) spark(z.x, z.y, 0x9a8a70ff, 1, 30);
    if (ghoul && Math.random() < 0.08) spark(z.x, z.y - 6, 0x7fe34aff, 1, 12);
    if (z.w > 0) {
      if (k === 'bonearcher') B.line(z.x, z.y - 6, z.x + Math.cos(z.a) * 8, z.y - 6 + Math.sin(z.a) * 8, 1, rgba(0xe0c8ff, 220 * z.w));
      else B.cone(z.x, z.y - 6, z.r + (big ? 24 : 18), z.a, big ? 3.0 : 2.8, rgba(0xe0c8ff, 120 * z.w), 1);
    }
  };

  for (const id of ['boneshard', 'bonestorm', 'bonelord', 'plaguefield', 'lich', 'ossuary']) ED.WeaponFx[id] = { proj: boneProj, zone: necroZone };
  ED.SkillFx.corpseblast = ED.WeaponFx.corpseblast = { zone: necroZone, proj: boneProj };
  const ZA = ED.ZoneActor = ED.ZoneActor || {};
  ZA.minion = ZA.boneknight = ZA.bonearcher = ZA.ghoul = minionBody;
})(globalThis.ED || (globalThis.ED = {}));
