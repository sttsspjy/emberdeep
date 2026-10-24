// Bellwarden visuals, client only: registers ED.ClassFx hooks (contract in fx.js) plus ED.ClassFx.bell(c, p, i, t, low, view), which render.js calls for bell i of hero p in the sorted draw list (world frame).
// A bell is drawn lifted LIFT px over its ground spot (hero feet + b.ox / b.oy, set by game.js), its shadow and, at strike speed, a ring in the owner's colour on the ground; the chain (atlas fx.chain links, else 1 art px links)
// runs from the hero's hand (Actors.hand) to the bell's crown: straight while taut (hauled, in a Heave or at full length), sagging toward the ground while slack. The bell turns its crown to the hand when the chain pulls,
// and hangs mouth down when it rests. At strike speed a hauled bell leaves an arc smear about the hero (a straight streak in a Heave), skipped on Low quality; a Heavy Strike flashes the bell white.
// Events: bstrike (sparks by speed, the Heavy Strike flash, a bronze strike cue; c: the chain lashed a foe, iron sparks and a clank), peal (rings of sound, the toll), bsmash (Wrecker), bhook (Tether Hook landing), deflect (a bronze spark when a bell swatted the shot);
// zone 'bward' (Ward Bell). Cues: the chain rattles while a bell whirls (rate by speed), the Heave throws with a whoosh and reels in with a ratchet.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, F = ED.FX, A = ED.Audio, CF = ED.ClassFx, Pix = ED.Pix, Sp = ED.Sprites, C = ED.CONST;
  const K = 2, s2 = (v) => Math.round(v / K) * K;
  const BRONZE = '#e0a858', BRIGHT = '#fff0c8', DEEP = '#b0702e', PATINA = '#4fb89a', IRON_L = '#9aa6b0', IRON_D = '#5d6670', OUT = '#222222';
  const LIFT = 8, LINK = 16; // px a flying bell is drawn over its ground spot; px of one fx.chain period (8 art px)
  const low = () => !!(ED.Render && ED.Render.quality === 'low');
  const bellMin = () => C.BELL_MIN || 140, bellRef = () => C.BELL_REF || 320;

  // ---------------- per hero / bell draw state ----------------
  // HS[pid]: { t (last frame drawn), ph (Heave phase seen), hauled, rattleT, flashT (Heavy Strike), rot: [eased angle per bell] }
  const HS = new Map();
  const hsOf = (p) => { let s = HS.get(p.pid); if (!s) { s = { t: -1, ph: '', hauled: false, rattleT: 0, flashT: -9, rot: [] }; HS.set(p.pid, s); } return s; };
  const mine = (pid) => !!(ED.Render && pid === ED.Render.local);

  // Frame bookkeeping of hero p, once per frame (bell 0): the Haul's first pull, the Heave's reel, the chain rattle while a bell whirls.
  function heroCues(p, s, t) {
    const own = mine(p.pid), v = own ? 1 : 0.3, hauled = !!p.bellHauled && !p.heave, ph = p.heave ? p.heave.phase || 'fly' : '';
    if (ph === 'reel' && s.ph !== 'reel') A.play('reel', v);
    s.ph = ph;
    if (hauled && !s.hauled) A.play('rattle', 0.8 * v, 1);
    s.hauled = hauled;
    if (!hauled) return;
    let sp = 0; for (const b of p.bells) sp = Math.max(sp, Math.hypot(b.vx, b.vy));
    if (sp < bellMin() * 0.7 || t < s.rattleT) return;
    const k = Math.min(1, sp / 700);
    s.rattleT = t + 0.34 - 0.18 * k;
    A.play('rattle', (0.35 + 0.4 * k) * v, k, own ? 1 : 0);
  }

  // The chain from (x0, y0) to (x1, y1) of rest length L: straight when taut, else a quadratic sag of depth min(30, sqrt(L^2 - d^2) / 2) downward. fx.chain links every LINK px along it (1 art px links without the atlas).
  const PTS = [];
  function chain(c, x0, y0, x1, y1, L, taut, al) {
    const d = Math.hypot(x1 - x0, y1 - y0), sag = taut || d >= L ? 0 : Math.min(30, Math.sqrt(L * L - d * d) * 0.5);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag, n = Math.max(2, Math.ceil((d + sag) / 4));
    PTS.length = 0;
    let len = 0, px = x0, py = y0;
    for (let i = 0; i <= n; i++) { const u = i / n, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), e = u * u, x = a * x0 + b * mx + e * x1, y = a * y0 + b * my + e * y1; len += Math.hypot(x - px, y - py); PTS.push(x, y, len); px = x; py = y; }
    const At = ED.Atlas, ga = c.globalAlpha;
    c.globalAlpha = ga * al;
    if (At && At.ok && At.has('fx.chain')) {
      const m = Math.max(1, Math.round(len / LINK));
      let j = 0;
      for (let k = 0; k < m; k++) {
        const at = (k + 0.5) * len / m;
        while (j < PTS.length - 6 && PTS[j + 5] < at) j += 3;
        const xa = PTS[j], ya = PTS[j + 1], xb = PTS[j + 3], yb = PTS[j + 4], f = (at - PTS[j + 2]) / Math.max(0.001, PTS[j + 5] - PTS[j + 2]);
        At.draw(c, 'fx.chain', 0, s2(xa + (xb - xa) * f), s2(ya + (yb - ya) * f), { rot: Math.atan2(yb - ya, xb - xa), anchor: 'centre' });
      }
    } else {
      for (let i = 0; i < PTS.length; i += 3) { const x = s2(PTS[i]), y = s2(PTS[i + 1]); c.fillStyle = OUT; c.fillRect(x - K / 2, y - K / 2, 2 * K, 2 * K); c.fillStyle = (i / 3) & 1 ? IRON_D : IRON_L; c.fillRect(x, y, K, K); }
    }
    c.globalAlpha = ga;
  }

  // Bell i of hero p (render.js, kind 7 entries).
  CF.bell = (c, p, i, t, lo) => {
    const b = p.bells[i], st = p.stats, wp = st && st.weapon;
    if (!b || !wp || wp.kind !== 'bell') return;
    const s = hsOf(p);
    if (i === 0 && s.t !== t) { s.t = t; heroCues(p, s, t); }
    const hand = ED.Actors && ED.Actors.hand ? ED.Actors.hand(p) : null;
    const hx = p.x + (hand ? hand.hx : Math.cos(p.face || 0) * 8), hy = p.y + (hand ? hand.hy : -11);
    const gx = p.x + (b.ox || 0), gy = p.y + (b.oy || 0), bx = gx, by = gy - LIFT;
    const sp = Math.hypot(b.vx, b.vy), fast = sp >= bellMin(), vk = Math.min(1.8, sp / bellRef());
    const L = Math.max(12, p.bellL || wp.chain), dist = Math.hypot(b.ox || 0, b.oy || 0), taut = !!p.heave || !!p.bellHauled || dist >= L * 0.92;
    const br = (wp.br || 12) * (1 + 0.5 * (st.area || 0)), slot = p.slot | 0, own = mine(p.pid);
    // ground: shadow, the owner's ring at strike speed
    Pix.put(c, Pix.ell(Math.max(2, Math.round(br * 0.55)), Math.max(2, Math.round(br * 0.25)), '#000000', true), s2(gx), s2(gy), 0.3);
    if (fast) Pix.put(c, Pix.ell(Math.max(3, Math.round(br * 0.7)), Math.max(2, Math.round(br * 0.32)), ED.PLAYER_COLORS[slot] || '#ffffff'), s2(gx), s2(gy), own ? 0.75 : 0.5);
    // smear behind a fast bell: an arc about the hero while it orbits, a streak in a straight flight
    if (fast && !lo) smear(c, p, b, bx, by, sp, vk);
    chain(c, hx, hy, bx, by, L, taut, 1);
    // the bell: crown to the hand while the chain pulls, mouth down at rest; eased so it never snaps
    const want = taut || fast ? Math.atan2(by - hy, bx - hx) - Math.PI / 2 : 0, cur = s.rot[i] === undefined ? want : s.rot[i];
    const r = s.rot[i] = cur + U.angDiff(cur, want) * 0.35;
    const wd = Sp.weaponArt(p), ec = st.evo && ED.PATHS[st.evo] ? ED.PATHS[st.evo].color : null, flash = F.time - s.flashT < 0.09;
    if (!drawLook(c, p, wd, ec, flash, bx, by, r)) procBell(c, bx, by, br, r, flash);
    if (!lo && ED.Render) {
      if (fast) ED.Render.emit(bx, by + br * 0.6, 8 + br * 0.4, BRONZE, 0.1 * vk);
      if (ec) ED.Render.emit(bx, by + br * 0.6, br * 1.2, ec, 0.18);
    }
  };
  // Bell art of weapon look wd at (x, y), turned by r about its grip: white during a Heavy Strike flash, else the worn sheen (ED.Cos.tintOf) over the evolution outline (path colour ec). False without the atlas.
  const PRE = new Set();
  function drawLook(c, p, wd, ec, flash, x, y, r) {
    const At = ED.Atlas; if (!(At && At.ok && At.has(wd.anim))) return false;
    const tc = !flash && ED.Cos ? ED.Cos.tintOf(p, wd.id) : '', tv = tc ? Pix.variant(wd.anim, tc) : '';
    const ok = (k) => (k && At.variant(wd.anim, k) ? k : ''), ov = ok(flash ? 'white' : ec ? 'outline:' + ec : ''), variant = tv || ov, under = tv && ov ? ov : '';
    const pk = wd.anim + '|' + variant + '|' + under;
    if (!PRE.has(pk)) { PRE.add(pk); At.prebake(wd.anim, 0, false, 'grip', variant); if (under) At.prebake(wd.anim, 0, false, 'grip', under); } // a turning bell bakes all 32 angles in the background (Atlas.tick)
    if (under) At.draw(c, wd.anim, 0, s2(x), s2(y), { rot: r, anchor: 'grip', variant: under });
    return !!At.draw(c, wd.anim, 0, s2(x), s2(y), { rot: r, anchor: 'grip', variant });
  }
  // A standing hero outside a run (camp, Wardrobe preview, lobby: no p.bells), called by actors.js with the hand at (x, y) in the hero's frame (feet at 0, 0) and its facing (flip: left):
  // one bell rests mouth down on the ground beside the hero on the facing side, its chain sagging from the hand and swaying slowly; small bells (2 or more) hang two from the fist.
  CF.bellIdle = (c, p, wd, x, y, t, flip) => {
    const At = ED.Atlas, r = At && At.ok && At.has(wd.anim) ? At.anim(wd.anim) : null, br = (wd.w && wd.w.br) || 12, H = r ? (r.f[0].oy + r.f[0].h - r.ay) * K - K : br * 1.6;
    const n = (wd.w && wd.w.n) || 1, dir = flip ? -1 : 1, gy = 2 - H, sw = Math.sin(t * 1.3 + (p.slot | 0)) * 2;
    if (n > 1) { // small bells hang from the fist on two links each, one to each side, swaying
      for (let i = 0; i < 2; i++) {
        const bx = x + (i ? 3 : -3) * K + sw * 0.5, by = y + 2 * K;
        for (let k = 0; k < 2; k++) { const px = s2(x + (bx - x) * (k + 1) / 3), py = s2(y + (by - y) * (k + 1) / 3); c.fillStyle = OUT; c.fillRect(px - K / 2, py - K / 2, 2 * K, 2 * K); c.fillStyle = k ? IRON_D : IRON_L; c.fillRect(px, py, K, K); }
        if (!drawLook(c, p, wd, null, false, bx, by, 0)) procBell(c, bx, by, br, 0, false);
      }
      return;
    }
    const bx = x + dir * (4 * K + br * 0.4), d = Math.hypot(bx - x, gy - y);
    chain(c, x, y, bx + sw * 0.3, gy, d * 1.25 + Math.abs(sw), false, 1);
    if (!drawLook(c, p, wd, null, false, bx, gy, 0)) procBell(c, bx, gy, br, 0, false);
  };
  // Without the atlas: a bronze bell of radius br hanging from (x, y), turned by r.
  function procBell(c, x, y, br, r, flash) {
    c.save(); c.translate(s2(x), s2(y)); c.rotate(r);
    c.fillStyle = OUT; c.beginPath(); c.moveTo(-br * 0.45, 0); c.lineTo(br * 0.45, 0); c.lineTo(br, br * 1.6); c.lineTo(-br, br * 1.6); c.closePath(); c.fill();
    c.fillStyle = flash ? '#ffffff' : DEEP; c.beginPath(); c.moveTo(-br * 0.35, 1.5); c.lineTo(br * 0.35, 1.5); c.lineTo(br * 0.85, br * 1.45); c.lineTo(-br * 0.85, br * 1.45); c.closePath(); c.fill();
    c.fillStyle = flash ? '#ffffff' : BRONZE; c.fillRect(-br * 0.5, br * 0.3, br * 0.3, br);
    c.restore();
  }
  // Smear of bell b: 2 px squares in additive bronze fading back along its path for about 70 ms of flight (an arc about the hero when it orbits, else a line).
  function smear(c, p, b, bx, by, sp, vk) {
    const ox = b.ox || 0, oy = b.oy || 0, rr = Math.hypot(ox, oy), w = rr > 6 ? (ox * b.vy - oy * b.vx) / (rr * rr) : 0, orbit = Math.abs(w) * rr > sp * 0.7;
    const len = Math.min(rr > 6 && orbit ? rr * 2.2 : 90, sp * 0.07), n = Math.max(3, Math.min(18, Math.round(len / 4)));
    const ga = c.globalAlpha, op = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter';
    for (let k = 1; k <= n; k++) {
      const u = k / n, a = (1 - u) * (0.32 + 0.18 * Math.min(1, vk));
      let x, y;
      if (orbit) { const th = Math.atan2(oy, ox) - Math.sign(w) * u * len / rr; x = p.x + Math.cos(th) * rr; y = p.y - LIFT + Math.sin(th) * rr; }
      else { x = bx - b.vx / sp * u * len; y = by - b.vy / sp * u * len; }
      c.globalAlpha = ga * a; c.fillStyle = u < 0.3 ? BRIGHT : BRONZE; c.fillRect(s2(x) - 2, s2(y) + 2, 4, 4);
    }
    c.globalAlpha = ga; c.globalCompositeOperation = op;
  }

  // ---------------- events ----------------
  // A strike: sparks along the swing that grow with speed, a bronze ring; a Heavy Strike adds a white flash, streaks, the bell's white frame and (own) a hit-stop and a shake.
  CF.on('bstrike', (ev, ctx, local) => {
    const own = ev.pid === local, vk = Math.min(1.8, (ev.v || 0) / bellRef()), y = ev.y - LIFT, lo = low();
    if (ev.c) { // the hauled chain lashed a foe closer in: iron sparks on the foe, a chain clank
      F.burst(ev.x, ev.y - 10, lo ? 2 : 4, { kind: 'spark', color: IRON_L, sp: 120 + 40 * vk, life: 0.18, size: 1.4, drag: 5 });
      A.play('bstrike', own ? 0.8 : 0.3, { v: ev.v || 0, c: true }, own ? 1 : 0);
      return;
    }
    F.burst(ev.x, y, lo ? 3 : 4 + Math.round(vk * 3), { kind: 'spark', color: BRIGHT, sp: 110 + 70 * vk, life: 0.2, size: 1.6, drag: 5 });
    F.pop(ev.x, y, 8 + 6 * vk, BRONZE, 0.12);
    if (ev.h) {
      hsOf({ pid: ev.pid }).flashT = F.time;
      F.pop(ev.x, y, 24, '#ffffff', 0.16, true);
      F.ring(ev.x, ev.y, 28, BRIGHT, 0.28, 3);
      if (!lo) { F.burst(ev.x, y, 8, { kind: 'streak', color: '#ffffff', sp: 260, life: 0.22, size: 1.8 }); F.sheet('fx.hit.spark', ev.x, y, { ramp: 'gold', add: true, speed: 1.3 }); }
      if (own) { F.hitStop(0.05); F.addShake(2.5); F.punch(0.3, 0); }
    }
    A.play('bstrike', own ? 1 : 0.35, { v: ev.v || 0, h: !!ev.h }, own ? 1 : 0);
  });
  // A Peal: rings of sound from the bell (the Reverberation echo smaller and fainter), a flash, dust; the toll.
  CF.on('peal', (ev, ctx, local) => {
    const own = ev.pid === local, e = !!ev.e, r = ev.r || 110, m = e ? 0.6 : 1, lo = low();
    F.ring(ev.x, ev.y, r, BRIGHT, 0.5 * m + 0.1, e ? 3 : 5, false, 10);
    F.ring(ev.x, ev.y, r * 0.66, PATINA, 0.42 * m, e ? 2 : 3, false, 6);
    if (!lo) F.ring(ev.x, ev.y, r * 0.36, BRONZE, 0.3, 2, false, 4);
    F.pop(ev.x, ev.y - LIFT, 30 * m, BRIGHT, 0.22, true);
    if (!e && !lo) { F.dust(ev.x, ev.y, 'dust', 4); F.burst(ev.x, ev.y - LIFT, 10, { kind: 'streak', color: BRIGHT, sp: r * 3, spread: 3.2, life: 0.25, size: 1.6 }); }
    if (own) { F.addShake(e ? 1.5 : 4); F.punch(e ? 0.2 : 0.6, e ? 0 : 0.3); } else F.addShake(e ? 0.5 : 1.5);
    A.play('peal', (own ? 1 : 0.45) * m, { v: ev.v || 0, e }, own ? 2 : 1);
  });
  // Wrecker: the bell smashes down at the end of its flight.
  CF.on('bsmash', (ev, ctx, local) => {
    const own = ev.pid === local, r = ev.r || 60;
    F.ring(ev.x, ev.y, r, BRONZE, 0.4, 4); F.ring(ev.x, ev.y, r * 0.6, BRIGHT, 0.25, 2);
    F.dust(ev.x, ev.y, 'dust', low() ? 2 : 5);
    if (!low()) F.burst(ev.x, ev.y - 4, 10, { kind: 'shard', color: '#9a8a6a', sp: r * 2, life: 0.5, size: 2.6, vz: 90, z: 2 });
    F.sheet('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'dust' });
    F.addShake(own ? 4 : 1.5); if (own) F.punch(0.4, 0.2);
    A.play('bsmash', own ? 1 : 0.4);
  });
  // Tether Hook: the hooked foes land at the hero.
  CF.on('bhook', (ev, ctx, local) => {
    F.burst(ev.x, ev.y - 10, 6, { kind: 'spark', color: IRON_L, sp: 140, life: 0.22, size: 1.5, drag: 5 });
    F.ring(ev.x, ev.y, 34, IRON_L, 0.3, 2);
    A.play('clang', ev.pid === local ? 0.7 : 0.3, { n: Math.min(6, ev.n || 1) });
  });
  // A shot swatted by a flying bell (or a Peal's Warding Toll): a bronze spark joins the generic white burst.
  CF.on('deflect', (ev, ctx) => {
    for (const p of ctx.players()) {
      if (!p.bells || !p.bells.length) continue;
      for (const b of p.bells) if (Math.abs(p.x + (b.ox || 0) - ev.x) < 40 && Math.abs(p.y + (b.oy || 0) - ev.y) < 40) { F.burst(ev.x, ev.y, 4, { kind: 'spark', color: BRONZE, sp: 160, life: 0.2, size: 1.5, drag: 5 }); return; }
    }
  });
  // The casts: a Heave throws with a whoosh and a puff of dust at the feet; a Peal sounds with its own event. Both replace the generic skill cue.
  CF.on('skill', (ev, ctx, local) => {
    if (ev.k === 'heave') { F.dust(ev.x, ev.y + 2, 'dust', 1); A.play('heave', ev.pid === local ? 1 : 0.4); return true; }
    if (ev.k === 'peal') return true;
  });

  // ---------------- Ward Bell zone ----------------
  // A ward ring of patina bronze around the Peal's spot (dashed, turning), a fainter inner ring, six notches that sweep the rim; it fades over its last half second.
  CF.zone.bward = (c, z, pass, t) => {
    const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 6), x = s2(z.x), y = s2(z.y), R = ED.Render, rA = Math.max(3, Math.round(z.r / 2));
    if (pass === 0) {
      Pix.put(c, Pix.disc(rA, '#2b5f52'), x, y, 0.1 * fade);
      Pix.put(c, Pix.ring(rA, 2, '#2b5f52', PATINA, '#7fc9a8', 5, (t * 4) & 7), x, y, 0.8 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(rA * 0.6)), 1, BRONZE, BRONZE, BRONZE, 3, (-t * 3) & 7), x, y, 0.35 * fade);
      if (R) R.light(z.x, z.y, z.r * 1.4, '#9fe8d0', 0.4 * fade);
    } else if (pass === 1) {
      if (R) R.glow(c, z.x, z.y, z.r * 0.5, PATINA, 0.18 * fade);
      c.fillStyle = BRIGHT;
      for (let i = 0; i < 6; i++) { const a = t * 1.4 + i * TAU / 6; c.globalAlpha = 0.6 * fade; c.fillRect(s2(z.x + Math.cos(a) * z.r * 0.96) - 1, s2(z.y + Math.sin(a) * z.r * 0.96) - 1, 2, 2); }
      c.globalAlpha = 1;
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
