// Usage: node tools/check-elements.js
// Headless checks of the path engines against docs/GAME-DESIGN.md sections 2-3 in staged worlds: the path data (one gate, keystone and evolution per path, every {stat} token in its mods),
// one staged test per verb (Burn stacks, Wildfire, Smother, the Flame death burst, Fan the Flames, Scorched Earth, Ember Heart, the flame cone; freeze, Shatter by any hero's hit, the Brittle boss,
// Shatterpoint, Cold Cycle, Absolute Zero, Glacier, the ice lance; Charge and the threshold discharge, its jumps, Conductor, Overload, High Voltage, Arc Flash, Capacitor, the storm call;
// the finisher and Masterwork Arms' rend; the cross-path cards), no path verb on the dash, the build-up rule (statuses build from damage dealt, never hit count) and the cost of burning ground at 200 foes.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const C = ED.CONST, U = ED.U, St = ED.Stats;

// A hero of cls (plus allies of o.allies classes) in a quiet start room: no crit or dodge, every affinity x1. s.log holds every hit { e, d, src }, s.evs the events.
function stage(cls, boons, o) {
  o = o || {};
  const classes = [cls].concat(o.allies || []);
  const w = new ED.World({ seed: o.seed || 7, pact: 0, players: classes.map((c, i) => ({ pid: 'p' + i, name: 'T' + i, slot: i, cls: c, weapon: ED.CLASSES[c].weapons[o.wi || 0], meta: META() })) });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  for (const q of w.players.values()) { w.recalc(q, true); q.offers.length = 0; q.picks = 0; q.offer = null; q.stats.crit = 0; q.stats.dodge = 0; }
  w.enemies.length = 0; w.enc = null; w.locked = false; w.msgs.length = 0; w.fx.length = 0; w.zones.length = 0; w.projs.length = 0;
  w.state = 'play';
  const log = [], evs = [], hit0 = w.hitEnemy;
  w.hitEnemy = function (e, base, src) { const d = hit0.call(this, e, base, src); log.push({ e, d, src: src || {} }); return d; };
  return { w, p, log, evs };
}
// A still foe (5000 HP unless hp given) that never attacks.
const foe = (w, x, y, o) => { o = o || {}; const e = w.spawnEnemy(o.type || 'skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.spawnT = 0; if (!o.keepHp) e.maxHp = e.hp = o.hp || 5000; e.def = Object.assign({}, e.def, { guard: undefined }); return e; };
const run = (s, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { s.w.update(1 / 60); for (const ev of s.w.fx) s.evs.push(ev); s.w.fx.length = 0; if (f) f(i); } };
const chains = (w) => { for (let i = 0; i < 200 && w.chainQ.length; i++) { w.time += 1 / 60; w.updateChains(); } };
const dealt = (s, e, f) => s.log.filter(h => h.e === e && (!f || f(h))).reduce((a, h) => a + h.d, 0);
const evOf = (s, t) => s.evs.concat(s.w.fx).filter(v => v.t === t);
const zonesOf = (w, kind) => w.zones.filter(z => z.kind === kind && !z.dead);
const burnV = (p) => C.BURN_K * p.stats.power * Math.max(0.1, p.stats.dmg); // a stack's damage per second before burnMul
const hurt = (s, e, amt) => { const p = s.p; p.invuln = 0; p.hp = p.maxHp = 1e6; s.w.hurtPlayer(p, amt, { e }); return 1e6 - p.hp; }; // health a foe's hit of amt takes from p0
const dash = (s, dx, dy) => { s.p.dashT = C.DASH.t; s.p.dashing = true; s.w.playerDash(s.p, dx, dy); }; // a dash starts (the world keeps p.dashing while dashT runs)
const owned = (w, p, id) => { p.boons[id] = (p.boons[id] || 0) + 1; w.recalc(p, true); p.stats.crit = 0; }; // grant a card mid-test

// ---------------- data ----------------
{
  ok(ED.PATH_IDS.join() === 'general,fire,ice,lightning' && ED.PATHS.general.name === 'Steel' && ED.PATHS.fire.name === 'Flame' && ED.PATHS.ice.name === 'Frost' && ED.PATHS.lightning.name === 'Storm', 'four paths: Steel, Flame, Frost, Storm');
  ok(ED.ELEMENT_IDS.join() === 'fire,ice,lightning,holy,shadow' && !ED.STATUS.venom, 'elements: the three path elements plus Holy and Shadow (class-only); no Venom');
  for (const el of ED.PATH_IDS) {
    const ids = ED.BOON_IDS.filter(id => ED.BOONS[id].path === el && !ED.BOONS[id].cls);
    const g = ids.filter(id => ED.BOONS[id].gate), k = ids.filter(id => ED.BOONS[id].key), v = ids.filter(id => ED.BOONS[id].evo), pool = ids.length - g.length - k.length - v.length;
    ok(g.length === 1 && k.length === 1 && v.length === 1 && pool >= 7 && pool <= 9, `${el}: one gate, one keystone, one evolution, ${pool} path boons`);
  }
  const st0 = St.compute({ cls: 'ranger', weapon: 'longbow', boons: {}, relics: [], meta: META(), pact: 0 }), bad = [], miss = [];
  for (const id of ED.BOON_IDS) {
    const b = ED.BOONS[id]; if (b.cls) continue;
    for (const m of (b.desc || '').matchAll(/\{(\w+)\}/g)) if (m[1] !== 'pw' && !(m[1] in (b.mods || {})) && !['burn'].includes(m[1]) && !(b.purse && m[1] === 'gold')) bad.push(id + ':' + m[1]);
    for (const key in (b.mods || {})) if (typeof st0[key] !== 'number') miss.push(id + ':' + key);
    if (/[{}]/.test(ED.Sheet.text(id, 1, st0))) bad.push(id + ' text');
  }
  ok(!bad.length, `every {stat} token of a boon is in its mods and resolves (${bad.join()})`);
  ok(!miss.length, `every boon stat is in the stat block (${miss.join()})`);
  const hold = (boons) => St.compute({ cls: 'ranger', weapon: 'longbow', boons, relics: [], meta: META(), pact: 0 }).hold;
  ok(hold({ evo_fire: 1 }) === 'cone' && hold({ evo_ice: 1 }) === 'lance' && hold({ evo_lightning: 1 }) === 'storm' && hold({ masterstroke: 1 }) === 'finisher', 'the hold verbs: flame cone, ice lance, storm call, finisher');
}

// ---------------- the build-up rule: statuses build from damage dealt, never hit count ----------------
{
  const s = stage('knight', { kindle: 1, frostbite: 1, staticcharge: 1 }), { w, p } = s, a = foe(w, 300, 300, { hp: 1e6 }), b = foe(w, 300, 400, { hp: 1e6 });
  for (let i = 0; i < 10; i++) w.hitEnemy(a, 10, { p, kind: 'weapon', crit: false, noGuard: true });
  w.hitEnemy(b, 100, { p, kind: 'weapon', crit: false, noGuard: true });
  const S = burnV(p) * C.BURN_LIFE, burnOf = (e) => e.burnN * S + e.bacc;
  near(burnOf(a) / burnOf(b), 1, 1e-6, 'ten hits of 10 build the Burn of one hit of 100');
  near(a.chill / b.chill, 1, 1e-6, 'and the same chill'); near(a.charge / b.charge, 1, 1e-6, 'and the same charge');
}

// ---------------- no path verb rides the dash ----------------
{
  const s = stage('ranger', { kindle: 1, frostbite: 1, staticcharge: 1 }), { w, p } = s, e = foe(w, p.x + 20, p.y);
  e.charge = 400; e.chargeOwner = p; e.chargeT = 3;
  dash(s, 1, 0); run(s, 0.4);
  ok(!zonesOf(w, 'pfire').length && !zonesOf(w, 'icewall').length && !zonesOf(w, 'plague').length && dealt(s, e) === 0 && e.charge === 400, 'a dash lays no ground, raises no wall, discharges and strikes nothing');
  ok(St.compute({ cls: 'shade', weapon: ED.CLASSES.shade.weapons[0], boons: { lightstep: 1 }, relics: [], meta: META(), pact: 0 }).dashCharges === 2, 'Light Step: 2 dash charges, the cap');
}

// ---------------- Flame ----------------
{ // Burn stacks: build-up S per stack, the cap, Kindling, the tick, the life, one Burn value per hero
  const s = stage('ranger', { kindle: 1 }), { w, p } = s, e = foe(w, 300, 300), S = burnV(p) * C.BURN_LIFE;
  w.addBurn(e, S * 2.5, p); ok(e.burnN === 2 && Math.abs(e.bacc - S * 0.5) < 1e-6, `2.5 stacks of build-up: 2 stacks and half a stack toward the next (${e.burnN}, ${(e.bacc / S).toFixed(2)})`);
  w.addBurn(e, S * 50, p); ok(e.burnN === C.BURN_CAP, `a foe holds ${C.BURN_CAP} stacks (${e.burnN})`);
  const k = stage('ranger', { kindle: 1, kindling: 1 }); const ek = foe(k.w, 300, 300); k.w.addBurn(ek, 99 * burnV(k.p) * C.BURN_LIFE, k.p); ok(ek.burnN === C.BURN_CAP + 3, `Kindling: +3 (${ek.burnN})`);
  const t = stage('ranger', { kindle: 1, stoke: 1 }), et = foe(t.w, 300, 300), bm = 1 + t.p.stats.burnMul; for (let i = 0; i < 3; i++) t.w.burnStack(et, t.p, 0); run(t, 0.52);
  const dot = t.log.filter(h => h.e === et && h.src.kind === 'dot'); ok(dot.length === 1, 'the stacks of one hero tick as one hit'); near(dot[0].d, 3 * burnV(t.p) * 0.5 * bm, 1e-6, 'a tick: n stacks x the Burn value x 0.5 s, Stoke');
  run(t, C.BURN_LIFE); near(dealt(t, et, h => h.src.kind === 'dot'), 3 * burnV(t.p) * bm * C.BURN_LIFE, 1e-6, 'a stack deals its Burn value for its whole life');
  ok(!et.burnN && !et.burn, 'stacks end after their life');
  const two = stage('ranger', { kindle: 1 }, { allies: ['knight'] }), q = two.w.players.get('p1'); q.boons.kindle = 1; q.boons.stoke = 2; two.w.recalc(q, true);
  const e2 = foe(two.w, 300, 300); two.w.burnStack(e2, two.p, 0); two.w.burnStack(e2, q, 0); two.w.burnStack(e2, q, 0); run(two, 0.52);
  const by = (o) => two.log.filter(h => h.e === e2 && h.src.kind === 'dot' && h.src.p === o).map(h => h.d);
  ok(by(two.p).length === 1 && by(q).length === 1, 'two heroes: each one\'s stacks tick as its own hit');
  near(by(q)[0], 2 * burnV(q) * 0.5 * (1 + q.stats.burnMul), 1e-6, 'each at its own Burn value'); near(by(two.p)[0], burnV(two.p) * 0.5, 1e-6, 'the other hero\'s too');
  ok(e2.burnN === 3 && e2.burnPool > 0, 'the foe shows one stack count for all heroes');
}
{ // Kindle: a hero's stacks on an elite, boss or champion (part) deal x BURN_BIG, ticks and takeBurn payouts; stacks of a hero without Kindle do not
  const tick = (cls, boons, mk) => { const s = stage(cls, boons), e = mk(s.w); for (let i = 0; i < 3; i++) s.w.burnStack(e, s.p, 0); run(s, 0.52); return dealt(s, e, h => h.src.kind === 'dot'); };
  const plain = (w) => foe(w, 300, 300), elite = (w) => { const e = foe(w, 300, 300); e.elite = 'swift'; return e; }, boss = (w) => { const e = foe(w, 300, 300); e.boss = true; return e; };
  const champ = (w) => foe(w, 300, 300, { type: 'twinlance' }), part = (w) => foe(w, 300, 300, { type: 'colsaw' });
  const t0 = tick('ranger', { kindle: 1 }, plain);
  ok(C.BURN_BIG === 2 && t0 > 0, 'BURN_BIG 2');
  near(tick('ranger', { kindle: 1 }, elite), t0 * C.BURN_BIG, 1e-6, 'Kindle: Burn on an elite x BURN_BIG');
  near(tick('ranger', { kindle: 1 }, boss), t0 * C.BURN_BIG, 1e-6, 'on a boss');
  near(tick('ranger', { kindle: 1 }, champ), t0 * C.BURN_BIG, 1e-6, 'on a champion');
  near(tick('ranger', { kindle: 1 }, part), t0 * C.BURN_BIG, 1e-6, 'on a Colossus part');
  const p0 = tick('pyro', {}, plain); ok(p0 > 0, 'a Pyromancer without Kindle burns');
  near(tick('pyro', {}, elite), p0, 1e-6, 'without Kindle: no factor on an elite');
  const pay = (mk) => { const s = stage('ranger', { kindle: 1 }), e = mk(s.w); for (let i = 0; i < 4; i++) s.w.burnStack(e, s.p, 0); return s.w.takeBurn(e, 1); };
  near(pay(boss), pay(plain) * C.BURN_BIG, 1e-6, 'takeBurn pays a boss\'s held Burn x BURN_BIG');
}
{ // the death burst: a burning foe that dies bursts on the foes within 40 + 4 per stack: PYRE_K of the Burn it held, and half its stacks; fodder never bursts
  const s = stage('ranger', { kindle: 1 }), { w, p } = s, e = foe(w, 300, 300), nb = foe(w, 345, 300), far = foe(w, 420, 300);
  for (let i = 0; i < 4; i++) w.burnStack(e, p, 0);
  const held = e.burnPool;
  w.hitEnemy(e, 1e6, { p, kind: 'weapon', crit: false, noProc: true }); chains(w);
  near(dealt(s, nb, h => h.src.kind === 'explode'), held * C.PYRE_K * (1 + p.stats.burnMul), 1e-6, 'the burst: PYRE_K of the Burn the dead foe held');
  ok(nb.burnN === 2 && !far.burnN && dealt(s, far) === 0, `half its stacks pass to a foe within ${C.PYRE_R + 4 * C.PYRE_RS}, none beyond (${nb.burnN}, ${far.burnN})`);
  ok(evOf(s, 'boom').some(v => v.k === 'fire'), 'a fire burst shows');
  const f = stage('ranger', { kindle: 1 }), fd = foe(f.w, 300, 300, { type: 'bonemite' }), fn = foe(f.w, 330, 300);
  for (let i = 0; i < 4; i++) f.w.burnStack(fd, f.p, 0);
  f.w.hitEnemy(fd, 1e6, { p: f.p, kind: 'weapon', crit: false, noProc: true }); chains(f.w);
  ok(fd.fodder && fd.hp <= 0 && !fn.burnN && dealt(f, fn) === 0, 'a fodder foe dies without a burst');
  const n0 = stage('ranger', { stoke: 1 }), ne = foe(n0.w, 300, 300), nn = foe(n0.w, 330, 300); for (let i = 0; i < 4; i++) n0.w.burnStack(ne, n0.p, 0); n0.w.hitEnemy(ne, 1e6, { p: n0.p, kind: 'weapon', crit: false, noProc: true }); chains(n0.w);
  ok(!nn.burnN, 'no burst without the Kindle gate');
}
{ // Fan the Flames: more stacks pass; Backdraft: more damage, farther; Scorched Earth: the ground burns; Ember Heart: the foes it hits deal less
  const s = stage('ranger', { kindle: 1, fanflames: 1, backdraft: 1, scorched: 1, emberheart: 1 }), { w, p } = s, e = foe(w, 300, 300), nb = foe(w, 360, 300);
  for (let i = 0; i < 4; i++) w.burnStack(e, p, 0);
  const held = e.burnPool; w.hitEnemy(e, 1e6, { p, kind: 'weapon', crit: false, noProc: true }); chains(w);
  ok(nb.burnN === Math.round((C.PYRE_PASS + 0.25) * 4), `Fan the Flames: ${Math.round((C.PYRE_PASS + 0.25) * 4)} of 4 stacks pass (${nb.burnN})`);
  near(dealt(s, nb, h => h.src.kind === 'explode'), held * C.PYRE_K * (1 + p.stats.burnMul) * 1.4, 1e-6, 'Backdraft: +40% and 20% farther (60 px reached)');
  ok(zonesOf(w, 'pfire').some(z => z.stack === 1 && z.block && z.dur === C.SCORCH_T), 'Scorched Earth: burning ground that blocks foe paths');
  const pl = foe(w, 300, 520); near(hurt(s, nb, 1000) / hurt(s, pl, 1000), 0.75, 0.01, 'Ember Heart: a foe the burst hit deals 25% less');
}
{ // Wildfire: a foe holding 5 stacks passes 1 a second to a foe touching it
  const s = stage('ranger', { kindle: 1, wildfire: 1 }), { w, p } = s, e = foe(w, 300, 300), t = foe(w, 300 + e.r + 6, 300), far = foe(w, 420, 300);
  for (let i = 0; i < 5; i++) w.burnStack(e, p, 0);
  run(s, 1.1); ok(t.burnN >= 1 && !far.burnN, `a touching foe catches a stack (${t.burnN}), a far one none`);
  const l = stage('ranger', { kindle: 1, wildfire: 1 }), a = foe(l.w, 300, 300), b = foe(l.w, 300 + a.r + 6, 300); for (let i = 0; i < 4; i++) l.w.burnStack(a, l.p, 0); run(l, 1.1); ok(!b.burnN, 'below 5 stacks nothing passes');
}
{ // Smother: foes holding 3 of the hero's stacks deal 12% less
  const s = stage('ranger', { kindle: 1, smother: 1 }), { w, p } = s, e = foe(w, p.x + 40, p.y);
  const h0 = hurt(s, e, 1000); for (let i = 0; i < C.SMOTHER_AT; i++) w.burnStack(e, p, 0); ok(e.smother === 0.12, `${C.SMOTHER_AT} stacks: the foe is smothered`);
  near(hurt(s, e, 1000) / h0, 0.88, 0.002, 'it deals 12% less');
}
{ // Cinder Arms: the held attack channels a flame cone (CONE_TICK hits, Burn x CONE_BURN) for up to 2 s, the walk slowed
  const s = stage('ranger', { kindle: 1, evo_fire: 1 }), { w, p } = s, e = foe(w, p.x + 80, p.y), back = foe(w, p.x - 80, p.y);
  const m0 = St.moveRate(p); w.playerHold(p, true, 0); ok(p.holdOn && Math.abs(St.moveRate(p) / m0 - 0.6) < 1e-9, 'the hold starts and slows the walk 40%');
  run(s, 0.5); ok(dealt(s, e, h => h.src.part === 'cone') > 0 && e.burnN > 0 && dealt(s, back) === 0, 'the cone burns the foe in front, not the one behind');
  run(s, 1.6); ok(!p.holdOn && evOf(s, 'hold').some(v => v.on === 0), 'the channel ends at 2 s');
}

// ---------------- Frost ----------------
{ // Frostbite: full chill freezes; FREEZE_SET s later any direct hit Shatters (+shatter, the freeze ends, chill to the foes round it); frozen foes take +25%
  const s = stage('ranger', { frostbite: 1 }), { w, p } = s, e = foe(w, 300, 300), nb = foe(w, 340, 300), sh = 1 + p.stats.shatter;
  w.addChill(e, 1000, p); near(e.frozen, 1.6, 1e-9, 'full chill freezes for 1.6 s');
  const plain = foe(w, 300, 500), d0 = w.hitEnemy(plain, 100, { p, kind: 'weapon', crit: false });
  const d1 = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false }); near(d1 / d0, 1.25, 1e-6, 'a hit before the freeze sets: +25% only'); ok(e.frozen > 0, 'and no Shatter');
  run(s, C.FREEZE_SET + 0.02);
  const d2 = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false }); near(d2 / d0, 1.25 * sh, 1e-6, `a weapon hit on a set freeze Shatters: x${sh} and +25%`);
  ok(e.frozen === 0 && evOf(s, 'shatter').length === 1 && nb.chill > 0, 'the freeze ends and the foes round it are chilled');
}
{ // any hero's hit Shatters a foe another hero froze (the freezer's shatter)
  const s = stage('ranger', { frostbite: 1 }, { allies: ['knight'] }), { w, p } = s, q = w.players.get('p1'), e = foe(w, 300, 300), plain = foe(w, 300, 500);
  w.freezeEnemy(e, p); w.time += C.FREEZE_SET + 0.01;
  const d0 = w.hitEnemy(plain, 100, { p: q, kind: 'weapon', crit: false }), d1 = w.hitEnemy(e, 100, { p: q, kind: 'weapon', crit: false });
  near(d1 / d0, 1.25 * (1 + p.stats.shatter), 1e-6, 'an ally without Frost Shatters it at the freezer\'s shatter'); ok(e.frozen === 0, 'the freeze ends');
}
{ // a boss never freezes: a full gauge slows it and leaves it Brittle; its next hit Shatters at half
  const s = stage('ranger', { frostbite: 1 }), { w, p } = s, b = foe(w, 300, 400, { type: ED.biomeFor(1).boss, keepHp: true }), plain = foe(w, 300, 500);
  w.addChill(b, 1e6, p); ok(!(b.frozen > 0) && b.slow > 0 && b.brittle > 0, 'a boss: slowed and Brittle, never frozen');
  const d0 = w.hitEnemy(plain, 100, { p, kind: 'weapon', crit: false }), d1 = w.hitEnemy(b, 100, { p, kind: 'weapon', crit: false });
  near(d1 / d0, 1 + p.stats.shatter * C.BRITTLE_K, 1e-6, 'the Brittle boss Shatters at half the bonus'); ok(!(b.brittle > 0), 'once');
}
{ // Shatterpoint: the burst splashes shatterSplash of the Shatter hit to foes within 60; Cold Cycle: coldCycle s off every cooldown per Shatter, once per COLD_CD; Absolute Zero freezes the foes round it
  const s = stage('ranger', { frostbite: 1, shatterpoint: 1, coldcycle: 1, absolutezero: 1 }), { w, p } = s, e = foe(w, 300, 300), nb = foe(w, 340, 300), far = foe(w, 420, 300);
  w.freezeEnemy(e, p); w.time += C.FREEZE_SET + 0.01; const d = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false });
  near(dealt(s, nb, h => h.src.kind === 'explode'), d * p.stats.shatterSplash, 1e-6, 'the splash: shatterSplash of the Shatter hit'); ok(dealt(s, far) === 0, 'not beyond 60');
  ok(nb.frozen > 0, 'Absolute Zero: the foe round it freezes');
  ok(w.msgs.filter(m => m.t === 'refund' && m.slot === -1 && Math.abs(m.s - 0.4) < 1e-9).length === 1, 'Cold Cycle refunds 0.4 s on every slot');
  w.time += C.FREEZE_SET + 0.01; w.hitEnemy(nb, 100, { p, kind: 'weapon', crit: false }); ok(w.msgs.filter(m => m.t === 'refund').length === 1, `at most once per ${C.COLD_CD} s`);
  const z = stage('ranger', { frostbite: 1, absolutezero: 1 }), ze = foe(z.w, 300, 300), zn = foe(z.w, 340, 300); zn.freezeRes = 1;
  z.w.freezeEnemy(ze, z.p); z.w.time += C.FREEZE_SET + 0.01; z.w.hitEnemy(ze, 100, { p: z.p, kind: 'weapon', crit: false }); ok(!(zn.frozen > 0) && zn.chill > 0, 'a foe frozen lately is chilled instead');
}
{ // Glacier: frozen foes are solid, their shots stop
  const s = stage('ranger', { frostbite: 1, glacier: 1 }), { w, p } = s, e = foe(w, 300, 300);
  w.freezeEnemy(e, p); ok(e.glacier && w.solidStops({ x: 300, y: 300, r: 3 }), 'a frozen foe is solid to foe shots');
}
{ // Glacial Arms: the held attack charges an ice lance (full at 0.6 s): 250% weapon damage piercing, it freezes foes that are not bosses; a short hold fires a weaker one
  const s = stage('ranger', { frostbite: 1, evo_ice: 1 }), { w, p } = s, e = foe(w, p.x + 120, p.y);
  w.playerHold(p, true, 0); run(s, 0.7); w.playerHold(p, false, 0);
  const sh = w.projs.filter(q => q.team === 0 && q.kind === 'iceshard'); ok(sh.length === 1 && Math.abs(sh[0].dmg - p.stats.weapon.dmg * C.LANCE_MUL) < 1e-9 && sh[0].pierce >= 99, 'a full lance: one piercing shard at 250%');
  ok(evOf(s, 'lance').length === 1, 'a lance event');
  run(s, 0.4); ok(e.frozen > 0 || evOf(s, 'freeze').length > 0, 'it freezes the foe it passes');
  w.projs.length = 0; w.playerHold(p, true, 0); run(s, 0.1); w.playerHold(p, false, 0); const q = w.projs.find(r => r.kind === 'iceshard'); ok(q && q.dmg < p.stats.weapon.dmg * C.LANCE_MUL * 0.5, 'a short hold fires a weaker lance');
}

