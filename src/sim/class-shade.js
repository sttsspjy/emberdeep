// Shade: Shadowstep and Vanish (base kits from ED.SKILLS numbers), the Shade route cards that act on them (Momentum, execution crits, Whirlwind, Twin Cut, Afterimage, Ambush rules, Veil, Open Veins, Rupture) and the hook table ED.CLS.shade.
// Hero fields: momN / momT (Momentum), stepQ (Twin Cuts waiting), ambSet / ambTgt / ambMul / ambRef (the Ambush in flight: foes it struck, sweep targets, its damage factor, Shadowstep refunded).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, W = ED.World.prototype;
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const R = Math.round;
  // MOM_T: seconds Momentum lasts after the latest crit. LURE_T: the last seconds of an Afterimage fuse in which Lure pulls foes in. RUPT_R: splash radius of a Rupture, BLOOM_R: reach of Bloodbloom.
  Object.assign(C, { MOM_T: 2.5, LURE_T: 0.3, RUPT_R: 60, RUPT_MUL: 1.5, BLOOM_R: 80 });

  // Raises Momentum by n stacks (cap momMax) and restarts its timer.
  function gainMom(p, n) {
    const st = p.stats;
    if (!(st.momMax > 0)) return;
    p.momN = Math.min(st.momMax, p.momN + n); p.momT = C.MOM_T;
  }
  // A weapon hit on a foe below the Culling Blades threshold is an execution: it always crits, and src.exec marks it.
  const isExec = (p, e, src) => p.stats.execCrit > 0 && src.wpn && e.hp < e.maxHp * p.stats.execCrit;
  const isStep = (part) => !!part && part.indexOf('step.') === 0 && part !== 'step.after';
  const hittable = (e) => e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed;

  // Every foe within its radius + the slash reach of the path (x0, y0) to (x1, y1) takes part q of Shadowstep (a crit; Assassinate adds to foes below half health) and is ruptured with Rupture. Returns the foes cut.
  function cutPath(w, p, N, part, x0, y0, x1, y1, a) {
    const st = p.stats, q = N.p[part], sl = N.p.slash, kx = Math.cos(a), ky = Math.sin(a);
    let cut = 0;
    for (let i = 0, n = w.enemies.length; i < n; i++) {
      const e = w.enemies[i];
      if (!hittable(e) || U.segDist2(e.x, e.y, x0, y0, x1, y1) >= (e.r + sl.reach) ** 2) continue;
      const mul = st.assassinate && e.hp < e.maxHp * 0.5 ? 1 + st.assassinate : undefined;
      if (w.hitEnemy(e, q.dmg, w.partSrc(p, N, part, { crit: true, kx, ky, knock: sl.knock, mul })) > 0) cut++;
      if (st.rupture && e.hp > 0) w.rupture(e, p, st.rupture, 'step.rupture', false);
    }
    return cut;
  }

  // Shadowstep: the client has already moved the hero from (x0, y0) to (x1, y1); every foe on that path takes a guaranteed crit and the hero readies crit attacks (3, +stepStack per foe cut, scaled by the weapon's critK).
  // Twin Cut queues the same path again; Afterimage leaves a decoy at the start that bursts (and, with Lure, first pulls foes in).
  ED.CAST.step = function (p, a, data, st, N) {
    const near = (x, y) => fin(x) && fin(y) && U.dist2(x, y, p.x, p.y) < (N.range + 80) ** 2;
    const x0 = near(data.x0, data.y0) ? data.x0 : p.x, y0 = near(data.x0, data.y0) ? data.y0 : p.y, x1 = near(data.x1, data.y1) ? data.x1 : p.x, y1 = near(data.x1, data.y1) ? data.y1 : p.y;
    const cut = cutPath(this, p, N, 'slash', x0, y0, x1, y1, a);
    this.grantCrits(p, 3 + st.stepStack * cut, 3 + st.stackMax, 'set');
    if (N.p.twin.on) p.stepQ.push({ t: N.p.twin.delay, x0, y0, x1, y1, a, room: this.room });
    if (N.p.after.on) this.addAfterimage(p, x0, y0, N.p.after);
    this.emit({ t: 'blink', pid: p.pid, x0: R(x0), y0: R(y0), x1: R(x1), y1: R(y1) });
    return {};
  };

  // The decoy zone of an Afterimage: bursts after its fuse (the part's delay).
  W.addAfterimage = function (p, x, y, q) {
    this.addZone({ kind: 'decoy', x, y, r: q.r, dur: q.delay, team: 0, owner: p.pid, custom: true,
      update: (w, z) => { if (!z.lured && z.t >= z.dur - C.LURE_T) { z.lured = true; const o = w.players.get(z.owner); if (o && o.stats.afterPull > 0) lure(w, o, z); } },
      onEnd: (w, z) => {
        const o = w.players.get(z.owner); if (!o) return;
        const N = ED.Stats.skillNums('step', o.stats), b = N.p.after;
        w.skillBlast(o, z.x, z.y, z.r, b.dmg, w.partSrc(o, N, 'after', { noProc: true }), (e) => {
          if (e.hp > 0 && !e.boss && e.blindCd <= 0) { e.blind = Math.max(e.blind, b.blind * (e.elite ? 0.5 : 1)); e.blindCd = C.BLIND_CD; }
        });
        w.emit({ t: 'after', pid: o.pid, x: R(z.x), y: R(z.y), r: R(z.r) });
      } });
  };

  // Lure: non-boss foes with a clear line within afterPull of the decoy are dragged toward it (elites 0.45 of the way) just before the burst.
  function lure(w, p, z) {
    const pull = p.stats.afterPull, pts = [];
    for (let i = 0, n = w.enemies.length; i < n; i++) {
      const e = w.enemies[i];
      if (!hittable(e) || e.boss) continue;
      const dx = z.x - e.x, dy = z.y - e.y, d = Math.hypot(dx, dy);
      if (d > pull + e.r || d < 16 || !ED.Sim.los(w.room, e.x, e.y, z.x, z.y, w.locked)) continue;
      const v = 9 * (d - 14) * (e.elite ? 0.45 : 1) / d; // knockback speed that decays at 9 per second travels v / 9 px
      e.kbx += dx * v; e.kby += dy * v;
      if (pts.length < 10) pts.push([R(e.x), R(e.y)]);
    }
    w.emit({ t: 'lure', pid: p.pid, x: R(z.x), y: R(z.y), pts });
  }

  // Vanish: smoke that slows foes and blinds each non-boss foe inside for a budget (elites half, then a cooldown); the hero is unseen for a while and the next attack is an Ambush.
  // Veil of Night shields the hero once per 12 s, Shroud adds 2 s to the smoke.
  ED.CAST.vanish = function (p, a, data, st, N) {
    const sm = N.p.smoke, bl = N.p.blind, stealth = 2.5 + st.stealthDur, bud = {};
    p.stealthT = stealth; p.ambush = true; p.ambushT = stealth + 0.5;
    this.addZone({ kind: 'smoke', x: p.x, y: p.y, r: sm.r, dur: sm.dur + (st.shroud ? 2 : 0), team: 0, owner: p.pid, custom: true,
      update: (world, z, dt) => {
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          world.slowEnemy(e, st.shroud ? 0.6 : sm.slow, 0.3);
          if (st.smokeVuln) e.vulnT = Math.max(e.vulnT || 0, 0.3);
          if (e.boss) continue;
          const cap = bl.dur * (e.elite ? 0.5 : 1);
          if ((bud[e.id] || 0) < cap && e.blindCd <= 0) {
            e.blind = Math.max(e.blind || 0, 0.3); bud[e.id] = (bud[e.id] || 0) + dt;
            if (bud[e.id] >= cap && e.elite) e.blindCd = C.BLIND_CD;
          }
        }
      } });
    for (let i = 0; i < 6; i++) { const an = i * U.TAU / 6; this.emit({ t: 'puff', x: R(p.x + Math.cos(an) * sm.r * 0.5), y: R(p.y + Math.sin(an) * sm.r * 0.5), c: '#8a86a0' }); }
    if (st.veil > 0 && p.veilT <= 0 && this.addShield(p, st.veil * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class') > 0) { p.veilT = 12; this.emit({ t: 'veil', pid: p.pid, x: R(p.x), y: R(p.y) }); }
    return {};
  };

  // Rupture of foe e by hero p: a share f of its Bleed and Burn pools hits at once at RUPT_MUL (the pools lose it), and half of that burst splashes foes within RUPT_R. part names the source (for the damage report);
  // ambush marks the hits as the Ambush's (its kill refund). A foe the rupture kills hands its remaining Bleed to the 2 nearest foes within BLOOM_R with Bloodbloom. Returns the damage dealt to e.
  W.rupture = function (e, p, f, part, ambush) {
    if (!e || e.hp <= 0 || !(f > 0)) return 0;
    const st = p.stats, share = Math.min(1, f), bl = share * e.bleedPool, bn = share * e.burnPool;
    if (!(bl > 0 || bn > 0)) return 0;
    e.bleedPool -= bl; e.burnPool -= bn;
    const dB = bl * C.RUPT_MUL * (1 + st.bleedMul), dF = bn * C.RUPT_MUL * (1 + st.burnMul); // the pool's worth at the rate its ticks pay
    const fire = (o, dmg, bleed) => o.hp > 0 && dmg > 0 ? this.hitEnemy(o, dmg, bleed ? { p, kind: 'rupture', part, raw: true, noProc: true, crit: false, noGuard: true, rupt: true, ambush, bleed: true }
      : { p, kind: 'rupture', part, raw: true, noProc: true, crit: false, noGuard: true, rupt: true, ambush, el: 'fire', affDone: true }) : 0; // burn pools already carry the stratum affinity
    const x = e.x, y = e.y;
    const got = fire(e, dB, true) + fire(e, dF, false);
    for (let i = 0, n = this.enemies.length; i < n; i++) {
      const o = this.enemies[i];
      if (o === e || !hittable(o) || U.dist2(o.x, o.y, x, y) >= (C.RUPT_R + o.r) ** 2) continue;
      fire(o, dB * 0.5, true); fire(o, dF * 0.5, false);
      if (o.hp <= 0 && st.bloodbloom) this.bloodbloom(o, p);
    }
    this.emit({ t: 'rupt', pid: p.pid, x: R(x), y: R(y), k: dB > 0 ? (dF > 0 ? 2 : 0) : 1, r: C.RUPT_R });
    if (e.hp <= 0 && st.bloodbloom) this.bloodbloom(e, p);
    return got;
  };

  // Bloodbloom: half of the dead foe's remaining Bleed to each of the 2 nearest foes within BLOOM_R (a receiver takes at most the spread cap of its own health).
  W.bloodbloom = function (e, p) {
    if (!(e.bleedPool > 0)) return;
    const near = [];
    for (const o of this.enemies) {
      if (o === e || !hittable(o)) continue;
      const d2 = U.dist2(o.x, o.y, e.x, e.y);
      if (d2 < (C.BLOOM_R + o.r) ** 2) near.push({ d2, o });
    }
    near.sort((a, b) => a.d2 - b.d2);
    const src = { hp: 0, bleedPool: e.bleedPool, bleedOwner: e.bleedOwner || p }, pts = [];
    for (let i = 0; i < 2 && i < near.length; i++) { this.moveStatuses(src, near[i].o, 0.5); pts.push([R(near[i].o.x), R(near[i].o.y)]); }
    if (pts.length) this.emit({ t: 'bloom', pid: p.pid, x: R(e.x), y: R(e.y), pts });
  };

  ED.CLS.shade = {
    init(p) {
      p.stepQ = []; p.ambSet = null; p.ambTgt = []; p.ambMul = 1; p.ambRef = false;
    },
    // Momentum runs out as a whole; Twin Cuts fire when their delay is up; the Ambush Sweep strikes after the Ambush's own hits have landed.
    tick(p, dt) {
      if (p.momT > 0 && (p.momT -= dt) <= 0) p.momN = 0;
      if (p.stepQ.length) {
        for (let i = p.stepQ.length - 1; i >= 0; i--) {
          const q = p.stepQ[i];
          if ((q.t -= dt) > 0) continue;
          p.stepQ.splice(i, 1);
          if (q.room !== this.room) continue;
          cutPath(this, p, ED.Stats.skillNums('step', p.stats), 'twin', q.x0, q.y0, q.x1, q.y1, q.a);
          this.emit({ t: 'twincut', pid: p.pid, x0: R(q.x0), y0: R(q.y0), x1: R(q.x1), y1: R(q.y1) });
        }
      }
      if (p.ambTgt.length) {
        const w = p.stats.weapon, rad = p.stats.ambushCleave;
        for (const t of p.ambTgt.splice(0)) {
          for (let i = 0, n = this.enemies.length; i < n; i++) {
            const o = this.enemies[i];
            if (!hittable(o) || p.ambSet.has(o.id)) continue;
            const d = Math.hypot(o.x - t.x, o.y - t.y);
            if (d >= rad + o.r) continue;
            p.ambSet.add(o.id);
            if (!t.shown) { t.shown = true; this.emit({ t: 'sweep', pid: p.pid, x: R(t.x), y: R(t.y), r: rad }); }
            this.hitEnemy(o, w.dmg, { p, kind: 'weapon', part: 'vanish.sweep', wpn: true, crit: true, mul: t.mul, ambush: true, sweep: true, knock: w.knock, kx: (o.x - t.x) / (d || 1), ky: (o.y - t.y) / (d || 1), x: t.x, y: t.y });
          }
        }
      }
    },
    // An Ambush attack starts: a fresh set of foes it has struck, nothing refunded yet.
    ambush(p, st) {
      p.ambSet = new Set(); p.ambTgt.length = 0; p.ambRef = false;
    },
    // Momentum: +momentum damage per stack. Culling Blades marks the execution (a crit is forced in hitCrit; hits with a readied crit are marked here).
    hitMul(p, e, src) {
      if (isExec(p, e, src)) src.exec = true;
      return p.momT > 0 ? p.stats.momentum * p.momN : 0;
    },
    hitCrit(p, e, src) {
      if (!isExec(p, e, src)) return false;
      src.exec = true; return true;
    },
    // Open Veins: crits deal +veins per ailment on the foe (up to 4).
    critMul(p, e, src) {
      const v = p.stats.veins;
      return v > 0 ? 1 + v * Math.min(4, this.ailments(e)) : 1;
    },
    // A crit builds Momentum; Exsanguinate: a crit on a foe with 4 ailments adds Bleed equal to exsang of the hit (damage before the affinity, status power applied).
    procs(e, p, dmg, crit, src) {
      if (!crit) return;
      const st = p.stats;
      gainMom(p, 1);
      if (st.exsang > 0 && e.hp > 0 && this.ailments(e) >= 4) this.addBleed(e, dmg / (src.affMul || 1) * st.exsang * (1 + st.statusPow), p);
    },
    // After a hit: the execution slash; an Ambush hit (Night's Edge: the first one refunds Shadowstep; Rupture: each foe once; Ambush Sweep: remember the target).
    hitDone(p, e, dmg, crit, src) {
      if (src.rupt || src.sweep) return;
      if (src.exec && crit) this.emit({ t: 'exec', pid: p.pid, x: R(e.x), y: R(e.y), a: R(Math.atan2(e.y - p.y, e.x - p.x) * 100) / 100 });
      if (!src.ambush || !p.ambSet) return;
      const st = p.stats;
      if (st.nightsEdge && !p.ambRef) { p.ambRef = true; this.refundSkill(p, 0); this.emit({ t: 'sref', pid: p.pid, slot: 0, x: R(p.x), y: R(p.y) }); }
      if (p.ambSet.has(e.id)) return;
      p.ambSet.add(e.id);
      if (st.ambushCleave > 0) p.ambTgt.push({ x: e.x, y: e.y, mul: src.mul });
      if (st.rupture && e.hp > 0) this.rupture(e, p, st.rupture, 'vanish.rupture', true);
    },
    // Whirlwind (Thousand Cuts rider): at full Momentum every 4th attack also spins around the hero at bladeStorm of the weapon (knives: a ring of 6).
    attack(p, a, st, w) {
      if (!(st.bladeStorm > 0) || !(st.momMax > 0) || p.momN < st.momMax || !(p.momT > 0) || p.atkCount % 4 !== 0) return;
      let r;
      if (w.kind === 'melee') {
        this.meleeSwing(p, a, Object.assign({}, w, { arc: 6.3 }), undefined, 1, { mul: st.bladeStorm, twin: true });
        r = w.range * (1 + st.area * 0.5 + st.meleeReach);
      } else {
        for (let i = 0; i < 6; i++) {
          const an = a + i * U.TAU / 6;
          this.spawnProj({ team: 0, kind: w.proj, x: p.x + Math.cos(an) * 10, y: p.y - 4 + Math.sin(an) * 10, a: an, speed: w.speed, r: w.r, dmg: w.dmg, mul: st.bladeStorm, life: w.life, pierce: w.pierce + st.pierce, owner: p.pid, knock: w.knock || 40 });
        }
        r = w.speed * w.life * 0.5;
      }
      this.emit({ t: 'whirl', pid: p.pid, x: R(p.x), y: R(p.y), r: R(r), k: w.kind === 'melee' ? 0 : 1 });
    },
    // Kills: an Ambush kill refunds Vanish (Night's Edge, once per 3 s); a Shadowstep kill refunds Shadowstep (Assassinate, once per 1.5 s); an execution crit that kills grants Momentum (Killing Rhythm).
    kill(e, p, src) {
      if (!p || p.cls !== 'shade' || !src) return;
      const st = p.stats;
      if (src.ambush && st.nightsEdge && p.edgeT <= 0) { p.edgeT = 3; this.refundSkill(p, 1); this.emit({ t: 'sref', pid: p.pid, slot: 1, x: R(p.x), y: R(p.y) }); }
      if (st.assassinate && isStep(src.part) && p.stepRefT <= 0) { p.stepRefT = 1.5; this.refundSkill(p, 0); this.emit({ t: 'sref', pid: p.pid, slot: 0, x: R(p.x), y: R(p.y) }); }
      if (st.execMom > 0 && src.exec && src.critOut) gainMom(p, st.execMom);
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
