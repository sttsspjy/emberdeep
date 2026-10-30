// Damage pipeline and hit primitives (ARCHITECTURE §6): hitFoe, statuses, pooled projectiles and zones (telegraphs are warn zones), hurtHero, per-tick hit-event aggregation, braziers.
// Braziers break on any hero hit: arc / blast reach, hero projectile contact (no pierce spent, flight continues; bucketed per arena), and the skills / zones that call hitBraziers.
// View clamp (no off-screen wipe): hero-team damage, targeting, projectiles and brazier hits act only inside the attacking hero's view rect (ED.inView, grid.js).
// Primitives emit their own events ('swing', 'boom', 'chain'); the weapon runtime emits 'shoot'. src objects come from a 64-slot ring (w.src) so nested hits never clobber a caller's src.
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, W = ED.World.prototype, TAU = U.TAU, VW = ED.HERO_VIEW;
  const HIT_CAP = 200;   // hit events per tick (largest first)
  const FLASH = 0.06;    // hit flash (s)
  const TELE_MIN = 0.6;  // minimum telegraph length for foe / boss attacks
  // Foe e overlaps hero p's view (true without a hero). invariant: hero damage, knock and statuses land only on foes in the attacker's view.
  const seen = (p, e) => !p || (Math.abs(e.x - p.x) <= VW.hw + e.r && Math.abs(e.y - p.y + VW.oy) <= VW.hh + e.r);

  W.initCombat = function () {
    this.projPool = []; this.zonePool = [];
    this.srcRing = []; this.srcI = 0;
    for (let i = 0; i < 64; i++) this.srcRing.push({ p: null, wid: '', crit: false, knock: 0, kx: 0, ky: 0, x: 0, y: 0, kind: '', critC: -1 });
    this.hitRecs = []; this.hitN = 0; this.hitSort = [];
    this.pt = { x: 0, y: 0, a: 0 };   // scratch point returned by target() / densest(): copy it before the next call
    this.vclamp = null;                // hero whose view limits nearestFoe / densest (set around weapons, skills, hero projectiles and zones)
  };

  // Hit source from the ring: { p (hero or null), wid, kind ('weapon'|'proj'|'zone'|'dot'|'skill'|'chain'|...), crit (forced), critC (crit chance override, -1 = hero stat), knock, kx, ky (push direction; 0,0 = away from x, y) }.
  W.src = function (p, wid, kind, knock) {
    const s = this.srcRing[this.srcI = (this.srcI + 1) & 63];
    s.p = p || null; s.wid = wid || ''; s.kind = kind || 'weapon'; s.crit = false; s.critC = -1; s.knock = knock || 0; s.kx = 0; s.ky = 0; s.x = p ? p.x : 0; s.y = p ? p.y : 0;
    return s;
  };

  // Deals dmg to foe e. Crit roll (hero crit or src.critC; src.crit forces one) x critMul, foe e.takeMul, rounded, min 1. Flash (not on dots), knockback (def.kb, elites x0.35, bosses none),
  // hero dealt tracking per weapon id, hero hit hook, aggregated hit event, kill at 0 HP. Returns the damage dealt.
  W.hitFoe = function (e, dmg, src) {
    if (e.dead || !(dmg > 0) || e.invulnT > 0) return 0;
    const p = src && src.p;
    if (!seen(p, e)) return 0;
    let crit = !!(src && src.crit);
    if (!crit && p && (!src || src.kind !== 'dot')) { const cc = src && src.critC >= 0 ? src.critC : p.stats.crit; if (cc > 0 && this.rng.next() < cc) crit = true; }
    let d = dmg * (crit ? (p ? p.stats.critMul : 2) : 1) * (e.takeMul || 1);
    if (this.cheats.might) d *= this.cheats.might;
    d = Math.max(1, Math.round(d));
    const dealt = Math.min(d, e.hp);
    e.hp -= d;
    e.hpQ = e.hp > 0 ? Math.max(1, Math.min(255, Math.round(255 * e.hp / e.maxHp))) : 0;
    if (!src || src.kind !== 'dot') e.flash = FLASH;
    if (src && src.knock > 0 && e.def.kb > 0 && !e.boss) {
      let kx = src.kx, ky = src.ky;
      if (!kx && !ky) { kx = e.x - src.x; ky = e.y - src.y; }
      const l = Math.hypot(kx, ky) || 1, k = src.knock * e.def.kb * (e.elite ? 0.35 : 1);
      e.kbx += kx / l * k; e.kby += ky / l * k;
    }
    if (p) {
      const id = src.wid || 'other';
      p.dealt[id] = (p.dealt[id] || 0) + dealt;
      const hk = ED.HOOK[p.cls]; if (hk && hk.hit) hk.hit(this, p, e, dealt, src);
    }
    this.addHit(e, d, crit);
    if (e.hp <= 0 && !e.dead) this.killFoe(e, src);
    return dealt;
  };

  // Hit aggregation: one record per foe per tick (summed damage, any crit); flushHits emits at most HIT_CAP 'hit' events, largest first.
  W.addHit = function (e, d, crit) {
    let r;
    if (e.hevT === this.tick && this.hitRecs[e.hev] && this.hitRecs[e.hev].id === e.id) r = this.hitRecs[e.hev];
    else {
      e.hevT = this.tick; e.hev = this.hitN;
      r = this.hitRecs[this.hitN] || (this.hitRecs[this.hitN] = { id: 0, x: 0, y: 0, dmg: 0, crit: false });
      this.hitN++; r.id = e.id; r.dmg = 0; r.crit = false;
    }
    r.x = e.x; r.y = e.y - e.r; r.dmg += d; r.crit = r.crit || crit;
  };
  const byDmg = (a, b) => b.dmg - a.dmg;
  W.flushHits = function () {
    let n = this.hitN, list = this.hitRecs;
    if (!n) return;
    if (n > HIT_CAP) { const s = this.hitSort; s.length = 0; for (let i = 0; i < n; i++) s.push(list[i]); s.sort(byDmg); list = s; n = HIT_CAP; }
    for (let i = 0; i < n; i++) { const r = list[i]; this.events.push({ t: 'hit', id: r.id, x: Math.round(r.x), y: Math.round(r.y), dmg: r.dmg, crit: r.crit }); }
    this.hitN = 0;
  };

  // ---------------- statuses ----------------
  // Burn: dps for dur s, ticking every 0.5 s as a 'dot' from hero p (the strongest burn wins, its timer refreshes). Slow: speed x (1 - k) for dur (strongest wins).
  // Freeze: no movement or contact for dur (bosses immune, elites half). Stun: no movement for dur (bosses immune, elites half).
  W.burn = function (e, dps, dur, p) { if (e.dead) return; if (dps >= e.burnDps || e.burnT <= 0) { e.burnDps = dps; e.burnOwner = p || null; } e.burnT = Math.max(e.burnT, dur); };
  W.slow = function (e, k, dur) { if (e.dead) return; if (k >= e.slowK || e.slowT <= 0) e.slowK = Math.min(0.9, k); e.slowT = Math.max(e.slowT, dur * (e.boss ? 0.5 : 1)); };
  W.freeze = function (e, dur) { if (e.dead || e.boss) return; e.freezeT = Math.max(e.freezeT, dur * (e.elite ? 0.5 : 1)); };
  W.stun = function (e, dur) { if (e.dead || e.boss) return; e.stunT = Math.max(e.stunT, dur * (e.elite ? 0.5 : 1)); };
  W.knock = function (e, kx, ky, force) {
    if (e.dead || e.boss || !(e.def.kb > 0)) return;
    const l = Math.hypot(kx, ky) || 1, k = force * e.def.kb * (e.elite ? 0.35 : 1);
    e.kbx += kx / l * k; e.kby += ky / l * k;
  };
  // Utility push (zero damage): slides foe e dist px straight away from (x, y) (knockback speed dist x 10: travel ~ speed / 10 at the 10/s decay); elites half; bosses and knockback-immune foes stay.
  // Replaces the foe's current knockback. Returns whether it moved.
  W.push = function (e, x, y, dist) {
    if (e.dead || e.boss || !(e.def.kb > 0) || !(dist > 0)) return false;
    let dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy);
    if (d < 1e-3) { const a = e.id * 2.39996; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
    const v = dist * (e.elite ? 0.5 : 1) * 10;
    e.kbx = dx / d * v; e.kby = dy / d * v;
    return true;
  };
  // Blocker zone tick (zone onTick; zero damage): non-boss foes cannot cross the band of half width z.w / 2 on the circle (z.x, z.y, z.r): a full ring (z.arc 0) or an arc of z.arc rad
  // centred on angle z.a (foes pass around its ends). A foe touching the band is put back on its side (z.st.out: always the outside) and loses its knockback into the band.
  // z.st.lure > 0: every 0.25 s every non-boss foe within st.lure px of the band is lured to the band's nearest point on its side (0.4 s, refreshed). z.st: { out, lure, lt }.
  W.blockZone = function (z) {
    const s = z.st, R = z.r, h = z.w / 2, part = z.arc > 0 && z.arc < TAU - 1e-3, half = z.arc / 2, A = this.arena;
    const lure = s.lure > 0 && z.t >= s.lt, L = lure ? s.lure : 0;
    if (lure) s.lt = z.t + 0.25;
    const q = this.foeScan(z.x, z.y, R + h + L + 24);
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead || e.boss) continue;
      const dx = e.x - z.x, dy = e.y - z.y, d = Math.hypot(dx, dy) || 1e-3, m = h + e.r, ux = dx / d, uy = dy / d;
      const off = part ? U.angDiff(z.a, Math.atan2(dy, dx)) : 0, inArc = !part || Math.abs(off) <= half + e.r / R;
      if (inArc && Math.abs(d - R) < m) {
        const outS = s.out || d >= R, td = outS ? R + m : R - m, kr = e.kbx * ux + e.kby * uy;
        e.x = z.x + ux * td; e.y = z.y + uy * td;
        if (outS ? kr < 0 : kr > 0) { e.kbx -= kr * ux; e.kby -= kr * uy; }
        ED.Arena.collide(A, e, e.r);
      } else if (L > 0) {
        const b = part ? z.a + U.clamp(off, -half, half) : Math.atan2(dy, dx), td = s.out || d >= R ? R + m + 2 : R - m - 2, lx = z.x + Math.cos(b) * td, ly = z.y + Math.sin(b) * td;
        if (U.dist2(e.x, e.y, lx, ly) <= (L + e.r) * (L + e.r)) this.foeLure(e, lx, ly, 0.4);
      }
    }
    this.foeEnd();
  };
  ED.blockTick = (w, z) => w.blockZone(z);

  // Shared status options of arc / blast / chain / zone hits: opt.slow [k, dur], opt.stun s, opt.freeze s, opt.burn [dps, dur]. Callers skip foes outside the hero's view (seen).
  const applyOpt = (w, e, opt, p) => {
    if (opt.slow) w.slow(e, opt.slow[0], opt.slow[1]);
    if (opt.stun) w.stun(e, opt.stun);
    if (opt.freeze) w.freeze(e, opt.freeze);
    if (opt.burn) w.burn(e, opt.burn[0], opt.burn[1], p);
  };
  W.applyOpt = function (e, opt, p) { applyOpt(this, e, opt, p); };

  // ---------------- hit shapes ----------------
  const NO = {};
  // Arc sweep from (x, y) toward a: foes within r (+ their radius) and arc/2 of a (arc >= TAU: full circle). opt: { knock, look, onHit(w, e, dealt), crit, slow, stun, freeze, burn, kind, noEv }.
  // Emits 'swing'; breaks braziers in reach. Returns the number of foes hit.
  W.arc = function (p, wid, x, y, a, r, arc, dmg, opt) {
    opt = opt || NO;
    const q = this.foeScan(x, y, r), full = arc >= TAU - 1e-3, half = arc / 2;
    let n = 0;
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy);
      if (d > r + e.r) continue;
      if (!full && d > e.r && Math.abs(U.angDiff(a, Math.atan2(dy, dx))) > half + Math.asin(Math.min(1, e.r / d))) continue;
      if (!seen(p, e)) continue;
      const s = this.src(p, wid, opt.kind || 'weapon', opt.knock || 0); s.x = x; s.y = y; if (opt.crit) s.crit = true;
      const dealt = this.hitFoe(e, dmg, s); n++;
      if (!e.dead) applyOpt(this, e, opt, p);
      if (opt.onHit) opt.onHit(this, e, dealt);
    }
    this.foeEnd();
    this.hitBraziers(x, y, r, p);
    if (!opt.noEv) this.emit({ t: 'swing', pid: p ? p.pid : '', wid, x: Math.round(x), y: Math.round(y), a, r: Math.round(r), arc, look: opt.look || '' });
    return n;
  };

  // Circle hit at (x, y) of radius r. opt as arc (knock pushes away from the centre). Emits 'boom'. Returns the number of foes hit.
  W.blast = function (p, wid, x, y, r, dmg, opt) {
    opt = opt || NO;
    const q = this.foeScan(x, y, r);
    let n = 0;
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (e.dead) continue;
      const rr = r + e.r; if (U.dist2(x, y, e.x, e.y) > rr * rr || !seen(p, e)) continue;
      const s = this.src(p, wid, opt.kind || 'weapon', opt.knock || 0); s.x = x; s.y = y; if (opt.crit) s.crit = true;
      const dealt = dmg > 0 ? this.hitFoe(e, dmg, s) : (opt.knock ? (this.knock(e, e.x - x, e.y - y, opt.knock), 0) : 0); n++;
      if (!e.dead) applyOpt(this, e, opt, p);
      if (opt.onHit) opt.onHit(this, e, dealt);
    }
    this.foeEnd();
    this.hitBraziers(x, y, r, p);
    if (!opt.noEv) this.emit({ t: 'boom', pid: p ? p.pid : '', wid, x: Math.round(x), y: Math.round(y), r: Math.round(r), look: opt.look || '' });
    return n;
  };

  // Chain: hits e, then up to `hops` more foes, each the nearest unhit foe within range of the last. opt: { onHit, look, slow, stun, burn }. Emits 'chain' { pts: [x0, y0, x1, y1, ...] }. Returns hits.
  W.chain = function (p, wid, e, hops, range, dmg, opt) {
    opt = opt || NO;
    const done = [], pts = [Math.round(p ? p.x : e.x), Math.round(p ? p.y : e.y)];
    let cur = e, n = 0;
    const skip = (f) => done.indexOf(f.id) >= 0;
    while (cur && n <= hops) {
      done.push(cur.id); pts.push(Math.round(cur.x), Math.round(cur.y));
      const s = this.src(p, wid, 'chain', opt.knock || 0); s.x = cur.x; s.y = cur.y;
      if (seen(p, cur)) {
        const dealt = this.hitFoe(cur, dmg, s);
        if (!cur.dead) applyOpt(this, cur, opt, p);
        if (opt.onHit) opt.onHit(this, cur, dealt);
      }
      n++;
      if (n > hops) break;
      cur = this.nearestFoe(cur.x, cur.y, range, skip);
    }
    this.emit({ t: 'chain', pid: p ? p.pid : '', wid, pts, look: opt.look || '' });
    return n;
  };

  // ---------------- targeting ----------------
  // Nearest foe to hero p within range inside p's view (skip as nearestFoe), or null.
  W.heroFoe = function (p, range, skip) { const v = this.vclamp; this.vclamp = p; const e = this.nearestFoe(p.x, p.y, range, skip); this.vclamp = v; return e; };
  // mode 'nearest' -> nearest foe within range (default 400) | null; 'random' -> a random foe inside the hero's view rect | null; 'densest' -> densest cluster point within range | null;
  // else the hero's position ({x, y, a}). Points are the shared scratch w.pt. Foes only inside p's view.
  W.target = function (mode, p, range) {
    range = range || 400;
    if (mode === 'nearest') return this.heroFoe(p, range);
    if (mode === 'random') {
      const hw = VW.hw, hh = VW.hh, cy = p.y - VW.oy, q = this.foeScan(p.x, cy, Math.min(range, Math.hypot(hw, hh)));
      let m = 0;
      for (let k = 0; k < q.length; k++) { const e = q[k]; if (Math.abs(e.x - p.x) <= hw && Math.abs(e.y - cy) <= hh) m++; }
      let pick = null;
      if (m) {
        let j = this.rng.int(0, m - 1);
        for (let k = 0; k < q.length; k++) { const e = q[k]; if (Math.abs(e.x - p.x) <= hw && Math.abs(e.y - cy) <= hh && j-- === 0) { pick = e; break; } }
      }
      this.foeEnd();
      return pick;
    }
    if (mode === 'densest') { const v = this.vclamp; this.vclamp = p; const pt = this.densest(p.x, p.y, range); this.vclamp = v; return pt; }
    const pt = this.pt;
    pt.x = p.x; pt.y = p.y; pt.a = p.mdir;
    return pt;
  };
  // Centre of the 64 px cell holding the most foes within range of (x, y) (the mean position of those foes; foes outside w.vclamp's view ignored), or null when none. Returns the scratch w.pt.
  const DCELL = 64, DN = 32, dcount = new Int32Array(DN * DN);
  const outV = (V, e) => V && !(Math.abs(e.x - V.x) <= VW.hw + e.r && Math.abs(e.y - V.y + VW.oy) <= VW.hh + e.r);
  W.densest = function (x, y, range) {
    const q = this.foeScan(x, y, range), r2 = range * range, half = DN / 2, V = this.vclamp;
    let best = -1, bc = 0;
    dcount.fill(0);
    for (let k = 0; k < q.length; k++) {
      const e = q[k]; if (U.dist2(x, y, e.x, e.y) > r2 || outV(V, e)) continue;
      const cx = Math.floor((e.x - x) / DCELL) + half, cy = Math.floor((e.y - y) / DCELL) + half;
      if (cx < 0 || cy < 0 || cx >= DN || cy >= DN) continue;
      const c = cy * DN + cx, v = ++dcount[c];
      if (v > bc) { bc = v; best = c; }
    }
    let pt = null;
    if (best >= 0) {
      let sx = 0, sy = 0, m = 0;
      for (let k = 0; k < q.length; k++) {
        const e = q[k]; if (U.dist2(x, y, e.x, e.y) > r2 || outV(V, e)) continue;
        const cx = Math.floor((e.x - x) / DCELL) + half, cy = Math.floor((e.y - y) / DCELL) + half;
        if (cy * DN + cx === best) { sx += e.x; sy += e.y; m++; }
      }
      pt = this.pt; pt.x = sx / m; pt.y = sy / m; pt.a = Math.atan2(pt.y - y, pt.x - x);
    }
    this.foeEnd();
    return pt;
  };

  // ---------------- projectiles ----------------
  // Hero projectile from weapon wid at (x, y) along a. S = effective numbers (speed, dmg, pierce, range, area, knock, crit). opt: { look, speed, dmg, pierce, r, life, homing (turn rad/s),
  // ret (boomerang back to the hero), rehit (s: the same foe can be hit again after this), knock, solid (stops at obstacles), onHit(w, pr, e, dealt), onEnd(w, pr), tick(w, pr, dt), st (custom state) }.
  W.shoot = function (p, wid, x, y, a, S, opt) {
    opt = opt || NO; S = S || NO;
    const pr = this.projPool.pop() || { hits: [] }, sp = opt.speed !== undefined ? opt.speed : (S.speed || 200), def = ED.WEAPONS[wid];
    pr.id = this.nextId(); pr.k = opt.look || (def && def.look) || 'dot'; pr.team = 0; pr.owner = p ? p.pid : ''; pr.p = p || null; pr.wid = wid; pr.e = null;
    pr.x = x; pr.y = y; pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp; pr.a = a; pr.sp = sp;
    pr.r = opt.r !== undefined ? opt.r : 4 * (S.area || 1);
    pr.dmg = opt.dmg !== undefined ? opt.dmg : S.dmg || 0; pr.pierce = opt.pierce !== undefined ? opt.pierce : S.pierce || 0;
    pr.life = opt.life !== undefined ? opt.life : (S.range > 0 ? S.range / sp : 1.5); pr.t = 0;
    pr.knock = opt.knock !== undefined ? opt.knock : S.knock || 0; pr.critC = S.crit !== undefined ? S.crit : -1;
    pr.homing = opt.homing || 0; pr.tgt = null; pr.tgtId = 0;
    pr.ret = !!opt.ret; pr.out = pr.life / 2; pr.back = false;
    pr.rehit = opt.rehit || 0; pr.hitClr = 0; pr.hits.length = 0; pr.solid = !!opt.solid;
    pr.onHit = opt.onHit || null; pr.onEnd = opt.onEnd || null; pr.tick = opt.tick || null; pr.st = opt.st || null; pr.dead = false;
    this.projs.push(pr);
    return pr;
  };
  // Brazier buckets for hero projectiles: CSR lists (start, idx) of brazier indices per BCELL px cell; each brazier is filed into every cell its circle + BPAD touches.
  // Built once per arena (pure from the seed). projBraziers(pr): breaks every intact brazier pr touches (a radius above BPAD falls back to the linear scan); pierce and flight are untouched.
  const BCELL = 128, BPAD = 24;
  W.brzGrid = function () {
    const A = this.arena;
    if (this.brzA === A) return this.brzG;
    const B = A.braziers, cw = Math.max(1, Math.ceil(A.size / BCELL)), start = new Int32Array(cw * cw + 1);
    const span = (b, f) => {
      const x0 = U.clamp(Math.floor((b.x - b.r - BPAD) / BCELL), 0, cw - 1), x1 = U.clamp(Math.floor((b.x + b.r + BPAD) / BCELL), 0, cw - 1);
      const y0 = U.clamp(Math.floor((b.y - b.r - BPAD) / BCELL), 0, cw - 1), y1 = U.clamp(Math.floor((b.y + b.r + BPAD) / BCELL), 0, cw - 1);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) f(cy * cw + cx);
    };
    for (let i = 0; i < B.length; i++) span(B[i], (c) => { start[c + 1]++; });
    for (let c = 0; c < cw * cw; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cw * cw), idx = new Int32Array(start[cw * cw]);
    for (let i = 0; i < B.length; i++) span(B[i], (c) => { idx[fill[c]++] = i; });
    this.brzA = A; this.brzG = { cw, start, idx };
    return this.brzG;
  };
  W.projBraziers = function (pr) {
    if (pr.r > BPAD) { this.hitBraziers(pr.x, pr.y, pr.r, pr.p); return; }
    if (pr.p && !ED.inView(pr.p, pr.x, pr.y, pr.r)) return;
    const G = this.brzGrid(), cx = Math.floor(pr.x / BCELL), cy = Math.floor(pr.y / BCELL);
    if (cx < 0 || cy < 0 || cx >= G.cw || cy >= G.cw) return;
    const c = cy * G.cw + cx, B = this.arena.braziers;
    for (let k = G.start[c], e = G.start[c + 1]; k < e; k++) {
      const b = B[G.idx[k]], rr = pr.r + b.r;
      if (!b.broken && U.dist2(pr.x, pr.y, b.x, b.y) <= rr * rr) this.breakBrazier(b, pr.p);
    }
  };
  // Foe projectile from foe e along a: speed px/s, dmg to a hero on contact, stops at obstacles. Returns the projectile.
  W.foeShoot = function (e, a, speed, look, dmg, r) {
    const pr = this.projPool.pop() || { hits: [] };
    pr.id = this.nextId(); pr.k = look || 'bolt'; pr.team = 1; pr.owner = e.id; pr.p = null; pr.e = e; pr.wid = '';
    pr.x = e.x; pr.y = e.y - e.r * 0.5; pr.vx = Math.cos(a) * speed; pr.vy = Math.sin(a) * speed; pr.a = a; pr.sp = speed;
    pr.r = r || 4; pr.dmg = dmg; pr.pierce = 0; pr.life = 4; pr.t = 0; pr.knock = 0; pr.critC = -1; pr.homing = 0; pr.tgt = null; pr.tgtId = 0;
    pr.ret = false; pr.out = 0; pr.back = false; pr.rehit = 0; pr.hitClr = 0; pr.hits.length = 0; pr.solid = true; pr.onHit = null; pr.onEnd = null; pr.tick = null; pr.st = null; pr.dead = false;
    this.projs.push(pr);
    this.emit({ t: 'eshoot', id: e.id, x: Math.round(pr.x), y: Math.round(pr.y), look: pr.k });
    return pr;
  };

  W.updateProjs = function (dt) {
    const A = this.arena, size = A.size, list = this.projs, n = list.length;
    for (let i = 0; i < n; i++) {
      const pr = list[i];
      if (pr.dead) continue;
      this.vclamp = pr.team === 0 ? pr.p : null;
      pr.t += dt; pr.life -= dt;
      if (pr.tick) pr.tick(this, pr, dt);
      if (pr.homing > 0 && !pr.back) {
        if ((!pr.tgt || pr.tgt.dead || pr.tgt.id !== pr.tgtId) && (this.tick + pr.id) % 6 === 0) { pr.tgt = this.nearestFoe(pr.x, pr.y, 260); pr.tgtId = pr.tgt ? pr.tgt.id : 0; }
        const t = pr.tgt;
        if (t && !t.dead && t.id === pr.tgtId) {
          const want = Math.atan2(t.y - pr.y, t.x - pr.x), a = Math.atan2(pr.vy, pr.vx), d = U.angDiff(a, want), step = pr.homing * dt;
          const na = a + (Math.abs(d) < step ? d : Math.sign(d) * step);
          pr.vx = Math.cos(na) * pr.sp; pr.vy = Math.sin(na) * pr.sp;
        }
      }
      if (pr.ret && pr.p) {
        if (!pr.back && pr.t >= pr.out) { pr.back = true; pr.hits.length = 0; pr.life = Math.max(pr.life, 3); }
        if (pr.back) {
          const dx = pr.p.x - pr.x, dy = pr.p.y - pr.y, d = Math.hypot(dx, dy) || 1;
          pr.vx = dx / d * pr.sp; pr.vy = dy / d * pr.sp;
          if (d < 14) pr.dead = true;
        }
      }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.a = Math.atan2(pr.vy, pr.vx);
      if (pr.x < -40 || pr.y < -40 || pr.x > size + 40 || pr.y > size + 40) pr.dead = true;
      else if (pr.team === 0 && pr.p && !ED.inView(pr.p, pr.x, pr.y, pr.r)) pr.dead = true; // fully outside the owner's view
      if (!pr.dead && pr.solid && ED.Arena.blocked(A, pr.x, pr.y, 1)) pr.dead = true;
      if (!pr.dead) {
        if (pr.team === 0) {
          if (pr.rehit > 0 && pr.t - pr.hitClr >= pr.rehit) { pr.hits.length = 0; pr.hitClr = pr.t; }
          this.projBraziers(pr);
          const q = this.foeScan(pr.x, pr.y, pr.r);
          for (let k = 0; k < q.length; k++) {
            const e = q[k]; if (e.dead) continue;
            const rr = pr.r + e.r; if (U.dist2(pr.x, pr.y, e.x, e.y) > rr * rr) continue;
            if (pr.hits.indexOf(e.id) >= 0) continue;
            pr.hits.push(e.id);
            const s = this.src(pr.p, pr.wid, 'proj', pr.knock); s.kx = pr.vx; s.ky = pr.vy; s.critC = pr.critC;
            const dealt = this.hitFoe(e, pr.dmg, s);
            if (pr.onHit) pr.onHit(this, pr, e, dealt);
            if (pr.pierce-- <= 0) { pr.dead = true; break; }
          }
          this.foeEnd();
        } else {
          for (const p of this.living) {
            const rr = pr.r + p.r * 0.7;
            if (U.dist2(pr.x, pr.y, p.x, p.y) <= rr * rr) { if (p.dashT <= 0) { this.hurtHero(p, pr.dmg, pr); pr.dead = true; } break; }
          }
        }
      }
      if (!pr.dead && pr.life <= 0) pr.dead = true;
      if (pr.dead && pr.onEnd) { const f = pr.onEnd; pr.onEnd = null; f(this, pr); }
    }
    this.vclamp = null;
  };

  // ---------------- zones ----------------
  // opt: { team (0 hero, 1 foe), look, x, y, r (circle / cone radius), a, len + w (line), arc (cone), dur, tick (s, default 0.5), dps (team 0: to foes; team 1: to heroes), dmg (warn resolve),
  //   warn (telegraph: resolves at dur, hitting team targets inside with dmg; team 1 dur >= 0.6), follow (hero pid), src (foe: a team 1 telegraph that dies with its caster unless detached),
  //   detached, followSrc (moves with src), p (hero), wid, slow, stun, freeze, burn, knock, onTick(w, z), onEnd(w, z), st }. Shape: len > 0 line, arc > 0 cone, else circle.
  W.zone = function (opt) {
    const z = this.zonePool.pop() || {};
    z.id = this.nextId(); z.k = opt.look || (opt.warn ? 'tele' : 'dot'); z.team = opt.team | 0;
    z.x = opt.x; z.y = opt.y; z.r = opt.r || 0; z.a = opt.a || 0; z.len = opt.len || 0; z.w = opt.w || 0; z.arc = opt.arc || 0;
    z.t = 0; z.dur = opt.dur || 1; z.tick = opt.tick || 0.5; z.tickT = opt.tickDelay || 0; z.dps = opt.dps || 0; z.dmg = opt.dmg || 0;
    z.warn = !!opt.warn; if (z.warn && z.team === 1 && z.dur < TELE_MIN) z.dur = TELE_MIN;
    z.follow = opt.follow || ''; z.src = opt.src || null; z.srcId = opt.src ? opt.src.id : 0; z.detached = !!opt.detached; z.followSrc = !!opt.followSrc;
    z.p = opt.p || null; z.wid = opt.wid || ''; z.slow = opt.slow || null; z.stun = opt.stun || 0; z.freeze = opt.freeze || 0; z.burn = opt.burn || null; z.knock = opt.knock || 0;
    z.onTick = opt.onTick || null; z.onEnd = opt.onEnd || null; z.st = opt.st || null; z.dead = false;
    this.zones.push(z);
    return z;
  };
  // True when a circle (x, y, rad) touches zone z.
  W.zoneHas = function (z, x, y, rad) {
    if (z.len > 0) { const ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len, m = z.w / 2 + rad; return U.segDist2(x, y, z.x, z.y, ex, ey) <= m * m; }
    const dx = x - z.x, dy = y - z.y, d = Math.hypot(dx, dy);
    if (d > z.r + rad) return false;
    if (z.arc > 0 && z.arc < TAU && d > rad) return Math.abs(U.angDiff(z.a, Math.atan2(dy, dx))) <= z.arc / 2 + Math.asin(Math.min(1, rad / d));
    return true;
  };
  // Foes inside zone z (a hero zone: only those in its owner's view): calls fn(e) for each (scan bounds from the shape).
  W.zoneFoes = function (z, fn) {
    let cx = z.x, cy = z.y, R = z.r;
    if (z.len > 0) { cx = z.x + Math.cos(z.a) * z.len / 2; cy = z.y + Math.sin(z.a) * z.len / 2; R = z.len / 2 + z.w / 2; }
    const q = this.foeScan(cx, cy, R);
    const p = z.team === 0 ? z.p : null;
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (!e.dead && this.zoneHas(z, e.x, e.y, e.r) && seen(p, e)) fn(e); }
    this.foeEnd();
  };
  W.updateZones = function (dt) {
    const list = this.zones, n = list.length;
    for (let i = 0; i < n; i++) {
      const z = list[i];
      if (z.dead) continue;
      this.vclamp = z.team === 0 ? z.p : null;
      z.t += dt;
      if (z.follow) { const h = this.byPid[z.follow]; if (h) { z.x = h.x; z.y = h.y; } }
      if (z.src) {
        const s = z.src, ok = !s.dead && s.id === z.srcId;
        if (!ok && z.warn && !z.detached) { z.dead = true; continue; }
        if (ok && z.followSrc) { z.x = s.x; z.y = s.y; }
      }
      if (z.dps > 0) {
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += z.tick;
          const dmg = z.dps * z.tick;
          if (z.team === 0) this.zoneFoes(z, (e) => { const s = this.src(z.p, z.wid, 'zone', z.knock); s.x = z.x; s.y = z.y; this.hitFoe(e, dmg, s); if (!e.dead) applyOpt(this, e, z, z.p); });
          else for (const p of this.living) if (this.zoneHas(z, p.x, p.y, p.r * 0.7)) this.hurtHero(p, dmg, z);
          if (z.onTick) z.onTick(this, z);
        }
      } else if (z.onTick) z.onTick(this, z);
      if (z.t >= z.dur) {
        if (z.warn && z.dmg > 0) {
          if (z.team === 1) { for (const p of this.living) if (this.zoneHas(z, p.x, p.y, p.r * 0.7)) this.hurtHero(p, z.dmg, z); }
          else this.zoneFoes(z, (e) => { const s = this.src(z.p, z.wid, 'zone', z.knock); s.x = z.x; s.y = z.y; this.hitFoe(e, z.dmg, s); if (!e.dead) applyOpt(this, e, z, z.p); });
          this.emit({ t: 'boom', pid: z.p ? z.p.pid : '', wid: z.wid, x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r || z.w), look: z.k, team: z.team });
        }
        z.dead = true;
        if (z.onEnd) { const f = z.onEnd; z.onEnd = null; f(this, z); }
      }
    }
    this.vclamp = null;
  };

  // ---------------- heroes take damage ----------------
  // Ignored while invulnerable, dashing, downed or dead. Damage x (1 - p.dr) - armor, min 1, rounded; 0.5 s i-frames; 0 HP -> heroDown. Returns the damage taken.
  W.hurtHero = function (p, dmg, src) {
    if (!this.alive(p) || p.invuln > 0 || p.dashT > 0 || this.cheats.god) return 0;
    const d = Math.max(1, Math.round(dmg * (1 - (p.dr || 0)) - p.stats.armor));
    p.hp -= d; p.invuln = C.IFRAME; p.hurtT = 0.2;
    this.emit({ t: 'hurt', pid: p.pid, dmg: d, x: Math.round(p.x), y: Math.round(p.y) });
    if (p.hp <= 0) this.heroDown(p);
    return d;
  };
  // Foe-side blast (exploders, boss slams without a telegraph zone): hurts living heroes within r. Emits 'boom' (team 1).
  W.foeBlast = function (e, x, y, r, dmg, look) {
    for (const p of this.living) if (U.dist2(x, y, p.x, p.y) <= (r + p.r * 0.7) ** 2) this.hurtHero(p, dmg, e);
    this.emit({ t: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r), look: look || 'fire', team: 1 });
  };

  // ---------------- braziers ----------------
  // Breaks every intact brazier the circle (x, y, r) touches; with a hero p, only braziers overlapping p's view.
  W.hitBraziers = function (x, y, r, p) {
    const B = this.arena.braziers;
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (!b.broken && U.dist2(x, y, b.x, b.y) <= (r + b.r) * (r + b.r) && (!p || ED.inView(p, b.x, b.y, b.r))) this.breakBrazier(b, p); }
  };
  // Drops: food 20%, magnet 5%, holy bomb 2%, else 1-5 gold (GAME-DESIGN §9). b.t = the sim time it broke (relight: progress.js).
  W.breakBrazier = function (b, p) {
    if (b.broken) return;
    b.broken = true; b.hp = 0; b.t = this.time;
    const r = this.rng.next();
    if (r < 0.2) this.spawnPickup('food', b.x, b.y, 30);
    else if (r < 0.25) this.spawnPickup('magnet', b.x, b.y, 1);
    else if (r < 0.27) this.spawnPickup('bomb', b.x, b.y, 1);
    else this.spawnPickup('gold', b.x, b.y, this.rng.int(1, 5));
    this.emit({ t: 'brazier', id: b.id, x: b.x, y: b.y, pid: p ? p.pid : '' });
  };
})(globalThis.ED || (globalThis.ED = {}));
