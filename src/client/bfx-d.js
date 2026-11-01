// Client draw hooks for the Wickmother (src/sim/boss-wickmother.js): her body through ED.ZoneFx.wmbody (ground layer, never culled with the core: torso, head pose, wick crown, heart flame,
// ward shell, falling drips, the P2 darkness), ED.BossFx bodies (core: ward flash only; hands: pose sprites by e.st, shadow, HP strip), ED.ZoneFx by zone look (sconce, limp hand, melt band,
// wax pool, shock ring, tide wall, flood), ED.WeaponFx.wmflame (flame bolts), phase banners and death bursts wrapped around ED.FX.handle. Art is drawn at x2 (WM.S). Snapshot-safe fields only.
(function (ED) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2, S = 2;
  const ZF = ED.ZoneFx = ED.ZoneFx || {};
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: S, sy: S, tint: 0, add: false };
  const reset = () => { O.flip = false; O.flash = 0; O.alpha = 1; O.rot = 0; O.sx = S; O.sy = S; O.tint = 0; O.add = false; return O; };
  const rgba = (rgb, a) => (((rgb & 0xffffff) * 256) + Math.max(0, Math.min(255, Math.round(a)))) >>> 0;
  const FIRE = 0xff9a34, HOT = 0xffd866, WAXC = 0xe2c08f, WAXD = 0x93654f, WARD = 0xffd27a;
  const hit = (e) => (ED.Actors && ED.Actors.hitFlash ? ED.Actors.hitFlash(e) : e.flash > 0);
  const atlas = () => { const A = ED.Atlas; return A && A.ok ? A : null; };
  const hsh = (n) => { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
  // Core foe in the view (hit flash for the body), or null.
  const coreOf = () => { const v = ED.Game && ED.Game.view; if (v) for (const e of v.foes) if (!e.dead && e.def && e.def.id === 'wickmother') return e; return null; };
  // Lit sconces in the view (0..4) for the P2 darkness.
  const litN = () => { const v = ED.Game && ED.Game.view; let n = 0; if (v) for (const z of v.zones) if (!z.dead && z.k === 'wmsconce' && z.w >= 1) n++; return n; };
  // One small flame of size k at (x, y) (flickers with t and seed i).
  const flame = (B, x, y, k, t, i, col) => {
    const f = 0.5 + 0.5 * Math.sin(t * 13 + i * 2.1), g = 0.5 + 0.5 * Math.sin(t * 7.3 + i);
    B.circ(x, y - 3 * k, (5 + 2 * f) * k, rgba(col || FIRE, 70), 0);
    B.circ(x, y - 3 * k, (3 + f) * k, rgba(col || FIRE, 200), 0);
    B.circ(x + (g - 0.5) * k, y - (5 + f) * k, (1.8 + f * 0.6) * k, rgba(HOT, 240), 0);
    B.circ(x, y - 2.5 * k, 1.2 * k, 0xfffbe8ff, 0);
  };

  // ---------- body ----------
  // z.w = core st (1 cast, 2 roar, 4 ward, 8 kneel, (phase - 1) << 4) + 64 x wick %. Drawn at the core (z.x, z.y).
  ZF.wmbody = (B, z, t) => {
    const A = atlas(); if (!A) return true;
    const st = z.w % 64, wick = Math.floor(z.w / 64) / 100, ph = ((st >> 4) & 3) + 1, ward = !!(st & 4), kneel = !!(st & 8), x = z.x, y = z.y;
    // P2: the room goes dark around her (floor layer; the sconces' light pools draw over it)
    if (ph === 2) { const k = 1 - litN() / 4; B.rect(x - 380, y - 190, 760, 520, rgba(0x05020a, 70 + 90 * k)); }
    const core = coreOf(), fl = core && hit(core);
    B.shadow(x, y + 56, 170);
    const o = reset();
    if (fl && !ward) o.flash = 0.35;
    if (ph === 3 && wick < 0.2) o.tint = (t * 6 | 0) % 2 ? 0xffb08a : 0;
    B.spr('boss.wickmother.torso', 0, x, y, o);
    // heart flame in the cavity: brighter and larger while exposed
    const hk = kneel || ph === 3 ? 1.25 : 1, hp = 0.5 + 0.5 * Math.sin(t * 5);
    B.circ(x, y - 12, (22 + 6 * hp) * hk, rgba(FIRE, kneel ? 90 : 50), 0);
    const ho = reset(); ho.sx = ho.sy = S * hk; ho.add = false;
    B.spr('boss.wickmother.heart', A.frameAt('boss.wickmother.heart', t), x, y + 22, ho);
    if (ward) { // a golden ward shell over the cavity; hits ripple it
      const a = fl ? 255 : 110 + 60 * hp;
      B.circ(x, y - 12, 36 + (fl ? 3 : 0), rgba(WARD, a), fl ? 3 : 2); B.circ(x, y - 12, 31, rgba(WARD, a * 0.35), 1);
      for (let i = 0; i < 6; i++) { const q = t * 0.8 + i * TAU / 6, r = 34; B.circ(x + Math.cos(q) * r, y - 12 + Math.sin(q) * r, 2, rgba(0xfff1d6, a), 0); }
    }
    // head pose; it sinks while she kneels, breathes otherwise
    const pose = kneel ? 'kneel' : st & 2 ? 'roar' : st & 1 ? 'cast' : 'idle', by = kneel ? 0 : Math.round(Math.sin(t * 1.4)) * 1;
    const oh = reset(); if (fl && !ward) oh.flash = 0.35;
    B.spr('boss.wickmother.' + pose, 0, x, y + by, oh);
    // wick crown: four short wicks and the great wick, which burns down in P3
    const cy = y + by - 150 + (kneel ? 6 : 0);
    for (let i = 0; i < 4; i++) { const wx = x + (i < 2 ? -30 + i * 12 : 18 + (i - 2) * 12), wy = cy + 4 + (i === 1 || i === 2 ? -2 : 0); B.line(wx, wy, wx, wy - 6, 2, 0x1a0c10ff); flame(B, wx, wy - 6, 0.8, t, i); }
    const L = 6 + 26 * (ph === 3 ? wick : 1), big = ph === 3 ? 1.5 + (1 - wick) * 1.6 : 1.3, low = ph === 3 && wick < 0.15;
    B.line(x, cy, x, cy - L, 3, 0x1a0c10ff); B.line(x + 1, cy, x + 1, cy - L, 1, 0x5e3a3cff);
    flame(B, x, cy - L, big, t, 9, low && (t * 8 | 0) % 2 ? 0xff3a2a : FIRE);
    if (st & 1) { const p = (t * 3) % 1; B.circ(x, cy - L - 6, 10 + 20 * p, rgba(HOT, 200 * (1 - p)), 2); } // casting: the crown pulses
    // wax keeps dripping off her (deterministic by time slot)
    for (let i = 0; i < 6; i++) {
      const per = 1.3 + i * 0.17, s = Math.floor(t / per + i * 0.37), u = (t / per + i * 0.37) - s, dx = (hsh(s * 31 + i) - 0.5) * 220;
      const y0 = y + 10 + Math.abs(dx) * 0.12, yy = y0 + u * u * 70;
      if (u < 0.85) B.rect(Math.round(x + dx), Math.round(yy), 2, 3, rgba(WAXC, 230));
    }
    return true;
  };
  // Core foe: the body zone draws her; this only flashes the ward on a blocked hit.
  ED.BossFx.wickmother = { draw: () => true };

  // ---------- hands ----------
  // e.st pose: 0 hover (open), 1 raised (fist), 2 flat (slammed), 3 sweep (side, dragging), 4 clap (side), 6 regrow (rising open hand). e.face -1 = the left hand (mirrored).
  ED.BossFx.wmhand = {
    draw(B, e, t) {
      const A = atlas(); if (!A) return false;
      const st = e.st | 0, o = reset(), bob = Math.sin(t * 2.2 + e.id) * 2;
      o.flip = e.face < 0;
      if (hit(e)) o.flash = 0.45;
      let id = 'boss.wmhand.idle', lift = 16 + bob, sh = 1;
      if (st === 1) { const k = Math.min(1, (e.stT || 0) / 0.35); id = 'boss.wmhand.fist'; lift = 18 + 30 * k + bob * 0.5; sh = 0.75; o.tint = (t * 10 | 0) % 2 ? 0xffc0a0 : 0; }
      else if (st === 2) { id = 'boss.wmhand.flat'; lift = 0; sh = 1.3; }
      else if (st === 3 || st === 4) { id = 'boss.wmhand.side'; lift = 8; sh = 0.9; if (st === 3) o.flip = e.face > 0; }
      else if (st === 6) { const k = Math.min(1, (e.stT || 0) / 0.8); o.sy = S * (0.3 + 0.7 * k); lift = 4 + 12 * k; o.alpha = 0.5 + 0.5 * k; }
      B.shadow(e.x, e.y + 6, e.r * sh);
      if (st === 3) for (let i = 1; i <= 3; i++) B.line(e.x - e.face * (i * 14), e.y - 10, e.x - e.face * (i * 14 + 18), e.y - 10, 4 - i, rgba(WAXC, 120 - i * 30)); // drag streaks
      B.spr(id, 0, e.x, e.y + 20 - lift, o);
      if (e.hpQ < 255) { const w = 40; B.rect(e.x - w / 2, e.y + 14, w, 3, 0x000000aa); B.rect(e.x - w / 2, e.y + 14, w * e.hpQ / 255, 3, 0xffc94aff); }
      return true;
    },
  };

  // ---------- zones ----------
  // Sconce: iron stand and candle; unlit: a progress arc fills while a hero stands in it (z.w eighths); lit: flame and a warm light pool.
  ZF.wmsconce = (B, z, t) => {
    const lit = z.w >= 1, p = 0.5 + 0.5 * Math.sin(t * 6 + z.id);
    if (lit) { B.circ(z.x, z.y, 64 + 4 * p, rgba(FIRE, 34), 0); B.circ(z.x, z.y, 38 + 3 * p, rgba(HOT, 40), 0); }
    else { B.circ(z.x, z.y, z.r + 4, rgba(0x7fe39a, 60 + 60 * p), 2); if (z.w > 0) B.cone(z.x, z.y, z.r + 2, -PI / 2 + PI * z.w, TAU * z.w, rgba(HOT, 150), 0); }
    const A = atlas(); if (A) { const o = reset(); B.spr('boss.wickmother.sconce', 0, z.x, z.y + 12, o); }
    if (lit) flame(B, z.x, z.y + 12 - 52, 1.2, t, z.id); else B.circ(z.x, z.y - 40, 1.5, rgba(0x8a8a8a, 160 + 60 * p), 0);
    return true;
  };
  // Broken hand: a melted puddle that glows as it reforms.
  ZF.wmlimp = (B, z, t) => {
    const A = atlas(); if (!A) return true;
    const o = reset(); o.flip = z.w < 0; o.tint = 0xb08a80;
    B.spr('boss.wmhand.limp', 0, z.x, z.y + 14, o);
    const p = 0.5 + 0.5 * Math.sin(t * 3 + z.id); B.circ(z.x, z.y + 2, 6 + 3 * p, rgba(FIRE, 70 * p), 0);
    return true;
  };
  // Melt band: molten wax creeping in from the side and bottom walls (z: room centre, r = half width, w = inset + 1000 x half height).
  ZF.wmmelt = (B, z, t) => {
    const m = z.w % 1000, hh = Math.floor(z.w / 1000), hw = z.r; if (m <= 0) return true;
    const l = z.x - hw, r = z.x + hw, tp = z.y - hh, bt = z.y + hh, p = 0.5 + 0.5 * Math.sin(t * 4), col = rgba(0x8a2a12, 170), hot = rgba(FIRE, 150 + 80 * p);
    B.rect(l, tp, m, bt - tp, col); B.rect(r - m, tp, m, bt - tp, col); B.rect(l + m, bt - m, r - l - 2 * m, m, col);
    B.line(l + m, tp, l + m, bt - m, 2, hot); B.line(r - m, tp, r - m, bt - m, 2, hot); B.line(l + m, bt - m, r - m, bt - m, 2, hot);
    for (let i = 0; i < 9; i++) { const u = hsh(i * 7 + (t * 2 | 0)), side = i % 3, k = ((t * 0.7 + i * 0.13) % 1); const bx = side < 2 ? (side ? r - m * k : l + m * k) : l + m + u * (r - l - 2 * m), by = side < 2 ? tp + u * (bt - tp - m) : bt - m * k; B.circ(bx, by, 2 + 2 * (1 - k), rgba(HOT, 180 * (1 - k)), 0); }
    return true;
  };
  // Wax pool: pale wax spreading on the floor (slows).
  ZF.wmwax = (B, z, t) => { const k = Math.min(1, z.t / 0.25, (z.dur - z.t) / 0.6); B.circ(z.x, z.y, z.r * k, rgba(WAXD, 150), 0); B.circ(z.x - 3, z.y - 2, z.r * 0.6 * k, rgba(WAXC, 120), 0); B.circ(z.x, z.y, z.r * k, rgba(0x5e3a3c, 200), 1); return true; };
  // Shock ring: a low wave of wax.
  ZF.wmshock = (B, z) => { const k = 1 - z.t / (z.dur || 1); B.circ(z.x, z.y, z.r, rgba(WAXC, 220 * k + 30), 4); B.circ(z.x, z.y, z.r - 4, rgba(0xfff1d6, 160 * k), 1); return true; };
  // Sweep palm hazard: the hand draws itself.
  ZF.wmsweep = () => true;
  // Tide wall: a band of rolling wax with a bright crest (a horizontal line zone).
  ZF.wmtide = (B, z, t) => {
    const ex = z.x + z.len, p = 0.5 + 0.5 * Math.sin(t * 9 + z.id);
    B.rect(z.x, z.y - z.w / 2, z.len, z.w, rgba(WAXD, 230)); B.rect(z.x, z.y - z.w / 2, z.len, 4, rgba(WAXC, 255)); B.line(z.x, z.y + z.w / 2, ex, z.y + z.w / 2, 2, rgba(0x5e3a3c, 255));
    for (let x = z.x + 6; x < ex - 4; x += 14) B.circ(x + 4 * p, z.y - z.w / 2 + 1, 3, rgba(0xfff1d6, 200), 0);
    return true;
  };
  // Flood: the warning keeps the default telegraph; the flood itself fills the room with fire.
  ZF.wmflood = (B, z, t) => { if (z.warn) return false; const p = 0.5 + 0.5 * Math.sin(t * 8); B.circ(z.x, z.y, z.r, rgba(FIRE, 150 + 60 * p), 0); return true; };
  // Falling drip: a droplet drops onto the warned spot.
  ZF.wmdrip = (B, z) => { const k = Math.min(1, z.t / (z.dur || 1)); B.rect(Math.round(z.x) - 1, Math.round(z.y - 120 * (1 - k)) - 4, 3, 5, rgba(WAXC, 230)); return false; };

  // Flame bolt from the wick crown.
  ED.WeaponFx.wmflame = {
    proj(B, pr, t) {
      const c = Math.cos(pr.a), s = Math.sin(pr.a), q = 1 + 0.2 * Math.sin(t * 24 + pr.id);
      B.line(pr.x - c * 10, pr.y - s * 10, pr.x, pr.y, pr.r, rgba(FIRE, 120));
      B.circ(pr.x, pr.y, (pr.r + 2) * q, rgba(FIRE, 220), 0); B.circ(pr.x, pr.y, pr.r * 0.6, rgba(HOT, 255), 0); B.circ(pr.x - c, pr.y - s, pr.r * 0.3, 0xffffffff, 0);
      return true;
    },
  };

  // ---------- events ----------
  const F = ED.FX;
  if (!F) return;
  const handle = F.handle;
  F.handle = (ev, ctx) => {
    handle(ev, ctx);
    if (ev.t === 'die' && ev.boss && ED.FOE_IDS[ev.k] === 'wickmother') {
      for (let i = 0; i < 6; i++) F.ring(ev.x, ev.y - 20, 60 + i * 70, rgba(i % 2 ? 0xffffff : FIRE, 255), 0.5 + i * 0.15);
      F.puff(ev.x, ev.y - 30, 64, rgba(WAXC, 255), 200); F.puff(ev.x, ev.y - 20, 32, rgba(HOT, 255), 140); F.addShake(12, 0);
      return;
    }
    if (ev.t === 'boom' && ev.look === 'wmlimp') { F.puff(ev.x, ev.y - 10, 24, rgba(WAXC, 255), 110); F.addShake(3, 0); return; }
    if (ev.t !== 'boss' || ev.id !== 'wickmother') return;
    const p = ev.phase;
    if (p === 2) F.banner('SNUFFING', 0xffb06a, 3, { big: true, sub: 'LIGHT ALL FOUR SCONCES AT ONCE', subCol: 0xfff1d6, k: 3, band: true });
    else if (p === 3) F.banner('BURN-DOWN', 0xff6a3a, 3, { big: true, sub: 'SLAY HER BEFORE THE WICK BURNS OUT', subCol: 0xfff1d6, k: 3, band: true });
    else if (p === 'kneel') { F.banner('SHE KNEELS: STRIKE THE HEART', 0xffd27a, 2.4, { k: 2 }); F.addShake(6, 0); }
    else if (p === 'wick') { F.banner('THE WICK IS ALMOST GONE', 0xff3a2a, 2.6, { k: 3 }); F.screen(0xff302000, 0.35, 0.8); }
    else if (p === 'flood') { F.screen(0xff6a2a00, 0.7, 2.5); F.addShake(10, 0); }
    else if (p === 'snuff') F.addShake(3, 0);
  };
})(globalThis.ED || (globalThis.ED = {}));
