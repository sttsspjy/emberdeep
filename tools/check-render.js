// Usage: node tools/check-render.js
// Headless checks of render review fixes: the hit-flash rules of the sim (DoT ticks never flash, a flash is 66 ms, flashes are 120 ms apart, a new foe flashes on its first hit) and the art anchors the client reads
// (a per-frame Hollow King crown point on his head, foe and boss head lines within 3 art px of their own frames, eye points inside the anim's frames). Prints failures and exits 1 when any check fails.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

// ---- hit flash ----
{
  const w = new ED.World({ seed: 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  w.enemies.length = 0; w.enc = null; w.locked = false;
  const e = w.spawnEnemy('skeleton', 300, 300, {}); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 1e6;
  ok(!(e.flash > 0), 'a new foe is not flashing');
  const tick = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) w.updateEnemy(e, 1 / 60); };
  w.hitEnemy(e, 5, { p, kind: 'dot', raw: true, noProc: true, crit: false });
  ok(!(e.flash > 0), 'a DoT tick does not flash');
  w.hitEnemy(e, 5, { p, kind: 'weapon' });
  ok(e.flash > 0 && e.flash <= 0.07, `a weapon hit sets a 66 ms flash (got ${e.flash})`);
  tick(0.05); w.hitEnemy(e, 5, { p, kind: 'weapon' });
  ok(e.flash < 0.03, `a hit during the flash does not restart it (got ${e.flash})`);
  tick(0.1); w.hitEnemy(e, 5, { p, kind: 'weapon' });
  ok(!(e.flash > 0.01), `a hit 100 ms after a flash ended is still inside the 120 ms gap (got ${e.flash})`);
  tick(0.3); ok(!(e.flash > 0), 'the flash has ended');
  w.hitEnemy(e, 5, { p, kind: 'dot', raw: true, noProc: true, crit: false }); ok(!(e.flash > 0), 'a DoT tick after the gap still does not flash');
  w.hitEnemy(e, 5, { p, kind: 'weapon' }); ok(e.flash > 0, 'a weapon hit after the gap flashes again');
  const f = w.spawnEnemy('skeleton', 340, 300, {}); ok(f.flash <= 0, 'a spawned foe starts without a flash'); w.hitEnemy(f, 5, { p, kind: 'weapon' }); ok(f.flash > 0, 'its first hit flashes');
}

// ---- art anchors ----
{
  const ctx = { ED: {}, globalThis: null, window: null }; ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'art', 'meta.js'), 'utf8'), ctx);
  const A = ctx.ED.ART;
  let bodies = 0;
  for (const id of Object.keys(A.anims)) {
    if (!/^(foe|boss)\./.test(id)) continue;
    const r = A.anims[id], fr = r.f.map((q) => A.frames[q]).filter((q) => q.h > 0);
    if (!fr.length) continue;
    bodies++;
    const mn = Math.min(...fr.map((q) => q.oy));
    ok(mn - r.anchors.top <= 3, `${id}: head line ${r.anchors.top} floats more than 3 art px above its frames (top ${mn})`);
    const ey = r.anchors.eye && r.anchors.eye[0];
    if (ey) ok(fr.some((q) => ey[1] >= q.oy && ey[1] < q.oy + q.h), `${id}: eye point y ${ey[1]} is outside every frame`);
  }
  ok(bodies > 150, `foe and boss anims checked (${bodies})`);
  for (const an of ['idle', 'walk', 'attack', 'hit', 'death']) {
    const id = 'boss.hollowking.' + an, r = A.anims[id], cr = r && r.anchors.crown;
    ok(cr && cr.length === r.f.length, `${id}: one crown point per frame`);
    if (!cr) continue;
    cr.forEach((q, i) => {
      const f = A.frames[r.f[i]];
      ok(q[0] >= f.ox && q[0] < f.ox + f.w && q[1] >= f.oy && q[1] < f.oy + f.h, `${id} frame ${i}: crown point ${q} lies inside the frame (${f.ox},${f.oy} ${f.w}x${f.h})`);
    });
  }
  const idle = A.anims['boss.hollowking.idle'].anchors.crown, walk = A.anims['boss.hollowking.walk'].anchors.crown;
  ok(walk[0][0] - idle[0][0] >= 8, 'the walking head is further right than the standing one (the crown follows it)');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
