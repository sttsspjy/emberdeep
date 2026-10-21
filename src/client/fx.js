// Visual and audio feedback: particles, slashes, damage numbers, impact pops, ghosts, banners, shake, hit-stop.
// World events (from the local sim or the host's snapshots) are translated into effects here. Drawing is split in two:
// drawWorld (lit with the scene, also registers lights) and drawGlow (emissive, additive, after lighting so bloom catches it).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  let hsUntil = 0; // wall-clock end of the current hit-stop
  const F = ED.FX = {
    parts: [], texts: [], slashes: [], rings: [], bolts: [], pops: [], ghosts: [], stains: [], msgs: [], hurtAt: {}, banner: null, shake: 0, flash: null, fade: 0, anim: {}, hitstop: 0, time: 0, aberr: 0, kick: 0, dread: 0, crowd: 1, // crowd: burst-count factor, set by the renderer (below 1 with many live foes)
    // 1 normally, ~0.06 during a hit-stop; consumers (game loop) multiply their dt by it. Wall-clock based, so it is safe however dt is scaled.
    get timeScale() { return performance.now() / 1000 < hsUntil ? 0.06 : 1; },
    set timeScale(v) { /* derived value; assignments are ignored */ },
  };
  let MAXP = 500, lastHs = 0, pickT = 0;
  const calm = () => !!(ED.App && ED.App.settings && !ED.App.settings.shake); // "screen shake off" also mutes flashes and hit-stop

  F.reset = () => { F.parts.length = 0; F.texts.length = 0; for (const s of F.slashes) if (s.sm) smearPool.push(s.sm); F.slashes.length = 0; hitSp.length = 0; F.rings.length = 0; F.bolts.length = 0; F.pops.length = 0; releaseGhosts(); F.stains.length = 0; F.msgs.length = 0; F.hurtAt = {}; F.banner = null; F.shake = 0; F.flash = null; F.anim = {}; F.aberr = 0; F.kick = 0; F.dread = 0; hsUntil = 0; ent.clear(); hitN = 0; };
  F.setQuality = (q) => { MAXP = q === 'low' ? 180 : 500; };
  const lowFx = () => MAXP < 300;
  const cnt = (n) => Math.ceil(n * (MAXP < 300 ? 0.5 : 1) * F.crowd);

  // opts: a (angle), spread (random +- around a), sp, life, size, color, kind (dot|shard|smoke|streak|ember|drop|ash|spark), add, lt (light colour), ltr (light radius)
  // spOv/lifeOv replace o.sp/o.life (burst jitter). Dead particles are recycled through ppool; when full, a rotating slot is overwritten.
  const ppool = []; let evict = 0;
  F.part = (x, y, o, spOv, lifeOv) => {
    const ps = F.parts; let p;
    if (ps.length >= MAXP) { evict = (evict + 1) % ps.length; p = ps[evict]; }
    else { p = ppool.pop() || { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, size: 0, color: '', kind: '', grav: 0, drag: 0, add: false, z: 0, vz: 0, rot: 0, lt: null, ltr: 0, land: false }; ps.push(p); }
    const a = o.a !== undefined ? o.a + (o.spread ? (Math.random() - 0.5) * o.spread : 0) : Math.random() * TAU;
    const sp = spOv !== undefined ? spOv : o.sp !== undefined ? o.sp : 40 + Math.random() * 80;
    const life = lifeOv !== undefined ? lifeOv : (o.life || 0.5), kind = o.kind || 'dot';
    p.x = x; p.y = y; p.vx = Math.cos(a) * sp + (o.vx || 0); p.vy = Math.sin(a) * sp + (o.vy || 0);
    p.life = life; p.max = life; p.size = o.size || 2; p.color = o.color || '#fff'; p.kind = kind; p.grav = o.grav || 0; p.drag = o.drag !== undefined ? o.drag : 3;
    p.add = o.add !== undefined ? o.add : (kind === 'streak' || kind === 'ember' || kind === 'spark');
    p.z = o.z || 0; p.vz = o.vz || 0; p.land = false; p.rot = Math.random() * 6; p.lt = o.lt || null; p.ltr = o.ltr || 28;
  };
  F.burst = (x, y, n, o) => { const k = cnt(n), sp = o.sp || 90, life = o.life || 0.5; for (let i = 0; i < k; i++) F.part(x, y, o, sp * (0.4 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6)); };
  const NO_OPTS = {};
  F.text = (x, y, s, color, size, opts) => {
    if (F.texts.length > 80) F.texts.shift();
    // numbers born in the same spot stack upward instead of overprinting
    let yy = y; for (const t of F.texts) if (t.max - t.life < 0.3 && Math.abs(t.x - x) < 24 && Math.abs(t.y - yy) < 9) yy = t.y - 9;
    const o = opts || NO_OPTS; // opts: crit, pop, life, max, vy, ol (rim colour)
    F.texts.push({ x: x + (Math.random() - 0.5) * 10, y: yy, s: String(s), color, size: size || 10, life: o.life ?? 0.9, max: o.max ?? 0.9, vy: o.vy ?? -42, crit: !!o.crit, pop: !!o.pop, ol: o.ol || null });
  };
  F.ring = (x, y, r, color, life, width) => F.rings.push({ x, y, r, color, life: life || 0.4, max: life || 0.4, w: width || 3 });
  // Smear arc. A hero weapon swing (no life given) takes its sweep side and timing from the attack animation that was just started.
  F.slash = (x, y, a, r, arc, color, life) => {
    const an = life === undefined ? F.lastAnim : null, L = life || 0.28;
    if (an && an.col) color = an.col; // a hero swing wears the colour of the hero's path (steel without one)
    if (F.slashes.length < 24) F.slashes.push({ x, y, a, r, arc, color, hot: U.mix(color, '#ffffff', 0.6), life: L, max: L, side: an ? an.side : (F.slashes.length & 1 ? 1 : -1), t0: an ? an.t0 : 0.02, t1: an ? an.t1 : 0.1, sm: null, hr: -1 });
  };
  // Bright impact flash that also lights the scene. star: flare lines (crits).
  F.pop = (x, y, r, color, life, star) => { if (F.pops.length < 40) F.pops.push({ x, y, r, color, life: life || 0.16, max: life || 0.16, star: !!star }); };
  F.addShake = (v) => { if (ED.App && !ED.App.settings.shake) return; F.shake = Math.min(12, F.shake + v); };
  // Chromatic-aberration / white-flash punch for the post pass (0..~2 / 0..1.2).
  F.punch = (aberr, kick) => { if (calm()) return; F.aberr = Math.max(F.aberr, aberr || 0); F.kick = Math.max(F.kick, kick || 0); };
  // Brief time dip; read FX.timeScale. At most one every 0.22 s so rapid hits never stall the game.
  F.hitStop = (sec) => { const now = performance.now() / 1000; if (calm() || now - lastHs < 0.22) return; lastHs = now; hsUntil = now + Math.min(0.3, sec); };
  // A repeat of the newest message refreshes it with a count ('text ×3') instead of stacking.
  F.msg = (text, color) => {
    const last = F.msgs[F.msgs.length - 1];
    if (last && last.base === text) { last.n++; last.text = text + ' ×' + last.n; last.t = 4; return; }
    F.msgs.push({ text, base: text, n: 1, color: color || '#f0e5d3', t: 4 }); if (F.msgs.length > 5) F.msgs.shift();
  };
  F.showBanner = (title, sub, style, dur) => { F.banner = { title, sub: sub || '', style: style || 'small', t: 0, dur: dur || 2.6 }; };

  // Ages every entry by dt and drops the expired ones in place (order and array identity kept, nothing allocated).
  const tick = (a, dt) => { let n = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; o.life -= dt; if (o.life > 0) a[n++] = o; } a.length = n; };

  F.update = (dt) => {
    F.time += dt; snapBudget = 4;
    F.shake = Math.max(0, F.shake - dt * (10 + F.shake * 3));
    F.aberr = Math.max(0, F.aberr - dt * 2.4);
    F.kick = Math.max(0, F.kick - dt * 3.6);
    if (F.flash) { F.flash.t -= dt; if (F.flash.t <= 0) F.flash = null; }
    const ps = F.parts; let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { if (ppool.length < 600) ppool.push(p); continue; }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d; p.vy += p.grav * dt;
      if (p.kind === 'ember') { p.vx += Math.sin(F.time * 9 + p.rot * 3) * 70 * dt; p.vy -= 34 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vz || p.z) {
        p.vz -= 300 * dt; p.z += p.vz * dt;
        if (p.z < 0) {
          const drop = p.kind === 'drop'; p.z = 0; p.vz *= drop ? -0.06 : -0.35; p.vx *= drop ? 0.15 : 0.6; p.vy *= drop ? 0.15 : 0.6;
          if (drop && p.life > 0.45) p.life = 0.45;
          if (p.vz < 14) { p.vz = 0; p.land = true; }
        } else p.rot += dt * 6;
      } else if (!p.land) p.rot += dt * 6;
      ps[n++] = p;
    }
    ps.length = n;
    const ts = F.texts; n = 0;
    for (let i = 0; i < ts.length; i++) { const t = ts[i]; t.life -= dt; if (t.life <= 0) continue; t.y += t.vy * dt; t.vy *= Math.max(0, 1 - 2.5 * dt); ts[n++] = t; }
    ts.length = n;
    tickSlashes(dt); tick(F.rings, dt); tick(F.bolts, dt); tick(F.pops, dt); tick(F.stains, dt); tickHits(dt);
    const gs = F.ghosts; n = 0;
    for (let i = 0; i < gs.length; i++) { const g = gs[i]; g.life -= dt; if (g.life > 0) gs[n++] = g; else if (g.sn) g.sn.busy = false; }
    gs.length = n;
    if ((entSweep += dt) > 1) { entSweep = 0; for (const [id, s] of ent) if (F.time - s.ht > 1 && F.time - s.seen > 2) ent.delete(id); }
    const ms = F.msgs; n = 0;
    for (let i = 0; i < ms.length; i++) { const m = ms[i]; m.t -= dt; if (m.t > 0) ms[n++] = m; }
    ms.length = n;
    if (F.banner) { F.banner.t += dt; if (F.banner.t > F.banner.dur) F.banner = null; }
    for (const k in F.anim) F.anim[k].atkT += dt;
    if (F.fade > 0) F.fade = Math.max(0, F.fade - dt * 2.2);
  };

  // Starts a hero's attack animation (weapon sweep timing from Sprites.atkTimes); ranged weapons also get a muzzle flash.
  F.playerAttackAnim = (pid, a) => {
    const an = F.anim[pid] || (F.anim[pid] = { atkT: 9, side: 1, t0: 0.05, t1: 0.12, D: 0.3 });
    if (an.atkT < 0.03) return; // swing + atk events of one attack arrive together
    const s = ED.Game && ED.Game.s, p = s && s.view.players.get(pid), w = p && ED.WEAPONS[p.weapon];
    an.atkT = 0; an.side = -an.side; an.a = a; F.lastAnim = an;
    const mp = p && p.boons ? ED.mainPath(p.boons) : null; an.col = mp && mp !== 'general' && PATH_COL[mp] ? PATH_COL[mp] : '#9fb0c0'; // smear outer band: the hero's path colour, steel without one
    if (w) {
      const tm = ED.Sprites.atkTimes(w); an.t0 = tm[0]; an.t1 = tm[1]; an.D = tm[2];
      if (w.kind !== 'melee') {
        const col = F.projColor(w.proj), x = p.x + Math.cos(a) * 20, y = p.y - 11 + Math.sin(a) * 20;
        F.pop(x, y, 9, col, 0.09); if (!lowFx()) F.burst(x, y, 3, { kind: 'spark', color: col, a, spread: 0.7, sp: 170, life: 0.14, size: 1.3, drag: 5 });
      }
    }
  };

  // ---------- per-foe animation state, keyed by sim id: hit reaction and wind-up progress. F.xform is applied by the caller around Sprites.enemy. ----------
  const ent = new Map(); let entSweep = 0, hitN = 0;
  const WIND = { windup: 1, aim: 1, cast: 1 }, STRIKE = { lunge: 1, charge: 1, dive: 1, leap: 1, bash: 1 };
  const entOf = (id) => { let s = ent.get(id); if (!s) { s = { ht: -9, ax: 1, ay: 0, m: 0, crit: 0, wk: '', ws: 0, wd: 0.5, wp: 0, seen: 0 }; ent.set(id, s); } return s; };
  const hitMem = [{}, {}, {}, {}, {}, {}, {}, {}]; // last hits (position, direction, weight, element): a death replays the killing blow's direction
  // Hit events carry the foe's top point, not its id: the nearest live foe within 30 px is the target.
  function foeAt(x, y) {
    const s = ED.Game && ED.Game.s; if (!s) return null;
    const es = s.view.enemies; let best = null, bd = 900;
    for (let i = 0; i < es.length; i++) { const e = es[i], dx = e.x - x, dy = e.y - e.r - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function hitReact(e, ax, ay, w, crit) {
    const s = entOf(e.id); s.ht = F.time; s.ax = ax; s.ay = ay; s.crit = crit ? 1 : 0;
    s.m = w * (e.boss ? 0.12 : e.elite ? 0.55 : 1);
  }
  // Last hit reaction of foe `id` ({ ht: time, ax, ay: direction, m: weight, crit }) or null.
  F.hitState = (id) => ent.get(id) || null;

  // ---------- pixel smear of weapon swings ----------
  // The crescent of a swing rasterised on the art grid (1 art px = 2 world px) into a pooled canvas: a white core, a warm mid band and the path-colour outer band sweep with the weapon through the strike, then fade in three alpha steps (1, .7, .35).
  const SM = 150, smearPool = [], colMemo = {};
  function smearGet() {
    let s = smearPool.pop();
    if (!s) { const cv = document.createElement('canvas'); cv.width = cv.height = SM; const g = cv.getContext('2d'), img = g.createImageData(SM, SM); s = { cv, g, img, u32: new Uint32Array(img.data.buffer) }; }
    return s;
  }
  const packRGBA = (hex) => colMemo[hex] || (colMemo[hex] = ((255 << 24) | (U.hexToRgb(hex)[2] << 16) | (U.hexToRgb(hex)[1] << 8) | U.hexToRgb(hex)[0]) >>> 0);
  function tickSlashes(dt) {
    const a = F.slashes; let n = 0;
    for (let i = 0; i < a.length; i++) { const o = a[i]; o.life -= dt; if (o.life > 0) a[n++] = o; else if (o.sm) { smearPool.push(o.sm); o.sm = null; } }
    a.length = n;
  }
  // Rasterises slash sl with its head at fraction head (0..1) of the sweep into its canvas; origin = the slash centre on the even world grid. Thrusts (arc < 1.2) are a tapering line, other arcs a crescent of growing thickness.
  function smearRaster(s, sl, head) {
    const K2 = 2, half = Math.min(SM >> 1, Math.ceil(sl.r / K2) + 4), W = half * 2, u = s.u32;
    u.fill(0);
    const ox = Math.round(sl.x / K2) * K2, oy = Math.round(sl.y / K2) * K2, ex = ox - sl.x, ey = oy - sl.y;
    sl.ox = ox; sl.oy = oy; sl.half = half;
    const ca = Math.cos(sl.a), sa = Math.sin(sl.a), arc = Math.min(TAU, sl.arc), sd = sl.side;
    const cO = packRGBA(sl.color), cM = packRGBA(U.mix(sl.color, '#ffe6b0', 0.6)), cC = 0xffffffff;
    if (arc < 1.2) {
      const R2 = sl.r * 0.95, s0 = sl.r * 0.2, hd = s0 + (R2 - s0) * head;
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const dx = (i + 0.5 - half) * K2 + ex, dy = (j + 0.5 - half) * K2 + ey, ax = dx * ca + dy * sa;
        if (ax < s0 || ax > hd) continue;
        const pp = -dx * sa + dy * ca, f = (ax - s0) / Math.max(1, hd - s0);
        if (Math.abs(pp) > 0.7 + 2.4 * f) continue;
        u[j * SM + i] = f > 0.72 ? cC : f > 0.38 ? cM : cO;
      }
    } else {
      const Ro = sl.r * 0.94, base = sl.a - sd * arc / 2, Tm = U.clamp(sl.r * 0.4, 8, 24), tail = Math.min(arc, 1.9), hdA = head * arc, inner = (Ro - Tm) * (Ro - Tm), outer = Ro * Ro;
      const T0 = tail, T1 = tail * 0.5, T2 = tail * 0.2;
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const dx = (i + 0.5 - half) * K2 + ex, dy = (j + 0.5 - half) * K2 + ey, r2 = dx * dx + dy * dy;
        if (r2 > outer || r2 < inner) continue;
        let q = (sd * (Math.atan2(dy, dx) - base)) % TAU; if (q < 0) q += TAU;
        if (q > arc || q > hdA) continue;
        const d = hdA - q, r = Math.sqrt(r2);
        let col = 0;
        if (d <= T2 && r >= Ro - Tm * 0.4 * Math.pow(1 - d / T2, 0.75)) col = cC;
        else if (d <= T1 && r >= Ro - Tm * 0.7 * Math.pow(1 - d / T1, 0.75)) col = cM;
        else if (d <= T0 && r >= Ro - Tm * Math.pow(1 - d / T0, 0.75)) col = cO;
        if (col) u[j * SM + i] = col;
      }
    }
    s.g.putImageData(s.img, 0, 0, 0, 0, W, W);
  }
  function drawSmears(c) {
    const comp = c.globalCompositeOperation; c.globalCompositeOperation = 'source-over'; c.imageSmoothingEnabled = false;
    for (const sl of F.slashes) {
      const age = sl.max - sl.life;
      if (age < sl.t0) continue;
      const h = U.easeOut(U.clamp((age - sl.t0) / (sl.t1 - sl.t0), 0, 1));
      if (h <= 0) continue;
      if (!sl.sm) sl.sm = smearGet();
      if (sl.hr !== h) { smearRaster(sl.sm, sl, h); sl.hr = h; }
      const f0 = age <= sl.t1 ? 0 : (age - sl.t1) / Math.max(0.01, sl.max - sl.t1);
      c.globalAlpha = f0 < 0.34 ? 1 : f0 < 0.67 ? 0.7 : 0.35;
      const W = sl.half * 2;
      c.drawImage(sl.sm.cv, 0, 0, W, W, sl.ox - sl.half * 2, sl.oy - sl.half * 2, W * 2, W * 2);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = comp; c.imageSmoothingEnabled = true;
  }

  // ---------- one-shot atlas sprites at world points (hit contacts, death puffs, dash dust) ----------
  const hitSp = [], hitO = { flip: false, variant: '', alpha: 1, rot: 0, anchor: '' };
  // o: { rot (radians, drawn clockwise about the sprite centre), flip, a (alpha), variant, add }.
  F.atlasFx = (id, x, y, o) => {
    const A = ED.Atlas; if (!A.ok || hitSp.length >= 36) return;
    const r = A.anim(id); if (!r) return;
    hitSp.push({ id, x: Math.round(x), y: Math.round(y), t: 0, dur: r.n / r.fps, rot: (o && o.rot) || 0, flip: !!(o && o.flip), a: o && o.a !== undefined ? o.a : 1, v: (o && o.variant) || '', add: !!(o && o.add) });
  };
  function tickHits(dt) { let n = 0; for (let i = 0; i < hitSp.length; i++) { const s = hitSp[i]; s.t += dt; if (s.t < s.dur) hitSp[n++] = s; } hitSp.length = n; }
  function drawHitSprites(c) {
    if (!hitSp.length) return;
    const A = ED.Atlas, comp = c.globalCompositeOperation;
    for (const s of hitSp) {
      const r = A.anim(s.id); if (!r) continue;
      c.globalCompositeOperation = s.add ? 'lighter' : 'source-over';
      hitO.flip = s.flip; hitO.variant = s.v; hitO.alpha = s.a; hitO.rot = s.rot;
      A.draw(c, s.id, Math.min(r.n - 1, Math.floor(s.t * r.fps)), s.x, s.y, hitO);
    }
    c.globalCompositeOperation = comp;
  }
  // Contact flash of a hero's direct hit: the Cut slash across the blow (CutX on a crit), a red Blast under heavy weapons. The local hero's hits always show (one per 50 ms); allies' only crits and heavy blows.
  const HEAVY = { warhammer: 1, dawnhammer: 1 };
  let contactT = -9;
  function contactFx(ev, a, mine, p) {
    if (!ED.Actors || !ED.Actors.on()) return;
    const heavy = p ? !!HEAVY[ED.Sprites.weaponArt(p).id] : false, crit = !!ev.c;
    if (!mine && !crit && !heavy) return;
    if (F.time - contactT < 0.05) return;
    contactT = F.time;
    const x = ev.x, y = ev.y + 3;
    if (crit) F.atlasFx('fx.cutx', x, y);
    else F.atlasFx('fx.cut', x, y, { rot: Math.round((a + 3 * Math.PI / 4) / (Math.PI / 4)) * Math.PI / 4 });
    if (heavy && mine) F.atlasFx('fx.blast.red', x, y, { a: 0.9 });
  }
  const X = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
  // Pose of a foe this frame (offset, lean, squash about its feet): wind-up crouch, strike stretch, hit recoil. null = untouched.
  F.xform = (e) => {
    let s = ent.get(e.id), any = false;
    const sg = e.face < 0 ? -1 : 1;
    X.dx = 0; X.dy = 0; X.rot = 0; X.sx = 1; X.sy = 1;
    if (!e.boss && WIND[e.st]) {
      if (!s) s = entOf(e.id);
      if (s.wk !== e.st) { s.wk = e.st; s.ws = F.time; s.wd = e.t > 0.08 ? e.t : 0.5; }
      const p = U.clamp((F.time - s.ws) / s.wd, 0, 1), q = p * p * (3 - 2 * p);
      s.wp = p; X.sy = 1 - 0.15 * q; X.sx = 1 + 0.09 * q; X.rot = -sg * 0.17 * q; X.dx = -sg * 2.6 * q;
      if (p > 0.6) { const th = Math.sin(F.time * 55) * 0.035 * (p - 0.6) / 0.4; X.sx += th; X.sy -= th; }
      any = true;
    } else {
      if (s && s.wk) { s.wk = ''; s.wp = 0; }
      if (!e.boss && STRIKE[e.st]) { X.sx = 1.13; X.sy = 0.92; X.rot = sg * 0.13; any = true; }
    }
    if (s) {
      s.seen = F.time;
      const a = F.time - s.ht;
      if (a >= 0 && a < 0.34) {
        const m = s.m, d = Math.exp(-a * 12), u = d * Math.cos(a * 30), ax = s.ax, ay = s.ay, q = 0.3 * m * d * Math.cos(a * 20);
        X.rot += (ax >= 0 ? 1 : -1) * 0.34 * m * u * (0.5 + 0.5 * Math.abs(ax)); X.dx += ax * 5 * m * u; X.dy += ay * 2 * m * u;
        X.sx += q * (Math.abs(ay) - Math.abs(ax)); X.sy += q * (Math.abs(ax) - Math.abs(ay));
        if (s.crit) { const pp = 0.2 * Math.exp(-a * 14) * (e.boss ? 0.3 : 1); X.sx += pp; X.sy += pp; }
        any = true;
      }
    }
    return any ? X : null;
  };
  // Wind-up progress 0..1 of the foe's current telegraph (0 when none); valid after F.xform ran this frame.
  F.windupP = (e) => { const s = ent.get(e.id); return s && s.wk ? s.wp : 0; };

  // Called by the renderer for every hero each frame: leaves a fading copy behind while dashing.
  F.dashTrail = (p) => {
    if (!p.dashing || p.dead || p.downed || R().quality === 'low') return;
    if (F.time - (p.ghostT === undefined ? -1 : p.ghostT) < 0.035) return;
    p.ghostT = F.time;
    if (F.ghosts.length >= 28) return;
    const at = ED.Actors && ED.Actors.on() ? ED.Actors.heroSnap(p) : null; // atlas body: three flat silhouettes in the player colour, one per 35 ms
    F.ghosts.push({ k: 'dash', x: p.x, y: p.y, cls: p.cls, slot: p.slot, weapon: p.weapon, face: p.face, at, life: at ? 0.11 : 0.26, max: at ? 0.11 : 0.26 });
  };

  const R = () => ED.Render;
  const ENEMY_COLOR = (type) => { const d = ED.ENEMIES[type]; return d ? d.col.a : '#ffffff'; };
  const EL_COL = ['', '#ff9a3a', '#9fefff', '#ffe66b', '#ff4a5a', '#9be33c', '#fff0c2', '#a070ff']; // hit-event el: 0 physical, 1 fire, 2 ice, 3 lightning, 4 bleed, 5 poison, 6 holy, 7 shadow
  const EL_OL = [null, null, null, '#bfe6ff', '#b8c0cc', null, '#ffcf5a', null]; // 1 px rim of a hit number where the fill alone is hard to tell apart (Lightning, Bleed, Holy); the others keep the dark outline
  const PATH_COL = { fire: '#ff7a2a', ice: '#7fe3ff', lightning: '#ffe66b', poison: '#9be33c', holy: '#fff0c2', shadow: '#a070ff', general: '#d9dfe8' };
  const PROJ_COLOR = { bone: '#e6dfc9', spore: '#9cff6a', ice: '#9fefff', fire: '#ff8a2a', water: '#6fe6ff', void: '#d48cff', arrow: '#e8d8b0', bolt: '#cfd6de', firebolt: '#ff9a3a', spark: '#ffcf4a', fireball: '#ff6a1a', knife: '#d9dfe8', holy: '#ffe9a0', soul: '#7dffd9', plague: '#9cff6a', wave: '#ffe9a0', wisp: '#bff0ff', shard: '#b78cff', blade: '#cfd6de', orb: '#ff7ad9', trident: '#e8c66b', skull: '#e6dfc9',
    hammer: '#ffe9a0', crescent: '#ff9a3a', iceshard: '#9fefff', bloodscythe: '#d43a5a', spectral: '#bcd0ff', web: '#e8e6f0', droneshot: '#ff9a3a', thorn: '#9cff6a' };
  F.projColor = (k) => PROJ_COLOR[k] || '#ffffff';
  const BOOM = { fire: ['#ff9a3a', '#ffcf4a'], bigfire: ['#ff6a1a', '#ffd36b'], shock: ['#e8e2c8', '#ffffff'], slam: ['#c9b98f', '#ffffff'], spore: ['#9cff6a', '#e8ffd0'], ice: ['#9fefff', '#ffffff'], bolt: ['#bfe9ff', '#ffffff'], bone: ['#7dffd9', '#e6dfc9'], burst: ['#ff6a4a', '#ffd36b'], shadow: ['#b78cff', '#2a1f44'], acid: ['#9be33c', '#e8ffd0'], firedamp: ['#ff8a2a', '#ffe9a0'] };

  // Elemental flavour on a hit: embers, ice glints, sparks or blood.
  function elemHit(x, y, el, a, crit) {
    if (F.parts.length > MAXP * 0.8) return;
    const n = crit ? 2 : 1;
    if (el === 1) F.burst(x, y, 3 * n, { kind: 'ember', color: '#ff9a3a', sp: 40, a: -1.57, spread: 2.4, life: 0.8, size: 1.8, drag: 1.5, lt: '#ff8a2a', ltr: 22 });
    else if (el === 2) { F.burst(x, y, 4 * n, { kind: 'streak', color: '#c8f6ff', a, spread: 2.8, sp: 150, life: 0.3, size: 1.4 }); F.burst(x, y, 2 * n, { kind: 'dot', color: '#ffffff', sp: 30, life: 0.6, size: 1.3, add: true, drag: 2 }); }
    else if (el === 3) { F.burst(x, y, 4 * n, { kind: 'spark', color: '#fff3a0', sp: 190, life: 0.2, size: 1.6, drag: 5 }); if (F.bolts.length < 8) F.bolts.push({ pts: [[x - 7, y - 5], [x - 1, y + 2], [x + 5, y - 4], [x + 9, y + 3]], life: 0.1, max: 0.1, color: '#ffe66b' }); }
    else if (el === 4) F.burst(x, y, 5 * n, { kind: 'drop', color: '#a8142c', a, spread: 2.2, sp: 100, life: 0.5, size: 1.8, grav: 220, drag: 2 });
  }

  // Impact spray along the hit direction a, from body height above the foe's ground point (x, gy): element-coloured, sized by damage
  // relative to the foe's health (w 0.25..1.4), crits bigger; chips take the foe's own colours.
  function hitSplash(ev, e, r, gy, a, w, el, p) {
    const x = ev.x, z0 = r * 0.7, crit = !!ev.c, k = crit ? 1.5 : 1, sp = 95 + 120 * w, evo = p && p.stats ? p.stats.evo : '';
    const ec = EL_COL[el] || (crit ? '#ffd36b' : '#fff4d0');
    F.pop(x, gy - z0, (crit ? 12 : 8) + 8 * w, EL_COL[el] || (crit ? '#ffd36b' : '#ffffff'), crit ? 0.2 : 0.12, crit);
    if (crit) F.ring(x, gy - z0, 16 + 14 * w, ec, 0.24, 2.5); else if (w > 1) F.ring(x, gy - z0, 12 + 8 * w, ec, 0.18, 1.6);
    if (F.parts.length > MAXP * 0.85) return;
    const col = e ? e.def.col : null;
    if (col) {
      F.burst(x, gy, cnt(Math.min(3 + Math.round(4 * w * k), 8)), { kind: 'shard', color: col.a, a, spread: 2, sp: sp * 0.8, life: 0.6, size: 2.6 + 1.4 * w, vz: 80 + 70 * w, z: z0 });
      if (w > 0.5) F.burst(x, gy, cnt(2), { kind: 'shard', color: col.b, a, spread: 2.6, sp: sp * 0.6, life: 0.5, size: 1.6 + w, vz: 60, z: z0 });
    }
    F.part(x, gy, { kind: 'streak', color: crit ? '#fff0b0' : ec, a, spread: 0.12, life: 0.1, size: 2.2 + 1.3 * w, z: z0, drag: 0 }, 430 + 220 * w); // one long impact ray along the blow
    F.burst(x, gy, cnt(Math.round(4 + 5 * w * k)), { kind: 'streak', color: crit ? '#fff0b0' : ec, a, spread: 0.9, sp: sp * 1.8, life: 0.22, size: 1.4 + 0.9 * w * k, z: z0 });
    if (el === 1) {
      for (let i = 0, m = cnt(2 + Math.round(3 * w * k)); i < m; i++) F.part(x, gy, { kind: 'ember', color: i & 1 ? '#ffcf4a' : '#ff8a2a', a, spread: 2.6, life: 0.9, size: 1.8, drag: 1.6, z: z0, vz: 40, lt: i === 0 ? '#ff8a2a' : null, ltr: 24 }, 50 + Math.random() * 60, 0.6 + Math.random() * 0.5);
      F.burst(x, gy, cnt(2 + Math.round(2 * w)), { kind: 'spark', color: '#ffb347', a, spread: 1.4, sp: sp * 1.4, life: 0.2, size: 1.5, drag: 5, z: z0 });
    } else if (el === 2) {
      F.burst(x, gy, cnt(3 + Math.round(3 * w * k)), { kind: 'shard', color: '#d8f8ff', a, spread: 2, sp: sp * 0.9, life: 0.5, size: 2 + w, vz: 90, z: z0, add: true });
      F.burst(x, gy, 2, { kind: 'dot', color: '#ffffff', sp: 25, life: 0.6, size: 1.3, add: true, drag: 2, z: z0 });
    } else if (el === 3) {
      F.burst(x, gy, cnt(4 + Math.round(4 * w * k)), { kind: 'spark', color: '#fff3a0', a, spread: 2.6, sp: sp * 1.8, life: 0.2, size: 1.6, drag: 4, z: z0 });
      if (F.bolts.length < 10) { const ca = Math.cos(a), sa = Math.sin(a), L = 12 + 12 * w, y0 = gy - z0 + 10, o = (Math.random() - 0.5) * 8; F.bolts.push({ pts: [[x, y0 - 10], [x + ca * L * 0.4 - sa * o, y0 + sa * L * 0.4 + ca * o], [x + ca * L * 0.7 + sa * o, y0 + sa * L * 0.7 - ca * o], [x + ca * L, y0 + sa * L]], life: 0.1, max: 0.1, color: '#ffe66b' }); }
    } else if (el === 4) {
      F.burst(x, gy, cnt(5 + Math.round(5 * w * k)), { kind: 'drop', color: '#a8142c', a, spread: 1.8, sp: sp * 0.9, life: 0.9, size: 1.8 + 0.6 * w, vz: 60, z: z0, drag: 1.2 });
      addStain(x, gy, 2 + 3 * w, '#6a0a1a', 0.5, 4);
    } else if (el === 5) { // poison: rising bubbles and green drips
      F.burst(x, gy, cnt(3 + Math.round(3 * w * k)), { kind: 'drop', color: '#9be33c', a, spread: 2, sp: sp * 0.7, life: 0.8, size: 1.8 + 0.6 * w, vz: 70, z: z0, drag: 1.4 });
      F.burst(x, gy, cnt(2), { color: '#d6ff8a', sp: 25, vy: -40, life: 0.7, size: 1.8, add: true, drag: 1.5, z: z0 });
    } else if (el === 6) { // holy: gold motes and a short ray
      F.burst(x, gy, cnt(3 + Math.round(2 * w * k)), { color: '#ffe9a0', sp: 35, vy: -48, life: 0.8, size: 2, add: true, drag: 1.5, z: z0 });
      F.burst(x, gy, cnt(2), { kind: 'spark', color: '#fff6d8', a, spread: 1.4, sp: sp * 1.4, life: 0.2, size: 1.5, drag: 5, z: z0 });
    } else if (el === 7) { // shadow: sinking violet smoke
      F.burst(x, gy, cnt(2 + Math.round(2 * w)), { kind: 'smoke', color: '#5a2fb0', sp: 26, life: 0.7, size: 5, drag: 2.5, z: z0 });
      F.burst(x, gy, cnt(2), { kind: 'spark', color: '#c9b3ff', a, spread: 1.6, sp: sp * 1.2, life: 0.2, size: 1.4, drag: 5, z: z0 });
    } else if (evo === 'shadow') {
      F.burst(x, gy, cnt(2 + Math.round(2 * w)), { color: '#a070ff', sp: 30, vy: -34, life: 0.8, size: 2, add: true, drag: 1.5, z: z0 });
      F.burst(x, gy, cnt(2), { kind: 'spark', color: '#d9c8ff', a, spread: 1.6, sp: sp * 1.3, life: 0.2, size: 1.4, drag: 5, z: z0 });
    } else F.burst(x, gy, cnt(Math.round((3 + 4 * w) * (evo === 'general' ? 1.4 : 1))), { kind: 'spark', color: evo === 'general' ? '#ffe6a8' : '#fff4d0', a, spread: 1.6, sp: sp * 1.8, life: 0.18, size: 1.5, drag: 5, z: z0 });
    if (crit) F.burst(x, gy, cnt(6), { kind: 'streak', color: '#ffffff', a, spread: 1.6, sp: 300, life: 0.22, size: 2.2, z: z0 });
  }

  // ---------- ground stains: cached blotch sprites (one draw each) ----------
  const stainCache = {};
  function stainSprite(col, v) { // holder { v }: the canvas now, its ImageBitmap once ready
    const key = col + v; let h = stainCache[key]; if (h) return h;
    const s = document.createElement('canvas'); s.width = 64; s.height = 40;
    const g = s.getContext('2d'); g.fillStyle = col;
    g.beginPath(); g.ellipse(32, 20, 17 + v * 2, 9 + v, 0, 0, TAU); g.fill();
    for (let i = 0; i < 6 + v * 2; i++) { const a = i * 2.4 + v, d = 13 + (i * 7 + v * 5) % 12, rr = 1.5 + (i * 5 + v) % 4; g.beginPath(); g.ellipse(32 + Math.cos(a) * d * 1.5, 20 + Math.sin(a) * d * 0.7, rr, rr * 0.7, 0, 0, TAU); g.fill(); }
    return (stainCache[key] = ED.Bmp.hold(s));
  }
  function addStain(x, y, r, col, a, life) {
    if (F.stains.length >= 32) F.stains.shift();
    F.stains.push({ x, y, r, spr: stainSprite(col, (Math.random() * 3) | 0), a: a || 0.5, life: life || 6, max: life || 6 });
  }

  // ---------- death: foes collapse by look family. A cached snapshot of the sprite (colour + white silhouette) is posed and faded; particles carry the rest. ----------
  const FAM = { skeleton: 'bone', zombie: 'bone', slime: 'goo', jelly: 'goo', puff: 'goo', shroom: 'goo', hulk: 'goo', spitter: 'goo', worm: 'goo',
    wisp: 'spirit', wraith: 'spirit', shade: 'spirit', gloom: 'spirit', eye: 'spirit', imp: 'spirit', rift: 'spirit', star: 'spirit', robed: 'spirit', priest: 'spirit',
    knight: 'metal', golem: 'metal', sentinel: 'metal', drone: 'metal', totem: 'metal' };
  const DUR = { bone: 0.5, goo: 0.42, spirit: 0.55, metal: 0.3, beast: 0.5 };
  const snapPool = [];
  function releaseGhosts() { for (const g of F.ghosts) if (g.sn) g.sn.busy = false; F.ghosts.length = 0; }
  // Free snapshot canvas that fits w x h (colour half at x 0, white half at x cw); grows a free one or adds up to 14.
  function snapGet(w, h) {
    let s = null;
    for (const q of snapPool) if (!q.busy && q.cw >= w && q.ch >= h) { s = q; break; }
    if (!s) {
      for (const q of snapPool) if (!q.busy) { s = q; break; }
      if (!s) { if (snapPool.length >= 14) return null; s = { cv: document.createElement('canvas'), g: null, cw: 0, ch: 0, busy: false }; s.g = s.cv.getContext('2d'); snapPool.push(s); }
      s.cw = Math.max(w, s.cw); s.ch = Math.max(h, s.ch); s.cv.width = s.cw * 2; s.cv.height = s.ch;
    }
    s.busy = true;
    return s;
  }
  const NOP = () => {}, NONE = [];
  let snapBudget = 4; // snapshots per frame: a mass kill spreads its sprite draws over frames
  function spawnGhost(ev, d, fam, a, e) {
    if (ED.Actors && ED.Actors.on()) { // atlas body: the last drawn frame lies down, flattens or dissolves; a puff marks the spot
      if (F.ghosts.length >= 14) return;
      const sn = ED.Actors.foeSnap(ev.type, e, ev.x, ev.y), r = ev.r || d.r;
      F.atlasFx(r > 14 || ev.el ? 'fx.smoke' : 'fx.puff', ev.x, ev.y - (sn ? sn.lift : 0) - (r > 14 ? 8 : 4));
      if (!sn) return;
      const dur = DUR[fam] + (ev.el ? 0.1 : 0);
      F.ghosts.push({ k: 'die', at: sn, x: ev.x, y: ev.y, r, fam, sgn: Math.cos(a) >= 0 ? 1 : -1, life: dur, max: dur });
      return;
    }
    if (lowFx() || F.ghosts.length >= 14 || snapBudget <= 0) return;
    snapBudget--;
    const Rn = R(), S = Rn.bakeScale, r = ev.r || d.r, Sp = ED.Sprites;
    const hw = r * 2.6 + 14, top = r * 3.9 + 24, bot = r * 0.9 + 8, w = Math.ceil(hw * 2 * S), h = Math.ceil((top + bot) * S);
    if (w * h > 1.2e6) return;
    const sn = snapGet(w, h); if (!sn) return;
    const g = sn.g, fk = e ? Object.create(e) : { def: d, r, id: 0, st: 'move', face: 1, frozen: 0, elite: null, hp: 1, maxHp: 1, t: 0, pose: '', aimA: 0, phase: 0 };
    fk.flash = 0; fk.hp = 1; fk.st = fk.st === 'burrow' ? 'move' : fk.st; fk.exposed = false;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, sn.cw * 2, sn.ch);
    g.setTransform(S, 0, 0, S, hw * S, top * S);
    const sh = Sp.shadow; Sp.shadow = NOP;
    let ok = true;
    try { Rn.drawFoe(g, fk, F.time); } catch (err) { ok = false; } finally { Sp.shadow = sh; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!ok) { snapPool.splice(snapPool.indexOf(sn), 1); return; } // an unbalanced context is never reused
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(sn.cv, 0, 0, w, h, sn.cw, 0, w, h);
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = '#ffffff'; g.fillRect(sn.cw, 0, w, h); g.globalCompositeOperation = 'source-over';
    const dur = DUR[fam] + (ev.el ? 0.1 : 0);
    F.ghosts.push({ k: 'die', sn, w, h, wu: w / S, hu: h / S, hw, top, x: ev.x, y: ev.y, r, fam, sgn: Math.cos(a) >= 0 ? 1 : -1, life: dur, max: dur });
  }
  // Pose of an atlas death ghost at age u: the body stays upright for the white flash, then lies down, flattens, rises or shudders by family (rotations are exact quarter turns, squashes whole ratios, so pixels stay square).
  const GA = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, a: 1, add: false };
  function ghostPoseA(g, u) {
    const P = GA, k = u / g.max, sg = g.sgn; P.dx = 0; P.dy = 0; P.rot = 0; P.sx = 1; P.sy = 1; P.a = 1; P.add = false;
    switch (g.fam) {
      case 'bone': default: if (u >= 0.06) { P.rot = sg * HALF_PI; P.dx = sg * 6; P.dy = u < 0.12 ? -4 : 0; } P.a = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45; break;
      case 'goo': if (u >= 0.06) { P.sx = 2; P.sy = 0.5; } P.a = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6; break;
      case 'spirit': P.add = true; P.dy = -Math.round(u * 34 / 2) * 2; P.a = (1 - k) * (1 - k); break;
      case 'metal': P.dx = u < 0.12 ? (Math.floor(u * 60) % 2 ? 2 : -2) : 0; P.a = u < 0.12 ? 1 : Math.max(0, 1 - (u - 0.12) / 0.1); break;
    }
    return P;
  }
  const HALF_PI = Math.PI / 2;
  const GP = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, a: 1, add: false };
  // Pose of a dying foe's snapshot at age u (collapse, flatten, rise or shudder by family).
  function ghostPose(g, u) {
    const P = GP, k = u / g.max; P.dx = 0; P.dy = 0; P.rot = 0; P.sx = 1; P.sy = 1; P.a = 1; P.add = false;
    switch (g.fam) {
      case 'bone': { const e = U.easeOut(Math.min(1, u / 0.26)); P.sy = 1 - 0.55 * e; P.sx = 1 + 0.15 * e; P.rot = g.sgn * 1.05 * e; P.dx = g.sgn * 6 * e; P.a = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45; break; }
      case 'goo': { const e = U.easeOut(Math.min(1, u / 0.15)); P.sy = 1 - 0.85 * e; P.sx = 1 + 0.55 * e; P.a = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6; break; }
      case 'spirit': P.add = true; P.sy = 1 + 0.6 * k; P.sx = 1 - 0.5 * k; P.dy = -u * 34; P.a = (1 - k) * (1 - k); break;
      case 'metal': P.dx = u < 0.12 ? Math.sin(u * 140) * 1.8 * (1 - u / 0.12) : 0; P.a = u < 0.12 ? 1 : Math.max(0, 1 - (u - 0.12) / 0.1); if (u >= 0.12) { P.sy = 1 + (u - 0.12) * 1.5; P.sx = 1 + (u - 0.12) * 1.5; } break;
      default: { const e = U.easeOut(Math.min(1, u / 0.3)); P.rot = g.sgn * 1.3 * e; P.sy = 1 - 0.2 * e; P.dx = g.sgn * 8 * e; P.a = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5; }
    }
    return P;
  }

  const DARK = (c) => U.shade(c, -0.45);
  // Particles and stain of a death, by family; a is the killing blow's direction, big = elite or large foe.
  function deathFx(ev, d, fam, a, big, mem) {
    const x = ev.x, y = ev.y, r = ev.r || d.r, col = d.col, z0 = r * 0.8, k = big ? 1.6 : 1, w = mem ? mem.w : 0.6;
    const dirSp = 120 + 90 * w;
    switch (fam) {
      case 'bone':
        F.burst(x, y, cnt(Math.round(11 * k)), { kind: 'shard', color: col.a, a, spread: 2.6, sp: dirSp, life: 0.85, size: 3, vz: 130, z: z0 });
        F.burst(x, y, cnt(Math.round(4 * k)), { kind: 'shard', color: col.b, a, spread: 3, sp: dirSp * 0.7, life: 0.7, size: 2, vz: 90, z: z0 });
        F.burst(x, y, cnt(3), { kind: 'smoke', color: '#8a8070', sp: 30, life: 0.6, size: 5, drag: 3, z: 2 });
        addStain(x, y, r * 1.1, '#1c1814', 0.4);
        break;
      case 'goo':
        F.burst(x, y, cnt(Math.round(14 * k)), { kind: 'drop', color: col.a, sp: 115, life: 0.9, size: 3, vz: 120, z: z0, drag: 1.1 });
        F.burst(x, y, cnt(Math.round(5 * k)), { kind: 'drop', color: col.b, sp: 70, life: 0.9, size: 2.2, vz: 80, z: z0, drag: 1.1 });
        addStain(x, y, r * 1.6, col.a, 0.62);
        break;
      case 'spirit':
        F.burst(x, y, cnt(Math.round(10 * k)), { color: col.c, sp: 26, vy: -48, life: 1.0, size: 2, add: true, drag: 1.3, z: z0, lt: big ? col.c : null, ltr: 26 });
        F.burst(x, y, cnt(Math.round(6 * k)), { color: col.a, sp: 40, vy: -30, life: 0.8, size: 2.6, add: true, drag: 1.6, z: z0 });
        F.burst(x, y, cnt(4), { kind: 'smoke', color: DARK(col.a), sp: 25, life: 0.9, size: 7, drag: 2, z: z0 });
        break;
      case 'metal':
        F.burst(x, y, cnt(Math.round(12 * k)), { kind: 'spark', color: '#ffe6a8', sp: 230, life: 0.28, size: 1.7, drag: 4, z: z0 });
        F.burst(x, y, cnt(Math.round(6 * k)), { kind: 'shard', color: col.a, a, spread: 3.4, sp: dirSp, life: 0.8, size: 2.8, vz: 130, z: z0 });
        F.burst(x, y, cnt(Math.round(3 * k)), { kind: 'shard', color: '#3a3a44', sp: 90, life: 0.8, size: 2.4, vz: 110, z: z0 });
        F.burst(x, y, cnt(3), { kind: 'smoke', color: '#454048', sp: 30, life: 0.7, size: 6, drag: 3, z: z0 });
        addStain(x, y, r * 1.0, '#0c0a0e', 0.45);
        break;
      default:
        F.burst(x, y, cnt(Math.round(12 * k)), { kind: 'shard', color: col.a, a, spread: 2.4, sp: dirSp, life: 0.8, size: 2.9, vz: 120, z: z0 });
        F.burst(x, y, cnt(Math.round(5 * k)), { kind: 'drop', color: DARK(col.a), a, spread: 2.2, sp: dirSp * 0.8, life: 0.9, size: 2.2, vz: 90, z: z0 });
        F.burst(x, y, cnt(3), { kind: 'smoke', color: '#6a5a4a', sp: 30, life: 0.6, size: 5, drag: 3, z: 2 });
        addStain(x, y, r * 1.3, DARK(col.a), 0.5);
    }
  }

  // Jagged lightning arm between two points (interior points are fixed at birth; the renderer adds shimmer).
  F.zap = (x0, y0, x1, y1, color, life) => {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, n = U.clamp(Math.floor(d / 24), 2, 6), nx = -dy / d, ny = dx / d, pts = [[x0, y0]];
    for (let i = 1; i < n; i++) { const k = i / n, o = (Math.random() - 0.5) * 14; pts.push([x0 + dx * k + nx * o, y0 + dy * k + ny * o]); }
    pts.push([x1, y1]);
    if (F.bolts.length < 24) F.bolts.push({ pts, life: life || 0.22, max: life || 0.22, color: color || '#bfe9ff' });
  };

  // Second-skill (L) cast visuals. ev: { pid, k, a, x, y, tx?, ty? } at the hero.
  function skill2Fx(ev, mine, A) {
    const x = ev.x, y = ev.y, a = ev.a || 0, ca = Math.cos(a), sa = Math.sin(a);
    switch (ev.k) {
      case 'bulwark': F.ring(x, y - 6, 34, '#ffe9a0', 0.3, 3); F.slash(x, y - 10, a, 36, 2.4, '#ffe9a0', 0.22); F.burst(x + ca * 18, y - 10 + sa * 18, 8, { kind: 'spark', color: '#fff3c4', a, spread: 1.6, sp: 130, life: 0.3, size: 1.6, drag: 5 }); F.pop(x + ca * 16, y - 10 + sa * 16, 20, '#ffe9a0', 0.2); A.play('block', mine ? 0.8 : 0.4); break;
      case 'rain': F.burst(x, y - 12, 10, { kind: 'streak', color: '#e8d8b0', a: -1.57, spread: 0.9, sp: 300, life: 0.4, size: 1.8 }); if (ev.tx !== undefined) { F.ring(ev.tx, ev.ty, 30, '#e8d8b0', 0.4, 2); F.pop(ev.tx, ev.ty - 4, 16, '#e8d8b0', 0.3); } A.play('shoot', mine ? 0.8 : 0.4); break;
      case 'meteor': { const ta = ev.tx !== undefined ? Math.atan2(ev.ty - y, ev.tx - x) : a;
        F.burst(x, y - 12, 12, { kind: 'streak', color: '#ffb347', a: ta, spread: 0.4, sp: 340, life: 0.35, size: 2.2 }); F.burst(x, y - 12, 7, { kind: 'ember', color: '#ff8a2a', a: -1.57, spread: 3, sp: 60, life: 0.9, size: 2, drag: 1.5, lt: '#ff8a2a', ltr: 24 });
        F.pop(x, y - 14, 26, '#ff9a3a', 0.25); F.ring(x, y - 6, 30, '#ff9a3a', 0.3, 3); A.play('fire', mine ? 0.9 : 0.5); break; }
      case 'vanish': F.burst(x, y - 8, 14, { kind: 'smoke', color: '#6c6784', sp: 70, life: 0.9, size: 8, drag: 2.5 }); F.burst(x, y - 10, 12, { color: '#b78cff', sp: 90, life: 0.5, size: 2.2, add: true }); F.ring(x, y, 60, '#8a86a0', 0.5, 3); F.pop(x, y - 10, 30, '#b78cff', 0.25); A.play('dash', mine ? 0.8 : 0.4); break;
      case 'judgment': F.slash(x, y - 10, a, 44, 1.3, '#ffe9a0', 0.2); F.burst(x + ca * 20, y - 10 + sa * 20, 6, { kind: 'streak', color: '#fff3c4', a, spread: 0.5, sp: 260, life: 0.25, size: 1.8 }); F.pop(x + ca * 18, y - 10 + sa * 18, 16, '#ffe9a0', 0.18); A.play('heavy', mine ? 0.8 : 0.4); break;
      case 'harvest': F.burst(x, y - 8, 18, { kind: 'shard', color: '#e6dfc9', sp: 130, life: 0.7, size: 2.6, vz: 100, z: 6 }); F.burst(x, y - 8, 10, { color: '#7dffd9', sp: 70, vy: -40, life: 0.6, size: 2.2, add: true }); F.ring(x, y, 50, '#7dffd9', 0.45, 3); F.pop(x, y - 10, 26, '#7dffd9', 0.25); A.play('magic', mine ? 0.9 : 0.4); break;
      default: break;
    }
  }

  // Translate one world event into effects. local: the viewing player's pid.
  F.handle = (ev, ctx) => {
    const local = ctx.localPid, A = ED.Audio, set = ED.App ? ED.App.settings : { dmg: true };
    switch (ev.t) {
      case 'hit': {
        const mine = ev.pid === local, el = ev.el | 0, ec = EL_COL[el] || '', p = ev.pid ? ctx.player(ev.pid) : null;
        if (set.dmg && (mine || ev.c || ev.v >= 20)) {
          const col = ec || (ev.c ? '#ffd36b' : ev.k ? '#ffab70' : (mine ? '#ffffff' : '#cfc6b6'));
          const size = (ev.c ? 14 : (ev.k ? 8 : 10)) + Math.min(5, Math.sqrt(ev.v) * 0.22);
          F.text(ev.x, ev.y - 6, ev.v, col, size, { crit: !!ev.c, pop: true, life: ev.c ? 1.15 : 0.85, max: ev.c ? 1.15 : 0.85, vy: ev.c ? -58 : -42, ol: EL_OL[el] });
        }
        if (!ev.k) {
          const e = foeAt(ev.x, ev.y), r = e ? e.r : 8, gy = e ? e.y : ev.y + r;
          const w = e ? U.clamp(Math.sqrt(ev.v / Math.max(1, e.maxHp)) * 1.6, 0.25, 1.4) : 0.5;
          const a = p ? Math.atan2(gy - r * 0.6 - (p.y - 10), ev.x - p.x) : Math.random() * TAU;
          if (e) hitReact(e, Math.cos(a), Math.sin(a), w, ev.c);
          const hm = hitMem[hitN++ & 7]; hm.x = ev.x; hm.y = gy; hm.a = a; hm.w = w; hm.t = F.time; hm.mine = mine;
          hitSplash(ev, e, r, gy, a, w, el, p);
          contactFx(ev, a, mine, p);
          A.play(ev.c ? 'crit' : 'hit', mine ? 1 : 0.5, { w, el });
          if (mine && (ev.c || ev.v >= 60)) F.hitStop(ev.c ? 0.06 : 0.04);
          if (mine && w > 0.75 && !ev.c) F.addShake(1);
          if (ev.v >= 100) F.punch(0.5, 0);
        } else if (el === 1) elemHit(ev.x, ev.y + 4, 1, 0, false);
        if (ev.c && mine) { F.addShake(2.5); F.punch(0.35, 0); }
        break;
      }
      case 'die': {
        const col = ENEMY_COLOR(ev.type), big = ev.el || ev.r > 14, d = ED.ENEMIES[ev.type];
        let mem = null; for (const m of hitMem) if (m.t !== undefined && F.time - m.t < 0.3 && Math.abs(m.x - ev.x) < 26 && Math.abs(m.y - ev.y) < 26 && (!mem || m.t > mem.t)) mem = m;
        const a = mem ? mem.a : Math.random() * TAU;
        if (d) {
          const fam = FAM[d.look] || 'beast';
          deathFx(ev, d, fam, a, big, mem);
          spawnGhost(ev, d, fam, a, foeAt(ev.x, ev.y - (ev.r || d.r)));
        }
        F.pop(ev.x, ev.y - 8, big ? 26 : 14, col, 0.2);
        if (mem && mem.mine) { if (big || ev.r >= 10) F.hitStop(0.035); F.addShake(big ? 1.6 : 0.7); }
        A.play('die', 0.7, ev.r);
        if (big) { F.ring(ev.x, ev.y, 30, col, 0.4); F.addShake(3); F.hitStop(0.06); }
        break;
      }
      case 'hurt': {
        F.hurtAt[ev.pid] = F.time; // the hero body plays its hit frame
        if (ev.pid === local) { F.flash = { color: '#ff2a2a', t: 0.25, a: 0.32 }; F.addShake(6); F.punch(1.1, 0); A.play('hurt'); }
        F.text(ev.x, ev.y - 26, '-' + Math.max(1, Math.round(ev.v)), '#ff5a4a', 11, { pop: true, life: 1, max: 1 });
        F.burst(ev.x, ev.y - 10, 8, { color: '#d22a2a', sp: 90, life: 0.4, size: 2.2 });
        F.burst(ev.x, ev.y - 10, 5, { kind: 'streak', color: '#ff5a4a', sp: 170, life: 0.25, size: 1.6 });
        F.pop(ev.x, ev.y - 10, 16, '#ff5a4a', 0.18);
        break;
      }
      case 'heal': if (ev.v >= 2) { F.text(ev.x, ev.y - 28, '+' + ev.v, '#86d38f', 10, { pop: true }); F.burst(ev.x, ev.y - 10, 6, { color: '#86ffa0', sp: 30, vy: -40, life: 0.7, size: 2, add: true, drag: 1, lt: '#86ffa0', ltr: 24 }); if (ev.pid === local) A.play('heal', 0.6); } break;
      case 'boom': {
        const cols = BOOM[ev.k] || BOOM.fire, fire = ev.k === 'fire' || ev.k === 'bigfire' || ev.k === 'burst';
        F.ring(ev.x, ev.y, ev.r, cols[0], 0.35, 4);
        F.ring(ev.x, ev.y, ev.r * 0.7, cols[1], 0.22, 2);
        F.burst(ev.x, ev.y, Math.min(30, 8 + ev.r / 4), { color: cols[0], sp: ev.r * 2.6, life: 0.45, size: 3, add: true });
        F.burst(ev.x, ev.y, 6, { color: cols[1], sp: ev.r * 1.2, life: 0.3, size: 4, add: true });
        F.burst(ev.x, ev.y, Math.min(14, 4 + ev.r / 8), { kind: 'streak', color: cols[1], sp: ev.r * 3.2, life: 0.3, size: 1.8 });
        F.pop(ev.x, ev.y - 4, ev.r * 0.8, cols[1], 0.22);
        if (fire) F.burst(ev.x, ev.y, Math.min(10, 3 + ev.r / 12), { kind: 'ember', color: cols[0], sp: 60, a: -1.57, spread: 3, life: 1.0, size: 1.8, drag: 1.2, lt: cols[0], ltr: 24 });
        else if (ev.k === 'slam' || ev.k === 'shock') F.burst(ev.x, ev.y, 7, { kind: 'smoke', color: '#9a8a6a', sp: ev.r * 1.4, life: 0.7, size: 7, drag: 3 });
        if (ev.r >= 80) F.punch(0.45, 0);
        F.addShake(Math.min(7, ev.r / 18)); A.play('boom', Math.min(1, ev.r / 80));
        break;
      }
      case 'swing': {
        if (ev.pid !== local) { const p = ctx.player(ev.pid); if (p) { F.playerAttackAnim(ev.pid, ev.a); F.slash(p.x, p.y - 10, ev.a, ev.r, ev.arc, ED.PLAYER_COLORS[p.slot]); } A.play('swing', 0.35); }
        break;
      }
      case 'atk': if (ev.pid !== local) { F.playerAttackAnim(ev.pid, ev.a); const p = ctx.player(ev.pid); if (p && p.stats && !p.stats.melee) A.play('shoot', 0.3); } break;
      case 'spark': { const c = F.projColor(ED.PROJ_KINDS[ev.k]); F.burst(ev.x, ev.y, 4, { color: c, sp: 80, life: 0.25, size: 1.8, add: true }); F.burst(ev.x, ev.y, 3, { kind: 'streak', color: c, sp: 130, life: 0.2, size: 1.3 }); F.pop(ev.x, ev.y, 7, c, 0.1); A.play('spark', 0.4); break; }
      case 'chain': { // star (hub, t1, hub, t2, ...): one forked arm per target; otherwise a plain polyline. k: h Wrath of Heaven bolt, t Twilight beam, s Superconductor discharge
        const pts = ev.pts, star = pts.length >= 3 && pts[2][0] === pts[0][0] && pts[2][1] === pts[0][1], cc = ev.k === 'h' ? '#fff3a0' : ev.k === 't' ? '#d9b44a' : ev.k === 's' ? '#8fdcff' : '#bfe9ff';
        if (star) for (let i = 1; i < pts.length; i += 2) F.zap(pts[0][0], pts[0][1], pts[i][0], pts[i][1], cc);
        else F.bolts.push({ pts, life: 0.22, max: 0.22, color: cc });
        for (let i = star ? 1 : 0; i < pts.length; i += star ? 2 : 1) F.pop(pts[i][0], pts[i][1] - 6, 9, '#cfeaff', 0.14);
        if (star) F.pop(pts[0][0], pts[0][1] - 6, 12, '#ffffff', 0.16);
        A.play('bolt', 0.5); break; }
      case 'bolt': F.bolts.push({ pts: [[ev.x + 10, ev.y - 220], [ev.x - 8, ev.y - 120], [ev.x + 6, ev.y - 50], [ev.x, ev.y]], life: 0.3, max: 0.3, color: '#ffffff' }); F.pop(ev.x, ev.y - 6, 38, '#e8f4ff', 0.28); F.ring(ev.x, ev.y, 42, '#bfe9ff', 0.3, 3); F.punch(0.8, 0.5); A.play('bolt'); F.addShake(3); break;
      case 'nova': F.ring(ev.x, ev.y, ev.r, ev.c || '#ff7a2a', 0.45, 6); F.ring(ev.x, ev.y, ev.r * 0.6, '#ffffff', 0.3, 2); F.burst(ev.x, ev.y, 26, { color: ev.c || '#ff7a2a', sp: ev.r * 3, life: 0.45, size: 3, add: true }); F.pop(ev.x, ev.y - 6, ev.r * 0.7, ev.c || '#ff7a2a', 0.25); F.punch(0.4, 0); A.play('boom', 0.6); F.addShake(4); break;
      case 'levelup': F.showBanner('Level ' + ev.level, ev.boon ? 'A boon awaits when the room is clear' : '', 'level', 2.2); A.play('level'); for (const p of ctx.players()) { F.burst(p.x, p.y - 10, 18, { color: '#ffd36b', sp: 80, vy: -60, life: 0.9, size: 2.2, add: true, drag: 1.5 }); F.ring(p.x, p.y, 36, '#ffd36b', 0.5, 3); F.pop(p.x, p.y - 12, 26, '#ffd36b', 0.3); } break;
      case 'gold': case 'xp': { // pickup sparkle on the collector, rate-limited
        const p = ctx.player(ev.pid), gold = ev.t === 'gold';
        if (p && F.time - pickT > 0.05) { pickT = F.time; const c = gold ? '#ffd36b' : '#7dffd9'; F.burst(p.x, p.y - 16, 2, { color: c, sp: 40, vy: -45, life: 0.4, size: 1.6, add: true, drag: 2.2 }); }
        if (ev.pid === local) A.play(ev.t, gold ? 0.6 : 0.5); break; }
      case 'boon': { const p = ctx.player(ev.pid), b = ED.BOONS[ev.id]; if (p && b) { const col = b.path ? PATH_COL[b.path] : ED.RARITY[b.rar].color; F.burst(p.x, p.y - 12, b.gate ? 32 : 22, { color: col, sp: 70, vy: -50, life: 0.8, size: 2.4, add: true, drag: 1.2 }); F.ring(p.x, p.y, b.gate ? 42 : 30, col, 0.45, 3); F.pop(p.x, p.y - 14, 22, col, 0.25); if (b.path) F.burst(p.x, p.y - 12, 8, { kind: 'ember', color: col, sp: 40, a: -1.57, spread: 2.4, life: 1.0, size: 1.8, drag: 1.4, lt: col, ltr: 22 }); } if (ev.pid === local) A.play('boon'); break; }
      case 'relic': { const p = ctx.player(ev.pid); const r = ED.RELICS[ev.id]; if (p) { F.text(p.x, p.y - 40, r.name, ED.RARITY[r.rar].color, 11, { life: 1.8, max: 1.8 }); F.burst(p.x, p.y - 12, 24, { color: ED.RARITY[r.rar].color, sp: 80, vy: -40, life: 0.9, size: 2.4, add: true }); F.ring(p.x, p.y, 34, ED.RARITY[r.rar].color, 0.5, 3); } if (ev.pid === local) { A.play('relic'); ED.UI && ED.UI.toast(`<b>${r.name}</b> — ${r.desc}`, ED.Icons.relicUrl(ev.id)); } else if (p) F.msg(`${p.name} found ${r.name}`); break; }
      case 'lock': A.play('lock'); F.addShake(4); break;
      case 'clear': A.play('unlock'); F.showBanner(ev.trial ? 'Trial complete' : 'Room cleared', '', 'small', 1.4); break;
      case 'bossIntro': F.showBanner(ev.name, ev.title, 'boss', 3.4); F.bossQuote = { text: ev.quote, t: 0 }; A.play('roar'); A.music({ s: ctx.stratum(), boss: true }); F.addShake(8); F.punch(0.9, 0); break;
      case 'bossSpawn': F.addShake(6); F.punch(0.6, 0); break;
      case 'bossDown': F.showBanner('Vanquished', ED.ENEMIES[ev.type].name, 'victory', 3); F.flash = { color: '#ffffff', t: 0.5, a: 0.5 }; F.addShake(12); F.punch(2, 1); F.hitStop(0.3); A.play('roar', 0.6); A.play('victory', 0.7); A.music({ s: ctx.stratum() }); F.burst(ev.x, ev.y - 20, 60, { color: ED.ENEMIES[ev.type].col.c, sp: 220, life: 1.2, size: 3.5, add: true }); F.burst(ev.x, ev.y - 20, 18, { kind: 'streak', color: '#ffffff', sp: 380, life: 0.5, size: 2.4 }); F.ring(ev.x, ev.y, 160, ED.ENEMIES[ev.type].col.c, 0.8, 6); F.ring(ev.x, ev.y, 90, '#ffffff', 0.5, 3); F.pop(ev.x, ev.y - 20, 90, '#ffffff', 0.5); break;
      case 'phase': F.addShake(8); F.punch(1.6, 0.8); A.play('roar', 0.8); F.ring(ev.x, ev.y, 120, '#ffffff', 0.5, 5); F.ring(ev.x, ev.y, 70, '#ff8a5a', 0.4, 3); F.pop(ev.x, ev.y - 20, 60, '#ffffff', 0.35); break;
      case 'stratum': { const b = ED.biomeFor(ev.s); F.showBanner(b.name, 'Stratum ' + U.roman(ev.s), 'stratum', 3.6); F.fade = 1; A.music({ s: ev.s }); break; }
      case 'room': for (const p of ctx.players()) F.atlasFx('fx.circle.spark', p.x, p.y - 2); F.fade = Math.max(F.fade, 0.6); if (ev.lc > 0) F.msg(`−${ev.lc} light`, '#ffd9a0'); break;
      case 'down': { const p = ctx.player(ev.pid); A.play('down'); if (p) F.msg(ev.pid === local ? 'You are down! An ally can revive you.' : `${p.name} is down! Stand near them to revive.`, '#ff8a7a'); break; }
      case 'revived': { const p = ctx.player(ev.pid); A.play('revive'); if (p) { F.atlasFx('fx.circle.spark', p.x, p.y - 2); F.msg(`${p.name} is back on their feet`, '#86d38f'); F.burst(p.x, p.y - 10, 24, { color: '#ffe9a0', sp: 70, vy: -60, life: 0.9, size: 2.4, add: true }); F.ring(p.x, p.y, 40, '#ffe9a0', 0.5, 3); F.pop(p.x, p.y - 12, 30, '#ffe9a0', 0.3); } break; }
      case 'dead': { const p = ctx.player(ev.pid); if (p) F.msg(`${p.name} has fallen. They return at the next stratum.`, '#ff8a7a'); break; }
      case 'rise': { const p = ctx.player(ev.pid); const name = { phoenix: 'Phoenix Feather', angel: 'Guardian Angel', wind: 'Second Wind' }[ev.k]; F.showBanner(name, p ? p.name + ' refuses to fall' : '', 'small', 2); F.burst(ev.x, ev.y - 10, 40, { color: '#ffd36b', sp: 150, life: 0.9, size: 3, add: true }); F.ring(ev.x, ev.y, 70, '#ffd36b', 0.6, 4); F.pop(ev.x, ev.y - 12, 50, '#ffd36b', 0.4); F.punch(0.8, 0.4); A.play('revive'); break; }
      case 'dash': F.atlasFx('fx.smoke.ring', ev.x, ev.y - 2, { a: 0.8 }); A.play('dash', ev.pid === local ? 0.8 : 0.3); F.burst(ev.x, ev.y, 6, { color: '#ffffff', sp: 40, life: 0.3, size: 3, kind: 'smoke', drag: 4 }); F.ring(ev.x, ev.y, 18, '#ffffff', 0.18, 2); break;
      case 'skill': { A.play('skill', ev.pid === local ? 1 : 0.5); const p = ctx.player(ev.pid); if (p && ev.k === 'volley') F.ring(p.x, p.y, 30, '#e8d8b0', 0.25); if (ev.k === 'legion' || ev.k === 'sanctuary') F.ring(ev.x, ev.y, ev.k === 'sanctuary' ? 100 : 40, ev.k === 'sanctuary' ? '#ffe9a0' : '#7dffd9', 0.5, 4); if (ev.slot === 1) skill2Fx(ev, ev.pid === local, A); break; }
      case 'blink': for (let i = 0; i <= 8; i++) { const k = i / 8; F.part(U.lerp(ev.x0, ev.x1, k), U.lerp(ev.y0, ev.y1, k) - 10, { color: '#b78cff', sp: 20, life: 0.5, size: 4, add: true, kind: 'smoke' }); } break;
      case 'blinkfx': F.burst(ev.x0, ev.y0 - 12, 14, { color: '#b78cff', sp: 60, life: 0.5, size: 3, add: true }); F.burst(ev.x1, ev.y1 - 12, 14, { color: '#b78cff', sp: 60, life: 0.5, size: 3, add: true }); F.pop(ev.x0, ev.y0 - 12, 20, '#b78cff', 0.2); F.pop(ev.x1, ev.y1 - 12, 20, '#b78cff', 0.2); break;
      case 'deflect': F.burst(ev.x, ev.y, 8, { color: '#ffffff', sp: 120, life: 0.25, size: 2, add: true }); F.burst(ev.x, ev.y, 4, { kind: 'streak', color: '#ffffff', sp: 200, life: 0.2, size: 1.4 }); F.pop(ev.x, ev.y, 10, '#ffffff', 0.12, true); A.play('deflect', 0.6); break;
      case 'block': F.text(ev.x, ev.y - 30, { dodge: 'Dodge', mirror: 'Shrugged off', aegis: 'Blocked', bulwark: 'Blocked' }[ev.k] || 'Blocked', ev.k === 'bulwark' ? '#ffe9a0' : '#bfe9ff', 9, { pop: true });
        if (ev.k === 'bulwark') { const p = ctx.player(ev.pid), a = p ? p.face : 0; F.burst(ev.x + Math.cos(a) * 18, ev.y - 10 + Math.sin(a) * 18, 7, { kind: 'spark', color: '#fff3c4', a, spread: 1.8, sp: 200, life: 0.25, size: 1.6, drag: 5 }); F.pop(ev.x + Math.cos(a) * 18, ev.y - 10 + Math.sin(a) * 18, 12, '#ffffff', 0.14, true); A.play('block', 0.8); } else A.play('deflect', 0.5); break;
      case 'spawned': F.burst(ev.x, ev.y, ev.el ? 18 : 8, { color: ev.el ? '#ffb13a' : '#b8a0ff', sp: 70, life: 0.4, size: 2.4, add: true }); F.pop(ev.x, ev.y - 8, ev.el ? 30 : 20, ev.el ? '#ffb13a' : '#b8a0ff', 0.25); A.play('spawn', 0.5); break;
      case 'raise': F.burst(ev.x, ev.y, 14, { color: '#7dffd9', sp: 60, vy: -40, life: 0.6, size: 2.4, add: true }); F.ring(ev.x, ev.y, 26, '#7dffd9', 0.4, 2); break;
      case 'puff': F.burst(ev.x, ev.y - 8, 10, { color: ev.c || '#cccccc', sp: 50, life: 0.5, size: 3, kind: 'smoke' }); break;
      case 'thud': F.addShake(ev.big ? 9 : 3); A.play('thud', ev.big ? 1 : 0.5); F.burst(ev.x, ev.y, 10, { color: '#bba98a', sp: 80, life: 0.4, size: 3, kind: 'smoke' }); if (ev.big) { F.ring(ev.x, ev.y, 60, '#c9b98f', 0.4, 4); F.punch(0.5, 0); } break;
      case 'shoot': A.play('eshoot', 0.6); break;
      case 'chest': A.play('chest'); F.burst(ev.x, ev.y - 10, 30, { color: '#ffd36b', sp: 120, vy: -60, life: 0.9, size: 2.4, add: true }); F.pop(ev.x, ev.y - 14, 40, '#ffd36b', 0.35); break;
      case 'buy': A.play('buy'); break;
      case 'fountain': A.play('heal'); F.burst(ev.x, ev.y - 10, 40, { color: '#6fe6ff', sp: 100, vy: -80, life: 1.0, size: 2.6, add: true }); F.ring(ev.x, ev.y, 50, '#6fe6ff', 0.6, 3); break;
      case 'altar': A.play('hurt', 0.6); F.burst(ev.x, ev.y - 10, 30, { color: '#d43a5a', sp: 90, vy: -60, life: 0.8, size: 2.6, add: true }); F.pop(ev.x, ev.y - 16, 36, '#d43a5a', 0.3); break;
      case 'gamble': A.play('chest'); break;
      case 'descend': A.play('portal'); F.fade = 1.4; break;
      case 'victory': A.play('victory'); F.showBanner('The Hollow King falls', 'The Deep is quiet, for now', 'victory', 4.5); break;
      case 'defeat': A.play('defeat'); A.music('none'); break;
      case 'expose': F.text(ev.x, ev.y - 30, ev.boss ? 'WEAKENED' : 'EXPOSED', '#ff6a5a', ev.boss ? 13 : 9, { pop: true }); break;
      case 'wardbreak': F.ring(ev.x, ev.y - 10, 26, '#7fc8ff', 0.3, 3); F.burst(ev.x, ev.y - 10, 10, { kind: 'streak', color: '#bfe3ff', sp: 160, life: 0.3, size: 1.4 }); F.pop(ev.x, ev.y - 10, 20, '#7fc8ff', 0.18); A.play('deflect'); break;
      case 'guard': A.play('skill', 0.6); break;
      case 'cone': F.slash(ev.x, ev.y - 6, ev.a, ev.r, ev.arc, '#ff5a3a', 0.25); break;
      case 'left': F.msg(`${ev.name} left the party`, '#ffab70'); break;
      // ---- path payoffs: placeholders until the FX pass (own hero full size, allies at 70% size) ----
      case 'smite': { const m = ev.pid === local ? 1 : 0.7; F.pop(ev.x, ev.y - 20, 40 * m, '#fff0c2', 0.28, true); F.ring(ev.x, ev.y - 4, 26 * m, '#ffcf5a', 0.4, 3); F.burst(ev.x, ev.y - 8, 8, { color: '#ffe9a0', sp: 40, vy: -85, life: 0.7, size: 2, add: true, drag: 1 }); A.play('boon', 0.25 * m); break; }
      case 'reap': { const m = ev.pid === local ? 1 : 0.7; F.slash(ev.x, ev.y - 8, -0.9, 34 * m, 2.2, '#a070ff', 0.25); F.burst(ev.x, ev.y - 8, 10, { kind: 'smoke', color: '#5a2fb0', sp: 40, life: 0.6, size: 6, drag: 2.5 }); F.pop(ev.x, ev.y - 8, 24 * m, '#c9b3ff', 0.2); if (ev.pid === local) F.text(ev.x, ev.y - 30, 'REAPED', '#c9b3ff', 9, { pop: true }); break; }
      case 'toll': { const m = ev.pid === local ? 1 : 0.7; F.ring(ev.x, ev.y - 10, 70 * m, '#5a2fb0', 0.5, 5); F.ring(ev.x, ev.y - 10, 36 * m, '#c9b3ff', 0.35, 3); F.pop(ev.x, ev.y - 12, 50 * m, '#a070ff', 0.3, true); F.addShake(3 * m); A.play('boom', 0.4 * m); break; }
      case 'lance': { const m = ev.pid === local ? 1 : 0.7; F.zap(ev.x0, ev.y0, ev.x1, ev.y1, '#fff0c2', 0.3); F.pop(ev.x1, ev.y1, 16 * m, '#ffe9a0', 0.2); A.play('bolt', 0.2 * m); break; }
      case 'shielded': { const p = ctx.player(ev.pid), st = F.shieldT || (F.shieldT = {}); if (p && F.time - (st[ev.pid] || 0) > 0.25) { st[ev.pid] = F.time; const c = ev.k === 'holy' ? '#ffcf5a' : '#bfe3ff'; F.ring(p.x, p.y - 6, 20, c, 0.3, 2); F.burst(p.x, p.y - 10, 4, { color: c, sp: 24, vy: -36, life: 0.6, size: 1.8, add: true, drag: 1.2 }); if (ev.pid === local) A.play('heal', 0.25); } break; }
      // ---- Wickdeep events (visuals only) ----
      case 'freeze': F.burst(ev.x, ev.y - 10, 12, { kind: 'streak', color: '#c8f6ff', sp: 150, life: 0.35, size: 1.6 }); F.burst(ev.x, ev.y - 10, 8, { kind: 'shard', color: '#bfeaff', sp: 70, life: 0.7, size: 2.6, vz: 70, z: 8 }); F.ring(ev.x, ev.y - 6, 28, '#9fefff', 0.35, 3); F.pop(ev.x, ev.y - 10, 22, '#bfeaff', 0.22, true); A.play('freeze', 0.7); break;
      case 'shatter': F.burst(ev.x, ev.y - 8, 24, { kind: 'shard', color: '#d8f8ff', sp: (ev.r || 60) * 2.4, life: 0.7, size: 3, vz: 110, z: 8, add: true }); F.burst(ev.x, ev.y - 8, 14, { kind: 'streak', color: '#ffffff', sp: (ev.r || 60) * 3.4, life: 0.3, size: 1.8 }); F.ring(ev.x, ev.y, ev.r || 60, '#9fefff', 0.4, 4); F.pop(ev.x, ev.y - 8, (ev.r || 60) * 0.6, '#d8f8ff', 0.25, true); F.punch(0.45, 0); F.addShake(3); A.play('shatter', 0.8); break;
      case 'combust': F.burst(ev.x, ev.y - 8, 18, { kind: 'ember', color: '#ffb347', sp: 90, a: -1.57, spread: 5, life: 1.0, size: 2, drag: 1.5, lt: '#ff8a2a', ltr: 26 }); F.burst(ev.x, ev.y, 16, { color: '#ff7a2a', sp: (ev.r || 70) * 2.4, life: 0.4, size: 3, add: true }); F.ring(ev.x, ev.y, ev.r || 70, '#ff8a3a', 0.4, 4); F.pop(ev.x, ev.y - 8, (ev.r || 70) * 0.7, '#ffd36b', 0.25); F.punch(0.4, 0); F.addShake(3); A.play('combust', 0.8); break;
      case 'guardhit': F.burst(ev.x, ev.y - 8, 8, { kind: 'spark', color: '#ffe9b0', sp: 220, life: 0.25, size: 1.6, drag: 5 }); F.pop(ev.x, ev.y - 8, 12, '#ffffff', 0.14, true); F.ring(ev.x, ev.y - 8, 16, '#e8e2c8', 0.18, 2); A.play('guardhit', 0.7); break;
      case 'ambush': { const p = ctx.player(ev.pid); const x = ev.x !== undefined ? ev.x : (p ? p.x : 0), y = ev.y !== undefined ? ev.y : (p ? p.y : 0); F.slash(x, y - 8, 0.8, 34, 0.5, '#d9c8ff', 0.2); F.slash(x, y - 8, -0.8, 34, 0.5, '#d9c8ff', 0.2); F.burst(x, y - 8, 14, { color: '#b78cff', sp: 130, life: 0.4, size: 2.6, add: true }); F.pop(x, y - 8, 30, '#b78cff', 0.25, true); F.punch(0.6, 0.3); A.play('ambush', ev.pid === local ? 0.9 : 0.5); if (ev.pid === local) F.hitStop(0.07); break; }
      case 'evolve': { const p = ctx.player(ev.pid), col = PATH_COL[ev.path] || '#ffd36b', x = ev.x !== undefined ? ev.x : (p ? p.x : 0), y = ev.y !== undefined ? ev.y : (p ? p.y : 0);
        F.ring(x, y, 120, col, 0.8, 5); F.ring(x, y, 70, '#ffffff', 0.55, 3); F.ring(x, y, 40, col, 0.4, 2);
        F.burst(x, y - 12, 44, { color: col, sp: 110, a: -1.57, spread: 4.4, life: 1.2, size: 2.6, add: true, drag: 1.2 });
        F.burst(x, y - 12, 14, { kind: 'streak', color: '#ffffff', sp: 320, life: 0.5, size: 2 });
        F.pop(x, y - 14, 80, col, 0.5, true); F.punch(1.2, 0.9); F.addShake(5); A.play('evolve', ev.pid === local ? 1 : 0.6); if (ev.pid === local) F.flash = { color: col, t: 0.3, a: 0.3 }; break; }
      case 'dread': { const tier = ev.tier | 0, worse = tier > F.dread; F.dread = tier; A.play('dread', worse ? 0.9 : 0.5, tier);
        if (worse) { F.punch(0.7, 0); F.addShake(2 + tier); if (!calm()) F.flash = { color: '#02010a', t: 0.5, a: 0.55 }; } break; }
      case 'howl': F.ring(ev.x, ev.y - 8, ev.r || 200, '#e8d8b0', 0.6, 4); F.ring(ev.x, ev.y - 8, (ev.r || 200) * 0.5, '#ffffff', 0.4, 2); F.burst(ev.x, ev.y - 14, 10, { kind: 'streak', color: '#e8d8b0', sp: (ev.r || 200) * 1.4, life: 0.4, size: 1.6 }); F.pop(ev.x, ev.y - 14, 24, '#e8d8b0', 0.25); F.addShake(2); A.play('howl', 0.7); break;
      case 'rift': F.burst(ev.x, ev.y - 12, 16, { color: '#b78cff', sp: 90, life: 0.6, size: 2.6, add: true }); F.burst(ev.x, ev.y - 12, 8, { kind: 'streak', color: '#e8c8ff', a: -1.57, spread: 3.1, sp: 200, life: 0.35, size: 1.6 }); F.burst(ev.x, ev.y - 6, 5, { kind: 'smoke', color: '#1a0830', sp: 30, life: 0.8, size: 7 }); F.ring(ev.x, ev.y, 30, '#b78cff', 0.45, 3); F.pop(ev.x, ev.y - 14, 34, '#c98bff', 0.3, true); A.play('rift', 0.6); break;
      case 'claim': { const col = R().rewardColor(ev.item), mine = ev.pid === local, y = ev.y - 18; F.burst(ev.x, y, mine ? 22 : 14, { color: col, sp: 80, vy: -50, life: 0.9, size: 2.4, add: true, drag: 1.3 }); F.ring(ev.x, ev.y - 8, 34, col, 0.5, 3); F.pop(ev.x, y, 28, col, 0.3);
        if (ev.item === 'campfire') F.burst(ev.x, y, 8, { kind: 'ember', color: '#ffb347', a: -1.57, spread: 2.4, sp: 50, life: 1.1, size: 2, drag: 1.4, lt: '#ff8a2a', ltr: 24 });
        if (mine) F.text(ev.x, y - 14, R().rewardLabel(ev.item), col, 10, { life: 1.3, max: 1.3 });
        A.play('claim', mine ? 0.9 : 0.4); break; }
      case 'oil': F.burst(ev.x, ev.y - 14, 20, { kind: 'ember', color: '#ffc27a', a: -1.57, spread: 4.4, sp: 70, life: 1.3, size: 2, drag: 1.3, lt: '#ffb35c', ltr: 26 }); F.ring(ev.x, ev.y - 10, 60, '#ffb35c', 0.6, 4); F.pop(ev.x, ev.y - 16, 70, '#ffc27a', 0.6, true); F.text(ev.x, ev.y - 40, '+' + Math.round(ev.v || 0) + ' light', '#ffd36b', 11, { life: 1.4, max: 1.4 }); if (!calm()) F.flash = { color: '#ffb35c', t: 0.3, a: 0.2 }; A.play('oil', 0.9); break;
      case 'banish': F.burst(ev.x, ev.y - 8, 26, { kind: 'smoke', color: '#150a24', sp: 110, life: 0.9, size: 9, drag: 2.2 }); F.burst(ev.x, ev.y - 8, 18, { color: '#ffd9a0', sp: 160, life: 0.5, size: 2.6, add: true }); F.ring(ev.x, ev.y - 6, 70, '#ffb35c', 0.55, 4); F.pop(ev.x, ev.y - 10, 60, '#ffd9a0', 0.3, true); F.text(ev.x, ev.y - 34, 'Banished', '#ffd9a0', 11, { life: 1.4, max: 1.4 }); F.punch(0.5, 0); A.play('oil', 0.6); break;
      case 'flare': F.ring(ev.x, ev.y - 8, ev.r || 160, '#ffd9a0', 0.55, 5); F.ring(ev.x, ev.y - 8, (ev.r || 160) * 0.55, '#ffffff', 0.35, 3); F.burst(ev.x, ev.y - 12, 26, { color: '#ffd9a0', sp: (ev.r || 160) * 1.6, life: 0.5, size: 3, add: true }); F.burst(ev.x, ev.y - 12, 10, { kind: 'streak', color: '#ffffff', sp: (ev.r || 160) * 2.2, life: 0.3, size: 1.8 }); F.pop(ev.x, ev.y - 12, (ev.r || 160) * 0.6, '#ffe9b0', 0.3, true); F.punch(0.5, 0.2); if (!calm()) F.flash = { color: '#ffd9a0', t: 0.3, a: 0.25 }; A.play('oil', ev.pid === local ? 0.9 : 0.5); break;
      case 'upgrade': { const col = R().rewardColor(ev.to); F.ring(ev.x, ev.y - 8, 44, col, 0.6, 4); F.burst(ev.x, ev.y - 14, 18, { color: col, sp: 80, vy: -50, life: 0.9, size: 2.4, add: true, drag: 1.3 }); F.msg('The dark pays more: ' + R().rewardLabel(ev.to), '#ffd36b'); break; }
      case 'wick': { // boss door: the light left mends the party
        for (const p of ctx.players()) { F.burst(p.x, p.y - 10, 16, { color: '#ffd9a0', sp: 70, vy: -60, life: 0.9, size: 2.2, add: true, drag: 1.4 }); F.ring(p.x, p.y, 38, '#ffb35c', 0.5, 3); F.pop(p.x, p.y - 12, 28, '#ffd9a0', 0.3); }
        F.msg(`The lantern's light guards you: +${ev.heal}% health, ${ev.shield}% shield` + (ev.gold ? `, +${ev.gold} gold` : '') + (ev.embers ? `, +${ev.embers} embers` : ''), '#ffd36b'); A.play('oil', 0.5); break; }
      case 'ward': F.ring(ev.x, ev.y - 10, 24, '#7fc8ff', 0.4, 3); F.burst(ev.x, ev.y - 10, 8, { color: '#bfe3ff', sp: 50, vy: -30, life: 0.6, size: 2, add: true, drag: 1.5 }); F.pop(ev.x, ev.y - 12, 22, '#7fc8ff', 0.25); break;
      default: break;
    }
  };

  // ---------- drawing (world space) ----------
  // Lit pass: stains, non-additive particles (smoke, shards, ash, drops); registers lights for flares and bright particles.
  F.drawWorld = (c) => {
    const Rn = R();
    for (const s of F.stains) { const w = s.r * 3.6; c.globalAlpha = s.a * Math.min(1, s.life / 2); c.drawImage(s.spr.v, s.x - w / 2, s.y - w * 0.31 + 2, w, w * 0.62); }
    c.globalAlpha = 1;
    let nl = 0, rot = false;
    const m = c.getTransform(), S = m.a, bx = m.e, by = m.f; // base transform: rotated rects set a full matrix
    for (const p of F.parts) {
      const k = p.life / p.max;
      if (p.lt && nl < 14) { nl++; Rn.light(p.x, p.y - p.z, p.ltr, p.lt, 0.75 * Math.min(1, k * 1.5)); }
      if (p.add) continue;
      c.globalAlpha = p.kind === 'smoke' ? k * 0.35 : p.kind === 'ash' ? Math.min(1, k * 2) * 0.8 : Math.min(1, k * 1.5);
      c.fillStyle = p.color;
      const sz = p.kind === 'smoke' ? p.size * (2 - k) : p.size * (0.4 + 0.6 * k);
      if (p.kind === 'shard' || p.kind === 'ash') {
        const co = Math.cos(p.rot) * S, si = Math.sin(p.rot) * S; rot = true;
        c.setTransform(co, si, -si, co, p.x * S + bx, (p.y - p.z) * S + by);
        if (p.kind === 'shard') c.fillRect(-sz, -sz * 0.5, sz * 2, sz); else c.fillRect(-sz, -sz * 0.4, sz * 2, sz * 0.8);
        continue;
      }
      if (rot) { c.setTransform(S, 0, 0, S, bx, by); rot = false; }
      if (p.kind === 'smoke') { c.drawImage(Rn.glowSprite(p.color), p.x - sz * 1.6, p.y - p.z - sz * 1.6, sz * 3.2, sz * 3.2); }
      else { c.beginPath(); c.arc(p.x, p.y - p.z, sz, 0, TAU); c.fill(); }
    }
    if (rot) c.setTransform(S, 0, 0, S, bx, by);
    c.globalAlpha = 1;
    // dying foes: the posed snapshot (white silhouette for the first frames); spirit-family ghosts are drawn additively in drawGlow instead
    for (const g of F.ghosts) {
      if (g.k === 'die' && g.at) { // atlas ghost (white while the hit flash lasts); spirit ghosts are drawn additively in drawGlow
        const u = g.max - g.life, P = ghostPoseA(g, u);
        if (P.add || P.a <= 0.01) continue;
        c.save(); c.translate(Math.round(g.x), Math.round(g.y)); Rn.shadow(c, g.r, 0.35 * P.a);
        c.translate(P.dx, P.dy); if (P.rot) c.rotate(P.rot); if (P.sx !== 1 || P.sy !== 1) c.scale(P.sx, P.sy);
        ED.Actors.drawSnap(c, g.at, u < 0.06, P.a);
        c.restore();
        continue;
      }
      if (!g.sn) continue;
      const u = g.max - g.life, P = ghostPose(g, u);
      if (P.a <= 0.01) continue;
      c.save(); c.translate(g.x, g.y); Rn.shadow(c, g.r, 0.35 * P.a);
      if (!P.add) { c.translate(P.dx, P.dy); c.rotate(P.rot); c.scale(P.sx, P.sy); c.globalAlpha = P.a; c.drawImage(g.sn.cv, u < 0.06 ? g.sn.cw : 0, 0, g.w, g.h, -g.hw, -g.top, g.wu, g.hu); }
      c.restore();
    }
    c.globalAlpha = 1;
    for (const p of F.pops) Rn.light(p.x, p.y, p.r * 3.2, p.color, 0.9 * (p.life / p.max));
    for (const r of F.rings) { const k = 1 - r.life / r.max; if (r.r > 40) Rn.light(r.x, r.y, r.r * (0.3 + 0.7 * U.easeOut(k)) * 1.2, r.color, 0.5 * (1 - k)); }
    for (const b of F.bolts) { const k = b.life / b.max; for (let i = 1; i < b.pts.length; i += 2) Rn.light(b.pts[i][0], b.pts[i][1] - 10, 60, b.color, 0.8 * k); }
    for (const s of F.slashes) Rn.light(s.x + Math.cos(s.a) * s.r * 0.6, s.y + Math.sin(s.a) * s.r * 0.6, s.r * 1.1, s.color, 0.5 * (s.life / s.max));
  };

  // Additive line particles (streaks, sparks) are collected per (colour, width step 0.5, alpha step 1/8) and stroked as one path each; the pass is additive, so order does not matter.
  const lineB = new Map();
  function lineAdd(col, w, a, x0, y0, x1, y1) {
    const wq = Math.max(0.5, Math.round(w * 2) / 2), aq = Math.round(a * 8) / 8, key = col + wq + '|' + aq;
    let b = lineB.get(key); if (!b) lineB.set(key, b = { col, w: wq, a: aq, n: 0, p: [] });
    const i = b.n * 4; b.p[i] = x0; b.p[i + 1] = y0; b.p[i + 2] = x1; b.p[i + 3] = y1; b.n++;
  }
  function lineFlush(c) {
    c.lineCap = 'round';
    for (const b of lineB.values()) {
      if (!b.n) continue;
      c.globalAlpha = b.a; c.strokeStyle = b.col; c.lineWidth = b.w; c.beginPath();
      for (let i = 0, m = b.n * 4; i < m; i += 4) { c.moveTo(b.p[i], b.p[i + 1]); c.lineTo(b.p[i + 2], b.p[i + 3]); }
      c.stroke(); b.n = 0;
    }
    if (lineB.size > 80) lineB.clear();
  }
  // Emissive pass (context is in 'lighter'): slashes, rings, glowing particles, streaks, pops, bolts, ghosts.
  F.drawGlow = (c, t) => {
    const Rn = R(), Sp = ED.Sprites;
    const px = ED.Actors && ED.Actors.on();
    if (px) { drawSmears(c); drawHitSprites(c); }
    // smear: a crescent whose bright head sweeps the arc during the weapon's strike; three nested layers (long dim tail -> short white core) fake the fade, then the whole arc fades (procedural fallback)
    for (const s of px ? NONE : F.slashes) {
      const age = s.max - s.life, arc = Math.min(6.28, s.arc), sd = s.side, h = U.easeOut(U.clamp((age - s.t0) / (s.t1 - s.t0), 0, 1));
      if (h <= 0) continue;
      const f0 = U.clamp(1 - (age - s.t1) / (s.max - s.t1), 0, 1), fa = f0 * f0, sweep = arc * h, tail = Math.min(arc, 1.9);
      const rad = s.r * 0.94, th = Math.max(4, s.r * 0.2), base = s.a - sd * arc / 2;
      c.save(); c.translate(s.x, s.y);
      for (let L = lowFx() ? 1 : 0; L < 3; L++) {
        const lt = tail * (L === 0 ? 1 : L === 1 ? 0.5 : 0.2), d1 = sweep, d0 = Math.max(0, d1 - lt); if (d1 - d0 < 0.02) continue;
        c.globalAlpha = fa * (L === 0 ? 0.5 : L === 1 ? 0.65 : 0.9); c.fillStyle = L === 0 ? s.color : L === 1 ? s.hot : '#ffffff';
        const tw = th * (L === 0 ? 1 : L === 1 ? 0.75 : 0.45), n = 10;
        c.beginPath();
        for (let i = 0; i <= n; i++) { const a = base + sd * (d0 + (d1 - d0) * i / n); i ? c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : c.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); }
        for (let i = n; i >= 0; i--) { const q = i / n, a = base + sd * (d0 + (d1 - d0) * q), rr = rad - tw * Math.pow(q, 0.75) * (1 - 0.9 * Math.pow(q, 8)); c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        c.closePath(); c.fill();
      }
      c.restore();
      const he = base + sd * sweep;
      Rn.glow(c, s.x + Math.cos(he) * rad * 0.95, s.y + Math.sin(he) * rad * 0.95, s.r * 0.3, s.color, 0.65 * fa);
    }
    for (const r of F.rings) {
      const k = 1 - r.life / r.max, rr = r.r * (0.3 + 0.7 * U.easeOut(k));
      c.strokeStyle = U.rgba(r.color, (1 - k) * 0.4); c.lineWidth = r.w * (1 - k) * 1.8 + 1; c.beginPath(); c.arc(r.x, r.y, rr, 0, TAU); c.stroke();
      c.strokeStyle = U.rgba(U.mix(r.color, '#ffffff', 0.6), (1 - k) * 0.9); c.lineWidth = r.w * (1 - k) * 0.6 + 0.5; c.beginPath(); c.arc(r.x, r.y, rr, 0, TAU); c.stroke();
    }
    for (const p of F.pops) {
      const k = p.life / p.max, e = 1 - k, sz = p.r * (0.5 + 0.8 * U.easeOut(e));
      Rn.glow(c, p.x, p.y, sz * 1.6, p.color, 0.85 * k);
      c.fillStyle = U.rgba('#ffffff', 0.95 * k); c.beginPath(); c.arc(p.x, p.y, sz * 0.28 * k + 0.5, 0, TAU); c.fill();
      if (p.star) {
        c.strokeStyle = U.rgba('#ffffff', 0.9 * k); c.lineWidth = 1.2 * k + 0.3; c.beginPath();
        c.moveTo(p.x - sz * 1.5, p.y); c.lineTo(p.x + sz * 1.5, p.y); c.moveTo(p.x, p.y - sz * 1.5); c.lineTo(p.x, p.y + sz * 1.5); c.stroke();
      }
    }
    const gm = c.getTransform(), gS = gm.a, gX = gm.e, gY = gm.f; let grot = false;
    for (const p of F.parts) {
      if (!p.add) continue;
      const k = p.life / p.max;
      if (grot && p.kind !== 'shard' && p.kind !== 'streak' && p.kind !== 'spark') { c.setTransform(gS, 0, 0, gS, gX, gY); grot = false; }
      if (p.kind === 'streak') {
        const sp = Math.hypot(p.vx, p.vy), l = Math.min(26, sp * 0.05 + 2), ux = sp > 1 ? p.vx / sp : 0, uy = sp > 1 ? p.vy / sp : 0, a = Math.min(1, k * 1.5), y = p.y - p.z;
        lineAdd(p.color, p.size * (0.4 + 0.6 * k), a, p.x, y, p.x - ux * l, y - uy * l);
        lineAdd('#ffffff', p.size * 0.35, a, p.x, y, p.x - ux * l * 0.5, y - uy * l * 0.5);
      } else if (p.kind === 'spark') {
        const sp = Math.hypot(p.vx, p.vy), l = Math.min(10, sp * 0.03 + 1), ux = sp > 1 ? p.vx / sp : 0, uy = sp > 1 ? p.vy / sp : 0, y = p.y - p.z;
        lineAdd(p.color, p.size, Math.min(1, k * 1.5), p.x, y, p.x - ux * l, y - uy * l);
      } else if (p.kind === 'ember') {
        const fl = 0.6 + 0.4 * Math.sin(p.rot * 5);
        c.globalAlpha = Math.min(1, k * 1.6) * fl; c.fillStyle = p.color; c.fillRect(p.x - p.size * 0.5, p.y - p.z - p.size * 0.5, p.size, p.size);
        Rn.glow(c, p.x, p.y - p.z, p.size * 3, p.color, 0.6);
      } else if (p.kind === 'shard') {
        const co = Math.cos(p.rot) * gS, si = Math.sin(p.rot) * gS;
        c.globalAlpha = Math.min(1, k * 1.5); grot = true;
        c.setTransform(co, si, -si, co, p.x * gS + gX, (p.y - p.z) * gS + gY); c.fillStyle = p.color; c.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
      } else {
        const sz = p.size * (0.4 + 0.6 * k);
        c.globalAlpha = Math.min(1, k * 1.5); c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y - p.z, sz, 0, TAU); c.fill();
        if (sz > 1.6) Rn.glow(c, p.x, p.y - p.z, sz * 3, p.color, 0.35);
      }
    }
    if (grot) c.setTransform(gS, 0, 0, gS, gX, gY);
    lineFlush(c);
    c.globalAlpha = 1;
    // lightning
    for (const b of F.bolts) {
      const k = b.life / b.max;
      c.lineJoin = 'round'; c.beginPath();
      for (let i = 0; i < b.pts.length; i++) { const pt = b.pts[i], mid = i && i < b.pts.length - 1, jx = mid ? (Math.random() - 0.5) * 10 : 0, jy = mid ? (Math.random() - 0.5) * 10 : 0; if (i === 0) c.moveTo(pt[0], pt[1] - 10); else c.lineTo(pt[0] + jx, pt[1] - 10 + jy); }
      c.strokeStyle = U.rgba(b.color, 0.35 * k); c.lineWidth = 6; c.stroke();
      c.strokeStyle = U.rgba(b.color, k); c.lineWidth = 2.4; c.stroke();
      c.strokeStyle = U.rgba('#ffffff', k); c.lineWidth = 1; c.stroke();
      for (const pt of b.pts) Rn.glow(c, pt[0], pt[1] - 10, 12, b.color, 0.5 * k);
    }
    // ghosts: dash afterimages (hero sprite, additive); dying foes' flash overlay and spirit-family dissolve (cached snapshots)
    for (const g of F.ghosts) {
      if (g.k === 'die' && g.at) { // atlas ghost: only the spirit family dissolves additively here
        const P = ghostPoseA(g, g.max - g.life);
        if (P.add && P.a > 0.01) { c.save(); c.translate(Math.round(g.x + P.dx), Math.round(g.y + P.dy)); ED.Actors.drawSnap(c, g.at, false, P.a * 0.9); c.restore(); }
        continue;
      }
      if (g.sn) {
        const u = g.max - g.life, P = ghostPose(g, u), fl = u < 0.12 ? 1 - u / 0.12 : 0;
        if (!fl && !P.add) continue;
        c.save(); c.translate(g.x + P.dx, g.y + P.dy); c.rotate(P.rot); c.scale(P.sx, P.sy);
        if (P.add && P.a > 0.01) { c.globalAlpha = P.a * 0.9; c.drawImage(g.sn.cv, u < 0.06 ? g.sn.cw : 0, 0, g.w, g.h, -g.hw, -g.top, g.wu, g.hu); }
        if (fl) { c.globalAlpha = fl * 0.85; c.drawImage(g.sn.cv, g.sn.cw, 0, g.w, g.h, -g.hw, -g.top, g.wu, g.hu); }
        c.restore();
        continue;
      }
      if (g.at) { // atlas silhouette: alpha .45 / .30 / .15 by age
        const k = g.life / g.max; c.globalCompositeOperation = 'source-over';
        c.save(); c.translate(Math.round(g.x), Math.round(g.y)); ED.Actors.drawDash(c, g, k > 0.66 ? 0.45 : k > 0.33 ? 0.3 : 0.15); c.restore();
        c.globalCompositeOperation = 'lighter';
        continue;
      }
      const k = g.life / g.max, fake = g.fake || (g.fake = { cls: g.cls, slot: g.slot, weapon: g.weapon, face: g.face, moving: true, hp: 1, flash: 0 });
      if (g.ok === undefined) g.ok = dashOK(g, fake);
      if (!g.ok) continue;
      c.save(); c.translate(g.x, g.y); c.globalAlpha = 0.32 * k; Sp.hero(c, fake, t, null); c.restore();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
  };

  // A hero sprite is test-drawn once per class on a throwaway canvas, so a look that cannot render a synthetic actor never unbalances the world context.
  const dashChecked = {};
  function dashOK(g, fake) {
    const key = g.cls;
    if (dashChecked[key] === undefined) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 4;
      try { ED.Sprites.hero(cv.getContext('2d'), fake, 0, null); dashChecked[key] = true; } catch (e) { dashChecked[key] = false; }
    }
    return dashChecked[key];
  }

  // Damage numbers: pixel-font glyph blits, else one blit of a baked sprite (Render.numSprite) scaled to the animated size.
  F.drawTexts = (c) => {
    const Rn = R();
    for (const t of F.texts) {
      const k = t.life / t.max, age = t.max - t.life;
      const pop = t.pop ? 1 + 0.75 * Math.exp(-age * 15) * (t.crit ? 1.3 : 1) : 1;
      const sc = t.crit ? pop * (1 + 0.07 * Math.sin(age * 42) * Math.exp(-age * 5)) : pop;
      const a = Math.min(1, k * 2.2), fs = t.size * sc;
      if (t.crit) { c.globalCompositeOperation = 'lighter'; Rn.glow(c, t.x, t.y, fs * 1.7, t.color, 0.5 * a); c.globalCompositeOperation = 'source-over'; }
      Rn.drawNum(c, t, fs, a);
    }
    c.globalAlpha = 1;
  };
})(globalThis.ED || (globalThis.ED = {}));
