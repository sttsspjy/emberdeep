// Cosmetics (GAME-DESIGN §11): Wardrobe items bought with gold or granted by an achievement (ED.ACHIEVEMENTS reward). Looks only; the sim never reads them.
// ED.COSMETICS in save order (append only; the save code stores owned / worn as bit lists over ED.COS_IDS): { id, kind, name, price (gold; 0 = achievement reward only), ... }.
//   skin:  hero (cls), map { '#src': '#dst' } over the hero's palette (ED.ART.pal['hero.<cls>.*']), recoloured at runtime from the atlas.
//   tint:  ramp [5 colours dark -> light]: the own hero's weapon effects (primitives, atlas sprites, particles) are remapped onto it by luminance.
//   kill:  style (client fx id) for foe deaths drawn on the wearer's screen; lvl: style for the level-up burst on the wearer's hero.
//   title: shown above the name tag and in the lobby; ncol: name colour col ('#rrggbb'; cols = a cycle of colours).
// ED.COS_KINDS: the worn slots; skin is worn per hero, every other kind once.
(function (ED) {
  'use strict';
  const K = (id, kind, name, price, o) => Object.assign({ id, kind, name, price }, o);
  const skin = (cls, key, name, price, map) => K('skin.' + cls + '.' + key, 'skin', name, price, { hero: cls, map });
  ED.COSMETICS = [
    // hero skins: two for gold, the third from the hero's Victor achievement
    skin('knight', 'verdigris', 'Verdigris', 500, { '#5d6670': '#24503f', '#c3ccd6': '#5aa88a', '#fdf7ed': '#c4ffee', '#da4e38': '#c8901c', '#ee8e2e': '#ffd860' }),
    skin('knight', 'obsidian', 'Obsidian', 1200, { '#5d6670': '#1c1828', '#c3ccd6': '#48425e', '#fdf7ed': '#8a80b0', '#da4e38': '#9a1228', '#ee8e2e': '#e2403a' }),
    skin('knight', 'gilded', 'Gilded', 0, { '#5d6670': '#8a5a1c', '#c3ccd6': '#e8b43a', '#fdf7ed': '#fff0b0', '#da4e38': '#2c4aa8', '#ee8e2e': '#6a9cff' }),
    skin('ranger', 'autumn', 'Autumn', 500, { '#3d734f': '#6a2c10', '#4ba747': '#c2601c', '#da4e38': '#7a3418', '#ee8e2e': '#a8521e', '#facb3e': '#d88a3a' }),
    skin('ranger', 'nightshade', 'Nightshade', 1200, { '#3d734f': '#2c1c48', '#4ba747': '#62409a', '#da4e38': '#242030', '#ee8e2e': '#3a3448', '#facb3e': '#585070', '#5698cc': '#c050ff' }),
    skin('ranger', 'frost', 'Frost', 0, { '#3d734f': '#22406e', '#4ba747': '#4a8ad0', '#da4e38': '#7a8cb0', '#ee8e2e': '#b4c4e0', '#facb3e': '#eef4ff', '#5698cc': '#7fe3ff' }),
    skin('pyro', 'ashen', 'Ashen', 500, { '#7a1f12': '#26262e', '#d8442a': '#58586a', '#8a503e': '#4a4a58' }),
    skin('pyro', 'emerald', 'Emerald', 1200, { '#7a1f12': '#123a1a', '#d8442a': '#2e9a3c', '#8a503e': '#2a5a2c' }),
    skin('pyro', 'azure', 'Azure Flame', 0, { '#7a1f12': '#1a2c5c', '#d8442a': '#3a7ad8', '#8a503e': '#2a3c6a', '#fdf7ed': '#d8f4ff', '#d3bfa9': '#9ac8e8' }),
    skin('necro', 'boneking', 'Bone King', 500, { '#17261f': '#3a3024', '#2f4a42': '#a89870', '#b6ffe0': '#fff0b0', '#8a503e': '#c8901c' }),
    skin('necro', 'voidcaller', 'Voidcaller', 1200, { '#17261f': '#140a2a', '#2f4a42': '#3e2878', '#b6ffe0': '#c9b3ff', '#8a503e': '#a070ff' }),
    skin('necro', 'bloodbound', 'Bloodbound', 0, { '#17261f': '#2a0810', '#2f4a42': '#701424', '#b6ffe0': '#ff7a6a', '#8a503e': '#ff3a2a' }),
    skin('cleric', 'azure', 'Azure', 500, { '#efe6cc': '#d8ecff', '#a69a78': '#6a88b0', '#c8a46a': '#8aa8d0', '#e46e33': '#3a78b0' }),
    skin('cleric', 'penitent', 'Penitent', 1200, { '#efe6cc': '#5a5478', '#a69a78': '#2a2540', '#c8a46a': '#3e3858', '#e46e33': '#a070ff', '#ffd36b': '#c9b3ff' }),
    skin('cleric', 'dawn', 'Dawn', 0, { '#efe6cc': '#ffe0e6', '#a69a78': '#c87a90', '#c8a46a': '#e09aa8', '#e46e33': '#ff5a7a' }),
    skin('shade', 'jade', 'Jade', 500, { '#2a2440': '#103028', '#3a3550': '#1c4a3a', '#4a3a6a': '#2a6a50', '#314152': '#1e3e38', '#b78cff': '#7dffd9' }),
    skin('shade', 'crimson', 'Crimson', 1200, { '#2a2440': '#300c16', '#3a3550': '#4a1a24', '#4a3a6a': '#7a1a2a', '#314152': '#3e1a22', '#b78cff': '#ff4a4a' }),
    skin('shade', 'ghost', 'Ghost', 0, { '#1f1b2e': '#4a5468', '#2a2440': '#7a8498', '#3a3550': '#a0aabe', '#314152': '#8a94a8', '#4a3a6a': '#c8d0e0', '#b78cff': '#7fe3ff' }),
    skin('bell', 'ember', 'Ember', 500, { '#4fb8a4': '#d8542a', '#2a6a70': '#8a2414', '#1e3a44': '#4a1006', '#9f294e': '#e8a020', '#da4e38': '#ffd860' }),
    skin('bell', 'frost', 'Frostbell', 1200, { '#4fb8a4': '#a8d8ff', '#2a6a70': '#4a78b0', '#1e3a44': '#1c3358', '#9f294e': '#2c4aa8', '#da4e38': '#6a9cff' }),
    skin('bell', 'golden', 'Golden', 0, { '#4fb8a4': '#ffd36b', '#2a6a70': '#b8861e', '#1e3a44': '#6a4c18', '#9f294e': '#5a2fb0', '#da4e38': '#a070ff' }),
    // weapon effect tints
    K('tint.crimson', 'tint', 'Crimson', 800, { ramp: ['#3c0610', '#9a1228', '#e23a3a', '#ff8a7a', '#ffe0d8'] }),
    K('tint.azure', 'tint', 'Azure', 800, { ramp: ['#0c1e4a', '#1e50b0', '#3a8cff', '#9ac8ff', '#e8f4ff'] }),
    K('tint.verdant', 'tint', 'Verdant', 800, { ramp: ['#0c3014', '#1e7a2a', '#4ad04a', '#a8ff8a', '#eaffe0'] }),
    K('tint.gilded', 'tint', 'Gilded', 1500, { ramp: ['#4a3008', '#a8741a', '#f0b830', '#ffe080', '#fff8d8'] }),
    K('tint.spectral', 'tint', 'Spectral', 2500, { ramp: ['#0c3a3a', '#2a9a9a', '#6affe6', '#c8fff6', '#ffffff'] }),
    K('tint.abyss', 'tint', 'Abyss', 0, { ramp: ['#14062a', '#4a1a90', '#9a4aff', '#d0a8ff', '#f4ecff'] }),
    // kill bursts
    K('kill.embers', 'kill', 'Embers', 600, { style: 'embers', col: '#ff8a3d' }),
    K('kill.souls', 'kill', 'Souls', 900, { style: 'souls', col: '#9fdcff' }),
    K('kill.shatter', 'kill', 'Shatter', 1400, { style: 'shatter', col: '#c8f6ff' }),
    K('kill.goldrush', 'kill', 'Gold Rush', 2000, { style: 'gold', col: '#ffd36b' }),
    K('kill.supernova', 'kill', 'Supernova', 0, { style: 'nova', col: '#ff7ad9' }),
    // level-up bursts
    K('lvl.pillar', 'lvl', 'Pillar of Light', 600, { style: 'pillar', col: '#fff0c2' }),
    K('lvl.runes', 'lvl', 'Rune Circle', 1000, { style: 'runes', col: '#a070ff' }),
    K('lvl.fireworks', 'lvl', 'Fireworks', 1500, { style: 'fireworks', col: '#ff7ad9' }),
    K('lvl.ascension', 'lvl', 'Ascension', 0, { style: 'ascend', col: '#ffd36b' }),
    // titles
    K('title.lamplighter', 'title', 'Lamplighter', 200),
    K('title.gravewalker', 'title', 'Gravewalker', 400),
    K('title.unbroken', 'title', 'The Unbroken', 800),
    K('title.hordebreaker', 'title', 'Hordebreaker', 1200),
    K('title.reaper', 'title', 'Reaper', 0),
    K('title.blender', 'title', 'Blender', 0),
    K('title.veteran', 'title', 'Veteran', 0),
    K('title.purist', 'title', 'Purist', 0),
    K('title.companion', 'title', 'Companion', 0),
    K('title.paragon', 'title', 'Paragon', 0),
    // name colours
    K('ncol.ember', 'ncol', 'Ember', 200, { col: '#ff8a3d' }),
    K('ncol.frost', 'ncol', 'Frost', 200, { col: '#7fe3ff' }),
    K('ncol.venom', 'ncol', 'Venom', 300, { col: '#9be33c' }),
    K('ncol.rose', 'ncol', 'Rose', 300, { col: '#ff7ad9' }),
    K('ncol.royal', 'ncol', 'Royal', 400, { col: '#b78cff' }),
    K('ncol.blood', 'ncol', 'Blood', 400, { col: '#ff4a4a' }),
    K('ncol.gold', 'ncol', 'Gold', 600, { col: '#ffd36b' }),
    K('ncol.prism', 'ncol', 'Prism', 0, { col: '#ff7a6a', cols: ['#ff7a6a', '#ffd36b', '#9be33c', '#7fe3ff', '#b78cff', '#ff7ad9'] }),
  ];
  ED.COS_IDS = ED.COSMETICS.map(c => c.id);
  ED.COS_BY = {}; for (const c of ED.COSMETICS) ED.COS_BY[c.id] = c;
  ED.COS_KINDS = ['skin', 'tint', 'kill', 'lvl', 'title', 'ncol'];
})(globalThis.ED || (globalThis.ED = {}));
