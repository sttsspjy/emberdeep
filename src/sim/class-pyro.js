// Pyromancer: Flame Nova and Meteor, the route cards that act on them (Channel, Magma Heart's aftershock and Lava Pools, Twin Nova, Phoenix Mantle, Twin Meteor, Comet, White Heat, Heat Engine) and the hook table ED.CLS.pyro.
// Skill forms (rank 3): Supernova (an expanding wave and a collapse), Phoenix Form (a ring that follows the hero and a dash trail), Cataclysm (five meteors and one lava field), Sun Dive (a second Comet leap and a trail).
// Delayed effects (Collapse pull, the Nova echo and wave start, aftershocks, the Cataclysm meteors) wait in the hero's queue p.pyroQ and run from the tick hook; Meteors are 'meteor' zones that land through their onEnd.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, C = ED.CONST, Sim = ED.Sim;
  const W = ED.World.prototype;
  const fin = (v) => typeof v === 'number' && isFinite(v);

  // CHAN_IDLE: shortest pause between attacks that ends Channel (ED.chanWindow). AFTERSHOCK_T: delay of Magma Heart's second eruption. PULL_LEAD: Collapse pulls this long before the echo. LAVA_T / LAVA_R: Lava Pool life and radius share of the blast.
  // LAVA_MAX: most Lava Pools a hero keeps alive. MANTLE_CD: seconds between Mantle shields. HEAT_MAX: most cooldown one cast cuts. HEAT_CD: seconds between Chain Reactions. LAVA_TAG: zone field w of a Lava Pool (and of the Cataclysm field), COMET_TAG: of the Meteor a Comet rides,
  // PHOENIX_TAG: of the Phoenix Form ring (the tags only tell the renderer which look to draw). SUN_GAP: seconds between the landing and the second Sun Dive leap. STORM_GAP / STORM_OFF: seconds between the Cataclysm meteors and px from the cursor point of the four outer ones.
  // TRAIL_STEP / DIVE_STEP: px between two trail patches of a dash and of a Sun Dive flight.
  Object.assign(C, { CHAN_IDLE: 0.6, AFTERSHOCK_T: 0.4, PULL_LEAD: 0.15, LAVA_T: 2, LAVA_R: 0.6, MANTLE_CD: 10, HEAT_MAX: 1.5, HEAT_CD: 6, LAVA_TAG: 9, COMET_TAG: 1, LAVA_MAX: 4, PHOENIX_TAG: 10, SUN_GAP: 0.5, STORM_GAP: 0.1, STORM_OFF: 80, TRAIL_STEP: 20, DIVE_STEP: 28 });

  // Seconds after an attack that keep Channel alive: CHAN_IDLE, or 1.25 x the hero's attack interval when that is longer (a Heavy weapon attacks less often than every 0.6 s and would never build it).
  ED.chanWindow = (p) => Math.max(C.CHAN_IDLE, 1.25 * ED.Stats.attackInterval(p));

  const burningSet = (w) => { const s = new Set(); for (const e of w.enemies) if (e.hp > 0 && e.burnPool > 0) s.add(e.id); return s; };

  // Heat Engine: n distinct burning foes hit by a cast of skill `slot` cut HEAT_MAX at most from the other skill's cooldown (heatEngine seconds each); Chain Reaction (n >= heatChain, once per HEAT_CD) refunds it in full.
  function heat(w, p, slot, n) {
    const st = p.stats;
    if (!(st.heatEngine > 0) || n <= 0) return;
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

  // ---------------- Flame Nova ----------------
  // A ring of fire around the hero: every foe struck takes the blast and a Burn add (pre-affinity, the adder applies the stratum's). Cards: the ring and Mantle (Phoenix Mantle; Phoenix Form: a ring that follows the hero),
  // the echo and Collapse (Twin Nova; Supernova: the echo is an expanding wave), Heat Engine's cooldown cut.
  ED.CAST.nova = function (p, a, data, st, N) {
    const q = N.p.blast, b = N.p.burn, ring = N.p.ring, ph = N.p.phoenix, echo = N.p.echo.on ? N.p.echo : N.p.wave.on ? N.p.wave : null, wave = echo === N.p.wave, burning = st.heatEngine > 0 ? burningSet(this) : null, seen = burning ? new Set() : null;
    let hit = 0;
    this.skillBlast(p, p.x, p.y, q.r, q.dmg, this.partSrc(p, N, 'blast'), (e, dealt) => {
      if (!(dealt > 0)) return;
      hit++;
      if (burning && burning.has(e.id)) seen.add(e.id);
      if (e.hp > 0) this.addBurn(e, b.dmg * (1 + st.classElMul), p);
    });
    this.emit({ t: 'nova', x: p.x, y: p.y, r: q.r, c: '#ff7a2a' });
    if (ring.on) this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: ring.r, dur: ring.dur, dps: ring.dmg, owner: p.pid, team: 0, clsEl: st.element });
    if (ph.on) phoenixRing(this, p, ph, st);
    if (hit && st.mantle > 0 && p.mantleT <= 0) mantle(this, p);
    if (burning) heat(this, p, 0, seen.size);
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
      if (st.supernovaPull > 0) { pull(w, v.x, v.y, v.r1, st.supernovaPull); w.emit({ t: 'pyPull', pid: p.pid, x: Math.round(v.x), y: Math.round(v.y), r: Math.round(v.r1), px: st.supernovaPull }); }
    }
  }

  // ---------------- Meteor ----------------
  // A friendly telegraph, then the impact (Burn add = half the impact before affinity) and a burning crater. Twin Meteor chains a second impact on the foe nearest the first; Meteor Shower rains meteorites around each impact;
  // Comet is the hero's own leap (the client moves it, the sim only times the landing and the airborne flag); Sun Dive adds a second leap toward the cursor SUN_GAP after the landing (p.diveAt).
  // Cataclysm casts five meteors instead of one: the cursor point at once, four STORM_OFF px around it STORM_GAP apart (queued in p.pyroQ).
  ED.CAST.meteor = function (p, a, data, st, N) {
    const t = this.groundTarget(p, a, data, 'meteor'), comet = st.comet > 0 && N.move && N.move.k === 'leap';
    if (N.p.storm.on) castStorm(this, p, t, N);
    else this.castMeteor(p, t.x, t.y, comet ? N.move.t : N.p.impact.delay, comet ? 1 + st.comet : 1, comet ? 'comet' : 'main');
    if (comet) {
      p.cometT = N.move.t;
      this.emit({ t: 'pyComet', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(t.x), ty: Math.round(t.y), d: N.move.t });
      if (st.sunDive > 0) { p.diveAt = this.time + N.move.t + C.SUN_GAP; p.diveRoom = this.room; }
    }
    return { tx: Math.round(t.x), ty: Math.round(t.y) };
  };

  // Cataclysm: a group (grp) of five meteors that share one lava field and one Heat Engine count; the field forms where the cursor point was when the last one has landed.
  function castStorm(w, p, t, N) {
    const q = N.p.storm, grp = { left: q.n, burning: null, seen: new Set(), x: t.x, y: t.y }, base = Math.atan2(t.y - p.y, t.x - p.x);
    w.castMeteor(p, t.x, t.y, q.delay, 1, 'storm', grp);
    for (let k = 0; k < q.n - 1; k++) {
      const an = base + k * Math.PI / 2;
      let x = t.x + Math.cos(an) * C.STORM_OFF, y = t.y + Math.sin(an) * C.STORM_OFF;
      if (D.blocksShots(D.tileAt(w.room, x, y), w.locked)) { x = t.x; y = t.y; }
      p.pyroQ.push({ at: w.time + C.STORM_GAP * (k + 1), k: 'storm', x, y, grp, room: w.room });
    }
    w.emit({ t: 'pyStorm', pid: p.pid, x: Math.round(t.x), y: Math.round(t.y), r: Math.round(C.STORM_OFF) });
  }

  // The second Sun Dive leap: toward the cursor (clamped to the Meteor's range and cut at walls), landing as another Comet impact after the leap time. The hero's own client moves it: a hero this world moves gets its skillMove here,
  // a remote one a 'leap' message (the client starts the same move).
  function diveAgain(w, p) {
    const st = p.stats, N = ED.Stats.skillNums('meteor', st), mv = N.move;
    if (!(st.sunDive > 0) || !mv || mv.k !== 'leap' || p.downed || p.dead) return;
    let tx = p.aimX, ty = p.aimY;
    if (!fin(tx) || !fin(ty)) { tx = p.x + Math.cos(p.face) * 200; ty = p.y + Math.sin(p.face) * 200; }
    const g = Sim.groundPoint(w.room, w.locked, p.x, p.y, tx, ty, N.range, false);
    w.castMeteor(p, g.x, g.y, mv.t, 1 + st.comet, 'comet');
    p.cometT = mv.t;
    w.emit({ t: 'pyComet', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(g.x), ty: Math.round(g.y), d: mv.t });
    if (p.remote) w.msgs.push({ to: p.pid, t: 'leap', x: Math.round(g.x), y: Math.round(g.y), d: mv.t, i: mv.iframes });
    else p.skillMove = ED.leapMove(w.room, w.locked, p, g.x, g.y, mv);
  }

  // kind: 'main' | 'comet' (the cast's own impact, damage x mul) | 'twin' | 'rock' | 'storm' (one of the five Cataclysm meteors; grp is their shared record).
  W.castMeteor = function (p, x, y, delay, mul, kind, grp) {
    const N = ED.Stats.skillNums('meteor', p.stats), q = kind === 'rock' ? N.p.rocks : kind === 'twin' ? N.p.twin : kind === 'storm' ? N.p.storm : N.p.impact;
    this.addZone({ kind: 'meteor', x, y, r: q.r, dur: delay, team: 0, owner: p.pid, custom: true, w: kind === 'comet' ? C.COMET_TAG : 0, onEnd: (w, z) => meteorLand(w, z, mul, kind, grp) });
  };

  function meteorLand(w, z, mul, kind, grp) {
    const o = w.players.get(z.owner);
    if (!o) return;
    const st = o.stats, N = ED.Stats.skillNums('meteor', st), im = N.p.impact, cr = N.p.crater, twin = kind === 'twin', rock = kind === 'rock', comet = kind === 'comet', storm = kind === 'storm';
    const q = rock ? N.p.rocks : twin ? N.p.twin : storm ? N.p.storm : im, own = !twin && !rock && !storm;
    if (storm && grp.burning === null) grp.burning = st.heatEngine > 0 ? burningSet(w) : false;
    const burning = storm ? grp.burning : own && st.heatEngine > 0 ? burningSet(w) : null, seen = storm ? grp.seen : burning ? new Set() : null;
    const src = w.partSrc(o, N, rock ? 'rocks' : twin ? 'twin' : storm ? 'storm' : 'impact', comet && st.cometStun ? { knock: im.knock * 2 } : undefined);
    w.skillBlast(o, z.x, z.y, z.r, q.dmg * mul, src, (e, dealt, pre) => {
      if (!(dealt > 0)) return;
      if (burning && burning.has(e.id)) seen.add(e.id);
      if (e.hp > 0) {
        w.addBurn(e, pre * im.statusAdd.burn, o);
        if (comet && st.cometStun) w.stunFoe(e, st.cometStun, false);
      }
    });
    w.emit({ t: 'boom', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: rock ? 'fire' : 'bigfire' });
    if (own) w.addZone({ kind: 'pfire', x: z.x, y: z.y, r: cr.r, dur: cr.dur, dps: cr.dmg, owner: o.pid, team: 0, clsEl: st.element });
    if (storm) {
      if (--grp.left > 0) return;
      const f = N.p.field;
      w.addZone({ kind: 'pfire', x: grp.x, y: grp.y, r: f.r, dur: f.dur, dps: f.dmg, owner: o.pid, team: 0, clsEl: st.element, w: C.LAVA_TAG });
      w.emit({ t: 'pyField', pid: o.pid, x: Math.round(grp.x), y: Math.round(grp.y), r: Math.round(f.r) });
      if (burning) heat(w, o, 1, seen.size);
      return;
    }
    if (burning) heat(w, o, 1, seen.size);
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

  // ---------------- Magma Heart ----------------
  // A Lava Pool: untagged burning ground of the blast radius x LAVA_R; a new pool inside the hero's own live pool extends it to LAVA_T more seconds instead (one pool per spot).
  function lavaPool(w, p, x, y, r, dps) {
    let n = 0, old = null;
    for (const z of w.zones) {
      if (!z.lava || z.owner !== p.pid) continue;
      if (U.dist2(z.x, z.y, x, y) < z.r * z.r) { z.dur = z.t + C.LAVA_T; z.dps = Math.max(z.dps, dps); return; } // a refresh extends the life (z.t keeps running, so the pool never fades out between aftershocks)
      n++;
      if (!old || z.dur - z.t < old.dur - old.t) old = z; // the pool with the least life left (a refresh resets that to LAVA_T)
    }
    if (n >= C.LAVA_MAX) { old.x = x; old.y = y; old.r = r * C.LAVA_R; old.t = 0; old.dur = C.LAVA_T; old.dps = dps; w.emit({ t: 'pyLava', pid: p.pid, x: Math.round(x), y: Math.round(y), r: Math.round(r * C.LAVA_R) }); return; } // a hero keeps at most LAVA_MAX pools: the oldest moves to the new spot and starts anew
    w.addZone({ kind: 'pfire', x, y, r: r * C.LAVA_R, dur: C.LAVA_T, dps, owner: p.pid, team: 0, untagged: true, lava: true, w: C.LAVA_TAG });
    w.emit({ t: 'pyLava', pid: p.pid, x: Math.round(x), y: Math.round(y), r: Math.round(r * C.LAVA_R) });
  }

  // The queued effects of hero p that are due: the Collapse pull, the Nova echo, and Magma Heart's aftershock (a physical blast of the weapon, Channel counts, it never infuses) with its Lava Pool.
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
      else if (en.k === 'storm') w.castMeteor(p, en.x, en.y, ED.Stats.skillNums('meteor', p.stats).p.storm.delay, 1, 'storm', en.grp);
      else {
        w.explode(en.x, en.y, en.r, en.dmg, 0, p, 'magma', true, { wpn: true, part: 'aftershock' });
        if (en.lava > 0) lavaPool(w, p, en.x, en.y, en.r, en.lava);
      }
    }
  }

  // Overheat: Channel is at its cap.
  const channelFull = (p, st) => st.channel > 0 && st.channel * Math.floor(p.chanT / Math.max(0.05, st.chanStep)) >= st.chanCap - 1e-9;

  // ---------------- Pyromancer hook table ----------------
  ED.CLS.pyro = {
    init(p) { p.pyroQ = []; p.waves = []; p.phoenixT = 0; p.diveAt = 0; p.diveRoom = null; p.trailAt = null; },

    // Channel builds while the hero stands still and keeps attacking; moving or a pause longer than ED.chanWindow ends it. Rebirth Flare watches mantleAmt; a decaying shield lowers it without a flare.
    // The Supernova waves expand; Phoenix Form lays a trail patch every TRAIL_STEP px of a dash while its ring burns; Sun Dive lays one every DIVE_STEP px of a flight and starts its second leap when SUN_GAP has passed.
    tick(p, dt) {
      const st = p.stats;
      p.chanT = st.channel > 0 && !p.moving && this.time - p.lastAtkT < ED.chanWindow(p) ? p.chanT + dt : 0;
      if (p.mantleAmt > p.shield) p.mantleAmt = Math.max(0, p.shield);
      if (p.pyroQ.length) runQueue(this, p);
      if (p.waves.length) stepWaves(this, p);
      if (p.phoenixT > 0) p.phoenixT -= dt;
      if (p.phoenixT > 0 && st.phoenixMul > 0 && (p.dashing || p.dashT > 0)) layTrail(this, p, ED.Stats.skillNums('nova', st).p.trail, C.TRAIL_STEP);
      else if (p.cometT > 0 && st.sunDive > 0) layTrail(this, p, ED.Stats.skillNums('meteor', st).p.trail, C.DIVE_STEP);
      else p.trailAt = null;
      if (p.diveAt > 0 && this.time >= p.diveAt) { p.diveAt = 0; if (p.diveRoom === this.room) diveAgain(this, p); }
    },

    // Living Flame: the weapon's hits also build Burn (the larger of the route's rate and Kindle's); Overheat: at full Channel shots pierce more and their blasts are wider.
    attackOpts(p, st) {
      const o = {};
      if (st.wInfFire > 0) o.infAdd = { fire: Math.max(0, st.wInfFire - st.fireInfuse) };
      if (st.overheat && channelFull(p, st)) { o.pierce = st.overheat; o.blastMul = 1.2; o.blastPierce = true; }
      return o.infAdd || o.pierce ? o : null;
    },

    // Channel adds to weapon hits; White Heat adds to skill hits on burning foes.
    hitMul(p, e, src) {
      const st = p.stats;
      let m = 0;
      if (src.wpn && st.channel > 0 && p.chanT > 0) m += Math.min(st.chanCap, st.channel * Math.floor(p.chanT / Math.max(0.05, st.chanStep)));
      if (st.searSkill && src.kind === 'skill' && e.burnPool > 0) m += st.searSkill;
      return m;
    },

    // Flashpoint: Nova and Meteor always crit a foe whose Burn pool is over burnCrit of its max HP.
    hitCrit(p, e, src) {
      const st = p.stats;
      if (!st.burnCrit || src.kind !== 'skill' || !(e.burnPool > st.burnCrit * e.maxHp)) return false;
      this.emit({ t: 'pyFlash', pid: p.pid, x: Math.round(e.x), y: Math.round(e.y - e.r) });
      return true;
    },

    // Magma Heart: a shot's blast erupts again AFTERSHOCK_T later at `aftershock` of itself; rank 3 leaves a Lava Pool of lavaPool of the shot per second.
    projBurst(pr, owner) {
      const st = owner.stats;
      if (!(st.aftershock > 0) || !pr.wpn || !pr.explode) return;
      const shot = pr.dmg * (pr.mul || 1);
      owner.pyroQ.push({ at: this.time + C.AFTERSHOCK_T, k: 'after', x: pr.x, y: pr.y, r: pr.explode.r, dmg: shot * pr.explode.mul * st.aftershock, lava: shot * st.lavaPool, room: this.room });
      this.emit({ t: 'pyAfter', pid: owner.pid, x: Math.round(pr.x), y: Math.round(pr.y), r: Math.round(pr.explode.r), d: C.AFTERSHOCK_T });
    },

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
