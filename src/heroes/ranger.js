// Ranger: hero data, signature Longbow (8 levels) + evolution Hail of Arrows, Q Volley (arrow rain), E Snare Trap (3 skill levels each).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU, TICK = ED.CONST.TICK;

  ED.regLook('arrows', 'snare', 'shock');
  ED.addHero({ id: 'ranger', name: 'Ranger', hp: 90, speed: 100, crit: 0.08, sig: 'longbow', skills: ['volley', 'snare'], icon: 'hero.ranger.idle', col: '#9fd38a', txt: 'Arrows at the nearest foe. Fast feet.' });

  // ---------------- Longbow ----------------
  // S.n arrows in a fan (0.12 rad apart) at the nearest foe within S.range; back: the same fan behind; ring: every S.ring-th volley adds a full ring of S.ringN arrows.
  const fan = (w, p, ws, S, opt) => {
    const t = w.nearestFoe(p.x, p.y, S.range);
    if (!t) return false;
    const a = Math.atan2(t.y - p.y, t.x - p.x), n = Math.max(1, S.n | 0);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 0.12;
      w.shoot(p, ws.id, p.x, p.y - 6, a + o, S, opt);
      if (S.back) w.shoot(p, ws.id, p.x, p.y - 6, a + Math.PI + o, S, opt);
    }
    if (S.ring > 0 && (ws.st.shots = (ws.st.shots | 0) + 1) % S.ring === 0) {
      const m = S.ringN | 0;
      for (let i = 0; i < m; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i + 0.5) / m * TAU, S, opt);
    }
    return true;
  };
  const ARROW = { look: 'arrow' };
  ED.addWeapon({
    id: 'longbow', name: 'Longbow', icon: 'weapon.longbow', look: 'arrow', sig: 'ranger', mode: 'nearest', txt: 'Arrows at the nearest foe',
    base: { dmg: 14, cd: 0.9, n: 1, pierce: 0, area: 1, speed: 320, dur: 0, knock: 40, range: 360, ring: 0, ringN: 16 },
    levels: [
      { mods: { n: 1 }, txt: '+1 arrow' },
      { mods: { pierce: 1 }, txt: 'Arrows pierce 1 more foe' },
      { mods: { dmg: 0.25, back: true }, txt: '+25% damage, also fires behind' },
      { mods: { n: 1 }, txt: '+1 arrow' },
      { mods: { pierce: 1, range: 0.25 }, txt: 'Pierce 1 more, +25% range' },
      { mods: { ring: 4 }, txt: 'Every 4th shot: ring of 16 arrows' },
      { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 arrow' },
    ],
    pair: 'multishot', evo: 'hail',
  }, { fire: (w, p, ws, S) => fan(w, p, ws, S, ARROW) });

  // Hail of Arrows: arrows split in three on every hit (splits do not split again); every 3rd volley adds a 24-arrow ring.
  const SPLIT_ST = { split: true }, SPLIT = { look: 'arrow', dmg: 0, pierce: 0, speed: 0, life: 0.45, knock: 20, st: SPLIT_ST };
  const split = (w, pr, e) => {
    if (pr.st === SPLIT_ST) return;
    SPLIT.dmg = pr.dmg * 0.5; SPLIT.speed = pr.sp;
    for (let s = -1; s <= 1; s++) w.shoot(pr.p, pr.wid, e.x, e.y, pr.a + s * 0.55, null, SPLIT).hits.push(e.id);
  };
  const HAIL = { look: 'arrow', onHit: split };
  ED.addWeapon({
    id: 'hail', name: 'Hail of Arrows', icon: 'weapon.twinbows', look: 'arrow', sig: 'ranger', mode: 'nearest', evolved: true, from: 'longbow', txt: 'Arrows split on hit',
    base: { dmg: 22, cd: 0.6, n: 4, pierce: 2, area: 1, speed: 400, dur: 0, knock: 40, range: 430, back: true, ring: 3, ringN: 24 },
    levels: [],
  }, { fire: (w, p, ws, S) => fan(w, p, ws, S, HAIL) });

  // ---------------- skills ----------------
  // Volley: arrow rain on the cursor area: N.dmg per second to foes inside, ticking every 0.2 s for N.dur s. follow: the rain drifts toward the cursor (150 px/s);
  // flank: that many extra rains beside it (perpendicular to the aim, 1.7 r apart).
  const RAIN = { kind: 'zone', noEv: true, knock: 0 };
  const rainTick = (w, z) => {
    const s = z.st;
    if (s.follow && s.p) {
      const I = s.p.in, dx = I.ax - z.x, dy = I.ay - z.y, d = Math.hypot(dx, dy), step = 150 * TICK;
      if (d > step) { z.x += dx / d * step; z.y += dy / d * step; } else { z.x = I.ax; z.y = I.ay; }
    }
    if ((s.tt -= TICK) > 0) return;
    s.tt += 0.2;
    w.blast(s.p, 'volley', z.x, z.y, z.r, s.dps * 0.2, RAIN);
  };
  const rain = (w, p, x, y, N, r) => w.zone({ team: 0, p, wid: 'volley', x, y, r, dur: N.dur, look: 'arrows', st: { p, dps: N.dmg, tt: 0.1, follow: !!N.follow }, onTick: rainTick });
  ED.addSkill({
    id: 'volley', name: 'Volley', icon: 'proj.arrow', cd: 9, txt: 'Arrow rain on the cursor area',
    base: { dmg: 40, r: 80, dur: 2.2, flank: 0 },
    levels: [
      { mods: { r: 0.35 }, txt: '+35% rain area' },
      { mods: { follow: true }, txt: 'Rain follows your cursor' },
      { mods: { flank: 2 }, txt: 'Two more rains flank it' },
    ],
  }, (w, p, x, y, N) => {
    rain(w, p, x, y, N, N.r);
    const a = Math.atan2(y - p.y, x - p.x), f = N.flank | 0;
    for (let i = 0; i < f; i++) { const s = i % 2 ? -1 : 1, d = N.r * 1.7 * (1 + (i >> 1)); rain(w, p, x - Math.sin(a) * d * s, y + Math.cos(a) * d * s, N, N.r * 0.8); }
    return { r: Math.round(N.r), shake: 3 };
  });
  // Snare Trap: a trap at the cursor; foes inside take N.dmg per second and are rooted (stun refreshed every 0.25 s) for N.dur s.
  // pull: foes inside are dragged toward the centre; boom: the trap explodes when it ends (1.3 r, N.boom damage).
  const BOOM = { knock: 380, look: 'snare', kind: 'skill', stun: 0.6 };
  const snareTick = (w, z) => {
    const s = z.st;
    if (!s.pull) return;
    const q = w.foeScan(z.x, z.y, z.r);
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (!e.dead && U.dist2(e.x, e.y, z.x, z.y) <= (z.r + e.r) ** 2) w.knock(e, z.x - e.x, z.y - e.y, 140); }
    w.foeEnd();
  };
  const snareEnd = (w, z) => {
    const s = z.st;
    if (!(s.boom > 0)) return;
    w.blast(s.p, 'snare', z.x, z.y, z.r * 1.3, s.boom, BOOM);
    w.zone({ team: 0, p: s.p, wid: 'snare', x: z.x, y: z.y, r: z.r * 1.3, dur: 0.4, look: 'shock' });
  };
  ED.addSkill({
    id: 'snare', name: 'Snare Trap', icon: 'proj.web', cd: 12, txt: 'Trap that roots foes in a radius',
    base: { dmg: 10, r: 75, dur: 4, boom: 0 },
    levels: [
      { mods: { r: 0.35 }, txt: '+35% trap size' },
      { mods: { pull: true }, txt: 'Snare drags foes to its centre' },
      { mods: { boom: 160 }, txt: 'Trap explodes when it ends' },
    ],
  }, (w, p, x, y, N) => {
    w.zone({ team: 0, p, wid: 'snare', x, y, r: N.r, dur: N.dur, dps: N.dmg, tick: 0.25, stun: 0.35, look: 'snare',
      st: { p, pull: !!N.pull, boom: N.boom > 0 ? N.boom * (1 + p.stats.might) : 0 }, onTick: snareTick, onEnd: snareEnd });
    return { r: Math.round(N.r), shake: 3 };
  });
})(globalThis.ED || (globalThis.ED = {}));
