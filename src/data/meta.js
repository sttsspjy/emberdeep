// Meta progression: Hearth upgrades, Pacts (ascension), Deeds (achievements), hero mastery.
(function (ED) {
  'use strict';

  // tier = deepest stratum that must have been reached before the upgrade is offered.
  ED.UPGRADES = [
    { id: 'vitality', name: 'Vitality', icon: 'heart', tier: 1, desc: r => `+${6 * r} max health`, mods: { hp: 6 }, step: '+6 max health', costs: [25, 50, 80, 130, 190] },
    { id: 'might', name: 'Might', icon: 'sword', tier: 1, desc: r => `+${4 * r}% damage`, mods: { dmg: 0.04 }, step: '+4% damage', costs: [30, 65, 105, 160, 240] },
    { id: 'fortune', name: 'Fortune', icon: 'coin', tier: 1, desc: r => `+${10 * r}% gold`, mods: { gold: 0.1 }, step: '+10% gold', costs: [25, 55, 95] },
    { id: 'fleet', name: 'Fleetness', icon: 'boot', tier: 1, desc: r => `+${4 * r}% move speed`, mods: { spd: 0.04 }, step: '+4% move speed', costs: [30, 70, 130] },
    { id: 'provisions', name: 'Provisions', icon: 'potion', tier: 1, desc: r => `Heal ${10 * r}% at each stratum`, step: 'Heal 10% at each stratum', costs: [65, 145] },
    { id: 'bulwark', name: 'Bulwark', icon: 'shield', tier: 2, desc: r => `+${2 * r} armor`, mods: { armor: 2 }, step: '+2 armor', costs: [40, 80, 145] },
    { id: 'precision', name: 'Precision', icon: 'eye', tier: 2, desc: r => `+${2 * r}% critical chance`, mods: { crit: 0.02 }, step: '+2% critical chance', costs: [40, 90, 150] },
    { id: 'wisdom', name: 'Wisdom', icon: 'scroll', tier: 2, desc: r => `+${5 * r}% experience`, mods: { xp: 0.05 }, step: '+5% experience', costs: [40, 90, 145] },
    { id: 'insight', name: 'Insight', icon: 'clover', tier: 2, desc: r => `${r} boon reroll${r === 1 ? '' : 's'} per descent`, step: '+1 boon reroll per descent', costs: [65, 130, 225] },
    { id: 'headstart', name: 'Head Start', icon: 'star', tier: 2, desc: r => `Begin with ${r} bonus boon${r === 1 ? '' : 's'}`, step: '+1 bonus boon at the start', costs: [80, 190] },
    { id: 'alacrity', name: 'Alacrity', icon: 'hourglass', tier: 3, desc: r => `Skill recharges ${4 * r}% faster`, mods: { cdr: 0.04 }, step: 'Skill recharges 4% faster', costs: [50, 95, 160] },
    { id: 'armory', name: 'Armory', icon: 'chest', tier: 3, desc: r => (r >= 2 ? 'Begin with a rare-or-better relic' : r === 1 ? 'Begin with a common relic' : 'Begin with a relic'), step: 'Better starting relic', costs: [95, 240] },
    { id: 'attunement', name: 'Ember Attunement', icon: 'ember', tier: 3, desc: r => `+${10 * r}% embers earned`, step: '+10% embers earned', costs: [80, 160, 255, 385] },
    { id: 'favor', name: "Merchant's Favor", icon: 'scroll', tier: 3, desc: r => (r >= 2 ? 'Shops stock +1 relic and are 20% cheaper' : 'Shops are 10% cheaper'), step: 'Cheaper shops (rank 2: +1 relic)', costs: [95, 225] },
    { id: 'secondwind', name: 'Second Wind', icon: 'feather', tier: 4, desc: r => (r ? `Once per descent, revive at ${r >= 2 ? 70 : 40}% health` : 'Once per descent, revive'), step: 'Revive once per descent', costs: [240, 560] },
    { id: 'deepwick', name: 'Deep Wick', icon: 'lantern', tier: 1, desc: r => `+${6 * r}% lantern light`, step: '+6% lantern light', costs: [40, 90, 160] },
  ];
  ED.UPGRADE_IDX = ED.U.indexer(ED.UPGRADES.map(u => u.id));

  ED.PACTS = [
    { name: 'No Pact', desc: 'The Deep as it is.' },
    { name: 'Thicker Hides', desc: 'Foes have +25% health.' },
    { name: 'Sharper Fangs', desc: 'Foes deal +25% damage.' },
    { name: 'Champions', desc: 'Elite foes appear far more often.' },
    { name: 'Scarcity', desc: 'Healing is 40% less effective.', heroMul: { heal: 0.6 } },
    { name: 'Tyrants', desc: 'Bosses have +35% health and attack faster.' },
    { name: 'Frenzy', desc: 'Foes move 15% faster.' },
    { name: 'Greed', desc: 'Shop prices are 40% higher.' },
    { name: 'Storm of Shot', desc: 'Enemy shots fly 20% faster and foes hit 20% harder.' },
    { name: 'Frailty', desc: 'Heroes have 25% less max health.', mods: { hpMul: -0.25 } },
    { name: 'The Deep Hungers', desc: 'Every combat room has an extra wave and foes have +20% health.' },
  ];
  ED.PACT_EMBER_BONUS = 0.08; // per pact level
  // Pact stat effects (pacts stack): mods are added to the stat block, heroMul factors multiply a derived stat (ED.Stats.compute / sources).

  // Mastery XP thresholds for levels 1..10.
  ED.MASTERY_XP = [0, 120, 300, 550, 850, 1200, 1650, 2200, 2850, 3600];
  // Stat mods a mastery level adds (every level up to the hero's own applies); ED.MASTERY_REWARDS is the text.
  ED.MASTERY_MODS = { 2: { dmg: 0.05 }, 4: { hp: 10 }, 5: { cdr: 0.08 }, 7: { crit: 0.04 }, 9: { dmg: 0.08 } };
  ED.MASTERY_REWARDS = [
    null,
    'Hero unlocked',
    '+5% damage',
    'Second weapon',
    '+10 max health',
    'Skill recharges 8% faster',
    'Third weapon',
    '+4% critical chance',
    '+1 boon reroll per descent',
    '+8% damage',
    'Gilded: a golden aura and title',
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
    { id: 'archivist', name: 'Archivist', desc: 'Unlock every relic', icon: 'scroll', reward: 100, check: p => ED.RELIC_IDS.every(r => ED.Save.relicUnlocked(p, r)) },
    { id: 'hearthkeeper', name: 'Hearthkeeper', desc: 'Buy 25 Hearth upgrade ranks', icon: 'ember', reward: 80, check: p => p.up.reduce((a, b) => a + b, 0) >= 25 },
    { id: 'evolved', name: 'Evolved', desc: 'Evolve a weapon', icon: 'wing', reward: 40, check: (p, run) => run && run.evolved },
    { id: 'intothedark', name: 'Into the Dark', desc: 'Defeat a boss while Lightless', icon: 'eye', reward: 50, check: (p, run) => run && run.lightlessBoss },
    { id: 'cartographer', name: 'Cartographer', desc: 'Clear every room of a stratum', icon: 'scroll', reward: 40, check: (p, run) => run && run.fullClear },
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
