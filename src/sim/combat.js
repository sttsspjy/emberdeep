// Combat rules: spawning, damage, statuses, deaths, hero attacks, projectiles and area zones.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon;
  const W = ED.World.prototype;

  // Path constants (the element verbs' own live in elements.js). Venom: K = amount per fraction of the foe's reference HP, DECAY per second after HOLD seconds. CHILL_K: chill per fraction of the foe's reference HP.
  // Smite gauge = SMITE_AT x the foe's real HP; a Holy shield grant is at most HOLY_GRANT_MAX of max HP, once per HOLY_CD per receiving hero within HOLY_R. Shields: LANTERN_CD per ally, CLASS_SHIELD_CAP of max HP, SHIELD_DECAY of max HP per second outside locked rooms.
  // Doom: elites and bosses take DOOM_TOUGH of it; a boss Tolls at TOLL_AT of its real HP. Minions infuse at MINION_INFUSE. Chain queue: CHAIN_HOP seconds per hop, CHAIN_TICK payoffs per trigger hero per tick. BLIND_CD / STUN_CD: per-foe cooldowns of blinds and repeating stuns.
  // BOSS_CHILL / BOSS_CHILL_T: a boss's full chill gauge slows it this much for this long (bosses never freeze).
  Object.assign(ED.CONST, {
    VENOM_K: 300, VENOM_DECAY: 8, VENOM_HOLD: 3, CHILL_K: 340, BOSS_CHILL: 0.4, BOSS_CHILL_T: 2,
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
    { key: 'lacerate', label: 'to bleeding foes', hit: (st, e) => (e.bleedPool > 0 ? st.lacerate : 0) },
    { key: 'backstab', label: 'on Backstabs', hit: (st, e, p, w, src) => (src.back ? st.backstab : 0) },
    { key: 'opportunist', label: 'to stunned, frozen or blinded foes', hit: (st, e) => (e.stun > 0 || e.frozen > 0 || e.blind > 0 ? st.opportunist : 0) },
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
    const f = def.boss ? 0 : this.rowFrac(); // the room's row deepens its foes (bosses keep the stratum's depth)
    if (def.fodder) hp = ED.World.fodderHp(def, s, pact);
    else {
      if (!def.boss) hp *= ED.World.hpScale(s, f);
      hp *= this.partyHpMul();
      hp *= ED.pactMul(pact, 'foeHp') * (def.boss ? ED.pactMul(pact, 'bossHp') : 1);
    }
    dmg *= ED.World.dmgScale(s, f) * ED.pactMul(pact, 'foeDmg') * this.threat().dmg;
    if (this.room && this.room.dark && !def.minion && !def.ally && !opts.ally) dmg *= ED.World.DARK_DMG; // every foe of a dark room
    const e = {
      id: U.uid(), type, def, x, y, r: def.r, hp, maxHp: hp, dmg, spd: def.spd * (pact >= 6 ? 1.15 : 1) * (def.boss || def.fodder ? 1 : ED.World.foeSpd(s)),
      kbx: 0, kby: 0, st: 'move', t: 0, cd: this.rng.range(0.6, 1.6), face: 1, flash: -1, stun: 0, frozen: 0, elite: null, elite2: null, ward: 0, wardMax: 0,
      boss: !!def.boss, fodder: !!def.fodder, plan: !!opts.plan, age: 0, fly: !!def.fly, target: null, tgtT: 0, aimA: 0, guardA: 0, contactCd: 0, spawnT: opts.spawnT || 0,
      phase: 1, vars: {}, strafe: this.rng.sign(), wob: this.rng.range(0, 6.28), exposed: false, recoil: 0,
      // statuses: Burn stacks (bsT end times, bsO owners; burnN / burnPool / burn / smother / wildO derived and bacc = build-up toward the next stack: elements.js), Bleed pool, chill, charge (chargeT = hold left),
      // Venom (0-100; corrode / vweak = strongest Caustic / Enfeeble of its heroes), Radiance, Doom (HP units); faceA = facing (Backstabs); cid = last chain id this foe paid out in; stunCd / blindCd = per-foe cooldowns of repeating stuns and blinds;
      // glacier = frozen by a Glacier hero (solid); affixOff = affixes off (ED.hasAffix); hero debuffs (judged = Cleric Judgment, vulnT = Rain/Smoke vulnerability); slow/windMul/dmgTakenMul are read by ai.js and hitEnemy
      burn: 0, burnPool: 0, burnN: 0, burnTick: 0, burnOwner: null, bsT: null, bsO: null, bacc: 0, smother: 0, wildO: null, wildT: 0, bleedPool: 0, bleedTick: 0, bleedOwner: null,
      chill: 0, chillT: 0, chillOwner: null, freezeRes: 0, freezeResT: 0, charge: 0, chargeOwner: null, chargeT: 0,
      venom: 0, venomT: 0, venomTick: 0.5, venomOwner: null, corrode: 0, vweak: 0, rad: 0, radOwner: null, doom: 0, doomOwner: null, cid: 0, cidMask: 0, stunCd: 0, blindCd: 0, faceA: 0,
      glacier: false, affixOff: false,
      hpLever: def.boss ? def.hp / def.refHp : def.fodder ? 1 : this.threat().hp, // HP-relative statuses (chill, Venom) ignore this stratum lever (fodder carries none)
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

  // Elite: HP and damage multipliers apply once; a second affix (e.elite2, never equal to the first) rolls at World.AFFIX2 of the stratum; each affix effect applies once, whichever slot holds it.
  W.makeElite = function (e, affix) {
    const Wc = ED.World;
    e.elite = affix || this.rng.pick(ED.AFFIX_IDS);
    const p2 = Wc.perStratum(Wc.AFFIX2, this.stratum);
    if (p2 > 0 && this.rng.chance(p2)) e.elite2 = this.rng.pick(ED.AFFIX_IDS.filter(id => id !== e.elite));
    e.hp *= Wc.ELITE.hp + Wc.ELITE.hpStep * (Wc.depth(this.stratum) - 1); e.maxHp = e.hp; e.dmg *= Wc.ELITE.dmg; e.r = Math.round(e.r * 1.22); // elite HP x2.4 at stratum I up to x4.4 at IV
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
  // src: { p, kind, crit, mul, el, clsEl, affDone, raw, noProc, noGuard, noShatter, comp, infAdd, infK, bleedMin, ambush, knock, kx, ky, x, y, part, wpn, dist, pass, back, smite }. Writes back src.critOut / src.guarded / src.affMul / src.back.
  // back: a Backstab (elements.js isBackstab), decided here for a hero with Shadow; smite (Divine Riposte): the hit also Smites the foe for its Radiance + the damage dealt. A hero SKILL hit on a frozen foe Shatters it.
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
    if (p && !src.raw && kind !== 'dot' && (st.shadowInfuse > 0 || st.backstab > 0) && src.back === undefined) src.back = this.isBackstab(e, p, src); // a Backstab (elements.js)
    if (p && !src.raw) {
      crit = src.crit === undefined ? !!((ch && ch.hitCrit && ch.hitCrit.call(this, p, e, src)) || this.rng.chance(st.crit)) : !!src.crit;
      let add = 0; // conditional and class additions
      for (let i = 0; i < COND_PRE.length; i++) { const r = COND_PRE[i]; if (r.key === null || st[r.key]) add += r.hit(st, e, p, this, src); }
      if (ch && ch.hitMul) add += ch.hitMul.call(this, p, e, src) || 0;
      for (let i = 0; i < COND_POST.length; i++) { const r = COND_POST[i]; if (st[r.key]) add += r.hit(st, e, p, this, src); }
      dmg *= Math.max(0.1, st.dmg + add);
      if (crit) { dmg *= st.critMult; if (ch && ch.critMul) dmg *= ch.critMul.call(this, p, e, src) || 1; }
    }
    if (src.mul) dmg *= src.mul;
    if (src.bossMul && e.boss) dmg *= src.bossMul; // a skill part's boss factor (W.partSrc copies the part's bossMul)
    if (p && kind === 'skill' && !src.noProc && st.shatter && e.frozen > 0 && !src.noShatter) { dmg *= 1 + st.shatter; shatter = true; } // Shatter: a skill hit on a frozen foe
    let vuln = 1;
    if (e.mark > 0) vuln += e.markV;
    if (e.judged > 0 || e.vulnT > 0) vuln += 0.2; // Judgment and skill-granted vulnerability share one +20%
    if (e.frozen > 0) vuln += 0.25;
    if (e.sunder && p && e.sunderOwner === p.pid) vuln += 0.04 * e.sunder;
    if (e.venom >= 100) vuln += e.corrode; // Caustic: a Corroded foe takes more from every hero
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
    if (kind !== 'dot' || !e.fodder) { // every damage-over-time tick on a foe that is not fodder is announced (v to 0.1, summed by the viewer); fodder ticks are not
      const ev = { t: 'hit', x: Math.round(e.x), y: Math.round(e.y - e.r), v: kind === 'dot' ? Math.round(dmg * 10) / 10 : Math.round(dmg), c: crit ? 1 : 0, k: kind === 'dot' ? (src.zone ? 2 : 1) : 0, pid: p ? p.pid : '', el: src.bleed ? 4 : EL_IDX[src.el || src.clsEl] || 0 };
      if (kind === 'skill') ev.s = 1; // a class-skill hit: the viewer's aggregated skill impact cue (k: 0 hit, 1 status DoT, 2 skill-zone tick)
      if (src.back && kind !== 'minion') ev.b = 1; // a Backstab: the viewer's small dark slash
      if (src.wpn && kind === 'weapon' && st && st.heavy) ev.h = 1; // heavy weapon hit: the viewer's hit-stop
      if (src.far) ev.f = 1; // a far shot (Deadeye): the viewer's bright spark
      if (e.fodder) { ev.fd = 1; if (e.hp <= 0) ev.kl = 1; } // the target is fodder (f is taken by the far shot); kl: the blow took its last health (the viewer prints fodder numbers only then)
      if (src.slow) ev.sl = 1; // a hit that slows (Quickdraw): the viewer's frost streak
      this.emit(ev);
    }
    if (p) {
      p.dealt += dmg;
      if (src.wpn && kind === 'weapon' && st.heavy && e.hp > 0 && !e.boss && e.staggerT <= 0 && e.stunCd <= 0) { e.stun = Math.max(e.stun, e.elite ? ED.CONST.STAGGER * 0.5 : ED.CONST.STAGGER); e.staggerT = ED.CONST.STAGGER_CD; } // Stagger never sets stunCd
      if (shatter) this.shatterBurst(e, p, dmg);
      if (!src.noProc) this.heroProcs(e, p, dmg, crit, comp, src);
      if (ch && ch.hitDone) ch.hitDone.call(this, p, e, dmg, crit, src);
      if (src.smite && e.hp > 0) { const amt = e.rad + dmg, own = this.openChain(); e.rad = 0; this.smite(e, p, amt); if (own) this.curChain = null; } // Divine Riposte
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
    }
  };

  // Element infusions: each owned element (plus src.infAdd rates) builds status from the hit's damage. Shadow's gate rate builds only on a Backstab (src.back; minion hits always are); infAdd shadow always builds. k scales the rate (minions 0.5).
  W.applyInfusions = function (e, dmg, p, src, k) {
    const st = p.stats, add = src && src.infAdd, pre = dmg / ((src && src.affMul) || 1), pow = k * (1 + st.statusPow), back = !!(src && (src.back || src.kind === 'minion'));
    for (let i = 0; i < ED.ELEMENT_IDS.length; i++) {
      const id = ED.ELEMENT_IDS[i], el = ED.ELEMENTS[id];
      let rate = ((id === 'shadow' && !back ? 0 : st[el.inf] || 0) + ((add && add[id]) || 0)) * pow;
      if (!(rate > 0)) continue;
      if (id === 'shadow' && st.abyssDoom && (e.elite || e.boss) && src && src.kind === 'minion') rate *= 2; // Abyssal Hunger
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

  // Chill build-up (chillMul, boss/elite resistance); reaching the threshold freezes a non-boss foe and slows a boss BOSS_CHILL for BOSS_CHILL_T s. Frozen foes gain none.
  W.addChill = function (e, amount, p) {
    if (!(amount > 0) || e.hp <= 0 || e.frozen > 0 || e.def.invuln || e.burrowed) return;
    const st = p ? p.stats : NO_STATS;
    e.chill += amount * (1 + (st.chillMul || 0)) * rankOf(e);
    e.chillT = 1.5;
    if (p) e.chillOwner = p;
    if (e.chill < 100 * (1 + 0.5 * e.freezeRes)) return;
    if (e.boss) { e.chill = 0; this.slowEnemy(e, ED.CONST.BOSS_CHILL, ED.CONST.BOSS_CHILL_T); this.emit({ t: 'nova', x: Math.round(e.x), y: Math.round(e.y), r: Math.round(e.r + 10), c: '#7fe3ff' }); }
    else this.freezeEnemy(e, p);
  };

  // Venom (0-100): amount x (1 + venomBuild) x gauge resistance; moved Venom (a status spread) skips the build bonus. Each gain refreshes the hold and keeps the strongest Caustic (corrode) and Enfeeble (vweak).
  // Effects: the foe deals up to VENOM_WEAK less (hurtPlayer; + vweak at 100), moves up to VENOM_SLOW slower and takes VENOM_DOT x its owner's Power per second at 100 (tickStatuses); at 100 it is Corroded (guard broken, + corrode taken).
  W.addVenom = function (e, amount, p, moved) {
    if (!(amount > 0) || !p || e.hp <= 0 || e.def.invuln || e.burrowed) return;
    const st = p.stats;
    e.venom = Math.min(100, e.venom + amount * (moved ? 1 : 1 + st.venomBuild) * rankOf(e));
    e.venomT = ED.CONST.VENOM_HOLD + st.venomHold;
    e.venomOwner = p;
    if (st.corrode > e.corrode) e.corrode = st.corrode;
    if (st.venomWeak > e.vweak) e.vweak = st.venomWeak;
  };

  // Radiance never decays; a gauge of SMITE_AT x real HP Smites (checkSmite).
  W.addRadiance = function (e, amount, p) {
    if (!(amount > 0) || !p || e.hp <= 0 || e.killed || e.def.invuln || e.burrowed) return;
    e.rad += amount;
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

  // A Smite of stored amount amt on e by o: holy damage, then shields for heroes within HOLY_R of the smitten foe (HOLY_GRANT_MAX per grant, once per HOLY_CD per hero); Beacon strikes the foes within 70.
  // Sunstrike (the Cleric hook CLS.cleric.sunstrike says whether this Smite is one): x sunstrike damage, double shield.
  W.smite = function (e, o, amt) {
    const st = o.stats, C = ED.CONST, big = e.elite || e.boss, sun = st.sunstrike > 0 && CLS.cleric.sunstrike.call(this, e, o);
    const dmg = amt * (1 + st.smiteMul + (big ? st.smiteBig : 0)) * (sun ? st.sunstrike : 1), x = e.x, y = e.y;
    this.hitEnemy(e, dmg, { p: o, kind: 'smite', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy' });
    let n = 0;
    const g = Math.min(C.HOLY_GRANT_MAX, st.smiteShield * (big ? 2 : 1) * (sun ? 2 : 1));
    for (const q of this.players.values()) {
      if (q.downed || q.dead || q.holyT > 0 || U.dist2(q.x, q.y, x, y) > C.HOLY_R * C.HOLY_R) continue;
      this.addShield(q, q.maxHp * g, q.maxHp * st.holyCap, 'holy');
      q.holyT = C.HOLY_CD; n++;
      if (st.guardLight) { q.glV = q.glT > 0 ? Math.max(q.glV, st.guardLight) : st.guardLight; q.glT = C.GL_T; } // Guardian Light: the heroes this Smite shields deal more for GL_T
    }
    this.emit({ t: 'smite', x: Math.round(x), y: Math.round(y), pid: o.pid, n });
    if (e.boss && CLS[o.cls] && CLS[o.cls].smote) CLS[o.cls].smote.call(this, e, o);
    if (st.beacon) {
      const q = this.foeScan(x, y, 70), list = [];
      for (let k = 0; k < q.length; k++) { const f = q[k]; if (f !== e && f.hp > 0 && f.spawnT <= 0 && !f.def.invuln && !f.burrowed && U.dist2(f.x, f.y, x, y) <= (70 + f.r) ** 2) list.push(f); }
      this.foeEnd();
      for (const f of list) this.hitEnemy(f, dmg * st.beacon, { p: o, kind: 'smite', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy' });
    }
    if (e.hp > 0 && st.smiteJudge) e.judged = Math.max(e.judged, st.smiteJudge); // Judging Light
    if (st.smiteBeam) this.queuePayoff(o, { kind: 'beam', e, x, y, amt: dmg * st.smiteBeam, jumps: st.beamJumps }); // Prism
  };

  // Doom (HP units): elites and bosses take DOOM_TOUGH (+ doomTough) of it; never decays. A Reap or Toll may follow at once.
  W.addDoom = function (e, amount, p) {
    if (!(amount > 0) || !p || e.hp <= 0 || e.killed || e.def.invuln || e.burrowed) return;
    const st = p.stats;
    e.doom += amount * (1 + st.doomMul) * (e.elite || e.boss ? ED.CONST.DOOM_TOUGH + st.doomTough : 1);
    e.doomOwner = p;
    if (e.boss) this.checkToll(e); else this.checkReap(e);
  };

  // The health at or below which a foe is Reaped: its Doom.
  W.doomLine = function (e) { return e.doom > 0 ? e.doom : 0; };

  // Reap: a non-boss foe whose health (plus ward) fell to its Doom line (x mul) dies to the Doom owner. Returns whether it was Reaped.
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
    this.hitEnemy(e, d, { p: o, kind: 'toll', raw: true, noProc: true, crit: false, noGuard: true, el: 'shadow' });
    this.emit({ t: 'toll', x: Math.round(e.x), y: Math.round(e.y), pid: o.pid });
    this.onDoomPayoff(o);
    const th = CLS[o.cls];
    if (th && th.toll) th.toll.call(this, o, e, d); // class hook: a Toll of d damage landed on boss e
    if (own) this.curChain = null;
  };

  // Death's Edge: each Reap of a foe that is not fodder (deathPayoffs) or Toll readies deathsEdge crits (up to 3 x deathsEdge).
  W.onDoomPayoff = function (o) { if (o.stats.deathsEdge) this.grantCrits(o, o.stats.deathsEdge, 3 * o.stats.deathsEdge, 'add'); };

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

  // Moves the statuses of foe src onto dst: a share f of its Burn stacks (with their owners and time left) and of each HP pool (Bleed, Charge, Doom, Radiance; dst takes at most SPREAD_CAP of its own max HP per pool), src loses what moved while it lives;
  // and of the Chill and Venom gauges (no build bonus; gauge resistance applies). The receiver keeps each pool's owner; Venom adds the source's corrode and vweak. Frozen is never copied.
  W.moveStatuses = function (src, dst, f) {
    if (!src || !dst || src === dst || dst.hp <= 0 || dst.def.invuln || dst.burrowed || !(f > 0)) return;
    const cap = ED.CONST.SPREAD_CAP * dst.maxHp, live = src.hp > 0;
    let got;
    if (src.burnN > 0) this.copyBurn(src, dst, f, 0, true);
    if (src.bleedPool > 0) { got = Math.min(f * src.bleedPool, cap); if (got > 0) { if (!(dst.bleedPool > 0)) dst.bleedTick = 0.5; dst.bleedPool += got; dst.bleedOwner = src.bleedOwner; if (live) src.bleedPool -= got; } }
    if (src.charge > 0 && src.chargeOwner) { got = Math.min(f * src.charge, cap); if (got > 0) { this.addCharge(dst, got, src.chargeOwner); if (live) src.charge -= got; } }
    if (src.doom > 0) { got = Math.min(f * src.doom, cap); if (got > 0) { dst.doom += got; dst.doomOwner = src.doomOwner; if (live) src.doom -= got; if (dst.boss) this.checkToll(dst); else this.checkReap(dst); } }
    if (src.rad > 0 && dst.hp > 0) { got = Math.min(f * src.rad, cap); if (got > 0) { dst.rad += got; dst.radOwner = src.radOwner; if (live) src.rad -= got; this.checkSmite(dst); } }
    if (src.chill > 0 && dst.hp > 0 && dst.frozen <= 0) { got = Math.min(100, dst.chill + f * src.chill * rankOf(dst)); if (got > dst.chill) { dst.chill = got; dst.chillT = 1.5; dst.chillOwner = src.chillOwner; if (live) src.chill = Math.max(0, src.chill - f * src.chill); } }
    if (src.venom > 0 && dst.hp > 0 && src.venomOwner) {
      const v0 = dst.venom;
      this.addVenom(dst, f * src.venom, src.venomOwner, true);
      if (dst.venom > v0) { if (src.corrode > dst.corrode) dst.corrode = src.corrode; if (src.vweak > dst.vweak) dst.vweak = src.vweak; if (live) src.venom = Math.max(0, src.venom - f * src.venom); }
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

  // ---------------- chain queue: forced payoffs (discharge jumps, status spreads, Cleric Verdict and Prism) ----------------
  // A natural payoff (Smite, Reap, Toll, discharge, a death) opens a chain id (this.curChain); payoffs it spawns queue behind it and inherit the id with hop + 1.
  // Each foe pays out at most once per chain id and kind. Nothing is dropped: a trigger hero runs CHAIN_TICK entries per tick, the rest wait.
  W.openChain = function () {
    if (this.curChain) return false;
    this.curChain = { cid: ++this.chainSeq, hop: 0 };
    return true;
  };

  // True (and marks it) the first time foe e pays out a payoff of this kind in chain cid. spread: a foe that already received a status spread; dis: a foe a discharge already jumped to.
  const PAID = { spread: 256, dis: 512, verdict: 1 << 12, beam: 1 << 13 };
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

  W.runPayoff = function (en) {
    const tr = en.tr, st = tr ? tr.stats : NO_STATS, C = ED.CONST, e = en.e;
    switch (en.kind) {
      case 'dis': // a discharge jumps to a foe the same hero charged
        if (e.hp <= 0 || !(e.charge > 0) || e.chargeOwner !== tr) break;
        this.emit({ t: 'chain', pts: [[Math.round(en.x), Math.round(en.y)], [Math.round(e.x), Math.round(e.y)]] });
        this.discharge(e, tr, en.mul, en.jumps);
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
      case 'verdict': case 'beam': CLS.cleric.payoff.call(this, en); break; // Cleric: Verdict burst, Prism beam
      default: break;
    }
  };

  // Freezes a non-boss foe for 1.6 s x (1 + freezeDur) (elites 0.75 as long); bosses never freeze. Glacier: the frozen foe is solid (world.js separate, solidStops).
  W.freezeEnemy = function (e, p) {
    if (e.boss || e.hp <= 0) return;
    const st = p ? p.stats : NO_STATS;
    e.frozen = 1.6 * (1 + (st.freezeDur || 0)) * (e.elite ? 0.75 : 1);
    e.chill = 0; e.chillT = 0;
    if (e.freezeRes <= 0) e.freezeResT = 6;
    e.freezeRes++;
    e.glacier = !!st.glacier;
    this.emit({ t: 'freeze', x: Math.round(e.x), y: Math.round(e.y) });
  };

  // Shatter (a hero skill hit on a frozen foe): the freeze ends; Shatterpoint bursts shatterSplash of the hit to foes within SHATTER_R (it never shatters again); Cold Cycle takes coldCycle s off every skill cooldown (once per COLD_CD).
  W.shatterBurst = function (e, p, dmg) {
    const st = p.stats, C = ED.CONST, r = C.SHATTER_R;
    e.frozen = 0; e.glacier = false;
    this.emit({ t: 'shatter', x: Math.round(e.x), y: Math.round(e.y), r: st.shatterSplash ? r : 0 });
    if (st.shatterSplash) {
      const q = this.foeScan(e.x, e.y, r), list = [];
      for (let k = 0; k < q.length; k++) { const o = q[k]; if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, e.x, e.y) <= (r + o.r) ** 2) list.push(o); }
      this.foeEnd();
      for (const o of list) this.hitEnemy(o, dmg * st.shatterSplash, { p, kind: 'explode', raw: true, noProc: true, crit: false, noShatter: true, noGuard: true, el: 'ice', x: e.x, y: e.y });
    }
    if (st.coldCycle && this.time >= p.coldT) { p.coldT = this.time + C.COLD_CD; this.refundSkill(p, -1, st.coldCycle); }
  };

  // Per-tick status upkeep: Burn stacks (elements.js tickBurn), Bleed pool, charge hold and fade (tickCharge), Venom damage and decay, chill decay, freeze resistance and thaw, slows (chill, Venom, Neurotoxin) and debuff timers.
  W.tickStatuses = function (e, dt) {
    this.tickBurn(e, dt);
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
    this.tickCharge(e, dt);
    const vo = e.venomOwner, C = ED.CONST;
    if (e.venom > 0) { // every 0.5 s Venom deals VENOM_DOT x its owner's Power x venom / 100 per second; it holds venomT s after the last gain, then fades
      if ((e.venomTick -= dt) <= 0) {
        e.venomTick += 0.5;
        if (vo) this.hitEnemy(e, C.VENOM_DOT * vo.stats.power * e.venom / 100 * 0.5, { p: vo, kind: 'dot', raw: true, noProc: true, crit: false, el: 'poison' });
        if (e.hp <= 0) return;
      }
      if (e.venomT > 0) e.venomT -= dt; else e.venom = Math.max(0, e.venom - C.VENOM_DECAY * dt);
      if (e.venom <= 0) { e.corrode = 0; e.vweak = 0; e.venomTick = 0.5; }
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
    if (e.frozen > 0 && (e.frozen -= dt) <= 0) e.glacier = false; // thaw: no longer solid
    if (e.stun > 0) e.stun -= dt;
    if (e.judged > 0) e.judged -= dt;
    if (e.vulnT > 0) e.vulnT -= dt;
    if (e.blind > 0) e.blind -= dt;
    let slow = (1 - Math.min(0.45, e.chill / 180)) * (1 - C.VENOM_SLOW * e.venom / 100 * (e.boss ? 0.5 : 1)), wind = 1 + e.chill / 220;
    if (e.slowT > 0) { e.slowT -= dt; slow *= 1 - e.slowAmt; } else e.slowAmt = 0;
    if (vo && vo.stats.neuro && e.venom >= 100) wind *= e.boss ? 1.2 : 1.4; // Neurotoxin
    e.slow = slow; e.windMul = wind;
  };

  // Fodder deaths fire no on-death effect (class kill hooks, chains, explosions, spreads, implosions, burning ground, raises): every such effect runs only where this returns true.
  W.onDeathFx = function (e) { return !e.fodder; };

  W.killEnemy = function (e, p, src) {
    if (e.killed) return;
    e.killed = true; e.hp = 0;
    src = src || {};
    const def = e.def, s = this.stratum;
    this.run.kills++;
    if (def.fodder) this.run.fodderKills++;
    if (p) p.kills++;
    this.emit(def.fodder ? { t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: 0, r: e.r, fd: 1 } : { t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: e.elite ? 1 : 0, r: e.r });
    const deathFx = this.onDeathFx(e);
    if (deathFx) this.onEnemyKilledSkill(e, p, src);
    if (def.boss) { this.onBossKilled(e, p, src); return; }
    if (deathFx) this.deathPayoffs(e, p, src);
    if (def.fodder) { this.fodderMote(e.x, e.y); return; } // fodder drop no gold, heart or Grail growth, split or leave a cloud: only the room's xp mote
    if (def.noLoot) return; // boss arena pieces (spore pods and buds) drop nothing
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

  // Payoffs of a non-fodder foe's death: a Reap counts for Death's Edge.
  W.deathPayoffs = function (e, p, src) { if (src.kind === 'reap' && p) this.onDoomPayoff(p); };

  // Called every tick from updatePlayerBuild for a living, standing hero: ring echoes, the element verbs (elements.js updateVerbs) and the dash riders.
  // Dash riders deal Class Power (not weapon damage): foes passed through take power x dashDmg once per dash (Thunderstep charges them by it); Kindle's dash lays burning ground that adds a Burn stack every 0.5 s (Firewall: 1 s longer, foes path around it).
  W.updatePlayerCombat = function (p, dt) {
    const st = p.stats, C = ED.CONST;
    const rq = p.ringQ; // Returning Light echoes of a ring weapon
    if (rq && rq.length) for (let i = 0; i < rq.length;) { const o = rq[i]; o.t -= dt; if (o.t <= 0) { rq.splice(i, 1); this.heroRing(p, o.w, o.co, st.waveReturn); } else i++; }
    const sp2 = p.lvx * p.lvx + p.lvy * p.lvy;
    p.stillT = sp2 < 15 * 15 && !p.dashing ? (p.stillT || 0) + dt : 0;
    this.updateVerbs(p, dt);
    // dash effects (host sees remote dashes through their state reports)
    if (p.dashing) {
      if (this.room.breakables.length) { this.smashSeg(p, p.dashFx < 0 ? p.x : p.dashFx, p.dashFx < 0 ? p.y : p.dashFy, p.x, p.y, p.r, true); p.dashFx = p.x; p.dashFy = p.y; } // the path since the last tick (a dash is no hit: it never rings the Drowned Bell)
      if (st.dashDmg) {
        if (!p.dashHit) p.dashHit = new Set();
        const dmg = st.power * st.dashDmg, add = st.dashCharge ? { lightning: st.dashCharge } : undefined;
        const fq = this.foeScan(p.x, p.y, p.r + 8), met = [];
        for (let k = 0; k < fq.length || this.foeTail(fq); k++) {
          const e = fq[k];
          if (e.hp <= 0 || p.dashHit.has(e.id)) continue;
          if (U.dist2(e.x, e.y, p.x, p.y) < (e.r + p.r + 8) ** 2) { p.dashHit.add(e.id); met.push(e); }
        }
        this.foeEnd();
        for (const e of met) if (e.hp > 0) this.hitEnemy(e, dmg, { p, kind: 'dash', knock: 80, kx: p.dashDx, ky: p.dashDy, infAdd: add });
      }
      if (st.dashFire) {
        p.dashTrail -= dt;
        if (p.dashTrail <= 0) { p.dashTrail = 0.05; this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: C.GROUND_R, dur: C.GROUND_T + (st.firebreak ? 1 : 0), dps: 0, stack: 1, owner: p.pid, team: 0, block: st.firebreak ? 1 : 0 }); }
      }
    } else { p.dashHit = null; p.dashFx = -1; }
  };

  // ---------------- heroes take damage ----------------
  // src: { e (source foe), proj, pr (projectile), hazard, contact (body contact), full (a full-contact attack state), x, y (origin) }
  // A foe attack that meets a dash (or the perfect dodge window after it, or the Hallowed guard from the front) is a perfect dodge (elements.js perfectDodge) for a hero with Holy.
  W.hurtPlayer = function (p, amount, src) {
    src = src || {};
    if (!p || p.downed || p.dead || this.state !== 'play') return false;
    const st = p.stats;
    if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillIfr) { if ((p.dashing || p.dashT > 0) && st.perfectDodge) this.perfectDodge(p, src); return false; }
    if (st.perfectDodge && src.e && !src.hazard) {
      if (p.pdT > 0 && this.perfectDodge(p, src)) return false;
      if (this.guardFront(p, src.e.x, src.e.y) && this.perfectDodge(p, src)) { this.emit({ t: 'block', x: Math.round(p.x), y: Math.round(p.y), k: 'guard' }); return false; }
    }
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
    if (e && e.venom > 0) dmg *= 1 - (ED.CONST.VENOM_WEAK * e.venom / 100 + (e.venom >= 100 ? e.vweak : 0)); // Venom weakens the foe (Enfeeble: more at full Venom)
    if (e && e.smother > 0) dmg *= 1 - e.smother; // Smother: a foe holding 5 of a hero's Burn stacks
    if (e && e.chill > 0 && e.chillOwner) dmg *= 1 - e.chillOwner.stats.chillWeaken;
    dmg = Math.max(1, Math.round(dmg));
    if (e && e.fodder) dmg = Math.max(1, Math.min(dmg, Math.round(ED.CONST.FODDER_CAP * p.maxHp))); // fodder touches never exceed FODDER_CAP of max health (before the shield)
    if (p.shield > 0) {
      const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab;
      const hc = CLS[p.cls];
      if (hc && hc.absorb) hc.absorb.call(this, p, ab, src);
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
    if (p.hp <= 0) this.playerLethal(p);
    return true;
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
    const ev = { t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r), k: look || 'fire' };
    if (team === 0 && !(opts && opts.part)) ev.q = opts && opts.wpn ? 2 : 1; // a hero blast that is not a class-skill part, drawn quieter by the viewer: q 1 a proc (boon, relic, evolution), q 2 a weapon blast
    this.emit(ev);
  };

  // ---------------- hero attacks ----------------
  // twinMul > 0: a repeat of the last attack (weapon part only, scaled by twinMul: the Shade's mirror images).
  // A Knight with Oath of Steel swings a Cleave every (3 + cleaveN)th attack and on the first swing after a Charge with Follow-Through (o.cleave = its damage bonus); the class hook attackOpts adds per-hit options to every weapon hit, attack runs after the attack.
  // k: the combo step of a combo weapon as the attacker's own control decided it (ED.Stats.comboNext; anything else is decided here); a repeat (twinMul) uses the step of the last attack.
  // fin: the Finisher (the General keystone's released hold): a guaranteed crit at FIN_MUL x that Bleeds for 50% of the hit, melee reach + FIN_REACH. Umbral Arms (p.behindT) makes the attack crit; Divine Riposte (p.pdStrikeT) makes its hits Smite.
  W.playerAttack = function (p, a, twinMul, k, fin) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, wb = st.weapon, ch = CLS[p.cls], C = ED.CONST;
    if (wb.kind === 'bell') { if (ch && ch.weaponAttack && !(twinMul > 0)) ch.weaponAttack.call(this, p, a); return; } // a chained bell is not swung: the class file hauls it (class-bell.js)
    if (wb.combo && !(twinMul > 0)) { p.comboK = k === (k | 0) && k >= 0 && k < wb.combo.steps.length ? k : ED.Stats.comboNext(p, this.time); p.comboAt = this.time; }
    const w = wb.combo ? ED.Stats.stepWeapon(st, p.comboK | 0) : wb;
    if (twinMul > 0) {
      const o = { mul: twinMul, twin: true };
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
      if (ch && ch.ambush) ch.ambush.call(this, p, st); // class hook: an Ambush attack starts
    }
    if (fin) { crit = true; amb = Object.assign({}, amb, { mul: ((amb && amb.mul) || 1) * C.FIN_MUL, bleedMin: 0.5, reach: C.FIN_REACH }); this.emit({ t: 'finisher', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), a: Math.round(a * 100) / 100 }); }
    if (p.behindT > this.time) { p.behindT = -99; crit = true; } // Umbral Arms
    if (p.pdStrikeT > this.time) { p.pdStrikeT = -99; amb = Object.assign({}, amb, { smite: true }); } // Divine Riposte
    if (st.cleave > 0 && w.kind === 'melee') {
      const follow = this.time < p.cleaveNext;
      if (follow || p.atkCount % (3 + st.cleaveN) === 0) { amb = Object.assign({}, amb, { cleave: st.cleave + (follow ? st.chargeCleave : 0) }); p.cleaveNext = 0; }
    }
    const co = ch && ch.attackOpts ? ch.attackOpts.call(this, p, st) : null;
    const base = co ? Object.assign({}, co, amb, co.mul && amb && amb.mul ? { mul: co.mul * amb.mul } : null) : amb; // a class mul (Grave swing) and an attack mul (Masterstroke, Ambush) multiply
    const reps = st.twinEvery && p.atkCount % st.twinEvery === 0 ? 2 : 1;
    for (let rep = 0; rep < reps; rep++) {
      const o = rep === 0 ? base : co;
      if (w.kind === 'melee') this.meleeSwing(p, a + rep * 0.18, w, crit, rep, o);
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
    if (ch && ch.attack) ch.attack.call(this, p, a, st, w);
    this.emit({ t: 'atk', pid: p.pid, a: Math.round(a * 100) / 100, n: p.atkCount });
  };

  // Masterwork Arms on one landed weapon hit or bell strike of p on foe e (src after hitEnemy: critOut set): a crit's spectral strike on e at 60%, unless src.specDone (a swing or shot whose own spectral repeat handles it). Bellwarden strikes call it from class-bell.js.
  W.evoHit = function (p, e, a, src) {
    const st = p.stats;
    if (st.evo !== 'general' || src.twin || src.spectral || !src.critOut || src.specDone || e.hp <= 0) return;
    this.hitEnemy(e, st.weapon.dmg, { p, kind: 'evo', mul: 0.6 * (src.mul || 1), spectral: true, knock: 0, x: p.x, y: p.y });
  };

  // o: { mul (extra damage multiplier), ambush, spectral, twin, infAdd, bleedMin, cleave (Cleave damage bonus), reach (extra reach share: the Finisher), smite (Divine Riposte) }
  // A Cleave reaches and sweeps 40% further, knocks back twice as hard, parries a foe in the last moments of its wind-up (Sworn Blade) and cracks the ground with Oathbreaker's shock.
  // w.ahead: the swing is a slam circle (radius ahead.r, a Cleave's 40% larger) centred `reach` px along the aim; w.pull: a hit drags the foe toward the hero instead of knocking it back (elites half, bosses never).
  // Masterwork Arms: each landed hit runs W.evoHit.
  W.meleeSwing = function (p, a, w, crit, rep, o) {
    o = o || {};
    const st = p.stats, cl = o.cleave > 0, wpn = !o.twin && !o.spectral, evo = evoOf(p), spec = evo === 'general';
    const reach = w.range * (1 + st.area * 0.5 + st.meleeReach + (o.reach || 0)) * (cl ? 1.4 : 1);
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
      const hs = { p, kind: 'weapon', wpn, part: cl ? 'cleave' : undefined, crit, mul: mul === 1 ? undefined : mul, ambush: o.ambush, infAdd: o.infAdd, bleedMin: o.bleedMin, smite: o.smite, twin: o.twin, spectral: o.spectral, specDone: spec, knock: w.pull ? 0 : cl ? w.knock * 2 : w.knock, kx: Math.cos(ang), ky: Math.sin(ang) };
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

  // Weapon shots of one attack: n = w.n + projN in a fan (beams and lobbed shells their own way); a shot's landed hits run W.evoHit.
  W.fireWeapon = function (p, a, w, crit, o) {
    o = o || {};
    const st = p.stats, evo = evoOf(p), area = 1 + st.area * 0.5;
    const n = w.n + st.projN;
    const sp = n > 1 ? Math.max(w.spread || 0, 0.13) : 0;
    const ex = w.explode ? { r: w.explode.r * area * (o.blastMul || 1), mul: w.explode.mul } : null; // o.blastMul / o.pierce: per-attack options of a class hook (attackOpts)
    const wpn = !o.twin && !o.spectral, spec = evo === 'general' && wpn;
    for (let i = 0; i < n; i++) {
      const ang = a + (i - (n - 1) / 2) * sp + (w.jitter ? this.rng.range(-w.jitter, w.jitter) : 0);
      if (w.beam) { this.fireBeam(p, ang, w, crit, o, ex, spec && i === 0, wpn); continue; }
      if (w.lob) { this.lobShot(p, ang, w, crit, o, ex, wpn); continue; }
      this.spawnProj(Object.assign({
        team: 0, kind: w.proj, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed: w.speed, r: w.r,
        dmg: w.dmg, life: w.life, pierce: w.pierce + st.pierce + (o.pierce || 0), owner: p.pid, crit, knock: w.knock || 40, mul: o.mul, ambush: o.ambush, smite: o.smite, spec, wpn, twin: o.twin,
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
  // A hit's source carries dist (the foe's distance along the beam) and pass (foes struck before it). The beam's blast (ex) and a crit's spectral strike (60% on the same foe) land at the last foe struck, else at the beam's end; Masterwork Arms: W.evoHit per hit.
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
      const hs = { p: owner, kind: 'weapon', crit, mul: o.mul, ambush: o.ambush, smite: o.smite, twin: o.twin, spectral: o.spectral, specDone: spec, knock: w.knock || 40, kx: ca, ky: sa, burn: w.burn || 0, infAdd: o.infAdd, bleedMin: o.bleedMin, x: x0, y: y0, wpn, dist: Math.max(0, on[i].t), pass: i };
      this.hitEnemy(e, w.dmg, hs);
      if (spec && hs.critOut && e.hp > 0) this.hitEnemy(e, w.dmg, { p: owner, kind: 'evo', mul: 0.6 * (o.mul || 1), knock: 0, x: x0, y: y0 });
      if (evo && wpn) this.evoHit(p, e, ang, hs);
      bx = e.x; by = e.y;
      if (hs.guarded) { cut = Math.max(0, on[i].t); break; }
    }
    this.smashSeg(p, x0, y0, x0 + ca * cut, y0 + sa * cut, hw);
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
    const shot = { owner: p.pid, kind: w.proj, dmg: w.dmg, mul: o.mul || 0, explode: ex || { r, mul: 1 }, wpn, infAdd: o.infAdd || null, crit, smite: o.smite, knock: w.knock || 40, lob: true, dist: flown };
    this.addZone({ kind: 'tele', x: g.x, y: g.y, r, dur: w.lob.t, team: 0, owner: p.pid, custom: true, lob: [Math.round(p.x), Math.round(p.y - 10)],
      onEnd: (world, z) => {
        if (z.room !== world.room) return;
        shot.x = z.x; shot.y = z.y; world.projBurst(shot);
      }, room: this.room });
  };

  // blink: the hero's client stepped behind a foe first (Umbral Arms); ox, oy: where the dash began on the client (a blink moves the hero before the dash).
  W.playerDash = function (p, dx, dy, blink, ox, oy) {
    if (!p || p.downed || p.dead) return;
    p.dashDx = dx; p.dashDy = dy;
    this.onDashVerbs(p, blink, ox, oy);
    if (p.stats.dashBomb) this.addZone({ kind: 'bomb', x: p.x, y: p.y, r: 60, dur: 0.6, team: 0, owner: p.pid, dmg: ED.procDmg(ED.RELICS.satchel, p.stats) });
    this.emit({ t: 'dash', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
  };

  // ---------------- projectiles ----------------
  // o.hk: hit kind for hitEnemy; o.mul/o.ambush: extra multiplier; o.spec: crits release a spectral copy; o.shieldAlly: shield fraction an ally gets on touch (Sacred Lantern);
  // o.infAdd / o.bleedMin: per-hit infusion rates and Bleed share; o.twin: a mirror-image repeat (no evolution behaviour); o.el: the element its hits carry; o.freeze: its hits freeze non-boss foes (Glacial Arms); o.smite: its hits Smite (Divine Riposte).
  // o.wpn: a weapon shot (its hits are weapon hits); o.part: the skill part its hits belong to; o.ghost: moved and removed by its owner's code (thrown shield: pr.dead removes it); o.infK: infusion scale of its hits;
  // o.stun: seconds of repeating stun on a hit (waves); pr.dist = distance flown (every hero shot) and pr.pass = foes passed; o.homeCone (radians, with o.homing): the shot steers only toward foes within homeCone of o.homeA0 and never turns past it; o.noSplit: reserved for class routes.
  // o.ret / o.out / o.trail / o.pool: the flight shape of W.shotShape (pr.ret 1 = out leg, 2 = flying back).
  W.spawnProj = function (o) {
    const pr = {
      id: U.uid(), team: o.team, kind: o.kind, x: o.x, y: o.y, vx: Math.cos(o.a) * o.speed, vy: Math.sin(o.a) * o.speed,
      r: o.r || 5, dmg: o.dmg || 1, life: o.life || 2, pierce: o.pierce || 0, owner: o.owner, src: o.src || null,
      crit: o.crit, knock: o.knock || 0, explode: o.explode || null, cloud: o.cloud || null, homing: o.homing || 0,
      shieldAlly: o.shieldAlly || 0, burn: o.burn || 0, hit: null, healed: null, accel: o.accel || 0, turn: o.turn || 0, boom: o.boom || null,
      hk: o.hk || null, mul: o.mul || 0, ambush: !!o.ambush, spec: !!o.spec, infAdd: o.infAdd || null, bleedMin: o.bleedMin || 0, twin: !!o.twin, el: o.el || null, freeze: !!o.freeze, smite: !!o.smite,
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
        if (pr.team === 0) { this.projDrop(pr, pr.x - pr.vx * dt, pr.y - pr.vy * dt); this.projEnd(pr, 'wall'); if (this.room.arena) this.wallCircle(this.players.get(pr.owner), pr.x, pr.y, pr.r + 4); } // a boss wall block takes the shot (arena.js)
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
          const hs = { p: owner, kind: pr.hk || 'weapon', crit: pr.crit, mul: pr.mul, ambush: pr.ambush, knock: pr.knock, kx: pr.vx / sp, ky: pr.vy / sp, burn: pr.burn, infAdd: pr.infAdd, infK: pr.infK, bleedMin: pr.bleedMin, x: pr.x, y: pr.y, wpn: pr.wpn, part: pr.part, dist: pr.dist, pass: pr.pass, el: pr.el || undefined, smite: pr.smite, twin: pr.twin, specDone: pr.spec };
          this.hitEnemy(e, pr.dmg, hs);
          if (pr.freeze && e.hp > 0) this.freezeEnemy(e, owner);
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
        if (this.solidOn && this.solidStops(pr)) { this.emit({ t: 'spark', x: Math.round(pr.x), y: Math.round(pr.y), k: ED.PROJ_IDX[pr.kind] || 0 }); continue; } // Glacier foes and ice walls stop foe shots
        for (const p of this.players.values()) {
          if (p.downed || p.dead) continue;
          const rr = p.r + pr.r - 3;
          if (U.dist2(pr.x, pr.y, p.x, p.y) > rr * rr) continue;
          if (this.guardFront(p, pr.x, pr.y)) { this.reflectShot(p, pr); if (pr.src) this.perfectDodge(p, { e: pr.src, proj: true }); dead = true; break; } // the Hallowed guard reflects it
          if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillIfr) { if ((p.dashing || p.dashT > 0) && pr.src && p.stats.perfectDodge) this.perfectDodge(p, { e: pr.src, proj: true }); continue; } // shots pass through i-frames; a dash through one is a perfect dodge
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

  // True when foe shot pr touches a solid: a frozen Glacier foe (not its own shooter) or a solid zone (a segment of z.len along z.a, z.w wide: Glacier Step's wall; else a disc of z.sr or z.r).
  W.solidStops = function (pr) {
    for (const z of this.zones) if (z.solid && !z.dead && (z.len > 0 ? U.segDist2(pr.x, pr.y, z.x, z.y, z.x + Math.cos(z.a) * z.len, z.y + Math.sin(z.a) * z.len) < (z.w / 2 + pr.r) ** 2 : U.dist2(z.x, z.y, pr.x, pr.y) < ((z.sr || z.r) + pr.r) ** 2)) return true;
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
              if (owner && z.stack) this.burnStack(e, owner); // burning ground: a Burn stack per tick
              if (owner && z.venom) this.addVenom(e, z.venom, owner); // a toxic cloud: Venom per tick
              if (dps > 0) this.hitEnemy(e, dps * 0.5, { p: owner, kind: 'dot', noProc: true, crit: false, el, clsEl: z.clsEl, wpn: z.wpn, part: z.part, zone: zk });
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
    if (!e.exposed && !e.def.invuln && !e.fodder && !e.def.noLoot && this.enc && e.age > (e.boss ? 78 : 45) && !(e.boss && ED.World.furyAt(this.stratum) > 0)) { e.exposed = true; this.emit({ t: 'expose', x: e.x, y: e.y, boss: e.boss ? 1 : 0 }); } // a boss of a fury stratum is never exposed (fury ends its stalls)
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
    this.turnFoe(e, dt);
    // contact damage: full only during body-hit attack states, otherwise 0.4x; a hero takes at most one fodder touch per World.FODDER_TOUCH_CD (p.fodderAt: world time of the next allowed one)
    if (e.contactCd <= 0 && e.def.ai !== 'bomber' && !e.burrowed) {
      for (const p of this.players.values()) {
        if (p.downed || p.dead) continue;
        const rr = e.r + p.r - 3;
        if (U.dist2(e.x, e.y, p.x, p.y) < rr * rr) {
          if (e.fodder && p.fodderAt > this.time) break;
          const full = FULL_CONTACT.has(e.st);
          if (this.hurtPlayer(p, e.dmg * (full ? 1 : 0.4) * (e.boss ? 0.8 : 1), { e, x: e.x, y: e.y, contact: true, full })) { e.contactCd = 1.0; e.recoil = 0.35; if (e.fodder) p.fodderAt = this.time + ED.World.FODDER_TOUCH_CD; }
          break;
        }
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
