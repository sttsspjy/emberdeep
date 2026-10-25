// Cleric: Sanctuary and Judgment (base kits from ED.SKILLS numbers), the Judgment hammers, the wave hooks of the Attack route, the Verdict and Prism payoffs and the Cleric hook table ED.CLS.cleric.
// Judged = e.judged seconds (+20% damage taken); Verdict also weakens a Judged foe (e.weakT / e.weakV, read by hurtPlayer). Only a hammer hit stamps e.judgeOwner / e.judgeCast / e.judgeUntil (the kill shield of Judgment needs the hammer's own Judged window).
// Skill forms (rank 3): Wrath of Heaven (nova + pillars of light), Aegis of Dawn (a wider aura that pulses a stun and a strike), Hammerstorm (five hammers, two round trips), Final Judgment (Judged foes echo the damage they take).
// Route forms (rank 3): Dawn's Wake (a burning strip per wave), Returning Light (every wave turns back to the hero), Sunstrike (every 3rd Smite on a foe; combat.js smite calls the sunstrike hook), Spectrum (the Prism beam splits).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST;
  const W = ED.World.prototype;
  const HAMMER_OUT = 0.55, HAMMER_SPEED = 360, HAMMER_BACK = 420, V_ANGLE = 0.2; // Judgment: seconds out, px/s out and home, half-angle of the Twin Hammers V
  const FLARE_R = 50, FAN = 0.25, BEAM_R = 120, HG_JUDGE = 0.6, AURA_T = 0.3; // Solar Flare radius, Litany fan half-angle, Prism reach, seconds of Judged one Hallowed Ground tick refreshes, seconds one Embolden refresh lasts
  const STORM_STEP = 0.25, PILLAR_T = 0.5, PILLAR_REPEAT = 1, AEGIS_T = 2, ECHO_R = 200; // Hammerstorm fan step (5 hammers span +-0.5 rad), seconds between pillars, seconds a struck foe is passed over, seconds between Aegis pulses, Final Judgment echo reach
  // Dawn's Wake: strip width, seconds it burns after its wave ends, seconds between ticks, share of a tick stored as Radiance (as a Sanctuary tick). STEP: the fixed sim step. RET_LIFE: longest flight of a returning wave.
  // SUN_EVERY: Smites on one foe per Sunstrike. PRISM_R: reach of the Spectrum beams.
  const WAKE_W = 44, WAKE_T = 2, WAKE_TICK = 0.25, WAKE_RAD = 0.25, STEP = 1 / 60, RET_LIFE = 2, SUN_EVERY = 3, PRISM_R = 160;
  const NO_HIT = { has: () => true, add: () => {} }; // hammer pr.hit: updateProjectiles never collides with it, updateHammers does
  C.GL_T = 6; // seconds a Guardian Light buff lasts (combat.js smite)
  const live = (e) => e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed;
  const rnd = Math.round;

  // Judges foe e for hero o for dur seconds; stamp: a hammer hit of world w, which marks the cast and the hammer's own Judged window (judgeUntil) for the kill shield. With Verdict the foe also deals less damage (bosses half as much).
  function judgeFoe(e, o, dur, stamp, w) {
    e.judged = Math.max(e.judged, dur);
    if (w) w.jdgT = -1; // the Judged-foe list of Final Judgment is stale
    if (stamp) { e.judgeOwner = o.pid; e.judgeCast = o.castN; e.judgeUntil = Math.max(e.judgeUntil || 0, w.time + dur); }
    const st = o.stats;
    if (st.verdict) { e.weakT = e.judged; e.weakV = Math.max(e.weakV, e.boss ? st.judgeWeak / 2 : st.judgeWeak); }
  }

  // Wrath of Heaven: every PILLAR_T seconds a pillar of light strikes one random foe inside (w.rng) for the pillar part, passing over the foes struck in the last PILLAR_REPEAT seconds while others are inside.
  function wrathPillar(w, z, o, st) {
    const N = ED.Stats.skillNums('sanctuary', st), q = N.p.pillar, fresh = [], all = [];
    for (const e of w.enemies) {
      if (!live(e) || e.invulnT > 0 || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
      all.push(e);
      if (!(e.pillarAt > w.time - PILLAR_REPEAT)) fresh.push(e);
    }
    const pool = fresh.length ? fresh : all;
    if (!pool.length) return;
    const e = pool[w.rng.int(0, pool.length - 1)];
    e.pillarAt = w.time;
    const d = Math.hypot(e.x - z.x, e.y - z.y) || 1;
    w.hitEnemy(e, q.dmg, w.partSrc(o, N, 'pillar', { crit: false, noGuard: true, kx: (e.x - z.x) / d, ky: (e.y - z.y) / d, x: e.x, y: e.y, infAdd: { holy: 0.5 } }));
    w.emit({ t: 'pillar', x: rnd(e.x), y: rnd(e.y), pid: o.pid });
  }

  // Aegis of Dawn: a pulse stuns (repeating) every non-boss foe inside, each at most once per AEGIS_T seconds; every pulse after the cast's also strikes every foe inside for the pulse part (a zone tick: no crit, no procs).
  // The event carries the circle for the viewers.
  function aegisPulse(w, z, o, st, strike) {
    const N = strike ? ED.Stats.skillNums('sanctuary', st) : null;
    for (const e of w.enemies) {
      if (!live(e) || U.dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
      if (N) w.hitEnemy(e, N.p.pulse.dmg, w.partSrc(o, N, 'pulse', { crit: false, noProc: true, noGuard: true, x: z.x, y: z.y }));
      if (e.hp <= 0 || e.boss || e.aegisAt > w.time - AEGIS_T + 1e-6) continue;
      if (w.stunFoe(e, st.aegisStun, true) > 0) e.aegisAt = w.time;
    }
    w.emit({ t: 'aegispulse', x: rnd(z.x), y: rnd(z.y), r: rnd(z.r), pid: o.pid });
  }

  // Zone update of a Sanctuary (z.update, every tick): Hallowed Ground keeps the foes inside Judged, Embolden gives the allies inside an Aura of Faith +auraDmg damage for AURA_T,
  // Wrath of Heaven strikes pillars (z.pA seconds since the last) and Aegis of Dawn pulses (z.gA).
  function sanctTick(w, z, dt) {
    const o = w.players.get(z.owner);
    if (!o) return;
    const st = o.stats;
    if (st.wrath && (z.pA = (z.pA || 0) + dt) >= PILLAR_T - 1e-9) { z.pA -= PILLAR_T; wrathPillar(w, z, o, st); }
    if (st.dawn && (z.gA = (z.gA || 0) + dt) >= AEGIS_T - 1e-9) { z.gA -= AEGIS_T; aegisPulse(w, z, o, st, true); }
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
    const z = this.addZone({ kind: 'sanct', x: g.x, y: g.y, r: q.r, dur: q.dur, dps: q.dmg, owner: p.pid, team: 0, clsEl: st.element, rad: 0.25, dr: 0.15 + st.sanctDR + st.aegisDR, part: 'sanctuary.zone' });
    if (aura) z.follow = p.pid;
    if (st.dawn) { z.drCap = C.DR_FLOOR; z.w = 9; } // drCap: the cut this zone may reach (other Sanctuaries clamp at 40%); w 9 marks Aegis of Dawn for the renderer
    if (st.wrath) z.w = 8; // Wrath of Heaven
    if (st.sanctJudge || (aura && st.auraDmg) || st.wrath || st.dawn) z.update = sanctTick;
    const out = { x: rnd(g.x), y: rnd(g.y) };
    if (st.sanctStun) {
      out.hf = 1;
      for (const e of this.enemies) if (live(e) && U.dist2(e.x, e.y, g.x, g.y) < (q.r + e.r) ** 2) this.stunFoe(e, st.sanctStun, false);
    }
    if (st.wrath) { // the nova over the whole circle
      const nv = N.p.nova;
      this.skillBlast(p, g.x, g.y, nv.r, nv.dmg, this.partSrc(p, N, 'nova', { crit: false, knock: nv.knock, infAdd: { holy: 0.5 } }));
      out.wr = 1;
    }
    if (st.dawn) aegisPulse(this, z, p, st); // the first pulse comes with the cast
    if (aura) out.au = 1;
    return out;
  };

  // Judgment: a hammer (two in a V with Twin Hammers, a fan of five with Hammerstorm) flies out, turns and returns; each leg hits a foe once and Judges it. With Second Flight it flies out and back once more along the cast angle.
  // p.hammers = [{ pr, leg (0 out, 1 home, 2 out, 3 home), t (flown), legT, hit, x, y, a (cast angle), life, at (world time cast), room }]; an odd leg homes on the hero.
  ED.CAST.judgment = function (p, a, data, st) {
    p.castN++;
    if (st.storm > 0) { const n = Math.round(st.storm); for (let i = 0; i < n; i++) this.throwHammer(p, a + (i - (n - 1) / 2) * STORM_STEP); } else if (st.twinHammer) { this.throwHammer(p, a - V_ANGLE); this.throwHammer(p, a + V_ANGLE); } else this.throwHammer(p, a);
    return st.storm > 0 ? { st: 1 } : {};
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
        judgeFoe(e, p, 4 + st.judgeDur, true, this); // judged before the hit lands: the leg itself takes the +20%
        this.hitEnemy(e, q.dmg, this.partSrc(p, N, 'leg', { knock: 90, kx: pr.vx / sp, ky: pr.vy / sp, x: pr.x, y: pr.y, infAdd: { holy: 0.5 }, mul: h.leg >= 2 && !(st.storm > 0) ? st.secondFlight || 1 : undefined })); // Second Flight legs hit at secondFlight of a hit (Hammerstorm: every leg is the part's damage)
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

  // Final Judgment: the Judged foes of the world, rebuilt once per tick (w.jdgT is the world time of the list; judgeFoe resets it).
  function judgedFoes(w) {
    if (w.jdgT !== w.time) { w.jdgT = w.time; w.jdgL = w.enemies.filter(f => f.hp > 0 && f.judged > 0); }
    return w.jdgL;
  }
  // Final Judgment: p.echoQ collects fjEcho of every hit on a Judged foe per other Judged foe within ECHO_R ({ a: damage, x, y: the last source }); one echo hit per foe and tick pays it out.
  // An echo is raw (no hero multiplier, no crit, no infusions or on-hit effects), marked src.echo so hitDone never echoes it again; fodder takes and gives echoes.
  function flushEcho(w, p) {
    const q = p.echoQ;
    p.echoQ = new Map();
    for (const [f, o] of q) {
      if (f.hp <= 0) continue;
      w.hitEnemy(f, o.a, { p, kind: 'echo', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', echo: true, x: o.x, y: o.y });
      w.emit({ t: 'jecho', x0: rnd(o.x), y0: rnd(o.y), x1: rnd(f.x), y1: rnd(f.y), pid: p.pid });
    }
  }

  // Dawn's Wake: a 'crack' zone (arc 2 marks it for the renderer) from the wave's launch point that grows with the wave and burns WAKE_T s after the wave ends.
  // Every WAKE_TICK s the foes on the strip take wake x the wave's damage x the tick as Holy class damage (no crit) and store a share WAKE_RAD of it as Radiance.
  function wake(w, p, pr, a) {
    w.addZone({ kind: 'crack', arc: 2, x: pr.x, y: pr.y, a, len: 0, w: WAKE_W, dur: 99, team: 0, owner: p.pid, custom: true, dmg: pr.dmg, acc: 0, pr, update: wakeTick });
  }
  function wakeTick(w, z, dt) {
    const o = w.players.get(z.owner);
    if (!o) { z.dur = z.t; return; }
    if (z.pr) {
      if (z.pr.life > 0 && w.projs.indexOf(z.pr) >= 0) z.len = Math.hypot(z.pr.x - z.x, z.pr.y - z.y);
      else { z.pr = null; z.dur = z.t + WAKE_T; }
    }
    if (z.len < 8 || (z.acc += dt) < WAKE_TICK) return;
    z.acc -= WAKE_TICK;
    const base = z.dmg * o.stats.wake * WAKE_TICK, cs = Math.cos(z.a), sn = Math.sin(z.a), x1 = z.x + cs * z.len, y1 = z.y + sn * z.len;
    const q = w.foeScan((z.x + x1) / 2, (z.y + y1) / 2, z.len / 2 + z.w / 2);
    for (let i = 0; i < q.length || w.foeTail(q); i++) {
      const e = q[i];
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || U.segDist2(e.x, e.y, z.x, z.y, x1, y1) >= (z.w / 2 + e.r) ** 2) continue;
      w.hitEnemy(e, base, { p: o, kind: 'dot', noProc: true, crit: false, clsEl: o.stats.element, part: 'wake' });
      if (e.hp > 0) w.addRadiance(e, base * WAKE_RAD, o);
    }
    w.foeEnd();
  }

  // Returning Light: a wave that ends by range or wall (a returning wave never does) sends a return wave from its end (a wall: one step back) at waveReturn of its damage, aimed at the hero; homeWaves keeps it on the hero.
  // The return wave is an ordinary wave (own hit set, steers like the outward one around its heading); a wave that ends within reach of the hero does not return.
  function returnWave(w, pr, o, why) {
    const x = why === 'wall' ? pr.x - pr.vx * STEP : pr.x, y = why === 'wall' ? pr.y - pr.vy * STEP : pr.y, dx = o.x - x, dy = o.y - y;
    if (Math.hypot(dx, dy) < o.r + 30) return;
    const a = Math.atan2(dy, dx), rw = w.spawnProj({ team: 0, kind: 'wave', x, y, a, speed: Math.hypot(pr.vx, pr.vy) || 1, r: pr.r, dmg: pr.dmg * o.stats.waveReturn, life: RET_LIFE, pierce: 99, owner: pr.owner, knock: pr.knock, wpn: true, part: 'wave', infAdd: pr.infAdd, homing: pr.homing, homeA0: a, homeCone: pr.homeCone });
    rw.ret = true;
    w.emit({ t: 'wret', x: rnd(x), y: rnd(y), a: Math.round(a * 100) / 100, pid: o.pid });
  }
  function homeWaves(w, p) {
    for (const pr of w.projs) {
      if (!pr.ret || pr.owner !== p.pid || pr.life <= 0) continue;
      const dx = p.x - pr.x, dy = p.y - pr.y, d = Math.hypot(dx, dy);
      if (d < p.r + 8) { pr.life = 0; continue; }
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      pr.vx = dx / d * sp; pr.vy = dy / d * sp; pr.homeA0 = Math.atan2(dy, dx);
    }
  }

  // Spectrum: the Prism beam of a Smite (en.amt = the Smite x smiteBeam) strikes the nearest prismN other foes within PRISM_R once each (en.hit holds the foes this chain has struck) and the Sunburst jump follows the nearest.
  // Each foe struck, a horde foe excepted, stores prismRad of the Smite as Radiance, kept just below its Smite gauge (a beam never Smites).
  function spectrum(w, o, en, hit) {
    const st = o.stats, store = en.amt / (st.smiteBeam || 1) * st.prismRad, q = w.foeScan(en.x, en.y, PRISM_R), near = [];
    for (let k = 0; k < q.length; k++) {
      const f = q[k], d2 = U.dist2(f.x, f.y, en.x, en.y);
      if (live(f) && f.invulnT <= 0 && !hit.has(f.id) && d2 <= PRISM_R * PRISM_R) near.push({ f, d2 });
    }
    w.foeEnd();
    near.sort((a, b) => a.d2 - b.d2);
    const n = Math.min(Math.round(st.prismN), near.length);
    for (let i = 0; i < n; i++) {
      const f = near[i].f;
      hit.add(f.id);
      w.emit({ t: 'chain', k: 'p', i, pts: [[rnd(en.x), rnd(en.y)], [rnd(f.x), rnd(f.y)]] });
      w.hitEnemy(f, en.amt, { p: o, kind: 'beam', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', x: en.x, y: en.y });
      const cap = w.smiteAt(f) * 0.99;
      if (f.hp > 0 && !f.fodder && f.rad < cap) { f.rad = Math.min(cap, f.rad + store); f.radOwner = o; }
    }
    if (en.jumps > 0 && n) w.queuePayoff(o, { kind: 'beam', e: near[0].f, x: near[0].f.x, y: near[0].f.y, amt: en.amt * 0.5, jumps: en.jumps - 1, hit, jump: true });
  }

  const SMITER_N = 25;
  ED.CLS.cleric = {
    init(p) { p.hammers = []; p.echoQ = new Map(); p.smB = 0; p.smN = 0; }, // smB / smN: the boss this Cleric last Smote and its Smite count (Smiter)
    // Smiter (secret): SMITER_N Smites by this Cleric on one boss (combat.js smite calls it for a boss; a boss id lives one fight).
    smote(e, o) {
      if (o.smB !== e.id) { o.smB = e.id; o.smN = 0; }
      if (++o.smN >= SMITER_N) this.secretP(o, 'heroSecret');
    },
    tick(p, dt) {
      if (p.hammers.length) this.updateHammers(p, dt);
      if (p.echoQ.size) flushEcho(this, p);
      if (p.stats.waveReturn > 0) homeWaves(this, p);
    },
    // Sunstrike (called by combat.js smite for a hero with the card): counts the Smites on a foe, a horde foe never; every SUN_EVERY-th is a Sunstrike (smite scales its damage and shield). Returns whether this one is.
    sunstrike(e, o) {
      if (e.fodder) return false;
      e.sunN = (e.sunN | 0) + 1;
      if (e.sunN % SUN_EVERY) return false;
      this.emit({ t: 'sunstrike', x: rnd(e.x), y: rnd(e.y), pid: o.pid });
      return true;
    },
    // Final Judgment: damage a Judged foe takes from the Cleric (statuses and zone ticks excepted) echoes to the other Judged foes within ECHO_R
    hitDone(p, e, dmg, crit, src) {
      const st = p.stats;
      if (!(st.fjEcho > 0) || !(e.judged > 0) || src.echo || src.kind === 'dot' || !(dmg > 0)) return;
      const lost = e.hp > 0 ? dmg : dmg + e.hp; // a killing blow echoes what the foe had left, not the overkill
      if (!(lost > 0)) return;
      for (const f of judgedFoes(this)) {
        if (f === e || f.hp <= 0 || U.dist2(f.x, f.y, e.x, e.y) > ECHO_R * ECHO_R) continue;
        const o = p.echoQ.get(f);
        if (o) { o.a += lost * st.fjEcho; o.x = e.x; o.y = e.y; } else p.echoQ.set(f, { a: lost * st.fjEcho, x: e.x, y: e.y });
      }
    },
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
      if (st.litany && !pr.fanSide && p.atkCount % st.litany === 0) { // the side waves of a fan (Judge's Gavel) send no Litany waves
        for (const d of [-FAN, FAN]) this.spawnProj({ team: 0, kind: 'wave', x: pr.x, y: pr.y, a: a + d, speed: Math.hypot(pr.vx, pr.vy), r: pr.r, dmg: pr.dmg, life: pr.life, pierce: pr.pierce, owner: pr.owner, knock: pr.knock, wpn: true, part: 'wave', stun: pr.stun, infAdd: pr.infAdd, homing: pr.homing, homeA0: a + d, homeCone: pr.homeCone });
      }
      if (st.wake > 0) wake(this, p, pr, a);
    },
    // A wave that ends (range or wall): Solar Flare bursts for waveBurst of its damage, Returning Light sends it back to the hero
    projEnd(pr, owner, why) {
      const st = owner.stats;
      if (pr.kind !== 'wave') return;
      if (st.waveReturn > 0 && !pr.ret && !owner.downed && !owner.dead) returnWave(this, pr, owner, why);
      if (!st.waveBurst) return;
      const r = FLARE_R, dmg = pr.dmg * st.waveBurst;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0) continue;
        const d = Math.hypot(e.x - pr.x, e.y - pr.y);
        if (d >= r + e.r) continue;
        this.hitEnemy(e, dmg, { p: owner, kind: 'explode', wpn: true, part: 'solar', knock: 90, kx: (e.x - pr.x) / (d || 1), ky: (e.y - pr.y) / (d || 1), noGuard: true, crit: false, infAdd: pr.infAdd, x: pr.x, y: pr.y });
      }
      this.emit({ t: 'solar', x: rnd(pr.x), y: rnd(pr.y), r: rnd(r), pid: owner.pid });
    },
    // A Judged foe that dies: Verdict bursts it (queued, the Verdict owner deals it), and the allies within 160 of a death inside the hammer's own Judged window get a shield once per cast (3% of max HP, class window)
    kill(e) {
      if (!(e.judged > 0)) return;
      const vo = verdictOwner(this, e);
      if (vo) this.queuePayoff(vo, { kind: 'verdict', e, x: e.x, y: e.y });
      if (!(e.judgeUntil > this.time) || e.fodder) return; // shields ignore fodder
      const o = this.players.get(e.judgeOwner);
      if (!o || o.cls !== 'cleric') return;
      for (const q of this.players.values()) {
        if (q.downed || q.dead || U.dist2(q.x, q.y, e.x, e.y) > 160 * 160 || q.judgeGot[o.pid] === e.judgeCast) continue;
        q.judgeGot[o.pid] = e.judgeCast;
        this.addShield(q, q.maxHp * 0.03, q.maxHp * C.CLASS_SHIELD_CAP, 'class');
      }
    },
    // Chain payoffs (combat.js runPayoff): Verdict (r70 Holy burst at the dead foe, stun; Sentence Judges the foes it leaves standing) and Prism's beam (half the Smite to the nearest other foe within 120; Sunburst jumps once more at half again; Spectrum splits it).
    payoff(en) {
      const o = en.tr, st = o.stats;
      if (en.kind === 'verdict') {
        const N = ED.Stats.skillNums('judgment', st), v = N.p.verdict;
        if (!v.on) return;
        this.skillBlast(o, en.x, en.y, v.r, v.dmg, this.partSrc(o, N, 'verdict', { knock: 90, infAdd: { holy: 0.5 } }), (f) => { if (f.hp > 0) { this.stunFoe(f, v.stun, true); if (st.verdictJudge) judgeFoe(f, o, 4 + st.judgeDur, false, this); } }); // Sentence: the foes the burst leaves standing are Judged
        this.emit({ t: 'verdict', x: rnd(en.x), y: rnd(en.y), r: rnd(v.r), pid: o.pid });
        return;
      }
      const hit = en.hit || (en.hit = new Set([en.e.id]));
      if (st.prismN > 0 && !en.jump) { spectrum(this, o, en, hit); return; }
      let best = null, bd = BEAM_R * BEAM_R;
      for (const f of this.enemies) {
        if (!live(f) || f.invulnT > 0 || hit.has(f.id)) continue;
        const d2 = U.dist2(f.x, f.y, en.x, en.y);
        if (d2 <= bd) { bd = d2; best = f; }
      }
      if (!best) return;
      hit.add(best.id);
      const ev = { t: 'chain', k: 'b', pts: [[rnd(en.x), rnd(en.y)], [rnd(best.x), rnd(best.y)]] };
      if (en.jump) ev.j = 1; // a Sunburst jump
      this.emit(ev);
      this.hitEnemy(best, en.amt, { p: o, kind: 'beam', raw: true, noProc: true, crit: false, noGuard: true, el: 'holy', x: en.x, y: en.y });
      if (en.jumps > 0) this.queuePayoff(o, { kind: 'beam', e: best, x: best.x, y: best.y, amt: en.amt * 0.5, jumps: en.jumps - 1, hit, jump: true });
    },
  };

  // Hit options of Radiant Faith, cached on the stat block: { infAdd: { holy: rate } } or null
  function holyAdd(st) {
    if (st.holyAdd === undefined) { const r = Math.max(0, st.wInfHoly - st.holyInfuse); st.holyAdd = r > 0 ? { infAdd: { holy: r } } : null; }
    return st.holyAdd;
  }
})(globalThis.ED || (globalThis.ED = {}));
