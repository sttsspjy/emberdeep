// Aim feedback, client only: where a skill reaches for the current aim, the procedural CSS cursor (reticle bitmaps, foe hover, gamepad hiding)
// and the world-space cursor extras (attack-cooldown arc, attack pulse, crit flash, ground-skill landing preview, gamepad chevron).
// game.js owns the aim state (ED.Game.s.aim); the renderer calls ED.AimFx.draw(c, view) with the world transform active.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, TAU = Math.PI * 2;
  const A = ED.AimFx = { uCss: 13 }; // uCss: the cursor unit in CSS px (a reticle's ring radius is 0.6 of it)

  // ---------------- where a skill reaches ----------------
  const WANT = { x: 0, y: 0, d: 0 };
  // Target the aim asks for: the cursor (mouse), else along the aim by the stick push (or 0.6) of `range`. Shared scratch point {x, y, d = distance from the hero}.
  A.want = (me, a, range) => {
    if (a.pointer) { WANT.x = a.wx; WANT.y = a.wy; }
    else { WANT.x = me.x + Math.cos(a.a) * range * a.frac; WANT.y = me.y + Math.sin(a.a) * range * a.frac; }
    WANT.d = Math.hypot(WANT.x - me.x, WANT.y - me.y);
    return WANT;
  };
  // Landing point of a ground skill: the target clamped to `range` and cut at the first wall (Sim.groundPoint); `walk` lands on a standable spot.
  A.groundLand = (view, me, a, range, walk) => {
    const w = A.want(me, a, range);
    return Sim.groundPoint(view.room, view.locked, me.x, me.y, w.x, w.y, range, walk);
  };
  // Shadowstep: toward the target, 40..140 px, stopped by walls for the hero's body; a free path lands exactly on the point, not on the last 8 px step.
  A.stepLand = (view, me, a) => {
    const w = A.want(me, a, 140), ang = w.d > 12 ? Math.atan2(w.y - me.y, w.x - me.x) : a.a, d = U.clamp(w.d, 40, 140);
    const e = Sim.castMove(view.room, me.x, me.y, ang, d, me.r, view.locked);
    if (Math.hypot(e.x - me.x, e.y - me.y) >= d - 8) {
      const q = { x: me.x + Math.cos(ang) * d, y: me.y + Math.sin(ang) * d, r: me.r };
      if (!Sim.resolve(q, view.room, view.locked, false)) return q;
    }
    return e;
  };

  // ---------------- procedural CSS cursor ----------------
  const COL = { ember: '#ffb56b', bone: '#f6ecda', frost: '#7fe3ff' }, SZ = { s: 0.8, m: 1, l: 1.3 };
  const unit = () => U.clamp(Math.min(window.innerWidth / 110, window.innerHeight / 62), 13, 36); // the HUD unit, CSS px
  let curKey = '';

  // One reticle bitmap, `sz` CSS px drawn at k device px per CSS px: dark underlay, ring, 4 ticks (rotated 45 degrees over a foe), centre dot.
  function reticle(sz, k, col, foe) {
    const cv = document.createElement('canvas'); cv.width = cv.height = sz * k;
    const g = cv.getContext('2d'), uu = sz * k / 2.1;
    g.translate(sz * k / 2, sz * k / 2); g.lineCap = 'butt';
    const lw = Math.max(0.12 * uu, 1.5), dot = Math.max(0.09 * uu, 1), rot = foe ? Math.PI / 4 : 0;
    const pass = (w, ringCol, tickCol, dotR) => {
      g.lineWidth = w;
      g.strokeStyle = ringCol; g.beginPath(); g.arc(0, 0, 0.6 * uu, 0, TAU); g.stroke();
      g.strokeStyle = tickCol; g.beginPath();
      for (let i = 0; i < 4; i++) {
        const an = i * Math.PI / 2 + rot, co = Math.cos(an), si = Math.sin(an);
        g.moveTo(co * 0.72 * uu, si * 0.72 * uu); g.lineTo(co * 0.98 * uu, si * 0.98 * uu);
      }
      g.stroke();
      g.fillStyle = tickCol; g.beginPath(); g.arc(0, 0, dotR, 0, TAU); g.fill();
    };
    const dark = 'rgba(10,7,6,0.75)';
    pass(lw + 0.14 * uu, dark, dark, dot + 0.07 * uu);
    pass(lw, foe ? COL.bone : col, col, dot);
    return cv.toDataURL('image/png');
  }

  // Applies the Cursor settings: `syscursor` on the body for the OS crosshair, else the two reticle bitmaps as CSS variables (style.css owns the rules).
  A.applyCursor = () => {
    const set = (ED.App && ED.App.settings) || {}, root = document.documentElement.style;
    const sys = set.cursor === 'system';
    document.body.classList.toggle('syscursor', sys);
    const sz = Math.min(64, Math.ceil(unit() * 1.05 * (SZ[set.reticle] || 1)) * 2); // even, so the hot spot sits on a pixel centre
    A.uCss = sz / 2.1;
    if (sys) return;
    const key = sz + '|' + (set.reticleCol || 'ember');
    if (key === curKey) return;
    curKey = key;
    try {
      const col = COL[set.reticleCol] || COL.ember, h = sz / 2;
      const make = (foe) => {
        const one = reticle(sz, 1, col, foe), two = reticle(sz, 2, col, foe);
        const hd = `image-set(url(${one}) 1x, url(${two}) 2x) ${h} ${h}, crosshair`;
        return window.CSS && CSS.supports && CSS.supports('cursor', hd) ? hd : `url(${one}) ${h} ${h}, crosshair`;
      };
      root.setProperty('--aim-cur', make(false)); root.setProperty('--aim-cur-foe', make(true));
    } catch (e) { root.setProperty('--aim-cur', 'crosshair'); root.setProperty('--aim-cur-foe', 'crosshair'); curKey = ''; }
  };
  window.addEventListener('resize', () => A.applyCursor());

  // Body classes: `pad` hides the cursor on a gamepad, `aim-foe` swaps in the foe reticle while the cursor is over a foe.
  let padOn = false, foeOn = false;
  A.hover = (pad, foe) => {
    const cl = document.body.classList;
    if (pad !== padOn) { padOn = pad; cl.toggle('pad', pad); }
    foe = foe && !pad;
    if (foe !== foeOn) { foeOn = foe; cl.toggle('aim-foe', foe); }
  };

  // ---------------- world-space extras ----------------
  let ovs = null;
  const overlayOpen = () => {
    if (!ovs) ovs = ['ov-pause', 'ov-settings', 'modal', 'ov-sheet', 'ov-boon'].map(id => document.getElementById(id));
    for (const o of ovs) if (o && !o.hidden) return true;
    return false;
  };
  const lineW = (v) => U.clamp(Math.round(v), 1, 2); // crisp 1-2 world px lines

  function cursorExtras(c, a, uw, S, now) {
    const cx = Math.round(a.wx * S) / S, cy = Math.round(a.wy * S) / S;
    if (a.cd > 0) { // attack cooldown: 300 degrees clockwise from the top, fills as the cooldown ends
      const r = 1.25 * uw, a0 = -Math.PI / 2, sweep = TAU * (300 / 360);
      c.lineWidth = lineW(0.14 * uw) + 1; c.strokeStyle = 'rgba(10,7,6,0.6)'; c.beginPath(); c.arc(cx, cy, r, a0, a0 + sweep); c.stroke();
      c.lineWidth = lineW(0.14 * uw); c.strokeStyle = 'rgba(255,181,107,0.9)'; c.beginPath(); c.arc(cx, cy, r, a0, a0 + sweep * (1 - a.cd)); c.stroke();
    }
    const pt = (now - a.pulseT) / 100;
    if (pt >= 0 && pt < 1) { c.globalAlpha = 0.85 * (1 - pt); c.lineWidth = lineW(0.12 * uw); c.strokeStyle = '#fff1d6'; c.beginPath(); c.arc(cx, cy, 0.6 * uw * (1 + 0.18 * (1 - pt)), 0, TAU); c.stroke(); c.globalAlpha = 1; }
    const ct = (now - a.critT) / 120;
    if (ct >= 0 && ct < 1) { c.globalAlpha = 1 - ct; c.lineWidth = lineW(0.16 * uw); c.strokeStyle = '#f0cf8a'; c.beginPath(); c.arc(cx, cy, 0.6 * uw, 0, TAU); c.stroke(); c.globalAlpha = 1; }
  }

  // Gamepad aim indicator: an ember chevron 26 world px from the aim origin along the aim.
  function chevron(c, me, a, uw, S) {
    const s = 0.9 * uw, x = Math.round((me.x + Math.cos(a.a) * 26) * S) / S, y = Math.round((me.y - 4 + Math.sin(a.a) * 26) * S) / S;
    c.save(); c.translate(x, y); c.rotate(a.a); c.lineJoin = 'miter';
    for (let i = 0; i < 2; i++) {
      c.lineWidth = i ? lineW(0.22 * uw) : lineW(0.22 * uw) + 1; c.strokeStyle = i ? 'rgba(255,181,107,0.85)' : 'rgba(10,7,6,0.7)';
      c.beginPath(); c.moveTo(-s * 0.5, -s * 0.7); c.lineTo(s * 0.5, 0); c.lineTo(-s * 0.5, s * 0.7); c.stroke();
    }
    c.restore();
  }

  // Dashed ring over a thin dark underlay so it reads on every biome floor.
  function dashed(c, x, y, r, dash, lw, col, alpha) {
    c.setLineDash(dash);
    c.beginPath(); c.arc(x, y, r, 0, TAU);
    c.globalAlpha = alpha * 0.8; c.lineWidth = lw + 1; c.strokeStyle = '#0a0706'; c.stroke();
    c.globalAlpha = alpha; c.lineWidth = lw; c.strokeStyle = col; c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
  }

  // Landing preview of each ready ground skill (and the Shadowstep diamond). The area equals the real one (ED.skillRadius).
  function preview(c, view, me, a, uw, S) {
    let grounds = 0;
    for (let i = 0; i < a.ground.length; i++) if (!a.ground[i].move) grounds++;
    for (let i = 0; i < a.ground.length; i++) {
      const g = a.ground[i];
      if (g.move) {
        const l = A.stepLand(view, me, a), x = Math.round(l.x * S) / S, y = Math.round(l.y * S) / S, d = 0.4 * uw;
        c.globalAlpha = 0.4; c.lineWidth = lineW(0.1 * uw); c.strokeStyle = '#ffb56b'; c.fillStyle = 'rgba(255,181,107,0.25)';
        c.beginPath(); c.moveTo(x, y - d); c.lineTo(x + d, y); c.lineTo(x, y + d); c.lineTo(x - d, y); c.closePath(); c.fill(); c.stroke(); c.globalAlpha = 1;
        continue;
      }
      const w = A.want(me, a, g.range), tx = w.x, ty = w.y, l = Sim.groundPoint(view.room, view.locked, me.x, me.y, tx, ty, g.range, g.walk);
      const lx = Math.round(l.x * S) / S, ly = Math.round(l.y * S) / S, near = Math.hypot(l.x - tx, l.y - ty) < 3;
      if (near) dashed(c, lx, ly, g.r, [0.4 * uw, 0.3 * uw], lineW(0.08 * uw), '#ffb56b', 0.35);
      else {
        dashed(c, Math.round(me.x * S) / S, Math.round(me.y * S) / S, g.range, [0.5 * uw, 0.5 * uw], lineW(0.08 * uw), '#ff8a3d', 0.3);
        c.beginPath(); c.arc(lx, ly, g.r, 0, TAU);
        c.globalAlpha = 0.08; c.fillStyle = '#ffb56b'; c.fill();
        c.globalAlpha = 0.75; c.lineWidth = lineW(0.1 * uw); c.strokeStyle = '#ffb56b'; c.stroke();
        const q = 0.15 * uw; c.beginPath(); c.moveTo(lx - q, ly); c.lineTo(lx + q, ly); c.moveTo(lx, ly - q); c.lineTo(lx, ly + q); c.stroke();
        c.globalAlpha = 1;
        if (a.pointer) { // dotted tether from the cursor to the landing point
          c.setLineDash([0.15 * uw, 0.3 * uw]); c.globalAlpha = 0.35; c.lineWidth = lineW(0.08 * uw); c.strokeStyle = '#ffb56b';
          c.beginPath(); c.moveTo(tx, ty); c.lineTo(lx, ly); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
        }
      }
      if (grounds > 1) // several ground skills ready: label each landing with its key in the HUD's pixel font (1 buffer px per font px, outlined)
        ED.HUD.pixText(c, ED.Input.label(g.slot ? 'skill2' : 'skill1'), lx + g.r + 4, ly, 1, '#ffd9a8', 'b', 'left', 700, 1);
    }
  }

  // Draws the extras with the world transform active (called by the renderer after the overhead labels).
  A.draw = (c, view) => {
    const G = ED.Game, s = G && G.s, a = s && s.aim;
    if (!a || !a.show || !view.room || overlayOpen()) return;
    const R = ED.Render, set = (ED.App && ED.App.settings) || {}, me = s.me, m = ED.Input.mouse;
    const k0 = R.dpr / R.scale, uw = A.uCss * k0, S = R.scale, now = performance.now(); // k0: world px per CSS px
    if (a.pointer) { const w = R.toWorld(m.x * R.dpr, m.y * R.dpr); a.wx = w.x; a.wy = w.y; } // the camera has moved since control()
    c.save();
    c.lineCap = 'butt';
    if (a.device === 'pad') chevron(c, me, a, uw, S);
    else if (a.pointer && m.inside) cursorExtras(c, a, uw, S, now);
    if (set.aimPreview !== false && a.ground.length) preview(c, view, me, a, uw, S);
    c.restore();
  };
})(globalThis.ED || (globalThis.ED = {}));
