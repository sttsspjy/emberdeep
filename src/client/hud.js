// Screen-space HUD drawn on the canvas: vitals, cooldowns, party, minimap, boss bar, banners and prompts.
(function (ED) {
  'use strict';
  const U = ED.U;
  const H = ED.HUD = {};
  const FD = '"Cinzel", Georgia, serif', FB = '"Alegreya Sans", system-ui, sans-serif';

  const panel = (c, x, y, w, h, r, fill, stroke) => {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  };
  const bar = (c, x, y, w, h, frac, col, bg, ghost) => {
    c.fillStyle = bg || 'rgba(0,0,0,0.6)'; c.fillRect(x, y, w, h);
    if (ghost !== undefined && ghost > frac) { c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x, y, w * U.clamp(ghost, 0, 1), h); }
    c.fillStyle = col; c.fillRect(x, y, w * U.clamp(frac, 0, 1), h);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x, y, w * U.clamp(frac, 0, 1), Math.max(1, h * 0.3));
  };
  const txt = (c, s, x, y, size, color, font, align, weight) => {
    c.font = `${weight || 700} ${size}px ${font || FB}`; c.textAlign = align || 'left'; c.textBaseline = 'middle';
    c.lineWidth = Math.max(2, size / 5); c.strokeStyle = 'rgba(0,0,0,0.75)'; c.strokeText(s, x, y);
    c.fillStyle = color; c.fillText(s, x, y);
  };
  H.txt = txt;
  const ghost = {};
  const TIER = [['Bright', '#ffd36b'], ['Dim', '#e6a050'], ['Dark', '#c0603a'], ['Lightless', '#8a2a2a']];
  const TIER_HINT = ['The lantern burns bright.', 'The Deep grows bolder.', 'Darkness gathers. Foes grow fierce.', 'Lightless! A Gloom stalks the rooms.'];
  const lantern = { view: null, tier: 0, hint: '', t: 99 };
  // Weapon name with its evolution prefix ('Cinder Longsword'); falls back to the class name before stats exist.
  H.weaponName = (p) => {
    const st = p.stats, w = st && st.weapon, ep = st && st.evo && ED.PATHS[st.evo];
    return w ? (ep ? ep.evo + ' ' : '') + w.name : ED.CLASSES[p.cls].name;
  };

  H.draw = (c, view, me, ctl, t, dt, extra) => {
    const R = ED.Render, W = R.W, Hh = R.H;
    const k = R.dpr * U.clamp(Math.min(W / R.dpr / 1280, Hh / R.dpr / 760), 0.72, 1.3);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // screen flashes
    if (ED.FX.flash) { c.fillStyle = U.rgba(ED.FX.flash.color, ED.FX.flash.a * (ED.FX.flash.t / 0.3)); c.fillRect(0, 0, W, Hh); }
    if (me && me.downed) {
      const g = c.createRadialGradient(W / 2, Hh / 2, Hh * 0.2, W / 2, Hh / 2, Hh * 0.8);
      g.addColorStop(0, 'rgba(60,0,0,0)'); g.addColorStop(1, 'rgba(90,0,0,0.6)'); c.fillStyle = g; c.fillRect(0, 0, W, Hh);
    }
    if (!me) return;
    const pad = 16 * k;
    // ---------- player panel ----------
    const cls = ED.CLASSES[me.cls];
    const pw = 300 * k, ph = 70 * k;
    panel(c, pad, pad, pw, ph, 10 * k, 'rgba(14,10,8,0.72)', 'rgba(90,66,50,0.8)');
    const px = pad + 34 * k, py = pad + ph / 2;
    c.fillStyle = ED.PLAYER_COLORS[me.slot]; c.beginPath(); c.arc(px, py, 24 * k, 0, U.TAU); c.fill();
    c.fillStyle = '#120c09'; c.beginPath(); c.arc(px, py, 21.5 * k, 0, U.TAU); c.fill();
    const icon = ED.Icons.canvas(cls.icon, cls.col.c, 64);
    c.drawImage(icon, px - 20 * k, py - 20 * k, 40 * k, 40 * k);
    const bx = pad + 66 * k, bw = pw - 78 * k;
    txt(c, me.name, bx, pad + 15 * k, 15 * k, '#e6c27a', FD, 'left', 700);
    const evoP = me.stats && me.stats.evo && ED.PATHS[me.stats.evo];
    txt(c, evoP ? H.weaponName(me) : cls.name, bx + bw, pad + 15 * k, 11 * k, evoP ? evoP.color : '#a99886', FB, 'right', 700);
    const frac = me.hp / me.maxHp;
    const gk = 'p' + me.pid; ghost[gk] = ghost[gk] === undefined ? frac : Math.max(frac, ghost[gk] - dt * 0.35);
    bar(c, bx, pad + 28 * k, bw, 16 * k, frac, frac > 0.35 ? '#d9443a' : '#ff2a1a', 'rgba(0,0,0,0.7)', ghost[gk]);
    const shield = me.shield || 0;
    if (shield > 0) { // blood shield: a pale segment after the health (clipped to the bar end), absorbs damage first
      const sf = U.clamp(shield / me.maxHp, 0.03, 1), s0 = Math.min(U.clamp(frac, 0, 1), 1 - sf);
      c.fillStyle = 'rgba(214,232,255,0.92)'; c.fillRect(bx + bw * s0, pad + 28 * k, bw * sf, 16 * k);
      c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(bx + bw * s0, pad + 28 * k, bw * sf, 5 * k);
    }
    txt(c, `${Math.ceil(me.hp)} / ${me.maxHp}` + (shield > 0 ? ` +${Math.ceil(shield)}` : ''), bx + bw / 2, pad + 36.5 * k, 11 * k, '#ffffff', FB, 'center', 800);
    // status chips
    let sx = bx;
    const chip = (label, col) => { c.font = `800 ${10 * k}px ${FB}`; const w = c.measureText(label).width + 10 * k; panel(c, sx, pad + 50 * k, w, 14 * k, 7 * k, U.rgba(col, 0.2), U.rgba(col, 0.8)); txt(c, label, sx + w / 2, pad + 57.5 * k, 10 * k, col, FB, 'center', 800); sx += w + 4 * k; };
    if (me.stats.aegis && (me.aegisT || 0) <= 0) chip('Aegis', '#7fc8ff');
    if ((me.guardT || 0) > 0) chip('Last Stand', '#ffd36b');
    if ((me.critStacks || 0) > 0) chip('Crit ×' + me.critStacks, '#b78cff');
    if ((me.secondWind || 0) > 0) chip('Second Wind', '#86d38f');
    if (me.stats.phoenix && !me.phoenixUsed) chip('Phoenix', '#ffb02e');
    if ((ctl.picks || 0) > 0 && !(ctl.offerOpen)) chip(ctl.picks + ' boon' + (ctl.picks > 1 ? 's' : '') + ' ready', '#ffd36b');

    // ---------- abilities ----------
    const ay = pad + ph + 12 * k, as = 46 * k;
    const ability = (x, label, key, cdFrac, ready, iconName, color, count) => {
      panel(c, x, ay, as, as, 8 * k, 'rgba(14,10,8,0.75)', ready ? U.rgba(color, 0.9) : 'rgba(90,66,50,0.8)');
      c.save(); c.globalAlpha = ready ? 1 : 0.45;
      c.drawImage(ED.Icons.canvas(iconName, color, 64), x + 5 * k, ay + 5 * k, as - 10 * k, as - 10 * k);
      c.restore();
      if (cdFrac > 0) { c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.moveTo(x + as / 2, ay + as / 2); c.arc(x + as / 2, ay + as / 2, as * 0.42, -Math.PI / 2, -Math.PI / 2 + U.TAU * cdFrac); c.closePath(); c.fill(); }
      panel(c, x + as - 16 * k, ay + as - 13 * k, 18 * k, 15 * k, 4 * k, '#1a1310', '#5a4232');
      txt(c, key, x + as - 7 * k, ay + as - 5.5 * k, 9 * k, '#e6c27a', FB, 'center', 800);
      if (count > 1) txt(c, '×' + count, x + 8 * k, ay + 9 * k, 10 * k, '#ffffff', FB, 'left', 800);
    };
    const sk = ED.SKILLS[cls.skill];
    const scd = ctl.skillCd > 0 ? ctl.skillCd / me.stats.skillCd : 0;
    ability(pad, sk.name, 'K', ctl.charges > 0 ? 0 : scd, ctl.charges > 0, sk.icon, cls.col.c, ctl.charges);
    const s2 = cls.skill2 && ED.SKILLS[cls.skill2];
    let slot = 1;
    if (s2) {
      const cd2 = ctl.skill2Cd > 0 ? ctl.skill2Cd / Math.max(0.1, me.stats.skill2Cd || s2.cd) : 0, up = me.bulwarkT > 0;
      ability(pad + slot++ * (as + 8 * k), s2.name, 'L', cd2, cd2 <= 0 && !up, s2.icon, up ? '#ffe9a0' : cls.col.c, 0);
    }
    const dcd = ctl.dashCd > 0 ? ctl.dashCd / me.stats.dashCd : 0;
    ability(pad + slot++ * (as + 8 * k), 'Dash', 'Spc', dcd, dcd <= 0, 'wing', '#bfe9ff', 0);
    // path pips: each owned gate with its affinity; a star on the evolved path
    const gates = me.boons ? ED.gatePaths(me.boons) : [];
    gates.forEach((pa, i) => {
      const P = ED.PATHS[pa], gx = pad + slot * (as + 8 * k) + 4 * k + i * 38 * k, gy = ay + as / 2, evolved = me.stats.evo === pa;
      c.drawImage(ED.Icons.canvas(P.icon, P.color, 64), gx, gy - 12 * k, 24 * k, 24 * k);
      txt(c, String(ED.pathAffinity(me.boons, pa)), gx + 26 * k, gy + 2 * k, 13 * k, P.color, FB, 'left', 800);
      if (evolved) { c.drawImage(ED.Icons.canvas('star', '#ffd36b', 64), gx + 13 * k, gy - 17 * k, 13 * k, 13 * k); }
    });

    // ---------- party ----------
    let ty = ay + as + 14 * k;
    for (const p of view.players.values()) {
      if (p.pid === me.pid) continue;
      panel(c, pad, ty, 200 * k, 26 * k, 6 * k, 'rgba(14,10,8,0.65)', null);
      c.fillStyle = ED.PLAYER_COLORS[p.slot]; c.fillRect(pad, ty, 4 * k, 26 * k);
      txt(c, p.name, pad + 10 * k, ty + 9 * k, 11 * k, ED.PLAYER_COLORS[p.slot], FB, 'left', 800);
      txt(c, p.dead ? 'Fallen' : p.downed ? 'DOWN' : ED.CLASSES[p.cls].name, pad + 192 * k, ty + 9 * k, 9 * k, p.downed || p.dead ? '#ff8a7a' : '#a99886', FB, 'right', 700);
      bar(c, pad + 10 * k, ty + 17 * k, 182 * k, 5 * k, p.dead ? 0 : p.hp / p.maxHp, p.downed ? '#ff8a7a' : '#86d38f');
      ty += 30 * k;
    }

    // ---------- minimap & stratum ----------
    const mw = 184 * k, mh = 116 * k, mx = W - pad - mw, my = pad;
    panel(c, mx, my, mw, 214 * k, 10 * k, 'rgba(14,10,8,0.72)', 'rgba(90,66,50,0.8)');
    const biome = ED.biomeFor(view.stratum);
    txt(c, biome.name, mx + mw / 2, my + 13 * k, 12 * k, biome.pal.ui, FD, 'center', 700);
    // stratum affinity: foes are weak to one element and resist another
    const wkE = ED.PATHS[biome.weak], rsE = ED.PATHS[biome.resist];
    if (wkE && rsE) {
      const segs = [['Weak: ', '#a99886'], [wkE.name, wkE.color], [' · Resists: ', '#a99886'], [rsE.name, rsE.color]];
      c.font = `700 ${10 * k}px ${FB}`;
      let ax = mx + mw / 2 - segs.reduce((n, s) => n + c.measureText(s[0]).width, 0) / 2;
      for (const s of segs) { txt(c, s[0], ax, my + 27 * k, 10 * k, s[1], FB, 'left', 700); ax += c.measureText(s[0]).width; }
    }
    H.drawMap(c, view, mx + 6 * k, my + 36 * k, mw - 12 * k, mh - 4 * k, k, t);
    txt(c, 'Stratum ' + U.roman(view.stratum), mx + 10 * k, my + 158 * k, 11 * k, '#a99886', FB, 'left', 700);
    if (view.pact > 0) txt(c, 'Pact ' + view.pact, mx + mw - 10 * k, my + 158 * k, 11 * k, '#ff6b4a', FD, 'right', 700);
    // the lantern: light left on this floor; its tier sets how hard the Deep bites
    if (view.lightMax > 0) {
      const tier = U.clamp((view.dread && view.dread.tier) | 0, 0, 3), lf = U.clamp(view.light / view.lightMax, 0, 1), pl = tier === 3 ? 0.5 + 0.5 * Math.sin(t * 5) : 1;
      if (lantern.view !== view) { lantern.view = view; lantern.tier = tier; lantern.hint = ''; lantern.t = 99; }
      else if (tier !== lantern.tier) { lantern.hint = tier > lantern.tier ? TIER_HINT[tier] : (tier === 0 ? TIER_HINT[0] : 'The light pushes the dark back.'); lantern.t = 0; lantern.tier = tier; }
      lantern.t += dt;
      const tc = tier === 3 ? U.mix('#8a2a2a', '#ff5a40', pl) : TIER[tier][1], ly = my + 175 * k;
      c.drawImage(ED.Icons.canvas('lantern', tc, 64), mx + 8 * k, ly - 9 * k, 18 * k, 18 * k);
      txt(c, TIER[tier][0], mx + 30 * k, ly, 12 * k, tc, FD, 'left', 700);
      txt(c, Math.round(lf * 100) + '%', mx + mw - 10 * k, ly, 11 * k, tc, FB, 'right', 800);
      const lx = mx + 10 * k, lw = mw - 20 * k, lby = ly + 11 * k;
      c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(lx - 1, lby - 1, lw + 2, 9 * k);
      c.fillStyle = tc; c.fillRect(lx, lby, lw * lf, 7 * k);
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(lx, lby, lw * lf, 2 * k);
      c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(lx + lw * 0.5 - 0.5, lby - 1, 1, 9 * k); c.fillRect(lx + lw * 0.25 - 0.5, lby - 1, 1, 9 * k);
      if (tier === 3) { c.strokeStyle = U.rgba('#ff4a3a', 0.35 + 0.5 * pl); c.lineWidth = 1.5; c.strokeRect(lx - 1.5, lby - 1.5, lw + 3, 9 * k + 1); }
      const hint = lantern.t < 6 && lantern.hint, D = ED.World.DREAD && ED.World.DREAD[tier], parts = [];
      if (D) { if (D.hp > 1) parts.push(`Foes +${Math.round((D.hp - 1) * 100)}%`); if (D.elite > 0) parts.push(`Elites +${Math.round(D.elite * 100)}%`); if (D.gold > 1) parts.push(`Gold ×${D.gold}`); }
      c.globalAlpha = hint ? U.clamp(6 - lantern.t, 0, 1) : 1;
      txt(c, hint || (parts.length ? parts.join(' · ') : 'Foes at normal strength'), mx + mw / 2, ly + 28 * k, 9.5 * k, hint ? tc : '#a99886', FB, 'center', 700);
      c.globalAlpha = 1;
    }

    // ---------- xp & gold (bottom centre) ----------
    const xw = Math.min(520 * k, W * 0.45), xh = 10 * k, xx = (W - xw) / 2, xy = Hh - pad - xh - 4 * k;
    panel(c, xx - 58 * k, xy - 10 * k, xw + 140 * k, xh + 20 * k, 10 * k, 'rgba(14,10,8,0.72)', 'rgba(90,66,50,0.8)');
    txt(c, 'Lv ' + view.level, xx - 50 * k, xy + xh / 2, 14 * k, '#e6c27a', FD, 'left', 900);
    bar(c, xx, xy, xw, xh, view.xp / view.xpNext, '#5fd6b8', 'rgba(0,0,0,0.7)');
    c.drawImage(ED.Icons.canvas('coin', '#ffd36b', 64), xx + xw + 8 * k, xy - 6 * k, 22 * k, 22 * k);
    txt(c, String(view.gold), xx + xw + 34 * k, xy + xh / 2, 14 * k, '#ffd36b', FB, 'left', 800);

    // ---------- relics (bottom left) ----------
    const rs = 28 * k;
    me.relics.forEach((id, i) => {
      const col = i % 12, row = Math.floor(i / 12);
      c.drawImage(ED.Icons.relicCanvas(id, 64), pad + col * (rs + 3 * k), Hh - pad - rs - row * (rs + 3 * k), rs, rs);
    });

    // ---------- boss bar ----------
    const boss = view.enemies.find(e => e.boss && e.hp > 0);
    if (boss) {
      const bw2 = Math.min(640 * k, W * 0.5), bx2 = (W - bw2) / 2, by2 = pad + 22 * k;
      txt(c, boss.def.name, W / 2, pad + 8 * k, 16 * k, '#f0e5d3', FD, 'center', 900);
      const fr = boss.hp / boss.maxHp;
      ghost.boss = ghost.boss === undefined || ghost.bossId !== boss.id ? fr : Math.max(fr, ghost.boss - dt * 0.2); ghost.bossId = boss.id;
      panel(c, bx2 - 3 * k, by2 - 3 * k, bw2 + 6 * k, 18 * k, 4 * k, 'rgba(0,0,0,0.75)', '#5a4232');
      bar(c, bx2, by2, bw2, 12 * k, fr, boss.exposed ? '#ff9a3a' : '#c0392b', 'rgba(30,10,10,0.9)', ghost.boss);
      const marks = boss.type === 'hollowking' ? [0.6, 0.3] : [0.66, 0.33];
      for (const m of marks) { c.fillStyle = '#e6c27a'; c.fillRect(bx2 + bw2 * m - 1, by2 - 2 * k, 2, 16 * k); }
    }

    // ---------- prompts ----------
    if (extra.prompt) {
      const pr = extra.prompt, s = ED.Render.toScreen(pr.x, pr.y - 46);
      c.font = `800 ${13 * k}px ${FB}`;
      const w = c.measureText(pr.text).width + 40 * k;
      panel(c, s.x - w / 2, s.y - 14 * k, w, 26 * k, 13 * k, 'rgba(14,10,8,0.88)', '#e6c27a');
      panel(c, s.x - w / 2 + 6 * k, s.y - 9 * k, 18 * k, 16 * k, 4 * k, '#e6c27a', null);
      txt(c, 'J', s.x - w / 2 + 15 * k, s.y - 1 * k, 10 * k, '#1a1008', FB, 'center', 900);
      txt(c, pr.text, s.x - w / 2 + 30 * k, s.y - 1 * k, 13 * k, pr.can === false ? '#a07060' : '#f0e5d3', FB, 'left', 800);
      if (pr.desc) {
        c.font = `600 ${12 * k}px ${FB}`;
        const lines = ED.Render.wrap(c, pr.desc, 260 * k);
        const dh = lines.length * 16 * k + 12 * k, dw = 280 * k;
        panel(c, s.x - dw / 2, s.y - 22 * k - dh, dw, dh, 8 * k, 'rgba(14,10,8,0.9)', pr.color || '#5a4232');
        lines.forEach((ln, i) => txt(c, ln, s.x, s.y - 22 * k - dh + 14 * k + i * 16 * k, 12 * k, '#e8dcc8', FB, 'center', 600));
      }
    }
    if (view.waitMsg) txt(c, view.waitMsg, W / 2, Hh - pad - 52 * k, 14 * k, '#ffd36b', FB, 'center', 800);
    if (me.downed) {
      txt(c, 'You are down', W / 2, Hh * 0.32, 30 * k, '#ff8a7a', FD, 'center', 900);
      txt(c, view.players.size > 1 ? 'Stay calm — an ally can revive you by standing close.' : '', W / 2, Hh * 0.32 + 30 * k, 14 * k, '#f0e5d3', FB, 'center', 700);
    } else if (me.dead) {
      txt(c, 'Fallen', W / 2, Hh * 0.32, 30 * k, '#cfc6b6', FD, 'center', 900);
      txt(c, 'You will rise again when your party reaches the next stratum.', W / 2, Hh * 0.32 + 30 * k, 14 * k, '#f0e5d3', FB, 'center', 700);
    }

    // ---------- messages ----------
    ED.FX.msgs.forEach((m, i) => { c.globalAlpha = Math.min(1, m.t); txt(c, m.text, pad, Hh * 0.55 + i * 20 * k, 13 * k, m.color, FB, 'left', 700); });
    c.globalAlpha = 1;

    // ---------- banners ----------
    const b = ED.FX.banner;
    if (b && !extra.offerOpen) {
      const a = Math.min(1, b.t * 3, (b.dur - b.t) * 2);
      c.globalAlpha = Math.max(0, a);
      const cy = b.style === 'small' || b.style === 'level' ? Hh * 0.24 : Hh * 0.3;
      if (b.style === 'stratum' || b.style === 'boss' || b.style === 'victory') {
        const g = c.createLinearGradient(0, cy - 60 * k, 0, cy + 60 * k); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, cy - 60 * k, W, 120 * k);
        const col = b.style === 'boss' ? '#ff6a4a' : b.style === 'victory' ? '#ffd36b' : biome.pal.ui;
        txt(c, b.sub.toUpperCase(), W / 2, cy - 26 * k, 13 * k, col, FB, 'center', 800);
        txt(c, b.title, W / 2, cy + 6 * k, (b.style === 'boss' ? 46 : 42) * k, '#f6ecd8', FD, 'center', 900);
        c.fillStyle = col; c.fillRect(W / 2 - 120 * k * Math.min(1, b.t * 2), cy + 34 * k, 240 * k * Math.min(1, b.t * 2), 2 * k);
        if (b.style === 'boss' && ED.FX.bossQuote) txt(c, '"' + ED.FX.bossQuote.text + '"', W / 2, cy + 54 * k, 14 * k, '#d8cbb8', FB, 'center', 600);
      } else {
        txt(c, b.title, W / 2, cy, (b.style === 'level' ? 30 : 22) * k, b.style === 'level' ? '#ffd36b' : '#f0e5d3', FD, 'center', 900);
        if (b.sub) txt(c, b.sub, W / 2, cy + 24 * k, 12 * k, '#d8cbb8', FB, 'center', 700);
      }
      c.globalAlpha = 1;
    }
    if (ED.FX.fade > 0) { c.fillStyle = `rgba(0,0,0,${Math.min(1, ED.FX.fade)})`; c.fillRect(0, 0, W, Hh); }
  };

  // Minimap / full map of the current floor.
  H.drawMap = (c, view, x, y, w, h, k, t) => {
    const fl = view.floor; if (!fl) return;
    const rs = view.roomState || {};
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const r of fl.rooms) { minX = Math.min(minX, r.gx); maxX = Math.max(maxX, r.gx); minY = Math.min(minY, r.gy); maxY = Math.max(maxY, r.gy); }
    const cols = maxX - minX + 1, rows = maxY - minY + 1;
    const cell = Math.min(w / cols, h / rows, 26 * k);
    const ox = x + (w - cols * cell) / 2, oy = y + (h - rows * cell) / 2;
    const cx = (r) => ox + (r.gx - minX + 0.5) * cell, cy = (r) => oy + (r.gy - minY + 0.5) * cell;
    c.lineWidth = Math.max(1, 2 * k * (cell / (20 * k)));
    for (const r of fl.rooms) {
      const st = rs[r.id]; if (!st || !st.known) continue;
      for (const d of ['e', 's']) { const n = r.doors[d]; if (n >= 0 && rs[n] && rs[n].known) { c.strokeStyle = 'rgba(200,180,150,0.45)'; c.beginPath(); c.moveTo(cx(r), cy(r)); c.lineTo(cx(fl.rooms[n]), cy(fl.rooms[n])); c.stroke(); } }
    }
    const ICON = { boss: ['skull', '#ff5a3a'], shop: ['coin', '#ffd36b'], treasure: ['chest', '#ffd36b'], event: ['star', '#7dffd9'], elite: ['skull', '#ff7a3a'], rest: ['campfire', '#ff9a3a'] };
    const meP = ED.Game.s && ED.Game.s.me, cls = meP ? meP.cls : null;
    for (const r of fl.rooms) {
      const st = rs[r.id]; if (!st || !st.known) continue;
      const s = cell * 0.78, rx = cx(r) - s / 2, ry = cy(r) - s / 2;
      const cur = r.id === view.roomId;
      c.fillStyle = cur ? '#e6c27a' : st.visited ? (st.cleared ? '#5a4a3c' : '#8a3a2a') : 'rgba(60,48,40,0.6)';
      c.fillRect(rx, ry, s, s);
      c.strokeStyle = cur ? '#fff3c4' : 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.strokeRect(rx + 0.5, ry + 0.5, s - 1, s - 1);
      const ic = ICON[r.type], open = !st.cleared; // utility rooms keep their glyph; a cleared elite room loses it
      if (ic && (open || r.type !== 'elite')) c.drawImage(ED.Icons.canvas(ic[0], ic[1], 64), rx + s * 0.12, ry + s * 0.12, s * 0.76, s * 0.76);
      if (open && r.reward && (r.type === 'combat' || r.type === 'elite')) { // reward preview: whole icon in plain combat rooms, a corner badge in elite rooms
        const ri = ED.Render.rewardIcon(r.reward, cls), big = r.type === 'combat', z = big ? s * 0.76 : s * 0.5;
        c.drawImage(ED.Icons.canvas(ri[0], ri[1], 64), big ? rx + s * 0.12 : rx + s - z * 0.9, big ? ry + s * 0.12 : ry + s - z * 0.9, z, z);
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
