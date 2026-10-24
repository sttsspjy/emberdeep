// Wardrobe cosmetics in play, at the Hearth and in the Wardrobe preview: the worn set of a hero (p.wear, carried with the hero pick; Net.cleanWear), skin swap keys and weapon sheens (read by actors.js),
// the Gilded aura and the Hollow Crown (drawn by actors.js), the Platino pet, the coin trail, Last Embers, titles, the Blue Hearth's ghost and the preview canvas. Client only: the sim never reads any of it.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const Cos = ED.Cos = {};
  const NONE = { skin: null, aura: null, hat: null, pet: null, trail: null, death: null, title: null, tints: [] };
  Cos.NONE = NONE;
  const OPT = { flip: false, variant: '', alpha: 1, rot: 0, anchor: '' };
  const atlasHas = (id) => { const A = ED.Atlas; return !!(A && A.ok && A.has(id)); };
  const put = (c, id, i, x, y, flip, a) => { OPT.flip = !!flip; OPT.alpha = a === undefined ? 1 : a; return ED.Atlas.draw(c, id, i, x, y, OPT); };
  const s2 = (v) => Math.round(v / 2) * 2; // world px -> the 2 px art grid

  // ---------------- the worn set ----------------
  Cos.of = (p) => (p && p.wear) || NONE;
  const SKIN = {};
  // Swap suffix of a worn set's skin ('skin.knight.a' -> 'a', 'skin.unkindled' -> 'unkindled', '' without one): actors.js draws ED.ART.swaps['<cls>.<suffix>'].
  Cos.skinKey = (w) => { const id = w && w.skin; if (!id) return ''; let k = SKIN[id]; if (k === undefined) k = SKIN[id] = id.slice(id.lastIndexOf('.') + 1); return k; };
  Cos.skin = (p) => Cos.skinKey(Cos.of(p));
  Cos.gilded = (p) => Cos.of(p).aura === 'aura.gilded';
  Cos.crowned = (p) => Cos.of(p).hat === 'hat.crown';
  // Sheen ramp (ED.Pix.RAMP name, dark -> light, never white so a pale blade keeps its hue) of a base weapon by its place in its hero's list: first gold, second moonsilver, third violet.
  const TINTS = ['sheen.gold', 'sheen.moon', 'sheen.violet'], TINT = {};
  if (ED.Pix && ED.Pix.RAMP) Object.assign(ED.Pix.RAMP, {
    'sheen.gold': ['#5a3c10', '#a8761a', '#e0aa30', '#ffd36b', '#ffe8a8'],
    'sheen.moon': ['#1c2a48', '#3a5a94', '#6a9ad8', '#a8d0ff', '#d4ecff'],
    'sheen.violet': ['#2a1048', '#5a2a94', '#8a5ad0', '#b88cff', '#dcc8ff'],
  });
  Cos.tintRamp = (root) => {
    let col = TINT[root];
    if (col) return col;
    col = TINTS[0];
    for (const c of ED.CLASS_IDS) { const i = ED.CLASSES[c].weapons.indexOf(root); if (i >= 0) { col = TINTS[i % TINTS.length]; break; } }
    return (TINT[root] = col);
  };
  // Sheen ramp of weapon `id` (a base, an Armory variant or a fork of one) when hero p wears the tint of its base weapon, else '' (actors.js: ED.Pix.variant(anim, ramp)).
  Cos.tintOf = (p, id) => {
    const t = Cos.of(p).tints; if (!t || !t.length || !id) return '';
    const s = String(id), at = s.indexOf('@'), root = ED.weaponBase ? ED.weaponBase(at < 0 ? s : s.slice(0, at)) : s;
    return t.indexOf(root) >= 0 ? Cos.tintRamp(root) : '';
  };
  // Title text of hero p ('' without one); a capitalised title follows a comma: "Mira the Contrarian", "Mira, One of Many".
  Cos.titleOf = (w) => { const id = w && w.title, c = typeof id === 'string' ? ED.COSMETIC[id] : null; return c && c.slot === 'title' ? c.name : ''; }; // title text of a worn set ('' without one)
  Cos.title = (p) => Cos.titleOf(Cos.of(p));
  Cos.named = (name, title) => (title ? name + (/^[a-z]/.test(title) ? ' ' : ', ') + title : name);
  const NM = new Map();
  Cos.nameOf = (p) => {
    const title = Cos.title(p); if (!title) return p.name;
    let e = NM.get(p.pid);
    if (!e || e.n !== p.name || e.t !== title) { e = { n: p.name, t: title, s: Cos.named(p.name, title) }; NM.set(p.pid, e); }
    return e.s;
  };
  // True when profile p burns the Blue Hearth.
  Cos.blueHearth = (p) => !!(p && p.wear && p.wear.camp === 'camp.bluehearth' && ED.cosOwned(p, 'camp.bluehearth', null));

  // ---------------- Last Embers ----------------
  // The death of hero p in its worn style: Last Embers scatters embers rising from the body (true), else the caller plays the default puff (false).
  Cos.death = (p) => {
    if (Cos.of(p).death !== 'death.embers' || !ED.FX) return false;
    const F = ED.FX, x = p.x, y = p.y, low = !!(ED.Render && ED.Render.quality === 'low');
    F.burst(x, y - 10, 24, { kind: 'ember', color: '#ff9a3a', sp: 55, vy: -70, life: 1.5, size: 2.2, drag: 1.3 });
    F.burst(x, y - 8, 10, { kind: 'ember', color: '#ffd36b', sp: 95, vy: -40, life: 0.9, size: 1.8, drag: 2 });
    for (let i = 0, n = low ? 3 : 7; i < n; i++) { const a = Math.random() * TAU, d = 4 + Math.random() * 14; F.sheet('fx.ember', x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6 - 6, { delay: i * 0.07, vy: -16 - Math.random() * 14, lt: '#ff8a2a', ltr: 22 }); }
    F.pop(x, y - 10, 24, '#ff8a3d', 0.3);
    if (ED.Audio) ED.Audio.play('fire', 0.5);
    return true;
  };

  // ---------------- Platino pet ----------------
  const PETS = new Map(), petList = [];
  // The pet look: cos.platino at full size (a 12 x 11 sprite, pet-sized beside a hero).
  // One Platino at (x, y) (its feet), facing face (sign), hopping by hop 0..1, alpha a; ph shifts its idle frames.
  Cos.drawPetAt = (c, x, y, face, t, hop, a, ph) => {
    c.save(); c.translate(s2(x), s2(y));
    if (ED.Sprites && ED.Sprites.shadow) ED.Sprites.shadow(c, 4, 0.3 * (a === undefined ? 1 : a));
    const hy = -2 * Math.round(Math.abs(Math.sin(t * 14)) * (hop || 0));
    if (atlasHas('cos.platino')) { put(c, 'cos.platino', ED.Atlas.frameAt('cos.platino', t + (ph || 0)), 0, hy, face < 0, a); }
    else { // procedural stand-in: a pale round body with an eye
      c.globalAlpha *= a === undefined ? 1 : a; c.fillStyle = '#cfd6e2'; c.beginPath(); c.ellipse(0, hy - 6, 7, 5, 0, 0, TAU); c.fill();
      c.fillStyle = '#1a1c22'; c.fillRect(face < 0 ? -5 : 3, hy - 8, 2, 2);
    }
    c.restore();
  };
  // Pets of the viewed heroes, moved for this frame: a Platino keeps to its hero's back with a lag, hops while it moves, hides while its hero is down or dead, snaps back after a room change
  // and fades with its hero's Vanish (as the hero: 0.45 to its own player, 0.2 to the others). Returns a shared array of pet states { x, y, face, mv, ph, a } (render.js sorts them with the actors).
  Cos.pets = (view, t, dt) => {
    petList.length = 0;
    for (const p of view.players.values()) {
      if (Cos.of(p).pet !== 'pet.platino') continue;
      let s = PETS.get(p.pid);
      if (!s) { s = { x: 0, y: 0, face: 1, on: false, mv: 0, ph: (p.slot | 0) * 0.37, a: 1 }; PETS.set(p.pid, s); }
      if (p.dead || p.downed) { s.on = false; continue; }
      s.a = p.stealthT > 0 ? (ED.Render && p.pid === ED.Render.local ? 0.45 : 0.2) : 1;
      const side = Math.cos(p.face || 0) < 0 ? -1 : 1, tx = p.x - side * 18, ty = p.y + 4, dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      if (!s.on || d > 240) { s.x = tx; s.y = ty; s.on = true; s.mv = 0; s.face = side; }
      else if (d > 6) {
        const k = 1 - Math.exp(-dt * 3.5), mx = dx * k, my = dy * k;
        s.x += mx; s.y += my; s.mv = U.clamp(Math.hypot(mx, my) / Math.max(dt, 1e-3) / 60, 0, 1);
        if (Math.abs(mx) > 0.05) s.face = mx > 0 ? 1 : -1;
      } else { s.mv = Math.max(0, s.mv - dt * 4); if (Math.abs(p.x - s.x) > 2) s.face = p.x > s.x ? 1 : -1; }
      petList.push(s);
    }
    return petList;
  };
  // A pet in the world: a faint light of its own and an eye glint, so it reads in a dark room.
  Cos.drawPet = (c, s, t) => {
    const R = ED.Render;
    if (R && s.a === 1) { R.light(s.x, s.y - 8, 30, '#e8f0ff', 0.22); R.emit(s.x + s.face * 2, s.y - 8, 3, '#dff4ff', 0.35 + Math.sin(t * 5 + s.ph) * 0.1); }
    Cos.drawPetAt(c, s.x, s.y, s.face, t, s.mv, s.a, s.ph);
  };

  // ---------------- Trail of Coins ----------------
  const TRAILS = new Map(), T_LIFE = 1.6, T_FADE = 0.6, T_GAP = 24, T_MIN = 0.1;
  // A gold footprint stamp centred at (x, y): a flat 3 x 5 art px sole and heel without outline or shine (side -1 mirrors it), alpha a <= 0.5, so it never reads as a coin to pick up.
  const FOOT = [[1, 0, 2], [0, 1, 3], [0, 2, 2], [0, 4, 2]]; // [x, y, w] rows in art px of a right foot
  function stampAt(c, x, y, a, side) {
    const ga = c.globalAlpha, x0 = s2(x) - 3, y0 = s2(y) - 5;
    c.globalAlpha = ga * Math.min(0.5, a); c.fillStyle = '#d8a038';
    for (const r of FOOT) c.fillRect(x0 + (side < 0 ? 3 - r[0] - r[2] : r[0]) * 2, y0 + r[1] * 2, r[2] * 2, 2);
    c.globalAlpha = ga;
  }
  // Gold footprints of the heroes wearing the Trail of Coins, on the floor (lit pass): one per 24 px walked (at most 10 a second), left and right in turn, alpha 0.5 fading out over 0.6 s of a 1.6 s life;
  // none while down, dead, in the air or unseen (Vanish), none across a room change or a blink. At most 14 live prints a hero (6 on Low quality). Returns the prints drawn.
  Cos.trails = (c, view, t, low) => {
    const cap = low ? 6 : 14;
    let n = 0;
    for (const p of view.players.values()) {
      let s = TRAILS.get(p.pid);
      if (Cos.of(p).trail !== 'trail.coins') { if (s) TRAILS.delete(p.pid); continue; }
      if (!s) { s = { lx: p.x, ly: p.y, lt: t, side: 1, q: [] }; TRAILS.set(p.pid, s); }
      if (!p.dead && !p.downed && !p.lift && !(p.stealthT > 0)) {
        const ddx = p.x - s.lx, ddy = p.y - s.ly, d2 = ddx * ddx + ddy * ddy;
        if (d2 > 240 * 240) { s.lx = p.x; s.ly = p.y; s.lt = t; }
        else if (d2 >= T_GAP * T_GAP && t - s.lt >= T_MIN) {
          const d = Math.sqrt(d2), it = s.q.length >= cap ? s.q.shift() : { x: 0, y: 0, t: 0, s: 1 };
          s.side = -s.side; it.x = p.x - ddy / d * 3 * s.side; it.y = p.y + 3 + ddx / d * 2 * s.side; it.t = t; it.s = s.side; s.q.push(it);
          s.lx = p.x; s.ly = p.y; s.lt = t;
        }
      }
      while (s.q.length && (t - s.q[0].t > T_LIFE || s.q.length > cap)) s.q.shift();
      for (let i = 0; i < s.q.length; i++) {
        const it = s.q[i], age = t - it.t;
        stampAt(c, it.x, it.y, age < T_LIFE - T_FADE ? 0.5 : 0.5 * (T_LIFE - age) / T_FADE, it.s); n++;
      }
    }
    return n;
  };
  Cos.reset = () => { PETS.clear(); TRAILS.clear(); NM.clear(); };

  // ---------------- Blue Hearth ----------------
  // The ghost delver of the Blue Hearth, seated by the fire: legless, translucent, bobbing; (x, y) = its seat, flip faces it left.
  Cos.drawGhost = (c, x, y, t, flip, a) => {
    const bob = -2 * Math.round((Math.sin(t * 1.6) + 1) * 0.5);
    if (atlasHas('cos.ghost')) { put(c, 'cos.ghost', ED.Atlas.frameAt('cos.ghost', t), x, y + bob, flip, a); return; }
    const ga = c.globalAlpha; c.globalAlpha = ga * a; c.fillStyle = '#9dc3ee'; c.fillRect(x - 8, y + bob - 30, 16, 22); c.fillRect(x - 6, y + bob - 40, 12, 10); c.globalAlpha = ga;
  };
  const FLAME = { warm: ['#ff4610', '#ff7d1e', '#ffaf46', '#ffe18c', '#fffadc'], blue: ['#1e46c8', '#2e78f0', '#5aa8ff', '#a8d8ff', '#e8f6ff'] };
  // A small pixel campfire at (x, y) (the log bed) in world px: two crossed logs and three flickering flame layers; blue burns the Blue Hearth's colours.
  function miniFire(c, x, y, t, blue) {
    const F = blue ? FLAME.blue : FLAME.warm;
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x - 12, y - 1, 24, 4);
    c.fillStyle = '#3a2616'; c.fillRect(x - 10, y - 4, 20, 4); c.fillStyle = '#2e1d12'; c.fillRect(x - 6, y - 6, 12, 4);
    for (let i = 0; i < 4; i++) {
      const fl = Math.sin(t * 9 + i * 1.7) * 0.5 + Math.sin(t * 13.7 + i) * 0.5, h = s2((22 - i * 5) * (1 + fl * 0.12)), w = 12 - i * 3;
      c.fillStyle = F[i];
      for (let r = 0; r < h; r += 2) { const ww = s2(w * (1 - r / h) + 1), sx = s2(Math.sin(t * 6 + r * 0.3 + i) * (r / h) * 2); c.fillRect(x - ww / 2 + sx, y - 6 - r, ww, 2); }
    }
    c.fillStyle = F[4]; c.fillRect(x - 2, y - 10, 4, 4);
  }
  Cos.miniFire = miniFire;

  // ---------------- Wardrobe preview (ED.UI.wardrobePreview) ----------------
  // A canvas in the Wardrobe detail: hero `cls` in the worn (or hovered) set beside a small hearth (blue with its ghost under the Blue Hearth), the pet behind, a coin trail while it walks in place,
  // a Last Embers cycle, the title under it. Animated by its own rAF loop at 30 fps that stops while the canvas is detached or not shown, or the page is hidden; the next call or the page showing again restarts it.
  const PV = { cv: null, cap: null, raf: 0, cls: '', wear: NONE, camp: null, last: 0, parts: [], burnT: -9, hooked: false };
  function pvLoop(now) {
    PV.raf = 0;
    const cv = PV.cv;
    if (!cv || !cv.isConnected || !cv.offsetParent || document.hidden) return;
    if (now - PV.last >= 32) { PV.last = now; pvDraw(now / 1000); }
    PV.raf = requestAnimationFrame(pvLoop);
  }
  const pvKick = () => { if (!PV.raf && PV.cv && PV.cv.isConnected && !document.hidden) PV.raf = requestAnimationFrame(pvLoop); };
  function pvDraw(t) {
    const cv = PV.cv, c = cv.getContext('2d'), W = cv.width, H = cv.height, w = PV.wear, cls = PV.cls;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.imageSmoothingEnabled = false;
    if (!ED.CLASSES[cls]) return;
    const m = Math.max(1, Math.floor(Math.min(W / 120, H / 62))), ox = Math.round(W / 2), oy = Math.round(H * 0.86), blue = PV.camp === 'camp.bluehearth'; // the scene spans x -60..60, 62 world px up
    if (ED.Atlas && ED.Atlas.tick) ED.Atlas.tick(1); // menus run no world frame: the preview spends the rotation-bake allowance itself
    c.setTransform(m, 0, 0, m, ox, oy);
    // hearth glow and fire at the right, the ghost beyond it
    const g = c.createRadialGradient(24, -8, 2, 24, -8, 50); g.addColorStop(0, blue ? 'rgba(90,168,255,0.32)' : 'rgba(255,138,61,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(-26, -58, 100, 76);
    if (blue) Cos.drawGhost(c, 44, 0, t, true, 0.5);
    miniFire(c, 24, 0, t, blue);
    // trail: the hero walks in place, the coins slide away behind it
    const walking = !!w.trail;
    if (walking) for (let i = 0; i < 4; i++) { const d = (t * 60 + i * T_GAP) % (T_GAP * 4), x = -16 - d, a = Math.min(0.5, (1 - d / (T_GAP * 4)) * 1.2); stampAt(c, x, 3 + ((i & 1) ? 2 : -2), a, (i & 1) ? 1 : -1); }
    if (w.pet === 'pet.platino') Cos.drawPetAt(c, -34, 3, 1, t, walking ? 0.7 : 0, 1, 0);
    // Last Embers: every 3 s the hero fades into rising embers and returns
    let ha = 1;
    if (w.death === 'death.embers') {
      const u = t % 3;
      if (u >= 1.8) { if (t - PV.burnT > 1) { PV.burnT = t; for (let i = 0; i < 18; i++) PV.parts.push({ x: -6 + (Math.random() - 0.5) * 14, y: -8 - Math.random() * 14, vx: (Math.random() - 0.5) * 22, vy: -18 - Math.random() * 26, life: 0.8 + Math.random() * 0.7, c: Math.random() < 0.35 ? '#ffd36b' : '#ff8a3a' }); }
        ha = u < 2.2 ? 1 - (u - 1.8) / 0.4 : u < 2.6 ? 0 : (u - 2.6) / 0.4; }
    }
    if (ha > 0.01) {
      const hero = { pid: 'wd-preview', cls, slot: 0, weapon: ED.App && ED.App.weaponFor ? ED.App.weaponFor(cls) : ED.CLASSES[cls].weapons[0], face: 0, moving: walking, hp: 1, maxHp: 1, wear: w };
      c.save(); c.translate(-6, 0); c.globalAlpha = ha; ED.Sprites.hero(c, hero, t, null); c.restore(); c.globalAlpha = 1;
    }
    for (let i = PV.parts.length - 1; i >= 0; i--) {
      const q = PV.parts[i]; q.life -= 0.033; q.x += q.vx * 0.033; q.y += q.vy * 0.033; q.vy *= 0.97;
      if (q.life <= 0) { PV.parts.splice(i, 1); continue; }
      c.globalAlpha = Math.min(1, q.life * 1.5); c.fillStyle = q.c; c.fillRect(s2(q.x), s2(q.y), 2, 2);
    }
    c.globalAlpha = 1;
  }
  Cos.preview = (host, cls, wear, camp) => {
    if (!PV.hooked) { PV.hooked = true; document.addEventListener('visibilitychange', pvKick); }
    const cv = document.createElement('canvas'), dpr = window.devicePixelRatio || 1;
    cv.className = 'wd-prev'; cv.width = Math.round(256 * dpr); cv.height = Math.round(144 * dpr); // style.css .wd-prev: 64 --p wide, 16:9
    PV.cv = cv; PV.cls = cls; PV.wear = wear || NONE; PV.camp = camp || null; PV.parts.length = 0; PV.burnT = -9;
    host.appendChild(cv);
    const title = PV.wear.title && ED.COSMETIC[PV.wear.title] ? ED.COSMETIC[PV.wear.title].name : '';
    if (title) { const cap = document.createElement('div'); cap.className = 'wd-cap'; cap.textContent = Cos.named((ED.App && ED.App.profile && ED.App.profile.name) || ED.CLASSES[cls].name, title); host.appendChild(cap); }
    if (typeof ResizeObserver === 'function') { // one canvas px per device px of the CSS box, so every art px lands on whole device px
      const ro = new ResizeObserver((es) => {
        if (!cv.isConnected) { ro.disconnect(); return; }
        const e = es[es.length - 1], bs = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0], d = window.devicePixelRatio || 1;
        const w = bs ? bs.inlineSize : Math.round(e.contentRect.width * d), h = bs ? bs.blockSize : Math.round(e.contentRect.height * d);
        if (w < 8 || h < 8 || (w === cv.width && h === cv.height)) return;
        cv.width = w; cv.height = h; if (PV.cv === cv) pvDraw(performance.now() / 1000);
      });
      try { ro.observe(cv, { box: 'device-pixel-content-box' }); } catch (err) { ro.observe(cv); }
    }
    pvDraw(performance.now() / 1000);
    pvKick();
  };
  Cos.previewOn = () => PV.raf !== 0; // true while the preview loop is scheduled
  if (ED.UI) ED.UI.wardrobePreview = Cos.preview;
})(globalThis.ED || (globalThis.ED = {}));
