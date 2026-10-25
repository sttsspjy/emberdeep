// Empowered attacks: the "every Nth attack" effects, in priority order (the first whose test passes names the hero's next attack).
// test(p, n, now): true when attack number n (p.atkCount + 1, the next one) at world time `now` is empowered; each mirrors its sim site exactly (combat.js playerAttack, class-*.js attack hooks).
// col: the hero's weapon glow and the cursor tint while the next attack is empowered. Other files may push entries; ids are not on the wire (the snapshot carries index + 1).
(function (ED) {
  'use strict';
  const melee = (w) => w.kind === 'melee';
  const swung = (w) => w.kind === 'melee' || w.kind === 'proj'; // a bell is hauled, not swung: playerAttack hands it to class-bell.js
  const waveOn = (w, st, n) => !!w.wave && swung(w) && n % Math.max(1, w.wave.every + st.waveEvery) === 0;
  const ringOn = (w, st, n) => !!w.ring && swung(w) && n % Math.max(1, w.ring.every + st.waveEvery) === 0;
  ED.EMPOWER = [
    // Whirlwind (class-shade.js attack): every 4th attack at full Momentum
    { id: 'whirl', name: 'Whirlwind', col: '#c08cff', test: (p, n) => p.cls === 'shade' && p.stats.bladeStorm > 0 && n % 4 === 0 && swung(p.stats.weapon) && p.stats.momMax > 0 && p.momN >= p.stats.momMax && !(p.momT <= 0) },
    // Litany (class-cleric.js waveShot, combat.js heroRing): the litany-th attack's centre wave fans, its ring strikes three times as hard
    { id: 'litany', name: 'Litany', col: '#ff9ef0', test: (p, n) => { const st = p.stats, w = st.weapon; return st.litany > 0 && n % st.litany === 0 && ((p.cls === 'cleric' && waveOn(w, st, n) && ((w.wave.n || 1) & 1) === 1) || ringOn(w, st, n)); } },
    // Grave Bolt (class-necro.js attackOpts / attack): every graveN-th swing or shot
    { id: 'grave', name: 'Grave Bolt', col: '#9dff6b', test: (p, n) => p.cls === 'necro' && p.stats.graveBolt > 0 && p.stats.graveN > 0 && swung(p.stats.weapon) && n % p.stats.graveN === 0 },
    // Siege (class-ranger.js attack): every siege-th shot is a bolt
    { id: 'siege', name: 'Siege bolt', col: '#ff8a3d', test: (p, n) => p.cls === 'ranger' && p.stats.weapon.kind === 'proj' && p.stats.siege > 0 && n % p.stats.siege === 0 },
    // Cleave (combat.js playerAttack): every (3 + cleaveN)th melee swing, or the first inside the Follow-Through window (p.cleaveNext)
    { id: 'cleave', name: 'Cleave', col: '#ffd36b', test: (p, n, now) => p.stats.cleave > 0 && melee(p.stats.weapon) && (now < p.cleaveNext || n % (3 + p.stats.cleaveN) === 0) },
    // Twin Fang (combat.js playerAttack, class-bell.js hurl): every twinEvery-th attack strikes twice
    { id: 'twin', name: 'Twin strike', col: '#ff5f7a', test: (p, n) => p.stats.twinEvery > 0 && n % p.stats.twinEvery === 0 },
    // Flurry (class-ranger.js attack): every flurry-th shot adds arrows
    { id: 'flurry', name: 'Flurry', col: '#6bc8ff', test: (p, n) => p.cls === 'ranger' && p.stats.weapon.kind === 'proj' && p.stats.flurry > 0 && n % p.stats.flurry === 0 },
    // Weapon ring (combat.js playerAttack): Radiant Mace
    { id: 'ring', name: 'Ring of light', col: '#7ff0e0', test: (p, n) => ringOn(p.stats.weapon, p.stats, n) },
    // Weapon wave (combat.js playerAttack): Holy Mace, Dawn Hammer, Judge's Gavel (a fan), Dawnbringer
    { id: 'wave', name: 'Wave', col: '#fff1a8', test: (p, n) => waveOn(p.stats.weapon, p.stats, n) },
  ];
  // Index + 1 of the first ED.EMPOWER entry hero p's next attack triggers at world time `now`, else 0 (no stats, downed or dead: 0).
  ED.empowerOf = (p, now) => {
    if (!p || !p.stats || !p.stats.weapon || p.downed || p.dead) return 0;
    const n = (p.atkCount | 0) + 1, E = ED.EMPOWER;
    for (let i = 0; i < E.length; i++) if (E[i].test(p, n, now)) return i + 1;
    return 0;
  };
})(globalThis.ED || (globalThis.ED = {}));
