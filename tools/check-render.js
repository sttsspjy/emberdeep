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

// ---- fodder: snapshot rows, mirror, art alias, render detail, damage numbers ----
// The client modules load into this context over stand-ins for the browser-only ones (a property read on a stand-in gives a callable no-op); this block runs last.
{
  const stub = (own) => {
    const o = own || {};
    return new Proxy(function () { return stub(); }, {
      get: (t, k) => (k in o ? o[k] : k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : stub()),
      set: (t, k, v) => { o[k] = v; return true; }, apply: () => stub(), construct: () => ({}),
    });
  };
  const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
  load('net.js'); load('art/meta.js');
  const vars = {}; // 'anim|variant key' -> colour map (the stand-in atlas records what Atlas.variant is asked to build)
  const ART = ED.ART, N = ED.Net;
  ED.Atlas = stub({ ok: true, has: (id) => !!ART.anims[id], anim: (id) => ART.anims[id],
    variant: (id, key, make) => { if (!ART.anims[id]) return false; if (make && !vars[id + '|' + key]) vars[id + '|' + key] = make(ART.pal[id] || []); return true; } });
  ED.Pix = stub({ s2: (v) => Math.round(v / 2) * 2 });
  for (const k of ['Sprites', 'Bmp', 'Tiles', 'Audio', 'HUD', 'Input']) ED[k] = stub();
  for (const f of ['client/actors.js', 'client/fx.js', 'client/render.js', 'game.js']) load(f);
  const AC = ED.Actors, F = ED.FX, R = ED.Render, G = ED.Game;
  const ids = ED.biomeFor(1).enemies.map((r) => r[0]).filter((t) => { const d = ED.ENEMIES[t]; return d && !d.boss && !d.ally && !d.minion; });
  const room1 = (pact) => {
    const w = new ED.World({ seed: 7, pact, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() }] });
    w.startRun(); w.enemies.length = 0; w.enc = null; w.locked = false;
    return w;
  };
  const wire = (s) => JSON.parse(JSON.stringify(s));
  const mirrorOf = (w) => new G.Mirror({ pact: w.pact, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() }] }, 'p0');

  // wire size: 150 foes, 100 of them fodder
  {
    const w = room1(0), foes = [];
    for (let i = 0; i < 150; i++) foes.push(w.spawnEnemy(ids[i % ids.length], 100 + (i % 15) * 20, 100 + Math.floor(i / 15) * 20, {}));
    foes.forEach((e, i) => { e.hp = e.maxHp * (0.3 + 0.7 * ((i * 37) % 100) / 100); });
    const before = wire(N.encodeSnap(w, [], false));
    foes.forEach((e, i) => { e.fodder = i < 100; });
    const after = wire(N.encodeSnap(w, [], false));
    const bytes = (o) => JSON.stringify(o).length;
    console.log(`snapshot with 150 foes (100 fodder): before ${bytes(before)} B (E ${before.E.length} rows, ${bytes(before.E)} B), after ${bytes(after)} B (E ${after.E.length} rows ${bytes(after.E)} B + H ${after.H.length} rows ${bytes(after.H)} B)`);
    ok(before.E.length === 150 && before.H.length === 0, 'no fodder: all 150 foes ride in E, H is empty');
    ok(after.E.length === 50 && after.H.length === 100, `100 fodder foes ride in H, the other 50 in E (E ${after.E.length}, H ${after.H.length})`);
    ok(bytes(after) < bytes(before) * 0.7, `the fodder rows shrink the snapshot by more than 30% (${bytes(before)} -> ${bytes(after)} B)`);
    ok(after.H.every((r) => r.length === 6) && !after.E.some((r) => foes.some((e, i) => i < 100 && e.id === r[0])), 'H rows have 6 fields and a fodder foe is in no E row');
  }

  // H rows and the mirror
  {
    const w = room1(10), mk = (i, x, y, f, set) => { const e = w.spawnEnemy(ids[i % ids.length], x, y, {}); e.fodder = true; e.hp = e.maxHp * f; Object.assign(e, set); return e; };
    const full = mk(0, 100.4, 200.6, 1, {}), low = mk(1, 130, 200, 0.0001, { face: -1 }), half = mk(2, 160, 200, 0.5, { flash: 0.05, frozen: 1 });
    const fx = mk(3, 190, 200, 0.9, { stun: 1, chill: 30, burn: 4 }), plain = w.spawnEnemy('skeleton', 220, 200, {}), dead = mk(0, 250, 200, 1, {});
    dead.hp = 0;
    const s1 = wire(N.encodeSnap(w, [], false)), row = (e) => s1.H.find((r) => r[0] === e.id);
    ok(s1.H.length === 4 && !row(dead) && !s1.H.some((r) => r[0] === plain.id) && s1.E.length === 1, 'H holds the live fodder foes only; a normal foe stays in E');
    ok(row(full)[1] === ED.ENEMY_IDX[full.type] && row(full)[2] === 100 && row(full)[3] === 201 && row(full)[4] === 255 && row(full)[5] === 0, `a full-health fodder row: [id, type index, x, y, 255, 0] (${row(full)})`);
    ok(row(low)[4] === 1 && (row(low)[5] & 32) === 32, `hpQ never reaches 0 while alive; bit 5 = faces left (${row(low)})`);
    ok(row(half)[4] === 128 && (row(half)[5] & 3) === 3, `half health is 128/255; flash and frozen are bits 0 and 1 (${row(half)})`);
    ok((row(fx)[5] & 28) === 28 && (row(fx)[5] & 3) === 0, `stunned 4, chilled 8, burning 16 (${row(fx)})`);
    const m = mirrorOf(w);
    const feed = (snap, T, recv, rt) => { snap.T = T; m.apply(snap, recv); m.renderT = rt; m.update(0, recv + rt - T + 0.1); }; // ingest a snapshot received at `recv` and render the world at host time rt
    feed(s1, 5, 0, 5);
    const v = (e) => m.enemies.find((q) => q.id === e.id);
    ok(m.enemies.length === 5 && v(full) && v(plain) && v(plain).fodder === undefined, 'view.enemies merges the fodder foes with the E foes');
    const vf = v(full);
    ok(vf.fodder === true && vf.type === full.type && vf.def === ED.ENEMIES[full.type] && vf.boss === false && vf.elite === null && vf.st === 'move' && vf.r === vf.def.r, 'a fodder view foe carries id, type, def, fodder, r, no elite, not a boss, state move');
    ok(Math.abs(vf.x - 100) < 1e-9 && Math.abs(vf.y - 201) < 1e-9 && Math.abs(v(low).x - 130) < 1e-9, 'positions are the rounded wire values');
    ok(Math.abs(vf.maxHp - full.maxHp) < 1e-6 * full.maxHp && Math.abs(v(half).maxHp - half.maxHp) < 1e-6 * half.maxHp, `max HP follows spawnEnemy (depth curve, pact 10): ${vf.maxHp} vs ${full.maxHp}`);
    ok(Math.abs(v(half).hp / v(half).maxHp - 0.5) < 1 / 255 && v(low).hp > 0 && v(low).hp / v(low).maxHp < 0.005 && vf.hp === vf.maxHp, 'hp = hpQ / 255 of the max HP');
    const vx = v(fx), vh = v(half), vl = v(low);
    ok(vh.flash > 0 && vh.frozen > 0 && !(vh.stun > 0) && vx.stun > 0 && vx.chill > 0 && vx.burn > 0 && vx.burnLvl === 1 && !(vx.frozen > 0) && !(vf.flash > 0 || vf.chill > 0 || vf.burn > 0), 'status flags decode: flash, frozen, stunned, chilled, burning');
    ok(vl.face === -1 && vf.face === 1, 'bit 5 decodes the facing');
    // interpolation between two snapshots; the objects persist
    full.x += 10; const s2 = wire(N.encodeSnap(w, [], false));
    feed(s2, 5.1, 0.1, 5.05);
    ok(v(full) === vf && Math.abs(vf.x - 105) < 1e-9, `fodder positions interpolate like E rows and the view object is reused (x ${vf.x})`);
    // a foe that dies leaves the view
    full.hp = 0; const s3 = wire(N.encodeSnap(w, [], false));
    feed(s3, 5.2, 0.2, 5.15);
    ok(!m.enemies.some((q) => q.id === full.id) && m.enemies.some((q) => q.id === half.id), 'a dead fodder foe is gone from the view');
    ok(m.pact === 10, 'the mirror holds the pact the max HP is scaled by');
  }

  // art alias
  {
    const bat = ED.ENEMIES.bat, colA = { a: '#c03020', b: '#401008', c: '#ffd060' }, colB = { a: '#2060c0', b: '#081040', c: '#60d0ff' };
    ED.ENEMIES.fodtestA = Object.assign({}, bat, { art: 'bat', col: colA, fodder: true });
    ED.ENEMIES.fodtestB = Object.assign({}, bat, { art: 'bat', col: colB, fodder: true });
    ED.ENEMIES.fodtestX = Object.assign({}, bat, { art: 'no_such_art', fodder: true });
    const ia = AC.foeInfo('fodtestA'), ib = AC.foeInfo('bat');
    ok(ia.k > 0 && ia.k === ib.k && JSON.stringify(ia.walk) === JSON.stringify(ib.walk) && ia.def === ED.ENEMIES.fodtestA, 'an aliased def uses the anim set of foe.<art>.* (and keeps its own def)');
    ok(AC.foeInfo('fodtestX').k === 0, 'an alias whose art is missing has no atlas body: the procedural look draws it');
    const anim = ia.k === 4 ? ia.walk.d : ia.walk;
    const ka = AC.foeVar('fodtestA', anim), kb = AC.foeVar('fodtestB', anim), k0 = AC.foeVar('bat', anim);
    ok(ka === 'pal:f:fodtestA' && kb === 'pal:f:fodtestB' && k0 === 'pal:f', `each def has its own variant key on the shared anim (${ka}, ${kb}, ${k0})`);
    const ma = vars[anim + '|' + ka], mb = vars[anim + '|' + kb], m0 = vars[anim + '|' + k0];
    const src = (ART.pal[anim] || []).filter((h) => h !== '#222222');
    ok(src.length > 2 && src.every((h) => ma[h] && mb[h] && m0[h]), `the recolour maps every source colour of ${anim} (${src.length})`);
    ok(src.some((h) => ma[h] !== mb[h]) && src.some((h) => ma[h] !== m0[h]), 'two aliases of one art, and the art itself, get different colours');
    // warm-up builds the fodder sheets of the stratum
    const bm = ED.biomeFor(1), had = bm.fodder; bm.fodder = ['fodtestB'];
    for (const k of Object.keys(vars)) delete vars[k];
    AC.warm(1); for (let i = 0; i < 4000; i++) AC.pump();
    ok(vars[anim + '|pal:f:fodtestB'], 'AC.warm queues the biome fodder ids');
    if (had === undefined) delete bm.fodder; else bm.fodder = had;
    delete ED.ENEMIES.fodtestA; delete ED.ENEMIES.fodtestB; delete ED.ENEMIES.fodtestX;
  }

  // render detail
  {
    const mkFoe = (x, fodder, extra) => Object.assign({ x, y: 0, r: 10, hp: 10, maxHp: 10, fodder: !!fodder, elite: null, boss: false }, extra);
    const me = { x: 0, y: 0 };
    const stage = (foes) => { foes.forEach((e, i) => R.lod.push(i, e)); const dn = foes.length; R.lod.run({ players: new Map([['p0', me]]) }, 'p0', dn, dn); return foes.map((e, i) => R.lod.list[i].full); };
    // 100 foes: 60 fodder next to the hero, 40 normal foes further out (2 of them elite / boss)
    const foes = [];
    for (let i = 0; i < 60; i++) foes.push(mkFoe(5 + i, true));
    for (let i = 0; i < 40; i++) foes.push(mkFoe(200 + i * 10, false));
    foes[98].elite = 'swift'; foes[99].boss = true;
    const full = stage(foes);
    ok(full.slice(0, 60).every((f) => f === false), 'a fodder foe never gets full detail, however near the hero');
    ok(full.slice(60, 72).every((f) => f === true) && full.slice(72, 98).every((f) => f === false), 'the 12 nearest normal foes keep full detail (the fodder does not use up the NEAR_N slots)');
    ok(full[98] === true && full[99] === true, 'an elite and a boss keep full detail');
    const few = [mkFoe(900, false), mkFoe(950, false)]; for (let i = 0; i < 60; i++) few.push(mkFoe(5 + i, true));
    const fewF = stage(few);
    ok(fewF[0] && fewF[1] && fewF.slice(2).every((f) => !f), 'in a crowd of fodder the few normal foes all keep full detail');
    const small = [mkFoe(10, true), mkFoe(20, false), mkFoe(30, true)];
    const smallF = stage(small);
    ok(smallF[0] === false && smallF[1] === true && smallF[2] === false, 'below the crowd size fodder still draws light and the others full');
    // health bars: fodder none at full health, then a 1 px bar
    ok(R.foeBarH(mkFoe(0, true), 3) === 0 && R.foeBarH(mkFoe(0, true, { hp: 9.995 }), 3) === 0, 'a fodder foe at full health has no bar');
    ok(R.foeBarH(mkFoe(0, true, { hp: 9 }), 3) === 1 && R.foeBarH(mkFoe(0, true, { hp: 1 }), 2) === 1, 'a damaged fodder foe has a 1 px bar');
    ok(R.foeBarH(mkFoe(0, false, { hp: 9 }), 3) === 3 && R.foeBarH(mkFoe(0, false), 3) === 0 && R.foeBarH(mkFoe(0, false, { elite: 'swift' }), 2) === 2, 'normal foes keep their bar rules');
    // status passes: fodder only for freeze, chill, burn (drawn at full = false), marks only for the stun stars
    const L = R.lod;
    ok(!L.status(mkFoe(0, true)) && !L.status(mkFoe(0, true, { stun: 1 })) && L.status(mkFoe(0, true, { frozen: 1 })) && L.status(mkFoe(0, true, { chill: 40 })) && L.status(mkFoe(0, true, { burn: 1, burnPool: 1 })), 'fodder gets a status pass only while frozen, chilled or burning');
    ok(L.status(mkFoe(0, false)) && L.marks(mkFoe(0, false)) && !L.marks(mkFoe(0, true)) && !L.marks(mkFoe(0, true, { venom: 80 })) && L.marks(mkFoe(0, true, { stun: 1 })), 'status and mark passes are unchanged for normal foes; fodder marks only for stun');
    ok(stage([mkFoe(1, true, { frozen: 1, chill: 40, burn: 1 })])[0] === false, 'a frozen, chilled, burning fodder foe is still drawn at light detail (the status pass gets full = false)');
  }

  // damage numbers
  {
    const ctx = { localPid: 'p0', player: () => ({ x: 0, y: 0, pid: 'p0', cls: 'knight' }), players: () => [], stratum: () => 1 };
    const hit = (o) => F.handle(Object.assign({ t: 'hit', x: 100, y: 100, v: 30, pid: 'p0' }, o), ctx);
    F.reset();
    hit({ f: 1 }); ok(F.texts.length === 0, 'a non-crit fodder hit prints no number');
    hit({ f: 1, v: 400 }); hit({ f: 1, pid: 'p1' }); ok(F.texts.length === 0, 'not even a big one or one of another hero');
    hit({ f: 1, c: 1 }); ok(F.texts.length === 1 && F.texts[0].crit, 'a crit fodder hit prints its number');
    hit({ f: 1 }); ok(F.texts.length === 1 && F.texts[0].s === '30', 'a non-crit fodder hit does not add into a crit number');
    F.reset();
    hit({}); ok(F.texts.length === 1 && F.texts[0].s === '30', 'a normal hit prints a number');
    hit({ f: 1, v: 12 }); ok(F.texts.length === 1 && F.texts[0].s === '42', `a non-crit fodder hit adds into the number of its spot (${F.texts[0].s})`);
    hit({ f: 1, v: 5, x: 160 }); ok(F.texts.length === 1, 'a non-crit fodder hit elsewhere makes no number');
    F.texts[0].life = F.texts[0].max - 0.2;
    hit({ f: 1, v: 7 }); ok(F.texts.length === 1 && F.texts[0].s === '42', 'a number older than 150 ms takes no more');
    hit({ c: 1, v: 9 }); ok(F.texts.length === 2, 'a crit makes its own number');
    F.reset();
  }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
