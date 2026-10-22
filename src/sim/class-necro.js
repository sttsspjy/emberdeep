// Necromancer: Raise Legion and Bone Harvest (base kits from ED.SKILLS numbers), the minions (spawnMinion, updateAllies) and the route cards that act on them (Hex, Bone Spikes, Bone Knights, corpses, Bone Armor, Abyssal empower, Rise Again); hook table ED.CLS.necro.
// Skill forms (rank 3): Ossuary Bloom (bone fields and bone bombs), Death Knight (one huge taunting knight), Carrion Storm (shards from every corpse), Lich Form (a window of soul bolts, double-life minions and Brace-channel damage reduction).
// Allies carry k for the wire: 0 minion, 1 Death Knight, 2 bone bomb; a bomb is never a minion (no cap, no Harvest).
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, C = ED.CONST;
  const W = ED.World.prototype;
  // COMP_MUL: minion damage factor. HEX_R: Hexed foes within this of the owner are rushed by its minions. CORPSE_T / CORPSE_N: longest age (s) and ring size of the corpse list. KNIGHT_MUL / KNIGHT_R: Bone Knight damage factor and body radius.
  // GRAVE_CD / YARD_CD / RISE_CD: seconds between Gravecaller, Boneyard and Rise Again raises. TIDE_LIFE: extra seconds of a Risen Tide minion. ABYSS_T: length of the Abyssal empower. BONE_CD: seconds between Bone Armor shields.
  // DK_R / DK_LIFE / DK_HIT / DK_REACH / DK_SPEED: Death Knight body radius, durability (seconds of life; a blocked shot costs 1, a touching foe DK_HIT per second, elites twice), cleave reach and speed.
  // BOMB_N / BOMB_LIFE / BOMB_SPEED: bone bombs a Legion cast raises, their life and speed. SHARD_R / SHARD_SPEED: reach and speed of a Carrion Storm shard. LICH_A: half-angle of the Lich Form bolts beside the aimed one.
  Object.assign(C, { COMP_MUL: 0.85, HEX_R: 400, CORPSE_T: 4, CORPSE_N: 16, KNIGHT_MUL: 2, KNIGHT_R: 13, GRAVE_CD: 1, YARD_CD: 2, RISE_CD: 1.5, TIDE_LIFE: 4, ABYSS_T: 6, BONE_CD: 12,
    DK_R: 18, DK_LIFE: 40, DK_HIT: 0.4, DK_REACH: 54, DK_SPEED: 90, BOMB_N: 2, BOMB_LIFE: 5, BOMB_SPEED: 190, SHARD_R: 260, SHARD_SPEED: 480, LICH_A: 0.22 });
  const rnd = Math.round;

  // Raise Legion: minions fan out around the cursor point for the part's duration. Death Knight: the minions fall and one Death Knight stands in their place. Ossuary Bloom: BOMB_N bone bombs run out as well.
  ED.CAST.legion = function (p, a, data, st, N) {
    const g = this.groundTarget(p, a, data, 'legion'), q = N.p.minion;
    if (st.dk > 0) {
      for (const m of this.allies) if (m.owner === p.pid && !m.bomb) m.life = 0;
      const m = { x: g.x + Math.cos(a) * 26, y: g.y + Math.sin(a) * 26, r: C.DK_R };
      Sim.resolve(m, this.room, this.locked, false);
      this.spawnDeathKnight(p, m.x, m.y);
    } else {
      for (let i = 0; i < q.n; i++) {
        const an = a + (i - (q.n - 1) / 2) * 0.9, m = { x: g.x + Math.cos(an) * 26, y: g.y + Math.sin(an) * 26, r: 9 };
        Sim.resolve(m, this.room, this.locked, false);
        this.spawnMinion(p, m.x, m.y, q.dur);
      }
    }
    if (st.bloom > 0) {
      for (let i = 0; i < C.BOMB_N; i++) {
        const an = a + (i - (C.BOMB_N - 1) / 2) * 1.4 + Math.PI / 2, m = { x: g.x + Math.cos(an) * 34, y: g.y + Math.sin(an) * 34, r: 8 };
        Sim.resolve(m, this.room, this.locked, false);
        this.spawnBomb(p, m.x, m.y);
      }
    }
    return { x: Math.round(g.x), y: Math.round(g.y) };
  };

  // Bone Harvest: every minion explodes where it stands (Bone Lances: on the foe nearest it within 200) and heals the Necromancer 3% each (at most 6% per cast); the Death Knight and the bone bombs are not harvested;
  // Corpse Explosion detonates recent corpses within 220 (Carrion Storm: each launches shards at the nearest foes); Ossuary Bloom bursts every harvested minion with Bone Spikes as well;
  // Bone Armor shields per minion harvested (source 'bone': counts in the all-sources shield window only, its own 12 s timer keeps it at 0.5%/s) and Marrow Field leaves slowing shards; Lich Form opens its window;
  // then new minions rise (1, or 2 with none; harvestRaise sets the count).
  ED.CAST.harvest = function (p, a, data, st, N) {
    const mine = this.allies.filter(q => q.owner === p.pid && q.life > 0 && !q.bomb && !q.dk), b = N.p.burst, life = ED.Stats.skillNums('legion', st).p.minion.dur;
    const dead = st.corpse ? this.corpses.filter(c => this.time - c.t <= C.CORPSE_T && U.dist2(c.x, c.y, p.x, p.y) <= 220 * 220).sort((u, v) => v.t - u.t).slice(0, Math.round(st.corpse)) : [];
    const burst = (x, y, q, part, ev) => {
      this.skillBlast(p, x, y, q.r, q.dmg, this.partSrc(p, N, part, { knock: 90, infAdd: { shadow: 0.5 } }));
      this.emit(Object.assign({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(q.r), k: 'bone' }, ev));
    };
    for (const m of mine) {
      const tg = st.boneLance ? this.nearestEnemy(m.x, m.y, 200) : null;
      if (tg) { this.emit({ t: 'blance', x0: Math.round(m.x), y0: Math.round(m.y), x1: Math.round(tg.x), y1: Math.round(tg.y), pid: p.pid }); burst(tg.x, tg.y, N.p.lance, 'lance'); } else burst(m.x, m.y, b, 'burst');
      if (st.bloom > 0) this.boneSpikes(p, m);
    }
    if (dead.length) {
      this.corpses = this.corpses.filter(c => dead.indexOf(c) < 0);
      for (const c of dead) { burst(c.x, c.y, N.p.corpse, 'corpse', st.carrionN > 0 ? { c: 1, cs: 1 } : { c: 1 }); if (st.carrionN > 0) carrionShards(this, p, c, N, st); }
    }
    if (st.lich > 0) { p.lichT = st.lichT; p.braceT = st.lichT; p.braceAt = this.time; this.emit({ t: 'lich', pid: p.pid }); } // Lich Form: the Brace channel carries the damage cut (hurtPlayer applies it under the DR floor)
    if (mine.length) {
      const gone = new Set(mine);
      this.allies = this.allies.filter(q => !gone.has(q));
      this.healPlayer(p, p.maxHp * Math.min(0.06, 0.03 * mine.length));
      if (st.boneArmor && p.boneT <= 0 && this.addShield(p, Math.min(st.boneCap, st.boneArmor * mine.length) * p.maxHp, C.CLASS_SHIELD_CAP * p.maxHp, 'bone') > 0) p.boneT = C.BONE_CD;
      if (st.boneField) for (const m of mine) this.boneField(p, m.x, m.y);
    }
    const n = st.harvestRaise || (mine.length ? 1 : 2);
    for (let i = 0; i < n; i++) { const an = a + (i - (n - 1) / 2) * 0.9; this.spawnMinion(p, p.x + Math.cos(an) * 26, p.y + Math.sin(an) * 26, life); }
    return {};
  };

  // Carrion Storm: a detonating corpse launches carrionN shards at the nearest foes within SHARD_R (one each, the same foe again when fewer stand there); one launch per detonation, a shard detonates nothing.
  function carrionShards(w, p, c, N, st) {
    const near = [];
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed) continue;
      const d2 = U.dist2(e.x, e.y, c.x, c.y);
      if (d2 < C.SHARD_R * C.SHARD_R) near.push({ d2, e });
    }
    if (!near.length) return;
    near.sort((u, v) => u.d2 - v.d2);
    const q = N.p.shard, n = Math.round(st.carrionN);
    for (let i = 0; i < n; i++) {
      const e = near[i % near.length].e;
      w.spawnProj({ team: 0, kind: 'bone', x: c.x, y: c.y - 4, a: Math.atan2(e.y - c.y, e.x - c.x), speed: C.SHARD_SPEED, r: 5, dmg: q.dmg, life: 0.7, pierce: 0, owner: p.pid, knock: q.knock, hk: 'skill', part: 'harvest.shard', infAdd: { shadow: 0.5 } });
    }
  }

  // Marrow Field: bone shards (r40, 2 s) that slow the foes inside by 40%.
  W.boneField = function (p, x, y) {
    this.addZone({ kind: 'shards', x, y, r: 40, dur: 2, team: 0, owner: p.pid, custom: true,
      update(w, z) { for (const e of w.enemies) if (e.hp > 0 && e.spawnT <= 0 && U.dist2(e.x, e.y, z.x, z.y) < (z.r + e.r) ** 2) w.slowEnemy(e, 0.4, 0.3); } });
  };

  // Raises a minion for the owner (the oldest falls when the cap is full). kind labels the rise effect (gc Gravecaller, yard Boneyard, again Rise Again); tide: a Risen Tide minion (lasts TIDE_LIFE longer, hits harder).
  // Bone Knights (the owner holds knights) are armoured: bigger, longer-lived by knightLife.
  // A Death Knight holds the cap by itself (it counts as 2 minions and is never replaced): every other raise is refused while it stands. Lich Form doubles the life of what the Necromancer raises in its window.
  W.spawnMinion = function (owner, x, y, life, kind, tide) {
    const st = owner.stats, kn = st.knights > 0;
    const mine = this.allies.filter(a => a.owner === owner.pid && a.life > 0 && !a.bomb);
    if (mine.some(a => a.dk)) return null;
    if (mine.length >= st.maxMinions) { mine.sort((a, b) => a.life - b.life); mine[0].life = 0; }
    const l = (life + (tide ? C.TIDE_LIFE : 0)) * (kn ? 1 + st.knightLife : 1) * (owner.lichT > 0 ? st.lichLife : 1);
    const a = { id: U.uid(), owner: owner.pid, x, y, r: kn ? C.KNIGHT_R : 9, life: l, maxLife: l, cd: 0.5, face: 1, knight: kn, tide: !!tide, k: 0,
      dmg: ED.Stats.skillNums('legion', st).p.minion.dmg * (1 + st.minionDmg) };
    this.allies.push(a);
    const ev = { t: 'raise', x: Math.round(x), y: Math.round(y), pid: owner.pid };
    if (tide) ev.k = 'tide'; else if (kind) ev.k = kind;
    this.emit(ev);
    return a;
  };

  // Death Knight: one armoured unit (r DK_R) that does not run down with time: its life (DK_LIFE, Ironbone longer) is spent by blocked shots and touching foes.
  W.spawnDeathKnight = function (owner, x, y) {
    const st = owner.stats, l = C.DK_LIFE * (1 + st.knightLife);
    const a = { id: U.uid(), owner: owner.pid, x, y, r: C.DK_R, life: l, maxLife: l, cd: 0.5, face: 1, knight: true, dk: true, tide: false, k: 1, dmg: ED.Stats.skillNums('legion', st).p.minion.dmg * (1 + st.minionDmg) };
    this.allies.push(a);
    this.emit({ t: 'dkraise', x: rnd(x), y: rnd(y), pid: owner.pid });
    return a;
  };

  // Bone bomb: a short-lived ally outside the minion cap that runs at the nearest foe and explodes (updateBomb).
  W.spawnBomb = function (owner, x, y) {
    const a = { id: U.uid(), owner: owner.pid, x, y, r: 8, life: C.BOMB_LIFE, maxLife: C.BOMB_LIFE, cd: 0, face: 1, bomb: true, knight: false, tide: false, k: 2, dmg: 0 };
    this.allies.push(a);
    this.emit({ t: 'raise', x: rnd(x), y: rnd(y), pid: owner.pid, k: 'bomb' });
    return a;
  };

  // Bone Spikes: a minion bursts where it falls (r60, Shadow, marks Doom for half of the damage); Ossuary Bloom leaves a bone field.
  W.boneSpikes = function (owner, a) {
    const N = ED.Stats.skillNums('legion', owner.stats), q = N.p.spikes;
    this.skillBlast(owner, a.x, a.y, q.r, q.dmg, this.partSrc(owner, N, 'spikes', { knock: 90, infAdd: { shadow: 0.5 } }));
    this.emit({ t: 'boom', x: Math.round(a.x), y: Math.round(a.y), r: Math.round(q.r), k: 'bone', s: 1 });
    if (owner.stats.bloom > 0) this.bloomField(owner, a.x, a.y);
  };

  // Ossuary Bloom field: a shards zone (w 11 for the renderer) that ticks the field part's damage per second for its 2 s.
  W.bloomField = function (owner, x, y) {
    const N = ED.Stats.skillNums('legion', owner.stats), q = N.p.field;
    this.addZone({ kind: 'shards', x, y, r: q.r, dur: q.dur, dps: q.dmg, team: 0, owner: owner.pid, clsEl: owner.stats.element, part: 'legion.field', w: 11 });
  };
  // A bone bomb explodes: the bomb part's burst (120% of a Bone Spikes burst, Doom at half) and a field.
  W.bombBurst = function (owner, a) {
    const N = ED.Stats.skillNums('legion', owner.stats), q = N.p.bomb;
    this.skillBlast(owner, a.x, a.y, q.r, q.dmg, this.partSrc(owner, N, 'bomb', { knock: q.knock, infAdd: { shadow: 0.5 } }));
    this.emit({ t: 'boom', x: rnd(a.x), y: rnd(a.y), r: rnd(q.r), k: 'bone', s: 1, b: 1 });
    this.bloomField(owner, a.x, a.y);
  };

  // The Hexed foe (Hexed by this owner's slot) nearest the owner within HEX_R, or null.
  function hexTarget(w, owner) {
    const bit = 1 << owner.slot;
    let best = null, bd = C.HEX_R * C.HEX_R;
    for (const e of w.enemies) {
      if (!(e.hexT > 0) || !(e.hexBy & bit) || e.hp <= 0 || e.spawnT > 0 || e.def.invuln || e.burrowed || e.invulnT > 0) continue;
      const d = U.dist2(e.x, e.y, owner.x, owner.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // A Bone Knight stops every enemy shot that touches it; each block costs it 1 s of life.
  function knightBlock(w, a) {
    for (const o of w.projs) {
      if (o.team !== 1 || o.life <= 0 || U.dist2(o.x, o.y, a.x, a.y) > (a.r + o.r) ** 2) continue;
      o.life = 0; a.life -= 1;
      w.emit({ t: 'kblock', x: Math.round(o.x), y: Math.round(o.y), pid: a.owner });
    }
  }

  // One strike of minion a on foe tgt. Damage: the minion's strike x COMP_MUL x Bone Knight x Hexed (hexMul) x Abyssal empower x Risen Tide; physical, raw, infuses at MINION_INFUSE (+ minionInfuse).
  // Grave Pact marks Doom for mInfShadow of the damage (Mark of Doom's rate x k counts instead when higher). A Bone Knight's strike stuns its foe (knightStun, a repeating stun); a Bone Knight also cleaves the foes within 30 of its target.
  // The Death Knight deals dkMul instead of the Bone Knight factor and cleaves every foe within DK_REACH of it inside an arc of dkArc centred on its target.
  function strike(w, a, owner, tgt) {
    const st = owner.stats, k = C.MINION_INFUSE + st.minionInfuse, bit = 1 << owner.slot, base = a.dmg * C.COMP_MUL * (a.dk ? st.dkMul : a.knight ? C.KNIGHT_MUL : 1) * (owner.abyssT > 0 ? 1 + st.abyssMin : 1) * (a.tide ? 1 + st.tideMul : 1);
    const infAdd = st.mInfShadow ? { shadow: Math.max(0, st.mInfShadow / k - st.shadowInfuse) } : undefined;
    const isHexed = (e) => e.hexT > 0 && (e.hexBy & bit);
    const hit = (e) => {
      const dd = Math.hypot(e.x - a.x, e.y - a.y) || 1;
      w.hitEnemy(e, base * (isHexed(e) ? 1 + st.hexMul : 1), { p: owner, kind: 'minion', comp: true, knock: 40, kx: (e.x - a.x) / dd, ky: (e.y - a.y) / dd, raw: true, infK: k, infAdd });
    };
    a.cd = (a.knight ? 0.5 : 0.7) * (isHexed(tgt) ? 1 - st.hexHaste : 1);
    a.face = tgt.x >= a.x ? 1 : -1;
    hit(tgt);
    if (!a.knight) return;
    if (st.knightStun && tgt.hp > 0 && w.stunFoe(tgt, st.knightStun, true) > 0) w.emit({ t: 'kstun', x: Math.round(tgt.x), y: Math.round(tgt.y) });
    if (a.dk) {
      const ta = Math.atan2(tgt.y - a.y, tgt.x - a.x);
      for (const o of w.enemies) {
        if (o === tgt || o.hp <= 0 || o.spawnT > 0 || o.def.invuln || o.burrowed || U.dist2(o.x, o.y, a.x, a.y) > (C.DK_REACH + o.r) ** 2) continue;
        if (Math.abs(U.angDiff(ta, Math.atan2(o.y - a.y, o.x - a.x))) <= st.dkArc / 2) hit(o);
      }
      w.emit({ t: 'dkswing', x: rnd(a.x), y: rnd(a.y), a: Math.round(ta * 100) / 100, pid: owner.pid });
      return;
    }
    for (const o of w.enemies) if (o !== tgt && o.hp > 0 && o.spawnT <= 0 && !o.def.invuln && !o.burrowed && U.dist2(o.x, o.y, tgt.x, tgt.y) <= (30 + o.r) ** 2) hit(o);
  }

  // Death Knight: foes within dkTaunt (not bosses) target it for the next 0.4 s (updateEnemy keeps a live target object until tgtT runs out), and a foe touching it costs it DK_HIT s of life once per second (elites twice).
  function dkTick(w, a, owner) {
    const R = owner.stats.dkTaunt;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.spawnT > 0 || e.boss || e.def.invuln || e.burrowed || U.dist2(e.x, e.y, a.x, a.y) > (R + e.r) ** 2) continue;
      e.target = a; e.tgtT = 0.4;
      if (U.dist2(e.x, e.y, a.x, a.y) < (a.r + e.r + 3) ** 2 && !(e.dkAt > w.time - 1)) { e.dkAt = w.time; a.life -= C.DK_HIT * (e.elite ? 2 : 1); }
    }
  }

  // Bone bomb: runs at the nearest foe within 400 and explodes on touching it, or when its time is up (or its owner is gone, without a burst); false when it is gone.
  function updateBomb(w, a, owner, dt) {
    a.life -= dt;
    if (!owner) { a.dead = true; return false; }
    const tgt = w.nearestEnemy(a.x, a.y, 400);
    if (a.life <= 0 || (tgt && Math.hypot(tgt.x - a.x, tgt.y - a.y) < a.r + tgt.r + 6)) { w.bombBurst(owner, a); a.dead = true; return false; }
    const tx = tgt ? tgt.x : owner.x + Math.cos(a.id) * 30, ty = tgt ? tgt.y : owner.y + Math.sin(a.id) * 30;
    if (Math.hypot(tx - a.x, ty - a.y) > 6) {
      const dir = w.pathDir(a, tx, ty);
      Sim.moveCircle(a, dir[0] * C.BOMB_SPEED * dt, dir[1] * C.BOMB_SPEED * dt, w.room, w.locked, false);
      a.face = dir[0] >= 0 ? 1 : -1;
    }
    return true;
  }

  // Minions rush the Hexed foe nearest their owner (else the nearest foe within 400 of themselves) and strike it every 0.7 s (Bone Knights 0.5 s); a minion that expires or falls bursts with Bone Spikes.
  // The Death Knight does not run down with time; bone bombs have their own brain (updateBomb).
  W.updateAllies = function (dt) {
    if (!this.allies.length) return;
    const keep = [], hexTgt = {};
    for (const a of this.allies) {
      const owner = this.players.get(a.owner);
      if (a.bomb) { if (updateBomb(this, a, owner, dt)) keep.push(a); else this.emit({ t: 'puff', x: a.x, y: a.y, c: '#e6dfc9' }); continue; }
      if (!a.dk) a.life -= dt;
      a.cd -= dt;
      if (a.life <= 0 || !owner) {
        if (owner && owner.stats.boneSpikes) this.boneSpikes(owner, a);
        this.emit({ t: 'puff', x: a.x, y: a.y, c: '#7dffd9' });
        a.dead = true;
        continue;
      }
      if (a.knight) knightBlock(this, a);
      if (a.dk) dkTick(this, a, owner);
      let tgt = null;
      if (owner.stats.hex) {
        let h = hexTgt[a.owner];
        if (h === undefined || (h && h.hp <= 0)) h = hexTgt[a.owner] = hexTarget(this, owner);
        tgt = h;
      }
      if (!tgt) tgt = this.nearestEnemy(a.x, a.y, 400);
      let tx, ty;
      if (tgt) { tx = tgt.x; ty = tgt.y; } else { tx = owner.x + Math.cos(a.id) * 30; ty = owner.y + Math.sin(a.id) * 30; }
      const d = Math.hypot(tx - a.x, ty - a.y);
      if (tgt && d < a.r + tgt.r + 6) {
        if (a.cd <= 0) strike(this, a, owner, tgt);
      } else if (d > 6) {
        const dir = this.pathDir(a, tx, ty), sp = a.dk ? C.DK_SPEED : 105;
        Sim.moveCircle(a, dir[0] * sp * dt, dir[1] * sp * dt, this.room, this.locked, false);
        a.face = dir[0] >= 0 ? 1 : -1;
      }
      keep.push(a);
    }
    this.allies = keep;
  };

  // Hexes foe e for t seconds for the hero (strongest time wins, the hero's slot joins the mask; tickStatuses clears the mask at 0).
  function hexFoe(e, t, p) { e.hexT = Math.max(e.hexT, t); e.hexBy |= 1 << p.slot; }
  // Abyssal empower: the hero's minions deal +abyssMin for ABYSS_T seconds.
  function abyss(w, p) { p.abyssT = C.ABYSS_T; w.emit({ t: 'abyss', pid: p.pid }); }

  ED.CLS.necro = {
    init(p) { p.yardAt = -99; p.lichT = 0; }, // world time of the last Boneyard raise; seconds left of the Lich Form window
    tick(p, dt) { if (p.lichT > 0) p.lichT -= dt; },
    // Lich Form: inside the window every attack adds two soul bolts (a seeking weapon shot at lichMul of a hit, either side of the aim) whatever the weapon
    attack(p, a, st) {
      if (!(p.lichT > 0) || !(st.lich > 0)) return;
      for (let s = -1; s <= 1; s += 2) this.spawnProj({ team: 0, kind: 'soul', x: p.x, y: p.y - 4, a: a + s * C.LICH_A, speed: 350, r: 5, dmg: st.weapon.dmg * st.lichMul, life: 1.0, pierce: 0, owner: p.pid, knock: 40, homing: 4, wpn: true });
    },
    // Soul Barrage: foes the hero Hexed take +hexSelf from the hero (added to the hero multiplier)
    hitMul(p, e) { return p.stats.hexSelf && e.hexT > 0 && (e.hexBy & (1 << p.slot)) ? p.stats.hexSelf : 0; },
    // Soul Command: a weapon hit Hexes its foe for hex seconds; Hex Burst (hexSpread) spreads it to the foes within hexSpread of the hit
    hitDone(p, e, dmg, crit, src) {
      const st = p.stats;
      if (!st.hex || !src.wpn || e.hp <= 0) return;
      hexFoe(e, st.hex, p);
      if (st.hexSpread) for (const o of this.enemies) if (o !== e && o.hp > 0 && o.spawnT <= 0 && !o.def.invuln && U.dist2(o.x, o.y, e.x, e.y) <= (st.hexSpread + o.r) ** 2) hexFoe(o, st.hex, p);
    },
    // Every death: Corpse Explosion keeps a ring of recent corpses while some hero owns it. The Necromancer's own kills: Abyssal empower on a Reaped elite; Boneyard, Gravecaller and Rise Again raise one guaranteed minion
    // (replacing the luck roll for that kill, each limited by its own cooldown); else a foe it kills may rise as a minion for 10 s (12% + the weapon's raise)
    kill(e, p, src) {
      if (!e.boss) {
        for (const q of this.players.values()) if (q.stats.corpse) { this.corpses.push({ x: e.x, y: e.y, t: this.time }); if (this.corpses.length > C.CORPSE_N) this.corpses.shift(); break; }
      }
      if (!p || p.cls !== 'necro' || e.boss || src.kind === 'minionBurst') return;
      const st = p.stats;
      if (src.kind === 'reap' && e.elite && st.abyssMin) abyss(this, p);
      if (e.fodder) return; // fodder never rises
      if (st.spikeRaise && src.part === 'legion.spikes') {
        if (this.time >= p.yardAt + C.YARD_CD) { p.yardAt = this.time; this.spawnMinion(p, e.x, e.y, 10, 'yard'); }
        return;
      }
      if (st.wRaise && src.wpn) {
        if (p.raiseT <= 0) { p.raiseT = C.GRAVE_CD; this.spawnMinion(p, e.x, e.y, 10, 'gc'); }
        return;
      }
      if (st.reapRaise && src.kind === 'reap') {
        if (p.raiseT <= 0) { p.raiseT = C.RISE_CD; this.spawnMinion(p, e.x, e.y, 10, 'again', st.tideMul > 0); }
        return;
      }
      if (this.rng.chance(0.12 + (st.weapon.raise || 0))) this.spawnMinion(p, e.x, e.y, 10);
    },
    // A boss Toll: Abyssal empower, and Rise Again raises a minion beside the boss on the Necromancer's side
    toll(p, boss) {
      const st = p.stats;
      if (st.abyssMin) abyss(this, p);
      if (!st.reapRaise || boss.hp <= 0) return;
      const an = Math.atan2(p.y - boss.y, p.x - boss.x), d = boss.r + 18, m = { x: boss.x + Math.cos(an) * d, y: boss.y + Math.sin(an) * d, r: 9 };
      Sim.resolve(m, this.room, this.locked, false);
      this.spawnMinion(p, m.x, m.y, 10, 'again', st.tideMul > 0);
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
