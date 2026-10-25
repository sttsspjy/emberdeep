// Boss and champion arena drawing (ED.ArenaFx; room.arena, src/sim/arena.js): Drowned King dais, water, tide warning and whirlpool; Hollow King darkness, lanterns and falling rings;
// Tidal Beam sweep preview, champion labels, revive countdown, bind ground; arena event effects and sounds. render.js calls ground (lit pass), over (after lighting) and the light hooks.
// The second block draws the field kind: the Sporemother's spore carpet, the Bone Warden's wall blocks and spectral swords; the third the Clockwork Colossus.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, TAU = U.TAU, R = ED.Render, F = ED.FX, CFX = ED.ClassFx, Pix = ED.Pix;
  const AF = ED.ArenaFx = { k: 0, lastT: 0 };
  const s2 = (v) => Math.round(v / 2) * 2;
  const WATER = '#0f3a66', FRONT = '#bff2f4', WARN = '#8fe6ff', STONE = ['#7c847a', '#a4ab9c', '#3a3f38'], VOID = '#07040c', CRACK = '#ff8a5a', LAN = '#ffe2a0';
  const arOf = (view) => (view.room && view.room.arena) || null;

  // ---------------- darkness (Hollow King phase 2): eased 0..1, read by drawLighting ----------------
  AF.dark = (view, t) => {
    const ar = arOf(view), want = ar && ar.k === 'crown' && ar.dark ? 1 : 0, dt = U.clamp(t - AF.lastT, 0, 0.1);
    AF.lastT = t;
    AF.k += (want - AF.k) * Math.min(1, dt * (want ? 1.6 : 2.4));
    if (Math.abs(AF.k - want) < 0.005) AF.k = want;
    return AF.k;
  };
  // Hero light radius in the dark: the vision radius of the sim (DARK.vis) is the bright core.
  AF.heroLight = (base) => (AF.k > 0 && ED.Arena.crown ? U.lerp(base, ED.Arena.crown.DARK.vis * 1.75, AF.k) : base);
  // The boss's own light and eye glow go out in the dark unless a light reaches him.
  AF.hideFoe = (view, e) => {
    if (AF.k < 0.5 || !e.boss) return false;
    const ar = arOf(view);
    if (!ar || !ED.Arena.crown || ED.Arena.crown.lit(view.room, ar, e.x, e.y, e.r)) return false;
    for (const p of view.players.values()) if (!p.dead && U.dist2(p.x, p.y, e.x, e.y) < (ED.Arena.crown.DARK.vis + e.r) ** 2) return false;
    return true;
  };

  // ---------------- ground (lit pass, under actors) ----------------
  const rect = (c, x, y, w, h) => c.fillRect(s2(x), s2(y), s2(w), s2(h));
  function dais(c, d, sunk, t) {
    const x = d.x * T, y = d.y * T, w = d.w * T, h = d.h * T;
    if (sunk) { c.fillStyle = U.rgba('#173c44', 0.55); rect(c, x, y, w, h); c.fillStyle = U.rgba(FRONT, 0.18 + 0.08 * Math.sin(t * 2 + x)); rect(c, x + 4, y + 4, w - 8, 2); return; }
    c.fillStyle = STONE[2]; rect(c, x, y + 4, w, h); // the lip below the raised stone
    c.fillStyle = STONE[0]; rect(c, x, y, w, h - 4);
    c.fillStyle = STONE[1]; rect(c, x, y, w, 2); rect(c, x, y, 2, h - 4);
    c.fillStyle = U.rgba(STONE[2], 0.5); for (let i = 1; i < d.w; i++) rect(c, x + i * T, y + 2, 2, h - 6);
  }
  // Water band of edge i from its inner line to depth front x span (px rect).
  function band(room, i, f) {
    const K = ED.Arena.tide, d = f * K.span(room, i), x0 = T, y0 = 2 * T, x1 = (room.w - 1) * T, y1 = (room.h - 1) * T;
    return i === 0 ? [x0, y0, x1 - x0, d] : i === 1 ? [x0, y1 - d, x1 - x0, d] : i === 2 ? [x1 - d, y0, d, y1 - y0] : [x0, y0, d, y1 - y0];
  }
  function tideGround(c, room, ar, t) {
    const ds = room.dais || [];
    for (let i = 0; i < ds.length; i++) if ((ar.sunk >> i) & 1) dais(c, ds[i], true, t);
    if (ar.st >= 2 && ar.front > 0) {
      for (let i = 0; i < 4; i++) {
        if (!((ar.m >> i) & 1)) continue;
        const b = band(room, i, ar.front), hz = i < 2;
        c.fillStyle = U.rgba(WATER, 0.62); rect(c, b[0], b[1], b[2], b[3]);
        c.fillStyle = U.rgba(FRONT, 0.3); // drifting highlight streaks
        for (let k = 0; k < (hz ? b[2] : b[3]) / 48; k++) { const u = (k * 48 + t * 22) % (hz ? b[2] : b[3]), v = (k * 37) % Math.max(8, hz ? b[3] : b[2]); if (hz) rect(c, b[0] + u, b[1] + v, 10, 2); else rect(c, b[0] + v, b[1] + u, 2, 10); }
        // the front: a bright wobbling edge
        c.fillStyle = U.rgba(FRONT, 0.8); c.beginPath();
        const len = hz ? b[2] : b[3], fx = i === 2 ? b[0] : b[0] + b[2], fy = i === 1 ? b[1] : b[1] + b[3];
        for (let u = 0; u < len; u += 4) { const wob = Math.sin(u * 0.05 + t * 3) * 3; if (hz) c.rect(s2(b[0] + u), s2((i === 0 ? fy : b[1]) + wob - 1), 4, 2); else c.rect(s2((i === 3 ? fx : b[0]) + wob - 1), s2(b[1] + u), 2, 4); }
        c.fill();
      }
    }
    for (let i = 0; i < ds.length; i++) if (!((ar.sunk >> i) & 1)) dais(c, ds[i], false, t);
    if (ar.pool) { // whirlpool: turning arcs and the hurting core
      const cc = ED.Dungeon.center(room), P = ED.Arena.tide.POOL;
      c.fillStyle = U.rgba('#0b2a33', 0.45); c.beginPath(); c.arc(cc.x, cc.y, P.core + 4, 0, TAU); c.fill();
      c.fillStyle = U.rgba(FRONT, 0.55); c.beginPath();
      for (let j = 0; j < 3; j++) for (let u = 0; u < 1; u += 0.04) { const a = -t * 1.8 + j * TAU / 3 + u * 3.2, r = P.core + 8 + u * 110; c.rect(s2(cc.x + Math.cos(a) * r), s2(cc.y + Math.sin(a) * r * 0.8), 2, 2); }
      c.fill();
      Pix.put(c, Pix.ring(Math.round((P.core) / 2), 1, '#ff7a6a', '#ff7a6a'), s2(cc.x), s2(cc.y), 0.6 + 0.2 * Math.sin(t * 5));
    }
  }
  function crownGround(c, view, room, ar, t) {
    if (ar.orig) { // fallen rings: void with a dark lip where standing floor meets it
      c.fillStyle = VOID; c.beginPath();
      for (let j = 0; j < ar.orig.length; j += 2) { const i = ar.orig[j]; c.rect((i % room.w) * T, ((i / room.w) | 0) * T, T, T); }
      c.fill();
      c.fillStyle = '#2a2238'; c.beginPath();
      for (let j = 0; j < ar.orig.length; j += 2) {
        const i = ar.orig[j], x = (i % room.w) * T, y = ((i / room.w) | 0) * T;
        if (room.tiles[i - room.w] === 0) c.rect(x, y, T, 4); // the face of the floor above drops into the void
      }
      c.fill();
    }
    const ls = room.lanterns || [];
    for (let i = 0; i < ls.length; i++) {
      const L = ls[i], v = ar.lit ? ar.lit[i] : 0;
      if (v < 0) continue;
      const on = v > 0, x = s2(L.x), y = s2(L.y);
      c.fillStyle = '#1c1826'; c.fillRect(x - 4, y - 2, 8, 6); c.fillRect(x - 2, y - 16, 4, 14); // post
      c.fillStyle = on ? LAN : '#5d5672'; c.fillRect(x - 4, y - 24, 8, 8); // head
      if (on) { const k = Math.min(1, v / 3); R.light(L.x, L.y - 18, ED.Arena.crown.DARK.lanR * 1.9, '#ffd890', 0.95 * k + 0.05); R.emit(L.x, L.y - 20, 18, LAN, 0.6 * k); }
      else if (ar.dark) R.light(L.x, L.y - 18, 34, '#a89cff', 0.4);
    }
  }
  AF.ground = (c, view, room, t) => {
    const ar = room.arena;
    if (!ar) return;
    if (ar.k === 'tide') tideGround(c, room, ar, t);
    else if (ar.k === 'crown') crownGround(c, view, room, ar, t);
  };

  // ---------------- overlay (after lighting: warnings stay bright in any light) ----------------
  function tideOver(c, room, ar, t) {
    if (!(ar.st >= 1 && ar.st <= 2)) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 9), reach = ar.st === 1 ? ED.Arena.tide.TIDE.reach[0] : 0;
    for (let i = 0; i < 4; i++) {
      if (!((ar.m >> i) & 1)) continue;
      const full = band(room, i, ar.reach || reach), hz = i < 2;
      if (ar.st === 1) { c.fillStyle = U.rgba(WARN, 0.14 + 0.12 * pulse); rect(c, full[0], full[1], full[2], full[3]); }
      // dashed line where the water will stop
      const lx = i === 2 ? full[0] : full[0] + full[2], ly = i === 1 ? full[1] : full[1] + full[3];
      c.fillStyle = U.rgba(WARN, 0.6 + 0.3 * pulse); c.beginPath();
      const len = hz ? full[2] : full[3], ph = (t * 40) % 16;
      for (let u = ph; u < len; u += 16) { if (hz) c.rect(s2(full[0] + u), s2(ly - 2), 8, 4); else c.rect(s2(lx - 2), s2(full[1] + u), 4, 8); }
      c.fill();
      if (ar.st === 1) { // chevrons on the flooding edge pointing in
        c.fillStyle = U.rgba(WARN, 0.85); c.beginPath();
        for (let u = 48; u < len - 24; u += 96) for (let k = 0; k < 3; k++) {
          const o = k * 2 - 2, d = 10 + ((t * 30) % 12);
          if (i === 0) c.rect(s2(full[0] + u + o * 2), s2(full[1] + d - Math.abs(o)), 4, 2);
          else if (i === 1) c.rect(s2(full[0] + u + o * 2), s2(full[1] + full[3] - d + Math.abs(o)), 4, 2);
          else if (i === 2) c.rect(s2(full[0] + full[2] - d + Math.abs(o)), s2(full[1] + u + o * 2), 2, 4);
          else c.rect(s2(full[0] + d - Math.abs(o)), s2(full[1] + u + o * 2), 2, 4);
        }
        c.fill();
      }
    }
  }
  function crownOver(c, room, ar, t) {
    const H = ED.Arena.crown;
    if (ar.warn >= 0) { // the ring about to fall: pulsing cracks, brighter as the fall nears
      const lim = H.CRUMBLE.fall[ar.warn], k = U.clamp(ar.wt / H.CRUMBLE.warn, 0, 1), a = 0.12 + 0.22 * k + 0.12 * Math.sin(t * (8 + k * 10));
      c.fillStyle = U.rgba(CRACK, a); c.beginPath();
      for (let ty = 2; ty <= room.h - 2; ty++) for (let tx = 1; tx <= room.w - 2; tx++) {
        const v = room.tiles[ty * room.w + tx];
        if ((v === 0 || v === 4) && H.qOf(room, tx, ty) > lim) { const x = tx * T, y = ty * T, h = ((tx * 7 + ty * 13) & 3); c.rect(x + 2, y + 2, T - 4, T - 4); if (k > 0.4) { c.rect(x + 6 + h * 4, y + 4, 2, T - 10); } }
      }
      c.fill();
    }
    if (ar.dark) { // unlit lanterns: a dim ring to find them by
      const ls = room.lanterns || [];
      for (let i = 0; i < ls.length; i++) if (ar.lit[i] === 0) Pix.put(c, Pix.ring(9, 1, '#c8bcff', '#c8bcff', null, 3, (t * 6) & 7), s2(ls[i].x), s2(ls[i].y - 20), 0.55 + 0.25 * Math.sin(t * 4 + i));
    }
  }
  // Tidal Beam warm-up: a dotted arc and a faint end lane show the sweep (laser zones with arc; spin beams draw a full ring).
  function sweeps(c, view, t) {
    for (const z of view.zones) {
      if (z.kind !== 'laser' || !z.arc || z.neon || z.t >= (z.warm || 0)) continue; // a Colossus sweep draws its own (neonZone)
      const r = 70, n = Math.ceil(Math.abs(z.arc) * r / 6), a1 = z.a + z.arc;
      c.fillStyle = U.rgba(WARN, 0.7); c.beginPath();
      for (let i = 0; i <= n; i++) if ((i + ((t * 12) | 0)) % 3 < 2) { const a = z.a + z.arc * i / n; c.rect(s2(z.x + Math.cos(a) * r), s2(z.y + Math.sin(a) * r), 2, 2); }
      if (Math.abs(z.arc) < TAU - 0.1) for (let u = r; u < Math.min(z.len, 360); u += 10) c.rect(s2(z.x + Math.cos(a1) * u), s2(z.y + Math.sin(a1) * u), 2, 2);
      c.fill();
      const ah = a1 + Math.sign(z.arc) * 0.12; // arrow head at the sweep's end
      c.fillStyle = U.rgba(WARN, 0.95); c.beginPath(); c.rect(s2(z.x + Math.cos(ah) * r - 2), s2(z.y + Math.sin(ah) * r - 2), 4, 4); c.fill();
    }
  }
  // Champion labels (the twins; the Colossus labels itself in colBars) and the revive countdown of a fallen twin (a long spawn zone).
  function champs(c, view, room, t) {
    for (const e of view.enemies) {
      if (e.hp <= 0 || !e.def || !e.def.champ || e.def.colo) continue;
      R.label(c, e.def.name, Math.round(e.x), Math.round(e.y - e.r * 2.6 - 18), '#ffd36b');
    }
    for (const z of view.zones) {
      if (z.kind !== 'spawn' || !(z.dur > 3)) continue;
      const left = Math.max(0, z.dur - z.t), k = 1 - left / z.dur;
      c.fillStyle = U.rgba('#ffb13a', 0.85); c.beginPath();
      for (let i = 0; i < 40; i++) if (i / 40 < k) { const a = -Math.PI / 2 + i / 40 * TAU; c.rect(s2(z.x + Math.cos(a) * 30), s2(z.y + Math.sin(a) * 30), 2, 2); }
      c.fill();
      R.label(c, 'Revives in ' + Math.ceil(left), Math.round(z.x), Math.round(z.y - 40), '#ffb13a');
    }
  }
  AF.over = (c, view, room, t) => {
    const ar = room.arena;
    if (ar && ar.k === 'tide') tideOver(c, room, ar, t);
    else if (ar && ar.k === 'crown') crownOver(c, room, ar, t);
    sweeps(c, view, t);
    champs(c, view, room, t);
    if (ar && ar.k === 'champ' && ar.c) AF.colBars(c, view);
  };

  // Bind ground (Lancer): a chained circle that slows.
  CFX.zone.bind = (c, z, pass, t) => {
    if (pass !== 0) return;
    const r = Math.round(z.r / 2), fade = Math.min(1, (z.dur - z.t) * 3);
    Pix.put(c, Pix.disc(r, '#2a2240'), s2(z.x), s2(z.y), 0.4 * fade);
    Pix.put(c, Pix.ring(r, 2, '#d8c27a', '#8a7a4a', null, 2, (t * 4) & 7), s2(z.x), s2(z.y), 0.9 * fade);
    R.light(z.x, z.y, z.r * 1.4, '#ffe08a', 0.4 * fade);
  };

  // ---------------- events ----------------
  const A = () => ED.Audio;
  const banner = (s) => F.showBanner(s, '', 'small', 1.8);
  const on = (t, f) => CFX.on(t, f);
  on('tide', (ev) => { if (ev.st === 1) { A().play('bell', 0.8); banner('Tide incoming: stand on raised stone'); } else { A().play('whirl', 0.7); F.addShake(2); } });
  on('sink', (ev) => { F.ring(ev.x, ev.y, 60, FRONT, 0.6, 3); A().play('thud', 0.8); F.addShake(3); });
  on('pool', (ev) => { F.ring(ev.x, ev.y, 120, FRONT, 0.9, 3, true); A().play('implode', 0.8); banner('Whirlpool: it pulls you in, its centre hurts'); });
  on('lantern', (ev) => { F.ring(ev.x, ev.y - 20, 40, LAN, 0.45, 3); F.pop(ev.x, ev.y - 20, 24, LAN, 0.2, true); A().play('bell', 0.6); });
  on('lightsout', (ev) => { A().play('dark', 1); F.addShake(5); banner('Light the lanterns'); });
  on('dawn', (ev) => { A().play('evolve', 0.7); F.flash = { color: '#fff0d0', t: 0.3, a: 0.25 }; banner('The edge is falling: move to the middle'); });
  on('crumble', (ev) => { if (ev.st === 0) { A().play('rupt', 0.8); F.addShake(2); } else { A().play('smash', 1); A().play('boom', 0.7); F.addShake(8); } });
  on('fall', (ev, ctx, local) => { F.burst(ev.x0, ev.y0, 10, { color: '#2a2238', sp: 80, life: 0.5, size: 2 }); if (ev.pid === local) { F.flash = { color: '#000000', t: 0.35, a: 0.5 }; banner('You fell'); } });
  on('champ', (ev) => { A().play(ev.k === 'colossus' ? 'alarm' : 'roar', 0.8); F.showBanner(ev.k === 'colossus' ? 'Clockwork Colossus' : 'Twins', ev.k === 'colossus' ? 'Break two of its parts to open the core' : 'Kill both within 10 s of each other', 'boss', 2.6); });
  on('twinfall', (ev) => { F.ring(ev.x, ev.y, 34, '#ffb13a', 0.6, 3); A().play('down', 0.8); });
  on('twinrise', (ev) => { F.ring(ev.x, ev.y, 50, '#ffb13a', 0.6, 3, true); A().play('revive', 0.9); F.addShake(3); });
  const TELL = { beam: 'charge', stalk: 'ambush', combo: 'clang', crown: 'throw', blink: 'veil', orbs: 'magic', nova: 'magic', laser: 'charge', starfall: 'raincast', reel: 'howl', bind: 'clang' };
  on('tell', (ev) => { const s = TELL[ev.k]; if (s) A().play(s, ev.k === 'stalk' ? 1 : 0.6); if (ev.k === 'stalk') F.ring(ev.x, ev.y, 36, '#ffffff', 0.5, 3, true); });
})(globalThis.ED || (globalThis.ED = {}));

