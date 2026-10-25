// Minigames on the client (src/sim/minigames.js): MinigameFx.draw(c, p, R, view, t, G, L, art) draws an mg_* prop at its feet (c is translated there; G / L queue its halo and light) and returns true;
// prompt / desc give its interaction texts (render.js propPrompt / propDesc). The wisp zone kind and the 'mg' events register with ED.ClassFx (fx.js). Art sits on the 2-px grid: pack sprites where the pack has one, pixel shapes otherwise.
(function (ED) {
  'use strict';
  const U = ED.U, MG = ED.Minigames, X = ED.MinigameFx = {};
  const s2 = (v) => Math.round(v / 2) * 2;
  const secs = (end) => Math.max(0, Math.ceil(end - ED.Render.simT)) + 's';
  const BELL_COL = ['#ff6a5a', '#ffd36b', '#6fd8ff', '#9be36a'], BELL_ST = [0, 4, 7, 12]; // echo bells by index: colour and the 'bell' cue's semitones
  const GOLD = '#ffd36b', RED = '#ff6a5a', DIM = '#b8a890';
  for (const k of ['mg_gauntlet', 'mg_chest', 'mg_dealer', 'mg_herald', 'mg_lantern', 'mg_echo']) ED.Render.KEEP_USED.add(k); // these keep drawing their used look once state turns 1
  const flash = new Map(); // 'bell' + index -> sim time of its last hit flash; 'bad' + index -> a wrong hit
  const find = (view, kind) => { for (const q of view.props) if (q.kind === kind) return q; return null; };
  const has = (art, id) => art && ED.Atlas && ED.Atlas.has(id);
  const rect = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  // ---------------- texts ----------------
  const gauntTier = (gold, hits) => { const t = MG.GAUNT_PRIZE[Math.min(hits, MG.GAUNT_PRIZE.length - 1)], g = Math.round(gold * t.g); return g + ' gold' + (t.relic === 'r' ? ' and a rare relic' : t.relic ? ' and a relic' : ''); };
  X.prompt = (p, view) => {
    const g = p.g;
    switch (p.kind) {
      case 'mg_gauntlet': return `Run the gauntlet (${g.dur}s)`;
      case 'mg_chest': return 'Claim your prize';
      case 'mg_dealer': return `Bet ${g.s} gold: find the pearl`;
      case 'mg_cup': return 'Pick this cup';
      case 'mg_herald': return `Wager ${g.s} gold on a duel`;
      case 'mg_lantern': return `Light the lantern (${g.d}s)`;
      case 'mg_echo': return 'Strike the echo stone';
      default: return null;
    }
  };
  X.desc = (p, view) => {
    const g = p.g;
    switch (p.kind) {
      case 'mg_gauntlet': return `Cross the traps to the chest within ${g.dur}s. Unhurt: ${gauntTier(g.gold, 0)}. 1 hit: ${gauntTier(g.gold, 1)}. 2 hits: ${gauntTier(g.gold, 2)}. 3 hits: ${gauntTier(g.gold, 3)}. More: ${gauntTier(g.gold, 4)}. Each hero claims their own prize; walk out a door to skip.`;
      case 'mg_chest': { const post = find(view, 'mg_gauntlet'), h = post && post.g.h ? post.g.h[ED.Render.local] | 0 : 0; return `${h} ${h === 1 ? 'hit' : 'hits'} taken: ${gauntTier(g.gold, h)}.`; }
      case 'mg_dealer': return `Watch the pearl, then pick its cup. Round ${g.r} of 3, each faster. Win: ${g.r < 3 ? g.s * 2 + ' gold' : 'a rare relic and the stake back'}. Party gold; walk out a door to skip.`;
      case 'mg_cup': return 'Is the pearl under this one?';
      case 'mg_herald': { const e = ED.ENEMIES[g.ty]; return `A ${g.af.map(a => ED.AFFIXES[a].name).join(', ')} ${e ? e.name : 'champion'} within ${g.d}s, nobody going down: win ${Math.round(g.s * g.m)} gold (x${g.m}). Lose: the stake. The doors lock until it ends.`; }
      case 'mg_lantern': return `Catch ${g.n} wisps in ${g.d}s: ${g.per} gold each. All of them: +${g.hp} max health for every hero.`;
      case 'mg_echo': return `The bells ring a tune: strike them in the same order. Three rounds of 3, 4 and 5 notes, ${g.gold} gold each; all three: a boon for every hero. A wrong bell ends it.`;
      default: return null;
    }
  };

  // ---------------- props ----------------
  let hoodOk = false;
  const swapAt = { t0: -1, k: -1 }; // the shell game's last swap that played its whoosh (shuffle start, swap index)
  X.draw = (c, p, R, view, t, G, L, art) => {
    const g = p.g;
    if (!g || p.kind.indexOf('mg_') !== 0) return false;
    const A = ED.Atlas, Sp = ED.Sprites, tl = R.simT;
    switch (p.kind) {
      case 'mg_gauntlet': {
        Sp.shadow(c, 9, 0.3);
        if (has(art, 'prop.sign')) A.draw(c, 'prop.sign', 0, 0, 0);
        else { rect(c, '#5a4a3a', -2, -12, 3, 12); rect(c, '#8a6a4a', -11, -22, 22, 12); }
        rect(c, RED, -2, -21, 4, 6); rect(c, RED, -2, -13, 4, 2); // the warning mark
        if (g.ph === 0) { G(0, -18, 24, RED, 0.45); L(0, -18, 80, RED, 0.6); }
        if (g.ph === 1) { R.label(c, secs(g.end), 0, -34, RED); const h = g.h && g.h[R.local] | 0; if (h) R.label(c, h + (h === 1 ? ' hit' : ' hits'), 0, -46, DIM); }
        return true;
      }
      case 'mg_chest': {
        Sp.shadow(c, 14);
        const mine = R.claimed && R.claimed[p.group], open = p.state || mine;
        if (open) c.globalAlpha *= 0.5;
        if (has(art, 'prop.chest.closed')) A.draw(c, open ? 'prop.chest.empty' : 'prop.chest.closed', open ? 2 : 0, 0, 0);
        else { rect(c, '#7a4a22', -14, -14, 28, 14); rect(c, '#c9a640', -14, -9, 28, 3); }
        if (!open && !g.ni) { G(0, -10, 30 + Math.sin(t * 3) * 4, GOLD, 0.45); L(0, -10, 90, GOLD, 0.7); }
        if (!open && !g.ni) { const post = find(view, 'mg_gauntlet'), h = post && post.g.h ? post.g.h[R.local] | 0 : 0; R.label(c, gauntTier(g.gold, h), 0, -34, GOLD); }
        return true;
      }
      case 'mg_dealer': {
        Sp.shadow(c, 11);
        G(0, -16, 30, '#b48cff', 0.35); L(0, -16, 90, '#b48cff', 0.55);
        if (has(art, 'prop.merchant')) {
          if (!hoodOk) hoodOk = A.variant('prop.merchant', 'pal:hood', () => ({ '#314152': '#24182e', '#417089': '#4a2f5e' })); // the dealer's hood in dusk violet
          A.draw(c, 'prop.merchant', A.frameAt('prop.merchant', t), 0, 0, hoodOk ? { variant: 'pal:hood' } : undefined);
        } else {
          c.fillStyle = '#3a2a4a'; c.beginPath(); c.moveTo(-9, 0); c.lineTo(-7, -18); c.quadraticCurveTo(0, -30, 7, -18); c.lineTo(9, 0); c.closePath(); c.fill();
          rect(c, '#140c1a', -4, -22, 8, 6); rect(c, GOLD, -3, -20, 2, 2); rect(c, GOLD, 1, -20, 2, 2);
        }
        if (g.ph === 1 && g.d > 0 && g.sw) { // each swap of the shuffle starts with a whoosh (the swaps run on the dealer payload's clock, MG.cupAt)
          const k = Math.floor((tl - g.t0) / g.d);
          if (swapAt.t0 !== g.t0) { swapAt.t0 = g.t0; swapAt.k = -1; }
          if (k >= 0 && k < g.sw.length / 2 && k > swapAt.k) { swapAt.k = k; ED.Audio.play('shellswap', 0.8, g.r | 0); }
        }
        const lab = g.ph === 1 ? ['Watch the pearl', GOLD] : g.ph === 2 ? ['...', DIM] : g.ph === 3 ? ['Pick a cup ' + secs(g.end), GOLD] : g.ph === 4 ? [g.res === 1 ? 'Found it!' : 'Empty!', g.res === 1 ? GOLD : RED] : g.ph === 0 && g.r > 1 ? ['Round ' + g.r + '?', GOLD] : null;
        if (lab) R.label(c, lab[0], 0, -40, lab[1]);
        return true;
      }
      case 'mg_cup': {
        const d = find(view, 'mg_dealer'), dg = d && d.g;
        let dx = 0, dy = 0, lift = 0;
        if (dg && (dg.ph === 1 || dg.ph === 2)) { const pt = MG.cupAt(dg, g.c, tl); dx = s2(pt.x - p.x); dy = s2(pt.y - p.y); }
        const pearl = dg && dg.pe === g.c;
        if (dg && ((dg.ph === 1 && pearl) || dg.ph === 4)) lift = 12;
        c.translate(dx, dy);
        Sp.shadow(c, 9, 0.35);
        if (pearl && lift) { ED.Pix.put(c, ED.Pix.orb(3, '#3a3a4a', '#c8c8dc', '#eeeefa', '#ffffff'), 0, -6); G(0, -6, 14, '#f4f4ff', 0.7); }
        const pick = dg && dg.ph === 3, sel = dg && dg.ph === 4 && dg.pk === g.c;
        if (pick) { G(0, -10 - lift, 20, GOLD, 0.35 + Math.sin(t * 6) * 0.15); }
        const CUP = [8, 12, 12, 14, 14, 14, 16, 18]; // row widths: a domed top, straight sides, a flared rim
        for (let r = 0; r < 8; r++) { const w = CUP[r], y = -20 - lift + r * 2; rect(c, '#8a5a2a', -w / 2, y, w, 2); rect(c, '#c48a4a', -w / 2, y, 2, 2); rect(c, '#5e3c1c', w / 2 - 2, y, 2, 2); }
        rect(c, '#4a2e14', -10, -4 - lift, 20, 2); rect(c, '#e0a860', -2, -18 - lift, 4, 2); rect(c, '#5e3c1c', -8, -12 - lift, 16, 2); // rim shadow, glint and a band
        if (sel) R.label(c, dg.res === 1 ? 'Pearl!' : 'Empty', 0, -32 - lift, dg.res === 1 ? GOLD : RED);
        return true;
      }
      case 'mg_herald': {
        Sp.shadow(c, 12);
        if (has(art, 'prop.trial')) A.draw(c, 'prop.trial', 0, 0, 0);
        else { rect(c, '#4a4a52', -6, -30, 12, 30); rect(c, GOLD, -10, -40, 20, 3); }
        if (!p.state) { G(0, -28, 30, GOLD, 0.5); L(0, -28, 100, GOLD, 0.7); }
        if (g.ph === 2) R.label(c, secs(g.end) + '  x' + g.m, 0, -50, GOLD);
        else if (g.ph === 3) R.label(c, 'Won', 0, -50, GOLD);
        else if (g.ph === 4) R.label(c, 'Lost', 0, -50, RED);
        return true;
      }
      case 'mg_lantern': {
        Sp.shadow(c, 7, 0.3);
        const lit = g.ph === 1, done = g.ph === 2, fl = lit ? 0.85 + Math.sin(t * 11) * 0.08 : done ? 0.25 : 0.55;
        rect(c, '#2a221c', -1, -30, 3, 30); rect(c, '#2a221c', -5, -2, 11, 2); // post and foot
        rect(c, '#1a1410', -6, -42, 13, 12); rect(c, '#4a3a24', -5, -44, 11, 2); // housing and cap
        rect(c, U.mix('#3a2a10', '#ffe7a0', fl), -4, -40, 9, 8); rect(c, '#fff8e0', -1, -38, 3, 4);
        G(0, -36, 22, '#ffd36b', fl); L(0, -36, done ? 60 : 130, '#ffcf6a', fl);
        if (lit) R.label(c, `${g.c}/${g.n}  ${secs(g.end)}`, 0, -54, GOLD);
        else if (done) R.label(c, `${g.c}/${g.n}`, 0, -54, DIM);
        return true;
      }
      case 'mg_echo': {
        Sp.shadow(c, 10, 0.35);
        rect(c, '#4e484a', -8, -26, 16, 26); rect(c, '#6a6466', -8, -26, 3, 26); rect(c, '#3a3436', -10, -2, 20, 2);
        const k = g.ph === 1 && g.st > 0 ? Math.floor((tl - g.t0) / g.st) : -1, on = k >= 0 && k < g.sq.length && (tl - g.t0) / g.st - k < 0.8 ? g.sq[k] : -1;
        const rune = on >= 0 ? BELL_COL[on] : g.ph === 0 ? '#c8b8ff' : g.ph === 4 ? (g.res === 1 ? GOLD : '#5a5050') : '#8a80a0';
        rect(c, rune, -2, -20, 4, 2); rect(c, rune, -4, -16, 8, 2); rect(c, rune, -2, -12, 4, 2);
        if (g.ph !== 4) { G(0, -16, 18, rune, 0.5); L(0, -16, 70, rune, 0.5); }
        const lab = g.ph === 1 ? ['Listen', DIM] : g.ph === 2 ? [`${g.ok}/${g.sq.length}  ${secs(g.end)}`, GOLD] : g.ph === 3 ? ['Again, longer', GOLD] : null;
        if (lab) R.label(c, lab[0], 0, -38, lab[1]);
        return true;
      }
      case 'mg_bell': {
        const st = find(view, 'mg_echo'), sg = st && st.g, i = g.i, col = BELL_COL[i];
        let lit = 0;
        if (sg && sg.ph === 1 && sg.st > 0) { const k = Math.floor((tl - sg.t0) / sg.st); if (k >= 0 && k < sg.sq.length && sg.sq[k] === i && (tl - sg.t0) / sg.st - k < 0.8) lit = 1; }
        const fa = flash.get('bell' + i), fb = flash.get('bad' + i);
        if (fa !== undefined && tl - fa < 0.35) lit = Math.max(lit, 1 - (tl - fa) / 0.35);
        const swing = lit ? Math.sin(t * 22) * 2 * lit : 0, bad = fb !== undefined && tl - fb < 0.5;
        Sp.shadow(c, 9, 0.3);
        rect(c, '#3a2a1c', -11, -32, 2, 32); rect(c, '#3a2a1c', 9, -32, 2, 32); rect(c, '#5a4030', -12, -34, 24, 3); // the frame
        const body = bad ? '#5a4a4a' : lit ? U.mix(col, '#ffffff', 0.35 * lit) : U.shade(col, -0.3), dark = U.shade(col, -0.55);
        c.save(); c.translate(s2(swing), 0);
        rect(c, dark, -2, -31, 4, 3);
        const BELL = [6, 8, 10, 10, 10, 12, 16]; // row widths: shoulder, waist, flared lip
        for (let r = 0; r < 7; r++) { const w = BELL[r], y = -28 + r * 2; rect(c, body, -w / 2, y, w, 2); rect(c, dark, -w / 2, y, 2, 2); }
        rect(c, dark, -2, -14, 4, 3); // the clapper
        c.restore();
        if (lit) { G(0, -22, 26, col, 0.8 * lit); L(0, -22, 110, col, 1.2 * lit); } else { G(0, -22, 12, col, 0.25); L(0, -22, 40, col, 0.3); }
        return true;
      }
      default: return false;
    }
  };

  // ---------------- wisps (zone kind 'wisp'): smoothed between snapshots, a warm orb that bobs ----------------
  const wispAt = new Map();
  ED.ClassFx.zone.wisp = (c, z, pass, t) => {
    let o = wispAt.get(z.id);
    if (!o) { if (wispAt.size > 64) wispAt.clear(); o = { x: z.x, y: z.y, t }; wispAt.set(z.id, o); }
    if (pass === 0) { const k = Math.min(1, Math.max(0, t - o.t) * 14); o.x += (z.x - o.x) * k; o.y += (z.y - o.y) * k; o.t = t; }
    const bob = Math.sin(t * 5 + z.id) * 2, x = o.x, y = o.y - 10 + bob;
    if (pass === 0) { ED.Render.light(x, y, 54, '#ffcf6a', 0.75); ED.Pix.put(c, ED.Pix.ell(3, 1, '#000000', true), s2(x), s2(o.y), 0.3); }
    else if (pass === 1) ED.Render.glow(c, x, y, 14 + Math.sin(t * 9 + z.id) * 2, '#ffd36b', 0.8);
    else if (pass === 2) ED.Pix.put(c, ED.Pix.orb(3, '#7a4a10', '#ffb347', '#ffe7a0', '#ffffff'), s2(x), s2(y));
  };

  // ---------------- events ----------------
  const WON = { duel: 'Wager won', wisps: 'Every wisp caught', echo: 'Every echo answered' }, LOST = { duel: 'Wager lost', echo: 'The echo fades' };
  ED.ClassFx.on('mg', (ev, ctx, local) => {
    const F = ED.FX, A = ED.Audio;
    switch (ev.k) {
      case 'trap':
        if (ev.r) { F.ring(ev.x, ev.y, ev.r, '#d8cbb8', 0.3, 2); F.burst(ev.x, ev.y, 8, { color: '#d8cbb8', sp: 80, life: 0.35, size: 2 }); }
        else for (let i = 0; i <= 4; i++) F.burst(U.lerp(ev.x, ev.x1, i / 4), U.lerp(ev.y, ev.y1, i / 4), 3, { color: '#e8e0d0', sp: 70, life: 0.3, size: 2 });
        A.play('trapsnap', 0.8);
        break;
      case 'start': F.ring(ev.x, ev.y - 10, 34, GOLD, 0.45, 2); A.play('click'); break;
      case 'end': F.ring(ev.x, ev.y - 10, 26, DIM, 0.4, 2); A.play('unlock', 0.6); break;
      case 'win': F.burst(ev.x, ev.y - 10, 18, { color: GOLD, sp: 90, vy: -50, life: 0.8, size: 2.4, add: true }); A.play('claim'); break; // a shell pick (the dealer and the cup say it)
      case 'lose': F.burst(ev.x, ev.y - 10, 8, { color: '#8a7a6a', sp: 50, life: 0.5, size: 2 }); A.play('deny'); break;
      case 'catch': F.burst(ev.x, ev.y - 10, 12, { color: '#ffe7a0', sp: 70, vy: -40, life: 0.6, size: 2, add: true }); F.pop(ev.x, ev.y - 10, 16, '#fff8e0', 0.25); A.play('platino', ev.pid === local ? 0.8 : 0.4); break;
      case 'bell': {
        flash.set((ev.ok ? 'bell' : 'bad') + ev.i, ED.Render.simT);
        F.ring(ev.x, ev.y - 20, 30, ev.ok ? BELL_COL[ev.i] : '#5a5050', 0.4, 2);
        if (ev.ok) A.play('bell', 0.8, BELL_ST[ev.i]); else A.play('deny');
        break;
      }
      case 'note': F.ring(ev.x, ev.y - 20, 26, BELL_COL[ev.i], 0.45, 2); A.play('bell', 0.7, BELL_ST[ev.i]); break; // a note of the tune (the bell lights from the schedule)
      case 'won': F.showBanner(WON[ev.id] || 'Won', ev.id === 'duel' ? '+' + ev.v + ' gold' : '', 'small', 1.6); F.burst(ev.x, ev.y - 20, 26, { color: GOLD, sp: 110, vy: -60, life: 0.9, size: 2.4, add: true }); A.play('claim'); break;
      case 'lost': F.showBanner(LOST[ev.id] || 'Lost', ev.id === 'duel' ? '-' + ev.v + ' gold' : '', 'small', 1.4); A.play('deny'); break;
      default: break;
    }
    return true;
  });
})(window.ED);
