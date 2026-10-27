// Pyro: hero data, placeholder signature Fire Bolt and placeholder Q Meteor / E Flame Ring (the hero lane replaces them; evolution Inferno pairs with Duration).
(function (ED) {
  'use strict';

  ED.addHero({ id: 'pyro', name: 'Pyro', hp: 85, speed: 92, crit: 0.05, sig: 'firebolt', skills: ['meteor', 'flamering'], icon: 'hero.pyro.idle', col: '#ff8a3d', txt: 'Bolts that burst into flame.' });

  const burst = (w, pr, e) => w.blast(pr.p, pr.wid, e.x, e.y, 22, pr.dmg * 0.5, { look: 'fire', burn: [4, 2], noEv: false });
  ED.addWeapon({
    id: 'firebolt', name: 'Fire Bolt', icon: 'weapon.firestaff', look: 'fireball', sig: 'pyro', mode: 'nearest', txt: 'Bolt that bursts into fire',
    base: { dmg: 16, cd: 1.1, n: 1, pierce: 0, area: 1, speed: 260, dur: 0, knock: 30, range: 340 },
    levels: [
      { mods: { area: 0.2 }, txt: '+20% bolt size' }, { mods: { n: 1 }, txt: '+1 bolt' }, { mods: { dmg: 0.25 }, txt: '+25% damage' },
      { mods: { cd: -0.15 }, txt: 'Cast 15% faster' }, { mods: { n: 1 }, txt: '+1 bolt' }, { mods: { pierce: 1 }, txt: 'Bolts pierce 1 foe' }, { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 bolt' },
    ],
    pair: 'duration', evo: 'inferno',
  }, {
    fire(w, p, ws, S) {
      const t = w.nearestFoe(p.x, p.y, S.range); if (!t) return false;
      const a = Math.atan2(t.y - p.y, t.x - p.x), n = Math.max(1, S.n | 0);
      for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.18, S, { look: 'fireball', onHit: burst });
      return true;
    },
  });

  // Meteor (placeholder): a telegraphed impact at the cursor after 0.5 s.
  ED.addSkill({
    id: 'meteor', name: 'Meteor', icon: 'proj.fireball', cd: 10, txt: 'A meteor falls on the cursor',
    base: { dmg: 90, r: 80 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% impact size' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => { w.zone({ team: 0, warn: true, p, wid: 'meteor', x, y, r: N.r, dur: 0.5, dmg: N.dmg, burn: [8, 3], knock: 200, look: 'meteor' }); });
  // Flame Ring (placeholder): a fire blast around the hero that burns.
  ED.addSkill({
    id: 'flamering', name: 'Flame Ring', icon: 'fx.flame', cd: 8, txt: 'A ring of fire around you',
    base: { dmg: 40, r: 110 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% ring size' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => { w.blast(p, 'flamering', p.x, p.y, N.r, N.dmg, { burn: [10, 3], knock: 220, look: 'fire', kind: 'skill' }); });
})(globalThis.ED || (globalThis.ED = {}));
