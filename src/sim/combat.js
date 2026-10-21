// Combat rules: spawning, damage, statuses, deaths, hero attacks, projectiles and area zones.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, D = ED.Dungeon;
  const W = ED.World.prototype;

  ED.CONST.SUSTAIN_CAP = 0.003; // max HP fraction a hero regains per second from on-hit and on-kill combat heals (read by the UI)
  ED.CONST.GLOOM_CAP = 0.25; // max HP fraction one Gloom touch may take
  ED.CONST.ARC_MUL = 0.6; // a discharge's arc targets take this fraction of what the charged foe takes
  ED.CONST.BOLT_CD = 0.6; // seconds between one hero's Thunderhead bolts
  ED.CONST.SPLASH_MUL = 0.6; // foes next to a combusting foe take this fraction of the pool
  const EL_IDX = { pyre: 1, rime: 2, storm: 3 };
  const NO_GUARD = { dot: 1, chain: 1, explode: 1 }; // hit kinds that ignore a foe's frontal guard
  const FULL_CONTACT = new Set(['lunge', 'charge', 'leap', 'bash', 'dive']); // attack states whose body contact deals full damage
  const NO_STATS = {};
  const hpFrac = (e, dmg) => dmg / (e.maxHp / e.hpLever); // damage as a fraction of the foe's HP before the stratum lever (bosses: refHp): the unit of HP-relative build-up
  const WINDUP = { tele: 1, teleLine: 1, teleCone: 1 }; // zone kinds that telegraph their caster's attack
  const evoOf = (p) => p.stats.evo || null;

  // ---------------- enemies ----------------
  W.spawnEnemy = function (type, x, y, opts) {
    opts = opts || {};
    const def = ED.ENEMIES[type];
    const s = this.stratum, pact = this.pact;
    let hp = def.hp, dmg = def.dmg;
    if (!def.boss) hp *= ED.World.hpScale(s);
    hp *= this.partyHpMul();
    if (pact >= 1) hp *= 1.25;
    if (def.boss && pact >= 5) hp *= 1.35;
    if (pact >= 10) hp *= 1.2;
    dmg *= (1 + 0.22 * (s - 1) + 0.03 * (s - 1) * (s - 1)) * (pact >= 2 ? 1.25 : 1) * (pact >= 8 ? 1.2 : 1) * this.threat().dmg;
    const dr = this.dread;
    if (dr && !def.minion && !def.gloom && !def.ally && !opts.ally) {
      const deep = 1 + ED.World.DEEP * Math.min(ED.World.DEEP_MAX, this.deepRooms); // the Deep hits harder with every room entered Dark or Lightless this stratum
      hp *= dr.hp; dmg *= dr.dmg * deep;
    }
    const e = {
      id: U.uid(), type, def, x, y, r: def.r, hp, maxHp: hp, dmg, spd: def.spd * (pact >= 6 ? 1.15 : 1),
      kbx: 0, kby: 0, st: 'move', t: 0, cd: this.rng.range(0.6, 1.6), face: 1, flash: 0, stun: 0, frozen: 0, elite: null, ward: 0, wardMax: 0,
      boss: !!def.boss, fly: !!def.fly, target: null, tgtT: 0, aimA: 0, guardA: 0, contactCd: 0, spawnT: opts.spawnT || 0,
      phase: 1, vars: {}, strafe: this.rng.sign(), wob: this.rng.range(0, 6.28), exposed: false, recoil: 0,
      // statuses: burn/bleed pools, chill, charge, hero debuffs (judged = Cleric Judgment, vulnT = Rain/Smoke vulnerability); slow/windMul/dmgTakenMul are read by ai.js and hitEnemy
      burn: 0, burnPool: 0, burnTick: 0, burnOwner: null, bleedPool: 0, bleedTick: 0, bleedOwner: null,
      chill: 0, chillT: 0, chillOwner: null, freezeRes: 0, freezeResT: 0, charge: 0, chargeOwner: null, dischargeT: 0,
      hpLever: def.boss ? def.hp / def.refHp : this.threat().hp, // HP-relative statuses (chill, Conflagration, Wildfire) ignore this stratum lever
      mark: 0, judged: 0, vulnT: 0, blind: 0, sunder: 0, sunderOwner: null, slow: 1, slowAmt: 0, slowT: 0, windMul: 1, dmgTakenMul: 1, invulnT: 0, killed: false,
    };
    if (opts.elite) this.makeElite(e, opts.affix);
    this.enemies.push(e);
    return e;
  };

  W.makeElite = function (e, affix) {
    e.elite = affix || this.rng.pick(ED.AFFIX_IDS);
    e.hp *= ED.World.ELITE.hp + ED.World.ELITE.hpStep * (this.stratum - 1); e.maxHp = e.hp; e.dmg *= ED.World.ELITE.dmg; e.r = Math.round(e.r * 1.22); // elite HP x2.8 at stratum I up to x5.3 at VI
    if (e.elite === 'swift') e.spd *= 1.4;
    if (e.elite === 'brutal') e.dmg *= 1.4;
    if (e.elite === 'warded') { e.ward = e.maxHp * 0.45; e.wardMax = e.ward; }
  };

  // Stratum affinity: weak x1.5, resist x0.5, else x1 (el = 'pyre' | 'rime' | 'storm').
  W.elemAff = function (el) {
    const b = ED.biomeFor(this.stratum);
    return b.weak === el ? 1.5 : b.resist === el ? 0.5 : 1;
  };

  // Slows a foe by amount (0..1) for dur seconds; the strongest slow and the longest duration win.
  W.slowEnemy = function (e, amount, dur) {
    if (!e || e.hp <= 0) return;
    e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, amount);
    e.slowT = Math.max(e.slowT, dur);
  };

  // ---------------- damage to foes (order: hero mul, crit, vulnerability, affinity, exposed, guard, dmgTakenMul, ward) ----------------
  // src: { p, kind, crit, mul, el, affDone, raw, noProc, noGuard, noShatter, comp, ambush, knock, kx, ky, x, y }. Writes back src.critOut / src.guarded.
  W.hitEnemy = function (e, base, src) {
    if (!e || e.hp <= 0) return 0;
    src = src || {};
    const def = e.def;
    if (def.invuln || e.burrowed || e.invulnT > 0) return 0;
    const p = src.p || null, st = p ? p.stats : null, kind = src.kind || 'weapon';
    const comp = !!src.comp || kind === 'orbit' || kind === 'wisp' || kind === 'minion';
    let dmg = base, crit = false, shatter = false, guarded = false;
    if (p && !src.raw) {
      crit = src.crit === undefined ? this.rng.chance(st.crit) : !!src.crit;
      let mul = st.dmg;
      if (st.execute && e.hp < e.maxHp * 0.3) mul += st.execute;
      if (st.searing && e.burnPool > 0) mul += st.searing;
      if (st.lacerate && e.bleedPool > 0) mul += st.lacerate;
      if (st.berserk && p.hp < p.maxHp * 0.5) mul += st.berserk;
      if (st.hemomancy && kind === 'skill') mul += st.hemomancy;
      if (st.idol) mul += Math.min(0.2, Math.floor(this.gold / 15) * 0.01);
      if (st.banner) {
        let near = 0;
        for (const q of this.players.values()) if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 200 * 200) near++;
        mul += st.banner * (1 + near);
      }
      dmg *= Math.max(0.1, mul);
      if (crit) dmg *= st.critMult + (st.serrated && e.frozen > 0 ? 0.5 : 0);
    }
    if (src.mul) dmg *= src.mul;
    if (p && !src.noProc && st.shatter && e.frozen > 0 && !src.noShatter) { dmg *= 1 + st.shatter; shatter = true; }
    let vuln = 1;
    if (e.mark > 0) vuln += 0.25;
    if (e.judged > 0 || e.vulnT > 0) vuln += 0.2; // Judgment and skill-granted vulnerability share one +20%
    if (e.frozen > 0) vuln += 0.25;
    if (e.sunder && p && e.sunderOwner === p.pid) vuln += 0.04 * e.sunder;
    dmg *= vuln;
    if (src.el && !src.affDone) dmg *= this.elemAff(src.el);
    if (e.exposed) dmg *= 1.5;
    if (def.guard && !NO_GUARD[kind] && !src.noGuard) {
      const ox = src.x !== undefined ? src.x : p ? p.x : undefined, oy = src.y !== undefined ? src.y : p ? p.y : undefined;
      if (ox !== undefined && Math.abs(U.angDiff(e.guardA || 0, Math.atan2(oy - e.y, ox - e.x))) <= def.guard.arc / 2) {
        dmg *= def.guard.mul; guarded = true;
        this.emit({ t: 'guardhit', x: Math.round(e.x), y: Math.round(e.y) });
      }
    }
    dmg *= e.dmgTakenMul ?? 1;
    if (e.ward > 0) { const ab = Math.min(e.ward, dmg * 0.75); e.ward -= ab; dmg -= ab; if (e.ward <= 0) this.emit({ t: 'wardbreak', x: e.x, y: e.y }); }
    src.critOut = crit; src.guarded = guarded;
    if (dmg <= 0) return 0;
    e.hp -= dmg; e.flash = 0.1;
    if (src.knock && !e.boss) {
      const kb = src.knock * (e.elite ? 0.45 : 1) * (e.def.ai === 'tank' ? 0.35 : 1);
      e.kbx += (src.kx || 0) * kb; e.kby += (src.ky || 0) * kb;
    }
    if (kind !== 'dot' || dmg >= 3) this.emit({ t: 'hit', x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(dmg), c: crit ? 1 : 0, k: kind === 'dot' ? 1 : 0, pid: p ? p.pid : '', el: src.bleed ? 4 : EL_IDX[src.el] || 0 });
    if (p) {
      p.dealt += dmg;
      if (shatter) this.shatterBurst(e, p, dmg);
      if (!src.noProc) this.heroProcs(e, p, dmg, crit, comp, src);
      if (comp && st.soulfire) this.addBurn(e, dmg * 0.6, p);
    }
    if (e.hp <= 0) this.killEnemy(e, p, src);
    return dmg;
  };

  // On-hit effects of a direct hero hit: leech, infusions, crit effects, heals.
  W.heroProcs = function (e, p, dmg, crit, comp, src) {
    const st = p.stats;
    if (st.leech && !comp) this.sustainHeal(p, dmg * st.leech);
    if (st.bleedHit && !comp) this.addBleed(e, dmg * st.bleedHit, p);
    if (!comp || st.compInfuse) this.applyInfusions(e, dmg, p);
    if (src.burn) this.addBurn(e, dmg * src.burn, p);
    if (crit) {
      if (st.bleed) this.addBleed(e, dmg * st.bleed, p);
      if (st.sunder) { if (e.sunderOwner !== p.pid) { e.sunderOwner = p.pid; e.sunder = 0; } e.sunder = Math.min(10, e.sunder + Math.min(2, hpFrac(e, dmg) * 60)); } // stacks from crit damage: 60 per foe HP, <= 2 per crit
      if (st.critCharge) this.addCharge(e, dmg * st.critCharge, p);
      if (st.serrated && e.chill > 0) this.addChill(e, Math.min(70, hpFrac(e, dmg) * 2000), p); // chill from crit damage: 2000 per foe HP, <= 70 per crit
      if (st.mark) e.mark = 4;
      if (st.staticEdge && e.charge > 0) this.discharge(e, e.chargeOwner || p, 1.5);
    }
    if (st.blessed) {
      let low = null;
      for (const q of this.players.values()) if (!q.downed && !q.dead && q.hp < q.maxHp && (!low || q.hp / q.maxHp < low.hp / low.maxHp)) low = q;
      if (low) this.sustainHeal(low, st.blessed);
    }
  };

  // Path infusions: each owned element builds status from the hit's final damage.
  W.applyInfusions = function (e, dmg, p) {
    const st = p.stats;
    if (st.pyreInfuse) this.addBurn(e, dmg * st.pyreInfuse, p);
    if (st.rimeInfuse) this.addChill(e, hpFrac(e, dmg) * 340 * st.rimeInfuse, p);
    if (st.stormInfuse) this.addCharge(e, dmg * st.stormInfuse, p);
  };

  // Combat sustain (leech, hemorrhage, steal, kill heals, Blessed Strikes, Soul Siphon, Judgment): heals the receiver p through one shared
  // sliding 1 s window (10 slots of 0.1 s) capped at SUSTAIN_CAP x its max HP; p.susT is the newest slot id. Returns the HP restored.
  W.sustainHeal = function (p, amt) {
    const win = p.susWin || (p.susWin = new Array(10).fill(0));
    const id = Math.floor(this.time * 10);
    if (p.susT === undefined) p.susT = id;
    for (let i = 1, gap = Math.min(10, id - p.susT); i <= gap; i++) win[(p.susT + i) % 10] = 0;
    p.susT = id;
    let used = 0;
    for (let i = 0; i < 10; i++) used += win[i];
    const a = Math.min(amt, p.maxHp * ED.CONST.SUSTAIN_CAP - used);
    if (!(a > 0)) return 0;
    win[id % 10] += a;
    return this.healPlayer(p, a, true);
  };

  // Bleed pool: physical, no affinity; drains like Burn (tickStatuses).
  W.addBleed = function (e, amount, p) {
    if (!(amount > 0) || e.killed || e.def.invuln || e.burrowed) return;
    if (e.bleedPool <= 0) e.bleedTick = 0.5;
    e.bleedPool += amount; e.bleedOwner = p;
  };

  // Burn pool: aff-scaled; ticks in tickStatuses. Conflagration checks after every addition.
  W.addBurn = function (e, amount, p) {
    if (!(amount > 0) || e.killed || e.def.invuln || e.burrowed) return;
    if (e.burnPool <= 0) e.burnTick = 0.5;
    e.burnPool += amount * this.elemAff('pyre');
    e.burn = 1;
    if (p) e.burnOwner = p;
    if (p && p.stats.conflag) this.checkCombust(e, p);
  };

  // A pool above 30% of current HP combusts: the whole pool hits the foe and, at SPLASH_MUL, every foe within 70.
  W.checkCombust = function (e, p) {
    const pool = e.burnPool;
    if (e.hp <= 0 || pool < 5 || pool <= e.hp / e.hpLever * 0.3) return;
    e.burnPool = 0; e.burn = 0;
    const dmg = pool * (1 + p.stats.burnMul), r = 70;
    this.emit({ t: 'combust', x: Math.round(e.x), y: Math.round(e.y), r });
    for (let i = 0, n = this.enemies.length; i < n; i++) {
      const o = this.enemies[i];
      if (o.hp <= 0 || o.spawnT > 0 || o.def.invuln || (o !== e && U.dist2(o.x, o.y, e.x, e.y) > (r + o.r) ** 2)) continue;
      this.hitEnemy(o, o === e ? dmg : dmg * ED.CONST.SPLASH_MUL, { p, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true, el: 'pyre', affDone: true });
    }
  };

  // Chill build-up (aff, chillMul, boss/elite resistance); reaching the threshold freezes. Frozen foes gain none.
  W.addChill = function (e, amount, p) {
    if (!(amount > 0) || e.hp <= 0 || e.frozen > 0 || e.def.invuln || e.burrowed) return;
    e.chill += amount * (1 + (p ? p.stats.chillMul : 0)) * this.elemAff('rime') * (e.boss ? 0.35 : e.elite ? 0.7 : 1);
    e.chillT = 1.5;
    if (p) e.chillOwner = p;
    if (e.chill >= 100 * (1 + 0.5 * e.freezeRes)) this.freezeEnemy(e, p);
  };

  W.freezeEnemy = function (e, p) {
    const st = p ? p.stats : NO_STATS;
    e.frozen = e.boss ? 0.6 : 1.6 * (1 + (st.freezeDur || 0)) * (e.elite ? 0.75 : 1);
    e.chill = 0; e.chillT = 0;
    if (e.freezeRes <= 0) e.freezeResT = 6;
    e.freezeRes++;
    this.emit({ t: 'freeze', x: Math.round(e.x), y: Math.round(e.y) });
    if (st.thermal && e.burnPool > 0) {
      const o = e.burnOwner || p, dmg = e.burnPool * 2 * (1 + o.stats.burnMul);
      e.burnPool = 0; e.burn = 0;
      this.hitEnemy(e, dmg, { p: o, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true, el: 'pyre', affDone: true });
    }
    if (st.frostNova) {
      for (let i = 0, n = this.enemies.length; i < n; i++) {
        const o = this.enemies[i];
        if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, e.x, e.y) < (100 + o.r) ** 2) this.addChill(o, 60, p);
      }
      this.emit({ t: 'nova', x: e.x, y: e.y, r: 100, c: '#7fe3ff' });
    }
  };

  // Shatter: the hit ends the freeze; 50% of its damage bursts to foes within 60 (infused, never shatters again).
  W.shatterBurst = function (e, p, dmg) {
    e.frozen = 0;
    const r = 60;
    this.emit({ t: 'shatter', x: Math.round(e.x), y: Math.round(e.y), r });
    for (let i = 0, n = this.enemies.length; i < n; i++) {
      const o = this.enemies[i];
      if (o === e || o.hp <= 0 || o.spawnT > 0 || U.dist2(o.x, o.y, e.x, e.y) > (r + o.r) ** 2) continue;
      this.hitEnemy(o, dmg * 0.5, { p, kind: 'explode', raw: true, crit: false, noShatter: true, noGuard: true, el: 'rime', x: e.x, y: e.y });
    }
  };

  // Charge build-up; the first charge arms the discharge timer (1 s, 0.5 s for a Tempest hero).
  W.addCharge = function (e, amount, p) {
    if (!(amount > 0) || e.hp <= 0 || e.def.invuln || e.burrowed) return;
    const iv = p && evoOf(p) === 'storm' ? 0.5 : 1;
    e.dischargeT = e.charge > 0 ? Math.min(e.dischargeT, iv) : iv;
    e.charge += amount * this.elemAff('storm');
    if (p) e.chargeOwner = p;
  };

  // Releases e's charge onto itself and its nearest foes. Emits chain pts as a star (hub, target, hub, target ...).
  W.discharge = function (e, p, mul) {
    const ch = e.charge;
    if (!(ch > 0)) return;
    e.charge = 0; e.dischargeT = 0;
    const st = p ? p.stats : NO_STATS;
    const dmg = ch * (1 + (st.shockMul || 0)) * (mul || 1);
    const range = 140 * (1 + (st.arcRange || 0));
    const near = [];
    for (const o of this.enemies) {
      if (o === e || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed) continue;
      const d2 = U.dist2(o.x, o.y, e.x, e.y);
      if (d2 < (range + o.r) ** 2) near.push({ d2, o });
    }
    near.sort((a, b) => a.d2 - b.d2);
    const n = 3 + (st.arcs || 0) + (st.supercond && e.frozen > 0 ? 2 : 0);
    const tg = [e];
    for (let i = 0; i < n && i < near.length; i++) tg.push(near[i].o);
    const hx = Math.round(e.x), hy = Math.round(e.y), pts = [[hx, hy]];
    for (let i = 1; i < tg.length; i++) pts.push([Math.round(tg[i].x), Math.round(tg[i].y)], [hx, hy]);
    if (tg.length > 1) { pts.pop(); this.emit({ t: 'chain', pts }); } else this.emit({ t: 'chain', pts: [[hx, hy], [hx, hy - 24]] });
    for (const t of tg) {
      if (t.hp <= 0) continue;
      const got = this.hitEnemy(t, t === e ? dmg : dmg * ED.CONST.ARC_MUL, { p, kind: 'chain', raw: true, noProc: true, crit: false, el: 'storm', affDone: true, x: e.x, y: e.y });
      if (t.hp <= 0 || !p) continue;
      if (st.supercond) this.addChill(t, 25, p);
      if (st.plasma) this.addBurn(t, got * 0.4, p);
      if (st.arcStun && !t.boss) t.stun = Math.max(t.stun, st.arcStun);
    }
    if (p && st.thunderbolt && e.hp > 0 && this.time >= p.boltAt && this.rng.chance(st.thunderbolt)) {
      p.boltAt = this.time + ED.CONST.BOLT_CD;
      this.emit({ t: 'bolt', x: Math.round(e.x), y: Math.round(e.y) });
      this.explode(e.x, e.y, 60, st.weapon.dmg * 2, 0, p, 'bolt', true, { el: 'storm' });
    }
  };

  // Per-tick status upkeep: burn/bleed pools, discharge timer, chill decay, freeze resistance, slows and debuff timers.
  W.tickStatuses = function (e, dt) {
    if (e.burnPool > 0) {
      e.burnTick -= dt;
      if (e.burnTick <= 0) {
        e.burnTick += 0.5;
        const o = e.burnOwner;
        if (o && o.stats.conflag) this.checkCombust(e, o);
        if (e.burnPool > 0) {
          const d = Math.min(e.burnPool, Math.max(1, e.burnPool * 0.2));
          e.burnPool -= d;
          if (e.burnPool < 1e-3) e.burnPool = 0;
          this.hitEnemy(e, d * (1 + (o ? o.stats.burnMul : 0)), { p: o, kind: 'dot', raw: true, noProc: true, crit: false, el: 'pyre', affDone: true });
        }
      }
      e.burn = e.burnPool > 0 ? 1 : 0;
    } else e.burn = 0;
    if (e.hp <= 0) return;
    if (e.bleedPool > 0) {
      e.bleedTick -= dt;
      if (e.bleedTick <= 0) {
        e.bleedTick += 0.5;
        const o = e.bleedOwner, d = Math.min(e.bleedPool, Math.max(1, e.bleedPool * 0.2));
        e.bleedPool -= d;
        if (e.bleedPool < 1e-3) e.bleedPool = 0;
        const got = this.hitEnemy(e, d, { p: o, kind: 'dot', raw: true, noProc: true, crit: false, bleed: true });
        if (o && o.stats.hemorrhage && got > 0) this.sustainHeal(o, got * 0.1);
      }
    }
    if (e.hp <= 0) return;
    if (e.charge > 0) {
      e.dischargeT -= dt;
      if (e.dischargeT <= 0) this.discharge(e, e.chargeOwner, 1);
    }
    if (e.hp <= 0) return;
    if (e.chill > 0) {
      if (e.chillT > 0) e.chillT -= dt;
      else e.chill = Math.max(0, e.chill - 25 * dt);
    }
    if (e.freezeRes > 0) {
      e.freezeResT -= dt;
      if (e.freezeResT <= 0) { e.freezeRes--; e.freezeResT = 6; }
    }
    if (e.frozen > 0) e.frozen -= dt;
    if (e.stun > 0) e.stun -= dt;
    if (e.judged > 0) e.judged -= dt;
    if (e.vulnT > 0) e.vulnT -= dt;
    if (e.blind > 0) e.blind -= dt;
    let slow = 1 - Math.min(0.45, e.chill / 180);
    if (e.slowT > 0) { e.slowT -= dt; slow *= 1 - e.slowAmt; } else e.slowAmt = 0;
    e.slow = slow; e.windMul = 1 + e.chill / 220;
  };

  W.killEnemy = function (e, p, src) {
    if (e.killed) return;
    e.killed = true; e.hp = 0;
    src = src || {};
    const def = e.def, s = this.stratum;
    this.run.kills++;
    if (p) p.kills++;
    this.emit({ t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: e.elite ? 1 : 0, r: e.r });
    this.onEnemyKilledSkill(e, p, src);
    if (def.boss) { this.onBossKilled(e); return; }
    if (p && p.stats.wildfire && e.burnPool > 0) {
      for (let i = 0, n = this.enemies.length; i < n; i++) {
        const o = this.enemies[i];
        if (o !== e && o.hp > 0 && o.spawnT <= 0 && U.dist2(o.x, o.y, e.x, e.y) < (80 + o.r) ** 2) this.addBurn(o, e.maxHp / e.hpLever * p.stats.wildfire, p);
      }
      this.emit({ t: 'boom', x: Math.round(e.x), y: Math.round(e.y), r: 80, k: 'fire' });
    }
    const xpMul = 1 + 0.35 * (s - 1);
    this.dropXp(e.x, e.y, def.xp * xpMul * (e.elite ? 3 : 1));
    if (this.rng.chance(e.elite ? 1 : 0.12)) this.dropGold(e.x, e.y, (1 + Math.floor((s - 1) / 2)) * (e.elite ? 3 : this.rng.int(1, 2)));
    let heartCh = e.elite ? 0.4 : 0.04;
    for (const q of this.players.values()) heartCh += (q.stats.hearts || 0) * 0.05;
    if (this.rng.chance(heartCh)) this.spawnPickup('heart', e.x, e.y, 1);
    if (e.elite) {
      this.run.elitesKilled++; this.run.embers.elites += 2 + Math.floor(s / 2);
      if (e.elite === 'volatile') this.addZone({ kind: 'tele', x: e.x, y: e.y, r: 70, dur: 0.7, team: 1, dmg: e.dmg * 1.2, boom: 'fire' });
    }
    if (def.split) for (let i = 0; i < def.split.n; i++) {
      const c = this.spawnEnemy(def.split.into, e.x + this.rng.range(-8, 8), e.y + this.rng.range(-8, 8));
      c.kbx = this.rng.range(-160, 160); c.kby = this.rng.range(-160, 160); c.cd = 0.6;
    }
    if (def.deathCloud) this.addZone({ kind: 'poison', x: e.x, y: e.y, r: def.deathCloud.r, dur: def.deathCloud.dur, dps: def.deathCloud.dps * (1 + 0.2 * (s - 1)), team: 1 });
    if (p && src.kind !== 'minionBurst') {
      const st = p.stats, k = evoOf(p) === 'blood' ? 2 : 1;
      const comp = !!src.comp || src.kind === 'orbit' || src.kind === 'wisp' || src.kind === 'minion';
      if (st.killHeal) this.sustainHeal(p, st.killHeal * k);
      if (st.killHealPct) this.sustainHeal(p, p.maxHp * st.killHealPct * k);
      if (st.bloodOrb && this.rng.chance(st.bloodOrb)) this.spawnPickup('orb', e.x, e.y, 0.03);
      if (comp && st.feast) this.sustainHeal(p, p.maxHp * 0.01);
      if (st.chalice && p.chaliceHp < 20) {
        p.chaliceKills++;
        if (p.chaliceKills % 4 === 0) { p.chaliceHp++; this.recalc(p, false); if (p.chaliceHp % 5 === 0) this.sendBuild(p); }
      }
      if (p.cls === 'necro') {
        const ch = 0.12 + (st.weapon.raise || 0);
        if (this.rng.chance(ch)) this.spawnMinion(p, e.x, e.y, 10);
      }
    }
  };

  // Called every tick from updatePlayerBuild for a living, standing hero: spectral twin queue and dash effects.
  W.updatePlayerCombat = function (p, dt) {
    const st = p.stats, q = p.twinQ;
    if (q && q.length) {
      for (let i = 0; i < q.length;) {
        q[i].t -= dt;
        if (q[i].t <= 0) { const a = q[i].a; q.splice(i, 1); this.playerAttack(p, a, 0.5); } else i++;
      }
    }
    // dash effects (host sees remote dashes through their state reports)
    if (p.dashing) {
      const dm = st.dashDmg + st.dashShock;
      if (dm) {
        if (!p.dashHit) p.dashHit = new Set();
        for (const e of this.enemies) {
          if (e.hp <= 0 || p.dashHit.has(e.id)) continue;
          if (U.dist2(e.x, e.y, p.x, p.y) < (e.r + p.r + 8) ** 2) { p.dashHit.add(e.id); this.hitEnemy(e, st.weapon.dmg * dm, { p, kind: 'dash', knock: 80, kx: p.dashDx, ky: p.dashDy }); }
        }
      }
      if (st.dashFrost && !p.dashRing) {
        p.dashRing = true;
        for (const e of this.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, p.x, p.y) < (80 + e.r) ** 2) this.addChill(e, 40, p);
        this.emit({ t: 'nova', x: p.x, y: p.y, r: 80, c: '#7fe3ff' });
      }
      if (st.dashFire) {
        p.dashTrail -= dt;
        if (p.dashTrail <= 0) { p.dashTrail = 0.05; this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: 22, dur: 2.2, dps: 6 + st.weapon.dmg * 0.6, owner: p.pid, team: 0 }); }
      }
    } else { p.dashHit = null; p.dashRing = false; }
  };

  // ---------------- heroes take damage ----------------
  // src: { e (source foe), proj, pr (projectile), hazard, x, y (origin) }
  W.hurtPlayer = function (p, amount, src) {
    src = src || {};
    if (!p || p.downed || p.dead || this.state !== 'play') return false;
    if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillMove) return false;
    if (this.skillBlock(p, amount, src)) return false;
    const st = p.stats;
    if (src.proj && st.mirror && this.rng.chance(st.mirror)) { this.emit({ t: 'block', x: p.x, y: p.y, k: 'mirror' }); return false; }
    if (!src.hazard && st.dodge && this.rng.chance(st.dodge)) { this.emit({ t: 'block', x: p.x, y: p.y, k: 'dodge' }); p.invuln = 0.25; return false; }
    if (!src.hazard && st.aegis && p.aegisT <= 0) { p.aegisT = 10; p.invuln = 0.4; this.emit({ t: 'block', x: p.x, y: p.y, k: 'aegis' }); return false; }
    let dmg = amount * ED.Stats.armorMul(st.armor) * (1 + st.vuln);
    for (const z of this.zones) if (z.kind === 'sanct' && U.dist2(z.x, z.y, p.x, p.y) < z.r * z.r) { dmg *= ED.CONST.SANCT_DR; break; }
    if (p.guardT > 0) dmg *= 0.4;
    if (p.wallT > 0) dmg *= 0.6;
    const e = src.e;
    if (e && e.chill > 0 && e.chillOwner) dmg *= 1 - e.chillOwner.stats.chillWeaken;
    dmg = Math.max(1, Math.round(dmg));
    if (e && e.def.gloom) dmg = Math.min(dmg, Math.max(1, Math.round(p.maxHp * ED.CONST.GLOOM_CAP)));
    if (p.shield > 0) { const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab; }
    p.hp -= dmg; p.invuln = src.hazard ? 0.3 : 0.6; p.hurtT = 0.3;
    if (this.boss) p.hitThisBoss = true;
    if (dmg > 0) this.emit({ t: 'hurt', pid: p.pid, v: dmg, x: Math.round(p.x), y: Math.round(p.y) });
    else this.emit({ t: 'block', x: p.x, y: p.y, k: 'aegis' });
    if (e && e.hp > 0) {
      if (st.thorns) this.hitEnemy(e, st.thorns, { p, kind: 'thorns', noProc: true, crit: false });
      if (e.elite === 'vampiric') e.hp = Math.min(e.maxHp, e.hp + dmg * 3);
      if (e.def.chillHit) p.chilled = 1.5;
    }
    if (st.guardian && p.hp > 0 && p.hp < p.maxHp * 0.3 && p.guardCd <= 0) { p.guardT = 3; p.guardCd = 20; this.emit({ t: 'guard', pid: p.pid }); }
    if (st.frozenHeart && p.frozenCd <= 0) {
      p.frozenCd = 8;
      for (const en of this.enemies) if (en.hp > 0 && !en.boss && !en.def.invuln && U.dist2(en.x, en.y, p.x, p.y) < 120 * 120) en.frozen = 1.6;
      this.emit({ t: 'nova', x: p.x, y: p.y, r: 120, c: '#9fefff' });
    }
    if (p.hp <= 0) this.playerLethal(p);
    return true;
  };

  W.playerLethal = function (p) {
    const st = p.stats;
    if (st.phoenix && !p.phoenixUsed) { p.phoenixUsed = true; p.hp = Math.round(p.maxHp * 0.5); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'phoenix', x: p.x, y: p.y }); this.explode(p.x, p.y, 110, 40 + st.weapon.dmg * 2, 0, p, 'fire'); return; }
    if (st.angel && !p.angelUsed) { p.angelUsed = true; p.hp = 1; p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'angel', x: p.x, y: p.y }); return; }
    if (p.secondWind > 0) { p.secondWind--; p.hp = Math.round(p.maxHp * p.swPct); p.invuln = 2.2; this.emit({ t: 'rise', pid: p.pid, k: 'wind', x: p.x, y: p.y }); return; }
    p.hp = 0; p.downed = true; p.bleed = this.partySize() > 1 ? 18 : 0.01; p.revive = 0;
    this.emit({ t: 'down', pid: p.pid, x: p.x, y: p.y });
  };

  // Area damage. team 0 = heroes' blast (hurts foes), team 1 = hostile blast (hurts heroes). opts merges into each hit's src.
  W.explode = function (x, y, r, dmg, team, owner, look, noProc, opts) {
    if (team === 0) {
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0) continue;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < r + e.r) this.hitEnemy(e, dmg, Object.assign({ p: owner, kind: 'explode', knock: 90, kx: (e.x - x) / (d || 1), ky: (e.y - y) / (d || 1), noProc: !!noProc, crit: false, noGuard: true, x, y }, opts));
      }
    } else {
      for (const p of this.players.values()) if (Math.hypot(p.x - x, p.y - y) < r + p.r) this.hurtPlayer(p, dmg, { e: owner && owner.hp !== undefined && owner.def ? owner : null, x, y });
    }
    this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r), k: look || 'fire' });
  };

  // ---------------- hero attacks ----------------
  // twinMul > 0: a spectral-twin repeat (weapon part only, scaled by twinMul).
  W.playerAttack = function (p, a, twinMul) {
    if (!p || p.downed || p.dead) return;
    const st = p.stats, w = st.weapon, evo = evoOf(p);
    if (twinMul > 0) {
      const o = { mul: twinMul, twin: true };
      if (w.kind === 'melee') this.meleeSwing(p, a, w, undefined, 0, o); else this.fireWeapon(p, a, w, undefined, o);
      return;
    }
    p.face = a; p.atkCount++; p.stealthT = 0;
    let crit, amb = null;
    if (p.critStacks > 0) { p.critStacks--; crit = true; }
    if (p.ambush) {
      p.ambush = false; crit = true; amb = { mul: 2.5, ambush: true };
      this.emit({ t: 'ambush', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
    }
    const reps = st.twinEvery && p.atkCount % st.twinEvery === 0 ? 2 : 1;
    for (let rep = 0; rep < reps; rep++) {
      const o = rep === 0 ? amb : null;
      if (w.kind === 'melee') this.meleeSwing(p, a + rep * 0.18, w, crit, rep, o);
      else this.fireWeapon(p, a + rep * 0.06, w, crit, o);
    }
    if (w.wave && p.atkCount % w.wave.every === 0) {
      this.spawnProj({ team: 0, kind: 'wave', x: p.x, y: p.y, a, speed: 320, r: 16 * (1 + st.area * 0.5), dmg: w.dmg * w.wave.mul, life: 0.55, pierce: 99, owner: p.pid, knock: 120 });
    }
    if (st.gauntlet && p.atkCount % 6 === 0) {
      const tgt = this.nearestEnemy(p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, 220);
      if (tgt) { this.emit({ t: 'bolt', x: Math.round(tgt.x), y: Math.round(tgt.y) }); this.explode(tgt.x, tgt.y, 40, w.dmg * 2.2, 0, p, 'bolt'); }
    }
    if (evo === 'spirit') (p.twinQ || (p.twinQ = [])).push({ t: 0.15, a });
    else if (evo) this.evoAttack(p, a, w, evo);
    this.emit({ t: 'atk', pid: p.pid, a: Math.round(a * 100) / 100, n: p.atkCount });
  };

  // Evolution strikes launched with an attack. They count as hero hits (infuse) and never trigger further evolution extras.
  W.evoAttack = function (p, a, w, evo) {
    const st = p.stats, melee = w.kind === 'melee', area = 1 + st.area * 0.5;
    const shot = (kind, ang, mul, speed, life, pierce, r, extra) => this.spawnProj(Object.assign({
      team: 0, kind, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed, r, dmg: w.dmg * mul, life, pierce, owner: p.pid, hk: 'evo', knock: 60,
    }, extra));
    if (evo === 'pyre') {
      if (melee) shot('crescent', a, 0.6, 360, 0.45, 99, 16 * area, { knock: 90 });
    } else if (evo === 'rime') {
      if (p.atkCount % 3 === 0) {
        const life = (melee ? 220 : 360) / 420;
        for (let i = 0; i < 5; i++) shot('iceshard', a + (i - 2) * 0.225, 0.5, 420, life, 1, 5);
      }
    } else if (evo === 'storm') {
      if (p.atkCount % 4 === 0) {
        const tgt = this.nearestEnemy(p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, 220);
        if (tgt) { this.emit({ t: 'bolt', x: Math.round(tgt.x), y: Math.round(tgt.y) }); this.explode(tgt.x, tgt.y, 50 * area, w.dmg * 1.5, 0, p, 'bolt', false, { kind: 'evo', el: 'storm' }); }
      }
    } else if (evo === 'blood') shot('bloodscythe', a, 0.5, 360, melee ? 0.35 : 0.7, 1, 7, { steal: 0.15 });
  };

  // o: { mul (extra damage multiplier), ambush, spectral, twin }
  W.meleeSwing = function (p, a, w, crit, rep, o) {
    o = o || {};
    const st = p.stats;
    const reach = w.range * (1 + st.area * 0.5 + st.meleeReach);
    const arc = Math.min(6.3, w.arc * (1 + st.area * 0.4));
    let anyCrit = false;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d - e.r > reach) continue;
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      if (arc < 6.2 && Math.abs(U.angDiff(a, ang)) > arc / 2 + Math.atan2(e.r, Math.max(d, 1))) continue;
      const hs = { p, kind: 'weapon', crit, mul: o.mul, ambush: o.ambush, knock: w.knock, kx: Math.cos(ang), ky: Math.sin(ang) };
      this.hitEnemy(e, w.dmg, hs);
      if (hs.critOut) anyCrit = true;
    }
    if (w.shock && rep === 0) this.explode(p.x + Math.cos(a) * reach * 0.55, p.y + Math.sin(a) * reach * 0.55, w.shock.r * (1 + st.area * 0.5), w.dmg * w.shock.mul * (o.mul || 1), 0, p, 'shock', true);
    this.emit({ t: 'swing', pid: p.pid, a: Math.round(a * 100) / 100, r: Math.round(reach), arc: Math.round(arc * 100) / 100 });
    if (anyCrit && evoOf(p) === 'steel' && !o.spectral && !o.twin) this.meleeSwing(p, a, w, undefined, 1, { mul: 0.6, spectral: true });
  };

  W.fireWeapon = function (p, a, w, crit, o) {
    o = o || {};
    const st = p.stats, evo = evoOf(p), area = 1 + st.area * 0.5;
    const n = w.n + st.projN;
    const sp = n > 1 ? Math.max(w.spread || 0, 0.13) : 0;
    const pyre = evo === 'pyre' && !o.twin; // Cinder Arms: plain shots explode (r40, 50%); exploding weapons get a 30% wider blast and a burning patch
    const ex = w.explode ? { r: w.explode.r * area * (st.combust ? 1.4 : 1) * (pyre ? 1.3 : 1), mul: w.explode.mul, patch: pyre } : pyre ? { r: 40 * area, mul: 0.5 } : null;
    const spec = evo === 'steel' && !o.spectral && !o.twin;
    for (let i = 0; i < n; i++) {
      const ang = a + (i - (n - 1) / 2) * sp + (w.jitter ? this.rng.range(-w.jitter, w.jitter) : 0);
      this.spawnProj({
        team: 0, kind: w.proj, x: p.x + Math.cos(ang) * 10, y: p.y - 4 + Math.sin(ang) * 10, a: ang, speed: w.speed, r: w.r,
        dmg: w.dmg, life: w.life, pierce: w.pierce + st.pierce, owner: p.pid, crit, knock: w.knock || 40, mul: o.mul, ambush: o.ambush, spec,
        explode: ex,
        cloud: w.cloud ? { r: w.cloud.r * area, dps: w.cloud.dps, dur: w.cloud.dur } : null,
        homing: (w.homing || 0) + (st.homing || 0), healAlly: w.healAlly || 0, burn: w.burn || 0,
      });
    }
  };

  W.playerDash = function (p, dx, dy) {
    if (!p || p.downed || p.dead) return;
    p.dashDx = dx; p.dashDy = dy;
    if (p.stats.dashBomb) this.addZone({ kind: 'bomb', x: p.x, y: p.y, r: 60, dur: 0.6, team: 0, owner: p.pid, dmg: p.stats.weapon.dmg * 2 });
    this.emit({ t: 'dash', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) });
  };

  // ---------------- projectiles ----------------
  // o.hk: hit kind for hitEnemy; o.comp: companion shot; o.mul/o.ambush: extra multiplier; o.steal: heal fraction of damage dealt; o.spec: crits release a spectral copy.
  W.spawnProj = function (o) {
    const pr = {
      id: U.uid(), team: o.team, kind: o.kind, x: o.x, y: o.y, vx: Math.cos(o.a) * o.speed, vy: Math.sin(o.a) * o.speed,
      r: o.r || 5, dmg: o.dmg || 1, life: o.life || 2, pierce: o.pierce || 0, owner: o.owner, src: o.src || null,
      crit: o.crit, knock: o.knock || 0, explode: o.explode || null, cloud: o.cloud || null, homing: o.homing || 0,
      healAlly: o.healAlly || 0, burn: o.burn || 0, hit: null, healed: null, accel: o.accel || 0, turn: o.turn || 0, boom: o.boom || null,
      comp: !!o.comp, hk: o.hk || null, mul: o.mul || 0, ambush: !!o.ambush, steal: o.steal || 0, spec: !!o.spec,
    };
    this.projs.push(pr);
    return pr;
  };

  W.enemyShoot = function (e, a, speed, kind, dmgMul, r, extra) {
    const mul = this.pact >= 8 ? 1.2 : 1;
    return this.spawnProj(Object.assign({ team: 1, kind, x: e.x + Math.cos(a) * e.r * 0.6, y: e.y - 4 + Math.sin(a) * e.r * 0.6, a, speed: speed * mul, r: r || 6, dmg: e.dmg * (dmgMul || 1), life: 4, src: e }, extra || {}));
  };

  // Spectral copy of a crit projectile: continues past the foe it just hit at 60% damage.
  W.spectralShot = function (pr, e) {
    const c = this.spawnProj({ team: 0, kind: 'spectral', x: pr.x, y: pr.y, a: Math.atan2(pr.vy, pr.vx), speed: Math.hypot(pr.vx, pr.vy) || 1, r: pr.r + 1, dmg: pr.dmg, mul: 0.6, life: 0.4, pierce: 1, owner: pr.owner, hk: 'evo', knock: pr.knock });
    c.hit = new Set([e.id]);
  };

  W.updateProjectiles = function (dt) {
    const room = this.room, locked = this.locked;
    const keep = [];
    for (const pr of this.projs) {
      pr.life -= dt;
      if (pr.life <= 0) { if (pr.team === 0 && pr.explode) this.projBurst(pr); continue; }
      if (pr.homing) {
        let tgt = null;
        if (pr.team === 0) tgt = this.nearestEnemy(pr.x, pr.y, 240, pr.hit);
        else tgt = this.nearestPlayer(pr.x, pr.y);
        if (tgt) {
          const cur = Math.atan2(pr.vy, pr.vx), want = Math.atan2(tgt.y - pr.y, tgt.x - pr.x);
          const sp = Math.hypot(pr.vx, pr.vy);
          const na = cur + U.clamp(U.angDiff(cur, want), -pr.homing * dt, pr.homing * dt);
          pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
        }
      }
      if (pr.turn) { const cur = Math.atan2(pr.vy, pr.vx) + pr.turn * dt, sp = Math.hypot(pr.vx, pr.vy); pr.vx = Math.cos(cur) * sp; pr.vy = Math.sin(cur) * sp; }
      if (pr.accel) { const f = 1 + pr.accel * dt; pr.vx *= f; pr.vy *= f; }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      const t = D.tileAt(room, pr.x, pr.y);
      if (D.blocksShots(t, locked)) {
        if (pr.team === 0 && pr.explode) this.projBurst(pr);
        else if (pr.team === 0 && pr.cloud) this.addZone({ kind: 'plague', x: pr.x - pr.vx * dt, y: pr.y - pr.vy * dt, r: pr.cloud.r, dur: pr.cloud.dur, dps: pr.cloud.dps, owner: pr.owner, team: 0 });
        this.emit({ t: 'spark', x: Math.round(pr.x), y: Math.round(pr.y), k: ED.PROJ_IDX[pr.kind] || 0 });
        continue;
      }
      let dead = false;
      if (pr.team === 0) {
        const owner = this.players.get(pr.owner);
        for (const e of this.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
          if (pr.hit && pr.hit.has(e.id)) continue;
          const rr = e.r + pr.r;
          if (U.dist2(pr.x, pr.y, e.x, e.y) > rr * rr) continue;
          if (!pr.hit) pr.hit = new Set();
          pr.hit.add(e.id);
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          const hs = { p: owner, kind: pr.hk || (pr.kind === 'wisp' ? 'wisp' : 'weapon'), comp: pr.comp, crit: pr.crit, mul: pr.mul, ambush: pr.ambush, knock: pr.knock, kx: pr.vx / sp, ky: pr.vy / sp, burn: pr.burn, x: pr.x, y: pr.y };
          const got = this.hitEnemy(e, pr.dmg, hs);
          if (pr.steal && owner && got > 0) this.sustainHeal(owner, got * pr.steal);
          if (pr.spec && hs.critOut) this.spectralShot(pr, e);
          if (pr.explode) { this.projBurst(pr); dead = true; break; }
          if (pr.cloud) { this.addZone({ kind: 'plague', x: pr.x, y: pr.y, r: pr.cloud.r, dur: pr.cloud.dur, dps: pr.cloud.dps, owner: pr.owner, team: 0 }); dead = true; break; }
          if (hs.guarded || pr.pierce-- <= 0) { dead = true; break; }
        }
        if (!dead && pr.healAlly && owner) {
          for (const q of this.players.values()) {
            if (q === owner || q.downed || q.dead || q.hp >= q.maxHp) continue;
            if ((pr.healed && pr.healed.has(q.pid)) || U.dist2(pr.x, pr.y, q.x, q.y) > 20 * 20) continue;
            if (!pr.healed) pr.healed = new Set();
            pr.healed.add(q.pid); this.healPlayer(q, pr.healAlly);
          }
        }
      } else {
        for (const p of this.players.values()) {
          if (p.downed || p.dead) continue;
          const rr = p.r + pr.r - 3;
          if (U.dist2(pr.x, pr.y, p.x, p.y) > rr * rr) continue;
          if (p.invuln > 0 || p.dashing || p.dashT > 0 || p.skillMove) continue; // shots pass through i-frames
          this.hurtPlayer(p, pr.dmg, { proj: true, e: pr.src, pr, x: pr.x, y: pr.y });
          if (pr.team === 0) break; // reflected: stays alive as a hero projectile
          if (pr.boom) this.explode(pr.x, pr.y, pr.boom.r, pr.dmg * 0.5, 1, pr.src, pr.boom.k);
          dead = true; break;
        }
      }
      if (!dead) keep.push(pr);
    }
    this.projs = keep;
  };

  W.projBurst = function (pr) {
    const owner = this.players.get(pr.owner);
    if (!owner) return;
    this.explode(pr.x, pr.y, pr.explode.r, pr.dmg * (pr.mul || 1) * pr.explode.mul, 0, owner, pr.kind === 'fireball' ? 'bigfire' : 'fire', false);
    if (pr.explode.patch) this.addZone({ kind: 'pfire', x: pr.x, y: pr.y, r: pr.explode.r * 0.6, dur: 2, dps: pr.dmg * 0.4, owner: pr.owner, team: 0 }); // one burning patch per shot
  };

  // ---------------- zones: telegraphs, clouds, fire, sanctuary ----------------
  W.addZone = function (z) {
    z.id = U.uid(); z.t = 0; z.tick = 0;
    this.zones.push(z);
    return z;
  };

  W.updateZones = function (dt) {
    const keep = [];
    for (const z of this.zones) {
      const s = z.src;
      if (s && WINDUP[z.kind] && !z.detached) { // a wind-up telegraph follows its caster: stalled while it is frozen or stunned, dropped (no hit, no onEnd) when it dies
        if (s.hp <= 0) continue;
        if (s.frozen > 0 || s.stun > 0) { if (z.update) z.update(this, z, 0); keep.push(z); continue; }
      }
      z.t += dt;
      if (z.update) z.update(this, z, dt);
      const done = z.t >= z.dur;
      if (z.custom) {
        // custom zones run entirely through z.update; z.onEnd fires once when they expire
        if (done) { if (z.onEnd) z.onEnd(this, z); continue; }
      } else if (z.kind === 'spawn') {
        if (done) {
          const e = this.spawnEnemy(z.type, z.x, z.y, { elite: z.elite, affix: z.affix });
          this.emit({ t: 'spawned', x: Math.round(z.x), y: Math.round(z.y), el: z.elite ? 1 : 0 });
          if (z.after) z.after(e);
          continue;
        }
      } else if (z.kind === 'tele' || z.kind === 'teleLine' || z.kind === 'teleCone' || z.kind === 'bomb' || z.kind === 'decoy') {
        if (done) { this.resolveTele(z); continue; }
      } else if (z.kind === 'laser') {
        if (z.t > z.warm) {
          z.tick -= dt;
          if (z.tick <= 0) {
            z.tick = 0.12;
            const x1 = z.x + Math.cos(z.a) * z.len, y1 = z.y + Math.sin(z.a) * z.len;
            for (const p of this.players.values()) if (U.segDist2(p.x, p.y, z.x, z.y, x1, y1) < (z.w / 2 + p.r) ** 2) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
          }
        }
        if (done) continue;
      } else {
        // damage-over-time fields
        z.tick -= dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          if (z.team === 0) {
            const owner = this.players.get(z.owner), el = z.el || (z.kind === 'pfire' ? 'pyre' : undefined);
            for (const e of this.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(z.x, z.y, e.x, e.y) < (z.r + e.r) ** 2) this.hitEnemy(e, z.dps * 0.5, { p: owner, kind: 'dot', noProc: true, crit: false, el });
          } else if (z.dps) {
            for (const p of this.players.values()) if (U.dist2(z.x, z.y, p.x, p.y) < (z.r + p.r * 0.5) ** 2) this.hurtPlayer(p, z.dps * 0.5, { hazard: true, x: z.x, y: z.y });
          }
        }
        if (done) continue;
      }
      keep.push(z);
    }
    // zones created mid-loop were appended to this.zones and visited by the same for-of
    this.zones = keep;
  };

  W.resolveTele = function (z) {
    if (z.warnOnly) { if (z.onEnd) z.onEnd(this, z); return; }
    if (z.team === 0) {
      const owner = this.players.get(z.owner);
      if (owner) this.explode(z.x, z.y, z.r, z.dmg, 0, owner, z.boom || 'shock', true);
      return;
    }
    if (z.kind === 'tele') {
      for (const p of this.players.values()) if (Math.hypot(p.x - z.x, p.y - z.y) < z.r + p.r * 0.6) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
      this.emit({ t: 'boom', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: z.boom || 'slam' });
    } else if (z.kind === 'teleLine') {
      const x1 = z.x + Math.cos(z.a) * z.len, y1 = z.y + Math.sin(z.a) * z.len;
      for (const p of this.players.values()) if (U.segDist2(p.x, p.y, z.x, z.y, x1, y1) < (z.w / 2 + p.r * 0.6) ** 2) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
    } else if (z.kind === 'teleCone') {
      for (const p of this.players.values()) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d < z.r + p.r && Math.abs(U.angDiff(z.a, Math.atan2(p.y - z.y, p.x - z.x))) < z.arc / 2) this.hurtPlayer(p, z.dmg, { e: z.src, x: z.x, y: z.y });
      }
      this.emit({ t: 'cone', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), a: z.a, arc: z.arc });
    }
    if (z.onEnd) z.onEnd(this, z);
  };

  // ---------------- generic enemy tick (behaviour lives in ai.js) ----------------
  W.updateEnemy = function (e, dt) {
    if (e.hp <= 0) return;
    e.flash -= dt; e.mark -= dt; e.contactCd -= dt; e.invulnT = (e.invulnT || 0) - dt;
    if (e.spawnT > 0) { e.spawnT -= dt; return; }
    this.tickStatuses(e, dt);
    if (e.hp <= 0) return;
    if (e.kbx || e.kby) {
      Sim.moveCircle(e, e.kbx * dt, e.kby * dt, this.room, this.locked, e.fly);
      const f = Math.max(0, 1 - 9 * dt); e.kbx *= f; e.kby *= f;
      if (Math.abs(e.kbx) + Math.abs(e.kby) < 4) { e.kbx = 0; e.kby = 0; }
    }
    if (!e.exposed && !e.def.invuln && this.enc && ((!e.boss && this.roomTime > 45) || (e.boss && this.roomTime > 78))) { e.exposed = true; this.emit({ t: 'expose', x: e.x, y: e.y, boss: e.boss ? 1 : 0 }); }
    if (e.exposed && !e.def.invuln) e.hp -= e.maxHp * (e.boss ? 0.012 : 0.04) * dt;
    if (e.hp <= 0) { this.killEnemy(e, null, {}); return; }
    if (e.frozen > 0 || e.stun > 0) return;
    if (e.cd > 0 && !e.boss) e.cd -= dt * this.threat().cdRate; // attack cooldowns recover faster; wind-ups are untouched
    e.tgtT -= dt;
    const t = e.target;
    if (e.tgtT <= 0 || !t || t.ghost || t.stealthT > 0 || !this.alive(t)) {
      const n = this.nearestPlayer(e.x, e.y);
      e.tgtT = 0.6;
      // no visible hero: AI runs against a position-only stand-in {x, y, vx, vy, ghost} at the last seen spot (ai.js/bosses.js read only those fields); nobody up = idle
      if (n) e.target = n;
      else if (t && this.alivePlayers().length) { if (!t.ghost) e.target = { x: t.x, y: t.y, vx: 0, vy: 0, ghost: true }; }
      else e.target = null;
    }
    if (!e.target) return;
    const ai = ED.AI[e.def.ai];
    if (ai) ai(this, e, dt);
    // contact damage: full only during body-hit attack states, otherwise 0.4x
    if (e.contactCd <= 0 && e.def.ai !== 'bomber' && !e.burrowed) {
      for (const p of this.players.values()) {
        if (p.downed || p.dead) continue;
        const rr = e.r + p.r - 3;
        if (U.dist2(e.x, e.y, p.x, p.y) < rr * rr) {
          const full = FULL_CONTACT.has(e.st) || e.def.gloom;
          if (this.hurtPlayer(p, e.dmg * (full ? 1 : 0.4) * (e.boss ? 0.8 : 1), { e, x: e.x, y: e.y })) { e.contactCd = 1.0; e.recoil = 0.35; }
          break;
        }
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
