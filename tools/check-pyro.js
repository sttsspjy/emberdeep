// Usage: node tools/check-pyro.js
// Headless checks of the Pyromancer's 12 route cards against docs/GAME-DESIGN.md section 5 (rank 1 behaviour, rank 2 riders, rank 3 forms) in staged worlds: Channel, Magma Heart, Ember Rush, Twin Nova, Phoenix Mantle,
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
  near(st({ p_atk: 1, p_atk_s: 1 }).chanCap, 0.6, 1e-9, 'Ember Rush cap +10'); near(st({ p_atk: 1, p_atk_s: 3 }).chanCap, 0.7, 1e-9, 'Ember Rush rank 3 cap'); near(st({ p_atk: 1, p_atk_s: 3 }).overheat, 1, 1e-9, 'Overheat at rank 3'); near(st({ p_atk: 1, p_atk_s: 2 }).overheat, 1, 1e-9, 'Overheat from rank 2'); near(st({ p_atk: 1, p_atk_s: 1 }).overheat, 0, 1e-9, 'no Overheat at rank 1');
  near(st({ p_atk: 1, p_atk_h: 3 }).aftershock, 0.5, 1e-9, 'Magma Heart aftershock 0.3 + 2 x 0.1'); near(st({ p_atk: 1, p_atk_h: 2 }).lavaPool, 0.5, 1e-9, 'Lava Pools at rank 2'); near(st({ p_atk: 1, p_atk_h: 1 }).lavaPool, 0, 1e-9, 'no Lava Pool at rank 1');
  near(st({ p_s1: 1 }).s1Dmg, 0.2, 1e-9, 'Firestorm damage'); near(st({ p_s1: 1 }).s1Area, 0.25, 1e-9, 'Firestorm radius'); near(st({ p_s1: 1 }).skillCd, 7 * 0.79, 1e-9, 'Firestorm cooldown 5.5 s');
  near(st({ p_s1: 1, p_s1_b: 2 }).s1Dmg, 1.2 * 1.05 - 1, 1e-9, 'Phoenix Mantle rank 2 Nova +5% (compounds)');
  near(st({ p_s2: 1, p_s2_a: 3 }).twinMeteor, 1.0, 1e-9, 'Twin Meteor 0.8 + 2 x 0.1'); near(st({ p_s2: 1, p_s2_b: 2 }).comet, 0.15, 1e-9, 'Comet 0.1 + 0.05'); near(st({ p_s2: 1, p_s2_b: 3 }).comet, 0.2, 1e-9, 'Sun Dive: every landing +20% (0.1 + 2 x 0.05)');
  near(st({ p_s2: 1, p_s2_b: 2 }).cometStun, 0.5, 1e-9, 'Impact Crater at rank 2'); near(st({ p_s2: 1, p_s2_b: 1 }).cometStun, 0, 1e-9, 'no Impact Crater at rank 1');
  near(st({ p_el: 1, p_el_a: 3 }).burnMul, 0.4, 1e-9, 'White Heat burn 0.2 + 2 x 0.1'); near(st({ p_el: 1, p_el_a: 2 }).burnCrit, 0.05, 1e-9, 'Flashpoint at rank 2'); near(st({ p_el: 1, p_el_a: 1 }).burnCrit, 0, 1e-9, 'no Flashpoint at rank 1'); near(st({ p_el: 1, p_el_b: 3 }).heatEngine, 0.25, 1e-9, 'Heat Engine 0.15 + 2 x 0.05'); near(st({ p_el: 1, p_el_b: 2 }).heatChain, 2, 1e-9, 'Chain Reaction needs 2 from rank 2'); near(st({ p_el: 1, p_el_b: 1 }).heatChain, 0, 1e-9, 'no Chain Reaction at rank 1'); near(st({ p_el: 1, p_el_b: 2 }).s1Dmg, 0.3, 1e-9, 'Heat Engine rank 2: Nova +30%'); near(st({ p_el: 1, p_el_b: 2 }).s2Dmg, 0.3, 1e-9, 'Heat Engine rank 2: Meteor +30%'); near(st({ p_el: 1, p_el_b: 1 }).s1Dmg, 0, 1e-9, 'no skill damage at rank 1'); near(st({ p_el: 1, p_el_b: 3 }).s2Dmg, 0.3, 1e-9, 'rank 3 keeps it');
  const w1 = st({ p_atk: 1, p_atk_h: 1 }, 'emberwand').weapon, w2 = st({ p_atk: 1, p_atk_h: 1 }).weapon;
  near(w1.explode.r, 40, 1e-9, 'Magma Heart gives a blast-less weapon a blast (r40)'); near(w1.explode.mul, 0.5, 1e-9, 'Magma Heart blast 50%');
  near(w2.explode.r, 46, 0.01, 'Magma Staff keeps its own (15% bigger) blast'); near(w2.explode.mul, 0.6, 1e-9, 'Magma Staff blast mul');
  const tn = ED.Stats.skillNums('nova', st({ p_s1: 1, p_s1_a: 1 }));
  near(tn.p.echo.dmg, 77.4 * 0.65, 0.01, 'echo part = blast x 0.65'); near(tn.p.echo.r, tn.p.blast.r, 1e-9, 'echo radius = blast radius');
  near(ED.Stats.skillNums('meteor', st({ p_s2: 1, p_s2_a: 1 })).p.twin.dmg, 89.5 * 1.15 * 1.3 * 0.8, 0.01, 'twin part = impact x 0.8'); near(ED.Stats.skillNums('meteor', st({ p_s2: 1, p_s2_a: 3 })).p.rocks.dmg, 89.5 * 1.15 * 1.45 * 0.5, 0.01, 'rocks part = impact x 0.5');
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
  const r1 = stage({ p_atk: 1, p_atk_s: 1 }, 0); r1.p.chanT = 9; ok(!H.attackOpts.call(r1.w, r1.p, r1.p.stats), 'no Overheat at rank 1');
  p.chanT = 5; p.lastAtkT = w.time; p.moving = false; const base = p.stats.weapon;
  w.playerAttack(p, 0); const shot = w.projs.find(q => q.team === 0);
  near(shot.pierce, base.pierce + st.pierce + 1, 1e-9, 'Overheat shot pierces one more'); near(shot.explode.r, base.explode.r * 1.2, 1e-6, 'Overheat blast is 20% wider');
  w.projs.length = 0; p.chanT = 0; p.lastAtkT = -99; w.playerAttack(p, 0); const shot2 = w.projs.find(q => q.team === 0); near(shot2.explode.r, base.explode.r, 1e-6, 'normal blast without Channel');
  // every Pyromancer weapon, blast or not: one shot strikes one more foe directly at full Channel (a blast shot bursts on each foe it pierces)
  for (let wi = 0; wi < 3; wi++) {
    const direct = (full) => {
      const q = stage({ p_atk: 1, p_atk_s: 3 }, wi); q.p.moving = false; q.p.chanT = full ? 9 : 0; q.p.lastAtkT = q.w.time;
      for (let i = 1; i <= 3; i++) foe(q.w, q.p.x + 40 + i * 50, q.p.y);
      q.w.playerAttack(q.p, 0); run(q, 1.0);
      return { n: q.log.filter(h => h.kind === 'weapon').length, bursts: evOf(q, 'boom').length };
    };
    const off = direct(false), on = direct(true);
    ok(on.n === off.n + 1, `${ED.CLASSES.pyro.weapons[wi]}: Overheat strikes one more foe directly (${off.n} -> ${on.n})`);
    if (wi !== 1) ok(on.bursts >= 2 && on.bursts > off.bursts, `${ED.CLASSES.pyro.weapons[wi]}: a blast shot bursts on each foe it pierces (${off.bursts} -> ${on.bursts} bursts)`);
  }
}

// ---- Magma Heart: aftershock 0.4 s after the blast at 30% (+10% per rank), noProc and untagged; Lava Pools at rank 2, one per spot ----
{
  const s = stage({ p_atk: 1, p_atk_h: 1 }, 0), { w, p } = s; p.moving = true; // moving: no Channel, so the blast and the aftershock compare cleanly
  foe(w, p.x + 90, p.y);
  near(p.stats.weapon.dmg, 29.7, 0.05, 'Magma Staff damage');
  w.playerAttack(p, 0);
  run(s, 1.0);
  const blast = s.log.filter(h => h.kind === 'explode' && h.src.part === undefined), after = parts(s, 'aftershock');
  ok(blast.length === 1 && after.length === 1, `one blast and one aftershock (got ${blast.length}, ${after.length})`);
  near(after[0].d / blast[0].d, 0.3, 1e-6, 'aftershock = 30% of the blast'); near(after[0].t - blast[0].t, 0.4, 0.03, 'aftershock 0.4 s later');
  ok(after[0].src.noProc && after[0].src.wpn && !after[0].src.el && !after[0].src.clsEl, 'aftershock is a physical weapon blast without infusions');
  ok(evOf(s, 'pyAfter').length === 1, 'aftershock telegraph event'); ok(!w.zones.some(z => z.lava), 'no Lava Pool at rank 1');
  const s2 = stage({ p_atk: 1, p_atk_h: 2 }, 0); s2.p.moving = true; foe(s2.w, s2.p.x + 90, s2.p.y); s2.w.playerAttack(s2.p, 0); run(s2, 1.0);
  near(parts(s2, 'aftershock')[0].d / s2.log.filter(h => h.kind === 'explode' && h.src.part === undefined)[0].d, 0.4, 1e-6, 'aftershock 40% at rank 2');
  // rank 2: a Lava Pool of 50% of the shot per second, 2 s, untagged; a new pool on the same spot refreshes it
  const s3 = stage({ p_atk: 1, p_atk_h: 2 }, 0), w3 = s3.w, p3 = s3.p, e3 = foe(w3, p3.x + 90, p3.y);
  w3.playerAttack(p3, 0); run(s3, 0.9);
  let pools = w3.zones.filter(z => z.lava);
  ok(pools.length === 1, `a Lava Pool appears (got ${pools.length})`);
  near(pools[0].r, 46 * 0.6, 0.05, 'Lava Pool radius = blast radius x 0.6'); near(pools[0].dps, 29.7 * 0.5, 0.05, 'Lava Pool dps = 50% of the shot'); near(pools[0].dur, 2, 1e-9, 'Lava Pool lasts 2 s');
  ok(pools[0].untagged && pools[0].kind === 'pfire', 'Lava Pool is untagged ground fire'); near(pools[0].w, C.LAVA_TAG, 0, 'Lava Pool carries the look tag');
  const burn0 = e3.burnPool; run(s3, 0.6); ok(e3.burnPool === burn0, 'Lava Pool builds no Burn and is not Fire-tagged');
  ok(s3.log.some(h => h.kind === 'dot' && !h.src.el && h.d > 0), 'Lava Pool ticks as untagged damage');
  const z0 = pools[0], tb = z0.t; e3.x = p3.x + 90; e3.y = p3.y; e3.kbx = e3.kby = 0; w3.playerAttack(p3, 0); run(s3, 0.9); pools = w3.zones.filter(z => z.lava);
  ok(pools.length === 1 && pools[0] === z0, `the second pool on the same spot refreshes the first (${pools.length} pools)`); near(z0.t, tb + 0.9, 0.03, 'a refresh keeps the pool clock running (no fade-out between aftershocks)'); ok(z0.dur > 2.2 && z0.dur - z0.t <= C.LAVA_T + 1e-6, `a refresh extends the pool's life (dur ${z0.dur.toFixed(2)}, t ${z0.t.toFixed(2)})`);
  const far = foe(w3, p3.x + 90, p3.y + 130); w3.playerAttack(p3, Math.atan2(far.y - p3.y, far.x - p3.x)); run(s3, 0.9); ok(w3.zones.filter(z => z.lava).length === 2, 'a pool on another spot is a separate pool');
  for (let i = 0; i < 6; i++) p3.pyroQ.push({ at: w3.time + 0.1, k: 'after', x: p3.x + 200 + i * 80, y: p3.y - 60, r: 46, dmg: 1, lava: 5, room: w3.room });
  run(s3, 0.3); ok(w3.zones.filter(z => z.lava).length === C.LAVA_MAX, `a hero keeps at most ${C.LAVA_MAX} Lava Pools (got ${w3.zones.filter(z => z.lava).length})`); ok(evOf(s3, 'pyLava').length === 8, `a moved pool announces itself like a new one (${evOf(s3, 'pyLava').length} pyLava events, want 8)`); ok(w3.zones.filter(z => z.lava).every(z => z.dur - z.t <= C.LAVA_T + 1e-6), 'a moved pool restarts with LAVA_T of life');
  const s4 = stage({ p_atk: 1, p_atk_h: 1 }, 1); foe(s4.w, s4.p.x + 60, s4.p.y); s4.w.playerAttack(s4.p, 0); run(s4, 1.0);
  ok(s4.log.some(h => h.kind === 'explode') && parts(s4, 'aftershock').length === 1, 'a blast-less weapon gets a blast and its aftershock');
}

