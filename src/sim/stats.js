// Derives a hero's stat block from class, weapon, Hearth upgrades, mastery, pact, boons and relics.
// Pure and deterministic: the host and each client compute identical numbers from the same build.
(function (ED) {
  'use strict';
  const U = ED.U;
  const St = ED.Stats = {};

  const BASE = () => ({
    hp: 0, hpMul: 1, armor: 0, spd: 1, dmg: 1, atk: 1, crit: 0, critDmg: 0, cdr: 0,
    pickup: 0, xp: 0, gold: 0, luck: 0, heal: 0, projN: 0, pierce: 0, area: 0, dodge: 0, thorns: 0,
    dashcdr: 0, dashDmg: 0, dashFire: 0, dashBomb: 0, execute: 0,
    overcharge: 0, guardian: 0, trance: 0, forager: 0, roomWard: 0, openRank: 0,
    charges: 0, shieldwall: 0, quake: 0, mark: 0, combust: 0, phoenixNova: 0, decoy: 0, wrath: 0,
    minions: 0, minionDmg: 0, boneSpikes: 0, phoenix: 0, strataHeal: 0, wardrum: 0,
    homing: 0, meleeReach: 0, mirror: 0, choices: 0, idol: 0, vuln: 0, banner: 0, angel: 0, gauntlet: 0,
    frozenHeart: 0, chalice: 0, emberBonus: 0, discount: 0, stone: 0, cloverRerolls: 0, aegis: 0, light: 0,
    // status route hooks (+X% to every status amount the hero applies; +X% to class-element skill hits)
    statusPow: 0, classElMul: 0,
    // element infusions and their payoffs: Fire, Ice, Lightning, Poison, Holy, Shadow, General (Bleed)
    fireInfuse: 0, burnMul: 0, searing: 0, wildfire: 0, conflag: 0,
    iceInfuse: 0, chillMul: 0, shatter: 0, brittle: 0, dashFrost: 0, freezeDur: 0, chillWeaken: 0, frostNova: 0,
    lightningInfuse: 0, arcs: 0, arcRange: 0, shockMul: 0, shortCircuit: 0, arcStun: 0, thunderbolt: 0, critCharge: 0,
    poisonInfuse: 0, venomBuild: 0, venomHold: 0, corrode: 0, fester: 0, sporeBurst: 0, dashVenom: 0, pandemic: 0,
    holyInfuse: 0, smiteMul: 0, smiteShield: 0.01, holyCap: 0.06, beacon: 0, dashBlind: 0, radiantAegis: 0, // smiteShield and holyCap start at the base every hero smites with
    shadowInfuse: 0, doomMul: 0, doomTough: 0, malice: 0, knell: 0, deathsEdge: 0, dashDoom: 0, reaper: 0,
    bleed: 0, bleedMul: 0, lacerate: 0, sunder: 0, opportunist: 0, masterstroke: 0, twinEvery: 0,
    // duos
    thermal: 0, plasma: 0, supercond: 0, firedamp: 0, sunfire: 0, blackflame: 0, cryotoxin: 0, hoarlight: 0, blackice: 0, galvanic: 0, heavenwrath: 0, blackLight: 0, purge: 0, necrosis: 0, twilight: 0,
  });

  // Skill cooldown reduction: full up to CDR_SOFT, half above it, never more than CDR_MAX.
  St.CDR_SOFT = 0.4; St.CDR_MAX = 0.65;
  St.cdrEff = (c) => (c <= St.CDR_SOFT ? Math.max(0, c) : Math.min(St.CDR_MAX, St.CDR_SOFT + (c - St.CDR_SOFT) * 0.5));

  // build: { cls, weapon, boons: {id: n}, relics: [id], meta: { up: [], mastery }, pact, chaliceHp, bonusHp }
  St.compute = (build) => {
    const cls = ED.CLASSES[build.cls];
    const wpn = ED.WEAPONS[build.weapon];
    const s = BASE();
    s.hp = cls.hp; s.armor = cls.armor; s.crit = cls.crit;
    const meta = build.meta || { up: [], mastery: 1 };
    const rk = (id) => (meta.up && meta.up[ED.UPGRADE_IDX[id]]) || 0;
    s.hp += 6 * rk('vitality');
    s.dmg += 0.04 * rk('might');
    s.gold += 0.1 * rk('fortune');
    s.spd += 0.04 * rk('fleet');
    s.armor += 2 * rk('bulwark');
    s.crit += 0.02 * rk('precision');
    s.xp += 0.05 * rk('wisdom');
    s.cdr += 0.04 * rk('alacrity');
    const ml = meta.mastery || 1;
    if (ml >= 2) s.dmg += 0.05;
    if (ml >= 4) s.hp += 10;
    if (ml >= 5) s.cdr += 0.08;
    if (ml >= 7) s.crit += 0.04;
    if (ml >= 9) s.dmg += 0.08;
    if ((build.pact || 0) >= 9) s.hpMul -= 0.25;
    const add = (mods, n) => { for (const k in mods) s[k] = (s[k] || 0) + mods[k] * n; };
    const boons = build.boons || {};
    for (const id in boons) if (ED.BOONS[id]) add(ED.BOONS[id].mods, boons[id]);
    const relics = build.relics || [];
    for (const id of relics) if (ED.RELICS[id]) add(ED.RELICS[id].mods, 1);
    if (s.stone) { s.dmg += 0.02 * relics.length; s.hp += 2 * relics.length; }
    s.hp += (build.chaliceHp || 0) + (build.bonusHp || 0);
    if (s.chalice && (build.chaliceHp || 0) >= 30) s.dmg += 0.1; // Grail of Ages: a full chalice adds damage

    const out = s;
    out.power = cls.power; out.element = cls.element || null; // Class Power scales every non-attack proc (ED.procDmg)
    out.maxHp = Math.max(20, Math.round(s.hp * Math.max(0.3, s.hpMul)));
    out.moveSpeed = cls.spd * U.clamp(s.spd, 0.5, 2.2);
    out.atkInterval = wpn.rate / Math.max(0.3, s.atk);
    const cdr = St.cdrEff(s.cdr);
    out.skillCd = ED.SKILLS[cls.skill].cd * (1 - cdr);
    out.skill2Cd = cls.skill2 && ED.SKILLS[cls.skill2] ? ED.SKILLS[cls.skill2].cd * (1 - cdr) : 0;
    out.dashCd = 1.1 * Math.max(0.3, 1 - s.dashcdr);
    out.pickupR = 46 * (1 + s.pickup);
    out.critMult = 1.75 + s.critDmg;
    out.crit = Math.min(0.95, s.crit);
    out.dodge = Math.min(0.6, s.dodge);
    out.healMul = (1 + s.heal) * ((build.pact || 0) >= 4 ? 0.6 : 1);
    out.maxCharges = 1 + (s.charges > 0 ? 1 : 0);
    out.maxMinions = 3 + s.minions;
    out.lightR = 200 * (1 + s.light);
    out.evo = ED.evoOf ? ED.evoOf(boons) : null;
    out.weapon = wpn;
    out.kind = wpn.kind;
    out.melee = wpn.kind === 'melee';
    return out;
  };

  // Damage-reduction from armor: 60 armor halves incoming damage.
  St.armorMul = (armor) => 60 / (60 + Math.max(0, armor));

  // Dynamic rates. Attack interval = stats.atkInterval / attackRate(p); movement speed = stats.moveSpeed * moveRate(p).
  // War Drum (wardrum) doubles in elite and boss rooms (p.toughRoom).
  St.attackRate = (p) => {
    const s = p.stats;
    return 1 + (p.tranceT > 0 ? s.trance : 0) + s.wardrum * (p.toughRoom ? 2 : 1);
  };
  St.moveRate = (p) => 1;
})(globalThis.ED || (globalThis.ED = {}));
