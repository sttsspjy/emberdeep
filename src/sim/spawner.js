// Timeline director (GAME-DESIGN §7-8): reads ED.STAGES[stage].timeline per minute (rate, cap, roster), spawns on a ring 380-460 px from a random living hero (never inside obstacles);
// successive spawn angles step by the golden angle (+-0.3 rad jitter), so foes arrive from every side;
// swarm events, elites and boss timers from the stage data. Party scaling: rate and cap x (1 + 0.25 per extra hero), hard cap 900; a living boss halves the rate.
// Density floor: while alive < row.floor x alive cap the spawn budget is raised to REFILL x the deficit (at least REFILL_MIN, at most REFILL_MAX per tick), so the screen refills within ~0.4 s.
// Packs: def.pack foes spawn [min, max] together (1 spawn each);
// def.wall packs spawn as a line across the hero's direction, def.wall px apart, each member keeping its side offset in e.aa (AI.march).
// Flock (every events.flock.every s from events.flock.first): the stage's swarmer on the spawn ring at the next golden-angle step around a random living hero (8 at 0:40 to 40 at 10:00 to 52 at 20:00 x party factor),
// 50/50 a tight pack or a line (x1.5 members, LINE_GAP px apart across the heading); may exceed the alive cap by FLOCK_OVER (25%), never the hard cap; swarm-brain non-solo kinds come only from flocks and swarm events.
// Swarm event (every events.swarm.every s): a closing ring of swarmers through one hero's spot, or a stampede line crossing that hero's screen (24 at the first event to 50 by 12:00 to 60 by 20:00).
// Flock and swarm-event members fly through (foes.js): a fixed heading through the hero's spot at FLY_V x W.foePace px/s, never chasing; rush time covers the crossing (distance + FLY_PAST px);
// stampede members cycle the ring ids plus the stampede ids present in the current roster (a dasher member at W.dasherCap is skipped).
// Benchmark phase (stage bench { t, elite }): from bench.t a 'warn' { kind: 'surge' } event and elites every bench.elite s.
// Brain caps: a roster pick of a ranged-brain foe while alive ranged foes >= W.shooterCap (summoner: W.summonerCap; charger / diver / blinker together: W.dasherCap; brute: W.bruteCap) is re-picked among the uncapped roster rows;
// packs shrink to the room left under their cap; elites never promote a capped kind (elite brutes may exceed the brute cap by 2); stampedes skip dasher members at the cap.
// Elites: a non-swarm, non-exploder roster foe promoted. Bosses: a 5 s 'warn' event, then w.spawnBoss; a stage boss id without an ED.Bosses script spawns the stage's brute as an elite boss stand-in.
// Last Light lap (lap.js): alive cap = hard cap, density floor 100%, the final-minute roster; no flocks, swarm events, elites or bosses; nothing spawns during the calm before it.
// Stage kin (boss adds, bosses.js W.addKin): w.stageKin(id) maps a foe id to this stage's foe of the same kind, from a table built once at initSpawner; w.foeAtCap(def) counts its brain cap fresh.
(function (ED) {
  'use strict';
  const U = ED.U, W = ED.World.prototype;
  const HARD_CAP = W.HARD_CAP = 900, RING = [380, 460], BOSS_WARN = 5, SWARM_R = 430, REFILL = 0.1, REFILL_MIN = 6, REFILL_MAX = 40, GOLDEN = Math.PI * (3 - Math.sqrt(5)), FLOCK_R = 40, FLOCK_MID = 600, FLOCK_FULL = 1200, SWARM_MID = 720, SWARM_FULL = 1200, FLOCK_OVER = 1.25, LINE_GAP = 14, FLY_V = 120, FLY_PAST = 700;

  W.initSpawner = function () {
    const sd = this.sdef, ev = (sd.events && sd.events.swarm) || null, fl = (sd.events && sd.events.flock) || null, el = sd.elites || null;
    this.sp = { acc: 0, ang: 0, swarmT: ev ? ev.first : Infinity, flockT: fl ? fl.first : Infinity, fopt: { rush: [0, 0, 0, 0] }, eliteT: el ? el.first : Infinity, bossI: 0, warnI: -1, pt: { x: 0, y: 0 }, rows: [], free: [], ids: [], bench: false, nR: -1, nS: -1, nD: -1, nB: -1, kin: kinTable(sd) };
  };
  // Kind of foe def: 'splitter' for a splitting chaser, else its brain (def.ai).
  const kindOf = (d) => (d.split && d.ai === 'chaser' ? 'splitter' : d.ai);
  // Stage kin table { foeId: id } of stage def sd. Native ids (timeline rosters, flock and swarm ids, split children and summon ids of natives) and boss defs map to themselves;
  // any other id maps to the roster foe of its kind (a splitter falls back to its brain) with the highest weight summed over the timeline (first listed on a tie), a swarm brain to the flock id, else itself.
  const kinTable = (sd) => {
    const tot = Object.create(null), nat = Object.create(null), kin = Object.create(null), q = [];
    const mark = (id) => { if (ED.FOES[id] && !nat[id]) { nat[id] = true; q.push(id); } };
    for (const row of sd.timeline) for (const r of row.roster) { tot[r[0]] = (tot[r[0]] || 0) + r[1]; mark(r[0]); }
    const fl = sd.events && sd.events.flock, ev = sd.events && sd.events.swarm;
    if (fl) mark(fl.id);
    if (ev) { for (const id of ev.ring || []) mark(id); for (const id of ev.stampede || []) mark(id); }
    while (q.length) { const d = ED.FOES[q.pop()]; if (d.split) mark(d.split.id); if (d.summon) for (const id of d.summon.ids) mark(id); }
    const best = (test) => { let b = null; for (const id in tot) if (test(ED.FOES[id]) && (!b || tot[id] > tot[b])) b = id; return b; };
    for (const id of ED.FOE_IDS) {
      const d = ED.FOES[id];
      if (nat[id] || d.boss) { kin[id] = id; continue; }
      const k = kindOf(d);
      kin[id] = best(x => kindOf(x) === k) || best(x => x.ai === d.ai) || (d.ai === 'swarm' && fl && ED.FOES[fl.id] ? fl.id : id);
    }
    return kin;
  };
  // This stage's foe id of the same kind as foe id (see kinTable); an unknown id returns itself.
  W.stageKin = function (id) { return this.sp.kin[id] || id; };
  // Alive ranged-brain foes allowed: round(min(8, 3 + 0.4 x minute) x party factor); summoners: round(2 x party factor).
  W.shooterCap = function () { return Math.round(Math.min(8, 3 + 0.4 * this.time / 60) * (1 + 0.25 * (this.partyN - 1))); };
  W.summonerCap = function () { return Math.round(2 * (1 + 0.25 * (this.partyN - 1))); };
  // Alive charger / diver / blinker foes allowed (one shared count): round(min(12, 3 + 0.6 x minute) x party factor).
  W.dasherCap = function () { return Math.round(Math.min(12, 3 + 0.6 * this.time / 60) * (1 + 0.25 * (this.partyN - 1))); };
  // Alive brute-brain foes allowed: round(min(8, 2 + 0.35 x minute) x party factor).
  W.bruteCap = function () { return Math.round(Math.min(8, 2 + 0.35 * this.time / 60) * (1 + 0.25 * (this.partyN - 1))); };
  W.timelineRow = function () { const tl = this.sdef.timeline; return tl[Math.min(tl.length - 1, Math.floor(this.time / 60))]; };
  W.aliveCap = function () { const row = this.timelineRow(); return Math.min(HARD_CAP, Math.round(row.cap * (1 + 0.25 * (this.partyN - 1)))); };

  // A free point on a ring rmin..rmax around hero p (ahead: within 70 degrees of its movement when it moves; a0: the first try at angle a0, later tries random). Returns the scratch point or null after 8 tries.
  W.ringPoint = function (p, rmin, rmax, ahead, a0) {
    const A = this.arena, pt = this.sp.pt;
    for (let i = 0; i < 8; i++) {
      const a = ahead && p.moving ? p.mdir + this.rng.range(-1.2, 1.2) : i === 0 && a0 !== undefined ? a0 : this.rng.next() * U.TAU, d = this.rng.range(rmin, rmax);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (!ED.Arena.blocked(A, x, y, 14)) { pt.x = x; pt.y = y; return pt; }
    }
    return null;
  };
  const pickRoster = (w, roster) => w.rng.weighted(roster, r => r[1])[0];
  const isDasher = (ai) => ai === 'charger' || ai === 'diver' || ai === 'blinker';
  // Alive non-boss foes with brain ai ('dasher': charger, diver or blinker).
  const aliveAi = (w, ai) => {
    let c = 0; const F = w.foes;
    for (let i = 0; i < F.length; i++) { const e = F[i]; if (!e.dead && !e.boss && (ai === 'dasher' ? isDasher(e.def.ai) : e.def.ai === ai)) c++; }
    return c;
  };
  // Room left under def's brain cap (Infinity for an uncapped brain); counts once per spawner tick into sp.nR / sp.nS / sp.nD / sp.nB (spawns add to them).
  const capRoom = (w, def) => {
    const sp = w.sp;
    if (def.ai === 'ranged') { if (sp.nR < 0) sp.nR = aliveAi(w, 'ranged'); return w.shooterCap() - sp.nR; }
    if (def.ai === 'summoner') { if (sp.nS < 0) sp.nS = aliveAi(w, 'summoner'); return w.summonerCap() - sp.nS; }
    if (isDasher(def.ai)) { if (sp.nD < 0) sp.nD = aliveAi(w, 'dasher'); return w.dasherCap() - sp.nD; }
    if (def.ai === 'brute') { if (sp.nB < 0) sp.nB = aliveAi(w, 'brute'); return w.bruteCap() - sp.nB; }
    return Infinity;
  };
  const atCap = (w, def) => capRoom(w, def) <= 0;
  // True when def's brain is at its alive cap, counted fresh (no spawner-tick cache); boss defs and uncapped brains never are.
  W.foeAtCap = function (def) {
    if (def.boss) return false;
    if (def.ai === 'ranged') return aliveAi(this, 'ranged') >= this.shooterCap();
    if (def.ai === 'summoner') return aliveAi(this, 'summoner') >= this.summonerCap();
    if (isDasher(def.ai)) return aliveAi(this, 'dasher') >= this.dasherCap();
    if (def.ai === 'brute') return aliveAi(this, 'brute') >= this.bruteCap();
    return false;
  };
  const counted = (sp, def, n) => {
    if (def.ai === 'ranged') { if (sp.nR >= 0) sp.nR += n; } else if (def.ai === 'summoner') { if (sp.nS >= 0) sp.nS += n; } else if (isDasher(def.ai)) { if (sp.nD >= 0) sp.nD += n; } else if (def.ai === 'brute' && sp.nB >= 0) sp.nB += n;
  };
  // A roster id: a weighted pick, re-picked among the uncapped rows when it lands on a capped kind. Returns null when every row is capped.
  const pickFree = (w, roster) => {
    const id = pickRoster(w, roster);
    if (!atCap(w, ED.FOES[id])) return id;
    const rows = w.sp.free; rows.length = 0;
    for (const r of roster) if (!atCap(w, ED.FOES[r[0]])) rows.push(r);
    return rows.length ? pickRoster(w, rows) : null;
  };
  const randHero = (w) => w.living[w.rng.int(0, w.living.length - 1)];
  // Event size at time t: n[0] at t0 rising linearly to n[1] at t1, then to n[2] (n[1] when absent) at t2; holds after.
  const ramp = (t, n, t0, t1, t2) => (t < t1 ? n[0] + (n[1] - n[0]) * U.clamp((t - t0) / Math.max(1, t1 - t0), 0, 1) : n[1] + ((n.length > 2 ? n[2] : n[1]) - n[1]) * Math.min(1, (t - t1) / (t2 - t1)));

  // Spawns n foes of id scattered within spread px of (x, y), skipping blocked spots. Returns the number spawned.
  W.spawnPack = function (id, x, y, n, spread) {
    const def = ED.FOES[id]; let c = 0;
    for (let i = 0; i < n; i++) {
      const a = this.rng.next() * U.TAU, d = this.rng.range(0, spread), fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d;
      if (!ED.Arena.blocked(this.arena, fx, fy, def.r)) { this.spawnFoe(id, fx, fy); c++; }
    }
    return c;
  };

  // Wall pack: n foes of id in a line through (x, y) across the direction to hero p, def.wall px apart; e.aa = each member's side offset (AI.march). Returns the number spawned.
  W.spawnWall = function (id, x, y, n, p) {
    const def = ED.FOES[id], dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * def.wall, fx = x + nx * o, fy = y + ny * o;
      if (ED.Arena.blocked(this.arena, fx, fy, def.r)) continue;
      this.spawnFoe(id, fx, fy).aa = o; c++;
    }
    return c;
  };

  // Fly-through options in sp.fopt: heading (dx, dy), rush time for dist px to the hero's spot plus FLY_PAST, speed FLY_V x pace.
  const fly = (w, dx, dy, dist) => { const ru = w.sp.fopt.rush, v = FLY_V * w.foePace(); ru[0] = dx; ru[1] = dy; ru[2] = (dist + FLY_PAST) / v; ru[3] = v; return w.sp.fopt; };

  // Flock event around hero p: round(n x party factor) foes of ev.id (n: ev.n[0] at ev.first to ev.n[1] at FLOCK_MID s to ev.n[2] at FLOCK_FULL s, then holds; x1.5 for a line; at most the hard cap and FLOCK_OVER room) around a ring point
  // at the next golden-angle step, all flying the centre's heading through p's spot. Pack: within FLOCK_R px (blocked spots take the free centre); line: LINE_GAP px apart across the heading (blocked spots skipped).
  // Returns the number spawned.
  W.flockEvent = function (ev, p) {
    const sp = this.sp, line = this.rng.chance(0.5);
    const n = Math.min(Math.round(ramp(this.time, ev.n, ev.first, FLOCK_MID, FLOCK_FULL) * (1 + 0.25 * (this.partyN - 1)) * (line ? 1.5 : 1)), HARD_CAP - this.foes.length, Math.round(this.aliveCap() * FLOCK_OVER) - this.foes.length);
    sp.ang = (sp.ang + GOLDEN + this.rng.range(-0.3, 0.3)) % U.TAU;
    const pt = n > 0 ? this.ringPoint(p, RING[0], RING[1], false, sp.ang) : null;
    if (!pt) return 0;
    const cx = pt.x, cy = pt.y, def = ED.FOES[ev.id], dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, o = fly(this, ux, uy, d);
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (line) {
        const l = (i - (n - 1) / 2) * LINE_GAP, x = cx - uy * l, y = cy + ux * l;
        if (ED.Arena.blocked(this.arena, x, y, def.r)) continue;
        this.spawnFoe(ev.id, x, y, o); c++;
      } else {
        const a = this.rng.next() * U.TAU, r = this.rng.range(0, FLOCK_R), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, free = !ED.Arena.blocked(this.arena, x, y, def.r);
        this.spawnFoe(ev.id, free ? x : cx, free ? y : cy, o); c++;
      }
    }
    return c;
  };

  // Swarm event around hero p: ring (members fly in from SWARM_R px through p's spot and arrive together) or stampede (a line 460 px behind, flying across p's screen).
  W.swarmEvent = function (ev, p) {
    const n = Math.min(Math.round(ramp(this.time, ev.n, ev.first, SWARM_MID, SWARM_FULL) + this.rng.range(-4, 4)), HARD_CAP - this.foes.length);
    if (n <= 0) return;
    const ring = this.rng.chance(0.5), A = this.arena;
    this.sp.nD = -1;
    let ids = ev.ring;
    if (!ring && ev.stampede) {
      ids = this.sp.ids; ids.length = 0;
      const roster = this.timelineRow().roster;
      for (const id of ev.ring) ids.push(id);
      for (const id of ev.stampede) if (ids.indexOf(id) < 0 && roster.some(r => r[0] === id)) ids.push(id);
    }
    if (ring) {
      const off = this.rng.next() * U.TAU;
      for (let i = 0; i < n; i++) {
        const id = ids[i % ids.length], def = ED.FOES[id], a = off + i / n * U.TAU, x = p.x + Math.cos(a) * SWARM_R, y = p.y + Math.sin(a) * SWARM_R;
        if (ED.Arena.blocked(A, x, y, def.r)) continue;
        this.spawnFoe(id, x, y, fly(this, -Math.cos(a), -Math.sin(a), SWARM_R));
      }
    } else {
      const a = this.rng.next() * U.TAU, dx = Math.cos(a), dy = Math.sin(a), cx = p.x - dx * 460, cy = p.y - dy * 460, o = fly(this, dx, dy, 460);
      for (let i = 0; i < n; i++) {
        const id = ids[i % ids.length], def = ED.FOES[id], l = (i / (n - 1 || 1) - 0.5) * 560, j = this.rng.range(-36, 36), x = cx - dy * l + dx * j, y = cy + dx * l + dy * j;
        if (ED.Arena.blocked(A, x, y, def.r)) continue;
        if (isDasher(def.ai)) { if (atCap(this, def)) continue; counted(this.sp, def, 1); }
        this.spawnFoe(id, x, y, o);
      }
    }
    this.emit({ t: 'warn', kind: 'swarm', ring, pid: p.pid });
  };

  // Stand-in for a boss without a script: the stage's strongest brute as an elite with boss HP (GAME-DESIGN §8), flagged boss (chest, boss bar, victory when final).
  W.standInBoss = function (b) {
    const L = this.living; if (!L.length) return null;
    let id = null;
    for (const r of this.sdef.timeline[this.sdef.timeline.length - 1].roster) { const d = ED.FOES[r[0]]; if (d && d.brute && (!id || d.hp > ED.FOES[id].hp)) id = r[0]; }
    if (!id) return null;
    const p = randHero(this), pt = this.ringPoint(p, 260, 320, false) || { x: p.x + 280, y: p.y };
    const e = this.spawnFoe(id, pt.x, pt.y, { elite: true });
    e.boss = true; e.final = !!b.final;
    e.maxHp = e.hp = this.bossHp(b.t);
    this.bossList.push(e); this.boss = e;
    this.emit({ t: 'boss', id, fid: e.id, phase: 0, final: e.final });
    return e;
  };

  W.updateSpawner = function (dt) {
    const L = this.living, lap = this.lap;
    if (!L.length || (lap && !lap.ph)) return;
    const sd = this.sdef, row = lap ? sd.timeline[sd.timeline.length - 1] : this.timelineRow(), party = 1 + 0.25 * (this.partyN - 1), cap = lap ? HARD_CAP : this.aliveCap(), sp = this.sp;
    sp.nR = sp.nS = sp.nD = sp.nB = -1;
    const deficit = (lap ? 1 : row.floor || 0) * cap - this.foes.length;
    sp.acc = Math.min(10, sp.acc + row.rate * party * (this.boss ? 0.5 : 1) * dt);
    if (deficit > 0) sp.acc = Math.max(sp.acc, Math.min(REFILL_MAX, Math.max(REFILL_MIN, deficit * REFILL)));
    while (sp.acc >= 1 && this.foes.length < cap) {
      sp.ang = (sp.ang + GOLDEN + this.rng.range(-0.3, 0.3)) % U.TAU;
      const id = pickFree(this, row.roster);
      if (!id) { sp.acc -= 1; continue; }
      const def = ED.FOES[id], h = randHero(this), pt = this.ringPoint(h, RING[0], RING[1], false, sp.ang);
      if (!pt) { sp.acc -= 1; continue; }
      const x = pt.x, y = pt.y, room = cap - this.foes.length;
      if (def.pack) {
        const n = Math.min(this.rng.int(def.pack[0], def.pack[1]), room, capRoom(this, def));
        counted(sp, def, def.wall ? this.spawnWall(id, x, y, n, h) : this.spawnPack(id, x, y, n, 30));
        sp.acc -= Math.max(1, n);
      } else { this.spawnFoe(id, x, y); counted(sp, def, 1); sp.acc -= 1; }
    }
    if (lap) return;
    // flock
    const fl = sd.events && sd.events.flock;
    if (fl && this.time >= sp.flockT) { sp.flockT += fl.every; this.flockEvent(fl, randHero(this)); }
    // swarm event
    const ev = sd.events && sd.events.swarm;
    if (ev && this.time >= sp.swarmT) { sp.swarmT += ev.every; this.swarmEvent(ev, randHero(this)); }
    // benchmark phase: one 'surge' warning, then elites every bench.elite s
    const bn = sd.bench;
    if (bn && !sp.bench && this.time >= bn.t) { sp.bench = true; this.emit({ t: 'warn', kind: 'surge' }); }
    // elite: a non-swarm, non-exploder roster foe promoted (never a kind at its alive cap; elite brutes may exceed the brute cap by 2)
    const el = sd.elites;
    if (el && this.time >= sp.eliteT) {
      sp.eliteT += sp.bench ? bn.elite : el.every;
      const rows = sp.rows; rows.length = 0;
      for (const r of row.roster) { const d = ED.FOES[r[0]]; if (d.ai !== 'swarm' && d.ai !== 'exploder' && !d.noElite && capRoom(this, d) > (d.brute ? -2 : 0)) rows.push(r); }
      const pt = this.ringPoint(randHero(this), RING[0], RING[1], false);
      if (rows.length && pt) { const e = this.spawnFoe(pickRoster(this, rows), pt.x, pt.y, { elite: true }); counted(sp, e.def, 1); this.emit({ t: 'warn', kind: 'elite', id: e.id, k: e.k }); }
    }
    // bosses: a warning BOSS_WARN s ahead, then the spawn (bosses.js spawnBoss, or a stand-in when the id has no script)
    const b = sd.bosses && sd.bosses[sp.bossI];
    if (b) {
      if (sp.warnI < sp.bossI && this.time >= b.t - BOSS_WARN) { sp.warnI = sp.bossI; this.emit({ t: 'warn', kind: 'boss', id: b.id, final: !!b.final }); }
      if (this.time >= b.t) {
        sp.bossI++;
        const scripted = ED.FOES[b.id] && typeof ED.Bosses[b.id] === 'function';
        if (!(scripted && this.spawnBoss(b))) this.standInBoss(b);
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
