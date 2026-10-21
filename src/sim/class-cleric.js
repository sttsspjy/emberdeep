// Cleric: Sanctuary and Judgment (base kits from ED.SKILLS numbers), the Judgment hammers, the wave hooks of the Attack route, the Verdict and Prism payoffs and the Cleric hook table ED.CLS.cleric.
// Judged = e.judged seconds (+20% damage taken); Verdict also weakens a Judged foe (e.weakT / e.weakV, read by hurtPlayer). Only a hammer hit stamps e.judgeOwner / e.judgeCast (the kill shield of Judgment).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST;
  const W = ED.World.prototype;
  const HAMMER_OUT = 0.55, HAMMER_SPEED = 360, HAMMER_BACK = 420, V_ANGLE = 0.2; // Judgment: seconds out, px/s out and home, half-angle of the Twin Hammers V
  const FLARE_R = 50, FAN = 0.25, BEAM_R = 120, HG_JUDGE = 0.6, AURA_T = 0.3; // Solar Flare radius, Litany fan half-angle, Prism reach, seconds of Judged one Hallowed Ground tick refreshes, seconds one Embolden refresh lasts
  const NO_HIT = { has: () => true, add: () => {} }; // hammer pr.hit: updateProjectiles never collides with it, updateHammers does
  C.GL_T = 6; // seconds a Guardian Light buff lasts (combat.js smite)
  const live = (e) => e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed;
  const rnd = Math.round;

  // Judges foe e for hero o for dur seconds; stamp: a hammer hit, which marks the cast for the kill shield. With Verdict the foe also deals less damage (bosses half as much).
  function judgeFoe(e, o, dur, stamp) {
    e.judged = Math.max(e.judged, dur);
    if (stamp) { e.judgeOwner = o.pid; e.judgeCast = o.castN; }
    const st = o.stats;
    if (st.verdict) { e.weakT = e.judged; e.weakV = Math.max(e.weakV, e.boss ? st.judgeWeak / 2 : st.judgeWeak); }
  }

  // Zone update of a Sanctuary (z.update, every tick): Hallowed Ground keeps the foes inside Judged, Embolden gives the allies inside an Aura of Faith +auraDmg damage for AURA_T.
  function sanctTick(w, z) {
    const o = w.players.get(z.owner);
    if (!o) return;
    const st = o.stats;
    if (st.sanctJudge) for (const e of w.enemies) if (live(e) && U.dist2(e.x, e.y, z.x, z.y) < (z.r + e.r) ** 2) e.judged = Math.max(e.judged, HG_JUDGE);
    if (z.follow && st.auraDmg && !o.downed && !o.dead) {
      for (const q of w.players.values()) {
        if (q === o || q.downed || q.dead || U.dist2(q.x, q.y, z.x, z.y) >= (z.r + q.r * 0.5) ** 2) continue;
        q.auraV = q.auraT > 0 ? Math.max(q.auraV, st.auraDmg) : st.auraDmg; q.auraT = AURA_T;
      }
    }
  }

  // Sanctuary: holy ground at the cursor (or following the Cleric with Aura of Faith). Cast: the caster and the allies within 180 of the caster heal. The zone burns foes (Radiance builds from a quarter of each tick) and cuts the damage allies inside take.
  // Holy Fury stuns the foes inside for sanctStun (not bosses); the event carries hf (stun) and au (aura) for the viewers.
  ED.CAST.sanctuary = function (p, a, data, st, N) {
    const q = N.p.zone, aura = N.aim === 'self', g = aura ? { x: p.x, y: p.y } : this.groundTarget(p, a, data, 'sanctuary');
    for (const o of this.players.values()) if (!o.downed && !o.dead && (o === p || U.dist2(o.x, o.y, p.x, p.y) < 180 * 180)) this.healPlayer(o, o.maxHp * C.SANCT_HEAL);
    const z = this.addZone({ kind: 'sanct', x: g.x, y: g.y, r: q.r, dur: q.dur, dps: q.dmg, owner: p.pid, team: 0, clsEl: st.element, rad: 0.25, dr: 0.15 + st.sanctDR, part: 'sanctuary.zone' });
    if (aura) z.follow = p.pid;
    if (st.sanctJudge || (aura && st.auraDmg)) z.update = sanctTick;
    const out = { x: rnd(g.x), y: rnd(g.y) };
    if (st.sanctStun) {
      out.hf = 1;
      for (const e of this.enemies) if (live(e) && U.dist2(e.x, e.y, g.x, g.y) < (q.r + e.r) ** 2) this.stunFoe(e, st.sanctStun, false);
    }
    if (aura) out.au = 1;
    return out;
  };

  // Judgment: a hammer (two in a V with Twin Hammers) flies out, turns and returns; each leg hits a foe once and Judges it. With Second Flight it flies out and back once more along the cast angle.
  // p.hammers = [{ pr, leg (0 out, 1 home, 2 out, 3 home), t (flown), legT, hit, x, y, a (cast angle), life, at (world time cast), room }]; an odd leg homes on the hero.
  ED.CAST.judgment = function (p, a, data, st) {
    p.castN++;
    if (st.twinHammer) { this.throwHammer(p, a - V_ANGLE); this.throwHammer(p, a + V_ANGLE); } else this.throwHammer(p, a);
    return {};
  };

  W.throwHammer = function (p, a) {
    const st = p.stats, N = ED.Stats.skillNums('judgment', st), q = N.p.leg, life = 2.2 * (1 + st.s2Range) * (st.thirdLeg ? 2 : 1);
    const pr = this.spawnProj({ team: 0, kind: 'hammer', x: p.x, y: p.y - 4, a, speed: HAMMER_SPEED, r: q.r, dmg: 0, life, pierce: 999, owner: p.pid });
    pr.hit = NO_HIT;
    p.hammers.push({ pr, leg: 0, t: 0, legT: 0, hit: new Set(), x: p.x, y: p.y, a, life, at: this.time, room: this.room });
  };

  W.updateHammers = function (p, dt) {
    const st = p.stats, N = ED.Stats.skillNums('judgment', st), q = N.p.leg, out = HAMMER_OUT * (1 + st.s2Range), keep = [];
    for (const h of p.hammers) {
      if (h.room !== this.room || this.time - h.at > h.life + 0.5) { h.pr.life = 0; continue; } // room changed (projectiles were cleared), or the hero was down for the whole flight
      if (this.projs.indexOf(h.pr) < 0) { // a wall stopped it on an outward leg: turn around from the last free position; on the way home it is lost
        if (h.leg & 1) continue;
        const a = Math.atan2(p.y - h.y, p.x - h.x);
        h.pr = this.spawnProj({ team: 0, kind: 'hammer', x: h.x, y: h.y, a, speed: HAMMER_BACK, r: h.pr.r, dmg: 0, life: Math.max(0.4, h.life - h.t), pierce: 999, owner: p.pid });
        h.pr.hit = NO_HIT; h.leg++; h.legT = 0; h.hit.clear();
        this.emit({ t: 'hturn', x: rnd(h.x), y: rnd(h.y), n: h.leg, pid: p.pid });
      }
      const pr = h.pr;
      h.t += dt; h.legT += dt;
      if (!(h.leg & 1) && h.legT >= out) { h.leg++; h.legT = 0; h.hit.clear(); this.emit({ t: 'hturn', x: rnd(pr.x), y: rnd(pr.y), n: h.leg, pid: p.pid }); }
      if (h.leg & 1) {
        const dx = p.x - pr.x, dy = p.y - 4 - pr.y, d = Math.hypot(dx, dy) || 1;
        if (d < p.r + 8) {
          const again = h.leg === 1 && st.thirdLeg;
          this.emit({ t: 'hturn', x: rnd(pr.x), y: rnd(pr.y), n: again ? 2 : 4, pid: p.pid });
          if (!again) { pr.life = 0; continue; }
          h.leg = 2; h.legT = 0; h.hit.clear(); pr.vx = Math.cos(h.a) * HAMMER_SPEED; pr.vy = Math.sin(h.a) * HAMMER_SPEED;
        } else if (h.t > h.life - 0.1) { pr.life = 0; continue; }
        else { pr.vx = dx / d * HAMMER_BACK; pr.vy = dy / d * HAMMER_BACK; }
      }
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0 || h.hit.has(e.id)) continue;
        if (U.dist2(pr.x, pr.y, e.x, e.y) > (e.r + pr.r) ** 2) continue;
        h.hit.add(e.id);
        judgeFoe(e, p, 4 + st.judgeDur, true); // judged before the hit lands: the leg itself takes the +20%
        this.hitEnemy(e, q.dmg, this.partSrc(p, N, 'leg', { knock: 90, kx: pr.vx / sp, ky: pr.vy / sp, x: pr.x, y: pr.y, infAdd: { holy: 0.5 } }));
      }
      h.x = pr.x; h.y = pr.y;
      keep.push(h);
    }
    p.hammers = keep;
  };

  // The Judged foe's owner for Verdict: the Judge if it has Verdict, else the first standing Cleric that has.
  function verdictOwner(w, e) {
    const o = w.players.get(e.judgeOwner);
    if (o && o.cls === 'cleric' && o.stats.verdict && !o.downed && !o.dead) return o;
    for (const q of w.players.values()) if (q.cls === 'cleric' && q.stats.verdict && !q.downed && !q.dead) return q;
    return null;
  }

  ED.CLS.cleric = {
    init(p) { p.hammers = []; },
    tick(p, dt) { if (p.hammers.length) this.updateHammers(p, dt); },
    // Radiant Faith: every weapon hit stores Radiance for wInfHoly (Consecrate's rate counts instead when it is higher)
    attackOpts(p, st) { return holyAdd(st); },
    // The regular wave of an attack: Sunhammer (twice as wide, 60% farther, stuns), Crusader (steers inside the cone; Litany sends the 6th attack's wave as a fan of three), Radiant Faith (Radiance)
    waveShot(p, pr, a, st) {
      pr.part = 'wave';
      if (st.waveBig) { pr.r *= 2; pr.life *= 1.6; }
      if (st.waveStun) pr.stun = st.waveStun;
      if (st.waveHome) { pr.homing = st.waveHome; pr.homeA0 = a; pr.homeCone = C.WAVE_CONE; }
      const ha = holyAdd(st);
      if (ha) pr.infAdd = ha.infAdd;
      if (st.litany && p.atkCount % st.litany === 0) {
        for (const d of [-FAN, FAN]) this.spawnProj({ team: 0, kind: 'wave', x: pr.x, y: pr.y, a: a + d, speed: Math.hypot(pr.vx, pr.vy), r: pr.r, dmg: pr.dmg, life: pr.life, pierce: pr.pierce, owner: pr.owner, knock: pr.knock, wpn: true, part: 'wave', stun: pr.stun, infAdd: pr.infAdd, homing: pr.homing, homeA0: a + d, homeCone: pr.homeCone });
      }
    },
    // Solar Flare: a wave that ends (range or wall) bursts for waveBurst of its damage
    projEnd(pr, owner, why) {
      const st = owner.stats;
      if (pr.kind !== 'wave' || !st.waveBurst) return;
      const r = FLARE_R * (1 + st.area * 0.5), dmg = pr.dmg * st.waveBurst;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0) continue;
        const d = Math.hypot(e.x - pr.x, e.y - pr.y);
        if (d >= r + e.r) continue;
        this.hitEnemy(e, dmg, { p: owner, kind: 'explode', wpn: true, part: 'solar', knock: 90, kx: (e.x - pr.x) / (d || 1), ky: (e.y - pr.y) / (d || 1), noGuard: true, crit: false, infAdd: pr.infAdd, x: pr.x, y: pr.y });
      }
      this.emit({ t: 'solar', x: rnd(pr.x), y: rnd(pr.y), r: rnd(r), pid: owner.pid });
    },
    // A Judged foe that dies: Verdict bursts it (queued, the Verdict owner deals it), and the allies within 160 of a hammer-Judged death get a shield once per cast (3% of max HP, class window)
    kill(e) {
      if (!(e.judged > 0)) return;
      const vo = verdictOwner(this, e);
      if (vo) this.queuePayoff(vo, { kind: 'verdict', e, x: e.x, y: e.y });
      const o = this.players.get(e.judgeOwner);
      if (!o || o.cls !== 'cleric') return;
      for (const q of this.players.values()) {
        if (q.downed || q.dead || U.dist2(q.x, q.y, e.x, e.y) > 160 * 160 || q.judgeGot[o.pid] === e.judgeCast) continue;
        q.judgeGot[o.pid] = e.judgeCast;
        this.addShield(q, q.maxHp * 0.03, q.maxHp * C.CLASS_SHIELD_CAP, 'class');
      }
    },
    // Chain payoffs (combat.js runPayoff): Verdict (r70 Holy burst at the dead foe, stun; Sentence Judges the foes it hits before the blow) and Prism's beam (half the Smite to the nearest other foe within 120; Sunburst jumps once more at half again).
    payoff(en) {
      const o = en.tr, st = o.stats;
      if (en.kind === 'verdict') {
        const N = ED.Stats.skillNums('judgment', st), v = N.p.verdict;
        if (!v.on) return;
        if (st.verdictJudge) for (const f of this.enemies) if (live(f) && U.dist2(f.x, f.y, en.x, en.y) < (v.r + f.r) ** 2) judgeFoe(f, o, 4 + st.judgeDur, false);
        this.skillBlast(o, en.x, en.y, v.r, v.dmg, this.partSrc(o, N, 'verdict', { knock: 90, infAdd: { holy: 0.5 } }), (f) => { if (f.hp > 0) this.stunFoe(f, v.stun, true); });
        this.emit({ t: 'verdict', x: rnd(en.x), y: rnd(en.y), r: rnd(v.r), pid: o.pid });
        return;
      }
      const hit = en.hit || (en.hit = new Set([en.e.id]));
      let best = null, bd = BEAM_R * BEAM_R;
      for (const f of this.enemies) {
        if (!live(f) || f.invulnT > 0 || hit.has(f.id)) continue;
        const d2 = U.dist2(f.x, f.y, en.x, en.y);
        if (d2 <= bd) { bd = d2; best = f; }
      }
      if (!best) return;
      hit.add(best.id);
      this.emit({ t: 'chain', k: 'b', pts: [[rnd(en.x), rnd(en.y)], [rnd(best.x), rnd(best.y)]] });
      this.hitEnemy(best, en.amt, { p: o, kind: 'beam', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', affDone: true, x: en.x, y: en.y });
      if (en.jumps > 0) this.queuePayoff(o, { kind: 'beam', e: best, x: best.x, y: best.y, amt: en.amt * 0.5, jumps: en.jumps - 1, hit });
    },
  };

  // Hit options of Radiant Faith, cached on the stat block: { infAdd: { holy: rate } } or null
  function holyAdd(st) {
    if (st.holyAdd === undefined) { const r = Math.max(0, st.wInfHoly - st.holyInfuse); st.holyAdd = r > 0 ? { infAdd: { holy: r } } : null; }
    return st.holyAdd;
  }
})(globalThis.ED || (globalThis.ED = {}));
