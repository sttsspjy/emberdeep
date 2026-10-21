// Boons: level-up choices. mods are added per stack to the stat block (see sim/stats.js).
// rar: c common, r rare, e epic (keystones), l legendary (evolutions), d duo. need: 'proj' | 'melee' restricts by weapon kind. cls restricts to a hero (class boons live in classboons.js).
// Path boons: path = owning path, gate (opens the path; a hero owns MAX_ELEMENTS element gates or the Generalist gate), key (keystone, needs path affinity >= keyAffinity),
// evo (evolution card), duo [a, b] (needs both element gates), open (offered to every hero, never gated, counts toward no affinity), openMax (rank cap of a gated boon for a hero that is not a Generalist),
// pw { base, k } (a proc damage of base + k x Class Power, see ED.procDmg).
(function (ED) {
  'use strict';
  ED.PATHS = {
    fire: { name: 'Fire', color: '#ff7a2a', icon: 'flame', element: true, evo: 'Cinder' },
    ice: { name: 'Ice', color: '#7fe3ff', icon: 'snow', element: true, evo: 'Glacial' },
    lightning: { name: 'Lightning', color: '#ffe66b', icon: 'bolt', element: true, evo: 'Tempest' },
    poison: { name: 'Poison', color: '#9be33c', icon: 'drop', element: true, evo: 'Venomous' },
    holy: { name: 'Holy', color: '#fff0c2', icon: 'sun', element: true, evo: 'Hallowed' },
    shadow: { name: 'Shadow', color: '#a070ff', icon: 'mask', element: true, evo: 'Umbral' },
    general: { name: 'General', color: '#d9dfe8', icon: 'sword', element: false, evo: 'Masterwork' },
  };
  ED.PATH_IDS = Object.keys(ED.PATHS);
  ED.ELEMENT_IDS = ED.PATH_IDS.filter(k => ED.PATHS[k].element);
  ED.MAX_ELEMENTS = 2; // element gates a hero owns (the Generalist gate excludes them all)
  ED.KEY_AFFINITY = 5; // path affinity a keystone needs
  ED.EVO_AFFINITY = 10; // path affinity (with its keystone owned) that unlocks the evolution card
  ED.KEY_AFFINITY_GENERAL = 6; ED.EVO_AFFINITY_GENERAL = 12; // the same for the General path
  ED.DUO_AFFINITY = 4; // both element paths at this affinity put their duo on every offer until taken
  ED.keyAffinity = (path) => (path === 'general' ? ED.KEY_AFFINITY_GENERAL : ED.KEY_AFFINITY);
  ED.evoAffinity = (path) => (path === 'general' ? ED.EVO_AFFINITY_GENERAL : ED.EVO_AFFINITY);

  // Element infusion table: stat that sets the strength, status adder on the World, unit of the amount (dmg: the hit's damage; chill and venom: its share of the foe's HP before the stratum lever).
  ED.ELEMENTS = {
    fire: { inf: 'fireInfuse', add: 'addBurn', unit: 'dmg' },
    ice: { inf: 'iceInfuse', add: 'addChill', unit: 'chill' },
    lightning: { inf: 'lightningInfuse', add: 'addCharge', unit: 'dmg' },
    poison: { inf: 'poisonInfuse', add: 'addVenom', unit: 'venom' },
    holy: { inf: 'holyInfuse', add: 'addRadiance', unit: 'dmg' },
    shadow: { inf: 'shadowInfuse', add: 'addDoom', unit: 'dmg' },
  };

  const B = ED.BOONS = {
    // ---- open General: offered to every hero ----
    vigor: { name: 'Vigor', rar: 'c', icon: 'heart', open: true, desc: '+15 max health and heal 15.', mods: { hp: 15 }, heal: 15, max: 3 },
    plating: { name: 'Plating', rar: 'c', icon: 'shield', open: true, desc: '+5 armor.', mods: { armor: 5 }, max: 2 },
    fleet: { name: 'Fleet Foot', rar: 'c', icon: 'boot', open: true, desc: '+7% move speed.', mods: { spd: 0.07 }, max: 2 },
    focus: { name: 'Focus', rar: 'c', icon: 'hourglass', open: true, desc: 'Skills recharge 10% faster.', mods: { cdr: 0.10 }, max: 3 },
    lightstep: { name: 'Light Step', rar: 'c', icon: 'wing', open: true, desc: 'Dash recharges 20% faster.', mods: { dashcdr: 0.2 }, max: 2 },
    magnet: { name: 'Lodestar', rar: 'c', icon: 'magnet', open: true, desc: '+40% pickup range and +10% experience.', mods: { pickup: 0.4, xp: 0.1 }, max: 2 },
    edge: { name: 'Sharpened Edge', rar: 'c', icon: 'sword', open: true, desc: '+10% damage.', mods: { dmg: 0.10 }, max: 2 },
    quick: { name: 'Quickened Hands', rar: 'c', icon: 'hand', open: true, desc: '+10% attack speed.', mods: { atk: 0.10 }, max: 2 },
    bounty: { name: 'Bounty', rar: 'c', icon: 'coin', open: true, desc: '+25% gold.', mods: { gold: 0.25 }, max: 2 },
    stalwart: { name: 'Stalwart', rar: 'c', icon: 'heart', open: true, desc: '+6% max health.', mods: { hpMul: 0.06 }, max: 2 },
    mending: { name: 'Mending', rar: 'c', icon: 'potion', open: true, desc: '+15% healing received.', mods: { heal: 0.15 }, max: 2 },
    forager: { name: 'Forager', rar: 'c', icon: 'leaf', open: true, desc: 'Cleared rooms drop a heart 10% more often; hearts you pick up heal 3% more max health.', mods: { forager: 1 }, max: 2 },
    wide: { name: 'Wide Arcs', rar: 'r', icon: 'arc', open: true, desc: '+15% area: melee reach, blasts and auras.', mods: { area: 0.15 }, max: 2 },
    evade: { name: 'Evasion', rar: 'r', icon: 'cloak', open: true, desc: '+6% chance to dodge attacks.', mods: { dodge: 0.06 }, max: 2 },
    thorns: { name: 'Thornmail', rar: 'r', icon: 'thorn', open: true, desc: 'Attackers take 10 damage. +4 armor.', mods: { thorns: 10, armor: 4 }, max: 2 },
    pierce: { name: 'Piercing', rar: 'r', icon: 'arrow', open: true, desc: 'Projectiles pierce +1 foe.', mods: { pierce: 1 }, need: 'proj', max: 2 },
    split: { name: 'Split Shot', rar: 'r', icon: 'arrows', open: true, desc: '+1 projectile per attack, -8% damage.', mods: { projN: 1, dmg: -0.08 }, need: 'proj', max: 2 },
    bladedash: { name: 'Blade Dash', rar: 'r', icon: 'wingblade', open: true, desc: 'Dashing through foes deals 120% Power.', mods: { dashDmg: 1.2 }, max: 1 },
    battleward: { name: 'Battle Ward', rar: 'r', icon: 'shieldgold', open: true, desc: 'When an elite room locks, gain a shield of 5% max health.', mods: { roomWard: 0.05 }, max: 1 },
    echo: { name: 'Echo', rar: 'e', icon: 'twinblue', open: true, desc: 'Your first skill holds a second charge.', mods: { charges: 1 }, max: 1 },
    laststand: { name: 'Last Stand', rar: 'e', icon: 'shieldgold', open: true, desc: 'Falling below 30% health grants 3s of 60% damage reduction (20s cooldown).', mods: { guardian: 1 }, max: 1 },
    glass: { name: 'Glass Heart', rar: 'e', icon: 'heartbroken', open: true, desc: '+30% damage, -15% max health.', mods: { dmg: 0.3, hpMul: -0.15 }, max: 1 },
    trance: { name: 'Battle Trance', rar: 'e', icon: 'drum', open: true, desc: 'Using a skill grants +30% attack speed for 4s.', mods: { trance: 0.3 }, max: 1 },
    overcharge: { name: 'Overcharge', rar: 'e', icon: 'star', open: true, desc: 'Your skills also release a shockwave (150% Power + 10, radius 85).', mods: { overcharge: 1 }, pw: { base: 10, k: 1.5 }, max: 1 },

    // ---- Fire ----
    kindle: { name: 'Kindle', rar: 'r', icon: 'flame', path: 'fire', gate: true, desc: 'Hits add 35% of their damage as Burn.', mods: { fireInfuse: 0.35 }, max: 1 },
    fuel: { name: 'Fuel the Fire', rar: 'c', icon: 'ember', path: 'fire', desc: 'Hits add 8% more of their damage as Burn.', mods: { fireInfuse: 0.08 }, max: 2 },
    stoke: { name: 'Stoke the Flames', rar: 'r', icon: 'flame', path: 'fire', desc: 'Burn deals +25% damage.', mods: { burnMul: 0.25 }, max: 3 },
    searing: { name: 'Searing', rar: 'c', icon: 'sun', path: 'fire', desc: '+12% damage to burning foes.', mods: { searing: 0.12 }, max: 2 },
    wildfire: { name: 'Wildfire', rar: 'r', icon: 'flame', path: 'fire', desc: 'A burning foe that dies sets foes within 80 alight for 15% of its base health.', mods: { wildfire: 0.15 }, max: 2 },
    cindertrail: { name: 'Cinder Trail', rar: 'r', icon: 'wing', path: 'fire', desc: 'Your dash leaves burning ground for 2.2s (6 + 60% Power per second).', mods: { dashFire: 1 }, pw: { base: 6, k: 0.6 }, max: 1 },
    conflag: { name: 'Conflagration', rar: 'e', icon: 'bomb', path: 'fire', key: true, desc: 'A foe whose Burn exceeds 30% of its remaining base health combusts: the whole pool hits it, and 60% of it hits foes within 70.', mods: { conflag: 1 }, max: 1 },
    evo_fire: { name: 'Cinder Arms', rar: 'l', icon: 'flame', path: 'fire', evo: 'fire', desc: 'Melee swings launch a piercing flame crescent (60%). Shots explode (50%, radius 40). Exploding weapons blast 30% wider and leave burning ground. Burn +25%.', mods: { burnMul: 0.25 }, max: 1 },

    // ---- Ice ----
    frostbite: { name: 'Frostbite', rar: 'r', icon: 'snow', path: 'ice', gate: true, desc: 'Hits chill; full chill freezes for 1.6s. Frozen foes take +25% damage.', mods: { iceInfuse: 1 }, max: 1 },
    deepcold: { name: 'Deep Cold', rar: 'r', icon: 'snow', path: 'ice', desc: '+35% chill build-up.', mods: { chillMul: 0.35 }, max: 3 },
    shatter: { name: 'Shatter', rar: 'r', icon: 'gem', path: 'ice', desc: 'Hitting a frozen foe ends the freeze for +80% damage; half of it bursts to foes within 60.', mods: { shatter: 0.8 }, max: 2 },
    brittle: { name: 'Brittle Cold', rar: 'c', icon: 'gem', path: 'ice', desc: '+10% damage to chilled or frozen foes.', mods: { brittle: 0.1 }, max: 2 },
    coldsnap: { name: 'Cold Snap', rar: 'r', icon: 'wing', path: 'ice', desc: 'Dashing releases a frost ring (radius 80) dealing 50% Power; it chills.', mods: { dashFrost: 0.5 }, max: 1 },
    permafrost: { name: 'Permafrost', rar: 'c', icon: 'shield', path: 'ice', desc: 'Freeze lasts 30% longer. Chilled foes deal 10% less damage.', mods: { freezeDur: 0.3, chillWeaken: 0.1 }, max: 2 },
    abszero: { name: 'Absolute Zero', rar: 'e', icon: 'snow', path: 'ice', key: true, desc: 'Freezing a foe releases a frost nova adding 60 chill to foes within 100.', mods: { frostNova: 1 }, max: 1 },
    evo_ice: { name: 'Glacial Arms', rar: 'l', icon: 'snow', path: 'ice', evo: 'ice', desc: 'Every 3rd attack fires 5 piercing ice shards in a fan along your aim (50% each). Chill +25%.', mods: { chillMul: 0.25 }, max: 1 },

    // ---- Lightning ----
    staticcharge: { name: 'Static Charge', rar: 'r', icon: 'bolt', path: 'lightning', gate: true, desc: 'Hits charge foes with 25% of their damage; each second they discharge to themselves and 3 nearby foes (60%).', mods: { lightningInfuse: 0.25 }, max: 1 },
    conductor: { name: 'Conductor', rar: 'r', icon: 'bolt', path: 'lightning', desc: '+1 arc target and +30% arc range.', mods: { arcs: 1, arcRange: 0.3 }, max: 2 },
    highvoltage: { name: 'High Voltage', rar: 'r', icon: 'star', path: 'lightning', desc: 'Discharges deal +20%.', mods: { shockMul: 0.2 }, max: 3 },
    shortcircuit: { name: 'Short Circuit', rar: 'r', icon: 'bolt', path: 'lightning', desc: 'A charged foe that dies discharges at once at +25%.', mods: { shortCircuit: 0.25 }, max: 2 },
    thunderstep: { name: 'Thunderstep', rar: 'r', icon: 'wingblade', path: 'lightning', desc: 'Foes you dash through take 100% Power; it charges them.', mods: { dashDmg: 1 }, max: 1 },
    overload: { name: 'Overload', rar: 'c', icon: 'magnet', path: 'lightning', desc: 'Discharges stun non-boss foes for 0.25s (elites half), at most once per second per foe.', mods: { arcStun: 0.25 }, max: 2 },
    thunderhead: { name: 'Thunderhead', rar: 'e', icon: 'bolt', path: 'lightning', key: true, desc: 'Each discharge has a 25% chance to drop a thunderbolt: 200% Power, radius 60 (once per 0.6s).', mods: { thunderbolt: 0.25 }, pw: { k: 2 }, max: 1 },
    evo_lightning: { name: 'Tempest Arms', rar: 'l', icon: 'bolt', path: 'lightning', evo: 'lightning', desc: 'Every 4th attack calls lightning on the foe nearest the point 80 ahead of your aim, within 220 (150% weapon damage, radius 50). Foes discharge every 0.5s.', mods: {}, max: 1 },

    // ---- Poison ----
    envenom: { name: 'Envenom', rar: 'r', icon: 'drop', path: 'poison', gate: true, desc: 'Hits build Venom. Envenomed foes take up to +25% damage from you (+12.5% from allies); at full Venom a foe is Corroded and its guard breaks.', mods: { poisonInfuse: 1 }, max: 1 },
    potency: { name: 'Potent Toxin', rar: 'c', icon: 'potion', path: 'poison', desc: '+30% Venom build-up; Venom starts fading 1s later.', mods: { venomBuild: 0.3, venomHold: 1 }, max: 2 },
    caustic: { name: 'Caustic', rar: 'r', icon: 'drop', path: 'poison', desc: 'Venom bonus +6% at full Venom.', mods: { corrode: 0.06 }, max: 3 },
    fester: { name: 'Fester', rar: 'c', icon: 'skull', path: 'poison', desc: '+10% damage to envenomed foes.', mods: { fester: 0.1 }, max: 2 },
    sporeburst: { name: 'Spore Burst', rar: 'r', icon: 'bomb', path: 'poison', desc: 'An envenomed foe that dies gives foes within 80 35% of its Venom.', mods: { sporeBurst: 0.35 }, max: 2 },
    noxiousstep: { name: 'Noxious Step', rar: 'r', icon: 'wing', path: 'poison', desc: 'Foes you dash through take 80% Power; that hit builds +200% Venom.', mods: { dashDmg: 0.8, dashVenom: 2 }, max: 1 },
    pandemic: { name: 'Pandemic', rar: 'e', icon: 'orb', path: 'poison', key: true, desc: 'Every second, each Corroded foe gives 30% of its Venom to the 2 nearest foes within 90 that hold less.', mods: { pandemic: 0.3 }, max: 1 },
    evo_poison: { name: 'Venomous Arms', rar: 'l', icon: 'drop', path: 'poison', evo: 'poison', desc: 'Every 3rd attack bursts acid where it lands (melee: at the swing tip along your aim; projectiles: the first shot, on hit or at range end): radius 50, 60% weapon damage as Poison, +200% Venom. Venom bonus +10% at full Venom.', mods: { corrode: 0.1 }, max: 1 },

    // ---- Holy ----
    consecrate: { name: 'Consecrate', rar: 'r', icon: 'sun', path: 'holy', gate: true, desc: "Hits store 30% of their damage as Radiance. At 12% of a foe's health (elites 6%, bosses 2%) it Smites for the stored amount and shields heroes within 160 for 1% max health (2% from elites and bosses), once per 3s each, up to 6%.", mods: { holyInfuse: 0.3 }, max: 1 },
    fervor: { name: 'Fervor', rar: 'c', icon: 'sun', path: 'holy', desc: 'Hits store 8% more of their damage as Radiance.', mods: { holyInfuse: 0.08 }, max: 2 },
    zealotry: { name: 'Zealotry', rar: 'r', icon: 'star', path: 'holy', desc: 'Smites deal +25%.', mods: { smiteMul: 0.25 }, max: 3 },
    sanctity: { name: 'Sanctity', rar: 'r', icon: 'shieldgold', path: 'holy', desc: 'Smites shield 0.25% more; your Holy shield holds up to 3% more.', mods: { smiteShield: 0.0025, holyCap: 0.03 }, max: 2 },
    beacon: { name: 'Beacon', rar: 'r', icon: 'lantern', path: 'holy', desc: 'Smites also strike foes within 70 for 30% of their damage.', mods: { beacon: 0.3 }, max: 2 },
    dawnstride: { name: 'Dawn Stride', rar: 'r', icon: 'wingblade', path: 'holy', desc: 'Foes you dash through take 80% Power and are blinded for 1s (elites 0.5s; bosses are never blinded). A foe is blinded this way at most once per 4s.', mods: { dashDmg: 0.8, dashBlind: 1 }, max: 1 },
    radiantaegis: { name: 'Radiant Aegis', rar: 'e', icon: 'shieldgold', path: 'holy', key: true, desc: 'While you are shielded, your hits store twice the Radiance. Damage your shield absorbs strikes the attacker for 200% as Holy damage.', mods: { radiantAegis: 1 }, max: 1 },
    evo_holy: { name: 'Hallowed Arms', rar: 'l', icon: 'sun', path: 'holy', evo: 'holy', desc: 'Every 3rd attack releases a lance of light along your aim (melee 150 long, projectiles 260, 20 wide): 80% weapon damage as Holy to every foe on it. Smites shield 0.25% more.', mods: { smiteShield: 0.0025 }, max: 1 },

    // ---- Shadow ----
    doommark: { name: 'Mark of Doom', rar: 'r', icon: 'mask', path: 'shadow', gate: true, desc: 'Hits mark 30% of their damage as Doom (elites and bosses take 70% of it). A foe whose health falls to its Doom is Reaped. A boss takes its Doom as damage each time it reaches 5% of its health.', mods: { shadowInfuse: 0.3 }, max: 1 },
    malignance: { name: 'Malignance', rar: 'c', icon: 'mask', path: 'shadow', desc: 'Hits mark 8% more of their damage as Doom.', mods: { shadowInfuse: 0.08 }, max: 2 },
    malice: { name: 'Malice', rar: 'c', icon: 'skull', path: 'shadow', desc: '+10% damage to foes carrying Doom.', mods: { malice: 0.1 }, max: 2 },
    inevitable: { name: 'Inevitable', rar: 'r', icon: 'skull', path: 'shadow', desc: 'Elites and bosses take 15% more of your Doom (full at rank 2).', mods: { doomTough: 0.15 }, max: 2 },
    deathknell: { name: 'Death Knell', rar: 'r', icon: 'drum', path: 'shadow', desc: 'Each Reap or Toll grants +4% damage for 6s, stacking 5 times per rank.', mods: { knell: 5 }, max: 2 },
    deathsedge: { name: "Death's Edge", rar: 'r', icon: 'dagger', path: 'shadow', desc: 'Each Reap or Toll readies a guaranteed crit (up to 3 stored).', mods: { deathsEdge: 1 }, max: 1 },
    umbralstep: { name: 'Umbral Step', rar: 'r', icon: 'cloak', path: 'shadow', desc: 'Foes you dash through take 80% Power; that hit marks +60% of its damage as Doom.', mods: { dashDmg: 0.8, dashDoom: 0.6 }, max: 1 },
    reaper: { name: 'Reaper', rar: 'e', icon: 'axe', path: 'shadow', key: true, desc: 'A Reaped foe implodes: 20% of its health (elites 10%) as Shadow damage to foes within 80.', mods: { reaper: 0.2 }, max: 1 },
    evo_shadow: { name: 'Umbral Arms', rar: 'l', icon: 'mask', path: 'shadow', evo: 'shadow', desc: 'A shadow twin repeats every attack 0.15s later at 40%; twin hits mark double Doom.', mods: {}, max: 1 },

    // ---- General (Generalist only; keen and brutal also open at rank 1 to element heroes) ----
    generalist: { name: 'Generalist', rar: 'r', icon: 'sword', path: 'general', gate: true, desc: 'Forsake the elements: you never see element boons or relics. +15% damage, +5% crit chance; crits Bleed for 30% of the hit. Open boon caps +1.', mods: { dmg: 0.15, crit: 0.05, bleed: 0.3, openRank: 1 }, max: 1 },
    keen: { name: 'Keen Eye', rar: 'c', icon: 'eye', path: 'general', openMax: 1, desc: '+5% crit chance.', mods: { crit: 0.05 }, max: 2 },
    brutal: { name: 'Brutality', rar: 'r', icon: 'skull', path: 'general', openMax: 1, desc: '+25% crit damage.', mods: { critDmg: 0.25 }, max: 3 },
    lacerate: { name: 'Lacerate', rar: 'r', icon: 'dagger', path: 'general', desc: '+12% damage to bleeding foes.', mods: { lacerate: 0.12 }, max: 2 },
    execute: { name: 'Executioner', rar: 'r', icon: 'axe', path: 'general', desc: '+25% damage to foes below 30% health.', mods: { execute: 0.25 }, max: 2 },
    deepcuts: { name: 'Deep Cuts', rar: 'r', icon: 'blades', path: 'general', desc: 'Bleed deals +30%.', mods: { bleedMul: 0.3 }, max: 2 },
    opportunist: { name: 'Opportunist', rar: 'r', icon: 'hand', path: 'general', desc: '+25% damage to stunned, frozen, blinded or slowed foes.', mods: { opportunist: 0.25 }, max: 1 },
    sunder: { name: 'Sunder', rar: 'r', icon: 'blades', path: 'general', desc: 'Each crit makes that foe take +4% damage from you per stack (max 10).', mods: { sunder: 1 }, max: 1 },
    masterstroke: { name: 'Masterstroke', rar: 'e', icon: 'sword', path: 'general', key: true, desc: 'Every 4th attack is a guaranteed crit at +30% that Bleeds for 50% of the hit.', mods: { masterstroke: 1 }, max: 1 },
    evo_general: { name: 'Masterwork Arms', rar: 'l', icon: 'sword', path: 'general', evo: 'general', desc: 'Crits release a spectral strike (a repeat swing or a spectral shot) at 60%. +10% crit chance.', mods: { crit: 0.1 }, max: 1 },

    // ---- duos (need both element gates; both paths at DUO_AFFINITY put the duo on every offer) ----
    thermalshock: { name: 'Thermal Shock', rar: 'd', icon: 'snow', duo: ['fire', 'ice'], desc: 'Burning foes build chill 25% faster. Freezing a burning foe detonates its Burn: the whole pool x2 hits it, 60% of that bursts to foes within 70 and chills them.', mods: { thermal: 1 }, max: 1 },
    plasma: { name: 'Plasma', rar: 'd', icon: 'star', duo: ['fire', 'lightning'], desc: 'Discharges add Burn equal to 40% of their damage; a burning foe arcs to 1 more foe.', mods: { plasma: 1 }, max: 1 },
    firedamp: { name: 'Firedamp', rar: 'd', icon: 'bomb', duo: ['fire', 'poison'], desc: 'A foe that dies burning and envenomed explodes: 20% of its health (elites 10%) as Fire damage to foes within 80, who catch Burn (50% of the blast) and Venom from it.', mods: { firedamp: 1 }, max: 1 },
    sunfire: { name: 'Sunfire', rar: 'd', icon: 'sun', duo: ['fire', 'holy'], desc: 'Smites set the foe and foes within 60 alight for 60% of the Smite.', mods: { sunfire: 1 }, max: 1 },
    blackflame: { name: 'Black Flame', rar: 'd', icon: 'ember', duo: ['fire', 'shadow'], desc: 'Burn still to come counts toward Doom; a Reaped burning foe hands its Burn to the nearest foe within 90.', mods: { blackflame: 1 }, max: 1 },
    superconductor: { name: 'Superconductor', rar: 'd', icon: 'bolt', duo: ['ice', 'lightning'], desc: 'Discharges chill what they hit (as Frostbite, from their damage). A frozen foe\'s discharge deals +50% and arcs to 2 more foes at full strength.', mods: { supercond: 1 }, max: 1 },
    cryotoxin: { name: 'Cryotoxin', rar: 'd', icon: 'potion', duo: ['ice', 'poison'], desc: "Envenomed foes build chill 25% faster; while frozen, a foe's Venom bonus is doubled.", mods: { cryotoxin: 1 }, max: 1 },
    hoarlight: { name: 'Hoarlight', rar: 'd', icon: 'gem', duo: ['ice', 'holy'], desc: "Smites chill the foe and foes within 70 by the Smite's damage; Smites on frozen foes deal double.", mods: { hoarlight: 1 }, max: 1 },
    blackice: { name: 'Black Ice', rar: 'd', icon: 'snow', duo: ['ice', 'shadow'], desc: 'Frozen foes are Reaped at twice their Doom; a Reaped frozen foe shatters for 20% of its health (elites 10%) as Ice damage to foes within 70.', mods: { blackice: 1 }, max: 1 },
    galvanic: { name: 'Galvanic Venom', rar: 'd', icon: 'drop', duo: ['lightning', 'poison'], desc: 'Discharges build Venom in what they hit (from their damage); a Corroded foe arcs to 1 more foe.', mods: { galvanic: 1 }, max: 1 },
    wrathofheaven: { name: 'Wrath of Heaven', rar: 'd', icon: 'bolt', duo: ['lightning', 'holy'], desc: 'Every Smite calls a thunderbolt: 60% of the Smite as Lightning to foes within 70, and the smitten foe is charged with half of the bolt. Discharges store 30% of their damage as Radiance in the foe that discharges.', mods: { heavenwrath: 1 }, max: 1 },
    blacklightning: { name: 'Black Lightning', rar: 'd', icon: 'bolt', duo: ['lightning', 'shadow'], desc: 'Discharges mark 50% of their damage as Doom.', mods: { blackLight: 1 }, max: 1 },
    purge: { name: 'Purge', rar: 'd', icon: 'sun', duo: ['poison', 'holy'], desc: 'A Smite on a Corroded foe deals +50% and shields twice as much (still once per 3s each, at most 3%).', mods: { purge: 1 }, max: 1 },
    necrosis: { name: 'Necrosis', rar: 'd', icon: 'skull', duo: ['poison', 'shadow'], desc: "Venom raises the Reap line by up to 10% of the foe's health; Corroded bosses take Tolls 25% harder.", mods: { necrosis: 1 }, max: 1 },
    twilight: { name: 'Twilight', rar: 'd', icon: 'mask', duo: ['holy', 'shadow'], desc: "Smites mark their damage as Doom. Each Reap forces a Smite on the nearest foe within 120, joined by a black-gold beam: its Radiance x1.5, and at least half a Smite's worth.", mods: { twilight: 1 }, max: 1 },
  };
  ED.BOON_IDS = Object.keys(B);
  ED.RARITY = {
    c: { name: 'Common', color: '#cfc6b6', w: 60 },
    r: { name: 'Rare', color: '#6fb2ff', w: 30 },
    e: { name: 'Epic', color: '#c98bff', w: 10 },
    l: { name: 'Legendary', color: '#ffb02e', w: 4 },
    d: { name: 'Duo', color: '#5ff2c0', w: 12 },
  };

  // Gate boon id per path.
  ED.PATH_GATE = {};
  for (const id in B) if (B[id].gate) ED.PATH_GATE[B[id].path] = id;

  // Path of a boon id, or null (open, duo and class boons).
  ED.boonPath = (id) => (ED.BOONS[id] && ED.BOONS[id].path) || null;
  // True when the hero took the Generalist gate; boons = { id: rank }.
  ED.isGeneralist = (boons) => !!(boons && boons.generalist > 0);
  // Sum of ranks owned in a path. Open boons count toward none; the General path counts only for a Generalist.
  ED.pathAffinity = (boons, path) => {
    if (path === 'general' && !ED.isGeneralist(boons)) return 0;
    let n = 0;
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.path === path && !b.open) n += boons[id]; }
    return n;
  };
  // Paths whose gate is owned, in pick order.
  ED.gatePaths = (boons) => {
    const out = [];
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.gate && boons[id] > 0 && !out.includes(b.path)) out.push(b.path); }
    return out;
  };
  // Element paths whose gate is owned, in pick order.
  ED.elementGates = (boons) => ED.gatePaths(boons).filter(k => ED.PATHS[k].element);
  // The hero's deepest path: 'general' for a Generalist, else the owned element gate with the most affinity (first picked on a tie), or null before the start pick.
  ED.mainPath = (boons) => {
    if (ED.isGeneralist(boons)) return 'general';
    let best = null, bn = -1;
    for (const k of ED.elementGates(boons)) { const n = ED.pathAffinity(boons, k); if (n > bn) { bn = n; best = k; } }
    return best;
  };
  // Duo boon id of two element paths, or null.
  ED.duoOf = (a, b) => {
    for (const id in ED.BOONS) { const d = ED.BOONS[id].duo; if (d && d.includes(a) && d.includes(b) && a !== b) return id; }
    return null;
  };
  // Path of the evolution owned in boons, or null.
  ED.evoOf = (boons) => {
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.evo && boons[id] > 0) return b.evo; }
    return null;
  };
  // Highest rank a hero can hold of boon b: openMax for a gated boon shown to a non-Generalist; open boons gain 1 rank (when they have 2+) with the Generalist gate. st = the hero's stat block.
  ED.maxRank = (b, st) => {
    const max = b.max || 5;
    if (b.openMax && !(st && st.openRank)) return b.openMax;
    return max + (b.open && max >= 2 && st && st.openRank ? 1 : 0);
  };
  // Relics tagged with an element never reach a Generalist.
  ED.relicFits = (p, id) => !ED.RELICS[id].el || !ED.isGeneralist(p.boons);
  // Damage of a proc defined as { pw: { base, k } } for a hero with Class Power st.power.
  ED.procDmg = (def, st) => (def.pw.base || 0) + def.pw.k * st.power;
})(globalThis.ED || (globalThis.ED = {}));
