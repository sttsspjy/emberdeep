// Usage: node tools/check-late.js
// Headless checks of the late-game offer rules and the Twists: the flat-stat commons leaving level and room draws (stratum III), Bastion off the Ascended pool, the pin slot (Mutation over Ascended),
// the late fill order (Mutations, rank-ups, Purse), Twist offers (eligibility, hand, reroll, epic fallback, picks) and the Twist runtime (Bloodprice, Metronome, Pacifist's Pyre).
// Mutations are stand-ins registered here (fake parent ids) so the checks hold with any ED.MUTATIONS data. Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const W = ED.World.prototype, C = ED.TWIST_C, L = ED.LATE;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

// A started solo run of cls (p0) with the given boons, queues cleared, no foes, crit 0, at stratum o.stratum (default 1).
function stage(cls, boons, o) {
  o = o || {};
  const w = new ED.World({ seed: o.seed || 11, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[o.wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true);
  p.offers.length = 0; p.picks = 0; p.offer = null; p.stats.crit = 0;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0; w.msgs.length = 0; w.fx.length = 0;
  w.stratum = o.stratum || 1;
  return { w, p };
}
const rolls = (w, p, src, k) => { const out = []; for (let i = 0; i < (k || 60); i++) out.push(w.rollOffer(p, { src })); return out; };
const any = (hands, f) => hands.some(h => h.some(f));
const dummy = (w, x, y) => { const e = w.spawnEnemy('skeleton', x, y); e.spawnT = 0; e.spd = 0; e.cd = 1e9; e.r = 12; e.hp = e.maxHp = 1e7; e.def = Object.assign({}, e.def, { guard: undefined }); return e; };
const take = (w, p, id, src) => { p.offer = [id]; p.offers = [{ src: src || 'level', path: null }]; p.picks = 1; w.pickBoon('p0', 0); };

// Stand-in Mutations: two siblings of a fake keystone and two of a fake evolution (not in ED.BOON_IDS, so no pool draws them except through W.mutCards).
const FAKE = { zz_key: { name: 'Test Keystone', rar: 'e', icon: 'star', desc: 'Test.', mods: {}, max: 1, key: true }, zz_evo: { name: 'Test Evolution', rar: 'l', icon: 'star', desc: 'Test.', mods: {}, max: 1 } };
const MUTS = { mut_zz_a: 'zz_key', mut_zz_b: 'zz_key', mut_zz_c: 'zz_evo', mut_zz_d: 'zz_evo' };
const mutIds0 = ED.MUT_IDS.slice();
function fakeMuts(on) {
  for (const id in FAKE) if (on) ED.BOONS[id] = FAKE[id]; else delete ED.BOONS[id];
  for (const id in MUTS) if (on) ED.BOONS[id] = { name: id, rar: 'm', icon: 'star', desc: 'Test.', mods: {}, mut: MUTS[id], max: 1 }; else delete ED.BOONS[id];
  ED.MUT_IDS.length = 0; for (const id of mutIds0.concat(on ? Object.keys(MUTS) : [])) ED.MUT_IDS.push(id);
}

// ---------------- data ----------------
ok(ED.TWIST_IDS.length === 4 && ED.TWIST_IDS.every(id => { const b = ED.BOONS[id]; return b.rar === 't' && b.twist && b.max === 1 && !b.path && b.cost && b.desc && !/[{}]/.test(b.desc + b.cost); }), 'four Twists: rarity t, max 1, no path, a desc and a cost line without tokens');
ok(ED.BOONS.pacifist.gates === 2 && !ED.BOONS.bloodprice.gates && !ED.BOONS.metronome.gates && !ED.BOONS.hunted.gates, "Pacifist's Pyre alone needs 2 element gates");
ok(['twBlood', 'twMetro', 'twPacifist', 'twHunted'].every((k, i) => ED.BOONS[ED.TWIST_IDS[i]].mods[k] === 1), 'each Twist sets its stat key to 1');
ok(ED.BOONS.asc_plating && ED.BOONS.asc_plating.off && ED.ASC_IDS.includes('asc_plating'), 'Bastion stays defined (id kept) but off the pool');

// ---------------- flat-stat commons leave level and room draws from stratum III ----------------
{
  const FLAT = new Set(L.FLAT);
  for (const [cls, boons] of [['knight', { kindle: 1 }], ['knight', { generalist: 1 }], ['pyro', { kindle: 1, frostbite: 1 }]]) {
    const tag = cls + ' ' + Object.keys(boons).join('+');
    const a = stage(cls, boons, { stratum: 2 }), b = stage(cls, boons, { stratum: 3 }), c = stage(cls, boons, { stratum: 6 });
    ok(any(rolls(a.w, a.p, 'level', 120), id => FLAT.has(id)), `${tag}: stratum II level offers still hold flat commons`);
    for (const s of [b, c]) for (const src of ['level', 'room']) ok(!any(rolls(s.w, s.p, src, 120), id => FLAT.has(id)), `${tag}: stratum ${s.w.stratum} ${src} offers hold no flat common`);
    const e = stage(cls, boons, { stratum: 3 }); e.p.stats.choices = 20;
    ok(any(rolls(e.w, e.p, 'epic', 20), id => id === 'thorns' || id === 'evade'), `${tag}: epic offers keep them (stratum III)`);
  }
  const f = stage('knight', { kindle: 1, plating: 1, thorns: 1, evade: 1 }, { stratum: 5 });
  ok(any(rolls(f.w, f.p, 'forge', 40), id => id === 'plating') && any(rolls(f.w, f.p, 'forge', 40), id => id === 'thorns'), 'forge offers still rank them up');
  { const r = stage('pyro', { kindle: 1, frostbite: 1, searing: 1 }, { stratum: 2 }); r.p.stats.choices = 20; ok(!['level', 'room', 'epic', 'forge'].some(src => any(rolls(r.w, r.p, src, 30), id => ED.BOONS[id].retired)), 'retired cards are never offered (forge included, even when owned)'); }
  const g = stage('knight', { plating: 2, edge: 2 }, { stratum: 4 });
  ok(g.w.ascCards(g.p).join() === 'asc_edge', 'Bastion is never eligible (Plating at max, stratum IV)');
}

// ---------------- pin slot: Mutation over Ascended ----------------
fakeMuts(true);
{
  const { w, p } = stage('knight', { kindle: 1, edge: 2, zz_key: 1 }, { stratum: 4 });
  ok(w.mutCards(p).join() === 'mut_zz_a,mut_zz_b' && w.ascCards(p).join() === 'asc_edge', 'parent owned at stratum IV: both siblings eligible, Ascended eligible too');
  for (const src of ['level', 'room', 'epic']) {
    const hands = rolls(w, p, src, 60), pins = new Set(hands.map(h => h[0]));
    ok(hands.every(h => ED.BOONS[h[0]].mut) && pins.size === 2, `${src}: slot 1 is a Mutation every time, both siblings drawn (${[...pins]})`);
    ok(!any(hands, id => ED.BOONS[id].asc), `${src}: no Ascended card while a Mutation is eligible`);
    ok(hands.every(h => h.length === (src === 'epic' ? 4 : 3) && new Set(h).size === h.length), `${src}: full hand, no duplicates`);
  }
  for (const src of ['start', 'class', 'forge', 'twist']) ok(!any(rolls(w, p, src, 30), id => ED.BOONS[id].mut), `${src} offer never pins a Mutation`);
  p.boons.zz_evo = 1; w.recalc(p, false);
  ok(w.mutCards(p).length === 4, 'a keystone and an evolution owned: four eligible');
  take(w, p, 'mut_zz_b');
  ok(p.boons.mut_zz_b === 1 && w.mutCards(p).join() === 'mut_zz_c,mut_zz_d', 'a picked Mutation locks out itself and its sibling');
  take(w, p, 'mut_zz_c');
  ok(!w.mutCards(p).length, 'one Mutation per parent');
  ok(rolls(w, p, 'level', 30).every(h => h[0] === 'asc_edge'), 'no Mutation left: the Ascended card takes the pin again');
  const s3 = stage('knight', { kindle: 1, edge: 2, zz_key: 1 }, { stratum: 3 });
  ok(!s3.w.mutCards(s3.p).length && !any(rolls(s3.w, s3.p, 'level', 40), id => ED.BOONS[id].mut), 'stratum III: no Mutation');
  const none = stage('knight', { kindle: 1, zz_key: 0 }, { stratum: 6 });
  ok(!none.w.mutCards(none.p).length, 'parent not owned: no Mutation');
}

// ---------------- late fill: Mutations, then rank-ups of owned path boons, then the Purse ----------------
{
  // a Generalist Knight whose level pool is exhausted at stratum IV (every card it is shown taken to its max rank, real Mutations included, so none is left eligible)
  fakeMuts(false);
  const { w, p } = stage('knight', { generalist: 1 }, { stratum: 4 });
  let i = 0;
  for (; i < 400; i++) { const o = w.rollOffer(p, { src: 'level' }); if (o.join() === 'purse') break; for (const id of o) if (id !== 'purse') p.boons[id] = ED.maxRank(ED.BOONS[id], p.stats); w.recalc(p, true); } // pinned real Mutations are taken too (one per parent)
  ok(i < 400 && w.rollOffer(p, { src: 'level' }).join() === 'purse', `exhausted after ${i} offers: the Purse alone`);
  fakeMuts(true);
  p.boons.zz_key = 1; p.boons.fuel = 1; w.recalc(p, true); // fuel: a Fire path boon below its max that a Generalist's pool never draws
  const order = rolls(w, p, 'level', 40), kinds = (h) => h.map(id => (ED.BOONS[id].mut ? 'm' : id === 'fuel' ? 'r' : id)).join('');
  ok(order.every(h => kinds(h) === 'mmr'), `level: pinned Mutation, its sibling as fill, then the rank-up (${kinds(order[0])})`);
  ok(rolls(w, p, 'room', 20).every(h => kinds(h) === 'mmr'), 'room: same fill order');
  p.boons.mut_zz_a = 1; w.recalc(p, true);
  ok(rolls(w, p, 'level', 20).every(h => h.join() === 'fuel'), 'no Mutation left: the rank-up alone, no Purse');
  p.boons.fuel = ED.maxRank(ED.BOONS.fuel, p.stats); w.recalc(p, true);
  ok(w.rollOffer(p, { src: 'level' }).join() === 'purse', 'nothing to fill: the Purse');
  p.boons.fuel = 1; w.stratum = 3; w.recalc(p, true);
  ok(w.rollOffer(p, { src: 'level' }).join() === 'purse', 'stratum III: no late fill');
}
fakeMuts(false);

// ---------------- Twist offers ----------------
{
  const one = stage('knight', { kindle: 1 }, { stratum: 3 }), two = stage('pyro', { kindle: 1, frostbite: 1 }, { stratum: 3 }), gen = stage('knight', { generalist: 1 }, { stratum: 3 });
  ok(one.w.twistCards(one.p).join() === 'bloodprice,metronome,hunted' && gen.w.twistCards(gen.p).join() === 'bloodprice,metronome,hunted', "one gate or a Generalist: no Pacifist's Pyre");
  ok(two.w.twistCards(two.p).length === 4, "two element gates: all four, Pacifist's Pyre included");
  const hands = rolls(two.w, two.p, 'twist', 80);
  ok(hands.every(h => h.length === L.TWIST_N && h.every(id => ED.BOONS[id].twist) && new Set(h).size === h.length), 'a Twist offer: 2 distinct Twists and nothing else');
  ok(new Set([].concat(...hands)).size === 4, 'every eligible Twist turns up');
  ok(!any(rolls(one.w, one.p, 'twist', 80), id => id === 'pacifist'), "Pacifist's Pyre never offered with one gate");
  for (const src of ['level', 'room', 'epic', 'forge', 'start']) ok(!any(rolls(two.w, two.p, src, 40), id => ED.BOONS[id].twist), `${src} offers never hold a Twist`);
  // grant, message, reroll, picks
  const { w, p } = one;
  p.rerolls = 3; w.grantOffer(p, { src: 'twist' }); w.updateOffers(0);
  const m = w.msgs.find(x => x.t === 'offer');
  ok(m && m.src === 'twist' && m.boons.length === 2 && !m.noRe, 'grantOffer twist: the offer message says src twist (rerollable with 3 eligible)');
  const old = p.offer.slice(); w.reroll('p0');
  ok(p.rerolls === 2 && p.offer.length === 2 && p.offer.every(id => ED.BOONS[id].twist) && p.offer.some(id => !old.includes(id)), 'a reroll redraws among the Twists and shows the one left out');
  const firstTw = p.offer[0]; w.pickBoon('p0', 0);
  ok(p.boons[firstTw] === 1 && p.twist === true && p.twistN === 1 && p.stats[ED.TWISTS[firstTw].mods && Object.keys(ED.TWISTS[firstTw].mods)[0]] === 1, `picking ${firstTw}: p.twist, p.twistN 1 and its stat`);
  w.msgs.length = 0; w.grantOffer(p, { src: 'twist' }); w.updateOffers(0);
  const m2 = w.msgs.find(x => x.t === 'offer'), keep = p.offer.slice();
  ok(m2 && m2.noRe === 1 && p.offer.length === 2, 'two eligible left: the offer is marked noRe');
  w.reroll('p0'); ok(p.rerolls === 2 && p.offer.join() === keep.join(), 'a reroll with no other Twist to show refuses at no cost');
  w.pickBoon('p0', 1);
  ok(p.twistN === 2 && !w.twistCards(p).length, `TWIST_MAX (${ED.TWIST_MAX}) held: none eligible`);
  w.msgs.length = 0; w.grantOffer(p, { src: 'twist' }); w.updateOffers(0);
  const m3 = w.msgs.find(x => x.t === 'offer');
  ok(m3 && m3.src === 'epic' && p.offers[0].src === 'epic' && p.offer.length === 4 && !p.offer.some(id => ED.BOONS[id].twist), 'no eligible Twist: the spec becomes an epic offer');
}

// ---------------- Bloodprice ----------------
{
  const { w, p } = stage('ranger', { bloodprice: 1 });
  p.twist = true;
  ok(ED.TWIST.cd(p.stats, 0) === C.GAP && ED.TWIST.cd(p.stats, 1) === C.GAP, `cooldown of either slot is ${C.GAP} s`);
  const b = stage('ranger', {});
  ok(ED.TWIST.cd(b.p.stats, 0) === b.p.stats.skillCd && ED.TWIST.cd(b.p.stats, 1) === b.p.stats.skill2Cd, 'without it: the stat cooldowns');
  const h0 = p.hp; w.playerSkill(p, 0, {}, 0);
  near(h0 - p.hp, p.maxHp * C.BLOOD, 1e-9, 'a cast costs BLOOD x max HP');
  w.playerSkill(p, 0, {}, 1); near(h0 - p.hp, 2 * p.maxHp * C.BLOOD, 1e-9, 'skill 2 too');
  p.hp = 1.3; w.playerSkill(p, 0, {}, 0); ok(p.hp === 1, 'never below 1 HP');
  w.playerSkill(p, 0, {}, 0); ok(p.hp === 1 && !p.downed, 'at 1 HP a cast is free');
  p.shield = 50; p.hp = 20; w.playerSkill(p, 0, {}, 0); ok(p.shield === 50 && Math.abs(p.hp - (20 - p.maxHp * C.BLOOD)) < 1e-9, 'the cost skips shields');
  b.p.twist = true; const h1 = b.p.hp; b.w.playerSkill(b.p, 0, {}, 0); ok(b.p.hp === h1, 'no cost without Bloodprice');
}

// ---------------- Metronome ----------------
{
  // damage of each of 8 swings of a Knight on a pinned dummy, Metronome against none
  const swings = (boons) => {
    const { w, p } = stage('knight', boons); p.twist = !!boons.metronome;
    const e = dummy(w, p.x + 30, p.y), out = [], beats = [];
    for (let i = 0; i < 8; i++) { const h = e.hp; w.playerAttack(p, 0); out.push(h - e.hp); beats.push(p.metroN); }
    return { out, beats };
  };
  const base = swings({}), met = swings({ metronome: 1 });
  ok(base.out.every(d => d > 0 && Math.abs(d - base.out[0]) < 1e-6), 'baseline swings are equal');
  const want = [C.METRO_LO, C.METRO_LO, C.METRO_LO, C.METRO_HI, C.METRO_LO, C.METRO_LO, C.METRO_LO, C.METRO_HI];
  ok(met.out.every((d, i) => Math.abs(d / base.out[i] - want[i]) < 1e-6), `melee beats x${want.join(' x')} (got x${met.out.map((d, i) => (d / base.out[i]).toFixed(2)).join(' x')})`);
  ok(met.beats.join() === '1,2,3,0,1,2,3,0', 'p.metroN counts the bar (0 right after the x3 beat)');
  // a Ranger's shots carry the factor of the attack that fired them, whenever they land
  const shots = (boons) => {
    const { w, p } = stage('ranger', boons); p.twist = !!boons.metronome;
    const e = dummy(w, p.x + 120, p.y), h = e.hp;
    for (let i = 0; i < 4; i++) w.playerAttack(p, 0);
    for (let i = 0; i < 90; i++) w.updateProjectiles(1 / 60);
    return h - e.hp;
  };
  const sb = shots({}), sm = shots({ metronome: 1 });
  near(sm / sb, (3 * C.METRO_LO + C.METRO_HI) / 4, 1e-6, 'four shots in flight: (3 x LO + HI) / 4 of the baseline');
}

// ---------------- Pacifist's Pyre ----------------
{
  const hit = (boons, src) => {
    const { w, p } = stage('pyro', boons); p.twist = !!boons.pacifist;
    const e = dummy(w, p.x + 30, p.y), h = e.hp, dealt0 = p.dealt;
    const got = w.hitEnemy(e, 10, Object.assign({ p }, src));
    return { lost: h - e.hp, got, burn: e.burnPool, chill: e.chill, dealt: p.dealt - dealt0 };
  };
  const G = { kindle: 1, frostbite: 1 }, PG = Object.assign({ pacifist: 1 }, G);
  const wb = hit(G, { kind: 'weapon', wpn: true }), wp = hit(PG, { kind: 'weapon', wpn: true });
  ok(wb.lost > 0 && wp.lost === 0 && wp.got === 0 && wp.dealt === 0, 'a weapon hit deals no direct damage (health, return value, dealt)');
  ok(wb.burn > 0 && wb.chill > 0, 'baseline builds Burn and Chill');
  near(wp.burn / wb.burn, C.PYRE, 1e-6, 'Burn builds from PYRE x the would-be damage');
  near(wp.chill / wb.chill, C.PYRE, 1e-6, 'Chill builds from PYRE x the would-be damage');
  const sb = hit(PG, { kind: 'skill' }), sk = hit(G, { kind: 'skill' });
  ok(sb.lost > 0 && Math.abs(sb.lost - sk.lost) < 1e-6, 'skill hits deal full damage');
  const bl = hit(PG, { kind: 'explode', wpn: true }); ok(bl.lost === 0 && bl.burn > 0, "a weapon shot's blast is a weapon hit too");
  const raw = hit(PG, { kind: 'explode', raw: true, noProc: true }); ok(raw.lost > 0, 'status payoffs (raw) still deal damage');
  // a real swing: the foe keeps its health, its statuses grow
  const { w, p } = stage('knight', PG); p.twist = true;
  const e = dummy(w, p.x + 30, p.y), h = e.hp;
  for (let i = 0; i < 3; i++) w.playerAttack(p, 0);
  ok(e.hp === h && e.burnPool > 0, 'Knight swings: no health lost, Burn builds');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
