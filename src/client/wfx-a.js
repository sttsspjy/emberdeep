// Client draw hooks for general weapons group A (src/weapons/general-a.js): ED.WeaponFx[wid] = { proj(B, pr, t), zone(B, z, t) (ground layer), top(B, z, t) (above actors) }, dispatched on the look k.
// Reads only render-visible fields (projectile: id, k, x, y, a; zone: id, k, x, y, r, a, len, w, t, dur, warn). Allocation free: one shared sprite option object, a fixed point buffer.
(function (ED) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const so = (alpha, rot, sc, add) => { O.alpha = alpha === undefined ? 1 : alpha; O.rot = rot || 0; O.sx = O.sy = sc || 1; O.add = !!add; return O; };
  const ca = (rgb, a) => (((rgb << 8) | (Math.max(0, Math.min(255, a | 0)))) >>> 0); // 0xRRGGBB + alpha 0..255 -> 0xRRGGBBAA
  const hs = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const At = () => ED.Atlas;
  const frame = (id, t) => At().frameAt(id, t);
  const nFrames = (id) => { const r = At().anim(id); return r ? r.n : 1; };
  const fade = (z, tail) => Math.max(0, Math.min(1, (z.dur - z.t) / tail));
  const grow = (z, t0) => Math.min(1, z.t / t0);

  // Jagged bolt from (x0, y0) to (x1, y1): segs pieces, sideways jitter amp, re-rolled 20 times a second; glow pass then a white core.
  const PTS = new Float32Array(64);
  const bolt = (B, x0, y0, x1, y1, seed, segs, amp, lw, glow, core, alpha) => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    segs = Math.min(30, segs);
    for (let i = 0; i <= segs; i++) {
      const f = i / segs, off = i === 0 || i === segs ? 0 : (hs(seed + i * 7.31) - 0.5) * 2 * amp * Math.sin(f * PI);
      PTS[i * 2] = x0 + dx * f + nx * off; PTS[i * 2 + 1] = y0 + dy * f + ny * off;
    }
    for (let i = 0; i < segs; i++) B.line(PTS[i * 2], PTS[i * 2 + 1], PTS[i * 2 + 2], PTS[i * 2 + 3], lw, ca(glow, 110 * alpha));
    for (let i = 0; i < segs; i++) B.line(PTS[i * 2], PTS[i * 2 + 1], PTS[i * 2 + 2], PTS[i * 2 + 3], Math.max(1, lw * 0.35), ca(core, 255 * alpha));
  };

  // Spinning blade disc of radius r at angle rot: dark hub, rim, three hooked blades.
  const disc = (B, x, y, r, rot, dark, mid, hi) => {
    B.circ(x, y, r * 0.55, ca(dark, 255), 0);
    B.circ(x, y, r * 0.55, ca(mid, 255), 1.5);
    for (let i = 0; i < 3; i++) {
      const a = rot + i * TAU / 3, mx = x + Math.cos(a) * r * 0.75, my = y + Math.sin(a) * r * 0.75, b = a + 0.9;
      B.line(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, mx, my, 3, ca(mid, 255));
      B.line(mx, my, x + Math.cos(b) * r, y + Math.sin(b) * r, 2, ca(hi, 255));
    }
    B.circ(x, y, 1.5, ca(hi, 255), 0);
  };

  // ---------------- projectiles ----------------
  const PROJ = {
    // Orbit lantern: warm halo, the hanging lantern sprite, three embers trailing its orbit.
    lantern(B, pr, t) {
      const fl = Math.sin(t * 14 + pr.id) * 1.5, bx = Math.cos(pr.a), by = Math.sin(pr.a);
      B.circ(pr.x, pr.y, 13 + fl, ca(0xff9a3a, 34), 0);
      B.circ(pr.x, pr.y, 8 + fl * 0.5, ca(0xffd36b, 70), 0);
      for (let i = 1; i <= 3; i++) B.rect(pr.x - bx * i * 5 - 1, pr.y - by * i * 5 - 1 + Math.sin(t * 9 + i) , 2, 2, ca(0xffc24a, 200 - i * 50));
      if (!B.spr('weapon.lantern', 0, pr.x, pr.y - 6, so())) B.circ(pr.x, pr.y, 5, 0xffd36bff, 0);
    },
    // Sun lantern: a spinning firespin flame, white-hot core, wide halo.
    sunlantern(B, pr, t) {
      B.circ(pr.x, pr.y, 20 + Math.sin(t * 11 + pr.id) * 2, ca(0xff7a2a, 40), 0);
      B.spr('fxbig.firespin', frame('fxbig.firespin', t + pr.id * 0.13), pr.x, pr.y, so(0.95, 0, 0.42, true));
      B.circ(pr.x, pr.y, 6, ca(0xffc24a, 230), 0);
      B.circ(pr.x, pr.y, 3, 0xfff4c0ff, 0);
    },
    iceshard(B, pr) {
      const bx = Math.cos(pr.a), by = Math.sin(pr.a);
      B.line(pr.x - bx * 10, pr.y - by * 10, pr.x, pr.y, 3, ca(0x7fe3ff, 170));
      B.line(pr.x - bx * 5, pr.y - by * 5, pr.x + bx * 2, pr.y + by * 2, 1, 0xffffffff);
    },
    // Glaive: a spinning three-bladed disc (hub, rim, hooked blades) inside a motion-blur halo.
    glaive(B, pr, t) {
      B.circ(pr.x, pr.y, 13, ca(0xd9dfe8, 30), 0);
      disc(B, pr.x, pr.y, 10, t * 24 + pr.id, 0x7a8494, 0xd9dfe8, 0xffffff);
    },
    // Moon glaive: moonlit halo, fading afterimages along its path, a large pale spinning disc with a crescent rim.
    moon(B, pr, t) {
      const bx = Math.cos(pr.a), by = Math.sin(pr.a), rot = t * 28 + pr.id;
      B.circ(pr.x, pr.y, 22, ca(0x9fc4ff, 34), 0);
      for (let i = 4; i >= 1; i--) B.circ(pr.x - bx * i * 8, pr.y - by * i * 8, 12 - i * 2, ca(0xc9dcff, 110 - i * 24), 0);
      disc(B, pr.x, pr.y, 15, rot, 0x3a5a9a, 0xc9dcff, 0xffffff);
      B.cone(pr.x, pr.y, 18, rot * 0.25, 2.4, ca(0xe8f0ff, 200), 2);
    },
    ember(B, pr, t) {
      const bx = Math.cos(pr.a), by = Math.sin(pr.a);
      B.line(pr.x - bx * 8, pr.y - by * 8, pr.x, pr.y, 2, ca(0xff7a2a, 150));
      B.circ(pr.x, pr.y, 2.5, (Math.floor(t * 20 + pr.id) & 1) ? 0xffc24aff : 0xfff4c0ff, 0);
    },
  };

  // ---------------- zones: ground layer ----------------
  const ZONE = {
    sunring(B, z, t) {
      B.circ(z.x, z.y - 4, z.r, ca(0xff7a2a, 16), 0);
      B.circ(z.x, z.y - 4, z.r, ca(0xff7a2a, 90), 3);
      B.circ(z.x, z.y - 4, z.r - 3, ca(0xffd36b, 120), 1);
    },
    stormbolt(B, z) { const k = fade(z, z.dur); B.circ(z.x, z.y, z.r * (1.2 - 0.4 * k), ca(0x2a3c80, 90 * k), 0); },
    frostring(B, z, t) {
      const k = fade(z, 0.3);
      B.circ(z.x, z.y, z.r, ca(0x9fdcff, 20 * k), 0);
      B.circ(z.x, z.y, z.r, ca(0x3a78b0, 150 * k), 4);
      B.circ(z.x, z.y, z.r, ca(0xc8f6ff, 230 * k), 2);
      B.circ(z.x, z.y, z.r - 4, ca(0xffffff, 120 * k), 1);
    },
    glacier(B, z, t) {
      const k = fade(z, 0.35), hold = z.t > 0.7;
      B.circ(z.x, z.y, z.r, ca(0x7fe3ff, 30 * k), 0);
      B.circ(z.x, z.y, z.r, ca(0x1c3358, 170 * k), 9);
      B.circ(z.x, z.y, z.r, ca(0x7fe3ff, 220 * k), 5);
      B.circ(z.x, z.y, z.r, ca(0xffffff, 200 * k), 1.5);
      if (hold) B.circ(z.x, z.y, z.r * 0.92, ca(0xc8f6ff, (60 + 40 * Math.sin(t * 8)) * k), 1);
    },
    // Thorn patch: dark ground stain, spikes erupting (first 0.14 s) then withering (last 0.4 s).
    bramble(B, z, t) { thorns(B, z, t, 0x14300c, 0x3f7a18, 0x9be33c, 4, 1); },
    thicket(B, z, t) { thorns(B, z, t, 0x2a0c1c, 0x5a2f40, 0xd2ff82, 6, 1.25); B.circ(z.x, z.y, z.r, ca(0x9be33c, 60 * fade(z, 0.5)), 1); },
    // Meteor / star / comet target: a pulsing ring that fills as the fall completes.
    meteor(B, z, t) { target(B, z, t, 0xff6a2a); },
    star(B, z, t) { target(B, z, t, 0xffe66b); },
    comet(B, z, t) { target(B, z, t, 0xff4a2a); B.circ(z.x, z.y, z.r * 1.15, ca(0xff4a2a, 90), 1); },
    crater(B, z, t) {
      const k = fade(z, 0.5) * grow(z, 0.2), r = z.r, pulse = 0.5 + 0.5 * Math.sin(t * 9 + z.id);
      B.circ(z.x, z.y, r, ca(0x4a1006, 70 * k), 0);
      B.circ(z.x, z.y, r * 0.55, ca(0xff7a2a, (40 + 30 * pulse) * k), 0);
      B.circ(z.x, z.y, r, ca(0xff7a2a, (110 + 80 * pulse) * k), 1.5);
      for (let i = 0; i < 6; i++) {
        const a = hs(z.id + i) * TAU, d = r * (0.15 + 0.7 * hs(z.id * 3 + i));
        B.spr('fx.flame', frame('fx.flame', t + i * 0.21), z.x + Math.cos(a) * d, z.y + Math.sin(a) * d * 0.8, so(k, 0, 1.3));
      }
    },
  };
  const thorns = (B, z, t, stain, body, tip, n, sc) => {
    const g = grow(z, 0.14), k = fade(z, 0.4), r = z.r;
    B.circ(z.x, z.y, r, ca(stain, 110 * k), 0);
    for (let i = 0; i < n; i++) {
      const a = hs(z.id * 1.7 + i) * TAU, d = r * 0.75 * hs(z.id * 2.3 + i * 3.1), x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d * 0.6;
      const h = (7 + 7 * hs(z.id + i * 5.3)) * sc * g * (0.4 + 0.6 * k), lean = (hs(z.id + i * 9.1) - 0.5) * 6 * sc;
      B.line(x - 1.5, y, x + lean * 0.6, y - h * 0.65, 3, ca(body, 255 * k));
      B.line(x + lean * 0.6, y - h * 0.65, x + lean, y - h, 1.5, ca(tip, 255 * k));
    }
    if (n > 4 && g >= 1) B.spr('proj.thorn', frame('proj.thorn', t + z.id * 0.1), z.x, z.y - 4, so(0.85 * k, -PI / 2, 0.7 * sc));
  };
  const target = (B, z, t, col) => {
    const k = Math.min(1, z.t / z.dur), pulse = 0.5 + 0.5 * Math.sin(t * 20 + z.id);
    B.circ(z.x, z.y, z.r, ca(col, 26 + 40 * k), 0);
    B.circ(z.x, z.y, z.r * k, ca(col, 60), 0);
    B.circ(z.x, z.y, z.r, ca(col, 140 + 100 * pulse), 1.5);
  };

  // ---------------- zones: overlays above actors ----------------
  const FALL = { meteor: [70, 240, 'proj.fireball', 1.7, 0xff7a2a, 5], star: [50, 200, '', 0, 0xfff0c2, 2], comet: [110, 300, 'proj.fireball', 3.2, 0xff4a2a, 9] };
  const TOP = {
    // Sun Wheel: embers spinning along the ring.
    sunring(B, z, t) {
      for (let i = 0; i < 18; i++) {
        const a = i * TAU / 18 + t * 1.3, rr = z.r + Math.sin(t * 7 + i * 2.1) * 3;
        B.rect(z.x + Math.cos(a) * rr - 1, z.y - 4 + Math.sin(a) * rr - 1, 2, 2, ca(i & 1 ? 0xffc24a : 0xfff4c0, 200));
      }
    },
    sunflare(B, z, t) {
      const k = Math.min(1, z.t / z.dur), id = 'fx.explosion';
      B.spr(id, Math.min(nFrames(id) - 1, Math.floor(k * nFrames(id))), z.x, z.y, so(1, 0, z.r / 16, true));
      B.circ(z.x, z.y, z.r * (0.6 + 0.6 * k), ca(0xffc24a, 200 * (1 - k)), 2);
    },
    // Chain hop: a jagged bolt with a glow pass, flickering, plus a spark at the struck end.
    spark(B, z, t) {
      const k = fade(z, z.dur), ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len, seed = z.id * 13 + Math.floor(t * 20);
      const segs = Math.max(2, Math.round(z.len / 9));
      bolt(B, z.x, z.y, ex, ey, seed, segs, Math.min(10, z.len * 0.18), 5, 0x6ab8ff, 0xffffff, k);
      if (k > 0.5) bolt(B, z.x, z.y, ex, ey, seed + 91, segs, Math.min(7, z.len * 0.12), 2, 0xc8e6ff, 0xe8f4ff, k * 0.6);
      B.circ(ex, ey, 4 + 3 * k, ca(0xc8e6ff, 160 * k), 0);
    },
    // Sky strike: a thick bolt from above the screen into the foe, a thunder flash, a white ground flash.
    stormbolt(B, z, t) {
      const k = fade(z, z.dur), seed = z.id * 7 + Math.floor(t * 24);
      bolt(B, z.x + 18, z.y - 190, z.x, z.y - 6, seed, 14, 12, 8, 0x5a7aff, 0xffffff, k);
      bolt(B, z.x + 18, z.y - 190, z.x, z.y - 6, seed + 33, 10, 16, 3, 0xa0c0ff, 0xe8f0ff, k * 0.5);
      B.spr('fx.thunder', Math.min(7, Math.floor((1 - k) * 8)), z.x, z.y - 8, so(k, 0, 1.6, true));
      B.circ(z.x, z.y, z.r * (0.5 + 0.5 * (1 - k)), ca(0xe8f0ff, 180 * k), 2);
    },
    // Storm Crown: five crackling sparks circling above the hero's head, arcs flicking between them.
    crown(B, z, t) {
      const cx = z.x, cy = z.y - 34;
      for (let i = 0; i < 5; i++) {
        const a = i * TAU / 5 + t * 2.4, x = cx + Math.cos(a) * 10, y = cy + Math.sin(a) * 4;
        B.line(x, y, x, y - 5, 2, ca(0xffe66b, 220));
        B.rect(x - 1, y - 7, 2, 2, 0xffffffff);
        if (hs(Math.floor(t * 12) + i) > 0.6) { const b = a + TAU / 5; bolt(B, x, y - 4, cx + Math.cos(b) * 10, cy + Math.sin(b) * 4 - 4, Math.floor(t * 30) + i, 3, 3, 2, 0x6ab8ff, 0xffffff, 0.9); }
      }
      B.circ(cx, cy, 11, ca(0x6ab8ff, 40), 0);
    },
    // Frost ring: snow motes riding the ring.
    frostring(B, z, t) {
      const k = fade(z, 0.3);
      for (let i = 0; i < 14; i++) { const a = hs(z.id + i) * TAU + t * 0.6, rr = z.r - 2 + 4 * hs(i + z.id * 2); B.rect(z.x + Math.cos(a) * rr - 1, z.y + Math.sin(a) * rr - 1, 2, 2, ca(0xffffff, 220 * k)); }
    },
    // Glacier: ice crystals jutting out of the ring, a freezing mist burst when it reaches full size.
    glacier(B, z, t) {
      const k = fade(z, 0.35), n = 22;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n + hs(z.id + i) * 0.2, h = 6 + 10 * hs(z.id * 3 + i), c = Math.cos(a), s = Math.sin(a);
        const x0 = z.x + c * (z.r - 4), y0 = z.y + s * (z.r - 4), x1 = z.x + c * (z.r + h * 0.4), y1 = z.y + s * (z.r + h * 0.4) - h;
        B.line(x0, y0, x1, y1, 4, ca(0x3a78b0, 220 * k));
        B.line(x0, y0 - 1, x1, y1, 2, ca(0xc8f6ff, 255 * k));
      }
      if (z.t > 0.6 && z.t < 1.1) { const m = (z.t - 0.6) / 0.5; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + z.id; B.spr('fxbig.freezing', frame('fxbig.freezing', t + i * 0.2), z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r, so(0.8 * (1 - m), 0, 0.45, true)); } }
    },
    // Thorn eruption: green splinters flying out during the first 0.18 s.
    bramble(B, z) { splinters(B, z, 0x9be33c, 4); },
    thicket(B, z) { splinters(B, z, 0xd2ff82, 6); },
    // Falling bodies: from up-right toward the target, a streak behind, the rock or star at the head.
    meteor(B, z, t) { faller(B, z, t, FALL.meteor); },
    star(B, z, t) { faller(B, z, t, FALL.star); },
    comet(B, z, t) { faller(B, z, t, FALL.comet); B.spr('fxbig.firespin', frame('fxbig.firespin', t), fallX, fallY, so(0.9, 0, 0.5, true)); },
    // Impact: explosion flipbook scaled to the blast, a hot ring.
    mboom(B, z, t) {
      const k = Math.min(1, z.t / z.dur), id = 'fx.explosion', nf = nFrames(id);
      B.spr(id, Math.min(nf - 1, Math.floor(k * nf * 1.1)), z.x, z.y - 4, so(1, 0, Math.max(1, z.r / 18)));
      B.circ(z.x, z.y, z.r * (0.7 + 0.5 * k), ca(0xffc24a, 220 * (1 - k)), 3);
      B.circ(z.x, z.y, z.r * (0.3 + 0.9 * k), ca(0xfff4c0, 160 * (1 - k)), 1);
    },
  };
  const splinters = (B, z, col, n) => {
    if (z.t > 0.18) return;
    const k = z.t / 0.18;
    for (let i = 0; i < n; i++) { const a = -PI / 2 + (hs(z.id + i * 4.7) - 0.5) * 2.4, d = 4 + 16 * k; B.rect(z.x + Math.cos(a) * d - 1, z.y - 6 + Math.sin(a) * d - 1, 2, 2, ca(col, 255 * (1 - k))); }
  };
  let fallX = 0, fallY = 0;
  const faller = (B, z, t, f) => {
    const k = Math.min(1, z.t / z.dur), e = k * k, ox = f[0] * (1 - e), oy = f[1] * (1 - e), x = z.x + ox, y = z.y - 6 - oy;
    fallX = x; fallY = y;
    const l = Math.hypot(f[0], f[1]), ux = f[0] / l, uy = -f[1] / l, tail = 18 + f[5] * 6;
    B.line(x, y, x + ux * tail * 2, y + uy * tail * 2, f[5], ca(f[4], 60));
    B.line(x, y, x + ux * tail, y + uy * tail, Math.max(1, f[5] * 0.5), ca(0xfff4c0, 200));
    if (f[2]) B.spr(f[2], frame(f[2], t + z.id * 0.1), x, y, so(1, Math.atan2(-uy, -ux) - 7 * PI / 4, f[3]));
    else { B.circ(x, y, 5, ca(f[4], 120), 0); B.circ(x, y, 2.5, 0xffffffff, 0); }
  };

  // ---------------- registration ----------------
  const fx = {
    proj(B, pr, t) { const f = PROJ[pr.k]; if (!f) return false; f(B, pr, t); return true; },
    zone(B, z, t) { const f = ZONE[z.k]; if (f) f(B, z, t); return f !== undefined || TOP[z.k] !== undefined; },
    top(B, z, t) { const f = TOP[z.k]; if (f) f(B, z, t); },
  };
  for (const id of ['lanterns', 'sunwheel', 'chainspark', 'stormcrown', 'frostring', 'glacier', 'bramble', 'thornwood', 'glaive', 'twinmoons', 'meteorcall', 'starfall']) ED.WeaponFx[id] = fx;
})(globalThis.ED || (globalThis.ED = {}));
