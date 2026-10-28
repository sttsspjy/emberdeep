// Shade: hero data, signature Twin Daggers (facing knives that ricochet; 3 paths x 3 ranks) + Form Shadow Fan (path 0; boomerang fan, the return leg always crits), Q Shadow Step.
// Ricochet counts ride on the projectile as a shared constant st (BOUNCE[n]): no allocation per dagger. Zone looks: stepcut (blink slash), afterimg (afterimage).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('stepcut', 'afterimg', 'sknife');

  ED.addHero({ id: 'shade', name: 'Shade', hp: 80, speed: 80, crit: 0.15, sig: 'daggers', skills: ['step'], icon: 'hero.shade.idle', col: '#8a9bd6', txt: 'Fast daggers, deadly crits.' });

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
  // Facing volleys bend toward the nearest foe within AIM_CONE rad of their direction, else toward the nearest foe in range (w.facingAim).
  const AIM_CONE = 0.9;
  // S.n daggers along the facing direction, bent toward a foe inside the 0.9 rad aim cone, else the nearest foe (staggered 5 px, spread 0.06 rad);
  // back: as many opposite the front volley, bent toward a foe inside the rear aim cone. With no foe in range the volley flies along p.mdir.
  function volley(w, p, ws, S) {
    const n = Math.max(1, S.n | 0), b = BOUNCE[Math.min(5, S.bounce | 0)], opt = OPT;
    opt.st = b; opt.onHit = b.b > 0 ? ricochet : null;
    const af = w.facingAim(p, p.mdir, S.range, AIM_CONE);
    for (let side = 0; side < (S.back ? 2 : 1); side++) {
      let a0 = af;
      if (side) { a0 = w.coneFoe(p, af + Math.PI, S.range, AIM_CONE); if (a0 === null) a0 = af + Math.PI; }
      for (let i = 0; i < n; i++) { const o = i - (n - 1) / 2; w.shoot(p, ws.id, p.x - Math.sin(a0) * o * 5, p.y - 6 + Math.cos(a0) * o * 5, a0 + o * 0.06, S, opt); }
    }
    return true;
  }
  const OPT = { look: 'knife', st: null, onHit: null };
  ED.addWeapon({
    id: 'daggers', name: 'Twin Daggers', icon: 'weapon.daggers', look: 'knife', sig: 'shade', mode: 'facing', txt: 'Fast daggers where you face',
    base: { dmg: 12, cd: 0.6, n: 2, pierce: 0, area: 1, speed: 420, dur: 0, knock: 10, range: 300, crit: 0.1, bounce: 0 },
    paths: [
      { id: 'flurry', name: 'Flurry', form: 'shadowfan', ranks: [
        { mods: { n: 1 }, txt: '+1 dagger' },
        { mods: { n: 1 }, txt: '+1 dagger' },
        { mods: { n: 1, pierce: 1 }, txt: '+1 dagger, pierce 1 more foe' }] },
      { id: 'ricochet', name: 'Ricochet', form: null, ranks: [
        { mods: { bounce: 1 }, txt: 'Daggers ricochet to another foe' },
        { mods: { dmg: 0.25, bounce: 1, crit: 0.1 }, txt: '+25% dmg, +1 ricochet, +10% crit' },
        { mods: { pierce: 1 }, txt: 'Daggers pierce 1 more foe' }] },
      { id: 'backstab', name: 'Backstab', form: null, ranks: [
        { mods: { dmg: 0.25, back: true }, txt: '+25% damage, also throws behind' },
        { mods: { pierce: 1 }, txt: 'Daggers pierce 1 more foe' },
        { mods: { crit: 0.1 }, txt: '+10% crit chance' }] },
    ],
    hybrids: [],
  }, { fire: volley });

  // Shadow Fan: S.n boomerang daggers in a fan toward the facing aim (w.facingAim, p.mdir without a foe) and a mirrored fan behind; they pierce everything and always crit on the way back.
  function backCrit(w, pr) { if (pr.back) pr.critC = 1; }
  const FAN_OPT = { look: 'sknife', pierce: 999, ret: true, tick: backCrit };
  ED.addWeapon({
    id: 'shadowfan', name: 'Shadow Fan', icon: 'weapon.knives', look: 'sknife', sig: 'shade', mode: 'facing', evolved: true, form: true, from: 'daggers', txt: 'Daggers return and crit twice',
    base: { dmg: 20, cd: 0.8, n: 5, pierce: 999, area: 1, speed: 460, dur: 0, knock: 30, range: 440, crit: 0.2 },
    refine: [
      { mods: { n: 2 }, txt: '+2 daggers' },
      { mods: { dmg: 0.25, crit: 0.1 }, txt: '+25% damage, +10% crit' },
    ],
  }, {
    fire(w, p, ws, S) {
      const n = Math.max(1, S.n | 0), spread = Math.min(0.28, 1.6 / n);
      const af = w.facingAim(p, p.mdir, S.range);
      for (let side = 0; side < 2; side++) {
        const a0 = af + side * Math.PI;
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
    base: { dmg: 45, r: 64, dur: 0.8, dist: 130, w: 30 },
    levels: [
      { mods: { knives: true }, txt: 'Afterimage throws knives' },
      { mods: { dist: 50, dmg: 0.4 }, txt: '+50 blink range, +40% damage' },
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

  ED.HOOK.shade = {
    init(w, p) { p.stepRe = 0; p.stepArm = false; p.stepRest = 0; },
    tick(w, p, dt) {
      const sk = p.skills[0];
      if (p.stepArm) { p.stepArm = false; p.stepRest = sk.cd; sk.cd = 0; }
      else if (p.stepRe > 0) { p.stepRe -= dt; p.stepRest -= dt; if (p.stepRe <= 0) sk.cd = Math.max(0, p.stepRest); }
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
