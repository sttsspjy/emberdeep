// necro route-card visuals, client only: registers ED.ClassFx hooks (event, zone, hero and foe-mark hooks; contract in fx.js).
// Hex sigils on Hexed foes and the command stream of the minions, Gravecaller / Boneyard / Rise Again rise effects, the Bone Spikes and Corpse Explosion bursts, Bone Lance flights, Bone Knight gear (ED.ClassFx.minion, called by
// actors.js and the sprites.js stand-in for every drawn minion), the shot-block clang, Ironbone's stun ring, Bone Armor plates around the Necromancer and the Abyssal glow on empowered minions. All art is drawn here on the 2 px grid
// and registered into the atlas as extra anims (ED.ART frames, ED.Atlas pages), so the effects run through the normal sheet, mark and put paths; without ED.ART the particle effects remain.
(function (ED) {
  'use strict';
  const U = ED.U, F = ED.FX, A = ED.Audio, At = ED.Atlas, Pix = ED.Pix, CF = ED.ClassFx;
  const TEAL = '#7dffd9', BONE = '#e6dfc9', VIOLET = '#a070ff', LILAC = '#c9b3ff', GAS = '#b7d49a';
  const ABYSS_T = 6; // seconds of the Abyssal glow (the sim's ABYSS_T)

  // ---------------- own pixel art (ASCII rows -> canvases, registered as atlas anims) ----------------
  const PAL = { T: '#7dffd9', S: '#c4ffee', t: '#2a8a70', d: '#1c0c3a', V: '#a070ff', v: '#c9b3ff', W: '#ffffff', o: '#222222', B: '#8a8068', L: '#e6dfc9' };
  function sprite(rows) {
    const h = rows.length, w = rows[0].length, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y][x]; if (ch !== '.') { g.fillStyle = PAL[ch]; g.fillRect(x, y, 1, 1); } }
    return cv;
  }
  // Ring of bone spikes (10, alternating long and short; thick at the root, lit on one flank) bursting out of a cracked patch of ground and sinking back; the ground plane is squashed to 0.8 and every spike carries a 1 px dark outline.
  function spikeFrames() {
    const N = 61, C0 = 30, grow = [0.4, 0.85, 1, 1, 0.8, 0.45], fade = [0, 0, 0, 0, 0.3, 0.55], out = [];
    for (let k = 0; k < grow.length; k++) {
      const px = new Map();
      for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) if ((x * x) / 25 + (y * y) / 16 <= 1 && !(fade[k] && ((x * 7 + y * 13) & 3) < fade[k] * 4)) px.set((C0 + y) * N + C0 + x, '#3a3228'); // the cracked ground the spikes burst from
      for (let i = 0; i < 10; i++) {
        const a = i * (U.TAU / 10) + 0.31, len = (i & 1 ? 17 : 26) * grow[k], ca = Math.cos(a), sa = Math.sin(a);
        for (let s = 4; s <= len; s++) {
          const hw = (1 - s / len) * 2.4 + 0.3;
          for (let o = -3; o <= 3; o++) {
            if (Math.abs(o) > hw) continue;
            const x = Math.round(C0 + ca * s - sa * o), y = Math.round(C0 + sa * s * 0.8 + ca * o * 0.8);
            if (fade[k] && ((x * 7 + y * 13 + i * 5) % 100) / 100 < fade[k]) continue;
            px.set(y * N + x, s > len * 0.82 ? '#ffffff' : o < 0 ? BONE : '#b9ad8e');
          }
        }
      }
      const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
      const g = cv.getContext('2d');
      g.fillStyle = '#222222';
      for (const key of px.keys()) { const x = key % N, y = (key / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!px.has((y + dy) * N + x + dx)) g.fillRect(x + dx, y + dy, 1, 1); }
      for (const [key, col] of px) { g.fillStyle = col; g.fillRect(key % N, (key / N) | 0, 1, 1); }
      out.push(cv);
    }
    return out;
  }
  function addAnim(id, frames, fps, loop, ax, ay) {
    const art = ED.ART, f = [];
    frames.forEach((cv, i) => { const fid = id + '#' + i; At.pages[fid] = cv; art.frames[fid] = { p: fid, x: 0, y: 0, w: cv.width, h: cv.height, ox: 0, oy: 0 }; f.push(fid); });
    art.anims[id] = { f, fps, loop, fw: frames[0].width, fh: frames[0].height, ax, ay, anchors: {} };
  }
  if (ED.ART && ED.ART.anims && ED.ART.frames && At && At.pages) {
    // Hex sigils (7x7): a rune ring with a violet core; the commanded target (the Hexed foe the minions rush) burns brighter with an X core
    addAnim('fx.hex.sigil', [sprite(['..TTT..', '.TdddT.', 'TddVddT', 'TdVVVdT', 'TddVddT', '.TdddT.', '..TTT..']), sprite(['..SSS..', '.SdddS.', 'SddWddS', 'SdWWWdS', 'SddWddS', '.SdddS.', '..SSS..'])], 4, true, 3, 3);
    addAnim('fx.hex.target', [sprite(['..VTV..', '.TdddT.', 'VdWVWdV', 'TdVWVdT', 'VdWVWdV', '.TdddT.', '..VTV..']), sprite(['..TVT..', '.VdddV.', 'TdVWVdT', 'VdWVWdV', 'TdVWVdT', '.VdddV.', '..TVT..'])], 6, true, 3, 3);
    // Bone Armor plate (7x7, dark outline) and the Bone Lance in flight (11x5, pointing right)
    addAnim('fx.bone.plate', [sprite(['.ooooo.', 'oBLLLBo', 'oBLWLBo', 'oBLLLBo', '.oBLBo.', '..oBo..', '...o...'])], 1, false, 3, 3);
    addAnim('fx.bone.lance', [sprite(['........o..', '.ooooooooTo.', 'oLLLLLLLWTTo', '.ooooooooTo.', '........o..'])], 1, false, 5, 2);
    addAnim('fx.bone.spikes', spikeFrames(), 14, false, 30, 30);
    // Rising soul (9x11, pivot at the tail tip, two tail frames): Gravecaller in teal, Rise Again in violet
    const SOUL = [['..ddddd..', '.dSSSSSd.', 'dSSSSSSSd', 'dSddSddSd', 'dSddSddSd', 'dSSSSSSSd', 'dTSSdSSTd', 'dTSSSSSTd', 'dTTSSSTTd', 'dTdTTTdTd', '.d.dTd.d.'],
      ['..ddddd..', '.dSSSSSd.', 'dSSSSSSSd', 'dSddSddSd', 'dSddSddSd', 'dSSSSSSSd', 'dTSSdSSTd', 'dTSSSSSTd', 'dTTSSSTTd', 'dTTdTdTTd', '..d.d.d..']];
    addAnim('fx.soul.teal', SOUL.map(sprite), 6, true, 4, 10);
    addAnim('fx.soul.violet', SOUL.map((rows) => sprite(rows.map((r) => r.replace(/S/g, 'v').replace(/T/g, 'V')))), 6, true, 4, 10);
  }
  const has = (id) => !!(At && At.has && At.has(id));

  // ---------------- shared state and lookups ----------------
  const view = () => { const s = ED.Game && ED.Game.s; return s ? s.view : null; };
  const seen = new Set(), lastStream = {}, abyssUntil = {};
  let cmdT = -1, hexSnd = -9;
  const cmd = []; // per frame: [{ p, tgt }] the Necromancer with Soul Command and the Hexed foe nearest it within 400 that the sim's hexTarget accepts (its minions rush it); empty with 2 commanders (the wire has no Hex owner)
  function commands() {
    if (cmdT === F.time) return cmd;
    cmdT = F.time; cmd.length = 0;
    const v = view(); if (!v) return cmd;
    let n = 0;
    for (const p of v.players.values()) if (!p.dead && p.cls === 'necro' && p.boons && p.boons.n_atk) n++;
    if (n !== 1) return cmd;
    for (const p of v.players.values()) {
      if (p.dead || p.cls !== 'necro' || !p.boons || !p.boons.n_atk) continue;
      let best = null, bd = 400 * 400;
      for (const e of v.enemies) {
        if (e.hp <= 0 || e.burrowed || e.spawnT > 0 || e.invulnT > 0 || (e.def && e.def.invuln) || !(e.hexed || e.hexT > 0)) continue;
        const d = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) cmd.push({ p, tgt: best });
    }
    return cmd;
  }

  // ---------------- Hex: sigil on the foe, a flash when it lands, the minions' command stream ----------------
  CF.mark.push((e) => {
    if (!(e.hexed || e.hexT > 0)) { if (seen.size) seen.delete(e.id); return null; }
    if (!seen.has(e.id)) {
      if (seen.size > 300) seen.clear();
      seen.add(e.id);
      F.pop(e.x, e.y - e.r - 4, 14, VIOLET, 0.14);
      F.burst(e.x, e.y - e.r - 6, 4, { kind: 'spark', color: TEAL, sp: 70, life: 0.3, size: 1.6, drag: 4 });
      if (F.time - hexSnd > 0.15) { hexSnd = F.time; A.play('magic', 0.1); }
    }
    let tg = false;
    const cs = commands();
    for (let i = 0; i < cs.length; i++) if (cs[i].tgt === e) tg = true;
    return { id: tg ? 'fx.hex.target' : 'fx.hex.sigil', ramp: '', stub: tg ? 'hext' : 'hex' };
  });
  // The command stream: teal motes run from each of the hero's minions to the foe they rush (a few per second, flat cost).
  function stream(p, low) {
    const now = F.time;
    if (now - (lastStream[p.pid] || -9) < (low ? 0.24 : 0.12)) return;
    lastStream[p.pid] = now;
    const v = view(), cs = commands();
    let tgt = null;
    for (let i = 0; i < cs.length; i++) if (cs[i].p === p) tgt = cs[i].tgt;
    if (!tgt || !v) return;
    for (const a of v.allies) {
      if (a.owner !== p.pid) continue;
      const dx = tgt.x - a.x, dy = tgt.y - a.y, d = Math.hypot(dx, dy);
      if (d < 28) continue;
      F.part(a.x, a.y - 10, { a: Math.atan2(dy, dx), size: 3, color: TEAL, add: true, drag: 0, lt: TEAL, ltr: 16 }, 250, Math.min(0.9, d / 250));
    }
  }

  // ---------------- Bone Armor plates and the hero hook ----------------
  const boneOn = {}; // pid -> true while the hero's shield comes from Bone Armor (the shielded event's source 'bone'); any other source or an empty shield clears it
  function plates(c, p, t) {
    const frac = U.clamp(p.shield / Math.max(1, p.maxHp * 0.06), 0.2, 1), n = 2 + Math.round(frac * 3); // 3 plates at a 2% shield, 5 at 6%
    const an = ED.Render && ED.Render.actorAnchor ? ED.Render.actorAnchor(p) : null, cy = an ? an.cy : -12;
    for (let i = 0; i < n; i++) {
      const a = t * 1.7 + i * U.TAU / n + (p.slot || 0), x = Pix.s2(Math.cos(a) * 17), y = Pix.s2(cy + Math.sin(a) * 6);
      if (!Pix.draw(c, 'fx.bone.plate', '', 0, x, y, Math.sin(a) > 0 ? 1 : 0.55)) { c.fillStyle = BONE; c.fillRect(x - 2, y - 3, 4, 6); }
    }
  }
  CF.hero.push((c, p, t, low) => {
    if (p.cls !== 'necro' || p.dead || !p.boons) return;
    if (p.boons.n_atk) stream(p, low);
    if (!(p.shield > 0)) boneOn[p.pid] = false;
    else if (p.boons.n_s2_b && boneOn[p.pid]) plates(c, p, t);
  });

  // ---------------- rises ----------------
  // k: gc Gravecaller (a teal soul climbs out of the foe), yard Boneyard (bone chips), again Rise Again (violet), tide Risen Tide (a second skull and a wide ring).
  CF.on('raise', (ev, ctx, local) => {
    const k = ev.k;
    if (!k) return;
    const m = ev.pid === local ? 1 : 0.7, x = ev.x, y = ev.y;
    // A soul (own art, outlined so the built-in flare cannot wash it out) climbs out of the foe from above the flare; an upward streak column marks the kind.
    const soul = (id, dx, vy, a, life) => F.sheet(id, x + dx, y - 14, { loop: true, life, fade: true, vy, a: a * m });
    if (k === 'gc') {
      soul('fx.soul.teal', 0, -44, 1, 0.9);
      F.burst(x, y - 6, 6, { kind: 'streak', color: TEAL, a: -Math.PI / 2, spread: 0.7, sp: 130, life: 0.45, size: 2 });
      F.burst(x, y - 4, 7, { kind: 'shard', color: BONE, sp: 90, life: 0.5, size: 2.2, vz: 80, z: 4 });
      F.ring(x, y, 18, TEAL, 0.3, 2);
    } else if (k === 'yard') {
      F.burst(x, y - 4, 9, { kind: 'shard', color: BONE, sp: 110, life: 0.5, size: 2.4, vz: 90, z: 4 });
      F.ring(x, y, 24, BONE, 0.3, 2);
    } else {
      const tide = k === 'tide';
      soul('fx.soul.violet', 0, -48, 1, 0.9);
      if (tide) soul('fx.soul.violet', 14, -38, 0.8, 0.8);
      F.burst(x, y - 6, tide ? 9 : 6, { kind: 'streak', color: LILAC, a: -Math.PI / 2, spread: 0.7, sp: 130, life: 0.45, size: 2 });
      F.sheet('fx.spark.magic', x, y - 8, { ramp: 'shadow', add: true, a: 0.8 * m });
      F.ring(x, y, tide ? 40 : 26, VIOLET, 0.35, tide ? 3 : 2);
      F.burst(x, y - 6, tide ? 10 : 6, { kind: 'smoke', color: '#5a2fb0', sp: 40, life: 0.6, size: 5, drag: 2.5 });
      if (tide && ev.pid === local) A.play('rift', 0.12);
    }
    A.play('magic', 0.15 * m);
  });

  // ---------------- bursts ----------------
  CF.on('boom', (ev) => {
    if (ev.k !== 'bone') return;
    if (ev.s) { // Bone Spikes
      if (has('fx.bone.spikes')) F.sheet('fx.bone.spikes', ev.x, ev.y, { a: 0.95 });
      else F.burst(ev.x, ev.y - 4, 10, { kind: 'shard', color: BONE, sp: ev.r * 2.2, life: 0.4, size: 2.4 });
      F.ring(ev.x, ev.y, ev.r, BONE, 0.25, 2);
    } else if (ev.c) { // Corpse Explosion: a sickly gas burst over the corpse
      F.sheet('fx.explosion', ev.x, ev.y - 6, { ramp: 'poison', a: 0.7 });
      F.sheet('deco.skull', ev.x, ev.y - 4, { ramp: 'dust', frame: 0, life: 0.3, fade: true, vy: -16, a: 0.8 });
      F.burst(ev.x, ev.y - 6, 8, { kind: 'shard', color: GAS, sp: ev.r * 2, life: 0.45, size: 2.4, vz: 70, z: 4 });
    }
  });
  // Bone Lance: the minion's spear flies to its foe in 0.12 s (the burst lands with it)
  CF.on('blance', (ev, ctx, local) => {
    const dx = ev.x1 - ev.x0, dy = ev.y1 - ev.y0, dur = 0.12;
    F.sheet('fx.bone.lance', ev.x0, ev.y0 - 8, { frame: 0, life: dur, vx: dx / dur, vy: dy / dur, rot: Math.atan2(dy, dx) });
    F.bolts.push({ pts: [[ev.x0, ev.y0 - 8], [ev.x1, ev.y1 - 8]], life: 0.16, max: 0.16, color: TEAL, st: true });
    if (F.bolts.length > 24) F.bolts.shift();
    F.burst(ev.x1, ev.y1 - 8, 5, { kind: 'spark', color: '#ffffff', sp: 150, life: 0.25, size: 1.6, drag: 5 });
    A.play('throw', ev.pid === local ? 0.3 : 0.15);
  });

  // ---------------- Bone Knights ----------------
  CF.on('kblock', (ev, ctx, local) => { // a shot stops on the knight: bone chips, a spark, a dull clang
    F.burst(ev.x, ev.y, 6, { kind: 'shard', color: BONE, sp: 130, life: 0.3, size: 2, drag: 4 });
    F.sheet('fx.hit.spark', ev.x, ev.y - 2, { add: true });
    F.pop(ev.x, ev.y, 12, '#ffffff', 0.1, true);
    A.play('clang', ev.pid === local ? 0.6 : 0.3, { g: 1 });
  });
  CF.on('kstun', (ev) => { // Ironbone: the first foe a Bone Knight strikes is rattled (stars come from the stun flag)
    F.ring(ev.x, ev.y - 6, 20, BONE, 0.2, 2);
    F.pop(ev.x, ev.y - 10, 16, '#ffffff', 0.12, true);
    A.play('guardhit', 0.4);
  });
  const EASE = (k) => 1 - (1 - k) * (1 - k);
  const SWORD = { id: 'weapon.alt.rusty_sword', hand: [9, -11], rest: -1.15, up: -2.35, down: 1.2 }, SHIELD = { id: 'shield.tower', pos: [-6, -12] };
  function foeNear(a) { // a foe within sword reach of minion a (the client does not see the strike itself)
    const v = view();
    if (v) for (const e of v.enemies) { const r = 27 + e.r; if (e.hp > 0 && (e.x - a.x) * (e.x - a.x) + (e.y - a.y) * (e.y - a.y) < r * r) return true; }
    return false;
  }
  // Without the atlas (the 1.4x stand-in body): a 2 px-grid kite shield on the off hand and a short sword that is raised, or thrust forward at the 0.5 s rate while a foe is in reach.
  function knightGearPlain(c, a, t, flip) {
    const sg = flip ? -1 : 1, id = (a.id | 0) * 0.37, thrust = foeNear(a) && (t * 2 + id) % 1 < 0.35;
    const R = (dx, y, w, h, col) => { c.fillStyle = col; c.fillRect(sg > 0 ? dx : -dx - w, y, w, h); }; // dx: offset toward the facing side
    R(-16, -30, 10, 14, '#222222'); R(-14, -28, 6, 10, '#9fb4c4'); R(-14, -28, 2, 10, '#c8d8e4'); R(-12, -26, 2, 6, TEAL); R(-14, -18, 6, 2, '#6f8496'); // shield: dark rim, steel face, lit left edge, teal cross, base
    if (thrust) { R(8, -24, 16, 4, '#222222'); R(10, -23, 14, 2, BONE); R(6, -26, 2, 8, '#222222'); R(6, -25, 2, 6, '#8a8068'); } // blade out, guard
    else { R(12, -36, 4, 16, '#222222'); R(13, -35, 2, 14, BONE); R(10, -22, 8, 2, '#222222'); R(11, -22, 6, 2, '#8a8068'); } // blade up, guard
  }
  // Shield on the off hand and a sword that chops at the 0.5 s rate while a foe is in reach; drawn over the body in the minion's feet frame.
  function knightGear(c, a, t, flip) {
    const AC = ED.Actors, sg = flip ? -1 : 1, near = foeNear(a);
    AC.put(c, SHIELD.id, 0, SHIELD.pos[0] * 2 * sg, SHIELD.pos[1] * 2, flip, Pix.variant(SHIELD.id, 'teal'), 1);
    const rr = At.anim(SWORD.id);
    if (!rr) return;
    let k = SWORD.rest;
    if (near) {
      const ph = (t * 2 + (a.id | 0) * 0.37) % 1;
      k = ph < 0.55 ? SWORD.rest + (SWORD.up - SWORD.rest) * EASE(ph / 0.55) : ph < 0.7 ? SWORD.up + (SWORD.down - SWORD.up) * EASE((ph - 0.55) / 0.15) : SWORD.down + (SWORD.rest - SWORD.down) * EASE((ph - 0.7) / 0.3);
    }
    const dirA = ((rr.anchors.dir || 0) - 90) * Math.PI / 180, wa = flip ? Math.PI - k : k, rot = wa - (flip ? Math.PI - dirA : dirA);
    AC.put(c, SWORD.id, 0, SWORD.hand[0] * 2 * sg, SWORD.hand[1] * 2, flip, Pix.variant(SWORD.id, 'general'), 1, rot < 0 ? rot + U.TAU : rot);
  }

  // ---------------- Abyssal Toll ----------------
  CF.on('abyss', (ev, ctx, local) => {
    abyssUntil[ev.pid] = F.time + ABYSS_T;
    const p = ctx.player(ev.pid);
    if (!p) return;
    F.ring(p.x, p.y - 8, 70, VIOLET, 0.45, 4); F.ring(p.x, p.y - 8, 36, TEAL, 0.35, 2);
    F.pop(p.x, p.y - 12, 40, VIOLET, 0.25, true);
    A.play('rift', ev.pid === local ? 0.25 : 0.12);
    if (ev.pid === local) F.text(p.x, p.y - 44, 'LEGION EMPOWERED', LILAC, 9, { pop: true });
  });
  // Empowered minions glow violet and shed three orbiting motes for ABYSS_T seconds.
  function abyssGlow(c, a, t) {
    const id = a.id | 0, pulse = 0.5 + 0.5 * Math.sin(t * 6 + id);
    ED.Sprites.glow(c, 0, -10, 22 + 4 * pulse, VIOLET, 0.32 + 0.14 * pulse);
    c.fillStyle = LILAC; c.beginPath();
    for (let i = 0; i < 3; i++) { const q = t * 3 + i * 2.094 + id; c.rect(Pix.s2(Math.cos(q) * 11), Pix.s2(-12 + Math.sin(q) * 4), 2, 2); }
    c.fill();
  }
  CF.knight = (a) => { const v = view(), o = v && v.players.get(a.owner); return !!(a.knight || (o && o.boons && o.boons.n_s1_b)); }; // true when minion a is a Bone Knight (sprites.js stand-in body)
  // Called by actors.js and by the sprites.js stand-in after a minion's body: Bone Knight gear, the Abyssal glow.
  CF.minion = (c, a, t, knight, flip) => {
    if (knight) { if (has(SHIELD.id)) knightGear(c, a, t, flip); else knightGearPlain(c, a, t, flip); }
    if (abyssUntil[a.owner] > F.time) abyssGlow(c, a, t);
  };

  // ---------------- Bone Armor ----------------
  CF.on('shielded', (ev) => { // the plates snap on: bone chips fly in from the hero's sides
    boneOn[ev.pid] = ev.k === 'bone';
    if (ev.k !== 'bone') return;
    const v = view(), p = v && v.players.get(ev.pid);
    if (!p || !p.boons || !p.boons.n_s2_b) return;
    for (let i = 0; i < 4; i++) { const a = i * U.TAU / 4 + 0.4; F.part(p.x + Math.cos(a) * 26, p.y - 12 + Math.sin(a) * 12, { a: a + Math.PI, kind: 'shard', color: BONE, size: 2.2, drag: 0 }, 90, 0.28); }
    F.ring(p.x, p.y - 10, 20, BONE, 0.25, 2);
  });
})(globalThis.ED || (globalThis.ED = {}));
