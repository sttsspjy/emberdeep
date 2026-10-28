// In-run HUD on the screen canvas (device px). Sizes are CSS px at 1280x720 scaled by k = dpr x clamp(viewport / 1280x720, 1, 2), so text never drops below its CSS size (numbers >= 16 px).
// Draws: XP bar across the top with the level, timer, kills / gold, the weapon slot (level; Form = gold frame) + 6 passive slots with levels,
// HP bar, Q cooldown dial and the dash dial with charge pips, boss bar, teammate panel (HP, downed, revive), off-screen teammate arrows, own downed notice,
// low-HP edge glow, banners and the bot-watch tag (view.botTag / view.botPick, bottom-left). No per-frame allocation: strings are cached by value. Font 'Pixel Operator'.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = Math.PI * 2;
  const H = ED.HUD = { banner: null, k: 1 };
  const FONT = 'px "Pixel Operator", monospace';
  const SLOT_COL = ['#ffd27a', '#6ad7ff', '#7fe39a', '#ff8ad8'];
  const NUM = []; for (let i = 0; i <= 99; i++) NUM.push(String(i));
  let c = null, k = 1, W = 0, Hh = 0, now = 0, hudTop = 0;
  const fpx = []; // cached font strings per rounded px
  const font = (px) => { const n = Math.max(8, Math.round(px * k)); c.font = fpx[n] || (fpx[n] = n + FONT); };
  const txt = (s, x, y, col, px, align, base) => {
    font(px); c.textAlign = align || 'left'; c.textBaseline = base || 'top';
    c.lineWidth = Math.max(2, Math.round(3.5 * k)); c.strokeStyle = 'rgba(10,7,6,0.92)'; c.lineJoin = 'round'; c.strokeText(s, x, y);
    c.fillStyle = col; c.fillText(s, x, y);
  };
  const ptxt = (s, x, y, col, px) => { font(px); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col; c.fillText(s, x, y); }; // no outline (dark text on a light badge)
  const R = (v) => Math.round(v * k);
  const frame = (x, y, w, h, col, lw) => { c.strokeStyle = col; c.lineWidth = lw; c.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw); };
  const bar = (x, y, w, h, f, col, hi, back) => {
    c.fillStyle = back || 'rgba(10,7,6,0.8)'; c.fillRect(x, y, w, h);
    const fw = Math.round(w * U.clamp(f, 0, 1));
    c.fillStyle = col; c.fillRect(x, y, fw, h);
    if (hi) { c.fillStyle = hi; c.fillRect(x, y, fw, Math.max(1, Math.round(h * 0.3))); }
    frame(x, y, w, h, '#000', Math.max(2, Math.round(2 * k)));
  };
  // Atlas icon `id` (frame i) fitted into a size x size box at (x, y).
  const icon = (id, x, y, size, i) => {
    const A = ED.Atlas, r = A && A.ok && A.anim(id); if (!r) return;
    const f = r.f[0], s = Math.max(1, Math.floor(size / Math.max(f.w, f.h)));
    c.save(); c.translate(Math.round(x + size / 2 - (f.ox + f.w / 2 - r.ax) * s), Math.round(y + size / 2 - (f.oy + f.h / 2 - r.ay) * s)); c.scale(s, s);
    A.draw(c, id, i | 0, 0, 0); c.restore();
  };
  H.icon = (ctx, id, x, y, size) => { const oc = c; c = ctx; icon(id, x, y, size); c = oc; };
  H.show = (text, col, secs) => { H.banner = { text, col: col || '#ffd27a', t: secs || 2.5, max: secs || 2.5 }; };

  // value -> string caches (one slot per call site)
  const cache = {};
  const cs = (key, v, fmt) => { let e = cache[key]; if (!e) e = cache[key] = { v: NaN, s: '' }; if (e.v !== v) { e.v = v; e.s = fmt(v); } return e.s; };
  const fmtLv = (v) => 'LV ' + v, fmtKills = (v) => U.fmtNum(v), fmtHp = (v) => (v >> 12) + ' / ' + (v & 4095), fmtSec = (v) => String(v), fmtBleed = (v) => 'DOWN  ' + v, fmtT = (v) => U.fmtTime(v);
  const heroIcon = (cls) => (ED.HEROES[cls] && ED.HEROES[cls].icon) || '';
  const RUN = {}; const runIcon = (cls) => RUN[cls] || (RUN[cls] = ED.Atlas && ED.Atlas.has('hero.' + cls + '.run') ? 'hero.' + cls + '.run' : 'fx.smoke');
  const bossName = (v) => { const def = ED.FOES[ED.FOE_IDS[v >> 1]]; return (def ? def.name : 'Boss') + (v & 1 ? '  ENRAGED' : ''); };
  const keyLbl = { q: 'Q', dash: 'Space', t: 0 };
  const keys = () => {
    if (now - keyLbl.t < 1) return; keyLbl.t = now;
    const I = ED.Input; if (!I || !I.labels) return;
    keyLbl.q = I.labels('skill1')[0] || 'Q'; keyLbl.dash = I.labels('dash')[0] || 'Space';
  };

  // ---------------- pieces ----------------
  const ready = [0, 0, 0], readyT = [0, 0, 0];
  // Cooldown dial: icon, dark pie for the remaining fraction, seconds, key badge; flashes when it comes back.
  function dial(i, x, y, s, id, cd, cdMax, key, col) {
    c.fillStyle = 'rgba(10,7,6,0.82)'; c.fillRect(x, y, s, s);
    icon(id, x + R(5), y + R(5), s - R(10));
    const f = cdMax > 0 ? U.clamp(cd / cdMax, 0, 1) : 0, up = cd <= 0;
    if (!up) {
      c.save(); c.beginPath(); c.rect(x, y, s, s); c.clip();
      c.fillStyle = 'rgba(8,6,5,0.72)'; c.beginPath(); c.moveTo(x + s / 2, y + s / 2); c.arc(x + s / 2, y + s / 2, s * 0.75, -Math.PI / 2, -Math.PI / 2 + TAU * f); c.closePath(); c.fill();
      c.restore();
      txt(cs('cd' + i, Math.ceil(cd), fmtSec), x + s / 2, y + s / 2 + R(1), '#fff1d6', s > R(50) ? 26 : 20, 'center', 'middle');
    }
    if (up && !ready[i]) readyT[i] = 0.45;
    ready[i] = up ? 1 : 0;
    frame(x, y, s, s, up ? col : 'rgba(232,216,192,0.28)', Math.max(2, R(up ? 3 : 2)));
    if (readyT[i] > 0) { c.globalAlpha = readyT[i] / 0.45; c.fillStyle = '#fff6dc'; c.fillRect(x, y, s, s); c.globalAlpha = 1; }
    // key badge
    font(16); const kw = Math.max(R(22), Math.ceil(c.measureText(key).width) + R(10)), kh = R(22), bx = x - R(6), by = y - R(12);
    c.fillStyle = '#000'; c.fillRect(bx, by, kw, kh);
    c.fillStyle = up ? col : '#4a3a2e'; c.fillRect(bx + R(2), by + R(2), kw - R(4), kh - R(4));
    ptxt(key, bx + kw / 2, by + kh / 2 + R(1), up ? '#1a0e06' : '#f0e0c8', 16);
  }
  // One row of slots (weapons: ED.MAX_WEAPONS, passives: 6); returns nothing. defs: ED.WEAPONS or ED.PASSIVES. A Form has a gold frame.
  function slots(list, defs, x0, y, s, weapons) {
    const gap = R(4), n = weapons ? ED.MAX_WEAPONS || 1 : ED.MAX_PASSIVES || 6;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (s + gap), it = list[i];
      c.fillStyle = it ? 'rgba(10,7,6,0.78)' : 'rgba(10,7,6,0.45)'; c.fillRect(x, y, s, s);
      const d = it && defs[it.id];
      let edge = 'rgba(232,216,192,0.25)', lw = Math.max(1, R(2));
      if (d) {
        icon(d.icon, x + R(3), y + R(3), s - R(6));
        const max = weapons ? 99 : d.max || 5;
        if (weapons && d.evolved) { edge = '#ffd27a'; lw = R(3); }
        else edge = weapons ? 'rgba(255,170,110,0.55)' : 'rgba(140,210,240,0.5)';
        txt(NUM[Math.min(99, it.lvl)], x + s - R(3), y + s - R(17), it.lvl >= max || d.evolved ? '#ffd27a' : '#fff1d6', 16, 'right');
      }
      frame(x, y, s, s, edge, lw);
    }
  }
  // Teammate list (co-op): portrait, name, HP bar or DOWN with the revive bar.
  function team(view, me, x, y) {
    let n = 0;
    for (let i = 0; i < view.heroes.length; i++) {
      const p = view.heroes[i]; if (p === me) continue;
      const yy = y + n * R(34), col = SLOT_COL[p.slot & 3];
      c.fillStyle = 'rgba(10,7,6,0.6)'; c.fillRect(x, yy, R(196), R(30));
      c.fillStyle = col; c.fillRect(x, yy, R(4), R(30));
      icon(heroIcon(p.cls), x + R(6), yy + R(1), R(28));
      txt(p.name, x + R(38), yy + R(1), p.dead ? '#7d6c58' : '#fff1d6', 16);
      if (p.dead) txt('dead', x + R(190), yy + R(1), '#7d6c58', 16, 'right');
      else if (p.downed) {
        txt(cs('bl' + i, Math.ceil(p.bleed), fmtBleed), x + R(190), yy + R(1), (now * 3 | 0) % 2 ? '#ff6a5a' : '#ffb0a0', 16, 'right');
        bar(x + R(38), yy + R(20), R(152), R(7), p.revive, '#7fe39a');
      } else bar(x + R(38), yy + R(20), R(152), R(7), p.maxHp ? p.hp / p.maxHp : 0, p.hp / p.maxHp < 0.3 ? '#ff4a3a' : '#e8483a');
      n++;
    }
  }
  // Arrows on the screen edge toward teammates outside the view (downed ones pulse red).
  function arrows(view, me) {
    const Rn = ED.Render; if (!Rn) return;
    const m = R(46), cx = W / 2, cy = Hh / 2;
    for (let i = 0; i < view.heroes.length; i++) {
      const p = view.heroes[i]; if (p === me || p.dead) continue;
      const sx = (p.x - Rn.camX) * Rn.scale, sy = (p.y - 10 - Rn.camY) * Rn.scale;
      if (sx >= 0 && sx <= W && sy >= 0 && sy <= Hh) continue;
      const dx = sx - cx, dy = sy - cy, t = Math.min((cx - m) / Math.max(1e-3, Math.abs(dx)), (cy - m) / Math.max(1e-3, Math.abs(dy)));
      const ax = cx + dx * t, ay = cy + dy * t, a = Math.atan2(dy, dx), col = p.downed ? ((now * 4 | 0) % 2 ? '#ff4a3a' : '#ffd0c0') : SLOT_COL[p.slot & 3];
      c.save(); c.translate(ax, ay); c.rotate(a);
      c.fillStyle = '#000'; c.beginPath(); c.moveTo(R(30), 0); c.lineTo(R(8), -R(15)); c.lineTo(R(8), R(15)); c.closePath(); c.fill();
      c.fillStyle = col; c.beginPath(); c.moveTo(R(26), 0); c.lineTo(R(11), -R(10)); c.lineTo(R(11), R(10)); c.closePath(); c.fill();
      c.restore();
      c.fillStyle = 'rgba(10,7,6,0.75)'; c.beginPath(); c.arc(ax, ay, R(17), 0, TAU); c.fill();
      c.strokeStyle = col; c.lineWidth = R(2); c.stroke();
      icon(heroIcon(p.cls), ax - R(14), ay - R(14), R(28));
      if (p.downed) txt('!', ax, ay - R(34), col, 22, 'center');
    }
  }
  // Low-HP glow on the screen edges (gradient cached per canvas size).
  let vg = null, vgW = 0, vgH = 0;
  function lowHp(f) {
    if (f >= 0.35) return;
    if (!vg || vgW !== W || vgH !== Hh) { vgW = W; vgH = Hh; vg = c.createRadialGradient(W / 2, Hh / 2, Math.min(W, Hh) * 0.35, W / 2, Hh / 2, Math.max(W, Hh) * 0.62); vg.addColorStop(0, 'rgba(255,30,20,0)'); vg.addColorStop(1, 'rgba(210,10,0,0.7)'); }
    c.globalAlpha = U.clamp((0.4 - f) / 0.3, 0.25, 1) * (0.7 + 0.3 * Math.sin(now * 7)); c.fillStyle = vg; c.fillRect(0, 0, W, Hh); c.globalAlpha = 1;
  }

  // ---------------- frame ----------------
  H.draw = (ctx, view, dt) => {
    c = ctx; W = ctx.canvas.width; Hh = ctx.canvas.height; now += dt;
    const d = (ED.Render && ED.Render.dpr) || 1;
    k = H.k = d * U.clamp(Math.min(W / d / 1280, Hh / d / 720), 1, 2);
    keys();
    const me = view.me;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (me && !me.dead) lowHp(me.maxHp ? me.hp / me.maxHp : 1);
    for (let i = 0; i < 3; i++) if (readyT[i] > 0) readyT[i] -= dt;
    // XP bar across the top + level
    const xh = R(20);
    bar(0, 0, W, xh, view.xpNext ? view.xp / view.xpNext : 0, '#3aa8e8', '#9fe6ff', 'rgba(10,7,6,0.85)');
    txt(cs('lv', view.level, fmtLv), W - R(10), R(2), '#ffffff', 16, 'right');
    // timer, kills, gold
    txt(cs('time', Math.floor(view.time), fmtT), W / 2, xh + R(6), '#fff1d6', 36, 'center');
    icon('fx.sigil.skull', W - R(40), xh + R(8), R(24));
    txt(cs('kills', view.kills, fmtKills), W - R(46), xh + R(8), '#f0e0c8', 22, 'right');
    icon('pickup.coin', W - R(40), xh + R(36), R(24));
    txt(cs('gold', view.gold, fmtKills), W - R(46), xh + R(36), '#ffd24a', 22, 'right');
    // boss bar: view.bossBar (whole fight: every body's HP, phase, revive dial), else the single boss entity
    const bb = view.bossBar, b = view.boss;
    if ((bb && bb.on) || (b && !b.dead)) {
      const bw = Math.round(Math.min(W * 0.5, R(620))), bx = Math.round(W / 2 - bw / 2), by = xh + R(52);
      const on = !!(bb && bb.on), en = on ? !!bb.enraged : !!b.enraged, q = on ? bb.q : b.hpQ, col = en ? ((now * 6 | 0) % 2 ? '#ff2a2a' : '#ff8a3a') : '#c03ad0';
      bar(bx, by, bw, R(18), q / 255, col, en ? '#ffb0a0' : '#f0a0ff');
      if (on && bb.rev >= 0) bar(bx, by + R(19), Math.round(bw * bb.rev), R(4), 1, '#7fe39a', '#7fe39a');
      const k = on ? Math.max(0, ED.FOE_IDS.indexOf(bb.id)) : b.k;
      txt(cs('boss', (k << 1) | (en ? 1 : 0), bossName), W / 2, by + R(21) + (on && bb.rev >= 0 ? R(4) : 0), en ? '#ff8a7a' : '#ffd27a', 20, 'center');
    }
    if (!me) { banner(dt); return; }
    // weapon and passive slots (top-left)
    const x0 = R(10), ws = R(42), ps = R(32);
    slots(me.weapons, ED.WEAPONS, x0, xh + R(8), ws, true);
    slots(me.passives, ED.PASSIVES, x0, xh + R(8) + ws + R(5), ps, false);
    if (view.heroes.length > 1) team(view, me, x0, xh + R(8) + ws + ps + R(16));
    // HP bar + skills (bottom centre)
    const ds = R(62), dd = R(50), gap = R(16), rowW = ds + dd + gap, kx = Math.round(W / 2 - rowW / 2), ky = Hh - ds - R(16);
    const hw = Math.max(rowW + R(40), R(360)), hx = Math.round(W / 2 - hw / 2), hy = ky - R(22) - R(26), hpF = me.maxHp ? me.hp / me.maxHp : 0;
    const top = Math.round((Hh - hy) / d) + 10; // CSS px kept clear above the HP bar (co-op card strip)
    if (top !== hudTop) { hudTop = top; document.documentElement.style.setProperty('--hud-bottom', top + 'px'); }
    bar(hx, hy, hw, R(22), hpF, hpF < 0.3 ? ((now * 5 | 0) % 2 ? '#ff4a3a' : '#c02a1a') : '#e8483a', '#ff9a8a');
    const hp = Math.max(0, Math.ceil(me.hp));
    txt(cs('hp', (Math.min(hp, 4095) << 12) | Math.min(me.maxHp | 0, 4095), fmtHp), W / 2, hy + R(3), '#fff1d6', 18, 'center');
    const q = me.skills[0], C = ED.CONST.DASH;
    if (q) dial(0, kx, ky, ds, ED.SKILLS[q.id] ? ED.SKILLS[q.id].icon : 'fx.star.stun', q.cd, q.cdMax, keyLbl.q, '#ffd27a');
    const dx = kx + ds + gap, dy = ky + ds - dd;
    dial(2, dx, dy, dd, runIcon(me.cls), me.dashCd, C.cd, keyLbl.dash, '#6ad7ff');
    // dash charge pips (one per charge; C.charges when the sim grows more)
    const nch = C.charges || 1, pw = R(10);
    for (let i = 0; i < nch; i++) { const px = dx + dd + R(6), py = dy + dd - (i + 1) * (pw + R(3)); c.fillStyle = '#000'; c.fillRect(px, py, pw, pw); c.fillStyle = me.dashCd <= 0 ? '#6ad7ff' : '#2a3a48'; c.fillRect(px + R(2), py + R(2), pw - R(4), pw - R(4)); }
    // teammates off-screen
    if (view.heroes.length > 1) arrows(view, me);
    // own downed notice
    if (me.downed) {
      const yy = Hh / 2 + R(70);
      txt(cs('mbl', Math.ceil(me.bleed), fmtBleed), W / 2, yy, (now * 3 | 0) % 2 ? '#ff6a5a' : '#ffb0a0', 32, 'center');
      txt('A teammate can revive you', W / 2, yy + R(38), '#f0e0c8', 18, 'center');
      bar(Math.round(W / 2 - R(110)), yy + R(62), R(220), R(10), me.revive, '#7fe39a');
    }
    if (view.botTag) {
      txt(view.botTag, x0, Hh - R(12), '#7fe3ff', 24, 'left', 'bottom');
      if (view.botPick) txt(view.botPick, x0, Hh - R(42), '#f0e0c8', 18, 'left', 'bottom');
    }
    banner(dt);
  };
  function banner(dt) {
    const bn = H.banner; if (!bn) return;
    bn.t -= dt;
    if (bn.t <= 0) { H.banner = null; return; }
    const a = Math.min(1, bn.t / 0.4, (bn.max - bn.t) / 0.15 + 0.2), s = 1 + Math.max(0, 0.25 - (bn.max - bn.t)) * 1.2;
    c.globalAlpha = a; txt(bn.text, W / 2, Math.round(Hh * 0.26), bn.col, 36 * s, 'center'); c.globalAlpha = 1;
  }
})(globalThis.ED || (globalThis.ED = {}));
