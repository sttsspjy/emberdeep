// Client draw hooks for bosses king, hollow, cyclops, samurai: ED.BossFx (body: state anims with art fallbacks, wind-up ring, enrage aura, Hollow King crown, Cyclops eye glow),
// ED.SkillFx by zone look (beams, whirlpool, stomp wave, crown shards, summon / blink / starfall / iaido marks), ED.WeaponFx by shot look (crown, sword wave, water orb).
// Sim tags these zones and shots with wid = look (src/sim/boss-king.js libB). Also wraps ED.FX.handle / draw for boss death bursts (death anim corpse), phase flashes, dash ghosts and blink trails.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const reset = () => { O.flip = false; O.flash = 0; O.alpha = 1; O.rot = 0; O.sx = 1; O.sy = 1; O.tint = 0; O.add = false; return O; };
  const rgba = (col, a) => ((col << 8) | (a & 255)) >>> 0;

  // Per boss: atlas looks in preference order (a missing anim falls through to the next look), anim names per state, accent colour (0xRRGGBB).
  const CFG = {
    king: { looks: ['boss.drownedking'], idle: ['idle'], walk: ['walk', 'idle'], wind: ['attack1', 'idle'], act: ['attack2', 'attack3', 'idle'], col: 0x5ab8ff },
    hollow: { looks: ['boss.hollowking'], idle: ['idle'], walk: ['walk', 'idle'], wind: ['attack', 'idle'], act: ['attack', 'idle'], col: 0xc58aff, crown: true },
    cyclops: { looks: ['boss.cyclops', 'boss.bonewarden'], idle: ['idle'], walk: ['walk', 'idle'], wind: ['attack', 'charge', 'idle'], act: ['attack', 'walk', 'idle'], col: 0xff6a3a, eye: true },
    samurai: { looks: ['boss.samurai', 'boss.bonewarden'], idle: ['idle'], walk: ['walk', 'idle'], wind: ['charge', 'attack', 'idle'], act: ['attack', 'walk', 'idle'], col: 0x9fdcff },
  };
  // Anim ids per boss and state from the first look that has an idle or walk anim (states missing there fall back to its idle; death may be null). Cached once the atlas is up.
  const STATES = ['idle', 'walk', 'wind', 'act'];
  const memo = {};
  const anims = (bid) => {
    let r = memo[bid];
    if (r) return r;
    const A = ED.Atlas, cfg = CFG[bid];
    const look = cfg.looks.find(l => A.has(l + '.idle') || A.has(l + '.walk'));
    r = { look: look || null, death: null };
    if (look) {
      const base = A.has(look + '.idle') ? look + '.idle' : look + '.walk';
      for (const st of STATES) { const n = cfg[st].find(x => A.has(look + '.' + x)); r[st] = n ? look + '.' + n : base; }
      if (A.has(look + '.death')) r.death = look + '.death';
    }
    if (A.ok) memo[bid] = r;
    return r;
  };

  // Per boss foe id: last position / state for movement, state-local anim time, dash ghosts and blink trails.
  const track = new Map();
  const ghosts = [], trails = [], corpses = [];
  let nowT = 0;
  const tr = (e, t) => {
    let m = track.get(e.id);
    if (!m) { m = { x: e.x, y: e.y, st: e.st, st0: t, t, moving: false, face: e.face, gT: 0 }; track.set(e.id, m); }
    const dt = Math.max(1e-3, t - m.t), d = Math.hypot(e.x - m.x, e.y - m.y);
    if (t !== m.t) {
      m.moving = d > 0.15;
      if (d > 48) { if (trails.length < 8) trails.push({ x0: m.x, y0: m.y, x1: e.x, y1: e.y, life: 0.35, max: 0.35, col: CFG[ED.FOE_IDS[e.k]].col }); ED.FX.puff(m.x, m.y - 20, 10, 0xc58affff, 60); ED.FX.puff(e.x, e.y - 20, 10, 0xffffffff, 70); }
      else if (d / dt > 420 && t - m.gT > 0.03) { m.gT = t; m.ghost = true; }
    }
    if (e.st !== m.st) { m.st = e.st; m.st0 = t; }
    m.x = e.x; m.y = e.y; m.t = t; m.face = e.face; m.seen = t;
    return m;
  };

  // Body: state anim (wind-up e.st 1 / action 2 run from their start; idle / walk loop), partial hit flash, wind-up ring + flicker, enrage aura.
  const drawBoss = (B, e, t) => {
    const A = ED.Atlas, bid = ED.FOE_IDS[e.k], cfg = CFG[bid];
    if (!A.ok || !cfg) return false;
    const m = tr(e, t), st = e.st === 1 ? 'wind' : e.st === 2 ? 'act' : m.moving ? 'walk' : 'idle';
    const id = anims(bid)[st];
    if (!id) return false;
    const fi = A.frameAt(id, st === 'wind' || st === 'act' ? t - m.st0 : t + e.id * 0.37), o = reset();
    o.flip = e.face < 0; o.sx = o.sy = e.scale || 1;
    o.flash = e.flash > 0 ? 0.3 : 0;
    if (e.st === 1 && Math.floor(t * 12) % 2) o.flash = Math.max(o.flash, 0.25);
    if (e.enraged) { o.tint = 0xff7070; const p = 0.5 + 0.5 * Math.sin(t * 10); B.circ(e.x, e.y - 2, e.r + 10 + 4 * p, rgba(0xff3a2a, 60 + 60 * p), 0); }
    B.shadow(e.x, e.y, e.r);
    if (e.st === 1) { const p = (t - m.st0) * 3 % 1; B.circ(e.x, e.y, e.r + 6 + 14 * p, rgba(cfg.col, 220 * (1 - p)), 2); }
    if (m.ghost) { m.ghost = false; if (ghosts.length < 16) ghosts.push({ id, fi, x: e.x, y: e.y, flip: o.flip, sc: o.sx, life: 0.22, max: 0.22, col: cfg.col }); }
    if (!B.spr(id, fi, e.x, e.y, o)) return false;
    const an = A.anim(id), sg = o.flip ? -1 : 1;
    if (cfg.crown && A.has('boss.hollowking.crown') && !crownOut()) {
      const cr = an.anchors && an.anchors.crown, q = cr ? cr[Math.min(fi, cr.length - 1)] : null;
      if (q) { const c = reset(); c.flip = o.flip; c.flash = o.flash; B.spr('boss.hollowking.crown', 0, e.x + (q[0] - an.ax) * sg * (e.scale || 1), e.y + (q[1] - an.ay) * (e.scale || 1) + 1, c); }
    }
    if (cfg.eye && e.st === 1) {
      const ey = an.anchors && an.anchors.eye, q = ey ? ey[Math.min(fi, ey.length - 1)] : [an.ax, an.ay - 34], p = 0.5 + 0.5 * Math.sin(t * 30);
      const x = e.x + (q[0] - an.ax) * sg, y = e.y + (q[1] - an.ay);
      B.circ(x, y, 5 + 3 * p, 0xff3a2a90, 0); B.circ(x, y, 2.5, 0xffe6c0ff, 0);
    }
    return true;
  };
  // A thrown crown is in the air (the head shows none).
  const crownOut = () => { const v = ED.Game && ED.Game.view; if (!v) return false; for (const pr of v.projs) if (!pr.dead && pr.k === 'crown') return true; return false; };
  for (const id of Object.keys(CFG)) ED.BossFx[id] = { draw: drawBoss };

  // ---------- zones ----------
  // Beam fade in / out factor of a live zone.
  const fade = (z) => Math.max(0, Math.min(1, z.t / 0.12, (z.dur - z.t) / 0.15));
  const beam = (outer, mid, core) => (B, z, t) => {
    const k = fade(z), wob = 1 + 0.15 * Math.sin(t * 40 + z.id), c = Math.cos(z.a), s = Math.sin(z.a), ex = z.x + c * z.len, ey = z.y + s * z.len;
    B.line(z.x, z.y, ex, ey, (z.w + 12) * k * wob, rgba(outer, 70));
    B.line(z.x, z.y, ex, ey, z.w * k, rgba(mid, 190));
    B.line(z.x, z.y, ex, ey, Math.max(1, z.w * 0.35 * k), rgba(core, 255));
    B.circ(z.x, z.y, z.w * 0.8 * k * wob, rgba(core, 230), 0);
    B.circ(ex, ey, z.w * 0.9 * k * wob, rgba(mid, 200), 0);
    if (Math.random() < 0.5) ED.FX.part(ex, ey, (Math.random() - 0.5) * 80 - c * 40, (Math.random() - 0.5) * 80 - s * 40, 0.3, rgba(core, 255), 2);
    return true;
  };
  ED.SkillFx.tidebeam = { zone: beam(0x2a7fff, 0x5ac8ff, 0xeaffff) };
  ED.SkillFx.eyelaser = { zone: beam(0xff2a1a, 0xff7a3a, 0xfff0c0) };
  ED.SkillFx.whirlpool = {
    zone(B, z, t) {
      const k = Math.min(1, z.t / 0.6), K = ED.Bosses.KING, core = K ? K.POOL.core : 38, r = z.r * k;
      B.circ(z.x, z.y, r, 0x1a4a9f38, 0); B.circ(z.x, z.y, r, 0x6ab8ffb0, 1.5);
      for (let i = 0; i < 5; i++) {
        const base = -t * 2.4 + i * TAU / 5;
        for (let j = 0; j < 6; j++) {
          const r0 = r * (1 - j / 6), r1 = r * (1 - (j + 1) / 6), a0 = base + j * 0.45, a1 = base + (j + 1) * 0.45;
          B.line(z.x + Math.cos(a0) * r0, z.y + Math.sin(a0) * r0, z.x + Math.cos(a1) * r1, z.y + Math.sin(a1) * r1, 2, rgba(0x9fe8ff, 60 + j * 25));
        }
      }
      B.circ(z.x, z.y, core * k, 0x0a1a40a0, 0); B.circ(z.x, z.y, core * k, rgba(0xff6a5a, 150 + 80 * Math.sin(t * 8)), 1.5);
      return true;
    },
  };
  ED.SkillFx.stompwave = {
    zone(B, z) {
      const k = Math.min(1, z.t / z.dur);
      B.circ(z.x, z.y, z.r, rgba(0xffb06a, 230 * (1 - k) + 25), 2 + 6 * (1 - k));
      B.circ(z.x, z.y, Math.max(1, z.r - 10), rgba(0xc89a6a, 90 * (1 - k)), 3);
      return true;
    },
  };
  ED.SkillFx.crownshard = {
    zone(B, z, t) {
      const H = ED.Bosses.HOLLOW, armed = z.t >= (H ? H.SHARDS.arm : 1), a = t * 9 + z.id, L = 9;
      if (!armed && Math.floor(t * 14) % 2) return true;
      B.circ(z.x, z.y, z.r + 5, armed ? 0xc58aff60 : 0xffffff40, 0);
      for (let i = 0; i < 2; i++) { const b = a + i * Math.PI / 2; B.line(z.x - Math.cos(b) * L, z.y - Math.sin(b) * L, z.x + Math.cos(b) * L, z.y + Math.sin(b) * L, 2, armed ? 0xffe6ffff : 0xffffffb0); }
      B.circ(z.x, z.y, 3.5, armed ? 0xffd36bff : 0xffffffff, 0);
      return true;
    },
  };
  ED.SkillFx.summon = {
    zone(B, z, t) {
      const k = Math.min(1, z.t / z.dur), p = 0.5 + 0.5 * Math.sin(t * 16);
      B.circ(z.x, z.y, z.r * (1.6 - 0.6 * k), rgba(0x7fe39a, 120 + 100 * p), 1.5);
      B.circ(z.x, z.y, z.r * k, rgba(0x7fe39a, 90), 0);
      return true;
    },
  };
  ED.SkillFx.blinkmark = {
    zone(B, z, t) {
      const k = Math.min(1, z.t / z.dur);
      for (let i = 0; i < 3; i++) { const a = t * 6 + i * TAU / 3, r = z.r * (1.4 - k * 0.6); B.line(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, z.x + Math.cos(a + 1.2) * r * 0.5, z.y + Math.sin(a + 1.2) * r * 0.5, 2, 0xc58affd0); }
      return false;
    },
  };
  ED.SkillFx.starfall = {
    zone(B, z) {
      const k = Math.min(1, z.t / z.dur), off = (1 - k) * 140, x = z.x + off * 0.35, y = z.y - off;
      B.line(x + 14, y - 40, x, y, 3, rgba(0xc58aff, 140 * k)); B.circ(x, y, 7, 0xc58aff80, 0); B.circ(x, y, 3.5, 0xffffffff, 0);
      return false;
    },
  };
  ED.SkillFx.iaido = {
    zone(B, z, t) {
      const k = Math.min(1, z.t / z.dur);
      if (k > 0.6 && Math.floor(t * 20) % 2) B.line(z.x, z.y, z.x + Math.cos(z.a) * z.len, z.y + Math.sin(z.a) * z.len, 1, 0xffffffe0);
      return false;
    },
  };

  // ---------- shots ----------
  ED.WeaponFx.crown = {
    proj(B, pr, t) {
      B.circ(pr.x, pr.y, pr.r + 4, 0xffd36b50, 0);
      const o = reset(); o.rot = t * 14; o.sx = o.sy = 1.6;
      if (!B.spr('boss.hollowking.crown', 0, pr.x, pr.y + 4, o)) B.circ(pr.x, pr.y, pr.r, 0xffd36bff, 0);
      return true;
    },
  };
  ED.WeaponFx.swordwave = {
    proj(B, pr) {
      const c = Math.cos(pr.a), s = Math.sin(pr.a), cx = pr.x - c * 8, cy = pr.y - s * 8;
      B.circ(pr.x, pr.y, pr.r + 3, 0x9fdcff40, 0);
      for (let i = -3; i <= 3; i++) { const a = pr.a + i * 0.28; B.circ(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 3.2 - Math.abs(i) * 0.5, i ? 0xbfe8ffe0 : 0xffffffff, 0); }
      return true;
    },
  };
  ED.WeaponFx.waterorb = {
    proj(B, pr) { B.circ(pr.x, pr.y, pr.r + 2, 0x2a7fff60, 0); B.circ(pr.x, pr.y, pr.r, 0x8fd8ffff, 0); B.circ(pr.x - 1, pr.y - 1, pr.r * 0.4, 0xffffffff, 0); return true; },
  };

  // ---------- events and the extra world layer ----------
  const F = ED.FX;
  if (!F) return;
  const handle = F.handle, draw = F.draw;
  const viewFoe = (id) => { const v = ED.Game && ED.Game.view; if (v) for (const e of v.foes) if (e.id === id && !e.dead) return e; return null; };
  F.handle = (ev, ctx) => {
    handle(ev, ctx);
    if (ev.t === 'die' && ev.boss) {
      const bid = ED.FOE_IDS[ev.k], cfg = CFG[bid]; if (!cfg) return;
      const m = track.get(ev.id), id = anims(bid).death;
      if (id && corpses.length < 4) corpses.push({ id, x: ev.x, y: ev.y, flip: m ? m.face < 0 : false, t0: nowT });
      for (let i = 0; i < 4; i++) F.ring(ev.x, ev.y - 16, 30 + i * 45, rgba(i % 2 ? 0xffffff : cfg.col, 255), 0.35 + i * 0.15);
      F.puff(ev.x, ev.y - 20, 40, rgba(cfg.col, 255), 160); F.puff(ev.x, ev.y - 20, 20, 0xffffffff, 110);
      F.addShake(9, 0);
      track.delete(ev.id);
    } else if (ev.t === 'boss' && CFG[ev.id] && (ev.phase === 'enrage' || ev.phase > 1)) {
      const e = viewFoe(ev.fid); if (!e) return;
      const col = ev.phase === 'enrage' ? 0xff3a2a : CFG[ev.id].col;
      for (let i = 0; i < 3; i++) F.ring(e.x, e.y - 16, 40 + i * 50, rgba(col, 255), 0.4 + i * 0.15);
      F.puff(e.x, e.y - 20, 24, rgba(col, 255), 120);
      F.addShake(ev.phase === 'enrage' ? 7 : 4, 0);
    }
  };
  F.draw = (B, t) => {
    draw(B, t);
    const dt = Math.max(0, Math.min(0.1, t - nowT)); nowT = t;
    const A = ED.Atlas;
    let n = 0;
    for (let i = 0; i < ghosts.length; i++) { const g = ghosts[i]; g.life -= dt; if (g.life <= 0) continue; const o = reset(); o.flip = g.flip; o.sx = o.sy = g.sc; o.alpha = 0.5 * g.life / g.max; o.flash = 1; B.spr(g.id, g.fi, g.x, g.y, o); ghosts[n++] = g; }
    ghosts.length = n; n = 0;
    for (let i = 0; i < trails.length; i++) { const s = trails[i]; s.life -= dt; if (s.life <= 0) continue; const k = s.life / s.max; B.line(s.x0, s.y0 - 20, s.x1, s.y1 - 20, 6 * k, rgba(s.col, 200 * k)); B.line(s.x0, s.y0 - 20, s.x1, s.y1 - 20, 2 * k, rgba(0xffffff, 255 * k)); trails[n++] = s; }
    trails.length = n; n = 0;
    for (let i = 0; i < corpses.length; i++) {
      const c = corpses[i], age = t - c.t0; if (age > 2.2 || age < 0) continue;
      const o = reset(); o.flip = c.flip; o.alpha = Math.min(1, (2.2 - age) / 0.8);
      if (A.ok) B.spr(c.id, A.frameAt(c.id, age), c.x, c.y, o);
      corpses[n++] = c;
    }
    corpses.length = n;
    if (track.size > 8) for (const [k, m] of track) if (t - m.seen > 3 || t < m.seen) track.delete(k);
  };
})(globalThis.ED || (globalThis.ED = {}));
