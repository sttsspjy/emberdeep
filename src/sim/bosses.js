// Bosses (GAME-DESIGN §8): ED.Bosses[id] = fn(w, e, dt) (the foe brain of a boss foe def, ai 'boss'), built with ED.Bosses.lib.runner; spawn / kill / enrage / bar bookkeeping on World.
// HP = 400 x boss minute x party factor (a multi-body boss splits it in its spawn hook). A living boss halves normal spawns (spawner). The fight ends when its last listed body dies:
// a chest (evolution first) plus gems and gold drop there, hostile shots and telegraphs of its bodies vanish; the final boss's death wins the run; at ED.CONST.ENRAGE_T a living final boss enrages (x3 damage and speed).
// Boss attack state lives in e.vars ({ phase, st, t, atk, last, at, s: per-attack scratch, force, fq, rage }). Boss parts (foes with def.boss outside w.bossList, e.g. spore pods) drop only their def.xp gem.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, W = ED.World.prototype, TAU = U.TAU;
  const B = ED.Bosses = {};
  ED.regLook('spore', 'sword', 'quake', 'revive', 'bind', 'pull');

  // ---------- helpers (every foe attack is telegraphed >= 0.6 s) ----------
  // Circle telegraph at (x, y): resolves after dur, dmg = e.dmg x mul to heroes inside (mul 0: a warning only). opt: { look, followSrc, detached, onEnd(w, z), st }.
  const tele = (w, e, x, y, r, dur, mul, opt) => w.zone(Object.assign({ team: 1, warn: true, x, y, r, dur, dmg: e.dmg * mul, src: e, look: 'tele' }, opt));
  // Line telegraph from (x, y) along a: len long, width wide.
  const line = (w, e, x, y, a, len, width, dur, mul, opt) => w.zone(Object.assign({ team: 1, warn: true, x, y, a, len, w: width, dur, dmg: e.dmg * mul, src: e, look: 'tele' }, opt));
  // Cone telegraph from the boss toward a (moves with it).
  const cone = (w, e, a, r, arc, dur, mul, opt) => w.zone(Object.assign({ team: 1, warn: true, x: e.x, y: e.y, a, r, arc, dur, dmg: e.dmg * mul, src: e, followSrc: true, look: 'tele' }, opt));
  // One foe shot of e from (x, y) along a. Returns the projectile.
  const shot = (w, e, x, y, a, speed, look, dmg, r) => { const pr = w.foeShoot(e, a, speed, look, dmg, r || 5); pr.x = x; pr.y = y; return pr; };
  // Ring of n foe shots from the boss, offset angle off, speed px/s, damage e.dmg x mul.
  const ring = (w, e, n, speed, look, off, mul, r) => { for (let i = 0; i < n; i++) w.foeShoot(e, off + i * TAU / n, speed, look, e.dmg * mul, r || 5); };
  // Ring of n foe shots from (x, y).
  const ringAt = (w, e, x, y, n, speed, look, off, mul, r) => { for (let i = 0; i < n; i++) shot(w, e, x, y, off + i * TAU / n, speed, look, e.dmg * mul, r); };
  const aim = (e) => (e.tgt ? Math.atan2(e.tgt.y - e.y, e.tgt.x - e.x) : 0);
  const dist = (e) => (e.tgt ? Math.hypot(e.tgt.x - e.x, e.tgt.y - e.y) : 1e9);
  const mv = (w, e, dx, dy, speed, dt) => { const hit = ED.Arena.move(w.arena, e, dx * speed * dt, dy * speed * dt, e.r); if (Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1; return hit; };
  // True when some living hero stands within d px of e.
  const near = (w, e, d) => { for (const p of w.living) if (U.dist2(p.x, p.y, e.x, e.y) < d * d) return true; return false; };
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
  // Damage over time to hero p that grants no i-frames (hazards never shield a hero from a telegraphed hit). Returns the damage taken.
  const hazard = (w, p, dmg, src) => { if (p.invuln > 0) return 0; const d = w.hurtHero(p, dmg, src); if (d > 0) p.invuln = 0; return d; };
  // Hero slow: speed x (1 - k) for dur s (the stronger slow wins while one runs).
  const slowHero = (p, k, dur) => { p.slowK = p.slowT > 0 ? Math.max(p.slowK || 0, k) : k; p.slowT = Math.max(p.slowT, dur); };
  // Drags living, non-dashing heroes within r of (x, y) toward it by up to step px (stops 12 px short).
  const pull = (w, x, y, r, step) => {
    for (const p of w.living) {
      if (p.dashT > 0) continue;
      const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
      if (d > r || d < 12) continue;
      const s = Math.min(step, d - 12);
      ED.Arena.move(w.arena, p, dx / d * s, dy / d * s, p.r);
    }
  };
  // Leap: s = { fx, fy, tx, ty, fl } (from, to, flight s). Moves e along an eased path at time t; no contact while airborne; lands pushed out of obstacles. True once landed.
  const leapTo = (w, e, s, t) => {
    const k = Math.min(1, t / s.fl), q = k * k * (3 - 2 * k);
    e.x = s.fx + (s.tx - s.fx) * q; e.y = s.fy + (s.ty - s.fy) * q;
    if (Math.abs(s.tx - s.fx) > 1) e.face = s.tx > s.fx ? 1 : -1;
    if (k < 1) { e.cd = Math.max(e.cd, 0.1); return false; }
    if (!s.landed) { s.landed = true; ED.Arena.collide(w.arena, e, e.r); }
    return true;
  };
  // Clamps (x, y) into the arena with margin m; writes into out.
  const inside = (w, x, y, m, out) => { const S = w.arena.size; out.x = U.clamp(x, m, S - m); out.y = U.clamp(y, m, S - m); return out; };
  // Hits heroes touching e (body + pad) once each while it dashes; hit = per-attack pid list. Returns the number hit this call.
  const ram = (w, e, hit, dmg, pad) => {
    let n = 0;
    for (const p of w.living) { const rr = e.r + p.r + (pad || 4); if (hit.indexOf(p.pid) < 0 && U.dist2(p.x, p.y, e.x, e.y) < rr * rr && w.hurtHero(p, dmg, e) > 0) { hit.push(p.pid); n++; } }
    return n;
  };

  // ---------- runner ----------
  // Boss vars, created on first use (spawn hooks may create them early to add fields).
  const vars = (e) => e.vars || (e.vars = { phase: 1, st: 'idle', t: 1.2, atk: '', last: '', at: 0, s: null, strafe: 1, force: '', fq: null, rage: 1 });
  // Forces attack key on boss e at its next idle tick (skips the pause); fq lands in the attack's scratch e.vars.s.fq.
  const force = (e, key, fq) => { const v = vars(e); v.force = key; v.fq = fq || null; };
  // Runner: attacks = { key: { w (weight; 0 = forced only), phase (min phase), ok(w, e), wind (s of e.st 1 for the renderer), start(w, e), update(w, e, dt, t) -> done, end(w, e) (cleanup, also on abort) } }.
  // opts: { phases: HP fractions (default [0.66, 0.33]), frac(w, e) (HP fraction, default own), idle(w, e, dt), tick(w, e, dt), onPhase(w, e, phase), pause: [s per phase],
  //   phaseEv(w, e, phase) -> false skips the phase event (bodies sharing one phase clock), spawn(w, e) (spawnBoss hook), kill(w, e) -> false keeps the fight going (bosses.js onBossKilled), bar(w, e, bar) (boss bar data) }.
  // A phase change aborts the running attack, gives 1 s invulnerability and emits { t: 'boss', id, fid, phase }. e.st: 0 idle, 1 wind-up, 2 act (attacks may set 3 = vulnerable); e.stT: s into the attack.
  const runner = (attacks, opts) => {
    opts = opts || {};
    const phases = opts.phases || [0.66, 0.33], pause = opts.pause || [1.05, 0.7, 0.45], idle = opts.idle || approach(120), frac = opts.frac || ((w, e) => e.hp / e.maxHp);
    const keys = Object.keys(attacks), pick = [];
    const stop = (w, e, v) => { const A = attacks[v.atk]; if (A && A.end) A.end(w, e); v.st = 'idle'; e.st = 0; e.stT = 0; };
    const begin = (w, e, v, k) => { v.atk = k; v.last = k; v.st = 'atk'; v.at = 0; v.s = { fq: v.fq }; v.force = ''; v.fq = null; e.st = 1; e.stT = 0; if (attacks[k].start) attacks[k].start(w, e); };
    const fn = (w, e, dt) => {
      const v = vars(e);
      if (v.phase - 1 < phases.length && frac(w, e) < phases[v.phase - 1]) {
        if (v.st === 'atk') stop(w, e, v);
        v.phase++; e.invulnT = 1; v.st = 'idle'; v.t = 1.3; e.st = 0; e.stT = 0;
        if (!opts.phaseEv || opts.phaseEv(w, e, v.phase)) w.emit({ t: 'boss', id: e.def.id, fid: e.id, phase: v.phase });
        if (opts.onPhase) opts.onPhase(w, e, v.phase);
        return;
      }
      if (opts.tick) opts.tick(w, e, dt);
      if (e.dead) return;
      if (v.st === 'atk') {
        v.at += dt;
        const A = attacks[v.atk];
        e.st = v.at < (A.wind || 0.6) ? 1 : 2; e.stT = v.at;
        if (A.update(w, e, dt, v.at)) { stop(w, e, v); v.t = pause[Math.min(pause.length, v.phase) - 1] * (v.rage || 1) / (e.enraged ? 2 : 1); }
        return;
      }
      v.t -= dt; e.stT += dt;
      idle(w, e, dt);
      if (v.force && attacks[v.force]) { begin(w, e, v, v.force); return; }
      if (v.t > 0 || !w.living.length) return;
      pick.length = 0;
      for (const k of keys) { const A = attacks[k]; if (A.w !== 0 && (A.phase || 1) <= v.phase && k !== v.last && (!A.ok || A.ok(w, e))) pick.push(k); }
      if (!pick.length) for (const k of keys) { const A = attacks[k]; if (A.w !== 0 && (A.phase || 1) <= v.phase && (!A.ok || A.ok(w, e))) pick.push(k); }
      if (!pick.length) { v.t = 0.3; return; }
      begin(w, e, v, w.rng.weighted(pick, x => attacks[x].w || 1));
    };
    fn.attacks = attacks; fn.opts = opts; fn.spawn = opts.spawn || null; fn.kill = opts.kill || null; fn.bar = opts.bar || null;
    return fn;
  };

  // Placeholder boss for boss-<id>.js stubs without a script: a telegraphed slam at the target, a shot ring after a wind-up, a short charge.
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

  B.lib = { tele, line, cone, shot, ring, ringAt, aim, dist, mv, near, approach, summon, hazard, slowHero, pull, leapTo, inside, ram, vars, force, runner, placeholder };

  // ---------- World bookkeeping ----------
  // w.bossBar: the HUD bar of the newest living boss { on, id, name, q (0..255 of the whole fight), phase, final, enraged, n (bodies up), rev (0..1 revive progress, -1 none) }.
  W.initBosses = function () { this.bossList = []; this.bossBar = { on: false, id: '', name: '', q: 0, phase: 0, final: false, enraged: false, n: 0, rev: -1 }; };
  // Spawns stage boss entry b ({ t, id, final }) 260-320 px from a random living hero; its script's spawn hook may split HP and add bodies.
  W.spawnBoss = function (b) {
    const L = this.living; if (!L.length || !ED.FOES[b.id]) return null;
    const p = L[this.rng.int(0, L.length - 1)], pt = this.ringPoint(p, 260, 320, false) || { x: p.x + 280, y: p.y };
    const e = this.spawnFoe(b.id, pt.x, pt.y);
    e.maxHp = e.hp = Math.round(400 * (b.t / 60) * this.partyHp()); e.hpQ = 255;
    e.final = !!b.final;
    this.bossList.push(e); this.boss = e;
    const s = B[b.id];
    if (s && s.spawn) s.spawn(this, e);
    this.emit({ t: 'boss', id: b.id, fid: e.id, phase: 0, final: e.final });
    return e;
  };
  // Adds body e (spawned by a boss script) to the fight's list: its death counts toward the fight's end.
  W.addBossBody = function (e) { if (this.bossList.indexOf(e) < 0) this.bossList.push(e); if (!this.boss) this.boss = e; };
  W.onBossKilled = function (e) {
    const i = this.bossList.indexOf(e);
    if (i < 0) { if (e.def.xp) this.dropGem(e.x, e.y, e.def.xp); return; } // a boss part: its gem only
    this.bossList.splice(i, 1);
    const s = B[e.def.id], goOn = s && s.kill && s.kill(this, e) === false;
    this.boss = this.bossList.length ? this.bossList[this.bossList.length - 1] : null;
    if (goOn) return;
    this.emit({ t: 'boss', id: e.def.id, fid: e.id, phase: -1, final: e.final });
    // hostile shots and telegraphs of dead boss bodies vanish
    for (const pr of this.projs) if (pr.team === 1 && pr.e && pr.e.boss && (pr.e.dead || pr.e.id !== pr.owner)) pr.dead = true;
    for (const z of this.zones) if (z.team === 1 && z.src && z.src.boss && (z.src.dead || z.src.id !== z.srcId)) z.dead = true;
    if (e.final) { this.finalDown = true; return; }
    this.spawnPickup('chest', e.x, e.y, 2);
    for (let k = 0; k < 3; k++) this.dropGem(e.x + (k - 1) * 12, e.y + 10, 25);
    this.spawnPickup('gold', e.x, e.y - 12, this.rng.int(5, 10));
  };
  W.updateBosses = function () {
    if (this.time >= C.ENRAGE_T) for (const e of this.bossList) if (e.final && !e.enraged && !e.dead) { e.enraged = true; e.dmg *= 3; e.spd *= 3; this.emit({ t: 'boss', id: e.def.id, fid: e.id, phase: 'enrage' }); }
    const bar = this.bossBar, e = this.boss;
    if (!e || e.dead) { bar.on = false; return; }
    const s = B[e.def.id];
    bar.on = true; bar.id = e.def.id; bar.name = e.def.name; bar.q = e.hpQ; bar.phase = e.vars ? e.vars.phase : 1; bar.final = e.final; bar.enraged = e.enraged; bar.n = 1; bar.rev = -1;
    if (s && s.bar) s.bar(this, e, bar);
  };
})(globalThis.ED || (globalThis.ED = {}));
