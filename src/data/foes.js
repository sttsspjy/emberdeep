// Foe roster. ED.addFoe(id, def) registers ED.FOES[id]; registration order is the wire index (ED.FOE_IDS / ED.FOE_IDX): append only.
// def: { id, name, look (atlas anim prefix), dirs (2: look.walk + flip | 4: look.walk.d/u/l/r | 8: look.walk.0-7), ai (ED.AI brain; a missing brain falls back to 'chaser'),
//   hp (at 0:00, solo), spd (px/s), dmg (contact multiplier on the time curve), r (collision radius), xp (gem value: 1 | 5 | 25), kb (knockback taken, 0 immune),
//   brute, split {id, n:[min,max]}, range (ranged: stop distance), shot {dmg, speed, look, n, spread (rad between shots; ring: full circle), cd, wind} (ranged),
//   fuse (exploder wind-up s), boom {r, dmg, look} (exploder), charge {range, speed, dur, cd, wind} (charger), dive {hover, range, speed, dur, cd, wind} (diver),
//   slam {r, mul (x contact damage), cd, wind, ring {n, speed, look, dmg}, pull {r, str (px/s)}} (brute), pack [min, max] (spawns as a group; swarmers use the spawner PACK size by minute), scale (draw scale), boss, noElite,
//   take (damage taken factor, armour), guard {open (s), take} (charger: shield up except after a dash), summon {ids, n, r, cd, wind} (summoner), wall (march pack: spawns as a line, px between members),
//   blink {range, side, wind, slash, r, mul, cd} (blinker) }
// Shot and boom dmg are at 0:00 and grow with time (World.foeDmgK). Kinds (GAME-DESIGN §7): chaser, swarm, brute, ranged, exploder, splitter (chaser + split), diver, charger, summoner, march, blinker.
(function (ED) {
  'use strict';
  const F = ED.FOES = {}, IDS = ED.FOE_IDS = [], IDX = ED.FOE_IDX = {};
  const add = ED.addFoe = (id, o) => {
    if (!F[id]) { IDX[id] = IDS.length; IDS.push(id); }
    F[id] = Object.assign({ id, idx: IDX[id], name: id, look: 'foe.' + id, dirs: 2, ai: 'chaser', hp: 36, spd: 36, dmg: 1, r: 7, xp: 1, kb: 1 }, o);
    return F[id];
  };
  const SLAM = (r, o) => Object.assign({ r, mul: 1.6, cd: 3.2, wind: 0.9 }, o);
  const CHARGE = (o) => Object.assign({ range: 220, speed: 255, dur: 0.55, cd: 3.9, wind: 0.7 }, o);
  const DIVE = (o) => Object.assign({ hover: 120, range: 200, speed: 240, dur: 0.5, cd: 4.4, wind: 0.65 }, o);

  // ---- stage 1: Ossuary ----
  add('bat', { name: 'Crypt Bat', dirs: 4, ai: 'swarm', hp: 15, spd: 64, dmg: 0.8, r: 6 });
  add('skeleton', { name: 'Skeleton', hp: 36, spd: 37, r: 7 });
  add('slime', { name: 'Grave Slime', dirs: 4, hp: 60, spd: 30, r: 8, split: { id: 'slimelet', n: [2, 3] } });
  add('slimelet', { name: 'Slimelet', dirs: 2, ai: 'swarm', hp: 18, spd: 50, dmg: 0.8, r: 5, solo: true });
  add('bonearcher', { name: 'Bone Archer', ai: 'ranged', hp: 42, spd: 32, r: 7, range: 160, shot: { dmg: 5, speed: 128, look: 'bone', n: 1, spread: 0, cd: 3, wind: 0.7 } });
  add('sporepuff', { name: 'Spore Puff', ai: 'exploder', hp: 30, spd: 46, r: 7, fuse: 0.7, boom: { r: 46, dmg: 11, look: 'poison' } });
  add('skelknight', { name: 'Skeleton Knight', ai: 'brute', hp: 300, spd: 24, dmg: 1.5, r: 12, xp: 5, kb: 0, brute: true, slam: SLAM(52) });

  // ---- stage 2: Glowmire ----
  add('glowlet', { name: 'Glowlet', ai: 'swarm', hp: 18, spd: 61, dmg: 0.8, r: 5 });
  add('myconid', { name: 'Myconid', dirs: 4, hp: 36, spd: 35, r: 7 });
  add('glowslime', { name: 'Glow Slime', dirs: 4, hp: 60, spd: 30, r: 8, split: { id: 'glowlet', n: [2, 3] } });
  add('spitter', { name: 'Spitcap', dirs: 4, ai: 'ranged', hp: 48, spd: 27, r: 7, range: 180, shot: { dmg: 4, speed: 119, look: 'poison', n: 3, spread: 0.24, cd: 3.4, wind: 0.75 } });
  add('cavespider', { name: 'Cave Spider', dirs: 8, ai: 'charger', pack: [2, 3], hp: 42, spd: 46, r: 8, charge: CHARGE({ range: 230, speed: 270, dur: 0.5, cd: 3.9, wind: 0.7 }) });
  add('shroomhulk', { name: 'Shroom Hulk', ai: 'brute', hp: 360, spd: 22, dmg: 1.5, r: 13, xp: 5, kb: 0, brute: true, slam: SLAM(58, { cd: 3.4 }) });

  // ---- stage 3: Abyss ----
  add('starspawn', { name: 'Starspawn', ai: 'swarm', hp: 18, spd: 67, dmg: 0.8, r: 6 });
  add('shade', { name: 'Shade', dirs: 4, hp: 42, spd: 42, r: 7 });
  add('jelly', { name: 'Lantern Jelly', hp: 72, spd: 32, r: 8, split: { id: 'jellet', n: [2, 3] } });
  add('jellet', { name: 'Jellet', ai: 'swarm', hp: 21, spd: 56, dmg: 0.8, r: 5, solo: true });
  add('voidwraith', { name: 'Void Wraith', ai: 'ranged', hp: 54, spd: 34, r: 7, range: 190, shot: { dmg: 5, speed: 140, look: 'skull', n: 1, spread: 0, cd: 2.6, wind: 0.7 } });
  add('horror', { name: 'Abyssal Horror', ai: 'brute', hp: 420, spd: 24, dmg: 1.6, r: 14, xp: 5, kb: 0, brute: true, slam: SLAM(60, { ring: { n: 10, speed: 102, look: 'skull', dmg: 5 } }) });

  // ---- bosses (ai 'boss' dispatches ED.Bosses[id]; HP from GAME-DESIGN §8, hp here is unused) ----
  const boss = (id, name, look, r, spd) => add(id, { name, look, ai: 'boss', boss: true, hp: 0, spd, dmg: 2, r, xp: 25, kb: 0, noElite: true });
  boss('warden', 'Bone Warden', 'boss.bonewarden', 22, 38);
  boss('spore', 'Sporemother', 'boss.sporemother', 24, 24);
  boss('king', 'Drowned King', 'boss.drownedking', 24, 35);
  boss('hollow', 'Hollow King', 'boss.hollowking', 22, 42);
  boss('twins', 'The Twins', 'foe.skelknight', 18, 45);
  boss('cyclops', 'Demon Cyclops', 'boss.cyclops', 26, 32);
  boss('samurai', 'Blue Samurai', 'boss.samurai', 22, 46);

  // ---- appended roster (wire index follows registration) ----
  // stage 1: Ossuary
  add('drowned', { name: 'Ghoul', hp: 66, spd: 30, dmg: 1.2, r: 8 });
  add('priest', { name: 'Bone Priest', ai: 'ranged', hp: 48, spd: 30, r: 7, range: 170, shot: { dmg: 4, speed: 128, look: 'skull', n: 1, spread: 0, cd: 2.8, wind: 0.7 } });
  add('imp', { name: 'Pit Imp', ai: 'exploder', hp: 30, spd: 51, r: 7, fuse: 0.7, boom: { r: 44, dmg: 10, look: 'fire' } });
  add('icewolf', { name: 'Grave Hound', dirs: 8, ai: 'charger', pack: [2, 4], hp: 54, spd: 43, r: 8, charge: CHARGE() });
  add('frostwisp', { name: 'Grave Wisp', dirs: 4, ai: 'diver', pack: [3, 5], hp: 24, spd: 56, dmg: 0.9, r: 6, dive: DIVE() });
  // stage 2: Glowmire
  add('reaver', { name: 'Bog Reaver', dirs: 4, hp: 72, spd: 38, dmg: 1.3, r: 8 });
  add('drone', { name: 'Marsh Light', dirs: 4, ai: 'diver', pack: [3, 5], hp: 27, spd: 58, dmg: 0.9, r: 6, dive: DIVE({ hover: 130, speed: 255 }) });
  // stage 3: Abyss
  add('riftcaller', { name: 'Rift Caller', dirs: 4, ai: 'ranged', hp: 66, spd: 29, r: 7, range: 200, shot: { dmg: 5, speed: 94, look: 'skull', n: 8, spread: 'ring', cd: 4.2, wind: 0.9 } });
  add('gloom', { name: 'Gloom', ai: 'exploder', hp: 36, spd: 53, r: 7, fuse: 0.7, boom: { r: 52, dmg: 12, look: 'shadow' } });
  add('eel', { name: 'Gloom Eel', ai: 'charger', pack: [2, 3], hp: 54, spd: 46, r: 8, charge: CHARGE({ range: 240, speed: 300, dur: 0.5, cd: 3.6, wind: 0.65 }) });
  add('voideye', { name: 'Void Eye', dirs: 4, ai: 'diver', pack: [3, 5], hp: 30, spd: 59, dmg: 1, r: 6, dive: DIVE({ hover: 140, speed: 270, cd: 3.9 }) });
  // boss parts and bodies registered by boss-spore / boss-twins / boss-weaver / boss-wickeater: their wire indices are held here, those files fill the defs
  for (const id of ['sporepod', 'twinhammer', 'weaver', 'wickeater']) add(id, { boss: true, noElite: true });
  // tier foes (GAME-DESIGN §7): each stage adds one kind at 5:00 and one at 10:00
  add('bulwark', { name: 'Bone Bulwark', ai: 'charger', hp: 90, spd: 30, dmg: 1.2, r: 8, kb: 0.3, take: 0.35, guard: { open: 1.6, take: 1.3 }, charge: CHARGE({ range: 150, speed: 210, dur: 0.4, cd: 4.6, wind: 0.8 }) });
  add('bonecaller', { name: 'Bone Caller', ai: 'summoner', hp: 80, spd: 26, r: 8, xp: 5, range: 210, summon: { ids: ['skeleton'], n: 3, r: 30, cd: 8, wind: 1.0 } });
  add('bloater', { name: 'Bog Bloater', hp: 120, spd: 22, dmg: 1.2, r: 11, scale: 1.4, split: { id: 'bloatling', n: [2, 2] } });
  add('bloatling', { name: 'Bloatling', hp: 36, spd: 34, r: 7, solo: true, split: { id: 'glowlet', n: [2, 3] } });
  add('mirecrab', { name: 'Mire Crab', ai: 'march', hp: 260, spd: 20, dmg: 1.4, r: 11, xp: 5, kb: 0, take: 0.7, pack: [3, 4], wall: 26, scale: 1.5 });
  add('stalker', { name: 'Rift Stalker', ai: 'blinker', pack: [2, 3], hp: 60, spd: 42, r: 7, blink: { range: 230, side: 36, wind: 0.7, slash: 0.6, r: 34, mul: 1.5, cd: 5.5 } });
  add('colossus', { name: 'Void Colossus', ai: 'brute', hp: 520, spd: 20, dmg: 1.6, r: 15, xp: 5, kb: 0, take: 0.8, brute: true, slam: SLAM(64, { wind: 1.2, cd: 4.2, pull: { r: 150, str: 45 } }) });
})(globalThis.ED || (globalThis.ED = {}));
