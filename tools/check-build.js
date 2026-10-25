// Usage: node tools/check-build.js
// Headless checks of the build engine: auto-granted fork ranks (bosses II and III), the class and forge offer rules and the offer-pool hygiene (Opportunist gate, the Purse, max ranks, path reach),
// the path offers (start offer of the four gates, room path boons, cross-path cards, deep cards, filler last once two paths are owned) and the dash cap.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const build = (cls, boons, wi) => ED.Stats.compute({ cls, weapon: ED.CLASSES[cls].weapons[wi || 0], boons: boons || {}, relics: [], meta: META(), pact: 0 });
const HERO = (pid, slot, cls) => ({ pid, name: pid, slot, cls: cls || 'ranger', weapon: ED.CLASSES[cls || 'ranger'].weapons[0], meta: META() });

// A started run with heroes p0.. of the given classes; p0's boons are set and every queue cleared.
function stage(cls, boons, o) {
  o = o || {};
  const classes = [cls].concat(o.allies || []);
  const w = new ED.World({ seed: o.seed || 7, pact: 0, players: classes.map((c, i) => HERO('p' + i, i, c)) });
  w.startRun();
  for (const p of w.players.values()) { p.offers.length = 0; p.picks = 0; p.offer = null; }
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true);
  w.enemies.length = 0; w.enc = null; w.locked = false; w.msgs.length = 0; w.fx.length = 0;
  w.stratum = o.stratum || 1;
  return { w, p };
}
const bossDown = (w, s) => { w.stratum = s; w.boss = null; w.onBossKilled(w.spawnEnemy(ED.biomeFor(s).boss, 100, 100)); if (w.bossBeat) w.updateBossBeat(ED.World.BOSS_BEAT); }; // the boss kill, then its 2 s reward beat
const ranks = (w, pid) => w.msgs.filter(m => m.t === 'forkRank' && m.to === pid).map(m => m.rank);

