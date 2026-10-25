// Twists: playstyle rules with a printed cost, rarity 't', merged into ED.BOONS under their own id (max 1, no path). At most ED.TWIST_MAX per run.
// ED.TWISTS[id] = { name, icon, desc, cost (the red cost line), mods, gates (the element gates a hero needs to be offered it) }. ED.TWIST_C holds every number the cards print and src/sim/twist.js applies.
(function (ED) {
  'use strict';
  ED.TWIST_MAX = 2;
  // BLOOD: health a Bloodprice cast costs (share of max HP); GAP: seconds between two casts of one skill slot under Bloodprice.
  // METRO_N: attacks per Metronome bar; METRO_HI / METRO_LO: damage factor of the bar's last attack / of the others. PYRE: Pacifist's Pyre status build-up factor of a weapon hit.
  const C = ED.TWIST_C = { BLOOD: 0.04, GAP: 0.25, METRO_N: 4, METRO_HI: 3, METRO_LO: 0.8, PYRE: 3 };
  const pct = (v) => Math.round(v * 100) + '%';
  const T = ED.TWISTS = {
    bloodprice: { name: 'Bloodprice', icon: 'heartbroken', desc: `Your skills have no cooldown: each skill casts again ${C.GAP} s after its last cast.`, cost: `Each cast costs ${pct(C.BLOOD)} of your max health (it never takes your last health point).`, mods: { twBlood: 1 } },
    metronome: { name: 'Metronome', icon: 'drum', desc: `Every ${C.METRO_N}th attack deals ×${C.METRO_HI} damage with each of its hits.`, cost: `Your other attacks deal ×${C.METRO_LO} damage.`, mods: { twMetro: 1 } },
    pacifist: { name: "Pacifist's Pyre", icon: 'campfire', desc: `Your weapon hits build statuses from ×${C.PYRE} the damage they would deal.`, cost: 'Your weapon hits deal no direct damage.', mods: { twPacifist: 1 }, gates: 2 },
    hunted: { name: 'Hunted', icon: 'fang', desc: 'A champion roams every combat room; killing it pays a boon card.', cost: 'Each combat room holds one more affixed elite.', mods: { twHunted: 1 } },
  };
  ED.TWIST_IDS = [];
  for (const id in T) {
    const t = T[id];
    ED.BOONS[id] = { name: t.name, rar: 't', icon: t.icon, desc: t.desc, cost: t.cost, mods: t.mods || {}, twist: true, max: 1 };
    if (t.gates) ED.BOONS[id].gates = t.gates;
    ED.TWIST_IDS.push(id);
  }
  // Number of Twists held in a boon map.
  ED.twistCount = (boons) => { let n = 0; for (const id of ED.TWIST_IDS) if (boons[id] > 0) n++; return n; };
  ED.BOON_IDS = Object.keys(ED.BOONS);
})(globalThis.ED || (globalThis.ED = {}));
