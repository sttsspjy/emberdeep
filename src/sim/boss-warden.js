// I. The Bone Warden: a sword duelist. Strings of telegraphed swings end in a ground slam that leaves him stuck WARDEN.stuck s taking x WARDEN.punish damage (the punish window).
// Phase 2 raises bone walls (breakable blocks) that split the room into three lanes and adds the lane charge; phase 3 drops the walls, and spectral swords fall on telegraphed lines while he keeps dueling. No volley, no adds.
// Every wind-up is scaled by e.vars.wm (the boss's windMul when the attack began).
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, B = ED.Bosses, L = B.lib, T = ED.CONST.TILE;
  const { line, cone, tele, aim, mv } = L;
  const WD = B.WARDEN = {
    swing: { r: 96, arc: 2.0, wind: 0.6, mul: 1.1 }, // wide swing
    cut: { r: 108, arc: 1.3, wind: 0.42, mul: 1.0 }, // fast narrow cut
    slam: { r: 100, off: 26, wind: 0.85, mul: 1.5 }, // the finisher: a circle centred `off` px ahead of him
    sweep: { r: 126, arc: 4.4, wind: 0.85, mul: 1.2 }, // wide sweep: only behind him is safe
    lunge: { len: 230, w: 46, wind: 0.6, speed: 620, mul: 1.2 }, // warn line, then a dash along it (a hero he passes takes the hit)
    step: { t: 0.14, d: 48 }, // the glide toward the target before each swing
    gapT: 0.14, // pause after a swing
    stuck: 1.2, punish: 1.5, // the punish window after the slam
    walls: { warn: 1.1, hp: 3, block: 2, gap: 3 }, // phase 2: warn s, hits per block, tiles per block, tiles per gap (2 gaps per wall)
    lane: { leap: 0.75, wind: 1.0, speed: 560, mul: 1.4, end: 0.5 }, // lane charge: leap to the lane end, the lane-wide warning, charge speed, recovery
    swords: { gap: 3.0, wind: 1.1, w: 30, len: 380, mul: 0.8, first: 1.5 }, // phase 3: s between drops, wind-up, line width and length
  };
  // Swing strings by phase; every one ends in the slam.
  const SEQ = [
    [['swing', 'cut', 'slam'], ['cut', 'swing', 'slam']],
    [['swing', 'cut', 'slam'], ['lunge', 'sweep', 'slam'], ['cut', 'cut', 'slam']],
    [['swing', 'cut', 'swing', 'slam'], ['lunge', 'cut', 'sweep', 'slam'], ['cut', 'swing', 'cut', 'slam']],
  ];
  const dist = (e) => Math.hypot(e.target.x - e.x, e.target.y - e.y);

  // ---- one move of a string: starts its telegraph, returns its wind-up length ----
  function startMove(w, e, m) {
    const k = e.vars.wm, a = aim(e);
    e.aimA = a; e.face = Math.cos(a) >= 0 ? 1 : -1; e.pose = 'wind';
    if (m === 'swing' || m === 'cut' || m === 'sweep') { const q = WD[m]; cone(w, e, a, q.r, q.arc, q.wind * k, q.mul, () => { e.pose = 'slam'; }); return q.wind * k; }
    if (m === 'slam') { const q = WD.slam; tele(w, e, e.x + Math.cos(a) * q.off, e.y + Math.sin(a) * q.off, q.r, q.wind * k, q.mul, 'slam', () => { e.pose = 'slam'; }); return q.wind * k; }
    const q = WD.lunge; // lunge
    line(w, e, e.x, e.y, a, q.len, q.w, q.wind * k, 0, true);
    e.vars.dash = { a, left: q.len, hit: new Set() };
    return q.wind * k;
  }
  // The lunge's dash: moves along its angle; every hero within reach of the body takes the hit once. True when it ends.
  function dashStep(w, e, dt) {
    const ds = e.vars.dash, q = WD.lunge, step = Math.min(ds.left, q.speed * dt);
    const blocked = mv(w, e, Math.cos(ds.a), Math.sin(ds.a), step / dt, dt);
    ds.left -= step; e.pose = 'dash';
    for (const p of w.players.values()) if (!ds.hit.has(p.pid) && w.alive(p) && U.dist2(p.x, p.y, e.x, e.y) < (e.r + p.r + 4) ** 2) { ds.hit.add(p.pid); w.hurtPlayer(p, e.dmg * q.mul, { e, x: e.x, y: e.y }); }
    return blocked || ds.left <= 0;
  }

  // ---- the string attack: step, wind-up, release (or dash), and after the slam the punish window ----
  const combo = {
    w: 4, ok: (w, e) => dist(e) < 230,
    start(w, e) {
      const list = SEQ[Math.min(e.phase, 3) - 1];
      e.vars.seq = list[w.rng.int(0, list.length - 1)]; e.vars.i = 0; e.vars.sub = 'step'; e.vars.at = WD.step.t;
    },
    update(w, e, dt, t) {
      const v = e.vars;
      if (v.sub === 'step') { // glide toward the target, stopping short of it
        const d = dist(e);
        if (d > WD.step.d) { const dir = w.pathDir(e, e.target.x, e.target.y); mv(w, e, dir[0], dir[1], WD.step.d / WD.step.t * e.slow, dt); }
        e.pose = 'dash';
        if (t >= v.at) { v.sub = 'wind'; v.at = t + startMove(w, e, v.seq[v.i]); }
        return false;
      }
      if (v.sub === 'wind') {
        if (t < v.at) return false;
        const m = v.seq[v.i];
        if (m === 'lunge') { v.sub = 'dash'; return false; }
        if (m === 'slam') { v.sub = 'stuck'; v.at = t + WD.stuck; e.pose = 'stuck'; e.dmgTakenMul = WD.punish; w.emit({ t: 'punish', x: Math.round(e.x), y: Math.round(e.y), d: WD.stuck }); return false; }
        v.sub = 'gap'; v.at = t + WD.gapT; return false;
      }
      if (v.sub === 'dash') { if (dashStep(w, e, dt)) { v.sub = 'gap'; v.at = t + WD.gapT; } return false; }
      if (v.sub === 'gap') { if (t >= v.at) { v.i++; v.sub = 'step'; v.at = t + WD.step.t; } return false; }
      // stuck: the punish window
      e.pose = 'stuck';
      if (t < v.at) return false;
      e.dmgTakenMul = 1;
      return true;
    },
  };
  // A lone lunge closes the distance to a hero that keeps away.
  const lunge = {
    w: 3, ok: (w, e) => dist(e) >= 150,
    start(w, e) { e.vars.at = startMove(w, e, 'lunge'); e.vars.sub = 'wind'; },
    update(w, e, dt, t) {
      if (e.vars.sub === 'wind') { if (t >= e.vars.at) e.vars.sub = 'dash'; return false; }
      if (e.vars.sub === 'dash') { if (dashStep(w, e, dt)) { e.vars.sub = 'end'; e.vars.at = t + 0.35; e.pose = 'idle'; } return false; }
      return t >= e.vars.at;
    },
  };

  // ---- phase 2: walls and lanes ----
  // Two wall rows split the room's inner rows into three lanes; each wall leaves two gaps of `gap` tiles near a third and two thirds of its width (seeded), the rest stands in blocks of `block` tiles.
  function planWalls(w) {
    const room = w.room, H = room.h - 2, q = WD.walls, lane = Math.round((H - 2) / 3);
    const rows = [1 + lane, room.h - 2 - lane], walls = [], lanes = [];
    const x0 = 1, x1 = room.w - 2, span = x1 - x0 + 1;
    for (const y of rows) {
      const gaps = [Math.round(x0 + span / 3 + w.rng.range(-3, 3)), Math.round(x0 + span * 2 / 3 + w.rng.range(-3, 3))].map(c => c - (q.gap >> 1));
      let x = x0;
      while (x <= x1) {
        const g = gaps.find(g0 => x >= g0 && x < g0 + q.gap);
        if (g !== undefined) { x = g + q.gap; continue; }
        let n = 0;
        while (n < q.block && x + n <= x1 && !gaps.some(g0 => x + n >= g0 && x + n < g0 + q.gap)) n++;
        walls.push({ x, y, n, hp: q.hp, cd: 0 });
        x += n;
      }
    }
    lanes.push({ y0: 1, y1: rows[0] - 1 }, { y0: rows[0] + 1, y1: rows[1] - 1 }, { y0: rows[1] + 1, y1: room.h - 2 });
    return { walls, lanes, rows };
  }
  // Lane (tile rows y0..y1) that holds pixel row y, else the nearest one.
  const laneOf = (ar, y) => { const ty = Math.floor(y / T); let best = ar.lanes[0], bd = 1e9; for (const ln of ar.lanes) { const d = ty < ln.y0 ? ln.y0 - ty : ty > ln.y1 ? ty - ln.y1 : 0; if (d < bd) { bd = d; best = ln; } } return best; };
  // Lane charge: a telegraphed leap to the far end of the target's lane, a lane-wide warning, then a charge down the whole lane (every hero in the lane band he passes takes the hit).
  const laneCharge = {
    w: 3, phase: 2, ok: (w, e) => !!(w.arena && w.arena.lanes && w.arena.walls.some(s => s.hp > 0)),
    start(w, e) {
      const ar = w.arena;
      if (!ar || !ar.lanes) { e.vars.sub = 'end'; e.vars.at = 0; return; } // no lanes (yet): nothing to charge down
      const ln = laneOf(ar, e.target.y), room = w.room, q = WD.lane, k = e.vars.wm;
      const cy = (ln.y0 + ln.y1 + 1) / 2 * T, left = e.target.x > room.w * T / 2; // start at the end farther from the target
      const sx = left ? 1.5 * T + e.r * 0.5 : (room.w - 1.5) * T - e.r * 0.5, dir = left ? 0 : Math.PI;
      e.vars.from = [e.x, e.y]; e.vars.to = [sx, cy]; e.vars.fl = q.leap * k; e.vars.dir = dir; e.vars.sub = 'leap'; e.vars.ln = ln; e.vars.hit = new Set();
      e.pose = 'air';
      tele(w, e, sx, cy, 46, q.leap * k, 0.8, 'slam');
    },
    update(w, e, dt, t) {
      const v = e.vars, q = WD.lane, k = v.wm;
      if (v.sub === 'leap') {
        const f = Math.min(1, t / v.fl);
        e.x = U.lerp(v.from[0], v.to[0], U.easeInOut(f)); e.y = U.lerp(v.from[1], v.to[1], U.easeInOut(f)); e.pose = 'air';
        if (f >= 1) {
          Sim.resolve(e, w.room, w.locked, false);
          const hh = (v.ln.y1 - v.ln.y0 + 1) * T, z = line(w, e, e.x, (v.ln.y0 + v.ln.y1 + 1) / 2 * T, v.dir, w.room.w * T, hh - 6, q.wind * k, 0, true);
          z.lane = { y0: v.ln.y0 * T, y1: (v.ln.y1 + 1) * T }; // the band a bot must leave (host only)
          v.sub = 'wind'; v.at = t + q.wind * k; e.pose = 'wind'; e.aimA = v.dir; e.face = v.dir === 0 ? 1 : -1;
        }
        return false;
      }
      if (v.sub === 'wind') { if (t >= v.at) { v.sub = 'go'; w.emit({ t: 'lanecharge', x: Math.round(e.x), y: Math.round(e.y), a: v.dir }); } return false; }
      if (v.sub === 'go') {
        const x0 = e.x, blocked = mv(w, e, Math.cos(v.dir), 0, q.speed, dt), lo = Math.min(x0, e.x) - e.r, hi = Math.max(x0, e.x) + e.r;
        e.pose = 'dash';
        const y0 = v.ln.y0 * T, y1 = (v.ln.y1 + 1) * T;
        for (const p of w.players.values()) if (!v.hit.has(p.pid) && w.alive(p) && p.y > y0 - p.r * 0.5 && p.y < y1 + p.r * 0.5 && p.x >= lo && p.x <= hi) { v.hit.add(p.pid); w.hurtPlayer(p, e.dmg * q.mul, { e, x: e.x, y: e.y }); }
        if (blocked || Math.abs(e.x - x0) < 0.5) { v.sub = 'end'; v.at = t + q.end; e.pose = 'idle'; w.emit({ t: 'thud', x: Math.round(e.x), y: Math.round(e.y), big: 1 }); }
        return false;
      }
      return t >= v.at;
    },
  };

  // Walls rise WD.walls.warn s after the phase 2 roar (warn lines along their rows first); phase 3 drops them.
  function onPhase(w, e, ph) {
    e.dmgTakenMul = 1;
    if (ph === 2) {
      const plan = planWalls(w), q = WD.walls;
      for (const y of plan.rows) line(w, e, T, (y + 0.5) * T, 0, (w.room.w - 2) * T, T, q.warn, 0, true).detached = true;
      e.wallPlan = plan; e.wallAt = w.time + q.warn;
    } else if (ph === 3) {
      e.wallPlan = null; e.wallAt = 0;
      if (w.arena && w.arena.walls) { for (const s of w.arena.walls) if (s.hp > 0) w.emit({ t: 'wallbreak', x: Math.round((s.x + s.n / 2) * T), y: Math.round((s.y + 0.5) * T), n: s.n }); B.clearArena(w); }
      e.swT = WD.swords.first;
    }
  }
  // Spectral swords (phase 3): every `gap` s one line per living hero (two when solo) through a point near the hero at a random angle; each strikes on its own clock.
  function swords(w, e) {
    const q = WD.swords, hs = w.alivePlayers();
    const pts = hs.map(p => ({ x: p.x, y: p.y }));
    if (hs.length === 1) pts.push({ x: hs[0].x + w.rng.range(-90, 90), y: hs[0].y + w.rng.range(-70, 70) });
    for (const pt of pts) {
      const a = w.rng.range(0, Math.PI), cx = pt.x + w.rng.range(-30, 30), cy = pt.y + w.rng.range(-30, 30);
      const x0 = cx - Math.cos(a) * q.len / 2, y0 = cy - Math.sin(a) * q.len / 2;
      const z = w.addZone({ kind: 'teleLine', x: x0, y: y0, a, len: q.len, w: q.w, dur: q.wind, dmg: e.dmg * q.mul, team: 1, src: e, detached: true,
        onEnd: (ww, zz) => ww.emit({ t: 'swordfall', x0: Math.round(zz.x), y0: Math.round(zz.y), x1: Math.round(zz.x + Math.cos(zz.a) * zz.len), y1: Math.round(zz.y + Math.sin(zz.a) * zz.len) }) });
      z.sword = 1;
    }
  }
  function tick(w, e, dt) {
    if (e.wallAt && w.time >= e.wallAt) {
      const plan = e.wallPlan; e.wallAt = 0; e.wallPlan = null;
      w.arena = { walls: plan.walls, lanes: plan.lanes, carpet: null };
      B.applyArena(w.room, w.arena);
      w.emit({ t: 'wallrise', rows: plan.rows, n: w.room.w });
    }
    if (e.phase >= 3 && w.alivePlayers().length) { e.swT -= dt; if (e.swT <= 0) { e.swT = WD.swords.gap; swords(w, e); } }
  }

  const combo2 = Object.assign({}, combo, { w: combo.w / 2 }); // two keys share the string attack: the runner never repeats its last key
  combo.w /= 2;
  B.bonewarden = L.runner({ combo, combo2, lunge, lane: laneCharge }, { idle: L.approach(64), tick, onPhase, volley: false });
})(globalThis.ED || (globalThis.ED = {}));