// Field kind (room.arena k 'field'): the Sporemother's spore carpet (one cached art-grid canvas per room, rebuilt when room.carpet changes), the Bone Warden's bone wall blocks
// (y-sorted with the actors, rising on appear, cracked by hp, white on a hit) and his spectral swords hovering over their warning lines.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, A = 16; // art px per tile (1 art px = 2 world px)
  const Ar = ED.ArenaFx;
  const hash = (a, b, n) => { let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(n, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const rgba = (h, a) => { const c = U.hexToRgb(h); return ((Math.round(a * 255) << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0; }; // little-endian ImageData word

  // ---------- spore carpet ----------
  // Three body shades in 2x2 art-px clumps, a light ragged rim where the carpet meets clear floor, scattered spore dots.
  const CB = [rgba('#4a1a5a', 0.74), rgba('#5e2470', 0.72), rgba('#743086', 0.7)], CRIM = rgba('#d27aff', 0.85), CDOT = rgba('#f0b0ff', 0.95), CDOT2 = rgba('#7dffd9', 0.9);
  let cv = null, cRoom = null, cPrev = null;
  function buildCarpet(room, car) {
    const W = room.w, H = room.h;
    if (!cv || cv.width !== W * A || cv.height !== H * A) { cv = document.createElement('canvas'); cv.width = W * A; cv.height = H * A; }
    const g = cv.getContext('2d'), img = g.createImageData(W * A, H * A), px = new Uint32Array(img.data.buffer), on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && car[y * W + x] === 1;
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      if (!on(tx, ty)) continue;
      const oL = !on(tx - 1, ty), oR = !on(tx + 1, ty), oU = !on(tx, ty - 1), oD = !on(tx, ty + 1);
      for (let ly = 0; ly < A; ly++) for (let lx = 0; lx < A; lx++) {
        const gx = tx * A + lx, gy = ty * A + ly;
        let rim = false, out = false;
        const edge = (d, along, side) => { const th = 1 + Math.floor(hash(along >> 1, side, 7) * 3); if (d < th) out = true; else if (d === th) rim = true; };
        if (oL) edge(lx, gy, 1); if (oR) edge(A - 1 - lx, gy, 2); if (oU) edge(ly, gx, 3); if (oD) edge(A - 1 - ly, gx, 4);
        if (out) continue;
        const hd = hash(gx, gy, 11);
        px[gy * W * A + gx] = rim ? CRIM : hd < 0.025 ? CDOT : hd < 0.03 ? CDOT2 : CB[Math.floor(hash(gx >> 1, gy >> 1, 5) * 3)];
      }
    }
    g.putImageData(img, 0, 0);
  }
  // Draws the carpet of the room (lit pass, world transform, under zones and actors).
  Ar.carpet = (c, room, t) => {
    const car = room && room.carpet;
    if (!car) { cRoom = null; return; }
    let dirty = cRoom !== room || !cPrev || cPrev.length !== car.length;
    if (!dirty) for (let i = 0; i < car.length; i++) if (car[i] !== cPrev[i]) { dirty = true; break; }
    if (dirty) { buildCarpet(room, car); cRoom = room; cPrev = Uint8Array.from(car); }
    const ga = c.globalAlpha; c.globalAlpha = ga * (0.9 + Math.sin(t * 1.8) * 0.06);
    c.drawImage(cv, 0, 0, cv.width * 2, cv.height * 2);
    c.globalAlpha = ga;
  };

  // ---------- bone wall blocks ----------
  const OUT = '#2e261c', TOP = '#e6dcc0', TOPL = '#f6f0dc', FACE = '#a89878', FACED = '#7d745f', CRACK = '#3a3024';
  const RISE = 0.3, FLASH = 0.12; // rise time, hit flash time (s)
  const seen = new Map(); let seenRoom = null;
  // Standing blocks of the arena, keyed for the y-sort: calls q(key, block) per block (key = the block's bottom edge in world px).
  Ar.blocks = (view, room, q) => {
    if (seenRoom !== room) { seen.clear(); seenRoom = room; }
    const ar = ED.Arena.field(room); if (!ar || !ar.walls) return;
    for (const s of ar.walls) if (s.hp > 0) q((s.y + 1) * T, s);
  };
  // Draws one block s ({x, y, n, hp} in tiles) at world coordinates (world transform).
  Ar.drawBlock = (c, s, t) => {
    const id = s.x + ',' + s.y;
    let m = seen.get(id); if (!m) { m = { t0: t, hp: s.hp, hit: -9 }; seen.set(id, m); }
    if (s.hp < m.hp) m.hit = t; m.hp = s.hp;
    const k = U.clamp((t - m.t0) / RISE, 0, 1), x0 = s.x * T, x1 = (s.x + s.n) * T, yb = (s.y + 1) * T, hTot = Math.round(44 * k / 2) * 2, hFace = Math.round(20 * k / 2) * 2, yt = yb - hTot, yf = yb - hFace;
    if (hTot < 2) return;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x0 - 2, yb - 2, x1 - x0 + 4, 6); // contact shadow
    c.fillStyle = OUT; c.fillRect(x0, yt - 2, x1 - x0, hTot + 2);
    c.fillStyle = TOP; c.fillRect(x0 + 2, yt, x1 - x0 - 4, yf - yt);
    c.fillStyle = TOPL; c.fillRect(x0 + 2, yt, x1 - x0 - 4, 2);
    if (hFace > 2) {
      c.fillStyle = FACE; c.fillRect(x0 + 2, yf, x1 - x0 - 4, hFace - 2);
      c.fillStyle = FACED; for (let x = x0 + 6; x < x1 - 4; x += 8) c.fillRect(x, yf + 2, 2, hFace - 6); // ribs
      c.fillRect(x0 + 2, yb - 4, x1 - x0 - 4, 2);
    }
    if (k >= 1) { // knuckle bones on the top, a skull on the middle tile
      c.fillStyle = TOPL; for (let i = 0; i < s.n; i++) { const cx = x0 + i * T + 16; c.fillRect(cx - 8, yt + 6, 4, 4); c.fillRect(cx + 4, yt + 6, 4, 4); c.fillRect(cx - 6, yt + 8, 12, 2); }
      const sx = x0 + Math.floor(s.n / 2) * T + (s.n % 2 ? 16 : 0); c.fillStyle = OUT; c.fillRect(sx - 6, yf + 4, 4, 4); c.fillRect(sx + 2, yf + 4, 4, 4); c.fillRect(sx - 2, yf + 10, 4, 2);
      c.fillStyle = CRACK; // cracks: one at 2 hp, two at 1 hp
      const cr = (u) => { let x = x0 + Math.round((x1 - x0) * u / 2) * 2; for (let y = yt + 4; y < yb - 4; y += 4) { c.fillRect(x, y, 2, 4); x += (((y >> 2) + s.x) & 1) ? 2 : -2; } };
      if (s.hp <= 2) cr(0.32); if (s.hp <= 1) cr(0.7);
    }
    if (t - m.hit < FLASH) { c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(x0, yt - 2, x1 - x0, hTot + 2); }
  };

  // ---------- spectral swords ----------
  // Bone Warden phase-3 strike lines (teleLine zones of the swords' width): a row of pale blades pointing down, sinking onto the line as its wind-up runs out.
  Ar.swords = (c, view, t) => {
    let war = false; for (const e of view.enemies) if (e.type === 'bonewarden' && e.hp > 0) { war = true; break; }
    if (!war || !ED.Bosses || !ED.Bosses.WARDEN) return;
    const sw = ED.Bosses.WARDEN.swords.w;
    for (const z of view.zones) {
      if (z.kind !== 'teleLine' || Math.round(z.w) !== sw || !(z.dur > 0)) continue;
      const k = U.clamp(z.t / z.dur, 0, 1), co = Math.cos(z.a), si = Math.sin(z.a), n = Math.max(2, Math.round(z.len / 64)), h = Math.round((6 + 54 * (1 - k) * (1 - k)) / 2) * 2, a = 0.35 + 0.55 * k;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n * z.len, x = Math.round((z.x + co * u) / 2) * 2, y = Math.round((z.y + si * u) / 2) * 2, yt = y - h - 26;
        c.globalAlpha = 0.25 * k; c.fillStyle = '#000000'; c.fillRect(x - 4, y - 2, 8, 4); // shadow on the line
        c.globalAlpha = a; c.fillStyle = '#8fb4e8'; c.fillRect(x - 2, yt, 6, 24); // blade (2 px rim)
        c.fillStyle = '#e8f4ff'; c.fillRect(x, yt + 2, 2, 22); c.fillRect(x, yt + 24, 2, 2); // core, tip
        c.fillStyle = '#bcd0ff'; c.fillRect(x - 6, yt - 2, 14, 2); c.fillRect(x, yt - 8, 2, 6); // guard, grip
      }
      if (ED.Render && ED.Render.light) ED.Render.light(z.x + co * z.len / 2, z.y + si * z.len / 2, z.len * 0.5, '#9fc4ff', 0.25 * k);
    }
    c.globalAlpha = 1;
  };
})(globalThis.ED || (globalThis.ED = {}));
// Clockwork Colossus (room.arena k 'champ' with c, champions.js): a machine of neon vector lines, unlike anything else in the pixel world. Its four foes never draw as sprites (render.js skips def.colo);
// drawColossus (lit pass, y-sorted with the actors at the feet): dark body fills and the floor light; neon (emissive pass, additive): every outline as a wide faint stroke under a thin bright one (low quality: the thin one),
// the turning gears and saw, pistons, the flickering lantern eye, sparks at stumps and part-break debris as line fragments; neonZone: its telegraphs, beams and rolling saws in the part colours; bars and name in over.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, AF = ED.ArenaFx, R = ED.Render, F = ED.FX, CFX = ED.ClassFx;
  const PC = { cannon: '#ff3fd2', saw: '#ffb02e', eye: '#38f0ff' }, BODY = '#38f0ff', ARMOR = '#7aa8ff', HOT = '#ffe9a8', STUMP = '#ff4a3a', FROST = '#cfefff';
  const ZC = [null, PC.cannon, PC.saw, PC.eye, '#ff5a4a']; // z.neon: cannon, saw, eye, core
  const FILL = '#060912', PANEL = '#0c1428';
  const lo = () => R.quality === 'low';
  const NODASH = [], dash = (c, d, off) => { if (c.setLineDash) { c.setLineDash(d); c.lineDashOffset = off; } };
  const COL = () => ED.Champions.COL;
  const M = { core: null, cannon: null, saw: null, eye: null, x: 0, y: 0, c: null, t: 0 };
  // The machine of the view, or null: the core foe, the standing parts and the arena row (ar.c).
  function machine(view) {
    const ar = view.room && view.room.arena;
    if (!ar || ar.k !== 'champ' || !ar.c) return null;
    M.core = M.cannon = M.saw = M.eye = null;
    for (const e of view.enemies) if (e.hp > 0 && e.def && e.def.colo) M[e.def.colo] = e;
    if (!M.core) return null;
    M.x = M.core.x; M.y = M.core.y; M.c = ar.c;
    return M;
  }
  const broken = (m, k) => !!(m.c.b & ({ cannon: 1, saw: 2, eye: 4 })[k]);
  const stateOf = (m, i) => (m.c.s >> (2 * i)) & 3; // 0 idle, 1 winding up, 2 firing (i: cannon 0, saw 1, eye 2, core 3)
  const partCol = (e, base) => (!e ? base : e.flash > 0 ? '#ffffff' : e.frozen > 0 ? FROST : base);
  // A path drawn twice: wide and faint, then thin and bright (additive); low quality only the thin one.
  function neon(c, col, w, a, build) {
    c.beginPath(); build(c); c.strokeStyle = col;
    if (!lo()) { c.globalAlpha = 0.22 * a; c.lineWidth = w + 3.5; c.stroke(); }
    c.globalAlpha = a; c.lineWidth = w; c.stroke();
    c.globalAlpha = 1;
  }
  const poly = (c, x, y, pts) => { c.moveTo(x + pts[0], y + pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(x + pts[i], y + pts[i + 1]); c.closePath(); };
  const circ = (c, x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); };
  const seg = (c, x0, y0, x1, y1) => { c.moveTo(x0, y0); c.lineTo(x1, y1); };
  const gear = (c, x, y, r, n, rot, tooth) => { for (let i = 0; i <= n * 2; i++) { const a = rot + i * Math.PI / n, rr = i % 2 ? r : r + tooth; if (i) c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); };
  const CHASSIS = [-50, -30, 50, -30, 40, -4, 30, 16, -30, 16, -40, -4], HEX = (r) => { const o = []; for (let i = 0; i < 6; i++) o.push(Math.cos(i * TAU / 6 + Math.PI / 6) * r, Math.sin(i * TAU / 6 + Math.PI / 6) * r); return o; }, CORE = HEX(20);
  // Foot lift of a leg (side -1 left, 1 right) while the core winds up a stomp.
  const lift = (m, side, t) => (side < 0 && stateOf(m, 3) === 1 ? 7 : 0) + (stateOf(m, 3) ? 0 : Math.max(0, Math.sin(t * 2.2 + (side < 0 ? 0 : Math.PI))) * 1.5);
  function legs(c, x, y, t, m) {
    for (const s of [-1, 1]) { const ly = lift(m, s, t); seg(c, x + s * 24, y + 14, x + s * 40, y + 28 - ly * 0.5); seg(c, x + s * 40, y + 28 - ly * 0.5, x + s * 36, y + 40 - ly); c.rect(x + s * 37 - 11, y + 38 - ly, 22, 6); }
  }
  const elbowOf = (s) => [s * 62, -8];
  // Cannon barrel corners from the part centre along aim a.
  const barrel = (c, x, y, a) => { const ca = Math.cos(a), sa = Math.sin(a), h = 7, L = 30; c.moveTo(x - sa * h, y + ca * h); c.lineTo(x + ca * L - sa * h, y + sa * L + ca * h); c.lineTo(x + ca * L + sa * h, y + sa * L - ca * h); c.lineTo(x + sa * h, y - ca * h); c.closePath(); };

  // ---------- lit pass: body fills and floor light ----------
  AF.colossus = (view, q) => { const m = machine(view); if (m) q(m.y + 40, m); };
  AF.drawColossus = (c, m, t) => {
    const x = m.x, y = m.y, O = COL().OFF;
    c.globalAlpha = 0.45; c.fillStyle = '#000000'; c.beginPath(); c.ellipse(x, y + 42, 78, 10, 0, 0, TAU); c.fill();
    c.globalAlpha = 1; c.fillStyle = FILL; c.beginPath();
    poly(c, x, y, CHASSIS); legs(c, x, y, t, m);
    if (!broken(m, 'eye')) circ(c, x + O.eye[0], y + O.eye[1], 16);
    if (!broken(m, 'cannon')) { const px = x + O.cannon[0], py = y + O.cannon[1]; circ(c, px, py, 11); barrel(c, px, py, m.c.a[0]); }
    if (!broken(m, 'saw')) { const a = m.c.a[1], px = x + O.saw[0] + Math.cos(a) * 12, py = y + O.saw[1] + Math.sin(a) * 12; circ(c, px, py, 17); }
    c.fill();
    c.fillStyle = PANEL; c.beginPath(); poly(c, x, y - 4, CORE); c.fill();
    const open = m.c.o, pulse = 0.6 + 0.4 * Math.sin(t * 6);
    R.light(x, y, open ? 120 : 80, open ? HOT : BODY, open ? 0.7 + 0.3 * pulse : 0.45);
    if (!broken(m, 'eye')) R.light(x + O.eye[0], y + O.eye[1], 70, PC.eye, 0.5 + 0.2 * Math.sin(t * 17));
    for (const k of ['cannon', 'saw']) if (!broken(m, k)) R.light(x + O[k][0], y + O[k][1], 60, PC[k], 0.35 + 0.35 * (stateOf(m, k === 'cannon' ? 0 : 1) ? 1 : 0));
  };

  // ---------- emissive pass: the neon machine, sparks, debris ----------
  const deb = []; // line fragments { x, y, vx, vy, a, va, len, col, life, max }
  const addDeb = (x, y, n, cols, sp) => { for (let i = 0; i < n && deb.length < (lo() ? 40 : 120); i++) { const a = Math.random() * TAU, v = sp * (0.4 + Math.random() * 0.8); deb.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.3, a: Math.random() * TAU, va: (Math.random() - 0.5) * 18, len: 4 + Math.random() * 10, col: cols[i % cols.length], life: 0.7 + Math.random() * 0.6, max: 1.3 }); } };
  let lastT = 0;
  function debris(c, dt) {
    let n = 0;
    for (let i = 0; i < deb.length; i++) {
      const d = deb[i];
      d.life -= dt; if (d.life <= 0) continue;
      d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 260 * dt; d.vx *= 1 - 1.5 * dt; d.a += d.va * dt;
      const ca = Math.cos(d.a) * d.len / 2, sa = Math.sin(d.a) * d.len / 2;
      neon(c, d.col, 1.3, Math.min(1, d.life * 1.6), (g) => seg(g, d.x - ca, d.y - sa, d.x + ca, d.y + sa));
      deb[n++] = d;
    }
    deb.length = n;
  }
  // Sparks spitting from a stump at (x, y): short random line flicks this frame.
  function sparks(c, x, y, t) {
    if (Math.random() < (lo() ? 0.5 : 0.25)) return;
    c.beginPath();
    for (let i = 0; i < (lo() ? 1 : 3); i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, r0 = 3 + Math.random() * 4, r1 = r0 + 5 + Math.random() * 9; seg(c, x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1); }
    c.strokeStyle = Math.random() < 0.5 ? '#fff2a0' : STUMP; c.lineWidth = 1.2; c.globalAlpha = 0.9; c.stroke(); c.globalAlpha = 1;
    if (!lo()) R.glow(c, x, y, 10, STUMP, 0.35 + 0.25 * Math.sin(t * 31));
  }
  AF.neon = (c, view, t) => {
    const dt = U.clamp(t - lastT, 0, 0.1); lastT = t;
    const m = machine(view);
    if (m) drawNeon(c, m, t);
    if (deb.length) debris(c, dt);
  };
  function drawNeon(c, m, t) {
    const x = m.x, y = m.y, O = COL().OFF, open = m.c.o, core = m.core, hot = 0.6 + 0.4 * Math.sin(t * 6);
    c.lineJoin = 'round'; c.lineCap = 'round';
    // chassis, legs, shoulders, neck
    neon(c, partCol(core, BODY), 1.4, 0.9, (g) => {
      poly(g, x, y, CHASSIS); legs(g, x, y, t, m);
      seg(g, x - 36, y - 22, x - 18, y + 8); seg(g, x + 36, y - 22, x + 18, y + 8); // ribs
      circ(g, x - 50, y - 24, 8); circ(g, x + 50, y - 24, 8);
      if (!broken(m, 'eye')) { seg(g, x - 10, y - 30, x - 8, y - 40); seg(g, x + 10, y - 30, x + 8, y - 40); }
    });
    // core: armour plates over a gear, or the open gear burning
    const gr = t * (open ? 2.4 : 0.6);
    neon(c, open ? HOT : partCol(core, ARMOR), open ? 1.6 : 1.2, open ? 0.6 + 0.4 * hot : 0.8, (g) => gear(g, x, y - 4, 11, 8, gr, 3));
    if (!open) neon(c, partCol(core, ARMOR), 1.4, 0.95, (g) => { for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a); g.moveTo(x + ca * 6, y - 4 + sa * 6); g.lineTo(x + Math.cos(a - 0.6) * 19, y - 4 + Math.sin(a - 0.6) * 19); g.lineTo(x + Math.cos(a + 0.6) * 19, y - 4 + Math.sin(a + 0.6) * 19); g.closePath(); } });
    else { neon(c, HOT, 1.2, 0.8, (g) => poly(g, x, y - 4, CORE)); if (!lo()) R.glow(c, x, y - 4, 34 + 6 * hot, '#ffcf6a', 0.55); }
    // pistons: a sleeve and a sliding rod per arm
    for (const s of [-1, 1]) {
      const k = s < 0 ? 'cannon' : 'saw', e = M[k], br = broken(m, k), slide = 4 * Math.sin(t * (stateOf(m, s < 0 ? 0 : 1) ? 9 : 2) + (s < 0 ? 0 : 1.7)), el = elbowOf(s);
      neon(c, br ? STUMP : partCol(e, BODY), 1.2, br ? 0.6 : 0.85, (g) => { seg(g, x + s * 50, y - 24, x + el[0], y + el[1]); seg(g, x + s * 40, y - 6, x + s * (52 + slide), y - 2); circ(g, x + el[0], y + el[1], 3); });
      if (br) { sparks(c, x + el[0], y + el[1], t); continue; }
      const px = x + O[k][0], py = y + O[k][1], st = stateOf(m, s < 0 ? 0 : 1), col = partCol(e, PC[k]), glow = st === 1 ? 0.55 + 0.45 * Math.sin(t * 20) : st === 2 ? 1 : 0.75;
      if (k === 'cannon') {
        const a = m.c.a[0], spin = t * (st === 2 ? 14 : st === 1 ? 6 : 1);
        neon(c, col, 1.4, glow, (g) => { barrel(g, px, py, a); circ(g, px + Math.cos(a) * 30, py + Math.sin(a) * 30, 5); circ(g, px, py, 10); for (let i = 0; i < 6; i++) { const b = spin + i * TAU / 6; seg(g, px, py, px + Math.cos(b) * 10, py + Math.sin(b) * 10); } });
        if (st && !lo()) R.glow(c, px + Math.cos(a) * 30, py + Math.sin(a) * 30, 12 + 6 * glow, PC.cannon, 0.6 * glow);
      } else {
        const a = m.c.a[1], hx = px + Math.cos(a) * 12, hy = py + Math.sin(a) * 12, spin = t * (st === 2 ? 26 : st === 1 ? 12 : 3);
        neon(c, col, 1.4, glow, (g) => { seg(g, px, py, hx, hy); gear(g, hx, hy, 14, 12, spin, 4); circ(g, hx, hy, 4); });
        if (st && !lo()) R.glow(c, hx, hy, 22, PC.saw, 0.45 * glow);
      }
    }
    // the lantern eye: housing, iris, a pupil looking down its aim; a flicker
    const ex = x + O.eye[0], ey = y + O.eye[1];
    if (broken(m, 'eye')) { neon(c, STUMP, 1.2, 0.5 + 0.3 * Math.random(), (g) => circ(g, ex, ey, 9)); sparks(c, ex, ey, t); }
    else {
      const e = M.eye, a = m.c.a[2], st = stateOf(m, 2), fl = 0.75 + 0.15 * Math.sin(t * 17) + 0.1 * Math.sin(t * 43), col = partCol(e, PC.eye);
      neon(c, col, 1.4, fl, (g) => { circ(g, ex, ey, 15); circ(g, ex, ey, 8); for (let i = 0; i < 4; i++) { const b = i * Math.PI / 2 + t * 0.8; seg(g, ex + Math.cos(b) * 10, ey + Math.sin(b) * 10, ex + Math.cos(b) * 14, ey + Math.sin(b) * 14); } });
      const pxl = ex + Math.cos(a) * 4, pyl = ey + Math.sin(a) * 4;
      c.fillStyle = st ? '#ffffff' : '#bff8ff'; c.globalAlpha = fl; c.beginPath(); c.arc(pxl, pyl, st === 1 ? 3.5 : 2.5, 0, TAU); c.fill(); c.globalAlpha = 1;
      if (!lo()) R.glow(c, pxl, pyl, st ? 26 : 16, PC.eye, (st ? 0.8 : 0.45) * fl);
    }
  }

  // ---------- telegraphs, beams and saws (render.js drawZones calls neonZone for zones with z.neon) ----------
  const lane = (g, x, y, a, len, w) => { const ca = Math.cos(a), sa = Math.sin(a), h = w / 2; g.moveTo(x - sa * h, y + ca * h); g.lineTo(x + ca * len - sa * h, y + sa * len + ca * h); g.lineTo(x + ca * len + sa * h, y + sa * len - ca * h); g.lineTo(x + sa * h, y - ca * h); g.closePath(); };
  const fan = (g, x, y, a, r, arc) => { g.moveTo(x, y); g.arc(x, y, r, a - arc / 2, a + arc / 2); g.closePath(); };
  AF.neonZone = (c, z, pass, t, k) => {
    const col = ZC[z.neon] || BODY, kind = z.kind;
    if (kind !== 'tele' && kind !== 'teleLine' && kind !== 'teleCone' && kind !== 'laser' && kind !== 'gsaw') return false;
    if (pass === 2) return true;
    const hot = k > 0.82 ? 0.5 + 0.5 * Math.sin(t * 40) : 0;
    if (kind === 'laser') {
      const active = z.t > (z.warm || 0), ca = Math.cos(z.a), sa = Math.sin(z.a), x1 = z.x + ca * z.len, y1 = z.y + sa * z.len;
      if (pass === 0) { if (active) for (let i = 0; i < 3; i++) R.light(z.x + ca * z.len * (i + 0.5) / 3, z.y + sa * z.len * (i + 0.5) / 3, 80, col, 0.7); return true; }
      if (!active) { // warming: a dashed aim line and, for a sweep, the dotted arc it will turn through
        const kw = U.clamp(z.t / Math.max(0.01, z.warm), 0, 1);
        dash(c, [6, 6], -t * 40);
        neon(c, col, 1, 0.4 + 0.5 * kw, (g) => seg(g, z.x, z.y, x1, y1));
        if (z.arc) neon(c, col, 1, 0.7, (g) => { g.moveTo(z.x + Math.cos(z.a) * 60, z.y + Math.sin(z.a) * 60); g.arc(z.x, z.y, 60, z.a, z.a + z.arc, z.arc < 0); });
        dash(c, NODASH, 0);
        if (z.arc) { const ae = z.a + z.arc, ax = z.x + Math.cos(ae) * 60, ay = z.y + Math.sin(ae) * 60; c.fillStyle = col; c.beginPath(); c.arc(ax, ay, 2.5, 0, TAU); c.fill(); }
        if (!lo()) R.glow(c, z.x, z.y, 10 + 14 * kw, col, 0.4 + 0.5 * kw);
        return true;
      }
      const fl = 0.85 + 0.15 * Math.sin(t * 60);
      c.lineCap = 'round';
      if (!lo()) { c.globalAlpha = 0.3 * fl; c.strokeStyle = col; c.lineWidth = z.w * 1.8; c.beginPath(); seg(c, z.x, z.y, x1, y1); c.stroke(); }
      c.globalAlpha = 0.9; c.strokeStyle = col; c.lineWidth = Math.max(2, z.w * 0.7); c.beginPath(); seg(c, z.x, z.y, x1, y1); c.stroke();
      c.globalAlpha = fl; c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(1, z.w * 0.25); c.stroke(); c.globalAlpha = 1;
      if (!lo()) { R.glow(c, z.x, z.y, z.w * 2.5, col, 0.9); R.glow(c, x1, y1, z.w * 2, col, 0.7); }
      return true;
    }
    if (kind === 'gsaw') {
      const q = ED.Champions.gsawAt(z), left = z.len * (1 - Math.min(1, z.t / z.dur)), spin = t * 30;
      if (pass === 0) { R.light(q.x, q.y, 70, col, 0.8); return true; }
      dash(c, [4, 8], -t * 60);
      neon(c, col, 1, 0.5, (g) => lane(g, q.x, q.y, z.a, left, z.w));
      dash(c, NODASH, 0);
      neon(c, col, 1.5, 1, (g) => { gear(g, q.x, q.y - 4, z.r - 3, 12, spin, 4); circ(g, q.x, q.y - 4, 4); });
      if (!lo()) R.glow(c, q.x, q.y - 4, z.r * 1.8, col, 0.6);
      return true;
    }
    const build = kind === 'tele' ? (g, s) => circ(g, z.x, z.y, Math.max(1, z.r * s)) : kind === 'teleLine' ? (g, s) => lane(g, z.x, z.y, z.a, z.len * s, z.w) : (g, s) => fan(g, z.x, z.y, z.a, Math.max(1, z.r * s), Math.min(TAU, z.arc));
    if (pass === 0) { // a faint fill of the whole shape and a brighter one growing to the moment it hits
      c.fillStyle = col; c.globalAlpha = 0.1; c.beginPath(); build(c, 1); c.fill();
      if (k > 0) { c.globalAlpha = 0.16 + 0.1 * hot; c.beginPath(); build(c, k); c.fill(); }
      c.globalAlpha = 1;
      const lx = kind === 'teleLine' ? z.x + Math.cos(z.a) * z.len / 2 : z.x, ly = kind === 'teleLine' ? z.y + Math.sin(z.a) * z.len / 2 : z.y;
      R.light(lx, ly, Math.max(40, (kind === 'teleLine' ? z.len : z.r) * 0.6), col, 0.35);
      return true;
    }
    neon(c, hot ? '#ffffff' : col, 1.2, 0.85, (g) => build(g, 1));
    if (k > 0.02) neon(c, col, 1, 0.5 + 0.4 * k, (g) => build(g, k));
    return true;
  };

  // ---------- over: part health and the name ----------
  AF.colBars = (c, view) => {
    const m = machine(view); if (!m) return;
    const O = COL().OFF;
    for (const k of ['core', 'cannon', 'saw', 'eye']) {
      const e = M[k]; if (!e || e.hp <= 0) continue;
      const w = k === 'core' ? 44 : 26, bx = Math.round(m.x + O[k][0] - w / 2), by = Math.round(m.y + O[k][1] + (k === 'core' ? 52 : k === 'eye' ? -24 : 22)), f = U.clamp(e.hp / e.maxHp, 0, 1);
      const col = k === 'core' ? (m.c.o ? HOT : ARMOR) : PC[k];
      c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(bx - 1, by - 1, w + 2, 4);
      c.fillStyle = U.shade(col, -0.6); c.fillRect(bx, by, w, 2);
      c.fillStyle = col; c.fillRect(bx, by, Math.round(w * f), 2);
      if (k === 'core' && !m.c.o) { c.fillStyle = '#0a0d1a'; for (let i = 1; i < 4; i++) c.fillRect(bx + Math.round(w * i / 4), by, 1, 2); } // armour notches
    }
    R.label(c, m.core.def.name, Math.round(m.x), Math.round(m.y - 78), m.c.o ? HOT : BODY);
  };

  // ---------- shots: neon bolts (cannon) and sparks (stomp shockwaves) ----------
  const bolt = (col) => (c, pr, t, x, y) => {
    const a = Math.atan2(pr.vy, pr.vx), ca = Math.cos(a), sa = Math.sin(a), L = 7, h = 3.5;
    c.lineJoin = 'round';
    neon(c, col, 1.3, 1, (g) => { g.moveTo(x + ca * L, y + sa * L); g.lineTo(x - sa * h, y + ca * h); g.lineTo(x - ca * L * 0.6, y - sa * L * 0.6); g.lineTo(x + sa * h, y - ca * h); g.closePath(); });
    c.fillStyle = '#ffffff'; c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    return true;
  };
  const SB = CFX.shotBody || (CFX.shotBody = {});
  SB.cbolt = bolt(PC.cannon); SB.cspark = bolt(PC.saw);

  // ---------- events ----------
  const A = () => ED.Audio, on = (k, f) => CFX.on(k, f);
  const NAME = ['Cannon Arm', 'Saw Arm', 'Lantern Eye'], PK = ['cannon', 'saw', 'eye'];
  on('colmv', () => A().play('servo', 0.6));
  on('colhum', () => A().play('lhum', 0.7));
  on('colsaw', (ev) => { A().play('gearsaw', 0.7); F.addShake(1.5); F.ring(ev.x, ev.y, 26, PC.saw, 0.3, 2); });
  on('colstomp', (ev) => { A().play('stomp', 0.9); F.addShake(5); F.ring(ev.x, ev.y, 110, '#ff5a4a', 0.45, 3, false, 20); });
  on('colbreak', (ev) => {
    const k = PK[ev.k] || 'cannon';
    A().play('colbreak', 1); F.addShake(7); F.flash = { color: '#ffffff', t: 0.12, a: 0.25 };
    addDeb(ev.x, ev.y, 26, [PC[k], BODY, '#ffffff', STUMP], 220);
    F.ring(ev.x, ev.y, 70, PC[k], 0.5, 3); F.pop(ev.x, ev.y, 34, PC[k], 0.25, true);
    F.showBanner(NAME[ev.k] + ' broken', '', 'small', 1.6);
  });
  on('colopen', (ev) => { A().play('alarm', 1); F.addShake(4); F.ring(ev.x, ev.y, 90, HOT, 0.7, 3, true); F.showBanner('The core is open', 'It takes full damage now. The machine goes wild.', 'small', 2.4); });
  on('coldown', (ev) => {
    A().play('colbreak', 1); A().play('boom', 0.9); F.addShake(12); F.flash = { color: '#bff8ff', t: 0.35, a: 0.4 };
    const O = COL().OFF; for (const k of ['core', 'cannon', 'saw', 'eye']) addDeb(ev.x + O[k][0], ev.y + O[k][1], 22, [k === 'core' ? HOT : PC[k] || BODY, BODY, '#ffffff'], 260);
    F.ring(ev.x, ev.y, 150, BODY, 0.8, 4); F.ring(ev.x, ev.y, 90, HOT, 0.6, 3);
  });
})(globalThis.ED || (globalThis.ED = {}));
