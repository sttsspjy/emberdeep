// Frame renderer (client only). Draws ED.Game.view through ED.Batch at 1 world px per buffer px, integer-scaled so about VIEW_W x VIEW_H world px are visible. HUD draws on top (hud.js).
// Backends: quality 'high' with a hardware WebGL context -> Batch 'gl' (instanced quads into Batch.out, composited by Post without an upload); otherwise Batch '2d' into the buffer canvas,
// presented through Post (upload) when it is usable, else a nearest-neighbour 2D blit.
// Layer order (ARCHITECTURE §10): floor chunks -> own-team zones (faded by coverage) -> enemy zones / telegraph fills -> pickups -> y-sorted actors (heroes, foes, bosses, obstacles, braziers)
// -> projectiles -> zone overlays -> FX -> hostile telegraph outlines (over the horde) -> hero markers (Actors.heroTop) -> overlays (names, bars, numbers).
// Sanctum (view.props.room set, sanctum.js): a baked room (blood-ember floor, sigil rings, walls, corner columns) over a void, flickering wall candles, no obstacles / braziers / deco,
// the camera clamped to the room (+ its walls), the 'sanctum' grade; view.sanctum st 0 fades to black over the second half of the entry fade, st 1 fades in over ROOM_IN s.
// Every list is culled to the view rect; the y-sort is an allocation-free radix sort on typed arrays. Weapon tints (ED.Cos): each owner's projectiles, weapon zones, zone overlays and
// HeroFx draw inside its tint scope; name tags (title + name colour) show in co-op and for a solo hero that wears either.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST;
  const R = ED.Render = { canvas: null, ctx: null, buf: null, bctx: null, dpr: 1, scale: 3, bw: 640, bh: 360, camX: 0, camY: 0, quality: 'high', usePost: false, gpu: false, ms: 0, crowd: 0 };
  const CHUNK = 256, TILE = 16;
  let theme = null, stageId = '', chunks = new Map(), frameN = 0, arenaRef = null, roomOn = null, bgHex = 0, bgCss = '#000', wallRgba = 0;
  const SH = { x: 0, y: 0 };
  const PO_ARGS = { biome: null, t: 0, scale: 1, fx: 0, fy: 0, aberr: 0, flash: [0, 0, 0, 0], tex: null };
  ED.ZoneActor = ED.ZoneActor || {}; // look -> fn(B, z, t): zones drawn as y-sorted actors (lanes register in their fx files)

  R.init = (canvas) => {
    R.canvas = canvas; R.ctx = canvas.getContext('2d');
    R.buf = document.createElement('canvas'); R.bctx = R.buf.getContext('2d', { alpha: false });
    ED.Batch.init(R.bctx);
    if (ED.Post && ED.Post.init) ED.Post.init(canvas);
    R.resize();
    window.addEventListener('resize', R.resize);
    if (ED.Atlas && ED.Atlas.ready) ED.Atlas.ready.then(() => chunks.clear());
  };
  R.resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = Math.round(window.innerWidth * dpr), ch = Math.round(window.innerHeight * dpr);
    R.dpr = dpr; R.canvas.width = cw; R.canvas.height = ch;
    R.scale = Math.max(1, Math.floor(Math.min(cw / C.VIEW_W, ch / C.VIEW_H)));
    R.bw = Math.ceil(cw / R.scale) + 1; R.bh = Math.ceil(ch / R.scale) + 1;
    R.buf.width = R.bw; R.buf.height = R.bh;
    if (ED.Post && ED.Post.resize) ED.Post.resize(cw, ch, R.bw, R.bh);
  };
  R.setQuality = (q) => { R.quality = q === 'low' ? 'low' : 'high'; };
  // Screen (device px) -> world.
  R.toWorld = (sx, sy, out) => { out = out || {}; out.x = R.camX + sx / R.scale; out.y = R.camY + sy / R.scale; return out; };

  // ---------------- floor chunks ----------------
  const pickTile = (tx, ty, seed) => {
    const fl = theme.floor; let tot = 0;
    for (const f of fl) tot += f[1];
    let r = U.hash3(tx, ty, seed) % tot;
    for (const f of fl) { r -= f[1]; if (r < 0) return f[0]; }
    return fl[0][0];
  };
  function bakeChunk(cx, cy, A, seed) {
    const cv = document.createElement('canvas'); cv.width = cv.height = CHUNK;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = theme.pal.bg; g.fillRect(0, 0, CHUNK, CHUNK);
    const x0 = cx * CHUNK, y0 = cy * CHUNK, n = CHUNK / TILE, At = ED.Atlas;
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
      const wx = x0 + tx * TILE, wy = y0 + ty * TILE;
      if (wx < 0 || wy < 0 || wx >= A.size || wy >= A.size) continue;
      At.draw(g, pickTile(wx / TILE, wy / TILE, seed), 0, tx * TILE, ty * TILE);
    }
    for (const d of A.deco) if (d.x >= x0 - 16 && d.x < x0 + CHUNK + 16 && d.y >= y0 - 16 && d.y < y0 + CHUNK + 24) At.draw(g, d.look, 0, d.x - x0, d.y - y0, { alpha: 0.85 });
    // arena edge: a dark rim just inside the bounds
    g.fillStyle = 'rgba(0,0,0,0.55)';
    if (x0 <= 0) g.fillRect(-x0, 0, 4, CHUNK); if (y0 <= 0) g.fillRect(0, -y0, CHUNK, 4);
    if (x0 + CHUNK >= A.size) g.fillRect(A.size - x0 - 4, 0, 4, CHUNK); if (y0 + CHUNK >= A.size) g.fillRect(0, A.size - y0 - 4, CHUNK, 4);
    return { cv, used: frameN };
  }
  function drawFloor(B, A, seed, cx, cy) {
    if (!ED.Atlas.ok) return;
    const c0 = Math.floor(cx / CHUNK), c1 = Math.floor((cx + R.bw) / CHUNK), r0 = Math.floor(cy / CHUNK), r1 = Math.floor((cy + R.bh) / CHUNK);
    for (let ry = r0; ry <= r1; ry++) for (let rx = c0; rx <= c1; rx++) {
      if (rx * CHUNK >= A.size || ry * CHUNK >= A.size || (rx + 1) * CHUNK <= 0 || (ry + 1) * CHUNK <= 0) continue;
      const k = rx * 4096 + ry;
      let ch = chunks.get(k);
      if (!ch) { ch = bakeChunk(rx, ry, A, seed); chunks.set(k, ch); }
      ch.used = frameN;
      B.img(ch.cv, rx * CHUNK, ry * CHUNK, CHUNK, CHUNK);
    }
    if (chunks.size > 40) for (const [k, ch] of chunks) if (frameN - ch.used > 120) chunks.delete(k);
  }

  // ---------------- Sanctum room ----------------
  const ROOM_TILES = [['tile.floor.sanctum.1', 30], ['tile.floor.sanctum.2', 6], ['tile.floor.sanctum.3', 6], ['tile.floor.sanctum.4', 4], ['tile.floor.sanctum.5', 3], ['tile.floor.sanctum.6', 3]];
  const ROOM_PAL = { bg: '#030101', wall: '#3a1a10', accent: '#ff6a2a', light: '#ffd0a0' }, ROOM_BG = 0x030101, ROOM_IN = 0.9, TOP = 18; // TOP: extra px of the top wall's front face
  let roomCv = null, roomRef = null;
  const roomTile = (tx, ty, seed) => { let tot = 0; for (const f of ROOM_TILES) tot += f[1]; let r = U.hash3(tx, ty, seed ^ 0x5a17) % tot; for (const f of ROOM_TILES) { r -= f[1]; if (r < 0) return f[0]; } return ROOM_TILES[0][0]; };
  // Hard-edged pixel ring (radius r, width lw) at (cx, cy) on 2D context g.
  const pxRing = (g, cx, cy, r, lw, col) => {
    g.fillStyle = col; const R0 = Math.ceil(r + lw);
    for (let y = -R0; y <= R0; y++) for (let x = -R0; x <= R0; x++) { const d = Math.hypot(x + 0.5, y + 0.5); if (d >= r && d < r + lw) g.fillRect(cx + x, cy + y, 1, 1); }
  };
  // Bakes room R (inner rect) with its walls: canvas origin = (R.x0 - m, R.y0 - m - TOP).
  function bakeRoom(R, seed) {
    const m = C.SANCTUM.wall, iw = R.x1 - R.x0, ih = R.y1 - R.y0, cv = document.createElement('canvas'), At = ED.Atlas, ox = m, oy = m + TOP;
    cv.width = iw + 2 * m; cv.height = ih + 2 * m + TOP;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = ROOM_PAL.bg; g.fillRect(0, 0, cv.width, cv.height);
    for (let ty = 0; ty < ih / TILE; ty++) for (let tx = 0; tx < iw / TILE; tx++) At.draw(g, roomTile(tx, ty, seed), 0, ox + tx * TILE, oy + ty * TILE);
    // sigil: three rings, eight rune marks, all dim ember
    const cx = ox + iw / 2, cy = oy + ih / 2;
    pxRing(g, cx, cy, 150, 2, 'rgba(255,106,42,0.22)'); pxRing(g, cx, cy, 118, 1, 'rgba(255,140,60,0.18)'); pxRing(g, cx, cy, 46, 2, 'rgba(255,106,42,0.25)');
    g.fillStyle = 'rgba(255,160,80,0.35)';
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rx = Math.round(cx + Math.cos(a) * 134), ry = Math.round(cy + Math.sin(a) * 134); g.fillRect(rx - 2, ry - 3, 5, 1); g.fillRect(rx, ry - 3, 1, 7); g.fillRect(rx - 2, ry + 3, 5, 1); }
    // walls: dark stone bands; the top wall shows a bricked front face, inner lips catch the light, ember cracks glow in the stone
    g.fillStyle = '#1c0e09'; g.fillRect(0, 0, cv.width, oy); g.fillRect(0, oy + ih, cv.width, m); g.fillRect(0, oy, ox, ih); g.fillRect(ox + iw, oy, m, ih);
    g.fillStyle = '#2e170d'; g.fillRect(ox, oy - TOP, iw, TOP);
    g.fillStyle = '#120805';
    for (let y = oy - TOP; y < oy; y += 6) { g.fillRect(ox, y, iw, 1); for (let x = ox + ((y / 6) & 1) * 8; x < ox + iw; x += 16) g.fillRect(x, y, 1, 6); }
    g.fillStyle = '#5c301a'; g.fillRect(ox, oy - 1, iw, 1); g.fillRect(ox - 1, oy - TOP, 1, ih + TOP); g.fillRect(ox + iw, oy - TOP, 1, ih + TOP); g.fillRect(ox, oy + ih, iw, 1);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(ox, oy, iw, 4); g.fillRect(ox, oy, 3, ih); g.fillRect(ox + iw - 3, oy, 3, ih);
    g.fillStyle = '#ff7a2a';
    for (let i = 0; i < 90; i++) {
      const h = U.hash3(i, 7, seed) >>> 0, side = h & 3, k = ((h >>> 2) % 1000) / 1000, j = h >>> 12;
      const x = side < 2 ? ox + k * iw : side === 2 ? 2 + (j % (m - 4)) : ox + iw + 2 + (j % (m - 4)), y = side === 0 ? oy - TOP + 1 + (j % (TOP - 2)) : side === 1 ? oy + ih + 2 + (j % (m - 4)) : oy + k * ih;
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    // corner columns and candles on the top wall
    for (const pt of [[ox + 12, oy + 14], [ox + iw - 12, oy + 14], [ox + 12, oy + ih - 4], [ox + iw - 12, oy + ih - 4]]) At.draw(g, 'prop.pillar', 0, pt[0], pt[1]);
    for (let x = ox + 60, i = 0; x < ox + iw - 40; x += 120, i++) At.draw(g, 'deco.candle.' + (i & 3), 0, x, oy - 2);
    return cv;
  }
  function drawRoom(B, Rm, seed, t) {
    if (!ED.Atlas.ok) return;
    if (roomRef !== Rm) { roomRef = Rm; roomCv = bakeRoom(Rm, seed); }
    const m = C.SANCTUM.wall;
    B.img(roomCv, Rm.x0 - m, Rm.y0 - m - TOP, roomCv.width, roomCv.height);
    for (let x = Rm.x0 + 60, i = 0; x < Rm.x1 - 40; x += 120, i++) { const fl = 0.5 + 0.5 * Math.sin(t * 8 + i * 1.7) * Math.sin(t * 4.3 + i); B.circ(x, Rm.y0 - 10, 9 + fl * 3, (0xff8a3a00 | Math.round(22 + 22 * fl)) >>> 0, 0); }
  }
  // Fade to black over the second half of the entry fade (st 0), back in over ROOM_IN s after the teleport (st 1+).
  function roomFade(B, S, t, x, y) {
    const F = C.SANCTUM.fade, k = S.st === 0 ? U.clamp((t - (S.t0 - F / 2)) / (F / 2), 0, 1) : 1 - U.clamp((t - S.t0) / ROOM_IN, 0, 1);
    if (k > 0.01) B.rect(x, y, R.bw, R.bh, Math.round(k * 255) >>> 0);
  }

  // ---------------- view rect ----------------
  let vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0;
  const inView = (o) => o.x >= vx0 && o.x <= vx1 && o.y >= vy0 && o.y <= vy1;
  const zoneInView = (z) => {
    if (z.len > 0) { const ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len, m = z.w || 0; return Math.max(z.x, ex) + m >= vx0 && Math.min(z.x, ex) - m <= vx1 && Math.max(z.y, ey) + m >= vy0 && Math.min(z.y, ey) - m <= vy1; }
    const r = z.r || 0; return z.x + r >= vx0 && z.x - r <= vx1 && z.y + r >= vy0 && z.y - r <= vy1;
  };

  // ---------------- zones ----------------
  const ZCOL = { fire: 0xff8a3d, meteor: 0xff6a2a, holy: 0xffe08a, poison: 0x7fe39a, arrows: 0xd8d0c0, web: 0xe8e8f0, frost: 0x9fdcff, dot: 0xffffff };
  const hostile = (z) => z.warn && z.team === 1;
  // Own-team zones covering more than ZFADE of the view fade together (alpha sqrt(ZFADE / coverage), floor 0.4) so heroes, foes and telegraphs stay readable.
  const ZFADE = 0.6, PI = Math.PI;
  const zoneArea = (z) => (z.len > 0 ? z.len * (z.w || 0) : z.arc > 0 ? z.r * z.r * z.arc / 2 : PI * z.r * z.r);
  // Ground pass. Hostile telegraph: dark-red fill that brightens toward resolve plus a growing progress fill (outline drawn by drawTele over the actors).
  function drawZone(B, z, t) {
    const fx = ED.WeaponFx[z.wid] || ED.SkillFx[z.wid];
    if (fx && fx.zone && fx.zone(B, z, t)) return;
    const zf = ED.ZoneFx && ED.ZoneFx[z.k]; if (zf && zf(B, z, t)) return; // look-keyed draw (boss zones carry no weapon id)
    const k = z.dur > 0 ? U.clamp(z.t / z.dur, 0, 1) : 0;
    if (hostile(z)) {
      if (z.k === 'aim' || z.k === 'dash') return; // ranged aim line / charge-dive lane: drawn only by drawTele (no ground fill)
      const pulse = 0.5 + 0.5 * Math.sin(t * 18), fill = (0xff302000 | Math.round(60 + 70 * k + 30 * pulse)) >>> 0, prog = (0xff8a5a00 | Math.round(90 + 60 * k)) >>> 0;
      if (z.len > 0) {
        const ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len;
        B.line(z.x, z.y, ex, ey, z.w, fill);
        B.line(z.x, z.y, z.x + (ex - z.x) * k, z.y + (ey - z.y) * k, Math.max(1, z.w * 0.4), prog);
      } else if (z.arc > 0) { B.cone(z.x, z.y, z.r, z.a, z.arc, fill, 0); B.cone(z.x, z.y, z.r * k, z.a, z.arc, prog, 0); }
      else { B.circ(z.x, z.y, z.r, fill, 0); B.circ(z.x, z.y, z.r * k, prog, 0); }
      return;
    }
    const col = ZCOL[z.k] !== undefined ? ZCOL[z.k] : 0xffffff, a = z.warn ? Math.round(60 + 80 * k) : 46;
    if (z.len > 0) B.line(z.x, z.y, z.x + Math.cos(z.a) * z.len, z.y + Math.sin(z.a) * z.len, z.w, ((col << 8) | a) >>> 0);
    else if (z.arc > 0) B.cone(z.x, z.y, z.r, z.a, z.arc, ((col << 8) | a) >>> 0, 0);
    else { B.circ(z.x, z.y, z.r, ((col << 8) | a) >>> 0, 0); B.circ(z.x, z.y, z.r, ((col << 8) | 140) >>> 0, 1); }
  }
  // Top pass for hostile telegraphs, over the horde: a pulsing translucent fill and a bright 2 px outline, so the area reads through hundreds of foes.
  // Look 'aim' (ranged foe lane): a steady 1 px line from the shooter along z.a, growing 35% -> 100% of z.len over the wind-up, alpha 120 -> 170, a 3 px tick at its tip.
  // Look 'dash' (charge / dive lane): two 1 px edge lines, alpha 100 -> 160 over the wind-up, and a centre progress line (width max(1, z.w / 4), alpha 90) out to k x len; no pulse, no end caps.
  // 'aim' and 'dash' draw under the projectiles (lowTele), every other hostile telegraph over them.
  const lowTele = (z) => z.k === 'aim' || z.k === 'dash';
  function drawTele(B, z, t) {
    const k = z.dur > 0 ? U.clamp(z.t / z.dur, 0, 1) : 0;
    if (z.k === 'aim') {
      const L = z.len * (0.35 + 0.65 * k), ex = z.x + Math.cos(z.a) * L, ey = z.y + Math.sin(z.a) * L;
      B.line(z.x, z.y, ex, ey, 1, (0xff6a4a00 | Math.round(120 + 50 * k)) >>> 0);
      B.rect(Math.round(ex) - 1, Math.round(ey) - 1, 3, 3, (0xffa08a00 | Math.round(150 + 60 * k)) >>> 0);
      return;
    }
    if (z.k === 'dash') {
      const c = Math.cos(z.a), s = Math.sin(z.a), ex = z.x + c * z.len, ey = z.y + s * z.len, nx = -s * z.w / 2, ny = c * z.w / 2, edge = (0xff6a4a00 | Math.round(100 + 60 * k)) >>> 0;
      B.line(z.x + nx, z.y + ny, ex + nx, ey + ny, 1, edge); B.line(z.x - nx, z.y - ny, ex - nx, ey - ny, 1, edge);
      B.line(z.x, z.y, z.x + c * z.len * k, z.y + s * z.len * k, Math.max(1, z.w * 0.25), 0xff8a5a5a);
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 18);
    const veil = (0xff402800 | Math.round(28 + 34 * pulse + 30 * k)) >>> 0, edge = (0xff6a4a00 | Math.round(200 + 55 * pulse)) >>> 0, lw = 2 + k;
    if (z.len > 0) {
      const c = Math.cos(z.a), s = Math.sin(z.a), ex = z.x + c * z.len, ey = z.y + s * z.len, nx = -s * z.w / 2, ny = c * z.w / 2;
      B.line(z.x, z.y, ex, ey, z.w, veil);
      B.line(z.x + nx, z.y + ny, ex + nx, ey + ny, lw, edge); B.line(z.x - nx, z.y - ny, ex - nx, ey - ny, lw, edge);
      B.line(z.x + nx, z.y + ny, z.x - nx, z.y - ny, lw, edge); B.line(ex + nx, ey + ny, ex - nx, ey - ny, lw, edge);
    } else if (z.arc > 0) { B.cone(z.x, z.y, z.r, z.a, z.arc, veil, 0); B.cone(z.x, z.y, z.r, z.a, z.arc, edge, lw); }
    else { B.circ(z.x, z.y, z.r, veil, 0); B.circ(z.x, z.y, z.r, edge, lw); B.circ(z.x, z.y, Math.max(1, z.r * k), 0xffd0a0a0, 1); }
  }

  // ---------------- projectiles ----------------
  const PCOL = { orb: 0xe6c27aff, poison: 0x7fe39aff, holy: 0xffe08aff, fire: 0xff8a3dff, dot: 0xffffffff };
  const PO = { rot: 0, flip: false, alpha: 1, sx: 1, sy: 1 }, projId = new Map();
  function drawProj(B, pr, t) {
    const fx = ED.WeaponFx[pr.wid];
    if (fx && fx.proj && fx.proj(B, pr, t)) return;
    let id = projId.get(pr.k);
    if (id === undefined) { id = 'proj.' + pr.k; projId.set(pr.k, id); }
    PO.rot = pr.a;
    if (ED.Atlas.has(id)) { B.spr(id, ED.Atlas.frameAt(id, t), pr.x, pr.y, PO); return; }
    const col = PCOL[pr.k] || (pr.team ? 0xff5a4aff : 0xfff1d6ff);
    B.circ(pr.x, pr.y, Math.max(2, pr.r * 0.8), col, 0);
  }

  // ---------------- y-sort ----------------
  // items[0..n) sorted by y: 16-bit keys (half-px steps from the view top), two stable 8-bit LSD radix passes over typed arrays (no per-frame allocation).
  const items = [];
  let cap = 0, kA = null, kB = null, iA = null, iB = null;
  const cnt = new Uint32Array(256);
  function sortCap(n) {
    if (n <= cap) return;
    cap = Math.max(1024, 1 << Math.ceil(Math.log2(n)));
    kA = new Uint16Array(cap); kB = new Uint16Array(cap); iA = new Uint32Array(cap); iB = new Uint32Array(cap);
  }
  function radix(n, shift, ks, is, kd, id) {
    cnt.fill(0);
    for (let i = 0; i < n; i++) cnt[(ks[i] >> shift) & 255]++;
    for (let i = 0, s = 0; i < 256; i++) { const c = cnt[i]; cnt[i] = s; s += c; }
    for (let i = 0; i < n; i++) { const d = cnt[(ks[i] >> shift) & 255]++; kd[d] = ks[i]; id[d] = is[i]; }
  }
  function ysort(n) {
    sortCap(n);
    for (let i = 0; i < n; i++) { const q = (items[i].y - vy0) * 2; kA[i] = q <= 0 ? 0 : q >= 65535 ? 65535 : q | 0; iA[i] = i; }
    radix(n, 0, kA, iA, kB, iB); radix(n, 8, kB, iB, kA, iA);
  }

  // ---------------- frame ----------------
  R.frame = (view, dt) => {
    const t0 = performance.now(), B = ED.Batch, P = ED.Post, t = view.time;
    frameN++;
    const sd = ED.STAGES[view.stage] || ED.STAGES[0], room = (view.props && view.props.room) || null;
    if (sd.id !== stageId || view.props !== arenaRef || room !== roomOn) {
      stageId = sd.id; theme = sd.theme; arenaRef = view.props; roomOn = room; chunks.clear(); roomRef = null;
      bgHex = room ? ROOM_BG : parseInt(theme.pal.bg.slice(1), 16); bgCss = room ? ROOM_PAL.bg : theme.pal.bg; wallRgba = (parseInt(theme.pal.wall.slice(1), 16) * 256 + 255) >>> 0;
      PO_ARGS.biome = room ? { id: 'sanctum', pal: ROOM_PAL } : { id: sd.id, pal: theme.pal };
    }
    const me = view.me, A = view.props;
    if (me) { R.camX = Math.round(me.x) - (R.bw >> 1); R.camY = Math.round(me.y) - 10 - (R.bh >> 1); } // whole world px, a fixed offset from the hero's drawn px: the hero never jitters against the screen
    if (room) { // Sanctum: the camera stays on the room and its walls (centred on an axis the view already covers)
      const m = C.SANCTUM.wall + 6, lx = room.x0 - m, hx = room.x1 + m - R.bw, ly = room.y0 - m - TOP, hy = room.y1 + m - R.bh;
      R.camX = hx > lx ? U.clamp(R.camX, lx, hx) : Math.round((room.x0 + room.x1 - R.bw) / 2);
      R.camY = hy > ly ? U.clamp(R.camY, ly, hy) : Math.round((room.y0 + room.y1 - TOP - R.bh) / 2);
    }
    ED.FX.shakeXY(SH);
    const cx = R.camX + Math.round(SH.x), cy = R.camY + Math.round(SH.y);
    const postOk = R.quality === 'high' && P && P.ready && !P.soft;
    const gpu = R.gpu = postOk && B.use('gl');
    if (!gpu) B.use('2d');
    B.size(R.bw, R.bh);
    B.begin(cx, cy, 1, bgHex);
    if (room) drawRoom(B, room, view.seed | 0, t); else drawFloor(B, A, view.seed | 0, cx, cy);
    vx0 = cx - 48; vy0 = cy - 48; vx1 = cx + R.bw + 48; vy1 = cy + R.bh + 64;
    const zones = view.zones;
    let tele = 0, zn = 0, za = 0;
    for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (z.dead || !zoneInView(z)) continue; if (z.team === 1) { if (hostile(z)) tele++; } else { zn++; za += zoneArea(z); } }
    const zl = za / (R.bw * R.bh), zf = zl <= ZFADE ? 1 : Math.max(0.4, Math.sqrt(ZFADE / zl));
    B.zoneLoad = zl; B.zoneN = zn; B.zoneLite = !gpu && (zl > 1 || zn > 40); B.zoneUnion = B.zoneLite && !!(P && P.soft); // 2D zone LOD: the hooks draw a fill + rim through B.zcirc (union per colour at B.zflush on a software canvas)
    const Cs = ED.Cos;
    if (Cs) Cs.frame(view);
    if (zn) { if (zf < 1) B.fade(zf); for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (!z.dead && z.team !== 1 && zoneInView(z)) { if (Cs) Cs.tint(Cs.zoneTint(z)); drawZone(B, z, t); } } if (Cs) Cs.tint(''); B.zflush(); if (zf < 1) B.fade(1); }
    for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (!z.dead && z.team === 1 && zoneInView(z)) drawZone(B, z, t); }
    const pk = view.pickups;
    for (let i = 0; i < pk.length; i++) { const g = pk[i]; if (!g.dead && inView(g)) ED.Actors.pickup(B, g, t); }
    // actors
    let n = 0, crowd = 0;
    const foes = view.foes, heroes = view.heroes;
    for (let i = 0; i < foes.length; i++) { const e = foes[i]; if (!e.dead && inView(e)) { items[n++] = e; crowd++; } }
    B.crowd = crowd; R.crowd = crowd;
    for (let i = 0; i < heroes.length; i++) { const p = heroes[i]; if (!p.dead && inView(p)) items[n++] = p; }
    if (!room) { for (const o of A.obstacles) if (inView(o)) items[n++] = o; for (const b of A.braziers) if (inView(b)) items[n++] = b; }
    const ZA = ED.ZoneActor;
    for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (!z.dead && ZA[z.k] && inView(z)) items[n++] = z; } // zones with a body (minions): ED.ZoneActor[look](B, z, t)
    if (items.length > n) items.length = n;
    ysort(n);
    for (let i = 0; i < n; i++) {
      const a = items[iA[i]];
      if (a.def) ED.Actors.foe(B, a, t, heroes);
      else if (a.pid !== undefined) { ED.Actors.hero(B, a, t, heroes.length > 1); const h = ED.HeroFx && ED.HeroFx[a.cls]; if (h) { if (Cs) Cs.tint(Cs.heroTint(a)); h(B, a, t); if (Cs) Cs.tint(''); } }
      else if (a.dur !== undefined) { if (Cs) Cs.tint(Cs.zoneTint(a)); ED.ZoneActor[a.k](B, a, t); if (Cs) Cs.tint(''); }
      else if (a.hp !== undefined) ED.Actors.brazier(B, a, t);
      else ED.Actors.obstacle(B, a, wallRgba);
    }
    if (tele) for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (!z.dead && hostile(z) && lowTele(z) && zoneInView(z)) drawTele(B, z, t); }
    const prs = view.projs;
    for (let i = 0; i < prs.length; i++) { const pr = prs[i]; if (!pr.dead && inView(pr)) { if (Cs) Cs.tint(Cs.projTint(pr)); drawProj(B, pr, t); } }
    if (Cs) Cs.tint('');
    for (let i = 0; i < zones.length; i++) { // zone overlays above actors (own-team ones share the zone fade)
      const z = zones[i]; if (z.dead || !zoneInView(z)) continue;
      const h = ED.WeaponFx[z.wid] || ED.SkillFx[z.wid]; if (!h || !h.top) continue;
      const f = z.team === 1 ? 1 : zf; if (f < 1) B.fade(f); if (Cs) Cs.tint(Cs.zoneTint(z)); h.top(B, z, t); if (f < 1) B.fade(1);
    }
    if (Cs) Cs.tint('');
    ED.FX.draw(B, t);
    if (tele) for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (!z.dead && hostile(z) && !lowTele(z) && zoneInView(z)) drawTele(B, z, t); }
    const busy = heroes.length === 1 && (tele > 0 || zl > 0.5 || crowd > 150);
    for (let i = 0; i < heroes.length; i++) { const p = heroes[i]; if (!p.dead && inView(p)) ED.Actors.heroTop(B, p, t, p === me, busy); } // hero markers over FX and telegraphs
    // overlays: name tags (co-op, or a solo hero wearing a title / name colour), revive bars (co-op), elite HP bars
    const coopN = heroes.length > 1;
    for (const p of heroes) {
      if (p.dead || !inView(p) || !(coopN || (Cs && Cs.tagged(p.pid)))) continue;
      if (Cs) Cs.nameTag(B, p, p === me, t); else B.text(p.name, p.x, p.y - 30, p === me ? 0xfff1d6 : 0xb8d8ff, 1);
      if (coopN && p.downed) { B.rect(p.x - 12, p.y - 24, 24, 3, 0x000000aa); B.rect(p.x - 12, p.y - 24, 24 * p.revive, 3, 0x7fe39aff); }
    }
    for (let i = 0; i < n; i++) { const e = items[i]; if (e.def && e.elite && e.hpQ < 255) { const w = 24; B.rect(e.x - w / 2, e.y - e.r * 2 - 8, w, 2, 0x000000aa); B.rect(e.x - w / 2, e.y - e.r * 2 - 8, w * e.hpQ / 255, 2, 0xffc94aff); } }
    if (view.sanctum) roomFade(B, view.sanctum, t, cx, cy);
    ED.FX.drawTop(B);
    B.end();
    // present
    const usePost = R.usePost = postOk;
    const ctx = R.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let shown = false;
    if (usePost) {
      ctx.clearRect(0, 0, R.canvas.width, R.canvas.height);
      P.setVisible(true);
      PO_ARGS.t = t; PO_ARGS.scale = R.scale; PO_ARGS.tex = gpu ? B.out.tex : null;
      shown = P.render(gpu ? null : R.buf, PO_ARGS);
    }
    if (!shown) {
      if (P && P.setVisible) P.setVisible(false);
      R.usePost = false;
      if (!gpu) { // the opaque buffer covers the canvas (bw * scale >= width); the bg fill only runs when it does not
        if (R.bw * R.scale < R.canvas.width || R.bh * R.scale < R.canvas.height) { ctx.fillStyle = bgCss; ctx.fillRect(0, 0, R.canvas.width, R.canvas.height); }
        ctx.imageSmoothingEnabled = false; ctx.drawImage(R.buf, 0, 0, R.bw * R.scale, R.bh * R.scale);
      }
    }
    if (ED.Atlas.tick) ED.Atlas.tick(1);
    if (ED.Bmp) ED.Bmp.sweep();
    R.ms = performance.now() - t0;
  };
})(globalThis.ED || (globalThis.ED = {}));
