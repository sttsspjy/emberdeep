// Usage: node tools/check-shade.js
// Headless checks of the Shade route against DESIGN-classes section 7: card numbers, Momentum, Culling Blades, Thousand Cuts, Ghost Walk, Assassinate, Afterimage, Nightfall, Night's Edge, Veil of Night,
// Open Veins and Rupture, each in a staged room. Prints failures and exits 1 when any check fails.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const build = (boons, wi) => ED.Stats.compute({ cls: 'shade', weapon: ED.CLASSES.shade.weapons[wi || 0], boons: boons || {}, relics: [], meta: META(), pact: 0 });

// staged world: one Shade with the given cards, an empty room, crit chance 0 unless crit is given
function stage(boons, wi, crit) {
  const w = new ED.World({ seed: 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'shade', weapon: ED.CLASSES.shade.weapons[wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.fx.length = 0; w.msgs.length = 0;
  p.stats.crit = crit || 0;
  return { w, p };
}
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 5000; return e; };
const run = (w, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.update(1 / 60); if (f) f(); } };
const lost = (e) => e.maxHp - e.hp;
const evs = (w, t) => w.fx.filter(e => e.t === t);
const refunds = (w) => w.msgs.filter(m => m.t === 'refund');
const W = (cond) => cond; void W;
const hit = (w, p, e, o) => w.hitEnemy(e, 100, Object.assign({ p, kind: 'weapon', wpn: true }, o));

// ---------------- card numbers ----------------
{
  const b = build({ s_atk: 1 });
  near(b.crit, 0.12 + 0.08, 1e-9, 'Bladedancer crit'); near(b.momentum, 0.04, 1e-9, 'Bladedancer momentum'); near(b.momMax, 5, 1e-9, 'Bladedancer stacks');
  near(build({ s_atk: 1, s_atk_s: 1 }).momMax, 7, 1e-9, 'Thousand Cuts rank 1 stacks'); near(build({ s_atk: 1, s_atk_s: 3 }).momMax, 9, 1e-9, 'Thousand Cuts rank 3 stacks');
  near(build({ s_atk: 1, s_atk_h: 1 }).critMult, 1.75, 1e-9, 'Culling Blades rank 1 crit damage'); near(build({ s_atk: 1, s_atk_h: 2 }).critMult, 1.85, 1e-9, 'Culling Blades rank 2 crit damage'); near(build({ s_atk: 1, s_atk_h: 3 }).critMult, 1.95, 1e-9, 'Culling Blades rank 3 crit damage');
  near(build({ s_atk: 1, s_atk_h: 2 }).execMom, 0, 1e-9, 'Killing Rhythm is a rank 3 rider'); near(build({ s_atk: 1, s_atk_h: 3 }).execMom, 3, 1e-9, 'Killing Rhythm rank 3'); near(build({ s_atk: 1, s_atk_h: 1 }).execCrit, 0.25, 1e-9, 'execution threshold');
  const g = build({ s_s1: 1 }); near(g.skillCd, 4.5 * 0.8, 1e-9, 'Ghost Walk cooldown 3.6 s'); near(ED.Stats.skillNums('step', g).p.slash.dmg, 40.6 * 1.2, 1e-6, 'Ghost Walk +20% Shadowstep');
  near(build({ s_s1: 1, s_s1_a: 3 }).stepTwin, 0.5, 1e-9, 'Twin Cut 50%'); near(ED.Stats.skillNums('step', build({ s_s1: 1, s_s1_b: 1 })).p.after.dmg, 44 * 1.2, 1e-6, 'Afterimage 44 base, +20% Ghost Walk');
  const nf = build({ s_s2: 1 }), sm = ED.Stats.skillNums('vanish', nf);
  near(nf.skill2Cd, 11 * 0.73, 1e-9, 'Nightfall cooldown 8 s'); near(sm.p.smoke.r, 105, 1e-9, 'Nightfall smoke radius +40%'); near(sm.p.smoke.dur, 5, 1e-9, 'Nightfall smoke +2 s'); near(nf.stealthSpd, 0.3, 1e-9, 'Nightfall stealth speed');
  near(ED.Stats.moveRate({ stats: nf, flowT: 0, stealthT: 1 }) / ED.Stats.moveRate({ stats: nf, flowT: 0, stealthT: 0 }), 1.3, 1e-9, 'moveRate adds stealthSpd while unseen');
  near(ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_a: 1 })).p.ambush.dmg, 41.25, 1e-9, "Night's Edge Ambush x3.75 of 11"); near(ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_a: 3 })).p.ambush.dmg, 46.75, 1e-9, "Night's Edge rank 3 x4.25");
  near(ED.Stats.skillNums('vanish', build({})).p.ambush.dmg, 27.5, 1e-9, 'plain Ambush x2.5'); near(ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_b: 1 })).p.ambush.dmg, 33, 1e-9, 'Veil of Night Ambush x3'); near(build({ s_s2: 1, s_s2_a: 3 }).ambushCleave, 70, 1e-9, 'Ambush Sweep radius');
  near(build({ s_s2: 1, s_s2_b: 1 }).veil, 0.03, 1e-9, 'Veil 3%'); near(build({ s_s2: 1, s_s2_b: 3 }).veil, 0.03, 1e-9, 'Veil stays 3% at rank 3 (the class shield window)');
  near(build({ s_s2: 1, s_s2_b: 1 }).stealthDur, 1, 1e-9, 'Veil stealth +1 s'); near(build({ s_s2: 1, s_s2_b: 3 }).stealthDur, 2, 1e-9, 'Veil rank 3 stealth +2 s (+0.5 s per rank)');
  near(ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_b: 3 })).p.smoke.dur, 7, 1e-9, 'Shroud: the sheet smoke lasts 3 + 2 (Nightfall) + 2 (Shroud) s');
  ok(ED.boonText('s_s2_b', 1).indexOf('3%') >= 0 && ED.boonText('s_s2_b', 3).indexOf('lasts 2 s longer') >= 0, 'Veil card text shows 3% and the Shroud rider shows 2 s'); near(ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_b: 1 })).p.blind.dur, 3, 1e-9, 'Veil blind budget 3 s');
  near(build({ s_el: 1, s_el_a: 1 }).veins, 0.15, 1e-9, 'Open Veins 15%'); near(build({ s_el: 1, s_el_a: 3 }).veins, 0.21, 1e-9, 'Open Veins rank 3'); near(build({ s_el: 1, s_el_a: 3 }).exsang, 0.25, 1e-9, 'Exsanguinate');
  near(build({ s_el: 1, s_el_b: 3 }).rupture, 0.7, 1e-9, 'Rupture rank 3 70%'); near(build({ s_el: 1, s_el_b: 1 }).bloodbloom, 0, 1e-9, 'Bloodbloom is a rank 3 rider'); near(build({ s_el: 1, s_el_b: 3 }).bloodbloom, 1, 1e-9, 'Bloodbloom rank 3');
  near(build({ s_el: 1 }).bleedAll, 0.1, 1e-9, 'Cruel Arts Bleed share'); near(build({ s_el: 1 }).statusPow, 0.15, 1e-9, 'Cruel Arts status power');
}

// ---------------- Momentum ----------------
{
  const { w, p } = stage({ s_atk: 1 }); const e = foe(w, p.x + 40, p.y);
  hit(w, p, e, { crit: true }); near(p.momN, 1, 0, 'a crit grants a Momentum stack'); near(p.momT, 2.5, 1e-9, 'Momentum lasts 2.5 s');
  hit(w, p, e, { crit: false }); near(p.momN, 1, 0, 'a plain hit grants none');
  for (let i = 0; i < 8; i++) hit(w, p, e, { crit: true }); near(p.momN, 5, 0, 'Momentum caps at 5');
  const d0 = lost(e); e.hp = e.maxHp; const d1 = (() => { p.momN = 0; const h = e.hp; hit(w, p, e, { crit: false }); return h - e.hp; })();
  p.momN = 5; p.momT = 2.5; const h5 = e.hp; hit(w, p, e, { crit: false }); const d5 = h5 - e.hp; void d0;
  near(d5 / d1, (p.stats.dmg + 0.2) / p.stats.dmg, 1e-6, 'five stacks add 20% damage');
  p.momN = 5; p.momT = 2.5; run(w, 2); hit(w, p, e, { crit: true }); near(p.momT, 2.5, 1e-9, 'a crit restarts the timer'); run(w, 2.4); ok(p.momN === 5, 'Momentum holds inside 2.5 s'); run(w, 0.2); near(p.momN, 0, 0, 'Momentum drops when the timer ends');
  const sw = stage({ s_atk: 1, s_atk_s: 1 }); const e2 = foe(sw.w, sw.p.x + 40, sw.p.y);
  for (let i = 0; i < 12; i++) hit(sw.w, sw.p, e2, { crit: true }); near(sw.p.momN, 7, 0, 'Thousand Cuts caps at 7');
  const nm = stage({}); const e3 = foe(nm.w, nm.p.x + 40, nm.p.y); hit(nm.w, nm.p, e3, { crit: true }); near(nm.p.momN, 0, 0, 'no Momentum without Bladedancer');
  // wire: P[17] carries the stacks
  try {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
    const snap = ED.Net.encodeSnap(w, [], false); p.momN = 4; const snap2 = ED.Net.encodeSnap(w, [], false);
    near(snap2.P[0][17], 4, 0, 'Momentum stacks on the wire (P[17])'); void snap;
    ok(ED.Net.CAPS.exec > 0 && ED.Net.CAPS.rupt > 0 && ED.Net.CAPS_LOCAL.exec > 0, 'exec and rupt events are capped');
  } catch (err) { ok(false, 'net.js loads in Node: ' + err.message); }
}