// ---------------- fork ranks ----------------
{
  const { w, p } = stage('ranger', { r_atk: 1, r_atk_h: 1 });
  const t1 = ED.cardTotals(ED.BOONS.r_atk_h, 1), before = p.stats.deadeye;
  w.grantForkRank(p);
  ok(p.boons.r_atk_h === 2, 'grantForkRank: rank 1 -> 2');
  near(p.stats.deadeye - before, ED.cardTotals(ED.BOONS.r_atk_h, 2).deadeye - (t1.deadeye || 0), 1e-9, 'rank 2 stats are recalculated');
  ok(w.msgs.some(m => m.t === 'forkRank' && m.to === 'p0' && m.id === 'r_atk_h' && m.rank === 2), 'forkRank message to the hero');
  ok(w.fx.some(e => e.t === 'forkRank' && e.pid === 'p0' && e.id === 'r_atk_h' && e.rank === 2), 'forkRank event');
  ok(w.fx.some(e => e.t === 'build' && e.b.boons.r_atk_h === 2), 'the new rank is sent in a build event');
  w.grantForkRank(p); ok(p.boons.r_atk_h === 3, 'rank 2 -> 3');
  w.msgs.length = 0; w.grantForkRank(p); ok(p.boons.r_atk_h === 3 && !w.msgs.length && p.forkDue === 0, 'a rank-3 fork takes no more ranks');
}
{ // bosses II and III rank every hero up (downed and dead too); boss I offers the fork; no class offer from II and III; boss III leaves the epic offer and the portal; boss IV ends the run
  const { w, p } = stage('ranger', { r_atk: 1, r_atk_h: 1 }, { allies: ['knight', 'cleric'] });
  const a = w.players.get('p1'), d = w.players.get('p2');
  a.boons.k_s1 = 1; a.boons.k_s1_a = 1; d.boons.c_atk = 1; d.boons.c_atk_h = 1; w.recalc(a, true); w.recalc(d, true); a.downed = true; d.dead = true;
  for (const s of [1, 2, 3, 4]) {
    w.msgs.length = 0; for (const q of w.players.values()) q.offers.length = 0;
    bossDown(w, s);
    const want = s === 1 ? [1, 1, 1] : s === 2 ? [2, 2, 2] : [3, 3, 3];
    ok(['p0', 'p1', 'p2'].every((pid, i) => w.players.get(pid).boons[['r_atk_h', 'k_s1_a', 'c_atk_h'][i]] === want[i]), `boss ${s}: fork ranks ${want}`);
    ok([...w.players.values()].every(q => q.offers.some(o => o.src === 'class') === (s === 1)), `boss ${s}: class offer only at boss I`);
    ok(s === 2 || s === 3 ? ['p0', 'p1', 'p2'].every(pid => ranks(w, pid).length === 1) : ['p0', 'p1', 'p2'].every(pid => !ranks(w, pid).length), `boss ${s}: one forkRank message per hero at II and III only`);
    if (s === 3) ok(w.props.some(o => o.kind === 'portal') && [...w.players.values()].every(q => q.offers.some(o => o.src === 'epic')), 'boss III leaves the epic offer and the portal');
    if (s === 4) ok(w.state === 'ending' && w.victory === true, 'boss IV ends the run in victory');
  }
}
{ // ranks that come due before the fork is taken wait in forkDue and apply when the fork card is picked
  const { w, p } = stage('ranger', { r_atk: 1 });
  bossDown(w, 2); bossDown(w, 3); p.offers.length = 0; p.picks = 0; // drop the bosses' Twist offers: the class offer comes first below
  ok(p.forkDue === 2 && !p.boons.r_atk_h && !ranks(w, 'p0').length, 'no fork yet: both ranks are banked');
  p.offers.length = 0; w.grantOffer(p, { src: 'class' }); p.offer = w.rollOffer(p, p.offers[0]); // boss III's epic offer set aside
  ok(p.offers[0].ctier === 2 && p.offer.length === 2, 'the fork offer lists the two forks');
  w.pickBoon('p0', p.offer.indexOf('r_atk_h'));
  ok(p.boons.r_atk_h === 3 && p.forkDue === 0 && ranks(w, 'p0').join() === '2,3', 'picking the fork applies the banked ranks (2 then 3)');
  const q = stage('ranger'); bossDown(q.w, 2); q.p.offers.length = 0; q.p.picks = 0;
  ok(q.p.forkDue === 1 && !q.p.boons.r_atk, 'no route yet: the rank is banked');
  q.w.grantOffer(q.p, { src: 'class' }); q.p.offer = q.w.rollOffer(q.p, q.p.offers[0]); q.w.pickBoon('p0', 0);
  q.w.grantOffer(q.p, { src: 'class' }); q.p.offer = q.w.rollOffer(q.p, q.p.offers[0]); q.w.pickBoon('p0', 0);
  const fk = ED.classRoute(q.p.boons, 'ranger');
  ok(fk.fork && fk.rank === 2 && q.p.forkDue === 0, 'route, then fork: the banked rank makes it rank 2');
}
{ // no mastery tier: a class spec of a hero that holds a fork becomes a level offer; route and fork offers cannot be rerolled
  const { w, p } = stage('knight', { k_atk: 1, k_atk_h: 3 });
  const spec = { src: 'class' }, o = w.rollOffer(p, spec);
  ok(spec.src === 'level' && spec.ctier === undefined && o.length === 3 && !o.some(id => ED.BOONS[id].cls), 'class spec with a held fork: a level offer, no ctier 3');
  const { w: w2, p: p2 } = stage('knight'); p2.rerolls = 3; w2.grantOffer(p2, { src: 'class' }); p2.offer = w2.rollOffer(p2, p2.offers[0]); const keep = p2.offer.slice(); w2.reroll('p0');
  ok(p2.rerolls === 3 && p2.offer.join() === keep.join(), 'a route offer is a fixed choice: no reroll');
}

// ---------------- forge ----------------
{
  const { w, p } = stage('knight', { k_atk: 1, k_atk_h: 2, vigor: 1, focus: 1 }, { stratum: 4 });
  let bad = 0, got = new Set();
  for (let i = 0; i < 60; i++) { const o = w.rollOffer(p, { src: 'forge' }); for (const id of o) { got.add(id); if (ED.BOONS[id].route) bad++; } }
  ok(!bad && got.has('vigor') && got.has('focus') && got.size === 2, `forge offers only boons below max rank, never route or fork cards (${[...got]})`);
  const { w: w2, p: p2 } = stage('knight', { k_atk: 1, k_atk_h: 2 }); const sp = { src: 'forge' }, o = w2.rollOffer(p2, sp);
  ok(sp.src === 'level' && !o.some(id => ED.BOONS[id].route), 'a forge with only route cards to rank turns into a level offer');
}

