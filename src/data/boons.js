// Boons: level-up choices. mods are added per stack to the stat block (see sim/stats.js).
// rar: c common, r rare, e epic. need: 'proj' | 'melee' restricts by weapon kind. cls restricts to a hero.
(function (ED) {
  'use strict';
  const B = ED.BOONS = {
    // ---- common ----
    edge: { name: 'Sharpened Edge', rar: 'c', icon: 'sword', desc: '+15% damage.', mods: { dmg: 0.15 } },
    quick: { name: 'Quickened Hands', rar: 'c', icon: 'hand', desc: '+12% attack speed.', mods: { atk: 0.12 } },
    fleet: { name: 'Fleet Foot', rar: 'c', icon: 'boot', desc: '+8% move speed.', mods: { spd: 0.08 }, max: 4 },
    vigor: { name: 'Vigor', rar: 'c', icon: 'heart', desc: '+20 max health and heal 20.', mods: { hp: 20 }, heal: 20 },
    keen: { name: 'Keen Eye', rar: 'c', icon: 'eye', desc: '+6% critical chance.', mods: { crit: 0.06 } },
    plating: { name: 'Plating', rar: 'c', icon: 'shield', desc: '+6 armor.', mods: { armor: 6 } },
    focus: { name: 'Focus', rar: 'c', icon: 'hourglass', desc: 'Skill recharges 10% faster.', mods: { cdr: 0.10 }, max: 4 },
    magnet: { name: 'Lodestar', rar: 'c', icon: 'magnet', desc: '+40% pickup range and +10% experience.', mods: { pickup: 0.4, xp: 0.1 }, max: 3 },
    mend: { name: 'Mending', rar: 'c', icon: 'leaf', desc: 'Regenerate 0.8 health per second.', mods: { regen: 0.8 } },
    lightstep: { name: 'Light Step', rar: 'c', icon: 'wing', desc: 'Dash recharges 20% faster.', mods: { dashcdr: 0.2 }, max: 3 },
    // ---- rare ----
    brutal: { name: 'Brutality', rar: 'r', icon: 'skull', desc: '+40% critical damage.', mods: { critDmg: 0.4 } },
    leech: { name: 'Leech', rar: 'r', icon: 'fang', desc: 'Heal for 3% of damage dealt.', mods: { leech: 0.03 }, max: 3 },
    pierce: { name: 'Piercing', rar: 'r', icon: 'arrow', desc: 'Projectiles pierce +1 foe.', mods: { pierce: 1 }, need: 'proj', max: 3 },
    split: { name: 'Split Shot', rar: 'r', icon: 'arrows', desc: '+1 projectile per attack, -8% damage.', mods: { projN: 1, dmg: -0.08 }, need: 'proj', max: 3 },
    wide: { name: 'Wide Arcs', rar: 'r', icon: 'arc', desc: '+20% area: melee reach, blasts and auras.', mods: { area: 0.2 }, max: 4 },
    kindle: { name: 'Kindling', rar: 'r', icon: 'flame', desc: '15% chance on hit to burn.', mods: { burn: 0.15 }, max: 3 },
    frost: { name: 'Frostbite', rar: 'r', icon: 'snow', desc: '15% chance on hit to chill (slow 45%).', mods: { chill: 0.15 }, max: 3 },
    static: { name: 'Static Charge', rar: 'r', icon: 'bolt', desc: '12% chance on hit to arc lightning to 3 foes.', mods: { chain: 0.12 }, max: 3 },
    thorns: { name: 'Thornmail', rar: 'r', icon: 'thorn', desc: 'Attackers take 12 damage. +4 armor.', mods: { thorns: 12, armor: 4 }, max: 3 },
    bladedash: { name: 'Blade Dash', rar: 'r', icon: 'wingblade', desc: 'Dashing through foes deals 150% weapon damage.', mods: { dashDmg: 1.5 }, max: 2 },
    firetrail: { name: 'Cinder Trail', rar: 'r', icon: 'flame', desc: 'Your dash leaves burning ground.', mods: { dashFire: 1 }, max: 1 },
    evade: { name: 'Evasion', rar: 'r', icon: 'cloak', desc: '+7% chance to dodge attacks.', mods: { dodge: 0.07 }, max: 4 },
    execute: { name: 'Executioner', rar: 'r', icon: 'axe', desc: '+50% damage to foes below 30% health.', mods: { execute: 0.5 }, max: 2 },
    momentum: { name: 'Momentum', rar: 'r', icon: 'boot', desc: '+15% damage while moving.', mods: { momentum: 0.15 }, max: 3 },
    bulwark: { name: 'Bulwark', rar: 'r', icon: 'shield', desc: '+20% max health, -4% move speed.', mods: { hpMul: 0.2, spd: -0.04 }, max: 3 },
    bounty: { name: 'Bounty', rar: 'r', icon: 'coin', desc: '+25% gold and foes drop more hearts.', mods: { gold: 0.25, hearts: 0.5 }, max: 2 },
    // ---- epic ----
    orbit: { name: 'Orbiting Blades', rar: 'e', icon: 'blades', desc: '+1 blade spins around you, cutting foes.', mods: { orbit: 1 }, max: 4 },
    wisp: { name: 'Spirit Wisp', rar: 'e', icon: 'orb', desc: '+1 wisp that fires at nearby foes.', mods: { wisp: 1 }, max: 3 },
    burst: { name: 'Death Burst', rar: 'e', icon: 'bomb', desc: 'Slain foes explode for 60% weapon damage.', mods: { burst: 0.6 }, max: 2 },
    twin: { name: 'Twin Strike', rar: 'e', icon: 'twin', desc: '20% chance for attacks to fire twice.', mods: { twin: 0.2 }, max: 3 },
    overcharge: { name: 'Overcharge', rar: 'e', icon: 'star', desc: 'Your skill also releases a damaging shockwave.', mods: { overcharge: 1 }, max: 2 },
    laststand: { name: 'Last Stand', rar: 'e', icon: 'shieldgold', desc: 'Falling below 30% health grants 3s of 60% damage reduction (20s cooldown).', mods: { guardian: 1 }, max: 1 },
    glass: { name: 'Glass Heart', rar: 'e', icon: 'heartbroken', desc: '+40% damage, -15% max health.', mods: { dmg: 0.4, hpMul: -0.15 }, max: 2 },
    trance: { name: 'Battle Trance', rar: 'e', icon: 'drum', desc: 'Using your skill grants +35% attack speed for 4s.', mods: { trance: 0.35 }, max: 2 },
    thirst: { name: 'Bloodthirst', rar: 'e', icon: 'drop', desc: 'Heal 1.5 health per kill.', mods: { killHeal: 1.5 }, max: 3 },
    echo: { name: 'Echo', rar: 'e', icon: 'twinblue', desc: 'Your skill holds a second charge.', mods: { charges: 1 }, max: 1 },
    // ---- hero boons ----
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
  ED.BOON_IDS = Object.keys(B);
  ED.RARITY = {
    c: { name: 'Common', color: '#cfc6b6', w: 60 },
    r: { name: 'Rare', color: '#6fb2ff', w: 30 },
    e: { name: 'Epic', color: '#c98bff', w: 10 },
    l: { name: 'Legendary', color: '#ffb02e', w: 4 },
  };
})(globalThis.ED || (globalThis.ED = {}));
