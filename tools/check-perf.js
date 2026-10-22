// Usage: node tools/check-perf.js [--audit-only] [--limit=<ms per tick at 150 foes>] [--reps=N]
// Headless sim cost per tick against the live foe count (hordes: up to 120 foes solo, 180 in a party). One hero stands in the largest combat room (37x17 tiles) and fires volleys at the nearest foe while N mixed foes
// (every non-boss roster type) pile up around it; foes carry 25x HP so the count holds. Per count: 200 warm-up ticks, then 600 ticks at dt 1/60; the best of N runs, mean of its fastest 95% of ticks.
// Fails when 150 foes cost more than the limit or when the audit finds a difference; the 200 / 70 cost ratio is printed (x2.86 would be linear in the foe count).
// Audit (normal foe HP, respawns, a kiting hero, kills and splits): every foesNear call must return each foe that a full scan finds within the circle, ascending and alive, including random probes inside the foe loop of
// update(); every foeScan must be paired with a foeEnd; separate() must leave every foe where the original O(n^2) loops leave it, in the sim and in random packs.
const { ED } = require('./sim.js');
const U = ED.U, D = ED.Dungeon, T = ED.CONST.TILE;
const argv = process.argv.slice(2);
const flag = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? +a.split('=')[1] : d; };
const TIMED = [{ cls: 'ranger', kite: false, hp: 25 }, { cls: 'pyro', kite: false, hp: 25 }];
const AUDITED = [{ cls: 'ranger', kite: true, hp: 1 }, { cls: 'pyro', kite: false, hp: 1 }, { cls: 'ranger', kite: false, hp: 1 }];
const CARRY = flag('carry', 10); // px per tick that the audit's hero effect moves the foes around the hero (the grid tolerates 42)
const COUNTS = [70, 150, 200], TICKS = 600, DT = 1 / 60, WARM = 200, VOLLEY = 4; // VOLLEY: attacks per attack interval (multishot and attack speed of a late build)
// Gate: ms per tick at 150 foes. Measured on these scenarios: 0.6 before the foe grid, 0.2 after; 0.5 fails the old sim and leaves the new one 2x room (the frame is 16.7 ms, shared with snapshots and rendering).
const LIMIT = flag('limit', 0.5);
const REPS = flag('reps', 5);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

const rosterTypes = (() => {
  const set = new Set();
  for (const b of ED.BIOMES) for (const r of b.enemies) { const d = ED.ENEMIES[r[0]]; if (d && !d.boss && !d.ally && !d.minion) set.add(r[0]); }
  return [...set].sort();
})();
const bigRoom = (() => {
  for (let s = 1; s < 2000; s++) {
    const f = D.generate(1, s), r = f.rooms.find(q => q.type === 'combat' && q.w === 37 && q.h === 17);
    if (r) return { f, id: r.id };
  }
  throw new Error('no 37x17 combat room found');
})();

function stage(sc) {
  const cls = sc.cls;
  const w = new ED.World({ seed: 11, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[0], meta: META() }] });
  w.startRun();
  w.floor = bigRoom.f; w.roomState = {};
  for (const r of w.floor.rooms) w.roomState[r.id] = { visited: false, known: false, cleared: true, props: null };
  w.enterRoom(bigRoom.id, null);
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0;
  const p = w.players.get('p0');
  p.offers.length = 0; p.offer = null;
  return { w, p, sc, rng: U.RNG(0x9e3779b9), c: { atk: 0, t: 0, first: true } };
}

// Spawns foes on floor tiles until n are alive: the first fill lands 50-260 px from the hero (a pile), later ones at least 140 px away.
function topUp(s, n) {
  const { w, p, rng, sc } = s, room = w.room, near = s.c.first;
  let live = 0;
  for (const e of w.enemies) if (e.hp > 0) live++;
  while (live < n) {
    let x, y;
    if (near) { const a = rng.next() * U.TAU, d = 50 + rng.next() * 210; x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d; }
    else { x = (1 + rng.next() * (room.w - 2)) * T; y = (1 + rng.next() * (room.h - 2)) * T; if (U.dist2(x, y, p.x, p.y) < 140 * 140) continue; }
    if (D.tileAt(room, x, y) !== 0) continue;
    const type = rosterTypes[Math.floor(rng.next() * rosterTypes.length)];
    const e = w.spawnEnemy(type, x, y);
    e.hp = e.maxHp = e.hp * sc.hp;
    live++;
  }
  s.c.first = false;
}

