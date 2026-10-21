// Ranger: Volley and Rain of Arrows (base kits from ED.SKILLS numbers) and the Ranger hook table ED.CLS.ranger.
// Route cards with behaviour still to build here: Deadeye, Ballista, Quickdraw, Hunter's Mark, Scattershot, Skyfall, Hail of Thorns' rider, Infected Wounds' Gangrene, Contagion (see DESIGN-classes section 5).
(function (ED) {
  'use strict';
  const U = ED.U;

  // Volley: a fan of piercing arrows toward the cursor.
  ED.CAST.volley = function (p, a, data, st, N) {
    const q = N.p.arrow, n = q.n;
    for (let i = 0; i < n; i++) {
      const ang = a + (n > 1 ? (i / (n - 1) - 0.5) * q.fan : 0);
      this.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y - 4, a: ang, speed: q.speed, r: q.pr, dmg: q.dmg, life: q.life, pierce: q.pierce + st.pierce, owner: p.pid, knock: q.knock, hk: 'skill', part: 'volley.arrow', infK: 1 + st.skillInfK });
    }
    return {};
  };

  // Rain of Arrows: after the part's delay an arrow tick every 0.25 s on every foe inside; Hail of Thorns slows the foes inside 50% and makes them vulnerable.
  ED.CAST.rain = function (p, a, data, st, N) {
    const t = this.groundTarget(p, a, data, 'rain'), q = N.p.tick, hail = !!st.rainHail, infK = 1 + st.skillInfK;
    let k = 0;
    this.addZone({ kind: 'rain', x: t.x, y: t.y, r: q.r, dur: q.delay + q.dur, team: 0, owner: p.pid, custom: true,
      update: (world, z) => {
        if (z.t < q.delay) return;
        const o = world.players.get(z.owner); if (!o) return;
        const tick = k < q.count && z.t >= q.delay + q.every * k;
        if (tick) k++;
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          if (hail) { world.slowEnemy(e, 0.5, 0.3); e.vulnT = Math.max(e.vulnT || 0, 0.3); }
          if (tick) world.hitEnemy(e, q.dmg, { p: o, kind: 'skill', part: 'rain.tick', noGuard: true, x: z.x, y: z.y, infK });
        }
      } });
    return { tx: Math.round(t.x), ty: Math.round(t.y) };
  };

  ED.CLS.ranger = {};
})(globalThis.ED || (globalThis.ED = {}));
