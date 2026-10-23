// Usage: node tools/check-knight.js
// Headless checks of the Knight Attack and Element route forks (rank 2: the rider; rank 3: the transform): Earthsplitter, Thousand Edges, Doombrand, Bloodquake. Card data and text, then each mechanic in a staged room.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const C = ED.CONST;

function stage(cls, boons, seed) {
  const w = new ED.World({ seed: seed || 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  p.stats.crit = 0;
  w.enemies.length = 0; w.enc = null; w.locked = false;
  return { w, p };
}
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 5000; return e; };
const run = (w, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.update(1 / 60); if (f) f(); } };
const spy = (w) => { const log = [], o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const d = o.call(this, e, b, s); if (s && s.part) log.push({ part: s.part, e, d, t: this.time }); return d; }; return log; };
const hitsOf = (log, part) => log.filter(h => h.part === part);
const swings = (w, p) => w.fx.filter(f => f.t === 'swing' && f.pid === p.pid);
const ATK = { k_atk: 1 }, HEAVY = (r) => Object.assign({ k_atk_h: r }, ATK), SWIFT = (r) => Object.assign({ k_atk_s: r }, ATK), BRAND = (r) => ({ k_el: 1, k_el_a: r }), RUIN = (r) => ({ k_el: 1, k_el_b: r });

