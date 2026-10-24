// Usage: node tools/check-build.js
// Headless checks of the build engine: auto-granted fork ranks (bosses II and IV), the class and forge offer rules, the Ascended framework (eligibility, slot-1 pin, multiplicative bucket, sheet rows) and the offer-pool hygiene
// (Opportunist gate, utility weights). Prints failures and exits 1 when any check fails.
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
const bossDown = (w, s) => { w.stratum = s; w.boss = null; w.onBossKilled(w.spawnEnemy(ED.biomeFor(s).boss, 100, 100)); };
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
{ // bosses II and IV rank every hero up (downed and dead too); boss I offers the fork; no class offer from II and IV; the other boss rewards stay
  const { w, p } = stage('ranger', { r_atk: 1, r_atk_h: 1 }, { allies: ['knight', 'cleric'] });
  const a = w.players.get('p1'), d = w.players.get('p2');
  a.boons.k_s1 = 1; a.boons.k_s1_a = 1; d.boons.c_atk = 1; d.boons.c_atk_h = 1; w.recalc(a, true); w.recalc(d, true); a.downed = true; d.dead = true;
  for (const s of [1, 2, 3, 4, 5]) {
    w.msgs.length = 0; for (const q of w.players.values()) q.offers.length = 0;
    bossDown(w, s);
    const want = s === 1 ? [1, 1, 1] : s === 2 ? [2, 2, 2] : s === 3 ? [2, 2, 2] : [3, 3, 3];
    ok(['p0', 'p1', 'p2'].every((pid, i) => w.players.get(pid).boons[['r_atk_h', 'k_s1_a', 'c_atk_h'][i]] === want[i]), `boss ${s}: fork ranks ${want}`);
    ok([...w.players.values()].every(q => q.offers.some(o => o.src === 'class') === (s === 1)), `boss ${s}: class offer only at boss I`);
    ok(s === 2 || s === 4 ? ['p0', 'p1', 'p2'].every(pid => ranks(w, pid).length === 1) : ['p0', 'p1', 'p2'].every(pid => !ranks(w, pid).length), `boss ${s}: one forkRank message per hero at II and IV only`);
    if (s === 5) ok(w.props.some(o => o.kind === 'portal') && [...w.players.values()].every(q => q.offers.some(o => o.src === 'epic')), 'boss rewards stay (epic offer, portal)');
  }
}
{ // ranks that come due before the fork is taken wait in forkDue and apply when the fork card is picked
  const { w, p } = stage('ranger', { r_atk: 1 });
  bossDown(w, 2); bossDown(w, 4);
  ok(p.forkDue === 2 && !p.boons.r_atk_h && !ranks(w, 'p0').length, 'no fork yet: both ranks are banked');
  w.grantOffer(p, { src: 'class' }); p.offer = w.rollOffer(p, p.offers[0]);
  ok(p.offers[0].ctier === 2 && p.offer.length === 2, 'the fork offer lists the two forks');
  w.pickBoon('p0', p.offer.indexOf('r_atk_h'));
  ok(p.boons.r_atk_h === 3 && p.forkDue === 0 && ranks(w, 'p0').join() === '2,3', 'picking the fork applies the banked ranks (2 then 3)');
  const q = stage('ranger'); bossDown(q.w, 2);
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
  const { w, p } = stage('knight', { k_atk: 1, k_atk_h: 2, vigor: 1, edge: 1 }, { stratum: 5 });
  let bad = 0, got = new Set();
  for (let i = 0; i < 60; i++) { const o = w.rollOffer(p, { src: 'forge' }); for (const id of o) { got.add(id); if (ED.BOONS[id].route) bad++; } }
  ok(!bad && got.has('vigor') && got.has('edge') && got.size === 2, `forge offers only boons below max rank, never route or fork cards (${[...got]})`);
  const { w: w2, p: p2 } = stage('knight', { k_atk: 1, k_atk_h: 2 }); const sp = { src: 'forge' }, o = w2.rollOffer(p2, sp);
  ok(sp.src === 'level' && !o.some(id => ED.BOONS[id].route), 'a forge with only route cards to rank turns into a level offer');
}

