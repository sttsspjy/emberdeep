// Foe brains: ED.AI[name] = fn(w, e, dt), called by updateFoes for a foe with a living target (e.tgt) that is not stunned, frozen or rushing.
// A brain moves the foe itself (w.steer, ED.Arena.move) and may use e.st (0 move, 1 windup, 2 act), e.stT and e.vars (created lazily). A def.ai without a brain runs 'chaser'.
// Telegraph rule: any foe attack beyond contact uses a warn zone of at least 0.6 s (w.zone({ team: 1, warn: true, ... })).
(function (ED) {
  'use strict';
  const AI = ED.AI = {};

  // Straight at the nearest hero.
  AI.chaser = (w, e, dt) => { w.steer(e, e.tgt.x, e.tgt.y, 1, dt); };

  // Straight at the nearest hero with a sideways wobble (packs spread instead of stacking in a line).
  AI.swarm = (w, e, dt) => {
    const t = e.tgt, a = Math.atan2(t.y - e.y, t.x - e.x) + Math.sin(e.age * 3 + e.id * 1.7) * 0.6;
    w.steer(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, 1, dt);
  };

  // Bosses: ED.Bosses[def.id](w, e, dt) (src/sim/bosses.js runner), chaser when the boss has no script.
  AI.boss = (w, e, dt) => { const b = ED.Bosses[e.def.id]; if (typeof b === 'function') b(w, e, dt); else AI.chaser(w, e, dt); };
})(globalThis.ED || (globalThis.ED = {}));