// ---------------- Opportunist gate ----------------
{
  const dz = (cls, boons, set) => { const { w, p } = stage(cls, boons); if (set) Object.assign(p.stats, set); return w.canDaze(p); };
  ok(dz('knight') && dz('shade'), 'Knight (Charge, Throw stun) and Shade (Vanish blinds) can always daze');
  ok(!dz('ranger') && !dz('pyro') && !dz('cleric') && !dz('necro'), 'Ranger, Pyromancer, Cleric and Necromancer have no stun, freeze or blind in the base kit');
  ok(dz('ranger', { r_atk: 1, r_atk_h: 1 }) && !dz('ranger', { r_atk: 1, r_atk_s: 1 }), 'a Heavy fork Staggers; a Swift fork does not');
  ok(dz('ranger', { r_s2: 1, r_s2_a: 1 }), 'Skyfall stuns (skill part)');
  for (const k of ['iceInfuse', 'arcStun', 'waveStun', 'sanctStun', 'cStun', 'chargeStun', 'wallStun', 'knightStun', 'cometStun', 'parry']) ok(dz('ranger', {}, { [k]: 1 }), `stat ${k} counts`);
  ok(dz('cleric', {}, { verdict: 1 }) && !dz('cleric', {}, { verdict: 0 }), 'Verdict stuns (skill part, needs its stat)');
  ok(dz('cleric', { c_atk: 1, c_atk_h: 1 }) && dz('cleric', {}, { waveStun: 0.4 }) && dz('cleric', {}, { sanctStun: 0.5 }), 'Cleric: Heavy, Wave of light and Sanctuary stuns');
  ok(dz('necro', {}, { knightStun: 0.5 }) && dz('pyro', {}, { cometStun: 0.5 }), 'Necromancer Ironbone and Pyromancer Impact Crater stun');
  // the card follows the gate: a Steel Ranger never sees it, a Steel Knight can
  const seen = (cls, boons) => { const { w, p } = stage(cls, Object.assign({ generalist: 1 }, boons)); for (let i = 0; i < 400; i++) if (w.rollOffer(p, { src: 'level' }).includes('opportunist')) return true; return false; };
  ok(!seen('ranger') && seen('knight') && seen('shade') && seen('ranger', { r_atk: 1, r_atk_h: 1 }), 'Opportunist is offered only to heroes that can daze a foe');
  const { w, p } = stage('ranger', { generalist: 1 }); ok(!w.rollOffer(p, { src: 'room' }).includes('opportunist') && !w.rollOffer(p, { src: 'epic' }).includes('opportunist'), 'also absent from room and epic offers');
}

