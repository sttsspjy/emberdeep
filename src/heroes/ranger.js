// Ranger: hero data, signature weapon Longbow (reference projectile weapon: w.shoot) + evolution Hail of Arrows, Q Volley, E Snare Trap.
(function (ED) {
  'use strict';

  ED.addHero({ id: 'ranger', name: 'Ranger', hp: 90, speed: 100, crit: 0.08, sig: 'longbow', skills: ['volley', 'snare'], icon: 'hero.ranger.idle', col: '#9fd38a', txt: 'Arrows at the nearest foe. Fast feet.' });

  // ---------------- Longbow ----------------
  // S.n arrows in a fan (0.12 rad apart) at the nearest foe within S.range.
  const fan = (w, p, ws, S, opt) => {
    const t = w.nearestFoe(p.x, p.y, S.range);
    if (!t) return false;
    const a = Math.atan2(t.y - p.y, t.x - p.x), n = Math.max(1, S.n | 0);
    for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.12, S, opt);
    return true;
  };
  const ARROW = { look: 'arrow' };
  ED.addWeapon({
    id: 'longbow', name: 'Longbow', icon: 'weapon.longbow', look: 'arrow', sig: 'ranger', mode: 'nearest', txt: 'Arrows at the nearest foe',
    base: { dmg: 14, cd: 0.9, n: 1, pierce: 0, area: 1, speed: 320, dur: 0, knock: 40, range: 360 },
    levels: [
      { mods: { n: 1 }, txt: '+1 arrow' },
      { mods: { pierce: 1 }, txt: 'Arrows pierce 1 more foe' },
      { mods: { dmg: 0.25, speed: 0.2 }, txt: '+25% damage, faster arrows' },
      { mods: { n: 1 }, txt: '+1 arrow' },
      { mods: { pierce: 1, range: 0.2 }, txt: 'Pierce 1 more, +20% range' },
      { mods: { cd: -0.2 }, txt: 'Fire 20% faster' },
      { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 arrow' },
    ],
    pair: 'multishot', evo: 'hail',
  }, { fire: (w, p, ws, S) => fan(w, p, ws, S, ARROW) });

  // Hail of Arrows: Longbow arrows that split in two on every hit (splits do not split again).
  const split = (w, pr, e) => {
    if (pr.st) return;
    for (const s of [-0.5, 0.5]) {
      const c = w.shoot(pr.p, pr.wid, e.x, e.y, pr.a + s, null, { look: 'arrow', dmg: pr.dmg * 0.6, pierce: 0, speed: pr.sp, life: 0.45, knock: 20, st: { split: true } });
      c.hits.push(e.id);
    }
  };
  ED.addWeapon({
    id: 'hail', name: 'Hail of Arrows', icon: 'weapon.twinbows', look: 'arrow', sig: 'ranger', mode: 'nearest', evolved: true, from: 'longbow', txt: 'Arrows split on hit',
    base: { dmg: 22, cd: 0.6, n: 4, pierce: 2, area: 1, speed: 400, dur: 0, knock: 40, range: 430 },
    levels: [],
  }, { fire: (w, p, ws, S) => fan(w, p, ws, S, { look: 'arrow', onHit: split }) });

  // ---------------- skills ----------------
  // Volley: a rain of arrows on a cursor area (zone ticking every 0.2 s for N.dur s).
  ED.addSkill({
    id: 'volley', name: 'Volley', icon: 'proj.arrow', cd: 9, txt: 'Arrow rain on the cursor area',
    base: { dmg: 36, r: 70, dur: 2 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% rain area' }, { mods: { dur: 0.5 }, txt: 'Rain lasts 50% longer' }, { mods: { dmg: 0.6 }, txt: '+60% damage' }],
  }, (w, p, x, y, N) => {
    w.zone({ team: 0, p, wid: 'volley', x, y, r: N.r, dur: N.dur, dps: N.dmg, tick: 0.2, look: 'arrows' });
  });
  // Snare Trap: a trap at the cursor that roots foes inside for N.dur s.
  ED.addSkill({
    id: 'snare', name: 'Snare Trap', icon: 'proj.web', cd: 12, txt: 'Trap that roots foes in a radius',
    base: { dmg: 6, r: 60, dur: 4 },
    levels: [{ mods: { r: 0.35 }, txt: '+35% trap size' }, { mods: { dur: 0.5 }, txt: 'Roots 50% longer' }, { mods: { dmg: 3 }, txt: 'Snared foes bleed hard' }],
  }, (w, p, x, y, N) => {
    w.zone({ team: 0, p, wid: 'snare', x, y, r: N.r, dur: N.dur, dps: N.dmg, tick: 0.25, stun: 0.35, look: 'web' });
  });
})(globalThis.ED || (globalThis.ED = {}));
