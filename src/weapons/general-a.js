// General weapons (a), GAME-DESIGN §4: Orbit Lanterns -> Sun Wheel, Chain Spark -> Storm Crown, Frost Ring -> Glacier, Bramble Trail -> Thornwood, Glaive -> Twin Moons, Meteor Call -> Starfall.
// Built on the combat primitives (shoot, zone, chain, blast, hitFoe). Orbiting bodies are projectiles steered by pr.tick; rings, thorns and impacts are zones driven by onTick / onEnd.
// Visual-only zones (dps 0, no warn) carry instant effects to the renderer: 'spark' line segments, 'stormbolt', 'sunflare', 'mboom'; 'sunring' and 'crown' are hero-following auras.
// Per-entity state objects come from free lists (returned in onEnd); zone / shoot options go through scratch objects, so steady-state firing allocates nothing.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('lantern', 'sunlantern', 'sunring', 'sunflare', 'spark', 'stormbolt', 'crown', 'frostring', 'glacier', 'iceshard',
    'bramble', 'thicket', 'glaive', 'moon', 'meteor', 'star', 'comet', 'crater', 'mboom', 'ember');

  // ---------------- shared helpers ----------------
  const ORB_Y = 4; // orbit centre: this far above the hero's feet
  const pool = () => { const L = []; return { take: () => L.pop() || {}, give: (o) => { if (L.length < 256) L.push(o); } }; };
  const ORB = pool(), RING = pool(), DROP = pool(), HOV = pool();
  const ZO = {}, SO = {};
  // Scratch option objects for w.zone / w.shoot (both read their options only during the call).
  const zo = () => { for (const k in ZO) ZO[k] = undefined; ZO.team = 0; return ZO; };
  const so = () => { for (const k in SO) SO[k] = undefined; return SO; };
  // Tracked entities in st.objs / st.ids (pool objects are recycled, so identity is checked by id).
  const live = (st) => { let n = 0; for (let i = 0; i < st.objs.length; i++) { const o = st.objs[i]; if (!o.dead && o.id === st.ids[i]) n++; } return n; };
  const killAll = (st, give) => {
    for (let i = 0; i < st.objs.length; i++) { const o = st.objs[i]; if (!o.dead && o.id === st.ids[i]) { o.dead = true; if (give && o.st) { give(o.st); o.st = null; o.onEnd = null; } } }
    st.objs.length = 0; st.ids.length = 0;
  };
  const track = (st, o) => { st.objs.push(o); st.ids.push(o.id); };
  const tracked = (st) => { if (!st.objs) { st.objs = []; st.ids = []; } return st; };
  // Visual-only zone (no damage) for the renderer: circle (r) or line (a, len, w).
  const vis = (w, p, wid, look, x, y, r, dur, a, len) => {
    const o = zo(); o.look = look; o.x = x; o.y = y; o.r = r; o.dur = dur; o.p = p; o.wid = wid;
    if (len) { o.a = a; o.len = len; o.w = 6; }
    return w.zone(o);
  };
  // Long-lived hero-following visual zone (ws.st.aura), re-created when gone; dies with the hero.
  const auraTick = (w, z) => { if (!w.alive(z.p)) z.dead = true; };
  const aura = (w, p, ws, look, r) => {
    const st = ws.st; let z = st.aura;
    if (!z || z.dead || z.id !== st.auraId) {
      const o = zo(); o.look = look; o.x = p.x; o.y = p.y; o.r = r; o.dur = 1e9; o.follow = p.pid; o.p = p; o.wid = ws.id; o.onTick = auraTick;
      z = st.aura = w.zone(o); st.auraId = z.id;
    }
    z.r = r;
    return z;
  };
  // Cached [a, b] status arrays per weapon slot (zones keep the reference).
  const pair2 = (st, key, a, b) => { const v = st[key] || (st[key] = [0, 0]); v[0] = a; v[1] = b; return v; };
  // Second target for extra shots: a random foe on screen, else the nearest.
  const extraTarget = (w, p, range) => w.target('random', p, range) || w.nearestFoe(p.x, p.y, range);

  // ---------------- Orbit Lanterns / Sun Wheel ----------------
  // Orbit state: a0 phase, R radius, spin rad/s, dir +-1, breathe (s period: radius swings R..1.85R), spiral (s: radius out and back over the life), pop (grow in), knock (outward), burn (dps).
  const orbTick = (w, pr, dt) => {
    const s = pr.st, p = pr.p;
    if (!s || !w.alive(p)) { pr.dead = true; return; }
    let R = s.R;
    if (s.breathe) R *= 1 + 0.85 * (0.5 - 0.5 * Math.cos(w.time * TAU / s.breathe));
    if (s.spiral) R = 16 + (R - 16) * Math.sin(Math.PI * Math.min(1, pr.t / s.spiral));
    else if (s.pop) R *= Math.min(1, pr.t / 0.2);
    const a = s.a0 + w.time * s.spin * s.dir;
    pr.vx = (p.x + Math.cos(a) * R - pr.x) / dt; pr.vy = (p.y - ORB_Y + Math.sin(a) * R - pr.y) / dt;
  };
  const orbHit = (w, pr, e) => {
    const s = pr.st; if (!s || e.dead) return;
    if (s.knock) w.knock(e, e.x - pr.p.x, e.y - pr.p.y, s.knock);
    if (s.burn) w.burn(e, s.burn, 2, pr.p);
  };
  const orbEnd = (w, pr) => { if (pr.st) { ORB.give(pr.st); pr.st = null; } };
  // n bodies evenly spaced on one ring. Returns nothing; each projectile is tracked in ws.st.
  const orbRing = (w, p, ws, S, n, R, dir, a0, look, life, o) => {
    for (let i = 0; i < n; i++) {
      const s = ORB.take();
      s.a0 = a0 + i * TAU / n; s.R = R; s.spin = S.speed; s.dir = dir; s.breathe = o.breathe || 0; s.spiral = o.spiral || 0; s.pop = !!o.pop; s.knock = o.knock || 0; s.burn = o.burn || 0;
      const a = s.a0 + w.time * s.spin * dir, R0 = s.pop || s.spiral ? 16 : R;
      const q = so(); q.look = look; q.speed = 0; q.r = o.r; q.life = life; q.pierce = 1e9; q.rehit = o.rehit; q.knock = 0; q.tick = orbTick; q.onHit = orbHit; q.onEnd = orbEnd; q.st = s;
      track(ws.st, w.shoot(p, ws.id, p.x + Math.cos(a) * R0, p.y - ORB_Y + Math.sin(a) * R0, a + Math.PI / 2, S, q));
    }
  };
  const ORB_O = {};
  const orbOpt = (r, rehit, knock, burn, breathe, pop, spiral) => { ORB_O.r = r; ORB_O.rehit = rehit; ORB_O.knock = knock; ORB_O.burn = burn; ORB_O.breathe = breathe; ORB_O.pop = pop; ORB_O.spiral = spiral; return ORB_O; };

  ED.addWeapon({
    id: 'lanterns', name: 'Orbit Lanterns', icon: 'weapon.lantern', look: 'lantern', sig: null, mode: 'around', txt: 'Lanterns circle you',
    base: { dmg: 12, cd: 2.5, n: 2, pierce: 0, area: 1, speed: 3.2, dur: 1.8, knock: 70, range: 0, rad: 46, ring2: false },
    levels: [
      { mods: { n: 1 }, txt: '+1 lantern' },
      { mods: { area: 0.25 }, txt: 'Wider orbit, bigger lanterns' },
      { mods: { dmg: 0.25, dur: 0.5 }, txt: '+25% damage, lasts 50% longer' },
      { mods: { n: 1 }, txt: '+1 lantern' },
      { mods: { ring2: true }, txt: 'Outer ring spins the other way' },
      { mods: { dur: 0.6, speed: 0.25 }, txt: 'Lanterns last longer, spin faster' },
      { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 lantern' },
    ],
    pair: 'duration', evo: 'sunwheel',
  }, {
    // Each wave replaces the last at the same phase (orbit angle follows w.time), so a duration above the cooldown is a permanent ring.
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, 300)) return false;
      const st = tracked(ws.st), cont = live(st) > 0, n = Math.max(1, S.n | 0), R = S.rad * S.area;
      killAll(st, ORB.give);
      orbRing(w, p, ws, S, n, R, 1, 0, 'lantern', S.dur, orbOpt(9 * S.area, 0.5, S.knock, 0, 0, !cont, 0));
      if (S.ring2) orbRing(w, p, ws, S, Math.max(2, Math.ceil(n / 2) + 1), R * 1.6, -1, 0.4, 'lantern', S.dur, orbOpt(9 * S.area, 0.5, S.knock, 0, 0, !cont, 0));
      return true;
    },
  });

  // Sun Wheel: a permanent ring of 8 (+ amount) sun lanterns that breathes out to 1.85x and back every 3.2 s; hits burn; at full stretch every lantern flares (fire blast).
  const SUN_BREATH = 3.2, FLARE = { burn: null, knock: 140, noEv: true };
  ED.addWeapon({
    id: 'sunwheel', name: 'Sun Wheel', icon: 'fxbig.firespin', look: 'sunlantern', sig: null, mode: 'around', evolved: true, from: 'lanterns', txt: 'A burning wheel of 8 suns',
    base: { dmg: 24, cd: 1, n: 8, pierce: 0, area: 1.3, speed: 2.4, dur: 0, knock: 90, range: 0, rad: 58, burn: 12 },
    levels: [],
  }, {
    init(w, p, ws) { for (const pr of w.projs) if (pr.p === p && pr.wid === 'lanterns' && !pr.dead) { pr.dead = true; if (pr.st) ORB.give(pr.st); pr.st = null; pr.onEnd = null; } },
    tick(w, p, ws, S) {
      const st = tracked(ws.st), R = S.rad * S.area, ph = (w.time / SUN_BREATH) % 1;
      aura(w, p, ws, 'sunring', R * (1 + 0.85 * (0.5 - 0.5 * Math.cos(w.time * TAU / SUN_BREATH))));
      if (st.ph !== undefined && st.ph < 0.5 && ph >= 0.5) { // full stretch: flare
        for (let i = 0; i < st.objs.length; i++) {
          const pr = st.objs[i]; if (pr.dead || pr.id !== st.ids[i]) continue;
          FLARE.burn = pair2(st, 'burnA', S.burn, 3);
          w.blast(p, ws.id, pr.x, pr.y, 30 * S.area, S.dmg * 0.8, FLARE);
          vis(w, p, ws.id, 'sunflare', pr.x, pr.y, 30 * S.area, 0.4);
        }
      }
      st.ph = ph;
    },
    fire(w, p, ws, S) {
      const st = tracked(ws.st), n = Math.max(1, S.n | 0);
      if (live(st) === n) return true;
      killAll(st, ORB.give);
      orbRing(w, p, ws, S, n, S.rad * S.area, 1, 0, 'sunlantern', 1e9, orbOpt(12 * S.area, 0.4, S.knock, S.burn, SUN_BREATH, true, 0));
      return true;
    },
  });

  // ---------------- Chain Spark / Storm Crown ----------------
  // Spark chains draw as 'spark' line zones, one per hop (built in the chain's onHit).
  let cx = 0, cy = 0, cP = null, cWid = '', cLook = 'spark';
  const segment = (w, x1, y1) => {
    const dx = x1 - cx, dy = y1 - cy, len = Math.hypot(dx, dy);
    if (len >= 2) vis(w, cP, cWid, cLook, cx, cy, 0, 0.3, Math.atan2(dy, dx), len);
    cx = x1; cy = y1;
  };
  const chainHit = (w, e) => segment(w, e.x, e.y - e.r);
  const CH_OPT = { onHit: chainHit, knock: 25, look: 'spark' };
  const NOVA_OPT = { knock: 120, look: 'spark', stun: 0.3 };
  ED.addWeapon({
    id: 'chainspark', name: 'Chain Spark', icon: 'fx.thunder', look: 'spark', sig: null, mode: 'nearest', txt: 'Lightning arcs foe to foe',
    base: { dmg: 15, cd: 1.2, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 25, range: 300, hops: 4, jump: 80, nova: false },
    levels: [
      { mods: { hops: 2 }, txt: 'Arcs jump to 2 more foes' },
      { mods: { n: 1 }, txt: '+1 spark' },
      { mods: { dmg: 0.25, jump: 25 }, txt: '+25% damage, longer jumps' },
      { mods: { hops: 2 }, txt: 'Arcs jump to 2 more foes' },
      { mods: { n: 1 }, txt: '+1 spark' },
      { mods: { nova: true }, txt: 'Each chain ends in a burst' },
      { mods: { dmg: 0.25, hops: 3 }, txt: '+25% damage, 3 more jumps' },
    ],
    pair: 'reach', evo: 'stormcrown',
  }, {
    // S.n sparks: the first at the nearest foe, the rest at random foes on screen; each chains S.hops more times within S.jump x area.
    fire(w, p, ws, S) {
      const n = Math.max(1, S.n | 0);
      let any = false;
      for (let i = 0; i < n; i++) {
        const e = i === 0 ? w.nearestFoe(p.x, p.y, S.range) : extraTarget(w, p, S.range);
        if (!e) break;
        any = true; cP = p; cWid = ws.id; cLook = 'spark'; cx = p.x; cy = p.y - 10;
        w.chain(p, ws.id, e, S.hops | 0, S.jump * S.area, S.dmg, CH_OPT);
        if (S.nova) { w.blast(p, ws.id, cx, cy, 40 * S.area, S.dmg * 0.8, NOVA_OPT); vis(w, p, ws.id, 'stormbolt', cx, cy + 6, 40 * S.area, 0.3); }
      }
      return any;
    },
  });

  // Storm Crown: every 0.5 s S.n sky bolts strike (nearest foe, then random foes); from each, arcs fork in two at every hop, S.depth hops deep (1 + 2 + 4 + 8 foes).
  const SEEN = [], FR = [], NX = [];
  const seenF = (f) => SEEN.indexOf(f.id) >= 0;
  const STRIKE = { knock: 60, stun: 0.25, noEv: true };
  const fork = (w, p, ws, S, root) => {
    SEEN.length = 0; FR.length = 0; SEEN.push(root.id); FR.push(root);
    cP = p; cWid = ws.id; cLook = 'spark';
    w.blast(p, ws.id, root.x, root.y, 26 * S.area, S.dmg, STRIKE);
    vis(w, p, ws.id, 'stormbolt', root.x, root.y, 26 * S.area, 0.32);
    const jump = S.jump * S.area, k = S.fork | 0;
    for (let d = 0; d < (S.depth | 0) && FR.length; d++) {
      NX.length = 0;
      for (let i = 0; i < FR.length; i++) {
        const a = FR[i];
        for (let j = 0; j < k; j++) {
          const e = w.nearestFoe(a.x, a.y, jump, seenF); if (!e) break;
          SEEN.push(e.id); NX.push(e);
          cx = a.x; cy = a.y - a.r; segment(w, e.x, e.y - e.r);
          const s = w.src(p, ws.id, 'chain', 30); s.x = a.x; s.y = a.y;
          w.hitFoe(e, S.dmg * 0.75, s);
          if (!e.dead) w.stun(e, 0.15);
        }
      }
      FR.length = 0; for (let i = 0; i < NX.length; i++) FR.push(NX[i]);
    }
  };
  ED.addWeapon({
    id: 'stormcrown', name: 'Storm Crown', icon: 'fx.circle.spark', look: 'spark', sig: null, mode: 'nearest', evolved: true, from: 'chainspark', txt: 'Forking storm every 0.5 s',
    base: { dmg: 26, cd: 0.5, n: 3, pierce: 0, area: 1.2, speed: 0, dur: 0, knock: 30, range: 340, depth: 3, fork: 2, jump: 95 },
    levels: [],
  }, {
    tick(w, p, ws) { aura(w, p, ws, 'crown', 14); },
    fire(w, p, ws, S) {
      const n = Math.max(1, S.n | 0);
      let any = false;
      for (let i = 0; i < n; i++) {
        const e = i === 0 ? w.nearestFoe(p.x, p.y, S.range) : extraTarget(w, p, S.range);
        if (!e) break;
        any = true; fork(w, p, ws, S, e);
      }
      return any;
    },
  });

  // ---------------- Frost Ring / Glacier ----------------
  // Ring zone: radius eases out to R over exp s; the front hits each foe once as it passes (centre distance in (prev, r + 5]). Glacier then holds at R as a frost wall for hold s,
  // ticking every 0.25 s on foes in the band R +- 16. Frozen foes hit again shatter (forced crit). Shards: 8 ice shards fly out from the full ring.
  const ringTick = (w, z) => {
    const s = z.st; if (!s) return;
    const p = z.p, k = Math.min(1, z.t / s.exp), r = s.R * U.easeOut(k), reach = r + 5;
    z.r = Math.max(2, r);
    if (!s.done) {
      const q = w.foeScan(z.x, z.y, reach);
      for (let i = 0; i < q.length; i++) {
        const e = q[i]; if (e.dead) continue;
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (d <= s.prev || d > reach) continue;
        ringHit(w, z, s, e, s.dmg);
      }
      w.foeEnd();
      s.prev = reach;
      if (k >= 1) {
        s.done = true; s.next = z.t;
        w.hitBraziers(z.x, z.y, s.R, p);
        if (s.shards) for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8 + z.id * 0.37, q2 = so();
          q2.look = 'iceshard'; q2.speed = 230; q2.dmg = s.dmg * 0.6; q2.pierce = 2; q2.r = 5; q2.life = 0.55; q2.knock = 40; q2.onHit = shardHit;
          w.shoot(p, z.wid, z.x + Math.cos(a) * s.R, z.y + Math.sin(a) * s.R, a, null, q2);
        }
      }
    } else if (s.hold > 0 && z.t <= s.exp + s.hold && z.t >= s.next) {
      s.next = z.t + 0.25;
      const q = w.foeScan(z.x, z.y, s.R + 18);
      for (let i = 0; i < q.length; i++) {
        const e = q[i]; if (e.dead) continue;
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (Math.abs(d - s.R) <= 16 + e.r) ringHit(w, z, s, e, s.dmg * 0.4);
      }
      w.foeEnd();
    }
  };
  const ringHit = (w, z, s, e, dmg) => {
    const src = w.src(z.p, z.wid, 'weapon', s.knock); src.x = z.x; src.y = z.y;
    if (s.freeze && e.freezeT > 0) src.crit = true;
    w.hitFoe(e, dmg, src);
    if (e.dead) return;
    if (s.freeze) w.freeze(e, s.freeze);
    w.slow(e, s.slowK, s.slowT);
  };
  const shardHit = (w, pr, e) => { if (!e.dead) w.slow(e, 0.5, 1.5); };
  const ringEnd = (w, z) => { if (z.st) { RING.give(z.st); z.st = null; } };
  const ring = (w, p, ws, S, look, follow) => {
    const s = RING.take();
    s.R = S.rad * S.area; s.exp = S.exp; s.prev = -1; s.done = false; s.next = 0; s.hold = S.hold || 0; s.dmg = S.dmg; s.knock = S.knock;
    s.slowK = S.slowK; s.slowT = S.dur; s.freeze = S.freeze ? S.dur : 0; s.shards = !!S.shards;
    const o = zo(); o.look = look; o.x = p.x; o.y = p.y; o.r = 2; o.dur = S.exp + s.hold + 0.3; o.p = p; o.wid = ws.id; o.follow = follow ? p.pid : ''; o.onTick = ringTick; o.onEnd = ringEnd; o.st = s;
    w.zone(o);
  };
  // Ring volley: the first ring at once, the rest 0.22 s apart (ws.st.left).
  const ringVolley = {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.rad * S.area + 30)) return false;
      ring(w, p, ws, S, ED.WEAPONS[ws.id].look, !S.hold);
      ws.st.left = (S.n | 0) - 1; ws.st.t = 0.22;
      return true;
    },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (!(st.left > 0) || (st.t -= dt) > 0) return;
      st.t = 0.22; st.left--;
      ring(w, p, ws, S, ED.WEAPONS[ws.id].look, !S.hold);
    },
  };
  ED.addWeapon({
    id: 'frostring', name: 'Frost Ring', icon: 'fx.ice.burst', look: 'frostring', sig: null, mode: 'around', txt: 'Expanding ring that slows',
    base: { dmg: 12, cd: 2.2, n: 1, pierce: 0, area: 1, speed: 0, dur: 1.5, knock: 90, range: 0, rad: 100, exp: 0.5, slowK: 0.4, shards: false },
    levels: [
      { mods: { area: 0.2 }, txt: '+20% ring size' },
      { mods: { n: 1 }, txt: 'A second ring follows' },
      { mods: { dmg: 0.25, slowK: 0.15 }, txt: '+25% damage, stronger slow' },
      { mods: { area: 0.25 }, txt: '+25% ring size' },
      { mods: { shards: true }, txt: 'Rings burst into ice shards' },
      { mods: { n: 1 }, txt: '+1 ring' },
      { mods: { dmg: 0.25, area: 0.2 }, txt: '+25% damage, +20% ring size' },
    ],
    pair: 'reach', evo: 'glacier', noAmount: true,
  }, ringVolley);
  ED.addWeapon({
    id: 'glacier', name: 'Glacier', icon: 'fxbig.freezing', look: 'glacier', sig: null, mode: 'around', evolved: true, from: 'frostring', txt: 'Rings freeze foes solid', noAmount: true,
    base: { dmg: 30, cd: 2.4, n: 2, pierce: 0, area: 1.25, speed: 0, dur: 1.5, knock: 60, range: 0, rad: 120, exp: 0.7, hold: 1.2, slowK: 0.6, freeze: true, shards: true },
    levels: [],
  }, ringVolley);

  // ---------------- Bramble Trail / Thornwood ----------------
  // Thorn patches are damage zones (S.dmg per 0.5 s tick, first tick at once). Walking drops a patch every S.gap x area px (S.rows wide); fire() lashes a line of S.n patches
  // along the facing direction (S.back: also behind; with or without foes near), erupting 0.04 s apart. Thornwood: patches persist and grab (stun per tick), and fire() erupts a ring of patches around the hero.
  const patch = (w, p, ws, S, x, y) => {
    if (ED.Arena.blocked(w.arena, x, y, 2)) return;
    const st = ws.st, o = zo();
    o.look = S.grab ? 'thicket' : 'bramble'; o.x = x; o.y = y; o.r = S.size * S.area; o.dur = S.dur; o.dps = S.dmg * 2; o.tick = 0.5; o.p = p; o.wid = ws.id;
    if (S.slowK > 0) o.slow = pair2(st, 'slowA', S.slowK, 1);
    if (S.grab) o.stun = S.grab;
    w.zone(o);
  };
  // Row of patches across direction a at (x, y): S.rows thorns spaced 15 x area.
  const row = (w, p, ws, S, x, y, a) => {
    const m = Math.max(1, S.rows | 0), gap = 15 * S.area, nx = -Math.sin(a), ny = Math.cos(a);
    for (let i = 0; i < m; i++) { const o = (i - (m - 1) / 2) * gap; patch(w, p, ws, S, x + nx * o, y + ny * o); }
  };
  const bramble = {
    fire(w, p, ws, S) {
      const st = ws.st;
      st.qi = 0; st.qn = Math.max(1, S.n | 0); st.qt = 0; st.qa = p.mdir; st.qx = p.x; st.qy = p.y;
      return true;
    },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (st.lx === undefined) { st.lx = p.x; st.ly = p.y; st.qi = st.qn = 0; }
      const gap = S.gap * S.area;
      if (U.dist2(p.x, p.y, st.lx, st.ly) >= gap * gap) { row(w, p, ws, S, p.x, p.y, Math.atan2(p.y - st.ly, p.x - st.lx)); st.lx = p.x; st.ly = p.y; }
      if (st.qi < st.qn) st.qt -= dt;
      while (st.qi < st.qn && st.qt <= 0) {
        st.qt += 0.04;
        const i = st.qi++;
        if (S.grab) { // ring eruption, around the circle
          const a = st.qa + i * TAU / st.qn, R = 58 * S.area;
          patch(w, p, ws, S, st.qx + Math.cos(a) * R, st.qy + Math.sin(a) * R);
          patch(w, p, ws, S, st.qx + Math.cos(a + 0.3) * R * 1.6, st.qy + Math.sin(a + 0.3) * R * 1.6);
        } else {
          const d = 26 + i * 20 * S.area, a = st.qa;
          row(w, p, ws, S, st.qx + Math.cos(a) * d, st.qy + Math.sin(a) * d, a);
          if (S.back) row(w, p, ws, S, st.qx - Math.cos(a) * d, st.qy - Math.sin(a) * d, a);
        }
      }
    },
  };
  ED.addWeapon({
    id: 'bramble', name: 'Bramble Trail', icon: 'proj.thorn', look: 'bramble', sig: null, mode: 'facing', txt: 'Thorns erupt where you walk',
    base: { dmg: 6, cd: 1.4, n: 4, pierce: 0, area: 1, speed: 0, dur: 2.0, knock: 0, range: 0, gap: 24, size: 13, rows: 1, slowK: 0, back: false, grab: 0 },
    levels: [
      { mods: { n: 2 }, txt: 'Thorn lash reaches 2 further' },
      { mods: { area: 0.25 }, txt: '+25% thorn size' },
      { mods: { dmg: 0.25, dur: 0.4 }, txt: '+25% damage, thorns last longer' },
      { mods: { rows: 2 }, txt: 'Thorns grow 3 wide' },
      { mods: { slowK: 0.35 }, txt: 'Thorns slow foes' },
      { mods: { back: true }, txt: 'Also lashes behind you' },
      { mods: { dmg: 0.25, n: 2 }, txt: '+25% damage, lash 2 longer' },
    ],
    pair: 'duration', evo: 'thornwood',
  }, bramble);
  ED.addWeapon({
    id: 'thornwood', name: 'Thornwood', icon: 'fx.glyph.corroded', look: 'thicket', sig: null, mode: 'facing', evolved: true, from: 'bramble', txt: 'Thickets persist and grab',
    base: { dmg: 16, cd: 2.0, n: 10, pierce: 0, area: 1.25, speed: 0, dur: 6, knock: 0, range: 0, gap: 20, size: 15, rows: 3, slowK: 0.5, back: false, grab: 0.35 },
    levels: [],
  }, bramble);

  // ---------------- Glaive / Twin Moons ----------------
  // Glaive: S.n boomerangs fanned 0.45 rad apart at the nearest foe, out S.range / 2 and back, piercing all; each foe is hit once out and once back.
  // S.hover: at the far end it spins in place for 0.45 s, hitting every 0.12 s.
  const HOVER = 0.45;
  const hoverTick = (w, pr) => {
    const s = pr.st; if (!s) return;
    if (!s.h && !pr.back && pr.t >= pr.out) { s.h = true; pr.out += HOVER; pr.life += HOVER; pr.rehit = 0.12; pr.hitClr = pr.t; }
    if (s.h && !pr.back) { pr.vx = 0; pr.vy = 0; }
    else if (pr.back && pr.rehit) pr.rehit = 0;
  };
  const hoverEnd = (w, pr) => { if (pr.st) { HOV.give(pr.st); pr.st = null; } };
  ED.addWeapon({
    id: 'glaive', name: 'Glaive', icon: 'weapon.glaive', look: 'glaive', sig: null, mode: 'nearest', txt: 'Boomerang out and back, pierces',
    base: { dmg: 15, cd: 1.6, n: 1, pierce: 0, area: 1, speed: 240, dur: 0, knock: 60, range: 340, hover: false },
    levels: [
      { mods: { n: 1 }, txt: '+1 glaive' },
      { mods: { area: 0.3 }, txt: '+30% glaive size' },
      { mods: { dmg: 0.25, range: 0.25 }, txt: '+25% damage, flies 25% further' },
      { mods: { n: 1 }, txt: '+1 glaive' },
      { mods: { hover: true }, txt: 'Glaives spin at the far end' },
      { mods: { n: 1 }, txt: '+1 glaive' },
      { mods: { dmg: 0.25, area: 0.3 }, txt: '+25% damage, +30% glaive size' },
    ],
    pair: 'velocity', evo: 'twinmoons',
  }, {
    fire(w, p, ws, S) {
      const t = w.nearestFoe(p.x, p.y, S.range * 0.5 + 40); if (!t) return false;
      const a = Math.atan2(t.y - p.y, t.x - p.x), n = Math.max(1, S.n | 0);
      for (let i = 0; i < n; i++) {
        const q = so(); q.look = 'glaive'; q.r = 9 * S.area; q.ret = true; q.pierce = 1e9;
        if (S.hover) { const s = HOV.take(); s.h = false; q.st = s; q.tick = hoverTick; q.onEnd = hoverEnd; }
        w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.45, S, q);
      }
      return true;
    },
  });
  // Twin Moons: two counter-rotating rings of S.n glaives each (second ring offset half a gap) spiral out to R and back in over each S.cd cycle, re-hitting every 0.25 s.
  ED.addWeapon({
    id: 'twinmoons', name: 'Twin Moons', icon: 'fxbig.midnight', look: 'moon', sig: null, mode: 'around', evolved: true, from: 'glaive', txt: 'Two glaive pairs spiral both ways',
    base: { dmg: 28, cd: 2.6, n: 2, pierce: 0, area: 1.3, speed: 5.2, dur: 0, knock: 80, range: 0, rad: 150 },
    levels: [],
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.rad * S.area + 60)) return false;
      const st = tracked(ws.st), n = Math.max(1, S.n | 0);
      killAll(st, ORB.give);
      const o = orbOpt(13 * S.area, 0.25, S.knock, 0, 0, false, S.cd);
      orbRing(w, p, ws, S, n, S.rad * S.area, 1, 0, 'moon', S.cd, o);
      orbRing(w, p, ws, S, n, S.rad * S.area, -1, Math.PI / n, 'moon', S.cd, o);
      return true;
    },
  });

  // ---------------- Meteor Call / Starfall ----------------
  // Impacts are team 0 warn zones (fall s, then S.dmg in r with knockback and burn); onEnd adds the blast visual, braziers, an optional burning crater and optional ember shards.
  const impact = (w, z) => {
    const s = z.st; if (!s) return;
    const p = z.p;
    vis(w, p, z.wid, 'mboom', z.x, z.y, z.r, 0.45);
    w.hitBraziers(z.x, z.y, z.r, p);
    if (s.crater) {
      const o = zo(); o.look = 'crater'; o.x = z.x; o.y = z.y; o.r = z.r * 0.8; o.dur = s.dur; o.dps = s.dmg * 0.6; o.tick = 0.5; o.tickDelay = 0.5; o.p = p; o.wid = z.wid; o.burn = s.burn;
      w.zone(o);
    }
    if (s.shards) for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5 + z.id * 0.61, q = so();
      q.look = 'ember'; q.speed = 190; q.dmg = s.dmg * 0.4; q.pierce = 1; q.r = 4; q.life = 0.45; q.knock = 30;
      w.shoot(p, z.wid, z.x, z.y, a, null, q);
    }
    DROP.give(s); z.st = null;
  };
  const drop = (w, p, ws, S, x, y, look, r, dmg, fall, crater, shards) => {
    const s = DROP.take();
    s.crater = crater; s.shards = shards; s.dmg = dmg; s.dur = Math.max(1, S.dur); s.burn = pair2(ws.st, 'burnA', S.dmg * 0.3, 2);
    const o = zo(); o.warn = true; o.look = look; o.x = x; o.y = y; o.r = r; o.dur = fall; o.dmg = dmg; o.knock = S.knock; o.burn = s.burn; o.p = p; o.wid = ws.id; o.st = s; o.onEnd = impact;
    w.zone(o);
  };
  ED.addWeapon({
    id: 'meteorcall', name: 'Meteor Call', icon: 'proj.fireball', look: 'meteor', sig: null, mode: 'random', txt: 'Meteors fall on random foes',
    base: { dmg: 24, cd: 2.4, n: 1, pierce: 0, area: 1, speed: 0, dur: 2, knock: 160, range: 420, fall: 0.75, size: 34, crater: false, shards: false },
    levels: [
      { mods: { n: 1 }, txt: '+1 meteor' },
      { mods: { area: 0.25 }, txt: '+25% impact size' },
      { mods: { dmg: 0.25, crater: true }, txt: '+25% damage, impacts leave fire' },
      { mods: { n: 1 }, txt: '+1 meteor' },
      { mods: { shards: true }, txt: 'Impacts throw burning shards' },
      { mods: { n: 1 }, txt: '+1 meteor' },
      { mods: { dmg: 0.25, area: 0.25 }, txt: '+25% damage, +25% impact size' },
    ],
    pair: 'multishot', evo: 'starfall',
  }, {
    fire(w, p, ws, S) {
      const n = Math.max(1, S.n | 0);
      let any = false;
      for (let i = 0; i < n; i++) {
        const e = w.target('random', p, S.range); if (!e) break;
        any = true;
        drop(w, p, ws, S, e.x + w.rng.range(-8, 8), e.y + w.rng.range(-8, 8), 'meteor', S.size * S.area, S.dmg, S.fall, !!S.crater, !!S.shards);
      }
      return any;
    },
  });
  // Starfall: a constant shower: S.n stars on random foes every 0.28 s; every S.comet-th volley a comet hits the densest cluster (x3 damage, 2x size, burning crater).
  ED.addWeapon({
    id: 'starfall', name: 'Starfall', icon: 'fx.spark.magic', look: 'star', sig: null, mode: 'random', evolved: true, from: 'meteorcall', txt: 'A constant shower of stars',
    base: { dmg: 22, cd: 0.28, n: 2, pierce: 0, area: 1.2, speed: 0, dur: 2.5, knock: 110, range: 440, fall: 0.5, size: 24, comet: 6 },
    levels: [],
  }, {
    fire(w, p, ws, S) {
      const n = Math.max(1, S.n | 0), st = ws.st;
      let any = false;
      for (let i = 0; i < n; i++) {
        const e = w.target('random', p, S.range); if (!e) break;
        any = true;
        drop(w, p, ws, S, e.x + w.rng.range(-10, 10), e.y + w.rng.range(-10, 10), 'star', S.size * S.area, S.dmg, S.fall, false, false);
      }
      if (!any) return false;
      st.k = ((st.k | 0) + 1) % Math.max(1, S.comet | 0);
      if (st.k === 0) { const c = w.densest(p.x, p.y, S.range); if (c) drop(w, p, ws, S, c.x, c.y, 'comet', S.size * S.area * 2.4, S.dmg * 3, 0.9, true, true); }
      return true;
    },
  });
})(globalThis.ED || (globalThis.ED = {}));