// ---- Twin Nova: the echo 0.6 s later at 65% (+35% per rank) with its Burn add; Collapse pulls 40 px ----
{
  const s = stage({ p_s1: 1, p_s1_a: 1 }), { w, p, adds } = s;
  foe(w, p.x + 70, p.y);
  cast(s, 0, 0, 0); run(s, 1.0);
  const bl = parts(s, 'nova.blast'), ec = parts(s, 'nova.echo');
  ok(bl.length === 1 && ec.length === 1, `blast and echo (got ${bl.length}, ${ec.length})`);
  near(ec[0].d / bl[0].d, 0.65, 1e-6, 'echo = 65% of the blast'); near(ec[0].t - bl[0].t, 0.6, 0.03, 'echo 0.6 s later');
  ok(adds.length === 2, 'both eruptions add Burn'); near(adds[1].amount / adds[0].amount, 0.65, 1e-6, 'echo Burn = 65% of the Nova Burn');
  ok(evOf(s, 'pyEcho').some(x => x.d === 0.6) && evOf(s, 'pyEcho').some(x => x.go === 1), 'echo telegraph and eruption events'); ok(!evOf(s, 'pyPull').length, 'no pull before rank 2');
  const s2 = stage({ p_s1: 1, p_s1_a: 2 }), w2 = s2.w, p2 = s2.p;
  const e2 = foe(w2, p2.x + 80, p2.y), boss = foe(w2, p2.x + 60, p2.y - 40), el = foe(w2, p2.x + 80, p2.y - 70);
  boss.boss = true; el.elite = 'swift';
  cast(s2, 0, 0, 0); run(s2, 0.44);
  const dist = (q) => Math.hypot(q.x - p2.x, q.y - p2.y), x0 = dist(e2), xb = boss.x, xe = dist(el); run(s2, 0.2);
  ok(evOf(s2, 'pyPull').length === 1, 'pull event 0.15 s before the echo'); run(s2, 0.9);
  near(x0 - dist(e2), 40, 3, `Collapse pulls a common foe 40 px (moved ${(x0 - dist(e2)).toFixed(1)})`); near(boss.x, xb, 1e-9, 'bosses are not pulled'); near(xe - dist(el), 40 * 0.45, 3, `elites move 0.45 x (moved ${(xe - dist(el)).toFixed(1)})`);
  near(parts(s2, 'nova.echo')[0].t - parts(s2, 'nova.blast')[0].t, 0.6, 0.03, 'rank 2 echo still 0.6 s later'); near(parts(s2, 'nova.echo')[0].d / parts(s2, 'nova.blast')[0].d, 1, 1e-6, 'echo 100% at rank 2');
  const s3 = stage({ p_s1: 1, p_s1_a: 1 }); foe(s3.w, s3.p.x + 70, s3.p.y); cast(s3, 0, 0, 0); run(s3, 0.7); ok(!evOf(s3, 'pyPull').length && parts(s3, 'nova.echo').length === 1, 'no Collapse before rank 2');
  const s4 = stage({ p_s1: 1, p_s1_a: 1 }); foe(s4.w, s4.p.x + 70, s4.p.y); cast(s4, 0, 0, 0); s4.p.pyroQ[0].room = {}; run(s4, 1.0); ok(!parts(s4, 'nova.echo').length, 'an echo does not follow the hero into another room');
}

// ---- Phoenix Mantle: ring of fire, a shield for 3% (the class shield window's cap per 10 s) once per 10 s, Rebirth Flare when the Mantle is used up ----
{
  const s = stage({ p_s1: 1, p_s1_b: 1 }), { w, p } = s, M = p.maxHp;
  foe(w, p.x + 70, p.y);
  cast(s, 0, 0, 0);
  const ring = w.zones.find(z => z.kind === 'pfire' && !z.lava);
  ok(ring && Math.abs(ring.dur - 3) < 1e-9 && Math.abs(ring.dps - 30) < 0.01, `ring of fire 3 s, 25 x 1.2 per s (got ${ring && ring.dps})`);
  near(p.shield, 0.03 * M, 1e-6, 'Mantle shield: 3% (the class shield window caps a class grant at 3% per 10 s)'); near(p.stats.mantle, 0.03, 1e-9, 'Mantle stat equals what the window grants (the card text is true)'); near(p.mantleAmt, p.shield, 1e-9, 'mantleAmt tracks the Mantle part'); near(p.mantleT, 10, 1e-9, 'Mantle cooldown 10 s');
  ok(w.fx.some(ev => ev.t === 'pyMantle'), 'Mantle event');
  p.shield = 0; p.mantleAmt = 0; cast(s, 0, 0, 0); near(p.shield, 0, 1e-9, 'no second Mantle inside 10 s');
  const s2 = stage({ p_s1: 1, p_s1_b: 1 }); cast(s2, 0, 0, 0); near(s2.p.shield, 0, 1e-9, 'no foe hit, no shield'); near(s2.p.mantleT, 0, 1e-9, 'no cooldown without a hit');
}
{
  const s = stage({ p_s1: 1, p_s1_b: 2 }), { w, p } = s, e = foe(w, p.x + 80, p.y), far = foe(w, p.x + 300, p.y);
  cast(s, 0, 0, 0); const m = p.mantleAmt; ok(m > 0, 'Mantle up');
  const kb0 = e.kbx; s.log.length = 0; s.evs.length = 0; w.fx.length = 0;
  p.invuln = 0; w.hurtPlayer(p, 1, {}); ok(p.mantleAmt > 0 && p.mantleAmt < m && !parts(s, 'nova.flare').length, 'a partial absorb keeps the Mantle');
  p.invuln = 0; w.hurtPlayer(p, 500, {});
  const fl = parts(s, 'nova.flare');
  ok(fl.length === 1 && p.mantleAmt === 0, 'using the Mantle up fires the flare once'); ok(fl[0].e === e && far.hp === 5000, 'the flare hits foes near the hero only');
  const N = ED.Stats.skillNums('nova', p.stats); near(N.p.flare.dmg, N.p.blast.dmg * 0.5, 1e-9, 'flare part = 50% of the blast'); ok(N.p.flare.r >= 90 && N.p.flare.knock === 220, 'flare radius and knock');
  ok(e.kbx > kb0 + 100, 'the flare knocks foes back'); ok(w.fx.some(ev => ev.t === 'pyRebirth'), 'Rebirth event');
  const s2 = stage({ p_s1: 1, p_s1_b: 2 }); foe(s2.w, s2.p.x + 80, s2.p.y); cast(s2, 0, 0, 0); s2.log.length = 0; s2.p.shield = 0; run(s2, 0.1); ok(s2.p.mantleAmt === 0 && !parts(s2, 'nova.flare').length, 'decay clears mantleAmt without a flare');
  const s3 = stage({ p_s1: 1, p_s1_b: 1 }); foe(s3.w, s3.p.x + 80, s3.p.y); cast(s3, 0, 0, 0); s3.log.length = 0; s3.p.invuln = 0; s3.w.hurtPlayer(s3.p, 500, {}); ok(!parts(s3, 'nova.flare').length, 'no flare before rank 2');
  const s4 = stage({ p_s1: 1, p_s1_b: 2 }); foe(s4.w, s4.p.x + 80, s4.p.y); cast(s4, 0, 0, 0); ok(s4.p.mantleAmt > 0, 'Mantle up before the clear'); s4.w.roomCleared(); near(s4.p.mantleAmt, 0, 1e-9, 'room clear spends the Mantle');
}

// ---- Twin Meteor: a second impact 0.6 s later on the foe nearest the first (80%, +10% per rank), Meteor Shower at rank 2 ----
{
  const s = stage({ p_s2: 1, p_s2_a: 1 }), { w, p } = s, a = foe(w, p.x + 200, p.y), b = foe(w, p.x + 400, p.y);
  cast(s, 1, p.x + 150, p.y); run(s, 2.0);
  const im = parts(s, 'meteor.impact'), tw = parts(s, 'meteor.twin');
  ok(im.length >= 1 && tw.length >= 1, `impact and twin (got ${im.length}, ${tw.length})`);
  const ia = im.find(h => h.e === a), ta = tw.find(h => h.e === a);
  ok(ia && ta, 'the twin lands on the nearest foe (it stands 50 px from the impact)'); near(ta.d / ia.d, 0.8, 1e-6, 'twin = 80% of the impact'); near(ta.t - ia.t, 0.6, 0.03, 'twin 0.6 s after the impact'); near(ia.t, 0.9, 0.05, 'impact 0.9 s after the cast');
  ok(!tw.some(h => h.e === b), 'the far foe is not hit by the twin'); ok(w.zones.filter(z => z.kind === 'pfire').length === 1, 'the twin leaves no crater'); ok(s.adds.length >= 2, 'both impacts add Burn');
  const s2 = stage({ p_s2: 1, p_s2_a: 2 }); foe(s2.w, s2.p.x + 200, s2.p.y); cast(s2, 1, s2.p.x + 150, s2.p.y); run(s2, 2.0); near(parts(s2, 'meteor.twin')[0].d / parts(s2, 'meteor.impact')[0].d, 0.9, 1e-6, 'twin 90% at rank 2');
  const s0 = stage({ p_s2: 1, p_s2_a: 1 }); cast(s0, 1, s0.p.x + 150, s0.p.y); run(s0, 2.0); ok(!parts(s0, 'meteor.twin').length, 'no foe in reach, no twin');
}
{
  // Meteor Shower: 3 meteorites 0.3 s after each impact at w.rng points within 80, r45, 50% each, Burn add 50%; deterministic per seed
  const mk = (seed) => {
    const s = stage({ p_s2: 1, p_s2_a: 2 }, 0, seed), { w, p } = s;
    for (let i = 0; i < 40; i++) { const a = i * 2.4, d = 20 + (i % 8) * 9; foe(w, p.x + 200 + Math.cos(a) * d, p.y + Math.sin(a) * d); }
    const zs = [], z0 = w.addZone;
    w.addZone = function (z) { if (z.kind === 'meteor') zs.push({ x: Math.round(z.x * 100) / 100, y: Math.round(z.y * 100) / 100, r: z.r, dur: z.dur, t: Math.round(w.time * 100) / 100 }); return z0.call(this, z); };
    cast(s, 1, p.x + 200, p.y); run(s, 2.2);
    return { s, zs };
  };
  const { s, zs } = mk(7), rocks = zs.filter(z => z.r < 60), im = parts(s, 'meteor.impact'), rk = parts(s, 'meteor.rocks');
  ok(rocks.length === 6, `3 meteorites for the impact and 3 for the twin (got ${rocks.length})`);
  ok(rocks.slice(0, 3).every(z => Math.hypot(z.x - zs[0].x, z.y - zs[0].y) <= 80.01 && Math.abs(z.dur - 0.3) < 1e-9), 'meteorites fall within 80 of the impact, 0.3 s after it');
  ok(rk.length > 0 && im.length > 0, 'meteorites hit'); const per = ED.Stats.skillNums('meteor', s.p.stats); near(per.p.rocks.dmg, per.p.impact.dmg * 0.5, 1e-9, 'meteorite = 50% of the impact'); near(per.p.rocks.r, 45, 1e-9, 'meteorite radius 45');
  const e0 = im[0].e, r0 = rk.find(h => h.e === e0); ok(!r0 || Math.abs(r0.d / im[0].d - 0.5) < 1e-6, 'a meteorite deals 50% of an impact to the same foe');
  ok(JSON.stringify(zs) === JSON.stringify(mk(7).zs), 'meteorite points are deterministic per seed'); ok(JSON.stringify(zs) !== JSON.stringify(mk(8).zs), 'and differ between seeds');
  ok(s.adds.length > im.length, 'meteorites add Burn');
}

