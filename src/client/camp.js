// The Hearth: an animated camp at the mouth of the Deep, shown behind the menus.
// It grows with progress: more tents and lanterns as upgrades are bought, a banner per slain boss,
// and the gate glows with the colour of the deepest stratum reached. Lit like a run: a cold night ambient with
// warm pools from the fire and lanterns, emissive flames/stars on top, all through the same post pass.
(function (ED) {
  'use strict';
  const U = ED.U;
  const Camp = ED.Camp = { sparks: [], smoke: [], flies: null, bg: null, bgKey: '', smokeT: 0, wear: null, wearK: '', wearT: 0 };
  // Fire colours: [pool, inner pool, glow, core glow, tongue glow, spark glow, spark rgb, flame layers]; the Blue Hearth (Wardrobe) burns cold blue.
  const FIRE = {
    warm: { pool: '#ff9a4a', pool2: '#ffc27a', glow: '#ff8a3d', core: '#ffb347', tongue: '#ffb35c', spark: '#ff9a3a', sparkRgb: [255, 150, 60, 80],
      flames: ['rgba(255,70,16,0.85)', 'rgba(255,125,30,0.85)', 'rgba(255,175,70,0.9)', 'rgba(255,225,140,0.95)', 'rgba(255,250,220,0.95)'] },
    blue: { pool: '#4a8aff', pool2: '#8ac4ff', glow: '#3d7aff', core: '#6ab0ff', tongue: '#7ac0ff', spark: '#5aa0ff', sparkRgb: [90, 170, 255, 60],
      flames: ['rgba(30,70,200,0.85)', 'rgba(46,120,240,0.85)', 'rgba(90,168,255,0.9)', 'rgba(168,216,255,0.95)', 'rgba(232,246,255,0.95)'] },
  };

  function ridge(W, H, y0, amp, seed, n) {
    const r = U.RNG(seed), p = [r.next() * 6, r.next() * 6, r.next() * 6], pts = [];
    for (let i = 0; i <= n; i++) pts.push([i / n * W, H * (y0 + amp * (Math.sin(i * 0.9 + p[0]) * 0.5 + Math.sin(i * 2.3 + p[1]) * 0.3 + Math.sin(i * 5.1 + p[2]) * 0.2 + (r.next() - 0.5) * 0.15))]);
    return pts;
  }
  function pine(c, x, y, s) { c.beginPath(); for (let i = 0; i < 4; i++) { const w = s * (0.9 - i * 0.18), yy = y - i * s * 0.55; c.moveTo(x - w, yy); c.lineTo(x, yy - s * 0.85); c.lineTo(x + w, yy); } c.fill(); c.fillRect(x - s * 0.07, y, s * 0.14, s * 0.3); }

  // Pixel moon centred on (cx, cy) buffer px, radius r art px of A buffer px: halo rings (r + 1..4, r + 4..8 at 10% / 5%), outline ring, then bands by the
  // lit fraction of a sphere lit from the upper left (light, mid, dark) and four crater cells one band darker.
  function moonDisc(s, cx, cy, r, A, col) {
    const bands = [U.mix(col, '#ffffff', 0.6), col, U.shade(col, -0.22), U.shade(col, -0.42)];
    const L = [-0.55, -0.6, 0.58], craters = [[0.32, -0.18, 0.2], [-0.34, 0.3, 0.15], [0.14, 0.5, 0.11], [-0.24, -0.44, 0.09]], R = r + 8;
    for (let j = -R; j < R; j++) for (let i = -R; i < R; i++) {
      const x = i + 0.5, y = j + 0.5, d = Math.hypot(x, y);
      let c = null;
      if (d <= r) {
        const nx = x / r, ny = y / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), lit = nx * L[0] + ny * L[1] + nz * L[2];
        let b = lit > 0.78 ? 0 : lit > 0.42 ? 1 : 2;
        if (craters.some(([cx2, cy2, cr]) => Math.hypot(nx - cx2, ny - cy2) <= cr)) b++;
        c = bands[Math.min(3, b)];
      } else if (d <= r + 1) c = '#222222';
      else if (d <= r + 4) c = U.rgba(col, 0.1);
      else if (d <= R) c = U.rgba(col, 0.05);
      if (c) { s.fillStyle = c; s.fillRect(cx + i * A, cy + j * A, A, A); }
    }
  }

  // Static layers: `bg` is lit by the light buffer; `sky` (sky, stars, moon with the landscape cut out) is added afterwards.
  function buildBg(W, H, profile, biome, o) {
    const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv; };
    const bg = mk(), sky = mk(), c = bg.getContext('2d'), s = sky.getContext('2d');
    const accent = biome.pal.accent;
    // both canvases get the sky; landscape silhouettes are painted on bg and erased from sky
    const sg = c.createLinearGradient(0, 0, 0, H * 0.72);
    sg.addColorStop(0, '#05060f'); sg.addColorStop(0.55, '#0e0c1d'); sg.addColorStop(1, U.mix('#241820', accent, 0.1));
    const sg2 = s.createLinearGradient(0, 0, 0, H * 0.72);
    sg2.addColorStop(0, '#060718'); sg2.addColorStop(0.55, '#14122c'); sg2.addColorStop(1, U.mix('#3a2430', accent, 0.14));
    c.fillStyle = sg; c.fillRect(0, 0, W, H); s.fillStyle = sg2; s.fillRect(0, 0, W, H);
    const rng = U.RNG(42);
    for (let i = 0; i < 170; i++) {
      const x = rng.next() * W, y = rng.next() * H * 0.55, r = rng.next() * 1.4 + 0.3, a = 0.2 + rng.next() * 0.5;
      s.fillStyle = `rgba(255,240,225,${a})`; s.fillRect(x, y, r, r);
    }
    // moon (red under a pact): a pixel disc on the 2 world px art grid, 1 art px #222222 outline, 3 lit bands and craters, stepped halo rings
    const moonCol = o.pact > 0 ? U.mix('#f3e3c0', '#d3302a', Math.min(1, o.pact / 6)) : '#f3e3c0';
    const A = 2, mx = Math.round(W * 0.1) * A, my = Math.round(H * 0.085) * A, mr = Math.max(6, Math.round(Math.min(W, H) * 0.05 / A)); // centre on an art px corner, radius in art px
    moonDisc(s, mx, my, mr, A, moonCol);
    Camp.moon = { x: mx, y: my, r: (mr + 1) * A }; // buffer px: the disc and its outline (screenart.js keeps the menu vignette off it)
    const sil = (fill, build, cutSky) => { c.fillStyle = fill; c.beginPath(); build(c); c.fill(); if (cutSky !== false) { s.globalCompositeOperation = 'destination-out'; s.fillStyle = '#000'; s.beginPath(); build(s); s.fill(); s.globalCompositeOperation = 'source-over'; } };
    // mountain ranges with fog between them
    const layers = [[0.5, 0.06, 7, '#0e0b18'], [0.57, 0.05, 11, '#130d17'], [0.62, 0.035, 19, '#18100f']];
    layers.forEach(([y0, amp, seed, col], li) => {
      const pts = ridge(W, H, y0, amp, seed, 16);
      sil(col, (g) => { g.moveTo(0, H); pts.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(W, H); g.closePath(); });
      const fy = H * (y0 + 0.02), fg = c.createLinearGradient(0, fy - H * 0.08, 0, fy + H * 0.1); fg.addColorStop(0, 'rgba(70,70,100,0)'); fg.addColorStop(0.6, `rgba(70,66,100,${0.12 + li * 0.04})`); fg.addColorStop(1, 'rgba(70,66,100,0)');
      c.fillStyle = fg; c.fillRect(0, fy - H * 0.08, W, H * 0.18);
      if (li === 1) { c.fillStyle = '#0b0809'; const r2 = U.RNG(77); for (let i = 0; i < 26; i++) { const x = r2.next() * W * 0.58, p = pts[Math.min(16, Math.round(x / W * 16))]; pine(c, x, p[1] + H * 0.012, H * (0.035 + r2.next() * 0.03)); } }
    });
    // cliff with the gate to the Deep
    const gx = W * 0.82, gy = H * 0.64, gw = Math.min(W, H) * 0.2;
    const cr = U.RNG(5), cliff = [[W * 0.62, H], [W * 0.64, H * 0.62], [W * 0.66, H * 0.48]];
    for (let i = 1; i < 6; i++) cliff.push([W * (0.66 + i * 0.056), H * (0.4 - Math.sin(i * 0.9) * 0.04 + cr.next() * 0.02)]);
    cliff.push([W, H * 0.44], [W, H]);
    sil('#17110f', (g) => { g.moveTo(cliff[0][0], cliff[0][1]); cliff.forEach(p => g.lineTo(p[0], p[1])); g.closePath(); });
    c.save(); c.beginPath(); c.moveTo(cliff[0][0], cliff[0][1]); cliff.forEach(p => c.lineTo(p[0], p[1])); c.closePath(); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2;
    for (let i = 0; i < 8; i++) { c.beginPath(); const y = H * (0.45 + i * 0.07); c.moveTo(W * 0.6, y); for (let x = W * 0.6; x < W; x += 30) c.lineTo(x, y + (cr.next() - 0.5) * 8); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
    for (let i = 0; i < 8; i++) { c.beginPath(); const y = H * (0.45 + i * 0.07) + 3; c.moveTo(W * 0.6, y); for (let x = W * 0.6; x < W; x += 30) c.lineTo(x, y + (cr.next() - 0.5) * 8); c.stroke(); }
    c.restore();
    // gate: dark arch, glowing interior, framing stones, hollow crown once the Deep has been won
    c.fillStyle = '#050304';
    c.beginPath(); c.moveTo(gx - gw * 0.5, gy + gw * 0.1); c.lineTo(gx - gw * 0.5, gy - gw * 0.55); c.quadraticCurveTo(gx, gy - gw * 1.25, gx + gw * 0.5, gy - gw * 0.55); c.lineTo(gx + gw * 0.5, gy + gw * 0.1); c.fill();
    c.strokeStyle = '#3a2c24'; c.lineWidth = gw * 0.07; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(gx - gw * 0.5, gy - gw * 0.5); c.quadraticCurveTo(gx, gy - gw * 1.22, gx + gw * 0.5, gy - gw * 0.5); c.stroke();
    // steps down into the gate
    c.fillStyle = '#2a1e18';
    for (let i = 0; i < 4; i++) { c.fillRect(gx - gw * (0.45 - i * 0.05), gy + gw * 0.1 + i * gw * 0.06, gw * (0.9 - i * 0.1), gw * 0.05); c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(gx - gw * (0.45 - i * 0.05), gy + gw * 0.1 + i * gw * 0.06, gw * (0.9 - i * 0.1), 1.5); c.fillStyle = '#2a1e18'; }
    // ground
    const gr = c.createLinearGradient(0, H * 0.66, 0, H); gr.addColorStop(0, '#2a1f1a'); gr.addColorStop(1, '#0f0b09');
    sil(gr, (g) => { g.moveTo(0, H * 0.7); g.quadraticCurveTo(W * 0.4, H * 0.64, W * 0.7, H * 0.7); g.lineTo(W, H * 0.72); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); });
    const gr2 = U.RNG(9);
    for (let i = 0; i < 160; i++) { const x = gr2.next() * W, y = H * (0.7 + gr2.next() * 0.3), r = 1 + gr2.next() * 3; c.fillStyle = gr2.next() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,230,200,0.05)'; c.beginPath(); c.ellipse(x, y, r * 2, r, 0, 0, U.TAU); c.fill(); }
    c.fillStyle = 'rgba(20,14,10,0.9)';
    for (let i = 0; i < 40; i++) { const x = gr2.next() * W, y = H * (0.72 + gr2.next() * 0.26), h = H * (0.008 + gr2.next() * 0.014); c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x, y - h); c.lineTo(x + 2, y); c.fill(); }
    // worn path from the fire to the gate
    c.strokeStyle = 'rgba(60,44,34,0.5)'; c.lineWidth = H * 0.03; c.lineCap = 'round'; c.beginPath(); c.moveTo(W * 0.58, H * 0.84); c.quadraticCurveTo(W * 0.7, H * 0.78, gx, gy + gw * 0.4); c.stroke();
    // tents, banner poles, lantern string (growth from upgrades)
    const fs = Math.min(W, H) * 0.06;
    for (let i = 0; i < o.tents; i++) {
      const tx = W * (0.36 + i * 0.075) - (i % 2) * W * 0.02, ty = H * (0.73 + (i % 2) * 0.02), ts = fs * (1.6 - i * 0.12);
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(tx, ty + 2, ts * 1.1, ts * 0.22, 0, 0, U.TAU); c.fill();
      c.fillStyle = ['#4a3a2e', '#3a3650', '#34503e', '#503e30'][i];
      c.beginPath(); c.moveTo(tx - ts, ty); c.lineTo(tx, ty - ts * 1.1); c.lineTo(tx + ts, ty); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.beginPath(); c.moveTo(tx, ty - ts * 1.1); c.lineTo(tx + ts, ty); c.lineTo(tx + ts * 0.7, ty); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.moveTo(tx - ts * 0.2, ty); c.lineTo(tx, ty - ts * 0.62); c.lineTo(tx + ts * 0.2, ty); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(tx - ts, ty); c.lineTo(tx, ty - ts * 1.1); c.lineTo(tx + ts, ty); c.stroke();
    }
    for (let i = 0; i < ED.BIOMES.length; i++) { const bx = bannerX(W, i), by = H * 0.72; c.fillStyle = '#2a1e16'; c.fillRect(bx - 1.5, by - fs * 2.2, 3, fs * 2.2); }
    c.strokeStyle = '#2a1e16'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W * 0.3, H * 0.6); c.quadraticCurveTo(W * 0.5, H * 0.66, W * 0.7, H * 0.6); c.stroke();
    for (let i = 0; i < o.lanterns; i++) { const k = (i + 0.5) / o.lanterns, lx = W * (0.3 + 0.4 * k), ly = H * (0.6 + Math.sin(k * Math.PI) * 0.045) + 6; c.fillStyle = '#ffcf7a'; c.fillRect(lx - 3, ly - 4, 6, 8); c.fillStyle = '#5a4630'; c.fillRect(lx - 3.5, ly - 5, 7, 1.5); c.fillRect(lx - 3.5, ly + 3.5, 7, 1.5); }
    return { bg, sky };
  }

  // x of boss banner pole i (one per stratum): the first half right of the fire, the rest left.
  const bannerX = (W, i) => { const half = Math.ceil(ED.BIOMES.length / 2), j = i % half; return W * (0.68 - j * 0.045) + (i >= half ? -W * 0.33 : 0); };
  Camp.draw = (c0, profile, t, dt, heroCls) => {
    const R = ED.Render, W = R.bw, H = R.bh; // the scene is laid out in world-buffer pixels (the buffer is upscaled to the screen)
    const c = R.beginWorld();
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    const deepest = Math.max(1, Math.min(ED.BIOMES.length, profile ? profile.stats.deepest || 1 : 1));
    const biome = ED.biomeFor(deepest);
    const pact = profile ? profile.pactMax : 0;
    const ups = profile ? profile.up.reduce((a, b) => a + b, 0) : 0;
    const tents = Math.min(4, 1 + Math.floor(ups / 6)), lanterns = Math.min(10, 2 + Math.floor((profile ? profile.lifetime : 0) / 120));
    const key = [W, H, deepest, pact > 0 ? Math.min(6, pact) : 0, tents, lanterns].join(':');
    if (key !== Camp.bgKey) {
      Camp.bg = buildBg(W, H, profile, biome, { pact, tents, lanterns }); Camp.bgKey = key;
      const m = Camp.moon, k = R.scale / (R.dpr || 1); // the buffer presents at R.scale device px per px from the top-left
      Camp.moonCss = { x: m.x * k, y: m.y * k, r: m.r * k };
      if (ED.PixUI && ED.PixUI.menuVignette) ED.PixUI.menuVignette();
    }
    const fx = W * 0.58, fy = H * 0.8, fs = Math.min(W, H) * 0.06, gx = W * 0.82, gy = H * 0.64, gw = Math.min(W, H) * 0.2;
    const fl = 1 + Math.sin(t * 8) * 0.04 + Math.sin(t * 13.7) * 0.04 + Math.sin(t * 3.1) * 0.03, blue = !!(ED.Cos && ED.Cos.blueHearth(profile)), FC = blue ? FIRE.blue : FIRE.warm;
    // ---- lit pass ----
    c.drawImage(Camp.bg.bg, 0, 0);
    // drifting smoke
    Camp.smokeT -= dt;
    if (Camp.smokeT <= 0) { Camp.smokeT = 0.14; Camp.smoke.push({ x: fx + (Math.random() - 0.5) * fs * 0.4, y: fy - fs * 1.2, vx: 6 + Math.random() * 8, vy: -22 - Math.random() * 14, life: 4.5, max: 4.5, r: fs * 0.25 }); }
    for (const s of Camp.smoke) { s.life -= dt; s.x += s.vx * dt + Math.sin(t * 0.8 + s.y * 0.02) * 0.3; s.y += s.vy * dt; s.r += dt * fs * 0.28; }
    Camp.smoke = Camp.smoke.filter(s => s.life > 0);
    for (const s of Camp.smoke) { const k = s.life / s.max; c.globalAlpha = Math.min(0.11, k * 0.14) * Math.min(1, (1 - k) * 8); c.drawImage(R.glowSprite('#b8b0c8'), s.x - s.r, s.y - s.r, s.r * 2, s.r * 2); }
    c.globalAlpha = 1;
    // boss banners (flags wave)
    for (let i = 0; i < ED.BIOMES.length; i++) {
      const bx = bannerX(W, i), by = H * 0.72;
      if (profile && (profile.bosses & (1 << i))) {
        const col = ED.BIOMES[i].pal.accent, wave = Math.sin(t * 2 + i) * 3, w2 = Math.sin(t * 2.6 + i + 1) * 2;
        c.fillStyle = col; c.beginPath(); c.moveTo(bx, by - fs * 2.15); c.quadraticCurveTo(bx + fs * 0.4 + wave, by - fs * 2.2 + w2, bx + fs * 0.7 + wave, by - fs * 2.05); c.lineTo(bx + fs * 0.65 + wave, by - fs * 1.35); c.lineTo(bx + fs * 0.35, by - fs * 1.5); c.lineTo(bx, by - fs * 1.35); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(bx, by - fs * 2.15, 1.5, fs * 0.8);
      }
    }
    // campfire logs and ember bed
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(fx, fy + fs * 0.15, fs * 1.1, fs * 0.28, 0, 0, U.TAU); c.fill();
    for (let i = 0; i < 6; i++) { c.save(); c.translate(fx, fy); c.rotate(-1.1 + i * 0.44); c.fillStyle = i % 2 ? '#2e1d12' : '#3a2616'; c.fillRect(-fs * 0.72, -fs * 0.08, fs * 1.44, fs * 0.16); c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(-fs * 0.72, -fs * 0.08, fs * 1.44, 1.5); c.restore(); }
    // the chosen hero by the fire
    if (heroCls && ED.CLASSES[heroCls]) {
      c.save(); c.translate(Math.round(fx + fs * 1.9), Math.round(fy + fs * 0.15)); const hs = Math.max(1, Math.round(fs / 26)); c.scale(hs, hs); c.imageSmoothingEnabled = false; // whole-number scale: equal art pixels
      Camp.wearT -= dt; // the hero's Wardrobe set and chosen weapon, re-read twice a second (S.wearBundle checks ownership)
      if (Camp.wearT <= 0 || Camp.wearK !== heroCls) {
        Camp.wearT = 0.5; Camp.wearK = heroCls; Camp.wear = profile && ED.Save.wearBundle ? ED.Save.wearBundle(profile, heroCls) : null;
        Camp.weapon = ED.App && ED.App.weaponFor && profile ? ED.App.weaponFor(heroCls) : ED.CLASSES[heroCls].weapons[0];
      }
      const hero = { cls: heroCls, slot: 0, weapon: Camp.weapon || ED.CLASSES[heroCls].weapons[0], face: Math.PI * 0.85, moving: false, hp: 1, wear: Camp.wear };
      if (ED.Cos && Camp.wear && Camp.wear.pet === 'pet.platino') ED.Cos.drawPetAt(c, 20, 6, -1, t, 0, 1, 0); // the pet waits behind its hero
      ED.Sprites.hero(c, hero, t, null);
      c.restore();
    }
    if (blue && ED.Cos) { // the Blue Hearth's ghost delver sits across the fire, facing it
      c.save(); c.translate(Math.round(fx - fs * 1.9), Math.round(fy + fs * 0.15)); const hs = Math.max(1, Math.round(fs / 26)); c.scale(hs, hs); c.imageSmoothingEnabled = false;
      ED.Cos.drawGhost(c, 0, 0, t, false, 0.55);
      c.restore();
    }
    if (profile && profile.stats.wins > 0) { // the hollow crown, taken
      for (let i = 0; i < 7; i++) { const a = t * 0.5 + i * U.TAU / 7, x = gx + Math.cos(a) * gw * 0.18, y = gy - gw * 1.08 + Math.sin(a) * gw * 0.04; c.fillStyle = '#ffd36b'; c.beginPath(); c.moveTo(x - 3, y + 5); c.lineTo(x, y - 8); c.lineTo(x + 3, y + 5); c.fill(); }
    }
    // ---- lighting: cold night ambient, warm pools ----
    R.lightBegin([44, 50, 82]);
    R.lightAdd(fx, fy - fs * 0.4, fs * 11 * fl, FC.pool, 1.15);
    R.lightAdd(fx, fy - fs * 0.5, fs * 4 * fl, FC.pool2, 0.85);
    R.lightAdd(gx, gy - gw * 0.3, gw * 2.4, biome.pal.accent, 0.8 + Math.sin(t * 1.3) * 0.06);
    R.lightAdd(W * 0.2, H * 0.17, Math.min(W, H) * 0.8, '#8aa0d8', 0.3);
    for (let i = 0; i < lanterns; i++) { const k = (i + 0.5) / lanterns, lx = W * (0.3 + 0.4 * k), ly = H * (0.6 + Math.sin(k * Math.PI) * 0.045) + 6; R.lightAdd(lx, ly, fs * 2.8, '#ffb35c', 0.7 + Math.sin(t * 3 + i) * 0.1); }
    R.lightEnd(c);
    // ---- emissive pass ----
    c.globalCompositeOperation = 'lighter';
    c.drawImage(Camp.bg.sky, 0, 0);
    // twinkle on the brightest stars
    const rs = U.RNG(42);
    for (let i = 0; i < 28; i++) { const x = rs.next() * W, y = rs.next() * H * 0.5, ph = rs.next() * 6, tw = 0.5 + Math.sin(t * (1.2 + (i % 5) * 0.3) + ph) * 0.5; c.globalAlpha = 0.15 + tw * 0.5; c.fillStyle = '#fff6e0'; c.fillRect(x - 1, y - 1, 2.4, 2.4); if (i % 4 === 0) { c.fillRect(x - 4, y - 0.4, 9, 0.8); c.fillRect(x - 0.4, y - 4, 0.8, 9); } }
    c.globalAlpha = 1;
    // a drifting aurora-like veil in the gate's colour
    for (let i = 0; i < 2; i++) { c.save(); c.translate(W * (0.35 + i * 0.3) + Math.sin(t * 0.1 + i) * W * 0.05, H * 0.28); c.scale(3.2, 0.55); R.glow(c, 0, 0, H * 0.3, biome.pal.accent, 0.05 + Math.sin(t * 0.3 + i * 2) * 0.012); c.restore(); }
    // gate glow, lantern glows
    R.glow(c, gx, gy - gw * 0.3, gw * 1.5, biome.pal.accent, 0.34 + Math.sin(t * 1.3) * 0.05);
    const inner = c.createLinearGradient(0, gy - gw, 0, gy + gw * 0.1); inner.addColorStop(0, U.rgba(biome.pal.accent, 0)); inner.addColorStop(1, U.rgba(biome.pal.accent, 0.5));
    c.fillStyle = inner; c.beginPath(); c.moveTo(gx - gw * 0.46, gy + gw * 0.08); c.lineTo(gx - gw * 0.46, gy - gw * 0.55); c.quadraticCurveTo(gx, gy - gw * 1.18, gx + gw * 0.46, gy - gw * 0.55); c.lineTo(gx + gw * 0.46, gy + gw * 0.08); c.fill();
    for (let i = 0; i < lanterns; i++) { const k = (i + 0.5) / lanterns, lx = W * (0.3 + 0.4 * k), ly = H * (0.6 + Math.sin(k * Math.PI) * 0.045) + 6; R.glow(c, lx, ly, fs * 1.1, '#ffb35c', 0.55 + Math.sin(t * 3 + i) * 0.12); c.fillStyle = 'rgba(255,230,170,0.85)'; c.fillRect(lx - 2, ly - 3, 4, 6); }
    // campfire: glow, ember bed, layered flames
    R.glow(c, fx, fy - fs * 0.4, fs * 5 * fl, FC.glow, 0.4);
    R.glow(c, fx, fy - fs * 0.2, fs * 1.8, FC.core, 0.5 * fl);
    if (blue) R.glow(c, fx - fs * 1.9, fy - fs * 0.6, fs * 1.4, '#9dc3ee', 0.12 + Math.sin(t * 1.6) * 0.03); // the ghost's faint glow
    for (let i = 0; i < 5; i++) {
      const f1 = Math.sin(t * 9 + i * 1.7), f2 = Math.sin(t * 14 + i * 2.9), h = fs * (1.5 - i * 0.22) * (1 + f1 * 0.09), sw = fs * (0.55 - i * 0.1);
      c.fillStyle = FC.flames[i];
      c.beginPath(); c.moveTo(fx - sw, fy); c.quadraticCurveTo(fx - sw * 0.7 + f1 * 3, fy - h * 0.55, fx + f2 * 3, fy - h); c.quadraticCurveTo(fx + sw * 0.7 + f1 * 3, fy - h * 0.55, fx + sw, fy); c.fill();
    }
    for (let i = 0; i < 3; i++) { const a = t * 2.1 + i * 2.1, x = fx + Math.sin(a) * fs * 0.35, y = fy - fs * (0.6 + Math.abs(Math.sin(a * 1.3)) * 0.7); R.glow(c, x, y, fs * 0.5, FC.tongue, 0.4); }
    // sparks
    if (Math.random() < dt * 30) Camp.sparks.push({ x: fx + (Math.random() - 0.5) * fs, y: fy - fs * 0.6, vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 60, life: 1.5 + Math.random() * 2, max: 3.5 });
    for (const s of Camp.sparks) { s.life -= dt; s.x += s.vx * dt + Math.sin(t * 3 + s.y * 0.05) * 0.4; s.y += s.vy * dt; }
    Camp.sparks = Camp.sparks.filter(s => s.life > 0);
    const sr = FC.sparkRgb;
    for (const s of Camp.sparks) { const a = Math.min(1, s.life); c.fillStyle = `rgba(${sr[0]},${sr[1] + Math.random() * sr[3] | 0},${sr[2]},${a})`; c.fillRect(Math.round(s.x), Math.round(s.y), 1, 1); if (R.quality !== 'low') R.glow(c, s.x, s.y, 4, FC.spark, a * 0.5); }
    // fireflies
    if (!Camp.flies) { const r = U.RNG(99); Camp.flies = []; for (let i = 0; i < 14; i++) Camp.flies.push({ x: r.next(), y: 0.66 + r.next() * 0.3, ph: r.next() * 6, sp: 0.2 + r.next() * 0.4 }); }
    if (R.quality !== 'low') for (const f of Camp.flies) { const x = (f.x + Math.sin(t * f.sp + f.ph) * 0.03) * W, y = (f.y + Math.cos(t * f.sp * 1.3 + f.ph) * 0.02) * H, b = Math.max(0, Math.sin(t * 1.7 + f.ph * 3)); R.glow(c, x, y, 4, '#d8ff8a', 0.15 + b * 0.7); }
    c.globalCompositeOperation = 'source-over';
    if (!R.posting) {
      const v = c.createRadialGradient(fx, fy, fs * 2, fx, fy, Math.max(W, H) * 0.8);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
      c.fillStyle = v; c.fillRect(0, 0, W, H);
    }
    R.endWorld(R.postOpts(biome, t, { aberr: 0, flash: null, lightLevel: 1, vig: 0.55, bloom: 0.62 }));
  };
})(globalThis.ED || (globalThis.ED = {}));
