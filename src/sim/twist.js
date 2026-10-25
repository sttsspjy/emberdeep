// Twist runtime (numbers: ED.TWIST_C, src/data/twists.js). combat.js and skills.js call the hooks for a hero with p.twist set (truthy while the hero holds any Twist); this = world.
// hitMul(p, e, src) -> damage factor of one hit; onAttack(p) -> the attack's damage factor, after a weapon attack counts; onCast(p, slot) after a skill cast;
// pyreHit(p, e, dmg, crit, comp, src) -> 0: a Pacifist's Pyre weapon hit builds statuses only; cd(st, slot) -> seconds a cast of skill slot (0-2) puts on that slot (client control and bots).
(function (ED) {
  'use strict';
  const C = ED.TWIST_C;
  // A weapon hit: a swing, shot, beam, lob, its blast or shock, a ring, wave or weapon repeat (src.wpn or kind 'weapon'); status payoffs (raw) are not.
  const weaponHit = (src) => !src.raw && (src.wpn || (src.kind || 'weapon') === 'weapon');
  ED.TWIST = {
    // Pacifist's Pyre: flags the weapon hit (src.pyre) so hitEnemy hands it to pyreHit after its damage is known.
    hitMul(p, e, src) {
      if (p.stats.twPacifist && weaponHit(src)) src.pyre = true;
      return 1;
    },
    // Metronome bar: p.metroN = attacks since the last METRO_HI beat (0..METRO_N - 1); the METRO_N-th attack deals METRO_HI and resets it, the others METRO_LO. 1 without Metronome.
    onAttack(p) {
      if (!p.stats.twMetro) return 1;
      const n = (p.metroN | 0) + 1;
      if (n >= C.METRO_N) { p.metroN = 0; return C.METRO_HI; }
      p.metroN = n;
      return C.METRO_LO;
    },
    // Bloodprice: a cast takes BLOOD x max HP straight off health (no armor, shield or dodge), never below 1 HP.
    onCast(p) {
      if (!p.stats.twBlood || !(p.hp > 1)) return;
      p.hp = Math.max(1, p.hp - p.maxHp * C.BLOOD);
    },
    // Pacifist's Pyre: no health lost, no hit event; the hit's procs build from PYRE x the damage it would have dealt (dmg after vulnerability, affinity and guard), then a Doomed foe is Reap-checked.
    pyreHit(p, e, dmg, crit, comp, src) {
      if (p && !src.noProc && dmg > 0) this.heroProcs(e, p, dmg * C.PYRE, crit, comp, src);
      if (e.hp > 0 && e.doom > 0) this.checkReap(e);
      return 0;
    },
    cd(st, slot) { return slot === 2 ? st.skill3Cd : st.twBlood ? C.GAP : slot ? st.skill2Cd : st.skillCd; }, // skill 3 keeps its own cooldown (no Bloodprice)
  };
})(globalThis.ED || (globalThis.ED = {}));