// ---------------- Culling Blades ----------------
{
  const { w, p } = stage({ s_atk: 1, s_atk_h: 3 }); const lowE = foe(w, p.x + 40, p.y), hiE = foe(w, p.x + 40, p.y + 30), skillE = foe(w, p.x + 40, p.y - 30), boss = foe(w, p.x + 40, p.y + 60);
  lowE.hp = lowE.maxHp * 0.24; hiE.hp = hiE.maxHp * 0.26; skillE.hp = skillE.maxHp * 0.24; boss.boss = true; boss.hp = boss.maxHp * 0.2;
  const s1 = { p, kind: 'weapon', wpn: true }; w.hitEnemy(lowE, 1, s1); ok(s1.critOut === true && s1.exec === true, 'a weapon hit on a foe below 25% always crits');
  const s2 = { p, kind: 'weapon', wpn: true }; w.hitEnemy(hiE, 1, s2); ok(!s2.critOut && !s2.exec, 'a foe at 26% takes no forced crit');
  const s3 = { p, kind: 'skill', part: 'step.slash', crit: undefined }; w.hitEnemy(skillE, 1, s3); ok(!s3.critOut, 'a skill hit is not an execution');
  const s4 = { p, kind: 'weapon', wpn: true }; w.hitEnemy(boss, 1, s4); ok(s4.critOut === true, 'bosses are executed too');
  ok(evs(w, 'exec').length === 2, 'an exec event per execution crit');
  // Killing Rhythm: an execution crit that kills grants 3 Momentum (rank 3), cap 5
  p.momN = 0; p.momT = 0; const k = foe(w, p.x + 80, p.y); k.hp = 5; hit(w, p, k, {}); near(p.momN, 4, 0, 'Killing Rhythm: 1 from the crit + 3 from the execution kill');
  p.momN = 0; const k2 = foe(w, p.x + 80, p.y + 10); k2.hp = 5; hit(w, p, k2, {}); ok(p.momN === 4, 'second execution kill');
  p.momN = 0; const k3 = foe(w, p.x + 80, p.y + 20); k3.hp = 4000; hit(w, p, k3, { crit: true, mul: 1e6 }); ok(k3.hp <= 0 && p.momN === 1, 'a kill from high health grants no Rhythm (only the crit stack)');
  p.momN = 0; const k4 = foe(w, p.x + 80, p.y + 30); k4.hp = 5; hit(w, p, k4, { crit: true }); near(p.momN, 4, 0, 'a readied crit on a foe below 25% that kills also counts');
  { const am = stage({ s_atk: 1, s_atk_h: 3, s_s2: 1 }); const ke = foe(am.w, am.p.x + 30, am.p.y); ke.hp = 5; am.w.playerSkill(am.p, 0, {}, 1); am.w.fx.length = 0; am.w.playerAttack(am.p, 0); run(am.w, 0.6);
    ok(ke.hp <= 0 && evs(am.w, 'exec').length === 1 && am.p.momN === 4, 'an Ambush execution kill grants Killing Rhythm (1 from the crit + 3; got ' + am.p.momN + ')'); }
  const r1 = stage({ s_atk: 1, s_atk_h: 1 }); const k5 = foe(r1.w, r1.p.x + 80, r1.p.y); k5.hp = 5; hit(r1.w, r1.p, k5, {}); near(r1.p.momN, 1, 0, 'no Rhythm below rank 3');
}

// ---------------- Thousand Cuts: Whirlwind ----------------
{
  const { w, p } = stage({ s_atk: 1, s_atk_s: 3 }); const front = foe(w, p.x + 30, p.y), back = foe(w, p.x - 30, p.y); const m = p.stats;
  p.momN = m.momMax; p.momT = 2.5; p.atkCount = 0;
  for (let i = 0; i < 3; i++) w.playerAttack(p, 0);
  ok(back.hp === back.maxHp, 'attacks 1 to 3 do not spin'); p.momT = 2.5;
  w.playerAttack(p, 0); const want = m.weapon.dmg * 0.6 * (m.dmg + m.momentum * p.momN);
  near(lost(back), want, 0.01, 'the 4th attack at full Momentum spins at 60%'); ok(lost(front) > lost(back), 'the front foe takes the swing and the spin');
  ok(evs(w, 'whirl').length === 1, 'a whirl event');
  const b2 = stage({ s_atk: 1, s_atk_s: 3 }); const f2 = foe(b2.w, b2.p.x + 30, b2.p.y), bk2 = foe(b2.w, b2.p.x - 30, b2.p.y); b2.p.momN = 3; b2.p.momT = 2.5; b2.p.atkCount = 3; b2.w.playerAttack(b2.p, 0); ok(bk2.hp === bk2.maxHp, 'no spin below full Momentum'); void f2;
  const k = stage({ s_atk: 1, s_atk_s: 3 }, 1); k.p.momN = k.p.stats.momMax; k.p.momT = 2.5; k.p.atkCount = 3; k.w.playerAttack(k.p, 0);
  const ring = k.w.projs.filter(q => q.mul === 0.6); ok(ring.length === 6, 'knives: a ring of 6 at 60% (got ' + ring.length + ')');
  const angs = ring.map(q => Math.atan2(q.vy, q.vx)).sort((a, b) => a - b); ok(angs.every((a, i) => i === 0 || Math.abs(angs[i] - angs[i - 1] - Math.PI / 3) < 1e-6 || i === 0), 'the ring is evenly spaced');
  const kk = stage({ s_atk: 1, s_atk_s: 1 }, 1); kk.p.momN = kk.p.stats.momMax; kk.p.momT = 2.5; kk.p.atkCount = 3; kk.w.playerAttack(kk.p, 0); ok(!kk.w.projs.some(q => q.mul === 0.6), 'no ring without the rank 3 rider');
}

// ---------------- Ghost Walk: crit stacks ----------------
{
  const cut = (boons, nfoes, wi) => { const { w, p } = stage(boons, wi); for (let i = 0; i < nfoes; i++) foe(w, p.x + 40 + i * 5, p.y + (i - 1) * 6); w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 100, y1: p.y }, 0); return p.critStacks; };
  near(cut({}, 0), 3, 0, 'Shadowstep readies 3 crits'); near(cut({}, 3), 3, 0, 'without Ghost Walk the cut foes add nothing');
  near(cut({ s_s1: 1 }, 1), 4, 0, 'Ghost Walk: +1 per foe cut'); near(cut({ s_s1: 1 }, 5), 5, 0, 'Ghost Walk caps at 5');
  near(cut({ s_atk: 1, s_atk_h: 1 }, 0), 2, 0, 'Heavy daggers: 3 x 0.556 = 2'); near(cut({ s_atk: 1, s_atk_s: 1 }, 0), 5, 0, 'Swift daggers: 3 x 1.82 = 5');
  near(cut({ s_s1: 1, s_atk: 1, s_atk_s: 1 }, 5), 9, 0, 'Swift + Ghost Walk caps at round(5 x 1.82) = 9');
}

// ---------------- Assassinate ----------------
{
  const { w, p } = stage({ s_s1: 1, s_s1_a: 3 }); const low = foe(w, p.x + 40, p.y - 40), hi = foe(w, p.x + 40, p.y + 40); low.hp = low.maxHp * 0.4; hi.hp = hi.maxHp * 0.6;
  const q = ED.Stats.skillNums('step', p.stats).p.slash, st = p.stats;
  w.playerSkill(p, 0, { x0: p.x, y0: p.y - 40, x1: p.x + 100, y1: p.y - 40 }, 0); w.playerSkill(p, 0, { x0: p.x, y0: p.y + 40, x1: p.x + 100, y1: p.y + 40 }, 0);
  const base = q.dmg * st.critMult; near((hi.maxHp * 0.6 - hi.hp) / base, 1, 0.02, 'Shadowstep slash'); near((low.maxHp * 0.4 - low.hp) / (hi.maxHp * 0.6 - hi.hp), 1.3, 0.02, 'Assassinate: +30% below half health (first slash)');
}
{
  const { w, p } = stage({ s_s1: 1, s_s1_a: 1 }); const a = foe(w, p.x + 40, p.y), b = foe(w, p.x + 60, p.y + 6); a.hp = 3; b.hp = 3;
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 100, y1: p.y }, 0); ok(a.hp <= 0 && b.hp <= 0, 'both low foes die'); ok(refunds(w).length === 1 && refunds(w)[0].slot === 0 && !refunds(w)[0].s, 'a Shadowstep kill refunds Shadowstep once per cast');
  const c = foe(w, p.x + 40, p.y); c.hp = 3; w.msgs.length = 0; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 100, y1: p.y }, 0); ok(c.hp <= 0 && refunds(w).length === 0, 'at most one refund per 1.5 s');
  run(w, 1.6); w.msgs.length = 0; const d = foe(w, p.x + 40, p.y); d.hp = 3; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 100, y1: p.y }, 0); ok(refunds(w).length === 1, 'the refund is back after 1.5 s');
  ok(evs(w, 'sref').length === 2, 'a refund event per refund');
  const plain = stage({ s_s1: 1 }); const e = foe(plain.w, plain.p.x + 40, plain.p.y); e.hp = 3; plain.w.playerSkill(plain.p, 0, { x0: plain.p.x, y0: plain.p.y, x1: plain.p.x + 100, y1: plain.p.y }, 0); ok(e.hp <= 0 && refunds(plain.w).length === 0, 'Ghost Walk alone refunds nothing');
}
{ // Twin Cut: a second slash on the same path 0.15 s later at 50%
  const { w, p } = stage({ s_s1: 1, s_s1_a: 3 }); const e = foe(w, p.x + 50, p.y);
  const q = ED.Stats.skillNums('step', p.stats).p, st = p.stats;
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 100, y1: p.y }, 0); near(lost(e), q.slash.dmg * st.critMult, 0.01, 'slash lands at the cast');
  run(w, 0.12); near(lost(e), q.slash.dmg * st.critMult, 0.01, 'the twin has not struck at 0.12 s');
  run(w, 0.06); near(lost(e), q.slash.dmg * st.critMult * 1.5, 0.05, 'the twin strikes at 50% after 0.15 s'); ok(evs(w, 'twincut').length === 1, 'a twincut event');
  ok(p.critStacks === 4, 'the twin readies no extra crits (3 + 1 for the foe the slash cut)');
}

