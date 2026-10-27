// Shade: hero data, placeholder signature Twin Daggers and placeholder Q Shadow Step / E Fan of Knives (the hero lane replaces them; evolution Shadow Fan pairs with Velocity).
(function (ED) {
  'use strict';
  const U = ED.U;

  ED.addHero({ id: 'shade', name: 'Shade', hp: 80, speed: 100, crit: 0.15, sig: 'daggers', skills: ['step', 'fan'], icon: 'hero.shade.idle', col: '#8a9bd6', txt: 'Fast daggers, deadly crits.' });

  ED.addWeapon({
    id: 'daggers', name: 'Twin Daggers', icon: 'weapon.daggers', look: 'knife', sig: 'shade', mode: 'facing', txt: 'Fast daggers where you face',
    base: { dmg: 9, cd: 0.45, n: 2, pierce: 0, area: 1, speed: 420, dur: 0, knock: 10, range: 300, crit: 0.1 },
    levels: [
      { mods: { n: 1 }, txt: '+1 dagger' }, { mods: { pierce: 1 }, txt: 'Daggers pierce 1 foe' }, { mods: { dmg: 0.25 }, txt: '+25% damage' },
      { mods: { crit: 0.1 }, txt: '+10% crit chance' }, { mods: { n: 1 }, txt: '+1 dagger' }, { mods: { cd: -0.15 }, txt: 'Throw 15% faster' }, { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 dagger' },
    ],
    pair: 'velocity', evo: 'shadowfan',
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range)) return false;
      const a = p.mdir, n = Math.max(1, S.n | 0);
      for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6 + (i - (n - 1) / 2) * 5, a + (i - (n - 1) / 2) * 0.05, S, { look: 'knife' });
      return true;
    },
  });

  ED.addSkill({
    id: 'step', name: 'Shadow Step', icon: 'fx.smoke', cd: 7, txt: 'Blink to the cursor',
    base: { dmg: 40, r: 60, dist: 170 },
    levels: [{ mods: { dist: 60 }, txt: '+60 blink range' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => {
    const a = Math.atan2(y - p.y, x - p.x), d = Math.min(N.dist, Math.hypot(x - p.x, y - p.y)), ox = p.x, oy = p.y;
    p.x += Math.cos(a) * d; p.y += Math.sin(a) * d; ED.Arena.collide(w.arena, p, p.r);
    p.invuln = Math.max(p.invuln, 0.3);
    w.blast(p, 'step', ox, oy, N.r, N.dmg, { look: 'shadow', kind: 'skill' });
    return { x0: Math.round(ox), y0: Math.round(oy) };
  });
  ED.addSkill({
    id: 'fan', name: 'Fan of Knives', icon: 'weapon.knives', cd: 10, txt: '24 knives in a full circle',
    base: { dmg: 22, n: 24, speed: 380 },
    levels: [{ mods: { n: 8 }, txt: '+8 knives' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => {
    for (let i = 0; i < N.n; i++) w.shoot(p, 'fan', p.x, p.y - 6, i / N.n * U.TAU, null, { look: 'knife', dmg: N.dmg, speed: N.speed, pierce: 1, life: 0.9 });
  });
})(globalThis.ED || (globalThis.ED = {}));
