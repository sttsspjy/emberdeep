// Client draw hooks for general weapons group B: ED.WeaponFx entries for bonespear / impaler / blight / plague / wisp / choir / mortar / barrage / censer / holycenser / ricochet / avalanche
// (projectiles and zones dispatch on the look name pr.k / z.k; looks without a drawer fall back to the default), plus boom juice for the looks shell, bomblet, blight, impaler:
// atlas sprite bursts (own pool, drawn after ED.FX.draw), debris through ED.FX.part, shake for the local hero's blasts. Reads only render-visible fields.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  // 0xRRGGBB + alpha 0..255 -> 0xRRGGBBAA.
  const ca = (rgb, a) => (rgb * 256 + (a <= 0 ? 0 : a >= 255 ? 255 : a | 0)) >>> 0;
  // Stable pseudo-random 0..1 from an index and a seed.
  const hr = (i, s) => { const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); };
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const so = (alpha, sc, rot, add) => { O.alpha = alpha; O.sx = O.sy = sc; O.rot = rot || 0; O.add = !!add; return O; };
  const has = (id) => !!(ED.Atlas && ED.Atlas.ok && ED.Atlas.has(id));

  // ---------------- projectiles ----------------
  // Bone spear: shaft + barbed head + trail, length scales with pr.r (5 x area). Impaler: longer, red underglow and barbs.
  function spear(B, pr, imp) {
    const s = (pr.r || 5) / 5, c = Math.cos(pr.a), n = Math.sin(pr.a), L = (imp ? 22 : 18) * s, x = pr.x, y = pr.y;
    const bx = x - c * L, by = y - n * L, hx = x + c * 5 * s, hy = y + n * 5 * s;
    B.line(bx - c * L, by - n * L, bx, by, 1.5 * s, imp ? 0xff4a3a38 : 0xfff1d630);
    if (imp) B.line(bx, by, hx, hy, 6 * s, 0xc0303048);
    B.line(bx, by, x, y, 2 * s, imp ? 0xeadfc8ff : 0xd8ccacff);
    B.line(x - c * 2 * s, y - n * 2 * s, hx, hy, 3.4 * s, 0xfff8e8ff);
    const barb = imp ? 0xff6a50ff : 0xcfc3a0ff, px = -n * 3 * s, py = c * 3 * s, rx = x - c * 3 * s, ry = y - n * 3 * s;
    B.line(rx + px, ry + py, x + c * s, y + n * s, 1.2 * s, barb);
    B.line(rx - px, ry - py, x + c * s, y + n * s, 1.2 * s, barb);
    B.circ(bx, by, 1.7 * s, 0xbcae8aff, 0);
    return true;
  }
  // Wisp: flickering glow, white core, three trailing motes. Choir: violet glow, gold body, a magic spark on top.
  function wisp(B, pr, t, choir) {
    const s = (pr.r || 4) / 4, ph = pr.id * 0.618, fl = 0.8 + 0.2 * Math.sin(t * 22 + ph * 10), c = Math.cos(pr.a), n = Math.sin(pr.a);
    const glow = choir ? 0xc890ff : 0x7fdcff, body = choir ? 0xffd8a0 : 0xc8f4ff;
    for (let i = 3; i >= 1; i--) B.circ(pr.x - c * i * 4 * s, pr.y - n * i * 4 * s + Math.sin(t * 10 + i + ph) * s, (3.2 - i * 0.7) * s, ca(body, 100 - i * 25), 0);
    B.circ(pr.x, pr.y, 7 * s * fl, ca(glow, 55), 0);
    B.circ(pr.x, pr.y, 3.6 * s, ca(body, 220), 0);
    B.circ(pr.x, pr.y, 1.8 * s, 0xffffffff, 0);
    if (choir && has('fx.spark.magic')) B.spr('fx.spark.magic', Math.floor(t * 16 + ph * 9) % 9, pr.x, pr.y, so(0.55, 0.45 * s, 0, true));
    return true;
  }
  // Stone: dark rim, lit face, spinning chip, motion streak. Boulder: grey-blue rock with a snow cap and a snow trail.
  function stone(B, pr, t, big) {
    const s = (pr.r || 4) / 4, c = Math.cos(pr.a), n = Math.sin(pr.a), x = pr.x, y = pr.y;
    B.line(x - c * 9 * s, y - n * 9 * s, x, y, 2.6 * s, big ? 0xe8f4ff40 : 0xb0a89838);
    if (big) for (let i = 1; i <= 3; i++) B.circ(x - c * i * 5 * s + Math.sin(t * 9 + i * 2 + pr.id) * 1.5, y - n * i * 5 * s, (1.6 - i * 0.3) * s, ca(0xf4f8ff, 190 - i * 50), 0);
    B.circ(x, y, 3.6 * s, big ? 0x4a525cff : 0x5a524aff, 0);
    B.circ(x - 0.4 * s, y - 0.4 * s, 3 * s, big ? 0x7a8592ff : 0x9a9282ff, 0);
    if (big) B.circ(x - 0.8 * s, y - 1.6 * s, 2 * s, 0xf4f8ffff, 0);
    else B.circ(x - 1.2 * s, y - 1.2 * s, 1.2 * s, 0xd8d0c0ff, 0);
    const sa = t * 14 + pr.id;
    B.rect(x + Math.cos(sa) * 2 * s - 0.5, y + Math.sin(sa) * 2 * s - 0.5, 1, 1, 0x2a2622ff);
    return true;
  }
  const PROJ = {
    spear: (B, pr) => spear(B, pr, false), impaler: (B, pr) => spear(B, pr, true),
    wisp: (B, pr, t) => wisp(B, pr, t, false), choir: (B, pr, t) => wisp(B, pr, t, true),
    stone: (B, pr, t) => stone(B, pr, t, false), boulder: (B, pr, t) => stone(B, pr, t, true),
  };

  // ---------------- zones ----------------
  // Grow-in over g s and fade over the last 20% of the zone's life: { grow 0..1, fade 0..1 }.
  const LF = { grow: 1, fade: 1 };
  const life = (z, g) => { const f = z.dur > 0 ? z.t / z.dur : 0; LF.grow = U.easeOut(Math.min(1, z.t / g)); LF.fade = f > 0.8 ? Math.max(0, (1 - f) / 0.2) : 1; return LF; };
  // Blight / plague pool: wobbling disc, off-centre inner pool, bright rim, popping bubbles; plague adds violet core and rising spores.
  function pool(B, z, t, plague) {
    const L = life(z, 0.18), fade = L.fade, ph = z.id * 0.618, r = z.r * (0.4 + 0.6 * L.grow) * (1 + 0.03 * Math.sin(t * 3 + ph * 6));
    B.circ(z.x, z.y, r, ca(plague ? 0x4f7a1e : 0x3f8f2a, 95 * fade), 0);
    B.circ(z.x + Math.cos(ph * 7) * r * 0.15, z.y + Math.sin(ph * 7) * r * 0.12, r * 0.62, ca(plague ? 0x8a4fc0 : 0x7fd34a, 75 * fade), 0);
    B.circ(z.x, z.y, r, ca(plague ? 0xc8ff4a : 0xa8ff6a, 160 * fade), 1);
    const nb = plague ? 6 : 4;
    for (let i = 0; i < nb; i++) {
      const v = t * 0.9 + hr(i, ph), cyc = Math.floor(v), q = v - cyc, a = hr(i * 13 + cyc, ph) * TAU, d = r * 0.75 * Math.sqrt(hr(i * 7 + cyc, ph + 1));
      const bx = z.x + Math.cos(a) * d, by = z.y + Math.sin(a) * d;
      B.circ(bx, by - q * 3, 0.8 + q * 2.2, ca(0xd8ffa0, (1 - q) * 220 * fade), 1);
      if (plague && i < 3) B.rect(bx, by - q * 16, 1, 1, ca(0xd8a8ff, (1 - q) * 255 * fade));
    }
    return true;
  }
  // Mortar burning ground: orange disc and rim with additive flame sprites (circles without the atlas).
  function burn(B, z, t) {
    const L = life(z, 0.12), fade = L.fade, r = z.r * (0.5 + 0.5 * L.grow), ph = z.id * 0.618;
    B.circ(z.x, z.y, r, ca(0xff5a1a, 42 * fade), 0);
    B.circ(z.x, z.y, r * 0.6, ca(0xffb040, 34 * fade), 0);
    B.circ(z.x, z.y, r, ca(0xff8a3a, 130 * fade), 1);
    const fl = has('fx.flame');
    for (let i = 0; i < 5; i++) {
      const a = hr(i, ph) * TAU, d = r * 0.7 * Math.sqrt(hr(i + 5, ph)), fx = z.x + Math.cos(a) * d, fy = z.y + Math.sin(a) * d + 4;
      if (fl) B.spr('fx.flame', Math.floor(t * 12 + i * 2.7) % 8, fx, fy, so(fade, 0.8 + 0.4 * hr(i + 9, ph), 0, true));
      else B.circ(fx, fy - 3, 2 + Math.sin(t * 14 + i), ca(0xffc04a, 200 * fade), 0);
    }
    return true;
  }
  // Mortar shell / bomblet in flight: landing reticle (ring + closing ring + ticks for shells), ground shadow, lobbed shell on a parabola from the launch point
  // (z.x + cos z.a * z.w, z.y + sin z.a * z.w), smoke trail, lit fuse.
  function lob(B, z, t, big) {
    const k = U.clamp(z.dur > 0 ? z.t / z.dur : 1, 0, 1), lx = z.x + Math.cos(z.a) * z.w, ly = z.y + Math.sin(z.a) * z.w;
    const H = (big ? 0.45 : 0.3) * z.w + (big ? 22 : 10);
    if (big) {
      B.circ(z.x, z.y, z.r, ca(0xffb040, 10 + 22 * k), 0);
      B.circ(z.x, z.y, z.r, ca(0xffd070, 110 + 120 * k), 1);
      B.circ(z.x, z.y, Math.max(1, z.r * (1 - k)), ca(0xfff0b0, 180), 1);
      for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + t * 2, c = Math.cos(a), n = Math.sin(a); B.line(z.x + c * z.r * 0.8, z.y + n * z.r * 0.8, z.x + c * z.r * 1.15, z.y + n * z.r * 1.15, 1.5, ca(0xffd070, 200)); }
    } else B.circ(z.x, z.y, z.r, ca(0xffb040, 60 + 100 * k), 1);
    const gx = lx + (z.x - lx) * k, gy = ly + (z.y - ly) * k, sz = big ? 3.6 : 2.3;
    B.circ(gx, gy, sz * 0.9, 0x00000050, 0);
    for (let j = 1; j <= 3; j++) { const q = k - j * 0.06; if (q <= 0) break; lobAt(lx, ly, z.x, z.y, H, q); B.circ(P2[0], P2[1], sz * (0.5 + j * 0.25), ca(0xd8d0c8, 110 - j * 30), 0); }
    lobAt(lx, ly, z.x, z.y, H, k);
    const sx = P2[0], sy = P2[1];
    B.circ(sx, sy, sz + 2.5, ca(0xff9a30, 60 + 40 * Math.sin(t * 40)), 0);
    B.circ(sx, sy, sz, 0x2e2a28ff, 0);
    B.circ(sx - sz * 0.3, sy - sz * 0.3, sz * 0.35, 0x8a8278ff, 0);
    B.circ(sx + Math.cos(t * 30) * 0.6, sy - sz - 1, 1 + 0.5 * Math.sin(t * 50), 0xffe060ff, 0);
    return true;
  }
  // Point q (0..1) along a lob from (lx, ly) to (x, y) with peak height H, into P2.
  const P2 = [0, 0];
  const lobAt = (lx, ly, x, y, H, q) => { P2[0] = lx + (x - lx) * q; P2[1] = ly + (y - ly) * q - 4 * H * q * (1 - q); };
  // Censer aura (z.r radius, follows the hero): soft disc, rim, outgoing pulse ring, orbiting motes, rising smoke; holy adds rotating light rays.
  // Swinging censers: z.w of them at orbit angle z.a, 0.75 x radius, on a chain from the hero, with a smoke trail.
  function censer(B, z, t, holy) {
    const R = z.r, x = z.x, y = z.y - 2, ph = z.id * 0.618, fade = Math.min(1, z.t / 0.25);
    const fill = holy ? 0xffe08a : 0xc8a060, rim = holy ? 0xfff0b0 : 0xe0c080;
    B.circ(x, y, R, ca(fill, (holy ? 34 : 24) * fade), 0);
    if (holy) for (let i = 0; i < 6; i++) { const a = t * 0.6 + i * TAU / 6; B.line(x, y, x + Math.cos(a) * R, y + Math.sin(a) * R, 3, ca(0xfff0a0, 34 * fade)); }
    B.circ(x, y, R, ca(rim, 120 * fade), 1);
    const q = (t * 1.6 + ph) % 1;
    B.circ(x, y, R * (0.55 + 0.45 * q), ca(holy ? 0xffffff : 0xffe0a0, (1 - q) * 130 * fade), 1.5);
    for (let i = 0; i < 10; i++) { const a = (holy ? -t : t) * 0.7 + i * TAU / 10; B.circ(x + Math.cos(a) * R * 0.92, y + Math.sin(a) * R * 0.92, 1.3, ca(0xfff4d0, 170 * fade), 0); }
    for (let i = 0; i < 4; i++) {
      const s = (t * 0.5 + i / 4 + ph) % 1, a = i * 2.3 + ph * 5;
      B.circ(x + Math.cos(a) * R * 0.5, y + Math.sin(a) * R * 0.3 - s * 24, 3 + s * 5, ca(holy ? 0xfff4e0 : 0xbfb8b0, (1 - s) * 50 * fade), 0);
    }
    const n = z.w | 0;
    for (let i = 0; i < n; i++) {
      const a = z.a + i * TAU / n, cx = x + Math.cos(a) * R * 0.75, cy = y + Math.sin(a) * R * 0.75;
      B.line(x, y - 8, cx, cy - 3, 1, ca(0xa08050, 160 * fade));
      for (let j = 1; j <= 3; j++) { const b = a - j * 0.2; B.circ(x + Math.cos(b) * R * 0.75, y + Math.sin(b) * R * 0.75 - j, 2.4 + j, ca(holy ? 0xfff0c0 : 0xb8b0a8, (100 - j * 28) * fade), 0); }
      B.circ(cx, cy, 6.5, ca(holy ? 0xffe27a : 0xffb84a, 70 * fade), 0);
      B.circ(cx, cy, 3.6, holy ? 0xffe27aff : 0xc8962eff, 0);
      B.circ(cx - 1, cy - 1, 1.2, 0xfff6d0ff, 0);
    }
    return true;
  }
  const ZONE = {
    blight: (B, z, t) => pool(B, z, t, false), plague: (B, z, t) => pool(B, z, t, true), mfire: burn,
    shell: (B, z, t) => lob(B, z, t, true), bomblet: (B, z, t) => lob(B, z, t, false),
    censer: (B, z, t) => censer(B, z, t, false), holycenser: (B, z, t) => censer(B, z, t, true),
  };

  const HOOK = {
    proj(B, pr, t) { const f = PROJ[pr.k]; return f ? f(B, pr, t) : false; },
    zone(B, z, t) { const f = ZONE[z.k]; return f ? f(B, z, t) : false; },
  };
  for (const id of ['bonespear', 'impaler', 'blight', 'plague', 'wisp', 'choir', 'mortar', 'barrage', 'censer', 'holycenser', 'ricochet', 'avalanche']) ED.WeaponFx[id] = HOOK;

  // ---------------- boom juice ----------------
  // Sprite bursts: pooled { id, x, y, age, fps, n, sc, alpha, add }, at most MAXB alive (oldest recycled), drawn after the base FX layer.
  const MAXB = 48, bursts = [];
  const burst = (id, x, y, sc, alpha, add) => {
    if (!has(id)) return;
    const an = ED.Atlas.anim(id);
    let b;
    if (bursts.length >= MAXB) { b = bursts.shift(); bursts.push(b); } else { b = {}; bursts.push(b); }
    b.id = id; b.x = x; b.y = y; b.age = 0; b.fps = an.fps || 16; b.n = an.n || 1; b.sc = sc; b.alpha = alpha; b.add = !!add;
  };
  const debris = (F, x, y, n, col, sp, up) => {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = sp * (0.4 + Math.random() * 0.8); F.part(x, y, Math.cos(a) * v, Math.sin(a) * v * 0.7 - up, 0.35 + Math.random() * 0.35, col, 1 + (Math.random() * 2 | 0)); }
  };
  function boom(F, ev, ctx) {
    const x = ev.x, y = ev.y, r = ev.r || 20, mine = ev.pid === ctx.me;
    switch (ev.look) {
      case 'shell':
        burst('fx.explosion', x, y, Math.max(1, r / 18), 1, false);
        burst('fx.smoke.ring', x, y + 4, Math.max(1, r / 14), 0.8, false);
        debris(F, x, y, 10, 0x4a3a2eff, 130, 50); debris(F, x, y, 6, 0xffb040ff, 110, 30);
        if (mine) F.addShake(r > 50 ? 1.8 : 1.2, ctx.crowd);
        break;
      case 'bomblet':
        burst('fx.blast.red', x, y, Math.max(0.6, r / 14), 1, true);
        debris(F, x, y, 4, 0xffc04aff, 90, 20);
        break;
      case 'blight':
        burst('fx.circle.spark', x, y, Math.max(1, r / 14), 0.8, true);
        F.ring(x, y, r, 0xa8ff6aff, 0.4);
        debris(F, x, y, 10, 0x7fe34aff, 80, 40);
        break;
      case 'impaler':
        burst('fx.burst', x, y, Math.max(1, r / 24), 1, false);
        debris(F, x, y, 12, 0xe8dcc0ff, 150, 40); debris(F, x, y, 6, 0xd04030ff, 100, 30);
        if (mine) F.addShake(2, ctx.crowd);
        break;
      default: break;
    }
  }
  const step = (dt) => { let m = 0; for (let i = 0; i < bursts.length; i++) { const b = bursts[i]; b.age += dt; if (b.age * b.fps < b.n) bursts[m++] = b; } bursts.length = m; };
  const drawBursts = (B) => { for (let i = 0; i < bursts.length; i++) { const b = bursts[i]; B.spr(b.id, Math.floor(b.age * b.fps), b.x, b.y, so(b.alpha, b.sc, 0, b.add)); } };

  // Chains onto ED.FX (loaded before this file): handle (booms of the looks above), update, draw, clear.
  const F = ED.FX;
  if (F && !F.wfxB) {
    F.wfxB = true;
    const h0 = F.handle, u0 = F.update, d0 = F.draw, c0 = F.clear;
    F.handle = (ev, ctx) => { h0(ev, ctx); if (ev.t === 'boom' && !ev.team) boom(F, ev, ctx); };
    F.update = (dt) => { u0(dt); step(dt); };
    F.draw = (B, t) => { d0(B, t); drawBursts(B); };
    F.clear = () => { c0(); bursts.length = 0; };
  }
})(globalThis.ED || (globalThis.ED = {}));
