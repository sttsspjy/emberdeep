// shade route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Events from src/sim/class-shade.js: exec, whirl, twincut, after, lure, sref, veil, sweep, rupt, bloom. Hero hook: Momentum pips and ribbons, stealth rim, Veil bubble. Zone hook: the Afterimage decoy. Mark hook: execution threshold.
// Everything is pixel art on the 2 world px grid (atlas sprites through FX.sheet, 2 px particles, cached Pix rings); each sprite effect is paired with particles, so it still reads without ED.ART.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, Pix = ED.Pix, F = ED.FX, CFX = ED.ClassFx, s2 = Pix.s2;
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  const VIOLET = '#b78cff', PALE = '#e8dcff', BLOOD = '#c01830', RED = '#ff3a4a';
  const A = () => ED.Audio, R = () => ED.Render;
  const low = () => !!R() && R().quality === 'low';
  Pix.RAMP.execmark = ['#2a0408', '#6a0c18', '#c01830', '#e8283c', '#ff5a68']; // the skull of an executable foe: deep red, never white
  const dropOpts = (col, sp, life) => ({ kind: 'drop', color: col || BLOOD, sp: sp || 90, vz: 90, z: 8, life: life || 0.7, size: 2.4 });
  const mem = {}; // per hero: last Momentum count, next particle time, Veil bubble end
  const memOf = (pid) => mem[pid] || (mem[pid] = { n: 0, t: 0, veil: 0, full: false });

  // ---------------- events ----------------
  // Execution crit (Culling Blades): a big red X-cut across the foe, blood, a hard hit-stop for your own blow.
  CFX.on('exec', (ev, ctx, local) => {
    const m = ev.pid === local, a = ev.a || 0, x = ev.x, y = ev.y - 8;
    F.slash(x, y, a + 0.95, 46, 1.6, RED, 0.24); F.slash(x, y, a - 0.95, 46, 1.6, RED, 0.24);
    SP('fx.cutx', x, y, { ramp: 'blood', add: true, a: m ? 1 : 0.7, lt: RED, ltr: 56 });
    F.burst(x, y, 9, dropOpts(BLOOD, 120)); F.burst(x, y, 5, { kind: 'streak', color: '#ff7a6a', a, spread: 1.4, sp: 270, life: 0.22, size: 1.8 });
    F.pop(x, y, 30, '#ff4a4a', 0.2, true);
    if (m) { F.hitStop(0.06); F.addShake(2.5); F.punch(0.4, 0.2); }
    A().play('exec', m ? 0.9 : 0.45);
  });

  // Whirlwind (Thousand Cuts): a full-circle smear (blades) or six knives flying out of the hero.
  CFX.on('whirl', (ev, ctx, local) => {
    const m = ev.pid === local, x = ev.x, y = ev.y - 10;
    if (ev.k === 0) { F.slash(x, y, 0, Math.max(30, ev.r), 6.28, '#c9b3ff', 0.3); F.ring(ev.x, ev.y, Math.max(30, ev.r), VIOLET, 0.32, 3); }
    else for (let i = 0; i < 6; i++) { const a = i * TAU / 6; F.burst(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 2, { kind: 'streak', color: PALE, a, spread: 0.1, sp: 300, life: 0.3, size: 1.8 }); }
    F.burst(x, y, 8, { color: VIOLET, sp: 130, life: 0.35, size: 2.4, add: true }); F.pop(x, y, 24, VIOLET, 0.16);
    A().play('whirl', m ? 0.8 : 0.4);
  });

  // Twin Cut (Assassinate rider): a ghost of the Shadowstep runs the same path - pale silhouettes along it and a thin violet line.
  CFX.on('twincut', (ev, ctx, local) => {
    const m = ev.pid === local, ang = Math.atan2(ev.y1 - ev.y0, ev.x1 - ev.x0);
    F.bolts.push({ pts: [[ev.x0, ev.y0 - 8], [ev.x1, ev.y1 - 8]], life: 0.22, max: 0.22, color: PALE, st: true }); if (F.bolts.length > 24) F.bolts.shift();
    for (let i = 0; i <= 3; i++) { const k = i / 3; SP('hero.shade.idle', U.lerp(ev.x0, ev.x1, k), U.lerp(ev.y0, ev.y1, k), { ramp: 'shadow', frame: i, life: 0.28 + 0.04 * i, fade: true, a: 0.5 }); }
    SP('fx.cut', (ev.x0 + ev.x1) / 2, (ev.y0 + ev.y1) / 2 - 8, { ramp: 'shadow', add: true, rot: ang, a: m ? 1 : 0.7 });
    F.burst(ev.x1, ev.y1 - 8, 6, { kind: 'streak', color: PALE, a: ang, spread: 0.5, sp: 220, life: 0.2, size: 1.6 });
    A().play('swing', m ? 0.5 : 0.25);
  });

  // Afterimage burst (r80): a violet shockwave, dark smoke and a white flash; the blinded foes carry their own blind smoke.
  CFX.on('after', (ev, ctx, local) => {
    const m = ev.pid === local, r = ev.r || 80;
    F.ring(ev.x, ev.y, r, VIOLET, 0.4, 5); F.ring(ev.x, ev.y, r * 0.55, PALE, 0.26, 2);
    F.burst(ev.x, ev.y - 8, 14, { color: VIOLET, sp: r * 2.2, life: 0.45, size: 3, add: true });
    F.burst(ev.x, ev.y - 6, 6, { kind: 'smoke', color: '#241a3a', sp: r * 1.1, life: 0.6, size: 6, drag: 2.5 });
    for (let i = 0, n = low() ? 1 : 2; i < n; i++) { const a = i * TAU / 2 + 0.4; SP('fx.smoke', ev.x + Math.cos(a) * r * 0.45, ev.y - 8 + Math.sin(a) * r * 0.3, { ramp: 'shadow', delay: i * 0.04, a: 0.6 }); }
    SP('fx.blast.blue', ev.x, ev.y - 8, { ramp: 'shadow', add: true, lt: VIOLET, ltr: r });
    F.pop(ev.x, ev.y - 10, r * 0.4, PALE, 0.2);
    if (m) F.addShake(2);
    A().play('rift', m ? 0.7 : 0.4);
  });

  // Lure: every foe pulled in gets a violet tether to the decoy and streaks racing inward; a ring collapses on the decoy.
  CFX.on('lure', (ev, ctx, local) => {
    const m = ev.pid === local;
    F.ring(ev.x, ev.y - 4, 120, VIOLET, 0.32, 3, true);
    for (const q of ev.pts || []) {
      const a = Math.atan2(ev.y - q[1], ev.x - q[0]);
      F.bolts.push({ pts: [[q[0], q[1] - 6], [ev.x, ev.y - 6]], life: 0.28, max: 0.28, color: VIOLET, st: true }); if (F.bolts.length > 24) F.bolts.shift();
      F.burst(q[0], q[1] - 6, 3, { kind: 'streak', color: PALE, a, spread: 0.2, sp: 260, life: 0.22, size: 1.6 });
    }
    A().play('dash', m ? 0.55 : 0.3);
  });

  // Refund (Assassinate, Night's Edge): a white ring and a column of motes on the hero, and the slot that came back is named.
  CFX.on('sref', (ev, ctx, local) => {
    const m = ev.pid === local;
    F.ring(ev.x, ev.y, 26, '#ffffff', 0.3, 3); F.pop(ev.x, ev.y - 12, 24, '#ffffff', 0.18, true);
    F.burst(ev.x, ev.y - 6, 8, { color: PALE, sp: 40, vy: -70, life: 0.6, size: 2, add: true, drag: 1.4 });
    if (m) { F.text(ev.x, ev.y - 40, ev.slot === 1 ? 'Vanish ready' : 'Shadowstep ready', PALE, 9, { pop: true, life: 1, max: 1 }); A().play('sref', 0.7); }
  });

  // Veil of Night: the shield (its blue bubble comes with the shielded event) gets a violet ring and motes; the hero hook keeps a violet rim on it while it holds.
  CFX.on('veil', (ev, ctx, local) => {
    const m = ev.pid === local;
    memOf(ev.pid).veil = F.time + 12;
    F.ring(ev.x, ev.y, 30, VIOLET, 0.4, 3); F.burst(ev.x, ev.y - 10, 8, { color: VIOLET, sp: 50, vy: -40, life: 0.7, size: 2, add: true, drag: 1.4 });
    A().play('veil', m ? 0.6 : 0.3);
  });

  // Ambush Sweep: a ring of the sweep radius opens on each target with a short slash through it.
  CFX.on('sweep', (ev, ctx, local) => {
    F.ring(ev.x, ev.y, ev.r || 70, PALE, 0.28, 3); F.slash(ev.x, ev.y - 8, 0.6, (ev.r || 70) * 0.6, 1.2, VIOLET, 0.2);
    F.burst(ev.x, ev.y - 6, 6, { color: VIOLET, sp: (ev.r || 70) * 1.6, life: 0.3, size: 2.4, add: true });
  });

  // Night's Edge hits harder: the Ambush strike adds a wide violet-white cross at the hero.
  CFX.on('ambush', (ev, ctx, local) => {
    const p = ctx.player(ev.pid); if (!p || !p.stats || !p.stats.nightsEdge) return;
    F.ring(ev.x, ev.y, 34, PALE, 0.3, 3); F.ring(ev.x, ev.y, 20, VIOLET, 0.22, 2);
  });

  // Rupture: the foe bursts at once - crimson droplets for the Bleed, embers for the Burn, a ring of the splash radius.
  CFX.on('rupt', (ev, ctx, local) => {
    const m = ev.pid === local, x = ev.x, y = ev.y - 8, bleed = ev.k !== 1, burn = ev.k !== 0;
    F.ring(x, ev.y, ev.r || 60, bleed ? '#d43a3a' : '#ff8a2a', 0.34, 4);
    if (bleed) { F.burst(x, y, 12, dropOpts(BLOOD, 130)); F.burst(x, y, 6, { color: '#ff5a5a', sp: 150, life: 0.3, size: 2.4, add: true }); }
    if (burn) { F.burst(x, y, 7, { kind: 'ember', color: '#ffb347', a: -1.57, spread: 3.2, sp: 90, life: 0.8, size: 2, drag: 1.4, lt: '#ff8a2a', ltr: 24 }); F.burst(x, y, 6, { color: '#ff8a2a', sp: 120, life: 0.3, size: 2.4, add: true }); }
    SP('fx.blast.red', x, y, { ramp: bleed ? 'blood' : '', add: true, a: m ? 1 : 0.7, lt: bleed ? RED : '#ff8a2a', ltr: 60 });
    F.pop(x, y, 24, bleed ? '#ff4a4a' : '#ffb347', 0.2);
    if (m) F.addShake(1.5);
    A().play('rupt', m ? 0.8 : 0.4);
  });

  // Bloodbloom: crimson tethers from the dead foe to the two that inherit its Bleed, with droplets raining on them.
  CFX.on('bloom', (ev, ctx, local) => {
    for (const q of ev.pts || []) {
      F.bolts.push({ pts: [[ev.x, ev.y - 8], [q[0], q[1] - 8]], life: 0.35, max: 0.35, color: '#d43a5a', st: true }); if (F.bolts.length > 24) F.bolts.shift();
      F.burst(q[0], q[1] - 10, 5, dropOpts(BLOOD, 60)); F.pop(q[0], q[1] - 10, 14, '#ff5a6a', 0.16);
    }
    F.burst(ev.x, ev.y - 8, 6, dropOpts(BLOOD, 90));
  });

  // Open Veins: a crit on a foe that carries ailments throws one drop of blood per ailment (the pips under its bar show the count).
  CFX.on('hit', (ev, ctx, local) => {
    if (!ev.c) return;
    const p = ctx.player(ev.pid); if (!p || p.cls !== 'shade' || !p.stats || !(p.stats.veins > 0)) return;
    const s = ED.Game && ED.Game.s; if (!s) return;
    let best = null, bd = 900;
    for (const e of s.view.enemies) { const dx = e.x - ev.x, dy = e.y - e.r - ev.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = e; } }
    const n = best ? Math.min(4, best.ailN !== undefined ? best.ailN : s.view.ailments ? s.view.ailments(best) : 0) : 0;
    if (n) F.burst(ev.x, ev.y, 2 + 2 * n, dropOpts(BLOOD, 70 + 20 * n, 0.8));
  });

  // ---------------- hero hook: Momentum, stealth, Veil ----------------
  // Momentum: a bar of momMax segments under the hero's feet, one lit segment per stack (all white and pulsing at full), a faint violet aura that grows with the stacks and ribbons streaming behind from 3 stacks.
  // A stack gained pops; reaching full flashes a ring.
  CFX.hero.push((c, p, t, lw) => {
    if (p.cls !== 'shade' || !p.stats) return;
    const st = p.stats, local = p.pid === R().local, m = memOf(p.pid), n = p.momN | 0, cap = st.momMax | 0;
    if (n > m.n) {
      F.pop(p.x, p.y - 12, 12 + 2 * n, VIOLET, 0.14); F.burst(p.x, p.y - 12, 3, { color: PALE, sp: 70, life: 0.25, size: 1.8, add: true });
      if (n >= cap && cap > 0 && !m.full) { m.full = true; F.ring(p.x, p.y, 28, '#ffffff', 0.3, 3); F.burst(p.x, p.y - 10, 8, { color: '#ffffff', sp: 90, life: 0.4, size: 2.2, add: true }); if (local) A().play('sref', 0.35); }
    }
    if (n < cap) m.full = false;
    m.n = n;
    if (n > 0 && cap > 0 && !p.downed) {
      const full = n >= cap, sw = cap > 7 ? 2 : 4, w = cap * (sw + 2) - 2, x0 = s2(-w / 2), y0 = 10, ga = c.globalAlpha, pulse = full && Math.sin(t * 14) > 0;
      R().emit(p.x, p.y - 14, 26 + 2 * n, full ? '#d9c8ff' : '#8e5cff', 0.02 + 0.007 * n); R().light(p.x, p.y - 12, 36 + 5 * n, VIOLET, 0.15 + 0.03 * n);
      c.globalAlpha = 1; c.fillStyle = 'rgba(10,6,20,0.6)'; c.fillRect(x0 - 2, y0 - 2, w + 4, 8);
      for (let i = 0; i < cap; i++) {
        const x = x0 + i * (sw + 2);
        if (i < n) { c.fillStyle = full ? (pulse ? '#ffffff' : '#f2ecff') : PALE; c.fillRect(x, y0, sw, 2); c.fillStyle = full ? '#d9c8ff' : VIOLET; c.fillRect(x, y0 + 2, sw, 2); }
        else { c.fillStyle = '#2e2150'; c.fillRect(x, y0 + 1, sw, 2); }
      }
      c.globalAlpha = ga;
      if (n >= 3 && !lw && t > m.t) { // ribbons: streaks trailing from both hands against the facing
        m.t = t + 0.09 - 0.007 * Math.min(9, n);
        const f = p.face || 0, back = f + Math.PI;
        for (let k = -1; k <= 1; k += 2) F.part(p.x + Math.cos(f + k * 1.4) * 6, p.y - 10 + Math.sin(f + k * 1.4) * 4, { kind: 'streak', color: full ? '#ffffff' : '#c9b3ff', a: back, spread: 0.5, sp: 40 + 6 * n, life: 0.3 + 0.03 * n, size: 1.6, add: true });
      }
    }
    // stealth: a dashed violet rim under the unseen hero (allies see it through the 0.2 body alpha); Nightfall's speed leaves motes
    if (p.stealthT > 0 && !p.downed) {
      const ga = c.globalAlpha; c.globalAlpha = 1;
      Pix.put(c, Pix.ell(8, 4, VIOLET, false, 2, (t * 6) & 7), 0, 2, 0.8);
      c.globalAlpha = ga;
      if (st.stealthSpd > 0 && p.moving && !lw && t > m.t) { m.t = t + 0.07; F.part(p.x, p.y - 8, { kind: 'streak', color: '#8a86a0', a: (p.face || 0) + Math.PI, spread: 0.8, sp: 50, life: 0.3, size: 1.6, add: true }); }
    }
    // Veil of Night: a violet rim and sparkles on the shield bubble
    if (p.shield > 0 && m.veil > F.time && !p.downed) {
      const an = R().actorAnchor ? R().actorAnchor(p) : null, cy = s2(an ? an.cy : -12), ga = c.globalAlpha, fr = U.clamp(p.shield / Math.max(1, p.maxHp * 0.06), 0.2, 1), rx = 8 + Math.round(4 * fr), ry = Math.round(rx * 1.2);
      c.globalAlpha = 1;
      Pix.put(c, Pix.ell(rx + 1, ry + 1, '#8e5cff', false), 0, cy, 0.85); Pix.put(c, Pix.ell(rx + 2, ry + 2, '#b78cff', false, 3, (t * 3) & 7), 0, cy, 0.5);
      c.fillStyle = '#ffffff'; c.fillRect(s2(Math.cos(t * 2) * rx), s2(cy + Math.sin(t * 2) * ry), 2, 2);
      c.globalAlpha = ga;
    }
  });

  // ---------------- zone hook: the Afterimage decoy ----------------
  // A translucent Shade silhouette stands where the hero was, inside a dashed ring of the burst radius; as the fuse burns a ring fills in, cracks spread across the silhouette and it flashes white just before the burst.
  CFX.zone.decoy = (c, z, pass, t, k, view) => {
    const x = s2(z.x), y = s2(z.y), fuse = z.dur - z.t;
    if (pass === 0) {
      const flash = k > 0.82 && Math.sin(t * 36) > 0, a = flash ? 0.9 : 0.45 + Math.sin(t * 14) * 0.12;
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 1, '#8e5cff', VIOLET, PALE, 3, (t * 4) & 7), x, y, 0.35 + 0.4 * k);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * Math.max(0.08, k) / 2)), 1, '#8e5cff', PALE, '#ffffff'), x, y, 0.6);
      if (!Pix.draw(c, 'hero.shade.idle', flash ? 'general' : 'shadow', (t * 6.7) | 0, x, y, a)) Pix.put(c, Pix.ell(4, 6, flash ? '#e8dcff' : '#2a1f44', true), x, y - 12, a);
      if (k > 0.5) { // cracks: jagged white lines across the silhouette, more of them as the fuse burns
        const n = 1 + Math.floor((k - 0.5) * 8), sd = z.id * 7.1;
        c.fillStyle = '#ffffff'; c.globalAlpha = 0.9; c.beginPath();
        for (let i = 0; i < n; i++) { const a0 = Pix.hash(sd + i) * TAU, l = 8 + Pix.hash(sd + i * 3) * 10, bx = x + Math.cos(a0) * 3, by = y - 12 + Math.sin(a0) * 6; Pix.line(c, bx, by, bx + Math.cos(a0 + 0.5) * l * 0.5, by + Math.sin(a0 + 0.5) * l * 0.5, 2); Pix.line(c, bx + Math.cos(a0 + 0.5) * l * 0.5, by + Math.sin(a0 + 0.5) * l * 0.5, bx + Math.cos(a0) * l, by + Math.sin(a0) * l, 2); }
        c.fill(); c.globalAlpha = 1;
      }
      R().light(z.x, z.y - 10, 60 + 30 * k, VIOLET, 0.5 + 0.5 * k);
    } else if (pass === 1) {
      R().glow(c, z.x, z.y - 12, 24 + k * 24, VIOLET, 0.55 + 0.35 * k);
      if (fuse < 0.3 && fuse > 0) { // the final moment: the glow swells
        R().glow(c, z.x, z.y - 12, z.r * (1.3 - fuse), '#c9b3ff', 0.35 * (1 - fuse / 0.3));
      }
    }
  };

  // ---------------- foe mark: execution threshold ----------------
  // A blood-red skull over every foe below the Culling Blades threshold: the local hero's next weapon hit on it crits.
  CFX.mark.push((e) => {
    const s = ED.Game && ED.Game.s; if (!s) return null;
    const p = s.view.players.get(s.localPid), st = p && p.stats;
    if (!st || !(st.execCrit > 0) || !(e.hp > 0) || e.hp >= e.maxHp * st.execCrit) return null;
    return { id: 'fx.sigil.skull', ramp: 'execmark', stub: 'skull' };
  });
})(globalThis.ED || (globalThis.ED = {}));