// ---------------- card data and text: the rider joins at rank 2, the transform and its name at rank 3 ----------------
{
  const CARDS = { k_atk_h: ['Oathbreaker', 'Follow-Through', 'Earthsplitter'], k_atk_s: ['Sworn Blade', 'Riposte', 'Thousand Edges'], k_el_a: ['Brand of Ruin', 'Ruin Seal', 'Doombrand'], k_el_b: ['Ruinous Blows', 'Ruin Spreads', 'Bloodquake'] };
  for (const id in CARDS) {
    const [name, rider, form] = CARDS[id], b = ED.BOONS[id], P = [1, 2, 3].map(r => ED.cardParts(id, r, null));
    ok(!b.rider && b.rider2 && b.r2 && b.form && b.r3 && b.form.name === form, id + ' keeps its rider in rider2/r2 and its transform in form/r3');
    ok(P[0].rider2 === '' && P[1].rider2Name === rider && P[1].rider2 !== '' && P[2].rider2 !== '', id + ' rider ' + rider + ' from rank 2');
    ok(!P[0].form && !P[1].form && P[2].form && P[2].form.name === form && P[2].form.desc.length > 40, id + ' transform ' + form + ' only at rank 3');
    ok(ED.cardName(id, 1) === name && ED.cardName(id, 2) === name && ED.cardName(id, 3) === form, id + ' card name: ' + name + ' then ' + form);
    for (let r = 1; r <= 3; r++) ok(!/[{}\[\]]/.test(ED.boonText(id, r, null)), id + ' rank ' + r + ' text has no left-over token');
    ok(!/[{}\[\]]/.test(P[0].formFull.desc), id + ' previews its transform before rank 3');
    const t1 = ED.cardTotals(b, 1), t2 = ED.cardTotals(b, 2), t3 = ED.cardTotals(b, 3);
    for (const k in b.r2) ok(t2[k] > (t1[k] || 0) && t3[k] > 0, id + ' stat ' + k + ' (rank 2 rider)');
    for (const k in b.r3) ok(k in ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 }) && t3[k] !== t2[k], id + ' stat ' + k + ' (rank 3 transform)');
  }
  const t = (id, r) => ED.cardTotals(ED.BOONS[id], r), r3 = (id, k) => ED.BOONS[id].r3[k];
  near(t('k_atk_h', 2).chargeCleave, 0.5, 1e-9, 'Follow-Through moved to rank 2'); near(t('k_atk_h', 3).fissure, r3('k_atk_h', 'fissure'), 1e-9, 'Earthsplitter fissure from the card'); ok(!t('k_atk_h', 3).cleaveN && !('cleaveN' in ED.BOONS.k_atk_h.r3), 'Earthsplitter leaves the Cleave on every 3rd swing');
  near(t('k_atk_s', 2).riposte, 2, 1e-9, 'Riposte moved to rank 2'); near(t('k_atk_s', 3).bladeWave, r3('k_atk_s', 'bladeWave'), 1e-9, 'Thousand Edges wave from the card');
  near(t('k_el_a', 2).seal, 4, 1e-9, 'Ruin Seal moved to rank 2'); near(t('k_el_a', 3).brandCap, 6, 1e-9, 'Doombrand: Brand counts 6'); near(t('k_el_a', 2).brandCap, 4, 1e-9, 'rank 2: Brand counts 4'); near(t('k_el_a', 3).brandMark, r3('k_el_a', 'brandMark'), 1e-9, 'Doombrand Mark from the card');
  near(t('k_el_b', 2).ruinSpread, 0.5, 1e-9, 'Ruin Spreads moved to rank 2'); near(t('k_el_b', 3).bloodquakeSplash, r3('k_el_b', 'bloodquakeSplash'), 1e-9, 'Bloodquake splash from the card');
  near(t('k_el_a', 3).brand, 0.06 + 0.01 * 2 + r3('k_el_a', 'brand'), 1e-9, 'Doombrand adds Brand per ailment at rank 3'); near(r3('k_el_a', 'brandMark'), ED.cardTotals(ED.BOONS.r_s1_a, 3).markV, 1e-9, "the Doombrand Mark equals Hunter's Mark at rank 3");
  ok([1, 2, 3].every(r => t('k_el_b', r).s1Dmg === t('k_el_b', r).s2Dmg) && t('k_el_b', 2).s1Dmg > t('k_el_b', 1).s1Dmg && t('k_el_b', 3).s1Dmg > t('k_el_b', 2).s1Dmg, 'Ruinous Blows raises Charge and Throw damage with every rank (the text prints one number)');
  const pc = (v) => Math.round(v * 100) + '%';
  ok(ED.boonText('k_atk_h', 3, null).indexOf(pc(r3('k_atk_h', 'fissure')) + ' weapon damage, stunning') >= 0 && ED.boonText('k_atk_s', 3, null).indexOf(pc(r3('k_atk_s', 'bladeWave')) + ' weapon damage') >= 0, 'the transform texts print the card numbers');
  ok(ED.boonText('k_el_a', 3, null).indexOf('+' + pc(r3('k_el_a', 'brandMark')) + ' damage from every hero') >= 0 && ED.boonText('k_el_b', 3, null).indexOf(pc(r3('k_el_b', 'bloodquakeMul')) + ' more than it would have dealt, and ' + pc(r3('k_el_b', 'bloodquakeSplash')) + ' of the amount paid') >= 0, 'Doombrand and Bloodquake print the card numbers');
  ok(!/every \d\w\w swing/i.test(ED.boonText('k_atk_h', 3, null)) && /every 3rd swing/i.test(ED.boonText('k_atk', 1, null)), 'Earthsplitter text leaves the Cleave cadence to Oath of Steel');
  ok(/first 4 ailments/.test(ED.boonText('k_el_a', 2, null)) && /first 6 ailments/.test(ED.boonText('k_el_a', 3, null)), 'Brand text shows its cap per rank');
}

