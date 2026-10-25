// Usage: node tools/check-elements.js
// Headless checks of the element verbs against docs/GAME-DESIGN.md sections 2-3 in staged worlds: the path data (one gate, keystone and evolution per path, every {stat} token in its mods),
// one staged test per verb (Burn stacks, burning ground, Wildfire, Firewalk, Smother, the flame cone; freeze, Shatter, Cold Cycle, Glacier, the ice wall, the ice lance; Charge and the dash discharge,
// jumps, Conductor, Overload, Thunderstep, Storm Step, Tempest Arms; Venom, Caustic, toxic clouds, Toxic Wake, the flask; perfect dodges, Swift Grace, Divine Riposte, the guard; Backstabs, Umbral Step,
// Phantom Step, Umbral Arms; the finisher), the build-up rule (statuses build from damage dealt, never hit count) and the cost of the ice wall and burning ground at 200 foes. Prints failures and exits 1 when any check fails.
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
  w.elemAff = () => 1; w.affC = () => 1; w.state = 'play';
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
const hurt = (s, e, amt) => { const p = s.p, h = p.hp; p.invuln = 0; p.hp = p.maxHp = 1e6; s.w.hurtPlayer(p, amt, { e }); return 1e6 - p.hp; }; // health a foe's hit of amt takes from p0
const dash = (s, dx, dy) => { s.p.dashT = C.DASH.t; s.p.dashing = true; s.w.playerDash(s.p, dx, dy); }; // a dash starts (the world keeps p.dashing while dashT runs)
const sweep = (s, x0, y0, x1, y1) => { const p = s.p; p.x = x0; p.y = y0; s.w.playerDash(p, 1, 0); p.dashing = true; p.x = x1; p.y = y1; s.w.dashSweep(p); }; // a dash swept from (x0, y0) to (x1, y1) in one tick

// ---------------- data ----------------
{
  for (const el of ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow', 'general']) {
    const ids = ED.BOON_IDS.filter(id => ED.BOONS[id].path === el && !ED.BOONS[id].cls);
    const g = ids.filter(id => ED.BOONS[id].gate), k = ids.filter(id => ED.BOONS[id].key), v = ids.filter(id => ED.BOONS[id].evo), pool = ids.length - g.length - k.length - v.length;
    ok(g.length === 1 && k.length === 1 && v.length === 1 && pool >= 5 && pool <= 7, `${el}: one gate, one keystone, one evolution, ${pool} path boons`);
  }
  const st0 = St.compute({ cls: 'ranger', weapon: 'longbow', boons: {}, relics: [], meta: META(), pact: 0 }), bad = [], miss = [];
  for (const id of ED.BOON_IDS) {
    const b = ED.BOONS[id]; if (b.cls) continue;
    for (const m of (b.desc || '').matchAll(/\{(\w+)\}/g)) if (m[1] !== 'pw' && !(m[1] in (b.mods || {})) && !['burn', 'vdot'].includes(m[1]) && !(b.purse && m[1] === 'gold')) bad.push(id + ':' + m[1]);
    for (const key in (b.mods || {})) if (typeof st0[key] !== 'number') miss.push(id + ':' + key);
    if (/[{}]/.test(ED.Sheet.text(id, 1, st0))) bad.push(id + ' text');
  }
  ok(!bad.length, `every {stat} token of a boon is in its mods and resolves (${bad.join()})`);
  ok(!miss.length, `every boon stat is in the stat block (${miss.join()})`);
  ok(St.compute({ cls: 'ranger', weapon: 'longbow', boons: { evo_fire: 1 }, relics: [], meta: META(), pact: 0 }).hold === 'cone' && St.compute({ cls: 'ranger', weapon: 'longbow', boons: { evo_ice: 1 }, relics: [], meta: META(), pact: 0 }).hold === 'lance'
    && St.compute({ cls: 'ranger', weapon: 'longbow', boons: { evo_poison: 1 }, relics: [], meta: META(), pact: 0 }).hold === 'flask' && St.compute({ cls: 'ranger', weapon: 'longbow', boons: { evo_holy: 1 }, relics: [], meta: META(), pact: 0 }).hold === 'guard'
    && St.compute({ cls: 'ranger', weapon: 'longbow', boons: { masterstroke: 1 }, relics: [], meta: META(), pact: 0 }).hold === 'finisher', 'the hold verbs: flame cone, ice lance, flask, guard, finisher');
}

