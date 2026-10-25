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
    { id: 'provisions', name: 'Provisions', icon: 'potion', tier: 1, desc: r => `Heal ${2 * r}% at the start of each stratum`, heal: 0.02, step: 'Heal 2% more at the start of each stratum', costs: [25, 55] },
    { id: 'bulwark', name: 'Ironhide', icon: 'shield', tier: 2, desc: r => `+${3 * r} armor`, mods: { armor: 3 }, step: '+3 armor', costs: [15, 30, 55] },
    { id: 'precision', name: 'Precision', icon: 'eye', tier: 2, desc: r => `+${2 * r}% critical chance`, mods: { crit: 0.02 }, step: '+2% critical chance', costs: [15, 30, 55] },
    { id: 'wisdom', name: 'Wisdom', icon: 'scroll', tier: 2, desc: r => `+${2 * r}% experience`, mods: { xp: 0.02 }, step: '+2% experience', costs: [15, 30, 55] },
    { id: 'insight', name: 'Insight', icon: 'clover', tier: 2, rerolls: [1, 2, 3], desc: r => `${r} boon reroll${r === 1 ? '' : 's'} per run`, step: '+1 boon reroll per run', costs: [25, 50, 90] },
    { id: 'headstart', name: 'Head Start', icon: 'star', tier: 2, xp: 15, desc: r => `Start each run with ${15 * r} experience`, step: 'Start with 15 more experience', costs: [15, 35] },
    { id: 'alacrity', name: 'Alacrity', icon: 'hourglass', tier: 3, desc: r => `Skills recharge ${3 * r}% faster`, mods: { cdr: 0.03 }, step: 'Skills recharge 3% faster', costs: [20, 40, 65] },
    { id: 'stash', name: 'Stash', icon: 'chest', tier: 3, gold: 5, desc: r => `Start each run with ${5 * r} gold`, step: 'Start with 5 more gold', costs: [20, 45] },
    { id: 'attunement', name: 'Ember Attunement', icon: 'ember', tier: 3, desc: r => `+${10 * r}% embers earned`, step: '+10% embers earned', costs: [80, 160, 255, 385] },
    { id: 'favor', name: "Merchant's Favor", icon: 'scroll', tier: 3, desc: r => `Shops are ${4 * r}% cheaper`, discount: 0.04, step: 'Shops are 4% cheaper', costs: [30, 65] },
    { id: 'secondwind', name: 'Second Wind', icon: 'feather', tier: 4, pct: [0.05, 0.1], desc: r => (r ? `Once per run, outside boss fights, revive at ${r >= 2 ? 10 : 5}% health` : 'Once per run, outside boss fights, revive'), step: 'Revive once per run outside boss fights (rank 2: 10% health)', costs: [90, 200] },
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
    bell: [
      V('bell', 'stormbell'), V('bell', 'wreckbell'), V('bell', 'chimes'),
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
    { name: 'No Pact', desc: 'Normal difficulty.' },
    { name: 'Thicker Hides', desc: 'Foes have +10% health.', foeHp: 1.1 },
    { name: 'Sharper Fangs', desc: 'Foes deal +15% damage.', foeDmg: 1.15 },
    { name: 'Champions', desc: 'Elite foes appear far more often.', eliteCh: 0.4, eliteExtra: 0.3 },
    { name: 'Scarcity', desc: 'Healing is 50% less effective and heroes have 6% less max health.', heroMul: { heal: 0.5 }, mods: { hpMul: -0.06 } },
    { name: 'Tyrants', desc: 'Bosses have +20% health and attack faster.', bossHp: 1.2, bossPause: 0.8 },
    { name: 'Frenzy', desc: 'Foes move 15% faster.' },
    { name: 'Greed', desc: 'Shop prices are 40% higher.' },
    { name: 'Fast Shots', desc: 'Foe shots fly 20% faster and foes deal +20% damage.', foeDmg: 1.2 },
    { name: 'Frailty', desc: 'Heroes have 25% less max health.', mods: { hpMul: -0.25 } },
    { name: 'Extra Waves', desc: 'Every combat room has an extra wave and foes have +20% health.', foeHp: 1.2 },
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
    '+1 boon reroll per run',
    '+8% damage',
    '+4 max health and the Gilded aura (golden glow)',
  ];
  ED.masteryLevel = (xp) => { let l = 1; for (let i = 0; i < ED.MASTERY_XP.length; i++) if (xp >= ED.MASTERY_XP[i]) l = i + 1; return l; };

  // Deeds: one-time achievements with ember rewards. check(profile, run?) runs at run end and after purchases.
  const bossDeed = (id, name, i, reward) => ({ id, name, desc: `Defeat the ${ED.ENEMIES[ED.BIOMES[i].boss].name}`, icon: 'skull', reward, check: p => !!(p.bosses & (1 << i)) });
  ED.DEEDS = [
    { id: 'firstblood', name: 'First Blood', desc: 'Kill 50 foes', icon: 'sword', reward: 15, check: p => p.stats.kills >= 50 },
    bossDeed('gravedigger', 'Gravedigger', 0, 20),
    bossDeed('weedkiller', 'Weedkiller', 1, 30),
    bossDeed('thaw', 'Low Tide', 2, 40), // ids thaw / quenched / lowtide keep their DEEDS positions (save code) with new checks
    { id: 'quenched', name: 'Twinbreaker', desc: 'Clear the twin champions room', icon: 'skull', reward: 50, check: (p, run) => run && !!(run.champs & 1) },
    { id: 'lowtide', name: 'Mimic Hunter', desc: 'Clear the mimic champion room', icon: 'skull', reward: 60, check: (p, run) => run && !!(run.champs & 2) },
    { id: 'uncrowned', name: 'First Win', desc: 'Defeat the Hollow King and win a run', icon: 'crown', reward: 100, check: p => p.stats.wins >= 1 },
    { id: 'slayer', name: 'Slayer', desc: 'Kill 1,000 foes', icon: 'axe', reward: 50, check: p => p.stats.kills >= 1000 },
    { id: 'legend', name: 'Legend', desc: 'Kill 5,000 foes', icon: 'axe', reward: 120, check: p => p.stats.kills >= 5000 },
    { id: 'fellowship', name: 'Fellowship', desc: 'Clear a stratum in a party', icon: 'banner', reward: 30, check: (p, run) => run && run.party > 1 && run.stratum >= 2 },
    { id: 'rescue', name: 'No One Left Behind', desc: 'Revive a downed ally', icon: 'heart', reward: 25, check: (p, run) => run && run.revives > 0 },
    { id: 'untouched', name: 'Untouched', desc: 'Defeat a boss without being hit', icon: 'shieldgold', reward: 40, check: (p, run) => run && run.flawlessBoss },
    { id: 'hoard', name: "Dragon's Hoard", desc: 'Hold 400 gold at once', icon: 'coin', reward: 30, check: (p, run) => run && run.maxGold >= 400 },
    { id: 'collector', name: 'Collector', desc: 'Hold 8 relics in one run', icon: 'chest', reward: 40, check: (p, run) => run && run.maxRelics >= 8 },
    { id: 'ascendant', name: 'Level 20', desc: 'Reach level 20 in one run', icon: 'star', reward: 50, check: (p, run) => run && run.level >= 20 },
    { id: 'swift', name: 'Speedrun', desc: 'Win a run in under 15 minutes', icon: 'hourglass', reward: 50, check: (p, run) => run && run.victory && run.time < 900 },
    { id: 'pact1', name: 'Pact 1', desc: 'Win a run at Pact 1 or higher', icon: 'ember', reward: 60, check: p => p.pactWin >= 1 },
    { id: 'pact5', name: 'Pact 5', desc: 'Win a run at Pact 5 or higher', icon: 'ember', reward: 120, check: p => p.pactWin >= 5 },
    { id: 'pact10', name: 'Pact 10', desc: 'Win a run at Pact 10', icon: 'ember', reward: 250, check: p => p.pactWin >= 10 },
    { id: 'master', name: 'Master', desc: 'Reach mastery 10 with any hero', icon: 'star', reward: 100, check: p => p.mastery.some(x => ED.masteryLevel(x) >= 10) },
    { id: 'manyfaces', name: 'Many Faces', desc: 'Unlock six heroes', icon: 'mask', reward: 60, check: p => ED.CLASS_IDS.filter(c => ED.Save.classUnlocked(p, c)).length >= 6 },
    { id: 'archivist', name: 'Relic Keeper', desc: 'Hold 10 relics in one run', icon: 'scroll', reward: 60, check: (p, run) => run && run.maxRelics >= 10 },
    { id: 'hearthkeeper', name: 'Hearthkeeper', desc: 'Buy 25 Hearth upgrade ranks', icon: 'ember', reward: 80, check: p => p.up.reduce((a, b) => a + b, 0) >= 25 },
    { id: 'evolved', name: 'Evolved', desc: 'Evolve a weapon', icon: 'wing', reward: 40, check: (p, run) => run && run.evolved },
    { id: 'intothedark', name: 'Into the Dark', desc: 'Clear 6 dark rooms in one run', icon: 'eye', reward: 50, check: (p, run) => run && run.darkCleared >= 6 },
    { id: 'cartographer', name: 'Cartographer', desc: 'Clear two dark rooms and an elite room on one stratum', icon: 'scroll', reward: 40, check: (p, run) => run && run.fullClear },
  ];
  ED.DEED_IDX = ED.U.indexer(ED.DEEDS.map(d => d.id));
  // Secrets: hidden achievements (no embers), each rewarding a Wardrobe item. check(profile, run, pl) runs at run end (save.js S.checkSecrets) with `pl` the local hero's entry of run.players;
  // world fields (run.gold777, run.oneFace) and per-hero fields (pl.platino, pl.contrarian, pl.thread, pl.heroSecret, pl.bellRung) come from the sim summary. Hearthsitter is granted by the camp (S.grantSecret).
  // The profile stores one bit per entry by position (ED.SECRETS index; the save code carries a 6-bit count): append only. A hero secret's id is its hero's id (pl.heroSecret names the hero's own).
  const heroSecret = (id, name, desc, icon) => ({ id, name, desc, icon, reward: `skin.${id}.secret`, check: (p, run, pl) => !!(run && pl && pl.heroSecret && run.cls === id) });
  ED.SECRETS = [
    { id: 'hearthsitter', name: 'Hearthsitter', desc: 'Stood still by the Hearth for 3 minutes', icon: 'campfire', reward: 'camp.bluehearth', check: () => false },
    { id: 'platino', name: 'The Platino', desc: 'Caught the Platino', icon: 'gem', reward: 'pet.platino', check: (p, run, pl) => !!(pl && pl.platino) },
    { id: 'change', name: 'Exact Change', desc: 'Held exactly 777 gold', icon: 'coin', reward: 'trail.coins', check: (p, run) => !!(run && run.gold777) },
    { id: 'unkindled', name: 'Unkindled', desc: 'Won a run with no Hearth upgrades', icon: 'ember', reward: 'skin.unkindled', check: (p, run) => !!(run && run.victory) && p.up.every(r => !r) },
    { id: 'contrarian', name: 'Against the Grain', desc: 'Won a run with two paths opened on different strata, the second after stratum I', icon: 'thorn', reward: 'title.contrarian', check: (p, run, pl) => !!(run && run.victory && pl && pl.contrarian) },
    { id: 'thread', name: 'Thread of Life', desc: 'Killed the Hollow King while below 3% health', icon: 'heartbroken', reward: 'death.embers', check: (p, run, pl) => !!(pl && pl.thread) },
    // p.heroWins is read before this run's victory is added (S.applyRun)
    { id: 'crown', name: 'Hollow Crown', desc: 'Won a run at Pact 10 with a hero who had never won', icon: 'crown', reward: 'hat.crown',
      check: (p, run) => !!(run && run.victory && (run.pact | 0) >= 10 && ED.CLASS_IDS.indexOf(run.cls) >= 0 && !((p.heroWins | 0) & (1 << ED.CLASS_IDS.indexOf(run.cls)))) },
    { id: 'oneface', name: 'One Face', desc: 'Four heroes of one kind cleared a stratum', icon: 'mask', reward: 'title.many', check: (p, run) => !!(run && run.oneFace) },
    heroSecret('knight', 'Unbroken', 'Killed a boss with a fully charged Bulwark bash', 'shield'),
    heroSecret('ranger', 'Long Shot', 'Killed 3 foes with one shot', 'arrow'),
    heroSecret('pyro', 'Bonfire', 'Had 30 foes burning at once', 'flame'),
    heroSecret('shade', 'Unseen', 'Killed 5 foes during one Vanish', 'vanish'),
    heroSecret('cleric', 'Smiter', 'Hit one boss with 25 Smites', 'hammer'),
    heroSecret('necro', 'Risen Champion', 'An elite you killed rose as your minion', 'skull'),
    heroSecret('bell', 'Last Peal', 'Killed the Hollow King with a Peal', 'drum'),
  ];
  ED.SECRET_IDX = ED.U.indexer(ED.SECRETS.map(s => s.id));
  ED.secretHas = (p, id) => { const i = ED.SECRET_IDX[id]; return i !== undefined && !!((p.secrets | 0) & (1 << i)); };

  // Wardrobe: cosmetics { id, slot, cls (null = any hero), name, gate }; client-only, never read by the sim. Slots: skin, tint (one per base weapon, several worn), aura, hat, pet, trail, death, title (text after the name), camp (the Hearth, not per hero).
  // gate: { mastery, cost } bought with embers once the hero's mastery is reached (never refunded) · { secret } owned with that secret · { evolve, n } owned once that base weapon evolved in n descents (p.evo) · { mastery } alone: the wearing hero's mastery.
  // Positions: the save code stores purchases and worn items by index inside a scope (ED.COS_SCOPE: '' the global items, then each hero in CLASS_IDS order): append inside a scope only. A new hero gets its rows from its CLASS_IDS entry and its weapons (CLASSES order).
  ED.COS_SLOTS = ['skin', 'tint', 'aura', 'hat', 'pet', 'trail', 'death', 'title', 'camp'];
  ED.WEAR_SLOTS = ['skin', 'aura', 'hat', 'pet', 'trail', 'death', 'title']; // per hero, one item each; tints and camp are stored apart
  const G = (id, slot, name, gate) => ({ id, slot, cls: null, name, gate });
  ED.COS_SCOPE = { '': [
    G('aura.gilded', 'aura', 'Gilded', { mastery: 10 }),
    G('skin.unkindled', 'skin', 'Unkindled', { secret: 'unkindled' }),
    G('hat.crown', 'hat', 'Hollow Crown', { secret: 'crown' }),
    G('pet.platino', 'pet', 'Platino', { secret: 'platino' }),
    G('trail.coins', 'trail', 'Trail of Coins', { secret: 'change' }),
    G('death.embers', 'death', 'Last Embers', { secret: 'thread' }),
    G('title.contrarian', 'title', 'the Contrarian', { secret: 'contrarian' }),
    G('title.many', 'title', 'One of Many', { secret: 'oneface' }),
    G('camp.bluehearth', 'camp', 'Blue Hearth', { secret: 'hearthsitter' }),
  ] };
  // Skin names per hero [mastery 4, mastery 7, secret]; a hero without a row gets the generic names.
  const SKIN_NAMES = {
    knight: ['Ashen Plate', 'Sunsteel', 'Mirror Knight'], ranger: ['Mossweave', 'Winter Stalker', 'Hawkeye'], pyro: ['Soot', 'Blue Flame', 'Bonfire Heart'],
    shade: ['Dusk', 'Moonless', 'Nobody'], cleric: ['Pilgrim', 'High Vicar', 'Hammer of Dawn'], necro: ['Bone Choir', 'Grave Lord', 'Risen Shroud'], bell: ['Verdigris', 'Tidecaller', 'Last Toll'],
  };
  const weaponName = (w) => (ED.WEAPONS[w] ? ED.WEAPONS[w].name : w); // read when shown: a hero's weapon table may load after this file
  for (const c of ED.CLASS_IDS) {
    const nm = SKIN_NAMES[c] || ['Ashen', 'Regal', 'Secret'];
    ED.COS_SCOPE[c] = [
      { id: `skin.${c}.a`, slot: 'skin', cls: c, name: nm[0], gate: { mastery: 4, cost: 150 } },
      { id: `skin.${c}.b`, slot: 'skin', cls: c, name: nm[1], gate: { mastery: 7, cost: 300 } },
      { id: `skin.${c}.secret`, slot: 'skin', cls: c, name: nm[2], gate: { secret: c } },
    ].concat(ED.CLASSES[c].weapons.map(w => ({ id: `tint.${w}`, slot: 'tint', cls: c, get name() { return `${weaponName(w)} Sheen`; }, weapon: w, gate: { evolve: w, n: 3 } })));
  }
  ED.COSMETICS = [].concat(...Object.values(ED.COS_SCOPE));
  ED.COSMETIC = {}; for (const c of ED.COSMETICS) ED.COSMETIC[c.id] = c;
  // Items of `slot` that hero `cls` can wear: the global ones, then the hero's own.
  ED.cosFor = (cls, slot) => ED.COSMETICS.filter(c => c.slot === slot && (c.cls === null || c.cls === cls));
  // True when profile p owns item `id` worn by hero `cls` (a global item's mastery gate reads that hero).
  ED.cosOwned = (p, id, cls) => {
    const c = ED.COSMETIC[id];
    if (!c || !p || (c.cls && cls && c.cls !== cls)) return false;
    const g = c.gate, hero = c.cls || cls;
    if (g.secret) return ED.secretHas(p, g.secret);
    if (g.evolve) return ((p.evo && p.evo[g.evolve]) | 0) >= g.n;
    if (g.cost) return Array.isArray(p.cos) && p.cos.indexOf(id) >= 0;
    if (g.mastery) { const i = ED.CLASS_IDS.indexOf(hero); return i >= 0 && ED.masteryLevel((p.mastery && p.mastery[i]) || 0) >= g.mastery; }
    return false;
  };
  // How item c is earned: "Mastery 4 · 150 embers", "A secret", "Evolve the Longsword in 3 descents" (+ " (1/3)" with a profile), "Mastery 10".
  ED.cosGateText = (c, p) => {
    const g = c.gate;
    if (g.secret) return 'A secret';
    if (g.evolve) { const k = p && p.evo ? p.evo[g.evolve] | 0 : 0; return `Evolve the ${weaponName(g.evolve)} in ${g.n} runs` + (p ? ` (${Math.min(k, g.n)}/${g.n})` : ''); }
    if (g.cost) return `Mastery ${g.mastery} · ${g.cost} embers`;
    return `Mastery ${g.mastery}`;
  };


})(globalThis.ED || (globalThis.ED = {}));