// ---------------- Earthsplitter: a fissure on every Cleave that strikes every foe on it once ----------------
{
  const cleaves = (boons, nSwings) => { const { w, p } = stage('knight', boons), out = []; for (let i = 0; i < nSwings; i++) { w.fx.length = 0; w.playerAttack(p, 0); out.push(swings(w, p).some(s => s.k === 'cleave')); } return out.map(c => (c ? 1 : 0)).join(''); };
  ok(cleaves(HEAVY(3), 6) === '001001', 'Earthsplitter keeps the Cleave on swings 3 and 6: ' + cleaves(HEAVY(3), 6));
  ok(cleaves(HEAVY(2), 6) === '001001', 'rank 2 Cleaves swings 3 and 6: ' + cleaves(HEAVY(2), 6));
  const go = (rank, o) => {
    o = o || {};
    const { w, p } = stage('knight', HEAVY(rank)), log = spy(w), x0 = p.x, y0 = p.y, st = p.stats;
    const line = [40, 90, 140, 175].map((d, i) => foe(w, x0 + d, y0 + (i % 2 ? 8 : -8))), edge = foe(w, x0 + 150, y0 + 30), wide = foe(w, x0 + 120, y0 + 60), far = foe(w, x0 + 235, y0), back = foe(w, x0 - 60, y0);
    if (o.fodder) for (const e of line) e.fodder = true;
    p.atkCount = 2; w.fx.length = 0; w.playerAttack(p, 0);
    const cleave = swings(w, p).some(s => s.k === 'cleave'), zone0 = w.zones.find(z => z.kind === 'crack' && z.arc > 0), hp1 = line.map(e => e.hp);
    run(w, 0.2); const early = hitsOf(log, 'fissure').length;
    run(w, 0.2);
    return { w, p, st, log, line, edge, wide, far, back, cleave, zone0, hp1, early, fx: w.fx.slice() };
  };
  const r3 = go(3), r2 = go(2);
  ok(r3.cleave && r3.zone0 && Math.abs(r3.zone0.len - 180) < 1 && Math.abs(r3.zone0.dur - 0.25) < 1e-9 && r3.zone0.w === 36, `a Cleave at rank 3 plants a fissure (180 long, 0.25 s): ${r3.zone0 && r3.zone0.len}`);
  ok(!r2.zone0 && hitsOf(r2.log, 'fissure').length === 0, 'rank 2 plants no fissure');
  const fh = hitsOf(r3.log, 'fissure'), want = r3.st.weapon.dmg * r3.st.fissure * r3.st.dmg;
  ok(r3.early === 0, 'the fissure erupts after its delay, not before');
  ok(fh.length === 4 && r3.line.every(e => fh.filter(h => h.e === e).length === 1), `the fissure strikes each of the 4 foes on its line once (${fh.length})`);
  ok(!fh.some(h => h.e === r3.wide || h.e === r3.far || h.e === r3.back), 'a foe 60 off the line, one past its end and one behind are not struck');
  ok(fh.every(h => Math.abs(h.d / want - 1) < 0.01), `each strike deals the weapon damage x fissure (${fh.map(h => h.d.toFixed(0)).join(',')} vs ${want.toFixed(0)})`);
  ok(r3.line.every(e => e.stunCd > 0 && e.stun > 0 || e.hp < 5000 && e.stunCd > 0), 'struck foes are stunned'); near(Math.max(...r3.line.map(e => e.stun)), r3.st.cStun - 0.2, 0.2, 'stun lasts cStun');
  ok(r3.fx.some(f => f.t === 'fissure' && f.len === 180) && !r3.fx.some(f => f.t === 'crack'), 'a fissure event for the viewer (not the Avalanche crack)');
  { // a swing that is not a Cleave plants nothing; a fissure is cut short by a wall
    const { w, p } = stage('knight', HEAVY(3)); p.atkCount = 0; w.playerAttack(p, 0); ok(!w.zones.some(z => z.kind === 'crack'), 'a plain swing plants no fissure');
    let best = 999, ang = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, e = ED.Sim.castMove(w.room, p.x, p.y, a, 180, 4, w.locked), d = Math.hypot(e.x - p.x, e.y - p.y); if (d < best) { best = d; ang = a; } }
    p.atkCount = 2; w.playerAttack(p, ang); const z = w.zones.find(q => q.kind === 'crack'); ok(best >= 180 ? !!z : !z || z.len <= best + 1, `a wall cuts the fissure short (open ${best.toFixed(0)}, zone ${z ? z.len.toFixed(0) : 'none'})`);
  }
  { // fodder on the line is struck like any other foe
    const f = go(3, { fodder: true }); ok(hitsOf(f.log, 'fissure').filter(h => f.line.includes(h.e)).length === 4, 'fodder on the fissure is struck');
  }
}

