// Bot card choice by marginal value (tools/sim.js --pick=smart). Factory: require('./pick.js')(ED, model) with model = require('./model.js')(ED).
// Value of a hero build: V = sum over the strata t = s, s+1, s+2 (weights 0.5 / 0.3 / 0.2, capped at IV) of w_t (ln D_t + lambda_t ln E_t) + bonus, where D_t = sqrt(damage on one foe x damage on a pack) at stratum t
// (ED.Sheet.compute through the model), E = effective health and bonus = the meta stats (gold, experience, offers).
// lambda_t (setLambda, --lambda=<x>|auto[:<x0>]): a fixed x for every stratum, or auto = x0 times the foe damage lever of stratum t over LEVER_REF, read from the live World.THREAT, World.dmgScale, biome rosters and boss damage (a harder table raises the weight of effective health).
// The sheet leaves many mechanics out; fold() adds them from the stat block (formulas below, assumptions in the constants) so a card's value follows the build it joins.
// Gain(card) = V(after) - V(before) + F(after) - F(before) + X(card); F = discounted value of the milestones a card brings closer (keystone, evolution), X = a flat prior for effects with no stat plus the path calibration PATH_CAL.
// Deterministic: no Math.random; ties break on the bot rng passed in.
module.exports = (ED, model) => {
  const C = ED.CONST, St = ED.Stats, PACK = model.pack;

  // ---------------- constants ----------------
  const W_STRATA = [0.5, 0.3, 0.2]; // weights of strata s, s+1, s+2
  const LAMBDA = 2; // default weight of ln effective health against ln damage (fixed mode)
  const LEVER_HIT = 0.1; // auto mode: lambda_t = x0 when a typical foe or boss hit of stratum t takes this share of a hero's base max health (mean over the classes)
  const GAMMA = 0.75; // discount per rank still missing to a milestone
  const MIN_TERM = 0.1; // a milestone discounted below this share of its gain is dropped (speed)
  const PICKS_RUN = 32, FEASIBLE = 0.6; // picks in a run; a milestone is worth nothing when it needs more than this share of the picks left
  const REROLL_MIN = 0.01; // best gain below this: reroll when a reroll is left
  const RELIC_HALF = 0.1; // relic gain that scores 0.5 in relicValue
  const T_ONE = 30, RES_ONE = 0.5, RES_BOSS = 0.35; // a single big foe: engagement seconds and gauge resistance (elite 0.7, boss 0.35); freezes use the boss value
  const POOL_EFF = 0.6; // share of the ideal status damage on every foe of a pack that lands (overkill, spread-out foes)
  const T_FOE_MIN = 1.5, T_FOE_MAX = 10; // life of a foe in a pack under the hero's pack damage
  const DASH_USE = { melee: 0.5, ranged: 0.2 }; // share of dash cooldowns spent dashing through foes (Bomb Satchel)
  const TRANCE_T = 4; // Battle Trance seconds per skill cast
  const ECHO_EXTRA = 0.3; // extra casts of skill 1 per cooldown from a second charge
  const FROZEN_FOE = 0.7; // share of its damage a frozen foe does not deal (it cannot act, shots already flying); a chilled foe is slowed (SLOW_RED) and 'chillWeaken' weaker
  const SLOW_RED = 0.12;
  const STUN_RED = 0.7; // damage a stunned foe does not deal while stunned (it recovers, some attacks already thrown)
  const E_MAX_RED = 0.35; // largest share of incoming damage the controlled foes can remove
  const REACH = 0.5; // guess: share of the damage a hero takes from foes its statuses have reached (fresh spawns, shots in flight and boss adds are not yet controlled)

  // Cards and relics the sheet leaves at zero, one line each. Fold = a formula in fold() from the stat block (D damage, E effective health, bonus = meta value); Prior = a flat value in PRIOR; Sheet = the sheet models it
  // (a hold verb: the weapon's hold model, tools/model.js takes it where it beats the attacks). "guess" marks a coefficient no bot run has measured. Relics follow the boons.
  //   lightstep    Fold  dashN (0.08 each) -> E
  //   purse        Prior PURSE_X (a gold room's gold; guess)
  //   wide         Fold  area -> pack damage (melee more)
  //   echo         Fold  extra casts of skill 1 (ECHO_EXTRA)
  //   laststand    Fold  guardian -> E
  //   trance       Fold  attack speed for 4 s after a cast on the weapon share, capped by the attack floor
  //   generalist keen brutal lacerate execute deepcuts  Sheet crit, Bleed, conditional rows
  //   heartseeker  Fold  crit damage on elites and bosses -> single-target damage
  //   killingedge  Prior general 0.03 (a crit kill readies a crit; guess)
  //   sunder       Fold  crit chance x hits per second -> stacks of +4% damage taken (10 stacks)
  //   masterstroke evo_general  Sheet hold (finisher); evo_general strikes (Spectral strike)
  //   kindle stoke kindling fanflames backdraft  Sheet Burn estimate, death bursts in a pack
  //   wildfire     Fold  pack Burn x (1 + wildfire x WILD_K; guess)
  //   smother      Fold  E: REACH x smother x the share of a foe's time at SMOTHER_AT stacks
  //   emberheart   Fold  E: REACH x pyreWeak x PYRE_UP (share of pack foes hit by a death burst lately; guess)
  //   scorched     Prior fire 0.05 (burning ground on death bursts; guess)
  //   evo_fire     Sheet hold (flame cone); Fold Burn x CONE_UP while channeling (guess)
  //   frostbite deepcold shatterpoint wintersheart  Sheet Shatter estimate, splash in a pack; Fold freeze share of pack foe time (bosses never freeze) -> E
  //   permafrost   Fold  chilled foes deal less -> E
  //   glacier      Fold  E x (1 + GLACIER_E x min(freeze share, 1 - freeze share)) (guess)
  //   coldcycle    Fold  Shatters a second x coldCycle off the cooldowns (one per COLD_CD) -> skill damage
  //   absolutezero Prior ice 0.05 (a Shatter freezes the foes round it; guess)
  //   rimebite     Sheet conditional row (chilled)
  //   evo_ice      Sheet hold (ice lance); Fold E x (1 + LANCE_E) (freezes; guess)
  //   staticcharge highvoltage capacitor  Sheet discharge estimate
  //   conductor    Fold  pack discharges x (1 + jumps x JUMP_K; guess)
  //   overload     Fold  arcStun -> stun share -> E, Opportunist
  //   grounding    Fold  E: REACH x ground x CHARGED_UP (guess)
  //   longfuse     Sheet (charge hold)
  //   galvanize    Sheet conditional row (charged)
  //   arcflash     Sheet Arc Flash in a pack
  //   evo_lightning Sheet hold (storm call)
  //   cross cards (thermal plasma supercon searing icebreaker stormblade)  Prior CROSS_X each (guess)
  //   b_* (Bellwarden routes)  Sheet and the Fold terms below
  //   boots        Fold  spd -> E          coin      Fold gold, luck -> bonus     lodestone Fold xp -> bonus     pauldron Fold thorns -> E    phoenix Fold revive -> E
  //   elixir       Fold  strataHeal, heal  satchel   Fold dash bomb               lantern   Fold xp, light       seeker   Fold homing, reach  mirror  Fold shrug -> E
  //   crown        Fold  choices -> bonus  angel     Fold extra life -> E         chalice   Fold growth -> E     ledger   Fold discount       clover  Fold rerolls, luck   aegis Fold block -> E
  // Flat priors in ln-V units (0.10 = about +10% damage); zero unless the element is active.
  const CROSS_X = 0.04;
  const PRIOR = {
    killingedge: ['general', 0.03], // guess: a crit kill readies a crit
    scorched: ['fire', 0.05], // guess: burning ground where death bursts land
    absolutezero: ['ice', 0.05], // guess: a Shatter freezes the foes round it
    thermal: ['ice', CROSS_X], plasma: ['lightning', CROSS_X], supercon: ['lightning', CROSS_X], searing: ['fire', CROSS_X], icebreaker: ['ice', CROSS_X], stormblade: ['lightning', CROSS_X],
  };
  // Path calibration (ln-V units) on every card of a path (gate, pool, keystone, evolution): the fold's error per path, to fit on bot batches so smart bots take each of the 4 paths as main path in a fair share of runs (not fitted yet).
  const PATH_CAL = { general: 0, fire: 0, ice: 0, lightning: 0 };
  const PURSE_X = 0.01; // guess: the Purse's gold, a gold room's reward
  // Path terms the sheet leaves out (guesses): GLACIER_E E per pack freeze share; HEAL_E: E per max HP healed a stratum; WILD_K pack Burn per Wildfire stack; CONE_UP Burn factor of a channel;
  // JUMP_K pack discharge per extra jump; PYRE_UP share of pack foes under Ember Heart; CHARGED_UP share of foes holding the hero's charge; LANCE_E E of the lance's freezes.
  const GLACIER_E = 0.3, HEAL_E = 0.08, WILD_K = 0.8, CONE_UP = 1.5, JUMP_K = 0.15, PYRE_UP = 0.4, CHARGED_UP = 0.6, LANCE_E = 0.05;
  // Bellwarden terms (guesses): FULLR_K pack weapon damage per unit of Full Swing impact width; CARRY_K per 40 px of Unstoppable carry (struck foes bunch into the impact); SLIP_WIND share of a fight spent winding;
  // LEAP_E E per unit of hand-leap reach; WRECK_SAVE share of a loop's wind-up a Wrecker landing saves; IFR_HIT share of untouchable seconds that dodge a hit; PULL_N extra pack foes a Reel In slam strikes.
  const FULLR_K = 0.3, CARRY_K = 0.05, SLIP_WIND = 0.6, LEAP_E = 0.04, WRECK_SAVE = 0.5, IFR_HIT = 0.4, PULL_N = 1;
  const PRESENT_EL = (st, el) => st[ED.ELEMENTS[el].inf] > 0 || st.element === el; // an element is active: an infusion above 0 or the class element

  // ---------------- index of the path cards ----------------
  const KEY_OF = {}, POOL_OF = {};
  for (const k of ED.PATH_IDS) POOL_OF[k] = [];
  for (const id of ED.BOON_IDS) {
    const b = ED.BOONS[id];
    if (b.key) KEY_OF[b.path] = id;
    else if (b.path && !b.gate && !b.evo && !b.open && !b.retired) POOL_OF[b.path].push(id); // retired cards are never offered
  }

  // ---------------- helpers ----------------
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const ln = Math.log;
  // Mean of min(cap, g t) over [0, T]: the average level of a gauge that fills at g per second.
  const meanRamp = (g, T, cap) => { if (!(g > 0) || !(T > 0)) return 0; const tc = cap / g; return tc >= T ? g * T / 2 : cap - cap * tc / (2 * T); };

  // ---------------- what the sheet leaves out ----------------
  // a: model.assess result at the stratum of ctx. Returns { one, pack, ehp, bonus }: damage per second on one foe and on a pack, effective health, additive value of the meta stats.
  function fold(p, a, ctx) {
    const st = p.stats, m = a.m, k = a.k, ref = m.ref, t = ctx.stratum, bell = st.kind === 'bell', melee = !!st.melee || bell, wk = m.weapon, aps = wk._aps;
    const sdTot = model.statusDamage(m), dOne = a.one - sdTot, dPack = a.pack - sdTot;
    const spk = 1 + (clamp(dPack / Math.max(1e-9, dOne), 1, PACK) - 1) * POOL_EFF; // a status builds on every foe the hits reach
    const sd = { fire: 0, ice: 0, lightning: 0, holy: 0, general: 0 };
    const streamed = { general: st.bleed > 0, fire: st.pyre > 0, ice: st.iceInfuse > 0, lightning: st.lightningInfuse > 0 }; // a path engine whose pack streams the sheet already holds (sheet.js pathPack)
    const pk = (el) => (streamed[el] ? 1 : spk);
    for (const s of m.mult.status) if (sd[s.el] !== undefined) sd[s.el] = (s.est && s.est.dps) || 0;
    const feed = m.proc.dps / Math.max(1e-9, model.directDamage(m, 1)); // share of the hero's damage that builds statuses
    const pf = clamp(a.pack / PACK / Math.max(1e-9, a.one), 0.1, 1); // damage each foe of a pack gets, against the same hero's single target
    const tFoe = clamp(ref.hp / Math.max(1e-9, a.pack / PACK), T_FOE_MIN, T_FOE_MAX); // life of a pack foe
    const pow = 1 + st.statusPow;
    let add1 = 0, addN = 0, mul1 = 1, mulN = 1, eMul = 1, bonus = 0;
    let light1 = sd.lightning, fire1 = sd.fire, holy1 = sd.holy, ice1 = sd.ice;
    const casts = m.skills.reduce((s, q) => s + 1 / q._cd, 0); // skill casts a second
    const wShare = m.proc.dps > 0 ? m.proc.split.weapon / m.proc.dps : 1; // share of the status build-up the weapon feeds
    const wOne = wk.dps * (wk._up === undefined ? 1 : wk._up) * k, wN = model.packWeapon(m, PACK) * k; // weapon damage on one foe and on a pack
    const skOne = m.skills.reduce((s, q) => s + q.dpsCd, 0) * k, skN = Math.max(0, model.directDamage(m, PACK) - model.packWeapon(m, PACK) * (1 + (m.boost ? m.boost.pack : 0))) * k; // skill damage on one foe and on a pack
    const dashUse = (melee ? DASH_USE.melee : DASH_USE.ranged) / Math.max(0.5, m.dash.cd); // dashes through foes a second

    // Storm: extra jumps carry discharges further through a pack; Grounding weakens charged foes
    let lightN = light1 * pk('lightning');
    if (light1 > 0 && st.jumps) lightN *= 1 + st.jumps * JUMP_K;
    if (light1 > 0 && st.ground) eMul /= 1 - Math.min(E_MAX_RED, REACH * st.ground * CHARGED_UP);
    const holyN = holy1 * spk;
    // Flame: Wildfire passes stacks to touching foes; Smother weakens foes at SMOTHER_AT stacks; Ember Heart weakens foes a death burst hits; the flame cone burns at x CONE_BURN
    if (st.hold === 'cone') fire1 *= CONE_UP;
    let fireN = fire1 * pk('fire');
    if (st.wildfire) fireN *= 1 + st.wildfire * WILD_K;
    if (st.smother) eMul /= 1 - Math.min(E_MAX_RED, REACH * st.smother * clamp(fire1 / Math.max(1e-9, ED.burnValue(st) * C.SMOTHER_AT), 0, 1));
    if (st.pyreWeak && st.pyre) eMul /= 1 - Math.min(E_MAX_RED, REACH * st.pyreWeak * PYRE_UP);
    // Steel: Heartseeker's crit damage on elites and bosses (the single target)
    if (st.critBig) mul1 *= 1 + st.crit * st.critBig / (1 + st.crit * Math.max(0, st.critMult - 1));
    const stOne = fire1 + light1 + holy1 + ice1 + sd.general, stN = fireN + lightN + holyN + ice1 * pk('ice') + sd.general * pk('general');

    // Battle Trance: attack speed during the 4 s after a skill cast, on the weapon's damage and the statuses it feeds
    if (st.trance) {
      const rate0 = St.attackRate(p), up = Math.min(1, TRANCE_T * casts), apsOn = Math.min(1 / st.atkFloor, aps * (rate0 + st.trance) / rate0), f = up * (apsOn / aps - 1);
      add1 += (wk.dps * k + stOne * wShare) * f;
      addN += (wN + stN * wShare) * f;
    }
    // Echo: a second charge of skill 1 is extra casts
    if (st.charges > 0 && m.skills[0]) { const e1 = m.skills[0].dpsCd * k * ECHO_EXTRA; add1 += e1; addN += e1 * spk; }
    // dash riders: damage per dash, a share of the cooldowns
    if (m.dash.parts.length) {
      let d1 = 0, dN = 0;
      for (const q of m.dash.parts) {
        if (!(q.dmg > 0)) continue;
        if (q.label === 'Dash hit') { d1 += q.dmg; dN += q.dmg * Math.min(PACK, 2); }
        else if (q.label === 'Bomb') { d1 += q.dmg; dN += q.dmg * Math.min(PACK, 3); }
      }
      add1 += d1 * dashUse; addN += dN * dashUse;
    }
    // Sunder: crits stack +4% damage taken (up to 10 stacks); a crit adds min(2, 60 x its share of the foe's health) stacks
    if (st.sunder) {
      const hps = aps * wk.oneFoe, per = Math.min(2, 60 * (wk._hit * st.critMult) / Math.max(1, ref.statusHp)), g = st.crit * hps * per;
      mul1 *= 1 + 0.04 * meanRamp(g, T_ONE, 10);
      mulN *= 1 + 0.04 * meanRamp(g * pf, tFoe, 10);
    }
    // Chill and freeze: frozen foes do nothing, chilled foes are slow; bosses never freeze (a full gauge slows them BOSS_CHILL). Shatter damage is in the sheet; Cold Cycle cuts the cooldowns per Shatter; Glacier walls the pack.
    if (st.iceInfuse > 0 && m.proc.rate.ice > 0) {
      const cr = m.proc.rate.ice / ref.statusHp * C.CHILL_K * (1 + st.chillMul), T = tFoe, df = 1.6 * (1 + st.freezeDur);
      const frz = (c, tm, dfr) => { const tf = 100 / Math.max(1e-9, c); return clamp(tm - tf, 0, tm) / tm * dfr / (dfr + 1.5 * tf); }; // share of a foe's time spent frozen
      const fT = frz(cr * pf, T, df), fE = 0.5 * frz(cr * RES_ONE, T_ONE, 0.75 * df); // a big foe is an elite half the time (it freezes), a boss the rest (it never does)
      const chT = clamp(cr * pf * T / 100, 0, 1) * (1 - fT), chB = clamp(cr * RES_BOSS * T_ONE / 100, 0, 1);
      if (st.coldCycle && st.shatter) { const cut = Math.min(0.5, Math.min(1 / C.COLD_CD, casts * fT * PACK) * st.coldCycle * 0.5); add1 += skOne * cut * fE; addN += skN * cut; }
      if (st.glacier) eMul *= 1 + GLACIER_E * Math.min(fT, 1 - fT);
      const red = REACH * clamp(0.6 * (fT * FROZEN_FOE + chT * (SLOW_RED + st.chillWeaken)) + 0.4 * (chB * (SLOW_RED * (1 + C.BOSS_CHILL) + st.chillWeaken)), 0, E_MAX_RED);
      eMul /= 1 - red;
    }
    if (st.hold === 'lance') eMul *= 1 + LANCE_E;
    // Overload and the other stuns beyond the class's own: Opportunist pays +25% on stunned foes; stunned foes do no damage
    if (st.arcStun > 0 && light1 > 0) {
      const up = Math.min(1, st.arcStun / Math.max(1, st.arcStun + 0.75)) * 0.7;
      eMul /= 1 - Math.min(E_MAX_RED, REACH * up * STUN_RED);
      if (st.opportunist) { mul1 *= 1 + st.opportunist * up * 0.5; mulN *= 1 + st.opportunist * up; }
    }
    // Holy shield: the Smite shield refills to its cap; Sanctity raises the cap and the grant
    if (st.holyInfuse > 0 || st.element === 'holy') eMul *= 1 + (st.holyCap - 0.06) * 0.6 + (st.smiteShield - 0.01) * 6;
    // Bellwarden: Full Swing's wider impact, Unstoppable's carry, Wrecker's wound landing, Reel In's pull; Slipstream, the farther hand leap and Tether Hook's untouchable time -> E
    if (bell) {
      const cy = ED.Bell.cycle(st, 1, St.attackInterval(p), ED.Bell.rateGain(p)), lp = m.skills.find(q => q.id === 'heave'), cd1 = lp ? lp._cd : 5;
      if (st.fullR) addN += wN * FULLR_K * st.fullR * cy.full;
      if (st.hurlCarry) addN += wN * CARRY_K * st.hurlCarry / 40;
      if (st.wrecker) { const g = Math.min(0.25, WRECK_SAVE * cy.tw / cd1); add1 += wOne * g; addN += wN * g; }
      if (st.hookPull && lp) addN += lp.dpsCd * k * PULL_N;
      if (st.slipstream) eMul *= 1 + 0.35 * (1 - C.WIND_MOVE) * SLIP_WIND;
      if (st.leapR) eMul *= 1 + LEAP_E * st.leapR;
      if (st.leapIfr) eMul /= 1 - Math.min(E_MAX_RED, IFR_HIT * st.leapIfr / cd1);
    }
    // area: melee arcs and blasts catch more of a pack
    if (st.area) { mulN *= 1 + (melee ? 0.3 : 0.12) * st.area; }
    // Seeker Gem: homing shots miss less, melee reach hits first and catches more of a pack
    if (st.homing > 0 && !melee) { mul1 *= 1.08; mulN *= 1.08; }
    if (st.meleeReach > 0 && melee && !bell) { mul1 *= 1 + 0.1 * st.meleeReach; mulN *= 1 + 0.3 * st.meleeReach; }
    // guards and sustain the effective health leaves out
    if (st.guardian) eMul *= 1.12;
    if (st.aegis) eMul *= 1.15;
    if (st.mirror) eMul *= 1 + 0.35 * st.mirror;
    if (st.angel) eMul *= 1.25;
    if (st.phoenix) eMul *= 1.15;
    if (st.strataHeal) eMul *= 1 + 0.4 * st.strataHeal;
    if (st.chalice) { eMul *= 1.15; mul1 *= 1.04; mulN *= 1.04; }
    eMul *= 1 + 0.002 * st.thorns + 0.35 * (st.spd - 1) + 0.08 * st.dashN + 0.1 * st.heal;
    // meta stats: gold buys relics and boons, experience and choices add picks
    bonus += 0.12 * st.gold + 0.25 * st.xp + 0.15 * st.choices + 0.16 * st.discount + 0.04 * st.cloverRerolls + 0.12 * st.luck + 0.03 * st.light;
    return { one: (dOne + stOne + add1) * mul1, pack: (dPack + stN + addN) * mulN, ehp: a.ehp * eMul, bonus };
  }

  // ---------------- value of a hero ----------------
  const cache = new Map();
  const metaKeys = new WeakMap();
  const metaKey = (meta) => { let s = metaKeys.get(meta); if (s === undefined) { s = (meta.up || []).join('') + ':' + (meta.mastery || 1); metaKeys.set(meta, s); } return s; };
  const sortedKey = (o) => { const ks = Object.keys(o).sort(); let s = ''; for (const k of ks) if (o[k] > 0) s += k + o[k] + ','; return s; };
  const heroKey = (p, pact) => p.cls + '|' + p.weapon + '|' + pact + '|' + (p.bonusHp | 0) + '|' + (p.chaliceHp | 0) + '|' + metaKey(p.meta) + '|' + sortedKey(p.boons) + '|' + (p.relics || []).slice().sort().join(',');

  // ---------------- weight of effective health ----------------
  let lamMode = 'f', lamX = LAMBDA, lamKey = 'f' + LAMBDA;
  // Foe damage lever of stratum t from the live tables: the mean hit of a regular foe (roster weights) and of the boss, times the depth scale and the threat damage.
  function lever(t) {
    const i = clamp(t, 1, ED.BIOMES.length), b = ED.BIOMES[i - 1], thr = ED.World.THREAT[Math.min(i, ED.World.THREAT.length) - 1];
    let sum = 0, wt = 0;
    for (const e of b.enemies) { sum += e[1] * ED.ENEMIES[e[0]].dmg; wt += e[1]; }
    return ED.World.dmgScale(i) * thr.dmg * (sum / wt + ED.ENEMIES[b.boss].dmg) / 2;
  }
  let hitRef = 0; // LEVER_HIT x the mean base max health of the classes
  const lambdaAt = (t) => {
    if (lamMode === 'f') return lamX;
    if (!hitRef) { let s = 0; for (const id of ED.CLASS_IDS) s += ED.CLASSES[id].hp; hitRef = LEVER_HIT * s / ED.CLASS_IDS.length; }
    return lamX * lever(t) / hitRef;
  };
  // spec: undefined or '' = the default; '<x>' = fixed; 'auto' / 'auto:<x0>' = threat-aware (x0 default 1). Returns the setting's key; a change clears the value cache.
  function setLambda(spec) {
    let mode = 'f', x = LAMBDA;
    if (spec !== undefined && spec !== null && spec !== '') {
      const m = /^auto(?::(.+))?$/.exec(String(spec));
      if (m) { mode = 'a'; x = m[1] === undefined ? 1 : +m[1]; } else x = +spec;
      if (!(x >= 0) || !isFinite(x)) throw new Error('--lambda expects a number or auto[:x0], got ' + spec);
    }
    const key = mode + x;
    if (key !== lamKey) { lamMode = mode; lamX = x; lamKey = key; cache.clear(); }
    return key;
  }

  // Decision context: the sheet context of the world, the strata a build is valued at, the picks taken.
  function decision(w, p) {
    const base = ED.Sheet.ctx(w, p), s = clamp(w.stratum, 1, ED.BIOMES.length), ts = [], ws = [];
    for (let i = 0; i < 3 && s + i <= ED.BIOMES.length; i++) { ts.push(s + i); ws.push(W_STRATA[i]); }
    const sum = ws.reduce((x, y) => x + y, 0);
    let picks = 0;
    for (const id in p.boons) picks += p.boons[id];
    return { base, s, ts, ws: ws.map(x => x / sum), picks, pact: w.pact | 0, gains: new Map() };
  }

  // The hero's temporary state (room-wide buffs, stacks) is left out: a build is valued at rest, so equal builds get equal values.
  const AT_REST = { toughRoom: false, tranceT: 0, momN: 0, glT: 0, glV: 0, auraT: 0, auraV: 0, holdOn: false };
  // { v, d: ln D (weighted), e: ln E (weighted), bonus } of hero h; cached per build.
  function valueOf(h0, dc) {
    const key = heroKey(h0, dc.pact) + '#' + dc.s + ':' + dc.base.minions + ':' + dc.base.party;
    let r = cache.get(key);
    if (r) return r;
    const h = Object.assign({}, h0, AT_REST);
    let d = 0, e = 0, le = 0, bonus = 0;
    for (let i = 0; i < dc.ts.length; i++) {
      const ctx = Object.assign({}, dc.base, { stratum: dc.ts[i] }), a = model.assess(h, ctx), f = fold(h, a, ctx), we = dc.ws[i] * ln(Math.max(1, f.ehp));
      d += dc.ws[i] * 0.5 * (ln(Math.max(1e-6, f.one)) + ln(Math.max(1e-6, f.pack)));
      e += we;
      le += lambdaAt(dc.ts[i]) * we;
      bonus += dc.ws[i] * f.bonus;
    }
    r = { v: d + le + bonus, d, e, bonus };
    if (cache.size > 40000) cache.clear();
    cache.set(key, r);
    return r;
  }

  // ---------------- priors and milestones ----------------
  // Flat prior of card id for hero h (after the card) in decision context dc: PATH_CAL plus the PRIOR entry while its path is active; the Purse has its own.
  function prior(id, h, dc) {
    const b = ED.BOONS[id], st = h.stats;
    if (b.purse) return PURSE_X;
    const pr = PRIOR[id], cal = b.path ? PATH_CAL[b.path] || 0 : 0;
    return cal + (pr && PRESENT_EL(st, pr[0]) ? pr[1] : 0);
  }
  function cardGain0(h, id, dc, v0) {
    const key = heroKey(h, dc.pact) + '>' + id;
    let g = dc.gains.get(key);
    if (g === undefined) {
      const q = ED.Sheet.withBoon(h, id, dc.base);
      g = valueOf(q, dc).v - (v0 === undefined ? valueOf(h, dc).v : v0) + prior(id, q, dc);
      dc.gains.set(key, g);
    }
    return g;
  }
  const feasible = (need, pool, dc) => need <= pool && need <= FEASIBLE * Math.max(0, PICKS_RUN - dc.picks) && Math.pow(GAMMA, need) >= MIN_TERM;
  function poolOf(h, k) {
    let n = 0;
    for (const id of POOL_OF[k]) n += Math.max(0, ED.maxRank(ED.BOONS[id], h.stats) - (h.boons[id] || 0));
    return n;
  }
  // Discounted value of the milestones of h's paths: keystone per path, the best evolution. gh: the hero the milestone cards are valued on where it holds the path (else h).
  function future(h, dc, gh) {
    const out = { key: {}, evo: 0, total: 0 };
    const paths = ED.gatePaths(h.boons), evoOwned = !!ED.evoOf(h.boons);
    const owns = (x, k) => ED.gatePaths(x.boons).includes(k);
    for (const k of paths) {
      const aff = ED.pathAffinity(h.boons, k), keyId = KEY_OF[k], keyOwned = h.boons[keyId] > 0, pool = poolOf(h, k), base = gh && owns(gh, k) ? gh : h;
      if (!keyOwned) {
        const need = Math.max(0, ED.keyAffinity(k) - aff);
        if (feasible(need, pool, dc)) out.key[k] = Math.pow(GAMMA, need) * Math.max(0, cardGain0(base, keyId, dc));
      }
      if (!evoOwned && ED.BOONS['evo_' + k]) {
        const need = Math.max(Math.max(0, ED.evoAffinity(k) - aff), keyOwned ? 0 : 1);
        if (feasible(need, pool + (keyOwned ? 0 : 1), dc)) out.evo = Math.max(out.evo, Math.pow(GAMMA, need) * Math.max(0, cardGain0(base, 'evo_' + k, dc)));
      }
    }
    out.total = out.evo;
    for (const k in out.key) out.total += out.key[k];
    return out;
  }

  // ---------------- gain of a card ----------------
  // { gain, dv, df, x, dd, de } for taking boon id with hero p; before: valueOf(p) and future(p). A card that is itself a milestone realises its term, which leaves F.
  function gainOf(p, id, dc, before, fb) {
    const b = ED.BOONS[id], q = ED.Sheet.withBoon(p, id, dc.base), va = valueOf(q, dc);
    let fa = fb;
    if (b.gate || b.key || b.evo || (b.path && !b.open)) fa = future(q, dc, b.gate ? null : p);
    let realised = 0;
    if (b.key) realised = fb.key[b.path] || 0; else if (b.evo) realised = fb.evo;
    const x = prior(id, q, dc), dv = va.v - before.v, df = fa.total - fb.total + realised;
    return { gain: dv + df + x, dv, df, x, dd: va.d - before.d, de: va.e - before.e };
  }

  const RANDOM_UNIT = 1e-7;
  const START_T = 0.04; // the start offer is a draw weighted exp(gain / START_T): a veteran varies the first path among near-equal ones (ln-V units)
  // Index of the card to take from offer p.offer (spec = the offer's head spec), or -1: reroll. ctx.gatesCap limits path gates; noReroll forbids returning -1.
  function chooseIndex(w, p, spec, rng, ctx, noReroll) {
    const offer = p.offer, dc = decision(w, p), before = valueOf(p, dc), fb = future(p, dc, null), gates = ED.gatePaths(p.boons);
    const src = spec && spec.src, rows = [];
    let best = -1, bg = -Infinity;
    for (let i = 0; i < offer.length; i++) {
      const id = offer[i], b = ED.BOONS[id];
      const r = gainOf(p, id, dc, before, fb);
      if (b.gate && gates.length >= (ctx.gatesCap || 2)) r.gain = -1e6; // over the --gates cap a gate is the last choice
      r.id = id;
      rows.push(r);
      const g = r.gain + rng.next() * RANDOM_UNIT;
      if (g > bg) { bg = g; best = i; }
    }
    if (src === 'start' && rows.length > 1) { // weighted draw over the start cards
      const top = rows[best].gain, wt = rows.map(r => Math.exp((r.gain - top) / START_T)), sum = wt.reduce((a, b) => a + b, 0);
      let u = rng.next() * sum; best = 0; while (best < wt.length - 1 && u >= wt[best]) u -= wt[best++];
    }
    const rerollable = src !== 'forge' && src !== 'class';
    const reroll = !noReroll && rerollable && p.rerolls > 0 && rows[best].gain < REROLL_MIN;
    if (ctx.explain) explain(w, p, src, dc, before, fb, rows, reroll ? -1 : best);
    return reroll ? -1 : best;
  }

  // Gain of taking relic id now (ln-V units): V(with) - V(without).
  function relicGain(w, p, id) {
    const dc = decision(w, p), q = model.withRelic(p, id, dc.base);
    return valueOf(q, dc).v - valueOf(p, dc).v;
  }
  // The same squashed into [0, 1): 0 for a relic that does not help, gain / (gain + RELIC_HALF) above it.
  function relicValue(w, p, id) { const g = relicGain(w, p, id); return g > 0 ? g / (g + RELIC_HALF) : 0; }

  // ---------------- --explain ----------------
  const f3 = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
  function explain(w, p, src, dc, before, fb, rows, chosen) {
    const el = ED.gatePaths(p.boons).join('+') || '-';
    const lines = [`[pick] stratum ${w.stratum} ${src || 'level'} #${dc.picks + 1} ${p.cls} ${el} V ${before.v.toFixed(3)} F ${fb.total.toFixed(3)}${p.rerolls ? ' rerolls ' + p.rerolls : ''}`];
    rows.forEach((r, i) => lines.push(`   ${i === chosen ? '>' : ' '} ${ED.BOONS[r.id].name.padEnd(18)} V${f3(r.dv)} (dmg${f3(r.dd)} hp${f3(r.de)}) F${f3(r.df)} X${f3(r.x)} = ${f3(r.gain)}`));
    if (chosen < 0) lines.push('   -> reroll');
    console.log(lines.join('\n'));
  }

  return { chooseIndex, relicValue, relicGain, gainOf, valueOf, decision, future, fold, setLambda, lambdaAt, lever, AT_REST, REROLL_MIN, LAMBDA, GAMMA };
};
