// Frame renderer (client only). Draws ED.Game.view into a world buffer (1 buffer px = 1 world px) through ED.Batch, then presents it to the screen canvas
// (WebGL post when ready and quality is high, else a nearest-neighbour 2D blit), integer-scaled so about VIEW_W x VIEW_H world px are visible. HUD draws on top (hud.js).
// Layer order (ARCHITECTURE §10): floor chunks -> zones / telegraphs -> pickups -> y-sorted actors (heroes, foes, bosses, obstacles, braziers) -> projectiles -> FX -> overlays (numbers, bars).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU;
  const R = ED.Render = { canvas: null, ctx: null, buf: null, bctx: null, dpr: 1, scale: 3, bw: 640, bh: 360, camX: 0, camY: 0, quality: 'high', usePost: false, ms: 0 };
  const CHUNK = 256, TILE = 16;
  let theme = null, stageId = '', chunks = new Map(), frameN = 0, arenaRef = null;
  const SH = { x: 0, y: 0 };

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
  function drawFloor(B, A, seed) {
    if (!ED.Atlas.ok) return;
    const c0 = Math.floor(R.camX / CHUNK), c1 = Math.floor((R.camX + R.bw) / CHUNK), r0 = Math.floor(R.camY / CHUNK), r1 = Math.floor((R.camY + R.bh) / CHUNK);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      if (cx * CHUNK >= A.size || cy * CHUNK >= A.size || (cx + 1) * CHUNK <= 0 || (cy + 1) * CHUNK <= 0) continue;
      const k = cx + ',' + cy;
      let ch = chunks.get(k);
      if (!ch) { ch = bakeChunk(cx, cy, A, seed); chunks.set(k, ch); }
      ch.used = frameN;
      B.img(ch.cv, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
    }
    if (chunks.size > 40) for (const [k, ch] of chunks) if (frameN - ch.used > 120) chunks.delete(k);
  }

  // ---------------- zones ----------------
  const ZCOL = { fire: 0xff8a3d, meteor: 0xff6a2a, holy: 0xffe08a, poison: 0x7fe39a, arrows: 0xd8d0c0, web: 0xe8e8f0, frost: 0x9fdcff, dot: 0xffffff };
  function drawZone(B, z, t) {
    const fx = ED.WeaponFx[z.wid] || ED.SkillFx[z.wid];
    if (fx && fx.zone && fx.zone(B, z, t)) return;
    const k = z.dur > 0 ? U.clamp(z.t / z.dur, 0, 1) : 0;
    if (z.warn && z.team === 1) { // hostile telegraph: bright outline + filling pulse
      const pulse = 0.5 + 0.5 * Math.sin(t * 18), fill = (0xff302000 | Math.round(50 + 70 * k + 30 * pulse)) >>> 0, edge = (0xff5a3a00 | Math.round(200 + 55 * pulse)) >>> 0;
      if (z.len > 0) {
        const ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len, nx = -Math.sin(z.a) * z.w / 2, ny = Math.cos(z.a) * z.w / 2;
        B.line(z.x, z.y, ex, ey, z.w, fill);
        B.line(z.x + nx, z.y + ny, ex + nx, ey + ny, 1, edge); B.line(z.x - nx, z.y - ny, ex - nx, ey - ny, 1, edge);
        B.line(z.x, z.y, z.x + (ex - z.x) * k, z.y + (ey - z.y) * k, Math.max(1, z.w * 0.3), (0xff8a5a00 | 160) >>> 0);
      } else if (z.arc > 0) { B.cone(z.x, z.y, z.r, z.a, z.arc, fill, 0); B.cone(z.x, z.y, z.r, z.a, z.arc, edge, 1.5); B.cone(z.x, z.y, z.r * k, z.a, z.arc, 0xff8a5a70, 0); }
      else { B.circ(z.x, z.y, z.r, fill, 0); B.circ(z.x, z.y, z.r, edge, 1.5); B.circ(z.x, z.y, z.r * k, 0xff8a5a60, 0); }
      return;
    }
    const col = ZCOL[z.k] !== undefined ? ZCOL[z.k] : 0xffffff, a = z.warn ? Math.round(60 + 80 * k) : 46;
    if (z.len > 0) B.line(z.x, z.y, z.x + Math.cos(z.a) * z.len, z.y + Math.sin(z.a) * z.len, z.w, ((col << 8) | a) >>> 0);
    else if (z.arc > 0) B.cone(z.x, z.y, z.r, z.a, z.arc, ((col << 8) | a) >>> 0, 0);
    else { B.circ(z.x, z.y, z.r, ((col << 8) | a) >>> 0, 0); B.circ(z.x, z.y, z.r, ((col << 8) | 140) >>> 0, 1); }
  }

  // ---------------- projectiles ----------------
  const PCOL = { orb: 0xe6c27aff, poison: 0x7fe39aff, holy: 0xffe08aff, fire: 0xff8a3dff, dot: 0xffffffff };
  const PO = { rot: 0, flip: false, alpha: 1, sx: 1, sy: 1 };
  function drawProj(B, pr, t) {
    const fx = ED.WeaponFx[pr.wid];
    if (fx && fx.proj && fx.proj(B, pr, t)) return;
    const id = 'proj.' + pr.k;
    PO.rot = pr.a;
    if (ED.Atlas.has(id)) { B.spr(id, ED.Atlas.frameAt(id, t), pr.x, pr.y, PO); return; }
    const col = PCOL[pr.k] || (pr.team ? 0xff5a4aff : 0xfff1d6ff);
    B.circ(pr.x, pr.y, Math.max(2, pr.r * 0.8), col, 0);
  }

  // ---------------- frame ----------------
  const sortBuf = [];
  const byY = (a, b) => a.y - b.y;
  R.frame = (view, dt) => {
    const t0 = performance.now(), B = ED.Batch, t = view.time;
    frameN++;
    const sd = ED.STAGES[view.stage] || ED.STAGES[0];
    if (sd.id !== stageId || view.props !== arenaRef) { stageId = sd.id; theme = sd.theme; arenaRef = view.props; chunks.clear(); }
    const me = view.me, A = view.props;
    if (me) { R.camX = Math.round(me.x - R.bw / 2); R.camY = Math.round(me.y - 10 - R.bh / 2); }
    ED.FX.shakeXY(SH);
    const cx = R.camX + Math.round(SH.x), cy = R.camY + Math.round(SH.y);
    const bg = U.hexToRgb(theme.pal.bg);
    R.bctx.setTransform(1, 0, 0, 1, 0, 0); R.bctx.fillStyle = theme.pal.bg; R.bctx.fillRect(0, 0, R.bw, R.bh);
    B.begin(cx, cy, 1);
    drawFloor(B, A, view.seed | 0);
    const vx0 = cx - 48, vy0 = cy - 48, vx1 = cx + R.bw + 48, vy1 = cy + R.bh + 64, inView = (o) => o.x >= vx0 && o.x <= vx1 && o.y >= vy0 && o.y <= vy1;
    for (const z of view.zones) if (!z.dead && (z.len > 0 || inView(z) || z.r > 200)) drawZone(B, z, t);
    for (const g of view.pickups) if (!g.dead && inView(g)) ED.Actors.pickup(B, g, t);
    // actors
    sortBuf.length = 0;
    let crowd = 0;
    for (const e of view.foes) if (!e.dead && inView(e)) { sortBuf.push(e); crowd++; }
    B.crowd = crowd; R.crowd = crowd;
    for (const p of view.heroes) if (!p.dead) sortBuf.push(p);
    for (const o of A.obstacles) if (inView(o)) sortBuf.push(o);
    for (const b of A.braziers) if (!b.broken && inView(b)) sortBuf.push(b);
    sortBuf.sort(byY);
    const wall = (parseInt(theme.pal.wall.slice(1), 16) * 256 + 255) >>> 0;
    for (let i = 0; i < sortBuf.length; i++) {
      const a = sortBuf[i];
      if (a.def) ED.Actors.foe(B, a, t, view.heroes);
      else if (a.pid !== undefined) { ED.Actors.hero(B, a, t); const h = ED.HeroFx && ED.HeroFx[a.cls]; if (h) h(B, a, t); }
      else if (a.hp !== undefined) ED.Actors.brazier(B, a, t);
      else ED.Actors.obstacle(B, a, wall);
    }
    for (const pr of view.projs) if (!pr.dead && inView(pr)) drawProj(B, pr, t);
    for (const z of view.zones) if (!z.dead && (z.len > 0 || inView(z) || z.r > 200)) { const zf = ED.WeaponFx[z.wid] || ED.SkillFx[z.wid]; if (zf && zf.top) zf.top(B, z, t); } // zone overlays above actors
    ED.FX.draw(B, t);
    // overlays: hero names / HP / revive bars (co-op), elite HP bars
    if (view.heroes.length > 1) for (const p of view.heroes) {
      if (p.dead) continue;
      B.text(p.name, p.x, p.y - 30, p === me ? 0xfff1d6 : 0xb8d8ff, 1);
      if (p.downed) { B.rect(p.x - 12, p.y - 24, 24, 3, 0x000000aa); B.rect(p.x - 12, p.y - 24, 24 * p.revive, 3, 0x7fe39aff); }
    }
    for (const e of sortBuf) if (e.def && e.elite && e.hpQ < 255) { const w = 24; B.rect(e.x - w / 2, e.y - e.r * 2 - 8, w, 2, 0x000000aa); B.rect(e.x - w / 2, e.y - e.r * 2 - 8, w * e.hpQ / 255, 2, 0xffc94aff); }
    ED.FX.drawTop(B);
    B.end();
    // present
    const usePost = R.quality === 'high' && ED.Post && ED.Post.ready && !ED.Post.soft;
    R.usePost = usePost;
    const ctx = R.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (usePost) {
      ctx.clearRect(0, 0, R.canvas.width, R.canvas.height);
      ED.Post.setVisible(true);
      ED.Post.render(R.buf, { biome: { id: sd.id, pal: theme.pal }, t, scale: R.scale, fx: 0, fy: 0, aberr: 0, flash: [0, 0, 0, 0] });
    } else {
      if (ED.Post && ED.Post.setVisible) ED.Post.setVisible(false);
      ctx.fillStyle = 'rgb(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ')'; ctx.fillRect(0, 0, R.canvas.width, R.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(R.buf, 0, 0, R.bw * R.scale, R.bh * R.scale);
    }
    if (ED.Atlas.tick) ED.Atlas.tick(1);
    if (ED.Bmp) ED.Bmp.sweep();
    R.ms = performance.now() - t0;
  };
})(globalThis.ED || (globalThis.ED = {}));