// ---------------- Thousand Edges: a blade wave per Cleave, three per Parry ----------------
{
  const waves = (w) => w.projs.filter(q => q.kind === 'blade' && q.team === 0);
  const swing = (rank, extra) => { const t = stage('knight', SWIFT(rank)); const { w, p } = t; t.log = spy(w); t.line = [60, 110, 160].map((d, i) => foe(w, p.x + d, p.y + (i % 2 ? 6 : -6))); t.off = foe(w, p.x + 100, p.y + 45); t.far = foe(w, p.x + 240, p.y); if (extra) extra(t); return t; };
  { // Cleave on swing 3: one wave along the aim; swings 1 and 2 launch none; rank 2 none
    const t = swing(3); const { w, p } = t; const seen = [];
    for (let i = 0; i < 3; i++) { w.fx.length = 0; w.playerAttack(p, 0); seen.push(waves(w).length); w.projs.length = 0; }
    ok(seen.join() === '0,0,1', `a Thousand Edges wave on the Cleave only (${seen.join()})`);
    const t2 = swing(2); t2.p.atkCount = 2; t2.w.playerAttack(t2.p, 0); ok(waves(t2.w).length === 0, 'rank 2 launches no wave');
  }
  { // the wave pierces every foe on its line once for 80% of the weapon, ends after 180, misses a foe 45 off the line
    const t = swing(3); const { w, p } = t; p.atkCount = 2; w.playerAttack(p, 0);
    const pr = waves(w)[0]; ok(pr && pr.r === 12 && pr.pierce >= 90 && Math.abs(Math.hypot(pr.vx, pr.vy) * pr.life - 180) < 1 && pr.wpn, 'the wave is a piercing weapon shot 24 wide that flies 180');
    const cleaveHits = []; const o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const d = o.call(this, e, b, s); if (s && s.part === 'bladewave') cleaveHits.push({ e, d }); return d; };
    run(w, 1);
    const want = p.stats.weapon.dmg * p.stats.bladeWave * p.stats.dmg;
    ok(t.line.every(e => cleaveHits.filter(h => h.e === e).length === 1) && cleaveHits.length === 3, `the wave hits each of the 3 foes on its line once (${cleaveHits.length})`);
    ok(cleaveHits.every(h => Math.abs(h.d / want - 1) < 0.01), `each wave hit deals the weapon damage x bladeWave (${cleaveHits.map(h => h.d.toFixed(1)).join(',')} vs ${want.toFixed(1)})`);
    ok(!cleaveHits.some(h => h.e === t.off || h.e === t.far), 'a foe off the line and one past 180 are not hit');
  }
  { // Parry: three waves, 0.35 rad apart; no Parry, one
    const parry = (rank) => { const t = stage('knight', SWIFT(rank)); const { w, p } = t; const e = foe(w, p.x + 30, p.y); e.st = 'windup'; e.t = 0.2; p.atkCount = 2; w.playerAttack(p, 0); return { w, p, e }; };
    const t = parry(3), ws = t.w.projs.filter(q => q.kind === 'blade').map(q => Math.atan2(q.vy, q.vx)).sort((a, b) => a - b);
    ok(t.e.stun > 0 && ws.length === 3 && Math.abs(ws[0] + 0.35) < 1e-6 && Math.abs(ws[1]) < 1e-6 && Math.abs(ws[2] - 0.35) < 1e-6, `a Parry launches 3 waves in a fan (${ws.map(a => a.toFixed(2)).join(' ')})`);
    ok(parry(2).w.projs.filter(q => q.kind === 'blade').length === 0, 'rank 2: a Parry launches no wave');
    const { w, p } = stage('knight', SWIFT(3)); foe(w, p.x + 30, p.y); p.atkCount = 2; w.playerAttack(p, 0); ok(w.projs.filter(q => q.kind === 'blade').length === 1, 'a Cleave without a Parry launches one wave');
  }
}