// ---------------- exhausted pool: the Purse; picks respect max rank ----------------
{
  // Takes every card each level offer shows (to its max rank) until the offer is the Purse; returns the staged hero and the offers it took.
  const exhaust = (cls, boons) => {
    const { w, p } = stage(cls, boons); let i = 0;
    for (; i < 400; i++) {
      const o = w.rollOffer(p, { src: 'level' });
      if (o.includes('purse')) break;
      for (const id of o) p.boons[id] = ED.maxRank(ED.BOONS[id], p.stats);
      w.recalc(p, true);
    }
    return { w, p, i };
  };
  const bare = (o) => o.filter(id => !ED.BOONS[id].evo);
  const pick = (w, p, offer, i) => { p.offer = offer.slice(); p.offers = [{ src: 'level', path: null }]; p.picks = 1; w.msgs.length = 0; w.fx.length = 0; w.pickBoon('p0', i || 0); };

  // (a) a hero with an exhausted pool is offered the Purse, never Vigor
  const ex = exhaust('knight', { generalist: 1 });
  ok(ex.i > 3 && ex.i < 400, `a Steel Knight exhausts the pool after ${ex.i} offers`);
  for (const src of ['level', 'room', 'epic']) {
    const o = ex.w.rollOffer(ex.p, { src });
    ok(bare(o).join() === 'purse', `exhausted pool, ${src} offer: the Purse alone (${o})`);
  }
  const ex2 = exhaust('ranger', { kindle: 1 });
  ok(ex2.i < 400 && ex2.p.boons.vigor === ED.maxRank(ED.BOONS.vigor, ex2.p.stats) && bare(ex2.w.rollOffer(ex2.p, { src: 'room' })).join() === 'purse', 'an element hero with every card maxed: Vigor at its max rank, then the Purse');
  { // the Purse is in no pool: 300 offers of every source, none with it

    const st = stage('ranger', { kindle: 1 }); let seen = 0;
    for (const src of ['level', 'room', 'epic', 'forge']) for (let i = 0; i < 75; i++) if (st.w.rollOffer(st.p, { src }).includes('purse')) seen++;
    ok(!seen, 'a hero with open cards left is never offered the Purse');
  }
  // (b) picking the Purse pays a gold room's reward to the party and records no rank
  {
    const { w, p } = stage('ranger', { kindle: 1 }, { stratum: 3 }), g0 = w.gold, b0 = JSON.stringify(p.boons), aff0 = ED.pathAffinity(p.boons, 'fire');
    pick(w, p, ['purse']);
    ok(w.gold - g0 === ED.World.rewardGold(3) && ED.World.rewardGold(3) === Math.round(39 * ED.World.GOLD_MUL), `the Purse pays the gold room reward (${w.gold - g0} at stratum III)`);
    ok(JSON.stringify(p.boons) === b0 && !('purse' in p.boons) && ED.pathAffinity(p.boons, 'fire') === aff0, 'the Purse leaves p.boons and the path affinity untouched');
    ok(p.offer === null && p.offers.length === 0 && p.picks === 0 && w.msgs.some(m => m.t === 'offerDone' && m.to === 'p0'), 'the Purse pick ends the offer');
    ok(!w.fx.some(e => e.t === 'build') && w.fx.some(e => e.t === 'boon' && e.id === 'purse') && w.fx.some(e => e.t === 'gold' && e.v === ED.World.rewardGold(3)), 'no build event; a gold event and a purse boon event (the pick burst)');
    ok(ED.Sheet.text('purse', 1, p.stats, 3) === `+${ED.World.rewardGold(3)} gold for the party.` && !/[{}]/.test(ED.Sheet.text('purse', 1, p.stats)), 'the card text names the real amount');
    for (let s = 1; s <= ED.CONST.STRATA; s++) ok(ED.World.rewardGold(s) > 0, `the Purse pays gold at stratum ${s}`);
  }
  // (c) a pick of a card at its max rank grants nothing but still consumes the offer
  {
    const { w, p } = stage('ranger', { kindle: 1, focus: 3, r_atk: 1, r_atk_h: 3 }), cdr = p.stats.cdr, b0 = JSON.stringify(p.boons);
    pick(w, p, ['focus', 'plating']);
    ok(p.boons.focus === 3 && p.stats.cdr === cdr && JSON.stringify(p.boons) === b0, 'focus at its max rank: a pick changes nothing');
    ok(p.offer === null && p.offers.length === 0 && p.picks === 0 && w.msgs.some(m => m.t === 'offerDone') && !w.fx.some(e => e.t === 'boon' || e.t === 'build'), 'the offer is consumed and no boon event is sent');
    p.forkDue = 0; pick(w, p, ['r_atk_h']);
    ok(p.boons.r_atk_h === 3 && !w.msgs.some(m => m.t === 'forkRank'), 'a fork at rank 3 stays at rank 3');
    pick(w, p, ['focus', 'plating'], 1); ok(p.boons.plating === 1, 'a card below its max rank is still granted');
    pick(w, p, ['kindle']); ok(p.boons.kindle === 1, 'a max-1 card already owned stays at 1');
    const g = stage('knight', { generalist: 1, focus: 3 }); pick(g.w, g.p, ['focus']); ok(g.p.boons.focus === 3, 'a Steel hero gains no extra rank on open cards');
  }
  // (d) Vigor never exceeds rank 3, by picks and by the pool run dry
  {
    const { w, p } = stage('ranger', { kindle: 1 });
    for (let i = 0; i < 6; i++) pick(w, p, ['vigor']);
    ok(p.boons.vigor === 3, `Vigor stays at rank 3 after six picks (got ${p.boons.vigor})`);
    ok(ex2.p.boons.vigor === 3, 'Vigor is 3 after the pool ran dry (never raised by the fallback)');
    const hp = p.stats.maxHp; pick(w, p, ['vigor']); ok(p.stats.maxHp === hp, 'a seventh Vigor adds no health');
    ok(ex.p.boons.vigor === 3, 'a Steel hero holds Vigor to 3');
  }
}

