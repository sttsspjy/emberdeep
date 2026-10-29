// Knight (brawler): hero data, signature Cleave (3 paths x 3 ranks), 5 Forms (Colossus Blade, Whirlwind, Rending Gale; hybrids Earthsplitter, Blade Tempest), Q Shield Charge, HOOK (charge motion).
// Zones (networked, drawn by hfx-knight.js): 'charge' follows the hero during a charge (a = heading); 'crack' team-0 warn lines that erupt at dur; 'cut' lingering wind lines (len = full length, drawn growing).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI;

  ED.regLook('crescent', 'charge', 'shock', 'slash', 'whirl', 'crack', 'cut', 'gale');
  ED.addHero({ id: 'knight', name: 'Knight', hp: 130, speed: 68, crit: 0.05, sig: 'cleave', skills: ['charge'], icon: 'hero.knight.idle', col: '#c9d4e8', txt: 'Sword and shield. Holds the line.' });

  // ---------------- shared strike ----------------
  // Every knight weapon attacks in strings: fire() strikes at once, then S.n - 1 more strikes FORM.gap s apart (directional strikes alternate +-0.3 rad).
  // Strike keys (base + path / refine mods): arc (rad), back (directional strikes mirror behind at 0.5x damage, without waves or slams; follow-up strikes 0.8x), spin (a string's last strike is 360 deg), wave (crescents per strike), ret (crescents fly back),
  // slam (directional: blast at each strike tip; 360 Forms: ring around the hero on the string's last strike), stag (stun s on strike hits).
  // Form keys: cracks (Colossus: crack lines across the first front sweep of a string), cutT (Gale: cut line life s), quake + fiss (Earthsplitter: every quake-th attack, fiss radial fissures), orbit (Tempest: spiral blades).
  // FORM[wid]: full (strikes are 360 spins), spin (honours S.spin; Forms ignore it), gap (s between strikes), one (a single strike per attack; each S.n above 1 adds 2 cracks instead), heart (foes within half reach take that much extra), crack, swirl (spin hits push foes around the hero), gale (big crescents + cut lines), spiral (spiral blades per attack),
  // quake (fissure ring every S.quake attacks), move (cooldown runs this much faster while moving).
  const FORM = {
    cleave: { gap: 0.15, spin: true },
    colossus: { gap: 0.3, crack: true, one: true, heart: 2.5 },
    whirlwind: { full: true, gap: 0.14, swirl: true, move: 0.7, heart: 1 },
    gale: { gap: 0.18, gale: true },
    earthsplitter: { full: true, gap: 0.2, quake: true, heart: 1 },
    tempest: { full: true, gap: 0.16, spiral: true, heart: 1 },
  };
  const CRACK_MAX = 200; // crack / fissure / cut reach (px): stays inside the view

  let DK = 1; // damage factor of the current strike: back side 0.5, follow-up strikes (k > 0) 0.8
  // Swirl: tangential push (counter-clockwise, slightly inward) around (SX, SY).
  let SX = 0, SY = 0, SWF = 0;
  const swirl = (w, e) => { const dx = e.x - SX, dy = e.y - SY; w.knock(e, -dy - dx * 0.35, dx - dy * 0.35, SWF); };
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
  const GALE = { look: 'gale', speed: 260, dmg: 0, pierce: 999, r: 16, life: 0.7, knock: 0, ret: false };
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
  // Spiral blade (Tempest): circles its hero at up to 48 px for 0.4 s, then spirals out to ~200 px (pr.oa angle, pr.od turn sign), re-hits a foe every 0.3 s.
  const spiral = (w, pr, dt) => {
    const p = pr.p; if (!p || dt <= 0) return;
    pr.oa += pr.od * 4.2 * dt;
    const r = Math.min(48, 22 + pr.t * 110) + Math.max(0, pr.t - 0.4) * 150, tx = p.x + Math.cos(pr.oa) * r, ty = p.y - 4 + Math.sin(pr.oa) * r * 0.8;
    pr.vx = (tx - pr.x) / dt; pr.vy = (ty - pr.y) / dt;
  };
  const ORB = { look: 'crescent', speed: 1, dmg: 0, pierce: 999, r: 10, life: 1.4, knock: 0, rehit: 0.3, tick: spiral };
  const spirals = (w, p, ws, S, k) => {
    const n = (S.orbit | 0) + (S.wave | 0), sets = S.back ? 2 : 1;
    ORB.dmg = S.dmg * 0.12; ORB.r = 10 * S.area; ORB.knock = S.knock * 0.3;
    for (let s = 0; s < sets; s++) for (let i = 0; i < n; i++) {
      const a = (i + 0.5 * (k & 1) + 0.25 * s) / n * TAU, pr = w.shoot(p, ws.id, p.x + Math.cos(a) * 22, p.y - 4 + Math.sin(a) * 18, a + PI / 2, S, ORB);
      pr.oa = a; pr.od = s ? -1 : 1;
    }
  };

  // One strike of weapon ws toward a (k: index in the string, last: the string's last strike).
  const strike = (w, p, ws, S, a, k, last) => {
    const F = FORM[ws.id], full = !!F.full || (last && !!S.spin && !!F.spin), R = S.range * S.area, cx = p.x, cy = p.y - 4;
    ARC.knock = F.swirl ? 0 : S.knock; ARC.stun = S.stag || 0; ARC.look = full ? 'whirl' : 'slash'; ARC.onHit = F.swirl ? swirl : null;
    SX = cx; SY = cy; SWF = S.knock;
    const sides = !full && S.back ? 2 : 1, nw = S.wave | 0;
    for (let s = 0; s < sides; s++) {
      const b = a + s * PI;
      DK = (s ? 0.5 : 1) * (k ? 0.8 : 1);
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
        const f = S.fiss | 0, R = S.range * S.area;
        for (let i = 0; i < f; i++) crack(w, p, ws, S, (i + 0.5) / f * TAU + a, R * 2.4, 1, 0.35);
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
  // Whirlwind (Whirl): 360 spins, foes swirl around the hero, the cooldown runs 1.7x while moving.
  ED.addWeapon({
    id: 'whirlwind', name: 'Whirlwind', icon: 'weapon.alt.double_axe', sig: 'knight', mode: 'around', evolved: true, form: true, from: 'cleave', txt: 'Nonstop spins, faster while moving',
    base: { dmg: 24, cd: 0.9, n: 1, pierce: 0, area: 1.35, speed: 0, dur: 0, knock: 70, range: 58, arc: TAU, wave: 0, stag: 0, slam: 0 },
    refine: [
      { mods: { n: 1 }, txt: '+1 spin per whirl' },
      { mods: { area: 0.25 }, txt: '+25% spin size' },
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
    base: { dmg: 36, cd: 1.2, n: 1, pierce: 0, area: 1.35, speed: 0, dur: 0, knock: 160, range: 58, arc: TAU, wave: 0, stag: 0.3, slam: 0, quake: 3, fiss: 8 },
    refine: [
      { mods: { fiss: 4 }, txt: '+4 fissures' },
      { mods: { quake: -1 }, txt: 'Splits the earth every 2nd spin' },
    ], noAmount: true,
  }, IMPL);
  // Blade Tempest (Whirl + Edge Wave): each attack releases blades that spiral out around the hero (with back: a second ring turning the other way).
  ED.addWeapon({
    id: 'tempest', name: 'Blade Tempest', icon: 'weapon.alt.double_axe', sig: 'knight', mode: 'around', evolved: true, form: true, from: 'cleave', txt: 'Blades spiral out around you',
    base: { dmg: 34, cd: 1.2, n: 1, pierce: 0, area: 1.2, speed: 0, dur: 0, knock: 50, range: 52, arc: TAU, wave: 0, stag: 0, slam: 0, orbit: 3 },
    refine: [
      { mods: { orbit: 2 }, txt: '+2 spiral blades' },
      { mods: { orbit: 1, area: 0.2 }, txt: '+1 blade, +20% blade size' },
    ], noAmount: true,
  }, IMPL);

  // ---------------- Q: Shield Charge ----------------
  // Rush toward the aim point (N.dist px over N.t s, untouchable). Foes the shield meets take 0.4x N.dmg, are stunned N.stun s and carried along (max N.carry; more are knocked aside);
  // a boss or knockback-immune foe stops the charge. Impact at the end: blast r 46 + 0.4 width ahead, N.dmg x (1 + 0.1 per carried foe alive, max 12), flings foes forward.
  // quake: then a shockwave (r 120, 0.8x, stun 1.2 s); shards: the shockwave hurls that many shields outward.
  const SHARD = { look: 'shield', speed: 300, dmg: 0, pierce: 4, r: 7, life: 0.6, knock: 160 };
  const BOOM = { knock: 340, look: 'shock', kind: 'skill', stun: 1.2 };
  const IMPACT = { knock: 300, look: 'quake', kind: 'skill', stun: 0 };
  const shockFx = (w, p, x, y, r) => w.zone({ team: 0, p, wid: 'charge', x, y, r, dur: 0.4, look: 'shock' }); // visual-only ring (hfx-knight.js)
  ED.addSkill({
    id: 'charge', name: 'Shield Charge', icon: 'shield.kite', cd: 7, txt: 'Plow a crowd ahead, slam it at the end',
    base: { dmg: 20, dist: 120, t: 0.28, stun: 0.8, width: 26, carry: 10, shards: 0 },
    levels: [
      { mods: { dist: 60, width: 12, carry: 8 }, txt: 'Longer charge, wider shield' },
      { mods: { quake: true }, txt: 'Ends in a stunning shockwave' },
      { mods: { shards: 8 }, txt: 'Shockwave hurls 8 shields' },
    ],
  }, (w, p, x, y, N) => {
    const a = Math.atan2(y - p.y, x - p.x);
    const c = p.chg || (p.chg = { a: 0, t: 0, v: 0, dmg: 0, stun: 0, width: 0, cap: 0, quake: false, shards: 0, ids: [], carry: [], cid: [], on: false, wall: false });
    c.a = a; c.t = N.t; c.v = N.dist / N.t; c.dmg = N.dmg; c.stun = N.stun; c.width = N.width; c.cap = N.carry | 0; c.quake = !!N.quake; c.shards = N.shards | 0;
    c.ids.length = 0; c.carry.length = 0; c.cid.length = 0; c.on = true; c.wall = false;
    p.invuln = Math.max(p.invuln, N.t + 0.15);
    w.zone({ team: 0, p, wid: 'charge', x: p.x, y: p.y, r: N.width, a, dur: N.t + 0.08, follow: p.pid, look: 'charge' });
    return { a, shake: 5, stop: 0.04 };
  });
  ED.HOOK.knight = {
    init(w, p) { p.chg = null; },
    tick(w, p, dt) {
      const c = p.chg;
      if (!c || !c.on) return;
      const step = Math.min(dt, c.t), ca = Math.cos(c.a), sa = Math.sin(c.a), x0 = p.x, y0 = p.y;
      ED.Arena.move(w.arena, p, ca * c.v * step, sa * c.v * step, p.r);
      const mx = p.x - x0, my = p.y - y0;
      p.moving = true; p.mdir = c.a;
      for (let i = 0; i < c.carry.length; i++) { const e = c.carry[i]; if (!e.dead && e.id === c.cid[i]) ED.Arena.move(w.arena, e, mx, my, e.r); }
      const fx = p.x + ca * c.width * 0.5, fy = p.y - 4 + sa * c.width * 0.5, q = w.foeScan(fx, fy, c.width);
      for (let k = 0; k < q.length; k++) {
        const e = q[k];
        if (e.dead || c.ids.indexOf(e.id) >= 0 || U.dist2(fx, fy, e.x, e.y) > (c.width + e.r) ** 2) continue;
        c.ids.push(e.id);
        const s = w.src(p, 'charge', 'skill', 0);
        w.hitFoe(e, c.dmg * 0.4, s);
        if (e.dead) continue;
        w.stun(e, c.stun);
        if (e.boss || !(e.def.kb > 0)) c.wall = true;
        else if (c.carry.length < c.cap) { c.carry.push(e); c.cid.push(e.id); }
        else { const side = U.angDiff(c.a, Math.atan2(e.y - p.y, e.x - p.x)) > 0 ? 1 : -1; w.knock(e, Math.cos(c.a + side * 1.2), Math.sin(c.a + side * 1.2), 420); }
      }
      w.foeEnd();
      w.hitBraziers(p.x, p.y, c.width, p);
      c.t -= dt;
      if (c.wall) c.t = 0;
      if (c.t > 0) return;
      c.on = false;
      let n = 0;
      for (let i = 0; i < c.carry.length; i++) { const e = c.carry[i]; if (!e.dead && e.id === c.cid[i]) n++; }
      c.carry.length = 0;
      const r = 46 + c.width * 0.4, ix = p.x + ca * r * 0.5, iy = p.y - 4 + sa * r * 0.5;
      IMPACT.stun = c.stun;
      w.blast(p, 'charge', ix, iy, r, c.dmg * (1 + 0.1 * Math.min(12, n)), IMPACT);
      shockFx(w, p, ix, iy, r);
      if (!c.quake) return;
      w.blast(p, 'charge', p.x, p.y, 120, c.dmg * 0.8, BOOM);
      shockFx(w, p, p.x, p.y, 120);
      SHARD.dmg = c.dmg * 0.5;
      for (let i = 0; i < c.shards; i++) w.shoot(p, 'charge', p.x, p.y - 6, c.a + i / c.shards * TAU, null, SHARD);
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
