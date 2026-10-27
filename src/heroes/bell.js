// Bell: hero data, signature Toll (orbiting bells whose peals send travelling shockwave rings) + evolution Cathedral (three bells peal in sequence, then a great ring), Q Great Peal, E Hurl Bell.
// Waves are team 0 zones whose radius grows from 0 to R; every foe the front reaches is hit once (per-wave id Set from a pool). Orbiting bells are short-lived zones the weapon tick keeps alive
// and moves, so clients see them through the zone snapshot. Zone looks: tollb / cathb (bell body), tollw / cathw / pealw / hurlw (rings), hurlb (landed bell); projectile look bellp.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('tollb', 'tollw', 'cathb', 'cathw', 'pealw', 'hurlw', 'hurlb', 'bellp');

  ED.addHero({ id: 'bell', name: 'Bellwarden', hp: 115, speed: 86, crit: 0.05, sig: 'toll', skills: ['peal', 'hurl'], icon: 'hero.bell.idle', col: '#e6c27a', txt: 'Peals that push the horde back.' });

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
  const anyNear = (w, p, S) => !!w.nearestFoe(p.x, p.y, S.orbit * Math.sqrt(S.area) + S.r * S.area + 10);

  // ---------------- Toll ----------------
  // S.n bells orbit at S.orbit px (spin rad/s); every cd each bell peals a ring of S.r px (S.dmg, S.knock, S.stun s); echo: a second, wider ring.
  ED.addWeapon({
    id: 'toll', name: 'Toll', icon: 'weapon.bronzebell', sig: 'bell', mode: 'around', txt: 'A bell orbits you; peals push foes',
    base: { dmg: 13, cd: 1.6, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 240, range: 0, r: 64, orbit: 42, spin: 2.4, stun: 0, echo: 0, body: 0.5 },
    levels: [
      { mods: { area: 0.25 }, txt: '+25% ring size' },
      { mods: { stun: 0.4 }, txt: 'Rings stun foes for 0.4 s' },
      { mods: { dmg: 0.25, orbit: 14 }, txt: '+25% damage, wider orbit' },
      { mods: { n: 1 }, txt: '+1 bell' },
      { mods: { echo: 1 }, txt: 'Each peal echoes in a wider ring' },
      { mods: { area: 0.25, cd: -0.15 }, txt: '+25% ring size, peal 15% faster' },
      { mods: { dmg: 0.25, stun: 0.3 }, txt: '+25% damage, longer stun' },
    ],
    pair: 'reach', evo: 'cathedral', noAmount: true,
  }, {
    tick(w, p, ws, S, dt) { orbit(w, p, ws, S, dt, 'tollb'); },
    fire(w, p, ws, S) {
      if (!anyNear(w, p, S)) return false;
      for (let i = 0; i < Math.max(1, S.n | 0); i++) peal(w, p, ws, S, i, 'tollw', 0.3);
      return true;
    },
  });

  // Cathedral: three great bells; each fire peals them in sequence 0.18 s apart, then a great ring (S.r x 2, 75% damage) bursts from the hero.
  ED.addWeapon({
    id: 'cathedral', name: 'Cathedral', icon: 'weapon.greatbell', sig: 'bell', mode: 'around', evolved: true, from: 'toll', txt: 'Three bells peal in sequence',
    base: { dmg: 40, cd: 1.5, n: 3, pierce: 0, area: 1, speed: 0, dur: 0, knock: 320, range: 0, r: 105, orbit: 66, spin: 1.7, stun: 0.6, echo: 1, body: 0.8 },
    levels: [], noAmount: true,
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
      if (!anyNear(w, p, S)) return false;
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

  // ---------------- Hurl Bell ----------------
  // N.n bells (0.35 rad apart) thrown toward the cursor (80..N.dist px). In flight a bell strikes foes on its path (35% damage) and drags foes within N.drag px along with it
  // (not bosses or knockback-immune foes; stunned while dragged). Where it lands it rings N.rings times 0.45 s apart: rings of N.r px, N.dmg, 0.5 s stun, a hard push.
  ED.addSkill({
    id: 'hurl', name: 'Hurl Bell', icon: 'weapon.handbells', cd: 9, txt: 'Throw a bell that drags, then rings',
    base: { dmg: 60, r: 80, speed: 360, dist: 320, drag: 30, rings: 1, n: 1 },
    levels: [
      { mods: { r: 0.4 }, txt: '+40% ring size' },
      { mods: { rings: 2 }, txt: 'The bell rings 3 times' },
      { mods: { n: 2 }, txt: 'Hurl 3 bells in a fan' },
    ],
  }, (w, p, x, y, N) => {
    let a = Math.atan2(y - p.y, x - p.x), d = Math.hypot(x - p.x, y - p.y);
    if (d < 1) a = p.face;
    d = U.clamp(d, 80, N.dist);
    const n = Math.max(1, N.n | 0);
    for (let i = 0; i < n; i++) {
      const ai = a + (i - (n - 1) / 2) * 0.35;
      w.shoot(p, 'hurl', p.x, p.y - 8, ai, null, { look: 'bellp', dmg: N.dmg * 0.35, pierce: 999, speed: N.speed, life: d / N.speed, knock: 0, r: 12,
        st: { R: N.r, dmg: N.dmg, rings: Math.max(1, N.rings | 0), drag: N.drag }, tick: hurlTick, onEnd: hurlLand });
    }
    return { a, shake: 3 };
  });
  function hurlTick(w, pr, dt) {
    const st = pr.st, R = st.drag, A = w.arena, q = w.foeScan(pr.x, pr.y, R), f = Math.min(1, 8 * dt);
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead || e.boss || !(e.def.kb > 0)) continue;
      const rr = R + e.r; if (U.dist2(pr.x, pr.y, e.x, e.y) > rr * rr) continue;
      const m = e.elite ? 0.5 : 1;
      e.x += (pr.vx * dt + (pr.x - e.x) * f) * m; e.y += (pr.vy * dt + (pr.y - e.y) * f) * m;
      ED.Arena.collide(A, e, e.r);
      w.stun(e, 0.15);
    }
    w.foeEnd();
  }
  function hurlLand(w, pr) {
    const st = pr.st;
    w.zone({ team: 0, p: pr.p, wid: 'hurl', x: pr.x, y: pr.y, r: 12, dur: (st.rings - 1) * 0.45 + 0.6, look: 'hurlb', st: { R: st.R, dmg: st.dmg, left: st.rings, t: 0 }, onTick: landTick });
  }
  function landTick(w, z) {
    const s = z.st;
    if (s.left <= 0 || (s.t -= 1 / 60) > 0) return;
    s.left--; s.t = 0.45;
    wave(w, z.p, 'hurl', z.x, z.y, s.R, 0.28, s.dmg, 'hurlw', 'skill', 0.5, 320, 0);
  }
})(globalThis.ED || (globalThis.ED = {}));