// ---------------- the build-up rule: statuses build from damage dealt, never hit count ----------------
{
  const s = stage('knight', { kindle: 1, envenom: 1, staticcharge: 1 }), { w, p } = s, a = foe(w, 300, 300), b = foe(w, 300, 400);
  for (let i = 0; i < 10; i++) w.hitEnemy(a, 10, { p, kind: 'weapon', crit: false, noGuard: true, back: false });
  w.hitEnemy(b, 100, { p, kind: 'weapon', crit: false, noGuard: true, back: false });
  const S = burnV(p) * C.BURN_LIFE, burnOf = (e) => e.burnN * S + e.bacc;
  near(burnOf(a) / burnOf(b), 1, 1e-6, 'ten hits of 10 build the Burn of one hit of 100');
  near(a.venom / b.venom, 1, 1e-6, 'and the same Venom'); near(a.charge / b.charge, 1, 1e-6, 'and the same charge');
}

// ---------------- Fire ----------------
{ // Burn stacks: build-up S per stack, the cap, Kindling, the tick, the life, one Burn value per hero
  const s = stage('ranger', { kindle: 1 }), { w, p } = s, e = foe(w, 300, 300), S = burnV(p) * C.BURN_LIFE;
  w.addBurn(e, S * 2.5, p); ok(e.burnN === 2 && Math.abs(e.bacc - S * 0.5) < 1e-6, `2.5 stacks of build-up: 2 stacks and half a stack toward the next (${e.burnN}, ${(e.bacc / S).toFixed(2)})`);
  w.addBurn(e, S * 50, p); ok(e.burnN === C.BURN_CAP, `a foe holds ${C.BURN_CAP} stacks (${e.burnN})`);
  const k = stage('ranger', { kindle: 1, kindling: 1 }); const ek = foe(k.w, 300, 300); k.w.addBurn(ek, 99 * burnV(k.p) * C.BURN_LIFE, k.p); ok(ek.burnN === C.BURN_CAP + 3, `Kindling: +3 (${ek.burnN})`);
  const t = stage('ranger', { kindle: 1, stoke: 1 }), et = foe(t.w, 300, 300); for (let i = 0; i < 3; i++) t.w.burnStack(et, t.p, 0); run(t, 0.52);
  const dot = t.log.filter(h => h.e === et && h.src.kind === 'dot'); ok(dot.length === 1, 'the stacks of one hero tick as one hit'); near(dot[0].d, 3 * burnV(t.p) * 0.5 * 1.2, 1e-6, 'a tick: n stacks x the Burn value x 0.5 s, Stoke +20%');
  run(t, C.BURN_LIFE); near(dealt(t, et, h => h.src.kind === 'dot'), 3 * burnV(t.p) * 1.2 * C.BURN_LIFE, 1e-6, 'a stack deals its Burn value for its whole life');
  ok(!et.burnN && !et.burn, 'stacks end after their life');
  const two = stage('ranger', { kindle: 1 }, { allies: ['knight'] }), q = two.w.players.get('p1'); q.boons.kindle = 1; q.boons.stoke = 2; two.w.recalc(q, true);
  const e2 = foe(two.w, 300, 300); two.w.burnStack(e2, two.p, 0); two.w.burnStack(e2, q, 0); two.w.burnStack(e2, q, 0); run(two, 0.52);
  const by = (o) => two.log.filter(h => h.e === e2 && h.src.kind === 'dot' && h.src.p === o).map(h => h.d);
  ok(by(two.p).length === 1 && by(q).length === 1, 'two heroes: each one\'s stacks tick as its own hit');
  near(by(q)[0], 2 * burnV(q) * 0.5 * (1 + q.stats.burnMul), 1e-6, 'each at its own Burn value'); near(by(two.p)[0], burnV(two.p) * 0.5, 1e-6, 'the other hero\'s too');
  ok(e2.burnN === 3 && e2.burnPool > 0, 'the foe shows one stack count for all heroes');
}
{ // burning ground: the Kindle dash lays ground that stacks foes on it every 0.5 s; Firebreak: 1 s longer, foes walk around it
  const s = stage('ranger', { kindle: 1 }), { w, p } = s, e = foe(w, p.x + 10, p.y);
  dash(s, 1, 0); run(s, 0.1);
  const z = zonesOf(w, 'pfire'); ok(z.length >= 1 && z.every(g => g.stack === 1 && !g.dps && g.dur === C.GROUND_T), `the dash lays burning ground (${z.length} patches, ${C.GROUND_T} s)`);
  run(s, 1.2); ok(e.burnN >= 2, `a foe standing on it gains a stack every 0.5 s (${e.burnN})`);
  const f = stage('ranger', { kindle: 1, firebreak: 1 }); dash(f, 1, 0); run(f, 0.06); ok(zonesOf(f.w, 'pfire').every(g => g.dur === C.GROUND_T + 1 && g.block), 'Firebreak: 1 s longer and it blocks foe paths');
}
{ // Wildfire: a foe holding 5 stacks passes 1 a second to a foe touching it
  const s = stage('ranger', { kindle: 1, wildfire: 1 }), { w, p } = s, e = foe(w, 300, 300), t = foe(w, 300 + e.r + 6, 300), far = foe(w, 420, 300);
  for (let i = 0; i < 5; i++) w.burnStack(e, p, 0);
  run(s, 1.1); ok(t.burnN >= 1 && !far.burnN, `a touching foe catches a stack (${t.burnN}), a far one none`);
  const l = stage('ranger', { kindle: 1, wildfire: 1 }), a = foe(l.w, 300, 300), b = foe(l.w, 300 + a.r + 6, 300); for (let i = 0; i < 4; i++) l.w.burnStack(a, l.p, 0); run(l, 1.1); ok(!b.burnN, 'below 5 stacks nothing passes');
}
{ // Firewalk: dashing through a burning foe copies its stacks (up to 4) to every foe within 50
  const s = stage('ranger', { kindle: 1, firewalk: 1 }), { w, p } = s, e = foe(w, 300, 300), nb = foe(w, 340, 300), far = foe(w, 420, 300);
  for (let i = 0; i < 6; i++) w.burnStack(e, p, 0);
  sweep(s, 260, 300, 330, 300); ok(nb.burnN === 4 && !far.burnN && e.burnN === 6, `the foe keeps its stacks, a neighbour gets 4 (${nb.burnN}), a far foe none`);
  ok(evOf(s, 'chain').some(v => v.k === 'f'), 'an ember line shows it');
}
{ // Smother: foes holding 5 of the hero's stacks deal 10% less
  const s = stage('ranger', { kindle: 1, smother: 1 }), { w, p } = s, e = foe(w, p.x + 40, p.y);
  const h0 = hurt(s, e, 1000); for (let i = 0; i < 5; i++) w.burnStack(e, p, 0); ok(e.smother === 0.1, 'five stacks: the foe is smothered');
  near(hurt(s, e, 1000) / h0, 0.9, 0.002, 'it deals 10% less');
}
{ // Cinder Arms: the held attack channels a flame cone (CONE_TICK hits, Burn x CONE_BURN) for up to 2 s, the walk slowed
  const s = stage('ranger', { kindle: 1, evo_fire: 1 }), { w, p } = s, e = foe(w, p.x + 80, p.y), back = foe(w, p.x - 80, p.y);
  const m0 = St.moveRate(p); w.playerHold(p, true, 0); ok(p.holdOn && Math.abs(St.moveRate(p) / m0 - 0.6) < 1e-9, 'the hold starts and slows the walk 40%');
  run(s, 0.5); ok(dealt(s, e, h => h.src.part === 'cone') > 0 && e.burnN > 0 && dealt(s, back) === 0, 'the cone burns the foe in front, not the one behind');
  run(s, 1.6); ok(!p.holdOn && evOf(s, 'hold').some(v => v.on === 0), 'the channel ends at 2 s');
}

