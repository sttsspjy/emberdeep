// Cleric: Sanctuary and Judgment (base kits from ED.SKILLS numbers), the Judgment hammers and the Cleric hook table ED.CLS.cleric.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST;
  const W = ED.World.prototype;
  const HAMMER_OUT = 0.55, HAMMER_SPEED = 360, HAMMER_BACK = 420;
  const NO_HIT = { has: () => true, add: () => {} }; // hammer pr.hit: updateProjectiles never collides with it, updateHammers does

  // Sanctuary: holy ground at the cursor (or following the Cleric with Aura of Faith). Cast: the caster and the allies within 180 of the caster heal. The zone burns foes (Radiance builds from a quarter of each tick) and cuts the damage allies inside take.
  ED.CAST.sanctuary = function (p, a, data, st, N) {
    const q = N.p.zone, g = N.aim === 'self' ? { x: p.x, y: p.y } : this.groundTarget(p, a, data, 'sanctuary');
    for (const o of this.players.values()) if (!o.downed && !o.dead && (o === p || U.dist2(o.x, o.y, p.x, p.y) < 180 * 180)) this.healPlayer(o, o.maxHp * C.SANCT_HEAL);
    const z = this.addZone({ kind: 'sanct', x: g.x, y: g.y, r: q.r, dur: q.dur, dps: q.dmg, owner: p.pid, team: 0, clsEl: st.element, rad: 0.25, dr: 0.15 + st.sanctDR });
    if (st.aura) z.follow = p.pid;
    return { x: Math.round(g.x), y: Math.round(g.y) };
  };

  // Judgment: a hammer (two in a V with Twin Hammers) flies out, turns and returns; each leg hits a foe once and Judges it. p.hammers = [{ pr, leg, t, hit, x, y, room }].
  ED.CAST.judgment = function (p, a, data, st) {
    p.castN++;
    if (st.twinHammer) { this.throwHammer(p, a - 0.2); this.throwHammer(p, a + 0.2); } else this.throwHammer(p, a);
    return {};
  };

  W.throwHammer = function (p, a) {
    const st = p.stats, N = ED.Stats.skillNums('judgment', st), q = N.p.leg;
    const pr = this.spawnProj({ team: 0, kind: 'hammer', x: p.x, y: p.y - 4, a, speed: HAMMER_SPEED, r: q.r, dmg: 0, life: 2.2 * (1 + st.s2Range), pierce: 999, owner: p.pid });
    pr.hit = NO_HIT;
    p.hammers.push({ pr, leg: 0, t: 0, hit: new Set(), x: p.x, y: p.y, room: this.room });
  };

  W.updateHammers = function (p, dt) {
    const st = p.stats, N = ED.Stats.skillNums('judgment', st), q = N.p.leg, out = HAMMER_OUT * (1 + st.s2Range), keep = [];
    for (const h of p.hammers) {
      if (h.room !== this.room) continue; // room changed: projectiles were cleared
      if (this.projs.indexOf(h.pr) < 0) { // wall hit on the way out: turn around from the last free position
        if (h.leg !== 0) continue;
        const a = Math.atan2(p.y - h.y, p.x - h.x);
        h.pr = this.spawnProj({ team: 0, kind: 'hammer', x: h.x, y: h.y, a, speed: HAMMER_BACK, r: h.pr.r, dmg: 0, life: 2.2 * (1 + st.s2Range), pierce: 999, owner: p.pid });
        h.pr.hit = NO_HIT; h.leg = 1; h.hit.clear();
      }
      const pr = h.pr;
      h.t += dt;
      if (h.leg === 0 && h.t >= out) { h.leg = 1; h.hit.clear(); }
      if (h.leg === 1) {
        const dx = p.x - pr.x, dy = p.y - 4 - pr.y, d = Math.hypot(dx, dy) || 1;
        if (d < p.r + 8 || h.t > 2.1 * (1 + st.s2Range)) { pr.life = 0; continue; }
        pr.vx = dx / d * HAMMER_BACK; pr.vy = dy / d * HAMMER_BACK;
      }
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0 || h.hit.has(e.id)) continue;
        if (U.dist2(pr.x, pr.y, e.x, e.y) > (e.r + pr.r) ** 2) continue;
        h.hit.add(e.id);
        e.judged = Math.max(e.judged || 0, 4 + st.judgeDur); e.judgeUntil = this.time + 4 + st.judgeDur; e.judgeOwner = p.pid; e.judgeCast = p.castN; // only a hammer hit stamps the cast
        if (st.verdict) { e.weakT = e.judged; e.weakV = Math.max(e.weakV, e.boss ? st.judgeWeak / 2 : st.judgeWeak); }
        this.hitEnemy(e, q.dmg, this.partSrc(p, N, 'leg', { knock: 90, kx: pr.vx / sp, ky: pr.vy / sp, x: pr.x, y: pr.y, infAdd: { holy: 0.5 } }));
      }
      h.x = pr.x; h.y = pr.y;
      keep.push(h);
    }
    p.hammers = keep;
  };

  ED.CLS.cleric = {
    init(p) { p.hammers = []; },
    tick(p, dt) { if (p.hammers.length) this.updateHammers(p, dt); },
    // A Judged foe that dies: Verdict bursts it (the Judge's owner deals it) and shields the allies within 160 once per cast (3% of max HP, class window)
    kill(e, p, src) {
      if (!(e.judgeUntil > this.time)) return;
      const o = this.players.get(e.judgeOwner);
      if (!o || o.cls !== 'cleric') return;
      const st = o.stats;
      if (st.verdict) {
        const N = ED.Stats.skillNums('judgment', st), v = N.p.verdict;
        this.skillBlast(o, e.x, e.y, v.r, v.dmg, this.partSrc(o, N, 'verdict', { knock: 90, infAdd: { holy: 0.5 }, noProc: false }), (f) => { if (f.hp > 0) this.stunFoe(f, v.stun, true); });
        this.emit({ t: 'boom', x: Math.round(e.x), y: Math.round(e.y), r: Math.round(v.r), k: 'shock' });
      }
      for (const q of this.players.values()) {
        if (q.downed || q.dead || U.dist2(q.x, q.y, e.x, e.y) > 160 * 160 || q.judgeGot[o.pid] === e.judgeCast) continue;
        q.judgeGot[o.pid] = e.judgeCast;
        this.addShield(q, q.maxHp * 0.03, q.maxHp * C.CLASS_SHIELD_CAP, 'class');
      }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
