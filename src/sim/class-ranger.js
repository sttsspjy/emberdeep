// Ranger: Volley and Rain of Arrows (base kits from ED.SKILLS numbers), the Ranger route cards that act on them and the hook table ED.CLS.ranger.
// Skill forms (rank 3): Death Mark (three waves, homing, bursts), Thornburst (a ring, big rooting caltrops), Starfall Barrage (five walking impacts), Storm of Thorns (a Rain that follows the cursor and lays brambles).
// Attack and element forms (rank 3): Siege Ballista (every siege-th shot is a wide piercing bolt that ends in a blast), Storm Bow (a ricochet per shot, a bigger Flurry), Hemorrhage (a Bleed pool pops), Plaguebearer (a dying foe bursts its pools).
// Deadeye, Ballista, Quickdraw, Scattershot and Gangrene read the hit's source fields in hitMul (src.dist = distance flown, src.pass = foes passed, src.part = skill part); Hunter's Mark, Quickdraw's slow and Hemorrhage hang on hitDone,
// Splitting Bolt, the siege guard stop and the ricochet on projHit, the siege blast on projEnd, Flurry and the siege shots on attack, Relentless Hunt, Contagion and Plaguebearer on kill. Every factor is exact: it multiplies src.mul, not the shared hero multiplier.
(function (ED) {
  'use strict';
  const U = ED.U;

  // Deadeye grows from nothing at FAR_FROM px flown to its full bonus at FAR_TO; a hit from FAR_AT of that ramp carries the far-shot flag. LEAP_R: reach of Relentless Hunt. SPLIT_A / SPLIT_LIFE: Splitting Bolt's fan and flight.
  // FLURRY_A: Flurry's extra arrows (each at st.flurryMul of a shot). CALTROPS: the Scattershot patch, base + pow x P damage per second, slow, radius (fixed), seconds. HAIL_SLOW: slow of a Hail of Thorns foe. VOLLEY_SLOW_T: seconds a Scattershot arrow slows its foe.
  const FAR_FROM = 80, FAR_TO = 260, FAR_AT = 0.75, LEAP_R = 120, SPLIT_A = 0.3, SPLIT_LIFE = 0.4, FLURRY_A = 0.12;
  // FLURRY_B: step of the extra arrows when Storm Bow adds more than two. SIEGE_R / SIEGE_WIDE: end blast radius and hit-radius factor of a siege bolt. RIC_R: reach of a Storm Bow ricochet.
  // HEMO_CD / HEMO_BOSS_CD: seconds between two Hemorrhage pops on one foe (a boss). PLAGUE_R / PLAGUE_HOP: Plaguebearer burst radius and seconds from the death to the burst.
  const FLURRY_B = 0.09, SIEGE_R = 60, SIEGE_WIDE = 2, RIC_R = 140, HEMO_CD = 1, HEMO_BOSS_CD = 4, PLAGUE_R = 90, PLAGUE_HOP = 0.05;
  const CALTROPS = { base: 6, pow: 0.5, r: 50, dur: 2.5, slow: 0.4 }, HAIL_SLOW = 0.5, VOLLEY_SLOW_T = 1.2;
  // WAVE_GAP: seconds between the Death Mark waves. HOME_R / HOME_TURN: reach (px) and turn rate (rad/s) of an arrow toward marked foes. BURST_LIFE / BURST_PIERCE: flight (s) and pierce of a Death Mark burst arrow.
  // STORM_SPEED: px/s the Storm of Thorns follows the cursor. BRAMBLE: patch laid by the Storm every `every` s (radius, seconds, slow).
  const WAVE_GAP = 0.12, HOME_R = 300, HOME_TURN = 3, BURST_LIFE = 0.5, BURST_PIERCE = 3, STORM_SPEED = 120, BRAMBLE = { r: 40, dur: 3, slow: 0.3, every: 0.5 };
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const SKILL_PARTS = new Set(['volley.arrow', 'rain.tick', 'rain.sky', 'rain.sky2', 'rain.shower']); // Gangrene's parts

  // Volley: a fan (Thornburst: a full ring) of piercing arrows toward the cursor. Caltrops (Scattershot rank 2) seed the spot the hop leaves. Death Mark queues two more waves (p.volleyQ) at the stored angle.
  ED.CAST.volley = function (p, a, data, st, N) {
    volleyArrows(this, p, a, st, N.p.arrow, 1);
    if (st.deathMark > 0) for (let k = 1; k <= 2; k++) p.volleyQ.push({ t: WAVE_GAP * k, a, mul: st.deathWave });
    if (st.caltrops) caltrops(this, p, st);
    return {};
  };

  // One wave of Volley arrows from the hero at damage factor mul (the later Death Mark waves count as part volley.wave); a Death Mark arrow (pr.dm) steers toward marked foes (homeArrows).
  function volleyArrows(w, p, a, st, q, mul) {
    const n = q.n, dm = st.deathMark > 0;
    for (let i = 0; i < n; i++) {
      const ang = q.ring ? a + i * q.fan / n : a + (n > 1 ? (i / (n - 1) - 0.5) * q.fan : 0);
      const pr = w.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y - 4, a: ang, speed: q.speed, r: q.pr, dmg: q.dmg * mul, life: q.life, pierce: q.pierce + st.pierce, owner: p.pid, knock: q.knock, hk: 'skill', part: mul === 1 ? 'volley.arrow' : 'volley.wave', infK: 1 + st.skillInfK });
      if (dm) pr.dm = true;
    }
  }

  // Death Mark: waves 2 and 3 fire when their queue timer runs out (from where the hero stands, along the aim of the cast).
  function volleyWaves(w, p, dt) {
    const q = p.volleyQ;
    for (let i = q.length - 1; i >= 0; i--) {
      const wv = q[i];
      if ((wv.t -= dt) > 0) continue;
      q.splice(i, 1);
      volleyArrows(w, p, wv.a, p.stats, ED.Stats.skillNums('volley', p.stats).p.arrow, wv.mul);
      w.emit({ t: 'wave', x: Math.round(p.x), y: Math.round(p.y), a: Math.round(wv.a * 100) / 100, pid: p.pid });
    }
  }

  // Death Mark: each Volley arrow of p turns up to HOME_TURN rad/s toward the nearest marked foe within HOME_R that it has not hit.
  function homeArrows(w, p, dt) {
    let marked = null;
    for (const pr of w.projs) {
      if (!pr.dm || pr.owner !== p.pid || pr.life <= 0) continue;
      if (!marked) { marked = []; for (const e of w.enemies) if (e.mark > 0 && e.hp > 0 && e.spawnT <= 0) marked.push(e); if (!marked.length) return; }
      let best = null, bd = HOME_R * HOME_R;
      for (const e of marked) {
        if (pr.hit && pr.hit.has(e.id)) continue;
        const d2 = U.dist2(pr.x, pr.y, e.x, e.y);
        if (d2 < bd) { bd = d2; best = e; }
      }
      if (!best) continue;
      const cur = Math.atan2(pr.vy, pr.vx), sp = Math.hypot(pr.vx, pr.vy), na = cur + U.clamp(U.angDiff(cur, Math.atan2(best.y - pr.y, best.x - pr.x)), -HOME_TURN * dt, HOME_TURN * dt);
      pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
    }
  }

  // Death Mark: a marked foe's death (fodder too) bursts into 4 piercing arrows at deathMark of a Volley arrow; they do not mark.
  function deathBurst(w, e) {
    const o = w.players.get(e.markBy);
    if (!o || !(o.stats.deathMark > 0)) return;
    const st = o.stats, q = ED.Stats.skillNums('volley', st).p.arrow, b = ED.Stats.skillNums('volley', st).p.burst, a0 = Math.atan2(e.y - o.y, e.x - o.x) + Math.PI / 4;
    for (let i = 0; i < b.n; i++) w.spawnProj({ team: 0, kind: 'arrow', x: e.x, y: e.y - 4, a: a0 + i * U.TAU / b.n, speed: q.speed, r: q.pr, dmg: b.dmg, life: BURST_LIFE, pierce: BURST_PIERCE + st.pierce, owner: o.pid, knock: q.knock, hk: 'skill', part: 'volley.burst', infK: 1 + st.skillInfK });
    w.emit({ t: 'dmburst', x: Math.round(e.x), y: Math.round(e.y), pid: o.pid });
  }

  // Caltrops: a patch on the hero's feet; foes inside are slowed and take CALTROPS.base + pow x P per second (the zone's damage-over-time branch).
  // Thornburst: three times the area (radius x sqrt 3) and a foe that enters (not a boss) is rooted st.thornRoot seconds, once per foe per patch (the plain slow waits until the root ends).
  function caltrops(w, p, st) {
    const C = CALTROPS, big = st.thornburst > 0, root = big ? st.thornRoot : 0, rooted = root > 0 ? new Map() : null;
    w.addZone({ kind: 'shards', x: p.x, y: p.y, r: big ? C.r * Math.sqrt(3) : C.r, dur: C.dur, dps: C.base + C.pow * st.power, team: 0, owner: p.pid,
      update: (world, z) => {
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          if (rooted) {
            const u = rooted.get(e.id);
            if (u === undefined && !e.boss) { rooted.set(e.id, world.time + root); world.slowEnemy(e, 1, root); continue; }
            if (u !== undefined && world.time < u) continue;
          }
          world.slowEnemy(e, C.slow, 0.3);
        }
      } });
  }

  // Rain of Arrows: after the part's delay an arrow tick every 0.25 s on every foe inside; Skyfall lands the whole Rain as one hit instead (Starfall Barrage: five walking impacts).
  // Storm of Thorns: the Rain follows the cursor and lays brambles. The Second Shower falls where the Rain ended.
  ED.CAST.rain = function (p, a, data, st, N) {
    const t = this.groundTarget(p, a, data, 'rain'), q = N.p.tick, sh = N.p.shower, infK = 1 + st.skillInfK, hail = !!st.rainHail;
    if (st.skyfall) {
      const tw = N.p.sky2;
      if (N.p.star.on) starfall(this, p, data, t, N.p.star, infK);
      else skyZone(this, p.pid, t.x, t.y, N.p.sky, 'sky', infK, tw.on ? () => skyZone(this, p.pid, t.x, t.y, tw, 'sky2', infK) : null);
    } else {
      rainField(this, p.pid, t.x, t.y, q, { delay: q.delay, part: 'tick', hail, infK, follow: st.thornstorm > 0 ? N.range : 0,
        onEnd: sh.on ? (world, z) => { // Second Shower: the Rain falls again on the same spot, already mid-fall (no warm-up)
          const ow = world.players.get(p.pid);
          if (!ow) return;
          world.emit({ t: 'skyfx', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(sh.r), k: 2 });
          rainField(world, p.pid, z.x, z.y, sh, { delay: 0, warm: 0.35, part: 'shower', hail, infK });
        } : null });
    }
    return { tx: Math.round(t.x), ty: Math.round(t.y) };
  };

  // One Rain field: q.count ticks of q.dmg, q.every apart, starting o.delay after the cast; hail slows the foes inside 50% and makes them vulnerable. o.warm: seconds the zone already counts as old (the renderer's warm-up ring).
  // o.follow (the cast range, Storm of Thorns): the field walks toward the owner's cursor at STORM_SPEED and lays a bramble patch every BRAMBLE.every s once it falls.
  function rainField(w, pid, x, y, q, o) {
    let k = 0;
    const t0 = o.warm || 0, part = 'rain.' + o.part;
    const z = w.addZone({ kind: 'rain', x, y, r: q.r, dur: t0 + o.delay + q.dur, team: 0, owner: pid, custom: true,
      update: (world, z, dt) => {
        if (o.follow) followAim(world, z, pid, dt, o.follow);
        const tt = z.t - t0;
        if (tt < o.delay) return;
        const ow = world.players.get(pid);
        if (!ow) return;
        if (o.follow && z.t - z.patchT >= BRAMBLE.every) layBramble(world, z, pid);
        const tick = k < q.count && tt >= o.delay + q.every * k;
        if (tick) k++;
        for (const e of world.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
          if (o.hail) { world.slowEnemy(e, HAIL_SLOW, 0.3); e.vulnT = Math.max(e.vulnT || 0, 0.3); }
          if (tick) world.hitEnemy(e, q.dmg, { p: ow, kind: 'skill', part, noGuard: true, x: z.x, y: z.y, infK: o.infK });
        }
      },
      onEnd: o.onEnd || undefined });
    z.t = t0; z.patchT = -9; z.px = NaN; z.py = NaN;
    if (o.follow) z.w = 5; // wire marker of a Storm of Thorns field (the renderer adds its thorns)
    return z;
  }

  // The field moves toward the owner's cursor (ow.aimX / aimY, sent with the hero's input; else along the aim at its distance), clamped to the cast range and walls.
  function followAim(w, z, pid, dt, range) {
    const ow = w.players.get(pid);
    if (!ow || ow.downed || ow.dead) return;
    let tx = ow.aimX, ty = ow.aimY;
    if (!fin(tx) || !fin(ty)) { const d = Math.hypot(z.x - ow.x, z.y - ow.y); tx = ow.x + Math.cos(ow.face) * d; ty = ow.y + Math.sin(ow.face) * d; }
    const g = ED.Sim.groundPoint(w.room, w.locked, ow.x, ow.y, tx, ty, range, false), dx = g.x - z.x, dy = g.y - z.y, d = Math.hypot(dx, dy);
    if (d < 1) return;
    const step = Math.min(d, STORM_SPEED * dt);
    z.x += dx / d * step; z.y += dy / d * step;
  }

  // A bramble patch under the Storm (skipped while the last one still lies within 24 px of it and is not about to end): foes inside are slowed.
  function layBramble(w, z, pid) {
    if (U.dist2(z.px, z.py, z.x, z.y) < 24 * 24 && z.t - z.patchT < BRAMBLE.dur - 0.5) return;
    z.patchT = z.t; z.px = z.x; z.py = z.y;
    w.addZone({ kind: 'bramble', x: z.x, y: z.y, r: BRAMBLE.r, dur: BRAMBLE.dur, team: 0, owner: pid, custom: true,
      update: (world, b) => { for (const e of world.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, b.x, b.y) < (b.r + e.r) ** 2) world.slowEnemy(e, BRAMBLE.slow, 0.3); } });
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

  // Starfall Barrage: q.n impacts at equal steps from the cast origin to the target, the first after q.delay s and each next q.every s later; each impact is a 'starfall' zone that lands as one hit of q.dmg
  // (a stun of q.stun s on non-bosses) on every foe in its circle.
  function starfall(w, p, data, t, q, infK) {
    let x0 = p.x, y0 = p.y;
    if (fin(data.x0) && fin(data.y0) && U.dist2(data.x0, data.y0, p.x, p.y) <= 48 * 48) { x0 = data.x0; y0 = data.y0; }
    const pid = p.pid;
    for (let k = 1; k <= q.n; k++) {
      w.addZone({ kind: 'starfall', x: x0 + (t.x - x0) * k / q.n, y: y0 + (t.y - y0) * k / q.n, r: q.r, dur: q.delay + (k - 1) * q.every, team: 0, owner: pid, custom: true,
        onEnd: (world, z) => {
          const ow = world.players.get(pid);
          if (!ow) return;
          world.emit({ t: 'skyfx', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: 3 });
          for (const e of world.enemies) {
            if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
            world.hitEnemy(e, q.dmg, { p: ow, kind: 'skill', part: 'rain.star', noGuard: true, x: z.x, y: z.y, infK });
            if (e.hp > 0 && q.stun) world.stunFoe(e, q.stun, false);
          }
        } });
    }
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

  // Flurry: 2 + flurryN extra weapon arrows beside the aimed one, fired by W.fireWeapon so they carry everything the aimed arrow does (evolution blast and spectral copies, cloud, homing, burn).
  // The extras alternate left and right of the aim at FLURRY_A steps (FLURRY_B above two extras); an odd count puts its last arrow on the side that alternates with each Flurry.
  // fireWeapon shoots w.n + st.projN arrows: the one-arrow copy of the weapon has n = 1 - projN (cached per weapon object and projN).
  const ONE_ARROW = new WeakMap();
  function flurry(w, p, a, st, wp) {
    let c = ONE_ARROW.get(wp);
    if (!c || c.pn !== st.projN) ONE_ARROW.set(wp, c = { pn: st.projN, w1: Object.assign({}, wp, { n: 1 - st.projN }) });
    const n = 2 + Math.max(0, Math.round(st.flurryN)), step = n > 2 ? FLURRY_B : FLURRY_A, flip = (n & 1) && (Math.round(p.atkCount / st.flurry) & 1) ? -1 : 1;
    for (let k = 0; k < n; k++) w.fireWeapon(p, a + ((k & 1) ? 1 : -1) * flip * ((k >> 1) + 1) * step, c.w1, undefined, { mul: st.flurryMul });
  }

  // Siege Ballista: the weapon shots this attack just spawned (distance flown 0) become siege bolts: they pierce every foe, are SIEGE_WIDE times as wide and deal siegeMul times the damage.
  function siegeShots(w, p, st) {
    for (const pr of w.projs) {
      if (pr.dist !== 0 || pr.owner !== p.pid || !pr.wpn || pr.hk || pr.team !== 0 || pr.siege) continue;
      pr.siege = true; pr.pierce = 999; pr.r *= SIEGE_WIDE; pr.mul = (pr.mul || 1) * st.siegeMul;
    }
  }

  // A siege bolt ends (wall, range or a guard) in a blast of siegeBlast of the shot (its damage with the siege factor), radius SIEGE_R x the area bonus.
  function siegeBlast(w, pr, o) {
    pr.siege = false;
    w.explode(pr.x, pr.y, SIEGE_R * (1 + o.stats.area * 0.5), pr.dmg * (pr.mul || 1) * o.stats.siegeBlast, 0, o, 'siege', false, { wpn: true, part: 'siege.blast' });
  }

  // Storm Bow: the first hit of a weapon shot sends ricochet x its damage (crit as the hit) at the nearest other foe within RIC_R of the struck foe that the shot has not hit; a shot with no such foe tries again on its next hit.
  function ricochet(w, pr, e, hs, o) {
    let best = null, bd = RIC_R * RIC_R;
    for (const f of w.enemies) {
      if (f === e || f.hp <= 0 || f.spawnT > 0 || f.def.invuln || f.burrowed || (pr.hit && pr.hit.has(f.id))) continue;
      const d2 = U.dist2(f.x, f.y, e.x, e.y);
      if (d2 < bd) { bd = d2; best = f; }
    }
    if (!best) return;
    pr.ric = true;
    w.emit({ t: 'chain', k: 'r', pts: [[Math.round(e.x), Math.round(e.y - e.r * 0.5)], [Math.round(best.x), Math.round(best.y - best.r * 0.5)]] });
    w.hitEnemy(best, pr.dmg, { p: o, kind: 'weapon', wpn: true, part: 'ranger.ric', crit: hs.critOut, mul: (pr.mul || 1) * o.stats.ricochet, x: e.x, y: e.y });
  }

  // Hemorrhage: after p's hit on e, a Bleed pool of hemoAt of its max health (a boss: hemoBoss) hits at once at hemoMul x the rate its ticks pay, and the pool is emptied; per foe at most every HEMO_CD s (a boss: HEMO_BOSS_CD).
  function hemorrhage(w, p, e) {
    const st = p.stats, boss = e.boss;
    if (!(e.bleedPool >= (boss ? st.hemoBoss : st.hemoAt) * e.maxHp) || (e.hemoT || 0) > w.time) return;
    const dmg = e.bleedPool * st.hemoMul * (1 + st.bleedMul);
    e.bleedPool = 0; e.hemoT = w.time + (boss ? HEMO_BOSS_CD : HEMO_CD);
    w.emit({ t: 'chain', k: 'm', pts: [[Math.round(e.x), Math.round(e.y - e.r * 0.5)], [Math.round(e.x), Math.round(e.y - e.r * 0.5)]], r: Math.round(e.r) });
    w.hitEnemy(e, dmg, { p, kind: 'rupture', part: 'ranger.hemo', raw: true, noProc: true, crit: false, noGuard: true, bleed: true });
  }

  // Plaguebearer: the dying foe's Bleed and Burn pools (as they are at its death) are queued as a burst PLAGUE_HOP s later (p.plagueQ), so a chain of deaths plays out over ticks.
  function plagueQueue(p, e) {
    p.plagueQ.push({ t: PLAGUE_HOP, e, x: e.x, y: e.y, bleed: e.bleedPool, burn: e.burnPool });
  }

  // The due bursts (at most CHAIN_TICK per tick): the corpse loses both pools (before its status spread runs, one chain hop later), every foe within PLAGUE_R takes plagueBurst of them at the rate their ticks pay, one hit (Burn pools already carry the stratum affinity).
  function plagueBursts(w, p, dt) {
    const q = p.plagueQ, st = p.stats;
    let ran = 0;
    for (let i = 0; i < q.length && ran < ED.CONST.CHAIN_TICK;) {
      const b = q[i];
      if ((b.t -= dt) > 0) { i++; continue; }
      q.splice(i, 1); ran++;
      b.e.bleedPool = 0; b.e.burnPool = 0;
      const dB = b.bleed * st.plagueBurst * (1 + st.bleedMul), dF = b.burn * st.plagueBurst * (1 + st.burnMul);
      if (!(dB + dF > 0)) continue;
      for (const o of w.enemies) {
        if (o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || U.dist2(o.x, o.y, b.x, b.y) >= (PLAGUE_R + o.r) ** 2) continue;
        w.hitEnemy(o, dB + dF, Object.assign({ p, kind: 'rupture', part: 'ranger.plague', raw: true, noProc: true, crit: false, noGuard: true }, dF > dB ? { el: 'fire', affDone: true } : { bleed: true }));
      }
      w.emit({ t: 'chain', k: 'g', pts: [[Math.round(b.x), Math.round(b.y)], [Math.round(b.x) + PLAGUE_R, Math.round(b.y)]] });
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
    init(p) { p.volleyQ = []; p.plagueQ = []; },
    // Death Mark: the queued waves and the arrows' steering. Plaguebearer: the due bursts.
    tick(p, dt) {
      if (p.volleyQ.length) volleyWaves(this, p, dt);
      if (p.stats.deathMark > 0) homeArrows(this, p, dt);
      if (p.plagueQ.length) plagueBursts(this, p, dt);
    },
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
    // Quickdraw slows a foe its weapon shot hit (not bosses); Hunter's Mark marks every foe a Volley arrow hits (even the one it kills: its mark can still leap); Hemorrhage pops the Bleed pool after any direct hit (statuses, bursts and pops never trigger it).
    hitDone(p, e, dmg, crit, src) {
      const st = p.stats;
      if (src.slow && e.hp > 0) this.slowEnemy(e, st.hitSlow, 1);
      if (st.volleyMark && (src.part === 'volley.arrow' || src.part === 'volley.wave')) markFoe(e, p, st);
      if (st.volleySlow && src.part === 'volley.arrow' && e.hp > 0) this.slowEnemy(e, e.boss ? st.volleySlow * 0.5 : st.volleySlow, VOLLEY_SLOW_T);
      if (st.hemo > 0 && e.hp > 0 && e.bleedPool > 0 && !src.noProc && !src.raw && src.kind !== 'dot') hemorrhage(this, p, e);
    },
    // A weapon shot hit e: Storm Bow's ricochet, then either the siege bolt's blast when a guard stopped it or Splitting Bolt when the shot spent its last pierce.
    projHit(pr, e, hs) {
      if (!pr.wpn) return;
      const o = this.players.get(pr.owner);
      if (!o) return;
      const st = o.stats;
      if (st.ricochet > 0 && !pr.ric && hs.critOut !== undefined) ricochet(this, pr, e, hs, o);
      if (pr.siege && hs.guarded) siegeBlast(this, pr, o);
      else if (st.splitBolt && !pr.noSplit && pr.pierce <= 0 && !hs.guarded) splitBolt(this, pr, st);
    },
    // A hero shot ended its flight: a siege bolt blasts.
    projEnd(pr, owner) {
      if (pr.siege && owner) siegeBlast(this, pr, owner);
    },
    attack(p, a, st, w) {
      if (w.kind !== 'proj') return;
      if (st.siege > 0 && p.atkCount % st.siege === 0) siegeShots(this, p, st);
      if (st.flurry && p.atkCount % st.flurry === 0) flurry(this, p, a, st, w);
    },
    // Relentless Hunt (the dying foe's mark moves on) and Contagion / Outbreak (a foe with 2+ ailments that dies to the Ranger's damage passes its statuses to the nearest foes, queued like any status spread).
    // Plaguebearer: the same foes burst instead (the pools go to the burst, the other statuses spread to every foe within PLAGUE_R); fodder deaths burst too.
    kill(e, p, src) {
      if (e.mark > 0 && e.markBy) { huntLeap(this, e); deathBurst(this, e); }
      if (p && p.stats.contagion > 0 && this.ailments(e) >= 2) {
        const st = p.stats, out = st.contagionN > 0, plague = st.plague > 0;
        if (plague) plagueQueue(p, e);
        this.queuePayoff(p, { kind: 'spread', e, x: e.x, y: e.y, f: out ? st.outbreak : st.contagion, n: plague ? 99 : out ? 3 : 2, r: plague ? PLAGUE_R : 100 + st.contagionR, fx: 'c' });
      }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
