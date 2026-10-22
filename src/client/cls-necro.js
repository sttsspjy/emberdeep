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
    if (!k || k === 'bomb') return; // a bone bomb has its own rise below
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
      if (ev.b) bombBurst(ev); // a bone bomb
    } else if (ev.c) { // Corpse Explosion: a sickly gas burst over the corpse
      F.sheet('fx.explosion', ev.x, ev.y - 6, { ramp: 'poison', a: 0.7 });
      F.sheet('deco.skull', ev.x, ev.y - 4, { ramp: 'dust', frame: 0, life: 0.3, fade: true, vy: -16, a: 0.8 });
      F.burst(ev.x, ev.y - 6, 8, { kind: 'shard', color: GAS, sp: ev.r * 2, life: 0.45, size: 2.4, vz: 70, z: 4 });
      if (ev.cs) F.burst(ev.x, ev.y - 6, 9, { kind: 'shard', color: BONE, sp: ev.r * 3.2, life: 0.55, size: 2.6, vz: 110, z: 4 }); // Carrion Storm: the bones fly with the shards
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
  // ---------------- skill forms ----------------
  // Ossuary Bloom (bone bombs, fields of bone spikes), Death Knight (a giant armoured knight with a taunt ring and a sweeping cleave), Carrion Storm (bones fly with the shards), Lich Form (green ghost fire, a skull crown, orbiting souls).
  const s2 = Pix.s2, away = (ctx, x, y) => { const me = ctx.player(ctx.localPid); return me ? Math.hypot(me.x - x, me.y - y) : 9999; }; // far events do not shake the screen
  const lichUntil = {};

  // A bone bomb rises: bone chips and a spark of fuse-fire.
  CF.on('raise', (ev, ctx, local) => {
    if (ev.k !== 'bomb') return;
    const m = ev.pid === local ? 1 : 0.7;
    F.burst(ev.x, ev.y - 4, 5, { kind: 'shard', color: BONE, sp: 90, life: 0.4, size: 2.2, vz: 80, z: 3 });
    F.ring(ev.x, ev.y, 14, BONE, 0.2, 2); F.pop(ev.x, ev.y - 8, 14, '#ffd36b', 0.12, true);
    A.play('magic', 0.1 * m);
  });
  // A bone bomb goes off (a boom with b): a ring of bone shrapnel, a hot flash and a thud.
  function bombBurst(ev) {
    F.burst(ev.x, ev.y - 6, 14, { kind: 'shard', color: BONE, sp: ev.r * 3, life: 0.5, size: 2.6, vz: 120, z: 3 });
    F.burst(ev.x, ev.y - 6, 8, { color: '#ffb347', sp: ev.r * 1.6, life: 0.3, size: 2.4, add: true, drag: 3 });
    F.pop(ev.x, ev.y - 8, ev.r * 0.9, '#ffd36b', 0.2, true); F.ring(ev.x, ev.y, ev.r * 1.1, '#ffb347', 0.28, 3);
    F.sheet('fx.explosion', ev.x, ev.y - 6, { ramp: 'dust', a: 0.7 });
    A.play('boom', 0.3);
  }

  // The bomb itself (called by actors.js and the sprites.js stand-in in place of a minion's body when the ally has k 2): a bone-white skull on two little legs with a sputtering fuse and a hot glow.
  CF.bomb = (c, a, t) => {
    const id = a.id | 0, bob = Math.round(Math.sin(t * 17 + id)) * 2, pulse = 0.5 + 0.5 * Math.sin(t * 11 + id), fl = Math.floor(t * 14 + id) & 1, flip = a.face < 0 ? -1 : 1;
    Pix.put(c, Pix.ell(6, 2, '#000000', true), 0, 0, 0.3);
    ED.Sprites.glow(c, 0, -12, 18 + 5 * pulse, '#ff7a3a', 0.2 + 0.18 * pulse);
    c.fillStyle = '#222222'; c.fillRect(-6, -4 + (bob ? 2 : 0), 4, 4); c.fillRect(2, -4 + (bob ? 0 : 2), 4, 4); c.fillStyle = BONE; c.fillRect(-4, -4 + (bob ? 2 : 0), 2, 2); c.fillRect(4, -4 + (bob ? 0 : 2), 2, 2); // two stubs of legs
    Pix.put(c, Pix.orb(6, '#14100c', '#a89c7c', BONE, '#fffbe8'), 0, -14 + bob);
    c.fillStyle = '#1c0c3a'; c.fillRect(-6, -16 + bob, 4, 4); c.fillRect(2, -16 + bob, 4, 4); c.fillRect(-2, -10 + bob, 4, 2); // eye sockets and a toothy mouth
    c.fillStyle = TEAL; c.fillRect(-4, -14 + bob, 2, 2); c.fillRect(4, -14 + bob, 2, 2);
    c.fillStyle = '#222222'; c.fillRect(flip * 6 - 1, -28 + bob, 4, 8); c.fillStyle = '#8a8068'; c.fillRect(flip * 6, -27 + bob, 2, 6); // the fuse
    c.fillStyle = fl ? '#ffd36b' : '#ff6a2a'; c.fillRect(flip * 6 - 1, -32 + bob, 4, 4); c.fillStyle = '#ffffff'; c.fillRect(flip * 6, -31 + bob, 2, 2);
    ED.Sprites.glow(c, flip * 6, -30 + bob, 9, '#ffb347', 0.5);
    return true;
  };

  // Bone field (zone 'shards' with w 11): a dark cracked patch ringed in teal with a thicket of bone spikes that thrust up, sway and sink back in the last half second.
  CF.zone.bonefield = (c, z, pass, t) => {
    const R = ED.Render, left = z.dur - z.t, fade = Math.min(1, left * 2.5, z.t * 8), grow = Math.min(1, z.t * 7) * Math.min(1, left * 2.2), n = Math.max(7, Math.round(z.r / 5)), x = s2(z.x), y = s2(z.y);
    if (pass === 0) {
      R.light(z.x, z.y, z.r * 1.5, TEAL, 0.3 * fade);
      Pix.put(c, Pix.disc(Math.max(1, Math.round(z.r / 2)), '#1b1626'), x, y, 0.3 * fade);
      Pix.put(c, Pix.ring(Math.max(2, Math.round(z.r / 2)), 1, '#2a8a70', TEAL, '#c4ffee', 3, (t * 5) & 7), x, y, 0.8 * fade);
      c.globalAlpha = fade;
      for (let i = 0; i < n; i++) { // spikes: rows of 2 px tapering from 6 px wide at the root to a white tip, leaning with the patch, thrusting up as the field forms
        const a = i * 2.39996 + z.id, rr = Math.sqrt((i + 0.5) / n) * z.r * 0.86, px = s2(z.x + Math.cos(a) * rr), py = s2(z.y + Math.sin(a) * rr * 0.72), rows = Math.max(1, Math.round((5 + (i % 3) * 2) * grow)), lean = (i & 1) ? 2 : -2;
        c.fillStyle = '#14100c'; c.fillRect(px - 4, py - 2, 8, 4);
        for (let j = 0; j < rows; j++) {
          const w = j < rows * 0.34 ? 6 : j < rows * 0.7 ? 4 : 2, off = j > rows * 0.5 ? lean : 0, y0 = py - 4 - j * 2;
          c.fillStyle = j === rows - 1 ? '#ffffff' : '#a89c7c'; c.fillRect(px - w / 2 + off, y0, w, 2);
          if (w > 2 && j < rows - 1) { c.fillStyle = BONE; c.fillRect(px - w / 2 + off, y0, 2, 2); }
        }
      }
      c.globalAlpha = 1;
    } else if (pass === 1) R.glow(c, z.x, z.y, z.r * 0.9, TEAL, 0.12 * fade);
  };

  // Death Knight: a huge Bone Knight. dk(c, a, t, post) is called by actors.js and the sprites.js stand-in for an ally with k 1: before the body (post false) the taunt ring on the ground and a dark flame behind it,
  // after it (post true) two burning eyes. The body itself is drawn at twice the size by the callers (CF.DK_SCALE).
  CF.DK_SCALE = 2;
  CF.dk = (c, a, t, post) => {
    const id = a.id | 0, pulse = 0.5 + 0.5 * Math.sin(t * 4 + id);
    if (!post) {
      Pix.put(c, Pix.ring(60, 1, '#2a8a70', TEAL, '#c4ffee', 5, (t * 3) & 7), 0, 0, 0.1 + 0.07 * pulse); // the taunt radius (120)
      ED.Sprites.glow(c, 0, -34, 54 + 8 * pulse, VIOLET, 0.3 + 0.12 * pulse);
      c.fillStyle = LILAC; c.beginPath();
      for (let i = 0; i < 5; i++) { const k = (t * 0.8 + i * 0.2 + id * 0.11) % 1; c.globalAlpha = Math.max(0.25, Math.ceil((1 - k) * 4) / 4) * 0.8; c.rect(s2(Math.cos(id + i * 2.4) * 18), s2(-12 - k * 70), 2, 4); }
      c.fill(); c.globalAlpha = 1;
    } else {
      c.fillStyle = '#ff3a3a'; c.fillRect(-6, -58, 4, 2); c.fillRect(4, -58, 4, 2); ED.Sprites.glow(c, 0, -57, 14, '#ff3a3a', 0.35 + 0.15 * pulse);
    }
  };
  CF.on('dkraise', (ev, ctx, local) => {
    const mine = ev.pid === local, d = away(ctx, ev.x, ev.y);
    F.ring(ev.x, ev.y, 120, VIOLET, 0.5, 5); F.ring(ev.x, ev.y, 60, TEAL, 0.4, 4); F.ring(ev.x, ev.y, 28, '#ffffff', 0.25, 2);
    F.burst(ev.x, ev.y, 16, { kind: 'shard', color: BONE, sp: 200, life: 0.7, size: 3, vz: 140, z: 2 }); F.burst(ev.x, ev.y - 6, 12, { kind: 'smoke', color: '#5a2fb0', sp: 90, life: 0.8, size: 6, drag: 2.2 });
    F.burst(ev.x, ev.y - 10, 14, { kind: 'streak', color: LILAC, a: -Math.PI / 2, spread: 2.6, sp: 300, life: 0.4, size: 2 }); F.pop(ev.x, ev.y - 14, 60, VIOLET, 0.32, true); F.dust(ev.x, ev.y, 'dust', 4);
    if (mine) F.text(ev.x, ev.y - 70, 'DEATH KNIGHT', LILAC, 10, { pop: true });
    A.play('thud', mine ? 1 : d < 400 ? 0.6 : 0.25); A.play('clang', mine ? 0.8 : 0.3, { g: 1 }); A.play('rift', mine ? 0.3 : 0.12);
    if (mine) { F.addShake(6); F.hitStop(0.07); F.punch(0.7, 0.3); } else if (d < 400) F.addShake(2);
  });
  CF.on('dkswing', (ev, ctx, local) => { // the cleave: a fan of bone-white streaks across its arc and a short flash
    const mine = ev.pid === local, d = away(ctx, ev.x, ev.y), x = ev.x + Math.cos(ev.a) * 26, y = ev.y - 24 + Math.sin(ev.a) * 18;
    for (let k = -3; k <= 3; k++) F.part(x, y, { kind: 'streak', color: k & 1 ? BONE : '#ffffff', a: ev.a + k * 0.4, sp: 260 - Math.abs(k) * 22, life: 0.22, size: 2.2, drag: 5 });
    F.pop(x + Math.cos(ev.a) * 22, y + Math.sin(ev.a) * 12, 26, LILAC, 0.14, true);
    A.play('swing', mine ? 0.7 : 0.3); if (d < 360) A.play('heavy', mine ? 0.4 : 0.15);
    if (mine) { F.addShake(1.6); F.hitStop(0.03); } else if (d < 300) F.addShake(0.7);
  });

  // Lich Form: the event starts the window (the card's seconds); the hero wears green ghost fire, a skull crown and three souls circling it until the window ends.
  CF.on('lich', (ev, ctx, local) => {
    const p = ctx.player(ev.pid), mine = ev.pid === local;
    lichUntil[ev.pid] = F.time + ((p && p.stats && p.stats.lichT) || 5);
    if (!p) return;
    F.ring(p.x, p.y, 70, TEAL, 0.5, 5); F.ring(p.x, p.y, 36, '#ffffff', 0.3, 2); F.pop(p.x, p.y - 14, 46, TEAL, 0.3, true);
    F.burst(p.x, p.y - 8, 20, { color: TEAL, a: -Math.PI / 2, spread: 3, sp: 120, life: 0.9, size: 2.8, add: true, drag: 1.2 }); F.burst(p.x, p.y - 12, 8, { kind: 'streak', color: '#ffffff', a: -Math.PI / 2, spread: 1.6, sp: 320, life: 0.4, size: 2 });
    A.play('rift', mine ? 0.45 : 0.2); A.play('magic', mine ? 0.3 : 0.12);
    if (mine) { F.addShake(3); F.punch(0.5, 0.2); F.flash = { color: TEAL, t: 0.25, a: 0.16 }; }
  });
  CF.hero.push((c, p, t, low) => {
    if (p.cls !== 'necro' || p.dead || !(lichUntil[p.pid] > F.time)) return;
    const left = lichUntil[p.pid] - F.time, fade = Math.min(1, left * 2, (5 - left) * 6 + 0.4), an = ED.Render && ED.Render.actorAnchor ? ED.Render.actorAnchor(p) : null, top = an ? an.top : -38, cy = an ? an.cy : -14, slot = p.slot | 0;
    Pix.put(c, Pix.ell(13, 5, TEAL, false, 4, (t * 6) & 7), 0, 2, 0.85 * fade); // a dashed teal ring on the ground
    ED.Sprites.glow(c, 0, cy, 30 + 4 * Math.sin(t * 5), TEAL, 0.28 * fade);
    c.fillStyle = TEAL; c.beginPath();
    for (let i = 0; i < (low ? 5 : 9); i++) { const k = (t * 0.9 + i * 0.111 + slot * 0.13) % 1, a = i * 2.39996 + slot; c.globalAlpha = Math.max(0.25, Math.ceil((1 - k) * 4) / 4) * fade; c.rect(s2(Math.cos(a) * (8 + k * 6)) - 2, s2(cy + 10 - k * 40), 4, 4 - (k > 0.5 ? 2 : 0)); } // ghost flames rising off the shoulders
    c.fill(); c.globalAlpha = 1;
    Pix.draw(c, 'fx.sigil.skull', 'teal', 0, 0, s2(top - 10 + Math.round(Math.sin(t * 3)) * 2), fade); // a skull crown above the head
    if (has('fx.soul.teal')) for (let i = 0; i < 3; i++) { const a = t * 2.2 + i * U.TAU / 3; Pix.draw(c, 'fx.soul.teal', '', ((t * 6) | 0) & 1, s2(Math.cos(a) * 20), s2(cy + Math.sin(a) * 7), (Math.sin(a) > 0 ? 1 : 0.6) * fade); }
  });
})(globalThis.ED || (globalThis.ED = {}));