// ---------------- Storm ----------------
{ // Static Charge: hits charge foes (30% of damage), held 3 s then fading; at CHARGE_AT of the foe's health it discharges DIS_K x the charge and jumps to the hero's charged foes within 120
  const s = stage('ranger', { staticcharge: 1 }), { w, p } = s, e = foe(w, 300, 300), j = foe(w, 380, 360), j2 = foe(w, 460, 400);
  const d = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false }); near(e.charge, d * 0.3, 1e-6, 'a hit charges 30% of its damage');
  const c0 = e.charge; run(s, 2.9); near(e.charge, c0, 1e-9, 'held 3 s'); run(s, 1); ok(e.charge < c0, 'then fading');
  e.charge = 0; j.charge = 50; j.chargeOwner = p; j.chargeT = 3; j2.charge = 40; j2.chargeOwner = p; j2.chargeT = 3; s.log.length = 0;
  const at = e.maxHp * C.CHARGE_AT.trash;
  w.addCharge(e, at - 1, p); chains(w); ok(dealt(s, e) === 0, 'below the threshold: no discharge');
  w.addCharge(e, 1, p); chains(w);
  near(dealt(s, e, h => h.src.kind === 'chain'), at * C.DIS_K, 1e-6, `at ${C.CHARGE_AT.trash * 100}% of its health the charge discharges x${C.DIS_K}`); ok(e.charge === 0, 'the charge is spent');
  near(dealt(s, j, h => h.src.kind === 'chain'), 100, 1e-6, 'the discharge jumps to a charged foe within 120'); near(dealt(s, j2, h => h.src.kind === 'chain'), 80, 1e-6, 'and on from there');
  const el = stage('ranger', { staticcharge: 1 }), ee = foe(el.w, 300, 300, { hp: 1000 }); ee.elite = 'x'; el.w.addCharge(ee, 1000 * C.CHARGE_AT.elite, el.p); chains(el.w); ok(dealt(el, ee) > 0, `an elite discharges at ${C.CHARGE_AT.elite * 100}%`);
}
{ // High Voltage: +20%; Overload: discharges stun; Conductor: one more jump, 30% farther
  const s = stage('ranger', { staticcharge: 1, highvoltage: 1, overload: 1, conductor: 1 }), { w, p } = s, e = foe(w, 300, 300), j = foe(w, 440, 300);
  j.charge = 50; j.chargeOwner = p; j.chargeT = 3;
  w.addCharge(e, e.maxHp * C.CHARGE_AT.trash, p); chains(w);
  near(dealt(s, e, h => h.src.kind === 'chain'), e.maxHp * C.CHARGE_AT.trash * C.DIS_K * 1.2, 1e-6, 'High Voltage: +20%'); ok(e.stun > 0, 'Overload stuns the discharged foe');
  ok(dealt(s, j) > 0, 'Conductor: a jump reaches 140 px');
}
{ // Arc Flash: a discharge arcs ARC_MUL to every uncharged foe within 120 and charges it; Capacitor: +30% and 30% of the charge stays
  const s = stage('ranger', { staticcharge: 1, arcflash: 1, capacitor: 1 }), { w, p } = s, e = foe(w, 300, 300), a = foe(w, 360, 340), b = foe(w, 300, 380), far = foe(w, 500, 300);
  const at = e.maxHp * C.CHARGE_AT.trash; w.addCharge(e, at, p); chains(w);
  const dis = dealt(s, e, h => h.src.kind === 'chain'); near(dis, at * C.DIS_K * 1.3, 1e-6, 'Capacitor: +30%'); near(e.charge, at * 0.3, 1e-6, 'and 30% of the charge stays');
  near(dealt(s, a), dis * C.ARC_MUL, 1e-6, 'Arc Flash: an uncharged foe takes ARC_MUL'); ok(dealt(s, b) > 0 && a.charge > 0 && b.charge > 0 && dealt(s, far) === 0, 'every uncharged foe within 120, charged by it; none beyond');
}
{ // Tempest Arms: the held attack calls a storm: a bolt every STORM_TICK on the foe nearest the aim within STORM_RANGE, charging x STORM_CHARGE; up to 2 s
  const s = stage('ranger', { staticcharge: 1, evo_lightning: 1 }), { w, p } = s, e = foe(w, p.x + 150, p.y), off = foe(w, p.x + 150, p.y + 120);
  p.aimX = e.x; p.aimY = e.y; w.playerHold(p, true, 0); run(s, 1);
  ok(dealt(s, e, h => h.src.part === 'storm') > 0 && dealt(s, off) === 0 && e.charge > 0, 'bolts strike the foe nearest the aim and charge it');
  run(s, 1.2); ok(!p.holdOn, 'the call ends at 2 s');
}

