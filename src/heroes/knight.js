// Knight (brawler): hero data, signature Cleave (3 paths x 3 ranks), 5 Forms (Colossus Blade, Whirlwind, Rending Gale; hybrids Earthsplitter, Blade Tempest), Q Bulwark Shove.
// Zones (networked, drawn by hfx-knight.js): 'shove' / 'bulwark' (Q); 'crack' team-0 warn lines that erupt at dur; 'cut' lingering wind lines (len = full length, drawn growing).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;

  ED.regLook('crescent', 'shove', 'bulwark', 'slash', 'whirl', 'crack', 'cut', 'gale');
  ED.addHero({ id: 'knight', name: 'Knight', hp: 130, speed: 68, crit: 0.05, sig: 'cleave', skills: ['shove'], icon: 'hero.knight.idle', col: '#c9d4e8', txt: 'Sword and shield. Holds the line.' });

  // ---------------- shared strike ----------------
  // Every knight weapon attacks in strings: fire() strikes at once, then S.n - 1 more strikes FORM.gap s apart (directional strikes alternate +-0.3 rad).
  // Strike keys (base + path / refine mods): arc (rad), back (directional strikes mirror behind at 0.5x damage, without waves or slams; follow-up strikes 0.8x), spin (a string's last strike is 360 deg), wave (crescents per strike), ret (crescents fly back),
  // slam (directional: blast at each strike tip; 360 Forms: ring around the hero on the string's last strike), stag (stun s on strike hits).
  // Form keys: cracks (Colossus: crack lines across the first front sweep of a string), cutT (Gale: cut line life s), quake + fiss (Earthsplitter: every quake-th attack, fiss radial fissures), orbit (Tempest: spiral blades).
  // FORM[wid]: full (strikes are 360 spins), spin (honours S.spin; Forms ignore it), gap (s between strikes), one (a single strike per attack; each S.n above 1 adds 2 cracks instead), heart (foes within half reach take that much extra), crack, swirl (spin hits push foes around the hero), gale (big crescents + cut lines), spiral (spiral blades per attack),
  // quake (fissure ring every S.quake attacks), move (cooldown runs this much faster while moving), big (directional Forms: big foes take that many x from sweeps and crescents).
  const FORM = {
    cleave: { gap: 0.15, spin: true },
    colossus: { gap: 0.3, crack: true, one: true, heart: 2.5, big: 1.6 },
    whirlwind: { full: true, gap: 0.14, swirl: true, move: 0.3, heart: 1 },
    gale: { gap: 0.18, gale: true, big: 1.6 },
    earthsplitter: { full: true, gap: 0.2, quake: true, heart: 1 },
    tempest: { full: true, gap: 0.16, spiral: true, heart: 1 },
  };
  const CRACK_MAX = 200; // crack / fissure / cut reach (px): stays inside the view
  const SPIN_K = 0.6; // Cleave's path spin (Whirl rank 3) deals x SPIN_K
  // Big foes (radius >= BIG_R: brutes, elites, bosses) hit by a Form with F.big take the extra (big - 1) x dealt as a second, no-crit, no-knock hit.
  const BIG_R = 12;
  const heavy = (w, p, wid, e, dealt) => {
    const k = FORM[wid] ? FORM[wid].big || 1 : 1;
    if (k <= 1 || !(dealt > 0) || e.dead || !(e.r >= BIG_R || e.elite || e.boss)) return;
    const s = w.src(p, wid, 'weapon', 0); s.critC = 0; s.x = e.x; s.y = e.y;
    w.hitFoe(e, dealt * (k - 1) / (e.takeMul || 1), s);
  };
  let HP = null, HW = '';
  const arcBig = (w, e, dealt) => heavy(w, HP, HW, e, dealt);
  const projBig = (w, pr, e, dealt) => heavy(w, pr.p, pr.wid, e, dealt);

  let DK = 1; // damage factor of the current strike: back side 0.5, follow-up strikes (k > 0) 0.8
  // Swirl: tangential push (counter-clockwise, spiralling outward) around (SX, SY); elites take half (on top of w.knock's elite factor).
  let SX = 0, SY = 0, SWF = 0;
  const swirl = (w, e) => { const dx = e.x - SX, dy = e.y - SY; w.knock(e, -dy + dx * 0.5, dx + dy * 0.5, SWF * (e.elite ? 0.5 : 1)); };
  const ARC = { knock: 0, look: 'slash', stun: 0, onHit: null, noEv: false };
  const SLAM = { knock: 0, look: 'quake', stun: 0 };
  // Crescent wave: piercing; ret doubles its life so the outbound leg keeps its reach.
  const WAVE = { look: 'crescent', speed: 250, dmg: 0, pierce: 999, r: 12, life: 0.5, knock: 0, ret: false };
  const wave = (w, p, ws, S, a, k) => {
    WAVE.dmg = S.dmg * k * DK; WAVE.r = 10 * S.area; WAVE.knock = S.knock * 0.4; WAVE.ret = !!S.ret;
    WAVE.life = Math.min(0.72, 0.5 * Math.sqrt(S.area)) * (S.ret ? 2 : 1);
    w.shoot(p, ws.id, p.x + Math.cos(a) * 14, p.y - 4 + Math.sin(a) * 14, a, S, WAVE);
  };
  // Gale crescent: big, piercing, leaves a cut line (dps zone along its whole flight, ticking once the crescent has passed its start).
  const GALE = { look: 'gale', speed: 260, dmg: 0, pierce: 999, r: 16, life: 0.7, knock: 0, ret: false, onHit: projBig };
  const CUT = { team: 0, p: null, wid: '', look: 'cut', x: 0, y: 0, a: 0, len: 1, w: 12, dur: 1, tick: 0.25, tickDelay: 0.3, dps: 0, stun: 0 };
  const gale = (w, p, ws, S, a) => {
    GALE.dmg = S.dmg * 0.7 * DK; GALE.r = 15 * S.area; GALE.knock = S.knock * 0.3; GALE.ret = !!S.ret; GALE.life = 0.68 * (S.ret ? 2 : 1);
    const x = p.x + Math.cos(a) * 14, y = p.y - 4 + Math.sin(a) * 14;
    w.shoot(p, ws.id, x, y, a, S, GALE);
    CUT.p = p; CUT.wid = ws.id; CUT.x = x; CUT.y = y; CUT.a = a; CUT.len = Math.min(CRACK_MAX, GALE.speed * 0.68); CUT.w = 12 * Math.sqrt(S.area);
    CUT.dur = S.cutT; CUT.dps = S.dmg * 0.45; CUT.stun = 0;
    w.zone(CUT);
  };
  // Crack / fissure: a team-0 warn line from (x, y) along a that erupts after dur (hit, stagger, knock away from its start).
  const CRACK = { team: 0, warn: true, p: null, wid: '', look: 'crack', x: 0, y: 0, a: 0, len: 1, w: 18, dur: 0.3, dmg: 0, stun: 0, knock: 0 };
  const crack = (w, p, ws, S, a, len, k, dur) => {
    CRACK.p = p; CRACK.wid = ws.id; CRACK.x = p.x; CRACK.y = p.y - 2; CRACK.a = a; CRACK.len = Math.min(CRACK_MAX, len); CRACK.w = 18 * Math.sqrt(S.area);
    CRACK.dur = dur; CRACK.dmg = S.dmg * k * DK; CRACK.stun = (S.stag || 0) + 0.3; CRACK.knock = S.knock * 0.5;
    w.zone(CRACK);
  };
  const slam = (w, p, ws, S, x, y, r, k) => { SLAM.knock = S.knock * 1.2; SLAM.stun = (S.stag || 0) + 0.3; w.blast(p, ws.id, x, y, r, S.dmg * k * DK, SLAM); };
  // Spiral blade (Tempest): circles its hero at up to 48 px for 0.4 s, then spirals out to ~200 px (pr.oa angle, pr.od turn sign), re-hits a foe every 0.6 s.
  const spiral = (w, pr, dt) => {
    const p = pr.p; if (!p || dt <= 0) return;
    pr.oa += pr.od * 4.2 * dt;
    const r = Math.min(48, 22 + pr.t * 110) + Math.max(0, pr.t - 0.4) * 150, tx = p.x + Math.cos(pr.oa) * r, ty = p.y - 4 + Math.sin(pr.oa) * r * 0.8;
    pr.vx = (tx - pr.x) / dt; pr.vy = (ty - pr.y) / dt;
  };
  const ORB = { look: 'crescent', speed: 1, dmg: 0, pierce: 999, r: 10, life: 1.4, knock: 0, rehit: 0.6, tick: spiral };
  const spirals = (w, p, ws, S, k) => {
    const n = (S.orbit | 0) + (S.wave | 0), sets = S.back ? 2 : 1;
    ORB.dmg = S.dmg * 0.18; ORB.r = 10 * S.area; ORB.knock = S.knock * 0.3;
    for (let s = 0; s < sets; s++) for (let i = 0; i < n; i++) {
      const a = (i + 0.5 * (k & 1) + 0.25 * s) / n * TAU, pr = w.shoot(p, ws.id, p.x + Math.cos(a) * 22, p.y - 4 + Math.sin(a) * 18, a + PI / 2, S, ORB);
      pr.oa = a; pr.od = s ? -1 : 1;
    }
  };

  // Strike reach: range x area; full spins leave out Velocity (S.range carries it): spin radius grows with area only.
  const reach = (p, S, full) => S.range * S.area / (full ? 1 + (p.stats.velocity || 0) : 1);
  // One strike of weapon ws toward a (k: index in the string, last: the string's last strike).
  const strike = (w, p, ws, S, a, k, last) => {
    const F = FORM[ws.id], full = !!F.full || (last && !!S.spin && !!F.spin), R = reach(p, S, full), cx = p.x, cy = p.y - 4;
    ARC.knock = F.swirl ? 0 : S.knock; ARC.stun = S.stag || 0; ARC.look = full ? 'whirl' : 'slash'; ARC.onHit = F.swirl ? swirl : F.big ? arcBig : null;
    SX = cx; SY = cy; SWF = S.knock; HP = p; HW = ws.id;
    const sk = full && !F.full ? SPIN_K : 1;
    const sides = !full && S.back ? 2 : 1, nw = S.wave | 0;
    for (let s = 0; s < sides; s++) {
      const b = a + s * PI;
      DK = (s ? 0.5 : 1) * (k ? 0.8 : 1) * sk;
      w.arc(p, ws.id, cx, cy, b, R, full ? TAU : S.arc, S.dmg * DK, ARC);
      if (F.heart) { ARC.noEv = true; w.arc(p, ws.id, cx, cy, b, R * 0.5, full ? TAU : S.arc, S.dmg * DK * F.heart, ARC); ARC.noEv = false; }
      if (full) continue;
      if (F.gale && !s) for (let i = 0; i < nw; i++) gale(w, p, ws, S, b + (i - (nw - 1) / 2) * 0.3);
      else if (!s) for (let i = 0; i < nw; i++) wave(w, p, ws, S, b + (i - (nw - 1) / 2) * 0.35, 0.45);
      if (F.crack && k === 0 && s === 0) { const c = (S.cracks | 0) + (F.one ? 2 * ((S.n | 0) - 1) : 0); for (let i = 0; i < c; i++) crack(w, p, ws, S, b + (c > 1 ? (i / (c - 1) - 0.5) * S.arc * 0.85 : 0), R * 1.9, 0.7, 0.3 + 0.05 * i); }
      if (S.slam && !s) slam(w, p, ws, S, cx + Math.cos(b) * R * 0.8, cy + Math.sin(b) * R * 0.8, 24 * S.area, 0.8);
    }
    ARC.onHit = null; DK = k ? 0.8 : 1;
    if (full && !F.spiral) for (let i = 0; i < nw; i++) wave(w, p, ws, S, (i + 0.5 * (k & 1)) / nw * TAU, 0.5);
    if (F.full && S.slam && last) slam(w, p, ws, S, cx, cy, R * 1.35, 0.8);
    DK = 1;
  };
  // Aim: directional strings along the cursor (w.aimDir; back strikes mirror it); 360 strings use p.mdir.
  const aim = (w, p, ws) => (FORM[ws.id].full ? p.mdir : w.aimDir(p));
  const IMPL = {
    fire(w, p, ws, S) {
      const F = FORM[ws.id], st = ws.st, n = F.one ? 1 : S.n | 0, a = aim(w, p, ws);
      st.k = 0; st.a = a; st.left = n - 1; st.t = F.gap;
      if (F.spiral) spirals(w, p, ws, S, st.q = (st.q | 0) + 1);
      strike(w, p, ws, S, a, 0, n <= 1);
      if (F.quake && (st.q = (st.q | 0) + 1) >= (S.quake | 0)) {
        st.q = 0;
        const f = S.fiss | 0, R = reach(p, S, true);
        for (let i = 0; i < f; i++) crack(w, p, ws, S, (i + 0.5) / f * TAU + a, S.range * S.area * 2.4, 1, 0.35);
        slam(w, p, ws, S, p.x, p.y - 4, R * 1.2, 1);
      }
      return true;
    },
    tick(w, p, ws, S, dt) {
      const F = FORM[ws.id], st = ws.st;
      if (F.move && p.moving) ws.cd -= dt * F.move;
      if (!(st.left > 0) || (st.t -= dt) > 0) return;
      st.t = F.gap; st.left--; st.k++;
      strike(w, p, ws, S, F.full ? st.a + st.k * 0.4 : st.a + (st.k & 1 ? 0.3 : -0.3), st.k, st.left === 0);
    },
  };

  // ---------------- Cleave and its Forms ----------------
  ED.addWeapon({
    id: 'cleave', name: 'Cleave', icon: 'weapon.longsword', sig: 'knight', mode: 'cursor', txt: 'Sword arc toward your cursor',
    base: { dmg: 24, cd: 1.1, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 120, range: 56, arc: 2.0, wave: 0, stag: 0, slam: 0 },
    paths: [
      { id: 'great', name: 'Greatblade', form: 'colossus', ranks: [
        { mods: { area: 0.3, cd: 0.15, stag: 0.3 }, txt: 'Bigger, slower swings that stagger' },
        { mods: { arc: 0.9, dmg: 0.3 }, txt: 'Much wider arc, +30% damage' },
        { mods: { slam: 1 }, txt: 'Each swing ends in a ground slam' }] },
      { id: 'whirl', name: 'Whirl', form: 'whirlwind', ranks: [
        { mods: { back: true }, txt: 'Also swings behind you' },
        { mods: { n: 1 }, txt: '+1 swing per attack' },
        { mods: { spin: true }, txt: 'Last swing becomes a full spin' }] },
      { id: 'edge', name: 'Edge Wave', form: 'gale', ranks: [
        { mods: { wave: 1 }, txt: 'Swings fling a crescent wave' },
        { mods: { wave: 2 }, txt: '+2 waves in a fan' },
        { mods: { ret: true, dmg: 0.2 }, txt: 'Waves fly back to you, +20% damage' }] },
    ],
    hybrids: [{ need: [0, 1], form: 'earthsplitter' }, { need: [1, 2], form: 'tempest' }], noAmount: true,
  }, IMPL);
  // Whirlwind (Whirl): 360 spins (60 px at Form base), hits swirl foes around and out from the hero, the cooldown runs 1.3x while moving.
  ED.addWeapon({
    id: 'whirlwind', name: 'Whirlwind', icon: 'weapon.alt.double_axe', sig: 'knight', mode: 'around', evolved: true, form: true, from: 'cleave', txt: 'Nonstop spins, faster while moving',
    base: { dmg: 12, cd: 0.9, n: 1, pierce: 0, area: 1.2, speed: 0, dur: 0, knock: 150, range: 50, arc: TAU, wave: 0, stag: 0, slam: 0 },
    refine: [
      { mods: { n: 1 }, txt: '+1 spin per whirl' },
      { mods: { area: 0.15 }, txt: '+15% spin size' },
    ], noAmount: true,
  }, IMPL);
  // Colossus Blade (Greatblade): one huge slow 200 deg sweep that staggers; cracks fan across it and erupt 0.3 s later.
  ED.addWeapon({
    id: 'colossus', name: 'Colossus Blade', icon: 'weapon.longsword', sig: 'knight', mode: 'cursor', evolved: true, form: true, from: 'cleave', txt: 'One giant sweep that cracks the ground',
    base: { dmg: 58, cd: 1.8, n: 1, pierce: 0, area: 1.5, speed: 0, dur: 0, knock: 200, range: 60, arc: 3.5, wave: 0, stag: 0.5, slam: 0, cracks: 3 },
    refine: [
      { mods: { cracks: 2 }, txt: '+2 ground cracks' },
      { mods: { area: 0.2, stag: 0.4 }, txt: '+20% sweep size, longer stagger' },
    ], noAmount: true,
  }, IMPL);
  // Rending Gale (Edge Wave): swings fling big piercing crescents that leave cutting wind lines.
  ED.addWeapon({
    id: 'gale', name: 'Rending Gale', icon: 'weapon.longsword', sig: 'knight', mode: 'cursor', evolved: true, form: true, from: 'cleave', txt: 'Big crescents that leave cutting wind',
    base: { dmg: 20, cd: 1.3, n: 1, pierce: 0, area: 1.15, speed: 0, dur: 0, knock: 80, range: 56, arc: 2.0, wave: 3, stag: 0, slam: 0, cutT: 1.0 },
    refine: [
      { mods: { wave: 2 }, txt: '+2 crescents' },
      { mods: { cutT: 1.0 }, txt: 'Wind cuts linger twice as long' },
    ], noAmount: true,
  }, IMPL);
  // Earthsplitter (Greatblade + Whirl): heavy spins; every quake-th attack fissures radiate all around and the ground slams.
  ED.addWeapon({
    id: 'earthsplitter', name: 'Earthsplitter', icon: 'weapon.alt.double_axe', sig: 'knight', mode: 'around', evolved: true, form: true, from: 'cleave', txt: 'Heavy spins; every 3rd splits the earth',
    base: { dmg: 25, cd: 1.2, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 160, range: 46, arc: TAU, wave: 0, stag: 0.3, slam: 0, quake: 3, fiss: 8 },
    refine: [
      { mods: { fiss: 4 }, txt: '+4 fissures' },
      { mods: { quake: -1 }, txt: 'Splits the earth every 2nd spin' },
    ], noAmount: true,
  }, IMPL);
  // Blade Tempest (Whirl + Edge Wave): each attack releases blades that spiral out around the hero (with back: a second ring turning the other way).
  ED.addWeapon({
    id: 'tempest', name: 'Blade Tempest', icon: 'weapon.alt.double_axe', sig: 'knight', mode: 'around', evolved: true, form: true, from: 'cleave', txt: 'Blades spiral out around you',
    base: { dmg: 11, cd: 1.2, n: 1, pierce: 0, area: 1.2, speed: 0, dur: 0, knock: 120, range: 50, arc: TAU, wave: 0, stag: 0, slam: 0, orbit: 3 },
    refine: [
      { mods: { orbit: 2 }, txt: '+2 spiral blades' },
      { mods: { orbit: 1, area: 0.2 }, txt: '+1 blade, +20% blade size' },
    ], noAmount: true,
  }, IMPL);

  // ---------------- Q: Bulwark Shove ----------------
  // Zero damage. Every foe within N.r px of the hero (inside its view) slides out to N.r x OUT px from it (W.push: elites half the way, bosses and knockback-immune foes stay)
  // and is slowed N.slow for N.slowT s; stun (L3): also stunned N.stun s first. ring (L4): a ring at the shove edge holds N.ring s at the cast point; foes cannot cross it inward
  // (W.blockZone with st.out). Zones: 'shove' (visual wave, r = shove edge), 'bulwark' (the ring, w = band width).
  const OUT = 5 / 3;
  ED.addSkill({
    id: 'shove', name: 'Bulwark Shove', icon: 'shield.kite', cd: 9, txt: 'Shove the crowd away and slow it',
    base: { r: 120, slow: 0.5, slowT: 3, stun: 0, ring: 0 },
    levels: [
      { mods: { r: 0.3 }, txt: '+30% shove radius' },
      { mods: { stun: 1 }, txt: 'Shoved foes are stunned 1 s' },
      { mods: { ring: 3 }, txt: 'Leaves a ring foes cannot cross' },
    ],
  }, (w, p, x, y, N) => {
    const R = N.r, to = R * OUT, q = w.foeScan(p.x, p.y, R);
    let n = 0;
    for (let k = 0; k < q.length; k++) {
      const e = q[k], d = Math.hypot(e.x - p.x, e.y - p.y);
      if (e.dead || d > R + e.r || !ED.inView(p, e.x, e.y, e.r)) continue;
      w.push(e, p.x, p.y, to - d);
      w.slow(e, N.slow, N.slowT);
      if (N.stun > 0) w.stun(e, N.stun);
      n++;
    }
    w.foeEnd();
    w.zone({ team: 0, p, wid: 'shove', x: p.x, y: p.y, r: to, dur: 0.45, look: 'shove' });
    if (N.ring > 0) w.zone({ team: 0, p, wid: 'shove', x: p.x, y: p.y, r: to, w: 14, dur: N.ring, look: 'bulwark', st: { out: true, lure: 0, lt: 0 }, onTick: ED.blockTick });
    return { r: Math.round(to), n, shake: 6, stop: 0.06 };
  });
})(globalThis.ED || (globalThis.ED = {}));
