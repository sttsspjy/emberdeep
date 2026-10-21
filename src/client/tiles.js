// Room pre-rendering: each room's floor, walls, hazards and decor are painted once into an offscreen canvas at the
// current zoom, so a frame costs a single blit. A second half-resolution canvas holds the emissive details (lava, runes,
// fungus, inlay, stars) that the renderer adds after lighting so bloom catches them. Palettes and decor change per stratum.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE;
  const Tl = ED.Tiles = { ms: 0, paints: 0, lastMs: 0 };
  const cache = new Map();
  let NOISE = null;
  const LIFT = { ossuary: 0.55, glowmire: 0.55, rimefrost: 0, cinderforge: 0.55, sanctum: 0.5, abyss: 0.6 };

  Tl.clear = () => cache.clear();

  function entry(room, scale) {
    const key = room.stratum + ':' + room.seed + ':' + scale.toFixed(3);
    let e = cache.get(key);
    if (!e) {
      const t0 = performance.now();
      e = paint(room, scale);
      Tl.lastMs = performance.now() - t0; Tl.ms += Tl.lastMs; Tl.paints++;
      cache.set(key, e);
      if (cache.size > 4) cache.delete(cache.keys().next().value);
    }
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
    const es = scale * 0.5, ev = document.createElement('canvas');
    ev.width = Math.ceil(room.w * T * es); ev.height = Math.ceil(room.h * T * es); ev.px = es;
    const e = ev.getContext('2d');
    e.scale(es, es); e.globalCompositeOperation = 'lighter'; e.lineCap = 'round'; e.lineJoin = 'round';
    const gs = scale * 0.25, gv = document.createElement('canvas');
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
    return { canvas: cv, emis: ev, glowmap: gv };
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

  // Lights and animated glows a room contributes each frame (torches, lava, glowing fungus...).
  Tl.dynamics = (room) => {
    if (room._dyn) return room._dyn;
    const biome = ED.biomeFor(room.stratum), P = biome.pal;
    const out = [];
    for (const tc of room.torches) out.push({ k: 'torch', x: tc.x * T, y: tc.y * T - 4, r: 120, color: P.light });
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
