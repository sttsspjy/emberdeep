// The Hearth: an animated camp at the mouth of the Deep, shown behind the menus.
// It grows with progress: more tents and lanterns as upgrades are bought, a banner per slain boss,
// and the gate glows with the colour of the deepest stratum reached.
(function (ED) {
  'use strict';
  const U = ED.U;
  const Camp = ED.Camp = { sparks: [], stars: null };

  Camp.draw = (c, profile, t, dt, heroCls) => {
    const R = ED.Render, W = R.W, H = R.H;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const deepest = Math.max(1, Math.min(6, profile ? profile.stats.deepest || 1 : 1));
    const biome = ED.biomeFor(deepest);
    const pact = profile ? profile.pactMax : 0;
    // sky
    const sky = c.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, '#07060a'); sky.addColorStop(1, U.mix('#1a1210', biome.pal.accent, 0.08));
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    if (!Camp.stars || Camp.stars.w !== W) {
      const rng = U.RNG(42); Camp.stars = { w: W, list: [] };
      for (let i = 0; i < 140; i++) Camp.stars.list.push([rng.next() * W, rng.next() * H * 0.5, rng.next() * 1.6 + 0.3, rng.next() * 6]);
    }
    for (const s of Camp.stars.list) { c.fillStyle = `rgba(255,240,220,${0.25 + Math.sin(t * 1.5 + s[3]) * 0.2})`; c.fillRect(s[0], s[1], s[2], s[2]); }
    // moon (red under a pact)
    const mx = W * 0.2, my = H * 0.17, mr = Math.min(W, H) * 0.05;
    const moonCol = pact > 0 ? U.mix('#f3e3c0', '#d3302a', Math.min(1, pact / 6)) : '#f3e3c0';
    ED.Render.glow(c, mx, my, mr * 4, moonCol, 0.25);
    c.fillStyle = moonCol; c.beginPath(); c.arc(mx, my, mr, 0, U.TAU); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.beginPath(); c.arc(mx + mr * 0.3, my - mr * 0.2, mr * 0.25, 0, U.TAU); c.arc(mx - mr * 0.3, my + mr * 0.3, mr * 0.18, 0, U.TAU); c.fill();
    // far mountains
    c.fillStyle = '#100c0b';
    c.beginPath(); c.moveTo(0, H * 0.62);
    for (let i = 0; i <= 12; i++) { const x = i / 12 * W; c.lineTo(x, H * (0.46 + Math.sin(i * 1.7) * 0.05 + (i % 3) * 0.02)); }
    c.lineTo(W, H); c.lineTo(0, H); c.fill();
    // cliff with the gate to the Deep
    const gx = W * 0.82, gy = H * 0.64, gw = Math.min(W, H) * 0.2;
    c.fillStyle = '#16100e';
    c.beginPath(); c.moveTo(W * 0.62, H); c.lineTo(W * 0.66, H * 0.48); c.lineTo(W * 0.78, H * 0.36); c.lineTo(W * 0.95, H * 0.4); c.lineTo(W, H * 0.44); c.lineTo(W, H); c.fill();
    const glowC = biome.pal.accent;
    ED.Render.glow(c, gx, gy - gw * 0.3, gw * 2.2, glowC, 0.35 + Math.sin(t * 1.3) * 0.05);
    c.fillStyle = '#050304';
    c.beginPath(); c.moveTo(gx - gw * 0.5, gy + gw * 0.1); c.lineTo(gx - gw * 0.5, gy - gw * 0.55); c.quadraticCurveTo(gx, gy - gw * 1.25, gx + gw * 0.5, gy - gw * 0.55); c.lineTo(gx + gw * 0.5, gy + gw * 0.1); c.fill();
    const inner = c.createLinearGradient(0, gy - gw, 0, gy + gw * 0.1);
    inner.addColorStop(0, U.rgba(glowC, 0.0)); inner.addColorStop(1, U.rgba(glowC, 0.55));
    c.fillStyle = inner; c.fill();
    c.strokeStyle = '#3a2c24'; c.lineWidth = gw * 0.06; c.stroke();
    if (profile && profile.stats.wins > 0) { // the hollow crown, taken
      for (let i = 0; i < 7; i++) { const a = t * 0.5 + i * U.TAU / 7, x = gx + Math.cos(a) * gw * 0.18, y = gy - gw * 1.08 + Math.sin(a) * gw * 0.04; c.fillStyle = '#ffd36b'; c.beginPath(); c.moveTo(x - 3, y + 5); c.lineTo(x, y - 8); c.lineTo(x + 3, y + 5); c.fill(); }
    }
    // steps down into the gate
    c.fillStyle = '#241a15';
    for (let i = 0; i < 4; i++) c.fillRect(gx - gw * (0.45 - i * 0.05), gy + gw * 0.1 + i * gw * 0.06, gw * (0.9 - i * 0.1), gw * 0.05);
    // ground
    const gr = c.createLinearGradient(0, H * 0.66, 0, H);
    gr.addColorStop(0, '#1d1511'); gr.addColorStop(1, '#0b0807');
    c.fillStyle = gr; c.beginPath(); c.moveTo(0, H * 0.7); c.quadraticCurveTo(W * 0.4, H * 0.64, W * 0.7, H * 0.7); c.lineTo(W, H * 0.72); c.lineTo(W, H); c.lineTo(0, H); c.fill();
    // fire position and growth
    const fx = W * 0.58, fy = H * 0.8, fs = Math.min(W, H) * 0.06;
    const ups = profile ? profile.up.reduce((a, b) => a + b, 0) : 0;
    // tents
    const tents = Math.min(4, 1 + Math.floor(ups / 6));
    for (let i = 0; i < tents; i++) {
      const tx = W * (0.36 + i * 0.075) - (i % 2) * W * 0.02, ty = H * (0.73 + (i % 2) * 0.02), ts = fs * (1.6 - i * 0.12);
      c.fillStyle = ['#3a2a22', '#2e2a3a', '#2a3a2e', '#3a2e22'][i];
      c.beginPath(); c.moveTo(tx - ts, ty); c.lineTo(tx, ty - ts * 1.1); c.lineTo(tx + ts, ty); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.moveTo(tx - ts * 0.18, ty); c.lineTo(tx, ty - ts * 0.6); c.lineTo(tx + ts * 0.18, ty); c.fill();
    }
    // boss banners
    for (let i = 0; i < 6; i++) {
      const bx = W * (0.68 - i * 0.045) + (i > 2 ? -W * 0.33 : 0), by = H * 0.72;
      const got = profile && (profile.bosses & (1 << i));
      c.fillStyle = '#2a1e16'; c.fillRect(bx - 1.5, by - fs * 2.2, 3, fs * 2.2);
      if (got) {
        const col = ED.BIOMES[i].pal.accent, wave = Math.sin(t * 2 + i) * 3;
        c.fillStyle = col; c.beginPath(); c.moveTo(bx, by - fs * 2.15); c.lineTo(bx + fs * 0.7 + wave, by - fs * 2.05); c.lineTo(bx + fs * 0.65 + wave, by - fs * 1.35); c.lineTo(bx + fs * 0.35, by - fs * 1.5); c.lineTo(bx, by - fs * 1.35); c.fill();
      }
    }
    // lanterns strung across
    const lanterns = Math.min(10, 2 + Math.floor((profile ? profile.lifetime : 0) / 120));
    c.strokeStyle = '#2a1e16'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W * 0.3, H * 0.6); c.quadraticCurveTo(W * 0.5, H * 0.66, W * 0.7, H * 0.6); c.stroke();
    for (let i = 0; i < lanterns; i++) {
      const k = (i + 0.5) / lanterns, lx = W * (0.3 + 0.4 * k), ly = H * (0.6 + Math.sin(k * Math.PI) * 0.045) + 6;
      ED.Render.glow(c, lx, ly, 26, '#ffb35c', 0.5 + Math.sin(t * 3 + i) * 0.1);
      c.fillStyle = '#ffcf7a'; c.fillRect(lx - 3, ly - 4, 6, 8);
    }
    // campfire
    ED.Render.glow(c, fx, fy - fs * 0.4, fs * 7, '#ff8a3d', 0.32 + Math.sin(t * 8) * 0.03);
    c.fillStyle = '#2a1a10';
    for (let i = 0; i < 5; i++) { c.save(); c.translate(fx, fy); c.rotate(-0.9 + i * 0.45); c.fillRect(-fs * 0.7, -fs * 0.07, fs * 1.4, fs * 0.14); c.restore(); }
    for (let i = 0; i < 4; i++) {
      const fl = Math.sin(t * 9 + i * 1.7), h = fs * (1.4 - i * 0.22) * (1 + fl * 0.08);
      c.fillStyle = ['#ff5a1a', '#ff8a2a', '#ffb347', '#fff1c4'][i];
      c.beginPath(); c.moveTo(fx - fs * (0.55 - i * 0.11), fy); c.quadraticCurveTo(fx - fs * 0.3 + fl * 4, fy - h * 0.6, fx + fl * 3, fy - h); c.quadraticCurveTo(fx + fs * 0.3 + fl * 4, fy - h * 0.6, fx + fs * (0.55 - i * 0.11), fy); c.fill();
    }
    // sparks
    if (Math.random() < dt * 30) Camp.sparks.push({ x: fx + (Math.random() - 0.5) * fs, y: fy - fs * 0.6, vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 60, life: 1.5 + Math.random() * 2 });
    for (const s of Camp.sparks) { s.life -= dt; s.x += s.vx * dt + Math.sin(t * 3 + s.y * 0.05) * 0.4; s.y += s.vy * dt; }
    Camp.sparks = Camp.sparks.filter(s => s.life > 0);
    c.globalCompositeOperation = 'lighter';
    for (const s of Camp.sparks) { c.fillStyle = `rgba(255,${150 + Math.random() * 80 | 0},60,${Math.min(1, s.life)})`; c.fillRect(s.x, s.y, 2.2 * R.dpr, 2.2 * R.dpr); }
    c.globalCompositeOperation = 'source-over';
    // the chosen hero by the fire
    if (heroCls && ED.CLASSES[heroCls]) {
      c.save(); c.translate(fx + fs * 1.9, fy + fs * 0.15); const hs = fs / 26; c.scale(hs, hs);
      ED.Sprites.hero(c, { cls: heroCls, slot: 0, weapon: ED.CLASSES[heroCls].weapons[0], face: Math.PI * 0.85, moving: false, hp: 1, mastery10: false }, t, null);
      c.restore();
    }
    // darkness vignette
    const v = c.createRadialGradient(fx, fy, fs * 2, fx, fy, Math.max(W, H) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  };
})(globalThis.ED || (globalThis.ED = {}));
