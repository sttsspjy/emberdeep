// Picks anim / frame / flip / pose for heroes, foes, bosses and pickups and draws them through ED.Batch (client only).
// Facing: two-way art flips by e.face, four-way picks walk.d/u/l/r with hysteresis, eight-way walk.0-7 (0 S, 1 SE, 2 E ... 6 W, 7 SW); the angle is the heading while moving, else toward the nearest hero.
// Per-entity client state (last position, heading, state change time, held frame, last pose for death pops) lives in a pooled map keyed by entity id; FX.update sweeps it once a second.
// Outlines and recolours: Canvas2D draws Atlas variant sheets through B.ctx; other Batch backends get four tinted white copies (outline) or o.tint (recolour).
(function (ED) {
  'use strict';
  const U = ED.U, PI = Math.PI, TAU = U.TAU;
  const Ac = ED.Actors = {};
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const reset = () => { O.flip = false; O.flash = 0; O.alpha = 1; O.rot = 0; O.sx = 1; O.sy = 1; O.tint = 0; O.add = false; return O; };
  const WIND_T = 0.6; // nominal telegraph length (s): lean grows over it, the shiver starts at 60%
  const FLASH_T = 0.06; // sim hit flash length (s)
  const RED = '#ff3a2a', GOLD = '#ffc94a', ICE = '#9fdcff';
  const hexN = (h) => parseInt(h.slice(1), 16);
  let now = 0; // real seconds (FX clock)

  // ---------------- per-entity state ----------------
  const ST = new Map(), FREE = [];
  // State of entity id at (x, y): kind tag k (1 foe, 2 boss, 3 pickup); movement is detected from position deltas (> 0.4 px), so clients and hosts behave alike.
  function stOf(id, x, y, k) {
    let s = ST.get(id);
    if (s && s.k !== k) { ST.delete(id); FREE.push(s); s = null; }
    if (!s) {
      s = FREE.pop() || {};
      s.k = k; s.lx = x; s.ly = y; s.hd = 0; s.mv = -9; s.st = 0; s.ss = now; s.hold = -1; s.d4 = 'd'; s.atk = 0; s.hitAt = -9; s.hitNext = 0; s.spk = 0;
      s.an = ''; s.fi = 0; s.flip = false; s.sx = 1; s.sy = 1; s.ox = 0; s.oy = 0; s.h = 16;
      ST.set(id, s);
    }
    s.seen = now;
    const dx = x - s.lx, dy = y - s.ly;
    if (dx * dx + dy * dy > 0.16) { s.hd = Math.atan2(dy, dx); s.mv = now; s.lx = x; s.ly = y; s.spd = Math.sqrt(dx * dx + dy * dy); }
    return s;
  }
  Ac.clock = (t) => { now = t; };
  Ac.sweep = () => { for (const [id, s] of ST) if (now - s.seen > 1.5) { ST.delete(id); FREE.push(s); } };
  Ac.clear = () => { for (const s of ST.values()) FREE.push(s); ST.clear(); HS.clear(); };
  // Last drawn pose of entity id ({ an, fi, flip, sx, sy, ox, oy, h }) or null (FX death pops).
  Ac.pose = (id) => { const s = ST.get(id); return s && s.an && now - s.seen < 0.25 ? s : null; };
  Ac.size = () => ST.size;

  // ---------------- variant drawing ----------------
  const VO = { flip: false, alpha: 1, rot: 0, variant: '' }, O2 = { flip: false, flash: 1, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const has2d = (B) => B.mode === '2d' && B.ctx;
  // Sprite drawn from Atlas variant `key` ('outline:#rrggbb', 'frozen', 'white') on Canvas2D. Returns false when it could not.
  function varDraw(B, id, fi, x, y, o, key, alpha) {
    const A = ED.Atlas;
    if (!has2d(B) || !A.variant(id, key)) return false;
    const c = B.ctx; VO.flip = o.flip; VO.alpha = alpha; VO.rot = 0; VO.variant = key;
    if (o.sx !== 1 || o.sy !== 1) { c.save(); c.translate(x, y); c.scale(o.sx, o.sy); A.draw(c, id, fi, 0, 0, VO); c.restore(); }
    else A.draw(c, id, fi, x, y, VO);
    B.stats.spr++;
    return true;
  }
  // Coloured 1 px outline under a sprite: the outline variant on Canvas2D, else four tinted white copies offset by one scaled px.
  function outline(B, id, fi, x, y, o, hex, alpha) {
    if (alpha <= 0.02) return;
    if (varDraw(B, id, fi, x, y, o, 'outline:' + hex, alpha)) return;
    if (B.crowd > 250) return;
    O2.flip = o.flip; O2.sx = o.sx; O2.sy = o.sy; O2.alpha = alpha; O2.tint = hexN(hex);
    const dx = Math.max(1, Math.round(o.sx)), dy = Math.max(1, Math.round(o.sy));
    B.spr(id, fi, x - dx, y, O2); B.spr(id, fi, x + dx, y, O2); B.spr(id, fi, x, y - dy, O2); B.spr(id, fi, x, y + dy, O2);
  }
  Ac.outline = outline;

  // ---------------- foe anim tables ----------------
  // Per foe def: { k: 2|4|8|0, walk, idle, atk, cast, howl, death, h (sprite height), col (death-burst colour 0xRRGGBB00) }.
  const info = new Map();
  function palCol(id) {
    const pal = ED.ART && ED.ART.pal && ED.ART.pal[id];
    if (!pal || !pal.length) return 0xd8c8b000;
    const L = pal.filter((h) => h !== '#222222'), h = L[Math.min(L.length - 1, Math.floor(L.length * 0.6))] || '#d8c8b0';
    return (hexN(h) << 8) >>> 0;
  }
  const foeInfo = (def) => {
    let f = info.get(def.id);
    if (f && (f.k || !ED.Atlas.ok)) return f;
    const A = ED.Atlas, p = def.look + '.';
    f = { k: 0, walk: null, idle: null, atk: null, cast: null, howl: null, death: null, h: 14, col: 0xd8c8b000, flyer: false };
    if (A.has(p + 'walk') || A.has(p + 'idle')) {
      f.k = 2; f.walk = A.has(p + 'walk') ? p + 'walk' : p + 'idle'; f.idle = A.has(p + 'idle') ? p + 'idle' : f.walk;
      f.atk = A.has(p + 'attack') ? p + 'attack' : null;
    } else if (A.has(p + 'walk.d')) {
      f.k = 4; f.walk = { d: p + 'walk.d', u: p + 'walk.u', l: p + 'walk.l', r: p + 'walk.r' };
      if (A.has(p + 'cast.d')) f.cast = { d: p + 'cast.d', u: p + 'cast.u', l: p + 'cast.l', r: p + 'cast.r' };
    } else if (A.has(p + 'walk.0')) {
      f.k = 8; f.walk = []; f.atk = []; f.howl = [];
      for (let i = 0; i < 8; i++) { f.walk.push(p + 'walk.' + i); f.atk.push(A.has(p + 'atk.' + i) ? p + 'atk.' + i : null); f.howl.push(A.has(p + 'howl.' + i) ? p + 'howl.' + i : null); }
    }
    if (f.k) {
      const id0 = f.k === 2 ? f.walk : f.k === 4 ? f.walk.d : f.walk[0], r = A.anim(id0);
      if (r) f.h = Math.max(6, r.ay - (typeof r.anchors.top === 'number' ? r.anchors.top : 0));
      f.col = palCol(id0);
      f.death = A.has(p + 'death') ? p + 'death' : null;
      f.flyer = def.ai === 'swarm' && f.k === 4;
    }
    info.set(def.id, f);
    return f;
  };
  Ac.foeInfo = foeInfo;
  const oct8 = (a) => (((2 - Math.round(a / (PI / 4))) % 8) + 8) % 8;
  // Four-way letter with hysteresis: the held axis stays until the other leads by 20%.
  function dir4(s, a) {
    const c = Math.cos(a), n = Math.sin(a), ax = Math.abs(c), ay = Math.abs(n), horiz = s.d4 === 'l' || s.d4 === 'r';
    if (horiz ? ay > ax * 1.2 : ax > ay * 1.2) s.d4 = horiz ? (n > 0 ? 'd' : 'u') : (c > 0 ? 'r' : 'l');
    else if (horiz) s.d4 = c > 0 ? 'r' : 'l'; else s.d4 = n > 0 ? 'd' : 'u';
    return s.d4;
  }
  const nearAng = (e, heroes) => {
    let best = null, bd = Infinity;
    for (let i = 0; i < heroes.length; i++) { const p = heroes[i]; if (p.dead || p.downed) continue; const d = (p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y); if (d < bd) { bd = d; best = p; } }
    return best ? Math.atan2(best.y - e.y, best.x - e.x) : (e.face < 0 ? PI : 0);
  };
  const q1 = (v) => Math.round(v);

  // ---------------- foes ----------------
  // Foe e (feet at e.x, e.y): facing by def.dirs, walk / idle by movement, wind-up (st 1) lean + crouch + shiver + red outline + '!' mark, act (st 2) lunge,
  // hit recoil (away from the nearest hero) and squash for the 60 ms flash, elites: gold outline + pulsing glow, frozen: ice recolour, flyers bob.
  Ac.foe = (B, e, t, heroes) => {
    const def = e.def || ED.FOES[ED.FOE_IDS[e.k]];
    if (!def) return;
    if (def.boss) { Ac.boss(B, e, t, def, heroes); return; }
    const f = foeInfo(def), A = ED.Atlas, o = reset(), s = stOf(e.id, e.x, e.y, 1), ph = (e.id % 97) * 0.618, lite = B.crowd > 250;
    if (e.st !== s.st) { s.st = e.st; s.ss = now; s.hold = -1; }
    const moving = now - s.mv < 0.2, wind = e.st === 1, act = e.st === 2, held = e.freezeT > 0 || e.stunT > 0;
    const tgtA = nearAng(e, heroes), faceA = moving && !wind && !act ? s.hd : tgtA, el = now - s.ss;
    const base = e.scale || (e.elite ? 2 : 1);
    o.sx = o.sy = base;
    let id = null, fi = 0;
    if (f.k === 2) {
      o.flip = wind || act ? Math.cos(tgtA) < 0 : e.face < 0;
      id = act && f.atk ? f.atk : moving || wind || act ? f.walk : f.idle;
      fi = act && f.atk ? Math.min(A.anim(id).n - 1, Math.floor(el * A.anim(id).fps)) : A.frameAt(id, t + ph);
    } else if (f.k === 4) {
      const d = dir4(s, faceA);
      id = (wind || act) && f.cast ? f.cast[d] : f.walk[d];
      fi = A.frameAt(id, (t + ph) * (moving ? 1 : 0.45));
    } else if (f.k === 8) {
      const oc = oct8(faceA);
      if (act && f.atk[oc]) { id = f.atk[oc]; fi = Math.min(A.anim(id).n - 1, Math.floor(el * A.anim(id).fps)); }
      else if (wind && f.howl[oc]) { id = f.howl[oc]; fi = 0; }
      else { id = f.walk[oc]; fi = A.frameAt(id, (t + ph) * (moving ? 1 : 0.45)); }
    }
    // held frames: a wind-up or a frozen / stunned foe keeps the frame it had
    if (id && (wind || held)) { if (s.hold < 0 || s.an !== id) s.hold = fi; fi = s.hold; } else s.hold = -1;
    let ox = 0, oy = 0, wk = 0;
    if (wind && !held) {
      wk = U.clamp(el / WIND_T, 0, 1);
      const c = Math.cos(tgtA), n = Math.sin(tgtA);
      ox -= q1(c * 2 * wk); oy -= q1(n * wk);
      o.sx *= 1 + 0.08 * wk; o.sy *= 1 - 0.1 * wk; // crouch
      if (wk > 0.6 && Math.floor(now / 0.05) % 2) ox += base; // shiver
    } else if (act) {
      const k = U.clamp(el / 0.12, 0, 1);
      ox += q1(Math.cos(tgtA) * 3 * k); oy += q1(Math.sin(tgtA) * 2 * k);
      o.sx *= 0.94; o.sy *= 1.08; // stretch into the strike
    }
    if (e.flash > 0) {
      const k = U.clamp(e.flash / FLASH_T, 0, 1);
      o.flash = 1;
      if (def.kb > 0) { ox -= q1(Math.cos(tgtA) * 2 * k * base); oy -= q1(Math.sin(tgtA) * k * base); o.sx *= 1 + 0.2 * k; o.sy *= 1 - 0.16 * k; }
      else { o.sx *= 1 + 0.08 * k; o.sy *= 1 - 0.06 * k; }
    }
    if (f.flyer) oy -= 2 + q1(Math.sin(t * 5 + e.id) * 1.5);
    else if (moving && id && A.anim(id).n === 2 && Math.floor((t + ph) * 4) % 2) oy -= 1; // two-frame walkers hop
    const x = e.x + ox, y = e.y + oy, h = f.h * base;
    // under the body: shadow, elite glow
    B.shadow(e.x, e.y, e.r * (f.flyer ? 0.7 : 0.9));
    if (e.elite) {
      const pu = 0.5 + 0.5 * Math.sin(t * 5 + e.id);
      B.circ(e.x, e.y - h * 0.45, h * 0.62 + pu * 3, (0xffc94a00 | Math.round(26 + 22 * pu)) >>> 0, 0);
      B.circ(e.x, e.y, e.r + 3 + pu * 2, (0xffc94a00 | Math.round(110 + 80 * pu)) >>> 0, 1.5);
    }
    if (!id) { B.circ(e.x, e.y - e.r, e.r, e.flash > 0 ? 0xffffffff : 0xc05050ff, 0); return; }
    // outlines (under the body)
    if (!e.flash || e.flash <= 0) {
      if (wk > 0) outline(B, id, fi, x, y, o, RED, 0.4 + 0.6 * wk);
      else if (e.elite) outline(B, id, fi, x, y, o, GOLD, 0.7 + 0.3 * Math.sin(t * 6 + e.id));
    }
    let drawn = false;
    if (e.freezeT > 0 && !(e.flash > 0)) { drawn = varDraw(B, id, fi, x, y, o, 'frozen', 1); if (!drawn) o.tint = hexN(ICE); }
    if (!drawn && !B.spr(id, fi, x, y, o)) B.circ(e.x, e.y - e.r, e.r, e.flash > 0 ? 0xffffffff : 0xc05050ff, 0);
    if (wk > 0.25 && !lite) B.text('!', e.x, y - h - 5, Math.floor(now * 10) % 2 ? 0xff4a3a : 0xffd84a, base > 1 ? 2 : 1);
    if (e.stunT > 0 && !lite) { const sa = t * 6; B.rect(q1(e.x + Math.cos(sa) * 6) - 1, q1(y - h - 3 + Math.sin(sa) * 2) - 1, 2, 2, 0xffe66bff); B.rect(q1(e.x - Math.cos(sa) * 6) - 1, q1(y - h - 3 - Math.sin(sa) * 2) - 1, 2, 2, 0xffe66bff); }
    s.an = id; s.fi = fi; s.flip = o.flip; s.sx = base; s.sy = base; s.ox = ox; s.oy = oy; s.h = h;
  };

  // ---------------- bosses ----------------
  // Per boss look: idle, walk, attack list (attack, attack1-3), wind (own wind-up anim), hit (+ frame skipped), death, front (never flips), crown overlay, h.
  const BOSS_OPT = { 'boss.sporemother': { front: true }, 'boss.hollowking': { crown: 'boss.hollowking.crown' } };
  const binfo = new Map();
  const bossInfo = (def) => {
    let b = binfo.get(def.id);
    if (b && (b.ok || !ED.Atlas.ok)) return b;
    const A = ED.Atlas, p = def.look + '.', opt = BOSS_OPT[def.look] || {};
    b = { ok: false, idle: null, walk: null, atk: [], wind: null, hit: null, death: null, front: !!opt.front, crown: opt.crown && A.has(opt.crown) ? opt.crown : null, h: 40, col: 0xffd27a00 };
    b.idle = A.has(p + 'idle') ? p + 'idle' : A.has(p + 'walk') ? p + 'walk' : null;
    b.walk = A.has(p + 'walk') ? p + 'walk' : b.idle;
    for (const k of ['attack', 'attack1', 'attack2', 'attack3']) if (A.has(p + k)) b.atk.push(p + k);
    b.wind = A.has(p + 'charge') ? p + 'charge' : null;
    b.hit = A.has(p + 'hit') ? p + 'hit' : null;
    b.death = A.has(p + 'death') ? p + 'death' : null;
    if (b.idle) {
      b.ok = true;
      const r = A.anim(b.idle);
      b.h = Math.max(16, r.ay - (typeof r.anchors.top === 'number' ? r.anchors.top : 0));
      b.col = palCol(b.idle);
    }
    binfo.set(def.id, b);
    return b;
  };
  Ac.bossInfo = bossInfo;
  // Boss: walk / idle by movement; wind-up (st 1): own wind anim or the first half of the attack held in step with the telegraph, lean back, shiver, red outline;
  // act (st 2): the rest of the attack once; heavy-hit pose at most every 1.2 s; enraged: pulsing red outline + red tint; a crown overlay rides anchors.crown.
  Ac.boss = (B, e, t, def, heroes) => {
    const bf = ED.BossFx[def.id];
    if (bf && bf.draw && bf.draw(B, e, t)) return;
    const A = ED.Atlas, o = reset(), b = bossInfo(def), s = stOf(e.id, e.x, e.y, 2), sc = e.scale || 1;
    if (e.st !== s.st) { if (e.st === 1 || (e.st === 2 && s.st === 0)) s.atk++; s.st = e.st; s.ss = now; }
    const el = now - s.ss, moving = now - s.mv < 0.25, tgtA = heroes ? nearAng(e, heroes) : 0;
    o.sx = o.sy = sc; o.flip = !b.front && (e.st ? Math.cos(tgtA) < 0 : e.face < 0);
    B.shadow(e.x, e.y, e.r * 1.1);
    if (!b.ok) { // no art: a labelled placeholder
      B.circ(e.x, e.y - e.r, e.r, e.flash > 0 ? 0xffffffff : 0x7a3a8cff, 0);
      B.circ(e.x, e.y - e.r, e.r, e.st === 1 ? 0xff3a2aff : 0xffd27aff, 2);
      B.text(def.name, e.x, e.y - e.r * 2 - 6, 0xffd27a, 1);
      return;
    }
    if (e.flash > 0 && e.st === 0 && b.hit && now >= s.hitNext) { s.hitAt = now; s.hitNext = now + 1.2; }
    const atk = b.atk.length ? b.atk[s.atk % b.atk.length] : null;
    let id, fi = 0, ox = 0, wk = 0;
    if (e.st === 1) {
      wk = U.clamp(el / WIND_T, 0, 1);
      if (b.wind) { id = b.wind; const n = A.anim(id).n; fi = Math.min(n - 1, Math.floor(wk * n)); }
      else if (atk) { id = atk; const half = Math.max(1, Math.floor(A.anim(id).n / 2)); fi = Math.min(half - 1, Math.floor(wk * half)); }
      else { id = b.idle; fi = s.hold >= 0 ? s.hold : (s.hold = A.frameAt(id, t)); }
      ox -= q1(Math.cos(tgtA) * 3 * wk);
      if (wk > 0.6 && Math.floor(now / 0.05) % 2) ox += 2;
    } else if (e.st === 2 && atk) {
      id = atk; s.hold = -1;
      const r = A.anim(id), start = b.wind ? 0 : Math.max(1, Math.floor(r.n / 2));
      fi = Math.min(r.n - 1, start + Math.floor(el * r.fps));
    } else if (b.hit && now - s.hitAt < A.anim(b.hit).n / A.anim(b.hit).fps) {
      id = b.hit; s.hold = -1; fi = Math.min(A.anim(id).n - 1, Math.floor((now - s.hitAt) * A.anim(id).fps));
    } else { id = moving ? b.walk : b.idle; s.hold = -1; fi = A.frameAt(id, t); }
    if (e.flash > 0) o.flash = 0.45;
    if (e.enraged) o.tint = 0xff7060;
    const x = e.x + ox, y = e.y;
    if (wk > 0) outline(B, id, fi, x, y, o, RED, 0.35 + 0.65 * wk);
    else if (e.enraged) outline(B, id, fi, x, y, o, RED, 0.55 + 0.45 * Math.sin(t * 10));
    B.spr(id, fi, x, y, o);
    if (b.crown) {
      const r = A.anim(id), cr = r.anchors.crown, q = cr ? cr[Math.min(fi, cr.length - 1)] : null;
      if (q) { const cx = (q[0] - r.ax) * sc * (o.flip ? -1 : 1), cy = (q[1] - r.ay) * sc; B.spr(b.crown, 0, x + cx, y + cy, reset2(o.flip, sc, o.flash)); }
    }
    s.an = id; s.fi = fi; s.flip = o.flip; s.sx = sc; s.sy = sc; s.ox = ox; s.oy = 0; s.h = b.h * sc;
  };
  const O3 = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const reset2 = (flip, sc, fl) => { O3.flip = flip; O3.sx = O3.sy = sc; O3.flash = fl; O3.alpha = 1; O3.rot = 0; O3.tint = 0; O3.add = false; return O3; };

  // ---------------- heroes ----------------
  // Per-hero state by pid: swing (start, angle, arc), shot recoil, dash afterimages (ring of 6).
  const HS = new Map();
  const heroSt = (pid) => {
    let h = HS.get(pid);
    if (!h) { h = { swT: -9, swA: 0, swArc: 0, shT: -9, gi: 0, gT: -9, ghosts: [] }; for (let i = 0; i < 6; i++) h.ghosts.push({ x: 0, y: 0, id: '', fi: 0, flip: false, t: -9 }); HS.set(pid, h); }
    return h;
  };
  // Sim events the hero poses follow (called by FX.handle).
  Ac.event = (ev) => {
    if (ev.t === 'swing' && ev.pid) { const h = heroSt(ev.pid); h.swT = now; h.swA = ev.a; h.swArc = Math.min(ev.arc || 1.6, 2.6); }
    else if (ev.t === 'shoot' && ev.pid) { const w = ED.WEAPONS[ev.wid]; if (w && w.look) heroSt(ev.pid).shT = now; }
  };
  // Held weapon of a hero: its first weapon's icon when that is a weapon sprite, else the hero's signature icon.
  const wcache = new Map();
  function heldOf(p) {
    const ws = p.weapons && p.weapons[0], wid = ws ? ws.id : (ED.HEROES[p.cls] && ED.HEROES[p.cls].sig);
    let w = wcache.get(wid);
    if (w !== undefined) return w;
    const def = ED.WEAPONS[wid], A = ED.Atlas;
    w = null;
    if (def && def.icon && def.icon.startsWith('weapon.') && A.has(def.icon)) {
      const r = A.anim(def.icon), dir = typeof r.anchors.dir === 'number' ? r.anchors.dir : 0;
      w = { id: def.icon, src: (dir - 90) * PI / 180, ranged: !!def.look };
    }
    if (w || A.ok) wcache.set(wid, w);
    return w;
  }
  const WO = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  function drawWeapon(B, p, h, w, bodyId, flip, t) {
    const A = ED.Atlas, r = A.anim(bodyId); if (!r) return;
    const hand = r.anchors.hand || [r.ax + 3, r.ay - 6], hx = p.x + (hand[0] - r.ax) * (flip ? -1 : 1), hy = p.y + (hand[1] - r.ay);
    let a = p.face, ext = 0;
    const sw = now - h.swT;
    if (sw < 0.18) { const k = U.easeOut(sw / 0.18), side = Math.cos(h.swA) < 0 ? -1 : 1; a = h.swA + side * (-h.swArc / 2 + h.swArc * k); ext = 3 * Math.sin(k * PI); }
    else if (!w.ranged) a = p.face + (flip ? 1 : -1) * 0.75; // melee rests raised toward the aim
    const rk = now - h.shT < 0.09 ? -2 * (1 - (now - h.shT) / 0.09) : 0;
    WO.flip = flip; WO.rot = a - (flip ? PI - w.src : w.src); WO.alpha = p.downed ? 0 : 1;
    if (WO.alpha) B.spr(w.id, 0, hx + Math.cos(a) * (ext + rk), hy + Math.sin(a) * (ext + rk), WO);
  }
  // Hero p (feet at p.x, p.y): idle / run / hit by state, faces its aim, weapon in hand (swing on 'swing', recoil on ranged 'shoot'), dash afterimages,
  // blinks while invulnerable, white flash on a hit, downed: lies down with a pulsing bleed-out ring and a revive progress ring.
  Ac.hero = (B, p, t) => {
    const cls = ED.HEROES[p.cls] ? p.cls : 'knight', A = ED.Atlas, h = heroSt(p.pid);
    let id = 'hero.' + cls + (p.hurtT > 0 ? '.hit' : p.moving ? '.run' : '.idle');
    if (!A.has(id)) id = 'hero.' + cls + '.idle';
    const o = reset(), flip = Math.cos(p.face) < 0, fi = A.frameAt(id, t + p.slot * 0.31);
    o.flip = flip;
    // dash afterimages
    if (p.dashT > 0 && now - h.gT > 0.03) { const g = h.ghosts[h.gi]; h.gi = (h.gi + 1) % h.ghosts.length; g.x = p.x; g.y = p.y; g.id = id; g.fi = fi; g.flip = flip; g.t = now; h.gT = now; }
    for (const g of h.ghosts) {
      const k = 1 - (now - g.t) / 0.25; if (k <= 0) continue;
      O2.flip = g.flip; O2.sx = O2.sy = 1; O2.alpha = 0.45 * k; O2.tint = hexN((ED.HEROES[cls] && ED.HEROES[cls].col) || '#ffffff');
      B.spr(g.id, g.fi, g.x, g.y, O2);
    }
    if (p.downed) {
      const pu = 0.5 + 0.5 * Math.sin(t * 8), bl = U.clamp((p.bleed || 0) / 20, 0, 1);
      B.circ(p.x, p.y - 4, 16 + pu * 2, (0xff3a2a00 | Math.round(90 + 100 * pu * (1.2 - bl))) >>> 0, 1.5);
      const n = 16, lit = Math.round((p.revive || 0) * n);
      for (let i = 0; i < n; i++) { const a = -PI / 2 + i / n * TAU; B.rect(q1(p.x + Math.cos(a) * 20) - 1, q1(p.y - 4 + Math.sin(a) * 12) - 1, 2, 2, i < lit ? 0x7fe39aff : 0x00000088); }
      o.rot = flip ? PI / 2 : -PI / 2; o.alpha = 0.75; o.tint = 0xb0a0a0;
      B.shadow(p.x, p.y, 9);
      if (!B.spr(id, fi, p.x, p.y - 3, o)) B.circ(p.x, p.y - 4, 7, 0xa89880ff, 0);
      return;
    }
    if (p.invuln > 0 && p.hurtT <= 0 && Math.floor(t * 18) % 2) o.alpha = 0.45;
    if (p.dashT > 0) o.alpha = 0.7;
    if (p.hurtT > 0.12) o.flash = 1;
    if (p.moving) { const bob = Math.sin((t + p.slot) * 14); o.sy = 1 + 0.04 * bob; o.sx = 1 - 0.03 * bob; }
    B.shadow(p.x, p.y, 7);
    const w = heldOf(p), behind = w && Math.sin(p.face) < -0.35 && now - h.swT > 0.18;
    if (w && behind) drawWeapon(B, p, h, w, id, flip, t);
    if (!B.spr(id, fi, p.x, p.y, o)) B.circ(p.x, p.y - 8, 8, 0xe8d8b8ff, 0);
    if (w && !behind) drawWeapon(B, p, h, w, id, flip, t);
  };

  // ---------------- props ----------------
  // Obstacle: a stone disc in the stage wall colour with its prop sprite on top (look '' = a plain rock).
  Ac.obstacle = (B, o, wall) => {
    B.circ(o.x, o.y + 2, o.r + 1, 0x00000066, 0);
    B.circ(o.x, o.y, o.r, wall, 0);
    B.circ(o.x, o.y, o.r, 0x00000088, 1);
    if (o.look) B.spr(o.look, 0, o.x, o.y + Math.min(6, o.r * 0.4), reset());
  };
  // Brazier: animated torch with a warm flicker glow; nothing once broken.
  Ac.brazier = (B, b, t) => {
    if (b.broken) return;
    const fl = 0.5 + 0.5 * Math.sin(t * 9 + b.id) * Math.sin(t * 5.3 + b.id * 2);
    B.circ(b.x, b.y - 8, 10 + fl * 3, (0xff9a3a00 | Math.round(20 + 18 * fl)) >>> 0, 0);
    B.shadow(b.x, b.y, 6);
    const A = ED.Atlas;
    if (!B.spr(b.look, A.frameAt(b.look, t + b.id * 0.37), b.x, b.y, reset())) B.circ(b.x, b.y - 6, 5, 0xff9a3aff, 0);
  };

  // ---------------- pickups ----------------
  // Gems (larger tiers scaled up), coins, food, magnet, bomb, chest; a gentle bob and a periodic glint; vacuumed gems leave sparkles (FX.trail); chests pulse with a gold glow.
  const PK = { xp1: ['pickup.xp', 1], xp5: ['pickup.xp', 1.5], xp25: ['pickup.xp', 2.2], gold: ['pickup.coin', 1], food: ['pickup.heart', 1.5], magnet: ['pickup.flask.yellow', 1.4], bomb: ['pickup.flask.red', 1.4], chest: ['prop.chest.closed', 1.2] };
  const PKCOL = { xp1: 0x6ad7ffff, xp5: 0x8aff9aff, xp25: 0xff7ad9ff, gold: 0xffd24aff, food: 0xff5a5aff, magnet: 0xffe14aff, bomb: 0xffffffff, chest: 0xc89a4aff };
  Ac.pickup = (B, g, t) => {
    const d = PK[g.k] || PK.xp1, o = reset(), chest = g.k === 'chest', gem = g.k === 'xp1' || g.k === 'xp5' || g.k === 'xp25';
    const s = stOf(g.id, g.x, g.y, 3), pulled = now - s.mv < 0.1 && s.spd > 1.2;
    const bob = chest || pulled ? 0 : Math.round(Math.sin(t * 4 + g.id) * 1.5);
    o.sx = o.sy = d[1];
    if (g.k === 'xp5') o.tint = 0x8aff9a; else if (g.k === 'xp25') o.tint = 0xff7ad9;
    if (chest) {
      const pu = 0.5 + 0.5 * Math.sin(t * 4);
      B.circ(g.x, g.y - 6, 14 + pu * 4, (0xffd27a00 | Math.round(30 + 30 * pu)) >>> 0, 0);
      if (Math.floor(t * 2.5) % 3 === 0) o.flash = 0.35;
    } else if (gem && ((t * 0.45 + g.id * 0.137) % 1) < 0.05) o.flash = 0.6;
    if (pulled && gem && ED.FX.trail && now - s.spk > 0.045) { s.spk = now; ED.FX.trail(g.x, g.y - 3, PKCOL[g.k] & 0xffffff00); }
    if (!B.spr(d[0], ED.Atlas.frameAt(d[0], t), g.x, g.y + bob, o)) B.circ(g.x, g.y - 3 + bob, 2 * d[1], PKCOL[g.k] || 0xffffffff, 0);
  };
})(globalThis.ED || (globalThis.ED = {}));