// ---------------- Afterimage ----------------
{
  const { w, p } = stage({ s_s1: 1, s_s1_b: 2 }); const q = ED.Stats.skillNums('step', p.stats).p.after, x0 = p.x, y0 = p.y;
  const near1 = foe(w, x0 + 50, y0), edge = foe(w, x0 + 100, y0 + 20), far = foe(w, x0 + 250, y0), boss = foe(w, x0, y0 + 60); boss.boss = true; const elite = foe(w, x0 - 50, y0); elite.elite = 'swift';
  w.playerSkill(p, 0, { x0, y0, x1: x0, y1: y0 - 100 }, 0); p.x = x0; p.y = y0 - 100;
  const zone = w.zones.find(z => z.kind === 'decoy'); ok(!!zone && zone.x === x0 && zone.y === y0, 'a decoy where the hero stood'); near(zone.r, 80, 1e-9, 'burst radius 80'); near(zone.dur, 1.2, 1e-9, 'fuse 1.2 s');
  const hp0 = near1.hp; run(w, 0.5); ok(near1.hp === hp0, 'nothing happens before the burst'); ok(edge.hp === edge.maxHp, 'a foe at 100 px is out of reach before Lure');
  run(w, 0.5); ok(Math.hypot(edge.x - x0, edge.y - y0) < 100 - 0.5 * 0 && edge.hp === edge.maxHp, 'Lure starts pulling foes in before the burst (0.9 s)');
  run(w, 0.5); ok(!w.zones.some(z => z.kind === 'decoy'), 'the decoy is gone after the burst');
  near(lost(near1), q.dmg, 0.5, 'burst damage 44 +20% Ghost Walk = 52.8'); ok(lost(edge) > 0 && lost(edge) <= q.dmg + 0.5, 'Lure drew the foe at 100 px into the burst'); ok(far.hp === far.maxHp, 'a foe far away is untouched');
  ok(near1.blind > 0.5 && near1.blindCd > 3, 'the burst blinds 1 s and starts the blind cooldown'); ok(boss.blind === 0 && boss.hp < boss.maxHp, 'bosses are hurt but never blinded'); near(near1.blind, 1 - 0.3, 0.08, 'the blind lasts 1 s from the burst (0.3 s ago)'); near(elite.blind, 0.5 - 0.3, 0.08, 'elites are blinded half as long');
  ok(Math.hypot(boss.x - x0, boss.y - y0) >= 59.9, 'bosses are not pulled'); ok(evs(w, 'after').length === 1 && evs(w, 'lure').length === 1, 'after and lure events');
  const nl = stage({ s_s1: 1, s_s1_b: 1 }); const e2 = foe(nl.w, nl.p.x + 100, nl.p.y + 20); nl.w.playerSkill(nl.p, 0, { x0: nl.p.x, y0: nl.p.y, x1: nl.p.x, y1: nl.p.y - 100 }, 0); run(nl.w, 1.3); ok(e2.hp === e2.maxHp, 'without Lure a foe at 100 px is outside the burst'); ok(!evs(nl.w, 'lure').length, 'no lure event without Lure');
  const none = stage({ s_s1: 1 }); none.w.playerSkill(none.p, 0, { x0: none.p.x, y0: none.p.y, x1: none.p.x, y1: none.p.y - 100 }, 0); ok(!none.w.zones.some(z => z.kind === 'decoy'), 'no afterimage without the fork');
}

// ---------------- Nightfall: Vanish smoke ----------------
{
  const { w, p } = stage({ s_s2: 1 }); const inE = foe(w, p.x + 50, p.y), outE = foe(w, p.x + 200, p.y), boss = foe(w, p.x - 50, p.y); boss.boss = true;
  w.playerSkill(p, 0, {}, 1); const z = w.zones.find(q => q.kind === 'smoke'); near(z.r, 105, 1e-9, 'smoke radius'); near(z.dur, 5, 1e-9, 'smoke lasts 5 s'); near(p.stealthT, 2.5, 1e-9, 'stealth 2.5 s'); ok(p.ambush, 'the next attack is an Ambush');
  run(w, 0.2); near(inE.slowAmt, 0.4, 1e-9, 'smoke slows 40%'); ok(inE.blind > 0 && outE.blind <= 0 && boss.blind <= 0 && boss.slowAmt > 0, 'smoke blinds foes inside, only slows bosses');
  ok(inE.vulnT > 0 && !(outE.vulnT > 0), 'foes in the smoke are vulnerable'); const hi = inE.hp; w.hitEnemy(inE, 100, { p, kind: 'skill', crit: false }); const ho = outE.hp; w.hitEnemy(outE, 100, { p, kind: 'skill', crit: false });
  near((hi - inE.hp) / (ho - outE.hp), 1.2, 1e-6, 'foes in the smoke take +20%');
  const sp = ED.Stats.moveRate(p); near(sp, 1.3, 1e-9, 'the hero moves 30% faster while unseen');
}
// blind budget: min(2 + veilBlind, 0.5 x cooldown) seconds per foe per smoke, elites half and then a cooldown
{
  const blindSecs = (boons, elite) => { const { w, p } = stage(boons); const e = foe(w, p.x + 30, p.y); if (elite) e.elite = 'swift'; w.playerSkill(p, 0, {}, 1); let t = 0; run(w, 9, () => { if (e.blind > 0) t += 1 / 60; }); return t; };
  near(blindSecs({ s_s2: 1 }), 2, 0.4, 'smoke blinds a foe about 2 s per smoke'); near(blindSecs({ s_s2: 1, s_s2_b: 1 }), 3, 0.5, 'Veil of Night: 1 s longer'); near(blindSecs({ s_s2: 1, s_s2_b: 1 }, true), 1.5, 0.5, 'elites 0.5 s longer (half the budget)');
  const cd = build({ s_s2: 1 }), N = ED.Stats.skillNums('vanish', cd); near(N.p.blind.dur, Math.min(2, 0.5 * N.cdEff), 1e-9, 'blind budget is capped at half the cooldown');
}

// ---------------- Night's Edge and Ambush ----------------
{
  const ambush = (boons, wi, setup) => { const { w, p } = stage(boons, wi); const e = foe(w, p.x + 30, p.y); if (setup) setup(w, p, e); w.playerSkill(p, 0, {}, 1); w.msgs.length = 0; w.fx.length = 0; w.playerAttack(p, 0); run(w, 0.6); return { w, p, e }; };
  const plain = ambush({}), edge = ambush({ s_s2: 1, s_s2_a: 1 }), r3 = ambush({ s_s2: 1, s_s2_a: 3 });
  const crit = plain.p.stats.critMult;
  near(lost(plain.e), 11 * 2.5 * crit, 0.05, 'plain Ambush: x2.5 of the base weapon, crit'); near(lost(edge.e), 11 * 3.75 * crit, 0.05, "Night's Edge: x3.75"); near(lost(r3.e), 11 * 4.25 * crit, 0.05, "Night's Edge rank 3: x4.25");
  const sw = ambush({ s_s2: 1, s_s2_a: 1, s_atk: 1, s_atk_s: 1 }); near(lost(sw.e), 11 * 3.75 * crit, 0.05, 'Ambush is fork neutral (Swift daggers deal the base weapon x3.75)');
  const hv = ambush({ s_s2: 1, s_s2_a: 1, s_atk: 1, s_atk_h: 1 }); near(lost(hv.e), 11 * 3.75 * crit, 0.05, 'Ambush is fork neutral (Heavy kukris deal the base weapon x3.75)');
  ok(refunds(edge.w).length === 1 && refunds(edge.w)[0].slot === 0 && !refunds(edge.w)[0].s, "Night's Edge: the Ambush refunds Shadowstep"); ok(refunds(plain.w).length === 0, 'a plain Ambush refunds nothing');
  const kn = ambush({ s_s2: 1, s_s2_a: 1 }, 1); ok(refunds(kn.w).filter(m => m.slot === 0).length === 1, "Night's Edge with 3 knives: one Shadowstep refund per Ambush");
  ok(plain.p.ambush === false, 'the Ambush is spent');
  // kill refund of Vanish, once per 3 s
  const k = stage({ s_s2: 1, s_s2_a: 1 }); const a = foe(k.w, k.p.x + 30, k.p.y); a.hp = 5; k.w.playerSkill(k.p, 0, {}, 1); k.w.msgs.length = 0; k.w.playerAttack(k.p, 0);
  ok(a.hp <= 0 && refunds(k.w).filter(m => m.slot === 1).length === 1, "an Ambush kill refunds Vanish"); near(k.p.edgeT, 3, 0.01, 'Vanish refund cooldown 3 s');
  const b = foe(k.w, k.p.x + 30, k.p.y); b.hp = 5; k.w.playerSkill(k.p, 0, {}, 1); k.w.msgs.length = 0; k.w.playerAttack(k.p, 0); ok(b.hp <= 0 && refunds(k.w).filter(m => m.slot === 1).length === 0, 'no second Vanish refund inside 3 s');
  // Ambush Sweep: strikes every foe within 70 of its target, once each
  const sp = stage({ s_s2: 1, s_s2_a: 2 }); const A = foe(sp.w, sp.p.x + 30, sp.p.y), B = foe(sp.w, sp.p.x + 85, sp.p.y + 10), Cf = foe(sp.w, sp.p.x + 250, sp.p.y), D = foe(sp.w, sp.p.x + 28, sp.p.y + 20), Bk = foe(sp.w, sp.p.x - 40, sp.p.y);
  sp.w.playerSkill(sp.p, 0, {}, 1); sp.w.playerAttack(sp.p, 0); run(sp.w, 0.1);
  const ac = sp.p.stats.critMult, want = 11 * 4.0 * ac;
  near(lost(A), want, 0.1, 'the Ambush hits its target'); near(lost(B), want, 0.1, 'the sweep hits a foe 55 px from the target once'); ok(Cf.hp === Cf.maxHp, 'a foe 220 px away is untouched'); near(lost(D), want, 0.1, 'a foe in the swing and near the target is hit once, not twice'); ok(Bk.hp === Bk.maxHp || Math.hypot(Bk.x - A.x, Bk.y - A.y) > 70, 'a foe behind the hero out of the sweep is untouched');
  const nos = stage({ s_s2: 1, s_s2_a: 1 }); const A2 = foe(nos.w, nos.p.x + 30, nos.p.y), B2 = foe(nos.w, nos.p.x + 85, nos.p.y + 10); nos.w.playerSkill(nos.p, 0, {}, 1); nos.w.playerAttack(nos.p, 0); run(nos.w, 0.1); ok(A2.hp < A2.maxHp && B2.hp === B2.maxHp, 'no sweep before the rank 2 rider');
}