// ---------------- Ice ----------------
{ // Frostbite: full chill freezes (elites shorter), a boss is slowed instead and never frozen; frozen foes take +25%; a skill hit Shatters (+50%, the freeze ends)
  const s = stage('ranger', { frostbite: 1 }), { w, p } = s, e = foe(w, 300, 300), b = foe(w, 300, 400, { type: ED.biomeFor(1).boss, keepHp: true });
  w.addChill(e, 1000, p); near(e.frozen, 1.6, 1e-9, 'full chill freezes for 1.6 s');
  w.addChill(b, 1e6, p); ok(!(b.frozen > 0) && b.slow > 0, 'a boss is never frozen: a full gauge slows it');
  const plain = foe(w, 300, 500), d0 = w.hitEnemy(plain, 100, { p, kind: 'skill', crit: false }), d1 = w.hitEnemy(e, 100, { p, kind: 'skill', crit: false });
  near(d1 / d0, 1.25 * 1.5, 1e-6, 'a skill hit on a frozen foe: +25% frozen, x1.5 Shatter'); ok(e.frozen === 0 && evOf(s, 'shatter').length === 1, 'the Shatter ends the freeze');
}
{ // Shatterpoint: +50% more and a burst of 25% to foes within 60; Cold Cycle: 0.5 s off every cooldown per Shatter (once per 0.5 s)
  const s = stage('ranger', { frostbite: 1, shatterpoint: 1, coldcycle: 1 }), { w, p } = s, e = foe(w, 300, 300), nb = foe(w, 340, 300), far = foe(w, 420, 300);
  w.freezeEnemy(e, p); const d = w.hitEnemy(e, 100, { p, kind: 'skill', crit: false });
  near(dealt(s, nb), d * 0.25, 1e-6, 'the burst: 25% of the Shatter hit'); ok(dealt(s, far) === 0, 'not beyond 60');
  ok(w.msgs.filter(m => m.t === 'refund' && m.slot === -1 && m.s === 0.5).length === 1, 'Cold Cycle refunds 0.5 s on every slot');
  w.freezeEnemy(nb, p); w.hitEnemy(nb, 100, { p, kind: 'skill', crit: false }); ok(w.msgs.filter(m => m.t === 'refund').length === 1, 'at most once per 0.5 s');
}
{ // Glacier: frozen foes are solid, their shots stop
  const s = stage('ranger', { frostbite: 1, glacier: 1 }), { w, p } = s, e = foe(w, 300, 300);
  w.freezeEnemy(e, p); ok(e.glacier && w.solidStops({ x: 300, y: 300, r: 3 }), 'a frozen foe is solid to foe shots');
}
{ // Glacier Step: the dash raises an ice wall along its path for 2.5 s; foe shots stop on it
  const s = stage('ranger', { frostbite: 1, glacierstep: 1 }), { w, p } = s;
  p.x = 200; p.y = 300; w.playerDash(p, 1, 0); p.dashing = true; w.updateVerbs(p, 1 / 60); p.x = 320; p.dashing = false; w.updateVerbs(p, 1 / 60);
  const z = zonesOf(w, 'icewall')[0]; ok(z && z.solid && Math.abs(z.len - 120) < 1 && z.dur === C.WALL_T, `an ice wall 120 long (${z && z.len})`);
  ok(w.solidStops({ x: 260, y: 302, r: 3 }) && !w.solidStops({ x: 260, y: 330, r: 3 }), 'it stops a shot on it, not one beside it');
  const short = stage('ranger', { frostbite: 1, glacierstep: 1 }); short.w.playerDash(short.p, 1, 0); short.p.dashing = true; short.w.updateVerbs(short.p, 1 / 60); short.p.dashing = false; short.w.updateVerbs(short.p, 1 / 60); ok(!zonesOf(short.w, 'icewall').length, 'a dash in place raises none');
}
{ // Glacial Arms: the held attack charges an ice lance (full at 0.6 s): 250% weapon damage piercing, it freezes foes that are not bosses; a short hold fires a weaker one
  const s = stage('ranger', { frostbite: 1, evo_ice: 1 }), { w, p } = s, e = foe(w, p.x + 120, p.y);
  w.playerHold(p, true, 0); run(s, 0.7); w.playerHold(p, false, 0);
  const sh = w.projs.filter(q => q.team === 0 && q.kind === 'iceshard'); ok(sh.length === 1 && Math.abs(sh[0].dmg - p.stats.weapon.dmg * C.LANCE_MUL) < 1e-9 && sh[0].pierce >= 99, 'a full lance: one piercing shard at 250%');
  ok(evOf(s, 'lance').length === 1, 'a lance event');
  run(s, 0.4); ok(e.frozen > 0 || evOf(s, 'freeze').length > 0, 'it freezes the foe it passes');
  w.projs.length = 0; w.playerHold(p, true, 0); run(s, 0.1); w.playerHold(p, false, 0); const q = w.projs.find(r => r.kind === 'iceshard'); ok(q && q.dmg < p.stats.weapon.dmg * C.LANCE_MUL * 0.5, 'a short hold fires a weaker lance');
}

