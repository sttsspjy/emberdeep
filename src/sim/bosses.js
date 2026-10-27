// Bosses (GAME-DESIGN §8): ED.Bosses[id] = fn(w, e, dt) (the foe brain of a boss foe def, ai 'boss'), built with ED.Bosses.lib.runner; spawn / kill / enrage bookkeeping on World.
// HP = 400 x boss minute x party factor. A living boss halves normal spawns (spawner). Mid-bosses drop a chest (evolution first) plus gems and gold; the final boss's death wins the run;
// at ED.CONST.ENRAGE_T a living final boss enrages (x3 damage and speed). Boss attack state lives in e.vars ({ phase, st, t, atk, last, at, s: per-attack scratch }).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, W = ED.World.prototype, TAU = U.TAU;
  const B = ED.Bosses = {};

  // ---------- helpers (every foe attack is telegraphed >= 0.6 s) ----------
  // Circle telegraph at (x, y): resolves after dur, dmg = e.dmg x mul to heroes inside. opt: { look, followSrc, detached, onEnd }.
  const tele = (w, e, x, y, r, dur, mul, opt) => w.zone(Object.assign({ team: 1, warn: true, x, y, r, dur, dmg: e.dmg * mul, src: e, look: 'tele' }, opt));
  // Line telegraph from (x, y) along a: len long, width wide.
  const line = (w, e, x, y, a, len, width, dur, mul, opt) => w.zone(Object.assign({ team: 1, warn: true, x, y, a, len, w: width, dur, dmg: e.dmg * mul, src: e, look: 'tele' }, opt));
  // Cone telegraph from the boss toward a (moves with it).
  const cone = (w, e, a, r, arc, dur, mul, opt) => w.zone(Object.assign({ team: 1, warn: true, x: e.x, y: e.y, a, r, arc, dur, dmg: e.dmg * mul, src: e, followSrc: true, look: 'tele' }, opt));
  // Ring of n foe shots from the boss, offset angle off, speed px/s, damage e.dmg x mul.
  const ring = (w, e, n, speed, look, off, mul, r) => { for (let i = 0; i < n; i++) w.foeShoot(e, off + i * TAU / n, speed, look, e.dmg * mul, r || 5); };
  const aim = (e) => (e.tgt ? Math.atan2(e.tgt.y - e.y, e.tgt.x - e.x) : 0);
  const mv = (w, e, dx, dy, speed, dt) => { const hit = ED.Arena.move(w.arena, e, dx * speed * dt, dy * speed * dt, e.r); if (Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1; return hit; };
  // Idle mover: closes to `pref` px of the target, then strafes.
  const approach = (pref) => (w, e, dt) => {
    const t = e.tgt; if (!t) return;
    const d = Math.hypot(t.x - e.x, t.y - e.y), v = e.vars;
    if (d > pref) w.steer(e, t.x, t.y, 1, dt);
    else { const a = aim(e) + Math.PI / 2 * (v.strafe || 1); if (mv(w, e, Math.cos(a), Math.sin(a), e.spd * 0.4, dt)) v.strafe = -(v.strafe || 1); e.face = t.x > e.x ? 1 : -1; }
  };
  // Spawns foes of ids around the boss (one extra per hero beyond the first, at most 3).
  const summon = (w, e, ids) => {
    const n = ids.length + Math.min(3, w.partyN - 1);
    for (let i = 0; i < n; i++) { const a = i / n * TAU, x = e.x + Math.cos(a) * (e.r + 30), y = e.y + Math.sin(a) * (e.r + 30); if (!ED.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ids[i % ids.length], x, y); }
  };

  // Runner: attacks = { key: { w (weight), phase (min phase), ok(w, e), wind (s of e.st 1 for the renderer), start(w, e), update(w, e, dt, t) -> done } }.
  // opts: { phases: HP fractions (default [0.66, 0.33]), idle(w, e, dt), tick(w, e, dt), onPhase(w, e, phase), pause: [s per phase] }.
  // A phase change gives 1 s invulnerability and emits { t: 'boss', id, fid, phase }.
  const runner = (attacks, opts) => {
    opts = opts || {};
    const phases = opts.phases || [0.66, 0.33], pause = opts.pause || [1.05, 0.7, 0.45], idle = opts.idle || approach(120);
    return (w, e, dt) => {
      const v = e.vars || (e.vars = { phase: 1, st: 'idle', t: 1.2, atk: '', last: '', at: 0, s: null, strafe: 1 });
      while (v.phase - 1 < phases.length && e.hp / e.maxHp < phases[v.phase - 1]) {
        v.phase++; e.invulnT = 1; v.st = 'idle'; v.t = 1.3; e.st = 0;
        w.emit({ t: 'boss', id: e.def.id, fid: e.id, phase: v.phase });
        if (opts.onPhase) opts.onPhase(w, e, v.phase);
        return;
      }
      if (opts.tick) opts.tick(w, e, dt);
      if (v.st === 'atk') {
        v.at += dt;
        const A = attacks[v.atk];
        e.st = v.at < (A.wind || 0.6) ? 1 : 2;
        if (A.update(w, e, dt, v.at)) { v.st = 'idle'; e.st = 0; v.t = pause[Math.min(pause.length, v.phase) - 1] / (e.enraged ? 2 : 1); }
        return;
      }
      v.t -= dt;
      idle(w, e, dt);
      if (v.t <= 0 && w.living.length) {
        let keys = Object.keys(attacks).filter(k => (attacks[k].phase || 1) <= v.phase && k !== v.last && (!attacks[k].ok || attacks[k].ok(w, e)));
        if (!keys.length) keys = Object.keys(attacks).filter(k => (attacks[k].phase || 1) <= v.phase);
        const k = w.rng.weighted(keys, x => attacks[x].w || 1);
        v.atk = k; v.last = k; v.st = 'atk'; v.at = 0; v.s = {}; e.st = 1;
        if (attacks[k].start) attacks[k].start(w, e);
      }
    };
  };

  // Placeholder boss used by the boss-<id>.js stubs until the bosses lane writes them: a telegraphed slam at the target, a shot ring after a wind-up, a short charge.
  const placeholder = (o) => {
    o = o || {};
    return runner({
      slam: { w: 2, wind: 0.9, start(w, e) { const t = e.tgt; tele(w, e, t ? t.x : e.x, t ? t.y : e.y, 52, 0.9, 2.5, { detached: true }); }, update: (w, e, dt, t) => t >= 1.1 },
      ring: { w: 2, wind: 0.7, start(w, e) { tele(w, e, e.x, e.y, e.r + 20, 0.7, 1.5, { followSrc: true }); }, update(w, e, dt, t) { if (t >= 0.7 && !e.vars.s.done) { e.vars.s.done = true; ring(w, e, o.n || 14, 130, o.look || 'orb', w.rng.next(), 1.2, 5); } return t >= 1.0; } },
      charge: {
        w: 1, wind: 0.7,
        start(w, e) { const a = aim(e); e.vars.s.a = a; line(w, e, e.x, e.y, a, 220, e.r * 2, 0.7, 2, { followSrc: true }); },
        update(w, e, dt, t) { if (t < 0.7) return false; const a = e.vars.s.a; mv(w, e, Math.cos(a), Math.sin(a), 320, dt); return t >= 1.4; },
      },
    }, o);
  };

  B.lib = { tele, line, cone, ring, aim, mv, approach, summon, runner, placeholder };

  // ---------- World bookkeeping ----------
  W.initBosses = function () { this.bossList = []; };
  // Spawns stage boss entry b ({ t, id, final }) 260-320 px from a random living hero.
  W.spawnBoss = function (b) {
    const L = this.living; if (!L.length || !ED.FOES[b.id]) return null;
    const p = L[this.rng.int(0, L.length - 1)], pt = this.ringPoint(p, 260, 320, false) || { x: p.x + 280, y: p.y };
    const e = this.spawnFoe(b.id, pt.x, pt.y);
    e.maxHp = e.hp = Math.round(400 * (b.t / 60) * this.partyHp());
    e.final = !!b.final;
    this.bossList.push(e); this.boss = e;
    this.emit({ t: 'boss', id: b.id, fid: e.id, phase: 0, final: e.final });
    return e;
  };
  W.onBossKilled = function (e) {
    const i = this.bossList.indexOf(e); if (i >= 0) this.bossList.splice(i, 1);
    this.boss = this.bossList.length ? this.bossList[this.bossList.length - 1] : null;
    this.emit({ t: 'boss', id: e.def.id, fid: e.id, phase: -1, final: e.final });
    if (e.final) { this.finalDown = true; return; }
    this.spawnPickup('chest', e.x, e.y, 2);
    for (let k = 0; k < 3; k++) this.dropGem(e.x + (k - 1) * 12, e.y + 10, 25);
    this.spawnPickup('gold', e.x, e.y - 12, this.rng.int(5, 10));
  };
  W.updateBosses = function () {
    if (this.time < C.ENRAGE_T) return;
    for (const e of this.bossList) if (e.final && !e.enraged && !e.dead) { e.enraged = true; e.dmg *= 3; e.spd *= 3; this.emit({ t: 'boss', id: e.def.id, fid: e.id, phase: 'enrage' }); }
  };
})(globalThis.ED || (globalThis.ED = {}));
