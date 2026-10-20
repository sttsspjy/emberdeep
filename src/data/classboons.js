// Class boons: each hero's own path, modifying their two skills. Merged into ED.BOONS (see data/boons.js for the format).
(function (ED) {
  'use strict';
  const CB = ED.CLASS_BOONS = {
    shieldwall: { name: 'Shield Wall', rar: 'r', icon: 'shield', cls: 'knight', desc: 'Shield Charge grants 40% damage reduction for 3s.', mods: { shieldwall: 1 }, max: 1 },
    quake: { name: 'Quake', rar: 'e', icon: 'star', cls: 'knight', desc: 'Shield Charge ends in a shockwave dealing 250% damage.', mods: { quake: 1 }, max: 1 },
    mark: { name: "Hunter's Mark", rar: 'r', icon: 'eye', cls: 'ranger', desc: 'Critical hits mark foes; marked foes take +25% damage.', mods: { mark: 1 }, max: 1 },
    storm: { name: 'Arrow Storm', rar: 'e', icon: 'arrows', cls: 'ranger', desc: 'Volley fires 5 more arrows that deal +50% damage.', mods: { storm: 1 }, max: 1 },
    combust: { name: 'Combustion', rar: 'r', icon: 'bomb', cls: 'pyro', desc: '+40% explosion radius and burn damage.', mods: { combust: 1, area: 0.15 }, max: 2 },
    phoenixnova: { name: 'Phoenix Nova', rar: 'e', icon: 'feather', cls: 'pyro', desc: 'Flame Nova heals you 12% and leaves a ring of fire.', mods: { phoenixNova: 1 }, max: 1 },
    assassin: { name: 'Assassin', rar: 'r', icon: 'dagger', cls: 'shade', desc: 'Critical hits deal +60% damage.', mods: { critDmg: 0.6 }, max: 2 },
    decoy: { name: 'Shadow Clone', rar: 'e', icon: 'cloak', cls: 'shade', desc: 'Shadowstep leaves a decoy that explodes for 300% damage.', mods: { decoy: 1 }, max: 1 },
    wrath: { name: 'Divine Wrath', rar: 'r', icon: 'sun', cls: 'cleric', desc: 'Sanctuary burns 3x harder and stuns foes.', mods: { wrath: 1 }, max: 1 },
    blessed: { name: 'Blessed Strikes', rar: 'e', icon: 'heart', cls: 'cleric', desc: 'Your hits heal the most wounded ally for 1.', mods: { blessed: 1 }, max: 2 },
    legionplus: { name: 'Endless Legion', rar: 'r', icon: 'skull', cls: 'necro', desc: '+2 max minions; minions deal +30% damage.', mods: { minions: 2, minionDmg: 0.3 }, max: 2 },
    bonespikes: { name: 'Bone Spikes', rar: 'e', icon: 'bomb', cls: 'necro', desc: 'Minions burst for 150% weapon damage when they fall.', mods: { boneSpikes: 1 }, max: 1 },
  };
  Object.assign(ED.BOONS, CB);
  ED.BOON_IDS = Object.keys(ED.BOONS);
})(globalThis.ED || (globalThis.ED = {}));