// ---------------- Second Wind: rises outside boss fights only ----------------
{
  const { w, p } = stage('knight'); p.secondWind = 1; p.swPct = 0.1;
  w.boss = { id: 'x' }; p.hp = 0; w.playerLethal(p); ok(p.downed && p.secondWind === 1, 'Second Wind does not fire during a boss fight');
  const b = stage('knight'), q = b.p; q.secondWind = 1; q.swPct = 0.1; b.w.boss = null; q.hp = 0; b.w.playerLethal(q);
  ok(!q.downed && q.secondWind === 0, 'Second Wind fires outside a boss fight'); near(q.hp, Math.round(q.maxHp * 0.1), 1e-9, 'rises at 10% health');
}

// ---------------- paths: live cards reach the keystone and evolution; pool depth, deep and cross-path cards ----------------
{
  const PCT = ['dmg', 'crit', 'critDmg', 'atk', 'burnMul', 'chillMul', 'shockMul', 'area', 'cdr']; // plain percent stats
  ok(ED.PATH_IDS.join() === 'general,fire,ice,lightning' && ED.MAX_PATHS === 2, `four paths, two at most (${ED.PATH_IDS})`);
  for (const el of ED.PATH_IDS) {
    let r = 0;
    for (const id in ED.BOONS) { const b = ED.BOONS[id]; if (b.path === el && !b.retired && !b.key && !b.evo && !b.cls && !b.deep) r += b.max || 1; }
    ok(r >= ED.KEY_AFFINITY && r + 1 >= ED.EVO_AFFINITY, `${el}: ${r} stratum I path ranks + keystone reach the evolution (${ED.EVO_AFFINITY})`);
    const ids = ED.BOON_IDS.filter(id => ED.BOONS[id].path === el && !ED.BOONS[id].cls);
    ok(ids.filter(id => ED.BOONS[id].gate).length === 1 && ids.filter(id => ED.BOONS[id].key).length === 1 && ids.filter(id => ED.BOONS[id].evo).length === 1, `${el}: one gate, one keystone, one evolution`);
    const pool = ids.filter(id => !ED.BOONS[id].gate && !ED.BOONS[id].key && !ED.BOONS[id].evo), deep = pool.filter(id => ED.BOONS[id].deep);
    ok(pool.length >= 7 && pool.length <= 9, `${el}: ${pool.length} path boons (${pool.join(' ')})`);
    ok(deep.length >= 2 && deep.length <= 3 && deep.every(id => ED.BOONS[id].deep >= 2 && ED.BOONS[id].deep <= 3), `${el}: 2-3 deep cards (${deep.join(' ')})`);
    const ev = ED.BOONS['evo_' + el];
    ok(!Object.keys(ev.mods || {}).some(k => PCT.includes(k)) && !ev.strikes, `${el}: the evolution changes behaviour only (no percent stat, no added shots)`);
    ok(!Object.keys(ED.BOONS[ids.find(id => ED.BOONS[id].key)].mods).some(k => PCT.includes(k)), `${el}: the keystone is no plain percent`);
  }
  const cross = ED.BOON_IDS.filter(id => ED.BOONS[id].cross);
  for (let i = 0; i < ED.PATH_IDS.length; i++) for (let j = i + 1; j < ED.PATH_IDS.length; j++) {
    const a = ED.PATH_IDS[i], b = ED.PATH_IDS[j], c = cross.filter(id => ED.BOONS[id].cross.includes(a) && ED.BOONS[id].cross.includes(b));
    ok(c.length === 1, `${a} + ${b}: one cross-path card (${c})`);
    const one = stage('ranger', { [ED.PATH_GATE[a]]: 1 }), both = stage('ranger', { [ED.PATH_GATE[a]]: 1, [ED.PATH_GATE[b]]: 1 });
    let s1 = 0, s2 = 0;
    for (let k = 0; k < 200; k++) { if (one.w.rollOffer(one.p, { src: 'level' }).includes(c[0])) s1++; if (both.w.rollOffer(both.p, { src: 'level' }).includes(c[0])) s2++; }
    ok(!s1 && s2 > 0, `${c[0]}: offered only with both paths (one path ${s1}, both ${s2} of 200)`);
  }
  { // deep cards wait for their stratum
    const s1 = stage('knight', { generalist: 1 }), s3 = stage('knight', { generalist: 1 }, { stratum: 3 });
    let a = 0, b = 0;
    for (let k = 0; k < 300; k++) { if (s1.w.rollOffer(s1.p, { src: 'level' }).some(id => ED.BOONS[id].deep)) a++; if (s3.w.rollOffer(s3.p, { src: 'level' }).some(id => ED.BOONS[id].deep)) b++; }
    ok(!a && b > 0, `deep cards: none on stratum I (${a}), offered on stratum III (${b} of 300)`);
  }
  { // start offer: the four gates for every hero
    for (const cls of ED.CLASS_IDS) { const { w, p } = stage(cls); const o = w.rollOffer(p, { src: 'start' }); ok(o.join() === ED.PATH_IDS.map(k => ED.PATH_GATE[k]).join(), `${cls}: start offer is the four gates (${o})`); }
  }
  { // filler (vigor, plating, evasion, light step) only fills a short offer once two paths are owned
    const { w, p } = stage('ranger', { kindle: 1, frostbite: 1 });
    let f = 0;
    for (let k = 0; k < 300; k++) if (w.rollOffer(p, { src: 'level' }).some(id => ED.BOONS[id].filler)) f++;
    const one = stage('ranger', { kindle: 1 }); let f1 = 0;
    for (let k = 0; k < 300; k++) if (one.w.rollOffer(one.p, { src: 'level' }).some(id => ED.BOONS[id].filler)) f1++;
    ok(!f && f1 > 0, `filler: never with two paths and cards left (${f}), offered with one path (${f1} of 300)`);
  }
  { // room path boons: the gate first while a slot is free, then that path's cards; a hero with two other paths gets a plain room offer
    const a = stage('knight'); const o1 = a.w.rollOffer(a.p, { src: 'room', path: 'fire' });
    ok(o1[0] === 'kindle' && o1.slice(1).every(id => ED.BOONS[id].path === 'fire' || (ED.BOONS[id].cross && ED.BOONS[id].cross.includes('fire')) || ED.BOONS[id].open), `room Flame boon, no path: the Flame gate first (${o1})`);
    const b = stage('knight', { kindle: 1 }); let okB = true;
    for (let k = 0; k < 100; k++) { const o = b.w.rollOffer(b.p, { src: 'room', path: 'fire' }).filter(id => !ED.BOONS[id].evo); if (!o.every(id => (ED.BOONS[id].path === 'fire' && !ED.BOONS[id].gate) || (ED.BOONS[id].cross && ED.BOONS[id].cross.includes('fire')))) { okB = false; break; } }
    ok(okB, 'room Flame boon, Flame owned: Flame cards only');
    const c = stage('knight', { generalist: 1, frostbite: 1 }); let gate = 0, fire = 0;
    for (let k = 0; k < 100; k++) { const o = c.w.rollOffer(c.p, { src: 'room', path: 'fire' }); if (o.some(id => ED.BOONS[id].gate)) gate++; if (o.some(id => ED.BOONS[id].path === 'fire')) fire++; }
    ok(!gate && !fire, `room Flame boon, two other paths: a plain room offer (gates ${gate}, Flame cards ${fire})`);
    const d = stage('knight', { generalist: 1 }); const pr = d.w.rollOffer(d.p, { src: 'room', path: 'lightning' });
    ok(pr[0] === 'staticcharge', `room Storm boon with one path and a free slot: the Storm gate first (${pr})`);
  }
  { // floor gen: about 70% of boon rooms name a path, deterministic per seed
    let n = 0, pth = 0, same = true;
    for (let seed = 1; seed <= 40; seed++) for (let s = 1; s <= 3; s++) {
      const f = ED.Dungeon.generate(s, seed), g = ED.Dungeon.generate(s, seed);
      for (let i = 0; i < f.rooms.length; i++) { const r = f.rooms[i]; if (r.rewardPath !== g.rooms[i].rewardPath) same = false; if (r.reward === 'boon') { n++; if (r.rewardPath) pth++; } else if (r.rewardPath) same = false; }
    }
    ok(same && n > 50 && pth / n > 0.6 && pth / n < 0.8, `room path boons: ${pth} of ${n} boon rooms name a path, deterministic`);
  }
}

// ---------------- dash: at most 2 charges ----------------
{
  ok(ED.BOONS.lightstep.max === 1, 'Light Step has one rank');
  const st = ED.Stats.compute({ cls: 'shade', weapon: ED.CLASSES.shade.weapons[0], boons: { lightstep: 1 }, relics: ['cloak'], meta: { up: ED.UPGRADES.map(() => 9), mastery: 9, relics: [] }, pact: 0 });
  ok(st.dashCharges <= 2 && !('dashcdr' in st), `dash charges capped at 2 (${st.dashCharges}), no dash cooldown stat`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