// ---------------- Ascended: data ----------------
{
  ok(ED.RARITY.a && ED.RARITY.a.name === 'Ascended' && ED.RARITY.a.color === '#ff5fd2' && ED.RARITY.a.w === 0, 'RARITY.a');
  ok(ED.ASC_STRATUM === 4 && ED.ASC_PER_STRATUM === 2 && ED.ASC_IDS.length === 12, 'Ascended constants and 12 cards');
  const allOk = ED.ASC_IDS.every(id => { const b = ED.BOONS[id], base = ED.BOONS[b.asc]; return b.rar === 'a' && b.max === 1 && !b.path && b.asc && ED.ASCENDED[b.asc] && b.mods && b.x && (!base.need || b.need === base.need) && !/[{}\[\]]/.test(b.desc); });
  ok(allOk, 'every Ascended card: rarity a, max 1, no path, base need carried, plain desc');
  ok(ED.BOONS.asc_split.need === 'proj' && ED.BOONS.asc_pierce.need === 'proj' && !ED.BOONS.asc_edge.need, 'Arrow Storm and Impaler need a projectile weapon');
  ok(ED.pathAffinity({ asc_edge: 1, asc_lacerate: 1, generalist: 1 }, 'general') === 1 && ED.PATH_IDS.every(k => ED.pathAffinity({ asc_edge: 1, asc_keen: 1 }, k) === 0), 'Ascended cards count toward no affinity');
}

// ---------------- Ascended: eligibility ----------------
{
  const { w, p } = stage('ranger', { edge: 2 }, { stratum: 4 });
  ok(w.ascCards(p).join() === 'asc_edge', 'stratum IV, edge maxed: Honed Edge is eligible');
  w.stratum = 3; ok(!w.ascCards(p).length, 'stratum III: none');
  w.stratum = 4; p.boons.edge = 1; ok(!w.ascCards(p).length, 'base below its max rank: none');
  p.boons.edge = 2; p.boons.asc_edge = 1; ok(!w.ascCards(p).length, 'card already owned: none');
  delete p.boons.asc_edge; p.ascN = 2; ok(!w.ascCards(p).length, 'two Ascended taken this stratum: none');
  p.ascN = 1; ok(w.ascCards(p).length === 1, 'one taken: still eligible');
  p.ascN = 0; p.boons.split = 2; p.boons.keen = 1; w.recalc(p, false);
  ok(w.ascCards(p).sort().join() === 'asc_edge,asc_keen,asc_split', 'projectile weapon: Arrow Storm eligible; Keen Eye is maxed at rank 1 for an element hero');
  const k = stage('knight', { split: 2, pierce: 2, edge: 2 }, { stratum: 5 });
  ok(k.w.ascCards(k.p).join() === 'asc_edge', 'melee weapon: Arrow Storm and Impaler are not eligible');
  const g = stage('knight', { generalist: 1, edge: 2, lacerate: 2 }, { stratum: 4 });
  ok(g.w.ascCards(g.p).join() === 'asc_lacerate', 'a Generalist needs its open boons one rank higher (edge 3), General boons at their max');
  g.p.boons.edge = 3; g.w.recalc(g.p, false); ok(g.w.ascCards(g.p).sort().join() === 'asc_edge,asc_lacerate', 'Generalist: edge at 3 qualifies');
}
{ // per-stratum cap: picks count in pickBoon and reset when a stratum starts
  const { w, p } = stage('knight', { edge: 2, quick: 2, plating: 2 }, { stratum: 4 });
  p.offer = ['asc_edge', 'vigor']; p.offers.push({ src: 'level', path: null }); p.picks = 1; w.pickBoon('p0', 0);
  ok(p.boons.asc_edge === 1 && p.ascN === 1 && w.ascCards(p).length === 2, 'first pick counts');
  p.offer = ['asc_quick']; p.offers.push({ src: 'level', path: null }); p.picks = 1; w.pickBoon('p0', 0);
  ok(p.ascN === 2 && !w.ascCards(p).length, 'the second pick closes the stratum');
  w.onStratumBuild(p, 5); w.stratum = 5; ok(p.ascN === 0 && w.ascCards(p).join() === 'asc_plating', 'a new stratum reopens it');
}

