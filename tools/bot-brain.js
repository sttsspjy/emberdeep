// Bot policy (UMD, no DOM): a "competent survivors player" that drives one hero through w.input frames. Node: require('./bot-brain.js'); browser: ED.Bot after the game scripts.
// Usage: const bot = Bot.create({ pid, seed, skill (0..1, default 1) }); bot.onStart(w, p);
//   every sim tick: w.input(pid, bot.think(w, p)) (the frame object is reused: copy it to keep it). Bot.metaFor(ED, 'none' | 'max') -> a meta bundle shaped like Save.metaBundle.
// Pure reader: linear scans of w.foes / w.projs / w.zones / w.pickups (never the foe grid, whose lazy rebuild is sim state); own seeded RNG; ED read lazily from globalThis on each call.
// Movement (re-plan every PLAN thinks, sooner on a new threat): 16 directions + stay, each scored over samples at H s ahead: contact danger (foes closing at their speed, dashers along
// their dash), foe shots (closest approach on the predicted path), hostile zones (warned shapes at their resolve time; live hazards while inside, moved by their observed drift and
// sub-stepped when they sweep), walls and edges; minus attraction (pickup target, boss at weapon reach, hysteresis, crowd, back toward the arena centre).
// Stance: a short-reach weapon (REACH, by the slot's current id) while healthy keeps the nearest foe at 0.75 x its reach (narrower contact band, pull to the crowd edge), else
// the bot keeps away from the crowd centroid; bosses are held inside that reach, or at 190 px when the weapon is ranged.
// The Q skill fires by a per-skill rule; an escape skill (Charge, Shadow Step) also fires when the best plan still gets hit soon (i-frames modelled). E is never pressed.
// skill < 1 (a casual player): slower re-plans, shots / zones seen only after a reaction delay,
// a share of shots and telegraphs never seen (per-id seeded hash), later and unreliable dashes, wandering heading noise; below 0.5 also 8 directions and shot paths read short
// (velocity x 2 skill: none at 0).
// Cards: a Form always (a chest Form offer: the first card) > refine > hero path ranks (the path closest to rank 3 first: one path to 3, then a second) > new support > support path ranks
// (same order) > passives by a fixed preference > skill; reroll / banish weak offers.
(function (root) {
  'use strict';
  const NDIR = 16, NC = NDIR + 1, PLAN = 3;
  const H = [0.12, 0.3, 0.55, 0.9], HW = [1, 0.85, 0.6, 0.4], NH = H.length, HMAX = 1.0;
  const DX = new Float64Array(NC), DY = new Float64Array(NC);
  for (let i = 0; i < NDIR; i++) { DX[i] = Math.cos(i / NDIR * Math.PI * 2); DY[i] = Math.sin(i / NDIR * Math.PI * 2); }
  const FOE_R = 300, PROJ_R = 420, ZONE_PAD = 260;
  const PASSIVE_PREF = { might: 300, multishot: 290, haste: 285, reach: 265, plating: 250, vigor: 235, duration: 225, mending: 205, swiftness: 190, velocity: 180, magnet: 150, fortune: 110 };
  // Hit reach (px from the hero centre to the edge of a foe of radius r) of short-reach weapons from their live numbers (ED.World.weaponS); weapons absent here are ranged.
  // Frost rings test the foe centre; auras, arcs, pools and orbiting bodies the foe's edge (orbits: outer edge of the body ring).
  const bell = (S) => S.orbit * Math.sqrt(S.area) + S.r * S.area * 0.5, arc = (S) => S.range * S.area;
  const REACH = { toll: bell, cathedral: bell, cleave: arc, whirlwind: arc, colossus: arc, earthsplitter: arc, gale: arc, tempest: arc };
  const FOE_TYP = 10; // typical foe radius for the crowd stance
  // Contact band (danger() reads it): gaps below CG px are scored; CK weighs contact at the far horizons (H >= 0.55 s). Ranged stance 30 / 1; short-reach stance narrower.
  let CG = 30, CK = 1;

  // ---------- scratch (shared by every bot: think() is synchronous) ----------
  let FN = 0, FX = new Float64Array(512), FY = new Float64Array(512), FRR = new Float64Array(512), FW = new Float64Array(512), FS = new Float64Array(512),
    FVX = new Float64Array(512), FVY = new Float64Array(512), FD = new Uint8Array(512), FB = new Uint8Array(512), F0 = new Float64Array(512);
  const growF = (n) => {
    if (n <= FX.length) return;
    let m = FX.length; while (m < n) m *= 2;
    const g = (a, T) => { const b = new T(m); b.set(a); return b; };
    FX = g(FX, Float64Array); FY = g(FY, Float64Array); FRR = g(FRR, Float64Array); FW = g(FW, Float64Array); FS = g(FS, Float64Array);
    FVX = g(FVX, Float64Array); FVY = g(FVY, Float64Array); FD = g(FD, Uint8Array); FB = g(FB, Uint8Array); F0 = g(F0, Float64Array);
  };
  const PJ = []; let PN = 0; // foe shots: { x, y, vx, vy, rad, cost, life }
  const ZL = []; let ZN = 0; // hostile zones: { z, rem, cost, kind: 1 warn, 2 warn followed by an act (dmg 0), 3 hazard, test }
  const PROBE = { x: 0, y: 0, r: 10 };
  const ZS = { x: 0, y: 0, r: 0, a: 0, len: 0, w: 0, arc: 0 }; // zone moved to time h by its observed drift (dr, da, dx, dy per s)
  const zAt = (o, h) => { const z = o.z; ZS.x = z.x + o.vx * h; ZS.y = z.y + o.vy * h; ZS.r = Math.max(0, z.r + o.dr * h); ZS.a = z.a + o.da * h; ZS.len = z.len; ZS.w = z.w; ZS.arc = z.arc; return ZS; };
  const NEAR = new Float64Array(NC);
  const hsh = (a) => { a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); return ((a ^ (a >>> 16)) >>> 0) / 4294967296; }; // int -> [0, 1)
  const DC = new Int32Array(144); // densest: 12 x 12 cells of 64 px
  // Candidate being scored by danger(): direction, start, dash flag, walk speed, dash speed / window / distance.
  const CD = { ux: 0, uy: 0, x: 0, y: 0, still: false, dash: false, spd: 0, dv: 0, dt: 0, dd: 0 };
  // Distance walked (or dashed) by the candidate after h s.
  const travel = (h) => (CD.still ? 0 : CD.dash ? (h <= CD.dt ? h * CD.dv : CD.dd + (h - CD.dt) * CD.spd) : h * CD.spd);
  // Warned zone o covers the candidate's spot at tt s (stuck: the last free spot sx, sy); the dash window is safe.
  const warnHit = (w, o, tt, r, stuck, sx, sy) => {
    if (CD.dash && tt <= CD.dt) return false;
    const s = travel(tt);
    return w.zoneHas(zAt(o, tt), stuck ? sx : CD.x + CD.ux * s, stuck ? sy : CD.y + CD.uy * s, r);
  };

  function Brain(cfg) {
    cfg = cfg || {};
    this.pid = cfg.pid || 'p1'; this.seed = (cfg.seed >>> 0) || 1;
    // skill 0..1 (default 1; every knob below is neutral at 1).
    const sk = cfg.skill === undefined ? 1 : Math.max(0, Math.min(1, +cfg.skill || 0)), u = 1 - sk;
    this.skill = sk; this.planN = PLAN + Math.round(u * 12); this.react = u * 0.45; this.dashAt = 0.55 + u * 0.9;
    this.miss = u * 0.3; this.dashP = 0.35 + 0.65 * sk; this.noise = u * 0.6; this.dstep = sk < 0.5 ? 2 : 1; this.vk = Math.min(1, 2 * sk); // missed threat share, dash chance per re-plan, heading noise, direction step, shot velocity read
    this.jit = 0; this.jitT = 0; this.mix = Math.imul(this.seed, 0x9e3779b1) >>> 0;

    this.rs = (this.seed ^ 0x5eed1234) >>> 0 || 1; // LCG state
    this.n = 0; this.plan = 0; this.dir = -1; this.mx = 0; this.my = 0;
    this.tgt = null; this.tgtId = 0; this.tgtT = 0; this.tgtK = 0;
    this.lastX = 0; this.lastY = 0; this.stuckN = 0; this.wander = -1; this.wanderT = 0; this.planT = 0;
    this.castGap = 0; this.zSeen = 0; this.pSeen = 0;
    this.f = { mx: 0, my: 0, ax: 0, ay: 0, dash: false, q: false, e: false, pick: 0, banish: 0, reroll: false, skip: false };
    this.near = 0; this.crowd = 0; this.cx = 0; this.cy = 0; this.dx = 0; this.dy = 0; this.boss = null; this.zPrev = new Map(); // zone id -> [x, y, r, a, time, think n]
    this.gmin = Infinity; this.gx = 0; this.gy = 0; // nearest contact foe: gap and position
    this.reach = 0; this.close = false; this.bossFn = null; this.bossS = null; this.bossOn = false; // stance(): main weapon reach to a typical foe's edge (0 = ranged), crowd / boss stance
  }
  Brain.prototype.rnd = function () { this.rs = (Math.imul(this.rs, 1664525) + 1013904223) >>> 0; return this.rs / 4294967296; };
  Brain.prototype.onStart = function (w, p) { this.lastX = p.x; this.lastY = p.y; this.planT = w.time; };

  Brain.prototype.think = function (w, p) {
    const ED = root.ED, f = this.f;
    f.dash = f.q = f.e = f.reroll = f.skip = false; f.pick = 0; f.banish = 0;
    this.n++;
    if (!p || p.dead || p.downed) { f.mx = 0; f.my = 0; return f; }
    if (p.offer) { this.cards(ED, w, p); f.mx = this.mx; f.my = this.my; return f; }
    if (this.castGap > 0) this.castGap--;
    const urgent = this.newThreat(w, p);
    if (this.n >= this.plan || (urgent && this.skill >= 1)) { this.plan = this.n + this.planN; this.replan(ED, w, p); }
    f.mx = this.mx; f.my = this.my;
    if (!f.q) this.aim(ED, w, p);
    return f;
  };

  // True when a hostile shot or zone appeared since the last check (forces an early re-plan).
  Brain.prototype.newThreat = function (w, p) {
    let zc = 0, pc = 0;
    const Z = w.zones;
    for (let i = 0; i < Z.length; i++) { const z = Z[i]; if (!z.dead && z.team === 1 && z.id > this.zSeen) { zc = Math.max(zc, z.id); } }
    const P = w.projs;
    if (this.n % 2 === 0) for (let i = 0; i < P.length; i++) { const q = P[i]; if (!q.dead && q.team === 1 && q.id > this.pSeen && (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) < 200 * 200) pc = Math.max(pc, q.id); }
    let hit = false;
    if (zc > this.zSeen) { this.zSeen = zc; hit = true; }
    if (pc > this.pSeen) { this.pSeen = pc; hit = true; }
    return hit;
  };

  // Weapon reach from its live numbers: sets this.reach (0 = ranged) and this.close (short reach and healthy: on above 65% HP, off below 55%).
  // Boss stance from the same weapon: bossFn / bossS (null: ranged), bossOn.
  Brain.prototype.stance = function (ED, w, p, hpF) {
    let r = 0, br = Infinity;
    this.bossFn = null;
    for (let i = 0; i < p.weapons.length; i++) {
      const fn = REACH[p.weapons[i].id];
      if (!fn) continue;
      const S = w.weaponS(p, i);
      r = Math.max(r, fn(S, FOE_TYP));
      const b = fn(S, 40); if (b < br) { br = b; this.bossFn = fn; this.bossS = S; }
    }
    this.reach = r;
    this.close = r > 0 && hpF > (this.close ? 0.55 : 0.65);
    this.bossOn = this.bossFn ? hpF > (this.bossOn ? 0.55 : 0.65) : hpF > 0.5;
  };
  // Centre distance to hold from boss B: 0.75 x the boss stance weapon's reach to its edge, else 190 px.
  Brain.prototype.bossHold = function (p, B) { return this.bossFn ? B.r + Math.max(p.r + 4, this.bossFn(this.bossS, B.r) * 0.75) : 190; };

  // ---------- perception ----------
  Brain.prototype.gather = function (ED, w, p) {
    const es = w.foes, R2 = FOE_R * FOE_R, cK = 1 / Math.max(1, w.contactDmg());
    let n = 0, near = 0, crowd = 0, cx = 0, cy = 0, cw = 0, boss = null, gmin = Infinity, gx = p.x, gy = p.y;
    growF(es.length);
    for (let i = 0; i < es.length; i++) {
      const e = es[i]; if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
      if (e.boss && w.bossList.indexOf(e) >= 0 && (!boss || d2 < (boss.x - p.x) ** 2 + (boss.y - p.y) ** 2)) boss = e;
      if (d2 > R2) continue;
      FX[n] = e.x; FY[n] = e.y; FRR[n] = e.r + p.r;
      const contact = e.def.noContact || e.freezeT > 0 ? 0 : e.dmg * cK;
      FW[n] = contact; FB[n] = e.boss ? 1 : 0;
      const stopped = e.stunT > 0 || e.freezeT > 0;
      FS[n] = stopped ? 0 : e.spd * (e.slowT > 0 ? 1 - e.slowK : 1) * 0.85; // closing speed toward the hero (chasers re-steer: 0.85 of full speed)
      FD[n] = !stopped && e.st === 2 && !e.boss && (e.def.charge || e.def.dive) ? 1 : 0;
      FVX[n] = e.vx; FVY[n] = e.vy;
      const d = Math.sqrt(d2), gap = d - e.r - p.r;
      F0[n] = gap; if (FD[n]) FS[n] = Math.hypot(e.vx, e.vy); // gap(h) >= F0 - FS h - hero travel: the skip bound in danger()
      if (gap < 60) near += contact > 0 ? 1 : 0;
      if (contact > 0 && gap < gmin) { gmin = gap; gx = e.x; gy = e.y; }
      if (gap < 140) { const k = (1 - gap / 140) * (e.boss ? 4 : e.elite ? 2 : 1); crowd += k; cx += e.x * k; cy += e.y * k; cw += k; }
      n++;
    }
    FN = n; this.near = near; this.crowd = crowd; this.boss = boss; this.gmin = gmin; this.gx = gx; this.gy = gy;
    this.cx = cw > 0 ? cx / cw : p.x; this.cy = cw > 0 ? cy / cw : p.y;
    // foe shots
    const P = w.projs, hpK = 10 / Math.max(1, p.maxHp);
    PN = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i]; if (q.dead || q.team !== 1 || q.t < this.react || (this.miss > 0 && hsh(q.id ^ this.mix) < this.miss)) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      if (dx * dx + dy * dy > PROJ_R * PROJ_R) continue;
      if (dx * q.vx + dy * q.vy > 0 && dx * dx + dy * dy > 40 * 40) continue; // moving away
      const o = PJ[PN] || (PJ[PN] = { x: 0, y: 0, vx: 0, vy: 0, rad: 0, cost: 0, life: 0 });
      o.x = q.x; o.y = q.y; o.vx = q.vx * this.vk; o.vy = q.vy * this.vk; o.rad = q.r + p.r * 0.7 + 3; o.cost = Math.max(0.3, (q.dmg || 5) * hpK); o.life = q.life;
      PN++;
    }
    // hostile zones
    const Z = w.zones;
    ZN = 0;
    for (let i = 0; i < Z.length; i++) {
      const z = Z[i]; if (z.dead || z.team !== 1 || z.t < this.react || (z.warn && this.miss > 0 && hsh(z.id ^ this.mix ^ 0x5a5a5a5a) < this.miss)) continue;
      const ext = (z.len > 0 ? z.len : z.r) + ZONE_PAD;
      if ((z.x - p.x) * (z.x - p.x) + (z.y - p.y) * (z.y - p.y) > ext * ext) continue;
      const o = ZL[ZN] || (ZL[ZN] = { z: null, rem: 0, cost: 0, kind: 0, test: null, soft: false, vx: 0, vy: 0, dr: 0, da: 0, mov: false });
      const pv = this.zPrev.get(z.id), dt = pv ? w.time - pv[4] : 0;
      if (dt > 1e-6 && dt < 0.5) { o.vx = (z.x - pv[0]) / dt; o.vy = (z.y - pv[1]) / dt; o.dr = (z.r - pv[2]) / dt; o.da = ((z.a - pv[3] + 3 * Math.PI) % (2 * Math.PI) - Math.PI) / dt; } else { o.vx = o.vy = o.dr = o.da = 0; }
      o.mov = Math.abs(o.dr) > 25 || Math.abs(o.da) > 0.6 || o.vx * o.vx + o.vy * o.vy > 900;
      const nv = pv || []; nv[0] = z.x; nv[1] = z.y; nv[2] = z.r; nv[3] = z.a; nv[4] = w.time; nv[5] = this.n; if (!pv) this.zPrev.set(z.id, nv);
      const src = z.src && !z.src.dead && z.src.id === z.srcId ? z.src : null, sd = src ? src.dmg : w.contactDmg();
      o.z = z; o.rem = z.dur - z.t; o.test = null; o.soft = false;
      if (z.warn) { o.kind = z.dmg > 0 ? 1 : 2; o.cost = Math.max(0.5, (z.dmg > 0 ? z.dmg : sd * 1.3) * hpK); }
      else {
        o.kind = 3;
        const st = z.st;
        if (st && typeof st.test === 'function') { o.test = st.test; o.soft = true; }
        o.cost = Math.max(0.4, (st && st.mul > 0 ? sd * st.mul : sd * 0.6) * hpK);
      }
      ZN++;
    }
    if (this.zPrev.size > 64) for (const [id, v] of this.zPrev) if (this.n - v[5] > 30) this.zPrev.delete(id);
  };

  // ---------- scoring ----------
  // Danger of candidate c (c = NDIR: stand still) for hero p; dash: the first DASH.t s at dash speed with i-frames. Writes NEAR[c] (danger in the next ~0.35 s). Returns total danger.
  Brain.prototype.danger = function (ED, w, p, c, dash) {
    const A = w.arena, Ar = ED.Arena, D = ED.CONST.DASH, still = c === NDIR;
    CD.ux = DX[c]; CD.uy = DY[c]; CD.x = p.x; CD.y = p.y; CD.still = still; CD.dash = dash;
    CD.spd = p.stats.speed * (p.slowT > 0 ? 1 - (p.slowK || 0) : 1); CD.dv = D.dist / D.t; CD.dt = D.t; CD.dd = D.dist;
    const ux = CD.ux, uy = CD.uy, spd = CD.spd, iv = Math.max(p.invuln, p.dashT);
    let tot = 0, near = 0, x = p.x, y = p.y, stuck = false, h0 = 0, x0 = p.x, y0 = p.y;
    const size = A.size;
    for (let k = 0; k < NH; k++) {
      const h = H[k];
      if (!stuck) {
        const s = travel(h), tx = p.x + ux * s, ty = p.y + uy * s;
        if (Ar.blocked(A, tx, ty, p.r + 1)) { stuck = true; tot += k === 0 ? 1.2 : 0.5; }
        else { x = tx; y = ty; }
      }
      // contact
      const safe = h < iv || (dash && h <= D.t), tr = travel(h) + CG, ck = k < 2 ? 1 : CK;
      let cs = 0;
      for (let i = 0; i < FN; i++) {
        const w0 = FW[i]; if (w0 <= 0) continue;
        if (F0[i] - FS[i] * h - tr > 0) continue;
        let gap;
        if (FD[i]) { const ex = FX[i] + FVX[i] * h, ey = FY[i] + FVY[i] * h; gap = Math.sqrt((ex - x) * (ex - x) + (ey - y) * (ey - y)) - FRR[i]; }
        else { const dx = FX[i] - x, dy = FY[i] - y; gap = Math.sqrt(dx * dx + dy * dy) - FS[i] * h - FRR[i]; }
        if (gap < CG) cs += w0 * (gap <= 0 ? 1 : (1 - gap / CG) * (1 - gap / CG)) * (FB[i] ? 1.5 : 1);
      }
      cs = Math.min(1.6, cs * ck);
      if (!safe) { const v = cs * HW[k]; tot += v; if (k < 2) near += v; }
      else tot += cs * HW[k] * 0.15;
      // edges
      const b = Math.min(x, y, size - x, size - y);
      if (b < 160) tot += (1 - b / 160) * 0.8 * HW[k];
      // live hazards (harmless during i-frames); moving ones (rings, sweeping beams) are checked every 0.05 s since the last sample
      for (let j = 0; j < ZN; j++) {
        const o = ZL[j]; if (o.kind !== 3) continue;
        let hit = false, soft = false;
        const steps = o.mov ? Math.max(1, Math.ceil((h - h0) / 0.05)) : 1;
        for (let m = 1; m <= steps && !hit; m++) {
          const f = m / steps, t = h0 + (h - h0) * f;
          if (t < iv || (dash && t <= D.t)) continue;
          const sx = x0 + (x - x0) * f, sy = y0 + (y - y0) * f, zz = zAt(o, t);
          PROBE.x = sx; PROBE.y = sy; PROBE.r = p.r;
          hit = o.test ? o.test(w, zz, PROBE) : w.zoneHas(zz, sx, sy, p.r * 0.7 + 4);
          if (!hit && o.soft && m === steps) soft = w.zoneHas(zz, sx, sy, p.r);
        }
        if (hit) { tot += o.cost * HW[k]; if (k < 2) near += o.cost * HW[k]; }
        else if (soft) tot += 0.15 * HW[k];
      }
      h0 = h; x0 = x; y0 = y;
    }
    // warned zones: the hero's spot when they resolve (plus the act that follows a dmg-0 warning)
    const wr = p.r * 0.7 + 5;
    for (let j = 0; j < ZN; j++) {
      const o = ZL[j]; if (o.kind === 3) continue;
      let t = o.rem, wt = 1;
      if (t > HMAX) { t = HMAX; wt = 0.45; }
      let hit = warnHit(w, o, Math.max(0, t), wr, stuck, x, y);
      if (!hit && o.kind === 2) hit = warnHit(w, o, Math.min(HMAX, t + 0.2), wr, stuck, x, y) || warnHit(w, o, Math.min(HMAX, t + 0.45), wr, stuck, x, y);
      if (hit) { const v = o.cost * wt; tot += v; if (o.rem < 0.4) near += v; }
    }
    // foe shots: closest approach on the predicted path (dash: no hit during the i-frames)
    if (PN) {
      const vx1 = still ? 0 : ux * spd, vy1 = still ? 0 : uy * spd;
      for (let j = 0; j < PN; j++) {
        const q = PJ[j], T = Math.min(HMAX, q.life);
        let t0 = 0, ox = q.x - p.x, oy = q.y - p.y, hit = -1;
        if (dash && !still) { // skip the dash window, start after it
          t0 = D.t; ox = q.x + q.vx * D.t - (p.x + ux * D.dist); oy = q.y + q.vy * D.t - (p.y + uy * D.dist);
        } else if (iv > 0) { const ti = Math.min(iv, T); ox += (q.vx - vx1) * ti; oy += (q.vy - vy1) * ti; t0 = ti; }
        if (t0 < T) {
          const rvx = q.vx - vx1, rvy = q.vy - vy1, vv = rvx * rvx + rvy * rvy;
          let ts = vv > 1e-6 ? -(ox * rvx + oy * rvy) / vv : 0;
          if (ts < 0) ts = 0; else if (ts > T - t0) ts = T - t0;
          const mx = ox + rvx * ts, my = oy + rvy * ts;
          if (mx * mx + my * my < q.rad * q.rad) hit = t0 + ts;
        }
        if (hit >= 0) { const v = q.cost * (hit < 0.45 ? 1 : 0.75); tot += v; if (hit < 0.35) near += v; }
      }
    }
    NEAR[c] = near;
    return tot;
  };

  Brain.prototype.replan = function (ED, w, p) {
    this.gather(ED, w, p);
    this.pickTarget(ED, w, p);
    const hpF = p.hp / Math.max(1, p.maxHp), hpMul = 1 + 1.6 * (1 - hpF), S = w.arena.size;
    this.stance(ED, w, p, hpF);
    const close = this.close, gP = Math.max(4, this.reach * 0.75 - p.r);
    CG = close ? Math.min(30, Math.max(6, gP * 0.35)) : 30; CK = close ? 0.5 : 1;
    // attraction inputs
    let tx = 0, ty = 0, tw = 0;
    if (this.tgt) { const dx = this.tgt.x - p.x, dy = this.tgt.y - p.y, d = Math.hypot(dx, dy) || 1; tx = dx / d; ty = dy / d; tw = this.tgtK; }
    // crowd: ranged keeps away from the centroid; short reach walks toward it (else the nearest foe) until the nearest gap is gP, backs off below gP / 2
    let ax = 0, ay = 0, away = 0;
    if (close) {
      if (this.gmin < FOE_R) {
        const ox = this.crowd > 0 ? this.cx : this.gx, oy = this.crowd > 0 ? this.cy : this.gy, e = this.gmin - gP;
        ax = ox - p.x; ay = oy - p.y; away = e > 0 ? 0.6 * Math.min(1, e / 40) : e < -0.5 * gP ? -0.3 : 0;
      }
    } else { ax = p.x - this.cx; ay = p.y - this.cy; away = Math.min(0.5, this.crowd * 0.04); }
    const al = Math.hypot(ax, ay); if (al > 1) { ax /= al; ay /= al; } else { ax = ay = 0; }
    const ccx = S / 2 - p.x, ccy = S / 2 - p.y, dc = Math.hypot(ccx, ccy), cen = dc > 700 ? Math.min(1.2, (dc - 700) / 600) : 0;
    // boss engagement: hold bossHold() from the nearest boss body while healthy
    let bx = 0, by = 0, bw = 0;
    const B = this.boss;
    if (B && !B.dead && this.bossOn && this.crowd < 12) {
      const dx = B.x - p.x, dy = B.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < 650) { bx = dx / d; by = dy / d; bw = 0.7 * Math.max(-1, Math.min(1, (d - this.bossHold(p, B)) / 90)); }
    }
    const pd = this.dir;
    let best = -1, bs = -Infinity;
    if (this.noise > 0 && w.time >= this.jitT) { this.jit = Math.floor(this.rnd() * NDIR); this.jitT = w.time + 0.6 + this.rnd() * 0.8; }
    for (let c = 0; c < NC; c += c < NDIR ? this.dstep : 1) {
      let s = -this.danger(ED, w, p, c, false) * hpMul;
      if (c < NDIR) {
        const ux = DX[c], uy = DY[c];
        s += tw * (ux * tx + uy * ty);
        s += away * (ux * ax + uy * ay);
        if (bw) s += bw * (ux * bx + uy * by);
        if (cen > 0) s += cen * 0.6 * (ux * ccx + uy * ccy) / dc;
        if (pd >= 0 && pd < NDIR) s += 0.35 * (ux * DX[pd] + uy * DY[pd]);
        if (this.wanderT > 0 && this.wander >= 0) s += 0.8 * (ux * DX[this.wander] + uy * DY[this.wander]);
        if (this.noise > 0) s += this.noise * (ux * DX[this.jit] + uy * DY[this.jit]);
      } else s -= 0.25 + (pd === NDIR ? -0.1 : 0);
      if (s > bs) { bs = s; best = c; }
    }
    this.dir = best;
    this.mx = best < NDIR ? DX[best] : 0; this.my = best < NDIR ? DY[best] : 0;
    // stuck: barely moved for 1.2 s while walking -> wander a random way for 0.6 s (counted in sim time)
    if (this.wanderT > 0) this.wanderT -= w.time - this.planT;
    this.planT = w.time;
    if (this.n >= this.stuckN) {
      this.stuckN = this.n + 72;
      const mv = Math.hypot(p.x - this.lastX, p.y - this.lastY);
      if (mv < 18 && best < NDIR && this.near === 0) { this.wander = Math.floor(this.rnd() * NDIR); this.wanderT = 0.6; }
      this.lastX = p.x; this.lastY = p.y;
    }
    const nearBest = NEAR[best];
    // escape: dash (or a mobility skill) when the best walking plan still gets hit soon
    const threat = nearBest > this.dashAt || (hpF < 0.35 && nearBest > 0.25);
    if (threat && p.invuln <= 0.05 && p.dashT <= 0) {
      if (p.dashCd <= 0 && (this.dashP >= 1 || this.rnd() < this.dashP)) {
        let db = -1, dbs = -Infinity;
        for (let c = 0; c < NDIR; c += this.dstep) { const s = -this.danger(ED, w, p, c, true) * hpMul + 0.2 * (DX[c] * DX[best] + DY[c] * DY[best]); if (s > dbs) { dbs = s; db = c; } }
        if (db >= 0 && -dbs < (-bs) * 0.8 + 0.05) { this.f.dash = true; this.mx = DX[db]; this.my = DY[db]; this.dir = db; return; }
      }
      if (this.escapeSkill(ED, w, p, best)) return;
    }
    this.skills(ED, w, p, hpF, nearBest);
  };

  // Pickup target (re-chosen every 0.5 s or when it is gone): chests first, food when hurt, magnet / bomb, else the best gem cluster point. tgtK = pull weight.
  Brain.prototype.pickTarget = function (ED, w, p) {
    const t = this.tgt;
    if (t && (t.dead || t.id !== this.tgtId)) this.tgt = null;
    if (this.tgt && this.n < this.tgtT) return;
    this.tgtT = this.n + 30;
    const G = w.pickups, hpF = p.hp / Math.max(1, p.maxHp), danger = Math.min(1, this.crowd * 0.05);
    let best = null, bs = 0, bk = 0;
    for (let i = 0; i < G.length; i++) {
      const g = G[i]; if (g.dead || g.pull) continue;
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      let v = 0, k = 0;
      if (g.k === 'chest') { if (d > 1600) continue; v = 60; k = 1.1; }
      else if (g.k === 'food') { if (hpF > 0.8 || d > 900) continue; v = 30 * (1.2 - hpF); k = 0.6 + (1 - hpF); }
      else if (g.k === 'magnet') { if (d > 900) continue; v = 12; k = 0.6; }
      else if (g.k === 'bomb') { if (d > 700) continue; v = 4 + this.crowd * 0.3; k = 0.5; }
      else if (g.k === 'gold') { if (d > 300) continue; v = 0.5 * g.val; k = 0.25; }
      else { if (d > 500) continue; v = g.val; k = 0.3; }
      const s = v / (d + 80);
      if (s > bs) { bs = s; best = g; bk = k; }
    }
    this.tgt = best; this.tgtId = best ? best.id : 0; this.tgtK = bk * (1 - 0.6 * danger);
  };

  // Aim point (every think; the weapon fires along it): the nearest elite / boss in view within AIM_BIG px (short reach: reach + 60), else the nearest foe in view within AIM_R px,
  // else 80 px ahead of the walk. Linear scan of w.foes.
  const AIM_BIG = 300, AIM_R = 360;
  Brain.prototype.aim = function (ED, w, p) {
    const es = w.foes, rb = this.reach > 0 ? this.reach + 60 : AIM_BIG, rb2 = rb * rb, r2 = AIM_R * AIM_R, f = this.f;
    let bd = Infinity, bb = Infinity, n = null, b = null;
    for (let i = 0; i < es.length; i++) {
      const e = es[i]; if (e.dead || !ED.inView(p, e.x, e.y, e.r)) continue;
      const d = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
      if (d < bd && d <= r2) { bd = d; n = e; }
      if ((e.elite || e.boss) && d < bb && d <= rb2) { bb = d; b = e; }
    }
    const t = b || n;
    if (t) { f.ax = t.x; f.ay = t.y; } else { f.ax = p.x + this.mx * 80; f.ay = p.y + this.my * 80; }
  };

  // Densest 64 px cell of local foes within range of (x, y): writes this.dx / this.dy (mean of that cell) and returns its count.
  Brain.prototype.densest = function (x, y, range) {
    DC.fill(0);
    const r2 = range * range, half = 6;
    let bc = 0, best = -1;
    for (let i = 0; i < FN; i++) {
      const dx = FX[i] - x, dy = FY[i] - y; if (dx * dx + dy * dy > r2) continue;
      const cx = Math.floor(dx / 64) + half, cy = Math.floor(dy / 64) + half; if (cx < 0 || cy < 0 || cx >= 12 || cy >= 12) continue;
      const v = ++DC[cy * 12 + cx]; if (v > bc) { bc = v; best = cy * 12 + cx; }
    }
    if (best < 0) return 0;
    let sx = 0, sy = 0, m = 0;
    for (let i = 0; i < FN; i++) {
      const dx = FX[i] - x, dy = FY[i] - y; if (dx * dx + dy * dy > r2) continue;
      const cx = Math.floor(dx / 64) + half, cy = Math.floor(dy / 64) + half;
      if (cy * 12 + cx === best) { sx += FX[i]; sy += FY[i]; m++; }
    }
    this.dx = sx / m; this.dy = sy / m;
    return bc;
  };
  // Local foes within r of (x, y).
  const countIn = (x, y, r) => { let n = 0; const r2 = r * r; for (let i = 0; i < FN; i++) if ((FX[i] - x) * (FX[i] - x) + (FY[i] - y) * (FY[i] - y) <= r2) n++; return n; };

  // ---------- skills ----------
  // Rule per skill id: (bot, w, p, ctx) -> true when it set this.f.ax / ay and wants the cast. ctx = SCTX { hpF, near (danger soon) }.
  const SCTX = { hpF: 0, near: 0 };
  const aimAt = (b, x, y) => { b.f.ax = x; b.f.ay = y; return true; };
  const dense = (b, p, range, min) => (b.densest(p.x, p.y, range) >= min ? aimAt(b, b.dx, b.dy) : false);
  const atDense = (range, min) => (b, w, p) => dense(b, p, range, min);
  const selfCrowd = (r, min) => (b, w, p, ctx) => {
    const n = countIn(p.x, p.y, r), e = b.boss, near = e && !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < r + e.r;
    return n >= min || near || (ctx.near > 0.4 && n >= 2) ? aimAt(b, p.x + b.mx * 40, p.y + b.my * 40) : false;
  };
  // Mobility skill used offensively: toward the densest cluster when nothing threatens soon.
  const dashInto = (range) => (b, w, p, ctx) => (ctx.near > 0.2 || ctx.hpF < 0.4 ? false : dense(b, p, range, 4));
  const SKILL = {
    shove: (b, w, p, ctx) => (ctx.near > 0.3 || ctx.hpF < 0.5) && selfCrowd(120, 6)(b, w, p, ctx), // defensive: a shove clears the knight's own Cleave reach
    vault: () => false, // escape only (escapeSkill)
    flashpoint: selfCrowd(140, 6),
    bonewall: atDense(220, 6),
    sanctuary: (b, w, p, ctx) => (ctx.hpF < 0.8 || countIn(p.x, p.y, 90) >= 6 ? aimAt(b, p.x + b.mx * 30, p.y + b.my * 30) : false),
    step: dashInto(130),
    peal: (b, w, p, ctx) => (countIn(p.x, p.y, 160) >= 15 || ctx.near > 0.5 || (ctx.hpF < 0.5 && countIn(p.x, p.y, 120) >= 4) ? aimAt(b, p.x, p.y) : false),
  };
  const ESCAPE = { vault: 1, step: 1 };
  const FALLBACK = atDense(250, 3);

  // Q skill (slot 0) by its rule.
  Brain.prototype.skills = function (ED, w, p, hpF, near) {
    if (this.castGap > 0 || !FN) return;
    SCTX.hpF = hpF; SCTX.near = near;
    const sk = p.skills[0]; if (!sk || sk.cd > 0) return;
    const rule = SKILL[sk.id] || FALLBACK;
    if (rule(this, w, p, SCTX)) { this.f.q = true; this.castGap = 6; }
  };
  // Mobility Q skill along the best escape direction (dash on cooldown). True when cast.
  Brain.prototype.escapeSkill = function (ED, w, p, best) {
    if (this.castGap > 0 || best >= NDIR) return false;
    const sk = p.skills[0]; if (!sk || sk.cd > 0 || !ESCAPE[sk.id]) return false;
    this.f.ax = p.x + DX[best] * 200; this.f.ay = p.y + DY[best] * 200;
    this.f.q = true; this.castGap = 6;
    return true;
  };

  // ---------- cards ----------
  Brain.prototype.cardScore = function (ED, w, p, c) {
    const hpF = p.hp / Math.max(1, p.maxHp);
    if (c.kind === 'form') return 2000;
    if (c.kind === 'refine') return 1200;
    if (c.kind === 'path') {
      // c.lvl - 1 = the path's current rank: the path closest to rank 3 goes first (one path to 3, then a second); ties to the path with a Form, then the lower index. Support paths below a new support.
      const d = ED.WEAPONS[c.id] || {}, pa = (d.paths || [])[c.path] || {};
      return (d.support ? 600 : 1000) + 30 * (c.lvl - 1) + (pa.form ? 5 : 0) - c.path;
    }
    if (c.kind === 'support') return 800;
    if (c.kind === 'passive' || c.kind === 'plvl') {
      const id = c.id, isNew = c.kind === 'passive';
      let s = (PASSIVE_PREF[id] || 150) * (isNew ? 1 : 0.9);
      if (hpF < 0.5 && (id === 'vigor' || id === 'plating' || id === 'mending')) s += 120;
      return s;
    }
    if (c.kind === 'skill') return 270;
    if (c.kind === 'heal') return hpF < 0.35 ? 500 : 50 + (1 - hpF) * 100;
    if (c.kind === 'gold') return 45;
    return 10;
  };
  Brain.prototype.cards = function (ED, w, p) {
    const O = p.offer;
    let bi = 0, bs = -Infinity, wi = -1, ws = Infinity;
    for (let i = 0; i < O.length; i++) {
      const s = this.cardScore(ED, w, p, O[i]);
      if (s > bs) { bs = s; bi = i; }
      if (O[i].kind !== 'gold' && O[i].kind !== 'heal' && s < ws) { ws = s; wi = i; }
    }
    if (bs < 200 && p.rerolls > 0) { this.f.reroll = true; return; }
    if (bs < 300 && wi >= 0 && ws < 160 && p.banishes > 0) { this.f.banish = wi + 1; return; }
    this.f.pick = bi + 1;
  };

  // Meta bundle for kind 'max' (every ED.SHOP rank at max) or anything else (an empty profile).
  const metaFor = (ED, kind) => {
    if (kind !== 'max') return { shop: {}, sigs: [] };
    const shop = {}; for (const s of ED.SHOP) shop[s.id] = s.max;
    return { shop, sigs: [] };
  };
  const Bot = { create: (cfg) => new Brain(cfg), metaFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = Bot; else (root.ED || (root.ED = {})).Bot = Bot;
})(globalThis);
