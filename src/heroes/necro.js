// Necro: hero data, signature Bone Shard (8 levels) + evolution Bone Storm, Q Raise Horde, E Corpse Blast (3 skill levels each), kill-rise passive, skeleton minions.
// Minions are zones (look 'minion' or 'boneknight', networked like any zone; z.a = facing, z.w = swing flash 1..0, wid = credited weapon or skill) driven by minTick
// (grid queries: nearestFoe retarget every 0.3 s, leash 300 px to the owner). Owner lists p.minions / p.minIds (refs checked by id). Kill-rise respects the cap
// (8, Bone Storm 16); Raise Horde may exceed it up to HARD_CAP, the oldest minion falling first. Corpses: the last CORPSES kills by this hero (ring of x, y, time).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU, TICK = C.TICK;
  const CAP = 8, STORM_CAP = 16, HARD_CAP = 24, CORPSES = 64, CORPSE_AGE = 5, LEASH = 300;

  ED.regLook('minion', 'boneknight', 'raise', 'corpse');
  ED.addHero({ id: 'necro', name: 'Necro', hp: 95, speed: 88, crit: 0.05, sig: 'boneshard', skills: ['raise', 'corpseblast'], icon: 'hero.necro.idle', col: '#b7a6e0', txt: 'Piercing shards. The dead rise.' });

  // ---------------- minions ----------------
  // Live minion count of hero p (any hero may carry Bone Shard: the lists are created on first use).
  const liveMinions = (p) => {
    if (!p.minions) { p.minions = []; p.minIds = []; p.minSlot = 0; }
    const M = p.minions, I = p.minIds;
    let n = 0;
    for (let i = 0; i < M.length; i++) { const z = M[i]; if (!z.dead && z.id === I[i]) { M[n] = z; I[n] = I[i]; n++; } }
    M.length = I.length = n;
    return n;
  };
  const sigSlot = (p) => { for (let i = 0; i < p.weapons.length; i++) { const id = p.weapons[i].id; if (id === 'boneshard' || id === 'bonestorm') return i; } return -1; };
  const minCap = (p) => { const i = sigSlot(p); return i >= 0 && p.weapons[i].id === 'bonestorm' ? STORM_CAP : CAP; };
  // Minion hit damage: 10 (Bone Knight 26) x might x (1 + 0.1 per Bone Shard level above 1; Bone Storm x1.8).
  const minDmg = (p, big) => {
    const i = sigSlot(p), ws = i >= 0 ? p.weapons[i] : null;
    const k = ws ? (ws.id === 'bonestorm' ? 1.8 : 1 + 0.1 * (ws.lvl - 1)) : 1;
    return (big ? 26 : 10) * (1 + p.stats.might) * k;
  };
  const MHIT = { knock: 70, noEv: true, kind: 'minion' }, KHIT = { knock: 220, noEv: true, kind: 'minion', stun: 0.3 };
  const minTick = (w, z) => {
    const s = z.st, p = s.p;
    if (z.w > 0) z.w = Math.max(0, z.w - TICK * 4);
    s.cd -= TICK; s.rt -= TICK;
    const far = p.dead || U.dist2(z.x, z.y, p.x, p.y) > LEASH * LEASH;
    let e = s.tgt;
    if (far) e = null;
    else if (!e || e.dead || e.id !== s.tid || s.rt <= 0) { e = w.nearestFoe(z.x, z.y, 220); s.rt = 0.3; }
    s.tgt = e; s.tid = e ? e.id : 0;
    let tx, ty, sp = s.spd;
    if (e) { tx = e.x; ty = e.y; }
    else { const a = s.slot * 2.4 + w.time * 0.6; tx = p.x + Math.cos(a) * 34; ty = p.y + Math.sin(a) * 24; if (far) sp *= 1.7; }
    const dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy);
    if (d > 0.5) z.a = Math.atan2(dy, dx);
    const reach = e ? z.r + e.r + 6 : 6;
    if (d > reach) { const st = Math.min(d - reach + 1, sp * TICK); ED.Arena.move(w.arena, z, dx / d * st, dy / d * st, z.r); }
    if (e && d <= reach + 8 && s.cd <= 0) {
      s.cd = s.big ? 0.85 : 0.6; z.w = 1;
      w.arc(p, z.wid, z.x, z.y - 4, z.a, z.r + (s.big ? 26 : 14), s.big ? 3.2 : 2.2, s.dmg, s.big ? KHIT : MHIT);
    }
  };
  // Raises a minion at (x, y) credited to wid; big = Bone Knight. Over HARD_CAP the oldest falls. Returns the zone.
  const MZ = { team: 0, p: null, wid: '', x: 0, y: 0, r: 7, a: 0, w: 0, dur: 15, look: 'minion', st: null, onTick: minTick };
  const raise = (w, p, x, y, wid, big, life) => {
    if (liveMinions(p) >= HARD_CAP) { p.minions[0].dead = true; p.minions.shift(); p.minIds.shift(); }
    MZ.p = p; MZ.wid = wid; MZ.x = x; MZ.y = y; MZ.r = big ? 11 : 7; MZ.a = U.angle(x, y, p.x, p.y); MZ.w = 0; MZ.dur = life; MZ.look = big ? 'boneknight' : 'minion';
    MZ.st = { p, big, dmg: minDmg(p, big), spd: big ? 95 : 115, cd: 0.4, rt: 0, tgt: null, tid: 0, slot: p.minSlot++ };
    const z = w.zone(MZ);
    ED.Arena.collide(w.arena, z, z.r);
    p.minions.push(z); p.minIds.push(z.id);
    return z;
  };
  ED.Necro = { liveMinions, raise };

  // ---------------- Bone Shard ----------------
  // S.n piercing shards (0.14 rad fan) at the nearest foe; homing (turn rad/s); mshot: every minion also throws one shard at its target (or the nearest foe).
  // S.rise: chance that a foe this hero kills rises as a minion (the hero hook reads it).
  const SHARD = { look: 'bone', homing: 0 };
  const minionShots = (w, p, ws, S, opt) => {
    const n = liveMinions(p);
    for (let i = 0; i < n; i++) {
      const z = p.minions[i], t = z.st.tgt && !z.st.tgt.dead && z.st.tgt.id === z.st.tid ? z.st.tgt : w.nearestFoe(z.x, z.y, S.range * 0.7);
      if (t) w.shoot(p, ws.id, z.x, z.y - 6, Math.atan2(t.y - z.y, t.x - z.x), S, opt);
    }
  };
  ED.addWeapon({
    id: 'boneshard', name: 'Bone Shard', icon: 'weapon.bonewand', look: 'bone', sig: 'necro', mode: 'nearest', txt: 'Piercing shards; the slain may rise',
    base: { dmg: 12, cd: 1.0, n: 1, pierce: 2, area: 1, speed: 300, dur: 0, knock: 20, range: 340, rise: 0.06, homing: 0 },
    levels: [
      { mods: { n: 1 }, txt: '+1 shard' },
      { mods: { pierce: 2 }, txt: 'Shards pierce 2 more foes' },
      { mods: { dmg: 0.25, homing: 3 }, txt: '+25% damage, shards seek foes' },
      { mods: { n: 1 }, txt: '+1 shard' },
      { mods: { mshot: true }, txt: 'Minions throw shards too' },
      { mods: { n: 1, rise: 0.04 }, txt: '+1 shard, more of the slain rise' },
      { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 shard' },
    ],
    pair: 'haste', evo: 'bonestorm',
  }, {
    fire(w, p, ws, S) {
      const t = w.nearestFoe(p.x, p.y, S.range); if (!t) return false;
      const a = Math.atan2(t.y - p.y, t.x - p.x), n = Math.max(1, S.n | 0);
      SHARD.homing = S.homing || 0;
      for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.14, S, SHARD);
      if (S.mshot) minionShots(w, p, ws, S, SHARD);
      return true;
    },
  });
  // Bone Storm: S.n shards orbit the hero (radius 30, S.orbit s, re-hitting foes they touch), then launch at the nearest foe (homing); minions throw shards; minion cap 16.
  const orbitTick = (w, pr) => {
    const s = pr.st, p = pr.p;
    if (s.go) return;
    if (pr.t < s.T && w.alive(p)) {
      const a = s.a0 + pr.t * 7;
      pr.x = p.x + Math.cos(a) * 30; pr.y = p.y - 6 + Math.sin(a) * 30; pr.vx = -Math.sin(a) * 1e-3; pr.vy = Math.cos(a) * 1e-3;
      return;
    }
    s.go = true;
    const t = w.nearestFoe(pr.x, pr.y, s.range), a = t ? Math.atan2(t.y - pr.y, t.x - pr.x) : Math.atan2(pr.y - p.y + 6, pr.x - p.x);
    pr.vx = Math.cos(a) * pr.sp; pr.vy = Math.sin(a) * pr.sp; pr.hits.length = 0; pr.rehit = 0; pr.pierce = s.pierce; pr.homing = 2.5;
  };
  const STORM = { look: 'bone', pierce: 999, rehit: 0.25, life: 1, tick: orbitTick, st: null };
  ED.addWeapon({
    id: 'bonestorm', name: 'Bone Storm', icon: 'weapon.soulscythe', look: 'bone', sig: 'necro', mode: 'around', evolved: true, from: 'boneshard', txt: 'Shards orbit, then launch',
    base: { dmg: 22, cd: 0.9, n: 6, pierce: 4, area: 1.2, speed: 340, dur: 0, knock: 30, range: 380, rise: 0.1, orbit: 0.7, mshot: true },
    levels: [],
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range)) return false;
      const n = Math.max(1, S.n | 0), a0 = w.time * 3;
      STORM.life = S.orbit + S.range / S.speed;
      for (let i = 0; i < n; i++) {
        STORM.st = { a0: a0 + i / n * TAU, T: S.orbit + i * 0.04, range: S.range, pierce: S.pierce, go: false };
        w.shoot(p, ws.id, p.x, p.y - 6, 0, S, STORM);
      }
      STORM.st = null;
      SHARD.homing = 3;
      minionShots(w, p, ws, S, SHARD);
      return true;
    },
  });

  // ---------------- skills ----------------
  // Raise Horde: the ground at the cursor (clamped to 240 px from the hero) erupts (N.r, N.dmg, stun 0.5 s) and N.n skeletons rise around it for N.life s.
  // quake: each skeleton rises in a small bone blast; knight: a Bone Knight rises too.
  const ERUPT = { knock: 260, look: 'raise', kind: 'skill', stun: 0.5 }, QUAKE = { knock: 160, look: 'bone', kind: 'skill' };
  ED.addSkill({
    id: 'raise', name: 'Raise Horde', icon: 'proj.skull', cd: 14, txt: 'Raise skeletons to fight',
    base: { dmg: 40, r: 90, n: 6, life: 15 },
    levels: [
      { mods: { n: 2 }, txt: '+2 skeletons' },
      { mods: { quake: true }, txt: 'Each skeleton rises in a bone blast' },
      { mods: { knight: true }, txt: 'Also raises a Bone Knight' },
    ],
  }, (w, p, x, y, N) => {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d > 240) { x = p.x + (x - p.x) / d * 240; y = p.y + (y - p.y) / d * 240; }
    w.blast(p, 'raise', x, y, N.r, N.dmg, ERUPT);
    w.zone({ team: 0, p, wid: 'raise', x, y, r: N.r, dur: 0.6, look: 'raise' });
    const n = N.n | 0;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, mx = x + Math.cos(a) * 28, my = y + Math.sin(a) * 28;
      raise(w, p, mx, my, 'raise', false, N.life);
      if (N.quake) w.blast(p, 'raise', mx, my, 36, N.dmg * 0.6, QUAKE);
    }
    if (N.knight) raise(w, p, x, y, 'raise', true, N.life + 5);
    return { x: Math.round(x), y: Math.round(y), r: Math.round(N.r), shake: 6, stop: 0.05 };
  });
  // Corpse Blast: every minion (1.4 r, 1.6x damage) and every fresh corpse (killed by this hero in the last 5 s) within view detonates, plus a nova at the hero (1.2 r).
  // shards: the first 16 blasts each throw 3 bone shards; rerise: detonated minions rise again.
  const SCR = [];
  const CB = { knock: 300, look: 'corpse', kind: 'skill' }, CSHARD = { look: 'bone', speed: 280, dmg: 0, pierce: 3, r: 4, life: 0.6, knock: 40 };
  // Detonation: the blast plus a visual-only 'corpse' zone (0.4 s).
  const det = (w, p, x, y, r, dmg) => { w.blast(p, 'corpseblast', x, y, r, dmg, CB); w.zone({ team: 0, p, wid: 'corpseblast', x, y, r, dur: 0.4, look: 'corpse' }); };
  const cshards = (w, p, x, y, dmg, k) => { CSHARD.dmg = dmg; for (let i = 0; i < 3; i++) w.shoot(p, 'corpseblast', x, y - 4, k * 1.7 + i / 3 * TAU, null, CSHARD); };
  ED.addSkill({
    id: 'corpseblast', name: 'Corpse Blast', icon: 'fx.sigil.skull', cd: 10, txt: 'Detonate the dead around you',
    base: { dmg: 45, r: 50 },
    levels: [
      { mods: { r: 0.4 }, txt: '+40% blast size' },
      { mods: { shards: true }, txt: 'Blasts throw bone shards' },
      { mods: { rerise: true }, txt: 'Detonated minions rise again' },
    ],
  }, (w, p, x, y, N) => {
    const hw = C.VIEW_W / 2 + 24, hh = C.VIEW_H / 2 + 24;
    let k = 0;
    det(w, p, p.x, p.y, N.r * 1.2, N.dmg);
    // detonate from a snapshot: blasts kill foes, and kill-rise edits p.minions
    const n = liveMinions(p), M = SCR;
    M.length = 0;
    for (let i = 0; i < n; i++) { const z = p.minions[i]; if (Math.abs(z.x - p.x) <= hw && Math.abs(z.y - p.y) <= hh) { z.dead = true; M.push(z.x, z.y, z.st.big ? 1 : 0, z.wid === 'raise' ? 1 : 0); } }
    for (let i = 0; i < M.length; i += 4) {
      const zx = M[i], zy = M[i + 1];
      det(w, p, zx, zy, N.r * 1.4, N.dmg * 1.6);
      if (N.shards && k < 16) cshards(w, p, zx, zy, N.dmg * 0.4, k);
      k++;
      if (N.rerise) raise(w, p, zx, zy, M[i + 3] ? 'raise' : (sigSlot(p) >= 0 ? p.weapons[sigSlot(p)].id : 'boneshard'), !!M[i + 2], M[i + 2] ? 20 : 15);
    }
    const Cp = p.corpse, now = w.time;
    for (let j = 0; j < CORPSES; j++) {
      const i = ((p.corpI - 1 - j) % CORPSES + CORPSES) % CORPSES, cx = Cp[i * 3], cy = Cp[i * 3 + 1];
      if (now - Cp[i * 3 + 2] > CORPSE_AGE) break;
      Cp[i * 3 + 2] = -1e9;
      if (Math.abs(cx - p.x) > hw || Math.abs(cy - p.y) > hh) continue;
      det(w, p, cx, cy, N.r, N.dmg);
      if (N.shards && k < 16) cshards(w, p, cx, cy, N.dmg * 0.4, k);
      k++;
    }
    return { n: k, r: Math.round(N.r), shake: Math.min(9, 4 + k * 0.25), stop: 0.06 };
  });

  // Kill hook: records the corpse, then a non-boss foe rises at the Bone Shard rise chance while under the cap.
  ED.HOOK.necro = {
    init(w, p) { p.minions = []; p.minIds = []; p.minSlot = 0; p.corpse = new Float64Array(CORPSES * 3).fill(-1e9); p.corpI = 0; },
    kill(w, p, e) {
      const i = p.corpI; p.corpse[i * 3] = e.x; p.corpse[i * 3 + 1] = e.y; p.corpse[i * 3 + 2] = w.time; p.corpI = (i + 1) % CORPSES;
      if (e.boss) return;
      const s = sigSlot(p), ch = s >= 0 ? w.weaponS(p, s).rise : 0.06;
      if (w.rng.next() < ch && liveMinions(p) < minCap(p)) raise(w, p, e.x, e.y, s >= 0 ? p.weapons[s].id : 'boneshard', false, 15);
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
