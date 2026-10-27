// General weapons (b): Bone Spear, Blight Pool, Wisp, Mortar, Censer, Ricochet and their evolutions Impaler, Plague Field, Wisp Choir, Barrage, Holy Censer, Avalanche (GAME-DESIGN §4).
// Registered with ED.addWeapon(def, impl). Callbacks are shared functions (no per-shot closures); per-shot state rides on numeric pr.st / z.st or pooled objects.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;
  ED.regLook('spear', 'impaler', 'blight', 'plague', 'wisp', 'choir', 'shell', 'bomblet', 'mfire', 'censer', 'holycenser', 'stone', 'boulder');
  const PROJ_SOFT_CAP = 500; // split / spawn-on-hit children stop above this many live projectiles

  // Effective numbers of the weapon `wid` held by hero p, or null (sold / evolved since the shot left).
  const liveS = (w, p, wid) => {
    if (!p) return null;
    for (let i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === wid) return w.weaponS(p, i);
    return null;
  };

  // ---------------- Bone Spear / Impaler ----------------
  // Spears fly along the movement direction, S.n in a fan 0.16 rad apart; back / cross add the rear / side directions. shards: each spear bursts into 3 bone shards at its end.
  const SP = { look: 'spear', r: 5, onEnd: null };
  const SHARD = { look: 'bone', dmg: 0, pierce: 1, speed: 300, life: 0.35, r: 3, knock: 30 };
  const shardEnd = (w, pr) => {
    if (w.projs.length > PROJ_SOFT_CAP) return;
    SHARD.dmg = pr.dmg * 0.5;
    for (let i = -1; i <= 1; i++) w.shoot(pr.p, pr.wid, pr.x, pr.y, pr.a + i * 0.55, null, SHARD);
  };
  const fan = (w, p, ws, S, a0, spread, opt) => {
    const n = Math.max(1, S.n | 0);
    for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a0 + (i - (n - 1) / 2) * spread, S, opt);
  };
  ED.addWeapon({
    id: 'bonespear', name: 'Bone Spear', icon: 'proj.trident', look: 'spear', sig: null, mode: 'facing', txt: 'Piercing spears where you walk',
    base: { dmg: 20, cd: 1.4, n: 1, pierce: 4, area: 1, speed: 420, dur: 0, knock: 60, range: 300 },
    levels: [
      { mods: { n: 1 }, txt: '+1 spear' },
      { mods: { pierce: 4, range: 0.25 }, txt: 'Pierce 4 more, fly 25% farther' },
      { mods: { dmg: 0.25, back: true }, txt: '+25% damage, also throws behind' },
      { mods: { area: 0.4 }, txt: 'Spears 40% bigger' },
      { mods: { n: 1 }, txt: '+1 spear' },
      { mods: { shards: true }, txt: 'Spears burst into 3 bone shards' },
      { mods: { dmg: 0.25, cross: true }, txt: '+25% damage, throws to all 4 sides' },
    ],
    pair: 'might', evo: 'impaler',
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range)) return false;
      const a = p.mdir;
      SP.r = 5 * S.area; SP.onEnd = S.shards ? shardEnd : null;
      fan(w, p, ws, S, a, 0.16, SP);
      if (S.back || S.cross) fan(w, p, ws, S, a + PI, 0.16, SP);
      if (S.cross) { fan(w, p, ws, S, a + PI / 2, 0.16, SP); fan(w, p, ws, S, a - PI / 2, 0.16, SP); }
      return true;
    },
  });

  // Impaler: spears pin up to S.pin non-boss foes and drag them along, stop at obstacles, then burst (S.boom radius, x S.boomMul damage) and fling the pinned foes on.
  // Pin state { es, ids, n, dmg, r } is pooled (PINS) and returned in onEnd.
  const PINS = [];
  const pinState = () => { const s = PINS.pop() || { es: [], ids: [], n: 0, cap: 0, dmg: 0, r: 0 }; s.es.length = 0; s.ids.length = 0; s.n = 0; return s; };
  const pinHit = (w, pr, e) => {
    const s = pr.st;
    if (!s || e.dead || e.boss || s.n >= s.cap) return;
    s.es[s.n] = e; s.ids[s.n] = e.id; s.n++;
    w.stun(e, 0.2);
  };
  const pinTick = (w, pr) => {
    const s = pr.st; if (!s) return;
    const c = Math.cos(pr.a), sn = Math.sin(pr.a);
    for (let i = 0; i < s.n; i++) {
      const e = s.es[i]; if (e.dead || e.id !== s.ids[i]) continue;
      const back = 6 + (i >> 1) * 5, side = (i & 1 ? 1 : -1) * (2 + (i >> 1) * 2);
      e.x = pr.x - c * back - sn * side; e.y = pr.y - sn * back + c * side;
      e.kbx = e.kby = 0; w.stun(e, 0.15);
    }
  };
  const BOOM = { look: 'impaler', knock: 220 };
  const pinEnd = (w, pr) => {
    const s = pr.st; if (!s) return;
    w.blast(pr.p, pr.wid, pr.x, pr.y, s.r, s.dmg, BOOM);
    const c = Math.cos(pr.a), sn = Math.sin(pr.a);
    for (let i = 0; i < s.n; i++) { const e = s.es[i]; if (!e.dead && e.id === s.ids[i]) { w.knock(e, c, sn, 260); w.stun(e, 0.4); } }
    s.es.length = 0; pr.st = null; PINS.push(s);
  };
  const IMP = { look: 'impaler', r: 7, pierce: 999, solid: true, onHit: pinHit, tick: pinTick, onEnd: pinEnd, st: null };
  ED.addWeapon({
    id: 'impaler', name: 'Impaler', icon: 'weapon.alt.saw_sword', look: 'impaler', sig: null, mode: 'facing', evolved: true, from: 'bonespear', txt: 'Spears pin and drag foes',
    base: { dmg: 38, cd: 1.2, n: 3, pierce: 999, area: 1.3, speed: 360, dur: 0, knock: 0, range: 380, pin: 8, boom: 56, boomMul: 1.5 },
    levels: [],
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range)) return false;
      const n = Math.max(1, S.n | 0), a0 = p.mdir;
      IMP.r = 7 * S.area;
      for (let i = 0; i < n; i++) {
        const s = IMP.st = pinState(); s.cap = S.pin; s.dmg = S.dmg * S.boomMul; s.r = S.boom * S.area;
        w.shoot(p, ws.id, p.x, p.y - 6, a0 + (i - (n - 1) / 2) * 0.22, S, IMP);
      }
      const s = IMP.st = pinState(); s.cap = S.pin; s.dmg = S.dmg * S.boomMul; s.r = S.boom * S.area;
      w.shoot(p, ws.id, p.x, p.y - 6, a0 + PI, S, IMP);
      IMP.st = null;
      return true;
    },
  });

  // ---------------- Blight Pool / Plague Field ----------------
  // Poison pools: the first under the hero, the others under random foes in view (else in a ring around the hero). Pool radius 30 x area, S.dmg per second, ticks every 0.5 s.
  // slow: pools slow foes; burst: a fading pool bursts (1.15 x radius, 1.5 x its dps as one hit).
  const SLOW_POOL = [0.3, 0.6], SLOW_PLAGUE = [0.35, 0.6];
  const BURST = { look: 'blight', slow: SLOW_POOL };
  const poolBurst = (w, z) => { w.blast(z.p, z.wid, z.x, z.y, z.r * 1.15, z.dps * 1.5, BURST); };
  const ZP = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0, dps: 0, tick: 0.5, slow: null, look: 'blight', onEnd: null, onTick: null, st: 0 };
  const pool = (w, p, wid, x, y, r, dur, dps, slow, look, onEnd, onTick, st) => {
    ZP.p = p; ZP.wid = wid; ZP.x = x; ZP.y = y; ZP.r = r; ZP.dur = dur; ZP.dps = dps; ZP.slow = slow; ZP.look = look; ZP.onEnd = onEnd; ZP.onTick = onTick; ZP.st = st;
    return w.zone(ZP);
  };
  // Pool spots: index 0 under the hero, then random foes in view within 180 px, else a 56 px ring. Calls put(x, y) per spot.
  const spots = (w, p, n, put) => {
    put(p.x, p.y);
    for (let i = 1; i < n; i++) {
      const e = w.target('random', p, 180);
      if (e) put(e.x, e.y);
      else { const a = i / Math.max(1, n - 1) * TAU + w.rng.next(); put(p.x + Math.cos(a) * 56, p.y + Math.sin(a) * 56); }
    }
  };
  let cur = null, curS = null, curW = null;
  const putBlight = (x, y) => pool(curW, cur, 'blight', x, y, 30 * curS.area, curS.dur, curS.dmg, curS.slow ? SLOW_POOL : null, 'blight', curS.burst ? poolBurst : null, null, 0);
  ED.addWeapon({
    id: 'blight', name: 'Blight Pool', icon: 'weapon.plaguestaff', look: 'blight', sig: null, mode: 'around', txt: 'Poison pools under your feet',
    base: { dmg: 16, cd: 1.6, n: 1, pierce: 0, area: 1, speed: 0, dur: 3, knock: 0, range: 0 },
    levels: [
      { mods: { area: 0.3 }, txt: 'Pools 30% wider' },
      { mods: { n: 1 }, txt: '+1 pool, dropped under foes' },
      { mods: { dmg: 0.25, slow: true }, txt: '+25% damage, pools slow foes' },
      { mods: { dur: 0.5 }, txt: 'Pools last 50% longer' },
      { mods: { n: 1 }, txt: '+1 pool' },
      { mods: { burst: true }, txt: 'Pools burst when they fade' },
      { mods: { dmg: 0.25, area: 0.3 }, txt: '+25% damage, pools 30% wider' },
    ],
    pair: 'duration', evo: 'plague',
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, 200)) return false;
      cur = p; curS = S; curW = w;
      spots(w, p, Math.max(1, S.n | 0), putBlight);
      cur = curS = curW = null;
      return true;
    },
  });

  // Plague Field: bigger slowing pools; every damage tick a pool younger than generation 2 with fewer than 2 spreads seeds a child pool (0.85 x radius, 0.7 x duration)
  // under a foe at its edge. z.st = generation * 4 + spreads. At most PLAGUE_CAP live plague pools per hero.
  const PLAGUE_CAP = 36;
  const plagueTick = (w, z) => {
    const gen = z.st >> 2, sp = z.st & 3;
    if (gen >= 2 || sp >= 2 || z.t < 0.4 || !z.p) return;
    let live = 0;
    for (let i = 0; i < w.zones.length; i++) { const o = w.zones[i]; if (!o.dead && o.wid === 'plague' && o.p === z.p) live++; }
    if (live >= PLAGUE_CAP) return;
    const R = z.r + 48, in2 = (z.r * 0.7) ** 2, q = w.foeScan(z.x, z.y, R);
    let pick = null;
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const d2 = U.dist2(z.x, z.y, e.x, e.y);
      if (d2 > in2 && d2 < R * R) { pick = e; break; }
    }
    w.foeEnd();
    if (!pick) return;
    z.st++;
    pool(w, z.p, z.wid, pick.x, pick.y, z.r * 0.85, z.dur * 0.7, z.dps, SLOW_PLAGUE, 'plague', null, plagueTick, (gen + 1) << 2);
  };
  const putPlague = (x, y) => pool(curW, cur, 'plague', x, y, 30 * curS.area, curS.dur, curS.dmg, SLOW_PLAGUE, 'plague', null, plagueTick, 0);
  ED.addWeapon({
    id: 'plague', name: 'Plague Field', icon: 'fx.glyph.corroded', look: 'plague', sig: null, mode: 'around', evolved: true, from: 'blight', txt: 'Pools spread from foe to foe',
    base: { dmg: 24, cd: 1.3, n: 2, pierce: 0, area: 1.4, speed: 0, dur: 4, knock: 0, range: 0 },
    levels: [],
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, 220)) return false;
      cur = p; curS = S; curW = w;
      spots(w, p, Math.max(1, S.n | 0), putPlague);
      cur = curS = curW = null;
      return true;
    },
  });

  // ---------------- Wisp / Wisp Choir ----------------
  // S.n homing wisps launched in a wide fan toward the nearest foe (homing S.homing rad/s, life S.dur). burst: a hit also blasts 5.5 x the wisp radius for half damage (no event).
  // Wisp Choir: a wisp that kills splits into 2 (generation in pr.st, up to 2, children pierce 0).
  const WBURST = { noEv: true, knock: 40 };
  const wispBurst = (w, pr, e) => { w.blast(pr.p, pr.wid, e.x, e.y, pr.r * 5.5, pr.dmg * 0.5, WBURST); };
  const WP = { look: 'wisp', homing: 5, life: 2, r: 4, onHit: null, st: 0 };
  const KID = { look: 'choir', homing: 8, life: 1.6, r: 4, dmg: 0, pierce: 0, speed: 0, onHit: null, st: 0 };
  const choirHit = (w, pr, e) => {
    wispBurst(w, pr, e);
    if (!e.dead || (pr.st | 0) >= 2 || w.projs.length > PROJ_SOFT_CAP) return;
    KID.dmg = pr.dmg * 0.7; KID.speed = pr.sp; KID.r = pr.r; KID.st = (pr.st | 0) + 1; KID.onHit = choirHit;
    for (let s = -1; s <= 1; s += 2) { const c = w.shoot(pr.p, pr.wid, e.x, e.y, pr.a + s * 0.9, null, KID); c.hits.push(e.id); }
  };
  const launchWisps = (w, p, ws, S, look, onHit) => {
    const t = w.nearestFoe(p.x, p.y, S.range);
    if (!t) return false;
    const n = Math.max(1, S.n | 0), a = Math.atan2(t.y - p.y, t.x - p.x), spread = Math.min(0.5, 2.6 / n);
    WP.look = look; WP.homing = S.homing; WP.life = S.dur; WP.r = 4 * S.area; WP.onHit = onHit; WP.st = 0;
    for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 8, a + (i - (n - 1) / 2) * spread + (w.rng.next() - 0.5) * 0.3, S, WP);
    return true;
  };
  ED.addWeapon({
    id: 'wisp', name: 'Wisp', icon: 'fx.spark.magic', look: 'wisp', sig: null, mode: 'nearest', txt: 'Homing spirits seek foes',
    base: { dmg: 13, cd: 1.3, n: 2, pierce: 0, area: 1, speed: 170, dur: 2.2, knock: 30, range: 320, homing: 5 },
    levels: [
      { mods: { n: 1 }, txt: '+1 wisp' },
      { mods: { pierce: 1 }, txt: 'Wisps pass through 1 more foe' },
      { mods: { dmg: 0.25, dur: 0.4 }, txt: '+25% damage, wisps live 40% longer' },
      { mods: { n: 1 }, txt: '+1 wisp' },
      { mods: { burst: true }, txt: 'Wisps burst on hit, hurting nearby foes' },
      { mods: { n: 2 }, txt: '+2 wisps' },
      { mods: { dmg: 0.25, area: 0.5 }, txt: '+25% damage, bigger wisps and bursts' },
    ],
    pair: 'multishot', evo: 'choir',
  }, { fire: (w, p, ws, S) => launchWisps(w, p, ws, S, 'wisp', S.burst ? wispBurst : null) });
  ED.addWeapon({
    id: 'choir', name: 'Wisp Choir', icon: 'fx.circle.spark', look: 'choir', sig: null, mode: 'nearest', evolved: true, from: 'wisp', txt: 'Wisps split on kill',
    base: { dmg: 22, cd: 0.9, n: 4, pierce: 1, area: 1.3, speed: 200, dur: 3, knock: 30, range: 360, homing: 7 },
    levels: [],
  }, { fire: (w, p, ws, S) => launchWisps(w, p, ws, S, 'choir', choirHit) });

  // ---------------- Mortar / Barrage ----------------
  // A shell is a hero warn zone: it lands after S.flight s (radius 40 x area, S.dmg, knockback) and emits 'boom'. Render fields: z.a = angle from the target back to the launch point,
  // z.w = launch distance (circle zones ignore w). z.st: 1 shell, 2 bomblet. On landing a shell breaks braziers, scatters S.cluster bomblets (half damage, 0.5 x radius)
  // and, with fire, leaves burning ground (0.85 x radius, S.dur s, 35% dps).
  const ZS = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0, dmg: 0, warn: true, knock: 0, look: 'shell', a: 0, w: 0, onEnd: null, st: 1 };
  const ZF = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0, dps: 0, tick: 0.4, look: 'mfire' };
  const shell = (w, p, wid, fx, fy, x, y, r, dmg, knock, dur, kind, look) => {
    ZS.p = p; ZS.wid = wid; ZS.x = x; ZS.y = y; ZS.r = r; ZS.dur = dur; ZS.dmg = dmg; ZS.knock = knock; ZS.look = look; ZS.st = kind;
    ZS.a = Math.atan2(fy - y, fx - x); ZS.w = Math.hypot(fx - x, fy - y); ZS.onEnd = shellEnd;
    return w.zone(ZS);
  };
  function shellEnd(w, z) {
    w.hitBraziers(z.x, z.y, z.r, z.p);
    if (z.st !== 1) return;
    const S = liveS(w, z.p, z.wid); if (!S) return;
    const nb = S.cluster | 0;
    for (let i = 0; i < nb; i++) {
      const a = i / nb * TAU + w.rng.next() * 0.8, d = z.r * (0.7 + 0.5 * w.rng.next());
      shell(w, z.p, z.wid, z.x, z.y, z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, z.r * 0.5, S.dmg * 0.5, S.knock * 0.5, 0.22 + i * 0.05, 2, 'bomblet');
    }
    if (S.fire) { ZF.p = z.p; ZF.wid = z.wid; ZF.x = z.x; ZF.y = z.y; ZF.r = z.r * 0.85; ZF.dur = S.dur; ZF.dps = S.dmg * 0.35; w.zone(ZF); }
  }
  ED.addWeapon({
    id: 'mortar', name: 'Mortar', icon: 'fx.explosion', look: 'shell', sig: null, mode: 'densest', txt: 'Shells on the thickest crowd',
    base: { dmg: 26, cd: 2.2, n: 1, pierce: 0, area: 1, speed: 0, dur: 2, knock: 120, range: 340, flight: 0.75, cluster: 0 },
    levels: [
      { mods: { area: 0.25 }, txt: 'Blasts 25% wider' },
      { mods: { n: 1 }, txt: '+1 shell' },
      { mods: { dmg: 0.25, cluster: 3 }, txt: '+25% damage, shells scatter 3 bomblets' },
      { mods: { n: 1 }, txt: '+1 shell' },
      { mods: { fire: true }, txt: 'Blasts leave burning ground' },
      { mods: { area: 0.3, cluster: 2 }, txt: 'Blasts 30% wider, +2 bomblets' },
      { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 shell' },
    ],
    pair: 'reach', evo: 'barrage',
  }, {
    // Shell 1 on the densest cluster, the rest on random foes in view (0.12 s apart), else scattered 50 px around the first.
    fire(w, p, ws, S) {
      const t = w.densest(p.x, p.y, S.range);
      if (!t) return false;
      const tx = t.x, ty = t.y, n = Math.max(1, S.n | 0), r = 40 * S.area;
      shell(w, p, ws.id, p.x, p.y - 10, tx, ty, r, S.dmg, S.knock, S.flight, 1, 'shell');
      for (let i = 1; i < n; i++) {
        const e = w.target('random', p, S.range);
        let x = tx, y = ty;
        if (e) { x = e.x; y = e.y; } else { const a = w.rng.next() * TAU; x += Math.cos(a) * 50; y += Math.sin(a) * 50; }
        shell(w, p, ws.id, p.x, p.y - 10, x, y, r, S.dmg, S.knock, S.flight + i * 0.12, 1, 'shell');
      }
      return true;
    },
  });
  // Barrage: S.n shells walk across the densest cluster along the hero's line of fire (36 px x area apart, 0.09 s apart), each with bomblets and burning ground.
  ED.addWeapon({
    id: 'barrage', name: 'Barrage', icon: 'fx.blast.red', look: 'shell', sig: null, mode: 'densest', evolved: true, from: 'mortar', txt: 'A walking salvo of shells',
    base: { dmg: 36, cd: 1.7, n: 5, pierce: 0, area: 1.2, speed: 0, dur: 2, knock: 140, range: 380, flight: 0.6, cluster: 2, fire: true },
    levels: [],
  }, {
    fire(w, p, ws, S) {
      const t = w.densest(p.x, p.y, S.range);
      if (!t) return false;
      const tx = t.x, ty = t.y, a = Math.atan2(ty - p.y, tx - p.x), c = Math.cos(a), s = Math.sin(a), n = Math.max(1, S.n | 0), step = 36 * S.area, r = 40 * S.area;
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * step;
        shell(w, p, ws.id, p.x, p.y - 10, tx + c * o, ty + s * o, r, S.dmg, S.knock, S.flight + i * 0.09, 1, 'shell');
      }
      return true;
    },
  });

  // ---------------- Censer / Holy Censer ----------------
  // Aura radius 44 x area around the hero: a pulse every S.cd hits every foe inside (no event). slow: pulses slow; push: pulses push foes out. swing: censers orbiting at 0.75 x radius
  // hit foes they touch every 0.15 s (radius 14 x area, 60% damage). Render: a hero zone (look censer / holycenser) that follows the hero, kept alive 0.5 s at a time by tick;
  // z.r = aura radius, z.a = orbit angle, z.w = censer count. Holy Censer: every 30 kills by its pulses / censers heal living heroes inside the aura 1 HP.
  const AURA = { noEv: true, knock: 0, slow: null };
  const SWING = { noEv: true, knock: 60 };
  const SLOW_AURA = [0.25, 0.5];
  const censerTick = (w, p, ws, S, dt, look) => {
    const st = ws.st, R = 44 * S.area, n = S.swing | 0;
    let z = st.z;
    if (!z || z.dead || z.id !== st.zid || z.wid !== ws.id) {
      z = st.z = w.zone({ team: 0, p, wid: ws.id, x: p.x, y: p.y, r: R, dur: 0.5, look, follow: p.pid });
      st.zid = z.id;
    }
    st.ang = (st.ang + dt * 3.2) % TAU;
    z.x = p.x; z.y = p.y; z.r = R; z.dur = z.t + 0.5; z.a = st.ang; z.w = n;
    if (n > 0 && (st.swT -= dt) <= 0) {
      st.swT = 0.15;
      const k0 = p.kills;
      for (let i = 0; i < n; i++) {
        const a = st.ang + i * TAU / n;
        w.blast(p, ws.id, p.x + Math.cos(a) * R * 0.75, p.y + Math.sin(a) * R * 0.75, 14 * S.area, S.dmg * 0.6, SWING);
      }
      st.kills += p.kills - k0;
    }
  };
  const censerFire = (w, p, ws, S) => {
    const R = 44 * S.area;
    if (!w.nearestFoe(p.x, p.y, R + 24)) return false;
    AURA.knock = S.push || 0; AURA.slow = S.slow ? SLOW_AURA : null;
    const k0 = p.kills;
    w.blast(p, ws.id, p.x, p.y, R, S.dmg, AURA);
    ws.st.kills += p.kills - k0;
    return true;
  };
  const censerInit = (w, p, ws) => { ws.st.z = null; ws.st.zid = 0; ws.st.ang = 0; ws.st.swT = 0; ws.st.kills = 0; };
  ED.addWeapon({
    id: 'censer', name: 'Censer', icon: 'shield.gold', look: 'censer', sig: null, mode: 'around', txt: 'Smoking aura burns nearby foes', noAmount: true,
    base: { dmg: 10, cd: 0.6, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 0, range: 0, swing: 0, push: 0 },
    levels: [
      { mods: { area: 0.2 }, txt: 'Aura 20% wider' },
      { mods: { slow: true }, txt: 'Aura slows foes 25%' },
      { mods: { dmg: 0.25, area: 0.15 }, txt: '+25% damage, aura 15% wider' },
      { mods: { swing: 1 }, txt: 'A censer swings around you' },
      { mods: { push: 70 }, txt: 'Pulses push foes back' },
      { mods: { swing: 1 }, txt: '+1 swinging censer' },
      { mods: { dmg: 0.25, area: 0.25 }, txt: '+25% damage, aura 25% wider' },
    ],
    pair: 'mending', evo: 'holycenser',
  }, { init: censerInit, tick: (w, p, ws, S, dt) => censerTick(w, p, ws, S, dt, 'censer'), fire: censerFire });
  ED.addWeapon({
    id: 'holycenser', name: 'Holy Censer', icon: 'fx.burst', look: 'holycenser', sig: null, mode: 'around', evolved: true, from: 'censer', txt: 'Kills in the aura heal you', noAmount: true,
    base: { dmg: 18, cd: 0.45, n: 1, pierce: 0, area: 1.6, speed: 0, dur: 0, knock: 0, range: 0, swing: 3, push: 60, slow: true, healPer: 30 },
    levels: [],
  }, {
    init: censerInit,
    tick(w, p, ws, S, dt) {
      censerTick(w, p, ws, S, dt, 'holycenser');
      const st = ws.st;
      if (st.kills < S.healPer) return;
      const R = 44 * S.area, R2 = R * R;
      while (st.kills >= S.healPer) {
        st.kills -= S.healPer;
        for (const h of w.living) if (U.dist2(p.x, p.y, h.x, h.y) <= R2) w.heal(h, 1);
      }
    },
    fire: censerFire,
  });

  // ---------------- Ricochet / Avalanche ----------------
  // Stones fly at the nearest foe (S.n in a 0.3 rad fan); every hit with bounces left (pr.pierce) turns the stone toward the nearest unhit foe within 160 px and refreshes its life.
  // Avalanche: each bounce also splits off a stone (80% damage and size, one bounce fewer) toward the next unhit foe (or 0.8 rad off).
  const HOP = 160;
  let skipHits = null, skipE = null;
  const skipFn = (f) => f === skipE || skipHits.indexOf(f.id) >= 0;
  const nextFoe = (w, x, y, hits, also) => { skipHits = hits; skipE = also; const e = w.nearestFoe(x, y, HOP, skipFn); skipHits = null; skipE = null; return e; };
  const bounce = (w, pr, e) => {
    if (pr.pierce <= 0) return null;
    const t = nextFoe(w, e.x, e.y, pr.hits, null);
    if (!t) return null;
    const a = Math.atan2(t.y - pr.y, t.x - pr.x);
    pr.vx = Math.cos(a) * pr.sp; pr.vy = Math.sin(a) * pr.sp; pr.a = a;
    pr.life = Math.max(pr.life, HOP / pr.sp + 0.15);
    return t;
  };
  const KIDS = { look: 'boulder', dmg: 0, pierce: 0, speed: 0, r: 4, life: 0, knock: 60, onHit: null };
  const avHit = (w, pr, e) => {
    const t = bounce(w, pr, e);
    if (pr.pierce <= 1 || w.projs.length > PROJ_SOFT_CAP) return;
    const t2 = nextFoe(w, e.x, e.y, pr.hits, t);
    const a = t2 ? Math.atan2(t2.y - e.y, t2.x - e.x) : pr.a + (pr.id & 1 ? 0.8 : -0.8);
    KIDS.dmg = pr.dmg * 0.8; KIDS.pierce = pr.pierce - 1; KIDS.speed = pr.sp; KIDS.r = Math.max(2.5, pr.r * 0.8); KIDS.life = HOP / pr.sp + 0.15; KIDS.onHit = avHit;
    const c = w.shoot(pr.p, pr.wid, e.x, e.y, a, null, KIDS);
    for (let i = 0; i < pr.hits.length; i++) c.hits.push(pr.hits[i]);
  };
  const RS = { look: 'stone', r: 4, onHit: null };
  const throwStones = (w, p, ws, S, look, onHit) => {
    const t = w.nearestFoe(p.x, p.y, S.range);
    if (!t) return false;
    const n = Math.max(1, S.n | 0), a = Math.atan2(t.y - p.y, t.x - p.x);
    RS.look = look; RS.r = 4 * S.area; RS.onHit = onHit;
    for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.3, S, RS);
    return true;
  };
  ED.addWeapon({
    id: 'ricochet', name: 'Ricochet', icon: 'weapon.alt.throwing_axe', look: 'stone', sig: null, mode: 'nearest', txt: 'Stones bounce from foe to foe',
    base: { dmg: 15, cd: 1.1, n: 1, pierce: 2, area: 1, speed: 300, dur: 0, knock: 50, range: 280 },
    levels: [
      { mods: { pierce: 1 }, txt: '+1 bounce' },
      { mods: { n: 1 }, txt: '+1 stone' },
      { mods: { dmg: 0.25, pierce: 1 }, txt: '+25% damage, +1 bounce' },
      { mods: { area: 0.5 }, txt: 'Stones 50% bigger' },
      { mods: { n: 1 }, txt: '+1 stone' },
      { mods: { pierce: 2, speed: 0.2 }, txt: '+2 bounces, faster stones' },
      { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 stone' },
    ],
    pair: 'velocity', evo: 'avalanche',
  }, { fire: (w, p, ws, S) => throwStones(w, p, ws, S, 'stone', bounce) });
  ED.addWeapon({
    id: 'avalanche', name: 'Avalanche', icon: 'weapon.warhammer', look: 'boulder', sig: null, mode: 'nearest', evolved: true, from: 'ricochet', txt: 'Stones split on every bounce',
    base: { dmg: 28, cd: 1.0, n: 3, pierce: 4, area: 1.5, speed: 340, dur: 0, knock: 80, range: 300 },
    levels: [],
  }, { fire: (w, p, ws, S) => throwStones(w, p, ws, S, 'boulder', avHit) });
})(globalThis.ED || (globalThis.ED = {}));
