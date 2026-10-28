// Keyboard, mouse and gamepad. One binding table maps every action to two slots, each a KeyboardEvent.code or Mouse0..Mouse4 (always e.code: layouts never matter).
// Defaults: WASD move (arrows alternate), skill Q, dash Space, pick 1-4 Digit1-4, reroll R, skip X, pause Esc. No mouse button is bound by default (a click does nothing in a run).
// Aim is the mouse cursor (I.mouse, CSS px). Gamepad (fixed): left stick move, right stick aim, RB or LB skill, A dash, X / Y / B / RT pick 1-4, Start pause.
// I.mask([actions]) makes every key held right now read as up until released (an overlay that closes must not pass its closing press to the game).
(function (ED) {
  'use strict';
  const I = ED.Input = {
    keys: new Set(), pressed: new Set(), mouse: { x: 0, y: 0, moved: 0, inside: true },
    pad: null, padPrev: [], enabled: true, binds: {}, device: 'mouse',
  };
  const PAD_AIM = 0.45, LATCH_MS = 350, SWITCH_PX = 3, SWITCH_WINDOW_MS = 250;
  let padLast = null; // last right-stick aim above PAD_AIM {a, mag, t}

  // ---------------- binding table ----------------
  I.ACTIONS = [
    { id: 'up', label: 'Move up', group: 'Movement' }, { id: 'down', label: 'Move down', group: 'Movement' },
    { id: 'left', label: 'Move left', group: 'Movement' }, { id: 'right', label: 'Move right', group: 'Movement' },
    { id: 'skill1', label: 'Skill Q', group: 'Combat' }, { id: 'dash', label: 'Dash', group: 'Combat' },
    { id: 'pick1', label: 'Card 1', group: 'Cards' }, { id: 'pick2', label: 'Card 2', group: 'Cards' }, { id: 'pick3', label: 'Card 3', group: 'Cards' }, { id: 'pick4', label: 'Card 4', group: 'Cards' },
    { id: 'reroll', label: 'Reroll cards', group: 'Cards' }, { id: 'skip', label: 'Skip cards', group: 'Cards' },
    { id: 'pause', label: 'Pause', group: 'Interface' },
  ];
  I.DEFAULTS = {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    skill1: ['KeyQ', null], dash: ['Space', null],
    pick1: ['Digit1', 'Numpad1'], pick2: ['Digit2', 'Numpad2'], pick3: ['Digit3', 'Numpad3'], pick4: ['Digit4', 'Numpad4'],
    reroll: ['KeyR', null], skip: ['KeyX', null], pause: ['Escape', null],
  };
  const ACTION = {}; for (const a of I.ACTIONS) ACTION[a.id] = a;
  const CODE_RE = /^(Mouse[0-4]|[A-Za-z][A-Za-z0-9]{1,24})$/;
  const RESERVED = new Set(['Escape', 'Enter', 'NumpadEnter', 'MetaLeft', 'MetaRight', 'ContextMenu']); // not assignable by the user
  let codes = {}; // action -> non-empty codes, rebuilt whenever a slot changes
  const masked = new Set(); // codes (and 'pad<i>') held when I.mask() ran; dropped when released

  const rebuild = () => {
    codes = {};
    for (const a of I.ACTIONS) codes[a.id] = I.binds[a.id].filter(Boolean);
    I.boundCodes = new Set([].concat(...Object.values(codes)));
  };
  const clone = (o) => { const r = {}; for (const k in o) r[k] = o[k].slice(); return r; };

  // Load saved bindings: unknown actions, malformed or duplicate codes and actions left without a key fall back to defaults.
  I.setBinds = (saved) => {
    const b = clone(I.DEFAULTS), used = new Set();
    if (saved && typeof saved === 'object') {
      for (const a of I.ACTIONS) {
        const s = saved[a.id];
        if (!Array.isArray(s)) continue;
        const ok = (c) => typeof c === 'string' && CODE_RE.test(c) && (!RESERVED.has(c) || (c === 'Escape' && a.id === 'pause'));
        const pair = [0, 1].map(i => (ok(s[i]) ? s[i] : null));
        if (pair[0] && pair[0] === pair[1]) pair[1] = null;
        if (pair.some(Boolean)) b[a.id] = pair;
      }
    }
    for (const a of I.ACTIONS) for (let i = 0; i < 2; i++) { const c = b[a.id][i]; if (c && used.has(c)) b[a.id][i] = null; else if (c) used.add(c); }
    for (const a of I.ACTIONS) if (!b[a.id][0] && !b[a.id][1]) b[a.id] = I.DEFAULTS[a.id].slice();
    I.binds = b; rebuild();
  };
  I.exportBinds = () => clone(I.binds);
  I.resetBinds = () => { I.binds = clone(I.DEFAULTS); rebuild(); };
  I.isDefault = () => I.ACTIONS.every(a => I.binds[a.id][0] === I.DEFAULTS[a.id][0] && I.binds[a.id][1] === I.DEFAULTS[a.id][1]);
  I.reserved = (code) => RESERVED.has(code);

  // Bind `code` to slot 0/1 of `action`. A code already used elsewhere is swapped into the slot it replaces.
  // Returns { ok, msg }: refused changes leave the table untouched and say why.
  I.rebind = (action, slot, code) => {
    const b = I.binds, cur = b[action][slot];
    if (RESERVED.has(code)) return { ok: false, msg: `${I.keyName(code)} is reserved for menus.` };
    if (code === cur) return { ok: true, msg: '' };
    let hitA = null, hitS = -1;
    for (const a of I.ACTIONS) for (let s = 0; s < 2; s++) if (b[a.id][s] === code && !(a.id === action && s === slot)) { hitA = a.id; hitS = s; }
    if (hitA && hitA !== action && !cur && b[hitA].filter(Boolean).length < 2) return { ok: false, msg: `${ACTION[hitA].label} would be left with no key.` };
    b[action][slot] = code;
    if (!hitA) { rebuild(); return { ok: true, msg: `${ACTION[action].label}: ${I.keyName(code)}` }; }
    b[hitA][hitS] = cur;
    rebuild();
    if (hitA === action) return { ok: true, msg: `${I.keyName(code)} is now the ${slot ? 'alternate' : 'primary'} key for ${ACTION[action].label}.` };
    return { ok: true, msg: cur ? `${I.keyName(code)} moved here; ${ACTION[hitA].label} now uses ${I.keyName(cur)}.` : `${I.keyName(code)} moved here; ${ACTION[hitA].label} keeps its other key.` };
  };
  I.clearSlot = (action, slot) => {
    const b = I.binds[action];
    if (!b[slot]) return { ok: true, msg: '' };
    if (b.filter(Boolean).length < 2) return { ok: false, msg: `${ACTION[action].label} needs at least one key.` };
    b[slot] = null; rebuild();
    return { ok: true, msg: `${ACTION[action].label}: slot cleared.` };
  };

  // ---------------- labels ----------------
  const NAMES = {
    Space: 'Space', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', CapsLock: 'Caps',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter',
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'MB4', Mouse4: 'MB5',
    NumLock: 'NumLk', ScrollLock: 'ScrLk', PrintScreen: 'PrtSc', Pause: 'Pause', IntlBackslash: '\\', IntlRo: '\\', IntlYen: '¥',
  };
  let layout = null; // physical key -> printed character on the player's layout (Chromium only)
  const PRINTED = /^(Key[A-Z]|Digit\d|Backquote|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash)$/;
  I.keyName = (code) => {
    if (!code) return '';
    if (PRINTED.test(code)) { const ch = layout && layout.get(code); if (ch && ch.length === 1) return ch.toUpperCase(); }
    if (NAMES[code]) return NAMES[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
    return code;
  };
  const isMouse = (c) => /^Mouse/.test(c);
  I.labels = (action) => (codes[action] || []).map(I.keyName);
  // Gamepad button names (fixed layout, see I.poll): what HUD keycaps, prompts and signs show while I.device is 'pad'.
  const PAD = { skill1: 'RB', dash: 'A', pick1: 'X', pick2: 'Y', pick3: 'B', pick4: 'RT', pause: 'Start' };
  // Primary label for HUD hints: the first keyboard binding, else the first mouse button; the pad button names on a pad.
  I.label = (action) => {
    if (I.device === 'pad' && PAD[action]) return PAD[action];
    const list = codes[action] || [];
    const c = list.find(x => !isMouse(x)) || list[0];
    return c ? I.keyName(c) : '—';
  };
  // Every bound key of an action, at most two ('W / ↑').
  I.hint = (action) => { if (I.device === 'pad' && PAD[action]) return PAD[action]; const l = I.labels(action); return l.length ? l.slice(0, 2).join(' / ') : '—'; };
  // Replaces {action} tokens in a text with the action's current key hint (unknown tokens stay); {aim} names the device that aims.
  I.fill = (text) => String(text).replace(/\{(\w+)\}/g, (m, a) => (a === 'aim' ? (I.device === 'pad' ? 'the right stick' : 'the mouse') : ACTION[a] ? I.hint(a) : m));

  // ---------------- capture (rebinding screen) ----------------
  let stopCap = null;
  // The next key or mouse button goes to cb(code); Esc cancels with cb(null). Events are swallowed so the game never sees them.
  I.capture = (cb) => {
    I.stopCapture();
    const kill = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const done = (code) => { I.stopCapture(); cb(code); };
    const onKey = (e) => { kill(e); if (!e.repeat) done(e.code === 'Escape' ? null : e.code); };
    const onMouse = (e) => {
      kill(e);
      // the click that follows this press must not reach the page; stop eating just after the button comes up
      const eat = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      const off = () => { for (const t of ['click', 'auxclick']) window.removeEventListener(t, eat, true); window.removeEventListener('mouseup', onUp, true); };
      const onUp = () => setTimeout(off, 40);
      for (const t of ['click', 'auxclick']) window.addEventListener(t, eat, true);
      window.addEventListener('mouseup', onUp, true);
      setTimeout(off, 5000);
      done('Mouse' + e.button);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', kill, true);
    stopCap = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onMouse, true); setTimeout(() => window.removeEventListener('contextmenu', kill, true), 300); stopCap = null; };
  };
  I.stopCapture = () => { if (stopCap) stopCap(); };
  I.capturing = () => !!stopCap;

  // ---------------- devices ----------------
  I.init = (canvas) => {
    try { if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then(m => { layout = m; }, () => {}); } catch (e) { /* label from the code instead */ }
    window.addEventListener('keydown', (e) => {
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
      if (typing) return;
      if (ED.App && ED.App.inRun() && (I.boundCodes.has(e.code) || e.code === 'Space')) e.preventDefault(); // menus keep Tab/Space for keyboard navigation
      if (!I.keys.has(e.code)) I.pressed.add(e.code);
      I.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { I.keys.delete(e.code); });
    window.addEventListener('blur', () => { I.keys.clear(); });
    // Pointer position comes from the window so a click on an overlay button seeds it; button codes stay on the canvas (an overlay click never registers Mouse0).
    // The device flips to the mouse on a press or after more than SWITCH_PX of movement within SWITCH_WINDOW_MS, so desk jitter never steals aim from a pad.
    let travel = 0;
    const point = (e, press) => {
      const m = I.mouse, now = performance.now();
      if (m.moved && now - m.moved > SWITCH_WINDOW_MS) travel = 0;
      if (m.moved) travel += Math.hypot(e.clientX - m.x, e.clientY - m.y);
      m.x = e.clientX; m.y = e.clientY; m.moved = now; m.inside = true;
      if (press || travel > SWITCH_PX) { I.device = 'mouse'; travel = 0; }
    };
    window.addEventListener('pointermove', (e) => point(e, false), { passive: true });
    window.addEventListener('pointerdown', (e) => point(e, true), { passive: true });
    const leave = () => { I.mouse.inside = false; }, enter = () => { I.mouse.inside = true; };
    for (const t of [document, document.documentElement]) { t.addEventListener('mouseleave', leave); t.addEventListener('mouseenter', enter); }
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button > 2) e.preventDefault(); // no autoscroll, no history navigation
      const c = 'Mouse' + e.button;
      if (!I.keys.has(c)) I.pressed.add(c);
      I.keys.add(c);
    });
    canvas.addEventListener('auxclick', (e) => { if (e.button !== 0) e.preventDefault(); });
    window.addEventListener('mouseup', (e) => { I.keys.delete('Mouse' + e.button); if (e.button > 2) e.preventDefault(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  const down = (a) => codes[a].some(c => I.keys.has(c) && !masked.has(c));
  I.held = down;
  I.mask = (actions) => { const only = actions ? new Set(actions.flatMap(a => codes[a] || [])) : null; for (const c of I.keys) if (!only || only.has(c)) masked.add(c); const g = navigator.getGamepads ? [...navigator.getGamepads()].find(q => q && q.connected) : null; if (g) g.buttons.forEach((b, i) => { if (b.pressed) masked.add('pad' + i); }); };
  const hit = (a) => codes[a].some(c => I.pressed.has(c));
  const hitCode = (...cs) => cs.some(c => I.pressed.has(c));

  // Snapshot of intent for this frame: { mx, my (move, length <= 1), q, e, dash, pick (1-4 or 0), reroll, skip, esc, confirm, up/down/left/right (menus), padAim (angle, gamepad) }.
  I.read = () => {
    const out = { mx: 0, my: 0, q: false, e: false, dash: false, pick: 0, reroll: false, skip: false, esc: false, confirm: false, up: false, down: false, left: false, right: false };
    if (down('up')) out.my -= 1;
    if (down('down')) out.my += 1;
    if (down('left')) out.mx -= 1;
    if (down('right')) out.mx += 1;
    out.q = hit('skill1'); out.e = false; out.dash = hit('dash');
    out.pick = hit('pick1') ? 1 : hit('pick2') ? 2 : hit('pick3') ? 3 : hit('pick4') ? 4 : 0;
    out.reroll = hit('reroll'); out.skip = hit('skip');
    out.esc = hit('pause') || hitCode('Escape');
    out.confirm = hitCode('Enter', 'NumpadEnter');
    out.up = hit('up'); out.down = hit('down'); out.left = hit('left'); out.right = hit('right');
    for (const c of masked) if (c.indexOf('pad') !== 0 && !I.keys.has(c)) masked.delete(c);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.22) { out.mx += ax; out.my += ay; }
      const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0, rm = Math.hypot(rx, ry), now = performance.now();
      if (rm > PAD_AIM) padLast = { a: Math.atan2(ry, rx), mag: rm, t: now };
      if (padLast && now - padLast.t <= LATCH_MS) { out.padAim = padLast.a; out.padMag = padLast.mag; }
      for (const c of [...masked]) if (c.indexOf('pad') === 0 && !(gp.buttons[+c.slice(3)] && gp.buttons[+c.slice(3)].pressed)) masked.delete(c);
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed && !masked.has('pad' + i);
      const bp = (i) => b(i) && !I.padPrev[i];
      let touch = rm > 0.5 || Math.hypot(ax, ay) > 0.5;
      for (let i = 0; i < gp.buttons.length && !touch; i++) if (bp(i)) touch = true;
      if (touch) I.device = 'pad';
      out.q = out.q || bp(5) || bp(4); out.dash = out.dash || bp(0);
      if (!out.pick) out.pick = bp(2) ? 1 : bp(3) ? 2 : bp(1) ? 3 : bp(7) ? 4 : 0;
      out.esc = out.esc || bp(9);
      out.confirm = out.confirm || bp(0);
      out.up = out.up || bp(12); out.down = out.down || bp(13); out.left = out.left || bp(14); out.right = out.right || bp(15);
      I.padPrev = gp.buttons.map(x => x.pressed);
    } else { padLast = null; if (I.device === 'pad') I.device = 'mouse'; }
    const l = Math.hypot(out.mx, out.my);
    if (l > 1) { out.mx /= l; out.my /= l; }
    return out;
  };

  I.endFrame = () => { I.pressed.clear(); };
  I.setBinds(null);
})(globalThis.ED || (globalThis.ED = {}));