// ---------------- Doombrand: Mark at 4 ailments, Brand counts 6 ----------------
{
  // n ailments on a foe (5000 health): Burn, Charge, Bleed, Doom, Radiance, Dazed, Sealed, Chill, Venom (Venom last: it makes the foe take more damage); each sits above its threshold and below its payoff
  const SET = [(e) => { e.burnPool = 80; }, (e) => { e.charge = 100; e.dischargeT = 99; }, (e) => { e.bleedPool = 80; }, (e) => { e.doom = 300; }, (e) => { e.rad = 200; }, (e) => { e.stun = 99; }, (e) => { e.sealT = 99; }, (e) => { e.chill = 90; e.chillT = 99; }, (e) => { e.venom = 90; e.venomT = 99; }];
  const BM = ED.BOONS.k_el_a.r3.brandMark, ail = (w, e, k) => { for (let i = 0; i < k; i++) SET[i](e); return w.ailments(e); }, keep = (w, es, k) => () => { for (const e of es) ail(w, e, k); };
  const dealt = (w, p, e, from) => { const hp = e.hp; w.hitEnemy(e, 100, { p: from || p, kind: 'weapon', crit: false, noProc: true }); return hp - e.hp; };
  { // the cap: 4 ailments at rank 2, 6 with Doombrand (no Mark here: the scan has not run); an ally's hit has no Brand
    const t3 = stage('knight', BRAND(3)), t2 = stage('knight', BRAND(2)), b3 = t3.p.stats.brand, b2 = t2.p.stats.brand;
    const at = (t, k) => { const e = foe(t.w, 300, 200); ail(t.w, e, k); return dealt(t.w, t.p, e) / (100 * t.p.stats.dmg); };
    for (const [k, c3, c2] of [[0, 0, 0], [3, 3, 3], [4, 4, 4], [5, 5, 4], [6, 6, 4], [8, 6, 4]]) {
      near(at(t3, k), 1 + b3 * c3 / t3.p.stats.dmg, 0.005, 'rank 3 Brand with ' + k + ' ailments counts ' + c3); near(at(t2, k), 1 + b2 * c2 / t2.p.stats.dmg, 0.005, 'rank 2 Brand with ' + k + ' ailments counts ' + c2);
    }
    ok(t3.p.stats.brandCap === 6 && t2.p.stats.brandCap === 4, 'brandCap is 6 with Doombrand, 4 before');
  }
  { // Marked at 4 ailments for 4 s (ailments of any hero count); 3 ailments leave the foe unmarked; the Mark makes every hero deal +brandMark
    const { w, p } = stage('knight', BRAND(3)), ally = w.addPlayer({ pid: 'p1', name: 'A', slot: 1, cls: 'ranger', weapon: 'longbow', meta: META() }); ally.stats.crit = 0;
    const a = foe(w, 300, 200), b = foe(w, 340, 200), c = foe(w, 380, 200), upkeep = keep(w, [a], 4), upkeepC = keep(w, [c], 4);
    ail(w, b, 3);
    const base = dealt(w, p, c, ally);
    run(w, 0.3, () => { upkeep(); ail(w, b, 3); });
    ok(a.mark > 3.5 && Math.abs(a.markV - BM) < 1e-9 && !(b.mark > 0), 'a foe with 4 ailments is Marked for 4 s at brandMark, one with 3 is not (' + a.mark.toFixed(2) + ', ' + b.mark.toFixed(2) + ')');
    run(w, 0.3, upkeepC); near(dealt(w, p, c, ally) / base, 1 + BM, 0.005, "an ally's hit on a Doombranded foe deals +brandMark");
    near(dealt(w, p, c, p) / (100 * p.stats.dmg), (1 + p.stats.brand * 4 / p.stats.dmg) * (1 + BM), 0.01, "and the Knight's own hit adds Brand on top of the Mark");
    a.burnPool = a.charge = a.bleedPool = a.doom = 0; run(w, 3); ok(a.mark > 0, 'the Mark outlasts the ailments'); run(w, 1.5); ok(!(a.mark > 0), 'the Mark ends 4 s after the last scan');
    { const t = stage('knight', BRAND(2)), e = foe(t.w, 300, 200); run(t.w, 0.3, keep(t.w, [e], 6)); ok(!(e.mark > 0), 'rank 2 Brand never Marks'); }
    { const t = stage('knight', BRAND(3)), m = foe(t.w, 340, 200); m.spawnT = 1; ail(t.w, m, 6); t.w.update(1 / 60); ok(!(m.mark > 0), 'a foe still spawning is not Marked'); }
  }
  { // shares the Mark with Hunter's Mark: the strongest value wins, a tie keeps the Hunter's, only a Hunter's keeps markBy (its leap)
    const { w } = stage('knight', BRAND(3)), es = [0, 1, 2, 3].map(i => foe(w, 300 + 40 * i, 200)), [e1, e2, e3, e4] = es;
    e1.mark = 2; e1.markV = BM + 0.1; e1.markBy = 'r'; e2.mark = 2; e2.markV = 0.12; e2.markBy = 'r'; e3.mark = 2; e3.markV = BM; e3.markBy = 'r'; e4.mark = 0; e4.markV = 0.12; e4.markBy = 'r';
    run(w, 0.15, keep(w, es, 4));
    ok(e1.markV === BM + 0.1 && e1.markBy === 'r' && e1.mark >= 3.8, "a stronger Hunter's Mark keeps its value and its leap");
    ok(e2.markV === BM && e2.markBy === 0, 'a weaker Mark is replaced by the Doombrand value (no leap owner)');
    ok(e3.markV === BM && e3.markBy === 'r', 'a tie keeps the existing Mark');
    ok(e4.markV === BM && e4.markBy === 0 && e4.mark > 3.5, 'an expired Mark leaves no stale leap owner');
  }
  { // two Knights: the Mark is not doubled
    const { w } = stage('knight', BRAND(3)), q = w.addPlayer({ pid: 'p1', name: 'B', slot: 1, cls: 'knight', weapon: 'longsword', meta: META() }); q.boons.k_el = 1; q.boons.k_el_a = 3; w.recalc(q, true); q.stats.crit = 0;
    const e = foe(w, 300, 200); run(w, 0.3, keep(w, [e], 5)); ok(Math.abs(e.markV - BM) < 1e-9, 'two Doombrand Knights Mark at brandMark, not double');
  }
}

