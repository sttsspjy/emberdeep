// Boss arena drawing (client only): the Sporemother's spore carpet (one cached art-grid canvas per room, rebuilt when room.carpet changes), the Bone Warden's bone wall blocks
// (y-sorted with the actors, rising on appear, cracked by hp, white on a hit) and his spectral swords hovering over their warning lines. Reads view.arena / room.carpet (bosses.js arena state).
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, A = 16; // art px per tile (1 art px = 2 world px)
  const Ar = ED.Arena = {};
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
    const ar = view.arena; if (!ar || !ar.walls) return;
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
