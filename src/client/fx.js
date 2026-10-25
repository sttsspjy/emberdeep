// Visual and audio feedback: particles, slashes, damage numbers, impact pops, ghosts, banners, shake, hit-stop.
// World events (from the local sim or the host's snapshots) are translated into effects here. Drawing is split in three:
// drawWorld (lit with the scene, also registers lights), drawSprites (unlit sprite effects, after the lighting multiply) and drawGlow (emissive, additive, so bloom catches it).
// Everything but glows is pixel art on the 2 world px grid: atlas sprite effects (F.sheet), 2 px particles, cached pixel rings (ED.Pix).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, Pix = ED.Pix, s2 = Pix.s2;
  let hsUntil = 0; // wall-clock end of the current hit-stop
  const F = ED.FX = {
    parts: [], texts: [], slashes: [], rings: [], bolts: [], pops: [], ghosts: [], stains: [], sheets: [], beams: [], holyT: {}, msgs: [], hurtAt: {}, banner: null, shake: 0, flash: null, fade: 0, anim: {}, hitstop: 0, time: 0, aberr: 0, kick: 0, addK: 1, crowd: 1, // crowd: burst-count factor, set by the renderer (below 1 with many live foes)
    // 1 normally, ~0.06 during a hit-stop; consumers (game loop) multiply their dt by it. Wall-clock based, so it is safe however dt is scaled.
    get timeScale() { return performance.now() / 1000 < hsUntil ? 0.06 : 1; },
    set timeScale(v) { /* derived value; assignments are ignored */ },
  };
  let MAXP = 500, lastHs = 0, pickT = 0;
  const calm = () => !!(ED.App && ED.App.settings && !ED.App.settings.shake); // "screen shake off" also mutes flashes and hit-stop

  F.reset = () => { F.parts.length = 0; F.texts.length = 0; for (const s of F.slashes) if (s.sm) smearPool.push(s.sm); F.slashes.length = 0; F.rings.length = 0; F.bolts.length = 0; F.pops.length = 0; releaseGhosts(); F.stains.length = 0; F.sheets.length = 0; F.beams.length = 0; F.holyT = {}; F.chargeT = {}; F.msgs.length = 0; F.hurtAt = {}; F.banner = null; F.shake = 0; F.flash = null; F.anim = {}; F.aberr = 0; F.kick = 0; hsUntil = 0; ent.clear(); hitN = 0; ED.Sprites.shotReset(); };
  F.setQuality = (q) => { MAXP = q === 'low' ? 180 : 500; };
  const lowFx = () => MAXP < 300;
  const cnt = (n) => Math.ceil(n * (MAXP < 300 ? 0.5 : 1) * F.crowd);
  const lk = (n) => (MAXP < 300 ? Math.max(1, Math.round(n * 0.7)) : n); // path payoff bursts (Smite, Reap, acid): with cnt's 0.5 on Low they come out at 0.35 of nominal

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
    const o = opts || NO_OPTS; // opts: crit, pop, life, max, vy, ol (rim colour), sum (a damage number: it adds into a same-style number of the same spot born under 150 ms ago and pops again; a spot keeps at most 3 live numbers, the oldest goes first), only (with sum: never creates a number, it only adds into one)
    if (o.sum) {
      let last = null, first = -1, nn = 0;
      for (let i = 0; i < F.texts.length; i++) { const t = F.texts[i]; if (t.sum && Math.abs(t.bx - x) < 6 && Math.abs(t.by - y) < 6) { last = t; if (first < 0) first = i; nn++; } }
      if (last && last.max - last.life < 0.15 && last.crit === !!o.crit && last.color === color) { last.s = String(Math.round(+last.s + +s)); last.size = Math.max(last.size, size || 10); last.life = last.max; return; }
      if (o.only) return;
      if (nn >= 3) F.texts.splice(first, 1);
    }
    if (F.texts.length > 80) F.texts.shift();
    // texts over the same spot stack upward by one text height (the pixel font is 2 world px per font px, plus its rim) instead of overprinting
    const step = ED.Atlas && ED.Atlas.font ? ED.Atlas.font.h * 2 + 4 : 12;
    let yy = y;
    for (let k = 0; k < 4; k++) { let moved = false; for (const t of F.texts) if (Math.abs(t.x - x) < 24 && Math.abs(t.y - yy) < step) { yy = t.y - step; moved = true; } if (!moved) break; }
    F.texts.push({ x: x + (Math.random() - 0.5) * 10, y: yy, s: String(s), color, size: size || 10, life: o.life ?? 0.9, max: o.max ?? 0.9, vy: o.vy ?? -42, crit: !!o.crit, pop: !!o.pop, ol: o.ol || null, sum: !!o.sum, bx: x, by: y });
  };
  F.ring = (x, y, r, color, life, width, inv, r0) => { if (F.rings.length < 48) F.rings.push({ x, y, r, color, life: life || 0.4, max: life || 0.4, w: width || 3, inv: !!inv, r0 }); }; // inv: the ring shrinks instead of growing; r0: it grows linearly from radius r0 to r (a shockwave front)
  // One-shot (or looping) atlas sprite effect with the anim's pivot at world (x, y). o: ramp (recolour: ramp name or colour), add (additive pass instead of the unlit one), delay (s), speed (fps factor), a (alpha), flip, rot,
  // spin (rad/s), loop + life (s), fade (alpha falls to 0 over life), vx / vy (px/s), frame (fixed frame of a static sprite), dy (draw offset), lt / ltr (scene light colour / radius),
  // pid + fdy (follows that hero, pivot fdy px below its feet point). Capped at 72 (28 on Low), the oldest goes first.
  const sheetPool = [];
  F.sheet = (id, x, y, o) => {
    const At = ED.Atlas, r = At.anim(id); if (!r) return null;
    o = o || NO_OPTS;
    const sh = F.sheets, s = sh.length >= (lowFx() ? 28 : 72) ? sh.shift() : (sheetPool.pop() || {});
    s.id = id; s.ramp = o.ramp || ''; s.x = x; s.y = y; s.t = -(o.delay || 0); s.fps = (o.fps || r.fps) * (o.speed || 1); s.n = r.n; s.loop = !!o.loop; s.fixed = o.frame === undefined ? -1 : o.frame;
    s.life = o.life || (s.fixed >= 0 ? 0.4 : 0); s.a = o.a === undefined ? 1 : o.a; s.add = !!o.add; s.flip = !!o.flip; s.rot = o.rot || 0; s.spin = o.spin || 0; s.vx = o.vx || 0; s.vy = o.vy || 0; s.fade = !!o.fade;
    s.dy = o.dy || 0; s.lt = o.lt || null; s.ltr = o.ltr || 60; s.pid = o.pid === undefined ? null : o.pid; s.fdy = o.fdy || 0;
    sh.push(s); return s;
  };
  // Smear arc. A hero weapon swing (no life given) takes its sweep side and timing from the attack animation that was just started.
  F.slash = (x, y, a, r, arc, color, life) => {
    const an = life === undefined ? F.lastAnim : null, L = life || 0.28, cl = an && color === CLEAVE_COL; // a Cleave keeps its gold
    if (an && an.col && !cl) color = an.col; // a hero swing wears the colour of the hero's path (steel without one)
    const fk = an ? an.fork : '', tk = fk === 'heavy' ? 1.4 : fk === 'swift' ? 0.55 : 1; // Heavy swings leave a 1.4x wider smear, Swift ones a thin bright one
    if (fk === 'swift') color = U.mix(color, '#ffffff', 0.35);
    if (F.slashes.length < 24) F.slashes.push({ x, y, a, r, arc, color, hot: U.mix(color, '#ffffff', 0.6), life: L, max: L, side: an ? an.side : (F.slashes.length & 1 ? 1 : -1), t0: an ? an.t0 : 0.02, t1: an ? an.t1 : 0.1, sm: null, hr: -1, tk: tk * (cl ? 1.25 : 1) });
    if (cl && !lowFx()) { const ta = a, tx = x + Math.cos(ta) * r * 0.9, ty = y + Math.sin(ta) * r * 0.9; F.ring(tx, ty + 6, 22 * tk, CLEAVE_COL, 0.3, 3); } // Cleave shock ring at the tip of the blow
  };
  // A slam ahead (weapon.ahead): a narrow overhead smear to the slam point d px along a from (x, y), then an impact ring of radius sr there (y + 10: the ground), dust and a shake for your own hero. remote: no shake.
  F.slam = (x, y, a, d, sr, color, remote) => {
    F.slash(x, y, a, d, 0.5, color, remote ? 0.22 : undefined);
    const gx = x + Math.cos(a) * d, gy = y + 10 + Math.sin(a) * d;
    F.ring(gx, gy, sr, color === CLEAVE_COL ? CLEAVE_COL : '#d8c8a0', 0.3, 4, false, sr * 0.3); F.pop(gx, gy - 4, sr * 0.45, '#fff2d0', 0.12);
    if (!lowFx()) { dust(gx, gy, 'dust', 4); F.burst(gx, gy - 2, 8, { kind: 'shard', color: '#8a7a60', sp: sr * 2.2, life: 0.45, size: 2.2, vz: 90, z: 2 }); }
    if (!remote) F.addShake(2.5);
  };
  const CLEAVE_COL = '#ffd36b';
  // Bright impact flash that also lights the scene. star: flare lines (crits).
  // al: alpha factor (default 1); core: colour of the centre square and flare lines (default white).
  F.pop = (x, y, r, color, life, star, al, core) => { if (F.pops.length < 40) F.pops.push({ x, y, r, color, life: life || 0.16, max: life || 0.16, star: !!star, al: al === undefined ? 1 : al, core: core || '#ffffff' }); };
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

  // Plays a named audio cue without a world event (a dash charge refilled, a dark door, a breaking prop).
  F.cue = (name, vol, arg) => { if (ED.Audio) ED.Audio.play(name, vol, arg); };
  const SKILL_CUE = { charge: 'charge', volley: 'volley', rain: 'raincast', fireball: 'fire' }; // skill events with their own cast cue
  F.update = (dt) => {
    if (ED.Audio) ED.Audio.flush(); // the frame's hits, impacts and deaths become layered cues
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
    tickSlashes(dt); tick(F.rings, dt); tick(F.bolts, dt); tick(F.pops, dt); tick(F.stains, dt); tick(F.beams, dt);
    { const sh = F.sheets; n = 0; // sprite effects: age, drift; a one-shot ends after its last frame, a loop or static sprite after its life
      for (let i = 0; i < sh.length; i++) {
        const s = sh[i]; s.t += dt; if (s.t > 0) { s.x += s.vx * dt; s.y += s.vy * dt; }
        if (s.pid !== null) { const g = ED.Game && ED.Game.s, p = g && g.view.players.get(s.pid); if (p) { s.x = p.x; s.y = p.y + s.fdy; } } // follows its hero
        if (s.loop || s.fixed >= 0 ? (s.life > 0 && s.t >= s.life) : s.t * s.fps >= s.n) { if (sheetPool.length < 80) sheetPool.push(s); } else sh[n++] = s;
      }
      sh.length = n; }
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
  // sw: the weapon of this attack's combo step (ED.Stats.stepWeapon; an.w, read by the swing pose), else the hero's weapon.
  F.playerAttackAnim = (pid, a, sw) => {
    const an = F.anim[pid] || (F.anim[pid] = { atkT: 9, side: 1, t0: 0.05, t1: 0.12, D: 0.3 });
    if (an.atkT < 0.03) return; // swing + atk events of one attack arrive together
    const s = ED.Game && ED.Game.s, p = s && s.view.players.get(pid), wd = p && ED.Sprites.weaponArt(p), w = sw && sw.step !== undefined ? sw : wd && wd.w;
    an.w = sw && sw.step !== undefined ? sw : null;
    an.cold = an.atkT > an.D + (ED.Actors ? ED.Actors.HOLD : 0); // the last swing's hold has ended: the weapon starts this one from its idle carry
    an.atkT = 0; an.side = -an.side; an.a = a; an.fork = wd ? wd.fork : ''; F.lastAnim = an;
    const mp = p && p.boons ? ED.mainPath(p.boons) : null; an.col = mp && mp !== 'general' && PATH_COL[mp] ? PATH_COL[mp] : '#9fb0c0'; // smear outer band: the hero's path colour, steel without one
    if (w) {
      const tm = ED.Sprites.atkTimes(w); an.t0 = tm[0]; an.t1 = tm[1]; an.D = tm[2];
      if (w.kind !== 'melee') {
        const col = F.projColor(w.proj), x = p.x + Math.cos(a) * 20, y = p.y - 11 + Math.sin(a) * 20;
        F.pop(x, y, 9, col, 0.09); if (!lowFx()) F.burst(x, y, 3, { kind: 'spark', color: col, a, spread: 0.7, sp: 170, life: 0.14, size: 1.3, drag: 5 });
        if (ED.Actors && ED.Actors.on()) { // pixel flash: a spark at the string of a bow, an element-tinted star at the tip of a magic weapon (one frame)
          if (w.look === 'bow' || w.look === 'crossbow') F.sheet('fx.hit.spark', x - Math.cos(a) * 10, y - Math.sin(a) * 10, { speed: 1.5 });
          else F.sheet('fx.spark.magic', x, y, { frame: 1, life: 0.07, add: true, ramp: col });
        }
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
        if (Math.abs(pp) > (0.7 + 2.4 * f) * sl.tk) continue;
        u[j * SM + i] = f > 0.72 ? cC : f > 0.38 ? cM : cO;
      }
    } else {
      // a full circle starts at the blade's wind-up pose (0.4 rad behind the aim), other arcs are centred on the aim
      const Ro = sl.r * 0.94, base = sl.a - sd * (arc > 6 ? 0.4 : arc / 2), Tm = Math.min(Ro * 0.9, U.clamp(sl.r * 0.4, 8, 24) * sl.tk), tail = Math.min(arc, 1.9), hdA = head * arc, inner = (Ro - Tm) * (Ro - Tm), outer = Ro * Ro;
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

  // Contact flash of a hero's direct hit: the Cut slash across the blow (CutX on a crit), a red Blast under heavy weapons (a heavy hit, or a hammer that is not Swift). The local hero's hits always show (one per 50 ms); allies' only crits and heavy blows.
  const HEAVY = { warhammer: 1, dawnhammer: 1 };
  let contactT = -9;
  function contactFx(ev, a, mine, p) {
    if (!ED.Actors || !ED.Actors.on()) return;
    const wd = p ? ED.Sprites.weaponArt(p) : null, heavy = !!ev.h || (!!wd && !!HEAVY[wd.id] && wd.fork !== 'swift'), crit = !!ev.c;
    if (!mine && !crit && !heavy) return;
    if (F.time - contactT < 0.05) return;
    contactT = F.time;
    const x = ev.x, y = ev.y + 3, an = ev.pid !== undefined ? F.anim[ev.pid] : null;
    const delay = an && an.atkT < 0.05 && wd && wd.w.kind === 'melee' ? an.t0 + (an.t1 - an.t0) * 0.45 : 0; // the flash lands when the blade passes the foe, not when the swing starts
    if (crit) F.sheet('fx.cutx', x, y, { delay });
    else F.sheet('fx.cut', x, y, { delay, rot: Math.round((a + 3 * Math.PI / 4) / (Math.PI / 4)) * Math.PI / 4 });
    if (heavy && mine) F.sheet('fx.blast.red', x, y, { a: 0.9, delay });
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
  const PROJ_COLOR = { bone: '#e6dfc9', spore: '#9cff6a', ice: '#9fefff', fire: '#ff8a2a', water: '#6fe6ff', void: '#d48cff', arrow: '#e8d8b0', bolt: '#cfd6de', firebolt: '#ff9a3a', spark: '#ffcf4a', fireball: '#ff6a1a', knife: '#d9dfe8', boomerang: '#d9c8ff', holy: '#ffe9a0', soul: '#7dffd9', plague: '#9cff6a', wave: '#ffe9a0', wisp: '#bff0ff', shard: '#b78cff', blade: '#cfd6de', orb: '#ff7ad9', trident: '#e8c66b', skull: '#e6dfc9',
    hammer: '#ffe9a0', shield: '#ffe9a0', crescent: '#ff9a3a', iceshard: '#9fefff', bloodscythe: '#d43a5a', spectral: '#bcd0ff', web: '#e8e6f0', droneshot: '#ff9a3a', thorn: '#9cff6a' };
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
    if (crit) { F.burst(x, gy, cnt(6), { kind: 'streak', color: '#ffffff', a, spread: 1.6, sp: 300, life: 0.22, size: 2.2, z: z0 }); if (el === 0 || el === 4) SP('fx.glint', x, gy - z0, { ramp: 'general', add: true, speed: 1.3 }); } // General crits glint steel
  }

  // ---------- ground stains: cached pixel blotches (one draw each), ragged on the art grid ----------
  function stainSprite(s) { // s: { key, col, v, W }; the cached holder (rebuilt when the cache dropped it)
    const H = Math.max(3, Math.round(s.W * 0.56)), W = s.W, v = s.v;
    return Pix.get(s.key) || Pix.bake(s.key, W, H, W / 2, H / 2, (b, w) => {
      const p = Pix.px32(s.col);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot((x + 0.5 - W / 2) / (W * 0.39), (y + 0.5 - H / 2) / (H * 0.39)), n = Pix.hash(x * 13.7 + y * 7.3 + v * 31.1 + W);
        if (d < 0.82 + (n - 0.5) * 0.4 || (d < 1.25 && n > 0.74)) b[y * w + x] = p;
      }
    });
  }
  function addStain(x, y, r, col, a, life) {
    if (F.stains.length >= 32) F.stains.shift();
    const W = U.clamp(Math.round(r * 1.8), 4, 44), v = (Math.random() * 3) | 0;
    F.stains.push({ x, y, r, key: 'st|' + col + '|' + v + '|' + W, col, v, W, a: a || 0.5, life: life || 6, max: life || 6 });
  }

  // ---------- death: foes collapse by look family. A cached snapshot of the sprite (colour + white silhouette) is posed and faded; particles carry the rest. ----------
  const FAM = { skeleton: 'bone', zombie: 'bone', slime: 'goo', jelly: 'goo', puff: 'goo', shroom: 'goo', hulk: 'goo', spitter: 'goo', worm: 'goo',
    wisp: 'spirit', wraith: 'spirit', shade: 'spirit', eye: 'spirit', imp: 'spirit', rift: 'spirit', star: 'spirit', robed: 'spirit', priest: 'spirit',
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
      F.sheet(r > 14 || ev.el ? 'fx.smoke' : 'fx.puff', ev.x, ev.y - (sn ? sn.lift : 0) - (r > 14 ? 8 : 4), { ramp: 'smoke', a: 0.85 }); // smoke ramp, not the white source colours
      if (!sn) return;
      const dur = sn.death ? sn.dur : DUR[fam] + (ev.el ? 0.1 : 0);
      F.ghosts.push({ k: 'die', at: sn, x: ev.x, y: ev.y, r, fam: sn.death ? 'anim' : fam, sgn: Math.cos(a) >= 0 ? 1 : -1, life: dur, max: dur });
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
      case 'anim': P.a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4; break;
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
      case 'shieldthrow': F.ring(x, y - 6, 24, '#ffe9a0', 0.2, 2); F.burst(x + ca * 14, y - 10 + sa * 14, 6, { kind: 'streak', color: '#fff3c4', a, spread: 0.5, sp: 240, life: 0.2, size: 1.6 }); F.pop(x + ca * 14, y - 10 + sa * 14, 14, '#ffe9a0', 0.14); A.play('throw', mine ? 0.9 : 0.45); break;
      case 'rain': F.burst(x, y - 12, 10, { kind: 'streak', color: '#e8d8b0', a: -1.57, spread: 0.9, sp: 300, life: 0.4, size: 1.8 }); if (ev.tx !== undefined) { F.ring(ev.tx, ev.ty, 30, '#e8d8b0', 0.4, 2); F.pop(ev.tx, ev.ty - 4, 16, '#e8d8b0', 0.3); } A.play('shoot', mine ? 0.8 : 0.4); break;
      case 'meteor': { const ta = ev.tx !== undefined ? Math.atan2(ev.ty - y, ev.tx - x) : a;
        F.burst(x, y - 12, 12, { kind: 'streak', color: '#ffb347', a: ta, spread: 0.4, sp: 340, life: 0.35, size: 2.2 }); F.burst(x, y - 12, 7, { kind: 'ember', color: '#ff8a2a', a: -1.57, spread: 3, sp: 60, life: 0.9, size: 2, drag: 1.5, lt: '#ff8a2a', ltr: 24 });
        F.pop(x, y - 14, 26, '#ff9a3a', 0.25); F.ring(x, y - 6, 30, '#ff9a3a', 0.3, 3); A.play('fire', mine ? 0.9 : 0.5); break; }
      case 'vanish': F.burst(x, y - 8, 14, { kind: 'smoke', color: '#6c6784', sp: 70, life: 0.9, size: 8, drag: 2.5 }); F.burst(x, y - 10, 12, { color: '#b78cff', sp: 90, life: 0.5, size: 2.2, add: true }); F.ring(x, y, 60, '#8a86a0', 0.5, 3); F.pop(x, y - 10, 30, '#b78cff', 0.25); for (let i = 0; i < 6; i++) { const q = i * TAU / 6; SP('fx.smoke', x + Math.cos(q) * 22, y - 8 + Math.sin(q) * 14, { ramp: 'smoke', delay: i * 0.03, speed: 0.9 }); } A.play('dash', mine ? 0.8 : 0.4); break;
      case 'judgment': F.slash(x, y - 10, a, 44, 1.3, '#ffe9a0', 0.2); F.burst(x + ca * 20, y - 10 + sa * 20, 6, { kind: 'streak', color: '#fff3c4', a, spread: 0.5, sp: 260, life: 0.25, size: 1.8 }); F.pop(x + ca * 18, y - 10 + sa * 18, 16, '#ffe9a0', 0.18); A.play('heavy', mine ? 0.8 : 0.4); break;
      case 'harvest': F.burst(x, y - 8, 18, { kind: 'shard', color: '#e6dfc9', sp: 130, life: 0.7, size: 2.6, vz: 100, z: 6 }); F.burst(x, y - 8, 10, { color: '#7dffd9', sp: 70, vy: -40, life: 0.6, size: 2.2, add: true }); F.ring(x, y, 50, '#7dffd9', 0.45, 3); F.pop(x, y - 10, 26, '#7dffd9', 0.25);
        for (let i = 0; i < 8; i++) { const q = i * TAU / 8; SP('proj.bone', x, y - 10, { frame: 0, vx: Math.cos(q) * 150, vy: Math.sin(q) * 105, spin: 12 + (i & 1) * 4, life: 0.55, fade: true }); } // bones radiating, souls flowing back in
        for (let i = 0; i < 6; i++) { const q = Math.random() * TAU; fly(x + Math.cos(q) * 55, y - 8 + Math.sin(q) * 40, x, y, '#7dffd9', 1); }
        A.play('magic', mine ? 0.9 : 0.4); break;
      default: break;
    }
  }

  // ---------- sprite recipes (atlas art; each is a no-op while the art is missing) ----------
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  // Vertical light pillar of width w ending at the ground point (x, y): white core, light and element edge; stepped width and alpha over its life.
  F.beam = (x, y, h, w, col, life, al, core) => { if (F.beams.length < 12) F.beams.push({ x, y, h, w, col, life: life || 0.25, max: life || 0.25, al: al === undefined ? 1 : al, core: core || '#ffffff' }); }; // al: alpha factor, core: colour of the centre stripe
  // Explosion cluster for a blast of radius r at (x, y): one sprite under 50 px, two under 90, three beyond, staggered by 60 ms.
  function boomSheets(x, y, r, ramp) {
    const n = r < 50 ? 1 : r < 90 ? 2 : 3;
    for (let i = 0; i < n; i++) { const a = i * 2.4 + x * 0.1, d = i ? r * 0.4 : 0; SP('fx.explosion', x + Math.cos(a) * d, y - 6 + Math.sin(a) * d * 0.6, { ramp, delay: i * 0.06, speed: 1 - i * 0.06, lt: ramp === 'poison' ? '#9be33c' : '#ff8a2a', ltr: 70 + r * 0.4 }); }
  }
  // Ground dust ring plus n puffs (dash starts, slams, landings).
  function dust(x, y, ramp, n) {
    SP('fx.smoke.ring', x, y, { ramp: ramp || 'dust' });
    for (let i = 0; i < (n || 0); i++) { const a = Math.random() * TAU; SP('fx.puff', x + Math.cos(a) * 10, y - 4 + Math.sin(a) * 4, { ramp: ramp || 'dust', vx: Math.cos(a) * 16, vy: -8 - Math.random() * 14, delay: Math.random() * 0.08 }); }
  }
  F.dust = dust;
  // Shield Charge ends in an impact flare (red Aim blast, streaks along the charge, 4 px shake for your own hero); the renderer calls it when a charging hero stops.
  F.chargeT = {};
  F.chargeHit = (x, y, a, mine) => { ED.Audio.play('chargehit', mine ? 1 : 0.5); SP('fx.blast.red', x, y, { add: true, lt: '#ff8a4a', ltr: 70 }); F.burst(x, y, 8, { kind: 'streak', color: '#e8e2c8', a, spread: 1.2, sp: 260, life: 0.25, size: 1.8 }); F.pop(x, y, 22, '#ffe9b0', 0.18, true); if (mine) F.addShake(4); };
  // Gold (or coloured) motes that fly from the burst point (x, y) to a hero at (tx, ty) in about 0.45 s.
  function fly(x, y, tx, ty, col, n) {
    for (let i = 0; i < n; i++) { const dx = tx - x, dy = ty - 10 - y; F.part(x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, { color: col, size: 2, life: 0.5, add: true, drag: 0, vx: dx / 0.45, vy: dy / 0.45 }, 0, 0.45 + Math.random() * 0.08); }
  }

  // Per-class client hooks, registered by src/client/cls-<class>.js at load: ev[type] = [fn(ev, ctx, localPid)] run before the built-in handler of that event (a hook that returns true consumes the event: no built-in handler; a 'boom' hook that sets ev.kfx = 1 replaces the built-in rings);
  // zone[kind] = fn(c, z, pass, t, k, view) draws a zone kind render.js has no case for; hero = [fn(c, p, t, low)] runs after the built-in hero effects (hero feet frame);
  // mark = [fn(e) -> {id, ramp, stub} | null] adds a 14 px glyph (atlas anim id, Pix ramp, GLYPH stub key when the art is absent) to a foe's overhead mark row.
  // shot[kind] = fn(c, pr, t, x, y) runs after a projectile of that kind is drawn (unlit pass, world frame; x, y the body's centre on the pixel grid).
  const CFX = ED.ClassFx = { ev: {}, zone: {}, hero: [], mark: [], shot: {}, on(t, f) { (this.ev[t] || (this.ev[t] = [])).push(f); } };
  // Shard colours of a smashed breakable by decor kind: [body, light, glows (a pop of the light colour)]; a mushroom's body is the stratum accent.
  const SMASH_COL = { urn: ['#8a6a50', '#c4a07c', 0], mushroom: [null, '#e8f0d0', 1], crystal: ['#8fd8f0', '#e8fbff', 1], coral: ['#e0705a', '#ffb0a0', 0], shard: ['#9a6aff', '#e0c8ff', 1], crate: ['#7a5436', '#c8501a', 0] };
  // Translate one world event into effects. local: the viewing player's pid.
  F.handle = (ev, ctx) => {
    const local = ctx.localPid, A = ED.Audio, set = ED.App ? ED.App.settings : { dmg: true };
    const xh = CFX.ev[ev.t]; if (xh) for (let i = 0; i < xh.length; i++) if (xh[i](ev, ctx, local) === true) return;
    switch (ev.t) {
      case 'hit': {
        const mine = ev.pid === local, el = ev.el | 0, ec = EL_COL[el] || '', p = ev.pid ? ctx.player(ev.pid) : null;
        if (set.dmg && (mine || ev.c || ev.v >= 20)) {
          const col = ec || (ev.c ? '#ffd36b' : ev.k ? '#ffab70' : (mine ? '#ffffff' : '#cfc6b6'));
          const size = (ev.c ? 14 : (ev.k ? 8 : 10)) + Math.min(5, Math.sqrt(ev.v) * 0.22);
          F.text(ev.x, ev.y - 6, ev.v, col, size, { crit: !!ev.c, pop: true, life: ev.c ? 1.15 : 0.85, max: ev.c ? 1.15 : 0.85, vy: ev.c ? -58 : -42, ol: EL_OL[el], sum: true, only: !!ev.fd && !ev.c }); // a fodder hit (fd) prints a number only as a crit; otherwise it adds into a number that is already up
        }
        if (!ev.k) {
          const e = foeAt(ev.x, ev.y), r = e ? e.r : 8, gy = e ? e.y : ev.y + r;
          const w = e ? U.clamp(Math.sqrt(ev.v / Math.max(1, e.maxHp)) * 1.6, 0.25, 1.4) : 0.5;
          const a = p ? Math.atan2(gy - r * 0.6 - (p.y - 10), ev.x - p.x) : Math.random() * TAU;
          if (e) hitReact(e, Math.cos(a), Math.sin(a), w, ev.c);
          const hm = hitMem[hitN++ & 7]; hm.x = ev.x; hm.y = gy; hm.a = a; hm.w = w; hm.t = F.time; hm.mine = mine;
          hitSplash(ev, e, r, gy, a, w, el, p);
          contactFx(ev, a, mine, p);
          if (ev.s) { A.impact(p ? p.cls : '', mine, el); if (ev.c) A.hit(true, mine, w, el); } else A.hit(!!ev.c, mine, w, el); // aggregated per frame by A.flush
          if (mine && (ev.c || ev.v >= 60)) F.hitStop(ev.c ? 0.06 : 0.04);
          if (mine && ev.h) F.hitStop(0.07); // heavy weapon hit
          if (mine && w > 0.75 && !ev.c) F.addShake(1);
          if (ev.v >= 100) F.punch(0.5, 0);
        } else {
          if (ev.k === 2) A.impact(p ? p.cls : '', mine, el); // a skill-zone tick rings; a status DoT (k 1) stays silent
          if (el === 1) elemHit(ev.x, ev.y + 4, 1, 0, false);
        }
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
        A.kill(ev.type, ev.r, !!(mem && mem.mine));
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
      case 'heal': if (ev.v >= 1) { F.text(ev.x, ev.y - 28, '+' + ev.v, '#86d38f', 10, { pop: true }); F.burst(ev.x, ev.y - 10, 6, { color: '#86ffa0', sp: 30, vy: -40, life: 0.7, size: 2, add: true, drag: 1, lt: '#86ffa0', ltr: 24 }); if (ev.pid === local) A.play('heal', 0.6); } break;
      case 'boom': {
        const cols = BOOM[ev.k] || BOOM.fire, fire = ev.k === 'fire' || ev.k === 'bigfire' || ev.k === 'burst', bk = ev.k === 'acid' ? lk : (n) => n;
        if (!ev.kfx) { F.ring(ev.x, ev.y, ev.r, cols[0], 0.35, 4); F.ring(ev.x, ev.y, ev.r * 0.7, cols[1], 0.22, 2); } // a hook that sets ev.kfx draws its own rings
        F.burst(ev.x, ev.y, bk(Math.min(30, 8 + ev.r / 4)), { color: cols[0], sp: ev.r * 2.6, life: 0.45, size: 3, add: true });
        F.burst(ev.x, ev.y, bk(6), { color: cols[1], sp: ev.r * 1.2, life: 0.3, size: 4, add: true });
        F.burst(ev.x, ev.y, bk(Math.min(14, 4 + ev.r / 8)), { kind: 'streak', color: cols[1], sp: ev.r * 3.2, life: 0.3, size: 1.8 });
        if (ev.k === 'shock') F.pop(ev.x, ev.y - 4, ev.r * 0.2, cols[0], 0.18); else F.pop(ev.x, ev.y - 4, ev.r * 0.8, cols[1], 0.22); // a shockwave is a ring of dust, not a white flash
        switch (ev.k) { // sprite layer: explosion clusters, shock ring, dust, ice, spore and bone bursts
          case 'bigfire': boomSheets(ev.x, ev.y, ev.r, ''); SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, delay: 0.05 }); addStain(ev.x, ev.y, ev.r * 0.5, '#120805', 0.75, 16); break;
          case 'fire': case 'burst': case 'firedamp': boomSheets(ev.x, ev.y, ev.r, ''); break;
          case 'acid': boomSheets(ev.x, ev.y, ev.r, 'poison'); break;
          case 'spore': for (let i = 0; i < 3; i++) SP('fx.smoke', ev.x + (i - 1) * ev.r * 0.3, ev.y - 8, { ramp: 'poison', delay: i * 0.05 }); break;
          case 'bone': SP('fx.burst', ev.x, ev.y - 6, { ramp: 'teal' }); break;
          case 'ice': SP('fx.ice.burst', ev.x, ev.y - 6); break;
          case 'bolt': SP('fx.blast.blue', ev.x, ev.y - 6, { add: true, ramp: 'lightning' }); break;
          case 'shock': SP('fx.ring.shock', ev.x, ev.y - 4, { add: true, ramp: 'dust' }); dust(ev.x, ev.y, 'dust', 3); break;
          case 'slam': dust(ev.x, ev.y, 'dust', ev.r >= 60 ? 5 : 3); break;
          case 'shadow': for (let i = 0; i < 3; i++) SP('fx.smoke', ev.x + (i - 1) * ev.r * 0.3, ev.y - 8, { ramp: 'shadow', delay: i * 0.05 }); break;
          default: SP('fx.burst', ev.x, ev.y - 6);
        }
        if (fire) F.burst(ev.x, ev.y, Math.min(10, 3 + ev.r / 12), { kind: 'ember', color: cols[0], sp: 60, a: -1.57, spread: 3, life: 1.0, size: 1.8, drag: 1.2, lt: cols[0], ltr: 24 });
        else if (ev.k === 'slam' || ev.k === 'shock') F.burst(ev.x, ev.y, 7, { kind: 'smoke', color: '#9a8a6a', sp: ev.r * 1.4, life: 0.7, size: 7, drag: 3 });
        if (ev.r >= 80) F.punch(0.45, 0);
        F.addShake(Math.min(7, ev.r / 18)); A.play('boom', Math.min(1, ev.r / 80));
        break;
      }
      case 'swing': {
        if (ev.pid !== local) {
          const p = ctx.player(ev.pid);
          if (p) {
            F.playerAttackAnim(ev.pid, ev.a, ev.c !== undefined && p.stats ? ED.Stats.stepWeapon(p.stats, ev.c) : null); // ev.c: the combo step, ev.sr: a slam ahead
            const col = ev.k === 'cleave' ? '#ffd36b' : ED.PLAYER_COLORS[p.slot];
            if (ev.sr) F.slam(p.x, p.y - 10, ev.a, ev.r, ev.sr, col, true); else F.slash(p.x, p.y - 10, ev.a, ev.r, ev.arc, col);
          }
          A.play(ev.k === 'cleave' || ev.sr ? 'heavy' : 'swing', ev.k === 'cleave' ? 0.5 : 0.35);
        }
        break;
      }
      case 'pull': { // a hooked weapon dragged foes toward the hero: a taut chain from the hero to each, a spark at the hook
        const p = ctx.player(ev.pid); if (!p) break;
        for (const [x, y] of ev.pts) { F.zap(p.x, p.y - 10, x, y - 8, '#c8d0da', 0.14); F.pop(x, y - 8, 7, '#e8e8e8', 0.1); }
        A.play('clang', ev.pid === local ? 0.35 : 0.15);
        break;
      }
      case 'hring': // a ring of light around the hero (Radiant Mace)
        F.ring(ev.x, ev.y, ev.r, '#ffe9a0', 0.38, 4, false, 10); F.ring(ev.x, ev.y, ev.r * 0.7, '#fff6d0', 0.26, 2, false, 6); F.pop(ev.x, ev.y - 10, 22, '#ffe9a0', 0.2);
        if (!lowFx()) F.burst(ev.x, ev.y - 8, 12, { kind: 'streak', color: '#fff3c4', sp: ev.r * 3, spread: 3.2, life: 0.25, size: 1.6 });
        A.play('bell', ev.pid === local ? 0.45 : 0.2);
        break;
      case 'atk': if (ev.pid !== local) { F.playerAttackAnim(ev.pid, ev.a); const p = ctx.player(ev.pid); if (p && p.stats && !p.stats.melee) A.play('shoot', 0.3); } break;
      case 'spark': { const c = F.projColor(ED.PROJ_KINDS[ev.k]); F.burst(ev.x, ev.y, 4, { color: c, sp: 80, life: 0.25, size: 1.8, add: true }); F.burst(ev.x, ev.y, 3, { kind: 'streak', color: c, sp: 130, life: 0.2, size: 1.3 }); F.pop(ev.x, ev.y, 7, c, 0.1); A.play('spark', 0.4); break; }
      case 'chain': { // star (hub, t1, hub, t2, ...): one forked arm per target; otherwise a plain polyline. k: h Wrath of Heaven bolt, t Twilight beam, s Superconductor discharge, b Prism beam
        const pts = ev.pts, star = pts.length >= 3 && pts[2][0] === pts[0][0] && pts[2][1] === pts[0][1], cc = ev.k === 'h' ? '#fff3a0' : ev.k === 't' ? '#d9b44a' : ev.k === 's' ? '#8fdcff' : ev.k === 'b' ? '#ffcf5a' : '#bfe9ff';
        if (star) for (let i = 1; i < pts.length; i += 2) F.zap(pts[0][0], pts[0][1], pts[i][0], pts[i][1], cc);
        else F.bolts.push({ pts, life: 0.22, max: 0.22, color: cc });
        for (let i = star ? 1 : 0; i < pts.length; i += star ? 2 : 1) F.pop(pts[i][0], pts[i][1] - 6, 9, '#cfeaff', 0.14);
        if (star) F.pop(pts[0][0], pts[0][1] - 6, 12, '#ffffff', 0.16);
        if (star) { SP('fx.blast.blue', pts[0][0], pts[0][1] - 8, { add: true, ramp: 'lightning' }); for (let i = 1; i < pts.length; i += 2) SP('fx.hit.spark', pts[i][0], pts[i][1] - 8, { add: true, ramp: 'lightning' }); } // discharge: a blast at the hub, a spark on every target
        else SP('fx.hit.spark', pts[pts.length - 1][0], pts[pts.length - 1][1] - 8, { add: true, ramp: 'lightning' });
        A.play('bolt', 0.5); break; }
      case 'bolt': F.bolts.push({ pts: [[ev.x + 10, ev.y - 220], [ev.x - 8, ev.y - 120], [ev.x + 6, ev.y - 50], [ev.x, ev.y]], life: 0.3, max: 0.3, color: '#ffffff' }); F.pop(ev.x, ev.y - 6, 38, '#e8f4ff', 0.28); F.ring(ev.x, ev.y, 42, '#bfe9ff', 0.3, 3); SP('fx.blast.blue', ev.x, ev.y - 8, { add: true, ramp: 'lightning' }); SP('fx.thunder', ev.x, ev.y - 30, { add: true, ramp: 'lightning' }); F.punch(0.8, 0.5); A.play('bolt'); F.addShake(3); break;
      case 'nova': F.ring(ev.x, ev.y, ev.r, ev.c || '#ff7a2a', 0.45, 6); F.ring(ev.x, ev.y, ev.r * 0.6, '#ffffff', 0.3, 2); F.burst(ev.x, ev.y, 26, { color: ev.c || '#ff7a2a', sp: ev.r * 3, life: 0.45, size: 3, add: true }); F.pop(ev.x, ev.y - 6, ev.r * 0.7, ev.c || '#ff7a2a', 0.25);
        { const nc = ev.c && ev.c !== '#ff7a2a' ? ev.c : ''; // flames (or ice glints) scattered along the expanding ring
          for (let i = 0, n = lowFx() ? 6 : 14; i < n; i++) { const a = Math.random() * TAU, d = ev.r * (0.55 + Math.random() * 0.4); SP(nc ? 'fx.glint' : 'fx.ember', ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d * 0.7 - 4, { ramp: nc, delay: d / ev.r * 0.25, vy: -16, add: !!nc, lt: nc ? null : '#ff8a2a', ltr: 26 }); } }
        F.punch(0.4, 0); A.play('boom', 0.6); F.addShake(4); break;
      case 'levelup': F.showBanner('Level ' + ev.level, ev.cls ? 'Choose your route when the room is clear' : ev.boon ? 'A boon awaits when the room is clear' : '', 'level', 2.2); A.play('level'); for (const p of ctx.players()) { F.burst(p.x, p.y - 10, 18, { color: '#ffd36b', sp: 80, vy: -60, life: 0.9, size: 2.2, add: true, drag: 1.5 }); F.ring(p.x, p.y, 36, '#ffd36b', 0.5, 3); SP('fx.circle.spark', p.x, p.y - 4, { ramp: 'holy', add: true }); F.pop(p.x, p.y - 12, 26, '#ffd36b', 0.3); } break;
      case 'gold': case 'xp': { // pickup sparkle on the collector, rate-limited
        const p = ctx.player(ev.pid), gold = ev.t === 'gold';
        if (p && F.time - pickT > 0.05) { pickT = F.time; const c = gold ? '#ffd36b' : '#7dffd9'; F.burst(p.x, p.y - 16, 2, { color: c, sp: 40, vy: -45, life: 0.4, size: 1.6, add: true, drag: 2.2 }); }
        if (ev.pid === local) A.play(ev.t, gold ? 0.6 : 0.5); break; }
      case 'boon': { const PF = ED.PickFx; if (PF) { const k = PF.kind(ev.id); PF.burst(F, ctx, ev, k); if (ev.pid === local) PF.heard(k, PF.big(ev.id), ev.id); } break; } // themed hero burst for everyone; the local hero's pick cue unless the card click already played it
      case 'relic': { const p = ctx.player(ev.pid), r = ED.RELICS[ev.id], PF = ED.PickFx; if (p) F.text(p.x, p.y - 40, r.name, ED.RARITY[r.rar].color, 11, { life: 1.8, max: 1.8 }); if (PF) PF.burst(F, ctx, ev, 'relic'); if (ev.pid === local) { if (PF) PF.heard('relic'); ED.UI && ED.UI.toast(`<b>${r.name}</b> — ${r.desc}`, ED.Icons.relicUrl(ev.id)); } else if (p) F.msg(`${p.name} found ${r.name}`); break; }
      case 'lock': A.play('lock'); F.addShake(4); break;
      case 'clear': A.play('unlock'); F.showBanner(ev.trial ? 'Trial complete' : 'Room cleared', '', 'small', 1.4); break;
      case 'bossIntro': F.showBanner(ev.name, ev.title, 'boss', 3.4); F.bossQuote = { text: ev.quote, t: 0 }; A.play('roar'); A.music({ s: ctx.stratum(), boss: true }); F.addShake(8); F.punch(0.9, 0); break;
      case 'bossSpawn': F.addShake(6); F.punch(0.6, 0); break;
      case 'bossDown': F.showBanner('Vanquished', ED.ENEMIES[ev.type].name, 'victory', 3); F.flash = { color: '#ffffff', t: 0.5, a: 0.5 }; F.addShake(12); F.punch(2, 1); F.hitStop(0.3); A.play('roar', 0.6); if (ev.type !== 'hollowking') A.play('victory', 0.7, 'boss'); A.music({ s: ctx.stratum() }); F.burst(ev.x, ev.y - 20, 60, { color: ED.ENEMIES[ev.type].col.c, sp: 220, life: 1.2, size: 3.5, add: true }); F.burst(ev.x, ev.y - 20, 18, { kind: 'streak', color: '#ffffff', sp: 380, life: 0.5, size: 2.4 }); F.ring(ev.x, ev.y, 160, ED.ENEMIES[ev.type].col.c, 0.8, 6); F.ring(ev.x, ev.y, 90, '#ffffff', 0.5, 3); F.pop(ev.x, ev.y - 20, 90, '#ffffff', 0.5); break;
      case 'phase': F.addShake(8); F.punch(1.6, 0.8); A.play('roar', 0.8); F.ring(ev.x, ev.y, 120, '#ffffff', 0.5, 5); F.ring(ev.x, ev.y, 70, '#ff8a5a', 0.4, 3); F.pop(ev.x, ev.y - 20, 60, '#ffffff', 0.35); break;
      case 'fury': { const en = ED.ENEMIES[ev.type]; F.addShake(5); F.punch(1.2, 0.5); A.play('fury', 0.8); F.ring(ev.x, ev.y, 130, '#ff5a1a', 0.55, 5); F.ring(ev.x, ev.y, 70, '#ffb56b', 0.4, 3); F.burst(ev.x, ev.y - 20, 36, { color: '#ff8a3d', sp: 150, vy: -40, life: 0.9, size: 2.8, add: true, drag: 1.6 }); F.pop(ev.x, ev.y - 20, 70, '#ff8a3d', 0.4); if (en) F.msg(en.name + ' is enraged!', '#ff8a3d'); break; }
      case 'stratum': { const b = ED.biomeFor(ev.s); F.showBanner(b.name, 'Stratum ' + U.roman(ev.s), 'stratum', 3.6); F.fade = 1; A.music({ s: ev.s }); break; }
      case 'room': for (const p of ctx.players()) F.sheet('fx.circle.spark', p.x, p.y + 2, { add: true, a: 0.7, speed: 1.6 }); F.fade = Math.max(F.fade, 0.6); break;
      case 'down': { const p = ctx.player(ev.pid); A.play('down'); if (p) F.msg(ev.pid === local ? 'You are down! An ally can revive you.' : `${p.name} is down! Stand near them to revive.`, '#ff8a7a'); break; }
      case 'revived': { const p = ctx.player(ev.pid); A.play('revive'); if (p) { F.msg(`${p.name} is back on their feet`, '#86d38f'); F.burst(p.x, p.y - 10, 24, { color: '#ffe9a0', sp: 70, vy: -60, life: 0.9, size: 2.4, add: true }); F.ring(p.x, p.y, 40, '#ffe9a0', 0.5, 3); SP('fx.circle.spark', p.x, p.y - 4, { ramp: 'holy', add: true }); F.pop(p.x, p.y - 12, 30, '#ffe9a0', 0.3); } break; }
      case 'dead': { const p = ctx.player(ev.pid); if (p) F.msg(`${p.name} has fallen. They return at the next stratum.`, '#ff8a7a'); break; }
      case 'rise': { const p = ctx.player(ev.pid); const name = { phoenix: 'Phoenix Feather', angel: 'Guardian Angel', wind: 'Second Wind' }[ev.k]; F.showBanner(name, p ? p.name + ' refuses to fall' : '', 'small', 2); F.burst(ev.x, ev.y - 10, 40, { color: '#ffd36b', sp: 150, life: 0.9, size: 3, add: true }); F.ring(ev.x, ev.y, 70, '#ffd36b', 0.6, 4); F.pop(ev.x, ev.y - 12, 50, '#ffd36b', 0.4); F.punch(0.8, 0.4); A.play('revive'); break; }
      case 'dash': A.play('dash', ev.pid === local ? 0.8 : 0.3); dust(ev.x, ev.y + 2, 'dust'); break;
      case 'skill': { A.play(SKILL_CUE[ev.k] || 'skill', ev.pid === local ? 1 : 0.5); const p = ctx.player(ev.pid); if (ev.k === 'charge') { dust(ev.x, ev.y + 2, 'dust', 2); F.chargeT[ev.pid] = F.time; } if (p && ev.k === 'volley') { F.ring(p.x, p.y, 30, '#e8d8b0', 0.25); SP('fx.spark.magic', p.x + Math.cos(ev.a || 0) * 20, p.y - 12 + Math.sin(ev.a || 0) * 20, { add: true, ramp: 'general' }); } if (ev.k === 'legion' || ev.k === 'sanctuary') F.ring(ev.x, ev.y, ev.k === 'sanctuary' ? 100 : 40, ev.k === 'sanctuary' ? '#ffe9a0' : '#7dffd9', 0.5, 4); if (ev.slot === 1) skill2Fx(ev, ev.pid === local, A); break; }
      case 'blink': // violet smoke rings at both ends, four fading silhouettes along the path, a few motes
        SP('fx.smoke.ring', ev.x0, ev.y0 + 2, { ramp: 'shadow' }); SP('fx.smoke.ring', ev.x1, ev.y1 + 2, { ramp: 'shadow' });
        for (let i = 0; i <= 3; i++) { const k = i / 3; SP('hero.shade.idle', U.lerp(ev.x0, ev.x1, k), U.lerp(ev.y0, ev.y1, k), { ramp: 'shadow', frame: i, life: 0.3 + 0.05 * i, fade: true, a: 0.6 }); }
        for (let i = 0; i <= 4; i++) { const k = i / 4; F.part(U.lerp(ev.x0, ev.x1, k), U.lerp(ev.y0, ev.y1, k) - 10, { color: '#b78cff', sp: 20, life: 0.5, size: 3, add: true }); }
        break;
      case 'blinkfx': F.burst(ev.x0, ev.y0 - 12, 14, { color: '#b78cff', sp: 60, life: 0.5, size: 3, add: true }); F.burst(ev.x1, ev.y1 - 12, 14, { color: '#b78cff', sp: 60, life: 0.5, size: 3, add: true }); F.pop(ev.x0, ev.y0 - 12, 20, '#b78cff', 0.2); F.pop(ev.x1, ev.y1 - 12, 20, '#b78cff', 0.2); break;
      case 'deflect': F.burst(ev.x, ev.y, 8, { color: '#ffffff', sp: 120, life: 0.25, size: 2, add: true }); F.burst(ev.x, ev.y, 4, { kind: 'streak', color: '#ffffff', sp: 200, life: 0.2, size: 1.4 }); F.pop(ev.x, ev.y, 10, '#ffffff', 0.12, true); A.play('deflect', 0.6); break;
      case 'block': F.text(ev.x, ev.y - 30, { dodge: 'Dodge', mirror: 'Shrugged off', aegis: 'Blocked' }[ev.k] || 'Blocked', '#bfe9ff', 9, { pop: true }); A.play('deflect', 0.5); break;
      // Knight events (ric, catch, parry, deflect, ward, the boom of a shockwave) are drawn by src/client/cls-knight.js through ED.ClassFx.
      case 'spawned': F.burst(ev.x, ev.y, ev.el ? 18 : 8, { color: ev.el ? '#ffb13a' : '#b8a0ff', sp: 70, life: 0.4, size: 2.4, add: true }); F.pop(ev.x, ev.y - 8, ev.el ? 30 : 20, ev.el ? '#ffb13a' : '#b8a0ff', 0.25); A.play('spawn', 0.5); break;
      case 'raise': F.burst(ev.x, ev.y, 14, { color: '#7dffd9', sp: 60, vy: -40, life: 0.6, size: 2.4, add: true }); F.ring(ev.x, ev.y, 26, '#7dffd9', 0.4, 2); SP('fx.circle.spark', ev.x, ev.y - 2, { ramp: 'teal', add: true }); SP('fx.puff', ev.x, ev.y - 4, { ramp: 'dust' }); break;
      case 'puff': F.burst(ev.x, ev.y - 8, 10, { color: ev.c || '#cccccc', sp: 50, life: 0.5, size: 3, kind: 'smoke' }); SP('fx.puff', ev.x, ev.y - 6, { ramp: ev.c || 'smoke' }); break;
      case 'thud': F.addShake(ev.big ? 9 : 3); A.play('thud', ev.big ? 1 : 0.5); dust(ev.x, ev.y, 'dust', ev.big ? 4 : 2); F.burst(ev.x, ev.y, 10, { color: '#bba98a', sp: 80, life: 0.4, size: 3, kind: 'smoke' }); if (ev.big) { F.ring(ev.x, ev.y, 60, '#c9b98f', 0.4, 4); F.punch(0.5, 0); } break;
      case 'shoot': A.play('eshoot', 0.6); break;
      case 'chest': A.play('chest'); F.burst(ev.x, ev.y - 10, 30, { color: '#ffd36b', sp: 120, vy: -60, life: 0.9, size: 2.4, add: true }); F.pop(ev.x, ev.y - 14, 40, '#ffd36b', 0.35); break;
      case 'smash': { // a breakable prop breaks (ev.k: its decor kind): light shards, a pop for the glowing kinds
        const sc = SMASH_COL[ev.k] || SMASH_COL.urn;
        A.play('smash', 0.8);
        F.burst(ev.x, ev.y - 6, 8, { kind: 'shard', color: sc[0] || ED.biomeFor(ctx.stratum()).pal.accent, sp: 105, life: 0.55, size: 2.6, vz: 100, z: 6 });
        F.burst(ev.x, ev.y - 6, 4, { kind: 'shard', color: sc[1], sp: 70, life: 0.45, size: 1.8, vz: 80, z: 6 });
        if (sc[2]) F.pop(ev.x, ev.y - 8, 18, sc[1], 0.14);
        break;
      }
      case 'buy': A.play('shop'); break; // in-run shop purchase
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
      // ---- path payoffs (own hero full size, allies at 70% size and 60% alpha; text labels for your own hero only) ----
      case 'smite': { // a gold light pillar on the foe, a ring on the ground, motes flying to the heroes it shields
        const mine = ev.pid === local, m = mine ? 1 : 0.7;
        F.beam(ev.x, ev.y, 210, 12 * m, '#ffcf5a', 0.25, mine ? 1 : 0.5, '#fff0c2'); SP('fx.circle.white', ev.x, ev.y - 2, { ramp: 'gold', add: true, a: mine ? 1 : 0.5 }); // gold ramp and a light-gold core instead of white; an ally's pillar at half alpha
        F.pop(ev.x, ev.y - 20, 32 * m, '#ffcf5a', 0.2, true, mine ? 1 : 0.5, '#fff0c2');
        F.burst(ev.x, ev.y - 8, lk(6), { color: '#ffe9a0', sp: 40, vy: -85, life: 0.7, size: 2, add: true, drag: 1 });
        if (!lowFx()) for (const p of ctx.players()) if (!p.dead && U.dist2(p.x, p.y, ev.x, ev.y) < 160 * 160) fly(ev.x, ev.y - 10, p.x, p.y, '#ffe9a0', 3);
        A.play('boon', 0.25 * m); break; }
      case 'reap': { // violet crescent, a skull rising out of the foe, sinking smoke
        const mine = ev.pid === local, m = mine ? 1 : 0.7;
        F.slash(ev.x, ev.y - 8, -0.9, 34 * m, 2.2, '#a070ff', 0.2);
        SP('deco.skull', ev.x, ev.y - 14, { ramp: 'shadow', frame: 0, life: 0.5, fade: true, vy: -24, a: mine ? 1 : 0.6 });
        F.burst(ev.x, ev.y - 8, lk(8), { kind: 'smoke', color: '#5a2fb0', sp: 40, life: 0.6, size: 6, drag: 2.5 });
        F.burst(ev.x, ev.y - 8, lk(5), { kind: 'spark', color: '#c9b3ff', sp: 150, life: 0.2, size: 1.5, drag: 5 });
        F.pop(ev.x, ev.y - 8, 24 * m, '#c9b3ff', 0.2); if (mine) F.text(ev.x, ev.y - 30, 'REAPED', '#c9b3ff', 9, { pop: true }); break; }
      case 'toll': { // a violet ring collapsing onto the boss
        const mine = ev.pid === local, m = mine ? 1 : 0.7;
        F.ring(ev.x, ev.y - 10, 90 * m, '#5a2fb0', 0.5, 6, true); F.ring(ev.x, ev.y - 10, 50 * m, '#c9b3ff', 0.4, 3, true);
        for (let i = 0, n = lowFx() ? 1 : 3; i < n; i++) SP('fx.smoke', ev.x + (i - 1) * 14, ev.y - 12, { ramp: 'shadow', delay: i * 0.06, a: mine ? 1 : 0.6 });
        F.pop(ev.x, ev.y - 12, 50 * m, '#a070ff', 0.3, true); F.addShake(3 * m); A.play('boom', 0.4 * m); break; }
      case 'beam': { // Sunlance: a straight flame line along the beam (wider with Overheat), a flash at each end
        const m = ev.pid === local ? 1 : 0.7;
        F.bolts.push({ pts: [[ev.x0, ev.y0 + 4], [ev.x1, ev.y1 + 4]], life: 0.16, max: 0.16, color: ev.w > 7 ? '#ffd36b' : '#ff9a3a', st: true }); if (F.bolts.length > 24) F.bolts.shift();
        F.pop(ev.x0, ev.y0 - 6, 14 * m, '#ffcf5a', 0.12); F.pop(ev.x1, ev.y1 - 6, 18 * m, '#ff8a2a', 0.16);
        if (!lowFx()) F.burst(ev.x1, ev.y1 - 6, 5, { kind: 'ember', color: '#ffb347', sp: 70, life: 0.4, size: 1.6, add: true });
        break; }
      case 'lance': { // a straight gold line (2 art px) from the shielded hero to the foe
        const m = ev.pid === local ? 1 : 0.7;
        F.bolts.push({ pts: [[ev.x0, ev.y0], [ev.x1, ev.y1]], life: 0.3, max: 0.3, color: '#ffcf5a', st: true }); if (F.bolts.length > 24) F.bolts.shift();
        F.pop(ev.x1, ev.y1, 16 * m, '#ffe9a0', 0.2); SP('fx.glint', ev.x1, ev.y1 - 10, { ramp: 'holy', add: true, speed: 1.2 }); A.play('bolt', 0.2 * m); break; }
      case 'shielded': { // the bubble pops in (gold for a Holy grant), then stays as the hero overlay
        const p = ctx.player(ev.pid), st = F.shieldT || (F.shieldT = {});
        if (p && F.time - (st[ev.pid] || 0) > 0.25) {
          st[ev.pid] = F.time; const holy = ev.k === 'holy', c = holy ? '#ffcf5a' : '#bfe3ff';
          if (holy) F.holyT[ev.pid] = F.time + 1.2;
          SP('fx.shield.gold', p.x, p.y - 12, { ramp: holy ? '' : 'ice', a: ev.pid === local ? 1 : 0.7, pid: ev.pid, fdy: -12 });
          F.burst(p.x, p.y - 10, 4, { color: c, sp: 24, vy: -36, life: 0.6, size: 1.8, add: true, drag: 1.2 });
          if (ev.pid === local) A.play('heal', 0.25);
        }
        break; }
      // ---- Wickdeep events (visuals only) ----
      case 'freeze': F.burst(ev.x, ev.y - 10, 12, { kind: 'streak', color: '#c8f6ff', sp: 150, life: 0.35, size: 1.6 }); F.burst(ev.x, ev.y - 10, 8, { kind: 'shard', color: '#bfeaff', sp: 70, life: 0.7, size: 2.6, vz: 70, z: 8 }); F.ring(ev.x, ev.y - 6, 28, '#9fefff', 0.35, 3); F.pop(ev.x, ev.y - 10, 22, '#bfeaff', 0.22, true); SP('fx.ice.burst', ev.x, ev.y - 8); A.play('freeze', 0.7); break;
      case 'shatter': F.burst(ev.x, ev.y - 8, 24, { kind: 'shard', color: '#d8f8ff', sp: (ev.r || 60) * 2.4, life: 0.7, size: 3, vz: 110, z: 8, add: true }); F.burst(ev.x, ev.y - 8, 14, { kind: 'streak', color: '#ffffff', sp: (ev.r || 60) * 3.4, life: 0.3, size: 1.8 }); F.ring(ev.x, ev.y, ev.r || 60, '#9fefff', 0.4, 4); F.pop(ev.x, ev.y - 8, (ev.r || 60) * 0.6, '#d8f8ff', 0.25, true); SP('fx.foam', ev.x, ev.y - 8); if ((ev.r || 60) > 80) { SP('fx.foam', ev.x - ev.r * 0.4, ev.y - 6, { delay: 0.05 }); SP('fx.foam', ev.x + ev.r * 0.4, ev.y - 6, { delay: 0.1 }); } F.punch(0.45, 0); F.addShake(3); A.play('shatter', 0.8); break;
      case 'combust': F.burst(ev.x, ev.y - 8, 18, { kind: 'ember', color: '#ffb347', sp: 90, a: -1.57, spread: 5, life: 1.0, size: 2, drag: 1.5, lt: '#ff8a2a', ltr: 26 }); F.burst(ev.x, ev.y, 16, { color: '#ff7a2a', sp: (ev.r || 70) * 2.4, life: 0.4, size: 3, add: true }); F.ring(ev.x, ev.y, ev.r || 70, '#ff8a3a', 0.4, 4); F.pop(ev.x, ev.y - 8, (ev.r || 70) * 0.7, '#ffd36b', 0.25); boomSheets(ev.x, ev.y, ev.r || 70, ''); F.punch(0.4, 0); F.addShake(3); A.play('combust', 0.8); break;
      case 'guardhit': F.burst(ev.x, ev.y - 8, 8, { kind: 'spark', color: '#ffe9b0', sp: 220, life: 0.25, size: 1.6, drag: 5 }); F.pop(ev.x, ev.y - 8, 12, '#ffffff', 0.14, true); F.ring(ev.x, ev.y - 8, 16, '#e8e2c8', 0.18, 2); A.play('guardhit', 0.7); break;
      case 'ambush': { const p = ctx.player(ev.pid); const x = ev.x !== undefined ? ev.x : (p ? p.x : 0), y = ev.y !== undefined ? ev.y : (p ? p.y : 0); F.slash(x, y - 8, 0.8, 34, 0.5, '#d9c8ff', 0.2); F.slash(x, y - 8, -0.8, 34, 0.5, '#d9c8ff', 0.2); F.burst(x, y - 8, 14, { color: '#b78cff', sp: 130, life: 0.4, size: 2.6, add: true }); F.pop(x, y - 8, 30, '#b78cff', 0.25, true); F.punch(0.6, 0.3); A.play('ambush', ev.pid === local ? 0.9 : 0.5); if (ev.pid === local) F.hitStop(0.07); break; }
      case 'evolve': { const p = ctx.player(ev.pid), col = PATH_COL[ev.path] || '#ffd36b', x = ev.x !== undefined ? ev.x : (p ? p.x : 0), y = ev.y !== undefined ? ev.y : (p ? p.y : 0);
        F.ring(x, y, 120, col, 0.8, 5); F.ring(x, y, 70, '#ffffff', 0.55, 3); F.ring(x, y, 40, col, 0.4, 2);
        F.burst(x, y - 12, 44, { color: col, sp: 110, a: -1.57, spread: 4.4, life: 1.2, size: 2.6, add: true, drag: 1.2 });
        F.burst(x, y - 12, 14, { kind: 'streak', color: '#ffffff', sp: 320, life: 0.5, size: 2 });
        F.pop(x, y - 14, 80, col, 0.5, true); F.punch(1.2, 0.9); F.addShake(5); A.play('evolve', ev.pid === local ? 1 : 0.6); if (ev.pid === local) F.flash = { color: col, t: 0.3, a: 0.3 }; break; }
      case 'forkRank': { // a fork ranked up at a boss (rank 3 = the transform): rings and rising sparks on the hero for everyone, a flash and the evolve cue for the owner
        const p = ctx.player(ev.pid), big = ev.rank >= 3, col = big ? '#ffd36b' : '#ffe9b0', x = ev.x !== undefined ? ev.x : (p ? p.x : 0), y = ev.y !== undefined ? ev.y : (p ? p.y : 0), mine = ev.pid === local;
        F.ring(x, y, big ? 110 : 70, col, 0.7, big ? 5 : 3); F.ring(x, y, big ? 64 : 40, '#ffffff', 0.45, 2);
        F.burst(x, y - 12, big ? 36 : 20, { color: col, sp: 100, a: -1.57, spread: 4.4, life: 1.0, size: 2.6, add: true, drag: 1.2 });
        F.burst(x, y - 12, big ? 12 : 6, { kind: 'streak', color: '#ffffff', sp: 300, life: 0.4, size: 1.8 });
        F.pop(x, y - 14, big ? 70 : 44, col, 0.4, true);
        F.text(x, y - 42, ED.cardName(ev.id, ev.rank), col, big ? 13 : 11, { pop: true, life: 1.8, max: 1.8, vy: -20 });
        if (mine) { F.punch(big ? 1.1 : 0.6, big ? 0.7 : 0.4); F.addShake(big ? 4 : 2); F.flash = { color: col, t: 0.3, a: big ? 0.3 : 0.18 }; }
        A.play('evolve', mine ? (big ? 1 : 0.7) : 0.4); break; }
      case 'howl': F.ring(ev.x, ev.y - 8, ev.r || 200, '#e8d8b0', 0.6, 4); F.ring(ev.x, ev.y - 8, (ev.r || 200) * 0.5, '#ffffff', 0.4, 2); F.burst(ev.x, ev.y - 14, 10, { kind: 'streak', color: '#e8d8b0', sp: (ev.r || 200) * 1.4, life: 0.4, size: 1.6 }); F.pop(ev.x, ev.y - 14, 24, '#e8d8b0', 0.25); F.addShake(2); A.play('howl', 0.7); break;
      case 'rift': F.burst(ev.x, ev.y - 12, 16, { color: '#b78cff', sp: 90, life: 0.6, size: 2.6, add: true }); F.burst(ev.x, ev.y - 12, 8, { kind: 'streak', color: '#e8c8ff', a: -1.57, spread: 3.1, sp: 200, life: 0.35, size: 1.6 }); F.burst(ev.x, ev.y - 6, 5, { kind: 'smoke', color: '#1a0830', sp: 30, life: 0.8, size: 7 }); F.ring(ev.x, ev.y, 30, '#b78cff', 0.45, 3); F.pop(ev.x, ev.y - 14, 34, '#c98bff', 0.3, true); A.play('rift', 0.6); break;
      case 'claim': { const col = R().rewardColor(ev.item), mine = ev.pid === local, y = ev.y - 18; F.burst(ev.x, y, mine ? 22 : 14, { color: col, sp: 80, vy: -50, life: 0.9, size: 2.4, add: true, drag: 1.3 }); F.ring(ev.x, ev.y - 8, 34, col, 0.5, 3); F.pop(ev.x, y, 28, col, 0.3);
        if (ev.item === 'campfire') F.burst(ev.x, y, 8, { kind: 'ember', color: '#ffb347', a: -1.57, spread: 2.4, sp: 50, life: 1.1, size: 2, drag: 1.4, lt: '#ff8a2a', ltr: 24 });
        if (mine) F.text(ev.x, y - 14, R().rewardLabel(ev.item), col, 10, { life: 1.3, max: 1.3 });
        A.play('claim', mine ? 0.9 : 0.4); break; }
      case 'dark': F.msg('Dark room: harder fights, richer rewards', '#a070ff'); F.addShake(1); if (!calm()) F.flash = { color: '#0a0418', t: 0.5, a: 0.4 }; A.play('dark', 0.8); break;
      case 'upgrade': { const col = R().rewardColor(ev.to); F.ring(ev.x, ev.y - 8, 44, col, 0.6, 4); F.burst(ev.x, ev.y - 14, 18, { color: col, sp: 80, vy: -50, life: 0.9, size: 2.4, add: true, drag: 1.3 }); F.msg('The dark pays more: ' + R().rewardLabel(ev.to), '#ffd36b'); break; }
      case 'ward': F.ring(ev.x, ev.y - 10, 24, '#7fc8ff', 0.4, 3); F.burst(ev.x, ev.y - 10, 8, { color: '#bfe3ff', sp: 50, vy: -30, life: 0.6, size: 2, add: true, drag: 1.5 }); F.pop(ev.x, ev.y - 12, 22, '#7fc8ff', 0.25); break;
      default: break;
    }
  };

  // ---------- drawing (world space) ----------
  // Lit pass: stains, non-additive particles (smoke, shards, ash, drops); registers lights for flares and bright particles.
  F.drawWorld = (c) => {
    const Rn = R();
    for (const s of F.stains) { c.globalAlpha = s.a * Math.min(1, s.life / 2); Pix.put(c, stainSprite(s), s2(s.x), s2(s.y + 2)); }
    c.globalAlpha = 1;
    let nl = 0;
    for (const p of F.parts) { // pixel particles: 2 / 4 / 6 px squares on the art grid, shards tumble between wide and tall
      const k = p.life / p.max;
      if (p.lt && nl < 14) { nl++; Rn.light(p.x, p.y - p.z, p.ltr, p.lt, 0.75 * Math.min(1, k * 1.5)); }
      if (p.add) continue;
      const y = p.y - p.z;
      if (p.kind === 'smoke') { Pix.put(c, Pix.puff(Math.max(2, Math.round(p.size * (2 - k) * 0.55)), p.color), s2(p.x), s2(y), k * 0.42); continue; }
      c.globalAlpha = p.kind === 'ash' ? Math.min(1, k * 2) * 0.8 : Math.min(1, k * 1.5);
      c.fillStyle = p.color;
      const sz = p.size * (0.4 + 0.6 * k), q = sz < 1.7 ? 2 : sz < 3.2 ? 4 : 6;
      if (p.kind === 'shard' || p.kind === 'ash') { const t2 = Math.max(2, q - 2), wide = Math.sin(p.rot) > 0, w = wide ? q : t2, h = wide ? t2 : q; c.fillRect(s2(p.x - w / 2), s2(y - h / 2), w, h); }
      else c.fillRect(s2(p.x - q / 2), s2(y - q / 2), q, q);
    }
    c.globalAlpha = 1;
    for (const s of F.sheets) if (s.lt && s.t >= 0) { const fa = s.fade && s.life ? 1 - s.t / s.life : 1; Rn.light(s.x, s.y + s.dy, s.ltr, s.lt, 0.8 * fa); }
    // dying foes: the posed snapshot (white silhouette for the first frames); spirit-family ghosts are drawn additively in drawGlow instead
    for (const g of F.ghosts) {
      if (g.k === 'die' && g.at) { // atlas ghost (white while the hit flash lasts); spirit ghosts are drawn additively in drawGlow
        const u = g.max - g.life, P = ghostPoseA(g, u);
        if (P.add || P.a <= 0.01) continue;
        c.save(); c.translate(Math.round(g.x), Math.round(g.y)); Rn.shadow(c, g.r, 0.35 * P.a);
        c.translate(P.dx, P.dy); if (P.rot) c.rotate(P.rot); if (P.sx !== 1 || P.sy !== 1) c.scale(P.sx, P.sy);
        ED.Actors.drawSnap(c, g.at, !g.at.death && u < 0.06, P.a, u);
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
    for (const b of F.beams) Rn.light(b.x, b.y - 30, 90, b.col, 0.9 * (b.life / b.max));
    for (const p of F.pops) Rn.light(p.x, p.y, p.r * 3.2, p.color, 0.9 * (p.life / p.max));
    for (const r of F.rings) { const k = 1 - r.life / r.max; if (r.r > 40) Rn.light(r.x, r.y, (r.r0 !== undefined ? r.r0 + (r.r - r.r0) * k : r.r * (0.3 + 0.7 * U.easeOut(k))) * 1.2, r.color, 0.5 * (1 - k)); }
    for (const b of F.bolts) { const k = b.life / b.max; for (let i = 1; i < b.pts.length; i += 2) Rn.light(b.pts[i][0], b.pts[i][1] - 10, 60, b.color, 0.8 * k); }
    for (const s of F.slashes) Rn.light(s.x + Math.cos(s.a) * s.r * 0.6, s.y + Math.sin(s.a) * s.r * 0.6, s.r * 1.1, s.color, 0.5 * (s.life / s.max));
  };

  // Additive pixel squares are collected per (colour, side, alpha step 1/4) by Pix.sq and filled as one path each by Pix.flush; the pass is additive, so order does not matter.
  const rectAdd = Pix.sq, rectFlush = Pix.flush;
  const bjx = [], bjy = []; // jittered bolt points of the current bolt
  // Draws a sprite effect (frame by age, alpha stepped in quarters while it fades).
  function drawSheet(c, s) {
    if (s.t < 0) return;
    const f = s.fixed >= 0 ? s.fixed : s.loop ? ((s.t * s.fps) | 0) % s.n : Math.min(s.n - 1, (s.t * s.fps) | 0);
    let a = s.a; if (s.fade && s.life) a *= Math.max(0.25, Math.ceil((1 - s.t / s.life) * 4) / 4);
    if (s.add) a *= F.addK;
    Pix.draw(c, s.id, s.ramp, f, s2(s.x), s2(s.y + s.dy), a, s.flip, s.rot + s.spin * s.t);
  }
  // Unlit pass (after the lighting multiply, before the additive one): opaque sprite effects keep their colours in any light.
  F.drawSprites = (c) => { for (const s of F.sheets) if (!s.add) drawSheet(c, s); };
  // Emissive pass (context is in 'lighter'): slashes, rings, glowing particles, streaks, pops, bolts, ghosts.
  F.drawGlow = (c, t) => {
    const Rn = R(), Sp = ED.Sprites;
    const px = ED.Actors && ED.Actors.on();
    if (px) drawSmears(c);
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
    for (const r of F.rings) { // pixel ring: radius in steps of 2 art px, 1-3 px thick, bands element / light / white, alpha in quarters
      const k = 1 - r.life / r.max, rr = r.r0 !== undefined ? r.r0 + (r.r - r.r0) * k : r.inv ? r.r * (1 - 0.75 * U.easeOut(k)) : r.r * (0.3 + 0.7 * U.easeOut(k)), ra =Math.max(2, Math.round(rr / 4) * 2), tn = Math.max(1, Math.min(3, Math.round(r.w * (1 - k) * 0.5 + 0.5))), rp = Pix.ramp(r.color);
      Pix.put(c, Pix.ring(ra, tn, rp[2], rp[3], rp[4]), s2(r.x), s2(r.y), Math.max(0.25, Math.ceil((1 - k) * 4) / 4));
    }
    const ak = F.addK; // additive strength set by the renderer per biome
    for (const p of F.pops) {
      const k = p.life / p.max, e = 1 - k, sz = p.r * (0.5 + 0.8 * U.easeOut(e)), pa = p.al * ak;
      Rn.glow(c, p.x, p.y, sz * 1.6, p.color, 0.85 * k * pa);
      const d = k > 0.55 ? 4 : 2, o = d >> 1 & ~1; c.globalAlpha = 0.95 * k * pa; c.fillStyle = p.core; c.fillRect(s2(p.x) - o, s2(p.y) - o, d, d);
      if (p.star) { const L = Math.max(4, s2(sz * 1.5)); c.globalAlpha = 0.9 * k * pa; c.fillRect(s2(p.x) - L, s2(p.y), L * 2, 2); c.fillRect(s2(p.x), s2(p.y) - L, 2, L * 2); }
      c.globalAlpha = 1;
    }
    for (const b of F.beams) { // light pillar: element edge, light body, core stripe (white unless b.core says otherwise); narrows and fades in quarter steps
      const k = b.life / b.max, w = Math.max(4, s2(b.w * (0.35 + 0.65 * k))), x = s2(b.x), top = s2(b.y - b.h), h = s2(b.h), a = Math.max(0.25, Math.ceil(k * 4) / 4) * b.al * ak, rp = Pix.ramp(b.col);
      c.globalAlpha = 0.7 * a; c.fillStyle = rp[2]; c.fillRect(x - w / 2, top, w, h);
      c.globalAlpha = a; c.fillStyle = rp[3]; c.fillRect(x - w / 2 + 2, top, Math.max(2, w - 4), h);
      c.fillStyle = b.core; c.fillRect(x - Math.max(1, (w - 8) / 2), top, Math.max(2, w - 8), h);
      c.globalAlpha = 1;
    }
    let gl = 0; // glow blits of embers and dots, capped per frame
    for (const p of F.parts) {
      if (!p.add) continue;
      const k = p.life / p.max, y = p.y - p.z, a = Math.min(1, k * 1.5);
      if (p.kind === 'streak') { // white head and up to two trailing squares along the motion
        const sp = Math.hypot(p.vx, p.vy), l = Math.min(26, sp * 0.05 + 2), ux = sp > 1 ? p.vx / sp : 0, uy = sp > 1 ? p.vy / sp : 0, w = p.size > 2 ? 4 : 2, n = l > 12 ? 3 : l > 5 ? 2 : 1;
        rectAdd('#ffffff', a, p.x, y, w);
        for (let i = 1; i < n; i++) rectAdd(p.color, a * (1 - i * 0.3), p.x - ux * l * i / n, y - uy * l * i / n, w);
      } else if (p.kind === 'spark') {
        const sp = Math.hypot(p.vx, p.vy), ux = sp > 1 ? p.vx / sp : 0, uy = sp > 1 ? p.vy / sp : 0;
        rectAdd(p.color, a, p.x, y, 2);
        if (sp > 60) rectAdd(p.color, a * 0.55, p.x - ux * 4, y - uy * 4, 2);
      } else if (p.kind === 'ember') {
        rectAdd(p.color, Math.min(1, k * 1.6) * (0.6 + 0.4 * Math.sin(p.rot * 5)), p.x, y, 2);
        if (gl < 24) { gl++; Rn.glow(c, p.x, y, p.size * 3, p.color, 0.5); }
      } else if (p.kind === 'shard') rectAdd(p.color, a, p.x, y, p.size < 3.2 ? 2 : 4);
      else {
        const sz = p.size * (0.4 + 0.6 * k);
        rectAdd(p.color, a, p.x, y, sz < 1.7 ? 2 : sz < 3.2 ? 4 : 6);
        if (sz > 1.6 && gl < 24) { gl++; Rn.glow(c, p.x, y, sz * 3, p.color, 0.3); }
      }
    }
    rectFlush(c);
    c.globalAlpha = 1;
    // lightning: a jagged pixel line (interior points shimmer on the grid): halo, body, white core
    for (const b of F.bolts) {
      const k = b.life / b.max, n = b.pts.length;
      for (let i = 0; i < n; i++) { const pt = b.pts[i], mid = !b.st && i && i < n - 1; bjx[i] = pt[0] + (mid ? ((Math.random() * 5) | 0) * 2 - 4 : 0); bjy[i] = pt[1] - 10 + (mid ? ((Math.random() * 5) | 0) * 2 - 4 : 0); }
      for (let L = 0; L < 3; L++) {
        c.globalAlpha = L === 0 ? 0.35 * k : k; c.fillStyle = L === 2 ? '#ffffff' : b.color; c.beginPath();
        for (let i = 1; i < n; i++) Pix.line(c, bjx[i - 1], bjy[i - 1], bjx[i], bjy[i], L === 0 ? 6 : L === 1 ? 4 : 2);
        c.fill();
      }
      c.globalAlpha = 1;
      Rn.glow(c, bjx[0], bjy[0], 12, b.color, 0.5 * k); Rn.glow(c, bjx[n - 1], bjy[n - 1], 12, b.color, 0.5 * k);
    }
    for (const s of F.sheets) if (s.add) drawSheet(c, s);
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
