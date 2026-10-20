// Enemy roster. Stats are stratum-1 baselines; the world scales HP/damage by depth, party size and pact.
// ai: behaviour module in sim/ai.js. look: draw routine in client/sprites.js. col: palette (a body, b shade, c eyes/glow).
(function (ED) {
  'use strict';
  const E = ED.ENEMIES = {
    // ---------------- Stratum I: Ossuary ----------------
    skeleton: { name: 'Skeleton', ai: 'chaser', look: 'skeleton', col: { a: '#e6dfc9', b: '#9a917b', c: '#ff5a3a' }, hp: 24, spd: 58, dmg: 10, r: 10, xp: 3, cost: 2,
      lunge: { range: 46, windup: 0.42, speed: 250, dur: 0.18, cd: 1.5 } },
    bat: { name: 'Crypt Bat', ai: 'swarm', look: 'bat', col: { a: '#5b4a5e', b: '#2f2433', c: '#ff4a4a' }, hp: 9, spd: 104, dmg: 6, r: 8, xp: 1, cost: 1, fly: true },
    bonearcher: { name: 'Bone Archer', ai: 'shooter', look: 'skeleton', bow: true, col: { a: '#d8cfb4', b: '#8c836c', c: '#ffb13a' }, hp: 18, spd: 48, dmg: 9, r: 10, xp: 3, cost: 2,
      keep: [90, 220], shot: { cd: 2.4, windup: 0.6, n: 1, spread: 0, speed: 190, r: 5, kind: 'bone' } },
    slime: { name: 'Grave Slime', ai: 'chaser', look: 'slime', col: { a: '#8fbf5a', b: '#4f7a2f', c: '#1d2b10' }, hp: 30, spd: 42, dmg: 8, r: 12, xp: 2, cost: 2,
      split: { into: 'slimelet', n: 2 } },
    slimelet: { name: 'Slimelet', ai: 'swarm', look: 'slime', col: { a: '#a6d56c', b: '#5d8a35', c: '#1d2b10' }, hp: 9, spd: 70, dmg: 5, r: 7, xp: 1, cost: 0, minion: true },
    skelknight: { name: 'Skeleton Knight', ai: 'tank', look: 'knight', col: { a: '#cfc8b1', b: '#5b5a55', c: '#ff5a3a' }, hp: 80, spd: 44, dmg: 15, r: 15, xp: 10, cost: 5,
      slam: { range: 52, radius: 64, windup: 0.85, cd: 2.6 } },

    // ---------------- Stratum II: Glowmire ----------------
    myconid: { name: 'Myconid', ai: 'chaser', look: 'shroom', col: { a: '#c86bff', b: '#6b3a8a', c: '#7dffd9' }, hp: 34, spd: 52, dmg: 11, r: 12, xp: 3, cost: 2,
      deathCloud: { r: 42, dur: 2.6, dps: 7 } },
    sporepuff: { name: 'Spore Puff', ai: 'bomber', look: 'puff', col: { a: '#9cff6a', b: '#4a8a2a', c: '#f6ffde' }, hp: 14, spd: 84, dmg: 18, r: 9, xp: 2, cost: 2,
      fuse: 0.7, boom: 54, fly: true },
    spitter: { name: 'Spitcap', ai: 'turret', look: 'spitter', col: { a: '#4ff0c8', b: '#24796a', c: '#e0fff7' }, hp: 28, spd: 0, dmg: 9, r: 12, xp: 3, cost: 2,
      pattern: { type: 'spread', cd: 2.3, windup: 0.6, n: 3, spread: 0.32, speed: 170, r: 6, kind: 'spore' } },
    cavespider: { name: 'Cave Spider', ai: 'charger', look: 'spider', col: { a: '#3b3350', b: '#1d1828', c: '#7dffd9' }, hp: 22, spd: 70, dmg: 12, r: 10, xp: 3, cost: 2,
      charge: { range: 210, windup: 0.55, speed: 340, dur: 0.34, cd: 2.2 } },
    glowslime: { name: 'Glow Slime', ai: 'chaser', look: 'slime', col: { a: '#5ff2d0', b: '#22806e', c: '#062720' }, hp: 34, spd: 44, dmg: 9, r: 12, xp: 2, cost: 2,
      split: { into: 'glowlet', n: 2 } },
    glowlet: { name: 'Glowlet', ai: 'swarm', look: 'slime', col: { a: '#8bfbe2', b: '#2fa38b', c: '#062720' }, hp: 10, spd: 72, dmg: 5, r: 7, xp: 1, cost: 0, minion: true },
    shroomhulk: { name: 'Shroom Hulk', ai: 'tank', look: 'hulk', col: { a: '#a356d6', b: '#52286e', c: '#9cff6a' }, hp: 90, spd: 40, dmg: 16, r: 16, xp: 10, cost: 5,
      slam: { range: 52, radius: 66, windup: 0.85, cd: 2.6, cloud: true } },

    // ---------------- Stratum III: Rimefrost ----------------
    icewolf: { name: 'Rime Wolf', ai: 'charger', look: 'wolf', col: { a: '#dcefff', b: '#8aa8c4', c: '#3ad1ff' }, hp: 30, spd: 82, dmg: 13, r: 11, xp: 3, cost: 2,
      charge: { range: 230, windup: 0.5, speed: 390, dur: 0.34, cd: 2.0 } },
    frostwisp: { name: 'Frost Wisp', ai: 'swarm', look: 'wisp', col: { a: '#bff0ff', b: '#4fb7ff', c: '#ffffff' }, hp: 13, spd: 96, dmg: 7, r: 8, xp: 1, cost: 1, fly: true, chillHit: true },
    rimemage: { name: 'Rime Mage', ai: 'caster', look: 'robed', col: { a: '#3e6a9a', b: '#1d3557', c: '#9fefff' }, hp: 30, spd: 46, dmg: 10, r: 10, xp: 4, cost: 3,
      cast: { type: 'ring', n: 8, speed: 150, cd: 3.0, windup: 0.8, r: 6, kind: 'ice' }, blink: 4.5 },
    frozenskel: { name: 'Frozen Dead', ai: 'chaser', look: 'skeleton', col: { a: '#d6f1ff', b: '#7fa3bf', c: '#3ad1ff' }, hp: 36, spd: 60, dmg: 12, r: 10, xp: 3, cost: 2,
      lunge: { range: 46, windup: 0.4, speed: 260, dur: 0.18, cd: 1.4 } },
    icegolem: { name: 'Ice Golem', ai: 'tank', look: 'golem', col: { a: '#bfe3ff', b: '#6d93b5', c: '#3ad1ff' }, hp: 78, spd: 38, dmg: 16, r: 16, xp: 8, cost: 5,
      slam: { range: 54, radius: 70, windup: 0.9, cd: 2.8, ring: { n: 10, speed: 150, kind: 'ice' } } },
    frostknight: { name: 'Frost Warden', ai: 'tank', look: 'knight', col: { a: '#e3f6ff', b: '#5f86a8', c: '#3ad1ff' }, hp: 95, spd: 46, dmg: 17, r: 15, xp: 11, cost: 5,
      slam: { range: 54, radius: 68, windup: 0.8, cd: 2.4, ring: { n: 8, speed: 160, kind: 'ice' } } },

    // ---------------- Stratum IV: Cinderforge ----------------
    imp: { name: 'Cinder Imp', ai: 'lobber', look: 'imp', col: { a: '#d8442a', b: '#7a1f12', c: '#ffd36b' }, hp: 20, spd: 72, dmg: 14, r: 9, xp: 3, cost: 2,
      keep: [90, 200], lob: { cd: 2.6, windup: 0.45, radius: 42, flight: 0.9, fire: 1.6 } },
    lavahound: { name: 'Lava Hound', ai: 'charger', look: 'wolf', col: { a: '#4a2620', b: '#21100c', c: '#ff8a2a' }, hp: 34, spd: 80, dmg: 14, r: 11, xp: 3, cost: 2,
      charge: { range: 220, windup: 0.5, speed: 380, dur: 0.34, cd: 2.1, trail: true } },
    automaton: { name: 'Forge Automaton', ai: 'tank', look: 'golem', col: { a: '#8a6a4a', b: '#3d2c20', c: '#ff8a2a' }, hp: 88, spd: 36, dmg: 18, r: 16, xp: 9, cost: 5,
      slam: { range: 54, radius: 70, windup: 0.9, cd: 2.8, ring: { n: 12, speed: 160, kind: 'fire' } } },
    flameturret: { name: 'Flame Totem', ai: 'turret', look: 'totem', col: { a: '#5a3a2a', b: '#2b1a12', c: '#ff7a2a' }, hp: 42, spd: 0, dmg: 10, r: 13, xp: 4, cost: 3,
      pattern: { type: 'spiral', cd: 3.4, windup: 0.6, dur: 2.0, rate: 0.11, arms: 2, speed: 150, r: 6, kind: 'fire', turn: 2.2 } },
    cinderbat: { name: 'Cinder Bat', ai: 'swarm', look: 'bat', col: { a: '#6b2a1c', b: '#2d0f08', c: '#ffcf4a' }, hp: 13, spd: 108, dmg: 8, r: 8, xp: 1, cost: 1, fly: true, burnHit: true },
    forgeknight: { name: 'Forge Knight', ai: 'tank', look: 'knight', col: { a: '#7a5a46', b: '#2e1c14', c: '#ff8a2a' }, hp: 105, spd: 46, dmg: 19, r: 15, xp: 12, cost: 5,
      slam: { range: 54, radius: 70, windup: 0.8, cd: 2.4, ring: { n: 10, speed: 170, kind: 'fire' } } },

    // ---------------- Stratum V: Drowned Sanctum ----------------
    drowned: { name: 'The Drowned', ai: 'chaser', look: 'zombie', col: { a: '#6f9a8a', b: '#2f5249', c: '#e8c66b' }, hp: 42, spd: 54, dmg: 13, r: 11, xp: 3, cost: 2,
      lunge: { range: 48, windup: 0.42, speed: 250, dur: 0.2, cd: 1.5 } },
    eel: { name: 'Gloom Eel', ai: 'charger', look: 'eel', col: { a: '#2a6a7a', b: '#123540', c: '#e8ff6a' }, hp: 30, spd: 76, dmg: 13, r: 10, xp: 3, cost: 2,
      charge: { range: 240, windup: 0.5, speed: 400, dur: 0.36, cd: 1.9 } },
    siren: { name: 'Sea Siren', ai: 'caster', look: 'robed', col: { a: '#2f8f8a', b: '#134846', c: '#e8c66b' }, hp: 34, spd: 50, dmg: 11, r: 10, xp: 4, cost: 3,
      cast: { type: 'wave', n: 7, speed: 165, cd: 2.8, windup: 0.7, r: 6, kind: 'water' }, blink: 5 },
    crab: { name: 'Temple Crab', ai: 'tank', look: 'crab', col: { a: '#d0603f', b: '#6e2a18', c: '#ffe1a0' }, hp: 74, spd: 50, dmg: 16, r: 15, xp: 8, cost: 4,
      slam: { range: 50, radius: 62, windup: 0.7, cd: 2.2 } },
    jelly: { name: 'Lantern Jelly', ai: 'chaser', look: 'jelly', col: { a: '#ff9be6', b: '#9a3a8a', c: '#ffffff' }, hp: 36, spd: 46, dmg: 10, r: 12, xp: 3, cost: 2, fly: true,
      split: { into: 'jellet', n: 2 } },
    jellet: { name: 'Jellet', ai: 'swarm', look: 'jelly', col: { a: '#ffc2f0', b: '#b0509f', c: '#ffffff' }, hp: 11, spd: 74, dmg: 6, r: 7, xp: 1, cost: 0, minion: true, fly: true },
    tidecaller: { name: 'Tidecaller', ai: 'caster', look: 'robed', col: { a: '#1f6f8f', b: '#0c2f3f', c: '#ffe08a' }, hp: 110, spd: 48, dmg: 15, r: 13, xp: 12, cost: 5,
      cast: { type: 'ring', n: 14, speed: 160, cd: 2.6, windup: 0.8, r: 6, kind: 'water' }, blink: 4 },

    // ---------------- Stratum VI: Starless Abyss ----------------
    shade: { name: 'Shade', ai: 'chaser', look: 'shade', col: { a: '#2a1f44', b: '#120c22', c: '#ff7ad9' }, hp: 40, spd: 78, dmg: 14, r: 10, xp: 3, cost: 2,
      lunge: { range: 54, windup: 0.38, speed: 300, dur: 0.2, cd: 1.3 } },
    starspawn: { name: 'Starspawn', ai: 'swarm', look: 'star', col: { a: '#f2e6ff', b: '#9a7ad9', c: '#ffffff' }, hp: 16, spd: 102, dmg: 8, r: 8, xp: 1, cost: 1, fly: true },
    voideye: { name: 'Void Eye', ai: 'turret', look: 'eye', col: { a: '#3a2a5a', b: '#160e2a', c: '#ff5ad9' }, hp: 50, spd: 0, dmg: 16, r: 13, xp: 4, cost: 3, fly: true,
      pattern: { type: 'laser', cd: 3.4, windup: 1.0, dur: 0.45, w: 14, len: 520 } },
    voidwraith: { name: 'Void Wraith', ai: 'caster', look: 'wraith', col: { a: '#5a3a9a', b: '#21124a', c: '#d4bfff' }, hp: 40, spd: 52, dmg: 12, r: 11, xp: 4, cost: 3, fly: true,
      cast: { type: 'homing', n: 3, speed: 110, cd: 3.2, windup: 0.7, r: 7, kind: 'void' }, blink: 4 },
    horror: { name: 'Abyssal Horror', ai: 'tank', look: 'horror', col: { a: '#3a2350', b: '#170c22', c: '#ff7ad9' }, hp: 105, spd: 36, dmg: 20, r: 17, xp: 10, cost: 5,
      slam: { range: 56, radius: 74, windup: 0.85, cd: 2.6, ring: { n: 12, speed: 150, kind: 'void' } } },
    voidknight: { name: 'Hollow Knight', ai: 'tank', look: 'knight', col: { a: '#3d2d63', b: '#140c26', c: '#ff7ad9' }, hp: 120, spd: 50, dmg: 21, r: 15, xp: 13, cost: 5,
      slam: { range: 56, radius: 72, windup: 0.75, cd: 2.2, ring: { n: 12, speed: 175, kind: 'void' } } },

    // ---------------- Allies ----------------
    minion: { name: 'Risen Bones', ai: 'ally', look: 'skeleton', col: { a: '#b6ffe0', b: '#4c8f78', c: '#7dffd9' }, hp: 40, spd: 95, dmg: 10, r: 9, xp: 0, cost: 0, ally: true },

    // ---------------- Bosses (absolute HP, scaled only by party/pact) ----------------
    bonewarden: { name: 'The Bone Warden', title: 'Keeper of the First Graves', ai: 'boss', look: 'b_warden', col: { a: '#ece4cc', b: '#7d745f', c: '#ff5a3a' },
      hp: 800, spd: 60, dmg: 14, r: 24, xp: 40, boss: true, quote: 'None leave the Ossuary. Not even the dead.' },
    sporemother: { name: 'The Sporemother', title: 'Bloom of the Glowmire', ai: 'boss', look: 'b_spore', col: { a: '#c86bff', b: '#5b2a7a', c: '#7dffd9' },
      hp: 1500, spd: 34, dmg: 14, r: 32, xp: 60, boss: true, quote: 'Rest, little ones. Become soil. Become ME.' },
    rimeheart: { name: 'Rimeheart Colossus', title: 'The Frozen Oath', ai: 'boss', look: 'b_rime', col: { a: '#d8f0ff', b: '#6d93b5', c: '#3ad1ff' },
      hp: 2600, spd: 44, dmg: 15, r: 30, xp: 80, boss: true, quote: 'THE KING SAID: HOLD THE HALL. I HOLD.' },
    forgelord: { name: 'The Forgelord', title: 'Last Smith of the Empire', ai: 'boss', look: 'b_forge', col: { a: '#6a4636', b: '#2a1810', c: '#ff8a2a' },
      hp: 4200, spd: 70, dmg: 15, r: 26, xp: 100, boss: true, quote: 'Steel remembers every hammer-blow. So will you.' },
    drownedking: { name: 'The Drowned King', title: 'Tyrant Beneath the Tide', ai: 'boss', look: 'b_king', col: { a: '#3f8f88', b: '#173d3b', c: '#e8c66b' },
      hp: 5600, spd: 62, dmg: 15, r: 26, xp: 120, boss: true, quote: 'Kneel. The sea has already taken your breath.' },
    hollowking: { name: 'The Hollow King', title: 'Crown of the Starless Abyss', ai: 'boss', look: 'b_hollow', col: { a: '#2a1f44', b: '#0e0820', c: '#ff7ad9' },
      hp: 7800, spd: 70, dmg: 15, r: 24, xp: 160, boss: true, quote: 'You came so far down... only to fill my empty crown.' },
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

  // Projectile kinds share one table for both teams so the renderer knows how to draw them.
  ED.PROJ_KINDS = ['bone', 'spore', 'ice', 'fire', 'water', 'void', 'arrow', 'bolt', 'firebolt', 'spark', 'fireball', 'knife', 'holy', 'soul', 'plague', 'wave', 'wisp', 'shard', 'blade', 'orb', 'trident', 'skull',
    'hammer', 'crescent', 'iceshard', 'bloodscythe', 'spectral', 'web', 'droneshot', 'thorn'];
  ED.PROJ_IDX = ED.U.indexer(ED.PROJ_KINDS);
})(globalThis.ED || (globalThis.ED = {}));
