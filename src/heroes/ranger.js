// Ranger (marksman): hero data, signature Longbow (paths Spread / Piercer / Ricochet) and its Forms Hail of Arrows (Spread), Ballista (Piercer), Seeker (Ricochet),
// hybrids Gale Barrage (Piercer + Spread) and Rebound (Piercer + Ricochet); Q Vault (leap toward the cursor, 3 skill levels).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;

  ED.regLook('vault', 'vland', 'caltrops', 'shock');
  ED.addHero({ id: 'ranger', name: 'Ranger', hp: 90, speed: 80, crit: 0.08, sig: 'longbow', skills: ['vault'], icon: 'hero.ranger.idle', col: '#9fd38a', txt: 'Piercing arrows down long lines.' });

  // ---------------- shared arrow mechanics ----------------
  // Projectile fields used here: pr.st = bounces left (number), pr.rk = per-arrow counter (Seeker kill refreshes, Rebound segment pierce); pr.dmg drops from x FIRST to x1 after the first hit.
  const PROJ_SOFT_CAP = 600;  // spawn-on-hit / on-kill arrows stop above this many live projectiles
  const FIRST = 1.5;          // an arrow's first hit deals x1.5
  const HOP = 170;            // bounce / kill-shot search radius (px)
  const FAN = 0.18;           // rad between fan arrows
  const FANK = 0.25;          // a fan of n arrows deals (1 + FANK (n - 1)) x one arrow in total
  const KSN = 2;              // kill shots per volley (S.kshot)
  const HEAVY = 1.25;         // heavy bolt: x HEAVY damage, always crits, x2 radius, pierce +4
  // Second aim (S.two): toward the nearest foe within range in view at least TWO_OFF rad off the cursor line a, else a + TWO_OFF.
  const TWO_OFF = 0.35;
  let TA = 0, TX = 0, TY = 0;
  const onLine = (e) => Math.abs(U.angDiff(TA, Math.atan2(e.y - TY, e.x - TX))) < TWO_OFF;
  const twoAim = (w, p, a, range) => { TA = a; TX = p.x; TY = p.y; const e = w.heroFoe(p, range, onLine); return e ? Math.atan2(e.y - (p.y - 6), e.x - p.x) : a + TWO_OFF; };
  let skipHits = null;
  const skipHit = (f) => skipHits.indexOf(f.id) >= 0;
  // Nearest foe within HOP of (x, y) that projectile pr has not hit (view-clamped by w.vclamp), or null.
  const nextFoe = (w, pr, x, y) => { skipHits = pr.hits; const e = w.nearestFoe(x, y, HOP, skipHit); skipHits = null; return e; };
  const steer = (pr, a) => { pr.vx = Math.cos(a) * pr.sp; pr.vy = Math.sin(a) * pr.sp; pr.a = a; };
  // Shared onHit: the first-hit bonus ends; on the last pierce with bounces left (pr.st) the arrow turns to the nearest unhit foe within HOP and flies on.
  const bounce = (w, pr, e) => {
    if (pr.hits.length === 1) pr.dmg /= FIRST;
    if (pr.pierce > 0 || !(pr.st > 0)) return;
    const t = nextFoe(w, pr, e.x, e.y);
    if (!t) return;
    pr.st--; pr.pierce = 1;
    steer(pr, Math.atan2(t.y - e.y, t.x - e.x));
    pr.life = Math.max(pr.life, HOP / pr.sp + 0.1);
  };
  // Arrow from hero p along a with damage x k (x FIRST until its first hit); heavy: see HEAVY. Sets pr.st = S.bounce x opt.bk (default 1).
  const loose = (w, p, wid, a, S, opt, k, heavy) => {
    const pr = w.shoot(p, wid, p.x, p.y - 6, a, S, opt);
    pr.dmg *= FIRST * k * (heavy ? HEAVY : 1); pr.st = (S.bounce * (opt.bk !== undefined ? opt.bk : 1)) | 0; pr.rk = 0;
    if (heavy) { pr.r *= 2; pr.critC = 1; pr.pierce += 4; }
    return pr;
  };
  // m arrows in a fan (spread apart) around angle a; arrow indices i0 .. i0 + m - 1; the arrow with index hv is heavy.
  const fanAt = (w, p, ws, S, opt, a, m, i0, spread, k, hv) => {
    for (let i = 0; i < m; i++) loose(w, p, ws.id, a + (i - (m - 1) / 2) * spread, S, opt, k, i0 + i === hv);
  };
  // One volley: S.n arrows in a fan along the cursor (w.aimDir; two: the second half fans along twoAim), the fan dealing (1 + fk (n - 1)) x one arrow in total;
  // every S.heavy-th volley the first arrow is heavy; refills the kill-shot budget.
  const volley = (w, p, ws, S, opt, spread, fk) => {
    const n = Math.max(1, S.n | 0), st = ws.st, k = (1 + fk * (n - 1)) / n, a = w.aimDir(p);
    st.shots = (st.shots | 0) + 1; st.kb = KSN;
    const hv = S.heavy > 0 && st.shots % Math.max(1, S.heavy | 0) === 0 ? 0 : -1;
    if (!S.two || n < 2) { fanAt(w, p, ws, S, opt, a, n, 0, spread, k, hv); return; }
    const nA = (n + 1) >> 1;
    fanAt(w, p, ws, S, opt, a, nA, 0, spread, k, hv);
    fanAt(w, p, ws, S, opt, twoAim(w, p, a, S.range), n - nA, nA, spread, k, hv);
  };
  // Kill shot (S.kshot): a foe the Ranger kills looses an arrow from its body at the nearest foe within HOP (60% damage, 1 pierce, S.bounce bounces); KSN per volley.
  const KS = { look: 'arrow', dmg: 0, pierce: 1, speed: 420, life: HOP / 420 + 0.15, onHit: bounce };
  const killShot = (w, p, ws, S, e) => {
    const st = ws.st;
    if (!(S.kshot > 0) || !(st.kb > 0) || w.projs.length > PROJ_SOFT_CAP) return;
    const v = w.vclamp; w.vclamp = p;
    const t = w.nearestFoe(e.x, e.y, HOP, null);
    w.vclamp = v;
    if (!t || t === e) return;
    st.kb--;
    KS.dmg = S.dmg * 0.6 * FIRST;
    const pr = w.shoot(p, ws.id, e.x, e.y, Math.atan2(t.y - e.y, t.x - e.x), S, KS);
    pr.st = S.bounce | 0; pr.rk = 0;
  };

  // ---------------- Longbow ----------------
  // S.n arrows in a fan along the cursor; arrows pierce S.pierce foes and hit their first foe x FIRST.
  // Path keys: heavy (every heavy-th volley's first arrow is a heavy bolt), two (the fan splits between two targets), bounce (bounces after the last pierce), kshot (kills loose arrows).
  const ARROW = { look: 'arrow', onHit: bounce };
  ED.addWeapon({
    id: 'longbow', name: 'Longbow', icon: 'weapon.longbow', look: 'arrow', sig: 'ranger', mode: 'cursor', txt: 'Piercing arrows toward your cursor',
    base: { dmg: 20, cd: 0.55, n: 1, pierce: 8, area: 1, speed: 420, dur: 0, knock: 25, range: 300, heavy: 0, two: false, bounce: 0, kshot: 0 },
    paths: [
      { id: 'spread', name: 'Spread', form: 'hail', ranks: [
        { mods: { n: 2 }, txt: '+2 arrows in a fan' },
        { mods: { two: true }, txt: 'The fan splits over two targets' },
        { mods: { dmg: 0.25, n: 2 }, txt: '+25% damage, +2 arrows' }] },
      { id: 'pierce', name: 'Piercer', form: 'ballista', ranks: [
        { mods: { pierce: 4, range: 0.2 }, txt: 'Arrows pierce 4 more, fly farther' },
        { mods: { heavy: 3 }, txt: 'Every 3rd shot: a heavy bolt' },
        { mods: { dmg: 0.25, heavy: -1 }, txt: '+25% damage, every 2nd shot heavy' }] },
      { id: 'ricochet', name: 'Ricochet', form: 'seeker', ranks: [
        { mods: { bounce: 2 }, txt: 'Arrows bounce to 2 more foes' },
        { mods: { kshot: 1 }, txt: 'Kills loose an arrow at the next foe' },
        { mods: { dmg: 0.25, bounce: 2 }, txt: '+25% damage, +2 bounces' }] },
    ],
    hybrids: [{ need: [0, 1], form: 'galeshot' }, { need: [1, 2], form: 'rebound' }],
  }, {
    fire: (w, p, ws, S) => { volley(w, p, ws, S, ARROW, FAN, FANK); return true; },
    kill: killShot,
  });

  // Hail of Arrows (Spread): a fan of full-damage arrows (0.14 rad apart, pierce at most HAIL_P, half the bounces); an arrow's first hit splits off 3 arrows fanning forward
  // (SPLITK damage, 2 pierce; splits do not split).
  const HAIL_P = 3;
  const SPLITK = 0.8;
  const SPLIT = { look: 'arrow', dmg: 0, pierce: 2, speed: 0, life: 0.4, knock: 20, r: 3, onHit: null };
  const split = (w, pr, e) => {
    const first = pr.hits.length === 1, d = pr.dmg / FIRST;
    bounce(w, pr, e);
    if (!first || w.projs.length > PROJ_SOFT_CAP) return;
    SPLIT.dmg = d * SPLITK; SPLIT.speed = pr.sp;
    for (let s = -1; s <= 1; s++) { const c = w.shoot(pr.p, pr.wid, e.x, e.y, pr.a + s * 0.45, null, SPLIT); c.st = 0; c.rk = 0; c.hits.push(e.id); }
  };
  const HAIL = { look: 'arrow', pierce: 0, bk: 0.5, onHit: split };
  ED.addWeapon({
    id: 'hail', name: 'Hail of Arrows', icon: 'weapon.twinbows', look: 'arrow', sig: 'ranger', mode: 'cursor', evolved: true, form: true, from: 'longbow', txt: 'Arrows split on hit',
    base: { dmg: 22, cd: 0.7, n: 3, pierce: 1, area: 1, speed: 440, dur: 0, knock: 30, range: 320, heavy: 0, two: false, bounce: 0, kshot: 0 },
    refine: [
      { mods: { n: 2 }, txt: '+2 arrows' },
      { mods: { dmg: 0.25, pierce: 2 }, txt: '+25% damage, pierce 2 more' },
    ],
  }, { fire: (w, p, ws, S) => { HAIL.pierce = Math.min(HAIL_P, S.pierce); volley(w, p, ws, S, HAIL, 0.14, 1); return true; }, kill: killShot });

  // Ballista (Piercer): 1 + (S.n - 1) / 2 giant bolts (radius 12 x area, 0.06 rad apart) along the cursor, piercing every foe until they leave the view, always crit, S.dmg each;
  // a heavy volley (every S.heavy-th) makes them x1.5 bigger and x HEAVY damage; S.bounce: each bolt also looses that many arrows (S.dmg / 3) at the nearest foes on its first hit.
  const BAL = { look: 'bolt', speed: 240, pierce: 9999, life: 3, knock: 70, r: 12, onHit: null };
  const SHARD = { look: 'arrow', dmg: 0, pierce: 2, speed: 420, life: HOP / 420 + 0.1, onHit: bounce };
  const balHit = (w, pr, e) => {
    if (pr.st <= 0 || w.projs.length > PROJ_SOFT_CAP) return;
    SHARD.dmg = pr.rk * FIRST;
    for (; pr.st > 0; pr.st--) {
      const t = nextFoe(w, pr, e.x, e.y);
      const c = w.shoot(pr.p, pr.wid, e.x, e.y, t ? Math.atan2(t.y - e.y, t.x - e.x) : pr.a + (pr.st & 1 ? 0.6 : -0.6), null, SHARD);
      c.st = 0; c.rk = 0; c.hits.push(e.id);
    }
  };
  BAL.onHit = balHit;
  const ballista = (w, p, ws, S) => {
    const a = w.aimDir(p), m = 1 + ((Math.max(1, S.n | 0) - 1) >> 1), st = ws.st;
    st.shots = (st.shots | 0) + 1; st.kb = KSN;
    const hv = S.heavy > 0 && st.shots % Math.max(1, S.heavy | 0) === 0;
    BAL.r = 12 * S.area * (hv ? 1.5 : 1);
    for (let i = 0; i < m; i++) {
      const pr = w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (m - 1) / 2) * 0.06, S, BAL);
      pr.dmg = S.dmg * (hv ? HEAVY : 1); pr.critC = 1; pr.st = S.bounce | 0; pr.rk = S.dmg / 3;
    }
  };
  ED.addWeapon({
    id: 'ballista', name: 'Ballista', icon: 'weapon.crossbow', look: 'bolt', sig: 'ranger', mode: 'cursor', evolved: true, form: true, from: 'longbow', txt: 'A giant bolt through the whole line',
    base: { dmg: 44, cd: 1.2, n: 1, pierce: 0, area: 1, speed: 240, dur: 0, knock: 70, range: 330, heavy: 0, two: false, bounce: 0, kshot: 0 },
    refine: [
      { mods: { n: 2 }, txt: '+1 bolt' },
      { mods: { dmg: 0.25, area: 0.5 }, txt: '+25% damage, bolts 50% bigger' },
    ],
  }, { fire: (w, p, ws, S) => { ballista(w, p, ws, S); return true; }, kill: killShot });

  // Seeker (Ricochet): S.n homing arrows (pierce S.pierce / 4, fan factor 0.35) launched in a wide fan along the cursor; a kill does not spend pierce and keeps the arrow flying
  // (life >= 0.9 s, up to SEEK_K kills) to the next foe.
  const SEEK_K = 2;
  const seekHit = (w, pr, e) => {
    if (e.dead && pr.rk < SEEK_K) { pr.rk++; pr.pierce++; pr.life = Math.max(pr.life, 0.9); pr.tgt = null; }
    bounce(w, pr, e);
  };
  const SEEK = { look: 'arrow', homing: 10, pierce: 0, onHit: seekHit };
  ED.addWeapon({
    id: 'seeker', name: 'Seeker', icon: 'weapon.longbow', look: 'arrow', sig: 'ranger', mode: 'cursor', evolved: true, form: true, from: 'longbow', txt: 'Homing arrows hunt kill to kill',
    base: { dmg: 44, cd: 0.68, n: 5, pierce: 0, area: 1, speed: 360, dur: 0, knock: 20, range: 360, heavy: 0, two: false, bounce: 0, kshot: 0 },
    refine: [
      { mods: { n: 2 }, txt: '+2 arrows' },
      { mods: { dmg: 0.25, bounce: 2 }, txt: '+25% damage, +2 bounces' },
    ],
  }, { fire: (w, p, ws, S) => { SEEK.pierce = S.pierce >> 2; volley(w, p, ws, S, SEEK, 0.2, 0.35); return true; }, kill: killShot });

  // Gale Barrage (Piercer + Spread): each cooldown starts a stream of GALE_N + S.n arrows, one every 0.05 s, each re-aimed along the cursor with +-0.04 rad jitter (w.rng);
  // two: every 2nd arrow goes along twoAim instead; every (2 x S.heavy)-th arrow is heavy.
  const GALE_N = 1;
  const GALE = { look: 'arrow', onHit: bounce };
  ED.addWeapon({
    id: 'galeshot', name: 'Gale Barrage', icon: 'weapon.longbow', look: 'arrow', sig: 'ranger', mode: 'cursor', evolved: true, form: true, from: 'longbow', txt: 'A rapid stream of arrows',
    base: { dmg: 26, cd: 1.2, n: 1, pierce: 16, area: 1, speed: 520, dur: 0, knock: 15, range: 330, heavy: 0, two: false, bounce: 0, kshot: 0 },
    refine: [
      { mods: { n: 2 }, txt: '+2 arrows per stream' },
      { mods: { dmg: 0.25, pierce: 2 }, txt: '+25% damage, pierce 2 more' },
    ],
  }, {
    fire: (w, p, ws, S) => { const st = ws.st; st.left = GALE_N + Math.max(1, S.n | 0); st.gt = 0; st.kb = KSN; return true; },
    tick: (w, p, ws, S, dt) => {
      const st = ws.st;
      if (!(st.left > 0) || (st.gt -= dt) > 0) return;
      st.gt += 0.05; st.left--;
      st.shots = (st.shots | 0) + 1;
      const hv = S.heavy > 0 && st.shots % (Math.max(1, S.heavy | 0) * 2) === 0;
      let a = w.aimDir(p);
      if (S.two && (st.left & 1)) a = twoAim(w, p, a, S.range);
      loose(w, p, ws.id, a + (w.rng.next() - 0.5) * 0.08, S, GALE, 1, hv);
    },
    kill: killShot,
  });

  // Rebound (Piercer + Ricochet): S.n arrows in a fan along the cursor; an arrow reaching its owner's view edge turns toward the foe nearest the owner (else mirrors), clears its hit list and
  // regains its pierce, up to 2 + S.bounce times; life 3 s; no first-hit bonus.
  const rbTick = (w, pr, dt) => {
    const p = pr.p;
    if (!p || pr.st <= 0) return;
    const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
    if (ED.inView(p, nx, ny, 0)) return;
    pr.st--; pr.hits.length = 0; pr.pierce = pr.rk;
    const t = w.heroFoe(p, 640);
    if (t) steer(pr, Math.atan2(t.y - pr.y, t.x - pr.x));
    else {
      const V = ED.HERO_VIEW;
      if (Math.abs(nx - p.x) > V.hw) pr.vx = -pr.vx;
      if (Math.abs(ny - p.y + V.oy) > V.hh) pr.vy = -pr.vy;
      pr.a = Math.atan2(pr.vy, pr.vx);
    }
  };
  const RB = { look: 'arrow', life: 3, tick: rbTick, onHit: null };
  const rebound = (w, p, ws, S) => {
    const n = Math.max(1, S.n | 0), st = ws.st, k = (1 + FANK * (n - 1)) / n, a = w.aimDir(p);
    st.shots = (st.shots | 0) + 1; st.kb = KSN;
    const hv = S.heavy > 0 && st.shots % Math.max(1, S.heavy | 0) === 0 ? 0 : -1;
    for (let i = 0; i < n; i++) {
      const pr = loose(w, p, ws.id, a + (i - (n - 1) / 2) * FAN, S, RB, k, i === hv);
      pr.dmg /= FIRST; pr.st = 2 + (S.bounce | 0); pr.rk = pr.pierce;
    }
  };
  ED.addWeapon({
    id: 'rebound', name: 'Rebound', icon: 'weapon.longbow', look: 'arrow', sig: 'ranger', mode: 'cursor', evolved: true, form: true, from: 'longbow', txt: 'Arrows rebound off the screen edge',
    base: { dmg: 42, cd: 0.9, n: 1, pierce: 8, area: 1, speed: 460, dur: 0, knock: 20, range: 300, heavy: 0, two: false, bounce: 0, kshot: 0 },
    refine: [
      { mods: { n: 2 }, txt: '+2 arrows' },
      { mods: { dmg: 0.25, bounce: 1 }, txt: '+25% damage, 1 more rebound' },
    ],
  }, { fire: (w, p, ws, S) => { rebound(w, p, ws, S); return true; }, kill: killShot });

  // ---------------- Q: Vault ----------------
  // Zero damage. Leaps N.dist px toward the cursor over N.t s, over foes and obstacles, untouchable (the landing steps back along the line to the first free spot); on landing every
  // xp gem within N.gem px flies to the hero. charges (L3): 2 casts stored. caltrops (L4): a caltrop field (CALT_R px, CALT_T s) at the takeoff slows foes inside 50% for 2 s.
  // State p.vault { t, T, end (sim time), x0, y0, x1, y1, gem } (HOOK.ranger moves the hero). Zones: 'vault' (follows the hero during the leap, a = heading), 'vland' (landing dust), 'caltrops'.
  const CALT_R = 56, CALT_T = 3;
  let CW = null;
  const caltFoe = (e) => CW.slow(e, 0.5, 2);
  const caltTick = (w, z) => { if (z.t < z.st.nt) return; z.st.nt = z.t + 0.2; CW = w; w.zoneFoes(z, caltFoe); CW = null; };
  ED.addSkill({
    id: 'vault', name: 'Vault', icon: 'proj.arrow', cd: 9, txt: 'Leap over the horde, pull in gems',
    base: { dist: 160, t: 0.34, gem: 200, charges: 1, caltrops: 0 },
    levels: [
      { mods: { dist: 60 }, txt: 'Leap 60 px farther' },
      { mods: { charges: 1 }, txt: '2 charges' },
      { mods: { caltrops: 1 }, txt: 'Caltrops at takeoff slow pursuers' },
    ],
  }, (w, p, x, y, N) => {
    const a = Math.hypot(x - p.x, y - p.y) < 1 ? p.mdir : Math.atan2(y - p.y, x - p.x), c = Math.cos(a), s = Math.sin(a);
    let d = N.dist;
    while (d > 0 && ED.Arena.blocked(w.arena, p.x + c * d, p.y + s * d, p.r)) d -= 8;
    d = Math.max(0, d);
    const v = p.vault || (p.vault = { t: 0, T: 0, end: 0, x0: 0, y0: 0, x1: 0, y1: 0, gem: 0 });
    v.T = v.t = N.t; v.end = w.time + N.t; v.x0 = p.x; v.y0 = p.y; v.x1 = p.x + c * d; v.y1 = p.y + s * d; v.gem = N.gem;
    p.invuln = Math.max(p.invuln, N.t + 0.15); p.mdir = a;
    w.zone({ team: 0, p, wid: 'vault', x: p.x, y: p.y, r: 14, a, dur: N.t, follow: p.pid, look: 'vault' });
    if (N.caltrops > 0) w.zone({ team: 0, p, wid: 'vault', x: p.x, y: p.y, r: CALT_R, dur: CALT_T, look: 'caltrops', st: { nt: 0 }, onTick: caltTick });
    return { a, x0: Math.round(p.x), y0: Math.round(p.y), shake: 3 };
  });
  ED.HOOK.ranger = {
    init(w, p) { p.vault = null; },
    tick(w, p, dt) {
      const v = p.vault;
      if (!v || v.t <= 0) return;
      if (w.time > v.end + 0.1) { v.t = 0; return; } // went down mid-leap: the leap is dropped
      v.t -= dt;
      const k = U.clamp(1 - v.t / v.T, 0, 1);
      p.x = v.x0 + (v.x1 - v.x0) * k; p.y = v.y0 + (v.y1 - v.y0) * k; p.moving = true;
      if (v.t > 0) return;
      ED.Arena.collide(w.arena, p, p.r);
      w.pullGems(p, p.x, p.y, v.gem);
      w.zone({ team: 0, p, wid: 'vault', x: p.x, y: p.y, r: 40, dur: 0.4, look: 'vland' });
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