// ---------------- Steel: the finisher ----------------
{ // Finisher: the held attack charges a finisher (full at 1 s): a guaranteed crit at x2 that Bleeds 50%; it never Cleaves; Masterwork Arms: full at 0.7 s, and it tears out the foe's Bleed at x1.5
  const s = stage('knight', { generalist: 1, masterstroke: 1 }), { w, p } = s, e = foe(w, p.x + 28, p.y);
  p.critStacks = 1; s.log.length = 0; w.playerAttack(p, 0); const dc = dealt(s, e, h => h.src.kind === 'weapon'); s.log.length = 0;
  w.playerHold(p, true, 0); run(s, 0.5); w.playerHold(p, false, 0); ok(dealt(s, e, h => h.src.kind === 'weapon') === 0, 'released early: no finisher');
  w.playerHold(p, true, 0); run(s, 1.05); s.log.length = 0; w.playerHold(p, false, 0);
  near(dealt(s, e, h => h.src.kind === 'weapon' && h.src.critOut) / dc, C.FIN_MUL, 0.02, 'a full finisher: x2 a crit'); ok(e.bleedPool > 0 && evOf(s, 'finisher').length === 1, 'it Bleeds and shows');
  const m = stage('knight', { generalist: 1, masterstroke: 1, evo_general: 1 }), me = foe(m.w, m.p.x + 28, m.p.y);
  ok(St.holdFull(m.p.stats) === St.FULL_EVO, 'Masterwork: full at 0.7 s');
  me.bleedPool = 100; me.bleedOwner = m.p; m.w.playerHold(m.p, true, 0); run(m, 0.75); m.log.length = 0; m.w.playerHold(m.p, false, 0);
  const rend = m.log.filter(h => h.e === me && h.src.kind === 'evo'); ok(rend.length === 1 && rend[0].d > 100 * C.REND_K && me.bleedPool === 0 && evOf(m, 'rend').length === 1, `Masterwork Arms: the finisher tears out the whole Bleed (its own too) at x${C.REND_K} (${rend.length && rend[0].d.toFixed(0)})`);
  m.log.length = 0; me.bleedPool = 100; m.w.playerAttack(m.p, 0); ok(!m.log.some(h => h.src.kind === 'evo') && me.bleedPool >= 100, 'a plain attack tears nothing');
}
{ // a finisher never Cleaves; the warhammer shock takes neither the finisher nor the Cleave factor
  const s = stage('knight', { generalist: 1, masterstroke: 1, k_atk: 1 }, { wi: 1 }), { w, p } = s, e = foe(w, p.x + 30, p.y);
  for (let c = 0; c < 3; c++) { p.atkCount = c; s.log.length = 0; w.playerAttack(p, 0, 0, undefined, true); ok(!s.log.some(h => h.src.part === 'cleave'), `a finisher at swing count ${c} is no Cleave`); }
  s.log.length = 0; p.atkCount = 2; w.playerAttack(p, 0); const shock = s.log.filter(h => h.src.kind === 'explode' || h.src.part === 'shock');
  ok(s.log.some(h => h.src.part === 'cleave'), 'the third swing Cleaves');
  ok(shock.every(h => Math.abs(h.d - p.stats.weapon.dmg * p.stats.weapon.shock.mul * Math.max(0.1, p.stats.dmg) * (h.e.frozen > 0 ? 1.25 : 1)) < 1), 'the Cleave shock is the plain weapon shock');
}
{ // melee reach is at most REACH_CAP x the weapon range, the arc at most ARC_CAP
  const s = stage('knight', { wide: 2 }), { w, p } = s; p.stats.meleeReach = 3; p.stats.area = 3;
  const wpn = p.stats.weapon, inR = foe(w, p.x + wpn.range * C.REACH_CAP - 4, p.y, { hp: 1e6 }), outR = foe(w, p.x + wpn.range * C.REACH_CAP + 40, p.y, { hp: 1e6 });
  s.log.length = 0; w.playerAttack(p, 0); ok(dealt(s, inR) > 0 && dealt(s, outR) === 0, `reach capped at x${C.REACH_CAP}`);
  ok(ED.BOONS.wide.max === 2, 'Wide Arcs: 2 ranks');
}
{ // no evolution adds shots to an attack
  const counts = (evo) => { const s = stage('ranger', evo ? { [evo]: 1 } : {}); for (let i = 0; i < 12; i++) s.w.playerAttack(s.p, 0); return s.w.projs.filter(q => q.team === 0).length; };
  const n0 = counts(null);
  ok(['evo_fire', 'evo_ice', 'evo_lightning', 'evo_general'].every(id => counts(id) === n0), 'no evolution adds shots to an attack');
  const m = stage('ranger', { evo_general: 1 }), me = foe(m.w, m.p.x + 100, m.p.y); m.p.stats.crit = 1; for (let i = 0; i < 6; i++) { m.w.playerAttack(m.p, 0); run(m, 0.2); }
  ok(!m.log.some(h => h.src.kind === 'evo'), 'Masterwork Arms: crits add no strike');
}

