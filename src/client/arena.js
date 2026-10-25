// Boss and champion arena drawing (room.arena, src/sim/arena.js): Drowned King dais, water, tide warning and whirlpool; Hollow King darkness, lanterns and falling rings;
// Tidal Beam sweep preview, champion labels, revive countdown, bind ground; arena event effects and sounds. render.js calls ground (lit pass), over (after lighting) and the light hooks.
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
      if (z.kind !== 'laser' || !z.arc || z.t >= (z.warm || 0)) continue;
      const r = 70, n = Math.ceil(Math.abs(z.arc) * r / 6), a1 = z.a + z.arc;
      c.fillStyle = U.rgba(WARN, 0.7); c.beginPath();
      for (let i = 0; i <= n; i++) if ((i + ((t * 12) | 0)) % 3 < 2) { const a = z.a + z.arc * i / n; c.rect(s2(z.x + Math.cos(a) * r), s2(z.y + Math.sin(a) * r), 2, 2); }
      if (Math.abs(z.arc) < TAU - 0.1) for (let u = r; u < Math.min(z.len, 360); u += 10) c.rect(s2(z.x + Math.cos(a1) * u), s2(z.y + Math.sin(a1) * u), 2, 2);
      c.fill();
      const ah = a1 + Math.sign(z.arc) * 0.12; // arrow head at the sweep's end
      c.fillStyle = U.rgba(WARN, 0.95); c.beginPath(); c.rect(s2(z.x + Math.cos(ah) * r - 2), s2(z.y + Math.sin(ah) * r - 2), 4, 4); c.fill();
    }
  }
  // Champion labels (name, the copied class on a mimic) and the revive countdown of a fallen twin (a long spawn zone).
  function champs(c, view, room, t) {
    const ar = room.arena, cls = {};
    if (ar && ar.k === 'champ' && ar.m) for (const [id, ci] of ar.m) cls[id] = ED.CLASS_IDS[ci];
    for (const e of view.enemies) {
      if (e.hp <= 0 || !e.def || !e.def.champ) continue;
      const k = cls[e.id], str = k ? e.def.name + ' (' + ED.CLASSES[k].name + ')' : e.def.name;
      R.label(c, str, Math.round(e.x), Math.round(e.y - e.r * 2.6 - 18), k ? ED.CLASSES[k].color || '#ffd36b' : '#ffd36b');
    }
    for (const z of view.zones) {
      if (z.kind !== 'spawn' || !(z.dur > 3)) continue;
      const left = Math.max(0, z.dur - z.t), k = 1 - left / z.dur;
      c.fillStyle = U.rgba('#ffb13a', 0.85); c.beginPath();
      for (let i = 0; i < 40; i++) if (i / 40 < k) { const a = -Math.PI / 2 + i / 40 * TAU; c.rect(s2(z.x + Math.cos(a) * 30), s2(z.y + Math.sin(a) * 30), 2, 2); }
      c.fill();
      R.label(c, 'Rises in ' + Math.ceil(left), Math.round(z.x), Math.round(z.y - 40), '#ffb13a');
    }
  }
  AF.over = (c, view, room, t) => {
    const ar = room.arena;
    if (ar && ar.k === 'tide') tideOver(c, room, ar, t);
    else if (ar && ar.k === 'crown') crownOver(c, room, ar, t);
    sweeps(c, view, t);
    champs(c, view, room, t);
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
  on('tide', (ev) => { if (ev.st === 1) { A().play('bell', 0.8); banner('The tide is coming'); } else { A().play('whirl', 0.7); F.addShake(2); } });
  on('sink', (ev) => { F.ring(ev.x, ev.y, 60, FRONT, 0.6, 3); A().play('thud', 0.8); F.addShake(3); });
  on('pool', (ev) => { F.ring(ev.x, ev.y, 120, FRONT, 0.9, 3, true); A().play('implode', 0.8); banner('The whirlpool pulls'); });
  on('lantern', (ev) => { F.ring(ev.x, ev.y - 20, 40, LAN, 0.45, 3); F.pop(ev.x, ev.y - 20, 24, LAN, 0.2, true); A().play('bell', 0.6); });
  on('lightsout', (ev) => { A().play('dark', 1); F.addShake(5); banner('Light the lanterns'); });
  on('dawn', (ev) => { A().play('evolve', 0.7); F.flash = { color: '#fff0d0', t: 0.3, a: 0.25 }; banner('The floor is breaking'); });
  on('crumble', (ev) => { if (ev.st === 0) { A().play('rupt', 0.8); F.addShake(2); } else { A().play('smash', 1); A().play('boom', 0.7); F.addShake(8); } });
  on('fall', (ev, ctx, local) => { F.burst(ev.x0, ev.y0, 10, { color: '#2a2238', sp: 80, life: 0.5, size: 2 }); if (ev.pid === local) { F.flash = { color: '#000000', t: 0.35, a: 0.5 }; banner('You fell'); } });
  on('champ', (ev) => { A().play('roar', 0.8); F.showBanner(ev.k === 'mimic' ? 'Mimic' : 'The Twins', ev.k === 'mimic' ? 'It copies your skills' : 'Kill both within 10 s', 'boss', 2.6); });
  on('twinfall', (ev) => { F.ring(ev.x, ev.y, 34, '#ffb13a', 0.6, 3); A().play('down', 0.8); });
  on('twinrise', (ev) => { F.ring(ev.x, ev.y, 50, '#ffb13a', 0.6, 3, true); A().play('revive', 0.9); F.addShake(3); });
  on('mimic', (ev) => { F.ring(ev.x, ev.y - 12, 24, '#e8e0ff', 0.35, 2); A().play('veil', 0.5); });
  on('msplit', (ev) => { F.ring(ev.x, ev.y, 40, '#e8e0ff', 0.5, 3); A().play('shatter', 0.8); F.addShake(3); });
  const TELL = { beam: 'charge', stalk: 'ambush', combo: 'clang', crown: 'throw', blink: 'veil', orbs: 'magic', nova: 'magic', laser: 'charge', starfall: 'raincast', reel: 'howl', bind: 'clang', meteor: 'fire' };
  on('tell', (ev) => { const s = TELL[ev.k]; if (s) A().play(s, ev.k === 'stalk' ? 1 : 0.6); if (ev.k === 'stalk') F.ring(ev.x, ev.y, 36, '#ffffff', 0.5, 3, true); });
})(globalThis.ED || (globalThis.ED = {}));