// ---------------- Veil of Night ----------------
{
  const { w, p } = stage({ s_s2: 1, s_s2_b: 1 }); w.playerSkill(p, 0, {}, 1);
  near(p.shield, 0.03 * p.maxHp, 0.01, 'Vanish shields 3% max health (the class window)'); near(p.veilT, 12, 0.01, 'Veil once per 12 s'); ok(evs(w, 'veil').length === 1, 'a veil event');
  const s0 = p.shield; run(w, 11); p.shield = 0; w.playerSkill(p, 0, {}, 1); near(p.shield, 0, 1e-9, 'no second Veil inside 12 s');
  run(w, 2); w.playerSkill(p, 0, {}, 1); ok(p.shield > 0, 'Veil is back after 12 s'); void s0;
  near(p.stealthT, 3.5, 0.01, 'stealth 1 s longer');
  const v3 = stage({ s_s2: 1, s_s2_b: 3 }); v3.w.playerSkill(v3.p, 0, {}, 1); near(v3.p.stealthT, 4.5, 0.01, 'rank 3 stealth 2 s longer'); near(v3.p.shield, 0.03 * v3.p.maxHp, 0.01, 'rank 3 shields no more than rank 1');
  const sh = stage({ s_s2: 1, s_s2_b: 3 }); const e = foe(sh.w, sh.p.x + 30, sh.p.y); sh.w.playerSkill(sh.p, 0, {}, 1);
  const z = sh.w.zones.find(q => q.kind === 'smoke'); near(z.dur, 3 + 2 + 2, 1e-9, 'Shroud: smoke 2 s longer'); run(sh.w, 0.2); near(e.slowAmt, 0.6, 1e-9, 'Shroud slows 60%');
  const ns = stage({ s_s2: 1, s_s2_b: 1 }); const e2 = foe(ns.w, ns.p.x + 30, ns.p.y); ns.w.playerSkill(ns.p, 0, {}, 1); run(ns.w, 0.2); near(e2.slowAmt, 0.4, 1e-9, 'slow stays 40% before rank 2');
}

// ---------------- Open Veins, Exsanguinate ----------------
{
  const dmgAt = (boons, n, p0) => {
    const { w, p } = stage(boons); const e = foe(w, p.x + 30, p.y);
    const ids = [() => { e.burnPool = 0.02 * e.maxHp; e.burnOwner = p; }, () => { e.bleedPool = 0.02 * e.maxHp; e.bleedOwner = p; }, () => { e.chill = 30; }, () => { e.stun = 1; }, () => { e.sealT = 5; }];
    for (let i = 0; i < n; i++) ids[i]();
    ok(w.ailments(e) === n, 'staged ' + n + ' ailments'); void p0;
    const h = e.hp; w.hitEnemy(e, 100, { p, kind: 'skill', crit: true, noProc: true }); return h - e.hp;
  };
  const base = dmgAt({ s_el: 1 }, 0), ov = (n, r) => dmgAt({ s_el: 1, s_el_a: r }, n) / dmgAt({ s_el: 1 }, n);
  near(dmgAt({ s_el: 1, s_el_a: 1 }, 0) / base, 1, 1e-9, 'no ailments, no bonus'); near(ov(2, 1), 1.3, 1e-9, 'Open Veins: +15% per ailment'); near(ov(4, 1), 1.6, 1e-9, 'four ailments +60%'); near(ov(5, 1), 1.6, 1e-9, 'capped at 4 ailments');
  near(ov(3, 3), 1 + 0.21 * 3, 1e-9, 'rank 3 +21% per ailment');
  const nc = dmgAt({ s_el: 1, s_el_a: 1 }, 3); const { w, p } = stage({ s_el: 1, s_el_a: 1 }); const e = foe(w, p.x + 30, p.y); const h = e.hp; w.hitEnemy(e, 100, { p, kind: 'skill', crit: false, noProc: true }); ok(h - e.hp < nc, 'Open Veins applies to crits only');
  // Exsanguinate: a crit on a foe with 4 ailments adds Bleed = 25% of the hit
  const bleedGain = (r) => {
    const { w, p } = stage({ s_el: 1, s_el_a: r }); const e = foe(w, p.x + 30, p.y);
    e.burnPool = 0.02 * e.maxHp; e.burnOwner = p; e.chill = 30; e.stun = 1; e.sealT = 5; e.bleedPool = 0; ok(w.ailments(e) === 4, 'four ailments staged');
    const s = { p, kind: 'skill', crit: true }; const h = e.hp; w.hitEnemy(e, 100, s); return { bleed: e.bleedPool, dealt: h - e.hp, aff: s.affMul || 1 };
  };
  const g1 = bleedGain(1), g3 = bleedGain(3), pow = 1 + 0.15, pre = g3.dealt / g3.aff;
  near(g1.bleed, g1.dealt / g1.aff * 0.1 * pow, 0.01, 'rank 1: Cruel Arts Bleed only (10% of the hit)'); near(g3.bleed - g3.dealt / g3.aff * 0.1 * pow, pre * 0.25 * pow, 0.02, 'Exsanguinate adds 25% of the hit as Bleed');
  void pow;
  const e3 = (() => { const { w, p } = stage({ s_el: 1, s_el_a: 3 }); const e = foe(w, p.x + 30, p.y); e.burnPool = 0.02 * e.maxHp; e.burnOwner = p; e.chill = 30; e.bleedPool = 0; w.hitEnemy(e, 100, { p, kind: 'skill', crit: true }); return e.bleedPool; })();
  const e3b = (() => { const { w, p } = stage({ s_el: 1, s_el_a: 1 }); const e = foe(w, p.x + 30, p.y); e.burnPool = 0.02 * e.maxHp; e.burnOwner = p; e.chill = 30; e.bleedPool = 0; w.hitEnemy(e, 100, { p, kind: 'skill', crit: true }); return e.bleedPool; })();
  ok(e3 > 0 && e3b > 0 && Math.abs(e3 / e3b - 1.4) < 0.4, 'below 4 ailments Exsanguinate stays off (only the rank 3 crit damage differs)');
}

