// Necro: hero data, placeholder signature Bone Shard and placeholder Q Raise Horde / E Corpse Blast (the hero lane replaces them: minions, corpses; evolution Bone Storm pairs with Haste).
(function (ED) {
  'use strict';

  ED.addHero({ id: 'necro', name: 'Necro', hp: 95, speed: 88, crit: 0.05, sig: 'boneshard', skills: ['raise', 'corpseblast'], icon: 'hero.necro.idle', col: '#b7a6e0', txt: 'Piercing shards. The dead rise.' });

  ED.addWeapon({
    id: 'boneshard', name: 'Bone Shard', icon: 'weapon.bonewand', look: 'bone', sig: 'necro', mode: 'nearest', txt: 'Piercing bone shards',
    base: { dmg: 12, cd: 1.0, n: 1, pierce: 2, area: 1, speed: 300, dur: 0, knock: 20, range: 340 },
    levels: [
      { mods: { n: 1 }, txt: '+1 shard' }, { mods: { pierce: 1 }, txt: 'Shards pierce 1 more' }, { mods: { dmg: 0.25 }, txt: '+25% damage' },
      { mods: { n: 1 }, txt: '+1 shard' }, { mods: { cd: -0.15 }, txt: 'Fire 15% faster' }, { mods: { pierce: 2 }, txt: 'Shards pierce 2 more' }, { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 shard' },
    ],
    pair: 'haste', evo: 'bonestorm',
  }, {
    fire(w, p, ws, S) {
      const t = w.nearestFoe(p.x, p.y, S.range); if (!t) return false;
      const a = Math.atan2(t.y - p.y, t.x - p.x), n = Math.max(1, S.n | 0);
      for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.14, S, { look: 'bone' });
      return true;
    },
  });

  ED.addSkill({
    id: 'raise', name: 'Raise Horde', icon: 'proj.skull', cd: 14, txt: 'Raise skeletons to fight',
    base: { dmg: 50, r: 90 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% area' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => { w.blast(p, 'raise', x, y, N.r, N.dmg, { knock: 160, look: 'skull', kind: 'skill' }); });
  ED.addSkill({
    id: 'corpseblast', name: 'Corpse Blast', icon: 'fx.sigil.skull', cd: 10, txt: 'Detonate the dead around you',
    base: { dmg: 45, r: 140 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% area' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => { w.blast(p, 'corpseblast', p.x, p.y, N.r, N.dmg, { knock: 240, look: 'skull', kind: 'skill' }); });
})(globalThis.ED || (globalThis.ED = {}));
