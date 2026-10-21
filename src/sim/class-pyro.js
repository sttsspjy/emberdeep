// Pyromancer: Flame Nova and Meteor, the route cards that act on them (Channel, Magma Heart's aftershock and Lava Pools, Twin Nova, Phoenix Mantle, Twin Meteor, Comet, White Heat, Heat Engine) and the hook table ED.CLS.pyro.
// Delayed effects (Collapse pull, the Nova echo, aftershocks) wait in the hero's queue p.pyroQ and run from the tick hook; Meteors are 'meteor' zones that land through their onEnd.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, C = ED.CONST;
  const W = ED.World.prototype;

  // CHAN_IDLE: shortest pause between attacks that ends Channel (ED.chanWindow). AFTERSHOCK_T: delay of Magma Heart's second eruption. PULL_LEAD: Collapse pulls this long before the echo. LAVA_T / LAVA_R: Lava Pool life and radius share of the blast.
  // LAVA_MAX: most Lava Pools a hero keeps alive. MANTLE_CD: seconds between Mantle shields. HEAT_MAX: most cooldown one cast cuts. HEAT_CD: seconds between Chain Reactions. LAVA_TAG: zone field w of a Lava Pool, COMET_TAG: of the Meteor a Comet rides (both only tell the renderer which look to draw).
  Object.assign(C, { CHAN_IDLE: 0.6, AFTERSHOCK_T: 0.4, PULL_LEAD: 0.15, LAVA_T: 2, LAVA_R: 0.6, MANTLE_CD: 10, HEAT_MAX: 1.5, HEAT_CD: 6, LAVA_TAG: 9, COMET_TAG: 1, LAVA_MAX: 4 });

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
  // A ring of fire around the hero: every foe struck takes the blast and a Burn add (pre-affinity, the adder applies the stratum's). Cards: the ring and Mantle (Phoenix Mantle), the echo and Collapse (Twin Nova), Heat Engine's cooldown cut.
  ED.CAST.nova = function (p, a, data, st, N) {
    const q = N.p.blast, b = N.p.burn, ring = N.p.ring, echo = N.p.echo, burning = st.heatEngine > 0 ? burningSet(this) : null, seen = burning ? new Set() : null;
    let hit = 0;
    this.skillBlast(p, p.x, p.y, q.r, q.dmg, this.partSrc(p, N, 'blast'), (e, dealt) => {
      if (!(dealt > 0)) return;
      hit++;
      if (burning && burning.has(e.id)) seen.add(e.id);
      if (e.hp > 0) this.addBurn(e, b.dmg * (1 + st.classElMul), p);
    });
    this.emit({ t: 'nova', x: p.x, y: p.y, r: q.r, c: '#ff7a2a' });
    if (ring.on) this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: ring.r, dur: ring.dur, dps: ring.dmg, owner: p.pid, team: 0, clsEl: st.element });
    if (hit && st.mantle > 0 && p.mantleT <= 0) mantle(this, p);
    if (burning) heat(this, p, 0, seen.size);
    if (echo.on) {
      const t = this.time;
      if (st.novaPull) p.pyroQ.push({ at: t + echo.delay - C.PULL_LEAD, k: 'pull', room: this.room });
      p.pyroQ.push({ at: t + echo.delay, k: 'echo', room: this.room });
      this.emit({ t: 'pyEcho', pid: p.pid, d: echo.delay, r: Math.round(echo.r), pull: st.novaPull ? 1 : 0 });
    }
    return {};
  };

  // The second eruption: around the hero where it stands now, at the echo part's damage and a Burn add scaled the same way.
  function runEcho(w, p) {
    const st = p.stats, N = ED.Stats.skillNums('nova', st), q = N.p.echo, b = N.p.burn;
    w.emit({ t: 'pyEcho', pid: p.pid, go: 1, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(q.r) });
    w.skillBlast(p, p.x, p.y, q.r, q.dmg, w.partSrc(p, N, 'echo'), (e, dealt) => { if (e.hp > 0 && dealt > 0) w.addBurn(e, b.dmg * st.novaEcho * (1 + st.classElMul), p); });
  }

  // ---------------- Meteor ----------------
  // A friendly telegraph, then the impact (Burn add = half the impact before affinity) and a burning crater. Twin Meteor chains a second impact on the foe nearest the first; Meteor Shower rains meteorites around each impact;
  // Comet is the hero's own leap (the client moves it, the sim only times the landing and the airborne flag).
  ED.CAST.meteor = function (p, a, data, st, N) {
    const t = this.groundTarget(p, a, data, 'meteor'), comet = st.comet > 0 && N.move && N.move.k === 'leap';
    this.castMeteor(p, t.x, t.y, comet ? N.move.t : N.p.impact.delay, comet ? 1 + st.comet : 1, comet ? 'comet' : 'main');
    if (comet) { p.cometT = N.move.t; this.emit({ t: 'pyComet', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(t.x), ty: Math.round(t.y), d: N.move.t }); }
    return { tx: Math.round(t.x), ty: Math.round(t.y) };
  };

  // kind: 'main' | 'comet' (the cast's own impact, damage x mul) | 'twin' | 'rock'.
  W.castMeteor = function (p, x, y, delay, mul, kind) {
    const N = ED.Stats.skillNums('meteor', p.stats), q = kind === 'rock' ? N.p.rocks : kind === 'twin' ? N.p.twin : N.p.impact;
    this.addZone({ kind: 'meteor', x, y, r: q.r, dur: delay, team: 0, owner: p.pid, custom: true, w: kind === 'comet' ? C.COMET_TAG : 0, onEnd: (w, z) => meteorLand(w, z, mul, kind) });
  };

  function meteorLand(w, z, mul, kind) {
    const o = w.players.get(z.owner);
    if (!o) return;
    const st = o.stats, N = ED.Stats.skillNums('meteor', st), im = N.p.impact, cr = N.p.crater, twin = kind === 'twin', rock = kind === 'rock', comet = kind === 'comet';
    const q = rock ? N.p.rocks : twin ? N.p.twin : im, own = !twin && !rock, burning = own && st.heatEngine > 0 ? burningSet(w) : null, seen = burning ? new Set() : null;
    const src = w.partSrc(o, N, rock ? 'rocks' : twin ? 'twin' : 'impact', comet && st.cometStun ? { knock: im.knock * 2 } : undefined);
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
  // A Lava Pool: untagged burning ground of the blast radius x LAVA_R; a new pool inside the hero's own live pool refreshes it instead (one pool per spot).
  function lavaPool(w, p, x, y, r, dps) {
    let n = 0, old = null;
    for (const z of w.zones) {
      if (!z.lava || z.owner !== p.pid) continue;
      if (U.dist2(z.x, z.y, x, y) < z.r * z.r) { z.t = 0; z.dps = Math.max(z.dps, dps); return; }
      n++;
      if (!old || z.t > old.t) old = z;
    }
    if (n >= C.LAVA_MAX) { old.x = x; old.y = y; old.r = r * C.LAVA_R; old.t = 0; old.dps = dps; return; } // a hero keeps at most LAVA_MAX pools: the oldest moves to the new spot
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
      if (en.k === 'pull') { const N = ED.Stats.skillNums('nova', p.stats); pull(w, p.x, p.y, N.p.echo.r, p.stats.novaPull); w.emit({ t: 'pyPull', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(N.p.echo.r), px: p.stats.novaPull }); }
      else if (en.k === 'echo') runEcho(w, p);
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
    init(p) { p.pyroQ = []; },

    // Channel builds while the hero stands still and keeps attacking; moving or a pause longer than ED.chanWindow ends it. Rebirth Flare watches mantleAmt; a decaying shield lowers it without a flare.
    tick(p, dt) {
      const st = p.stats;
      p.chanT = st.channel > 0 && !p.moving && this.time - p.lastAtkT < ED.chanWindow(p) ? p.chanT + dt : 0;
      if (p.mantleAmt > p.shield) p.mantleAmt = Math.max(0, p.shield);
      if (p.pyroQ.length) runQueue(this, p);
    },

    // Living Flame: the weapon's hits also build Burn (the larger of the route's rate and Kindle's); Overheat: at full Channel shots pierce more and their blasts are wider.
    attackOpts(p, st) {
      const o = {};
      if (st.wInfFire > 0) o.infAdd = { fire: Math.max(0, st.wInfFire - st.fireInfuse) };
      if (st.overheat && channelFull(p, st)) { o.pierce = st.overheat; o.blastMul = 1.2; }
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
