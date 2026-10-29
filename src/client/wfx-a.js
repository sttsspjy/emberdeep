// Support weapon visuals (a): ED.WeaponFx for src/weapons/support-a.js (censer holycenser lanterns sunwheel meteorcall starfall frostring glacier), dispatched on the look k.
// Looks: censer holycenser cward cember | lantern sunlantern sunring lflare | meteor mshower star comet mboom mcrater ember | frostring glacier shatterw mrime iceshard.
// Pixel-true: whole-px positions, 1-3 px lines, atlas sprites at integer-ish scale; fills toned low (dozens overlap at 900 foes). B.zoneLite (2D zone LOD): batched discs, fewer motes.
// Reads only snapshot fields (projectile: id, k, x, y, a, r; zone: id, k, x, y, r, w, t, dur). Allocation free: one shared sprite option object.
(function (ED) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2, q = Math.round;
  const FIRE = [0x4a1006, 0xb82c14, 0xff7a2a, 0xffc24a, 0xfff4c0], ICE = [0x1c3358, 0x3a78b0, 0x7fe3ff, 0xc8f6ff, 0xffffff], HOLY = [0x6a4c18, 0xe0a82e, 0xffcf5a, 0xfff0c2, 0xffffff];
  const SMOKE = 0xbfb8b0, BRASS = 0xc8962e, CHAIN = 0xa08050;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0xffffff, add: false };
  const so = (alpha, sc, rot, add) => { O.alpha = alpha; O.sx = O.sy = sc; O.rot = rot || 0; O.add = !!add; O.tint = 0xffffff; O.flip = false; O.flash = 0; return O; };
  // 0xRRGGBB + alpha 0..255 -> 0xRRGGBBAA.
  const ca = (rgb, a) => (((rgb << 8) | (a <= 0 ? 0 : a >= 255 ? 255 : a | 0)) >>> 0);
  // Stable 0..1 hash of a number.
  const hs = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const frame = (id, t) => ED.Atlas.frameAt(id, t);
  const nFrames = (id) => { const r = ED.Atlas.anim(id); return r ? r.n : 1; };
  const fade = (z, tail) => Math.max(0, Math.min(1, (z.dur - z.t) / tail));
  const grow = (z, t0) => Math.min(1, z.t / t0);
  const disc = (B) => (B.zoneLite ? B.zcirc : B.circ);

  // ---------------- Censer ----------------
  // Aura (r radius, follows the hero; w swinging censers at angle 3.2 x t): faint fill, 1 px rim, an outgoing pulse line, rim motes, rising smoke; holy: gold, slow light rays.
  // Swinging censers: a 1 px chain from the hero, a brass bowl with a glowing coal and a short smoke trail.
  function censer(B, z, t, holy) {
    const R = z.r, x = q(z.x), y = q(z.y - 2), ph = z.id * 0.618, f = Math.min(1, z.t / 0.25);
    const fill = holy ? HOLY[2] : 0xc8a060, rim = holy ? HOLY[3] : 0xe0c080;
    if (B.zoneLite) { B.zcirc(x, y, R, ca(fill, 22 * f), 0); B.zcirc(x, y, R, ca(rim, 110 * f), 1); }
    else {
      B.circ(x, y, R, ca(fill, (holy ? 26 : 18) * f), 0);
      if (holy) for (let i = 0; i < 6; i++) { const a = t * 0.6 + i * TAU / 6; B.line(x, y, q(x + Math.cos(a) * R), q(y + Math.sin(a) * R), 2, ca(HOLY[3], 26 * f)); }
      B.circ(x, y, R, ca(rim, 120 * f), 1);
      const k = (t * 1.6 + ph) % 1;
      B.circ(x, y, R * (0.55 + 0.45 * k), ca(holy ? 0xffffff : 0xffe0a0, (1 - k) * 110 * f), 1);
      for (let i = 0; i < 10; i++) { const a = (holy ? -t : t) * 0.7 + i * TAU / 10; B.rect(q(x + Math.cos(a) * R * 0.92), q(y + Math.sin(a) * R * 0.92), 1, 1, ca(0xfff4d0, 190 * f)); }
      for (let i = 0; i < 4; i++) {
        const s = (t * 0.5 + i / 4 + ph) % 1, a = i * 2.3 + ph * 5;
        B.circ(q(x + Math.cos(a) * R * 0.5), q(y + Math.sin(a) * R * 0.3 - s * 24), 3 + s * 5, ca(holy ? 0xfff4e0 : SMOKE, (1 - s) * 40 * f), 0);
      }
    }
    const n = z.w | 0;
    for (let i = 0; i < n; i++) {
      const a = z.t * 3.2 + i * TAU / n, cx = q(x + Math.cos(a) * R * 0.8), cy = q(y + Math.sin(a) * R * 0.8);
      B.line(x, y - 8, cx, cy - 3, 1, ca(CHAIN, 170 * f));
      if (!B.zoneLite) for (let j = 1; j <= 3; j++) { const b = a - j * 0.22; B.circ(q(x + Math.cos(b) * R * 0.8), q(y + Math.sin(b) * R * 0.8 - j), 2 + j, ca(holy ? 0xfff0c0 : SMOKE, (90 - j * 26) * f), 0); }
      B.circ(cx, cy, 6, ca(holy ? 0xffe27a : 0xffb84a, 60 * f), 0);
      B.circ(cx, cy, 3, ca(holy ? 0xffe27a : BRASS, 255 * f), 0);
      B.rect(cx - 1, cy - 1, 1, 1, ca(0xfff6d0, 255 * f));
    }
    return true;
  }
  // Ward blast: a 2 px gold band rushing out to the rim, fading.
  function cward(B, z) {
    const k = Math.min(1, z.t / z.dur), r = z.r * (0.6 + 0.4 * k), x = q(z.x), y = q(z.y - 2);
    disc(B)(x, y, r, ca(HOLY[3], 200 * (1 - k)), 2);
    if (!B.zoneLite) disc(B)(x, y, r - 3, ca(0xffffff, 120 * (1 - k)), 1);
    return true;
  }
  // Ember patch: dark scorch, a dim fire rim, a few flickering flame pixels rising.
  function cember(B, z, t) {
    const f = fade(z, 0.5) * grow(z, 0.15), x = q(z.x), y = q(z.y);
    disc(B)(x, y, z.r, ca(FIRE[0], 70 * f), 0);
    disc(B)(x, y, z.r, ca(FIRE[2], 110 * f), 1);
    if (B.zoneLite) return true;
    for (let i = 0; i < 4; i++) {
      const a = hs(z.id + i) * TAU, d = z.r * 0.7 * hs(z.id * 3 + i), s = (t * 1.8 + hs(i + z.id)) % 1;
      B.rect(q(x + Math.cos(a) * d), q(y + Math.sin(a) * d * 0.6 - s * 8), 1, 2, ca(s < 0.5 ? FIRE[3] : FIRE[2], 230 * f * (1 - s)));
    }
    return true;
  }

  // ---------------- Lanterns ----------------
  // Lantern: warm halo, the hanging lantern sprite, three ember pixels trailing its orbit. Sun: a spinning firespin flame, white-hot core, halo.
  function lantern(B, pr, t) {
    const fl = Math.sin(t * 14 + pr.id) * 1.5, bx = Math.cos(pr.a), by = Math.sin(pr.a), x = q(pr.x), y = q(pr.y);
    B.circ(x, y, 12 + fl, ca(FIRE[2], 28), 0);
    B.circ(x, y, 7 + fl * 0.5, ca(FIRE[3], 60), 0);
    for (let i = 1; i <= 3; i++) B.rect(q(x - bx * i * 5), q(y - by * i * 5 + Math.sin(t * 9 + i)), 1, 1, ca(FIRE[3], 220 - i * 50));
    if (!B.spr('weapon.lantern', 0, x, y - 6, so(1, 1))) B.circ(x, y, 5, ca(FIRE[3], 255), 0);
    return true;
  }
  function sunlantern(B, pr, t) {
    const x = q(pr.x), y = q(pr.y);
    B.circ(x, y, 18 + Math.sin(t * 11 + pr.id) * 2, ca(FIRE[2], 34), 0);
    B.spr('fxbig.firespin', frame('fxbig.firespin', t + pr.id * 0.13), x, y, so(0.95, 0.42, 0, true));
    B.circ(x, y, 5, ca(FIRE[3], 230), 0);
    B.circ(x, y, 2, ca(FIRE[4], 255), 0);
    return true;
  }
  // Sun Wheel ring (ground): faint fire fill, a 2 px band, a 1 px inner line; embers ride it (top).
  function sunring(B, z) {
    const x = q(z.x), y = q(z.y - 4);
    disc(B)(x, y, z.r, ca(FIRE[2], 12), 0);
    disc(B)(x, y, z.r, ca(FIRE[2], 80), 2);
    if (!B.zoneLite && z.r > 4) B.circ(x, y, z.r - 3, ca(FIRE[3], 100), 1);
    return true;
  }
  function sunringTop(B, z, t) {
    for (let i = 0, st = B.zoneLite ? 3 : 1; i < 18; i += st) {
      const a = i * TAU / 18 + t * 1.3, rr = z.r + Math.sin(t * 7 + i * 2.1) * 3;
      B.rect(q(z.x + Math.cos(a) * rr), q(z.y - 4 + Math.sin(a) * rr), 2, 2, ca(i & 1 ? FIRE[3] : FIRE[4], 190));
    }
  }
  // Burst: explosion flipbook at the burst size, a hot 2 px ring opening out.
  function lflare(B, z) {
    const k = Math.min(1, z.t / z.dur), id = 'fx.explosion', nf = nFrames(id);
    B.spr(id, Math.min(nf - 1, Math.floor(k * nf)), q(z.x), q(z.y), so(0.7, Math.max(0.5, z.r / 30)));
    B.circ(q(z.x), q(z.y), z.r * (0.5 + 0.6 * k), ca(FIRE[3], 200 * (1 - k)), 2);
  }

  // ---------------- Meteors ----------------
  // Target (ground): a faint disc, a disc filling as the fall completes, a pulsing 1 px rim.
  function target(B, z, t, col) {
    const k = Math.min(1, z.t / z.dur), pulse = 0.5 + 0.5 * Math.sin(t * 20 + z.id), x = q(z.x), y = q(z.y), D = disc(B);
    D(x, y, z.r, ca(col, 18 + 30 * k), 0);
    D(x, y, z.r * k, ca(col, 50), 0);
    D(x, y, z.r, ca(col, 130 + 90 * pulse), 1);
    return true;
  }
  // Fallers (top): from up-right toward the target, a streak behind, the rock or star at the head. [dx, dy, sprite, scale, colour, width]
  const FALL = { meteor: [70, 240, 'proj.fireball', 1.4, FIRE[2], 4], mshower: [40, 180, 'proj.fireball', 0.8, FIRE[2], 2], star: [50, 200, '', 0, 0xfff0c2, 2],
    comet: [110, 300, 'proj.fireball', 2.6, 0xff4a2a, 7] };
  let fallX = 0, fallY = 0;
  function faller(B, z, t, f) {
    const k = Math.min(1, z.t / z.dur), e = k * k, x = q(z.x + f[0] * (1 - e)), y = q(z.y - 6 - f[1] * (1 - e));
    fallX = x; fallY = y;
    const l = Math.hypot(f[0], f[1]), ux = f[0] / l, uy = -f[1] / l, tail = 16 + f[5] * 5;
    if (!B.zoneLite) B.line(x, y, q(x + ux * tail * 2), q(y + uy * tail * 2), f[5], ca(f[4], 60));
    B.line(x, y, q(x + ux * tail), q(y + uy * tail), Math.max(1, f[5] >> 1), ca(0xfff4c0, 200));
    if (f[2]) B.spr(f[2], frame(f[2], t + z.id * 0.1), x, y, so(1, f[3], Math.atan2(-uy, -ux) - 7 * PI / 4));
    else { if (!B.zoneLite) B.circ(x, y, 4, ca(f[4], 110), 0); B.rect(x - 1, y - 1, 3, 3, 0xffffffff); }
  }
  // Impact (top): a hot 3 px ring and a 1 px white ring opening out; the flipbook only for big impacts (smaller ones get the boom event's flash).
  function mboom(B, z) {
    const k = Math.min(1, z.t / z.dur), x = q(z.x), y = q(z.y);
    if (z.r >= 40) { const id = 'fx.explosion', nf = nFrames(id); B.spr(id, Math.min(nf - 1, Math.floor(k * nf * 1.1)), x, y - 4, so(1, Math.max(1, z.r / 18))); }
    B.circ(x, y, z.r * (0.7 + 0.5 * k), ca(FIRE[3], 200 * (1 - k)), 3);
    if (!B.zoneLite) B.circ(x, y, z.r * (0.3 + 0.9 * k), ca(FIRE[4], 150 * (1 - k)), 1);
  }
  // Crater (ground): scorched disc, a pulsing ember core and rim, flames (LOD: disc + rim).
  function mcrater(B, z, t) {
    const k = fade(z, 0.5) * grow(z, 0.2), r = z.r, x = q(z.x), y = q(z.y), pulse = 0.5 + 0.5 * Math.sin(t * 9 + z.id);
    if (B.zoneLite) { B.zcirc(x, y, r, ca(0x6a1a08, 80 * k), 0); B.zcirc(x, y, r, ca(FIRE[2], 140 * k), 1); return true; }
    B.circ(x, y, r, ca(FIRE[0], 64 * k), 0);
    B.circ(x, y, r * 0.55, ca(FIRE[2], (30 + 26 * pulse) * k), 0);
    B.circ(x, y, r, ca(FIRE[2], (100 + 70 * pulse) * k), 1);
    for (let i = 0; i < 5; i++) {
      const a = hs(z.id + i) * TAU, d = r * (0.15 + 0.7 * hs(z.id * 3 + i));
      B.spr('fx.flame', frame('fx.flame', t + i * 0.21), q(x + Math.cos(a) * d), q(y + Math.sin(a) * d * 0.8), so(k, 1));
    }
    return true;
  }
  function ember(B, pr, t) {
    const bx = Math.cos(pr.a), by = Math.sin(pr.a), x = q(pr.x), y = q(pr.y);
    B.line(q(x - bx * 7), q(y - by * 7), x, y, 2, ca(FIRE[2], 150));
    B.rect(x - 1, y - 1, 2, 2, (Math.floor(t * 20 + pr.id) & 1) ? ca(FIRE[3], 255) : ca(FIRE[4], 255));
    return true;
  }

  // ---------------- Frost ----------------
  // Ring (ground): faint fill, a 3 px deep band, a 1 px pale line and white inner line; Glacier: a heavier 5 px band, a shimmer while it holds as a wall.
  function frostring(B, z) {
    if (z.r < 3) return true;
    const k = fade(z, 0.3), x = q(z.x), y = q(z.y);
    if (B.zoneLite) { B.zcirc(x, y, z.r, ca(ICE[2], 14 * k), 0); B.zcirc(x, y, z.r, ca(ICE[3], 200 * k), 2); return true; }
    B.circ(x, y, z.r, ca(ICE[2], 14 * k), 0);
    B.circ(x, y, z.r, ca(ICE[1], 150 * k), 3);
    B.circ(x, y, z.r, ca(ICE[3], 230 * k), 1);
    if (z.r > 5) B.circ(x, y, z.r - 4, ca(0xffffff, 100 * k), 1);
    return true;
  }
  function glacier(B, z, t) {
    if (z.r < 3) return true;
    const k = fade(z, 0.35), x = q(z.x), y = q(z.y), hold = z.t > 0.55;
    if (B.zoneLite) { B.zcirc(x, y, z.r, ca(ICE[2], 22 * k), 0); B.zcirc(x, y, z.r, ca(ICE[2], 210 * k), 4); return true; }
    B.circ(x, y, z.r, ca(ICE[2], 22 * k), 0);
    B.circ(x, y, z.r, ca(ICE[0], 170 * k), 7);
    B.circ(x, y, z.r, ca(ICE[2], 220 * k), 3);
    B.circ(x, y, z.r, ca(0xffffff, 190 * k), 1);
    if (hold) B.circ(x, y, z.r * 0.92, ca(ICE[3], (50 + 40 * Math.sin(t * 8)) * k), 1);
    return true;
  }
  // Ring (top): snow pixels riding the rim. Glacier (top): ice crystals jutting from the rim, a freezing mist as it reaches full size.
  function frostTop(B, z, t) {
    const k = fade(z, 0.3);
    for (let i = 0, st = B.zoneLite ? 3 : 1; i < 14; i += st) {
      const a = hs(z.id + i) * TAU + t * 0.6, rr = z.r - 2 + 4 * hs(i + z.id * 2);
      B.rect(q(z.x + Math.cos(a) * rr), q(z.y + Math.sin(a) * rr), 1, 1, ca(0xffffff, 230 * k));
    }
  }
  function glacierTop(B, z, t) {
    const k = fade(z, 0.35), n = 20;
    for (let i = 0, st = B.zoneLite ? 3 : 1; i < n; i += st) {
      const a = i * TAU / n + hs(z.id + i) * 0.2, h = 5 + 9 * hs(z.id * 3 + i), c = Math.cos(a), s = Math.sin(a);
      const x0 = q(z.x + c * (z.r - 3)), y0 = q(z.y + s * (z.r - 3)), x1 = q(z.x + c * (z.r + h * 0.4)), y1 = q(z.y + s * (z.r + h * 0.4) - h);
      B.line(x0, y0, x1, y1, 3, ca(ICE[1], 210 * k));
      B.line(x0, y0 - 1, x1, y1, 1, ca(ICE[3], 255 * k));
    }
    if (z.t > 0.5 && z.t < 1 && !B.zoneLite) {
      const m = (z.t - 0.5) / 0.5;
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + z.id; B.spr('fxbig.freezing', frame('fxbig.freezing', t + i * 0.2), q(z.x + Math.cos(a) * z.r), q(z.y + Math.sin(a) * z.r), so(0.7 * (1 - m), 0.45, 0, true)); }
    }
  }
  // Shatter ring (ground, waits 0.7 s at r 2): a 1 px white line with short dark crack ticks across it every 30 degrees.
  function shatterw(B, z) {
    if (z.r < 3) return true;
    const k = fade(z, 0.3), x = q(z.x), y = q(z.y);
    disc(B)(x, y, z.r, ca(0xffffff, 210 * k), 1);
    if (B.zoneLite) return true;
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12 + z.id, c = Math.cos(a), s = Math.sin(a);
      B.line(q(x + c * (z.r - 3)), q(y + s * (z.r - 3)), q(x + c * (z.r + 3)), q(y + s * (z.r + 3)), 1, ca(ICE[1], 230 * k));
    }
    return true;
  }
  // Frost floor (ground): faint fill, 1 px pale rim, a few twinkling ice pixels.
  function mrime(B, z, t) {
    const f = Math.min(1, z.t / 0.15, (z.dur - z.t) / 0.4), x = q(z.x), y = q(z.y);
    disc(B)(x, y, z.r, ca(ICE[2], 16 * f), 0);
    disc(B)(x, y, z.r, ca(ICE[3], 110 * f), 1);
    if (B.zoneLite) return true;
    for (let i = 0; i < 8; i++) {
      const a = hs(z.id + i * 3.1) * TAU, d = Math.sqrt(hs(z.id * 7 + i)) * (z.r - 2);
      if (Math.sin(t * 5 + i * 1.7) > 0.2) B.rect(q(x + Math.cos(a) * d), q(y + Math.sin(a) * d * 0.6), 1, 1, ca(0xffffff, 230 * f));
    }
    return true;
  }
  function iceshard(B, pr) {
    const bx = Math.cos(pr.a), by = Math.sin(pr.a), x = q(pr.x), y = q(pr.y);
    B.line(q(x - bx * 9), q(y - by * 9), x, y, 3, ca(ICE[2], 170));
    B.line(q(x - bx * 4), q(y - by * 4), q(x + bx * 2), q(y + by * 2), 1, 0xffffffff);
    return true;
  }

  // ---------------- registration ----------------
  const PROJ = { lantern, sunlantern, ember, iceshard };
  const ZONE = {
    censer: (B, z, t) => censer(B, z, t, false), holycenser: (B, z, t) => censer(B, z, t, true), cward, cember, sunring, mcrater, mrime, frostring, glacier, shatterw,
    meteor: (B, z, t) => target(B, z, t, FIRE[2]), mshower: (B, z, t) => target(B, z, t, FIRE[3]), star: (B, z, t) => target(B, z, t, 0xffe66b),
    comet: (B, z, t) => { target(B, z, t, 0xff4a2a); disc(B)(q(z.x), q(z.y), z.r * 1.12, ca(0xff4a2a, 80), 1); return true; },
    lflare: () => true, mboom: () => true,
  };
  const TOP = {
    sunring: sunringTop, lflare, mboom, frostring: frostTop, glacier: glacierTop,
    meteor: (B, z, t) => faller(B, z, t, FALL.meteor), mshower: (B, z, t) => faller(B, z, t, FALL.mshower), star: (B, z, t) => faller(B, z, t, FALL.star),
    comet: (B, z, t) => { faller(B, z, t, FALL.comet); B.spr('fxbig.firespin', frame('fxbig.firespin', t), fallX, fallY, so(0.9, 0.5, 0, true)); },
  };
  const fx = {
    proj(B, pr, t) { const f = PROJ[pr.k]; return f ? f(B, pr, t) : false; },
    zone(B, z, t) { const f = ZONE[z.k]; return f ? f(B, z, t) : false; },
    top(B, z, t) { const f = TOP[z.k]; if (f) f(B, z, t); },
  };
  for (const id of ['censer', 'holycenser', 'lanterns', 'sunwheel', 'meteorcall', 'starfall', 'frostring', 'glacier']) ED.WeaponFx[id] = fx;
})(globalThis.ED || (globalThis.ED = {}));
