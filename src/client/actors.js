// Picks anim / frame / flip / flash / scale for heroes, foes, bosses and props and draws them through ED.Batch (client only).
// Foe facing comes from the angle to the nearest hero (two-way art flips, four-way picks walk.d/u/l/r, eight-way walk.0-7 with 0 = south, clockwise toward east = 2).
(function (ED) {
  'use strict';
  const U = ED.U, PI = Math.PI;
  const Ac = ED.Actors = {};
  const O = { flip: false, flash: 0, alpha: 1, rot: 0, sx: 1, sy: 1, tint: 0, add: false };
  const reset = () => { O.flip = false; O.flash = 0; O.alpha = 1; O.rot = 0; O.sx = 1; O.sy = 1; O.tint = 0; O.add = false; return O; };

  // Per foe def: resolved anim ids { k: 2|4|8|0, walk, idle | walk: {d,u,l,r} | walk: [8] }.
  const info = new Map();
  const foeInfo = (def) => {
    let f = info.get(def.id);
    if (f && (f.k || !ED.Atlas.ok)) return f;
    const A = ED.Atlas, p = def.look + '.';
    f = { k: 0 };
    if (A.has(p + 'walk') || A.has(p + 'idle')) { f.k = 2; f.walk = A.has(p + 'walk') ? p + 'walk' : p + 'idle'; f.idle = A.has(p + 'idle') ? p + 'idle' : f.walk; f.atk = A.has(p + 'attack') ? p + 'attack' : null; }
    else if (A.has(p + 'walk.d')) { f.k = 4; f.walk = { d: p + 'walk.d', u: p + 'walk.u', l: p + 'walk.l', r: p + 'walk.r' }; }
    else if (A.has(p + 'walk.0')) { f.k = 8; f.walk = []; for (let i = 0; i < 8; i++) f.walk.push(p + 'walk.' + i); }
    info.set(def.id, f);
    return f;
  };
  Ac.foeInfo = foeInfo;
  const oct8 = (a) => (((2 - Math.round(a / (PI / 4))) % 8) + 8) % 8;
  const dir4 = (a) => { const c = Math.cos(a), s = Math.sin(a); return Math.abs(c) >= Math.abs(s) ? (c > 0 ? 'r' : 'l') : (s > 0 ? 'd' : 'u'); };
  const nearAng = (e, heroes) => {
    let best = null, bd = Infinity;
    for (const p of heroes) { if (p.dead) continue; const d = (p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y); if (d < bd) { bd = d; best = p; } }
    return best ? Math.atan2(best.y - e.y, best.x - e.x) : (e.face < 0 ? PI : 0);
  };

  // Hero p (feet at p.x, p.y). Idle / run / hit by state, flipped toward its last movement; blinks while invulnerable, lies down while downed.
  Ac.hero = (B, p, t) => {
    const cls = ED.HEROES[p.cls] ? p.cls : 'knight', A = ED.Atlas;
    let id = 'hero.' + cls + (p.hurtT > 0 ? '.hit' : p.moving ? '.run' : '.idle');
    if (!A.has(id)) id = 'hero.' + cls + '.idle';
    const o = reset();
    o.flip = p.mvx < 0;
    if (p.downed) { o.rot = -PI / 2; o.alpha = 0.7; }
    else if (p.invuln > 0 && Math.floor(t * 18) % 2) o.alpha = 0.45;
    if (p.dashT > 0) o.alpha = 0.6;
    B.shadow(p.x, p.y, 7);
    if (!B.spr(id, A.frameAt(id, t + p.slot * 0.31), p.x, p.y, o)) B.circ(p.x, p.y - 8, 8, 0xe8d8b8ff, 0);
  };

  // Foe e (feet at e.x, e.y): art by def.dirs, white flash on hit, elite: x2 scale over a gold ring; frozen foes hold their frame.
  Ac.foe = (B, e, t, heroes) => {
    const def = ED.FOES[ED.FOE_IDS[e.k]];
    if (!def) return;
    if (def.boss) { Ac.boss(B, e, t, def, heroes); return; }
    const f = foeInfo(def), A = ED.Atlas, o = reset(), ph = e.id * 0.618;
    o.flash = e.flash > 0 ? 1 : 0;
    const sc = e.scale || (e.elite ? 2 : 1); o.sx = o.sy = sc;
    const tt = e.freezeT > 0 ? ph : t + ph;
    if (e.elite) B.circ(e.x, e.y - 2, e.r + 2, 0xffc94a90, 2);
    B.shadow(e.x, e.y, e.r * 0.9);
    let id = null, fi = 0;
    if (f.k === 2) { id = f.walk; o.flip = e.face < 0; fi = A.frameAt(id, tt); }
    else if (f.k === 4) { id = f.walk[dir4(nearAng(e, heroes))]; fi = A.frameAt(id, tt); }
    else if (f.k === 8) { id = f.walk[oct8(nearAng(e, heroes))]; fi = A.frameAt(id, tt); }
    if (!id || !B.spr(id, fi, e.x, e.y, o)) B.circ(e.x, e.y - e.r, e.r, e.flash > 0 ? 0xffffffff : 0xc05050ff, 0);
  };

  // Boss: idle / walk while moving (e.st 0), attack anim through wind-up and action (e.st 1-2). A boss without art draws a labelled placeholder.
  Ac.boss = (B, e, t, def) => {
    const bf = ED.BossFx[def.id];
    if (bf && bf.draw && bf.draw(B, e, t)) return;
    const A = ED.Atlas, o = reset(), p = def.look + '.';
    o.flash = e.flash > 0 ? 1 : 0; o.flip = e.face < 0; o.sx = o.sy = e.scale || 1;
    B.shadow(e.x, e.y, e.r);
    let id = e.st ? (A.has(p + 'attack') ? p + 'attack' : A.has(p + 'attack1') ? p + 'attack1' : p + 'walk') : (A.has(p + 'walk') ? p + 'walk' : p + 'idle');
    if (!A.has(id)) id = p + 'idle';
    if (e.st === 1 && Math.floor(t * 12) % 2) o.flash = Math.max(o.flash, 0.4);
    if (e.enraged) { o.tint = 0xff6060; }
    if (!B.spr(id, A.frameAt(id, t), e.x, e.y, o)) {
      B.circ(e.x, e.y - e.r, e.r, e.flash > 0 ? 0xffffffff : 0x7a3a8cff, 0);
      B.circ(e.x, e.y - e.r, e.r, 0xffd27aff, 2);
      B.text(def.name, e.x, e.y - e.r * 2 - 6, 0xffd27a, 1);
    }
  };

  // Obstacle: a stone disc in the stage wall colour with its prop sprite on top (look '' = a plain rock).
  Ac.obstacle = (B, o, wall) => {
    B.circ(o.x, o.y + 2, o.r + 1, 0x00000066, 0);
    B.circ(o.x, o.y, o.r, wall, 0);
    B.circ(o.x, o.y, o.r, 0x00000088, 1);
    if (o.look) B.spr(o.look, 0, o.x, o.y + Math.min(6, o.r * 0.4), reset());
  };
  // Brazier: animated torch; nothing once broken.
  Ac.brazier = (B, b, t) => {
    if (b.broken) return;
    B.shadow(b.x, b.y, 6);
    const A = ED.Atlas;
    if (!B.spr(b.look, A.frameAt(b.look, t + b.id * 0.37), b.x, b.y, reset())) B.circ(b.x, b.y - 6, 5, 0xff9a3aff, 0);
  };

  // Pickup: gems (larger tiers scaled up), coins, food, magnet, bomb, chest; a gentle bob.
  const PK = { xp1: ['pickup.xp', 1], xp5: ['pickup.xp', 1.5], xp25: ['pickup.xp', 2.2], gold: ['pickup.coin', 1], food: ['pickup.heart', 1.5], magnet: ['pickup.flask.yellow', 1.4], bomb: ['pickup.flask.red', 1.4], chest: ['prop.chest.closed', 1.2] };
  const PKCOL = { xp1: 0x6ad7ffff, xp5: 0x8aff9aff, xp25: 0xff7ad9ff, gold: 0xffd24aff, food: 0xff5a5aff, magnet: 0xffe14aff, bomb: 0xffffffff, chest: 0xc89a4aff };
  Ac.pickup = (B, g, t) => {
    const d = PK[g.k] || PK.xp1, o = reset(), bob = g.k === 'chest' ? 0 : Math.round(Math.sin(t * 4 + g.id) * 1.5);
    o.sx = o.sy = d[1];
    if (g.k === 'xp5') o.tint = 0x8aff9a; else if (g.k === 'xp25') o.tint = 0xff7ad9;
    if (!B.spr(d[0], ED.Atlas.frameAt(d[0], t), g.x, g.y + bob, o)) B.circ(g.x, g.y - 3 + bob, 2 * d[1], PKCOL[g.k] || 0xffffffff, 0);
  };
})(globalThis.ED || (globalThis.ED = {}));
