// Shade: hero data, signature Twin Daggers (facing knives that ricochet) + evolution Shadow Fan (boomerang fan, the return leg always crits), Q Shadow Step, E Fan of Knives.
// Ricochet counts ride on the projectile as a shared constant st (BOUNCE[n]): no allocation per dagger. Zone looks: stepcut (blink slash), afterimg (afterimage).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('stepcut', 'afterimg', 'sknife');

  ED.addHero({ id: 'shade', name: 'Shade', hp: 80, speed: 100, crit: 0.15, sig: 'daggers', skills: ['step', 'fan'], icon: 'hero.shade.idle', col: '#8a9bd6', txt: 'Fast daggers, deadly crits.' });

  // ---------------- Twin Daggers ----------------
  const BOUNCE = []; for (let i = 0; i < 6; i++) BOUNCE.push(Object.freeze({ b: i }));
  let skipPr = null;
  const skipHit = (e) => skipPr.hits.indexOf(e.id) >= 0;
  // On hit: with ricochets left, turn toward the nearest foe not yet hit within 150 px (the dagger survives this hit).
  function ricochet(w, pr, e) {
    const b = pr.st ? pr.st.b : 0;
    if (b <= 0 || pr.pierce > 0) return;
    skipPr = pr;
    const t = w.nearestFoe(pr.x, pr.y, 150, skipHit);
    skipPr = null;
    if (!t) return;
    const a = Math.atan2(t.y - pr.y, t.x - pr.x);
    pr.vx = Math.cos(a) * pr.sp; pr.vy = Math.sin(a) * pr.sp; pr.a = a;
    pr.pierce++; pr.st = BOUNCE[b - 1]; pr.life = Math.max(pr.life, 0.45);
  }
  // Aim of a facing volley along a0: toward the nearest foe within range and AIM_CONE rad of a0, else a0 itself.
  const AIM_CONE = 0.9;
  function coneAim(w, p, a0, range) {
    const q = w.foeScan(p.x, p.y, range);
    let best = null, bd = range * range;
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const d = U.dist2(p.x, p.y, e.x, e.y);
      if (d < bd && Math.abs(U.angDiff(a0, Math.atan2(e.y - p.y, e.x - p.x))) <= AIM_CONE) { bd = d; best = e; }
    }
    w.foeEnd();
    return best ? Math.atan2(best.y - p.y, best.x - p.x) : a0;
  }
  // S.n daggers along the facing direction, bent toward a foe inside the 0.9 rad aim cone (staggered 5 px, spread 0.06 rad); back: as many behind. Fires only when a foe is within range.
  function volley(w, p, ws, S) {
    if (!w.nearestFoe(p.x, p.y, S.range)) return false;
    const n = Math.max(1, S.n | 0), b = BOUNCE[Math.min(5, S.bounce | 0)], opt = OPT;
    opt.st = b; opt.onHit = b.b > 0 ? ricochet : null;
    for (let side = 0; side < (S.back ? 2 : 1); side++) {
      const a0 = coneAim(w, p, p.mdir + side * Math.PI, S.range);
      for (let i = 0; i < n; i++) { const o = i - (n - 1) / 2; w.shoot(p, ws.id, p.x - Math.sin(a0) * o * 5, p.y - 6 + Math.cos(a0) * o * 5, a0 + o * 0.06, S, opt); }
    }
    return true;
  }
  const OPT = { look: 'knife', st: null, onHit: null };
  ED.addWeapon({
    id: 'daggers', name: 'Twin Daggers', icon: 'weapon.daggers', look: 'knife', sig: 'shade', mode: 'facing', txt: 'Fast daggers where you face',
    base: { dmg: 12, cd: 0.6, n: 2, pierce: 0, area: 1, speed: 420, dur: 0, knock: 10, range: 300, crit: 0.1, bounce: 0 },
    levels: [
      { mods: { n: 1 }, txt: '+1 dagger' },
      { mods: { pierce: 1 }, txt: 'Daggers pierce 1 more foe' },
      { mods: { dmg: 0.25, back: true }, txt: '+25% damage, also throws behind' },
      { mods: { n: 1 }, txt: '+1 dagger' },
      { mods: { bounce: 1 }, txt: 'Daggers ricochet to another foe' },
      { mods: { n: 1, pierce: 1 }, txt: '+1 dagger, pierce 1 more foe' },
      { mods: { dmg: 0.25, bounce: 1, crit: 0.1 }, txt: '+25% dmg, +1 ricochet, +10% crit' },
    ],
    pair: 'velocity', evo: 'shadowfan',
  }, { fire: volley });

  // Shadow Fan: S.n boomerang daggers in a fan toward the facing direction and a mirrored fan behind; they pierce everything and always crit on the way back.
  function backCrit(w, pr) { if (pr.back) pr.critC = 1; }
  const FAN_OPT = { look: 'sknife', pierce: 999, ret: true, tick: backCrit };
  ED.addWeapon({
    id: 'shadowfan', name: 'Shadow Fan', icon: 'weapon.knives', look: 'sknife', sig: 'shade', mode: 'facing', evolved: true, from: 'daggers', txt: 'Daggers return and crit twice',
    base: { dmg: 20, cd: 0.8, n: 5, pierce: 999, area: 1, speed: 460, dur: 0, knock: 30, range: 440, crit: 0.2 },
    levels: [],
  }, {
    fire(w, p, ws, S) {
      if (!w.nearestFoe(p.x, p.y, S.range * 0.6)) return false;
      const n = Math.max(1, S.n | 0), spread = Math.min(0.28, 1.6 / n);
      for (let side = 0; side < 2; side++) {
        const a0 = p.mdir + side * Math.PI;
        for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a0 + (i - (n - 1) / 2) * spread, S, FAN_OPT);
      }
      return true;
    },
  });

  // ---------------- Shadow Step ----------------
  // Blinks toward the cursor (40..N.dist px, through foes and over obstacles), cutting every foe within N.w / 2 of the path (forced crit, shoved aside), invulnerable 0.35 s.
  // The afterimage left at the start detonates after N.dur s (N.r radius, N.dmg x 1.5); knives: it throws 3 knives at the nearest foes every 0.2 s until then.
  // recast: the first cast opens a 2.5 s window in which Q blinks again at no cost (hook tick; the cooldown resumes if unused).
  ED.addSkill({
    id: 'step', name: 'Shadow Step', icon: 'fx.smoke', cd: 7, txt: 'Blink, cut the path, leave a decoy',
    base: { dmg: 45, r: 64, dur: 0.8, dist: 180, w: 30 },
    levels: [
      { mods: { knives: true }, txt: 'Afterimage throws knives' },
      { mods: { dist: 80, dmg: 0.4 }, txt: '+80 blink range, +40% damage' },
      { mods: { recast: true }, txt: 'Recast once within 2.5 s' },
    ],
  }, (w, p, x, y, N) => {
    let a = Math.atan2(y - p.y, x - p.x), d = Math.hypot(x - p.x, y - p.y);
    if (d < 1) a = p.mdir;
    d = U.clamp(d, 40, N.dist);
    const ox = p.x, oy = p.y;
    p.x += Math.cos(a) * d; p.y += Math.sin(a) * d; ED.Arena.collide(w.arena, p, p.r);
    p.invuln = Math.max(p.invuln, 0.35); p.mdir = a;
    const len = Math.hypot(p.x - ox, p.y - oy) || 1;
    cut(w, p, ox, oy, p.x, p.y, N.w / 2, N.dmg, a);
    w.zone({ team: 0, p, wid: 'step', x: ox, y: oy, a, len, w: N.w, dur: 0.3, look: 'stepcut' });
    w.zone({ team: 0, p, wid: 'step', x: ox, y: oy, r: N.r, a, dur: N.dur, warn: true, dmg: N.dmg * 1.5, knock: 240, look: 'afterimg',
      st: N.knives ? { kt: 0, dmg: N.dmg * 0.35 } : null, onTick: N.knives ? afterKnives : null });
    w.hitBraziers(p.x, p.y, 24, p);
    if (N.recast) { if (p.stepRe > 0) p.stepRe = 0; else { p.stepRe = 2.5; p.stepArm = true; } }
    return { x0: Math.round(ox), y0: Math.round(oy), a, shake: 4 };
  });
  // Segment cut (x0, y0) -> (x1, y1) of half width hw: every foe touching it takes dmg as a forced crit, shoved perpendicular away from the path.
  function cut(w, p, x0, y0, x1, y1, hw, dmg, a) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + hw, q = w.foeScan(mx, my, R);
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const m = hw + e.r; if (U.segDist2(e.x, e.y, x0, y0, x1, y1) > m * m) continue;
      const side = U.angDiff(a, Math.atan2(e.y - y0, e.x - x0)) > 0 ? 1 : -1, s = w.src(p, 'step', 'skill', 220);
      s.crit = true; s.kx = -Math.sin(a) * side; s.ky = Math.cos(a) * side;
      w.hitFoe(e, dmg, s);
      if (!e.dead) w.stun(e, 0.4);
    }
    w.foeEnd();
  }
  const KNIFE = { look: 'knife', dmg: 0, speed: 420, pierce: 1, life: 0.6, knock: 20 };
  function afterKnives(w, z) {
    const st = z.st;
    for (st.kt += 1 / 60; st.kt >= 0.2; st.kt -= 0.2) {
      KNIFE.dmg = st.dmg;
      for (let i = 0; i < 3; i++) {
        const t = w.target('random', z.p, 220);
        const a = t ? Math.atan2(t.y - z.y, t.x - z.x) : w.rng.next() * TAU;
        w.shoot(z.p, 'step', z.x, z.y - 8, a, null, KNIFE);
      }
    }
  }

  // ---------------- Fan of Knives ----------------
  // N.n knives in a full circle (pierce 2); waves: extra rings 0.18 s later, offset half a step (hook tick); ret: knives fly back through foes (pierce all).
  ED.addSkill({
    id: 'fan', name: 'Fan of Knives', icon: 'weapon.knives', cd: 10, txt: '24 knives in a full circle',
    base: { dmg: 22, n: 24, speed: 360, range: 300, waves: 1 },
    levels: [
      { mods: { n: 12 }, txt: '+12 knives' },
      { mods: { waves: 1 }, txt: 'A second ring follows' },
      { mods: { ret: true, dmg: 0.25 }, txt: 'Knives fly back, +25% damage' },
    ],
  }, (w, p, x, y, N) => {
    ring(w, p, N, 0);
    p.fanQ = Math.max(0, (N.waves | 0) - 1); p.fanT = 0.18; p.fanO = 0.5;
    return { shake: 4 };
  });
  const FOPT = { look: 'knife', dmg: 0, speed: 0, pierce: 2, life: 1, knock: 40, ret: false };
  function ring(w, p, N, off) {
    const n = Math.max(1, N.n | 0);
    FOPT.dmg = N.dmg; FOPT.speed = N.speed; FOPT.ret = !!N.ret; FOPT.pierce = N.ret ? 999 : 2; FOPT.life = N.range / N.speed * (N.ret ? 2 : 1);
    for (let i = 0; i < n; i++) w.shoot(p, 'fan', p.x, p.y - 6, (i + off) / n * TAU, null, FOPT);
  }

  ED.HOOK.shade = {
    init(w, p) { p.stepRe = 0; p.stepArm = false; p.stepRest = 0; p.fanQ = 0; p.fanT = 0; p.fanO = 0; },
    tick(w, p, dt) {
      const sk = p.skills[0];
      if (p.stepArm) { p.stepArm = false; p.stepRest = sk.cd; sk.cd = 0; }
      else if (p.stepRe > 0) { p.stepRe -= dt; p.stepRest -= dt; if (p.stepRe <= 0) sk.cd = Math.max(0, p.stepRest); }
      if (p.fanQ > 0 && (p.fanT -= dt) <= 0) {
        p.fanQ--; p.fanT = 0.18;
        ring(w, p, w.skillN(p, 1), p.fanO); p.fanO = p.fanO ? 0 : 0.5;
      }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
