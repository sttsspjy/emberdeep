// Shade: Shadowstep and Vanish (base kits from ED.SKILLS numbers), the Shade route cards that act on them (Momentum, execution crits, Whirlwind, Twin Cut, Afterimage, Ambush rules, Veil, Open Veins, Rupture) and the hook table ED.CLS.shade.
// Skill forms (rank 3): Death Blossom (a chain of blinks), Hall of Mirrors (three decoys), Eclipse (a dome where every attack is an Ambush), Umbral Veil (a shadow clone that repeats the weapon and draws foes).
// Hero fields: momN / momT (Momentum), stepQ (Twin Cuts waiting), ambSet / ambTgt / ambMul / ambRef / ambRupt (the Ambush in flight: foes it struck, sweep targets, its damage factor, Shadowstep refunded, target ruptured),
// bloom (Death Blossom chains), dome ({ z, room } of the Eclipse dome the hero stands in), ambFac / eclipseRe (the Ambush in flight is an Eclipse repeat at that damage factor), projMark (highest shot id seen by the last attack hook), clone ({ z, stand, room } of the Umbral Veil clone).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, W = ED.World.prototype;
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const R = Math.round;
  // MOM_T: seconds Momentum lasts after the latest crit. LURE_T: the last seconds of an Afterimage fuse in which Lure pulls foes in. RUPT_R: splash radius of a Rupture, BLOOM_R: reach of Bloodbloom.
  // BLOSSOM_GAP / BLOSSOM_REACH: seconds between two Death Blossom blinks and the px within which the next foe must stand. MIRROR_OFF: px from the start point of a Hall of Mirrors image.
  Object.assign(C, { MOM_T: 2.5, LURE_T: 0.3, RUPT_R: 60, RUPT_MUL: 1.5, BLOOM_R: 80, BLOSSOM_GAP: 0.1, BLOSSOM_REACH: 120, MIRROR_OFF: 50 });

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
  // seen (a Set of foe ids): foes in it are skipped and the ones cut are added; extra: fields added to the hit's source (a Death Blossom cut carries its chain).
  function cutPath(w, p, N, part, x0, y0, x1, y1, a, seen, extra) {
    const sl = N.p.slash;
    let cut = 0;
    for (let i = 0, n = w.enemies.length; i < n; i++) {
      const e = w.enemies[i];
      if (!hittable(e) || (seen && seen.has(e.id)) || U.segDist2(e.x, e.y, x0, y0, x1, y1) >= (e.r + sl.reach) ** 2) continue;
      if (cutFoe(w, p, N, part, e, a, seen, extra)) cut++;
    }
    return cut;
  }
  function cutFoe(w, p, N, part, e, a, seen, extra) {
    const st = p.stats, q = N.p[part], sl = N.p.slash, mul = st.assassinate && e.hp < e.maxHp * 0.5 ? 1 + st.assassinate : undefined;
    if (seen) seen.add(e.id);
    const o = { crit: true, kx: Math.cos(a), ky: Math.sin(a), knock: sl.knock, mul };
    const dealt = w.hitEnemy(e, q.dmg, w.partSrc(p, N, part, extra ? Object.assign(o, extra) : o));
    if (st.rupture && e.hp > 0) w.rupture(e, p, st.rupture, 'step.rupture', false);
    return dealt > 0;
  }

  // Shadowstep: the client has already moved the hero from (x0, y0) to (x1, y1); every foe on that path takes a guaranteed crit and the hero readies crit attacks (3, +stepStack per foe cut, scaled by the weapon's critK).
  // Twin Cut queues the same path again; Afterimage leaves a decoy at the start that bursts (and, with Lure, first pulls foes in); Hall of Mirrors leaves three; Death Blossom starts a chain of blinks from the landing point.
  ED.CAST.step = function (p, a, data, st, N) {
    const near = (x, y) => fin(x) && fin(y) && U.dist2(x, y, p.x, p.y) < (N.range + 80) ** 2;
    const x0 = near(data.x0, data.y0) ? data.x0 : p.x, y0 = near(data.x0, data.y0) ? data.y0 : p.y, x1 = near(data.x1, data.y1) ? data.x1 : p.x, y1 = near(data.x1, data.y1) ? data.y1 : p.y;
    const seen = N.p.blossom.on ? new Set() : null;
    const cut = cutPath(this, p, N, 'slash', x0, y0, x1, y1, a, seen);
    this.grantCrits(p, 3 + st.stepStack * cut, 3 + st.stackMax, 'set');
    if (N.p.twin.on) p.stepQ.push({ t: N.p.twin.delay, x0, y0, x1, y1, a, room: this.room });
    if (N.p.mirror.on) for (let k = 0; k < N.p.mirror.n; k++) {
      const an = a + Math.PI + k * U.TAU / N.p.mirror.n, ex = x0 + Math.cos(an) * C.MIRROR_OFF, ey = y0 + Math.sin(an) * C.MIRROR_OFF;
      const e = ED.Sim.los(this.room, x0, y0, ex, ey, this.locked) && !ED.Dungeon.blocksShots(ED.Dungeon.tileAt(this.room, ex, ey), this.locked) ? { x: ex, y: ey } : ED.Sim.castMove(this.room, x0, y0, an, C.MIRROR_OFF, 4, this.locked); // an image stands exactly on the circle unless a wall is in the way
      this.addAfterimage(p, e.x, e.y, N.p.mirror, 'mirror', 1);
    } else if (N.p.after.on) this.addAfterimage(p, x0, y0, N.p.after);
    if (seen) p.bloom.push({ t: C.BLOSSOM_GAP, x: x1, y: y1, seen, hops: 0, extra: 0, room: this.room });
    this.emit({ t: 'blink', pid: p.pid, x0: R(x0), y0: R(y0), x1: R(x1), y1: R(y1) });
    return {};
  };

  // Death Blossom: every C.BLOSSOM_GAP seconds the hero blinks to the nearest foe (with a clear line) that the chain has not cut within BLOSSOM_REACH of where it stands, and the blink cuts every foe on its way for the blossom part (a crit).
  // A chain makes blossomN blinks, one more for each foe a cut kills (horde foes excepted), at most blossomMax; the hero is untouchable meanwhile. The hero's place moves here (a remote hero's client gets a 'blink' message).
  function blossomHop(w, p, c) {
    const st = p.stats, N = ED.Stats.skillNums('step', st);
    if (c.hops >= Math.min(st.blossomMax, st.blossomN + c.extra)) return false;
    let tg = null, bd = C.BLOSSOM_REACH * C.BLOSSOM_REACH;
    for (let i = 0, n = w.enemies.length; i < n; i++) {
      const e = w.enemies[i];
      if (!hittable(e) || c.seen.has(e.id)) continue;
      const d2 = U.dist2(e.x, e.y, c.x, c.y);
      if (d2 < bd && ED.Sim.los(w.room, c.x, c.y, e.x, e.y, w.locked)) { bd = d2; tg = e; }
    }
    if (!tg) return false;
    const an = Math.atan2(tg.y - c.y, tg.x - c.x), end = ED.Sim.castMove(w.room, c.x, c.y, an, Math.max(0, Math.sqrt(bd) - (tg.r + p.r + 2)), p.r, w.locked), x0 = c.x, y0 = c.y;
    cutPath(w, p, N, 'blossom', x0, y0, end.x, end.y, an, c.seen, { bloom: c });
    if (!c.seen.has(tg.id) && hittable(tg)) cutFoe(w, p, N, 'blossom', tg, an, c.seen, { bloom: c });
    c.x = end.x; c.y = end.y; c.hops++;
    p.x = end.x; p.y = end.y; p.invuln = Math.max(p.invuln, C.BLOSSOM_GAP + 0.05);
    if (p.remote) w.msgs.push({ to: p.pid, t: 'blink', x: R(end.x), y: R(end.y) });
    w.emit({ t: 'blossom', pid: p.pid, x0: R(x0), y0: R(y0), x1: R(end.x), y1: R(end.y), tx: R(tg.x), ty: R(tg.y), n: c.hops });
    return true;
  }
  function stepBlossom(w, p, dt) {
    const L = p.bloom;
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      if (c.room !== w.room) { L.splice(i, 1); continue; }
      if ((c.t -= dt) > 0) continue;
      if (blossomHop(w, p, c)) c.t += C.BLOSSOM_GAP; else L.splice(i, 1);
    }
  }

  // The decoy zone of an Afterimage (part 'after') or of a Hall of Mirrors image (part 'mirror', zone tag w 1): bursts after its fuse (the part's delay); with Lure it first pulls foes in.
  W.addAfterimage = function (p, x, y, q, part, tag) {
    part = part || 'after';
    this.addZone({ kind: 'decoy', x, y, r: q.r, dur: q.delay, team: 0, owner: p.pid, custom: true, w: tag || 0,
      update: (w, z) => { if (!z.lured && z.t >= z.dur - C.LURE_T) { z.lured = true; const o = w.players.get(z.owner); if (o && o.stats.afterPull > 0) lure(w, o, z); } },
      onEnd: (w, z) => {
        const o = w.players.get(z.owner); if (!o) return;
        const N = ED.Stats.skillNums('step', o.stats), b = N.p[part];
        w.skillBlast(o, z.x, z.y, z.r, b.dmg, w.partSrc(o, N, part, { noProc: true }), (e) => {
          if (e.hp > 0 && !e.boss && e.blindCd <= 0) { e.blind = Math.max(e.blind, b.blind * (e.elite ? 0.5 : 1)); e.blindCd = C.BLIND_CD; }
        });
        w.emit({ t: 'after', pid: o.pid, x: R(z.x), y: R(z.y), r: R(z.r), k: tag || 0 });
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
  // Veil of Night shields the hero once per 12 s (the class shield window bounds it); Shroud's longer smoke is the card's s2Dur.
  // Eclipse: the smoke is a dome (zone tag w 2) the hero stays unseen in and where every attack is an Ambush (see stepDome); Umbral Veil: a shadow clone is left where the hero stood.
  ED.CAST.vanish = function (p, a, data, st, N) {
    const dome = N.p.dome.on, sm = dome ? N.p.dome : N.p.smoke, bl = N.p.blind, stealth = dome ? sm.dur : 2.5 + st.stealthDur, bud = {};
    p.stealthT = stealth; p.ambush = true; p.ambushT = stealth + 0.5; p.ambFac = 1; p.eclipseRe = false;
    const zone = this.addZone({ kind: 'smoke', x: p.x, y: p.y, r: sm.r, dur: sm.dur, team: 0, owner: p.pid, custom: true, w: dome ? 2 : 0,
      update: (world, z, dt) => {
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          world.slowEnemy(e, st.shroud ? 0.6 : sm.slow, 0.3);
          if (st.smokeVuln || dome) e.vulnT = Math.max(e.vulnT || 0, 0.3);
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
    p.dome = dome ? { z: zone, room: this.room } : null;
    if (N.p.clone.on) spawnClone(this, p, N.p.clone);
    return dome ? { dome: 1 } : {};
  };

  // Eclipse, once per tick while the dome stands: a hero inside is unseen (stealth refreshed) and always holds an Ambush ready; the extra ones (p.eclipseRe) deal eclipse of the Ambush (critMul). Leaving or the dome's end drops them.
  function stepDome(w, p) {
    const d = p.dome, z = d.z, inside = d.room === w.room && z.t < z.dur && !p.downed && U.dist2(p.x, p.y, z.x, z.y) < z.r * z.r;
    if (!inside) {
      if (p.eclipseRe) { p.ambush = false; p.eclipseRe = false; }
      if (d.room !== w.room || z.t >= z.dur || p.downed) p.dome = null;
      return;
    }
    p.stealthT = Math.max(p.stealthT, 0.3);
    if (!p.ambush) { p.ambush = true; p.eclipseRe = true; }
    p.ambushT = Math.max(p.ambushT, 0.3);
  }
  // True for an Ambush hit that is an Eclipse repeat: a shot tagged vanish.edge, a sweep from a repeat (src.ambRe), or a melee hit while the swing in flight is a repeat (p.ambFac < 1).
  const isRepeat = (p, src) => src.part === 'vanish.edge' || !!src.ambRe || (src.dist === undefined && !src.sweep && !src.part && (p.ambFac || 1) < 1);

  // Umbral Veil: a clone zone (kind decoy, tag w 2) where the hero stood. Foes (not bosses) near it that would otherwise go for something farther take it as their target (a position-only stand-in, like a lost hero's last known spot);
  // the hero's weapon attacks are repeated from its spot (cloneAttack).
  function spawnClone(w, p, q) {
    if (p.clone) p.clone.z.dur = p.clone.z.t;
    const stand = { x: p.x, y: p.y, vx: 0, vy: 0, clone: true };
    const z = w.addZone({ kind: 'decoy', x: p.x, y: p.y, r: 16, dur: q.dur, team: 0, owner: p.pid, custom: true, w: 2,
      update: (world, zz) => {
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.boss || e.def.invuln) continue;
          if (e.target === stand) { e.tgtT = Math.max(e.tgtT, 0.25); continue; }
          if (!e.target || U.dist2(e.x, e.y, stand.x, stand.y) < U.dist2(e.x, e.y, e.target.x, e.target.y)) { e.target = stand; e.tgtT = 0.3; }
        }
      },
      onEnd: (world, zz) => {
        for (const e of world.enemies) if (e.target === stand) e.tgtT = 0;
        const o = world.players.get(p.pid);
        if (o && o.clone && o.clone.z === zz) o.clone = null;
      } });
    p.clone = { z, stand, room: w.room };
    w.emit({ t: 'clone', pid: p.pid, x: R(p.x), y: R(p.y), d: q.dur });
  }
  // The clone repeats the hero's weapon attack (angle a) from its own spot at cloneMul: the hero stands there for the call (a twin attack: weapon part only, no counters), and the swing event it emits is re-addressed to the clone.
  function cloneAttack(w, p, a) {
    const c = p.clone;
    if (!c || c.room !== w.room || c.z.t >= c.z.dur) return;
    const x = p.x, y = p.y, n0 = w.fx.length;
    p.x = c.z.x; p.y = c.z.y;
    try { w.playerAttack(p, a, p.stats.cloneMul); } finally { p.x = x; p.y = y; }
    for (let i = w.fx.length - 1; i >= n0; i--) { const ev = w.fx[i]; if (ev.t === 'swing' && ev.pid === p.pid) w.fx[i] = { t: 'cloneswing', pid: p.pid, x: R(c.z.x), y: R(c.z.y), a: ev.a, r: ev.r, arc: ev.arc }; }
  }

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
      p.stepQ = []; p.ambSet = null; p.ambTgt = []; p.ambMul = 1; p.ambRef = false; p.ambRupt = false; p.bloom = []; p.dome = null; p.ambFac = 1; p.eclipseRe = false; p.projMark = 0; p.clone = null;
    },
    // Momentum runs out as a whole; Twin Cuts fire when their delay is up; the Ambush Sweep strikes after the Ambush's own hits have landed; Death Blossom chains hop and the Eclipse dome holds its Ambush ready.
    tick(p, dt) {
      if (p.momT > 0 && (p.momT -= dt) <= 0) p.momN = 0;
      if (p.bloom.length) stepBlossom(this, p, dt);
      if (p.dome) stepDome(this, p);
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
            this.hitEnemy(o, w.dmg, { p, kind: 'weapon', part: 'vanish.sweep', wpn: true, crit: true, mul: t.mul, ambush: true, sweep: true, ambRe: t.re, knock: w.knock, kx: (o.x - t.x) / (d || 1), ky: (o.y - t.y) / (d || 1), x: t.x, y: t.y });
          }
        }
      }
    },
    // An Ambush attack starts: a fresh set of foes it has struck, nothing refunded yet; an Eclipse repeat deals eclipse of the Ambush (ambFac, read by critMul).
    ambush(p, st) {
      p.ambSet = new Set(); p.ambTgt.length = 0; p.ambRef = false; p.ambRupt = false;
      p.ambFac = p.eclipseRe ? st.eclipse : 1; p.eclipseRe = false;
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
    // Open Veins: crits deal +veins per ailment on the foe (up to 4). Eclipse: the Ambush crit of a repeat is eclipse of the full one (the Ambush is a forced crit, so this scales its whole damage).
    critMul(p, e, src) {
      const v = p.stats.veins;
      let f = v > 0 ? 1 + v * Math.min(4, this.ailments(e)) : 1;
      if (src.ambush && p.stats.eclipse > 0 && isRepeat(p, src)) { src.ambRe = true; f *= p.stats.eclipse; }
      return f;
    },
    // A crit builds Momentum; Exsanguinate: a crit on a foe with 4 ailments adds Bleed equal to exsang of the hit (damage before the affinity, status power applied).
    procs(e, p, dmg, crit, src) {
      if (!crit) return;
      const st = p.stats;
      gainMom(p, 1);
      if (st.exsang > 0 && e.hp > 0 && this.ailments(e) >= 4) this.addBleed(e, dmg / (src.affMul || 1) * st.exsang * (1 + st.statusPow), p);
    },
    // After a hit: the execution slash; an Ambush hit (Night's Edge: the first one on a foe that is not a horde foe refunds Shadowstep, never an Eclipse repeat; Rupture: each foe once; Ambush Sweep: remember the target).
    hitDone(p, e, dmg, crit, src) {
      if (src.rupt || src.sweep) return;
      const re = !!src.ambush && isRepeat(p, src);
      if (src.ambush && !src.part) src.part = re ? 'vanish.edge' : 'vanish.ambush'; // the Ambush hits are the Vanish skill's damage (damage report)
      if (src.exec && crit) this.emit({ t: 'exec', pid: p.pid, x: R(e.x), y: R(e.y), a: R(Math.atan2(e.y - p.y, e.x - p.x) * 100) / 100 });
      if (!src.ambush || !p.ambSet) return;
      const st = p.stats;
      if (st.nightsEdge && !p.ambRef && !re && !e.fodder) { p.ambRef = true; this.refundSkill(p, 0); this.emit({ t: 'sref', pid: p.pid, slot: 0, x: R(p.x), y: R(p.y) }); }
      if (p.ambSet.has(e.id)) return;
      p.ambSet.add(e.id);
      if (st.ambushCleave > 0) p.ambTgt.push({ x: e.x, y: e.y, mul: src.mul, re });
      if (st.rupture && e.hp > 0 && !p.ambRupt) { p.ambRupt = true; this.rupture(e, p, st.rupture, 'vanish.rupture', true); }
    },
    // After an attack: an Eclipse repeat tags its shots (vanish.edge) and the next Ambush is armed again while the hero stands in the dome; the Umbral Veil clone repeats the attack; Whirlwind (Thousand Cuts rider):
    // at full Momentum every 4th attack also spins around the hero at bladeStorm of the weapon (knives: a ring of 6).
    attack(p, a, st, w) {
      if (st.eclipse > 0 && p.dome) {
        if (p.ambFac < 1) for (let i = this.projs.length - 1; i >= 0; i--) { const pr = this.projs[i]; if (pr.id <= p.projMark) break; if (pr.owner === p.pid && pr.ambush && !pr.part) pr.part = 'vanish.edge'; } // the shots this attack fired (ids above the mark of the last one)
        if (this.projs.length) p.projMark = this.projs[this.projs.length - 1].id;
        if (p.dome.room === this.room && p.dome.z.t < p.dome.z.dur && U.dist2(p.x, p.y, p.dome.z.x, p.dome.z.y) < p.dome.z.r * p.dome.z.r) { p.ambush = true; p.ambushT = Math.max(p.ambushT, 0.3); p.eclipseRe = true; p.stealthT = Math.max(p.stealthT, 0.3); }
      }
      if (st.umbral > 0 && p.clone) cloneAttack(this, p, a);
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
    // Kills: an Ambush kill refunds Vanish (Night's Edge, once per 3 s; never an Eclipse repeat); a Shadowstep kill refunds Shadowstep (Assassinate, once per 1.5 s); neither refund comes from a horde foe.
    // A Death Blossom cut that kills a foe (not a horde foe) adds a blink to its chain; an execution crit that kills grants Momentum (Killing Rhythm).
    kill(e, p, src) {
      if (!p || p.cls !== 'shade' || !src) return;
      const st = p.stats;
      if (src.ambush && st.nightsEdge && p.edgeT <= 0 && !e.fodder && !isRepeat(p, src)) { p.edgeT = 3; this.refundSkill(p, 1); this.emit({ t: 'sref', pid: p.pid, slot: 1, x: R(p.x), y: R(p.y) }); }
      if (st.assassinate && isStep(src.part) && p.stepRefT <= 0 && !e.fodder) { p.stepRefT = 1.5; this.refundSkill(p, 0); this.emit({ t: 'sref', pid: p.pid, slot: 0, x: R(p.x), y: R(p.y) }); }
      if (src.bloom && !e.fodder) src.bloom.extra++;
      if (st.execMom > 0 && src.exec && src.critOut) gainMom(p, st.execMom);
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
