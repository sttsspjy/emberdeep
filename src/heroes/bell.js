// Bell (controller / tank): hero data, signature Toll and its Forms, Q Great Peal. Design and numbers: docs/heroes/bell.md.
// Toll: bells orbit the hero; every cd each bell peals a shockwave ring. Paths: Peal (bigger echoing rings that stun), Resonance (chill, ice bursts on ring kills, frost ground,
// bonus vs held foes), Pendulum (wide swinging orbit, more and heavier bells). Forms: Cathedral (Peal; bells peal in sequence, then great rings from the hero), Glacier Toll
// (Resonance; rings freeze, the next ring shatters the frozen), Carillon (Pendulum; a wheel of bells sweeps out and back), Undertow (Peal + Pendulum; a ring closes in, dragging
// the horde onto the bells, then a stunning clap), Windchime (Resonance + Pendulum; bells drop chimes that keep ringing where they fell).
// Waves are team 0 zones whose radius moves from R0 to R; every foe the front reaches is hit once (per-wave id Set, pooled state). Bells, frost ground and chimes are zones, so
// clients see them through the zone snapshot. Zone looks: tollb glacb carb cathb (bells), tollw tollf cathw glacw underw chimew pealw (rings), rime (frost ground), chime.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('tollb', 'tollw', 'cathb', 'cathw', 'pealw', 'tollf', 'rime', 'glacb', 'glacw', 'carb', 'underw', 'chime', 'chimew');

  ED.addHero({ id: 'bell', name: 'Bellwarden', hp: 115, speed: 69, crit: 0.05, sig: 'toll', skills: ['peal'], icon: 'hero.bell.idle', col: '#e6c27a', txt: 'Peals that push the horde back.' });

  // Zone options (scratch, reset by zopt; w.zone copies them).
  const ZO = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0, dps: 0, tick: 0.5, knock: 0, slow: null, look: '', st: null, onTick: null, onEnd: null };
  const zopt = (p, wid, x, y, r, dur, dps, knock, look) => {
    ZO.p = p; ZO.wid = wid; ZO.x = x; ZO.y = y; ZO.r = r; ZO.dur = dur; ZO.dps = dps; ZO.knock = knock; ZO.look = look;
    ZO.tick = 0.5; ZO.slow = null; ZO.st = null; ZO.onTick = null; ZO.onEnd = null;
    return ZO;
  };
  // Every bell weapon hit (rings, bodies) on a big foe (radius >= BIG_R: brutes, elites, bosses) deals x BIG_K.
  const BIG_R = 12, BIG_K = 3;

  // ---------------- waves ----------------
  // Wave options (scratch; wopt resets, wave copies): R0 start radius, R end radius (R < R0: the ring closes in), dur s (ease out) after delay s, dmg, stun s, knock (away from the centre),
  // pull (> 0: pull every foe reached toward that radius instead; a foe that cannot be moved (boss, no knockback) takes x crush), slow k (2 s), freeze s, res (+dmg share vs slowed / stunned / frozen foes), shatter (+dmg share vs frozen foes,
  // then a shard burst and the ice breaks), shard (ring kills burst in shards).
  const WO = { R0: 0, R: 0, dur: 0, delay: 0, dmg: 0, stun: 0, knock: 0, pull: 0, slow: 0, freeze: 0, res: 0, shatter: 0, shard: 0, crush: 0 };
  const wopt = (R0, R, dur, dmg) => {
    WO.R0 = R0; WO.R = R; WO.dur = dur; WO.dmg = dmg;
    WO.delay = WO.stun = WO.knock = WO.pull = WO.slow = WO.freeze = WO.res = WO.shatter = WO.shard = WO.crush = 0;
    return WO;
  };
  const WST = [];
  // Spawns a wave from WO at (x, y) for hero p / weapon wid (hit kind 'weapon' or 'skill'). Returns the zone.
  function wave(w, p, wid, x, y, look, kind) {
    const st = WST.pop() || { hits: new Set() };
    st.hits.clear(); for (const k in WO) st[k] = WO[k]; st.kind = kind;
    const zo = zopt(p, wid, x, y, Math.max(1, WO.R0), WO.delay + WO.dur, 0, 0, look); zo.st = st; zo.onTick = waveTick; zo.onEnd = waveEnd;
    return w.zone(zo);
  }
  const SHARD = { slow: [0.4, 1.5], look: 'frost', kind: 'weapon' };
  // Ice burst at foe e: 26 px, 40% of the ring's damage, chills.
  const burst = (w, z, s, e) => w.blast(z.p, z.wid, e.x, e.y, 26, s.dmg * 0.4, SHARD);
  function waveTick(w, z) {
    const s = z.st, k = (z.t - s.delay) / s.dur;
    if (k < 0) return;
    const r = s.R0 + (s.R - s.R0) * U.easeOut(Math.min(1, k)), inward = s.R < s.R0, p = z.p;
    z.r = Math.max(1, r);
    const q = w.foeScan(z.x, z.y, inward ? s.R0 : r);
    for (let i = 0; i < q.length; i++) {
      const e = q[i]; if (e.dead || s.hits.has(e.id)) continue;
      const d2 = U.dist2(z.x, z.y, e.x, e.y), ro = (inward ? s.R0 : r) + e.r;
      if (d2 > ro * ro || (inward && r > e.r && d2 < (r - e.r) * (r - e.r))) continue;
      if (p && !ED.inView(p, e.x, e.y, e.r)) continue; // status and push follow the damage rule: only inside the hero's view
      s.hits.add(e.id);
      const held = e.freezeT > 0, shat = s.shatter > 0 && held;
      let m = shat ? 1 + s.shatter : s.res && (held || e.stunT > 0 || e.slowT > 0) ? 1 + s.res : 1;
      if (e.r >= BIG_R && s.kind === 'weapon') m *= BIG_K;
      if (s.crush > 0 && (e.boss || !(e.def.kb > 0))) m *= s.crush;
      const src = w.src(p, z.wid, s.kind, s.knock); src.x = z.x; src.y = z.y;
      // knock decays at 10/s, so travel ~ force / 10: a push carries a foe at most to the ring's rim (+6 px); a pull drags it toward radius s.pull
      if (s.pull > 0) { const d = Math.sqrt(d2); src.knock = d > s.pull ? (d - s.pull) * 9 : 0; src.kx = z.x - e.x; src.ky = z.y - e.y; }
      else if (s.knock > 0) src.knock = Math.min(s.knock, Math.max(0, s.R + 6 - Math.sqrt(d2)) * 10);
      w.hitFoe(e, s.dmg * m, src);
      if (shat) { e.freezeT = 0; burst(w, z, s, e); continue; }
      if (e.dead) { if (s.shard) burst(w, z, s, e); continue; }
      if (s.stun) w.stun(e, s.stun);
      if (s.slow) w.slow(e, s.slow, 2);
      if (s.freeze) w.freeze(e, s.freeze);
    }
    w.foeEnd();
  }
  function waveEnd(w, z) { const s = z.st; if (s.R >= s.R0) w.hitBraziers(z.x, z.y, s.R, z.p); s.hits.clear(); WST.push(s); z.st = null; }

  // ---------------- bells, frost ground ----------------
  // Keeps st.bells[i] = { z, id, hits, clr } (i < n) alive on a circle of radius R around the hero (angle st.ang + i x TAU / n, st.ang turning spin rad/s);
  // each bell body hits every foe it touches once per BODY_T s (dps x BODY_T, push 120 away from the bell). Bells past n end.
  const BODY_T = 0.4;
  function orbit(w, p, ws, n, R, spin, dps, br, dt, look) {
    const st = ws.st;
    if (!st.bells) { st.bells = []; st.ang = 0; }
    n = Math.max(1, n | 0);
    st.ang = (st.ang + spin * dt) % TAU;
    for (let i = 0; i < n; i++) {
      let b = st.bells[i];
      if (!b) b = st.bells[i] = { z: null, id: 0, hits: new Set(), clr: 0 };
      const a = st.ang + i * TAU / n, x = p.x + Math.cos(a) * R, y = p.y - 6 + Math.sin(a) * R;
      let z = b.z;
      if (!z || z.dead || z.id !== b.id) { z = b.z = w.zone(zopt(p, ws.id, x, y, br, 0.25, 0, 0, look)); b.id = z.id; }
      z.x = x; z.y = y; z.t = 0; z.a = a; z.r = br;
      if ((b.clr -= dt) <= 0) { b.clr = BODY_T; b.hits.clear(); }
      if (!(dps > 0)) continue;
      const q = w.foeScan(x, y, br + 32);
      for (let k = 0; k < q.length; k++) {
        const e = q[k]; if (e.dead || b.hits.has(e.id)) continue;
        const rr = br + e.r; if (U.dist2(x, y, e.x, e.y) > rr * rr) continue;
        b.hits.add(e.id);
        const s = w.src(p, ws.id, 'weapon', 120); s.x = x; s.y = y;
        w.hitFoe(e, dps * BODY_T * (e.r >= BIG_R ? BIG_K : 1), s);
      }
      w.foeEnd();
    }
    for (let i = n; i < st.bells.length; i++) { const b = st.bells[i]; if (b && b.z && b.z.id === b.id) b.z.dur = 0; }
    st.bells.length = Math.min(st.bells.length, n);
  }
  // Live bell zone i of slot ws, or null.
  const bell = (ws, i) => { const b = ws.st.bells && ws.st.bells[i]; return b && b.z && b.z.id === b.id && !b.z.dead ? b.z : null; };
  const RIME_SLOW = [0.45, 0.6];
  // A peal of radius R from (x, y) with the slot's ring numbers (stun, knock, chill, res, shard, freeze, shatter) at dmgK x S.dmg; S.echo: a wider, weaker ring 0.25 s later;
  // S.frost: frost ground (radius R / 2, max 48 px) for 2 s, S.dmg x 0.6 x frost per s, slows.
  function peal(w, p, ws, S, x, y, R, dur, dmgK, look) {
    const o = wopt(0, R, dur, S.dmg * dmgK);
    o.stun = S.stun || 0; o.knock = S.knock; o.slow = S.chill || 0; o.res = S.res || 0; o.shard = S.shard || 0; o.freeze = S.freeze || 0; o.shatter = S.shatter || 0;
    wave(w, p, ws.id, x, y, look, 'weapon');
    if (S.echo) { o.R = R * 1.35; o.dur = dur * 1.2; o.delay = 0.25; o.dmg *= 0.6; o.knock = 0; o.freeze = o.shatter = 0; wave(w, p, ws.id, x, y, look, 'weapon'); }
    if (S.frost > 0) { const zo = zopt(p, ws.id, x, y, Math.min(48, R * 0.5), 2, S.dmg * 0.6 * S.frost, 0, 'rime'); zo.slow = RIME_SLOW; w.zone(zo); }
  }
  // Toll-style orbit radius: S.orbit x sqrt(area); S.swing: swings out and back (0.5x .. 1.5x, 2.4 rad/s).
  function tollR(ws, S, dt) {
    const st = ws.st;
    st.ph = ((st.ph || 0) + 2.4 * dt) % TAU;
    return S.orbit * Math.sqrt(S.area) * (S.swing > 0 ? 1 + 0.5 * Math.sin(st.ph) : 1);
  }
  // Every bell of slot ws peals (peal() at each live bell).
  function pealAll(w, p, ws, S, dur, dmgK, look) {
    const R = S.r * S.area;
    for (let i = 0; i < Math.max(1, S.n | 0); i++) { const z = bell(ws, i); if (z) peal(w, p, ws, S, z.x, z.y, R, dur, dmgK, look); }
  }

  // ---------------- Toll ----------------
  // S.n bells orbit (tollR, spin rad/s, bodies S.dmg x S.body per s); every cd each bell peals a ring of S.r x area px, foes near or not (frost look once rings chill).
  ED.addWeapon({
    id: 'toll', name: 'Toll', icon: 'weapon.bronzebell', sig: 'bell', mode: 'around', txt: 'A bell orbits you; peals push foes',
    base: { dmg: 9, cd: 1.5, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 160, range: 0, r: 70, orbit: 32, spin: 2.4, body: 0.5, stun: 0, echo: 0, chill: 0, shard: 0, frost: 0, res: 0, swing: 0 },
    paths: [
      { id: 'peal', name: 'Peal', form: 'cathedral', ranks: [
        { mods: { area: 0.3, knock: 0.5 }, txt: '+30% ring size, rings push harder' },
        { mods: { echo: 1 }, txt: 'Each peal echoes in a wider ring' },
        { mods: { stun: 0.5, cd: -0.15 }, txt: 'Rings stun 0.5 s, peal 15% faster' }] },
      { id: 'resonance', name: 'Resonance', form: 'glaciertoll', ranks: [
        { mods: { chill: 0.4 }, txt: 'Rings chill foes, slowing them 40%' },
        { mods: { shard: 1 }, txt: 'Foes slain by rings burst into ice' },
        { mods: { frost: 1, res: 0.4 }, txt: 'Peals leave frost; +40% vs chilled foes' }] },
      { id: 'pendulum', name: 'Pendulum', form: 'carillon', ranks: [
        { mods: { orbit: 40, body: 1 }, txt: 'Bell swings wide and hits harder' },
        { mods: { n: 1 }, txt: '+1 bell' },
        { mods: { n: 1, swing: 1 }, txt: '+1 bell, bells swing out and back' }] },
    ],
    hybrids: [{ need: [0, 2], form: 'undertow' }, { need: [1, 2], form: 'windchime' }], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) { orbit(w, p, ws, S.n, tollR(ws, S, dt), S.spin, S.dmg * S.body, 10, dt, 'tollb'); },
    fire(w, p, ws, S) { pealAll(w, p, ws, S, 0.3, 1, S.chill > 0 ? 'tollf' : 'tollw'); return true; },
  });

  // Cathedral: great bells; each fire peals them in sequence 0.18 s apart, then S.great great rings (S.r x area x 2, 75% damage, 0.35 s apart) burst from the hero.
  ED.addWeapon({
    id: 'cathedral', name: 'Cathedral', icon: 'weapon.greatbell', sig: 'bell', mode: 'around', evolved: true, form: true, from: 'toll', txt: 'Great bells peal in sequence',
    base: { dmg: 18, cd: 1.6, n: 4, pierce: 0, area: 1, speed: 0, dur: 0, knock: 300, range: 0, r: 84, orbit: 62, spin: 1.7, body: 0.8, stun: 0.2, great: 1 },
    refine: [
      { mods: { great: 1 }, txt: 'The great ring tolls twice' },
      { mods: { area: 0.25 }, txt: '+25% ring size' },
    ], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) {
      orbit(w, p, ws, S.n, tollR(ws, S, dt), S.spin, S.dmg * S.body, 13, dt, 'cathb');
      const st = ws.st;
      if (!(st.seq > 0) || (st.seqT -= dt) > 0) return;
      st.seqT = 0.18;
      const i = (S.n | 0) - st.seq, z = bell(ws, i);
      st.seq--;
      if (z) peal(w, p, ws, S, z.x, z.y, S.r * S.area, 0.32, 1, 'cathw');
      if (st.seq) return;
      const o = wopt(0, S.r * S.area * 2, 0.5, S.dmg * 0.75);
      o.stun = S.stun || 0; o.knock = S.knock; o.slow = S.chill || 0; o.res = S.res || 0; o.shard = S.shard || 0;
      for (let g = 0; g < Math.max(1, S.great | 0); g++) { o.delay = g * 0.35; wave(w, p, ws.id, p.x, p.y - 6, 'cathw', 'weapon'); }
    },
    fire(w, p, ws, S) { ws.st.seq = Math.max(1, S.n | 0); ws.st.seqT = 0; return true; },
  });

  // ---------------- Great Peal ----------------
  // A ring from the hero out to N.r (about the screen's half diagonal) in N.t s: N.dmg, N.stun s and a push to every foe it reaches; echo: a second ring, 25% wider, 0.55 s later;
  // ward: every living hero within N.r is invulnerable for N.ward s; gems: every xp gem within N.r flies to the hero.
  ED.addSkill({
    id: 'peal', name: 'Great Peal', icon: 'weapon.greatbell', cd: 16, txt: 'Stun every foe on screen',
    base: { dmg: 10, r: 370, t: 0.5, stun: 1.2, knock: 180 },
    levels: [
      { mods: { echo: true }, txt: 'A second, wider peal follows' },
      { mods: { ward: 1.5 }, txt: 'Shields you and allies for 1.5 s' },
      { mods: { gems: true, stun: 0.5 }, txt: 'Pulls gems; stuns 0.5 s longer' },
    ],
  }, (w, p, x, y, N) => {
    let o = wopt(0, N.r, N.t, N.dmg); o.stun = N.stun; o.knock = N.knock; o.res = 0.5;
    wave(w, p, 'peal', p.x, p.y - 6, 'pealw', 'skill');
    if (N.echo) { o = wopt(0, N.r * 1.25, N.t * 1.2, N.dmg * 0.75); o.stun = N.stun * 0.75; o.knock = N.knock; o.res = 0.5; o.delay = 0.55; wave(w, p, 'peal', p.x, p.y - 6, 'pealw', 'skill'); }
    const r2 = N.r * N.r;
    if (N.ward > 0) for (const h of w.living) if (U.dist2(p.x, p.y, h.x, h.y) <= r2) h.invuln = Math.max(h.invuln, N.ward);
    if (N.gems) for (const g of w.pickups) if (!g.dead && g.k.charCodeAt(0) === 120 && U.dist2(p.x, p.y, g.x, g.y) <= r2) { g.pull = p.pid; g.t = 0; } // 120 'x': xp gems
    return { shake: 7 };
  });

  // ---------------- Glacier Toll ----------------
  // Frost bells; every cd each peals a slow frost ring (0.45 s) that freezes foes S.freeze s; a frozen foe a later ring reaches takes +S.shatter damage, bursts in shards and thaws.
  ED.addWeapon({
    id: 'glaciertoll', name: 'Glacier Toll', icon: 'weapon.bronzebell', sig: 'bell', mode: 'around', evolved: true, form: true, from: 'toll', txt: 'Peals freeze foes solid',
    base: { dmg: 12, cd: 1.4, n: 3, pierce: 0, area: 1, speed: 0, dur: 0, knock: 40, range: 0, r: 78, orbit: 50, spin: 2.0, body: 0.6, freeze: 1.1, shatter: 0.6 },
    refine: [
      { mods: { n: 1 }, txt: '+1 frost bell' },
      { mods: { area: 0.2, freeze: 0.5 }, txt: '+20% ring size, freeze 0.5 s longer' },
    ], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) { orbit(w, p, ws, S.n, tollR(ws, S, dt), S.spin, S.dmg * S.body, 11, dt, 'glacb'); },
    fire(w, p, ws, S) { pealAll(w, p, ws, S, 0.45, 1, 'glacw'); return true; },
  });

  // ---------------- Carillon ----------------
  // A wheel of S.n bells spins fast (bodies S.dmg x S.body per s, bigger bells); each fire every bell chimes a small ring (S.r x area, 80% damage) from the inner rest radius,
  // then the wheel swells from 0.6x to (0.6 + S.swell)x its orbit and back over 0.8 s.
  ED.addWeapon({
    id: 'carillon', name: 'Carillon', icon: 'weapon.handbells', sig: 'bell', mode: 'around', evolved: true, form: true, from: 'toll', txt: 'A wheel of bells sweeps out and back',
    base: { dmg: 16, cd: 1.3, n: 4, pierce: 0, area: 1, speed: 0, dur: 0, knock: 160, range: 0, r: 40, orbit: 40, spin: 3.2, body: 2, swell: 0.9 },
    refine: [
      { mods: { n: 2 }, txt: '+2 bells' },
      { mods: { spin: 1.2, swell: 0.35 }, txt: 'Bells whirl faster and swing wider' },
    ], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      st.sw = (st.sw || 0) + dt;
      const k = Math.min(1, st.sw / 0.8);
      orbit(w, p, ws, S.n, S.orbit * Math.sqrt(S.area) * (0.6 + S.swell * Math.sin(Math.PI * k)), S.spin, S.dmg * S.body, 12, dt, 'carb');
    },
    fire(w, p, ws, S) { pealAll(w, p, ws, S, 0.2, 0.8, 'chimew'); ws.st.sw = 0; return true; },
  });

  // ---------------- Undertow ----------------
  // Bells hold a fixed orbit (S.orbit x sqrt(area) x 0.75); each fire a ring closes in from S.r x area x 2.2 to the hero over 0.5 s (80% damage), dragging every foe it reaches
  // toward the bells' orbit; then a clap ring from the hero out to the orbit + 26 px (60% damage) stuns them S.stun + 0.4 s.
  ED.addWeapon({
    id: 'undertow', name: 'Undertow', icon: 'weapon.greatbell', sig: 'bell', mode: 'around', evolved: true, form: true, from: 'toll', txt: 'Peals drag the horde onto your bells',
    base: { dmg: 14, cd: 1.6, n: 2, pierce: 0, area: 1, speed: 0, dur: 0, knock: 60, range: 0, r: 80, orbit: 44, spin: 2.6, body: 1, stun: 0 },
    refine: [
      { mods: { n: 1 }, txt: '+1 bell' },
      { mods: { area: 0.25 }, txt: 'Drags from 25% farther' },
    ], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) { orbit(w, p, ws, S.n, S.orbit * Math.sqrt(S.area) * 0.75, S.spin, S.dmg * S.body, 13, dt, 'tollb'); },
    fire(w, p, ws, S) {
      const Ro = S.orbit * Math.sqrt(S.area) * 0.75;
      let o = wopt(S.r * S.area * 2.2, 12, 0.5, S.dmg * 0.8);
      o.pull = Ro; o.crush = 6; o.slow = S.chill || 0; o.res = S.res || 0; o.shard = S.shard || 0;
      wave(w, p, ws.id, p.x, p.y - 6, 'underw', 'weapon');
      o = wopt(0, Ro + 26, 0.2, S.dmg * 0.6);
      o.delay = 0.5; o.stun = (S.stun || 0) + 0.4; o.knock = S.knock; o.res = S.res || 0; o.shard = S.shard || 0;
      wave(w, p, ws.id, p.x, p.y - 6, 'cathw', 'weapon');
      return true;
    },
  });

  // ---------------- Windchime ----------------
  // Bells orbit (toll-style); each fire every bell drops a chime where it is (S.dur s); a chime rings every 0.6 s: a ring of S.r x area px at 55% damage with the slot's chill, res, shard.
  const CHS = [];
  function chimeTick(w, z) {
    const c = z.st;
    if (z.t < c.next) return;
    c.next += 0.6;
    const o = wopt(0, c.R, 0.22, c.dmg); o.knock = 60; o.slow = c.slow; o.res = c.res; o.shard = c.shard;
    wave(w, z.p, z.wid, z.x, z.y, 'chimew', 'weapon');
  }
  function chimeEnd(w, z) { CHS.push(z.st); z.st = null; }
  ED.addWeapon({
    id: 'windchime', name: 'Windchime', icon: 'weapon.handbells', sig: 'bell', mode: 'around', evolved: true, form: true, from: 'toll', txt: 'Bells leave chimes that keep ringing',
    base: { dmg: 16, cd: 1.3, n: 1, pierce: 0, area: 1, speed: 0, dur: 4, knock: 60, range: 0, r: 44, orbit: 46, spin: 2.4, body: 1 },
    refine: [
      { mods: { n: 1 }, txt: '+1 bell, one more chime' },
      { mods: { dur: 0.5 }, txt: 'Chimes ring 50% longer' },
    ], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) { orbit(w, p, ws, S.n, tollR(ws, S, dt), S.spin, S.dmg * S.body, 10, dt, 'tollb'); },
    fire(w, p, ws, S) {
      for (let i = 0; i < Math.max(1, S.n | 0); i++) {
        const b = bell(ws, i); if (!b) continue;
        const c = CHS.pop() || { next: 0, R: 0, dmg: 0, slow: 0, res: 0, shard: 0 };
        c.next = 0.15; c.R = S.r * S.area; c.dmg = S.dmg * 0.55; c.slow = S.chill || 0; c.res = S.res || 0; c.shard = S.shard || 0;
        const zo = zopt(p, ws.id, b.x, b.y + 6, 8, S.dur, 0, 0, 'chime'); zo.st = c; zo.onTick = chimeTick; zo.onEnd = chimeEnd;
        w.zone(zo);
      }
      return true;
    },
  });
})(globalThis.ED || (globalThis.ED = {}));
