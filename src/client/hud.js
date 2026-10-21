// Screen-space HUD on its own device-resolution canvas (#hud): hero block, ability slots, party, map + lantern, xp, boss bar, prompts, signs, messages, banners; panels fade while the world is under them.
// Scale unit u mirrors style.css (1u = 1rem). Static art (plates, keycaps, bar fills, portrait) is cached offscreen and rebuilt when u changes.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const H = ED.HUD = {};
  const FD = '"Cinzel", Georgia, serif', FB = '"Alegreya Sans", "Segoe UI", system-ui, sans-serif';
  const K = { line: '#4a3626', brass: '#8a6a42', brassHi: '#c9a063', ember: '#ff8a3d', emberHi: '#ffb56b', gold: '#f0cf8a', bone: '#f6ecda', muted: '#c5b49d', faint: '#8f7f6c', danger: '#ef5a46', good: '#8fdc98', warm: '#ffd9a0' };
  const TIER = [['Bright', '#ffd36b'], ['Dim', '#e6a050'], ['Dark', '#c0603a'], ['Lightless', '#a83232']];

  let cv = null, c = null, W = 0, Hh = 0, hd = 1, u = 13, cssW = 0, cssH = 0, lowQ = false, shown = false, dtc = 0, rk = 1, lastDpr = 0;
  let frameN = 0, drawSeq = 0, lastDrawT = 0, dtAcc = 0, fdt = 0, forceDirty = true; // redraw scheduling (see H.draw)
  const L = {}; // layout rects in canvas px, rebuilt with u
  const ghost = {}, slotFx = [], lantern = { view: null, tier: 0, hint: '', t: 99, fx: '', fxTier: -1 };
  // Panel fade: a panel eases to FADE_MIN alpha while a hero, foe or pickup is under it (held FADE_HOLD s after the last overlap), then back. ga = alpha of the panel being drawn.
  const FADE_MIN = 0.35, FADE_RATE = (1 - FADE_MIN) / 0.15, FADE_HOLD = 0.2, FP_MAX = 640;
  const fade = {}, fp = new Float32Array(FP_MAX * 3); // fp: x, y, radius of each world object in canvas px
  let ga = 1, fpN = 0;
  const mk = (w, h) => { const e = document.createElement('canvas'); e.width = Math.max(1, w); e.height = Math.max(1, h); return e; };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ---------------- cached art ----------------
  // Every cached image is a canvas first and swaps to an ImageBitmap once ready (Gecko pays per source canvas, not per bitmap); entries are { cv, ... } objects released on eviction.
  const Bmp = ED.Bmp, art = new Map(), caps = new Map(), wraps = new Map(), texts = new Map(), wcache = new Map();
  const hold = (e) => { const g = e.cv; Bmp.from(g, (b) => { if (e.dead) Bmp.free(b); else e.cv = b; }); return e; };
  const dropMap = (m) => { for (const e of m.values()) { e.dead = true; Bmp.free(e.cv); } m.clear(); };
  let medal = null, medalKey = '';
  const dropArt = () => { dropMap(art); dropMap(caps); dropMap(texts); wraps.clear(); wcache.clear(); if (medal) { medal.dead = true; Bmp.free(medal.cv); } medal = null; medalKey = ''; forceDirty = true; };
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const lw = () => Math.max(2, Math.round(u * 0.09));

  // Soot plate: gradient fill, 2px line, black inset rim, brass L-brackets, soft drop shadow. Returns {cv, pad}.
  function plateArt(w, h, bl) {
    const key = 'p' + w + 'x' + h + '|' + (bl === undefined ? '' : Math.round(bl)); let e = art.get(key); if (e) return e;
    if (art.size > 90) dropMap(art);
    const pad = Math.ceil(u * 1.3), g = (mk(w + 2 * pad, h + 2 * pad)), x = g.getContext('2d'), r = u * 0.3, l = lw();
    x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = u * 0.9; x.shadowOffsetY = u * 0.3;
    const gr = x.createLinearGradient(0, pad, 0, pad + h); gr.addColorStop(0, 'rgba(32,24,17,0.94)'); gr.addColorStop(1, 'rgba(17,12,9,0.95)');
    rr(x, pad, pad, w, h, r); x.fillStyle = gr; x.fill();
    x.shadowColor = 'transparent';
    rr(x, pad + l / 2, pad + l / 2, w - l, h - l, r); x.strokeStyle = K.line; x.lineWidth = l; x.stroke();
    rr(x, pad + l + 0.5, pad + l + 0.5, w - 2 * l - 1, h - 2 * l - 1, r * 0.6); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1; x.stroke();
    x.fillStyle = 'rgba(255,214,160,0.07)'; x.fillRect(pad + l * 2, pad + l, w - l * 4, 1);
    const n = bl === 0 ? 0 : (bl || u * 1.1); // bracket length
    if (n) {
      x.strokeStyle = K.brassHi; x.lineWidth = l; x.lineCap = 'butt';
      for (const sx of [0, 1]) for (const sy of [0, 1]) {
        const cx = pad + (sx ? w - l / 2 : l / 2), cy = pad + (sy ? h - l / 2 : l / 2), dx = sx ? -1 : 1, dy = sy ? -1 : 1;
        x.beginPath(); x.moveTo(cx + dx * n, cy); x.lineTo(cx, cy); x.lineTo(cx, cy + dy * n); x.stroke();
      }
    }
    e = hold({ cv: g, pad }); art.set(key, e); return e;
  }
  const plate = (x, y, w, h, bl) => { w = Math.round(w); h = Math.round(h); const e = plateArt(w, h, bl); c.drawImage(e.cv, Math.round(x) - e.pad, Math.round(y) - e.pad); };

  // Bar fill sprite: vertical sheen from the base colour. Returns { cv, h }.
  function fillArt(col, h) {
    h = Math.max(2, Math.round(h)); const key = 'f' + col + h; let e = art.get(key); if (e) return e;
    const g = mk(4, h), x = g.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, U.mix(col, '#ffffff', 0.45)); gr.addColorStop(0.2, U.mix(col, '#ffffff', 0.12)); gr.addColorStop(0.55, col); gr.addColorStop(1, U.mix(col, '#000000', 0.5));
    x.fillStyle = gr; x.fillRect(0, 0, 4, h); e = hold({ cv: g, h }); art.set(key, e); return e;
  }
  // Trough + optional damage ghost + fill; ticks = fractions drawn as dark notches.
  function bar(x, y, w, h, frac, col, ghostF, ticks) {
    const b = Math.max(1, Math.round(u * 0.07));
    c.fillStyle = '#000'; c.fillRect(x - b, y - b, w + 2 * b, h + 2 * b);
    c.fillStyle = '#1b120d'; c.fillRect(x, y, w, h);
    if (ghostF > frac) { c.fillStyle = 'rgba(255,238,214,0.55)'; c.fillRect(x, y, w * clamp01(ghostF), h); }
    if (frac > 0) { const f = fillArt(col, h); c.drawImage(f.cv, 0, 0, 4, f.h, x, y, w * clamp01(frac), h); }
    if (ticks) { c.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i < ticks.length; i++) c.fillRect(Math.round(x + w * ticks[i]) - 1, y, 2, h); }
  }

  // Keycap (cached per label): hot = ember fill for the interact prompt. Returns { cv, w, h }.
  function capArt(label, hot) {
    const key = label + '|' + (hot ? 1 : 0); let e = caps.get(key); if (e) return e;
    if (caps.size > 60) dropMap(caps);
    const px = u * 0.95, m = mk(4, 4).getContext('2d'); m.font = `800 ${px.toFixed(1)}px ${FB}`;
    const w = Math.ceil(Math.max(u * 1.8, m.measureText(label).width + u * 1.0)), h = Math.ceil(u * 1.6), g = mk(w, h), x = g.getContext('2d'), l = lw();
    const gr = x.createLinearGradient(0, 0, 0, h); if (hot) { gr.addColorStop(0, '#ffcd94'); gr.addColorStop(1, '#ee7a2c'); } else { gr.addColorStop(0, '#34271d'); gr.addColorStop(1, '#1a1310'); }
    rr(x, 0, 0, w, h, u * 0.3); x.fillStyle = gr; x.fill();
    rr(x, l / 2, l / 2, w - l, h - l, u * 0.28); x.strokeStyle = hot ? '#ffe2c0' : K.brass; x.lineWidth = l; x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(l, h - l * 2, w - 2 * l, l);
    x.font = `800 ${px.toFixed(1)}px ${FB}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = hot ? '#1b0f08' : K.gold; x.fillText(label, w / 2, h * 0.46);
    e = hold({ cv: g, w, h }); caps.set(key, e); return e;
  }

  // Hero medallion: portrait in a player-colour ring, cached per hero look. Returns { cv, w, h }.
  function medallion(me) {
    const key = me.cls + '|' + me.slot + '|' + me.weapon + '|' + u;
    if (medalKey === key && medal) return medal;
    if (medal) { medal.dead = true; Bmp.free(medal.cv); }
    const D = Math.round(u * 4.9), r = D / 2, l = lw(), cvs = mk(D, D), g = cvs.getContext('2d');
    const bg = g.createRadialGradient(r, r * 0.8, r * 0.1, r, r, r); bg.addColorStop(0, '#33271d'); bg.addColorStop(1, '#0d0806');
    g.fillStyle = bg; g.beginPath(); g.arc(r, r, r - l, 0, TAU); g.fill();
    const pc = mk(D, D); ED.Sprites.portrait(pc, me.cls, me.slot, me.weapon);
    g.save(); g.beginPath(); g.arc(r, r, r - l, 0, TAU); g.clip(); g.drawImage(pc, 0, 0); g.restore();
    g.lineWidth = l * 1.8; g.strokeStyle = ED.PLAYER_COLORS[me.slot] || K.gold; g.beginPath(); g.arc(r, r, r - l * 0.9, 0, TAU); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.beginPath(); g.arc(r, r, r - l * 1.9, 0, TAU); g.stroke();
    medal = hold({ cv: cvs, w: D, h: D }); medalKey = key; return medal;
  }

  // ---------------- text ----------------
  // Text is drawn as cached sprites (one canvas per distinct string, then an ImageBitmap): changing strings cost a bake, unchanged ones a blit.
  const mc = document.createElement('canvas').getContext('2d'); // measuring context
  const fontStr = (wt, px, fam) => wt + ' ' + px.toFixed(1) + 'px ' + (fam || FB);
  // Advance width of s (cached per string and font).
  function adv(s, px, wt, fam) {
    const f = fontStr(wt || 700, px, fam), key = f + '|' + s; let w = wcache.get(key); if (w !== undefined) return w;
    if (wcache.size > 800) wcache.clear();
    mc.font = f; w = mc.measureText(s).width; wcache.set(key, w); return w;
  }
  function textArt(s, px, col, fam, wt, ol) {
    const f = fontStr(wt, px, fam), key = f + '|' + col + '|' + (ol ? 1 : 0) + '|' + s; let e = texts.get(key); if (e) return e;
    if (texts.size > 450) dropMap(texts);
    mc.font = f; const ad = mc.measureText(s).width;
    const lwid = ol ? Math.max(2, px * 0.22) : 0, pad = Math.ceil(lwid / 2) + 2, w = Math.ceil(ad) + 2 * pad, h = Math.ceil(px * 1.6) + 2 * pad;
    const cvs = mk(w, h), g = cvs.getContext('2d'); g.font = f; g.textBaseline = 'middle'; g.textAlign = 'left';
    if (ol) { g.lineJoin = 'round'; g.lineWidth = lwid; g.strokeStyle = 'rgba(8,5,4,0.9)'; g.strokeText(s, pad, h / 2); }
    g.fillStyle = col; g.fillText(s, pad, h / 2);
    e = hold({ cv: cvs, w, h, pad, adv: ad }); texts.set(key, e); return e;
  }
  const T = (s, x, y, px, col, fam, al, wt, ol) => {
    const e = textArt(String(s), px, col, fam || FB, wt || 700, ol), ox = al === 'center' ? e.pad + e.adv / 2 : al === 'right' ? e.pad + e.adv : e.pad;
    c.drawImage(e.cv, Math.round(x - ox), Math.round(y - e.h / 2));
  };
  // Word-wrap to maxW px, at most maxLines (last line gets an ellipsis). Cached per string and size.
  function wrap(s, maxW, px, wt, maxLines) {
    const key = s + '|' + Math.round(maxW) + '|' + Math.round(px) + '|' + (maxLines || 0); let r = wraps.get(key); if (r) return r;
    if (wraps.size > 160) wraps.clear();
    mc.font = fontStr(wt || 700, px, FB);
    r = []; let cur = '';
    for (const w of String(s).split(' ')) { const t = cur ? cur + ' ' + w : w; if (mc.measureText(t).width > maxW && cur) { r.push(cur); cur = w; } else cur = t; }
    if (cur) r.push(cur);
    if (maxLines && r.length > maxLines) { r.length = maxLines; let l = r[maxLines - 1]; while (l.length > 1 && mc.measureText(l + '…').width > maxW) l = l.slice(0, -1); r[maxLines - 1] = l + '…'; }
    wraps.set(key, r); return r;
  }
  const pill = (x, y, w, h, col, fa) => { rr(c, x, y, w, h, h / 2); c.fillStyle = U.rgba(col, fa === undefined ? 0.2 : fa); c.fill(); c.lineWidth = Math.max(1.5, u * 0.07); c.strokeStyle = U.rgba(col, 0.85); c.stroke(); };
  const ic = (g, name, col, x, y, s) => g.drawImage(ED.Icons.canvas(name, col, s > 44 ? 128 : 64), x, y, s, s);

  // Weapon name with its evolution prefix ('Cinder Longsword'); falls back to the class name before stats exist.
  H.weaponName = (p) => {
    const st = p.stats, w = st && st.weapon, ep = st && st.evo && ED.PATHS[st.evo];
    return w ? (ep ? ep.evo + ' ' : '') + w.name : ED.CLASSES[p.cls].name;
  };

  // ---------------- canvas + layout ----------------
  // Creates #hud above #game on first use and keeps it at device resolution (capped by pixel count); returns false when unusable.
  function sync() {
    const R = ED.Render;
    if (!cv) {
      const game = document.getElementById('game'); if (!game) return false;
      cv = document.createElement('canvas'); cv.id = 'hud'; cv.setAttribute('aria-hidden', 'true');
      game.parentNode.insertBefore(cv, game.nextSibling);
      c = cv.getContext('2d');
      if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', dropArt);
    }
    const w = window.innerWidth, h = window.innerHeight, soft = !!(ED.Post && ED.Post.soft), low = R.quality === 'low' || soft;
    if (!shown) { cv.style.display = 'block'; shown = true; document.body.classList.add('hud-on'); forceDirty = true; }
    const dpr = window.devicePixelRatio || 1;
    if (w !== cssW || h !== cssH || low !== lowQ || dpr !== lastDpr) {
      cssW = w; cssH = h; lowQ = low; lastDpr = dpr;
      // software raster: the HUD backs at most 1.1 MP like the world canvas (sub-CSS resolution), else device pixels up to 2x / 6 MP
      hd = soft ? Math.min(1, Math.sqrt(1.1e6 / (w * h))) : Math.max(1, Math.min(dpr, low ? 1 : 2, Math.sqrt(6e6 / (w * h))));
      cv.width = W = Math.round(w * hd); cv.height = Hh = Math.round(h * hd);
      u = U.clamp(Math.min(w / 110, h / 62), 13, 36) * hd;
      c.textBaseline = 'middle';
      dropArt(); layout();
    }
    rk = hd / (R.dpr || 1);
    return true;
  }
  H.dirty = () => { forceDirty = true; }; // next draw repaints (tests, external invalidation)
  H.clear = () => { if (cv && shown) { cv.style.display = 'none'; shown = false; document.body.classList.remove('hud-on'); } };

  function layout() {
    const m = u * 1.2;
    L.m = m;
    L.hw = u * 26.5; L.hh = u * 6.2; L.hx = m; L.hy = Hh - m - L.hh;
    L.ss = u * 4; L.sg = u * 0.5; L.sx = m; L.sy = L.hy - u * 1.1 - L.ss;
    L.ch = u * 1.7; L.cy = L.sy - u * 0.5 - L.ch;
    L.pw = u * 18; L.ph = u * 3.5;
    L.mw = u * 19; L.mx = W - m - L.mw; L.my = m; L.mh = u * 17.9;
    L.lh = u * 10.8; L.ly = L.my + L.mh + u * 0.6;
    L.xw = U.clamp(W - 2 * (L.hx + L.hw + u * 1.5), u * 22, u * 40); L.xh = u * 3.6; L.xx = Math.max((W - L.xw) / 2, L.hx + L.hw + u * 0.8); L.xw = Math.min(L.xw, W - m - L.xx); L.xy = Hh - m - L.xh;
    L.bw = Math.min(u * 55, W - 2 * (L.mw + m * 2)); // boss plate width, clear of the map column
  }

  // ---------------- panel fade ----------------
  // Screen points of every living hero, foe and pickup (same affine as R.toScreen, taken once per frame).
  function focusPoints(view) {
    const R = ED.Render, a = R.toScreen(0, 0), b = R.toScreen(1, 0), sc = (b.x - a.x) * rk, ox = a.x * rk, oy = a.y * rk;
    let n = 0;
    const put = (x, y, r) => { if (n < FP_MAX) { const i = n++ * 3; fp[i] = ox + x * sc; fp[i + 1] = oy + y * sc; fp[i + 2] = r * sc; } };
    for (const p of view.players.values()) if (!p.dead) put(p.x, p.y - 12, 14);
    for (const e of view.enemies) if (e.hp > 0 && !e.burrowed) put(e.x, e.y - e.r - (e.def.fly ? 8 : 0), e.r * 1.3);
    for (const k of view.pickups) put(k.x, k.y - 6, 8);
    const s = ED.Game.s, I = ED.Input, m = I.mouse; // the cursor while attacking or previewing a ground skill (screen space, radius 1.2u)
    if (s && s.aim && s.aim.pointer && m.inside && n < FP_MAX && (s.aim.ground.length || I.held('attack'))) { const i = n++ * 3; fp[i] = m.x * R.dpr * rk; fp[i + 1] = m.y * R.dpr * rk; fp[i + 2] = 1.2 * u; }
    fpN = n;
  }
  // Steps panel f's fade once per frame against the focus points (its rect is the one it was last drawn with).
  function stepFade(f) {
    if (f.n === frameN) return;
    f.n = frameN;
    const x = f.x, y = f.y, w = f.w, h = f.h, mg = u * 0.4;
    let hit = false;
    for (let i = 0, n = fpN * 3; i < n; i += 3) { const r = fp[i + 2] + mg; if (fp[i] + r > x && fp[i] - r < x + w && fp[i + 1] + r > y && fp[i + 1] - r < y + h) { hit = true; break; } }
    if (hit) f.hold = FADE_HOLD; else if (f.hold > 0) f.hold -= fdt;
    const tgt = f.hold > 0 ? FADE_MIN : 1, st = FADE_RATE * fdt;
    f.a = f.a < tgt ? Math.min(tgt, f.a + st) : Math.max(tgt, f.a - st);
  }
  // Panels drawn last time keep fading on frames that skip the redraw, so the HUD knows when their alpha moved.
  function fadeTick() { for (const k in fade) { const f = fade[k]; if (f.seq === drawSeq) stepFade(f); } }
  // Starts drawing panel `key` (canvas-px rect) at its faded alpha; endFade() restores full alpha.
  function fadeStart(key, x, y, w, h) {
    const f = fade[key] || (fade[key] = { a: 1, hold: 0, n: -1, seq: -1, drawn: 1, x, y, w, h });
    f.x = x; f.y = y; f.w = w; f.h = h; f.seq = drawSeq;
    stepFade(f); f.drawn = f.a;
    c.globalAlpha = ga = f.a;
  }
  const endFade = () => { c.globalAlpha = ga = 1; };

  // ---------------- redraw scheduling ----------------
  // The HUD canvas keeps its pixels between frames: it is redrawn only when a signature of the displayed values changed, when an animation runs (at most 60 redraws per second),
  // or every STALE seconds as a safety net. Continuously changing values (cooldown sweeps, bar ghosts, pulses) are not part of the signature: they set `anim` instead.
  const SG_MAX = 768, STALE = 0.25, ANIM_GAP = 0.0158;
  let sg = new Float64Array(SG_MAX), prevSg = new Float64Array(SG_MAX), sgN = 0, prevN = -1, anim = false;
  const ids = new Map();
  const sid = (s) => { let i = ids.get(s); if (i === undefined) { if (ids.size > 4000) { ids.clear(); forceDirty = true; } i = ids.size + 1; ids.set(s, i); } return i; };
  const sp = (v) => { if (sgN < SG_MAX) sg[sgN++] = v; };
  const pipList = [];
  // Owned path gates with their affinity as [id, affinity, ...] (shared by the hero block's signature).
  function pips(me) {
    pipList.length = 0;
    const gates = me.boons ? ED.gatePaths(me.boons) : [];
    for (const g of gates) pipList.push(g, ED.pathAffinity(me.boons, g));
    return pipList;
  }
  const floorIds = new WeakMap(); let floorN = 0;
  function buildSig(view, me, ctl, extra) {
    const F = ED.FX, I = ED.Input, R = ED.Render;
    sp(F.fade > 0 ? 1 : 0); if (F.fade > 0) anim = true;
    sp(F.flash ? 1 : 0); if (F.flash) anim = true;
    sp(me ? 1 : 0);
    if (!me) return;
    sp(me.downed ? 1 : 0); sp(me.dead ? 1 : 0); sp(view.stratum | 0); sp(view.pact | 0); sp(view.players.size);
    // hero block
    const st = me.stats, frac = me.maxHp > 0 ? me.hp / me.maxHp : 0, cls = ED.CLASSES[me.cls], gk = 'p' + me.pid;
    sp(sid(me.name)); sp(sid(me.cls)); sp(me.slot | 0); sp(sid(String(me.weapon))); sp(Math.ceil(me.hp)); sp(me.maxHp); sp(Math.ceil(me.shield || 0)); sp(Math.round(frac * 1024)); sp(sid(H.weaponName(me)));
    if ((ghost[gk] !== undefined && ghost[gk] > frac + 0.0005) || (frac < 0.3 && me.hp > 0)) anim = true; // damage ghost easing out, low-health pulse
    const FL = ED.World.FLARE, canFlare = view.lightMax > 0 && view.light >= FL.cost && !(view.room && view.room.type === 'boss');
    const scd = ctl.skillCd > 0 && ctl.charges <= 0 ? ctl.skillCd : 0;
    sp(sid(I.label('skill1'))); sp(scd > 0 ? 1 : 0); sp(ctl.charges | 0); sp(st ? st.maxCharges | 0 : 1); sp(st ? Math.round(st.skillCd * 100) : 0);
    const s2 = cls.skill2 && ED.SKILLS[cls.skill2], cd2 = ctl.skill2Cd > 0 ? ctl.skill2Cd : 0;
    if (s2) { sp(sid(I.label('skill2'))); sp(cd2 > 0 ? 1 : 0); sp(me.bulwarkT > 0 ? 1 : 0); sp(Math.round(((st && st.skill2Cd) || s2.cd) * 100)); if (cd2 > 0.04) anim = true; }
    sp(sid(I.label('dash'))); sp(ctl.dashCd > 0 ? 1 : 0); sp(st ? Math.round(st.dashCd * 100) : 0);
    sp(sid(I.label('flare'))); sp(canFlare ? 1 : 0); sp(view.lightMax > 0 ? 1 : 0);
    if (scd > 0.04 || ctl.dashCd > 0.04) anim = true; // sweeps
    for (const fx of slotFx) if (fx && fx.t > 0) anim = true; // ready flash
    const pl = pips(me); sp(pl.length); for (let i = 0; i < pl.length; i += 2) { sp(sid(pl[i])); sp(pl[i + 1]); } sp(sid(st && st.evo || ''));
    sp(st && st.aegis && (me.aegisT || 0) <= 0 ? 1 : 0); sp((me.guardT || 0) > 0 ? 1 : 0); sp(me.critStacks || 0); sp((me.secondWind || 0) > 0 ? 1 : 0); sp(st && st.phoenix && !me.phoenixUsed ? 1 : 0);
    // party
    for (const p of view.players.values()) {
      if (p.pid === me.pid) continue;
      sp(sid(p.pid)); sp(sid(p.name)); sp(sid(p.cls)); sp(p.slot | 0); sp(p.dead ? 1 : 0); sp(p.downed ? 1 : 0); sp(Math.round((p.dead ? 0 : p.downed ? clamp01(p.revive || 0) : p.hp / p.maxHp) * 512));
    }
    // map
    const fl = view.floor;
    if (fl) {
      let id = floorIds.get(fl); if (!id) floorIds.set(fl, id = ++floorN);
      sp(id); sp(view.roomId | 0);
      const rs = view.roomState || {}; let h = 0;
      for (const r of fl.rooms) { const s = rs[r.id]; h = (h * 7 + (s ? (s.known ? 1 : 0) | (s.visited ? 2 : 0) | (s.cleared ? 4 : 0) : 0)) | 0; }
      sp(h);
    } else sp(0);
    // lantern
    const lf = view.lightMax > 0 ? clamp01(view.light / view.lightMax) : 0, tier = U.clamp((view.dread && view.dread.tier) | 0, 0, 3);
    sp(view.lightMax > 0 ? 1 : 0); sp(Math.round(lf * 2048)); sp(tier);
    if (view.lightMax > 0 && (tier === 3 || (lantern.t < 6 && lantern.hint) || lantern.view !== view)) anim = true; // pulse, tier-change hint fade
    // xp
    sp(view.level | 0); sp(Math.round(view.xp / (view.xpNext || 1) * 1024)); sp(view.gold | 0); sp(ctl.picks | 0); sp(ctl.offerOpen ? 1 : 0); sp(sid(view.waitMsg || ''));
    if ((ctl.picks | 0) > 0 && !ctl.offerOpen) anim = true;
    // relics
    const rl = me.relics; sp(rl ? rl.length : 0); if (rl) for (let i = 0; i < rl.length; i++) sp(sid(rl[i]));
    // boss bar
    let boss = null; const en = view.enemies;
    for (let i = 0; i < en.length; i++) if (en[i].boss && en[i].hp > 0) { boss = en[i]; break; }
    if (boss) { const fr = boss.hp / boss.maxHp; sp(boss.id); sp(Math.round(fr * 1024)); sp(boss.exposed ? 1 : 0); sp(sid(boss.def.name)); if (ghost.boss !== undefined && ghost.boss > fr + 0.0005) anim = true; } else sp(0);
    // prompt and sign (their screen position follows the world)
    const pr = extra.prompt;
    if (pr) { const s = R.toScreen(pr.x, pr.y - 46); sp(1); sp(sid(pr.text)); sp(sid(pr.desc || '')); sp(sid(pr.color || '')); sp(pr.can === false ? 1 : 0); sp(sid(I.hint('attack'))); sp(Math.round(s.x * rk)); sp(Math.round(s.y * rk)); } else sp(0);
    const sg2 = R.sign;
    if (sg2) { const s = R.toScreen(sg2.x, me.y >= sg2.y ? sg2.y - 36 : sg2.y + 8); sp(1); sp(sid(String(sg2.text))); sp(me.y >= sg2.y ? 1 : 0); sp(Math.round(s.x * rk)); sp(Math.round(s.y * rk)); } else sp(0);
    // messages and banner
    const ms = F.msgs; sp(ms.length);
    for (let i = 0; i < ms.length; i++) { sp(sid(ms[i].text)); sp(sid(ms[i].color)); if (ms[i].t < 1) anim = true; }
    const b = F.banner;
    if (b && !extra.offerOpen) { sp(1); sp(sid(b.title)); sp(sid(b.sub || '')); sp(sid(b.style)); anim = true; } else sp(0);
    sp(extra.offerOpen ? 1 : 0);
  }
  // True when the HUD must be repainted this frame.
  function schedule(view, me, ctl, extra, t) {
    sgN = 0; anim = false;
    buildSig(view, me, ctl, extra);
    let changed = forceDirty || sgN !== prevN;
    if (!changed) for (let i = 0; i < sgN; i++) if (sg[i] !== prevSg[i]) { changed = true; break; }
    if (!changed) for (const k in fade) { const f = fade[k]; if (f.seq === drawSeq && Math.abs(f.a - f.drawn) > 0.004) { anim = true; break; } }
    if (!changed) {
      if (anim ? dtAcc < ANIM_GAP : t - lastDrawT < STALE) return false;
    }
    const tmp = prevSg; prevSg = sg; sg = tmp; prevN = sgN; forceDirty = false;
    return true;
  }

  // ---------------- main draw ----------------
  H.draw = (_c, view, me, ctl, t, dt, extra) => {
    if (!sync()) return;
    frameN++; dtAcc += dt; fdt = dt;
    if (me) { focusPoints(view); fadeTick(); }
    if (!schedule(view, me, ctl, extra, t)) return;
    dtc = dtAcc; dtAcc = 0; lastDrawT = t; drawSeq++;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = ga = 1; c.clearRect(0, 0, W, Hh);
    const F = ED.FX;
    if (F.flash) { c.fillStyle = U.rgba(F.flash.color, F.flash.a * (F.flash.t / 0.3)); c.fillRect(0, 0, W, Hh); }
    if (me && me.downed) {
      const g = c.createRadialGradient(W / 2, Hh / 2, Hh * 0.2, W / 2, Hh / 2, Hh * 0.8);
      g.addColorStop(0, 'rgba(60,0,0,0)'); g.addColorStop(1, 'rgba(90,0,0,0.6)'); c.fillStyle = g; c.fillRect(0, 0, W, Hh);
    }
    if (me) {
      const biome = ED.biomeFor(view.stratum);
      const chips = heroBlock(view, me, ctl, t);
      party(view, me);
      mapBlock(view, biome, t);
      lanternBlock(view, t);
      xpBlock(view, ctl, extra, t);
      relics(me);
      bossBar(view, t);
      if (extra.prompt) prompt(extra.prompt);
      centerNotes(view, me, t);
      signPanel(me);
      messages(chips);
      banners(F, biome, extra);
    }
    if (F.fade > 0) { c.fillStyle = `rgba(0,0,0,${Math.min(1, F.fade)})`; c.fillRect(0, 0, W, Hh); }
  };

  // ---------------- hero block (bottom-left) ----------------
  function heroBlock(view, me, ctl, t) {
    const cls = ED.CLASSES[me.cls], st = me.stats, I = ED.Input;
    const x = L.hx, y = L.hy, w = L.hw, h = L.hh;
    fadeStart('hero', x, L.sy, u * 29, Hh - L.sy);
    plate(x, y, w, h);
    const frac = me.maxHp > 0 ? me.hp / me.maxHp : 0, low = frac < 0.3 && me.hp > 0, pulse = 0.5 + 0.5 * Math.sin(t * 7);
    if (low) { rr(c, x, y, w, h, u * 0.3); c.strokeStyle = U.rgba(K.danger, 0.35 + 0.5 * pulse); c.lineWidth = lw() * 1.5; c.stroke(); }
    const med = medallion(me); c.drawImage(med.cv, Math.round(x + u * 0.8), Math.round(y + (h - med.h) / 2));
    const bx = x + u * 6.4, bw = w - u * 7.4;
    T(me.name, bx, y + u * 1.55, u * 1.25, K.gold, FD, 'left', 700);
    const evoP = st && st.evo && ED.PATHS[st.evo];
    T(evoP ? H.weaponName(me) : cls.name, bx + bw, y + u * 1.55, u * 0.95, evoP ? evoP.color : K.muted, FB, 'right', 700);
    const gk = 'p' + me.pid; ghost[gk] = ghost[gk] === undefined ? frac : Math.max(frac, ghost[gk] - dtc * 0.35);
    const by = y + u * 2.8, bh = u * 2.4, shield = me.shield || 0;
    bar(bx, by, bw, bh, frac, frac > 0.35 ? '#d9443a' : U.mix('#ff2a1a', '#ff7a5a', pulse), ghost[gk], [0.25, 0.5, 0.75]);
    if (shield > 0) { // shield: a pale segment after the health (clipped to the bar end), absorbs damage first
      const sf = U.clamp(shield / me.maxHp, 0.03, 1), s0 = Math.min(clamp01(frac), 1 - sf), sp = fillArt('#cfe3ff', bh);
      c.drawImage(sp.cv, 0, 0, 4, sp.h, bx + bw * s0, by, bw * sf, bh);
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(bx + bw * s0, by, Math.max(2, u * 0.12), bh);
    }
    T(`${Math.ceil(me.hp)} / ${me.maxHp}` + (shield > 0 ? ` +${Math.ceil(shield)}` : ''), bx + bw / 2, by + bh / 2 + u * 0.05, u * 1.2, '#ffffff', FB, 'center', 800, true);

    // ability slots
    const FL = ED.World.FLARE, canFlare = view.lightMax > 0 && view.light >= FL.cost && !(view.room && view.room.type === 'boss');
    let i = 0;
    const sk = ED.SKILLS[cls.skill];
    const scd = ctl.skillCd > 0 && ctl.charges <= 0 ? ctl.skillCd : 0, mx = st ? st.maxCharges : 1;
    slot(i++, I.label('skill1'), scd, st ? st.skillCd : sk.cd, ctl.charges > 0, sk.icon, cls.col.c, ctl.charges, mx, 0);
    const s2 = cls.skill2 && ED.SKILLS[cls.skill2];
    if (s2) {
      const tot = Math.max(0.1, (st && st.skill2Cd) || s2.cd), up = me.bulwarkT > 0, cd2 = ctl.skill2Cd > 0 ? ctl.skill2Cd : 0;
      slot(i++, I.label('skill2'), cd2, tot, cd2 <= 0 && !up, s2.icon, up ? '#ffe9a0' : cls.col.c, 0, 1, 0);
    }
    const dcd = ctl.dashCd > 0 ? ctl.dashCd : 0;
    slot(i++, I.label('dash'), dcd, st ? st.dashCd : 1, dcd <= 0, 'wing', '#bfe9ff', 0, 1, 0);
    if (view.lightMax > 0) slot(i++, I.label('flare'), 0, 1, canFlare, 'lantern', '#ffb35c', 0, 1, FL.cost);

    // path pips: each owned gate with its affinity ring (keystone tick, evolution at full); a star on the evolved path
    const gates = me.boons ? ED.gatePaths(me.boons) : [];
    const pr = u * 1.45, px0 = L.sx + i * (L.ss + L.sg) + u * 0.5 + pr, py = L.sy + L.ss / 2;
    for (let g = 0; g < gates.length; g++) {
      const P = ED.PATHS[gates[g]], aff = ED.pathAffinity(me.boons, gates[g]), cx = px0 + g * u * 3.2, evolved = st && st.evo === gates[g];
      c.lineWidth = u * 0.28; c.strokeStyle = 'rgba(0,0,0,0.65)'; c.beginPath(); c.arc(cx, py, pr, 0, TAU); c.stroke();
      const evoAff = ED.evoAffinity(gates[g]);
      c.strokeStyle = P.color; c.beginPath(); c.arc(cx, py, pr, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(aff / evoAff)); c.stroke();
      const kt = -Math.PI / 2 + TAU * (ED.keyAffinity(gates[g]) / evoAff); c.strokeStyle = K.bone; c.lineWidth = Math.max(1.5, u * 0.1); c.beginPath(); c.moveTo(cx + Math.cos(kt) * (pr - u * 0.22), py + Math.sin(kt) * (pr - u * 0.22)); c.lineTo(cx + Math.cos(kt) * (pr + u * 0.22), py + Math.sin(kt) * (pr + u * 0.22)); c.stroke();
      ic(c, P.icon, P.color, cx - u * 1.05, py - u * 1.05, u * 2.1);
      pill(cx + u * 0.15, py + u * 0.45, u * 1.6, u * 1.3, '#120c09', 0.92);
      T(String(aff), cx + u * 0.95, py + u * 1.12, u * 0.95, P.color, FB, 'center', 800);
      if (evolved) ic(c, 'star', '#ffd36b', cx + u * 0.35, py - pr - u * 0.4, u * 1.2);
    }

    // status chips above the slots
    let sx = L.sx, any = false;
    const chip = (label, col) => { const cw = adv(label, u * 0.95, 800) + u * 1.3; pill(sx, L.cy, cw, L.ch, col); T(label, sx + cw / 2, L.cy + L.ch / 2 + u * 0.05, u * 0.95, col, FB, 'center', 800); sx += cw + u * 0.4; any = true; };
    if (st && st.aegis && (me.aegisT || 0) <= 0) chip('Aegis', '#7fc8ff');
    if ((me.guardT || 0) > 0) chip('Last Stand', '#ffd36b');
    if ((me.critStacks || 0) > 0) chip('Crit ×' + me.critStacks, '#b78cff');
    if ((me.secondWind || 0) > 0) chip('Second Wind', '#86d38f');
    if (st && st.phoenix && !me.phoenixUsed) chip('Phoenix', '#ffb02e');
    endFade();
    return any;
  }

  // One ability slot: plate, icon, cooldown sweep + seconds, ready ring and flash, charge pips, cost tag, keycap.
  function slot(i, key, secs, total, ready, icon, col, charges, maxCharges, cost) {
    const x = L.sx + i * (L.ss + L.sg), y = L.sy, s = L.ss, ins = u * 0.3, fx = slotFx[i] || (slotFx[i] = { r: ready, t: 0 });
    if (ready && !fx.r) fx.t = 0.5; fx.r = ready; if (fx.t > 0) fx.t -= dtc;
    plate(x, y, s, s, u * 0.6);
    c.globalAlpha = ga * (ready ? 1 : 0.42); ic(c, icon, col, x + ins, y + ins, s - 2 * ins); c.globalAlpha = ga;
    if (secs > 0.04 && total > 0) {
      c.save(); c.beginPath(); c.rect(x + ins * 0.5, y + ins * 0.5, s - ins, s - ins); c.clip();
      c.fillStyle = 'rgba(6,4,3,0.72)'; c.beginPath(); c.moveTo(x + s / 2, y + s / 2); c.arc(x + s / 2, y + s / 2, s, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(secs / total)); c.closePath(); c.fill();
      c.restore();
      T(secs >= 10 ? String(Math.ceil(secs)) : secs.toFixed(1), x + s / 2, y + s / 2, u * 1.4, K.bone, FB, 'center', 900, true);
    }
    if (ready) { rr(c, x + 1, y + 1, s - 2, s - 2, u * 0.3); c.strokeStyle = U.rgba(col, 0.9); c.lineWidth = lw(); c.stroke(); }
    if (fx.t > 0) { rr(c, x, y, s, s, u * 0.3); c.strokeStyle = `rgba(255,244,214,${clamp01(fx.t * 2)})`; c.lineWidth = lw() * 2.2; c.stroke(); }
    if (maxCharges > 1) { // charge pips, top-left
      const d = u * 0.8;
      for (let k = 0; k < maxCharges; k++) { const px = x + ins + k * (d + u * 0.2); c.fillStyle = k < charges ? K.emberHi : 'rgba(0,0,0,0.7)'; c.fillRect(px, y + ins, d, d); c.lineWidth = 1; c.strokeStyle = '#000'; c.strokeRect(px + 0.5, y + ins + 0.5, d - 1, d - 1); }
    }
    if (cost > 0) T('−' + cost, x + ins, y + ins + u * 0.55, u * 0.95, ready ? K.warm : K.faint, FB, 'left', 800, true);
    const kc = capArt(key, false); c.drawImage(kc.cv, Math.round(x + s / 2 - kc.w / 2), Math.round(y + s - kc.h * 0.45));
  }

  // ---------------- party (top-left column) ----------------
  function party(view, me) {
    let ty = L.m;
    for (const p of view.players.values()) {
      if (p.pid === me.pid) continue;
      const x = L.m, w = L.pw, h = L.ph, col = ED.PLAYER_COLORS[p.slot] || K.bone, out = p.dead || p.downed;
      fadeStart('p' + p.pid, x, ty, w, h);
      plate(x, ty, w, h, 0);
      c.fillStyle = col; c.fillRect(x + u * 0.25, ty + u * 0.35, u * 0.3, h - u * 0.7);
      T(p.name, x + u * 1.1, ty + u * 1.0, u * 1.05, col, FB, 'left', 800);
      T(p.dead ? 'Fallen' : p.downed ? 'DOWN' : ED.CLASSES[p.cls].name, x + w - u * 0.9, ty + u * 1.0, u * 0.95, out ? '#ff8a7a' : K.muted, FB, 'right', 700);
      const fr = p.dead ? 0 : p.downed ? clamp01(p.revive || 0) : p.hp / p.maxHp;
      bar(x + u * 1.1, ty + u * 1.95, w - u * 2, u * 0.95, fr, p.downed ? '#f0c060' : p.dead ? '#555555' : '#7fcf8a');
      endFade();
      ty += h + u * 0.55;
    }
  }

  // ---------------- map + stratum (top-right) ----------------
  // The panel height follows the floor: cells are as large as the panel width allows (at most 4.2u, grid height within 17u), the lantern panel sits below.
  function mapBlock(view, biome, t) {
    const x = L.mx, y = L.my, w = L.mw, fl = view.floor, G = fl && gridOf(fl), top = u * 5.8, mw = w - u * 1.2;
    const hCap = Math.max(u * 6, Math.min(u * 17, Hh - 2 * L.m - top - u * 1.3 - L.lh)), cell = G ? Math.min(mw / G.cols, hCap / G.rows, 4.2 * u) : 0, mh = G ? Math.ceil(G.rows * cell) : u * 4;
    L.mh = top + mh + u * 0.7; L.ly = L.my + L.mh + u * 0.6;
    fadeStart('map', x, y, w, L.mh);
    plate(x, y, w, L.mh);
    T(biome.name, x + w / 2, y + u * 1.55, u * 1.3, biome.pal.ui, FD, 'center', 700);
    T('Stratum ' + U.roman(view.stratum), x + u * 1.1, y + u * 3.05, u * 0.95, K.muted, FB, 'left', 700);
    if (view.pact > 0) T('Pact ' + view.pact, x + w - u * 1.1, y + u * 3.05, u * 0.95, '#ff7a56', FD, 'right', 700);
    // stratum affinity: foes are weak to one element and resist another
    const wkE = ED.PATHS[biome.weak], rsE = ED.PATHS[biome.resist], ay = y + u * 4.6;
    if (wkE && rsE) {
      for (let k = 0; k < 2; k++) {
        const P = k ? rsE : wkE, ax = x + u * 1.1 + k * (w / 2 - u * 0.2);
        T(k ? 'Resists' : 'Weak', ax, ay, u * 0.95, K.faint, FB, 'left', 700);
        const lx = ax + adv(k ? 'Resists' : 'Weak', u * 0.95, 700) + u * 0.4;
        ic(c, P.icon, P.color, lx, ay - u * 0.7, u * 1.4);
        T(P.name, lx + u * 1.6, ay, u * 1.0, P.color, FB, 'left', 800);
      }
    }
    H.drawMap(c, view, x + u * 0.6, y + top, mw, mh, u, t);
    endFade();
  }

  // ---------------- lantern (under the map) ----------------
  function lanternBlock(view, t) {
    if (!(view.lightMax > 0)) return;
    const x = L.mx, y = L.ly, w = L.mw, Wd = ED.World, I = ED.Input;
    const tier = U.clamp((view.dread && view.dread.tier) | 0, 0, 3), lf = clamp01(view.light / view.lightMax), pl = tier === 3 ? 0.5 + 0.5 * Math.sin(t * 5) : 1;
    if (lantern.view !== view) { lantern.view = view; lantern.tier = tier; lantern.hint = ''; lantern.t = 99; }
    else if (tier !== lantern.tier) {
      lantern.hint = tier > lantern.tier ? ['', 'Elites stir. The Deep pays more.', `The Gloom hunts. Flare (${I.label('flare')}) or oil.`, 'Lightless! Only oil drives the Gloom off.'][tier] : tier === 0 ? 'The lantern burns bright.' : 'The light pushes the dark back.';
      lantern.t = 0; lantern.tier = tier;
    }
    lantern.t += dtc;
    if (lantern.fxTier !== tier) { // effect line of the tier, rebuilt on a tier change
      const D = Wd.DREAD && Wd.DREAD[tier], parts = [];
      if (D) { if (D.dmg > 1) parts.push(`Dmg +${Math.round((D.dmg - 1) * 100)}%`); if (D.heal < 1) parts.push(`Heal −${Math.round((1 - D.heal) * 100)}%`); if (D.elite > 0) parts.push(`Elites +${Math.round(D.elite * 100)}%`); if (D.gold > 1) parts.push(`Gold ×${D.gold}`); }
      lantern.fx = parts.length ? parts.join(' · ') : 'Foes at normal strength'; lantern.fxTier = tier;
    }
    const tc = tier === 3 ? U.mix('#8a2a2a', '#ff5a40', pl) : TIER[tier][1];
    fadeStart('lantern', x, y, w, L.lh);
    plate(x, y, w, L.lh);
    ic(c, 'lantern', tc, x + u * 0.9, y + u * 0.7, u * 2.1);
    T(TIER[tier][0], x + u * 3.4, y + u * 1.75, u * 1.45, tc, FD, 'left', 700);
    T(Math.round(lf * 100) + '%', x + w - u * 1.1, y + u * 1.75, u * 1.3, tc, FB, 'right', 800);
    // meter: tier zones tinted behind the fill; ticks at the Dim (50%) and Dark (25%) thresholds
    const mx = x + u * 1, mw = w - u * 2, my = y + u * 3.6, mh = u * 1.5, b = Math.max(1, Math.round(u * 0.07));
    c.fillStyle = '#000'; c.fillRect(mx - b, my - b, mw + 2 * b, mh + 2 * b);
    c.fillStyle = U.rgba(TIER[2][1], 0.22); c.fillRect(mx, my, mw * 0.25, mh);
    c.fillStyle = U.rgba(TIER[1][1], 0.2); c.fillRect(mx + mw * 0.25, my, mw * 0.25, mh);
    c.fillStyle = U.rgba(TIER[0][1], 0.16); c.fillRect(mx + mw * 0.5, my, mw * 0.5, mh);
    if (lf > 0) { const f = fillArt(tc, mh); c.drawImage(f.cv, 0, 0, 4, f.h, mx, my, mw * lf, mh); }
    c.fillStyle = 'rgba(246,236,218,0.75)'; c.fillRect(Math.round(mx + mw * 0.5) - 1, my - u * 0.3, 2, mh + u * 0.6); c.fillRect(Math.round(mx + mw * 0.25) - 1, my - u * 0.3, 2, mh + u * 0.6);
    if (tier === 3) { c.strokeStyle = U.rgba('#ff4a3a', 0.35 + 0.5 * pl); c.lineWidth = lw(); c.strokeRect(mx - b * 2, my - b * 2, mw + b * 4, mh + b * 4); }
    // one line of what the tier does (a fresh tier change shows its warning for a few seconds instead)
    const hint = lantern.t < 6 && lantern.hint;
    c.globalAlpha = ga * (hint ? clamp01(6 - lantern.t) : 1);
    const fxs = hint || lantern.fx, fxw = adv(fxs, u * 0.95, 700); // shrink a long effect line to the panel, not below 0.85u
    T(fxs, x + w / 2, y + u * 6.35, fxw > w - u * 1.2 ? Math.max(u * 0.85, u * 0.95 * (w - u * 1.2) / fxw) : u * 0.95, hint ? tc : K.muted, FB, 'center', 700);
    c.globalAlpha = ga;
    // what the light is worth: each unvisited room costs light (numbers on the doors and map); light left at the boss door guards the party
    const WC = Wd.ROOM_COST;
    T(`Room −${WC.combat} · Elite −${WC.elite} · Other −${WC.shop}`, x + w / 2, y + u * 7.9, u * 0.95, K.warm, FB, 'center', 700);
    const bl = Wd.bossLight(lf, view.stratum), by = y + u * 9.4;
    if (bl.heal > 0) {
      const seg = [['heart', '#ff6a7a', Math.round(bl.heal * 100) + '%'], ['shield', '#7fc8ff', Math.round(bl.shield * 100) + '%'], ['coin', '#ffd36b', '+' + bl.gold]];
      const bdw = adv('Boss door', u * 0.95, 800);
      let tw = bdw + u * 0.7; for (let k = 0; k < 3; k++) tw += u * 1.3 + u * 0.3 + adv(seg[k][2], u * 0.95, 800) + u * 0.7;
      let cx = x + (w - tw + u * 0.7) / 2;
      T('Boss door', cx, by, u * 0.95, K.muted, FB, 'left', 700); cx += bdw + u * 0.7;
      for (let k = 0; k < 3; k++) { ic(c, seg[k][0], seg[k][1], cx, by - u * 0.65, u * 1.3); cx += u * 1.6; T(seg[k][2], cx, by, u * 0.95, K.good, FB, 'left', 800); cx += adv(seg[k][2], u * 0.95, 800) + u * 0.7; }
    } else T('Boss door: no light to spare', x + w / 2, by, u * 0.95, K.faint, FB, 'center', 700);
    endFade();
  }

  // ---------------- xp, gold, picks (bottom-centre) ----------------
  function xpBlock(view, ctl, extra, t) {
    const x = L.xx, y = L.xy, w = L.xw, h = L.xh;
    fadeStart('xp', x, y, w, h);
    plate(x, y, w, h);
    T('Lv ' + view.level, x + u * 1.3, y + h / 2 + u * 0.05, u * 1.6, K.gold, FD, 'left', 900);
    const bx = x + u * 6.2, bw = w - u * 6.2 - u * 7.4, bh = u * 1.3;
    bar(bx, y + (h - bh) / 2, bw, bh, view.xp / view.xpNext, '#4fd0b0');
    ic(c, 'coin', '#ffd36b', x + w - u * 6.7, y + h / 2 - u * 1.0, u * 2.0);
    T(String(view.gold), x + w - u * 4.3, y + h / 2 + u * 0.05, u * 1.5, '#ffd36b', FB, 'left', 800);
    endFade();
    let ay = y - u * 0.7;
    if ((ctl.picks || 0) > 0 && !ctl.offerOpen) {
      const s = ctl.picks + ' boon' + (ctl.picks > 1 ? 's' : '') + ' ready', gl = 0.55 + 0.45 * Math.sin(t * 4);
      const cw = adv(s, u * 1.15, 800) + u * 2;
      pill(L.xx + (w - cw) / 2, ay - u * 2, cw, u * 2, K.emberHi, 0.18 + 0.12 * gl);
      T(s, W / 2, ay - u * 1.0 + u * 0.05, u * 1.15, K.emberHi, FB, 'center', 800); ay -= u * 2.6;
    }
    if (view.waitMsg) T(view.waitMsg, W / 2, ay - u * 0.9, u * 1.2, K.gold, FB, 'center', 800, true);
  }

  // ---------------- relics (bottom-right) ----------------
  function relics(me) {
    const n = me.relics ? me.relics.length : 0; if (!n) return;
    const s = u * 2.5, g = u * 0.35, per = 9, rows = Math.ceil(n / per);
    fadeStart('relics', W - L.m - Math.min(n, per) * (s + g), Hh - L.m - rows * (s + g) + g, Math.min(n, per) * (s + g), rows * (s + g));
    for (let i = 0; i < n; i++) {
      const col = i % per, row = Math.floor(i / per), inRow = Math.min(per, n - row * per);
      const x = W - L.m - (inRow - col) * (s + g) + g, y = Hh - L.m - s - row * (s + g);
      c.drawImage(ED.Icons.relicCanvas(me.relics[i], 64), x, y, s, s);
    }
    endFade();
  }

  // ---------------- boss bar (top-centre) ----------------
  function bossBar(view, t) {
    let boss = null; const en = view.enemies;
    for (let i = 0; i < en.length; i++) if (en[i].boss && en[i].hp > 0) { boss = en[i]; break; }
    if (!boss) return;
    const pw = L.bw, bw = pw - u * 3, ph = u * 5.6, x = (W - pw) / 2, y = L.m;
    plate(x, y, pw, ph);
    T(boss.def.name, W / 2, y + u * 1.65, u * 1.7, K.bone, FD, 'center', 900);
    const fr = boss.hp / boss.maxHp;
    ghost.boss = ghost.boss === undefined || ghost.bossId !== boss.id ? fr : Math.max(fr, ghost.boss - dtc * 0.2); ghost.bossId = boss.id;
    const marks = boss.type === 'hollowking' ? [0.6, 0.3] : [0.66, 0.33], by = y + u * 3.2, bh = u * 1.7;
    bar(x + u * 1.5, by, bw, bh, fr, boss.exposed ? '#ff9a3a' : '#c0392b', ghost.boss);
    c.fillStyle = K.gold; for (const mk2 of marks) c.fillRect(Math.round(x + u * 1.5 + bw * mk2) - 1, by - u * 0.3, 3, bh + u * 0.6);
    if (boss.exposed) T('Exposed', x + pw - u * 1.5, y + u * 1.65, u * 1.0, '#ffb870', FB, 'right', 800);
  }

  // ---------------- interaction prompt ----------------
  function prompt(pr) {
    const s = ED.Render.toScreen(pr.x, pr.y - 46), sx = s.x * rk, sy = s.y * rk, key = ED.Input.hint('attack');
    const kc = capArt(key, true), ph = u * 2.6, tpx = u * 1.25;
    const w = Math.round(kc.w + adv(pr.text, tpx, 800) + u * 2.6), x = U.clamp(sx - w / 2, L.m, W - L.m - w), y = sy - ph / 2;
    plate(x, y, w, ph, u * 0.7);
    rr(c, x, y, w, ph, u * 0.3); c.strokeStyle = U.rgba(K.brassHi, 0.9); c.lineWidth = lw(); c.stroke();
    c.drawImage(kc.cv, Math.round(x + u * 0.8), Math.round(y + (ph - kc.h) / 2));
    T(pr.text, x + u * 1.8 + kc.w, y + ph / 2 + u * 0.05, tpx, pr.can === false ? '#c08070' : K.bone, FB, 'left', 800);
    if (pr.desc) {
      const dw = u * 25, lines = wrap(pr.desc, dw - u * 2, u * 1.1, 600, 5), lh = u * 1.5, dh = lines.length * lh + u * 1.3;
      const dx = U.clamp(sx - dw / 2, L.m, W - L.m - dw), dy = Math.max(L.m, y - u * 0.8 - dh);
      plate(dx, dy, dw, dh, u * 0.7);
      if (pr.color) { rr(c, dx, dy, dw, dh, u * 0.3); c.strokeStyle = U.rgba(pr.color, 0.85); c.lineWidth = lw(); c.stroke(); }
      for (let i = 0; i < lines.length; i++) T(lines[i], dx + dw / 2, dy + u * 0.65 + lh * (i + 0.5), u * 1.1, '#efe3cd', FB, 'center', 600);
    }
  }

  // ---------------- tutorial / stratum sign (screen space, bindings substituted) ----------------
  // Panel sits on the side of the sign away from the hero so it never covers them.
  function signPanel(me) {
    const R = ED.Render, sg = R.sign; if (!sg) return;
    R.sign = null;
    const text = ED.Input.fill(sg.text), above = me.y >= sg.y, s = R.toScreen(sg.x, above ? sg.y - 36 : sg.y + 8), sx = s.x * rk, sy = s.y * rk;
    const w = u * 25, lines = wrap(text, w - u * 2.4, u * 1.15, 600, 6), lh = u * 1.6, h = lines.length * lh + u * 1.6;
    const x = U.clamp(sx - w / 2, L.m, W - L.m - w), y = U.clamp(above ? sy - h : sy, L.m, Hh - L.m - h);
    plate(x, y, w, h);
    for (let i = 0; i < lines.length; i++) T(lines[i], x + w / 2, y + u * 0.8 + lh * (i + 0.5), u * 1.15, '#efe3cd', FB, 'center', 600);
  }

  // ---------------- centre notes: down / fallen ----------------
  function centerNotes(view, me) {
    if (me.downed) {
      T('You are down', W / 2, Hh * 0.32, u * 3, '#ff8a7a', FD, 'center', 900, true);
      if (view.players.size > 1) T('Stay calm. An ally can revive you by standing close.', W / 2, Hh * 0.32 + u * 3, u * 1.3, K.bone, FB, 'center', 700, true);
    } else if (me.dead) {
      T('Fallen', W / 2, Hh * 0.32, u * 3, '#cfc6b6', FD, 'center', 900, true);
      T('You will rise again when your party reaches the next stratum.', W / 2, Hh * 0.32 + u * 3, u * 1.3, K.bone, FB, 'center', 700, true);
    }
  }

  // ---------------- message feed (above the hero block, newest at the bottom, 4 lines max) ----------------
  function messages(chips) {
    const ms = ED.FX.msgs; if (!ms.length) return;
    const px = u * 1.2, lh = u * 1.7, maxW = u * 30;
    let y = (chips ? L.cy : L.sy) - u * 0.7, used = 0;
    for (let i = ms.length - 1; i >= 0 && used < 4; i--) {
      const m = ms[i], lines = wrap(m.text, maxW, px, 700, Math.min(2, 4 - used)), n = lines.length;
      let mw = 0; for (let k = 0; k < n; k++) mw = Math.max(mw, adv(lines[k], px, 700));
      const a = Math.min(1, m.t), h = n * lh + u * 0.2;
      c.globalAlpha = a * 0.6; rr(c, L.m, y - h, mw + u * 1.6, h, u * 0.3); c.fillStyle = '#0c0806'; c.fill();
      c.globalAlpha = a; c.fillStyle = m.color; c.fillRect(L.m, y - h + u * 0.2, u * 0.25, h - u * 0.4);
      for (let k = 0; k < n; k++) T(lines[k], L.m + u * 0.8, y - h + u * 0.1 + lh * (k + 0.5), px, m.color, FB, 'left', 700);
      y -= h + u * 0.35; used += n;
    }
    c.globalAlpha = 1;
  }

  // ---------------- banners ----------------
  function banners(F, biome, extra) {
    const b = F.banner; if (!b || extra.offerOpen) return;
    const a = Math.min(1, b.t * 3, (b.dur - b.t) * 2);
    c.globalAlpha = Math.max(0, a);
    const cy = b.style === 'small' || b.style === 'level' ? Hh * 0.24 : Hh * 0.3;
    if (b.style === 'stratum' || b.style === 'boss' || b.style === 'victory') {
      const band = u * 5.5, g = c.createLinearGradient(0, cy - band, 0, cy + band); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.62)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, cy - band, W, band * 2);
      const col = b.style === 'boss' ? '#ff6a4a' : b.style === 'victory' ? '#ffd36b' : biome.pal.ui;
      T(b.sub.toUpperCase(), W / 2, cy - u * 2.4, u * 1.15, col, FB, 'center', 800);
      T(b.title, W / 2, cy + u * 0.4, u * (b.style === 'boss' ? 4.1 : 3.8), '#f6ecd8', FD, 'center', 900);
      const rw = u * 10 * Math.min(1, b.t * 2); c.fillStyle = col; c.fillRect(W / 2 - rw, cy + u * 3.2, rw * 2, Math.max(2, u * 0.14));
      if (b.style === 'boss' && F.bossQuote) T('"' + F.bossQuote.text + '"', W / 2, cy + u * 4.6, u * 1.25, '#d8cbb8', FB, 'center', 600);
    } else {
      T(b.title, W / 2, cy, u * (b.style === 'level' ? 2.7 : 2.1), b.style === 'level' ? '#ffd36b' : K.bone, FD, 'center', 900, true);
      if (b.sub) T(b.sub, W / 2, cy + u * 2.2, u * 1.15, '#d8cbb8', FB, 'center', 700, true);
    }
    c.globalAlpha = 1;
  }

  // ---------------- minimap / full map of the current floor ----------------
  // Room-grid bounds of the whole floor (known or not, so the scale holds for the stratum), cached per floor.
  const grids = new WeakMap();
  function gridOf(fl) {
    let G = grids.get(fl); if (G) return G;
    let minX = 99, maxX = -99, minY = 99, maxY = -99;
    for (const r of fl.rooms) { minX = Math.min(minX, r.gx); maxX = Math.max(maxX, r.gx); minY = Math.min(minY, r.gy); maxY = Math.max(maxY, r.gy); }
    G = { minX, minY, cols: maxX - minX + 1, rows: maxY - minY + 1 }; grids.set(fl, G); return G;
  }
  // g: target context; u: text unit in px of g (cells and labels scale with it). The grid is centred in the w x h box.
  H.drawMap = (g, view, x, y, w, h, un, t) => {
    const fl = view.floor; if (!fl) return;
    const rs = view.roomState || {}, G = gridOf(fl), minX = G.minX, minY = G.minY, cols = G.cols, rows = G.rows;
    const cell = Math.min(w / cols, h / rows, 4.2 * un);
    const ox = x + (w - cols * cell) / 2, oy = y + (h - rows * cell) / 2;
    const cx = (r) => ox + (r.gx - minX + 0.5) * cell, cy = (r) => oy + (r.gy - minY + 0.5) * cell;
    g.lineWidth = Math.max(1.5, cell * 0.1);
    for (const r of fl.rooms) {
      const st = rs[r.id]; if (!st || !st.known) continue;
      for (const d of ['e', 's']) { const n = r.doors[d]; if (n >= 0 && rs[n] && rs[n].known) { g.strokeStyle = 'rgba(200,180,150,0.5)'; g.beginPath(); g.moveTo(cx(r), cy(r)); g.lineTo(cx(fl.rooms[n]), cy(fl.rooms[n])); g.stroke(); } }
    }
    const ICON = { boss: ['skull', '#ff5a3a'], shop: ['coin', '#ffd36b'], treasure: ['chest', '#ffd36b'], event: ['star', '#7dffd9'], elite: ['skull', '#ff7a3a'], rest: ['campfire', '#ff9a3a'] };
    const meP = ED.Game.s && ED.Game.s.me, cls = meP ? meP.cls : null;
    const fpx = Math.max(0.85 * un, cell * 0.36);
    for (const r of fl.rooms) {
      const st = rs[r.id]; if (!st || !st.known) continue;
      const s = cell * 0.8, rx = cx(r) - s / 2, ry = cy(r) - s / 2;
      const cur = r.id === view.roomId;
      g.fillStyle = cur ? '#e6c27a' : st.visited ? (st.cleared ? '#5a4a3c' : '#8a3a2a') : 'rgba(60,48,40,0.7)';
      g.fillRect(rx, ry, s, s);
      g.strokeStyle = cur ? '#fff3c4' : 'rgba(0,0,0,0.7)'; g.lineWidth = Math.max(1, cell * 0.05); g.strokeRect(rx + 0.5, ry + 0.5, s - 1, s - 1);
      const icn = ICON[r.type], open = !st.cleared; // utility rooms keep their glyph; a cleared elite room loses it
      if (icn && (open || r.type !== 'elite')) ic(g, icn[0], icn[1], rx + s * 0.12, ry + s * 0.12, s * 0.76);
      if (open && r.reward && (r.type === 'combat' || r.type === 'elite')) { // reward preview: whole icon in plain combat rooms, a corner badge in elite rooms
        const ri = ED.Render.rewardIcon(r.reward, cls), big = r.type === 'combat', z = big ? s * 0.76 : s * 0.5;
        ic(g, ri[0], ri[1], big ? rx + s * 0.12 : rx + s - z * 0.9, big ? ry + s * 0.12 : ry + s - z * 0.9, z);
      }
      const cost = st.visited ? 0 : ED.World.roomCost(r.type); // light the unvisited room costs, bottom-right of its cell
      if (cost > 0) {
        const e = textArt(String(cost), fpx, K.warm, FB, 800, true); // cached text bitmap, right edge and baseline at the cell's bottom-right
        g.drawImage(e.cv, Math.round(rx + s + 1 - e.pad - e.adv), Math.round(ry + s + 1 - fpx * 0.35 - e.h / 2));
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
