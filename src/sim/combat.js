// Combat rules: spawning, damage, statuses, deaths, hero attacks, projectiles and area zones.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon;
  const W = ED.World.prototype;

  ED.CONST.ARC_MUL = 0.6; // a discharge's arc targets take this fraction of what the charged foe takes
  ED.CONST.SPLASH_MUL = 0.6; // foes next to a combusting foe take this fraction of the pool
  // Element path rules (docs/GAME-DESIGN.md section 3). CAP_MUL: Capacitor detonation factor. ANCHOR_*: Storm Anchor life, cap per hero, radius, zap interval / reach, discharge reach and burst radius.
  // TETHER_*: Tempest Arms reach between charged foes, links, test interval, per-foe hit cooldown and damage (x weapon). CINDER_*: Cinder Arms scorch life, damage per second (x weapon), cap per hero, line width.
  // PILLAR_*: Glacial Arms pillar life, radius, cap per hero, burst radius and share of the dead foe's HP; QUARRY_T: Quarry length; DOSE_*: Venomous Arms wait, radius and share of the foe's HP at full Venom.
  // FIREBREAK_*: ground a burning death leaves (life, radius, cap per hero); VIGIL_*: stand-still time, radius; REBUKE_*: nova radius, cooldown, the shield share it is measured against.
  Object.assign(ED.CONST, {
    CAP_MUL: 3, ANCHOR_T: 4, ANCHOR_MAX: 2, ANCHOR_R: 12, ANCHOR_ZAP: 0.5, ANCHOR_REACH: 80, ANCHOR_ARC: 200, ANCHOR_BURST: 70,
    TETHER_R: 120, TETHER_N: 6, TETHER_IV: 0.1, TETHER_CD: 0.5, TETHER_MUL: 0.5, CINDER_T: 2, CINDER_DPS: 0.25, CINDER_MAX: 8, CINDER_W: 16,
    PILLAR_T: 4, PILLAR_R: 14, PILLAR_MAX: 6, PILLAR_BURST: 80, PILLAR_HP: 0.15, QUARRY_T: 8, DOSE_T: 3, DOSE_R: 50, DOSE_HP: 0.1,
    FIREBREAK_T: 3, FIREBREAK_R: 34, FIREBREAK_MAX: 6, VIGIL_T: 1, VIGIL_R: 70, REBUKE_R: 100, REBUKE_CD: 1, REBUKE_REF: 0.03, BRUSH_R: 4,
  });
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
  // HP_K: foe-HP units per hero health point (hero health is on a 4x smaller scale than foe health): damage a hero takes or absorbs converts to foe-HP units by it (vampiric heal, Radiant Aegis strike).
  Object.assign(ED.CONST, { HP_K: 4, DR_FLOOR: 0.5, ELITE_STUN: 0.5, STUN_DR: 2, STAGGER: 0.2, STAGGER_CD: 2, PARRY_STUN: 0.6, PARRY_CD: 2.5, PARRY_FOE_CD: 4, PARRY_WIN: 0.3, SPREAD_CAP: 0.25, WAVE_CONE: 25 * Math.PI / 180 });
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
  // Conditional damage added to the hero multiplier st.dmg, in this order (the class hook hitMul runs between the two groups). key: the stat that enables the row (null: a hero state, own() says whether the hero has it);
  // hit(st, e, p, w, src) -> what this hit adds (0 when the condition fails); label says when; per names the unit of a stacking row; live(st, p, ctx) -> the value now for the sheet (ctx.gold, ctx.allyNear).
  const nearAllies = (w, p) => { let near = 0; for (const q of w.players.values()) if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 200 * 200) near++; return near; };
  const COND = ED.COND_DMG = [
    { key: 'execute', label: 'to foes below 30% health', hit: (st, e) => (e.hp < e.maxHp * 0.3 ? st.execute : 0) },
    { key: 'searing', label: 'to burning foes', hit: (st, e) => (e.burnPool > 0 ? st.searing : 0) },
    { key: 'lacerate', label: 'to bleeding foes', hit: (st, e) => (e.bleedPool > 0 ? st.lacerate : 0) },
    { key: 'malice', label: 'to foes carrying Doom', hit: (st, e) => (e.doom > 0 ? st.malice : 0) },
    { key: 'brittle', label: 'to chilled or frozen foes', hit: (st, e) => (e.chill > 0 || e.frozen > 0 ? st.brittle : 0) },
    { key: 'fester', label: 'to envenomed foes', hit: (st, e) => (e.venom > 0 ? st.fester : 0) },
    { key: 'ionize', label: 'to charged foes', hit: (st, e) => (e.charge > 0 ? st.ionize : 0) },
    { key: 'hallow', label: 'to foes holding Radiance', hit: (st, e) => (e.rad > 0 ? st.hallow : 0) },
    { key: 'opportunist', label: 'to stunned, frozen or blinded foes', hit: (st, e) => (e.stun > 0 || e.frozen > 0 || e.blind > 0 ? st.opportunist : 0) },
    { key: null, id: 'knell', label: 'per Death Knell stack, for 6 s', own: (st) => st.knell > 0, value: () => 0.04, hit: (st, e, p) => (p.knellT > 0 ? 0.04 * p.knellN : 0), live: (st, p) => (p.knellT > 0 ? 0.04 * (p.knellN | 0) : 0) },
    { key: 'brand', label: 'for each ailment on the foe (up to 4)', hit: (st, e, p, w) => st.brand * Math.min(4, w.ailments(e)) },
    { key: null, id: 'glight', label: 'while Guardian Light lasts', own: (st, p) => !!(p && p.glT > 0), value: (st, p) => (p && p.glT > 0 ? p.glV : 0), hit: (st, e, p) => (p.glT > 0 ? p.glV : 0), live: (st, p) => (p.glT > 0 ? p.glV : 0) },
    { key: null, id: 'embolden', label: 'while Emboldened by a Cleric aura', own: (st, p) => !!(p && p.auraT > 0), value: (st, p) => (p && p.auraT > 0 ? p.auraV : 0), hit: (st, e, p) => (p.auraT > 0 ? p.auraV : 0), live: (st, p) => (p.auraT > 0 ? p.auraV : 0) },
    { key: 'classElMul', post: true, label: 'to your class-element skills', hit: (st, e, p, w, src) => (src.clsEl ? st.classElMul : 0) },
    { key: 'idol', post: true, label: 'from party gold (1% per 15, at most 20%)', hit: (st, e, p, w) => Math.min(0.2, Math.floor(w.gold / 15) * 0.01), live: (st, p, ctx) => Math.min(0.2, Math.floor((ctx.gold || 0) / 15) * 0.01) },
    { key: 'banner', post: true, label: 'per hero within 200, you included', hit: (st, e, p, w) => st.banner * (1 + nearAllies(w, p)), live: (st, p, ctx) => st.banner * (1 + (ctx.allyNear | 0)) },
  ];
  const COND_PRE = COND.filter(r => !r.post), COND_POST = COND.filter(r => r.post);

  // ---------------- enemies ----------------
  W.spawnEnemy = function (type, x, y, opts) {
    opts = opts || {};
    const def = ED.ENEMIES[type];
    const s = this.stratum, pact = this.pact;
    let hp = def.hp, dmg = def.dmg;
    if (def.fodder) hp = ED.World.fodderHp(def, s, pact);
    else {
      if (!def.boss) hp *= ED.World.hpScale(s);
      hp *= this.partyHpMul();
      hp *= ED.pactMul(pact, 'foeHp') * (def.boss ? ED.pactMul(pact, 'bossHp') : 1);
    }
    dmg *= ED.World.dmgScale(s) * ED.pactMul(pact, 'foeDmg') * this.threat().dmg;
    if (this.room && this.room.dark && !def.minion && !def.ally && !opts.ally) dmg *= ED.World.DARK_DMG; // every foe of a dark room
    const e = {
      id: U.uid(), type, def, x, y, r: def.r, hp, maxHp: hp, dmg, spd: def.spd * (pact >= 6 ? 1.15 : 1) * (def.boss || def.fodder ? 1 : ED.World.foeSpd(s)),
      kbx: 0, kby: 0, st: 'move', t: 0, cd: this.rng.range(0.6, 1.6), face: 1, flash: -1, stun: 0, frozen: 0, elite: null, elite2: null, ward: 0, wardMax: 0,
      boss: !!def.boss, fodder: !!def.fodder, plan: !!opts.plan, age: 0, fly: !!def.fly, target: null, tgtT: 0, aimA: 0, guardA: 0, contactCd: 0, spawnT: opts.spawnT || 0,
      phase: 1, vars: {}, strafe: this.rng.sign(), wob: this.rng.range(0, 6.28), exposed: false, recoil: 0,
      // statuses: burn/bleed pools, chill, charge, Venom (0-100; venomBy = bitmask of hero slots that added it), Radiance, Doom (HP units), hero debuffs (judged = Cleric Judgment, vulnT = Rain/Smoke vulnerability); slow/windMul/dmgTakenMul are read by ai.js and hitEnemy
      // cid = last chain id this foe paid out in; stunCd / blindCd = per-foe cooldowns of Overload / Dawn Stride
      // path states: glacier (frozen by a Glacier hero: solid), quarryT (Quarry: Reap line x2), doses (Venomous Arms [{ at, p }]), affixOff (Hex the Strong), tetherT / snareT (Tempest Arms per-foe cooldowns)
      burn: 0, burnPool: 0, burnTick: 0, burnOwner: null, bleedPool: 0, bleedTick: 0, bleedOwner: null,
      chill: 0, chillT: 0, chillOwner: null, freezeRes: 0, freezeResT: 0, charge: 0, chargeOwner: null, dischargeT: 0,
      venom: 0, venomT: 0, venomOwner: null, venomBy: 0, corrode: 0, plagueT: 0, rad: 0, radOwner: null, doom: 0, doomOwner: null, cid: 0, cidMask: 0, stunCd: 0, blindCd: 0,
      glacier: false, quarryT: 0, doses: null, affixOff: false, tetherT: 0, snareT: 0,
      hpLever: def.boss ? def.hp / def.refHp : def.fodder ? 1 : this.threat().hp, // HP-relative statuses (chill, Conflagration, Wildfire) ignore this stratum lever (fodder carries none)
      mark: 0, judged: 0, vulnT: 0, blind: 0, sunder: 0, sunderOwner: null, slow: 1, slowAmt: 0, slowT: 0, windMul: 1, dmgTakenMul: 1, invulnT: 0, killed: false,
      // class-route foe states: shieldStunT (stunned by a thrown shield), staggerT / parryT (per-foe cooldowns), hexT + hexBy (slot mask), markV (mark vulnerability), sealT, weakT + weakV (Verdict weaken)
      shieldStunT: 0, staggerT: 0, parryT: 0, hexT: 0, hexBy: 0, markV: 0, sealT: 0, weakT: 0, weakV: 0,
    };
    if (opts.elite && !def.fodder) this.makeElite(e, opts.affix);
    if (def.boss) { e.dmgBase = e.dmg; e.furyT = 0; e.furyM = 1; } // fury clock, multiplier and the damage it scales (see tickFury)
    this.enemies.push(e);
    this.foeLate(this.enemies.length - 1);
    return e;
  };

  // Elite: HP and damage multipliers apply once; a second affix (e.elite2, never equal to the first) rolls at World.AFFIX2[stratum - 1]; each affix effect applies once, whichever slot holds it.
  W.makeElite = function (e, affix) {
    e.elite = affix || this.rng.pick(ED.AFFIX_IDS);
    const p2 = ED.World.AFFIX2[this.stratum - 1];
    if (p2 > 0 && this.rng.chance(p2)) e.elite2 = this.rng.pick(ED.AFFIX_IDS.filter(id => id !== e.elite));
    e.hp *= ED.World.ELITE.hp + ED.World.ELITE.hpStep * (this.stratum - 1); e.maxHp = e.hp; e.dmg *= ED.World.ELITE.dmg; e.r = Math.round(e.r * 1.22); // elite HP x2.4 at stratum I up to x4.4 at VI
    if (ED.hasAffix(e, 'swift')) e.spd *= 1.4;
    if (ED.hasAffix(e, 'brutal')) e.dmg *= 1.4;
    if (ED.hasAffix(e, 'warded')) { e.ward = e.maxHp * 0.45; e.wardMax = e.ward; }
  };

  // Stratum affinity: weak x1.5, resist ÷1.5 (fight length mirrors weak), else x1 (el = one of ED.ELEMENT_IDS; General and physical hits pass nothing).
  W.elemAff = function (el) {
    const b = ED.biomeFor(this.stratum);
    return b.weak === el ? 1.5 : b.resist === el ? 1 / 1.5 : 1;
  };
  // Class-skill hits take half the affinity: x1.25 weak, x0.833 resisted. Their statuses use the full elemAff.
  W.affC = function (el) { return 1 + (this.elemAff(el) - 1) / 2; };

  // Slows a foe by amount (0..1) for dur seconds; the strongest slow and the longest duration win.
  W.slowEnemy = function (e, amount, dur) {
    if (!e || e.hp <= 0) return;
    e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, amount);
    e.slowT = Math.max(e.slowT, dur);
  };

  // ---------------- damage to foes (order: hero mul, crit, vulnerability, affinity, exposed, guard, dmgTakenMul, ward) ----------------
  // src: { p, kind, crit, mul, el, clsEl, affDone, raw, noProc, noGuard, noShatter, comp, infAdd, infK, bleedMin, ambush, knock, kx, ky, x, y, part, wpn, dist, pass }. Writes back src.critOut / src.guarded / src.affMul.
  // el tags a hit with an element (affinity x1.5 / ÷1.5 unless affDone); clsEl tags a class-skill hit (half affinity, +classElMul); infAdd { el: rate } adds a per-hit infusion rate that needs no gate; infK scales every infusion of the hit.
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
      let add = 0; // conditional and class additions, scaled by the Ascended damage factor st.dmgX (st.dmg already carries it)
      for (let i = 0; i < COND_PRE.length; i++) { const r = COND_PRE[i]; if (r.key === null || st[r.key]) add += r.hit(st, e, p, this, src); }
      if (ch && ch.hitMul) add += ch.hitMul.call(this, p, e, src) || 0;
      for (let i = 0; i < COND_POST.length; i++) { const r = COND_POST[i]; if (st[r.key]) add += r.hit(st, e, p, this, src); }
      dmg *= Math.max(0.1, st.dmg + add * st.dmgX);
      if (crit) { dmg *= st.critMult; if (ch && ch.critMul) dmg *= ch.critMul.call(this, p, e, src) || 1; }
    }
    if (src.mul) dmg *= src.mul;
    if (p && p.twist) dmg *= ED.TWIST.hitMul.call(this, p, e, src); // TWIST hook (src/sim/twist.js)
    if (src.bossMul && e.boss) dmg *= src.bossMul; // a skill part's boss factor (W.partSrc copies the part's bossMul)
    if (p && kind === 'skill' && !src.noProc && st.shatter && e.frozen > 0 && !src.noShatter) { dmg *= 1 + st.shatter; shatter = true; } // Shatter: a skill hit on a frozen foe
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
    if (e.ward > 0 && !e.affixOff) { const ab = Math.min(e.ward, dmg * 0.75); e.ward -= ab; dmg -= ab; if (e.ward <= 0) this.emit({ t: 'wardbreak', x: e.x, y: e.y }); }
    src.critOut = crit; src.guarded = guarded;
    if (dmg <= 0) return 0;
    e.hp -= dmg;
    if (kind !== 'dot' && e.flash < -0.12) e.flash = 0.066; // visual only: status and zone ticks never flash, a flash is 66 ms and at least 120 ms apart
    if (src.knock && !e.boss) {
      const kb = src.knock * (e.elite ? 0.45 : 1) * (e.def.ai === 'tank' ? 0.35 : 1);
      e.kbx += (src.kx || 0) * kb; e.kby += (src.ky || 0) * kb;
    }
    if (kind !== 'dot' || dmg >= 3) {
      const ev = { t: 'hit', x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(dmg), c: crit ? 1 : 0, k: kind === 'dot' ? (src.zone ? 2 : 1) : 0, pid: p ? p.pid : '', el: src.bleed ? 4 : EL_IDX[src.el || src.clsEl] || 0 };
      if (kind === 'skill') ev.s = 1; // a class-skill hit: the viewer's aggregated skill impact cue (k: 0 hit, 1 status DoT, 2 skill-zone tick)
      if (src.wpn && kind === 'weapon' && st && st.heavy) ev.h = 1; // heavy weapon hit: the viewer's hit-stop
      if (src.far) ev.f = 1; // a far shot (Deadeye): the viewer's bright spark
      if (e.fodder) ev.fd = 1; // the target is fodder (f is taken by the far shot)
      if (src.slow) ev.sl = 1; // a hit that slows (Quickdraw): the viewer's frost streak
      this.emit(ev);
    }
    if (p) {
      p.dealt += dmg;
      if (src.wpn && kind === 'weapon' && st.heavy && e.hp > 0 && !e.boss && e.staggerT <= 0 && e.stunCd <= 0) { e.stun = Math.max(e.stun, e.elite ? ED.CONST.STAGGER * 0.5 : ED.CONST.STAGGER); e.staggerT = ED.CONST.STAGGER_CD; } // Stagger never sets stunCd
      if (shatter) this.shatterBurst(e, p, dmg);
      if (!src.noProc) this.heroProcs(e, p, dmg, crit, comp, src);
      if (ch && ch.hitDone) ch.hitDone.call(this, p, e, dmg, crit, src);
      if (kind === 'skill') this.skillHitPath(p, e);
      if (src.ms && st.msKill && e.hp > 0 && !e.boss && e.hp < e.maxHp * (e.elite ? 0.1 : 0.2)) { p.dealt += e.hp; e.hp = 0; } // Killing Stroke
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

  // A skill hit of hero p on foe e: Quarry marks it (the last foe the skill hit), and a Glacial Arms pillar of p beside it shatters.
  W.skillHitPath = function (p, e) {
    const st = p.stats;
    if (st.quarry && e.hp > 0) {
      const q = p.quarryE;
      if (q && q !== e && q.quarryBy === p.pid) q.quarryT = 0;
      e.quarryT = ED.CONST.QUARRY_T; e.quarryBy = p.pid; p.quarryE = e;
    }
    if (st.evo === 'ice' || st.iceLattice) for (const z of this.zones) if (z.kind === 'pillar' && z.owner === p.pid && !z.dead && U.dist2(z.x, z.y, e.x, e.y) < (z.r + e.r + 30) ** 2) this.shatterPillar(z);
  };

  // Element infusions: each owned element (plus src.infAdd rates) builds status from the hit's damage before the affinity of the hit (dmg / src.affMul; the adder applies the affinity once). k scales the rate (minions 0.5).
  W.applyInfusions = function (e, dmg, p, src, k) {
    const st = p.stats, add = src && src.infAdd, pre = dmg / ((src && src.affMul) || 1), pow = k * (1 + st.statusPow);
    for (let i = 0; i < ED.ELEMENT_IDS.length; i++) {
      const id = ED.ELEMENT_IDS[i], el = ED.ELEMENTS[id];
      let rate = ((st[el.inf] || 0) + ((add && add[id]) || 0)) * pow;
      if (!(rate > 0)) continue;
      if (id === 'holy') { if (st.radiantAegis && (st.penitent ? p.hp < p.maxHp * 0.5 : p.shield > 0)) rate *= 2; if (st.vigil && this.inVigil(p, e)) rate *= 2; } // Radiant Aegis (Penitence: below half health), Vigil
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

  // A pool above 30% of current HP combusts: the whole pool hits the foe and, at SPLASH_MUL, every foe within 70 (Firestorm: they catch SPLASH_MUL of the pool as Burn instead, through the chain queue).
  // Scorched Earth: the combustion leaves Firebreak ground (radius 70, 3 s, 15% of the pool per second).
  W.checkCombust = function (e, p) {
    const pool = e.burnPool, st = p.stats, C = ED.CONST;
    if (e.hp <= 0 || pool < 5 || pool <= e.hp / e.hpLever * 0.3) return;
    e.burnPool = 0; e.burn = 0;
    const dmg = pool * (1 + st.burnMul), r = 70, x = e.x, y = e.y;
    this.emit({ t: 'combust', x: Math.round(x), y: Math.round(y), r });
    if (st.scorchEarth) this.fireGround(p, x, y, r, 3, pool * 0.15);
    if (st.conflagSpread) {
      const own = this.openChain();
      this.queuePayoff(p, { kind: 'firestorm', e, x, y, amt: pool * C.SPLASH_MUL });
      if (own) this.curChain = null;
      this.hitEnemy(e, dmg, { p, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true, el: 'fire', affDone: true });
      return;
    }
    const q = this.foeScan(x, y, r), list = [];
    for (let k = 0; k < q.length; k++) {
      const o = q[k];
      if (o.hp <= 0 || o.spawnT > 0 || o.def.invuln || (o !== e && U.dist2(o.x, o.y, x, y) > (r + o.r) ** 2)) continue;
      list.push(o);
    }
    this.foeEnd();
    for (const o of list) this.hitEnemy(o, o === e ? dmg : dmg * C.SPLASH_MUL, { p, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true, el: 'fire', affDone: true });
  };

  // Chill build-up (aff, chillMul, boss/elite resistance); reaching the threshold freezes. Frozen foes gain none.
  W.addChill = function (e, amount, p) {
    if (!(amount > 0) || e.hp <= 0 || e.frozen > 0 || e.def.invuln || e.burrowed) return;
    const st = p ? p.stats : NO_STATS;
    e.chill += amount * (1 + (st.chillMul || 0)) * this.elemAff('ice') * rankOf(e);
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

  // A Smite of stored amount amt on e by o: holy damage, then the owner's duo effects and shields for heroes within HOLY_R of the smitten foe (HOLY_GRANT_MAX per grant, once per HOLY_CD per hero). Sunstrike (the Cleric hook CLS.cleric.sunstrike says whether this Smite is one): x sunstrike damage, double shield.
  W.smite = function (e, o, amt) {
    const st = o.stats, C = ED.CONST, corroded = e.venom >= 100, big = e.elite || e.boss, sun = st.sunstrike > 0 && CLS.cleric.sunstrike.call(this, e, o);
    const dmg = amt * (1 + st.smiteMul + (big ? st.smiteBig : 0)) * (st.purge && corroded ? 1.5 : 1) * (sun ? st.sunstrike : 1);
    const x = e.x, y = e.y, pre = dmg / this.elemAff('holy'); // pre: the Smite before the holy affinity, the base of its duo statuses (each status applies its own element's affinity)
    this.hitEnemy(e, dmg, { p: o, kind: 'smite', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', affDone: true });
    let n = 0;
    const g = Math.min(C.HOLY_GRANT_MAX, st.smiteShield * (big ? 2 : 1) * (sun ? 2 : 1) * (st.purge && corroded ? 2 : 1));
    for (const q of this.players.values()) {
      if (q.downed || q.dead || q.holyT > 0 || U.dist2(q.x, q.y, x, y) > C.HOLY_R * C.HOLY_R) continue;
      this.addShield(q, q.maxHp * g, q.maxHp * st.holyCap, 'holy');
      q.holyT = C.HOLY_CD; n++;
      if (st.guardLight) { q.glV = q.glT > 0 ? Math.max(q.glV, st.guardLight) : st.guardLight; q.glT = C.GL_T; } // Guardian Light: the heroes this Smite shields deal more for GL_T
    }
    this.emit({ t: 'smite', x: Math.round(x), y: Math.round(y), pid: o.pid, n });
    if (e.boss && CLS[o.cls] && CLS[o.cls].smote) CLS[o.cls].smote.call(this, e, o);
    if (st.beacon || st.sunfire || st.hoarlight) {
      const q = this.foeScan(x, y, 70);
      for (let k = 0; k < q.length || this.foeTail(q); k++) {
        const f = q[k];
        if (f === e || f.hp <= 0 || f.spawnT > 0 || f.def.invuln || f.burrowed) continue;
        const d2 = U.dist2(f.x, f.y, x, y);
        if (st.beacon && d2 <= (70 + f.r) ** 2) this.hitEnemy(f, dmg * st.beacon, { p: o, kind: 'smite', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', affDone: true });
        if (f.hp <= 0) continue;
        if (st.sunfire && d2 <= (60 + f.r) ** 2) this.addBurn(f, pre * 0.6, o);
        if (st.hoarlight && d2 <= (70 + f.r) ** 2) this.addChill(f, hpFrac(f, pre) * C.CHILL_K, o);
      }
      this.foeEnd();
    }
    if (e.hp > 0) {
      if (st.smiteJudge) e.judged = Math.max(e.judged, st.smiteJudge); // Judging Light
      if (st.sunfire) this.addBurn(e, pre * 0.6, o);
      if (st.hoarlight) this.addChill(e, hpFrac(e, pre) * C.CHILL_K, o);
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

  // The health at or below which a foe is Reaped: its Doom (x2 frozen with Black Ice) + Burn still to come (Black Flame) + Venom (Necrosis), all x2 on a Quarry. Duo flags are the Doom owner's.
  W.doomLine = function (e) {
    if (!(e.doom > 0)) return 0;
    const st = e.doomOwner ? e.doomOwner.stats : NO_STATS;
    let line = e.doom * (st.blackice && e.frozen > 0 ? 2 : 1);
    if (st.blackflame) line += e.burnPool * (1 + st.burnMul);
    if (st.necrosis) line += e.maxHp * 0.1 * e.venom / 100;
    return e.quarryT > 0 ? line * 2 : line;
  };

  // Reap: a non-boss foe whose health (plus ward) fell to its Doom line (x mul: Umbral Step's 2) dies to the Doom owner. Returns whether it was Reaped.
  W.checkReap = function (e, mul) {
    if (!(e.doom > 0) || e.boss || e.hp <= 0 || e.killed || e.spawnT > 0 || e.def.invuln || e.burrowed || e.invulnT > 0) return false;
    const o = e.doomOwner;
    if (!o || e.hp + (e.affixOff ? 0 : e.ward) > this.doomLine(e) * (mul || 1)) return false;
    const own = this.openChain(), left = e.hp;
    o.dealt += left;
    this.emit({ t: 'hit', x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(left), c: 0, k: 0, pid: o.pid, el: 7 });
    this.emit({ t: 'reap', x: Math.round(e.x), y: Math.round(e.y), pid: o.pid });
    this.killEnemy(e, o, { kind: 'reap' });
    if (own) this.curChain = null;
    return true;
  };

  // Toll: a boss whose Doom reached TOLL_AT of its HP takes all of it as damage. While it cannot take damage the Doom is kept (retried on each status tick).
  W.checkToll = function (e) {
    const o = e.doomOwner;
    if (!o || !e.boss || e.hp <= 0 || e.doom < ED.CONST.TOLL_AT * e.maxHp || e.invulnT > 0 || e.burrowed || e.def.invuln) return;
    const d = e.doom * (1 + o.stats.tollMul);
    e.doom = 0;
    const own = this.openChain();
    this.hitEnemy(e, d, { p: o, kind: 'toll', raw: true, noProc: true, crit: false, noGuard: true, el: 'shadow', affDone: true });
    this.emit({ t: 'toll', x: Math.round(e.x), y: Math.round(e.y), pid: o.pid });
    this.onDoomPayoff(o);
    const th = CLS[o.cls];
    if (th && th.toll) th.toll.call(this, o, e, d); // class hook: a Toll of d damage landed on boss e
    if (own) this.curChain = null;
  };

  // Death Knell and Death's Edge: each Reap (deathPayoffs skips fodder) or Toll.
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
    if (src.charge > 0) { got = Math.min(f * src.charge, cap); if (got > 0) { dst.charge += got; dst.chargeOwner = src.chargeOwner; dst.dischargeT = dst.chargeOwner && dst.chargeOwner.stats.capacitor > 0 ? Infinity : Math.min(dst.dischargeT > 0 ? dst.dischargeT : 1, 1); if (live) src.charge -= got; } }
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
    const cur = p.critStacks | 0;
    p.critStacks = mode === 'add' ? Math.max(cur, Math.min(capK, cur + nK)) : Math.max(cur, Math.min(capK, nK));
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
  // reapchainHit / flashHit mark the foes a Reaper's Chain hand-off or a Flash Freeze already reached; firestormHit the foes a Firestorm splash already set alight.
  const PAID = { thermal: 1, firedamp: 2, reaper: 4, wrath: 16, sc: 32, twilight: 64, twilightHit: 128, spread: 256, verdict: 1 << 12, beam: 1 << 13,
    detonate: 1 << 14, reapchain: 1 << 15, reapchainHit: 1 << 16, firestorm: 1 << 17, flash: 1 << 18, flashHit: 1 << 19, pillar: 1 << 20, firestormHit: 1 << 21 };
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
    const q = this.foeScan(x, y, r);
    for (let k = 0; k < q.length; k++) {
      const o = q[k];
      if (o === skip || o.hp <= 0 || o.spawnT > 0 || U.dist2(o.x, o.y, x, y) > (r + o.r) ** 2) continue;
      const got = this.hitEnemy(o, dmg, { p: tr, kind, raw: true, noProc: true, crit: false, noGuard: true, el, x, y, affDone: !!affDone });
      if (onHit && got > 0 && o.hp > 0) onHit(o, got);
    }
    this.foeEnd();
    this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r, k: boom });
  };

  W.runPayoff = function (en) {
    const tr = en.tr, st = tr ? tr.stats : NO_STATS, C = ED.CONST, e = en.e;
    switch (en.kind) {
      case 'thermal': // 60% of a Thermal Shock detonation bursts to foes within 70 and chills them
        this.payBlast(tr, en.x, en.y, 70, en.amt * C.SPLASH_MUL, 'fire', 'fire', (o, got) => this.addChill(o, hpFrac(o, got / this.elemAff('fire')) * C.CHILL_K, tr), true, e, 'thermal');
        break;
      case 'firedamp': { // the blast's survivors catch Burn (50%) and Venom, built from the damage before the fire affinity
        const pre = 1 / this.elemAff('fire');
        this.payBlast(tr, en.x, en.y, 80, en.amt, 'fire', 'firedamp', (o, got) => { this.addBurn(o, got * pre * 0.5, tr); this.addVenom(o, hpFrac(o, got * pre) * C.VENOM_K * 0.5, tr); }, false, null, 'firedamp');
        break;
      }
      case 'reaper': // the implosion: Singularity pulls the foes within 120 in first; Grim Harvest marks the blast as Doom instead of damage
        if (st.singularity) this.pullFoes(en.x, en.y, 120, 120, e);
        if (st.grimHarvest) {
          const q = this.foeScan(en.x, en.y, 80), list = [];
          for (let k = 0; k < q.length; k++) { const o = q[k]; if (o !== e && o.hp > 0 && o.spawnT <= 0 && !o.def.invuln && !o.burrowed && U.dist2(o.x, o.y, en.x, en.y) <= (80 + o.r) ** 2) list.push(o); }
          this.foeEnd();
          for (const o of list) this.addDoom(o, Math.min(en.amt, C.SPREAD_CAP * o.maxHp) / (this.elemAff('shadow') * (o.elite || o.boss ? C.DOOM_TOUGH + st.doomTough : 1) * (1 + st.doomMul)), tr);
          this.emit({ t: 'boom', x: Math.round(en.x), y: Math.round(en.y), r: 80, k: 'shadow' });
        } else this.payBlast(tr, en.x, en.y, 80, en.amt, 'shadow', 'shadow', null, false, null, 'reaper');
        break;
      case 'wrath': // thunderbolt: 60% of the Smite as Lightning; the smitten foe is charged with 30% of the Smite before the holy affinity
        this.emit({ t: 'chain', k: 'h', pts: [[Math.round(en.x), Math.round(en.y) - 90], [Math.round(en.x), Math.round(en.y)]] });
        this.payBlast(tr, en.x, en.y, 70, en.amt * 0.6, 'lightning', 'bolt', null, false, null, 'wrath');
        if (e && e.hp > 0) this.addCharge(e, en.amt / this.elemAff('holy') * 0.3, tr);
        break;
      case 'detonate': // Capacitor: a charged foe of the trigger hero discharges its whole charge at en.mul
        if (e.hp <= 0 || !(e.charge > 0) || e.chargeOwner !== tr) break;
        this.emit({ t: 'detonate', pid: tr.pid, x: Math.round(e.x), y: Math.round(e.y) });
        this.discharge(e, tr, en.mul, true);
        break;
      case 'reapchain': { // Reaper's Chain: en.amt Doom passes to the nearest foe within 120 the chain has not reached (at most SPREAD_CAP of its HP), which may be Reaped in turn
        const o = this.nearestUnpaid(en.x, en.y, 120, en.cid, PAID.reapchainHit, e);
        if (!o) break;
        firstPay(o, en.cid, 'reapchainHit');
        this.emit({ t: 'reapchain', x: Math.round(en.x), y: Math.round(en.y), x2: Math.round(o.x), y2: Math.round(o.y) });
        o.doom += Math.min(en.amt, C.SPREAD_CAP * o.maxHp); o.doomOwner = tr;
        if (o.boss) this.checkToll(o); else this.checkReap(o);
        break;
      }
      case 'firestorm': { // Firestorm: the combustion's neighbours catch en.amt as Burn (each foe once per chain)
        const q = this.foeScan(en.x, en.y, 70), list = [];
        for (let k = 0; k < q.length; k++) { const o = q[k]; if (o !== e && o.hp > 0 && o.spawnT <= 0 && !(o.cid === en.cid && (o.cidMask & PAID.firestormHit)) && U.dist2(o.x, o.y, en.x, en.y) <= (70 + o.r) ** 2) list.push(o); }
        this.foeEnd();
        for (const o of list) { firstPay(o, en.cid, 'firestormHit'); this.addBurn(o, Math.min(en.amt, C.SPREAD_CAP * o.maxHp) / this.elemAff('fire'), tr); }
        break;
      }
      case 'flash': // Flash Freeze: the 2 nearest non-elite, non-boss foes within 100 the chain has not reached freeze (and flash in turn)
        for (let i = 0; i < 2; i++) {
          const o = this.nearestUnpaid(en.x, en.y, 100, en.cid, PAID.flashHit, e, (f) => !f.elite && !f.boss && f.frozen <= 0);
          if (!o) break;
          firstPay(o, en.cid, 'flashHit');
          this.freezeEnemy(o, tr);
        }
        break;
      case 'pillar': this.pillarBurst(tr, en); break;
      case 'sc': // Short Circuit: the dead foe's charge discharges at once
        e.charge = en.ch;
        this.discharge(e, tr, 1 + st.shortCircuit);
        break;
      case 'spread': { // a share en.f of the dead foe e's statuses passes to each of the en.n nearest foes within en.r (Ruin Spreads, Contagion, Bloodbloom); a foe receives at most once per chain id
        const near = [], q = this.foeScan(en.x, en.y, en.r || 80);
        for (let k = 0; k < q.length; k++) {
          const o = q[k];
          if (o === e || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || (o.cid === en.cid && (o.cidMask & PAID.spread))) continue;
          const d2 = U.dist2(o.x, o.y, en.x, en.y);
          if (d2 < ((en.r || 80) + o.r) ** 2) near.push({ d2, o });
        }
        this.foeEnd();
        near.sort((a, b) => a.d2 - b.d2);
        for (let i = 0; i < (en.n || 2) && i < near.length; i++) { firstPay(near[i].o, en.cid, 'spread'); this.moveStatuses(e, near[i].o, en.f); }
        if (en.fx) for (let i = 0; i < (en.n || 2) && i < near.length; i++) this.emit({ t: 'chain', k: en.fx, pts: [[Math.round(en.x), Math.round(en.y)], [Math.round(near[i].o.x), Math.round(near[i].o.y)]] }); // en.fx: the thread's look (Contagion 'c')
        break;
      }
      case 'twilight': { // each Reap forces a Smite on the nearest foe within 120 this chain has not touched, joined by a black-gold beam
        let best = null, bd = 120 * 120;
        const q = this.foeScan(en.x, en.y, 120);
        for (let k = 0; k < q.length; k++) {
          const o = q[k];
          if (o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || o.invulnT > 0 || (o.cid === en.cid && (o.cidMask & PAID.twilightHit))) continue;
          const d2 = U.dist2(o.x, o.y, en.x, en.y);
          if (d2 < bd) { bd = d2; best = o; }
        }
        this.foeEnd();
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

  // The live foe nearest (x, y) within r that chain cid has not marked with bit (and passes ok), other than skip.
  W.nearestUnpaid = function (x, y, r, cid, bit, skip, ok) {
    let best = null, bd = r * r;
    const q = this.foeScan(x, y, r);
    for (let k = 0; k < q.length; k++) {
      const o = q[k];
      if (o === skip || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || o.invulnT > 0 || (o.cid === cid && (o.cidMask & bit)) || (ok && !ok(o))) continue;
      const d2 = U.dist2(o.x, o.y, x, y);
      if (d2 < bd) { bd = d2; best = o; }
    }
    this.foeEnd();
    return best;
  };

  // Drags the foes within r of (x, y) (not bosses, elites half, not skip) up to max px toward it, as knockback (speed v decays 9 per second: it travels v / 9 px).
  W.pullFoes = function (x, y, r, max, skip) {
    const q = this.foeScan(x, y, r);
    for (let k = 0; k < q.length; k++) {
      const o = q[k];
      if (o === skip || o.hp <= 0 || o.boss || o.spawnT > 0 || o.def.invuln || o.burrowed) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d >= r + o.r || d < 1) continue;
      const v = 9 * Math.min(max, Math.max(0, d - o.r - 8)) * (o.elite ? 0.5 : 1);
      o.kbx -= (o.x - x) / d * v; o.kby -= (o.y - y) / d * v;
    }
    this.foeEnd();
  };

  // Skill-cast rules of the element paths (called by W.onSkillCast after any skill of hero p resolves, slot 0 or 1). Storm Anchor (and Lightning Lattice) plants an anchor where p stands (at most ANCHOR_MAX, the oldest goes).
  // Capacitor detonates every foe p charged at CAP_MUL (+capMul) through the chain queue, nearest first (CHAIN_TICK a tick); a Bellwarden Peal detonates at the larger of that and the Peal's Resonance (p.pealResLast), never their product.
  W.elementCast = function (p, slot) {
    const st = p.stats, C = ED.CONST;
    if (st.anchor) {
      this.capZones('anchor', p.pid, C.ANCHOR_MAX - 1);
      this.addZone({ kind: 'anchor', x: p.x, y: p.y, r: C.ANCHOR_REACH, sr: C.ANCHOR_R, dur: C.ANCHOR_T, owner: p.pid, team: 0, custom: true, solid: true, zapT: C.ANCHOR_ZAP, update: anchorZap });
    }
    if (st.capacitor) {
      const cl = ED.CLASSES[p.cls], sk = slot === 1 ? cl.skill2 : cl.skill;
      let mul = C.CAP_MUL + st.capMul;
      if (sk === 'peal') mul = Math.max(mul, p.pealResLast || 1);
      const list = [];
      for (const e of this.enemies) if (e.hp > 0 && e.charge > 0 && e.chargeOwner === p) list.push({ e, d2: U.dist2(e.x, e.y, p.x, p.y) });
      if (!list.length) return;
      list.sort((a, b) => a.d2 - b.d2);
      const own = this.openChain();
      for (const it of list) this.queuePayoff(p, { kind: 'detonate', e: it.e, x: it.e.x, y: it.e.y, mul });
      if (own) this.curChain = null;
    }
  };
  // A Storm Anchor zaps the nearest foe within its radius every ANCHOR_ZAP for the Storm Anchor proc damage as Lightning (it infuses: a charging hit).
  function anchorZap(w, z, dt) {
    if ((z.zapT -= dt) > 0) return;
    z.zapT += ED.CONST.ANCHOR_ZAP;
    const p = w.players.get(z.owner);
    if (!p) return;
    const e = w.nearestEnemy(z.x, z.y, z.r);
    if (!e) return;
    w.emit({ t: 'chain', pts: [[Math.round(z.x), Math.round(z.y) - 12], [Math.round(e.x), Math.round(e.y)]] });
    w.hitEnemy(e, ED.procDmg(ED.BOONS.stormanchor, p.stats), { p, kind: 'explode', el: 'lightning', crit: false, noGuard: true, x: z.x, y: z.y });
  }

  W.freezeEnemy = function (e, p) {
    const st = p ? p.stats : NO_STATS;
    e.frozen = e.boss ? 0.6 : 1.6 * (1 + (st.freezeDur || 0)) * (e.elite ? 0.75 : 1);
    e.chill = 0; e.chillT = 0;
    if (e.freezeRes <= 0) e.freezeResT = 6;
    e.freezeRes++;
    e.glacier = !!st.glacier; e.thawBy = p || null; // Glacier: the frozen foe is solid (world.js separate); thawBy: whose Lingering Rime refills it on thaw
    this.emit({ t: 'freeze', x: Math.round(e.x), y: Math.round(e.y) });
    if (st.thermal && e.burnPool > 0) { // Thermal Shock: the Burn pool x2 hits the foe now; 60% of that bursts to its neighbours (queued) and chills them
      const own = this.openChain(), dmg = e.burnPool * 2 * (1 + st.burnMul);
      e.burnPool = 0; e.burn = 0;
      const got = this.hitEnemy(e, dmg, { p, kind: 'thermal', raw: true, noProc: true, crit: false, noGuard: true, el: 'fire', affDone: true });
      if (got > 0) this.queuePayoff(p, { kind: 'thermal', e, x: e.x, y: e.y, amt: got });
      if (own) this.curChain = null;
    }
    if (st.frostNova && p) { // Absolute Zero: a frost nova (Rime Lattice: an ice pillar instead; Flash Freeze: the nova freezes the 2 nearest foes, through the chain)
      if (st.iceLattice) this.addPillar(p, e.x + e.r + ED.CONST.PILLAR_R, e.y, e, ED.CONST.PILLAR_T * 0.75);
      else if (st.flashFreeze) { const own = this.openChain(); this.queuePayoff(p, { kind: 'flash', e, x: e.x, y: e.y }); if (own) this.curChain = null; }
      else {
        const q = this.foeScan(e.x, e.y, 100);
        for (let k = 0; k < q.length; k++) {
          const o = q[k];
          if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, e.x, e.y) < (100 + o.r) ** 2) this.addChill(o, 60, p);
        }
        this.foeEnd();
      }
      if (!st.iceLattice) this.emit({ t: 'nova', x: e.x, y: e.y, r: 100, c: '#7fe3ff' });
    }
  };

  // Shatter: the skill hit ends the freeze; an ice burst of its full damage strikes foes within 90 (infused: it chills; it never shatters again).
  W.shatterBurst = function (e, p, dmg) {
    e.frozen = 0; e.glacier = false;
    const r = 90;
    this.emit({ t: 'shatter', x: Math.round(e.x), y: Math.round(e.y), r });
    const q = this.foeScan(e.x, e.y, r), list = [];
    for (let k = 0; k < q.length; k++) {
      const o = q[k];
      if (o === e || o.hp <= 0 || o.spawnT > 0 || U.dist2(o.x, o.y, e.x, e.y) > (r + o.r) ** 2) continue;
      list.push(o);
    }
    this.foeEnd();
    for (const o of list) this.hitEnemy(o, dmg, { p, kind: 'explode', raw: true, crit: false, noShatter: true, noGuard: true, el: 'ice', x: e.x, y: e.y });
  };

  // Charge build-up (Supercapacitor: chargeSlow less); the first charge arms the discharge timer (1 s). A Capacitor hero's charge has no timer: it waits for a skill cast (W.elementCast). The last hero to add owns the pool.
  W.addCharge = function (e, amount, p) {
    if (!(amount > 0) || e.hp <= 0 || e.def.invuln || e.burrowed) return;
    const add = amount * this.elemAff('lightning') * (p ? 1 - p.stats.chargeSlow : 1);
    e.dischargeT = p && p.stats.capacitor > 0 ? Infinity : e.charge > 0 && e.dischargeT < Infinity ? Math.min(e.dischargeT, 1) : 1;
    e.charge += add;
    if (p) e.chargeOwner = p;
  };

  // Releases e's charge onto itself and its nearest foes at mul (det: a Capacitor detonation). Emits chain pts as a star (hub, target, hub, target ...).
  // Conduction: +conduct per other foe within 60 of e (up to 5). Storm Anchors of p within ANCHOR_ARC (Lightning Lattice: every anchor, on a detonation) take an arc and burst around themselves.
  // Duo effects (the discharging hero's flags) read the damage each target took before the Lightning affinity.
  W.discharge = function (e, p, mul, det) {
    const ch = e.charge;
    if (!(ch > 0)) return;
    const own = this.openChain(), C = ED.CONST;
    e.charge = 0; e.dischargeT = 0;
    const st = p ? p.stats : NO_STATS;
    const range = 140 * (1 + (st.arcRange || 0));
    const near = [], q = this.foeScan(e.x, e.y, range);
    let close = 0;
    for (let k = 0; k < q.length; k++) {
      const o = q[k];
      if (o === e || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed) continue;
      const d2 = U.dist2(o.x, o.y, e.x, e.y);
      if (d2 < (range + o.r) ** 2) near.push({ d2, o });
      if (d2 < (60 + o.r) ** 2) close++;
    }
    this.foeEnd();
    near.sort((a, b) => a.d2 - b.d2);
    const dmg = ch * (1 + (st.shockMul || 0)) * (mul || 1) * (1 + (st.conduct || 0) * Math.min(5, close));
    const n = 3 + (st.arcs || 0);
    const tg = [e];
    for (let i = 0; i < n && i < near.length; i++) tg.push(near[i].o);
    const hx = Math.round(e.x), hy = Math.round(e.y), pts = [[hx, hy]];
    for (let i = 1; i < tg.length; i++) pts.push([Math.round(tg[i].x), Math.round(tg[i].y)], [hx, hy]);
    const ev = { t: 'chain', pts };
    if (tg.length > 1) { pts.pop(); this.emit(ev); } else { ev.pts = [[hx, hy], [hx, hy - 24]]; this.emit(ev); }
    const pre = 1 / this.elemAff('lightning');
    for (const t of tg) {
      if (t.hp <= 0) continue;
      const got = this.hitEnemy(t, t === e ? dmg : dmg * C.ARC_MUL, { p, kind: 'chain', raw: true, noProc: true, crit: false, el: 'lightning', affDone: true, x: e.x, y: e.y });
      if (t.hp <= 0 || !p) continue;
      if (st.supercond) this.addChill(t, hpFrac(t, got * pre) * C.CHILL_K, p);
      if (st.galvanic) this.addVenom(t, hpFrac(t, got * pre) * C.VENOM_K, p);
      if (st.blackLight) this.addDoom(t, got * pre * 0.5, p);
      if (st.plasma) this.addBurn(t, got * pre * 0.4, p);
      if (t.hp > 0 && st.arcStun) this.stunFoe(t, st.arcStun, true);
    }
    if (p && st.anchor) for (const z of this.zones) {
      if (z.kind !== 'anchor' || z.owner !== p.pid || z.dead || !(det && st.capArc) && U.dist2(z.x, z.y, e.x, e.y) > C.ANCHOR_ARC * C.ANCHOR_ARC) continue;
      this.emit({ t: 'chain', pts: [[hx, hy], [Math.round(z.x), Math.round(z.y)]] });
      this.payBlast(p, z.x, z.y, C.ANCHOR_BURST, dmg * C.ARC_MUL, 'lightning', 'bolt', null, true, null, 'chain');
    }
    if (own) this.curChain = null;
  };

  // Chain pulse of the Venom pool: a Corroded foe (Virulence: above 50 Venom) gives its Pandemic owner's share of Venom to the 2 nearest foes within 90 that hold less (Miasma: every such foe, half the share; moved Venom; the receivers inherit venomBy and corrode).
  W.pandemic = function (e, o) {
    const near = [], q = this.foeScan(e.x, e.y, 90), st = o.stats;
    for (let k = 0; k < q.length; k++) {
      const x = q[k];
      if (x === e || x.hp <= 0 || x.spawnT > 0 || x.def.invuln || x.burrowed || x.venom >= e.venom) continue;
      const d2 = U.dist2(x.x, x.y, e.x, e.y);
      if (d2 < (90 + x.r) ** 2) near.push({ d2, x });
    }
    this.foeEnd();
    near.sort((a, b) => a.d2 - b.d2);
    const n = st.miasma ? near.length : 2, f = st.pandemic * (st.miasma ? 0.5 : 1);
    for (let i = 0; i < n && i < near.length; i++) {
      const x = near[i].x;
      this.addVenom(x, e.venom * f, o, true);
      x.venomBy |= e.venomBy;
      if (e.corrode > x.corrode) x.corrode = e.corrode;
    }
  };

  // Per-tick status upkeep: burn/bleed pools (Brushfire spreads on the burn tick), discharge timer, chill decay, freeze resistance and thaw (Lingering Rime), Venom decay (Pandemic, Hex the Strong, Neurotoxin),
  // Venomous Arms doses, Quarry, slows and debuff timers.
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
          if (e.hp > 0 && e.burnPool > 0 && o && o.stats.brushfire) this.brushSpread(e, o);
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
    if (e.doses) this.tickDoses(e, dt);
    if (e.hp <= 0) return;
    const vo = e.venomOwner, vs = vo ? vo.stats : NO_STATS;
    if (e.venom > 0) { // Venom holds venomT seconds after the last gain, then fades (Lingering Venom: venomSlow slower); a Corroded foe (Virulence: above 50) spreads it with Pandemic
      if (e.venomT > 0) e.venomT -= dt; else e.venom = Math.max(0, e.venom - ED.CONST.VENOM_DECAY * (1 - (vs.venomSlow || 0)) * dt);
      if (e.venom <= 0) { e.venomBy = 0; e.corrode = 0; }
      else if (e.venom >= (vs.virulence ? 50 : 100) && vs.pandemic && (e.plagueT -= dt) <= 0) { e.plagueT += 1; this.pandemic(e, vo); }
    }
    if (e.elite && (e.affixOff ? e.venom < 50 : e.venom >= 100 && vs.hexStrong)) this.hexAffixes(e, !e.affixOff); // Hex the Strong: affixes off at full Venom, back below 50
    if (e.boss && e.doom > 0) this.checkToll(e); // a Toll that had to wait for the boss to be vulnerable
    if (e.stunCd > 0) e.stunCd -= dt;
    if (e.blindCd > 0) e.blindCd -= dt;
    if (e.staggerT > 0) e.staggerT -= dt;
    if (e.shieldStunT > 0) e.shieldStunT -= dt;
    if (e.sealT > 0) e.sealT -= dt;
    if (e.weakT > 0) e.weakT -= dt;
    if (e.quarryT > 0) e.quarryT -= dt;
    if (e.tetherT > 0) e.tetherT -= dt;
    if (e.snareT > 0) e.snareT -= dt;
    if (e.hexT > 0 && (e.hexT -= dt) <= 0) e.hexBy = 0;
    if (e.chill > 0) {
      if (e.chillT > 0) e.chillT -= dt;
      else e.chill = Math.max(0, e.chill - 25 * dt);
    }
    if (e.freezeRes > 0) {
      e.freezeResT -= dt;
      if (e.freezeResT <= 0) { e.freezeRes--; e.freezeResT = 6; }
    }
    if (e.frozen > 0 && (e.frozen -= dt) <= 0) { // thaw: no longer solid; Lingering Rime refills the gauge
      e.glacier = false;
      const tb = e.thawBy;
      if (tb && tb.stats.refreeze > 0) { e.chill = Math.max(e.chill, 100 * tb.stats.refreeze); e.chillT = 1.5; e.chillOwner = tb; }
    }
    if (e.stun > 0) e.stun -= dt;
    if (e.judged > 0) e.judged -= dt;
    if (e.vulnT > 0) e.vulnT -= dt;
    if (e.blind > 0) e.blind -= dt;
    let slow = 1 - Math.min(0.45, e.chill / 180), wind = 1 + e.chill / 220;
    if (e.slowT > 0) { e.slowT -= dt; slow *= 1 - e.slowAmt; } else e.slowAmt = 0;
    if (vs.neuro && e.venom >= 100) { const k = e.boss ? 0.5 : 1; slow *= 1 - 0.25 * k; wind *= 1 + 0.4 * k; } // Neurotoxin
    e.slow = slow; e.windMul = wind;
  };

  // Hex the Strong: an elite's affixes go off (on true) or come back. Swift's speed and Brutal's damage are baked at makeElite, so they are divided out and back; ED.hasAffix reads e.affixOff for the rest (ward: hitEnemy).
  W.hexAffixes = function (e, off) {
    if (!!e.affixOff === off) return;
    const has = (id) => e.elite === id || e.elite2 === id, f = off ? 1 / 1.4 : 1.4;
    if (has('swift')) e.spd *= f;
    if (has('brutal')) { e.dmg *= f; if (e.dmgBase) e.dmgBase *= f; }
    e.affixOff = off;
  };

  // Brushfire: each foe touching e (within BRUSH_R of its edge) that burns less catches brushfire x e's pool as Burn (moved Burn, no affinity again; at most SPREAD_CAP of its HP and never above e's pool).
  W.brushSpread = function (e, o) {
    const C = ED.CONST, q = this.foeScan(e.x, e.y, e.r + 22 + C.BRUSH_R), f = o.stats.brushfire, give = [];
    for (let k = 0; k < q.length; k++) {
      const x = q[k];
      if (x === e || x.hp <= 0 || x.spawnT > 0 || x.def.invuln || x.burrowed || x.burnPool >= e.burnPool || U.dist2(x.x, x.y, e.x, e.y) > (e.r + x.r + C.BRUSH_R) ** 2) continue;
      give.push(x);
    }
    this.foeEnd();
    for (const x of give) {
      const got = Math.min(f * e.burnPool, C.SPREAD_CAP * x.maxHp, e.burnPool - x.burnPool);
      if (!(got > 0)) continue;
      if (!(x.burnPool > 0)) x.burnTick = 0.5;
      x.burnPool += got; x.burn = 1; x.burnOwner = o;
    }
  };

  // Venomous Arms doses on e: [{ at (world time it bursts), p }]; Catalyst bursts a dose at once at full Venom.
  W.tickDoses = function (e, dt) {
    const ds = e.doses;
    for (let i = 0; i < ds.length;) {
      const d = ds[i];
      if (this.time >= d.at || (d.p.stats.doseCat && e.venom >= 100)) { ds.splice(i, 1); this.doseBurst(e, d.p); if (e.hp <= 0) return; } else i++;
    }
    if (!ds.length) e.doses = null;
  };

  // A dose bursts: Poison on e and foes within DOSE_R for DOSE_HP of e's HP before the stratum lever x its Venom share (elites half, bosses a quarter; Incubation x2); an explosion (no procs, no guard).
  W.doseBurst = function (e, p) {
    const C = ED.CONST, st = p.stats, amt = e.maxHp / e.hpLever * C.DOSE_HP * e.venom / 100 * (e.boss ? 0.25 : e.elite ? 0.5 : 1) * (st.doseLong ? 2 : 1);
    if (!(amt > 0)) return;
    this.payBlast(p, e.x, e.y, C.DOSE_R, amt, 'poison', 'acid', null, false, null, 'explode');
  };

  W.killEnemy = function (e, p, src) {
    if (e.killed) return;
    e.killed = true; e.hp = 0;
    src = src || {};
    const def = e.def, s = this.stratum;
    this.run.kills++;
    if (def.fodder) this.run.fodderKills++;
    if (p) p.kills++;
    this.emit(def.fodder ? { t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: 0, r: e.r, fd: 1 } : { t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: e.elite ? 1 : 0, r: e.r });
    this.onEnemyKilledSkill(e, p, src);
    if (def.boss) { this.onBossKilled(e, p, src); return; }
    this.deathPayoffs(e, p, src);
    if (def.fodder) { this.fodderMote(e.x, e.y); return; } // fodder drop no gold, heart or Grail growth, split or leave a cloud: only the room's xp mote
    this.dropFoeXp(e);
    if (this.rng.chance(e.elite ? 1 : 0.12)) this.dropGold(e.x, e.y, (1 + Math.floor((s - 1) / 2)) * (e.elite ? 3 : this.rng.int(1, 2)));
    if (this.rng.chance(e.elite ? 0.4 : ED.World.HEART_KILL)) this.spawnPickup('heart', e.x, e.y, 1);
    if (e.elite) {
      this.run.elitesKilled++; this.run.embers.elites += 2 + Math.floor(s / 2);
      if (ED.hasAffix(e, 'volatile')) this.addZone({ kind: 'tele', x: e.x, y: e.y, r: 70, dur: 0.7, team: 1, dmg: e.dmg * 1.2, boom: 'fire' });
    }
    if (def.split) for (let i = 0; i < def.split.n; i++) {
      const c = this.spawnEnemy(def.split.into, e.x + this.rng.range(-8, 8), e.y + this.rng.range(-8, 8));
      c.kbx = this.rng.range(-160, 160); c.kby = this.rng.range(-160, 160); c.cd = 0.6;
    }
    if (def.deathCloud) this.addZone({ kind: 'poison', x: e.x, y: e.y, r: def.deathCloud.r, dur: def.deathCloud.dur, dps: def.deathCloud.dps * (1 + 0.2 * (s - 1)), team: 1 });
    if (p && src.kind !== 'minionBurst') {
      const st = p.stats;
      if (st.chalice && p.chaliceHp < ED.RELICS.chalice.full.hp) { // Grail of Ages: +1 max health per RELICS.chalice.kills kills (growth does not heal)
        p.chaliceKills++;
        if (p.chaliceKills % ED.RELICS.chalice.kills === 0) { p.chaliceHp++; const hp = p.hp; this.recalc(p, false); p.hp = hp; if (p.chaliceHp % 5 === 0) this.sendBuild(p); }
      }
    }
  };

  // Payoffs of a foe's death, each spent from the pool of its owner: a Reap's keystone and path effects (the Doom owner: Reaper, Twilight, Reaper's Chain, Umbral Arms), Wildfire, Firedamp and Firebreak (Burn owner),
  // a Glacial Arms pillar (a frozen foe: the killer's or its freezer's evolution), Spore Burst (Venom owner), Short Circuit (charge owner).
  W.deathPayoffs = function (e, p, src) {
    const own = this.openChain(), x = e.x, y = e.y, half = e.elite ? 0.5 : 1, C = ED.CONST;
    if (src.kind === 'reap' && p) {
      const rs = p.stats;
      if (!e.fodder) this.onDoomPayoff(p); // Death Knell and Death's Edge stacks never come from fodder; the chains below still fire
      if (rs.reaper) this.queuePayoff(p, { kind: 'reaper', e, x, y, amt: e.maxHp * rs.reaper * half });
      if (rs.twilight) this.queuePayoff(p, { kind: 'twilight', e, x, y });
      if (rs.reapChain && e.doom > 0) this.queuePayoff(p, { kind: 'reapchain', e, x, y, amt: e.doom * rs.reapChain });
      if (rs.evo === 'shadow') this.umbralReap(p, e);
    }
    const bo = e.burnOwner;
    if (bo && e.burnPool > 0) {
      const bs = bo.stats;
      if (bs.wildfire) {
        const q = this.foeScan(x, y, 80);
        for (let k = 0; k < q.length; k++) {
          const o = q[k];
          if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, x, y) < (80 + o.r) ** 2) this.addBurn(o, e.maxHp / e.hpLever * bs.wildfire, bo);
        }
        this.foeEnd();
        this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: 80, k: 'fire' });
      }
      if (bs.firedamp && e.venom > 0) this.queuePayoff(bo, { kind: 'firedamp', e, x, y, amt: e.maxHp * 0.2 * half });
      if (bs.firebreak) this.fireGround(bo, x, y, C.FIREBREAK_R, C.FIREBREAK_T, ED.procDmg(ED.BOONS.firebreak, bs));
    }
    if (e.frozen > 0) { const ip = p && p.stats.evo === 'ice' ? p : e.thawBy && e.thawBy.stats.evo === 'ice' ? e.thawBy : null; if (ip) this.addPillar(ip, x, y, e); }
    const vo = e.venomOwner;
    if (vo && e.venom > 0 && vo.stats.sporeBurst) {
      const q = this.foeScan(x, y, 80);
      for (let k = 0; k < q.length; k++) {
        const o = q[k];
        if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, x, y) < (80 + o.r) ** 2) this.addVenom(o, e.venom * vo.stats.sporeBurst, vo, true);
      }
      this.foeEnd();
      this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: 80, k: 'acid' });
    }
    const co = e.chargeOwner;
    if (co && e.charge > 0 && co.stats.shortCircuit) {
      const ch = e.charge; e.charge = 0;
      this.queuePayoff(co, { kind: 'sc', e, x, y, ch });
    }
    if (own) this.curChain = null;
  };

  // Umbral Arms: a Reap by p of foe e makes the nearest foe within 160 (Shadow Relay: the 2 nearest) p's Quarry and, unless e is fodder, refunds a dash charge (Death Spiral: only a Reap of p's Quarry, every charge).
  // The refund is a { to, t: 'dashRefund', n } message for the hero's own client (dash charges are client-authoritative).
  W.umbralReap = function (p, e) {
    const st = p.stats, C = ED.CONST, wasQ = e.quarryT > 0 && e.quarryBy === p.pid, seen = new Set([e.id]);
    for (let i = 0; i < (st.shadowRelay ? 2 : 1); i++) {
      const o = this.nearestEnemy(e.x, e.y, 160, seen);
      if (!o) break;
      seen.add(o.id); o.quarryT = C.QUARRY_T; o.quarryBy = p.pid;
    }
    if (e.fodder) return;
    if (st.deathSpiral) { if (wasQ) this.msgs.push({ to: p.pid, t: 'dashRefund', n: 3 }); }
    else this.msgs.push({ to: p.pid, t: 'dashRefund', n: 1 });
  };

  // Burning ground of hero p that blocks foe pathing (Firebreak, Scorched Earth): a 'firebreak' zone of dps (Fire, hero multiplier), at most FIREBREAK_MAX per hero (the oldest goes).
  W.fireGround = function (p, x, y, r, dur, dps) {
    this.capZones('firebreak', p.pid, ED.CONST.FIREBREAK_MAX - 1);
    return this.addZone({ kind: 'firebreak', x, y, r, dur, dps, owner: p.pid, team: 0, el: 'fire', block: 1 });
  };

  // Ends the oldest zones of a kind and owner until at most keep remain.
  W.capZones = function (kind, pid, keep) {
    let n = 0;
    for (let i = this.zones.length - 1; i >= 0; i--) { const z = this.zones[i]; if (z.kind === kind && z.owner === pid && !z.dead && ++n > keep) z.dead = true; }
  };

  // Glacial Arms / Rime Lattice: an ice pillar of p at (x, y) for dur (Glacier Wall: twice as long; Frost Mine: not solid, a touching foe shatters it), its burst worth PILLAR_HP of foe src's HP (elites half, bosses a quarter).
  W.addPillar = function (p, x, y, src, dur) {
    const C = ED.CONST, st = p.stats;
    this.capZones('pillar', p.pid, C.PILLAR_MAX - 1);
    const g = { x, y, r: C.PILLAR_R };
    ED.Sim.resolve(g, this.room, this.locked, false);
    return this.addZone({ kind: 'pillar', x: g.x, y: g.y, r: C.PILLAR_R, dur: (dur || C.PILLAR_T) * (st.pillarWall ? 2 : 1), owner: p.pid, team: 0, custom: true, solid: !st.pillarMine,
      amt: src.maxHp * C.PILLAR_HP * (src.boss ? 0.25 : src.elite ? 0.5 : 1), update: st.pillarMine ? pillarMine : undefined });
  };
  // Frost Mine: a foe touching the pillar shatters it.
  function pillarMine(w, z) {
    if (z.dead) return;
    const q = w.foeScan(z.x, z.y, z.r + 4);
    let hit = false;
    for (let k = 0; k < q.length && !hit; k++) { const e = q[k]; if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, z.x, z.y) < (e.r + z.r + 2) ** 2) hit = true; }
    w.foeEnd();
    if (hit) w.shatterPillar(z);
  }

  // A pillar shatters (a skill hit beside it, or a touch with Frost Mine): its burst runs through the chain queue.
  W.shatterPillar = function (z) {
    if (z.dead) return;
    z.dead = true;
    const p = this.players.get(z.owner);
    if (!p) return;
    const own = this.openChain();
    this.queuePayoff(p, { kind: 'pillar', e: null, x: z.x, y: z.y, amt: z.amt });
    if (own) this.curChain = null;
  };

  // The pillar burst: amt as Ice to foes within PILLAR_BURST, chilling them by the damage (Glacier Wall: freezing those that are not elites or bosses).
  W.pillarBurst = function (tr, en) {
    const C = ED.CONST, st = tr.stats, pre = 1 / this.elemAff('ice');
    this.emit({ t: 'shatter', x: Math.round(en.x), y: Math.round(en.y), r: C.PILLAR_BURST });
    this.payBlast(tr, en.x, en.y, C.PILLAR_BURST, en.amt, 'ice', 'ice', (o, got) => {
      if (st.pillarWall && !o.elite && !o.boss) this.freezeEnemy(o, tr); else this.addChill(o, hpFrac(o, got * pre) * C.CHILL_K, tr);
    }, false, null, 'explode');
  };

  // Vigil: true when foe e stands on hero p's consecrated ground.
  W.inVigil = function (p, e) {
    const z = p.vigilZ;
    return !!(z && !z.dead && z.t < z.dur && U.dist2(z.x, z.y, e.x, e.y) < (z.r + e.r) ** 2);
  };
  // The consecrated ground ends when its hero steps off it, is downed or the room changes.
  function vigilZone(w, z) {
    const p = w.players.get(z.owner);
    if (!p || p.downed || p.dead || w.room !== z.room || U.dist2(p.x, p.y, z.x, z.y) > z.r * z.r) z.dur = z.t;
  }

  // Tempest Arms: every TETHER_IV the charged foes of p (chargeOwner p) form one nearest-neighbour chain of up to TETHER_N links, each within TETHER_R, from the charged foe nearest p (Live Wire: from p itself);
  // a foe whose body crosses a link takes TETHER_MUL of the weapon as Lightning, infused (once per TETHER_CD per foe; Snare Line: a repeating 0.4 s stun once per 2 s instead). One 'tether' event carries the polyline.
  W.tethers = function (p) {
    const C = ED.CONST, st = p.stats, es = this.enemies, R2 = C.TETHER_R * C.TETHER_R, ch = [];
    for (let i = 0; i < es.length; i++) { const e = es[i]; if (e.hp > 0 && e.charge > 0 && e.chargeOwner === p && e.spawnT <= 0) ch.push(e); }
    if (!ch.length) return;
    const used = new Set(), pts = [];
    let cx = p.x, cy = p.y, linked = false;
    if (!st.liveWire) { let b = null, bd = Infinity; for (const e of ch) { const d2 = U.dist2(e.x, e.y, p.x, p.y); if (d2 < bd) { bd = d2; b = e; } } used.add(b); cx = b.x; cy = b.y; }
    pts.push(Math.round(cx), Math.round(cy));
    for (let n = 0; n < C.TETHER_N; n++) {
      let b = null, bd = R2;
      for (const e of ch) { if (used.has(e)) continue; const d2 = U.dist2(e.x, e.y, cx, cy); if (d2 < bd) { bd = d2; b = e; } }
      if (!b) break;
      used.add(b); this.tetherSeg(p, cx, cy, b.x, b.y, used);
      cx = b.x; cy = b.y; linked = true;
      pts.push(Math.round(cx), Math.round(cy));
    }
    if (linked) this.emit({ t: 'tether', pid: p.pid, pts });
  };
  // One tether link from (x0, y0) to (x1, y1): every foe crossing it that is not a linked foe (skip) takes the tether hit.
  W.tetherSeg = function (p, x0, y0, x1, y1, skip) {
    const C = ED.CONST, st = p.stats, len = Math.hypot(x1 - x0, y1 - y0), q = this.foeScan((x0 + x1) / 2, (y0 + y1) / 2, len / 2 + 24), hit = [];
    for (let k = 0; k < q.length; k++) {
      const o = q[k];
      if (o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || skip.has(o) || U.segDist2(o.x, o.y, x0, y0, x1, y1) > (o.r + 3) ** 2) continue;
      if (st.snareLine ? o.snareT <= 0 && !o.boss : o.tetherT <= 0) hit.push(o);
    }
    this.foeEnd();
    for (const o of hit) {
      if (st.snareLine) { o.snareT = 2; this.stunFoe(o, 0.4, true); continue; }
      o.tetherT = C.TETHER_CD;
      this.hitEnemy(o, st.weapon.dmg * C.TETHER_MUL, { p, kind: 'evo', el: 'lightning', crit: false, noGuard: true, x: x0, y: y0 });
    }
  };

  // Called every tick from updatePlayerBuild for a living, standing hero: ring echoes, spectral echoes (Echo Edge), path upkeep (Vigil, Tempest Arms tethers, Ember Wake) and dash effects.
  // Dash riders deal Class Power (not weapon damage): foes passed through take power x dashDmg once per dash (retired riders: Dawn Stride blinds, Noxious Step adds Venom, Cold Snap rings the hero for power x dashFrost);
  // Umbral Step Reaps a foe passed through whose health is at most twice its Reap line.
  W.updatePlayerCombat = function (p, dt) {
    const st = p.stats, C = ED.CONST;
    const rq = p.ringQ; // Returning Light echoes of a ring weapon
    if (rq && rq.length) for (let i = 0; i < rq.length;) { const o = rq[i]; o.t -= dt; if (o.t <= 0) { rq.splice(i, 1); this.heroRing(p, o.w, o.co, st.waveReturn); } else i++; }
    const eq = p.echoQ; // Echo Edge: spectral strikes that land 0.4 s after their crit
    if (eq && eq.length) for (let i = 0; i < eq.length;) { const o = eq[i]; if (this.time >= o.at) { eq.splice(i, 1); if (o.e.hp > 0) this.hitEnemy(o.e, o.dmg, { p, kind: 'evo', mul: o.mul, spectral: true, knock: 0, x: p.x, y: p.y }); } else i++; }
    const sp2 = p.lvx * p.lvx + p.lvy * p.lvy;
    p.stillT = sp2 < 15 * 15 && !p.dashing ? (p.stillT || 0) + dt : 0;
    if (st.vigil && p.stillT >= C.VIGIL_T && !(p.vigilZ && !p.vigilZ.dead && p.vigilZ.t < p.vigilZ.dur)) p.vigilZ = this.addZone({ kind: 'vigil', x: p.x, y: p.y, r: C.VIGIL_R * (1 + 0.5 * st.area), dur: 600, owner: p.pid, team: 0, custom: true, room: this.room, update: vigilZone });
    if (st.evo === 'lightning' && (p.tetherT = (p.tetherT || 0) - dt) <= 0) { p.tetherT = Math.max(p.tetherT + C.TETHER_IV, 0.001); this.tethers(p); }
    if (st.evo === 'fire' && st.cinderWalk && sp2 > 400 && (p.walkT = (p.walkT || 0) - dt) <= 0) { p.walkT = 0.15; this.addCinder(p, { x: p.x, y: p.y, r: 24 }); }
    // dash effects (host sees remote dashes through their state reports)
    if (p.dashing) {
      if (this.room.breakables.length) { this.smashSeg(p, p.dashFx < 0 ? p.x : p.dashFx, p.dashFx < 0 ? p.y : p.dashFy, p.x, p.y, p.r, true); p.dashFx = p.x; p.dashFy = p.y; } // the path since the last tick (a dash is no hit: it never rings the Drowned Bell)
      if (st.dashDmg || st.dashReap) {
        if (!p.dashHit) p.dashHit = new Set();
        const dmg = st.power * st.dashDmg, add = st.dashVenom || st.dashDoom ? { poison: st.dashVenom, shadow: st.dashDoom } : undefined;
        const fq = this.foeScan(p.x, p.y, p.r + 8), met = [];
        for (let k = 0; k < fq.length || this.foeTail(fq); k++) {
          const e = fq[k];
          if (e.hp <= 0 || p.dashHit.has(e.id)) continue;
          if (U.dist2(e.x, e.y, p.x, p.y) < (e.r + p.r + 8) ** 2) { p.dashHit.add(e.id); met.push(e); }
        }
        this.foeEnd();
        for (const e of met) {
          if (st.dashReap && this.checkReap(e, 2)) continue;
          if (!st.dashDmg || e.hp <= 0) continue;
          this.hitEnemy(e, dmg, { p, kind: 'dash', knock: 80, kx: p.dashDx, ky: p.dashDy, infAdd: add });
          if (st.dashBlind && e.hp > 0 && !e.boss && e.blindCd <= 0) { e.blind = Math.max(e.blind, e.elite ? 0.5 : 1); e.blindCd = C.BLIND_CD; }
        }
      }
      if (st.dashFrost && !p.dashRing) {
        p.dashRing = true;
        const dmg = st.power * st.dashFrost;
        const fq = this.foeScan(p.x, p.y, 80);
        for (let k = 0; k < fq.length || this.foeTail(fq); k++) { const e = fq[k]; if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, p.x, p.y) < (80 + e.r) ** 2) this.hitEnemy(e, dmg, { p, kind: 'dash', noGuard: true }); }
        this.foeEnd();
        this.emit({ t: 'nova', x: p.x, y: p.y, r: 80, c: '#7fe3ff' });
      }
      if (st.dashFire) {
        p.dashTrail -= dt;
        if (p.dashTrail <= 0) { p.dashTrail = 0.05; this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: 22, dur: 2.2, dps: ED.procDmg(ED.BOONS.cindertrail, st), owner: p.pid, team: 0, block: st.firebreak ? 1 : 0 }); }
      }
    } else { p.dashHit = null; p.dashRing = false; p.dashFx = -1; }
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
    for (const z of this.zones) if (z.kind === 'sanct' && U.dist2(z.x, z.y, p.x, p.y) < z.r * z.r) sanctF = Math.min(sanctF, 1 - Math.min(z.drCap || 0.4, z.dr === undefined ? 0.15 : z.dr));
    const hcm = CLS[p.cls], clsF = hcm && hcm.hurtMul ? hcm.hurtMul.call(this, p, src) : 1; // a class's own damage-taken factor (class-bell.js: the whirling bell)
    dmg *= Math.max(ED.CONST.DR_FLOOR, braceF * sanctF * clsF);
    if (p.guardT > 0) dmg *= 0.4;
    const e = src.e;
    if (e && e.weakT > 0) dmg *= 1 - e.weakV;
    if (e && e.chill > 0 && e.chillOwner) dmg *= 1 - e.chillOwner.stats.chillWeaken;
    dmg = Math.max(1, Math.round(dmg));
    if (e && e.fodder) dmg = Math.max(1, Math.min(dmg, Math.round(ED.CONST.FODDER_CAP * p.maxHp))); // fodder touches never exceed FODDER_CAP of max health (before the shield)
    if (p.shield > 0) {
      const sh0 = p.shield, ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab;
      const hc = CLS[p.cls];
      if (hc && hc.absorb) hc.absorb.call(this, p, ab, src);
      if (st.radiantAegis && p.retT <= 0 && (st.aegisNova || (e && e.hp > 0))) { // Radiant Aegis: the shield strikes the attacker (Wrathful Aegis: every foe within 80) for 2 x HP_K x what it absorbed (0.25 s apart)
        p.retT = 0.25;
        const rs = { p, kind: 'retribution', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy' };
        if (st.aegisNova) this.payBlast(p, p.x, p.y, 80, ab * 2 * ED.CONST.HP_K, 'holy', 'shock', null, false, null, 'retribution');
        else this.hitEnemy(e, ab * 2 * ED.CONST.HP_K, rs);
      }
      if (st.rebuke && p.shield <= 0 && !(this.time < p.rebukeAt)) this.rebuke(p, sh0); // Martyr's Rebuke
    }
    p.hp -= dmg; p.invuln = src.hazard ? 0.3 : 0.6; p.hurtT = 0.3;
    if (p.bellS === 1 && p.hp < p.maxHp * ED.CONST.BELL_HP) p.bellS = 2; // the Drowned Bell's watch is broken (rooms.js)
    if (this.boss) p.hitThisBoss = true;
    if (dmg > 0) this.emit({ t: 'hurt', pid: p.pid, v: dmg, x: Math.round(p.x), y: Math.round(p.y) });
    else this.emit({ t: 'block', x: p.x, y: p.y, k: 'aegis' });
    if (e && e.hp > 0) {
      if (st.thorns) this.hitEnemy(e, st.thorns, { p, kind: 'thorns', noProc: true, crit: false });
      if (ED.hasAffix(e, 'vampiric')) e.hp = Math.min(e.maxHp, e.hp + dmg * 3 * ED.CONST.HP_K);
      if (e.def.chillHit) p.chilled = 1.5;
    }
    if (st.guardian && p.hp > 0 && p.hp < p.maxHp * 0.3 && p.guardCd <= 0) { p.guardT = 3; p.guardCd = 20; this.emit({ t: 'guard', pid: p.pid }); }
    if (st.frozenHeart && p.frozenCd <= 0) {
      p.frozenCd = 8;
      const q = this.foeScan(p.x, p.y, 120);
      for (let k = 0; k < q.length || this.foeTail(q); k++) { const en = q[k]; if (en.hp > 0 && !en.boss && !en.def.invuln && en.spawnT <= 0 && !en.burrowed && U.dist2(en.x, en.y, p.x, p.y) < 120 * 120) this.freezeEnemy(en, p); }
      this.foeEnd();
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 120, c: '#9fefff' });
    }
    if (p.hp <= 0) this.playerLethal(p);
    return true;
  };

  // Martyr's Rebuke: the shield of size sh just broke: a holy nova of REBUKE_R for the card's proc damage x clamp(sh / (REBUKE_REF x max HP), 0.5, 2), once per REBUKE_CD; emits 'rebuke'.
  W.rebuke = function (p, sh) {
    const C = ED.CONST, st = p.stats, r = C.REBUKE_R * (1 + 0.5 * st.area), k = U.clamp(sh / (C.REBUKE_REF * p.maxHp), 0.5, 2);
    p.rebukeAt = this.time + C.REBUKE_CD;
    this.emit({ t: 'rebuke', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(r) });
    this.explode(p.x, p.y, r, ED.procDmg(ED.BOONS.martyr, st) * k, 0, p, 'shock', true, { el: 'holy', kind: 'explode' });
  };

  W.playerLethal = function (p) {
    const st = p.stats;
    if (st.phoenix && !p.phoenixUsed) { p.phoenixUsed = true; p.hp = Math.round(p.maxHp * 0.5); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'phoenix', x: p.x, y: p.y }); this.explode(p.x, p.y, 110, ED.procDmg(ED.RELICS.phoenix, st), 0, p, 'fire'); return; }
    if (st.angel && !p.angelUsed) { p.angelUsed = true; p.hp = 1; p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'angel', x: p.x, y: p.y }); return; }
    if (p.secondWind > 0 && !this.boss) { p.secondWind--; p.hp = Math.round(p.maxHp * p.swPct); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'wind', x: p.x, y: p.y }); return; }
    p.hp = 0; p.downed = true; p.bleed = this.partySize() > 1 ? 18 : 0.01; p.revive = 0;
    this.emit({ t: 'down', pid: p.pid, x: p.x, y: p.y });
  };

  // Area damage. team 0 = heroes' blast (hurts foes), team 1 = hostile blast (hurts heroes). opts merges into each hit's src (opts.evoHit: each hit is a landed weapon hit, W.evoHit runs).
  W.explode = function (x, y, r, dmg, team, owner, look, noProc, opts) {
    if (team === 0) {
      const q = this.foeScan(x, y, r);
      for (let k = 0; k < q.length || this.foeTail(q); k++) {
        const e = q[k];
        if (e.hp <= 0 || e.spawnT > 0) continue;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < r + e.r) {
          const s = Object.assign({ p: owner, kind: 'explode', knock: 90, kx: (e.x - x) / (d || 1), ky: (e.y - y) / (d || 1), noProc: !!noProc, crit: false, noGuard: true, x, y }, opts);
          this.hitEnemy(e, dmg, s);
          if (opts && opts.evoHit && owner && owner.stats.evo) this.evoHit(owner, e, Math.atan2(e.y - y, e.x - x), s);
          if (opts && opts.stun && e.hp > 0) this.stunFoe(e, opts.stun, true); // opts.stun: a repeating stun (shocks, waves)
        }
      }
      this.foeEnd();
      this.smashCircle(owner, x, y, r);
    } else {
      for (const p of this.players.values()) if (Math.hypot(p.x - x, p.y - y) < r + p.r) this.hurtPlayer(p, dmg, { e: owner && owner.hp !== undefined && owner.def ? owner : null, x, y });
    }
    this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r), k: look || 'fire' });
  };

  // ---------------- hero attacks ----------------
  // twinMul > 0: a repeat of the last attack (weapon part only, scaled by twinMul: the Shade's mirror images).
  // A Knight with Oath of Steel swings a Cleave every (3 + cleaveN)th attack and on the first swing after a Charge with Follow-Through (o.cleave = its damage bonus); the class hook attackOpts adds per-hit options to every weapon hit, attack runs after the attack.
  // k: the combo step of a combo weapon as the attacker's own control decided it (ED.Stats.comboNext; anything else is decided here); a repeat (twinMul) uses the step of the last attack.
  // Hallowed Arms: while shielded the attack is a lance of light (W.holyAttack) instead of the swing or shots.
  W.playerAttack = function (p, a, twinMul, k) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, wb = st.weapon, evo = evoOf(p), ch = CLS[p.cls], C = ED.CONST;
    if (wb.kind === 'bell') { if (ch && ch.weaponAttack && !(twinMul > 0)) ch.weaponAttack.call(this, p, a); return; } // a chained bell is not swung: the class file hauls it (class-bell.js)
    if (wb.combo && !(twinMul > 0)) { p.comboK = k === (k | 0) && k >= 0 && k < wb.combo.steps.length ? k : ED.Stats.comboNext(p, this.time); p.comboAt = this.time; }
    const w = wb.combo ? ED.Stats.stepWeapon(st, p.comboK | 0) : wb;
    if (twinMul > 0) {
      const o = { mul: twinMul, twin: true };
      if (w.kind === 'melee') this.meleeSwing(p, a, w, undefined, 0, o); else this.fireWeapon(p, a, w, undefined, o);
      return;
    }
    p.face = a; p.atkCount++; p.stealthT = 0; p.lastAtkT = this.time;
    if (p.twist) ED.TWIST.onAttack.call(this, p); // TWIST hook (src/sim/twist.js)
    if (st.swift) p.flowT = C.FLOW_T;
    let crit, amb = null;
    if (p.critStacks > 0) { p.critStacks--; crit = true; }
    if (p.ambush) {
      p.ambush = false; crit = true; amb = { mul: ED.Stats.skillNums('vanish', st).p.ambush.dmg / w.dmg, ambush: true }; // the Ambush hit deals the unforked weapon times 2.5 whatever the fork
      this.emit({ t: 'ambush', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
      if (ch && ch.ambush) ch.ambush.call(this, p, st); // class hook: an Ambush attack starts
    }
    if (st.masterstroke && (st.msOpen ? p.msReady : p.atkCount % 4 === 0)) { // Masterstroke: every 4th attack (Opening Stroke: the first after a dash) crits at +30% and Bleeds for at least 50% of the hit
      p.msReady = false; crit = true;
      amb = Object.assign({}, amb, { mul: ((amb && amb.mul) || 1) * 1.3, bleedMin: 0.5, ms: true });
    }
    if (st.cleave > 0 && w.kind === 'melee') {
      const follow = this.time < p.cleaveNext;
      if (follow || p.atkCount % (3 + st.cleaveN) === 0) { amb = Object.assign({}, amb, { cleave: st.cleave + (follow ? st.chargeCleave : 0) }); p.cleaveNext = 0; }
    }
    const co = ch && ch.attackOpts ? ch.attackOpts.call(this, p, st) : null;
    const base = co ? Object.assign({}, co, amb, co.mul && amb && amb.mul ? { mul: co.mul * amb.mul } : null) : amb; // a class mul (Grave swing) and an attack mul (Masterstroke, Ambush) multiply
    const lance = evo === 'holy' && p.shield > 0;
    const reps = st.twinEvery && p.atkCount % st.twinEvery === 0 ? 2 : 1;
    for (let rep = 0; rep < reps; rep++) {
      const o = rep === 0 ? base : co;
      if (lance) this.holyAttack(p, a + rep * 0.06, w, crit, o || {});
      else if (w.kind === 'melee') this.meleeSwing(p, a + rep * 0.18, w, crit, rep, o);
      else this.fireWeapon(p, a + rep * 0.06, w, crit, o);
    }
    if (w.wave) {
      const every = Math.max(1, w.wave.every + st.waveEvery), n = w.wave.n || 1;
      if (p.atkCount % every === 0) for (let i = 0; i < n; i++) { // a fan of n waves, fan rad apart; the side waves carry fanSide
        const wa = a + (i - (n - 1) / 2) * (w.wave.fan || 0), wv = this.spawnProj({ team: 0, kind: 'wave', x: p.x, y: p.y, a: wa, speed: 320, r: 16 * (1 + st.area * 0.5), dmg: w.dmg * w.wave.mul * (1 + st.waveMul), life: 0.55, pierce: 99, owner: p.pid, knock: 120, wpn: true });
        if (i !== (n - 1) / 2) wv.fanSide = true;
        if (ch && ch.waveShot) ch.waveShot.call(this, p, wv, wa, st); // class hook: edit the wave shot (width, range, stun, homing)
      }
    }
    if (w.ring && p.atkCount % Math.max(1, w.ring.every + st.waveEvery) === 0) this.heroRing(p, w, co);
    if (st.gauntlet && p.atkCount % 6 === 0) {
      const tgt = this.nearestEnemy(p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, 220);
      if (tgt) { this.emit({ t: 'bolt', x: Math.round(tgt.x), y: Math.round(tgt.y) }); this.explode(tgt.x, tgt.y, 40, w.dmg * 2.2, 0, p, 'bolt', false, { el: 'lightning' }); }
    }
    if (ch && ch.attack) ch.attack.call(this, p, a, st, w);
    this.emit({ t: 'atk', pid: p.pid, a: Math.round(a * 100) / 100, n: p.atkCount });
  };

  // Evolution behaviour of one landed weapon hit or bell strike of p on foe e at angle a (src: the hit's source, after hitEnemy: critOut set). Bellwarden strikes call it from class-bell.js.
  // Venomous Arms plants a dose (one per hero at a time; a later hit never resets it). Masterwork Arms: a crit's spectral strike on e at 60% (Echo Edge: 0.4 s later at 100%; Mirror Edge: on the nearest other foe within 120),
  // unless src.specDone (a melee swing or shot whose own spectral geometry, the repeat swing or spectral shot, handles it).
  W.evoHit = function (p, e, a, src) {
    const st = p.stats, evo = st.evo;
    if (!evo || src.twin || src.spectral) return;
    if (evo === 'poison') {
      if (e.hp <= 0 || e.def.invuln) return;
      if (e.doses) { for (const d of e.doses) if (d.p === p) return; } else e.doses = [];
      e.doses.push({ at: this.time + ED.CONST.DOSE_T * (st.doseLong ? 2 : 1), p });
    } else if (evo === 'general' && src.critOut && !src.specDone) {
      const base = st.weapon.dmg, mul = src.mul || 1;
      if (st.echoEdge) { if (e.hp > 0) (p.echoQ || (p.echoQ = [])).push({ at: this.time + 0.4, e, dmg: base, mul }); }
      else if (st.mirrorEdge) { const o = this.nearestEnemy(e.x, e.y, 120, new Set([e.id])); if (o) this.hitEnemy(o, base, { p, kind: 'evo', mul: 0.6 * mul, spectral: true, knock: 0, x: e.x, y: e.y }); }
      else if (e.hp > 0) this.hitEnemy(e, base, { p, kind: 'evo', mul: 0.6 * mul, spectral: true, knock: 0, x: p.x, y: p.y });
    }
  };

  // Evolution behaviour along an attack's path from (x0, y0) to (x1, y1) (src: { mul, crit, hit (Set of foe ids the attack already struck) }). Bellwarden hurls and reels call it from class-bell.js.
  // Cinder Arms scorches the line (not with Ember Wake); Hallowed Arms, while p is shielded, strikes every foe within 10 of the line the attack missed with the weapon hit as Holy.
  W.evoLine = function (p, x0, y0, x1, y1, src) {
    const st = p.stats, evo = st.evo;
    src = src || {};
    if (evo === 'fire' && !st.cinderWalk) this.addCinder(p, { x0, y0, x1, y1 });
    else if (evo === 'holy' && p.shield > 0) this.lanceLine(p, x0, y0, x1, y1, st.weapon, src.crit, { mul: src.mul }, src.hit);
  };

  // Cinder Arms scorched ground of p: g is a disc { x, y, r }, a line { x0, y0, x1, y1 } (CINDER_W wide) or an arc band { x, y, r, w, a, arc }; CINDER_DPS x the weapon per second as Fire for CINDER_T
  // (Firewall: 4 s and it blocks foe pathing, as does a Firebreak hero's), at most CINDER_MAX per hero (the oldest goes).
  W.addCinder = function (p, g) {
    const C = ED.CONST, st = p.stats, z = { kind: 'cinder', owner: p.pid, team: 0, el: 'fire', wpn: true, dps: st.weapon.dmg * C.CINDER_DPS, dur: st.cinderBlock ? 4 : C.CINDER_T, block: st.cinderBlock || st.firebreak ? 1 : 0 };
    if (g.x0 !== undefined) { const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0); if (len < 4) return null; Object.assign(z, { x: g.x0, y: g.y0, r: 0, a: Math.atan2(g.y1 - g.y0, g.x1 - g.x0), len, w: C.CINDER_W }); }
    else Object.assign(z, { x: g.x, y: g.y, r: g.r, a: g.a || 0, arc: g.arc || 0, w: g.w || 0 });
    this.capZones('cinder', p.pid, C.CINDER_MAX - 1);
    return this.addZone(z);
  };

  // Hallowed Arms attack while shielded: a lance of light along each shot's angle (melee 150, shots 260; Twin Lances: also behind you) or, with Halo, a ring (radius 140 melee, 110 shots); the weapon hit as Holy on every foe it covers.
  W.holyAttack = function (p, a, w, crit, o) {
    const st = p.stats, melee = w.kind === 'melee', area = 1 + 0.5 * st.area;
    if (st.haloRing) {
      const r = (melee ? 140 : 110) * area, q = this.foeScan(p.x, p.y, r), list = [];
      for (let k = 0; k < q.length; k++) { const e = q[k]; if (e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed && Math.hypot(e.x - p.x, e.y - p.y) - e.r <= r) list.push(e); }
      this.foeEnd();
      for (const e of list) { const d = Math.hypot(e.x - p.x, e.y - p.y) || 1; this.lanceHit(p, e, w, crit, o, (e.x - p.x) / d, (e.y - p.y) / d); }
      this.smashCircle(p, p.x, p.y, r);
      this.emit({ t: 'hring', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(r), k: 0 });
      return;
    }
    const n = melee ? 1 : w.n + st.projN, sp = n > 1 ? Math.max(w.spread || 0, 0.13) : 0, len = melee ? 150 : 260;
    for (let i = 0; i < n; i++) for (let back = 0; back < (st.twinLance ? 2 : 1); back++) {
      const ang = a + (i - (n - 1) / 2) * sp + back * Math.PI, end = Sim.castMove(this.room, p.x, p.y, ang, len, 2, this.locked);
      this.lanceLine(p, p.x, p.y - 4, end.x, end.y - 4, w, crit, o, null);
    }
  };
  // One lance of light from (x0, y0) to (x1, y1), 20 wide: the weapon hit (crit, o.mul and the attack's options) as Holy on every foe on it not in skip (a Set of foe ids); emits 'lance'.
  W.lanceLine = function (p, x0, y0, x1, y1, w, crit, o, skip) {
    o = o || {};
    const len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len, q = this.foeScan((x0 + x1) / 2, (y0 + y1) / 2, len / 2 + 10), list = [];
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || (skip && skip.has(e.id))) continue;
      if (U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + 10) ** 2) list.push(e);
    }
    this.foeEnd();
    for (const e of list) this.lanceHit(p, e, w, crit, o, ux, uy, x0, y0);
    this.smashSeg(p, x0, y0, x1, y1, 10);
    this.emit({ t: 'lance', x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1), pid: p.pid });
  };
  W.lanceHit = function (p, e, w, crit, o, kx, ky, x0, y0) {
    this.hitEnemy(e, w.dmg, { p, kind: 'weapon', wpn: true, el: 'holy', crit, mul: o.mul, ambush: o.ambush, infAdd: o.infAdd, bleedMin: o.bleedMin, ms: o.ms, knock: w.knock || 40, kx, ky, x: x0 === undefined ? p.x : x0, y: y0 === undefined ? p.y : y0 });
  };

  // o: { mul (extra damage multiplier), ambush, spectral, twin, infAdd, bleedMin, ms (a Masterstroke), cleave (Cleave damage bonus) }
  // A Cleave reaches and sweeps 40% further, knocks back twice as hard, parries a foe in the last moments of its wind-up (Sworn Blade) and cracks the ground with Oathbreaker's shock.
  // w.ahead: the swing is a slam circle (radius ahead.r, a Cleave's 40% larger) centred `reach` px along the aim; w.pull: a hit drags the foe toward the hero instead of knocking it back (elites half, bosses never).
  // Evolutions: each landed hit runs W.evoHit; Cinder Arms scorches the swing's arc band (a slam: its circle).
  W.meleeSwing = function (p, a, w, crit, rep, o) {
    o = o || {};
    const st = p.stats, cl = o.cleave > 0, wpn = !o.twin && !o.spectral, evo = evoOf(p), spec = evo === 'general' && !st.echoEdge && !st.mirrorEdge;
    const reach = w.range * (1 + st.area * 0.5 + st.meleeReach) * (cl ? 1.4 : 1);
    const arc = Math.min(6.3, w.arc * (1 + st.area * 0.4) * (cl ? 1.4 : 1));
    const mul = (o.mul || 1) * (cl ? 1 + o.cleave : 1);
    const ah = !!w.ahead, sr = ah ? w.ahead.r * (1 + st.area * 0.5) * (cl ? 1.4 : 1) : 0, cx = ah ? p.x + Math.cos(a) * reach : p.x, cy = ah ? p.y + Math.sin(a) * reach : p.y;
    let anyCrit = false, pulled = null;
    const q = this.foeScan(cx, cy, ah ? sr : reach);
    for (let k = 0; k < q.length || this.foeTail(q); k++) {
      const e = q[k];
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (ah ? Math.hypot(e.x - cx, e.y - cy) - e.r > sr : d - e.r > reach) continue;
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      if (!ah && arc < 6.2 && Math.abs(U.angDiff(a, ang)) > arc / 2 + Math.atan2(e.r, Math.max(d, 1))) continue;
      if (cl && st.parry && this.parry(e, p) && st.riposte) this.grantCrits(p, st.riposte, 5, 'add');
      const hs = { p, kind: 'weapon', wpn, part: cl ? 'cleave' : undefined, crit, mul: mul === 1 ? undefined : mul, ambush: o.ambush, infAdd: o.infAdd, bleedMin: o.bleedMin, ms: o.ms, twin: o.twin, spectral: o.spectral, specDone: spec, knock: w.pull ? 0 : cl ? w.knock * 2 : w.knock, kx: Math.cos(ang), ky: Math.sin(ang) };
      this.hitEnemy(e, w.dmg, hs);
      if (hs.critOut) anyCrit = true;
      if (evo) this.evoHit(p, e, ang, hs);
      if (w.pull && e.hp > 0 && !e.boss) { // knockback speed v decays at 9 per second: it travels v / 9 px
        const v = 9 * Math.min(w.pull, Math.max(0, d - e.r - p.r - 4)) * (e.elite ? 0.5 : 1);
        if (v > 0) { e.kbx -= Math.cos(ang) * v; e.kby -= Math.sin(ang) * v; if (wpn && (pulled || (pulled = [])).length < 6) pulled.push([Math.round(e.x), Math.round(e.y)]); }
      }
    }
    this.foeEnd();
    if (ah) this.smashCircle(p, cx, cy, sr); else this.smashArc(p, a, reach, arc);
    if (evo === 'fire' && wpn && rep === 0 && !st.cinderWalk) this.addCinder(p, ah ? { x: cx, y: cy, r: sr } : { x: p.x, y: p.y, r: reach * 0.6, w: reach * 0.8, a, arc });
    if (w.shock && rep === 0) { const sd = ah ? reach : reach * 0.55; this.explode(p.x + Math.cos(a) * sd, p.y + Math.sin(a) * sd, w.shock.r * (1 + st.area * 0.5), w.dmg * w.shock.mul * mul, 0, p, 'shock', true, { wpn }); }
    if (cl && st.cShock) this.explode(p.x + Math.cos(a) * reach * 0.9, p.y + Math.sin(a) * reach * 0.9, 72 * (1 + st.area * 0.5), w.dmg * st.cShock, 0, p, 'shock', true, { wpn: true, stun: st.cStun });
    const ev = { t: 'swing', pid: p.pid, a: Math.round(a * 100) / 100, r: Math.round(reach), arc: Math.round(arc * 100) / 100 };
    if (cl) ev.k = 'cleave';
    if (ah) ev.sr = Math.round(sr); // a slam: a circle of radius sr, r px along a
    if (w.step !== undefined) ev.c = w.step; // the combo step (the viewer's pose)
    this.emit(ev);
    if (pulled) this.emit({ t: 'pull', pid: p.pid, pts: pulled });
    if (anyCrit && spec && !o.spectral && !o.twin) this.meleeSwing(p, a, w, undefined, 1, { mul: 0.6, spectral: true });
  };

  // A ring of light around the hero (weapon.ring): every foe within ring.r takes ring.mul x the attack's damage as a class-element weapon hit; co: the class attack options (infAdd).
  // Dawnbringer's wave rules: waveMul, waveStun and waveBig (radius x1.5) apply; Litany's attack rings three times as hard; Returning Light rings again at waveReturn 0.35 s later (echo: that factor, no Litany, no further echo).
  W.heroRing = function (p, w, co, echo) {
    const st = p.stats, lit = !echo && st.litany && p.atkCount % st.litany === 0 ? 3 : 1, r = w.ring.r * (1 + st.area * 0.5) * (st.waveBig ? 1.5 : 1), dmg = w.dmg * w.ring.mul * (1 + st.waveMul) * (echo || lit), q = this.foeScan(p.x, p.y, r);
    for (let k = 0; k < q.length || this.foeTail(q); k++) {
      const e = q[k];
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d - e.r > r) continue;
      this.hitEnemy(e, dmg, { p, kind: 'weapon', wpn: true, part: 'ring', clsEl: st.element || undefined, infAdd: co && co.infAdd, knock: 120, kx: (e.x - p.x) / (d || 1), ky: (e.y - p.y) / (d || 1), noGuard: true, x: p.x, y: p.y });
      if (st.waveStun && e.hp > 0) this.stunFoe(e, st.waveStun, true);
    }
    this.foeEnd();
    this.smashCircle(p, p.x, p.y, r);
    this.emit({ t: 'hring', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(r), k: echo ? 1 : lit > 1 ? 3 : 0 });
    if (!echo && st.waveReturn > 0) (p.ringQ || (p.ringQ = [])).push({ t: 0.35, w, co });
  };

  // Weapon shots of one attack: n = w.n + projN in a fan (beams and lobbed shells their own way). Cinder Arms scorches each shot's line to its full range (a shell: its landing circle); a shot's landed hits run W.evoHit.
  W.fireWeapon = function (p, a, w, crit, o) {
    o = o || {};
    const st = p.stats, evo = evoOf(p), area = 1 + st.area * 0.5;
    const n = w.n + st.projN;
    const sp = n > 1 ? Math.max(w.spread || 0, 0.13) : 0;
    const ex = w.explode ? { r: w.explode.r * area * (o.blastMul || 1), mul: w.explode.mul } : null; // o.blastMul / o.pierce: per-attack options of a class hook (attackOpts)
    const wpn = !o.twin && !o.spectral, spec = evo === 'general' && wpn && !st.echoEdge && !st.mirrorEdge, scorch = evo === 'fire' && wpn && !st.cinderWalk;
    for (let i = 0; i < n; i++) {
      const ang = a + (i - (n - 1) / 2) * sp + (w.jitter ? this.rng.range(-w.jitter, w.jitter) : 0);
      if (w.beam) { this.fireBeam(p, ang, w, crit, o, ex, spec && i === 0, wpn); continue; }
      if (w.lob) { this.lobShot(p, ang, w, crit, o, ex, wpn); continue; }
      if (scorch) { const end = Sim.castMove(this.room, p.x, p.y, ang, w.speed * w.life, 2, this.locked); this.addCinder(p, { x0: p.x, y0: p.y, x1: end.x, y1: end.y }); }
      this.spawnProj(Object.assign({
        team: 0, kind: w.proj, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed: w.speed, r: w.r,
        dmg: w.dmg, life: w.life, pierce: w.pierce + st.pierce + (o.pierce || 0), owner: p.pid, crit, knock: w.knock || 40, mul: o.mul, ambush: o.ambush, ms: o.ms, spec, wpn, twin: o.twin,
        explode: ex, infAdd: o.infAdd, bleedMin: o.bleedMin, blastPierce: o.blastPierce,
        cloud: w.cloud ? { r: w.cloud.r * area, dps: w.cloud.dps, dur: w.cloud.dur } : null,
        homing: (w.homing || 0) + (st.homing || 0), shieldAlly: w.shieldAlly || 0, burn: w.burn || 0,
      }, this.shotShape(p, w)));
    }
  };

  // Flight-shape fields of a weapon shot (merged over the spawnProj options): ret (boomerang: out to w.speed x w.life px, back to the owner, every foe once per leg; life caps both legs), trail and pool (zones a shot leaves, dps a share of the shot's damage, radius x the area bonus); null for a plain shot.
  W.shotShape = function (p, w) {
    if (!w.ret && !w.trail && !w.pool) return null;
    const area = 1 + p.stats.area * 0.5, o = {};
    if (w.ret) { o.ret = 1; o.out = w.speed * w.life; o.life = w.life * 2 + 0.5; o.pierce = 999; }
    if (w.trail) o.trail = { n: w.trail.n, every: w.trail.every, r: w.trail.r * area, dps: w.dmg * w.trail.mul, dur: w.trail.dur, next: w.trail.every, left: w.trail.n };
    if (w.pool) o.pool = { r: w.pool.r * area, dps: w.dmg * w.pool.mul, dur: w.pool.dur, zk: w.pool.zk, ally: w.pool.ally || 0 };
    return o;
  };

  // A beam shot (w.beam): an instant line of w.speed x w.life px along ang from the hero, cut at the first wall, w.r px half-width (each pierce of Overheat's o.pierce widens it 50%). Every foe on it takes a weapon hit, nearest first, until a guard stops the beam there.
  // A hit's source carries dist (the foe's distance along the beam) and pass (foes struck before it). The beam's blast (ex) and a crit's spectral strike (60% on the same foe) land at the last foe struck, else at the beam's end; evolutions: W.evoHit per hit, W.evoLine along the beam.
  W.fireBeam = function (p, ang, w, crit, o, ex, spec, wpn) {
    const st = p.stats, ca = Math.cos(ang), sa = Math.sin(ang), x0 = p.x, y0 = p.y - 4, evo = evoOf(p);
    const end = Sim.castMove(this.room, p.x, p.y, ang, w.speed * w.life, 2, this.locked), x1 = end.x, y1 = end.y - 4, len = Math.hypot(x1 - x0, y1 - y0);
    const hw = w.r * (1 + 0.5 * (o.pierce || 0)), on = [];
    const q = this.foeScan((x0 + x1) / 2, (y0 + y1) / 2, len / 2 + hw);
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      const t = (e.x - x0) * ca + (e.y - y0) * sa;
      if (t > -e.r && t < len + e.r && U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + hw) ** 2) on.push({ e, t });
    }
    this.foeEnd();
    on.sort((u, v) => u.t - v.t);
    let bx = x1, by = y1, cut = len;
    const owner = p;
    for (let i = 0; i < on.length; i++) {
      const e = on[i].e;
      if (e.hp <= 0) continue;
      const hs = { p: owner, kind: 'weapon', crit, mul: o.mul, ambush: o.ambush, ms: o.ms, twin: o.twin, spectral: o.spectral, specDone: spec, knock: w.knock || 40, kx: ca, ky: sa, burn: w.burn || 0, infAdd: o.infAdd, bleedMin: o.bleedMin, x: x0, y: y0, wpn, dist: Math.max(0, on[i].t), pass: i };
      this.hitEnemy(e, w.dmg, hs);
      if (spec && hs.critOut && e.hp > 0) this.hitEnemy(e, w.dmg, { p: owner, kind: 'evo', mul: 0.6 * (o.mul || 1), knock: 0, x: x0, y: y0 });
      if (evo && wpn) this.evoHit(p, e, ang, hs);
      bx = e.x; by = e.y;
      if (hs.guarded) { cut = Math.max(0, on[i].t); break; }
    }
    this.smashSeg(p, x0, y0, x0 + ca * cut, y0 + sa * cut, hw);
    if (evo === 'fire' && wpn && !st.cinderWalk) this.addCinder(p, { x0, y0: y0 + 4, x1: x0 + ca * cut, y1: y0 + 4 + sa * cut });
    if (ex) this.projBurst({ owner: p.pid, x: bx, y: by, kind: w.proj, dmg: w.dmg, mul: o.mul || 0, explode: ex, wpn, infAdd: o.infAdd || null });
    this.emit({ t: 'beam', pid: p.pid, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x0 + ca * cut), y1: Math.round(y0 + sa * cut), w: Math.round(hw) });
  };

  // A lobbed shot (w.lob): a shell arcs over foes and walls to the hero's aim point (p.atkD: the attack's cursor distance, else the cursor point aimX / aimY, else the nearest foe on the aim line, else full range) along ang, clamped to LOB_MIN..w.speed x w.life and cut at the first wall,
  // landing w.lob.t s later as its blast (ex): every foe in it takes a weapon hit (it may crit, Staggers on Heavy; dist = the flight distance; W.evoHit per foe; Cinder Arms scorches the blast circle). The landing spot shows as a friendly 'tele' zone with the lob arc (z.lob = the launch point).
  ED.CONST.LOB_MIN = 30;
  W.lobShot = function (p, ang, w, crit, o, ex, wpn) {
    const max = w.speed * w.life, fin = (v) => typeof v === 'number' && isFinite(v);
    let d = fin(p.atkD) ? p.atkD : fin(p.aimX) && fin(p.aimY) ? Math.hypot(p.aimX - p.x, p.aimY - p.y) : -1;
    if (d < 0) { // no cursor distance: the nearest foe whose centre lies within half the blast radius of the aim line, else full range
      const cx = Math.cos(ang), cy = Math.sin(ang), half = (ex ? ex.r : 40) * 0.5, es = this.foeScan(p.x, p.y, max);
      d = max;
      for (const e of es) { if (e.hp <= 0) continue; const dx = e.x - p.x, dy = e.y - p.y, t = dx * cx + dy * cy; if (t > 0 && t < d && Math.abs(dx * cy - dy * cx) <= half + e.r) d = t; }
      this.foeEnd();
    }
    d = U.clamp(d, ED.CONST.LOB_MIN, max);
    const g = Sim.groundPoint(this.room, this.locked, p.x, p.y, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, max, false);
    const r = ex ? ex.r : 40, flown = Math.hypot(g.x - p.x, g.y - p.y);
    const shot = { owner: p.pid, kind: w.proj, dmg: w.dmg, mul: o.mul || 0, explode: ex || { r, mul: 1 }, wpn, infAdd: o.infAdd || null, crit, ms: o.ms, knock: w.knock || 40, lob: true, dist: flown };
    this.addZone({ kind: 'tele', x: g.x, y: g.y, r, dur: w.lob.t, team: 0, owner: p.pid, custom: true, lob: [Math.round(p.x), Math.round(p.y - 10)],
      onEnd: (world, z) => {
        if (z.room !== world.room) return;
        shot.x = z.x; shot.y = z.y; world.projBurst(shot);
        const o2 = world.players.get(shot.owner);
        if (o2 && wpn && o2.stats.evo === 'fire' && !o2.stats.cinderWalk) world.addCinder(o2, { x: z.x, y: z.y, r });
      }, room: this.room });
  };

  W.playerDash = function (p, dx, dy) {
    if (!p || p.downed || p.dead) return;
    p.dashDx = dx; p.dashDy = dy;
    if (p.stats.msOpen) p.msReady = true; // Opening Stroke: the next attack is the Masterstroke
    if (p.stats.dashBomb) this.addZone({ kind: 'bomb', x: p.x, y: p.y, r: 60, dur: 0.6, team: 0, owner: p.pid, dmg: ED.procDmg(ED.RELICS.satchel, p.stats) });
    this.emit({ t: 'dash', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
  };

  // ---------------- projectiles ----------------
  // o.hk: hit kind for hitEnemy; o.mul/o.ambush: extra multiplier; o.spec: crits release a spectral copy; o.shieldAlly: shield fraction an ally gets on touch (Sacred Lantern);
  // o.infAdd / o.bleedMin: per-hit infusion rates and Bleed share; o.ms: a Masterstroke shot; o.twin: a mirror-image repeat (no evolution behaviour).
  // o.wpn: a weapon shot (its hits are weapon hits); o.part: the skill part its hits belong to; o.ghost: moved and removed by its owner's code (thrown shield: pr.dead removes it); o.infK: infusion scale of its hits;
  // o.stun: seconds of repeating stun on a hit (waves); pr.dist = distance flown (every hero shot) and pr.pass = foes passed; o.homeCone (radians, with o.homing): the shot steers only toward foes within homeCone of o.homeA0 and never turns past it; o.noSplit: reserved for class routes.
  // o.ret / o.out / o.trail / o.pool: the flight shape of W.shotShape (pr.ret 1 = out leg, 2 = flying back).
  W.spawnProj = function (o) {
    const pr = {
      id: U.uid(), team: o.team, kind: o.kind, x: o.x, y: o.y, vx: Math.cos(o.a) * o.speed, vy: Math.sin(o.a) * o.speed,
      r: o.r || 5, dmg: o.dmg || 1, life: o.life || 2, pierce: o.pierce || 0, owner: o.owner, src: o.src || null,
      crit: o.crit, knock: o.knock || 0, explode: o.explode || null, cloud: o.cloud || null, homing: o.homing || 0,
      shieldAlly: o.shieldAlly || 0, burn: o.burn || 0, hit: null, healed: null, accel: o.accel || 0, turn: o.turn || 0, boom: o.boom || null,
      hk: o.hk || null, mul: o.mul || 0, ambush: !!o.ambush, spec: !!o.spec, infAdd: o.infAdd || null, bleedMin: o.bleedMin || 0, ms: !!o.ms, twin: !!o.twin,
      wpn: !!o.wpn, blastPierce: !!o.blastPierce, part: o.part || null, ghost: !!o.ghost, dead: false, infK: o.infK || 0, stun: o.stun || 0, dist: 0, pass: 0, homeA0: o.homeA0, homeCone: o.homeCone || 0, noSplit: !!o.noSplit,
      ret: o.ret || 0, out: o.out || 0, trail: o.trail || null, pool: o.pool || null,
    };
    this.projs.push(pr);
    return pr;
  };

  // Foe shot speed x 1.2 under Pact 8+ x the stratum's shot factor (World.shotSpd; bosses World.bossShotSpd).
  W.enemyShoot = function (e, a, speed, kind, dmgMul, r, extra) {
    const mul = (this.pact >= 8 ? 1.2 : 1) * (e.boss ? ED.World.bossShotSpd(this.stratum) : ED.World.shotSpd(this.stratum));
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
      if (pr.dead) continue;
      if (pr.ghost) { keep.push(pr); continue; }
      pr.life -= dt;
      if (pr.life <= 0) { if (pr.team === 0) { if (pr.explode) this.projBurst(pr); this.projEnd(pr, 'life'); this.projDrop(pr, pr.x, pr.y); } continue; }
      if (pr.ret === 1 && pr.dist >= pr.out) this.projTurn(pr);
      if (pr.ret === 2) { // flying back: straight at the owner at its speed, gone when caught (within RET_CATCH px) or when the owner is down or gone
        const o = this.players.get(pr.owner);
        if (!o || o.downed || o.dead) continue;
        const dx = o.x - pr.x, dy = o.y - 4 - pr.y, d = Math.hypot(dx, dy), sp = Math.hypot(pr.vx, pr.vy) || 1;
        if (d < ED.CONST.RET_CATCH + sp * dt) continue;
        pr.vx = dx / d * sp; pr.vy = dy / d * sp;
      } else if (pr.homing) {
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
        if (pr.ret === 1) { pr.x -= pr.vx * dt; pr.y -= pr.vy * dt; this.projTurn(pr); keep.push(pr); continue; } // a wall turns a boomerang back
        if (pr.team === 0 && pr.explode) this.projBurst(pr);
        else if (pr.team === 0 && pr.cloud) this.spawnCloud(pr.owner, pr.x - pr.vx * dt, pr.y - pr.vy * dt, pr.cloud);
        if (pr.team === 0) { this.projDrop(pr, pr.x - pr.vx * dt, pr.y - pr.vy * dt); this.projEnd(pr, 'wall'); }
        this.emit({ t: 'spark', x: Math.round(pr.x), y: Math.round(pr.y), k: ED.PROJ_IDX[pr.kind] || 0 });
        continue;
      }
      let dead = false;
      if (pr.team === 0) {
        const owner = this.players.get(pr.owner);
        if (room.breakables.length || room.bell) this.smashSeg(owner, pr.x - pr.vx * dt, pr.y - pr.vy * dt, pr.x, pr.y, pr.r); // the step just flown; a breakable never stops the shot
        const q = this.foeScan(pr.x, pr.y, pr.r);
        for (let k = 0; k < q.length || this.foeTail(q); k++) {
          const e = q[k];
          if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
          if (pr.hit && pr.hit.has(e.id)) continue;
          const rr = e.r + pr.r;
          if (U.dist2(pr.x, pr.y, e.x, e.y) > rr * rr) continue;
          if (!pr.hit) pr.hit = new Set();
          pr.hit.add(e.id);
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          const hs = { p: owner, kind: pr.hk || 'weapon', crit: pr.crit, mul: pr.mul, ambush: pr.ambush, knock: pr.knock, kx: pr.vx / sp, ky: pr.vy / sp, burn: pr.burn, infAdd: pr.infAdd, infK: pr.infK, bleedMin: pr.bleedMin, x: pr.x, y: pr.y, wpn: pr.wpn, part: pr.part, dist: pr.dist, pass: pr.pass, ms: pr.ms, twin: pr.twin, specDone: pr.spec };
          this.hitEnemy(e, pr.dmg, hs);
          if (owner && pr.wpn && owner.stats.evo) this.evoHit(owner, e, Math.atan2(pr.vy, pr.vx), hs);
          const ph = owner && CLS[owner.cls];
          if (ph && ph.projHit) ph.projHit.call(this, pr, e, hs); // class hook: a hero shot hit e (pr.pierce is what is left before this hit is counted)
          if (pr.stun && e.hp > 0) this.stunFoe(e, pr.stun, true);
          if (pr.spec && hs.critOut) this.spectralShot(pr, e);
          if (pr.explode) { this.projBurst(pr); if (!pr.ret && !(pr.blastPierce && pr.pierce-- > 0)) { dead = true; break; } pr.pass++; continue; } // blastPierce (a class option): the shot bursts on each foe it pierces; a boomerang bursts on each foe it strikes
          if (pr.cloud) { this.spawnCloud(pr.owner, pr.x, pr.y, pr.cloud); dead = true; break; }
          if (pr.ret) { if (hs.guarded && pr.ret === 1) { this.projTurn(pr); break; } pr.pass++; continue; } // a guard turns a boomerang back
          if (hs.guarded || pr.pierce-- <= 0) { dead = true; break; }
          pr.pass++;
        }
        this.foeEnd();
        if (dead) this.projDrop(pr, pr.x, pr.y);
        else if (pr.trail && pr.trail.left > 1 && pr.dist >= pr.trail.next) { const tr = pr.trail; tr.left--; tr.next += tr.every; this.spawnCloud(pr.owner, pr.x, pr.y, tr); } // a trail cloud every `every` px flown, the last one kept for the end of the flight
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
        if (this.solidOn && this.solidStops(pr)) { this.emit({ t: 'spark', x: Math.round(pr.x), y: Math.round(pr.y), k: ED.PROJ_IDX[pr.kind] || 0 }); continue; } // Glacier foes, ice pillars and Storm Anchors stop foe shots
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

  // A boomerang starts its return leg: every foe may be struck once more.
  ED.CONST.RET_CATCH = 14;
  W.projTurn = function (pr) { pr.ret = 2; pr.hit = null; };

  // A hero shot ended at (x, y): its trail lays the clouds it has left (one), its pool forms there.
  W.projDrop = function (pr, x, y) {
    if (pr.trail && pr.trail.left > 0) { pr.trail.left = 0; this.spawnCloud(pr.owner, x, y, pr.trail); }
    if (pr.pool) { const c = pr.pool; pr.pool = null; this.spawnCloud(pr.owner, x, y, c); }
  };

  // True when foe shot pr touches a solid: a frozen Glacier foe (not its own shooter) or a solid zone (ice pillar, Storm Anchor; z.sr the solid radius, else z.r).
  W.solidStops = function (pr) {
    for (const z of this.zones) if (z.solid && !z.dead && U.dist2(z.x, z.y, pr.x, pr.y) < ((z.sr || z.r) + pr.r) ** 2) return true;
    const q = this.foeScan(pr.x, pr.y, pr.r);
    let hit = false;
    for (let k = 0; k < q.length && !hit; k++) { const e = q[k]; if (e.glacier && e.frozen > 0 && e !== pr.src && e.hp > 0 && U.dist2(e.x, e.y, pr.x, pr.y) < (e.r + pr.r) ** 2) hit = true; }
    this.foeEnd();
    return hit;
  };

  W.projBurst = function (pr) {
    const owner = this.players.get(pr.owner);
    if (!owner) return;
    this.explode(pr.x, pr.y, pr.explode.r, pr.dmg * (pr.mul || 1) * pr.explode.mul, 0, owner, pr.kind === 'fireball' ? 'bigfire' : 'fire', false, pr.lob
      ? { wpn: pr.wpn, infAdd: pr.infAdd || undefined, kind: 'weapon', crit: pr.crit, ms: pr.ms, knock: pr.knock, dist: pr.dist, evoHit: !!pr.wpn } // a lobbed shell's landing is the shot's own hit (evolution behaviour per foe)
      : { wpn: pr.wpn, infAdd: pr.wpn ? pr.infAdd : undefined });
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
  // c.zk: the zone kind (default 'plague'; a Votive pool is 'holypool'); c.ally: shield fraction an ally inside gets (allyPool).
  W.spawnCloud = function (owner, x, y, c) {
    const zk = c.zk || 'plague';
    for (const z of this.zones) {
      if (z.kind === zk && z.parts && z.owner === owner && U.dist2(z.x, z.y, x, y) < z.r * z.r) {
        z.parts.push({ dps: c.dps, until: z.t + c.dur });
        z.dur = Math.max(z.dur, z.t + c.dur);
        return z;
      }
    }
    return this.addZone({ kind: zk, x, y, r: c.r, dur: c.dur, dps: c.dps, owner, team: 0, wpn: true, parts: [{ dps: c.dps, until: c.dur }], ally: c.ally || 0, update: c.ally ? allyPool : undefined });
  };
  // A pool that shields allies (Votive Lamp): every ally inside but its owner gets z.ally of max HP as the lantern's class shield (once per LANTERN_CD per ally, up to CLASS_SHIELD_CAP), the Sacred Lantern's orb rule.
  function allyPool(w, z) {
    const owner = w.players.get(z.owner);
    if (!owner) return;
    for (const q of w.players.values()) {
      if (q === owner || q.downed || q.dead || q.lanternT > 0 || U.dist2(z.x, z.y, q.x, q.y) > (z.r + q.r) ** 2) continue;
      w.addShield(q, q.maxHp * z.ally, q.maxHp * ED.CONST.CLASS_SHIELD_CAP, 'lantern');
      q.lanternT = ED.CONST.LANTERN_CD;
    }
  }

  // True when foe e stands in zone z: a line (len, a, w wide), an arc band (r the band's middle, w its width, a, arc) or a disc (r).
  function zoneHas(z, e) {
    if (z.len > 0) return U.segDist2(e.x, e.y, z.x, z.y, z.x + Math.cos(z.a) * z.len, z.y + Math.sin(z.a) * z.len) < (z.w / 2 + e.r) ** 2;
    const d2 = U.dist2(z.x, z.y, e.x, e.y);
    if (!(z.arc > 0)) return d2 < (z.r + e.r) ** 2;
    const d = Math.sqrt(d2), h = z.w / 2 + e.r;
    return d > z.r - h && d < z.r + h && (z.arc >= 6.2 || Math.abs(U.angDiff(z.a, Math.atan2(e.y - z.y, e.x - z.x))) <= z.arc / 2 + Math.atan2(e.r, Math.max(d, 1)));
  }
  W.zoneHas = zoneHas;

  W.updateZones = function (dt) {
    const keep = [];
    for (const z of this.zones) {
      if (z.dead) continue;
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
          if (z.n) { this.spawnPack(z); continue; } // a fodder pack
          const e = this.spawnEnemy(z.type, z.x, z.y, { elite: z.elite, affix: z.affix, plan: z.plan });
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
            const zk = !!(z.clsEl || z.part || z.lava || z.kind === 'shards'); // a class-skill field (Sanctuary, Pyro ring, crater, lava, caltrops) rings; boon and weapon fields stay silent
            if (z.parts) { dps = 0; let k = 0; for (const q of z.parts) if (q.until > z.t) { dps += q.dps; z.parts[k++] = q; } z.parts.length = k; }
            const ln = z.len > 0, q = ln ? this.foeScan(z.x + Math.cos(z.a) * z.len / 2, z.y + Math.sin(z.a) * z.len / 2, z.len / 2 + z.w) : this.foeScan(z.x, z.y, z.r + (z.w || 0) / 2);
            for (let k = 0; k < q.length || this.foeTail(q); k++) {
              const e = q[k];
              if (e.hp <= 0 || e.spawnT > 0 || !zoneHas(z, e)) continue;
              this.hitEnemy(e, dps * 0.5, { p: owner, kind: 'dot', noProc: true, crit: false, el, clsEl: z.clsEl, wpn: z.wpn, part: z.part, zone: zk });
              if (z.rad && e.hp > 0 && owner) this.addRadiance(e, dps * 0.5 * z.rad, owner); // z.rad: share of each tick stored as Radiance (Sanctuary)
            }
            this.foeEnd();
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

  // Boss fury: where World.BOSS_FURY.t is set for the stratum, furyT counts fight seconds while the boss lives (phases, freezes, stuns and blinds keep it running); past t, furyM = World.furyMul and e.dmg = dmgBase x furyM, so
  // every attack made later hits harder (bosses.js divides the pause between attacks by furyM). One 'fury' event at the crossing.
  W.tickFury = function (e, dt) {
    const t = ED.World.furyAt(this.stratum);
    if (!(t > 0)) return;
    const was = e.furyT;
    e.furyT = was + dt;
    if (e.furyT <= t) return;
    if (was <= t) this.emit({ t: 'fury', type: e.type, x: Math.round(e.x), y: Math.round(e.y) });
    e.furyM = ED.World.furyMul(this.stratum, e.furyT); e.dmg = e.dmgBase * e.furyM;
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
    e.age += dt;
    if (e.boss) this.tickFury(e, dt);
    if (!e.exposed && !e.def.invuln && !e.fodder && this.enc && e.age > (e.boss ? 78 : 45) && !(e.boss && ED.World.furyAt(this.stratum) > 0)) { e.exposed = true; this.emit({ t: 'expose', x: e.x, y: e.y, boss: e.boss ? 1 : 0 }); } // a boss of a fury stratum is never exposed (fury ends its stalls)
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
          const full = FULL_CONTACT.has(e.st);
          if (this.hurtPlayer(p, e.dmg * (full ? 1 : 0.4) * (e.boss ? 0.8 : 1), { e, x: e.x, y: e.y })) { e.contactCd = 1.0; e.recoil = 0.35; }
          break;
        }
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
