// Cleric (support): signature Smite = holy pillars on random foes near the hero (team 0 warn zones that resolve after a short fall) plus two emitters the paths add:
// a holy aura around the hero (Censer path: pulses, heals allies inside, swinging censers) and a sweeping holy beam (Lance path). Every Form keeps all three parts and reshapes one:
// Wrath (pillars hop foe to foe), Halo (the aura becomes a ring wall that shoves foes out), Judgment Ray (beams rotate around the hero), hybrids Consecration (pillars leave
// healing holy ground) and Verdict (the beam calls pillars along its sweep). Q Sanctuary: holy ground at the cursor that heals and revives allies, wards foes out, rains pillars.
// Zone looks: smite / wrath (falling pillar), pglow (landed pillar, visual), hallow (Consecration ground), sanct, aura, halo (circle w = censer count),
// beam (line, sweep), ray (line, rotating). Pillar riders ride on a pooled state object (PS free list): no allocation per pillar in steady state.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('smite', 'wrath', 'pglow', 'sanct', 'aura', 'halo', 'beam', 'ray', 'hallow');

  ED.addHero({ id: 'cleric', name: 'Cleric', hp: 110, speed: 70, crit: 0.05, sig: 'smite', skills: ['sanctuary'], icon: 'hero.cleric.idle', col: '#ffe08a', txt: 'Holy pillars smite foes near you.' });

  // ---------------- pillars ----------------
  const FALL = 0.2, LEAP_R = 110, LEAP_K = 0.4, LEAP_MAX = 4, HOP_R = 120, HOP_K = 0.85, HOP_FALL = 0.1;
  const GROUND_T = 3, GROUND_SLOW = [0.3, 0.5], GRING = 16;
  // Pillar state (null = plain pillar): hop (Wrath hops left), jump (leaps on landing), ground (Consecration ground dps, 0 none), ox, oy (hop chain origin), d (this pillar's distance from it).
  const PS = [];
  const pst = (hop, jump, ground, ox, oy, d) => { const s = PS.pop() || {}; s.hop = hop; s.jump = jump; s.ground = ground; s.ox = ox; s.oy = oy; s.d = d; return s; };
  const pillar = (w, p, wid, x, y, r, dmg, knock, fall, st, big) =>
    w.zone({ team: 0, p, wid, x, y, r, dur: fall, warn: true, dmg, knock, look: big ? 'wrath' : 'smite', st, onEnd: pillarEnd });

  const near = [], nearD = [];
  // Up to n nearest foes to (x, y) in hero p's view, farther than rmin and within rmax (and, with ox set, farther than dmin from (ox, oy)) into near[]; returns the count.
  function nearest(w, p, x, y, rmin, rmax, n, ox, oy, dmin) {
    for (let j = 0; j < n; j++) { near[j] = null; nearD[j] = Infinity; }
    const q = w.foeScan(x, y, rmax), lo = rmin * rmin, hi = rmax * rmax, dm = dmin * dmin;
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead || (p && !ED.inView(p, e.x, e.y, 0))) continue;
      const d = U.dist2(x, y, e.x, e.y);
      if (d < lo || d > hi || (ox !== undefined && U.dist2(ox, oy, e.x, e.y) <= dm)) continue;
      for (let j = 0; j < n; j++) if (d < nearD[j]) { for (let s = n - 1; s > j; s--) { nearD[s] = nearD[s - 1]; near[s] = near[s - 1]; } nearD[j] = d; near[j] = e; break; }
    }
    w.foeEnd();
    let m = 0; while (m < n && near[m]) m++;
    return m;
  }
  const chainEv = (w, p, wid, x0, y0, x1, y1) => w.emit({ t: 'chain', pid: p ? p.pid : '', wid, pts: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)], look: 'holy' });

  // Landing riders: braziers, afterglow, Consecration ground, leaps (smaller pillars on the nearest foes), Wrath hop (the next pillar of the chain, outward from its origin).
  function pillarEnd(w, z) {
    const s = z.st, p = z.p, wid = z.wid;
    w.hitBraziers(z.x, z.y, z.r, p);
    w.zone({ team: 0, p, wid, x: z.x, y: z.y, r: z.r, dur: 0.25, look: 'pglow' });
    if (!s) return;
    if (s.ground > 0) {
      const g = w.zone({ team: 0, p, wid, x: z.x, y: z.y, r: z.r * 2, dur: GROUND_T * (1 + (p ? p.stats.duration : 0)), dps: s.ground, tick: 0.5, slow: GROUND_SLOW, look: 'hallow' });
      const ws = p && p.weapons[0], gs = ws && ws.st;
      if (gs && gs.gz) { gs.gz[gs.gi] = g; gs.gid[gs.gi] = g.id; gs.gi = (gs.gi + 1) % GRING; }
    }
    if (s.jump > 0) {
      const n = Math.min(LEAP_MAX, s.jump), m = nearest(w, p, z.x, z.y, z.r * 0.8, LEAP_R, n);
      for (let j = 0; j < m; j++) { const e = near[j]; pillar(w, p, wid, e.x, e.y, z.r * 0.7, z.dmg * LEAP_K, z.knock * 0.6, 0.12, null, false); chainEv(w, p, wid, z.x, z.y, e.x, e.y); }
      for (let j = m; j < n; j++) pillar(w, p, wid, z.x, z.y, z.r * 0.7, z.dmg * LEAP_K, z.knock * 0.6, 0.12 + 0.1 * (j - m), null, false); // no foe to leap to: strike here again
    }
    if (s.hop > 0 && nearest(w, p, z.x, z.y, z.r * 0.7, HOP_R, 1, s.ox, s.oy, s.d + 12)) {
      const e = near[0];
      pillar(w, p, wid, e.x, e.y, z.r * 0.92, z.dmg * HOP_K, z.knock, HOP_FALL, pst(s.hop - 1, 0, 0, s.ox, s.oy, Math.sqrt(U.dist2(s.ox, s.oy, e.x, e.y))), true);
      chainEv(w, p, wid, z.x, z.y, e.x, e.y);
    }
    PS.push(s);
  }

  // Volley: S.n pillars on distinct random foes within S.range inside the hero's view (partial shuffle of a reused candidate list); pillars beyond the foe count fall again on random
  // picks, 0.1 s apart. With no such foe, n pillars stride out along
  // the cursor dir (w.aimDir; step max(60, 2.5 r), squeezed so the last stays within S.range and STRIDE_IN px of the view edge). Riders per Form kind. Always fires.
  const cand = [], STRIDE_IN = 16, HW = ED.CONST.VIEW_W / 2 - STRIDE_IN, HH = ED.CONST.VIEW_H / 2 - STRIDE_IN;
  function volley(w, p, ws, S, kind) {
    const n = Math.max(1, S.n | 0), r = S.r * S.area, big = kind === 'wrath', hop = big ? S.hop | 0 : 0, jump = S.jump | 0, gd = kind === 'hallow' ? S.dmg * S.groundK : 0;
    const q = w.foeScan(p.x, p.y, S.range), r2 = S.range * S.range;
    cand.length = 0;
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (!e.dead && U.dist2(p.x, p.y, e.x, e.y) <= r2 && ED.inView(p, e.x, e.y, 0)) cand.push(e); }
    w.foeEnd();
    const m = cand.length;
    for (let i = 0; m && i < n; i++) {
      let e;
      if (i < m) { const j = w.rng.int(i, m - 1); e = cand[j]; cand[j] = cand[i]; cand[i] = e; } else e = cand[w.rng.int(0, m - 1)];
      pillar(w, p, ws.id, e.x, e.y, r, S.dmg, S.knock, i < m ? FALL : FALL + 0.1 * (i - m + 1), hop || jump || gd ? pst(hop, jump, gd, e.x, e.y, 0) : null, big);
    }
    cand.length = 0;
    if (m) return true;
    const a = w.aimDir(p), c = Math.cos(a), s = Math.sin(a);
    const reach = Math.min(S.range, Math.abs(c) > 1e-6 ? HW / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? HH / Math.abs(s) : Infinity);
    const step = Math.min(Math.max(60, 2.5 * r), reach / n);
    for (let i = 1; i <= n; i++) pillar(w, p, ws.id, p.x + c * step * i, p.y + s * step * i, r, S.dmg, S.knock, FALL, null, big);
    return true;
  }

  // ---------------- aura / Halo ----------------
  // Aura (S.aura ranks): radius (34 + 14 x min(2, aura)) x area around the hero; a pulse every PULSE s hits every foe inside for dmg x auraK and, when it hit any, heals living heroes
  // inside S.heal HP/s x PULSE. Censers (S.swing): orbit at 0.8 x radius (angle SW_W x zone age), each a 12 x area blast every SW_T s for dmg x swingK.
  // Halo: radius HALO_R x (1 + hr) x area; the ring band [R - 14, R + 10] hits every BAND_T s for dmg x bandK, slows and shoves foes outward; censers orbit on the ring.
  // Render zone (look aura / halo) follows the hero: z.r radius, z.w censer count; its dur is topped up rarely (snapshot-friendly).
  const PULSE = 0.5, SW_T = 0.2, SW_W = 3, HALO_R = 60, BAND_T = 0.25, BAND_IN = 14, BAND_OUT = 10, BAND_KNOCK = 140;
  const AURA = { noEv: true, knock: 0 }, SWING = { noEv: true, knock: 60 }, BAND_SLOW = [0.4, 0.4];
  const LOOK_OWN = { aura: 1, halo: 1, beam: 1, ray: 1 };
  function auraTick(w, p, ws, S, dt, halo) {
    const st = ws.st, R = halo ? HALO_R * (1 + (S.hr || 0)) * S.area : (34 + 14 * Math.min(2, S.aura)) * S.area, nsw = S.swing | 0, hz = 1 - p.stats.haste;
    let z = st.az;
    if (!z || z.dead || z.id !== st.azid) { z = st.az = w.zone({ team: 0, p, wid: ws.id, x: p.x, y: p.y, r: R, dur: 2, look: halo ? 'halo' : 'aura', follow: p.pid }); st.azid = z.id; }
    if (z.dur - z.t < 0.5) z.dur = z.t + 2;
    z.x = p.x; z.y = p.y; z.r = R; z.w = nsw;
    if ((st.pT -= dt) <= 0) {
      st.pT += PULSE * hz;
      const n = w.blast(p, ws.id, p.x, p.y, R, S.dmg * S.auraK, AURA);
      if (n > 0 && S.heal > 0) for (const h of w.living) if (U.dist2(h.x, h.y, p.x, p.y) <= R * R) w.heal(h, S.heal * PULSE);
    }
    if (halo && (st.hT -= dt) <= 0) { st.hT += BAND_T * hz; band(w, p, ws.id, R, S.dmg * S.bandK); }
    if (nsw > 0 && (st.sT -= dt) <= 0) {
      st.sT += SW_T * hz;
      const orb = halo ? R : R * 0.8, a0 = z.t * SW_W;
      for (let i = 0; i < nsw; i++) { const a = a0 + i * TAU / nsw; w.blast(p, ws.id, p.x + Math.cos(a) * orb, p.y + Math.sin(a) * orb, 12 * S.area, S.dmg * S.swingK, SWING); }
    }
  }
  function band(w, p, wid, R, dmg) {
    const q = w.foeScan(p.x, p.y, R + BAND_OUT + 12), lo = R - BAND_IN;
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const d = Math.sqrt(U.dist2(p.x, p.y, e.x, e.y));
      if (d + e.r < lo || d - e.r > R + BAND_OUT) continue;
      const s = w.src(p, wid, 'weapon', BAND_KNOCK); s.x = p.x; s.y = p.y;
      w.hitFoe(e, dmg, s);
      if (!e.dead) w.slow(e, BAND_SLOW[0], BAND_SLOW[1]);
    }
    w.foeEnd();
  }

  // ---------------- beams ----------------
  // Hits foes whose centre the beam from (cx, cy), len long, crosses while it turns from a0 to a1 (|a1 - a0| < PI): each foe once per crossing, no hit set needed.
  const BSTUN = 0.2;
  function sweep(w, p, wid, cx, cy, a0, a1, len, dmg, stun) {
    const sw = U.angDiff(a0, a1); if (sw === 0) return;
    const q = w.foeScan(cx, cy, len + 10);
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const dx = e.x - cx, dy = e.y - cy, rr = len + e.r; if (dx * dx + dy * dy > rr * rr) continue;
      const da = U.angDiff(a0, Math.atan2(dy, dx));
      if (sw > 0 ? da < 0 || da >= sw : da > 0 || da <= sw) continue;
      const s = w.src(p, wid, 'weapon', 0); s.x = cx; s.y = cy;
      w.hitFoe(e, dmg, s);
      if (stun && !e.dead) w.stun(e, stun);
    }
    w.foeEnd();
    const c = Math.cos(a1), sn = Math.sin(a1);
    for (let i = 1; i <= 3; i++) w.hitBraziers(cx + c * len * i / 3, cy + sn * len * i / 3, 10, p);
  }
  // Lance sweep (S.beam ranks): every S.bcd s (x haste), centred on the cursor dir (w.aimDir; beam length BEAM_L x (1 + blen) x area), 1 + S.beams beams spread evenly sweep
  // SWEEP_ARC rad in PASS_T s, 1 + S.pass passes (alternating). Each crossing: dmg x beamK and a 0.2 s stun. Verdict: a pillar falls along each beam every VP_T s (distance cycles VP_F).
  const BEAM_L = 130, SWEEP_ARC = 1.9, PASS_T = 0.4, BEAM_W = 12, VP_T = 0.06, VP_F = [0.5, 0.78, 1.0];
  function beamTick(w, p, ws, S, dt, verdict) {
    const st = ws.st, L = BEAM_L * (1 + (S.blen || 0)) * S.area, nb = 1 + (S.beams | 0), np = 1 + (S.pass | 0), T = PASS_T * np;
    if (!st.bOn) {
      if ((st.bT -= dt) > 0) return;
      st.bOn = true; st.bt = 0; st.vT = 0; st.ba = w.aimDir(p) - SWEEP_ARC / 2;
      for (let i = 0; i < nb && i < 4; i++) {
        const a = st.ba + i * TAU / nb;
        st.bz[i] = w.zone({ team: 0, p, wid: ws.id, x: p.x, y: p.y, a, len: L, w: BEAM_W, dur: T + 0.05, look: 'beam', follow: p.pid }); st.bzid[i] = st.bz[i].id; st.bp[i] = a;
      }
      return;
    }
    st.bt = Math.min(T, st.bt + dt);
    const pass = Math.min(np - 1, Math.floor(st.bt / PASS_T)), k = U.clamp(st.bt / PASS_T - pass, 0, 1), off = SWEEP_ARC * (pass % 2 ? 1 - k : k), dmg = S.dmg * S.beamK;
    let drop = false;
    if (verdict && (st.vT -= dt) <= 0) { st.vT += VP_T; drop = true; st.vi = (st.vi + 1) % VP_F.length; }
    for (let i = 0; i < nb && i < 4; i++) {
      const a = st.ba + i * TAU / nb + off;
      sweep(w, p, ws.id, p.x, p.y, st.bp[i], a, L, dmg, BSTUN);
      st.bp[i] = a;
      const z = st.bz[i]; if (z && !z.dead && z.id === st.bzid[i]) z.a = a;
      if (drop) { const f = VP_F[st.vi]; pillar(w, p, ws.id, p.x + Math.cos(a) * L * f, p.y + Math.sin(a) * L * f, S.r * S.area * 0.85, S.dmg * S.vpK, S.knock * 0.5, 0.15, null, false); }
    }
    if (st.bt >= T) { st.bOn = false; st.bT = S.bcd * (1 - p.stats.haste); }
  }
  // Judgment Ray: 1 + rays + beams + pass beams turn around the hero at RAY_W rad/s (RAY_L x (1 + blen) x area long); each crossing deals dmg x rayK. Render zones (look ray) kept per beam.
  const RAY_L = 60, RAY_W = 2.4, RAY_MAX = 6;
  function rayTick(w, p, ws, S, dt) {
    const st = ws.st, L = RAY_L * (1 + (S.blen || 0)) * S.area, nb = Math.min(RAY_MAX, 1 + (S.rays | 0) + (S.beams | 0) + (S.pass | 0)), dmg = S.dmg * S.rayK;
    const a0 = st.ra; st.ra = (st.ra + RAY_W * dt) % TAU;
    for (let i = 0; i < RAY_MAX; i++) {
      let z = st.bz[i]; const live = z && !z.dead && z.id === st.bzid[i];
      if (i >= nb) { if (live) z.dead = true; continue; }
      const a = st.ra + i * TAU / nb;
      if (!live) { z = st.bz[i] = w.zone({ team: 0, p, wid: ws.id, x: p.x, y: p.y, a, len: L, w: BEAM_W, dur: 2, look: 'ray', follow: p.pid }); st.bzid[i] = z.id; }
      if (z.dur - z.t < 0.5) z.dur = z.t + 2;
      z.a = a; z.len = L;
      sweep(w, p, ws.id, p.x, p.y, a0 + i * TAU / nb, a, L, dmg, 0);
    }
  }

  // ---------------- Smite and its Forms ----------------
  // Shared custom numbers: r (pillar radius), jump (leaps), aura (aura ranks), heal (aura HP/s), swing (censers), beam / pass / beams / blen (Lance), bcd (sweep cooldown),
  // auraK / swingK / beamK (damage factors of S.dmg). Form keys: hop (Wrath), hr / bandK (Halo), rays / rayK (Judgment Ray), groundK / gheal (Consecration), vpK (Verdict).
  const K = { r: 26, range: 230, jump: 0, aura: 0, heal: 0, swing: 0, beam: 0, pass: 0, beams: 0, blen: 0, bcd: 3, auraK: 0.1, swingK: 0.25, beamK: 0.75 };
  const base = (o) => Object.assign({ pierce: 0, area: 1, speed: 0, dur: 0, knock: 70 }, K, o);
  // Consecration: every GT s, each living hero standing in one of the owner's holy grounds heals gheal x GT (once per hero, however many grounds overlap).
  const GT = 0.25;
  function groundHeal(w, p, ws, S, dt) {
    const st = ws.st;
    if ((st.gT -= dt) > 0) return;
    st.gT += GT;
    for (const h of w.living) {
      for (let i = 0; i < GRING; i++) {
        const g = st.gz[i];
        if (g && !g.dead && g.id === st.gid[i] && U.dist2(h.x, h.y, g.x, g.y) <= g.r * g.r) { w.heal(h, S.gheal * GT); break; }
      }
    }
  }
  // Fresh state; ends the hero's aura / beam render zones left by the previous id (a Form swap resets ws.st).
  const init = (w, p, ws) => {
    const st = ws.st;
    for (const z of w.zones) if (!z.dead && z.p === p && z.follow === p.pid && LOOK_OWN[z.k]) z.dead = true;
    st.az = null; st.azid = 0; st.pT = 0; st.hT = 0; st.sT = 0;
    st.bOn = false; st.bT = 0.6; st.bt = 0; st.ba = 0; st.vT = 0; st.vi = 0; st.ra = 0; st.bz = []; st.bzid = []; st.bp = [];
    st.gz = []; st.gid = []; st.gi = 0; st.gT = 0;
  };
  const impl = (kind) => ({
    init,
    fire: (w, p, ws, S) => volley(w, p, ws, S, kind),
    tick(w, p, ws, S, dt) {
      if (S.aura > 0 || kind === 'halo') auraTick(w, p, ws, S, dt, kind === 'halo');
      if (kind === 'ray') rayTick(w, p, ws, S, dt);
      else if (S.beam > 0) beamTick(w, p, ws, S, dt, kind === 'verdict');
      if (kind === 'hallow') groundHeal(w, p, ws, S, dt);
    },
  });

  // Smite: S.n pillars on random foes near the hero; paths Storm (more pillars, leaps), Censer (aura, healing, censers), Lance (sweeping beam).
  ED.addWeapon({
    id: 'smite', name: 'Smite', icon: 'weapon.mace', sig: 'cleric', mode: 'random', txt: 'Holy pillars on random foes',
    base: base({ dmg: 20, cd: 1.0, n: 1 }),
    paths: [
      { id: 'storm', name: 'Storm', form: 'wrath', ranks: [
        { mods: { n: 1 }, txt: '+1 pillar' },
        { mods: { jump: 1 }, txt: 'Pillars leap to a nearby foe' },
        { mods: { jump: 1 }, txt: 'Leaps strike 2 foes' }] },
      { id: 'censer', name: 'Censer', form: 'halo', ranks: [
        { mods: { aura: 1 }, txt: 'A holy aura burns foes near you' },
        { mods: { aura: 1, heal: 0.6 }, txt: 'Aura grows and heals allies in it' },
        { mods: { swing: 2 }, txt: '2 censers swing around you' }] },
      { id: 'lance', name: 'Lance', form: 'jray', ranks: [
        { mods: { beam: 1 }, txt: 'A holy beam sweeps foes every 3 s' },
        { mods: { pass: 1 }, txt: 'The beam sweeps back again' },
        { mods: { beams: 1 }, txt: 'A second beam sweeps behind you' }] },
    ],
    hybrids: [{ need: [0, 1], form: 'consecration' }, { need: [0, 2], form: 'verdict' }],
  }, impl(''));

  // Wrath: every pillar starts a chain that hops to the next foe outward (S.hop hops, 85% damage each).
  ED.addWeapon({
    id: 'wrath', name: 'Wrath', icon: 'weapon.dawnhammer', sig: 'cleric', mode: 'random', evolved: true, form: true, from: 'smite', txt: 'Pillars hop from foe to foe',
    base: base({ dmg: 30, cd: 1.0, n: 2, r: 28, hop: 5, knock: 90 }),
    refine: [
      { mods: { hop: 2 }, txt: 'Chains hop 2 more times' },
      { mods: { n: 1, dmg: 0.2 }, txt: '+1 pillar, +20% damage' },
    ],
  }, impl('wrath'));
  // Halo: the aura becomes a ring wall that burns, slows and shoves out foes crossing it.
  ED.addWeapon({
    id: 'halo', name: 'Halo', icon: 'weapon.lantern', sig: 'cleric', mode: 'random', evolved: true, form: true, from: 'smite', txt: 'A ring of light walls foes out',
    base: base({ dmg: 24, cd: 1.0, n: 2, hr: 0, bandK: 0.35, heal: 0.6, swing: 1, auraK: 0.8 }),
    refine: [
      { mods: { hr: 0.3 }, txt: 'The ring is 30% wider' },
      { mods: { swing: 2, dmg: 0.2 }, txt: '+2 censers, +20% damage' },
    ],
  }, impl('halo'));
  // Judgment Ray: holy beams turn around the hero without pause.
  ED.addWeapon({
    id: 'jray', name: 'Judgment Ray', icon: 'weapon.glaive', sig: 'cleric', mode: 'random', evolved: true, form: true, from: 'smite', txt: 'Holy beams turn around you',
    base: base({ dmg: 23, cd: 1.0, n: 3, rays: 1, rayK: 0.35 }),
    refine: [
      { mods: { blen: 0.3 }, txt: 'Beams reach 30% farther' },
      { mods: { rays: 1, dmg: 0.2 }, txt: '+1 beam, +20% damage' },
    ],
  }, impl('ray'));
  // Consecration (Storm + Censer at rank 3): every volley pillar leaves holy ground that burns and slows foes and heals allies standing in it.
  ED.addWeapon({
    id: 'consecration', name: 'Consecration', icon: 'weapon.mace', sig: 'cleric', mode: 'random', evolved: true, form: true, from: 'smite', txt: 'Pillars leave holy ground',
    base: base({ dmg: 30, cd: 1.0, n: 2, groundK: 0.3, gheal: 1.2 }),
    refine: [
      { mods: { n: 1 }, txt: '+1 pillar' },
      { mods: { groundK: 0.1, dmg: 0.2 }, txt: '+20% damage, ground burns hotter' },
    ],
  }, impl('hallow'));
  // Verdict (Storm + Lance at rank 3): the beam sweeps more often and calls pillars down along its path.
  ED.addWeapon({
    id: 'verdict', name: 'Verdict', icon: 'weapon.warhammer', sig: 'cleric', mode: 'random', evolved: true, form: true, from: 'smite', txt: 'Beams call pillars as they sweep',
    base: base({ dmg: 30, cd: 1.0, n: 2, bcd: 1.6, vpK: 1.7 }),
    refine: [
      { mods: { blen: 0.3 }, txt: 'Beams reach 30% farther' },
      { mods: { n: 1, dmg: 0.2 }, txt: '+1 pillar, +20% damage' },
    ],
  }, impl('verdict'));

  // ---------------- Sanctuary ----------------
  // Zero damage. Holy ground at the cursor: a burst that knocks foes out (knock 320), then for N.dur s every ST s: foes inside slowed 45% (ward: shoved out from the centre), every living
  // hero inside healed N.heal HP/s, downed heroes inside gain REV_K revive progress per s (revive); rain: a holy pillar (look 'smite', 0.18 s fall) lands on a random point inside every
  // RAIN_T s and stuns the foes it covers RAIN_STUN s.
  const SANCT_SLOW = 0.45, WARD = 90, REV_K = 1.2, RAIN_T = 0.25, ST = 0.25, RAIN_R = 20, RAIN_STUN = 0.6;
  ED.addSkill({
    id: 'sanctuary', name: 'Sanctuary', icon: 'fx.shield.gold', cd: 14, txt: 'Holy ground heals allies',
    base: { r: 80, dur: 4, heal: 5 },
    levels: [
      { mods: { r: 0.35, ward: true }, txt: '+35% area, wards foes out' },
      { mods: { dur: 0.5, revive: true }, txt: 'Lasts 50% longer, revives allies' },
      { mods: { rain: true }, txt: 'Holy pillars rain inside and stun' },
    ],
  }, (w, p, x, y, N) => {
    w.blast(p, 'sanctuary', x, y, N.r, 0, { knock: 320, look: 'holy', kind: 'skill' });
    w.zone({ team: 0, p, wid: 'sanctuary', x, y, r: N.r, dur: N.dur, look: 'sanct',
      st: { heal: N.heal, ward: !!N.ward, rev: !!N.revive, rain: !!N.rain, tt: -1, rainT: 0 }, onTick: sanctTick });
    return { shake: 4 };
  });
  let SW = null, SZ = null;
  const sanctFoe = (e) => { SW.slow(e, SANCT_SLOW, ST * 1.6); if (SZ.st.ward) SW.knock(e, e.x - SZ.x, e.y - SZ.y, WARD); };
  const rainFoe = (e) => SW.stun(e, RAIN_STUN);
  const rainEnd = (w, z) => { SW = w; w.zoneFoes(z, rainFoe); SW = null; w.zone({ team: 0, p: z.p, wid: z.wid, x: z.x, y: z.y, r: z.r, dur: 0.25, look: 'pglow' }); };
  function sanctTick(w, z) {
    const st = z.st, r2 = z.r * z.r;
    if (st.tt >= 0 && z.t - st.tt < ST - 1e-6) return;
    st.tt = z.t;
    SW = w; SZ = z; w.zoneFoes(z, sanctFoe); SW = null; SZ = null;
    for (const h of w.living) if (U.dist2(h.x, h.y, z.x, z.y) <= r2) w.heal(h, st.heal * ST);
    if (st.rev) for (const h of w.heroes) if (h.downed && !h.dead && U.dist2(h.x, h.y, z.x, z.y) <= r2) h.revive += REV_K * ST; // >= 1 revives at the next hero update
    if (!st.rain) return;
    for (st.rainT += ST; st.rainT >= RAIN_T; st.rainT -= RAIN_T) {
      const a = w.rng.next() * TAU, d = Math.sqrt(w.rng.next()) * z.r * 0.9;
      w.zone({ team: 0, p: z.p, wid: 'sanctuary', x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d, r: RAIN_R, dur: 0.18, warn: true, look: 'smite', onEnd: rainEnd });
    }
  }
})(globalThis.ED || (globalThis.ED = {}));
