// Visual and audio feedback: particles, slashes, damage numbers, impact pops, ghosts, banners, shake, hit-stop.
// World events (from the local sim or the host's snapshots) are translated into effects here. Drawing is split in two:
// drawWorld (lit with the scene, also registers lights) and drawGlow (emissive, additive, after lighting so bloom catches it).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  let hsUntil = 0; // wall-clock end of the current hit-stop
  const F = ED.FX = {
    parts: [], texts: [], slashes: [], rings: [], bolts: [], pops: [], ghosts: [], stains: [], msgs: [], banner: null, shake: 0, flash: null, fade: 0, anim: {}, hitstop: 0, time: 0, aberr: 0, kick: 0, dread: 0,
    // 1 normally, ~0.06 during a hit-stop; consumers (game loop) multiply their dt by it. Wall-clock based, so it is safe however dt is scaled.
    get timeScale() { return performance.now() / 1000 < hsUntil ? 0.06 : 1; },
    set timeScale(v) { /* derived value; assignments are ignored */ },
  };
  let MAXP = 500, lastHs = 0;
  const calm = () => !!(ED.App && ED.App.settings && !ED.App.settings.shake); // "screen shake off" also mutes flashes and hit-stop

  F.reset = () => { F.parts.length = 0; F.texts.length = 0; F.slashes.length = 0; F.rings.length = 0; F.bolts.length = 0; F.pops.length = 0; F.ghosts.length = 0; F.stains.length = 0; F.msgs.length = 0; F.banner = null; F.shake = 0; F.flash = null; F.anim = {}; F.aberr = 0; F.kick = 0; F.dread = 0; hsUntil = 0; };
  F.setQuality = (q) => { MAXP = q === 'low' ? 180 : 500; };

  // opts: a (angle), spread (random +- around a), sp, life, size, color, kind (dot|shard|smoke|streak|ember|drop|ash|spark), add, lt (light colour), ltr (light radius)
  // spOv/lifeOv replace o.sp/o.life (burst jitter). Dead particles are recycled through ppool; when full, a rotating slot is overwritten.
  const ppool = []; let evict = 0;
  F.part = (x, y, o, spOv, lifeOv) => {
    const ps = F.parts; let p;
    if (ps.length >= MAXP) { evict = (evict + 1) % ps.length; p = ps[evict]; }
    else { p = ppool.pop() || { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, size: 0, color: '', kind: '', grav: 0, drag: 0, add: false, z: 0, vz: 0, rot: 0, lt: null, ltr: 0 }; ps.push(p); }
    const a = o.a !== undefined ? o.a + (o.spread ? (Math.random() - 0.5) * o.spread : 0) : Math.random() * TAU;
    const sp = spOv !== undefined ? spOv : o.sp !== undefined ? o.sp : 40 + Math.random() * 80;
    const life = lifeOv !== undefined ? lifeOv : (o.life || 0.5), kind = o.kind || 'dot';
    p.x = x; p.y = y; p.vx = Math.cos(a) * sp + (o.vx || 0); p.vy = Math.sin(a) * sp + (o.vy || 0);
    p.life = life; p.max = life; p.size = o.size || 2; p.color = o.color || '#fff'; p.kind = kind; p.grav = o.grav || 0; p.drag = o.drag !== undefined ? o.drag : 3;
    p.add = o.add !== undefined ? o.add : (kind === 'streak' || kind === 'ember' || kind === 'spark');
    p.z = o.z || 0; p.vz = o.vz || 0; p.rot = Math.random() * 6; p.lt = o.lt || null; p.ltr = o.ltr || 28;
  };
  F.burst = (x, y, n, o) => { const k = MAXP < 300 ? Math.ceil(n / 2) : n, sp = o.sp || 90, life = o.life || 0.5; for (let i = 0; i < k; i++) F.part(x, y, o, sp * (0.4 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6)); };
  const NO_OPTS = {};
  F.text = (x, y, s, color, size, opts) => {
    if (F.texts.length > 80) F.texts.shift();
    // numbers born in the same spot stack upward instead of overprinting
    let yy = y; for (const t of F.texts) if (t.max - t.life < 0.3 && Math.abs(t.x - x) < 24 && Math.abs(t.y - yy) < 9) yy = t.y - 9;
    const o = opts || NO_OPTS; // opts: crit, pop, life, max, vy
    F.texts.push({ x: x + (Math.random() - 0.5) * 10, y: yy, s: String(s), color, size: size || 10, life: o.life ?? 0.9, max: o.max ?? 0.9, vy: o.vy ?? -42, crit: !!o.crit, pop: !!o.pop });
  };
  F.ring = (x, y, r, color, life, width) => F.rings.push({ x, y, r, color, life: life || 0.4, max: life || 0.4, w: width || 3 });
  F.slash = (x, y, a, r, arc, color, life) => F.slashes.push({ x, y, a, r, arc, color, life: life || 0.16, max: life || 0.16 });
  // Bright impact flash that also lights the scene. star: flare lines (crits).
  F.pop = (x, y, r, color, life, star) => { if (F.pops.length < 40) F.pops.push({ x, y, r, color, life: life || 0.16, max: life || 0.16, star: !!star }); };
  F.addShake = (v) => { if (ED.App && !ED.App.settings.shake) return; F.shake = Math.min(12, F.shake + v); };
  // Chromatic-aberration / white-flash punch for the post pass (0..~2 / 0..1.2).
  F.punch = (aberr, kick) => { if (calm()) return; F.aberr = Math.max(F.aberr, aberr || 0); F.kick = Math.max(F.kick, kick || 0); };
  // Brief time dip; read FX.timeScale. At most one every 0.22 s so rapid hits never stall the game.
  F.hitStop = (sec) => { const now = performance.now() / 1000; if (calm() || now - lastHs < 0.22) return; lastHs = now; hsUntil = now + Math.min(0.3, sec); };
  F.msg = (text, color) => { F.msgs.push({ text, color: color || '#f0e5d3', t: 4 }); if (F.msgs.length > 5) F.msgs.shift(); };
  F.showBanner = (title, sub, style, dur) => { F.banner = { title, sub: sub || '', style: style || 'small', t: 0, dur: dur || 2.6 }; };

  // Ages every entry by dt and drops the expired ones in place (order and array identity kept, nothing allocated).
  const tick = (a, dt) => { let n = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; o.life -= dt; if (o.life > 0) a[n++] = o; } a.length = n; };

  F.update = (dt) => {
    F.time += dt;
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
      if (p.vz || p.z) { p.vz -= 300 * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; } }
      p.rot += dt * 6;
      ps[n++] = p;
    }
    ps.length = n;
    const ts = F.texts; n = 0;
    for (let i = 0; i < ts.length; i++) { const t = ts[i]; t.life -= dt; if (t.life <= 0) continue; t.y += t.vy * dt; t.vy *= Math.max(0, 1 - 2.5 * dt); ts[n++] = t; }
    ts.length = n;
    tick(F.slashes, dt); tick(F.rings, dt); tick(F.bolts, dt); tick(F.pops, dt); tick(F.ghosts, dt); tick(F.stains, dt);
    const ms = F.msgs; n = 0;
    for (let i = 0; i < ms.length; i++) { const m = ms[i]; m.t -= dt; if (m.t > 0) ms[n++] = m; }
    ms.length = n;
    if (F.banner) { F.banner.t += dt; if (F.banner.t > F.banner.dur) F.banner = null; }
    for (const k in F.anim) F.anim[k].atkT = (F.anim[k].atkT || 9) + dt;
    if (F.fade > 0) F.fade = Math.max(0, F.fade - dt * 2.2);
  };

  F.playerAttackAnim = (pid, a) => {
    const an = F.anim[pid] || (F.anim[pid] = { atkT: 9, side: 1 });
    an.atkT = 0; an.side = -an.side; an.a = a;
  };

  // Called by the renderer for every hero each frame: leaves a fading copy behind while dashing.
  F.dashTrail = (p) => {
    if (!p.dashing || p.dead || p.downed || R().quality === 'low') return;
    if (F.time - (p.ghostT === undefined ? -1 : p.ghostT) < 0.035) return;
    p.ghostT = F.time;
    if (F.ghosts.length < 28) F.ghosts.push({ k: 'dash', x: p.x, y: p.y, cls: p.cls, slot: p.slot, weapon: p.weapon, face: p.face, life: 0.26, max: 0.26 });
  };

  const R = () => ED.Render;
  const ENEMY_COLOR = (type) => { const d = ED.ENEMIES[type]; return d ? d.col.a : '#ffffff'; };
  const EL_COL = ['', '#ff9a3a', '#9fefff', '#ffe66b', '#ff4a5a']; // el: 0 physical, 1 pyre, 2 rime, 3 storm, 4 bleed
  const PATH_COL = { pyre: '#ff7a2a', rime: '#7fe3ff', storm: '#ffe66b', steel: '#d9dfe8', blood: '#d43a5a', spirit: '#b78cff' };
  const PROJ_COLOR = { bone: '#e6dfc9', spore: '#9cff6a', ice: '#9fefff', fire: '#ff8a2a', water: '#6fe6ff', void: '#d48cff', arrow: '#e8d8b0', bolt: '#cfd6de', firebolt: '#ff9a3a', spark: '#ffcf4a', fireball: '#ff6a1a', knife: '#d9dfe8', holy: '#ffe9a0', soul: '#7dffd9', plague: '#9cff6a', wave: '#ffe9a0', wisp: '#bff0ff', shard: '#b78cff', blade: '#cfd6de', orb: '#ff7ad9', trident: '#e8c66b', skull: '#e6dfc9',
    hammer: '#ffe9a0', crescent: '#ff9a3a', iceshard: '#9fefff', bloodscythe: '#d43a5a', spectral: '#bcd0ff', web: '#e8e6f0', droneshot: '#ff9a3a', thorn: '#9cff6a' };
  F.projColor = (k) => PROJ_COLOR[k] || '#ffffff';
  const BOOM = { fire: ['#ff9a3a', '#ffcf4a'], bigfire: ['#ff6a1a', '#ffd36b'], shock: ['#e8e2c8', '#ffffff'], slam: ['#c9b98f', '#ffffff'], spore: ['#9cff6a', '#e8ffd0'], ice: ['#9fefff', '#ffffff'], bolt: ['#bfe9ff', '#ffffff'], bone: ['#7dffd9', '#e6dfc9'], burst: ['#ff6a4a', '#ffd36b'], shadow: ['#b78cff', '#2a1f44'] };

  // Elemental flavour on a hit: embers, ice glints, sparks or blood.
  function elemHit(x, y, el, a, crit) {
    if (F.parts.length > MAXP * 0.8) return;
    const n = crit ? 2 : 1;
    if (el === 1) F.burst(x, y, 3 * n, { kind: 'ember', color: '#ff9a3a', sp: 40, a: -1.57, spread: 2.4, life: 0.8, size: 1.8, drag: 1.5, lt: '#ff8a2a', ltr: 22 });
    else if (el === 2) { F.burst(x, y, 4 * n, { kind: 'streak', color: '#c8f6ff', a, spread: 2.8, sp: 150, life: 0.3, size: 1.4 }); F.burst(x, y, 2 * n, { kind: 'dot', color: '#ffffff', sp: 30, life: 0.6, size: 1.3, add: true, drag: 2 }); }
    else if (el === 3) { F.burst(x, y, 4 * n, { kind: 'spark', color: '#fff3a0', sp: 190, life: 0.2, size: 1.6, drag: 5 }); if (F.bolts.length < 8) F.bolts.push({ pts: [[x - 7, y - 5], [x - 1, y + 2], [x + 5, y - 4], [x + 9, y + 3]], life: 0.1, max: 0.1, color: '#ffe66b' }); }
    else if (el === 4) F.burst(x, y, 5 * n, { kind: 'drop', color: '#a8142c', a, spread: 2.2, sp: 100, life: 0.5, size: 1.8, grav: 220, drag: 2 });
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
          F.text(ev.x, ev.y - 6, ev.v, col, size, { crit: !!ev.c, pop: true, life: ev.c ? 1.15 : 0.85, max: ev.c ? 1.15 : 0.85, vy: ev.c ? -58 : -42 });
        }
        if (!ev.k) {
          const a = p ? Math.atan2(ev.y - (p.y - 6), ev.x - p.x) : Math.random() * TAU, col = ec || (ev.c ? '#ffd36b' : '#ffffff');
          F.burst(ev.x, ev.y + 6, ev.c ? 8 : 4, { kind: 'streak', color: col, a, spread: 1.1, sp: ev.c ? 260 : 190, life: 0.22, size: ev.c ? 2.2 : 1.5 });
          F.pop(ev.x, ev.y + 4, ev.c ? 15 : 8, col, ev.c ? 0.2 : 0.12, ev.c);
          if (ev.c) F.ring(ev.x, ev.y + 4, 20, col, 0.22, 2);
          elemHit(ev.x, ev.y + 4, el, a, ev.c);
          A.play(ev.c ? 'crit' : 'hit', mine ? 1 : 0.5);
          if (mine && (ev.c || ev.v >= 60)) F.hitStop(ev.c ? 0.06 : 0.04);
          if (ev.v >= 100) F.punch(0.5, 0);
        } else if (el === 1) elemHit(ev.x, ev.y + 4, 1, 0, false);
        if (ev.c && mine) { F.addShake(2.5); F.punch(0.35, 0); }
        break;
      }
      case 'die': {
        const col = ENEMY_COLOR(ev.type), big = ev.el || ev.r > 14, d = ED.ENEMIES[ev.type];
        F.burst(ev.x, ev.y - 6, big ? 26 : 12, { color: col, sp: big ? 150 : 110, life: 0.6, size: big ? 3.4 : 2.6, kind: 'shard', vz: 120, z: 6 });
        F.burst(ev.x, ev.y - 6, big ? 14 : 7, { color: col, sp: 22, vy: -50, life: 1.0, size: 1.8, kind: 'dot', add: true, drag: 1.4, lt: big ? col : null, ltr: 26 });
        F.burst(ev.x, ev.y - 6, 6, { color: '#000000', sp: 40, life: 0.8, size: 6, kind: 'smoke', drag: 2 });
        F.burst(ev.x, ev.y - 4, 4, { color: '#5a5048', sp: 36, vy: -20, life: 1.2, size: 1.6, kind: 'ash', grav: 24, drag: 1.2 });
        F.pop(ev.x, ev.y - 8, big ? 26 : 14, col, 0.2);
        if (d) F.ghosts.push({ k: 'die', x: ev.x, y: ev.y, type: ev.type, r: ev.r || d.r, life: 0.45, max: 0.45 });
        if (F.stains.length < 24) F.stains.push({ x: ev.x, y: ev.y, r: (ev.r || 10) * 1.25, life: 6, max: 6, col });
        A.play('die', 0.7);
        if (big) { F.ring(ev.x, ev.y, 30, col, 0.4); F.addShake(3); F.hitStop(0.06); }
        break;
      }
      case 'hurt': {
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
        if (ev.pid !== local) { const p = ctx.player(ev.pid); if (p) F.slash(p.x, p.y - 10, ev.a, ev.r, ev.arc, ED.PLAYER_COLORS[p.slot]); A.play('swing', 0.35); }
        break;
      }
      case 'atk': if (ev.pid !== local) { F.playerAttackAnim(ev.pid, ev.a); const p = ctx.player(ev.pid); if (p && p.stats && !p.stats.melee) A.play('shoot', 0.3); } break;
      case 'spark': { const c = F.projColor(ED.PROJ_KINDS[ev.k]); F.burst(ev.x, ev.y, 4, { color: c, sp: 80, life: 0.25, size: 1.8, add: true }); F.burst(ev.x, ev.y, 3, { kind: 'streak', color: c, sp: 130, life: 0.2, size: 1.3 }); F.pop(ev.x, ev.y, 7, c, 0.1); A.play('spark', 0.4); break; }
      case 'chain': { // star (hub, t1, hub, t2, ...): one forked arm per target; otherwise a plain polyline
        const pts = ev.pts, star = pts.length >= 3 && pts[2][0] === pts[0][0] && pts[2][1] === pts[0][1];
        if (star) for (let i = 1; i < pts.length; i += 2) F.zap(pts[0][0], pts[0][1], pts[i][0], pts[i][1], '#bfe9ff');
        else F.bolts.push({ pts, life: 0.22, max: 0.22, color: '#bfe9ff' });
        for (let i = star ? 1 : 0; i < pts.length; i += star ? 2 : 1) F.pop(pts[i][0], pts[i][1] - 6, 9, '#cfeaff', 0.14);
        if (star) F.pop(pts[0][0], pts[0][1] - 6, 12, '#ffffff', 0.16);
        A.play('bolt', 0.5); break; }
      case 'bolt': F.bolts.push({ pts: [[ev.x + 10, ev.y - 220], [ev.x - 8, ev.y - 120], [ev.x + 6, ev.y - 50], [ev.x, ev.y]], life: 0.3, max: 0.3, color: '#ffffff' }); F.pop(ev.x, ev.y - 6, 38, '#e8f4ff', 0.28); F.ring(ev.x, ev.y, 42, '#bfe9ff', 0.3, 3); F.punch(0.8, 0.5); A.play('bolt'); F.addShake(3); break;
      case 'nova': F.ring(ev.x, ev.y, ev.r, ev.c || '#ff7a2a', 0.45, 6); F.ring(ev.x, ev.y, ev.r * 0.6, '#ffffff', 0.3, 2); F.burst(ev.x, ev.y, 26, { color: ev.c || '#ff7a2a', sp: ev.r * 3, life: 0.45, size: 3, add: true }); F.pop(ev.x, ev.y - 6, ev.r * 0.7, ev.c || '#ff7a2a', 0.25); F.punch(0.4, 0); A.play('boom', 0.6); F.addShake(4); break;
      case 'levelup': F.showBanner('Level ' + ev.level, 'A boon awaits when the room is clear', 'level', 2.2); A.play('level'); for (const p of ctx.players()) { F.burst(p.x, p.y - 10, 18, { color: '#ffd36b', sp: 80, vy: -60, life: 0.9, size: 2.2, add: true, drag: 1.5 }); F.ring(p.x, p.y, 36, '#ffd36b', 0.5, 3); F.pop(p.x, p.y - 12, 26, '#ffd36b', 0.3); } break;
      case 'gold': if (ev.pid === local) A.play('gold', 0.6); break;
      case 'xp': if (ev.pid === local) A.play('xp', 0.5); break;
      case 'boon': { const p = ctx.player(ev.pid), b = ED.BOONS[ev.id]; if (p && b) { const col = b.path ? PATH_COL[b.path] : ED.RARITY[b.rar].color; F.burst(p.x, p.y - 12, b.gate ? 32 : 22, { color: col, sp: 70, vy: -50, life: 0.8, size: 2.4, add: true, drag: 1.2 }); F.ring(p.x, p.y, b.gate ? 42 : 30, col, 0.45, 3); F.pop(p.x, p.y - 14, 22, col, 0.25); if (b.path) F.burst(p.x, p.y - 12, 8, { kind: 'ember', color: col, sp: 40, a: -1.57, spread: 2.4, life: 1.0, size: 1.8, drag: 1.4, lt: col, ltr: 22 }); } if (ev.pid === local) A.play('boon'); break; }
      case 'relic': { const p = ctx.player(ev.pid); const r = ED.RELICS[ev.id]; if (p) { F.text(p.x, p.y - 40, r.name, ED.RARITY[r.rar].color, 11, { life: 1.8, max: 1.8 }); F.burst(p.x, p.y - 12, 24, { color: ED.RARITY[r.rar].color, sp: 80, vy: -40, life: 0.9, size: 2.4, add: true }); F.ring(p.x, p.y, 34, ED.RARITY[r.rar].color, 0.5, 3); } if (ev.pid === local) { A.play('relic'); ED.UI && ED.UI.toast(`<b>${r.name}</b> — ${r.desc}`, ED.Icons.relicUrl(ev.id)); } else if (p) F.msg(`${p.name} found ${r.name}`); break; }
      case 'lock': A.play('lock'); F.addShake(4); break;
      case 'clear': A.play('unlock'); F.showBanner(ev.trial ? 'Trial complete' : 'Room cleared', '', 'small', 1.4); break;
      case 'bossIntro': F.showBanner(ev.name, ev.title, 'boss', 3.4); F.bossQuote = { text: ev.quote, t: 0 }; A.play('roar'); A.music({ s: ctx.stratum(), boss: true }); F.addShake(8); F.punch(0.9, 0); break;
      case 'bossSpawn': F.addShake(6); F.punch(0.6, 0); break;
      case 'bossDown': F.showBanner('Vanquished', ED.ENEMIES[ev.type].name, 'victory', 3); F.flash = { color: '#ffffff', t: 0.5, a: 0.5 }; F.addShake(12); F.punch(2, 1); F.hitStop(0.3); A.play('roar', 0.6); A.play('victory', 0.7); A.music({ s: ctx.stratum() }); F.burst(ev.x, ev.y - 20, 60, { color: ED.ENEMIES[ev.type].col.c, sp: 220, life: 1.2, size: 3.5, add: true }); F.burst(ev.x, ev.y - 20, 18, { kind: 'streak', color: '#ffffff', sp: 380, life: 0.5, size: 2.4 }); F.ring(ev.x, ev.y, 160, ED.ENEMIES[ev.type].col.c, 0.8, 6); F.ring(ev.x, ev.y, 90, '#ffffff', 0.5, 3); F.pop(ev.x, ev.y - 20, 90, '#ffffff', 0.5); break;
      case 'phase': F.addShake(8); F.punch(1.6, 0.8); A.play('roar', 0.8); F.ring(ev.x, ev.y, 120, '#ffffff', 0.5, 5); F.ring(ev.x, ev.y, 70, '#ff8a5a', 0.4, 3); F.pop(ev.x, ev.y - 20, 60, '#ffffff', 0.35); break;
      case 'stratum': { const b = ED.biomeFor(ev.s); F.showBanner(b.name, 'Stratum ' + U.roman(ev.s), 'stratum', 3.6); F.fade = 1; A.music({ s: ev.s }); break; }
      case 'room': F.fade = Math.max(F.fade, 0.6); break;
      case 'down': { const p = ctx.player(ev.pid); A.play('down'); if (p) F.msg(ev.pid === local ? 'You are down! An ally can revive you.' : `${p.name} is down! Stand near them to revive.`, '#ff8a7a'); break; }
      case 'revived': { const p = ctx.player(ev.pid); A.play('revive'); if (p) { F.msg(`${p.name} is back on their feet`, '#86d38f'); F.burst(p.x, p.y - 10, 24, { color: '#ffe9a0', sp: 70, vy: -60, life: 0.9, size: 2.4, add: true }); F.ring(p.x, p.y, 40, '#ffe9a0', 0.5, 3); F.pop(p.x, p.y - 12, 30, '#ffe9a0', 0.3); } break; }
      case 'dead': { const p = ctx.player(ev.pid); if (p) F.msg(`${p.name} has fallen. They return at the next stratum.`, '#ff8a7a'); break; }
      case 'rise': { const p = ctx.player(ev.pid); const name = { phoenix: 'Phoenix Feather', angel: 'Guardian Angel', wind: 'Second Wind' }[ev.k]; F.showBanner(name, p ? p.name + ' refuses to fall' : '', 'small', 2); F.burst(ev.x, ev.y - 10, 40, { color: '#ffd36b', sp: 150, life: 0.9, size: 3, add: true }); F.ring(ev.x, ev.y, 70, '#ffd36b', 0.6, 4); F.pop(ev.x, ev.y - 12, 50, '#ffd36b', 0.4); F.punch(0.8, 0.4); A.play('revive'); break; }
      case 'dash': A.play('dash', ev.pid === local ? 0.8 : 0.3); F.burst(ev.x, ev.y, 6, { color: '#ffffff', sp: 40, life: 0.3, size: 3, kind: 'smoke', drag: 4 }); F.ring(ev.x, ev.y, 18, '#ffffff', 0.18, 2); break;
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
      case 'ward': F.ring(ev.x, ev.y - 10, 24, '#7fc8ff', 0.4, 3); F.burst(ev.x, ev.y - 10, 8, { color: '#bfe3ff', sp: 50, vy: -30, life: 0.6, size: 2, add: true, drag: 1.5 }); F.pop(ev.x, ev.y - 12, 22, '#7fc8ff', 0.25); break;
      default: break;
    }
  };

  // ---------- drawing (world space) ----------
  // Lit pass: stains, non-additive particles (smoke, shards, ash, drops); registers lights for flares and bright particles.
  F.drawWorld = (c) => {
    const Rn = R();
    for (const s of F.stains) {
      const k = Math.min(1, s.life / 2);
      c.globalAlpha = 0.34 * k; c.fillStyle = '#05030a'; c.beginPath(); c.ellipse(s.x, s.y + 2, s.r, s.r * 0.55, 0, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    let nl = 0;
    for (const p of F.parts) {
      const k = p.life / p.max;
      if (p.lt && nl < 14) { nl++; Rn.light(p.x, p.y - p.z, p.ltr, p.lt, 0.75 * Math.min(1, k * 1.5)); }
      if (p.add) continue;
      c.globalAlpha = p.kind === 'smoke' ? k * 0.35 : p.kind === 'ash' ? Math.min(1, k * 2) * 0.8 : Math.min(1, k * 1.5);
      c.fillStyle = p.color;
      const sz = p.kind === 'smoke' ? p.size * (2 - k) : p.size * (0.4 + 0.6 * k);
      if (p.kind === 'shard') { c.save(); c.translate(p.x, p.y - p.z); c.rotate(p.rot); c.fillRect(-sz, -sz * 0.5, sz * 2, sz); c.restore(); }
      else if (p.kind === 'ash') { c.save(); c.translate(p.x, p.y - p.z); c.rotate(p.rot); c.fillRect(-sz, -sz * 0.4, sz * 2, sz * 0.8); c.restore(); }
      else if (p.kind === 'smoke') { c.drawImage(Rn.glowSprite(p.color), p.x - sz * 1.6, p.y - p.z - sz * 1.6, sz * 3.2, sz * 3.2); }
      else { c.beginPath(); c.arc(p.x, p.y - p.z, sz, 0, TAU); c.fill(); }
    }
    c.globalAlpha = 1;
    for (const p of F.pops) Rn.light(p.x, p.y, p.r * 3.2, p.color, 0.9 * (p.life / p.max));
    for (const r of F.rings) { const k = 1 - r.life / r.max; if (r.r > 40) Rn.light(r.x, r.y, r.r * (0.3 + 0.7 * U.easeOut(k)) * 1.2, r.color, 0.5 * (1 - k)); }
    for (const b of F.bolts) { const k = b.life / b.max; for (let i = 1; i < b.pts.length; i += 2) Rn.light(b.pts[i][0], b.pts[i][1] - 10, 60, b.color, 0.8 * k); }
    for (const s of F.slashes) Rn.light(s.x + Math.cos(s.a) * s.r * 0.6, s.y + Math.sin(s.a) * s.r * 0.6, s.r * 1.1, s.color, 0.5 * (s.life / s.max));
  };

  // Emissive pass (context is in 'lighter'): slashes, rings, glowing particles, streaks, pops, bolts, ghosts.
  F.drawGlow = (c, t) => {
    const Rn = R(), Sp = ED.Sprites;
    for (const s of F.slashes) {
      const k = s.life / s.max, arc = Math.min(6.28, s.arc), a2 = 1 - (1 - k) * (1 - k);
      c.save(); c.translate(s.x, s.y); c.rotate(s.a);
      const g = c.createRadialGradient(0, 0, s.r * 0.4, 0, 0, s.r);
      g.addColorStop(0, U.rgba(s.color, 0)); g.addColorStop(0.65, U.rgba(s.color, 0.35 * a2)); g.addColorStop(1, U.rgba(U.mix(s.color, '#ffffff', 0.55), 0.85 * a2));
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, s.r, -arc / 2, arc / 2); c.arc(0, 0, s.r * (0.5 + 0.3 * (1 - k)), arc / 2, -arc / 2, true); c.closePath(); c.fill();
      c.strokeStyle = U.rgba('#ffffff', 0.9 * a2); c.lineWidth = 1.2 + 1.6 * k; c.beginPath(); c.arc(0, 0, s.r, -arc / 2, arc / 2); c.stroke();
      c.strokeStyle = U.rgba(s.color, 0.5 * a2); c.lineWidth = 4 * k + 1; c.beginPath(); c.arc(0, 0, s.r * 0.96, -arc / 2, arc / 2); c.stroke();
      c.restore();
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
    for (const p of F.parts) {
      if (!p.add) continue;
      const k = p.life / p.max;
      c.globalAlpha = Math.min(1, k * 1.5);
      if (p.kind === 'streak') {
        const sp = Math.hypot(p.vx, p.vy), l = Math.min(26, sp * 0.05 + 2), ux = sp > 1 ? p.vx / sp : 0, uy = sp > 1 ? p.vy / sp : 0;
        c.strokeStyle = p.color; c.lineWidth = p.size * (0.4 + 0.6 * k); c.lineCap = 'round';
        c.beginPath(); c.moveTo(p.x, p.y - p.z); c.lineTo(p.x - ux * l, p.y - p.z - uy * l); c.stroke();
        c.strokeStyle = '#ffffff'; c.lineWidth = p.size * 0.35; c.beginPath(); c.moveTo(p.x, p.y - p.z); c.lineTo(p.x - ux * l * 0.5, p.y - p.z - uy * l * 0.5); c.stroke();
      } else if (p.kind === 'spark') {
        const sp = Math.hypot(p.vx, p.vy), l = Math.min(10, sp * 0.03 + 1), ux = sp > 1 ? p.vx / sp : 0, uy = sp > 1 ? p.vy / sp : 0;
        c.strokeStyle = p.color; c.lineWidth = p.size; c.lineCap = 'round'; c.beginPath(); c.moveTo(p.x, p.y - p.z); c.lineTo(p.x - ux * l, p.y - p.z - uy * l); c.stroke();
      } else if (p.kind === 'ember') {
        const fl = 0.6 + 0.4 * Math.sin(p.rot * 5);
        c.globalAlpha = Math.min(1, k * 1.6) * fl; c.fillStyle = p.color; c.fillRect(p.x - p.size * 0.5, p.y - p.z - p.size * 0.5, p.size, p.size);
        Rn.glow(c, p.x, p.y - p.z, p.size * 3, p.color, 0.6);
      } else if (p.kind === 'shard') {
        c.save(); c.translate(p.x, p.y - p.z); c.rotate(p.rot); c.fillStyle = p.color; c.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8); c.restore();
      } else {
        const sz = p.size * (0.4 + 0.6 * k);
        c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y - p.z, sz, 0, TAU); c.fill();
        if (sz > 1.6) Rn.glow(c, p.x, p.y - p.z, sz * 3, p.color, 0.35);
      }
    }
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
    // ghosts: dash afterimages (hero sprite, additive) and death silhouettes (white flash drifting up and fading)
    for (const g of F.ghosts) {
      const k = g.life / g.max, fake = g.fake || (g.fake = g.k === 'dash' ? { cls: g.cls, slot: g.slot, weapon: g.weapon, face: g.face, moving: true, hp: 1, flash: 0 } : { def: ED.ENEMIES[g.type], r: g.r, id: 0, st: 'move', face: 1, flash: 1, frozen: 0, elite: null, hp: 1, maxHp: 1, t: 0, pose: '', aimA: 0, phase: 0 });
      if (g.ok === undefined) g.ok = ghostOK(g, fake);
      if (!g.ok) continue;
      c.save(); c.translate(g.x, g.y);
      if (g.k === 'dash') { c.globalAlpha = 0.32 * k; Sp.hero(c, fake, t, null); }
      else { c.translate(0, -(1 - k) * 9); c.scale(1 + (1 - k) * 0.12, 1 - (1 - k) * 0.1); c.globalAlpha = Math.min(1, k * 1.4) * 0.85; Sp.enemy(c, fake, t); }
      c.restore();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
  };

  // A sprite is test-drawn once per kind on a throwaway canvas, so a look that cannot render a synthetic actor never unbalances the world context.
  const ghostChecked = {};
  function ghostOK(g, fake) {
    const key = g.k === 'dash' ? 'h:' + g.cls : 'e:' + g.type;
    if (ghostChecked[key] === undefined) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 4;
      try { if (g.k === 'dash') ED.Sprites.hero(cv.getContext('2d'), fake, 0, null); else if (fake.def) ED.Sprites.enemy(cv.getContext('2d'), fake, 0); else throw new Error('no def'); ghostChecked[key] = true; } catch (e) { ghostChecked[key] = false; }
    }
    return ghostChecked[key];
  }

  F.drawTexts = (c) => {
    const Rn = R();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    for (const t of F.texts) {
      const k = t.life / t.max, age = t.max - t.life;
      const pop = t.pop ? 1 + 0.75 * Math.exp(-age * 15) * (t.crit ? 1.3 : 1) : 1;
      const sc = t.crit ? pop * (1 + 0.07 * Math.sin(age * 42) * Math.exp(-age * 5)) : pop;
      const a = Math.min(1, k * 2.2);
      const fs = Math.round(t.size * sc);
      if (t.crit) { c.globalCompositeOperation = 'lighter'; Rn.glow(c, t.x, t.y, fs * 1.7, t.color, 0.5 * a); c.globalCompositeOperation = 'source-over'; }
      c.globalAlpha = a;
      c.font = `800 ${fs}px "Alegreya Sans", system-ui, sans-serif`;
      c.lineWidth = t.crit ? 4 : 3; c.strokeStyle = t.crit ? 'rgba(40,10,0,0.95)' : 'rgba(0,0,0,0.85)'; c.strokeText(t.s, t.x, t.y);
      c.fillStyle = t.color; c.fillText(t.s, t.x, t.y);
      if (t.crit) { c.fillStyle = 'rgba(255,255,255,0.4)'; c.save(); c.beginPath(); c.rect(t.x - fs * 3, t.y - fs * 0.6, fs * 6, fs * 0.55); c.clip(); c.fillText(t.s, t.x, t.y); c.restore(); }
    }
    c.globalAlpha = 1;
  };
})(globalThis.ED || (globalThis.ED = {}));
