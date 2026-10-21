// Combat rules: spawning, damage, statuses, deaths, hero attacks, projectiles and area zones.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon;
  const W = ED.World.prototype;

  ED.CONST.GLOOM_CAP = 0.25; // max HP fraction one Gloom touch may take
  ED.CONST.ARC_MUL = 0.6; // a discharge's arc targets take this fraction of what the charged foe takes
  ED.CONST.BOLT_CD = 0.6; // seconds between one hero's Thunderhead bolts
  ED.CONST.SPLASH_MUL = 0.6; // foes next to a combusting foe take this fraction of the pool
  // Path constants. Venom: K = amount per fraction of the foe's reference HP, AMP = damage bonus at full Venom, DECAY per second after HOLD seconds, ALLY = share of the bonus for a hero who added none.
  // Smite gauge = SMITE_AT x the foe's real HP; a Holy shield grant is at most HOLY_GRANT_MAX of max HP, once per HOLY_CD per receiving hero within HOLY_R. Shields: LANTERN_CD per ally, CLASS_SHIELD_CAP of max HP, SHIELD_DECAY of max HP per second outside locked rooms.
  // Doom: elites and bosses take DOOM_TOUGH of it; a boss Tolls at TOLL_AT of its real HP. Minions infuse at MINION_INFUSE. Chain queue: CHAIN_HOP seconds per hop, CHAIN_TICK payoffs per trigger hero per tick. BLIND_CD / STUN_CD: per-foe cooldowns of Dawn Stride and Overload.
  Object.assign(ED.CONST, {
    VENOM_K: 300, VENOM_AMP: 0.25, VENOM_DECAY: 8, VENOM_HOLD: 3, VENOM_ALLY: 0.5, CHILL_K: 340,
    SMITE_AT: { trash: 0.12, elite: 0.06, boss: 0.02 }, HOLY_CD: 3, HOLY_R: 160, HOLY_GRANT_MAX: 0.03,
    LANTERN_CD: 1.5, CLASS_SHIELD_CAP: 0.08, SHIELD_DECAY: 0.02,
    DOOM_TOUGH: 0.7, TOLL_AT: 0.05, MINION_INFUSE: 0.5, CHAIN_HOP: 0.08, CHAIN_TICK: 6, BLIND_CD: 4, STUN_CD: 1,
  });
  // Class-route rules. DR_FLOOR: Brace x best Sanctuary never cut damage taken below this factor. A hero stun on a non-boss foe lasts ELITE_STUN x on elites, a second one while stunCd > 0 lasts half,
  // and each sets stunCd = duration + STUN_DR (repeating sources skip while stunCd > 0). Heavy weapon hits Stagger for STAGGER s (elites half) once per STAGGER_CD per foe.
  // Parry (Sworn Blade): stun PARRY_STUN on a foe in the last PARRY_WIN of a wind-up, once per PARRY_CD per hero and PARRY_FOE_CD per foe. SPREAD_CAP: a status move gives a foe at most this share of its own HP per pool.
  Object.assign(ED.CONST, { DR_FLOOR: 0.5, ELITE_STUN: 0.5, STUN_DR: 2, STAGGER: 0.2, STAGGER_CD: 2, PARRY_STUN: 0.6, PARRY_CD: 2.5, PARRY_FOE_CD: 4, PARRY_WIN: 0.3, SPREAD_CAP: 0.25, WAVE_CONE: 25 * Math.PI / 180 });
  const EL_IDX = { fire: 1, ice: 2, lightning: 3, poison: 5, holy: 6, shadow: 7 }; // hit-event element index (4 = bleed)
  const NO_GUARD = { dot: 1, chain: 1, explode: 1 }; // hit kinds that ignore a foe's frontal guard
  const FULL_CONTACT = new Set(['lunge', 'charge', 'leap', 'bash', 'dive']); // attack states whose body contact deals full damage
  const NO_STATS = {};
  const hpFrac = (e, dmg) => dmg / (e.maxHp / e.hpLever); // damage as a fraction of the foe's HP before the stratum lever (bosses: refHp): the unit of HP-relative build-up
  const WINDUP = { tele: 1, teleLine: 1, teleCone: 1 }; // zone kinds that telegraph their caster's attack
  const CLS = ED.CLS; // per-class hook tables registered by src/sim/class-*.js
  const evoOf = (p) => p.stats.evo || null;
  const rankOf = (e) => (e.boss ? 0.35 : e.elite ? 0.7 : 1); // gauge resistance of Chill and Venom
  const smiteAt = (e) => e.maxHp * ED.CONST.SMITE_AT[e.boss ? 'boss' : e.elite ? 'elite' : 'trash']; // Radiance a Smite needs (real HP, so Smites per foe match in every stratum)
  const UNIT = { dmg: (e, d) => d, chill: (e, d) => hpFrac(e, d) * ED.CONST.CHILL_K, venom: (e, d) => hpFrac(e, d) * ED.CONST.VENOM_K }; // amount of an infusion before its rate (ED.ELEMENTS unit)
  W.smiteAt = smiteAt;

  // ---------------- enemies ----------------
  W.spawnEnemy = function (type, x, y, opts) {
    opts = opts || {};
    const def = ED.ENEMIES[type];
    const s = this.stratum, pact = this.pact;
    let hp = def.hp, dmg = def.dmg;
    if (!def.boss) hp *= ED.World.hpScale(s);
    hp *= this.partyHpMul();
    if (pact >= 1) hp *= 1.25;
    if (def.boss && pact >= 5) hp *= 1.35;
    if (pact >= 10) hp *= 1.2;
    dmg *= (1 + 0.22 * (s - 1) + 0.03 * (s - 1) * (s - 1)) * (pact >= 2 ? 1.25 : 1) * (pact >= 8 ? 1.2 : 1) * this.threat().dmg;
    const dr = this.dread;
    if (dr && !def.minion && !def.gloom && !def.ally && !opts.ally) {
      const deep = 1 + ED.World.DEEP * Math.min(ED.World.DEEP_MAX, this.deepRooms); // the Deep hits harder with every room entered Dark or Lightless this stratum
      hp *= dr.hp; dmg *= dr.dmg * deep;
    }
    const e = {
      id: U.uid(), type, def, x, y, r: def.r, hp, maxHp: hp, dmg, spd: def.spd * (pact >= 6 ? 1.15 : 1),
      kbx: 0, kby: 0, st: 'move', t: 0, cd: this.rng.range(0.6, 1.6), face: 1, flash: 0, stun: 0, frozen: 0, elite: null, ward: 0, wardMax: 0,
      boss: !!def.boss, fly: !!def.fly, target: null, tgtT: 0, aimA: 0, guardA: 0, contactCd: 0, spawnT: opts.spawnT || 0,
      phase: 1, vars: {}, strafe: this.rng.sign(), wob: this.rng.range(0, 6.28), exposed: false, recoil: 0,
      // statuses: burn/bleed pools, chill, charge, Venom (0-100; venomBy = bitmask of hero slots that added it), Radiance, Doom (HP units), hero debuffs (judged = Cleric Judgment, vulnT = Rain/Smoke vulnerability); slow/windMul/dmgTakenMul are read by ai.js and hitEnemy
      // cid = last chain id this foe paid out in; wrathQ = charge made by Wrath of Heaven bolts; stunCd / blindCd = per-foe cooldowns of Overload / Dawn Stride
      burn: 0, burnPool: 0, burnTick: 0, burnOwner: null, bleedPool: 0, bleedTick: 0, bleedOwner: null,
      chill: 0, chillT: 0, chillOwner: null, freezeRes: 0, freezeResT: 0, charge: 0, chargeOwner: null, dischargeT: 0,
      venom: 0, venomT: 0, venomOwner: null, venomBy: 0, corrode: 0, plagueT: 0, rad: 0, radOwner: null, doom: 0, doomOwner: null, cid: 0, cidMask: 0, wrathQ: 0, stunCd: 0, blindCd: 0,
      hpLever: def.boss ? def.hp / def.refHp : this.threat().hp, // HP-relative statuses (chill, Conflagration, Wildfire) ignore this stratum lever
      mark: 0, judged: 0, vulnT: 0, blind: 0, sunder: 0, sunderOwner: null, slow: 1, slowAmt: 0, slowT: 0, windMul: 1, dmgTakenMul: 1, invulnT: 0, killed: false,
      // class-route foe states: shieldStunT (stunned by a thrown shield), staggerT / parryT (per-foe cooldowns), hexT + hexBy (slot mask), markV (mark vulnerability), sealT, weakT + weakV (Verdict weaken)
      shieldStunT: 0, staggerT: 0, parryT: 0, hexT: 0, hexBy: 0, markV: 0, sealT: 0, weakT: 0, weakV: 0,
    };
    if (opts.elite) this.makeElite(e, opts.affix);
    this.enemies.push(e);
    return e;
  };

  W.makeElite = function (e, affix) {
    e.elite = affix || this.rng.pick(ED.AFFIX_IDS);
    e.hp *= ED.World.ELITE.hp + ED.World.ELITE.hpStep * (this.stratum - 1); e.maxHp = e.hp; e.dmg *= ED.World.ELITE.dmg; e.r = Math.round(e.r * 1.22); // elite HP x2.8 at stratum I up to x5.3 at VI
    if (e.elite === 'swift') e.spd *= 1.4;
    if (e.elite === 'brutal') e.dmg *= 1.4;
    if (e.elite === 'warded') { e.ward = e.maxHp * 0.45; e.wardMax = e.ward; }
  };

  // Stratum affinity: weak x1.5, resist x0.5, else x1 (el = one of ED.ELEMENT_IDS; General and physical hits pass nothing).
  W.elemAff = function (el) {
    const b = ED.biomeFor(this.stratum);
    return b.weak === el ? 1.5 : b.resist === el ? 0.5 : 1;
  };
  // Class-skill hits take half the affinity: x1.25 weak, x0.75 resisted. Their statuses use the full elemAff.
  W.affC = function (el) { return 1 + (this.elemAff(el) - 1) / 2; };

  // Slows a foe by amount (0..1) for dur seconds; the strongest slow and the longest duration win.
  W.slowEnemy = function (e, amount, dur) {
    if (!e || e.hp <= 0) return;
    e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, amount);
    e.slowT = Math.max(e.slowT, dur);
  };

  // ---------------- damage to foes (order: hero mul, crit, vulnerability, affinity, exposed, guard, dmgTakenMul, ward) ----------------
  // src: { p, kind, crit, mul, el, clsEl, affDone, raw, noProc, noGuard, noShatter, comp, infAdd, infK, bleedMin, ambush, knock, kx, ky, x, y, part, wpn, dist, pass }. Writes back src.critOut / src.guarded / src.affMul.
  // el tags a hit with an element (affinity x1.5 / x0.5 unless affDone); clsEl tags a class-skill hit (half affinity, +classElMul); infAdd { el: rate } adds a per-hit infusion rate that needs no gate; infK scales every infusion of the hit.
  // part names the skill part ('charge.impact'); wpn marks a weapon hit (swing, shot, its blast, warhammer shock, plague cloud tick, wave); Stagger and the heavy hit-stop need kind 'weapon' (a direct swing or shot). The attacker's class hook table (ED.CLS[cls]) may add to the hero multiplier (hitMul), force or boost crits (hitCrit, critMul) and react (hitDone).
  W.hitEnemy = function (e, base, src) {
    if (!e || e.hp <= 0) return 0;
    src = src || {};
    const def = e.def;
    if (def.invuln || e.burrowed || e.invulnT > 0) return 0;
    const p = src.p || null, st = p ? p.stats : null, kind = src.kind || 'weapon';
    const comp = !!src.comp || kind === 'minion';
    const ch = p ? CLS[p.cls] : null;
    let dmg = base, crit = false, shatter = false, guarded = false;
    if (p && !src.raw) {
      crit = src.crit === undefined ? !!((ch && ch.hitCrit && ch.hitCrit.call(this, p, e, src)) || this.rng.chance(st.crit)) : !!src.crit;
      let mul = st.dmg;
      if (st.execute && e.hp < e.maxHp * 0.3) mul += st.execute;
      if (st.searing && e.burnPool > 0) mul += st.searing;
      if (st.lacerate && e.bleedPool > 0) mul += st.lacerate;
      if (st.malice && e.doom > 0) mul += st.malice;
      if (st.brittle && (e.chill > 0 || e.frozen > 0)) mul += st.brittle;
      if (st.fester && e.venom > 0) mul += st.fester;
      if (st.opportunist && (e.stun > 0 || e.frozen > 0 || e.blind > 0)) mul += st.opportunist;
      if (p.knellT > 0) mul += 0.04 * p.knellN;
      if (st.brand) mul += st.brand * Math.min(4, this.ailments(e));
      if (p.glT > 0) mul += p.glV; // Guardian Light buff
      if (p.auraT > 0) mul += p.auraV; // Embolden (an ally inside a Cleric's Aura of Faith)
      if (ch && ch.hitMul) mul += ch.hitMul.call(this, p, e, src) || 0;
      if (src.clsEl && st.classElMul) mul += st.classElMul;
      if (st.idol) mul += Math.min(0.2, Math.floor(this.gold / 15) * 0.01);
      if (st.banner) {
        let near = 0;
        for (const q of this.players.values()) if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 200 * 200) near++;
        mul += st.banner * (1 + near);
      }
      dmg *= Math.max(0.1, mul);
      if (crit) { dmg *= st.critMult; if (ch && ch.critMul) dmg *= ch.critMul.call(this, p, e, src) || 1; }
    }
    if (src.mul) dmg *= src.mul;
    if (p && !src.noProc && st.shatter && e.frozen > 0 && !src.noShatter) { dmg *= 1 + st.shatter; shatter = true; }
    let vuln = 1;
    if (e.mark > 0) vuln += e.markV;
    if (e.judged > 0 || e.vulnT > 0) vuln += 0.2; // Judgment and skill-granted vulnerability share one +20%
    if (e.frozen > 0) vuln += 0.25;
    if (e.sunder && p && e.sunderOwner === p.pid) vuln += 0.04 * e.sunder;
    if (e.venom > 0 && p) vuln += e.venom / 100 * (ED.CONST.VENOM_AMP + e.corrode) * ((e.venomBy & (1 << p.slot)) ? 1 : ED.CONST.VENOM_ALLY) * (st.cryotoxin && e.frozen > 0 ? 2 : 1); // Venom: full from a hero who added it, shared from allies
    dmg *= vuln;
    const aff = src.clsEl ? this.affC(src.clsEl) : src.el && !src.affDone ? this.elemAff(src.el) : 1;
    dmg *= aff; src.affMul = aff;
    if (e.exposed) dmg *= 1.5;
    if (def.guard && !NO_GUARD[kind] && !src.noGuard && !(e.venom >= 100)) { // a Corroded foe has lost its guard
      const ox = src.x !== undefined ? src.x : p ? p.x : undefined, oy = src.y !== undefined ? src.y : p ? p.y : undefined;
      if (ox !== undefined && Math.abs(U.angDiff(e.guardA || 0, Math.atan2(oy - e.y, ox - e.x))) <= def.guard.arc / 2) {
        dmg *= def.guard.mul; guarded = true;
        this.emit({ t: 'guardhit', x: Math.round(e.x), y: Math.round(e.y) });
      }
    }
    dmg *= e.dmgTakenMul ?? 1;
    if (e.ward > 0) { const ab = Math.min(e.ward, dmg * 0.75); e.ward -= ab; dmg -= ab; if (e.ward <= 0) this.emit({ t: 'wardbreak', x: e.x, y: e.y }); }
    src.critOut = crit; src.guarded = guarded;
    if (dmg <= 0) return 0;
    e.hp -= dmg; e.flash = 0.1;
    if (src.knock && !e.boss) {
      const kb = src.knock * (e.elite ? 0.45 : 1) * (e.def.ai === 'tank' ? 0.35 : 1);
      e.kbx += (src.kx || 0) * kb; e.kby += (src.ky || 0) * kb;
    }
    if (kind !== 'dot' || dmg >= 3) {
      const ev = { t: 'hit', x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(dmg), c: crit ? 1 : 0, k: kind === 'dot' ? 1 : 0, pid: p ? p.pid : '', el: src.bleed ? 4 : EL_IDX[src.el || src.clsEl] || 0 };
      if (src.wpn && kind === 'weapon' && st && st.heavy) ev.h = 1; // heavy weapon hit: the viewer's hit-stop
      if (src.far) ev.f = 1; // a far shot (Deadeye): the viewer's bright spark
      this.emit(ev);
    }
    if (p) {
      p.dealt += dmg;
      if (src.wpn && kind === 'weapon' && st.heavy && e.hp > 0 && !e.boss && e.staggerT <= 0 && e.stunCd <= 0) { e.stun = Math.max(e.stun, e.elite ? ED.CONST.STAGGER * 0.5 : ED.CONST.STAGGER); e.staggerT = ED.CONST.STAGGER_CD; } // Stagger never sets stunCd
      if (shatter) this.shatterBurst(e, p, dmg);
      if (!src.noProc) this.heroProcs(e, p, dmg, crit, comp, src);
      if (ch && ch.hitDone) ch.hitDone.call(this, p, e, dmg, crit, src);
    }
    if (e.hp <= 0) this.killEnemy(e, p, src);
    else if (e.doom > 0) this.checkReap(e);
    return dmg;
  };

  // On-hit effects of a direct hero hit: infusions (minions: infusions only, at half strength) and crit effects; every adder builds from the damage before the hit's affinity (the adder applies its own once).
  W.heroProcs = function (e, p, dmg, crit, comp, src) {
    const st = p.stats;
    if (comp) { this.applyInfusions(e, dmg, p, src, src.infK || ED.CONST.MINION_INFUSE); return; }
    const k = src.infK || 1;
    this.applyInfusions(e, dmg, p, src, k);
    const pow = 1 + st.statusPow, pre = dmg / (src.affMul || 1);
    if (src.burn) this.addBurn(e, pre * src.burn * pow, p);
    if (st.bleedAll && e.hp > 0) this.addBleed(e, pre * st.bleedAll * pow * k, p); // the Knight, Ranger and Shade Element route: everything the hero hits bleeds
    const ch = CLS[p.cls];
    if (ch && ch.procs) ch.procs.call(this, e, p, dmg, crit, src);
    if (crit) {
      const bl = Math.max(st.bleed, src.bleedMin || 0);
      if (bl) this.addBleed(e, pre * bl * pow, p);
      if (st.sunder) { if (e.sunderOwner !== p.pid) { e.sunderOwner = p.pid; e.sunder = 0; } e.sunder = Math.min(10, e.sunder + Math.min(2, hpFrac(e, pre) * 60)); } // stacks from crit damage: 60 per foe HP, <= 2 per crit
      if (st.critCharge) this.addCharge(e, pre * st.critCharge * pow, p);
    }
  };

  // Element infusions: each owned element (plus src.infAdd rates) builds status from the hit's damage before the affinity of the hit (dmg / src.affMul; the adder applies the affinity once). k scales the rate (minions 0.5).
  W.applyInfusions = function (e, dmg, p, src, k) {
    const st = p.stats, add = src && src.infAdd, pre = dmg / ((src && src.affMul) || 1), pow = k * (1 + st.statusPow);
    for (let i = 0; i < ED.ELEMENT_IDS.length; i++) {
      const id = ED.ELEMENT_IDS[i], el = ED.ELEMENTS[id];
      let rate = ((st[el.inf] || 0) + ((add && add[id]) || 0)) * pow;
      if (!(rate > 0)) continue;
      if (id === 'holy' && p.shield > 0 && st.radiantAegis) rate *= 2;
      else if (id === 'shadow' && st.abyssDoom && (e.elite || e.boss) && src && src.kind === 'minion') rate *= 2; // Abyssal Hunger
      this[el.add](e, UNIT[el.unit](e, pre) * rate, p);
      if (e.hp <= 0) return;
    }
  };

  // Bleed pool: physical, no affinity; drains like Burn (tickStatuses).
  W.addBleed = function (e, amount, p) {
    if (!(amount > 0) || e.killed || e.def.invuln || e.burrowed) return;
    if (e.bleedPool <= 0) e.bleedTick = 0.5;
    e.bleedPool += amount; e.bleedOwner = p;
  };

  // Burn pool: aff-scaled; ticks in tickStatuses. Conflagration checks after every addition.
  W.addBurn = function (e, amount, p) {
    if (!(amount > 0) || e.killed || e.def.invuln || e.burrowed) return;
    if (e.burnPool <= 0) e.burnTick = 0.5;
    e.burnPool += amount * this.elemAff('fire');
    e.burn = 1;
    if (p) e.burnOwner = p;
    if (p && p.stats.conflag) this.checkCombust(e, p);
  };

  // A pool above 30% of current HP combusts: the whole pool hits the foe and, at SPLASH_MUL, every foe within 70.
  W.checkCombust = function (e, p) {
    const pool = e.burnPool;
    if (e.hp <= 0 || pool < 5 || pool <= e.hp / e.hpLever * 0.3) return;
    e.burnPool = 0; e.burn = 0;
    const dmg = pool * (1 + p.stats.burnMul), r = 70;
    this.emit({ t: 'combust', x: Math.round(e.x), y: Math.round(e.y), r });
    for (let i = 0, n = this.enemies.length; i < n; i++) {
      const o = this.enemies[i];
      if (o.hp <= 0 || o.spawnT > 0 || o.def.invuln || (o !== e && U.dist2(o.x, o.y, e.x, e.y) > (r + o.r) ** 2)) continue;
      this.hitEnemy(o, o === e ? dmg : dmg * ED.CONST.SPLASH_MUL, { p, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true, el: 'fire', affDone: true });
    }
  };

  // Chill build-up (aff, chillMul, boss/elite resistance; Thermal Shock and Cryotoxin build it 25% faster on burning / envenomed foes); reaching the threshold freezes. Frozen foes gain none.
  W.addChill = function (e, amount, p) {
    if (!(amount > 0) || e.hp <= 0 || e.frozen > 0 || e.def.invuln || e.burrowed) return;
    const st = p ? p.stats : NO_STATS;
    e.chill += amount * (1 + (st.chillMul || 0)) * (st.thermal && e.burnPool > 0 ? 1.25 : 1) * (st.cryotoxin && e.venom > 0 ? 1.25 : 1) * this.elemAff('ice') * rankOf(e);
    e.chillT = 1.5;
    if (p) e.chillOwner = p;
    if (e.chill >= 100 * (1 + 0.5 * e.freezeRes)) this.freezeEnemy(e, p);
  };

  // Venom (0-100): amount x (1 + venomBuild) x affinity x gauge resistance; moved Venom (Spore Burst, Pandemic) skips build bonus and affinity but keeps the resistance.
  // Each gain refreshes the hold, adds the hero's slot to venomBy and keeps the strongest corrode.
  W.addVenom = function (e, amount, p, moved) {
    if (!(amount > 0) || !p || e.hp <= 0 || e.def.invuln || e.burrowed) return;
    e.venom = Math.min(100, e.venom + amount * (moved ? 1 : (1 + p.stats.venomBuild) * this.elemAff('poison')) * rankOf(e));
    e.venomT = ED.CONST.VENOM_HOLD + p.stats.venomHold;
    e.venomOwner = p; e.venomBy |= 1 << p.slot;
    if (p.stats.corrode > e.corrode) e.corrode = p.stats.corrode;
  };

  // Radiance builds with affinity and never decays; a gauge of SMITE_AT x real HP Smites (checkSmite).
  W.addRadiance = function (e, amount, p) {
    if (!(amount > 0) || !p || e.hp <= 0 || e.killed || e.def.invuln || e.burrowed) return;
    e.rad += amount * this.elemAff('holy');
    e.radOwner = p;
    this.checkSmite(e);
  };

  // Natural Smite: the pool's owner Smites for the stored Radiance. Waits while the foe cannot take damage.
  W.checkSmite = function (e) {
    const o = e.radOwner;
    if (!o || e.hp <= 0 || e.spawnT > 0 || e.invulnT > 0 || e.burrowed || e.def.invuln || e.rad < smiteAt(e)) return;
    const amt = e.rad; e.rad = 0;
    const own = this.openChain();
    this.smite(e, o, amt);
    if (own) this.curChain = null;
  };

  // A Smite of stored amount amt on e by o: holy damage, then the owner's duo effects and shields for heroes within HOLY_R of the smitten foe (HOLY_GRANT_MAX per grant, once per HOLY_CD per hero).
  W.smite = function (e, o, amt) {
    const st = o.stats, C = ED.CONST, corroded = e.venom >= 100, big = e.elite || e.boss;
    const dmg = amt * (1 + st.smiteMul + (big ? st.smiteBig : 0)) * (st.hoarlight && e.frozen > 0 ? 2 : 1) * (st.purge && corroded ? 1.5 : 1);
    const x = e.x, y = e.y;
    this.hitEnemy(e, dmg, { p: o, kind: 'smite', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', affDone: true });
    let n = 0;
    const g = Math.min(C.HOLY_GRANT_MAX, st.smiteShield * (big ? 2 : 1) * (st.purge && corroded ? 2 : 1));
    for (const q of this.players.values()) {
      if (q.downed || q.dead || q.holyT > 0 || U.dist2(q.x, q.y, x, y) > C.HOLY_R * C.HOLY_R) continue;
      this.addShield(q, q.maxHp * g, q.maxHp * st.holyCap, 'holy');
      q.holyT = C.HOLY_CD; n++;
      if (st.guardLight) { q.glV = q.glT > 0 ? Math.max(q.glV, st.guardLight) : st.guardLight; q.glT = C.GL_T; } // Guardian Light: the heroes this Smite shields deal more for GL_T
    }
    this.emit({ t: 'smite', x: Math.round(x), y: Math.round(y), pid: o.pid, n });
    if (st.beacon || st.sunfire || st.hoarlight) {
      for (const f of this.enemies) {
        if (f === e || f.hp <= 0 || f.spawnT > 0 || f.def.invuln || f.burrowed) continue;
        const d2 = U.dist2(f.x, f.y, x, y);
        if (st.beacon && d2 <= (70 + f.r) ** 2) this.hitEnemy(f, dmg * st.beacon, { p: o, kind: 'smite', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', affDone: true });
        if (f.hp <= 0) continue;
        if (st.sunfire && d2 <= (60 + f.r) ** 2) this.addBurn(f, dmg * 0.6, o);
        if (st.hoarlight && d2 <= (70 + f.r) ** 2) this.addChill(f, hpFrac(f, dmg) * C.CHILL_K, o);
      }
    }
    if (e.hp > 0) {
      if (st.smiteJudge) e.judged = Math.max(e.judged, st.smiteJudge); // Judging Light
      if (st.sunfire) this.addBurn(e, dmg * 0.6, o);
      if (st.hoarlight) this.addChill(e, hpFrac(e, dmg) * C.CHILL_K, o);
      if (st.twilight) this.addDoom(e, dmg, o);
    }
    if (st.heavenwrath) this.queuePayoff(o, { kind: 'wrath', e, x, y, amt: dmg });
    if (st.smiteBeam) this.queuePayoff(o, { kind: 'beam', e, x, y, amt: dmg * st.smiteBeam, jumps: st.beamJumps }); // Prism
  };

  // Doom (HP units): elites and bosses take DOOM_TOUGH (+ doomTough) of it; builds with affinity and never decays. A Reap or Toll may follow at once.
  W.addDoom = function (e, amount, p) {
    if (!(amount > 0) || !p || e.hp <= 0 || e.killed || e.def.invuln || e.burrowed) return;
    const st = p.stats;
    e.doom += amount * (1 + st.doomMul) * this.elemAff('shadow') * (e.elite || e.boss ? ED.CONST.DOOM_TOUGH + st.doomTough : 1);
    e.doomOwner = p;
    if (e.boss) this.checkToll(e); else this.checkReap(e);
  };

  // The health at or below which a foe is Reaped: its Doom (x2 frozen with Black Ice) + Burn still to come (Black Flame) + Venom (Necrosis). Duo flags are the Doom owner's.
  W.doomLine = function (e) {
    if (!(e.doom > 0)) return 0;
    const st = e.doomOwner ? e.doomOwner.stats : NO_STATS;
    let line = e.doom * (st.blackice && e.frozen > 0 ? 2 : 1);
    if (st.blackflame) line += e.burnPool * (1 + st.burnMul);
    if (st.necrosis) line += e.maxHp * 0.1 * e.venom / 100;
    return line;
  };

  // Reap: a non-boss foe whose health (plus ward) fell to its Doom line dies to the Doom owner.
  W.checkReap = function (e) {
    if (!(e.doom > 0) || e.boss || e.hp <= 0 || e.killed || e.spawnT > 0 || e.def.invuln || e.burrowed || e.invulnT > 0) return;
    const o = e.doomOwner;
    if (!o || e.hp + e.ward > this.doomLine(e)) return;
    const own = this.openChain(), left = e.hp;
    o.dealt += left;
    this.emit({ t: 'hit', x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(left), c: 0, k: 0, pid: o.pid, el: 7 });
    this.emit({ t: 'reap', x: Math.round(e.x), y: Math.round(e.y), pid: o.pid });
    this.killEnemy(e, o, { kind: 'reap' });
    if (own) this.curChain = null;
  };

  // Toll: a boss whose Doom reached TOLL_AT of its HP takes all of it as damage. While it cannot take damage the Doom is kept (retried on each status tick).
  W.checkToll = function (e) {
    const o = e.doomOwner;
    if (!o || !e.boss || e.hp <= 0 || e.doom < ED.CONST.TOLL_AT * e.maxHp || e.invulnT > 0 || e.burrowed || e.def.invuln) return;
    const d = e.doom * (o.stats.necrosis && e.venom >= 100 ? 1.25 : 1) * (1 + o.stats.tollMul);
    e.doom = 0;
    const own = this.openChain();
    this.hitEnemy(e, d, { p: o, kind: 'toll', raw: true, noProc: true, crit: false, noGuard: true, el: 'shadow', affDone: true });
    this.emit({ t: 'toll', x: Math.round(e.x), y: Math.round(e.y), pid: o.pid });
    this.onDoomPayoff(o);
    const th = CLS[o.cls];
    if (th && th.toll) th.toll.call(this, o, e, d); // class hook: a Toll of d damage landed on boss e
    if (own) this.curChain = null;
  };

  // Death Knell and Death's Edge: each Reap or Toll.
  W.onDoomPayoff = function (o) {
    const st = o.stats;
    if (st.knell) { o.knellN = Math.min(st.knell, o.knellN + 1); o.knellT = 6; }
    if (st.deathsEdge) this.grantCrits(o, 1, 3, 'add');
  };

  // ---------------- class-route engines: stuns, ailments, status moves, crit grants ----------------
  // Hero stun of dur seconds on a non-boss foe. Elites take half. A normal stun lasts half as long while stunCd > 0 and sets stunCd = dur + STUN_DR;
  // a repeating source (waves, shocks, Overload) is skipped while stunCd > 0 and sets stunCd to at least 1 s. Returns the seconds applied.
  W.stunFoe = function (e, dur, repeating) {
    if (!e || e.hp <= 0 || e.boss || e.def.invuln || e.burrowed || !(dur > 0)) return 0;
    const C = ED.CONST;
    if (e.elite) dur *= C.ELITE_STUN;
    if (repeating) {
      if (e.stunCd > 0) return 0;
      e.stun = Math.max(e.stun, dur); e.stunCd = Math.max(e.stunCd, C.STUN_CD);
      return dur;
    }
    if (e.stunCd > 0) dur *= 0.5;
    e.stun = Math.max(e.stun, dur); e.stunCd = Math.max(e.stunCd, dur + C.STUN_DR);
    return dur;
  };

  // Ailments on a foe: each status above its threshold, Dazed (stunned or blinded) and Sealed count 1. The host sends the count in the foe flags; Brand, Open Veins, Contagion and Gangrene read min(4, count).
  W.ailments = function (e) {
    let n = 0;
    const mh = e.maxHp;
    if (e.burnPool >= 0.01 * mh) n++;
    if (e.chill >= 25 || e.frozen > 0) n++;
    if (e.charge >= 0.01 * mh) n++;
    if (e.venom > 25) n++;
    if (e.rad >= 0.25 * smiteAt(e)) n++;
    if ((e.boss ? e.doom : this.doomLine(e)) >= 0.02 * mh) n++;
    if (e.bleedPool >= 0.01 * mh) n++;
    if (e.stun > 0 || e.blind > 0) n++;
    if (e.sealT > 0) n++;
    return n;
  };

  // Moves the statuses of foe src onto dst: a share f of each HP pool (Burn, Bleed, Charge, Doom, Radiance; dst takes at most SPREAD_CAP of its own max HP per pool, src loses what moved while it lives)
  // and of the Chill and Venom gauges (no build bonus or affinity; gauge resistance applies). The receiver keeps each pool's owner; Venom adds the source's venomBy and corrode. Frozen is never copied.
  W.moveStatuses = function (src, dst, f) {
    if (!src || !dst || src === dst || dst.hp <= 0 || dst.def.invuln || dst.burrowed || !(f > 0)) return;
    const cap = ED.CONST.SPREAD_CAP * dst.maxHp, live = src.hp > 0;
    let got;
    if (src.burnPool > 0) { got = Math.min(f * src.burnPool, cap); if (got > 0) { if (!(dst.burnPool > 0)) dst.burnTick = 0.5; dst.burnPool += got; dst.burn = 1; dst.burnOwner = src.burnOwner; if (live) src.burnPool -= got; } }
    if (src.bleedPool > 0) { got = Math.min(f * src.bleedPool, cap); if (got > 0) { if (!(dst.bleedPool > 0)) dst.bleedTick = 0.5; dst.bleedPool += got; dst.bleedOwner = src.bleedOwner; if (live) src.bleedPool -= got; } }
    if (src.charge > 0) { got = Math.min(f * src.charge, cap); if (got > 0) { dst.dischargeT = dst.charge > 0 ? Math.min(dst.dischargeT, 1) : 1; dst.charge += got; dst.chargeOwner = src.chargeOwner; if (live) src.charge -= got; } }
    if (src.doom > 0) { got = Math.min(f * src.doom, cap); if (got > 0) { dst.doom += got; dst.doomOwner = src.doomOwner; if (live) src.doom -= got; if (dst.boss) this.checkToll(dst); else this.checkReap(dst); } }
    if (src.rad > 0 && dst.hp > 0) { got = Math.min(f * src.rad, cap); if (got > 0) { dst.rad += got; dst.radOwner = src.radOwner; if (live) src.rad -= got; this.checkSmite(dst); } }
    if (src.chill > 0 && dst.hp > 0 && dst.frozen <= 0) { got = Math.min(100, dst.chill + f * src.chill * rankOf(dst)); if (got > dst.chill) { dst.chill = got; dst.chillT = 1.5; dst.chillOwner = src.chillOwner; if (live) src.chill = Math.max(0, src.chill - f * src.chill); } }
    if (src.venom > 0 && dst.hp > 0 && src.venomOwner) {
      const v0 = dst.venom;
      this.addVenom(dst, f * src.venom, src.venomOwner, true);
      if (dst.venom > v0) { dst.venomBy |= src.venomBy; if (src.corrode > dst.corrode) dst.corrode = src.corrode; if (live) src.venom = Math.max(0, src.venom - f * src.venom); }
    }
  };

  // Crit stacks a skill or payoff readies, scaled by the weapon fork's rate (a Heavy fork's crit is worth more damage): n stacks capped at cap; mode 'set' raises the stored count to n, 'add' adds n.
  W.grantCrits = function (p, n, cap, mode) {
    const k = p.stats.critK, nK = Math.round(n * k), capK = Math.round(cap * k);
    p.critStacks = mode === 'add' ? Math.min(capK, (p.critStacks | 0) + nK) : Math.max(p.critStacks | 0, Math.min(capK, nK));
  };

  // A foe in the last PARRY_WIN of a wind-up (state or live telegraph zone): a Cleave that lands now parries it.
  W.parryable = function (e) {
    if (e.boss || e.hp <= 0 || e.spawnT > 0 || e.stun > 0 || e.frozen > 0 || e.def.invuln) return false;
    const win = ED.CONST.PARRY_WIN;
    if ((e.st === 'windup' || e.st === 'aim' || e.st === 'cast') && e.t > 0 && e.t <= win) return true;
    for (const z of this.zones) if (z.team === 1 && z.src === e && !z.detached && WINDUP[z.kind] && z.dur - z.t <= win && z.dur - z.t > 0) return true;
    return false;
  };

  // Sworn Blade Parry by hero p on foe e: cancels the wind-up (elites are only stunned, half as long, not cancelled), stuns PARRY_STUN, once per PARRY_CD per hero and PARRY_FOE_CD per foe. Returns whether it parried.
  W.parry = function (e, p) {
    const C = ED.CONST;
    if (!p.stats.parry || this.time < p.parryT || this.time < e.parryT || !this.parryable(e)) return false;
    p.parryT = this.time + C.PARRY_CD; e.parryT = this.time + C.PARRY_FOE_CD;
    this.stunFoe(e, C.PARRY_STUN, false);
    if (!e.elite) {
      this.zones = this.zones.filter(z => !(z.team === 1 && z.src === e && WINDUP[z.kind] && !z.detached));
      e.st = 'move'; e.t = 0; e.cd = Math.max(e.cd, 1);
    }
    this.emit({ t: 'parry', x: Math.round(e.x), y: Math.round(e.y - e.r * 0.5), pid: p.pid });
    return true;
  };

  // ---------------- chain queue: forced payoffs of duos and keystones ----------------
  // A natural payoff (Smite, Reap, Toll, discharge, freeze, a death) opens a chain id (this.curChain); payoffs it spawns queue behind it and inherit the id with hop + 1.
  // Each foe pays out at most once per chain id. Nothing is dropped: a trigger hero runs CHAIN_TICK entries per tick, the rest wait.
  W.openChain = function () {
    if (this.curChain) return false;
    this.curChain = { cid: ++this.chainSeq, hop: 0 };
    return true;
  };

  // True (and marks it) the first time foe e pays out a payoff of this kind in chain cid.
  // twilight marks the Reaped source of a ripple entry; twilightHit marks the foes a ripple already force-Smote (a Reaped target still queues its own entry).
  // spread marks a foe that already received a status spread in the chain.
  const PAID = { thermal: 1, firedamp: 2, reaper: 4, blackice: 8, wrath: 16, sc: 32, twilight: 64, twilightHit: 128, spread: 256, verdict: 1 << 12, beam: 1 << 13 };
  const firstPay = (e, cid, kind) => {
    if (e.cid !== cid) { e.cid = cid; e.cidMask = 0; }
    if (e.cidMask & PAID[kind]) return false;
    e.cidMask |= PAID[kind];
    return true;
  };

  // en: { kind, e (foe that pays out), x, y, amt, ... }. The caller has already reset the gauge or pool the entry spends.
  W.queuePayoff = function (tr, en) {
    const own = this.openChain(), c = this.curChain;
    if (own) this.curChain = null;
    if (en.e && !firstPay(en.e, c.cid, en.kind)) return;
    en.tr = tr; en.cid = c.cid; en.hop = c.hop + 1; en.at = this.time + ED.CONST.CHAIN_HOP;
    this.chainQ.push(en);
  };

  // Runs the due entries (insertion order, at most CHAIN_TICK per trigger hero per tick); entries queued while running wait for a later tick.
  W.updateChains = function () {
    const q = this.chainQ;
    if (!q.length) return;
    if (q.length > this.chainPeak) this.chainPeak = q.length;
    const keep = [], ran = {};
    this.chainQ = [];
    for (let i = 0; i < q.length; i++) {
      const en = q[i], who = en.tr ? en.tr.pid : '';
      if (en.at > this.time || (ran[who] | 0) >= ED.CONST.CHAIN_TICK) { keep.push(en); continue; }
      ran[who] = (ran[who] | 0) + 1;
      if (en.hop > this.chainHops) this.chainHops = en.hop;
      this.curChain = { cid: en.cid, hop: en.hop };
      this.runPayoff(en);
      this.curChain = null;
    }
    this.chainQ = keep.concat(this.chainQ);
  };

  // Area payoff of a forced chain entry: damage dmg of element el to foes within r of (x, y), credited to the trigger hero (affDone: dmg already carries the affinity); onHit(foe, dealt) for each foe still standing.
  W.payBlast = function (tr, x, y, r, dmg, el, boom, onHit, affDone, skip, kind) {
    for (let i = 0, n = this.enemies.length; i < n; i++) {
      const o = this.enemies[i];
      if (o === skip || o.hp <= 0 || o.spawnT > 0 || U.dist2(o.x, o.y, x, y) > (r + o.r) ** 2) continue;
      const got = this.hitEnemy(o, dmg, { p: tr, kind, raw: true, noProc: true, crit: false, noGuard: true, el, x, y, affDone: !!affDone });
      if (onHit && got > 0 && o.hp > 0) onHit(o, got);
    }
    this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r, k: boom });
  };

  W.runPayoff = function (en) {
    const tr = en.tr, st = tr ? tr.stats : NO_STATS, C = ED.CONST, e = en.e;
    switch (en.kind) {
      case 'thermal': // 60% of a Thermal Shock detonation bursts to foes within 70 and chills them
        this.payBlast(tr, en.x, en.y, 70, en.amt * C.SPLASH_MUL, 'fire', 'fire', (o, got) => this.addChill(o, hpFrac(o, got) * C.CHILL_K, tr), true, e, 'thermal');
        break;
      case 'firedamp': { // the blast's survivors catch Burn (50%) and Venom, built from the damage before the fire affinity
        const pre = 1 / this.elemAff('fire');
        this.payBlast(tr, en.x, en.y, 80, en.amt, 'fire', 'firedamp', (o, got) => { this.addBurn(o, got * pre * 0.5, tr); this.addVenom(o, hpFrac(o, got * pre) * C.VENOM_K * 0.5, tr); }, false, null, 'firedamp');
        break;
      }
      case 'reaper': this.payBlast(tr, en.x, en.y, 80, en.amt, 'shadow', 'shadow', null, false, null, 'reaper'); break;
      case 'blackice': this.payBlast(tr, en.x, en.y, 70, en.amt, 'ice', 'ice', null, false, null, 'blackice'); break;
      case 'wrath': // thunderbolt: 60% of the Smite as Lightning; the smitten foe is charged with half of the bolt (wrathQ remembers it so discharging it returns no Radiance)
        this.emit({ t: 'chain', k: 'h', pts: [[Math.round(en.x), Math.round(en.y) - 90], [Math.round(en.x), Math.round(en.y)]] });
        this.payBlast(tr, en.x, en.y, 70, en.amt * 0.6, 'lightning', 'bolt', null, false, null, 'wrath');
        if (e && e.hp > 0) this.addCharge(e, en.amt * 0.3, tr, true);
        break;
      case 'sc': // Short Circuit: the dead foe's charge discharges at once
        e.charge = en.ch;
        this.discharge(e, tr, 1 + st.shortCircuit);
        break;
      case 'spread': { // a share en.f of the dead foe e's statuses passes to each of the en.n nearest foes within en.r (Ruin Spreads, Contagion, Bloodbloom); a foe receives at most once per chain id
        const near = [];
        for (const o of this.enemies) {
          if (o === e || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || (o.cid === en.cid && (o.cidMask & PAID.spread))) continue;
          const d2 = U.dist2(o.x, o.y, en.x, en.y);
          if (d2 < ((en.r || 80) + o.r) ** 2) near.push({ d2, o });
        }
        near.sort((a, b) => a.d2 - b.d2);
        for (let i = 0; i < (en.n || 2) && i < near.length; i++) { firstPay(near[i].o, en.cid, 'spread'); this.moveStatuses(e, near[i].o, en.f); }
        break;
      }
      case 'twilight': { // each Reap forces a Smite on the nearest foe within 120 this chain has not touched, joined by a black-gold beam
        let best = null, bd = 120 * 120;
        for (const o of this.enemies) {
          if (o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || o.invulnT > 0 || (o.cid === en.cid && (o.cidMask & PAID.twilightHit))) continue;
          const d2 = U.dist2(o.x, o.y, en.x, en.y);
          if (d2 < bd) { bd = d2; best = o; }
        }
        if (!best) break;
        firstPay(best, en.cid, 'twilightHit');
        this.emit({ t: 'chain', k: 't', pts: [[Math.round(en.x), Math.round(en.y)], [Math.round(best.x), Math.round(best.y)]] });
        const amt = Math.max(1.5 * best.rad, 0.5 * smiteAt(best));
        best.rad = 0; best.radOwner = tr;
        this.smite(best, tr, amt);
        break;
      }
      case 'verdict': case 'beam': CLS.cleric.payoff.call(this, en); break; // Cleric: Verdict burst, Prism beam
      default: break;
    }
  };

  W.freezeEnemy = function (e, p) {
    const st = p ? p.stats : NO_STATS;
    e.frozen = e.boss ? 0.6 : 1.6 * (1 + (st.freezeDur || 0)) * (e.elite ? 0.75 : 1);
    e.chill = 0; e.chillT = 0;
    if (e.freezeRes <= 0) e.freezeResT = 6;
    e.freezeRes++;
    this.emit({ t: 'freeze', x: Math.round(e.x), y: Math.round(e.y) });
    if (st.thermal && e.burnPool > 0) { // Thermal Shock: the Burn pool x2 hits the foe now; 60% of that bursts to its neighbours (queued) and chills them
      const own = this.openChain(), dmg = e.burnPool * 2 * (1 + st.burnMul);
      e.burnPool = 0; e.burn = 0;
      const got = this.hitEnemy(e, dmg, { p, kind: 'thermal', raw: true, noProc: true, crit: false, noGuard: true, el: 'fire', affDone: true });
      if (got > 0) this.queuePayoff(p, { kind: 'thermal', e, x: e.x, y: e.y, amt: got });
      if (own) this.curChain = null;
    }
    if (st.frostNova) {
      for (let i = 0, n = this.enemies.length; i < n; i++) {
        const o = this.enemies[i];
        if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, e.x, e.y) < (100 + o.r) ** 2) this.addChill(o, 60, p);
      }
      this.emit({ t: 'nova', x: e.x, y: e.y, r: 100, c: '#7fe3ff' });
    }
  };

  // Shatter: the hit ends the freeze; 50% of its damage bursts to foes within 60 (infused, never shatters again).
  W.shatterBurst = function (e, p, dmg) {
    e.frozen = 0;
    const r = 60;
    this.emit({ t: 'shatter', x: Math.round(e.x), y: Math.round(e.y), r });
    for (let i = 0, n = this.enemies.length; i < n; i++) {
      const o = this.enemies[i];
      if (o === e || o.hp <= 0 || o.spawnT > 0 || U.dist2(o.x, o.y, e.x, e.y) > (r + o.r) ** 2) continue;
      this.hitEnemy(o, dmg * 0.5, { p, kind: 'explode', raw: true, crit: false, noShatter: true, noGuard: true, el: 'ice', x: e.x, y: e.y });
    }
  };

  // Charge build-up; the first charge arms the discharge timer (1 s, 0.5 s for a Tempest hero). wrath: charge made by a Wrath of Heaven bolt (returns no Radiance when it discharges).
  W.addCharge = function (e, amount, p, wrath) {
    if (!(amount > 0) || e.hp <= 0 || e.def.invuln || e.burrowed) return;
    const iv = p && evoOf(p) === 'lightning' ? 0.5 : 1, add = amount * this.elemAff('lightning');
    e.dischargeT = e.charge > 0 ? Math.min(e.dischargeT, iv) : iv;
    e.charge += add;
    if (wrath) e.wrathQ += add;
    if (p) e.chargeOwner = p;
  };

  // Releases e's charge onto itself and its nearest foes. Emits chain pts as a star (hub, target, hub, target ...).
  // Duo effects (the discharging hero's flags) read the damage each target took before the Lightning affinity.
  W.discharge = function (e, p, mul) {
    const ch = e.charge;
    if (!(ch > 0)) return;
    const own = this.openChain();
    e.charge = 0; e.dischargeT = 0;
    const wq = e.wrathQ; e.wrathQ = 0;
    const st = p ? p.stats : NO_STATS;
    const froz = !!st.supercond && e.frozen > 0; // Superconductor: a frozen foe's discharge deals +50% and arcs to 2 more foes at full strength
    const dmg = ch * (1 + (st.shockMul || 0)) * (mul || 1) * (froz ? 1.5 : 1);
    const range = 140 * (1 + (st.arcRange || 0));
    const near = [];
    for (const o of this.enemies) {
      if (o === e || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed) continue;
      const d2 = U.dist2(o.x, o.y, e.x, e.y);
      if (d2 < (range + o.r) ** 2) near.push({ d2, o });
    }
    near.sort((a, b) => a.d2 - b.d2);
    const n = 3 + (st.arcs || 0) + (froz ? 2 : 0) + (st.plasma && e.burnPool > 0 ? 1 : 0) + (st.galvanic && e.venom >= 100 ? 1 : 0), armMul = froz ? 1 : ED.CONST.ARC_MUL;
    const tg = [e];
    for (let i = 0; i < n && i < near.length; i++) tg.push(near[i].o);
    const hx = Math.round(e.x), hy = Math.round(e.y), pts = [[hx, hy]];
    for (let i = 1; i < tg.length; i++) pts.push([Math.round(tg[i].x), Math.round(tg[i].y)], [hx, hy]);
    const ev = { t: 'chain', pts };
    if (froz) ev.k = 's';
    if (tg.length > 1) { pts.pop(); this.emit(ev); } else { ev.pts = [[hx, hy], [hx, hy - 24]]; this.emit(ev); }
    const pre = 1 / this.elemAff('lightning'), C = ED.CONST;
    for (const t of tg) {
      if (t.hp <= 0) continue;
      const got = this.hitEnemy(t, t === e ? dmg : dmg * armMul, { p, kind: 'chain', raw: true, noProc: true, crit: false, el: 'lightning', affDone: true, x: e.x, y: e.y });
      if (t.hp <= 0 || !p) continue;
      if (st.supercond) this.addChill(t, hpFrac(t, got * pre) * C.CHILL_K, p);
      if (st.galvanic) this.addVenom(t, hpFrac(t, got * pre) * C.VENOM_K, p);
      if (st.blackLight) this.addDoom(t, got * pre * 0.5, p);
      if (st.plasma) this.addBurn(t, got * pre * 0.4, p);
      if (t.hp > 0 && st.heavenwrath && t === e) this.addRadiance(t, 0.3 * got * pre * (1 - wq / ch), p); // Wrath of Heaven: the discharging foe stores Radiance, none from charge a bolt made
      if (t.hp > 0 && st.arcStun) this.stunFoe(t, st.arcStun, true);
    }
    if (p && st.thunderbolt && e.hp > 0 && this.time >= p.boltAt && this.rng.chance(st.thunderbolt)) {
      p.boltAt = this.time + ED.CONST.BOLT_CD;
      this.emit({ t: 'bolt', x: Math.round(e.x), y: Math.round(e.y) });
      this.explode(e.x, e.y, 60, ED.procDmg(ED.BOONS.thunderhead, st), 0, p, 'bolt', true, { el: 'lightning' });
    }
    if (own) this.curChain = null;
  };

  // Chain pulse of the Venom pool: a Corroded foe gives its Pandemic owner's share of Venom to the 2 nearest foes within 90 that hold less (moved Venom; the receivers inherit venomBy and corrode).
  W.pandemic = function (e, o) {
    const near = [];
    for (const x of this.enemies) {
      if (x === e || x.hp <= 0 || x.spawnT > 0 || x.def.invuln || x.burrowed || x.venom >= e.venom) continue;
      const d2 = U.dist2(x.x, x.y, e.x, e.y);
      if (d2 < (90 + x.r) ** 2) near.push({ d2, x });
    }
    near.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < 2 && i < near.length; i++) {
      const x = near[i].x;
      this.addVenom(x, e.venom * o.stats.pandemic, o, true);
      x.venomBy |= e.venomBy;
      if (e.corrode > x.corrode) x.corrode = e.corrode;
    }
  };

  // Per-tick status upkeep: burn/bleed pools, discharge timer, chill decay, freeze resistance, Venom decay, slows and debuff timers.
  W.tickStatuses = function (e, dt) {
    if (e.burnPool > 0) {
      e.burnTick -= dt;
      if (e.burnTick <= 0) {
        e.burnTick += 0.5;
        const o = e.burnOwner;
        if (o && o.stats.conflag) this.checkCombust(e, o);
        if (e.burnPool > 0) {
          const d = Math.min(e.burnPool, Math.max(1, e.burnPool * 0.2));
          e.burnPool -= d;
          if (e.burnPool < 1e-3) e.burnPool = 0;
          this.hitEnemy(e, d * (1 + (o ? o.stats.burnMul : 0)), { p: o, kind: 'dot', raw: true, noProc: true, crit: false, el: 'fire', affDone: true });
        }
      }
      e.burn = e.burnPool > 0 ? 1 : 0;
    } else e.burn = 0;
    if (e.hp <= 0) return;
    if (e.bleedPool > 0) {
      e.bleedTick -= dt;
      if (e.bleedTick <= 0) {
        e.bleedTick += 0.5;
        const o = e.bleedOwner, d = Math.min(e.bleedPool, Math.max(1, e.bleedPool * 0.2));
        e.bleedPool -= d;
        if (e.bleedPool < 1e-3) e.bleedPool = 0;
        this.hitEnemy(e, d * (1 + (o ? o.stats.bleedMul : 0)), { p: o, kind: 'dot', raw: true, noProc: true, crit: false, bleed: true });
      }
    }
    if (e.hp <= 0) return;
    if (e.charge > 0) {
      e.dischargeT -= dt;
      if (e.dischargeT <= 0) this.discharge(e, e.chargeOwner, 1);
    }
    if (e.hp <= 0) return;
    if (e.venom > 0) { // Venom holds venomT seconds after the last gain, then fades; a Corroded foe spreads it with Pandemic
      if (e.venomT > 0) e.venomT -= dt; else e.venom = Math.max(0, e.venom - ED.CONST.VENOM_DECAY * dt);
      if (e.venom <= 0) { e.venomBy = 0; e.corrode = 0; }
      else if (e.venom >= 100 && e.venomOwner && e.venomOwner.stats.pandemic && (e.plagueT -= dt) <= 0) { e.plagueT += 1; this.pandemic(e, e.venomOwner); }
    }
    if (e.boss && e.doom > 0) this.checkToll(e); // a Toll that had to wait for the boss to be vulnerable
    if (e.stunCd > 0) e.stunCd -= dt;
    if (e.blindCd > 0) e.blindCd -= dt;
    if (e.staggerT > 0) e.staggerT -= dt;
    if (e.shieldStunT > 0) e.shieldStunT -= dt;
    if (e.sealT > 0) e.sealT -= dt;
    if (e.weakT > 0) e.weakT -= dt;
    if (e.hexT > 0 && (e.hexT -= dt) <= 0) e.hexBy = 0;
    if (e.chill > 0) {
      if (e.chillT > 0) e.chillT -= dt;
      else e.chill = Math.max(0, e.chill - 25 * dt);
    }
    if (e.freezeRes > 0) {
      e.freezeResT -= dt;
      if (e.freezeResT <= 0) { e.freezeRes--; e.freezeResT = 6; }
    }
    if (e.frozen > 0) e.frozen -= dt;
    if (e.stun > 0) e.stun -= dt;
    if (e.judged > 0) e.judged -= dt;
    if (e.vulnT > 0) e.vulnT -= dt;
    if (e.blind > 0) e.blind -= dt;
    let slow = 1 - Math.min(0.45, e.chill / 180);
    if (e.slowT > 0) { e.slowT -= dt; slow *= 1 - e.slowAmt; } else e.slowAmt = 0;
    e.slow = slow; e.windMul = 1 + e.chill / 220;
  };

  W.killEnemy = function (e, p, src) {
    if (e.killed) return;
    e.killed = true; e.hp = 0;
    src = src || {};
    const def = e.def, s = this.stratum;
    this.run.kills++;
    if (p) p.kills++;
    this.emit({ t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: e.elite ? 1 : 0, r: e.r });
    this.onEnemyKilledSkill(e, p, src);
    if (def.boss) { this.onBossKilled(e); return; }
    this.deathPayoffs(e, p, src);
    const xpMul = 1 + 0.35 * (s - 1);
    this.dropXp(e.x, e.y, def.xp * xpMul * (e.elite ? 3 : 1));
    if (this.rng.chance(e.elite ? 1 : 0.12)) this.dropGold(e.x, e.y, (1 + Math.floor((s - 1) / 2)) * (e.elite ? 3 : this.rng.int(1, 2)));
    if (this.rng.chance(e.elite ? 0.4 : 0.04)) this.spawnPickup('heart', e.x, e.y, 1);
    if (e.elite) {
      this.run.elitesKilled++; this.run.embers.elites += 2 + Math.floor(s / 2);
      if (e.elite === 'volatile') this.addZone({ kind: 'tele', x: e.x, y: e.y, r: 70, dur: 0.7, team: 1, dmg: e.dmg * 1.2, boom: 'fire' });
    }
    if (def.split) for (let i = 0; i < def.split.n; i++) {
      const c = this.spawnEnemy(def.split.into, e.x + this.rng.range(-8, 8), e.y + this.rng.range(-8, 8));
      c.kbx = this.rng.range(-160, 160); c.kby = this.rng.range(-160, 160); c.cd = 0.6;
    }
    if (def.deathCloud) this.addZone({ kind: 'poison', x: e.x, y: e.y, r: def.deathCloud.r, dur: def.deathCloud.dur, dps: def.deathCloud.dps * (1 + 0.2 * (s - 1)), team: 1 });
    if (p && src.kind !== 'minionBurst') {
      const st = p.stats;
      if (st.chalice && p.chaliceHp < 30) { // Grail of Ages: +1 max health per 3 kills (growth does not heal)
        p.chaliceKills++;
        if (p.chaliceKills % 3 === 0) { p.chaliceHp++; const hp = p.hp; this.recalc(p, false); p.hp = hp; if (p.chaliceHp % 5 === 0) this.sendBuild(p); }
      }
    }
  };

  // Payoffs of a foe's death, each spent from the pool of its owner: a Reap's keystone and duo effects (the Doom owner), Black Flame's Burn hand-off, Wildfire and Firedamp (Burn owner), Spore Burst (Venom owner), Short Circuit (charge owner).
  W.deathPayoffs = function (e, p, src) {
    const own = this.openChain(), x = e.x, y = e.y, half = e.elite ? 0.5 : 1;
    if (src.kind === 'reap' && p) {
      const rs = p.stats;
      this.onDoomPayoff(p);
      if (rs.blackflame && e.burnPool > 0) {
        const nx = this.nearestEnemy(x, y, 90);
        if (nx) { if (!(nx.burnPool > 0)) nx.burnTick = 0.5; nx.burnPool += e.burnPool; nx.burn = 1; nx.burnOwner = p; e.burnPool = 0; }
      }
      if (rs.reaper) this.queuePayoff(p, { kind: 'reaper', e, x, y, amt: e.maxHp * rs.reaper * half });
      if (rs.blackice && e.frozen > 0) this.queuePayoff(p, { kind: 'blackice', e, x, y, amt: e.maxHp * 0.2 * half });
      if (rs.twilight) this.queuePayoff(p, { kind: 'twilight', e, x, y });
    }
    const bo = e.burnOwner;
    if (bo && e.burnPool > 0) {
      const bs = bo.stats;
      if (bs.wildfire) {
        for (let i = 0, n = this.enemies.length; i < n; i++) {
          const o = this.enemies[i];
          if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, x, y) < (80 + o.r) ** 2) this.addBurn(o, e.maxHp / e.hpLever * bs.wildfire, bo);
        }
        this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: 80, k: 'fire' });
      }
      if (bs.firedamp && e.venom > 0) this.queuePayoff(bo, { kind: 'firedamp', e, x, y, amt: e.maxHp * 0.2 * half });
    }
    const vo = e.venomOwner;
    if (vo && e.venom > 0 && vo.stats.sporeBurst) {
      for (let i = 0, n = this.enemies.length; i < n; i++) {
        const o = this.enemies[i];
        if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, x, y) < (80 + o.r) ** 2) this.addVenom(o, e.venom * vo.stats.sporeBurst, vo, true);
      }
      this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: 80, k: 'acid' });
    }
    const co = e.chargeOwner;
    if (co && e.charge > 0 && co.stats.shortCircuit) {
      const ch = e.charge; e.charge = 0;
      this.queuePayoff(co, { kind: 'sc', e, x, y, ch });
    }
    if (own) this.curChain = null;
  };

  // Called every tick from updatePlayerBuild for a living, standing hero: spectral twin queue and dash effects.
  // Dash riders deal Class Power (not weapon damage): foes passed through take power x dashDmg once per dash (Dawn Stride also blinds, Noxious Step and Umbral Step add Venom and Doom), Cold Snap rings the hero for power x dashFrost.
  W.updatePlayerCombat = function (p, dt) {
    const st = p.stats, q = p.twinQ;
    if (q && q.length) {
      for (let i = 0; i < q.length;) {
        q[i].t -= dt;
        if (q[i].t <= 0) { const a = q[i].a; q.splice(i, 1); this.playerAttack(p, a, 0.4); } else i++;
      }
    }
    // dash effects (host sees remote dashes through their state reports)
    if (p.dashing) {
      if (st.dashDmg) {
        if (!p.dashHit) p.dashHit = new Set();
        const dmg = st.power * st.dashDmg, add = st.dashVenom || st.dashDoom ? { poison: st.dashVenom, shadow: st.dashDoom } : undefined;
        for (const e of this.enemies) {
          if (e.hp <= 0 || p.dashHit.has(e.id)) continue;
          if (U.dist2(e.x, e.y, p.x, p.y) < (e.r + p.r + 8) ** 2) {
            p.dashHit.add(e.id);
            this.hitEnemy(e, dmg, { p, kind: 'dash', knock: 80, kx: p.dashDx, ky: p.dashDy, infAdd: add });
            if (st.dashBlind && e.hp > 0 && !e.boss && e.blindCd <= 0) { e.blind = Math.max(e.blind, e.elite ? 0.5 : 1); e.blindCd = ED.CONST.BLIND_CD; }
          }
        }
      }
      if (st.dashFrost && !p.dashRing) {
        p.dashRing = true;
        const dmg = st.power * st.dashFrost;
        for (const e of this.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, p.x, p.y) < (80 + e.r) ** 2) this.hitEnemy(e, dmg, { p, kind: 'dash', noGuard: true });
        this.emit({ t: 'nova', x: p.x, y: p.y, r: 80, c: '#7fe3ff' });
      }
      if (st.dashFire) {
        p.dashTrail -= dt;
        if (p.dashTrail <= 0) { p.dashTrail = 0.05; this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: 22, dur: 2.2, dps: ED.procDmg(ED.BOONS.cindertrail, st), owner: p.pid, team: 0 }); }
      }
    } else { p.dashHit = null; p.dashRing = false; }
  };

  // ---------------- heroes take damage ----------------
  // src: { e (source foe), proj, pr (projectile), hazard, x, y (origin) }
  W.hurtPlayer = function (p, amount, src) {
    src = src || {};
    if (!p || p.downed || p.dead || this.state !== 'play') return false;
    if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillIfr) return false;
    const st = p.stats;
    if (src.proj && st.mirror && this.rng.chance(st.mirror)) { this.emit({ t: 'block', x: p.x, y: p.y, k: 'mirror' }); return false; }
    if (!src.hazard && st.dodge && this.rng.chance(st.dodge)) { this.emit({ t: 'block', x: p.x, y: p.y, k: 'dodge' }); p.invuln = 0.25; return false; }
    if (!src.hazard && st.aegis && p.aegisT <= 0) { p.aegisT = 10; p.invuln = 0.4; this.emit({ t: 'block', x: p.x, y: p.y, k: 'aegis' }); return false; }
    let dmg = amount * ED.Stats.armorMul(st.armor) * (1 + st.vuln);
    // Brace (own, or a Knight with Hold the Line within 100) x the best Sanctuary here, never below DR_FLOOR; Last Stand and Verdict weaken stack separately
    let braceF = 1, sanctF = 1;
    if (p.braceT > 0) braceF = 1 - Math.min(0.4, st.braceDR);
    for (const q of this.players.values()) if (q !== p && q.braceT > 0 && q.stats.braceAura && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 100 * 100) braceF = Math.min(braceF, 1 - Math.min(0.4, q.stats.braceDR));
    for (const z of this.zones) if (z.kind === 'sanct' && U.dist2(z.x, z.y, p.x, p.y) < z.r * z.r) sanctF = Math.min(sanctF, 1 - Math.min(0.4, z.dr === undefined ? 0.15 : z.dr));
    dmg *= Math.max(ED.CONST.DR_FLOOR, braceF * sanctF);
    if (p.guardT > 0) dmg *= 0.4;
    const e = src.e;
    if (e && e.weakT > 0) dmg *= 1 - e.weakV;
    if (e && e.chill > 0 && e.chillOwner) dmg *= 1 - e.chillOwner.stats.chillWeaken;
    dmg = Math.max(1, Math.round(dmg));
    if (e && e.def.gloom) dmg = Math.min(dmg, Math.max(1, Math.round(p.maxHp * ED.CONST.GLOOM_CAP)));
    if (p.shield > 0) {
      const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab;
      const hc = CLS[p.cls];
      if (hc && hc.absorb) hc.absorb.call(this, p, ab, src);
      if (st.radiantAegis && e && e.hp > 0 && p.retT <= 0) { // Radiant Aegis: the shield strikes the attacker for 200% of what it absorbed (0.25 s apart)
        p.retT = 0.25;
        this.hitEnemy(e, ab * 2, { p, kind: 'retribution', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy' });
      }
    }
    p.hp -= dmg; p.invuln = src.hazard ? 0.3 : 0.6; p.hurtT = 0.3;
    if (this.boss) p.hitThisBoss = true;
    if (dmg > 0) this.emit({ t: 'hurt', pid: p.pid, v: dmg, x: Math.round(p.x), y: Math.round(p.y) });
    else this.emit({ t: 'block', x: p.x, y: p.y, k: 'aegis' });
    if (e && e.hp > 0) {
      if (st.thorns) this.hitEnemy(e, st.thorns, { p, kind: 'thorns', noProc: true, crit: false });
      if (e.elite === 'vampiric') e.hp = Math.min(e.maxHp, e.hp + dmg * 3);
      if (e.def.chillHit) p.chilled = 1.5;
    }
    if (st.guardian && p.hp > 0 && p.hp < p.maxHp * 0.3 && p.guardCd <= 0) { p.guardT = 3; p.guardCd = 20; this.emit({ t: 'guard', pid: p.pid }); }
    if (st.frozenHeart && p.frozenCd <= 0) {
      p.frozenCd = 8;
      for (const en of this.enemies) if (en.hp > 0 && !en.boss && !en.def.invuln && U.dist2(en.x, en.y, p.x, p.y) < 120 * 120) en.frozen = 1.6;
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 120, c: '#9fefff' });
    }
    if (p.hp <= 0) this.playerLethal(p);
    return true;
  };

  W.playerLethal = function (p) {
    const st = p.stats;
    if (st.phoenix && !p.phoenixUsed) { p.phoenixUsed = true; p.hp = Math.round(p.maxHp * 0.5); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'phoenix', x: p.x, y: p.y }); this.explode(p.x, p.y, 110, ED.procDmg(ED.RELICS.phoenix, st), 0, p, 'fire'); return; }
    if (st.angel && !p.angelUsed) { p.angelUsed = true; p.hp = 1; p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'angel', x: p.x, y: p.y }); return; }
    if (p.secondWind > 0) { p.secondWind--; p.hp = Math.round(p.maxHp * p.swPct); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'wind', x: p.x, y: p.y }); return; }
    p.hp = 0; p.downed = true; p.bleed = this.partySize() > 1 ? 18 : 0.01; p.revive = 0;
    this.emit({ t: 'down', pid: p.pid, x: p.x, y: p.y });
  };

  // Area damage. team 0 = heroes' blast (hurts foes), team 1 = hostile blast (hurts heroes). opts merges into each hit's src.
  W.explode = function (x, y, r, dmg, team, owner, look, noProc, opts) {
    if (team === 0) {
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0) continue;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < r + e.r) {
          this.hitEnemy(e, dmg, Object.assign({ p: owner, kind: 'explode', knock: 90, kx: (e.x - x) / (d || 1), ky: (e.y - y) / (d || 1), noProc: !!noProc, crit: false, noGuard: true, x, y }, opts));
          if (opts && opts.stun && e.hp > 0) this.stunFoe(e, opts.stun, true); // opts.stun: a repeating stun (shocks, waves)
        }
      }
    } else {
      for (const p of this.players.values()) if (Math.hypot(p.x - x, p.y - y) < r + p.r) this.hurtPlayer(p, dmg, { e: owner && owner.hp !== undefined && owner.def ? owner : null, x, y });
    }
    this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r), k: look || 'fire' });
  };

  // ---------------- hero attacks ----------------
  // twinMul > 0: a spectral-twin repeat (weapon part only, scaled by twinMul).
  // A Knight with Oath of Steel swings a Cleave every (3 + cleaveN)th attack and on the first swing after a Charge with Follow-Through (o.cleave = its damage bonus); the class hook attackOpts adds per-hit options to every weapon hit, attack runs after the attack.
  W.playerAttack = function (p, a, twinMul) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, w = st.weapon, evo = evoOf(p), ch = CLS[p.cls], C = ED.CONST;
    if (twinMul > 0) {
      const o = { mul: twinMul, twin: true };
      if (evo === 'shadow') o.infAdd = { shadow: st.shadowInfuse }; // Umbral Arms: twin hits mark double Doom
      if (w.kind === 'melee') this.meleeSwing(p, a, w, undefined, 0, o); else this.fireWeapon(p, a, w, undefined, o);
      return;
    }
    p.face = a; p.atkCount++; p.stealthT = 0; p.lastAtkT = this.time;
    if (st.swift) p.flowT = C.FLOW_T;
    let crit, amb = null;
    if (p.critStacks > 0) { p.critStacks--; crit = true; }
    if (p.ambush) {
      p.ambush = false; crit = true; amb = { mul: ED.Stats.skillNums('vanish', st).p.ambush.dmg / w.dmg, ambush: true }; // the Ambush hit deals the unforked weapon times 2.5 whatever the fork
      this.emit({ t: 'ambush', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
    }
    if (st.masterstroke && p.atkCount % 4 === 0) { // Masterstroke: every 4th attack crits at +30% and Bleeds for at least 50% of the hit
      crit = true;
      amb = Object.assign({}, amb, { mul: ((amb && amb.mul) || 1) * 1.3, bleedMin: 0.5 });
    }
    const acid = evo === 'poison' && p.atkCount % 3 === 0 && w.kind !== 'melee'; // Venomous Arms: the first shot of every 3rd ranged attack carries acid
    if (acid) amb = Object.assign({}, amb, { acid: true });
    if (st.cleave > 0 && w.kind === 'melee') {
      const follow = this.time < p.cleaveNext;
      if (follow || p.atkCount % (3 + st.cleaveN) === 0) { amb = Object.assign({}, amb, { cleave: st.cleave + (follow ? st.chargeCleave : 0) }); p.cleaveNext = 0; }
    }
    const co = ch && ch.attackOpts ? ch.attackOpts.call(this, p, st) : null;
    const base = co ? Object.assign({}, co, amb) : amb;
    const reps = st.twinEvery && p.atkCount % st.twinEvery === 0 ? 2 : 1;
    for (let rep = 0; rep < reps; rep++) {
      const o = rep === 0 ? base : co;
      if (w.kind === 'melee') this.meleeSwing(p, a + rep * 0.18, w, crit, rep, o);
      else this.fireWeapon(p, a + rep * 0.06, w, crit, o);
    }
    if (w.wave) {
      const every = Math.max(1, w.wave.every + st.waveEvery);
      if (p.atkCount % every === 0) {
        const wv = this.spawnProj({ team: 0, kind: 'wave', x: p.x, y: p.y, a, speed: 320, r: 16 * (1 + st.area * 0.5), dmg: w.dmg * w.wave.mul * (1 + st.waveMul), life: 0.55, pierce: 99, owner: p.pid, knock: 120, wpn: true });
        if (ch && ch.waveShot) ch.waveShot.call(this, p, wv, a, st); // class hook: edit the wave shot (width, range, stun, homing)
      }
    }
    if (st.gauntlet && p.atkCount % 6 === 0) {
      const tgt = this.nearestEnemy(p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, 220);
      if (tgt) { this.emit({ t: 'bolt', x: Math.round(tgt.x), y: Math.round(tgt.y) }); this.explode(tgt.x, tgt.y, 40, w.dmg * 2.2, 0, p, 'bolt', false, { el: 'lightning' }); }
    }
    if (evo === 'shadow') (p.twinQ || (p.twinQ = [])).push({ t: 0.15, a });
    else if (evo) this.evoAttack(p, a, w, evo);
    if (ch && ch.attack) ch.attack.call(this, p, a, st, w);
    this.emit({ t: 'atk', pid: p.pid, a: Math.round(a * 100) / 100, n: p.atkCount });
  };

  // Evolution strikes launched with an attack. They count as hero hits (infuse) and never trigger further evolution extras.
  W.evoAttack = function (p, a, w, evo) {
    const st = p.stats, melee = w.kind === 'melee', area = 1 + st.area * 0.5;
    const shot = (kind, ang, mul, speed, life, pierce, r, extra) => this.spawnProj(Object.assign({
      team: 0, kind, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed, r, dmg: w.dmg * mul, life, pierce, owner: p.pid, hk: 'evo', knock: 60,
    }, extra));
    if (evo === 'fire') {
      if (melee) shot('crescent', a, 0.6, 360, 0.45, 99, 16 * area, { knock: 90 });
    } else if (evo === 'ice') {
      if (p.atkCount % 3 === 0) {
        const life = (melee ? 220 : 360) / 420;
        for (let i = 0; i < 5; i++) shot('iceshard', a + (i - 2) * 0.225, 0.5, 420, life, 1, 5);
      }
    } else if (evo === 'lightning') {
      if (p.atkCount % 4 === 0) {
        const tgt = this.nearestEnemy(p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, 220);
        if (tgt) { this.emit({ t: 'bolt', x: Math.round(tgt.x), y: Math.round(tgt.y) }); this.explode(tgt.x, tgt.y, 50 * area, w.dmg * 1.5, 0, p, 'bolt', false, { kind: 'evo', el: 'lightning' }); }
      }
    } else if (evo === 'poison') {
      if (melee && p.atkCount % 3 === 0) { // acid bursts at the swing tip (ranged weapons carry it on their first shot)
        const reach = w.range * (1 + st.area * 0.5 + st.meleeReach);
        this.acidBurst(p, p.x + Math.cos(a) * reach * 0.8, p.y + Math.sin(a) * reach * 0.8);
      }
    } else if (evo === 'holy') {
      if (p.atkCount % 3 === 0) this.holyLance(p, a, w);
    }
  };

  // Venomous Arms: acid bursts at (x, y): radius 50, 60% weapon damage as Poison, +200% Venom.
  W.acidBurst = function (p, x, y) {
    const st = p.stats;
    this.explode(x, y, 50 * (1 + st.area * 0.5), st.weapon.dmg * 0.6, 0, p, 'acid', false, { kind: 'evo', el: 'poison', infAdd: { poison: 2 }, crit: false });
  };

  // Hallowed Arms: a lance of light along the aim (melee 150 long, ranged 260, 20 wide) hits every foe on it for 80% weapon damage as Holy; a wall ends it.
  W.holyLance = function (p, a, w) {
    const len = w.kind === 'melee' ? 150 : 260, end = Sim.castMove(this.room, p.x, p.y, a, len, 2, this.locked);
    const x0 = p.x, y0 = p.y - 4, x1 = end.x, y1 = end.y - 4;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      if (U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + 10) ** 2) this.hitEnemy(e, w.dmg * 0.8, { p, kind: 'evo', el: 'holy', crit: false, noGuard: true, x: x0, y: y0 });
    }
    this.emit({ t: 'lance', x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1), pid: p.pid });
  };

  // o: { mul (extra damage multiplier), ambush, spectral, twin, infAdd, bleedMin, cleave (Cleave damage bonus) }
  // A Cleave reaches and sweeps 40% further, knocks back twice as hard, parries a foe in the last moments of its wind-up (Sworn Blade) and cracks the ground with Oathbreaker's shock.
  W.meleeSwing = function (p, a, w, crit, rep, o) {
    o = o || {};
    const st = p.stats, cl = o.cleave > 0, wpn = !o.twin && !o.spectral;
    const reach = w.range * (1 + st.area * 0.5 + st.meleeReach) * (cl ? 1.4 : 1);
    const arc = Math.min(6.3, w.arc * (1 + st.area * 0.4) * (cl ? 1.4 : 1));
    const mul = (o.mul || 1) * (cl ? 1 + o.cleave : 1);
    let anyCrit = false;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d - e.r > reach) continue;
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      if (arc < 6.2 && Math.abs(U.angDiff(a, ang)) > arc / 2 + Math.atan2(e.r, Math.max(d, 1))) continue;
      if (cl && st.parry && this.parry(e, p) && st.riposte) this.grantCrits(p, st.riposte, 5, 'add');
      const hs = { p, kind: 'weapon', wpn, part: cl ? 'cleave' : undefined, crit, mul: mul === 1 ? undefined : mul, ambush: o.ambush, infAdd: o.infAdd, bleedMin: o.bleedMin, knock: cl ? w.knock * 2 : w.knock, kx: Math.cos(ang), ky: Math.sin(ang) };
      this.hitEnemy(e, w.dmg, hs);
      if (hs.critOut) anyCrit = true;
    }
    if (w.shock && rep === 0) this.explode(p.x + Math.cos(a) * reach * 0.55, p.y + Math.sin(a) * reach * 0.55, w.shock.r * (1 + st.area * 0.5), w.dmg * w.shock.mul * mul, 0, p, 'shock', true, { wpn });
    if (cl && st.cShock) this.explode(p.x + Math.cos(a) * reach * 0.9, p.y + Math.sin(a) * reach * 0.9, 72 * (1 + st.area * 0.5), w.dmg * st.cShock, 0, p, 'shock', true, { wpn: true, stun: st.cStun });
    const ev = { t: 'swing', pid: p.pid, a: Math.round(a * 100) / 100, r: Math.round(reach), arc: Math.round(arc * 100) / 100 };
    if (cl) ev.k = 'cleave';
    this.emit(ev);
    if (anyCrit && evoOf(p) === 'general' && !o.spectral && !o.twin) this.meleeSwing(p, a, w, undefined, 1, { mul: 0.6, spectral: true });
  };

  W.fireWeapon = function (p, a, w, crit, o) {
    o = o || {};
    const st = p.stats, evo = evoOf(p), area = 1 + st.area * 0.5;
    const n = w.n + st.projN;
    const sp = n > 1 ? Math.max(w.spread || 0, 0.13) : 0;
    const pyre = evo === 'fire' && !o.twin; // Cinder Arms: plain shots explode (r40, 50%); exploding weapons get a 30% wider blast and a burning patch
    const ex = w.explode ? { r: w.explode.r * area * (pyre ? 1.3 : 1) * (o.blastMul || 1), mul: w.explode.mul, patch: pyre } : pyre ? { r: 40 * area, mul: 0.5 } : null; // o.blastMul / o.pierce: per-attack options of a class hook (attackOpts)
    const spec = evo === 'general' && !o.spectral && !o.twin, wpn = !o.twin && !o.spectral;
    for (let i = 0; i < n; i++) {
      const ang = a + (i - (n - 1) / 2) * sp + (w.jitter ? this.rng.range(-w.jitter, w.jitter) : 0);
      this.spawnProj({
        team: 0, kind: w.proj, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed: w.speed, r: w.r,
        dmg: w.dmg, life: w.life, pierce: w.pierce + st.pierce + (o.pierce || 0), owner: p.pid, crit, knock: w.knock || 40, mul: o.mul, ambush: o.ambush, spec, wpn,
        explode: ex, infAdd: o.infAdd, bleedMin: o.bleedMin, acid: !!o.acid && i === 0,
        cloud: w.cloud ? { r: w.cloud.r * area, dps: w.cloud.dps, dur: w.cloud.dur } : null,
        homing: (w.homing || 0) + (st.homing || 0), shieldAlly: w.shieldAlly || 0, burn: w.burn || 0,
      });
    }
  };

  W.playerDash = function (p, dx, dy) {
    if (!p || p.downed || p.dead) return;
    p.dashDx = dx; p.dashDy = dy;
    if (p.stats.dashBomb) this.addZone({ kind: 'bomb', x: p.x, y: p.y, r: 60, dur: 0.6, team: 0, owner: p.pid, dmg: ED.procDmg(ED.RELICS.satchel, p.stats) });
    this.emit({ t: 'dash', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
  };

  // ---------------- projectiles ----------------
  // o.hk: hit kind for hitEnemy; o.mul/o.ambush: extra multiplier; o.spec: crits release a spectral copy; o.shieldAlly: shield fraction an ally gets on touch (Sacred Lantern);
  // o.infAdd / o.bleedMin: per-hit infusion rates and Bleed share; o.acid: bursts into Venomous acid on its first hit or at the end of its flight.
  // o.wpn: a weapon shot (its hits are weapon hits); o.part: the skill part its hits belong to; o.ghost: moved and removed by its owner's code (thrown shield: pr.dead removes it); o.infK: infusion scale of its hits;
  // o.stun: seconds of repeating stun on a hit (waves); pr.dist = distance flown (every hero shot) and pr.pass = foes passed; o.homeCone (radians, with o.homing): the shot steers only toward foes within homeCone of o.homeA0 and never turns past it; o.noSplit: reserved for class routes.
  W.spawnProj = function (o) {
    const pr = {
      id: U.uid(), team: o.team, kind: o.kind, x: o.x, y: o.y, vx: Math.cos(o.a) * o.speed, vy: Math.sin(o.a) * o.speed,
      r: o.r || 5, dmg: o.dmg || 1, life: o.life || 2, pierce: o.pierce || 0, owner: o.owner, src: o.src || null,
      crit: o.crit, knock: o.knock || 0, explode: o.explode || null, cloud: o.cloud || null, homing: o.homing || 0,
      shieldAlly: o.shieldAlly || 0, burn: o.burn || 0, hit: null, healed: null, accel: o.accel || 0, turn: o.turn || 0, boom: o.boom || null,
      hk: o.hk || null, mul: o.mul || 0, ambush: !!o.ambush, spec: !!o.spec, infAdd: o.infAdd || null, bleedMin: o.bleedMin || 0, acid: !!o.acid,
      wpn: !!o.wpn, part: o.part || null, ghost: !!o.ghost, dead: false, infK: o.infK || 0, stun: o.stun || 0, dist: 0, pass: 0, homeA0: o.homeA0, homeCone: o.homeCone || 0, noSplit: !!o.noSplit,
    };
    this.projs.push(pr);
    return pr;
  };

  W.enemyShoot = function (e, a, speed, kind, dmgMul, r, extra) {
    const mul = this.pact >= 8 ? 1.2 : 1;
    return this.spawnProj(Object.assign({ team: 1, kind, x: e.x + Math.cos(a) * e.r * 0.6, y: e.y - 4 + Math.sin(a) * e.r * 0.6, a, speed: speed * mul, r: r || 6, dmg: e.dmg * (dmgMul || 1), life: 4, src: e }, extra || {}));
  };

  // Spectral copy of a crit projectile: continues past the foe it just hit at 60% damage.
  W.spectralShot = function (pr, e) {
    const c = this.spawnProj({ team: 0, kind: 'spectral', x: pr.x, y: pr.y, a: Math.atan2(pr.vy, pr.vx), speed: Math.hypot(pr.vx, pr.vy) || 1, r: pr.r + 1, dmg: pr.dmg, mul: 0.6, life: 0.4, pierce: 1, owner: pr.owner, hk: 'evo', knock: pr.knock });
    c.hit = new Set([e.id]);
  };

  W.updateProjectiles = function (dt) {
    const room = this.room, locked = this.locked;
    const keep = [];
    for (const pr of this.projs) {
      if (pr.ghost) { if (!pr.dead) keep.push(pr); continue; }
      pr.life -= dt;
      if (pr.life <= 0) { if (pr.team === 0) { if (pr.explode) this.projBurst(pr); this.projEnd(pr, 'life'); } this.projAcid(pr); continue; }
      if (pr.homing) {
        let tgt = null;
        if (pr.team === 0) tgt = pr.homeCone ? this.nearestEnemy(pr.x, pr.y, 240, pr.hit, pr.homeA0, pr.homeCone) : this.nearestEnemy(pr.x, pr.y, 240, pr.hit);
        else tgt = this.nearestPlayer(pr.x, pr.y);
        if (tgt) {
          const cur = Math.atan2(pr.vy, pr.vx), want = Math.atan2(tgt.y - pr.y, tgt.x - pr.x);
          const sp = Math.hypot(pr.vx, pr.vy);
          let na = cur + U.clamp(U.angDiff(cur, want), -pr.homing * dt, pr.homing * dt);
          if (pr.homeCone) na = pr.homeA0 + U.clamp(U.angDiff(pr.homeA0, na), -pr.homeCone, pr.homeCone);
          pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
        }
      }
      if (pr.turn) { const cur = Math.atan2(pr.vy, pr.vx) + pr.turn * dt, sp = Math.hypot(pr.vx, pr.vy); pr.vx = Math.cos(cur) * sp; pr.vy = Math.sin(cur) * sp; }
      if (pr.accel) { const f = 1 + pr.accel * dt; pr.vx *= f; pr.vy *= f; }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      if (pr.team === 0) pr.dist += Math.hypot(pr.vx, pr.vy) * dt;
      const t = D.tileAt(room, pr.x, pr.y);
      if (D.blocksShots(t, locked)) {
        if (pr.team === 0 && pr.explode) this.projBurst(pr);
        else if (pr.team === 0 && pr.cloud) this.spawnCloud(pr.owner, pr.x - pr.vx * dt, pr.y - pr.vy * dt, pr.cloud);
        if (pr.team === 0) this.projEnd(pr, 'wall');
        this.projAcid(pr);
        this.emit({ t: 'spark', x: Math.round(pr.x), y: Math.round(pr.y), k: ED.PROJ_IDX[pr.kind] || 0 });
        continue;
      }
      let dead = false;
      if (pr.team === 0) {
        const owner = this.players.get(pr.owner);
        for (const e of this.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
          if (pr.hit && pr.hit.has(e.id)) continue;
          const rr = e.r + pr.r;
          if (U.dist2(pr.x, pr.y, e.x, e.y) > rr * rr) continue;
          if (!pr.hit) pr.hit = new Set();
          pr.hit.add(e.id);
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          const hs = { p: owner, kind: pr.hk || 'weapon', crit: pr.crit, mul: pr.mul, ambush: pr.ambush, knock: pr.knock, kx: pr.vx / sp, ky: pr.vy / sp, burn: pr.burn, infAdd: pr.infAdd, infK: pr.infK, bleedMin: pr.bleedMin, x: pr.x, y: pr.y, wpn: pr.wpn, part: pr.part, dist: pr.dist, pass: pr.pass };
          this.hitEnemy(e, pr.dmg, hs);
          const ph = owner && CLS[owner.cls];
          if (ph && ph.projHit) ph.projHit.call(this, pr, e, hs); // class hook: a hero shot hit e (pr.pierce is what is left before this hit is counted)
          if (pr.stun && e.hp > 0) this.stunFoe(e, pr.stun, true);
          this.projAcid(pr);
          if (pr.spec && hs.critOut) this.spectralShot(pr, e);
          if (pr.explode) { this.projBurst(pr); dead = true; break; }
          if (pr.cloud) { this.spawnCloud(pr.owner, pr.x, pr.y, pr.cloud); dead = true; break; }
          if (hs.guarded || pr.pierce-- <= 0) { dead = true; break; }
          pr.pass++;
        }
        if (!dead && pr.shieldAlly && owner) { // Sacred Lantern: an orb shields an ally it touches once (up to CLASS_SHIELD_CAP of max HP, once per LANTERN_CD per ally)
          for (const q of this.players.values()) {
            if (q === owner || q.downed || q.dead || q.lanternT > 0) continue;
            if ((pr.healed && pr.healed.has(q.pid)) || U.dist2(pr.x, pr.y, q.x, q.y) > 20 * 20) continue;
            if (!pr.healed) pr.healed = new Set();
            pr.healed.add(q.pid);
            this.addShield(q, q.maxHp * pr.shieldAlly, q.maxHp * ED.CONST.CLASS_SHIELD_CAP, 'lantern');
            q.lanternT = ED.CONST.LANTERN_CD;
          }
        }
      } else {
        for (const p of this.players.values()) {
          if (p.downed || p.dead) continue;
          const rr = p.r + pr.r - 3;
          if (U.dist2(pr.x, pr.y, p.x, p.y) > rr * rr) continue;
          if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillIfr) continue; // shots pass through i-frames
          this.hurtPlayer(p, pr.dmg, { proj: true, e: pr.src, pr, x: pr.x, y: pr.y });
          if (pr.boom) this.explode(pr.x, pr.y, pr.boom.r, pr.dmg * 0.5, 1, pr.src, pr.boom.k);
          dead = true; break;
        }
      }
      if (!dead) keep.push(pr);
    }
    this.projs = keep;
  };

  // A hero shot ended its flight at (pr.x, pr.y) by running out of life ('life') or hitting a wall ('wall'): the owner's class hook projEnd(pr, owner, why) may add an effect there.
  W.projEnd = function (pr, why) {
    const owner = this.players.get(pr.owner), h = owner && CLS[owner.cls];
    if (h && h.projEnd) h.projEnd.call(this, pr, owner, why);
  };

  // A projectile carrying acid (Venomous Arms) bursts once where it ends.
  W.projAcid = function (pr) {
    if (!pr.acid) return;
    pr.acid = false;
    const owner = this.players.get(pr.owner);
    if (owner) this.acidBurst(owner, pr.x, pr.y);
  };

  W.projBurst = function (pr) {
    const owner = this.players.get(pr.owner);
    if (!owner) return;
    this.explode(pr.x, pr.y, pr.explode.r, pr.dmg * (pr.mul || 1) * pr.explode.mul, 0, owner, pr.kind === 'fireball' ? 'bigfire' : 'fire', false, { wpn: pr.wpn });
    if (pr.explode.patch) this.addZone({ kind: 'pfire', x: pr.x, y: pr.y, r: pr.explode.r * 0.6, dur: 2, dps: pr.dmg * 0.4, owner: pr.owner, team: 0 }); // one burning patch per shot
    const bh = CLS[owner.cls];
    if (bh && bh.projBurst) bh.projBurst.call(this, pr, owner); // class hook: a hero shot blasted at (pr.x, pr.y)
  };

  // ---------------- zones: telegraphs, clouds, fire, sanctuary ----------------
  W.addZone = function (z) {
    z.id = U.uid(); z.t = 0; z.tick = 0;
    this.zones.push(z);
    return z;
  };

  // A weapon cloud: a new cloud within r of the hero's own live cloud joins it as a part { dps, until } (the zone ticks the sum of its live parts and lives until the last one ends), so a hero keeps a few clouds, not one per shot.
  W.spawnCloud = function (owner, x, y, c) {
    for (const z of this.zones) {
      if (z.kind === 'plague' && z.parts && z.owner === owner && U.dist2(z.x, z.y, x, y) < z.r * z.r) {
        z.parts.push({ dps: c.dps, until: z.t + c.dur });
        z.dur = Math.max(z.dur, z.t + c.dur);
        return z;
      }
    }
    return this.addZone({ kind: 'plague', x, y, r: c.r, dur: c.dur, dps: c.dps, owner, team: 0, wpn: true, parts: [{ dps: c.dps, until: c.dur }] });
  };

  W.updateZones = function (dt) {
    const keep = [];
    for (const z of this.zones) {
      const s = z.src;
      if (s && WINDUP[z.kind] && !z.detached) { // a wind-up telegraph follows its caster: stalled while it is frozen or stunned, dropped (no hit, no onEnd) when it dies
        if (s.hp <= 0) continue;
        if (s.frozen > 0 || s.stun > 0) { if (z.update) z.update(this, z, 0); keep.push(z); continue; }
      }
      z.t += dt;
      if (z.follow) { const fo = this.players.get(z.follow); if (fo) { z.x = fo.x; z.y = fo.y; } } // a zone that follows its owner (Aura of Faith)
      if (z.update) z.update(this, z, dt);
      const done = z.t >= z.dur;
      if (z.custom) {
        // custom zones run entirely through z.update; z.onEnd fires once when they expire
        if (done) { if (z.onEnd) z.onEnd(this, z); continue; }
      } else if (z.kind === 'spawn') {
        if (done) {
          const e = this.spawnEnemy(z.type, z.x, z.y, { elite: z.elite, affix: z.affix });
          this.emit({ t: 'spawned', x: Math.round(z.x), y: Math.round(z.y), el: z.elite ? 1 : 0 });
          if (z.after) z.after(e);
          continue;
        }
      } else if (z.kind === 'tele' || z.kind === 'teleLine' || z.kind === 'teleCone' || z.kind === 'bomb' || z.kind === 'decoy') {
        if (done) { this.resolveTele(z); continue; }
      } else if (z.kind === 'laser') {
        if (z.t > z.warm) {
          z.tick -= dt;
          if (z.tick <= 0) {
            z.tick = 0.12;
            const x1 = z.x + Math.cos(z.a) * z.len, y1 = z.y + Math.sin(z.a) * z.len;
            for (const p of this.players.values()) if (U.segDist2(p.x, p.y, z.x, z.y, x1, y1) < (z.w / 2 + p.r) ** 2) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
          }
        }
        if (done) continue;
      } else {
        // damage-over-time fields
        z.tick -= dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          if (z.team === 0) {
            const owner = this.players.get(z.owner), el = z.el || (z.kind === 'pfire' && !z.untagged ? 'fire' : undefined);
            let dps = z.dps;
            if (z.parts) { dps = 0; let k = 0; for (const q of z.parts) if (q.until > z.t) { dps += q.dps; z.parts[k++] = q; } z.parts.length = k; }
            for (const e of this.enemies) {
              if (e.hp <= 0 || e.spawnT > 0 || U.dist2(z.x, z.y, e.x, e.y) >= (z.r + e.r) ** 2) continue;
              this.hitEnemy(e, dps * 0.5, { p: owner, kind: 'dot', noProc: true, crit: false, el, clsEl: z.clsEl, wpn: z.wpn, part: z.part });
              if (z.rad && e.hp > 0 && owner) this.addRadiance(e, dps * 0.5 * z.rad, owner); // z.rad: share of each tick stored as Radiance (Sanctuary)
            }
          } else if (z.dps) {
            for (const p of this.players.values()) if (U.dist2(z.x, z.y, p.x, p.y) < (z.r + p.r * 0.5) ** 2) this.hurtPlayer(p, z.dps * 0.5, { hazard: true, x: z.x, y: z.y });
          }
        }
        if (done) continue;
      }
      keep.push(z);
    }
    // zones created mid-loop were appended to this.zones and visited by the same for-of
    this.zones = keep;
  };

  W.resolveTele = function (z) {
    if (z.warnOnly) { if (z.onEnd) z.onEnd(this, z); return; }
    if (z.team === 0) {
      const owner = this.players.get(z.owner);
      if (owner) this.explode(z.x, z.y, z.r, z.dmg, 0, owner, z.boom || 'shock', true);
      return;
    }
    if (z.kind === 'tele') {
      for (const p of this.players.values()) if (Math.hypot(p.x - z.x, p.y - z.y) < z.r + p.r * 0.6) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
      this.emit({ t: 'boom', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: z.boom || 'slam' });
    } else if (z.kind === 'teleLine') {
      const x1 = z.x + Math.cos(z.a) * z.len, y1 = z.y + Math.sin(z.a) * z.len;
      for (const p of this.players.values()) if (U.segDist2(p.x, p.y, z.x, z.y, x1, y1) < (z.w / 2 + p.r * 0.6) ** 2) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
    } else if (z.kind === 'teleCone') {
      for (const p of this.players.values()) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d < z.r + p.r && Math.abs(U.angDiff(z.a, Math.atan2(p.y - z.y, p.x - z.x))) < z.arc / 2) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
      }
      this.emit({ t: 'cone', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), a: z.a, arc: z.arc });
    }
    if (z.onEnd) z.onEnd(this, z);
  };

  // ---------------- generic enemy tick (behaviour lives in ai.js) ----------------
  W.updateEnemy = function (e, dt) {
    if (e.hp <= 0) return;
    e.flash -= dt; e.mark -= dt; e.contactCd -= dt; e.invulnT = (e.invulnT || 0) - dt;
    if (e.spawnT > 0) { e.spawnT -= dt; return; }
    this.tickStatuses(e, dt);
    if (e.hp <= 0) return;
    if (e.kbx || e.kby) {
      Sim.moveCircle(e, e.kbx * dt, e.kby * dt, this.room, this.locked, e.fly);
      const f = Math.max(0, 1 - 9 * dt); e.kbx *= f; e.kby *= f;
      if (Math.abs(e.kbx) + Math.abs(e.kby) < 4) { e.kbx = 0; e.kby = 0; }
    }
    if (!e.exposed && !e.def.invuln && this.enc && ((!e.boss && this.roomTime > 45) || (e.boss && this.roomTime > 78))) { e.exposed = true; this.emit({ t: 'expose', x: e.x, y: e.y, boss: e.boss ? 1 : 0 }); }
    if (e.exposed && !e.def.invuln) e.hp -= e.maxHp * (e.boss ? 0.012 : 0.04) * dt;
    if (e.hp <= 0) { this.killEnemy(e, null, {}); return; }
    if (e.frozen > 0 || e.stun > 0) return;
    if (e.cd > 0 && !e.boss) e.cd -= dt * this.threat().cdRate; // attack cooldowns recover faster; wind-ups are untouched
    e.tgtT -= dt;
    const t = e.target;
    if (e.tgtT <= 0 || !t || t.ghost || t.stealthT > 0 || !this.alive(t)) {
      const n = this.nearestPlayer(e.x, e.y);
      e.tgtT = 0.6;
      // no visible hero: AI runs against a position-only stand-in {x, y, vx, vy, ghost} at the last seen spot (ai.js/bosses.js read only those fields); nobody up = idle
      if (n) e.target = n;
      else if (t && this.alivePlayers().length) { if (!t.ghost) e.target = { x: t.x, y: t.y, vx: 0, vy: 0, ghost: true }; }
      else e.target = null;
    }
    if (!e.target) return;
    const ai = ED.AI[e.def.ai];
    if (ai) ai(this, e, dt);
    // contact damage: full only during body-hit attack states, otherwise 0.4x
    if (e.contactCd <= 0 && e.def.ai !== 'bomber' && !e.burrowed) {
      for (const p of this.players.values()) {
        if (p.downed || p.dead) continue;
        const rr = e.r + p.r - 3;
        if (U.dist2(e.x, e.y, p.x, p.y) < rr * rr) {
          const full = FULL_CONTACT.has(e.st) || e.def.gloom;
          if (this.hurtPlayer(p, e.dmg * (full ? 1 : 0.4) * (e.boss ? 0.8 : 1), { e, x: e.x, y: e.y })) { e.contactCd = 1.0; e.recoil = 0.35; }
          break;
        }
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