// ---------------- Bloodquake: a strike on a foe with 3 ailments pays its Bleed pool out and bursts a share to its neighbours ----------------
{
  const strike = (w, p, e, part) => w.hitEnemy(e, 10, { p, kind: 'skill', part: part || 'shieldthrow.strike', noProc: true, crit: false, knock: 0 });
  const nBquake = (t) => hitsOf(t.log, 'bloodquake').length;
  const bq = (rank, ails) => { // x: 1000 Bleed, Burn and Chill (3 ailments); near 60 away, far 105 away, small (100 health) 70 away
    const t = stage('knight', RUIN(rank)), { w, p } = t; t.log = spy(w);
    t.x = foe(w, 300, 200); t.near = foe(w, 360, 200); t.near.maxHp = t.near.hp = 50000; t.far = foe(w, 405, 200); t.small = foe(w, 300, 270); t.small.maxHp = t.small.hp = 100;
    t.x.bleedPool = 1000; t.x.bleedOwner = p; t.x.bleedTick = 99; if (ails !== 2) t.x.burnPool = 600; t.x.burnTick = 99; t.x.chill = 90; t.x.chillT = 99;
    return t;
  };
  { // the detonation
    const t = bq(3), { w, p } = t, st = p.stats, hp0 = t.x.hp, paid = 1000 * (1 + st.bleedMul) * (1 + st.bloodquakeMul);
    ok(w.ailments(t.x) === 3, 'the staged foe holds 3 ailments: ' + w.ailments(t.x));
    strike(w, p, t.x);
    const ch = hitsOf(t.log, 'bloodquake');
    ok(ch.length === 1 && Math.abs(ch[0].d - paid) < 1e-6 && t.x.bleedPool === 0, 'the Bleed pool hits the foe at once for (1 + bloodquakeMul) times what it would have dealt (' + (ch[0] && ch[0].d) + ')');
    ok(hp0 - t.x.hp >= paid + 10 - 1e-6, 'on top of the strike');
    near(t.near.bleedPool, paid * st.bloodquakeSplash, 1e-6, 'a foe within 80 starts Bleeding for bloodquakeSplash of the amount paid'); near(t.far.bleedPool, 0, 1e-9, 'a foe 105 away does not'); ok(t.near.bleedOwner === p, 'the burst Bleed belongs to the Knight');
    near(t.small.bleedPool, ED.CONST.SPREAD_CAP * 100, 1e-6, 'the burst gives a foe at most 25% of its own health');
    ok(w.fx.some(f => f.t === 'bquake' && f.r === 80), 'a bq event for the viewer');
    t.x.bleedPool = 500; strike(w, p, t.x); ok(nBquake(t) === 1 && t.x.bleedPool === 500, 'at most once per second per foe');
    w.time += 1.01; strike(w, p, t.x); ok(nBquake(t) === 2, 'it detonates again after 1 s');
  }
  { // what does not detonate
    const a = bq(3, 2); strike(a.w, a.p, a.x); ok(nBquake(a) === 0 && a.x.bleedPool === 1000, 'a foe with only 2 ailments does not detonate');
    const r = bq(2); strike(r.w, r.p, r.x); ok(nBquake(r) === 0 && r.x.bleedPool === 1000, 'rank 2 has no Bloodquake');
    const o = bq(3); strike(o.w, o.p, o.x, 'shieldthrow.return'); ok(nBquake(o) === 0, 'only strikes detonate, not the return pass');
    const c = bq(3); strike(c.w, c.p, c.x, 'charge.impact'); ok(nBquake(c) === 1, 'a Shield Charge impact detonates');
    const b = bq(3); b.x.bleedPool = 0; b.x.burnPool = 600; strike(b.w, b.p, b.x); ok(nBquake(b) === 0 && !(b.x.bquakeT > b.w.time), 'with no Bleed pool there is nothing to detonate and no cooldown is spent');
  }
  { // a foe the strike kills still bursts; fodder takes part and nothing of the refund / shield / stack kind comes of it
    const t = bq(3), { w, p } = t; t.x.fodder = true; t.near.fodder = true; t.x.hp = 5;
    strike(w, p, t.x); ok(t.x.hp <= 0, 'the fodder foe dies to the strike');
    ok(nBquake(t) === 0 && Math.abs(t.near.bleedPool - 1000 * (1 + p.stats.bleedMul) * (1 + p.stats.bloodquakeMul) * p.stats.bloodquakeSplash) < 1e-6, 'a dead foe pays nothing but its fodder neighbour still catches the burst');
    ok(p.shield === 0 && !(p.kWardT > 0) && !(p.critStacks > 0) && !w.msgs.some(m => m.t === 'refund'), 'no shield, ward, crit stack or refund comes of it');
  }
  { // in play: a Shield Throw down a line of fodder holding 3 ailments detonates each of them once
    const t = stage('knight', Object.assign({ k_s2: 1 }, RUIN(3))), { w, p } = t, log = spy(w), es = [1, 2, 3, 4].map(k => foe(w, p.x + 45 * k, p.y));
    const ready = () => { for (const e of es) { e.fodder = true; e.maxHp = e.hp = 50000; if (!(e.bleedPool > 0)) { e.bleedPool = 600; e.bleedOwner = p; } e.burnPool = Math.max(e.burnPool, 600); e.chill = 90; e.chillT = 99; } };
    ready(); w.playerSkill(p, 0, { d: 280 }, 1); run(w, 3, ready);
    const ch = hitsOf(log, 'bloodquake');
    ok(ch.length >= 3 && es.filter(e => ch.some(h => h.e === e)).length >= 3, 'a Shield Throw detonates the foes it strikes (' + ch.length + ' detonations on fodder)');
    ok(es.every(e => ch.filter(h => h.e === e).length <= 1), 'once per foe within a second');
  }
}