// ---------------- Lightning ----------------
{ // Static Charge: hits charge foes (30% of damage), held 3 s then fading; a dash discharges charged foes within 50 of its path for 200%; the discharge jumps to the hero's charged foes within 120
  const s = stage('ranger', { staticcharge: 1 }), { w, p } = s, e = foe(w, 300, 300), j = foe(w, 380, 360), j2 = foe(w, 460, 400);
  const d = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false }); near(e.charge, d * 0.3, 1e-6, 'a hit charges 30% of its damage');
  const c0 = e.charge; run(s, 2.9); near(e.charge, c0, 1e-9, 'held 3 s'); run(s, 1); ok(e.charge < c0, 'then fading');
  e.charge = 100; e.chargeOwner = p; e.chargeT = 3; j.charge = 50; j.chargeOwner = p; j.chargeT = 3; j2.charge = 40; j2.chargeOwner = p; j2.chargeT = 3;
  s.log.length = 0; sweep(s, 250, 300, 340, 300);
  near(dealt(s, e, h => h.src.kind === 'chain'), 200, 1e-6, 'the dash discharges 200% of the charge'); ok(e.charge === 0, 'the charge is spent');
  chains(w); near(dealt(s, j, h => h.src.kind === 'chain'), 100, 1e-6, 'the discharge jumps to a charged foe within 120'); near(dealt(s, j2, h => h.src.kind === 'chain'), 80, 1e-6, 'and on from there');
  const u = stage('ranger', { staticcharge: 1 }), x = foe(u.w, 300, 300); x.charge = 100; x.chargeOwner = u.p; u.w.dashSweep(u.p); ok(x.charge === 100, 'no dash, no discharge');
}
{ // Conductor: each discharge arcs to 1 uncharged foe within 120 for 50%; Overload: discharges stun; High Voltage: +20%
  const s = stage('ranger', { staticcharge: 1, conductor: 1, overload: 1, highvoltage: 1 }), { w, p } = s, e = foe(w, 300, 300), a = foe(w, 360, 340), b = foe(w, 300, 380);
  e.charge = 100; e.chargeOwner = p; e.chargeT = 3; sweep(s, 250, 300, 340, 300);
  near(dealt(s, e, h => h.src.kind === 'chain'), 240, 1e-6, 'High Voltage: 240'); ok([a, b].filter(o => dealt(s, o) > 0).length === 1, 'one arc to one uncharged foe');
  near(dealt(s, a) + dealt(s, b), 120, 1e-6, 'the arc deals 50%'); ok(e.stun > 0, 'Overload stuns the discharged foe');
}
{ // Thunderstep: foes the dash passes take 100% Power and are charged by it (the same dash does not discharge them); Storm Step blinks next to a charged foe; Tempest Arms refunds the dash
  const s = stage('ranger', { staticcharge: 1, thunderstep: 1 }), { w, p } = s, e = foe(w, p.x + 20, p.y);
  dash(s, 1, 0); run(s, 0.05); ok(dealt(s, e, h => h.src.kind === 'dash') > 0 && e.charge > 0, 'the dash strikes and charges the foe'); run(s, 0.3); ok(e.charge > 0, 'and leaves the charge for the next dash');
  const st = stage('ranger', { staticcharge: 1, stormstep: 1 }), f = foe(st.w, st.p.x + 150, st.p.y);
  ok(!ED.Sim.dashBlink(st.w.room, false, st.p, st.p.stats, st.w.enemies, 0), 'Storm Step: no charged foe, no blink');
  f.charge = 10; f.chargeOwner = st.p; const b = ED.Sim.dashBlink(st.w.room, false, st.p, st.p.stats, st.w.enemies, 0);
  ok(b && Math.abs(b.x - (f.x - f.r - st.p.r - 4)) < 2 && b.dx > 0.9, `a dash aimed at a charged foe within 220 blinks next to it (${b && b.x.toFixed(0)})`);
  ok(!ED.Sim.dashBlink(st.w.room, false, st.p, st.p.stats, st.w.enemies, Math.PI), 'not when aimed away');
  const t = stage('ranger', { staticcharge: 1, evo_lightning: 1 }), g = foe(t.w, 300, 300), h = foe(t.w, 320, 330); g.charge = h.charge = 50; g.chargeOwner = h.chargeOwner = t.p; g.chargeT = h.chargeT = 3;
  sweep(t, 250, 300, 340, 300); ok(t.w.msgs.filter(m => m.t === 'dashRefund').length === 1, 'Tempest Arms: a discharging dash gives the charge back, once per 1.5 s');
}