// ---------------- Rupture and Bloodbloom ----------------
{
  const { w, p } = stage({ s_el: 1, s_el_b: 1 }); const e = foe(w, p.x + 100, p.y), nb = foe(w, p.x + 140, p.y), far = foe(w, p.x + 180, p.y + 80);
  e.bleedPool = 400; e.bleedOwner = p; e.burnPool = 200; e.burnOwner = p; e.burn = 1;
  const dealt = w.rupture(e, p, 0.5, 'test.rupture', false);
  near(dealt, 400 * 0.5 * 1.5 + 200 * 0.5 * 1.5, 0.01, 'Rupture: half the pools at 150%'); near(e.bleedPool, 200, 1e-9, 'the Bleed pool loses its half'); near(e.burnPool, 100, 1e-9, 'the Burn pool loses its half');
  near(lost(nb), dealt * 0.5, 0.01, 'half of the burst splashes foes within 60'); ok(far.hp === far.maxHp, 'a foe 90 px away takes none');
  ok(evs(w, 'rupt').length === 1 && evs(w, 'rupt')[0].k === 2, 'a rupt event (both pools)');
  const hits = w.fx.filter(x => x.t === 'hit' && x.pid === 'p0'); ok(hits.some(h => h.el === 4) && hits.some(h => h.el === 1), 'Bleed and Burn hit events carry their elements');
  // Burn keeps the affinity the pool already carries: no second multiplier
  const f = stage({ s_el: 1, s_el_b: 1 }); const b2 = foe(f.w, f.p.x + 100, f.p.y); b2.burnPool = 200; b2.burnOwner = f.p; const s0 = b2.hp; f.w.stratum = 3; f.w.rupture(b2, f.p, 0.5, 't', false); near(s0 - b2.hp, 150, 0.01, 'Burn rupture has no second affinity multiplier'); f.w.stratum = 1;
  // no pools, no rupture
  const e0 = foe(w, p.x + 100, p.y - 60); near(w.rupture(e0, p, 0.5, 't', false), 0, 0, 'nothing to rupture');
  // rank 2: 60%
  const r2 = stage({ s_el: 1, s_el_b: 2 }); near(r2.p.stats.rupture, 0.6, 1e-9, 'rank 2 ruptures 60%');
}
{ // Shadowstep ruptures every foe it cuts
  const { w, p } = stage({ s_el: 1, s_el_b: 1 }); const a = foe(w, p.x + 40, p.y), b = foe(w, p.x + 70, p.y); for (const e of [a, b]) { e.bleedPool = 400; e.bleedOwner = p; }
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 100, y1: p.y }, 0);
  ok(evs(w, 'rupt').length === 2, 'two foes cut, two ruptures'); ok(a.bleedPool < 250 && b.bleedPool < 250, 'both pools halved (' + a.bleedPool.toFixed(1) + ', ' + b.bleedPool.toFixed(1) + ')');
  ok(lost(a) > 300, 'the rupture hit lands on top of the slash');
}
{ // Ambush ruptures its target, once even with 3 knives; a swung Ambush ruptures only the first foe it strikes
  const { w, p } = stage({ s_s2: 1, s_el: 1, s_el_b: 1 }, 1); const e = foe(w, p.x + 30, p.y); e.bleedPool = 400; e.bleedOwner = p;
  w.playerSkill(p, 0, {}, 1); w.fx.length = 0; w.playerAttack(p, 0); run(w, 0.6);
  ok(evs(w, 'rupt').length === 1, 'three knives on one foe rupture it once (got ' + evs(w, 'rupt').length + ')');
  const m = stage({ s_s2: 1, s_el: 1, s_el_b: 1 }); const a = foe(m.w, m.p.x + 30, m.p.y), b = foe(m.w, m.p.x + 30, m.p.y + 14); for (const f of [a, b]) { f.bleedPool = 400; f.bleedOwner = m.p; }
  m.w.playerSkill(m.p, 0, {}, 1); m.w.fx.length = 0; m.w.playerAttack(m.p, 0); ok(evs(m.w, 'rupt').length === 1, 'a swing ruptures only the first foe it strikes (got ' + evs(m.w, 'rupt').length + ')');
  ok(a.bleedPool < 250 !== b.bleedPool < 250, 'exactly one of the two foes was ruptured');
  run(m.w, 1); for (const f of [a, b]) { f.bleedPool = 400; f.bleedOwner = m.p; } m.w.playerSkill(m.p, 0, {}, 1); m.w.fx.length = 0; m.w.playerAttack(m.p, 0); ok(evs(m.w, 'rupt').length === 1, 'the next Ambush ruptures its target again');
  const none = stage({ s_s2: 1, s_el: 1 }); const g = foe(none.w, none.p.x + 30, none.p.y); g.bleedPool = 400; g.bleedOwner = none.p; none.w.playerSkill(none.p, 0, {}, 1); none.w.playerAttack(none.p, 0); ok(!evs(none.w, 'rupt').length, 'no rupture without the fork');
}
{ // Bloodbloom: a foe the rupture kills hands its remaining Bleed to the 2 nearest foes within 80
  const { w, p } = stage({ s_el: 1, s_el_b: 3 }); const e = foe(w, p.x + 100, p.y), n1 = foe(w, p.x + 130, p.y), n2 = foe(w, p.x + 100, p.y + 50), n3 = foe(w, p.x + 100, p.y - 70), far = foe(w, p.x + 100, p.y + 200);
  e.bleedPool = 400; e.bleedOwner = p; e.hp = 5; n1.maxHp = n1.hp = 5000;
  const before = [n1, n2, n3, far].map(f => f.bleedPool); w.rupture(e, p, 0.7, 't', false);
  const rem = 400 * 0.3;
  ok(e.hp <= 0, 'the rupture killed the foe');
  near(n1.bleedPool - before[0], rem * 0.5, 0.01, 'the nearest foe gets half the remaining Bleed'); near(n2.bleedPool - before[1], rem * 0.5, 0.01, 'the second nearest gets half'); ok(n3.bleedPool === before[2] && far.bleedPool === before[3], 'the third foe and far foes get none');
  ok(n1.bleedOwner === p, 'the pool keeps its owner'); ok(evs(w, 'bloom').length === 1, 'a bloom event');
  const lo = stage({ s_el: 1, s_el_b: 2 }); const e2 = foe(lo.w, lo.p.x + 100, lo.p.y), m2 = foe(lo.w, lo.p.x + 130, lo.p.y); e2.bleedPool = 400; e2.bleedOwner = lo.p; e2.hp = 5; lo.w.rupture(e2, lo.p, 0.6, 't', false); ok(m2.bleedPool === 0, 'no Bloodbloom before rank 3');
  // a receiver takes at most 25% of its own health per pool
  const cap = stage({ s_el: 1, s_el_b: 3 }); const e3 = foe(cap.w, cap.p.x + 100, cap.p.y), s3 = foe(cap.w, cap.p.x + 130, cap.p.y); e3.bleedPool = 1e6; e3.bleedOwner = cap.p; e3.hp = 5; s3.maxHp = s3.hp = 100; cap.w.rupture(e3, cap.p, 0.7, 't', false); ok(s3.bleedPool <= 25 + 1e-6, 'a spread gives at most 25% of the receiver health');
  // splash kills bloom as well
  const sk = stage({ s_el: 1, s_el_b: 3 }); const c = foe(sk.w, sk.p.x + 100, sk.p.y), v = foe(sk.w, sk.p.x + 130, sk.p.y), r = foe(sk.w, sk.p.x + 160, sk.p.y + 40); c.bleedOwner = sk.p; c.bleedPool = 1000; v.hp = 10; v.bleedPool = 500; v.bleedOwner = sk.p; sk.w.rupture(c, sk.p, 0.7, 't', false); ok(v.hp <= 0 && r.bleedPool > 0, 'a foe killed by the splash blooms too');
}

// ---------------- the bot casts what the route needs ----------------
{ // hero fields exist and a fresh Shade starts with no Momentum, no queue
  const { p } = stage({}); ok(p.momN === 0 && Array.isArray(p.stepQ) && p.stepQ.length === 0 && p.ambTgt.length === 0, 'Shade hero fields');
  ok(Array.isArray(p.bloom) && p.dome === null && p.clone === null && p.ambFac === 1 && p.eclipseRe === false, 'skill form hero fields');
}

// ================= skill forms: rank 2 keeps the old rider, rank 3 is the transform =================
const spy = (w) => { const log = [], o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const d = o.call(this, e, b, s); if (s && s.part) log.push({ part: s.part, e, d, t: this.time, crit: s.critOut, src: s }); return d; }; return log; };
const partHits = (log, part) => log.filter(h => h.part === part);
const hurtP = (w, p) => w.hurtPlayer(p, 1, { hazard: true }); // false while untouchable
const place = (p, x, y) => { p.x = x; p.y = y; };
const step = (w, p, x0, y0, x1, y1) => { place(p, x1, y1); w.playerSkill(p, 0, { x0, y0, x1, y1 }, 0); };
{ // card text and totals of the four skill forks
  const FORKS = { s_s1_a: ['Assassinate', 'Twin Cut', 'Death Blossom'], s_s1_b: ['Afterimage', 'Lure', 'Hall of Mirrors'], s_s2_a: ["Night's Edge", 'Ambush Sweep', 'Eclipse'], s_s2_b: ['Veil of Night', 'Shroud', 'Umbral Veil'] };
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
  near(tt('s_s1_a', 3).blossom, 0.7, 1e-9, 'Death Blossom cut 70%'); near(tt('s_s1_a', 3).blossomN, 3, 1e-9, 'three blinks'); near(tt('s_s1_a', 3).blossomMax, 6, 1e-9, 'at most six'); near(tt('s_s1_a', 3).stepTwin, 0.5, 1e-9, 'Twin Cut stays at rank 3');
  near(tt('s_s1_b', 3).mirrorHall, 1, 1e-9, 'Hall of Mirrors 100% of a slash'); near(tt('s_s1_b', 3).afterPull, 120, 1e-9, 'Lure stays at rank 3');
  near(tt('s_s2_a', 3).eclipse, 0.6, 1e-9, 'Eclipse repeats at 60%'); near(tt('s_s2_a', 3).eclipseDur, 4, 1e-9, 'dome 4 s'); near(tt('s_s2_a', 3).ambushCleave, 70, 1e-9, 'Ambush Sweep stays at rank 3');
  near(tt('s_s2_b', 3).umbral, 2, 1e-9, 'Umbral Veil blind x2'); near(tt('s_s2_b', 3).cloneMul, 0.5, 1e-9, 'clone repeats at 50%'); near(tt('s_s2_b', 3).veil, 0.03, 1e-9, 'Umbral Veil adds no shield (3% stays)'); near(tt('s_s2_b', 3).shroud, 1, 1e-9, 'Shroud stays at rank 3');
  ok(tx('s_s1_a').indexOf('70%') >= 0 && tx('s_s1_a').indexOf('up to 6') >= 0 && tx('s_s1_b').indexOf('100%') >= 0 && tx('s_s2_a').indexOf('4 s') >= 0 && tx('s_s2_a').indexOf('60%') >= 0 && tx('s_s2_b').indexOf('50%') >= 0 && tx('s_s2_b').indexOf('2 times') >= 0, 'form texts carry their numbers');
}

