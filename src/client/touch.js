// Touch controls (client only): floating move stick in the left half (#tc-stick), Q / dash / pause buttons (#tc-q, #tc-dash, #tc-pause) and the first-tap fullscreen + landscape lock.
// The overlay (#touch) shows only in a run while ED.Input.device is 'touch'. Presses latch like key presses: set on pointerdown, read by ED.Input.read, cleared by ED.Input.endFrame.
// ED.Touch: sx, sy (stick, length <= 1), stick { on, ox, oy, x, y } (origin and knob, CSS px), press { q, dash, esc }, rects { q, dash, pause } (CSS px boxes for the HUD dials),
//   inset { l, r, t, b } (safe-area insets, CSS px), shown, init(), sync(show), setSize('s' | 'm' | 'l'), layout(), release().
(function (ED) {
  'use strict';
  const RAD = 60, DEAD = 0.08; // CSS px for full tilt; dead zone as a fraction of RAD
  const SIZES = { s: 56, m: 68, l: 84 }; // button size (CSS px) per Settings touch size
  const T = ED.Touch = {
    sx: 0, sy: 0, stick: { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 }, press: { q: false, dash: false, esc: false },
    rects: { q: null, dash: null, pause: null }, inset: { l: 0, r: 0, t: 0, b: 0 }, shown: false,
  };
  const $ = (id) => document.getElementById(id);
  let root = null, probe = null;

  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  // Re-reads the safe-area insets and the button boxes (after a resize, a size change or the overlay showing).
  T.layout = () => {
    if (!root) return;
    if (probe) { const cs = getComputedStyle(probe); T.inset.l = parseFloat(cs.paddingLeft) || 0; T.inset.r = parseFloat(cs.paddingRight) || 0; T.inset.t = parseFloat(cs.paddingTop) || 0; T.inset.b = parseFloat(cs.paddingBottom) || 0; }
    if (!T.shown) return;
    T.rects.q = box($('tc-q')); T.rects.dash = box($('tc-dash')); T.rects.pause = box($('tc-pause'));
  };
  T.setSize = (s) => { if (root) root.style.setProperty('--tc', (SIZES[s] || SIZES.m) + 'px'); T.layout(); };
  T.release = () => { const st = T.stick; st.on = false; st.id = -1; T.sx = 0; T.sy = 0; T.press.q = T.press.dash = T.press.esc = false; };
  // Shows / hides the overlay; called every frame by ED.Input.read (acts only on a change).
  T.sync = (show) => {
    if (!root || show === T.shown) return;
    T.shown = show; root.hidden = !show;
    if (show) T.layout(); else T.release();
  };

  // Stick value from the knob offset: dead zone, then 0..1 rescaled; the origin follows a finger dragged past RAD.
  const aim = () => {
    const st = T.stick;
    let dx = st.x - st.ox, dy = st.y - st.oy, l = Math.hypot(dx, dy);
    if (l > RAD) { st.ox = st.x - dx / l * RAD; st.oy = st.y - dy / l * RAD; dx = st.x - st.ox; dy = st.y - st.oy; l = RAD; }
    const m = l / RAD;
    if (m < DEAD) { T.sx = 0; T.sy = 0; return; }
    const k = (m - DEAD) / (1 - DEAD) / l;
    T.sx = dx * k; T.sy = dy * k;
  };

  T.init = () => {
    root = $('touch'); if (!root) return;
    try { if (matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('can-touch'); } catch (e) { /* no media queries */ }
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const kill = (e) => { if (e.cancelable) e.preventDefault(); };
    // no compatibility mouse events, double-tap zoom, long-press callout or scroll from the overlay
    root.addEventListener('touchstart', kill, { passive: false });
    root.addEventListener('touchmove', kill, { passive: false });
    root.addEventListener('contextmenu', kill);
    const zone = $('tc-stick'), st = T.stick;
    zone.addEventListener('pointerdown', (e) => {
      if (st.on) return;
      st.on = true; st.id = e.pointerId; st.ox = st.x = e.clientX; st.oy = st.y = e.clientY; T.sx = 0; T.sy = 0;
      try { zone.setPointerCapture(e.pointerId); } catch (er) { /* pointer already gone */ }
      kill(e);
    });
    zone.addEventListener('pointermove', (e) => { if (!st.on || e.pointerId !== st.id) return; st.x = e.clientX; st.y = e.clientY; aim(); });
    const up = (e) => { if (e.pointerId !== st.id) return; st.on = false; st.id = -1; T.sx = 0; T.sy = 0; };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(t, up);
    const btn = (id, key) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => { T.press[key] = true; el.classList.add('down'); kill(e); });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, () => el.classList.remove('down'));
    };
    btn('tc-q', 'q'); btn('tc-dash', 'dash'); btn('tc-pause', 'esc');
    window.addEventListener('resize', T.layout);
    // first touch tap: fullscreen, then landscape lock (iOS Safari has neither; every refusal is ignored). pointerup: touch activation comes on release.
    const standalone = () => { try { return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches; } catch (e) { return false; } };
    const first = (e) => {
      if (e.pointerType !== 'touch') return;
      window.removeEventListener('pointerup', first, true);
      const de = document.documentElement;
      if (document.fullscreenElement || standalone() || !de.requestFullscreen) return;
      try {
        de.requestFullscreen({ navigationUI: 'hide' }).then(() => { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (er) { /* no lock */ } }, () => {});
      } catch (er) { /* refused */ }
    };
    window.addEventListener('pointerup', first, true);
    T.layout();
  };
})(globalThis.ED || (globalThis.ED = {}));
