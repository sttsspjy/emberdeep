// Foe roster. ED.addFoe(id, def) registers ED.FOES[id]; registration order is the wire index (ED.FOE_IDS / ED.FOE_IDX): append only.
// def: { id, name, look (atlas anim prefix), dirs (2: look.walk + flip | 4: look.walk.d/u/l/r | 8: look.walk.0-7), ai (ED.AI brain; a missing brain falls back to 'chaser'),
//   hp (at 0:00, solo), spd (px/s), dmg (contact multiplier on the time curve), r (collision radius), xp (gem value: 1 | 5 | 25), kb (knockback taken, 0 immune),
//   brute, split {id, n:[min,max]}, range (ranged: stop distance), shot {dmg, speed, look} (ranged), fuse (exploder wind-up s), boom {r, dmg} (exploder), scale (draw scale), boss, noElite }
(function (ED) {
  'use strict';
  const F = ED.FOES = {}, IDS = ED.FOE_IDS = [], IDX = ED.FOE_IDX = {};
  const add = ED.addFoe = (id, o) => {
    if (!F[id]) { IDX[id] = IDS.length; IDS.push(id); }
    F[id] = Object.assign({ id, idx: IDX[id], name: id, look: 'foe.' + id, dirs: 2, ai: 'chaser', hp: 12, spd: 45, dmg: 1, r: 7, xp: 1, kb: 1 }, o);
    return F[id];
  };

  // ---- stage 1: Ossuary ----
  add('bat', { name: 'Crypt Bat', dirs: 4, ai: 'swarm', hp: 5, spd: 78, dmg: 0.8, r: 6 });
  add('skeleton', { name: 'Skeleton', hp: 12, spd: 46, r: 7 });
  add('slime', { name: 'Grave Slime', dirs: 4, hp: 20, spd: 38, r: 8, split: { id: 'slimelet', n: [2, 3] } });
  add('slimelet', { name: 'Slimelet', dirs: 2, ai: 'swarm', hp: 6, spd: 62, dmg: 0.8, r: 5 });
  add('bonearcher', { name: 'Bone Archer', ai: 'ranged', hp: 14, spd: 40, r: 7, range: 160, shot: { dmg: 6, speed: 150, look: 'bone' } });
  add('sporepuff', { name: 'Spore Puff', ai: 'exploder', hp: 10, spd: 56, r: 7, fuse: 0.7, boom: { r: 40, dmg: 10 } });
  add('skelknight', { name: 'Skeleton Knight', ai: 'brute', hp: 100, spd: 32, dmg: 1.5, r: 12, xp: 5, kb: 0, brute: true });

  // ---- stage 2: Glowmire ----
  add('glowlet', { name: 'Glowlet', ai: 'swarm', hp: 6, spd: 76, dmg: 0.8, r: 5 });
  add('myconid', { name: 'Myconid', dirs: 4, hp: 14, spd: 44, r: 7 });
  add('glowslime', { name: 'Glow Slime', dirs: 4, hp: 22, spd: 38, r: 8, split: { id: 'glowlet', n: [2, 3] } });
  add('spitter', { name: 'Spitcap', dirs: 4, ai: 'ranged', hp: 16, spd: 36, r: 7, range: 170, shot: { dmg: 7, speed: 140, look: 'poison' } });
  add('cavespider', { name: 'Cave Spider', dirs: 8, hp: 12, spd: 64, r: 8 });
  add('shroomhulk', { name: 'Shroom Hulk', ai: 'brute', hp: 110, spd: 30, dmg: 1.5, r: 13, xp: 5, kb: 0, brute: true });

  // ---- stage 3: Abyss ----
  add('starspawn', { name: 'Starspawn', ai: 'swarm', hp: 6, spd: 84, dmg: 0.8, r: 6 });
  add('shade', { name: 'Shade', dirs: 4, hp: 16, spd: 50, r: 7 });
  add('jelly', { name: 'Lantern Jelly', hp: 24, spd: 40, r: 8, split: { id: 'jellet', n: [2, 3] } });
  add('jellet', { name: 'Jellet', ai: 'swarm', hp: 7, spd: 70, dmg: 0.8, r: 5 });
  add('voidwraith', { name: 'Void Wraith', ai: 'ranged', hp: 18, spd: 42, r: 7, range: 180, shot: { dmg: 8, speed: 160, look: 'skull' } });
  add('horror', { name: 'Abyssal Horror', ai: 'brute', hp: 130, spd: 30, dmg: 1.6, r: 14, xp: 5, kb: 0, brute: true });

  // ---- bosses (ai 'boss' dispatches ED.Bosses[id]; HP from GAME-DESIGN §8, hp here is unused) ----
  const boss = (id, name, look, r, spd) => add(id, { name, look, ai: 'boss', boss: true, hp: 0, spd, dmg: 2, r, xp: 25, kb: 0, noElite: true });
  boss('warden', 'Bone Warden', 'boss.bonewarden', 22, 48);
  boss('spore', 'Sporemother', 'boss.sporemother', 24, 30);
  boss('king', 'Drowned King', 'boss.drownedking', 24, 44);
  boss('hollow', 'Hollow King', 'boss.hollowking', 22, 52);
  boss('twins', 'The Twins', 'foe.skelknight', 18, 56);
  boss('cyclops', 'Demon Cyclops', 'boss.cyclops', 26, 40);
  boss('samurai', 'Blue Samurai', 'boss.samurai', 22, 58);

})(globalThis.ED || (globalThis.ED = {}));
