// Foe pool, spawn, per-tick update (statuses, knockback, brain, contact), kill and drops, elites, off-screen recycling (GAME-DESIGN §7).
// Foe fields: ARCHITECTURE §4 plus internal ones: tgt (nearest living hero, retargeted every RETARGET ticks staggered by id), cd (contact cooldown), age, invulnT, takeMul (damage taken factor),
// scale (draw scale), final (final boss), rushT / rx / ry (stampede or closing ring: fixed heading), burnTick, hev / hevT (hit aggregation), enraged,
// acd (attack cooldown), aa (locked attack angle), tz / tzId (the brain's live telegraph zone; ai.js). No per-foe allocation: pooled objects carry every field.
(function (ED) {
  'use strict';
  const U = ED.U, W = ED.World.prototype;
  const CONTACT_CD = 1.0, FAR = 900, FAR_ELITE = 1300, RETARGET = 20;

  W.initFoes = function () { this.foePool = []; };
  // Contact damage at the current time: 3 at 0:00 rising to 12 at 15:00 (GAME-DESIGN §7), x the stage damage factor.
  W.contactDmg = function () { return (3 + 9 * Math.min(1, this.time / 900)) * ((this.sdef.foe && this.sdef.foe.dmg) || 1); };
  // Shot / blast damage factor at the current time: x1 at 0:00 rising to x2.2 at 15:00 (shots 4-11 per hit), x the stage damage factor.
  W.foeDmgK = function () { return (1 + 1.2 * Math.min(1, this.time / 900)) * ((this.sdef.foe && this.sdef.foe.dmg) || 1); };
  // Foe HP at the current time: base x (1 + 0.24 x minutes) x party factor x the stage HP factor.
  W.foeHp = function (base) { return base * (1 + 0.24 * this.time / 60) * this.partyHp() * ((this.sdef.foe && this.sdef.foe.hp) || 1); };
  // Boss HP for a boss due at t s (GAME-DESIGN §8): 1500 x (minute / 5)^2.5 (1500 / 8485 / 23383 at 5 / 10 / 15 min) x party factor x the stage HP factor.
  ED.bossHp = (t, k) => Math.round(1500 * Math.pow(t / 300, 2.5) * k); // boss HP at spawn time t s; k = party x stage HP factor (GAME-DESIGN §8)
  W.bossHp = function (t) { return ED.bossHp(t, this.partyHp() * ((this.sdef.foe && this.sdef.foe.hp) || 1)); };

  // Spawns foe k (id string or FOE_IDX) at (x, y). opts: { elite, hpMul, rush: [dx, dy, s] (fixed heading for s seconds, default 6) }. Returns the foe.
  W.spawnFoe = function (k, x, y, opts) {
    const def = typeof k === 'string' ? ED.FOES[k] : ED.FOES[ED.FOE_IDS[k]];
    if (!def) return null;
    const e = this.foePool.pop() || {};
    e.id = this.nextId(); e.k = def.idx; e.def = def; e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.r = def.r;
    e.maxHp = e.hp = Math.max(1, Math.round(this.foeHp(def.hp) * ((opts && opts.hpMul) || 1))); e.hpQ = 255;
    e.dmg = this.contactDmg() * def.dmg; e.spd = def.spd; e.kbx = 0; e.kby = 0; e.face = 1; e.flash = 0; e.st = 0; e.stT = 0;
    e.elite = false; e.boss = !!def.boss; e.final = false; e.enraged = false;
    e.slowT = 0; e.slowK = 0; e.burnT = 0; e.burnDps = 0; e.burnOwner = null; e.burnTick = 0.5; e.stunT = 0; e.freezeT = 0;
    e.hitT = 0; e.vars = null; e.tgt = null; e.cd = 0; e.age = 0; e.invulnT = 0; e.takeMul = 1; e.scale = def.scale || 1; e.hev = 0; e.hevT = -1;
    e.rushT = 0; e.rx = 0; e.ry = 0; e.acd = 0.6 + (e.id % 7) * 0.2; e.aa = 0; e.tz = null; e.tzId = 0; e.dead = false;
    if (opts && opts.rush) { e.rushT = opts.rush[2] || 6; e.rx = opts.rush[0]; e.ry = opts.rush[1]; }
    if (opts && opts.elite) this.promoteElite(e);
    this.foes.push(e);
    return e;
  };
  // Elite: 2x size, 25x HP, x1.5 contact damage; drops a chest (GAME-DESIGN §7). Brains widen its attacks (ai.js).
  W.promoteElite = function (e) {
    e.elite = true; e.r = e.def.r * 2; e.scale = (e.def.scale || 1) * 2;
    e.maxHp = e.hp = Math.round(e.hp * 25); e.dmg *= 1.5;
  };

  // Moves e toward (tx, ty) at its speed x mul (slow applied), sliding around obstacles; sets face and vx/vy. Returns the distance to the target before the step.
  W.steer = function (e, tx, ty, mul, dt) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    if (d < 0.5) { e.vx = e.vy = 0; return d; }
    const v = e.spd * mul * (e.slowT > 0 ? 1 - e.slowK : 1);
    e.vx = dx / d * v; e.vy = dy / d * v;
    ED.Arena.move(this.arena, e, e.vx * dt, e.vy * dt, e.r);
    if (dx < -0.5) e.face = -1; else if (dx > 0.5) e.face = 1;
    return d;
  };

  // Drops the brain's live telegraph (if still its own) and returns e to moving.
  W.foeCancel = function (e) {
    const z = e.tz;
    if (z && z.id === e.tzId && !z.dead) z.dead = true;
    e.tz = null; e.st = 0; e.stT = 0;
  };

  W.updateFoes = function (dt) {
    const list = this.foes, n = list.length, living = this.living, A = this.arena, nl = living.length;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e.dead) continue;
      e.age += dt; e.flash -= dt; e.cd -= dt; e.invulnT -= dt;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowK = 0; }
      if (e.stunT > 0) e.stunT -= dt;
      if (e.freezeT > 0) e.freezeT -= dt;
      if (e.burnT > 0) {
        e.burnT -= dt; e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick += 0.5;
          const s = this.src(e.burnOwner && !e.burnOwner.dead ? e.burnOwner : null, 'burn', 'dot');
          this.hitFoe(e, e.burnDps * 0.5, s);
          if (e.dead) continue;
        }
      }
      if (e.kbx || e.kby) {
        ED.Arena.move(A, e, e.kbx * dt, e.kby * dt, e.r);
        const f = Math.max(0, 1 - 10 * dt); e.kbx *= f; e.kby *= f;
        if (Math.abs(e.kbx) + Math.abs(e.kby) < 4) e.kbx = e.kby = 0;
      }
      // nearest living hero: on a stagger, or at once when the target fell
      let tg = e.tgt;
      if (!tg || tg.dead || tg.downed || (this.tick + e.id) % RETARGET === 0) {
        tg = null; let bd = Infinity;
        for (let h = 0; h < nl; h++) { const p = living[h], d = (p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y); if (d < bd) { bd = d; tg = p; } }
        e.tgt = tg;
      }
      if (e.freezeT > 0 || e.stunT > 0) { e.vx = e.vy = 0; if (e.st && !e.boss) this.foeCancel(e); }
      else if (e.rushT > 0) {
        e.rushT -= dt;
        const v = e.spd * 1.3; e.vx = e.rx * v; e.vy = e.ry * v;
        e.x += e.vx * dt; e.y += e.vy * dt; e.face = e.rx < 0 ? -1 : 1;
        if (e.x < -60 || e.y < -60 || e.x > A.size + 60 || e.y > A.size + 60) e.rushT = 0;
        ED.Arena.collide(A, e, e.r);
      } else if (tg) {
        const brain = ED.AI[e.def.ai] || ED.AI.chaser;
        brain(this, e, dt);
      }
      if (e.dead) continue;
      if (e.freezeT <= 0 && e.cd <= 0 && !e.def.noContact) {
        for (let h = 0; h < nl; h++) {
          const p = living[h], rr = e.r + p.r;
          if ((p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y) <= rr * rr) { if (this.hurtHero(p, e.dmg, e) > 0) e.cd = CONTACT_CD; break; }
        }
      }
      // off-screen recycling (once a second per foe): a normal foe further than FAR (elites FAR_ELITE) from every hero moves to a fresh spawn point ahead of a hero
      if (!e.boss && nl && e.rushT <= 0 && (this.tick + e.id) % 60 === 0) {
        const far = e.elite ? FAR_ELITE : FAR;
        let out = true;
        for (let h = 0; h < nl; h++) { const p = living[h]; if ((p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y) < far * far) { out = false; break; } }
        if (out) {
          const pt = this.ringPoint(living[this.rng.int(0, nl - 1)], 380, 460, true);
          if (pt) { if (e.st) this.foeCancel(e); e.x = pt.x; e.y = pt.y; e.kbx = e.kby = 0; e.tgt = null; }
        }
      }
    }
  };

  // Foe e dies: kill credit, 'die' event, drops (gem by def.xp; elites a chest, gold, a large gem and food at 50%; bosses via onBossKilled), splitter children, the killer's weapon kill callbacks, then its hero kill hook.
  W.killFoe = function (e, src) {
    if (e.dead) return;
    e.dead = true; e.hp = 0; e.hpQ = 0;
    this.kills++;
    const p = src && src.p;
    if (p) p.kills++;
    this.emit({ t: 'die', id: e.id, k: e.k, x: Math.round(e.x), y: Math.round(e.y), elite: e.elite, boss: e.boss });
    if (e.boss) this.onBossKilled(e, p);
    else if (e.elite) { this.spawnPickup('chest', e.x, e.y, 1); this.spawnPickup('gold', e.x + 8, e.y, this.rng.int(1, 5)); this.dropGem(e.x - 8, e.y, 25); if (this.rng.chance(0.5)) this.spawnPickup('food', e.x, e.y + 10, 30); }
    else this.dropGem(e.x, e.y, e.def.xp || 1);
    const sp = e.def.split;
    if (sp && !e.boss) {
      const n = this.rng.int(sp.n[0], sp.n[1]) + (e.elite ? 3 : 0);
      for (let i = 0; i < n; i++) { const a = i / n * U.TAU + this.rng.next(), d = 8 + e.r * 0.5; this.spawnFoe(sp.id, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d); }
    }
    if (p) { this.weaponKill(p, e); const hk = ED.HOOK[p.cls]; if (hk && hk.kill) hk.kill(this, p, e); }
  };
})(globalThis.ED || (globalThis.ED = {}));
