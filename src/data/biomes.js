// The four strata of the Deep (IV is the finale). Each one sets palette, lighting, decor, ambient particles, hazard and foe roster; no stratum favours or resists an element.
(function (ED) {
  'use strict';
  ED.BIOMES = [
    {
      id: 'ossuary', name: 'The Ossuary', short: 'Ossuary',
      blurb: 'Stratum I. Skeletons, bats and bone archers. Spike traps hurt when you stand on them.',
      pal: {
        void: '#090a09', floorA: '#3d3f38', floorB: '#36382f', grout: '#24261f', wallTop: '#62655a', wallFace: '#383a31',
        wallShadow: '#1a1b16', accent: '#86a35b', accent2: '#c9c1a6', light: '#ffad5a', darkness: 0.5, darkColor: '#060708',
        chasm: '#020202', hazard: '#6d6a5e', hazardGlow: '#b8b2a0', ui: '#c9b98f',
      },
      decor: ['bones', 'skull', 'moss', 'crack', 'candle', 'urn'],
      breakable: ['urn'], // decor kinds that stand as smashable props (room.breakables) instead of baked floor decor
      particle: { kind: 'dust', color: '#d9cfb4', rate: 6 },
      hazard: 'spikes',
      enemies: [['skeleton', 4], ['bat', 3], ['bonearcher', 2], ['slime', 2], ['priest', 1], ['icewolf', 1]],
      elite: 'skelknight',
      boss: 'bonewarden',
      fodder: 'bonemite', // horde filler of combat and elite rooms (never in `enemies`)
    },
    {
      id: 'glowmire', name: 'Glowmire Grotto', short: 'Glowmire',
      blurb: 'Stratum II. Fungus foes, spitting turrets and burrowing worms. Bog pools slow you and hurt a little.',
      pal: {
        void: '#06050b', floorA: '#2d2a3a', floorB: '#272436', grout: '#1a1926', wallTop: '#4a4262', wallFace: '#2b2643',
        wallShadow: '#130f22', accent: '#4ff0c8', accent2: '#c86bff', light: '#7dffd9', darkness: 0.56, darkColor: '#04030a',
        chasm: '#010104', hazard: '#4a4232', hazardGlow: '#7d6f4f', ui: '#7de8cf',
      },
      decor: ['mushroom', 'mushroom', 'root', 'puddle', 'crack', 'glowcap'],
      breakable: ['mushroom'],
      particle: { kind: 'spore', color: '#7dffd9', color2: '#d38bff', rate: 9 },
      hazard: 'poison', // drawn as a bog: slows and hurts (world.js), no glow
      enemies: [['myconid', 3], ['sporepuff', 3], ['spitter', 2], ['cavespider', 3], ['glowslime', 2], ['mireworm', 2], ['frostwisp', 2]],
      elite: 'shroomhulk',
      boss: 'sporemother',
      fodder: 'sporeling',
    },
    {
      id: 'sanctum', name: 'Drowned Sanctum', short: 'Sanctum',
      blurb: 'Stratum III. Leaping reavers, casters and temple drones that circle and shoot. Water slows you.',
      pal: {
        void: '#020a0d', floorA: '#214047', floorB: '#1c3940', grout: '#10252a', wallTop: '#3f7173', wallFace: '#1f4549',
        wallShadow: '#0a2125', accent: '#e8c66b', accent2: '#5ff2e0', light: '#a5f9ff', darkness: 0.45, darkColor: '#01080b',
        chasm: '#000c12', hazard: '#1b6b84', hazardGlow: '#6fe6ff', ui: '#8fe8e0',
      },
      decor: ['coral', 'seaweed', 'goldtile', 'puddle', 'shell', 'crack'],
      breakable: ['coral'],
      particle: { kind: 'bubble', color: '#bff8ff', rate: 8 },
      hazard: 'water',
      enemies: [['drowned', 3], ['eel', 3], ['siren', 2], ['crab', 2], ['jelly', 2], ['reaver', 2], ['drone', 2]],
      elite: 'tidecaller',
      boss: 'drownedking',
      fodder: 'brinepolyp',
    },
    {
      id: 'abyss', name: 'The Starless Abyss', short: 'Abyss',
      blurb: 'Stratum IV, the last. Two champion rooms, then the final boss. Void pools hurt.',
      pal: {
        void: '#030107', floorA: '#1f1933', floorB: '#1a152b', grout: '#0f0b1d', wallTop: '#3d3060', wallFace: '#21183c',
        wallShadow: '#0d081d', accent: '#b78cff', accent2: '#ff7ad9', light: '#d4bfff', darkness: 0.6, darkColor: '#020106',
        chasm: '#000000', hazard: '#5a2a9a', hazardGlow: '#d48cff', ui: '#cdb3ff',
      },
      decor: ['voidcrack', 'rune', 'shard', 'starfield', 'crack', 'rune'],
      breakable: ['shard'],
      particle: { kind: 'mote', color: '#d4bfff', color2: '#ff9be6', rate: 10 },
      hazard: 'void',
      enemies: [['shade', 3], ['starspawn', 3], ['voideye', 2], ['voidwraith', 2], ['horror', 1], ['riftcaller', 1], ['sentinel', 1]],
      elite: 'voidknight',
      boss: 'hollowking',
      fodder: 'voidmote',
    },
  ];

  ED.biomeFor = (stratum) => ED.BIOMES[Math.max(0, Math.min(ED.BIOMES.length - 1, stratum - 1))];
})(globalThis.ED || (globalThis.ED = {}));
