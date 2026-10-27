'use strict';
// Declarative art manifest for tools/art.js: which source rects become which ED.ART anims.
// Units are ART pixels (1 art px = 1 world px; ED.Atlas K = 1). Source sheets live under art-src/ (see art-src/SOURCES.md).
// Entry options: rects | frames [[sheet, rect]] | ascii [rows] + pal | sample | use (alias, same page) | make(H) -> bitmaps; swap / ramp (+lo, hi, skip) / stamp / flip;
//   post(b, i, H) per-frame transform; pivot; anchors; anchorsFrom; set; core:false (pose does not move the set's shared anchor). H = helpers in art.js buildFrames.
//
// ED.ART = { pages, frames, anims, pal, font, swaps }
//   anims[id] = { f: [frameId..], fps, loop, fw, fh, ax, ay, anchors: { hand, grip, tip, eye:[[x,y]..], centre, top, dir } }
//   fw x fh = logical frame; ax/ay = pivot inside it (feet for bodies/props/pickups, grip for weapons, centre for projectiles/fx/icons, 0,0 for tiles).
//   frames[id] = { p: page, x, y, w, h, ox, oy }: trimmed rect in the page; ox/oy = its offset inside the logical frame.
//   Draw: x - ax + ox, y - ay + oy (art px). All anchor coordinates are in logical-frame px (origin top-left of fw x fh).
//   Anims of one `set` share the union bbox, so feet never jitter between idle/run/hit or between the four directions.
//   dir (weapons, projectiles): direction of the business end as drawn, degrees clockwise from screen-up (0 up, 45 up-right, 90 right, 180 down).
//   eye = heuristic single point (centre x, 30% below the top of the union bbox); pal[id] = unique colours sorted dark to light (not for fx.*).
//   Directions of foes (probe with ED.ART.anims): foe.<id>.<state> two-way (drawn facing right, mirror for left);
//   foe.<id>.<state>.<d|u|l|r> four-way (down, up, left, right); foe.<id>.<state>.<0..7> eight-way (source rows: 0 S, 1 SE, 2 E, 3 NE, 4 N, 5 NW, 6 W, 7 SW).
//   Every foe has `walk`; `idle` exists for 0x72 foes; `atk`/`cast`/`howl`/`death` where the source has them (howl: icewolf, lavahound).
//
// ----------------------------------------------------------------------------- ID LIST (one line per family)
// hero.<knight|ranger|pyro|shade|cleric|necro|bell>.<idle|run|hit>   0x72 bodies facing right: idle 4f, run 4f, hit 1f; anchors.hand = weapon pivot on the body (feet + 3,-6),
//                        anchors.head[frame] = hat seat; frames carry the SWAPS base recolour; ED.ART.swaps[cls] = { key } player-colour key colours
// weapon.<id>            held/thrown weapon sprites (longsword warhammer glaive longbow crossbow twinbows firestaff emberwand inferno daggers knives scythes mace dawnhammer lantern bonewand soulscythe plaguestaff bronzebell greatbell handbells); anchors.grip/tip/dir
// weapon.alt.<name>      big_hammer waraxe double_axe anime_sword katana duel_sword machete saw_sword throwing_axe rusty_sword cleaver
// shield.<wood|green|gold|round|kite|buckler|tower>   16x16 shields (DawnLike); proj.shield = the thrown kite shield (centre pivot)
// foe.<id>.<state>[.dir] 46 foes (state walk always; idle/atk/cast/death where the source has them), direction rule above
// boss.<id>.<state>      bonewarden: idle walk attack(8f) shield hit death | sporemother: idle walk attack charge hit | drownedking: idle walk attack1 attack2 attack3 hit death
//                        hollowking: idle walk attack hit death, crown overlay boss.hollowking.crown | cyclops: idle walk attack hit death | samurai: idle walk charge attack hit death
//                        (all face right; anchors centre/top/eye shared across each boss's states)
// tile.floor.<1..8>, tile.dark.floor.<1..6> (base sets), tile.floor.<ossuary 1..8|glowmire 1..6|abyss 1..8> (per-stage recolours), tile.torch.floor (8f)
// prop.<pillar|pillar.broken|column|ruin.0..2|ruin.void.0..2|grave.0..4|coffin|bonepile|shroom.0..1|crystal.0..1|crystal.void.0..1|obelisk>   obstacles (feet pivot)
// prop.<brazier (8f)|brazier.broken|chest.closed|chest.open|chest.empty>
// deco.<bones.0..4|skull|moss.0..2|candle.0..3|urn.0..5|mushroom.0..3|root.0..1|puddle.0..3|crystal.0..2|shard.0..2|shell.0..2|seaweed.0..1|coral.0..1|pillarstub|chain>
// pickup.<xp1|xp5|xp25|gold|food|magnet|bomb (2f)|chest|chest.open (3f)> run pickups; pickup.<xp|coin|heart|flask.red|flask.yellow> base sprites; cos.platino (DawnLike's Platino)
// icon.w.<weaponId>      16x16 weapon icons (centre pivot): 12 general + evolutions, 7 signatures + evolutions (ids in art-src/wickdeep/icons.js W)
// icon.p.<passiveId>     16x16 passive icons: might haste reach velocity duration multishot vigor plating mending swiftness magnet fortune
// proj.<arrow|bolt|knife|fireball|hammer|shield|bone|trident|skull|web|thorn>      hero/foe projectile sprites (the other kinds are procedural orbs)
// fx.<cut|cutx|cslash|slash.arc|slash.small|hit.spark|explosion|flam|ice.burst|thunder|circle.spark|circle.white|shield.gold|spark.magic|smoke|smoke.ring|ember|glint|flame>
// fx.<blast.red|blast.blue|foam|ring.shock|burst|puff>, fx.<star.stun|sigil.skull|glyph.corroded|chain> (hand-authored)
// fxbig.<firespin|protection|felspell|midnight|freezing>   CodeManu loops, 16 evenly sampled frames each (non-empty 100x100 cells, trimmed)
// font.<hex code>        ED.ART.font.glyphs maps a character to its glyph anim id; draw glyphs at (pen, top + oy), pen += w + gap, space = font.space
// ---------------------------------------------------------------------------------------------------------------

const E = []; // entries in output order
const add = (id, page, src, rects, o) => { const e = Object.assign({ id, page, src, rects }, o || {}); E.push(e); return e; };
const strip = (x, y, fw, fh, n, step) => Array.from({ length: n }, (_, i) => [x + i * (step || fw), y, fw, fh]);
const cells = (list, fw, fh) => list.map(([c, r]) => [c * fw, r * fh, fw, fh]);
const oxn = (name, n) => Array.from({ length: n }, (_, i) => name + '_f' + i);

