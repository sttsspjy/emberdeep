// Hero skills: per-hero skill state, the cast dispatcher for the class skills in slot 0 (skill 1), slot 1 (skill 2) and slot 2 (skill 3, a class with skill3 only), skill moves, cooldown refunds and the hooks of the class files.
// A skill's behaviour lives in src/sim/class-<id>.js: ED.CAST[skillId] = function (p, a, data, st, nums) (this = world) returns false to reject the cast or the extra fields of the 'skill' event.
// A class file also registers a hook table ED.CLS[cls] (all optional; this = world; the attacker's class unless noted):
//   init(p) / tick(p, dt): hero fields at creation / every tick (skills.js)      kill(e, killer, src): every class's table runs on every foe death (skills.js)
//   hitMul(p, e, src) -> added to the hero multiplier, hitCrit(p, e, src) -> force a crit, critMul(p, e, src) -> crit damage factor, hitDone(p, e, dmg, crit, src), procs(e, p, dmg, crit, src) (combat.js hitEnemy / heroProcs)
//   attackOpts(p, st) -> options merged into every weapon hit of an attack (infAdd, pierce, blastMul), attack(p, a, st, w) after an attack, waveShot(p, pr, a, st) on the Cleric wave (combat.js playerAttack)
//   projHit(pr, e, hs) after a hero shot hit e, projBurst(pr, owner) after a shot's blast, projEnd(pr, owner, 'life' | 'wall') when a hero shot ends its flight (combat.js); absorb(p, absorbed, src) when p's shield absorbed damage (combat.js hurtPlayer)
//   toll(p, boss, dmg) after a Doom Toll landed (combat.js checkToll; a Reap arrives through kill with src.kind 'reap'); smote(boss, o) after o Smote a boss (combat.js smite; the Smiter's table)
//   hurtMul(p, src) -> factor on the damage p takes, inside the DR_FLOOR clamp with Brace and Sanctuary (combat.js hurtPlayer, p's class)
//   weaponAttack(p, a) replaces the weapon attack of a weapon combat.js does not swing (kind 'bell': class-bell.js winds the bell); down(p) every tick while p is downed or dead (world.js updatePlayer)
(function (ED) {
  'use strict';
  const U = ED.U;
  const W = ED.World.prototype;
  const CLS = ED.CLS, CAST = ED.CAST = {};

  // Sanctuary heals SANCT_HEAL of max HP. Shield Charge: CHARGE_SPEED px/s over CHARGE_MIN..range px, CRUSH extra damage on shield-stunned foes. Shield Throw: out at THROW_SPEED over THROW_MIN..THROW_MAX px, chase hops at CHASE_SPEED for at most CHASE_T s,
  // RIC_R ricochet reach, THROW_FLIGHT longest flight; the catch shields CATCH_PER of max HP per foe struck (at most CATCH_MAX) once per KWARD_CD. BRACE_CD: seconds between Brace starts.
  // Sanctuary lasts at most SANCT_UPTIME of its cooldown, Vanish's smoke blinds a foe for at most SMOKE_UPTIME of its cooldown.
  Object.assign(ED.CONST, {
    SANCT_HEAL: 0.07, CHARGE_SPEED: 600, CHARGE_MIN: 60, CRUSH: 0.4, THROW_MIN: 120, THROW_MAX: 280, THROW_SPEED: 620, CHASE_SPEED: 760, CHASE_T: 0.35, RIC_R: 180, THROW_FLIGHT: 2.0,
    CATCH_PER: 0.005, CATCH_MAX: 0.02, KWARD_CD: 6, BRACE_CD: 4, SANCT_UPTIME: 0.6, SMOKE_BLIND: 2, SMOKE_UPTIME: 0.5,
  });

  // Aim of a skill: ED.SKILLS data (aim, range, walk), with the stat-dependent override of ED.Stats.skillNums when a stat block is given.
  const AIM_DIR = { aim: 'dir', range: 0 };
  ED.skillAim = (id, st) => (st ? ED.Stats.skillNums(id, st) : ED.SKILLS[id]) || AIM_DIR;
  // Area radius of a ground skill for a hero's stats: the first active part with a radius (the landing preview and the sim read the same numbers).
  ED.skillRadius = (id, st) => {
    const d = ED.SKILLS[id];
    if (!d) return 0;
    if (d.prevR) return d.prevR;
    const N = ED.Stats.skillNums(id, st);
    for (const q of N.parts) if (q.on && q.r) return q.r;
    return 0;
  };

  // The skillMove (see Sim.movePlayer) of a leap of hero p toward (tx, ty) in mv.t s: clipped at walls, untouchable for mv.iframes; null when it would not move. The client cast, the sim's second Sun Dive leap and the 'leap' message share it.
  ED.leapMove = (room, locked, p, tx, ty, mv) => {
    const dist = Math.hypot(tx - p.x, ty - p.y);
    if (!(dist > 4)) return null;
    const end = ED.Sim.castMove(room, p.x, p.y, Math.atan2(ty - p.y, tx - p.x), dist, p.r, locked), real = Math.hypot(end.x - p.x, end.y - p.y);
    if (real < 4) return null;
    return { dx: (end.x - p.x) / real, dy: (end.y - p.y) / real, speed: real / mv.t, t: mv.t, iframes: mv.iframes === undefined ? mv.t : mv.iframes, age: 0 };
  };

  // Landing point of ground skill `id`: from the client's origin (accepted within 48 px of the host's hero) to its {x, y}, else along the aim at min(200, range); clamped to range, cut at walls (chasms do not stop it).
  W.groundTarget = function (p, a, data, id) {
    const fin = (v) => typeof v === 'number' && isFinite(v), ai = ED.skillAim(id, p.stats);
    let x0 = p.x, y0 = p.y;
    if (fin(data.x0) && fin(data.y0) && U.dist2(data.x0, data.y0, p.x, p.y) <= 48 * 48) { x0 = data.x0; y0 = data.y0; }
    let tx = x0 + Math.cos(a) * Math.min(200, ai.range), ty = y0 + Math.sin(a) * Math.min(200, ai.range);
    if (fin(data.x) && fin(data.y)) { tx = data.x; ty = data.y; }
    return ED.Sim.groundPoint(this.room, this.locked, x0, y0, tx, ty, ai.range, !!ai.walk);
  };

  // Called from addPlayer: per-hero skill state (p.stats is not built yet). Timers named ...T count down in updateSkills; braceAt and parryT are world times.
  W.initSkills = function (p) {
    p.stealthT = 0; p.ambush = false; p.ambushT = 0; p.critStacks = 0;
    p.braceT = 0; p.braceAt = -99; p.kWardT = 0; p.rallyT = 0; p.mantleT = 0; p.mantleAmt = 0; p.veilT = 0; p.boneT = 0; p.raiseT = 0;
    p.momN = 0; p.momT = 0; p.lastAtkT = -99; p.flowT = 0; p.cometT = 0; p.stepRefT = 0; p.edgeT = 0; p.parryT = 0; p.heatT = 0;
    p.glT = 0; p.glV = 0; p.auraT = 0; p.auraV = 0; p.abyssT = 0; p.cleaveNext = 0; p.skillIfr = false;
    p.shWin = []; for (let i = 0; i < ED.CONST.SHIELD_WIN_T; i++) p.shWin.push({ sec: -99, c: 0, a: 0 }); // shield window slots (world.js addShield)
    p.shieldClip = {}; p.shields = []; p.shieldOut = false; p.charge = null; // shieldOut: a thrown shield is away from the hero (wire flag 1 << 6)
    const h = CLS[p.cls];
    if (h && h.init) h.init.call(this, p);
  };

  const TIMERS = ['braceT', 'kWardT', 'rallyT', 'mantleT', 'veilT', 'boneT', 'raiseT', 'cometT', 'stepRefT', 'edgeT', 'heatT', 'glT', 'auraT', 'abyssT', 'flowT'];

  // Called every tick from updatePlayerBuild for a living, standing hero.
  W.updateSkills = function (p, dt) {
    if (p.stealthT > 0) p.stealthT = Math.max(0, p.stealthT - dt);
    if (p.ambush && (p.ambushT -= dt) <= 0) p.ambush = false;
    for (let i = 0; i < TIMERS.length; i++) { const k = TIMERS[i]; if (p[k] > 0) p[k] -= dt; }
    if (p.charge) this.updateCharge(p, dt);
    if (p.shields.length) this.updateShieldThrow(p, dt);
    const h = CLS[p.cls];
    if (h && h.tick) h.tick.call(this, p, dt);
  };

  // Source fields of a hit by part `partId` of skill nums N: kind 'skill', the part name, knockback, the part's boss factor (hitEnemy applies it to bosses) and the class element for 'el: class' parts; o adds or overrides fields.
  W.partSrc = function (p, N, partId, o) {
    const q = N.p[partId], src = { p, kind: 'skill', part: N.id + '.' + partId };
    if (q.knock) src.knock = q.knock;
    if (q.bossMul) src.bossMul = q.bossMul;
    if (q.el === 'class') src.clsEl = p.stats.element;
    return o ? Object.assign(src, o) : src;
  };

  // Area hit of a skill on foes within r of (x, y): src is the hit's source fields (W.partSrc); calls onHit(e, dealt) per foe struck.
  W.skillBlast = function (p, x, y, r, dmg, src, onHit) {
    const q = this.foeScan(x, y, r);
    for (let k = 0; k < q.length || this.foeTail(q); k++) {
      const e = q[k];
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d >= r + e.r) continue;
      const s = Object.assign({ kx: (e.x - x) / (d || 1), ky: (e.y - y) / (d || 1), noGuard: true, x, y }, src);
      const dealt = this.hitEnemy(e, dmg, s);
      if (onHit) onHit(e, dealt);
    }
    this.foeEnd();
    this.smashCircle(p, x, y, r);
  };

  // Cooldown refund for the hero's own client (cooldowns are client-authoritative): slot 0, 1 or 2, s seconds off, or a full refund when s is omitted (slots 0 and 2: one charge back);
  // slot -1: s seconds off every skill slot at once (the Pyromancer's Ember Bolt cut).
  W.refundSkill = function (p, slot, s) {
    const m = { to: p.pid, t: 'refund', slot };
    if (s) m.s = Math.round(s * 100) / 100;
    this.msgs.push(m);
  };

  // Called from killEnemy for every slain foe (p = credited hero or null): every class's kill hook runs (a Verdict burst belongs to the Judge's owner, not the killer).
  W.onEnemyKilledSkill = function (e, p, src) {
    for (const id in CLS) { const h = CLS[id].kill; if (h) h.call(this, e, p, src); }
  };

  // data: { x0, y0, x1, y1 } for movement skills (performed by the hero's own client); { x0, y0, x, y } for ground skills (cast origin and aimed point, see groundTarget); { d } for Shield Throw (cursor distance).
  // Slot 2 (skill 3) fires no on-cast boon procs (onSkillCast: Battle Trance): it is the hero's rapid spell, cast every second or two.
  W.playerSkill = function (p, a, data, slot) {
    if (!p || p.downed || p.dead) return;
    slot = slot === 1 || slot === 2 ? slot : 0;
    const cls = ED.CLASSES[p.cls], skill = slot === 2 ? cls.skill3 : slot ? cls.skill2 : cls.skill, fn = skill && CAST[skill];
    if (!fn) return;
    const st = p.stats;
    const extra = fn.call(this, p, a, data || {}, st, ED.Stats.skillNums(skill, st));
    if (extra === false) return;
    if (slot !== 2) this.onSkillCast(p, slot); // skill 3 fires no on-cast procs
    if (p.rh && p.rh.cast) this.relicFire(p, 'cast', slot);
    this.emit(Object.assign({ t: 'skill', pid: p.pid, k: skill, a: Math.round(a * 100) / 100, x: Math.round(p.x), y: Math.round(p.y), slot }, extra));
  };
})(globalThis.ED || (globalThis.ED = {}));
