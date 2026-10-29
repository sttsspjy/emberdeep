// Shade (assassin): hero data, signature Twin Daggers (rapid narrow stabs toward the cursor; 3 paths x 3 ranks), Forms Thousand Cuts (path 0), Assassinate (path 1),
// Shadow Fan (path 2), hybrids Death Lotus (paths 0 + 1) and Reaper's Return (paths 1 + 2); Q Shadow Step.
// Stab: a segment from the hero's hand along the aim, S.len x area long, S.wid x area wide; every foe touching it is hit. Crit is rolled once per stab (a crit stab forces a crit on
// every foe it touches, others never crit). A strike of S.n stabs is spread evenly over the cooldown (ws.st queue), each stab re-aimed. Visual: one line zone per stab.
// Zone looks: stab / stabx (crit) / tcut (storm stab) line zones 0.12 s; smark (mark on a foe), mcut (shadow X cut, w = cut length), petal (bloom, w = blade count), sexec (execute pop,
// w = 1 with a burst), stepcut (blink slash), afterimg (afterimage). Projectile looks: rknife (returning dagger), sknife (Shadow Fan), pknife (pinning dagger), knife (afterimage knives).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('stepcut', 'afterimg', 'sknife', 'stab', 'stabx', 'tcut', 'smark', 'mcut', 'petal', 'sexec', 'rknife', 'pknife');

  ED.addHero({ id: 'shade', name: 'Shade', hp: 80, speed: 80, crit: 0.15, sig: 'daggers', skills: ['step'], icon: 'hero.shade.idle', col: '#8a9bd6', txt: 'Rapid stabs, deadly crits.' });

  const AIM_CONE = 0.9, HAND = 6, VIS = 0.12;
  const ZO = { team: 0, p: null, wid: '', x: 0, y: 0, a: 0, len: 0, w: 0, r: 0, dur: VIS, look: '' };
  // Visual-only zone (no damage): a line when len > 0, else a circle of radius r; w is the look's free field. Returns the zone.
  function vis(w, p, wid, look, x, y, a, len, wd, r, dur) {
    const o = ZO; o.p = p; o.wid = wid; o.look = look; o.x = x; o.y = y; o.a = a; o.len = len; o.w = wd; o.r = r; o.dur = dur;
    return w.zone(o);
  }

  // ---------------- hits ----------------
  // True when a pinning dagger of slot state st sits in foe e (Reaper's Return).
  const pinned = (st, e) => { const P = st.pins; if (P) for (let i = 0; i < P.length; i++) if (P[i].id === e.id) return true; return false; };
  // Live Assassinate mark of slot state st, or null.
  const markOf = (st) => { const m = st.mark; return m && !m.dead && m.id === st.mid ? m : null; };
  // One weapon hit on e: a forced crit on a crit stab, the mark (dmg x S.mk) or a pinned foe, else no crit; then execute (a non-boss foe left at or under S.exec of its max HP dies).
  function strike(w, p, ws, S, e, dmg, crit, kx, ky) {
    const st = ws.st, onMark = S.mark && e === markOf(st), sure = crit || onMark || (S.pin && pinned(st, e));
    const s = w.src(p, ws.id, 'weapon', S.knock); s.kx = kx; s.ky = ky; s.crit = sure; s.critC = sure ? -1 : 0;
    w.hitFoe(e, onMark ? dmg * S.mk : dmg, s);
    if (S.exec > 0 && !e.dead && !e.boss && e.hp <= e.maxHp * S.exec) execute(w, p, ws, S, e);
  }
  // Execute: a finishing hit for e's remaining HP; S.burst: a 26 px cut around it (dmg x S.burst).
  const BURST = { kind: 'weapon', knock: 60, noEv: true };
  function execute(w, p, ws, S, e) {
    const s = w.src(p, ws.id, 'weapon', 0); s.critC = 0;
    w.hitFoe(e, e.hp / (e.takeMul || 1) + 1, s);
    vis(w, p, ws.id, 'sexec', e.x, e.y, 0, 0, S.burst ? 1 : 0, S.burst ? 26 : e.r + 4, 0.3);
    if (S.burst) w.blast(p, ws.id, e.x, e.y, 26, S.dmg * S.burst, BURST);
  }
  // Segment hit from (x0, y0) along a for L px, half width hw: strike on every foe touching it. Returns the foe nearest the start (it may be dead) or null.
  function seg(w, p, ws, S, x0, y0, a, L, hw, dmg, crit) {
    const c = Math.cos(a), s = Math.sin(a), x1 = x0 + c * L, y1 = y0 + s * L, q = w.foeScan((x0 + x1) / 2, (y0 + y1) / 2, L / 2 + hw + 24);
    let first = null, fd = Infinity;
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const m = hw + e.r; if (U.segDist2(e.x, e.y, x0, y0, x1, y1) > m * m) continue;
      const d = (e.x - x0) * c + (e.y - y0) * s; if (d < fd) { fd = d; first = e; }
      strike(w, p, ws, S, e, dmg, crit, c, s);
    }
    w.foeEnd();
    w.hitBraziers(x0 + c * L * 0.55, y0 + s * L * 0.55, L * 0.5, p);
    return first;
  }

  // ---------------- stabs ----------------
  const reach = (S) => S.len * S.area;
  // Aim of one stab: the cursor dir (w.aimDir); the mark instead when within reach + 12 px and AIM_CONE rad of it.
  function stabAim(w, p, ws, S) {
    const R = reach(S) + 12, m = S.mark ? markOf(ws.st) : null, a = w.aimDir(p);
    if (m && U.dist2(p.x, p.y, m.x, m.y) <= R * R) { const b = Math.atan2(m.y - p.y + HAND, m.x - p.x); if (Math.abs(U.angDiff(a, b)) <= AIM_CONE) return b; }
    return a;
  }
  // One stab: crit rolled here (crit with S.lunge: length x (1 + lunge), width x 1.4); S.cone (storm): angle jittered within +-cone, length x 0.8..1.15;
  // S.bloom: a crit stab's first foe blooms S.petals blades outward (S.plen x reach long, dmg x S.bloom, not crits).
  function stabOnce(w, p, ws, S) {
    let a = stabAim(w, p, ws, S), L = reach(S), hw = S.wid * S.area / 2, look = 'stab';
    const crit = w.rng.next() < S.crit;
    if (S.cone > 0) { a += (w.rng.next() * 2 - 1) * S.cone; L *= 0.8 + w.rng.next() * 0.35; look = 'tcut'; }
    if (crit) { look = 'stabx'; if (S.lunge > 0) { L *= 1 + S.lunge; hw *= 1.4; } }
    const x0 = p.x + Math.cos(a) * 4, y0 = p.y - HAND + Math.sin(a) * 4;
    const first = seg(w, p, ws, S, x0, y0, a, L, hw, S.dmg, crit);
    vis(w, p, ws.id, look, x0, y0, a, L, hw * 2, 0, VIS);
    if (crit && S.bloom > 0 && first) bloom(w, p, ws, S, first.x, first.y, first.r, a);
  }
  function bloom(w, p, ws, S, x, y, r, a) {
    const n = Math.max(3, S.petals | 0), L = reach(S) * S.plen, hw = 4 * S.area, d0 = r + hw + 3;
    for (let i = 0; i < n; i++) { const b = a + (i + 0.5) * TAU / n; seg(w, p, ws, S, x + Math.cos(b) * d0, y + Math.sin(b) * d0, b, L, hw, S.dmg * S.bloom, false); }
    vis(w, p, ws.id, 'petal', x, y, a, 0, n, d0 + L, 0.22);
  }

  // ---------------- thrown daggers ----------------
  // Every S.tcd s: S.thrown daggers fanned 0.35 rad along the cursor, out S.trange x area px and back (dmg x S.tdm, pierce all; each foe hit once out, once back);
  // S.hover: they spin 0.4 s at the far end, re-hitting every 0.15 s. S.fan (Shadow Fan): S.fan + S.thrown daggers fanned forward and as many behind; the return leg always crits.
  // S.pin (Reaper's Return): a dagger sticks in the first foe it hits for S.pdur s (strikes on that foe crit), then tears out (a TEAR px cut, forced crits) and flies back as a forced crit.
  // Per-dagger state st { h (hovering), e / id (pinned foe), t (pin time left), ws } from a pool, returned on the dagger's end.
  const HOVER = 0.4, TSPEED = 320, TEAR = 24, MBURST = { kind: 'weapon', knock: 80, noEv: true, crit: true };
  const stPool = [];
  const takeSt = () => { const s = stPool.pop() || { h: false, e: null, id: 0, t: 0, ws: null }; s.h = false; return s; };
  const unpin = (s) => { if (s.ws && s.ws.st.pins) { const P = s.ws.st.pins, i = P.indexOf(s); if (i >= 0) P.splice(i, 1); } s.e = null; s.id = 0; s.ws = null; };
  const giveSt = (w, pr) => { const s = pr.st; if (!s) return; unpin(s); stPool.push(s); pr.st = null; };
  function thrownTick(w, pr, dt) {
    const s = pr.st; if (!s) return;
    if (s.e) {
      const e = s.e;
      if (e.dead || e.id !== s.id || (s.t -= dt) <= 0) {
        unpin(s); pr.back = true; pr.hits.length = 0; pr.critC = 1; pr.life = 3; pr.sp = TSPEED * 1.3;
        w.blast(pr.p, pr.wid, pr.x, pr.y, TEAR, pr.dmg, MBURST);
        vis(w, pr.p, pr.wid, 'mcut', pr.x, pr.y, pr.a, 0, TEAR * 2, TEAR, 0.2);
        return;
      }
      pr.x = e.x; pr.y = e.y - 4; pr.vx = 0; pr.vy = 0; pr.out = pr.t + 1; pr.life = Math.max(pr.life, 1);
      return;
    }
    if (!s.h && pr.hov && !pr.back && pr.t >= pr.out) { s.h = true; pr.out += HOVER; pr.life += HOVER; pr.rehit = 0.15; pr.hitClr = pr.t; }
    if (s.h && !pr.back) { pr.vx = 0; pr.vy = 0; } else if (pr.back && pr.rehit) pr.rehit = 0;
  }
  function fanTick(w, pr, dt) { if (pr.back) pr.critC = 1; thrownTick(w, pr, dt); }
  // Dagger hit: pins (a pinning dagger's first hit on the way out), then executes as strike does.
  function thrownHit(w, pr, e) {
    const p = pr.p; if (!p || !p.weapons[0]) return;
    const ws = p.weapons[0], S = w.weaponS(p, 0), s = pr.st;
    if (s && S.pin && !pr.back && !s.e && !e.dead && ws.st.pins) { s.e = e; s.id = e.id; s.t = S.pdur; s.ws = ws; ws.st.pins.push(s); }
    if (S.exec > 0 && !e.dead && !e.boss && e.hp <= e.maxHp * S.exec) execute(w, p, ws, S, e);
  }
  const TO = { look: 'rknife', pierce: 999, ret: true, r: 5, speed: TSPEED, dmg: 0, life: 1, st: null, tick: thrownTick, onHit: thrownHit, onEnd: giveSt };
  function throwDaggers(w, p, ws, S) {
    const fan = S.fan > 0, n = Math.max(1, (S.thrown | 0) + (S.fan | 0)), o = TO, R = S.trange * S.area, a = w.aimDir(p);
    const spread = fan ? Math.min(0.28, 1.6 / n) : 0.35;
    o.life = 2 * R / TSPEED; o.r = 5 * S.area; o.dmg = S.dmg * S.tdm; o.look = fan ? 'sknife' : S.pin ? 'pknife' : 'rknife'; o.tick = fan ? fanTick : thrownTick;
    for (let side = 0; side < (fan ? 2 : 1); side++) {
      for (let i = 0; i < n; i++) {
        o.st = takeSt();
        const pr = w.shoot(p, ws.id, p.x, p.y - HAND, a + side * Math.PI + (i - (n - 1) / 2) * spread, S, o);
        pr.hov = !!S.hover && !S.pin;
      }
    }
  }

  // ---------------- Twin Daggers and the stab Forms ----------------
  // fire: one stab now and S.n - 1 queued at S.cd / S.n gaps (tick); thrown daggers on their own S.tcd timer; Assassinate: mark upkeep and shadow cuts (tick).
  const stabImpl = {
    init(w, p, ws) { const st = ws.st; st.q = 0; st.qt = 0; st.gap = 0; st.tt = 0.3; st.mark = null; st.mid = 0; st.mx = 0; st.my = 0; st.mt = 0; st.mz = null; st.mzId = 0; st.ct = 0.3; st.pins = []; },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (st.q > 0 && (st.qt -= dt) <= 0) { st.q--; st.qt += st.gap; stabOnce(w, p, ws, S); }
      if (S.thrown + S.fan > 0 && (st.tt -= dt) <= 0) { st.tt = S.tcd; throwDaggers(w, p, ws, S); }
      if (S.mark) markTick(w, p, ws, S, dt);
    },
    fire(w, p, ws, S) {
      const st = ws.st, n = Math.max(1, S.n | 0);
      while (st.q > 0) { st.q--; stabOnce(w, p, ws, S); }
      st.gap = S.cd / n; st.q = n - 1; st.qt = st.gap;
      stabOnce(w, p, ws, S);
      return true;
    },
  };
  // Assassinate: every 0.5 s (at once when the mark dies or leaves 220 px / the view) marks the toughest foe within 220 px in view (HP x4 boss, x2 elite, x1.25 the current mark);
  // a mark zone (4 s, renewed) follows it. Every S.mcd s the shadow cuts an X through the mark: two crossing segments of S.mlen x area px, forced crits (x S.mk on the mark).
  // A mark that dies bursts: 52 x area px around its last spot, dmg x 2, forced crits.
  const MARK_R = 220, MARK_Z = 4;
  function markTick(w, p, ws, S, dt) {
    const st = ws.st;
    let m = markOf(st);
    if (!m && st.mid) {
      const r = 52 * S.area;
      w.blast(p, ws.id, st.mx, st.my, r, S.dmg * 2, MBURST);
      vis(w, p, ws.id, 'sexec', st.mx, st.my, 0, 0, 1, r, 0.3);
      st.mark = null; st.mid = 0;
    }
    if (m) { st.mx = m.x; st.my = m.y; }
    if (m && (U.dist2(p.x, p.y, m.x, m.y) > MARK_R * MARK_R || !ED.inView(p, m.x, m.y, 0))) m = null;
    if (!m || (st.mt -= dt) <= 0) {
      st.mt = 0.5;
      const q = w.foeScan(p.x, p.y, MARK_R);
      let best = null, bs = 0;
      for (let k = 0; k < q.length; k++) {
        const e = q[k]; if (e.dead || U.dist2(p.x, p.y, e.x, e.y) > MARK_R * MARK_R || !ED.inView(p, e.x, e.y, 0)) continue;
        const sc = e.hp * (e.boss ? 4 : e.elite ? 2 : 1) * (e === m ? 1.25 : 1);
        if (sc > bs) { bs = sc; best = e; }
      }
      w.foeEnd();
      if (best !== m) { m = best; st.ct = Math.min(st.ct, 0.15); }
      st.mark = m; st.mid = m ? m.id : 0;
    }
    let z = st.mz && st.mz.id === st.mzId && !st.mz.dead ? st.mz : null;
    if (!m) { if (z) z.dead = true; st.mz = null; return; }
    if (!z || z.st !== m.id || z.t > MARK_Z - 0.2) { if (z) z.dead = true; z = vis(w, p, ws.id, 'smark', m.x, m.y, 0, 0, 0, m.r + 6, MARK_Z); z.st = m.id; st.mz = z; st.mzId = z.id; }
    z.x = m.x; z.y = m.y;
    if ((st.ct -= dt) <= 0) {
      st.ct = S.mcd;
      const a = w.rng.next() * Math.PI, L = S.mlen * S.area, hw = 5 * S.area;
      for (let i = 0; i < 2; i++) { const b = a + i * Math.PI / 2; seg(w, p, ws, S, m.x - Math.cos(b) * L / 2, m.y - Math.sin(b) * L / 2, b, L, hw, S.dmg, true); }
      vis(w, p, ws.id, 'mcut', m.x, m.y, a, 0, L, L / 2, 0.2);
    }
  }

  // Custom weapon keys (defaults below): len / wid (stab px), exec (execute HP fraction), burst (execute cut dmg factor), lunge (crit stab extra length), thrown (returning daggers),
  // tcd (throw cooldown s), trange (throw distance px), tdm (thrown dmg factor), hover; Forms: fan, cone (storm jitter rad), mark, mk (mark dmg factor), mcd / mlen (shadow cut),
  // bloom / petals / plen, pin / pdur.
  const KEYS = { len: 52, wid: 10, exec: 0, burst: 0, lunge: 0, thrown: 0, tcd: 1.2, trange: 100, tdm: 0.6, hover: false, fan: 0, cone: 0, mark: false, mk: 1, mcd: 0.5, mlen: 40,
    bloom: 0, petals: 6, plen: 0.6, pin: false, pdur: 1.2 };
  const base = (o) => Object.assign({}, KEYS, o);
  ED.addWeapon({
    id: 'daggers', name: 'Twin Daggers', icon: 'weapon.daggers', look: 'knife', sig: 'shade', mode: 'cursor', txt: 'Rapid stabs toward your cursor',
    base: base({ dmg: 13, cd: 0.5, n: 2, pierce: 0, area: 1, speed: 0, dur: 0, knock: 14, range: 0, crit: 0.1 }),
    paths: [
      { id: 'flurry', name: 'Flurry', form: 'thousand', ranks: [
        { mods: { n: 1 }, txt: '+1 stab per flurry' },
        { mods: { len: 26 }, txt: 'Stabs lunge much farther' },
        { mods: { n: 1, cd: -0.15 }, txt: '+1 stab, flurries come faster' }] },
      { id: 'lethality', name: 'Lethality', form: 'assassinate', ranks: [
        { mods: { exec: 0.1 }, txt: 'Stabs execute foes under 10% HP' },
        { mods: { crit: 0.1, lunge: 0.8 }, txt: '+10% crit, crits stab much farther' },
        { mods: { exec: 0.05, burst: 0.6 }, txt: 'Executes burst, cutting foes nearby' }] },
      { id: 'return', name: 'Return', form: 'shadowfan', ranks: [
        { mods: { thrown: 1 }, txt: 'Throw a dagger that flies back' },
        { mods: { thrown: 1 }, txt: '+1 returning dagger' },
        { mods: { hover: true, thrown: 1 }, txt: '+1 dagger, they spin at the far end' }] },
    ],
    hybrids: [{ need: [0, 1], form: 'lotus' }, { need: [1, 2], form: 'reaper' }],
  }, stabImpl);

  // Shadow Fan (Return): stabs + a fan of S.fan + S.thrown returning daggers forward and as many behind (registered first: the old evolution id); the return leg always crits.
  ED.addWeapon({
    id: 'shadowfan', name: 'Shadow Fan', icon: 'weapon.knives', look: 'sknife', sig: 'shade', mode: 'cursor', evolved: true, form: true, from: 'daggers', txt: 'Daggers fan out, return and crit',
    base: base({ dmg: 21, cd: 0.45, n: 2, pierce: 0, area: 1, speed: 0, dur: 0, knock: 14, range: 0, crit: 0.12, fan: 3, tcd: 1, trange: 120, tdm: 0.42 }),
    refine: [
      { mods: { fan: 2 }, txt: '+2 daggers each way' },
      { mods: { trange: 48, dmg: 0.15 }, txt: 'Daggers fly farther, +15% damage' },
    ],
  }, stabImpl);
  // Thousand Cuts (Flurry): the stab storm, each stab jittered within +-S.cone of the aim.
  ED.addWeapon({
    id: 'thousand', name: 'Thousand Cuts', icon: 'weapon.daggers', look: 'knife', sig: 'shade', mode: 'cursor', evolved: true, form: true, from: 'daggers', txt: 'A storm of stabs in a narrow cone',
    base: base({ dmg: 20, cd: 0.4, n: 6, pierce: 0, area: 1, speed: 0, dur: 0, knock: 2, range: 0, crit: 0.1, len: 68, wid: 12, cone: 0.36 }),
    refine: [
      { mods: { n: 2 }, txt: '+2 stabs per storm' },
      { mods: { cone: 0.12, len: 14 }, txt: 'Storm widens, stabs reach farther' },
    ],
  }, stabImpl);
  // Assassinate (Lethality): stabs + the mark and the shadow's X cuts.
  ED.addWeapon({
    id: 'assassinate', name: 'Assassinate', icon: 'weapon.daggers', look: 'knife', sig: 'shade', mode: 'cursor', evolved: true, form: true, from: 'daggers', txt: 'A shadow hunts the toughest foe',
    base: base({ dmg: 17, cd: 0.45, n: 2, pierce: 0, area: 1, speed: 0, dur: 0, knock: 14, range: 0, crit: 0.15, mark: true, mk: 1.1, mcd: 0.45, mlen: 64 }),
    refine: [
      { mods: { mcd: -0.2 }, txt: 'The shadow strikes far more often' },
      { mods: { mlen: 40 }, txt: 'Shadow cuts reach twice as far' },
    ],
  }, stabImpl);
  // Death Lotus (Flurry + Lethality): crit stabs bloom into a ring of blades around their first foe.
  ED.addWeapon({
    id: 'lotus', name: 'Death Lotus', icon: 'weapon.daggers', look: 'knife', sig: 'shade', mode: 'cursor', evolved: true, form: true, from: 'daggers', txt: 'Crits bloom into a ring of blades',
    base: base({ dmg: 20, cd: 0.45, n: 4, pierce: 0, area: 1, speed: 0, dur: 0, knock: 10, range: 0, crit: 0.15, bloom: 0.32, petals: 6, plen: 0.6 }),
    refine: [
      { mods: { petals: 2 }, txt: '+2 blades per bloom' },
      { mods: { crit: 0.1, plen: 0.4 }, txt: '+10% crit, blades reach farther' },
    ],
  }, stabImpl);
  // Reaper's Return (Lethality + Return): stabs + thrown daggers that pin a foe (strikes on it crit), then tear back as crits.
  ED.addWeapon({
    id: 'reaper', name: "Reaper's Return", icon: 'weapon.knives', look: 'pknife', sig: 'shade', mode: 'cursor', evolved: true, form: true, from: 'daggers', txt: 'Daggers pin foes, then tear back',
    base: base({ dmg: 18, cd: 0.45, n: 2, pierce: 0, area: 1, speed: 0, dur: 0, knock: 14, range: 0, crit: 0.12, thrown: 3, tcd: 1, trange: 120, tdm: 1, pin: true, pdur: 1.2 }),
    refine: [
      { mods: { thrown: 1 }, txt: '+1 pinning dagger' },
      { mods: { thrown: 1, tcd: -0.3 }, txt: '+1 pinning dagger, thrown more often' },
    ],
  }, stabImpl);

  // ---------------- Shadow Step ----------------
  // Blinks toward the cursor (40..N.dist px, through foes and over obstacles), cutting every foe within N.w / 2 of the path (forced crit, shoved aside, stunned 0.4 s), invulnerable 0.35 s.
  // The afterimage left at the start detonates after N.dur s (N.r radius, N.dmg x 1.5); knives: it throws 3 knives at random foes in view every 0.2 s until then.
  // recast: the first cast opens a 2.5 s window in which Q blinks again at no cost (hook tick; the cooldown resumes if unused).
  ED.addSkill({
    id: 'step', name: 'Shadow Step', icon: 'fx.smoke', cd: 8, txt: 'Blink, cut the path, leave a decoy',
    base: { dmg: 11, r: 44, dur: 0.8, dist: 130, w: 26 },
    levels: [
      { mods: { knives: true }, txt: 'Afterimage throws knives' },
      { mods: { dist: 50, w: 18, r: 0.3 }, txt: 'Blink farther, cut a wider path' },
      { mods: { recast: true }, txt: 'Recast once within 2.5 s' },
    ],
  }, (w, p, x, y, N) => {
    let a = Math.atan2(y - p.y, x - p.x), d = Math.hypot(x - p.x, y - p.y);
    if (d < 1) a = p.mdir;
    d = U.clamp(d, 40, N.dist);
    const ox = p.x, oy = p.y;
    p.x += Math.cos(a) * d; p.y += Math.sin(a) * d; ED.Arena.collide(w.arena, p, p.r);
    p.invuln = Math.max(p.invuln, 0.35); p.mdir = a;
    const len = Math.hypot(p.x - ox, p.y - oy) || 1;
    cut(w, p, ox, oy, p.x, p.y, N.w / 2, N.dmg, a);
    w.zone({ team: 0, p, wid: 'step', x: ox, y: oy, a, len, w: N.w, dur: 0.3, look: 'stepcut' });
    w.zone({ team: 0, p, wid: 'step', x: ox, y: oy, r: N.r, a, dur: N.dur, warn: true, dmg: N.dmg * 1.5, knock: 240, look: 'afterimg',
      st: N.knives ? { kt: 0, dmg: N.dmg * 0.35 } : null, onTick: N.knives ? afterKnives : null });
    w.hitBraziers(p.x, p.y, 24, p);
    if (N.recast) { if (p.stepRe > 0) p.stepRe = 0; else { p.stepRe = 2.5; p.stepArm = true; } }
    return { x0: Math.round(ox), y0: Math.round(oy), a, shake: 4 };
  });
  // Segment cut (x0, y0) -> (x1, y1) of half width hw: every foe touching it takes dmg as a forced crit, shoved perpendicular away from the path.
  function cut(w, p, x0, y0, x1, y1, hw, dmg, a) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + hw + 24, q = w.foeScan(mx, my, R);
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const m = hw + e.r; if (U.segDist2(e.x, e.y, x0, y0, x1, y1) > m * m) continue;
      const side = U.angDiff(a, Math.atan2(e.y - y0, e.x - x0)) > 0 ? 1 : -1, s = w.src(p, 'step', 'skill', 220);
      s.crit = true; s.kx = -Math.sin(a) * side; s.ky = Math.cos(a) * side;
      w.hitFoe(e, dmg, s);
      if (!e.dead) w.stun(e, 0.4);
    }
    w.foeEnd();
  }
  const KNIFE = { look: 'knife', dmg: 0, speed: 420, pierce: 1, life: 0.6, knock: 20 };
  function afterKnives(w, z) {
    const st = z.st;
    for (st.kt += 1 / 60; st.kt >= 0.2; st.kt -= 0.2) {
      KNIFE.dmg = st.dmg;
      for (let i = 0; i < 3; i++) {
        const t = w.target('random', z.p, 220);
        const a = t ? Math.atan2(t.y - z.y, t.x - z.x) : w.rng.next() * TAU;
        w.shoot(z.p, 'step', z.x, z.y - 8, a, null, KNIFE);
      }
    }
  }

  ED.HOOK.shade = {
    init(w, p) { p.stepRe = 0; p.stepArm = false; p.stepRest = 0; },
    tick(w, p, dt) {
      const sk = p.skills[0];
      if (p.stepArm) { p.stepArm = false; p.stepRest = sk.cd; sk.cd = 0; }
      else if (p.stepRe > 0) { p.stepRe -= dt; p.stepRest -= dt; if (p.stepRe <= 0) sk.cd = Math.max(0, p.stepRest); }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
