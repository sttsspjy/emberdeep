// Boss 'wickmother' (The Wickmother, the Wickdeep finale in the Sanctum room w.sanctum = { st, t0, x, y, w, h }; without it a 720 x 480 room is set at spawn): a colossal wax being anchored to
// the room's north wall. Bodies: the heart-flame core (ED.FOES.wickmother: the boss pool, fixed in her chest; heroes are pushed out of her body ellipse) and two wax hands (boss parts 'wmhand',
// WM.hand.hp x her max HP each; a broken hand goes limp WM.hand.limp s, then regrows). Her script drives the hands; their own brain only stands still.
// P1 Hands (100-70%): the core is warded (hits deal 1 and her HP is held); hands slam (warned circle, then an expanding shock ring), sweep (a warned lane, then a hand drags across it) and clap
//   (both hands close on a warned band with one gap); the head rains wax (warned drips leave slowing pools). Both hands broken at once: she kneels (core lowered, x WM.kneel.mul damage, WM.kneel.t s).
// P2 Snuffing (70-35%): the room darkens; 4 sconces near the corners; a hero lights one by standing in it WM.sconce.light s; a hand snuffs the lit one farthest from the heroes every
//   WM.sconce.snuff[party - 1] s (warned slam; breaking that hand saves it). All 4 lit at once: she kneels, the sconces go out after. Head: flame spirals from the wick crown, wax tides, rain.
// P3 Burn-down (35-0%): no ward; the wick burns WM.burn.t s (bossBar.rev), the side and bottom walls melt inward (hazard band, WM.burn.melt px at the end), everything faster, patterns combine
//   (spiral + slams, tide + clap with the clap gap in a tide gap); at 0 the flame floods the room (WM.burn.flood s warning, then a lethal hazard). Phase changes clamp HP at the threshold.
// Every attack telegraphs >= 0.6 s; hazards that follow a telegraph keep its lead in st.tw. The global final-boss enrage does not apply (the Sanctum skips it).
// Client state (snapshot-safe): core e.st = 1 cast | 2 roar | 4 ward | 8 kneel | (phase - 1) << 4; hand e.st = pose (0 hover, 1 raised, 2 flat, 3 sweep, 4 clap side, 6 regrow);
// zones 'wmbody' (w = core st + 64 x wick %), 'wmsconce' (w = 1 lit, else progress in eighths), 'wmmelt' (room centre, r = half width, w = inset px + 1000 x half height), 'wmlimp' (a broken hand, w = side). Zones with st.inert never hurt (bots skip them).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU, B = ED.Bosses, L = B.lib, DT = C.TICK;
  const { tele, line } = L;
  const { hz } = B.libB;
  ED.regLook('wmbody', 'wmsconce', 'wmmelt', 'wmlimp', 'wmslam', 'wmshock', 'wmlane', 'wmsweep', 'wmclap', 'wmdrip', 'wmwax', 'wmcrown', 'wmflame', 'wmtidew', 'wmtide', 'wmsnuff', 'wmflood');
  const WM = B.WICKMOTHER = {
    hp: 3.0,                  // x the normal boss HP (ED.bossHp x party x stage)
    phases: [0.7, 0.35],      // core HP fractions that start P2 and P3
    core: { dy: 170, rx: 156, ry: 86, oy: 20, crown: 150 }, // core below the room top; body ellipse half-axes, its centre above the core; wick crown height above the core
    kneel: { t: 10, mul: 1.5, dy: 48, speed: 110 },        // s, damage taken, px lowered, px/s
    hand: { hp: 0.04, spd: 300, limp: 8, regrow: 0.8, rest: [196, 30], p3: 1.25 }, // x core max HP; px/s; s limp; s rising; rest offset from the core; P3 speed factor
    pause: { hand: [1.5, 1.3, 0.85], head: [5.0, 3.2, 2.4] }, // s between hand / head attacks per phase
    tele: 0.85,               // P3 telegraph factor (floor 0.6 s)
    slam: { w: 3, r: 58, warn: 1.0, mul: 1.6, ring: [58, 170], ringT: 1.0, band: 6, rmul: 0.6, hold: 0.5 }, // warned circle; then a shock ring r0 -> r1 px over ringT s (band half-width px, x boss damage)
    sweep: { w: 2, lane: 64, warn: 1.1, speed: 460, mul: 1.4, pre: 0.8 }, // lane width; hand speed along it; s of the warning spent travelling to the lane at most
    clap: { p: [0.3, 0.25, 0.4], band: 60, gap: 88, off: 110, warn: 1.25, close: 0.35, mul: 2.0, hold: 0.45 }, // chance when both hands are free; gap offset from the hero (px)
    rain: { n: [4, 5, 6], r: 30, warn: 1.0, stag: 0.18, spread: 110, mul: 1.0, pool: 32, life: 4.5, slow: 0.4 },
    spiral: { w: 3, arms: [3, 3, 4], rate: 0.12, dur: 3.4, speed: 92, spin: 1.7, warn: 0.9, mul: 0.7, r: 5 },
    tide: { w: 2, warn: 1.3, speed: 110, band: 24, gaps: [2, 2, 1], gap: 90, mul: 1.6 },
    rainW: [1, 2, 1],         // head attack weight of rain per phase (spiral / tide from P2)
    sconce: { inset: 64, r: 20, light: 1.3, decay: 0.5, snuff: [18, 13, 10, 8], first: 8, warn: 1.2, mul: 1.4 }, // light s; unlit progress lost per s (x light rate); snuff s by party size
    burn: { t: 90, melt: 96, mul: 0.5, tick: 0.5, flood: 2.5, kill: 1e4 }, // wick s; melt inset px at 0; melt x boss damage per tick (no i-frames); flood warning s; flood x boss damage
  };
  ED.addFoe('wickmother', { name: 'The Wickmother', look: 'boss.wickmother', ai: 'boss', boss: true, hp: 0, spd: 0, dmg: 2, r: 30, xp: 0, kb: 0, noElite: true, noContact: true });
  ED.addFoe('wmhand', { name: 'Wax Hand', look: 'boss.wmhand', ai: 'boss', boss: true, hp: 0, spd: 0, dmg: 2, r: 26, xp: 0, kb: 0, noElite: true, noContact: true });

  const INERT = { inert: true, test: () => false };
  const live = (H) => !!H.e && !H.e.dead && H.e.id === H.id;
  const zLive = (z, id) => !!z && !z.dead && z.id === id;
  const T = (v, s) => Math.max(0.6, s * (v.phase >= 3 ? WM.tele : 1));
  const fast = (v) => (v.phase >= 3 ? WM.hand.p3 : 1);
  // Lowest y of her body ellipse at rest (lanes and slams stay in front of it).
  const front = (v) => v.core.ay - WM.core.oy + WM.core.ry;

  // Room rect of the fight (w.sanctum when set) into v.R with its edges l / r / t / b.
  const room = (w, v) => {
    const S = w.sanctum, R = v.R;
    if (S) { R.x = S.x; R.y = S.y; R.w = S.w; R.h = S.h; }
    R.l = R.x - R.w / 2; R.r = R.x + R.w / 2; R.t = R.y - R.h / 2; R.b = R.y + R.h / 2;
    return R;
  };
  // Clamps hand f into the room (below the body band).
  const clampHand = (v, f) => { const R = v.R, m = f.r; f.x = U.clamp(f.x, R.l + m, R.r - m); f.y = U.clamp(f.y, R.t + 40, R.b - m * 0.6); };
  // Moves hand f toward (x, y) at spd px/s. True once there.
  const mvHand = (v, f, x, y, spd, dt) => {
    const dx = x - f.x, dy = y - f.y, d = Math.hypot(dx, dy), s = spd * dt;
    if (d <= s) { f.x = x; f.y = y; } else { f.x += dx / d * s; f.y += dy / d * s; }
    clampHand(v, f);
    return d <= s;
  };
  // Next target hero (round robin over the living), or null.
  const pick = (w, v) => { const Lv = w.living; if (!Lv.length) return null; v.ti = (v.ti + 1) % Lv.length; return Lv[v.ti]; };
  const ev = (w, e, phase, fid) => w.emit({ t: 'boss', id: 'wickmother', fid: fid || e.id, phase });

  // ---------- hands ----------
  // New hand for slot H at (x, y): HP from the core, rises over WM.hand.regrow s.
  function grow(w, e, v, H, x, y) {
    const f = w.spawnFoe('wmhand', x, y);
    if (!f) return;
    f.maxHp = f.hp = Math.max(1, Math.round(e.maxHp * WM.hand.hp)); f.hpQ = 255; f.dmg = e.dmg; f.face = H.side; f.st = 6; f.invulnT = WM.hand.regrow;
    H.e = f; H.id = f.id; H.st = 'grow'; H.t = WM.hand.regrow; H.a = null;
  }
  // Hand H broke: a limp hand puddle stays where it fell (zone 'wmlimp') for WM.hand.limp s (held while she kneels).
  function broke(w, e, v, H) {
    const f = H.e, x = f.x, y = f.y;
    H.e = null; H.id = 0; H.a = null; H.st = 'limp'; H.t = WM.hand.limp; H.x = x; H.y = y;
    const z = w.zone({ team: 1, look: 'wmlimp', wid: 'wmlimp', x, y, r: 30, w: H.side, dur: 1e5, src: e, st: INERT });
    H.z = z; H.zid = z.id;
    w.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: 44, look: 'wmlimp', team: 1 });
    ev(w, e, 'break');
    if (v.phase === 1 && v.kneelT <= 0 && v.H.every((o) => o.st === 'limp')) kneel(w, e, v); // both broken at once
  }
  // Rest spot of hand H beside her body.
  const restX = (v, H) => v.core.x + H.side * WM.hand.rest[0], restY = (v) => v.core.ay + WM.hand.rest[1];

  // Hand actions (H.a = { k, t, ... }); upd returns true when done. Their telegraphs belong to the hand (a broken hand cancels them).
  const ACT = {
    // Slam: the hand hovers over the target spot (raised) while a circle warns, slams flat, sends a shock ring, rests flat.
    slam: {
      start(w, e, v, H, p) {
        const R = v.R, q = WM.slam, a = H.a = { k: 'slam', t: 0, x: U.clamp(p.x, R.l + q.r * 0.5, R.r - q.r * 0.5), y: U.clamp(p.y, front(v), R.b - 20), warn: T(v, q.warn), hit: false };
        tele(w, H.e, a.x, a.y, q.r, a.warn, q.mul, { look: 'wmslam' });
      },
      upd(w, e, v, H, dt) {
        const a = H.a, f = H.e, q = WM.slam;
        if (a.t < a.warn) { f.st = 1; mvHand(v, f, a.x, a.y, WM.hand.spd * 2.2 * fast(v), dt); return false; }
        if (!a.hit) {
          a.hit = true; f.x = a.x; f.y = a.y; f.st = 2;
          hz(w, e, { look: 'wmshock', x: a.x, y: a.y, r: q.ring[0], dur: q.ringT }, { mul: q.rmul, tw: a.warn, upd: ringUpd, test: ringTest, r0: q.ring[0], r1: q.ring[1] });
        }
        return a.t >= a.warn + q.hold;
      },
    },
    // Sweep: the hand travels to its own wall at the target's height while the lane warns, then drags across the room.
    sweep: {
      start(w, e, v, H, p) {
        const R = v.R, q = WM.sweep, y = U.clamp(p.y, front(v) + q.lane / 2, R.b - 24), x0 = H.side < 0 ? R.l + 28 : R.r - 28;
        const a = H.a = { k: 'sweep', t: 0, y, x0, x1: H.side < 0 ? R.r - 28 : R.l + 28, warn: T(v, q.warn), go: false };
        a.sp = Math.max(WM.hand.spd * 2, Math.hypot(H.e.x - x0, H.e.y - y) / Math.min(q.pre, a.warn * 0.8));
        line(w, H.e, R.l, y, 0, R.w, q.lane, a.warn, 0, { look: 'wmlane' });
      },
      upd(w, e, v, H, dt) {
        const a = H.a, f = H.e, q = WM.sweep;
        f.st = 3; f.face = a.x1 > a.x0 ? 1 : -1;
        if (a.t < a.warn) { mvHand(v, f, a.x0, a.y, a.sp, dt); return false; }
        if (!a.go) { a.go = true; f.x = a.x0; f.y = a.y; ev(w, e, 'sweep'); hz(w, f, { look: 'wmsweep', x: f.x, y: f.y, r: f.r + 6, dur: Math.abs(a.x1 - a.x0) / (q.speed * fast(v)) + 0.3 }, { mul: q.mul, tw: a.warn, upd: follow }); }
        return mvHand(v, f, a.x1, a.y, q.speed * fast(v), dt);
      },
      end(w, e, v, H) { if (H.e) H.e.face = H.side; },
    },
    // Clap (one per hand, shared band): the hand goes to its wall, then closes on the gap edge as its half of the band resolves.
    clap: {
      upd(w, e, v, H, dt) {
        const a = H.a, f = H.e, q = WM.clap;
        f.st = a.t < a.warn ? 4 : 2;
        if (a.t < a.warn - q.close) { mvHand(v, f, a.xw, a.y, WM.hand.spd * 2.4 * fast(v), dt); return false; }
        if (a.t < a.warn) { const k = U.clamp((a.t - (a.warn - q.close)) / q.close, 0, 1); f.x = U.lerp(a.xw, a.xe, k * k); f.y = a.y; return false; }
        f.x = a.xe; f.y = a.y;
        return a.t >= a.warn + q.hold;
      },
    },
    // Snuff: the hand hovers over a lit sconce while a circle warns, then slams it out.
    snuff: {
      start(w, e, v, H, sc) {
        const q = WM.sconce, a = H.a = { k: 'snuff', t: 0, sc, warn: T(v, q.warn) };
        tele(w, H.e, sc.x, sc.y, q.r + 22, a.warn, q.mul, { look: 'wmsnuff', onEnd: () => { if (sc.lit && v.phase === 2 && v.kneelT <= 0) { sc.lit = false; sc.prog = 0; ev(w, e, 'snuff'); } } });
      },
      upd(w, e, v, H, dt) {
        const a = H.a, f = H.e;
        if (a.t < a.warn) { f.st = 1; mvHand(v, f, a.sc.x, a.sc.y, WM.hand.spd * 2 * fast(v), dt); return false; }
        f.st = 2;
        return a.t >= a.warn + 0.4;
      },
    },
  };
  // Shock ring: grows from r0 to r1 over its life; a hero on its band (WM.slam.band px) is hit.
  function ringUpd(w, z, e, st) { z.r = st.r0 + (st.r1 - st.r0) * Math.min(1, z.t / z.dur); }
  function ringTest(w, z, p) { const d = Math.hypot(p.x - z.x, p.y - z.y); return Math.abs(d - z.r) <= WM.slam.band + p.r; }
  // Zone rides its source (sweep palm).
  function follow(w, z, f) { z.x = f.x; z.y = f.y; }

  // Clap on hero p's band: both hands (free) close on a gap at gx (default: near the hero, at most WM.clap.off px away).
  function clap(w, e, v, p, gx) {
    const R = v.R, q = WM.clap, y = U.clamp(p.y, front(v) + q.band / 2, R.b - 24), g = q.gap / 2, warn = T(v, q.warn);
    if (gx === undefined) gx = p.x + w.rng.range(-q.off, q.off);
    gx = U.clamp(gx, R.l + g + 40, R.r - g - 40);
    for (const H of v.H) {
      const f = H.e, left = H.side < 0, xe = left ? gx - g - f.r * 0.6 : gx + g + f.r * 0.6;
      H.a = { k: 'clap', t: 0, y, warn, xw: left ? R.l + f.r : R.r - f.r, xe };
      if (left) line(w, f, R.l, y, 0, gx - g - R.l, q.band, warn, q.mul, { look: 'wmclap' });
      else line(w, f, gx + g, y, 0, R.r - gx - g, q.band, warn, q.mul, { look: 'wmclap' });
    }
    v.handT = Math.max(v.handT, warn + q.hold + 0.4);
  }
  const freeHand = (H) => live(H) && H.st === 'rest' && !H.a;

  // ---------- head ----------
  // Head attacks (v.head = { k, t, ... }); upd returns true when done. Their telegraphs and hazards belong to the core.
  const HEAD = {
    // Wax rain: warned drips around every living hero (the first on the hero), staggered; each leaves a slowing wax pool.
    rain: {
      start(w, e, v, a) {
        const q = WM.rain, n = q.n[v.phase - 1], Lv = w.living, R = v.R;
        a.end = 0;
        for (let i = 0; i < n; i++) {
          const p = Lv[i % Lv.length], first = i < Lv.length, d = first ? 0 : w.rng.range(30, q.spread), ang = w.rng.next() * TAU;
          const x = U.clamp(p.x + Math.cos(ang) * d, R.l + 20, R.r - 20), y = U.clamp(p.y + Math.sin(ang) * d, R.t + 40, R.b - 20), dur = T(v, q.warn) + i * q.stag;
          tele(w, e, x, y, q.r, dur, q.mul, { look: 'wmdrip', detached: true, onEnd: (ww, z) => ww.zone({ team: 1, look: 'wmwax', wid: 'wmwax', x: z.x, y: z.y, r: q.pool, dur: q.life, src: e, onTick: poolTick }) });
          a.end = Math.max(a.end, dur);
        }
      },
      upd: (w, e, v, a) => { e.st |= 1; return a.t >= a.end + 0.3; },
    },
    // Flame spiral: the crown flares (warned), then arms of flame bolts turn out of it for WM.spiral.dur s (bolts aimed above the horizon are skipped).
    spiral: {
      start(w, e, v, a) {
        const q = WM.spiral;
        a.warn = T(v, q.warn); a.next = a.warn; a.a0 = w.rng.next() * TAU; a.dir = w.rng.sign(); a.n = q.arms[v.phase - 1];
        tele(w, e, e.x, e.y - WM.core.crown, 34, a.warn, 0, { look: 'wmcrown', followSrc: false });
      },
      upd(w, e, v, a) {
        const q = WM.spiral, rate = q.rate / fast(v), end = a.warn + q.dur;
        if (a.t < a.warn) { e.st |= 1; return false; }
        e.st |= 2;
        while (a.next <= a.t && a.next < end) {
          const k = a.next - a.warn;
          for (let i = 0; i < a.n; i++) {
            const ang = a.a0 + a.dir * q.spin * k + i * TAU / a.n;
            if (Math.sin(ang) < -0.25) continue;
            const pr = B.libB.shot(w, e, ang, q.speed * fast(v), 'wmflame', q.mul, q.r, { life: 7, fly: true });
            pr.x = e.x + Math.cos(ang) * 14; pr.y = e.y - WM.core.crown + 10 + Math.sin(ang) * 10;
          }
          a.next += rate;
        }
        return a.t >= end + 0.3;
      },
    },
    // Wax tide: warned columns over the whole room except 1-2 gaps, then a wall of wax rolls down the room.
    tide: {
      start(w, e, v, a) {
        const q = WM.tide, R = v.R, ng = a.gx !== undefined ? 1 : q.gaps[v.phase - 1], g = q.gap / 2;
        a.warn = T(v, q.warn); a.go = false; a.seg = [];
        const gx = [];
        if (a.gx !== undefined) gx.push(a.gx);
        for (let k = 0; gx.length < ng && k < 20; k++) { const x = w.rng.range(R.l + g + 30, R.r - g - 30); if (gx.every((o) => Math.abs(o - x) > q.gap * 2.2)) gx.push(x); }
        gx.sort((p, r) => p - r);
        let x0 = R.l;
        for (const x of gx) { if (x - g > x0 + 4) a.seg.push(x0, x - g); x0 = x + g; }
        if (R.r > x0 + 4) a.seg.push(x0, R.r);
        for (let i = 0; i < a.seg.length; i += 2) { const s0 = a.seg[i], s1 = a.seg[i + 1]; line(w, e, (s0 + s1) / 2, R.t, Math.PI / 2, R.h, s1 - s0, a.warn, 0, { look: 'wmtidew' }); }
      },
      upd(w, e, v, a) {
        const q = WM.tide, R = v.R;
        if (a.t < a.warn) { e.st |= 1; return false; }
        e.st |= 2;
        if (!a.go) {
          a.go = true; ev(w, e, 'tide');
          const sp = q.speed * fast(v);
          for (let i = 0; i < a.seg.length; i += 2) hz(w, e, { look: 'wmtide', x: a.seg[i], y: R.t + 30, a: 0, len: a.seg[i + 1] - a.seg[i], w: q.band, dur: (R.h - 30) / sp }, { mul: q.mul, tw: a.warn, upd: tideUpd, vy: sp });
        }
        return a.t >= a.warn + 0.6;
      },
    },
  };
  function tideUpd(w, z, e, st) { z.y += st.vy * DT; }
  // Wax pool: slows heroes standing in it.
  function poolTick(w, z) { for (const p of w.living) if (U.dist2(p.x, p.y, z.x, z.y) <= (z.r + p.r) * (z.r + p.r)) L.slowHero(p, WM.rain.slow, 0.15); }

  // ---------- sconces (P2) ----------
  function sconcesUp(w, e, v) {
    const R = v.R, q = WM.sconce;
    v.sc = [];
    for (let i = 0; i < 4; i++) {
      const x = i % 2 ? R.r - q.inset : R.l + q.inset, y = i < 2 ? R.t + q.inset + 20 : R.b - q.inset;
      const z = w.zone({ team: 1, look: 'wmsconce', wid: 'wmsconce', x, y, r: q.r, w: 0, dur: 1e5, src: e, st: INERT });
      v.sc.push({ x, y, lit: false, prog: 0, z, zid: z.id });
    }
    v.snuffT = q.first;
  }
  function sconcesDown(v) { for (const sc of v.sc) if (zLive(sc.z, sc.zid)) sc.z.dead = true; v.sc.length = 0; }
  function sconceTick(w, e, v, dt) {
    const q = WM.sconce;
    let lit = 0;
    for (const sc of v.sc) {
      if (!sc.lit) {
        let on = false;
        for (const p of w.living) { const rr = q.r + p.r; if (U.dist2(p.x, p.y, sc.x, sc.y) <= rr * rr) { on = true; break; } }
        sc.prog = on ? Math.min(1, sc.prog + dt / q.light) : Math.max(0, sc.prog - dt / q.light * q.decay);
        if (sc.prog >= 1) { sc.lit = true; ev(w, e, 'lit'); }
      }
      if (sc.lit) lit++;
      const s = sc.lit ? 1 : Math.floor(sc.prog * 8) / 8;
      if (zLive(sc.z, sc.zid) && sc.z.w !== s) sc.z.w = s;
    }
    v.lit = lit;
    if (lit === 4 && v.kneelT <= 0) kneel(w, e, v);
  }

  // ---------- kneel ----------
  function kneel(w, e, v) {
    v.kneelT = WM.kneel.t; v.kneelN++;
    v.head = null; v.headT = Math.max(v.headT, 1.5);
    ev(w, e, 'kneel');
  }
  function rise(w, e, v) {
    v.kneelT = 0; v.headT = Math.max(v.headT, 1.2); v.handT = Math.max(v.handT, 1.2);
    for (const H of v.H) if (H.st === 'limp') H.t = Math.min(H.t, 1.0);
    if (v.phase === 2) { for (const sc of v.sc) { sc.lit = false; sc.prog = 0; } v.snuffT = WM.sconce.first; }
    ev(w, e, 'rise');
  }

  // ---------- phases ----------
  function nextPhase(w, e, v) {
    const ph = ++v.phase;
    e.hp = Math.max(e.hp, Math.floor(e.maxHp * WM.phases[ph - 2])); e.hpQ = Math.max(1, Math.round(255 * e.hp / e.maxHp));
    e.invulnT = 1;
    if (v.kneelT > 0) { v.kneelT = 0; for (const H of v.H) if (H.st === 'limp') H.t = Math.min(H.t, 2.0); }
    v.head = null; v.headT = 2.0; v.handT = Math.max(v.handT, 1.5);
    if (ph === 2) sconcesUp(w, e, v);
    if (ph === 3) {
      sconcesDown(v);
      v.burn0 = w.time;
      const R = v.R, q = WM.burn;
      v.melt = w.zone({ team: 1, look: 'wmmelt', wid: 'wmmelt', x: R.x, y: R.y, r: R.w / 2, w: 1000 * Math.round(R.h / 2), dur: 1e5, src: e, st: { mul: q.mul, test: meltTest, tw: q.t, k: 0 }, onTick: meltTick });
      v.meltId = v.melt.id;
    }
    w.emit({ t: 'boss', id: 'wickmother', fid: e.id, phase: ph });
  }
  // Melt band: heroes within the inset (z.w % 1000 px) of the side and bottom walls (her body holds the north wall) take WM.burn.mul x her damage every WM.burn.tick s (no i-frames). Reads only zone geometry (bots probe moved copies).
  function meltTest(w, z, p) { const m = z.w % 1000, hh = Math.floor(z.w / 1000), d = m + p.r; return m > 0 && (p.x < z.x - z.r + d || p.x > z.x + z.r - d || p.y > z.y + hh - d); }
  function meltTick(w, z) {
    const e = z.src; if (!e || e.dead || e.id !== z.srcId) { z.dead = true; return; }
    if ((z.st.k += DT) < WM.burn.tick) return;
    z.st.k -= WM.burn.tick;
    for (const p of w.living) if (meltTest(w, z, p)) L.hazard(w, p, e.dmg * WM.burn.mul, z);
  }

  // ---------- the fight clock ----------
  function brain(w, e, dt) {
    const v = e.vars; if (!v || !v.R) return;
    const R = room(w, v), c = v.core;
    c.ax = R.x; c.ay = R.t + WM.core.dy;
    e.vx = e.vy = 0;
    // phase thresholds
    if (v.phase < 3 && e.hp / e.maxHp < WM.phases[v.phase - 1]) nextPhase(w, e, v);
    const ph = v.phase, kneeling = v.kneelT > 0;
    // ward: P1-P2 outside a kneel (hits deal 1, HP held)
    const ward = ph < 3 && !kneeling;
    if (ward) { if (!v.ward) { v.ward = true; v.lock = e.hp; } else if (e.hp < v.lock) { e.hp = v.lock; e.hpQ = Math.max(1, Math.round(255 * e.hp / e.maxHp)); } }
    else v.ward = false;
    e.takeMul = ward ? 1e-9 : kneeling ? WM.kneel.mul : 1; // warded: every hit rounds up to 1 (hitFoe), HP held below
    // body: anchored, lowered while kneeling; heroes are pushed out of the body ellipse (downward)
    const ty = c.ay + (kneeling ? WM.kneel.dy : 0);
    c.x = c.ax; e.x = c.ax;
    if (e.y !== ty) e.y = e.y < ty ? Math.min(ty, e.y + WM.kneel.speed * dt) : Math.max(ty, e.y - WM.kneel.speed * dt);
    const ex = e.x, ey = e.y - WM.core.oy, rx = WM.core.rx, ry = WM.core.ry;
    for (const p of w.living) { const dx = (p.x - ex) / rx; if (Math.abs(dx) < 1) { const yb = ey + ry * Math.sqrt(1 - dx * dx); if (p.y < yb) p.y = yb; } }
    // hands: breaks, regrowth, actions, idling
    for (const H of v.H) {
      if ((H.st === 'rest' || H.st === 'grow') && !live(H)) broke(w, e, v, H);
      if (H.st === 'limp') {
        if (!kneeling && (H.t -= dt) <= 0) { if (zLive(H.z, H.zid)) H.z.dead = true; H.z = null; grow(w, e, v, H, H.x, H.y); }
        continue;
      }
      const f = H.e;
      if (H.st === 'grow') { f.st = 6; if ((H.t -= dt) <= 0) { H.st = 'rest'; f.st = 0; } continue; }
      if (H.a) {
        H.a.t += dt;
        const A = ACT[H.a.k];
        if (A.upd(w, e, v, H, dt)) { if (A.end) A.end(w, e, v, H); H.a = null; f.st = 0; }
        continue;
      }
      // idle: drift back to rest (a slow bob); slump while she kneels
      const bob = Math.sin(w.time * 1.7 + H.side) * 6;
      mvHand(v, f, restX(v, H), restY(v) + bob + (kneeling ? 40 : 0), WM.hand.spd * 0.6, dt);
      f.st = 0;
    }
    if (ph === 2) sconceTick(w, e, v, dt);
    // kneel clock
    if (v.kneelT > 0) { if ((v.kneelT -= dt) <= 0) rise(w, e, v); }
    // P3 burn-down: the wick, the melt band, the flood
    if (ph === 3) {
      const q = WM.burn, k = Math.max(0, 1 - (w.time - v.burn0) / q.t);
      v.wick = k;
      if (zLive(v.melt, v.meltId)) { const m = 1000 * Math.round(R.h / 2) + Math.round(q.melt * (1 - k) / 2) * 2; if (v.melt.w !== m) v.melt.w = m; }
      if (k <= 0 && !v.flood) {
        v.flood = 1;
        const r = Math.hypot(R.w, R.h) / 2 + 40;
        tele(w, e, R.x, R.y, r, q.flood, q.kill, { look: 'wmflood', onEnd: (ww) => hz(ww, e, { look: 'wmflood', x: R.x, y: R.y, r, dur: 1e5 }, { mul: q.kill, tw: q.flood }) });
        ev(w, e, 'flood');
      } else if (!v.wickCue && k <= 10 / q.t) { v.wickCue = 1; ev(w, e, 'wick'); }
    }
    // client state: core pose bits (head attacks add 1 cast / 2 roar this tick)
    e.st = (ward ? 4 : 0) | (kneeling ? 8 : 0) | ((ph - 1) << 4);
    if (!kneeling && !v.flood) {
      think(w, e, v, dt);
      const a = v.head;
      if (a) { a.t += dt; if (HEAD[a.k].upd(w, e, v, a)) v.head = null; }
    }
    if (zLive(v.body, v.bodyId)) { const bw = e.st + 64 * Math.round((ph === 3 ? v.wick : 1) * 100); if (v.body.w !== bw) v.body.w = bw; }
  }

  // Attack choice: hands every WM.pause.hand s (P2 snuffs first when due; a clap when both are free), the head every WM.pause.head s; P3 head attacks bring the hands along.
  function think(w, e, v, dt) {
    const ph = v.phase, Lv = w.living;
    if (!Lv.length) return;
    if (ph === 2) v.snuffT -= dt;
    if ((v.handT -= dt) <= 0) {
      const fr = v.H.filter(freeHand);
      if (fr.length) {
        v.handT = WM.pause.hand[ph - 1];
        let sc = null;
        if (ph === 2 && v.snuffT <= 0) { // the lit sconce farthest from every hero, not already targeted
          let bd = -1;
          for (const s of v.sc) {
            if (!s.lit || v.H.some((H) => H.a && H.a.sc === s)) continue;
            let dn = Infinity; for (const p of Lv) dn = Math.min(dn, U.dist2(p.x, p.y, s.x, s.y));
            if (dn > bd) { bd = dn; sc = s; }
          }
        }
        if (sc) { v.snuffT = WM.sconce.snuff[Math.min(3, w.partyN - 1)]; ACT.snuff.start(w, e, v, fr[0], sc); }
        else if (fr.length === 2 && w.rng.chance(WM.clap.p[ph - 1])) clap(w, e, v, pick(w, v));
        else {
          v.hi = (v.hi + 1) % fr.length;
          const H = fr[v.hi], k = w.rng.chance(WM.slam.w / (WM.slam.w + WM.sweep.w)) ? 'slam' : 'sweep';
          ACT[k].start(w, e, v, H, pick(w, v));
        }
      } else v.handT = 0.3;
    }
    if (v.head || (v.headT -= dt) > 0) return;
    v.headT = WM.pause.head[ph - 1];
    let k = 'rain';
    if (ph >= 2) {
      const ks = ['rain', 'spiral', 'tide'].filter((x) => x !== v.lastHead);
      k = w.rng.weighted(ks, (x) => (x === 'rain' ? WM.rainW[ph - 1] : WM[x].w));
    }
    const a = v.head = { k, t: 0 };
    v.lastHead = k;
    if (ph === 3 && k === 'tide' && v.H.every(freeHand)) { const p = pick(w, v), R = v.R; a.gx = U.clamp(p.x + w.rng.range(-WM.clap.off, WM.clap.off), R.l + WM.clap.gap / 2 + 40, R.r - WM.clap.gap / 2 - 40); clap(w, e, v, p, a.gx); }
    HEAD[k].start(w, e, v, a);
    if (ph === 3 && k === 'spiral') for (const H of v.H) if (freeHand(H)) ACT.slam.start(w, e, v, H, pick(w, v));
  }

  // Spawn hook: HP x WM.hp, the room, her anchor, both hands, the body zone.
  function spawn(w, e) {
    e.maxHp = e.hp = Math.max(1, Math.round(e.maxHp * WM.hp)); e.hpQ = 255;
    const S = w.sanctum, R = { x: S ? S.x : e.x, y: S ? S.y : e.y - WM.core.dy + 240, w: S ? S.w : 720, h: S ? S.h : 480, l: 0, r: 0, t: 0, b: 0 };
    const v = e.vars = { phase: 1, R, core: { x: 0, ax: 0, ay: 0 }, H: [], head: null, headT: 2.5, handT: 1.6, lastHead: '', hi: 0, ti: 0, ward: false, lock: 0, kneelT: 0, kneelN: 0,
      sc: [], lit: 0, snuffT: 0, burn0: 0, wick: 1, wickCue: 0, flood: 0, melt: null, meltId: 0, body: null, bodyId: 0 };
    room(w, v);
    const c = v.core; c.x = c.ax = R.x; c.ay = R.t + WM.core.dy;
    e.x = c.ax; e.y = c.ay;
    for (const side of [-1, 1]) { const H = { side, e: null, id: 0, st: 'rest', t: 0, a: null, x: 0, y: 0, z: null, zid: 0 }; v.H.push(H); grow(w, e, v, H, restX(v, H), restY(v)); }
    v.body = w.zone({ team: 1, look: 'wmbody', wid: 'wmbody', x: e.x, y: e.y, r: 210, w: 0, dur: 1e5, src: e, followSrc: true, st: INERT });
    v.bodyId = v.body.id;
  }
  // Fight over: the hands melt away (no drops); her zones vanish with her (bosses.js).
  function kill(w, e) {
    const v = e.vars; if (!v || !v.H) return true;
    for (const H of v.H) if (live(H)) { w.emit({ t: 'boom', x: Math.round(H.e.x), y: Math.round(H.e.y), r: 40, look: 'wmwax', team: 1 }); w.despawnFoe(H.e); }
    return true;
  }
  // Boss bar: rev = the kneel left (P1-P2 while kneeling), the lit share (P2), the wick (P3).
  function bar(w, e, b) {
    const v = e.vars; if (!v || !v.R) return;
    b.rev = v.kneelT > 0 ? v.kneelT / WM.kneel.t : v.phase === 2 ? v.lit / 4 : v.phase === 3 ? v.wick : -1;
  }
  brain.spawn = spawn; brain.kill = kill; brain.bar = bar;
  B.wickmother = brain;
  // Hands stand still; the core's brain moves them.
  B.wmhand = (w, e) => { e.vx = e.vy = 0; };
})(globalThis.ED || (globalThis.ED = {}));