// ---------------- Poison ----------------
{ // Envenom: Venom weakens (up to 30% less damage), slows and ticks Power damage; Caustic at full Venom: +10% taken; Enfeeble: 10% less more at full
  const s = stage('ranger', { envenom: 1, caustic: 1, enfeeble: 1 }), { w, p } = s, e = foe(w, p.x + 40, p.y), plain = foe(w, p.x + 40, p.y + 60);
  const h0 = hurt(s, e, 1000); w.addVenom(e, 50, p); near(hurt(s, e, 1000) / h0, 0.85, 0.002, 'half Venom: 15% less damage');
  w.addVenom(e, 100, p); near(hurt(s, e, 1000) / h0, 0.6, 0.002, 'full Venom: 30% less, Enfeeble 10% more');
  const d0 = w.hitEnemy(plain, 100, { p, kind: 'weapon', crit: false, noProc: true }), d1 = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false, noProc: true }); near(d1 / d0, 1.1, 1e-6, 'Caustic: a Corroded foe takes +10%');
  s.log.length = 0; run(s, 1.05); ok(dealt(s, e, h => h.src.kind === 'dot') > 0, 'Venom ticks damage');
  ok(e.slow > 0 || e.venom > 0, 'and the foe stays envenomed');
}
{ // toxic clouds: the Envenom dash leaves one (r 40, 3 s) that builds Venom; Miasma: wider, longer; Toxic Wake: walking leaves small clouds
  const s = stage('ranger', { envenom: 1, miasma: 1 }), { w, p } = s, e = foe(w, p.x + 20, p.y);
  w.playerDash(p, 1, 0); const z = zonesOf(w, 'plague')[0]; ok(z && Math.abs(z.r - C.CLOUD_R * 1.25) < 1e-9 && z.dur === C.CLOUD_T + 1 && z.venom === C.CLOUD_V, 'a cloud where the dash began, Miasma 25% wider and 1 s longer');
  run(s, 1.1); ok(e.venom > 0, `a foe in it gains Venom (${e.venom.toFixed(0)})`);
  const t = stage('ranger', { envenom: 1, toxicwake: 1 }); t.p.x = 200; t.w.updateVerbs(t.p, 1 / 60); t.p.x = 250; t.w.updateVerbs(t.p, 1 / 60); ok(zonesOf(t.w, 'plague').length === 1 && zonesOf(t.w, 'plague')[0].r === C.WAKE_R, 'Toxic Wake: a cloud every 40 px walked');
}
{ // Venomous Arms: the held attack readies a flask (full at 0.6 s); release lobs it: 150% weapon damage as Poison within 70 and a cloud building Venom twice as fast
  const s = stage('ranger', { envenom: 1, evo_poison: 1 }), { w, p } = s, e = foe(w, p.x + 150, p.y);
  w.playerHold(p, true, 0); run(s, 0.3); w.playerHold(p, false, 0, 150); ok(!zonesOf(w, 'tele').length, 'a short hold throws nothing');
  w.playerHold(p, true, 0); run(s, 0.65); w.playerHold(p, false, 0, 150); ok(zonesOf(w, 'tele').length === 1, 'a full hold lobs the flask');
  run(s, 0.5); ok(dealt(s, e) > 0 && zonesOf(w, 'plague').some(z => z.venom === C.CLOUD_V * C.FLASK_V), 'it lands: damage and a strong cloud');
}

