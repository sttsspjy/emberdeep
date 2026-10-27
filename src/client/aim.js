// Aim (client only): the world point skills aim at (mouse cursor, or the right stick 120 px ahead of the hero on a gamepad) and the procedural reticle CSS cursor.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = Math.PI * 2;
  const A = ED.AimFx = { wx: 0, wy: 0, padA: 0 };

  // World aim point for hero me from this frame's input `inp` (ED.Input.read()). Returns A ({ wx, wy }).
  A.point = (me, inp) => {
    const I = ED.Input, R = ED.Render;
    if (I.device === 'pad') {
      if (inp.padAim !== undefined) A.padA = inp.padAim; else if (Math.hypot(inp.mx, inp.my) > 0.2) A.padA = Math.atan2(inp.my, inp.mx);
      A.wx = me.x + Math.cos(A.padA) * 120; A.wy = me.y + Math.sin(A.padA) * 120;
    } else { const w = R.toWorld(I.mouse.x * R.dpr, I.mouse.y * R.dpr); A.wx = w.x; A.wy = w.y; }
    return A;
  };

  // ---------------- reticle cursor ----------------
  const reticle = (sz, k) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = sz * k;
    const g = cv.getContext('2d'), u = sz * k / 2.1;
    g.translate(sz * k / 2, sz * k / 2);
    const pass = (lw, col) => {
      g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.arc(0, 0, 0.6 * u, 0, TAU); g.stroke();
      g.beginPath();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); g.moveTo(c * 0.72 * u, s * 0.72 * u); g.lineTo(c * 0.98 * u, s * 0.98 * u); }
      g.stroke(); g.fillStyle = col; g.beginPath(); g.arc(0, 0, Math.max(1, 0.09 * u), 0, TAU); g.fill();
    };
    pass(Math.max(1.5, 0.12 * u) + 0.14 * u, 'rgba(10,7,6,0.75)'); pass(Math.max(1.5, 0.12 * u), '#ffb56b');
    return cv.toDataURL('image/png');
  };
  // Sets the reticle as the page cursor (CSS variable --aim-cur; style.css uses it on the game canvas).
  A.applyCursor = () => {
    try {
      const sz = Math.min(64, Math.round(U.clamp(Math.min(window.innerWidth / 110, window.innerHeight / 62), 13, 36) * 1.05) * 2), h = sz / 2;
      document.documentElement.style.setProperty('--aim-cur', `url(${reticle(sz, 1)}) ${h} ${h}, crosshair`);
    } catch (e) { document.documentElement.style.setProperty('--aim-cur', 'crosshair'); }
  };
  // Gamepad aim marker in the world (drawn by the caller between the actors and the overlays).
  A.draw = (B, me) => {
    if (!me || ED.Input.device !== 'pad') return;
    B.circ(A.wx, A.wy, 4, 0xffb56bcc, 1);
  };
})(globalThis.ED || (globalThis.ED = {}));
