// Heroes, their weapons and their signature skills.
// Weapon index 0 is available immediately; index 1 unlocks at mastery 3, index 2 at mastery 6.
(function (ED) {
  'use strict';

  ED.PLAYER_COLORS = ['#ff8a3d', '#5fb8ff', '#8ee06a', '#e889e0'];
  ED.CLS = {}; // per-class sim hook tables (src/sim/class-*.js)

  ED.CLASSES = {
    knight: {
      name: 'Knight', title: 'Oathsworn Shield', icon: 'shield',
      desc: 'Sturdy frontliner. Sweeping blades cut down crowds; the thrown shield stuns whole packs and swats arrows.',
      hp: 135, armor: 8, spd: 116, crit: 0.05, power: 18, element: null,
      weapons: ['longsword', 'warhammer', 'glaive'], skill: 'charge', skill2: 'shieldthrow',
      col: { a: '#a7b0ba', b: '#5d6670', c: '#d6aa55', d: '#2b3038' }, unlock: null,
    },
    ranger: {
      name: 'Ranger', title: 'Warden of the Wilds', icon: 'bow',
      desc: 'Swift archer. Keep your distance and riddle the Deep with arrows.',
      hp: 117, armor: 5, spd: 128, crit: 0.10, power: 12, element: null,
      weapons: ['longbow', 'crossbow', 'twinbows'], skill: 'volley', skill2: 'rain',
      col: { a: '#4f7a3f', b: '#2e4a25', c: '#c8a46a', d: '#1d2a17' }, unlock: null,
    },
    pyro: {
      name: 'Pyromancer', title: 'Keeper of the Flame', icon: 'flame',
      desc: 'Fragile but devastating. Exploding fire clears whole rooms.',
      hp: 106, armor: 4, spd: 120, crit: 0.05, power: 17, element: 'fire',
      weapons: ['firestaff', 'emberwand', 'inferno'], skill: 'nova', skill2: 'meteor',
      col: { a: '#9a2f2a', b: '#5a1714', c: '#ffb347', d: '#2a0c0a' }, unlock: null,
    },
    shade: {
      name: 'Shade', title: 'Blade in the Dark', icon: 'dagger',
      desc: 'Fastest hero alive. Blinks through foes and lands guaranteed crits.',
      hp: 133, armor: 7, spd: 138, crit: 0.12, power: 13, element: null,
      weapons: ['daggers', 'knives', 'scythes'], skill: 'step', skill2: 'vanish',
      col: { a: '#3a3550', b: '#1f1b2e', c: '#b78cff', d: '#121018' }, unlock: { boss: 1, text: 'Defeat The Bone Warden' },
    },
    cleric: {
      name: 'Cleric', title: 'Lantern of the Faithful', icon: 'sun',
      desc: 'Holy bruiser. Consecrates the ground and shields the whole party; a natural co-op anchor.',
      hp: 121, armor: 7, spd: 114, crit: 0.05, power: 17, element: 'holy',
      weapons: ['mace', 'dawnhammer', 'lantern'], skill: 'sanctuary', skill2: 'judgment',
      col: { a: '#e8e0c8', b: '#a69a78', c: '#ffd36b', d: '#4a4232' }, unlock: { runs: 4, text: 'Complete 4 descents (clear a room in each)' },
    },
    necro: {
      name: 'Necromancer', title: 'Speaker for the Dead', icon: 'skull',
      desc: 'Commands the risen. Fallen foes may rise to fight for you.',
      hp: 91, armor: 2, spd: 120, crit: 0.05, power: 9, element: 'shadow',
      weapons: ['bonewand', 'soulscythe', 'plaguestaff'], skill: 'legion', skill2: 'harvest',
      col: { a: '#2f4a42', b: '#17261f', c: '#7dffd9', d: '#0c1411' }, unlock: { boss: 2, text: 'Defeat The Sporemother' },
    },
  };
  ED.CLASS_IDS = Object.keys(ED.CLASSES);

  ED.WEAPONS = {
    // Knight
    longsword: { name: 'Longsword', desc: 'Balanced sweeping cuts.', kind: 'melee', dmg: 23.4, rate: 0.42, range: 50, arc: 1.9, knock: 130, look: 'sword' },
    warhammer: { name: 'Warhammer', desc: 'Slow, crushing blows with a shockwave.', kind: 'melee', dmg: 44.2, rate: 0.82, range: 54, arc: 2.2, knock: 240, look: 'hammer', shock: { r: 72, mul: 0.5 } },
    glaive: { name: 'Glaive', desc: 'Long thrusts that reach far.', kind: 'melee', dmg: 26, rate: 0.5, range: 82, arc: 0.75, knock: 150, look: 'spear' },
    // Ranger
    longbow: { name: 'Longbow', desc: 'Fast, accurate arrows.', kind: 'proj', dmg: 11, rate: 0.34, speed: 440, n: 1, spread: 0, pierce: 0, r: 4, life: 0.85, proj: 'arrow', look: 'bow' },
    crossbow: { name: 'Heavy Crossbow', desc: 'Slow bolts that pierce two foes.', kind: 'proj', dmg: 22.1, rate: 0.72, speed: 560, n: 1, spread: 0, pierce: 2, r: 5, life: 0.8, proj: 'bolt', look: 'crossbow', knock: 120 },
    twinbows: { name: 'Twin Shortbows', desc: 'Two arrows at a time, very fast.', kind: 'proj', dmg: 4.1, rate: 0.25, speed: 420, n: 2, spread: 0.14, pierce: 0, r: 4, life: 0.7, proj: 'arrow', look: 'bow' },
    // Pyromancer
    firestaff: { name: 'Fire Staff', desc: 'Firebolts that explode on impact.', kind: 'proj', dmg: 15, rate: 0.5, speed: 310, n: 1, spread: 0, pierce: 0, r: 6, life: 1.0, proj: 'firebolt', explode: { r: 40, mul: 0.6 }, look: 'staff' },
    emberwand: { name: 'Ember Wand', desc: 'A torrent of sparks that often ignite.', kind: 'proj', dmg: 6, rate: 0.15, speed: 390, n: 1, spread: 0, jitter: 0.12, pierce: 0, r: 4, life: 0.6, proj: 'spark', burn: 0.15, look: 'wand' },
    inferno: { name: 'Inferno Tome', desc: 'Slow fireballs with huge blasts.', kind: 'proj', dmg: 30, rate: 1.0, speed: 250, n: 1, spread: 0, pierce: 0, r: 9, life: 1.3, proj: 'fireball', explode: { r: 72, mul: 0.8 }, look: 'tome' },
    // Shade
    daggers: { name: 'Twin Daggers', desc: 'Lightning-fast stabs.', kind: 'melee', dmg: 11, rate: 0.21, range: 42, arc: 1.3, knock: 60, look: 'dagger' },
    knives: { name: 'Throwing Knives', desc: 'Fans of three short-range knives.', kind: 'proj', dmg: 7, rate: 0.36, speed: 480, n: 3, spread: 0.22, pierce: 0, r: 4, life: 0.42, proj: 'knife', look: 'dagger' },
    scythes: { name: 'Crescent Scythes', desc: 'Spinning cuts that hit all around you.', kind: 'melee', dmg: 16, rate: 0.48, range: 52, arc: 6.3, knock: 90, look: 'scythe' },
    // Cleric
    mace: { name: 'Holy Mace', desc: 'Every 3rd swing sends a wave of light.', kind: 'melee', dmg: 23, rate: 0.42, range: 46, arc: 1.7, knock: 140, look: 'mace', wave: { every: 3, mul: 0.9 } },
    dawnhammer: { name: 'Dawn Hammer', desc: 'Heavy blows; every 3rd swing sends a wave.', kind: 'melee', dmg: 43.2, rate: 0.72, range: 52, arc: 2.2, knock: 220, look: 'hammer', wave: { every: 3, mul: 1.0 } },
    lantern: { name: 'Sacred Lantern', desc: 'Piercing holy orbs that shield allies they touch (1.5% max health per orb, at most once per 1.5 s per ally, up to 8%; class shields are limited to 3% of max health per 10 s).', kind: 'proj', dmg: 16.9, rate: 0.42, speed: 300, n: 1, spread: 0, pierce: 1, r: 6, life: 0.9, proj: 'holy', shieldAlly: 0.015, look: 'lantern' },
    // Necromancer
    bonewand: { name: 'Bone Wand', desc: 'Seeking soul bolts.', kind: 'proj', dmg: 9, rate: 0.4, speed: 350, n: 1, spread: 0, pierce: 0, r: 5, life: 1.0, proj: 'soul', homing: 4, look: 'wand' },
    soulscythe: { name: 'Soul Scythe', desc: 'Wide reaping arcs; reaped foes rise more often.', kind: 'melee', dmg: 17, rate: 0.56, range: 52, arc: 2.4, knock: 110, look: 'scythe', raise: 0.12 },
    plaguestaff: { name: 'Plague Staff', desc: 'Bolts that burst into lingering plague.', kind: 'proj', dmg: 6, rate: 0.6, speed: 260, n: 1, spread: 0, pierce: 0, r: 6, life: 0.8, proj: 'plague', cloud: { r: 44, dps: 10, dur: 2.6 }, look: 'staff' },
  };

  // Skills. slot 0 = K, 1 = L. aim: 'dir' flies toward the cursor, 'ground' lands on it (clamped to range; walk: on a standable spot), 'move' travels toward it (rangeMin..range, + the stat in rangeAdd), 'self' ignores it.
  // aimIf { stat: aim } overrides aim while the stat is set; moveIf { stat: { k: 'charge' | 'hop' | 'leap', ... } } moves the caster with the cast (iframes seconds untouchable, default = the move time).
  // parts feed ED.Stats.skillNums (the one source for sim, sheet and bots): dmg = (base + pow x X) x (1 + slot damage), X = Power (on 'P'), the equipped weapon's dmg ('W') or the unforked weapon ('B');
  // powKey adds a stat to pow; of + mul / mul1 derive a part from another (mul1: x (1 + stat); times 'ticks': x the tick count); if = the stat that enables the part; mulIf = { stat: factor };
  // r scales with area (x(1 + 0.5 area) x (1 + slot area)), rOf + rMul derive it from another part (pRad: r is a projectile's hit radius; the sheet leaves it out); dur adds slot duration (durFix: none) and is capped at capCd x the effective cooldown; n adds slot count (nFix: none); per: 'hit' | 'tick' | 'sec' | 'minion' | 'status'.
  // Form keys (see Stats.skillNums): durMulKey (the stat multiplies dur), durCd (dur = the cooldown while the stat is set), ringKey (the stat is the arrow count of a full ring), nOf (the count of another part), stunKey (the stat is the stun while set), oneMul with oneEvery; ref (Starfall: reference cast distance for the sheet); mulStat (the stat multiplies the damage), nKey (the stat is the count), perAtk (one hit per weapon attack within dur; 'skip' drops the first);
  // mulFix (a fixed factor of an `of` part), mulFirst (the first listed stat that is set is the damage factor), rAddKey (the stat adds px to the radius);
// bossMul (the part's hits on a boss take this factor: partSrc copies it to the hit, hitEnemy applies it; an `of` part does not inherit it).
  ED.SKILLS = {
    charge: { name: 'Shield Charge', slot: 0, cd: 6, icon: 'shield', aim: 'move', range: 150, rangeMin: 60, rangeAdd: 's1Range', move: { k: 'charge', speed: 600 },
      desc: 'Charge toward the cursor, untouchable, smashing and stunning every foe you run into. A thrown shield flies back to you; foes stunned by your shield take +40% (Crush). Bosses take ×3 but are never stunned.',
      parts: [
        { id: 'impact', label: 'Impact', base: 20, pow: 1.6, per: 'hit', proc: true, stun: 1.0, knock: 260, crush: 0.4, reach: 26, bossMul: 3, note: '+40% vs foes your shield stunned (Crush); bosses ×3, never stunned' },
        { id: 'shock', label: 'Shockwave', if: 'jugShock', ifNot: 'avalanche', of: 'impact', mul: 'jugShock', per: 'hit', r: 90, knock: 220, proc: false },
        { id: 'bash', label: 'Shield Bash', if: 'bash', per: 'hit', mulKey: 'bash', proc: true },
        { id: 'quake', label: 'Avalanche slam', if: 'avalanche', of: 'impact', mul: 'avalanche', per: 'hit', r: 160, knock: 300, stunKey: 'avaStun', bossMul: 1.5, proc: true },
        { id: 'crack', label: 'Ground cracks', if: 'avalanche', of: 'impact', mul: 'avaCrack', per: 'hit', n: 3, nFix: true, len: 220, w: 44, delay: 0.3, knock: 120, proc: true },
        { id: 'banner', label: 'War Banner', if: 'phalanx', of: 'impact', mul: 'bannerDmg', per: 'sec', r: 120, durKey: 'bannerDur', stun: 0.4, noCrit: true, note: 'per second to every foe inside; the planting pulse stuns' },
      ] },
    shieldthrow: { name: 'Shield Throw', slot: 1, cd: 9, icon: 'bulwark', aim: 'dir', range: 280, rangeMin: 120,
      desc: 'Hurl your shield at the cursor. It strikes and stuns up to 4 foes as it ricochets between them, then flies back to your hand, striking again. Catching it shields you for 0.5% max health per foe struck (at most once per 6 s). In flight it swats enemy shots. Bosses take ×2 but are never stunned.',
      parts: [
        { id: 'strike', label: 'Strike', base: 20, pow: 1.3, per: 'hit', n: 4, proc: true, stun: 0.9, knock: 140, r: 14, pRad: true, bossMul: 2, note: 'bosses ×2, never stunned' },
        { id: 'return', label: 'Return', base: 10, pow: 0.65, per: 'hit', proc: true, knock: 80, r: 14, pRad: true },
        { id: 'orbit', label: 'Orbit', if: 'orbit', of: 'strike', mul: 'orbitMul', per: 'hit', durKey: 'orbit', durCd: 'bastion', oneMul: { bastion: 2 }, every: 0.75, r: 44, proc: true },
        { id: 'reflect', label: 'Returned shard', if: 'orbitReflect', of: 'strike', mul: 'orbitReflect', per: 'hit', range: 300, proc: true },
        { id: 'vortex', label: 'Vortex', if: 'tempest', of: 'strike', mul: 'vortexMul', per: 'hit', every: 0.25, durKey: 'vortexDur', r: 100, pull: 60, proc: true },
      ] },
    volley: { name: 'Volley', slot: 0, cd: 5, icon: 'arrows', aim: 'dir', moveIf: { volleyHop: { k: 'hop', dist: 70, dir: -1, t: 0.25, iframes: 0.25 } },
      desc: 'Loose a wide fan of piercing arrows toward the cursor.',
      parts: [
        { id: 'arrow', label: 'Arrow', base: 4, pow: 1.2, per: 'hit', n: 7, fan: 1.2, ringKey: 'thornburst', ringPierce: 2, pierce: 1, speed: 480, life: 0.8, pr: 5, knock: 60, proc: true, close: 110 },
        { id: 'wave', label: 'Waves 2 and 3', if: 'deathMark', of: 'arrow', mul: 'deathWave', per: 'hit', nOf: 'arrow', fan: 1.2, waves: 2, pr: 5, proc: true },
        { id: 'burst', label: 'Death burst', if: 'deathMark', of: 'arrow', mul: 'deathMark', per: 'hit', n: 4, nFix: true, proc: true },
        { id: 'caltrops', label: 'Caltrops', if: 'caltrops', of: 'arrow', mul: 'caltrops', per: 'sec', r: 50, rAddKey: 'thornR', dur: 2.5, durFix: true, noCrit: true, note: 'per second to every foe inside the patch the hop leaves' },
      ] },
    nova: { name: 'Flame Nova', slot: 0, cd: 7, icon: 'flame', aim: 'self',
      desc: 'Erupt in a ring of fire that burns everything nearby.',
      parts: [
        { id: 'blast', label: 'Blast', base: 22, pow: 2.5, per: 'hit', r: 105, knock: 200, el: 'class', proc: true },
        { id: 'burn', label: 'Burn', base: 12, pow: 2.4, per: 'status', status: 'burn', mulStat: 'supernova' },
        { id: 'ring', label: 'Ring of fire', if: 'novaRing', ifNot: 'phoenixMul', base: 8, pow: 1, per: 'sec', rOf: 'blast', rMul: 0.8, dur: 3, el: 'class' },
        { id: 'echo', label: 'Second eruption', if: 'novaEcho', ifNot: 'supernova', of: 'blast', mul: 'novaEcho', per: 'hit', delay: 0.6, rOf: 'blast', rMul: 1, el: 'class', proc: true },
        { id: 'wave', label: 'Supernova wave', if: 'supernova', of: 'blast', mul: 'novaEcho', per: 'hit', delay: 0.6, dur: 0.5, durFix: true, rOf: 'blast', rMul: 220 / 105, el: 'class', proc: true },
        { id: 'flare', label: 'Rebirth flare', if: 'mantleBurst', of: 'blast', mul: 'mantleBurst', per: 'hit', r: 90, knock: 220, el: 'class', proc: true },
        { id: 'phoenix', label: 'Phoenix ring', if: 'phoenixMul', of: 'ring', mul: 'phoenixMul', per: 'sec', rOf: 'blast', rMul: 70 / 105, durKey: 'phoenixDur', el: 'class' },
        { id: 'trail', label: 'Dash trail', if: 'phoenixMul', of: 'phoenix', mul: 'dashTrail', per: 'sec', rOf: 'blast', rMul: 24 / 105, dur: 2, durFix: true, el: 'class' },
      ] },
    step: { name: 'Shadowstep', slot: 0, cd: 4.5, icon: 'cloak', aim: 'move', range: 140, rangeMin: 40,
      desc: 'Blink toward the cursor, cutting through foes. Your next attacks are critical hits.',
      parts: [
        { id: 'slash', label: 'Slash', base: 12, pow: 2.2, per: 'hit', crit: true, proc: true, reach: 20, knock: 60 },
        { id: 'after', label: 'Afterimage', if: 'afterimage', ifNot: 'mirrorHall', base: 5, pow: 3, per: 'hit', r: 80, delay: 1.2, blind: 1, proc: false },
        { id: 'twin', label: 'Twin cut', if: 'stepTwin', of: 'slash', mul: 'stepTwin', per: 'hit', delay: 0.15, crit: true, proc: true },
        { id: 'blossom', label: 'Death Blossom cut', if: 'blossom', of: 'slash', mul: 'blossom', per: 'hit', nKey: 'blossomN', crit: true, proc: true, knock: 60 },
        { id: 'mirror', label: 'Mirror burst', if: 'mirrorHall', of: 'slash', mul: 'mirrorHall', per: 'hit', n: 3, nFix: true, r: 80, delay: 1.5, blind: 1.5, proc: false },
      ] },
    sanctuary: { name: 'Sanctuary', slot: 0, cd: 11, icon: 'sun', aim: 'ground', range: 200, aimIf: { aura: 'self' },
      desc: 'Consecrate the ground at the cursor: foes inside take Holy damage each second and allies inside take less damage. Heals the allies around you when cast.',
      parts: [
        { id: 'zone', label: 'Holy ground', base: 10, pow: 1.2, per: 'sec', r: 100, rAddKey: 'aegisR', dur: 3.5, capCd: 0.6, el: 'class' },
        { id: 'nova', label: 'Wrath nova', if: 'wrath', of: 'zone', mul: 'wrathNova', per: 'hit', rOf: 'zone', rMul: 1, knock: 120, el: 'class', proc: true },
        { id: 'pillar', label: 'Pillars of light', if: 'wrath', of: 'zone', mul: 'wrathPillar', mulFix: 0.5, per: 'tick', every: 0.5, dur: 3.5, capCd: 0.6, knock: 60, el: 'class', proc: true },
        { id: 'pulse', label: 'Aegis pulse', if: 'dawn', of: 'zone', mul: 'aegisMul', per: 'hit', rOf: 'zone', rMul: 1, dur: 3.5, capCd: 0.6, every: 2, oneEvery: true, stunKey: 'aegisStun', el: 'class', proc: false },
      ] },
    legion: { name: 'Raise Legion', slot: 0, cd: 12, icon: 'skull', aim: 'ground', range: 160, walk: true, prevR: 35,
      desc: 'Raise skeletal minions at the cursor for a time. Kills may also raise minions.',
      parts: [
        { id: 'minion', label: 'Minion strike', base: 6, pow: 0.6, per: 'minion', n: 3, dur: 12, every: 0.7 },
        { id: 'spikes', label: 'Bone spikes', if: 'boneSpikes', base: 5, pow: 0.8, per: 'hit', r: 60, el: 'class', proc: true },
        { id: 'field', label: 'Bone field', if: 'bloom', of: 'spikes', mul: 'bloomField', per: 'sec', r: 50, dur: 2, durFix: true, el: 'class' },
        { id: 'bomb', label: 'Bone bombs', if: 'bloom', of: 'spikes', mul: 'bloomBomb', per: 'hit', rOf: 'spikes', rMul: 1, knock: 120, el: 'class', proc: true },
      ] },
    // Second skill (skill2 binding): one per class, cooldown reduction applies like the first.
    rain: { name: 'Rain of Arrows', slot: 1, cd: 10, icon: 'rain', aim: 'ground', range: 260,
      desc: 'Mark a point at the cursor. After a moment arrows fall on it, hitting every foe inside.',
      parts: [
        { id: 'tick', label: 'Arrows', ifNot: 'skyfall', base: 4, pow: 0.45, per: 'tick', every: 0.25, dur: 2, durMulKey: 'thornstorm', delay: 0.35, r: 80, proc: true },
        { id: 'sky', label: 'Skyfall', if: 'skyfall', ifNot: 'starfall', of: 'tick', times: 'ticks', per: 'hit', delay: 0.5, rOf: 'tick', rMul: 1.3, stun: 0.5, proc: true },
        { id: 'sky2', label: 'Twin Sky', if: 'skyTwin', ifNot: 'starfall', of: 'sky', mul: 'skyTwin', per: 'hit', delay: 0.8, rOf: 'sky', rMul: 1, proc: true },
        { id: 'star', label: 'Starfall', if: 'starfall', of: 'sky', mul: 'starfall', per: 'hit', n: 5, nFix: true, every: 0.12, r: 70, delay: 0.35, stun: 0.4, ref: 160, proc: true },
        { id: 'shower', label: 'Second Shower', if: 'shower', of: 'tick', mul: 'shower', per: 'tick', every: 0.25, dur: 2, durFix: true, rOf: 'tick', rMul: 1, proc: true },
        { id: 'bramble', label: 'Bramble patches', if: 'thornstorm', per: 'zone', r: 40, dur: 3, durFix: true, slow: 0.3 },
      ] },
    meteor: { name: 'Meteor', slot: 1, cd: 12, icon: 'meteor', aim: 'ground', range: 300, moveIf: { comet: { k: 'leap', t: 0.6, iframes: 0.35 }, sunDive: { k: 'leap', t: 0.6, iframes: 0.6 } },
      desc: 'Call a meteor down on the cursor. It knocks foes back, burns them and leaves a burning crater.',
      parts: [
        { id: 'impact', label: 'Impact', ifNot: 'cataclysm', base: 30, pow: 3.5, per: 'hit', r: 95, delay: 0.9, knock: 220, el: 'class', statusAdd: { burn: 0.5 }, proc: true },
        { id: 'storm', label: 'Cataclysm meteors', if: 'cataclysm', of: 'impact', mul: 'cataclysm', per: 'hit', n: 5, nFix: true, rOf: 'impact', rMul: 1, delay: 0.9, knock: 220, el: 'class', statusAdd: { burn: 0.5 }, proc: true },
        { id: 'crater', label: 'Crater', ifNot: 'cataclysm', base: 8, pow: 0.8, per: 'sec', r: 60, dur: 3, el: 'class', mulStat: 'craterMul' },
        { id: 'field', label: 'Lava field', if: 'cataclysm', of: 'crater', per: 'sec', r: 140, dur: 3, el: 'class' },
        { id: 'twin', label: 'Twin Meteor', if: 'twinMeteor', ifNot: 'cataclysm', of: 'impact', mul: 'twinMeteor', per: 'hit', r: 95, delay: 0.6, el: 'class', proc: true },
        { id: 'rocks', label: 'Meteorites', if: 'meteorites', ifNot: 'cataclysm', of: 'impact', mul: 'meteorites', per: 'hit', n: 3, r: 45, delay: 0.3, el: 'class', proc: true },
        { id: 'trail', label: 'Burning trail', if: 'sunDive', of: 'crater', mul: 'diveTrail', per: 'sec', r: 30, dur: 2, durFix: true, el: 'class' },
      ] },
    vanish: { name: 'Vanish', slot: 1, cd: 11, icon: 'vanish', aim: 'self',
      desc: 'Drop smoke that slows and blinds foes. You vanish from their sight; your next attack is an Ambush, a guaranteed critical hit.',
      parts: [
        { id: 'ambush', label: 'Ambush', pow: 2.5, powKey: 'ambushMul', on: 'B', per: 'hit', crit: true, proc: true },
        { id: 'smoke', label: 'Smoke', ifNot: 'eclipse', per: 'zone', r: 75, dur: 3, slow: 0.4 },
        { id: 'choke', label: 'Choking smoke', if: 'shroudDmg', ifNot: 'eclipse', of: 'ambush', mul: 'shroudDmg', per: 'sec', rOf: 'smoke', rMul: 1, dur: 3, noCrit: true, note: 'per second to every foe in the smoke' },
        { id: 'blind', label: 'Smoke blind', per: 'zone', dur: 2, durKey: 'veilBlind', durMulKey: 'umbral', capCd: 0.5 },
        { id: 'dome', label: 'Eclipse dome', if: 'eclipse', per: 'zone', r: 100, durKey: 'eclipseDur', slow: 0.4 },
        { id: 'edge', label: 'Eclipse attacks', if: 'eclipse', of: 'ambush', mul: 'eclipse', per: 'hit', crit: true, proc: true, durKey: 'eclipseDur', perAtk: 'skip' },
        { id: 'clone', label: 'Clone attacks', if: 'umbral', pow: 0, powKey: 'cloneMul', on: 'W', per: 'hit', proc: true, dur: 4, durFix: true, perAtk: true },
      ] },
    judgment: { name: 'Judgment', slot: 1, cd: 9, icon: 'hammer', aim: 'dir',
      desc: 'Throw a hammer toward the cursor that flies out and returns, piercing. Each leg hits a foe once and Judges it (+20% damage taken). Judgment falls hardest on the mighty: bosses take ×2 from the hammer.',
      parts: [
        { id: 'leg', label: 'Hammer', base: 18, pow: 1.4, per: 'hit', r: 18, el: 'class', mulFirst: ['stormMul', 'twinHammer'], bossMul: 2, proc: true },
        { id: 'verdict', label: 'Verdict', if: 'verdict', mulStat: 'verdict', base: 20, pow: 3, per: 'hit', r: 70, rAddKey: 'fjR', el: 'class', stun: 0.4, stunKey: 'fjStun', proc: true },
        { id: 'echo', label: 'Echo', if: 'fjEcho', per: 'zone' },
      ] },
    harvest: { name: 'Bone Harvest', slot: 1, cd: 10, icon: 'harvest', aim: 'self',
      desc: 'Each of your minions explodes and heals you; then raise new minions.',
      parts: [
        { id: 'burst', label: 'Burst', base: 24, pow: 1.8, per: 'hit', r: 60, el: 'class', proc: true },
        { id: 'corpse', label: 'Corpse burst', if: 'corpse', of: 'burst', mul: 'corpseMul', per: 'hit', rOf: 'burst', rMul: 1, el: 'class', proc: true },
        { id: 'lance', label: 'Bone lance', if: 'boneLance', of: 'burst', mul1: 'boneLance', per: 'hit', rOf: 'burst', rMul: 1, el: 'class', proc: true },
        { id: 'shard', label: 'Bone shards', if: 'carrionN', of: 'burst', mul: 'carrionShard', per: 'hit', knock: 60, proc: true },
      ] },
  };

  // Sheet data of skill parts, merged into the parts above: ED.Stats.skillNums turns it into q.oneFoe (hits on one foe per cast), q.selfVuln (the vulnerability the part sets before its own hit), q.raw and q.noCrit.
  // perMinion ('live': one hit per minion you have, 'cast': one per minion the cast raises; the sheet counts them), infAdd { element: rate } (a status the part builds without the path's gate), radiance (share of a zone tick stored as Radiance), oneFoe n (times oneMul[stat] when set), oneEvery (floor(dur / every): a hit per interval), selfVuln n | { v, if: stat }, noCrit (its hits never crit), note (what the sheet adds to the part), heal { key (ED.CONST) | perMinion, cap, note } (heals the caster on cast).
  ED.SKILL_SHEET = {
    'charge.shock': { noCrit: true, note: 'at the end of the run' },
    'charge.bash': { note: 'a free Shield Throw along the run' },
    'charge.quake': { noCrit: true, note: 'bosses ×1.5, never stunned; at the end of the run' },
    'charge.crack': { noCrit: true, note: '3 cracks run outward from the slam; a foe is struck by one' },
    'shieldthrow.orbit': { oneEvery: true },
    'shieldthrow.reflect': { oneFoe: 0, note: 'per enemy shot the orbit destroys' },
    'shieldthrow.vortex': { oneEvery: true, note: 'pulls foes in; every foe inside is struck 4 times a second' },
    'volley.burst': { oneFoe: 0, note: 'when a marked foe dies: 4 piercing arrows' },
    'rain.star': { note: '5 impacts walk from you to the cursor' },
    'legion.spikes': { perMinion: 'cast', infAdd: { shadow: 0.5 }, note: 'one burst per minion when it expires' },
    'sanctuary.zone': { heal: { key: 'SANCT_HEAL', note: 'you and allies within 180 heal on cast' }, radiance: 0.25 },
    'harvest.burst': { perMinion: 'live', infAdd: { shadow: 0.5 }, note: 'one burst per minion you have', heal: { perMinion: 0.03, cap: 0.06, note: 'you heal on cast' } },
    'harvest.corpse': { oneFoe: 0, note: 'per corpse that explodes on the foe' },
    'meteor.rocks': { oneFoe: 0, note: 'each meteorite lands at random within 80' },
    'meteor.impact': { oneFoe: 1, oneMul: { sunDive: 2 } },
    'meteor.storm': { oneFoe: 5, note: 'a foe at the cursor is struck by all five' },
    'meteor.trail': { oneFoe: 2 },
    'nova.trail': { oneFoe: 0, note: 'per dash: a patch every 20 px of the dash' },
    'step.blossom': { oneFoe: 0, note: 'per further foe the chain reaches' },
    'step.mirror': { oneFoe: 3, note: 'a foe between the three images is struck by each burst' },
    'vanish.edge': { note: 'each attack after the first while you stand inside', selfVuln: 0.2 },
    'vanish.clone': { note: 'the clone repeats each of your attacks' },
    'rain.tick': { selfVuln: { v: 0.2, if: 'rainHail' } },
    'rain.shower': { selfVuln: { v: 0.2, if: 'rainHail' } },
    'judgment.leg': { oneFoe: 2, oneMul: { twinHammer: 2 }, selfVuln: 0.2, infAdd: { holy: 0.5 }, note: 'out and back, bosses ×2; the second flight of Second Flight adds its two legs at secondFlight of a hit' },
    'judgment.verdict': { oneFoe: 0, infAdd: { holy: 0.5 }, note: 'when a Judged foe dies' },
    'judgment.echo': { note: 'damage a Judged foe takes from you echoes to every other Judged foe within 200 (a chain, no on-hit effects)' },
    'sanctuary.nova': { noCrit: true, infAdd: { holy: 0.5 }, note: 'when Sanctuary opens, every foe inside' },
    'sanctuary.pillar': { noCrit: true, infAdd: { holy: 0.5 }, note: 'a random foe inside, every 0.5 s' },
    'sanctuary.pulse': { noCrit: true, note: 'every 2 s after the cast, every foe inside; it also stuns (never bosses)' },
    'legion.field': { perMinion: 'cast', note: 'a field under every burst: 2 s, hits every 0.5 s' },
    'legion.bomb': { oneFoe: 2, infAdd: { shadow: 0.5 }, note: 'two bombs run at the nearest foe' },
    'harvest.shard': { oneFoe: 0, infAdd: { shadow: 0.5 }, note: '3 shards per corpse that explodes, at the nearest foes' },
    'vanish.ambush': { note: 'your next attack', selfVuln: { v: 0.2, if: 'eclipse' } },
  };
  for (const key in ED.SKILL_SHEET) {
    const [sid, pid] = key.split('.'), sk = ED.SKILLS[sid], part = sk && sk.parts.find(x => x.id === pid);
    if (part) Object.assign(part, ED.SKILL_SHEET[key]);
  }

  ED.weaponUnlocked = (cls, idx, masteryLevel) => idx === 0 || (idx === 1 && masteryLevel >= 3) || (idx === 2 && masteryLevel >= 6);

  // ---------------- fork weapons (Heavy / Swift attack forks) ----------------
  // Constants (ED.CONST, read at call time): ATK_FLOOR 0.12 s and ATK_FLOOR_SHOT 0.06 s per shot bound a weapon's attack interval (stats.js); a Heavy interval stops at 1.3 s.
  ED.FORK_NAMES = {
    'longsword@heavy': 'Greatsword', 'longsword@swift': 'Saber', 'warhammer@heavy': 'Maul', 'warhammer@swift': 'War Pick', 'glaive@heavy': 'Halberd', 'glaive@swift': 'Spear',
    'longbow@heavy': 'Greatbow', 'longbow@swift': 'Hunting Bow', 'crossbow@heavy': 'Arbalest', 'crossbow@swift': 'Repeater', 'twinbows@heavy': 'Twin Recurves', 'twinbows@swift': 'Twin Flatbows',
    'firestaff@heavy': 'Magma Staff', 'firestaff@swift': 'Spark Staff', 'emberwand@heavy': 'Cinder Rod', 'emberwand@swift': 'Flicker Wand', 'inferno@heavy': 'Tome of Ruin', 'inferno@swift': 'Pocket Grimoire',
    'daggers@heavy': 'Twin Kukris', 'daggers@swift': 'Stilettos', 'knives@heavy': 'Chakrams', 'knives@swift': 'Darts', 'scythes@heavy': 'Great Scythes', 'scythes@swift': 'Sickles',
    'mace@heavy': 'Morning Star', 'mace@swift': 'Flail', 'dawnhammer@heavy': 'Sunforged Maul', 'dawnhammer@swift': 'Dawn Pick', 'lantern@heavy': 'Great Lantern', 'lantern@swift': 'Censer',
    'bonewand@heavy': 'Skull Staff', 'bonewand@swift': 'Finger Wand', 'soulscythe@heavy': 'Death Scythe', 'soulscythe@swift': 'Soul Sickle', 'plaguestaff@heavy': 'Plague Totem', 'plaguestaff@swift': 'Plague Rod',
  };
  // Look of each fork for the sprite baker: art = ED.ART anim id (a pack sprite, or the base weapon's art for an overlay look), op = silhouette overlay H (head x1.4, studs, brass band; thicker shafts) or S (head x0.6, wrapped grip, thinner shafts), tint, len = sprite length factor, dup = drawn twice.
  const LOOK = (art, op, len, extra) => Object.assign({ art, op, len }, extra);
  ED.FORK_LOOKS = {
    'longsword@heavy': LOOK('weapon.alt.anime_sword', 'H', 1.15), 'longsword@swift': LOOK('weapon.alt.katana', 'S', 0.9),
    'warhammer@heavy': LOOK('weapon.alt.big_hammer', 'H', 1.15, { tint: '#9aa3ad' }), 'warhammer@swift': LOOK('weapon.alt.throwing_axe', 'S', 0.9, { tint: '#9aa3ad' }),
    'glaive@heavy': LOOK('weapon.glaive', 'H', 1.15, { head: 'weapon.alt.waraxe' }), 'glaive@swift': LOOK('weapon.glaive', 'S', 0.9),
    'longbow@heavy': LOOK('weapon.longbow', 'H', 1.15), 'longbow@swift': LOOK('weapon.longbow', 'S', 0.9),
    'crossbow@heavy': LOOK('weapon.crossbow', 'H', 1.15, { tint: '#9aa3ad' }), 'crossbow@swift': LOOK('weapon.crossbow', 'S', 0.9, { magazine: true }),
    'twinbows@heavy': LOOK('weapon.twinbows', 'H', 1.15, { dup: 2 }), 'twinbows@swift': LOOK('weapon.twinbows', 'S', 0.9, { dup: 2 }),
    'firestaff@heavy': LOOK('weapon.firestaff', 'H', 1.15, { gem: '#ff8a2a' }), 'firestaff@swift': LOOK('weapon.firestaff', 'S', 0.9),
    'emberwand@heavy': LOOK('weapon.emberwand', 'H', 1.15), 'emberwand@swift': LOOK('weapon.emberwand', 'S', 0.9),
    'inferno@heavy': LOOK('weapon.inferno', 'H', 1.25, { clasp: true }), 'inferno@swift': LOOK('weapon.inferno', 'S', 0.75, { ribbon: true }),
    'daggers@heavy': LOOK('weapon.alt.machete', 'H', 1.15, { dup: 2 }), 'daggers@swift': LOOK('weapon.daggers', 'S', 0.9, { dup: 2 }),
    'knives@heavy': LOOK('weapon.knives', 'H', 1.15), 'knives@swift': LOOK('weapon.knives', 'S', 0.9),
    'scythes@heavy': LOOK('weapon.scythes', 'H', 1.15, { dup: 2 }), 'scythes@swift': LOOK('weapon.scythes', 'S', 0.9, { dup: 2 }),
    'mace@heavy': LOOK('weapon.mace', 'H', 1.15, { tint: '#d4b24a', spikes: true }), 'mace@swift': LOOK('weapon.mace', 'S', 0.9, { chain: true }),
    'dawnhammer@heavy': LOOK('weapon.alt.big_hammer', 'H', 1.15, { tint: '#d4b24a' }), 'dawnhammer@swift': LOOK('weapon.alt.throwing_axe', 'S', 0.9, { tint: '#d4b24a' }),
    'lantern@heavy': LOOK('weapon.lantern', 'H', 1.15, { cage: true }), 'lantern@swift': LOOK('weapon.lantern', 'S', 0.9, { chain: true }),
    'bonewand@heavy': LOOK('weapon.bonewand', 'H', 1.15, { skull: true }), 'bonewand@swift': LOOK('weapon.bonewand', 'S', 0.9),
    'soulscythe@heavy': LOOK('weapon.soulscythe', 'H', 1.15, { dup: 1, tint: '#4fd8c0' }), 'soulscythe@swift': LOOK('weapon.soulscythe', 'S', 0.9, { tint: '#4fd8c0' }),
    'plaguestaff@heavy': LOOK('weapon.plaguestaff', 'H', 1.15, { tint: '#7fbf3a' }), 'plaguestaff@swift': LOOK('weapon.plaguestaff', 'S', 0.9, { tint: '#7fbf3a' }),
  };

  const forkMemo = new Map();
  // The Heavy / Swift version of weapon baseId for a fork card (id or card object), derived from the base so it follows any re-tune of the base; pure and memoized.
  // Nominal damage per second is 1.1x the base: dmg scales with the interval change; Heavy is bigger and harder-hitting, Swift is quicker with less reach and knockback.
  ED.forkWeapon = (baseId, card) => {
    const cid = typeof card === 'string' ? card : card && card.id, key = baseId + '|' + cid;
    let out = forkMemo.get(key);
    if (out) return out;
    const b = ED.WEAPONS[baseId], cd = typeof card === 'string' ? ED.BOONS[card] : card, kind = cd && cd.weapon && cd.weapon.kind;
    if (!b || (kind !== 'heavy' && kind !== 'swift')) return b;
    const C = ED.CONST, heavy = kind === 'heavy', shots = b.kind === 'proj' ? b.n : 1, floor = Math.max(C.ATK_FLOOR, C.ATK_FLOOR_SHOT * shots);
    const rate = heavy ? Math.min(1.3, b.rate * 1.8) : Math.max(floor, b.rate * 0.55), k = rate / b.rate;
    const w = Object.assign({}, b), r2 = (v) => Math.round(v * 1000) / 1000;
    w.rate = rate; w.dmg = b.dmg * 1.1 * k; w.fork = kind; w.base = baseId;
    w.name = ED.FORK_NAMES[baseId + '@' + kind] || b.name;
    if (b.kind === 'melee') {
      if (heavy) { w.range = b.range * 1.1; w.arc = Math.min(6.3, b.arc * 1.1); w.knock = Math.min(320, b.knock * 1.3); } else w.knock = b.knock * 0.5;
      if (b.shock) w.shock = { r: b.shock.r * (heavy ? 1.15 : 1), mul: b.shock.mul };
    } else {
      if (heavy) { w.r = b.r * 1.2; w.speed = b.speed * 0.9; w.life = b.life * 1.1; w.knock = Math.max(80, (b.knock || 40) * 2); }
      else { w.speed = b.speed * 1.2; w.life = b.life * 0.85; w.knock = (b.knock || 40) * 0.5; if (b.spread) w.spread = b.spread * 0.85; }
      if (b.explode) w.explode = { r: b.explode.r * (heavy ? 1.15 : 1), mul: b.explode.mul };
      if (b.cloud) w.cloud = { r: b.cloud.r * (heavy ? 1.15 : 1), dps: b.cloud.dps * 1.1 * k, dur: b.cloud.dur };
    }
    for (const f of ['dmg', 'rate', 'range', 'arc', 'knock', 'r', 'speed', 'life', 'spread']) if (typeof w[f] === 'number') w[f] = r2(w[f]);
    forkMemo.set(key, w);
    return w;
  };
})(globalThis.ED || (globalThis.ED = {}));
