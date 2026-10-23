// Room pre-rendering: each room's floor, walls, hazards and decor are painted once into an offscreen canvas at the
// current zoom, so a frame costs a single blit. A second canvas holds the emissive details (lava, runes,
// fungus, inlay, stars) that the renderer adds after lighting so bloom catches them. Palettes and decor change per stratum.
// With the pixel-art atlas (ED.Atlas) rooms are built from recoloured tile art (paintArt); without it the procedural painter (paint) runs.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, Bmp = ED.Bmp;
  const Tl = ED.Tiles = { ms: 0, paints: 0, lastMs: 0 };
  const cache = new Map();
  let NOISE = null;
  // Painted canvases are swapped for ImageBitmaps once ready (a bitmap keeps the canvas's .px); evicted entries release theirs.
  const release = (e) => { e.dead = true; Bmp.free(e.canvas); Bmp.free(e.emis); Bmp.free(e.glowmap); Bmp.free(e.hz); };
  const LIFT = { ossuary: 0.55, glowmire: 0.55, rimefrost: 0, cinderforge: 0.55, sanctum: 0.5, abyss: 0.6 };

  Tl.clear = () => { for (const e of cache.values()) release(e); cache.clear(); };

  let lastRoom = null, lastScale = 0, lastArt = false, lastE = null; // memo of the previous lookup (several calls per frame)
  function entry(room, scale) {
    const art = artOn();
    if (room === lastRoom && scale === lastScale && art === lastArt && lastE && !lastE.dead) return lastE;
    const key = room.stratum + ':' + room.seed + ':' + scale.toFixed(3) + (art ? 'a' : '');
    let e = cache.get(key);
    if (!e) {
      const t0 = performance.now();
      e = art ? paintArt(room, scale) : paint(room, scale);
      Tl.lastMs = performance.now() - t0; Tl.ms += Tl.lastMs; Tl.paints++;
      cache.set(key, e);
      for (const k of ['canvas', 'emis', 'glowmap', 'hz']) { const cv = e[k]; if (cv) Bmp.from(cv, (b) => { if (e.dead) Bmp.free(b); else { b.px = cv.px; e[k] = b; } }); }
      if (cache.size > 4) { const old = cache.keys().next().value; release(cache.get(old)); cache.delete(old); }
    }
    lastRoom = room; lastScale = scale; lastArt = art; lastE = e;
    return e;
  }
  Tl.get = (room, scale) => entry(room, scale).canvas;
  // Emissive canvas (half resolution); `px` is its pixels per world unit. Draw additively after lighting.
  Tl.emissive = (room, scale) => entry(room, scale).emis;
  // Low-res light contribution of large glowing surfaces (lava, slime, void); added to the light buffer so entities standing on them are lit, not overpainted.
  Tl.glowmap = (room, scale) => entry(room, scale).glowmap;

  const tileAt = (room, x, y) => (x < 0 || y < 0 || x >= room.w || y >= room.h) ? 1 : room.tiles[y * room.w + x];
  const isWall = (t) => t === 1;
  // Deterministic per-tile hash so patterns stay continuous across neighbours regardless of paint order.
  const hash = (a, b, n) => { let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(n, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  function noiseCanvas() {
    if (NOISE) return NOISE;
    const cv = NOISE = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'), img = g.createImageData(128, 128), rng = U.RNG(0x5eed), d = img.data;
    for (let i = 0; i < 128 * 128; i++) {
      const r = rng.next();
      if (r < 0.2) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 10 + rng.next() * 22; }
      else if (r < 0.5) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0; d[i * 4 + 3] = 12 + rng.next() * 30; }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  const grain = (c, x, y, w, h, a, rng) => { c.globalAlpha = a; c.drawImage(noiseCanvas(), rng.next() * (128 - w) | 0, rng.next() * (128 - h) | 0, w, h, x, y, w, h); c.globalAlpha = 1; };
  // Soft emissive blob via the renderer's cached glow sprites.
  const glow = (e, x, y, r, col, a) => { e.globalAlpha = a; e.drawImage(ED.Render.glowSprite(col), x - r, y - r, r * 2, r * 2); e.globalAlpha = 1; };

  function paint(room, scale) {
    const biome = ED.biomeFor(room.stratum), P = biome.pal;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(room.w * T * scale); cv.height = Math.ceil(room.h * T * scale);
    const c = cv.getContext('2d');
    c.scale(scale, scale);
    const es = scale, ev = document.createElement('canvas');
    ev.width = Math.ceil(room.w * T * es); ev.height = Math.ceil(room.h * T * es); ev.px = es;
    const e = ev.getContext('2d');
    e.scale(es, es); e.globalCompositeOperation = 'lighter'; e.lineCap = 'round'; e.lineJoin = 'round';
    const gs = scale * 0.5, gv = document.createElement('canvas');
    gv.width = Math.ceil(room.w * T * gs); gv.height = Math.ceil(room.h * T * gs); gv.px = gs;
    const g = gv.getContext('2d'); g.scale(gs, gs); g.globalCompositeOperation = 'lighter';
    const rng = U.RNG(room.seed ^ 0x7111e);
    const ao = U.shade(P.wallShadow, -0.45);
    // ---- floor ----
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 1) continue;
      floorTile(c, e, biome, P, x, y, rng, t === 5, room);
    }
    mottle(c, room, biome, P, rng);
    // hazard & chasm tiles
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 4) hazardTile(c, e, g, biome, P, room, x, y, rng);
      if (t === 3) chasmTile(c, g, biome, P, room, x, y, rng);
    }
    // decor (under walls so shadows sit on top)
    for (const d of room.decor) decor(c, e, biome, P, d.k, d.x * T, d.y * T, d.v, d.s);
    // floor albedo lift (the lighting multiply can only darken): add a scaled copy of the floor onto itself
    const lift = LIFT[biome.id] || 0;
    if (lift > 0) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'lighter'; c.globalAlpha = lift; c.drawImage(cv, 0, 0); c.restore(); }
    // ambient occlusion cast onto the floor by walls and blocks
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 1 || t === 3) continue;
      occlusion(c, room, biome, ao, x, y, t);
    }
    // ---- walls & blocks ----
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 1) wallTile(c, e, biome, P, room, x, y, rng);
      else if (t === 2) blockTile(c, e, biome, P, room, x, y, rng);
    }
    // door frames
    for (const d in room.doors) if (room.doors[d] >= 0) doorFrame(c, e, biome, P, room, d);
    // torch sconces
    for (const tc of room.torches) sconce(c, e, P, tc.x * T, tc.y * T);
    // dark frame on the outer edge of the room
    const fg = c.createLinearGradient(0, 0, 0, 10); fg.addColorStop(0, 'rgba(0,0,0,0.5)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fg; c.fillRect(0, 0, room.w * T, 10);
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, room.w * T - 3, room.h * T - 3);
    return { canvas: cv, emis: ev, glowmap: gv, statics: breakStatics(room, biome, P, false) };
  }

  // ---------- floor ----------
  function slab(c, x, y, w, h, col) {
    c.fillStyle = col; c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x, y, w, h * 0.45);
    c.fillStyle = 'rgba(0,0,0,0.07)'; c.fillRect(x, y + h * 0.62, w, h * 0.38);
    c.fillStyle = 'rgba(255,255,255,0.11)'; c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
    c.fillStyle = 'rgba(0,0,0,0.24)'; c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
  }
  function crack(c, x, y, rng, col, hi) {
    const x0 = x + 4 + rng.next() * 8, y0 = y + 4 + rng.next() * 8;
    const pts = [[x0, y0]]; let a = rng.next() * 6.28;
    for (let i = 0; i < 4; i++) { a += (rng.next() - 0.5) * 1.6; const l = 4 + rng.next() * 6, p = pts[pts.length - 1]; pts.push([p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l]); }
    c.lineWidth = 1; c.strokeStyle = col; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    if (hi) { c.strokeStyle = hi; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0] + 0.8, p[1] + 0.8) : c.moveTo(p[0] + 0.8, p[1] + 0.8)); c.stroke(); }
    return pts;
  }

  function floorTile(c, e, biome, P, tx, ty, rng, door, room) {
    const x = tx * T, y = ty * T, id = biome.id;
    const v = hash(tx, ty, 1), v2 = hash(tx, ty, 2), v3 = hash(tx, ty, 3), v4 = hash(tx, ty, 4);
    const base = U.shade(v < 0.5 ? P.floorA : P.floorB, (v2 - 0.5) * 0.14);
    c.fillStyle = P.grout; c.fillRect(x, y, T, T);
    if (v3 < 0.28) { const sp = 10 + v4 * 12 | 0; slab(c, x + 1, y + 1, sp - 1, T - 2, base); slab(c, x + sp + 1, y + 1, T - sp - 2, T - 2, U.shade(base, (hash(tx, ty, 5) - 0.5) * 0.09)); }
    else slab(c, x + 1, y + 1, T - 2, T - 2, base);
    grain(c, x, y, T, T, 0.8, rng);
    if (v4 > 0.82) { c.fillStyle = 'rgba(0,0,0,0.3)'; const q = v2 < 0.5 ? 0 : T - 4; c.beginPath(); c.moveTo(x + q, y + 1); c.lineTo(x + q + (q ? 3 : 4), y + 1); c.lineTo(x + q + (q ? 3 : 0), y + 5); c.fill(); }
    if (id === 'ossuary') {
      if (v > 0.965) { // bone rosette: four bones around a skull
        c.save(); c.translate(x + 16, y + 16); c.rotate(v2 * 1.5);
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.arc(0, 0, 11, 0, 7); c.fill();
        c.strokeStyle = U.rgba(P.accent2, 0.5); c.fillStyle = U.rgba(P.accent2, 0.5); c.lineWidth = 1.8; c.lineCap = 'round';
        for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.78; c.beginPath(); c.moveTo(Math.cos(a) * 4, Math.sin(a) * 4); c.lineTo(Math.cos(a) * 10, Math.sin(a) * 10); c.stroke(); c.beginPath(); c.arc(Math.cos(a) * 10, Math.sin(a) * 10, 1.4, 0, 7); c.fill(); }
        c.beginPath(); c.arc(0, 0, 3.4, 0, 7); c.fill(); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(-1.8, -0.8, 1.2, 1.4); c.fillRect(0.6, -0.8, 1.2, 1.4);
        c.restore();
      } else if (v3 > 0.84) { crack(c, x, y, rng, 'rgba(0,0,0,0.5)', 'rgba(255,255,255,0.07)'); }
      if (v2 > 0.86) { c.fillStyle = U.rgba(P.accent, 0.3); c.beginPath(); c.ellipse(x + 3 + v * 26, y + (v3 > 0.5 ? 2 : T - 3), 5 + v4 * 4, 2, 0, 0, 7); c.fill(); }
    } else if (id === 'glowmire') {
      if (v > 0.88) { c.fillStyle = U.rgba(P.accent, 0.12); c.beginPath(); c.ellipse(x + 16, y + 16, 12, 8, v2 * 3, 0, 7); c.fill(); glow(e, x + 16, y + 16, 15, P.accent, 0.12); }
      if (v2 > 0.8) { // wet sheen
        c.strokeStyle = 'rgba(190,230,255,0.13)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x + 5, y + 22); c.quadraticCurveTo(x + 14, y + 14, x + 27, y + 9); c.stroke();
      }
      if (v3 > 0.9) { crack(c, x, y, rng, 'rgba(0,0,0,0.45)'); }
      if (v4 > 0.94) { for (let i = 0; i < 2; i++) { const px = x + 3 + hash(tx, ty, 10 + i) * 26, py = y + 3 + hash(tx, ty, 20 + i) * 26; c.fillStyle = U.rgba(P.accent, 0.5); c.fillRect(px, py, 1.6, 1.6); glow(e, px + 0.8, py + 0.8, 4, P.accent, 0.4); } }
    } else if (id === 'rimefrost') {
      c.fillStyle = 'rgba(255,255,255,0.09)'; c.beginPath(); c.moveTo(x + 2, y + 30); c.lineTo(x + 12, y + 30); c.lineTo(x + 30, y + 12); c.lineTo(x + 30, y + 3); c.closePath(); c.fill();
      if (v > 0.72) { crack(c, x, y, rng, 'rgba(70,110,150,0.45)', 'rgba(255,255,255,0.5)'); }
      if (v2 > 0.86) { // frost crystal
        const cx = x + 6 + v3 * 20, cy = y + 6 + v4 * 20; c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 0.9; c.beginPath();
        for (let i = 0; i < 3; i++) { const a = i * 1.047 + v; c.moveTo(cx - Math.cos(a) * 3.5, cy - Math.sin(a) * 3.5); c.lineTo(cx + Math.cos(a) * 3.5, cy + Math.sin(a) * 3.5); } c.stroke();
        glow(e, cx, cy, 5, '#bff0ff', 0.4);
      }
    } else if (id === 'cinderforge') {
      c.fillStyle = 'rgba(0,0,0,0.38)'; for (const [a, b] of [[4, 4], [T - 6, 4], [4, T - 6], [T - 6, T - 6]]) { c.beginPath(); c.arc(x + a + 1, y + b + 1, 1.5, 0, 7); c.fill(); }
      c.fillStyle = 'rgba(255,255,255,0.13)'; for (const [a, b] of [[4, 4], [T - 6, 4], [4, T - 6], [T - 6, T - 6]]) c.fillRect(x + a, y + b, 1, 1);
      if (v > 0.9) { // glowing crack
        const pts = crack(c, x, y, rng, 'rgba(20,6,2,0.8)');
        c.strokeStyle = 'rgba(255,110,40,0.55)'; c.lineWidth = 0.8; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        e.strokeStyle = 'rgba(255,140,50,0.8)'; e.lineWidth = 1.2; e.beginPath(); pts.forEach((p, i) => i ? e.lineTo(p[0], p[1]) : e.moveTo(p[0], p[1])); e.stroke();
        glow(e, pts[2][0], pts[2][1], 12, '#ff7a2a', 0.22);
      } else if (v2 > 0.8) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(x + 8 + v3 * 16, y + 8 + v4 * 16, 7, 5, v, 0, 7); c.fill(); }
    } else if (id === 'sanctum') {
      // gold inlay: an inset frame and a central cross, with a diamond where lines meet
      const mx = room.w >> 1, my = (room.h >> 1) + 1;
      const rowBand = ((ty === 3 || ty === room.h - 3) && tx >= 2 && tx <= room.w - 3) || (ty === my && Math.abs(tx - mx) <= 3);
      const colBand = ((tx === 2 || tx === room.w - 3) && ty >= 3 && ty <= room.h - 3) || (tx === mx && Math.abs(ty - my) <= 3);
      c.fillStyle = 'rgba(232,198,107,0.5)'; e.fillStyle = 'rgba(255,214,110,0.2)';
      if (rowBand) { c.fillRect(x, y + 14.5, T, 2); c.fillStyle = 'rgba(255,240,170,0.45)'; c.fillRect(x, y + 14.5, T, 0.8); e.fillRect(x, y + 14.5, T, 2); }
      c.fillStyle = 'rgba(232,198,107,0.5)';
      if (colBand) { c.fillRect(x + 14.5, y, 2, T); c.fillStyle = 'rgba(255,240,170,0.45)'; c.fillRect(x + 14.5, y, 0.8, T); e.fillRect(x + 14.5, y, 2, T); }
      if ((rowBand && colBand) || (tx === mx && ty === my)) { c.fillStyle = '#d9b85a'; c.beginPath(); c.moveTo(x + 15.5, y + 7); c.lineTo(x + 24, y + 15.5); c.lineTo(x + 15.5, y + 24); c.lineTo(x + 7, y + 15.5); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 0.8; c.stroke(); glow(e, x + 15.5, y + 15.5, 13, '#ffd36b', 0.22); }
      if (v > 0.8) { c.strokeStyle = 'rgba(160,250,255,0.14)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + 4, y + 26); c.quadraticCurveTo(x + 14, y + 17, x + 28, y + 8); c.stroke(); }
      if (v2 > 0.9) { c.fillStyle = 'rgba(80,220,200,0.13)'; c.beginPath(); c.ellipse(x + 16, y + 17, 11, 6, v, 0, 7); c.fill(); }
    } else if (id === 'abyss') {
      c.fillStyle = U.rgba(P.accent, 0.05); c.fillRect(x + 1, y + 1, T - 2, 10);
      for (let i = 0; i < 6; i++) {
        const r = hash(tx, ty, 30 + i); if (r > 0.45) continue;
        const px = x + 2 + hash(tx, ty, 40 + i) * 28, py = y + 2 + hash(tx, ty, 50 + i) * 28, br = 0.35 + hash(tx, ty, 60 + i) * 0.65;
        c.fillStyle = `rgba(225,210,255,${0.25 * br})`; c.fillRect(px, py, 1, 1);
        e.fillStyle = `rgba(215,195,255,${0.55 * br})`; e.fillRect(px - 0.3, py - 0.3, 1.6, 1.6);
      }
      if (v > 0.972) { // rune circle
        const rcx = x + 16, rcy = y + 16;
        c.strokeStyle = U.rgba(P.accent, 0.35); c.lineWidth = 1; c.beginPath(); c.arc(rcx, rcy, 9, 0, 7); c.moveTo(rcx, rcy - 9); c.lineTo(rcx, rcy + 9); c.moveTo(rcx - 7, rcy - 3); c.lineTo(rcx + 7, rcy + 4); c.stroke();
        e.strokeStyle = U.rgba(P.accent, 0.6); e.lineWidth = 1.2; e.beginPath(); e.arc(rcx, rcy, 9, 0, 7); e.moveTo(rcx, rcy - 9); e.lineTo(rcx, rcy + 9); e.moveTo(rcx - 7, rcy - 3); e.lineTo(rcx + 7, rcy + 4); e.stroke();
        glow(e, rcx, rcy, 15, P.accent, 0.18);
      } else if (v2 > 0.92) { crack(c, x, y, rng, 'rgba(0,0,0,0.5)'); }
    }
    if (door) { c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x, y, T, T); }
  }

  // Large soft colour blotches over the whole floor so the slab grid never reads as a repeating tile.
  function mottle(c, room, biome, P, rng) {
    const area = room.w * room.h * T * T, n = Math.min(90, Math.round(area / 8000));
    const tint = { ossuary: ['#6a7a4a', '#000000', '#d8d0b8'], glowmire: [P.accent, '#1a0f30', P.accent2], rimefrost: ['#ffffff', '#4a6a8a', P.accent], cinderforge: ['#000000', '#ff6a2a', '#3a0e06'], sanctum: ['#0a3a40', P.accent2, '#000000'], abyss: [P.accent, '#000000', '#3a1a6a'] }[biome.id] || ['#000000', '#ffffff', '#000000'];
    for (let i = 0; i < n; i++) {
      const x = rng.next() * room.w * T, y = rng.next() * room.h * T, r = 28 + rng.next() * 60;
      c.globalAlpha = 0.09 + rng.next() * 0.08; c.drawImage(ED.Render.glowSprite(tint[i % 3]), x - r, y - r, r * 2, r * 2);
    }
    c.globalAlpha = 1;
  }

  // ---------- hazards, chasms ----------
  function hazardTile(c, e, gm, biome, P, room, tx, ty, rng) {
    const x = tx * T, y = ty * T, hz = biome.hazard, v = hash(tx, ty, 7), v2 = hash(tx, ty, 8);
    if (hz === 'spikes') {
      c.fillStyle = '#3a3a37'; c.fillRect(x + 1, y + 1, T - 2, T - 2);
      c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x + 1, y + 1, T - 2, 8);
      c.fillStyle = '#0e0e0c'; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { c.beginPath(); c.arc(x + 8 + i * 8, y + 8 + j * 8, 2.2, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 6 + i * 8, y + 9.5 + j * 8, 4, 0.8); c.fillStyle = '#0e0e0c'; }
      c.strokeStyle = '#1a1a17'; c.lineWidth = 1.2; c.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
      c.fillStyle = 'rgba(150,40,20,0.12)'; c.beginPath(); c.arc(x + 6 + v * 20, y + 6 + v2 * 20, 4, 0, 7); c.fill();
    } else if (hz === 'poison') {
      c.fillStyle = '#1e3a18'; c.fillRect(x, y, T, T);
      const g = c.createRadialGradient(x + 16, y + 16, 2, x + 16, y + 16, 20); g.addColorStop(0, 'rgba(120,230,70,0.3)'); g.addColorStop(1, 'rgba(60,140,40,0)'); c.fillStyle = g; c.fillRect(x, y, T, T);
      for (let i = 0; i < 3; i++) { const px = x + 4 + hash(tx, ty, 70 + i) * 24, py = y + 4 + hash(tx, ty, 80 + i) * 24, r = 1.5 + hash(tx, ty, 90 + i) * 2.5; c.fillStyle = 'rgba(190,255,130,0.35)'; c.beginPath(); c.arc(px, py, r, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(px - r * 0.4, py - r * 0.5, 1, 1); glow(e, px, py, r * 3, '#9cff6a', 0.45); }
      glow(gm, x + 16, y + 16, 22, '#7ad44a', 0.26);
    } else if (hz === 'ice') {
      const g = c.createLinearGradient(x, y, x + T, y + T); g.addColorStop(0, '#f2fbff'); g.addColorStop(0.5, '#cdeaf8'); g.addColorStop(1, '#a8d4ea');
      c.fillStyle = g; c.fillRect(x, y, T, T);
      c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); c.moveTo(x + 4, y + 22); c.lineTo(x + 14, y + 22); c.lineTo(x + 28, y + 6); c.lineTo(x + 20, y + 6); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(x + 6, y + 10); c.lineTo(x + 14, y + 4); c.moveTo(x + 18, y + 26); c.lineTo(x + 27, y + 18); c.stroke();
      c.strokeStyle = 'rgba(90,150,190,0.5)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x + 4, y + 28); c.lineTo(x + 13, y + 14); c.lineTo(x + 24, y + 12); c.stroke();
      glow(e, x + 16, y + 16, 16, '#dff6ff', 0.1);
    } else if (hz === 'lava') {
      // molten base, dark crust plates on top; the emissive layer glows only where no crust covers it
      const g = c.createLinearGradient(x, y, x + T, y + T); g.addColorStop(0, '#e4580f'); g.addColorStop(1, '#b8340a'); c.fillStyle = g; c.fillRect(x, y, T, T);
      gm.fillStyle = 'rgba(255,110,25,0.62)'; gm.fillRect(x, y, T, T);
      c.save(); c.beginPath(); c.rect(x, y, T, T); c.clip(); gm.save(); gm.beginPath(); gm.rect(x, y, T, T); gm.clip();
      for (let i = 0; i < 4; i++) {
        const px = x + 2 + hash(tx, ty, 100 + i) * 28, py = y + 2 + hash(tx, ty, 110 + i) * 28, r = 5 + hash(tx, ty, 120 + i) * 6, n = 7, rot = hash(tx, ty, 130 + i) * 6;
        const poly = (ctx) => { ctx.beginPath(); for (let k = 0; k < n; k++) { const a = rot + k * 6.283 / n, rr = r * (0.7 + hash(tx * 7 + k, ty * 5 + i, 140) * 0.5); k ? ctx.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.8) : ctx.moveTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.8); } ctx.closePath(); };
        poly(c); c.fillStyle = '#2a0f08'; c.fill(); c.strokeStyle = 'rgba(255,150,60,0.35)'; c.lineWidth = 0.8; c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.07)'; c.beginPath(); c.ellipse(px - r * 0.2, py - r * 0.3, r * 0.5, r * 0.25, 0, 0, 7); c.fill();
        gm.globalCompositeOperation = 'destination-out'; poly(gm); gm.fillStyle = 'rgba(0,0,0,0.9)'; gm.fill(); gm.globalCompositeOperation = 'lighter';
      }
      c.restore(); gm.restore();
      for (let i = 0; i < 2; i++) glow(e, x + hash(tx, ty, 160 + i) * T, y + hash(tx, ty, 170 + i) * T, 9, '#ffc04a', 0.4);
    } else if (hz === 'water') {
      const g = c.createLinearGradient(x, y, x, y + T); g.addColorStop(0, '#0f4a60'); g.addColorStop(1, '#0a3144'); c.fillStyle = g; c.fillRect(x, y, T, T);
      c.strokeStyle = 'rgba(111,230,255,0.32)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 4, y + 12); c.quadraticCurveTo(x + 10, y + 8, x + 16, y + 12); c.moveTo(x + 14, y + 24); c.quadraticCurveTo(x + 20, y + 20, x + 28, y + 24); c.stroke();
      e.strokeStyle = 'rgba(140,240,255,0.32)'; e.lineWidth = 1; e.beginPath(); e.moveTo(x + 4, y + 12); e.quadraticCurveTo(x + 10, y + 8, x + 16, y + 12); e.moveTo(x + 14, y + 24); e.quadraticCurveTo(x + 20, y + 20, x + 28, y + 24); e.stroke();
    } else if (hz === 'void') {
      c.fillStyle = '#0c0418'; c.fillRect(x, y, T, T);
      const g = c.createRadialGradient(x + 16, y + 16, 1, x + 16, y + 16, 16); g.addColorStop(0, 'rgba(190,110,255,0.45)'); g.addColorStop(1, 'rgba(90,30,160,0)'); c.fillStyle = g; c.fillRect(x, y, T, T);
      for (let i = 0; i < 4; i++) { const px = x + 3 + hash(tx, ty, 180 + i) * 26, py = y + 3 + hash(tx, ty, 190 + i) * 26; c.fillStyle = '#f0d8ff'; c.fillRect(px, py, 1.2, 1.2); e.fillStyle = 'rgba(240,220,255,0.7)'; e.fillRect(px - 0.4, py - 0.4, 2, 2); }
      e.strokeStyle = 'rgba(200,130,255,0.4)'; e.lineWidth = 1.2; e.beginPath(); e.ellipse(x + 16, y + 16, 9, 6, v * 3, 0.3, 4.6); e.stroke();
      glow(gm, x + 16, y + 16, 20, '#a85aff', 0.4);
    }
    // darkened lip where the hazard meets the floor
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (tileAt(room, tx + dx, ty + dy) === 4) continue;
      c.fillStyle = 'rgba(0,0,0,0.26)';
      if (dy === -1) c.fillRect(x, y, T, 3); if (dy === 1) c.fillRect(x, y + T - 3, T, 3);
      if (dx === -1) c.fillRect(x, y, 3, T); if (dx === 1) c.fillRect(x + T - 3, y, 3, T);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      if (dy === 1) c.fillRect(x, y + T - 1, T, 1);
    }
  }

  function chasmTile(c, gm, biome, P, room, tx, ty, rng) {
    const x = tx * T, y = ty * T;
    const g = c.createLinearGradient(0, y, 0, y + T); g.addColorStop(0, P.chasm); g.addColorStop(1, U.shade(P.chasm, -0.5));
    c.fillStyle = g; c.fillRect(x, y, T, T);
    grain(c, x, y, T, T, 0.6, rng);
    const glowCol = { cinderforge: '#ff4a1a', abyss: '#7a3aff', sanctum: '#0a6a8a', glowmire: '#2a8a6a' }[biome.id];
    if (glowCol) glow(gm, x + 16, y + 20, 22, glowCol, 0.24 + hash(tx, ty, 9) * 0.12);
    if (tileAt(room, tx, ty - 1) !== 3) {
      const g2 = c.createLinearGradient(0, y, 0, y + T * 0.85); g2.addColorStop(0, U.shade(P.wallFace, 0.05)); g2.addColorStop(1, P.chasm);
      c.fillStyle = g2; c.fillRect(x, y, T, T * 0.85);
      c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1;
      for (let r = 1; r < 3; r++) { c.beginPath(); c.moveTo(x, y + r * 9 + 0.5); c.lineTo(x + T, y + r * 9 + 0.5); c.stroke(); }
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x, y, T, 1);
    }
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0]]) {
      if (tileAt(room, tx + dx, ty + dy) === 3) continue;
      c.fillStyle = 'rgba(255,255,255,0.09)';
      if (dy === 1) c.fillRect(x, y + T - 2, T, 2); if (dx === -1) c.fillRect(x, y, 2, T); if (dx === 1) c.fillRect(x + T - 2, y, 2, T);
    }
  }

  // ---------- ambient occlusion on the floor ----------
  function occlusion(c, room, biome, ao, tx, ty, t) {
    const x = tx * T, y = ty * T, n = tileAt(room, tx, ty - 1), w = tileAt(room, tx - 1, ty), ea = tileAt(room, tx + 1, ty), s = tileAt(room, tx, ty + 1);
    const frost = biome.id === 'rimefrost';
    const strip = (x0, y0, x1, y1, rx, ry, rw, rh, a) => {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, U.rgba(ao, a)); g.addColorStop(0.45, U.rgba(ao, a * 0.4)); g.addColorStop(1, U.rgba(ao, 0));
      c.fillStyle = g; c.fillRect(rx, ry, rw, rh);
    };
    if (isWall(n)) strip(0, y, 0, y + 18, x, y, T, 18, 0.7);
    else if (n === 2) strip(0, y, 0, y + 12, x, y, T, 12, 0.5);
    if (isWall(w)) strip(x, 0, x + 12, 0, x, y, 12, T, 0.5); else if (w === 2) strip(x, 0, x + 8, 0, x, y, 8, T, 0.34);
    if (isWall(ea)) strip(x + T, 0, x + T - 12, 0, x + T - 12, y, 12, T, 0.46); else if (ea === 2) strip(x + T, 0, x + T - 8, 0, x + T - 8, y, 8, T, 0.3);
    if (isWall(s)) strip(0, y + T, 0, y + T - 8, x, y + T - 8, T, 8, 0.3); else if (s === 2) strip(0, y + T, 0, y + T - 7, x, y + T - 7, T, 7, 0.26);
    // tighter corner darkening where two occluders meet
    if ((isWall(n) || n === 2) && (isWall(w) || w === 2)) { const g = c.createRadialGradient(x, y, 0, x, y, 16); g.addColorStop(0, U.rgba(ao, 0.45)); g.addColorStop(1, U.rgba(ao, 0)); c.fillStyle = g; c.fillRect(x, y, 16, 16); }
    if ((isWall(n) || n === 2) && (isWall(ea) || ea === 2)) { const g = c.createRadialGradient(x + T, y, 0, x + T, y, 16); g.addColorStop(0, U.rgba(ao, 0.45)); g.addColorStop(1, U.rgba(ao, 0)); c.fillStyle = g; c.fillRect(x + T - 16, y, 16, 16); }
    if (frost && (isWall(n) || isWall(w) || isWall(ea))) { c.fillStyle = 'rgba(255,255,255,0.18)'; if (isWall(n)) c.fillRect(x, y + 14, T, 1); }
    if (t === 4) return;
    // chasm lip highlight on the floor side
    if (tileAt(room, tx, ty + 1) === 3) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x, y + T - 2, T, 2); }
  }

  // ---------- walls & blocks ----------
  // Brick courses continuous across tiles; per-brick tone and a light top edge give each course relief.
  function bricks(c, P, x, y, w, h, tx, ty, rng, lit) {
    c.fillStyle = P.wallFace; c.fillRect(x, y, w, h);
    const rows = Math.max(1, Math.round(h / 8)), rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const yy = y + r * rh, off = (r + ty * 3) % 2 ? 8 : 0;
      for (let xx = x - off; xx < x + w; xx += 16) {
        const bx = Math.max(x, xx), bw = Math.min(x + w, xx + 16) - bx; if (bw <= 0) continue;
        const j = hash(Math.floor((xx + tx * 0) / 16) + tx * 2, r + ty * 7, 11);
        c.fillStyle = U.shade(P.wallFace, (j - 0.5) * 0.2); c.fillRect(bx, yy, bw, rh);
        c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(bx, yy, bw, 1);
        c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(bx, yy + rh - 2, bw, 1.4);
        if (j > 0.82) { c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(bx + j * 6, yy + 2, 5, 3); }
      }
      c.fillStyle = P.wallShadow; c.fillRect(x, yy + rh - 1, w, 1);
      for (let xx = x - off; xx < x + w; xx += 16) if (xx >= x) c.fillRect(xx, yy, 1, rh);
    }
    grain(c, x, y, w, h, 0.7, rng);
    if (lit) { const g = c.createLinearGradient(0, y + h - 12, 0, y + h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)'); c.fillStyle = g; c.fillRect(x, y + h - 12, w, 12); }
  }

  function wallTile(c, e, biome, P, room, tx, ty, rng) {
    const x = tx * T, y = ty * T, id = biome.id;
    const below = tileAt(room, tx, ty + 1);
    if (below !== 1 && ty < room.h - 1) {
      // front face seen from above: lit top lip, then brick courses
      const lg = c.createLinearGradient(0, y, 0, y + 7); lg.addColorStop(0, U.shade(P.wallTop, 0.16)); lg.addColorStop(1, P.wallTop);
      c.fillStyle = lg; c.fillRect(x, y, T, 7);
      grain(c, x, y, T, 7, 0.8, rng);
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(x, y, T, 1);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x, y + 6, T, 1);
      bricks(c, P, x, y + 7, T, T - 7, tx, ty, rng, true);
      const v = hash(tx, ty, 21), v2 = hash(tx, ty, 22);
      if (id === 'ossuary') {
        if (v > 0.8) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(x + 8, y + 12, 16, 10); c.fillStyle = U.rgba(P.accent2, 0.7); c.fillRect(x + 10, y + 14, 12, 2); c.fillRect(x + 10, y + 18, 12, 2); c.beginPath(); c.arc(x + 10, y + 15, 1.5, 0, 7); c.arc(x + 22, y + 15, 1.5, 0, 7); c.arc(x + 10, y + 19, 1.5, 0, 7); c.arc(x + 22, y + 19, 1.5, 0, 7); c.fill(); }
        if (v2 > 0.7) { c.fillStyle = U.rgba(P.accent, 0.5); c.beginPath(); c.moveTo(x + 4 + v * 14, y + 7); c.lineTo(x + 16 + v * 14, y + 7); c.lineTo(x + 12 + v * 14, y + 13 + v2 * 6); c.closePath(); c.fill(); }
      } else if (id === 'glowmire') {
        if (v > 0.5) { const px = x + 4 + v * 20; c.fillStyle = U.rgba(P.accent, 0.4); c.beginPath(); c.moveTo(px - 6, y + 7); c.quadraticCurveTo(px, y + 14 + v2 * 10, px + 6, y + 7); c.fill(); glow(e, px, y + 12, 12, P.accent, 0.5); }
        if (v2 > 0.7) { c.fillStyle = U.rgba(P.accent2, 0.7); c.beginPath(); c.arc(x + 6 + v * 20, y + 22 + v2 * 6, 1.6, 0, 7); c.fill(); glow(e, x + 6 + v * 20, y + 22 + v2 * 6, 6, P.accent2, 0.6); }
      } else if (id === 'rimefrost') {
        c.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < 3; i++) { const h = 3 + hash(tx, ty, 30 + i) * 8, px = x + 3 + i * 10 + hash(tx, ty, 33 + i) * 3; c.beginPath(); c.moveTo(px, y + 7); c.lineTo(px + 3.5, y + 7); c.lineTo(px + 1.7, y + 7 + h); c.fill(); }
        c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x, y + 15, T, 1);
        if (v > 0.7) glow(e, x + 16, y + 14, 14, '#bff0ff', 0.15);
      } else if (id === 'cinderforge') {
        const sg = c.createLinearGradient(0, y + 7, 0, y + T); sg.addColorStop(0, 'rgba(0,0,0,0.25)'); sg.addColorStop(1, 'rgba(0,0,0,0.05)'); c.fillStyle = sg; c.fillRect(x, y + 7, T, T - 7);
        if (v > 0.45) { c.fillStyle = 'rgba(255,100,30,0.6)'; const ry = 7 + Math.floor(v2 * 3) * 8; c.fillRect(x + 4 + v * 12, y + ry + 6, 12, 1.4); e.fillStyle = 'rgba(255,130,40,0.65)'; e.fillRect(x + 4 + v * 12, y + ry + 5.6, 12, 2); glow(e, x + 10 + v * 12, y + ry + 6, 10, '#ff6a2a', 0.3); }
      } else if (id === 'sanctum') {
        c.fillStyle = 'rgba(232,198,107,0.75)'; c.fillRect(x, y + 6, T, 1.5); e.fillStyle = 'rgba(255,214,110,0.3)'; e.fillRect(x, y + 6, T, 1.5);
        if (v > 0.5) { c.fillStyle = 'rgba(95,242,224,0.16)'; c.fillRect(x + v * 10, y + 24, 14 + v2 * 10, 8); }
        if (v2 > 0.75) { c.fillStyle = 'rgba(30,110,80,0.4)'; c.beginPath(); c.ellipse(x + 8 + v * 16, y + 29, 6, 3, 0, 0, 7); c.fill(); }
      } else if (id === 'abyss') {
        if (v > 0.72) { const rx = x + 16, ry = y + 20; c.strokeStyle = U.rgba(P.accent, 0.4); c.lineWidth = 1; c.beginPath(); c.moveTo(rx - 5, ry - 5); c.lineTo(rx, ry - 8); c.lineTo(rx + 5, ry - 5); c.lineTo(rx + 5, ry + 4); c.lineTo(rx - 5, ry + 4); c.closePath(); c.moveTo(rx, ry - 8); c.lineTo(rx, ry + 4); c.stroke(); e.strokeStyle = U.rgba(P.accent, 0.65); e.lineWidth = 1.2; e.beginPath(); e.moveTo(rx - 5, ry - 5); e.lineTo(rx, ry - 8); e.lineTo(rx + 5, ry - 5); e.lineTo(rx + 5, ry + 4); e.lineTo(rx - 5, ry + 4); e.closePath(); e.moveTo(rx, ry - 8); e.lineTo(rx, ry + 4); e.stroke(); glow(e, rx, ry - 2, 14, P.accent, 0.2); }
      }
    } else {
      // top surface of the wall mass
      c.fillStyle = P.wallTop; c.fillRect(x, y, T, T);
      c.fillStyle = 'rgba(0,0,0,0.1)'; c.fillRect(x + 3, y + 3, T - 6, T - 6);
      grain(c, x, y, T, T, 0.9, rng);
      if (hash(tx, ty, 23) > 0.5) { c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x + 6, y + 6, 10, 7); }
      const open = (dx, dy) => tileAt(room, tx + dx, ty + dy) !== 1;
      // the edge facing the room: a narrow shaded side face with a lit rim
      if (open(-1, 0)) { const g = c.createLinearGradient(x, 0, x + 6, 0); g.addColorStop(0, P.wallShadow); g.addColorStop(1, P.wallFace); c.fillStyle = g; c.fillRect(x, y, 6, T); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(x, y, 1, T); }
      if (open(1, 0)) { const g = c.createLinearGradient(x + T, 0, x + T - 6, 0); g.addColorStop(0, P.wallShadow); g.addColorStop(1, P.wallFace); c.fillStyle = g; c.fillRect(x + T - 6, y, 6, T); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(x + T - 1, y, 1, T); }
      if (open(0, -1) && ty > 0) { c.fillStyle = P.wallShadow; c.fillRect(x, y, T, 3); }
      c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(x, y + T - 1, T, 1);
    }
  }

  function blockTile(c, e, biome, P, room, tx, ty, rng) {
    const x = tx * T, y = ty * T, id = biome.id;
    const hasBelow = tileAt(room, tx, ty + 1) !== 2, hasAbove = tileAt(room, tx, ty - 1) !== 2;
    const topH = hasBelow ? 18 : T, y0 = y - (hasAbove ? 8 : 0), h0 = topH + (hasAbove ? 8 : 0);
    // soft contact shadow under the pillar
    if (hasBelow) { const g = c.createLinearGradient(0, y + T, 0, y + T + 14); g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - 2, y + T, T + 4, 14); }
    const tg = c.createLinearGradient(0, y0, 0, y0 + h0); tg.addColorStop(0, U.shade(P.wallTop, 0.08)); tg.addColorStop(1, U.shade(P.wallTop, -0.1));
    c.fillStyle = tg; c.fillRect(x, y0, T, h0);
    grain(c, x, y0, T, h0, 0.9, rng);
    c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(x, y0, T, 1.5); c.fillRect(x, y0, 1.5, h0);
    c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x + T - 1.5, y0, 1.5, h0);
    c.fillStyle = 'rgba(0,0,0,0.07)'; c.fillRect(x + 3, y0 + 3, T - 6, h0 - 6);
    if (hash(tx, ty, 24) > 0.6) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.moveTo(x + T - 7, y0); c.lineTo(x + T, y0); c.lineTo(x + T, y0 + 7); c.fill(); }
    if (hasBelow) bricks(c, P, x, y + topH, T, T - topH, tx, ty, rng, true);
    c.strokeStyle = P.wallShadow; c.lineWidth = 1.2; c.strokeRect(x + 0.5, y0 + 0.5, T - 1, h0 + (hasBelow ? T - topH : 0) - 1);
    if (id === 'rimefrost') { c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(x + 2, y0, T - 4, 4); c.fillStyle = 'rgba(190,230,255,0.9)'; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(x + 5 + i * 10, y0 + 4); c.lineTo(x + 9 + i * 10, y0 + 4); c.lineTo(x + 7 + i * 10, y0 + 8 + hash(tx, ty, 40 + i) * 5); c.fill(); } }
    if (id === 'cinderforge' && hasBelow && hash(tx, ty, 25) > 0.4) { c.fillStyle = 'rgba(255,106,42,0.65)'; c.fillRect(x + 6, y + topH + 5, T - 12, 1.5); e.fillStyle = 'rgba(255,130,50,0.65)'; e.fillRect(x + 6, y + topH + 4.6, T - 12, 2.2); glow(e, x + 16, y + topH + 6, 14, '#ff6a2a', 0.3); }
    if (id === 'glowmire' && hash(tx, ty, 26) > 0.5) { c.fillStyle = U.rgba(P.accent, 0.4); c.beginPath(); c.ellipse(x + 8 + hash(tx, ty, 27) * 16, y0 + 3, 7, 3, 0, 0, 7); c.fill(); glow(e, x + 16, y0 + 3, 12, P.accent, 0.3); }
    if (id === 'ossuary' && hash(tx, ty, 28) > 0.7) { c.fillStyle = U.rgba(P.accent, 0.4); c.beginPath(); c.ellipse(x + 8 + hash(tx, ty, 29) * 16, y0 + 3, 7, 2.6, 0, 0, 7); c.fill(); }
    if (id === 'sanctum') { c.fillStyle = 'rgba(232,198,107,0.6)'; c.fillRect(x + 2, y0 + 2, T - 4, 1.3); }
    if (id === 'abyss' && hash(tx, ty, 31) > 0.6) { e.strokeStyle = U.rgba(P.accent, 0.5); e.lineWidth = 1.2; e.beginPath(); e.arc(x + 16, y0 + 9, 5, 0, 7); e.moveTo(x + 16, y0 + 4); e.lineTo(x + 16, y0 + 14); e.stroke(); glow(e, x + 16, y0 + 9, 12, P.accent, 0.18); }
  }

  function doorFrame(c, e, biome, P, room, d) {
    const r = ED.Dungeon.doorRect(room, d);
    const x0 = r.x0 * T, y0 = r.y0 * T, x1 = (r.x1 + 1) * T, y1 = (r.y1 + 1) * T;
    if (d === 'n') {
      const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
      c.fillStyle = g; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      for (const px of [x0 - 6, x1]) { const pg = c.createLinearGradient(px, 0, px + 6, 0); pg.addColorStop(0, U.shade(P.wallTop, 0.1)); pg.addColorStop(1, P.wallFace); c.fillStyle = pg; c.fillRect(px, y0, 6, y1 - y0); c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(px, y0, 1, y1 - y0); }
      c.fillStyle = U.shade(P.wallTop, 0.18); c.fillRect(x0 - 6, y0, x1 - x0 + 12, 5); c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(x0 - 6, y0 + 5, x1 - x0 + 12, 1.5);
      glow(e, (x0 + x1) / 2, y0 + 12, 24, P.accent, 0.08);
    } else if (d === 's') {
      const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, '#000');
      c.fillStyle = g; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(x0 - 3, y0, 2, y1 - y0); c.fillRect(x1 + 1, y0, 2, y1 - y0);
    } else {
      const g = c.createLinearGradient(d === 'w' ? x1 : x0, 0, d === 'w' ? x0 : x1, 0); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, '#000');
      c.fillStyle = g; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.fillStyle = U.shade(P.wallTop, 0.14); c.fillRect(x0, y0 - 5, x1 - x0, 5); c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(x0, y0, x1 - x0, 1.5);
      c.fillStyle = U.shade(P.wallFace, 0.05); c.fillRect(x0, y1, x1 - x0, 3);
    }
  }

  function sconce(c, e, P, x, y) {
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(x, y + 4, 9, 7, 0, 0, 7); c.fill();
    c.fillStyle = '#1c1410'; c.beginPath(); c.arc(x, y + 1, 7, 0, 7); c.fill();
    c.strokeStyle = '#4a3a2c'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#2a1d14'; c.fillRect(x - 3, y - 2, 6, 10);
    c.fillStyle = '#5a4430'; c.fillRect(x - 5.5, y - 4.5, 11, 3);
    c.fillStyle = '#7a6044'; c.fillRect(x - 5.5, y - 4.5, 11, 1);
    glow(e, x, y - 8, 14, P.light, 0.22);
  }

  // ---------- decor ----------
  const bone = (c, x0, y0, x1, y1, col) => { c.strokeStyle = col; c.lineWidth = 2.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.fillStyle = col; for (const [px, py] of [[x0, y0], [x1, y1]]) { c.beginPath(); c.arc(px - 0.6, py - 1.2, 1.9, 0, 7); c.arc(px + 0.6, py + 1.2, 1.9, 0, 7); c.fill(); } c.lineCap = 'butt'; };
  function decor(c, e, biome, P, k, x, y, v, s) {
    c.save(); c.translate(x, y); c.scale(s, s);
    e.save(); e.translate(x, y); e.scale(s, s);
    c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,0.5)';
    const sh = (rx, ry, a) => { c.fillStyle = `rgba(0,0,0,${a || 0.28})`; c.beginPath(); c.ellipse(0, 1, rx, ry, 0, 0, 7); c.fill(); };
    switch (k) {
      case 'bones': sh(10, 4); c.save(); c.rotate(v * 3); bone(c, -6, 0, 6, 0, P.accent2); c.restore(); bone(c, -3, 4, 5, 5.5, U.shade(P.accent2, -0.12)); break;
      case 'skull': sh(6, 3);
        c.fillStyle = P.accent2; c.beginPath(); c.arc(0, -1, 4.8, 0, 7); c.fill(); c.fillRect(-3, 1.5, 6, 3.6); c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(-1.5, -2.6, 2, 0, 7); c.fill();
        c.fillStyle = '#14100c'; c.beginPath(); c.arc(-2, -0.6, 1.4, 0, 7); c.arc(2, -0.6, 1.4, 0, 7); c.fill(); c.fillRect(-0.5, 1, 1, 1.4); c.fillRect(-2, 3.6, 0.8, 1.5); c.fillRect(0.2, 3.6, 0.8, 1.5); c.fillRect(1.8, 3.6, 0.8, 1.5); break;
      case 'moss': c.fillStyle = U.rgba(P.accent, 0.5); for (let i = 0; i < 6; i++) { c.beginPath(); c.arc((i - 2.5) * 3.6, Math.sin(i * 2 + v) * 3, 3.5 + (i % 2) * 2, 0, 7); c.fill(); } c.fillStyle = U.rgba(P.accent2, 0.25); for (let i = 0; i < 4; i++) c.fillRect((i - 2) * 4.5 + v * 3, Math.cos(i * 3 + v) * 3 - 1, 1.5, 1.5); break;
      case 'crack': c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-10, -4); c.lineTo(-3, 0); c.lineTo(2, -5); c.lineTo(10, 2); c.moveTo(-3, 0); c.lineTo(-1, 6); c.stroke(); c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-10, -3); c.lineTo(-3, 1); c.lineTo(2, -4); c.stroke(); break;
      case 'candle': {
        c.fillStyle = 'rgba(232,220,190,0.55)'; c.beginPath(); c.ellipse(1, 1, 8, 3.2, 0, 0, 7); c.fill(); sh(8, 3, 0.2);
        c.fillStyle = '#e6dcc0'; c.fillRect(-2, -7, 4, 7); c.fillRect(3, -5, 3, 5); c.fillStyle = '#fff5dc'; c.fillRect(-2, -7, 1.3, 7);
        c.fillStyle = '#ffcf6a'; c.beginPath(); c.ellipse(0, -9.2, 1.4, 2.2, 0, 0, 7); c.ellipse(4.5, -7.2, 1.2, 1.9, 0, 0, 7); c.fill();
        glow(e, 0, -9, 9, '#ffb35c', 0.7); glow(e, 4.5, -7, 7, '#ffb35c', 0.55); break;
      }
      case 'urn': sh(6, 2.5); c.fillStyle = '#6a5240'; c.beginPath(); c.ellipse(0, -4, 5, 6, 0, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#4a3828'; c.fillRect(-3, -11, 6, 3); c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.ellipse(-1.8, -5.5, 1.3, 3.5, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.moveTo(2, -8); c.lineTo(3.5, -4); c.stroke(); break;
      case 'mushroom': case 'glowcap': {
        const col = k === 'glowcap' ? P.accent2 : P.accent;
        sh(7, 2.5, 0.22);
        c.fillStyle = U.rgba(col, 0.2); c.beginPath(); c.arc(0, -4, 10, 0, 7); c.fill();
        const cap = (px, py, sc) => { c.fillStyle = '#d8d0c0'; c.fillRect(px - 1.2 * sc, py, 2.4 * sc, 6 * sc); c.fillStyle = col; c.beginPath(); c.ellipse(px, py, 5 * sc, 3.6 * sc, 0, Math.PI, 0); c.fill(); c.fillStyle = U.shade(col, 0.45); c.beginPath(); c.arc(px - 1.5 * sc, py - 1.5 * sc, 0.9 * sc, 0, 7); c.arc(px + 1.5 * sc, py - 0.8 * sc, 0.7 * sc, 0, 7); c.fill(); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(px - 5 * sc, py - 0.4, 10 * sc, 1); e.fillStyle = U.rgba(col, 0.7); e.beginPath(); e.ellipse(px, py, 5 * sc, 3.6 * sc, 0, Math.PI, 0); e.fill(); };
        cap(0, -5, 1); if (v > 0.5) cap(6, -3, 0.65);
        glow(e, 0, -6, 15, col, 0.55); break;
      }
      case 'root': c.strokeStyle = '#3a2a2a'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(-10, 0); c.quadraticCurveTo(-2, -6, 4, 0); c.quadraticCurveTo(8, 4, 12, 2); c.stroke(); c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-10, -1); c.quadraticCurveTo(-2, -7, 4, -1); c.stroke(); break;
      case 'puddle': c.fillStyle = biome.id === 'sanctum' ? 'rgba(20,90,100,0.55)' : 'rgba(10,30,40,0.5)'; c.beginPath(); c.ellipse(0, 0, 10, 5, v, 0, 7); c.fill(); c.strokeStyle = biome.id === 'sanctum' ? 'rgba(130,245,235,0.4)' : 'rgba(170,230,230,0.28)'; c.lineWidth = 0.9; c.beginPath(); c.ellipse(0, -0.5, 8, 3.6, v, 3.4, 5.6); c.stroke(); e.strokeStyle = 'rgba(150,240,235,0.2)'; e.lineWidth = 0.9; e.beginPath(); e.ellipse(0, -0.5, 8, 3.6, v, 3.4, 5.6); e.stroke(); break;
      case 'crystal': {
        sh(8, 2.5, 0.25); c.fillStyle = U.rgba(P.accent, 0.22); c.beginPath(); c.arc(0, -6, 11, 0, 7); c.fill();
        c.fillStyle = '#9fdcf0'; c.beginPath(); c.moveTo(-3.5, 0); c.lineTo(-1, -13); c.lineTo(2.5, 0); c.fill(); c.fillStyle = '#e8fbff'; c.beginPath(); c.moveTo(-1, -13); c.lineTo(0.2, -1); c.lineTo(2.5, 0); c.fill();
        c.fillStyle = '#7fc8e4'; c.beginPath(); c.moveTo(1, 0); c.lineTo(5, -8); c.lineTo(6.5, 0); c.fill(); c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.moveTo(5, -8); c.lineTo(5.6, -1); c.lineTo(6.5, 0); c.fill();
        glow(e, 0, -7, 14, P.accent, 0.5); break;
      }
      case 'snow': c.fillStyle = 'rgba(70,110,150,0.35)'; c.beginPath(); c.ellipse(1, 1.5, 11, 4, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.ellipse(0, 0, 11, 4, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.ellipse(-2, -1, 6, 2, 0, 0, 7); c.fill(); break;
      case 'frozenbones': c.fillStyle = 'rgba(70,110,150,0.3)'; c.beginPath(); c.ellipse(1, 1.5, 9, 5, 0, 0, 7); c.fill(); c.save(); c.rotate(v * 3); bone(c, -6, 0, 6, 0, '#e8f6ff'); c.restore(); c.fillStyle = 'rgba(160,220,255,0.4)'; c.beginPath(); c.ellipse(0, 0, 9, 5, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 0.8; c.beginPath(); c.ellipse(0, 0, 9, 5, 0, 3.5, 5.5); c.stroke(); break;
      case 'pillarstub': sh(8, 3, 0.3); c.fillStyle = P.wallFace; c.fillRect(-7, -2, 14, 5); c.fillStyle = P.wallTop; c.beginPath(); c.ellipse(0, -2, 7, 4, 0, 0, 7); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.ellipse(-1.5, -3, 3.5, 1.4, 0, 0, 7); c.fill(); break;
      case 'lavacrack': { c.strokeStyle = 'rgba(15,4,2,0.8)'; c.lineWidth = 3; c.beginPath(); c.moveTo(-10, -2); c.lineTo(-4, 1); c.lineTo(1, -3); c.lineTo(9, 2); c.stroke(); c.strokeStyle = '#ff7a2a'; c.lineWidth = 1.6; c.stroke(); c.strokeStyle = 'rgba(255,220,100,0.8)'; c.lineWidth = 0.7; c.stroke();
        e.strokeStyle = 'rgba(255,140,50,0.9)'; e.lineWidth = 2; e.beginPath(); e.moveTo(-10, -2); e.lineTo(-4, 1); e.lineTo(1, -3); e.lineTo(9, 2); e.stroke(); glow(e, 0, 0, 16, '#ff6a2a', 0.4); break; }
      case 'chain': c.strokeStyle = '#5a5a5a'; c.lineWidth = 1.6; for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(-6 + i * 4, 0, 2.6, 1.7, 0, 0, 7); c.stroke(); } c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 0.7; for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(-6 + i * 4, -0.3, 2.6, 1.7, 0, 3.6, 5.4); c.stroke(); } break;
      case 'anvil': sh(9, 3, 0.35); c.fillStyle = '#3a3a3e'; c.fillRect(-7, -6, 14, 4); c.fillRect(-3, -2, 6, 4); c.fillRect(-6, 2, 12, 2); c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(-7, -6, 14, 1.2); c.fillStyle = 'rgba(255,120,40,0.35)'; c.fillRect(-6, -5, 4, 1); break;
      case 'grate': c.fillStyle = '#0c0806'; c.fillRect(-8, -6, 16, 12); c.fillStyle = 'rgba(255,100,30,0.5)'; c.fillRect(-7, -5, 14, 10); c.strokeStyle = '#4a3a30'; c.lineWidth = 1.2; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-6 + i * 4, -6); c.lineTo(-6 + i * 4, 6); c.stroke(); } c.strokeStyle = '#2a1e18'; c.strokeRect(-8, -6, 16, 12);
        e.fillStyle = 'rgba(255,110,30,0.55)'; e.fillRect(-7, -5, 14, 10); glow(e, 0, 0, 16, '#ff7a2a', 0.4); break;
      case 'cinders': c.fillStyle = 'rgba(30,20,16,0.5)'; c.beginPath(); c.ellipse(0, 0, 9, 4, 0, 0, 7); c.fill(); for (let i = 0; i < 6; i++) { const px = Math.sin(i * 7 + v * 9) * 8, py = Math.cos(i * 5 + v * 9) * 4; c.fillStyle = 'rgba(255,140,60,0.7)'; c.fillRect(px, py, 1.6, 1.6); e.fillStyle = 'rgba(255,150,60,0.8)'; e.fillRect(px - 0.4, py - 0.4, 2.4, 2.4); } glow(e, 0, 0, 12, '#ff8a3a', 0.25); break;
      case 'coral': sh(7, 2.5, 0.25); c.strokeStyle = '#e0705a'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -8); c.lineTo(-4, -12); c.moveTo(0, -6); c.lineTo(4, -11); c.moveTo(0, -3); c.lineTo(-5, -6); c.stroke(); c.fillStyle = '#ffb0a0'; for (const [px, py] of [[-4, -12], [4, -11], [-5, -6], [0, -8]]) { c.beginPath(); c.arc(px, py, 1.5, 0, 7); c.fill(); } break;
      case 'crate': sh(8, 3, 0.3); c.fillStyle = '#6a4a30'; c.fillRect(-6, -10, 12, 10); c.strokeRect(-6, -10, 12, 10); c.fillStyle = '#8a6240'; c.fillRect(-5, -9, 10, 3); c.strokeStyle = '#2a2220'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-6, -10); c.lineTo(6, 0); c.moveTo(6, -10); c.lineTo(-6, 0); c.stroke(); c.fillStyle = '#c8501a'; c.fillRect(-6, -6, 12, 1.4); break;
      case 'seaweed': c.strokeStyle = '#2f7a4a'; c.lineWidth = 2.2; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * 3, 0); c.quadraticCurveTo(i * 3 + 4, -6, i * 3, -12); c.stroke(); } c.strokeStyle = 'rgba(160,255,190,0.3)'; c.lineWidth = 0.8; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * 3 + 0.8, 0); c.quadraticCurveTo(i * 3 + 4.8, -6, i * 3 + 0.8, -12); c.stroke(); } break;
      case 'goldtile': c.fillStyle = 'rgba(30,20,6,0.3)'; c.fillRect(-8, -8, 16, 16); c.strokeStyle = 'rgba(232,198,107,0.85)'; c.lineWidth = 1.4; c.strokeRect(-8, -8, 16, 16); c.beginPath(); c.moveTo(-8, 0); c.lineTo(0, -8); c.lineTo(8, 0); c.lineTo(0, 8); c.closePath(); c.stroke(); c.fillStyle = 'rgba(255,230,140,0.5)'; c.beginPath(); c.arc(0, 0, 2.2, 0, 7); c.fill();
        e.strokeStyle = 'rgba(255,214,110,0.5)'; e.lineWidth = 1.4; e.strokeRect(-8, -8, 16, 16); e.beginPath(); e.moveTo(-8, 0); e.lineTo(0, -8); e.lineTo(8, 0); e.lineTo(0, 8); e.closePath(); e.stroke(); glow(e, 0, 0, 12, '#ffd36b', 0.25); break;
      case 'shell': sh(5, 2, 0.22); c.fillStyle = '#e8d0c0'; c.beginPath(); c.arc(0, 0, 4, Math.PI, 0); c.fill(); c.stroke(); c.strokeStyle = 'rgba(150,100,80,0.5)'; c.lineWidth = 0.7; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 1.4, 0); c.lineTo(i * 1.1, -3.6); c.stroke(); } break;
      case 'voidcrack': c.strokeStyle = 'rgba(8,0,20,0.8)'; c.lineWidth = 3; c.beginPath(); c.moveTo(-10, 0); c.lineTo(-3, -3); c.lineTo(2, 2); c.lineTo(10, -2); c.stroke(); c.strokeStyle = '#c98bff'; c.lineWidth = 1.4; c.stroke(); c.strokeStyle = 'rgba(255,200,255,0.6)'; c.lineWidth = 0.6; c.stroke();
        e.strokeStyle = 'rgba(210,140,255,0.9)'; e.lineWidth = 2; e.beginPath(); e.moveTo(-10, 0); e.lineTo(-3, -3); e.lineTo(2, 2); e.lineTo(10, -2); e.stroke(); glow(e, 0, 0, 16, '#b78cff', 0.35); break;
      case 'rune': c.strokeStyle = U.rgba(P.accent, 0.6); c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, 8, 0, 7); c.moveTo(0, -8); c.lineTo(0, 8); c.moveTo(-6, -4); c.lineTo(6, 4); c.moveTo(-6, 4); c.lineTo(6, -4); c.stroke();
        e.strokeStyle = U.rgba(P.accent, 0.8); e.lineWidth = 1.4; e.beginPath(); e.arc(0, 0, 8, 0, 7); e.moveTo(0, -8); e.lineTo(0, 8); e.moveTo(-6, -4); e.lineTo(6, 4); e.moveTo(-6, 4); e.lineTo(6, -4); e.stroke(); glow(e, 0, 0, 16, P.accent, 0.3); break;
      case 'shard': sh(5, 2, 0.25); c.fillStyle = 'rgba(160,110,255,0.8)'; c.beginPath(); c.moveTo(-3, 0); c.lineTo(0, -10); c.lineTo(3, 0); c.fill(); c.fillStyle = 'rgba(230,200,255,0.8)'; c.beginPath(); c.moveTo(0, -10); c.lineTo(0.6, 0); c.lineTo(3, 0); c.fill(); e.fillStyle = 'rgba(180,130,255,0.8)'; e.beginPath(); e.moveTo(-3, 0); e.lineTo(0, -10); e.lineTo(3, 0); e.fill(); glow(e, 0, -5, 12, '#b78cff', 0.4); break;
      case 'starfield': for (let i = 0; i < 5; i++) { const px = Math.sin(i * 3 + v * 5) * 10, py = Math.cos(i * 4 + v * 5) * 7; c.fillStyle = '#efe6ff'; c.fillRect(px, py, 1.2, 1.2); e.fillStyle = 'rgba(240,230,255,0.9)'; e.fillRect(px - 0.4, py - 0.4, 2, 2); } glow(e, 0, 0, 12, '#9a7aff', 0.15); break;
      default: break;
    }
    c.restore(); e.restore();
  }

  // =====================================================================================================================
  // Pixel-art rooms (ED.Atlas): 1 art px = 2 world px. The room is painted at world resolution and every shape sits on the art grid. The stone of the 0x72 set is a
  // 5-colour palette; each stratum recolours it once into a private sheet (floor, wall, door, torch, ... modes), so no pixel work happens per frame.
  // =====================================================================================================================
  const A = ED.Atlas, K = 2, AT = 16; // K: world px per art px, AT: art px per tile
  const artOn = () => !!(A && A.ok && A.pages && A.pages.world && A.has('tile.floor.1') && A.has('tile.wall.face.mid'));
  Tl.art = artOn;
  const hashS = (a, b, n, s) => hash(a + (s & 0xffff), b + ((s >>> 16) & 0xffff) * 7, n); // per-room seeded hash in [0, 1)
  const clamp8 = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  const rgbOf = (hex) => U.hexToRgb(hex);
  const mixA = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mulA = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const packA = (a) => ((255 << 24) | (clamp8(a[2]) << 16) | (clamp8(a[1]) << 8) | clamp8(a[0])) >>> 0; // little-endian RGBA, opaque
  const hexA = (a) => U.rgbToHex(a[0], a[1], a[2]);
  const lumOf = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // The five stone colours of the 0x72 set (luminance of #222222 #483b3a #775c55 #aa8d7a #d3bfa9) and a piecewise-linear map from a stone pixel's luminance onto five target colours.
  const STONE_L = [0.133, 0.253, 0.389, 0.58, 0.76];
  function ramp5(stops) {
    return (L) => {
      if (L <= STONE_L[0]) return stops[0];
      for (let i = 1; i < 5; i++) if (L <= STONE_L[i]) return mixA(stops[i - 1], stops[i], (L - STONE_L[i - 1]) / (STONE_L[i] - STONE_L[i - 1]));
      return stops[4];
    };
  }
  // Highlight colour of wall caps per stratum (mixed into the top stop).
  const RIM = { ossuary: 'accent2', glowmire: 'accent', rimefrost: 'accent2', cinderforge: 'accent2', sanctum: 'accent', abyss: 'accent' };
  const RIM_K = { ossuary: 0.35, glowmire: 0.3, rimefrost: 0.9, cinderforge: 0.3, sanctum: 0.55, abyss: 0.4 };
  const ART_LIFT = { ossuary: 0.6, glowmire: 0.7, rimefrost: 0, cinderforge: 0.7, sanctum: 0.6, abyss: 1.0 }; // floor brightness boost (the lighting multiply only darkens)
  // Per-stratum stone ramps: floor, wall (cap, brick, mortar, outline) and the flame ramp of torches.
  const rampCache = new Map();
  function rampsFor(biome) {
    let o = rampCache.get(biome.id);
    if (o) return o;
    const P = biome.pal, lift = 1 + (ART_LIFT[biome.id] || 0);
    const gr = rgbOf(P.grout), fa = rgbOf(P.floorA), fb = rgbOf(P.floorB), ws = rgbOf(P.wallShadow), wf = rgbOf(P.wallFace), wt = rgbOf(P.wallTop), li = rgbOf(P.light);
    const rim = mixA(wt, rgbOf(P[RIM[biome.id]] || P.light), RIM_K[biome.id] || 0.3);
    const fl = mulA(fa, lift);
    o = {
      floor: ramp5([mixA(mulA(gr, lift * 0.9), fl, 0.35), fl, mixA(fl, mulA(fb, lift), 0.5), mixA(fl, wt, 0.5), wt]),
      wall: ramp5([ws, mixA(ws, wf, 0.6), mixA(wf, wt, 0.28), wt, rim]),
      flame: ((fb) => [mulA(fb, 0.3), mulA(fb, 0.62), fb, mixA(fb, [255, 255, 255], 0.5), [255, 255, 255]])(biome.id === 'ossuary' || biome.id === 'cinderforge' ? li : mixA(rgbOf(P.accent), li, 0.3)), // warm strata keep their light colour; the cold ones a saturated flame
    };
    rampCache.set(biome.id, o);
    return o;
  }
  // Pixel recolour modes: each takes a packed RGBA source pixel and returns the replacement (or the pixel itself).
  function modeFn(cat, biome) {
    const rp = rampsFor(biome), P = biome.pal, ramp = cat === 'floor' ? rp.floor : rp.wall;
    const stone = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) <= 56 && lumOf(r, g, b) <= 0.8;
    const acc = rgbOf(P.accent);
    return (px) => {
      const r = px & 255, g = (px >>> 8) & 255, b = (px >>> 16) & 255;
      if (cat === 'torch') {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (r > b + 40 && mx - mn > 80) { const L = lumOf(r, g, b), q = L < 0.25 ? 0 : L < 0.45 ? 1 : L < 0.62 ? 2 : L < 0.82 ? 3 : 4; return packA(rp.flame[q]); } // flame pixels onto the stratum's light colour
        return px;
      }
      if ((cat === 'goo' || cat === 'splash') && g > r + 25 && g > b - 10 && Math.max(r, g, b) - Math.min(r, g, b) > 50) { const L = lumOf(r, g, b); return packA(mixA(mulA(acc, 0.45), mixA(acc, [255, 255, 255], 0.4), Math.min(1, L * 1.25))); }
      if (cat === 'splash') return 0; // only the slime of the sprite: the drip landing on the floor
      if (cat === 'grate' && b > r + 20) { const L = lumOf(r, g, b); return packA(L < 0.3 ? [90, 28, 10] : [255, 122, 42]); } // sewer grate becomes a furnace vent
      if (cat === 'gate') { const L = lumOf(r, g, b); if (Math.max(r, g, b) - Math.min(r, g, b) > 40 && b > r) return packA(mixA(rp.wall(0.58), rp.wall(0.76), 0.5)); if (L > 0.15) return packA(rp.wall(L * 1.1)); return px; }
      if (cat === 'carpet') return carpetPx(px, r, g, b);
      if (stone(r, g, b)) return packA(ramp(lumOf(r, g, b)));
      return px;
    };
  }
  const CARPET = [[14, 52, 58], [24, 88, 94], [36, 124, 128], [214, 172, 84], [255, 234, 150]]; // Sanctum runner: teal field, gold trim (fringe, shade, field, trim, bright trim)
  function carpetPx(px, r, g, b) {
    const L = lumOf(r, g, b);
    return packA(CARPET[L < 0.27 ? 0 : L < 0.4 ? 1 : L < 0.55 ? 2 : L < 0.7 ? 3 : 4]);
  }

  // Frames of the recoloured world sheet: [mode, anim id].
  const SHEET = [];
  { const add = (cat, id) => SHEET.push([cat, id]);
    for (let i = 1; i <= 8; i++) add('floor', 'tile.floor.' + i);
    for (let i = 1; i <= 6; i++) add('floor', 'tile.dark.floor.' + i);
    add('floor', 'tile.spikes');
    for (const s of ['left', 'mid', 'right']) { add('wall', 'tile.wall.cap.' + s); add('wall', 'tile.wall.face.' + s); }
    for (const s of ['left', 'right']) { add('wall', 'tile.wall.side.' + s); add('wall', 'tile.door.frame.' + s); }
    for (const s of ['left', 'right']) { add('wall', 'tile.wall.outer.front.' + s); add('wall', 'tile.wall.outer.top.' + s); }
    add('wall', 'tile.wall.hole.1'); add('wall', 'tile.wall.hole.2'); add('goo', 'tile.wall.goo'); add('splash', 'tile.wall.goo.base'); add('grate', 'tile.wall.grate');
    add('wall', 'tile.door.leaf.closed'); add('wall', 'tile.door.leaf.open');
    add('gate', 'tile.gate.bars'); add('gate', 'tile.gate.bars.side');
    for (let i = 1; i <= 3; i++) add('wall', 'tile.fountain.top.' + i);
    for (const c of ['red', 'blue']) add('wall', 'tile.fountain.mid.' + c);
    for (const c of ['red', 'blue', 'green', 'yellow']) add('wall', 'deco.banner.' + c);
    add('torch', 'tile.torch.wall'); add('torch', 'tile.torch.floor');
    for (const s of ['run.fill', 'run.top', 'run.bot']) add('carpet', 'tile.carpet.red.' + s);
    add('wall', 'prop.column');
  }
  let wpx = null; // pixels of the world page, read once
  function worldPixels() {
    if (wpx) return wpx;
    const pg = A.pages.world, w = pg.width, h = pg.height, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(pg, 0, 0);
    wpx = { w, h, px: new Uint32Array(g.getImageData(0, 0, w, h).data.buffer) };
    return wpx;
  }
  const sheets = new Map();
  // Recoloured frames of one stratum packed into a canvas: { src, rects: { id: [{ x, y, w, h, ox, oy }] } } (src becomes an ImageBitmap once ready).
  function sheetFor(biome) {
    let sh = sheets.get(biome.id);
    if (sh) return sh;
    const t0 = performance.now(), wp = worldPixels(), SW = 512, rects = {};
    let x = 0, y = 0, rowH = 0;
    const items = [];
    for (const [cat, id] of SHEET) {
      const r = A.anim(id); if (!r) continue;
      rects[id] = [];
      for (let i = 0; i < r.n; i++) {
        const f = r.f[i]; if (x + f.w + 1 > SW) { x = 0; y += rowH + 1; rowH = 0; }
        const q = { x, y, w: f.w, h: f.h, ox: f.ox, oy: f.oy }; rects[id].push(q); items.push([cat, f, q]);
        x += f.w + 1; rowH = Math.max(rowH, f.h);
      }
    }
    const SH = y + rowH + 1, cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
    const g = cv.getContext('2d'), img = g.createImageData(SW, SH), out = new Uint32Array(img.data.buffer), fns = {};
    for (const [cat, f, q] of items) {
      const fn = fns[cat] || (fns[cat] = modeFn(cat, biome));
      for (let yy = 0; yy < f.h; yy++) for (let xx = 0; xx < f.w; xx++) {
        const px = wp.px[(f.y + yy) * wp.w + f.x + xx];
        if ((px >>> 24) === 0) continue;
        out[(q.y + yy) * SW + q.x + xx] = fn(px);
      }
    }
    g.putImageData(img, 0, 0);
    sh = { src: cv, rects };
    sheets.set(biome.id, sh);
    Bmp.from(cv, (b) => { if (sheets.get(biome.id) === sh) sh.src = b; else Bmp.free(b); });
    Tl.sheetMs = (Tl.sheetMs || 0) + performance.now() - t0;
    return sh;
  }
  // Draws frame i of `id` from the sheet with the logical frame's top-left at art px (ax, ay); cols [c0, c1) of the logical frame only when given (column c0 lands on ax).
  // Rows [r0, r1) of the logical frame likewise (row r0 lands on ay).
  function sblit(g, sh, id, i, ax, ay, c0, c1, r0, r1) {
    const q = sh.rects[id]; if (!q) return false;
    const m = q[i | 0]; if (!m || !m.w) return false;
    let sx = m.x, sw = m.w, dx = m.ox, sy = m.y, sh_ = m.h, dy = m.oy;
    if (c0 !== undefined) { const a = Math.max(dx, c0), b = Math.min(dx + sw, c1); if (b <= a) return false; sx += a - dx; sw = b - a; dx = a - c0; }
    if (r0 !== undefined) { const a = Math.max(dy, r0), b = Math.min(dy + sh_, r1); if (b <= a) return false; sy += a - dy; sh_ = b - a; dy = a - r0; }
    g.drawImage(sh.src, sx, sy, sw, sh_, (ax + dx) * K, (ay + dy) * K, sw * K, sh_ * K);
    return true;
  }

  // ---------- decor catalogue: kind -> [anim id prefix, variants, tint, tall] ----------
  // tall: drawn y-sorted with the entities (Tl.statics); the rest is baked flat under them. Kinds not listed are procedural (see procDecor).
  const DECOR = {
    bones: ['deco.bones.', 5, 'bone', false], skull: ['deco.skull', 0, '', false], moss: ['deco.moss.', 3, 'moss', false], candle: ['deco.candle.', 4, '', true], urn: ['deco.urn.', 6, '', true],
    mushroom: ['deco.mushroom.', 4, 'glow', true], root: ['deco.root.', 2, 'root', false], puddle: ['deco.puddle.', 4, 'puddle', false], crystal: ['deco.crystal.', 3, '', true],
    shard: ['deco.shard.', 3, 'shard', true], pillarstub: ['deco.pillarstub', 0, 'stone', true], frozenbones: ['deco.bones.', 5, 'ice', false], chain: ['deco.chain', 0, '', false],
    anvil: ['prop.anvil', 0, 'iron', true], grate: ['deco.grate', 0, '', false], coral: ['deco.coral.', 2, '', true], seaweed: ['deco.seaweed.', 2, '', true], shell: ['deco.shell.', 3, '', false], crate: ['deco.crate.', 2, '', true],
  };
  const PUDDLE_V = { glowmire: [1, 2], sanctum: [2], ossuary: [3, 3], abyss: [2] }; // variants that suit the stratum (others: all)
  // Smashable props of a room (room.breakables) as tall statics, never baked: { k: 'brk', bi (index = bit of roomState.broken), x, y, key, h, id + vk (atlas sprite and its tint; id '' = the procedural sprite), kind, bid, v, sc, gc / gr / gy / ga (glow colour, radius, height, alpha; gc null = none) }.
  // The renderer drops the ones whose bit is set (R.liveStatics) and queues the glow of the rest.
  function breakStatics(room, biome, P, art) {
    const out = [], bid = biome.id;
    for (let bi = 0; bi < room.breakables.length; bi++) {
      const d = room.breakables[bi], spec = DECOR[d.k], wx = snap(d.x * T), wy = snap(d.y * T);
      let id = '', vk = '';
      if (art && spec) {
        const n = spec[1], sid = n ? spec[0] + Math.min(n - 1, Math.floor(d.v * n)) : spec[0];
        if (A.has(sid)) { id = sid; vk = spec[2] ? tintVariant(sid, spec[2], biome) : ''; }
      }
      const gl = d.k === 'mushroom' ? [bid === 'glowmire' ? P.accent : P.accent2, 15, 8, 0.5] : d.k === 'crystal' ? [P.accent, 14, 10, 0.45] : d.k === 'shard' ? ['#b78cff', 12, 8, 0.4] : null;
      out.push({ k: 'brk', bi, x: wx, y: wy, key: wy, h: 0, id, vk, kind: d.k, bid, v: d.v, sc: Math.round(d.s * 5) / 5, gc: gl ? gl[0] : null, gr: gl ? gl[1] : 0, gy: gl ? gl[2] : 0, ga: gl ? gl[3] : 0 });
    }
    return out;
  }
  // Tinted copies of decor sprites: luminance onto a ramp, dark outlines kept. key -> stops (hex list, dark to light).
  function tintStops(kind, biome) {
    const P = biome.pal, a = P.accent, a2 = P.accent2;
    switch (kind) {
      case 'bone': return [U.shade(a2, -0.7), U.shade(a2, -0.35), a2, U.shade(a2, 0.45)];
      case 'ice': return ['#5a7a96', '#9fc4dc', '#dff3ff', '#ffffff'];
      case 'moss': return [U.shade(a, -0.7), U.shade(a, -0.4), a, U.shade(a, 0.4)];
      case 'root': return [U.shade(a, -0.8), U.shade(a, -0.6), U.shade(a2, -0.4), a];
      case 'glow': return biome.id === 'glowmire' ? [U.shade(a, -0.65), U.shade(a, -0.3), a, U.shade(a, 0.55)] : null;
      case 'shard': return ['#2a1850', '#6a42b8', a, U.shade(a, 0.6)];
      case 'iron': return ['#171a26', '#3d465e', '#69748f', '#9aa5be'];
      case 'stone': { const rp = rampsFor(biome); return [hexA(rp.wall(0.25)), hexA(rp.wall(0.39)), hexA(rp.wall(0.58)), hexA(rp.wall(0.76))]; }
      case 'puddle': return biome.id === 'abyss' ? ['#1a0f33', '#3a2a66', a, U.shade(a, 0.5)] : null;
      default: return null;
    }
  }
  const tintDone = new Set();
  function tintVariant(id, kind, biome, only) {
    const key = 'pal:w' + biome.id + kind + (only ? 'o' : '');
    if (tintDone.has(id + key)) return key;
    const stops = tintStops(kind, biome); if (!stops) return '';
    const ok = A.variant(id, key, (pal) => tintMap(pal, stops, only));
    if (ok) tintDone.add(id + key);
    return ok ? key : '';
  }
  // Palette map of the hexes in `pal` (only those in `only` when given) onto the ramp `stops` by luminance; outlines stay.
  function tintMap(pal, stops, only) {
    const rgbs = stops.map(rgbOf), m = {};
    for (const hex of pal) {
      if (only && only.indexOf(hex) < 0) continue;
      const c = rgbOf(hex), L = lumOf(c[0], c[1], c[2]);
      if (L < 0.17) continue; // outline stays
      const q = Math.min(1, Math.max(0, (L - 0.17) / 0.78)) * (rgbs.length - 1), i = Math.min(rgbs.length - 2, Math.floor(q));
      m[hex] = hexA(mixA(rgbs[i], rgbs[i + 1], q - i));
    }
    return m;
  }
  // Atlas variant key of sprite `id` recoloured onto the stratum's wall stone ramp (only the palette hexes in `only` when given); '' while the atlas cannot build it. Built once per sprite and stratum.
  Tl.stoneKey = (id, biome, only) => tintVariant(id, 'stone', biome, only);
  // The same recolour as a palette map for Atlas.variant (props that also recolour other parts of their palette).
  Tl.stoneMap = (pal, biome, only) => tintMap(pal, tintStops('stone', biome), only);
  const snap = (v) => Math.round(v / K) * K; // world px -> the art grid

  // Random-walk path of n art px from (x, y): mostly horizontal, used for cracks and lava seams.
  function walk(rr, x, y, n) {
    const out = [[x, y]];
    for (let i = 1; i < n; i++) { const r = rr.next(); if (r < 0.5) x++; else if (r < 0.7) { x++; y++; } else if (r < 0.9) { x++; y--; } else y += rr.next() < 0.5 ? 1 : -1; out.push([x, y]); }
    return out;
  }

  // ---------- hazard pools: 4 animated 16x16 frames per cell, drawn per frame (lava, poison, water, ice, void) ----------
  const HZ_NF = 4;
  // Smooth value noise in [0, 1) over a precomputed lattice (w lattice columns, h rows of hash values).
  function noiseTab(w, h, n) { const t = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) t[j * w + i] = hash(i, j, n); return { t, w }; }
  function hzNoise(tab, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), i = yi * tab.w + xi, t = tab.t, a = t[i], b = t[i + 1], c = t[i + tab.w], d = t[i + tab.w + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const HZ_RAMP = {
    lava: ['#9c2c08', '#d8480c', '#f58a22', '#ffcf5a'], poison: ['#1a361a', '#24502a', '#356f33', '#79cf48'], water: ['#0a2f42', '#0f4a60', '#16607a', '#2b88a4'],
    ice: ['#bfe0f1', '#cdeaf8', '#e4f5fd', '#f2fbff'], void: ['#05010a', '#0a0222', '#12062e', '#1c0a44'],
  };
  const pk = (hex) => packA(rgbOf(hex));
  // Packs frames for the hazard cells [[tx, ty, edgeMask]] into a canvas of HZ_NF columns; mask bits: 1 top, 2 right, 4 bottom, 8 left open (non-hazard side).
  function buildHazard(room, biome, cells, s) {
    const kind = biome.hazard, n = cells.length;
    const cv = document.createElement('canvas'); cv.width = HZ_NF * AT; cv.height = Math.max(1, n * AT);
    const g = cv.getContext('2d'), img = g.createImageData(cv.width, cv.height), out = new Uint32Array(img.data.buffer), W = cv.width;
    const ramp = (HZ_RAMP[kind] || HZ_RAMP.lava).map(pk), dkEdge = { lava: '#1a0a05', poison: '#0c1c0e', water: '#052330', ice: '#6fa6c6', void: '#03000a' }[kind], rim1 = { lava: '#46200e', poison: '#10230f', water: '#0c3c52', ice: '#f4fcff', void: '#14083a' }[kind];
    const edgeC = pk(dkEdge), rimC = pk(rim1), crust = [pk('#2a0f08'), pk('#3a160b'), pk('#7a3410')];
    const sd = 91 + (s & 15), S1 = kind === 'water' ? 0.17 : 0.075, bub = [];
    const tab1 = noiseTab(Math.ceil(room.w * AT * S1) + 3, Math.ceil(room.h * AT * S1) + 3, sd), tab2 = noiseTab(Math.ceil(room.w * AT * 0.18 + 17) + 3, Math.ceil(room.h * AT * 0.18 + 5) + 3, 92);
    const nq = new Float32Array(AT * AT);
    cells.forEach(([tx, ty, mask], ci) => {
      let thr0 = 0.64; // lava: crust above this noise level; raised per cell so at least ~40% of every cell stays molten
      if (kind === 'lava') { for (let py = 0; py < AT; py++) for (let px = 0; px < AT; px++) nq[py * AT + px] = hzNoise(tab1, (tx * AT + px) * S1, (ty * AT + py) * S1); nq.sort(); thr0 = Math.max(thr0, nq[(AT * AT * 0.42) | 0] + 0.03); }
      if (kind === 'poison') { bub.length = 0; for (let k = 0; k < 2; k++) bub.push([3 + Math.floor(hash(tx, ty, 200 + k) * 10), 3 + Math.floor(hash(tx, ty, 210 + k) * 10), Math.floor(hash(tx, ty, 220 + k) * 4)]); }
      for (let py = 0; py < AT; py++) for (let px = 0; px < AT; px++) {
        const gx = tx * AT + px, gy = ty * AT + py;
        let d = 99;
        if (mask & 1) d = Math.min(d, py); if (mask & 4) d = Math.min(d, AT - 1 - py); if (mask & 8) d = Math.min(d, px); if (mask & 2) d = Math.min(d, AT - 1 - px);
        const n1 = hzNoise(tab1, gx * S1, gy * S1), n2 = hzNoise(tab2, gx * 0.18 + 17, gy * 0.18 + 5), hs = hash(gx, gy, 93), up = kind === 'lava' ? hzNoise(tab1, gx * S1, Math.max(0, gy - 1) * S1) : 0;
        for (let f = 0; f < HZ_NF; f++) {
          let c;
          if (d === 0) c = edgeC;
          else if (kind === 'lava') { // dark crust plates floating on molten rock; the crust edge breathes
            const thr = thr0 + 0.022 * Math.sin(f * 1.5708 + n2 * 6.28), v = thr - n1;
            if (v < 0) c = up <= thr ? crust[2] : (hs > 0.8 ? crust[1] : crust[0]);
            else { c = v < 0.05 ? pk('#f59a2a') : v < 0.15 ? pk('#dd5f14') : pk('#b0360b'); if (hs > 0.992 && (f + (hs * 400 | 0)) % HZ_NF === 0) c = pk('#ffe0a0'); }
          } else if (kind === 'poison') { // murky pool with algae and rising bubbles
            if (d === 1) c = rimC;
            else {
              c = n1 < 0.45 ? ramp[0] : n1 < 0.65 ? ramp[1] : ramp[2]; if (n2 > 0.8 && n1 > 0.5) c = pk('#5da446');
              for (const [bx, by, ph] of bub) { const dx = px - bx, dy = py - by, q = (f + ph) % 4; if (q === 1 && !dx && !dy) c = pk('#9ad85a'); else if (q === 2 && ((Math.abs(dx) + Math.abs(dy)) === 1)) c = pk('#7fc24a'); else if (q === 2 && !dx && !dy) c = pk('#d8ffa8'); else if (q === 3 && !dx && !dy) c = pk('#ffffff'); }
            }
          } else if (kind === 'water') {
            if (d === 1) c = rimC;
            else { const wv = Math.sin(gx * 0.5 + gy * 0.85 + f * 1.571 + n1 * 3); c = wv > 0.94 ? pk('#8be8f0') : wv > 0.78 ? ramp[3] : ramp[Math.min(2, Math.floor(n2 * 3))]; }
          } else if (kind === 'ice') { // frosted glaze: soft patches, hairline cracks, an occasional glint
            if (d === 1) c = rimC;
            else {
              c = n1 < 0.4 ? ramp[0] : n1 > 0.68 ? ramp[2] : ramp[1];
              if (Math.abs(n2 - 0.5) < 0.018) c = pk('#8fc0da');
              else if (hs > 0.992 && (f + (hs * 400 | 0)) % HZ_NF === 0) c = pk('#ffffff');
            }
          } else { // void: faint nebula that drifts slowly, twinkling stars
            if (d === 1) c = rimC;
            else {
              const shift = 0.02 * Math.sin(f * 1.5708 + n2 * 6.28), v = n1 + shift;
              c = v < 0.5 ? ramp[0] : v < 0.68 ? ramp[1] : v < 0.82 ? ramp[2] : ramp[3];
              if (hs > 0.987) c = ((f + (hs * 700 | 0)) % HZ_NF < 2) ? pk('#c9b0ff') : pk('#6a50a8'); else if (hs < 0.002) c = pk('#ffffff');
            }
          }
          out[(ci * AT + py) * W + f * AT + px] = c;
        }
      }
    });
    g.putImageData(img, 0, 0);
    return cv;
  }

  // ---------- the room ----------
  function paintArt(room, scale) {
    const biome = ED.biomeFor(room.stratum), P = biome.pal, bid = biome.id, W = room.w, H = room.h, s = room.seed | 0, rp = rampsFor(biome), sh = sheetFor(biome), tiles = room.tiles;
    const mk = (px) => { const cv = document.createElement('canvas'); cv.width = Math.ceil(W * T * px); cv.height = Math.ceil(H * T * px); cv.px = px; return cv; };
    const cv = mk(scale), g = cv.getContext('2d'); g.scale(scale, scale); g.imageSmoothingEnabled = false;
    const ev = mk(scale), e = ev.getContext('2d'); e.scale(scale, scale); e.globalCompositeOperation = 'lighter'; e.imageSmoothingEnabled = false;
    const gv = mk(scale * 0.5), gm = gv.getContext('2d'); gm.scale(scale * 0.5, scale * 0.5); gm.globalCompositeOperation = 'lighter';
    const out = { canvas: cv, emis: ev, glowmap: gv, art: true, statics: breakStatics(room, biome, P, true), hz: null, hzCells: [], spikes: [], fountains: [], doorArt: {} };
    const fill = (c, ax, ay, aw, ah, col) => { c.fillStyle = col; c.fillRect(ax * K, ay * K, aw * K, ah * K); };
    const adraw = (c, id, i, x, y, o) => { A.draw(c, id, i, x, y, o); c.imageSmoothingEnabled = false; }; // Atlas.draw leaves smoothing on
    const T_ = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 1 : tiles[y * W + x]);
    const isM = (x, y) => { if (y >= H) return false; if (x < 0 || y < 0 || x >= W) return true; const t = tiles[y * W + x]; return t === 1 || t === 2; };
    const faceAt = (x, y) => isM(x, y) && !isM(x, y + 1);
    const colArt = !!sh.rects['prop.column'];
    const isCol = (x, y) => colArt && T_(x, y) === 2 && !isM(x - 1, y) && !isM(x + 1, y) && !isM(x, y - 1) && !isM(x, y + 1);
    const isW = (x, y) => isM(x, y) && !isCol(x, y); // wall mass that casts the soft floor bands (columns cast their own blob)
    const ao = U.shade(P.wallShadow, -0.5), rr = U.RNG(s ^ 0x7111e);
    const glowAt = (c, x, y, r, col, a) => { c.globalAlpha = a; c.drawImage(ED.Render.glowSprite(col), x - r, y - r, r * 2, r * 2); c.globalAlpha = 1; };

    // ---- floor ----
    const dark = bid === 'abyss', nv = dark ? 6 : 8, fbase = dark ? 'tile.dark.floor.' : 'tile.floor.';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tiles[y * W + x]; if (t !== 0 && t !== 4 && !isCol(x, y)) continue; // a column stands on floor
      const r = hashS(x, y, 1, s), vv = hashS(x, y, 5, s);
      sblit(g, sh, fbase + (r < 0.86 ? 1 : 2 + Math.floor((r - 0.86) / 0.14 * (nv - 1)) % (nv - 1)), 0, x * AT, y * AT);
      if (vv < 0.3) fill(g, x * AT, y * AT, AT, AT, 'rgba(0,0,0,' + (0.04 + vv * 0.2).toFixed(3) + ')'); // per-tile tone drift so the grid never reads as one flat sheet
      else if (vv > 0.88) fill(g, x * AT, y * AT, AT, AT, 'rgba(255,255,255,' + (0.03 + (vv - 0.88) * 0.3).toFixed(3) + ')');
    }
    // Sanctum runner: three rows of carpet along the door axis, trim on its long edges
    if (bid === 'sanctum') {
      const cy = (H >> 1) + 1;
      for (let x = 1; x <= W - 2; x++) for (let k = -1; k <= 1; k++) if (T_(x, cy + k) === 0 || isCol(x, cy + k)) sblit(g, sh, 'tile.carpet.red' + (k < 0 ? '.run.top' : k > 0 ? '.run.bot' : '.run.fill'), 0, x * AT, (cy + k) * AT);
    }
    // ---- chasm: far wall face on the top row, black below ----
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[y * W + x] !== 3) continue;
      const top = T_(x, y - 1) !== 3;
      fill(g, x * AT, y * AT, AT, AT, P.chasm);
      if (top) { sblit(g, sh, 'tile.wall.face.mid', 0, x * AT, y * AT); fill(g, x * AT, y * AT, AT, AT, 'rgba(0,0,0,0.5)'); }
      else if (hashS(x, y, 8, s) < 0.3) fill(g, x * AT + Math.floor(hashS(x, y, 11, s) * 15), y * AT + Math.floor(hashS(x, y, 12, s) * 15), 1, 1, bid === 'cinderforge' ? 'rgba(255,120,50,0.35)' : bid === 'abyss' ? 'rgba(200,170,255,0.3)' : 'rgba(255,255,255,0.08)'); // faint specks keep a pit from reading as a flat hole
      const gc = { cinderforge: '#ff4a1a', abyss: '#7a3aff', sanctum: '#0a6a8a', glowmire: '#2a8a6a' }[bid];
      if (gc) glowAt(gm, (x + 0.5) * T, (y + 0.65) * T, 22, gc, 0.24 + hashS(x, y, 9, s) * 0.12);
      for (const [dx, dy, ex, ey, ew, eh] of [[0, 1, 0, 15, 16, 1], [-1, 0, 0, 0, 1, 16], [1, 0, 15, 0, 1, 16]]) if (T_(x + dx, y + dy) !== 3) { fill(g, x * AT + ex, y * AT + ey, ew, eh, 'rgba(0,0,0,0.85)'); }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // lit edge of the floor where it meets a pit
      if (tiles[y * W + x] !== 0 && tiles[y * W + x] !== 4) continue;
      if (T_(x, y - 1) === 3) fill(g, x * AT, y * AT, AT, 1, 'rgba(255,255,255,0.16)');
      if (T_(x - 1, y) === 3) fill(g, x * AT, y * AT, 1, AT, 'rgba(255,255,255,0.1)');
      if (T_(x + 1, y) === 3) fill(g, x * AT + 15, y * AT, 1, AT, 'rgba(255,255,255,0.1)');
    }
    // ---- hazards: pool frames are drawn per frame; the floor tile underneath stays baked ----
    if (biome.hazard === 'spikes') { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tiles[y * W + x] === 4) out.spikes.push([x * T, y * T]); }
    else {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tiles[y * W + x] === 4) out.hzCells.push([x, y, (T_(x, y - 1) !== 4 ? 1 : 0) | (T_(x + 1, y) !== 4 ? 2 : 0) | (T_(x, y + 1) !== 4 ? 4 : 0) | (T_(x - 1, y) !== 4 ? 8 : 0)]);
      if (out.hzCells.length) out.hz = buildHazard(room, biome, out.hzCells, s);
      for (const [x, y] of out.hzCells) { // glowing pools light the buffer under entities standing on them
        if (biome.hazard === 'lava') { gm.fillStyle = 'rgba(255,110,25,0.55)'; gm.fillRect(x * T, y * T, T, T); }
        else if (biome.hazard === 'poison') glowAt(gm, (x + 0.5) * T, (y + 0.5) * T, 22, '#7ad44a', 0.26);
        else if (biome.hazard === 'void') glowAt(gm, (x + 0.5) * T, (y + 0.5) * T, 20, '#a85aff', 0.4);
      }
    }
    // ---- decor ----
    let di = 0;
    for (const d of room.decor) {
      di++;
      const wx = snap(d.x * T), wy = snap(d.y * T), ax = wx / K, ay = wy / K, spec = DECOR[d.k];
      if (!spec) { procDecor(d.k, ax, ay, d.v, U.RNG(s ^ (di * 7919))); continue; }
      if (d.k === 'pillarstub') { out.statics.push({ k: 'stub', x: wx, y: wy, key: wy, h: 0 }); continue; }
      let n = spec[1], v = n ? Math.min(n - 1, Math.floor(d.v * n)) : 0;
      if (spec[0] === 'deco.puddle.' && PUDDLE_V[bid]) { const pv = PUDDLE_V[bid]; v = pv[Math.floor(d.v * pv.length) % pv.length]; }
      const id = n ? spec[0] + v : spec[0];
      if (!A.has(id)) continue;
      const vk = spec[2] ? tintVariant(id, spec[2], biome) : '';
      if (spec[3]) { out.statics.push({ k: 'deco', id, vk, x: wx, y: wy, key: wy, h: 0 }); }
      else if (d.k === 'chain') { // lying chain: the upright sprite turned 90 degrees
        g.save(); g.translate(wx, wy); g.rotate(Math.PI / 2); adraw(g, id, 0, 0, 0, {}); g.restore();
      } else adraw(g, id, 0, wx, wy, vk ? { variant: vk } : undefined);
      if (d.k === 'candle') glowAt(e, wx, wy - 14, 9, '#ffb35c', 0.7);
      else if (d.k === 'mushroom') glowAt(e, wx, wy - 8, 15, bid === 'glowmire' ? P.accent : P.accent2, 0.5);
      else if (d.k === 'crystal') glowAt(e, wx, wy - 10, 14, P.accent, 0.45);
      else if (d.k === 'shard') glowAt(e, wx, wy - 8, 12, '#b78cff', 0.4);
      else if (d.k === 'grate') { glowAt(e, wx, wy - 4, 16, '#ff7a2a', 0.4); e.fillStyle = 'rgba(255,110,30,0.5)'; e.fillRect(wx - 6, wy - 8, 12, 6); }
    }
    function procDecor(k, ax, ay, v, rg) {
      const dot = (c, x, y, w, h, col) => fill(c, x, y, w || 1, h || 1, col);
      switch (k) {
        case 'crack': { const p = walk(rg, ax - 6, ay - 1, 9 + Math.floor(v * 5)); for (const [x, y] of p) { dot(g, x, y, 1, 1, 'rgba(0,0,0,0.5)'); dot(g, x, y + 1, 1, 1, 'rgba(255,255,255,0.06)'); } break; }
        case 'lavacrack': case 'voidcrack': {
          const lava = k === 'lavacrack', p = walk(rg, ax - 7, ay - 1, 12 + Math.floor(v * 4)), c1 = lava ? '#ff7a2a' : '#c98bff', c2 = lava ? '#ffd36b' : '#f0d8ff';
          p.forEach(([x, y], i) => { dot(g, x, y - 1, 1, 3, lava ? 'rgba(15,4,2,0.8)' : 'rgba(8,0,20,0.8)'); });
          p.forEach(([x, y], i) => { dot(g, x, y, 1, 1, i % 3 === 1 ? c2 : c1); dot(e, x, y, 1, 1, lava ? 'rgba(255,140,50,0.8)' : 'rgba(210,140,255,0.8)'); });
          glowAt(e, ax * K, ay * K, 16, lava ? '#ff6a2a' : '#b78cff', 0.32); break;
        }
        case 'cinders': {
          for (const [dx, dy, w] of [[-3, -1, 7], [-4, 0, 9], [-3, 1, 7]]) dot(g, ax + dx, ay + dy, w, 1, 'rgba(30,20,16,0.5)');
          for (let i = 0; i < 6; i++) { const x = ax - 4 + Math.floor(rg.next() * 9), y = ay - 1 + Math.floor(rg.next() * 3); dot(g, x, y, 1, 1, '#ff8a3a'); dot(e, x, y, 1, 1, 'rgba(255,150,60,0.85)'); }
          glowAt(e, ax * K, ay * K, 12, '#ff8a3a', 0.25); break;
        }
        case 'glowcap': {
          const col = P.accent2; dot(g, ax, ay - 1, 1, 2, '#d8d0c0'); dot(g, ax - 2, ay - 3, 5, 2, col); dot(g, ax - 1, ay - 4, 3, 1, col); dot(g, ax - 1, ay - 3, 1, 1, U.shade(col, 0.5));
          dot(e, ax - 2, ay - 3, 5, 2, U.rgba(col, 0.7)); glowAt(e, ax * K, (ay - 3) * K, 15, col, 0.55); break;
        }
        case 'snow': {
          for (const [dx, dy, w] of [[-5, 0, 11], [-4, -1, 9], [-3, 1, 7]]) dot(g, ax + dx, ay + dy, w, 1, dy === 1 ? 'rgba(70,110,150,0.4)' : dy === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.95)'); break;
        }
        case 'goldtile': {
          const gc = '#e8c66b'; dot(g, ax - 6, ay - 6, 12, 12, 'rgba(30,20,6,0.3)');
          for (let i = 0; i < 12; i++) { dot(g, ax - 6 + i, ay - 6, 1, 1, gc); dot(g, ax - 6 + i, ay + 5, 1, 1, gc); dot(g, ax - 6, ay - 6 + i, 1, 1, gc); dot(g, ax + 5, ay - 6 + i, 1, 1, gc); }
          for (let i = 0; i < 6; i++) { dot(g, ax - 1 - i, ay - 6 + i + 0, 1, 1, 'rgba(255,230,140,0.8)'); dot(g, ax + i, ay - 6 + i, 1, 1, 'rgba(255,230,140,0.8)'); dot(g, ax - 6 + i, ay + i, 1, 1, 'rgba(255,230,140,0.8)'); dot(g, ax + 5 - i, ay + i, 1, 1, 'rgba(255,230,140,0.8)'); }
          dot(g, ax - 1, ay - 1, 2, 2, '#fff0a8'); dot(e, ax - 6, ay - 6, 12, 12, 'rgba(255,214,110,0.12)'); glowAt(e, ax * K, ay * K, 14, '#ffd36b', 0.25); break;
        }
        case 'rune': {
          const c1 = U.rgba(P.accent, 0.5), pts = [], vr = Math.floor(v * 3); // three glyph variants: bar, cross, diagonals
          for (let a = 0; a < 24; a++) { const th = a / 24 * Math.PI * 2; pts.push([Math.round(ax + Math.cos(th) * 5), Math.round(ay - 1 + Math.sin(th) * 4)]); }
          for (const [x, y] of pts) { dot(g, x, y, 1, 1, c1); dot(e, x, y, 1, 1, U.rgba(P.accent, 0.55)); }
          for (let i = -3; i <= 3; i++) {
            const pp = vr === 0 ? [[ax, ay - 1 + i]] : vr === 1 ? [[ax, ay - 1 + i], [ax + i, ay - 1]] : [[ax + i, ay - 1 + i], [ax + i, ay - 1 - i]];
            for (const [x, y] of pp) { dot(g, x, y, 1, 1, c1); dot(e, x, y, 1, 1, U.rgba(P.accent, 0.5)); }
          }
          glowAt(e, ax * K, ay * K, 16, P.accent, 0.2); break;
        }
        case 'starfield': {
          for (let i = 0; i < 5; i++) { const x = ax - 6 + Math.floor(rg.next() * 12), y = ay - 4 + Math.floor(rg.next() * 8); dot(g, x, y, 1, 1, '#efe6ff'); dot(e, x, y, 1, 1, 'rgba(240,230,255,0.9)'); if (i < 2) { dot(e, x - 1, y, 3, 1, 'rgba(200,180,255,0.4)'); dot(e, x, y - 1, 1, 3, 'rgba(200,180,255,0.4)'); } }
          glowAt(e, ax * K, ay * K, 12, '#9a7aff', 0.15); break;
        }
        default: break;
      }
    }
    // ---- soft shadows (stepped bands) cast on the floor by walls, blocks and pits ----
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tiles[y * W + x]; if (t !== 0 && t !== 5 && t !== 4) continue;
      if (t === 4 && biome.hazard !== 'spikes') continue;
      const ox = x * AT, oy = y * AT, n = isW(x, y - 1), w = isW(x - 1, y), ea = isW(x + 1, y), so = isW(x, y + 1);
      if (n) { fill(g, ox, oy, AT, 2, U.rgba(ao, 0.5)); fill(g, ox, oy + 2, AT, 2, U.rgba(ao, 0.34)); fill(g, ox, oy + 4, AT, 3, U.rgba(ao, 0.18)); fill(g, ox, oy + 7, AT, 3, U.rgba(ao, 0.08)); }
      if (w) { fill(g, ox, oy, 2, AT, U.rgba(ao, 0.34)); fill(g, ox + 2, oy, 3, AT, U.rgba(ao, 0.15)); }
      if (ea) { fill(g, ox + AT - 2, oy, 2, AT, U.rgba(ao, 0.34)); fill(g, ox + AT - 5, oy, 3, AT, U.rgba(ao, 0.15)); }
      if (so) fill(g, ox, oy + AT - 3, AT, 3, U.rgba(ao, 0.22));
    }

    // ---- wall mass: dark tops, side strips, brick faces, cap strips ----
    const blocked = new Set(); // face columns kept clear of wall decor (torches, doors, fountains)
    for (const tc of room.torches) blocked.add(Math.floor(tc.x));
    if (room.doors.n >= 0) { const r = ED.Dungeon.doorRect(room, 'n'); for (let x = r.x0 - 2; x <= r.x1 + 2; x++) blocked.add(x); }
    const fxs = [];
    if (bid === 'cinderforge' || bid === 'sanctum') { // wall fountains on the top wall, clear of torches and the door
      const cand = []; for (let x = 3; x <= W - 4; x++) if (!blocked.has(x) && !room.torches.some((tc) => Math.abs(tc.x - 0.5 - x) < 2)) cand.push(x);
      cand.sort((a, b) => hashS(a, 0, 50, s) - hashS(b, 0, 50, s));
      for (const x of cand) { if (fxs.length >= (W >= 21 ? 2 : 1)) break; if (fxs.every((q) => Math.abs(q - x) >= 6)) fxs.push(x); }
      for (const x of fxs) { blocked.add(x - 1); blocked.add(x); blocked.add(x + 1); }
    }
    const btop = hexA(mixA(rgbOf(P.wallFace), rgbOf(P.wallTop), 0.3));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // tops of mass that is not a face
      if (!isM(x, y) || faceAt(x, y) || isCol(x, y)) continue;
      const ox = x * AT, oy = y * AT;
      if (T_(x, y) === 2) { fill(g, ox, oy, AT, AT, btop); if (!isM(x, y - 1)) { fill(g, ox, oy, AT, 1, hexA(rp.wall(0.133))); fill(g, ox, oy + 1, AT, 1, hexA(rp.wall(0.58))); } }
      const eS = x === 0 || !isM(x + 1, y), wS = x === W - 1 || !isM(x - 1, y);
      if (eS) sblit(g, sh, 'tile.wall.side.left', 0, ox, oy);
      if (wS) sblit(g, sh, 'tile.wall.side.right', 0, ox, oy);
    }
    const gooX = []; // columns of goo wall faces: the drip lands on a base tile of the floor row below
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // brick faces and their cap strips
      if (!faceAt(x, y) || isCol(x, y)) continue;
      const cl = faceAt(x - 1, y), cr = faceAt(x + 1, y), ox = x * AT, oy = y * AT;
      if ((x === 0 || x === W - 1) && sblit(g, sh, 'tile.wall.outer.front.' + (x ? 'right' : 'left'), 0, ox, oy)) { // outer corner: only the pillar column beside the side strip, not a full brick tile
        sblit(g, sh, 'tile.wall.outer.top.' + (x ? 'right' : 'left'), 0, ox, isM(x, y - 1) ? oy - AT : oy - 12);
        continue;
      }
      let special = null;
      if (cl && cr && y === 1 && !blocked.has(x)) {
        const r = hashS(x, y, 2, s);
        if (bid === 'ossuary') special = r < 0.06 ? 'tile.wall.hole.1' : r < 0.1 ? 'tile.wall.hole.2' : r < 0.17 ? 'deco.banner.' + ['red', 'green', 'blue', 'yellow'][Math.floor(r * 100) % 4] : null;
        else if (bid === 'glowmire') special = r < 0.14 ? 'tile.wall.goo' : null;
        else if (bid === 'cinderforge') special = r < 0.12 ? 'tile.wall.grate' : null;
        else if (bid === 'sanctum') special = r < 0.07 ? 'deco.banner.' + (r < 0.035 ? 'yellow' : 'blue') : null;
      }
      if (special === 'tile.wall.goo') gooX.push(x);
      if (special) sblit(g, sh, special, 0, ox, oy);
      else if (!cl && !cr) { sblit(g, sh, 'tile.wall.face.left', 0, ox, oy, 0, 8); sblit(g, sh, 'tile.wall.face.right', 0, ox + 8, oy, 8, 16); }
      else sblit(g, sh, 'tile.wall.face.' + (!cl ? 'left' : !cr ? 'right' : 'mid'), 0, ox, oy);
      const cap = 'tile.wall.cap.' + (!cl && !cr ? 'mid' : !cl ? 'left' : !cr ? 'right' : 'mid');
      if (isM(x, y - 1)) sblit(g, sh, cap, 0, ox, oy - AT); else sblit(g, sh, cap, 0, ox, oy - 12); // strip above the face; a one-row run carries it in its own top rows
      if (bid === 'rimefrost' && y === 1 && cl && cr) { // icicles under the cap
        for (let k = 0; k < 3; k++) { const hh = hashS(x, k, 60, s); if (hh < 0.45) continue; const ix = ox + 2 + k * 5 + Math.floor(hh * 3), len = 2 + Math.floor(hashS(x, k, 61, s) * 5); fill(g, ix, oy + 2, 1, len, '#f2fbff'); fill(g, ix + 1, oy + 2, 1, Math.max(1, len - 2), '#9fc8e0'); fill(g, ix, oy + 2 + len, 1, 1, '#cfeeff'); }
      }
      if (bid === 'abyss' && y === 1 && cl && cr && hashS(x, y, 70, s) < 0.12) { // glowing rune on the face
        const c1 = U.rgba(P.accent, 0.75); for (const [dx, dy, w, h] of [[5, 5, 6, 1], [5, 5, 1, 6], [10, 5, 1, 6], [5, 10, 6, 1], [7, 7, 2, 2]]) { fill(g, ox + dx, oy + dy, w, h, c1); fill(e, ox + dx, oy + dy, w, h, U.rgba(P.accent, 0.8)); }
        glowAt(e, (ox + 8) * K, (oy + 8) * K, 18, P.accent, 0.3);
      }
      if (bid === 'cinderforge' && special === 'tile.wall.grate') { glowAt(e, (ox + 8) * K, (oy + 13) * K, 16, '#ff7a2a', 0.35); fill(e, ox + 3, oy + 11, 10, 3, 'rgba(255,110,30,0.45)'); }
    }
    for (const x of gooX) if (T_(x, 2) === 0) sblit(g, sh, 'tile.wall.goo.base', 0, x * AT, 2 * AT);
    // ---- standing torches flanking the north wall of rooms people linger in (boss rooms also get the south corners) ----
    out.ftorches = [];
    if (room.type === 'boss' || room.type === 'start' || room.type === 'treasure' || room.type === 'shop' || room.type === 'event') {
      const spots = [[2, 3], [W - 3, 3]]; if (room.type === 'boss') spots.push([2, H - 3], [W - 3, H - 3]);
      for (const [tx, ty] of spots) {
        let ok = true; for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) if (T_(tx + i, ty + j) !== 0) { ok = false; break; }
        if (!ok) continue;
        const x = (tx + 0.5) * T, y = Math.round((ty + 0.9) * T / K) * K;
        out.ftorches.push({ x, y }); out.statics.push({ k: 'ftorch', x, y, key: y, h: 0 });
        glowAt(gm, x, y - 30, 40, P.light, 0.25);
      }
    }
    // ---- isolated blocks become columns drawn with the entities ----
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isCol(x, y)) out.statics.push({ k: 'col', id: 'prop.column', vk: '', x: (x + 0.5) * T, y: (y + 1) * T - 2, key: (y + 1) * T - 2, h: 70 });

    // ---- doors ----
    for (const dd in room.doors) {
      if (room.doors[dd] < 0) continue;
      const r = ED.Dungeon.doorRect(room, dd), ax0 = r.x0 * AT, ay0 = r.y0 * AT, aw = (r.x1 - r.x0 + 1) * AT, ah = (r.y1 - r.y0 + 1) * AT, dk = hexA(mixA(rgbOf(P.void), rgbOf(P.wallShadow), 0.35));
      fill(g, ax0, ay0, aw, ah, dk);
      if (dd === 'n') {
        sblit(g, sh, 'tile.door.frame.left', 0, ax0 - AT, 0); sblit(g, sh, 'tile.door.frame.right', 0, ax0 + aw, 0);
        sblit(g, sh, 'tile.door.leaf.open', 0, ax0, 0, 0, 16); sblit(g, sh, 'tile.door.leaf.open', 0, ax0 + 16, 0, 8, 24); sblit(g, sh, 'tile.door.leaf.open', 0, ax0 + 32, 0, 16, 32);
        out.statics.push({ k: 'arch', key: 2 * T, x: ax0 * K, y: 0, w: aw * K, h: 6 * K }); // arch stone above the opening: redrawn with the entities so heroes pass behind it
      } else if (dd === 's') { fill(g, ax0, ay0, aw, 2, 'rgba(0,0,0,0.5)'); }
    }
    // ---- wall fountains (top piece baked, the water frames animate) and their pools ----
    for (const x of fxs) {
      const lava = bid === 'cinderforge';
      sblit(g, sh, 'tile.fountain.top.' + (1 + Math.floor(hashS(x, 3, 52, s) * 3)), 0, x * AT, 0);
      out.fountains.push({ x, c: lava ? 'red' : 'blue' });
      const pc = lava ? ['#2a0f08', '#d8480c', '#f58a22'] : ['#0a2f42', '#1b6b84', '#5fc6dc'];
      for (const [dx, dy, w, c] of [[2, 33, 12, pc[0]], [3, 34, 10, pc[1]], [5, 34, 6, pc[2]]]) fill(g, x * AT + dx, dy, w, 1, c);
      glowAt(e, (x + 0.5) * T, 40, 24, lava ? '#ff6a2a' : '#6fe6ff', lava ? 0.4 : 0.22);
      glowAt(gm, (x + 0.5) * T, 40, 28, lava ? '#ff5a1a' : '#4fd0ff', lava ? 0.3 : 0.14);
    }
    return out;
  }

  // ---------- per-frame parts of art rooms ----------
  const bqOf = () => (ED.Render && ED.Render.bakeScale) || 1;
  const TORCH_Y = 10; // art row of the wall torch sprite's top: flame over the cap strip, bracket on the brick face
  // Frame of a looping animation at `fps` for time t, phased by x.
  const loopF = (t, fps, n, ph) => Math.floor(t * fps + (ph || 0)) % n;
  // Draws the room's animated pieces: pass 0 under the lighting (hazard pools, spikes, torches, fountains), pass 1 additive after it (flames, molten glow). Returns false when the room is not an art room.
  Tl.drawDyn = (c, room, biome, t, pass, low) => {
    const e = entry(room, bqOf()); if (!e.art) return false;
    const sh = sheetFor(biome), P = biome.pal, R_ = ED.Render;
    c.imageSmoothingEnabled = false;
    if (pass === 0) {
      if (e.hz) { const f = Math.floor(t * 5) % HZ_NF; for (let i = 0; i < e.hzCells.length; i++) { const q = e.hzCells[i]; c.drawImage(e.hz, f * AT, i * AT, AT, AT, q[0] * T, q[1] * T, T, T); } }
      if (e.spikes.length) {
        const ph = t % 1.8, f = ph < 0.7 ? 3 : ph < 0.8 ? 2 : ph < 1.45 ? 0 : ph < 1.7 ? 1 : 2, warn = ph >= 1.45 && ph < 1.7;
        for (const q of e.spikes) { sblit(c, sh, 'tile.spikes', f, q[0] / K, q[1] / K); if (warn) { c.fillStyle = 'rgba(255,90,60,0.16)'; c.fillRect(q[0] + 2, q[1] + 2, T - 4, T - 4); } }
      }
      for (const tc of room.torches) sblit(c, sh, 'tile.torch.wall', loopF(t, 10, 8, tc.x * 3), Math.floor(tc.x) * AT, TORCH_Y);
      for (const fo of e.fountains) sblit(c, sh, 'tile.fountain.mid.' + fo.c, loopF(t, 6, 3, fo.x), fo.x * AT, AT);
    } else {
      for (const tc of room.torches) {
        const x = (Math.floor(tc.x) + 0.5) * T, fl = Math.sin(t * 13 + x) * 1.2 + Math.sin(t * 23 + x * 1.7) * 0.7;
        R_.glow(c, x, TORCH_Y * K + 8, 22 + fl * 2, P.light, 0.5);
      }
      if (e.hz && !low) {
        const k = biome.hazard, a = k === 'lava' ? 0.2 : k === 'poison' ? 0.14 : k === 'void' ? 0.1 : 0;
        if (a) { const f = Math.floor(t * 5) % HZ_NF; c.globalAlpha = a; for (let i = 0; i < e.hzCells.length; i++) { const q = e.hzCells[i]; c.drawImage(e.hz, f * AT, i * AT, AT, AT, q[0] * T, q[1] * T, T, T); } c.globalAlpha = 1; }
      }
      for (const ft of e.ftorches) {
        const fl = Math.sin(t * 13 + ft.x) * 1.2 + Math.sin(t * 23 + ft.x * 1.7) * 0.7;
        R_.glow(c, ft.x, ft.y - 32, 22 + fl * 2, P.light, 0.5);
      }
      for (const fo of e.fountains) if (fo.c === 'red') { c.globalAlpha = 0.4; sblit(c, sh, 'tile.fountain.mid.red', loopF(t, 6, 3, fo.x), fo.x * AT, AT); c.globalAlpha = 1; }
      for (const d of Tl.dynamics(room)) { // glow pools of room lights (fungus, lava, candles...)
        if (d.k === 'torch') continue;
        const fl = d.k === 'hz' ? 0.55 + Math.sin(t * 1.6 + d.x * 0.07 + d.y * 0.05) * 0.25 : 0.7 + Math.sin(t * 2 + d.x) * 0.2;
        R_.glow(c, d.x, d.y, d.r * 0.55, d.color, (biome.hazard === 'water' && d.k === 'hz' ? 0.09 : 0.22) * fl);
      }
    }
    c.imageSmoothingEnabled = true;
    return true;
  };
  // Closed door of a locked room: wooden leaf on the north wall, iron bars on the others.
  Tl.drawGate = (c, room, biome, d) => {
    const e = entry(room, bqOf()); if (!e.art) return false;
    const sh = sheetFor(biome), r = ED.Dungeon.doorRect(room, d), ax = r.x0 * AT, ay = r.y0 * AT;
    c.imageSmoothingEnabled = false;
    if (d === 'n') { sblit(c, sh, 'tile.door.leaf.closed', 0, ax, ay, 0, 16); sblit(c, sh, 'tile.door.leaf.closed', 0, ax + 16, ay, 8, 24); sblit(c, sh, 'tile.door.leaf.closed', 0, ax + 32, ay, 16, 32); }
    else {
      c.fillStyle = 'rgba(8,4,10,0.94)'; c.fillRect(ax * K, ay * K, (r.x1 - r.x0 + 1) * T, (r.y1 - r.y0 + 1) * T);
      if (d === 's') for (let i = 0; i < 3; i++) sblit(c, sh, 'tile.gate.bars', 0, ax + i * AT, ay);
      else for (let i = 0; i < 3; i++) for (const dx of [-5, 0, 5]) sblit(c, sh, 'tile.gate.bars.side', 0, ax + dx, ay + i * AT);
    }
    c.imageSmoothingEnabled = true;
    return true;
  };
  // Tall static pieces of the room (columns, standing decor, the door arch) for the renderer's y-sorted list: [{ k, key (sort y), x, y, ... }].
  Tl.statics = (room) => entry(room, bqOf()).statics || NOSTATIC;
  const NOSTATIC = [];
  // True when a living entity stands behind (north of) a tall piece of height h at (x, y) and would be hidden by it.
  Tl.hides = (view, x, y, hw, h) => {
    for (const p of view.players.values()) if (!p.dead && p.y < y && p.y > y - h && Math.abs(p.x - x) < hw) return true;
    for (const en of view.enemies) if (en.hp > 0 && en.y < y && en.y > y - h && Math.abs(en.x - x) < hw + en.r) return true;
    return false;
  };
  // A breakable: its atlas sprite, else (no atlas, or art that lacks the kind) the procedural drawing baked once per stratum, kind, variant and scale.
  const brkSpr = new Map();
  function drawBreak(c, s) {
    if (s.id) { A.draw(c, s.id, 0, s.x, s.y, s.vk ? { variant: s.vk } : undefined); return; }
    const key = s.bid + '|' + s.kind + '|' + (s.v * 4 | 0) + '|' + (s.sc * 5 | 0);
    let sp = brkSpr.get(key);
    if (!sp) {
      const bm = ED.BIOMES.find((b) => b.id === s.bid), mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = 56; return cv; }, cv = mk();
      decor(cv.getContext('2d'), mk().getContext('2d'), bm, bm.pal, s.kind, 28, 44, ((s.v * 4 | 0) + 0.5) / 4, s.sc); // the emissive layer goes to a scratch canvas: the glow is queued per frame (R.emit)
      sp = { cv };
      brkSpr.set(key, sp);
    }
    c.drawImage(sp.cv, s.x - 28, s.y - 44);
  }
  Tl.drawStatic = (c, room, biome, s, view, t) => {
    if (s.k === 'brk') { drawBreak(c, s); return; }
    const e = entry(room, bqOf()), sh = sheetFor(biome);
    if (s.k === 'col') {
      const a = Tl.hides(view, s.x, s.y, 24, s.h) ? 0.45 : 1;
      c.save(); c.translate(s.x, s.y - 8); ED.Render.shadow(c, 11, 0.3, true); c.restore();
      if (a !== 1) c.globalAlpha = a;
      c.imageSmoothingEnabled = false; sblit(c, sh, 'prop.column', 0, s.x / K - 8, s.y / K - 39); c.imageSmoothingEnabled = true;
      if (a !== 1) c.globalAlpha = 1;
    } else if (s.k === 'ftorch') {
      c.save(); c.translate(s.x, s.y); ED.Render.shadow(c, 8, 0.3, true); c.restore();
      c.imageSmoothingEnabled = false; sblit(c, sh, 'tile.torch.floor', loopF(t, 10, 8, s.x * 0.1), s.x / K - 8, s.y / K - 24); c.imageSmoothingEnabled = true;
    } else if (s.k === 'stub') { // broken column: the cap and the base of the column sprite
      const fx = s.x / K - 8, fy = s.y / K;
      c.save(); c.translate(s.x, s.y); ED.Render.shadow(c, 9, 0.3, true); c.restore();
      c.imageSmoothingEnabled = false; sblit(c, sh, 'prop.column', 0, fx, fy - 20, undefined, undefined, 4, 14); sblit(c, sh, 'prop.column', 0, fx, fy - 10, undefined, undefined, 29, 39); c.imageSmoothingEnabled = true;
    } else if (s.k === 'deco') {
      for (const p of view.props) if (p.kind === 'shop' && Math.abs(s.x - p.x) < 26 && s.y > p.y - 2 && s.y < p.y + 44) return; // never over a price label
      A.draw(c, s.id, 0, s.x, s.y, s.vk ? { variant: s.vk } : undefined);
    } else if (s.k === 'arch') {
      let hit = false;
      for (const p of view.players.values()) if (p.y < s.key + 6 && Math.abs(p.x - (s.x + s.w / 2)) < s.w / 2 + 14) { hit = true; break; }
      if (!hit) for (const en of view.enemies) if (en.hp > 0 && en.y < s.key + 6 && Math.abs(en.x - (s.x + s.w / 2)) < s.w / 2 + 14) { hit = true; break; }
      if (!hit) return;
      const q = bqOf(), cv = e.canvas;
      c.imageSmoothingEnabled = false; c.drawImage(cv, s.x * q, s.y * q, s.w * q, s.h * q, s.x, s.y, s.w, s.h); c.imageSmoothingEnabled = true;
    }
  };

  // Lights and animated glows a room contributes each frame (torches, lava, glowing fungus...).
  Tl.dynamics = (room) => {
    if (room._dyn) return room._dyn;
    const biome = ED.biomeFor(room.stratum), P = biome.pal;
    const out = [], art = artOn();
    for (const tc of room.torches) out.push(art ? { k: 'torch', x: (Math.floor(tc.x) + 0.5) * T, y: 34, r: 120, color: P.light } : { k: 'torch', x: tc.x * T, y: tc.y * T - 4, r: 120, color: P.light });
    if (art) {
      const e = entry(room, bqOf());
      for (const fo of e.fountains || []) out.push({ k: 'glow', x: (fo.x + 0.5) * T, y: 44, r: 60, color: fo.c === 'red' ? '#ff6a2a' : '#6fe6ff' });
      for (const ft of e.ftorches || []) out.push({ k: 'torch', x: ft.x, y: ft.y - 34, r: 110, color: P.light });
    }
    const glowK = { glowcap: P.accent2, mushroom: P.accent, crystal: P.accent, lavacrack: '#ff6a2a', rune: P.accent, voidcrack: P.accent, candle: '#ffb35c', grate: '#ff7a2a', cinders: '#ff8a3a', goldtile: '#ffd36b', shard: P.accent };
    for (const d of room.decor) if (glowK[d.k]) out.push({ k: 'glow', x: d.x * T, y: d.y * T - 4, r: d.k === 'candle' ? 52 : 46, color: glowK[d.k] });
    if (biome.hazard === 'lava' || biome.hazard === 'poison' || biome.hazard === 'void' || biome.hazard === 'water') {
      let n = 0;
      for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (room.tiles[y * room.w + x] === 4 && (x + y) % 2 === 0 && n++ < 24) out.push({ k: 'hz', x: (x + 0.5) * T, y: (y + 0.5) * T, r: 60, color: P.hazardGlow });
    }
    room._dyn = out;
    return out;
  };
})(globalThis.ED || (globalThis.ED = {}));
