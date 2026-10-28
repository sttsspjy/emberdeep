// Core helpers shared by simulation, networking and rendering: math, seeded RNG, colour helpers, uid, ED.CONST.
// Every file attaches to the global ED namespace so the game runs from any static host (or file://) and the sim loads headless in Node.
(function (ED) {
  'use strict';
  const U = ED.U = {};

  ED.CONST = {
    TICK: 1 / 60,         // fixed sim step (s)
    VIEW_W: 640,          // visible world width at the design resolution (world px)
    VIEW_H: 360,          // visible world height
    ARENA: 3200,          // arena side (world px)
    MAX_PLAYERS: 4,
    SNAP_HZ: 20,
    INPUT_HZ: 30,
    HERO_R: 10,           // hero collision radius
    DASH: { t: 0.2, dist: 80, cd: 3.5 }, // dash length (s), distance (px), cooldown (s); i-frames for its whole length
    IFRAME: 0.5,          // invulnerability after a hit (s)
    RUN_LEN: 900,         // survival length (s): the final boss spawns here
    ENRAGE_T: 1020,       // the final boss enrages at this time (s)
    GOLD: { mid: 150, final: 300, win: 300, bounty: 25 }, // mid-boss coin drop, final boss kill and victory gold, run-end bounty (1 per 25 kills, win or loss); x the stage gold multiplier (GAME-DESIGN §9)
    VERSION: '2.0.0',
  };

  U.TAU = Math.PI * 2;
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.angle = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  U.angDiff = (a, b) => { let d = (b - a) % U.TAU; if (d > Math.PI) d -= U.TAU; if (d < -Math.PI) d += U.TAU; return d; };
  U.approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
  U.easeOut = t => 1 - (1 - t) * (1 - t);
  U.easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  U.round1 = v => Math.round(v * 10) / 10;

  // Segment (x1,y1)-(x2,y2) vs circle distance squared.
  U.segDist2 = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = x1 + dx * t - px, cy = y1 + dy * t - py;
    return cx * cx + cy * cy;
  };

  U.hashStr = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  // Small, fast, seedable PRNG (sfc32 seeded via splitmix32).
  U.RNG = function (seed) {
    let s = (seed >>> 0) || 1;
    const sm = () => { s = (s + 0x9e3779b9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
    let a = sm(), b = sm(), c = sm(), d = sm();
    const next = () => {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
    const r = {
      next,
      range: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      chance: p => next() < p,
      pick: arr => arr[Math.floor(next() * arr.length)],
      sign: () => (next() < 0.5 ? -1 : 1),
      shuffle: arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; },
      weighted: (items, wf) => {
        let total = 0; for (const it of items) total += Math.max(0, wf(it));
        if (total <= 0) return items[0];
        let roll = next() * total;
        for (const it of items) { roll -= Math.max(0, wf(it)); if (roll <= 0) return it; }
        return items[items.length - 1];
      },
      seed: () => Math.floor(next() * 4294967295) >>> 0,
    };
    return r;
  };

  U.fmtTime = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };
  U.fmtNum = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
  U.pct = (v) => Math.round(v * 100) + '%';
  U.roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);

  // Colour helpers (hex <-> rgb, mix, shade) used by procedural art. Parsed colours are memoised (bounded) and shared: callers must not mutate the arrays.
  const rgbMemo = new Map(), rgbaMemo = new Map(), HEX2 = [];
  for (let i = 0; i < 256; i++) HEX2.push((i < 16 ? '0' : '') + i.toString(16));
  U.hexToRgb = (hex) => {
    let c = rgbMemo.get(hex);
    if (c) return c;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    c = Object.freeze([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    if (rgbMemo.size >= 512) rgbMemo.clear();
    rgbMemo.set(hex, c);
    return c;
  };
  const byte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  U.rgbToHex = (r, g, b) => '#' + HEX2[byte(r)] + HEX2[byte(g)] + HEX2[byte(b)];
  U.mix = (a, b, t) => { const A = U.hexToRgb(a), B = U.hexToRgb(b); return U.rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); };
  U.shade = (hex, amt) => (amt >= 0 ? U.mix(hex, '#ffffff', amt) : U.mix(hex, '#000000', -amt));
  U.rgba = (hex, a) => {
    let p = rgbaMemo.get(hex);
    if (p === undefined) {
      const c = U.hexToRgb(hex);
      p = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',';
      if (rgbaMemo.size >= 512) rgbaMemo.clear();
      rgbaMemo.set(hex, p);
    }
    return p + a + ')';
  };

  let _uid = 1;
  U.uid = () => _uid++;
  U.resetUid = (v) => { _uid = v || 1; };

  // Index lookup tables so network snapshots can send small integers instead of strings.
  U.indexer = (list) => { const m = {}; list.forEach((k, i) => { m[k] = i; }); return m; };
  // Integer hash of up to three ints (deterministic tile / deco choice): 0 .. 2^32-1.
  U.hash3 = (a, b, c) => {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return h >>> 0;
  };

  // Client draw hooks (optional, read by render.js / actors.js; registered from any file, no DOM at load): ED.WeaponFx[wid] = { proj(B, pr, t), zone(B, z, t), top(B, z, t) (after the actors) } (return true when drawn),
  // ED.SkillFx[skillId] = { zone, top }, ED.ZoneFx[look] = fn(B, z, t) (zones without a weapon id), ED.BossFx[id] = { draw(B, e, t) } (true replaces the default), ED.HeroFx[cls] = fn(B, p, t) (drawn right after the hero).
  ED.WeaponFx = ED.WeaponFx || {}; ED.SkillFx = ED.SkillFx || {}; ED.BossFx = ED.BossFx || {}; ED.HeroFx = ED.HeroFx || {}; ED.ZoneFx = ED.ZoneFx || {};

  // Look registry: projectile / zone look names -> wire index. Files register their looks at load time (fixed script order keeps the index identical on every peer).
  ED.LOOKS = []; ED.LOOK_IDX = {};
  ED.regLook = (...names) => { for (const n of names) if (ED.LOOK_IDX[n] === undefined) { ED.LOOK_IDX[n] = ED.LOOKS.length; ED.LOOKS.push(n); } };
  ED.regLook('dot', 'arrow', 'bolt', 'knife', 'fireball', 'bone', 'skull', 'thorn', 'hammer', 'shield', 'trident', 'web', 'orb', 'tele', 'fire', 'poison', 'holy', 'frost');
})(globalThis.ED || (globalThis.ED = {}));
