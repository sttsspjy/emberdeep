// Juice (client only). ED.FX.handle(ev, ctx) consumes World events (ARCHITECTURE §5); update(dt) once per frame (real time); draw(B, t) is the world FX layer, drawTop(B) the overlays.
// Everything is pooled and capped: particles, fx sprites, rings, flashes, slashes, chains, death pops, damage numbers, delayed bursts. Per-frame budgets scale bursts down when many foes die at once
// and with the on-screen crowd. Damage numbers merge per foe per 150 ms, at most 60 alive (oldest dropped), crits big and yellow, off when FX.numbers is false.
// Hit-stop (FX.hold, solo only; main.js skips sim steps while it runs) and screen shake (scaled down with the crowd, off when FX.shakeOn is false) only on skills, elite deaths and boss hits.
// Overlays: boss intro banner + letterbox, swarm / elite / phase / evolution banners, offscreen arrows to elites and bosses, level-up text, screen flashes, low-HP and hurt vignette.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;
  const F = ED.FX = { shake: 0, shakeOn: true, numbers: true, hold: 0, now: 0, sx: 0, sy: 0 };
  const P2D = 280; // Canvas2D particle budget: above it each particle's fixed eighth (p.q) decides whether it is drawn, so the kept subset is stable frame to frame
  let pq = 0;
  const MAXP = 700, MAXS = 72, MAXR = 48, MAXL = 24, MAXW = 24, MAXC = 16, MAXN = 60, MAXD = 64, MAXQ = 24;
  const aq = (k) => Math.max(0, Math.min(255, Math.round(k * 15) * 17)); // alpha quantised to 16 steps (keeps the Canvas2D colour-string cache small)
  const rgbaK = (col, k) => ((col & 0xffffff00) | aq(k)) >>> 0;
  const rnd = Math.random;

  // ---------------- pools ----------------
  // Pool: live objects in `a`, recycled through `free`; when full, get() reuses a live one (rotating index, roughly the oldest).
  function Pool(max) { this.a = []; this.free = []; this.max = max; this.rot = 0; }
  Pool.prototype.get = function () {
    const a = this.a;
    if (a.length >= this.max) { this.rot = (this.rot + 1) % a.length; return a[this.rot]; }
    const o = this.free.pop() || {};
    a.push(o);
    return o;
  };
  Pool.prototype.clear = function () { for (const o of this.a) this.free.push(o); this.a.length = 0; };
  // Ages every live object by dt (o.life -= dt) and compacts out the expired ones.
  Pool.prototype.age = function (dt) {
    const a = this.a; let n = 0;
    for (let i = 0; i < a.length; i++) { const o = a[i]; o.life -= dt; if (o.life > 0) a[n++] = o; else this.free.push(o); }
    a.length = n;
  };
  const parts = new Pool(MAXP), sprs = new Pool(MAXS), rings = new Pool(MAXR), flashes = new Pool(MAXL), slashes = new Pool(MAXW), chains = new Pool(MAXC), pops = new Pool(MAXD), later = new Pool(MAXQ);
  const nums = [], numFree = [];
  const POOLS = [parts, sprs, rings, flashes, slashes, chains, pops, later];
  const NAMES = ['parts', 'sprs', 'rings', 'flashes', 'slashes', 'chains', 'pops', 'later'];
  // Pool sizes for checks: { name: { live, total (live + free), max } }.
  F.counts = () => {
    const o = { nums: { live: nums.length, total: nums.length + numFree.length, max: MAXN } };
    POOLS.forEach((p, i) => { o[NAMES[i]] = { live: p.a.length, total: p.a.length + p.free.length, max: p.max }; });
    return o;
  };

  // per-frame budgets (reset in update)
  let dieFull = 0, diePop = 0, sparkN = 0, trailN = 0, pickN = 0, stopCd = 0, sweepT = 0;
  const BUD = { dieFull: 18, diePop: 56, spark: 10, trail: 24, pick: 6 };

  // ---------------- primitives ----------------
  // Particle: col 0xRRGGBB00, size px, grav px/s², drag per second factor (0..1 kept), add (additive glow when the backend supports it).
  F.part = (x, y, vx, vy, life, col, size, grav, drag) => {
    const p = parts.get(); p.q = pq = (pq + 1) & 7; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.col = col; p.size = size || 2; p.grav = grav === undefined ? 60 : grav; p.drag = drag === undefined ? 0.9 : drag;
  };
  // n particles bursting from (x, y) at speed sp (±40%), upward bias up.
  F.burst = (x, y, n, col, sp, life, size, up) => {
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, s = (sp || 40) * (0.6 + rnd() * 0.8); F.part(x, y, Math.cos(a) * s, Math.sin(a) * s - (up || 10), (life || 0.4) * (0.7 + rnd() * 0.6), col, size || 2); }
  };
  F.puff = (x, y, n, col, sp) => F.burst(x, y, n, col & 0xffffff00, sp, 0.45, 2, 10);
  // Atlas fx sprite played once at (x, y): scale sc, rotation rot, tint 0xRRGGBB, alpha.
  F.sprite = (id, x, y, sc, rot, tint, alpha, flip) => {
    const A = ED.Atlas, r = A.anim(id); if (!r) return;
    const s = sprs.get(); s.id = id; s.x = x; s.y = y; s.sc = sc || 1; s.rot = rot || 0; s.tint = tint || 0; s.al = alpha === undefined ? 1 : alpha; s.flip = !!flip; s.fps = r.fps || 12; s.n = r.n; s.life = s.max = r.n / s.fps;
  };
  // Expanding ring r0 -> r1 (ease-out) of width lw.
  F.ring = (x, y, r, col, life, r0, lw) => { const o = rings.get(); o.x = x; o.y = y; o.r1 = r; o.r0 = r0 === undefined ? r * 0.55 : r0; o.col = col; o.life = o.max = life || 0.3; o.lw = lw || 2; };
  // Filled flash disc fading out (a bloom stand-in that also works on Canvas2D).
  F.flash = (x, y, r, col, life, a) => { const o = flashes.get(); o.x = x; o.y = y; o.r = r; o.col = col; o.life = o.max = life || 0.12; o.a = a === undefined ? 0.7 : a; };
  // Gem vacuum sparkle (called by Actors.pickup, budgeted per frame).
  F.trail = (x, y, col) => {
    if (trailN++ >= BUD.trail || parts.a.length > MAXP * 0.8) return;
    F.part(x + (rnd() - 0.5) * 3, y + (rnd() - 0.5) * 3, (rnd() - 0.5) * 10, -6 - rnd() * 8, 0.3, rnd() < 0.35 ? 0xffffff00 : col, rnd() < 0.3 ? 2 : 1, 0, 0.8);
  };
  // Delayed burst (boss death chain): kind 'boom' at (x, y) after d seconds.
  const delay = (d, x, y, r, col) => { const q = later.get(); q.life = d; q.x = x; q.y = y; q.r = r; q.col = col; };

  // ---------------- shake / hit-stop / screen ----------------
  F.addShake = (v, crowd) => { if (!F.shakeOn) return; F.shake = Math.min(12, F.shake + v / (1 + (crowd || 0) / 250)); };
  // Hit-stop of sec seconds (solo only; at most one per stop + 0.15 s).
  F.hitStop = (sec) => {
    if (!ED.Game || ED.Game.mode !== 'solo' || F.now < stopCd) return;
    F.hold = Math.max(F.hold, sec); stopCd = F.now + sec + 0.15;
  };
  const scr = { col: 0xffffff00, a: 0, life: 0, max: 1 };
  // Full-view flash of colour col (0xRRGGBB00) at alpha a fading over life.
  F.screen = (col, a, life) => { if (scr.life > 0 && scr.a * (scr.life / scr.max) > a) return; scr.col = col; scr.a = a; scr.life = scr.max = life; };
  let hurtV = 0, letter = 0, letterT = 0;
  const ban = { text: '', sub: '', col: 0xffd27a, subCol: 0xfff1d6, life: 0, max: 1, k: 2, band: false };
  const ban2 = { text: '', sub: '', col: 0xffd27a, subCol: 0xfff1d6, life: 0, max: 1, k: 2, band: false };
  // Banner: big = the centre slot (boss intro, evolution), else the side slot (warnings, phases). k = font scale, band = dark band behind.
  F.banner = (text, col, secs, opt) => {
    const b = opt && opt.big ? ban : ban2;
    b.text = text; b.col = col; b.life = b.max = secs || 2; b.sub = (opt && opt.sub) || ''; b.subCol = (opt && opt.subCol) || 0xfff1d6; b.k = (opt && opt.k) || 2; b.band = !!(opt && opt.band);
  };
  const tracks = [{ id: 0, t: 0, col: 0 }, { id: 0, t: 0, col: 0 }, { id: 0, t: 0, col: 0 }, { id: 0, t: 0, col: 0 }];
  const track = (id, secs, col) => { let s = tracks[0]; for (const q of tracks) { if (q.id === id) { s = q; break; } if (q.t < s.t) s = q; } s.id = id; s.t = secs; s.col = col; };

  // ---------------- damage numbers ----------------
  F.number = (id, x, y, v, crit) => {
    if (!F.numbers) return;
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      if (n.id === id && F.now - n.born < 0.15) { n.v += v; if (crit && !n.crit) { n.crit = true; n.life = n.max = 0.85; } n.x = x; n.y0 = y; n.s = ''; return; }
    }
    let n;
    if (nums.length >= MAXN) { let oi = 0; for (let i = 1; i < nums.length; i++) if (nums[i].born < nums[oi].born) oi = i; n = nums[oi]; }
    else { n = numFree.pop() || {}; nums.push(n); }
    n.id = id; n.x = x + (rnd() - 0.5) * 8; n.y0 = y; n.v = v; n.crit = !!crit; n.born = F.now; n.life = n.max = crit ? 0.85 : 0.6; n.s = ''; n.dx = (rnd() - 0.5) * 14;
  };

  // ---------------- colours ----------------
  const LOOK_COL = { fire: 0xff8a3d00, meteor: 0xff6a2a00, holy: 0xffe08a00, shock: 0xd8e6ff00, ring: 0xe6c27a00, skull: 0xb7a6e000, shadow: 0x8a9bd600, poison: 0x7fe39a00, frost: 0x9fdcff00, ice: 0x9fdcff00, bone: 0xe8dcc800, tele: 0xff4a3a00 };
  const hexCol = (h) => ((parseInt((h || '#ffffff').slice(1), 16) << 8) >>> 0);
  const heroCol = (cls) => hexCol(ED.HEROES[cls] && ED.HEROES[cls].col);
  const view = () => ED.Game && ED.Game.view;
  const heroOf = (pid) => { const v = view(); if (!v) return null; for (const p of v.heroes) if (p.pid === pid) return p; return null; };
  const foeName = (id) => { const d = ED.FOES[id]; return d ? d.name : 'A boss'; };
  const up = (s) => String(s).toUpperCase();
  // True when (x, y) is inside the camera view plus margin m (no Render yet: true).
  const seen = (x, y, m) => { const r = ED.Render; return !r || !r.bw || (x >= r.camX - m && x <= r.camX + r.bw + m && y >= r.camY - m && y <= r.camY + r.bh + m); };

  // ---------------- deaths ----------------
  function death(ev, ctx) {
    const def = ED.FOES[ED.FOE_IDS[ev.k]], Ac = ED.Actors, pose = Ac && Ac.pose ? Ac.pose(ev.id) : null;
    const fi = def && Ac ? (def.boss ? Ac.bossInfo(def) : Ac.foeInfo(def)) : null, col = fi ? fi.col : 0xd8c8b000;
    if (!ev.boss && !seen(ev.x, ev.y, 48)) return;
    const crowdK = ctx.crowd > 400 ? 0.5 : ctx.crowd > 200 ? 0.75 : 1, h = pose ? pose.h : 12, cy = ev.y - h * 0.45;
    if (ev.boss) {
      const d = pops.get(); setPop(d, pose, ev, fi && fi.death, 1.6);
      F.flash(ev.x, cy, 80, 0xffffff00, 0.25, 0.9); F.ring(ev.x, cy, 140, 0xffd27aff, 0.6, 10, 4); F.ring(ev.x, cy, 90, 0xffffffff, 0.4, 6, 3);
      F.burst(ev.x, cy, 60, 0xffd27a00, 160, 0.9, 3, 30); F.burst(ev.x, cy, 30, col, 110, 0.8, 2, 20);
      for (let i = 0; i < 5; i++) delay(0.12 + i * 0.13, ev.x + (rnd() - 0.5) * 50, cy + (rnd() - 0.5) * 40, 26 + rnd() * 14, i % 2 ? 0xffd27a00 : col);
      F.screen(0xffffff00, 0.65, 0.35); F.addShake(9, 0); F.hitStop(0.08);
      return;
    }
    if (ev.elite) {
      if (pose) { const d = pops.get(); setPop(d, pose, ev, null, 0.22); }
      F.sprite('fx.explosion', ev.x, cy, 1.6, 0, 0xffd27a); F.flash(ev.x, cy, 26, 0xffffff00, 0.12, 0.8);
      F.ring(ev.x, cy, 48, 0xffc94aff, 0.4, 8, 3); F.burst(ev.x, cy, Math.round(28 * crowdK), 0xffd27a00, 120, 0.6, 2, 30); F.burst(ev.x, cy, Math.round(16 * crowdK), col, 90, 0.5, 2, 20);
      F.addShake(3.5, ctx.crowd); F.hitStop(0.05);
      return;
    }
    if (dieFull < BUD.dieFull) {
      dieFull++;
      if (pose) { const d = pops.get(); setPop(d, pose, ev, fi && fi.death, 0.14); }
      F.burst(ev.x, cy, Math.max(2, Math.round(7 * crowdK)), col, 55, 0.4, 2, 18);
      if (rnd() < 0.5 * crowdK) F.part(ev.x, cy, (rnd() - 0.5) * 30, -40, 0.35, 0xffffff00, 2, 120);
    } else if (diePop < BUD.diePop) {
      diePop++;
      if (pose) { const d = pops.get(); setPop(d, pose, ev, null, 0.1); }
      else F.part(ev.x, cy, 0, -20, 0.25, col, 2, 0);
    }
  }
  // Death pop: the foe's last frame flashes white and squashes flat (0.1-0.2 s); with a death anim it plays it, holds the last frame and fades (bosses).
  function setPop(d, pose, ev, anim, dur) {
    if (pose) { d.id = pose.an; d.fi = pose.fi; d.flip = pose.flip; d.sx = pose.sx; d.sy = pose.sy; d.x = ev.x + pose.ox; d.y = ev.y + pose.oy; }
    else { d.id = anim || ''; d.fi = 0; d.flip = false; d.sx = d.sy = 1; d.x = ev.x; d.y = ev.y; }
    d.anim = anim || '';
    if (d.anim) { const r = ED.Atlas.anim(d.anim); d.fps = r ? r.fps : 8; d.n = r ? r.n : 1; dur = Math.max(dur, d.n / d.fps + 0.7); }
    d.life = d.max = dur;
    if (!d.id) d.life = 0;
  }

  // ---------------- event routing ----------------
  // ctx: { me (local pid), crowd (foes on screen) }
  F.handle = (ev, ctx) => {
    const mine = ev.pid === ctx.me, Ac = ED.Actors;
    switch (ev.t) {
      case 'hit':
        if (!seen(ev.x, ev.y, 24)) break;
        F.number(ev.id, ev.x, ev.y - 10, ev.dmg, ev.crit);
        if (sparkN < BUD.spark) {
          sparkN++;
          F.sprite('fx.hit.spark', ev.x + (rnd() - 0.5) * 6, ev.y - 6 - rnd() * 6, ev.crit ? 2 : 1, 0, 0, 1, rnd() < 0.5);
          if (ev.crit) { F.burst(ev.x, ev.y - 8, 4, 0xffe66b00, 70, 0.25, 2, 0); }
        }
        break;
      case 'die': death(ev, ctx); break;
      case 'swing': {
        if (Ac) Ac.event(ev);
        const s = slashes.get(); s.x = ev.x; s.y = ev.y; s.a = ev.a; s.r = ev.r; s.arc = ev.arc; s.life = s.max = 0.16; s.col = LOOK_COL[ev.look] || 0xfff1d600;
        break;
      }
      case 'shoot': if (Ac) Ac.event(ev); break;
      case 'boom': {
        const col = LOOK_COL[ev.look] || (ev.team ? 0xff4a3a00 : 0xfff1d600), r = ev.r || 20;
        F.ring(ev.x, ev.y, r, col | 0xff, r > 200 ? 0.5 : 0.3, r * 0.4, r > 60 ? 3 : 2);
        F.flash(ev.x, ev.y, Math.min(r * 0.8, 90), col, r > 60 ? 0.16 : 0.1, r > 200 ? 0.35 : 0.6);
        if ((ev.look === 'fire' || ev.look === 'meteor') && r >= 24) F.sprite('fx.explosion', ev.x, ev.y, Math.min(4, r / 18), 0, 0, 1);
        if (r <= 200) F.burst(ev.x, ev.y, Math.min(14, 3 + Math.round(r / 10)), col, r * 2.2, 0.45, 2, 10);
        if (r > 200) { F.screen(col, 0.35, 0.3); if (mine) F.addShake(5, 0); }
        else if (ev.team && r >= 40) F.addShake(1.5, ctx.crowd);
        break;
      }
      case 'chain': { const c = chains.get(); c.pts = ev.pts; c.life = c.max = 0.2; c.col = LOOK_COL[ev.look] || 0xbfe4ff00; c.seed = rnd() * 100; break; }
      case 'eshoot': F.flash(ev.x, ev.y, 5, LOOK_COL[ev.look] || 0xff5a4a00, 0.1, 0.8); break;
      case 'skill': {
        const p = heroOf(ev.pid), col = p ? heroCol(p.cls) : 0xfff1d600;
        if (p) { F.ring(p.x, p.y - 8, 34, col | 0xff, 0.3, 6, 2); F.burst(p.x, p.y - 8, 10, col, 90, 0.35, 2, 0); }
        if (mine) { F.addShake(ev.shake || 3, ctx.crowd); F.hitStop(U.clamp(ev.stop || 0.05, 0.04, 0.08)); F.flash(ev.x, ev.y, 18, col, 0.12, 0.6); } // skill events may carry shake (3-9) and stop (s)
        break;
      }
      case 'dash': F.sprite('fx.puff', ev.x, ev.y - 2, 1, 0, 0, 0.8); F.burst(ev.x, ev.y - 2, 4, 0xb4aed000, 30, 0.35, 2, 0); break;
      case 'hurt': {
        F.burst(ev.x, ev.y - 10, 5, 0xff4a4a00, 60, 0.35, 2, 20);
        if (mine) {
          const p = heroOf(ev.pid), big = p && p.maxHp ? ev.dmg / p.maxHp >= 0.12 : ev.dmg >= 15;
          hurtV = Math.min(1, hurtV + (big ? 0.9 : 0.5));
          if (big) { F.addShake(4, 0); F.hitStop(0.05); }
        }
        break;
      }
      case 'pickup': {
        if (ev.k === 'chest') {
          F.sprite('fx.burst', ev.x, ev.y - 6, 1.5, 0, 0xffd27a); F.ring(ev.x, ev.y - 6, 50, 0xffd27aff, 0.45, 6, 3); F.flash(ev.x, ev.y - 6, 30, 0xfff1d600, 0.18, 0.8);
          for (let i = 0; i < 26; i++) { const a = -PI / 2 + (rnd() - 0.5) * 2.2, s = 60 + rnd() * 110; F.part(ev.x, ev.y - 6, Math.cos(a) * s, Math.sin(a) * s, 0.8 + rnd() * 0.4, rnd() < 0.3 ? 0xffffff00 : 0xffd24a00, rnd() < 0.4 ? 3 : 2, 220, 0.97); }
        } else if (ev.k === 'magnet') { F.ring(ev.x, ev.y, 360, 0x6ad7ffff, 0.6, 10, 3); F.flash(ev.x, ev.y, 20, 0x6ad7ff00, 0.15, 0.7); }
        else if (ev.k === 'food') F.burst(ev.x, ev.y - 6, 8, 0x7fe39a00, 40, 0.6, 2, 40);
        else if (pickN < BUD.pick) { pickN++; F.part(ev.x, ev.y - 4, (rnd() - 0.5) * 20, -30, 0.3, ev.k === 'gold' ? 0xffd24a00 : 0xbfefff00, 2, 0, 0.85); }
        break;
      }
      case 'heal': { const p = heroOf(ev.pid); if (p && ev.v >= 3) F.burst(p.x, p.y - 10, Math.min(6, 1 + (ev.v / 5 | 0)), 0x7fe39a00, 25, 0.6, 2, 35); break; }
      case 'brazier': F.sprite('fx.puff', ev.x, ev.y - 6, 1.2, 0, 0xffb060); F.burst(ev.x, ev.y - 8, 12, 0xff9a3a00, 70, 0.5, 2, 30); break;
      case 'level': {
        const v = view();
        if (v) for (const p of v.heroes) {
          if (p.dead || p.downed) continue;
          F.ring(p.x, p.y - 10, 60, 0x6ad7ffff, 0.5, 4, 3); F.sprite('fx.circle.spark', p.x, p.y - 10, 2.5, 0, 0x8ae8ff);
          for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; F.part(p.x + Math.cos(a) * 6, p.y - 10 + Math.sin(a) * 4, Math.cos(a) * 70, Math.sin(a) * 40 - 30, 0.7, i % 3 ? 0x6ad7ff00 : 0xffffff00, 2, -20, 0.92); }
          if (p.pid === ctx.me) { lvlT = 1.1; lvlN = ev.level; }
        }
        break;
      }
      case 'evolve': {
        const p = heroOf(ev.pid);
        if (p) { F.ring(p.x, p.y - 10, 110, 0xffd27aff, 0.7, 6, 4); F.ring(p.x, p.y - 10, 70, 0xffffffff, 0.45, 4, 2); F.burst(p.x, p.y - 10, 40, 0xffd27a00, 150, 0.8, 3, 20); F.sprite('fx.spark.magic', p.x, p.y - 4, 2.5, 0, 0xffe08a); }
        if (mine) { F.screen(0xfff1d600, 0.8, 0.4); F.hitStop(0.08); F.addShake(4, 0); F.banner(up((ED.WEAPONS[ev.wid] && ED.WEAPONS[ev.wid].name) || 'Weapon') + '!', 0xffd27a, 2.6, { big: true, sub: 'EVOLVED', subCol: 0xfff1d6, k: 3, band: true }); }
        break;
      }
      case 'chest': {
        if (!mine) break;
        const p = heroOf(ev.pid); if (!p) break;
        let i = 0;
        for (const r of ev.results || []) {
          if (r.kind === 'evo') continue;
          const d = r.kind === 'gold' ? null : r.kind === 'wlvl' ? ED.WEAPONS[r.id] : ED.PASSIVES[r.id];
          floatText(r.kind === 'gold' ? '+25 GOLD' : up(d ? d.name : r.id) + ' UP', p.x, p.y - 34 - i * 11, r.kind === 'gold' ? 0xffd24a : 0xbfefff, 1.6 + i * 0.25);
          i++;
        }
        break;
      }
      case 'warn': {
        if (ev.kind === 'boss') { F.banner(up(foeName(ev.id)) + ' APPROACHES', 0xff7a6a, 3, { k: 2 }); F.screen(0xff302000, 0.25, 0.6); }
        else if (ev.kind === 'elite') { const d = ED.FOES[ED.FOE_IDS[ev.k]]; F.banner('ELITE ' + up(d ? d.name : 'foe'), 0xffc94a, 2.2, { k: 2 }); if (ev.id) track(ev.id, 6, 0xffc94aff); }
        else F.banner(ev.ring ? 'SURROUNDED!' : 'SWARM!', 0xffa04a, 1.8, { k: 2 });
        break;
      }
      case 'boss': {
        if (ev.phase === 0) {
          F.banner(up(foeName(ev.id)), 0xff6a5a, 2.6, { big: true, sub: ev.final ? 'FINAL BOSS' : 'BOSS', subCol: 0xffd27a, k: 3, band: true });
          letterT = 2.6; F.addShake(6, 0); F.hitStop(0.08); F.screen(0xff302000, 0.35, 0.5);
          if (ev.fid) track(ev.fid, 9999, 0xff5a4aff);
        } else if (ev.phase === 'enrage') { F.banner('ENRAGED!', 0xff3a2a, 2.2, { k: 3 }); F.screen(0xff302000, 0.5, 0.6); F.addShake(6, 0); }
        else if (ev.phase === -1) { F.banner(up(foeName(ev.id)) + ' FALLS', 0xffd27a, 2.2, { big: true, k: 3, band: true }); for (const q of tracks) if (q.id === ev.fid) q.t = 0; }
        else if (ev.phase > 0) { F.banner('PHASE ' + ev.phase, 0xff7a6a, 1.6, { k: 2 }); F.addShake(5, 0); F.hitStop(0.06); const v = view(), b = v && v.boss; if (b) { F.ring(b.x, b.y - 20, 120, 0xff5a4aff, 0.5, 10, 4); F.flash(b.x, b.y - 20, 50, 0xffffff00, 0.15, 0.7); } }
        break;
      }
      case 'down': { const p = heroOf(ev.pid); if (p) { F.ring(p.x, p.y - 8, 50, 0xff3a2aff, 0.5, 6, 3); F.burst(p.x, p.y - 8, 16, 0xff4a4a00, 90, 0.6, 2, 20); } if (mine) { F.screen(0xff202000, 0.5, 0.5); F.addShake(5, 0); hurtV = 1; } break; }
      case 'revive': { const p = heroOf(ev.pid); if (p) { F.ring(p.x, p.y - 10, 70, 0xffe08aff, 0.6, 6, 3); F.burst(p.x, p.y - 10, 28, 0xffe08a00, 110, 0.8, 2, 40); F.sprite('fx.shield.gold', p.x, p.y - 4, 1.5); } if (mine) { F.banner('REVIVED', 0xffe08a, 1.6, { k: 2 }); F.screen(0xfff1d600, 0.4, 0.3); } break; }
      case 'dead': { const p = heroOf(ev.pid); if (p) F.burst(p.x, p.y - 8, 20, 0x8a84a800, 60, 0.9, 2, 20); break; }
      default: break;
    }
  };

  // Floating label (chest results): uses the number pool with a string payload.
  let lvlT = 0, lvlN = 0;
  const labels = [{ s: '', x: 0, y: 0, col: 0, life: 0, max: 1 }, { s: '', x: 0, y: 0, col: 0, life: 0, max: 1 }, { s: '', x: 0, y: 0, col: 0, life: 0, max: 1 }, { s: '', x: 0, y: 0, col: 0, life: 0, max: 1 }];
  let labelI = 0;
  function floatText(s, x, y, col, secs) { const l = labels[labelI]; labelI = (labelI + 1) % labels.length; l.s = s; l.x = x; l.y = y; l.col = col; l.life = l.max = secs; }

  // ---------------- update ----------------
  F.update = (dt) => {
    F.now += dt;
    const Ac = ED.Actors;
    if (Ac && Ac.clock) Ac.clock(F.now);
    if (Ac && Ac.sweep && F.now - sweepT > 1) { sweepT = F.now; Ac.sweep(); }
    dieFull = diePop = sparkN = trailN = pickN = 0;
    const frozen = F.hold > 0;
    F.hold = Math.max(0, F.hold - dt);
    const sdt = frozen ? 0 : dt;
    // particles
    const pa = parts.a; let n = 0;
    for (let i = 0; i < pa.length; i++) {
      const p = pa[i]; p.life -= sdt;
      if (p.life <= 0) { parts.free.push(p); continue; }
      p.x += p.vx * sdt; p.y += p.vy * sdt;
      const dr = Math.pow(p.drag, sdt * 10); p.vx *= dr; p.vy = p.vy * dr + p.grav * sdt;
      pa[n++] = p;
    }
    pa.length = n;
    sprs.age(sdt); rings.age(sdt); flashes.age(sdt); slashes.age(sdt); chains.age(sdt); pops.age(sdt);
    // delayed bursts fire when their timer runs out
    const la = later.a; n = 0;
    for (let i = 0; i < la.length; i++) {
      const q = la[i]; q.life -= sdt;
      if (q.life > 0) { la[n++] = q; continue; }
      F.sprite('fx.explosion', q.x, q.y, q.r / 16, 0, 0xffe0a0); F.flash(q.x, q.y, q.r, 0xffffff00, 0.1, 0.7); F.burst(q.x, q.y, 10, q.col, 120, 0.6, 2, 20); F.addShake(2.5, 0);
      later.free.push(q);
    }
    la.length = n;
    // numbers
    n = 0;
    for (let i = 0; i < nums.length; i++) { const o = nums[i]; o.life -= sdt; if (o.life > 0) nums[n++] = o; else numFree.push(o); }
    nums.length = n;
    for (const l of labels) if (l.life > 0) { l.life -= dt; l.y -= 14 * dt; }
    for (const q of tracks) if (q.t > 0) q.t -= dt;
    if (ban.life > 0) ban.life -= dt;
    if (ban2.life > 0) ban2.life -= dt;
    if (scr.life > 0) scr.life -= dt;
    if (lvlT > 0) lvlT -= dt;
    letterT = Math.max(0, letterT - dt);
    letter += ((letterT > 0 ? 1 : 0) - letter) * Math.min(1, dt * 8);
    hurtV = Math.max(0, hurtV - dt * 2.2);
    F.shake = Math.max(0, F.shake - dt * (10 + F.shake * 4));
  };
  // Camera offset from shake (world px); also kept on FX.sx / FX.sy so overlays stay put.
  F.shakeXY = (out) => {
    const s = F.shake, m = s > 0.05 ? s * Math.min(1, s / 4 + 0.35) : 0;
    out.x = m ? (rnd() - 0.5) * m : 0; out.y = m ? (rnd() - 0.5) * m : 0;
    F.sx = Math.round(out.x); F.sy = Math.round(out.y);
    return out;
  };

  // ---------------- world layer ----------------
  const SO = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  F.draw = (B) => {
    const A = ED.Atlas;
    for (const o of flashes.a) { const k = o.life / o.max; B.circ(o.x, o.y, Math.max(1, o.r * (1.15 - 0.35 * k)), rgbaK(o.col, o.a * k), 0); }
    for (const s of slashes.a) {
      const k = s.life / s.max;
      if (s.arc >= 6.2) { B.circ(s.x, s.y, s.r * (1.05 - 0.2 * k), rgbaK(s.col, 0.75 * k), 4 * k + 1); B.circ(s.x, s.y, s.r * (0.95 - 0.2 * k), rgbaK(0xffffff00, 0.5 * k), 1); }
      else { B.cone(s.x, s.y, s.r, s.a, s.arc, rgbaK(s.col, 0.45 * k), 0); B.cone(s.x, s.y, s.r * (1.02 + 0.06 * (1 - k)), s.a, s.arc * (0.6 + 0.4 * k), rgbaK(0xffffff00, 0.8 * k), 2); }
    }
    for (const r of rings.a) { const k = r.life / r.max, e = U.easeOut(1 - k); B.circ(r.x, r.y, Math.max(1, r.r0 + (r.r1 - r.r0) * e), rgbaK(r.col, 0.9 * k), Math.max(1, r.lw * (0.4 + 0.6 * k))); }
    for (const c of chains.a) {
      const k = c.life / c.max, p = c.pts, jit = Math.floor(F.now * 30);
      for (let i = 0; i + 3 < p.length; i += 2) {
        const mx = (p[i] + p[i + 2]) / 2 + ((jit * 7 + i * 13) % 9 - 4), my = (p[i + 1] + p[i + 3]) / 2 - 6 + ((jit * 5 + i * 11) % 9 - 4);
        B.line(p[i], p[i + 1] - 6, mx, my, 3, rgbaK(c.col, 0.5 * k)); B.line(mx, my, p[i + 2], p[i + 3] - 6, 3, rgbaK(c.col, 0.5 * k));
        B.line(p[i], p[i + 1] - 6, mx, my, 1, rgbaK(0xffffff00, k)); B.line(mx, my, p[i + 2], p[i + 3] - 6, 1, rgbaK(0xffffff00, k));
      }
    }
    const popA = B.crowd > 250 ? 0.6 : 1; // a crowd's death pops stay translucent so a 1,000 kills/s horde does not wash the screen white
    for (const d of pops.a) {
      const age = d.max - d.life;
      SO.flip = d.flip; SO.rot = 0; SO.tint = 0; SO.add = false;
      if (d.anim && A.has(d.anim)) {
        const fi = Math.min(d.n - 1, Math.floor(age * d.fps)), fade = U.clamp(d.life / 0.7, 0, 1);
        SO.flash = age < 0.08 ? 1 : 0; SO.sx = d.sx; SO.sy = d.sy; SO.alpha = fade;
        B.spr(d.anim, fi, d.x, d.y, SO);
      } else {
        const k = U.clamp(age / d.max, 0, 1);
        SO.flash = 1; SO.sx = d.sx * (1 + 0.45 * k); SO.sy = d.sy * (1 - 0.7 * k); SO.alpha = (1 - k * k) * popA;
        B.spr(d.id, d.fi, d.x, d.y, SO);
      }
    }
    for (const s of sprs.a) {
      const fi = Math.min(s.n - 1, Math.floor((s.max - s.life) * s.fps));
      SO.flip = s.flip; SO.flash = 0; SO.sx = SO.sy = s.sc; SO.rot = s.rot; SO.tint = s.tint; SO.alpha = s.al; SO.add = false;
      B.spr(s.id, fi, s.x, s.y, SO);
    }
    const np = parts.a.length, qk = B.mode === '2d' && np > P2D ? Math.max(2, Math.floor(8 * P2D / np)) : 8;
    for (const p of parts.a) { if (p.q >= qk) continue; const k = p.life / p.max, sz = k < 0.35 && p.size > 1 ? p.size - 1 : p.size; B.rect(Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz, rgbaK(p.col, Math.min(1, k * 1.6))); }
  };

  // ---------------- overlays ----------------
  const R = () => ED.Render;
  // Arrow at the view edge toward (x, y) when it is off screen.
  function edgeArrow(B, x0, y0, w, h, x, y, col) {
    const m = 14;
    if (x > x0 + m && x < x0 + w - m && y > y0 + m && y < y0 + h - m) return;
    const cx = x0 + w / 2, cy = y0 + h / 2, a = Math.atan2(y - cy, x - cx), c = Math.cos(a), s = Math.sin(a);
    const tx = Math.abs(c) > 1e-4 ? (w / 2 - m) / Math.abs(c) : 1e9, ty = Math.abs(s) > 1e-4 ? (h / 2 - m) / Math.abs(s) : 1e9, d = Math.min(tx, ty);
    const px = cx + c * d, py = cy + s * d, pu = 0.6 + 0.4 * Math.sin(F.now * 10);
    B.cone(px + c * 8, py + s * 8, 12, a + PI, 0.8, rgbaK(col, pu), 0);
    B.cone(px + c * 8, py + s * 8, 12, a + PI, 0.8, 0x000000cc, 1);
  }
  // Pixel-font text with a 1 px drop shadow.
  const textS = (B, s, x, y, col, k, al) => { B.text(s, x + k, y + k, 0x120a06, k, 'c', al); B.text(s, x, y, col, k, 'c', al); };
  F.drawTop = (B) => {
    const r = R(), v = view();
    // damage numbers
    for (const n of nums) {
      const age = n.max - n.life, k = n.life / n.max, big = n.crit || n.v >= 200;
      if (!n.s) n.s = String(Math.round(n.v));
      const y = n.y0 - 26 * U.easeOut(Math.min(1, age / 0.5)), x = n.x + n.dx * U.easeOut(Math.min(1, age / 0.5)), al = Math.min(1, k * 2.5);
      const sc = n.crit ? (age < 0.07 ? 3 : 2) : big ? 2 : 1;
      B.text(n.s, Math.round(x), Math.round(y), n.crit ? 0xffd84a : big ? 0xffb060 : 0xffffff, sc, 'c', al); // the font sheet carries its own 1 px outline
    }
    for (const l of labels) if (l.life > 0) textS(B, l.s, Math.round(l.x), Math.round(l.y), l.col, 1, Math.min(1, l.life / 0.4));
    if (!r) return;
    const x0 = r.camX + F.sx, y0 = r.camY + F.sy, w = r.bw, h = r.bh, cx = x0 + w / 2;
    if (v && v.me && lvlT > 0) { const k = 1 - lvlT / 1.1; textS(B, 'LEVEL UP', Math.round(v.me.x), Math.round(v.me.y - 34 - 10 * U.easeOut(Math.min(1, k * 3))), 0x8ae8ff, 2, Math.min(1, lvlT / 0.3)); }
    // offscreen arrows: tracked elites and the boss
    if (v) {
      for (const q of tracks) {
        if (q.t <= 0) continue;
        let e = null;
        for (const f of v.foes) if (f.id === q.id && !f.dead) { e = f; break; }
        if (!e) { q.t = 0; continue; }
        edgeArrow(B, x0, y0, w, h, e.x, e.y - 8, q.col);
      }
    }
    // low-HP / hurt vignette
    const me = v && v.me;
    let vg = hurtV * 0.55;
    if (me && !me.dead && me.maxHp) { const f = me.hp / me.maxHp; if (f < 0.3 || me.downed) vg = Math.max(vg, (me.downed ? 0.7 : (0.3 - f) / 0.3 * 0.6 + 0.2) * (0.75 + 0.25 * Math.sin(F.now * (me.downed ? 4 : 7)))); }
    if (vg > 0.02) {
      const bands = 7, bw = Math.max(4, Math.round(Math.min(w, h) * 0.022));
      for (let i = 0; i < bands; i++) {
        const a = vg * (1 - i / bands) * (1 - i / bands), col = rgbaK(0xb0101000, a * 0.8), o = i * bw;
        B.rect(x0, y0 + o, w, bw, col); B.rect(x0, y0 + h - o - bw, w, bw, col);
        B.rect(x0 + o, y0 + (i + 1) * bw, bw, h - 2 * (i + 1) * bw, col); B.rect(x0 + w - o - bw, y0 + (i + 1) * bw, bw, h - 2 * (i + 1) * bw, col);
      }
    }
    // screen flash
    if (scr.life > 0) B.rect(x0, y0, w, h, rgbaK(scr.col, scr.a * (scr.life / scr.max)));
    // letterbox (boss intro)
    if (letter > 0.01) { const lh = Math.round(h * 0.09 * letter); B.rect(x0, y0, w, lh, 0x000000ee); B.rect(x0, y0 + h - lh, w, lh, 0x000000ee); }
    // banners
    drawBanner(B, ban, cx, y0 + Math.round(h * 0.3), w);
    drawBanner(B, ban2, cx, y0 + Math.round(h * (ban.life > 0 ? 0.7 : 0.24)), w); // below the hero while the centre banner shows
  };
  function drawBanner(B, b, cx, y, w) {
    if (b.life <= 0) return;
    const age = b.max - b.life, al = Math.min(1, age / 0.12, b.life / 0.4), k = b.k;
    const pop = age < 0.1 ? 1 : 0; // one step larger for the first 100 ms
    if (b.band) {
      const bh = 12 * k + (b.sub ? 14 : 4), grow = U.easeOut(Math.min(1, age / 0.25));
      B.rect(cx - w / 2, y - bh / 2 - 2, w, bh + 4, rgbaK(0x0a060400, 0.6 * al));
      const lw = Math.round(w * 0.42 * grow);
      B.rect(cx - lw, y - bh / 2 - 3, lw * 2, 1, rgbaK((b.col << 8) >>> 0, al)); B.rect(cx - lw, y + bh / 2 + 2, lw * 2, 1, rgbaK((b.col << 8) >>> 0, al));
    }
    const ty = b.sub ? y - 5 : y;
    textS(B, b.text, Math.round(cx), Math.round(ty), b.col, k + pop, al);
    if (b.sub) textS(B, b.sub, Math.round(cx), Math.round(ty + 6 * k + 6), b.subCol, 1, al);
  }

  F.clear = () => {
    for (const p of POOLS) p.clear();
    for (const n of nums) numFree.push(n);
    nums.length = 0;
    F.shake = 0; F.hold = 0; scr.life = 0; ban.life = ban2.life = 0; hurtV = 0; letter = letterT = 0; lvlT = 0;
    for (const l of labels) l.life = 0;
    for (const q of tracks) q.t = 0;
    if (ED.Actors && ED.Actors.clear) ED.Actors.clear();
  };
})(globalThis.ED || (globalThis.ED = {}));
