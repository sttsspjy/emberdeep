// Pyromancer: Ember Bolt (every weapon hit cuts the spell cooldowns), Fireball (skill 3), Flame Nova and Meteor, the route cards that act on them and the hook table ED.CLS.pyro.
// Attack route: Spellweaver (a larger cut, a Fireball charge), Kindling (bolt hits store Sparks the next spell spends; Flashfire; Pyre Bolt: stats.js gives the bolt a blast), Quickcast (Afterburn bolts after each spell; Chain Cast; Spell Storm).
// Skill forms (rank 3): Supernova (an expanding wave and a collapse), Phoenix Form (a ring that follows the hero and a dash trail), Cataclysm (five meteors and one lava field), Sun Dive (a second Comet leap and a trail).
// Element: Living Flame (spell Fire damage, bolt Burn), White Heat (Flashpoint and White Flame by burning time), Heat Engine (cooldown cuts from burning foes; Chain Reaction; Inferno Engine).
// Delayed effects (Collapse pull, the Nova echo and wave start, the Cataclysm meteors) wait in the hero's queue p.pyroQ and run from the tick hook; Meteors are 'meteor' zones that land through their onEnd; a Fireball is a hero shot that bursts through projHit / projEnd.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, C = ED.CONST, Sim = ED.Sim;
  const W = ED.World.prototype;
  const fin = (v) => typeof v === 'number' && isFinite(v);

  // EMBER_PS: spell cooldown seconds that one second of bolt hits cuts (a hit cuts EMBER_PS x the attack interval / the shots per attack x (1 + emberMul); a horde foe EMBER_FODDER of that). EMBER_CAP: the most cut
  // seconds per second (a bucket of EMBER_CAP s refilling EMBER_CAP per s), so attack speed, pierce and blasts stop adding past it. EMBER_FLUSH: seconds between the refund messages that carry the cut.
  // FB_R: radius of a Fireball shot. CHAIN_T: Chain Cast window. AFTER_FAN: rad between Afterburn's extra bolts. STORM_N: extra bolts per attack in a Spell Storm. PYRE_R: blast radius of a Pyre Bolt (stats.js).
  Object.assign(C, { EMBER_PS: 0.5, EMBER_CAP: 0.8, EMBER_FODDER: 0.5, EMBER_FLUSH: 0.2, FB_R: 7, CHAIN_T: 1.5, AFTER_FAN: 0.12, STORM_N: 4, PYRE_R: 36 });
  // PULL_LEAD: Collapse pulls this long before the echo. MANTLE_CD: seconds between Mantle shields. HEAT_MAX: most cooldown one cast cuts. HEAT_CD: seconds between Chain Reactions. LAVA_TAG: zone field w of the Cataclysm field, COMET_TAG: of the Meteor a Comet rides,
  // PHOENIX_TAG: of the Phoenix Form ring (the tags only tell the renderer which look to draw). SUN_GAP: seconds between the landing and the second Sun Dive leap. STORM_GAP / STORM_OFF: seconds between the Cataclysm meteors and px from the cursor point of the four outer ones.
  // TRAIL_STEP / DIVE_STEP: px between two trail patches of a dash and of a Sun Dive flight. SUN_GRACE: seconds the hero stays untouchable after a Sun Dive landing.
  Object.assign(C, { PULL_LEAD: 0.15, MANTLE_CD: 10, HEAT_MAX: 1.5, HEAT_CD: 6, LAVA_TAG: 9, COMET_TAG: 1, PHOENIX_TAG: 10, SUN_GAP: 0.5, SUN_GRACE: 0.6, STORM_GAP: 0.1, STORM_OFF: 80, TRAIL_STEP: 20, DIVE_STEP: 28 });
  // WHITE_EVERY: seconds between burning-time scans (a scan adds that long to every burning foe). INFERNO_R: Inferno radius factor. BOSS_HEAT: Heat one burning boss stores. HEAT_PING: seconds between Heat refresh events.
  Object.assign(C, { WHITE_EVERY: 0.1, INFERNO_R: 1.4, BOSS_HEAT: 3, HEAT_PING: 2 });

  const burning = (e) => e.burnPool > 0; // the foe carries Burn (combat.js owns the Burn state)
  const burningSet = (w) => { const s = new Set(); for (const e of w.enemies) if (e.hp > 0 && burning(e) && !e.fodder) s.add(e.id); return s; }; // Heat Engine refunds count foes that are not horde foes

  // Heat Engine: n distinct burning foes hit by a cast of skill `slot` (0 Nova, 1 Meteor) cut HEAT_MAX at most from the other skill's cooldown (heatEngine seconds each); Chain Reaction (n >= heatChain, once per HEAT_CD) refunds it in full.
  // Inferno Engine: the foes in `seen` (the burning foes the cast hit) store Heat first.
  function heat(w, p, slot, n, seen) {
    const st = p.stats;
    if (!(st.heatEngine > 0) || n <= 0) return;
    if (st.infernoMul > 0 && seen) stockHeat(w, p, seen);
    const other = 1 - slot;
    if (st.heatChain && n >= st.heatChain && p.heatT <= 0) {
      p.heatT = C.HEAT_CD;
      w.refundSkill(p, other);
      w.emit({ t: 'pyHeat', pid: p.pid, slot: other, full: 1, n });
      return;
    }
    const s = Math.min(C.HEAT_MAX, n * st.heatEngine);
    w.refundSkill(p, other, s);
    w.emit({ t: 'pyHeat', pid: p.pid, slot: other, s: Math.round(s * 100) / 100, n });
  }

  // A spell cast (slot 0 Nova, 1 Meteor, 2 Fireball): returns the factor its own hits take and starts its riders. Kindling: the Sparks are spent (+spark each; Flashfire: every flashfire-th Spark spent gives back a Fireball charge);
  // Chain Cast: a different spell within CHAIN_T of the last one; Afterburn arms the extra bolts of the next afterN attacks (Spell Storm: of every attack for stormT s).
  function spellCast(w, p, slot) {
    const st = p.stats;
    let m = 1;
    if (st.spark > 0 && p.sparks > 0) {
      m *= 1 + st.spark * p.sparks;
      if (st.flashfire > 0) { p.sparkUse += p.sparks; const f = Math.max(1, Math.round(st.flashfire)); if (p.sparkUse >= f) { p.sparkUse -= f; w.refundSkill(p, 2); w.emit({ t: 'pyFlare', pid: p.pid }); } }
      w.emit({ t: 'pySpark', pid: p.pid, n: p.sparks, go: 1 });
      p.sparks = 0;
    }
    if (st.chainCast > 0 && p.spellSlot >= 0 && p.spellSlot !== slot && w.time - p.spellAt <= C.CHAIN_T) { m *= 1 + st.chainCast; w.emit({ t: 'pyChain', pid: p.pid, slot }); }
    p.spellSlot = slot; p.spellAt = w.time;
    if (st.afterburn > 0) { if (st.stormT > 0) p.stormT = st.stormT; else p.afterN = Math.round(st.afterN); }
    return m;
  }

  // Phoenix Mantle: the Nova that hit a foe shields the hero (once per MANTLE_CD); mantleAmt is the part of the shield Rebirth Flare watches.
  function mantle(w, p) {
    const g = w.addShield(p, p.stats.mantle * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'class');
    if (!(g > 0)) return;
    p.mantleT = C.MANTLE_CD; p.mantleAmt = Math.min(p.shield, p.mantleAmt + g);
    w.emit({ t: 'pyMantle', pid: p.pid, v: Math.round(g * 10) / 10 });
  }

  // Collapse: foes within r of (x, y) are pushed px toward it (a knock velocity decays by 9/s, so v = 9 x distance); bosses stay, elites move 0.45 x, tanks 0.35 x.
  function pull(w, x, y, r, px) {
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.boss || e.def.invuln || e.burrowed) continue;
      const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
      if (d >= r + e.r || d < 2) continue;
      const v = Math.min(px, d) * 9 * (e.elite ? 0.45 : 1) * (e.def.ai === 'tank' ? 0.35 : 1);
      e.kbx += dx / d * v; e.kby += dy / d * v;
    }
  }

  // ---------------- Fireball ----------------
  // A shot toward the aim at the skill's speed for its range: it bursts (every foe within the burst radius takes the burst and a Burn add of statusAdd.burn of the damage dealt) on the first foe it touches, on a wall or at the end of its flight.
  // The shot itself deals nothing (dmg 0, a no-guard hit kind); projHit / projEnd burst it. mul: the cast's factor (spellCast).
  ED.CAST.fireball = function (p, a, data, st, N) {
    fireball(this, p, a, N, spellCast(this, p, 2));
    return {};
  };
  function fireball(w, p, a, N, mul) {
    const sp = ED.SKILLS.fireball.speed;
    const pr = w.spawnProj({ team: 0, kind: 'fireball', x: p.x + Math.cos(a) * 10, y: p.y - 4 + Math.sin(a) * 10, a, speed: sp, r: C.FB_R, life: N.range / sp, pierce: 0, owner: p.pid, crit: false, hk: 'explode' });
    pr.dmg = 0; pr.fb = { mul }; // a 0-damage hit returns before any effect (spawnProj turns dmg 0 into 1)
  }
  // back: px to step back from a wall the shot entered.
  function fbBurst(w, p, pr, back) {
    if (!pr.fb) return;
    const fb = pr.fb, N = ED.Stats.skillNums('fireball', p.stats), q = N.p.burst, sp = Math.hypot(pr.vx, pr.vy) || 1;
    const x = pr.x - pr.vx / sp * back, y = pr.y - pr.vy / sp * back;
    pr.fb = null;
    w.skillBlast(p, x, y, q.r, q.dmg * fb.mul, w.partSrc(p, N, 'burst'), (e, dealt) => { if (e.hp > 0 && dealt > 0) w.addBurn(e, dealt * q.statusAdd.burn, p); });
    w.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(q.r), k: 'fire' });
  }

  // ---------------- Flame Nova ----------------
  // A ring of fire around the hero: every foe struck takes the blast and a Burn add, both x the cast's factor. Cards: the ring and Mantle (Phoenix Mantle; Phoenix Form: a ring that follows the hero),
  // the echo and Collapse (Twin Nova; Supernova: the echo is an expanding wave), Heat Engine's cooldown cut.
  ED.CAST.nova = function (p, a, data, st, N) {
    const m = spellCast(this, p, 0);
    const q = N.p.blast, b = N.p.burn, ring = N.p.ring, ph = N.p.phoenix, echo = N.p.echo.on ? N.p.echo : N.p.wave.on ? N.p.wave : null, wave = echo === N.p.wave, burn = st.heatEngine > 0 ? burningSet(this) : null, seen = burn ? new Set() : null;
    let hit = 0;
    this.skillBlast(p, p.x, p.y, q.r, q.dmg, this.partSrc(p, N, 'blast', m !== 1 ? { mul: m } : undefined), (e, dealt) => {
      if (!(dealt > 0)) return;
      if (!e.fodder) hit++; // the Mantle shield needs a foe that is not a horde foe
      if (burn && burn.has(e.id)) seen.add(e.id);
      if (e.hp > 0) this.addBurn(e, b.dmg * m * (1 + st.classElMul), p);
    });
    this.emit({ t: 'nova', x: p.x, y: p.y, r: q.r, c: '#ff7a2a' });
    if (ring.on) this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: ring.r, dur: ring.dur, dps: ring.dmg, owner: p.pid, team: 0, clsEl: st.element });
    if (ph.on) phoenixRing(this, p, ph, st);
    if (hit && st.mantle > 0 && p.mantleT <= 0) mantle(this, p);
    if (burn) heat(this, p, 0, seen.size, seen);
    if (echo) {
      const t = this.time;
      if (st.novaPull) p.pyroQ.push({ at: t + echo.delay - C.PULL_LEAD, k: 'pull', room: this.room });
      p.pyroQ.push({ at: t + echo.delay, k: wave ? 'wave' : 'echo', room: this.room });
      this.emit({ t: 'pyEcho', pid: p.pid, d: echo.delay, r: Math.round(q.r), pull: st.novaPull ? 1 : 0, k: wave ? 1 : 0 });
    }
    return {};
  };

  // Phoenix Form: the ring of fire is a 'pfire' zone that follows its owner (w PHOENIX_TAG); a second Nova inside its life renews it instead of adding a second ring. p.phoenixT times the dash trail.
  function phoenixRing(w, p, ph, st) {
    p.phoenixT = ph.dur;
    for (const z of w.zones) if (z.w === C.PHOENIX_TAG && z.owner === p.pid && z.t < z.dur) { z.t = 0; z.dur = ph.dur; z.r = ph.r; z.dps = ph.dmg; return; }
    w.addZone({ kind: 'pfire', x: p.x, y: p.y, r: ph.r, dur: ph.dur, dps: ph.dmg, owner: p.pid, team: 0, clsEl: st.element, follow: p.pid, w: C.PHOENIX_TAG });
    w.emit({ t: 'pyPhoenix', pid: p.pid, r: Math.round(ph.r), d: ph.dur });
  }

  // Phoenix Form: foes inside the ring that follows the hero are slowed phoenixSlow (bosses half as much), refreshed every tick.
  function phoenixSlow(w, p, st) {
    const r = ED.Stats.skillNums('nova', st).p.phoenix.r, q = w.foeScan(p.x, p.y, r);
    for (let k = 0; k < q.length || w.foeTail(q); k++) {
      const e = q[k];
      if (e.hp <= 0 || e.spawnT > 0 || U.dist2(e.x, e.y, p.x, p.y) >= (r + e.r) ** 2) continue;
      w.slowEnemy(e, e.boss ? st.phoenixSlow / 2 : st.phoenixSlow, 0.3);
    }
    w.foeEnd();
  }

  // A patch of burning ground on the path of a dash or a Sun Dive flight, one per `step` px of travel (p.trailAt remembers the last one; null when the hero is not moving that way).
  function layTrail(w, p, q, step) {
    if (p.trailAt && U.dist2(p.trailAt[0], p.trailAt[1], p.x, p.y) < step * step) return;
    p.trailAt = [p.x, p.y];
    w.addZone({ kind: 'pfire', x: p.x, y: p.y, r: q.r, dur: q.dur, dps: q.dmg, owner: p.pid, team: 0, clsEl: p.stats.element });
  }

  // The second eruption: around the hero where it stands now, at the echo part's damage and a Burn add scaled the same way.
  function runEcho(w, p) {
    const st = p.stats, N = ED.Stats.skillNums('nova', st), q = N.p.echo, b = N.p.burn;
    w.emit({ t: 'pyEcho', pid: p.pid, go: 1, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(q.r) });
    w.skillBlast(p, p.x, p.y, q.r, q.dmg, w.partSrc(p, N, 'echo'), (e, dealt) => { if (e.hp > 0 && dealt > 0) w.addBurn(e, b.dmg * st.novaEcho * (1 + st.classElMul), p); });
  }

  // Supernova: the second eruption is a shockwave centred where the hero stands. Its front grows from the Nova's radius to the wave part's radius over its duration; each foe is struck once, when the front first reaches it
  // (foes inside the first radius at once), and takes the Burn add. When the front is at its full radius the centre collapses: non-boss foes within it are pulled supernovaPull px inward.
  function startWave(w, p) {
    const N = ED.Stats.skillNums('nova', p.stats), q = N.p.wave, v = { x: p.x, y: p.y, t0: w.time, r0: N.p.blast.r, r1: q.r, d: q.dur, hit: new Set(), room: w.room };
    p.waves.push(v);
    w.emit({ t: 'pyWave', pid: p.pid, x: Math.round(v.x), y: Math.round(v.y), r0: Math.round(v.r0), r1: Math.round(v.r1), d: v.d });
  }
  function stepWaves(w, p) {
    const L = p.waves, st = p.stats;
    for (let i = L.length - 1; i >= 0; i--) {
      const v = L[i];
      if (v.room !== w.room) { L.splice(i, 1); continue; }
      const N = ED.Stats.skillNums('nova', st), q = N.p.wave, b = N.p.burn, k = Math.min(1, (w.time - v.t0) / v.d), R = v.r0 + (v.r1 - v.r0) * k;
      for (const e of w.enemies) {
        if (e.hp <= 0 || e.spawnT > 0 || v.hit.has(e.id)) continue;
        const d = Math.hypot(e.x - v.x, e.y - v.y);
        if (d >= R + e.r) continue;
        v.hit.add(e.id);
        const dealt = w.hitEnemy(e, q.dmg, w.partSrc(p, N, 'wave', { kx: (e.x - v.x) / (d || 1), ky: (e.y - v.y) / (d || 1), noGuard: true, x: v.x, y: v.y }));
        if (e.hp > 0 && dealt > 0) w.addBurn(e, b.dmg * st.novaEcho * (1 + st.classElMul), p);
      }
      if (k < 1) continue;
      L.splice(i, 1);
      if (st.supernovaPull > 0) { pull(w, v.x, v.y, v.r1, st.supernovaPull); w.emit({ t: 'pyPull', pid: p.pid, x: Math.round(v.x), y: Math.round(v.y), r: Math.round(v.r1), px: st.supernovaPull, sn: 1 }); }
    }
  }

  // ---------------- Meteor ----------------
  // A friendly telegraph, then the impact (Burn add = half the impact) and a burning crater. Twin Meteor chains a second impact on the foe nearest the first; Meteor Shower rains meteorites around each impact;
  // Comet is the hero's own leap (the client moves it, the sim only times the landing and the airborne flag); Sun Dive adds a second leap toward the cursor SUN_GAP after the landing (p.diveAt).
  // Cataclysm casts five meteors instead of one: the cursor point at once, four STORM_OFF px around it STORM_GAP apart (queued in p.pyroQ). The cast's factor (spellCast) rides on its own impacts.
  ED.CAST.meteor = function (p, a, data, st, N) {
    const m = spellCast(this, p, 1), t = this.groundTarget(p, a, data, 'meteor'), comet = st.comet > 0 && N.move && N.move.k === 'leap';
    if (N.p.storm.on) castStorm(this, p, t, N, m);
    else this.castMeteor(p, t.x, t.y, comet ? N.move.t : N.p.impact.delay, (comet ? 1 + st.comet : 1) * m, comet ? 'comet' : 'main');
    if (comet) {
      p.cometT = N.move.t;
      this.emit({ t: 'pyComet', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(t.x), ty: Math.round(t.y), d: N.move.t, sd: st.sunDive > 0 ? 1 : 0 });
      if (st.sunDive > 0) { p.diveAt = this.time + N.move.t + C.SUN_GAP; p.diveRoom = this.room; }
    }
    return { tx: Math.round(t.x), ty: Math.round(t.y) };
  };

  // Cataclysm: a group (grp) of five meteors that share one lava field, one Heat Engine count and the cast's factor; the field forms where the cursor point was when the last one has landed.
  function castStorm(w, p, t, N, m) {
    const q = N.p.storm, grp = { left: q.n, burning: null, seen: new Set(), x: t.x, y: t.y, mul: m }, base = Math.atan2(t.y - p.y, t.x - p.x);
    w.castMeteor(p, t.x, t.y, q.delay, m, 'storm', grp);
    for (let k = 0; k < q.n - 1; k++) {
      const an = base + k * Math.PI / 2;
      let x = t.x + Math.cos(an) * C.STORM_OFF, y = t.y + Math.sin(an) * C.STORM_OFF;
      if (D.blocksShots(D.tileAt(w.room, x, y), w.locked)) { x = t.x; y = t.y; }
      p.pyroQ.push({ at: w.time + C.STORM_GAP * (k + 1), k: 'storm', x, y, grp, room: w.room });
    }
    w.emit({ t: 'pyStorm', pid: p.pid, x: Math.round(t.x), y: Math.round(t.y), r: Math.round(C.STORM_OFF) });
  }

  // The second Sun Dive leap: toward the cursor (clamped to the Meteor's range and cut at walls), landing as another Comet impact at sunDive of the first after the leap time. The hero's own client moves it: a hero this world moves gets its skillMove here,
  // a remote one a 'leap' message (the client starts the same move).
  function diveAgain(w, p) {
    const st = p.stats, N = ED.Stats.skillNums('meteor', st), mv = N.move;
    if (!(st.sunDive > 0) || !mv || mv.k !== 'leap' || p.downed || p.dead) return;
    let tx = p.aimX, ty = p.aimY;
    if (!fin(tx) || !fin(ty)) { tx = p.x + Math.cos(p.face) * 200; ty = p.y + Math.sin(p.face) * 200; }
    const g = Sim.groundPoint(w.room, w.locked, p.x, p.y, tx, ty, N.range, false);
    w.castMeteor(p, g.x, g.y, mv.t, (1 + st.comet) * st.sunDive, 'comet');
    p.cometT = mv.t;
    w.emit({ t: 'pyComet', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(g.x), ty: Math.round(g.y), d: mv.t, sd: 1 });
    if (p.remote) w.msgs.push({ to: p.pid, t: 'leap', x: Math.round(g.x), y: Math.round(g.y), d: mv.t, i: mv.iframes });
    else p.skillMove = ED.leapMove(w.room, w.locked, p, g.x, g.y, mv);
  }

  // kind: 'main' | 'comet' (the cast's own impact) | 'twin' | 'rock' | 'storm' (one of the five Cataclysm meteors; grp is their shared record). The zone keeps the damage factor in z.zm (an Inferno raises it).
  W.castMeteor = function (p, x, y, delay, mul, kind, grp) {
    const N = ED.Stats.skillNums('meteor', p.stats), q = kind === 'rock' ? N.p.rocks : kind === 'twin' ? N.p.twin : kind === 'storm' ? N.p.storm : N.p.impact;
    return this.addZone({ kind: 'meteor', x, y, r: q.r, dur: delay, team: 0, owner: p.pid, custom: true, zm: mul, w: kind === 'comet' ? C.COMET_TAG : 0, onEnd: (w, z) => meteorLand(w, z, kind, grp) });
  };

  function meteorLand(w, z, kind, grp) {
    const o = w.players.get(z.owner);
    if (!o) return;
    const st = o.stats, N = ED.Stats.skillNums('meteor', st), im = N.p.impact, cr = N.p.crater, twin = kind === 'twin', rock = kind === 'rock', comet = kind === 'comet', storm = kind === 'storm';
    const q = rock ? N.p.rocks : twin ? N.p.twin : storm ? N.p.storm : im, own = !twin && !rock && !storm;
    if (storm && grp.burning === null) grp.burning = st.heatEngine > 0 ? burningSet(w) : false;
    const burn = storm ? grp.burning : own && st.heatEngine > 0 ? burningSet(w) : null, seen = storm ? grp.seen : burn ? new Set() : null;
    const src = w.partSrc(o, N, rock ? 'rocks' : twin ? 'twin' : storm ? 'storm' : 'impact', comet && st.cometStun ? { knock: im.knock * 2 } : undefined);
    w.skillBlast(o, z.x, z.y, z.r, q.dmg * z.zm, src, (e, dealt) => {
      if (!(dealt > 0)) return;
      if (burn && burn.has(e.id)) seen.add(e.id);
      if (e.hp > 0) {
        w.addBurn(e, dealt * im.statusAdd.burn, o);
        if (comet && st.cometStun) w.stunFoe(e, st.cometStun, false);
      }
    });
    w.emit({ t: 'boom', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: rock ? 'fire' : 'bigfire' });
    if (comet && st.sunDive > 0) {
      o.invuln = Math.max(o.invuln, C.SUN_GRACE);
      w.emit({ t: 'pyDive', pid: o.pid, x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r) });
    }
    if (own) w.addZone({ kind: 'pfire', x: z.x, y: z.y, r: cr.r, dur: cr.dur, dps: cr.dmg, owner: o.pid, team: 0, clsEl: st.element });
    if (storm) {
      if (--grp.left > 0) return;
      const f = N.p.field;
      w.addZone({ kind: 'pfire', x: grp.x, y: grp.y, r: f.r, dur: f.dur, dps: f.dmg, owner: o.pid, team: 0, clsEl: st.element, w: C.LAVA_TAG });
      w.emit({ t: 'pyField', pid: o.pid, x: Math.round(grp.x), y: Math.round(grp.y), r: Math.round(f.r) });
      if (burn) heat(w, o, 1, seen.size, seen);
      return;
    }
    if (burn) heat(w, o, 1, seen.size, seen);
    if (own && st.twinMeteor) {
      const tg = w.nearestEnemy(z.x, z.y, 300);
      if (tg) {
        w.castMeteor(o, tg.x, tg.y, N.p.twin.delay, 1, 'twin');
        w.emit({ t: 'pyTwin', pid: o.pid, x0: Math.round(z.x), y0: Math.round(z.y), x1: Math.round(tg.x), y1: Math.round(tg.y), d: N.p.twin.delay });
      }
    }
    if (!rock && N.p.rocks.on) {
      const rk = N.p.rocks, room = w.room;
      for (let i = 0; i < rk.n; i++) {
        const ang = w.rng.range(0, U.TAU), d = 80 * Math.sqrt(w.rng.next());
        let x = z.x + Math.cos(ang) * d, y = z.y + Math.sin(ang) * d;
        if (D.blocksShots(D.tileAt(room, x, y), w.locked)) { x = z.x; y = z.y; }
        w.castMeteor(o, x, y, rk.delay, 1, 'rock');
      }
    }
  }

  // The queued effects of hero p that are due: the Collapse pull, the Nova echo, the Supernova wave and the later Cataclysm meteors.
  function runQueue(w, p) {
    const q = p.pyroQ;
    for (let i = 0; i < q.length;) {
      const en = q[i];
      if (en.at > w.time) { i++; continue; }
      q.splice(i, 1);
      if (en.room !== w.room || w.time - en.at > 1) continue;
      if (en.k === 'pull') { const N = ED.Stats.skillNums('nova', p.stats); pull(w, p.x, p.y, N.p.blast.r, p.stats.novaPull); w.emit({ t: 'pyPull', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(N.p.blast.r), px: p.stats.novaPull }); }
      else if (en.k === 'echo') runEcho(w, p);
      else if (en.k === 'wave') startWave(w, p);
      else if (en.k === 'storm') w.castMeteor(p, en.x, en.y, ED.Stats.skillNums('meteor', p.stats).p.storm.delay, en.grp.mul, 'storm', en.grp);
    }
  }

  // ---------------- Attack route ----------------
  // Afterburn: an armed attack fires n extra bolts (2, a Spell Storm STORM_N) in a fan AFTER_FAN apart around the aim at afterburn of a bolt; they are weapon shots (they cut cooldowns and store Sparks).
  function afterburn(w, p, a, st, wpn) {
    const storm = p.stormT > 0, n = storm ? C.STORM_N : 2, o = Object.assign({ mul: st.afterburn }, ED.CLS.pyro.attackOpts.call(w, p, st));
    for (let k = 1; k <= n / 2; k++) for (const sg of [-1, 1]) w.fireWeapon(p, a + sg * k * C.AFTER_FAN, wpn, undefined, o);
    if (!storm) p.afterN--;
  }

  // ---------------- White Heat ----------------
  // Burning time: every scan adds `dt` to the time the foe has burned in a row for this hero (e.wf[pid]); a foe that stopped burning starts over. Horde foes are left out (they die long before it counts).
  // Flashpoint: a spell hit on a foe burning flashT s in a row always crits; White Flame: a foe burning whiteT s in a row is white-hot (+whiteHot from every hit).
  function burnScan(w, p, dt) {
    const pid = p.pid;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.fodder) continue;
      if (burning(e)) { const m = e.wf || (e.wf = {}); m[pid] = (m[pid] || 0) + dt; } else if (e.wf && e.wf[pid]) e.wf[pid] = 0;
    }
  }
  const burnedFor = (p, e) => (burning(e) && e.wf !== undefined ? e.wf[p.pid] || 0 : 0);
  const isWhite = (p, e) => p.stats.whiteHot > 0 && burnedFor(p, e) >= p.stats.whiteT - 1e-9;

  // Inferno Engine: the burning foes (not horde foes) a cast hit store 1 Heat, a boss BOSS_HEAT, up to heatMax; the event carries the new count for the viewers.
  function stockHeat(w, p, seen) {
    const mx = p.stats.heatMax;
    let add = 0;
    for (const e of w.enemies) if (seen.has(e.id)) add += e.boss ? C.BOSS_HEAT : 1;
    if (!(add > 0) || p.heat >= mx) return;
    p.heat = Math.min(mx, p.heat + add); p.heatPing = C.HEAT_PING;
    w.emit({ t: 'pyEng', pid: p.pid, n: p.heat, mx });
  }
  // At full Heat the next Nova or Meteor is an Inferno and the Heat empties. Nova: its blast part and Burn add are edited before the cast reads them. Meteor: the impact zones the cast made grow and land at infernoMul x (the Burn add follows the damage).
  const takeInferno = (p) => {
    const st = p.stats;
    if (!(st.infernoMul > 0) || !(st.heatMax > 0) || !(p.heat >= st.heatMax)) return false;
    p.heat = 0; p.heatPing = 0;
    return true;
  };
  const novaCast = ED.CAST.nova, meteorCast = ED.CAST.meteor;
  ED.CAST.nova = function (p, a, data, st, N) {
    if (!takeInferno(p)) return novaCast.call(this, p, a, data, st, N);
    const b = N.p.blast, bu = N.p.burn, r = b.r * C.INFERNO_R;
    const np = Object.assign({}, N.p, { blast: Object.assign({}, b, { r, dmg: b.dmg * st.infernoMul }), burn: Object.assign({}, bu, { dmg: bu.dmg * st.infernoMul }) });
    this.emit({ t: 'pyEng', pid: p.pid, n: 0, mx: st.heatMax, go: 1, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(r) });
    return novaCast.call(this, p, a, data, st, Object.assign({}, N, { p: np }));
  };
  ED.CAST.meteor = function (p, a, data, st, N) {
    if (!takeInferno(p)) return meteorCast.call(this, p, a, data, st, N);
    const z0 = this.zones.length, out = meteorCast.call(this, p, a, data, st, N);
    for (let i = z0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (z.kind !== 'meteor' || z.owner !== p.pid) continue;
      const end = z.onEnd;
      z.zm *= st.infernoMul; z.r *= C.INFERNO_R;
      this.emit({ t: 'pyEng', pid: p.pid, n: 0, mx: st.heatMax, go: 1, k: 1, x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r) });
      z.onEnd = (w, zz) => { end(w, zz); w.emit({ t: 'pyEng', pid: p.pid, n: 0, mx: st.heatMax, go: 2, k: 1, x: Math.round(zz.x), y: Math.round(zz.y), r: Math.round(zz.r) }); };
    }
    return out;
  };

  // ---------------- Pyromancer hook table ----------------
  // Bonfire (secret): BONFIRE_N foes alive at once carry this Pyromancer's Burn, counted every BONFIRE_EVERY s.
  const BONFIRE_N = 30, BONFIRE_EVERY = 0.25;
  function bonfire(w, p) {
    const es = w.enemies;
    if (es.length < BONFIRE_N) return;
    let n = 0;
    for (let i = 0; i < es.length; i++) { const e = es[i]; if (e.hp > 0 && e.burnPool > 0 && e.burnOwner === p) n++; }
    if (n >= BONFIRE_N) w.secretP(p, 'heroSecret');
  }

  ED.CLS.pyro = {
    init(p) {
      p.bonT = 0; p.pyroQ = []; p.waves = []; p.phoenixT = 0; p.diveAt = 0; p.diveRoom = null; p.trailAt = null; p.burnAcc = 0; p.heat = 0; p.heatPing = 0;
      p.emberB = C.EMBER_CAP; p.emberAcc = 0; p.emberT = 0; p.sparks = 0; p.sparkAcc = 0; p.sparkUse = 0; p.afterN = 0; p.stormT = 0; p.spellSlot = -1; p.spellAt = -99;
    },

    // The Ember bucket refills and the cut it gathered goes to the client every EMBER_FLUSH s (whole hundredths; the rest waits). Rebirth Flare watches mantleAmt; a decaying shield lowers it without a flare.
    // White Heat times the burning foes, Inferno Engine refreshes the Heat count for the viewers every HEAT_PING s. The Supernova waves expand; Phoenix Form lays a trail patch every TRAIL_STEP px of a dash while its ring burns;
    // Sun Dive lays one every DIVE_STEP px of a flight and starts its second leap when SUN_GAP has passed.
    tick(p, dt) {
      const st = p.stats;
      p.emberB = Math.min(C.EMBER_CAP, p.emberB + C.EMBER_CAP * dt);
      if ((p.emberT -= dt) <= 0 && p.emberAcc > 0) { const s = Math.floor(p.emberAcc * 100 + 1e-6) / 100; if (s > 0) { this.refundSkill(p, -1, s); p.emberAcc -= s; } p.emberT = C.EMBER_FLUSH; }
      if (p.stormT > 0) p.stormT -= dt;
      if ((st.flashT > 0 || st.whiteHot > 0) && (p.burnAcc += dt) >= C.WHITE_EVERY) { burnScan(this, p, p.burnAcc); p.burnAcc = 0; }
      if (p.heat > 0 && (p.heatPing -= dt) <= 0) { p.heatPing = C.HEAT_PING; this.emit({ t: 'pyEng', pid: p.pid, n: p.heat, mx: st.heatMax }); }
      if (p.mantleAmt > p.shield) p.mantleAmt = Math.max(0, p.shield);
      if (!p.sec.heroSecret && (p.bonT -= dt) <= 0) { p.bonT = BONFIRE_EVERY; bonfire(this, p); }
      if (p.pyroQ.length) runQueue(this, p);
      if (p.waves.length) stepWaves(this, p);
      if (p.phoenixT > 0) p.phoenixT -= dt;
      if (p.phoenixT > 0 && st.phoenixSlow > 0) phoenixSlow(this, p, st);
      if (p.phoenixT > 0 && st.phoenixMul > 0 && (p.dashing || p.dashT > 0)) layTrail(this, p, ED.Stats.skillNums('nova', st).p.trail, C.TRAIL_STEP);
      else if (p.cometT > 0 && st.sunDive > 0) layTrail(this, p, ED.Stats.skillNums('meteor', st).p.trail, C.DIVE_STEP);
      else p.trailAt = null;
      if (p.diveAt > 0 && this.time >= p.diveAt) { p.diveAt = 0; if (p.diveRoom === this.room) diveAgain(this, p); }
    },

    // Living Flame: the weapon's hits also build Burn (the larger of the route's rate and the Fire path's).
    attackOpts(p, st) {
      return st.wInfFire > 0 ? { infAdd: { fire: Math.max(0, st.wInfFire - st.fireInfuse) } } : null;
    },

    // After each attack: Afterburn's extra bolts while armed.
    attack(p, a, st, w) {
      if (st.afterburn > 0 && (p.stormT > 0 || p.afterN > 0)) afterburn(this, p, a, st, w);
    },

    // Ember Bolt: a direct weapon hit (a shot, a beam, a lobbed landing; never a blast) cuts every spell cooldown, at most EMBER_CAP s per second; Kindling stores a Spark.
    // A flame cone tick (Cinder Arms) counts as CONE_TICK s of bolting that foe: it cuts EMBER_PS x CONE_TICK and adds CONE_TICK / the attack interval of a Spark (p.sparkAcc).
    hitDone(p, e, dmg, crit, src) {
      if (!src.wpn || src.kind !== 'weapon') return;
      const st = p.stats, cone = src.part === 'cone', per = cone ? C.EMBER_PS * C.CONE_TICK : C.EMBER_PS * st.atkInterval / Math.max(1, (st.weapon.n || 1) + st.projN);
      const cut = per * (1 + st.emberMul) * (e.fodder ? C.EMBER_FODDER : 1), got = Math.min(p.emberB, cut);
      if (got > 0) { p.emberB -= got; p.emberAcc += got; }
      if (!(st.spark > 0 && p.sparks < st.sparkMax)) return;
      if (!cone) p.sparks++;
      else if ((p.sparkAcc += C.CONE_TICK / st.atkInterval) >= 1) { p.sparkAcc -= 1; p.sparks++; }
    },

    // White Heat adds to spell hits on burning foes; White Flame adds whiteHot to every hit on a white-hot foe.
    hitMul(p, e, src) {
      const st = p.stats;
      let m = 0;
      if (st.searSkill && src.kind === 'skill' && burning(e)) m += st.searSkill;
      if (isWhite(p, e)) m += st.whiteHot;
      return m;
    },

    // Flashpoint: a spell hit on a foe that has burned flashT s in a row always crits.
    hitCrit(p, e, src) {
      const st = p.stats;
      if (!(st.flashT > 0) || src.kind !== 'skill' || burnedFor(p, e) < st.flashT - 1e-9) return false;
      this.emit({ t: 'pyFlash', pid: p.pid, x: Math.round(e.x), y: Math.round(e.y - e.r) });
      return true;
    },

    // A Fireball bursts on the first foe it touches (projHit), on a wall or at the end of its flight (projEnd).
    projHit(pr, e) { if (pr.fb) { const o = this.players.get(pr.owner); if (o) fbBurst(this, o, pr, 0); } },
    projEnd(pr, owner, why) { if (pr.fb) fbBurst(this, owner, pr, why === 'wall' ? 8 : 0); },

    // Rebirth Flare: the Mantle part of the shield is used up.
    absorb(p, absorbed) {
      if (!(p.mantleAmt > 0)) return;
      p.mantleAmt = Math.max(0, p.mantleAmt - absorbed);
      if (p.mantleAmt > 1e-6) return;
      p.mantleAmt = 0;
      if (!(p.stats.mantleBurst > 0)) return;
      const N = ED.Stats.skillNums('nova', p.stats), q = N.p.flare;
      this.skillBlast(p, p.x, p.y, q.r, q.dmg, this.partSrc(p, N, 'flare'));
      this.emit({ t: 'pyRebirth', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(q.r) });
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