// ---------------- cross-path cards ----------------
{
  { // Thermal Shock: a Shatter on a burning foe pays out half its Burn x1.5
    const s = stage('ranger', { kindle: 1, frostbite: 1, thermal: 1 }), { w, p } = s, e = foe(w, 300, 300);
    for (let i = 0; i < 4; i++) w.burnStack(e, p, 0); w.freezeEnemy(e, p); w.time += C.FREEZE_SET + 0.01; const held = e.burnPool;
    w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false }); ok(dealt(s, e, h => h.src.el === 'fire' && h.src.kind === 'chain') > held * 0.5 * C.THERMAL_K * 0.9, 'Thermal Shock pays out half the Burn');
  }
  { // Plasma: discharges add Burn; Superconductor: +40% on a chilled foe
    const s = stage('ranger', { kindle: 1, staticcharge: 1, plasma: 1 }), { w, p } = s, e = foe(w, 300, 300); w.addCharge(e, e.maxHp * C.CHARGE_AT.trash, p); chains(w); ok(e.burnN > 0, 'Plasma: a discharge burns');
    const t = stage('ranger', { frostbite: 1, staticcharge: 1, supercon: 1 }), a = foe(t.w, 300, 300), b = foe(t.w, 300, 500); a.chill = 50;
    t.w.addCharge(a, a.maxHp * C.CHARGE_AT.trash, t.p); t.w.addCharge(b, b.maxHp * C.CHARGE_AT.trash, t.p); chains(t.w);
    near(dealt(t, a, h => h.src.kind === 'chain') / dealt(t, b, h => h.src.kind === 'chain'), 1.4, 1e-6, 'Superconductor: +40% on a chilled foe');
  }
  { // Searing Steel: crits Burn; Icebreaker: hits on a frozen foe crit; Stormblade: a crit discharges a charged foe at once
    const s = stage('knight', { generalist: 1, kindle: 1, searing: 1 }), { w, p } = s, e = foe(w, 300, 300); w.hitEnemy(e, 100, { p, kind: 'weapon', crit: true }); const b0 = e.burnN + e.bacc;
    const t = stage('knight', { generalist: 1, kindle: 1 }), f = foe(t.w, 300, 300); t.w.hitEnemy(f, 100, { p: t.p, kind: 'weapon', crit: true }); ok(b0 > f.burnN + f.bacc, 'Searing Steel: a crit builds more Burn');
    const i = stage('knight', { generalist: 1, frostbite: 1, icebreaker: 1 }), g = foe(i.w, 300, 300); i.w.freezeEnemy(g, i.p); i.w.hitEnemy(g, 100, { p: i.p, kind: 'weapon' }); ok(i.log.some(h => h.e === g && h.src.critOut), 'Icebreaker: a hit on a frozen foe crits');
    const k = stage('knight', { generalist: 1, staticcharge: 1, stormblade: 1 }), h2 = foe(k.w, 300, 300); h2.charge = 30; h2.chargeOwner = k.p; h2.chargeT = 3;
    k.w.hitEnemy(h2, 10, { p: k.p, kind: 'weapon', crit: true }); chains(k.w); ok(k.log.some(h => h.e === h2 && h.src.kind === 'chain'), 'Stormblade: a crit discharges a charged foe');
  }
}