// ---------------- Holy ----------------
{ // Consecrate: an attack met by the dash is a perfect dodge: it Smites the attacker (Radiance + 150% Power), shields the hero, once per attacker per dash; the window lasts 0.15 s after the dash
  const s = stage('ranger', { consecrate: 1 }), { w, p } = s, e = foe(w, p.x + 30, p.y);
  p.dashing = true; p.shield = 0; const h = p.hp; ok(!w.hurtPlayer(p, 5, { e }) && p.hp === h, 'the attack misses');
  ok(dealt(s, e) > 0 && p.shield > 0 && evOf(s, 'pdodge').length === 1, 'a perfect dodge: the attacker is Smitten, the hero shielded');
  w.hurtPlayer(p, 5, { e }); ok(evOf(s, 'pdodge').length === 1, 'once per attacker per dash');
  w.hurtPlayer(p, 5, { e, contact: true }); const g = foe(w, p.x - 30, p.y); w.hurtPlayer(p, 5, { e: g, contact: true }); ok(evOf(s, 'pdodge').length === 1, 'plain body contact is no attack');
  p.dashing = false; w.dashEnd(p); near(p.pdT, 0.15, 1e-9, 'the window after the dash');
  const k = foe(w, p.x + 30, p.y + 30); ok(!w.hurtPlayer(p, 5, { e: k }), 'a hit inside the window is dodged too');
  p.pdT = 0; p.invuln = 0; ok(w.hurtPlayer(p, 5, { e: k }), 'after it the hit lands');
}
{ // Swift Grace: a perfect dodge gives the dash charge back (once per 2 s); Divine Riposte: the next attack within 1.5 s Smites what it hits
  const s = stage('knight', { consecrate: 1, swiftgrace: 1, riposte: 1 }), { w, p } = s, e = foe(w, p.x + 30, p.y), f = foe(w, p.x + 30, p.y + 20);
  p.dashing = true; w.hurtPlayer(p, 5, { e }); w.hurtPlayer(p, 5, { e: f }); ok(w.msgs.filter(m => m.t === 'dashRefund').length === 1, 'one refund per 2 s');
  p.dashing = false; s.log.length = 0; w.playerAttack(p, 0); ok(s.log.some(h => h.src.smite), 'the next attack Smites');
  s.log.length = 0; w.playerAttack(p, 0); ok(!s.log.some(h => h.src.smite), 'only the next one');
}
{ // Hallowed Arms: the held attack raises a guard (2.5 s, walk slowed 50%): front attacks are perfect dodges, front shots fly back as Holy shots
  const s = stage('ranger', { consecrate: 1, evo_holy: 1 }), { w, p } = s, e = foe(w, p.x + 40, p.y), b = foe(w, p.x - 40, p.y);
  w.playerHold(p, true, 0); ok(p.holdOn && w.guardFront(p, p.x + 40, p.y) && !w.guardFront(p, p.x - 40, p.y), 'the guard covers the front');
  ok(!w.hurtPlayer(p, 5, { e }) && evOf(s, 'pdodge').length === 1, 'a front attack is a perfect dodge'); p.invuln = 0; ok(w.hurtPlayer(p, 5, { e: b }), 'one from behind lands');
  const pr = w.spawnProj({ team: 1, kind: 'bolt', x: p.x + 30, y: p.y, a: Math.PI, speed: 200, r: 4, dmg: 10, life: 2 }); pr.src = e; p.invuln = 0;
  run(s, 0.3); ok(evOf(s, 'block').some(v => v.k === 'guard') && dealt(s, e, h => h.src.kind === 'evo') > 0, 'a front shot flies back as a Holy shot and hits its shooter');
  run(s, 2.4); ok(!p.holdOn, 'the guard drops at 2.5 s');
}

