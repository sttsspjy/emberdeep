// Cosmetics on the client (data: src/data/cosmetics.js, GAME-DESIGN §11). Loaded after the fx files: its ED.FX.handle wrapper is the outermost.
// ED.Cos.of(pid): the hero's worn bundle { skin, tint, kill, lvl, title, ncol } from ED.Game.cos (run config, never snapshots); DEF when absent (bots, checks).
// Skins: Atlas variant 'pal:<skin id>' of each hero anim (built once per anim from the skin map; WebGL and Canvas2D draw the same sheet).
// Weapon tints: ED.Cos.tint(id) swaps ED.Batch shape / sprite calls and ED.FX particle / ring / flash / sprite / col for wrappers that remap colours onto the tint ramp
// by luminance (cached per colour); render.js opens it around the owner's projectiles, weapon zones and HeroFx, the ED.FX.handle wrapper around weapon events.
// Owner: World entities carry it (pr.owner, z.p); on a client mirror a weapon id held by exactly one hero names it. Nothing is wrapped while no hero wears a tint.
// Kill effects: the viewer's style replaces the normal-foe death burst (elites add it); level-up effects: each hero's own style. Name tags: title over the name, name colour.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, PI = Math.PI, rnd = Math.random;
  const DEF = Object.freeze({ skin: '', tint: '', kill: '', lvl: '', title: '', ncol: '' });
  const Cos = ED.Cos = { DEF };
  const by = (id) => (id && ED.COS_BY && ED.COS_BY[id]) || null;
  Cos.of = (pid) => { const m = ED.Game && ED.Game.cos; return (m && m[pid]) || DEF; };
  const lowQ = () => !!(ED.Render && ED.Render.quality === 'low');

  // ---------------- skins ----------------
  const skinMake = {};
  // Variant key of hero anim id in skin skinId ('' for the default look or a missing atlas).
  Cos.skinVar = (id, skinId) => {
    const d = by(skinId); if (!d || d.kind !== 'skin' || !ED.Atlas) return '';
    const key = 'pal:' + skinId, mk = skinMake[skinId] || (skinMake[skinId] = () => d.map);
    return ED.Atlas.variant(id, key, mk) ? key : '';
  };

  // ---------------- weapon tints ----------------
  const RI = {}; // tint id -> ramp as [r, g, b] x 5
  for (const d of ED.COSMETICS || []) if (d.kind === 'tint') { RI[d.id] = d.ramp.map(h => U.hexToRgb(h)); if (ED.Pix) ED.Pix.RAMP[d.id] = d.ramp; }
  let cur = '', ramp = null, cmap = null;
  const maps = {};
  // 0xRRGGBB -> its luminance on the active ramp: up to near-white at ramp step 3.2 (bright effect colours keep the tint), only white itself reaches the top step.
  function mapRGB(v) {
    const r = (v >>> 16) & 255, g = (v >>> 8) & 255, b = v & 255, l = (r * 0.299 + g * 0.587 + b * 0.114) / 255, p = l >= 0.985 ? 3.999 : l * 3.2, i = p | 0, f = p - i, A = ramp[i], Bq = ramp[i + 1];
    return ((Math.round(A[0] + (Bq[0] - A[0]) * f) << 16) | (Math.round(A[1] + (Bq[1] - A[1]) * f) << 8) | Math.round(A[2] + (Bq[2] - A[2]) * f)) >>> 0;
  }
  // 0xRRGGBBAA -> remapped colour, alpha kept.
  function mapA(c) {
    let v = cmap.get(c);
    if (v === undefined) { v = ((mapRGB(c >>> 8) << 8) | (c & 255)) >>> 0; if (cmap.size > 4096) cmap.clear(); cmap.set(c, v); }
    return v;
  }
  const B = ED.Batch, F = ED.FX, bBase = {}, fBase = {};
  const SO = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false, variant: '', anchor: undefined };
  // Sprite options under the tint: the ramp's recoloured sheet (built-in variants such as 'white' and outlines stay).
  function sprO(id, o) {
    const vk = o && o.variant;
    if (vk && vk.slice(0, 4) !== 'pal:') return o;
    SO.flip = !!(o && o.flip); SO.flash = (o && o.flash) || 0; SO.alpha = o && o.alpha !== undefined ? o.alpha : 1; SO.rot = (o && o.rot) || 0; SO.sx = (o && o.sx) || 1; SO.sy = (o && o.sy) || 1;
    SO.add = !!(o && o.add); SO.anchor = o && o.anchor; SO.variant = ED.Pix.variant(id, cur);
    SO.tint = SO.variant ? 0 : mapRGB((o && o.tint) || 0xffffff);
    return SO;
  }
  const BW = {
    rect: (x, y, w, h, c) => bBase.rect(x, y, w, h, mapA(c >>> 0)),
    circ: (x, y, r, c, lw) => bBase.circ(x, y, r, mapA(c >>> 0), lw),
    zcirc: (x, y, r, c, lw) => bBase.zcirc(x, y, r, mapA(c >>> 0), lw),
    line: (x0, y0, x1, y1, lw, c) => bBase.line(x0, y0, x1, y1, lw, mapA(c >>> 0)),
    poly: (P, n, lw, c) => bBase.poly(P, n, lw, mapA(c >>> 0)),
    cone: (x, y, r, a, arc, c, lw) => bBase.cone(x, y, r, a, arc, mapA(c >>> 0), lw),
    spr: (id, fr, x, y, o) => bBase.spr(id, fr, x, y, sprO(id, o)),
  };
  const FW = {
    part: (x, y, vx, vy, life, col, size, grav, drag) => fBase.part(x, y, vx, vy, life, mapA(col >>> 0), size, grav, drag),
    ring: (x, y, r, col, life, r0, lw) => fBase.ring(x, y, r, mapA(col >>> 0), life, r0, lw),
    flash: (x, y, r, col, life, a) => fBase.flash(x, y, r, mapA(col >>> 0), life, a),
    sprite: (id, x, y, sc, rot, tint, alpha, flip) => fBase.sprite(id, x, y, sc, rot, tint, alpha, flip, cur),
    col: (c) => mapA(c >>> 0),
  };
  const BK = Object.keys(BW), FK = Object.keys(FW);
  // Opens the tint scope of tint id (swapping in the wrappers on the first open), changes it, or closes it with ''.
  Cos.tint = (id) => {
    if (!RI[id]) id = '';
    if (id === cur) return;
    if (!id) { for (const k of BK) B[k] = bBase[k]; for (const k of FK) F[k] = fBase[k]; cur = ''; return; }
    if (!cur) { for (const k of BK) { bBase[k] = B[k]; B[k] = BW[k]; } for (const k of FK) { fBase[k] = F[k]; F[k] = FW[k]; } }
    cur = id; ramp = RI[id]; cmap = maps[id] || (maps[id] = new Map());
  };

  const widPid = new Map(); let anyTint = false;
  // Per rendered frame (render.js, before drawing): closes a stray scope, notes whether any hero wears a tint and which hero holds each weapon id.
  Cos.frame = (v) => {
    Cos.tint('');
    anyTint = false; widPid.clear();
    for (const p of v.heroes) if (RI[Cos.of(p.pid).tint]) anyTint = true;
    if (!anyTint) return;
    for (const p of v.heroes) for (const ws of p.weapons) { const q = widPid.get(ws.id); widPid.set(ws.id, q === undefined || q === p.pid ? p.pid : ''); }
  };
  const weapon = (wid) => !!(wid && ED.WEAPONS[wid]);
  const tintOfPid = (pid) => (pid ? Cos.of(pid).tint : '');
  // Tint id for a projectile / zone (own team, weapon id) or a hero ('' = none).
  Cos.projTint = (pr) => (!anyTint || pr.team || !weapon(pr.wid) ? '' : tintOfPid(typeof pr.owner === 'string' ? pr.owner : widPid.get(pr.wid)));
  Cos.zoneTint = (z) => (!anyTint || z.team === 1 || !weapon(z.wid) ? '' : tintOfPid(z.p !== undefined ? (z.p ? z.p.pid : '') : widPid.get(z.wid)));
  Cos.heroTint = (p) => (anyTint ? Cos.of(p.pid).tint : '');
  // Weapon events (swing, boom, chain, shoot) of a tinted hero run every handler inside its scope.
  const TEV = { swing: 1, boom: 1, chain: 1, shoot: 1 };
  if (F && F.handle) {
    const handle = F.handle;
    F.handle = (ev, ctx) => {
      const id = anyTint && TEV[ev.t] && ev.pid && weapon(ev.wid) ? tintOfPid(ev.pid) : '';
      if (!id || cur) { handle(ev, ctx); return; }
      Cos.tint(id);
      try { handle(ev, ctx); } finally { Cos.tint(''); }
    };
  }

  // ---------------- kill effects (the viewer's) ----------------
  Cos.killStyle = () => { const d = by(Cos.of(ED.Game && ED.Game.myPid).kill); return d ? d.style : ''; };
  // Death burst of style st at (x, y) (k: crowd scale 0.5..1; elite: twice the size).
  Cos.killFx = (st, x, y, col, k, elite) => {
    const s = elite ? 2 : 1, n = (m) => Math.max(1, Math.round(m * k * s * (lowQ() ? 0.5 : 1)));
    if (st === 'embers') {
      for (let i = 0, m = n(5); i < m; i++) F.part(x + (rnd() - 0.5) * 6, y, (rnd() - 0.5) * 40, -30 - rnd() * 50, 0.5 + rnd() * 0.3, rnd() < 0.4 ? 0xffe08a00 : 0xff7a2a00, 2, -40, 0.85);
      if (elite || rnd() < 0.3 * k) F.sprite('fx.ember', x, y, s, 0, 0, 0.9);
    } else if (st === 'souls') {
      for (let i = 0, m = n(3); i < m; i++) F.part(x + (rnd() - 0.5) * 8, y - i * 3, (rnd() - 0.5) * 12, -24 - rnd() * 20, 0.9 + rnd() * 0.4, i ? 0x9fdcff00 : 0xffffff00, 2, -30, 0.8);
      if (elite || rnd() < 0.25 * k) F.sprite('fx.glint', x, y - 4, s, 0, 0x9fdcff, 0.9);
    } else if (st === 'shatter') {
      for (let i = 0, m = n(7); i < m; i++) { const a = rnd() * TAU, v = 50 + rnd() * 60; F.part(x, y, Math.cos(a) * v, Math.sin(a) * v - 40, 0.45 + rnd() * 0.2, i % 3 ? 0xc8f6ff00 : 0x7fe3ff00, rnd() < 0.3 ? 3 : 2, 260, 0.9); }
      if (elite || rnd() < 0.2 * k) F.sprite('fx.ice.burst', x, y + 4, 0.7 * s, 0, 0, 0.8);
    } else if (st === 'gold') {
      for (let i = 0, m = n(4); i < m; i++) F.part(x + (rnd() - 0.5) * 6, y, (rnd() - 0.5) * 60, -70 - rnd() * 60, 0.6 + rnd() * 0.2, i % 2 ? 0xffd24a00 : 0xfff4c000, 2, 300, 0.95);
      if (elite || rnd() < 0.3 * k) F.sprite('fx.glint', x, y - 2, s, 0, 0xffd36b, 1);
    } else if (st === 'nova') {
      F.ring(x, y, 14 * s, 0xff7ad9ff, 0.25, 3, 2);
      for (let i = 0, m = n(6); i < m; i++) { const a = i / m * TAU; F.part(x, y, Math.cos(a) * 90, Math.sin(a) * 90, 0.3, i % 2 ? 0xff7ad900 : 0xffffff00, 2, 0, 0.8); }
      if (elite) F.flash(x, y, 20, 0xff7ad900, 0.12, 0.6);
    }
  };

  // ---------------- level-up effects (each hero's own) ----------------
  Cos.lvlStyle = (pid) => { const d = by(Cos.of(pid).lvl); return d ? d.style : ''; };
  // Level-up burst of style st on hero p (mine: the local hero, which also gets a soft screen flash on Ascension).
  Cos.lvlFx = (st, p, mine) => {
    const x = p.x, y = p.y - 10, q = lowQ() ? 0.5 : 1, n = (m) => Math.max(2, Math.round(m * q));
    if (st === 'pillar') {
      F.ring(x, p.y, 34, 0xfff0c2ff, 0.5, 6, 2); F.flash(x, y, 16, 0xfff0c200, 0.25, 0.8);
      for (let i = 0, m = n(28); i < m; i++) F.part(x + (rnd() - 0.5) * 12, p.y - rnd() * 6, (rnd() - 0.5) * 6, -160 - rnd() * 120, 0.6 + rnd() * 0.3, i % 3 ? 0xfff0c200 : 0xffffff00, 2, 0, 0.97);
    } else if (st === 'runes') {
      F.ring(x, p.y, 44, 0xa070ffff, 0.7, 40, 2); F.ring(x, p.y, 30, 0xc9b3ffff, 0.6, 30, 1); F.sprite('fx.circle.spark', x, y, 2.5, 0, 0xc9b3ff);
      for (let i = 0, m = n(16); i < m; i++) { const a = i / m * TAU; F.part(x + Math.cos(a) * 30, p.y + Math.sin(a) * 14, -Math.sin(a) * 60, Math.cos(a) * 28 - 30, 0.8, i % 2 ? 0xa070ff00 : 0xf2ecff00, 2, -30, 0.9); }
    } else if (st === 'fireworks') {
      const C = [0xff7ad900, 0xffd36b00, 0x7fe3ff00];
      for (let b = 0; b < 3; b++) {
        const bx = x + (b - 1) * 22, by = y - 22 - (b % 2) * 10;
        F.flash(bx, by, 6, C[b], 0.12, 0.8);
        for (let i = 0, m = n(12); i < m; i++) { const a = i / m * TAU, v = 70 + rnd() * 20; F.part(bx, by, Math.cos(a) * v, Math.sin(a) * v, 0.7, i % 4 ? C[b] : 0xffffff00, 2, 90, 0.9); }
      }
    } else if (st === 'ascend') {
      F.ring(x, y, 80, 0xffd36bff, 0.7, 6, 3); F.ring(x, y, 50, 0xffffffff, 0.45, 4, 2); F.sprite('fx.spark.magic', x, p.y - 4, 2.5, 0, 0xffe08a); F.sprite('fx.shield.gold', x, p.y - 2, 1.5);
      for (let i = 0, m = n(30); i < m; i++) { const a = -PI / 2 + (rnd() - 0.5) * 2.4, v = 60 + rnd() * 110; F.part(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.8 + rnd() * 0.3, rnd() < 0.3 ? 0xffffff00 : 0xffd24a00, 2, 120, 0.95); }
      if (mine) F.screen(0xffe08a00, 0.25, 0.3);
    }
  };

  // ---------------- name tags ----------------
  const NC = new Map();
  const hexN = (h) => parseInt(h.slice(1), 16);
  // 0xRRGGBB of name colour id at time t ('' = none: -1); Prism-style lists step 4 times a second.
  Cos.nameRgb = (id, t) => {
    const d = by(id); if (!d || d.kind !== 'ncol') return -1;
    let c = NC.get(id); if (!c) { c = (d.cols || [d.col]).map(hexN); NC.set(id, c); }
    return c.length > 1 ? c[Math.floor(t * 4) % c.length] : c[0];
  };
  Cos.titleOf = (id) => { const d = by(id); return d && d.kind === 'title' ? d.name : ''; };
  // True when hero pid wears a title or a name colour (solo runs then show its tag too).
  Cos.tagged = (pid) => { const c = Cos.of(pid); return !!(c.title || c.ncol); };
  // Name tag over hero p: the title (small, muted gold) above the name in its name colour (default: cream for the local hero, blue for allies).
  Cos.nameTag = (B, p, mine, t) => {
    const c = Cos.of(p.pid), rgb = Cos.nameRgb(c.ncol, t), title = Cos.titleOf(c.title), x = Math.round(p.x);
    B.text(p.name, x, Math.round(p.y - 30), rgb >= 0 ? rgb : mine ? 0xfff1d6 : 0xb8d8ff, 1);
    if (title) B.text(title, x, Math.round(p.y - 40), 0xd8c08a, 1);
  };
})(globalThis.ED || (globalThis.ED = {}));
