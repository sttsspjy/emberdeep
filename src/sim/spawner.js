// Timeline director (GAME-DESIGN §7-8): reads ED.STAGES[stage].timeline per minute (rate, cap, roster), spawns on a ring 380-460 px from a random living hero (never inside obstacles);
// successive spawn angles step by the golden angle (+-0.3 rad jitter), so foes arrive from every side;
// swarm events, elites and boss timers from the stage data. Party scaling: rate and cap x (1 + 0.25 per extra hero), hard cap 900; a living boss halves the rate.
// Density floor: while alive < row.floor x alive cap the spawn budget is raised to REFILL x the deficit (at most REFILL_MAX per tick), so the screen refills within ~0.3 s.
// Packs: swarm-brain roster picks spawn a pack sized by PACK (3-4 at 0:00, 8-10 at 5:00, 12-16 from 10:00; each member costs 0.5 of a spawn); def.pack foes spawn [min, max] together (1 each);
// def.wall packs spawn as a line across the hero's direction, def.wall px apart, each member keeping its side offset in e.aa (AI.march).
// Swarm event (every events.swarm.every s): a closing ring of swarmers rushing at one hero's spot, or a stampede line crossing that hero's screen (24 at the first event to 50 by 12:00); rush time uses the foe's paced speed (W.foePace);
// stampede members cycle the ring ids plus the stampede ids present in the current roster.
// Benchmark phase (stage bench { t, elite }): from bench.t a 'warn' { kind: 'surge' } event and elites every bench.elite s.
// Elites: a non-swarm, non-exploder roster foe promoted. Bosses: a 5 s 'warn' event, then w.spawnBoss; a stage boss id without an ED.Bosses script spawns the stage's brute as an elite boss stand-in.
(function (ED) {
  'use strict';
  const U = ED.U, W = ED.World.prototype;
  const HARD_CAP = 900, RING = [380, 460], BOSS_WARN = 5, SWARM_R = 430, REFILL = 0.1, REFILL_MAX = 40, GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const PACK = [[0, 3, 4], [5, 8, 10], [10, 12, 16]]; // swarm pack size keys [minute, min, max], linear between keys, the last holds

  W.initSpawner = function () {
    const sd = this.sdef, ev = (sd.events && sd.events.swarm) || null, el = sd.elites || null;
    this.sp = { acc: 0, ang: 0, swarmT: ev ? ev.first : Infinity, eliteT: el ? el.first : Infinity, bossI: 0, warnI: -1, pt: { x: 0, y: 0 }, rows: [], ids: [], bench: false };
  };
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
  const randHero = (w) => w.living[w.rng.int(0, w.living.length - 1)];
  // Swarm pack size at minute m: a random int in the PACK range at m.
  const packN = (w, m) => {
    let i = 0; while (i < PACK.length - 2 && m >= PACK[i + 1][0]) i++;
    const a = PACK[i], b = PACK[i + 1], k = U.clamp((m - a[0]) / (b[0] - a[0]), 0, 1);
    return w.rng.int(Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k));
  };

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

  // Swarm event around hero p: ring (members rush toward p's spot and arrive together) or stampede (a line 460 px behind, rushing across p's screen).
  W.swarmEvent = function (ev, p) {
    const k = Math.min(1, Math.max(0, (this.time - ev.first) / Math.max(1, 720 - ev.first)));
    const n = Math.min(Math.round(ev.n[0] + (ev.n[1] - ev.n[0]) * k + this.rng.range(-4, 4)), HARD_CAP - this.foes.length);
    if (n <= 0) return;
    const ring = this.rng.chance(0.5), A = this.arena;
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
        const id = ids[i % ids.length], def = ED.FOES[id], v = def.spd * this.foePace() * 1.3, a = off + i / n * U.TAU, x = p.x + Math.cos(a) * SWARM_R, y = p.y + Math.sin(a) * SWARM_R;
        if (ED.Arena.blocked(A, x, y, def.r)) continue;
        this.spawnFoe(id, x, y, { rush: [-Math.cos(a), -Math.sin(a), (SWARM_R - 30) / v] });
      }
    } else {
      const a = this.rng.next() * U.TAU, dx = Math.cos(a), dy = Math.sin(a), cx = p.x - dx * 460, cy = p.y - dy * 460;
      for (let i = 0; i < n; i++) {
        const id = ids[i % ids.length], def = ED.FOES[id], v = def.spd * this.foePace() * 1.3, o = (i / (n - 1 || 1) - 0.5) * 560, j = this.rng.range(-36, 36), x = cx - dy * o + dx * j, y = cy + dx * o + dy * j;
        if (ED.Arena.blocked(A, x, y, def.r)) continue;
        this.spawnFoe(id, x, y, { rush: [dx, dy, Math.min(9, 960 / v)] });
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
    const L = this.living;
    if (!L.length) return;
    const sd = this.sdef, row = this.timelineRow(), party = 1 + 0.25 * (this.partyN - 1), cap = this.aliveCap(), sp = this.sp;
    const deficit = (row.floor || 0) * cap - this.foes.length;
    sp.acc = Math.min(10, sp.acc + row.rate * party * (this.boss ? 0.5 : 1) * dt);
    if (deficit > 0) sp.acc = Math.max(sp.acc, Math.min(REFILL_MAX, Math.max(1, deficit * REFILL)));
    while (sp.acc >= 1 && this.foes.length < cap) {
      sp.ang = (sp.ang + GOLDEN + this.rng.range(-0.3, 0.3)) % U.TAU;
      const id = pickRoster(this, row.roster), def = ED.FOES[id], h = randHero(this), pt = this.ringPoint(h, RING[0], RING[1], false, sp.ang);
      if (!pt) { sp.acc -= 1; continue; }
      const x = pt.x, y = pt.y, room = cap - this.foes.length;
      if (def.ai === 'swarm' && !def.solo) {
        const n = Math.min(packN(this, this.time / 60), room);
        this.spawnPack(id, x, y, n, 44);
        sp.acc -= Math.max(1, n * 0.5);
      } else if (def.pack) {
        const n = Math.min(this.rng.int(def.pack[0], def.pack[1]), room);
        if (def.wall) this.spawnWall(id, x, y, n, h); else this.spawnPack(id, x, y, n, 30);
        sp.acc -= Math.max(1, n);
      } else { this.spawnFoe(id, x, y); sp.acc -= 1; }
    }
    // swarm event
    const ev = sd.events && sd.events.swarm;
    if (ev && this.time >= sp.swarmT) { sp.swarmT += ev.every; this.swarmEvent(ev, randHero(this)); }
    // benchmark phase: one 'surge' warning, then elites every bench.elite s
    const bn = sd.bench;
    if (bn && !sp.bench && this.time >= bn.t) { sp.bench = true; this.emit({ t: 'warn', kind: 'surge' }); }
    // elite: a non-swarm, non-exploder roster foe promoted
    const el = sd.elites;
    if (el && this.time >= sp.eliteT) {
      sp.eliteT += sp.bench ? bn.elite : el.every;
      const rows = sp.rows; rows.length = 0;
      for (const r of row.roster) { const d = ED.FOES[r[0]]; if (d.ai !== 'swarm' && d.ai !== 'exploder' && !d.noElite) rows.push(r); }
      const pt = this.ringPoint(randHero(this), RING[0], RING[1], false);
      if (rows.length && pt) { const e = this.spawnFoe(pickRoster(this, rows), pt.x, pt.y, { elite: true }); this.emit({ t: 'warn', kind: 'elite', id: e.id, k: e.k }); }
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