// ---------------- Ascended: offers ----------------
{
  const { w, p } = stage('ranger', { edge: 2, split: 2, quick: 2 }, { stratum: 4 });
  for (const src of ['level', 'room', 'epic']) {
    const want = src === 'epic' ? 4 : 3; let pinned = 0, pool = new Set(), len = 0, dup = 0;
    for (let i = 0; i < 40; i++) { const o = w.rollOffer(p, { src }); if (o[0].indexOf('asc_') === 0) pinned++; pool.add(o[0]); if (o.length === want) len++; if (new Set(o).size !== o.length) dup++; }
    ok(pinned === 40 && len === 40 && !dup, `${src} offer: an Ascended card in slot 1, ${want} cards, no duplicates`);
    ok(pool.size === 3, `${src} offer: the pin is drawn uniformly from the eligible cards (${[...pool]})`);
  }
  for (const src of ['start', 'class', 'forge']) {
    let any = 0;
    for (let i = 0; i < 40; i++) { const o = w.rollOffer(p, { src }); if (o.some(id => ED.BOONS[id].asc)) any++; }
    ok(!any, `${src} offer never holds an Ascended card`);
  }
  p.ascN = 2; let any = 0; for (let i = 0; i < 40; i++) if (w.rollOffer(p, { src: 'level' }).some(id => ED.BOONS[id].asc)) any++; ok(!any, 'cap reached: not offered');
  w.stratum = 3; p.ascN = 0; any = 0; for (let i = 0; i < 40; i++) if (w.rollOffer(p, { src: 'level' }).some(id => ED.BOONS[id].asc)) any++; ok(!any, 'stratum III: not offered');
}
{ // behind the prepended evolution card: [evo, Ascended, ...]
  const { w, p } = stage('pyro', { kindle: 1, fuel: 2, stoke: 3, searing: 2, wildfire: 2, conflag: 1, edge: 2 }, { stratum: 5 });
  ok(w.evoPaths(p).join() === 'fire', 'fire evolution is available');
  let good = 0; for (let i = 0; i < 30; i++) { const o = w.rollOffer(p, { src: 'room' }); if (o[0] === 'evo_fire' && o[1] === 'asc_edge' && o.length === 4) good++; }
  ok(good === 30, 'room offer: evolution card first, then the Ascended card, then the draw (3 cards + evolution)');
}