{ // Death Blossom (s_s1_a rank 3): after the blink the hero blinks on to the nearest foe not yet cut within 120 of where it stands, 3 times, 0.1 s apart, a crit for 70% of a slash each; a kill adds a blink (at most 6)
  const mk = (boons, mod) => {
    const { w, p } = stage(boons); place(p, 50, 176);
    const path = foe(w, 100, 176), chain = [210, 280, 350, 420].map(x => foe(w, x, 176)), g = foe(w, 210, 286), far = foe(w, 150, 300); void far;
    if (mod) mod(w, p, path, chain, g);
    const log = spy(w), N = ED.Stats.skillNums('step', p.stats);
    step(w, p, 50, 176, 150, 176);
    return { w, p, path, chain, g, log, N };
  };
  const t3 = mk({ s_s1: 1, s_s1_a: 3 }); void t3;
  const q = ED.Stats.skillNums('step', t3.p.stats); near(q.p.blossom.dmg, 0.7 * q.p.slash.dmg, 1e-9, 'blossom part = 70% of a slash'); ok(q.p.blossom.n === 3 && q.p.blossom.on && q.p.blossom.crit === true, 'three blinks, a guaranteed crit');
  ok(partHits(t3.log, 'step.slash').length === 1 && t3.log[0].e === t3.path && !partHits(t3.log, 'step.blossom').length, 'the Shadowstep cuts the foe on its path first; the chain waits 0.1 s');
  const sl = q.p.slash.dmg * t3.p.stats.critMult;
  run(t3.w, 0.7); const bl = partHits(t3.log, 'step.blossom');
  ok(bl.length === 3 && bl.map(h => h.e).join() === t3.chain.slice(0, 3).join(), `the chain visits the nearest foe each time (${bl.length} cuts)`);
  ok(bl.every((h, i) => Math.abs(h.t - (0.1 * (i + 1) + 0.017)) < 0.04), `0.1 s apart (${bl.map(h => h.t.toFixed(2)).join(' ')})`);
  ok(bl.every(h => h.crit === true && Math.abs(h.d - 0.7 * sl) < 0.01), `each cut is a guaranteed crit for 70% of a slash (${bl.map(h => h.d.toFixed(1)).join(' ')} of ${(0.7 * sl).toFixed(1)})`);
  ok(t3.chain[3].hp === 5000 && t3.g.hp === 5000 && !t3.log.some(h => h.e === t3.g), 'the fourth foe in the line and the foes off the chain are untouched');
  ok(Math.abs(t3.p.x - (350 - 10 - 10 - 2)) < 6 && t3.p.y === 176, `the hero ends beside the last foe (x ${t3.p.x.toFixed(0)})`);
  const bev = evs(t3.w, 'blossom'); ok(bev.length === 3 && bev[0].x0 === 150 && bev[2].tx === 350 && bev.map(b => b.n).join() === '1,2,3', 'a blossom event per blink');
  // untouchable meanwhile
  { const u = mk({ s_s1: 1, s_s1_a: 3 }); run(u.w, 0.15); ok(hurtP(u.w, u.p) === false, 'the hero is untouchable during the chain'); run(u.w, 0.5); ok(hurtP(u.w, u.p) !== false, 'and exposed again after it'); }
  // rank 2: Twin Cut only
  { const r2 = mk({ s_s1: 1, s_s1_a: 2 }); run(r2.w, 0.7); ok(!partHits(r2.log, 'step.blossom').length && partHits(r2.log, 'step.twin').length === 1 && !r2.p.bloom.length && r2.p.x === 150, 'rank 2 only repeats the slash (Twin Cut)'); }
  // kills add blinks: every cut kills, so the chain grows to 6
  { const k = mk({ s_s1: 1, s_s1_a: 3 }, (w, p, path, chain, g) => { for (const e of chain) e.hp = 5; for (const x of [450]) { const e = foe(w, x, 176); e.hp = 5; chain.push(e); } for (const x of [350, 420]) for (const dy of [30, -30]) { const e = foe(w, x - 40, 176 + dy); e.hp = 5; chain.push(e); } });
    run(k.w, 1.2); const kb = partHits(k.log, 'step.blossom'); ok(kb.length === 6, `a kill adds a blink, up to six (${kb.length})`); ok(k.p.bloom.length === 0, 'the chain is over');
    ok(refunds(k.w).length === 1 && refunds(k.w)[0].slot === 0, `kills refund Shadowstep once (Assassinate, 1.5 s): ${refunds(k.w).length}`); }
  // horde foes: cuts kill them but add no blink and refund nothing
  { const f = mk({ s_s1: 1, s_s1_a: 3 }, (w, p, path, chain) => { for (const e of chain) { e.hp = 5; e.fodder = true; } }); run(f.w, 1); const fb = partHits(f.log, 'step.blossom');
    ok(fb.length === 3 && f.chain[3].hp === 5 && f.chain.slice(0, 3).every(e => e.hp <= 0), 'horde foes are cut and die, but the chain stays at three'); ok(refunds(f.w).length === 0, 'and refund nothing'); }
  // a plain Shadowstep kill on a horde foe refunds nothing either (Assassinate), a normal one does
  { const a = stage({ s_s1: 1, s_s1_a: 1 }); place(a.p, 50, 176); const e = foe(a.w, 100, 176); e.hp = 3; e.fodder = true; step(a.w, a.p, 50, 176, 150, 176); ok(e.hp <= 0 && refunds(a.w).length === 0, 'Assassinate: a horde foe killed by the slash refunds nothing'); }
  // the chain does not cross a wall and drops with its room
  { const m = mk({ s_s1: 1, s_s1_a: 3 }); m.p.bloom[0].room = {}; run(m.w, 0.7); ok(!partHits(m.log, 'step.blossom').length && !m.p.bloom.length, 'a chain does not follow the hero into another room'); }
  // a remote hero is told where it blinked
  { const r = mk({ s_s1: 1, s_s1_a: 3 }, (w, p) => { p.remote = true; }); run(r.w, 0.7); const bm = r.w.msgs.filter(m => m.t === 'blink'); ok(bm.length === 3 && bm.every(m => m.to === 'p0') && Math.abs(bm[2].x - r.p.x) < 1, 'a remote hero gets a blink message per hop'); }
  // bosses are cut too; the cut spends the visited set once per foe
  { const b = mk({ s_s1: 1, s_s1_a: 3 }, (w, p, path, chain) => { chain[0].boss = true; }); run(b.w, 0.7); ok(partHits(b.log, 'step.blossom').some(h => h.e === b.chain[0]), 'a boss in the chain is cut'); ok(new Set(partHits(b.log, 'step.blossom').map(h => h.e.id)).size === partHits(b.log, 'step.blossom').length, 'a foe is cut at most once per chain'); }
  // a foe cut by the first slash is visited: the chain skips it
  { const s = stage({ s_s1: 1, s_s1_a: 3 }); place(s.p, 50, 176); const a = foe(s.w, 100, 176), b = foe(s.w, 190, 176); const log = spy(s.w); step(s.w, s.p, 50, 176, 150, 176); run(s.w, 0.5); ok(partHits(log, 'step.blossom').length === 1 && partHits(log, 'step.blossom')[0].e === b && !partHits(log, 'step.blossom').some(h => h.e === a), 'the chain skips foes the Shadowstep already cut'); }
}

