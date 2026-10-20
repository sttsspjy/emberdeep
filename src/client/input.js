// Keyboard, mouse and gamepad. Game controls: WASD move, J / left mouse attack, K / X / right mouse skill 1,
// L / C / E / middle mouse skill 2, Space dash, Tab map; gamepad: B/RB skill 1, Y/LT skill 2.
(function (ED) {
  'use strict';
  const I = ED.Input = {
    keys: new Set(), pressed: new Set(), mouse: { x: 0, y: 0, l: false, r: false, moved: 0, lPressed: false, rPressed: false, mPressed: false },
    pad: null, padPrev: [], enabled: true,
  };
  const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  I.init = (canvas) => {
    window.addEventListener('keydown', (e) => {
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
      if (typing) return;
      if (GAME_KEYS.has(e.code) && ED.App && ED.App.inRun()) e.preventDefault(); // menus keep Tab/Space for keyboard navigation
      if (!I.keys.has(e.code)) I.pressed.add(e.code);
      I.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { I.keys.delete(e.code); });
    window.addEventListener('blur', () => { I.keys.clear(); I.mouse.l = I.mouse.r = false; });
    canvas.addEventListener('mousemove', (e) => { I.mouse.x = e.clientX; I.mouse.y = e.clientY; I.mouse.moved = performance.now(); });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { I.mouse.l = true; I.mouse.lPressed = true; }
      if (e.button === 1) { e.preventDefault(); I.mouse.mPressed = true; } // middle click: skill 2, no autoscroll
      if (e.button === 2) { I.mouse.r = true; I.mouse.rPressed = true; }
    });
    canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) I.mouse.l = false; if (e.button === 2) I.mouse.r = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  const down = (...codes) => codes.some(c => I.keys.has(c));
  const hit = (...codes) => codes.some(c => I.pressed.has(c));

  // Snapshot of intent for this frame.
  I.read = () => {
    const out = { mx: 0, my: 0, atk: false, skill: false, dash: false, atkPressed: false, tab: false, esc: false, confirm: false, left: false, right: false, aimX: null, aimY: null, skill2: false };
    if (down('KeyW', 'ArrowUp')) out.my -= 1;
    if (down('KeyS', 'ArrowDown')) out.my += 1;
    if (down('KeyA', 'ArrowLeft')) out.mx -= 1;
    if (down('KeyD', 'ArrowRight')) out.mx += 1;
    out.atk = down('KeyJ', 'KeyZ') || I.mouse.l;
    out.atkPressed = hit('KeyJ', 'KeyZ') || I.mouse.lPressed;
    out.skill = hit('KeyK', 'KeyX') || I.mouse.rPressed;
    out.skill2 = hit('KeyL', 'KeyC', 'KeyE') || I.mouse.mPressed;
    out.dash = hit('Space', 'ShiftLeft', 'ShiftRight');
    out.tab = hit('Tab');
    out.esc = hit('Escape');
    out.confirm = hit('KeyJ', 'KeyZ', 'Enter'); // not Space: a dash mashed in combat must never pick a boon
    out.left = hit('KeyA', 'ArrowLeft');
    out.right = hit('KeyD', 'ArrowRight');
    out.up = hit('KeyW', 'ArrowUp');
    out.down = hit('KeyS', 'ArrowDown');
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.22) { out.mx += ax; out.my += ay; }
      const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
      if (Math.hypot(rx, ry) > 0.45) { out.padAim = Math.atan2(ry, rx); }
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const bp = (i) => b(i) && !I.padPrev[i];
      out.atk = out.atk || b(2) || b(7);
      out.atkPressed = out.atkPressed || bp(2) || bp(7);
      out.skill = out.skill || bp(1) || bp(5);
      out.skill2 = out.skill2 || bp(3) || bp(6);
      out.dash = out.dash || bp(0) || bp(4);
      out.esc = out.esc || bp(9);
      out.tab = out.tab || bp(8);
      out.confirm = out.confirm || bp(2);
      out.left = out.left || bp(14);
      out.right = out.right || bp(15);
      I.padPrev = gp.buttons.map(x => x.pressed);
      I.padActive = true;
    }
    const l = Math.hypot(out.mx, out.my);
    if (l > 1) { out.mx /= l; out.my /= l; }
    return out;
  };

  I.endFrame = () => { I.pressed.clear(); I.mouse.lPressed = false; I.mouse.rPressed = false; I.mouse.mPressed = false; };
})(globalThis.ED || (globalThis.ED = {}));
