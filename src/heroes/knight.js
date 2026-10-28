// Knight: hero data, signature Cleave (8 levels) + evolution Whirlwind, Q Shield Charge, E Bulwark (3 skill levels each).
// Visual-state zones (networked like any zone, drawn by hfx-a.js): 'charge' follows the hero during a charge (a = heading), 'bulwark' follows it while braced.
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;

  ED.regLook('crescent', 'charge', 'bulwark', 'shock', 'slash', 'whirl');
  ED.addHero({ id: 'knight', name: 'Knight', hp: 130, speed: 85, crit: 0.05, sig: 'cleave', skills: ['charge', 'bulwark'], icon: 'hero.knight.idle', col: '#c9d4e8', txt: 'Sword and shield. Holds the line.' });

  // ---------------- Cleave ----------------
  // A sword arc toward the nearest foe in reach within ED.FACING_CONE of the movement direction (with back: of either direction), else toward the nearest foe in reach; holds (retry 0.1 s) while none.
  // Custom numbers: arc (rad), back (also swings behind), wave (each swing flings that many piercing crescents). S.n swings: the first at once, the rest 0.15 s apart, alternating 0.3 rad either side.
  const WAVE = { look: 'crescent', speed: 250, dmg: 0, pierce: 999, r: 12, life: 0.5, knock: 0 };
  const wave = (w, p, ws, S, a, k) => {
    WAVE.dmg = S.dmg * (k || 0.6); WAVE.r = 11 * S.area; WAVE.knock = S.knock * 0.5; WAVE.life = 0.42 * Math.sqrt(S.area);
    w.shoot(p, ws.id, p.x + Math.cos(a) * 14, p.y - 4 + Math.sin(a) * 14, a, S, WAVE);
  };
  const ARC = { knock: 0, look: 'slash' };
  const swing = (w, p, ws, S, a) => {
    ARC.knock = S.knock;
    w.arc(p, ws.id, p.x, p.y - 4, a, S.range * S.area, S.arc, S.dmg, ARC);
    for (let i = 0; i < (S.wave | 0); i++) wave(w, p, ws, S, a + (i - ((S.wave | 0) - 1) / 2) * 0.35);
  };
  const swings = (w, p, ws, S, a) => { swing(w, p, ws, S, a); if (S.back) swing(w, p, ws, S, a + Math.PI); };
  ED.addWeapon({
    id: 'cleave', name: 'Cleave', icon: 'weapon.longsword', sig: 'knight', mode: 'facing', txt: 'Sword arc toward your facing',
    base: { dmg: 18, cd: 1.3, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 120, range: 56, arc: 2.0, wave: 0 },
    levels: [
      { mods: { area: 0.2 }, txt: '+20% swing size' },
      { mods: { back: true }, txt: 'Also swings behind you' },
      { mods: { dmg: 0.25, arc: 0.6 }, txt: '+25% damage, wider arc' },
      { mods: { n: 1 }, txt: '+1 swing' },
      { mods: { wave: 1 }, txt: 'Swings fling a piercing wave' },
      { mods: { area: 0.25, knock: 0.5 }, txt: '+25% size, harder knockback' },
      { mods: { dmg: 0.25, n: 1, wave: 2 }, txt: '+25% damage, +1 swing, 3 waves' },
    ],
    pair: 'might', evo: 'whirlwind', noAmount: true,
  }, {
    fire(w, p, ws, S) {
      const R = S.range * S.area + 24 + ((S.wave | 0) ? 90 : 0);
      let a = w.coneFoe(p, p.mdir, R);
      if (a === null && S.back) { a = w.coneFoe(p, p.mdir + Math.PI, R); if (a !== null) a += Math.PI; }
      if (a === null) a = w.nearAngle(p, R);
      if (a === null) return false;
      swings(w, p, ws, S, a);
      ws.st.left = (S.n | 0) - 1; ws.st.t = 0.15; ws.st.a = a;
      return true;
    },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (!(st.left > 0) || (st.t -= dt) > 0) return;
      st.t = 0.15; st.left--;
      swings(w, p, ws, S, st.a + (st.left % 2 ? 0.3 : -0.3));
    },
  });
  // Whirlwind: S.n 360 degree spins 0.2 s apart around the hero; each spin flings S.wave crescents outward, rotated half a step per spin.
  const spin = (w, p, ws, S, k) => {
    ARC.knock = S.knock; ARC.look = 'whirl';
    w.arc(p, ws.id, p.x, p.y - 4, 0, S.range * S.area, TAU, S.dmg, ARC);
    ARC.look = 'slash';
    const n = S.wave | 0;
    for (let i = 0; i < n; i++) wave(w, p, ws, S, (i + (k % 2) * 0.5) / n * TAU, 0.5);
  };
  ED.addWeapon({
    id: 'whirlwind', name: 'Whirlwind', icon: 'weapon.alt.double_axe', sig: 'knight', mode: 'around', evolved: true, from: 'cleave', txt: '360 degree spins',
    base: { dmg: 34, cd: 1.0, n: 3, pierce: 0, area: 1.45, speed: 0, dur: 0, knock: 160, range: 60, arc: TAU, wave: 6 },
    levels: [], noAmount: true,
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range * S.area + 110)) return false;
      spin(w, p, ws, S, 0);
      ws.st.left = (S.n | 0) - 1; ws.st.t = 0.2; ws.st.k = 0;
      return true;
    },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (!(st.left > 0) || (st.t -= dt) > 0) return;
      st.t = 0.2; st.left--;
      spin(w, p, ws, S, ++st.k);
    },
  });

  // ---------------- skills ----------------
  // Shield Charge: rush toward the aim point (N.dist px over N.t s, untouchable); every foe within N.width of the path takes N.dmg once, is knocked aside and stunned N.stun s.
  // quake: ends in a shockwave (r 110); shards: the shockwave hurls that many shields outward.
  const SHARD = { look: 'shield', speed: 300, dmg: 0, pierce: 4, r: 7, life: 0.7, knock: 160 };
  const BOOM = { knock: 0, look: 'shock', kind: 'skill', stun: 0 };
  // Visual-only shockwave zone (no damage; hfx-a.js draws an expanding ring).
  const shockFx = (w, p, wid, x, y, r) => w.zone({ team: 0, p, wid, x, y, r, dur: 0.4, look: 'shock' });
  ED.addSkill({
    id: 'charge', name: 'Shield Charge', icon: 'shield.kite', cd: 7, txt: 'Charge through the horde',
    base: { dmg: 45, dist: 110, t: 0.24, stun: 0.7, width: 30, shards: 0 },
    levels: [
      { mods: { dist: 40, width: 12 }, txt: '+40 distance, wider path' },
      { mods: { quake: true }, txt: 'Ends in a big shockwave' },
      { mods: { shards: 10 }, txt: 'Shockwave hurls 10 shields' },
    ],
  }, (w, p, x, y, N) => {
    const a = Math.atan2(y - p.y, x - p.x);
    const c = p.chg || (p.chg = { a: 0, t: 0, v: 0, dmg: 0, stun: 0, width: 0, quake: false, shards: 0, hits: [] });
    c.a = a; c.t = N.t; c.v = N.dist / N.t; c.dmg = N.dmg; c.stun = N.stun; c.width = N.width; c.quake = !!N.quake; c.shards = N.shards | 0; c.hits.length = 0; c.on = true;
    p.invuln = Math.max(p.invuln, N.t + 0.15);
    w.zone({ team: 0, p, wid: 'charge', x: p.x, y: p.y, r: N.width, a, dur: N.t + 0.08, follow: p.pid, look: 'charge' });
    return { a, shake: 5, stop: 0.04 };
  });
  // Bulwark: N.dur s of N.dr damage reduction and a shockwave (N.r, knock N.knock, stun 0.4 s); pulse: another shockwave every second; end: a 1.5x blast when it ends.
  const bulTick = (w, z) => {
    const s = z.st, p = s.p;
    if (!s.pulse || !w.alive(p)) return;
    s.nt -= ED.CONST.TICK;
    if (s.nt <= 0) { s.nt = 1; BOOM.knock = s.knock * 0.7; BOOM.stun = 0.25; w.blast(p, 'bulwark', p.x, p.y, s.r * 0.85, s.dmg * 0.6, BOOM); shockFx(w, p, 'bulwark', p.x, p.y, s.r * 0.85); }
  };
  const bulEnd = (w, z) => {
    const s = z.st, p = s.p;
    if (s.end && w.alive(p)) { BOOM.knock = s.knock * 1.3; BOOM.stun = 0.8; w.blast(p, 'bulwark', p.x, p.y, s.r * 1.5, s.dmg * 3, BOOM); shockFx(w, p, 'bulwark', p.x, p.y, s.r * 1.5); }
  };
  ED.addSkill({
    id: 'bulwark', name: 'Bulwark', icon: 'shield.tower', cd: 14, txt: 'Brace and push the horde back',
    base: { dmg: 30, r: 110, dur: 3, dr: 0.6, knock: 420 },
    levels: [
      { mods: { r: 0.4 }, txt: '+40% shockwave size' },
      { mods: { pulse: true }, txt: 'Pulses a shockwave every second' },
      { mods: { dr: 0.15, end: true }, txt: 'Ends in a huge blast, +15% guard' },
    ],
  }, (w, p, x, y, N) => {
    p.bulT = N.dur; p.bulDr = Math.min(0.9, N.dr);
    BOOM.knock = N.knock; BOOM.stun = 0.4;
    w.blast(p, 'bulwark', p.x, p.y, N.r, N.dmg, BOOM);
    shockFx(w, p, 'bulwark', p.x, p.y, N.r);
    w.zone({ team: 0, p, wid: 'bulwark', x: p.x, y: p.y, r: 22, dur: N.dur, follow: p.pid, look: 'bulwark',
      st: { p, r: N.r, dmg: N.dmg, knock: N.knock, pulse: !!N.pulse, end: !!N.end, nt: 1 }, onTick: bulTick, onEnd: bulEnd });
    return { shake: 6, stop: 0.06, r: Math.round(N.r) };
  });

  ED.HOOK.knight = {
    init(w, p) { p.chg = null; p.bulT = 0; p.bulDr = 0; },
    tick(w, p, dt) {
      if (p.bulT > 0) { p.bulT -= dt; p.dr = p.bulT > 0 ? p.bulDr : 0; }
      const c = p.chg;
      if (!c || !c.on) return;
      const step = Math.min(dt, c.t);
      ED.Arena.move(w.arena, p, Math.cos(c.a) * c.v * step, Math.sin(c.a) * c.v * step, p.r);
      p.moving = true; p.mdir = c.a;
      const q = w.foeScan(p.x, p.y, c.width);
      for (let k = 0; k < q.length; k++) {
        const e = q[k];
        if (e.dead || c.hits.indexOf(e.id) >= 0 || U.dist2(p.x, p.y, e.x, e.y) > (c.width + e.r) ** 2) continue;
        c.hits.push(e.id);
        const side = U.angDiff(c.a, Math.atan2(e.y - p.y, e.x - p.x)) > 0 ? 1 : -1, s = w.src(p, 'charge', 'skill', 0);
        w.hitFoe(e, c.dmg, s);
        if (!e.dead) { w.knock(e, Math.cos(c.a + side * 1.2), Math.sin(c.a + side * 1.2), 420); w.stun(e, c.stun); }
      }
      w.foeEnd();
      w.hitBraziers(p.x, p.y, c.width, p);
      c.t -= dt;
      if (c.t > 0) return;
      c.on = false;
      if (!c.quake) return;
      BOOM.knock = 340; BOOM.stun = c.stun;
      w.blast(p, 'charge', p.x, p.y, 110, c.dmg * 0.8, BOOM);
    shockFx(w, p, 'charge', p.x, p.y, 110);
      SHARD.dmg = c.dmg * 0.5;
      for (let i = 0; i < c.shards; i++) w.shoot(p, 'charge', p.x, p.y - 6, c.a + i / c.shards * TAU, null, SHARD);
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
