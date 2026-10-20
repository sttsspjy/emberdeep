// Boons: level-up choices. mods are added per stack to the stat block (see sim/stats.js).
// rar: c common, r rare, e epic (keystones), l legendary (evolutions), d duo. need: 'proj' | 'melee' restricts by weapon kind. cls restricts to a hero (class boons live in classboons.js).
// Path boons: path = owning path, gate (opens the path, 3 gates per hero), key (keystone, needs path affinity >= 3), evo (evolution card), duo [a, b] (needs both gates).
(function (ED) {
  'use strict';
  ED.PATHS = {
    pyre: { name: 'Pyre', color: '#ff7a2a', icon: 'flame', element: 'pyre', evo: 'Cinder' },
    rime: { name: 'Rime', color: '#7fe3ff', icon: 'snow', element: 'rime', evo: 'Glacial' },
    storm: { name: 'Storm', color: '#ffe66b', icon: 'bolt', element: 'storm', evo: 'Tempest' },
    steel: { name: 'Steel', color: '#d9dfe8', icon: 'sword', element: null, evo: 'Masterwork' },
    blood: { name: 'Blood', color: '#d43a5a', icon: 'drop', element: null, evo: 'Sanguine' },
    spirit: { name: 'Spirit', color: '#b78cff', icon: 'orb', element: null, evo: 'Ascendant' },
  };
  ED.PATH_IDS = Object.keys(ED.PATHS);
  ED.MAX_GATES = 3;
  ED.KEY_AFFINITY = 3; // path affinity a keystone needs
  ED.EVO_AFFINITY = 5; // path affinity (with its keystone owned) that unlocks the evolution card

  const B = ED.BOONS = {
    // ---- neutral ----
    vigor: { name: 'Vigor', rar: 'c', icon: 'heart', desc: '+15 max health and heal 15.', mods: { hp: 15 }, heal: 15, max: 3 },
    plating: { name: 'Plating', rar: 'c', icon: 'shield', desc: '+5 armor.', mods: { armor: 5 }, max: 2 },
    fleet: { name: 'Fleet Foot', rar: 'c', icon: 'boot', desc: '+7% move speed.', mods: { spd: 0.07 }, max: 2 },
    focus: { name: 'Focus', rar: 'c', icon: 'hourglass', desc: 'Skills recharge 10% faster.', mods: { cdr: 0.10 }, max: 3 },
    lightstep: { name: 'Light Step', rar: 'c', icon: 'wing', desc: 'Dash recharges 20% faster.', mods: { dashcdr: 0.2 }, max: 2 },
    magnet: { name: 'Lodestar', rar: 'c', icon: 'magnet', desc: '+40% pickup range and +10% experience.', mods: { pickup: 0.4, xp: 0.1 }, max: 2 },
    edge: { name: 'Sharpened Edge', rar: 'c', icon: 'sword', desc: '+10% damage.', mods: { dmg: 0.10 }, max: 2 },
    quick: { name: 'Quickened Hands', rar: 'c', icon: 'hand', desc: '+10% attack speed.', mods: { atk: 0.10 }, max: 2 },
    bounty: { name: 'Bounty', rar: 'c', icon: 'coin', desc: '+25% gold.', mods: { gold: 0.25 }, max: 2 },
    wide: { name: 'Wide Arcs', rar: 'r', icon: 'arc', desc: '+15% area: melee reach, blasts and auras.', mods: { area: 0.15 }, max: 2 },
    evade: { name: 'Evasion', rar: 'r', icon: 'cloak', desc: '+6% chance to dodge attacks.', mods: { dodge: 0.06 }, max: 2 },
    thorns: { name: 'Thornmail', rar: 'r', icon: 'thorn', desc: 'Attackers take 10 damage. +4 armor.', mods: { thorns: 10, armor: 4 }, max: 2 },
    pierce: { name: 'Piercing', rar: 'r', icon: 'arrow', desc: 'Projectiles pierce +1 foe.', mods: { pierce: 1 }, need: 'proj', max: 2 },
    split: { name: 'Split Shot', rar: 'r', icon: 'arrows', desc: '+1 projectile per attack, -8% damage.', mods: { projN: 1, dmg: -0.08 }, need: 'proj', max: 2 },
    bladedash: { name: 'Blade Dash', rar: 'r', icon: 'wingblade', desc: 'Dashing through foes deals 120% weapon damage.', mods: { dashDmg: 1.2 }, max: 1 },
    echo: { name: 'Echo', rar: 'e', icon: 'twinblue', desc: 'Your first skill holds a second charge.', mods: { charges: 1 }, max: 1 },
    laststand: { name: 'Last Stand', rar: 'e', icon: 'shieldgold', desc: 'Falling below 30% health grants 3s of 60% damage reduction (20s cooldown).', mods: { guardian: 1 }, max: 1 },
    glass: { name: 'Glass Heart', rar: 'e', icon: 'heartbroken', desc: '+30% damage, -15% max health.', mods: { dmg: 0.3, hpMul: -0.15 }, max: 1 },
    trance: { name: 'Battle Trance', rar: 'e', icon: 'drum', desc: 'Using a skill grants +30% attack speed for 4s.', mods: { trance: 0.3 }, max: 1 },
    overcharge: { name: 'Overcharge', rar: 'e', icon: 'star', desc: 'Your skills also release a damaging shockwave.', mods: { overcharge: 1 }, max: 1 },

    // ---- Pyre ----
    kindle: { name: 'Kindle', rar: 'r', icon: 'flame', path: 'pyre', gate: true, desc: 'Hits add 40% of their damage as Burn.', mods: { pyreInfuse: 0.4 }, max: 1 },
    stoke: { name: 'Stoke the Flames', rar: 'r', icon: 'flame', path: 'pyre', desc: 'Burn deals +30% damage.', mods: { burnMul: 0.3 }, max: 3 },
    searing: { name: 'Searing', rar: 'c', icon: 'sun', path: 'pyre', desc: '+12% damage to burning foes.', mods: { searing: 0.12 }, max: 2 },
    wildfire: { name: 'Wildfire', rar: 'r', icon: 'flame', path: 'pyre', desc: 'A burning foe that dies sets foes within 80 alight for 15% of its max health.', mods: { wildfire: 0.15 }, max: 2 },
    cindertrail: { name: 'Cinder Trail', rar: 'r', icon: 'wing', path: 'pyre', desc: 'Your dash leaves burning ground.', mods: { dashFire: 1 }, max: 1 },
    conflag: { name: 'Conflagration', rar: 'e', icon: 'bomb', path: 'pyre', key: true, desc: 'A foe whose Burn exceeds 30% of its health combusts, hitting it and foes within 70 for the whole pool.', mods: { conflag: 1 }, max: 1 },
    evo_pyre: { name: 'Cinder Arms', rar: 'l', icon: 'flame', path: 'pyre', evo: 'pyre', desc: 'Melee swings launch a piercing flame crescent (60%); projectiles explode on hit (50%); exploding weapons blast 30% wider and leave burning ground. Burn +25%.', mods: { burnMul: 0.25 }, max: 1 },

    // ---- Rime ----
    frostbite: { name: 'Frostbite', rar: 'r', icon: 'snow', path: 'rime', gate: true, desc: 'Hits chill; full chill freezes foes for 1.6s. Frozen foes take +25% damage.', mods: { rimeInfuse: 1 }, max: 1 },
    deepcold: { name: 'Deep Cold', rar: 'r', icon: 'snow', path: 'rime', desc: '+35% chill build-up.', mods: { chillMul: 0.35 }, max: 3 },
    shatter: { name: 'Shatter', rar: 'r', icon: 'gem', path: 'rime', desc: 'Hitting a frozen foe ends the freeze for +80% damage; half of it bursts to foes within 60.', mods: { shatter: 0.8 }, max: 2 },
    coldsnap: { name: 'Cold Snap', rar: 'r', icon: 'wing', path: 'rime', desc: 'Dashing releases a frost ring (radius 80) adding 40 chill.', mods: { dashFrost: 1 }, max: 1 },
    permafrost: { name: 'Permafrost', rar: 'c', icon: 'shield', path: 'rime', desc: 'Freeze lasts 30% longer. Chilled foes deal 10% less damage.', mods: { freezeDur: 0.3, chillWeaken: 0.1 }, max: 2 },
    abszero: { name: 'Absolute Zero', rar: 'e', icon: 'snow', path: 'rime', key: true, desc: 'Freezing a foe releases a frost nova adding 60 chill to foes within 100.', mods: { frostNova: 1 }, max: 1 },
    evo_rime: { name: 'Glacial Arms', rar: 'l', icon: 'snow', path: 'rime', evo: 'rime', desc: 'Every 3rd attack fires 5 piercing ice shards in a fan (50% each). Chill +25%.', mods: { chillMul: 0.25 }, max: 1 },

    // ---- Storm ----
    staticcharge: { name: 'Static Charge', rar: 'r', icon: 'bolt', path: 'storm', gate: true, desc: 'Hits charge foes with 35% of their damage; each second they discharge to themselves and 3 nearby foes.', mods: { stormInfuse: 0.35 }, max: 1 },
    conductor: { name: 'Conductor', rar: 'r', icon: 'bolt', path: 'storm', desc: '+1 arc target and +30% arc range.', mods: { arcs: 1, arcRange: 0.3 }, max: 2 },
    highvoltage: { name: 'High Voltage', rar: 'r', icon: 'star', path: 'storm', desc: 'Discharges deal +25% damage.', mods: { shockMul: 0.25 }, max: 3 },
    thunderstep: { name: 'Thunderstep', rar: 'r', icon: 'wingblade', path: 'storm', desc: 'Foes you dash through take 100% weapon damage.', mods: { dashShock: 1 }, max: 1 },
    overload: { name: 'Overload', rar: 'c', icon: 'magnet', path: 'storm', desc: 'Discharges stun non-boss foes for 0.25s.', mods: { arcStun: 0.25 }, max: 2 },
    thunderhead: { name: 'Thunderhead', rar: 'e', icon: 'bolt', path: 'storm', key: true, desc: 'Each discharge has a 25% chance to drop a thunderbolt: 200% weapon damage, radius 60.', mods: { thunderbolt: 0.25 }, max: 1 },
    evo_storm: { name: 'Tempest Arms', rar: 'l', icon: 'bolt', path: 'storm', evo: 'storm', desc: 'Every 4th attack calls lightning on its target (150%, radius 50). Foes discharge every 0.5s.', mods: {}, max: 1 },

    // ---- Steel ----
    honededge: { name: 'Honed Edge', rar: 'r', icon: 'sword', path: 'steel', gate: true, desc: '+6% critical chance. Crits make foes Bleed for 30% of the hit.', mods: { crit: 0.06, bleed: 0.3 }, max: 1 },
    brutal: { name: 'Brutality', rar: 'r', icon: 'skull', path: 'steel', desc: '+35% critical damage.', mods: { critDmg: 0.35 }, max: 3 },
    keen: { name: 'Keen Eye', rar: 'c', icon: 'eye', path: 'steel', desc: '+6% critical chance.', mods: { crit: 0.06 }, max: 2 },
    lacerate: { name: 'Lacerate', rar: 'r', icon: 'dagger', path: 'steel', desc: '+15% damage to bleeding foes.', mods: { lacerate: 0.15 }, max: 2 },
    execute: { name: 'Executioner', rar: 'r', icon: 'axe', path: 'steel', desc: '+40% damage to foes below 30% health.', mods: { execute: 0.4 }, max: 2 },
    sunder: { name: 'Sunder', rar: 'e', icon: 'blades', path: 'steel', key: true, desc: 'Each crit makes that foe take +4% damage from you (max +40%).', mods: { sunder: 1 }, max: 1 },
    evo_steel: { name: 'Masterwork Arms', rar: 'l', icon: 'sword', path: 'steel', evo: 'steel', desc: 'Crits release a spectral strike at 60%. +10% critical chance.', mods: { crit: 0.1 }, max: 1 },

    // ---- Blood ----
    bloodpact: { name: 'Blood Pact', rar: 'r', icon: 'drop', path: 'blood', gate: true, desc: 'Kills heal 1% max health (within the hit and kill heal cap). +20% damage, and +20% more below 50% health.', mods: { killHealPct: 0.01, berserk: 0.2, dmg: 0.2 }, max: 1 },
    leech: { name: 'Leech', rar: 'r', icon: 'fang', path: 'blood', desc: 'Heal 1.5% of damage dealt. All hit and kill healing together is capped per second.', mods: { leech: 0.015 }, max: 2 },
    bloodrush: { name: 'Bloodrush', rar: 'r', icon: 'boot', path: 'blood', desc: '+8% attack speed. Below 50% health: +15% attack speed and +10% move speed.', mods: { bloodrush: 0.15, atk: 0.08 }, max: 2 },
    transfusion: { name: 'Transfusion', rar: 'c', icon: 'potion', path: 'blood', desc: 'Kills drop a blood orb 20% of the time (heals 4% max health).', mods: { bloodOrb: 0.2 }, max: 1 },
    hemomancy: { name: 'Hemomancy', rar: 'r', icon: 'heartbroken', path: 'blood', desc: 'Skills cost 4% of current health but deal +35% damage.', mods: { hemomancy: 0.35 }, max: 2 },
    crimsontide: { name: 'Crimson Tide', rar: 'e', icon: 'chalice', path: 'blood', key: true, desc: 'Overhealing becomes a blood shield (max 25% max health) that absorbs damage first.', mods: { bloodShield: 0.25 }, max: 1 },
    evo_blood: { name: 'Sanguine Arms', rar: 'l', icon: 'drop', path: 'blood', evo: 'blood', desc: 'Every attack also launches a blood scythe (50%) that heals 15% of its damage. Kill heals are doubled. Healing stays within the hit and kill heal cap.', mods: {}, max: 1 },

    // ---- Spirit ----
    wispcall: { name: 'Spirit Wisp', rar: 'r', icon: 'orb', path: 'spirit', gate: true, desc: 'A wisp fights at your side.', mods: { wisp: 1 }, max: 1 },
    orbit: { name: 'Orbiting Blades', rar: 'r', icon: 'blades', path: 'spirit', desc: '+1 blade circles you, cutting foes.', mods: { orbit: 1 }, max: 3 },
    wispchoir: { name: 'Wisp Choir', rar: 'r', icon: 'orb', path: 'spirit', desc: '+1 wisp.', mods: { wisp: 1 }, max: 2 },
    kindred: { name: 'Kindred', rar: 'c', icon: 'banner', path: 'spirit', desc: 'Companions (wisps, blades, minions) deal +35% damage.', mods: { compDmg: 0.35 }, max: 2 },
    guardians: { name: 'Guardian Spirits', rar: 'r', icon: 'shieldgold', path: 'spirit', desc: 'Blades destroy enemy projectiles they touch (each blade once per second).', mods: { bladeBlock: 1 }, max: 1 },
    bond: { name: 'Elemental Bond', rar: 'e', icon: 'twinblue', path: 'spirit', key: true, desc: 'Companion hits apply your infusions.', mods: { compInfuse: 1 }, max: 1 },
    evo_spirit: { name: 'Ascendant Arms', rar: 'l', icon: 'orb', path: 'spirit', evo: 'spirit', desc: 'A spectral twin repeats every attack 0.15s later at 50%. +1 wisp, +1 blade.', mods: { wisp: 1, orbit: 1 }, max: 1 },

    // ---- duos (need both gates) ----
    thermalshock: { name: 'Thermal Shock', rar: 'd', icon: 'snow', duo: ['pyre', 'rime'], desc: 'When a burning foe freezes, its Burn pool is dealt instantly, doubled.', mods: { thermal: 1 }, max: 1 },
    plasma: { name: 'Plasma', rar: 'd', icon: 'star', duo: ['pyre', 'storm'], desc: 'Discharges add Burn equal to 40% of their damage.', mods: { plasma: 1 }, max: 1 },
    superconductor: { name: 'Superconductor', rar: 'd', icon: 'bolt', duo: ['rime', 'storm'], desc: 'Discharges add 25 chill. Frozen foes arc to 2 extra targets.', mods: { supercond: 1 }, max: 1 },
    hemorrhage: { name: 'Hemorrhage', rar: 'd', icon: 'fang', duo: ['steel', 'blood'], desc: 'Bleed heals you for 10% of its damage (within the hit and kill heal cap).', mods: { hemorrhage: 1 }, max: 1 },
    staticedge: { name: 'Static Edge', rar: 'd', icon: 'dagger', duo: ['steel', 'storm'], desc: "Crits instantly discharge the foe's charge at +50%.", mods: { staticEdge: 1 }, max: 1 },
    serrated: { name: 'Serrated Frost', rar: 'd', icon: 'axe', duo: ['steel', 'rime'], desc: 'Crits on chilled foes add 35 chill. Frozen foes take +50% crit damage.', mods: { serrated: 1 }, max: 1 },
    soulfire: { name: 'Soulfire', rar: 'd', icon: 'ember', duo: ['spirit', 'pyre'], desc: 'Companion hits add Burn equal to 60% of their damage.', mods: { soulfire: 1 }, max: 1 },
    feast: { name: 'Spirit Feast', rar: 'd', icon: 'chalice', duo: ['spirit', 'blood'], desc: 'Companion kills heal you 1% max health (within the hit and kill heal cap). Companions deal +20% damage.', mods: { feast: 1 }, max: 1 },
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

  // Path of a boon id, or null (neutral, duo and class boons).
  ED.boonPath = (id) => (ED.BOONS[id] && ED.BOONS[id].path) || null;
  // Sum of ranks owned in a path; boons = { id: rank }.
  ED.pathAffinity = (boons, path) => {
    let n = 0;
    for (const id in boons) if (ED.BOONS[id] && ED.BOONS[id].path === path) n += boons[id];
    return n;
  };
  // Paths whose gate is owned, in pick order.
  ED.gatePaths = (boons) => {
    const out = [];
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.gate && boons[id] > 0 && !out.includes(b.path)) out.push(b.path); }
    return out;
  };
  // Path of the evolution owned in boons, or null.
  ED.evoOf = (boons) => {
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.evo && boons[id] > 0) return b.evo; }
    return null;
  };
})(globalThis.ED || (globalThis.ED = {}));
