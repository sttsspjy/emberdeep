// Derives a hero's stat block from class, weapon, Hearth upgrades, mastery, pact, boons and relics.
// Pure and deterministic: the host and each client compute identical numbers from the same build.
(function (ED) {
  'use strict';
  const U = ED.U;
  const St = ED.Stats = {};

  const BASE = () => ({
    hp: 0, hpMul: 1, armor: 0, spd: 1, dmg: 1, atk: 1, crit: 0, critDmg: 0, cdr: 0, leech: 0, regen: 0,
    pickup: 0, xp: 0, gold: 0, luck: 0, heal: 0, projN: 0, pierce: 0, area: 0, dodge: 0, thorns: 0,
    burn: 0, chill: 0, chain: 0, dashcdr: 0, dashDmg: 0, dashFire: 0, dashBomb: 0, execute: 0, momentum: 0,
    hearts: 0, orbit: 0, wisp: 0, burst: 0, twin: 0, overcharge: 0, guardian: 0, trance: 0, killHeal: 0,
    charges: 0, shieldwall: 0, quake: 0, mark: 0, storm: 0, combust: 0, phoenixNova: 0, decoy: 0, wrath: 0,
    blessed: 0, minions: 0, minionDmg: 0, boneSpikes: 0, phoenix: 0, critChain: 0, strataHeal: 0, wardrum: 0,
    homing: 0, meleeReach: 0, mirror: 0, choices: 0, idol: 0, vuln: 0, banner: 0, angel: 0, gauntlet: 0,
    frozenHeart: 0, chalice: 0, emberBonus: 0, discount: 0, stone: 0, cloverRerolls: 0, aegis: 0, light: 0,
  });

  // build: { cls, weapon, boons: {id: n}, relics: [id], meta: { up: [], mastery }, pact, chaliceHp, bonusHp }
  St.compute = (build) => {
    const cls = ED.CLASSES[build.cls];
    const wpn = ED.WEAPONS[build.weapon];
    const s = BASE();
    s.hp = cls.hp; s.armor = cls.armor; s.crit = cls.crit;
    const meta = build.meta || { up: [], mastery: 1 };
    const rk = (id) => (meta.up && meta.up[ED.UPGRADE_IDX[id]]) || 0;
    s.hp += 10 * rk('vitality');
    s.dmg += 0.05 * rk('might');
    s.gold += 0.1 * rk('fortune');
    s.spd += 0.04 * rk('fleet');
    s.armor += 3 * rk('bulwark');
    s.crit += 0.03 * rk('precision');
    s.xp += 0.1 * rk('wisdom');
    s.cdr += 0.06 * rk('alacrity');
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
    if (s.stone) { s.dmg += 0.05 * relics.length; s.hp += 5 * relics.length; }
    s.hp += (build.chaliceHp || 0) + (build.bonusHp || 0);

    const out = s;
    out.maxHp = Math.max(20, Math.round(s.hp * Math.max(0.3, s.hpMul)));
    out.moveSpeed = cls.spd * U.clamp(s.spd, 0.5, 2.2);
    out.atkInterval = wpn.rate / Math.max(0.3, s.atk);
    out.skillCd = ED.SKILLS[cls.skill].cd * Math.max(0.35, 1 - s.cdr);
    out.dashCd = 1.1 * Math.max(0.3, 1 - s.dashcdr);
    out.pickupR = 46 * (1 + s.pickup);
    out.critMult = 1.75 + s.critDmg;
    out.crit = Math.min(0.95, s.crit);
    out.dodge = Math.min(0.6, s.dodge);
    out.healMul = (1 + s.heal) * ((build.pact || 0) >= 4 ? 0.6 : 1);
    out.maxCharges = 1 + (s.charges > 0 ? 1 : 0);
    out.maxMinions = 3 + s.minions;
    out.lightR = 200 * (1 + s.light);
    out.weapon = wpn;
    out.kind = wpn.kind;
    out.melee = wpn.kind === 'melee';
    return out;
  };

  // Damage-reduction from armor: 60 armor halves incoming damage.
  St.armorMul = (armor) => 60 / (60 + Math.max(0, armor));
})(globalThis.ED || (globalThis.ED = {}));