// ---------------- Ascended: stat bucket ----------------
{
  const base = build('knight', { edge: 2 }), asc = build('knight', { edge: 2, asc_edge: 1 });
  near(asc.dmg, base.dmg * 1.15, 1e-9, 'Honed Edge: damage = additive total x 1.15');
  near(build('knight', { edge: 2, glass: 1, asc_edge: 1 }).dmg, build('knight', { edge: 2, glass: 1 }).dmg * 1.15, 1e-9, 'it multiplies every additive damage source (Glass Heart too)');
  const sp = build('ranger', { split: 2, pierce: 2 }), both = build('ranger', { split: 2, pierce: 2, asc_split: 1, asc_pierce: 1 });
  near(both.dmg, sp.dmg * 1.1 * 1.1, 1e-9, 'two x on one key multiply (1.1 x 1.1)');
  near(build('ranger', { split: 2, pierce: 2, edge: 2, asc_split: 1, asc_pierce: 1, asc_edge: 1 }).dmg, build('ranger', { split: 2, pierce: 2, edge: 2 }).dmg * 1.1 * 1.1 * 1.15, 1e-9, 'three Ascended multiply');
  ok(both.projN === sp.projN + 1 && both.pierce === sp.pierce + 2, 'Arrow Storm and Impaler mods add (+1 projectile, +2 pierce)');
  near(build('ranger', { quick: 2, asc_quick: 1 }).atk, build('ranger', { quick: 2 }).atk * 1.15, 1e-9, 'Blur: attack speed x 1.15');
  const k0 = build('ranger', { keen: 1 }), k1 = build('ranger', { keen: 1, asc_keen: 1 });
  near(k1.crit, Math.min(0.95, k0.crit * 1.3), 1e-9, 'Hawk Eye: crit chance x 1.3'); near(build('ranger', { brutal: 1, asc_brutal: 1 }).critMult - 1.75, (build('ranger', { brutal: 1 }).critMult - 1.75) * 1.5, 1e-9, 'Savage: crit damage bonus x 1.5');
  near(build('knight', { wide: 2, asc_wide: 1 }).area, build('knight', { wide: 2 }).area * 1.5, 1e-9, 'Vast: area x 1.5');
  near(build('knight', { plating: 2, asc_plating: 1 }).armor, build('knight', { plating: 2 }).armor * 1.5, 1e-9, 'Bastion: armor x 1.5');
  near(build('knight', { vigor: 3, asc_vigor: 1 }).hpMul, build('knight', { vigor: 3 }).hpMul * 1.12, 1e-9, 'Titan: health multiplier x 1.12');
  ok(build('knight', { vigor: 3, asc_vigor: 1 }).maxHp > build('knight', { vigor: 3 }).maxHp, 'Titan raises max health');
  const gen = { generalist: 1, lacerate: 2, execute: 2, deepcuts: 2 }, g1 = build('knight', Object.assign({ asc_lacerate: 1, asc_execute: 1, asc_deepcuts: 1 }, gen)), g0 = build('knight', gen);
  near(g1.lacerate, g0.lacerate * 2, 1e-9, 'Hemorrhage doubles lacerate'); near(g1.execute, g0.execute * 2, 1e-9, 'Headsman doubles execute'); near(g1.bleedMul, g0.bleedMul * 1.5, 1e-9, 'Bloodletting: bleed x 1.5');
  ok(build('knight', { asc_edge: 1 }).dmg === 1.15 && build('knight', { asc_wide: 1 }).area === 0, 'a multiplier on a stat with no bonus keeps it (area 0)');
  const sources = ED.Stats.sources({ cls: 'knight', weapon: 'longsword', boons: { edge: 2, asc_edge: 1 }, relics: [], meta: META(), pact: 0 }), row = sources.find(r => r.id === 'asc_edge');
  ok(row && row.kind === 'asc' && row.x.dmg === 0.15 && row.n === 1, 'St.sources: an asc row carries x');
  const br = ED.Stats.breakdown({ cls: 'knight', weapon: 'longsword', boons: { edge: 2, asc_edge: 1 }, relics: [], meta: META(), pact: 0 }, 'dmg'), last = br[br.length - 1];
  ok(last.mul === true && last.kind === 'asc' && last.v === 0.15 && br.filter(r => r.mul).length === 1 && br[0].kind === 'base', 'St.breakdown: a multiplier row after the additive rows');
  const add = br.filter(r => !r.mul).reduce((a, r) => a + r.v, 0);
  near(add * (1 + last.v), asc.dmg, 1e-9, 'breakdown rows reproduce the stat (sum x factor)');
}

