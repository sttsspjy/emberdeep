// Twists: playstyle rules with a printed cost, rarity 't', merged into ED.BOONS under their own id (max 1, no path). At most ED.TWIST_MAX per run.
// ED.TWISTS[id] = { name, icon, desc, cost (the red cost line), mods }.
(function (ED) {
  'use strict';
  ED.TWIST_MAX = 2;
  const T = ED.TWISTS = {};
  ED.TWIST_IDS = [];
  for (const id in T) { const t = T[id]; ED.BOONS[id] = { name: t.name, rar: 't', icon: t.icon, desc: t.desc, cost: t.cost, mods: t.mods || {}, twist: true, max: 1 }; ED.TWIST_IDS.push(id); }
  ED.BOON_IDS = Object.keys(ED.BOONS);
})(globalThis.ED || (globalThis.ED = {}));
