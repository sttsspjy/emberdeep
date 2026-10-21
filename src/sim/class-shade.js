// Shade: Shadowstep and Vanish (base kits from ED.SKILLS numbers) and the Shade hook table ED.CLS.shade.
(function (ED) {
  'use strict';
  const U = ED.U;
  const fin = (v) => typeof v === 'number' && isFinite(v);

  // Shadowstep: the client has already moved the hero from (x0, y0) to (x1, y1); every foe on that path takes a guaranteed crit and the hero readies crit attacks (3, +stepStack per foe cut, scaled by the weapon's critK).
  ED.CAST.step = function (p, a, data, st, N) {
    const q = N.p.slash, x0 = fin(data.x0) ? data.x0 : p.x, y0 = fin(data.y0) ? data.y0 : p.y, x1 = fin(data.x1) ? data.x1 : p.x, y1 = fin(data.y1) ? data.y1 : p.y;
    let cut = 0;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + q.reach) ** 2) {
        this.hitEnemy(e, q.dmg, this.partSrc(p, N, 'slash', { crit: true, kx: Math.cos(a), ky: Math.sin(a), mul: st.assassinate && e.hp < e.maxHp * 0.5 ? 1 + st.assassinate : undefined }));
        cut++;
      }
    }
    this.grantCrits(p, 3 + st.stepStack * cut, 3 + st.stackMax, 'set');
    this.emit({ t: 'blink', pid: p.pid, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) });
    return {};
  };

  // Vanish: smoke that slows foes and blinds each non-boss foe inside for a budget (elites half, then a cooldown); the hero is unseen for a while and the next attack is an Ambush.
  ED.CAST.vanish = function (p, a, data, st, N) {
    const sm = N.p.smoke, bl = N.p.blind, stealth = 2.5 + st.stealthDur, bud = {};
    p.stealthT = stealth; p.ambush = true; p.ambushT = stealth + 0.5;
    this.addZone({ kind: 'smoke', x: p.x, y: p.y, r: sm.r, dur: sm.dur, team: 0, owner: p.pid, custom: true,
      update: (world, z, dt) => {
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          world.slowEnemy(e, st.shroud ? 0.6 : sm.slow, 0.3);
          if (st.smokeVuln) e.vulnT = Math.max(e.vulnT || 0, 0.3);
          if (e.boss) continue;
          const cap = bl.dur * (e.elite ? 0.5 : 1);
          if ((bud[e.id] || 0) < cap && e.blindCd <= 0) {
            e.blind = Math.max(e.blind || 0, 0.3); bud[e.id] = (bud[e.id] || 0) + dt;
            if (bud[e.id] >= cap && e.elite) e.blindCd = ED.CONST.BLIND_CD;
          }
        }
      } });
    for (let i = 0; i < 6; i++) { const an = i * U.TAU / 6; this.emit({ t: 'puff', x: Math.round(p.x + Math.cos(an) * sm.r * 0.5), y: Math.round(p.y + Math.sin(an) * sm.r * 0.5), c: '#8a86a0' }); }
    return {};
  };

  ED.CLS.shade = {
    // Night's Edge today: an Ambush kill refunds Vanish, at most once per 3 s
    kill(e, p, src) {
      if (p && p.cls === 'shade' && src && src.ambush && p.stats.nightsEdge && p.edgeT <= 0) { p.edgeT = 3; this.refundSkill(p, 1); }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
