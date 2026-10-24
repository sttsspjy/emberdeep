// Twist runtime: hooks combat.js and skills.js call for a hero with p.twist set (truthy while the hero holds any Twist).
// hitMul(p, e, src) -> damage factor of one hit; onAttack(p) after an attack counts; onCast(p, slot) after a skill cast. this = world.
(function (ED) {
  'use strict';
  ED.TWIST = {
    hitMul() { return 1; },
    onAttack() {},
    onCast() {},
  };
})(globalThis.ED || (globalThis.ED = {}));
