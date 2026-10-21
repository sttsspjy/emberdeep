// Ranger: Volley and Rain of Arrows (base kits from ED.SKILLS numbers), the Ranger route cards that act on them and the hook table ED.CLS.ranger.
// Deadeye, Ballista, Quickdraw, Scattershot and Gangrene read the hit's source fields in hitMul (src.dist = distance flown, src.pass = foes passed, src.part = skill part); Hunter's Mark and Quickdraw's slow hang on hitDone,
// Splitting Bolt on projHit, Flurry on attack, Relentless Hunt and Contagion on kill. Every factor is exact: it multiplies src.mul, not the shared hero multiplier.
(function (ED) {
  'use strict';
  const U = ED.U;

  // Deadeye grows from nothing at FAR_FROM px flown to its full bonus at FAR_TO; a hit from FAR_AT of that ramp carries the far-shot flag. LEAP_R: reach of Relentless Hunt. SPLIT_A / SPLIT_LIFE: Splitting Bolt's fan and flight.
  // FLURRY_A: Flurry's extra arrows. CALTROPS: the Scattershot patch, base + pow x P damage per second, slow, radius, seconds.
  const FAR_FROM = 80, FAR_TO = 260, FAR_AT = 0.75, LEAP_R = 120, SPLIT_A = 0.3, SPLIT_LIFE = 0.4, FLURRY_A = 0.12;
  const CALTROPS = { base: 6, pow: 0.5, r: 50, dur: 2.5, slow: 0.4 };
  const SKILL_PARTS = new Set(['volley.arrow', 'rain.tick', 'rain.sky', 'rain.sky2', 'rain.shower']); // Gangrene's parts

  // Volley: a fan of piercing arrows toward the cursor. Caltrops (Scattershot rank 3) seed the spot the hop leaves.
  ED.CAST.volley = function (p, a, data, st, N) {
    const q = N.p.arrow, n = q.n;
    for (let i = 0; i < n; i++) {
      const ang = a + (n > 1 ? (i / (n - 1) - 0.5) * q.fan : 0);
      this.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y - 4, a: ang, speed: q.speed, r: q.pr, dmg: q.dmg, life: q.life, pierce: q.pierce + st.pierce, owner: p.pid, knock: q.knock, hk: 'skill', part: 'volley.arrow', infK: 1 + st.skillInfK });
    }
    if (st.caltrops) caltrops(this, p, st);
    return {};
  };

  // Caltrops: a patch on the hero's feet; foes inside are slowed and take CALTROPS.base + pow x P per second (the zone's damage-over-time branch).
  function caltrops(w, p, st) {
    const C = CALTROPS;
    w.addZone({ kind: 'shards', x: p.x, y: p.y, r: C.r * (1 + 0.5 * st.area), dur: C.dur, dps: C.base + C.pow * st.power, team: 0, owner: p.pid,
      update: (world, z) => { for (const e of world.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, z.x, z.y) < (z.r + e.r) ** 2) world.slowEnemy(e, C.slow, 0.3); } });
  }

  // Rain of Arrows: after the part's delay an arrow tick every 0.25 s on every foe inside; Skyfall lands the whole Rain as one hit instead.
  ED.CAST.rain = function (p, a, data, st, N) {
    const t = this.groundTarget(p, a, data, 'rain'), q = N.p.tick, sh = N.p.shower, infK = 1 + st.skillInfK, hail = !!st.rainHail;
    if (st.skyfall) {
      const tw = N.p.sky2;
      skyZone(this, p.pid, t.x, t.y, N.p.sky, 'sky', infK, tw.on ? () => skyZone(this, p.pid, t.x, t.y, tw, 'sky2', infK) : null);
    } else {
      rainField(this, p.pid, t.x, t.y, q, { delay: q.delay, part: 'tick', hail, infK,
        onEnd: sh.on ? (world) => { // Second Shower: the Rain falls again on the same spot, already mid-fall (no warm-up)
          const ow = world.players.get(p.pid);
          if (!ow) return;
          world.emit({ t: 'skyfx', x: Math.round(t.x), y: Math.round(t.y), r: Math.round(sh.r), k: 2 });
          rainField(world, p.pid, t.x, t.y, sh, { delay: 0, warm: 0.35, part: 'shower', hail, infK });
        } : null });
    }
    return { tx: Math.round(t.x), ty: Math.round(t.y) };
  };

  // One Rain field: q.count ticks of q.dmg, q.every apart, starting o.delay after the cast; hail slows the foes inside 50% and makes them vulnerable. o.warm: seconds the zone already counts as old (the renderer's warm-up ring).
  function rainField(w, pid, x, y, q, o) {
    let k = 0;
    const t0 = o.warm || 0, part = 'rain.' + o.part;
    const z = w.addZone({ kind: 'rain', x, y, r: q.r, dur: t0 + o.delay + q.dur, team: 0, owner: pid, custom: true,
      update: (world, z) => {
        const tt = z.t - t0;
        if (tt < o.delay) return;
        const ow = world.players.get(pid);
        if (!ow) return;
        const tick = k < q.count && tt >= o.delay + q.every * k;
        if (tick) k++;
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          if (o.hail) { world.slowEnemy(e, 0.5, 0.3); e.vulnT = Math.max(e.vulnT || 0, 0.3); }
          if (tick) world.hitEnemy(e, q.dmg, { p: ow, kind: 'skill', part, noGuard: true, x: z.x, y: z.y, infK: o.infK });
        }
      },
      onEnd: o.onEnd || undefined });
    z.t = t0;
    return z;
  }

  // Skyfall: a curtain of arrows falls for q.delay seconds, then lands as one hit of q.dmg on every foe in its circle (and stuns them q.stun seconds); next() starts Twin Sky at the same spot.
  function skyZone(w, pid, x, y, q, part, infK, next) {
    w.addZone({ kind: 'skyfall', x, y, r: q.r, dur: q.delay, team: 0, owner: pid, custom: true,
      onEnd: (world, z) => {
        const ow = world.players.get(pid);
        if (!ow) return;
        world.emit({ t: 'skyfx', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: part === 'sky' ? 0 : 1 });
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          world.hitEnemy(e, q.dmg, { p: ow, kind: 'skill', part: 'rain.' + part, noGuard: true, x: z.x, y: z.y, infK });
          if (e.hp > 0 && q.stun) world.stunFoe(e, q.stun, false);
        }
        if (next) next();
      } });
  }

  // Splitting Bolt: a weapon shot that spends its last pierce on foe e (already in pr.hit) fans out into two short arrows at splitBolt of its damage; they never split again and start with the shot's distance flown.
  function splitBolt(w, pr, st) {
    const h = Math.atan2(pr.vy, pr.vx), sp = Math.hypot(pr.vx, pr.vy);
    for (let s = -1; s <= 1; s += 2) {
      const c = w.spawnProj({ team: 0, kind: pr.kind, x: pr.x, y: pr.y, a: h + s * SPLIT_A, speed: sp, r: pr.r, dmg: pr.dmg * st.splitBolt, life: SPLIT_LIFE, pierce: 0, owner: pr.owner, knock: pr.knock, wpn: true, noSplit: true });
      c.dist = pr.dist; c.hit = new Set(pr.hit);
    }
    w.emit({ t: 'split', x: Math.round(pr.x), y: Math.round(pr.y), a: Math.round(h * 100) / 100, pid: pr.owner });
  }

  // Flurry: two extra weapon arrows beside the aimed one, fired like the weapon's own (same speed, size, damage and pierce).
  function flurry(w, p, a, st, wp) {
    for (let s = -1; s <= 1; s += 2) {
      const ang = a + s * FLURRY_A;
      w.spawnProj({ team: 0, kind: wp.proj, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed: wp.speed, r: wp.r, dmg: wp.dmg, life: wp.life, pierce: wp.pierce + st.pierce, owner: p.pid, knock: wp.knock || 40, wpn: true,
        homing: (wp.homing || 0) + (st.homing || 0), burn: wp.burn || 0 });
    }
  }

  // Hunter's Mark: foe e takes markV more damage from everyone for volleyMark seconds; the strongest value wins and its owner keeps the mark's leap.
  function markFoe(e, p, st) {
    if (!(e.mark > 0) || st.markV >= e.markV) { e.markV = st.markV; e.markBy = p.pid; }
    e.mark = Math.max(e.mark, st.volleyMark);
  }

  // Relentless Hunt: a marked foe's death hands a fresh mark to the nearest unmarked foe within LEAP_R.
  function huntLeap(w, e) {
    const o = w.players.get(e.markBy);
    if (!o || !o.stats.markLeap || !o.stats.volleyMark) return;
    let best = null, bd = LEAP_R * LEAP_R;
    for (const f of w.enemies) {
      if (f === e || f.hp <= 0 || f.spawnT > 0 || f.def.invuln || f.burrowed || f.mark > 0) continue;
      const d2 = U.dist2(f.x, f.y, e.x, e.y);
      if (d2 < bd) { bd = d2; best = f; }
    }
    if (!best) return;
    best.mark = o.stats.volleyMark; best.markV = o.stats.markV; best.markBy = o.pid;
    w.emit({ t: 'hunt', x0: Math.round(e.x), y0: Math.round(e.y - e.r * 0.5), x1: Math.round(best.x), y1: Math.round(best.y - best.r * 0.5), pid: o.pid });
  }

  // ---------------- Ranger hook table ----------------
  ED.CLS.ranger = {
    // Exact damage factors (src.mul): Deadeye (weapon shots, by distance flown), Ballista's pierce ramp (by foes passed), Scattershot (Volley arrows within 110 and triple knockback), Gangrene (Volley and Rain on foes with 3+ ailments).
    // A Quickdraw slow and a far shot are flagged on the source for the hit event (src.slow, src.far).
    hitMul(p, e, src) {
      const st = p.stats, part = src.part;
      if (src.wpn && src.kind === 'weapon') {
        if (st.deadeye && src.dist > FAR_FROM) {
          const k = Math.min(1, (src.dist - FAR_FROM) / (FAR_TO - FAR_FROM));
          src.mul = (src.mul || 1) * (1 + st.deadeye * k);
          if (k >= FAR_AT) src.far = 1;
        }
        if (st.pierceRamp && src.pass > 0) src.mul = (src.mul || 1) * (1 + st.pierceRamp * src.pass);
        if (st.hitSlow && !e.boss) src.slow = 1;
      } else if (part === 'volley.arrow' && st.volleyClose && src.dist < ED.Stats.skillNums('volley', st).p.arrow.close) {
        src.mul = (src.mul || 1) * (1 + st.volleyClose); src.knock = (src.knock || 0) * 3;
      }
      if (st.festerHit && part && SKILL_PARTS.has(part) && this.ailments(e) >= 3) src.mul = (src.mul || 1) * (1 + st.festerHit);
      return 0;
    },
    // Quickdraw slows a foe its weapon shot hit (not bosses); Hunter's Mark marks every foe a Volley arrow hits (even the one it kills: its mark can still leap).
    hitDone(p, e, dmg, crit, src) {
      const st = p.stats;
      if (src.slow && e.hp > 0) this.slowEnemy(e, st.hitSlow, 1);
      if (st.volleyMark && src.part === 'volley.arrow') markFoe(e, p, st);
    },
    projHit(pr, e, hs) {
      if (!pr.wpn || pr.noSplit || pr.pierce > 0 || hs.guarded) return;
      const o = this.players.get(pr.owner);
      if (o && o.stats.splitBolt) splitBolt(this, pr, o.stats);
    },
    attack(p, a, st, w) {
      if (st.flurry && w.kind === 'proj' && p.atkCount % st.flurry === 0) flurry(this, p, a, st, w);
    },
    // Relentless Hunt (the dying foe's mark moves on) and Contagion / Outbreak (a foe with 2+ ailments that dies to the Ranger's damage passes its statuses to the nearest foes, queued like any status spread).
    kill(e, p, src) {
      if (e.mark > 0 && e.markBy) huntLeap(this, e);
      if (p && p.stats.contagion > 0 && this.ailments(e) >= 2) {
        const st = p.stats, out = st.contagionN > 0;
        this.queuePayoff(p, { kind: 'spread', e, x: e.x, y: e.y, f: out ? 0.33 : st.contagion, n: out ? 3 : 2, r: 100 + st.contagionR, fx: 'c' });
      }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
