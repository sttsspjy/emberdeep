// Meta progression: Hearth upgrades, per-hero Armory, Pacts (ascension), Deeds (achievements), hero mastery.
(function (ED) {
  'use strict';

  // tier = deepest stratum that must have been reached before the upgrade is offered. Hearth and mastery carry the difficulty contract's progression (docs/GAME-DESIGN.md sections 9 and 10).
  // Entries with `mods` add to the stat block per rank; the rest are read by id in sim/build.js (Provisions `heal`, Head Start `xp`, Stash `gold`, Second Wind `pct`, Insight `rerolls`), rooms.js (Merchant's Favor `discount`) and world.js (Deep Wick `loot`, via W.prototype.darkLoot).
  // The save code stores ranks by position and never reads ids: keep the order and each costs.length.
  ED.UPGRADES = [
    { id: 'vitality', name: 'Vitality', icon: 'heart', tier: 1, desc: r => `+${2 * r} max health`, mods: { hp: 2 }, step: '+2 max health', costs: [10, 20, 35, 55, 80] },
    { id: 'might', name: 'Might', icon: 'sword', tier: 1, desc: r => `+${3 * r}% damage`, mods: { dmg: 0.03 }, step: '+3% damage', costs: [12, 25, 45, 70, 100] },
    { id: 'fortune', name: 'Fortune', icon: 'coin', tier: 1, desc: r => `+${2 * r}% gold`, mods: { gold: 0.02 }, step: '+2% gold', costs: [15, 30, 50] },
    { id: 'fleet', name: 'Fleetness', icon: 'boot', tier: 1, desc: r => `+${r}% move speed`, mods: { spd: 0.01 }, step: '+1% move speed', costs: [10, 25, 45] },
    { id: 'provisions', name: 'Provisions', icon: 'potion', tier: 1, desc: r => `Heal ${2 * r}% at each stratum`, heal: 0.02, step: 'Heal 2% at each stratum', costs: [25, 55] },
    { id: 'bulwark', name: 'Bulwark', icon: 'shield', tier: 2, desc: r => `+${3 * r} armor`, mods: { armor: 3 }, step: '+3 armor', costs: [15, 30, 55] },
    { id: 'precision', name: 'Precision', icon: 'eye', tier: 2, desc: r => `+${2 * r}% critical chance`, mods: { crit: 0.02 }, step: '+2% critical chance', costs: [15, 30, 55] },
    { id: 'wisdom', name: 'Wisdom', icon: 'scroll', tier: 2, desc: r => `+${2 * r}% experience`, mods: { xp: 0.02 }, step: '+2% experience', costs: [15, 30, 55] },
    { id: 'insight', name: 'Insight', icon: 'clover', tier: 2, rerolls: [1, 2, 3], desc: r => `${r} boon reroll${r === 1 ? '' : 's'} per descent`, step: '+1 boon reroll per descent', costs: [25, 50, 90] },
    { id: 'headstart', name: 'Head Start', icon: 'star', tier: 2, xp: 15, desc: r => `Begin the descent with ${15 * r} experience`, step: 'Begin with 15 more experience', costs: [15, 35] },
    { id: 'alacrity', name: 'Alacrity', icon: 'hourglass', tier: 3, desc: r => `Skills recharge ${3 * r}% faster`, mods: { cdr: 0.03 }, step: 'Skills recharge 3% faster', costs: [20, 40, 65] },
    { id: 'stash', name: 'Stash', icon: 'chest', tier: 3, gold: 5, desc: r => `Begin with ${5 * r} gold`, step: 'Begin with 5 more gold', costs: [20, 45] },
    { id: 'attunement', name: 'Ember Attunement', icon: 'ember', tier: 3, desc: r => `+${10 * r}% embers earned`, step: '+10% embers earned', costs: [80, 160, 255, 385] },
    { id: 'favor', name: "Merchant's Favor", icon: 'scroll', tier: 3, desc: r => `Shops are ${4 * r}% cheaper`, discount: 0.04, step: 'Shops are 4% cheaper', costs: [30, 65] },
    { id: 'secondwind', name: 'Second Wind', icon: 'feather', tier: 4, pct: [0.05, 0.1], desc: r => (r ? `Once per descent, outside boss fights, revive at ${r >= 2 ? 10 : 5}% health` : 'Once per descent, outside boss fights, revive'), step: 'Revive once per descent outside boss fights (rank 2: 10% health)', costs: [90, 200] },
    { id: 'deepwick', name: 'Deep Wick', icon: 'skull', tier: 1, loot: 0.1, desc: r => `+${10 * r}% gold and experience from dark rooms`, step: '+10% gold and experience from dark rooms', costs: [40, 90, 160] },
  ];
  ED.UPGRADE_IDX = ED.U.indexer(ED.UPGRADES.map(u => u.id));

  // Armory: per-hero weapon variants bought in the Upgrades page, { id (= the variant's ED.WEAPONS key), weapon (its base weapon), name, desc, cost }; an owned variant is a weapon choice of its own. The save code stores one bit per entry by position (a 6-bit count per hero): append only.
  // Each hero's list is ordered by its base weapon's index; the cost is 40 / 60 / 80 embers for a variant of weapon 0 / 1 / 2.
  const V = (cls, id) => { const w = ED.WEAPONS[id]; return { id, weapon: w.variant, name: w.name, desc: w.desc, cost: 40 + 20 * ED.weaponIndex(cls, id) }; };
  ED.ARMORY = {
    knight: [
      V('knight', 'armingsword'), V('knight', 'earthbreaker'), V('knight', 'hookglaive'),
    ],
    ranger: [
      V('ranger', 'seekerbow'), V('ranger', 'boltthrower'), V('ranger', 'burstbows'),
    ],
    pyro: [
      V('pyro', 'sunlance'), V('pyro', 'cinderscatter'), V('pyro', 'mortar'),
    ],
    shade: [
      V('shade', 'katars'), V('shade', 'boomerang'), V('shade', 'chainsickle'),
    ],
    cleric: [
      V('cleric', 'radiantmace'), V('cleric', 'gavel'), V('cleric', 'votive'),
    ],
    necro: [
      V('necro', 'splinter'), V('necro', 'gravewhirl'), V('necro', 'miasma'),
    ],
  };
  // The weapon a hero wields for a stored choice `id`: a base weapon unlocked at mastery level ml, or a variant whose id is in `owned` (the meta bundle's armory ids) and whose base is unlocked;
  // anything else falls back to the base weapon when that is unlocked, else to weapon 0.
  ED.weaponPick = (cls, id, ml, owned) => {
    const list = ED.CLASSES[cls].weapons, i = ED.weaponIndex(cls, id);
    if (i < 0 || !ED.weaponUnlocked(cls, i, ml)) return list[0];
    return id === list[i] || (owned && owned.indexOf(id) >= 0) ? id : list[i];
  };
  // The weapon choices of a hero: each base weapon followed by its Armory variants.
  ED.weaponChoices = (cls) => {
    const out = [];
    for (const b of ED.CLASSES[cls].weapons) { out.push(b); for (const e of ED.ARMORY[cls] || []) if (e.weapon === b) out.push(e.id); }
    return out;
  };

  ED.PACTS = [
    { name: 'No Pact', desc: 'The Deep as it is.' },
    { name: 'Thicker Hides', desc: 'Foes have +15% health.', foeHp: 1.15 },
    { name: 'Sharper Fangs', desc: 'Foes deal +15% damage.', foeDmg: 1.15 },
    { name: 'Champions', desc: 'Elite foes appear far more often.', eliteCh: 0.4, eliteExtra: 0.5 },
    { name: 'Scarcity', desc: 'Healing is 50% less effective and heroes have 6% less max health.', heroMul: { heal: 0.5 }, mods: { hpMul: -0.06 } },
    { name: 'Tyrants', desc: 'Bosses have +20% health and attack faster.', bossHp: 1.2, bossPause: 0.8 },
    { name: 'Frenzy', desc: 'Foes move 15% faster.' },
    { name: 'Greed', desc: 'Shop prices are 40% higher.' },
    { name: 'Storm of Shot', desc: 'Enemy shots fly 20% faster and foes hit 20% harder.', foeDmg: 1.2 },
    { name: 'Frailty', desc: 'Heroes have 25% less max health.', mods: { hpMul: -0.25 } },
    { name: 'The Deep Hungers', desc: 'Every combat room has an extra wave and foes have +20% health.', foeHp: 1.2 },
  ];
  ED.PACT_EMBER_BONUS = 0.08; // per pact level
  // Pact stat effects (pacts stack): mods are added to the stat block, heroMul factors multiply a derived stat (ED.Stats.compute / sources); foeHp, foeDmg, bossHp, bossPause multiply foe numbers (ED.pactMul);
  // Champions' eliteCh / eliteExtra add to the elite chances of a combat room (rooms.js).
  // Product of field `key` over Pacts 1..pact (1 where a Pact has none).
  ED.pactMul = (pact, key) => { let m = 1; for (let i = 1; i <= pact && i < ED.PACTS.length; i++) if (ED.PACTS[i][key]) m *= ED.PACTS[i][key]; return m; };

  // Mastery XP thresholds for levels 1..10.
  ED.MASTERY_XP = [0, 120, 300, 550, 850, 1200, 1650, 2200, 2850, 3600];
  // Stat mods a mastery level adds (every level up to the hero's own applies); ED.MASTERY_REWARDS is the text. Level 8 gives one boon reroll (sim/build.js).
  ED.MASTERY_MODS = { 2: { dmg: 0.01 }, 4: { hp: 1 }, 5: { cdr: 0.01 }, 7: { crit: 0.03 }, 9: { dmg: 0.08 }, 10: { hp: 4 } };
  ED.MASTERY_REWARDS = [
    null,
    'Hero unlocked',
    '+1% damage',
    'Second weapon',
    '+1 max health',
    'Skills recharge 1% faster',
    'Third weapon',
    '+3% critical chance',
    '+1 boon reroll per descent',
    '+8% damage',
    '+4 max health; Gilded: a golden aura',
  ];
  ED.masteryLevel = (xp) => { let l = 1; for (let i = 0; i < ED.MASTERY_XP.length; i++) if (xp >= ED.MASTERY_XP[i]) l = i + 1; return l; };

  // Deeds: one-time achievements with ember rewards. check(profile, run?) runs at run end and after purchases.
  const bossDeed = (id, name, i, reward) => ({ id, name, desc: `Defeat ${ED.ENEMIES[ED.BIOMES[i].boss].name}`, icon: 'skull', reward, check: p => !!(p.bosses & (1 << i)) });
  ED.DEEDS = [
    { id: 'firstblood', name: 'First Blood', desc: 'Slay 50 foes', icon: 'sword', reward: 15, check: p => p.stats.kills >= 50 },
    bossDeed('gravedigger', 'Gravedigger', 0, 20),
    bossDeed('weedkiller', 'Weedkiller', 1, 30),
    bossDeed('thaw', 'The Thaw', 2, 40),
    bossDeed('quenched', 'Quenched', 3, 50),
    bossDeed('lowtide', 'Low Tide', 4, 60),
    { id: 'uncrowned', name: 'Uncrowned', desc: 'Defeat the Hollow King and complete a descent', icon: 'crown', reward: 100, check: p => p.stats.wins >= 1 },
    { id: 'slayer', name: 'Slayer', desc: 'Slay 1,000 foes', icon: 'axe', reward: 50, check: p => p.stats.kills >= 1000 },
    { id: 'legend', name: 'Legend of the Deep', desc: 'Slay 5,000 foes', icon: 'axe', reward: 120, check: p => p.stats.kills >= 5000 },
    { id: 'fellowship', name: 'Fellowship', desc: 'Clear a stratum with a party', icon: 'banner', reward: 30, check: (p, run) => run && run.party > 1 && run.stratum >= 2 },
    { id: 'rescue', name: 'No One Left Behind', desc: 'Revive a fallen ally', icon: 'heart', reward: 25, check: (p, run) => run && run.revives > 0 },
    { id: 'untouched', name: 'Untouched', desc: 'Defeat a boss without being hit', icon: 'shieldgold', reward: 40, check: (p, run) => run && run.flawlessBoss },
    { id: 'hoard', name: "Dragon's Hoard", desc: 'Hold 400 gold at once', icon: 'coin', reward: 30, check: (p, run) => run && run.maxGold >= 400 },
    { id: 'collector', name: 'Collector', desc: 'Hold 8 relics in one descent', icon: 'chest', reward: 40, check: (p, run) => run && run.maxRelics >= 8 },
    { id: 'ascendant', name: 'Ascendant Soul', desc: 'Reach level 20 in one descent', icon: 'star', reward: 50, check: (p, run) => run && run.level >= 20 },
    { id: 'swift', name: 'Swift Descent', desc: 'Complete a descent in under 15 minutes', icon: 'hourglass', reward: 50, check: (p, run) => run && run.victory && run.time < 900 },
    { id: 'pact1', name: 'Pact Sworn', desc: 'Complete a descent under Pact 1+', icon: 'ember', reward: 60, check: p => p.pactWin >= 1 },
    { id: 'pact5', name: 'Pact Bound', desc: 'Complete a descent under Pact 5+', icon: 'ember', reward: 120, check: p => p.pactWin >= 5 },
    { id: 'pact10', name: 'Abyss-Touched', desc: 'Complete a descent under Pact 10', icon: 'ember', reward: 250, check: p => p.pactWin >= 10 },
    { id: 'master', name: 'Master', desc: 'Reach mastery 10 with any hero', icon: 'star', reward: 100, check: p => p.mastery.some(x => ED.masteryLevel(x) >= 10) },
    { id: 'manyfaces', name: 'Many Faces', desc: 'Unlock all six heroes', icon: 'mask', reward: 60, check: p => ED.CLASS_IDS.every(c => ED.Save.classUnlocked(p, c)) },
    { id: 'archivist', name: 'Relic Keeper', desc: 'Hold 10 relics in one descent', icon: 'scroll', reward: 60, check: (p, run) => run && run.maxRelics >= 10 },
    { id: 'hearthkeeper', name: 'Hearthkeeper', desc: 'Buy 25 Hearth upgrade ranks', icon: 'ember', reward: 80, check: p => p.up.reduce((a, b) => a + b, 0) >= 25 },
    { id: 'evolved', name: 'Evolved', desc: 'Evolve a weapon', icon: 'wing', reward: 40, check: (p, run) => run && run.evolved },
    { id: 'intothedark', name: 'Into the Dark', desc: 'Clear 6 dark rooms in one descent', icon: 'eye', reward: 50, check: (p, run) => run && run.darkCleared >= 6 },
    { id: 'cartographer', name: 'Cartographer', desc: 'Clear every room of a stratum, both its dark rooms included', icon: 'scroll', reward: 40, check: (p, run) => run && run.fullClear },
  ];
  ED.DEED_IDX = ED.U.indexer(ED.DEEDS.map(d => d.id));

  ED.LORE = [
    'The first delvers dug for embers: shards of a fallen star that burn without fuel. They dug too deep.',
    'The fungus of the Glowmire grew on the delvers who stayed. It learned their voices.',
    'The dwarf-king of Rimefrost froze his own hall rather than let the Deep climb through it.',
    'The Cinderforge smelted embers into weapons for an empire that no longer exists.',
    'The Sanctum priests prayed to the sea to drown the Deep. The sea listened, then kept going.',
    'At the bottom, the fallen star still beats. The Hollow King wears its husk as a crown.',
  ];
})(globalThis.ED || (globalThis.ED = {}));
