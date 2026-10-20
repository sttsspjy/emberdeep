// Relics: run-long items from chests, shops and bosses. 16 start unlocked; the rest are bought in the Codex.
(function (ED) {
  'use strict';
  const R = ED.RELICS = {
    // ---- starter pool ----
    whetstone: { name: 'Whetstone', rar: 'c', icon: 'sword', desc: '+12% damage.', mods: { dmg: 0.12 }, start: true },
    boots: { name: "Traveler's Boots", rar: 'c', icon: 'boot', desc: '+10% move speed.', mods: { spd: 0.1 }, start: true },
    buckler: { name: 'Iron Buckler', rar: 'c', icon: 'shield', desc: '+8 armor.', mods: { armor: 8 }, start: true },
    heartstone: { name: 'Heartstone', rar: 'c', icon: 'heart', desc: '+25 max health.', mods: { hp: 25 }, start: true },
    coin: { name: 'Lucky Coin', rar: 'c', icon: 'coin', desc: '+30% gold, better boon rarity.', mods: { gold: 0.3, luck: 0.1 }, start: true },
    hourglass: { name: 'Sand Hourglass', rar: 'r', icon: 'hourglass', desc: 'Skill recharges 18% faster.', mods: { cdr: 0.18 }, start: true },
    fang: { name: 'Fang Pendant', rar: 'r', icon: 'fang', desc: 'Kills heal 2 health.', mods: { killHeal: 2 }, start: true },
    embercharm: { name: 'Ember Charm', rar: 'r', icon: 'flame', desc: 'Hits add 15% of their damage as Burn.', mods: { pyreInfuse: 0.15 }, start: true },
    frostshard: { name: 'Frost Shard', rar: 'r', icon: 'snow', desc: 'Hits chill at 40% strength.', mods: { rimeInfuse: 0.4 }, start: true },
    lodestone: { name: 'Lodestone', rar: 'c', icon: 'magnet', desc: '+60% pickup range, +10% experience.', mods: { pickup: 0.6, xp: 0.1 }, start: true },
    pauldron: { name: 'Spiked Pauldron', rar: 'c', icon: 'thorn', desc: 'Attackers take 15 damage.', mods: { thorns: 15 }, start: true },
    wardrum: { name: 'War Drum', rar: 'r', icon: 'drum', desc: '+30% attack speed while below half health.', mods: { wardrum: 0.3 }, start: true },
    phoenix: { name: 'Phoenix Feather', rar: 'l', icon: 'feather', desc: 'Once per descent, rise again at 50% health.', mods: { phoenix: 1 }, start: true },
    stormidol: { name: 'Storm Idol', rar: 'e', icon: 'bolt', desc: 'Critical hits charge foes with 60% of their damage.', mods: { critCharge: 0.6 }, start: true },
    glasseye: { name: 'Glass Eye', rar: 'r', icon: 'eye', desc: '+10% critical chance.', mods: { crit: 0.1 }, start: true },
    elixir: { name: 'Elixir Flask', rar: 'c', icon: 'potion', desc: 'Heal 30% at the start of each stratum. +20% healing.', mods: { strataHeal: 0.3, heal: 0.2 }, start: true },
    // ---- codex unlocks ----
    axe: { name: "Headsman's Axe", rar: 'r', icon: 'axe', desc: '+60% damage to foes below 30% health.', mods: { execute: 0.6 }, cost: 50 },
    cloak: { name: 'Shadow Cloak', rar: 'r', icon: 'cloak', desc: 'Dash recharges 35% faster. +5% dodge.', mods: { dashcdr: 0.35, dodge: 0.05 }, cost: 50 },
    satchel: { name: 'Bomb Satchel', rar: 'r', icon: 'bomb', desc: 'Dashing drops a bomb (200% weapon damage).', mods: { dashBomb: 1 }, cost: 65 },
    lantern: { name: 'Soul Lantern', rar: 'r', icon: 'lantern', desc: '+20% experience and a brighter light.', mods: { xp: 0.2, light: 0.35 }, cost: 45 },
    seeker: { name: 'Seeker Gem', rar: 'e', icon: 'gem', desc: 'Projectiles seek foes. Melee reach +20%.', mods: { homing: 3, meleeReach: 0.2 }, cost: 80 },
    twinfang: { name: 'Twin Fang', rar: 'e', icon: 'twin', desc: 'Every 5th attack strikes twice.', mods: { twinEvery: 5 }, cost: 80 },
    mirror: { name: 'Mirror Shard', rar: 'e', icon: 'mirror', desc: '25% chance to shrug off projectiles.', mods: { mirror: 0.25 }, cost: 80 },
    crown: { name: 'Crown of Choice', rar: 'e', icon: 'crown', desc: 'Boon choices show 4 options.', mods: { choices: 1 }, cost: 105, req: { boss: 2 } },
    idol: { name: 'Golden Idol', rar: 'r', icon: 'idol', desc: '+1% damage for every 15 party gold (max +40%).', mods: { idol: 1 }, cost: 60 },
    wispjar: { name: 'Wisp Jar', rar: 'e', icon: 'orb', desc: 'A spirit wisp fights at your side.', mods: { wisp: 1 }, cost: 80 },
    mask: { name: 'Berserker Mask', rar: 'e', icon: 'mask', desc: '+40% damage, but take 15% more damage.', mods: { dmg: 0.4, vuln: 0.15 }, cost: 70 },
    banner: { name: 'Banner of Unity', rar: 'r', icon: 'banner', desc: '+10% damage, +10% more per ally nearby.', mods: { banner: 0.1 }, cost: 50 },
    angel: { name: 'Guardian Angel', rar: 'l', icon: 'wing', desc: 'Once per stratum, a killing blow leaves you at 1 health instead.', mods: { angel: 1 }, cost: 115, req: { boss: 3 } },
    crest: { name: 'Vampire Crest', rar: 'e', icon: 'drop', desc: 'Overhealing becomes a shield (max 10% max health).', mods: { bloodShield: 0.1 }, cost: 80 },
    gauntlet: { name: 'Thunder Gauntlet', rar: 'e', icon: 'bolt', desc: 'Every 6th attack calls lightning on its target.', mods: { gauntlet: 1 }, cost: 85 },
    frozenheart: { name: 'Frozen Heart', rar: 'e', icon: 'snow', desc: 'When hit, freeze nearby foes (8s cooldown).', mods: { frozenHeart: 1 }, cost: 80 },
    chalice: { name: 'Blood Chalice', rar: 'l', icon: 'chalice', desc: '+1 max health per 3 kills this descent (max +60).', mods: { chalice: 1 }, cost: 115, req: { boss: 4 } },
    skull: { name: 'Cursed Skull', rar: 'l', icon: 'skull', desc: 'Take 30% more damage. Earn 50% more embers this descent.', mods: { vuln: 0.3, emberBonus: 0.5 }, cost: 90 },
    ledger: { name: "Merchant's Ledger", rar: 'r', icon: 'scroll', desc: 'Shop prices are 25% lower.', mods: { discount: 0.25 }, cost: 50 },
    stone: { name: "Philosopher's Stone", rar: 'l', icon: 'gem', desc: '+5% damage and +5 max health per relic held.', mods: { stone: 1 }, cost: 130, req: { boss: 5 } },
    clover: { name: 'Four-Leaf Clover', rar: 'r', icon: 'clover', desc: '+1 boon reroll each stratum and better rarity.', mods: { cloverRerolls: 1, luck: 0.1 }, cost: 60 },
    aegis: { name: 'Aegis Charm', rar: 'e', icon: 'shieldgold', desc: 'Every 10 seconds, block the next hit completely.', mods: { aegis: 1 }, cost: 85 },
    // appended: the save code indexes non-start relics by position
    brazier: { name: 'Brazier Heart', rar: 'r', icon: 'flame', desc: 'Burn deals +40% damage.', mods: { burnMul: 0.4 }, cost: 70 },
    glaciercore: { name: 'Glacier Core', rar: 'r', icon: 'snow', desc: 'Freeze lasts 40% longer.', mods: { freezeDur: 0.4 }, cost: 70 },
    lightningrod: { name: 'Lightning Rod', rar: 'r', icon: 'bolt', desc: 'Discharges arc to 1 more foe.', mods: { arcs: 1 }, cost: 70 },
    bloodstone: { name: 'Bloodstone', rar: 'r', icon: 'drop', desc: '+10% max health.', mods: { hpMul: 0.1 }, cost: 60 },
  };
  ED.RELIC_IDS = Object.keys(R);
  ED.RELIC_IDX = ED.U.indexer(ED.RELIC_IDS);
  ED.RELIC_PRICE = { c: 70, r: 110, e: 160, l: 220 };
})(globalThis.ED || (globalThis.ED = {}));
