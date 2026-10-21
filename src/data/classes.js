// Heroes, their weapons and their signature skills.
// Weapon index 0 is available immediately; index 1 unlocks at mastery 3, index 2 at mastery 6.
(function (ED) {
  'use strict';

  ED.PLAYER_COLORS = ['#ff8a3d', '#5fb8ff', '#8ee06a', '#e889e0'];

  ED.CLASSES = {
    knight: {
      name: 'Knight', title: 'Oathsworn Shield', icon: 'shield',
      desc: 'Sturdy frontliner. Sweeping blades cut down crowds; the raised shield turns arrows back.',
      hp: 135, armor: 8, spd: 116, crit: 0.05,
      weapons: ['longsword', 'warhammer', 'glaive'], skill: 'charge', skill2: 'bulwark',
      col: { a: '#a7b0ba', b: '#5d6670', c: '#d6aa55', d: '#2b3038' }, unlock: null,
    },
    ranger: {
      name: 'Ranger', title: 'Warden of the Wilds', icon: 'bow',
      desc: 'Swift archer. Keep your distance and riddle the Deep with arrows.',
      hp: 117, armor: 5, spd: 128, crit: 0.10,
      weapons: ['longbow', 'crossbow', 'twinbows'], skill: 'volley', skill2: 'rain',
      col: { a: '#4f7a3f', b: '#2e4a25', c: '#c8a46a', d: '#1d2a17' }, unlock: null,
    },
    pyro: {
      name: 'Pyromancer', title: 'Keeper of the Flame', icon: 'flame',
      desc: 'Fragile but devastating. Exploding fire clears whole rooms.',
      hp: 89, armor: 2, spd: 120, crit: 0.05,
      weapons: ['firestaff', 'emberwand', 'inferno'], skill: 'nova', skill2: 'meteor',
      col: { a: '#9a2f2a', b: '#5a1714', c: '#ffb347', d: '#2a0c0a' }, unlock: null,
    },
    shade: {
      name: 'Shade', title: 'Blade in the Dark', icon: 'dagger',
      desc: 'Fastest hero alive. Blinks through foes and lands guaranteed crits.',
      hp: 97, armor: 3, spd: 138, crit: 0.12,
      weapons: ['daggers', 'knives', 'scythes'], skill: 'step', skill2: 'vanish',
      col: { a: '#3a3550', b: '#1f1b2e', c: '#b78cff', d: '#121018' }, unlock: { boss: 1, text: 'Defeat The Bone Warden' },
    },
    cleric: {
      name: 'Cleric', title: 'Lantern of the Faithful', icon: 'sun',
      desc: 'Holy bruiser. Shields and heals the whole party; a natural co-op anchor.',
      hp: 121, armor: 7, spd: 114, crit: 0.05,
      weapons: ['mace', 'dawnhammer', 'lantern'], skill: 'sanctuary', skill2: 'judgment',
      col: { a: '#e8e0c8', b: '#a69a78', c: '#ffd36b', d: '#4a4232' }, unlock: { runs: 4, text: 'Complete 4 descents (clear a room in each)' },
    },
    necro: {
      name: 'Necromancer', title: 'Speaker for the Dead', icon: 'skull',
      desc: 'Commands the risen. Fallen foes may rise to fight for you.',
      hp: 91, armor: 2, spd: 120, crit: 0.05,
      weapons: ['bonewand', 'soulscythe', 'plaguestaff'], skill: 'legion', skill2: 'harvest',
      col: { a: '#2f4a42', b: '#17261f', c: '#7dffd9', d: '#0c1411' }, unlock: { boss: 2, text: 'Defeat The Sporemother' },
    },
  };
  ED.CLASS_IDS = Object.keys(ED.CLASSES);

  ED.WEAPONS = {
    // Knight
    longsword: { name: 'Longsword', desc: 'Balanced sweeping cuts.', kind: 'melee', dmg: 18, rate: 0.42, range: 50, arc: 1.9, knock: 130, look: 'sword' },
    warhammer: { name: 'Warhammer', desc: 'Slow, crushing blows with a shockwave.', kind: 'melee', dmg: 34, rate: 0.82, range: 54, arc: 2.2, knock: 240, look: 'hammer', shock: { r: 72, mul: 0.5 } },
    glaive: { name: 'Glaive', desc: 'Long thrusts that reach far.', kind: 'melee', dmg: 20, rate: 0.5, range: 82, arc: 0.75, knock: 150, look: 'spear' },
    // Ranger
    longbow: { name: 'Longbow', desc: 'Fast, accurate arrows.', kind: 'proj', dmg: 12, rate: 0.34, speed: 440, n: 1, spread: 0, pierce: 0, r: 4, life: 0.85, proj: 'arrow', look: 'bow' },
    crossbow: { name: 'Heavy Crossbow', desc: 'Slow bolts that pierce two foes.', kind: 'proj', dmg: 24, rate: 0.72, speed: 560, n: 1, spread: 0, pierce: 2, r: 5, life: 0.8, proj: 'bolt', look: 'crossbow', knock: 120 },
    twinbows: { name: 'Twin Shortbows', desc: 'Two arrows at a time, very fast.', kind: 'proj', dmg: 6, rate: 0.25, speed: 420, n: 2, spread: 0.14, pierce: 0, r: 4, life: 0.7, proj: 'arrow', look: 'bow' },
    // Pyromancer
    firestaff: { name: 'Fire Staff', desc: 'Firebolts that explode on impact.', kind: 'proj', dmg: 12, rate: 0.5, speed: 310, n: 1, spread: 0, pierce: 0, r: 6, life: 1.0, proj: 'firebolt', explode: { r: 40, mul: 0.6 }, look: 'staff' },
    emberwand: { name: 'Ember Wand', desc: 'A torrent of sparks that often ignite.', kind: 'proj', dmg: 6, rate: 0.15, speed: 390, n: 1, spread: 0, jitter: 0.12, pierce: 0, r: 4, life: 0.6, proj: 'spark', burn: 0.15, look: 'wand' },
    inferno: { name: 'Inferno Tome', desc: 'Slow fireballs with huge blasts.', kind: 'proj', dmg: 30, rate: 1.0, speed: 250, n: 1, spread: 0, pierce: 0, r: 9, life: 1.3, proj: 'fireball', explode: { r: 72, mul: 0.8 }, look: 'tome' },
    // Shade
    daggers: { name: 'Twin Daggers', desc: 'Lightning-fast stabs.', kind: 'melee', dmg: 10, rate: 0.21, range: 42, arc: 1.3, knock: 60, look: 'dagger' },
    knives: { name: 'Throwing Knives', desc: 'Fans of three short-range knives.', kind: 'proj', dmg: 7, rate: 0.36, speed: 480, n: 3, spread: 0.22, pierce: 0, r: 4, life: 0.42, proj: 'knife', look: 'dagger' },
    scythes: { name: 'Crescent Scythes', desc: 'Spinning cuts that hit all around you.', kind: 'melee', dmg: 13, rate: 0.48, range: 52, arc: 6.3, knock: 90, look: 'scythe' },
    // Cleric
    mace: { name: 'Holy Mace', desc: 'Every 3rd swing sends a wave of light.', kind: 'melee', dmg: 17, rate: 0.42, range: 46, arc: 1.7, knock: 140, look: 'mace', wave: { every: 3, mul: 0.9 } },
    dawnhammer: { name: 'Dawn Hammer', desc: 'Heavy blows; every 3rd swing sends a wave.', kind: 'melee', dmg: 32, rate: 0.72, range: 52, arc: 2.2, knock: 220, look: 'hammer', wave: { every: 3, mul: 1.0 } },
    lantern: { name: 'Sacred Lantern', desc: 'Piercing holy orbs that heal allies they touch.', kind: 'proj', dmg: 11, rate: 0.42, speed: 300, n: 1, spread: 0, pierce: 1, r: 6, life: 0.9, proj: 'holy', healAlly: 3, look: 'lantern' },
    // Necromancer
    bonewand: { name: 'Bone Wand', desc: 'Seeking soul bolts.', kind: 'proj', dmg: 9, rate: 0.4, speed: 350, n: 1, spread: 0, pierce: 0, r: 5, life: 1.0, proj: 'soul', homing: 4, look: 'wand' },
    soulscythe: { name: 'Soul Scythe', desc: 'Wide reaping arcs; reaped foes rise more often.', kind: 'melee', dmg: 17, rate: 0.56, range: 52, arc: 2.4, knock: 110, look: 'scythe', raise: 0.12 },
    plaguestaff: { name: 'Plague Staff', desc: 'Bolts that burst into lingering plague.', kind: 'proj', dmg: 6, rate: 0.6, speed: 260, n: 1, spread: 0, pierce: 0, r: 6, life: 0.8, proj: 'plague', cloud: { r: 44, dps: 10, dur: 2.6 }, look: 'staff' },
  };

  ED.SKILLS = {
    charge: { name: 'Shield Charge', cd: 6, icon: 'shield', desc: 'Charge forward invulnerable, smashing and stunning everything in your path.' },
    volley: { name: 'Volley', cd: 5, icon: 'arrows', desc: 'Loose a wide fan of 7 piercing arrows.' },
    nova: { name: 'Flame Nova', cd: 7, icon: 'flame', desc: 'Erupt in a ring of fire that burns everything nearby.' },
    step: { name: 'Shadowstep', cd: 4.5, icon: 'cloak', desc: 'Blink forward, cutting through foes. Your next 3 attacks are critical hits.' },
    sanctuary: { name: 'Sanctuary', cd: 11, icon: 'sun', desc: 'Heal nearby allies 7% and consecrate the ground: allies inside take 15% less damage, foes burn.' },
    legion: { name: 'Raise Legion', cd: 12, icon: 'skull', desc: 'Summon 3 skeletal minions for 12 seconds. Kills may also raise minions.' },
    // Second skill (skill2 binding): one per class, cooldown reduction applies like the first.
    bulwark: { name: 'Bulwark', cd: 9, icon: 'bulwark', desc: 'Raise your shield toward your aim for 1.4s, moving at half speed. Blocks up to 6 hits from the front and turns arrows back (15 + weapon damage). On release, bash for 20 + 1.2x weapon damage, +25% per block.' },
    rain: { name: 'Rain of Arrows', cd: 10, icon: 'rain', desc: 'Mark a point within 260. After 0.35s arrows fall for 2s over radius 80, hitting every foe inside each 0.25s for 4 + 0.45x weapon damage.' },
    meteor: { name: 'Meteor', cd: 12, icon: 'meteor', desc: 'Call a meteor to a point within 300. After 0.9s it lands (radius 95) for 30 + 3.5x weapon damage, knocks foes back, adds Burn worth 50% of the impact and leaves a burning crater for 3s.' },
    vanish: { name: 'Vanish', cd: 11, icon: 'vanish', desc: 'Drop smoke (radius 75, 3s): foes inside are slowed 40% and cannot start attacks. Foes lose track of you for 2.5s; your next attack is an Ambush, a guaranteed crit for +150% damage. Attacking ends stealth.' },
    judgment: { name: 'Judgment', cd: 9, icon: 'hammer', desc: 'Throw a hammer that flies out for 0.55s and returns, piercing. Each leg hits a foe once for 18 + 1.4x weapon damage and Judges it for 4s (+20% damage taken). A judged foe dying heals allies within 160 by 3% max HP (within the hit and kill heal cap).' },
    harvest: { name: 'Bone Harvest', cd: 10, icon: 'harvest', desc: 'Each of your minions explodes (radius 60, 24 + 1.8x weapon damage) and heals you 3% max HP. Then raise 1 minion for 12s, or 2 if you had none.' },
  };

  ED.weaponUnlocked = (cls, idx, masteryLevel) => idx === 0 || (idx === 1 && masteryLevel >= 3) || (idx === 2 && masteryLevel >= 6);
})(globalThis.ED || (globalThis.ED = {}));
