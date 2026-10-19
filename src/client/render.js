// World renderer: camera, cached room art, zones, props, entities, projectiles, particles and dynamic lighting.
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.CONST.TILE, Sp = ED.Sprites;
  const R = ED.Render = { cam: { x: 0, y: 0 }, scale: 2, W: 0, H: 0, dpr: 1, quality: 'high' };
  const glowCache = {};
  let lightCv, lctx, vignette, lightSprite;

  R.init = (canvas) => {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d', { alpha: false });
    lightCv = document.createElement('canvas');
    lctx = lightCv.getContext('2d');
    lightSprite = document.createElement('canvas'); lightSprite.width = lightSprite.height = 128;
    const g = lightSprite.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    window.addEventListener('resize', R.resize);
    R.resize();
  };

  R.setQuality = (q) => { R.quality = q; R.resize(); };

  R.resize = () => {
    const cssW = window.innerWidth, cssH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, R.quality === 'low' ? 1 : 1.5);
    while (cssW * cssH * dpr * dpr > 2.8e6 && dpr > 0.6) dpr -= 0.1;
    R.dpr = dpr;
    R.canvas.width = Math.round(cssW * dpr); R.canvas.height = Math.round(cssH * dpr);
    R.W = R.canvas.width; R.H = R.canvas.height;
    R.scale = Math.min(R.W / ED.CONST.VIEW_W, R.H / ED.CONST.VIEW_H);
    const div = R.quality === 'low' ? 5 : 3;
    lightCv.width = Math.ceil(R.W / div); lightCv.height = Math.ceil(R.H / div);
    R.lightDiv = div;
    vignette = document.createElement('canvas'); vignette.width = 256; vignette.height = 256;
    const v = vignette.getContext('2d'), vg = v.createRadialGradient(128, 128, 60, 128, 128, 182);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = vg; v.fillRect(0, 0, 256, 256);
    ED.Tiles.clear();
  };

  R.glowSprite = (color) => {
    if (glowCache[color]) return glowCache[color];
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, U.rgba(color, 0.9)); gr.addColorStop(0.35, U.rgba(color, 0.35)); gr.addColorStop(1, U.rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache[color] = cv;
    return cv;
  };
  R.glow = (c, x, y, r, color, a) => {
    c.globalAlpha = a === undefined ? 1 : a;
    c.drawImage(R.glowSprite(color), x - r, y - r, r * 2, r * 2);
    c.globalAlpha = 1;
  };

  R.toScreen = (x, y) => ({ x: (x - R.cam.x) * R.scale + R.W / 2, y: (y - R.cam.y) * R.scale + R.H / 2 });
  R.toWorld = (sx, sy) => ({ x: (sx - R.W / 2) / R.scale + R.cam.x, y: (sy - R.H / 2) / R.scale + R.cam.y });

  R.updateCamera = (view, focus, dt, snap) => {
    const room = view.room; if (!room) return;
    const rw = room.w * T, rh = room.h * T;
    const vw = R.W / R.scale, vh = R.H / R.scale;
    let tx = focus ? focus.x : rw / 2, ty = focus ? focus.y - 10 : rh / 2;
    tx = vw >= rw ? rw / 2 : U.clamp(tx, vw / 2, rw - vw / 2);
    ty = vh >= rh ? rh / 2 : U.clamp(ty, vh / 2 - 8, rh - vh / 2 + 8);
    if (snap) { R.cam.x = tx; R.cam.y = ty; }
    else { const k = Math.min(1, dt * 8); R.cam.x += (tx - R.cam.x) * k; R.cam.y += (ty - R.cam.y) * k; }
  };

  // ---------------- main frame ----------------
  R.frame = (view, local, t, dt) => {
    const c = R.ctx, room = view.room;
    const biome = ED.biomeFor(view.stratum || 1), P = biome.pal;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = P.void; c.fillRect(0, 0, R.W, R.H);
    if (!room) return;
    let sx = 0, sy = 0;
    if (ED.FX.shake > 0) { sx = (Math.random() - 0.5) * ED.FX.shake * R.scale * 0.6; sy = (Math.random() - 0.5) * ED.FX.shake * R.scale * 0.6; }
    const ox = Math.round(-R.cam.x * R.scale + R.W / 2 + sx), oy = Math.round(-R.cam.y * R.scale + R.H / 2 + sy);
    c.setTransform(R.scale, 0, 0, R.scale, ox, oy);
    // room art
    const art = ED.Tiles.get(room, R.scale);
    c.drawImage(art, 0, 0, art.width / R.scale, art.height / R.scale);
    drawRoomDynamics(c, view, room, biome, t);
    drawDoors(c, view, room, P, t);
    drawZones(c, view, t);
    drawPickups(c, view, t);
    drawProps(c, view, local, t);
    // entities sorted by depth
    const list = [];
    for (const p of view.players.values()) list.push({ y: p.y, k: 0, o: p });
    for (const e of view.enemies) if (e.hp > 0) list.push({ y: e.y, k: 1, o: e });
    for (const a of view.allies) list.push({ y: a.y, k: 2, o: a });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      c.save(); c.translate(it.o.x, it.o.y);
      if (it.k === 0) { drawCompanions(c, it.o, view, t, true); Sp.hero(c, it.o, t, ED.FX.anim[it.o.pid]); drawCompanions(c, it.o, view, t, false); }
      else if (it.k === 1) Sp.enemy(c, it.o, t);
      else Sp.minion(c, it.o, t);
      c.restore();
    }
    drawProjectiles(c, view, t);
    ED.FX.drawWorld(c);
    // glows from lights (additive colour)
    if (R.quality !== 'low') drawGlows(c, view, room, biome, t);
    // lighting overlay
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawLighting(c, view, room, biome, local, t, ox, oy);
    c.drawImage(vignette, 0, 0, R.W, R.H);
    if (view.pact > 0) { c.fillStyle = `rgba(120,10,10,${Math.min(0.22, view.pact * 0.02)})`; c.globalCompositeOperation = 'multiply'; c.fillRect(0, 0, R.W, R.H); c.globalCompositeOperation = 'source-over'; }
    // overlays in world space above lighting
    c.setTransform(R.scale, 0, 0, R.scale, ox, oy);
    c.globalCompositeOperation = 'lighter';
    const eyeA = 0.2 + P.darkness * 0.5;
    for (const e of view.enemies) if (e.hp > 0) R.glow(c, e.x, e.y - e.r * (e.def.fly ? 2.2 : 1.7), 5 + e.r * 0.5, e.def.col.c, eyeA);
    c.globalCompositeOperation = 'source-over';
    drawOverheads(c, view, local, t);
    ED.FX.drawTexts(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  };

  // ---------------- room details ----------------
  function drawRoomDynamics(c, view, room, biome, t) {
    // torches flames
    for (const tc of room.torches) {
      const x = tc.x * T, y = tc.y * T - 6, f = Math.sin(t * 13 + x) * 1.2;
      c.fillStyle = '#ff9a3a'; c.beginPath(); c.moveTo(x - 3.5, y + 2); c.quadraticCurveTo(x - 3, y - 6 + f, x, y - 10 + f); c.quadraticCurveTo(x + 3, y - 6 - f, x + 3.5, y + 2); c.fill();
      c.fillStyle = '#ffe9a0'; c.beginPath(); c.ellipse(x, y - 1, 1.6, 3, 0, 0, U.TAU); c.fill();
    }
    // spike traps cycle
    if (biome.hazard === 'spikes') {
      const up = (t % 1.8) < 0.7;
      if (up) for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (room.tiles[y * room.w + x] === 4) {
        c.fillStyle = '#c9c4b4';
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const px = x * T + 8 + i * 8, py = y * T + 8 + j * 8; c.beginPath(); c.moveTo(px - 2, py + 1); c.lineTo(px, py - 5); c.lineTo(px + 2, py + 1); c.fill(); }
      }
    }
    if (biome.hazard === 'water' && R.quality !== 'low') {
      c.strokeStyle = 'rgba(160,240,255,0.18)'; c.lineWidth = 1;
      for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (room.tiles[y * room.w + x] === 4) { const k = (t * 0.6 + (x + y) * 0.3) % 1; c.beginPath(); c.ellipse(x * T + 16, y * T + 16, 4 + k * 10, 2 + k * 5, 0, 0, U.TAU); c.stroke(); }
    }
  }

  function drawDoors(c, view, room, P, t) {
    if (!view.locked) return;
    for (const d in room.doors) {
      if (room.doors[d] < 0) continue;
      const r = ED.Dungeon.doorRect(room, d);
      const x0 = r.x0 * T, y0 = r.y0 * T, x1 = (r.x1 + 1) * T, y1 = (r.y1 + 1) * T;
      const pulse = 0.55 + Math.sin(t * 4) * 0.2;
      c.fillStyle = 'rgba(20,10,8,0.85)'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.strokeStyle = U.rgba(P.accent, pulse); c.lineWidth = 2;
      if (d === 'n' || d === 's') { for (let x = x0 + 8; x < x1; x += 12) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke(); } }
      else { for (let y = y0 + 8; y < y1; y += 12) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); } }
      R.glow(c, (x0 + x1) / 2, (y0 + y1) / 2, 34, P.accent, 0.4 * pulse);
    }
  }

  // ---------------- zones ----------------
  function drawZones(c, view, t) {
    for (const z of view.zones) {
      const k = z.dur ? U.clamp(z.t / z.dur, 0, 1) : 0;
      switch (z.kind) {
        case 'spawn': {
          c.save(); c.translate(z.x, z.y);
          c.strokeStyle = U.rgba(z.elite ? '#ffb13a' : '#b8a0ff', 0.8); c.lineWidth = 2;
          for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0, 0, (z.r || 14) * (0.4 + k * 0.8), t * 4 + i * 2.1, t * 4 + i * 2.1 + 1.4); c.stroke(); }
          R.glow(c, 0, 0, 26 * (0.4 + k), z.elite ? '#ffb13a' : '#9a7aff', 0.6);
          c.restore();
          break;
        }
        case 'tele': {
          const friendly = z.team === 0;
          const col = friendly ? '#ffb347' : '#ff3a2a';
          if (z.lob) {
            const sx = z.lob[0], sy = z.lob[1];
            const px = U.lerp(sx, z.x, k), py = U.lerp(sy, z.y, k) - Math.sin(k * Math.PI) * 70;
            R.glow(c, px, py, 18, '#ff8a2a', 0.9); c.fillStyle = '#ffcf6a'; c.beginPath(); c.arc(px, py, 5, 0, U.TAU); c.fill();
          }
          c.fillStyle = U.rgba(col, friendly ? 0.12 : 0.16); c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.fill();
          c.fillStyle = U.rgba(col, friendly ? 0.2 : 0.28); c.beginPath(); c.arc(z.x, z.y, z.r * k, 0, U.TAU); c.fill();
          c.strokeStyle = U.rgba(col, 0.75); c.lineWidth = 1.5; c.beginPath(); c.arc(z.x, z.y, z.r, 0, U.TAU); c.stroke();
          if (z.kind2 === 'bomb' || z.kindTag === 'bomb') break;
          break;
        }
        case 'bomb': {
          c.fillStyle = '#2a2a2e'; c.beginPath(); c.arc(z.x, z.y - 4, 6, 0, U.TAU); c.fill();
          c.fillStyle = Math.floor(t * 12) % 2 ? '#ffd36b' : '#ff6a2a'; c.beginPath(); c.arc(z.x + 4, z.y - 11, 2, 0, U.TAU); c.fill();
          c.strokeStyle = U.rgba('#ffb347', 0.5); c.lineWidth = 1; c.beginPath(); c.arc(z.x, z.y, z.r * k, 0, U.TAU); c.stroke();
          break;
        }
        case 'decoy': {
          c.save(); c.globalAlpha = 0.5 + Math.sin(t * 20) * 0.2; c.translate(z.x, z.y);
          c.fillStyle = '#2a1f44'; c.beginPath(); c.ellipse(0, -12, 7, 12, 0, 0, U.TAU); c.fill();
          R.glow(c, 0, -12, 24 + k * 20, '#b78cff', 0.6); c.restore();
          break;
        }
        case 'teleLine': {
          c.save(); c.translate(z.x, z.y); c.rotate(z.a);
          c.fillStyle = 'rgba(255,58,42,0.12)'; c.fillRect(0, -z.w / 2, z.len, z.w);
          c.fillStyle = 'rgba(255,58,42,0.28)'; c.fillRect(0, -z.w / 2, z.len * k, z.w);
          c.strokeStyle = 'rgba(255,90,60,0.7)'; c.lineWidth = 1; c.strokeRect(0, -z.w / 2, z.len, z.w);
          c.restore();
          break;
        }
        case 'teleCone': {
          c.save(); c.translate(z.x, z.y);
          c.fillStyle = 'rgba(255,58,42,0.14)'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, z.r, z.a - z.arc / 2, z.a + z.arc / 2); c.closePath(); c.fill();
          c.fillStyle = 'rgba(255,58,42,0.3)'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, z.r * k, z.a - z.arc / 2, z.a + z.arc / 2); c.closePath(); c.fill();
          c.restore();
          break;
        }
        case 'laser': {
          const active = z.t > (z.warm || 0);
          c.save(); c.translate(z.x, z.y); c.rotate(z.a);
          if (active) {
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = 'rgba(255,90,220,0.35)'; c.fillRect(0, -z.w, z.len, z.w * 2);
            c.fillStyle = 'rgba(255,200,250,0.9)'; c.fillRect(0, -z.w / 4, z.len, z.w / 2);
            c.globalCompositeOperation = 'source-over';
          } else { c.strokeStyle = 'rgba(255,90,220,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 0); c.lineTo(z.len, 0); c.stroke(); }
          c.restore();
          break;
        }
        case 'poison': case 'plague': {
          const col = z.kind === 'plague' ? '#a6ff6a' : '#7ad44a';
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 4);
          c.fillStyle = U.rgba(z.kind === 'plague' ? '#5a8a2a' : '#3f6a22', 0.28 * fade);
          for (let i = 0; i < 5; i++) { const a = i * 1.26 + t * 0.5; c.beginPath(); c.arc(z.x + Math.cos(a) * z.r * 0.35, z.y + Math.sin(a) * z.r * 0.25, z.r * 0.6, 0, U.TAU); c.fill(); }
          R.glow(c, z.x, z.y, z.r * 1.1, col, 0.25 * fade);
          break;
        }
        case 'fire': case 'pfire': {
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5);
          R.glow(c, z.x, z.y, z.r * 1.4, z.kind === 'pfire' ? '#ffb347' : '#ff5a1a', 0.55 * fade);
          c.fillStyle = U.rgba('#ffcf6a', 0.75 * fade);
          for (let i = 0; i < 3; i++) { const fx = z.x + Math.sin(i * 2.3 + z.id) * z.r * 0.5, fy = z.y + Math.cos(i * 1.7 + z.id) * z.r * 0.3, h = 6 + Math.sin(t * 14 + i + z.id) * 2; c.beginPath(); c.moveTo(fx - 3, fy); c.quadraticCurveTo(fx, fy - h * 1.6, fx + 3, fy); c.fill(); }
          break;
        }
        case 'sanct': {
          const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5);
          c.save(); c.translate(z.x, z.y);
          c.fillStyle = U.rgba('#ffe9a0', 0.12 * fade); c.beginPath(); c.arc(0, 0, z.r, 0, U.TAU); c.fill();
          c.strokeStyle = U.rgba('#ffe9a0', 0.7 * fade); c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, z.r, 0, U.TAU); c.stroke();
          c.rotate(t * 0.8); c.beginPath(); for (let i = 0; i < 6; i++) { const a = i * U.TAU / 6; c.moveTo(Math.cos(a) * z.r * 0.7, Math.sin(a) * z.r * 0.7); c.lineTo(Math.cos(a + 2.09) * z.r * 0.7, Math.sin(a + 2.09) * z.r * 0.7); } c.stroke();
          c.restore();
          break;
        }
        case 'pull': {
          c.save(); c.translate(z.x, z.y);
          c.strokeStyle = 'rgba(111,230,255,0.25)'; c.lineWidth = 2;
          for (let i = 0; i < 4; i++) { const rr = ((t * 60 + i * 70) % 280); c.beginPath(); c.arc(0, 0, z.r * (1 - rr / 280), t * 2 + i, t * 2 + i + 3.5); c.stroke(); }
          c.restore();
          break;
        }
        default: break;
      }
    }
  }

  // ---------------- pickups & props ----------------
  function drawPickups(c, view, t) {
    for (const pk of view.pickups) {
      const bob = Math.sin(t * 5 + pk.id) * 1.5;
      if (pk.kind === 'gold') {
        R.glow(c, pk.x, pk.y - 4, 10, '#ffd36b', 0.45);
        c.fillStyle = '#e6b84a'; c.strokeStyle = '#6a4a12'; c.lineWidth = 1; c.beginPath(); c.ellipse(pk.x, pk.y - 4 + bob, 3.5 * Math.abs(Math.cos(t * 4 + pk.id)) + 0.8, 3.5, 0, 0, U.TAU); c.fill(); c.stroke();
      } else if (pk.kind === 'xp') {
        R.glow(c, pk.x, pk.y - 4, 10, '#7dffd9', 0.6);
        c.fillStyle = '#b6fff0'; c.beginPath(); c.moveTo(pk.x, pk.y - 8 + bob); c.lineTo(pk.x + 3, pk.y - 4 + bob); c.lineTo(pk.x, pk.y + bob); c.lineTo(pk.x - 3, pk.y - 4 + bob); c.fill();
      } else if (pk.kind === 'heart') {
        R.glow(c, pk.x, pk.y - 6, 16, '#ff4a5a', 0.55);
        c.save(); c.translate(pk.x, pk.y - 6 + bob); c.scale(0.28, 0.28);
        c.fillStyle = '#ff4a5a'; c.strokeStyle = '#3a0a10'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(0, 18); c.bezierCurveTo(-24, 2, -22, -20, -8, -20); c.quadraticCurveTo(-2, -20, 0, -12); c.quadraticCurveTo(2, -20, 8, -20); c.bezierCurveTo(22, -20, 24, 2, 0, 18); c.fill(); c.stroke();
        c.restore();
      }
    }
  }

  const PROP_LABEL = {
    chest: () => 'Open', fountain: () => 'Drink (heal party 50%)', altar: (p, me) => `Bleed 20% health for an epic boon`,
    gamble: (p) => `Offer ${p.price} gold for a random relic`, trial: () => 'Begin the trial (elite fight, rare relic)', portal: () => 'Descend',
  };
  R.propPrompt = (p, view) => {
    if (p.kind === 'relic') return 'Take ' + ED.RELICS[p.item].name;
    if (p.kind === 'shop') { const name = p.stype === 'relic' ? ED.RELICS[p.item].name : p.stype === 'boon' ? 'Epic boon' : 'Healing draught (45%)'; return `Buy ${name} — ${p.price}g`; }
    return PROP_LABEL[p.kind] ? PROP_LABEL[p.kind](p) : null;
  };
  R.interactable = (p) => !p.state && p.kind !== 'sign' && p.kind !== 'merchant';

  function drawProps(c, view, local, t) {
    for (const p of view.props) {
      c.save(); c.translate(p.x, p.y);
      c.lineWidth = 1.5; c.strokeStyle = '#0b0806';
      switch (p.kind) {
        case 'chest': {
          Sp.shadow(c, 14);
          if (!p.state) R.glow(c, 0, -8, 30 + Math.sin(t * 3) * 4, '#ffd36b', 0.4);
          c.fillStyle = '#7a4a22'; c.fillRect(-14, -14, 28, 14); c.strokeRect(-14, -14, 28, 14);
          c.fillStyle = '#c9a640'; c.fillRect(-14, -9, 28, 3);
          if (p.state) { c.fillStyle = '#5a3418'; c.fillRect(-14, -26, 28, 10); c.strokeRect(-14, -26, 28, 10); c.fillStyle = '#ffd36b'; c.globalAlpha = 0.5; c.fillRect(-12, -15, 24, 3); c.globalAlpha = 1; }
          else { c.fillStyle = '#8a5a2a'; c.beginPath(); c.moveTo(-14, -14); c.quadraticCurveTo(0, -26, 14, -14); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#e6c24a'; c.fillRect(-3, -15, 6, 7); }
          break;
        }
        case 'relic': case 'shop': {
          if (p.state) { c.globalAlpha = 0.35; }
          c.fillStyle = '#3a3330'; c.fillRect(-9, -6, 18, 8); c.strokeRect(-9, -6, 18, 8);
          c.fillStyle = '#4c4440'; c.fillRect(-11, -9, 22, 4); c.strokeRect(-11, -9, 22, 4);
          if (!p.state) {
            const bob = Math.sin(t * 3 + p.id) * 2;
            let col = '#ffffff', icon = null;
            if (p.kind === 'relic' || p.stype === 'relic') { const r = ED.RELICS[p.item]; col = ED.RARITY[r.rar].color; icon = ED.Icons.relicCanvas(p.item, 64); }
            else if (p.stype === 'boon') { col = ED.RARITY.e.color; icon = ED.Icons.canvas('star', col, 64); }
            else { col = '#ff4a5a'; icon = ED.Icons.canvas('potion', col, 64); }
            R.glow(c, 0, -22 + bob, 22, col, 0.6);
            c.drawImage(icon, -10, -32 + bob, 20, 20);
            if (p.kind === 'shop') {
              const can = view.gold >= p.price;
              c.font = '800 8px "Alegreya Sans", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
              c.lineWidth = 2.5; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(p.price + 'g', 0, 9);
              c.fillStyle = can ? '#ffd36b' : '#a07060'; c.fillText(p.price + 'g', 0, 9);
            }
          }
          break;
        }
        case 'merchant': {
          Sp.shadow(c, 11);
          R.glow(c, 10, -16, 34, '#ffcf6a', 0.4);
          c.fillStyle = '#4a3a5a'; c.beginPath(); c.moveTo(-9, 0); c.lineTo(-7, -18); c.quadraticCurveTo(0, -30, 7, -18); c.lineTo(9, 0); c.closePath(); c.fill(); c.stroke();
          c.fillStyle = '#1a1220'; c.beginPath(); c.ellipse(0, -18, 4.5, 4, 0, 0, U.TAU); c.fill();
          c.fillStyle = '#ffd36b'; c.fillRect(-2.5, -19, 1.6, 1.6); c.fillRect(1, -19, 1.6, 1.6);
          c.fillStyle = '#c9a640'; c.fillRect(8, -18, 5, 7); c.fillStyle = '#fff3c4'; c.fillRect(9, -17, 3, 5);
          c.fillStyle = '#6a4a22'; c.fillRect(-16, -8, 8, 8); c.strokeRect(-16, -8, 8, 8);
          break;
        }
        case 'fountain': {
          Sp.shadow(c, 18);
          c.fillStyle = '#5a6a72'; c.beginPath(); c.ellipse(0, -4, 18, 8, 0, 0, U.TAU); c.fill(); c.stroke();
          c.fillStyle = p.state ? '#2a3a40' : '#4fc8e8'; c.beginPath(); c.ellipse(0, -5, 14, 5.5, 0, 0, U.TAU); c.fill();
          c.fillStyle = '#6a7a82'; c.fillRect(-3, -22, 6, 17); c.strokeRect(-3, -22, 6, 17);
          if (!p.state) { R.glow(c, 0, -10, 34, '#6fe6ff', 0.4); c.fillStyle = 'rgba(180,240,255,0.8)'; for (let i = 0; i < 4; i++) { const k = (t * 1.5 + i / 4) % 1; c.fillRect(-1 + Math.sin(i * 2) * 6 * k, -22 + k * 16, 1.5, 3); } }
          break;
        }
        case 'altar': {
          Sp.shadow(c, 14);
          c.fillStyle = '#3a2a2a'; c.fillRect(-14, -12, 28, 12); c.strokeRect(-14, -12, 28, 12);
          c.fillStyle = '#5a3a3a'; c.fillRect(-16, -16, 32, 5); c.strokeRect(-16, -16, 32, 5);
          if (!p.state) { R.glow(c, 0, -20, 30, '#d43a5a', 0.55 + Math.sin(t * 4) * 0.15); c.fillStyle = '#d43a5a'; c.beginPath(); c.ellipse(0, -16, 9, 2.5, 0, 0, U.TAU); c.fill(); }
          break;
        }
        case 'gamble': {
          Sp.shadow(c, 12);
          c.fillStyle = '#4a4038'; c.fillRect(-10, -8, 20, 8); c.strokeRect(-10, -8, 20, 8);
          c.fillStyle = p.state ? '#6a5a40' : '#e6c24a'; c.beginPath(); c.arc(0, -18, 8, 0, U.TAU); c.fill(); c.stroke();
          c.fillRect(-5, -12, 10, 5);
          if (!p.state) R.glow(c, 0, -18, 28, '#ffd36b', 0.45);
          break;
        }
        case 'trial': {
          Sp.shadow(c, 12);
          c.fillStyle = '#4a4a52'; c.fillRect(-6, -30, 12, 30); c.strokeRect(-6, -30, 12, 30);
          c.strokeStyle = p.state ? '#555' : '#ff6a4a'; c.lineWidth = 2.5;
          c.beginPath(); c.moveTo(-12, -40); c.lineTo(12, -16); c.moveTo(12, -40); c.lineTo(-12, -16); c.stroke();
          if (!p.state) R.glow(c, 0, -28, 30, '#ff6a4a', 0.4);
          break;
        }
        case 'portal': {
          const r = 22 + Math.sin(t * 3) * 2;
          R.glow(c, 0, -10, 70, '#c98bff', 0.6);
          c.save(); c.translate(0, -10);
          for (let i = 0; i < 5; i++) { c.strokeStyle = U.rgba(i % 2 ? '#ffd8f4' : '#9a6aff', 0.8); c.lineWidth = 2.5; c.beginPath(); c.ellipse(0, 0, r - i * 4, (r - i * 4) * 1.25, 0, t * (2 + i * 0.5) + i, t * (2 + i * 0.5) + i + 4); c.stroke(); }
          c.fillStyle = 'rgba(20,6,40,0.85)'; c.beginPath(); c.ellipse(0, 0, 8, 10, 0, 0, U.TAU); c.fill();
          c.restore();
          break;
        }
        case 'sign': {
          Sp.shadow(c, 9, 0.3);
          c.fillStyle = '#5a4a3a'; c.fillRect(-1.5, -12, 3, 12);
          c.fillStyle = '#8a6a4a'; c.fillRect(-11, -22, 22, 12); c.strokeRect(-11, -22, 22, 12);
          c.fillStyle = '#3a2a1a'; c.fillRect(-7, -18, 14, 1.2); c.fillRect(-7, -15, 10, 1.2);
          break;
        }
        default: break;
      }
      c.restore();
    }
  }

  // ---------------- companions (orbit blades / wisps drawn around heroes) ----------------
  function drawCompanions(c, p, view, t, back) {
    if (!p.stats || p.downed || p.dead) return;
    const ht = view.time !== undefined ? view.time : t;
    const n = p.stats.orbit || 0;
    for (let i = 0; i < n; i++) {
      const a = ht * 3.2 + i * U.TAU / n;
      const ox = Math.cos(a) * 44, oy = Math.sin(a) * 44;
      if ((oy < 0) !== back) continue;
      c.save(); c.translate(ox, oy - 6); c.rotate(a * 3);
      R.glow(c, 0, 0, 14, '#cfe6ff', 0.5);
      c.fillStyle = '#e6eef6'; c.strokeStyle = '#0b0806'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, -8); c.quadraticCurveTo(6, -2, 0, 8); c.quadraticCurveTo(2, 0, 0, -8); c.fill(); c.stroke();
      c.restore();
    }
    const nw = p.stats.wisp || 0;
    for (let i = 0; i < nw; i++) {
      const a = ht * 1.6 + i * U.TAU / nw;
      const ox = Math.cos(a) * 26, oy = Math.sin(a) * 10 - 14;
      if ((Math.sin(a) < 0) !== back) continue;
      R.glow(c, ox, oy, 12, '#bff0ff', 0.8);
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ox, oy, 2.4, 0, U.TAU); c.fill();
    }
  }

  // ---------------- projectiles ----------------
  function drawProjectiles(c, view, t) {
    for (const pr of view.projs) {
      const a = Math.atan2(pr.vy, pr.vx), col = ED.FX.projColor(pr.kind);
      c.save(); c.translate(pr.x, pr.y - 6);
      switch (pr.kind) {
        case 'arrow': case 'bolt': case 'trident':
          c.rotate(a);
          c.strokeStyle = U.rgba(col, 0.35); c.lineWidth = 2; c.beginPath(); c.moveTo(-18, 0); c.lineTo(-6, 0); c.stroke();
          c.fillStyle = pr.kind === 'trident' ? '#e8c66b' : '#8a6a42'; c.fillRect(-9, -0.9, pr.kind === 'trident' ? 18 : 12, 1.8);
          c.fillStyle = '#eef2f6'; c.beginPath(); c.moveTo(pr.kind === 'trident' ? 13 : 7, -2.8); c.lineTo(pr.kind === 'trident' ? 19 : 11, 0); c.lineTo(pr.kind === 'trident' ? 13 : 7, 2.8); c.fill();
          if (pr.team === 1) R.glow(c, 0, 0, 16, '#ff5a3a', 0.5);
          break;
        case 'knife':
          c.rotate(a); c.fillStyle = '#d9dfe8'; c.beginPath(); c.moveTo(-4, -1.6); c.lineTo(7, 0); c.lineTo(-4, 1.6); c.fill(); c.fillStyle = '#2b2233'; c.fillRect(-7, -1, 3, 2);
          break;
        case 'bone':
          c.rotate(t * 14 + pr.id); R.glow(c, 0, 0, 12, '#ff5a3a', 0.35); c.fillStyle = '#efe8d4'; c.fillRect(-5, -1.3, 10, 2.6); c.beginPath(); c.arc(-5, 0, 2.2, 0, U.TAU); c.arc(5, 0, 2.2, 0, U.TAU); c.fill();
          break;
        case 'ice': case 'shard':
          c.rotate(a); R.glow(c, 0, 0, 14, col, 0.6); c.fillStyle = '#e8fbff'; c.beginPath(); c.moveTo(-6, -2.5); c.lineTo(7, 0); c.lineTo(-6, 2.5); c.closePath(); c.fill();
          break;
        case 'wave':
          c.rotate(a); c.globalCompositeOperation = 'lighter'; c.strokeStyle = U.rgba(col, 0.8); c.lineWidth = 3; c.beginPath(); c.arc(-pr.r * 0.4, 0, pr.r, -0.9, 0.9); c.stroke(); c.globalCompositeOperation = 'source-over';
          break;
        default: {
          const r = Math.max(2.5, pr.r);
          c.globalCompositeOperation = 'lighter';
          R.glow(c, 0, 0, r * 3.2, col, pr.team === 1 ? 0.75 : 0.6);
          c.globalCompositeOperation = 'source-over';
          if (pr.team === 1) { c.fillStyle = '#1a0606'; c.beginPath(); c.arc(0, 0, r + 1.4, 0, U.TAU); c.fill(); }
          c.fillStyle = col; c.beginPath(); c.arc(0, 0, r, 0, U.TAU); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(-r * 0.25, -r * 0.25, r * 0.45, 0, U.TAU); c.fill();
          // short trail
          c.rotate(a); c.strokeStyle = U.rgba(col, 0.35); c.lineWidth = r; c.beginPath(); c.moveTo(-r * 3, 0); c.lineTo(-r, 0); c.stroke();
        }
      }
      c.restore();
    }
  }

  // ---------------- glows & lighting ----------------
  function drawGlows(c, view, room, biome, t) {
    c.globalCompositeOperation = 'lighter';
    for (const d of ED.Tiles.dynamics(room)) {
      const fl = d.k === 'torch' ? 0.85 + Math.sin(t * 11 + d.x) * 0.1 : 0.7 + Math.sin(t * 2 + d.x) * 0.2;
      R.glow(c, d.x, d.y, d.r * (d.k === 'torch' ? 0.55 : 0.6), d.color, 0.28 * fl);
    }
    c.globalCompositeOperation = 'source-over';
  }

  function drawLighting(c, view, room, biome, local, t, ox, oy) {
    const P = biome.pal;
    let dark = P.darkness;
    if (R.quality === 'low') dark *= 0.85;
    if (dark <= 0.02) return;
    const div = R.lightDiv, s = R.scale / div;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, lightCv.width, lightCv.height);
    const dc = view.pact > 0 ? U.mix(P.darkColor, '#2a0004', Math.min(0.6, view.pact * 0.06)) : P.darkColor;
    lctx.fillStyle = U.rgba(dc, dark);
    lctx.fillRect(0, 0, lightCv.width, lightCv.height);
    lctx.globalCompositeOperation = 'destination-out';
    const L = (x, y, r, a) => {
      const sx = (x * R.scale + ox) / div, sy = (y * R.scale + oy) / div, rr = r * s;
      if (sx + rr < 0 || sy + rr < 0 || sx - rr > lightCv.width || sy - rr > lightCv.height) return;
      lctx.globalAlpha = a; lctx.drawImage(lightSprite, sx - rr, sy - rr, rr * 2, rr * 2);
    };
    for (const p of view.players.values()) {
      if (p.dead) continue;
      const r = (p.stats ? p.stats.lightR : 175) * (p.downed ? 0.6 : 1) * (0.97 + Math.sin(t * 7 + (p.slot || 0)) * 0.03);
      L(p.x, p.y - 10, r, 1);
    }
    for (const d of ED.Tiles.dynamics(room)) L(d.x, d.y, d.r * (d.k === 'torch' ? 1 : 0.8), d.k === 'torch' ? 0.85 + Math.sin(t * 11 + d.x) * 0.08 : 0.55);
    let n = 0;
    for (const pr of view.projs) { if (n++ > 40) break; L(pr.x, pr.y, pr.team === 1 ? 40 : 34, 0.6); }
    for (const z of view.zones) {
      if (z.kind === 'fire' || z.kind === 'pfire' || z.kind === 'sanct' || z.kind === 'laser') L(z.x, z.y, z.kind === 'laser' ? 90 : z.r * 1.8, 0.7);
      else if (z.kind === 'tele' || z.kind === 'spawn') L(z.x, z.y, (z.r || 16) * 1.3, 0.45);
    }
    for (const pr of view.props) if (!pr.state && pr.kind !== 'sign') L(pr.x, pr.y - 10, pr.kind === 'portal' ? 160 : 80, 0.8);
    for (const pk of view.pickups) L(pk.x, pk.y, 24, 0.5);
    for (const e of view.enemies) if (e.boss || e.elite) L(e.x, e.y - e.r, e.r * 4, 0.5);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    c.imageSmoothingEnabled = true;
    c.drawImage(lightCv, 0, 0, R.W, R.H);
  }

  // ---------------- overhead info (names, bars, prompts) ----------------
  function drawOverheads(c, view, local, t) {
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // enemy bars
    for (const e of view.enemies) {
      if (e.hp <= 0 || e.boss) continue;
      const frac = e.hp / e.maxHp;
      if (frac >= 0.999 && !e.elite) continue;
      const w = e.elite ? 30 : 18, y = e.y - e.r * 2.6 - (e.def.fly ? 14 : 4);
      c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(e.x - w / 2 - 1, y - 1, w + 2, 4);
      c.fillStyle = e.elite ? ED.AFFIXES[e.elite].color : '#e2513f'; c.fillRect(e.x - w / 2, y, w * frac, 2);
      if (e.ward > 0) { c.fillStyle = '#7fc8ff'; c.fillRect(e.x - w / 2, y - 3, w * (e.ward / (e.wardMax || 1)), 1.5); }
      if (e.elite) {
        c.font = '800 7px "Alegreya Sans", sans-serif';
        c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,0.85)';
        const label = ED.AFFIXES[e.elite].name + ' ' + e.def.name;
        c.strokeText(label, e.x, y - 6); c.fillStyle = ED.AFFIXES[e.elite].color; c.fillText(label, e.x, y - 6);
      }
    }
    // hero names & revive rings
    const multi = view.players.size > 1;
    for (const p of view.players.values()) {
      const col = ED.PLAYER_COLORS[p.slot] || '#fff';
      if (multi && !p.dead) {
        c.font = '800 7px "Alegreya Sans", sans-serif'; c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,0.85)';
        c.strokeText(p.name, p.x, p.y - 44); c.fillStyle = col; c.fillText(p.name, p.x, p.y - 44);
        if (p.pid !== local) { const fr = p.hp / p.maxHp; c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(p.x - 11, p.y - 39, 22, 3); c.fillStyle = fr > 0.35 ? '#86d38f' : '#e2513f'; c.fillRect(p.x - 10.5, p.y - 38.5, 21 * fr, 2); }
      }
      if (p.downed) {
        c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y - 8, 20, 0, U.TAU); c.stroke();
        c.strokeStyle = '#86d38f'; c.beginPath(); c.arc(p.x, p.y - 8, 20, -Math.PI / 2, -Math.PI / 2 + U.TAU * (p.revive || 0)); c.stroke();
        c.font = '800 7px "Alegreya Sans", sans-serif'; c.fillStyle = '#ff8a7a'; c.fillText(p.pid === local ? 'DOWN' : 'REVIVE', p.x, p.y - 34);
      }
    }
    // sign text when close (only the nearest sign, so neighbouring panels never overlap)
    const me = view.players.get(local);
    let sign = null, sd = 90 * 90;
    if (me) for (const p of view.props) { if (p.kind === 'sign') { const d = U.dist2(p.x, p.y, me.x, me.y); if (d < sd) { sd = d; sign = p; } } }
    if (sign) {
      c.font = '600 8px "Alegreya Sans", sans-serif';
      const lines = wrap(c, sign.text, 120);
      const h = lines.length * 10 + 8, w = 130, x = sign.x, y = sign.y - 34 - h;
      c.fillStyle = 'rgba(14,10,8,0.88)'; c.fillRect(x - w / 2, y, w, h);
      c.strokeStyle = '#5a4232'; c.lineWidth = 1; c.strokeRect(x - w / 2, y, w, h);
      c.fillStyle = '#f0e5d3'; lines.forEach((ln, i) => c.fillText(ln, x, y + 9 + i * 10));
    }
  }

  function wrap(c, text, maxW) {
    const words = String(text).split(' '); const lines = []; let cur = '';
    for (const w of words) { const test = cur ? cur + ' ' + w : w; if (c.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur);
    return lines;
  }
  R.wrap = wrap;
})(globalThis.ED || (globalThis.ED = {}));
