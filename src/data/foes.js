// Foe roster. ED.addFoe(id, def) registers ED.FOES[id]; registration order is the wire index (ED.FOE_IDS / ED.FOE_IDX): append only.
// def: { id, name, look (atlas anim prefix), dirs (2: look.walk + flip | 4: look.walk.d/u/l/r | 8: look.walk.0-7), ai (ED.AI brain; a missing brain falls back to 'chaser'),
//   hp (at 0:00, solo), spd (px/s), dmg (contact multiplier on the time curve), r (collision radius), xp (gem value: 1 | 5 | 25), kb (knockback taken, 0 immune),
//   brute, split {id, n:[min,max]}, range (ranged: stop distance), shot {dmg, speed, look, n, spread (rad between shots; ring: full circle), cd, wind} (ranged),
//   fuse (exploder wind-up s), boom {r, dmg, look} (exploder), charge {range, speed, dur, cd, wind} (charger), dive {hover, range, speed, dur, cd, wind} (diver),
//   slam {r, mul (x contact damage), cd, wind, ring {n, speed, look, dmg}} (brute), pack [min, max] (spawns as a group; swarmers default to 12-30), scale (draw scale), boss, noElite }
// Shot and boom dmg are at 0:00 and grow with time (World.foeDmgK). Kinds (GAME-DESIGN §7): chaser, swarm, brute, ranged, exploder, splitter (chaser + split), diver, charger.
(function (ED) {
  'use strict';
  const F = ED.FOES = {}, IDS = ED.FOE_IDS = [], IDX = ED.FOE_IDX = {};
  const add = ED.addFoe = (id, o) => {
    if (!F[id]) { IDX[id] = IDS.length; IDS.push(id); }
    F[id] = Object.assign({ id, idx: IDX[id], name: id, look: 'foe.' + id, dirs: 2, ai: 'chaser', hp: 12, spd: 45, dmg: 1, r: 7, xp: 1, kb: 1 }, o);
    return F[id];
  };
  const SLAM = (r, o) => Object.assign({ r, mul: 1.6, cd: 3.2, wind: 0.9 }, o);
  const CHARGE = (o) => Object.assign({ range: 220, speed: 340, dur: 0.55, cd: 3.0, wind: 0.7 }, o);
  const DIVE = (o) => Object.assign({ hover: 120, range: 200, speed: 320, dur: 0.5, cd: 3.4, wind: 0.65 }, o);

  // ---- stage 1: Ossuary ----
  add('bat', { name: 'Crypt Bat', dirs: 4, ai: 'swarm', hp: 5, spd: 80, dmg: 0.8, r: 6 });
  add('skeleton', { name: 'Skeleton', hp: 12, spd: 46, r: 7 });
  add('slime', { name: 'Grave Slime', dirs: 4, hp: 20, spd: 38, r: 8, split: { id: 'slimelet', n: [2, 3] } });
  add('slimelet', { name: 'Slimelet', dirs: 2, ai: 'swarm', hp: 6, spd: 62, dmg: 0.8, r: 5, solo: true });
  add('bonearcher', { name: 'Bone Archer', ai: 'ranged', hp: 14, spd: 40, r: 7, range: 160, shot: { dmg: 6, speed: 150, look: 'bone', n: 1, spread: 0, cd: 3, wind: 0.7 } });
  add('sporepuff', { name: 'Spore Puff', ai: 'exploder', hp: 10, spd: 58, r: 7, fuse: 0.7, boom: { r: 46, dmg: 11, look: 'poison' } });
  add('skelknight', { name: 'Skeleton Knight', ai: 'brute', hp: 100, spd: 30, dmg: 1.5, r: 12, xp: 5, kb: 0, brute: true, slam: SLAM(52) });

  // ---- stage 2: Glowmire ----
  add('glowlet', { name: 'Glowlet', ai: 'swarm', hp: 6, spd: 76, dmg: 0.8, r: 5 });
  add('myconid', { name: 'Myconid', dirs: 4, hp: 14, spd: 44, r: 7 });
  add('glowslime', { name: 'Glow Slime', dirs: 4, hp: 22, spd: 38, r: 8, split: { id: 'glowlet', n: [2, 3] } });
  add('spitter', { name: 'Spitcap', dirs: 4, ai: 'ranged', hp: 16, spd: 34, r: 7, range: 180, shot: { dmg: 6, speed: 140, look: 'poison', n: 3, spread: 0.24, cd: 3.4, wind: 0.75 } });
  add('cavespider', { name: 'Cave Spider', dirs: 8, ai: 'charger', pack: [2, 3], hp: 16, spd: 58, r: 8, charge: CHARGE({ range: 230, speed: 360, dur: 0.5, cd: 2.6, wind: 0.65 }) });
  add('shroomhulk', { name: 'Shroom Hulk', ai: 'brute', hp: 120, spd: 28, dmg: 1.5, r: 13, xp: 5, kb: 0, brute: true, slam: SLAM(58, { cd: 3.4 }) });

  // ---- stage 3: Abyss ----
  add('starspawn', { name: 'Starspawn', ai: 'swarm', hp: 6, spd: 84, dmg: 0.8, r: 6 });
  add('shade', { name: 'Shade', dirs: 4, hp: 16, spd: 52, r: 7 });
  add('jelly', { name: 'Lantern Jelly', hp: 24, spd: 40, r: 8, split: { id: 'jellet', n: [2, 3] } });
  add('jellet', { name: 'Jellet', ai: 'swarm', hp: 7, spd: 70, dmg: 0.8, r: 5, solo: true });
  add('voidwraith', { name: 'Void Wraith', ai: 'ranged', hp: 18, spd: 42, r: 7, range: 190, shot: { dmg: 8, speed: 165, look: 'skull', n: 1, spread: 0, cd: 2.6, wind: 0.7 } });
  add('horror', { name: 'Abyssal Horror', ai: 'brute', hp: 140, spd: 30, dmg: 1.6, r: 14, xp: 5, kb: 0, brute: true, slam: SLAM(60, { ring: { n: 10, speed: 120, look: 'skull', dmg: 6 } }) });

  // ---- bosses (ai 'boss' dispatches ED.Bosses[id]; HP from GAME-DESIGN §8, hp here is unused) ----
  const boss = (id, name, look, r, spd) => add(id, { name, look, ai: 'boss', boss: true, hp: 0, spd, dmg: 2, r, xp: 25, kb: 0, noElite: true });
  boss('warden', 'Bone Warden', 'boss.bonewarden', 22, 48);
  boss('spore', 'Sporemother', 'boss.sporemother', 24, 30);
  boss('king', 'Drowned King', 'boss.drownedking', 24, 44);
  boss('hollow', 'Hollow King', 'boss.hollowking', 22, 52);
  boss('twins', 'The Twins', 'foe.skelknight', 18, 56);
  boss('cyclops', 'Demon Cyclops', 'boss.cyclops', 26, 40);
  boss('samurai', 'Blue Samurai', 'boss.samurai', 22, 58);

  // ---- appended roster (wire index follows registration) ----
  // stage 1: Ossuary
  add('drowned', { name: 'Ghoul', hp: 22, spd: 38, dmg: 1.2, r: 8 });
  add('priest', { name: 'Bone Priest', ai: 'ranged', hp: 16, spd: 38, r: 7, range: 170, shot: { dmg: 6, speed: 150, look: 'skull', n: 1, spread: 0, cd: 2.8, wind: 0.7 } });
  add('imp', { name: 'Pit Imp', ai: 'exploder', hp: 10, spd: 64, r: 7, fuse: 0.7, boom: { r: 44, dmg: 10, look: 'fire' } });
  add('icewolf', { name: 'Grave Hound', dirs: 8, ai: 'charger', pack: [2, 4], hp: 18, spd: 54, r: 8, charge: CHARGE() });
  add('frostwisp', { name: 'Grave Wisp', dirs: 4, ai: 'diver', pack: [3, 5], hp: 8, spd: 70, dmg: 0.9, r: 6, dive: DIVE() });
  // stage 2: Glowmire
  add('reaver', { name: 'Bog Reaver', dirs: 4, hp: 30, spd: 48, dmg: 1.3, r: 8 });
  add('drone', { name: 'Marsh Light', dirs: 4, ai: 'diver', pack: [3, 5], hp: 9, spd: 72, dmg: 0.9, r: 6, dive: DIVE({ hover: 130, speed: 340 }) });
  // stage 3: Abyss
  add('riftcaller', { name: 'Rift Caller', dirs: 4, ai: 'ranged', hp: 22, spd: 36, r: 7, range: 200, shot: { dmg: 7, speed: 110, look: 'skull', n: 8, spread: 'ring', cd: 4.2, wind: 0.9 } });
  add('gloom', { name: 'Gloom', ai: 'exploder', hp: 12, spd: 66, r: 7, fuse: 0.7, boom: { r: 52, dmg: 12, look: 'shadow' } });
  add('eel', { name: 'Gloom Eel', ai: 'charger', pack: [2, 3], hp: 20, spd: 58, r: 8, charge: CHARGE({ range: 240, speed: 400, dur: 0.5, cd: 2.4, wind: 0.65 }) });
  add('voideye', { name: 'Void Eye', dirs: 4, ai: 'diver', pack: [3, 5], hp: 10, spd: 74, dmg: 1, r: 6, dive: DIVE({ hover: 140, speed: 360, cd: 3 }) });
})(globalThis.ED || (globalThis.ED = {}));
