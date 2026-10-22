// Relics: run-long items from chests, shops and bosses. Every relic is in the drop pool from the first descent; element effects are path boons (boons.js).
// pw { base, k } is a proc damage of base + k x Class Power (ED.procDmg).
(function (ED) {
  'use strict';
  const R = ED.RELICS = {
    whetstone: { name: 'Whetstone', rar: 'c', icon: 'sword', desc: '+12% damage.', mods: { dmg: 0.12 } },
    boots: { name: "Traveler's Boots", rar: 'c', icon: 'boot', desc: '+10% move speed.', mods: { spd: 0.1 } },
    buckler: { name: 'Iron Buckler', rar: 'c', icon: 'shield', desc: '+8 armor.', mods: { armor: 8 } },
    heartstone: { name: 'Heartstone', rar: 'c', icon: 'heart', desc: '+25 max health.', mods: { hp: 25 } },
    coin: { name: 'Lucky Coin', rar: 'c', icon: 'coin', desc: '+30% gold, better boon rarity.', mods: { gold: 0.3, luck: 0.1 } },
    hourglass: { name: 'Sand Hourglass', rar: 'r', icon: 'hourglass', desc: 'Skills recharge 18% faster.', mods: { cdr: 0.18 } },
    lodestone: { name: 'Lodestone', rar: 'c', icon: 'magnet', desc: '+60% pickup range, +10% experience.', mods: { pickup: 0.6, xp: 0.1 } },
    pauldron: { name: 'Spiked Pauldron', rar: 'c', icon: 'thorn', desc: 'Attackers take 15 damage.', mods: { thorns: 15 } },
    wardrum: { name: 'War Drum', rar: 'r', icon: 'drum', desc: '+10% attack speed, +20% in elite and boss rooms.', mods: { wardrum: 0.1 } },
    phoenix: { name: 'Phoenix Feather', rar: 'l', icon: 'feather', desc: 'Once per descent, rise again at 50% health in a blast of fire.', mods: { phoenix: 1 }, pw: { base: 40, k: 2 } },
    glasseye: { name: 'Glass Eye', rar: 'r', icon: 'eye', desc: '+10% critical chance.', mods: { crit: 0.1 } },
    elixir: { name: 'Elixir Flask', rar: 'c', icon: 'potion', desc: 'Heal 20% at the start of each stratum. +10% healing.', mods: { strataHeal: 0.2, heal: 0.1 } },
    axe: { name: "Headsman's Axe", rar: 'r', icon: 'axe', desc: '+60% damage to foes below 30% health.', mods: { execute: 0.6 } },
    cloak: { name: 'Shadow Cloak', rar: 'r', icon: 'cloak', desc: 'Dash recharges 35% faster. +5% dodge.', mods: { dashcdr: 0.35, dodge: 0.05 } },
    satchel: { name: 'Bomb Satchel', rar: 'r', icon: 'bomb', desc: 'Dashing drops a bomb (200% Power).', mods: { dashBomb: 1 }, pw: { k: 2 } },
    lantern: { name: 'Soul Lantern', rar: 'r', icon: 'lantern', desc: '+20% experience and a brighter light.', mods: { xp: 0.2, light: 0.35 } },
    seeker: { name: 'Seeker Gem', rar: 'e', icon: 'gem', desc: 'Projectiles seek foes. Melee reach +20%.', mods: { homing: 3, meleeReach: 0.2 } },
    twinfang: { name: 'Twin Fang', rar: 'e', icon: 'twin', desc: 'Every 5th attack strikes twice.', mods: { twinEvery: 5 } },
    mirror: { name: 'Mirror Shard', rar: 'e', icon: 'mirror', desc: '25% chance to shrug off projectiles.', mods: { mirror: 0.25 } },
    crown: { name: 'Crown of Choice', rar: 'e', icon: 'crown', desc: 'Boon choices show 4 options.', mods: { choices: 1 } },
    idol: { name: 'Golden Idol', rar: 'r', icon: 'idol', desc: '+1% damage for every 15 party gold (max +20%).', mods: { idol: 1 } },
    mask: { name: 'Berserker Mask', rar: 'e', icon: 'mask', desc: '+40% damage, but take 15% more damage.', mods: { dmg: 0.4, vuln: 0.15 } },
    banner: { name: 'Banner of Unity', rar: 'r', icon: 'banner', desc: '+10% damage, +10% more per ally nearby.', mods: { banner: 0.1 } },
    angel: { name: 'Guardian Angel', rar: 'l', icon: 'wing', desc: 'Once per stratum, a killing blow leaves you at 1 health instead.', mods: { angel: 1 } },
    chalice: { name: 'Grail of Ages', rar: 'l', icon: 'chalice', desc: '+1 max health per 3 kills this descent (max +30; growth does not heal). At +30: +10% damage.', mods: { chalice: 1 }, full: { hp: 30, mods: { dmg: 0.1 } } },
    skull: { name: 'Cursed Skull', rar: 'l', icon: 'skull', desc: 'Take 30% more damage. Earn 50% more embers this descent.', mods: { vuln: 0.3, emberBonus: 0.5 } },
    ledger: { name: "Merchant's Ledger", rar: 'r', icon: 'scroll', desc: 'Shop prices are 25% lower.', mods: { discount: 0.25 } },
    stone: { name: "Philosopher's Stone", rar: 'l', icon: 'gem', desc: '+2% damage and +2 max health per relic held.', mods: { stone: 1 }, perRelic: { dmg: 0.02, hp: 2 } },
    clover: { name: 'Four-Leaf Clover', rar: 'r', icon: 'clover', desc: '+1 boon reroll each stratum and better rarity.', mods: { cloverRerolls: 1, luck: 0.1 } },
    aegis: { name: 'Aegis Charm', rar: 'e', icon: 'shieldgold', desc: 'Every 10 seconds, block the next hit completely.', mods: { aegis: 1 } },
    bloodstone: { name: 'Heartwood', rar: 'r', icon: 'heart', desc: '+10% max health and +10% healing.', mods: { hpMul: 0.1, heal: 0.1 } },
  };
  ED.RELIC_IDS = Object.keys(R);
  ED.RELIC_PRICE = { c: 70, r: 110, e: 160, l: 220 };
})(globalThis.ED || (globalThis.ED = {}));