// ---------------- Ascended: the damage factor reaches conditional and class damage ----------------
{
  const hit = (boons) => { // one skill hit on a foe that meets Execute, Lacerate, Brittle, Death Knell and Shade Momentum at once
    const { w, p } = stage('shade', boons);
    Object.assign(p.stats, { execute: 0.4, lacerate: 0.3, brittle: 0.2, knell: 5, momentum: 0.05, classElMul: 0.25 });
    p.knellT = 6; p.knellN = 3; p.momT = 5; p.momN = 4;
    const e = w.spawnEnemy('skeleton', p.x + 40, p.y); e.spd = 0; e.cd = 9999; e.maxHp = 1e6; e.hp = 1e5; e.bleedPool = 50; e.chill = 50;
    return { got: w.hitEnemy(e, 100, { p, kind: 'skill', crit: false, noProc: true, clsEl: 'shadow' }), st: p.stats };
  };
  const a = hit({ edge: 2 }), b = hit({ edge: 2, asc_edge: 1 }), c = hit({ edge: 2, split: 2, pierce: 2, asc_split: 1, asc_pierce: 1, asc_edge: 1 });
  ok(a.st.dmgX === 1 && build('shade', {}).dmgX === 1, 'dmgX is 1 without an Ascended damage card');
  near(b.st.dmgX, 1.15, 1e-12, 'Honed Edge: dmgX 1.15');
  near(b.got / a.got, 1.15, 1e-9, 'Honed Edge: a hit on a foe meeting every conditional row (and class Momentum) is exactly 1.15 x the same hit without the card');
  near(c.st.dmgX, 1.1 * 1.1 * 1.15, 1e-12, 'three damage cards: dmgX is the product of their factors');
  near(c.got / hit({ edge: 2, split: 2, pierce: 2 }).got, 1.1 * 1.1 * 1.15, 1e-9, 'three damage cards scale the conditional hit by their product');
  const rows = (boons) => { const { w, p } = stage('shade', boons); Object.assign(p.stats, { execute: 0.4, brittle: 0.2 }); return ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true }).mult.cond; };
  near(rows({ edge: 2, asc_edge: 1 }).find(r => r.id === 'execute').v, 0.4 * 1.15, 1e-9, 'the sheet shows a conditional row x dmgX'); near(rows({ edge: 2 }).find(r => r.id === 'execute').v, 0.4, 1e-9, 'and unchanged without the card');
}

// ---------------- Ascended: sheet ----------------
{
  const { w, p } = stage('ranger', { edge: 2, split: 2, asc_edge: 1, asc_split: 1 }, { stratum: 4 });
  const ctx = ED.Sheet.ctx(w, p), m = ED.Sheet.compute(p, ctx, { raw: true });
  const grp = m.build.groups.find(g => g.group === 'asc');
  ok(grp && grp.items.map(r => r.id).sort().join() === 'asc_edge,asc_split' && grp.items.every(r => r.kind === 'ascended' && r.rar === 'a' && r.next === null && r.text.length > 10), 'Build tab: an Ascended group with both cards');
  ok(m.build.groups.find(g => g.group === 'open').items.every(r => !ED.BOONS[r.id].asc), 'Ascended cards leave the Open group');
  const dr = m.mult.dmg.rows, mr = dr.filter(r => r.mul);
  ok(mr.length === 2 && mr.every(r => r.kind === 'asc') && mr.map(r => r.v).sort().join() === '0.1,0.15', 'offence rows: dmg multiplier chips from Honed Edge and Arrow Storm');
  ok(m.mult.projN.rows.some(r => r.id === 'asc_split' && !r.mul && r.v === 1), 'projectile rows: Arrow Storm +1');
  near(m.mult.crit.base, 1.75, 1e-9, 'crit damage base excludes multipliers');
  // withBoon / deltas on an Ascended card
  const p0 = stage('ranger', { edge: 2 }, { stratum: 4 }).p, a = ED.Sheet.compute(p0, ctx, { raw: true }), b = ED.Sheet.compute(ED.Sheet.withBoon(p0, 'asc_edge', ctx), ctx, { raw: true });
  near(b.weapon.dps / a.weapon.dps, 1.15 / 1, 0.02, 'withBoon: Honed Edge raises weapon dps by about 15%');
  const dl = ED.Sheet.deltas(a, b);
  ok(dl.length >= 1 && dl[0].label === 'Weapon' && dl[0].better, 'deltas names the weapon change');
  ok(ED.Sheet.text('asc_edge', 1, p0.stats).indexOf('1.15') >= 0, 'Sheet.text prints the exact number');
}