{ // Hall of Mirrors (s_s1_b rank 3): three images in a triangle (r50) round the start point, each lures and bursts 1.5 s later (r80, blind 1 s) for 100% of a slash; rank 2 leaves one afterimage with Lure
  const go = (boons, mod) => {
    const { w, p } = stage(boons); place(p, 200, 176);
    const mid = foe(w, 200, 176), near1 = foe(w, 200 + 70, 176 + 70), lured = foe(w, 200, 176 - 110), elite = foe(w, 200 - 60, 176 + 20), boss = foe(w, 200 + 60, 176 - 20), far = foe(w, 360, 300); elite.elite = 'swift'; boss.boss = true;
    if (mod) mod(w, p);
    const log = spy(w), N = ED.Stats.skillNums('step', p.stats);
    step(w, p, 200, 176, 200 + 100, 176);
    return { w, p, mid, near1, lured, elite, boss, far, log, N };
  };
  const t = go({ s_s1: 1, s_s1_b: 3 }), zs = t.w.zones.filter(z => z.kind === 'decoy');
  ok(zs.length === 3 && zs.every(z => z.w === 1 && Math.abs(z.r - 80) < 1e-9 && Math.abs(z.dur - 1.5) < 1e-9), 'three mirror images (zone tag 1, r80, fuse 1.5 s)');
  ok(zs.every(z => Math.abs(Math.hypot(z.x - 200, z.y - 176) - 50) < 0.5), 'on a circle of radius 50 round the start point');
  const angs = zs.map(z => Math.atan2(z.y - 176, z.x - 200)).sort((a, b) => a - b); ok(Math.abs(angs[1] - angs[0] - U_ang(Math.PI * 2 / 3)) < 0.05 && Math.abs(angs[2] - angs[1] - Math.PI * 2 / 3) < 0.05, 'a triangle: 120 degrees apart');
  ok(Math.abs(Math.atan2(Math.sin(Math.atan2(zs[0].y - 176, zs[0].x - 200) - Math.PI), Math.cos(Math.atan2(zs[0].y - 176, zs[0].x - 200) - Math.PI))) < 0.05, 'one image stands behind the blink');
  run(t.w, 1.0); ok(!partHits(t.log, 'step.mirror').length, 'nothing bursts before 1.5 s'); run(t.w, 0.6);
  const mh = partHits(t.log, 'step.mirror'), slash = t.N.p.slash.dmg;
  ok(!w_decoys(t.w).length && partHits(t.log, 'step.after').length === 0, 'the images are gone and no plain afterimage burst');
  ok(mh.filter(h => h.e === t.mid).length === 3, `a foe between the images is struck by all three bursts (${mh.filter(h => h.e === t.mid).length})`);
  ok(mh.every(h => Math.abs(h.t - 1.5) < 0.04 && Math.abs(h.d - slash) < 0.01), `each burst deals 100% of a Shadowstep slash, not a crit (${mh[0] && mh[0].d.toFixed(1)} of ${slash.toFixed(1)})`);
  ok(mh.some(h => h.e === t.lured), 'Lure drew a foe at 110 into a burst'); ok(t.far.hp === 5000, 'a foe far away is untouched');
  ok(t.mid.blind > 0 && t.mid.blindCd > 3, 'the bursts blind 1 s and start the blind cooldown'); ok(t.boss.blind === 0 && t.boss.hp < 5000, 'bosses are hurt, never blinded'); ok(t.elite.blind > 0 && t.elite.blind < t.mid.blind + 0.01, 'elites are blinded half as long');
  ok(evs(t.w, 'after').length === 3 && evs(t.w, 'after').every(e => e.k === 1) && evs(t.w, 'lure').length === 3, 'three burst events (tag 1) and three lure events');
  const r2 = go({ s_s1: 1, s_s1_b: 2 }); ok(r2.w.zones.filter(z => z.kind === 'decoy').length === 1 && r2.w.zones.find(z => z.kind === 'decoy').w === 0 && Math.abs(r2.w.zones.find(z => z.kind === 'decoy').dur - 1.2) < 1e-9, 'rank 2: one afterimage, fuse 1.2 s'); run(r2.w, 1.4); ok(partHits(r2.log, 'step.after').length > 0 && !partHits(r2.log, 'step.mirror').length, 'rank 2 bursts as the afterimage');
  { const f = go({ s_s1: 1, s_s1_b: 3 }, (w) => { for (const e of w.enemies) e.fodder = true; }); run(f.w, 1.6); ok(partHits(f.log, 'step.mirror').length >= 3, 'horde foes are burst too'); }
  { const wl = stage({ s_s1: 1, s_s1_b: 3 }); place(wl.p, 50, 60); step(wl.w, wl.p, 50, 60, 150, 60); ok(wl.w.zones.filter(z => z.kind === 'decoy').every(z => wl.w.room && z.x >= 32 && z.y >= 32), 'images stay inside the room'); }
}
function w_decoys(w) { return w.zones.filter(z => z.kind === 'decoy'); }
function U_ang(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

{ // Eclipse (s_s2_a rank 3): Vanish's smoke is a dome (r140, 4 s); inside it the hero stays unseen and every attack is an Ambush at 60% of the first; foes inside take +20%; the extra Ambushes refund nothing
  const mk = (boons, wi, mod) => {
    const { w, p } = stage(boons, wi); place(p, 200, 176);
    const e = foe(w, 230, 176); if (mod) mod(w, p, e);
    const log = spy(w); w.playerSkill(p, 0, {}, 1); w.msgs.length = 0; w.fx.length = 0;
    return { w, p, e, log };
  };
  const swing = (t) => { const h = lost(t.e); t.w.playerAttack(t.p, 0); return lost(t.e) - h; };
  const t = mk({ s_s2: 1, s_s2_a: 3 }), z = t.w.zones.find(q => q.kind === 'smoke'), N = ED.Stats.skillNums('vanish', t.p.stats), cm = t.p.stats.critMult;
  ok(z && z.w === 2 && Math.abs(z.r - 140) < 1e-9 && Math.abs(z.dur - 4) < 1e-9 && t.w.zones.filter(q => q.kind === 'smoke').length === 1, 'one smoke zone, tagged 2 (the dome), radius 140, 4 s');
  near(ED.Stats.skillNums('vanish', build({ s_s2_a: 3 })).p.dome.r, 100, 1e-9, 'dome part radius without Nightfall'); near(ED.Stats.skillNums('vanish', build({ s_s2: 1 })).p.smoke.r, 105, 1e-9, 'plain smoke radius with Nightfall');
  near(build({ s_s2: 1 }).s2Area, 0.4, 1e-9, 'Nightfall makes areas 40% wider (the dome: 100 x 1.4 = 140)'); ok(!N.p.smoke.on && N.p.dome.on && N.p.edge.on, 'the dome replaces the smoke part');
  near(t.p.stealthT, 4, 1e-9, 'unseen for the dome\'s 4 s'); ok(t.p.ambush && t.p.dome && t.p.dome.z === z, 'the first attack is the Ambush; the hero knows its dome');
  const d1 = swing(t); near(d1, 11 * 4.25 * cm, 0.05, 'the first attack is the full Ambush (x4.25 of the base weapon, crit)');
  ok(t.p.ambush === true && t.p.stealthT > 0.2 && t.p.eclipseRe === true, 'attacking inside the dome keeps the hero unseen and arms the next Ambush');
  const d2 = swing(t), d3 = swing(t); near(d2 / d1, 0.6, 1e-6, 'the second attack is an Ambush at 60%'); near(d3 / d1, 0.6, 1e-6, 'and so is every one after it');
  ok(t.w.nearestPlayer(0, 0) === null, 'foes cannot see the hero inside the dome');
  ok(refunds(t.w).filter(m => m.slot === 0).length === 1 && refunds(t.w).filter(m => m.slot === 1).length === 0, "Night's Edge refunds Shadowstep once, for the true Ambush only");
  run(t.w, 0.3); ok(t.e.slowAmt >= 0.4 && t.e.vulnT > 0, 'foes in the dome are slowed and take +20%'); const hv = t.e.hp; t.w.hitEnemy(t.e, 100, { p: t.p, kind: 'skill', crit: false }); const out = foe(t.w, 20, 300); const ho = out.hp; t.w.hitEnemy(out, 100, { p: t.p, kind: 'skill', crit: false });
  near((hv - t.e.hp) / (ho - out.hp), 1.2, 1e-6, 'foes inside take +20% damage');
  // leaving the dome ends it: the next attack is a plain one; the dome ends at 4 s
  { const l = mk({ s_s2: 1, s_s2_a: 3 }); swing(l); ok(l.p.eclipseRe, 'armed inside'); place(l.p, 20, 300); run(l.w, 0.05); ok(!l.p.eclipseRe && !l.p.ambush, 'leaving the dome drops the extra Ambush'); }
  { const l = mk({ s_s2: 1, s_s2_a: 3 }); swing(l); run(l.w, 4.5); ok(l.p.dome === null && !l.p.eclipseRe && !l.p.ambush && l.p.stealthT <= 0, 'the dome ends: no Ambush, no stealth'); }
  { const l = mk({ s_s2: 1, s_s2_a: 3 }); run(l.w, 0.05); const x = swing(l); run(l.w, 1.0); ok(l.p.ambush && l.p.eclipseRe && l.p.stealthT > 0, 'standing idle inside keeps the Ambush ready and the hero unseen'); const d = swing(l); near(d / x, 0.6, 1e-6, 'the Ambush after a pause is an Eclipse repeat'); }
  // rank 2: the plain Ambush
  { const r2 = mk({ s_s2: 1, s_s2_a: 2 }); const zz = r2.w.zones.find(q => q.kind === 'smoke'); ok(zz.w === 0 && !r2.p.dome, 'rank 2 casts the plain smoke'); swing(r2); ok(!r2.p.ambush && r2.p.stealthT === 0, 'and the Ambush is spent by one attack'); }
  // a kill by the true Ambush refunds Vanish; a kill by a repeat refunds nothing; a horde kill refunds nothing
  { const k = mk({ s_s2: 1, s_s2_a: 3 }, 0, (w, p, e) => { e.hp = 5; }); k.w.playerAttack(k.p, 0); ok(k.e.hp <= 0 && refunds(k.w).filter(m => m.slot === 1).length === 1, "the true Ambush's kill refunds Vanish");
    const e2 = foe(k.w, 230, 180); e2.hp = 5; k.p.edgeT = 0; k.w.msgs.length = 0; k.w.playerAttack(k.p, 0); ok(e2.hp <= 0 && refunds(k.w).filter(m => m.slot === 1).length === 0, 'an Eclipse repeat that kills refunds nothing'); }
  { const k = mk({ s_s2: 1, s_s2_a: 3 }, 0, (w, p, e) => { e.hp = 5; e.fodder = true; }); k.w.playerAttack(k.p, 0); ok(k.e.hp <= 0 && refunds(k.w).length === 0 && k.p.edgeT <= 0, 'a horde foe killed by the Ambush refunds nothing'); }
  // Ambush Sweep: the repeats sweep too, at their 60%
  { const s = mk({ s_s2: 1, s_s2_a: 3 }, 0, (w, p, e) => { }); const side = foe(s.w, 230 + 55, 176); run(s.w, 0.05); const h0 = lost(side); s.w.playerAttack(s.p, 0); run(s.w, 0.05); const first = lost(side) - h0; s.w.playerAttack(s.p, 0); run(s.w, 0.05); const second = lost(side) - h0 - first; ok(first > 0 && Math.abs(second / first - 0.6) < 0.01, `the sweep of a repeat is 60% of the first (${(second / first).toFixed(3)})`); }
  // a ranged hero: each shot of a repeat carries the tag and 60%
  { const k = mk({ s_s2: 1, s_s2_a: 3 }, 1); k.w.playerAttack(k.p, 0); const s1 = k.w.projs.filter(q => q.team === 0 && q.ambush); ok(s1.length === 3 && s1.every(q => !q.part), 'knives: the first volley is the plain Ambush');
    k.w.playerAttack(k.p, 0); const s2 = k.w.projs.filter(q => q.team === 0 && q.ambush && !s1.includes(q)); ok(s2.length === 3 && s2.every(q => q.part === 'vanish.edge') && s1.every(q => !q.part), 'the next volley is tagged vanish.edge, the first stays untagged'); run(k.w, 0.4);
    const eh = partHits(k.log, 'vanish.ambush'), ee = partHits(k.log, 'vanish.edge'); ok(eh.length > 0 && ee.length > 0 && Math.abs(ee[0].d / eh[0].d - 0.6) < 0.01, `a repeat's shots deal 60% when they land (${ee[0] && eh[0] ? (ee[0].d / eh[0].d).toFixed(3) : '-'})`); }
  // the blind budget is the same as the smoke's: min(2, half the cooldown) seconds per foe per cast, elites half
  { const b = (elite) => { const k = mk({ s_s2: 1, s_s2_a: 3 }, 0, (w, p, e) => { if (elite) e.elite = 'swift'; }); let tt = 0; run(k.w, 9, () => { if (k.e.blind > 0) tt += 1 / 60; }); return tt; }; near(b(false), 2, 0.4, 'the dome blinds a foe about 2 s per cast'); near(b(true), 1, 0.4, 'elites half that'); near(ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_a: 3 })).p.blind.dur, Math.min(2, 0.5 * ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_a: 3 })).cdEff), 1e-9, 'the budget is capped at half the cooldown'); }
  { const bs = mk({ s_s2: 1, s_s2_a: 3 }, 0, (w, p, e) => { e.boss = true; }); run(bs.w, 0.3); ok(bs.e.blind <= 0 && bs.e.slowAmt > 0, 'bosses are slowed, never blinded'); }
  // the sheet numbers: the repeats are floor(4 s / interval) - 1 attacks of 60%
  { const st = build({ s_s2: 1, s_s2_a: 3 }), q = ED.Stats.skillNums('vanish', st).p; near(q.edge.dmg, 0.6 * q.ambush.dmg, 1e-9, 'edge part = 60% of the Ambush'); ok(q.edge.attacks === Math.floor(4 / st.atkInterval + 1e-9) && q.edge.oneFoe === q.edge.attacks && q.edge.crit === true, `edge part: ${q.edge.attacks} attacks, forced crits`); }
}

