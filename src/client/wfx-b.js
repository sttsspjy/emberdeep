// Support weapon visuals (b): ED.WeaponFx entries for src/weapons/support-b.js = { proj(B, pr, t), zone(B, z, t) (ground layer), top(B, z, t) (above actors) }, dispatched on the look k.
// Reads only render-visible fields (projectile: id, k, x, y, a, r, t; zone: id, k, x, y, r, a, len, t, dur). Allocation free: one shared sprite option object, a fixed point buffer.
// B.zoneLite (2D zone LOD): fill + rim through B.zcirc, a third of the bolt segments, no second passes.
(function (ED) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0xffffff, add: false };
  const so = (alpha, rot, sc, tint, add) => { O.alpha = alpha === undefined ? 1 : alpha; O.rot = rot || 0; O.sx = O.sy = sc || 1; O.tint = tint === undefined ? 0xffffff : tint; O.add = !!add; return O; };
  const ca = (rgb, a) => (((rgb << 8) | (Math.max(0, Math.min(255, a | 0)))) >>> 0); // 0xRRGGBB + alpha 0..255 -> 0xRRGGBBAA
  const hs = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const frame = (id, t) => ED.Atlas.frameAt(id, t);
  const fade = (z, tail) => Math.max(0, Math.min(1, (z.dur - z.t) / tail));
  const grow = (z, t0) => Math.min(1, z.t / t0);

  // Jagged bolt from (x0, y0) to (x1, y1): segs pieces, sideways jitter amp re-rolled 20 times a second; glow polyline then a white core polyline.
  const PTS = new Float32Array(64);
  const bolt = (B, x0, y0, x1, y1, seed, segs, amp, lw, glow, core, alpha) => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    segs = Math.min(30, B.zoneLite ? Math.max(2, Math.ceil(segs / 3)) : segs);
    for (let i = 0; i <= segs; i++) {
      const f = i / segs, off = i === 0 || i === segs ? 0 : (hs(seed + i * 7.31) - 0.5) * 2 * amp * Math.sin(f * PI);
      PTS[i * 2] = x0 + dx * f + nx * off; PTS[i * 2 + 1] = y0 + dy * f + ny * off;
    }
    B.poly(PTS, segs + 1, lw, ca(glow, 170 * alpha));
    B.poly(PTS, segs + 1, Math.max(2, Math.round(lw * 0.4)), ca(core, 255 * alpha));
  };
  // Spinning blade disc of radius r at angle rot: dark hub, rim, three hooked blades.
  const disc = (B, x, y, r, rot, dark, mid, hi) => {
    B.circ(x, y, r * 0.55, ca(dark, 255), 0);
    B.circ(x, y, r * 0.55, ca(mid, 255), 1);
    for (let i = 0; i < 3; i++) {
      const a = rot + i * TAU / 3, mx = x + Math.cos(a) * r * 0.75, my = y + Math.sin(a) * r * 0.75, b = a + 0.9;
      B.line(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, mx, my, 3, ca(mid, 255));
      B.line(mx, my, x + Math.cos(b) * r, y + Math.sin(b) * r, 2, ca(hi, 255));
    }
    B.rect(x - 1, y - 1, 2, 2, ca(hi, 255));
  };
  // Spinning axe sprite (pivot at the grip) drawn so its centre sits on the projectile: scale 2 from radius 9; a pale swish arc behind the spin.
  const axe = (B, pr, t, id, tint, swish) => {
    const sc = pr.r >= 9 ? 2 : 1, rot = (t * 15 + pr.id * 0.7) % TAU, off = 5 * sc;
    B.cone(pr.x, pr.y, 7 * sc, rot - PI / 2 - 0.9, 1.4, ca(swish, 70), 2);
    if (!B.spr(id, 0, pr.x - Math.sin(rot) * off, pr.y + Math.cos(rot) * off, so(1, rot, sc, tint))) B.circ(pr.x, pr.y, pr.r, ca(tint, 255), 0);
  };

  // ---------------- projectiles ----------------
  const PROJ = {
    axe(B, pr, t) { axe(B, pr, t, 'weapon.alt.throwing_axe', 0xffffff, 0xe8ecf2); },
    // Avalanche axe: the double axe in a frosty tint with a snow trail.
    avaxe(B, pr, t) {
      const bx = Math.cos(pr.a), by = Math.sin(pr.a);
      for (let i = 1; i <= 3; i++) B.rect(pr.x - bx * i * 6 - 1, pr.y - by * i * 6 - 1, 2, 2, ca(0xe8f4ff, 200 - i * 50));
      axe(B, pr, t, 'weapon.alt.double_axe', 0xd8e8ff, 0xc8e6ff);
    },
    axebit(B, pr, t) { axe(B, pr, t, 'weapon.alt.throwing_axe', 0xc8dcff, 0xc8e6ff); },
    // Glaive: a spinning three-bladed steel disc inside a motion-blur halo.
    glaive(B, pr, t) {
      const r = Math.max(8, pr.r);
      B.circ(pr.x, pr.y, r + 3, ca(0xd9dfe8, 34), 0);
      disc(B, pr.x, pr.y, r, t * 24 + pr.id, 0x7a8494, 0xd9dfe8, 0xffffff);
    },
    // Moon glaive: moonlit halo, fading afterimages along its path, a pale spinning disc with a crescent rim.
    moon(B, pr, t) {
      const bx = Math.cos(pr.a), by = Math.sin(pr.a), rot = t * 28 + pr.id, r = Math.max(9, pr.r);
      B.circ(pr.x, pr.y, r + 7, ca(0x9fc4ff, 34), 0);
      for (let i = 3; i >= 1; i--) B.circ(pr.x - bx * i * 7, pr.y - by * i * 7, r * (1 - i * 0.22), ca(0xc9dcff, 100 - i * 25), 0);
      disc(B, pr.x, pr.y, r, rot, 0x3a5a9a, 0xc9dcff, 0xffffff);
      B.cone(pr.x, pr.y, r + 3, rot * 0.25, 2.4, ca(0xe8f0ff, 200), 2);
    },
  };

  // ---------------- zones: ground layer ----------------
  // Thorn patch: dark ground stain, spikes erupting (first 0.14 s) then withering (last 0.4 s).
  const thorns = (B, z, t, stain, body, tip, n, sc) => {
    const g = grow(z, 0.14), k = fade(z, 0.4), r = z.r;
    if (B.zoneLite) { B.zcirc(z.x, z.y, r, ca(stain, 90 * k), 0); B.zcirc(z.x, z.y, r, ca(tip, 70 * k), 1); return; }
    B.circ(z.x, z.y, r, ca(stain, 80 * k), 0);
    for (let i = 0; i < n; i++) {
      const a = hs(z.id * 1.7 + i) * TAU, d = r * 0.75 * hs(z.id * 2.3 + i * 3.1), x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d * 0.6;
      const h = (7 + 7 * hs(z.id + i * 5.3)) * sc * g * (0.4 + 0.6 * k), lean = (hs(z.id + i * 9.1) - 0.5) * 6 * sc;
      B.line(x - 1, y, x + lean * 0.6, y - h * 0.65, 3, ca(body, 255 * k));
      B.line(x + lean * 0.6, y - h * 0.65, x + lean, y - h, 1, ca(tip, 255 * k));
    }
    if (n > 4 && g >= 1) B.spr('proj.thorn', frame('proj.thorn', t + z.id * 0.1), z.x, z.y - 4, so(0.85 * k, -PI / 2, 1));
  };
  const ZONE = {
    bramble(B, z, t) { thorns(B, z, t, 0x14300c, 0x3f7a18, 0x9be33c, 4, 1); },
    thicket(B, z, t) { thorns(B, z, t, 0x2a0c1c, 0x5a2f40, 0xd2ff82, 6, 1.25); if (!B.zoneLite) B.circ(z.x, z.y, z.r, ca(0x9be33c, 60 * fade(z, 0.5)), 1); },
    // Sky strike ground: a dark scorch shrinking as it fades.
    sbolt(B, z) { const k = fade(z, z.dur); (B.zoneLite ? B.zcirc : B.circ)(z.x, z.y, z.r * (1.2 - 0.4 * k), ca(0x2a3c80, 90 * k), 0); },
  };

  // ---------------- zones: overlays above actors ----------------
  // Thorn eruption: green splinters flying out during the first 0.18 s.
  const splinters = (B, z, col, n) => {
    if (z.t > 0.18) return;
    const k = z.t / 0.18;
    for (let i = 0; i < n; i++) { const a = -PI / 2 + (hs(z.id + i * 4.7) - 0.5) * 2.4, d = 4 + 16 * k; B.rect(z.x + Math.cos(a) * d - 1, z.y - 6 + Math.sin(a) * d - 1, 2, 2, ca(col, 255 * (1 - k))); }
  };
  const TOP = {
    bramble(B, z) { if (!B.zoneLite) splinters(B, z, 0x9be33c, 4); },
    thicket(B, z) { if (!B.zoneLite) splinters(B, z, 0xd2ff82, 6); },
    // Chain hop: a jagged bolt with a glow pass, flickering, plus a spark at the struck end.
    spark(B, z, t) {
      const k = fade(z, z.dur), ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len, seed = z.id * 13 + Math.floor(t * 20);
      const segs = Math.max(2, Math.round(z.len / 9));
      bolt(B, z.x, z.y, ex, ey, seed, segs, Math.min(10, z.len * 0.18), 6, 0x6ab8ff, 0xffffff, k);
      if (k > 0.5 && !B.zoneLite) bolt(B, z.x, z.y, ex, ey, seed + 91, segs, Math.min(7, z.len * 0.12), 2, 0xc8e6ff, 0xe8f4ff, k * 0.6);
      B.circ(ex, ey, 4 + 3 * k, ca(0xc8e6ff, 160 * k), 0);
    },
    // Sky strike: a thick bolt from above the screen into the foe, a thunder flash, a white ground ring.
    sbolt(B, z, t) {
      const k = fade(z, z.dur), seed = z.id * 7 + Math.floor(t * 24);
      bolt(B, z.x + 18, z.y - 190, z.x, z.y - 6, seed, 14, 12, 10, 0x5a7aff, 0xffffff, k);
      if (!B.zoneLite) bolt(B, z.x + 18, z.y - 190, z.x, z.y - 6, seed + 33, 10, 16, 3, 0xa0c0ff, 0xe8f0ff, k * 0.5);
      B.spr('fx.thunder', Math.min(7, Math.floor((1 - k) * 8)), z.x, z.y - 8, so(k, 0, 2, 0xffffff, true));
      B.circ(z.x, z.y, z.r * (0.5 + 0.5 * (1 - k)), ca(0xe8f0ff, 180 * k), 2);
    },
    // Storm Crown: five crackling sparks circling above the hero's head, arcs flicking between them.
    scrown(B, z, t) {
      const cx = z.x, cy = z.y - 34;
      B.circ(cx, cy - 3, 16, ca(0xffe66b, 50), 0);
      for (let i = 0; i < 5; i++) {
        const a = i * TAU / 5 + t * 2.4, x = cx + Math.cos(a) * 13, y = cy + Math.sin(a) * 5;
        B.line(x, y, x, y - 7, 3, ca(0xffe66b, 240));
        B.rect(x - 1, y - 10, 3, 3, 0xffffffff);
        if (hs(Math.floor(t * 12) + i) > 0.6) { const b = a + TAU / 5; bolt(B, x, y - 5, cx + Math.cos(b) * 13, cy + Math.sin(b) * 5 - 5, Math.floor(t * 30) + i, 3, 3, 3, 0x6ab8ff, 0xffffff, 0.9); }
      }
    },
  };

  // ---------------- registration ----------------
  const fx = {
    proj(B, pr, t) { const f = PROJ[pr.k]; if (!f) return false; f(B, pr, t); return true; },
    zone(B, z, t) { const f = ZONE[z.k]; if (f) f(B, z, t); return f !== undefined || TOP[z.k] !== undefined; },
    top(B, z, t) { const f = TOP[z.k]; if (f) f(B, z, t); },
  };
  for (const id of ['waraxe', 'avalanche', 'bramble', 'thornwood', 'glaive', 'twinmoons', 'chainspark', 'stormcrown']) ED.WeaponFx[id] = fx;
})(globalThis.ED || (globalThis.ED = {}));