// ---------------- Opportunist gate ----------------
{
  const dz = (cls, boons, set) => { const { w, p } = stage(cls, boons); if (set) Object.assign(p.stats, set); return w.canDaze(p); };
  ok(dz('knight') && dz('shade'), 'Knight (Charge, Throw stun) and Shade (Vanish blinds) can always daze');
  ok(!dz('ranger') && !dz('pyro') && !dz('cleric') && !dz('necro'), 'Ranger, Pyromancer, Cleric and Necromancer have no stun, freeze or blind in the base kit');
  ok(dz('ranger', { r_atk: 1, r_atk_h: 1 }) && !dz('ranger', { r_atk: 1, r_atk_s: 1 }), 'a Heavy fork Staggers; a Swift fork does not');
  ok(dz('ranger', { r_s2: 1, r_s2_a: 1 }), 'Skyfall stuns (skill part)');
  for (const k of ['iceInfuse', 'frozenHeart', 'arcStun', 'dashBlind', 'waveStun', 'sanctStun', 'cStun', 'chargeStun', 'orbitStun', 'knightStun', 'cometStun', 'parry']) ok(dz('ranger', {}, { [k]: 1 }), `stat ${k} counts`);
  ok(dz('cleric', {}, { verdict: 1 }) && !dz('cleric', {}, { verdict: 0 }), 'Verdict stuns (skill part, needs its stat)');
  ok(dz('cleric', { c_atk: 1, c_atk_h: 1 }) && dz('cleric', {}, { waveStun: 0.4 }) && dz('cleric', {}, { sanctStun: 0.5 }), 'Cleric: Heavy, Wave of light and Sanctuary stuns');
  ok(dz('necro', {}, { knightStun: 0.5 }) && dz('pyro', {}, { cometStun: 0.5 }), 'Necromancer Ironbone and Pyromancer Impact Crater stun');
  // the card follows the gate: a Generalist Ranger never sees it, a Generalist Knight can
  const seen = (cls, boons) => { const { w, p } = stage(cls, Object.assign({ generalist: 1 }, boons)); for (let i = 0; i < 400; i++) if (w.rollOffer(p, { src: 'level' }).includes('opportunist')) return true; return false; };
  ok(!seen('ranger') && seen('knight') && seen('shade') && seen('ranger', { r_atk: 1, r_atk_h: 1 }), 'Opportunist is offered only to heroes that can daze a foe');
  const { w, p } = stage('ranger', { generalist: 1 }); ok(!w.rollOffer(p, { src: 'room' }).includes('opportunist') && !w.rollOffer(p, { src: 'epic' }).includes('opportunist'), 'also absent from room and epic offers');
}

