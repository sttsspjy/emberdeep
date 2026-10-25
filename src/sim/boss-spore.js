// II. The Sporemother: arena control. Rooted where she rises, she spreads a spore carpet over the floor tiles (slows, ticks while a hero stands on it); spore pods at the room's edges spread their own patches.
// Destroying a pod clears the carpet around it; her slam (the answer to heroes in melee) blasts the carpet off the ground around her. Phase 2: buds drift from her to destroyed pods and regrow them (kill them on the way).
// Phase 3: she uproots and walks after the heroes, leaving carpet behind her; the spreading stops. No volley.
(function (ED) {
  'use strict';
  const U = ED.U, B = ED.Bosses, L = B.lib, T = ED.CONST.TILE;
  const { line, tele, ring, mv } = L;
  const SM = B.SPORE = {
    spread: { t: 1.4, reach: 7, pod: 3 }, // s per growth step; her reach and a pod's (tiles): one ring of carpet per step within it
    dps: 0.25, tick: 1.0, // carpet damage per second x boss damage, applied every `tick` s to a hero standing on carpet
    clear: 4, // tiles of carpet a destroyed pod clears around itself
    pods: { n: 4, first: 0.8, regrow: 9, spawn: 1.0 }, // live pods at most; s to the first pods; phase 1: s between regrowths; spawn telegraph
    buds: { gap: 9, n: 1, spawn: 0.6, reach: 14 }, // phase 2: s between launches, buds per launch, spawn telegraph, arrival distance (px)
    lash: { len: 460, w: 28, wind: 0.9, mul: 0.8, fan: 0.3 }, // one line per hero (a fan of three from phase 2)
    slam: { r: 130, wind: 1.0, mul: 1.3, near: 160, calm: 4 }, // only when a hero stands within `near`; clears the carpet in its radius, and the carpet stops spreading for `calm` s
    burst: { n: 10, n2: 14, waves: 3, speed: 118, gap: 0.5, mul: 0.8 },
    chase: 0.9, paint: 1, // phase 3: walking speed x spd; carpet painted within `paint` tiles of her
  };

  // ---- carpet grid ----
  const idx = (room, x, y) => Math.floor(y / T) * room.w + Math.floor(x / T);
  const floorAt = (room, i) => { const t = (room.baseTiles || room.tiles)[i]; return t === 0 || t === 4; };
  // Clears every carpet tile whose centre lies within r px of (x, y).
  function clearAt(room, c, x, y, r) {
    const x0 = Math.max(0, Math.floor((x - r) / T)), x1 = Math.min(room.w - 1, Math.floor((x + r) / T)), y0 = Math.max(0, Math.floor((y - r) / T)), y1 = Math.min(room.h - 1, Math.floor((y + r) / T));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (((tx + 0.5) * T - x) ** 2 + ((ty + 0.5) * T - y) ** 2 <= r * r) c[ty * room.w + tx] = 0;
  }
  // One growth step: every floor tile within a source's reach that touches carpet (or holds the source) turns to carpet. Sources: { x, y, r } (px centre, reach in tiles).
  function grow(room, c, srcs) {
    const W = room.w, H = room.h, add = [];
    for (let ty = 1; ty < H - 1; ty++) for (let tx = 1; tx < W - 1; tx++) {
      const i = ty * W + tx;
      if (c[i] || !floorAt(room, i)) continue;
      let ok = false;
      for (const s of srcs) {
        const sx = Math.floor(s.x / T), sy = Math.floor(s.y / T), d2 = (tx - sx) ** 2 + (ty - sy) ** 2;
        if (d2 > s.r * s.r) continue;
        if (d2 === 0 || c[i - 1] || c[i + 1] || c[i - W] || c[i + W]) { ok = true; break; }
      }
      if (ok) add.push(i);
    }
    for (const i of add) c[i] = 1;
    return add.length;
  }

  // ---- pods ----
  // Six slots inset from the walls: the four corners and the middle of the left and right walls (moved to the nearest floor tile).
  function podSlots(w) {
    const room = w.room, pts = [[3, 3], [room.w - 3, 3], [3, room.h - 3], [room.w - 3, room.h - 3], [2.5, room.h / 2], [room.w - 2.5, room.h / 2]];
    return pts.map(([tx, ty]) => {
      let best = null, bd = 1e9;
      for (let y = 1; y < room.h - 1; y++) for (let x = 1; x < room.w - 1; x++) { const i = y * room.w + x, d = (x + 0.5 - tx) ** 2 + (y + 0.5 - ty) ** 2; if (d < bd && floorAt(room, i)) { bd = d; best = { x: (x + 0.5) * T, y: (y + 0.5) * T }; } }
      return { x: best.x, y: best.y, pod: null, pending: false, dead: false, reach: 0 };
    });
  }
  function growPod(w, e, sl, dur) {
    sl.pending = true; sl.dead = false;
    w.addZone({ kind: 'spawn', x: sl.x, y: sl.y, r: 16, dur, type: 'sporepod', after: (en) => { sl.pod = en; sl.pending = false; sl.reach = 0; } });
  }

  // ---- attacks ----
  const burst = {
    w: 2, start(w, e) { e.pose = 'cast'; },
    update(w, e, dt, t) {
      const q = SM.burst, n = e.phase >= 2 ? q.n2 : q.n, k = e.vars.k || 0;
      if (k < q.waves && t > 0.45 * e.vars.wm + k * q.gap) { ring(w, e, n, q.speed, 'spore', k * 0.27, q.mul, 7); e.vars.k = k + 1; }
      return t > 0.45 * e.vars.wm + q.waves * q.gap + 0.4;
    },
  };
  const lash = {
    w: 3,
    start(w, e) {
      const q = SM.lash, k = e.vars.wm, fan = e.phase >= 2 ? [-q.fan, 0, q.fan] : [0];
      e.pose = 'wind';
      const hs = w.alivePlayers().filter(p => !(p.stealthT > 0)), tg = hs.length ? hs : [e.target];
      for (const p of tg) { const a = Math.atan2(p.y - e.y, p.x - e.x); for (const f of fan) line(w, e, e.x, e.y, a + f, q.len, q.w, q.wind * k, q.mul); }
      e.vars.end = q.wind * k + 0.3;
    },
    update(w, e, dt, t) { if (t > e.vars.end - 0.3) e.pose = 'slam'; return t > e.vars.end; },
  };
  const slam = {
    w: 4, ok: (w, e) => w.alivePlayers().some(p => U.dist2(p.x, p.y, e.x, e.y) < SM.slam.near ** 2),
    start(w, e) {
      const q = SM.slam;
      e.pose = 'wind';
      tele(w, e, e.x, e.y, q.r, q.wind * e.vars.wm, q.mul, 'slam', (ww, z) => {
        e.pose = 'slam';
        const car = ED.Arena.field(ww.room); if (car && car.carpet) { clearAt(ww.room, car.carpet, z.x, z.y, z.r); e.spT = Math.max(e.spT, SM.slam.calm); ww.emit({ t: 'carpetclear', x: Math.round(z.x), y: Math.round(z.y), r: z.r }); }
      });
    },
    update(w, e, dt, t) { return t > SM.slam.wind * e.vars.wm + 0.45; },
  };

  // ---- the arena clock: carpet growth, its damage, pods and buds ----
  function tick(w, e, dt) {
    const room = w.room;
    if (!e.slots) {
      e.slots = podSlots(w); e.spT = SM.spread.t; e.cpT = SM.tick; e.podT = SM.pods.first; e.budT = SM.buds.gap; e.buds = [];
      const c = new Uint8Array(room.w * room.h); c[idx(room, e.x, e.y)] = 1;
      ED.Arena.setField(room, { walls: null, carpet: c });
    }
    const ar = ED.Arena.field(w.room); if (!ar || !ar.carpet) return;
    const c = ar.carpet;
    for (const sl of e.slots) if (sl.pod && sl.pod.hp <= 0) { // a destroyed pod clears the carpet around itself
      sl.pod = null; sl.dead = true;
      clearAt(room, c, sl.x, sl.y, SM.clear * T);
      w.emit({ t: 'podburst', x: Math.round(sl.x), y: Math.round(sl.y), r: SM.clear * T });
    }
    if (e.phase < 3) { // phases 1-2: the carpet spreads from her and from the live pods
      if ((e.spT -= dt) <= 0) {
        e.spT = SM.spread.t;
        const srcs = [{ x: e.x, y: e.y, r: SM.spread.reach }];
        for (const sl of e.slots) if (sl.pod) { sl.reach = Math.min(SM.spread.pod, sl.reach + 1); srcs.push({ x: sl.x, y: sl.y, r: sl.reach }); }
        grow(room, c, srcs);
      }
    } else if (e.paintAt === undefined || U.dist2(e.x, e.y, e.paintAt[0], e.paintAt[1]) > 64) { // phase 3: carpet where she walks
      e.paintAt = [e.x, e.y];
      const r = SM.paint, cx = Math.floor(e.x / T), cy = Math.floor(e.y / T);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x > 0 && y > 0 && x < room.w - 1 && y < room.h - 1 && floorAt(room, y * room.w + x)) c[y * room.w + x] = 1;
    }
    if ((e.cpT -= dt) <= 0) { // carpet damage
      e.cpT = SM.tick;
      for (const p of w.players.values()) if (w.alive(p) && c[idx(room, p.x, p.y)]) w.hurtPlayer(p, e.dmg * SM.dps * SM.tick, { hazard: true, x: p.x, y: p.y });
    }
    if (e.phase === 1 && (e.podT -= dt) <= 0) { // phase 1: pods regrow on their own up to SM.pods.n
      e.podT = SM.pods.regrow;
      const live = e.slots.filter(s => s.pod || s.pending).length, free = e.slots.filter(s => !s.pod && !s.pending);
      const want = e.slots.some(s => s.pod || s.pending || s.dead) ? Math.min(1, SM.pods.n - live) : SM.pods.n; // the first growth fills every pod at once
      for (let i = 0; i < want && free.length; i++) growPod(w, e, free.splice(w.rng.int(0, free.length - 1), 1)[0], SM.pods.spawn);
    }
    if (e.phase === 2 && (e.budT -= dt) <= 0) { // phase 2: buds drift to destroyed pods
      e.budT = SM.buds.gap;
      const aimed = new Set(e.buds.filter(b => b.hp > 0).map(b => b.slot));
      const dead = e.slots.filter(s => s.dead && !s.pending && !aimed.has(s));
      for (let i = 0; i < SM.buds.n && dead.length; i++) {
        const sl = dead.splice(w.rng.int(0, dead.length - 1), 1)[0], a = Math.atan2(sl.y - e.y, sl.x - e.x);
        w.addZone({ kind: 'spawn', x: e.x + Math.cos(a) * (e.r + 14), y: e.y + Math.sin(a) * (e.r + 14), r: 12, dur: SM.buds.spawn, type: 'sporebud', after: (en) => { en.dest = { x: sl.x, y: sl.y }; en.slot = sl; e.buds.push(en); } });
      }
    }
    for (const b of e.buds) if (b.hp > 0 && U.dist2(b.x, b.y, b.slot.x, b.slot.y) < SM.buds.reach ** 2) { // a bud that reaches its pod regrows it
      b.hp = 0;
      if (!b.slot.pod && !b.slot.pending) { growPod(w, e, b.slot, SM.pods.spawn); w.emit({ t: 'regrow', x: Math.round(b.slot.x), y: Math.round(b.slot.y) }); }
    }
    if (e.buds.length > 8) e.buds = e.buds.filter(b => b.hp > 0);
  }
  // Rooted in phases 1-2 (turns to face the target); phase 3 walks after it.
  function idle(w, e, dt) {
    e.pose = 'idle';
    if (e.target) e.face = e.target.x > e.x ? 1 : -1;
    if (e.phase < 3 || !e.target) return;
    const d = Math.hypot(e.target.x - e.x, e.target.y - e.y);
    if (d > e.r + 20) { const dir = w.pathDir(e, e.target.x, e.target.y); mv(w, e, dir[0], dir[1], e.spd * SM.chase * e.slow, dt); }
  }
  function onPhase(w, e, ph) {
    if (ph === 3) w.emit({ t: 'uproot', x: Math.round(e.x), y: Math.round(e.y) });
  }

  // Spore pods stand still and never touch; buds fly straight to their pod and never touch.
  ED.AI.pod = (w, e) => { e.contactCd = 1; };
  ED.AI.bud = (w, e, dt) => {
    e.contactCd = 1;
    if (!e.dest) return;
    const dx = e.dest.x - e.x, dy = e.dest.y - e.y, d = Math.hypot(dx, dy);
    if (d > 1) { const s = Math.min(d, e.spd * e.slow * dt); e.x += dx / d * s; e.y += dy / d * s; e.face = dx >= 0 ? 1 : -1; }
  };

  B.sporemother = L.runner({ burst, lash, slam }, { idle, tick, onPhase, volley: false });
})(globalThis.ED || (globalThis.ED = {}));
