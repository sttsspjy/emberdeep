// Support weapons (b): War Axe -> Avalanche, Bramble Trail -> Thornwood, Glaive -> Twin Moons, Chain Spark -> Storm Crown (docs/supports.md). Registered with ED.addWeapon(def with support: true, impl).
// w.shoot / w.zone read their options only during the call, so options go through module scratch objects; per-shot state rides on numeric pr.st / pr.rk / z.st. Nothing allocates per tick.
// Visual-only zones (dps 0, no warn, no onTick): 'spark' lines (chain hops), 'sbolt' circles (sky strikes); 'scrown' is a hero-following aura.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, TICK = ED.CONST.TICK;
  ED.regLook('axe', 'avaxe', 'axebit', 'bramble', 'thicket', 'glaive', 'moon', 'spark', 'sbolt', 'scrown');
  const PROJ_SOFT_CAP = 500; // split children stop above this many live projectiles

  // ---------------- shared helpers ----------------
  const ZO = {};
  const zo = () => { for (const k in ZO) ZO[k] = undefined; ZO.team = 0; return ZO; };
  // Effective numbers of weapon `wid` held by hero p, or null (swapped for its Form since the shot left).
  const liveS = (w, p, wid) => {
    if (!p) return null;
    for (let i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === wid) return w.weaponS(p, i);
    return null;
  };
  // Visual-only zone: circle (r) or line (a, len, width 6).
  const vis = (w, p, wid, look, x, y, r, dur, a, len) => {
    const o = zo(); o.look = look; o.x = x; o.y = y; o.r = r; o.dur = dur; o.p = p; o.wid = wid;
    if (len) { o.a = a; o.len = len; o.w = 6; }
    return w.zone(o);
  };
  // Hero-following visual zone in ws.st.aura (re-created when gone; dies with the hero).
  const auraTick = (w, z) => { if (!w.alive(z.p)) z.dead = true; };
  const aura = (w, p, ws, look, r) => {
    const st = ws.st; let z = st.aura;
    if (!z || z.dead || z.id !== st.auraId) {
      const o = zo(); o.look = look; o.x = p.x; o.y = p.y; o.r = r; o.dur = 1e4; o.follow = p.pid; o.p = p; o.wid = ws.id; o.onTick = auraTick;
      z = st.aura = w.zone(o); st.auraId = z.id;
    }
    return z;
  };
  const bigFoe = (e) => !(e.elite || e.boss); // skip fn: keeps only elites and bosses

  // ---------------- War Axe / Avalanche (Control) ----------------
  // S.n axes thrown upward toward the cursor's side (both: every 2nd axe to the other side), fanned by horizontal speed; gravity pulls them down across the screen; each pierces S.pierce foes
  // and knocks every foe it hits S.knock away from the hero (bosses and knockback-immune foes ignore it); stag: hits stun. An axe falling back through its landing line (LAND px below the throw)
  // bounces (S.bounce times; back: the bounce flies back toward the hero, hit list cleared) and, with S.split (Avalanche), lands: a knockback thud (no damage) and S.split small axes (KIDD damage, 1 pierce) in short arcs.
  // pr.st bits: 0-1 bounces left, 2 back, 3-5 split count, 6 child; pr.rk = landing line y.
  const G = 560, VY0 = -250, VX0 = 70, VXS = 42, LAND = 24, KIDK = 0.6, KIDD = 0.3; // KIDK / KIDD: split axe knockback / damage share
  const AXE = { look: 'axe', r: 7, pierce: 0, life: 2.6, knock: 0, onHit: null, tick: null };
  const KID = { look: 'axebit', r: 5, pierce: 1, life: 1.6, knock: 0, dmg: 0, speed: 1, onHit: null, tick: null };
  const THUD = { knock: 0, look: 'axe' };
  const axeHit = (w, pr, e) => {
    const p = pr.p, S = liveS(w, p, pr.wid);
    if (!S || e.dead) return;
    w.knock(e, e.x - p.x, e.y - p.y, S.knock * (pr.st & 64 ? KIDK : 1));
    if (S.stag > 0) w.stun(e, S.stag);
  };
  const land = (w, pr) => {
    const st = pr.st, b = st & 3, m = (st >> 3) & 7;
    if (m > 0) {
      const S = liveS(w, pr.p, pr.wid);
      if (S) { THUD.knock = S.knock * KIDK; w.blast(pr.p, pr.wid, pr.x, pr.y, 24 * S.area, 0, THUD); }
      if (w.projs.length < PROJ_SOFT_CAP) {
        KID.dmg = pr.dmg * KIDD; KID.r = Math.max(4, pr.r * 0.6); KID.onHit = axeHit; KID.tick = axeTick;
        for (let i = 0; i < m; i++) {
          const c = w.shoot(pr.p, pr.wid, pr.x, pr.y, 0, null, KID);
          c.vx = pr.vx * 0.3 + (i - (m - 1) / 2) * 80; c.vy = -170 - 30 * (i & 1); c.st = 64; c.rk = 1e9;
        }
      }
    }
    if (b > 0) {
      pr.st = st - 1; pr.vy = -Math.abs(pr.vy) * 0.62; pr.hits.length = 0; pr.life = Math.max(pr.life, 1.3);
      if (st & 4) pr.vx = -pr.vx * 0.9;
    } else if (m > 0) pr.dead = true; // the split axes replace it
    else pr.rk = 1e9; // falls on off the view
  };
  function axeTick(w, pr, dt) {
    pr.vy += G * dt;
    if (pr.vy > 0 && pr.y >= pr.rk) land(w, pr);
  }
  const axeThrow = (w, p, ws, S, look) => {
    const a = w.aimDir(p), side = Math.cos(a) >= 0 ? 1 : -1, n = Math.max(1, S.n | 0), k = S.speed / 100;
    const bits = Math.min(3, S.bounce | 0) | (S.back ? 4 : 0) | (Math.min(7, S.split | 0) << 3);
    AXE.look = look; AXE.r = 7 * S.area; AXE.pierce = S.pierce | 0; AXE.onHit = axeHit; AXE.tick = axeTick;
    for (let i = 0; i < n; i++) {
      const s = S.both && (i & 1) ? -side : side, j = S.both ? i >> 1 : i;
      const pr = w.shoot(p, ws.id, p.x, p.y - 8, 0, S, AXE);
      pr.vx = s * (VX0 + j * VXS) * k; pr.vy = VY0 * (0.92 + 0.16 * w.rng.next()) - j * 12;
      pr.st = bits; pr.rk = p.y - 8 + LAND;
    }
    return true;
  };
  ED.addWeapon({
    id: 'waraxe', name: 'War Axe', look: 'axe', held: 'weapon.alt.throwing_axe', support: true, role: 'control', mode: 'cursor', txt: 'Arcing axes knock the horde back',
    base: { dmg: 20, cd: 1.5, n: 2, pierce: 4, area: 1, speed: 100, dur: 0, knock: 260, range: 0, both: false, stag: 0, bounce: 0, back: false, split: 0 },
    paths: [
      { id: 'count', name: 'Count', form: 'avalanche', ranks: [
        { mods: { n: 1 }, txt: '+1 axe' },
        { mods: { both: true }, txt: 'Axes fly to both sides' },
        { mods: { dmg: 0.15, n: 1 }, txt: '+15% damage, +1 axe' }] },
      { id: 'heft', name: 'Heft', form: 'avalanche', ranks: [
        { mods: { area: 0.3, knock: 0.3 }, txt: 'Axes 30% bigger, push harder' },
        { mods: { stag: 0.35 }, txt: 'Axe hits stagger foes' },
        { mods: { pierce: 2, knock: 0.3 }, txt: 'Pierce 2 more, push even harder' }] },
      { id: 'return', name: 'Return', form: 'avalanche', ranks: [
        { mods: { bounce: 1 }, txt: 'Axes bounce once on landing' },
        { mods: { back: true }, txt: 'The bounce flies back toward you' },
        { mods: { dmg: 0.15, bounce: 1 }, txt: '+15% damage, +1 bounce' }] },
    ],
    hybrids: [],
  }, { fire: (w, p, ws, S) => axeThrow(w, p, ws, S, 'axe') });
  ED.addWeapon({
    id: 'avalanche', name: 'Avalanche', look: 'avaxe', held: 'weapon.alt.double_axe', support: true, role: 'control', mode: 'cursor', evolved: true, form: true, from: 'waraxe', txt: 'Axes land and split into 3',
    base: { dmg: 18, cd: 1.5, n: 2, pierce: 4, area: 1.1, speed: 100, dur: 0, knock: 300, range: 0, both: false, stag: 0, bounce: 0, back: false, split: 3 },
    refine: [
      { mods: { n: 1 }, txt: '+1 axe' },
      { mods: { dmg: 0.2, split: 2 }, txt: '+20% damage, axes split into 5' },
    ],
  }, { fire: (w, p, ws, S) => axeThrow(w, p, ws, S, 'avaxe') });

  // ---------------- Bramble Trail / Thornwood (Control) ----------------
  // Thorn patches are zones (radius S.size x area, S.dur s) ticking every PT s: every 4th tick (1 s) S.dmg to foes inside; every tick a root (stun S.root s) on foes not rooted in the last
  // S.root + S.imm s (bosses never; elites half); barb: a root also stabs for S.barb x that hit (rcrit: always a crit). Walking drops a row of S.rows patches every S.gap px; each cooldown a ring
  // of S.n patches erupts around the hero (0.03 s apart, from the cursor side; ring2: a second ring 1.7x out). burst: a rooted foe the hero kills sprouts a patch (BURSTS per cooldown).
  // At most CAP live patches per hero. Patch zone fields: z.dmg = hit per damage tick, z.stun = root s, z.st = stab multiplier (negative: crit), z.knock = immunity s, z.tickT = own tick timer
  // (dps 0: onTick runs every tick). Foe root stamp: e.brI (id), e.brT (sim time).
  const PT = 0.25, CAP = 140, BURSTS = 6;
  let curZ = null, curW = null;
  let curHit = false;
  const patchFoe = (e) => {
    const z = curZ, w = curW;
    if (curHit) { const s = w.src(z.p, z.wid, 'zone', 0); s.x = z.x; s.y = z.y; w.hitFoe(e, z.dmg, s); }
    if (e.dead || e.boss || (e.brI === e.id && w.time < e.brT)) return;
    w.stun(e, z.stun); e.brI = e.id; e.brT = w.time + z.stun + z.knock;
    if (z.st) { const s = w.src(z.p, z.wid, 'zone', 0); s.x = z.x; s.y = z.y; if (z.st < 0) s.crit = true; w.hitFoe(e, z.dmg * Math.abs(z.st), s); }
  };
  const patchTick = (w, z) => {
    if ((z.tickT -= TICK) > 0) return;
    z.tickT += PT; curZ = z; curW = w; curHit = (Math.round(z.t / PT) & 3) === 0;
    w.zoneFoes(z, patchFoe);
    curZ = curW = null;
  };
  const patch = (w, p, ws, S, x, y) => {
    const st = ws.st;
    if (st.live >= CAP || ED.Arena.blocked(w.arena, x, y, 2)) return;
    st.live++;
    const o = zo();
    o.look = ws.id === 'thornwood' ? 'thicket' : 'bramble'; o.x = x; o.y = y; o.r = S.size * S.area; o.dur = S.dur; o.p = p; o.wid = ws.id;
    o.dmg = S.dmg * PT * 4; o.stun = S.root; o.st = S.barb * (S.rcrit ? -1 : 1); o.knock = S.imm; o.onTick = patchTick;
    w.zone(o);
  };
  const row = (w, p, ws, S, x, y, a) => {
    const m = Math.max(1, S.rows | 0), gap = 13 * S.area, nx = -Math.sin(a), ny = Math.cos(a);
    for (let i = 0; i < m; i++) { const o = (i - (m - 1) / 2) * gap; patch(w, p, ws, S, x + nx * o, y + ny * o); }
  };
  const bramble = {
    init(w, p, ws) { const st = ws.st; st.lx = p.x; st.ly = p.y; st.qi = st.qn = 0; st.qt = 0; st.qa = 0; st.live = 0; st.bb = 0; },
    fire(w, p, ws, S) {
      const st = ws.st;
      st.live = 0;
      for (let i = 0; i < w.zones.length; i++) { const z = w.zones[i]; if (!z.dead && z.p === p && z.onTick === patchTick) st.live++; }
      st.qi = 0; st.qn = Math.max(1, S.n | 0) * (S.ring2 ? 2 : 1); st.qt = 0; st.qa = w.aimDir(p); st.bb = BURSTS;
      return true;
    },
    tick(w, p, ws, S, dt) {
      const st = ws.st, gap = S.gap * S.area;
      if (U.dist2(p.x, p.y, st.lx, st.ly) >= gap * gap) { row(w, p, ws, S, p.x, p.y, Math.atan2(p.y - st.ly, p.x - st.lx)); st.lx = p.x; st.ly = p.y; }
      if (st.qi < st.qn) st.qt -= dt;
      const n = Math.max(1, S.n | 0);
      while (st.qi < st.qn && st.qt <= 0) {
        st.qt += 0.03;
        const i = st.qi++, outer = i >= n, k = outer ? i - n : i, R = S.ringR * S.area * (outer ? 1.7 : 1), a = st.qa + (k + (outer ? 0.5 : 0)) * TAU / n;
        patch(w, p, ws, S, p.x + Math.cos(a) * R, p.y + Math.sin(a) * R);
      }
    },
    kill(w, p, ws, S, e) {
      const st = ws.st;
      if (S.burst && e.stunT > 0 && st.bb > 0) { st.bb--; patch(w, p, ws, S, e.x, e.y); }
    },
  };
  ED.addWeapon({
    id: 'bramble', name: 'Bramble Trail', look: 'bramble', held: 'proj.thorn', support: true, role: 'control', mode: 'around', txt: 'Thorns root foes where you walk',
    base: { dmg: 3, cd: 1.6, n: 5, pierce: 0, area: 1, speed: 0, dur: 1.8, knock: 0, range: 0, gap: 22, size: 8.5, rows: 1, ringR: 48, ring2: false, root: 0.5, imm: 0.8, barb: 0, rcrit: false, burst: false },
    paths: [
      { id: 'length', name: 'Length', form: 'thornwood', ranks: [
        { mods: { dur: 0.3 }, txt: 'Thorns last 30% longer' },
        { mods: { rows: 2 }, txt: 'The trail grows 3 thorns wide' },
        { mods: { rows: 2, dur: 0.3 }, txt: 'Trail 5 wide, thorns last longer' }] },
      { id: 'snare', name: 'Snare', form: 'thornwood', ranks: [
        { mods: { n: 2 }, txt: '+2 thorns in the ring' },
        { mods: { area: 0.2, root: 0.3 }, txt: 'Thorns 20% wider, roots 0.3 s longer' },
        { mods: { ring2: true }, txt: 'A second, outer ring of thorns' }] },
      { id: 'barbs', name: 'Barbs', form: 'thornwood', ranks: [
        { mods: { barb: 0.7 }, txt: 'Rooting thorns also stab the foe' },
        { mods: { burst: true }, txt: 'Rooted foes sprout thorns on death' },
        { mods: { rcrit: true, root: 0.2 }, txt: 'Stabs always crit, roots 0.2 s longer' }] },
    ],
    hybrids: [],
  }, bramble);
  ED.addWeapon({
    id: 'thornwood', name: 'Thornwood', look: 'thicket', held: 'proj.thorn', support: true, role: 'control', mode: 'around', evolved: true, form: true, from: 'bramble', txt: 'Thickets persist and grab',
    base: { dmg: 2.5, cd: 1.8, n: 5, pierce: 0, area: 1.1, speed: 0, dur: 2.2, knock: 0, range: 0, gap: 20, size: 10, rows: 1, ringR: 50, ring2: false, root: 0.6, imm: 0.4, barb: 0, rcrit: false, burst: false },
    refine: [
      { mods: { dmg: 0.2, area: 0.15 }, txt: '+20% damage, thickets 15% wider' },
      { mods: { n: 2, root: 0.2 }, txt: '+2 thickets, roots 0.2 s longer' },
    ],
  }, bramble);

  // ---------------- Glaive / Twin Moons (Lane) ----------------
  // Glaive: S.n boomerangs fanned 0.3 rad apart along the cursor (a fan of n deals (1 + FK (n - 1)) x one glaive), out S.range / 2 and back, passing through all; each foe is hit once out and
  // once back. Within a trip the first foe takes the full hit, the next S.pierce foes x S.keep, later ones nothing. hover: at the far end it spins in place HOVER s, re-hitting every 0.12 s; bcrit: the return trip always crits.
  // Twin Moons: S.n moons each way launched along the cursor (FAN_M rad apart, fan rule as the Glaive) turn at a constant rate, so each flies a loop of radius S.rad x S.range / 320 (at most MOON_R) on its side,
  // back through the hero and MOON_X rad on along the cursor; per half loop the first foe takes the full hit, the next S.pierce x S.keep (hover: hit lists also clear every 0.8 s); bcrit: the second half crits.
  // pr.st: flags 1 hover, 2 hovering / hovered, 4 bcrit, 8 return seen; bits 4-10 keep x 100, bits 11-15 pierce cap; pr.rk = full damage. Moons: flags 1 second half, 4 bcrit, 8 turn left; pr.out = turn rate (rad/s; ret is off).
  const HOVER = 0.45, FAN_G = 0.3, FK = 0.4, FAN_M = 0.12, MOON_X = 0.6, MOON_R = 85; // MOON_X: rad a moon flies past its full loop; MOON_R: loop radius cap (a loop stays inside the view)
  const GL = { look: 'glaive', r: 9, ret: true, pierce: 1e9, knock: 0, onHit: null, tick: null };
  const glHit = (w, pr) => {
    const st = pr.st;
    if ((st & 2) && !pr.back) return; // hovering: full re-hits
    pr.dmg = pr.hits.length > (st >> 11) ? 0 : pr.rk * ((st >> 4) & 127) / 100;
  };
  const glTick = (w, pr) => {
    let st = pr.st;
    if ((st & 1) && !(st & 2) && !pr.back && pr.t >= pr.out) { st |= 2; pr.out += HOVER; pr.life += HOVER; pr.rehit = 0.12; pr.hitClr = pr.t; pr.dmg = pr.rk; }
    if ((st & 2) && !pr.back) { pr.vx = 0; pr.vy = 0; }
    if (pr.back && !(st & 8)) { st |= 8; pr.rehit = 0; pr.dmg = pr.rk; if (st & 4) pr.critC = 1; }
    pr.st = st;
  };
  const glBits = (S) => (S.hover ? 1 : 0) | (S.bcrit ? 4 : 0) | (Math.round(U.clamp(S.keep, 0, 1) * 100) << 4) | (U.clamp(S.pierce | 0, 0, 31) << 11);
  const glaiveFire = (w, p, ws, S) => {
    const a = w.aimDir(p), n = Math.max(1, S.n | 0), bits = glBits(S), k = (1 + FK * (n - 1)) / n;
    GL.r = 9 * S.area; GL.onHit = glHit; GL.tick = glTick; GL.knock = S.knock;
    for (let i = 0; i < n; i++) {
      const pr = w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * FAN_G, S, GL);
      pr.dmg *= k; pr.st = bits; pr.rk = pr.dmg;
    }
    return true;
  };
  const MOON = { look: 'moon', r: 13, pierce: 1e9, rehit: 0, life: 1, knock: 0, onHit: null, tick: null };
  const moonTick = (w, pr, dt) => {
    const a = Math.atan2(pr.vy, pr.vx) + pr.out * (pr.st & 8 ? -1 : 1) * dt;
    pr.vx = Math.cos(a) * pr.sp; pr.vy = Math.sin(a) * pr.sp;
    if (!(pr.st & 1) && pr.t * pr.out >= Math.PI) { pr.st |= 1; pr.hits.length = 0; if (pr.st & 4) pr.critC = 1; }
    if (!pr.hits.length) pr.dmg = pr.rk;
  };
  const moonFire = (w, p, ws, S) => {
    const a = w.aimDir(p), n = Math.max(1, S.n | 0), R = Math.min(MOON_R, S.rad * S.range / 320), om = S.speed / R, k = (1 + FK * (n - 1)) / n, bits = (S.bcrit ? 4 : 0) | (glBits(S) & ~7);
    MOON.r = 13 * S.area; MOON.life = (TAU + MOON_X) / om; MOON.rehit = S.hover ? 0.8 : 0; MOON.tick = moonTick; MOON.onHit = glHit; MOON.knock = S.knock;
    for (let d = 0; d < 2; d++) for (let j = 0; j < n; j++) {
      const pr = w.shoot(p, ws.id, p.x, p.y - 6, a + (d ? 1 : -1) * j * FAN_M, S, MOON);
      pr.dmg *= k; pr.out = om; pr.st = bits | (d ? 8 : 0); pr.rk = pr.dmg;
    }
    return true;
  };
  ED.addWeapon({
    id: 'glaive', name: 'Glaive', look: 'glaive', held: 'weapon.glaive', support: true, role: 'lane', mode: 'cursor', txt: 'Boomerang out and back, pierces',
    base: { dmg: 32, cd: 1.0, n: 1, pierce: 3, area: 1, speed: 260, dur: 0, knock: 30, range: 320, keep: 0.3, hover: false, bcrit: false },
    paths: [
      { id: 'twin', name: 'Twin', form: 'twinmoons', ranks: [
        { mods: { n: 1 }, txt: '+1 glaive in a fan' },
        { mods: { n: 1 }, txt: '+1 glaive' },
        { mods: { n: 1 }, txt: '+1 glaive' }] },
      { id: 'reach', name: 'Reach', form: 'twinmoons', ranks: [
        { mods: { range: 0.3, speed: 0.2 }, txt: 'Glaives fly 30% farther and faster' },
        { mods: { hover: true }, txt: 'Glaives spin at the far end' },
        { mods: { pierce: 2, range: 0.2 }, txt: 'Cut 2 more foes, fly 20% farther' }] },
      { id: 'edge', name: 'Edge', form: 'twinmoons', ranks: [
        { mods: { area: 0.4, keep: 0.1 }, txt: 'Glaives 40% bigger, cut deeper' },
        { mods: { bcrit: true }, txt: 'The return trip always crits' },
        { mods: { dmg: 0.15, area: 0.3 }, txt: '+15% damage, glaives 30% bigger' }] },
    ],
    hybrids: [],
  }, { fire: glaiveFire });
  ED.addWeapon({
    id: 'twinmoons', name: 'Twin Moons', look: 'moon', held: 'weapon.glaive', support: true, role: 'lane', mode: 'cursor', evolved: true, form: true, from: 'glaive', txt: 'Two moon pairs loop both ways',
    base: { dmg: 23, cd: 1.5, n: 2, pierce: 2, area: 1, speed: 300, dur: 0, knock: 50, range: 320, rad: 62, keep: 0, hover: false, bcrit: false },
    refine: [
      { mods: { n: 1 }, txt: '+1 moon each way' },
      { mods: { dmg: 0.25, rad: 12 }, txt: '+25% damage, wider loops' },
    ],
  }, { fire: moonFire });

  // ---------------- Chain Spark / Storm Crown (Lane, single target) ----------------
  // Each cooldown S.n bolts: the first strikes the nearest elite / boss within S.range in view, else the nearest foe; the rest strike random foes in view (n bolts deal (1 + BK (n - 1)) x one bolt). A bolt hits its first foe for S.dmg x S.first
  // (stun S.stun; dbl: a second strike of S.dbl x that), then jumps S.hops times to the nearest unhit foe within S.jump x area, damage x S.fall per jump; each foe reached sends the arc on in 1 branch
  // (Storm Crown: S.branch for the first S.fd jumps), + S.split more at the first jump. kfork: a foe the bolt kills sends S.kfork arcs (KF x the killing hit) to the nearest unhit foes. At most HIT_MAX foes per bolt.
  // Hops draw as 'spark' line zones; Storm Crown bolts fall from the sky ('sbolt') and a 'scrown' aura circles the hero's head.
  const HIT_MAX = 32, KQ = 8, BK = 0.5, KF = 0.5;
  const SEEN = [], FR = [], NX = [], KX = new Float32Array(KQ), KY = new Float32Array(KQ), KD = new Float32Array(KQ);
  let kn = 0;
  const seenF = (f) => SEEN.indexOf(f.id) >= 0;
  const arcHit = (w, p, ws, S, a, e, d) => {
    SEEN.push(e.id);
    const x0 = a ? a.x : p.x, y0 = a ? a.y - a.r : p.y - 14, dx = e.x - x0, dy = e.y - e.r - y0, len = Math.hypot(dx, dy);
    if (len >= 2) vis(w, p, ws.id, 'spark', x0, y0, 0, 0.22, Math.atan2(dy, dx), len);
    const s = w.src(p, ws.id, 'chain', 20); s.x = x0; s.y = y0;
    w.hitFoe(e, d, s);
    if (e.dead && S.kfork > 0 && kn < KQ) { KX[kn] = e.x; KY[kn] = e.y; KD[kn] = d * KF; kn++; }
  };
  const bolt = (w, p, ws, S, root, sky, bk) => {
    SEEN.length = 0; FR.length = 0; kn = 0;
    const d0 = S.dmg * bk * S.first;
    if (sky) vis(w, p, ws.id, 'sbolt', root.x, root.y, 26 * S.area, 0.3);
    arcHit(w, p, ws, S, sky ? root : null, root, d0);
    if (!root.dead && S.stun > 0) w.stun(root, S.stun);
    if (S.dbl > 0 && !root.dead) { const s = w.src(p, ws.id, 'chain', 0); s.x = root.x; s.y = root.y; w.hitFoe(root, d0 * S.dbl, s); vis(w, p, ws.id, 'sbolt', root.x, root.y, 18 * S.area, 0.25); }
    FR.push(root);
    const jump = S.jump * S.area, hops = S.hops | 0;
    let d = S.dmg * bk;
    for (let h = 0; h < hops && FR.length && SEEN.length < HIT_MAX; h++) {
      d *= S.fall;
      const k = (S.branch > 0 && h < (S.fd | 0) ? S.branch | 0 : 1) + (h === 0 ? S.split | 0 : 0);
      NX.length = 0;
      for (let i = 0; i < FR.length && SEEN.length < HIT_MAX; i++) {
        const a = FR[i];
        for (let j = 0; j < k && SEEN.length < HIT_MAX; j++) {
          const e = w.nearestFoe(a.x, a.y, jump, seenF); if (!e) break;
          arcHit(w, p, ws, S, a, e, d); NX.push(e);
        }
      }
      FR.length = 0; for (let i = 0; i < NX.length; i++) FR.push(NX[i]);
    }
    // kill forks: S.kfork arcs from each corpse (no further forks)
    const m = kn, kf = S.kfork | 0;
    for (let q = 0; q < m && SEEN.length < HIT_MAX; q++) {
      const x = KX[q], y = KY[q];
      for (let j = 0; j < kf && SEEN.length < HIT_MAX; j++) {
        const e = w.nearestFoe(x, y, jump, seenF); if (!e) break;
        SEEN.push(e.id);
        const dx = e.x - x, dy = e.y - e.r - y + 6, len = Math.hypot(dx, dy);
        if (len >= 2) vis(w, p, ws.id, 'spark', x, y - 6, 0, 0.22, Math.atan2(dy, dx), len);
        const s = w.src(p, ws.id, 'chain', 20); s.x = x; s.y = y;
        w.hitFoe(e, KD[q], s);
      }
    }
    kn = 0;
  };
  const sparkFire = (w, p, ws, S, sky) => {
    const e = w.heroFoe(p, S.range, bigFoe) || w.heroFoe(p, S.range);
    if (!e) return false;
    const n = Math.max(1, S.n | 0), bk = (1 + BK * (n - 1)) / n;
    bolt(w, p, ws, S, e, sky, bk);
    for (let i = 1; i < n; i++) {
      const t = w.target('random', p, S.range) || w.heroFoe(p, S.range);
      if (t && !t.dead) bolt(w, p, ws, S, t, sky, bk);
    }
    return true;
  };
  ED.addWeapon({
    id: 'chainspark', name: 'Chain Spark', look: 'spark', held: 'fx.thunder', support: true, role: 'lane', mode: 'nearest', txt: 'Lightning hunts elites, then arcs on',
    base: { dmg: 56, cd: 0.9, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 0, range: 320, hops: 2, jump: 90, fall: 0.5, first: 1, stun: 0, dbl: 0, split: 0, kfork: 0, branch: 0, fd: 0 },
    paths: [
      { id: 'chain', name: 'Chain', form: 'stormcrown', ranks: [
        { mods: { hops: 1 }, txt: 'Arcs jump to 1 more foe' },
        { mods: { n: 1 }, txt: '+1 bolt at another foe' },
        { mods: { hops: 1, jump: 20 }, txt: '1 more jump, jumps reach farther' }] },
      { id: 'voltage', name: 'Voltage', form: 'stormcrown', ranks: [
        { mods: { first: 0.3, stun: 0.2 }, txt: 'First foe: +30% damage, 0.2 s stun' },
        { mods: { dbl: 0.4 }, txt: 'The first foe is struck twice' },
        { mods: { cd: -0.15 }, txt: 'Bolts strike 15% faster' }] },
      { id: 'fork', name: 'Fork', form: 'stormcrown', ranks: [
        { mods: { kfork: 1 }, txt: 'Kills fork an arc onward' },
        { mods: { split: 1 }, txt: 'The arc splits in two at the first foe' },
        { mods: { kfork: 1 }, txt: 'Kills fork 2 arcs onward' }] },
    ],
    hybrids: [],
  }, { fire: (w, p, ws, S) => sparkFire(w, p, ws, S, false) });
  ED.addWeapon({
    id: 'stormcrown', name: 'Storm Crown', look: 'spark', held: 'fx.thunder', support: true, role: 'lane', mode: 'nearest', evolved: true, form: true, from: 'chainspark', txt: 'Sky bolts fork at every jump',
    base: { dmg: 37, cd: 0.8, n: 1, pierce: 0, area: 1.1, speed: 0, dur: 0, knock: 0, range: 340, hops: 1, jump: 100, fall: 0.4, first: 1.2, stun: 0.25, dbl: 0, split: 0, kfork: 0, branch: 2, fd: 1 },
    refine: [
      { mods: { n: 1 }, txt: '+1 sky bolt' },
      { mods: { dmg: 0.25, fd: 1 }, txt: '+25% damage, forks 1 jump deeper' },
    ],
  }, {
    tick(w, p, ws) { aura(w, p, ws, 'scrown', 14); },
    fire: (w, p, ws, S) => sparkFire(w, p, ws, S, true),
  });
})(globalThis.ED || (globalThis.ED = {}));