{ // Umbral Veil (s_s2_b rank 3): a shadow clone where Vanish was cast for 4 s repeats the weapon at 50% from its spot, foes (not bosses) go for it, the smoke blinds twice as long (capped)
  const mk = (boons, wi, mod) => {
    const { w, p } = stage(boons, wi); place(p, 200, 176);
    const near1 = foe(w, 230, 176), away = foe(w, 330, 176); if (mod) mod(w, p, near1, away);
    const log = spy(w); w.playerSkill(p, 0, {}, 1); w.msgs.length = 0;
    return { w, p, near1, away, log };
  };
  const t = mk({ s_s2: 1, s_s2_b: 3 }), N = ED.Stats.skillNums('vanish', t.p.stats), z = t.w.zones.find(q => q.kind === 'decoy');
  ok(z && z.w === 2 && Math.abs(z.dur - 4) < 1e-9 && z.x === 200 && z.y === 176 && t.p.clone && t.p.clone.z === z, 'a clone zone (tag 2, 4 s) where the hero stood'); ok(evs(t.w, 'clone').length === 1, 'a clone event');
  ok(N.p.clone.on && N.p.clone.attacks === Math.floor(4 / t.p.stats.atkInterval + 1e-9) + 1 && Math.abs(N.p.clone.dmg - 0.5 * t.p.stats.weapon.dmg) < 1e-9, 'clone part: 50% of the weapon, one hit per attack in 4 s');
  // the clone repeats the attack from its own spot
  place(t.p, 350, 176); const far = foe(t.w, 380, 176); // the hero walks off and swings at a foe beside it
  t.p.ambush = false; t.p.stealthT = 0; // the plain weapon, not the Vanish Ambush
  const n0 = t.p.atkCount, a0 = lost(t.near1); t.w.fx.length = 0; t.w.playerAttack(t.p, 0);
  const wd = 11; ok(Math.abs(lost(far) - wd) < 0.01, 'the hero\'s own swing hits the foe beside it for the weapon damage'); ok(Math.abs(lost(t.near1) - a0 - 0.5 * wd) < 0.01, `the clone's swing hits the foe at its spot for 50% (${(lost(t.near1) - a0).toFixed(2)})`);
  ok(t.p.x === 350 && t.p.y === 176 && t.p.atkCount === n0 + 1, 'the hero stays where it was; one attack counted'); ok(evs(t.w, 'swing').length === 1 && evs(t.w, 'cloneswing').length === 1 && evs(t.w, 'cloneswing')[0].x === 200, 'one swing event for the hero, one clone swing at the clone');
  // a foe in front of the hero is not hit by the clone's swing unless it is near the clone
  ok(t.away.hp === 5000, 'a foe 130 px from the clone and 20 from the hero is not hit by the clone');
  // ranged: the clone fires its own volley from its spot
  { const k = mk({ s_s2: 1, s_s2_b: 3 }, 1); place(k.p, 350, 176); k.p.ambush = false; k.p.stealthT = 0; k.w.projs.length = 0; k.w.playerAttack(k.p, 0); const mine = k.w.projs.filter(q => q.team === 0 && q.owner === 'p0'); const fromClone = mine.filter(q => Math.abs(q.x - 200) < 30), fromHero = mine.filter(q => Math.abs(q.x - 350) < 30);
    ok(fromClone.length === 3 && fromHero.length === 3, `knives: three from the hero, three from the clone (${fromHero.length}, ${fromClone.length})`); ok(fromClone.every(q => Math.abs(q.mul - 0.5) < 1e-9) && fromHero.every(q => !q.mul), 'the clone\'s knives carry 50%'); }
  // foes go for the clone: a stand-in target; bosses ignore it
  { const g = mk({ s_s2: 1, s_s2_b: 3 }, 0, (w, p, a, b) => { b.spd = 60; b.cd = 0; }); const bs = foe(g.w, 120, 176); bs.boss = true; bs.spd = 60; place(g.p, 400, 176); run(g.w, 0.4);
    ok(g.away.target && g.away.target.clone === true && g.near1.target && g.near1.target.clone === true, 'foes near the clone take it as their target'); ok(!bs.target || !bs.target.clone, 'a boss does not');
    const d0 = Math.hypot(g.away.x - 200, g.away.y - 176); run(g.w, 1.0); ok(Math.hypot(g.away.x - 200, g.away.y - 176) < d0 - 20, 'and walk toward it (' + d0.toFixed(0) + ' -> ' + Math.hypot(g.away.x - 200, g.away.y - 176).toFixed(0) + ')');
    run(g.w, 3.2); ok(!g.p.clone && !g.w.zones.some(q => q.w === 2) && g.away.target !== null && !g.away.target.clone, 'when the clone ends, foes look for the hero again'); }
  { // a foe closer to the hero than to the clone keeps the hero
    const g = mk({ s_s2: 1, s_s2_b: 3 }); g.p.stealthT = 0; place(g.p, 330, 176); run(g.w, 0.7); ok(g.away.target && g.away.target === g.w.players.get('p0'), 'a foe nearer the hero than the clone still goes for the hero'); }
  // blind x2, capped by half the cooldown
  { const st = build({ s_s2: 1, s_s2_b: 3 }), q = ED.Stats.skillNums('vanish', st), st1 = build({ s_s2: 1, s_s2_b: 2 }), q1 = ED.Stats.skillNums('vanish', st1);
    near(q1.p.blind.dur, 3, 1e-9, 'rank 2 blind budget 3 s'); near(q.p.blind.dur, Math.min(6, 0.5 * q.cdEff), 1e-9, 'rank 3: twice 3 s, capped at half the cooldown'); ok(q.p.blind.dur > q1.p.blind.dur, 'longer than rank 2'); near(ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_b: 3 })).p.smoke.dur, 7, 1e-9, 'the smoke is still Shroud\'s 7 s'); }
  { const b = (elite) => { const k = mk({ s_s2: 1, s_s2_b: 3 }, 0, (w, p, e) => { if (elite) e.elite = 'swift'; }); let tt = 0; run(k.w, 9, () => { if (k.near1.blind > 0) tt += 1 / 60; }); return tt; };
    const cap = Math.min(6, 0.5 * ED.Stats.skillNums('vanish', build({ s_s2: 1, s_s2_b: 3 })).cdEff); near(b(false), cap, 0.5, 'smoke blinds a foe for the capped time (' + cap.toFixed(1) + ' s)'); near(b(true), cap / 2, 0.5, 'elites half'); }
  // rank 2 leaves no clone; a room change stops the clone's attacks; a horde foe is struck like any other
  { const r2 = mk({ s_s2: 1, s_s2_b: 2 }); ok(!r2.p.clone && !r2.w.zones.some(q => q.w === 2), 'rank 2: no clone'); }
  { const c = mk({ s_s2: 1, s_s2_b: 3 }); place(c.p, 350, 176); c.p.clone.room = {}; const a0 = lost(c.near1); c.w.playerAttack(c.p, 0); ok(lost(c.near1) === a0, 'the clone does not attack in another room'); }
  { const f = mk({ s_s2: 1, s_s2_b: 3 }, 0, (w, p, a) => { a.fodder = true; }); place(f.p, 350, 176); const a0 = lost(f.near1); f.w.playerAttack(f.p, 0); ok(lost(f.near1) > a0, 'a horde foe is struck by the clone'); }
  { const nw = stage({ s_s2: 1, s_s2_b: 3 }); place(nw.p, 200, 176); nw.w.playerSkill(nw.p, 0, {}, 1); const c1 = nw.p.clone.z; nw.w.playerSkill(nw.p, 0, {}, 1); run(nw.w, 0.1); ok(nw.p.clone.z !== c1 && !nw.w.zones.includes(c1) && nw.w.zones.filter(q => q.w === 2).length === 1, 'a new Vanish replaces the old clone'); }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
