// In-run HUD on the screen canvas (device px; sizes in CSS px x dpr): XP bar + level, timer, kills / gold, HP, weapon and passive slots with levels, Q / E / dash cooldowns,
// boss bar, banners. Font 'Pixel Operator' (numbers >= 16 px CSS).
(function (ED) {
  'use strict';
  const U = ED.U;
  const H = ED.HUD = { banner: null };
  const FONT = '"Pixel Operator", monospace';
  let c = null, d = 1;
  const font = (px) => { c.font = Math.round(px * d) + 'px ' + FONT; };
  const txt = (s, x, y, col, px, align, base) => {
    font(px); c.textAlign = align || 'left'; c.textBaseline = base || 'top';
    c.lineWidth = Math.max(2, Math.round(3 * d)); c.strokeStyle = 'rgba(10,7,6,0.9)'; c.lineJoin = 'round'; c.strokeText(s, x, y);
    c.fillStyle = col; c.fillText(s, x, y);
  };
  const bar = (x, y, w, h, k, col, back) => { c.fillStyle = back || 'rgba(10,7,6,0.75)'; c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x, y, Math.round(w * U.clamp(k, 0, 1)), h); c.strokeStyle = 'rgba(0,0,0,0.9)'; c.lineWidth = Math.max(1, d); c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); };
  // Atlas icon `id` fitted into a size x size box at (x, y).
  const icon = (id, x, y, size) => {
    const A = ED.Atlas, r = A.anim(id); if (!r) return;
    const f = r.f[0], s = Math.max(1, Math.floor(size / Math.max(f.w, f.h)));
    c.save(); c.translate(Math.round(x + size / 2 - (f.ox + f.w / 2 - r.ax) * s), Math.round(y + size / 2 - (f.oy + f.h / 2 - r.ay) * s)); c.scale(s, s);
    A.draw(c, id, 0, 0, 0); c.restore();
  };
  H.icon = (ctx, id, x, y, size) => { const oc = c; c = ctx; icon(id, x, y, size); c = oc; };
  H.show = (text, col, secs) => { H.banner = { text, col: col || '#ffd27a', t: secs || 2.5, max: secs || 2.5 }; };

  H.draw = (ctx, view, dt) => {
    c = ctx; d = ED.Render.dpr;
    const W = ctx.canvas.width, me = view.me;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // XP bar + level
    const xh = Math.round(12 * d);
    bar(0, 0, W, xh, view.xpNext ? view.xp / view.xpNext : 0, '#6ad7ff', 'rgba(10,7,6,0.8)');
    txt('LV ' + view.level, W - Math.round(10 * d), xh + Math.round(4 * d), '#bfefff', 20, 'right');
    // timer, kills, gold
    txt(U.fmtTime(view.time), W / 2, xh + Math.round(4 * d), '#fff1d6', 32, 'center');
    txt('Kills ' + view.kills, W - Math.round(10 * d), xh + Math.round(28 * d), '#e8d8c0', 18, 'right');
    txt('Gold ' + view.gold, W - Math.round(10 * d), xh + Math.round(48 * d), '#ffd24a', 18, 'right');
    if (!me) return;
    // weapon and passive slots
    const sz = Math.round(30 * d), gap = Math.round(4 * d), x0 = Math.round(10 * d);
    let y = xh + Math.round(8 * d);
    for (let i = 0; i < 6; i++) {
      const x = x0 + i * (sz + gap), ws = me.weapons[i];
      c.fillStyle = 'rgba(10,7,6,0.7)'; c.fillRect(x, y, sz, sz);
      c.strokeStyle = ws && ws.evo ? '#ffd27a' : 'rgba(232,216,192,0.35)'; c.lineWidth = Math.max(1, d); c.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
      if (!ws) continue;
      const def = ED.WEAPONS[ws.id]; if (def) icon(def.icon, x + 2 * d, y + 2 * d, sz - 4 * d);
      txt(String(ws.lvl), x + sz - 2 * d, y + sz - 16 * d, '#fff1d6', 16, 'right');
    }
    y += sz + gap;
    for (let i = 0; i < 6; i++) {
      const x = x0 + i * (sz + gap), ps = me.passives[i];
      c.fillStyle = 'rgba(10,7,6,0.6)'; c.fillRect(x, y, sz, sz);
      c.strokeStyle = 'rgba(232,216,192,0.25)'; c.lineWidth = Math.max(1, d); c.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
      if (!ps) continue;
      const def = ED.PASSIVES[ps.id]; if (def) icon(def.icon, x + 3 * d, y + 3 * d, sz - 6 * d);
      txt(String(ps.lvl), x + sz - 2 * d, y + sz - 16 * d, '#bfefff', 16, 'right');
    }
    // HP bottom-left
    const Hh = ctx.canvas.height, hw = Math.round(260 * d), hy = Hh - Math.round(44 * d);
    bar(x0, hy, hw, Math.round(18 * d), me.maxHp ? me.hp / me.maxHp : 0, me.hp / me.maxHp < 0.3 ? '#ff4a3a' : '#e8483a');
    txt('HP ' + Math.max(0, Math.ceil(me.hp)) + ' / ' + me.maxHp, x0 + Math.round(6 * d), hy + Math.round(1 * d), '#fff1d6', 16);
    // skills + dash bottom-centre
    const ks = Math.round(48 * d), kg = Math.round(10 * d), kx0 = W / 2 - (ks * 3 + kg * 2) / 2, ky = Hh - ks - Math.round(14 * d);
    const slots = [[me.skills[0], 'Q'], [me.skills[1], 'E'], [{ id: 'dash', cd: me.dashCd, cdMax: ED.CONST.DASH.cd }, 'Space']];
    slots.forEach(([sk, key], i) => {
      const x = kx0 + i * (ks + kg);
      c.fillStyle = 'rgba(10,7,6,0.75)'; c.fillRect(x, ky, ks, ks);
      if (sk) {
        const def = ED.SKILLS[sk.id];
        if (def) icon(def.icon, x + 6 * d, ky + 6 * d, ks - 12 * d); else icon('fx.smoke', x + 6 * d, ky + 6 * d, ks - 12 * d);
        if (sk.cd > 0) { c.fillStyle = 'rgba(10,7,6,0.7)'; c.fillRect(x, ky, ks, Math.round(ks * U.clamp(sk.cd / (sk.cdMax || 1), 0, 1))); txt(String(Math.ceil(sk.cd)), x + ks / 2, ky + ks / 2, '#fff1d6', 24, 'center', 'middle'); }
      }
      c.strokeStyle = sk && sk.cd > 0 ? 'rgba(232,216,192,0.3)' : '#ffd27a'; c.lineWidth = Math.max(1, 2 * d); c.strokeRect(x + 1, ky + 1, ks - 2, ks - 2);
      txt(key, x + ks / 2, ky - Math.round(18 * d), '#e8d8c0', 16, 'center');
    });
    // boss bar
    const b = view.boss;
    if (b && !b.dead) {
      const def = ED.FOES[ED.FOE_IDS[b.k]], bw = Math.round(Math.min(W * 0.5, 600 * d)), bx = W / 2 - bw / 2, by = xh + Math.round(46 * d);
      bar(bx, by, bw, Math.round(14 * d), b.hpQ / 255, b.enraged ? '#ff2a2a' : '#c03ad0');
      txt((def ? def.name : 'Boss') + (b.enraged ? '  ENRAGED' : ''), W / 2, by + Math.round(16 * d), '#ffd27a', 20, 'center');
    }
    // downed / revive notice
    if (me.downed) txt('DOWN - a teammate can revive you (' + Math.ceil(me.bleed) + ')', W / 2, Hh / 2 + Math.round(60 * d), '#ff8a7a', 24, 'center');
    // banner
    const bn = H.banner;
    if (bn) {
      bn.t -= dt;
      if (bn.t <= 0) H.banner = null;
      else { c.globalAlpha = Math.min(1, bn.t / 0.4, (bn.max - bn.t) / 0.15 + 0.2); txt(bn.text, W / 2, Math.round(ctx.canvas.height * 0.26), bn.col, 32, 'center'); c.globalAlpha = 1; }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
