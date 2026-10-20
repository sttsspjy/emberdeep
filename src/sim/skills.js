// Hero skills: the class skills on K (slot 0) and L (slot 1), their per-hero state and the damage they block.
(function (ED) {
  'use strict';
  const U = ED.U;
  const W = ED.World.prototype;

  // Called from addPlayer: per-hero skill state.
  W.initSkills = function (p) { /* no extra fields yet */ };

  // Called from hurtPlayer before damage lands. Return true when a skill fully blocks the hit.
  W.skillBlock = function (p, amount, src) { return false; };

  // Called every tick from updatePlayerBuild for a living, standing hero.
  W.updateSkills = function (p, dt) { /* no timed skill state yet */ };

  // Called from killEnemy for every slain foe (p = credited hero or null).
  W.onEnemyKilledSkill = function (e, p, src) { /* no kill reactions yet */ };

  // data: { x0, y0, x1, y1 } for movement skills (performed by the hero's own client)
  W.playerSkill = function (p, a, data) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, w = st.weapon, skill = ED.CLASSES[p.cls].skill;
    const area = 1 + st.area * 0.5;
    data = data || {};
    if (skill === 'charge') {
      const x0 = data.x0 ?? p.x, y0 = data.y0 ?? p.y, x1 = data.x1 ?? p.x + Math.cos(a) * 150, y1 = data.y1 ?? p.y + Math.sin(a) * 150;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + 26) ** 2) {
          this.hitEnemy(e, 20 + w.dmg * 1.6, { p, kind: 'skill', knock: 260, kx: Math.cos(a), ky: Math.sin(a) });
          if (!e.boss) e.stun = Math.max(e.stun, 1.0);
        }
      }
      if (st.shieldwall) p.wallT = 3;
      if (st.quake) this.addZone({ kind: 'tele', x: x1, y: y1, r: 95 * area, dur: 0.3, team: 0, owner: p.pid, dmg: w.dmg * 2.5, boom: 'shock' });
      p.invuln = Math.max(p.invuln, 0.35);
    } else if (skill === 'volley') {
      const n = 7 + (st.storm ? 5 : 0), spread = 1.2;
      for (let i = 0; i < n; i++) {
        const ang = a + (i / (n - 1) - 0.5) * spread;
        this.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y - 4, a: ang, speed: 480, r: 5, dmg: w.dmg * 1.2 * (st.storm ? 1.5 : 1) + 4, life: 0.8, pierce: 1 + st.pierce, owner: p.pid, knock: 60 });
      }
    } else if (skill === 'nova') {
      const r = 105 * area * (st.combust ? 1.2 : 1);
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < r + e.r) { this.hitEnemy(e, 22 + w.dmg * 2.5, { p, kind: 'skill', knock: 200, kx: (e.x - p.x) / (d || 1), ky: (e.y - p.y) / (d || 1) }); if (e.hp > 0) this.applyBurn(e, p, w.dmg * 0.8 + 4); }
      }
      this.emit({ t: 'nova', x: p.x, y: p.y, r, c: '#ff7a2a' });
      if (st.phoenixNova) { this.healPlayer(p, p.maxHp * 0.12); this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: r * 0.8, dur: 3, dps: 8 + w.dmg, owner: p.pid, team: 0 }); }
    } else if (skill === 'step') {
      const x0 = data.x0 ?? p.x, y0 = data.y0 ?? p.y, x1 = data.x1 ?? p.x, y1 = data.y1 ?? p.y;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (U.segDist2(e.x, e.y, x0, y0, x1, y1) < (e.r + 20) ** 2) this.hitEnemy(e, 12 + w.dmg * 2.2, { p, kind: 'skill', crit: true, knock: 60, kx: Math.cos(a), ky: Math.sin(a) });
      }
      p.critStacks = 3;
      if (st.decoy) this.addZone({ kind: 'decoy', x: x0, y: y0, r: 80 * area, dur: 1.4, team: 0, owner: p.pid, dmg: w.dmg * 3, boom: 'shadow' });
      this.emit({ t: 'blink', pid: p.pid, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) });
    } else if (skill === 'sanctuary') {
      for (const q of this.players.values()) if (!q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 180 * 180) this.healPlayer(q, q.maxHp * 0.25);
      const r = 100 * area;
      this.addZone({ kind: 'sanct', x: p.x, y: p.y, r, dur: 3.5, dps: (10 + w.dmg * 1.2) * (st.wrath ? 3 : 1), owner: p.pid, team: 0 });
      if (st.wrath) for (const e of this.enemies) if (e.hp > 0 && !e.boss && U.dist2(e.x, e.y, p.x, p.y) < r * r) e.stun = Math.max(e.stun, 1.2);
    } else if (skill === 'legion') {
      for (let i = 0; i < 3; i++) { const an = a + (i - 1) * 0.9; this.spawnMinion(p, p.x + Math.cos(an) * 26, p.y + Math.sin(an) * 26, 12); }
    }
    this.onSkillCast(p, 0);
    this.emit({ t: 'skill', pid: p.pid, k: skill, a: Math.round(a * 100) / 100, x: Math.round(p.x), y: Math.round(p.y) });
  };
})(globalThis.ED || (globalThis.ED = {}));
