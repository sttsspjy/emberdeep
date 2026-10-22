// shade route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Events from src/sim/class-shade.js: exec, whirl, twincut, after, lure, sref, veil, sweep, rupt, bloom. Hero hook: Momentum pips and ribbons, stealth rim, Veil bubble. Zone hook: the Afterimage decoy. Mark hook: execution threshold.
// Attack and element forms: Killing Rhythm (a jump of 2+ Momentum stacks at once flares the hero), Guillotine (event gill: a red arc between the dead foe and the one struck), Cyclone (whirl events with c 1 are light pulses; the hero hook turns a ring of blades at full Momentum),
// Exsanguinate (the Open Veins hit spray gets a geyser on a foe with 4 ailments), Arterial Strike (event arter: a fan of blood along the blow, k 1 when it readied a crit), Bloodbloom (bloom), Crimson Cascade (event casc: a blood streak per leap).
// Skill forms: blossom (a Death Blossom blink), after with k 1 (a Hall of Mirrors image shatters), clone / cloneswing (Umbral Veil), the decoy zone's mirror (tag 1) and clone (tag 2) looks, the Eclipse dome (smoke zone tag 2, called from render.js) and its sigil over the hero.
// Everything is pixel art on the 2 world px grid (atlas sprites through FX.sheet, 2 px particles, cached Pix rings); each sprite effect is paired with particles, so it still reads without ED.ART.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, Pix = ED.Pix, F = ED.FX, CFX = ED.ClassFx, s2 = Pix.s2, N = ED.Net;
  const SP = (id, x, y, o) => F.sheet(id, x, y, o);
  const VIOLET = '#b78cff', PALE = '#e8dcff', BLOOD = '#c01830', RED = '#ff3a4a';
  const A = () => ED.Audio, R = () => ED.Render;
  const low = () => !!R() && R().quality === 'low';
  Object.assign(N.CAPS, { blossom: 8, clone: 3, cloneswing: 6 }); Object.assign(N.CAPS_LOCAL, { blossom: 4, clone: 2, cloneswing: 3 }); // a chain makes up to 6 blinks; clone attacks follow the hero's
  Object.assign(N.CAPS, { gill: 8, arter: 8, casc: 12, whirl: 6 }); Object.assign(N.CAPS_LOCAL, { gill: 3, arter: 3, casc: 5, whirl: 3 }); // Guillotine carries, Arterial sprays, Cascade leaps, spins (a Cyclone spin comes with every attack)
  Pix.RAMP.execmark = ['#2a0408', '#6a0c18', '#c01830', '#e8283c', '#ff5a68']; // the skull of an executable foe: deep red, never white
  const dropOpts = (col, sp, life) => ({ kind: 'drop', color: col || BLOOD, sp: sp || 90, vz: 90, z: 8, life: life || 0.7, size: 2.4 });
  const pick = (a) => a[(Math.random() * a.length) | 0];
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
    if (ev.c) { // a Cyclone spin (every attack, the end of a dash): a thin ring and a few streaks, no sound beyond a soft tick
      F.ring(ev.x, ev.y, Math.max(26, ev.r), '#c9b3ff', 0.16, 2);
      if (ev.k === 1) for (let i = 0; i < 6; i++) { const a = i * TAU / 6; F.burst(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 1, { kind: 'streak', color: PALE, a, spread: 0.1, sp: 280, life: 0.2, size: 1.6 }); }
      else F.burst(x, y, 3, { kind: 'streak', color: PALE, a: Math.random() * TAU, spread: 3, sp: Math.max(60, ev.r) * 2.4, life: 0.14, size: 1.6, drag: 4 });
      if (m) A().play('whirl', 0.1);
      return;
    }
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
    if (ev.k === 1) { // a Hall of Mirrors image shatters: a pale ring, a spray of glass and a white flash (three of these land together)
      F.ring(ev.x, ev.y, r, '#dfe8ff', 0.36, 4); F.ring(ev.x, ev.y, r * 0.5, '#ffffff', 0.22, 2);
      F.burst(ev.x, ev.y - 10, low() ? 8 : 16, { kind: 'shard', color: pick(['#ffffff', '#c9d6ff', PALE]), sp: r * 2.2, life: 0.6, size: 2.6, vz: 120, z: 8, add: true });
      F.burst(ev.x, ev.y - 8, 6, { kind: 'streak', color: '#ffffff', sp: r * 2.6, life: 0.22, size: 1.8 }); F.pop(ev.x, ev.y - 10, r * 0.5, '#dfe8ff', 0.2, true);
      if (m) { F.addShake(1.6); F.punch(0.3, 0); }
      A().play('shatter', m ? 0.35 : 0.2); A().play('rift', m ? 0.25 : 0.12);
      return true;
    }
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

  // Night's Edge hits harder: the Ambush strike adds a wide violet-white cross at the hero. Eclipse: every attack is one, so inside the dome they are a quick pale crescent flick instead.
  CFX.on('ambush', (ev, ctx, local) => {
    const p = ctx.player(ev.pid); if (!p || !p.stats || !p.stats.nightsEdge) return;
    if (p.stats.eclipse > 0 && p.dome !== undefined && p.ambFac < 1) return;
    F.ring(ev.x, ev.y, 34, PALE, 0.3, 3); F.ring(ev.x, ev.y, 20, VIOLET, 0.22, 2);
  });

  // ---------------- skill forms ----------------
  // Death Blossom: each blink draws a violet line from where the hero stood to where it lands, leaves a fading silhouette there, and opens a petalled X on the foe it cut (higher chime with every blink).
  CFX.on('blossom', (ev, ctx, local) => {
    const m = ev.pid === local, a = Math.atan2(ev.ty - ev.y0, ev.tx - ev.x0), x = ev.tx, y = ev.ty - 8;
    F.bolts.push({ pts: [[ev.x0, ev.y0 - 8], [ev.x1, ev.y1 - 8]], life: 0.2, max: 0.2, color: PALE, st: true }); if (F.bolts.length > 24) F.bolts.shift();
    SP('hero.shade.idle', ev.x1, ev.y1, { ramp: 'shadow', frame: ev.n, life: 0.34, fade: true, a: 0.6 });
    F.slash(x, y, a + 0.95, 46, 1.6, VIOLET, 0.24); F.slash(x, y, a - 0.95, 46, 1.6, PALE, 0.24); F.slash(x, y, a + Math.PI / 2, 38, 1.4, '#ffffff', 0.2); // a six-petal star
    SP('fx.cutx', x, y, { ramp: 'shadow', add: true, a: m ? 1 : 0.7, lt: VIOLET, ltr: 60 });
    F.burst(x, y, low() ? 7 : 14, { kind: 'shard', color: pick([PALE, VIOLET, '#ffffff']), sp: 170, life: 0.55, size: 2.6, vz: 60, z: 4, add: true, drag: 1.4 });
    F.pop(x, y, 28, VIOLET, 0.2, true); F.ring(x, ev.ty, 22 + 4 * ev.n, PALE, 0.28, 2); F.ring(ev.x1, ev.y1, 16 + 3 * ev.n, VIOLET, 0.24, 2);
    if (m) { F.hitStop(0.03); F.addShake(1.2 + 0.3 * ev.n); }
    A().play('blossom', m ? 0.8 : 0.4, ev.n);
  });
  // Umbral Veil: the clone splits off the hero in a puff of shadow.
  CFX.on('clone', (ev, ctx, local) => {
    const m = ev.pid === local;
    F.ring(ev.x, ev.y, 34, VIOLET, 0.4, 3); F.burst(ev.x, ev.y - 10, 10, { kind: 'smoke', color: '#241a3a', sp: 60, life: 0.6, size: 6, drag: 2.5 });
    F.burst(ev.x, ev.y - 10, 8, { color: VIOLET, sp: 70, life: 0.4, size: 2.4, add: true }); SP('fx.smoke.ring', ev.x, ev.y + 2, { ramp: 'shadow' });
    A().play('umbral', m ? 0.7 : 0.35);
  });
  // The clone's own swing (re-addressed from the hero's by the sim): a darker slash from the clone's spot.
  CFX.on('cloneswing', (ev, ctx, local) => {
    F.slash(ev.x, ev.y - 10, ev.a, ev.r, ev.arc, '#8e5cff', 0.2); F.pop(ev.x, ev.y - 10, 10, VIOLET, 0.1);
    A().play('swing', ev.pid === local ? 0.2 : 0.1);
  });
  // Eclipse: the dome rises with Vanish - a dark ring races out, a low tone, a pale flash for the owner.
  CFX.on('skill', (ev, ctx, local) => {
    if (ev.k !== 'vanish' || !ev.dome) return;
    const m = ev.pid === local, r = 140;
    F.ring(ev.x, ev.y, r, '#6a4cc0', 0.5, 6); F.ring(ev.x, ev.y, r * 0.6, PALE, 0.4, 2);
    F.burst(ev.x, ev.y - 8, 14, { color: VIOLET, sp: r * 1.6, life: 0.6, size: 3, add: true });
    if (m) { F.punch(0.5, 0.2); F.addShake(2); }
    A().play('eclipse', m ? 0.8 : 0.4);
  });

  // Guillotine: the dead foe's blow carries on - a red arc leaps from it to the next weak foe, a bright blade streak falls on the target (its X cut comes with the exec event).
  CFX.on('gill', (ev, ctx, local) => {
    const m = ev.pid === local, d = Math.hypot(ev.x1 - ev.x0, ev.y1 - ev.y0), my = (ev.y0 + ev.y1) / 2 - 8 - Math.min(34, d * 0.4), mx = (ev.x0 + ev.x1) / 2, pts = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6, v = 1 - u; pts.push([v * v * ev.x0 + 2 * u * v * mx + u * u * ev.x1, v * v * (ev.y0 - 8) + 2 * u * v * my + u * u * (ev.y1 - 8)]); }
    F.bolts.push({ pts, life: 0.28, max: 0.28, color: RED, st: true }); if (F.bolts.length > 24) F.bolts.shift();
    F.burst(ev.x1, ev.y1 - 34, 3, { kind: 'streak', color: '#ffffff', a: Math.PI / 2, spread: 0.06, sp: 560, life: 0.12, size: 1.8 });
    F.burst(ev.x0, ev.y0 - 8, 5, dropOpts(BLOOD, 80)); F.pop(ev.x1, ev.y1 - 8, 16, '#ff4a4a', 0.14);
    A().play('exec', m ? 0.3 : 0.15);
  });

  // Arterial Strike: the blow opens an artery - a fan of blood droplets and streaks along the hero's blow; when it readied a crit (k 1) a red ring closes on the hero.
  CFX.on('arter', (ev, ctx, local) => {
    const m = ev.pid === local, a = ev.a || 0, x = ev.x, y = ev.y - 8;
    F.burst(x, y, low() ? 6 : 12, { kind: 'drop', color: BLOOD, a, spread: 0.7, sp: 200, vz: 70, z: 8, life: 0.7, size: 2.4 });
    F.burst(x, y, 5, { kind: 'streak', color: '#ff5a68', a, spread: 0.35, sp: 340, life: 0.24, size: 1.8 });
    F.pop(x, y, 14, '#ff4a4a', 0.12);
    if (!ev.k) return;
    const p = ctx.player(ev.pid); if (!p) return;
    F.ring(p.x, p.y, 22, RED, 0.3, 3, true); F.burst(p.x, p.y - 12, 4, { color: '#ff5a68', sp: 60, vy: -50, life: 0.5, size: 2, add: true, drag: 1.4 });
    if (m) { F.text(p.x, p.y - 42, 'Crit ready', '#ff7a7a', 9, { pop: true, life: 0.8, max: 0.8 }); A().play('sref', 0.3); }
  });

  // Crimson Cascade: the rupture leaps - a thick blood streak from the dead foe to the next one, droplets along it, a spray where it lands (the burst comes with the rupt event); the chime climbs with every leap.
  CFX.on('casc', (ev, ctx, local) => {
    const m = ev.pid === local, a = Math.atan2(ev.y1 - ev.y0, ev.x1 - ev.x0);
    F.bolts.push({ pts: [[ev.x0, ev.y0 - 8], [ev.x1, ev.y1 - 8]], life: 0.3, max: 0.3, color: '#d43a5a', st: true }); if (F.bolts.length > 24) F.bolts.shift();
    for (let i = 1; i <= 3; i++) F.burst(U.lerp(ev.x0, ev.x1, i / 4), U.lerp(ev.y0, ev.y1, i / 4) - 8, 1, dropOpts(BLOOD, 40, 0.5));
    F.burst(ev.x1, ev.y1 - 8, low() ? 3 : 6, { kind: 'streak', color: '#ff5a68', a, spread: 0.6, sp: 260, life: 0.2, size: 1.8 });
    F.pop(ev.x0, ev.y0 - 8, 14, '#ff4a4a', 0.12);
    A().play('blossom', m ? 0.5 : 0.25, ev.n);
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
    if (n >= 4 && p.stats.exsang > 0) { // Exsanguinate: the foe's fourth ailment turns the wound into a geyser
      F.burst(ev.x, ev.y, low() ? 5 : 10, { kind: 'drop', color: BLOOD, a: -Math.PI / 2, spread: 0.5, sp: 130, vz: 150, z: 8, life: 0.9, size: 2.4 });
      F.ring(ev.x, ev.y + 8, 16, '#d43a3a', 0.26, 2);
    }
  });

  // ---------------- hero hook: Momentum, stealth, Veil ----------------
  // Momentum: a bar of momMax segments under the hero's feet, one lit segment per stack (all white and pulsing at full), a faint violet aura that grows with the stacks and ribbons streaming behind from 3 stacks.
  // A stack gained pops; reaching full flashes a ring.
  CFX.hero.push((c, p, t, lw) => {
    if (p.cls !== 'shade' || !p.stats) return;
    const st = p.stats, local = p.pid === R().local, m = memOf(p.pid), n = p.momN | 0, cap = st.momMax | 0;
    if (n > m.n) {
      F.pop(p.x, p.y - 12, 12 + 2 * n, VIOLET, 0.14); F.burst(p.x, p.y - 12, 3, { color: PALE, sp: 70, life: 0.25, size: 1.8, add: true });
      if (n - m.n >= 2 && st.execMom > 0) { F.ring(p.x, p.y, 34, RED, 0.3, 3); F.burst(p.x, p.y - 12, 8, { color: '#ff5a68', sp: 110, life: 0.4, size: 2.2, add: true }); if (local) A().play('sref', 0.35); } // Killing Rhythm: an execution kill adds several stacks at once
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
    // Cyclone: at full Momentum six blades with fading tails turn round the hero on the spin's own radius
    if (st.cyclone > 0 && cap > 0 && n >= cap && !p.downed) {
      const wp = st.weapon, R0 = wp && wp.kind === 'melee' ? U.clamp(wp.range * (1 + st.area * 0.5 + st.meleeReach), 28, 70) : 40, ga = c.globalAlpha;
      for (let i = 0, nb = lw ? 3 : 6; i < nb; i++) {
        const base = t * 9 + i * TAU / nb;
        for (let k = 0; k < 4; k++) {
          const a = base - k * 0.18, sz = k === 0 ? 4 : 2;
          c.globalAlpha = (1 - k / 4) * 0.9; c.fillStyle = k === 0 ? '#ffffff' : k < 2 ? PALE : VIOLET;
          c.fillRect(s2(Math.cos(a) * R0) - sz / 2, s2(Math.sin(a) * R0 * 0.5 - 6) - sz / 2, sz, sz);
        }
      }
      c.globalAlpha = ga;
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
    // Eclipse: a small pale ring turns over the head while an Ambush is held ready
    if (st.eclipse > 0 && p.ambush && !p.downed) { const an = R().actorAnchor ? R().actorAnchor(p) : null, ga = c.globalAlpha; c.globalAlpha = 1; Pix.put(c, Pix.ring(4, 1, '#2e1a5a', VIOLET, '#ffffff', 3, (t * 8) & 7), 0, s2(an ? an.top : -26) - 8, 0.85); c.globalAlpha = ga; }
  });

  // ---------------- zone hook: the Afterimage decoy ----------------
  // A translucent Shade silhouette stands where the hero was, inside a dashed ring of the burst radius; as the fuse burns a ring fills in, cracks spread across the silhouette and it flashes white just before the burst.
  CFX.zone.decoy = (c, z, pass, t, k, view) => {
    const x = s2(z.x), y = s2(z.y), fuse = z.dur - z.t;
    if (z.w === 2) return cloneBody(c, z, pass, t, k, x, y);
    if (z.w === 1) return mirrorBody(c, z, pass, t, k, view, x, y, fuse);
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

  // Hall of Mirrors image (decoy zone, tag 1): a pale pane with the hero's silhouette in silver, the burst radius dashed on the ground, a thin pale triangle joining the three images, cracks as the fuse burns and a white flicker before it shatters.
  function mirrorBody(c, z, pass, t, k, view, x, y, fuse) {
    const fade = Math.min(1, z.t * 5);
    if (pass === 0) {
      const flash = k > 0.85 && Math.sin(t * 40) > 0, a = (flash ? 0.95 : 0.7 + Math.sin(t * 10 + z.id) * 0.1) * fade;
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 1, '#7a86c8', '#c9d6ff', '#ffffff', 3, (t * 3) & 7), x, y, (0.28 + 0.4 * k) * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r * Math.max(0.08, k) / 2)), 1, '#7a86c8', '#ffffff', '#ffffff'), x, y, 0.5 * fade);
      c.globalAlpha = 0.3 * fade; c.fillStyle = '#c9d6ff'; c.fillRect(x - 8, y - 32, 16, 32); c.globalAlpha = 0.8 * fade; c.fillStyle = '#ffffff'; c.fillRect(x - 8, y - 32, 2, 32); c.fillRect(x - 8, y - 32, 16, 2); c.fillRect(x + 6, y - 32, 2, 32); c.globalAlpha = 1;
      if (!Pix.draw(c, 'hero.shade.idle', 'general', (t * 6.7) | 0, x, y, a)) Pix.put(c, Pix.ell(4, 6, flash ? '#ffffff' : '#c9d6ff', true), x, y - 12, a);
      if (k > 0.3) { // cracks across the pane
        const n = 1 + Math.floor((k - 0.3) * 9), sd = z.id * 5.3;
        c.fillStyle = '#ffffff'; c.globalAlpha = 0.9 * fade; c.beginPath();
        for (let i = 0; i < n; i++) { const a0 = Pix.hash(sd + i) * TAU, l = 8 + Pix.hash(sd + i * 3) * 12, bx = x + Math.cos(a0) * 3, by = y - 16 + Math.sin(a0) * 8; Pix.line(c, bx, by, bx + Math.cos(a0 + 0.6) * l * 0.5, by + Math.sin(a0 + 0.6) * l * 0.5, 2); Pix.line(c, bx + Math.cos(a0 + 0.6) * l * 0.5, by + Math.sin(a0 + 0.6) * l * 0.5, bx + Math.cos(a0) * l, by + Math.sin(a0) * l, 2); }
        c.fill(); c.globalAlpha = 1;
      }
      R().light(z.x, z.y - 10, 50 + 24 * k, '#c9d6ff', (0.3 + 0.45 * k) * fade);
    } else if (pass === 1) {
      R().glow(c, z.x, z.y - 14, 20 + k * 20, '#dfe8ff', (0.22 + 0.3 * k) * fade);
      if (view) { // the triangle: each image draws its lines to the images of the same cast that came after it
        c.fillStyle = '#dfe8ff'; c.globalAlpha = 0.28 * fade; c.beginPath();
        for (const o of view.zones) if (o !== z && o.kind === 'decoy' && o.w === 1 && o.owner === z.owner && o.id > z.id) Pix.line(c, z.x, z.y - 4, o.x, o.y - 4, 2);
        c.fill(); c.globalAlpha = 1;
      }
    }
  }
  // Umbral Veil clone (decoy zone, tag 2): the hero's shadow standing where Vanish was cast, flickering, ringed in violet, shadow motes rising; it fades in and out.
  function cloneBody(c, z, pass, t, k, x, y) {
    const fade = Math.min(1, z.t * 4, (z.dur - z.t) * 2.5), flick = 0.72 + 0.14 * Math.sin(t * 9 + z.id);
    if (fade <= 0.01) return;
    if (pass === 0) {
      Pix.put(c, Pix.ell(6, 3, '#0a0414', true), x, y, 0.45 * fade);
      Pix.put(c, Pix.ell(9, 4, VIOLET, false, 2, (t * 4) & 7), x, y + 2, 0.75 * fade);
      if (!Pix.draw(c, 'hero.shade.idle', 'shadow', (t * 6.7) | 0, x, y, flick * fade)) Pix.put(c, Pix.ell(4, 6, '#2a1f44', true), x, y - 12, flick * fade);
      R().light(z.x, z.y - 10, 56, VIOLET, 0.4 * fade);
    } else if (pass === 1) {
      R().glow(c, z.x, z.y - 12, 24, VIOLET, 0.35 * fade);
      c.fillStyle = PALE;
      for (let i = 0; i < 3; i++) { const kk = (t * 0.7 + i / 3 + z.id * 0.13) % 1; c.globalAlpha = Math.max(0.25, Math.ceil((1 - kk) * 4) / 4) * fade; c.fillRect(s2(z.x + Math.sin(t * 2 + i * 2.1) * 6), s2(z.y - 6 - kk * 32), 2, 2); }
      c.globalAlpha = 1;
    }
  }
  // Eclipse dome (smoke zone, tag 2, called from render.js): a dark disc with the bright rim of an eclipse, twinkling stars inside, a faint violet corona.
  CFX.zone.dome = (c, z, pass, t) => {
    const fade = Math.min(1, (z.dur - z.t) * 1.5, z.t * 4), x = s2(z.x), y = s2(z.y), ra = Math.max(2, Math.round(z.r / 2));
    if (fade <= 0.01) return;
    if (pass === 0) {
      Pix.put(c, Pix.disc(ra, '#06030f'), x, y, 0.36 * fade); Pix.put(c, Pix.disc(Math.max(1, Math.round(ra * 0.62)), '#0a0418'), x, y, 0.3 * fade);
      Pix.put(c, Pix.ring(ra, 3, '#2e1a5a', VIOLET, PALE, 5, (-t * 3) & 7), x, y, 0.9 * fade);
      c.fillStyle = PALE;
      for (let i = 0, n = low() ? 9 : 22; i < n; i++) { // stars at fixed spots of the dome, each twinkling on its own beat
        const a = Pix.hash(z.id * 3.1 + i) * TAU, d = Math.sqrt(Pix.hash(z.id * 7.3 + i * 1.9)) * z.r * 0.92;
        const big = (i % 5) === 0, sx = s2(z.x + Math.cos(a) * d), sy = s2(z.y + Math.sin(a) * d * 0.9);
        c.globalAlpha = (Math.sin(t * 2.6 + i * 1.9) > 0.1 ? 1 : 0.3) * fade; c.fillRect(sx, sy, 2, 2);
        if (big) { c.fillRect(sx - 2, sy, 6, 2); c.fillRect(sx, sy - 2, 2, 6); } // a few stars are crosses
      }
      c.globalAlpha = 1;
      R().light(z.x, z.y, z.r * 1.25, '#6a4cc0', 0.3 * fade);
    } else if (pass === 1) R().glow(c, z.x, z.y, z.r * 1.08, '#8e5cff', 0.14 * fade);
  };

  // ---------------- foe mark: execution threshold ----------------
  // A blood-red skull over every foe below the Culling Blades threshold: the local hero's next weapon hit on it crits.
  CFX.mark.push((e) => {
    const s = ED.Game && ED.Game.s; if (!s) return null;
    const p = s.view.players.get(s.localPid), st = p && p.stats;
    if (!st || !(st.execCrit > 0) || !(e.hp > 0) || e.hp >= e.maxHp * st.execCrit) return null;
    return { id: 'fx.sigil.skull', ramp: 'execmark', stub: 'execskull' };
  });
})(globalThis.ED || (globalThis.ED = {}));