// ---------------- boss factors of the Knight skills: Charge impact x3, Throw strike x2 (bosses are never stunned); parts derived from them keep their own ----------------
{
  const BOSS = { charge: 3, throw: 2 };
  const go = (boons, slot, data, boss, secs, at, behind) => { // one cast at a foe (common or boss), held in place so every pass of the shield finds it; behind: a second common foe 70 px further on, the shield's next ricochet target (its way home passes the first foe)
    const { w, p } = stage('knight', boons), log = spy(w), e = foe(w, p.x + (at ? at[0] : 60), p.y + (at ? at[1] : 0)), f = behind ? foe(w, e.x + 70, e.y) : e; if (boss) e.boss = true;
    w.playerSkill(p, 0, data(p), slot); let stunned = 0, shieldStun = 0;
    run(w, secs, () => { e.kbx = 0; e.kby = 0; f.kbx = 0; f.kby = 0; stunned = Math.max(stunned, e.stun); shieldStun = Math.max(shieldStun, e.shieldStunT); });
    return { w, p, e, log, stunned, shieldStun };
  };
  const chargeData = (p) => ({ x0: p.x, y0: p.y, x1: p.x + 150, y1: p.y }), throwData = () => ({ d: 280 });
  const imp = ED.SKILLS.charge.parts.find(q => q.id === 'impact'), stk = ED.SKILLS.shieldthrow.parts.find(q => q.id === 'strike');
  ok(imp.bossMul === BOSS.charge && stk.bossMul === BOSS.throw && /bosses ×3/.test(imp.note) && /bosses ×2/.test(stk.note) && /Bosses take ×3 but are never stunned/.test(ED.SKILLS.charge.desc) && /Bosses take ×2 but are never stunned/.test(ED.SKILLS.shieldthrow.desc), 'skill data and text name the boss factors (Charge x3, Throw x2)');
  { // Charge impact
    const a = go({}, 0, chargeData, false, 0.7), b = go({}, 0, chargeData, true, 0.7), ha = hitsOf(a.log, 'charge.impact'), hb = hitsOf(b.log, 'charge.impact'), N = ED.Stats.skillNums('charge', a.p.stats);
    ok(ha.length === 1 && hb.length === 1, `the Charge strikes a common foe and a boss once each (${ha.length}, ${hb.length})`);
    near(hb[0].d / ha[0].d, BOSS.charge, 1e-6, 'a boss takes x3 from the Charge impact');
    near(ha[0].d / (N.p.impact.dmg * a.p.stats.dmg), 1, 0.01, 'a common foe takes the plain impact');
    ok(a.stunned > 0.5 && b.stunned === 0 && !(b.e.stunCd > 0) && b.shieldStun === 0, `the Charge stuns a common foe (${a.stunned.toFixed(2)} s) and never a boss (${b.stunned})`);
  }
  { // Juggernaut's shockwave is derived from the impact and takes no boss factor (the Avalanche slam keeps its own x1.5, checked in check-classes)
    const sh = (boss) => go({ k_s1: 1, k_s1_a: 1 }, 0, chargeData, boss, 0.9, [144, 60]), a = sh(false), b = sh(true), ha = hitsOf(a.log, 'charge.shock'), hb = hitsOf(b.log, 'charge.shock');
    ok(ha.length === 1 && hb.length === 1 && Math.abs(hb[0].d / ha[0].d - 1) < 1e-6, `Juggernaut's shockwave deals the same to a boss and a common foe (${ha.length}, ${hb.length})`);
  }
  { // Shield Throw strike: x2 on a boss, no stun on a boss; the return pass takes no boss factor
    const a = go({}, 1, throwData, false, 2.5, null, true), b = go({}, 1, throwData, true, 2.5, null, true), ha = hitsOf(a.log, 'shieldthrow.strike').filter(h => h.e === a.e), hb = hitsOf(b.log, 'shieldthrow.strike').filter(h => h.e === b.e), ra = hitsOf(a.log, 'shieldthrow.return').filter(h => h.e === a.e), rb = hitsOf(b.log, 'shieldthrow.return').filter(h => h.e === b.e);
    ok(ha.length >= 1 && hb.length >= 1, 'the Throw strikes a common foe and a boss');
    near(hb[0].d / ha[0].d, BOSS.throw, 1e-6, 'a boss takes x2 from the Throw strike');
    ok(a.stunned > 0.5 && a.shieldStun > 0 && b.stunned === 0 && b.shieldStun === 0, `the Throw stuns a common foe (${a.stunned.toFixed(2)} s) and never a boss (${b.stunned})`);
    ok(ra.length >= 1 && rb.length >= 1 && Math.abs(rb[0].d / ra[0].d - 1) < 1e-6, `the return pass takes no boss factor (${ra.length}, ${rb.length} passes)`);
  }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