// ---------------- Shadow ----------------
{ // Mark of Doom: a hit from behind a foe (or on a foe targeting someone else) is a Backstab: +30% and 40% of it as Doom; a hit from the front marks none
  const s = stage('knight', { doommark: 1 }), { w, p } = s, e = foe(w, p.x + 30, p.y);
  e.target = p; e.faceA = Math.PI; const d0 = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false }); ok(!(e.doom > 0), 'a hit from the front marks no Doom');
  e.faceA = 0; const d1 = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false }); near(d1 / d0, 1.3, 1e-6, 'a Backstab deals +30%'); ok(e.doom > 0 && evOf(s, 'hit').some(v => v.b), 'marks Doom and shows the slash');
  const o = foe(w, p.x + 30, p.y + 40); o.target = null; o.faceA = Math.PI; ok(w.hitEnemy(o, 100, { p, kind: 'weapon', crit: false }) > d0 * 1.2, 'a foe not targeting you is Backstabbed');
}
{ // Umbral Step: the next 2 hits within 1.5 s of a dash are Backstabs; Phantom Step: a decoy foes go for; Umbral Arms: a dash at a foe steps behind it, the next hit crits
  const s = stage('knight', { doommark: 1, umbralstep: 1 }), { w, p } = s, e = foe(w, p.x + 30, p.y); e.target = p; e.faceA = Math.PI;
  w.playerDash(p, 1, 0); for (let i = 0; i < 3; i++) w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false });
  ok(s.log.filter(h => h.e === e && h.src.back).length === 2, 'two Backstabs after the dash, then front hits again');
  const ph = stage('knight', { doommark: 1, phantom: 1 }), f = foe(ph.w, ph.p.x + 100, ph.p.y); f.spd = 60; f.target = ph.p;
  ph.w.playerDash(ph.p, 1, 0); const dz = zonesOf(ph.w, 'decoy')[0]; ok(dz && dz.w === 3, 'Phantom Step: a decoy (w 3)'); run(ph, 0.1); ok(f.target && f.target.decoy, 'a foe within 200 goes for the decoy');
  const ua = stage('knight', { doommark: 1, evo_shadow: 1 }), g = foe(ua.w, ua.p.x + 120, ua.p.y), bl = ED.Sim.dashBlink(ua.w.room, false, ua.p, ua.p.stats, ua.w.enemies, 0);
  ok(bl && bl.behind && bl.x > g.x, `Umbral Arms: the blink lands behind the foe (${bl && bl.x.toFixed(0)} > ${g.x})`);
  ua.p.x = bl.x; ua.w.playerDash(ua.p, 0, 0, true, ua.p.x - 120, ua.p.y); ok(ua.p.behindT > ua.w.time, 'the next hit within 1 s is a crit');
  const sh = foe(ua.w, ua.p.x + 25, ua.p.y); ua.s = ua; ua.log.length = 0; ua.w.playerAttack(ua.p, 0); ok(ua.log.some(h => h.e === sh && h.src.critOut), 'it crits');
}

