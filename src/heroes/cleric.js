// Cleric: hero data, placeholder signature Smite and placeholder Q Sanctuary / E Judgment (the hero lane replaces them; evolution Wrath pairs with Reach).
(function (ED) {
  'use strict';
  const U = ED.U;

  ED.addHero({ id: 'cleric', name: 'Cleric', hp: 110, speed: 88, crit: 0.05, sig: 'smite', skills: ['sanctuary', 'judgment'], icon: 'hero.cleric.idle', col: '#ffe08a', txt: 'Holy pillars strike foes on screen.' });

  ED.addWeapon({
    id: 'smite', name: 'Smite', icon: 'weapon.mace', sig: 'cleric', mode: 'random', txt: 'Holy pillars on random foes',
    base: { dmg: 20, cd: 1.2, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 60, range: 400, r: 22 },
    levels: [
      { mods: { n: 1 }, txt: '+1 pillar' }, { mods: { area: 0.25 }, txt: '+25% pillar size' }, { mods: { dmg: 0.25 }, txt: '+25% damage' },
      { mods: { n: 1 }, txt: '+1 pillar' }, { mods: { cd: -0.15 }, txt: 'Strike 15% faster' }, { mods: { n: 1 }, txt: '+1 pillar' }, { mods: { dmg: 0.25, area: 0.2 }, txt: '+25% damage, +20% size' },
    ],
    pair: 'reach', evo: 'wrath',
  }, {
    fire(w, p, ws, S) {
      let any = false;
      for (let i = 0; i < Math.max(1, S.n | 0); i++) { const t = w.target('random', p, S.range); if (!t) break; w.blast(p, ws.id, t.x, t.y, S.r * S.area, S.dmg, { knock: S.knock, look: 'holy' }); any = true; }
      return any;
    },
  });

  ED.addSkill({
    id: 'sanctuary', name: 'Sanctuary', icon: 'fx.shield.gold', cd: 14, txt: 'Holy ground heals allies',
    base: { dmg: 16, r: 70, dur: 4, heal: 5 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% area' }, { mods: { heal: 3 }, txt: '+3 HP/s healing' }, { mods: { dur: 0.5 }, txt: 'Lasts 50% longer' }],
  }, (w, p, x, y, N) => {
    w.zone({ team: 0, p, wid: 'sanctuary', x, y, r: N.r, dur: N.dur, dps: N.dmg, tick: 0.5, look: 'holy', st: { heal: N.heal },
      onTick: (ww, z) => { for (const h of ww.living) if (U.dist2(h.x, h.y, z.x, z.y) <= z.r * z.r) ww.heal(h, z.st.heal * z.tick); } });
  });
  ED.addSkill({
    id: 'judgment', name: 'Judgment', icon: 'weapon.dawnhammer', cd: 9, txt: 'A holy sweep toward the cursor',
    base: { dmg: 60, r: 220 },
    levels: [{ mods: { r: 0.25 }, txt: '+25% reach' }, { mods: { dmg: 0.5 }, txt: '+50% damage' }, { mods: { cd: -0.25 }, txt: 'Cooldown -25%' }],
  }, (w, p, x, y, N) => { w.arc(p, 'judgment', p.x, p.y, Math.atan2(y - p.y, x - p.x), N.r, Math.PI / 2, N.dmg, { knock: 160, look: 'holy', kind: 'skill' }); });
})(globalThis.ED || (globalThis.ED = {}));
