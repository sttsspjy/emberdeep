// Necro (summoner): hero data, signature Bone Shard (3 paths x 3 ranks: Legion / Shards / Plague), Forms Bone Lord / Bone Storm / Plague Field + hybrids Lich (Legion + Plague)
// and Ossuary (Legion + Shards), Q Bone Wall (3 skill levels).
// Army: every volley raises S.raise minions while fewer than S.cap live (at the freshest corpse in view, else beside the holder); kill-rise (S.rise) adds short-lived extras up to
// cap + S.over. Minions are zones (look by kind: 'minion' skeleton, 'boneknight', 'bonearcher', 'ghoul'; z.a facing, z.w swing flash 1..0, wid = credited weapon or skill) driven by
// minTick (targets only inside the owner's view: w.vclamp is the zone's hero). Hit damage = S.dmg x S.mk at raise time. Owner lists p.minions / p.minIds (refs checked by id).
// Corpses: ring p.corpse (x, y, time; time < 0 = used) of the last CORPSES foes the holder killed; raising and pools consume them (fresh = younger than CORPSE_AGE s).
// Blight pools: zones (look 'blight' / 'plague') in p.pools / p.poolIds (max POOL_CAP), dps = S.dmg x S.pk, slow; S.pburst: a blast when they dry (dmg in z.dmg);
// S.spread (Plague Field): a foe dying inside a pool seeds a new pool where it fell.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU, TICK = C.TICK;
  const HARD_CAP = 24, CORPSES = 64, CORPSE_AGE = 5, LEASH = 200, POOL_CAP = 14, RAISE_D = 200;
  const KLOOK = ['minion', 'boneknight', 'bonearcher', 'ghoul'];

  ED.regLook('minion', 'boneknight', 'corpse', 'bonewall', 'blight', 'plague', 'bonearcher', 'ghoul', 'glob', 'boneslam');
  ED.addHero({ id: 'necro', name: 'Necro', hp: 95, speed: 70, crit: 0.05, sig: 'boneshard', skills: ['bonewall'], icon: 'hero.necro.idle', col: '#b7a6e0', txt: 'Raises an army. The dead are fuel.' });

  // ---------------- corpses ----------------
  const corpses = (p) => { if (!p.corpse) { p.corpse = new Float64Array(CORPSES * 3).fill(-1); p.corpI = 0; } return p.corpse; };
  const addCorpse = (w, p, x, y) => { const Cp = corpses(p), i = p.corpI; Cp[i * 3] = x; Cp[i * 3 + 1] = y; Cp[i * 3 + 2] = w.time; p.corpI = (i + 1) % CORPSES; };
  // Freshest unused corpse within d px of hero p and inside its view: consumes it, sets CX / CY, returns true.
  let CX = 0, CY = 0;
  const takeCorpse = (w, p, d) => {
    const Cp = corpses(p), now = w.time, d2 = d * d;
    for (let j = 0; j < CORPSES; j++) {
      const i = ((p.corpI - 1 - j) % CORPSES + CORPSES) % CORPSES, t = Cp[i * 3 + 2];
      if (t < 0) continue;
      if (now - t > CORPSE_AGE) break;
      const x = Cp[i * 3], y = Cp[i * 3 + 1];
      if (U.dist2(x, y, p.x, p.y) > d2 || !ED.inView(p, x, y, 0)) continue;
      Cp[i * 3 + 2] = -1; CX = x; CY = y;
      return true;
    }
    return false;
  };

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
  const ROOTS = { boneshard: 1, bonestorm: 1, bonelord: 1, plaguefield: 1, lich: 1, ossuary: 1 };
  const sigSlot = (p) => { for (let i = 0; i < p.weapons.length; i++) if (ROOTS[p.weapons[i].id]) return i; return -1; };
  const MHIT = { knock: 70, noEv: true, kind: 'minion' }, KHIT = { knock: 200, noEv: true, kind: 'minion', stun: 0.3 };
  const SLAM = { knock: 260, noEv: true, kind: 'minion', stun: 0.4 }, GBOOM = { knock: 180, kind: 'minion', look: 'ghoul' };
  const ASHOT = { look: 'bone', speed: 300, dmg: 0, pierce: 2, r: 6, life: 0.75, homing: 2.5, knock: 30 };
  const VZ = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0.3, look: 'boneslam' };
  // Visual-only zone (no damage): look at (x, y), radius r, dur s.
  const vfx = (w, p, wid, look, x, y, r, dur) => { VZ.p = p; VZ.wid = wid; VZ.look = look; VZ.x = x; VZ.y = y; VZ.r = r; VZ.dur = dur; w.zone(VZ); };
  // Ghoul burst: blast (radius s.gr) + a blight pool when the holder's weapon spills pools.
  const ghoulBurst = (w, z) => {
    const s = z.st, p = s.p;
    w.blast(p, z.wid, z.x, z.y - 4, s.gr, s.dmg, GBOOM);
    const i = sigSlot(p);
    if (i >= 0) { const S = w.weaponS(p, i); if (S.pools > 0 || S.spread) spill(w, p, z.wid, S, z.x, z.y, 0.8); }
  };
  const ghoulEnd = (w, z) => { const t = z.st.tgt; if (w.alive(z.st.p) && t && !t.dead && t.id === z.st.tid) ghoulBurst(w, z); }; // expiry: bursts only while chasing a foe
  const minTick = (w, z) => {
    const s = z.st, p = s.p, K = s.kind;
    if (z.w > 0) z.w = Math.max(0, z.w - TICK * 4);
    s.cd -= TICK; s.rt -= TICK;
    const far = p.dead || U.dist2(z.x, z.y, p.x, p.y) > LEASH * LEASH;
    let e = s.tgt;
    if (far) e = null;
    else if (!e || e.dead || e.id !== s.tid || s.rt <= 0) { e = w.nearestFoe(z.x, z.y, K === 2 ? 170 : 150); s.rt = 0.3; }
    s.tgt = e; s.tid = e ? e.id : 0;
    let tx, ty, sp = s.spd;
    if (e) { tx = e.x; ty = e.y; }
    else { const a = s.slot * 2.4 + w.time * 0.6; tx = p.x + Math.cos(a) * 34; ty = p.y + Math.sin(a) * 24; if (far) sp *= 1.7; }
    const dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy);
    if (d > 0.5) z.a = Math.atan2(dy, dx);
    if (K === 2) { // archer: holds 60-110 px from its target, looses shards
      let mv = 0;
      if (!e) mv = d > 6 ? 1 : 0; else if (d > 110) mv = 1; else if (d < 60) mv = -0.7;
      if (mv && d > 0.5) { const st = Math.min(Math.abs(d - 85) + 1, sp * TICK) * mv; ED.Arena.move(w.arena, z, dx / d * st, dy / d * st, z.r); }
      if (e && d <= 170 && s.cd <= 0) {
        s.cd = s.acd; z.w = 1;
        ASHOT.dmg = s.dmg; ASHOT.pierce = s.pierce;
        for (let i = 0; i < s.vol; i++) w.shoot(p, z.wid, z.x, z.y - 6, z.a + (i - (s.vol - 1) / 2) * 0.18, null, ASHOT);
      }
      return;
    }
    const reach = e ? z.r + e.r + (K === 3 ? 2 : 6) : 6;
    if (d > reach) { const st = Math.min(d - reach + 1, sp * TICK); ED.Arena.move(w.arena, z, dx / d * st, dy / d * st, z.r); }
    if (K === 3) { if (e && d <= reach + 4) { ghoulBurst(w, z); z.onEnd = null; z.dead = true; } return; } // ghoul: bursts on contact
    if (e && d <= reach + 8 && s.cd <= 0) {
      const big = K === 1;
      s.cd = big ? 0.85 : 0.6; z.w = 1; s.sw++;
      w.arc(p, z.wid, z.x, z.y - 4, z.a, z.r + (big ? 24 : 18), s.arc, s.dmg, big ? KHIT : MHIT);
      if (big && s.slam > 0 && s.sw % s.slam === 0) {
        const r = 50 * s.area;
        w.blast(p, z.wid, z.x, z.y, r, s.dmg * 2.8, SLAM);
        vfx(w, p, z.wid, 'boneslam', z.x, z.y, r, 0.35);
      }
    }
  };
  // Raises a minion of kind (0 skeleton, 1 Bone Knight, 2 archer, 3 ghoul; true = 1) at (x, y) credited to wid, hit damage dmg (default from the holder's weapon), life s.
  // S: the holder's weapon numbers (arc, slam, archer volley, ghoul radius). Over HARD_CAP the oldest falls. Returns the zone.
  const MZ = { team: 0, p: null, wid: '', x: 0, y: 0, r: 7, a: 0, w: 0, dur: 10, look: 'minion', st: null, onTick: minTick, onEnd: null };
  const raise = (w, p, x, y, wid, kind, life, dmg) => {
    const K = kind === true ? 1 : kind | 0, i = sigSlot(p), S = i >= 0 ? w.weaponS(p, i) : null;
    if (liveMinions(p) >= HARD_CAP) { p.minions[0].dead = true; p.minions.shift(); p.minIds.shift(); }
    MZ.p = p; MZ.wid = wid; MZ.x = x; MZ.y = y; MZ.r = K === 1 ? 11 : 7; MZ.a = U.angle(x, y, p.x, p.y); MZ.w = 0; MZ.dur = life || 10; MZ.look = KLOOK[K];
    MZ.onEnd = K === 3 ? ghoulEnd : null;
    MZ.st = {
      p, kind: K, dmg: dmg !== undefined ? dmg : (S ? S.dmg * (S.mk || 1) : 10), spd: K === 1 ? 95 : K === 3 ? 140 : 115, cd: 0.4, rt: 0, tgt: null, tid: 0, slot: p.minSlot++,
      arc: Math.min(TAU, S ? S.marc || 2.8 : 2.8), sw: 0, slam: S ? S.slam | 0 : 0, area: S ? S.area : 1, acd: S ? S.acd || 0.9 : 0.9, vol: Math.max(1, S ? S.avol | 0 : 1),
      pierce: S ? S.apierce | 0 : 2, gr: (S ? S.gr || 34 : 34) * (S ? S.area : 1),
    };
    const z = w.zone(MZ);
    MZ.st = null;
    ED.Arena.collide(w.arena, z, z.r);
    p.minions.push(z); p.minIds.push(z.id);
    return z;
  };
  ED.Necro = { liveMinions, raise };

  // ---------------- blight pools ----------------
  const livePools = (p) => {
    if (!p.pools) { p.pools = []; p.poolIds = []; }
    const M = p.pools, I = p.poolIds;
    let n = 0;
    for (let i = 0; i < M.length; i++) { const z = M[i]; if (!z.dead && z.id === I[i]) { M[n] = z; I[n] = I[i]; n++; } }
    M.length = I.length = n;
    return n;
  };
  const SLOWP = [0.3, 0.6], PBURST = { knock: 90, look: 'blight', slow: SLOWP };
  const poolEnd = (w, z) => { if (z.dmg > 0 && z.p && w.alive(z.p)) w.blast(z.p, z.wid, z.x, z.y, z.r * 1.15, z.dmg, PBURST); };
  const PZ = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 3, dps: 0, tick: 0.5, slow: SLOWP, look: 'blight', onEnd: poolEnd, dmg: 0 };
  // Blight pool of weapon numbers S at (x, y), radius 22 x area x (1 + parea) x k, S.pdur s. False at POOL_CAP.
  const spill = (w, p, wid, S, x, y, k) => {
    if (livePools(p) >= POOL_CAP) return false;
    PZ.p = p; PZ.wid = wid; PZ.x = x; PZ.y = y; PZ.r = 22 * S.area * (1 + (S.parea || 0)) * (k || 1); PZ.dur = S.pdur || 3; PZ.dps = S.dmg * (S.pk || 1);
    PZ.look = S.spread ? 'plague' : 'blight'; PZ.dmg = S.pburst ? S.dmg * 0.8 : 0;
    const z = w.zone(PZ);
    z.dmg = PZ.dmg; // non-warn zone: z.dmg holds the dry-up burst (poolEnd)
    p.pools.push(z); p.poolIds.push(z.id);
    return true;
  };
  // True when (x, y) lies inside one of p's pools (pool centre closer than f x its radius).
  const inPool = (p, x, y, f) => { const M = p.pools; if (!M) return false; for (let i = 0; i < M.length; i++) { const z = M[i]; if (!z.dead && U.dist2(x, y, z.x, z.y) <= z.r * z.r * f * f) return true; } return false; };

  // ---------------- Bone Shard ----------------
  // Splinters: a shard (pr.st = the weapon numbers) bursts into S.split splinters around its heading where it stops.
  const SPL = { look: 'bone', speed: 260, dmg: 0, pierce: 1, r: 3, life: 0.32, knock: 20 };
  const splitEnd = (w, pr) => {
    const S = pr.st, n = S ? S.split | 0 : 0;
    if (n <= 0 || !pr.p) return;
    SPL.dmg = pr.dmg * 0.5;
    for (let i = 0; i < n; i++) w.shoot(pr.p, pr.wid, pr.x, pr.y, pr.a + (i - (n - 1) / 2) * 0.9, null, SPL);
  };
  const SHARD = { look: 'bone', homing: 0, onEnd: null, st: null };
  // S.n shards (0.16 rad fan) along the cursor (w.aimDir).
  const shards = (w, p, ws, S) => {
    const a = w.aimDir(p), n = Math.max(1, S.n | 0);
    SHARD.homing = S.homing || 0; SHARD.st = S; SHARD.onEnd = S.split > 0 ? splitEnd : null;
    for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.16, S, SHARD);
    SHARD.st = null; SHARD.onEnd = null;
  };
  // Army upkeep: raises up to S.raise minions of kind S.kind while fewer than S.cap live (corpse first, else beside the holder); then S.pools pools on corpses
  // (else under the nearest foe within range).
  const army = (w, p, ws, S) => {
    const cap = Math.min(HARD_CAP, S.cap | 0);
    for (let k = S.raise | 0; k > 0 && liveMinions(p) < cap; k--) {
      let x, y;
      if (takeCorpse(w, p, RAISE_D)) { x = CX; y = CY; }
      else { const a = p.minSlot * 2.4; x = p.x + Math.cos(a) * 22; y = p.y + Math.sin(a) * 16; }
      raise(w, p, x, y, ws.id, S.kind | 0, S.life);
    }
    for (let k = S.pools | 0; k > 0; k--) {
      if (takeCorpse(w, p, S.range)) spill(w, p, ws.id, S, CX, CY, 1);
      else { PP = p; const t = w.nearestFoe(p.x, p.y, S.range, pooled); if (!t || !spill(w, p, ws.id, S, t.x, t.y, 1)) break; }
    }
  };
  let PP = null;
  const pooled = (e) => inPool(PP, e.x, e.y, 0.8); // nearestFoe skip: foes already standing in a pool of PP
  // Kill callback (every root and Form): records the corpse; kill-rise extras (S.rise chance, up to cap + S.over, 6 s); Plague Field spread.
  const onKill = (w, p, ws, S, e) => {
    addCorpse(w, p, e.x, e.y);
    if (e.boss) return;
    if (S.rise > 0 && w.rng.next() < S.rise && liveMinions(p) < Math.min(HARD_CAP, (S.cap | 0) + (S.over | 0))) raise(w, p, e.x, e.y, ws.id, S.kind | 0, 6);
    if (S.spread && inPool(p, e.x, e.y, 1) && !inPool(p, e.x, e.y, 0.6)) spill(w, p, ws.id, S, e.x, e.y, 0.85);
  };
  // Shared numbers: army (cap, raise, kind, life, mk minion damage factor, marc swing arc, rise / over), pools (pools per volley, pk dps factor, parea, pdur, pburst), split, homing.
  const ARMY = { cap: 3, raise: 1, kind: 0, life: 10, mk: 0.65, marc: 2.8, rise: 0, over: 0, pools: 0, pk: 0.3, parea: 0, pdur: 3, pburst: 0, split: 0, homing: 0 };
  const base = (o) => Object.assign({}, ARMY, o);
  const SHOT = { fire(w, p, ws, S) { shards(w, p, ws, S); army(w, p, ws, S); return true; }, kill: onKill };
  ED.addWeapon({
    id: 'boneshard', name: 'Bone Shard', icon: 'weapon.bonewand', look: 'bone', sig: 'necro', mode: 'cursor', txt: 'Shards pierce; the dead rise to serve',
    base: base({ dmg: 12, cd: 1.0, n: 1, pierce: 3, area: 1, speed: 280, dur: 0, knock: 20, range: 220 }),
    paths: [
      { id: 'legion', name: 'Legion', form: 'bonelord', ranks: [
        { mods: { cap: 2, raise: 1 }, txt: '+2 skeletons, raised two at a time' },
        { mods: { rise: 0.15, over: 4 }, txt: 'The slain rise as extra skeletons' },
        { mods: { marc: 1.2, dmg: 0.25 }, txt: 'Skeletons cleave wider, +25% damage' }] },
      { id: 'shards', name: 'Shards', form: 'bonestorm', ranks: [
        { mods: { n: 2 }, txt: '+2 bone shards' },
        { mods: { split: 3 }, txt: 'Shards burst into 3 splinters' },
        { mods: { n: 1, homing: 3, dmg: 0.25 }, txt: '+1 shard, shards seek foes, +25% dmg' }] },
      { id: 'plague', name: 'Plague', form: 'plaguefield', ranks: [
        { mods: { pools: 1 }, txt: 'The dead rot into blight pools' },
        { mods: { pools: 1, parea: 0.25 }, txt: '+1 pool, pools spread wider' },
        { mods: { pburst: 1, dmg: 0.25 }, txt: 'Pools burst as they dry, +25% dmg' }] },
    ],
    hybrids: [{ need: [0, 2], form: 'lich' }, { need: [0, 1], form: 'ossuary' }],
  }, SHOT);
  // Bone Storm: S.n shards orbit the hero (radius 30, S.orbit s, re-hitting foes they touch at ORB_K x damage), then launch along the cursor dir (full damage, homing after); they split as Bone Shard.
  const ORB_K = 0.3;
  const orbitTick = (w, pr) => {
    const s = pr.st, p = pr.p;
    if (s.go) return;
    if (pr.t < s.T && w.alive(p)) {
      const a = s.a0 + pr.t * 7;
      pr.x = p.x + Math.cos(a) * 30; pr.y = p.y - 6 + Math.sin(a) * 30; pr.vx = -Math.sin(a) * 1e-3; pr.vy = Math.cos(a) * 1e-3;
      return;
    }
    s.go = true;
    const a = w.aimDir(p);
    pr.vx = Math.cos(a) * pr.sp; pr.vy = Math.sin(a) * pr.sp; pr.hits.length = 0; pr.rehit = 0; pr.pierce = s.pierce; pr.homing = 2.5; pr.dmg = s.dmg;
    pr.life = s.range / pr.sp;
  };
  const stormEnd = (w, pr) => { const s = pr.st; if (s && s.split > 0 && s.go && pr.p) { SPL.dmg = pr.dmg * 0.5; for (let i = 0; i < s.split; i++) w.shoot(pr.p, pr.wid, pr.x, pr.y, pr.a + (i - (s.split - 1) / 2) * 0.9, null, SPL); } };
  const STORM = { look: 'bone', pierce: 999, rehit: 0.25, life: 1, tick: orbitTick, onEnd: stormEnd, st: null };
  ED.addWeapon({
    id: 'bonestorm', name: 'Bone Storm', icon: 'weapon.soulscythe', look: 'bone', sig: 'necro', mode: 'around', evolved: true, form: true, from: 'boneshard', txt: 'Shards orbit, then launch',
    base: base({ dmg: 7, cd: 0.9, n: 6, pierce: 4, area: 1.2, speed: 320, dur: 0, knock: 80, range: 230, orbit: 1.0 }),
    refine: [
      { mods: { n: 2 }, txt: '+2 orbiting shards' },
      { mods: { dmg: 0.25, pierce: 2 }, txt: '+25% damage, pierce 2 more' },
    ],
  }, {
    fire(w, p, ws, S) {
      const n = Math.max(1, S.n | 0), a0 = w.time * 3;
      STORM.life = S.orbit + 2;
      for (let i = 0; i < n; i++) {
        STORM.st = { a0: a0 + i / n * TAU, T: S.orbit + i * 0.04, range: S.range, pierce: S.pierce, split: S.split | 0, go: false, dmg: S.dmg };
        w.shoot(p, ws.id, p.x, p.y - 6, 0, S, STORM).dmg = S.dmg * ORB_K;
      }
      STORM.st = null;
      army(w, p, ws, S);
      return true;
    },
    kill: onKill,
  });
  // Bone Lord: the army rises as Bone Knights (wide stunning cleave, a ground slam every S.slam-th swing); shards as Bone Shard.
  ED.addWeapon({
    id: 'bonelord', name: 'Bone Lord', icon: 'weapon.alt.waraxe', look: 'bone', sig: 'necro', mode: 'cursor', evolved: true, form: true, from: 'boneshard', txt: 'Your dead rise as Bone Knights',
    base: base({ dmg: 16, cd: 1.0, n: 1, pierce: 3, area: 1, speed: 280, dur: 0, knock: 20, range: 220, cap: 4, raise: 1, kind: 1, life: 12, mk: 0.6, marc: 3.0, slam: 3 }),
    refine: [
      { mods: { cap: 2 }, txt: '+2 Bone Knights' },
      { mods: { slam: -1, dmg: 0.25 }, txt: 'Knights slam more often, +25% damage' },
    ],
  }, SHOT);
  // Plague Field: lobs S.n blight globs at the densest foes (the first on the cluster, the rest around it; no foe: 90 px out along the cursor dir); pools slow, foes dying in a pool seed a new one; the army as Bone Shard.
  const globEnd = (w, pr) => { if (pr.p && w.alive(pr.p)) { const i = sigSlot(pr.p); if (i >= 0) spill(w, pr.p, pr.wid, w.weaponS(pr.p, i), pr.x, pr.y, 1); } };
  const GLOB = { look: 'glob', speed: 0, dmg: 0, pierce: 999, r: 3, life: 1, knock: 0, onEnd: globEnd };
  ED.addWeapon({
    id: 'plaguefield', name: 'Plague Field', icon: 'weapon.plaguestaff', look: 'glob', sig: 'necro', mode: 'densest', evolved: true, form: true, from: 'boneshard', txt: 'Blight leaps from foe to foe',
    base: base({ dmg: 16, cd: 1.0, n: 2, pierce: 0, area: 1, speed: 220, dur: 0, knock: 0, range: 220, pk: 1.35, parea: 0.2, pdur: 3.5, spread: 1 }),
    refine: [
      { mods: { n: 1, parea: 0.3 }, txt: '+1 glob, pools grow larger' },
      { mods: { dmg: 0.25, pdur: 1.5 }, txt: '+25% damage, pools last longer' },
    ],
  }, {
    fire(w, p, ws, S) {
      const pt = w.target('densest', p, S.range), n = Math.max(1, S.n | 0);
      let cx, cy;
      if (pt) { cx = pt.x; cy = pt.y; } else { const a = w.aimDir(p); cx = p.x + Math.cos(a) * 90; cy = p.y + Math.sin(a) * 90; }
      for (let i = 0; i < n; i++) {
        const a = i ? w.rng.next() * TAU : 0, d = i ? 26 + 14 * i : 0, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const D = Math.hypot(x - p.x, y - p.y + 6);
        GLOB.speed = S.speed; GLOB.life = Math.max(0.12, D / S.speed);
        w.shoot(p, ws.id, p.x, p.y - 6, Math.atan2(y - p.y + 6, x - p.x), S, GLOB);
      }
      army(w, p, ws, S);
      return true;
    },
    kill: onKill,
  });
  // Lich: the army rises as plague ghouls that rush foes and burst (blast S.gr, damage S.dmg x S.mk), leaving a blight pool; shards as Bone Shard.
  ED.addWeapon({
    id: 'lich', name: 'Lich', icon: 'weapon.soulscythe', look: 'bone', sig: 'necro', mode: 'cursor', evolved: true, form: true, from: 'boneshard', txt: 'The dead rise as bursting ghouls',
    base: base({ dmg: 16, cd: 1.0, n: 1, pierce: 3, area: 1, speed: 280, dur: 0, knock: 20, range: 220, cap: 5, raise: 2, kind: 3, life: 5, mk: 1.15, gr: 34 }),
    refine: [
      { mods: { cap: 2, raise: 1 }, txt: '+2 ghouls, raised faster' },
      { mods: { dmg: 0.25, gr: 10 }, txt: '+25% damage, bigger bursts' },
    ],
  }, SHOT);
  // Ossuary: the army rises as skeleton archers (keep 60-110 px off, loose S.avol homing shards every S.acd s that split as Bone Shard); shards as Bone Shard.
  ED.addWeapon({
    id: 'ossuary', name: 'Ossuary', icon: 'weapon.bonewand', look: 'bone', sig: 'necro', mode: 'cursor', evolved: true, form: true, from: 'boneshard', txt: 'Your army takes up bows of bone',
    base: base({ dmg: 14, cd: 1.0, n: 1, pierce: 3, area: 1, speed: 280, dur: 0, knock: 20, range: 220, cap: 4, raise: 2, kind: 2, life: 12, mk: 0.55, acd: 0.6, avol: 1, apierce: 9 }),
    refine: [
      { mods: { cap: 2 }, txt: '+2 skeleton archers' },
      { mods: { avol: 1, dmg: 0.25 }, txt: 'Archers loose 2 shards, +25% damage' },
    ],
  }, SHOT);

  // ---------------- Q: Bone Wall ----------------
  // Zero damage. A curved bone wall at the cursor for N.dur s that non-boss foes cannot cross (W.blockZone): an arc N.len px long on a circle of radius ARC_R centred ARC_R px from the
  // cursor toward the hero (its middle sits on the cursor, square to the hero-cursor line, ends curving toward the hero). ring (L3): a full ring of radius N.ring around the cursor instead.
  // taunt (L4): non-boss foes within N.taunt px of the wall walk to it and hold there (st.lure). Zone 'bonewall' (circle x, y, r; arc 0 = full ring, else span around a; w = thickness).
  const ARC_R = 120, WALL_W = 16;
  ED.addSkill({
    id: 'bonewall', name: 'Bone Wall', icon: 'prop.bonepile', cd: 12, txt: 'A bone wall the horde cannot cross',
    base: { len: 140, dur: 5, ring: 0, taunt: 0 },
    levels: [
      { mods: { len: 60 }, txt: 'A longer wall' },
      { mods: { ring: 80 }, txt: 'The wall closes into a ring' },
      { mods: { taunt: 160 }, txt: 'Nearby foes target the wall' },
    ],
  }, (w, p, x, y, N) => {
    const a = Math.hypot(x - p.x, y - p.y) < 1 ? p.mdir : Math.atan2(y - p.y, x - p.x), st = { out: false, lure: N.taunt || 0, lt: 0 };
    if (N.ring > 0) w.zone({ team: 0, p, wid: 'bonewall', x, y, r: N.ring, w: WALL_W, arc: 0, a, dur: N.dur, look: 'bonewall', st, onTick: ED.blockTick });
    else w.zone({ team: 0, p, wid: 'bonewall', x: x - Math.cos(a) * ARC_R, y: y - Math.sin(a) * ARC_R, r: ARC_R, w: WALL_W, arc: N.len / ARC_R, a, dur: N.dur, look: 'bonewall', st, onTick: ED.blockTick });
    return { shake: 5, stop: 0.05 };
  });
})(globalThis.ED || (globalThis.ED = {}));
