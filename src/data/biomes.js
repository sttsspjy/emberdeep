// The six strata of the Deep. Each one changes palette, lighting, decor, ambient particles, music,
// hazards and enemy roster so players always see where they are in the descent.
(function (ED) {
  'use strict';
  ED.BIOMES = [
    {
      id: 'ossuary', name: 'The Ossuary', short: 'Ossuary',
      weak: 'pyre', resist: 'storm', // elemental affinity of every foe in this stratum
      blurb: 'Bone-lined halls where the first delvers were laid to rest. They do not rest well.',
      pal: {
        void: '#090a09', floorA: '#3d3f38', floorB: '#36382f', grout: '#24261f', wallTop: '#62655a', wallFace: '#383a31',
        wallShadow: '#1a1b16', accent: '#86a35b', accent2: '#c9c1a6', light: '#ffad5a', darkness: 0.5, darkColor: '#060708',
        chasm: '#020202', hazard: '#6d6a5e', hazardGlow: '#b8b2a0', ui: '#c9b98f',
      },
      decor: ['bones', 'skull', 'moss', 'crack', 'candle', 'urn'],
      particle: { kind: 'dust', color: '#d9cfb4', rate: 6 },
      hazard: 'spikes',
      enemies: [['skeleton', 4], ['bat', 3], ['bonearcher', 2], ['slime', 2], ['priest', 1]],
      elite: 'skelknight',
      boss: 'bonewarden',
      music: { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 66, pad: 'triangle', lead: 'sine' },
    },
    {
      id: 'glowmire', name: 'Glowmire Grotto', short: 'Glowmire',
      weak: 'storm', resist: 'pyre', // elemental affinity of every foe in this stratum
      blurb: 'A drowned cave swallowed by luminous fungus. The light is pretty. The spores are not.',
      pal: {
        void: '#06050b', floorA: '#2d2a3a', floorB: '#272436', grout: '#1a1926', wallTop: '#4a4262', wallFace: '#2b2643',
        wallShadow: '#130f22', accent: '#4ff0c8', accent2: '#c86bff', light: '#7dffd9', darkness: 0.56, darkColor: '#04030a',
        chasm: '#010104', hazard: '#4c7a3a', hazardGlow: '#9cff6a', ui: '#7de8cf',
      },
      decor: ['mushroom', 'mushroom', 'root', 'puddle', 'crack', 'glowcap'],
      particle: { kind: 'spore', color: '#7dffd9', color2: '#d38bff', rate: 9 },
      hazard: 'poison',
      enemies: [['myconid', 3], ['sporepuff', 3], ['spitter', 2], ['cavespider', 3], ['glowslime', 2], ['mireworm', 2]],
      elite: 'shroomhulk',
      boss: 'sporemother',
      music: { root: 50, scale: [0, 3, 5, 7, 10], bpm: 72, pad: 'sine', lead: 'triangle' },
    },
    {
      id: 'rimefrost', name: 'Rimefrost Halls', short: 'Rimefrost',
      weak: 'pyre', resist: 'rime', // elemental affinity of every foe in this stratum
      blurb: 'A dwarven palace frozen in a single night. Every statue was once a guard.',
      pal: {
        void: '#0b111a', floorA: '#9fb8cc', floorB: '#94aec4', grout: '#7690a8', wallTop: '#e2f0fb', wallFace: '#7896b2',
        wallShadow: '#45607a', accent: '#7fe3ff', accent2: '#ffffff', light: '#cdeeff', darkness: 0.28, darkColor: '#0a1524',
        chasm: '#0a1420', hazard: '#d8f2ff', hazardGlow: '#ffffff', ui: '#b9e6ff',
      },
      decor: ['crystal', 'crystal', 'snow', 'frozenbones', 'crack', 'pillarstub'],
      particle: { kind: 'snow', color: '#ffffff', rate: 14 },
      hazard: 'ice',
      enemies: [['icewolf', 3], ['frostwisp', 3], ['rimemage', 2], ['frozenskel', 3], ['icegolem', 1], ['sentinel', 1]],
      elite: 'frostknight',
      boss: 'rimeheart',
      music: { root: 52, scale: [0, 2, 4, 7, 9], bpm: 60, pad: 'sine', lead: 'sine' },
    },
    {
      id: 'cinderforge', name: 'The Cinderforge', short: 'Cinderforge',
      weak: 'rime', resist: 'pyre', // elemental affinity of every foe in this stratum
      blurb: 'The furnace-heart of a fallen empire. Its machines still work. Its masters are gone.',
      pal: {
        void: '#0c0504', floorA: '#30231f', floorB: '#2a1e1a', grout: '#170f0c', wallTop: '#53392f', wallFace: '#2e1c17',
        wallShadow: '#140907', accent: '#ff6a2a', accent2: '#ffd36b', light: '#ff9a4a', darkness: 0.44, darkColor: '#0a0302',
        chasm: '#1a0500', hazard: '#ff5a1a', hazardGlow: '#ffc04a', ui: '#ffab70',
      },
      decor: ['lavacrack', 'lavacrack', 'chain', 'anvil', 'grate', 'cinders'],
      particle: { kind: 'ember', color: '#ff9a3a', color2: '#ffd36b', rate: 12 },
      hazard: 'lava',
      enemies: [['imp', 3], ['lavahound', 3], ['automaton', 1], ['flameturret', 2], ['cinderbat', 3], ['drone', 2]],
      elite: 'forgeknight',
      boss: 'forgelord',
      music: { root: 43, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 84, pad: 'sawtooth', lead: 'square' },
    },
    {
      id: 'sanctum', name: 'Drowned Sanctum', short: 'Sanctum',
      weak: 'storm', resist: 'rime', // elemental affinity of every foe in this stratum
      blurb: 'A golden temple the sea reclaimed. Its priests kept praying underwater.',
      pal: {
        void: '#020a0d', floorA: '#214047', floorB: '#1c3940', grout: '#10252a', wallTop: '#3f7173', wallFace: '#1f4549',
        wallShadow: '#0a2125', accent: '#e8c66b', accent2: '#5ff2e0', light: '#a5f9ff', darkness: 0.45, darkColor: '#01080b',
        chasm: '#000c12', hazard: '#1b6b84', hazardGlow: '#6fe6ff', ui: '#8fe8e0',
      },
      decor: ['coral', 'seaweed', 'goldtile', 'puddle', 'shell', 'crack'],
      particle: { kind: 'bubble', color: '#bff8ff', rate: 8 },
      hazard: 'water',
      enemies: [['drowned', 3], ['eel', 3], ['siren', 2], ['crab', 2], ['jelly', 2], ['reaver', 2]],
      elite: 'tidecaller',
      boss: 'drownedking',
      music: { root: 48, scale: [0, 2, 3, 7, 8], bpm: 64, pad: 'sine', lead: 'triangle' },
    },
    {
      id: 'abyss', name: 'The Starless Abyss', short: 'Abyss',
      weak: 'rime', resist: 'storm', // elemental affinity of every foe in this stratum
      blurb: 'Below the world there is a sky with no stars. Something wears a hollow crown there.',
      pal: {
        void: '#030107', floorA: '#1f1933', floorB: '#1a152b', grout: '#0f0b1d', wallTop: '#3d3060', wallFace: '#21183c',
        wallShadow: '#0d081d', accent: '#b78cff', accent2: '#ff7ad9', light: '#d4bfff', darkness: 0.6, darkColor: '#020106',
        chasm: '#000000', hazard: '#5a2a9a', hazardGlow: '#d48cff', ui: '#cdb3ff',
      },
      decor: ['voidcrack', 'rune', 'shard', 'starfield', 'crack', 'rune'],
      particle: { kind: 'mote', color: '#d4bfff', color2: '#ff9be6', rate: 10 },
      hazard: 'void',
      enemies: [['shade', 3], ['starspawn', 3], ['voideye', 2], ['voidwraith', 2], ['horror', 1], ['riftcaller', 1]],
      elite: 'voidknight',
      boss: 'hollowking',
      music: { root: 41, scale: [0, 1, 3, 6, 7, 10], bpm: 58, pad: 'sawtooth', lead: 'sine' },
    },
  ];

  // Ascension tints: the deeper the pact, the redder the world.
  ED.biomeFor = (stratum) => ED.BIOMES[Math.max(0, Math.min(ED.BIOMES.length - 1, stratum - 1))];
})(globalThis.ED || (globalThis.ED = {}));
