// Pyro: hero data, signature Fire Bolt (3 paths x 3 ranks: Blaze, Mortar, Combustion), Forms Inferno / Firestorm / Wildfire (pure) and Pyre / Napalm (hybrid), Q Flashpoint (3 skill levels).
// Role: area denial. Instant hits are weak; fire pools, burns and death blasts carry the damage. Every damage source credits the slot's current id (ws.id).
// Ground fire (pools 'firepool', pyres 'pyre', fire lines 'napalm') lives in ws.st.pools (ring of live zones, refs checked by id), at most POOL_MAX + S.pools per hero; a new one past the cap ends the oldest.
// Shared by the root and every Form (impl.tick / impl.kill): Mortar shells (S.shells, Forms with def.shellForm lob their own), death blasts of burning foes (S.combust) and fire leaps (S.spread).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const POOL_MAX = 12, INF_R = 95, DQ_MAX = 40, RANGE = 210, SHELL_RANGE = 220;

  ED.regLook('firepool', 'ember', 'shell', 'bomblet', 'pyre', 'napalm', 'seed', 'flash');
  ED.addHero({ id: 'pyro', name: 'Pyro', hp: 85, speed: 74, crit: 0.05, sig: 'firebolt', skills: ['flashpoint'], icon: 'hero.pyro.idle', col: '#ff8a3d', txt: 'Paints the ground with fire.' });

  // ---------------- ground fire ----------------
  // Live ground-fire list of a slot: ws.st.pools = [zone], ws.st.ids = [id]; returns the live count after dropping dead entries.
  const livePools = (ws) => {
    const P = ws.st.pools || (ws.st.pools = []), I = ws.st.ids || (ws.st.ids = []);
    let n = 0;
    for (let i = 0; i < P.length; i++) { const z = P[i]; if (!z.dead && z.id === I[i]) { P[n] = z; I[n] = I[i]; n++; } }
    P.length = I.length = n;
    return n;
  };
  // Live numbers of hero p's weapon (null without one).
  const liveS = (w, p) => (p && p.weapons[0] ? w.weaponS(p, 0) : null);
  // Pool burn of a slot: ws.st.pb = [dps, dur] shared by its pools (foes inside keep burning 1 s after leaving).
  const pburn = (ws, S) => { const b = ws.st.pb || (ws.st.pb = [0, 1]); b[0] = S.dmg * 0.15; return b; };
  // Flare (S.flare): ground fire ends in a blast (circle: 1.2 r; line: three blasts along it) for S.dmg x S.flare.
  const FLARE = { look: 'fire', burn: null, knock: 50 };
  const flareEnd = (w, z) => {
    const S = liveS(w, z.p); if (!S || !(S.flare > 0) || !z.p.weapons[0]) return;
    FLARE.burn = pburn(z.p.weapons[0], S);
    if (z.len > 0) { const c = Math.cos(z.a), s = Math.sin(z.a); for (let i = 0; i < 3; i++) { const d = z.len * (i + 0.5) / 3; w.blast(z.p, z.wid, z.x + c * d, z.y + s * d, z.w * 1.2, S.dmg * S.flare, FLARE); } }
    else w.blast(z.p, z.wid, z.x, z.y, z.r * 1.2, S.dmg * S.flare, FLARE);
  };
  // Adds ground-fire zone `opt` (filled by the caller) for slot ws; past the cap the oldest ends now (its flare still fires). Returns the zone.
  const ground = (w, ws, S, opt) => {
    const n = livePools(ws), P = ws.st.pools;
    if (n >= POOL_MAX + (S.pools | 0)) { const o = P[0]; o.dur = Math.min(o.dur, o.t); }
    opt.burn = pburn(ws, S);
    if (!opt.onEnd) opt.onEnd = S.flare > 0 ? flareEnd : null;
    const z = w.zone(opt);
    P.push(z); ws.st.ids.push(z.id);
    return z;
  };
  const POOL = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0, dps: 0, tick: 0.5, burn: null, look: 'firepool', st: null, onTick: null, onEnd: null };
  // Fire pool of radius r, dps for S.dur s.
  const pool = (w, p, ws, S, x, y, r, dps, st, onTick) => {
    POOL.p = p; POOL.wid = ws.id; POOL.x = x; POOL.y = y; POOL.r = r; POOL.dur = S.dur; POOL.dps = dps; POOL.st = st || null; POOL.onTick = onTick || null; POOL.onEnd = null; POOL.look = 'firepool';
    return ground(w, ws, S, POOL);
  };

  // ---------------- shells (Mortar) ----------------
  // A shell is a hero warn zone that lands after `flight` s; z.st = its damage; render: z.a = angle from the landing spot back to the launch point, z.w = launch distance.
  const ZS = { team: 0, warn: true, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0, dmg: 0, look: 'shell', a: 0, w: 0, st: 0, onEnd: null };
  const lob = (w, p, wid, fx, fy, x, y, r, flight, dmg, look, onEnd) => {
    ZS.p = p; ZS.wid = wid; ZS.x = x; ZS.y = y; ZS.r = r; ZS.dur = flight; ZS.look = look; ZS.st = dmg; ZS.onEnd = onEnd;
    ZS.a = Math.atan2(fy - y, fx - x); ZS.w = Math.hypot(fx - x, fy - y);
    return w.zone(ZS);
  };
  const SHB = { look: 'fire', burn: null, knock: 100 }, BMB = { look: 'fire', burn: null, knock: 40, noEv: true };
  // Bomblet: a small blast (no event: the client draws the landing) that sets foes burning.
  const bombEnd = (w, z) => { const S = liveS(w, z.p); if (!S) return; BMB.burn = burnOf(S, 0.3, 2); w.blast(z.p, z.wid, z.x, z.y, z.r, z.st, BMB); };
  // S.cluster bomblets scattered around (x, y) at half damage, 0.45 x radius.
  const bomblets = (w, p, wid, S, x, y, r, dmg) => {
    const nb = S.cluster | 0;
    for (let i = 0; i < nb; i++) {
      const a = i / nb * TAU + w.rng.next() * 0.8, d = r * (0.8 + 0.6 * w.rng.next());
      lob(w, p, wid, x, y, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.45, 0.22 + i * 0.05, dmg * 0.5, 'bomblet', bombEnd);
    }
  };
  // Shell landing: blast (S.dmg-scaled z.st, knockback, burn), a fire pool, bomblets.
  const shellEnd = (w, z) => {
    const p = z.p, ws = p && p.weapons[0], S = liveS(w, p); if (!S) return;
    SHB.burn = burnOf(S, 0.3, 2);
    w.blast(p, z.wid, z.x, z.y, z.r, z.st, SHB);
    pool(w, p, ws, S, z.x, z.y, z.r * 0.7, S.dmg * 0.45);
    bomblets(w, p, z.wid, S, z.x, z.y, z.r, z.st);
  };
  // Mortar emitter (root, Inferno, Wildfire, Pyre): every 2 x S.cd, S.shells shells (1.25 x dmg), the first on the densest cluster within SHELL_RANGE, the rest on random foes in view.
  const mortarTick = (w, p, ws, S, dt) => {
    const s = ws.st;
    s.mt = (s.mt === undefined ? 1 : s.mt) - dt;
    if (s.mt > 0) return;
    const t = w.target('densest', p, SHELL_RANGE);
    if (!t) { s.mt = 0.3; return; }
    s.mt = S.cd * 2;
    const tx = t.x, ty = t.y, n = S.shells | 0, r = 34 * S.area;
    for (let i = 0; i < n; i++) {
      let x = tx, y = ty;
      if (i > 0) { const e = w.target('random', p, SHELL_RANGE); if (e) { x = e.x; y = e.y; } else { const a = w.rng.next() * TAU; x += Math.cos(a) * 50; y += Math.sin(a) * 50; } }
      lob(w, p, ws.id, p.x, p.y - 10, x, y, r, 0.7 + i * 0.12, S.dmg * 1.25, 'shell', shellEnd);
    }
  };

  // ---------------- combustion ----------------
  const BURNS = [0, 0];
  // Shared burn pair [S.dmg x k, dur] (applied at once by the caller).
  const burnOf = (S, k, dur) => { BURNS[0] = S.dmg * k; BURNS[1] = dur; return BURNS; };
  // Death blasts: a foe its holder kills while burning queues a blast 0.12 s later at its spot (radius 26 x area, +12% per generation; S.dmg x 0.7 x S.bmul; burn), if the budget allows:
  // S.combust blasts per second (bucket ws.st.db, holds 1 s). S.cemb embers fly out of each. Kills during a blast queue generation g + 1 up to 1 + S.cgen. Queue ws.st.dq, at most DQ_MAX.
  let GEN = 0; // generation of the blast now resolving (kills during it queue GEN + 1)
  const DET = { look: 'fire', burn: null, knock: 0 };
  const LEAP = { look: 'ember', speed: 170, dmg: 0, pierce: 0, r: 4, life: 0.4, knock: 20, onHit: null };
  const EMB = { look: 'ember', speed: 190, dmg: 0, pierce: 1, r: 4, life: 0.4, knock: 0, onHit: null };
  const emberHit = (w, pr, e) => { if (!e.dead) w.burn(e, pr.dmg * 0.8, 2.5, pr.p); };
  LEAP.onHit = EMB.onHit = emberHit;
  const queueDet = (ws, x, y, g) => {
    const s = ws.st, Q = s.dq || (s.dq = []);
    s.dn = s.dn | 0;
    if (s.dn >= DQ_MAX) return;
    const o = Q[s.dn] || (Q[s.dn] = { x: 0, y: 0, t: 0, g: 0 });
    o.x = x; o.y = y; o.t = 0.12; o.g = g; s.dn++;
  };
  const detonate = (w, p, ws, S, x, y, g) => {
    DET.burn = burnOf(S, 0.3, 2);
    const was = GEN; GEN = g;
    w.blast(p, ws.id, x, y, 26 * S.area * (1 + 0.12 * g), S.dmg * 0.7 * (S.bmul || 1), DET);
    GEN = was;
    const m = S.cemb | 0;
    if (m > 0) { EMB.dmg = S.dmg * 0.35; const a0 = w.rng.next() * TAU; for (let i = 0; i < m; i++) w.shoot(p, ws.id, x, y, a0 + i / m * TAU, null, EMB); }
  };
  const detTick = (w, p, ws, S, dt) => {
    const s = ws.st, Q = s.dq; if (!Q) return;
    for (let i = 0; i < s.dn;) {
      const o = Q[i];
      o.t -= dt;
      if (o.t > 0) { i++; continue; }
      const x = o.x, y = o.y, g = o.g, last = Q[--s.dn];
      Q[s.dn] = o; Q[i] = last; // swap-remove (records kept for reuse)
      detonate(w, p, ws, S, x, y, g);
    }
  };
  // Fire leaps (S.spread): every 0.5 s, up to 4 + 4 x S.spread foes burning from this hero throw an ember at the nearest unburnt foe within 48 px.
  let LP = null;
  const skipLit = (f) => f.burnT > 0 || f === LP;
  const leapTick = (w, p, ws, S, dt) => {
    const s = ws.st;
    s.lt = (s.lt || 0) - dt;
    if (s.lt > 0) return;
    s.lt = 0.5;
    let m = 4 + 4 * (S.spread | 0);
    LEAP.dmg = S.dmg * 0.3;
    for (let i = 0; i < w.foes.length && m > 0; i++) {
      const e = w.foes[i];
      if (e.dead || !(e.burnT > 0) || e.burnOwner !== p || !ED.inView(p, e.x, e.y, 0)) continue;
      LP = e;
      const f = w.nearestFoe(e.x, e.y, 48, skipLit);
      if (!f) continue;
      m--;
      w.shoot(p, ws.id, e.x, e.y, Math.atan2(f.y - e.y, f.x - e.x), null, LEAP).hits.push(e.id);
    }
    LP = null;
  };
  const common = {
    tick(w, p, ws, S, dt) {
      if (S.shells > 0 && !ED.WEAPONS[ws.id].shellForm) mortarTick(w, p, ws, S, dt);
      if (S.combust > 0) { const s = ws.st; s.db = Math.min(S.combust, (s.db || 0) + S.combust * dt); detTick(w, p, ws, S, dt); }
      if (S.spread > 0) leapTick(w, p, ws, S, dt);
    },
    kill(w, p, ws, S, e) {
      const s = ws.st;
      if (S.combust > 0 && e.burnT > 0 && GEN <= (S.cgen | 0) && s.db >= 1) { s.db--; queueDet(ws, e.x, e.y, GEN + 1); }
    },
  };
  const impl = (fire) => ({ fire, tick: common.tick, kill: common.kill });

  // ---------------- Fire Bolt ----------------
  // S.n bolts (0.25 rad fan) along the cursor (w.aimDir). A bolt bursts at the first foe it hits, or where it lands: a blast (20 px x area, half damage, burn)
  // and a fire pool (22 px x area, 0.45 x dmg per second, S.dur s). Later hits of a piercing bolt only blast.
  const BURST = { look: 'fire', burn: null, knock: 40 };
  const burst = (w, pr, x, y, pooled) => {
    const ws = pr.st, S = ws && ws.S; if (!S) return;
    BURST.burn = burnOf(S, 0.3, 2);
    w.blast(pr.p, pr.wid, x, y, 20 * S.area, S.dmg * 0.5, BURST);
    if (pooled) pool(w, pr.p, ws, S, x, y, 22 * S.area, S.dmg * 0.45);
  };
  const boltHit = (w, pr, e) => { burst(w, pr, e.x, e.y, !pr.lit); pr.lit = true; };
  const boltEnd = (w, pr) => { if (!pr.lit) burst(w, pr, pr.x, pr.y, true); };
  const BOLT = { look: 'fireball', onHit: boltHit, onEnd: boltEnd, st: null };
  // Fires S.n projectiles `opt` (st = ws) in a fan of `spread` rad along the cursor. Each projectile gets lit = false.
  const fan = (w, p, ws, S, opt, spread) => {
    const a = w.aimDir(p), n = Math.max(1, S.n | 0);
    opt.st = ws;
    for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * spread, S, opt).lit = false;
    return true;
  };
  ED.addWeapon({
    id: 'firebolt', name: 'Fire Bolt', icon: 'weapon.firestaff', look: 'fireball', sig: 'pyro', mode: 'cursor', txt: 'Bolt that leaves a fire pool',
    base: { dmg: 12, cd: 1.2, n: 1, pierce: 0, area: 1, speed: 230, dur: 2.5, knock: 20, range: RANGE, pools: 0, flare: 0, shells: 0, cluster: 0, combust: 0, cemb: 0, spread: 0, cgen: 1 },
    paths: [
      { id: 'blaze', name: 'Blaze', form: 'inferno', ranks: [
        { mods: { area: 0.3 }, txt: 'Fire bursts and pools 30% wider' },
        { mods: { dur: 0.6, pools: 4 }, txt: 'Fire pools last 60% longer' },
        { mods: { flare: 0.8, dmg: 0.2 }, txt: 'Pools flare as they die, +20% damage' }] },
      { id: 'mortar', name: 'Mortar', form: 'firestorm', ranks: [
        { mods: { shells: 1 }, txt: 'Lobs a shell at the thickest crowd' },
        { mods: { shells: 1 }, txt: '+1 shell' },
        { mods: { cluster: 4 }, txt: 'Shells scatter 4 burning bomblets' }] },
      { id: 'combust', name: 'Combustion', form: 'wildfire', ranks: [
        { mods: { combust: 3 }, txt: 'Burning foes explode when they die' },
        { mods: { cemb: 3 }, txt: 'Death blasts fling 3 burning embers' },
        { mods: { spread: 1, dmg: 0.1 }, txt: 'Fire leaps between foes, +10% damage' }] },
    ],
    hybrids: [{ need: [0, 2], form: 'pyre' }, { need: [0, 1], form: 'napalm' }],
  }, impl((w, p, ws, S) => fan(w, p, ws, S, BOLT, 0.25)));

  // ---------------- Inferno (Blaze) ----------------
  // Bolts burst as Fire Bolt; a new pool touching a live pool merges into it (grows to INF_R at most, timer refreshed); each pool spreads once, after 1 s,
  // a 0.75 x pool toward the nearest foe outside it (two generations).
  const infTick = (w, z) => {
    const s = z.st, ws = s.ws, S = ws.S;
    if (s.spread || s.gen >= 2 || z.t < 1 || !S || ws.id !== z.wid) return;
    s.spread = true;
    const e = w.nearestFoe(z.x, z.y, z.r + 90, (f) => U.dist2(f.x, f.y, z.x, z.y) < z.r * z.r);
    if (!e) return;
    const a = Math.atan2(e.y - z.y, e.x - z.x), r = Math.max(14, z.r * 0.75);
    pool(w, s.p, ws, S, z.x + Math.cos(a) * (z.r + r * 0.6), z.y + Math.sin(a) * (z.r + r * 0.6), r, z.dps, { p: s.p, ws, gen: s.gen + 1, spread: false }, infTick);
  };
  const infHit = (w, pr, e) => {
    const ws = pr.st, S = ws && ws.S; if (!S) return;
    const p = pr.p, x = e.x, y = e.y, r = 24 * S.area;
    BURST.burn = burnOf(S, 0.35, 2.5);
    w.blast(p, pr.wid, x, y, r, S.dmg * 0.5, BURST);
    if (pr.lit) return;
    pr.lit = true;
    const n = livePools(ws), P = ws.st.pools;
    let hit = null;
    for (let i = 0; i < n; i++) { const z = P[i]; if (z.len === 0 && U.dist2(x, y, z.x, z.y) <= (z.r + r * 0.8) ** 2) { hit = z; break; } }
    if (hit) {
      hit.x += (x - hit.x) * 0.15; hit.y += (y - hit.y) * 0.15; hit.r = Math.min(INF_R * Math.sqrt(S.area / 1.5), Math.sqrt(hit.r * hit.r + r * r * 0.35)); hit.dur = hit.t + S.dur;
    } else pool(w, p, ws, S, x, y, r, S.dmg * 0.5, { p, ws, gen: 0, spread: false }, infTick);
  };
  const infEnd = (w, pr) => { if (!pr.lit) { const ws = pr.st, S = ws && ws.S; if (S) { pr.lit = true; pool(w, pr.p, ws, S, pr.x, pr.y, 24 * S.area, S.dmg * 0.5, { p: pr.p, ws, gen: 0, spread: false }, infTick); } } };
  const IBOLT = { look: 'fireball', onHit: infHit, onEnd: infEnd, st: null };
  ED.addWeapon({
    id: 'inferno', name: 'Inferno', icon: 'weapon.inferno', look: 'fireball', sig: 'pyro', mode: 'cursor', evolved: true, form: true, from: 'firebolt', txt: 'Pools merge and spread',
    base: { dmg: 16, cd: 1.0, n: 3, pierce: 1, area: 1.5, speed: 250, dur: 3.5, knock: 30, range: RANGE, pools: 8, flare: 0, shells: 0, cluster: 0, combust: 0, cemb: 0, spread: 0, cgen: 1 },
    refine: [
      { mods: { n: 1 }, txt: '+1 bolt' },
      { mods: { area: 0.25, dur: 0.3 }, txt: '+25% pool size, last 30% longer' },
    ],
  }, impl((w, p, ws, S) => fan(w, p, ws, S, IBOLT, 0.18)));

  // ---------------- Firestorm (Mortar) ----------------
  // A walking salvo: S.n + S.shells shells land in a line across the densest cluster within SHELL_RANGE along the line of fire (26 px x area apart, 0.08 s apart);
  // each blasts, leaves a fire pool and scatters S.cluster bomblets. No foe: the salvo walks 120 px out along the cursor dir.
  ED.addWeapon({
    id: 'firestorm', name: 'Firestorm', icon: 'weapon.inferno', look: 'shell', sig: 'pyro', mode: 'densest', evolved: true, form: true, from: 'firebolt', shellForm: true, txt: 'A walking salvo of shells',
    base: { dmg: 24, cd: 1.6, n: 3, pierce: 0, area: 1.2, speed: 0, dur: 2.5, knock: 100, range: SHELL_RANGE, pools: 0, flare: 0, shells: 0, cluster: 0, combust: 0, cemb: 0, spread: 0, cgen: 1 },
    refine: [
      { mods: { n: 2 }, txt: '+2 shells per salvo' },
      { mods: { area: 0.25, cluster: 2 }, txt: 'Blasts 25% wider, +2 bomblets' },
    ],
  }, impl((w, p, ws, S) => {
    const t = w.target('densest', p, S.range);
    let tx, ty;
    if (t) { tx = t.x; ty = t.y; } else { const a = w.aimDir(p); tx = p.x + Math.cos(a) * 120; ty = p.y + Math.sin(a) * 120; }
    const a = Math.atan2(ty - p.y, tx - p.x), c = Math.cos(a), s = Math.sin(a), n = Math.max(1, (S.n | 0) + (S.shells | 0)), step = 26 * S.area, r = 34 * S.area;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * step;
      lob(w, p, ws.id, p.x, p.y - 10, tx + c * o, ty + s * o, r, 0.55 + i * 0.08, S.dmg, 'shell', shellEnd);
    }
    return true;
  }));

  // ---------------- Wildfire (Combustion) ----------------
  // S.n homing seeds launched along the cursor; a seed hit blasts (20 px x area, 0.75 x dmg), sets a heavy burn (0.6 x dmg per second, 3 s) and splits into 3 sparks
  // (a 1.2 rad fan along its heading, 0.4 x dmg, burn). Death blasts: budget 5 / s (+ path), 1.4x damage, chains four generations deep.
  const SPARK = { look: 'ember', speed: 200, dmg: 0, pierce: 1, r: 5, life: 0.45, knock: 20, onHit: emberHit };
  const SEEDB = { look: 'fire', burn: null, knock: 30 };
  const seedHit = (w, pr, e) => {
    const ws = pr.st, S = ws && ws.S; if (!S) return;
    SEEDB.burn = burnOf(S, 0.6, 3);
    w.blast(pr.p, pr.wid, e.x, e.y, 20 * S.area, S.dmg * 0.75, SEEDB);
    SPARK.dmg = S.dmg * 0.4;
    for (let i = 0; i < 3; i++) w.shoot(pr.p, pr.wid, e.x, e.y, pr.a + (i - 1) * 0.6, null, SPARK).hits.push(e.id);
  };
  const SEED = { look: 'seed', homing: 4, onHit: seedHit, st: null };
  ED.addWeapon({
    id: 'wildfire', name: 'Wildfire', icon: 'weapon.inferno', look: 'seed', sig: 'pyro', mode: 'cursor', evolved: true, form: true, from: 'firebolt', txt: 'Fire that jumps from foe to foe',
    base: { dmg: 16, cd: 1.0, n: 3, pierce: 0, area: 1.2, speed: 240, dur: 2.5, knock: 20, range: RANGE, pools: 0, flare: 0, shells: 0, cluster: 0, combust: 5, cemb: 2, spread: 0, cgen: 3, bmul: 1.4 },
    refine: [
      { mods: { n: 1, cemb: 1 }, txt: '+1 seed, +1 ember per blast' },
      { mods: { area: 0.3, spread: 1 }, txt: 'Blasts 30% wider, fire leaps more' },
    ],
  }, impl((w, p, ws, S) => fan(w, p, ws, S, SEED, 0.3)));

  // ---------------- Pyre (Blaze + Combustion) ----------------
  // Bolts plant pyres (26 px x area, smoulder 0.15 x dmg per second) that erupt after 1.2 s: a blast (1.4 x radius, dmg x (1 + S.flare / 2), burn) that leaves a 0.7 x fire pool.
  const ERUPT = { look: 'fire', burn: null, knock: 120 };
  const pyreEnd = (w, z) => {
    const p = z.p, ws = p && p.weapons[0], S = liveS(w, p); if (!S) return;
    ERUPT.burn = burnOf(S, 0.4, 3);
    w.blast(p, z.wid, z.x, z.y, z.r * 1.4, S.dmg * 1.0 * (1 + (S.flare || 0) / 2), ERUPT);
    pool(w, p, ws, S, z.x, z.y, z.r * 0.7, S.dmg * 0.45);
  };
  const PYRE = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 1.2, dps: 0, tick: 0.5, burn: null, look: 'pyre', onEnd: pyreEnd };
  const plant = (w, pr, x, y) => {
    const ws = pr.st, S = ws && ws.S; if (!S || pr.lit) return;
    pr.lit = true;
    PYRE.p = pr.p; PYRE.wid = pr.wid; PYRE.x = x; PYRE.y = y; PYRE.r = 26 * S.area; PYRE.dps = S.dmg * 0.15; PYRE.onEnd = pyreEnd;
    ground(w, ws, S, PYRE);
  };
  const PBOLT = { look: 'fireball', onHit: (w, pr, e) => plant(w, pr, e.x, e.y), onEnd: (w, pr) => plant(w, pr, pr.x, pr.y), st: null };
  ED.addWeapon({
    id: 'pyre', name: 'Pyre', icon: 'weapon.inferno', look: 'fireball', sig: 'pyro', mode: 'cursor', evolved: true, form: true, from: 'firebolt', txt: 'Fire that gathers, then erupts',
    base: { dmg: 14, cd: 1.1, n: 2, pierce: 0, area: 1.3, speed: 230, dur: 2.5, knock: 20, range: RANGE, pools: 6, flare: 0, shells: 0, cluster: 0, combust: 0, cemb: 0, spread: 0, cgen: 1 },
    refine: [
      { mods: { n: 1 }, txt: '+1 bolt' },
      { mods: { area: 0.3, cemb: 2 }, txt: 'Eruptions 30% wider, +2 embers' },
    ],
  }, impl((w, p, ws, S) => fan(w, p, ws, S, PBOLT, 0.45)));

  // ---------------- Napalm (Blaze + Mortar) ----------------
  // S.n + S.shells canisters lob onto the densest cluster and random foes within SHELL_RANGE (no foe: 120 px out along the cursor dir, extras fanned 0.5 rad); each splashes (26 px x area, 0.6 x dmg) and leaves a fire line
  // (90 px x area long, 16 px x area wide, across the throw, 0.45 x dmg per second, 1.3 x S.dur s); S.cluster bomblets.
  const LINE = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, a: 0, len: 0, w: 0, dur: 0, dps: 0, tick: 0.5, burn: null, look: 'napalm', onEnd: null };
  const SPL = { look: 'fire', burn: null, knock: 60 };
  const canEnd = (w, z) => {
    const p = z.p, ws = p && p.weapons[0], S = liveS(w, p); if (!S) return;
    SPL.burn = burnOf(S, 0.3, 2);
    w.blast(p, z.wid, z.x, z.y, 26 * S.area, z.st, SPL);
    const a = z.a + Math.PI / 2, len = 90 * S.area;
    LINE.p = p; LINE.wid = z.wid; LINE.a = a; LINE.len = len; LINE.w = 16 * S.area; LINE.x = z.x - Math.cos(a) * len / 2; LINE.y = z.y - Math.sin(a) * len / 2;
    LINE.dur = S.dur * 1.3; LINE.dps = S.dmg * 0.45; LINE.onEnd = null;
    ground(w, ws, S, LINE);
    bomblets(w, p, z.wid, S, z.x, z.y, 26 * S.area, z.st);
  };
  ED.addWeapon({
    id: 'napalm', name: 'Napalm', icon: 'weapon.inferno', look: 'shell', sig: 'pyro', mode: 'densest', evolved: true, form: true, from: 'firebolt', shellForm: true, txt: 'Shells that leave walls of fire',
    base: { dmg: 16, cd: 1.4, n: 2, pierce: 0, area: 1.2, speed: 0, dur: 3, knock: 60, range: SHELL_RANGE, pools: 6, flare: 0, shells: 0, cluster: 0, combust: 0, cemb: 0, spread: 0, cgen: 1 },
    refine: [
      { mods: { n: 1 }, txt: '+1 canister' },
      { mods: { area: 0.25, dur: 0.3 }, txt: 'Fire walls 25% longer, last longer' },
    ],
  }, impl((w, p, ws, S) => {
    const t = w.target('densest', p, S.range);
    let tx, ty;
    if (t) { tx = t.x; ty = t.y; } else { const a = w.aimDir(p); tx = p.x + Math.cos(a) * 120; ty = p.y + Math.sin(a) * 120; }
    const n = Math.max(1, (S.n | 0) + (S.shells | 0));
    for (let i = 0; i < n; i++) {
      let x = tx, y = ty;
      if (i > 0) { const e = w.target('random', p, S.range); if (e) { x = e.x; y = e.y; } else { const a = w.aimDir(p) + (i % 2 ? 1 : -1) * 0.5 * Math.ceil(i / 2); x = p.x + Math.cos(a) * 120; y = p.y + Math.sin(a) * 120; } }
      lob(w, p, ws.id, p.x, p.y - 10, x, y, 26 * S.area, 0.6 + i * 0.1, S.dmg * 0.6, 'shell', canEnd);
    }
    return true;
  }));

  // ---------------- Q: Flashpoint ----------------
  // Zero damage. A flash at the hero: every foe within N.r px (inside its view) slides N.push px away (W.push: elites half, bosses and knockback-immune foes stay) and flees from
  // the hero for N.flee s (W.foeFlee; bosses never); gems (L4): every xp gem within N.gem px flies to the hero. Zone 'flash' (visual, r = flash radius).
  ED.addSkill({
    id: 'flashpoint', name: 'Flashpoint', icon: 'fx.blast.red', cd: 10, txt: 'A flash that sends the horde fleeing',
    base: { r: 140, push: 120, flee: 2, gem: 0 },
    levels: [
      { mods: { r: 0.3 }, txt: '+30% flash radius' },
      { mods: { flee: 1.5 }, txt: 'Foes flee 1.5 s longer' },
      { mods: { gem: 200 }, txt: 'The flash pulls in gems' },
    ],
  }, (w, p, x, y, N) => {
    const R = N.r, q = w.foeScan(p.x, p.y, R);
    let n = 0;
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (e.dead || U.dist2(p.x, p.y, e.x, e.y) > (R + e.r) * (R + e.r) || !ED.inView(p, e.x, e.y, e.r)) continue;
      w.push(e, p.x, p.y, N.push);
      w.foeFlee(e, p, N.flee);
      n++;
    }
    w.foeEnd();
    if (N.gem > 0) w.pullGems(p, p.x, p.y, N.gem);
    w.zone({ team: 0, p, wid: 'flashpoint', x: p.x, y: p.y, r: R, dur: 0.5, look: 'flash' });
    return { r: Math.round(R), n, shake: 6, stop: 0.05 };
  });
})(globalThis.ED || (globalThis.ED = {}));
