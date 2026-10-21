// Pixel-art actors: heroes, weapons, foes, bosses and minions drawn from the embedded atlas (ED.Atlas / ED.ART). Client only. sprites.js keeps the procedural look as the fallback when the art pages are missing.
// Units: art px (1 art px = 2 world px) in the tables, world px in the code. Every draw origin is the actor's feet; moving actors snap to whole world px, offsets (lean, recoil, strike) are multiples of an art px.
(function (ED) {
  'use strict';
  const U = ED.U, A = ED.Atlas, Sp = ED.Sprites;
  const AC = ED.Actors = {};
  const K = 2, TAU = U.TAU, PI = Math.PI, HP = PI / 2;
  const R = () => ED.Render, F = () => ED.FX;

  // True when the atlas is decoded; every caller falls back to the procedural look otherwise.
  AC.on = () => !!(ED.ART && ED.ART.anims && A && A.ok);

  // ---------------- colour helpers ----------------
  const lumOf = (h) => { const c = U.hexToRgb(h); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255; };
  const hex2 = (v) => (v < 16 ? '0' : '') + Math.round(v).toString(16);
  const rgbHex = (r, g, b) => '#' + hex2(U.clamp(r, 0, 255)) + hex2(U.clamp(g, 0, 255)) + hex2(U.clamp(b, 0, 255));
  const OUTLINE = '#222222';
  // Piecewise-linear colour of a stop list at t in 0..1.
  function ramp(stops, t) {
    const n = stops.length - 1, x = U.clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(x));
    return U.mix(stops[i], stops[i + 1], x - i);
  }

  // ---------------- draw scratch ----------------
  const O = { flip: false, variant: '', alpha: 1, rot: 0, anchor: '' };
  // The unrotated body blits of the actor being drawn (feet at buffer px REC.x / REC.y, frame time REC.t) are recorded so AC.floor can stamp their silhouettes into the light buffer.
  let REC = null;
  // One atlas blit: frame i of anim id with its anchor at (x, y) of the current transform.
  function put(c, id, i, x, y, flip, variant, alpha, rot, anchor) {
    const al = alpha === undefined ? 1 : alpha;
    if (REC && !rot && !(variant && variant.charCodeAt(0) === 111)) { const o = REC.ops[REC.n++] || (REC.ops[REC.n - 1] = { id: '', i: 0, x: 0, y: 0, f: false, a: 1, an: '' }); o.id = id; o.i = i; o.x = x; o.y = y; o.f = flip; o.a = al * c.globalAlpha; o.an = anchor || ''; } // 'outline:' variants are rings, not bodies
    O.flip = flip; O.variant = variant || ''; O.alpha = al; O.rot = rot || 0; O.anchor = anchor || '';
    return A.draw(c, id, i, x, y, O);
  }
  AC.put = put;
  function beginRec(s, x, y) { REC = s.rec || (s.rec = { n: 0, ops: [], x: 0, y: 0, t: -1 }); REC.n = 0; REC.x = x; REC.y = y; REC.t = nowT; }
  const q2 = (v) => Math.round(v / K) * K;
  // Contact shadow of an atlas body: its centre sits 3 world px under the feet (Sp.shadow centres it 0.6 r below the origin, for the procedural bodies).
  function shadowAt(c, r, a, lite) { const dy = Math.round(3 - r * 0.6); c.translate(0, dy); Sp.shadow(c, r, a, lite); c.translate(0, -dy); }

  // Brightness floor of actors: the flat grey silhouettes of the actors drawn this frame are stamped into the light buffer g with 'lighten' (k = buffer px to light px), so the light multiply
  // gives their pixels sprite * max(light, 0.5) and nothing else. Silhouettes keep the draw alpha; rotated weapons are not stamped (a rotated flat sheet costs a bake per angle).
  const GREY = '#808080', flatQ = [], flatSeen = new Set();
  const flatMk = (pal) => { const m = {}; for (const h of pal) m[h] = GREY; return m; };
  function flatKey(id) {
    const r = A.anim(id);
    if (r && r.vars && r.vars['pal:g']) return 'pal:g';
    if (r && !flatSeen.has(id)) { flatSeen.add(id); flatQ.push(id); } // built by AC.pump within its time budget; the floor skips the actor until then
    return '';
  }
  AC.floor = (g, list, n, k) => {
    const lw = g.canvas.width / k + 80, lh = g.canvas.height / k + 110;
    g.save(); g.globalCompositeOperation = 'lighten'; g.setTransform(k, 0, 0, k, 0, 0);
    for (let i = 0; i < n; i++) {
      const it = list[i], o = it.o; if (it.k > 2) continue;
      const s = it.k === 0 ? HS.get(o.pid) : FS.get(o.id), rec = s && s.rec;
      if (!rec || rec.t !== nowT || !rec.n || rec.x < -80 || rec.x > lw || rec.y < -20 || rec.y > lh) continue;
      for (let j = 0; j < rec.n; j++) {
        const p = rec.ops[j], key = flatKey(p.id); if (!key) continue;
        g.globalAlpha = p.a; O.flip = p.f; O.variant = key; O.alpha = 1; O.rot = 0; O.anchor = p.an;
        A.draw(g, p.id, p.i, rec.x + p.x, rec.y + p.y, O);
      }
    }
    g.restore();
  };

  // ---------------- palettes ----------------
  // Heroes: exact swap table of ED.ART.swaps plus the player colour on the key colours (the 2nd key colour is a lighter tone of it, so shaded plumes keep their form).
  function heroMap(cls, slot) {
    const sw = (ED.ART.swaps && ED.ART.swaps[cls]) || { base: {}, key: [] }, m = Object.assign({}, sw.base), pc = ED.PLAYER_COLORS[slot] || '#ffffff';
    for (let i = 0; i < sw.key.length; i++) m[sw.key[i]] = i ? U.shade(pc, 0.28) : pc;
    return m;
  }
  const heroKeys = {}, heroMakers = {};
  // Variant key of the hero body for a player slot (registered on every anim before use through Atlas.variant).
  function heroVar(cls, slot, anim) {
    const kk = cls + slot, key = 'pal:h' + slot;
    const mk = heroMakers[kk] || (heroMakers[kk] = () => heroMap(cls, slot));
    return A.variant(anim, key, mk) ? key : '';
  }
  // Flat silhouette in the player colour (dash afterimages).
  const silMakers = {};
  function silVar(slot, anim) {
    const key = 'pal:s' + slot;
    const mk = silMakers[slot] || (silMakers[slot] = (pal) => { const m = {}, pc = ED.PLAYER_COLORS[slot] || '#ffffff'; for (const h of pal) m[h] = h === OUTLINE ? U.shade(pc, -0.55) : pc; return m; });
    return A.variant(anim, key, mk) ? key : '';
  }

  // Foes: source colours of the foe's whole anim set (so every facing maps alike) ranked by luminance onto a ramp of the data colours; ACC lists source colours that become the accent colour.
  const ACC = { // source colour -> 'c' (accent) or 'c+' (light accent)
    skelknight: { '#fdf7ed': 'c+' }, frostknight: { '#fdf7ed': 'c+' }, sentinel: { '#fdf7ed': 'c+' }, forgeknight: { '#fdf7ed': 'c+' }, voidknight: { '#fdf7ed': 'c+' },
    horror: { '#fdf7ed': 'c+' }, priest: { '#fdf7ed': 'c' },
    shroomhulk: { '#97da3f': 'c', '#4ba747': 'c-' }, icegolem: { '#97da3f': 'c', '#4ba747': 'c-' }, automaton: { '#97da3f': 'c', '#4ba747': 'c-' },
  };
  const NATIVE = { skeleton: 1, imp: 1, drone: 1 }; // foes drawn in the source colours
  const foeMakers = {};
  // Ramp stops (dark to light) of a foe's data colours: the lightest stop stays above lightness 0.72 and the darkest above 0.2, so the body reads against the outline and the dark floor.
  const lift = (hex, L) => { const l = lumOf(hex); return l >= L ? hex : U.mix(hex, '#ffffff', (L - l) / (1 - l + 1e-6)); }; // lightens hex until its luminance reaches L
  function foeStops(col) {
    const lo = lift(U.shade(col.b, -0.2), 0.2), mid = lift(col.b, lumOf(lo) + 0.12), body = lift(col.a, lumOf(mid) + 0.12);
    return [lo, mid, body, lift(U.mix(col.a, '#ffffff', 0.28), Math.max(lumOf(body) + 0.12, 0.72))];
  }
  function foeMapOf(type, colOv) {
    const def = ED.ENEMIES[type], col = colOv || def.col, pre = 'foe.' + type + '.', set = new Set(), acc = ACC[type] || {};
    for (const id in ED.ART.pal) if (id.startsWith(pre)) for (const h of ED.ART.pal[id]) set.add(h);
    set.delete(OUTLINE);
    const list = [...set].filter((h) => !acc[h]).sort((a, b) => lumOf(a) - lumOf(b)), n = list.length, m = {};
    const stops = foeStops(col);
    for (let i = 0; i < n; i++) m[list[i]] = ramp(stops, (i + 0.5) / n);
    for (const h in acc) m[h] = acc[h] === 'c+' ? U.shade(col.c, 0.3) : acc[h] === 'c-' ? U.shade(col.c, -0.3) : col.c;
    return m;
  }
  function foeVar(type, anim) {
    if (NATIVE[type]) return '';
    const mk = foeMakers[type] || (foeMakers[type] = () => foeMapOf(type));
    return A.variant(anim, 'pal:f', mk) ? 'pal:f' : '';
  }
  // Minions and Bone Knights wear the minion palette (own variant key: the knight body is also the Skeleton Knight's).
  const minionMk = {};
  function minionVar(anim, base) {
    const mk = minionMk[base] || (minionMk[base] = () => { const mc = ED.ENEMIES.minion.col; return foeMapOf(base, base === 'minion' ? mc : { a: U.mix(mc.a, '#2a6a58', 0.45), b: U.mix(mc.b, '#000000', 0.45), c: mc.c }); }); // the armoured body is darker so its face and plates read
    return A.variant(anim, 'pal:m', mk) ? 'pal:m' : '';
  }
  const stateVar = (anim, k) => (A.variant(anim, k) ? k : '');
  const outlineVar = (anim, hex) => { const k = 'outline:' + hex; return A.variant(anim, k) ? k : ''; };

  // ---------------- foe table ----------------
  const FOEI = new Map();
  // Anim set of a foe: two-way (.walk, .idle), four-way (.walk.d/.u/.l/.r) or eight-way (.walk.0-7, .atk.N, .howl.N).
  function foeInfo(type) {
    let f = FOEI.get(type);
    if (f) return f;
    const p = 'foe.' + type + '.', def = ED.ENEMIES[type];
    f = { type, def, k: 0, fly: !!def.fly };
    if (A.has(p + 'walk')) { f.k = 2; f.walk = p + 'walk'; f.idle = A.has(p + 'idle') ? p + 'idle' : f.walk; }
    else if (A.has(p + 'walk.d')) { f.k = 4; f.walk = { d: p + 'walk.d', u: p + 'walk.u', l: p + 'walk.l', r: p + 'walk.r' }; if (A.has(p + 'cast.d')) f.cast = { d: p + 'cast.d', u: p + 'cast.u', l: p + 'cast.l', r: p + 'cast.r' }; }
    else if (A.has(p + 'walk.0')) {
      f.k = 8; f.walk = []; f.atk = []; f.howl = [];
      for (let i = 0; i < 8; i++) { f.walk.push(p + 'walk.' + i); f.atk.push(A.has(p + 'atk.' + i) ? p + 'atk.' + i : null); f.howl.push(A.has(p + 'howl.' + i) ? p + 'howl.' + i : null); }
    }
    f.death = A.has(p + 'death') ? p + 'death' : null;
    f.rig = RIG[type] || null;
    FOEI.set(type, f);
    return f;
  }

  // Held weapon / shield of a foe: hand = pivot in art px from the feet of the right-facing body; rest / up / down: weapon angles (right-facing, radians) at rest, wound up and after the slam.
  const RIG = {
    skelknight: { w: 'weapon.alt.rusty_sword', hand: [9, -11], rest: -1.15, up: -2.35, down: 1.2, sh: 'shield.buckler', guard: 11, shPos: [0, -10] },
    frostknight: { w: 'weapon.longsword', hand: [9, -11], rest: -1.15, up: -2.35, down: 1.2, sh: 'shield.tower', shPos: [-6, -12] },
    forgeknight: { w: 'weapon.warhammer', hand: [9, -11], rest: -0.95, up: -2.4, down: 1.25, sh: 'shield.round', shPos: [-5, -11] },
    voidknight: { w: 'weapon.longsword', hand: [9, -11], rest: -1.15, up: -2.35, down: 1.2, sh: 'shield.wood', shPos: [-5, -11] },
    sentinel: { sh: 'shield.tower', guard: 10, shPos: [0, -13] },
    crab: { arc: true },
    bonearcher: { w: 'weapon.crossbow', hand: [4, -6], bow: true },
    reaver: { w: 'weapon.alt.cleaver', hand: [5, -6], rest: -0.7, up: -2.2, down: 1.1 },
  };

  // ---------------- per-entity state ----------------
  const FS = new Map(); let nowT = 0, view = null, sweepT = 0;
  AC.begin = (v, t) => {
    view = v; nowT = t;
    if (t - sweepT > 1) { sweepT = t; for (const [id, s] of FS) if (t - s.seen > 2) FS.delete(id); for (const [id, s] of HS) if (t - s.seen > 2) HS.delete(id); }
  };
  const newAnc = () => ({ cx: 0, cy: -10, top: -20, eye: [[0, -14]] });
  function stOf(e, t) {
    let s = FS.get(e.id);
    if (!s) { s = { type: e.type, lx: e.x, ly: e.y, lt: t, sp: 0, hd: 0, mv: -9, dir: 'd', oct: 2, st: e.st, ss: t, sd: 0.5, es: -9, hold: -1, ps: t, pose: '', seen: t, anc: newAnc(), an: null, fi: 0, flip: false, lift: 0, ho: 0 }; FS.set(e.id, s); }
    s.seen = t;
    const dt = t - s.lt;
    if (dt > 0.0001) {
      const dx = e.x - s.lx, dy = e.y - s.ly, v = Math.hypot(dx, dy) / dt;
      s.sp += (v - s.sp) * Math.min(1, dt * 14);
      if (v > 12) { s.hd = Math.atan2(dy, dx); s.mv = t; }
      s.lx = e.x; s.ly = e.y; s.lt = t;
    }
    const st = e.boss ? (e.pose || 'idle') : e.st;
    if (st !== s.st) {
      s.es = s.st; s.est = t; // previous state and when it ended
      s.st = st; s.ss = t; s.sd = e.t > 0.08 && !e.boss ? e.t : 0.5; s.hold = -1;
    }
    return s;
  }
  // Nearest living hero (for facing a standing foe).
  function nearHero(x, y) {
    let best = null, bd = 1e12;
    if (view) for (const p of view.players.values()) { if (p.dead) continue; const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  // Facing angle of a foe: its aim while it attacks or guards, its heading while it moves, else toward the nearest hero.
  const AIMED = { windup: 1, aim: 1, cast: 1, lunge: 1, charge: 1, dive: 1, leap: 1, bash: 1, spin: 1 };
  function faceAng(e, s, t) {
    if (AIMED[e.st] || e.def.guard) return e.aimA || 0;
    if (t - s.mv < 0.25) return s.hd;
    const h = nearHero(e.x, e.y);
    return h ? Math.atan2(h.y - e.y, h.x - e.x) : (e.face < 0 ? PI : 0);
  }
  // Four-way direction letter with hysteresis (the held direction stays until another axis leads by 15%).
  function dir4(s, ang) {
    const c = Math.cos(ang), n = Math.sin(ang), ax = Math.abs(c), ay = Math.abs(n), cur = s.dir;
    const horiz = cur === 'l' || cur === 'r';
    if (horiz ? ay > ax * 1.15 : ax > ay * 1.15) s.dir = horiz ? (n > 0 ? 'd' : 'u') : (c > 0 ? 'r' : 'l');
    else if (horiz) s.dir = c > 0 ? 'r' : 'l'; else s.dir = n > 0 ? 'd' : 'u';
    return s.dir;
  }
  // Eight-way index (0 S, 1 SE, 2 E, 3 NE, 4 N, 5 NW, 6 W, 7 SW) of an angle.
  function oct8(ang) { return (((2 - Math.round(ang / (PI / 4))) % 8) + 8) % 8; }

  // Pose scratch of the foe being drawn: offsets in world px.
  const P = { dx: 0, dy: 0, flash: 0, wp: -1, strike: 0 };
  const EASE = (k) => 1 - (1 - k) * (1 - k);
  // Elite / windup outline colours.
  const RED = '#ff3a2a';

  // ---------------- foes ----------------
  // Draws foe e (feet at buffer px bx, by) through the atlas and leaves the transform at its feet. Returns false when the foe has no art (the caller draws it procedurally).
  AC.foe = (c, e, t, lite, bx, by) => {
    const ok = e.boss ? drawBoss(c, e, t, lite, bx, by) : drawFoe(c, e, t, lite, bx, by);
    REC = null;
    return ok;
  };
  function drawFoe(c, e, t, lite, bx, by) {
    const info = foeInfo(e.type);
    if (!info.k) return false;
    c.setTransform(1, 0, 0, 1, bx, by);
    if (e.st === 'burrow') { mound(c, e, t); return true; }
    const s = stOf(e, t), def = e.def, st = e.st, fly = info.fly;
    beginRec(s, bx, by);
    const fuse = st === 'fuse', wind = st === 'windup' || st === 'aim' || st === 'cast' || fuse; // telegraph states (a spinning totem is firing, not winding up)
    const strike = st === 'lunge' || st === 'charge' || st === 'dive' || st === 'leap' || st === 'bash';
    const fh = F().hitState ? F().hitState(e.id) : null, ha = fh ? F().time - fh.ht : 9;
    const fa = faceAng(e, s, t), fc = Math.cos(fa), fsn = Math.sin(fa);
    // ---- anim and frame ----
    const moving = t - s.mv < 0.3, ph = (e.id | 0) * 0.6180339887;
    let id, fi = 0, flip = false;
    const frozen = e.frozen > 0, flash = e.flash > 0 || (fuse && Math.floor(t * 16) % 2 === 0); // a lit fuse blinks white
    if (info.k === 2) {
      id = moving || wind || strike || !info.idle ? info.walk : info.idle; flip = e.face < 0;
      if (st === 'cast' && info.rig && info.rig.bow) id = info.walk;
      fi = A.frameAt(id, t + ph);
    } else if (info.k === 4) {
      const d = def.spd === 0 && !AIMED[st] ? 'd' : dir4(s, fa); // turrets face the camera until they aim
      id = info.cast && st === 'cast' ? info.cast[d] : info.walk[d];
      fi = info.cast && st === 'cast' ? 0 : A.frameAt(id, (t + ph) * (moving || wind || strike ? 1 : 0.5));
    } else {
      const o = oct8(fa);
      if (st === 'cast' && info.howl[o]) { id = info.howl[o]; fi = 0; }
      else if ((st === 'charge' || st === 'lunge') && info.atk[o]) { id = info.atk[o]; fi = Math.min(A.anim(id).n - 1, Math.floor((t - s.ss) * A.anim(id).fps)); }
      else { id = info.walk[o]; fi = A.frameAt(id, (t + ph) * (moving ? 1 : 0.5)); }
    }
    if (!A.has(id)) return false;
    // wind-up: hold the frame; frozen: hold the frame
    if (wind || frozen) { if (s.hold < 0) s.hold = fi; fi = s.hold % A.anim(id).n; } else s.hold = -1;
    // ---- pose offsets ----
    P.dx = 0; P.dy = 0; P.wp = -1;
    if (wind && !frozen) {
      const wp = U.clamp((t - s.ss) / s.sd, 0, 1); P.wp = wp;
      P.dx = -q2(fc * 2); P.dy = -q2(fsn); // lean one art px away from the target
      if (s.sd >= 0.6 && wp > 0.7 && Math.floor(t / 0.066) % 2) P.dx += 2; // shiver: one art px every 66 ms through the last 30% of a long wind-up
    } else if (strike) { P.dx = q2(fc * 4); P.dy = q2(fsn * 2); }
    if (ha >= 0 && ha < 0.12 && fh) { const m = fh.m, g = fh.crit ? 3 : m >= 0.45 ? 2 : m >= 0.2 ? 1 : 0; P.dx += q2(fh.ax * g); P.dy += q2(fh.ay * g * 0.5); } // recoil: an art px away from the blow
    let lift = 0;
    if (fly) lift = (def.gloom ? 6 : 12 + Math.round(e.r * 0.25)) + q2(Math.sin(t * 4 + (e.id | 0)) * 2);
    if (st === 'leap') lift += q2(Math.sin((1 - U.clamp(e.t / 0.35, 0, 1)) * PI) * 26); // the leaper's arc over its 0.35 s flight
    else if (!fly && moving && A.anim(id).n === 2 && Math.floor((t + ph) * 4) % 2) lift += 2; // two-frame walkers hop one art px at 2 Hz
    s.lift = lift;
    const ox = P.dx, oy = P.dy - lift;
    // ---- behind-the-body rig pieces, body, front pieces ----
    if (e.st === 'fade') c.globalAlpha = 0.4 + Math.sin(t * 34) * 0.18;
    const sdy = Math.round(3 - e.r * 0.6); c.translate(0, sdy); Sp.foeBack(c, e, t, lite); c.translate(0, -sdy); // shadow and auras under the feet
    const rig = info.rig;
    if (rig) rigDraw(c, e, s, info, rig, ox, oy, fa, flip, t, true);
    let variant = flash ? stateVar(id, 'white') : frozen ? stateVar(id, 'frozen') : foeVar(e.type, id);
    if (!flash && !frozen) {
      if (P.wp >= 0) { const ov = outlineVar(id, RED); if (ov) put(c, id, fi, ox, oy, flip, ov, 0.45 + 0.55 * P.wp); }
      else if (e.elite) { const ov = outlineVar(id, ED.AFFIXES[e.elite].color); if (ov) put(c, id, fi, ox, oy, flip, ov, 0.65 + 0.35 * Math.sin(t * 5 + (e.id | 0))); }
    }
    put(c, id, fi, ox, oy, flip, variant, 1);
    if (rig) rigDraw(c, e, s, info, rig, ox, oy, fa, flip, t, false);
    if (e.st === 'fade') c.globalAlpha = 1;
    // ---- anchor ----
    anchorFrom(s.anc, A.anim(id), flip, lift - P.dy, ox);
    if (!lite) extras(c, e, s, id, fi, ox, oy, fa, t, moving);
    s.an = id; s.fi = fi; s.flip = flip; s.wpv = P.wp >= 0 ? P.wp : 0;
    return true;
  }

  // Procedural pixel overlays of single foes: Ice Golem shoulder crystals, Ember Drone muzzle, Lava Hound ember trail (lite: far foes of a crowd skip them).
  const CRY = ['..OO..', '.OLLO.', '.OLCO.', '.OLCO.', 'OLLCDO', 'OLCCDO', 'OLCDDO', 'OCCDDO', 'OCDDDO', '.OOOO.'], CRYC = { O: '#222222', L: '#eaffff', C: '#8fd4f0', D: '#4a8fb8' };
  let crystalCv = null;
  function crystal() {
    if (crystalCv) return crystalCv;
    crystalCv = document.createElement('canvas'); crystalCv.width = 6; crystalCv.height = 10;
    const g = crystalCv.getContext('2d');
    for (let y = 0; y < 10; y++) for (let x = 0; x < 6; x++) { const ch = CRY[y][x]; if (ch !== '.') { g.fillStyle = CRYC[ch]; g.fillRect(x, y, 1, 1); } }
    return crystalCv;
  }
  function extras(c, e, s, id, fi, ox, oy, fa, t, moving) {
    const ty = e.type;
    if (ty === 'icegolem') {
      const r = A.anim(id), f = r.f[fi], cv = crystal(), by = oy + (f.oy + 17 - r.ay) * K; // both crystals stand on the shoulders, the right one shorter and mirrored
      c.imageSmoothingEnabled = false;
      c.drawImage(cv, ox + (f.ox - 3 - r.ax) * K, by - 10 * K, 6 * K, 10 * K);
      c.save(); c.translate(ox + (f.ox + f.w + 3 - r.ax) * K, by); c.scale(-1, 1); c.drawImage(cv, 0, 3, 6, 7, 0, -7 * K, 6 * K, 7 * K); c.restore();
      c.imageSmoothingEnabled = true;
    } else if (ty === 'drone' && (e.st === 'aim' || e.st === 'cast')) {
      const col = e.def.col.c, wp = e.st === 'aim' ? U.clamp((t - s.ss) / s.sd, 0, 1) : 1, big = e.st === 'cast' ? Math.floor(t * 24) % 2 === 0 : wp > 0.5;
      const cen = A.anim(id).anchors.centre || [8, 8], mx = q2(Math.cos(fa) * 9) + ox, my = oy + (cen[1] - A.anim(id).ay) * K + q2(Math.sin(fa) * 6), sz = big ? 2 * K : K;
      c.fillStyle = col; c.fillRect(mx - sz / 2, my - sz / 2, sz, sz);
      if (e.st === 'cast' && big) { c.fillStyle = '#ffffff'; c.fillRect(mx - 1, my - 1, K, K); }
      if (e.st === 'aim') { c.globalAlpha = 0.4 + 0.6 * wp; Sp.glow(c, mx, my, 7, col, 0.5); c.globalAlpha = 1; }
    } else if (ty === 'lavahound' && moving && F().burst && t - (s.emT || 0) > 0.07) {
      s.emT = t;
      F().burst(e.x - Math.cos(s.hd) * 8, e.y - 5, 1, { color: Math.random() < 0.5 ? '#ff8a2a' : '#ffd36b', sp: 16, vy: -28, life: 0.5, size: 1.8, add: true });
    }
  }

  // Writes world-px anchors (relative to the feet) of anim record r into out: centre, top and the eye points; the draw offset (ox, extra rise) shifts them.
  function anchorFrom(out, r, flip, rise, ox) {
    const an = r.anchors, sg = flip ? -1 : 1, cen = an.centre || [r.ax, r.ay - 8];
    out.cx = (cen[0] - r.ax) * K * sg + (ox || 0); out.cy = (cen[1] - r.ay) * K - rise;
    out.top = ((an.top === undefined ? cen[1] - 8 : an.top) - r.ay) * K - rise;
    const ey = an.eye;
    if (ey && ey.length) {
      if (out.eye.length !== ey.length) out.eye = ey.map(() => [0, 0]);
      for (let i = 0; i < ey.length; i++) { out.eye[i][0] = (ey[i][0] - r.ax) * K * sg + (ox || 0); out.eye[i][1] = (ey[i][1] - r.ay) * K - rise; }
    } else { out.eye.length = 1; out.eye[0][0] = out.cx; out.eye[0][1] = out.top + (out.cy - out.top) * 0.6; }
  }

  // ---- rig: foe weapon and shield ----
  // behind = true draws the pieces that belong under the body (the shield on the far side, the weapon when it points up).
  function rigDraw(c, e, s, info, rig, ox, oy, fa, flip, t, behind) {
    const sg = flip ? -1 : 1;
    if (rig.arc) { // a pixel arc of shell where the foe blocks (aimA turns toward the hero)
      const G = e.def.guard, la = e.aimA || 0;
      if ((Math.sin(la) < -0.3) !== behind) return;
      const h = Math.min(G.arc, 2.8) / 2, r = e.r + 5, n = Math.max(5, Math.round(h * 2 * r / 5));
      for (let i = 0; i <= n; i++) { const a = la - h + 2 * h * i / n, x = q2(Math.cos(a) * r) + ox, y = q2(Math.sin(a) * r * 0.7) + oy - 12; c.fillStyle = '#222222'; c.fillRect(x - 3, y - 3, 6, 6); }
      for (let i = 0; i <= n; i++) { const a = la - h + 2 * h * i / n, x = q2(Math.cos(a) * r) + ox, y = q2(Math.sin(a) * r * 0.7) + oy - 12; c.fillStyle = i === n >> 1 ? '#ffffff' : e.def.col.c; c.fillRect(x - 2, y - 2, 4, 4); }
      return;
    }
    if (rig.guard) { // the guard shield stands where the foe blocks (aimA turns toward the hero); behind the body when that points up
      const la = e.aimA || 0, up = Math.sin(la) < -0.3;
      if (up === behind) put(c, rig.sh, 0, ox + Math.round(Math.cos(la) * rig.guard), oy + rig.shPos[1] * K + Math.round(Math.sin(la) * rig.guard * 0.55), false, '', 1);
    } else if (rig.sh && !behind) put(c, rig.sh, 0, ox + rig.shPos[0] * K * sg, oy + rig.shPos[1] * K, flip, '', 1); // the off-hand shield rides over the body
    if (!rig.w || behind) return; // the weapon is always seen in front of the (three-quarter view) body
    const wa = rigAngle(e, s, rig, fa, flip, t), hx = ox + rig.hand[0] * K * sg, hy = oy + rig.hand[1] * K;
    const rr = A.anim(rig.w); if (!rr) return;
    const dirA = ((rr.anchors.dir || 0) - 90) * PI / 180;
    // bows face right in the art; the others point up: rotation = aim - drawn direction (mirrored sprites mirror the drawn direction)
    const rot = wa - (flip ? PI - dirA : dirA);
    put(c, rig.w, 0, hx, hy, flip, '', 1, rot < 0 ? rot + TAU : rot);
  }
  // Weapon angle (screen) of a rigged foe: at rest, raised through the wind-up, slammed down after it, then back to rest; a bow follows the aim.
  function rigAngle(e, s, rig, fa, flip, t) {
    let a;
    if (rig.bow) { a = e.aimA || fa; if (!(e.st === 'aim' || e.st === 'windup')) a = fa; return a; }
    const sgn = flip ? -1 : 1, rest = rig.rest, up = rig.up, dn = rig.down;
    let k = rest;
    if (e.st === 'windup') k = rest + (up - rest) * EASE(U.clamp((t - s.ss) / s.sd, 0, 1));
    else if (s.es === 'windup' && t - s.est < 0.3) { const u = (t - s.est) / 0.3; k = u < 0.4 ? up + (dn - up) * EASE(u / 0.4) : dn + (rest - dn) * EASE((u - 0.4) / 0.6); }
    return flip ? PI - k : k;
  }

  // ---- burrowed worm: pixel dirt mound with a fading trail ----
  function mound(c, e, t) {
    const tr = e._trail || (e._trail = []), last = tr[tr.length - 1];
    if (!last || Math.hypot(last[0] - e.x, last[1] - e.y) > 10) { tr.push([e.x, e.y, t]); if (tr.length > 9) tr.shift(); }
    for (const p of tr) {
      const age = t - p[2]; if (age > 1.8) continue;
      const k = 1 - age / 1.8, rx = q2(p[0] - e.x), ry = q2(p[1] - e.y + 2);
      c.globalAlpha = 0.75 * k; c.fillStyle = '#6b5238'; c.fillRect(rx - 4, ry - 2, 8, 4); c.fillStyle = '#9a7c58'; c.fillRect(rx - 2, ry - 2, 4, 2);
    }
    c.globalAlpha = 1;
    const r = q2(e.r * 1.0), rise = Math.round(Math.sin(t * 9 + e.id) * 0.8 / K) * K;
    c.fillStyle = '#3a2b1d'; c.fillRect(-r - 4, -2, r * 2 + 8, 6);
    c.fillStyle = '#222222'; c.fillRect(-r - 2, -2 - r + rise, r * 2 + 4, r + 2); c.fillRect(-r + 2, -4 - r + rise, r * 2 - 4, 4);
    c.fillStyle = '#6b5238'; c.fillRect(-r, -r + rise, r * 2, r); c.fillRect(-r + 4, -r - 2 + rise, r * 2 - 8, 2);
    c.fillStyle = '#9a7c58'; c.fillRect(-r + 2, -r + rise, r, 2); c.fillRect(-r + 4, -r - 2 + rise, r - 2, 2);
    c.fillStyle = '#3a2b1d'; c.fillRect(2, -r + 4 + rise, 4, 2); c.fillRect(-4, -r + 8 + rise, 2, 2);
    Sp.glow(c, 0, -r, r * 1.2, e.def.col.c, 0.18);
  }

  // True when actor o stands still (its drawn position may sit on the 2 px art grid, so its pixels line up with the tiles).
  AC.still = (o) => {
    const s = o.pid !== undefined ? HS.get(o.pid) : FS.get(o.id);
    return !!s && s.sp < 5 && !o.moving && !o.dashing;
  };
  // Wind-up progress 0..1 of a foe's current telegraph (0 when none).
  AC.windupP = (e) => { const s = FS.get(e.id); return s && s.wpv > 0 && s.st === e.st ? s.wpv : 0; };

  // ---------------- effect sprites ----------------
  // Variant key of fx anim id recoloured to hex (its colours ranked by luminance onto a dark-to-white ramp of hex); '' when the anim is missing.
  const tintMk = {};
  AC.tint = (id, hex) => {
    const mk = tintMk[hex] || (tintMk[hex] = (pal) => { const l = pal.filter((h) => h !== OUTLINE), m = {}; l.forEach((h, i) => { m[h] = ramp([U.shade(hex, -0.35), hex, U.mix(hex, '#ffffff', 0.6)], (i + 0.5) / l.length); }); return m; });
    const key = 'pal:t' + hex;
    return A.variant(id, key, mk) ? key : '';
  };
  // Spawn-in ring of a spawn zone (z.t of z.dur): the Circle Spark sprite in the arrival colour, frames spread over the telegraph, with a dust ring under it.
  AC.spawnRing = (c, z, k, t) => {
    const id = 'fx.circle.spark', r = A.anim(id); if (!r) return false;
    const col = z.elite ? '#ffb13a' : '#b8a0ff', x = Math.round(z.x), y = Math.round(z.y);
    put(c, id, Math.min(r.n - 1, Math.floor(k * r.n)), x, y - 2, false, AC.tint(id, col), 1);
    const ring = A.anim('fx.smoke.ring');
    if (ring) put(c, 'fx.smoke.ring', A.frameAt('fx.smoke.ring', t * 0.7), x, y + 2, false, AC.tint('fx.smoke.ring', col), 0.6);
    return true;
  };

  // ---------------- warm-up ----------------
  // Entering a stratum queues the recoloured and white sheets of its roster; AC.pump builds a few per frame inside a small time budget.
  const animsOf = new Map(), wq = [];
  function foeAnims(type) {
    let l = animsOf.get(type);
    if (!l) { l = []; const pre = 'foe.' + type + '.'; for (const id in ED.ART.anims) if (id.startsWith(pre) && A.has(id)) l.push(id); animsOf.set(type, l); }
    return l;
  }
  AC.warm = (stratum) => {
    wq.length = 0;
    const b = ED.biomeFor(stratum), roster = b.enemies;
    const add = (id, type) => { wq.push(id, type, 2, id, type, 1, id, type, 3, id, type, 0); }; // popped last-in-first-out: recolour (0), light-floor silhouette (3), white flash (1), wind-up outline (2)
    if (b.boss) for (const id in ED.ART.anims) if (id.startsWith('boss.' + b.boss + '.') && A.has(id)) add(id, b.boss);
    for (let i = roster.length - 1; i >= 0; i--) for (const id of foeAnims(roster[i][0])) add(id, roster[i][0]);
  };
  AC.pump = () => {
    const t0 = performance.now();
    while ((flatQ.length || wq.length) && performance.now() - t0 < 1.2) { // one sheet per step, so a big boss anim never stalls a frame for long
      if (flatQ.length) { A.variant(flatQ.pop(), 'pal:g', flatMk); continue; } // silhouettes of anims that were drawn before their warm-up step
      const step = wq.pop(), type = wq.pop(), id = wq.pop();
      if (step === 3) A.variant(id, 'pal:g', flatMk);
      else if (step === 0) { if (ED.ENEMIES[type].boss) bossVar(type, id); else foeVar(type, id); }
      else if (step === 1) stateVar(id, 'white'); else outlineVar(id, RED);
    }
  };

  // ---------------- bosses ----------------
  // Frame-animated bodies. pose (e.pose: idle, wind, dash, cast, slam, air, fade, roar) -> { a: anim (a '.' ends it with the facing letter l / r), f: [from, to], m: 'hold' (frames spread over the wind-up) | 'once' (at fps, then holds) | 'loop' (at fps); rev: 'once' backwards }.
  // front: front-facing art (no mirror); skip: hit frames with a baked colour flash.
  const WD = 0.75; // wind-up length assumed for a held pose (the shortest boss telegraph)
  const BOSS = {
    bonewarden: { idle: 'idle', walk: 'walk', hit: 'hit', skip: 1, eyeF: 0.1, pose: {
      wind: { a: 'attack', f: [0, 3], m: 'hold' }, dash: { a: 'walk', f: [0, 3], m: 'loop', fps: 18 }, cast: { a: 'attack', f: [2, 3], m: 'loop', fps: 5 },
      slam: { a: 'attack', f: [4, 7], m: 'once', fps: 12 }, air: { a: 'attack', f: [5, 5], m: 'hold' }, roar: { a: 'shield', f: [0, 3], m: 'loop', fps: 8 }, fade: { a: 'death', f: [0, 3], m: 'once', fps: 8 } } },
    sporemother: { idle: 'idle', walk: 'walk', hit: 'hit', skip: 1, front: true, eyeF: 0.42, pose: {
      wind: { a: 'charge', f: [0, 2], m: 'hold' }, cast: { a: 'attack', f: [0, 4], m: 'loop', fps: 8 }, slam: { a: 'attack', f: [3, 4], m: 'once', fps: 10 }, roar: { a: 'attack', f: [0, 4], m: 'loop', fps: 14 }, dash: { a: 'charge', f: [2, 2], m: 'hold' }, air: { a: 'charge', f: [2, 2], m: 'hold' } } },
    rimeheart: { idle: 'idle', walk: 'walk', hit: 'hit', skip: 1, front: true, eyeF: 0.3, pose: {
      wind: { a: 'charge.', f: [0, 2], m: 'hold' }, cast: { a: 'charge.', f: [1, 2], m: 'loop', fps: 4 }, slam: { a: 'attack.', f: [0, 3], m: 'once', fps: 10 }, air: { a: 'attack.', f: [1, 1], m: 'hold' }, dash: { a: 'attack.', f: [1, 2], m: 'loop', fps: 10 }, roar: { a: 'charge.', f: [2, 2], m: 'hold' } } },
    forgelord: { idle: 'idle', walk: 'walk', hit: 'hit', skip: 0, front: true, hammer: true, eyeF: 0.38, pose: {} },
    drownedking: { idle: 'idle', walk: 'walk', hit: 'hit', skip: -1, eyeF: 0.09, pose: {
      wind: { a: 'attack1', f: [0, 1], m: 'hold' }, cast: { a: 'attack3', f: [1, 3], m: 'loop', fps: 6 }, slam: { a: 'attack2', f: [0, 3], m: 'once', fps: 12 }, air: { a: 'attack1', f: [2, 2], m: 'hold' }, dash: { a: 'walk', f: [0, 7], m: 'loop', fps: 16 }, roar: { a: 'attack1', f: [3, 3], m: 'hold' }, fade: { a: 'death', f: [0, 2], m: 'once', fps: 8 } } },
    hollowking: { idle: 'idle', walk: 'walk', hit: 'hit', skip: 1, crown: true, eyeF: 0.1, pose: {
      wind: { a: 'attack', f: [0, 3], m: 'hold' }, cast: { a: 'attack', f: [0, 7], m: 'loop', fps: 10 }, slam: { a: 'attack', f: [4, 7], m: 'once', fps: 12 }, roar: { a: 'attack', f: [0, 1], m: 'loop', fps: 6 }, fade: { a: 'death', f: [0, 3], m: 'once', fps: 8, rev: 1 }, air: { a: 'attack', f: [3, 3], m: 'hold' } } },
  };
  // Hop height (world px) and duration (s) of a boss 'air' pose.
  const AIR = { rimeheart: [30, 1.2], forgelord: [40, 1.1], drownedking: [38, 1.0] };
  const BOSS_KEEP = { bonewarden: 0.35, sporemother: 0.3, rimeheart: 0.3, forgelord: 0.08, drownedking: 0.35, hollowking: 0.1 }; // share of the source colour kept by the boss gradient map (saturated colours keep more)
  const bossMk = {};
  // Gradient map of a boss: the source colours ranked by luminance onto the boss ramp, mixed back toward the source so gold, skin and flames keep their identity.
  function bossMap(type) {
    const col = ED.ENEMIES[type].col, pre = 'boss.' + type + '.', set = new Set();
    for (const id in ED.ART.pal) if (id.startsWith(pre)) for (const h of ED.ART.pal[id]) set.add(h);
    set.delete(OUTLINE);
    const list = [...set].sort((a, b) => lumOf(a) - lumOf(b)), n = list.length, m = {}, stops = foeStops(col), keep = BOSS_KEEP[type] === undefined ? 0.3 : BOSS_KEEP[type];
    for (let i = 0; i < n; i++) {
      const h = list[i], rgb = U.hexToRgb(h), mx = Math.max(rgb[0], rgb[1], rgb[2]), mn = Math.min(rgb[0], rgb[1], rgb[2]), sat = mx > 0 ? (mx - mn) / mx : 0;
      m[h] = U.mix(ramp(stops, (i + 0.5) / n), h, keep * (0.4 + 0.9 * sat));
    }
    return m;
  }
  function bossVar(type, anim) {
    const mk = bossMk[type] || (bossMk[type] = () => bossMap(type));
    return A.variant(anim, 'pal:b', mk) ? 'pal:b' : '';
  }
  // The hollow crown overlay in the boss pink (the art is plain gold).
  const crownMk = (pal) => { const m = {}, l = pal.filter((h) => h !== OUTLINE); l.forEach((h, i) => { m[h] = ramp(['#8a4ab0', '#d99cff', '#ffe6fa'], (i + 0.5) / l.length); }); return m; };
  const crownVar = () => (A.variant('boss.hollowking.crown', 'pal:c', crownMk) ? 'pal:c' : '');

  // Draws boss e (feet at bx, by of the buffer). Returns false when the boss has no art.
  function drawBoss(c, e, t, lite, bx, by) {
    const B = BOSS[e.type], pre = 'boss.' + e.type + '.';
    if (!B || !A.has(pre + 'idle')) return false;
    c.setTransform(1, 0, 0, 1, bx, by);
    const s = stOf(e, t), pose = e.pose || 'idle', el = t - s.ss, flash = e.flash > 0, frozen = e.frozen > 0;
    beginRec(s, bx, by);
    const fh = F().hitState ? F().hitState(e.id) : null;
    if (fh && fh.ht !== s.hitSeen && (fh.crit || fh.m > 0.06) && F().time - (s.hitAt === undefined ? -9 : s.hitAt) > 1.5) { s.hitAt = F().time; s.hitSeen = fh.ht; } // heavy hits play the hit frames, at most once per 1.5 s
    const moving = t - s.mv < 0.3, face = e.face < 0 ? 'l' : 'r', flip = !B.front && e.face < 0;
    let id, fi, P = B.pose[pose], air = 0, shake = 0;
    const hitting = !P && F().time - (s.hitAt === undefined ? -9 : s.hitAt) < (A.has(pre + 'hit') ? A.anim(pre + 'hit').n / A.anim(pre + 'hit').fps : 0);
    if (hitting) {
      id = pre + B.hit; const n = A.anim(id).n; let k = Math.floor((F().time - s.hitAt) * A.anim(id).fps); k = Math.min(n - 1, k); if (k === B.skip) k = Math.min(n - 1, k + 1); fi = k;
    } else if (P) {
      let an = P.a; if (an.endsWith('.')) an += face; id = pre + an;
      if (!A.has(id)) { id = pre + B.idle; P = null; }
    }
    if (P && A.has(id) && !hitting) {
      const r = A.anim(id), lo = P.f[0], hi = Math.min(P.f[1], r.n - 1);
      if (P.m === 'hold') fi = lo + Math.min(hi - lo, Math.floor(U.clamp(el / WD, 0, 0.999) * (hi - lo + 1)));
      else if (P.m === 'once') { const k = Math.min(hi - lo, Math.floor(el * (P.fps || r.fps))); fi = P.rev ? hi - k : lo + k; } // rev: the frames play backwards
      else fi = lo + (Math.floor((t + el) * (P.fps || r.fps)) % (hi - lo + 1));
      if (pose === 'wind') { shake = el > WD * 0.7 && Math.floor(t / 0.066) % 2 ? 2 : 0; }
      if (pose === 'roar') shake = Math.floor(t / 0.05) % 2 ? 2 : -2;
      if (pose === 'fade') c.globalAlpha = 0.35 + Math.sin(t * 30) * 0.15;
      if (pose === 'air' && AIR[e.type]) air = Math.round(Math.sin(U.clamp(el / AIR[e.type][1], 0, 1) * PI) * AIR[e.type][0]);
    } else if (!hitting) {
      id = pre + (moving ? B.walk : B.idle); fi = A.frameAt(id, t);
    }
    if (!A.has(id)) return false;
    const ga = c.globalAlpha;
    shadowAt(c, e.r, 0.4);
    if (e.exposed) Sp.glow(c, 0, -e.r, e.r * 2.2, '#ff3a3a', 0.25 + Math.sin(t * 9) * 0.1);
    const ox = shake - (pose === 'wind' ? Math.round(Math.cos(e.aimA || 0) * 2) : 0), oy = -air;
    // hammer under the body when it points up, over it otherwise
    const hm = B.hammer ? forgeHammer(e, s, t, pose, el) : null;
    if (hm && Math.sin(hm.ang) < -0.25) drawHammer(c, hm, ox, oy, flip);
    const variant = flash ? stateVar(id, 'white') : frozen ? stateVar(id, 'frozen') : bossVar(e.type, id);
    if (pose === 'wind' && !flash && !frozen) { const ov = outlineVar(id, RED); if (ov) put(c, id, fi, ox, oy, flip, ov, 0.45 + 0.55 * U.clamp(el / WD, 0, 1)); }
    put(c, id, fi, ox, oy, flip, variant, 1);
    if (hm && !(Math.sin(hm.ang) < -0.25)) drawHammer(c, hm, ox, oy, flip);
    if (B.crown && A.has('boss.hollowking.crown')) { const r = A.anim(id), cn = r.anchors.centre || [r.ax, r.ay - 30], tp = r.anchors.top === undefined ? r.ay - 60 : r.anchors.top; put(c, 'boss.hollowking.crown', 0, ox + (cn[0] - r.ax) * K * (flip ? -1 : 1), oy + (tp + 4 - r.ay) * K, flip, crownVar(), 1); }
    c.globalAlpha = ga;
    anchorFrom(s.anc, A.anim(id), flip, air, ox);
    s.anc.eye.length = 1; s.anc.eye[0][1] = s.anc.top * (1 - B.eyeF) - air; // eye glow at the head (fraction of the height below the top), not the generic 30% line
    s.an = id; s.fi = fi; s.flip = flip; s.lift = air; s.wpv = pose === 'wind' ? U.clamp(el / WD, 0, 1) : 0;
    return true;
  }
  // Forgelord hammer angle (screen, right-facing) by pose: raised for the wind-up, slammed down, rest at the side.
  const HM = { ang: 0, x: 0, y: 0 };
  function forgeHammer(e, s, t, pose, el) {
    let a = -0.55;
    if (pose === 'wind') a = -0.55 + (-2.5 + 0.55) * EASE(U.clamp(el / WD, 0, 1));
    else if (pose === 'slam') a = el < 0.12 ? -2.5 + 3.4 * EASE(el / 0.12) : 0.9 - 0.4 * EASE(U.clamp((el - 0.12) / 0.4, 0, 1));
    else if (pose === 'cast' || pose === 'roar') a = -1.5 + Math.sin(t * 5) * 0.35;
    else if (pose === 'air') a = -2.2;
    HM.ang = a; return HM;
  }
  function drawHammer(c, hm, ox, oy, flip) {
    const sg = flip ? -1 : 1, hx = ox + 13 * K * sg, hy = oy - 12 * K, a = flip ? PI - hm.ang : hm.ang, rr = A.anim('weapon.alt.big_hammer'); if (!rr) return;
    put(c, 'weapon.alt.big_hammer', 0, hx, hy, flip, '', 1, nrm(a - (flip ? PI - dirOf(rr) : dirOf(rr))));
  }

  // ---------------- anchors ----------------
  // {cx, cy, top, eye: [[x, y]...]} of an actor in world px relative to its feet, from its last drawn atlas anim; null when it has none (the renderer then uses the procedural sizes).
  AC.anchor = (o) => {
    const s = FS.get(o.id) || HS.get(o.pid);
    return s && s.an ? s.anc : null;
  };

  // ---------------- heroes ----------------
  const HS = new Map();
  function hsOf(p, t) {
    const key = p.pid;
    let s = key === undefined ? null : HS.get(key);
    if (!s) { s = { lx: p.x, ly: p.y, lt: t, sp: 0, vx: 0, vy: 0, rt: 0, seen: t, anc: newAnc(), an: null, deadT: -9, wasDead: false, downT: -9, wasDown: false, fi: 0 }; if (key !== undefined) HS.set(key, s); }
    s.seen = t;
    const dt = t - s.lt;
    if (dt > 0.0001 && dt < 0.5) {
      const vx = (p.x - s.lx) / dt, vy = (p.y - s.ly) / dt, k = Math.min(1, dt * 14);
      s.vx += (vx - s.vx) * k; s.vy += (vy - s.vy) * k; s.sp = Math.hypot(s.vx, s.vy);
    } else if (dt >= 0.5) { s.vx = s.vy = s.sp = 0; }
    s.lx = p.x; s.ly = p.y; s.lt = t;
    if (p.dead && !s.wasDead) { s.deadT = t; F().atlasFx('fx.puff', p.x, p.y - 8); } // the body fades over 0.6 s under a puff
    s.wasDead = !!p.dead;
    if (p.downed && !s.wasDown) s.downT = t; s.wasDown = !!p.downed;
    return s;
  }
  // Swing pose of the one default attack: weapon angle wa (screen), body push -1..1 along the aim, thrust 0..1, ranged recoil kick 0..1.
  // Anticipation (0 - t0, pull back and crouch), strike (t0 - t1, accelerating sweep and lunge), follow-through (t1 - D, overshoot and settle). Timing comes from Sprites.atkTimes, so attack speed needs no re-timing.
  const SW = { wa: 0, push: 0, thr: 0, kick: 0 };
  function swing(w, an, face, u, side) {
    let wa = face, push = 0, thr = 0, kick = 0;
    if (w.kind === 'melee') {
      const t0 = an.t0, t1 = an.t1, D = an.D, spin = w.arc > 6, thrust = w.arc < 1, half = spin ? 0 : thrust ? 0.1 : w.arc * 0.6, pull = thrust ? 0.1 : 0.32;
      const k0 = u < t0 ? u / t0 : 1, k1 = U.clamp((u - t0) / (t1 - t0), 0, 1), k2 = U.clamp((u - t1) / (D - t1), 0, 1), e1 = 1 - Math.pow(1 - k1, 3), e2 = U.easeInOut(k2);
      let off = 0;
      if (u < t0) { off = -side * (half + pull) * U.easeOut(k0); push = -0.55 * k0; if (spin) wa = face - 0.4 * U.easeOut(k0); } // the weapon travels from the aim to the pulled-back pose
      else if (u < t1) { off = -side * (half + pull) * (1 - e1) + side * half * e1; push = -0.55 + 1.55 * e1; thr = e1; if (spin) wa = face - 0.4 + (TAU + 0.4) * e1; }
      else { // overshoot 0.18 rad in the first fifth, then settle back to the aim
        const os = k2 < 0.2 ? 0.18 * U.easeOut(k2 / 0.2) : 0.18, back = k2 < 0.2 ? 0 : U.easeInOut((k2 - 0.2) / 0.8);
        off = side * ((half + os) * (1 - back)); push = 1 - e2; thr = 1 - e2;
      }
      if (!spin) wa = face + off; else if (u >= t1) wa = face;
    } else { kick = Math.exp(-u * 26); push = -0.8 * kick; }
    SW.wa = wa; SW.push = push; SW.thr = thr; SW.kick = kick;
    return SW;
  }
  const HELD_OUT = { bow: 4, crossbow: 2, staff: 8, wand: 1 }; // art px the grip sits ahead of the hand along the aim
  // Anim-relative drawn direction of a weapon sprite (radians, screen angle: 0 right, clockwise); 'dir' in the art data is degrees clockwise from up.
  const dirOf = (r) => ((r.anchors.dir || 0) - 90) * PI / 180;
  const nrm = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
  // Draws weapon sprite `id` with its grip at (hx, hy), the drawn direction turned to screen angle wa (mirrored sprites mirror the direction).
  function weaponAt(c, id, hx, hy, wa, flip, variant, extraRot) {
    const r = A.anim(id); if (!r) return;
    const dirA = dirOf(r), rot = wa - (flip ? PI - dirA : dirA) + (extraRot || 0);
    put(c, id, 0, hx, hy, flip, variant, 1, nrm(rot));
  }

  const HIT_T = 0.14;
  let HX = 0, HY = 0; // buffer px of the hero being drawn (the transform origin, its feet)
  // Draws hero p at the current transform's origin (its feet). anim = FX attack animation of this hero or null. Returns false when no art is available (the caller draws the procedural hero).
  AC.hero = (c, p, t, anim) => {
    const cls = ED.CLASSES[p.cls]; if (!cls) return false;
    const idleId = 'hero.' + p.cls + '.idle';
    if (!A.has(idleId)) return false;
    const m = c.getTransform(), scaled = Math.abs(m.a - 1) > 0.02 || Math.abs(m.d - 1) > 0.02;
    if (scaled) { c.save(); const k = Math.max(1, Math.round(m.a)); c.setTransform(k, 0, 0, k, Math.round(m.e), Math.round(m.f)); }
    HX = m.e; HY = m.f;
    drawHero(c, p, t, anim, cls, idleId);
    REC = null;
    if (scaled) c.restore();
    return true;
  };

  function drawHero(c, p, t, anim, cls, idleId) {
    const s = hsOf(p, t), slot = p.slot | 0, face = p.face || 0, cf = Math.cos(face), flip = cf < 0, sg = flip ? -1 : 1;
    const local = !!(R() && p.pid === R().local);
    const runId = 'hero.' + p.cls + '.run', hitId = 'hero.' + p.cls + '.hit';
    const ga = c.globalAlpha;
    // ---- dead: the downed pose greys out and fades over 0.6 s ----
    if (p.dead) {
      const ds = t - s.deadT;
      shadowAt(c, 9, 0.3);
      c.globalAlpha = ga * (ds < 0.6 ? 1 - 0.7 * ds / 0.6 : 0.3);
      lying(c, p, hitId, flip, 'grey', cls);
      c.globalAlpha = ga; s.an = hitId; anchorFrom(s.anc, A.anim(hitId), flip, 0, 0); s.anc.top = -14; s.anc.cy = -6; s.anc.eye[0][1] = -8;
      return;
    }
    shadowAt(c, 10);
    if (p.downed) { lying(c, p, hitId, flip, 'grey', cls); s.an = hitId; anchorFrom(s.anc, A.anim(hitId), flip, 0, 0); s.anc.top = -14; s.anc.cy = -6; s.anc.eye[0][1] = -8; return; }
    beginRec(s, HX, HY);
    // ---- alpha: invulnerability flicker, dash, Vanish (readable to yourself, nearly gone to allies) ----
    let a = 1;
    if (p.invuln > 0 && !p.dashing && Math.floor(t * 20) % 2 === 0) a = 0.55;
    if (p.dashing) a *= 0.8;
    if (p.stealthT > 0) a *= local ? 0.45 : 0.2;
    c.globalAlpha = ga * a;
    // ---- body anim and frame ----
    const hurtA = hurtAge(p.pid), hit = hurtA >= 0 && hurtA < HIT_T;
    const mv = p.moving || s.sp > 25;
    let id = idleId, fi;
    if (hit) { id = hitId; fi = 0; }
    else if (p.dashing) { id = runId; fi = 1; }
    else if (mv) {
      id = runId;
      const rr = A.anim(id), dt = Math.min(0.1, t - (s.rtT === undefined ? t : s.rtT)), spd = Math.max(40, s.sp || 120), fps = U.clamp(10 * spd / 120, 7.7, 14.3);
      const back = s.sp > 20 && (s.vx * cf + s.vy * Math.sin(face)) / s.sp < -0.2; // backpedalling while aiming: the feet run backwards
      s.rt += dt * fps * (back ? -1 : 1); fi = ((Math.floor(s.rt) % rr.n) + rr.n) % rr.n;
    } else fi = A.frameAt(id, t + slot * 0.21);
    s.rtT = t;
    const body = A.anim(id);
    // ---- attack pose ----
    const wd = Sp.weaponArt(p), w = wd.w;
    const swinging = !!anim && anim.atkT < anim.D;
    let wa = face, bx = 0, by = 0, thr = 0, kick = 0, push = 0;
    anim_D = anim ? anim.D : 0.3;
    if (swinging) {
      const base = anim.a !== undefined ? anim.a : face;
      swing(w, anim, base, anim.atkT, anim.side || 1);
      wa = SW.wa; push = SW.push; thr = SW.thr; kick = SW.kick;
      const L = w.kind === 'melee' ? (w.arc < 1 ? 6 : 4) : 2;
      bx = q2(Math.cos(base) * push * L); by = q2(Math.sin(base) * push * L * 0.5); // lunge and pull-back in whole art px
    }
    if (hit) { bx -= sg * 2; }
    // ---- body variant ----
    let variant = hit && hurtA < 0.05 ? stateVar(id, 'white') : heroVar(p.cls, slot, id);
    // ---- weapon pivot (the hand) ----
    const hand = body.anchors.hand || [body.ax + 3, body.ay - 6];
    const f0 = body.f[fi], ib = A.anim(idleId), bobA = Math.round(U.clamp((f0.oy - ib.f[0].oy) * 0.5, -2, 2)); // the hand follows the body's stretch and crouch
    const hx = bx + (hand[0] - body.ax) * K * sg, hy = by + (hand[1] - body.ay + bobA) * K;
    // ---- draw order: pieces behind the body, the body, pieces in front ----
    const wBehind = Math.sin(wa) < -0.25;
    if (wd.twin) twinDraw(c, p, wd, anim, swinging, face, flip, hx, hy, t, true);
    if (wBehind) heroWeapon(c, p, wd, hx, hy, wa, flip, thr, kick, t, swinging ? anim.atkT : 9);
    if (p.cls === 'knight' && !p.shieldOut) put(c, 'shield.kite', 0, bx - 5 * K * sg, by - 8 * K + bobA * K, flip, '', 1);
    if (p.stealthT > 0 && local) { const ov = outlineVar(id, '#b78cff'); if (ov) put(c, id, fi, bx, by, flip, ov, 1); }
    put(c, id, fi, bx, by, flip, variant, 1);
    if (!wBehind) heroWeapon(c, p, wd, hx, hy, wa, flip, thr, kick, t, swinging ? anim.atkT : 9);
    if (wd.twin) twinDraw(c, p, wd, anim, swinging, face, flip, hx, hy, t, false);
    if (p.cls === 'cleric') halo(c, bx, by + (f0.oy - body.ay) * K, t);
    if (p.mastery10) { c.strokeStyle = U.rgba('#ffd36b', 0.55 + Math.sin(t * 4) * 0.25); c.lineWidth = 1; c.beginPath(); c.ellipse(0, -2, 13, 4, 0, 0, TAU); c.stroke(); }
    c.globalAlpha = ga;
    s.an = id; s.fi = fi; anchorFrom(s.anc, body, flip, 0, bx);
    s.anc.top = (ib.f[0].oy - ib.ay) * K; // head line of the standing pose: stable for name labels (the anim set's union box includes the taller hit pose)
  }

  // Cleric halo: a three-row pixel ring over the head at 40% alpha with a slow bob (x, y: centre of the drawn frame's top line).
  function halo(c, x, y, t) {
    const ga = c.globalAlpha, l = Math.round(x / K) * K - 4 * K, top = Math.round(y / K) * K - 3 * K + Math.round(Math.sin(t * 2.2) * 0.8) * K;
    c.globalAlpha = ga * (0.4 + Math.sin(t * 3) * 0.08); c.fillStyle = '#ffe08a';
    c.fillRect(l + 2 * K, top, 4 * K, K); c.fillRect(l + K, top + K, K, K); c.fillRect(l + 6 * K, top + K, K, K); c.fillRect(l + 2 * K, top + 2 * K, 4 * K, K);
    c.globalAlpha = ga;
  }

  // The weapon of a hero. thr: thrust 0..1 (glaive), kick: ranged recoil, u: seconds into the attack animation (9 = idle).
  function heroWeapon(c, p, wd, hx, hy, wa, flip, thr, kick, t, u) {
    const w = wd.w, r = A.anim(wd.anim); if (!r) return;
    const ec = p.stats && p.stats.evo && ED.PATHS[p.stats.evo] ? ED.PATHS[p.stats.evo].color : null;
    const variant = ec ? outlineVar(wd.anim, ec) : '';
    let x = hx, y = hy, ang = wa, extra = 0;
    const look = w.look, out = HELD_OUT[look] || 0; // ranged weapons are held out along the aim
    if (out) { x += Math.cos(wa) * out * K; y += Math.sin(wa) * out * K * 0.6; }
    if (thr > 0 && w.arc < 1) { const d = thr * 6 * K; x += Math.cos(wa) * d; y += Math.sin(wa) * d * 0.5; }
    if (kick > 0.02) { const d = kick * 2 * K; x -= Math.cos(wa) * d; y -= Math.sin(wa) * d * 0.5; }
    if (look === 'lantern') { // held up at the side, hanging from the hand: swings, and is thrown forward on release
      const fl = flip ? -1 : 1, rot = Math.sin(t * 2.6 + (p.slot | 0)) * 0.14 - fl * 0.9 * Math.exp(-u * 10);
      put(c, wd.anim, 0, hx, hy - 16, flip, variant, 1, nrm(rot));
      lightGlow(c, hx, hy - 6, 0.5 + 0.1 * Math.sin(t * 7));
      if (R() && p.x !== undefined) { R().light(p.x + hx, p.y + hy - 6, 64, '#ffe9a0', 0.3); R().emit(p.x + hx, p.y + hy - 6, 16, '#ffe9a0', 0.25); } // the lantern lights its surroundings
      return;
    }
    if (look === 'tome') { // floats open in front of the hand, tilting toward the aim
      const sgn = flip ? -1 : 1, bob = q2(Math.sin(t * 3 + (p.slot | 0)) * 1.2);
      x = hx + Math.cos(wa) * 6 * sgn * sgn; y = hy - 4 + bob + Math.sin(wa) * 3;
      put(c, wd.anim, 0, x, y, flip, variant, 1, nrm(sgn * (0.12 + 0.5 * Math.exp(-u * 12))));
      tipOrb(c, w, x, y - 14, u, 0);
      return;
    }
    if (look === 'staff' || look === 'wand') extra = (Math.cos(wa) < 0 ? 1 : -1) * 0.5 * Math.exp(-u * 16); // the tip flicks up 30 degrees on the cast and settles
    weaponAt(c, wd.anim, x, y, ang, flip, variant, extra);
    if (look === 'staff' || look === 'wand') { const len = (r.ay - r.f[0].oy) * K, ta = wa + extra; tipOrb(c, w, x + Math.cos(ta) * len, y + Math.sin(ta) * len, u, 0); }
    if (look === 'bow' || look === 'crossbow') { // the next arrow is nocked 3 art px back once the string has recovered: hidden for the first 45% of the cycle, drawn back over the rest
      const D = (anim_D || 0.3), pr = U.clamp((u - D * 0.45) / (D * 0.55), 0, 1);
      if (u >= D * 0.45 || u > 5) {
        const back = (u > 5 ? 3 : pr * 3) * K, id = look === 'crossbow' ? 'proj.bolt' : 'proj.arrow';
        weaponAt(c, id, x - Math.cos(wa) * back + Math.cos(wa) * 4 * K, y - Math.sin(wa) * back * 0.6 + Math.sin(wa) * 4 * K * 0.6, wa, flip, '');
      }
    }
    if (ec && !(R() && R().quality === 'low')) Sp.glow(c, x + Math.cos(wa) * 14, y + Math.sin(wa) * 14, 18, ec, 0.38 + Math.sin(t * 5) * 0.08);
  }
  let anim_D = 0.3; // length of the attack animation being drawn (set by drawHero)
  // Element orb at the tip of a magic weapon: gone right after the cast, regrown over the rest of the cycle to 2 art px (u: seconds into the attack animation, 9 = idle).
  function tipOrb(c, w, x, y, u) {
    const k = u > 5 ? 1 : U.clamp((u - anim_D * 0.35) / (anim_D * 0.65), 0, 1); if (k < 0.3) return;
    const col = F().projColor ? F().projColor(w.proj) : '#ffffff', sz = k < 0.75 ? K : 2 * K, px = Math.round(x / K) * K, py = Math.round(y / K) * K, h = sz / 2;
    c.fillStyle = col; c.fillRect(px - h, py - h, sz, sz);
    if (sz > K) { c.fillStyle = '#ffffff'; c.fillRect(px - 1, py - 1, K, K); }
    Sp.glow(c, px, py, 7, col, 0.3 * k);
  }
  // Warm glow of a held lantern.
  function lightGlow(c, x, y, a) { Sp.glow(c, x, y, 16, '#ffe9a0', a); }

  // Off-hand copy of a twin weapon (daggers, crescent scythes, twin bows): on the far shoulder, mirrored swing half a phase behind.
  function twinDraw(c, p, wd, anim, swinging, face, flip, hx, hy, t, behind) {
    const w = wd.w, sg = flip ? -1 : 1;
    let wa = face, thr = 0, kick = 0;
    if (swinging) {
      const base = anim.a !== undefined ? anim.a : face, u = anim.atkT - anim.D * 0.5;
      if (u > 0) { swing(w, anim, base, u, -(anim.side || 1)); wa = SW.wa; thr = SW.thr; kick = SW.kick; }
      else { swing(w, anim, base, 0, -(anim.side || 1)); wa = SW.wa; }
    } else if (w.kind === 'melee') wa = face - 0.5 * sg * (flip ? -1 : 1);
    else wa = face + 0.14 * sg;
    if (!behind) return; // the off-hand copy rides behind the body
    heroWeapon(c, p, wd, hx - 6 * K * sg, hy + 2, wa, flip, thr, kick, t, swinging ? anim.atkT : 9);
  }

  // Lying hero (downed, dead): the hit pose turned 90 degrees away from facing, 2 art px lower, in grey.
  function lying(c, p, hitId, flip, key, cls) {
    const rr = A.anim(hitId), half = Math.abs((rr.anchors.centre ? rr.anchors.centre[1] - rr.ay : -14) * K); // the body's middle ends up over the hero's spot
    c.save(); c.translate(flip ? -half : half, 4); c.rotate(flip ? HP : -HP);
    put(c, hitId, 0, 0, 0, flip, stateVar(hitId, key), 1);
    c.restore();
  }
  // ---------------- portraits ----------------
  // Hero bust for a canvas (HUD medallion, class cards, lobby): the idle frame at a whole number of canvas px per art px (head near the top, feet at the bottom edge) over the class-colour glow, weapon in hand.
  AC.portrait = (canvas, cls, slot, weapon) => {
    const idle = 'hero.' + cls + '.idle', r = A.anim(idle);
    if (!r) return false;
    const c = canvas.getContext('2d'), D = canvas.width, col = ED.CLASSES[cls].col.c;
    c.clearRect(0, 0, D, canvas.height);
    const g = c.createRadialGradient(D / 2, canvas.height * 0.6, 2, D / 2, canvas.height * 0.6, D * 0.55);
    g.addColorStop(0, U.rgba(col, 0.35)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, D, canvas.height);
    const H = canvas.height, h = r.ay - r.f[0].oy, m = Math.max(2, Math.round(H * 0.92 / h)); // canvas px per art px: the standing pose (idle frame 0, feet to head in art px) fills about 92% of the height
    c.save(); c.imageSmoothingEnabled = false;
    c.translate(Math.round(D * 0.44), Math.round(H * 0.04) + m * h); c.scale(m / K, m / K);
    const pseudo = { cls, slot: slot || 0, weapon: weapon || ED.CLASSES[cls].weapons[0] }, wd = Sp.weaponArt(pseudo), hand = r.anchors.hand || [r.ax + 3, r.ay - 6];
    const hx = (hand[0] - r.ax) * K, hy = (hand[1] - r.ay) * K;
    if (wd.w.look !== 'lantern' && wd.w.look !== 'tome') weaponAt(c, wd.anim, hx, hy, -0.75, false, '');
    put(c, idle, 0, 0, 0, false, heroVar(cls, slot || 0, idle), 1);
    if (wd.w.look === 'lantern' || wd.w.look === 'tome') heroWeapon(c, pseudo, wd, hx, hy, -0.4, false, 0, 0, 0, 9);
    c.restore();
    return true;
  };

  // Keeps portrait canvas cv at one canvas px per device px of its CSS box (redraw() repaints it at the new size), so every art pixel lands on whole device pixels.
  AC.fit = (cv, redraw) => {
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver((es) => {
      if (!cv.isConnected) { ro.disconnect(); return; }
      const e = es[es.length - 1], bs = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0], w = bs ? bs.inlineSize : Math.round(e.contentRect.width * (window.devicePixelRatio || 1));
      if (w < 8 || w === cv.width) return;
      cv.width = cv.height = w; redraw();
    });
    try { ro.observe(cv, { box: 'device-pixel-content-box' }); } catch (err) { ro.observe(cv); }
  };

  // ---------------- minions ----------------
  // Risen skeletons (teal skeleton body); Bone Knights (the owner holds the Bone Knights fork) wear the armoured body.
  AC.minion = (c, a, t) => {
    const owner = view ? view.players.get(a.owner) : null, knight = !!(a.knight || (owner && owner.boons && owner.boons.n_s1_b)), base = knight ? 'skelknight' : 'minion';
    const walk = 'foe.' + base + '.walk', idle = 'foe.' + base + '.idle';
    if (!A.has(walk)) return false;
    let s = FS.get(a.id);
    if (!s) { s = { lx: a.x, ly: a.y, lt: t, sp: 0, mv: -9, seen: t }; FS.set(a.id, s); }
    s.seen = t;
    const dt = t - s.lt;
    if (dt > 0.0001) { const v = Math.hypot(a.x - s.lx, a.y - s.ly) / dt; s.sp += (v - s.sp) * Math.min(1, dt * 14); if (v > 12) s.mv = t; s.lx = a.x; s.ly = a.y; s.lt = t; }
    const id = t - s.mv < 0.3 ? walk : (A.has(idle) ? idle : walk), flip = a.face < 0, fi = A.frameAt(id, t + (a.id | 0) * 0.37);
    const ga = c.globalAlpha, m = c.getTransform();
    shadowAt(c, knight ? 13 : 9, 0.3);
    c.globalAlpha = ga * 0.9;
    beginRec(s, m.e, m.f);
    put(c, id, fi, 0, 0, flip, minionVar(id, base), 1);
    REC = null;
    c.globalAlpha = ga;
    Sp.glow(c, 0, -10, 16, ED.ENEMIES.minion.col.c, 0.25);
    if (ED.ClassFx.minion) ED.ClassFx.minion(c, a, t, knight, flip); // Bone Knight gear, Abyssal glow (cls-necro.js)
    return true;
  };

  // ---------------- afterimages and death ghosts ----------------
  // Snapshot of the hero body now (anim, frame, mirror) for a dash afterimage.
  AC.heroSnap = (p) => {
    const s = HS.get(p.pid); if (!s || !s.an) return null;
    return { id: s.an, i: s.fi, flip: Math.cos(p.face || 0) < 0 };
  };
  // Silhouette of a snapshot in the player colour at alpha a (flat colour, source-over).
  AC.drawDash = (c, g, a) => {
    const sv = silVar(g.slot | 0, g.at.id);
    put(c, g.at.id, g.at.i, 0, 0, g.at.flip, sv, a);
  };
  // Snapshot of the dying foe of this type at (x, y): anim, frame, mirror, lift, recolour. The world has already removed the foe, so its own last drawn state is the nearest drawn foe of its type
  // at the spot; e (the nearest living foe of any type) is only used when it has the same type.
  AC.foeSnap = (type, e, x, y) => {
    let s = null;
    if (x !== undefined) {
      let bd = 900;
      for (const q of FS.values()) { if (q.type !== type || !q.an || nowT - q.seen > 0.5) continue; const d = (q.lx - x) * (q.lx - x) + (q.ly - y) * (q.ly - y); if (d < bd) { bd = d; s = q; } }
    }
    if (!s && e && e.type === type) s = FS.get(e.id) || null;
    const boss = !!ED.ENEMIES[type].boss, info = foeInfo(type), flip = s ? s.flip : false, lift = s ? s.lift || 0 : 0;
    if (boss) { // the boss death animation in the boss gradient map, else its last drawn frame
      const bd = 'boss.' + type + '.death';
      if (A.has(bd)) return { id: bd, i: 0, flip, lift, type, boss, death: true, dur: A.anim(bd).n / A.anim(bd).fps + 0.12 };
      return s && s.an ? { id: s.an, i: s.fi, flip, lift, type, boss } : null;
    }
    if (info.death) return { id: info.death, i: 0, flip, lift, type, death: true, dur: 0.36 }; // slimes play their splat
    if (s && s.an) return { id: s.an, i: s.fi, flip, lift, type };
    if (!info.k) return null;
    const id = info.k === 2 ? info.idle : info.k === 4 ? info.walk.d : info.walk[0];
    return A.has(id) ? { id, i: 0, flip: false, lift: info.fly ? 14 : 0, type } : null;
  };
  // Draws a death snapshot: white silhouette while white, else its recoloured sheet.
  AC.drawSnap = (c, sn, white, a, u) => {
    const i = sn.death ? Math.min(A.anim(sn.id).n - 1, Math.floor((u || 0) * A.anim(sn.id).fps)) : sn.i;
    put(c, sn.id, i, 0, -sn.lift, sn.flip, white ? stateVar(sn.id, 'white') : sn.boss ? bossVar(sn.type, sn.id) : foeVar(sn.type, sn.id), a === undefined ? 1 : a);
  };

  // Seconds since the hero's last hurt event (FX clock; 99 when never).
  function hurtAge(pid) { const f = F(), h = f.hurtAt; return h && h[pid] !== undefined ? f.time - h[pid] : 99; }
})(globalThis.ED || (globalThis.ED = {}));
