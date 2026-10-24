// Bot card choice by marginal value (tools/sim.js --pick=smart). Factory: require('./pick.js')(ED, model) with model = require('./model.js')(ED).
// Value of a hero build: V = sum over the strata t = s, s+1, s+2 (weights 0.5 / 0.3 / 0.2, capped at VI) of w_t (ln D_t + lambda_t ln E_t) + bonus, where D_t = sqrt(damage on one foe x damage on a pack) at stratum t
// (ED.Sheet.compute through the model, the stratum affinity included), E = effective health and bonus = the meta stats (gold, experience, offers).
// lambda_t (setLambda, --lambda=<x>|auto[:<x0>]): a fixed x for every stratum, or auto = x0 times the foe damage lever of stratum t over LEVER_REF, read from the live World.THREAT, World.dmgScale, biome rosters and boss damage (a harder table raises the weight of effective health).
// The sheet leaves many mechanics out; fold() adds them from the stat block (formulas below, assumptions in the constants) so a card's value follows the build it joins.
// Gain(card) = V(after) - V(before) + F(after) - F(before) + X(card); F = discounted value of the milestones a card brings closer (keystone, evolution, duo), X = a flat prior for effects with no stat.
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
  const TRANSMUTE = 0.03; // a Generalist's element relic becomes a random non-element relic of its rarity
  const DUO_X = 0.12; // a duo card (its payoff has no stat): worth about +13% damage when both paths are active
  const T_ONE = 30, RES_ONE = 0.5, RES_BOSS = 0.35; // a single big foe: engagement seconds and gauge resistance (elite 0.7, boss 0.35); freezes use the boss value
  const ARC_FOES = 7; // foes within a discharge's reach in a horde
  const POOL_EFF = 0.6; // share of the ideal status damage on every foe of a pack that lands (overkill, spread-out foes)
  const T_FOE_MIN = 1.5, T_FOE_MAX = 10; // life of a foe in a pack under the hero's pack damage
  const DASH_USE = { melee: 0.5, ranged: 0.2 }; // share of dash cooldowns spent dashing through foes
  const TRANCE_T = 4; // Battle Trance seconds per skill cast
  const ECHO_EXTRA = 0.3; // extra casts of skill 1 per cooldown from a second charge
  const FROZEN_FOE = 0.7; // share of its damage a frozen foe does not deal (it cannot act, shots already flying); a chilled foe is slowed (SLOW_RED) and 'chillWeaken' weaker
  const SLOW_RED = 0.12;
  const STUN_RED = 0.7; // damage a stunned foe does not deal while stunned (it recovers, some attacks already thrown)
  const E_MAX_RED = 0.35; // largest share of incoming damage the controlled foes can remove

  // Cards and relics the sheet leaves at zero (found at a fresh Ranger, a Knight with two gates, a late Generalist Ranger and with each element gate owned), one line each.
  // Fold = a formula in fold() from the stat block (D damage, E effective health, bonus = meta value); Prior = a flat value in PRIOR / MUT_X / prior(); Sheet = the sheet models it once its path is active.
  // "guess" marks a coefficient no bot run has measured. Retired cards (b.retired) are never offered and have no line. Relics follow the boons.
  //   fleet        Fold  spd -> E
  //   lightstep    Fold  dashN (a charge: 0.08 each) and dashcdr (0.2 per unit; Shadow Cloak) -> E
  //   magnet       Fold  xp -> bonus (pickup range: none)
  //   bounty       Fold  gold -> bonus
  //   purse        Prior PURSE_X (a gold room's gold; guess)
  //   mending      Fold  heal -> E
  //   forager      Fold  +World.FORAGER max HP per heal source x FORAGER_HEALS sources a stratum that land below full health (guess) -> E at HEAL_E per max HP healed
  //   wide         Fold  area -> pack damage (melee more)
  //   bladedash    Fold  dash hit per dash cooldown (share of dashes through foes)
  //   battleward   Fold  roomWard -> E
  //   echo         Fold  extra casts of skill 1 (ECHO_EXTRA)
  //   laststand    Fold  guardian -> E
  //   trance       Fold  attack speed for 4 s after a cast on the weapon share, capped by the attack floor
  //   overcharge   Fold  shockwave per skill cast, pack hits
  //   fuel deepcold stormattune potency fervor malignance  Sheet infusion, Fold build-up; the +damage half is an ED.COND_DMG row at the model's uptime (tools/model.js)
  //   wildfire     Fold  burn passed on by a dying foe -> pack burn damage
  //   brushfire    Fold  pack burn x (1 + brushfire x BRUSH_K): contact spread evens the pools of foes the hits miss (ranged more; guess)
  //   firebreak    Prior fire 0.04: funnel control and the ground a burning death leaves (guess)
  //   cindertrail  Fold  dash trail damage
  //   conflag      Prior fire: the burn pool dumps at 30% of remaining health, 60% splashes
  //   frostbite    Fold  chill gauge -> freeze share of foe time -> E and +25% damage taken
  //   shatter      Fold  skill hits on frozen foes (the freeze share): +shatter on the hit, a burst on SHATTER_NEAR neighbours in a pack
  //   glacier      Fold  E x (1 + GLACIER_E x min(freeze share, 1 - freeze share)): frozen foes wall the moving ones and eat shots (guess)
  //   rime         Fold  a thawed foe keeps refreeze of the gauge: the refreeze part of the freeze cycle x (1 - refreeze)
  //   permafrost   Fold  freezeDur and chillWeaken -> E
  //   abszero      Fold  frostNova -> chill spreads through a pack
  //   conductor    Fold  arcs and arcRange -> pack lightning
  //   highvoltage  Sheet shockMul in the lightning estimate
  //   conduction   Fold  pack lightning x (1 + conduct x CONDUCT_N foes within 60; guess)
  //   stormanchor  Fold  zaps: procDmg / ANCHOR_ZAP x anchors up (ANCHOR_T x casts, at most ANCHOR_MAX) x ANCHOR_HIT (foe in reach; guess); discharge arcs: pack lightning x (1 + ANCHOR_ARC_K; guess)
  //   shortcircuit Fold  dying charged foe discharges -> pack lightning
  //   overload     Fold  arcStun -> stun share -> E, Opportunist
  //   capacitor    Sheet x3 detonation in the lightning estimate; Fold pack lightning x the share of pack foes a cast reaches before they die (casts x foe life, at least CAP_MIN)
  //   envenom      Fold  venom gauge -> damage taken from the hero
  //   caustic      Fold  corrode -> damage taken
  //   sporeburst   Fold  faster venom in a pack; Prior poison 0.05 per rank
  //   neurotoxin   Fold  E: NEURO_RED x the share of foe time at full Venom (bosses half; guess)
  //   hexstrong    Prior poison 0.03: elites lose their affixes at full Venom (guess)
  //   linger       Prior poison 0.015 per rank: Venom stays up between hits (guess)
  //   pandemic     Prior poison: venom spreads from corroded foes
  //   zealotry     Sheet smiteMul in the holy estimate
  //   sanctity     Fold  holyCap and smiteShield -> E
  //   beacon       Fold  smite splash -> pack holy damage
  //   martyr       Fold  nova procDmg x shield size (half the cap against REBUKE_REF, x0.5 to x2) x MARTYR_RATE breaks a second (guess), pack hits
  //   vigil        Fold  holy x (1 + VIGIL_UP): share of hits landed standing still (ranged more; guess)
  //   radiantaegis Prior holy: double radiance while shielded, absorbed damage strikes back
  //   doommark     Fold  doom per damage -> reap line (trash) and tolls (boss)
  //   inevitable   Fold  doomTough -> boss and elite doom
  //   deathsedge   Prior shadow: a reap readies a guaranteed crit
  //   reaperschain Fold  a pack foe that receives chained Doom (CHAIN_REACH of them; guess) needs (1 - the moved Doom share) of the damage
  //   quarry       Fold  one-foe Doom x (1 + QUARRY_BIG x the Quarry share: casts x QUARRY_T; guess)
  //   umbralstep   Fold  dashes through foes x a foe's health below twice the Reap line x UMBRAL_HIT (guess)
  //   reaper       Prior shadow: a reaped foe implodes around it
  //   sunder       Fold  crit chance x hits per second -> stacks of +4% damage taken (10 stacks)
  //   evo_fire evo_general  Sheet strikes (Scorched ground, Spectral strike)
  //   evo_ice evo_lightning evo_poison evo_holy evo_shadow  Prior 0.06-0.08 (pillars, tethers, doses, lance, dash refund: no stat; guess)
  //   thermalshock plasma firedamp sunfire blackflame superconductor cryotoxin hoarlight blackice galvanic wrathofheaven blacklightning purge necrosis twilight Prior DUO_X each, when both paths are active
  //   mut_*        Prior MUT_X per Mutation (MUT_DEF otherwise; guesses); supercapacitor: Sheet (capMul, chargeSlow); lattice: the anchor Fold plus its prior
  //   metronome    Fold  weapon damage and the statuses it feeds x (METRO_HI + (METRO_N - 1) x METRO_LO) / METRO_N = x1.35
  //   pacifist     Fold  weapon direct damage removed; the weapon share of every status build-up x PYRE
  //   bloodprice   Fold  skill damage x (1 + BLOOD_CASTS: the bot casts at the gap while above BLOOD_HP; guess), E x BLOOD_EHP (health spent; guess)
  //   hunted       Prior HUNT.card x HUNT.kill x HUNT.fights x strata left (extra boon cards; guess); Fold E x HUNT.ehp (one more affixed elite a room; guess)
  //   boots        Fold  spd -> E (relic)
  //   coin         Fold  gold, luck -> bonus
  //   fang         Fold  poisonInfuse -> venom
  //   lodestone    Fold  xp -> bonus
  //   pauldron     Fold  thorns -> E
  //   phoenix      Fold  revive -> E
  //   stormidol    Fold  critCharge -> lightning estimate
  //   elixir       Fold  strataHeal and heal -> E
  //   satchel      Fold  dash bomb
  //   lantern      Fold  xp and light -> bonus
  //   seeker       Fold  homing (ranged) and melee reach
  //   mirror       Fold  projectile shrug -> E
  //   crown        Fold  choices -> bonus
  //   wispjar      Fold  doomMul in the doom formula
  //   angel        Fold  extra life per stratum -> E
  //   crest        Sheet smiteMul in the holy estimate
  //   frozenheart  Fold  freeze when hit -> E
  //   chalice      Fold  health growth -> E, full-health damage
  //   ledger       Fold  discount -> bonus
  //   clover       Fold  rerolls and luck -> bonus
  //   aegis        Fold  block a hit per 10 s -> E
  //   glaciercore  Fold  freezeDur
  //   lightningrod Fold  arcs
  //   gravecandle  Fold  shadowInfuse
  //   venomgland   Fold  corrode
  // Flat priors in ln-V units (0.10 = about +10% damage); zero unless the path is active.
  const PRIOR = {
    conflag: ['fire', 0.12], // the burn pool dumps at 30% of remaining health and 60% of it splashes within 70
    pandemic: ['poison', 0.1], // corroded foes spread venom to 2 neighbours
    radiantaegis: ['holy', 0.08], // while shielded: double radiance, absorbed damage strikes back
    reaper: ['shadow', 0.1], // a reaped foe implodes for 20% of its health around it
    sporeburst: ['poison', 0.05], // per rank: a dying envenomed foe hands venom to its neighbours
    deathsedge: ['shadow', 0.05], // a reap readies a guaranteed crit
    firebreak: ['fire', 0.04], // guess: foes walk round your burning ground (funnel) and a burning death leaves some
    hexstrong: ['poison', 0.03], // guess: an elite at full Venom loses its affixes
    linger: ['poison', 0.015], // guess, per rank: Venom outlasts the gaps between hits
    evo_ice: ['ice', 0.08], // guess: frozen deaths leave solid pillars, a skill hit bursts them for 15% of the dead foe's health
    evo_lightning: ['lightning', 0.08], // guess: tethers between charged foes strike crossers at 50% weapon
    evo_poison: ['poison', 0.08], // guess: a dose bursts for 10% of the foe's health x its Venom share
    evo_holy: ['holy', 0.06], // guess: while shielded the attack is a lance through every foe on the line
    evo_shadow: ['shadow', 0.07], // guess: a Reap marks the next Quarry and refunds a dash charge
  };
  // Mutation priors (ln-V units; every value a guess): the payoff of the parent rule the Mutation reshapes; MUT_DEF for the ones not listed.
  const MUT_DEF = 0.05;
  const MUT_X = {
    mut_supercapacitor: 0, // the sheet reads capMul and chargeSlow
    mut_lattice: 0.03, // the anchor itself is folded (anchor stat)
    mut_rimelattice: 0.03, mut_penitence: 0.03, mut_openingstroke: 0.02, mut_emberwake: 0.03, mut_deathspiral: 0.03, mut_mirroredge: 0.03, // narrower or situational
    mut_flashfreeze: 0.06, mut_miasma: 0.06, mut_halo: 0.06, mut_echoedge: 0.07, // Echo Edge: the spectral strike at 100% instead of 60%
  };
  const PURSE_X = 0.01; // guess: the Purse's gold, a gold room's reward
  // Twist terms (ED.TWIST_C has the card numbers). BLOOD_CASTS: extra skill casts per normal cast under Bloodprice (the bot casts at the gap while above sim.js BLOOD_HP of max health); BLOOD_EHP: effective health left (health spent on casts).
  // HUNT: card = value of one extra boon card, kill = share of champions killed before the clear, fights = combat rooms a floor, ehp = effective health with one more affixed elite a room. All guesses.
  const TC = ED.TWIST_C, BLOOD_CASTS = 1, BLOOD_EHP = 0.75, HUNT = { card: 0.025, kill: 0.6, fights: 4.2, ehp: 0.93 };
  // Element terms the sheet leaves out (guesses unless a constant is named): BRUSH_K pack burn per Brushfire share; GLACIER_E E per pack freeze share; SHATTER_NEAR neighbours a shatter burst reaches; CONDUCT_N other foes within 60;
  // ANCHOR_HIT share of zaps that find a foe; ANCHOR_ARC_K pack lightning added by discharges arcing to an anchor; CAP_MIN least share of a pack a Capacitor cast reaches; NEURO_RED foe damage removed at full Venom;
  // MARTYR_RATE shield breaks a second in a fight; VIGIL_UP share of hits landed standing still; CHAIN_REACH share of pack foes that receive a chained Doom; QUARRY_BIG Reap-line weight on a big foe; UMBRAL_HIT share of dashes through a foe below twice its Reap line.
  // HEAL_E: E per max HP healed a stratum (Mending's 0.1 per unit of heal); FORAGER_HEALS: heal sources a stratum that land below full health.
  const BRUSH_K = { melee: 0.5, ranged: 1.2 }, GLACIER_E = 0.3, SHATTER_NEAR = 1, CONDUCT_N = 2, ANCHOR_HIT = { melee: 0.6, ranged: 0.3 }, ANCHOR_ARC_K = 0.3, CAP_MIN = 0.2, NEURO_RED = 0.2;
  const MARTYR_RATE = 1 / 8, VIGIL_UP = { melee: 0.2, ranged: 0.4 }, CHAIN_REACH = 0.7, QUARRY_BIG = 0.5, UMBRAL_HIT = 0.5, HEAL_E = 0.08, FORAGER_HEALS = 2.5;
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
    const st = p.stats, m = a.m, k = a.k, ref = m.ref, t = ctx.stratum, melee = !!st.melee || st.kind === 'bell', wk = m.weapon, aps = wk._aps;
    const sdTot = model.statusDamage(m), dOne = a.one - sdTot, dPack = a.pack - sdTot;
    const spk = 1 + (clamp(dPack / Math.max(1e-9, dOne), 1, PACK) - 1) * POOL_EFF; // a status builds on every foe the hits reach
    const sd = { fire: 0, lightning: 0, holy: 0, general: 0 };
    for (const s of m.mult.status) if (sd[s.el] !== undefined) sd[s.el] = (s.est && s.est.dps) || 0;
    const feed = m.proc.dps / Math.max(1e-9, model.directDamage(m, 1)); // share of the hero's damage that builds statuses
    const pf = clamp(a.pack / PACK / Math.max(1e-9, a.one), 0.1, 1); // damage each foe of a pack gets, against the same hero's single target
    const tFoe = clamp(ref.hp / Math.max(1e-9, a.pack / PACK), T_FOE_MIN, T_FOE_MAX); // life of a pack foe
    const pow = 1 + st.statusPow;
    let add1 = 0, addN = 0, mul1 = 1, mulN = 1, eMul = 1, bonus = 0;
    let light1 = sd.lightning, fire1 = sd.fire, holy1 = sd.holy;
    const casts = m.skills.reduce((s, q) => s + 1 / q._cd, 0); // skill casts a second
    const wShare = m.proc.dps > 0 ? m.proc.split.weapon / m.proc.dps : 1; // share of the status build-up the weapon feeds
    const wOne = wk.dps * (wk._up === undefined ? 1 : wk._up) * k, wN = model.packWeapon(m, PACK) * k; // weapon damage on one foe and on a pack
    const skOne = m.skills.reduce((s, q) => s + q.dpsCd, 0) * k, skN = Math.max(0, model.directDamage(m, PACK) - model.packWeapon(m, PACK) * (1 + (m.boost ? m.boost.pack : 0))) * k; // skill damage on one foe and on a pack
    const dashUse = (melee ? DASH_USE.melee : DASH_USE.ranged) / Math.max(0.5, m.dash.cd); // dashes through foes a second
    const pyreK = st.twPacifist ? 1 + (TC.PYRE - 1) * wShare : 1; // Pacifist's Pyre: the weapon share of the build-up x PYRE

    // Stormidol: critical hits charge foes
    if (st.critCharge) light1 += m.proc.critDps * st.critCharge * pow * ED.elemMul(t, 'lightning') * (1 + st.shockMul);
    // Lightning: a discharge arcs to 3 + arcs foes at ARC_MUL; Short Circuit, Conduction; Capacitor detonates only the pack foes a cast reaches alive
    let lightN = light1 * spk;
    if (light1 > 0 || st.lightningInfuse > 0) {
      lightN *= 1 + POOL_EFF * C.ARC_MUL * Math.min(ARC_FOES - 1, (3 + st.arcs) * (1 + 0.5 * st.arcRange));
      if (st.shortCircuit) lightN *= 1 + 0.6 * st.shortCircuit;
      if (st.conduct) lightN *= 1 + st.conduct * CONDUCT_N;
      if (st.capacitor) lightN *= clamp(casts * tFoe, CAP_MIN, 1);
    }
    // Storm Anchor: an anchor per cast zaps a foe in reach every ANCHOR_ZAP; discharges arc to it and burst
    if (st.anchor) {
      const up = Math.min(C.ANCHOR_MAX, C.ANCHOR_T * casts), zap = ED.procDmg(ED.BOONS.stormanchor, st) * Math.max(0.1, st.dmg) * ED.elemMul(t, 'lightning') / C.ANCHOR_ZAP, hit = melee ? ANCHOR_HIT.melee : ANCHOR_HIT.ranged;
      add1 += zap * up * hit; addN += zap * up * Math.min(1, 1.5 * hit);
      lightN *= 1 + ANCHOR_ARC_K * Math.min(1, up);
    }
    // Holy: Vigil doubles the Radiance of hits landed standing still; Beacon splashes a Smite to the foes next to it
    if (st.vigil) holy1 *= 1 + (melee ? VIGIL_UP.melee : VIGIL_UP.ranged);
    let holyN = holy1 * spk;
    if (st.beacon) holyN *= 1 + st.beacon * Math.min(PACK - 1, 2);
    // Fire: Wildfire passes a dying foe's burn on; Brushfire spreads it by contact
    let fireN = fire1 * spk;
    if (st.wildfire) fireN *= 1 + st.wildfire * 1.2;
    if (st.brushfire) fireN *= 1 + st.brushfire * (melee ? BRUSH_K.melee : BRUSH_K.ranged);
    const stOne = fire1 + light1 + holy1 + sd.general, stN = fireN + lightN + holyN + sd.general * spk;

    // Twists: Metronome bar on the weapon and the statuses it feeds; Pacifist's Pyre trades the weapon's direct damage for x PYRE build-up; Bloodprice extra casts for health
    if (st.twMetro) { const g = (TC.METRO_HI + (TC.METRO_N - 1) * TC.METRO_LO) / TC.METRO_N - 1; add1 += (wOne + stOne * wShare) * g; addN += (wN + stN * wShare) * g; }
    if (st.twPacifist) { add1 += stOne * (pyreK - 1) - wOne; addN += stN * (pyreK - 1) - wN; }
    if (st.twBlood) { add1 += skOne * BLOOD_CASTS; addN += skN * BLOOD_CASTS; eMul *= BLOOD_EHP; }
    if (st.twHunted) eMul *= HUNT.ehp;
    // Battle Trance: attack speed during the 4 s after a skill cast, on the weapon's damage and the statuses it feeds
    if (st.trance) {
      const rate0 = St.attackRate(p), up = Math.min(1, TRANCE_T * casts), apsOn = Math.min(1 / st.atkFloor, aps * (rate0 + st.trance) / rate0), f = up * (apsOn / aps - 1);
      add1 += (wk.dps * k + stOne * wShare) * f;
      addN += (wN + stN * wShare) * f;
    }
    // Overcharge: a shockwave with every skill cast
    if (st.overcharge) {
      const shock = ED.procDmg(ED.BOONS.overcharge, st) * st.overcharge * Math.max(0.1, st.dmg);
      add1 += shock * casts; addN += shock * casts * Math.min(PACK, 3);
    }
    // Martyr's Rebuke: a holy nova per shield break, sized by the broken shield
    if (st.rebuke) {
      const nova = ED.procDmg(ED.BOONS.martyr, st) * Math.max(0.1, st.dmg) * ED.elemMul(t, 'holy') * clamp(st.holyCap / 2 / C.REBUKE_REF, 0.5, 2) * MARTYR_RATE;
      add1 += nova; addN += nova * Math.min(PACK, 3);
    }
    // Echo: a second charge of skill 1 is extra casts
    if (st.charges > 0 && m.skills[0]) { const e1 = m.skills[0].dpsCd * k * ECHO_EXTRA; add1 += e1; addN += e1 * spk; }
    // dash riders: damage per dash, a share of the cooldowns
    if (m.dash.parts.length) {
      let d1 = 0, dN = 0;
      for (const q of m.dash.parts) {
        if (!(q.dmg > 0)) continue;
        if (q.label === 'Dash hit') { d1 += q.dmg; dN += q.dmg * Math.min(PACK, 2); }
        else if (q.label === 'Burning trail') { d1 += q.dmg * 2.2; dN += q.dmg * 2.2 * Math.min(PACK, 3); }
        else { d1 += q.dmg; dN += q.dmg * Math.min(PACK, 3); }
      }
      add1 += d1 * dashUse; addN += dN * dashUse;
    }
    // Sunder: crits stack +4% damage taken (up to 10 stacks); a crit adds min(2, 60 x its share of the foe's health) stacks
    if (st.sunder) {
      const hps = aps * wk.oneFoe, per = Math.min(2, 60 * (wk._hit * st.critMult) / Math.max(1, ref.statusHp)), g = st.crit * hps * per;
      mul1 *= 1 + 0.04 * meanRamp(g, T_ONE, 10);
      mulN *= 1 + 0.04 * meanRamp(g * pf, tFoe, 10);
    }
    // Venom: damage taken from the hero rises with the gauge; the gauge fills at rate x VENOM_K per second of damage fed in. Neurotoxin: foes at full Venom deal less.
    if (st.poisonInfuse > 0 && m.proc.rate.poison > 0) {
      const aff = ED.elemMul(t, 'poison'), r = m.proc.rate.poison * pyreK / ref.statusHp * C.VENOM_K * (1 + st.venomBuild) * aff, amp = C.VENOM_AMP + st.corrode, rN = r * pf * (1 + 0.5 * st.sporeBurst);
      mul1 *= 1 + amp * meanRamp(r * RES_ONE, T_ONE, 100) / 100;
      mulN *= 1 + amp * meanRamp(rN, tFoe, 100) / 100;
      if (st.neuro) { const full = (g, T) => (g > 0 ? clamp(1 - 100 / (g * T), 0, 1) : 0); eMul /= 1 - Math.min(E_MAX_RED, NEURO_RED * (0.6 * full(rN, tFoe) + 0.4 * 0.5 * full(r * RES_ONE, T_ONE))); }
    }
    // Doom: a foe is Reaped once its health falls to the Doom the hero's hits stored (trash dies after 1/(1+i) of its health); a boss pays the Doom back as Tolls.
    // Quarry doubles the Reap line of the foe the skills hit; Reaper's Chain hands part of a Reaped foe's Doom on; Umbral Step Reaps a dashed foe below twice its line.
    if (st.shadowInfuse > 0 && m.proc.rate.shadow > 0) {
      const i = st.shadowInfuse * (1 + st.doomMul) * ED.elemMul(t, 'shadow') * feed * pyreK;
      mul1 *= 1 + i * (C.DOOM_TOUGH + st.doomTough) * (st.quarry ? 1 + QUARRY_BIG * Math.min(1, casts * C.QUARRY_T) : 1);
      const moved = st.reapChain ? Math.min(C.SPREAD_CAP, st.reapChain * i / (1 + i)) * CHAIN_REACH : 0;
      mulN *= (1 + i) / (1 - moved);
      if (st.dashReap) addN += dashUse * ref.hp * Math.min(1, 2 * i / (1 + i)) * UMBRAL_HIT;
    }
    // Chill and freeze: a frozen foe takes +25% and does nothing; chilled foes are slow. Lingering Rime shortens the refreeze; Shatter cashes a skill hit on a frozen foe; Glacier walls the pack.
    if (st.iceInfuse > 0 && m.proc.rate.ice > 0) {
      const aff = ED.elemMul(t, 'ice'), cr = m.proc.rate.ice * pyreK / ref.statusHp * C.CHILL_K * (1 + st.chillMul) * aff;
      const T = tFoe, spread = st.frostNova ? 1 + 0.6 * Math.min(PACK - 1, 2) : 1, rime = 1 - Math.min(0.9, st.refreeze || 0), df = 1.6 * (1 + st.freezeDur);
      const frz = (c, tm, dfr) => { const tf = 100 / Math.max(1e-9, c); return clamp(tm - tf, 0, tm) / tm * dfr / (dfr + 1.5 * tf * rime); }; // share of a foe's time spent frozen
      const fT = frz(cr * pf * spread, T, df), fB = frz(cr * RES_BOSS, T_ONE, 0.6 * (1 + 0.5 * st.freezeDur));
      const chT = clamp(cr * pf * spread * T / 100, 0, 1) * (1 - fT), chB = clamp(cr * RES_BOSS * T_ONE / 100, 0, 1) * (1 - fB);
      mul1 *= 1 + 0.25 * fB; mulN *= 1 + 0.25 * fT;
      if (st.shatter) { add1 += skOne * fB * st.shatter; addN += skN * fT * (st.shatter + SHATTER_NEAR); }
      if (st.glacier) eMul *= 1 + GLACIER_E * Math.min(fT, 1 - fT); // a frozen foe walls the moving ones: most while about half the pack is frozen
      const red = clamp(0.6 * (fT * FROZEN_FOE + chT * (SLOW_RED + st.chillWeaken)) + 0.4 * (fB * FROZEN_FOE + chB * (SLOW_RED + st.chillWeaken)), 0, E_MAX_RED);
      eMul /= 1 - red;
    }
    // Overload and the other stuns beyond the class's own: Opportunist pays +25% on stunned foes; stunned foes do no damage
    if (st.arcStun > 0 && light1 > 0) {
      const up = Math.min(1, st.arcStun / Math.max(1, st.arcStun + 0.75)) * 0.7;
      eMul /= 1 - Math.min(E_MAX_RED, up * STUN_RED);
      if (st.opportunist) { mul1 *= 1 + st.opportunist * up * 0.5; mulN *= 1 + st.opportunist * up; }
    }
    // Holy shield: the Smite shield refills to its cap; Sanctity raises the cap and the grant
    if (st.holyInfuse > 0 || st.element === 'holy') eMul *= 1 + (st.holyCap - 0.06) * 0.6 + (st.smiteShield - 0.01) * 6;
    // area: melee arcs and blasts catch more of a pack
    if (st.area) { mulN *= 1 + (melee ? 0.3 : 0.12) * st.area; }
    // Seeker Gem: homing shots miss less, melee reach hits first and catches more of a pack
    if (st.homing > 0 && !melee) { mul1 *= 1.08; mulN *= 1.08; }
    if (st.meleeReach > 0 && melee) { mul1 *= 1 + 0.1 * st.meleeReach; mulN *= 1 + 0.3 * st.meleeReach; }
    // guards and sustain the effective health leaves out
    if (st.guardian) eMul *= 1.12;
    if (st.aegis) eMul *= 1.15;
    if (st.mirror) eMul *= 1 + 0.35 * st.mirror;
    if (st.frozenHeart) eMul *= 1.08;
    if (st.angel) eMul *= 1.25;
    if (st.phoenix) eMul *= 1.15;
    if (st.roomWard) eMul *= 1 + 0.5 * st.roomWard;
    if (st.strataHeal) eMul *= 1 + 0.4 * st.strataHeal;
    if (st.chalice) { eMul *= 1.15; mul1 *= 1.04; mulN *= 1.04; }
    eMul *= 1 + 0.002 * st.thorns + 0.35 * (st.spd - 1) + 0.08 * st.dashN + 0.2 * st.dashcdr + 0.1 * st.heal + HEAL_E * FORAGER_HEALS * ED.World.FORAGER * st.forager;
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
  const AT_REST = { toughRoom: false, tranceT: 0, momN: 0, knellT: 0, knellN: 0, glT: 0, glV: 0, auraT: 0, auraV: 0 };
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
  // Flat prior of card id for hero h (after the card) in decision context dc: zero when the card's path is not active; Mutations, the Purse and Hunted have their own.
  function prior(id, h, dc) {
    const b = ED.BOONS[id], st = h.stats;
    if (b.duo) return PRESENT_EL(st, b.duo[0]) && PRESENT_EL(st, b.duo[1]) ? DUO_X : 0;
    if (b.mut) return MUT_X[id] !== undefined ? MUT_X[id] : MUT_DEF;
    if (b.purse) return PURSE_X;
    if (id === 'hunted') return HUNT.card * HUNT.kill * HUNT.fights * Math.max(0, C.STRATA - dc.s + 0.5); // boon cards from the champions of the fights left in the run
    const pr = PRIOR[id];
    return pr && PRESENT_EL(st, pr[0]) ? pr[1] : 0;
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
  // Discounted value of the milestones of h's paths: keystone per path, the best evolution, the duo. gh: the hero the milestone cards are valued on where it holds the path (else h).
  function future(h, dc, gh) {
    const out = { key: {}, evo: 0, duo: 0, total: 0 };
    const gen = ED.isGeneralist(h.boons), paths = gen ? ['general'] : ED.elementGates(h.boons), evoOwned = !!ED.evoOf(h.boons);
    const owns = (x, k) => (k === 'general' ? ED.isGeneralist(x.boons) : ED.elementGates(x.boons).includes(k));
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
    if (!gen && paths.length === 2) {
      const duo = ED.duoOf(paths[0], paths[1]);
      if (duo && !h.boons[duo]) {
        const need = Math.max(0, ED.DUO_AFFINITY - ED.pathAffinity(h.boons, paths[0])) + Math.max(0, ED.DUO_AFFINITY - ED.pathAffinity(h.boons, paths[1]));
        if (feasible(need, Math.min(poolOf(h, paths[0]), poolOf(h, paths[1])) * 2, dc)) {
          const base = gh && owns(gh, paths[0]) && owns(gh, paths[1]) ? gh : h;
          out.duo = Math.pow(GAMMA, need) * Math.max(0, cardGain0(base, duo, dc));
        }
      }
    }
    out.total = out.evo + out.duo;
    for (const k in out.key) out.total += out.key[k];
    return out;
  }

  // ---------------- gain of a card ----------------
  // { gain, dv, df, x, dd, de } for taking boon id with hero p; before: valueOf(p) and future(p). A card that is itself a milestone realises its term, which leaves F.
  function gainOf(p, id, dc, before, fb) {
    const b = ED.BOONS[id], q = ED.Sheet.withBoon(p, id, dc.base), va = valueOf(q, dc);
    let fa = fb;
    if (b.gate || b.key || b.evo || b.duo || (b.path && !b.open)) fa = future(q, dc, b.gate ? null : p);
    let realised = 0;
    if (b.key) realised = fb.key[b.path] || 0; else if (b.evo) realised = fb.evo; else if (b.duo) realised = fb.duo;
    const x = prior(id, q, dc), dv = va.v - before.v, df = fa.total - fb.total + realised;
    return { gain: dv + df + x, dv, df, x, dd: va.d - before.d, de: va.e - before.e };
  }

  const RANDOM_UNIT = 1e-7;
  // Index of the card to take from offer p.offer (spec = the offer's head spec), or -1: reroll. ctx.gatesCap limits element gates; noReroll forbids returning -1.
  function chooseIndex(w, p, spec, rng, ctx, noReroll) {
    const offer = p.offer, dc = decision(w, p), before = valueOf(p, dc), fb = future(p, dc, null), gen = ED.isGeneralist(p.boons), els = ED.elementGates(p.boons);
    const src = spec && spec.src, rows = [];
    let best = -1, bg = -Infinity;
    for (let i = 0; i < offer.length; i++) {
      const id = offer[i], b = ED.BOONS[id];
      const r = gainOf(p, id, dc, before, fb);
      if (b.gate && !gen && b.path !== 'general' && els.length >= (ctx.gatesCap || 2)) r.gain = -1e6; // over the --gates cap a gate is the last choice
      r.id = id;
      rows.push(r);
      const g = r.gain + rng.next() * RANDOM_UNIT;
      if (g > bg) { bg = g; best = i; }
    }
    const rerollable = src !== 'forge' && src !== 'class';
    const reroll = !noReroll && rerollable && p.rerolls > 0 && rows[best].gain < REROLL_MIN;
    if (ctx.explain) explain(w, p, src, dc, before, fb, rows, reroll ? -1 : best);
    return reroll ? -1 : best;
  }

  // Gain of taking relic id now (ln-V units): V(with) - V(without); a Generalist's element relic transmutes into an average one.
  function relicGain(w, p, id) {
    if (ED.relicFits && !ED.relicFits(p, id)) return TRANSMUTE;
    const dc = decision(w, p), q = model.withRelic(p, id, dc.base);
    return valueOf(q, dc).v - valueOf(p, dc).v;
  }
  // The same squashed into [0, 1): 0 for a relic that does not help, gain / (gain + RELIC_HALF) above it.
  function relicValue(w, p, id) { const g = relicGain(w, p, id); return g > 0 ? g / (g + RELIC_HALF) : 0; }

  // ---------------- --explain ----------------
  const f3 = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
  function explain(w, p, src, dc, before, fb, rows, chosen) {
    const el = ED.elementGates(p.boons).join('+') || (ED.isGeneralist(p.boons) ? 'general' : '-');
    const lines = [`[pick] stratum ${w.stratum} ${src || 'level'} #${dc.picks + 1} ${p.cls} ${el} V ${before.v.toFixed(3)} F ${fb.total.toFixed(3)}${p.rerolls ? ' rerolls ' + p.rerolls : ''}`];
    rows.forEach((r, i) => lines.push(`   ${i === chosen ? '>' : ' '} ${ED.BOONS[r.id].name.padEnd(18)} V${f3(r.dv)} (dmg${f3(r.dd)} hp${f3(r.de)}) F${f3(r.df)} X${f3(r.x)} = ${f3(r.gain)}`));
    if (chosen < 0) lines.push('   -> reroll');
    console.log(lines.join('\n'));
  }

  return { chooseIndex, relicValue, relicGain, gainOf, valueOf, decision, future, fold, setLambda, lambdaAt, lever, AT_REST, REROLL_MIN, LAMBDA, GAMMA };
};