// ---- Comet: leap data, airborne flag, landing 0.6 s after the cast for +10% (+5% per rank) and the card's Meteor damage, Impact Crater stun, double knock and a crater that burns twice as hard ----
{
  const go = (boons) => { const s = stage(boons), e = foe(s.w, s.p.x + 150, s.p.y); cast(s, 1, s.p.x + 150, s.p.y); return { s, e }; };
  const base = go({ p_s2: 1 }); run(base.s, 1.2);
  const c1 = go({ p_s2: 1, p_s2_b: 1 }), w = c1.s.w, p = c1.s.p;
  near(p.cometT, 0.6, 1e-9, 'Comet: airborne 0.6 s'); ok(flags(w) & 512, 'airborne hero flag 1 << 9 on the wire'); ok(w.fx.some(ev => ev.t === 'pyComet'), 'Comet launch event');
  run(c1.s, 0.58); ok(parts(c1.s, 'meteor.impact').length === 0, 'no landing before 0.6 s'); run(c1.s, 0.1);
  const li = parts(c1.s, 'meteor.impact')[0], bi = parts(base.s, 'meteor.impact')[0];
  ok(li && bi, 'landing and meteor hit'); near(li.t, 0.6, 0.04, 'Comet lands 0.6 s after the cast'); near(bi.t, 0.9, 0.04, 'Meteor lands 0.9 s after the cast'); near(li.d / bi.d, 1.1 * 1.2, 1e-6, 'Comet landing +10% and the card Meteor damage +20%');
  ok(!(p.cometT > 0), 'airborne ends'); ok(!(flags(w) & 512), 'flag cleared');
  const r3 = go({ p_s2: 1, p_s2_b: 2 }), ec = foe(r3.s.w, r3.s.p.x + 150, r3.s.p.y + 30), boss = foe(r3.s.w, r3.s.p.x + 150, r3.s.p.y - 30); boss.boss = true;
  const rb = go({ p_s2: 1, p_s2_b: 1 }); foe(rb.s.w, rb.s.p.x + 150, rb.s.p.y + 30);
  run(r3.s, 0.62); run(rb.s, 0.62);
  ok(r3.e.stun > 0 && ec.stun > 0, 'Impact Crater stuns foes 0.5 s'); near(r3.e.stun, 0.5, 0.05, 'stun duration'); ok(boss.stun === 0, 'bosses are not stunned'); ok(rb.e.stun === 0, 'no stun before rank 2');
  ok(r3.s.log.some(h => h.src.knock === 440) && rb.s.log.some(h => h.src.knock === 220), 'rank 2 doubles the knock-back');
  near(parts(r3.s, 'meteor.impact')[0].d / parts(base.s, 'meteor.impact')[0].d, 1.15 * 1.3, 1e-6, 'Comet rank 2 landing +15% and the card Meteor damage +30%');
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

// ---- White Heat: Burn +20% (+10% per rank), burning foes take +10% from skills, Flashpoint (rank 2) crits at Burn > 5% of max HP ----
{
  const s = stage({ p_el: 1, p_el_a: 1 }), { w, p } = s, e = foe(w, p.x + 60, p.y);
  e.burnPool = 100; e.burnOwner = p; e.burnTick = 0.01; e.burn = 1; run(s, 0.05);
  const dot = s.log.find(h => h.kind === 'dot'); near(dot.d, 20 * 1.2, 1e-6, 'Burn tick x1.2 (20% of the pool, +20%)');
  const hot = stage({ p_el: 1, p_el_a: 1 }), cold = stage({ p_el: 1, p_el_a: 1 });
  const eh = foe(hot.w, hot.p.x + 60, hot.p.y), ec = foe(cold.w, cold.p.x + 60, cold.p.y); eh.burnPool = 50; eh.burnOwner = hot.p;
  const dh = hot.w.hitEnemy(eh, 100, { p: hot.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }), dc = cold.w.hitEnemy(ec, 100, { p: cold.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' });
  const sd = hot.p.stats.dmg + 0.25; near(dh / dc, (sd + 0.1) / sd, 1e-6, 'burning foes take +10% from skills');
  const wk = hot.w.hitEnemy(eh, 100, { p: hot.p, kind: 'weapon', wpn: true, crit: false }), wc = cold.w.hitEnemy(ec, 100, { p: cold.p, kind: 'weapon', wpn: true, crit: false }); near(wk / wc, 1, 1e-6, 'the +10% is for skills only');
  const f = stage({ p_el: 1, p_el_a: 2 }), fe = foe(f.w, f.p.x + 60, f.p.y), src = { p: f.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' };
  fe.burnPool = 0.04 * fe.maxHp; fe.burnOwner = f.p; f.w.hitEnemy(fe, 10, src); ok(!src.critOut, 'no Flashpoint below 5% of max HP');
  const src2 = { p: f.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }; fe.burnPool = 0.06 * fe.maxHp; f.w.hitEnemy(fe, 10, src2); ok(src2.critOut, 'Flashpoint: Burn above 5% of max HP always crits');
  ok(f.w.fx.some(ev => ev.t === 'pyFlash'), 'Flashpoint event'); const src3 = { p: f.p, kind: 'weapon', wpn: true }; fe.burnPool = 0.5 * fe.maxHp; f.w.hitEnemy(fe, 10, src3); ok(!src3.critOut, 'Flashpoint is for Nova and Meteor only');
  const g = stage({ p_el: 1, p_el_a: 1 }), ge = foe(g.w, g.p.x + 60, g.p.y), src4 = { p: g.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }; ge.burnPool = 0.5 * ge.maxHp; g.w.hitEnemy(ge, 10, src4); ok(!src4.critOut, 'no Flashpoint at rank 1');
}

// ---- Heat Engine: each burning foe a cast hits cuts 0.15 s from the other skill (at most 1.5 s per cast); Chain Reaction (rank 2) at 2 burning foes refunds it in full once per 6 s ----
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
  s = mk({ p_el: 1, p_el_b: 2 }, 1, 0); cast(s, 0, 0, 0); near(refunds(s.w)[0].s, 0.2, 1e-9, 'rank 2: 0.2 s per foe');
  s = mk({ p_el: 1, p_el_b: 2 }, 2, 0); cast(s, 0, 0, 0); r = refunds(s.w); ok(r.length === 1 && r[0].s === undefined && r[0].slot === 1, 'Chain Reaction: 2 burning foes refund Meteor in full'); near(s.p.heatT, 6, 1e-9, 'Chain Reaction cooldown 6 s');
  s.w.msgs.length = 0; cast(s, 0, 0, 0); r = refunds(s.w); ok(r.length === 1 && r[0].s !== undefined, 'a second chain inside 6 s only cuts the cooldown');
  s.p.heatT = 0; s.w.msgs.length = 0; cast(s, 0, 0, 0); r = refunds(s.w); ok(r.length === 1 && r[0].s === undefined, 'Chain Reaction is ready again after 6 s');
  s = mk({ p_el: 1, p_el_b: 2 }, 1, 0); cast(s, 0, 0, 0); ok(refunds(s.w)[0].s !== undefined, '1 burning foe: a partial cut only'); s = mk({ p_el: 1, p_el_b: 1 }, 4, 0); cast(s, 0, 0, 0); ok(refunds(s.w)[0].s !== undefined, 'rank 1: 4 burning foes cut only, no Chain Reaction');
  s = mk({ p_el: 1, p_el_b: 1 }, 4, 0); const e0 = s.w.enemies[0]; cast(s, 1, e0.x, e0.y); ok(refunds(s.w).length === 0, 'Meteor: nothing at the cast'); run(s, 1.0); r = refunds(s.w); ok(r.length === 1 && r[0].slot === 0 && r[0].s > 0, 'Meteor impact cuts the Nova cooldown');
  s = mk({}, 4, 0); cast(s, 0, 0, 0); ok(refunds(s.w).length === 0, 'no refund without the card');
  { const dmgOf = (r) => { const q = stage({ p_el: 1, p_el_b: r }); foe(q.w, q.p.x + 60, q.p.y); cast(q, 0, 0, 0); return parts(q, 'nova.blast')[0].d; }; near(dmgOf(2) / dmgOf(1), 1.3, 1e-6, 'Heat Engine rank 2: the Nova deals +30%'); near(dmgOf(3) / dmgOf(2), 1, 1e-6, 'rank 3 adds no more to the plain Nova'); }
}

// ---- fodder contract: horde foes never feed a shield or a refund ----
{
  const s = stage({ p_s1: 1, p_s1_b: 1 }), e = foe(s.w, s.p.x + 70, s.p.y); e.fodder = true; cast(s, 0, 0, 0); near(s.p.shield, 0, 1e-9, 'Mantle: a Nova that only hit horde foes shields nobody'); near(s.p.mantleT, 0, 1e-9, 'and starts no Mantle cooldown'); ok(parts(s, 'nova.blast').length === 1, 'the horde foe was still struck');
  const h = stage({ p_el: 1, p_el_b: 1 }); for (let i = 0; i < 4; i++) { const f = foe(h.w, h.p.x + 30 + i * 5, h.p.y - 10 + i * 6); f.burnPool = 60; f.burnOwner = h.p; f.burnTick = 99; f.burn = 1; f.fodder = i < 3; } h.w.msgs.length = 0; cast(h, 0, 0, 0);
  const rf = h.w.msgs.filter(m => m.t === 'refund'); ok(rf.length === 1 && Math.abs(rf[0].s - 0.15) < 1e-9, 'Heat Engine counts the one burning foe that is not a horde foe (0.15 s of 4 burning foes)');
}

// ================= skill forms: rank 2 keeps the old rider, rank 3 is the transform =================
const hurt = (w, p) => { p.invuln = 0; return w.hurtPlayer(p, 1, { hazard: true }); };
{ // card text and totals of the four skill forks
  const FORKS = { p_s1_a: ['Twin Nova', 'Collapse', 'Supernova'], p_s1_b: ['Phoenix Mantle', 'Rebirth Flare', 'Phoenix Form'], p_s2_a: ['Twin Meteor', 'Meteor Shower', 'Cataclysm'], p_s2_b: ['Comet', 'Impact Crater', 'Sun Dive'] };
  for (const id in FORKS) {
    const [name, rider, form] = FORKS[id], b = ED.BOONS[id], P = [1, 2, 3].map(r => ED.cardParts(id, r, null));
    ok(!b.rider && b.rider2 && b.r2 && b.form && b.r3 && b.form.name === form, id + ' keeps its rider in rider2/r2 and its transform in form/r3');
    ok(P[0].rider2 === '' && P[1].rider2Name === rider && P[1].rider2 !== '' && P[2].rider2 !== '', id + ' rider ' + rider + ' from rank 2');
    ok(!P[0].form && !P[1].form && P[2].form && P[2].form.name === form && P[2].form.desc.length > 40 && !/[{}\[\]]/.test(P[2].form.desc + P[2].text), id + ' transform ' + form + ' only at rank 3');
    ok(ED.cardName(id, 1) === name && ED.cardName(id, 2) === name && ED.cardName(id, 3) === form, id + ' card name: ' + name + ' then ' + form);
    ok(ED.boonText(id, 2, null).indexOf(form) < 0 && ED.boonText(id, 3, null).indexOf(form + ':') >= 0, id + ' card text names the transform only at rank 3');
    const t1 = ED.cardTotals(b, 1), t2 = ED.cardTotals(b, 2), t3 = ED.cardTotals(b, 3);
    for (const k in b.r2) ok(!t1[k] && t2[k] > 0 && t3[k] > 0, id + ' stat ' + k + ' (rank 2 rider)');
    for (const k in b.r3) ok(t3[k] > 0 && (k in b.mods || k in (b.up || {}) ? t3[k] > t2[k] : !t2[k] && !t1[k]), id + ' stat ' + k + ' (rank 3 transform)');
  }
  const tt = (id, r) => ED.cardTotals(ED.BOONS[id], r), tx = (id) => ED.cardParts(id, 3, null).form.desc;
  near(tt('p_s1_a', 3).novaEcho, 1.55, 1e-9, 'Supernova wave 155% of the Nova'); near(tt('p_s1_a', 3).supernova, 1.2, 1e-9, 'Supernova Burn x1.2'); near(tt('p_s1_a', 3).supernovaPull, 30, 1e-9, 'Supernova collapse 30 px'); near(tt('p_s1_a', 3).novaPull, 40, 1e-9, 'Collapse stays at rank 3');
  near(tt('p_s1_b', 3).phoenixMul, 1.4, 1e-9, 'Phoenix Form ring x1.4'); near(tt('p_s1_b', 3).phoenixSlow, 0.4, 1e-9, 'Phoenix Form slows 40%'); near(tt('p_s1_b', 2).phoenixSlow || 0, 0, 1e-9, 'no slow before rank 3'); near(tt('p_s1_b', 3).phoenixDur, 4, 1e-9, 'Phoenix Form 4 s'); near(tt('p_s1_b', 3).dashTrail, 0.5, 1e-9, 'Phoenix trail 50% of the ring'); near(tt('p_s1_b', 3).mantle, 0.03, 1e-9, 'Phoenix Form adds no shield (3% stays)'); near(tt('p_s1_b', 3).mantleBurst, 0.5, 1e-9, 'Rebirth Flare stays at rank 3');
  near(tt('p_s2_a', 3).cataclysm, 0.5, 1e-9, 'Cataclysm meteor 50%'); near(tt('p_s2_a', 3).meteorites, 0.5, 1e-9, 'Meteor Shower stays in the totals');
  near(tt('p_s2_b', 3).sunDive, 0.6, 1e-9, 'Sun Dive second landing 60% of the first'); near(tt('p_s2_b', 3).diveTrail, 0.3, 1e-9, 'Sun Dive trail 30% of the crater'); near(tt('p_s2_b', 2).craterMul, 2, 1e-9, 'Impact Crater burns twice as hard from rank 2'); near(tt('p_s2_b', 1).craterMul || 0, 0, 1e-9, 'no hotter crater at rank 1');
  { const s = ED.Stats.compute({ cls: 'pyro', weapon: 'firestaff', boons: { p_s2: 1, p_s2_b: 2 }, relics: [], meta: META(), pact: 0 }), hot = ED.Stats.skillNums('meteor', s).p.crater.dmg; s.sn = {}; s.craterMul = 0; near(hot / ED.Stats.skillNums('meteor', s).p.crater.dmg, 2, 1e-9, 'the Comet crater burns twice as hard from rank 2'); }
  ok(tx('p_s1_a').indexOf('155%') >= 0 && tx('p_s1_a').indexOf('30 px') >= 0 && tx('p_s1_b').indexOf('4 s') >= 0 && tx('p_s1_b').indexOf('slowed 40%') >= 0 && tx('p_s2_a').indexOf('50%') >= 0 && tx('p_s2_b').indexOf('60% of the first') >= 0, 'form texts carry their numbers');
}

{ // Supernova (p_s1_a rank 3): the echo is a wave from the Nova's radius (105) to 220 over 0.5 s at 155%; the centre then collapses 30 px; the Nova's Burn is x1.2; rank 2 keeps the plain echo
  const go = (boons, mod) => {
    const s = stage(boons), { w, p } = s;
    p.x = 64; p.y = 176; // room for 245 px to the right
    const A = foe(w, p.x + 60, p.y), B = foe(w, p.x + 150, p.y + 4), Cc = foe(w, p.x + 215, p.y - 4), D = foe(w, p.x + 245, p.y), boss = foe(w, p.x + 150, p.y - 70), el = foe(w, p.x + 10, p.y + 130);
    boss.boss = true; el.elite = 'swift'; if (mod) mod(w, p, [A, B, Cc, D]);
    const at = [A, B, Cc, D, boss, el].map(e => ({ d: Math.hypot(e.x - p.x, e.y - p.y) }));
    cast(s, 0, 0, 0); run(s, 1.5);
    [A, B, Cc, D, boss, el].forEach((e, i) => { at[i].d1 = Math.hypot(e.x - p.x, e.y - p.y); });
    return { s, A, B, Cc, D, boss, el, at };
  };
  const r3 = go({ p_s1_a: 3 }), r2 = go({ p_s1_a: 2 }), N3 = ED.Stats.skillNums('nova', r3.s.p.stats);
  const wv = parts(r3.s, 'nova.wave'), bl = parts(r3.s, 'nova.blast'), ofE = (s, e, part) => parts(s, part).filter(h => h.e === e);
  near(N3.p.wave.r, 220, 1e-9, 'wave radius 220'); near(N3.p.blast.r, 105, 1e-9, 'Nova radius 105 (the wave starts there)'); near(N3.p.wave.dur, 0.5, 1e-9, 'wave lasts 0.5 s'); ok(N3.p.wave.on && !N3.p.echo.on, 'the wave part replaces the echo part at rank 3');
  ok(!parts(r2.s, 'nova.wave').length && parts(r2.s, 'nova.echo').length > 0, 'rank 2 keeps the plain echo and has no wave');
  near(N3.p.wave.dmg, N3.p.blast.dmg * 1.55, 1e-9, 'wave part = 155% of the blast'); near(N3.p.burn.dmg, 1.2 * ED.Stats.skillNums('nova', r2.s.p.stats).p.burn.dmg, 1e-6, 'the Nova Burn add is x1.2');
  ok(ofE(r3.s, r3.A, 'nova.blast').length === 1 && ofE(r3.s, r3.A, 'nova.wave').length === 1, 'a foe inside the Nova is struck by the blast and by the wave once');
  const wa = ofE(r3.s, r3.A, 'nova.wave')[0], wb = ofE(r3.s, r3.B, 'nova.wave')[0], wc = ofE(r3.s, r3.Cc, 'nova.wave')[0];
  near(wa.d, bl[0].d * 1.55, 1e-6, 'wave hit = 155% of the blast hit'); ok(wa.t >= 0.59 && wa.t < 0.63, `the wave starts 0.6 s after the cast (${wa.t.toFixed(2)})`);
  ok(wb && wc && wb.t > wa.t + 0.1 && wc.t > wb.t + 0.1 && wc.t < 1.15, `the front reaches farther foes later (${wa.t.toFixed(2)} ${wb && wb.t.toFixed(2)} ${wc && wc.t.toFixed(2)})`);
  near(wb.t, 0.6 + (150 - 10 - 105) / 115 * 0.5, 0.04, 'the foe at 150 is struck when the front passes it'); near(wc.t, 0.6 + (215 - 10 - 105) / 115 * 0.5, 0.04, 'the foe at 215 too');
  ok(!ofE(r3.s, r3.D, 'nova.wave').length, 'a foe at 245 is out of the wave'); ok(wv.length === 5, `wave hits: 4 foes + the boss... got ${wv.length}`);
  ok(ofE(r3.s, r3.boss, 'nova.wave').length === 1 && ofE(r3.s, r3.el, 'nova.wave').length === 1, 'the boss and the elite are struck by the wave once each');
  const d1 = (r, e) => r.at[[r.A, r.B, r.Cc, r.D, r.boss, r.el].indexOf(e)];
  near(d1(r3, r3.B).d - d1(r3, r3.B).d1, 30, 5, `the collapse pulls a foe 30 px (moved ${(d1(r3, r3.B).d - d1(r3, r3.B).d1).toFixed(1)})`); near(d1(r3, r3.Cc).d - d1(r3, r3.Cc).d1, 30, 5, 'the far foe too');
  ok(Math.abs(d1(r3, r3.boss).d - d1(r3, r3.boss).d1) < 1, 'a boss is not pulled'); ok(Math.abs(d1(r3, r3.D).d - d1(r3, r3.D).d1) < 1, 'a foe outside the wave is not pulled');
  ok(d1(r3, r3.el).d - d1(r3, r3.el).d1 > 5 && d1(r3, r3.el).d - d1(r3, r3.el).d1 < 30 * 0.45 + 6, 'an elite is pulled less');
  const ev = evOf(r3.s, 'pyWave'); ok(ev.length === 1 && ev[0].r0 === 105 && ev[0].r1 === 220 && ev[0].d === 0.5, 'wave event for the viewer'); ok(evOf(r3.s, 'pyPull').some(x => x.px === 30), 'collapse event at the end of the wave');
  // Burn: the Nova adds the x1.2 Burn and the wave adds 155% of it (rank 3)
  const burnOf = (r, e) => r.s.adds.filter(a => a.e === e).map(a => a.amount);
  const bA = burnOf(r3, r3.A), bA2 = burnOf(r2, r2.A);
  ok(bA.length === 2 && bA2.length === 2, 'Burn adds from the Nova and from the second eruption'); near(bA[0] / bA2[0], 1.2, 1e-6, 'the Nova Burn is x1.2'); near(bA[1] / bA[0], 1.55, 1e-6, 'the wave adds 155% of the Nova Burn');
  ok(burnOf(r3, r3.B).length === 1, 'a foe the wave alone reaches gets the wave Burn');
  // the wave keeps its centre when the hero walks off, hits horde foes, and does not follow the hero into another room
  { const s = stage({ p_s1_a: 3 }), { w, p } = s, e = foe(w, p.x + 160, p.y), f = foe(w, p.x + 140, p.y + 10); f.fodder = true; cast(s, 0, 0, 0); run(s, 0.65); p.x -= 140; run(s, 0.6); ok(e.hp < 5000 && f.hp < 5000 && Math.hypot(e.x - p.x, e.y - p.y) > 230, 'the wave is centred where the hero stood (not on the hero that walked off) and strikes horde foes'); }
  { const s = stage({ p_s1_a: 3 }), { w, p } = s, e = foe(w, p.x + 160, p.y); cast(s, 0, 0, 0); run(s, 0.65); ok(p.waves.length === 1, 'a wave is running'); p.waves[0].room = {}; run(s, 0.7); ok(!p.waves.length && !parts(s, 'nova.wave').some(h => h.e === e && h.t > 0.7), 'a wave does not follow the hero into another room'); }
}

{ // Phoenix Form (p_s1_b rank 3): the ring of fire follows the hero (r70, 4 s, x1.4, slows the foes inside 40%), dashes leave trail patches (r24, 2 s, 50% of the ring dps) while it burns; the shield stays 3%
  const s = stage({ p_s1_b: 3 }), { w, p } = s, N = ED.Stats.skillNums('nova', p.stats), s2 = stage({ p_s1_b: 2 });
  const e = foe(w, p.x + 200, p.y);
  cast(s, 0, 0, 0); cast(s2, 0, 0, 0);
  const ring = w.zones.filter(z => z.kind === 'pfire' && z.w === C.PHOENIX_TAG), old = s2.w.zones.filter(z => z.kind === 'pfire' && z.w !== C.PHOENIX_TAG);
  ok(ring.length === 1 && w.zones.filter(z => z.kind === 'pfire').length === 1, 'Phoenix Form: one ring, no plain ring of fire'); const z0 = ring[0];
  near(z0.r, 70, 1e-6, 'ring radius 70'); near(z0.dur, 4, 1e-9, 'ring lasts 4 s'); near(z0.dps, 1.4 * N.p.ring.dmg, 1e-6, 'ring burns 1.4 times as hard as the plain ring (same card rank)'); ok(z0.follow === 'p0' && z0.clsEl === 'fire', 'the ring follows its owner and is class Fire');
  near(N.p.phoenix.r, 70, 1e-9, 'phoenix part radius'); near(N.p.phoenix.dur, 4, 1e-9, 'phoenix part duration'); ok(N.p.trail.on && !N.p.ring.on, 'the phoenix part replaces the ring part');
  ok(old.length === 1 && Math.abs(old[0].dur - 3) < 1e-9 && !old[0].follow, 'rank 2 keeps the plain static ring (3 s)');
  near(p.shield, 0, 1e-9, 'no foe in the Nova: no shield'); { const q = stage({ p_s1: 1, p_s1_b: 3 }); foe(q.w, q.p.x + 70, q.p.y); cast(q, 0, 0, 0); near(q.p.shield, 0.03 * q.p.maxHp, 1e-6, 'the Mantle shield stays 3% (the class window)'); }
  p.x += 200; run(s, 0.1); near(z0.x, p.x, 1e-6, 'the ring moves with the hero'); near(z0.y, p.y, 1e-6, 'and keeps its height');
  const d0 = s.log.filter(h => h.kind === 'dot').length; run(s, 0.6); ok(s.log.filter(h => h.kind === 'dot').length > d0 && e.hp < 5000, 'the moved ring burns the foe it now overlaps');
  // the trail: a dash lays patches every 20 px while the ring burns
  const dash = (q, secs) => { const hero = q.p; hero.dashT = 0.17; hero.dashDx = 1; hero.dashDy = 0; q.w.playerDash(hero, 1, 0); for (let i = 0; i < Math.round(secs * 60); i++) { ED.Sim.movePlayer(hero, { mx: 0, my: 0 }, 1 / 60, q.w.room, q.w.locked, q.w.zones); q.w.update(1 / 60); q.w.fx.length = 0; } };
  const patches = (q) => q.w.zones.filter(z => z.kind === 'pfire' && z.w !== C.PHOENIX_TAG && Math.abs(z.r - 24) < 0.01);
  const t3 = stage({ p_s1_b: 3 }); cast(t3, 0, 0, 0); t3.w.zones.length = 1; dash(t3, 0.3);
  const pt = patches(t3); ok(pt.length >= 3 && pt.length <= 6, `a dash leaves a trail of r24 patches (${pt.length})`);
  ok(pt.every(z => Math.abs(z.dur - 2) < 1e-9 && Math.abs(z.dps - 0.5 * N.p.phoenix.dmg) < 1e-6 && z.clsEl === 'fire' && z.owner === 'p0'), 'patches: 2 s, 50% of the ring dps, class Fire');
  ok(pt.every((z, i) => i === 0 || Math.hypot(z.x - pt[i - 1].x, z.y - pt[i - 1].y) >= 19), 'patches are 20 px apart');
  near(Math.abs(pt[pt.length - 1].x - pt[0].x), 20 * (pt.length - 1), 25, 'the patches follow the dash path');
  const n2 = stage({ p_s1_b: 2 }); cast(n2, 0, 0, 0); n2.w.zones.length = 1; dash(n2, 0.3); ok(!patches(n2).length, 'rank 2: no trail');
  const n3 = stage({ p_s1_b: 3 }); dash(n3, 0.3); ok(!patches(n3).length, 'no trail before a Nova');
  const t4 = stage({ p_s1_b: 3 }); cast(t4, 0, 0, 0); run(t4, 4.3); t4.w.zones.length = 0; dash(t4, 0.3); ok(!patches(t4).length, 'no trail once the ring has burned out (4 s)');
  // a second Nova inside the ring's life renews it instead of adding a second ring
  const t5 = stage({ p_s1_b: 3 }); cast(t5, 0, 0, 0); run(t5, 2); cast(t5, 0, 0, 0); ok(t5.w.zones.filter(z => z.w === C.PHOENIX_TAG).length === 1 && t5.w.zones.find(z => z.w === C.PHOENIX_TAG).t === 0, 'a second Nova renews the ring');
  ok(evOf(t5, 'pyPhoenix').length + t5.w.fx.filter(ev => ev.t === 'pyPhoenix').length === 1, 'renewing the ring announces no second one');
  { // the foes inside the ring are slowed 40% (bosses 20%), the ones outside and every foe at rank 2 are not
    const q = stage({ p_s1_b: 3 }), inF = foe(q.w, q.p.x + 40, q.p.y), bs = foe(q.w, q.p.x - 40, q.p.y), far = foe(q.w, q.p.x + 160, q.p.y); bs.boss = true; cast(q, 0, 0, 0); run(q, 0.1);
    near(inF.slowAmt, 0.4, 1e-9, 'Phoenix Form slows a foe inside the ring 40%'); near(bs.slowAmt, 0.2, 1e-9, 'a boss half as much'); ok(!(far.slowAmt > 0), 'a foe outside the ring is not slowed');
    const r2 = stage({ p_s1_b: 2 }), f2 = foe(r2.w, r2.p.x + 40, r2.p.y); cast(r2, 0, 0, 0); run(r2, 0.1); ok(!(f2.slowAmt > 0), 'rank 2: no slow');
    run(q, 4.3); ok(q.p.phoenixT <= 0, 'the ring burns out after 4 s'); inF.slowAmt = 0; inF.slowT = 0; run(q, 0.2); ok(!(inF.slowAmt > 0), 'and the slow ends with it');
  }
}

{ // Cataclysm (p_s2_a rank 3): five meteors (the cursor point and four around it at 80 px, 0.1 s apart, 50% each), one lava field r140 for the crater duration; rank 2 keeps the twin and the shower
  const go = (boons, mod) => {
    const s = stage(boons), { w, p } = s, cx = p.x + 200, cy = p.y;
    const mid = foe(w, cx, cy), flank = [0, 1, 2, 3].map(k => foe(w, cx + Math.cos(k * Math.PI / 2) * 80, cy + Math.sin(k * Math.PI / 2) * 80)), inF = foe(w, cx + 130, cy + 60), outF = foe(w, cx + 100, cy + 150);
    if (mod) mod(w, p, mid);
    cast(s, 1, cx, cy); run(s, 1.5);
    return { s, w, p, mid, flank, inF, outF, cx, cy };
  };
  const r3 = go({ p_s2_a: 3 }), r2 = go({ p_s2_a: 2 }), N = ED.Stats.skillNums('meteor', r3.p.stats), sm = parts(r3.s, 'meteor.storm').filter(h => h.e === r3.mid);
  near(N.p.storm.dmg, 0.5 * N.p.impact.dmg, 1e-9, 'storm part = 50% of an impact'); ok(N.p.storm.on && !N.p.impact.on && !N.p.crater.on && !N.p.twin.on && !N.p.rocks.on && N.p.field.on, 'Cataclysm turns the single impact, crater, twin and shower parts off'); near(N.p.field.r, 140, 1e-9, 'field radius 140'); near(N.p.field.dmg, N.p.crater.dmg, 1e-9, 'field dps = the crater dps'); near(N.p.field.dur, N.p.crater.dur, 1e-9, 'field lasts the crater duration');
  const pm = stage({}); foe(pm.w, pm.p.x + 200, pm.p.y); cast(pm, 1, pm.p.x + 200, pm.p.y); run(pm, 1.2); const im0 = parts(pm, 'meteor.impact')[0].d;
  ok(sm.length === 5, `the foe at the cursor is struck by all five meteors (${sm.length})`); ok(sm.every(h => Math.abs(h.d / im0 - 0.5 * 1.45) < 1e-6), `each meteor deals 50% of a plain Meteor impact plus the card Meteor damage +45% (${sm.map(h => (h.d / im0).toFixed(3)).join(' ')})`);
  ok(sm.every((h, i) => i === 0 || Math.abs(h.t - sm[i - 1].t - 0.1) < 0.03) && Math.abs(sm[0].t - 0.9) < 0.03, `0.1 s apart, the first after 0.9 s (${sm.map(h => h.t.toFixed(2)).join(' ')})`);
  ok(!parts(r3.s, 'meteor.impact').length && !parts(r3.s, 'meteor.twin').length && !parts(r3.s, 'meteor.rocks').length, 'no single impact, twin or meteorite at rank 3');
  ok(r3.flank.every(e => parts(r3.s, 'meteor.storm').some(h => h.e === e)), 'a foe on each of the four outer meteors is hit');
  ok(parts(r2.s, 'meteor.impact').length > 0 && parts(r2.s, 'meteor.twin').length > 0 && !parts(r2.s, 'meteor.storm').length && !r2.w.zones.some(z => z.w === C.LAVA_TAG), 'rank 2: impact, twin and shower, no storm and no field');
  const ev = evOf(r3.s, 'pyStorm'); ok(ev.length === 1 && evOf(r3.s, 'boom').filter(b => b.k === 'bigfire').length === 5, 'a storm event and five impacts');
  const fz = r3.w.zones.filter(z => z.w === C.LAVA_TAG); ok(fz.length === 1 && Math.abs(fz[0].r - 140) < 1e-6 && fz[0].kind === 'pfire' && fz[0].clsEl === 'fire' && Math.abs(fz[0].x - r3.cx) < 0.01 && !fz[0].lava, 'one lava field of radius 140 where the cursor point was (not a Lava Pool)');
  ok(!r3.w.zones.some(z => z.kind === 'pfire' && z.w !== C.LAVA_TAG), 'no separate craters'); ok(evOf(r3.s, 'pyField').length === 1, 'a field event');
  near(fz[0].dur, N.p.field.dur, 1e-9, 'field duration'); near(fz[0].dps, N.p.field.dmg, 1e-9, 'field dps');
  run(r3.s, 3.2); ok(!r3.w.zones.some(z => z.w === C.LAVA_TAG), 'the field ends with the crater duration');
  { // the field burns foes inside 140 and not outside
    const q = go({ p_s2_a: 3 }), a = q.inF, b = q.outF; run(q.s, 1.5); ok(q.s.log.some(h => h.kind === 'dot' && h.e === a) && !q.s.log.some(h => h.kind === 'dot' && h.e === b), 'the field burns a foe at 143 and spares one at 180');
  }
  // Burn adds: half of each meteor's hit, five per foe struck by all five
  ok(r3.s.adds.filter(a => a.e === r3.mid).length === 5, 'five Burn adds on the foe at the cursor');
  // determinism: no random draws (the same cast twice gives the same hits)
  const again = go({ p_s2_a: 3 }); ok(JSON.stringify(parts(again.s, 'meteor.storm').map(h => [Math.round(h.d * 100), h.t])) === JSON.stringify(parts(r3.s, 'meteor.storm').map(h => [Math.round(h.d * 100), h.t])), 'deterministic');
  { // Heat Engine: one cooldown cut for the whole cast, from the foes that burned before the first meteor
    const q = go({ p_s2_a: 3, p_el: 1, p_el_b: 1 }, (w, p, mid) => { for (const e of w.enemies) { e.burnPool = 60; e.burnOwner = p; e.burnTick = 99; e.burn = 1; } }); // all 8 foes burn
    const rf = q.w.msgs.filter(m => m.t === 'refund'); ok(rf.length === 1 && rf[0].slot === 0, `Heat Engine: one refund for the five meteors (${rf.length})`);
  }
  { // the four outer meteors wait in the hero's queue and drop with their room; the field needs all five
    const q = stage({ p_s2_a: 3 }), e = foe(q.w, q.p.x + 200, q.p.y); cast(q, 1, q.p.x + 200, q.p.y);
    ok(q.p.pyroQ.filter(en => en.k === 'storm').length === 4, 'four meteors wait in the queue'); for (const en of q.p.pyroQ) en.room = {};
    run(q, 1.6); ok(parts(q, 'meteor.storm').length === 1 && parts(q, 'meteor.storm')[0].e === e && !q.w.zones.some(z => z.w === C.LAVA_TAG), 'queued meteors drop with their room: one lands, no field');
  }
  { // a wall behind an outer meteor's spot moves that meteor onto the cursor point
    const q = stage({ p_s2_a: 3 }); q.p.x = 64; q.p.y = 70; const tgt = { x: q.p.x + 60, y: q.p.y }; // 70 px from the room's top wall: the outer meteor on the upper side falls in the wall
    cast(q, 1, tgt.x, tgt.y); const spots = q.p.pyroQ.filter(en => en.k === 'storm').map(en => [Math.round(en.x), Math.round(en.y)]);
    ok(spots.length === 4 && spots.every(([x, y]) => Math.abs(Math.hypot(x - tgt.x, y - tgt.y) - 80) < 1 || (x === Math.round(tgt.x) && y === Math.round(tgt.y))), 'a blocked outer spot falls back to the cursor point: ' + JSON.stringify(spots));
  }
}

{ // Sun Dive (p_s2_b rank 3): untouchable for the whole leap and 0.6 s after each landing, a second leap 0.5 s after the landing toward the cursor landing at 60% of the first, a burning trail along both flights; rank 2 is the plain Comet with Impact Crater
  const mk = (boons, remote) => {
    const s = stage(boons), { w, p } = s; p.x = 70; p.y = 176; p.remote = !!remote; p.aimX = p.x + 260; p.aimY = p.y;
    const a = foe(w, p.x + 130, p.y), b = foe(w, p.x + 260, p.y);
    cast(s, 1, p.x + 130, p.y);
    const N = ED.Stats.skillNums('meteor', p.stats); if (!remote) p.skillMove = ED.leapMove(w.room, w.locked, p, p.x + 130, p.y, N.move); // the client's own cast starts the first leap
    return { s, w, p, a, b, N };
  };
  const fly = (t, secs, f) => run(t.s, secs, () => { ED.Sim.movePlayer(t.p, { mx: 0, my: 0 }, 1 / 60, t.w.room, t.w.locked, t.w.zones); t.sa = Math.max(t.sa || 0, t.a.stun); t.sb = Math.max(t.sb || 0, t.b.stun); if (f) f(); });
  const t3 = mk({ p_s2_b: 3 }), t2 = mk({ p_s2_b: 2 }), x0 = t3.p.x;
  ok(t3.N.move && t3.N.move.iframes === 0.6 && t3.N.move.t === 0.6 && t2.N.move.iframes === 0.35, 'Sun Dive is untouchable for the whole 0.6 s leap, the plain Comet for 0.35 s');
  near(t3.p.diveAt, t3.w.time + 0.6 + 0.5, 1e-6, 'the second leap is due 0.5 s after the landing'); ok(t2.p.diveAt === 0, 'rank 2 does not dive again');
  let safe3 = 0, safe2 = 0, tot = 0;
  fly(t3, 0.58, () => { tot++; if (t3.p.skillIfr) safe3++; }); fly(t2, 0.58, () => { if (t2.p.skillIfr) safe2++; });
  ok(safe3 >= 34 && safe2 <= 23 && safe2 >= 19, `untouchable ${safe3} of ${tot} ticks (Sun Dive) against ${safe2} (Comet)`);
  ok(hurt(t3.w, t3.p) === false, 'the hero cannot be hurt in the air'); ok(hurt(t2.w, t2.p) !== false, 'a Comet hero is exposed in the last part of the flight'); fly(t3, 0.04);
  near(t3.p.x - x0, 130, 12, `the first leap ends at the cursor point (moved ${(t3.p.x - x0).toFixed(0)})`);
  const li = parts(t3.s, 'meteor.impact'), plain = stage({}); foe(plain.w, plain.p.x + 130, plain.p.y); cast(plain, 1, plain.p.x + 130, plain.p.y); run(plain, 1.2);
  ok(li.length === 1 && li[0].e === t3.a && Math.abs(li[0].t - 0.6) < 0.04, `the first landing at 0.6 s (${li.length})`); near(li[0].d / parts(plain, 'meteor.impact')[0].d, 1.2 * 1.4, 1e-6, 'landing +20% and the card Meteor damage +40%');
  ok(!t3.p.skillMove && !(t3.p.cometT > 0) && t3.p.diveAt > 0, 'landed, waiting to dive again');
  ok(t3.p.invuln > 0.45 && t3.p.invuln <= C.SUN_GRACE + 1e-9, `a landing leaves ${C.SUN_GRACE} s of grace (${t3.p.invuln.toFixed(2)})`); fly(t2, 0.1); ok(parts(t2.s, 'meteor.impact').length === 1 && !(t2.p.invuln > 0.2), 'the plain Comet lands and leaves none');
  fly(t3, 0.48); // the hero stands still until the second leap is due
  ok(t3.p.skillMove && t3.p.skillMove.t > 0.5 && Math.abs(t3.p.skillMove.speed * 0.6 - 130) < 14, `the second leap starts toward the cursor, 130 px away (${t3.p.skillMove && Math.round(t3.p.skillMove.speed * 0.6)} px)`);
  ok(t3.p.cometT > 0.5 && evOf(t3.s, 'pyComet').length === 2, 'airborne again with its own launch event');
  fly(t3, 0.7); const l2 = parts(t3.s, 'meteor.impact');
  ok(l2.length === 2 && l2[1].e === t3.b && Math.abs(l2[1].t - 1.7) < 0.05 && Math.abs(l2[1].d / l2[0].d - 0.6) < 0.01, `the second landing at 1.7 s on the foe at the cursor at 60% of the first (${l2.map(h => h.t.toFixed(2)).join(' ')})`);
  near(t3.p.x - x0, 260, 12, 'the hero ends at the cursor'); ok(t3.w.zones.filter(z => z.kind === 'pfire' && Math.abs(z.r - 60) < 0.01).length === 2, 'each landing leaves its crater');
  const tp = t3.w.zones.filter(z => z.kind === 'pfire' && Math.abs(z.r - 30) < 0.01 && z.dur === 2);
  ok(tp.length >= 8 && tp.every(z => Math.abs(z.dps - 0.3 * ED.Stats.skillNums('meteor', t3.p.stats).p.crater.dmg) < 1e-6 && z.clsEl === 'fire'), `a burning trail of r30 patches follows both flights (${tp.length})`);
  ok(tp.some(z => z.x < x0 + 120) && tp.some(z => z.x > x0 + 140), 'on both legs'); ok(t2.w.zones.filter(z => Math.abs(z.r - 30) < 0.01 && z.kind === 'pfire').length === 0, 'rank 2 leaves no trail');
  ok(t3.s.log.filter(h => h.part === 'meteor.impact' && h.src.knock === 440).length === 2, 'Impact Crater stays: both landings knock back twice as far'); ok(t3.sa > 0.4 && t3.sb > 0.4, `Impact Crater stuns at both landings (${t3.sa.toFixed(2)}, ${t3.sb.toFixed(2)})`);
  // a remote hero gets a leap message instead of a skillMove
  const rm = mk({ p_s2_b: 3 }, true); run(rm.s, 1.15); const lm = rm.w.msgs.filter(m => m.t === 'leap');
  ok(lm.length === 1 && lm[0].to === 'p0' && lm[0].d === 0.6 && lm[0].i === 0.6 && Math.abs(lm[0].x - (rm.p.x + 260)) < 1 && !rm.p.skillMove, 'a remote hero is sent the leap to start');
  // a room change cancels the dive; no cursor point falls back to the facing; a downed hero stays down
  const rc = mk({ p_s2_b: 3 }); rc.p.diveRoom = {}; fly(rc, 1.3); ok(!rc.p.skillMove && !rc.w.msgs.some(m => m.t === 'leap') && rc.p.diveAt === 0, 'no dive in another room');
  const fb = mk({ p_s2_b: 3 }); fb.p.aimX = undefined; fb.p.face = Math.PI / 2; fly(fb, 1.15); ok(fb.p.skillMove && Math.abs(fb.p.skillMove.dy) > 0.9, 'without a cursor point the dive follows the facing');
  const dn = mk({ p_s2_b: 3 }); dn.p.downed = true; fly(dn, 1.3); ok(!dn.p.skillMove, 'a downed hero does not dive');
}

// ================= Attack and Element forks: rank 2 rider, rank 3 transform =================
const evAll = (s, t) => s.evs.concat(s.w.fx).filter(e => e.t === t);
{ // card shape, names and text of the four forks
  const FORKS = { p_atk_h: ['Magma Heart', 'Lava Pools', 'Caldera', 'lavaPool', 'caldera'], p_atk_s: ['Ember Rush', 'Overheat', 'Fire Dancer', 'overheat', 'dancerBurst'], p_el_a: ['White Heat', 'Flashpoint', 'White Flame', 'burnCrit', 'whiteHot'], p_el_b: ['Heat Engine', 'Chain Reaction', 'Inferno Engine', 'heatChain', 'infernoMul'] };
  const pc = (v) => String(Math.round(v * 100)) + '%';
  for (const id in FORKS) {
    const [name, rider, form, k2, k3] = FORKS[id], b = ED.BOONS[id], P = [1, 2, 3].map(r => ED.cardParts(id, r, null));
    ok(!b.rider && b.rider2 && b.r2 && b.form && b.r3 && b.form.name === form && b.name === name, id + ' keeps its rider in rider2/r2 and its transform in form/r3');
    ok(b.r2[k2] > 0 && !(k2 in b.r3) && b.r3[k3] > 0 && !(k3 in b.r2), id + ': ' + k2 + ' is a rank 2 number, ' + k3 + ' a rank 3 number');
    ok(P[0].rider2 === '' && P[1].rider2Name === rider && P[1].rider2 !== '' && P[2].rider2 !== '' && !P[0].form && !P[1].form && P[2].form && P[2].form.name === form, id + ' rider ' + rider + ' from rank 2, form ' + form + ' at rank 3');
    ok(ED.cardName(id, 2) === name && ED.cardName(id, 3) === form, id + ' takes its form name at rank 3');
    ok(!/[{}]/.test(P[2].form.desc + P[2].rider2 + P[2].text), id + ' text has no unfilled token');
  }
  const t = (id, r) => ED.cardTotals(ED.BOONS[id], r);
  ok(ED.boonText('p_atk_h', 3, null).indexOf('geyser') >= 0 && ED.boonText('p_atk_h', 3, null).indexOf(pc(t('p_atk_h', 3).caldera) + ' of the shot') >= 0 && ED.boonText('p_atk_h', 3, null).indexOf(pc(t('p_atk_h', 3).lavaPool) + ' of the shot per second') >= 0, 'Caldera and Lava Pools print their numbers');
  ok(ED.boonText('p_atk_s', 3, null).indexOf(pc(t('p_atk_s', 3).dancerBurst) + ' weapon damage') >= 0, 'Fire Dancer prints its ring damage');
  ok(ED.boonText('p_el_a', 3, null).indexOf('burned for ' + t('p_el_a', 3).whiteT + ' s') >= 0 || ED.boonText('p_el_a', 3, null).indexOf('burning for ' + t('p_el_a', 3).whiteT + ' s') >= 0, 'White Flame prints its time');
  ok(ED.boonText('p_el_a', 3, null).indexOf('+' + pc(t('p_el_a', 3).whiteHot) + ' damage') >= 0 && ED.boonText('p_el_a', 3, null).indexOf(pc(t('p_el_a', 3).burnCrit) + ' of their health') >= 0, 'White Flame and Flashpoint print their numbers');
  ok(ED.boonText('p_el_b', 3, null).indexOf('up to ' + t('p_el_b', 3).heatMax + '.') >= 0 && ED.boonText('p_el_b', 3, null).indexOf('×' + t('p_el_b', 3).infernoMul + ' damage') >= 0 && ED.boonText('p_el_b', 3, null).indexOf(t('p_el_b', 3).heatChain + ' or more burning foes') >= 0, 'Inferno Engine and Chain Reaction print their numbers');
  ok(!ED.boonText('p_atk_h', 2, null).includes('geyser') && !ED.boonText('p_el_b', 2, null).includes('Heat'), 'rank 2 text has no transform');
  ok(!H.kill, 'the Pyromancer route holds no kill hook: a kill refunds, shields and raises nothing');
}

// ---- Caldera: an aftershock inside a live Lava Pool is a geyser (caldera x the shot, 1.5 x the radius, knock-back) that refreshes the pool and widens it 20% (at most 2 x) ----
{
  const mk = (rank) => { const s = stage({ p_atk: 1, p_atk_h: rank }, 0); s.p.moving = true; return s; };
  const after = (s, x, y) => { const p = s.p, shot = p.stats.weapon.dmg; p.pyroQ.push({ at: s.w.time + 0.01, k: 'after', x, y, r: 46, shot, dmg: shot * 0.6 * p.stats.aftershock, lava: shot * p.stats.lavaPool, room: s.w.room }); run(s, 0.05); };
  const s = mk(3), { w, p } = s, x = p.x + 100, y = p.y, shot = p.stats.weapon.dmg, e = foe(w, x + 10, y), far = foe(w, x + 60, y), boss = foe(w, x - 20, y), fd = foe(w, x, y + 20); boss.boss = true; fd.fodder = true;
  after(s, x, y);
  const pool = w.zones.find(z => z.lava), r0 = pool.r;
  ok(pool && Math.abs(r0 - 46 * 0.6) < 0.05 && Math.abs(pool.r0 - r0) < 1e-9 && parts(s, 'aftershock').length > 0 && parts(s, 'caldera').length === 0, 'the first aftershock is a plain one and plants the pool (r0 = its first radius)');
  const a0 = parts(s, 'aftershock').find(h => h.e === e); s.log.length = 0; s.evs.length = 0; w.fx.length = 0; e.kbx = e.kby = 0; boss.kbx = 0; e.hp = e.maxHp = 5000; fd.hp = fd.maxHp = 5000;
  const tb = pool.t; after(s, x + 8, y);
  const g = parts(s, 'caldera'), ge = g.find(h => h.e === e);
  ok(w.zones.filter(z => z.lava).length === 1, 'the geyser does not plant a second pool'); ok(parts(s, 'aftershock').length === 0, 'the aftershock is replaced by the geyser');
  near(ge.d / a0.d, 0.8 / (0.6 * p.stats.aftershock), 0.01, 'geyser = 80% of the shot (against the aftershock 60% x 50% of it)'); near(ge.d, shot * 0.8 * p.stats.dmg, 0.05, 'geyser damage = caldera x the shot x the hero multiplier');
  ok(g.some(h => h.e === far) && g.some(h => h.e === fd) && g.some(h => h.e === boss), 'the geyser reaches 1.5 x the blast radius (a foe 52 px away is struck, 46 would not) and horde foes');
  ok(a0 && g.every(h => h.src.knock === 200 && h.src.wpn && h.src.noProc), 'a weapon blast without infusions, knock 200');
  ok(e.kbx > 100 && boss.kbx === 0, 'foes are knocked back, bosses stay'); const gev = evAll(s, 'pyGeyser'); ok(gev.length === 1 && Math.abs(gev[0].r - 69) <= 1 && gev[0].pid === 'p0', 'pyGeyser event with the geyser radius');
  near(pool.r, r0 * 1.2, 1e-9, 'the pool grows 20%'); ok(pool.dur - pool.t <= C.LAVA_T + 1e-6 && pool.dur > pool.t + 1.9 && pool.t > tb, 'and refreshes to LAVA_T more seconds'); ok(Math.abs(gev[0].pr - pool.r) <= 1, 'the event carries the new pool radius');
  for (let i = 0; i < 6; i++) after(s, x + 8, y); near(pool.r, r0 * 2, 1e-9, 'the pool never grows past twice its first radius');
  // outside every pool the aftershock is plain; a hero below rank 3 never erupts
  s.log.length = 0; foe(w, x + 205, y); after(s, x + 200, y); ok(parts(s, 'aftershock').length === 1 && parts(s, 'caldera').length === 0 && w.zones.filter(z => z.lava).length === 2, 'an aftershock outside the pools is plain and plants a new pool');
  const r2 = mk(2); after(r2, r2.p.x + 100, r2.p.y); after(r2, r2.p.x + 104, r2.p.y); ok(parts(r2, 'caldera').length === 0 && r2.w.zones.filter(z => z.lava).length === 1 && r2.w.zones.find(z => z.lava).r === r2.w.zones.find(z => z.lava).r0, 'rank 2: the second aftershock is plain, the pool only refreshes');
  // a pool of another hero is not this hero's pool
  const o = mk(3); o.w.addZone({ kind: 'pfire', x: o.p.x + 100, y: o.p.y, r: 30, r0: 30, dur: 2, dps: 1, owner: 'ally', team: 0, untagged: true, lava: true, w: C.LAVA_TAG }); after(o, o.p.x + 100, o.p.y); ok(parts(o, 'caldera').length === 0, "another hero's pool does not turn this hero's aftershock into a geyser");
  // end to end: shots at one spot become geysers
  const t = mk(3), te = foe(t.w, t.p.x + 90, t.p.y); for (let i = 0; i < 4; i++) { te.x = t.p.x + 90; te.y = t.p.y; te.kbx = te.kby = 0; t.w.playerAttack(t.p, 0); run(t, 0.9, () => { te.kbx = te.kby = 0; te.x = t.p.x + 90; }); }
  ok(parts(t, 'caldera').length >= 1 && t.w.zones.filter(z => z.lava).length <= 2, `shots at one foe keep the pool alive and erupt as geysers (${parts(t, 'caldera').length})`);
}

// ---- Fire Dancer: Channel holds while moving (and stops building); a pause still ends it; a dash at full Channel leaves a ring of flame (r80, 2 x the weapon) where it began ----
{
  const mk = (rank) => { const s = stage({ p_atk: 1, p_atk_s: rank }, 0); s.p.moving = false; return s; };
  const atk = (s, moving, secs) => { s.p.moving = moving; s.p.lastAtkT = s.w.time; run(s, secs, () => { s.p.moving = moving; s.p.lastAtkT = s.w.time; }); };
  const d3 = mk(3), d2 = mk(2);
  atk(d3, false, 0.5); atk(d2, false, 0.5); const c3 = d3.p.chanT, c2 = d2.p.chanT; ok(c3 > 0.4 && c2 > 0.4, `Channel builds while standing (${c3.toFixed(2)})`);
  atk(d3, true, 0.5); atk(d2, true, 0.5);
  near(d3.p.chanT, c3, 1e-9, 'Fire Dancer: moving holds Channel (it stops building)'); near(d2.p.chanT, 0, 1e-9, 'rank 2: moving ends Channel');
  atk(d3, false, 0.3); near(d3.p.chanT, c3 + 0.3, 0.03, 'standing builds it again from where it was held');
  d3.p.moving = true; run(d3, 0.7, () => { d3.p.moving = true; }); near(d3.p.chanT, 0, 1e-9, 'a pause in attacking longer than the window ends it, moving or not');
  const hd = mk(3); hd.p.lastAtkT = hd.w.time; run(hd, ED.chanWindow(hd.p) - 0.05, () => { hd.p.moving = true; hd.p.chanT = 1; }); ok(hd.p.chanT === 1, 'inside the window a moving hero keeps its Channel');
  // the ring: only on the first tick of a dash, only at full Channel, where the dash began
  const ring = (rank, full) => {
    const s = mk(rank), { w, p } = s, near1 = foe(w, p.x + 60, p.y), edge = foe(w, p.x - 75, p.y), out = foe(w, p.x + 120, p.y), fd = foe(w, p.x, p.y - 50); fd.fodder = true;
    const x0 = p.x;
    p.lastAtkT = w.time; run(s, 0.05, () => { p.lastAtkT = w.time; p.moving = false; });
    p.chanT = full ? 9 : 0.2; p.dashT = 0.15; p.dashDx = 1; p.dashDy = 0;
    run(s, 0.2, () => { p.lastAtkT = w.time; p.chanT = full ? 9 : 0.2; if (p.dashT > 0) p.x += 8; });
    return { s, p, near1, edge, out, fd, hits: parts(s, 'dancer'), x0 };
  };
  const r3 = ring(3, true), st3 = r3.p.stats, want = st3.weapon.dmg * 2 * (st3.dmg + st3.chanCap);
  ok(r3.hits.length === 3 && r3.hits.some(h => h.e === r3.near1) && r3.hits.some(h => h.e === r3.edge) && r3.hits.some(h => h.e === r3.fd) && !r3.hits.some(h => h.e === r3.out), `the ring strikes foes within 80 of where the dash began, horde foes too (${r3.hits.length} hits)`);
  ok(r3.hits.every(h => Math.abs(h.d / want - 1) < 0.01), `each hit is 2 x the weapon damage with Channel at its cap (${r3.hits.map(h => h.d.toFixed(1)).join(', ')} vs ${want.toFixed(1)})`);
  const rev = evAll(r3.s, 'pyRing'); ok(rev.length === 1 && Math.abs(rev[0].x - r3.x0) <= 10 && rev[0].r === 80, `one ring event at the start of the dash (x ${rev[0] && rev[0].x} vs ${Math.round(r3.x0)})`);
  ok(ring(3, false).hits.length === 0, 'no ring below full Channel'); ok(ring(2, true).hits.length === 0, 'no ring at rank 2');
  { // one ring per dash; a second dash makes a second ring
    const s = mk(3), { w, p } = s; foe(w, p.x + 40, p.y); p.lastAtkT = w.time; run(s, 0.05, () => { p.lastAtkT = w.time; });
    for (let k = 0; k < 2; k++) { p.chanT = 9; p.dashT = 0.15; run(s, 0.3, () => { p.lastAtkT = w.time; p.chanT = 9; }); p.dashT = 0; run(s, 0.1, () => { p.lastAtkT = w.time; p.chanT = 9; }); }
    ok(evAll(s, 'pyRing').length === 2, 'each dash at full Channel rings once (' + evAll(s, 'pyRing').length + ')');
  }
  { // Overheat keeps working through moving at rank 3 (Channel stays full)
    const s = mk(3); s.p.chanT = 9; s.p.moving = true; s.p.lastAtkT = s.w.time; ok(H.attackOpts.call(s.w, s.p, s.p.stats).pierce === 1, 'Overheat is active while moving at full Channel (Fire Dancer)');
  }
}

// ---- White Flame: a foe burning WHITE_T s in a row takes +50% from every hero hit and meets Flashpoint for sure; a break starts it over; horde foes and rank 2 heroes are left out ----
{
  const mk = (rank) => stage({ p_el: 1, p_el_a: rank });
  const burn = (p, e) => { e.burnPool = 5; e.burnOwner = p; e.burnTick = 99; e.burn = 1; };
  const hitW = (s, e) => { s.p.invuln = 0; return s.w.hitEnemy(e, 100, { p: s.p, kind: 'weapon', wpn: true, crit: false }); };
  const s = mk(3), { w, p } = s, st = p.stats, e = foe(w, p.x + 60, p.y), cold = foe(w, p.x + 60, p.y + 50), fd = foe(w, p.x + 60, p.y - 50); fd.fodder = true;
  burn(p, e); burn(p, fd); run(s, 1.8, () => { burn(p, e); burn(p, fd); });
  const base = hitW(s, cold);
  near(hitW(s, e) / base, 1, 1e-9, 'a foe that burned 1.8 s is not white-hot yet');
  run(s, 0.4, () => { burn(p, e); burn(p, fd); });
  near(hitW(s, e) / base, (st.dmg + 0.5) / st.dmg, 1e-6, "after 2 s of burning it takes +50% from the hero's hits"); ok(Math.abs(hitW(s, fd) / base - 1) < 1e-9, 'horde foes are never white-hot');
  const sk = { p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }; e.burnPool = 0.01 * e.maxHp; w.hitEnemy(e, 10, sk); ok(sk.critOut, 'Flashpoint always counts a white-hot foe, however small its Burn pool');
  const sk2 = { p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }; cold.burnPool = 0.01 * cold.maxHp; cold.burnOwner = p; w.hitEnemy(cold, 10, sk2); ok(!sk2.critOut, 'a foe under the Flashpoint line that is not white-hot does not crit');
  e.burnPool = 0; e.burn = 0; run(s, 0.3); burn(p, e); run(s, 0.3, () => { burn(p, e); }); near(hitW(s, e) / base, 1, 1e-9, 'a break in the burning starts the time over');
  burn(p, e); e.wf[p.pid] = 5; e.burnPool = 0; near(hitW(s, e) / base, 1, 1e-9, 'a foe that is no longer burning takes no bonus');
  const r2 = mk(2), e2 = foe(r2.w, r2.p.x + 60, r2.p.y); burn(r2.p, e2); run(r2, 3, () => burn(r2.p, e2)); ok(e2.wf === undefined, 'rank 2 keeps no timers');
  const one = stage({ p_el: 1, p_el_a: 3 }), e3 = foe(one.w, one.p.x + 60, one.p.y); burn(one.p, e3); run(one, 2.2, () => burn(one.p, e3)); ok(e3.wf.p0 >= 2 && e3.wf.p1 === undefined, 'the timer is kept per hero');
}

// ---- Inferno Engine: burning foes (not horde foes) a Nova or Meteor hits store Heat (a boss 3) up to 4; at full Heat the next cast is an Inferno (r x1.4, x3 damage and Burn) and the Heat empties ----
{
  const mk = (boons) => stage(Object.assign({ p_el: 1, p_el_b: 3 }, boons));
  const lit = (p, e) => { e.burnPool = 60; e.burnOwner = p; e.burnTick = 99; e.burn = 1; return e; };
  const ctl = mk({}); foe(ctl.w, ctl.p.x + 70, ctl.p.y); cast(ctl, 0, 0, 0); const N = ED.Stats.skillNums('nova', ctl.p.stats), blast0 = parts(ctl, 'nova.blast')[0].d, burn0 = ctl.adds[0].amount;
  // storing
  let s = mk({}); for (let i = 0; i < 3; i++) lit(s.p, foe(s.w, s.p.x + 40 + i * 6, s.p.y + (i - 1) * 12)); for (let i = 0; i < 4; i++) lit(s.p, Object.assign(foe(s.w, s.p.x + 50 + i * 5, s.p.y + 40), { fodder: true }));
  cast(s, 0, 0, 0); near(s.p.heat, 3, 0, 'three burning foes store 3 Heat, burning horde foes none'); const ev1 = evAll(s, 'pyEng').filter(x => !x.go); ok(ev1.length === 1 && ev1[0].n === 3 && ev1[0].mx === 4 && ev1[0].pid === 'p0', 'a Heat event carries the count');
  for (const f of s.w.enemies) lit(s.p, f); cast(s, 0, 0, 0); near(s.p.heat, 4, 0, 'Heat stops at 4');
  const b = mk({}); const boss = foe(b.w, b.p.x + 60, b.p.y); boss.boss = true; lit(b.p, boss); cast(b, 0, 0, 0); near(b.p.heat, 3, 0, 'a burning boss stores 3 Heat');
  const cold = mk({}); foe(cold.w, cold.p.x + 60, cold.p.y); cast(cold, 0, 0, 0); near(cold.p.heat, 0, 0, 'foes that were not burning store nothing');
  const rk2 = mk({ p_el_b: 2 }); lit(rk2.p, foe(rk2.w, rk2.p.x + 60, rk2.p.y)); cast(rk2, 0, 0, 0); near(rk2.p.heat, 0, 0, 'rank 2 stores no Heat');
  // a Meteor impact stores Heat too
  const m0 = mk({}); for (let i = 0; i < 3; i++) lit(m0.p, foe(m0.w, m0.p.x + 200 + i * 8, m0.p.y)); cast(m0, 1, m0.p.x + 200, m0.p.y); near(m0.p.heat, 0, 0, 'nothing is stored at the Meteor cast'); run(m0, 1.2); near(m0.p.heat, 3, 0, 'the impact stores 3 Heat');
  // the Inferno Nova
  const f = mk({}); f.p.heat = 4; const near1 = foe(f.w, f.p.x + 70, f.p.y), edge = foe(f.w, f.p.x + N.p.blast.r * 1.25 + 4, f.p.y), edge0 = foe(f.w, f.p.x - (N.p.blast.r * 1.4 + 24), f.p.y);
  cast(f, 0, 0, 0);
  const bl = parts(f, 'nova.blast'); near(bl.find(h => h.e === near1).d / blast0, 3, 1e-6, 'the Inferno blast deals x3'); ok(bl.some(h => h.e === edge) && !bl.some(h => h.e === edge0), 'its radius is x1.4 (a foe beyond the plain radius is struck)');
  near(f.adds.find(a => a.e === near1).amount / burn0, 3, 1e-6, 'its Burn add is x3'); near(f.p.heat, 0, 0, 'the Heat empties'); const go = evAll(f, 'pyEng').filter(x => x.go === 1); ok(go.length === 1 && go[0].n === 0 && Math.abs(go[0].r - N.p.blast.r * 1.4) <= 1, 'the Inferno event carries its radius');
  f.log.length = 0; f.adds.length = 0; near1.hp = near1.maxHp = 5000; cast(f, 0, 0, 0); near(parts(f, 'nova.blast').find(h => h.e === near1).d / blast0, 1, 1e-6, 'the next Nova is plain again');
  // the Inferno Meteor
  const q = mk({}), q0 = mk({}); q.p.heat = 4;
  const mt = (s0) => { const a = foe(s0.w, s0.p.x + 200, s0.p.y), o = foe(s0.w, s0.p.x + 200 + 95 + 12 + 20, s0.p.y); cast(s0, 1, s0.p.x + 200, s0.p.y); const z = s0.w.zones.find(zz => zz.kind === 'meteor'), r = z.r; run(s0, 1.2); return { a, o, r, hit: parts(s0, 'meteor.impact') }; };
  const A = mt(q), B = mt(q0);
  near(A.r / B.r, 1.4, 1e-9, 'the Inferno Meteor falls x1.4 wider'); near(A.hit.find(h => h.e === A.a).d / B.hit.find(h => h.e === B.a).d, 3, 1e-6, 'and deals x3'); ok(A.hit.some(h => h.e === A.o) && !B.hit.some(h => h.e === B.o), 'a foe past the plain radius is struck by the Inferno only');
  ok(q.adds.length >= 1 && Math.abs(q.adds[0].amount / q0.adds[0].amount - 3) < 1e-6, 'its Burn add is x3'); near(q.p.heat, 0, 0, 'the Heat is spent at the cast'); ok(evAll(q, 'pyEng').filter(x => x.go === 1 && x.k === 1).length === 1 && evAll(q, 'pyEng').filter(x => x.go === 2).length === 1, 'a telegraph event at the cast and a landing event');
  // no Inferno below full Heat or without the form
  const h3 = mk({}); h3.p.heat = 3; foe(h3.w, h3.p.x + 70, h3.p.y); cast(h3, 0, 0, 0); near(parts(h3, 'nova.blast')[0].d / blast0, 1, 1e-6, 'Heat 3 of 4 is not an Inferno'); near(h3.p.heat, 3, 0, 'and is kept');
  const r2 = mk({ p_el_b: 2 }); r2.p.heat = 9; foe(r2.w, r2.p.x + 70, r2.p.y); cast(r2, 0, 0, 0); near(parts(r2, 'nova.blast')[0].d / blast0, 1, 1e-6, 'rank 2 has no Inferno');
  // the viewers' count is refreshed while Heat is stored
  const k = mk({}); k.p.heat = 2; k.p.heatPing = 0; run(k, 4.2); ok(evAll(k, 'pyEng').filter(x => !x.go && x.n === 2).length >= 2, 'a Heat event every 2 s while Heat is stored');
}

// ---- fodder audit of the route hooks: a burning horde foe feeds no Heat, refund, shield or stack; blasts still strike it ----
{
  const lit = (p, e) => { e.burnPool = 60; e.burnOwner = p; e.burnTick = 99; e.burn = 1; return e; };
  const s = stage({ p_el: 1, p_el_b: 3 }); for (let i = 0; i < 6; i++) { const f = foe(s.w, s.p.x + 30 + i * 6, s.p.y + (i % 3) * 10 - 10); f.fodder = true; lit(s.p, f); }
  s.w.msgs.length = 0; cast(s, 0, 0, 0);
  ok(s.w.msgs.filter(m => m.t === 'refund').length === 0 && s.p.heat === 0 && s.p.shield === 0 && s.p.heatT === 0, 'six burning horde foes: no Heat Engine cut, no Chain Reaction, no Heat, no shield'); ok(parts(s, 'nova.blast').length === 6, 'but the Nova struck all six');
  const k = stage({ p_el: 1, p_el_b: 3 }), dead = foe(k.w, k.p.x + 60, k.p.y); dead.fodder = true; dead.hp = 1; dead.maxHp = 1; k.p.heat = 2; k.w.msgs.length = 0; k.w.hitEnemy(dead, 99, { p: k.p, kind: 'skill', part: 'nova.blast', clsEl: 'fire' }); run(k, 0.1);
  ok(dead.hp <= 0 && k.w.msgs.filter(m => m.t === 'refund').length === 0 && k.p.heat === 2 && k.p.shield === 0, 'killing a horde foe changes no Heat, refund or shield');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
