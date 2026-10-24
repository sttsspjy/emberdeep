'use strict';
// Declarative art manifest for tools/art.js: which source rects become which ED.ART anims (see ART-PLAN sections 4 and 5).
// Units are ART pixels (1 art px = 2 world px at draw time). Source sheets live under art-src/ (see art-src/SOURCES.md).
//
// ED.ART = { pages, frames, anims, pal, font, swaps }
//   anims[id] = { f: [frameId..], fps, loop, fw, fh, ax, ay, anchors: { hand, grip, tip, eye:[[x,y]..], centre, top, dir } }
//   fw x fh = logical frame; ax/ay = pivot inside it (feet for bodies/props/pickups, grip for weapons, centre for projectiles/fx, 0,0 for tiles).
//   frames[id] = { p: page, x, y, w, h, ox, oy }: trimmed rect in the page; ox/oy = its offset inside the logical frame.
//   Draw: x - ax + ox, y - ay + oy (art px). All anchor coordinates are in logical-frame px (origin top-left of fw x fh).
//   Anims of one `set` share the union bbox, so feet never jitter between idle/run/hit or between the four directions.
//   dir (weapons, projectiles): direction of the business end as drawn, degrees clockwise from screen-up (0 up, 45 up-right, 90 right, 180 down).
//   eye = heuristic single point (centre x, 30% below the top of the union bbox); pal[id] = unique colours sorted dark to light (not for fx.*).
//   Directions of foes (probe with ED.ART.anims): foe.<id>.<state> two-way (drawn facing right, mirror for left);
//   foe.<id>.<state>.<d|u|l|r> four-way (down, up, left, right); foe.<id>.<state>.<0..7> eight-way (source rows: 0 S, 1 SE, 2 E, 3 NE, 4 N, 5 NW, 6 W, 7 SW).
//   Every foe has `walk`; `idle` exists for 0x72 foes; `atk`/`cast`/`howl`/`death` where the source has them (howl: icewolf, lavahound).
//
// ----------------------------------------------------------------------------- ID LIST (one line per family; the exhaustive list is generated into ID-LIST.md)
// hero.<knight|ranger|pyro|shade|cleric|necro|bell>.<idle|run|hit>   0x72 bodies facing right: idle 4f, run 4f, hit 1f; anchors.hand = weapon pivot on the body (feet + 3,-6),
//                        anchors.head[frame] = hat seat; skins are runtime swaps: ED.ART.swaps['<cls>.<a|b|secret|unkindled>'] (same shape as swaps[cls])
// weapon.<id>            the 18 game weapons (longsword warhammer glaive longbow crossbow twinbows firestaff emberwand inferno daggers knives scythes mace dawnhammer lantern bonewand soulscythe plaguestaff) + bells bronzebell greatbell handbells; anchors.grip/tip/dir
// weapon.alt.<name>      Route-fork and foe weapons: big_hammer waraxe double_axe anime_sword katana duel_sword machete saw_sword throwing_axe rusty_sword cleaver
// shield.<wood|green|gold|round|kite|buckler|tower>   16x16 guard-side shields (DawnLike); proj.shield = the thrown kite shield (centre pivot)
// foe.<id>.<state>[.dir] all 46 foes (state walk always; idle/atk/cast/death where the source has them), direction rule above; imp/skeleton keep native colours, the rest take pal(def.col) at runtime
// boss.<id>.<state>      bonewarden: idle walk attack(8f) shield hit death | sporemother: idle walk attack charge hit | rimeheart: idle walk hit, attack.l attack.r charge.l charge.r (own pivots; centre/top/eye copied from idle)
//                        forgelord: idle walk hit | drownedking: idle walk attack1 attack2 attack3 hit death | hollowking: idle walk attack hit death, crown overlay boss.hollowking.crown
// tile.floor.<1..8>, tile.wall.{cap,face}.{left,mid,right}, tile.wall.side.{left,right}, tile.wall.outer.{top,front}.{left,right}, tile.wall.edge.<shape>, tile.wall.lip, tile.wall.auto.<col>.<row>,
//   tile.wall.{hole.1,hole.2,goo,goo.base}, tile.hole, tile.spikes(4f), tile.stairs, tile.door.{frame.left,frame.right,frame.top,leaf.closed,leaf.open}, tile.gate.bars (front view) / tile.gate.bars.side (E/W), tile.wall.grate,
//   tile.carpet.<red|beige>.{full,rug,run.fill,run.top,run.bot,band} (Sanctum),
//   tile.fountain.{top.1..3,mid.red,mid.blue,basin.red,basin.blue}(3f), tile.torch.{wall,floor}(8f), tile.torch.unlit, tile.dark.floor.<1..6>   (0x72 base set; per-biome recolour at runtime)
// prop.<chest.closed|chest.open|chest.empty|mimic.closed|mimic.open|plinth|plinth.stone|shrine.<0..4>|merchant|crate|bag|campfire|anvil|trial|portal|sign|column|column.wall>
// deco.<bones.0..4|skull|moss.0..2|candle.0..3|urn.0..5|mushroom.0..3|root.0..1|puddle.0..3|crystal.0..2|shard.0..2|shell.0..2|seaweed.0..1|coral.0..1|crate.0..1|pillarstub|chain|grate|banner.<blue|green|red|yellow>>
// pickup.<coin|heart|flask.red|flask.yellow|xp>; cos.<crown|platino|ghost|coin> wardrobe sprites
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
  ox_high: { file: '0x72/atlas_walls_high-16x32.png' },
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
  na_dungeon: { file: NA + 'Backgrounds/Tilesets/TilesetDungeon.png', outline: ['#141b1b'] },
  na_camp: { file: NA + 'Backgrounds/Tilesets/tileset_camp.png', outline: ['#141b1b'] },
  // Ninja bosses
  nb_bamboo_idle: { file: NA + 'Actor/Boss/GiantBamboo/Idle.png', outline: ['#141b1b'] },
  nb_bamboo_walk: { file: NA + 'Actor/Boss/GiantBamboo/Walk.png', outline: ['#141b1b'] },
  nb_bamboo_attack: { file: NA + 'Actor/Boss/GiantBamboo/Attack.png', outline: ['#141b1b'] },
  nb_bamboo_charge: { file: NA + 'Actor/Boss/GiantBamboo/Charge.png', outline: ['#141b1b'] },
  nb_bamboo_hit: { file: NA + 'Actor/Boss/GiantBamboo/Hit.png', outline: ['#141b1b'] },
  nb_sam_idle: { file: NA + 'Actor/Boss/GiantBlueSamurai/Idle.png', outline: ['#141b1b'] },
  nb_sam_walk: { file: NA + 'Actor/Boss/GiantBlueSamurai/Walk.png', outline: ['#141b1b'] },
  nb_sam_hit: { file: NA + 'Actor/Boss/GiantBlueSamurai/Hit.png', outline: ['#141b1b'] },
  nb_sam_attackl: { file: NA + 'Actor/Boss/GiantBlueSamurai/AttackLeft.png', outline: ['#141b1b'] },
  nb_sam_attackr: { file: NA + 'Actor/Boss/GiantBlueSamurai/AttackRight.png', outline: ['#141b1b'] },
  nb_sam_chargel: { file: NA + 'Actor/Boss/GiantBlueSamurai/ChargeLeft.png', outline: ['#141b1b'] },
  nb_sam_charger: { file: NA + 'Actor/Boss/GiantBlueSamurai/ChargeRight.png', outline: ['#141b1b'] },
  nb_cyc_idle: { file: NA + 'Actor/Boss/DemonCyclop/Idle.png', outline: ['#141b1b'] },
  nb_cyc_walk: { file: NA + 'Actor/Boss/DemonCyclop/Walk.png', outline: ['#141b1b'] },
  nb_cyc_hit: { file: NA + 'Actor/Boss/DemonCyclop/Hit.png', outline: ['#141b1b'] },
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
  dl_door0: { file: 'dawnlike/Objects/Door0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_door1: { file: 'dawnlike/Objects/Door1.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_ground0: { file: 'dawnlike/Objects/Ground0.png', outline: ['#140c1c'], edge: ['#452434'] },
  dl_music: { file: 'dawnlike/Items/Music.png', outline: ['#140c1c'], edge: ['#452434'] },
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
// Player-colour key colours and the exact palette swaps of ART-PLAN 4.1 are exported as ED.ART.swaps for the runtime recolour.
const HEAD_SKIP = { knight: ['#da4e38', '#ee8e2e'], bell: ['#9f294e', '#da4e38'] }; // plume / crest colours the hat seat ignores
const HEROES = { knight: 'knight_m', ranger: 'elf_f', pyro: 'wizzard_m', shade: 'elf_m', cleric: 'dwarf_m', necro: 'wizzard_f', bell: 'lizard_f' };
for (const [id, body] of Object.entries(HEROES)) {
  // hand = feet + (3,-6): torso height of the big-headed 0x72 bodies (the plan's -9 lands on the chin); head = per-frame hat seat (see art.js headAt)
  const set = 'hero.' + id, base = { page: 'actors', src: 'ox', set, handRel: [3, -6], head: HEAD_SKIP[id] || true };
  add(set + '.idle', 'actors', 'ox', oxn(body + '_idle_anim', 4), Object.assign({}, base, { fps: 6.67, loop: true }));
  add(set + '.run', 'actors', 'ox', oxn(body + '_run_anim', 4), Object.assign({}, base, { fps: 10, loop: true }));
  add(set + '.hit', 'actors', 'ox', [body + '_hit_anim_f0'], Object.assign({}, base, { fps: 0, loop: false }));
}
const SWAPS = {
  knight: { base: { '#72d6ce': '#c3ccd6', '#417089': '#5d6670' }, key: ['#da4e38', '#ee8e2e'] },
  ranger: { base: {}, key: ['#da4e38'] },
  pyro: { base: { '#5698cc': '#d8442a', '#5956bd': '#7a1f12' }, key: ['#8a503e'] },
  shade: { base: { '#4ba747': '#3a3550', '#3d734f': '#1f1b2e', '#facb3e': '#2a2440', '#ee8e2e': '#4a3a6a', '#5698cc': '#b78cff', '#fccba3': '#d8b0a0', '#e2b694': '#b08c80' }, key: ['#5698cc'] },
  cleric: { base: { '#da4e38': '#efe6cc', '#c38d70': '#c8a46a', '#775c55': '#a69a78', '#7b8994': '#ffd36b' }, key: ['#e46e33'] },
  necro: { base: { '#5698cc': '#2f4a42', '#5956bd': '#17261f', '#fdf7ed': '#b6ffe0', '#b58057': '#8a7a6a' }, key: ['#5956bd'] },
  bell: { base: { '#49a790': '#4fb8a4', '#417089': '#2a6a70', '#314152': '#1e3a44', '#d3bfa9': '#e0b070', '#8f4029': '#b0702e', '#62232f': '#6a3f1e' }, key: ['#9f294e', '#da4e38'] }, // verdigris scales, bronze belly and belt, crest = player colour
};
// Wardrobe skins: swaps['<cls>.<a|b|secret>'] = the hero's base swap with these colours replaced (same key colours); swaps['<cls>.unkindled'] = every
// non-outline, non-key colour of the hero's anims ranked by luminance onto ASH (resolved by art.js). The renderer recolours hero.<cls>.* through them.
const SKINS = {
  knight: { a: { '#72d6ce': '#7090e0', '#417089': '#2c3a78', '#fdf7ed': '#e6eeff' }, // cobalt
    b: { '#72d6ce': '#c0505a', '#417089': '#5e2030', '#fdf7ed': '#ffd8c8' }, // bloodsteel
    secret: { '#72d6ce': '#ffd36b', '#417089': '#2a2238', '#fdf7ed': '#ffffff' } }, // black and gold
  ranger: { a: { '#4ba747': '#c8763a', '#3d734f': '#7a3e22', '#facb3e': '#9a6a44', '#ee8e2e': '#6a4430' }, // autumn leather, brown hair
    b: { '#4ba747': '#5fa8d8', '#3d734f': '#2e5a8a', '#facb3e': '#f4f4f0', '#ee8e2e': '#b0b8c8', '#5698cc': '#7de8ff' }, // frostwood, silver hair
    secret: { '#4ba747': '#1f8a64', '#3d734f': '#0f4a34', '#facb3e': '#fff2c0', '#ee8e2e': '#e8b84a', '#5698cc': '#7dffd9', '#1f1833': '#ffd36b' } }, // emerald and gold, glowing eyes
  pyro: { a: { '#5698cc': '#f0a030', '#5956bd': '#a85a18' }, // saffron
    b: { '#5698cc': '#b04ad8', '#5956bd': '#5a1e7a', '#fdf7ed': '#ffe6f4', '#d3bfa9': '#d0a8c8' }, // violet pyre
    secret: { '#5698cc': '#fff2c0', '#5956bd': '#ff8a2a', '#fdf7ed': '#ffd36b', '#d3bfa9': '#e8641e' } }, // white-hot robe, burning beard
  shade: { a: { '#4ba747': '#6a2a3a', '#3d734f': '#3a121e', '#facb3e': '#3a1a22', '#ee8e2e': '#6a2a3a', '#314152': '#2a0e16' }, // crimson veil
    b: { '#4ba747': '#c8c8d8', '#3d734f': '#8a8aa8', '#facb3e': '#e8e8f0', '#ee8e2e': '#a8a8c0', '#314152': '#5a5a78' }, // ashwhite
    secret: { '#4ba747': '#2a1a4a', '#3d734f': '#140c24', '#facb3e': '#ffffff', '#ee8e2e': '#c8b0ff', '#fccba3': '#e8e0ff', '#e2b694': '#b8a8e0', '#314152': '#b78cff' } }, // void cloth, white hair, pale skin
  cleric: { a: { '#da4e38': '#c8ccd8', '#c38d70': '#8a96b0', '#7b8994': '#e0e8ff', '#775c55': '#5a6070' }, // silverbeard
    b: { '#da4e38': '#4a5a9a', '#c38d70': '#ffd36b', '#7b8994': '#fff2c0', '#775c55': '#2a3050' }, // midnight and gold
    secret: { '#da4e38': '#ffe066', '#c38d70': '#ff9a2a', '#7b8994': '#ffffff', '#775c55': '#8a3a12' } }, // sunfire beard
  necro: { a: { '#5698cc': '#7a2a36', '#d3bfa9': '#c89090', '#fdf7ed': '#ffe0e0', '#b58057': '#a08a80' }, // bloodbound
    b: { '#5698cc': '#cfc6a8', '#d3bfa9': '#8a8470', '#fdf7ed': '#3a3a40', '#b58057': '#9a8c80' }, // bone robe, black hair
    secret: { '#5698cc': '#7dffd9', '#d3bfa9': '#3ad6a8', '#fdf7ed': '#ffffff', '#b58057': '#c8d8d0' } }, // spectral mint
  bell: { a: { '#49a790': '#3a6ab0', '#417089': '#24407a', '#314152': '#162a50', '#d3bfa9': '#a8e0e8', '#8f4029': '#d8d0b0', '#62232f': '#8a8070' }, // deep sea
    b: { '#49a790': '#c8883a', '#417089': '#7a4a1e', '#314152': '#4a2a14', '#d3bfa9': '#7dffe8', '#8f4029': '#3a8a7a', '#62232f': '#1f4a44' }, // storm bronze
    secret: { '#49a790': '#e8f4ff', '#417089': '#8aa8d8', '#314152': '#4a5a8a', '#d3bfa9': '#ffd36b', '#8f4029': '#ffd36b', '#62232f': '#c8922a' } }, // thunderhead white and gold
};
const ASH = ['#3a3836', '#6a6662', '#a29d96', '#d6d0c6'];
for (const cls of Object.keys(SKINS)) {
  for (const s of ['a', 'b', 'secret']) SWAPS[cls + '.' + s] = { base: Object.assign({}, SWAPS[cls].base, SKINS[cls][s]), key: SWAPS[cls].key };
  SWAPS[cls + '.unkindled'] = { ash: ASH, key: SWAPS[cls].key };
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
boss('forgelord', [['idle', 'nb_cyc_idle', 50, 50, 5, 6, true], ['walk', 'nb_cyc_walk', 50, 50, 6, 9, true], ['hit', 'nb_cyc_hit', 50, 50, 3, 12, false]]);
boss('rimeheart', [['idle', 'nb_sam_idle', 96, 48, 6, 6, true], ['walk', 'nb_sam_walk', 96, 48, 6, 8, true], ['hit', 'nb_sam_hit', 96, 48, 4, 12, false]]);
// The samurai attack and charge sheets are 96x96 and each places the body at its own height: pivots are measured per anim as the hat position (#f1c471) of the anim against idle (idle pivot [47,48]).
// charge.l/charge.r f0 equal idle f0 shifted by (-1,+26)/(-2,+34); the crouching attacks align on the frame-mean hat (+29.75/+30.75 rows). centre/top/eye are copied from idle (translated) so the HP bar and eye glow do not move.
const RA = { anchorsFrom: 'boss.rimeheart.idle' };
boss('rimeheart', [['attack.l', 'nb_sam_attackl', 96, 96, 4, 10, false, Object.assign({ pivot: [45, 77] }, RA)], ['attack.r', 'nb_sam_attackr', 96, 96, 4, 10, false, Object.assign({ pivot: [47, 78] }, RA)],
  ['charge.l', 'nb_sam_chargel', 96, 96, 3, 8, false, Object.assign({ pivot: [46, 74] }, RA)], ['charge.r', 'nb_sam_charger', 96, 96, 3, 8, false, Object.assign({ pivot: [45, 82] }, RA)]], 'boss.rimeheart.atk');
add('boss.hollowking.crown', 'bosses', null, null, { ascii: [['y...y...y', 'yy.yyy.yy', 'yyyyyyyyy', 'yRyyBYyRy', 'ooooooooo']], pal: { y: '#ffd36b', Y: '#fff2c0', o: '#c8922a', R: '#d8442a', B: '#5fb8ff' }, stamp: true, fps: 0 });

// --------------------------------------------------------------------------- world: tiles, doors, torches, props, decor (page world)
const T = (id, name, o) => add(id, 'world', 'ox', [name], Object.assign({ pivot: 'tl', fps: 0 }, o || {}));
for (let i = 1; i <= 8; i++) T('tile.floor.' + i, 'floor_' + i);
for (const s of ['left', 'mid', 'right']) { T('tile.wall.cap.' + s, 'wall_top_' + s); T('tile.wall.face.' + s, 'wall_' + s); }
T('tile.wall.side.left', 'wall_outer_mid_left'); T('tile.wall.side.right', 'wall_outer_mid_right');
for (const s of ['top_left', 'top_right', 'front_left', 'front_right']) T('tile.wall.outer.' + s.replace('_', '.'), 'wall_outer_' + s);
for (const s of ['bottom_left', 'bottom_right', 'mid_left', 'mid_right', 'top_left', 'top_right', 'left', 'right', 'tshape_bottom_right', 'tshape_bottom_left', 'tshape_right', 'tshape_left']) T('tile.wall.edge.' + s.replace(/_/g, '.'), 'wall_edge_' + s);
add('tile.wall.lip', 'world', 'ox', [[32, 12, 16, 4]], { pivot: 'tl', fps: 0 });
T('tile.wall.hole.1', 'wall_hole_1'); T('tile.wall.hole.2', 'wall_hole_2'); T('tile.wall.goo', 'wall_goo'); T('tile.wall.goo.base', 'wall_goo_base');
// Autotile blocks of atlas_walls_high-16x32 (16x32 cells, left 12 columns; blank cells dropped): odd wall shapes.
for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) add('tile.wall.auto.' + c + '.' + r, 'world', 'ox_high', [[c * 16, r * 32, 16, 32]], { pivot: 'tl', fps: 0, optional: true });
T('tile.hole', 'hole'); T('tile.stairs', 'floor_stairs');
add('tile.spikes', 'world', 'ox', oxn('floor_spikes_anim', 4), { pivot: 'tl', fps: 8, loop: false });
T('tile.door.frame.left', 'doors_frame_left'); T('tile.door.frame.right', 'doors_frame_right'); T('tile.door.frame.top', 'doors_frame_top');
T('tile.door.leaf.closed', 'doors_leaf_closed'); T('tile.door.leaf.open', 'doors_leaf_open');
add('tile.gate.bars', 'world', 'dl_door0', [[0, 32, 16, 16]], { pivot: 'tl', fps: 0 }); // front view (north/south gates)
add('tile.gate.bars.side', 'world', 'dl_door0', [[16, 32, 16, 16]], { pivot: 'tl', fps: 0 }); // side view (east/west gates)
for (const c of ['red', 'blue']) {
  add('tile.fountain.mid.' + c, 'world', 'ox', oxn('wall_fountain_mid_' + c + '_anim', 3), { pivot: 'tl', fps: 6, loop: true });
  add('tile.fountain.basin.' + c, 'world', 'ox', oxn('wall_fountain_basin_' + c + '_anim', 3), { pivot: 'tl', fps: 6, loop: true });
}
for (let i = 1; i <= 3; i++) T('tile.fountain.top.' + i, 'wall_fountain_top_' + i);
add('tile.torch.wall', 'world', 'ext', strip(128, 354, 16, 22, 8), { pivot: 'tl', fps: 10, loop: true });
add('tile.torch.floor', 'world', 'ext', strip(128, 400, 16, 24, 8), { fps: 10, loop: true });
add('tile.torch.unlit', 'world', 'ext', [[256, 354, 16, 22]], { pivot: 'tl', fps: 0 });
[[32, 112], [48, 112], [64, 112], [32, 128], [48, 128], [64, 128]].forEach(([x, y], i) => add('tile.dark.floor.' + (i + 1), 'world', 'kos', [[x, y, 16, 16]], { pivot: 'tl', fps: 0 }));
for (const c of ['blue', 'red', 'green', 'yellow']) add('deco.banner.' + c, 'world', 'ox', ['wall_banner_' + c], { pivot: 'tl', fps: 0 });

const P = (id, src, rect, o) => add(id, 'world', src, [rect], Object.assign({ fps: 0 }, o || {}));
P('prop.column', 'ox', 'column'); P('prop.column.wall', 'ox', 'column_wall');
P('prop.chest.closed', 'ox', 'chest_full_open_anim_f0');
add('prop.chest.open', 'world', 'ox', oxn('chest_full_open_anim', 3), { fps: 8, loop: false });
add('prop.chest.empty', 'world', 'ox', oxn('chest_empty_open_anim', 3), { fps: 8, loop: false });
P('prop.mimic.closed', 'ox', 'chest_mimic_open_anim_f0');
add('prop.mimic.open', 'world', 'ox', oxn('chest_mimic_open_anim', 3), { fps: 8, loop: false });
add('prop.merchant', 'world', 'ox', oxn('doc_idle_anim', 4), { fps: 6.67, loop: true });
P('prop.crate', 'ox', 'crate'); P('prop.bag', 'ext', [322, 306, 12, 13]); P('prop.sign', 'ext', [321, 417, 14, 15]);
P('prop.campfire', 'na_camp', [160, 48, 32, 32]); P('prop.anvil', 'ken', [32, 96, 16, 16]); P('prop.trial', 'dl_decor0', [96, 160, 16, 16]);
add('prop.portal', 'world', null, null, { frames: [['dl_door0', [48, 80, 16, 16]], ['dl_door1', [48, 80, 16, 16]]], fps: 4, loop: true });
[48, 64, 80, 96, 112].forEach((x, i) => P('prop.shrine.' + i, 'na_dungeon', [x, 32, 16, 16]));
add('prop.plinth', 'world', null, null, { use: 'prop.shrine.0', fps: 0 });
P('prop.plinth.stone', 'na_dungeon', [32, 48, 16, 16]);

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
// Free-standing floor grate (the ext cell at 64,48 is a brick wall tile with a grate along its bottom: kept as tile.wall.grate).
add('deco.grate', 'world', null, null, { ascii: [['kkkkkkkkk', 'kObObObOk', 'kObGbGbOk', 'kObGbGbOk', 'kObObObOk', 'kkkkkkkkk']], pal: { k: '#1a1210', b: '#5a463a', O: '#c8501a', G: '#ffa83a' }, fps: 0 });
add('tile.wall.grate', 'world', 'ext', [[64, 48, 16, 16]], { pivot: 'tl', fps: 0 });
// Sanctum carpets (ext): rug = ragged 3x2-ish rug, full = 2x3 bordered carpet, run.* = runner pieces (plain / bordered top / bordered bottom, 16x16), band = 16x32 bordered both sides.
[['red', 16], ['beige', 64]].forEach(([c, x]) => {
  add('tile.carpet.' + c + '.full', 'world', 'ext', [[x, 272, 32, 48]], { pivot: 'tl', fps: 0 });
  add('tile.carpet.' + c + '.rug', 'world', 'ext', [[x, 320, 32, 48]], { pivot: 'tl', fps: 0 });
  add('tile.carpet.' + c + '.run.fill', 'world', 'ext', [[x + 32, 272, 16, 16]], { pivot: 'tl', fps: 0 });
  add('tile.carpet.' + c + '.run.top', 'world', 'ext', [[x + 32, 288, 16, 16]], { pivot: 'tl', fps: 0 });
  add('tile.carpet.' + c + '.run.bot', 'world', 'ext', [[x + 32, 304, 16, 16]], { pivot: 'tl', fps: 0 });
  add('tile.carpet.' + c + '.band', 'world', 'ext', [[x + 32, 320, 16, 32]], { pivot: 'tl', fps: 0 });
});
// Breakable crates (Cinderforge): iron-banded planks, an ember latch; the small one carries an X brace.
const CRATES = [
  ['kkkkkkkkkkk', 'kIiiiiiiiIk', 'kiWWdWWdWik', 'kiWWdWWdWik', 'kIiiioiiiIk', 'kiwwdwwdwik', 'kiwwdwwdwik', 'kiwwdwwdwik', 'kIiiiiiiiIk', 'kkkkkkkkkkk'],
  ['kkkkkkkkk', 'kIiiiiiIk', 'kidWWWdik', 'kiWdWdWik', 'kiWWoWWik', 'kiWdWdWik', 'kidWWWdik', 'kIiiiiiIk', 'kkkkkkkkk'],
];
CRATES.forEach((rows, i) => add('deco.crate.' + i, 'world', null, null, { ascii: [rows], pal: { k: '#1a1210', W: '#8a603a', w: '#5e3f27', d: '#3a2616', i: '#5c6074', I: '#9aa0b8', o: '#e8641e' }, fps: 0 }));
add('deco.chain', 'world', null, null, { ascii: [['.kk.', 'kSSk', 'kSSk', '.kk.', '.kk.', 'kSSk', 'kSSk', '.kk.', '.kk.', 'kSSk', 'kSSk', '.kk.']], pal: { k: '#222222', S: '#9aa6b0' }, fps: 0 });

// --------------------------------------------------------------------------- wardrobe cosmetics (page actors; cos.coin and fx.chain on the fx page)
// cos.crown: the Hollow King's crown cut to hat size; its pivot (bottom centre) goes on a hero anim's anchors.head[frame].
add('cos.crown', 'actors', null, null, { ascii: [['y..Y..y', 'yy.y.yy', 'yyyyyyy', 'yRyByRy', 'ooooooo']], pal: { y: '#ffd36b', Y: '#fff2c0', o: '#c8922a', R: '#d8442a', B: '#5fb8ff' }, stamp: true, fps: 0 });
// cos.platino: DawnLike's Platino (Reptile0/1 cell 3,12), native colours, two-frame idle like the DawnLike foes.
add('cos.platino', 'actors', null, null, { frames: [['dl_re0', [48, 192, 16, 16]], ['dl_re1', [48, 192, 16, 16]]], fps: 2.5, loop: true, eye: 'auto' });
// cos.ghost: a legless spectral delver for the camp (0x72 knight_f idle cut above the legs, cold ramp; the camp draws it translucent).
add('cos.ghost', 'actors', 'ox', strip(128, 68, 16, 26, 4), { fps: 4, loop: true, ramp: ['#2e4a7a', '#7aa8e0', '#c8e4ff', '#f4fcff'] });
add('pickup.coin', 'fx', 'ox', oxn('coin_anim', 4), { fps: 8, loop: true });
add('pickup.heart', 'fx', null, null, { ascii: [['.kk.kk.', 'kwrkrRk', 'krrrrRk', '.krrRk.', '..kRk..', '...k...']], pal: { k: '#4a0a18', w: '#ffe0e0', r: '#ff5468', R: '#c8202e' }, fps: 0 }); // 7x6, the size of the coin and the xp gem
add('pickup.flask.red', 'fx', 'ox', ['flask_big_red'], { fps: 0 }); add('pickup.flask.yellow', 'fx', 'ox', ['flask_big_yellow'], { fps: 0 });
add('pickup.xp', 'fx', null, null, { ascii: [['.kk.', 'kwck', 'kcCk', 'kcCk', 'kcCk', '.kCk', '..k.']], pal: { k: '#12342c', w: '#ffffff', c: '#b4ffe9', C: '#34dcb0' }, fps: 0 });
add('cos.coin', 'fx', null, null, { use: 'pickup.coin', pick: [0], fps: 0 }); // footprint coin: the gold pickup's face-on frame

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

module.exports = { pages: ['world', 'actors', 'bosses', 'fx', 'fxbig'], tileList: '0x72/tile_list_v1.7', sheets, entries: E, swaps: SWAPS, font };
