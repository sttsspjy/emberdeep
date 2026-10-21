// Class boons: two per hero skill (K and L), merged into ED.BOONS (see data/boons.js for the format).
(function (ED) {
  'use strict';
  const CB = ED.CLASS_BOONS = {
    // Knight: Shield Charge · Bulwark
    shieldwall: { name: 'Shield Wall', rar: 'r', icon: 'shield', cls: 'knight', desc: 'Shield Charge grants 40% damage reduction for 3s.', mods: { shieldwall: 1 }, max: 1 },
    quake: { name: 'Quake', rar: 'e', icon: 'star', cls: 'knight', desc: 'Shield Charge ends in a shockwave dealing 250% damage.', mods: { quake: 1 }, max: 1 },
    bastion: { name: 'Bastion', rar: 'r', icon: 'shieldgold', cls: 'knight', desc: 'Bulwark lasts 50% longer and its bash stuns for 1.2s.', mods: { bastion: 1 }, max: 1 },
    mirrorguard: { name: 'Mirror Guard', rar: 'e', icon: 'mirror', cls: 'knight', desc: 'Bulwark blocks from every side and reflects projectiles at 250% damage.', mods: { mirrorguard: 1 }, max: 1 },
    // Ranger: Volley · Rain of Arrows
    mark: { name: "Hunter's Mark", rar: 'r', icon: 'eye', cls: 'ranger', desc: 'Critical hits mark foes; marked foes take +25% damage.', mods: { mark: 1 }, max: 1 },
    arrowstorm: { name: 'Arrow Storm', rar: 'e', icon: 'arrows', cls: 'ranger', desc: 'Volley fires 5 more arrows that deal +50% damage.', mods: { arrowStorm: 1 }, max: 1 },
    barrage: { name: 'Barrage', rar: 'r', icon: 'arrow', cls: 'ranger', desc: 'Rain of Arrows has +40% radius and lasts 1s longer.', mods: { barrage: 1 }, max: 1 },
    hailthorns: { name: 'Hail of Thorns', rar: 'e', icon: 'thorn', cls: 'ranger', desc: 'Foes inside Rain of Arrows are slowed 50% and take +20% damage.', mods: { hailthorns: 1 }, max: 1 },
    // Pyromancer: Flame Nova · Meteor
    combust: { name: 'Combustion', rar: 'r', icon: 'bomb', cls: 'pyro', desc: '+40% explosion radius and burn damage.', mods: { combust: 1, area: 0.15 }, max: 2 },
    phoenixnova: { name: 'Phoenix Nova', rar: 'e', icon: 'feather', cls: 'pyro', desc: 'Flame Nova heals you 12% and leaves a ring of fire.', mods: { phoenixNova: 1 }, max: 1 },
    twinmeteor: { name: 'Twin Meteor', rar: 'e', icon: 'star', cls: 'pyro', desc: 'A second Meteor lands 0.6s after the first, on the nearest foe.', mods: { twinMeteor: 1 }, max: 1 },
    moltencore: { name: 'Molten Core', rar: 'r', icon: 'ember', cls: 'pyro', desc: 'Meteor craters last 3x longer and burn 2x hotter.', mods: { moltenCore: 1 }, max: 1 },
    // Shade: Shadowstep · Vanish
    assassin: { name: 'Assassin', rar: 'r', icon: 'dagger', cls: 'shade', desc: 'Critical hits deal +60% damage.', mods: { critDmg: 0.6 }, max: 2 },
    decoy: { name: 'Shadow Clone', rar: 'e', icon: 'cloak', cls: 'shade', desc: 'Shadowstep leaves a decoy that explodes for 300% damage.', mods: { decoy: 1 }, max: 1 },
    smokescreen: { name: 'Smokescreen', rar: 'r', icon: 'cloak', cls: 'shade', desc: 'Vanish smoke has +40% radius, lasts 2s longer and foes inside take +20% damage.', mods: { smokescreen: 1 }, max: 1 },
    nightsedge: { name: "Night's Edge", rar: 'e', icon: 'mask', cls: 'shade', desc: 'Killing a foe with an Ambush refunds Vanish.', mods: { nightsEdge: 1 }, max: 1 },
    // Cleric: Sanctuary · Judgment
    wrath: { name: 'Divine Wrath', rar: 'r', icon: 'sun', cls: 'cleric', desc: 'Sanctuary burns 3x harder and stuns foes.', mods: { wrath: 1 }, max: 1 },
    blessed: { name: 'Blessed Strikes', rar: 'e', icon: 'heart', cls: 'cleric', desc: 'Your hits heal the most wounded ally for 1 (within the hit and kill heal cap).', mods: { blessed: 1 }, max: 2 },
    twinhammer: { name: 'Twin Hammers', rar: 'r', icon: 'twin', cls: 'cleric', desc: 'Judgment throws two hammers in a V.', mods: { twinHammer: 1 }, max: 1 },
    verdict: { name: 'Verdict', rar: 'e', icon: 'scroll', cls: 'cleric', desc: 'Judged foes explode on death for 60 + 150% weapon damage (radius 70).', mods: { verdict: 1 }, max: 1 },
    // Necromancer: Raise Legion · Bone Harvest
    legionplus: { name: 'Endless Legion', rar: 'r', icon: 'skull', cls: 'necro', desc: '+2 max minions; minions deal +30% damage.', mods: { minions: 2, minionDmg: 0.3 }, max: 2 },
    bonespikes: { name: 'Bone Spikes', rar: 'e', icon: 'bomb', cls: 'necro', desc: 'Minions burst for 150% weapon damage when they fall.', mods: { boneSpikes: 1 }, max: 1 },
    grimharvest: { name: 'Grim Harvest', rar: 'r', icon: 'blades', cls: 'necro', desc: 'Bone Harvest explosions deal +50% damage and raise 2 minions.', mods: { grimHarvest: 1 }, max: 1 },
    soulsiphon: { name: 'Soul Siphon', rar: 'e', icon: 'orb', cls: 'necro', desc: 'Minion hits heal you for 0.15% max health (within the hit and kill heal cap).', mods: { soulSiphon: 1 }, max: 1 },
  };
  Object.assign(ED.BOONS, CB);
  ED.BOON_IDS = Object.keys(ED.BOONS);
})(globalThis.ED || (globalThis.ED = {}));