// --------------------------------------------------------------------------- source sheets (art-src relative)
const NA = 'ninja/';
const sheets = {
  tileList: undefined,
  ox: { file: '0x72/0x72_DungeonTilesetII_v1.7.png' },
  ext: { file: 'ext/dungeontileset-extended.png' },
  kos: { file: 'kosinaz/DarkDungeon.png', outline: ['#111111'] },
  ken: { file: 'kenney/tilemap_packed.png', outline: ['#3f2631'] },
  // Ninja Adventure
  na_bat: { file: NA + 'Actor/Monster/BlueBat/SpriteSheet.png', outline: ['#141b1b'] },
  na_slime: { file: NA + 'Actor/Monster/Slime3/Slime3.png', outline: ['#141b1b'] },
  na_myconid: { file: NA + 'Actor/Monster/Mushroom/mushroom.png', outline: ['#141b1b'] },
  na_spitter: { file: NA + 'Actor/Monster/Mushroom2/mushroom2.png', outline: ['#141b1b'] },
  na_mireworm: { file: NA + 'Actor/Monster/Larva/Larva.png', outline: ['#141b1b'] },
  na_wisp: { file: NA + 'Actor/Monster/Spirit/SpriteSheet.png', outline: ['#141b1b'] },
  na_eye: { file: NA + 'Actor/Monster/Eye/Eye.png', outline: ['#141b1b'] },
  na_kappa: { file: NA + 'Actor/Monster/KappaGreen/SpriteSheet.png', outline: ['#141b1b'] },
  na_flam: { file: NA + 'Actor/Monster/Flam/SpriteSheet.png', outline: ['#141b1b'] },
  na_sorc: { file: NA + 'Actor/Character/SorcererBlack/SpriteSheet.png', outline: ['#141b1b'] },
  na_nmage: { file: NA + 'Actor/Character/NinjaMageBlack/SpriteSheet.png', outline: ['#141b1b'] },
  na_book: { file: NA + 'Items/Weapons/Book/SpriteInHand.png', outline: ['#141b1b'] },
  na_wand: { file: NA + 'Items/Weapons/MagicWand/SpriteInHand.png', outline: ['#141b1b'] },
  na_bone: { file: NA + 'Items/Weapons/Bone/SpriteInHand.png', outline: ['#141b1b'] },
  // Ninja bosses
  nb_bamboo_idle: { file: NA + 'Actor/Boss/GiantBamboo/Idle.png', outline: ['#141b1b'] },
  nb_bamboo_walk: { file: NA + 'Actor/Boss/GiantBamboo/Walk.png', outline: ['#141b1b'] },
  nb_bamboo_attack: { file: NA + 'Actor/Boss/GiantBamboo/Attack.png', outline: ['#141b1b'] },
  nb_bamboo_charge: { file: NA + 'Actor/Boss/GiantBamboo/Charge.png', outline: ['#141b1b'] },
  nb_bamboo_hit: { file: NA + 'Actor/Boss/GiantBamboo/Hit.png', outline: ['#141b1b'] },
  nb_cy_idle: { file: NA + 'Actor/Boss/DemonCyclop/Idle.png', outline: ['#141b1b'] },
  nb_cy_walk: { file: NA + 'Actor/Boss/DemonCyclop/Walk.png', outline: ['#141b1b'] },
  nb_cy_hit: { file: NA + 'Actor/Boss/DemonCyclop/Hit.png', outline: ['#141b1b'] },
  nb_sa_idle: { file: NA + 'Actor/Boss/GiantBlueSamurai/Idle.png', outline: ['#141b1b'] },
  nb_sa_walk: { file: NA + 'Actor/Boss/GiantBlueSamurai/Walk.png', outline: ['#141b1b'] },
  nb_sa_attack: { file: NA + 'Actor/Boss/GiantBlueSamurai/AttackRight.png', outline: ['#141b1b'] },
  nb_sa_charge: { file: NA + 'Actor/Boss/GiantBlueSamurai/ChargeRight.png', outline: ['#141b1b'] },
  nb_sa_hit: { file: NA + 'Actor/Boss/GiantBlueSamurai/Hit.png', outline: ['#141b1b'] },
  // Ninja fx and projectiles
  nf_cut: { file: NA + 'FX/Attack/Cut/SpriteSheet.png' },
  nf_cutx: { file: NA + 'FX/Attack/CutX/SpriteSheet.png' },
  nf_cslash: { file: NA + 'FX/Attack/CircularSlash/SpriteSheet.png' },
  nf_arc: { file: NA + 'FX/Slash/SpriteSheetArc.png' },
  nf_explosion: { file: NA + 'FX/Elemental/Explosion/SpriteSheet.png' },
  nf_flam: { file: NA + 'FX/Elemental/Flam/SpriteSheet.png' },
  nf_iceb: { file: NA + 'FX/Elemental/Ice/SpriteSheetB.png' },
  nf_thunder: { file: NA + 'FX/Elemental/Thunder/SpriteSheet.png', outline: ['#141b1b'] },
  nf_circle_spark: { file: NA + 'FX/Magic/Circle/SpriteSheetSpark.png' },
  nf_circle_white: { file: NA + 'FX/Magic/Circle/SpriteSheetWhite.png' },
  nf_shield_gold: { file: NA + 'FX/Magic/Shield/SpriteSheetYellow.png' },
  nf_spark_magic: { file: NA + 'FX/Magic/Spark/SpriteSheet.png' },
  nf_smoke: { file: NA + 'FX/Smoke/Smoke/SpriteSheet.png' },
  nf_smoke_ring: { file: NA + 'FX/Smoke/SmokeCircular/SpriteSheet.png' },
  nf_ember: { file: NA + 'FX/Particle/Fire.png' },
  nf_glint: { file: NA + 'FX/Particle/Spark.png' },
  nf_arrow: { file: NA + 'FX/Projectile/Arrow.png', outline: ['#141b1b'] },
  nf_kunai: { file: NA + 'FX/Projectile/Kunai.png', outline: ['#141b1b'] },
  nf_fireball: { file: NA + 'FX/Projectile/Fireball.png' },
  nf_thorn: { file: NA + 'FX/Projectile/PlantSpike.png', outline: ['#141b1b', '#000000'] },
  // Puny
  pu_wolf: { file: 'puny/monsters/PunyMonsters/Gray-Wolf-32x32.png', outline: ['#151515'] },
  pu_spider: { file: 'puny/monsters/PunyMonsters/Purple-Spider-32x32.png', outline: ['#151515'] },
  pu_slime: { file: 'puny/chars/Puny-Characters/Slime.png', outline: ['#000000'] },
  // DawnLike (two frames: ...0 and ...1)
  dl_aq0: { file: 'dawnlike/Characters/Aquatic0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_aq1: { file: 'dawnlike/Characters/Aquatic1.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_un0: { file: 'dawnlike/Characters/Undead0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_un1: { file: 'dawnlike/Characters/Undead1.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_el0: { file: 'dawnlike/Characters/Elemental0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_el1: { file: 'dawnlike/Characters/Elemental1.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_sl0: { file: 'dawnlike/Characters/Slime0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_sl1: { file: 'dawnlike/Characters/Slime1.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_shield: { file: 'dawnlike/Items/Shield.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_longwep: { file: 'dawnlike/Items/LongWep.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_light: { file: 'dawnlike/Items/Light.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_wand: { file: 'dawnlike/Items/Wand.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_decor0: { file: 'dawnlike/Objects/Decor0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_ground0: { file: 'dawnlike/Objects/Ground0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_music: { file: 'dawnlike/Items/Music.png', outline: ['#140c1c'], edge: ['#452434'] },
  // dl_re0/dl_re1: the Platino reference cells (cos.platino is redrawn from them)
  dl_re0: { file: 'dawnlike/Characters/Reptile0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_re1: { file: 'dawnlike/Characters/Reptile1.png', outline: ['#140c1c'], edge: ['#452434'] },
  // LuizMelo (no outline in source: stamped at bake)
  lm_sk_idle: { file: 'luizmelo/skeleton/Idle.png' }, lm_sk_walk: { file: 'luizmelo/skeleton/Walk.png' }, lm_sk_attack: { file: 'luizmelo/skeleton/Attack.png' },
  lm_sk_shield: { file: 'luizmelo/skeleton/Shield.png' }, lm_sk_hit: { file: 'luizmelo/skeleton/Take Hit.png' }, lm_sk_death: { file: 'luizmelo/skeleton/Death.png' },
  lm_k_idle: { file: 'luizmelo/king2/Idle.png' }, lm_k_run: { file: 'luizmelo/king2/Run.png' }, lm_k_a1: { file: 'luizmelo/king2/Attack1.png' }, lm_k_a2: { file: 'luizmelo/king2/Attack2.png' },
  lm_k_a3: { file: 'luizmelo/king2/Attack3.png' }, lm_k_hit: { file: 'luizmelo/king2/Take Hit.png' }, lm_k_death: { file: 'luizmelo/king2/Death.png' },
  lm_w_idle: { file: 'luizmelo/evilwizard/Idle.png' }, lm_w_move: { file: 'luizmelo/evilwizard/Move.png' }, lm_w_attack: { file: 'luizmelo/evilwizard/Attack.png' },
  lm_w_hit: { file: 'luizmelo/evilwizard/Take Hit.png' }, lm_w_death: { file: 'luizmelo/evilwizard/Death.png' },
  // o_lobster, Aim studios, ansimuz, CodeManu
  ol_puff: { file: 'olobster/effects/enemy_afterdead_explosion_anim_spritesheet.png' },
  ol_hit: { file: 'olobster/effects/hit_effect_anim_spritesheet.png' },
  ol_slash: { file: 'olobster/effects/slash_effect_anim_spritesheet.png' },
  aim_blast_red: { file: 'aim/Blast.png' }, aim_blast_blue: { file: 'aim/Blast (1).png' }, aim_foam: { file: 'aim/Foam bubble explosion 64 X 64.png' },
  an_ring: { file: 'ansimuz/explosion-1-a/spritesheet.png' }, an_burst: { file: 'ansimuz/explosion-1-g/spritesheet.png' },
  cm_firespin: { file: 'codemanu/7_firespin_spritesheet.png' }, cm_protection: { file: 'codemanu/8_protectioncircle_spritesheet.png' },
  cm_felspell: { file: 'codemanu/17_felspell_spritesheet.png' }, cm_midnight: { file: 'codemanu/18_midnight_spritesheet.png' }, cm_freezing: { file: 'codemanu/19_freezing_spritesheet.png' },
  // pixel font (Ninja Adventure Ui/Font/font8x8.png, 15 columns of 8x8 in ASCII order from space)
  font8: { file: NA + 'Ui/Font/font8x8.png' },
};
delete sheets.tileList;

// --------------------------------------------------------------------------- heroes (0x72 bodies facing right)
const SWAPS = {
  knight: { base: { '#72d6ce': '#c3ccd6', '#417089': '#5d6670' }, key: ['#da4e38', '#ee8e2e'] },
  ranger: { base: {}, key: ['#da4e38'] },
  pyro: { base: { '#5698cc': '#d8442a', '#5956bd': '#7a1f12' }, key: ['#8a503e'] },
  shade: { base: { '#4ba747': '#3a3550', '#3d734f': '#1f1b2e', '#facb3e': '#2a2440', '#ee8e2e': '#4a3a6a', '#5698cc': '#b78cff', '#fccba3': '#d8b0a0', '#e2b694': '#b08c80' }, key: ['#5698cc'] },
  cleric: { base: { '#da4e38': '#efe6cc', '#c38d70': '#c8a46a', '#775c55': '#a69a78', '#7b8994': '#ffd36b' }, key: ['#e46e33'] },
  necro: { base: { '#5698cc': '#2f4a42', '#5956bd': '#17261f', '#fdf7ed': '#b6ffe0', '#b58057': '#8a7a6a' }, key: ['#5956bd'] },
  bell: { base: { '#49a790': '#4fb8a4', '#417089': '#2a6a70', '#314152': '#1e3a44', '#d3bfa9': '#e0b070', '#8f4029': '#b0702e', '#62232f': '#6a3f1e' }, key: ['#9f294e', '#da4e38'] }, // verdigris scales, bronze belly and belt, crest = player colour
};
// SWAPS[cls].base (ART-PLAN 4.1 palette swap) is baked into the hero.<cls>.* frames; ED.ART.swaps[cls].key = the player-colour key colours after that swap (co-op recolour at runtime).
const HEAD_SKIP = { knight: ['#da4e38', '#ee8e2e'], bell: ['#9f294e', '#da4e38'] }; // plume / crest colours the hat seat ignores
const HEROES = { knight: 'knight_m', ranger: 'elf_f', pyro: 'wizzard_m', shade: 'elf_m', cleric: 'dwarf_m', necro: 'wizzard_f', bell: 'lizard_f' };
for (const [id, body] of Object.entries(HEROES)) {
  // hand = feet + (3,-6): torso height of the big-headed 0x72 bodies (the plan's -9 lands on the chin); head = per-frame hat seat (see art.js headAt)
  const sw = SWAPS[id].base, set = 'hero.' + id, base = { page: 'actors', src: 'ox', set, handRel: [3, -6], head: HEAD_SKIP[id] || true, swap: Object.keys(sw).length ? sw : undefined };
  add(set + '.idle', 'actors', 'ox', oxn(body + '_idle_anim', 4), Object.assign({}, base, { fps: 6.67, loop: true }));
  add(set + '.run', 'actors', 'ox', oxn(body + '_run_anim', 4), Object.assign({}, base, { fps: 10, loop: true }));
  add(set + '.hit', 'actors', 'ox', [body + '_hit_anim_f0'], Object.assign({}, base, { fps: 0, loop: false }));
}

// --------------------------------------------------------------------------- weapons (all point up, grip near the bottom, unless dir says otherwise)
const W = (id, src, rect, grip, o) => { o = o || {}; return add(id, 'actors', src, [rect], Object.assign({ pivot: 'grip', fps: 0 }, o, { anchors: Object.assign({ grip, dir: 0 }, o.anchors) })); };
const OXW = (id, name, grip, o) => W(id, 'ox', name, grip, o);
OXW('weapon.longsword', 'weapon_knight_sword', [5, 26]);
OXW('weapon.warhammer', 'weapon_hammer', [5, 20]);
OXW('weapon.glaive', 'weapon_spear', [3, 20]);
OXW('weapon.longbow', 'weapon_bow', [10, 13], { anchors: { dir: 90 } });
OXW('weapon.twinbows', 'weapon_bow_2', [10, 13], { anchors: { dir: 90 } });
add('weapon.crossbow', 'actors', null, null, {
  ascii: [[
    '..........kk....',
    '.........kssk...',
    '.........ksSk...',
    '..kkkkkkkkSSkkk.',
    '.kWwwwwwwwwwSSb.',
    '..kkkkkkkkSSkkk.',
    '.........ksSk...',
    '.........kssk...',
    '..........kk....'],
  ], pal: { k: '#222222', w: '#775c55', W: '#c38d70', s: '#7b8994', S: '#aeb8c0', b: '#fdf7ed' }, pivot: 'grip', anchors: { grip: [4, 4], dir: 90 }, fps: 0,
});
OXW('weapon.firestaff', 'weapon_red_magic_staff', [4, 20]);
OXW('weapon.plaguestaff', 'weapon_green_magic_staff', [4, 20]);
OXW('weapon.daggers', 'weapon_knife', [3, 11]);
OXW('weapon.knives', 'weapon_knife', [3, 11]);
OXW('weapon.mace', 'weapon_mace', [5, 20]);
OXW('weapon.dawnhammer', 'weapon_big_hammer', [5, 33], { ramp: ['#222222', '#6b4a12', '#c8922a', '#ffd36b', '#fff2c0'], skip: ['#222222'] });
add('weapon.emberwand', 'actors', 'na_wand', [[0, 0, 5, 10]], { pivot: 'grip', anchors: { grip: [2, 8], dir: 0 }, ramp: ['#222222', '#7a1f12', '#d8442a', '#ff9a4a', '#ffe6b0'], skip: ['#222222'], fps: 0 });
add('weapon.inferno', 'actors', 'na_book', [[0, 0, 12, 9]], { pivot: 'grip', anchors: { grip: [6, 7], dir: 0 }, ramp: ['#222222', '#5a1714', '#d8442a', '#ff9a4a', '#ffe6b0'], skip: ['#222222'], fps: 0 });
add('weapon.scythes', 'actors', 'dl_longwep', [[0, 48, 16, 16]], { pivot: 'grip', anchors: { grip: [3, 13], dir: 45 }, flip: true, ramp: ['#222222', '#2a2440', '#6b4aa0', '#b78cff', '#efe0ff'], skip: ['#222222'], fps: 0 });
add('weapon.soulscythe', 'actors', 'dl_longwep', [[0, 48, 16, 16]], { pivot: 'grip', anchors: { grip: [3, 13], dir: 45 }, flip: true, ramp: ['#222222', '#17261f', '#2f7a68', '#7dffd9', '#e0fff4'], skip: ['#222222'], fps: 0 });
add('weapon.lantern', 'actors', 'dl_light', [[48, 0, 16, 16]], { pivot: 'grip', anchors: { grip: [8, 2], dir: 180 }, fps: 0 });
add('weapon.bonewand', 'actors', 'dl_wand', [[80, 80, 16, 16]], { pivot: 'grip', anchors: { grip: [3, 13], dir: 45 }, flip: true, fps: 0 });
// Bellwarden bells (the chain-end body): grip = chain eye at the top centre, dir 180 = mouth down. Verdigris bronze with a patina lip; the great bell and
// the handbell are hand-drawn in the same colours (DawnLike bell at about 1.5x and 0.6x).
const BELL = { k: '#222222', a: '#5a3418', D: '#7a4620', B: '#b0702e', L: '#e0a858', H: '#fff0c8', P: '#2f7a68', p: '#1f5048', C: '#3a3a44' };
add('weapon.bronzebell', 'actors', 'dl_music', [[0, 64, 16, 16]], { pivot: 'grip', anchors: { grip: [8, 3], dir: 180 }, swap: { '#452434': BELL.a, '#864d30': BELL.P, '#d37d2c': BELL.B, '#dbd75d': BELL.L, '#dfefd7': BELL.H }, fps: 0 });
add('weapon.greatbell', 'actors', null, null, {
  ascii: [[
    '.....kk.....',
    '....kLHk....',
    '...kkaakk...',
    '..kBHHLLDk..',
    '..kBLHLLDk..',
    '..kBLHLLDk..',
    '.kBLLHLLLDk.',
    '.kBLLHLLLDk.',
    'kPBLLHLLLDPk',
    'kpPPPPPPPPpk',
    '.kkkkkkkkkk.',
    '....kCCk....',
    '.....kk.....'],
  ], pal: BELL, pivot: 'grip', anchors: { grip: [6, 0], dir: 180 }, fps: 0,
});
add('weapon.handbells', 'actors', null, null, { ascii: [['..k..', '.kak.', '.kLk.', 'kHLDk', 'kHLDk', 'kPPpk', 'kkkkk', '.kCk.', '..k..']], pal: BELL, pivot: 'grip', anchors: { grip: [2, 0], dir: 180 }, fps: 0 });
// Route forks and foe weapons
OXW('weapon.alt.big_hammer', 'weapon_big_hammer', [5, 33]);
OXW('weapon.alt.waraxe', 'weapon_waraxe', [6, 19]);
OXW('weapon.alt.double_axe', 'weapon_double_axe', [8, 20]);
OXW('weapon.alt.anime_sword', 'weapon_anime_sword', [6, 27]);
OXW('weapon.alt.katana', 'weapon_katana', [3, 26]);
OXW('weapon.alt.duel_sword', 'weapon_duel_sword', [4, 27]);
OXW('weapon.alt.machete', 'weapon_machete', [2, 19]);
OXW('weapon.alt.saw_sword', 'weapon_saw_sword', [5, 22]);
OXW('weapon.alt.throwing_axe', 'weapon_throwing_axe', [5, 10]);
OXW('weapon.alt.rusty_sword', 'weapon_rusty_sword', [5, 18]);
OXW('weapon.alt.cleaver', 'weapon_cleaver', [4, 16]);
// Shields (DawnLike 16x16, front view; pivot = centre)
['wood', 'green', 'gold', 'round', 'kite', 'buckler', 'tower'].forEach((n, i) => add('shield.' + n, 'actors', 'dl_shield', [[i * 16, 0, 16, 16]], { pivot: 'centre', fps: 0 }));

// --------------------------------------------------------------------------- foes
// 0x72 bodies (two-way): idle 4f + run 4f; `loop` bodies have a single 4f cycle.
const foeOx = (id, body, one) => {
  const o = { set: 'foe.' + id, eye: 'auto' };
  if (one) {
    add('foe.' + id + '.walk', 'actors', 'ox', oxn(one, 4), Object.assign({ fps: 6.67, loop: true }, o));
    add('foe.' + id + '.idle', 'actors', null, null, Object.assign({ use: 'foe.' + id + '.walk', fps: 6.67, loop: true }, o));
  } else {
    add('foe.' + id + '.idle', 'actors', 'ox', oxn(body + '_idle_anim', 4), Object.assign({ fps: 6.67, loop: true }, o));
    add('foe.' + id + '.walk', 'actors', 'ox', oxn(body + '_run_anim', 4), Object.assign({ fps: 10, loop: true }, o));
  }
};
const foeOxShared = (id, srcId) => {
  const o = { set: 'foe.' + id, eye: 'auto' };
  add('foe.' + id + '.idle', 'actors', null, null, Object.assign({ use: 'foe.' + srcId + '.idle', fps: 6.67, loop: true }, o));
  add('foe.' + id + '.walk', 'actors', null, null, Object.assign({ use: 'foe.' + srcId + '.walk', fps: 10, loop: true }, o));
};
foeOx('skeleton', 'skelet'); ['bonearcher', 'frozenskel', 'minion'].forEach((id) => foeOxShared(id, 'skeleton'));
foeOx('skelknight', 'ogre'); ['frostknight', 'sentinel', 'forgeknight', 'voidknight'].forEach((id) => foeOxShared(id, 'skelknight'));
foeOx('shroomhulk', 'big_zombie'); ['icegolem', 'automaton'].forEach((id) => foeOxShared(id, 'shroomhulk'));
foeOx('horror', 'big_demon');
foeOx('imp', 'imp');
foeOx('drowned', null, 'zombie_anim');
foeOx('priest', null, 'necromancer_anim');

// Ninja four-way sheets (64x64 = 4 columns of direction d,u,l,r x 4 walk frames). cast = row 4 of the 64x112 caster sheets.
const NA_DIRS = ['d', 'u', 'l', 'r'];
const foeNa4 = (id, sheet, o) => {
  o = o || {};
  NA_DIRS.forEach((d, c) => add('foe.' + id + '.walk.' + d, 'actors', sheet, [0, 1, 2, 3].map((i) => [c * 16, i * 16, 16, 16]), { set: 'foe.' + id, fps: 6.67, loop: true, eye: 'auto' }));
  if (o.cast) NA_DIRS.forEach((d, c) => add('foe.' + id + '.cast.' + d, 'actors', sheet, [[c * 16, 64, 16, 16]], { set: 'foe.' + id, fps: 0, loop: false, eye: 'auto', core: false }));
};
const foeNa4Shared = (id, srcId, cast) => {
  NA_DIRS.forEach((d) => add('foe.' + id + '.walk.' + d, 'actors', null, null, { use: 'foe.' + srcId + '.walk.' + d, set: 'foe.' + id, fps: 6.67, loop: true, eye: 'auto' }));
  if (cast) NA_DIRS.forEach((d) => add('foe.' + id + '.cast.' + d, 'actors', null, null, { use: 'foe.' + srcId + '.cast.' + d, set: 'foe.' + id, fps: 0, loop: false, eye: 'auto', core: false }));
};
foeNa4('bat', 'na_bat'); foeNa4Shared('cinderbat', 'bat');
foeNa4('slime', 'na_slime'); foeNa4Shared('glowslime', 'slime');
foeNa4('myconid', 'na_myconid'); foeNa4('spitter', 'na_spitter'); foeNa4('mireworm', 'na_mireworm');
foeNa4('frostwisp', 'na_wisp'); foeNa4Shared('shade', 'frostwisp');
foeNa4('voideye', 'na_eye'); foeNa4('reaver', 'na_kappa'); foeNa4('drone', 'na_flam');
foeNa4('rimemage', 'na_sorc', { cast: true }); foeNa4('riftcaller', 'na_nmage', { cast: true });

// Puny eight-way sheets: 12 columns x 8 rows of 32x32 (cols 0-5 walk, 6-9 attack, 11 howl on the wolf sheet); row k = direction k.
const foePu8 = (id, sheet, howl) => {
  for (let k = 0; k < 8; k++) {
    add('foe.' + id + '.walk.' + k, 'actors', sheet, strip(0, k * 32, 32, 32, 6), { set: 'foe.' + id, fps: 10, loop: true, eye: 'auto' });
    add('foe.' + id + '.atk.' + k, 'actors', sheet, strip(192, k * 32, 32, 32, 4), { set: 'foe.' + id, fps: 14, loop: false, eye: 'auto', core: false });
    if (howl) add('foe.' + id + '.howl.' + k, 'actors', sheet, [[352, k * 32, 32, 32]], { set: 'foe.' + id, fps: 0, loop: false, eye: 'auto', core: false });
  }
};
const foePu8Shared = (id, srcId, howl) => {
  for (let k = 0; k < 8; k++) {
    add('foe.' + id + '.walk.' + k, 'actors', null, null, { use: 'foe.' + srcId + '.walk.' + k, set: 'foe.' + id, fps: 10, loop: true, eye: 'auto' });
    add('foe.' + id + '.atk.' + k, 'actors', null, null, { use: 'foe.' + srcId + '.atk.' + k, set: 'foe.' + id, fps: 14, loop: false, eye: 'auto', core: false });
    if (howl) add('foe.' + id + '.howl.' + k, 'actors', null, null, { use: 'foe.' + srcId + '.howl.' + k, set: 'foe.' + id, fps: 0, loop: false, eye: 'auto', core: false });
  }
};
foePu8('icewolf', 'pu_wolf', true); foePu8Shared('lavahound', 'icewolf', true); foePu8('cavespider', 'pu_spider');
// Puny slime strip (15 frames of 32x32): idle 0,1,2,1; walk (hop) 2,3,4,5,7,8; death 10-13.
const foePuSlime = (id, first) => {
  const f = (i) => [i * 32, 0, 32, 32], base = { set: 'foe.' + id, eye: 'auto' };
  if (first) {
    add('foe.' + id + '.idle', 'actors', 'pu_slime', [0, 1, 2, 1].map(f), Object.assign({ fps: 4, loop: true }, base));
    add('foe.' + id + '.walk', 'actors', 'pu_slime', [2, 3, 4, 5, 7, 8].map(f), Object.assign({ fps: 9, loop: true }, base));
    add('foe.' + id + '.death', 'actors', 'pu_slime', [10, 11, 12, 13].map(f), Object.assign({ fps: 12, loop: false, core: false }, base));
  } else {
    add('foe.' + id + '.idle', 'actors', null, null, Object.assign({ use: 'foe.slimelet.idle', fps: 4, loop: true }, base));
    add('foe.' + id + '.walk', 'actors', null, null, Object.assign({ use: 'foe.slimelet.walk', fps: 9, loop: true }, base));
    add('foe.' + id + '.death', 'actors', null, null, Object.assign({ use: 'foe.slimelet.death', fps: 12, loop: false, core: false }, base));
  }
};
foePuSlime('slimelet', true); foePuSlime('glowlet'); foePuSlime('jellet');

// DawnLike two-frame foes (frame 0 from ...0.png, frame 1 from ...1.png, same rect). Slow idle at 400 ms plus a procedural bob at runtime.
const foeDl = (id, sheet, x, y) => {
  const r = [x, y, 16, 16], base = { set: 'foe.' + id, eye: 'auto' };
  add('foe.' + id + '.walk', 'actors', null, null, Object.assign({ frames: [[sheet + '0', r], [sheet + '1', r]], fps: 2.5, loop: true }, base));
  add('foe.' + id + '.idle', 'actors', null, null, Object.assign({ use: 'foe.' + id + '.walk', fps: 2.5, loop: true }, base));
};
foeDl('sporepuff', 'dl_sl', 48, 0);
foeDl('flameturret', 'dl_el', 16, 128);
foeDl('starspawn', 'dl_el', 0, 160);
foeDl('eel', 'dl_aq', 0, 32); foeDl('siren', 'dl_aq', 0, 48); foeDl('crab', 'dl_aq', 80, 0); foeDl('jelly', 'dl_aq', 96, 0); foeDl('tidecaller', 'dl_aq', 32, 48);
foeDl('voidwraith', 'dl_un', 0, 80); foeDl('gloom', 'dl_un', 32, 80);

// --------------------------------------------------------------------------- bosses (page bosses)
// LuizMelo bosses have no outline in the source, so a 1 px #222222 outline is stamped at bake.
const boss = (id, list, set) => list.forEach(([state, sheet, fw, fh, n, fps, loop, o]) => add('boss.' + id + '.' + state, 'bosses', sheet, strip(0, 0, fw, fh, n), Object.assign({ set: set || 'boss.' + id, fps, loop, eye: 'auto' }, state === 'idle' || state === 'walk' ? {} : { core: false }, o)));
const ST = { stamp: true };
boss('bonewarden', [['idle', 'lm_sk_idle', 150, 150, 4, 6, true, ST], ['walk', 'lm_sk_walk', 150, 150, 4, 8, true, ST], ['attack', 'lm_sk_attack', 150, 150, 8, 12, false, ST],
  ['shield', 'lm_sk_shield', 150, 150, 4, 8, false, ST], ['hit', 'lm_sk_hit', 150, 150, 4, 12, false, ST], ['death', 'lm_sk_death', 150, 150, 4, 6, false, ST]]);
boss('drownedking', [['idle', 'lm_k_idle', 160, 111, 8, 8, true, ST], ['walk', 'lm_k_run', 160, 111, 8, 12, true, ST], ['attack1', 'lm_k_a1', 160, 111, 4, 10, false, ST],
  ['attack2', 'lm_k_a2', 160, 111, 4, 10, false, ST], ['attack3', 'lm_k_a3', 160, 111, 4, 10, false, ST], ['hit', 'lm_k_hit', 160, 111, 4, 12, false, ST], ['death', 'lm_k_death', 160, 111, 6, 8, false, ST]]);
// anchors.crown[frame] = [x, y] art px of the crown overlay's bottom centre per frame: the head column and the first skin row (#fac786) + 1, measured per frame (the head moves 10-20 art px between poses).
const HK = (crown) => Object.assign({ anchors: { crown } }, ST);
boss('hollowking', [['idle', 'lm_w_idle', 150, 150, 8, 8, true, HK([[72, 57], [72, 58], [72, 59], [72, 59], [72, 59], [72, 58], [72, 57], [72, 57]])], ['walk', 'lm_w_move', 150, 150, 8, 10, true, HK([[82, 60], [82, 60], [82, 60], [82, 60], [82, 60], [82, 60], [82, 60], [82, 60]])],
  ['attack', 'lm_w_attack', 150, 150, 8, 12, false, HK([[72, 57], [72, 57], [72, 57], [72, 57], [72, 57], [72, 57], [72, 57], [72, 57]])],
  ['hit', 'lm_w_hit', 150, 150, 4, 12, false, HK([[72, 57], [72, 57], [68, 57], [70, 57]])], ['death', 'lm_w_death', 150, 150, 5, 8, false, HK([[70, 57], [76, 62], [79, 68], [85, 79], [84, 77]])]]);
boss('sporemother', [['idle', 'nb_bamboo_idle', 62, 62, 6, 6, true], ['walk', 'nb_bamboo_walk', 62, 62, 12, 10, true], ['attack', 'nb_bamboo_attack', 62, 62, 5, 10, false],
  ['charge', 'nb_bamboo_charge', 62, 62, 3, 8, false], ['hit', 'nb_bamboo_hit', 62, 62, 4, 12, false]]);
add('boss.hollowking.crown', 'bosses', null, null, { ascii: [['y...y...y', 'yy.yyy.yy', 'yyyyyyyyy', 'yRyyBYyRy', 'ooooooooo']], pal: { y: '#ffd36b', Y: '#fff2c0', o: '#c8922a', R: '#d8442a', B: '#5fb8ff' }, stamp: true, fps: 0 });

// Ninja bosses with partial sheets get derived poses. crumble(keep): frames from index `keep` on turn to ash and lose pixels top-first (fixed hash dither, deterministic).
const ASHR = ['#141010', '#3a3230', '#6a605a', '#a8a098'];
const crumble = (keep, n) => (b, i, H) => {
  if (i < keep) return b;
  const t = (i - keep + 1) / (n - keep + 1), o = H.recolour(b, { ramp: ASHR }), q = H.bmp(o.w, o.h);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    const s = (y * o.w + x) * 4; if (!o.data[s + 3]) continue;
    if ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 997 / 997 < t * (0.35 + 0.9 * (1 - y / o.h))) continue;
    for (let k = 0; k < 4; k++) q.data[s + k] = o.data[s + k];
  }
  return q;
};
// Demon Cyclops (50x50 cells): attack = idle with a blazing eye winding up, then the hit-sheet roar; death = roar poses then crumble.
const CYC = (sheet, x) => [sheet, [x * 50, 0, 50, 50]];
const CY_RAGE = { '#c8966b': '#ffb43a', '#fce2ca': '#fff8c0', '#e0394c': '#f0442e' };
boss('cyclops', [['idle', 'nb_cy_idle', 50, 50, 5, 6, true], ['walk', 'nb_cy_walk', 50, 50, 6, 10, true], ['hit', 'nb_cy_hit', 50, 50, 3, 12, false]]);
add('boss.cyclops.attack', 'bosses', null, null, { frames: [CYC('nb_cy_idle', 0), CYC('nb_cy_idle', 2), CYC('nb_cy_hit', 1), CYC('nb_cy_hit', 2)], swap: CY_RAGE, set: 'boss.cyclops', fps: 8, loop: false, eye: 'auto', core: false });
add('boss.cyclops.death', 'bosses', null, null, { frames: [CYC('nb_cy_hit', 1), CYC('nb_cy_hit', 2), CYC('nb_cy_hit', 2), CYC('nb_cy_hit', 2), CYC('nb_cy_hit', 2), CYC('nb_cy_hit', 2)], post: crumble(2, 6), set: 'boss.cyclops', fps: 8, loop: false, eye: 'auto', core: false });
// Giant Blue Samurai (idle/walk/hit 96x48 cells; charge/attack 96x96 cells with the body 2 px left and 34 px lower: pivot [45, 82] = the idle feet).
boss('samurai', [['idle', 'nb_sa_idle', 96, 48, 6, 8, true], ['walk', 'nb_sa_walk', 96, 48, 6, 10, true], ['hit', 'nb_sa_hit', 96, 48, 4, 12, false]]);
const SA96 = { set: 'boss.samurai', eye: 'auto', core: false, pivot: [45, 82], anchorsFrom: 'boss.samurai.idle' };
add('boss.samurai.charge', 'bosses', 'nb_sa_charge', strip(0, 0, 96, 96, 3), Object.assign({ fps: 6, loop: false }, SA96));
add('boss.samurai.attack', 'bosses', 'nb_sa_attack', strip(0, 0, 96, 96, 4), Object.assign({ fps: 12, loop: false }, SA96));
const SAH = (x) => ['nb_sa_hit', [x * 96, 0, 96, 48]];
add('boss.samurai.death', 'bosses', null, null, { frames: [SAH(0), SAH(2), SAH(3), SAH(3), SAH(3), SAH(3)], post: crumble(2, 6), set: 'boss.samurai', fps: 8, loop: false, eye: 'auto', core: false });

// --------------------------------------------------------------------------- world: floors, braziers, obstacle props, decor (page world)
const HA = require('../art-src/wickdeep/icons.js'); // hand-authored icons, pickups and props (CC0, own work)
const T = (id, name, o) => add(id, 'world', 'ox', [name], Object.assign({ pivot: 'tl', fps: 0 }, o || {}));
for (let i = 1; i <= 8; i++) T('tile.floor.' + i, 'floor_' + i);
const DARK = [[32, 112], [48, 112], [64, 112], [32, 128], [48, 128], [64, 128]];
DARK.forEach(([x, y], i) => add('tile.dark.floor.' + (i + 1), 'world', 'kos', [[x, y, 16, 16]], { pivot: 'tl', fps: 0 }));
// Per-stage floors: the base sets through a dark ramp in the stage's colour (kept low-contrast so the horde reads on top).
const FLOOR_RAMP = {
  ossuary: { ramp: ['#140f0d', '#2c221d', '#4a3a31', '#73604f'], lo: 0.08, hi: 0.45 },
  glowmire: { ramp: ['#070d0c', '#0f1f1b', '#1a3530', '#2b5048'], lo: 0.04, hi: 0.3 },
  abyss: { ramp: ['#0a0711', '#181029', '#271b3e', '#3c2d57'], lo: 0.08, hi: 0.45 },
};
for (let i = 1; i <= 8; i++) T('tile.floor.ossuary.' + i, 'floor_' + i, FLOOR_RAMP.ossuary);
DARK.forEach(([x, y], i) => add('tile.floor.glowmire.' + (i + 1), 'world', 'kos', [[x, y, 16, 16]], Object.assign({ pivot: 'tl', fps: 0 }, FLOOR_RAMP.glowmire)));
for (let i = 1; i <= 8; i++) T('tile.floor.abyss.' + i, 'floor_' + i, FLOOR_RAMP.abyss);
add('tile.torch.floor', 'world', 'ext', strip(128, 400, 16, 24, 8), { fps: 10, loop: true });
// Brazier (destructible, drops pickups): an iron bowl on a stand with the ext flame loop (8f) burning in it; broken = the bowl tipped over with spilled coals.
add('prop.brazier', 'world', null, null, {
  make: (H) => Array.from({ length: 8 }, (_, i) => { const b = H.bmp(16, 22); H.blit(b, H.grab('ext', [128 + i * 16, 340, 16, 14]), 0, 0); return H.blit(b, H.ascii(HA.PROP.brazierBowl, HA.PAL), 1, 12); }),
  fps: 10, loop: true, set: 'prop.brazier',
});
add('prop.brazier.broken', 'world', null, null, { ascii: [HA.PROP.brazierBroken], pal: HA.PAL, fps: 0 });

const P = (id, src, rect, o) => add(id, 'world', src, [rect], Object.assign({ fps: 0 }, o || {}));
P('prop.column', 'ox', 'column');
add('prop.pillar', 'world', null, null, { use: 'prop.column', fps: 0 });
P('prop.chest.closed', 'ox', 'chest_full_open_anim_f0');
add('prop.chest.open', 'world', 'ox', oxn('chest_full_open_anim', 3), { fps: 8, loop: false });
add('prop.chest.empty', 'world', 'ox', oxn('chest_empty_open_anim', 3), { fps: 8, loop: false });

const D = (id, src, rect, o) => add(id, 'world', src, [rect], Object.assign({ fps: 0 }, o || {}));
for (let i = 0; i < 5; i++) D('deco.bones.' + i, 'dl_decor0', [i * 16, 192, 16, 16]);
D('deco.skull', 'ox', 'skull');
for (let i = 0; i < 3; i++) D('deco.moss.' + i, 'dl_decor0', [64 + i * 16, 32, 16, 16]);
for (let i = 0; i < 4; i++) D('deco.candle.' + i, 'dl_decor0', [i * 16, 128, 16, 16]);
for (let i = 0; i < 6; i++) D('deco.urn.' + i, 'dl_decor0', [i * 16, 48, 16, 16]);
for (let i = 0; i < 4; i++) D('deco.mushroom.' + i, 'dl_ground0', [i * 16, 48, 16, 16]);
D('deco.root.0', 'dl_ground0', [64, 64, 16, 16]); D('deco.root.1', 'dl_ground0', [80, 64, 16, 16]);
[0, 32, 64, 96].forEach((x, i) => D('deco.puddle.' + i, 'dl_ground0', [x, 80, 16, 16]));
// Hand-authored crystals (DawnLike Ore0 is an autotile fill, not an object); deco.shard reuses them (violet ramp at runtime).
const CRYSTALS = [
  ['...k...', '..kwk..', '..kck..', '.kwcCk.', '.kwcCk.', '.kcCCDk', '.kcCDDk', '.kCCDEk', '.kCDDEk', '.kCDEEk', '..kDEk.', '...kk..'],
  ['..k...k..', '.kwk.kwk.', '.kck.kck.', 'kwcCkkcCk', 'kcCDkkCDk', 'kCDDkkDEk', 'kCDEkkDEk', '.kkkkkkk.'],
  ['..k..', '.kwk.', '.kck.', 'kcCDk', 'kCDEk', '.kkk.'],
];
CRYSTALS.forEach((rows, i) => add('deco.crystal.' + i, 'world', null, null, { ascii: [rows], pal: { k: '#222222', w: '#ffffff', c: '#c8f0ff', C: '#7ac8f0', D: '#3f8cc8', E: '#2a5f95' }, fps: 0 }));
CRYSTALS.forEach((rows, i) => add('deco.shard.' + i, 'world', null, null, { use: 'deco.crystal.' + i, fps: 0 }));
for (let i = 0; i < 3; i++) D('deco.shell.' + i, 'dl_ground0', [i * 16, 64, 16, 16]);
for (let i = 0; i < 2; i++) { D('deco.seaweed.' + i, 'dl_ground0', [i * 16, 16, 16, 16]); D('deco.coral.' + i, 'dl_ground0', [32 + i * 16, 16, 16, 16]); }
D('deco.pillarstub', 'ox', [80, 96, 16, 23]); // column rows 16-38: lower shaft plus base (rows 39-47 of the cell are empty)
add('prop.pillar.broken', 'world', null, null, { use: 'deco.pillarstub', fps: 0 });
add('deco.chain', 'world', null, null, { ascii: [['.kk.', 'kSSk', 'kSSk', '.kk.', '.kk.', 'kSSk', 'kSSk', '.kk.', '.kk.', 'kSSk', 'kSSk', '.kk.']], pal: { k: '#222222', S: '#9aa6b0' }, fps: 0 });

// Obstacle props (feet pivot; arena obstacles are circles r 12-40, the sprite stands on the disc).
// Ossuary: graves, a coffin, a bone pile, broken walls. Glowmire: giant mushrooms, teal crystals. Abyss: violet crystals, an obelisk, void-touched ruins.
[[0, 272], [32, 272], [16, 288]].forEach(([x, y], i) => D('prop.grave.' + i, 'dl_decor0', [x, y, 16, 16]));
D('prop.grave.3', 'ken', [64, 80, 16, 16]);
D('prop.grave.4', 'dl_decor0', [64, 272, 16, 16]);
D('prop.coffin', 'dl_decor0', [96, 160, 16, 16]);
add('prop.bonepile', 'world', null, null, { ascii: [HA.PROP.bonepile], pal: HA.PAL, fps: 0 });
// Ruins: 0x72 wall caps over brick faces, the top broken along a jagged profile (prof(x) = rows erased from the top), re-outlined, rubble at the foot.
const RUINS = [
  { tiles: [['wall_top_mid', 'wall_top_mid'], ['wall_mid', 'wall_mid']], prof: (x) => (x < 14 ? 0 : 18 + ((x * 5) % 4)) },
  { tiles: [['wall_top_mid', 'wall_top_mid', 'wall_top_mid'], ['wall_mid', 'wall_mid', 'wall_mid']], prof: (x) => (x < 16 ? 0 : x < 32 ? 21 + ((x * 3) % 5) : 14 + ((x * 7) % 3)) },
  { tiles: [['wall_top_mid'], ['wall_mid']], prof: (x) => 15 + ((x * 3) % 4) },
];
const ruin = (r, ramp) => (H) => {
  const cols = r.tiles[0].length, w = cols * 16, h = r.tiles.length * 16, wall = H.bmp(w, h);
  r.tiles.forEach((row, j) => row.forEach((n, i) => H.blit(wall, H.grab('ox', n), i * 16, j * 16)));
  for (let x = 0; x < w; x++) for (let y = 0; y < r.prof(x); y++) wall.data[(y * w + x) * 4 + 3] = 0;
  let b = H.stamp(H.padBmp(wall, 1), H.OUTLINE);
  const out = H.bmp(b.w + 8, b.h + 2), rub = H.ascii(HA.PROP.rubble, HA.PAL);
  H.blit(out, b, 4, 0); H.blit(out, rub, 0, out.h - rub.h); H.blit(out, rub, out.w - rub.w, out.h - rub.h);
  return [ramp ? H.recolour(out, { ramp, lo: 0.05, hi: 0.75, skip: [H.OUTLINE, '#1a1216'] }) : out];
};
const VOID_RAMP = ['#1a1228', '#3a2c58', '#5e4a8a', '#a090d0'];
RUINS.forEach((r, i) => { add('prop.ruin.' + i, 'world', null, null, { make: ruin(r), fps: 0 }); add('prop.ruin.void.' + i, 'world', null, null, { make: ruin(r, VOID_RAMP), fps: 0 }); });
const CRY = { teal: { c: '#c8ffe8', C: '#6ae0b8', D: '#2f9a88', E: '#1f5a5a' }, void: { c: '#f0d8ff', C: '#b78cff', D: '#7a4ad0', E: '#3a2270' } };
const SHROOM = Object.assign({}, HA.PAL, { g: '#1d5a44', G: '#46c88a', L: '#c9ffd9' });
add('prop.shroom.0', 'world', null, null, { ascii: [HA.PROP.shroomBig], pal: SHROOM, fps: 0 });
add('prop.shroom.1', 'world', null, null, { ascii: [HA.PROP.shroomSmall], pal: SHROOM, fps: 0 });
add('prop.crystal.0', 'world', null, null, { ascii: [HA.PROP.crystalBig], pal: Object.assign({}, HA.PAL, CRY.teal), fps: 0 });
add('prop.crystal.1', 'world', null, null, { ascii: [HA.PROP.crystalMid], pal: Object.assign({}, HA.PAL, CRY.teal), fps: 0 });
add('prop.crystal.void.0', 'world', null, null, { ascii: [HA.PROP.crystalBig], pal: Object.assign({}, HA.PAL, CRY.void), fps: 0 });
add('prop.crystal.void.1', 'world', null, null, { ascii: [HA.PROP.crystalMid], pal: Object.assign({}, HA.PAL, CRY.void), fps: 0 });
add('prop.obelisk', 'world', null, null, { ascii: [HA.PROP.obelisk], pal: HA.PAL, fps: 0 });

// cos.platino: derived from DawnLike's Platino (dl_re0/dl_re1 cell [48,192]), redrawn at 12x11 in its platinum, cream and cyan (DawnLike README asks that he hide somewhere in the game).
// Frame 1 = the head and ears bob 1 px down (feet fixed).
add('cos.platino', 'actors', null, null, {
  ascii: [[
    '...k...k....', '..kCk.kCk...', '..kSSkSSk...', '.kSSSSSSSk..', '.kSSSSkWDk..', '.kSSSSSSSSk.', 'kCkPPPSSkk..', 'kCSPPPPSSk..', '.kSSPPSSDk..', '..kDk.kDk...', '..kk..kk....'],
    ['............', '...k...k....', '..kCk.kCk...', '.kSSSSSSSk..', '.kSSSSkWDk..', '.kSSSSSSSSk.', 'kCkPPPSSkk..', 'kCSPPPPSSk..', '.kSSPPSSDk..', '..kDk.kDk...', '..kk..kk....']],
  pal: { k: '#222222', S: '#94aabb', D: '#566676', P: '#eef8e6', C: '#5fd8e0', W: '#a8fcff' }, fps: 2.5, loop: true, eye: 'auto',
});

// --------------------------------------------------------------------------- fx page: pickups, icons, projectiles, effects, font
add('pickup.coin', 'fx', 'ox', oxn('coin_anim', 4), { fps: 8, loop: true });
add('pickup.heart', 'fx', null, null, { ascii: [['.kk.kk.', 'kwrkrRk', 'krrrrRk', '.krrRk.', '..kRk..', '...k...']], pal: { k: '#4a0a18', w: '#ffe0e0', r: '#ff5468', R: '#c8202e' }, fps: 0 }); // 7x6, the size of the coin and the xp gem
add('pickup.flask.red', 'fx', 'ox', ['flask_big_red'], { fps: 0 }); add('pickup.flask.yellow', 'fx', 'ox', ['flask_big_yellow'], { fps: 0 });
const GEM = ['.kk.', 'kwck', 'kcCk', 'kcCk', 'kcCk', '.kCk', '..k.'];
add('pickup.xp', 'fx', null, null, { ascii: [GEM], pal: { k: '#12342c', w: '#ffffff', c: '#b4ffe9', C: '#34dcb0' }, fps: 0 });
// Run pickups (ARCHITECTURE §4 pickup k): gem tiers xp1 blue / xp5 green / xp25 red (same cut; the renderer scales the tiers), gold, food, magnet, holy bomb, chest.
add('pickup.xp1', 'fx', null, null, { ascii: [GEM], pal: { k: '#0e1c3a', w: '#ffffff', c: '#bce0ff', C: '#3a8cff' }, fps: 0 });
add('pickup.xp5', 'fx', null, null, { ascii: [GEM], pal: { k: '#0e3414', w: '#ffffff', c: '#ccffb8', C: '#3adc4a' }, fps: 0 });
add('pickup.xp25', 'fx', null, null, { ascii: [GEM], pal: { k: '#3a0e16', w: '#ffffff', c: '#ffc4cc', C: '#ff3a5a' }, fps: 0 });
add('pickup.gold', 'fx', null, null, { use: 'pickup.coin', fps: 8, loop: true });
add('pickup.food', 'fx', null, null, { ascii: [HA.PICK.food], pal: HA.PAL, fps: 0 });
add('pickup.magnet', 'fx', null, null, { ascii: [HA.PICK.magnet], pal: HA.PAL, fps: 0 });
add('pickup.bomb', 'fx', null, null, { ascii: HA.PICK.bomb, pal: HA.PAL, fps: 6, loop: true });
add('pickup.chest', 'fx', 'ox', ['chest_full_open_anim_f0'], { fps: 0 });
add('pickup.chest.open', 'fx', 'ox', oxn('chest_full_open_anim', 3), { fps: 8, loop: false });
// Icons (centre pivot): icon.w.<weaponId>, icon.p.<passiveId>; the longbow is drawn pointing left and mirrored here.
for (const [id, rows] of Object.entries(HA.W)) add('icon.w.' + id, 'fx', null, null, { ascii: [rows], pal: HA.PAL, pivot: 'centre', fps: 0, flip: id === 'longbow' });
for (const [id, rows] of Object.entries(HA.P)) add('icon.p.' + id, 'fx', null, null, { ascii: [rows], pal: HA.PAL, pivot: 'centre', fps: 0 });

const PR = (id, src, rect, dir, o) => add(id, 'fx', src, [rect], Object.assign({ pivot: 'centre', anchors: { dir }, fps: 0 }, o || {}));
PR('proj.arrow', 'nf_arrow', [0, 0, 13, 5], 90);
PR('proj.bolt', 'nf_arrow', [0, 0, 13, 5], 90, { ramp: ['#222222', '#5d6670', '#aeb8c0', '#e6edf2'], skip: ['#222222'] });
PR('proj.knife', 'nf_kunai', [0, 0, 14, 5], 90);
add('proj.fireball', 'fx', 'nf_fireball', strip(0, 0, 16, 16, 4), { pivot: 'centre', anchors: { dir: 315 }, fps: 12, loop: true });
PR('proj.hammer', 'ox', 'weapon_hammer', 0, { ramp: ['#222222', '#6b4a12', '#c8922a', '#ffd36b', '#fff2c0'], skip: ['#222222'] });
PR('proj.shield', 'dl_shield', [64, 0, 16, 16], 0);
PR('proj.bone', 'na_bone', [0, 0, 7, 8], 0);
PR('proj.trident', 'dl_longwep', [96, 0, 16, 16], 45);
PR('proj.skull', 'ox', 'skull', 0);
PR('proj.web', 'dl_decor0', [0, 304, 16, 16], 0);
add('proj.thorn', 'fx', 'nf_thorn', strip(0, 0, 24, 20, 4), { pivot: 'centre', anchors: { dir: 90 }, fps: 10, loop: true });

const FX = (id, src, rects, fps, loop, o) => add(id, 'fx', src, rects, Object.assign({ pivot: 'centre', fps, loop }, o || {}));
FX('fx.cut', 'nf_cut', strip(0, 0, 32, 32, 4), 24, false); FX('fx.cutx', 'nf_cutx', strip(0, 0, 32, 32, 4), 24, false); FX('fx.cslash', 'nf_cslash', strip(0, 0, 32, 32, 4), 24, false);
FX('fx.slash.arc', 'nf_arc', strip(0, 0, 38, 34, 6), 24, false);
FX('fx.slash.small', 'ol_slash', strip(0, 0, 16, 16, 3), 20, false); FX('fx.hit.spark', 'ol_hit', strip(0, 0, 8, 8, 3), 20, false);
FX('fx.explosion', 'nf_explosion', strip(0, 0, 40, 40, 9), 18, false); FX('fx.flam', 'nf_flam', strip(0, 0, 25, 30, 8), 16, false);
FX('fx.ice.burst', 'nf_iceb', strip(0, 0, 32, 32, 9), 16, false); FX('fx.thunder', 'nf_thunder', strip(0, 0, 20, 28, 8), 16, false);
FX('fx.circle.spark', 'nf_circle_spark', strip(0, 0, 32, 32, 6), 14, false); FX('fx.circle.white', 'nf_circle_white', strip(0, 0, 32, 32, 4), 14, false);
FX('fx.shield.gold', 'nf_shield_gold', strip(0, 0, 24, 26, 6), 12, true); FX('fx.spark.magic', 'nf_spark_magic', strip(0, 0, 30, 35, 9), 16, false);
FX('fx.smoke', 'nf_smoke', strip(0, 0, 32, 32, 6), 10, false); FX('fx.smoke.ring', 'nf_smoke_ring', strip(0, 0, 30, 14, 8), 14, false);
FX('fx.ember', 'nf_ember', strip(0, 0, 12, 12, 8), 12, true); FX('fx.glint', 'nf_glint', strip(0, 0, 10, 8, 7), 14, false);
FX('fx.flame', 'ext', strip(128, 340, 16, 14, 8), 12, true, { pivot: 'feet' });
const blast = (src) => Array.from({ length: 6 }, (_, i) => [(i % 3) * 32, Math.floor(i / 3) * 32, 32, 32]);
FX('fx.blast.red', 'aim_blast_red', blast(), 16, false); FX('fx.blast.blue', 'aim_blast_blue', blast(), 16, false);
FX('fx.foam', 'aim_foam', strip(256, 0, 64, 64, 6), 14, false);
FX('fx.ring.shock', 'an_ring', strip(0, 0, 32, 32, 7), 16, false); FX('fx.burst', 'an_burst', strip(0, 0, 48, 48, 7), 16, false);
FX('fx.puff', 'ol_puff', strip(0, 0, 16, 16, 4), 12, false);
add('fx.star.stun', 'fx', null, null, { ascii: [['..y..', '.yYy.', 'yYWYy', '.yYy.', '..y..']], pal: { y: '#e8a62a', Y: '#ffe066', W: '#ffffff' }, pivot: 'centre', fps: 0 });
add('fx.sigil.skull', 'fx', null, null, { ascii: [['.WWWWW.', 'WWWWWWW', 'WkkWkkW', 'WkkWkkW', '.WWkWW.', '.WkWkW.', '..WWW..']], pal: { W: '#e8d8ff', k: '#2a1840' }, pivot: 'centre', fps: 0 });
// fx.chain: one 8 px period of an iron chain running left to right (face-on ring, then an edge-on link into the next ring); repeat it every fw px along the chain.
add('fx.chain', 'fx', null, null, { ascii: [['.kkk....', 'kSsSkkkk', 'ksksSSSS', 'kSsSkkkk', '.kkk....']], pal: { k: '#222222', S: '#9aa6b0', s: '#5d6670' }, pivot: 'centre', anchors: { dir: 90 }, fps: 0 });
add('fx.glyph.corroded', 'fx', null, null, { ascii: [['ggggggg', 'gGGkGGg', 'gGkGGGg', 'gGGkGGg', '.gGkGg.', '..gkg..', '...g...']], pal: { g: '#3d6b12', G: '#9be33c', k: '#1a2a08' }, pivot: 'centre', fps: 0 });

// --------------------------------------------------------------------------- fxbig: CodeManu loops, 16 evenly sampled frames of the non-empty 100x100 cells
const BIG = (id, src) => add(id, 'fxbig', src, null, { sample: { cw: 100, ch: 100, n: 16 }, pivot: 'centre', fps: 12, loop: true });
BIG('fxbig.firespin', 'cm_firespin'); BIG('fxbig.protection', 'cm_protection'); BIG('fxbig.felspell', 'cm_felspell'); BIG('fxbig.midnight', 'cm_midnight'); BIG('fxbig.freezing', 'cm_freezing');

// --------------------------------------------------------------------------- font (white glyphs; 0x21..0x7e in ASCII order, 15 per row from space)
const fontCells = {};
for (let code = 0x21; code <= 0x7e; code++) { const i = code - 0x20; fontCells[String.fromCharCode(code)] = [i % 15, Math.floor(i / 15)]; }
// 'g' sits on the x-height of 'o' with a descender (the sheet's 'g' started a row higher, level with the digits, and read as a thin 9 in prices)
const font = { src: 'font8', page: 'fx', cw: 8, ch: 8, h: 8, gap: 1, space: 4, cells: fontCells, override: { g: ['........', '........', '.###....', '#...#...', '#...#...', '.####...', '....#...', '.###....'] } };

module.exports = { pages: ['world', 'actors', 'bosses', 'fx', 'fxbig'], tileList: '0x72/tile_list_v1.7', sheets, entries: E, swaps: Object.fromEntries(Object.entries(SWAPS).map(([k, v]) => [k, { key: v.key.map((c) => v.base[c] || c) }])), font };
