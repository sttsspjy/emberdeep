// Ascended boons: the upgrade of a maxed open or General boon, rarity 'a', merged into ED.BOONS as 'asc_<base>' (max 1, no path: never counts toward affinity, carries the base's weapon need).
// ED.ASCENDED[base] = { name, icon, desc, x: { stat: factor }, mods? }: x multiplies the stat block after every additive source (stats.js: s[stat] *= 1 + factor); mods add like a boon's.
// Offered from stratum ASC_STRATUM on level, room and epic offers (build.js W.ascCards): at most ASC_PER_STRATUM picks per stratum, one card pinned to slot 1.
(function (ED) {
  'use strict';
  ED.ASC_STRATUM = 4; ED.ASC_PER_STRATUM = 2;
  const A = ED.ASCENDED = {
    edge: { name: 'Honed Edge', icon: 'sword', desc: 'Your damage is multiplied by 1.15, after every other damage bonus.', x: { dmg: 0.15 } },
    quick: { name: 'Blur', icon: 'hand', desc: 'Your attack speed is multiplied by 1.15, after every other attack speed bonus.', x: { atk: 0.15 } },
    split: { name: 'Arrow Storm', icon: 'arrows', desc: '+1 projectile per attack, and your damage is multiplied by 1.1.', mods: { projN: 1 }, x: { dmg: 0.1 } },
    pierce: { name: 'Impaler', icon: 'arrow', desc: 'Projectiles pierce 2 more foes, and your damage is multiplied by 1.1.', mods: { pierce: 2 }, x: { dmg: 0.1 } },
    keen: { name: 'Hawk Eye', icon: 'eye', desc: 'Your crit chance is multiplied by 1.3.', x: { crit: 0.3 } },
    brutal: { name: 'Savage', icon: 'skull', desc: 'Your bonus crit damage is multiplied by 1.5.', x: { critDmg: 0.5 } },
    wide: { name: 'Vast', icon: 'arc', desc: 'Your area bonus is multiplied by 1.5.', x: { area: 0.5 } },
    vigor: { name: 'Titan', icon: 'heart', desc: 'Your max health is multiplied by 1.12.', x: { hpMul: 0.12 } },
    plating: { name: 'Bastion', icon: 'shield', desc: 'Your armor is multiplied by 1.5.', x: { armor: 0.5 } },
    lacerate: { name: 'Hemorrhage', icon: 'dagger', desc: 'Your bonus damage to bleeding foes is doubled.', x: { lacerate: 1 } },
    execute: { name: 'Headsman', icon: 'axe', desc: 'Your bonus damage to foes below 30% health is doubled.', x: { execute: 1 } },
    deepcuts: { name: 'Bloodletting', icon: 'blades', desc: 'Your bonus Bleed damage is multiplied by 1.5.', x: { bleedMul: 0.5 } },
  };
  ED.ASC_IDS = [];
  for (const base in A) {
    const a = A[base], id = 'asc_' + base, b = ED.BOONS[base];
    ED.BOONS[id] = { name: a.name, rar: 'a', icon: a.icon, desc: a.desc, mods: a.mods || {}, x: a.x, asc: base, max: 1 };
    if (b.need) ED.BOONS[id].need = b.need;
    ED.ASC_IDS.push(id);
  }
  ED.BOON_IDS = Object.keys(ED.BOONS);
})(globalThis.ED || (globalThis.ED = {}));
