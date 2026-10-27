// Client draw hooks for bosses weaver and wickeater: ED.BossFx bodies (scaled foe art plus a procedural aura), ED.ZoneFx by zone look (rift, riftgate, strand, maw, inhale, darkring),
// ED.WeaponFx by shot look (voidbolt, voidorb), and death bursts / phase flashes wrapped around ED.FX.handle. Only render-visible fields are read (snapshot-safe).
(function (ED) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const ZF = ED.ZoneFx = ED.ZoneFx || {};
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const reset = () => { O.flip = false; O.flash = 0; O.alpha = 1; O.rot = 0; O.sx = 1; O.sy = 1; O.tint = 0; O.add = false; return O; };
  const rgba = (rgb, a) => (((rgb & 0xffffff) * 256) + Math.max(0, Math.min(255, Math.round(a)))) >>> 0;
  const VOID = 0xc58aff, EMBER = 0xff8a3d;
  // Hit flash through the shared throttle (ED.Actors.hitFlash); raw e.flash when actors.js is absent (headless checks).
  const hit = (e) => (ED.Actors && ED.Actors.hitFlash ? ED.Actors.hitFlash(e) : e.flash > 0);
  // Angle from e to its nearest living hero in the view (facing when none).
  const toHero = (e) => {
    const v = ED.Game && ED.Game.view, hs = v ? v.heroes : null;
    let best = null, bd = Infinity;
    if (hs) for (const p of hs) { if (p.dead || p.downed) continue; const d = (p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y); if (d < bd) { bd = d; best = p; } }
    return best ? Math.atan2(best.y - e.y, best.x - e.x) : (e.face < 0 ? PI : 0);
  };
  // Per boss foe id: last position, time it last moved, last seen; a jump over 48 px (blink) leaves void puffs at both ends.
  const track = new Map();
  const tr = (e, t) => {
    let m = track.get(e.id);
    if (!m) { m = { x: e.x, y: e.y, mv: -1, seen: t }; track.set(e.id, m); }
    const d = Math.hypot(e.x - m.x, e.y - m.y);
    if (d > 48 && ED.FX) { ED.FX.puff(m.x, m.y - 20, 14, rgba(VOID, 255), 80); ED.FX.puff(e.x, e.y - 20, 14, 0xffffffff, 90); }
    if (d > 0.15) m.mv = t;
    m.x = e.x; m.y = e.y; m.seen = t;
    if (track.size > 8) for (const [k, q] of track) if (t - q.seen > 3 || t < q.seen) track.delete(k);
    return m;
  };
  // Sprite height (px, unscaled) of anim id above its anchor.
  const heightOf = (id, dflt) => { const r = ED.Atlas.anim(id); return r ? Math.max(8, r.ay - (typeof r.anchors.top === 'number' ? r.anchors.top : 0)) : dflt; };
  const dir4 = (a) => { const c = Math.cos(a), s = Math.sin(a); return Math.abs(c) >= Math.abs(s) ? (c >= 0 ? 'r' : 'l') : (s >= 0 ? 'd' : 'u'); };
  // Wind-up ring under the feet and an enrage pulse.
  const cues = (B, e, t, col) => {
    if (e.st === 1) { const p = (t * 3) % 1; B.circ(e.x, e.y, e.r + 6 + 14 * p, rgba(col, 220 * (1 - p)), 2); }
    if (e.enraged) { const p = 0.5 + 0.5 * Math.sin(t * 10); B.circ(e.x, e.y - 2, e.r + 10 + 4 * p, rgba(0xff3a2a, 60 + 60 * p), 0); }
  };

  // ---------- Rift Weaver ----------
  ED.BossFx.weaver = {
    draw(B, e, t) {
      const A = ED.Atlas;
      if (!A || !A.ok) return false;
      const m = tr(e, t), cast = e.st === 1 || e.st === 2, a = cast ? toHero(e) : (e.face < 0 ? PI : 0), d = cast ? dir4(a) : (e.face < 0 ? 'l' : 'r');
      const cid = 'foe.riftcaller.cast.' + d, wid = 'foe.riftcaller.walk.' + d, id = cast && A.has(cid) ? cid : wid;
      if (!A.has(id)) return false;
      const sc = e.scale || 1, h = heightOf(id, 16) * sc, cy = e.y - h * 0.55, o = reset();
      B.circ(e.x, e.y, e.r * 1.7, rgba(0x1a0630, 110), 0);
      B.shadow(e.x, e.y, e.r);
      cues(B, e, t, VOID);
      // three rift shards orbit the body; they spin fast and flare while he casts
      const spin = t * (cast ? 5 : 1.6), R = e.r * 1.5 + (cast ? 4 * Math.sin(t * 20) : 0);
      for (let i = 0; i < 3; i++) {
        const b = spin + i * TAU / 3, x = e.x + Math.cos(b) * R, y = cy + Math.sin(b) * R * 0.45, L = cast ? 8 : 6;
        if (Math.sin(b) < 0) { B.line(x, y - L, x, y + L, 3, rgba(VOID, 200)); B.line(x - L * 0.5, y, x + L * 0.5, y, 2, 0xffe6ffd0); }
      }
      o.sx = o.sy = sc; o.flash = hit(e) ? 0.45 : (e.st === 1 && Math.floor(t * 12) % 2 ? 0.3 : 0);
      B.spr(id, cast ? 0 : (t - m.mv < 0.25 ? A.frameAt(id, t) : 0), e.x, e.y, o);
      for (let i = 0; i < 3; i++) {
        const b = spin + i * TAU / 3, x = e.x + Math.cos(b) * R, y = cy + Math.sin(b) * R * 0.45, L = cast ? 8 : 6;
        if (Math.sin(b) >= 0) { B.line(x, y - L, x, y + L, 3, rgba(VOID, 230)); B.line(x - L * 0.5, y, x + L * 0.5, y, 2, 0xffffffff); }
      }
      if (cast) { const p = 0.5 + 0.5 * Math.sin(t * 24); B.circ(e.x + Math.cos(a) * e.r * 0.6, e.y - h * 0.6, 4 + 3 * p, rgba(VOID, 200), 0); B.circ(e.x + Math.cos(a) * e.r * 0.6, e.y - h * 0.6, 2, 0xffffffff, 0); }
      return true;
    },
  };
  // Rift warning: a void swirl tightens over the default telegraph.
  ZF.rift = (B, z, t) => {
    const k = Math.min(1, z.t / (z.dur || 1)), r = z.r * (1.5 - 0.5 * k);
    for (let i = 0; i < 3; i++) { const a = t * 5 + i * TAU / 3; B.line(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, z.x + Math.cos(a + 1.4) * r * 0.45, z.y + Math.sin(a + 1.4) * r * 0.45, 2, rgba(VOID, 140 + 100 * k)); }
    return false;
  };
  // Live gate: an opening void disc with a turning spiral and a bright core; it fades out over its last 0.3 s.
  ZF.riftgate = (B, z, t) => {
    const k = Math.max(0, Math.min(1, z.t / 0.2, (z.dur - z.t) / 0.3)), r = z.r * k;
    B.circ(z.x, z.y, r + 6, rgba(0x6a2aff, 50), 0); B.circ(z.x, z.y, r, 0x12041ef0, 0); B.circ(z.x, z.y, r, rgba(VOID, 230), 2);
    for (let i = 0; i < 4; i++) { const a = -t * 4 + i * TAU / 4; B.line(z.x + Math.cos(a) * r * 0.9, z.y + Math.sin(a) * r * 0.9, z.x + Math.cos(a + 1.1) * r * 0.3, z.y + Math.sin(a + 1.1) * r * 0.3, 2, rgba(0xe6c8ff, 170)); }
    B.circ(z.x, z.y, Math.max(1, r * 0.25), 0xffffffff, 0);
    return true;
  };
  // Strand: a humming void thread (fades in and out).
  ZF.strand = (B, z, t) => {
    const k = Math.max(0, Math.min(1, z.t / 0.15, (z.dur - z.t) / 0.4)), ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len, wob = 1 + 0.2 * Math.sin(t * 30 + z.id);
    B.line(z.x, z.y, ex, ey, (z.w + 8) * k * wob, rgba(0x8a3aff, 70));
    B.line(z.x, z.y, ex, ey, z.w * 0.5 * k, rgba(0xe6c8ff, 230));
    return true;
  };

  // ---------- Wick-Eater ----------
  const FLAMES = 5;
  ED.BossFx.wickeater = {
    draw(B, e, t) {
      const A = ED.Atlas;
      if (!A || !A.ok) return false;
      const m = tr(e, t), moving = t - m.mv < 0.25, id = moving && A.has('foe.horror.walk') ? 'foe.horror.walk' : 'foe.horror.idle';
      if (!A.has(id)) return false;
      const sc = e.scale || 1, h = heightOf(id, 28) * sc, a = toHero(e), o = reset(), p = 0.5 + 0.5 * Math.sin(t * 3 + e.id);
      // a pool of swallowed light under it
      B.circ(e.x, e.y, e.r * 2.3 + 6 * p, rgba(0x08020f, 120), 0); B.circ(e.x, e.y, e.r * 2.3 + 6 * p, rgba(0x6a3aa0, 80), 2);
      B.shadow(e.x, e.y, e.r * 1.1);
      cues(B, e, t, EMBER);
      o.sx = o.sy = sc; o.flip = (e.st ? Math.cos(a) : e.face) < 0;
      o.tint = e.enraged ? 0xff7060 : 0xb898ff;
      o.flash = hit(e) ? 0.45 : (e.st === 1 && Math.floor(t * 12) % 2 ? 0.3 : 0);
      B.spr(id, A.frameAt(id, t + e.id * 0.37), e.x, e.y, o);
      // the maw glows toward its target while it winds up and acts
      if (e.st === 1 || e.st === 2) {
        const q = 0.5 + 0.5 * Math.sin(t * 26), mx = e.x + Math.cos(a) * e.r * 0.8, my = e.y - h * 0.45 + Math.sin(a) * e.r * 0.4;
        B.circ(mx, my, 7 + 5 * q, rgba(EMBER, 150), 0); B.circ(mx, my, 3 + 2 * q, 0xfff0c0ff, 0);
      }
      // stolen wicks: a crown of flames over its head
      const hy = e.y - h - 4;
      for (let i = 0; i < FLAMES; i++) {
        const u = (i - (FLAMES - 1) / 2) / ((FLAMES - 1) / 2), fx = e.x + u * e.r * 0.9, fy = hy + u * u * 8, f = 0.5 + 0.5 * Math.sin(t * 13 + i * 2.1);
        const big = e.enraged ? 1.6 : 1, col = e.enraged ? 0xff3a2a : EMBER;
        B.circ(fx, fy - 3, (4 + 1.5 * f) * big, rgba(col, 130), 0);
        B.circ(fx, fy - 4 - f, (2 + f) * big, rgba(0xffe08a, 230), 0);
        B.circ(fx, fy - 2, 1.2 * big, 0xffffffff, 0);
      }
      return true;
    },
  };
  // Bite warning: fangs close in from the rim as the warning fills (the default telegraph draws under them).
  ZF.maw = (B, z) => {
    const k = Math.min(1, z.t / (z.dur || 1)), r = z.r, n = 10;
    for (let i = 0; i < n; i++) { const a = i * TAU / n, r0 = r, r1 = r * (1 - 0.55 * k); B.line(z.x + Math.cos(a) * r0, z.y + Math.sin(a) * r0, z.x + Math.cos(a) * r1, z.y + Math.sin(a) * r1, 3, rgba(0xfff0e0, 120 + 120 * k)); }
    return false;
  };
  // Inhale: a dark cone with motes streaming into the mouth.
  ZF.inhale = (B, z, t) => {
    B.cone(z.x, z.y, z.r, z.a, z.arc, 0x1a06304a, 0);
    for (let i = 0; i < 14; i++) {
      const h = ((i * 0.618 + z.id * 0.17) % 1) - 0.5, a = z.a + h * z.arc, q = 1 - ((t * 1.4 + i * 0.137) % 1), d = z.r * q, L = 10 + 14 * q;
      B.line(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, z.x + Math.cos(a) * Math.max(0, d - L), z.y + Math.sin(a) * Math.max(0, d - L), 2, rgba(i % 3 ? VOID : 0xffffff, 90 + 140 * (1 - q)));
    }
    B.circ(z.x, z.y, 10 + 3 * Math.sin(t * 30), rgba(0x08020f, 230), 0);
    return true;
  };
  // Closing dark: while still (r = r0) a pulsing outline with green gap markers; then a thick black band with a violet rim, open at the gaps (z.w gaps from z.a).
  const SEG = 64;
  ZF.darkring = (B, z, t) => {
    const W = ED.Bosses && ED.Bosses.WICK, D = W ? W.DARK : { r0: 300, band: 9, gap: 0.42 }, n = Math.max(1, Math.round(z.w || 3)), warn = z.r >= D.r0 - 0.5;
    const p = 0.5 + 0.5 * Math.sin(t * 16), r = z.r;
    for (let s = 0; s < SEG; s++) {
      const a0 = s * TAU / SEG, a1 = (s + 1) * TAU / SEG, am = (a0 + a1) / 2;
      let open = false;
      for (let i = 0; i < n && !open; i++) { let d = (am - z.a - i * TAU / n) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; open = Math.abs(d) <= D.gap; }
      if (open) continue;
      const x0 = z.x + Math.cos(a0) * r, y0 = z.y + Math.sin(a0) * r, x1 = z.x + Math.cos(a1) * r, y1 = z.y + Math.sin(a1) * r;
      if (warn) { if (s % 2) B.line(x0, y0, x1, y1, 2, rgba(VOID, 120 + 120 * p)); }
      else { B.line(x0, y0, x1, y1, D.band * 2 + 6, 0x0a0414e0); B.line(x0, y0, x1, y1, 2, rgba(VOID, 230)); }
    }
    for (let i = 0; i < n; i++) { const a = z.a + i * TAU / n, x = z.x + Math.cos(a) * r, y = z.y + Math.sin(a) * r; B.circ(x, y, warn ? 5 + 3 * p : 4, rgba(0x7fe39a, warn ? 200 : 140), warn ? 2 : 0); }
    return true;
  };

  // ---------- shots ----------
  ED.WeaponFx.voidbolt = {
    proj(B, pr) {
      const c = Math.cos(pr.a), s = Math.sin(pr.a);
      B.line(pr.x - c * 12, pr.y - s * 12, pr.x, pr.y, pr.r, rgba(0x8a3aff, 110));
      B.circ(pr.x, pr.y, pr.r + 3, rgba(0x8a3aff, 90), 0); B.circ(pr.x, pr.y, pr.r * 0.8, 0xe6c8ffff, 0); B.circ(pr.x, pr.y, pr.r * 0.35, 0xffffffff, 0);
      return true;
    },
  };
  ED.WeaponFx.voidorb = {
    proj(B, pr, t) {
      const q = 1 + 0.15 * Math.sin(t * 20 + pr.id);
      B.circ(pr.x, pr.y, (pr.r + 3) * q, 0x3a0a6a90, 0); B.circ(pr.x, pr.y, pr.r, 0xb070ffff, 0); B.circ(pr.x - 1, pr.y - 1, pr.r * 0.4, 0xffffffff, 0);
      return true;
    },
  };

  // ---------- events ----------
  const F = ED.FX;
  if (!F) return;
  const COL = { weaver: VOID, wickeater: EMBER };
  const handle = F.handle;
  const viewFoe = (id) => { const v = ED.Game && ED.Game.view; if (v) for (const e of v.foes) if (e.id === id && !e.dead) return e; return null; };
  F.handle = (ev, ctx) => {
    handle(ev, ctx);
    if (ev.t === 'die' && ev.boss) {
      const col = COL[ED.FOE_IDS[ev.k]]; if (!col) return;
      for (let i = 0; i < 5; i++) F.ring(ev.x, ev.y - 20, 40 + i * 55, rgba(i % 2 ? 0xffffff : col, 255), 0.4 + i * 0.15);
      F.puff(ev.x, ev.y - 24, 48, rgba(col, 255), 180); F.puff(ev.x, ev.y - 24, 24, 0xffffffff, 120);
      F.addShake(10, 0);
      track.delete(ev.id);
    } else if (ev.t === 'boss' && COL[ev.id] && (ev.phase === 'enrage' || ev.phase > 1)) {
      const e = viewFoe(ev.fid); if (!e) return;
      const col = ev.phase === 'enrage' ? 0xff3a2a : COL[ev.id];
      for (let i = 0; i < 3; i++) F.ring(e.x, e.y - 20, 50 + i * 60, rgba(col, 255), 0.45 + i * 0.15);
      F.puff(e.x, e.y - 24, 28, rgba(col, 255), 130);
      F.addShake(ev.phase === 'enrage' ? 7 : 4, 0);
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