// ---------------- General: the finisher ----------------
{ // Masterstroke: the held attack charges a finisher (full at 1 s; Masterwork 0.7 s): a guaranteed crit at x2 that Bleeds 50%
  const s = stage('knight', { generalist: 1, masterstroke: 1 }), { w, p } = s, e = foe(w, p.x + 28, p.y);
  p.critStacks = 1; s.log.length = 0; w.playerAttack(p, 0); const dc = dealt(s, e); s.log.length = 0;
  w.playerHold(p, true, 0); run(s, 0.5); w.playerHold(p, false, 0); ok(dealt(s, e, h => h.src.kind === 'weapon') === 0, 'released early: no finisher');
  w.playerHold(p, true, 0); run(s, 1.05); s.log.length = 0; w.playerHold(p, false, 0);
  near(dealt(s, e, h => h.src.kind === 'weapon' && h.src.critOut) / dc, C.FIN_MUL, 0.02, 'a full finisher: x2 a crit'); ok(e.bleedPool > 0 && evOf(s, 'finisher').length === 1, 'it Bleeds and shows');
  ok(St.holdFull(stage('knight', { generalist: 1, masterstroke: 1, evo_general: 1 }).p.stats) === St.FULL_EVO, 'Masterwork: full at 0.7 s');
}
{ // no evolution adds shots to an attack
  const counts = (evo) => { const s = stage('ranger', evo ? { [evo]: 1 } : {}); for (let i = 0; i < 12; i++) s.w.playerAttack(s.p, 0); return s.w.projs.filter(q => q.team === 0).length; };
  const n0 = counts(null);
  ok(['evo_fire', 'evo_ice', 'evo_lightning', 'evo_poison', 'evo_holy', 'evo_shadow', 'evo_general'].every(id => counts(id) === n0), 'no evolution adds shots to an attack');
}

// ---------------- cost of burning ground and ice walls at 200 foes ----------------
{
  const tick = (zones) => {
    const s = stage('ranger', { kindle: 1, firebreak: 1 }), { w, p } = s, rng = new U.RNG(5);
    p.invuln = 1e9;
    for (let i = 0; i < 200; i++) { const e = w.spawnEnemy('skeleton', p.x + rng.range(-300, 300), p.y + rng.range(-200, 200)); e.spawnT = 0; e.hp = e.maxHp = 1e9; e.cd = 9999; }
    if (zones) for (let i = 0; i < 6; i++) { w.addZone({ kind: 'pfire', x: p.x + 60 * (i - 3), y: p.y + 80, r: C.GROUND_R, dur: 1e9, dps: 0, stack: 1, owner: p.pid, team: 0, block: 1 }); w.addZone({ kind: 'icewall', x: p.x + 60 * (i - 3), y: p.y - 80, a: 0, len: 50, w: C.WALL_W, r: 0, dur: 1e9, team: 0, owner: p.pid, custom: true, solid: true }); }
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 240; i++) w.update(1 / 60);
    return Number(process.hrtime.bigint() - t0) / 1e6 / 240;
  };
  const a = Math.min(tick(false), tick(false)), b = Math.min(tick(true), tick(true));
  console.log(`200 foes: ${a.toFixed(3)} ms/tick plain, ${b.toFixed(3)} ms/tick with 6 blocking burning grounds and 6 ice walls`);
  ok(b < a * 1.6 + 0.3, `burning ground and ice walls cost at most +60% at 200 foes (${a.toFixed(3)} -> ${b.toFixed(3)} ms)`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