// One tick: the hero (circling when it kites) fires at the nearest foe, the world steps. Returns the ms spent in the sim (movement, attacks and update).
function tick(s, n) {
  const { w, p, c } = s, k = s.sc.kite ? 1 : 0;
  topUp(s, n);
  p.invuln = 1e9;
  c.t += DT;
  c.atk -= DT;
  let tgt = null, bd = 1e12;
  if (c.atk <= 0) for (const e of w.enemies) { if (e.hp <= 0 || e.spawnT > 0) continue; const d = U.dist2(e.x, e.y, p.x, p.y); if (d < bd) { bd = d; tgt = e; } }
  const t0 = process.hrtime.bigint();
  if (k) ED.Sim.movePlayer(p, { mx: Math.cos(c.t * 0.9), my: Math.sin(c.t * 0.9) }, DT, w.room, w.locked, w.zones);
  if (tgt) { for (let v = 0; v < VOLLEY; v++) w.playerAttack(p, Math.atan2(tgt.y - p.y, tgt.x - p.x) + (v - (VOLLEY - 1) / 2) * 0.12); c.atk = Math.max(c.atk, -DT) + ED.Stats.attackInterval(p); }
  w.update(DT);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// Digest of the world after a run: identical sims give identical digests whatever the foe scans are made of.
const digest = (s) => {
  let h = 0;
  for (const e of s.w.enemies) h = (Math.imul(h, 31) + Math.round(e.x * 8) + 7 * Math.round(e.y * 8) + Math.round(e.hp)) | 0;
  return `${s.w.run.kills}/${Math.round(s.p.dealt)}/${s.w.enemies.length}/${h >>> 0}`;
};

function runCount(sc, n) {
  const s = stage(sc);
  for (let i = 0; i < WARM; i++) tick(s, n);
  const t = new Float64Array(TICKS);
  for (let i = 0; i < TICKS; i++) t[i] = tick(s, n);
  t.sort();
  const keep = Math.floor(TICKS * 0.95); // the slowest 5% of ticks (GC pauses, other processes) stay out of the mean; the worst tick is printed on its own
  let ms = 0;
  for (let i = 0; i < keep; i++) ms += t[i];
  return { mean: ms / keep, worst: t[TICKS - 1], digest: digest(s) };
}

// The original O(n^2) separation: the reference that the grid version must reproduce to the last bit.
function refSeparate(w) {
  const es = w.enemies, n = es.length;
  for (let i = 0; i < n; i++) {
    const a = es[i]; if (a.hp <= 0) continue;
    for (let j = i + 1; j < n; j++) {
      const b = es[j]; if (b.hp <= 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 1e-4) continue;
      const am = a.spd > 0 && !a.boss, bm = b.spd > 0 && !b.boss;
      if (!am && !bm) continue;
      const d = Math.sqrt(d2), push = rr - d;
      const wa = am && bm ? 0.5 : am ? 1 : 0, wb = 1 - wa;
      const ux = dx / d, uy = dy / d;
      a.x -= ux * push * wa; a.y -= uy * push * wa;
      b.x += ux * push * wb; b.y += uy * push * wb;
    }
  }
  for (const e of es) if (e.hp > 0 && e.spd > 0) ED.Sim.resolve(e, w.room, w.locked, e.fly);
}

// Audit: (1) every foe a full scan finds inside (x, y, r + its radius) is in the foesNear result, which is ascending and live; the calls come from the sim and from random probes inside the foe loop of update()
// (drifting and newly spawned foes); (2) separate() leaves every foe exactly where refSeparate does.
function audit(sc, n) {
  const s = stage(sc), w = s.w;
  if (!w.foesNear) return { calls: 0, bad: 0, sep: 0, note: 'no foesNear' };
  const orig = w.foesNear, upd = w.updateEnemy, sepFn = w.separate, tickFn = w.update, plFn = w.updatePlayer, znFn = w.updateZones, prng = U.RNG(77), probe = [];
  let calls = 0, bad = 0, sepBad = 0, leaks = 0, first = '', u = 0;
  w.update = function (dt) {
    if (this.fg && this.fg.qd) leaks++;
    const r = tickFn.call(this, dt);
    if (this.fg.qd) leaks++;
    return r;
  };
  w.foesNear = function (x, y, r, out) {
    const res = orig.call(this, x, y, r, out);
    calls++;
    const es = this.enemies;
    let last = -1, ok = true;
    for (const e of res) { const i = es.indexOf(e); if (i <= last || e.hp <= 0) ok = false; last = i; }
    for (const e of es) if (e.hp > 0 && U.dist2(e.x, e.y, x, y) <= (r + e.r) ** 2 && !res.includes(e)) ok = false;
    if (!ok) { bad++; if (!first) first = `t=${this.tick} (${Math.round(x)},${Math.round(y)}) r=${Math.round(r)}`; }
    return res;
  };
  w.updateEnemy = function (e, dt) {
    if ((u++ & 7) === 0) {
      const R = [0, 10, 40, 100, 250, 600, 5000][Math.floor(prng.next() * 7)], x = e.x + (prng.next() - 0.5) * 120, y = e.y + (prng.next() - 0.5) * 120;
      this.foesNear(prng.next() < 0.2 ? prng.next() * 900 - 50 : x, prng.next() < 0.2 ? prng.next() * 600 - 50 : y, R, probe);
    }
    return upd.call(this, e, dt);
  };
  // Movers outside updateEnemy: a hero effect carrying the foes around the hero 10 px per tick (600 px/s) and a zone pulling foes 3 px, each followed by random probes before the next build.
  const carry = (dist, near, hero) => {
    for (const e of w.enemies) {
      if (e.hp <= 0 || U.dist2(e.x, e.y, hero.x, hero.y) > near * near) continue;
      const d = Math.hypot(hero.x - e.x, hero.y - e.y) || 1;
      ED.Sim.moveCircle(e, (hero.x - e.x) / d * dist, (hero.y - e.y) / d * dist, w.room, w.locked, e.fly);
    }
    for (let k = 0; k < 6; k++) w.foesNear(hero.x + (prng.next() - 0.5) * 400, hero.y + (prng.next() - 0.5) * 400, [0, 20, 60, 150][k & 3], probe);
  };
  w.updatePlayer = function (p, dt) { const r = plFn.call(this, p, dt); if (!p.dead && !p.downed) carry(CARRY, 160, p); return r; };
  w.updateZones = function (dt) { carry(3, 400, this.players.values().next().value); return znFn.call(this, dt); };
  w.separate = function () {
    const es = this.enemies, snap = es.map(e => [e.x, e.y]);
    sepFn.call(this);
    const got = es.map(e => [e.x, e.y]);
    es.forEach((e, i) => { e.x = snap[i][0]; e.y = snap[i][1]; });
    refSeparate(this);
    if (es.some((e, i) => e.x !== got[i][0] || e.y !== got[i][1])) sepBad++;
  };
  for (let i = 0; i < WARM + 600; i++) tick(s, n);
  return { calls, bad, sep: sepBad, leaks, first };
}

// Stress: random packs (32-220 foes, radii 5-34, some immobile, bosses, positions clustered tightly and against walls) separate exactly like the reference.
function stressSeparate(trials) {
  const { w } = stage({ cls: 'ranger', kite: false, hp: 1 }), rng = U.RNG(4242), types = [...rosterTypes, 'bonewarden'];
  const room = w.room, W0 = room.w * T, H0 = room.h * T;
  let bad = 0;
  for (let t = 0; t < trials; t++) {
    w.enemies.length = 0;
    const n = 32 + Math.floor(rng.next() * 190), cx = rng.next() * W0, cy = rng.next() * H0, spread = 20 + rng.next() * 260;
    for (let i = 0; i < n; i++) {
      const e = w.spawnEnemy(types[Math.floor(rng.next() * types.length)], 0, 0);
      e.x = Math.min(W0, Math.max(0, cx + (rng.next() - 0.5) * spread * 2)); e.y = Math.min(H0, Math.max(0, cy + (rng.next() - 0.5) * spread * 2));
      e.r = 5 + rng.next() * 29;
      if (rng.next() < 0.1) e.spd = 0;
      if (rng.next() < 0.03) e.hp = 0;
    }
    const es = w.enemies, snap = es.map(e => [e.x, e.y]);
    w.separate();
    const got = es.map(e => [e.x, e.y]);
    es.forEach((e, i) => { e.x = snap[i][0]; e.y = snap[i][1]; });
    refSeparate(w);
    if (es.some((e, i) => e.x !== got[i][0] || e.y !== got[i][1])) bad++;
  }
  return bad;
}

let fails = 0;
// Timing runs first: the audit wraps methods on its worlds, which would make the property reads of the timed worlds polymorphic.
if (!argv.includes('--audit-only')) {
  for (const sc of TIMED) {
    const res = {};
    for (const n of COUNTS) {
      let best = null;
      for (let r = 0; r < REPS; r++) { const m = runCount(sc, n); if (!best || m.mean < best.mean) best = m; }
      res[n] = best;
      console.log(`${sc.cls.padEnd(7)} ${String(n).padStart(3)} foes: ${best.mean.toFixed(3)} ms/tick (worst tick ${best.worst.toFixed(2)} ms) digest ${best.digest}`);
    }
    if (res[150].mean > LIMIT) { fails++; console.log(`FAIL ${sc.cls} at 150 foes: ${res[150].mean.toFixed(3)} ms/tick > ${LIMIT} ms`); }
    const scale = res[200].mean / res[70].mean;
    console.log(`${sc.cls} cost 200 vs 70 foes: x${scale.toFixed(2)} (x2.86 = linear in foes)`);
  }
}
for (const sc of AUDITED) {
  for (const n of [40, 150, 200]) {
    const a = audit(sc, n);
    console.log(`audit ${sc.cls}${sc.kite ? ' kiting' : ''} ${n} foes: ${a.calls} foesNear calls, ${a.bad} bad${a.first ? ' first ' + a.first : ''}, separate differs on ${a.sep} ticks, ${a.leaks} unpaired foeScan ticks${a.note ? ' (' + a.note + ')' : ''}`);
    if (a.bad || a.sep || a.leaks) fails++;
  }
}
{
  const bad = stressSeparate(300);
  console.log(`separate stress: 300 random packs, ${bad} differ from the reference`);
  if (bad) fails++;
}
if (fails) { console.log(fails + ' perf check(s) failed'); process.exit(1); }
console.log('perf ok');
