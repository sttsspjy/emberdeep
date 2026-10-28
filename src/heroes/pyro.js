// Pyro: hero data, signature Fire Bolt (3 paths x 3 ranks) + Form Inferno (path 0), Q Meteor (3 skill levels).
// Fire pools are zones (look 'firepool'); at most POOL_MAX live pools per hero (ws.st.pools ring, refs checked by id).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  const POOL_MAX = 14, INF_MAX = 22, INF_R = 95;

  ED.regLook('firepool', 'ember', 'meteor', 'crater');
  ED.addHero({ id: 'pyro', name: 'Pyro', hp: 85, speed: 74, crit: 0.05, sig: 'firebolt', skills: ['meteor'], icon: 'hero.pyro.idle', col: '#ff8a3d', txt: 'Bolts that burst into flame.' });

  // Live pool list of a weapon slot: ws.st.pools = [zone], ws.st.ids = [id]; returns the live count after dropping dead entries.
  const livePools = (ws) => {
    const P = ws.st.pools || (ws.st.pools = []), I = ws.st.ids || (ws.st.ids = []);
    let n = 0;
    for (let i = 0; i < P.length; i++) { const z = P[i]; if (!z.dead && z.id === I[i]) { P[n] = z; I[n] = I[i]; n++; } }
    P.length = I.length = n;
    return n;
  };
  const POOL = { team: 0, p: null, wid: '', x: 0, y: 0, r: 0, dur: 0, dps: 0, tick: 0.5, burn: null, look: 'firepool', st: null, onTick: null };
  const pool = (w, p, ws, x, y, r, dur, dps, st, onTick) => {
    POOL.p = p; POOL.wid = ws.id; POOL.x = x; POOL.y = y; POOL.r = r; POOL.dur = dur; POOL.dps = dps; POOL.burn = null; POOL.st = st || null; POOL.onTick = onTick || null;
    const z = w.zone(POOL);
    ws.st.pools.push(z); ws.st.ids.push(z.id);
    return z;
  };

  // ---------------- Fire Bolt ----------------
  // S.n bolts (0.18 rad fan) at the nearest foe, else along p.mdir. Each hit: a burst (22 px x area, half damage, burn) and a fire pool (18 px x area, 0.6 x dmg per second, S.dur s);
  // embers: the burst throws that many embers (40% damage, burn).
  const BURN = [0, 0], BURST = { look: 'fire', burn: BURN, knock: 60 };
  const EMBER = { look: 'ember', speed: 210, dmg: 0, pierce: 0, r: 4, life: 0.35, knock: 30, onHit: null };
  const emberHit = (w, pr, e) => { if (!e.dead) w.burn(e, pr.dmg * 0.5, 2, pr.p); };
  EMBER.onHit = emberHit;
  const burst = (w, pr, e) => {
    const ws = pr.st, S = ws && ws.S; if (!S) return;
    const p = pr.p, x = e.x, y = e.y;
    BURN[0] = S.dmg * 0.3; BURN[1] = 2.5;
    w.blast(p, pr.wid, x, y, 22 * S.area, pr.dmg * 0.5, BURST);
    if (livePools(ws) < POOL_MAX) pool(w, p, ws, x, y, 18 * S.area, S.dur, S.dmg * 0.6);
    const m = S.embers | 0;
    if (m > 0) { EMBER.dmg = pr.dmg * 0.4; const a0 = w.rng.next() * TAU; for (let i = 0; i < m; i++) w.shoot(p, pr.wid, x, y, a0 + i / m * TAU, null, EMBER); }
  };
  const BOLT = { look: 'fireball', onHit: burst, st: null };
  const bolts = (w, p, ws, S, spread) => {
    const t = w.nearestFoe(p.x, p.y, S.range);
    const a = t ? Math.atan2(t.y - p.y, t.x - p.x) : p.mdir, n = Math.max(1, S.n | 0);
    BOLT.st = ws;
    for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * spread, S, BOLT);
    return true;
  };
  ED.addWeapon({
    id: 'firebolt', name: 'Fire Bolt', icon: 'weapon.firestaff', look: 'fireball', sig: 'pyro', mode: 'nearest', txt: 'Bolt that bursts into fire',
    base: { dmg: 16, cd: 1.1, n: 1, pierce: 0, area: 1, speed: 260, dur: 2, knock: 30, range: 340, embers: 0 },
    paths: [
      { id: 'salvo', name: 'Salvo', form: 'inferno', ranks: [
        { mods: { n: 1 }, txt: '+1 bolt' },
        { mods: { n: 1 }, txt: '+1 bolt' },
        { mods: { dmg: 0.25, n: 1 }, txt: '+25% damage, +1 bolt' }] },
      { id: 'blaze', name: 'Blaze', form: null, ranks: [
        { mods: { area: 0.3 }, txt: 'Bigger bursts and fire pools' },
        { mods: { dur: 0.6 }, txt: 'Fire pools last 60% longer' },
        { mods: { area: 0.25 }, txt: '+25% burst and pool size' }] },
      { id: 'embers', name: 'Embers', form: null, ranks: [
        { mods: { dmg: 0.25, pierce: 1 }, txt: '+25% damage, bolts pierce 1' },
        { mods: { embers: 4 }, txt: 'Bursts throw 4 embers' },
        { mods: { embers: 2 }, txt: 'Bursts throw 2 more embers' }] },
    ],
    hybrids: [],
  }, { fire: (w, p, ws, S) => bolts(w, p, ws, S, 0.18) });

  // Inferno: bolts (nearest foe, else p.mdir) burst as Fire Bolt; a new pool touching a live pool merges into it (grows to INF_R at most, timer refreshed); each pool spreads once,
  // after 1 s, a 0.75x pool toward the nearest foe outside it (two generations).
  const infTick = (w, z) => {
    const s = z.st;
    if (s.spread || s.gen >= 2 || z.t < 1 || !s.ws.S) return;
    s.spread = true;
    const e = w.nearestFoe(z.x, z.y, z.r + 90, (f) => U.dist2(f.x, f.y, z.x, z.y) < z.r * z.r);
    if (!e || livePools(s.ws) >= INF_MAX) return;
    const a = Math.atan2(e.y - z.y, e.x - z.x), r = Math.max(14, z.r * 0.75);
    pool(w, s.p, s.ws, z.x + Math.cos(a) * (z.r + r * 0.6), z.y + Math.sin(a) * (z.r + r * 0.6), r, s.ws.S.dur, z.dps, { p: s.p, ws: s.ws, gen: s.gen + 1, spread: false }, infTick);
  };
  const infBurst = (w, pr, e) => {
    const ws = pr.st, S = ws && ws.S; if (!S) return;
    const p = pr.p, x = e.x, y = e.y, r = 22 * S.area;
    BURN[0] = S.dmg * 0.35; BURN[1] = 3;
    w.blast(p, pr.wid, x, y, r * 1.2, pr.dmg * 0.5, BURST);
    const n = livePools(ws), P = ws.st.pools;
    let hit = null;
    for (let i = 0; i < n; i++) { const z = P[i]; if (U.dist2(x, y, z.x, z.y) <= (z.r + r * 0.8) ** 2) { hit = z; break; } }
    if (hit) {
      const nr = Math.min(INF_R, Math.sqrt(hit.r * hit.r + r * r * 0.35));
      hit.x += (x - hit.x) * 0.15; hit.y += (y - hit.y) * 0.15; hit.r = nr; hit.dur = hit.t + S.dur;
    } else if (n < INF_MAX) pool(w, p, ws, x, y, r, S.dur, S.dmg * 0.7, { p, ws, gen: 0, spread: false }, infTick);
    const m = S.embers | 0;
    if (m > 0) { EMBER.dmg = pr.dmg * 0.4; const a0 = w.rng.next() * TAU; for (let i = 0; i < m; i++) w.shoot(p, pr.wid, x, y, a0 + i / m * TAU, null, EMBER); }
  };
  const IBOLT = { look: 'fireball', onHit: infBurst, st: null };
  ED.addWeapon({
    id: 'inferno', name: 'Inferno', icon: 'weapon.inferno', look: 'fireball', sig: 'pyro', mode: 'nearest', evolved: true, form: true, from: 'firebolt', txt: 'Pools merge and spread',
    base: { dmg: 26, cd: 0.9, n: 4, pierce: 1, area: 1.5, speed: 290, dur: 3.5, knock: 40, range: 380, embers: 4 },
    refine: [
      { mods: { n: 1 }, txt: '+1 bolt' },
      { mods: { area: 0.25, dur: 0.3 }, txt: '+25% pool size, last 30% longer' },
    ],
  }, {
    fire(w, p, ws, S) {
      const t = w.nearestFoe(p.x, p.y, S.range);
      const a = t ? Math.atan2(t.y - p.y, t.x - p.x) : p.mdir, n = Math.max(1, S.n | 0);
      IBOLT.st = ws;
      for (let i = 0; i < n; i++) w.shoot(p, ws.id, p.x, p.y - 6, a + (i - (n - 1) / 2) * 0.22, S, IBOLT);
      return true;
    },
  });

  // ---------------- skills ----------------
  // Meteor: a 0.5 s fall onto the cursor (team 0 warn zone), then N.dmg in N.r with burn and knockback, and a burning crater (0.8 r, 0.25 x dmg per second, 3 s).
  // shards: the impact flings that many fireballs; extra: that many smaller meteors land around it, 0.15 s apart.
  const SHARD = { look: 'fireball', speed: 240, dmg: 0, pierce: 2, r: 6, life: 0.6, knock: 80, onHit: emberHit };
  const metEnd = (w, z) => {
    const s = z.st;
    w.zone({ team: 0, p: s.p, wid: 'meteor', x: z.x, y: z.y, r: z.r * 0.8, dur: 3 * (1 + s.p.stats.duration), dps: s.dmg * 0.25, tick: 0.5, burn: [s.dmg * 0.08, 2], look: 'crater' });
    const m = s.shards | 0;
    SHARD.dmg = s.dmg * 0.3;
    for (let i = 0; i < m; i++) w.shoot(s.p, 'meteor', z.x, z.y, (i + 0.5) / m * TAU, null, SHARD);
  };
  const meteor = (w, p, x, y, r, dmg, fall, shards) => w.zone({ team: 0, warn: true, p, wid: 'meteor', x, y, r, dur: fall, dmg, burn: [dmg * 0.12, 3], knock: 320, look: 'meteor',
    st: { p, dmg, shards }, onEnd: metEnd });
  ED.addSkill({
    id: 'meteor', name: 'Meteor', icon: 'proj.fireball', cd: 10, txt: 'A meteor falls on the cursor',
    base: { dmg: 110, r: 90, fall: 0.5, shards: 0, extra: 0 },
    levels: [
      { mods: { r: 0.3 }, txt: '+30% impact size' },
      { mods: { shards: 10 }, txt: 'Impact flings 10 fireballs' },
      { mods: { extra: 2 }, txt: '+2 meteors around it' },
    ],
  }, (w, p, x, y, N) => {
    meteor(w, p, x, y, N.r, N.dmg, N.fall, N.shards);
    const m = N.extra | 0, a0 = Math.atan2(y - p.y, x - p.x);
    for (let i = 0; i < m; i++) { const a = a0 + Math.PI / 2 + i / m * TAU; meteor(w, p, x + Math.cos(a) * N.r * 1.25, y + Math.sin(a) * N.r * 1.25, N.r * 0.7, N.dmg * 0.6, N.fall + 0.15 * (i + 1), N.shards >> 1); }
    return { r: Math.round(N.r), shake: 4, stop: 0.03 };
  });
})(globalThis.ED || (globalThis.ED = {}));
