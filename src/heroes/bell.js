// Bell: hero data, signature Toll (orbiting bells whose peals send travelling shockwave rings; 3 paths x 3 ranks) + Form Cathedral (path 0; three bells peal in sequence, then a great ring), Q Great Peal.
// Waves are team 0 zones whose radius grows from 0 to R; every foe the front reaches is hit once (per-wave id Set from a pool). Orbiting bells are short-lived zones the weapon tick keeps alive
// and moves, so clients see them through the zone snapshot. Zone looks: tollb / cathb (bell body), tollw / cathw / pealw (rings).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('tollb', 'tollw', 'cathb', 'cathw', 'pealw');

  ED.addHero({ id: 'bell', name: 'Bellwarden', hp: 115, speed: 69, crit: 0.05, sig: 'toll', skills: ['peal'], icon: 'hero.bell.idle', col: '#e6c27a', txt: 'Peals that push the horde back.' });

  // ---------------- waves ----------------
  const WST = [];
  // Ring from (x, y): radius 0 -> R over dur s (ease out) after delay s; each foe reached takes dmg once (kind), stun s, knock away from the centre; breaks braziers at the end. Returns the zone.
  function wave(w, p, wid, x, y, R, dur, dmg, look, kind, stun, knock, delay) {
    const st = WST.pop() || { hits: new Set(), R: 0, dur: 0, delay: 0, dmg: 0, kind: '', stun: 0, knock: 0 };
    st.hits.clear(); st.R = R; st.dur = dur; st.delay = delay || 0; st.dmg = dmg; st.kind = kind; st.stun = stun || 0; st.knock = knock || 0;
    return w.zone({ team: 0, p, wid, x, y, r: 1, dur: st.delay + dur, look, st, onTick: waveTick, onEnd: waveEnd });
  }
  function waveTick(w, z) {
    const s = z.st, k = (z.t - s.delay) / s.dur;
    if (k < 0) return;
    const r = s.R * U.easeOut(Math.min(1, k));
    z.r = Math.max(1, r);
    const q = w.foeScan(z.x, z.y, r);
    for (let i = 0; i < q.length; i++) {
      const e = q[i]; if (e.dead || s.hits.has(e.id)) continue;
      const rr = r + e.r; if (U.dist2(z.x, z.y, e.x, e.y) > rr * rr) continue;
      s.hits.add(e.id);
      const src = w.src(z.p, z.wid, s.kind, s.knock); src.x = z.x; src.y = z.y;
      w.hitFoe(e, s.dmg, src);
      if (!e.dead && s.stun > 0) w.stun(e, s.stun);
    }
    w.foeEnd();
  }
  function waveEnd(w, z) { w.hitBraziers(z.x, z.y, z.st.R, z.p); z.st.hits.clear(); WST.push(z.st); z.st = null; }

  // ---------------- orbiting bells ----------------
  // Keeps st.bells[i] = { z, id } alive at the orbit position (angle st.ang + i x TAU / n). Each bell body bonks foes it touches (S.dmg x S.body per s, tick 0.4, small knock).
  function orbit(w, p, ws, S, dt, look) {
    const st = ws.st, n = Math.max(1, S.n | 0), R = S.orbit * Math.sqrt(S.area);
    if (!st.bells) { st.bells = []; st.ang = 0; }
    st.ang = (st.ang + S.spin * dt) % TAU;
    for (let i = 0; i < n; i++) {
      let b = st.bells[i];
      if (!b) b = st.bells[i] = { z: null, id: 0 };
      const a = st.ang + i * TAU / n, x = p.x + Math.cos(a) * R, y = p.y - 6 + Math.sin(a) * R;
      let z = b.z;
      if (!z || z.dead || z.id !== b.id) { z = b.z = w.zone({ team: 0, p, wid: ws.id, x, y, r: 10, dur: 0.25, dps: S.dmg * S.body, tick: 0.4, knock: 120, look }); b.id = z.id; }
      z.x = x; z.y = y; z.t = 0; z.a = a; z.dps = S.dmg * S.body;
    }
    for (let i = n; i < st.bells.length; i++) { const b = st.bells[i]; if (b && b.z && b.z.id === b.id) b.z.dur = 0; }
    st.bells.length = Math.min(st.bells.length, n);
  }
  // Peals bell i (if it exists): a ring from its position, plus an echo ring (wider, weaker, 0.25 s later) when S.echo.
  function peal(w, p, ws, S, i, look, ringDur) {
    const b = ws.st.bells && ws.st.bells[i], z = b && b.z;
    if (!z || z.id !== b.id) return;
    const R = S.r * S.area;
    wave(w, p, ws.id, z.x, z.y, R, ringDur, S.dmg, look, 'weapon', S.stun, S.knock, 0);
    if (S.echo) wave(w, p, ws.id, z.x, z.y, R * 1.35, ringDur * 1.2, S.dmg * 0.6, look, 'weapon', S.stun, S.knock * 0.7, 0.25);
  }

  // ---------------- Toll ----------------
  // S.n bells orbit at S.orbit px (spin rad/s); every cd each bell peals a ring of S.r px (S.dmg, S.knock, S.stun s), foes near or not; echo: a second, wider ring.
  ED.addWeapon({
    id: 'toll', name: 'Toll', icon: 'weapon.bronzebell', sig: 'bell', mode: 'around', txt: 'A bell orbits you; peals push foes',
    base: { dmg: 13, cd: 1.6, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 240, range: 0, r: 64, orbit: 42, spin: 2.4, stun: 0, echo: 0, body: 0.5 },
    paths: [
      { id: 'carillon', name: 'Carillon', form: 'cathedral', ranks: [
        { mods: { n: 1 }, txt: '+1 bell' },
        { mods: { echo: 1 }, txt: 'Each peal echoes in a wider ring' },
        { mods: { area: 0.25, cd: -0.15 }, txt: '+25% ring size, peal 15% faster' }] },
      { id: 'resonance', name: 'Resonance', form: null, ranks: [
        { mods: { area: 0.25 }, txt: '+25% ring size' },
        { mods: { dmg: 0.25, orbit: 14 }, txt: '+25% damage, wider orbit' },
        { mods: { area: 0.2 }, txt: '+20% ring size' }] },
      { id: 'daze', name: 'Daze', form: null, ranks: [
        { mods: { stun: 0.4 }, txt: 'Rings stun foes for 0.4 s' },
        { mods: { dmg: 0.25, stun: 0.3 }, txt: '+25% damage, longer stun' },
        { mods: { knock: 0.3 }, txt: 'Rings push 30% harder' }] },
    ],
    hybrids: [], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) { orbit(w, p, ws, S, dt, 'tollb'); },
    fire(w, p, ws, S) {
      for (let i = 0; i < Math.max(1, S.n | 0); i++) peal(w, p, ws, S, i, 'tollw', 0.3);
      return true;
    },
  });

  // Cathedral: three great bells; each fire peals them in sequence 0.18 s apart, then a great ring (S.r x 2, 75% damage) bursts from the hero.
  ED.addWeapon({
    id: 'cathedral', name: 'Cathedral', icon: 'weapon.greatbell', sig: 'bell', mode: 'around', evolved: true, form: true, from: 'toll', txt: 'Three bells peal in sequence',
    base: { dmg: 40, cd: 1.5, n: 3, pierce: 0, area: 1, speed: 0, dur: 0, knock: 320, range: 0, r: 105, orbit: 66, spin: 1.7, stun: 0.6, echo: 1, body: 0.8 },
    refine: [
      { mods: { cd: -0.15 }, txt: 'Peals 15% faster' },
      { mods: { area: 0.25 }, txt: '+25% ring size' },
    ], noAmount: true,
  }, {
    tick(w, p, ws, S, dt) {
      orbit(w, p, ws, S, dt, 'cathb');
      const st = ws.st;
      if (!(st.seq > 0) || (st.seqT -= dt) > 0) return;
      st.seqT = 0.18;
      const i = (S.n | 0) - st.seq;
      st.seq--;
      peal(w, p, ws, S, i, 'cathw', 0.32);
      if (!st.seq) wave(w, p, ws.id, p.x, p.y - 6, S.r * S.area * 2, 0.5, S.dmg * 0.75, 'cathw', 'weapon', S.stun, S.knock, 0);
    },
    fire(w, p, ws, S) {
      ws.st.seq = Math.max(1, S.n | 0); ws.st.seqT = 0;
      return true;
    },
  });

  // ---------------- Great Peal ----------------
  // A ring from the hero out to N.r (about the screen's half diagonal) in N.t s: N.dmg, N.stun s and a push to every foe it reaches; echo: a second ring, 25% wider, 0.55 s later;
  // gems: every gem within N.r flies to the hero.
  ED.addSkill({
    id: 'peal', name: 'Great Peal', icon: 'weapon.greatbell', cd: 16, txt: 'Stun every foe on screen',
    base: { dmg: 30, r: 370, t: 0.5, stun: 1.2, knock: 180 },
    levels: [
      { mods: { echo: true }, txt: 'A second, wider peal follows' },
      { mods: { stun: 0.6, dmg: 0.5 }, txt: 'Stun 0.6 s longer, +50% damage' },
      { mods: { gems: true }, txt: 'Peal pulls every gem it reaches' },
    ],
  }, (w, p, x, y, N) => {
    wave(w, p, 'peal', p.x, p.y - 6, N.r, N.t, N.dmg, 'pealw', 'skill', N.stun, N.knock, 0);
    if (N.echo) wave(w, p, 'peal', p.x, p.y - 6, N.r * 1.25, N.t * 1.2, N.dmg * 0.75, 'pealw', 'skill', N.stun * 0.75, N.knock, 0.55);
    if (N.gems) { const r2 = N.r * N.r; for (const g of w.pickups) if (!g.dead && g.k.charCodeAt(0) === 120 && U.dist2(p.x, p.y, g.x, g.y) <= r2) { g.pull = p.pid; g.t = 0; } } // 120 'x': xp gems
    return { shake: 7 };
  });
})(globalThis.ED || (globalThis.ED = {}));