// ---------------- cost of burning ground at 200 foes ----------------
{
  const tick = (zones) => {
    const s = stage('ranger', { kindle: 1, scorched: 1 }), { w, p } = s, rng = new U.RNG(5);
    p.invuln = 1e9;
    for (let i = 0; i < 200; i++) { const e = w.spawnEnemy('skeleton', p.x + rng.range(-300, 300), p.y + rng.range(-200, 200)); e.spawnT = 0; e.hp = e.maxHp = 1e9; e.cd = 9999; }
    if (zones) for (let i = 0; i < 6; i++) w.addZone({ kind: 'pfire', x: p.x + 60 * (i - 3), y: p.y + 80, r: C.PYRE_R * C.SCORCH_K, dur: 1e9, dps: 0, stack: 1, owner: p.pid, team: 0, block: 1 });
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 240; i++) w.update(1 / 60);
    return Number(process.hrtime.bigint() - t0) / 1e6 / 240;
  };
  const a = Math.min(tick(false), tick(false)), b = Math.min(tick(true), tick(true));
  console.log(`200 foes: ${a.toFixed(3)} ms/tick plain, ${b.toFixed(3)} ms/tick with 6 blocking burning grounds`);
  ok(b < a * 1.6 + 0.3, `burning ground costs at most +60% at 200 foes (${a.toFixed(3)} -> ${b.toFixed(3)} ms)`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
