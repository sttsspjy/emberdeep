// Usage: node tools/check-pyro.js
// Headless checks of the Pyromancer's 12 route cards against DESIGN-classes section 6 (rank 1 behaviour, ranks 2-3, rank-3 riders) in staged worlds: Channel, Magma Heart, Ember Rush, Twin Nova, Phoenix Mantle,
// Twin Meteor, Comet, Living Flame, White Heat and Heat Engine. Prints failures and exits 1 when any check fails.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ED } = require('./sim.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' }); // the snapshot encoder (hero flags)
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const C = ED.CONST, H = ED.CLS.pyro;

// A pyromancer alone in a quiet room (no crit chance, so damage ratios are exact). s.log holds every hit { part, kind, d, e, t, src }, s.adds every Burn add, s.evs the events of the world.
function stage(boons, wi, seed) {
  const w = new ED.World({ seed: seed || 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'pyro', weapon: ED.CLASSES.pyro.weapons[wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null; p.stats.crit = 0; p.stats.dodge = 0;
  w.enemies.length = 0; w.enc = null; w.locked = false;
  const log = [], adds = [], evs = [], hit0 = w.hitEnemy, burn0 = w.addBurn;
  w.hitEnemy = function (e, base, src) { const d = hit0.call(this, e, base, src); log.push({ part: src && src.part, kind: src && src.kind, d, e, t: this.time, src }); return d; };
  w.addBurn = function (e, amount, who) { adds.push({ e, amount, t: this.time }); return burn0.call(this, e, amount, who); };
  return { w, p, log, adds, evs };
}
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 5000; return e; };
const run = (s, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { s.w.update(1 / 60); for (const ev of s.w.fx) s.evs.push(ev); s.w.fx.length = 0; if (f) f(); } };
const parts = (s, part) => s.log.filter(h => h.part === part);
const evOf = (s, t) => s.evs.filter(e => e.t === t);
const cast = (s, slot, x, y) => s.w.playerSkill(s.p, 0, { x0: s.p.x, y0: s.p.y, x, y }, slot);
const flags = (w) => ED.Net.encodeSnap(w, [], false).P[0][6];

// ---- stat totals (mods + up x (rank - 1) + r3) and derived data ----
{
  const st = (b, wp) => ED.Stats.compute({ cls: 'pyro', weapon: wp || 'firestaff', boons: b, relics: [], meta: META(), pact: 0 });
  near(st({ p_atk: 1 }).chanStep, 0.3, 1e-9, 'Pyroclast step'); near(st({ p_atk: 1, p_atk_s: 1 }).chanStep, 0.15, 1e-9, 'Ember Rush halves the step');
  near(st({ p_atk: 1, p_atk_s: 1 }).chanCap, 0.6, 1e-9, 'Ember Rush cap +10'); near(st({ p_atk: 1, p_atk_s: 3 }).chanCap, 0.7, 1e-9, 'Ember Rush rank 3 cap'); near(st({ p_atk: 1, p_atk_s: 3 }).overheat, 1, 1e-9, 'Overheat at rank 3');
  near(st({ p_atk: 1, p_atk_h: 3 }).aftershock, 0.5, 1e-9, 'Magma Heart aftershock 0.3 + 2 x 0.1'); near(st({ p_atk: 1, p_atk_h: 3 }).lavaPool, 0.3, 1e-9, 'Lava Pools at rank 3'); near(st({ p_atk: 1, p_atk_h: 2 }).lavaPool, 0, 1e-9, 'no Lava Pool before rank 3');
  near(st({ p_s1: 1 }).s1Dmg, 0.2, 1e-9, 'Firestorm damage'); near(st({ p_s1: 1 }).s1Area, 0.25, 1e-9, 'Firestorm radius'); near(st({ p_s1: 1 }).skillCd, 7 * 0.79, 1e-9, 'Firestorm cooldown 5.5 s');
  near(st({ p_s1: 1, p_s1_b: 2 }).s1Dmg, 1.2 * 1.1 - 1, 1e-9, 'Phoenix Mantle rank 2 Nova +10% (compounds)');
  near(st({ p_s2: 1, p_s2_a: 3 }).twinMeteor, 0.8, 1e-9, 'Twin Meteor 0.6 + 2 x 0.1'); near(st({ p_s2: 1, p_s2_b: 3 }).comet, 0.5, 1e-9, 'Comet 0.3 + 2 x 0.1'); near(st({ p_s2: 1, p_s2_b: 3 }).cometStun, 0.5, 1e-9, 'Impact Crater at rank 3');
  near(st({ p_el: 1, p_el_a: 3 }).burnMul, 0.4, 1e-9, 'White Heat burn 0.2 + 2 x 0.1'); near(st({ p_el: 1, p_el_a: 3 }).burnCrit, 0.1, 1e-9, 'Flashpoint'); near(st({ p_el: 1, p_el_b: 3 }).heatEngine, 0.25, 1e-9, 'Heat Engine 0.15 + 2 x 0.05'); near(st({ p_el: 1, p_el_b: 3 }).heatChain, 5, 1e-9, 'Chain Reaction needs 5');
  const w1 = st({ p_atk: 1, p_atk_h: 1 }, 'emberwand').weapon, w2 = st({ p_atk: 1, p_atk_h: 1 }).weapon;
  near(w1.explode.r, 40, 1e-9, 'Magma Heart gives a blast-less weapon a blast (r40)'); near(w1.explode.mul, 0.5, 1e-9, 'Magma Heart blast 50%');
  near(w2.explode.r, 46, 0.01, 'Magma Staff keeps its own (15% bigger) blast'); near(w2.explode.mul, 0.6, 1e-9, 'Magma Staff blast mul');
  const tn = ED.Stats.skillNums('nova', st({ p_s1: 1, p_s1_a: 1 }));
  near(tn.p.echo.dmg, 62.4 * 0.4, 0.01, 'echo part = blast x 0.4'); near(tn.p.echo.r, tn.p.blast.r, 1e-9, 'echo radius = blast radius');
  near(ED.Stats.skillNums('meteor', st({ p_s2: 1, p_s2_a: 1 })).p.twin.dmg, 72 * 1.15 * 0.6, 0.01, 'twin part = impact x 0.6'); near(ED.Stats.skillNums('meteor', st({ p_s2: 1, p_s2_a: 3 })).p.rocks.dmg, 72 * 1.15 * 0.3, 0.01, 'rocks part = impact x 0.3');
  const cm = ED.Stats.skillNums('meteor', st({ p_s2: 1, p_s2_b: 1 })).move;
  ok(cm && cm.k === 'leap' && cm.t === 0.6 && cm.iframes === 0.35 && !ED.Stats.skillNums('meteor', st({})).move, 'Comet adds the leap move (0.6 s, untouchable 0.35 s)');
}

// ---- Pyroclast: Channel builds while standing still and attacking, caps, and resets on movement or 0.6 s idle ----
{
  const s = stage({ p_atk: 1 }), { w, p } = s, e = foe(w, p.x + 60, p.y), st = p.stats;
  const dealt = () => { p.invuln = 0; return w.hitEnemy(e, 100, { p, kind: 'weapon', wpn: true, crit: false }); };
  const d0 = dealt();
  const stepAtk = (secs) => run(s, secs, () => { p.moving = false; if (Math.round(w.time * 60) % 6 === 0) w.playerAttack(p, 0); });
  stepAtk(1.0);
  ok(p.chanT > 0.9 && p.chanT < 1.05, `Channel builds while attacking (chanT ${p.chanT.toFixed(2)})`);
  near(dealt() / d0, (st.dmg + 0.1 * Math.floor(p.chanT / 0.3)) / st.dmg, 1e-6, 'Channel: +10% per 0.3 s');
  near(dealt() / d0, (st.dmg + 0.3) / st.dmg, 1e-6, 'Channel +30% after 1 s (3 steps)');
  near(w.hitEnemy(e, 100, { p, kind: 'skill', crit: false }) / d0, 1, 1e-6, 'Channel does not touch skill hits');
  stepAtk(2);
  near(dealt() / d0, (st.dmg + 0.5) / st.dmg, 1e-6, 'Channel caps at +50%');
  p.moving = true; run(s, 1 / 60);
  near(p.chanT, 0, 1e-9, 'moving resets Channel');
  stepAtk(1.0); ok(p.chanT > 0.9, 'Channel builds again'); run(s, 0.7, () => { p.moving = false; });
  near(p.chanT, 0, 1e-9, '0.6 s without attacking resets Channel');
  const s2 = stage({}); run(s2, 0.5, () => { s2.p.moving = false; s2.w.playerAttack(s2.p, 0); }); near(s2.p.chanT, 0, 1e-9, 'no Channel without the card');
  // a Heavy weapon attacks every 0.9 s (Magma Staff) or 1.3 s (Tome of Ruin): the pause between its shots must not end Channel
  for (const [wi, iv] of [[0, 0.9], [2, 1.3]]) {
    const h = stage({ p_atk: 1, p_atk_h: 1 }, wi), hp = h.p; near(ED.Stats.attackInterval(hp), iv, 1e-9, 'heavy interval ' + iv); foe(h.w, hp.x + 60, hp.y);
    let nxt = 0; run(h, 6, () => { hp.moving = false; if (h.w.time >= nxt) { h.w.playerAttack(hp, 0); nxt = h.w.time + iv; } });
    ok(hp.chanT > 4, `Channel survives the ${iv} s pause between heavy shots (chanT ${hp.chanT.toFixed(1)})`);
    near(ED.chanWindow(hp), 1.25 * iv, 1e-9, 'Channel window follows the interval'); run(h, ED.chanWindow(hp) + 0.1, () => { hp.moving = false; }); near(hp.chanT, 0, 1e-9, 'a pause of 1.25 intervals ends it');
  }
  near(ED.chanWindow(stage({ p_atk: 1 }, 1).p), 0.6, 1e-9, 'fast weapons keep the 0.6 s window'); near(ED.chanWindow(stage({ p_atk: 1, p_atk_s: 1 }, 0).p), 0.6, 1e-9, 'Swift weapons too'); near(ED.chanWindow(stage({ p_atk: 1 }, 0).p), 0.625, 1e-9, 'the Fire Staff (0.5 s) gets 0.625 s');
}

// ---- Ember Rush: Channel every 0.15 s up to +60% (+5% per rank); Overheat at full Channel ----
{
  const s = stage({ p_atk: 1, p_atk_s: 3 }, 0), { w, p } = s, st = p.stats, wm = () => H.hitMul.call(w, p, { burnPool: 0 }, { wpn: true });
  near(st.weapon.rate, 0.275, 1e-9, 'Spark Staff interval'); ok(st.swift, 'Ember Rush is swift');
  p.chanT = 0.46; near(wm(), 0.3, 1e-9, 'three 0.15 s steps = +30%');
  p.chanT = 5; near(wm(), 0.7, 1e-9, 'rank 3 caps at +70%');
  const oh = H.attackOpts.call(w, p, st); ok(oh && oh.pierce === 1 && Math.abs(oh.blastMul - 1.2) < 1e-9, 'Overheat at full Channel: +1 pierce, blast x1.2');
  p.chanT = 0.9; ok(!H.attackOpts.call(w, p, st), 'no Overheat below the cap (0.6 s of Channel is +40%)');
  const r1 = stage({ p_atk: 1, p_atk_s: 1 }, 0); r1.p.chanT = 9; ok(!H.attackOpts.call(r1.w, r1.p, r1.p.stats), 'no Overheat before rank 3');
  p.chanT = 5; p.lastAtkT = w.time; p.moving = false; const base = p.stats.weapon;
  w.playerAttack(p, 0); const shot = w.projs.find(q => q.team === 0);
  near(shot.pierce, base.pierce + st.pierce + 1, 1e-9, 'Overheat shot pierces one more'); near(shot.explode.r, base.explode.r * 1.2, 1e-6, 'Overheat blast is 20% wider');
  w.projs.length = 0; p.chanT = 0; p.lastAtkT = -99; w.playerAttack(p, 0); const shot2 = w.projs.find(q => q.team === 0); near(shot2.explode.r, base.explode.r, 1e-6, 'normal blast without Channel');
}

// ---- Magma Heart: aftershock 0.4 s after the blast at 30% (+10% per rank), noProc and untagged; Lava Pools at rank 3, one per spot ----
{
  const s = stage({ p_atk: 1, p_atk_h: 1 }, 0), { w, p } = s; p.moving = true; // moving: no Channel, so the blast and the aftershock compare cleanly
  foe(w, p.x + 90, p.y);
  near(p.stats.weapon.dmg, 23.8, 0.05, 'Magma Staff damage');
  w.playerAttack(p, 0);
  run(s, 1.0);
  const blast = s.log.filter(h => h.kind === 'explode' && h.src.part === undefined), after = parts(s, 'aftershock');
  ok(blast.length === 1 && after.length === 1, `one blast and one aftershock (got ${blast.length}, ${after.length})`);
  near(after[0].d / blast[0].d, 0.3, 1e-6, 'aftershock = 30% of the blast'); near(after[0].t - blast[0].t, 0.4, 0.03, 'aftershock 0.4 s later');
  ok(after[0].src.noProc && after[0].src.wpn && !after[0].src.el && !after[0].src.clsEl, 'aftershock is a physical weapon blast without infusions');
  ok(evOf(s, 'pyAfter').length === 1, 'aftershock telegraph event'); ok(!w.zones.some(z => z.lava), 'no Lava Pool before rank 3');
  const s2 = stage({ p_atk: 1, p_atk_h: 2 }, 0); s2.p.moving = true; foe(s2.w, s2.p.x + 90, s2.p.y); s2.w.playerAttack(s2.p, 0); run(s2, 1.0);
  near(parts(s2, 'aftershock')[0].d / s2.log.filter(h => h.kind === 'explode' && h.src.part === undefined)[0].d, 0.4, 1e-6, 'aftershock 40% at rank 2');
  // rank 3: a Lava Pool of 30% of the shot per second, 2 s, untagged; a new pool on the same spot refreshes it
  const s3 = stage({ p_atk: 1, p_atk_h: 3 }, 0), w3 = s3.w, p3 = s3.p, e3 = foe(w3, p3.x + 90, p3.y);
  w3.playerAttack(p3, 0); run(s3, 0.9);
  let pools = w3.zones.filter(z => z.lava);
  ok(pools.length === 1, `a Lava Pool appears (got ${pools.length})`);
  near(pools[0].r, 46 * 0.6, 0.05, 'Lava Pool radius = blast radius x 0.6'); near(pools[0].dps, 23.8 * 0.3, 0.05, 'Lava Pool dps = 30% of the shot'); near(pools[0].dur, 2, 1e-9, 'Lava Pool lasts 2 s');
  ok(pools[0].untagged && pools[0].kind === 'pfire', 'Lava Pool is untagged ground fire'); near(pools[0].w, C.LAVA_TAG, 0, 'Lava Pool carries the look tag');
  const burn0 = e3.burnPool; run(s3, 0.6); ok(e3.burnPool === burn0, 'Lava Pool builds no Burn and is not Fire-tagged');
  ok(s3.log.some(h => h.kind === 'dot' && !h.src.el && h.d > 0), 'Lava Pool ticks as untagged damage');
  const z0 = pools[0]; e3.x = p3.x + 90; e3.y = p3.y; e3.kbx = e3.kby = 0; w3.playerAttack(p3, 0); run(s3, 0.9); pools = w3.zones.filter(z => z.lava);
  ok(pools.length === 1 && pools[0] === z0, `the second pool on the same spot refreshes the first (${pools.length} pools)`);
  const far = foe(w3, p3.x + 90, p3.y + 130); w3.playerAttack(p3, Math.atan2(far.y - p3.y, far.x - p3.x)); run(s3, 0.9); ok(w3.zones.filter(z => z.lava).length === 2, 'a pool on another spot is a separate pool');
  for (let i = 0; i < 6; i++) p3.pyroQ.push({ at: w3.time + 0.1, k: 'after', x: p3.x + 200 + i * 80, y: p3.y - 60, r: 46, dmg: 1, lava: 5, room: w3.room });
  run(s3, 0.3); ok(w3.zones.filter(z => z.lava).length === C.LAVA_MAX, `a hero keeps at most ${C.LAVA_MAX} Lava Pools (got ${w3.zones.filter(z => z.lava).length})`);
  const s4 = stage({ p_atk: 1, p_atk_h: 1 }, 1); foe(s4.w, s4.p.x + 60, s4.p.y); s4.w.playerAttack(s4.p, 0); run(s4, 1.0);
  ok(s4.log.some(h => h.kind === 'explode') && parts(s4, 'aftershock').length === 1, 'a blast-less weapon gets a blast and its aftershock');
}

// ---- Twin Nova: the echo 0.6 s later at 40% (+10% per rank) with its Burn add; Collapse pulls 40 px ----
{
  const s = stage({ p_s1: 1, p_s1_a: 1 }), { w, p, adds } = s;
  foe(w, p.x + 70, p.y);
  cast(s, 0, 0, 0); run(s, 1.0);
  const bl = parts(s, 'nova.blast'), ec = parts(s, 'nova.echo');
  ok(bl.length === 1 && ec.length === 1, `blast and echo (got ${bl.length}, ${ec.length})`);
  near(ec[0].d / bl[0].d, 0.4, 1e-6, 'echo = 40% of the blast'); near(ec[0].t - bl[0].t, 0.6, 0.03, 'echo 0.6 s later');
  ok(adds.length === 2, 'both eruptions add Burn'); near(adds[1].amount / adds[0].amount, 0.4, 1e-6, 'echo Burn = 40% of the Nova Burn');
  ok(evOf(s, 'pyEcho').some(x => x.d === 0.6) && evOf(s, 'pyEcho').some(x => x.go === 1), 'echo telegraph and eruption events'); ok(!evOf(s, 'pyPull').length, 'no pull before rank 3');
  const s2 = stage({ p_s1: 1, p_s1_a: 3 }), w2 = s2.w, p2 = s2.p;
  const e2 = foe(w2, p2.x + 80, p2.y), boss = foe(w2, p2.x + 60, p2.y - 40), el = foe(w2, p2.x + 80, p2.y - 70);
  boss.boss = true; el.elite = 'swift';
  cast(s2, 0, 0, 0); run(s2, 0.44);
  const dist = (q) => Math.hypot(q.x - p2.x, q.y - p2.y), x0 = dist(e2), xb = boss.x, xe = dist(el); run(s2, 0.2);
  ok(evOf(s2, 'pyPull').length === 1, 'pull event 0.15 s before the echo'); run(s2, 0.9);
  near(x0 - dist(e2), 40, 3, `Collapse pulls a common foe 40 px (moved ${(x0 - dist(e2)).toFixed(1)})`); near(boss.x, xb, 1e-9, 'bosses are not pulled'); near(xe - dist(el), 40 * 0.45, 3, `elites move 0.45 x (moved ${(xe - dist(el)).toFixed(1)})`);
  near(parts(s2, 'nova.echo')[0].t - parts(s2, 'nova.blast')[0].t, 0.6, 0.03, 'rank 3 echo still 0.6 s later'); near(parts(s2, 'nova.echo')[0].d / parts(s2, 'nova.blast')[0].d, 0.6, 1e-6, 'echo 60% at rank 3');
  const s3 = stage({ p_s1: 1, p_s1_a: 2 }); foe(s3.w, s3.p.x + 70, s3.p.y); cast(s3, 0, 0, 0); run(s3, 0.7); near(parts(s3, 'nova.echo')[0].d / parts(s3, 'nova.blast')[0].d, 0.5, 1e-6, 'echo 50% at rank 2');
  const s4 = stage({ p_s1: 1, p_s1_a: 1 }); foe(s4.w, s4.p.x + 70, s4.p.y); cast(s4, 0, 0, 0); s4.p.pyroQ[0].room = {}; run(s4, 1.0); ok(!parts(s4, 'nova.echo').length, 'an echo does not follow the hero into another room');
}

// ---- Phoenix Mantle: ring of fire, a shield for 4% (the class window allows 3% per 10 s) once per 10 s, Rebirth Flare when the Mantle is used up ----
{
  const s = stage({ p_s1: 1, p_s1_b: 1 }), { w, p } = s, M = p.maxHp;
  foe(w, p.x + 70, p.y);
  cast(s, 0, 0, 0);
  const ring = w.zones.find(z => z.kind === 'pfire' && !z.lava);
  ok(ring && Math.abs(ring.dur - 3) < 1e-9 && Math.abs(ring.dps - 24) < 0.01, `ring of fire 3 s, 20 x 1.2 per s (got ${ring && ring.dps})`);
  near(p.shield, 0.03 * M, 1e-6, 'Mantle shield: 4% asked, the class window grants 3%'); near(p.mantleAmt, p.shield, 1e-9, 'mantleAmt tracks the Mantle part'); near(p.mantleT, 10, 1e-9, 'Mantle cooldown 10 s');
  ok(w.fx.some(ev => ev.t === 'pyMantle'), 'Mantle event');
  p.shield = 0; p.mantleAmt = 0; cast(s, 0, 0, 0); near(p.shield, 0, 1e-9, 'no second Mantle inside 10 s');
  const s2 = stage({ p_s1: 1, p_s1_b: 1 }); cast(s2, 0, 0, 0); near(s2.p.shield, 0, 1e-9, 'no foe hit, no shield'); near(s2.p.mantleT, 0, 1e-9, 'no cooldown without a hit');
}
{
  const s = stage({ p_s1: 1, p_s1_b: 3 }), { w, p } = s, e = foe(w, p.x + 80, p.y), far = foe(w, p.x + 300, p.y);
  cast(s, 0, 0, 0); const m = p.mantleAmt; ok(m > 0, 'Mantle up');
  const kb0 = e.kbx; s.log.length = 0; s.evs.length = 0; w.fx.length = 0;
  p.invuln = 0; w.hurtPlayer(p, 1, {}); ok(p.mantleAmt > 0 && p.mantleAmt < m && !parts(s, 'nova.flare').length, 'a partial absorb keeps the Mantle');
  p.invuln = 0; w.hurtPlayer(p, 500, {});
  const fl = parts(s, 'nova.flare');
  ok(fl.length === 1 && p.mantleAmt === 0, 'using the Mantle up fires the flare once'); ok(fl[0].e === e && far.hp === 5000, 'the flare hits foes near the hero only');
  const N = ED.Stats.skillNums('nova', p.stats); near(N.p.flare.dmg, N.p.blast.dmg * 0.5, 1e-9, 'flare part = 50% of the blast'); ok(N.p.flare.r >= 90 && N.p.flare.knock === 220, 'flare radius and knock');
  ok(e.kbx > kb0 + 100, 'the flare knocks foes back'); ok(w.fx.some(ev => ev.t === 'pyRebirth'), 'Rebirth event');
  const s2 = stage({ p_s1: 1, p_s1_b: 3 }); foe(s2.w, s2.p.x + 80, s2.p.y); cast(s2, 0, 0, 0); s2.log.length = 0; s2.p.shield = 0; run(s2, 0.1); ok(s2.p.mantleAmt === 0 && !parts(s2, 'nova.flare').length, 'decay clears mantleAmt without a flare');
  const s3 = stage({ p_s1: 1, p_s1_b: 1 }); foe(s3.w, s3.p.x + 80, s3.p.y); cast(s3, 0, 0, 0); s3.log.length = 0; s3.p.invuln = 0; s3.w.hurtPlayer(s3.p, 500, {}); ok(!parts(s3, 'nova.flare').length, 'no flare before rank 3');
  const s4 = stage({ p_s1: 1, p_s1_b: 3 }); foe(s4.w, s4.p.x + 80, s4.p.y); cast(s4, 0, 0, 0); ok(s4.p.mantleAmt > 0, 'Mantle up before the clear'); s4.w.roomCleared(); near(s4.p.mantleAmt, 0, 1e-9, 'room clear spends the Mantle');
}

// ---- Twin Meteor: a second impact 0.6 s later on the foe nearest the first (60%, +10% per rank), Meteor Shower at rank 3 ----
{
  const s = stage({ p_s2: 1, p_s2_a: 1 }), { w, p } = s, a = foe(w, p.x + 200, p.y), b = foe(w, p.x + 400, p.y);
  cast(s, 1, p.x + 150, p.y); run(s, 2.0);
  const im = parts(s, 'meteor.impact'), tw = parts(s, 'meteor.twin');
  ok(im.length >= 1 && tw.length >= 1, `impact and twin (got ${im.length}, ${tw.length})`);
  const ia = im.find(h => h.e === a), ta = tw.find(h => h.e === a);
  ok(ia && ta, 'the twin lands on the nearest foe (it stands 50 px from the impact)'); near(ta.d / ia.d, 0.6, 1e-6, 'twin = 60% of the impact'); near(ta.t - ia.t, 0.6, 0.03, 'twin 0.6 s after the impact'); near(ia.t, 0.9, 0.05, 'impact 0.9 s after the cast');
  ok(!tw.some(h => h.e === b), 'the far foe is not hit by the twin'); ok(w.zones.filter(z => z.kind === 'pfire').length === 1, 'the twin leaves no crater'); ok(s.adds.length >= 2, 'both impacts add Burn');
  const s2 = stage({ p_s2: 1, p_s2_a: 2 }); foe(s2.w, s2.p.x + 200, s2.p.y); cast(s2, 1, s2.p.x + 150, s2.p.y); run(s2, 2.0); near(parts(s2, 'meteor.twin')[0].d / parts(s2, 'meteor.impact')[0].d, 0.7, 1e-6, 'twin 70% at rank 2');
  const s0 = stage({ p_s2: 1, p_s2_a: 1 }); cast(s0, 1, s0.p.x + 150, s0.p.y); run(s0, 2.0); ok(!parts(s0, 'meteor.twin').length, 'no foe in reach, no twin');
}
{
  // Meteor Shower: 3 meteorites 0.3 s after each impact at w.rng points within 80, r45, 30% each, Burn add 50%; deterministic per seed
  const mk = (seed) => {
    const s = stage({ p_s2: 1, p_s2_a: 3 }, 0, seed), { w, p } = s;
    for (let i = 0; i < 40; i++) { const a = i * 2.4, d = 20 + (i % 8) * 9; foe(w, p.x + 200 + Math.cos(a) * d, p.y + Math.sin(a) * d); }
    const zs = [], z0 = w.addZone;
    w.addZone = function (z) { if (z.kind === 'meteor') zs.push({ x: Math.round(z.x * 100) / 100, y: Math.round(z.y * 100) / 100, r: z.r, dur: z.dur, t: Math.round(w.time * 100) / 100 }); return z0.call(this, z); };
    cast(s, 1, p.x + 200, p.y); run(s, 2.2);
    return { s, zs };
  };
  const { s, zs } = mk(7), rocks = zs.filter(z => z.r < 60), im = parts(s, 'meteor.impact'), rk = parts(s, 'meteor.rocks');
  ok(rocks.length === 6, `3 meteorites for the impact and 3 for the twin (got ${rocks.length})`);
  ok(rocks.slice(0, 3).every(z => Math.hypot(z.x - zs[0].x, z.y - zs[0].y) <= 80.01 && Math.abs(z.dur - 0.3) < 1e-9), 'meteorites fall within 80 of the impact, 0.3 s after it');
  ok(rk.length > 0 && im.length > 0, 'meteorites hit'); const per = ED.Stats.skillNums('meteor', s.p.stats); near(per.p.rocks.dmg, per.p.impact.dmg * 0.3, 1e-9, 'meteorite = 30% of the impact'); near(per.p.rocks.r, 45, 1e-9, 'meteorite radius 45');
  const e0 = im[0].e, r0 = rk.find(h => h.e === e0); ok(!r0 || Math.abs(r0.d / im[0].d - 0.3) < 1e-6, 'a meteorite deals 30% of an impact to the same foe');
  ok(JSON.stringify(zs) === JSON.stringify(mk(7).zs), 'meteorite points are deterministic per seed'); ok(JSON.stringify(zs) !== JSON.stringify(mk(8).zs), 'and differ between seeds');
  ok(s.adds.length > im.length, 'meteorites add Burn');
}

// ---- Comet: leap data, airborne flag, landing 0.6 s after the cast for +30% (+10% per rank), Impact Crater stun and double knock ----
{
  const go = (boons) => { const s = stage(boons), e = foe(s.w, s.p.x + 150, s.p.y); cast(s, 1, s.p.x + 150, s.p.y); return { s, e }; };
  const base = go({ p_s2: 1 }); run(base.s, 1.2);
  const c1 = go({ p_s2: 1, p_s2_b: 1 }), w = c1.s.w, p = c1.s.p;
  near(p.cometT, 0.6, 1e-9, 'Comet: airborne 0.6 s'); ok(flags(w) & 512, 'airborne hero flag 1 << 9 on the wire'); ok(w.fx.some(ev => ev.t === 'pyComet'), 'Comet launch event');
  run(c1.s, 0.58); ok(parts(c1.s, 'meteor.impact').length === 0, 'no landing before 0.6 s'); run(c1.s, 0.1);
  const li = parts(c1.s, 'meteor.impact')[0], bi = parts(base.s, 'meteor.impact')[0];
  ok(li && bi, 'landing and meteor hit'); near(li.t, 0.6, 0.04, 'Comet lands 0.6 s after the cast'); near(bi.t, 0.9, 0.04, 'Meteor lands 0.9 s after the cast'); near(li.d / bi.d, 1.3, 1e-6, 'Comet landing +30%');
  ok(!(p.cometT > 0), 'airborne ends'); ok(!(flags(w) & 512), 'flag cleared');
  const r3 = go({ p_s2: 1, p_s2_b: 3 }), ec = foe(r3.s.w, r3.s.p.x + 150, r3.s.p.y + 30), boss = foe(r3.s.w, r3.s.p.x + 150, r3.s.p.y - 30); boss.boss = true;
  const rb = go({ p_s2: 1, p_s2_b: 1 }); foe(rb.s.w, rb.s.p.x + 150, rb.s.p.y + 30);
  run(r3.s, 0.62); run(rb.s, 0.62);
  ok(r3.e.stun > 0 && ec.stun > 0, 'Impact Crater stuns foes 0.5 s'); near(r3.e.stun, 0.5, 0.05, 'stun duration'); ok(boss.stun === 0, 'bosses are not stunned'); ok(rb.e.stun === 0, 'no stun before rank 3');
  ok(r3.s.log.some(h => h.src.knock === 440) && rb.s.log.some(h => h.src.knock === 220), 'rank 3 doubles the knock-back');
  near(parts(r3.s, 'meteor.impact')[0].d / parts(base.s, 'meteor.impact')[0].d, 1.5, 1e-6, 'Comet rank 3 landing +50%');
}

// ---- Living Flame: +25% Fire damage on skills, weapon Burn 15% (the larger of the route and Kindle) ----
{
  const blast = (boons) => { const s = stage(boons); foe(s.w, s.p.x + 60, s.p.y); cast(s, 0, 0, 0); return { d: parts(s, 'nova.blast')[0].d, st: s.p.stats }; };
  const a = blast({}), b = blast({ p_el: 1 }); near(b.d / a.d, (a.st.dmg + 0.25) / a.st.dmg, 1e-6, 'Living Flame: skills +25%');
  const s = stage({ p_el: 1 }), { w, p } = s;
  near(H.attackOpts.call(w, p, p.stats).infAdd.fire, 0.15, 1e-9, 'weapon Burn rate 15%');
  p.stats.fireInfuse = 0.1; near(H.attackOpts.call(w, p, p.stats).infAdd.fire, 0.05, 1e-9, 'with Kindle at 10%: the route adds the difference only'); p.stats.fireInfuse = 0.2; near(H.attackOpts.call(w, p, p.stats).infAdd.fire, 0, 1e-9, 'Kindle at 20% outranks the route');
  const u = stage({ p_el: 1 }, 0); foe(u.w, u.p.x + 80, u.p.y); u.w.playerAttack(u.p, 0); run(u, 0.7);
  ok(u.adds.length === 2, `direct hit and blast each add Burn (got ${u.adds.length})`);
  const dh = u.log.find(h => h.kind === 'weapon'); near(u.adds[0].amount, dh.d * 0.15, dh.d * 0.001, 'direct hit Burn = 15% of the hit (before the Fire affinity of the stratum)');
  const none = stage({}, 0); foe(none.w, none.p.x + 80, none.p.y); none.w.playerAttack(none.p, 0); run(none, 0.7); ok(none.adds.length === 0, 'no Burn without the card');
  const t = stage({ p_el: 1 }, 1); foe(t.w, t.p.x + 80, t.p.y); t.w.playerAttack(t.p, 0); run(t, 0.5); ok(t.adds.length >= 1, 'the Ember Wand builds Burn from the route as well');
}

// ---- White Heat: Burn +20% (+10% per rank), burning foes take +10% from skills, Flashpoint crits at Burn > 10% of max HP ----
{
  const s = stage({ p_el: 1, p_el_a: 1 }), { w, p } = s, e = foe(w, p.x + 60, p.y);
  e.burnPool = 100; e.burnOwner = p; e.burnTick = 0.01; e.burn = 1; run(s, 0.05);
  const dot = s.log.find(h => h.kind === 'dot'); near(dot.d, 20 * 1.2, 1e-6, 'Burn tick x1.2 (20% of the pool, +20%)');
  const hot = stage({ p_el: 1, p_el_a: 1 }), cold = stage({ p_el: 1, p_el_a: 1 });
  const eh = foe(hot.w, hot.p.x + 60, hot.p.y), ec = foe(cold.w, cold.p.x + 60, cold.p.y); eh.burnPool = 50; eh.burnOwner = hot.p;
  const dh = hot.w.hitEnemy(eh, 100, { p: hot.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }), dc = cold.w.hitEnemy(ec, 100, { p: cold.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' });
  const sd = hot.p.stats.dmg + 0.25; near(dh / dc, (sd + 0.1) / sd, 1e-6, 'burning foes take +10% from skills');
  const wk = hot.w.hitEnemy(eh, 100, { p: hot.p, kind: 'weapon', wpn: true, crit: false }), wc = cold.w.hitEnemy(ec, 100, { p: cold.p, kind: 'weapon', wpn: true, crit: false }); near(wk / wc, 1, 1e-6, 'the +10% is for skills only');
  const f = stage({ p_el: 1, p_el_a: 3 }), fe = foe(f.w, f.p.x + 60, f.p.y), src = { p: f.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' };
  fe.burnPool = 0.09 * fe.maxHp; fe.burnOwner = f.p; f.w.hitEnemy(fe, 10, src); ok(!src.critOut, 'no Flashpoint below 10% of max HP');
  const src2 = { p: f.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }; fe.burnPool = 0.11 * fe.maxHp; f.w.hitEnemy(fe, 10, src2); ok(src2.critOut, 'Flashpoint: Burn above 10% of max HP always crits');
  ok(f.w.fx.some(ev => ev.t === 'pyFlash'), 'Flashpoint event'); const src3 = { p: f.p, kind: 'weapon', wpn: true }; fe.burnPool = 0.5 * fe.maxHp; f.w.hitEnemy(fe, 10, src3); ok(!src3.critOut, 'Flashpoint is for Nova and Meteor only');
  const g = stage({ p_el: 1, p_el_a: 2 }), ge = foe(g.w, g.p.x + 60, g.p.y), src4 = { p: g.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }; ge.burnPool = 0.5 * ge.maxHp; g.w.hitEnemy(ge, 10, src4); ok(!src4.critOut, 'no Flashpoint before rank 3');
}

// ---- Heat Engine: each burning foe a cast hits cuts 0.15 s from the other skill (at most 1.5 s per cast); Chain Reaction at 5 refunds it in full once per 6 s ----
{
  const refunds = (w) => w.msgs.filter(m => m.t === 'refund');
  const mk = (boons, nBurn, nCold) => {
    const s = stage(boons), { w, p } = s;
    for (let i = 0; i < nBurn; i++) { const e = foe(w, p.x + 30 + i * 5, p.y + 10 * (i % 3) - 10); e.burnPool = 60; e.burnOwner = p; e.burnTick = 99; e.burn = 1; }
    for (let i = 0; i < nCold; i++) foe(w, p.x + 30 + i * 5, p.y + 40);
    w.msgs.length = 0;
    return s;
  };
  let s = mk({ p_el: 1, p_el_b: 1 }, 3, 2); cast(s, 0, 0, 0);
  let r = refunds(s.w); ok(r.length === 1 && r[0].slot === 1, 'one refund message for Meteor'); near(r[0].s, 0.45, 1e-9, '3 burning foes = 0.45 s'); ok(s.w.fx.some(ev => ev.t === 'pyHeat' && ev.n === 3), 'Heat event');
  s = mk({ p_el: 1, p_el_b: 1 }, 0, 3); cast(s, 0, 0, 0); ok(refunds(s.w).length === 0, 'foes that were not burning before the cast do not count');
  s.w.msgs.length = 0; cast(s, 0, 0, 0); r = refunds(s.w); ok(r.length === 1 && Math.abs(r[0].s - 0.45) < 1e-9, 'a second cast counts the foes the first one lit');
  s = mk({ p_el: 1, p_el_b: 1 }, 12, 0); cast(s, 0, 0, 0); r = refunds(s.w); near(r[0].s, 1.5, 1e-9, 'capped at 1.5 s per cast'); ok(r.length === 1, 'one message per cast');
  s = mk({ p_el: 1, p_el_b: 2 }, 3, 0); cast(s, 0, 0, 0); near(refunds(s.w)[0].s, 0.6, 1e-9, 'rank 2: 0.2 s per foe');
  s = mk({ p_el: 1, p_el_b: 3 }, 5, 0); cast(s, 0, 0, 0); r = refunds(s.w); ok(r.length === 1 && r[0].s === undefined && r[0].slot === 1, 'Chain Reaction: 5 burning foes refund Meteor in full'); near(s.p.heatT, 6, 1e-9, 'Chain Reaction cooldown 6 s');
  s.w.msgs.length = 0; cast(s, 0, 0, 0); r = refunds(s.w); ok(r.length === 1 && r[0].s !== undefined, 'a second chain inside 6 s only cuts the cooldown');
  s.p.heatT = 0; s.w.msgs.length = 0; cast(s, 0, 0, 0); r = refunds(s.w); ok(r.length === 1 && r[0].s === undefined, 'Chain Reaction is ready again after 6 s');
  s = mk({ p_el: 1, p_el_b: 3 }, 4, 0); cast(s, 0, 0, 0); ok(refunds(s.w)[0].s !== undefined, '4 burning foes: a partial cut only');
  s = mk({ p_el: 1, p_el_b: 1 }, 4, 0); const e0 = s.w.enemies[0]; cast(s, 1, e0.x, e0.y); ok(refunds(s.w).length === 0, 'Meteor: nothing at the cast'); run(s, 1.0); r = refunds(s.w); ok(r.length === 1 && r[0].slot === 0 && r[0].s > 0, 'Meteor impact cuts the Nova cooldown');
  s = mk({}, 4, 0); cast(s, 0, 0, 0); ok(refunds(s.w).length === 0, 'no refund without the card');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
