// Timeline director (GAME-DESIGN §7-8): reads ED.STAGES[stage].timeline per minute (rate, cap, roster), spawns on a ring 380-460 px from a random living hero (never inside obstacles),
// swarm events, elites and boss timers from the stage data. Party scaling: rate and cap x (1 + 0.25 per extra hero), hard cap 900; a living boss halves the rate.
// Swarm-brain roster picks spawn as packs of 12-30 (each member costs 0.5 of a spawn).
(function (ED) {
  'use strict';
  const U = ED.U, W = ED.World.prototype;
  const HARD_CAP = 900, RING = [380, 460], BOSS_WARN = 5;

  W.initSpawner = function () {
    const sd = this.sdef, ev = (sd.events && sd.events.swarm) || null, el = sd.elites || null;
    this.sp = { acc: 0, swarmT: ev ? ev.first : Infinity, eliteT: el ? el.first : Infinity, bossI: 0, warnI: -1, pt: { x: 0, y: 0 } };
  };
  W.timelineRow = function () { const tl = this.sdef.timeline; return tl[Math.min(tl.length - 1, Math.floor(this.time / 60))]; };
  W.aliveCap = function () { const row = this.timelineRow(); return Math.min(HARD_CAP, Math.round(row.cap * (1 + 0.25 * (this.partyN - 1)))); };

  // A free point on a ring rmin..rmax around hero p (ahead: within 70 degrees of its movement when it moves). Returns the scratch point or null after 8 tries.
  W.ringPoint = function (p, rmin, rmax, ahead) {
    const A = this.arena, pt = this.sp.pt;
    for (let i = 0; i < 8; i++) {
      const a = ahead && p.moving ? p.mdir + this.rng.range(-1.2, 1.2) : this.rng.next() * U.TAU, d = this.rng.range(rmin, rmax);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (!ED.Arena.blocked(A, x, y, 14)) { pt.x = x; pt.y = y; return pt; }
    }
    return null;
  };
  const pickRoster = (w, roster) => w.rng.weighted(roster, r => r[1])[0];

  W.updateSpawner = function (dt) {
    const L = this.living;
    if (!L.length) return;
    const sd = this.sdef, row = this.timelineRow(), party = 1 + 0.25 * (this.partyN - 1), cap = this.aliveCap(), sp = this.sp;
    sp.acc = Math.min(10, sp.acc + row.rate * party * (this.boss ? 0.5 : 1) * dt);
    while (sp.acc >= 1 && this.foes.length < cap) {
      const id = pickRoster(this, row.roster), def = ED.FOES[id], p = L[this.rng.int(0, L.length - 1)], pt = this.ringPoint(p, RING[0], RING[1], false);
      if (!pt) { sp.acc -= 1; continue; }
      if (def.ai === 'swarm' && !def.solo) {
        const n = Math.min(this.rng.int(12, 30), cap - this.foes.length), x = pt.x, y = pt.y;
        for (let i = 0; i < n; i++) { const a = this.rng.next() * U.TAU, d = this.rng.range(0, 40); const fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d; if (!ED.Arena.blocked(this.arena, fx, fy, def.r)) this.spawnFoe(id, fx, fy); }
        sp.acc -= Math.max(1, n * 0.5);
      } else { this.spawnFoe(id, pt.x, pt.y); sp.acc -= 1; }
    }
    // swarm event: a closing ring of 40-80 swarmers around one hero, or a stampede line crossing its screen
    const ev = sd.events && sd.events.swarm;
    if (ev && this.time >= sp.swarmT) {
      sp.swarmT += ev.every;
      const p = L[this.rng.int(0, L.length - 1)], id = ev.ids[this.rng.int(0, ev.ids.length - 1)], n = Math.min(this.rng.int(ev.n[0], ev.n[1]), HARD_CAP - this.foes.length);
      if (n > 0) {
        const ring = this.rng.chance(0.5);
        if (ring) for (let i = 0; i < n; i++) { const a = i / n * U.TAU, x = p.x + Math.cos(a) * 420, y = p.y + Math.sin(a) * 420; if (!ED.Arena.blocked(this.arena, x, y, 8)) this.spawnFoe(id, x, y); }
        else {
          const a = this.rng.next() * U.TAU, dx = Math.cos(a), dy = Math.sin(a), cx = p.x - dx * 460, cy = p.y - dy * 460;
          for (let i = 0; i < n; i++) { const o = (i / (n - 1 || 1) - 0.5) * 520, j = this.rng.range(-30, 30), x = cx - dy * o + dx * j, y = cy + dx * o + dy * j; if (!ED.Arena.blocked(this.arena, x, y, 8)) this.spawnFoe(id, x, y, { rush: [dx, dy] }); }
        }
        this.emit({ t: 'warn', kind: 'swarm', ring, pid: p.pid });
      }
    }
    // elite: a non-swarm roster foe promoted
    const el = sd.elites;
    if (el && this.time >= sp.eliteT) {
      sp.eliteT += el.every;
      const rows = row.roster.filter(r => ED.FOES[r[0]].ai !== 'swarm' && !ED.FOES[r[0]].noElite), p = L[this.rng.int(0, L.length - 1)], pt = this.ringPoint(p, RING[0], RING[1], false);
      if (rows.length && pt) { const e = this.spawnFoe(pickRoster(this, rows), pt.x, pt.y, { elite: true }); this.emit({ t: 'warn', kind: 'elite', id: e.id, k: e.k }); }
    }
    // bosses: a warning BOSS_WARN s ahead, then the spawn (bosses.js spawnBoss)
    const b = sd.bosses && sd.bosses[sp.bossI];
    if (b) {
      if (sp.warnI < sp.bossI && this.time >= b.t - BOSS_WARN) { sp.warnI = sp.bossI; this.emit({ t: 'warn', kind: 'boss', id: b.id, final: !!b.final }); }
      if (this.time >= b.t) { sp.bossI++; this.spawnBoss(b); }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
