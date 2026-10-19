// Visual and audio feedback: particles, slashes, damage numbers, banners, shake.
// World events (from the local sim or the host's snapshots) are translated into effects here.
(function (ED) {
  'use strict';
  const U = ED.U;
  const F = ED.FX = { parts: [], texts: [], slashes: [], rings: [], bolts: [], msgs: [], banner: null, shake: 0, flash: null, fade: 0, anim: {}, hitstop: 0, time: 0 };
  let MAXP = 500;

  F.reset = () => { F.parts.length = 0; F.texts.length = 0; F.slashes.length = 0; F.rings.length = 0; F.bolts.length = 0; F.msgs.length = 0; F.banner = null; F.shake = 0; F.flash = null; F.anim = {}; };
  F.setQuality = (q) => { MAXP = q === 'low' ? 180 : 500; };

  F.part = (x, y, o) => {
    if (F.parts.length >= MAXP) F.parts.shift();
    const a = o.a !== undefined ? o.a : Math.random() * U.TAU, sp = o.sp !== undefined ? o.sp : 40 + Math.random() * 80;
    F.parts.push({ x, y, vx: Math.cos(a) * sp + (o.vx || 0), vy: Math.sin(a) * sp + (o.vy || 0), life: o.life || 0.5, max: o.life || 0.5, size: o.size || 2,
      color: o.color || '#fff', kind: o.kind || 'dot', grav: o.grav || 0, drag: o.drag !== undefined ? o.drag : 3, add: !!o.add, z: o.z || 0, vz: o.vz || 0, rot: Math.random() * 6 });
  };
  F.burst = (x, y, n, o) => { const k = MAXP < 300 ? Math.ceil(n / 2) : n; for (let i = 0; i < k; i++) F.part(x, y, Object.assign({}, o, { sp: (o.sp || 90) * (0.4 + Math.random() * 0.8), life: (o.life || 0.5) * (0.6 + Math.random() * 0.6) })); };
  F.text = (x, y, s, color, size, opts) => { if (F.texts.length > 80) F.texts.shift(); F.texts.push(Object.assign({ x: x + (Math.random() - 0.5) * 10, y, s: String(s), color, size: size || 10, life: 0.9, max: 0.9, vy: -42 }, opts || {})); };
  F.ring = (x, y, r, color, life, width) => F.rings.push({ x, y, r, color, life: life || 0.4, max: life || 0.4, w: width || 3 });
  F.slash = (x, y, a, r, arc, color, life) => F.slashes.push({ x, y, a, r, arc, color, life: life || 0.16, max: life || 0.16 });
  F.addShake = (v) => { if (ED.App && !ED.App.settings.shake) return; F.shake = Math.min(14, F.shake + v); };
  F.msg = (text, color) => { F.msgs.push({ text, color: color || '#f0e5d3', t: 4 }); if (F.msgs.length > 5) F.msgs.shift(); };
  F.showBanner = (title, sub, style, dur) => { F.banner = { title, sub: sub || '', style: style || 'small', t: 0, dur: dur || 2.6 }; };

  F.update = (dt) => {
    F.time += dt;
    F.shake = Math.max(0, F.shake - dt * 30);
    if (F.flash) { F.flash.t -= dt; if (F.flash.t <= 0) F.flash = null; }
    for (const p of F.parts) {
      p.life -= dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d; p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vz || p.z) { p.vz -= 300 * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; } }
      p.rot += dt * 6;
    }
    F.parts = F.parts.filter(p => p.life > 0);
    for (const t of F.texts) { t.life -= dt; t.y += t.vy * dt; t.vy *= Math.max(0, 1 - 2.5 * dt); }
    F.texts = F.texts.filter(t => t.life > 0);
    for (const s of F.slashes) s.life -= dt;
    F.slashes = F.slashes.filter(s => s.life > 0);
    for (const r of F.rings) r.life -= dt;
    F.rings = F.rings.filter(r => r.life > 0);
    for (const b of F.bolts) b.life -= dt;
    F.bolts = F.bolts.filter(b => b.life > 0);
    for (const m of F.msgs) m.t -= dt;
    F.msgs = F.msgs.filter(m => m.t > 0);
    if (F.banner) { F.banner.t += dt; if (F.banner.t > F.banner.dur) F.banner = null; }
    for (const k in F.anim) F.anim[k].atkT = (F.anim[k].atkT || 9) + dt;
    if (F.fade > 0) F.fade = Math.max(0, F.fade - dt * 2.2);
  };

  F.playerAttackAnim = (pid, a) => {
    const an = F.anim[pid] || (F.anim[pid] = { atkT: 9, side: 1 });
    an.atkT = 0; an.side = -an.side; an.a = a;
  };

  const ENEMY_COLOR = (type) => { const d = ED.ENEMIES[type]; return d ? d.col.a : '#ffffff'; };
  const PROJ_COLOR = { bone: '#e6dfc9', spore: '#9cff6a', ice: '#9fefff', fire: '#ff8a2a', water: '#6fe6ff', void: '#d48cff', arrow: '#e8d8b0', bolt: '#cfd6de', firebolt: '#ff9a3a', spark: '#ffcf4a', fireball: '#ff6a1a', knife: '#d9dfe8', holy: '#ffe9a0', soul: '#7dffd9', plague: '#9cff6a', wave: '#ffe9a0', wisp: '#bff0ff', shard: '#b78cff', blade: '#cfd6de', orb: '#ff7ad9', trident: '#e8c66b', skull: '#e6dfc9' };
  F.projColor = (k) => PROJ_COLOR[k] || '#ffffff';
  const BOOM = { fire: ['#ff9a3a', '#ffcf4a'], bigfire: ['#ff6a1a', '#ffd36b'], shock: ['#e8e2c8', '#ffffff'], slam: ['#c9b98f', '#ffffff'], spore: ['#9cff6a', '#e8ffd0'], ice: ['#9fefff', '#ffffff'], bolt: ['#bfe9ff', '#ffffff'], bone: ['#7dffd9', '#e6dfc9'], burst: ['#ff6a4a', '#ffd36b'], shadow: ['#b78cff', '#2a1f44'] };

  // Translate one world event into effects. local: the viewing player's pid.
  F.handle = (ev, ctx) => {
    const local = ctx.localPid, A = ED.Audio, set = ED.App ? ED.App.settings : { dmg: true };
    switch (ev.t) {
      case 'hit': {
        const mine = ev.pid === local;
        if (set.dmg && (mine || ev.c || ev.v >= 20)) F.text(ev.x, ev.y - 6, ev.v, ev.c ? '#ffd36b' : ev.k ? '#ffab70' : (mine ? '#ffffff' : '#cfc6b6'), ev.c ? 13 : (ev.k ? 8 : 10), ev.c ? { crit: true } : null);
        if (!ev.k) { F.burst(ev.x, ev.y + 6, ev.c ? 7 : 3, { color: ev.c ? '#ffd36b' : '#ffffff', sp: 110, life: 0.25, size: ev.c ? 2.4 : 1.6, add: true }); A.play(ev.c ? 'crit' : 'hit', mine ? 1 : 0.5); }
        if (ev.c && mine) F.addShake(2);
        break;
      }
      case 'die': {
        const col = ENEMY_COLOR(ev.type);
        const big = ev.el || ev.r > 14;
        F.burst(ev.x, ev.y - 6, big ? 26 : 12, { color: col, sp: big ? 150 : 110, life: 0.6, size: big ? 3.4 : 2.6, kind: 'shard', vz: 120, z: 6 });
        F.burst(ev.x, ev.y - 6, 6, { color: '#000000', sp: 40, life: 0.8, size: 6, kind: 'smoke', drag: 2 });
        A.play('die', 0.7);
        if (big) { F.ring(ev.x, ev.y, 30, col, 0.4); F.addShake(3); }
        break;
      }
      case 'hurt': {
        if (ev.pid === local) { F.flash = { color: '#ff2a2a', t: 0.25, a: 0.32 }; F.addShake(6); A.play('hurt'); }
        F.text(ev.x, ev.y - 26, '-' + ev.v, '#ff5a4a', 11);
        F.burst(ev.x, ev.y - 10, 8, { color: '#d22a2a', sp: 90, life: 0.4, size: 2.2 });
        break;
      }
      case 'heal': if (ev.v >= 2) { F.text(ev.x, ev.y - 28, '+' + ev.v, '#86d38f', 10); F.burst(ev.x, ev.y - 10, 6, { color: '#86ffa0', sp: 30, vy: -40, life: 0.7, size: 2, add: true, drag: 1 }); if (ev.pid === local) A.play('heal', 0.6); } break;
      case 'boom': {
        const cols = BOOM[ev.k] || BOOM.fire;
        F.ring(ev.x, ev.y, ev.r, cols[0], 0.35, 4);
        F.burst(ev.x, ev.y, Math.min(30, 8 + ev.r / 4), { color: cols[0], sp: ev.r * 2.6, life: 0.45, size: 3, add: true });
        F.burst(ev.x, ev.y, 6, { color: cols[1], sp: ev.r * 1.2, life: 0.3, size: 4, add: true });
        F.addShake(Math.min(7, ev.r / 18)); A.play('boom', Math.min(1, ev.r / 80));
        break;
      }
      case 'swing': {
        if (ev.pid !== local) { const p = ctx.player(ev.pid); if (p) F.slash(p.x, p.y - 10, ev.a, ev.r, ev.arc, ED.PLAYER_COLORS[p.slot]); A.play('swing', 0.35); }
        break;
      }
      case 'atk': if (ev.pid !== local) { F.playerAttackAnim(ev.pid, ev.a); const p = ctx.player(ev.pid); if (p && p.stats && !p.stats.melee) A.play('shoot', 0.3); } break;
      case 'spark': F.burst(ev.x, ev.y, 4, { color: F.projColor(ED.PROJ_KINDS[ev.k]), sp: 80, life: 0.25, size: 1.8, add: true }); A.play('spark', 0.4); break;
      case 'chain': F.bolts.push({ pts: ev.pts, life: 0.22, max: 0.22, color: '#bfe9ff' }); A.play('bolt', 0.5); break;
      case 'bolt': F.bolts.push({ pts: [[ev.x + 10, ev.y - 220], [ev.x - 8, ev.y - 120], [ev.x + 6, ev.y - 50], [ev.x, ev.y]], life: 0.3, max: 0.3, color: '#ffffff' }); A.play('bolt'); F.addShake(3); break;
      case 'nova': F.ring(ev.x, ev.y, ev.r, ev.c || '#ff7a2a', 0.45, 6); F.burst(ev.x, ev.y, 26, { color: ev.c || '#ff7a2a', sp: ev.r * 3, life: 0.45, size: 3, add: true }); A.play('boom', 0.6); F.addShake(4); break;
      case 'levelup': F.showBanner('Level ' + ev.level, 'A boon awaits when the room is clear', 'level', 2.2); A.play('level'); for (const p of ctx.players()) F.burst(p.x, p.y - 10, 18, { color: '#ffd36b', sp: 80, vy: -60, life: 0.9, size: 2.2, add: true, drag: 1.5 }); break;
      case 'gold': if (ev.pid === local) A.play('gold', 0.6); break;
      case 'xp': if (ev.pid === local) A.play('xp', 0.5); break;
      case 'boon': { const p = ctx.player(ev.pid); if (p) { F.burst(p.x, p.y - 12, 22, { color: ED.RARITY[ED.BOONS[ev.id].rar].color, sp: 70, vy: -50, life: 0.8, size: 2.4, add: true, drag: 1.2 }); } if (ev.pid === local) A.play('boon'); break; }
      case 'relic': { const p = ctx.player(ev.pid); const r = ED.RELICS[ev.id]; if (p) { F.text(p.x, p.y - 40, r.name, ED.RARITY[r.rar].color, 11, { life: 1.8, max: 1.8 }); F.burst(p.x, p.y - 12, 24, { color: ED.RARITY[r.rar].color, sp: 80, vy: -40, life: 0.9, size: 2.4, add: true }); } if (ev.pid === local) { A.play('relic'); ED.UI && ED.UI.toast(`<b>${r.name}</b> — ${r.desc}`, ED.Icons.relicUrl(ev.id)); } else if (p) F.msg(`${p.name} found ${r.name}`); break; }
      case 'lock': A.play('lock'); F.addShake(4); break;
      case 'clear': A.play('unlock'); F.showBanner(ev.trial ? 'Trial complete' : 'Room cleared', '', 'small', 1.4); break;
      case 'bossIntro': F.showBanner(ev.name, ev.title, 'boss', 3.4); F.bossQuote = { text: ev.quote, t: 0 }; A.play('roar'); A.music({ s: ctx.stratum(), boss: true }); F.addShake(8); break;
      case 'bossSpawn': F.addShake(6); break;
      case 'bossDown': F.showBanner('Vanquished', ED.ENEMIES[ev.type].name, 'victory', 3); F.flash = { color: '#ffffff', t: 0.5, a: 0.5 }; F.addShake(12); A.play('roar', 0.6); A.play('victory', 0.7); A.music({ s: ctx.stratum() }); F.burst(ev.x, ev.y - 20, 60, { color: ED.ENEMIES[ev.type].col.c, sp: 220, life: 1.2, size: 3.5, add: true }); break;
      case 'phase': F.addShake(8); A.play('roar', 0.8); F.ring(ev.x, ev.y, 120, '#ffffff', 0.5, 5); break;
      case 'stratum': { const b = ED.biomeFor(ev.s); F.showBanner(b.name, 'Stratum ' + U.roman(ev.s), 'stratum', 3.6); F.fade = 1; A.music({ s: ev.s }); break; }
      case 'room': F.fade = Math.max(F.fade, 0.6); break;
      case 'down': { const p = ctx.player(ev.pid); A.play('down'); if (p) F.msg(ev.pid === local ? 'You are down! An ally can revive you.' : `${p.name} is down! Stand near them to revive.`, '#ff8a7a'); break; }
      case 'revived': { const p = ctx.player(ev.pid); A.play('revive'); if (p) { F.msg(`${p.name} is back on their feet`, '#86d38f'); F.burst(p.x, p.y - 10, 24, { color: '#ffe9a0', sp: 70, vy: -60, life: 0.9, size: 2.4, add: true }); } break; }
      case 'dead': { const p = ctx.player(ev.pid); if (p) F.msg(`${p.name} has fallen. They return at the next stratum.`, '#ff8a7a'); break; }
      case 'rise': { const p = ctx.player(ev.pid); const name = { phoenix: 'Phoenix Feather', angel: 'Guardian Angel', wind: 'Second Wind' }[ev.k]; F.showBanner(name, p ? p.name + ' refuses to fall' : '', 'small', 2); F.burst(ev.x, ev.y - 10, 40, { color: '#ffd36b', sp: 150, life: 0.9, size: 3, add: true }); A.play('revive'); break; }
      case 'dash': A.play('dash', ev.pid === local ? 0.8 : 0.3); F.burst(ev.x, ev.y, 6, { color: '#ffffff', sp: 40, life: 0.3, size: 3, kind: 'smoke', drag: 4 }); break;
      case 'skill': { A.play('skill', ev.pid === local ? 1 : 0.5); const p = ctx.player(ev.pid); if (p && ev.k === 'volley') F.ring(p.x, p.y, 30, '#e8d8b0', 0.25); if (ev.k === 'legion' || ev.k === 'sanctuary') F.ring(ev.x, ev.y, ev.k === 'sanctuary' ? 100 : 40, ev.k === 'sanctuary' ? '#ffe9a0' : '#7dffd9', 0.5, 4); break; }
      case 'blink': for (let i = 0; i <= 8; i++) { const k = i / 8; F.part(U.lerp(ev.x0, ev.x1, k), U.lerp(ev.y0, ev.y1, k) - 10, { color: '#b78cff', sp: 20, life: 0.5, size: 4, add: true, kind: 'smoke' }); } break;
      case 'blinkfx': F.burst(ev.x0, ev.y0 - 12, 14, { color: '#b78cff', sp: 60, life: 0.5, size: 3, add: true }); F.burst(ev.x1, ev.y1 - 12, 14, { color: '#b78cff', sp: 60, life: 0.5, size: 3, add: true }); break;
      case 'deflect': F.burst(ev.x, ev.y, 8, { color: '#ffffff', sp: 120, life: 0.25, size: 2, add: true }); A.play('deflect', 0.6); break;
      case 'block': F.text(ev.x, ev.y - 30, { dodge: 'Dodge', mirror: 'Shrugged off', aegis: 'Blocked' }[ev.k], '#bfe9ff', 9); A.play('deflect', 0.5); break;
      case 'spawned': F.burst(ev.x, ev.y, ev.el ? 18 : 8, { color: ev.el ? '#ffb13a' : '#b8a0ff', sp: 70, life: 0.4, size: 2.4, add: true }); A.play('spawn', 0.5); break;
      case 'raise': F.burst(ev.x, ev.y, 14, { color: '#7dffd9', sp: 60, vy: -40, life: 0.6, size: 2.4, add: true }); break;
      case 'puff': F.burst(ev.x, ev.y - 8, 10, { color: ev.c || '#cccccc', sp: 50, life: 0.5, size: 3, kind: 'smoke' }); break;
      case 'thud': F.addShake(ev.big ? 9 : 3); A.play('thud', ev.big ? 1 : 0.5); F.burst(ev.x, ev.y, 10, { color: '#bba98a', sp: 80, life: 0.4, size: 3, kind: 'smoke' }); break;
      case 'shoot': A.play('eshoot', 0.6); break;
      case 'chest': A.play('chest'); F.burst(ev.x, ev.y - 10, 30, { color: '#ffd36b', sp: 120, vy: -60, life: 0.9, size: 2.4, add: true }); break;
      case 'buy': A.play('buy'); break;
      case 'fountain': A.play('heal'); F.burst(ev.x, ev.y - 10, 40, { color: '#6fe6ff', sp: 100, vy: -80, life: 1.0, size: 2.6, add: true }); break;
      case 'altar': A.play('hurt', 0.6); F.burst(ev.x, ev.y - 10, 30, { color: '#d43a5a', sp: 90, vy: -60, life: 0.8, size: 2.6, add: true }); break;
      case 'gamble': A.play('chest'); break;
      case 'descend': A.play('portal'); F.fade = 1.4; break;
      case 'victory': A.play('victory'); F.showBanner('The Hollow King falls', 'The Deep is quiet, for now', 'victory', 4.5); break;
      case 'defeat': A.play('defeat'); A.music('none'); break;
      case 'expose': F.text(ev.x, ev.y - 30, ev.boss ? 'WEAKENED' : 'EXPOSED', '#ff6a5a', ev.boss ? 13 : 9); break;
      case 'wardbreak': F.ring(ev.x, ev.y - 10, 26, '#7fc8ff', 0.3, 3); A.play('deflect'); break;
      case 'guard': A.play('skill', 0.6); break;
      case 'lantern': F.showBanner('Your lantern gutters', 'Three minutes of light remain', 'small', 3); A.play('lock', 0.6); break;
      case 'cone': F.slash(ev.x, ev.y - 6, ev.a, ev.r, ev.arc, '#ff5a3a', 0.25); break;
      case 'left': F.msg(`${ev.name} left the party`, '#ffab70'); break;
      default: break;
    }
  };

  // ---------- drawing (world space) ----------
  F.drawWorld = (c) => {
    // slashes
    for (const s of F.slashes) {
      const k = s.life / s.max;
      c.save(); c.translate(s.x, s.y); c.rotate(s.a);
      c.globalAlpha = Math.min(1, k * 1.6) * 0.8;
      const arc = Math.min(6.28, s.arc);
      c.fillStyle = U.rgba(s.color, 0.55);
      c.beginPath(); c.arc(0, 0, s.r, -arc / 2, arc / 2); c.arc(0, 0, s.r * (0.55 + 0.25 * (1 - k)), arc / 2, -arc / 2, true); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, s.r, -arc / 2, arc / 2); c.stroke();
      c.restore();
    }
    c.globalAlpha = 1;
    // rings
    for (const r of F.rings) {
      const k = 1 - r.life / r.max;
      c.strokeStyle = U.rgba(r.color, (1 - k) * 0.85); c.lineWidth = r.w * (1 - k) + 0.5;
      c.beginPath(); c.arc(r.x, r.y, r.r * (0.3 + 0.7 * U.easeOut(k)), 0, U.TAU); c.stroke();
    }
    // particles
    for (const p of F.parts) {
      const k = p.life / p.max;
      if (p.add) c.globalCompositeOperation = 'lighter';
      c.globalAlpha = p.kind === 'smoke' ? k * 0.35 : Math.min(1, k * 1.5);
      c.fillStyle = p.color;
      const sz = p.kind === 'smoke' ? p.size * (2 - k) : p.size * (0.4 + 0.6 * k);
      if (p.kind === 'shard') { c.save(); c.translate(p.x, p.y - p.z); c.rotate(p.rot); c.fillRect(-sz, -sz * 0.5, sz * 2, sz); c.restore(); }
      else { c.beginPath(); c.arc(p.x, p.y - p.z, sz, 0, U.TAU); c.fill(); }
      c.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = 1;
    // lightning
    for (const b of F.bolts) {
      c.strokeStyle = U.rgba(b.color, b.life / b.max); c.lineWidth = 2.2;
      c.beginPath();
      b.pts.forEach((pt, i) => { const jx = i && i < b.pts.length - 1 ? (Math.random() - 0.5) * 10 : 0, jy = i && i < b.pts.length - 1 ? (Math.random() - 0.5) * 10 : 0; if (i === 0) c.moveTo(pt[0], pt[1] - 10); else c.lineTo(pt[0] + jx, pt[1] - 10 + jy); });
      c.stroke();
      c.strokeStyle = U.rgba('#ffffff', b.life / b.max); c.lineWidth = 1; c.stroke();
    }
  };

  F.drawTexts = (c) => {
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const t of F.texts) {
      const k = t.life / t.max;
      const pop = t.crit ? 1 + Math.max(0, (k - 0.8)) * 3 : 1;
      c.globalAlpha = Math.min(1, k * 2);
      c.font = `800 ${Math.round(t.size * pop)}px "Alegreya Sans", system-ui, sans-serif`;
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(t.s, t.x, t.y);
      c.fillStyle = t.color; c.fillText(t.s, t.x, t.y);
    }
    c.globalAlpha = 1;
  };
})(globalThis.ED || (globalThis.ED = {}));
