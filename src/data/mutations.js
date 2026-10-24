// Mutations: a 1-of-2 variant of an owned keystone or evolution, rarity 'm', merged into ED.BOONS as 'mut_<id>' (max 1, no path: never counts toward affinity).
// ED.MUTATIONS[id] = { of: keystone or evolution boon id, name, icon, desc, mods }: two entries per keystone and evolution; holding one locks out its sibling.
(function (ED) {
  'use strict';
  const M = ED.MUTATIONS = {};
  ED.MUT_IDS = [];
  for (const id in M) { const m = M[id], bid = 'mut_' + id; ED.BOONS[bid] = { name: m.name, rar: 'm', icon: m.icon, desc: m.desc, mods: m.mods || {}, mut: m.of, max: 1 }; ED.MUT_IDS.push(bid); }
  ED.BOON_IDS = Object.keys(ED.BOONS);
})(globalThis.ED || (globalThis.ED = {}));