// ---------------- utility commons ----------------
{
  const weights = (s) => {
    const { w, p } = stage('ranger', {}, { stratum: s }), seen = {}, orig = w.rng.weighted;
    w.rng.weighted = (items, wf) => { for (const id of items) seen[id] = wf(id); return orig.call(w.rng, items, wf); };
    for (let i = 0; i < 20; i++) w.rollOffer(p, { src: 'level' });
    return seen;
  };
  const w3 = weights(3), w4 = weights(4), w6 = weights(6);
  for (const id of ['bounty', 'magnet', 'forager', 'fleet', 'mending']) ok(w3[id] === 60 && w4[id] === 15 && w6[id] === 15, `${id}: weight 60 below stratum IV, 15 from stratum IV`);
  for (const id of ['edge', 'quick', 'vigor', 'plating']) ok(w4[id] === w3[id] && w3[id] === 60, `${id}: weight unchanged`);
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
  const bare = (o) => o.filter(id => !ED.BOONS[id].evo && !ED.BOONS[id].duo);
  const pick = (w, p, offer, i) => { p.offer = offer.slice(); p.offers = [{ src: 'level', path: null }]; p.picks = 1; w.msgs.length = 0; w.fx.length = 0; w.pickBoon('p0', i || 0); };

  // (a) a hero with an exhausted pool is offered the Purse, never Vigor
  const ex = exhaust('knight', { generalist: 1 });
  ok(ex.i > 3 && ex.i < 400, `a Generalist Knight exhausts the pool after ${ex.i} offers`);
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
    for (let s = 1; s <= 6; s++) ok(ED.World.rewardGold(s) > 0, `the Purse pays gold at stratum ${s}`);
  }
  // (c) a pick of a card at its max rank grants nothing but still consumes the offer
  {
    const { w, p } = stage('ranger', { kindle: 1, edge: 2, r_atk: 1, r_atk_h: 3 }), dmg = p.stats.dmg, b0 = JSON.stringify(p.boons);
    pick(w, p, ['edge', 'plating']);
    ok(p.boons.edge === 2 && p.stats.dmg === dmg && JSON.stringify(p.boons) === b0, 'edge at its max rank: a pick changes nothing');
    ok(p.offer === null && p.offers.length === 0 && p.picks === 0 && w.msgs.some(m => m.t === 'offerDone') && !w.fx.some(e => e.t === 'boon' || e.t === 'build'), 'the offer is consumed and no boon event is sent');
    p.forkDue = 0; pick(w, p, ['r_atk_h']);
    ok(p.boons.r_atk_h === 3 && !w.msgs.some(m => m.t === 'forkRank'), 'a fork at rank 3 stays at rank 3');
    pick(w, p, ['edge', 'plating'], 1); ok(p.boons.plating === 1, 'a card below its max rank is still granted');
    pick(w, p, ['kindle']); ok(p.boons.kindle === 1, 'a max-1 card already owned stays at 1');
    const g = stage('knight', { generalist: 1, edge: 3 }); pick(g.w, g.p, ['edge']); ok(g.p.boons.edge === 3, 'a Generalist caps open cards at max + 1');
    const g2 = stage('knight', { generalist: 1, edge: 2 }); pick(g2.w, g2.p, ['edge']); ok(g2.p.boons.edge === 3, 'a Generalist takes the extra rank');
  }
  // (d) Vigor never exceeds rank 3 (4 for a Generalist), by picks and by the pool run dry
  {
    const { w, p } = stage('ranger', { kindle: 1 });
    for (let i = 0; i < 6; i++) pick(w, p, ['vigor']);
    ok(p.boons.vigor === 3, `Vigor stays at rank 3 after six picks (got ${p.boons.vigor})`);
    ok(ex2.p.boons.vigor === 3, 'Vigor is 3 after the pool ran dry (never raised by the fallback)');
    const hp = p.stats.maxHp; pick(w, p, ['vigor']); ok(p.stats.maxHp === hp, 'a seventh Vigor adds no health');
    ok(ex.p.boons.vigor === 4, 'a Generalist holds Vigor to 4 (open cards gain a rank)');
  }
}

// ---------------- Second Wind: rises outside boss fights only ----------------
{
  const { w, p } = stage('knight'); p.secondWind = 1; p.swPct = 0.1;
  w.boss = { id: 'x' }; p.hp = 0; w.playerLethal(p); ok(p.downed && p.secondWind === 1, 'Second Wind does not fire during a boss fight');
  const b = stage('knight'), q = b.p; q.secondWind = 1; q.swPct = 0.1; b.w.boss = null; q.hp = 0; b.w.playerLethal(q);
  ok(!q.downed && q.secondWind === 0, 'Second Wind fires outside a boss fight'); near(q.hp, Math.round(q.maxHp * 0.1), 1e-9, 'rises at 10% health');
}

// ---------------- element paths: live cards reach the keystone and evolution; Attunements carry both halves; Mutations hold no path ----------------
{
  for (const el of ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow']) {
    let r = 0;
    for (const id in ED.BOONS) { const b = ED.BOONS[id]; if (b.path === el && !b.retired && !b.key && !b.evo && !b.duo && !b.cls && !b.asc) r += b.max || 1; }
    ok(r >= ED.KEY_AFFINITY && r + 1 >= ED.EVO_AFFINITY && r + 1 <= 13, `${el}: ${r} path ranks + keystone reach the evolution (${ED.EVO_AFFINITY}) without retired cards`);
  }
  const at = { fuel: ['fireInfuse', 'searing'], deepcold: ['chillMul', 'brittle'], stormattune: ['lightningInfuse', 'ionize'], potency: ['venomBuild', 'fester'], fervor: ['holyInfuse', 'hallow'], malignance: ['shadowInfuse', 'malice'] };
  for (const id in at) { const st = build('ranger', { [id]: 1 }); ok(at[id].every(k => st[k] > 0), `${ED.BOONS[id].name}: build-up and conditional damage in one common`); }
  ok(ED.MUT_IDS.every(id => !ED.BOONS[id].path), 'Mutations never count toward path affinity');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
