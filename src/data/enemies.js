// Enemy roster. Stats are stratum-1 baselines; the world scales HP/damage by depth, party size and pact. dmg and dps are in hero health points (a Knight has 45); hp is foe health.
// ai: behaviour module in sim/ai.js. look: draw routine in client/sprites.js. col: palette (a body, b shade, c eyes/glow).
// Attack blocks read by ai.js: lunge, charge, slam, shot(fan), pattern(glob), cast, step, lob, guard{arc,mul,turn}, bash, claw, pulse, dive, orbit, burst, howl, web, leap+cleave, burrow, priest, rift.
(function (ED) {
  'use strict';
  // Casters step away from a close hero: telegraphed `windup` s, then `dist` px, once per `cd` s.
  const STEP = { near: 80, dist: 150, cd: 7, windup: 0.6 };
  const E = ED.ENEMIES = {
    // ---------------- Stratum I: Ossuary ----------------
    skeleton: { name: 'Skeleton', ai: 'chaser', look: 'skeleton', col: { a: '#e6dfc9', b: '#9a917b', c: '#ff5a3a' }, hp: 24, spd: 58, dmg: 2.5, r: 10, xp: 3, cost: 2,
      lunge: { range: 46, windup: 0.42, speed: 250, dur: 0.18, cd: 1.5 } },
    bat: { name: 'Crypt Bat', ai: 'swarm', look: 'bat', col: { a: '#5b4a5e', b: '#2f2433', c: '#ff4a4a' }, hp: 9, spd: 104, dmg: 1.5, r: 8, xp: 1, cost: 1, fly: true },
    bonearcher: { name: 'Bone Archer', ai: 'shooter', look: 'skeleton', bow: true, col: { a: '#d8cfb4', b: '#8c836c', c: '#ffb13a' }, hp: 18, spd: 48, dmg: 2.25, r: 10, xp: 3, cost: 2,
      keep: [90, 220], shot: { cd: 2.4, windup: 0.6, n: 1, spread: 0, speed: 190, r: 5, kind: 'bone', fan: { every: 3, n: 3, spread: 0.3 } } },
    slime: { name: 'Grave Slime', ai: 'chaser', look: 'slime', col: { a: '#8fbf5a', b: '#4f7a2f', c: '#1d2b10' }, hp: 30, spd: 42, dmg: 2, r: 12, xp: 2, cost: 2,
      split: { into: 'slimelet', n: 2 } },
    slimelet: { name: 'Slimelet', ai: 'swarm', look: 'slime', col: { a: '#a6d56c', b: '#5d8a35', c: '#1d2b10' }, hp: 9, spd: 70, dmg: 1.25, r: 7, xp: 1, cost: 0, minion: true },
    skelknight: { name: 'Skeleton Knight', ai: 'tank', look: 'knight', col: { a: '#cfc8b1', b: '#5b5a55', c: '#ff5a3a' }, hp: 80, spd: 44, dmg: 3.75, r: 15, xp: 10, cost: 5,
      slam: { range: 52, radius: 64, windup: 0.85, cd: 2.6 }, guard: { arc: 2.0, mul: 0.35, turn: 2.5 } },
    priest: { name: 'Bone Priest', ai: 'priest', look: 'priest', col: { a: '#7d8a6a', b: '#2f3a28', c: '#e8ff9a' }, hp: 30, spd: 42, dmg: 2.25, r: 10, xp: 6, cost: 4,
      priest: { cd: 6, windup: 0.9, ward: 0.35, max: 2, total: 5 } },

    // ---------------- Stratum II: Glowmire ----------------
    myconid: { name: 'Myconid', ai: 'chaser', look: 'shroom', col: { a: '#c86bff', b: '#6b3a8a', c: '#7dffd9' }, hp: 34, spd: 52, dmg: 2.75, r: 12, xp: 3, cost: 2,
      deathCloud: { r: 42, dur: 2.6, dps: 1.75 } },
    sporepuff: { name: 'Spore Puff', ai: 'bomber', look: 'puff', col: { a: '#9cff6a', b: '#4a8a2a', c: '#f6ffde' }, hp: 14, spd: 84, dmg: 4.5, r: 9, xp: 2, cost: 2,
      fuse: 0.7, boom: 54, fly: true },
    spitter: { name: 'Spitcap', ai: 'turret', look: 'spitter', col: { a: '#4ff0c8', b: '#24796a', c: '#e0fff7' }, hp: 28, spd: 0, dmg: 2.25, r: 12, xp: 3, cost: 2,
      pattern: { type: 'spread', cd: 2.3, windup: 0.6, n: 3, spread: 0.32, speed: 170, r: 6, kind: 'spore', glob: { radius: 46, flight: 0.95, mire: 2.5 } } },
    cavespider: { name: 'Cave Spider', ai: 'charger', look: 'spider', col: { a: '#3b3350', b: '#1d1828', c: '#7dffd9' }, hp: 22, spd: 70, dmg: 3, r: 10, xp: 3, cost: 2,
      charge: { range: 210, windup: 0.55, speed: 340, dur: 0.34, cd: 2.2 }, web: { range: [120, 300], cd: 5, windup: 0.5, speed: 240, r: 38, mire: 2.2 } },
    glowslime: { name: 'Glow Slime', ai: 'chaser', look: 'slime', col: { a: '#5ff2d0', b: '#22806e', c: '#062720' }, hp: 34, spd: 44, dmg: 2.25, r: 12, xp: 2, cost: 2,
      split: { into: 'glowlet', n: 2 } },
    glowlet: { name: 'Glowlet', ai: 'swarm', look: 'slime', col: { a: '#8bfbe2', b: '#2fa38b', c: '#062720' }, hp: 10, spd: 72, dmg: 1.25, r: 7, xp: 1, cost: 0, minion: true },
    shroomhulk: { name: 'Shroom Hulk', ai: 'tank', look: 'hulk', col: { a: '#a356d6', b: '#52286e', c: '#9cff6a' }, hp: 90, spd: 40, dmg: 4, r: 16, xp: 10, cost: 5,
      slam: { range: 52, radius: 66, windup: 0.85, cd: 2.6, cloud: true } },
    mireworm: { name: 'Mire Worm', ai: 'burrower', look: 'worm', col: { a: '#6aa67f', b: '#2c4f3f', c: '#e8ff9a' }, hp: 46, spd: 90, dmg: 3.75, r: 12, xp: 6, cost: 4,
      burrow: { near: 80, dig: 1.2, tele: 0.8, radius: 46, expose: 2.2, ring: 8 } },

    // ---------------- Stratum III: Rimefrost ----------------
    icewolf: { name: 'Rime Wolf', ai: 'charger', look: 'wolf', col: { a: '#dcefff', b: '#8aa8c4', c: '#3ad1ff' }, hp: 30, spd: 82, dmg: 3.25, r: 11, xp: 3, cost: 2,
      charge: { range: 230, windup: 0.5, speed: 390, dur: 0.34, cd: 2.0 }, howl: { cd: 9, windup: 0.5, r: 230, mul: 1.3, dur: 3 } },
    frostwisp: { name: 'Frost Wisp', ai: 'swarm', look: 'wisp', col: { a: '#bff0ff', b: '#4fb7ff', c: '#ffffff' }, hp: 13, spd: 96, dmg: 1.75, r: 8, xp: 1, cost: 1, fly: true, chillHit: true,
      dive: { min: 70, range: 170, hover: 115, windup: 0.55, speed: 340, dur: 0.32, cd: 4.2 } },
    rimemage: { name: 'Rime Mage', ai: 'caster', look: 'robed', col: { a: '#3e6a9a', b: '#1d3557', c: '#9fefff' }, hp: 30, spd: 46, dmg: 2.5, r: 10, xp: 4, cost: 3,
      cast: { type: 'ring', n: 8, speed: 150, cd: 3.0, windup: 0.8, r: 6, kind: 'ice' }, step: STEP },
    frozenskel: { name: 'Frozen Dead', ai: 'chaser', look: 'skeleton', col: { a: '#d6f1ff', b: '#7fa3bf', c: '#3ad1ff' }, hp: 36, spd: 60, dmg: 3, r: 10, xp: 3, cost: 2,
      lunge: { range: 46, windup: 0.4, speed: 260, dur: 0.18, cd: 1.4 } },
    icegolem: { name: 'Ice Golem', ai: 'tank', look: 'golem', col: { a: '#bfe3ff', b: '#6d93b5', c: '#3ad1ff' }, hp: 78, spd: 38, dmg: 4, r: 16, xp: 8, cost: 5,
      slam: { range: 54, radius: 70, windup: 0.9, cd: 2.8, ring: { n: 10, speed: 150, kind: 'ice' } } },
    frostknight: { name: 'Frost Warden', ai: 'tank', look: 'knight', col: { a: '#e3f6ff', b: '#5f86a8', c: '#3ad1ff' }, hp: 95, spd: 46, dmg: 4.25, r: 15, xp: 11, cost: 5,
      slam: { range: 54, radius: 68, windup: 0.8, cd: 2.4, ring: { n: 8, speed: 160, kind: 'ice' } } },
    sentinel: { name: 'Frost Sentinel', ai: 'tank', look: 'sentinel', col: { a: '#b9d9f0', b: '#4d7391', c: '#7fe3ff' }, hp: 66, spd: 34, dmg: 3.75, r: 15, xp: 7, cost: 4,
      slam: { range: 50, radius: 58, windup: 0.8, cd: 3.0 }, guard: { arc: 2.2, mul: 0.2, turn: 1.8 },
      bash: { range: 260, min: 80, windup: 0.75, speed: 300, dur: 0.45, cd: 4 } },

    // ---------------- Stratum IV: Cinderforge ----------------
    imp: { name: 'Cinder Imp', ai: 'lobber', look: 'imp', col: { a: '#d8442a', b: '#7a1f12', c: '#ffd36b' }, hp: 20, spd: 72, dmg: 3.5, r: 9, xp: 3, cost: 2,
      keep: [90, 200], lob: { cd: 2.6, windup: 0.45, radius: 42, flight: 0.9, fire: 1.6 } },
    lavahound: { name: 'Lava Hound', ai: 'charger', look: 'wolf', col: { a: '#4a2620', b: '#21100c', c: '#ff8a2a' }, hp: 34, spd: 80, dmg: 3.5, r: 11, xp: 3, cost: 2,
      charge: { range: 220, windup: 0.5, speed: 380, dur: 0.34, cd: 2.1, trail: true } },
    automaton: { name: 'Forge Automaton', ai: 'tank', look: 'golem', col: { a: '#8a6a4a', b: '#3d2c20', c: '#ff8a2a' }, hp: 88, spd: 36, dmg: 4.5, r: 16, xp: 9, cost: 5,
      slam: { range: 54, radius: 70, windup: 0.9, cd: 2.8, ring: { n: 12, speed: 160, kind: 'fire' } } },
    flameturret: { name: 'Flame Totem', ai: 'turret', look: 'totem', col: { a: '#5a3a2a', b: '#2b1a12', c: '#ff7a2a' }, hp: 42, spd: 0, dmg: 2.5, r: 13, xp: 4, cost: 3,
      pattern: { type: 'spiral', cd: 3.4, windup: 0.6, dur: 2.0, rate: 0.11, arms: 2, speed: 150, r: 6, kind: 'fire', turn: 2.2 } },
    cinderbat: { name: 'Cinder Bat', ai: 'swarm', look: 'bat', col: { a: '#6b2a1c', b: '#2d0f08', c: '#ffcf4a' }, hp: 13, spd: 108, dmg: 2, r: 8, xp: 1, cost: 1, fly: true, burnHit: true },
    forgeknight: { name: 'Forge Knight', ai: 'tank', look: 'knight', col: { a: '#7a5a46', b: '#2e1c14', c: '#ff8a2a' }, hp: 105, spd: 46, dmg: 4.75, r: 15, xp: 12, cost: 5,
      slam: { range: 54, radius: 70, windup: 0.8, cd: 2.4, ring: { n: 10, speed: 170, kind: 'fire' } } },
    drone: { name: 'Ember Drone', ai: 'orbiter', look: 'drone', col: { a: '#8a7a6a', b: '#3a2c24', c: '#ff8a2a' }, hp: 22, spd: 78, dmg: 2.5, r: 9, xp: 4, cost: 3, fly: true,
      orbit: { r: 160 }, burst: { cd: 2.6, windup: 0.5, n: 3, gap: 0.13, speed: 270, mul: 0.65, kind: 'droneshot' } },

    // ---------------- Stratum V: Drowned Sanctum ----------------
    drowned: { name: 'The Drowned', ai: 'chaser', look: 'zombie', col: { a: '#6f9a8a', b: '#2f5249', c: '#e8c66b' }, hp: 42, spd: 54, dmg: 3.25, r: 11, xp: 3, cost: 2,
      lunge: { range: 48, windup: 0.42, speed: 250, dur: 0.2, cd: 1.5 } },
    eel: { name: 'Gloom Eel', ai: 'charger', look: 'eel', col: { a: '#2a6a7a', b: '#123540', c: '#e8ff6a' }, hp: 30, spd: 76, dmg: 3.25, r: 10, xp: 3, cost: 2,
      charge: { range: 240, windup: 0.5, speed: 400, dur: 0.36, cd: 1.9 } },
    siren: { name: 'Sea Siren', ai: 'caster', look: 'robed', col: { a: '#2f8f8a', b: '#134846', c: '#e8c66b' }, hp: 34, spd: 50, dmg: 2.75, r: 10, xp: 4, cost: 3,
      cast: { type: 'wave', n: 7, speed: 165, cd: 2.8, windup: 0.7, r: 6, kind: 'water' }, step: STEP },
    crab: { name: 'Temple Crab', ai: 'tank', look: 'crab', col: { a: '#d0603f', b: '#6e2a18', c: '#ffe1a0' }, hp: 74, spd: 50, dmg: 4, r: 15, xp: 8, cost: 4,
      slam: { range: 50, radius: 62, windup: 0.7, cd: 2.2 }, guard: { arc: 1.9, mul: 0.4, turn: 2.2 }, claw: { r: 84, arc: 1.5, windup: 0.6, mul: 1.1 } },
    jelly: { name: 'Lantern Jelly', ai: 'chaser', look: 'jelly', col: { a: '#ff9be6', b: '#9a3a8a', c: '#ffffff' }, hp: 36, spd: 46, dmg: 2.5, r: 12, xp: 3, cost: 2, fly: true,
      split: { into: 'jellet', n: 2 }, pulse: { range: 70, r: 86, windup: 0.75, cd: 4.5, mul: 1.1 } },
    reaver: { name: 'Drowned Reaver', ai: 'leaper', look: 'reaver', col: { a: '#5f8a7a', b: '#26443c', c: '#ffd36b' }, hp: 56, spd: 60, dmg: 3.75, r: 12, xp: 6, cost: 4,
      leap: { min: 90, range: 240, total: 0.7, flight: 0.35, radius: 50, cd: 4.5 }, cleave: { range: 90, r: 78, arc: 1.6, windup: 0.5, pause: 0.4, post: 0.35, mul: 1.1, cd: 2.4 } },
    jellet: { name: 'Jellet', ai: 'swarm', look: 'jelly', col: { a: '#ffc2f0', b: '#b0509f', c: '#ffffff' }, hp: 11, spd: 74, dmg: 1.5, r: 7, xp: 1, cost: 0, minion: true, fly: true },
    tidecaller: { name: 'Tidecaller', ai: 'caster', look: 'robed', col: { a: '#1f6f8f', b: '#0c2f3f', c: '#ffe08a' }, hp: 110, spd: 48, dmg: 3.75, r: 13, xp: 12, cost: 5,
      cast: { type: 'ring', n: 14, speed: 160, cd: 2.6, windup: 0.8, r: 6, kind: 'water' }, step: STEP },

    // ---------------- Stratum VI: Starless Abyss ----------------
    shade: { name: 'Shade', ai: 'chaser', look: 'shade', col: { a: '#2a1f44', b: '#120c22', c: '#ff7ad9' }, hp: 40, spd: 78, dmg: 3.5, r: 10, xp: 3, cost: 2,
      lunge: { range: 54, windup: 0.4, speed: 300, dur: 0.2, cd: 1.3 } },
    starspawn: { name: 'Starspawn', ai: 'orbiter', look: 'star', col: { a: '#f2e6ff', b: '#9a7ad9', c: '#ffffff' }, hp: 16, spd: 102, dmg: 2, r: 8, xp: 1, cost: 1, fly: true,
      orbit: { r: 130, t: [2.2, 4] }, dive: { min: 60, range: 300, windup: 0.5, speed: 360, dur: 0.38, cd: 1.5 } },
    voideye: { name: 'Void Eye', ai: 'turret', look: 'eye', col: { a: '#3a2a5a', b: '#160e2a', c: '#ff5ad9' }, hp: 50, spd: 0, dmg: 4, r: 13, xp: 4, cost: 3, fly: true,
      pattern: { type: 'laser', cd: 3.4, windup: 1.0, dur: 0.45, w: 14, len: 520 } },
    voidwraith: { name: 'Void Wraith', ai: 'caster', look: 'wraith', col: { a: '#5a3a9a', b: '#21124a', c: '#d4bfff' }, hp: 40, spd: 52, dmg: 3, r: 11, xp: 4, cost: 3, fly: true,
      cast: { type: 'homing', n: 3, speed: 110, cd: 3.2, windup: 0.7, r: 7, kind: 'void' }, step: STEP },
    riftcaller: { name: 'Rift Caller', ai: 'summoner', look: 'rift', col: { a: '#4a3478', b: '#1a1033', c: '#ff7ad9' }, hp: 52, spd: 44, dmg: 3, r: 11, xp: 8, cost: 4,
      cast: { type: 'homing', n: 1, speed: 78, cd: 3.4, windup: 0.8, r: 8, kind: 'void' }, rift: { cd: 6, windup: 1.2, n: 2, cap: 4, type: 'starspawn' } },
    horror: { name: 'Abyssal Horror', ai: 'tank', look: 'horror', col: { a: '#3a2350', b: '#170c22', c: '#ff7ad9' }, hp: 105, spd: 36, dmg: 5, r: 17, xp: 10, cost: 5,
      slam: { range: 56, radius: 74, windup: 0.85, cd: 2.6, ring: { n: 12, speed: 150, kind: 'void' } } },
    voidknight: { name: 'Hollow Knight', ai: 'tank', look: 'knight', col: { a: '#3d2d63', b: '#140c26', c: '#ff7ad9' }, hp: 120, spd: 50, dmg: 5.25, r: 15, xp: 13, cost: 5,
      slam: { range: 56, radius: 72, windup: 0.75, cd: 2.2, ring: { n: 12, speed: 175, kind: 'void' } } },

    // ---------------- Allies ----------------
    minion: { name: 'Risen Bones', ai: 'ally', look: 'skeleton', col: { a: '#b6ffe0', b: '#4c8f78', c: '#7dffd9' }, hp: 40, spd: 95, dmg: 10, r: 9, xp: 0, cost: 0, ally: true },

    // ---------------- Bosses (absolute HP, scaled by party and pact; refHp = design HP that chill, Conflagration and Wildfire measure against) ----------------
    bonewarden: { name: 'The Bone Warden', title: 'Keeper of the First Graves', ai: 'boss', look: 'b_warden', col: { a: '#ece4cc', b: '#7d745f', c: '#ff5a3a' },
      hp: 4350, refHp: 800, spd: 60, dmg: 2.4, r: 24, xp: 40, boss: true, quote: 'None leave the Ossuary. Not even the dead.' },
    sporemother: { name: 'The Sporemother', title: 'Bloom of the Glowmire', ai: 'boss', look: 'b_spore', col: { a: '#c86bff', b: '#5b2a7a', c: '#7dffd9' },
      hp: 5950, refHp: 1500, spd: 34, dmg: 2.4, r: 32, xp: 60, boss: true, quote: 'Rest, little ones. Become soil. Become ME.' },
    rimeheart: { name: 'Rimeheart Colossus', title: 'The Frozen Oath', ai: 'boss', look: 'b_rime', col: { a: '#d8f0ff', b: '#6d93b5', c: '#3ad1ff' },
      hp: 16500, refHp: 2600, spd: 44, dmg: 2.4, r: 30, xp: 80, boss: true, quote: 'THE KING SAID: HOLD THE HALL. I HOLD.' },
    forgelord: { name: 'The Forgelord', title: 'Last Smith of the Empire', ai: 'boss', look: 'b_forge', col: { a: '#6a4636', b: '#2a1810', c: '#ff8a2a' },
      hp: 26600, refHp: 4200, spd: 70, dmg: 3.3, r: 26, xp: 100, boss: true, quote: 'Steel remembers every hammer-blow. So will you.' },
    drownedking: { name: 'The Drowned King', title: 'Tyrant Beneath the Tide', ai: 'boss', look: 'b_king', col: { a: '#3f8f88', b: '#173d3b', c: '#e8c66b' },
      hp: 85700, refHp: 5600, spd: 62, dmg: 4.425, r: 26, xp: 120, boss: true, quote: 'Kneel. The sea has already taken your breath.' },
    hollowking: { name: 'The Hollow King', title: 'Crown of the Starless Abyss', ai: 'boss', look: 'b_hollow', col: { a: '#2a1f44', b: '#0e0820', c: '#ff7ad9' },
      hp: 90300, refHp: 7800, spd: 70, dmg: 3.925, r: 24, xp: 160, boss: true, quote: 'You came so far down... only to fill my empty crown.' },

    // ---------------- Fodder (one per biome, appended last: the wire index follows the order; never in a roster) ----------------
    // Horde filler: untelegraphed touch damage capped at FODDER_CAP of the victim's max health, no drops of their own (the room's xp budget pays through motes), never elite or exposed.
    // art names the foe type whose animations the renderer reuses, tinted with col; hp scales 1 + 0.25 per stratum only.
    bonemite: { name: 'Bone Mite', ai: 'swarm', look: 'bat', art: 'bat', col: { a: '#4a4150', b: '#2a2430', c: '#b8503f' }, hp: 7, spd: 84, dmg: 1.5, r: 6, xp: 0, cost: 0, fodder: true, fly: true },
    sporeling: { name: 'Sporeling', ai: 'swarm', look: 'slime', art: 'glowlet', col: { a: '#5c8f86', b: '#2c4f49', c: '#0a1f1b' }, hp: 7, spd: 66, dmg: 1.5, r: 7, xp: 0, cost: 0, fodder: true },
    rimemote: { name: 'Rime Mote', ai: 'swarm', look: 'wisp', art: 'frostwisp', col: { a: '#8aa6b8', b: '#4a6578', c: '#d6e6ee' }, hp: 7, spd: 78, dmg: 1.5, r: 6, xp: 0, cost: 0, fodder: true, fly: true },
    ashimp: { name: 'Ash Imp', ai: 'swarm', look: 'bat', art: 'cinderbat', col: { a: '#4a3a35', b: '#241815', c: '#c98a3a' }, hp: 7, spd: 80, dmg: 1.5, r: 7, xp: 0, cost: 0, fodder: true, fly: true },
    brinepolyp: { name: 'Brine Polyp', ai: 'swarm', look: 'jelly', art: 'jellet', col: { a: '#8f6f88', b: '#5a3a55', c: '#d8c4d4' }, hp: 7, spd: 70, dmg: 1.5, r: 7, xp: 0, cost: 0, fodder: true, fly: true },
    voidmote: { name: 'Void Mote', ai: 'swarm', look: 'star', art: 'starspawn', col: { a: '#6f6585', b: '#352c4d', c: '#b8a8d8' }, hp: 7, spd: 90, dmg: 1.5, r: 6, xp: 0, cost: 0, fodder: true, fly: true },
  };

  ED.ENEMY_IDS = Object.keys(E);
  ED.ENEMY_IDX = ED.U.indexer(ED.ENEMY_IDS);

  // Elite affixes: any regular enemy can be promoted.
  ED.AFFIXES = {
    swift: { name: 'Swift', color: '#7dffb0', desc: 'moves and attacks faster' },
    brutal: { name: 'Brutal', color: '#ff6a4a', desc: 'hits much harder' },
    warded: { name: 'Warded', color: '#7fc8ff', desc: 'shielded until the ward breaks' },
    volatile: { name: 'Volatile', color: '#ffb13a', desc: 'explodes on death' },
    vampiric: { name: 'Vampiric', color: '#d43a5a', desc: 'heals when it hurts you' },
  };
  ED.AFFIX_IDS = Object.keys(ED.AFFIXES);
  ED.hasAffix = (e, id) => !e.affixOff && (e.elite === id || e.elite2 === id); // either affix slot; none while Hex the Strong suppresses them (e.affixOff)

  // Projectile kinds share one table for both teams so the renderer knows how to draw them.
  ED.PROJ_KINDS = ['bone', 'spore', 'ice', 'fire', 'water', 'void', 'arrow', 'bolt', 'firebolt', 'spark', 'fireball', 'knife', 'holy', 'soul', 'plague', 'wave', 'wisp', 'shard', 'blade', 'orb', 'trident', 'skull',
    'hammer', 'crescent', 'iceshard', 'bloodscythe', 'spectral', 'web', 'droneshot', 'thorn', 'shield', 'boomerang']; // append only: indices are the wire format
  ED.PROJ_IDX = ED.U.indexer(ED.PROJ_KINDS);
})(globalThis.ED || (globalThis.ED = {}));
