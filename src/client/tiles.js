// Room pre-rendering: each room's floor, walls, hazards and decor are painted once into an offscreen canvas
// at the current zoom, so a frame costs a single blit. Palettes and decor change per stratum.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE;
  const Tl = ED.Tiles = {};
  const cache = new Map();

  Tl.clear = () => cache.clear();

  Tl.get = (room, scale) => {
    const key = room.stratum + ':' + room.seed + ':' + scale.toFixed(3);
    let e = cache.get(key);
    if (!e) {
      e = { canvas: paint(room, scale), t: 0 };
      cache.set(key, e);
      if (cache.size > 4) cache.delete(cache.keys().next().value);
    }
    return e.canvas;
  };

  const tileAt = (room, x, y) => (x < 0 || y < 0 || x >= room.w || y >= room.h) ? 1 : room.tiles[y * room.w + x];
  const isWall = (t) => t === 1;

  function paint(room, scale) {
    const biome = ED.biomeFor(room.stratum), P = biome.pal;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(room.w * T * scale); cv.height = Math.ceil(room.h * T * scale);
    const c = cv.getContext('2d');
    c.scale(scale, scale);
    const rng = U.RNG(room.seed ^ 0x7111e);
    // ---- floor ----
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 1) continue;
      floorTile(c, biome, P, x * T, y * T, rng, t === 5);
    }
    // hazard & chasm tiles
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 4) hazardTile(c, biome, P, room, x, y, rng);
      if (t === 3) chasmTile(c, P, room, x, y);
    }
    // decor (under walls so shadows sit on top)
    for (const d of room.decor) decor(c, biome, P, d.k, d.x * T, d.y * T, d.v, d.s);
    // wall shadows cast onto the floor
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 1 || t === 3) continue;
      if (isWall(tileAt(room, x, y - 1))) { const g = c.createLinearGradient(0, y * T, 0, y * T + 14); g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x * T, y * T, T, 14); }
      if (isWall(tileAt(room, x - 1, y))) { const g = c.createLinearGradient(x * T, 0, x * T + 10, 0); g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x * T, y * T, 10, T); }
      if (isWall(tileAt(room, x + 1, y))) { const g = c.createLinearGradient(x * T + T, 0, x * T + T - 10, 0); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x * T + T - 10, y * T, 10, T); }
      if (tileAt(room, x, y - 1) === 2) { c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(x * T, y * T, T, 9); }
    }
    // ---- walls & blocks ----
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const t = tileAt(room, x, y);
      if (t === 1) wallTile(c, biome, P, room, x, y, rng);
      else if (t === 2) blockTile(c, biome, P, room, x, y, rng);
    }
    // door frames
    for (const d in room.doors) if (room.doors[d] >= 0) doorFrame(c, P, room, d);
    // torch sconces
    for (const tc of room.torches) { const x = tc.x * T, y = tc.y * T; c.fillStyle = '#2a1d14'; c.fillRect(x - 3, y - 2, 6, 9); c.fillStyle = '#4a3420'; c.fillRect(x - 5, y - 4, 10, 3); }
    // vignette on the outer frame
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, room.w * T - 3, room.h * T - 3);
    return cv;
  }

  function speck(c, x, y, rng, color, n, size) {
    c.fillStyle = color;
    for (let i = 0; i < n; i++) c.fillRect(x + rng.next() * T, y + rng.next() * T, size, size);
  }

  function floorTile(c, biome, P, x, y, rng, door) {
    const v = rng.next();
    c.fillStyle = v < 0.5 ? P.floorA : P.floorB;
    c.fillRect(x, y, T, T);
    const id = biome.id;
    if (id === 'ossuary') {
      c.fillStyle = U.shade(P.floorA, 0.06); c.fillRect(x + 2, y + 2, T - 4, T - 4);
      if (v > 0.85) { c.strokeStyle = P.grout; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 6, y + 8); c.lineTo(x + 14, y + 16); c.lineTo(x + 12, y + 26); c.stroke(); }
      speck(c, x, y, rng, 'rgba(0,0,0,0.15)', 5, 1.5);
    } else if (id === 'glowmire') {
      speck(c, x, y, rng, 'rgba(120,255,210,0.06)', 6, 3);
      speck(c, x, y, rng, 'rgba(0,0,0,0.2)', 6, 2);
      if (v > 0.8) { c.fillStyle = 'rgba(80,200,150,0.12)'; c.beginPath(); c.ellipse(x + 16, y + 16, 12, 8, 0, 0, 7); c.fill(); }
    } else if (id === 'rimefrost') {
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 2, y + 2, T - 4, 3);
      c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 0.8; if (v > 0.6) { c.beginPath(); c.moveTo(x + 4, y + 26); c.lineTo(x + 26, y + 6); c.stroke(); }
      speck(c, x, y, rng, 'rgba(255,255,255,0.35)', 3, 1.2);
    } else if (id === 'cinderforge') {
      c.fillStyle = U.shade(P.floorA, 0.04); c.fillRect(x + 1, y + 1, T - 2, T - 2);
      c.fillStyle = 'rgba(0,0,0,0.35)'; for (const [a, b] of [[4, 4], [T - 6, 4], [4, T - 6], [T - 6, T - 6]]) c.fillRect(x + a, y + b, 2, 2);
      if (v > 0.9) { c.strokeStyle = 'rgba(255,120,40,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 4, y + 20); c.lineTo(x + 16, y + 14); c.lineTo(x + 28, y + 20); c.stroke(); }
    } else if (id === 'sanctum') {
      c.fillStyle = U.shade(P.floorA, 0.05); c.fillRect(x + 2, y + 2, T - 4, T - 4);
      if (v > 0.78) { c.strokeStyle = 'rgba(232,198,107,0.35)'; c.lineWidth = 1; c.strokeRect(x + 6, y + 6, T - 12, T - 12); }
      speck(c, x, y, rng, 'rgba(160,250,255,0.07)', 4, 3);
    } else if (id === 'abyss') {
      speck(c, x, y, rng, 'rgba(210,190,255,0.5)', v > 0.7 ? 2 : 0, 1);
      speck(c, x, y, rng, 'rgba(0,0,0,0.25)', 5, 2);
      if (v > 0.88) { c.strokeStyle = 'rgba(183,140,255,0.3)'; c.lineWidth = 1; c.beginPath(); c.arc(x + 16, y + 16, 8, 0, 7); c.stroke(); }
    }
    c.strokeStyle = P.grout; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    if (door) { c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x, y, T, T); }
  }

  function hazardTile(c, biome, P, room, tx, ty, rng) {
    const x = tx * T, y = ty * T, hz = biome.hazard;
    if (hz === 'spikes') {
      c.fillStyle = '#4a4a46'; c.fillRect(x + 2, y + 2, T - 4, T - 4);
      c.fillStyle = '#1a1a18'; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { c.beginPath(); c.arc(x + 8 + i * 8, y + 8 + j * 8, 1.8, 0, 7); c.fill(); }
      c.strokeStyle = '#2a2a26'; c.strokeRect(x + 2.5, y + 2.5, T - 5, T - 5);
    } else if (hz === 'poison') {
      c.fillStyle = '#2b4a22'; c.fillRect(x, y, T, T);
      c.fillStyle = 'rgba(156,255,106,0.25)'; c.beginPath(); c.ellipse(x + 16, y + 16, 14, 12, 0, 0, 7); c.fill();
      speck(c, x, y, rng, 'rgba(200,255,150,0.35)', 4, 2);
    } else if (hz === 'ice') {
      const g = c.createLinearGradient(x, y, x + T, y + T); g.addColorStop(0, '#e8f8ff'); g.addColorStop(1, '#bfe3f5');
      c.fillStyle = g; c.fillRect(x, y, T, T);
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x + 6, y + 10); c.lineTo(x + 14, y + 4); c.moveTo(x + 18, y + 26); c.lineTo(x + 27, y + 18); c.stroke();
    } else if (hz === 'lava') {
      c.fillStyle = '#a8300a'; c.fillRect(x, y, T, T);
      const g = c.createRadialGradient(x + 16, y + 16, 2, x + 16, y + 16, 20); g.addColorStop(0, '#ffcf4a'); g.addColorStop(0.5, '#ff6a1a'); g.addColorStop(1, 'rgba(160,40,10,0)');
      c.fillStyle = g; c.fillRect(x, y, T, T);
      c.fillStyle = 'rgba(40,10,4,0.6)'; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(x + rng.next() * T, y + rng.next() * T, 4 + rng.next() * 4, 2 + rng.next() * 2, rng.next() * 3, 0, 7); c.fill(); }
    } else if (hz === 'water') {
      c.fillStyle = '#0d3f52'; c.fillRect(x, y, T, T);
      c.strokeStyle = 'rgba(111,230,255,0.3)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 4, y + 12); c.quadraticCurveTo(x + 10, y + 8, x + 16, y + 12); c.moveTo(x + 14, y + 24); c.quadraticCurveTo(x + 20, y + 20, x + 28, y + 24); c.stroke();
    } else if (hz === 'void') {
      c.fillStyle = '#12051f'; c.fillRect(x, y, T, T);
      c.fillStyle = 'rgba(212,140,255,0.25)'; c.beginPath(); c.ellipse(x + 16, y + 16, 12, 9, 0.4, 0, 7); c.fill();
      speck(c, x, y, rng, '#f0d8ff', 3, 1.2);
    }
    // soft edge where hazard meets floor
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (tileAt(room, tx + dx, ty + dy) === 4) continue;
      c.fillStyle = 'rgba(0,0,0,0.22)';
      if (dy === -1) c.fillRect(x, y, T, 3); if (dy === 1) c.fillRect(x, y + T - 3, T, 3);
      if (dx === -1) c.fillRect(x, y, 3, T); if (dx === 1) c.fillRect(x + T - 3, y, 3, T);
    }
  }

  function chasmTile(c, P, room, tx, ty) {
    const x = tx * T, y = ty * T;
    c.fillStyle = P.chasm; c.fillRect(x, y, T, T);
    if (tileAt(room, tx, ty - 1) !== 3) {
      const g = c.createLinearGradient(0, y, 0, y + T * 0.8); g.addColorStop(0, P.wallFace); g.addColorStop(1, P.chasm);
      c.fillStyle = g; c.fillRect(x, y, T, T * 0.8);
    }
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0]]) {
      if (tileAt(room, tx + dx, ty + dy) === 3) continue;
      c.fillStyle = 'rgba(255,255,255,0.07)';
      if (dy === 1) c.fillRect(x, y + T - 2, T, 2); if (dx === -1) c.fillRect(x, y, 2, T); if (dx === 1) c.fillRect(x + T - 2, y, 2, T);
    }
  }

  function bricks(c, P, x, y, w, h, rng) {
    c.fillStyle = P.wallFace; c.fillRect(x, y, w, h);
    c.strokeStyle = P.wallShadow; c.lineWidth = 1;
    const rows = Math.max(1, Math.round(h / 8));
    for (let r = 0; r < rows; r++) {
      const yy = y + r * (h / rows);
      c.beginPath(); c.moveTo(x, yy + 0.5); c.lineTo(x + w, yy + 0.5); c.stroke();
      const off = (r % 2) * 8;
      for (let xx = x + off; xx < x + w; xx += 16) { c.beginPath(); c.moveTo(xx + 0.5, yy); c.lineTo(xx + 0.5, yy + h / rows); c.stroke(); }
    }
    c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x, y, w, 2);
    if (rng.next() > 0.7) { c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x + rng.next() * w * 0.7, y + rng.next() * h * 0.6, 6, 4); }
  }

  function wallTile(c, biome, P, room, tx, ty, rng) {
    const x = tx * T, y = ty * T;
    const below = tileAt(room, tx, ty + 1);
    if (below !== 1 && below !== undefined && ty < room.h - 1) {
      // front face visible from above
      c.fillStyle = P.wallTop; c.fillRect(x, y, T, 7);
      bricks(c, P, x, y + 7, T, T - 7, rng);
      if (biome.id === 'glowmire' && rng.next() > 0.6) { c.fillStyle = 'rgba(79,240,200,0.35)'; c.beginPath(); c.arc(x + 8 + rng.next() * 16, y + 20 + rng.next() * 8, 2, 0, 7); c.fill(); }
      if (biome.id === 'rimefrost') { c.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 3; i++) c.fillRect(x + 4 + i * 10, y + 7, 3, 3 + rng.next() * 6); }
      if (biome.id === 'ossuary' && rng.next() > 0.75) { c.fillStyle = 'rgba(134,163,91,0.45)'; c.fillRect(x + rng.next() * 20, y + 7, 10, 5); }
      if (biome.id === 'sanctum' && rng.next() > 0.6) { c.fillStyle = 'rgba(95,242,224,0.2)'; c.fillRect(x, y + 24, T, 8); }
    } else {
      c.fillStyle = P.wallTop; c.fillRect(x, y, T, T);
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x + 3, y + 3, T - 6, T - 6);
      c.fillStyle = 'rgba(255,255,255,0.05)'; if (rng.next() > 0.5) c.fillRect(x + 6, y + 6, 8, 6);
      // dark rim where the wall drops to floor
      const edge = (dx, dy) => { const t = tileAt(room, tx + dx, ty + dy); return t !== 1; };
      c.fillStyle = P.wallShadow;
      if (edge(-1, 0)) c.fillRect(x, y, 3, T);
      if (edge(1, 0)) c.fillRect(x + T - 3, y, 3, T);
      if (edge(0, -1) && ty > 0) c.fillRect(x, y, T, 3);
    }
  }

  function blockTile(c, biome, P, room, tx, ty, rng) {
    const x = tx * T, y = ty * T;
    const hasBelow = tileAt(room, tx, ty + 1) !== 2;
    const hasAbove = tileAt(room, tx, ty - 1) !== 2;
    const topH = hasBelow ? 18 : T;
    c.fillStyle = U.shade(P.wallTop, -0.05); c.fillRect(x, y - (hasAbove ? 8 : 0), T, topH + (hasAbove ? 8 : 0));
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x + 2, y - (hasAbove ? 6 : -2), T - 4, 3);
    if (hasBelow) bricks(c, P, x, y + topH, T, T - topH, rng);
    c.strokeStyle = P.wallShadow; c.lineWidth = 1.2; c.strokeRect(x + 0.5, y - (hasAbove ? 8 : 0) + 0.5, T - 1, T + (hasAbove ? 8 : 0) - 1);
    if (biome.id === 'rimefrost') { c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(x + 2, y - (hasAbove ? 8 : 0), T - 4, 4); }
    if (biome.id === 'cinderforge' && rng.next() > 0.5) { c.fillStyle = 'rgba(255,106,42,0.5)'; c.fillRect(x + 6, y + topH + 4, T - 12, 2); }
  }

  function doorFrame(c, P, room, d) {
    const r = ED.Dungeon.doorRect(room, d);
    const x0 = r.x0 * T, y0 = r.y0 * T, x1 = (r.x1 + 1) * T, y1 = (r.y1 + 1) * T;
    c.fillStyle = '#050403';
    if (d === 'n') {
      const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      c.fillStyle = g; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.fillStyle = P.wallTop; c.fillRect(x0 - 6, y0, 6, y1 - y0); c.fillRect(x1, y0, 6, y1 - y0);
      c.fillStyle = U.shade(P.wallTop, 0.15); c.fillRect(x0 - 6, y0, x1 - x0 + 12, 5);
    } else if (d === 's') {
      const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, '#000');
      c.fillStyle = g; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      const g = c.createLinearGradient(d === 'w' ? x1 : x0, 0, d === 'w' ? x0 : x1, 0); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, '#000');
      c.fillStyle = g; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.fillStyle = U.shade(P.wallTop, 0.12); c.fillRect(x0, y0 - 5, x1 - x0, 5);
    }
  }

  // ---------- decor ----------
  function decor(c, biome, P, k, x, y, v, s) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,0.5)';
    switch (k) {
      case 'bones': c.fillStyle = P.accent2; c.save(); c.rotate(v * 3); c.fillRect(-6, -1, 12, 2); c.beginPath(); c.arc(-6, -1.5, 1.8, 0, 7); c.arc(-6, 1.5, 1.8, 0, 7); c.arc(6, -1.5, 1.8, 0, 7); c.arc(6, 1.5, 1.8, 0, 7); c.fill(); c.restore(); break;
      case 'skull': c.fillStyle = P.accent2; c.beginPath(); c.arc(0, 0, 4.5, 0, 7); c.fill(); c.fillRect(-2.5, 2, 5, 3); c.fillStyle = '#1a1612'; c.fillRect(-2.5, -1, 2, 2); c.fillRect(0.8, -1, 2, 2); break;
      case 'moss': c.fillStyle = U.rgba(P.accent, 0.45); for (let i = 0; i < 5; i++) { c.beginPath(); c.arc((i - 2) * 4, Math.sin(i * 2 + v) * 3, 4 + (i % 2) * 2, 0, 7); c.fill(); } break;
      case 'crack': c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-10, -4); c.lineTo(-3, 0); c.lineTo(2, -5); c.lineTo(10, 2); c.moveTo(-3, 0); c.lineTo(-1, 6); c.stroke(); break;
      case 'candle': c.fillStyle = '#e6dcc0'; c.fillRect(-2, -7, 4, 7); c.fillRect(3, -5, 3, 5); c.fillStyle = '#ffcf6a'; c.beginPath(); c.arc(0, -9, 1.6, 0, 7); c.arc(4.5, -7, 1.3, 0, 7); c.fill(); break;
      case 'urn': c.fillStyle = '#6a5240'; c.beginPath(); c.ellipse(0, -4, 5, 6, 0, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#4a3828'; c.fillRect(-3, -11, 6, 3); break;
      case 'mushroom': case 'glowcap': {
        const col = k === 'glowcap' ? P.accent2 : P.accent;
        c.fillStyle = U.rgba(col, 0.25); c.beginPath(); c.arc(0, -4, 9, 0, 7); c.fill();
        c.fillStyle = '#d8d0c0'; c.fillRect(-1.2, -5, 2.4, 6);
        c.fillStyle = col; c.beginPath(); c.ellipse(0, -5, 5, 3.4, 0, Math.PI, 0); c.fill();
        if (v > 0.5) { c.fillStyle = '#d8d0c0'; c.fillRect(5, -3, 1.6, 4); c.fillStyle = col; c.beginPath(); c.ellipse(5.8, -3, 3, 2, 0, Math.PI, 0); c.fill(); }
        break;
      }
      case 'root': c.strokeStyle = '#3a2a2a'; c.lineWidth = 2; c.beginPath(); c.moveTo(-10, 0); c.quadraticCurveTo(-2, -6, 4, 0); c.quadraticCurveTo(8, 4, 12, 2); c.stroke(); break;
      case 'puddle': c.fillStyle = biome.id === 'sanctum' ? 'rgba(95,242,224,0.18)' : 'rgba(100,200,180,0.15)'; c.beginPath(); c.ellipse(0, 0, 10, 5, v, 0, 7); c.fill(); break;
      case 'crystal': c.fillStyle = U.rgba(P.accent, 0.25); c.beginPath(); c.arc(0, -6, 10, 0, 7); c.fill(); c.fillStyle = '#bfefff'; c.beginPath(); c.moveTo(-3, 0); c.lineTo(-1, -12); c.lineTo(2, 0); c.fill(); c.fillStyle = '#e8fbff'; c.beginPath(); c.moveTo(1, 0); c.lineTo(5, -8); c.lineTo(6, 0); c.fill(); break;
      case 'snow': c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(0, 0, 11, 4, 0, 0, 7); c.fill(); break;
      case 'frozenbones': c.fillStyle = '#e8f6ff'; c.save(); c.rotate(v * 3); c.fillRect(-6, -1, 12, 2); c.restore(); c.fillStyle = 'rgba(160,220,255,0.4)'; c.beginPath(); c.ellipse(0, 0, 9, 5, 0, 0, 7); c.fill(); break;
      case 'pillarstub': c.fillStyle = P.wallTop; c.beginPath(); c.ellipse(0, -2, 7, 4, 0, 0, 7); c.fill(); c.stroke(); c.fillStyle = P.wallFace; c.fillRect(-7, -2, 14, 4); break;
      case 'lavacrack': c.strokeStyle = '#ff7a2a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-10, -2); c.lineTo(-4, 1); c.lineTo(1, -3); c.lineTo(9, 2); c.stroke(); c.strokeStyle = 'rgba(255,200,80,0.6)'; c.lineWidth = 0.7; c.stroke(); break;
      case 'chain': c.strokeStyle = '#5a5a5a'; c.lineWidth = 1.4; for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(-6 + i * 4, 0, 2.4, 1.6, 0, 0, 7); c.stroke(); } break;
      case 'anvil': c.fillStyle = '#3a3a3e'; c.fillRect(-7, -6, 14, 4); c.fillRect(-3, -2, 6, 4); c.fillRect(-6, 2, 12, 2); break;
      case 'grate': c.fillStyle = '#1a120e'; c.fillRect(-8, -6, 16, 12); c.strokeStyle = '#4a3a30'; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-6 + i * 4, -6); c.lineTo(-6 + i * 4, 6); c.stroke(); } c.fillStyle = 'rgba(255,120,40,0.25)'; c.fillRect(-7, -5, 14, 10); break;
      case 'cinders': c.fillStyle = 'rgba(255,140,60,0.5)'; for (let i = 0; i < 5; i++) c.fillRect(Math.sin(i * 7 + v * 9) * 8, Math.cos(i * 5 + v * 9) * 5, 1.5, 1.5); break;
      case 'coral': c.strokeStyle = '#e0705a'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -8); c.lineTo(-4, -12); c.moveTo(0, -6); c.lineTo(4, -11); c.stroke(); break;
      case 'seaweed': c.strokeStyle = '#3a8a5a'; c.lineWidth = 2; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * 3, 0); c.quadraticCurveTo(i * 3 + 4, -6, i * 3, -12); c.stroke(); } break;
      case 'goldtile': c.strokeStyle = 'rgba(232,198,107,0.6)'; c.lineWidth = 1.2; c.strokeRect(-8, -8, 16, 16); c.beginPath(); c.moveTo(-8, 0); c.lineTo(0, -8); c.lineTo(8, 0); c.lineTo(0, 8); c.closePath(); c.stroke(); break;
      case 'shell': c.fillStyle = '#e8d0c0'; c.beginPath(); c.arc(0, 0, 4, Math.PI, 0); c.fill(); c.stroke(); break;
      case 'voidcrack': c.strokeStyle = '#c98bff'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-10, 0); c.lineTo(-3, -3); c.lineTo(2, 2); c.lineTo(10, -2); c.stroke(); c.strokeStyle = 'rgba(255,200,255,0.5)'; c.lineWidth = 0.6; c.stroke(); break;
      case 'rune': c.strokeStyle = U.rgba(P.accent, 0.55); c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, 8, 0, 7); c.moveTo(0, -8); c.lineTo(0, 8); c.moveTo(-6, -4); c.lineTo(6, 4); c.stroke(); break;
      case 'shard': c.fillStyle = 'rgba(183,140,255,0.6)'; c.beginPath(); c.moveTo(-2, 0); c.lineTo(0, -9); c.lineTo(2, 0); c.fill(); break;
      case 'starfield': c.fillStyle = '#efe6ff'; for (let i = 0; i < 4; i++) c.fillRect(Math.sin(i * 3 + v * 5) * 10, Math.cos(i * 4 + v * 5) * 7, 1.2, 1.2); break;
      default: break;
    }
    c.restore();
  }

  // Lights and animated glows a room contributes each frame (torches, lava, glowing fungus...).
  Tl.dynamics = (room) => {
    if (room._dyn) return room._dyn;
    const biome = ED.biomeFor(room.stratum), P = biome.pal;
    const out = [];
    for (const tc of room.torches) out.push({ k: 'torch', x: tc.x * T, y: tc.y * T - 4, r: 120, color: P.light });
    const glowK = { glowcap: P.accent2, mushroom: P.accent, crystal: P.accent, lavacrack: '#ff6a2a', rune: P.accent, voidcrack: P.accent, candle: '#ffb35c', grate: '#ff7a2a' };
    for (const d of room.decor) if (glowK[d.k]) out.push({ k: 'glow', x: d.x * T, y: d.y * T - 4, r: 46, color: glowK[d.k] });
    if (biome.hazard === 'lava' || biome.hazard === 'poison' || biome.hazard === 'void') {
      let n = 0;
      for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (room.tiles[y * room.w + x] === 4 && (x + y) % 2 === 0 && n++ < 24) out.push({ k: 'hz', x: (x + 0.5) * T, y: (y + 0.5) * T, r: 60, color: P.hazardGlow });
    }
    room._dyn = out;
    return out;
  };
})(globalThis.ED || (globalThis.ED = {}));
