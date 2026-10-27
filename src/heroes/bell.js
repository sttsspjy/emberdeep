// Bell: hero data, placeholder signature Toll and placeholder Q Great Peal / E Hurl Bell (the hero lane replaces them; evolution Cathedral pairs with Reach).
(function (ED) {
  'use strict';
  const C = ED.CONST;

  ED.addHero({ id: 'bell', name: 'Bellwarden', hp: 115, speed: 86, crit: 0.05, sig: 'toll', skills: ['peal', 'hurl'], icon: 'hero.bell.idle', col: '#e6c27a', txt: 'Peals that push the horde back.' });

  ED.addWeapon({
    id: 'toll', name: 'Toll', icon: 'weapon.bronzebell', sig: 'bell', mode: 'around', txt: 'Shockwave rings push foes back',
    base: { dmg: 14, cd: 1.6, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 260, range: 0, r: 70 },
    levels: [
      { mods: { area: 0.2 }, txt: '+20% ring size' }, { mods: { dmg: 0.3 }, txt: '+30% damage' }, { mods: { dmg: 0.25, knock: 0.3 }, txt: '+25% damage, harder push' },
      { mods: { cd: -0.15 }, txt: 'Peal 15% faster' }, { mods: { area: 0.25 }, txt: '+25% ring size' }, { mods: { stun: 0.4 }, txt: 'Rings stun for 0.4 s' }, { mods: { dmg: 0.25, area: 0.2 }, txt: '+25% damage, +20% size' },
    ],
    pair: 'reach', evo: 'cathedral', noAmount: true,
  }, {
    fire(w, p, ws, S) {
      const r = S.r * S.area;
      if (!w.nearestFoe(p.x, p.y, r + 20)) return false;
      w.blast(p, ws.id, p.x, p.y, r, S.dmg, { knock: S.knock, stun: S.stun || 0, look: 'ring' });
      return true;
    },
  });

  ED.addSkill({
    id: 'peal', name: 'Great Peal', icon: 'weapon.greatbell', cd: 16, txt: 'Stun every foe on screen',
    base: { dmg: 20, stun: 1.2 },
    levels: [{ mods: { stun: 0.4 }, txt: 'Stun 0.4 s longer' }, { mods: { dmg: 1 }, txt: 'Double damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => { w.blast(p, 'peal', p.x, p.y, Math.hypot(C.VIEW_W, C.VIEW_H) / 2, N.dmg, { stun: N.stun, look: 'ring', kind: 'skill' }); });
  ED.addSkill({
    id: 'hurl', name: 'Hurl Bell', icon: 'weapon.handbells', cd: 9, txt: 'Throw a bell that rings on landing',
    base: { dmg: 50, r: 70, speed: 300 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% ring size' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => {
    const a = Math.atan2(y - p.y, x - p.x), d = Math.min(320, Math.hypot(x - p.x, y - p.y));
    w.shoot(p, 'hurl', p.x, p.y - 6, a, null, { look: 'orb', dmg: N.dmg * 0.3, pierce: 99, speed: N.speed, life: Math.max(0.1, d / N.speed), knock: 160, r: 9, st: { r: N.r, dmg: N.dmg },
      onEnd: (ww, pr) => ww.blast(pr.p, 'hurl', pr.x, pr.y, pr.st.r, pr.st.dmg, { knock: 280, look: 'ring', kind: 'skill' }) });
  });
})(globalThis.ED || (globalThis.ED = {}));
