// Mutations: a 1-of-2 variant of an owned keystone or evolution, rarity 'm', merged into ED.BOONS as 'mut_<id>' (max 1, no path: never counts toward affinity).
// ED.MUTATIONS[id] = { of: keystone or evolution boon id, name, icon, desc, mods }: two entries per keystone and evolution; holding one locks out its sibling. Each is a rule change of its parent; the runtime reads its mods stat (src/sim/combat.js).
(function (ED) {
  'use strict';
  const M = ED.MUTATIONS = {
    // Conflagration
    firestorm: { of: 'conflag', name: 'Firestorm', icon: 'flame', desc: 'Combustion splashes Burn instead of damage: foes within 70 catch 60% of the pool as Burn, and may combust in turn.', mods: { conflagSpread: 1 } },
    scorchedearth: { of: 'conflag', name: 'Scorched Earth', icon: 'ember', desc: 'A combustion leaves burning ground (radius 70, 3s, 15% of the pool per second) that blocks the path of foes as Firebreak does.', mods: { scorchEarth: 1 } },
    // Absolute Zero
    rimelattice: { of: 'abszero', name: 'Rime Lattice', icon: 'gem', desc: 'Freezing a foe raises an ice pillar beside it (3s, solid to foes and their shots) instead of the frost nova.', mods: { iceLattice: 1 } },
    flashfreeze: { of: 'abszero', name: 'Flash Freeze', icon: 'snow', desc: 'The frost nova no longer chills: it freezes the 2 nearest foes within 100 that are not elites or bosses, and each of those freezes its own.', mods: { flashFreeze: 1 } },
    // Capacitor
    supercapacitor: { of: 'capacitor', name: 'Supercapacitor', icon: 'bolt', desc: 'Detonations discharge at x4 instead of x3, but your hits build 30% less charge.', mods: { capMul: 1, chargeSlow: 0.3 } },
    lattice: { of: 'capacitor', name: 'Lightning Lattice', icon: 'star', desc: 'Each skill cast plants a Storm Anchor (as the card), and every detonation arcs to each of your anchors wherever they stand.', mods: { anchor: 1, capArc: 1 } },
    // Pandemic
    miasma: { of: 'pandemic', name: 'Miasma', icon: 'orb', desc: 'Pandemic reaches every foe within 90 that holds less Venom, for half the share.', mods: { miasma: 1 } },
    virulence: { of: 'pandemic', name: 'Virulence', icon: 'drop', desc: 'Pandemic spreads from every foe above 50 Venom, not only Corroded ones.', mods: { virulence: 1 } },
    // Radiant Aegis
    wrathfulaegis: { of: 'radiantaegis', name: 'Wrathful Aegis', icon: 'shieldgold', desc: "Your shield's strike hits every foe within 80 of you instead of the attacker.", mods: { aegisNova: 1 } },
    penitence: { of: 'radiantaegis', name: 'Penitence', icon: 'heartbroken', desc: 'Your hits store twice the Radiance while you are below half health instead of while shielded.', mods: { penitent: 1 } },
    // Reaper
    singularity: { of: 'reaper', name: 'Singularity', icon: 'orb', desc: 'The implosion first pulls foes within 120 toward the Reaped foe (elites half, never bosses).', mods: { singularity: 1 } },
    grimharvest: { of: 'reaper', name: 'Grim Harvest', icon: 'axe', desc: 'The implosion marks Doom instead of dealing damage: 20% of the foe\'s health (elites 10%) as your Doom on foes within 80, who may be Reaped in turn.', mods: { grimHarvest: 1 } },
    // Masterstroke
    openingstroke: { of: 'masterstroke', name: 'Opening Stroke', icon: 'wing', desc: 'The Masterstroke is your first attack after each dash instead of every 4th attack.', mods: { msOpen: 1 } },
    killingstroke: { of: 'masterstroke', name: 'Killing Stroke', icon: 'skull', desc: 'A Masterstroke that leaves a foe that is not a boss below 20% health (elites 10%) kills it.', mods: { msKill: 1 } },
    // Cinder Arms
    firewall: { of: 'evo_fire', name: 'Firewall', icon: 'ember', desc: 'Scorched ground lasts 4s and blocks the path of foes as Firebreak does.', mods: { cinderBlock: 1 } },
    emberwake: { of: 'evo_fire', name: 'Ember Wake', icon: 'boot', desc: 'Your attacks no longer scorch their path; your steps do: you leave scorched ground (radius 24, 2s) wherever you walk.', mods: { cinderWalk: 1 } },
    // Glacial Arms
    glacierwall: { of: 'evo_ice', name: 'Glacier Wall', icon: 'shield', desc: 'Ice pillars stand 8s, and a shattered pillar freezes the foes its burst hits (not elites or bosses).', mods: { pillarWall: 1 } },
    frostmine: { of: 'evo_ice', name: 'Frost Mine', icon: 'gem', desc: 'Ice pillars are not solid: a foe that touches one shatters it at once, no skill needed.', mods: { pillarMine: 1 } },
    // Tempest Arms
    livewire: { of: 'evo_lightning', name: 'Live Wire', icon: 'bolt', desc: 'The tether chain starts at you: its first link runs from you to your nearest charged foe within 120.', mods: { liveWire: 1 } },
    snareline: { of: 'evo_lightning', name: 'Snare Line', icon: 'magnet', desc: 'A foe crossing a tether is stunned for 0.4s (once per 2s per foe; elites half, never bosses) instead of being struck.', mods: { snareLine: 1 } },
    // Venomous Arms
    incubation: { of: 'evo_poison', name: 'Incubation', icon: 'potion', desc: 'Doses wait 6s instead of 3s and burst for twice as much.', mods: { doseLong: 1 } },
    catalyst: { of: 'evo_poison', name: 'Catalyst', icon: 'drop', desc: 'A dose bursts at once when its foe reaches full Venom, without waiting.', mods: { doseCat: 1 } },
    // Hallowed Arms
    twinlances: { of: 'evo_holy', name: 'Twin Lances', icon: 'arrows', desc: 'While you are shielded, your lance also strikes behind you.', mods: { twinLance: 1 } },
    halo: { of: 'evo_holy', name: 'Halo', icon: 'sun', desc: 'While you are shielded, your attack becomes a ring of light around you (radius 110, 140 for a melee weapon) instead of a lance.', mods: { haloRing: 1 } },
    // Umbral Arms
    deathspiral: { of: 'evo_shadow', name: 'Death Spiral', icon: 'cloak', desc: 'Only a Reap of your Quarry refunds dash charges, but it refunds all of them.', mods: { deathSpiral: 1 } },
    shadowrelay: { of: 'evo_shadow', name: 'Shadow Relay', icon: 'mask', desc: 'Each Reap makes the 2 nearest foes your Quarry instead of one.', mods: { shadowRelay: 1 } },
    // Masterwork Arms
    echoedge: { of: 'evo_general', name: 'Echo Edge', icon: 'twinblue', desc: 'The spectral strike lands on the struck foe 0.4s later at 100% instead of at once at 60%.', mods: { echoEdge: 1 } },
    mirroredge: { of: 'evo_general', name: 'Mirror Edge', icon: 'mirror', desc: 'The spectral strike hits the nearest other foe within 120 instead of the struck one.', mods: { mirrorEdge: 1 } },
  };
  ED.MUT_IDS = [];
  for (const id in M) { const m = M[id], bid = 'mut_' + id; ED.BOONS[bid] = { name: m.name, rar: 'm', icon: m.icon, desc: m.desc, mods: m.mods || {}, mut: m.of, max: 1 }; ED.MUT_IDS.push(bid); }
  ED.BOON_IDS = Object.keys(ED.BOONS);
  // Mutation ids of keystone or evolution `of`.
  ED.mutsOf = (of) => ED.MUT_IDS.filter(id => ED.BOONS[id].mut === of);
  // True when mutation boon id may be taken: its parent owned and neither it nor its sibling owned (boons = { id: rank }).
  ED.mutFree = (boons, id) => { const b = ED.BOONS[id]; return !!(b && b.mut && boons[b.mut] > 0) && !ED.mutsOf(b.mut).some(m => boons[m] > 0); };
})(globalThis.ED || (globalThis.ED = {}));
