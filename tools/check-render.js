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
  for (const f of ['client/actors.js', 'client/fx.js', 'client/render.js', 'client/cosmetics.js', 'game.js']) load(f);
  const AC = ED.Actors, F = ED.FX, R = ED.Render, G = ED.Game;

  // ---- Wardrobe in play: the pick's set made safe, skins as swap sheets, titles, sheens, pets and coin trails (cosmetics.js) ----
  {
    const Cos = ED.Cos, W = (o) => Object.assign({ skin: null, aura: null, hat: null, pet: null, trail: null, death: null, title: null, tints: [] }, o);
    const cw = N.cleanWear;
    ok(JSON.stringify(cw(null, 'knight')) === JSON.stringify(W({})) && JSON.stringify(cw('x', 'knight')) === JSON.stringify(W({})), 'cleanWear: a missing or malformed set wears nothing');
    const mixed = cw({ skin: 'skin.ranger.a', aura: 'hat.crown', hat: 'hat.crown', pet: 42, trail: 'trail.coins', death: 'death.nope', title: 'title.contrarian', tints: ['longsword', 'bow', 'longsword', 7] }, 'knight');
    ok(mixed.skin === null && mixed.aura === null && mixed.hat === 'hat.crown' && mixed.pet === null && mixed.trail === 'trail.coins' && mixed.death === null && mixed.title === 'title.contrarian', `cleanWear keeps known items of their own slot and hero only (${JSON.stringify(mixed)})`);
    ok(JSON.stringify(mixed.tints) === JSON.stringify(ED.CLASSES.knight.weapons.filter(x => x === 'longsword')), `cleanWear keeps the hero's own base weapons once (${mixed.tints})`);
    for (const c of ED.CLASS_IDS) {
      const all = W({ skin: `skin.${c}.secret`, aura: 'aura.gilded', hat: 'hat.crown', pet: 'pet.platino', trail: 'trail.coins', death: 'death.embers', title: 'title.many', tints: ED.CLASSES[c].weapons.slice() });
      ok(JSON.stringify(cw(all, c)) === JSON.stringify(all), `cleanWear keeps a full ${c} set`);
      for (const sk of ['a', 'b', 'secret', 'unkindled']) {
        const id = `hero.${c}.idle`, key = AC.heroVar(c, 1, id, sk), sw = ED.ART.swaps[c + '.' + sk], m = vars[id + '|' + key];
        ok(key === 'pal:h1.' + sk && sw && m, `${c} skin ${sk}: its own sheet (${key})`);
        if (!m || !sw) continue;
        ok(Object.keys(sw.base).every(h => sw.key.indexOf(h) >= 0 || m[h] === sw.base[h]) && m[sw.key[0]] === ED.PLAYER_COLORS[1], `${c} skin ${sk}: the swap colours, the key colour in the player colour`);
        ok(Cos.skinKey(W({ skin: sk === 'unkindled' ? 'skin.unkindled' : `skin.${c}.${sk}` })) === sk, `skin suffix of ${c} ${sk}`);
      }
      ok(AC.heroVar(c, 2, `hero.${c}.idle`, 'nope') === 'pal:h2' && AC.heroVar(c, 2, `hero.${c}.idle`, '') === 'pal:h2', `${c}: an unknown or no skin draws the hero's own colours`);
    }
    let hid = 0;
    const hero = (o) => Object.assign({ pid: 'c' + (hid++), name: 'Mira', cls: 'knight', slot: 0, x: 100, y: 100, face: 0 }, o);
    ok(Cos.nameOf(hero({ wear: W({ title: 'title.contrarian' }) })) === 'Mira the Contrarian' && Cos.nameOf(hero({ wear: W({ title: 'title.many' }) })) === 'Mira, One of Many' && Cos.nameOf(hero({})) === 'Mira', 'titles: "Mira the Contrarian", "Mira, One of Many", the bare name without one');
    const kw = ED.CLASSES.knight.weapons, vk = (ED.ARMORY.knight || []).find(e => ED.weaponBase(e.id) === kw[0]), th = hero({ wear: W({ tints: [kw[0]] }) });
    ok(Cos.tintOf(th, kw[0]) && Cos.tintOf(th, kw[0] + '@heavy') === Cos.tintOf(th, kw[0]) && (!vk || Cos.tintOf(th, vk.id) === Cos.tintOf(th, kw[0])) && !Cos.tintOf(th, kw[1]), 'a sheen tints its base weapon, its forks and its Armory variant, nothing else');
    ok(Cos.tintRamp(kw[0]) !== Cos.tintRamp(kw[1]) && Cos.tintRamp(kw[1]) !== Cos.tintRamp(kw[2]), 'the three sheens of a hero differ');
    // pets: follow with a lag, hide while down, snap back after a room change
    Cos.reset();
    const pp = hero({ pid: 'pet0', wear: W({ pet: 'pet.platino' }) }), pv = { players: new Map([['pet0', pp], ['bare', hero({ pid: 'bare' })]]) };
    let pl = Cos.pets(pv, 0, 1 / 60);
    ok(pl.length === 1 && Math.abs(pl[0].x - 82) < 1e-9 && pl[0].y === 104, `a pet appears behind its hero (${pl[0] && pl[0].x}, ${pl[0] && pl[0].y})`);
    pp.x = 160; pl = Cos.pets(pv, 1 / 60, 1 / 60);
    ok(pl[0].x > 82 && pl[0].x < 120, `the pet lags behind a moving hero (${pl[0].x})`);
    pp.downed = true; ok(Cos.pets(pv, 0.1, 1 / 60).length === 0, 'no pet while its hero is down'); pp.downed = false;
    pp.x = 900; pl = Cos.pets(pv, 0.2, 1 / 60); ok(Math.abs(pl[0].x - 882) < 1e-9, 'the pet snaps to its hero after a room change');
    // coin trail: one gold footprint per 24 px walked, at most 10 a second, capped per hero, none across a jump; flat stamps at alpha <= 0.5, never the gold pickup sprite
    const alphas = [], g = { globalAlpha: 1, fillStyle: '', fillRect() { alphas.push(this.globalAlpha); } }, tp = hero({ pid: 'tr0', x: 0, wear: W({ trail: 'trail.coins' }) }), tv = { players: new Map([['tr0', tp]]) };
    let drawn = 0, T0 = 0, atlasUsed = 0;
    const ad = ED.Atlas.draw; ED.Atlas.draw = () => { atlasUsed++; return true; };
    const run = (from, to, sec, low) => { const n = Math.round(sec * 60); let last = 0; for (let i = 1; i <= n; i++) { tp.x = from + (to - from) * i / n; last = Cos.trails(g, tv, T0 + i / 60, low); } T0 += sec; return last; };
    const slow = run(0, 120, 1); // 120 px/s: a coin per 24 px
    ok(slow >= 4 && slow <= 5, `a hero walking 120 px in a second leaves 4 or 5 coins (${slow})`);
    const fast = run(120, 720, 0.5); // 1200 px/s: held by the 0.1 s gap
    ok(fast <= 14 && fast >= 9, `a fast hero is held to 10 coins a second and 14 live coins (${fast})`);
    const lowN = run(720, 1320, 0.5, true); ok(lowN <= 6, `Low quality keeps at most 6 coins (${lowN})`);
    tp.x = 5000; const jumpN = Cos.trails(g, tv, T0 + 0.05, true); T0 += 0.05;
    ok(jumpN <= lowN, `a room change drops no coin across the jump (${lowN} -> ${jumpN})`);
    drawn = Cos.trails(g, tv, T0 + 5, false); ok(drawn === 0, 'coins fade out within their life');
    ok(atlasUsed === 0 && alphas.length > 0 && Math.max(...alphas) <= 0.5, `the trail stamps flat footprints at alpha <= 0.5, no pickup sprite (max ${Math.max(...alphas)}, atlas draws ${atlasUsed})`);
    ED.Atlas.draw = ad;
    // co-op: the start message's sets reach every peer's mirror, made safe
    const m2 = new G.Mirror({ pact: 0, players: [{ pid: 'a', name: 'A', slot: 0, cls: 'ranger', weapon: ED.CLASSES.ranger.weapons[0], meta: META(), wear: { skin: 'skin.ranger.b', hat: 'hat.crown', aura: 'skin.ranger.a' } }, { pid: 'b', name: 'B', slot: 1, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() }] }, 'b');
    ok(m2.players.get('a').wear.skin === 'skin.ranger.b' && m2.players.get('a').wear.hat === 'hat.crown' && m2.players.get('a').wear.aura === null && m2.players.get('b').wear.skin === null, 'a client mirror carries every hero set, cleaned');
    const pk = N.cleanPick({ cls: 'necro', weapon: ED.CLASSES.necro.weapons[0], meta: { up: [], mastery: 3, armory: [] }, wear: { skin: 'skin.necro.a', title: 'title.many', tints: ED.CLASSES.necro.weapons } });
    ok(pk.wear.skin === 'skin.necro.a' && pk.wear.title === 'title.many' && pk.wear.tints.length === 3, 'the hero pick carries its set through cleanPick');
  }
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
    const w = room1(10), fod = ED.biomeFor(1).fodder, mk = (i, x, y, f, set) => { const e = w.spawnEnemy(fod, x, y, {}); e.hp = e.maxHp * f; Object.assign(e, set); return e; };
    const full = mk(0, 100.4, 200.6, 1, {}), low = mk(1, 130, 200, 0.0001, { face: -1 }), half = mk(2, 160, 200, 0.5, { flash: 0.05, frozen: 1 });
    const fx = mk(3, 190, 200, 0.9, { stun: 1, chill: 30, burn: 4 }), plain = w.spawnEnemy('skeleton', 220, 200, {}), dead = mk(0, 250, 200, 1, {});
    dead.hp = 0;
    const s1 = wire(N.encodeSnap(w, [], false)), row = (e) => s1.H.find((r) => r[0] === e.id);
    ok(s1.H.length === 4 && !row(dead) && !s1.H.some((r) => r[0] === plain.id) && s1.E.length === 1, 'H holds the live fodder foes only; a normal foe stays in E');
    ok(full.fodder === true && Math.abs(full.maxHp - ED.World.fodderHp(ED.ENEMIES[fod], 1, 10)) < 1e-9, `a biome fodder spawns as fodder at World.fodderHp (${full.maxHp})`);
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
    ok(Math.abs(vf.maxHp - full.maxHp) < 1e-6 * full.maxHp && Math.abs(v(half).maxHp - half.maxHp) < 1e-6 * half.maxHp, `max HP follows spawnEnemy (World.fodderHp, pact 10): ${vf.maxHp} vs ${full.maxHp}`);
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
    const bm = ED.biomeFor(1), had = bm.fodder; bm.fodder = 'fodtestB';
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
    hit({ fd: 1 }); ok(F.texts.length === 0, 'a non-crit fodder hit prints no number');
    hit({ fd: 1, v: 400 }); hit({ fd: 1, pid: 'p1' }); ok(F.texts.length === 0, 'not even a big one or one of another hero');
    hit({ fd: 1, c: 1 }); ok(F.texts.length === 1 && F.texts[0].crit, 'a crit fodder hit prints its number');
    hit({ fd: 1 }); ok(F.texts.length === 1 && F.texts[0].s === '30', 'a non-crit fodder hit does not add into a crit number');
    F.reset();
    hit({}); ok(F.texts.length === 1 && F.texts[0].s === '30', 'a normal hit prints a number');
    hit({ fd: 1, v: 12 }); ok(F.texts.length === 1 && F.texts[0].s === '42', `a non-crit fodder hit adds into the number of its spot (${F.texts[0].s})`);
    hit({ fd: 1, v: 5, x: 160 }); ok(F.texts.length === 1, 'a non-crit fodder hit elsewhere makes no number');
    F.texts[0].life = F.texts[0].max - 0.2;
    hit({ fd: 1, v: 7 }); ok(F.texts.length === 1 && F.texts[0].s === '42', 'a number older than 150 ms takes no more');
    hit({ c: 1, v: 9 }); ok(F.texts.length === 2, 'a crit makes its own number');
    F.reset();
  }

  // two-affix elites: the E row carries the second affix at index 18, the mirror decodes it, the label reads both names before the foe name
  {
    const w = room1(0), e1 = w.spawnEnemy('skeleton', 100, 100, {}), e2 = w.spawnEnemy('skeleton', 140, 100, {}), e3 = w.spawnEnemy('skeleton', 180, 100, {});
    e1.elite = 'swift'; e1.elite2 = 'brutal'; e2.elite = 'volatile'; e2.elite2 = 'vampiric';
    const s1 = wire(N.encodeSnap(w, [], false)), row = (e) => s1.E.find((r) => r[0] === e.id);
    ok(row(e1).length === 19 && row(e1)[10] === ED.AFFIX_IDS.indexOf('swift') && row(e1)[18] === ED.AFFIX_IDS.indexOf('brutal'), `the E row ends with the second affix index (${row(e1)[18]})`);
    ok(row(e2)[18] === ED.AFFIX_IDS.indexOf('vampiric') && row(e3)[10] === -1 && row(e3)[18] === -1, 'second affix of another elite; -1 for a foe without affixes');
    e3.elite = 'warded'; const s2 = wire(N.encodeSnap(w, [], false));
    ok(s2.E.find((r) => r[0] === e3.id)[18] === -1, 'an elite with one affix sends -1');
    const m = mirrorOf(w); s1.T = 5; m.apply(s1, 0); m.renderT = 5; m.update(0, 0.1);
    const v = (e) => m.enemies.find((q) => q.id === e.id);
    ok(v(e1).elite === 'swift' && v(e1).elite2 === 'brutal' && v(e2).elite === 'volatile' && v(e2).elite2 === 'vampiric' && v(e3).elite === null && v(e3).elite2 === null, 'the mirror decodes elite and elite2');
    const nm = (id) => ED.AFFIXES[id].name, fn = ED.ENEMIES.skeleton.name;
    ok(R.eliteLabel(v(e1)) === `${nm('swift')} ${nm('brutal')} ${fn}` && R.eliteLabel(v(e1), true) === `${nm('swift')} ${nm('brutal')}`, `a two-affix elite reads both names before the foe name (${R.eliteLabel(v(e1))})`);
    ok(R.eliteLabel({ elite: 'warded', elite2: null, def: ED.ENEMIES.skeleton }) === `${nm('warded')} ${fn}` && R.eliteLabel({ elite: 'warded', def: ED.ENEMIES.skeleton }, true) === nm('warded'), 'a one-affix elite keeps "Affix Foe"');
  }

  // breakable props: BR rides the full snapshots only, the mirror applies it, a smash event marks the bit in its room, smash events are capped, a smashed breakable leaves the draw list
  {
    const w = room1(0), rm = w.floor.rooms.find((r) => r.type === 'combat');
    w.enterRoom(rm.id, null); w.enemies.length = 0; w.enc = null; w.zones.length = 0;
    ok(rm.breakables.length >= 4, `the combat room holds ${rm.breakables.length} breakables (both sides build them from the floor seed)`);
    w.smashBreakable(1, null); w.smashBreakable(3, null);
    const full = wire(N.encodeSnap(w, w.fx, true)), part = wire(N.encodeSnap(w, [], false));
    ok(Array.isArray(full.BR) && full.BR.length === w.floor.rooms.length && full.BR[rm.id] === 10 && full.BR.filter((b) => b).length === 1, `a full snapshot carries BR, one mask per room (${full.BR})`);
    ok(!('BR' in part), 'a partial snapshot does not');
    ok(full.F.filter((e) => e.t === 'smash').map((e) => e.i).join() === '1,3', 'the smash events ride the snapshot');
    const m = mirrorOf(w); full.T = 5; m.apply(full, 0);
    ok(m.roomId === rm.id && m.roomState[rm.id].broken === 10 && m.roomState[0].broken === 0, `the mirror applies BR (room ${rm.id}: ${m.roomState[rm.id].broken})`);
    const sig = N.propSig(w); w.roomState[rm.id].broken = 0; const sig0 = N.propSig(w); w.roomState[rm.id].broken = 10;
    ok(sig !== sig0, 'a smash changes the prop signature, so the next snapshot is a full one');
    const fxCtx = { localPid: 'p0', player: () => ({ x: 0, y: 0, pid: 'p0', cls: 'knight' }), players: () => [], stratum: () => 1 };
    G.s = { mode: 'client', mirror: m, fxCtx };
    G.localEvent({ t: 'smash', i: 5, x: 100, y: 100, k: 'urn', r: rm.id });
    ok(m.roomState[rm.id].broken === (10 | 32), 'a smash event sets its bit in its room');
    G.localEvent({ t: 'smash', i: 6, x: 100, y: 100, k: 'urn', r: 9999 });
    ok(m.roomState[rm.id].broken === (10 | 32), 'an event of an unknown room is ignored');
    G.s = null;
    const many = Array.from({ length: 20 }, (_, i) => ({ t: 'smash', i: i & 7, x: 0, y: 0, k: 'urn', r: 0 }));
    ok(N.capFx(many, N.CAPS).length === 8 && N.capFx(many, N.CAPS_LOCAL).length === 4, 'smash events are capped at 8 per snapshot and 4 per local frame');
    F.reset(); F.handle({ t: 'smash', x: 100, y: 100, k: 'crystal', r: 0 }, fxCtx); ok(F.parts.length > 0, `a smash throws shards (${F.parts.length} particles)`); F.reset();
    ED.Tiles.statics = () => [{ k: 'col', key: 5 }, { k: 'brk', bi: 0, key: 6 }, { k: 'brk', bi: 1, key: 7 }, { k: 'brk', bi: 2, key: 8 }];
    const live = (broken) => R.liveStatics({ roomState: { [rm.id]: { broken } }, roomId: rm.id }, rm).map((s) => (s.bi === undefined ? 'c' : s.bi)).join();
    ok(live(0) === 'c,0,1,2' && live(2) === 'c,0,2' && live(5) === 'c,1' && live(7) === 'c', 'the draw list drops the broken breakables and keeps the other statics');
    ok(R.liveStatics({ roomState: {}, roomId: 3 }, rm).length === 4, 'a view without room state draws everything');
  }

  // playstyle visuals: zone kinds, element and Bell events, foe markers, Capacitor and Metronome cues; every one survives missing or malformed fields
  {
    const ops = { n: 0 };
    const rc = () => new Proxy({ globalAlpha: 1 }, { get: (t, k) => (k in t ? t[k] : k === 'canvas' ? { width: 64, height: 64 } : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => { ops.n++; }), set: (t, k, v) => { t[k] = v; return true; } });
    const doc0 = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => rc() }) };
    const throws = (f) => { try { f(); return false; } catch (err) { console.log('  ' + err.stack.split('\n').slice(0, 3).join(' | ')); return true; } };
    try {
      const KINDS = ['cinder', 'firebreak', 'pillar', 'anchor', 'vigil'], src = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'render.js'), 'utf8');
      const dz = src.slice(src.indexOf('function drawZones('), src.indexOf('default: {', src.indexOf('function drawZones(')));
      for (const kd of KINDS) ok(N.ZK.includes(kd) && dz.includes(`case '${kd}'`), `zone kind ${kd} is on the wire and has its own draw case`);
      const zrow = (kind, o) => Object.assign({ id: 3, kind, x: 200, y: 200, r: 40, t: 0.5, dur: 4, a: 0.3, len: 0, w: 0, arc: 0, team: 0, elite: false, lob: null, warm: 0, str: 0, fol: 0 }, o);
      const shapes = [{}, { len: 120, w: 16 }, { arc: 2, r: 50, w: 14 }, { t: 3.9 }, { t: 0.02 }, { r: 0 }, { t: undefined, dur: 0 }, { len: NaN, a: undefined, id: undefined }, { r: -5, dur: undefined }];
      const ctx = rc(), view = { zones: [], players: new Map(), enemies: [] };
      for (const kd of KINDS) for (const sh of shapes) {
        const z = zrow(kd, sh); view.zones.length = 0; view.zones.push(z);
        ok(!throws(() => { for (const pass of [0, 2, 1]) R.zoneArt.draw(ctx, view, 1.7, pass); for (let i = 0; i < 4; i++) R.zoneArt.stand(ctx, z, i, 1.7); }), `zone ${kd} ${JSON.stringify(sh)} draws all passes and its standing pieces`);
      }
      for (const kd of KINDS) { ops.n = 0; view.zones.length = 0; view.zones.push(zrow(kd, kd === 'cinder' ? { len: 120, w: 16 } : {})); R.zoneArt.draw(ctx, view, 1, 0); R.zoneArt.draw(ctx, view, 1, 1); ok(ops.n > 0, `zone ${kd} draws (${ops.n} canvas ops)`); }
      ok(R.zoneArt.len(zrow('cinder', { len: 90 })) === 90 && R.zoneArt.len(zrow('cinder', { arc: 2, r: 50 })) === 100 && R.zoneArt.len(zrow('cinder', { r: 30 })) === 60, 'zone shape: a line by len, an arc by arc x r, else a disc by 2r');
      ok(!throws(() => { R.zoneArt.pillar(5, false); R.zoneArt.pillar(16, true); R.zoneArt.anchor(); }), 'the pillar (both looks) and anchor sprites bake');
      // events
      const fctx = { localPid: 'p0', player: () => ({ x: 0, y: 0, pid: 'p0', cls: 'bell' }), players: () => [], stratum: () => 1 };
      const plays = [], A0 = ED.Audio;
      ED.Audio = { play: (name, v, arg, pr) => plays.push({ name, v, arg, pr }), flush() {}, hit() {}, impact() {}, kill() {} };
      const good = {
        detonate: { pid: 'p0', x: 100, y: 100 }, tether: { pid: 'p0', pts: [100, 100, 160, 110, 220, 90] }, rebuke: { pid: 'p0', x: 100, y: 100, r: 90 },
        reapchain: { x: 100, y: 100, x2: 180, y2: 140 }, shatter: { x: 100, y: 100, r: 70 }, hurl: { pid: 'p0', x: 100, y: 100, k: 2.5 }, reel: { pid: 'p0', x0: 100, y0: 100, x1: 200, y1: 120 },
      };
      const live = () => F.parts.length + F.rings.length + F.bolts.length + F.pops.length + F.sheets.length + F.beams.length;
      for (const t of Object.keys(good)) {
        ok(N.CAPS[t] > 0 && N.CAPS_LOCAL[t] > 0 && N.CAPS_LOCAL[t] <= N.CAPS[t], `${t} is capped per snapshot (${N.CAPS[t]}) and per local frame (${N.CAPS_LOCAL[t]})`);
        F.reset(); F.handle(Object.assign({ t }, good[t]), fctx); ok(live() > 0, `${t} makes effects (${live()})`);
        F.reset(); F.handle({ t }, fctx); ok(live() === 0, `${t} without fields draws nothing (${live()})`);
        const bad = [{ x: 'a', y: null }, { x: NaN, y: 5, r: 'x', k: Infinity }, { pts: 'x' }, { pts: [1, 2, 3] }, { pts: [1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] }, { x0: 1, y0: 2 }, { x: 5, y: 5, r: -10, k: -3 }];
        ok(!throws(() => { for (const b of bad) F.handle(Object.assign({ t }, b), fctx); F.update(0.016); }), `${t} survives missing and malformed fields`);
      }
      F.reset(); F.handle({ t: 'tether', pid: 'p0', pts: Array.from({ length: 40 }, (_, i) => i * 10) }, fctx); ok(F.bolts.length === 6, `a tether draws at most 6 links (${F.bolts.length})`);
      F.reset(); plays.length = 0;
      for (let i = 0; i < 5; i++) F.handle({ t: 'detonate', pid: 'p0', x: 100 + i * 20, y: 100 }, fctx);
      ok(!plays.some((q) => q.name === 'detonate'), 'detonations wait for the frame end');
      F.update(0.016); const dp = plays.filter((q) => q.name === 'detonate');
      ok(dp.length === 1 && dp[0].arg === 5 && dp[0].v === 1, `one shared cue for the frame's 5 detonations (${JSON.stringify(dp)})`);
      plays.length = 0; F.update(0.016); ok(!plays.some((q) => q.name === 'detonate'), 'and none on the next frame');
      F.handle({ t: 'detonate', pid: 'p9', x: 1, y: 1 }, fctx); F.update(0.016); const op = plays.find((q) => q.name === 'detonate');
      ok(op && op.v < 1 && op.pr === 0, 'another hero\'s detonation plays quieter at the lowest priority');
      F.reset(); plays.length = 0; const sh0 = F.shake; F.handle({ t: 'hurl', pid: 'p0', x: 0, y: 0, k: 2.5 }, fctx); const big = F.shake; F.reset(); F.handle({ t: 'hurl', pid: 'p0', x: 0, y: 0, k: 0.4 }, fctx); const small = F.shake; F.reset(); F.handle({ t: 'hurl', pid: 'p9', x: 0, y: 0, k: 2.5 }, fctx);
      ok(sh0 === 0 && big > small && small > 0 && F.shake === 0, `a hurl shakes its owner by k (k 2.5: ${big}, k 0.4: ${small}), another hero's not at all (${F.shake})`);
      ok(plays.filter((q) => q.name === 'bhurl').map((q) => q.arg).join() === '2.5,0.4,2.5', 'each hurl plays the bronze clang with its k');
      F.reset(); ED.Audio = A0;
      // foe markers and the Capacitor cue: host-side fields (quarryT, doses) and the mirror's decoded ones (dosed) both draw
      const lp = { pid: 'p0', x: 0, y: 0, boons: {} }, fv = { players: new Map([['p0', lp]]), zones: [], enemies: [] };
      R.local = 'p0'; R.foeArt.view(fv);
      const mk = (o) => Object.assign({ id: 7, type: 'skeleton', def: ED.ENEMIES.skeleton, x: 100, y: 100, r: 10, hp: 50, maxHp: 60, elite: null, boss: false, ward: 0, st: 'move', t: 0, face: 1 }, o);
      const P0 = { draw: ED.Pix.draw, put: ED.Pix.put }; // the Pix stand-in counts its blits too
      const marksOps = (e) => { ops.n = 0; ED.Pix.draw = () => { ops.n++; return true; }; ED.Pix.put = () => { ops.n++; }; try { R.foeArt.marks(ctx, e, 1); R.foeArt.status(ctx, e, 1, true); } finally { ED.Pix.draw = P0.draw; ED.Pix.put = P0.put; } return ops.n; };
      const base = marksOps(mk({}));
      for (const o of [{ quarryT: 2 }, { doses: [{ t: 1 }] }, { dosed: true }, { hunted: true }, { quarryT: 1, doses: [1], hunted: true, charge: 1, stun: 1, elite: 'swift', affixOff: true }])
        ok(!throws(() => marksOps(mk(o))) && marksOps(mk(o)) > base, `foe marker ${JSON.stringify(o)} draws (${marksOps(mk(o))} ops over ${base})`);
      ok(!throws(() => marksOps(mk({ doses: 'x', quarryT: NaN, hunted: 0 }))), 'malformed marker fields do not throw');
      const chg = mk({ charge: 1 }), plain = marksOps(chg);
      ok(!R.capOn(), 'no Capacitor: plain charge marks');
      lp.boons = { capacitor: 1 }; R.foeArt.view(fv);
      ok(R.capOn() && marksOps(chg) > plain, `with Capacitor a charged foe gets the stronger stored-charge marks (${marksOps(chg)} ops over ${plain})`);
      R.foeArt.view(null); ok(!R.capOn(), 'no view: no Capacitor cue');
    } finally {
      if (doc0 === undefined) delete globalThis.document; else globalThis.document = doc0;
    }
  }

  // boss fury on the wire, in the mirror, in the fx and on the boss bar
  {
    const FB = ED.World.BOSS_FURY, tIV = FB.t[3];
    const bossAt = (s, furyT) => { const w = room1(0); if (s > 1) w.enterStratum(s); w.enemies.length = 0; w.enc = null; w.locked = false; const b = w.spawnEnemy(ED.biomeFor(s).boss, 300, 300, {}); b.furyT = furyT; return { w, b }; };
    const rowOf = (w, b) => wire(N.encodeSnap(w, [], false)).E.find((r) => r[0] === b.id);
    const FC = Math.round((ED.World.BOSS_FURY.t[3] + 5.34) * 10) / 10, iv = bossAt(4, ED.World.BOSS_FURY.t[3] + 5.34), ii = bossAt(2, 0), iv0 = bossAt(4, 0);
    const sk = iv.w.spawnEnemy('skeleton', 330, 300, {});
    ok(rowOf(iv.w, iv.b).length === 20 && rowOf(iv.w, iv.b)[19] === FC, `a stratum IV boss row carries its clock in tenths as E[19] (${rowOf(iv.w, iv.b)[19]})`);
    ok(rowOf(ii.w, ii.b).length === 19 && rowOf(iv0.w, iv0.b).length === 19 && rowOf(iv.w, sk).length === 19, 'a stratum II boss, a fresh IV boss and a normal foe have no clock field');
    const m = mirrorOf(iv.w), snap = wire(N.encodeSnap(iv.w, [], false)); snap.T = 5; m.apply(snap, 0); m.renderT = 5; m.update(0, 0.1);
    const vb = m.enemies.find((e) => e.boss), vs = m.enemies.find((e) => e.id === sk.id);
    ok(m.stratum === 4 && vb && vb.furyT === FC && Math.abs(vb.furyM - ED.World.furyMul(4, FC)) < 1e-12 && vb.furyM > 1, `the mirror restores the clock (${vb && vb.furyT}) and derives x${vb && vb.furyM}`);
    ok(vs && vs.furyT === 0 && vs.furyM === 1, 'a normal foe in the mirror has clock 0, x1');
    const m2 = mirrorOf(ii.w), s2 = wire(N.encodeSnap(ii.w, [], false)); s2.T = 5; m2.apply(s2, 0); m2.renderT = 5; m2.update(0, 0.1);
    ok(m2.enemies.find((e) => e.boss).furyM === 1, 'a stratum II boss in the mirror is x1');
    // fury event: shake, burst, message with the boss name
    const fxCtx = { localPid: 'p0', player: () => ({ x: 0, y: 0, pid: 'p0', cls: 'knight', name: 'T' }), players: () => [], stratum: () => 4 };
    F.reset(); F.handle({ t: 'fury', type: 'forgelord', x: 200, y: 200 }, fxCtx);
    ok(F.parts.length > 0 && F.rings.length > 0 && F.shake > 0 && F.msgs.some((q) => q.text === 'The Forgelord is enraged!'), `the fury event bursts, rings, shakes and posts the message (${F.parts.length} particles, ${F.rings.length} rings, shake ${F.shake})`);
    F.reset();

    // boss bar through the real hud.js over a recording canvas
    const rec = { fills: [], imgs: [] };
    const cvs = () => {
      const cv = { width: 1, height: 1, style: {}, texts: [], setAttribute() {}, getContext: () => cx };
      const cx = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : k === 'canvas' ? cv : k === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : k === 'fillText' ? (s) => { cv.texts.push(String(s)); }
          : k === 'fillRect' ? (x, y, w2, h2) => { rec.fills.push({ style: t.fillStyle, x, y, w: w2, h: h2 }); } : k === 'drawImage' ? (im, x, y, w2, h2) => { rec.imgs.push({ im, x, y, w: w2, h: h2, a: t.globalAlpha }); }
          : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}),
        set: (t, k, v) => { t[k] = v; return true; },
      });
      return cv;
    };
    const doc0 = globalThis.document, win0 = globalThis.window, hud0 = ED.HUD, sp0 = ED.Sprites;
    globalThis.document = { createElement: cvs, getElementById: () => ({ parentNode: { insertBefore() {} } }), body: { classList: { add() {}, remove() {} } } };
    globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
    try {
      load('client/hud.js');
      const H = ED.HUD, viewOf = (s, boss) => ({ stratum: s, pact: 0, enemies: [boss], players: new Map(), pickups: [] });
      // Metronome beat (P[25]) and the Capacitor chip
      const bt = H.cues.beat;
      ok(bt({ stats: { twMetro: 0 }, metroN: 2 }) === 0 && bt({ metroN: 2 }) === 0, 'no Metronome Twist: no beat cue');
      ok(bt({ stats: { twMetro: 1 } }) === 1 && bt({ stats: { twMetro: 1 }, metroN: 3 }) === 4 && bt({ stats: { twMetro: 1 }, metroN: 9 }) === 4 && bt({ stats: { twMetro: 1 }, metroN: 'x' }) === 1, 'the beat is 1 + attacks since the x3 beat, clamped to 0-3');
      const cv0 = { stratum: 1, enemies: [{ charge: 1, hp: 5 }, { charge: 1, hp: 5 }, { charge: 0, hp: 5 }, { charge: 1, hp: 0 }], players: new Map() };
      const chips = (me) => H.cues.chips(cv0, me).filter((x, i) => !(i & 1));
      ok(chips({ stats: {}, boons: { capacitor: 1 } }).includes('Charged 2') && !chips({ stats: {}, boons: {} }).some((x) => /^Charged/.test(x)), 'Capacitor: a chip counts the live charged foes a cast will detonate');
      const mk = (type, furyT, extra) => Object.assign({ id: 9, type, def: ED.ENEMIES[type], boss: true, hp: 800, maxHp: 1000, exposed: false, furyT, furyM: ED.World.furyMul(ED.ENEMIES[type].stratum || 4, furyT) }, extra);
      H.draw(null, viewOf(4, mk('forgelord', 0)), null, {}, 0, 0.016, {}); // sets up the canvas and layout
      const bar = (s, type, furyT, extra) => {
        rec.fills.length = 0; rec.imgs.length = 0;
        const b = mk(type, furyT, Object.assign({ furyM: ED.World.furyMul(s, furyT) }, extra));
        H.bossBar(viewOf(s, b), 1);
        const labels = rec.imgs.filter((i) => i.im && i.im.texts && i.im.texts.length).map((i) => ({ text: i.im.texts[0], x: i.x, w: i.im.width }));
        return { track: rec.fills.filter((f) => f.style === '#26120b').length, labels, fills: rec.fills.map((f) => f.style) };
      };
      const II = bar(2, 'sporemother', 30), IV = bar(4, 'forgelord', 10), IVw = bar(4, 'forgelord', tIV - 5), IVf = bar(4, 'forgelord', tIV + 10);
      ok(II.track === 0 && IV.track === 1, `the bar draws the fury track for a IV boss (${IV.track}) and not for a II boss (${II.track})`);
      ok(!IV.labels.some((l) => /Fury/.test(l.text)) && !IVw.labels.some((l) => /Fury/.test(l.text)), 'no fury label before the start');
      ok(IV.fills.includes('#b88a4a') && IVw.fills.some((f) => /^rgba\(255, ?181, ?107/.test(f)) && IVf.fills.some((f) => /^rgba\(255, ?90, ?26/.test(f)), 'the track fill is amber, pulses light from the warning on, burns ember past the start');
      const lab = IVf.labels.find((l) => /^Fury/.test(l.text));
      ok(lab && lab.text === 'Fury ×' + (1 + 10 * ED.World.BOSS_FURY.ramp).toFixed(1), `the fury label reads the multiplier ten seconds in (${lab && lab.text})`);
      ok(!II.labels.some((l) => /Fury/.test(l.text)), 'no label on a II boss');
      const both = bar(4, 'forgelord', tIV + 10, { exposed: true }), ex = both.labels.find((l) => l.text === 'Exposed'), fu = both.labels.find((l) => /^Fury/.test(l.text));
      ok(ex && fu && ex.x + ex.w <= fu.x, `Exposed and Fury sit side by side without overlap (Exposed ${ex && ex.x}+${ex && ex.w}, Fury ${fu && fu.x})`);
      const onlyEx = bar(2, 'sporemother', 5, { exposed: true });
      ok(onlyEx.labels.some((l) => l.text === 'Exposed') && !onlyEx.labels.some((l) => /Fury/.test(l.text)), 'a II boss keeps its Exposed label alone');
      // boss aura: nothing at x1, one glow sprite past it, wider and stronger as the multiplier climbs
      load('client/sprites.js');
      const aura = (furyM) => { const g = cvs().getContext('2d'); g.globalAlpha = 1; rec.imgs.length = 0; ED.Sprites.furyGlow(g, { r: 30, furyM }, 0); return rec.imgs.map((i) => ({ w: i.w, a: i.a })); };
      const a1 = aura(1), a2 = aura(1.4), a3 = aura(FB.max);
      ok(a1.length === 0 && a2.length === 1 && a3.length === 1 && a3[0].w > a2[0].w && a3[0].a > a2[0].a, `the boss aura is absent at x1 and grows with the multiplier (${JSON.stringify(a2)} -> ${JSON.stringify(a3)})`);
    } finally {
      globalThis.document = doc0; globalThis.window = win0; ED.HUD = hud0; ED.Sprites = sp0;
      if (doc0 === undefined) delete globalThis.document; if (win0 === undefined) delete globalThis.window;
    }
  }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
