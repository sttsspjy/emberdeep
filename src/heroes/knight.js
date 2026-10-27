// Knight: hero data, signature weapon Cleave (reference melee weapon: w.arc) + evolution Whirlwind, Q Shield Charge, E Bulwark.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;

  ED.addHero({ id: 'knight', name: 'Knight', hp: 130, speed: 85, crit: 0.05, sig: 'cleave', skills: ['charge', 'bulwark'], icon: 'hero.knight.idle', col: '#c9d4e8', txt: 'Sword and shield. Holds the line.' });

  // ---------------- Cleave ----------------
  // A sword arc toward the movement direction (mode facing). Custom numbers: arc (rad), back (also swings behind). S.n swings: the first at once, the rest 0.15 s apart.
  const swing = (w, p, ws, S, a) => w.arc(p, ws.id, p.x, p.y - 4, a, S.range * S.area, S.arc, S.dmg, { knock: S.knock, look: 'slash' });
  ED.addWeapon({
    id: 'cleave', name: 'Cleave', icon: 'weapon.longsword', sig: 'knight', mode: 'facing', txt: 'Sword arc toward your facing',
    base: { dmg: 18, cd: 1.3, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 120, range: 56, arc: 2.0 },
    levels: [
      { mods: { area: 0.15 }, txt: '+15% swing size' },
      { mods: { back: true }, txt: 'Also swings behind you' },
      { mods: { dmg: 0.25, arc: 0.4 }, txt: '+25% damage, wider arc' },
      { mods: { n: 1 }, txt: '+1 swing' },
      { mods: { area: 0.2 }, txt: '+20% swing size' },
      { mods: { cd: -0.15, knock: 0.5 }, txt: 'Swings 15% faster, more knockback' },
      { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 swing' },
    ],
    pair: 'might', evo: 'whirlwind', noAmount: true,
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range * S.area + 24)) return false;
      const a = p.mdir;
      swing(w, p, ws, S, a);
      if (S.back) swing(w, p, ws, S, a + Math.PI);
      ws.st.left = (S.n | 0) - 1; ws.st.t = 0.15; ws.st.a = a;
      return true;
    },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (!(st.left > 0)) return;
      st.t -= dt;
      if (st.t > 0) return;
      st.t = 0.15; st.left--;
      const a = st.a + (st.left % 2 ? 0.3 : -0.3);
      swing(w, p, ws, S, a);
      if (S.back) swing(w, p, ws, S, a + Math.PI);
    },
  });
  // Whirlwind: 360 degree spins around the hero, S.n spins 0.2 s apart.
  ED.addWeapon({
    id: 'whirlwind', name: 'Whirlwind', icon: 'weapon.alt.double_axe', sig: 'knight', mode: 'around', evolved: true, from: 'cleave', txt: '360 degree spins',
    base: { dmg: 34, cd: 1.0, n: 2, pierce: 0, area: 1.45, speed: 0, dur: 0, knock: 160, range: 60, arc: TAU },
    levels: [], noAmount: true,
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range * S.area + 24)) return false;
      w.arc(p, ws.id, p.x, p.y - 4, 0, S.range * S.area, TAU, S.dmg, { knock: S.knock, look: 'whirl' });
      ws.st.left = (S.n | 0) - 1; ws.st.t = 0.2;
      return true;
    },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (!(st.left > 0) || (st.t -= dt) > 0) return;
      st.t = 0.2; st.left--;
      w.arc(p, ws.id, p.x, p.y - 4, 0, S.range * S.area, TAU, S.dmg, { knock: S.knock, look: 'whirl' });
    },
  });

  // ---------------- skills ----------------
  // Shield Charge: rush toward the aim point (N.dist px over N.dur s, untouchable), every foe in the path takes N.dmg once, is knocked aside and stunned N.stun s.
  ED.addSkill({
    id: 'charge', name: 'Shield Charge', icon: 'shield.kite', cd: 7, txt: 'Charge through the horde',
    base: { dmg: 40, dist: 170, t: 0.32, stun: 0.6, width: 26 },
    levels: [{ mods: { dist: 60 }, txt: '+60 charge distance' }, { mods: { dmg: 0.5, stun: 0.4 }, txt: '+50% damage, longer stun' }, { mods: { quake: true }, txt: 'Ends with a shockwave' }],
  }, (w, p, x, y, N) => {
    const a = Math.atan2(y - p.y, x - p.x);
    p.chg = { a, t: N.t, v: N.dist / N.t, dmg: N.dmg, stun: N.stun, width: N.width, quake: !!N.quake, hits: [] };
    p.invuln = Math.max(p.invuln, N.t + 0.1);
    return { a };
  });
  // Bulwark: N.dur s of N.dr damage reduction and a shockwave that pushes the horde back.
  ED.addSkill({
    id: 'bulwark', name: 'Bulwark', icon: 'shield.tower', cd: 14, txt: 'Brace and push the horde back',
    base: { dmg: 20, r: 100, dur: 3, dr: 0.6, knock: 420 },
    levels: [{ mods: { r: 0.3 }, txt: '+30% shockwave size' }, { mods: { dur: 0.5 }, txt: '+50% duration' }, { mods: { dr: 0.15, dmg: 1 }, txt: '+15% reduction, double damage' }],
  }, (w, p, x, y, N) => {
    p.bulT = N.dur; p.bulDr = Math.min(0.9, N.dr);
    w.blast(p, 'bulwark', p.x, p.y, N.r, N.dmg, { knock: N.knock, look: 'shock', kind: 'skill' });
  });

  ED.HOOK.knight = {
    init(w, p) { p.chg = null; p.bulT = 0; p.bulDr = 0; },
    tick(w, p, dt) {
      if (p.bulT > 0) { p.bulT -= dt; p.dr = p.bulT > 0 ? p.bulDr : 0; }
      const c = p.chg;
      if (!c) return;
      const step = Math.min(dt, c.t);
      ED.Arena.move(w.arena, p, Math.cos(c.a) * c.v * step, Math.sin(c.a) * c.v * step, p.r);
      p.moving = true; p.mdir = c.a;
      const q = w.foeScan(p.x, p.y, c.width);
      for (let k = 0; k < q.length; k++) {
        const e = q[k];
        if (e.dead || c.hits.indexOf(e.id) >= 0 || U.dist2(p.x, p.y, e.x, e.y) > (c.width + e.r) ** 2) continue;
        c.hits.push(e.id);
        const side = U.angDiff(c.a, Math.atan2(e.y - p.y, e.x - p.x)) > 0 ? 1 : -1, s = w.src(p, 'charge', 'skill', 0);
        w.hitFoe(e, c.dmg, s);
        if (!e.dead) { w.knock(e, Math.cos(c.a + side * 1.2), Math.sin(c.a + side * 1.2), 380); w.stun(e, c.stun); }
      }
      w.foeEnd();
      c.t -= dt;
      if (c.t <= 0) { if (c.quake) w.blast(p, 'charge', p.x, p.y, 80, c.dmg * 0.6, { knock: 300, look: 'shock', kind: 'skill' }); p.chg = null; }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
