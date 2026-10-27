// Cleric: hero data, signature Smite (holy pillars: team 0 warn zones that resolve after a short fall) + evolution Wrath (pillars cascade to neighbours), Q Sanctuary, E Judgment.
// Pillar flags ride on the zone as a shared constant st (PST[mask]): no allocation per pillar. Zone looks: smite / wrath (falling pillar), pglow (landed pillar, visual only), conse (consecrated ground), sanct, judge (beam).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('smite', 'wrath', 'pglow', 'conse', 'sanct', 'judge');

  ED.addHero({ id: 'cleric', name: 'Cleric', hp: 110, speed: 88, crit: 0.05, sig: 'smite', skills: ['sanctuary', 'judgment'], icon: 'hero.cleric.idle', col: '#ffe08a', txt: 'Holy pillars strike foes on screen.' });

  // ---------------- pillars ----------------
  // mask bits: 1 echo (strikes again 0.3 s later), 2 consecrate (leaves burning holy ground), 4 cascade (Wrath: 3 smaller pillars jump to the nearest foes), 8 second generation.
  const PST = []; for (let m = 0; m < 16; m++) PST.push(Object.freeze({ m }));
  const FALL = 0.2, ECHO_T = 0.3, CASCADE_R = 120, CASCADE_N = 3;
  const near = [null, null, null], nearD = [0, 0, 0], WRATH_SLOW = [0.35, 0.5];

  // Pillar of weapon wid at (x, y): falls for `fall` s, then hits every foe within r for dmg (knock away from the centre); mask as above.
  const pillar = (w, p, wid, x, y, r, dmg, knock, mask, fall) =>
    w.zone({ team: 0, p, wid, x, y, r, dur: fall, warn: true, dmg, knock, look: wid === 'wrath' ? 'wrath' : 'smite', st: PST[mask], onEnd: pillarEnd });

  // Resolve riders: braziers, afterglow, echo strike, consecrated ground, Wrath cascade (emits one holy 'chain' line per jump).
  function pillarEnd(w, z) {
    const m = z.st.m, p = z.p;
    w.hitBraziers(z.x, z.y, z.r, p);
    w.zone({ team: 0, p, wid: z.wid, x: z.x, y: z.y, r: z.r, dur: 0.25, look: 'pglow' });
    if (m & 1) pillar(w, p, z.wid, z.x, z.y, z.r * 1.15, z.dmg * 0.6, z.knock, m & ~1, ECHO_T);
    if ((m & 2) && !(m & 8)) {
      const dur = (z.wid === 'wrath' ? 2.2 : 1.5) * (1 + (p ? p.stats.duration : 0));
      w.zone({ team: 0, p, wid: z.wid, x: z.x, y: z.y, r: z.r * 1.2, dur, dps: z.dmg * 0.35, tick: 0.35, look: 'conse', slow: z.wid === 'wrath' ? WRATH_SLOW : null });
    }
    if ((m & 4) && !(m & 8)) {
      let n = 0;
      nearD[0] = nearD[1] = nearD[2] = Infinity; near[0] = near[1] = near[2] = null;
      const q = w.foeScan(z.x, z.y, CASCADE_R), min2 = (z.r * 0.8) * (z.r * 0.8), max2 = CASCADE_R * CASCADE_R;
      for (let k = 0; k < q.length; k++) {
        const e = q[k]; if (e.dead) continue;
        const d = U.dist2(z.x, z.y, e.x, e.y);
        if (d < min2 || d > max2) continue;
        for (let j = 0; j < CASCADE_N; j++) if (d < nearD[j]) { for (let s = CASCADE_N - 1; s > j; s--) { nearD[s] = nearD[s - 1]; near[s] = near[s - 1]; } nearD[j] = d; near[j] = e; break; }
      }
      w.foeEnd();
      for (let j = 0; j < CASCADE_N; j++) {
        const e = near[j]; if (!e) break;
        pillar(w, p, z.wid, e.x, e.y, z.r * 0.7, z.dmg * 0.6, z.knock * 0.6, (m & 2) | 8, 0.12);
        w.emit({ t: 'chain', pid: p ? p.pid : '', wid: z.wid, pts: [Math.round(z.x), Math.round(z.y), Math.round(e.x), Math.round(e.y)], look: 'holy' });
        n++;
      }
    }
  }
  // Picks up to n distinct random foes on screen (ids in a reused buffer) and drops a pillar on each. Returns whether any fell.
  const picked = [];
  function strike(w, p, ws, S, mask) {
    const n = Math.max(1, S.n | 0), r = S.r * S.area;
    picked.length = 0;
    for (let i = 0; i < n; i++) {
      let t = null;
      for (let tries = 0; tries < 3; tries++) { t = w.target('random', p, S.range); if (!t || picked.indexOf(t.id) < 0) break; }
      if (!t) break;
      picked.push(t.id);
      pillar(w, p, ws.id, t.x, t.y, r, S.dmg, S.knock, mask, FALL);
    }
    return picked.length > 0;
  }

  // ---------------- Smite ----------------
  // S.n pillars on distinct random foes on screen; custom: r (pillar radius), echo, conse (booleans from levels).
  ED.addWeapon({
    id: 'smite', name: 'Smite', icon: 'weapon.mace', sig: 'cleric', mode: 'random', txt: 'Holy pillars on random foes',
    base: { dmg: 20, cd: 1.2, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 70, range: 400, r: 22 },
    levels: [
      { mods: { n: 1 }, txt: '+1 pillar' },
      { mods: { conse: true }, txt: 'Pillars leave burning holy ground' },
      { mods: { dmg: 0.25, area: 0.25 }, txt: '+25% damage, +25% pillar size' },
      { mods: { n: 1 }, txt: '+1 pillar' },
      { mods: { echo: true }, txt: 'Every pillar strikes twice' },
      { mods: { n: 2 }, txt: '+2 pillars' },
      { mods: { dmg: 0.25, area: 0.3 }, txt: '+25% damage, +30% pillar size' },
    ],
    pair: 'reach', evo: 'wrath',
  }, { fire: (w, p, ws, S) => strike(w, p, ws, S, (S.echo ? 1 : 0) | (S.conse ? 2 : 0)) });

  // Wrath: bigger pillars that strike twice, sear the ground (slowing) and each cascade into 3 pillars on the nearest foes.
  ED.addWeapon({
    id: 'wrath', name: 'Wrath', icon: 'weapon.dawnhammer', sig: 'cleric', mode: 'random', evolved: true, from: 'smite', txt: 'Pillars chain to neighbours',
    base: { dmg: 42, cd: 0.9, n: 4, pierce: 0, area: 1, speed: 0, dur: 0, knock: 110, range: 420, r: 34 },
    levels: [],
  }, { fire: (w, p, ws, S) => strike(w, p, ws, S, 1 | 2 | 4) });

  // ---------------- Sanctuary ----------------
  // Holy ground at the cursor: a consecration burst (N.dmg x 2, knock out, N.stun), then N.dur s of N.dmg dps + 45% slow to foes and N.heal HP/s to every living hero inside;
  // rain: a pillar falls on a random point inside every 0.2 s.
  const SANCT_SLOW = [0.45, 0.4];
  ED.addSkill({
    id: 'sanctuary', name: 'Sanctuary', icon: 'fx.shield.gold', cd: 14, txt: 'Holy ground heals allies',
    base: { dmg: 14, r: 80, dur: 4, heal: 5 },
    levels: [
      { mods: { r: 0.35, heal: 2 }, txt: '+35% area, +2 HP/s healing' },
      { mods: { dur: 0.5, stun: 1 }, txt: 'Lasts 50% longer, stuns on cast' },
      { mods: { rain: true, dmg: 0.5 }, txt: 'Holy pillars rain inside, +50% dmg' },
    ],
  }, (w, p, x, y, N) => {
    w.blast(p, 'sanctuary', x, y, N.r, N.dmg * 2, { knock: 320, stun: N.stun || 0, look: 'holy', kind: 'skill' });
    w.zone({ team: 0, p, wid: 'sanctuary', x, y, r: N.r, dur: N.dur, dps: N.dmg, tick: 0.25, slow: SANCT_SLOW, look: 'sanct', st: { heal: N.heal, rain: !!N.rain, rainT: 0, pd: N.dmg * 1.6 }, onTick: sanctTick });
    return { shake: 4 };
  });
  function sanctTick(w, z) {
    const st = z.st, r2 = z.r * z.r;
    for (const h of w.living) if (U.dist2(h.x, h.y, z.x, z.y) <= r2) w.heal(h, st.heal * z.tick);
    if (!st.rain) return;
    for (st.rainT += z.tick; st.rainT >= 0.2; st.rainT -= 0.2) {
      const a = w.rng.next() * TAU, d = Math.sqrt(w.rng.next()) * z.r * 0.9;
      pillar(w, z.p, 'sanctuary', z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 20, st.pd, 60, 0, 0.18);
    }
  }

  // ---------------- Judgment ----------------
  // A holy beam (N.r long, N.w wide) from the hero toward the cursor that sweeps N.arc rad in N.t s (centred on the aim), passes times (alternating direction; each pass may hit a foe once),
  // beams = 1 + extra beams spread evenly around the circle. Each hit: N.dmg, a 0.3 s stun, a shove along the sweep.
  ED.addSkill({
    id: 'judgment', name: 'Judgment', icon: 'weapon.dawnhammer', cd: 9, txt: 'A holy beam sweeps 90 degrees',
    base: { dmg: 60, r: 250, w: 26, arc: Math.PI / 2, t: 0.45, passes: 1, beams: 1 },
    levels: [
      { mods: { passes: 1 }, txt: 'Sweeps back a second time' },
      { mods: { r: 0.4, w: 12, dmg: 0.25 }, txt: '+40% length, wider, +25% damage' },
      { mods: { beams: 2 }, txt: 'Two more beams around you' },
    ],
  }, (w, p, x, y, N) => {
    const a = Math.atan2(y - p.y, x - p.x), nb = Math.max(1, N.beams | 0), passes = Math.max(1, N.passes | 0);
    for (let i = 0; i < nb; i++) {
      const a0 = a + i * TAU / nb;
      w.zone({ team: 0, p, wid: 'judgment', x: p.x, y: p.y, a: a0 - N.arc / 2, len: N.r, w: N.w, dur: N.t * passes + 0.05, look: 'judge', follow: p.pid,
        st: { a0, arc: N.arc, t: N.t, np: passes, pass: 0, dmg: N.dmg, hits: new Set() }, onTick: judgeTick });
    }
    return { a, shake: 5 };
  });
  let jz = null, jw = null, jdir = 1;
  function judgeHit(e) {
    const z = jz, st = z.st, w = jw;
    if (st.hits.has(e.id)) return;
    st.hits.add(e.id);
    const s = w.src(z.p, 'judgment', 'skill', 170); s.x = z.x; s.y = z.y; s.kx = -Math.sin(z.a) * jdir; s.ky = Math.cos(z.a) * jdir;
    w.hitFoe(e, st.dmg, s);
    if (!e.dead) w.stun(e, 0.3);
  }
  function judgeTick(w, z) {
    const st = z.st, pass = Math.min(Math.floor(z.t / st.t), st.np - 1), k = U.clamp(z.t / st.t - pass, 0, 1), fwd = pass % 2 === 0;
    if (pass !== st.pass) { st.pass = pass; st.hits.clear(); }
    const e = U.easeInOut(k);
    z.a = st.a0 - st.arc / 2 + st.arc * (fwd ? e : 1 - e);
    jz = z; jw = w; jdir = fwd ? 1 : -1;
    w.zoneFoes(z, judgeHit);
    jz = null; jw = null;
  }
})(globalThis.ED || (globalThis.ED = {}));
