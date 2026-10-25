// Usage: node tools/check-late.js
// Headless checks of the late-game offer rules: an exhausted pool offers the Purse alone, a forge offers owned boons below max rank only, no offer of any source ever holds a removed card kind
// (Ascended, duo, Mutation, Twist, Attunement), and the floor never places a Twist reward. Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

// A started solo run of cls (p0) with the given boons, queues cleared, no foes, at stratum o.stratum (default 1).
function stage(cls, boons, o) {
  o = o || {};
  const w = new ED.World({ seed: o.seed || 11, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true);
  p.offers.length = 0; p.picks = 0; p.offer = null;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0; w.msgs.length = 0; w.fx.length = 0;
  w.stratum = o.stratum || 1;
  return { w, p };
}
const rolls = (w, p, src, k) => { const out = []; for (let i = 0; i < (k || 60); i++) out.push(w.rollOffer(p, { src })); return out; };

// ---------------- the removed layers are gone ----------------
ok(['TWIST_IDS', 'ASC_IDS', 'MUT_IDS', 'MUTATIONS', 'TWIST', 'TWIST_C', 'LATE', 'DUOS', 'duoOf', 'DUO_AFFINITY'].every(k => ED[k] === undefined), 'no Twist, Ascended, Mutation, late-fill or duo tables');
ok(ED.BOON_IDS.every(id => { const b = ED.BOONS[id]; return !b.twist && !b.mut && !b.asc && !b.duo && !b.attune; }), 'no card of a removed kind');
ok(Object.keys(ED.RARITY).join() === 'c,r,e,l,boss,curse', 'four boon rarities (common, rare, epic, legendary) and the two relic-only ones (boss, curse)');
{
  const kinds = new Set();
  for (let s = 1; s <= ED.CONST.STRATA; s++) for (let seed = 1; seed <= 12; seed++) for (const r of ED.Dungeon.generate(s, seed).rooms) if (r.reward) kinds.add(r.reward);
  ok(!kinds.has('twist'), `the floor never places a Twist reward (rewards seen: ${[...kinds].join(' ')})`);
}

// ---------------- offers of every source hold only live cards ----------------
for (const [cls, boons] of [['knight', { kindle: 1 }], ['ranger', { generalist: 1 }], ['pyro', { kindle: 1, frostbite: 1 }], ['bell', { staticcharge: 1 }]]) {
  for (const s of [1, 3, 4]) {
    const { w, p } = stage(cls, boons, { stratum: s }); p.stats.choices = 6;
    for (const src of ['level', 'room', 'epic', 'forge', 'start']) {
      const hands = rolls(w, p, src, 25);
      ok(hands.every(h => h.every(id => ED.BOONS[id] && !ED.BOONS[id].retired) && new Set(h).size === h.length), `${cls} ${Object.keys(boons).join('+')} stratum ${s} ${src}: live cards, no duplicates`);
    }
  }
}

// ---------------- forge: owned boons below max rank, never route or fork cards ----------------
{
  const { w, p } = stage('knight', { kindle: 1, stoke: 1, wildfire: 2, keen: 2 });
  const hands = rolls(w, p, 'forge', 40);
  ok(hands.every(h => h.every(id => id === 'purse' || (p.boons[id] > 0 && p.boons[id] < ED.maxRank(ED.BOONS[id], p.stats) && !ED.BOONS[id].cls))), `forge: owned boons below max rank only (${[...new Set(hands.flat())].join(' ')})`);
}

// ---------------- an exhausted pool offers the Purse alone ----------------
{
  const { w, p } = stage('knight', { generalist: 1 }, { stratum: 4 });
  let i = 0;
  for (; i < 400; i++) { const o = w.rollOffer(p, { src: 'level' }); if (o.join() === 'purse') break; for (const id of o) if (id !== 'purse') p.boons[id] = ED.maxRank(ED.BOONS[id], p.stats); w.recalc(p, true); }
  ok(i < 400 && w.rollOffer(p, { src: 'level' }).join() === 'purse', `exhausted after ${i} offers: the Purse alone`);
  const g0 = w.gold; p.offer = ['purse']; p.offers = [{ src: 'level', path: null }]; p.picks = 1; w.pickBoon('p0', 0);
  ok(w.gold > g0 && !p.boons.purse, `picking the Purse pays gold (${g0} -> ${w.gold}) and holds no rank`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
