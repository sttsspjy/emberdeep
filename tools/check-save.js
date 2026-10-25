// Usage: node tools/check-save.js
// Headless checks of the profile and save code: golden v2 (main era), v3 and v4 codes still load with their Codex embers refunded, v10 round trips (also with Armory entries, Wardrobe fields and Codex pages; v9 codes decode with none) and survives appended upgrades/heroes/Armory entries/deeds/secrets/Wardrobe items in both directions,
// a code from a newer build and an Armory overflow report clearly, the one-time news flag and the stored-profile Codex migration, upgrade refunds, Reset all and Armory buy/refund, the repurposed deed, the relic pool and the moved element relics,
// the per-hero deed counters (maxRelics, revivesGiven) in the run summary, and secrets and the Wardrobe (v5/v7 codes decode empty with Gilded on mastery 10 heroes, junk sanitised, grants once, purchase gates, wearing, run-end secrets, evolutions, the Bellwarden flag). Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const S = ED.Save, U = ED.U;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const throws = (f, re, msg) => { let m = null; try { f(); } catch (e) { m = e.message; } ok(m !== null && re.test(m), `${msg}: ${m === null ? 'did not throw' : m}`); };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1 });

// Temporary Armory tables in place of the data's: knight 3, pyro 2, necro 1 entries, the other heroes none.
const ARM = (id, cost) => ({ id, name: id, desc: '', cost });
function withArmory(f) {
  const adds = { knight: [ARM('zz_k1', 30), ARM('zz_k2', 45), ARM('zz_k3', 60)], pyro: [ARM('zz_p1', 25), ARM('zz_p2', 80)], necro: [ARM('zz_n1', 100)] }, keep = Object.assign({}, ED.ARMORY);
  for (const c of ED.CLASS_IDS) ED.ARMORY[c] = adds[c] || [];
  try { return f(); } finally { Object.assign(ED.ARMORY, keep); }
}

// ---- a code writer independent of save.js, so a hand-built code (any version) can be decoded ----
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function pack(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 128 >> (i & 7); });
  let c = 0xffff;
  for (const b of bytes) { c ^= b << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  const all = new Uint8Array(bytes.length + 2); all.set(bytes); all[bytes.length] = c >> 8; all[bytes.length + 1] = c & 255;
  const r = U.RNG(0x5eed_e3b7); for (let i = 0; i < all.length; i++) all[i] ^= Math.floor(r.next() * 256);
  let out = '', buf = 0, k = 0;
  for (const b of all) { buf = (buf << 8) | b; k += 8; while (k >= 5) { out += B32[(buf >>> (k - 5)) & 31]; k -= 5; } buf &= (1 << k) - 1; }
  if (k > 0) out += B32[(buf << (5 - k)) & 31];
  return 'WD1-' + out.match(/.{1,5}/g).join('-');
}
const bitsOf = (v, w) => { const o = []; for (let i = w - 1; i >= 0; i--) o.push((v >>> i) & 1); return o; };

// ---- golden codes: written by main's save.js (version 2), the pre-count-prefix v3 build and the v4 build; values in GOLD2 / GOLD3 / GOLD4 ----
// Costs of the 27 Codex relics of save code v4 in code order, written out here so the frozen table in save.js is checked against them.
const CODEX_COST = [50, 50, 65, 45, 80, 80, 80, 105, 60, 70, 70, 50, 115, 70, 85, 80, 115, 90, 50, 130, 60, 85, 70, 70, 70, 60, 70];
const refundOf = (bits) => bits.reduce((a, b, i) => a + (b ? CODEX_COST[i] : 0), 0);
const GOLD2 = {
  code: 'WD1-ENRDZ-330MV-D9HWH-D9BTC-FCJSD-W3C0A-VE1AJ-4KEM9-7QGQH-MR5TQ-6KQ5D-4KBFM-6HGC9-3EX0V-E2',
  name: 'Old Hand', embers: 1234, lifetime: 98765, up: [1, 4, 3, 2, 1, 0, 3, 2, 1, 1, 3, 1, 2, 1, 1, 2],
  relicsNonStart: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], mastery: [0, 120, 5000, 33, 0, 777],
  bosses: 6, deeds: 665, pactMax: 3, pactWin: 1, stats: { runs: 41, wins: 2, deepest: 3, kills: 9001, bestTime: 1432, bossKills: 17 }, // stored six-stratum bosses 22 (bits 1, 2, 4), deepest 5
};
const GOLD3 = {
  code: 'WD1-EJ093-0BSWA-2P3J7-S2ZAE-ZBARV-HDNKQ-3JFCZ-4HY5P-M6FQQ-ZP935-NPF59-3H142-C67AZ-K7Z5G-MT',
  name: 'Preview', embers: 777, lifetime: 4242, up: [2, 1, 0, 1, 1, 3, 0, 1, 2, 2, 0, 0, 2, 1, 0, 1],
  relicsNonStart: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], mastery: [10, 0, 4000, 0, 250, 9],
  bosses: 13, deeds: 196613, pactMax: 2, pactWin: 0, stats: { runs: 12, wins: 1, deepest: 4, kills: 3100, bestTime: 1111, bossKills: 8 }, // stored bosses 53 (bits 0, 2, 4, 5), deepest 6
};
// Golden codes hold six-stratum boss bits and deepest; decode remaps them by stratum name (old boss bits 0, 1, 4, 5 -> 0-3; deepest 1-2 kept, 3-4 -> 2, 5 -> 3, 6 -> 4).
const GOLD4 = {
  code: 'WD1-EE328-KKBMV-C43P2-M2F3B-S8FTJ-XZ8FY-8FDGW-WNP41-MTJM8-XTYWR-0EWE4-7H98P-NB46M-D596S-RWPC',
  name: 'Veteran', embers: 321, lifetime: 12345, up: [1, 0, 3, 0, 0, 2, 3, 0, 1, 1, 3, 2, 1, 0, 2, 0],
  relicsNonStart: [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1], mastery: [10, 0, 4000, 0, 250, 9],
  bosses: 5, deeds: 1234567, pactMax: 3, pactWin: 1, stats: { runs: 30, wins: 2, deepest: 3, kills: 8000, bestTime: 1500, bossKills: 12 }, // stored bosses 21 (bits 0, 2, 4), deepest 5
};
ok(refundOf(GOLD4.relicsNonStart) === 570, 'GOLD4: its Codex relics cost 570 embers');
function checkGolden(g, label) {
  const p = S.decode(g.code), refund = refundOf(g.relicsNonStart);
  ok(p.name === g.name && p.lifetime === g.lifetime, `${label}: name, lifetime (a refund never changes lifetime)`);
  ok(p.embers === g.embers + refund && p.refunded === refund, `${label}: embers ${p.embers} = ${g.embers} + Codex refund ${refund}, refunded ${p.refunded}`);
  same(p.up, g.up.concat(ED.UPGRADES.slice(g.up.length).map(() => 0)), `${label}: upgrade ranks`);
  ok(p.relics === undefined, `${label}: the profile has no relics array`);
  same(p.mastery, g.mastery.concat(ED.CLASS_IDS.slice(g.mastery.length).map(() => 0)), `${label}: mastery (heroes after the code's start at 0)`);
  ok(p.bosses === g.bosses && p.deeds === g.deeds && p.pactMax === g.pactMax && p.pactWin === g.pactWin, `${label}: bosses, deeds, pacts`);
  same(p.stats, g.stats, `${label}: stats`);
  ok(p.news === 1, `${label}: a code from before v5 gets the notice, got ${p.news}`);
  const q = S.decode(S.encode(p));
  ok(q.embers === p.embers && q.refunded === 0 && q.news === 0, `${label}: re-encoded as v9 keeps the refunded embers and refunds nothing twice`);
}
checkGolden(GOLD2, 'v2 code from main');
checkGolden(GOLD3, 'v3 code');
checkGolden(GOLD4, 'v4 code');

// ---- v10 round trips ----
const rnd = U.RNG(4242);
const ri = (a, b) => a + Math.floor(rnd.next() * (b - a + 1));
function randomProfile() {
  const p = S.defaultProfile();
  p.name = S.sanitizeName('Hero ' + ri(0, 99999)); p.embers = ri(0, 99999); p.lifetime = p.embers + ri(0, 999999);
  p.up = ED.UPGRADES.map(u => ri(0, u.costs.length)); for (const c of ED.CLASS_IDS) p.armory[c] = p.armory[c].map(() => (rnd.next() < 0.5 ? 1 : 0));
  p.mastery = ED.CLASS_IDS.map(() => (rnd.next() < 0.3 ? 0 : ri(0, 200000))); p.bosses = ri(0, 63); p.deeds = ri(0, 2 ** 26 - 1);
  p.pactMax = ri(0, 10); p.pactWin = ri(-1, p.pactMax);
  p.stats = { runs: ri(0, 5000), wins: ri(0, 900), deepest: ri(0, 6), kills: ri(0, 1e7), bestTime: ri(0, 9000), bossKills: ri(0, 3000) };
  // Wardrobe fields: random secrets, wins, evolutions and purchases, then a random owned item (or none) in every slot
  p.secrets = ri(0, 2 ** ED.SECRETS.length - 1); p.heroWins = ri(0, 2 ** ED.CLASS_IDS.length - 1); p.bellUnlocked = rnd.next() < 0.5;
  for (const c of ED.CLASS_IDS) for (const w of ED.CLASSES[c].weapons) if (rnd.next() < 0.4) p.evo[w] = ri(1, 300);
  p.cos = ED.COSMETICS.filter(c => c.gate.cost && rnd.next() < 0.4).map(c => c.id);
  const pickOwned = (cls, slot) => { const own = ED.cosFor(cls, slot).filter(c => ED.cosOwned(p, c.id, cls)); return own.length && rnd.next() < 0.7 ? own[ri(0, own.length - 1)].id : null; };
  p.wear = { camp: pickOwned(null, 'camp') };
  for (const c of ED.CLASS_IDS) {
    const h = p.wear[c] = { tints: ED.CLASSES[c].weapons.filter(w => ED.cosOwned(p, 'tint.' + w, c) && rnd.next() < 0.6) };
    for (const k of ED.WEAR_SLOTS) h[k] = pickOwned(c, k);
  }
  p.lore = ri(0, 2 ** ED.LORE.length - 1); // Codex pages (v10)
  return S.normalize(p);
}
const tripDiffs = (count) => {
  let bad = 0;
  for (let i = 0; i < count; i++) {
    const p = randomProfile(), q = S.decode(S.encode(p));
    if (JSON.stringify(q) !== JSON.stringify(Object.assign({}, p, { sel: q.sel }))) { bad++; if (bad < 3) console.log('  round trip differs', JSON.stringify(p), JSON.stringify(q)); }
  }
  return bad;
};
{
  const rt = tripDiffs(300);
  ok(rt === 0, `v10 round trip: ${rt} of 300 profiles differ`);
  const ra = withArmory(() => tripDiffs(300));
  ok(ra === 0, `v10 round trip with Armory entries: ${ra} of 300 profiles differ`);
  ok(withArmory(() => { const p = randomProfile(); p.armory.knight = [1, 0, 1]; p.armory.pyro = [0, 1]; p.armory.necro = [1]; return JSON.stringify(S.decode(S.encode(p)).armory) === JSON.stringify(p.armory); }), 'Armory bits land on the right hero and entry');
}

// ---- appended entries never shift what follows (both directions) ----
function withAppended(f) {
  const u = { id: 'zz_up', name: 'Zz', tier: 1, costs: [1, 2, 3], icon: 'x', step: '', desc: () => '' };
  ED.UPGRADES.push(u); ED.CLASS_IDS.push('zz_cls'); ED.CLASSES.zz_cls = { weapons: [] }; ED.ARMORY.zz_cls = [ARM('zz_a', 10)]; ED.ARMORY.knight.push(ARM('zz_ka', 15));
  ED.DEEDS.push({ id: 'zz_deed', name: 'Zz', desc: '', icon: 'x', reward: 1, check: () => false });
  try { return f(); } finally { ED.UPGRADES.pop(); ED.CLASS_IDS.pop(); delete ED.CLASSES.zz_cls; delete ED.ARMORY.zz_cls; ED.ARMORY.knight.pop(); ED.DEEDS.pop(); }
}
{
  const p = withArmory(() => randomProfile()), old = withArmory(() => S.encode(p));
  const q = withArmory(() => withAppended(() => S.decode(old))); // a code from before the append, read by a newer build
  same(q.up.slice(0, ED.UPGRADES.length), p.up, 'old code, newer build: upgrade ranks');
  ok(q.up[ED.UPGRADES.length] === 0 && q.mastery[ED.CLASS_IDS.length] === 0 && q.armory.zz_cls[0] === 0 && q.armory.knight[3] === 0, 'old code, newer build: appended entries start at 0');
  ok(q.name === p.name && q.embers === p.embers && q.lifetime === p.lifetime && q.bosses === p.bosses && q.deeds === p.deeds && q.pactMax === p.pactMax && q.pactWin === p.pactWin, 'old code, newer build: scalar fields intact');
  same(q.mastery.slice(0, ED.CLASS_IDS.length), p.mastery, 'old code, newer build: mastery');
  same(q.armory.knight.slice(0, 3), p.armory.knight, 'old code, newer build: Armory bits of the old entries');
  same([q.armory.pyro, q.armory.necro], [p.armory.pyro, p.armory.necro], 'old code, newer build: other heroes\' Armory bits');
  same(q.stats, p.stats, 'old code, newer build: stats');
  const big = withArmory(() => withAppended(() => { const b = randomProfile(); b.up[ED.UPGRADES.length - 1] = 3; b.mastery[ED.CLASS_IDS.length - 1] = 12345; b.armory.knight[3] = 1; b.armory.zz_cls[0] = 1; return { b, code: S.encode(b) }; }));
  const r = withArmory(() => S.decode(big.code)); // a code from a newer build, read by this one
  same(r.up, big.b.up.slice(0, ED.UPGRADES.length), 'newer code, older build: upgrade ranks');
  same(r.mastery, big.b.mastery.slice(0, ED.CLASS_IDS.length), 'newer code, older build: mastery');
  same(r.armory.knight, big.b.armory.knight.slice(0, 3), 'newer code, older build: the extra knight entry is skipped');
  ok(r.armory.zz_cls === undefined && r.armory.pyro.join() === big.b.armory.pyro.join() && r.armory.necro.join() === big.b.armory.necro.join(), 'newer code, older build: the extra hero is skipped, the others intact');
  ok(r.name === big.b.name && r.embers === big.b.embers && r.bosses === big.b.bosses && r.deeds === big.b.deeds && r.pactMax === big.b.pactMax && JSON.stringify(r.stats) === JSON.stringify(big.b.stats), 'newer code, older build: fields after the lists intact');
}

// ---- clear errors ----
throws(() => S.decode(pack(bitsOf(11, 8).concat(bitsOf(0, 120)))), /newer Wickdeep.*Reload/, 'code from a newer version');
throws(() => S.decode(pack(bitsOf(1, 8).concat(bitsOf(0, 120)))), /unknown version or is damaged/, 'version 1 code');
throws(() => S.decode(pack(bitsOf(4, 8).concat(bitsOf(0, 4), bitsOf(0xffffffff, 32), bitsOf(0xffffffff, 32), bitsOf(0xffffffff, 32)))), /unknown version or is damaged/, 'v4 code with a damaged body');
throws(() => S.decode(pack(bitsOf(5, 8).concat(bitsOf(0, 4), bitsOf(0xffffffff, 32), bitsOf(0xffffffff, 32), bitsOf(0xffffffff, 32)))), /unknown version or is damaged/, 'v5 code with a damaged body');
{
  ED.ARMORY.ranger.push(...Array.from({ length: 64 }, (_, i) => ARM('zz_o' + i, 1)));
  try { throws(() => S.encode(S.defaultProfile()), /Too many Armory entries/, 'Armory entries beyond the 6-bit count'); }
  finally { ED.ARMORY.ranger.length -= 64; }
}
ok(typeof S.encode(S.defaultProfile()) === 'string', 'encode works again after the overflow probe');

// ---- a hand-built v4 code (written without save.js): the Codex bits become embers, bits beyond this build's list are skipped ----
{
  const varint = (v) => { const o = []; do { const chunk = v % 128; v = Math.floor(v / 128); o.push(...bitsOf(v > 0 ? 1 : 0, 1), ...bitsOf(chunk, 7)); } while (v > 0); return o; };
  const build = (relicBits) => {
    const bits = [...bitsOf(4, 8), ...bitsOf(6, 4)];
    for (const ch of 'Tester') bits.push(...bitsOf(S.NAME_CHARS.indexOf(ch), 6));
    bits.push(...varint(500), ...varint(2000), ...bitsOf(16, 6));
    for (let i = 0; i < 16; i++) bits.push(...bitsOf(i % 3, 3));
    bits.push(...bitsOf(relicBits.length, 7), ...relicBits);
    bits.push(...bitsOf(6, 4)); for (const m of [0, 300, 0, 0, 0, 0]) bits.push(...varint(m));
    bits.push(...bitsOf(5, 6), ...bitsOf(26, 6)); for (let i = 0; i < 26; i++) bits.push(i === 3 ? 1 : 0);
    bits.push(...bitsOf(2, 4), ...bitsOf(1, 4), ...varint(5), ...varint(0), ...bitsOf(2, 3), ...varint(400), ...varint(0), ...varint(1));
    return pack(bits);
  };
  const bits27 = new Array(27).fill(0); [0, 7, 19, 26].forEach(i => { bits27[i] = 1; }); // axe 50, crown 105, stone 130, venomgland 70
  const p = S.decode(build(bits27));
  ok(p.embers === 500 + 355 && p.refunded === 355 && p.lifetime === 2000 && p.news === 1 && p.name === 'Tester', `hand-built v4 code: embers ${p.embers}, refunded ${p.refunded}, lifetime ${p.lifetime}`);
  ok(p.mastery[1] === 300 && p.deeds === 8 && p.bosses === 1 && p.stats.deepest === 2 && p.pactMax === 2 && p.pactWin === 0 && p.stats.runs === 5 && p.stats.kills === 400 && p.stats.bossKills === 1, 'hand-built v4 code: the fields after the Codex bits are read from the right place');
  const longer = bits27.concat([1, 1, 1]); // three relics this build has never heard of
  ok(S.decode(build(longer)).embers === 855, 'hand-built v4 code: Codex bits beyond the frozen list add nothing');
  ok(S.decode(build(bits27.slice(0, 20))).refunded === 50 + 105 + 130, 'hand-built v4 code: a shorter Codex list refunds what it holds');
}

// ---- the one-time news flag ----
const GOLD5 = 'WD1-EAS1G-HKDDH-N6AHN-1JB2A-9A3RT-T7RH2-975RT-4KPS8-46JHN-HR4MV-3PQ5D-761ZP-WJ4AN-B6Q3S-V784'; // v5: Five, 12 runs, the first Knight Armory entry
{
  const base = S.defaultProfile();
  ok(base.news === 0 && base.v === 7 && base.refunded === 0 && base.relics === undefined, 'a new profile starts at era 7 with no news, no refund and no relics array');
  ok(S.normalize({ v: 1, stats: { runs: 3 } }).news === 1, 'era-1 profile with runs gets the news');
  ok(S.normalize({ stats: { runs: 3 } }).news === 1, 'profile with no era and runs gets the news');
  ok(S.normalize({ v: 1, stats: { runs: 0 } }).news === 0, 'era-1 profile without runs gets none');
  ok(S.normalize({ v: 2, news: 0, stats: { runs: 3 } }).news === 1, 'era-2 profile with runs gets the notice of the new rules even if it saw the old one');
  ok(S.normalize({ v: 2, news: 0, stats: { runs: 0 } }).news === 0, 'era-2 profile without runs or refund gets none');
  ok(S.normalize({ v: 3, news: 1, stats: { runs: 3 } }).news === 1, 'era-3 profile keeps its pending full notice');
  ok(S.normalize({ v: 3, news: 0, stats: { runs: 3 } }).news === 2 && S.normalize({ v: 3, news: 3, stats: { runs: 3 } }).news === 2, 'era-3 profile with runs gets the v5 and v6 changes even if it saw the old notice');
  ok(S.normalize({ v: 3, news: 0, stats: { runs: 0 } }).news === 0, 'era-3 profile without runs gets none');
  ok(S.normalize({ v: 4, news: 0, stats: { runs: 3 } }).news === 2 && S.normalize({ v: 4, news: 1, stats: { runs: 3 } }).news === 1, 'era-4 profile with runs gets the v5 and v6 changes (a pending full notice stays)');
  ok(S.normalize({ v: 4, news: 0, stats: { runs: 0 } }).news === 0, 'era-4 profile without runs gets none');
  ok(S.normalize({ v: 5, news: 0, stats: { runs: 3 } }).news === 3 && S.normalize({ v: 5, news: 0, stats: { runs: 0 } }).news === 0, 'era-5 profile with runs gets the v6 changes, none without runs');
  ok(S.normalize({ v: 5, news: 1, stats: { runs: 3 } }).news === 1 && S.normalize({ v: 5, news: 3, stats: { runs: 3 } }).news === 2, 'era-5 profile: a pending notice keeps its older parts');
  ok(S.normalize({ v: 6, news: 1, stats: { runs: 3 } }).news === 1 && S.normalize({ v: 6, news: 2, stats: { runs: 3 } }).news === 2 && S.normalize({ v: 6, news: 3, stats: { runs: 3 } }).news === 3, 'pending news survives a reload');
  ok(S.normalize({ v: 6, news: 0, stats: { runs: 3 } }).news === 4 && S.normalize({ v: 6, news: 0, stats: { runs: 0 } }).news === 0, 'era-6 profile with runs gets the v7 changes, none without runs');
  ok(S.normalize({ v: 6, news: 3, stats: { runs: 3 } }).news === 3 && S.normalize({ v: 7, news: 4, stats: { runs: 3 } }).news === 4, 'era-6 profile: a pending v6 notice keeps its v6 part; a pending v7 notice survives a reload');
  ok(S.normalize({ v: 7, news: 0, stats: { runs: 3 } }).news === 0, 'cleared news stays cleared');
  ok(S.normalize(JSON.parse(JSON.stringify(S.normalize({ v: 1, stats: { runs: 3 } })))).news === 1, 'stored news round-trips through JSON');
  const seen = S.normalize({ v: 1, stats: { runs: 3 } }); seen.news = 0;
  ok(S.normalize(JSON.parse(JSON.stringify(seen))).news === 0, 'once cleared and stored the notice does not return');
  ok(S.decode(S.encode(Object.assign(randomProfile(), { news: 1 }))).news === 0, 'a v9 code carries no news');
  // six-stratum profiles: boss bits and deepest by stratum name
  same([0, 1, 2, 3, 4, 5, 6].map(d => S.normalize({ v: 5, stats: { deepest: d } }).stats.deepest), [0, 1, 2, 2, 2, 3, 4], 'era-5 deepest 0-6 -> 0, 1, 2, 2, 2, 3, 4');
  same([1, 2, 4, 8, 16, 32, 63].map(b => S.normalize({ v: 5, bosses: b }).bosses), [1, 2, 0, 0, 4, 8, 15], 'era-5 boss bits 0, 1, 4, 5 -> 0-3, the cut bits 2 and 3 dropped');
  ok(S.normalize({ v: 6, bosses: 4, stats: { deepest: 3 } }).bosses === 4 && S.normalize({ v: 6, stats: { deepest: 3 } }).stats.deepest === 3, 'era-6 boss bits and deepest are kept');
  { const q = S.normalize({ v: 5, bosses: 63, stats: { deepest: 6, runs: 1 } }); const r = S.normalize(JSON.parse(JSON.stringify(q))); ok(r.bosses === 15 && r.stats.deepest === 4, 'a remapped profile is not remapped again'); ok(S.decode(S.encode(q)).bosses === 15 && S.decode(S.encode(q)).stats.deepest === 4, 'a v9 code is not remapped'); }
  const g5 = S.decode(GOLD5);
  ok(g5.news === 2 && g5.name === 'Five' && g5.stats.runs === 12 && g5.armory.knight[0] === 1, `a v5 code with runs gets the v5 and v6 changes, got news ${g5.news}`);
}

// ---- a stored profile of the Codex era: positional relics array, refunded once ----
const STORED_V2 = {"v":2,"news":0,"name":"Stored","embers":100,"lifetime":900,"up":[1,0,3,0,0,2,3,0,1,1,3,2,1,0,2,0],"relics":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,1,1,1,1],"mastery":[10,0,4000,0,250,9],"bosses":3,"deeds":5,"pactMax":0,"pactWin":-1,"stats":{"runs":30,"wins":2,"deepest":5,"kills":8000,"bestTime":1500,"bossKills":12},"sel":{"cls":"knight","weapon":{}}};
{
  // axe 50, crown 105, wispjar 70, gauntlet 85, stone 130, bloodstone 60, venomgland 70 are the Codex relics held; halo and gravecandle are start relics
  const p = S.normalize(JSON.parse(JSON.stringify(STORED_V2)));
  ok(p.embers === 100 + 570 && p.refunded === 570 && p.lifetime === 900, `stored v2 profile: embers ${p.embers}, refunded ${p.refunded}, lifetime ${p.lifetime}`);
  ok(p.v === 7 && p.news === 1 && p.relics === undefined, 'stored v2 profile: era 7, news pending, no relics array');
  same(p.up, STORED_V2.up, 'stored v2 profile: upgrade ranks kept');
  const again = S.normalize(JSON.parse(JSON.stringify(p)));
  ok(again.embers === p.embers && again.refunded === 570, 'a migrated profile is never refunded twice');
  const startOnly = JSON.parse(JSON.stringify(STORED_V2)); startOnly.relics = startOnly.relics.map((v, i) => (i < 16 || i === 42 || i === 43 ? 1 : 0)); startOnly.stats.runs = 0;
  const q = S.normalize(startOnly);
  ok(q.embers === 100 && q.refunded === 0 && q.news === 0, `a profile that owns only start relics gets no refund and (without runs) no notice: ${q.embers}/${q.refunded}/${q.news}`);
  // S.load migrates once and writes the migrated copy back, so a reload cannot refund again
  const mem = {};
  globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  try {
    mem[S.KEY] = JSON.stringify(STORED_V2);
    const a = S.load(), stored = JSON.parse(mem[S.KEY]);
    ok(a.embers === 670 && stored.v === 7 && stored.relics === undefined && stored.embers === 670 && stored.refunded === 570, 'S.load: refunded, and the stored copy is migrated');
    const b = S.load();
    ok(b.embers === 670 && b.news === 1 && b.refunded === 570, 'S.load again: no second refund, the notice still pending');
    b.news = 0; b.refunded = 0; S.store(b);
    const c = S.load();
    ok(c.embers === 670 && c.news === 0 && c.refunded === 0, 'S.load after the notice was closed: nothing pending');
    mem[S.KEY] = JSON.stringify(Object.assign(JSON.parse(JSON.stringify(c)), { v: 5 })); // an era-5 profile with runs, its notices seen
    const d = S.load(), st5 = JSON.parse(mem[S.KEY]);
    ok(d.news === 3 && st5.v === 7 && st5.news === 3, 'S.load of an era-5 profile: the v6 and v7 notice pending, stored as era 7');
    d.news = 0; S.store(d);
    ok(S.load().news === 0, 'S.load after the notice was closed: it does not return');
    mem[S.KEY] = JSON.stringify(Object.assign(JSON.parse(JSON.stringify(d)), { v: 6, news: 0 })); // an era-6 profile with runs, its notices seen
    const e = S.load(), st6 = JSON.parse(mem[S.KEY]);
    ok(e.news === 4 && st6.v === 7 && st6.news === 4 && e.bosses === d.bosses && e.stats.deepest === d.stats.deepest, 'S.load of an era-6 profile: the v7 notice pending, stored as era 7, boss bits and deepest not remapped');
  } finally { delete globalThis.localStorage; }
}

// ---- refunds, Reset all and the Armory ----
{
  const p = S.defaultProfile(); p.embers = 1000; p.lifetime = 5000;
  const vi = ED.UPGRADE_IDX.vitality;
  const vc = ED.UPGRADES[vi].costs, v3 = vc[0] + vc[1] + vc[2];
  ok(S.buyUpgrade(p, 'vitality') && S.buyUpgrade(p, 'vitality') && S.buyUpgrade(p, 'vitality') && p.embers === 1000 - v3 && p.up[vi] === 3, `three Vitality ranks cost ${vc[0]} + ${vc[1]} + ${vc[2]}`);
  ok(S.refundUpgrade(p, 'vitality') && p.embers === 1000 - v3 + vc[2] && p.up[vi] === 2, `a refund returns the cost of the rank given up (${vc[2]})`);
  ok(S.refundUpgrade(p, 'vitality') && S.refundUpgrade(p, 'vitality') && p.embers === 1000 && p.up[vi] === 0, 'refunding every rank restores the purse');
  ok(!S.refundUpgrade(p, 'vitality') && !S.refundUpgrade(p, 'no_such_upgrade') && !S.buyUpgrade(p, 'no_such_upgrade') && p.embers === 1000, 'nothing to refund at rank 0, unknown ids are refused');
  ok(!S.buyUpgrade(p, 'alacrity') && p.embers === 1000, 'a tier-3 upgrade stays closed before stratum III');
  ok(p.lifetime === 5000, 'lifetime never changes on purchase or refund');
  // Reset all
  const r = S.defaultProfile(); r.embers = 100000; r.lifetime = 100000; r.stats.deepest = 6;
  for (const u of ED.UPGRADES) while (S.buyUpgrade(r, u.id));
  const spent = 100000 - r.embers, allCosts = ED.UPGRADES.reduce((a, u) => a + u.costs.reduce((x, y) => x + y, 0), 0);
  ok(spent === allCosts && S.refundTotal(r) === allCosts, `refundTotal is the sum of every rank bought (${spent} spent, ${S.refundTotal(r)} listed)`);
  ok(S.resetUpgrades(r) === allCosts && r.embers === 100000 && r.up.every(v => v === 0) && r.lifetime === 100000, 'Reset all refunds every rank and keeps lifetime');
  ok(S.resetUpgrades(r) === 0 && r.embers === 100000, 'a second Reset all refunds nothing');
  // Armory (temporary entries)
  withArmory(() => {
    const a = S.defaultProfile(); a.embers = 20; a.lifetime = 77;
    const a0 = a.armory.knight.length; // a profile made before the entries existed has no bits for them
    ok(a0 === 3, 'a profile made inside the Armory has a bit per entry');
    ok(!S.buyArmory(a, 'knight', 'zz_k1') && a.embers === 20, 'an entry costs embers');
    a.embers = 200;
    ok(S.buyArmory(a, 'knight', 'zz_k1') && a.embers === 170 && S.armoryOwned(a, 'knight', 'zz_k1'), 'buying takes the cost and marks the entry');
    ok(!S.buyArmory(a, 'knight', 'zz_k1') && a.embers === 170, 'an owned entry cannot be bought twice');
    ok(!S.buyArmory(a, 'ranger', 'zz_k1') && !S.buyArmory(a, 'knight', 'no_such') && !S.armoryOwned(a, 'ranger', 'zz_k1'), 'an entry belongs to its own hero; unknown ids are refused');
    same(S.metaBundle(a, 'knight').armory, ['zz_k1'], 'the meta bundle lists the hero\'s owned entries');
    same([S.metaBundle(a, 'pyro').armory, S.metaBundle(a, 'knight').relics], [[], undefined], 'other heroes carry none; the bundle has no relic list');
    ok(S.buyArmory(a, 'pyro', 'zz_p2') && a.embers === 90, 'a second hero\'s entry');
    const back = S.decode(S.encode(a));
    same([back.armory.knight, back.armory.pyro, back.armory.necro], [[1, 0, 0], [0, 1], [0]], 'owned entries survive the save code');
    ok(S.refundArmory(a, 'knight', 'zz_k1') && a.embers === 120 && !S.armoryOwned(a, 'knight', 'zz_k1'), 'refunding returns the cost');
    ok(!S.refundArmory(a, 'knight', 'zz_k1') && !S.refundArmory(a, 'knight', 'no_such') && a.embers === 120, 'an unowned entry cannot be refunded');
    a.embers = 500; a.armory = S.defaultProfile().armory;
    S.buyArmory(a, 'knight', 'zz_k3'); S.buyArmory(a, 'pyro', 'zz_p1'); S.buyUpgrade(a, 'might');
    const m1 = ED.UPGRADES[ED.UPGRADE_IDX.might].costs[0];
    ok(S.refundTotal(a) === 60 + 25 + m1 && S.resetUpgrades(a) === 85 + m1 && a.embers === 500 && a.armory.knight.every(v => v === 0) && a.up.every(v => v === 0), 'Reset all also refunds Armory entries');
    // a profile older than the entries gets bits padded on first use
    const old = S.defaultProfile(); old.armory = { knight: [], pyro: [] }; old.embers = 100;
    ok(S.buyArmory(old, 'knight', 'zz_k2') && old.armory.knight.length === 3 && old.armory.knight[1] === 1 && S.normalize(JSON.parse(JSON.stringify(old))).armory.necro.length === 1, 'a profile with a shorter Armory row is padded');
  });
  const e = S.defaultProfile();
  ok(Object.keys(e.armory).join() === ED.CLASS_IDS.join() && ED.CLASS_IDS.every(c => e.armory[c].length === ED.ARMORY[c].length) && S.refundTotal(e) === 0, 'the Armory row of each hero is sized by its table (empty today)');
}

// ---- deeds: positional, the Archivist slot now Relic Keeper ----
{
  const D = ED.DEEDS[ED.DEED_IDX.archivist];
  ok(ED.DEEDS.length === 26 && ED.DEED_IDX.archivist === 21 && ED.DEED_IDX.hearthkeeper === 22 && ED.DEED_IDX.cartographer === 25, 'deeds keep their positions');
  ok(D.name === 'Relic Keeper' && D.desc === 'Hold 10 relics in one run' && D.reward === 60, 'the repurposed deed reads Relic Keeper, 60 embers');
  const p = S.defaultProfile();
  ok(!D.check(p, null) && !D.check(p, { maxRelics: 9 }) && D.check(p, { maxRelics: 10 }), 'Relic Keeper needs 10 relics in one run');
  p.deeds = 1 << ED.DEED_IDX.collector; // Collector (8 relics) already earned
  const got = S.checkDeeds(p, { maxRelics: 10 });
  ok(got.some(d => d.id === 'archivist') && (p.deeds & (1 << 21)) && p.embers === 60 && p.lifetime === 60, 'Relic Keeper pays 60 embers once');
  ok(!S.checkDeeds(p, { maxRelics: 12 }).some(d => d.id === 'archivist'), 'and does not pay again');
}

// ---- deeds Into the Dark and Cartographer; the small Hearth keeps its save positions ----
{
  const I = ED.DEEDS[ED.DEED_IDX.intothedark], C = ED.DEEDS[ED.DEED_IDX.cartographer], p = S.defaultProfile();
  ok(I.desc === 'Clear 6 dark rooms in one run' && I.reward === 50 && ED.DEED_IDX.intothedark === 24, 'Into the Dark: 6 dark rooms in one run, 50 embers, same slot');
  ok(!I.check(p, null) && !I.check(p, {}) && !I.check(p, { darkCleared: 5 }) && I.check(p, { darkCleared: 6 }) && I.check(p, { darkCleared: 12 }) && !I.check(p, { lightlessBoss: true }), 'Into the Dark needs run.darkCleared >= 6');
  ok(/dark rooms/.test(C.desc) && C.reward === 40 && !C.check(p, {}) && C.check(p, { fullClear: true }), 'Cartographer names the dark rooms and keeps its fullClear check');
  const got = S.checkDeeds(p, { darkCleared: 7 });
  ok(got.some(d => d.id === 'intothedark') && !got.some(d => d.id === 'cartographer') && (p.deeds & (1 << 24)), 'a run with 7 dark rooms cleared pays Into the Dark only');
  // the summary a client receives after the run (net.js 'end' event) carries darkCleared as a plain number
  ok(I.check(p, JSON.parse(JSON.stringify({ darkCleared: 6 }))), 'the check reads a plain summary');
}
{ // positions: ids and rank counts are the save code layout; a maxed profile round-trips; the full Hearth's stat totals
  ok(ED.UPGRADES.map(u => u.id).join() === 'vitality,might,fortune,fleet,provisions,bulwark,precision,wisdom,insight,headstart,alacrity,stash,attunement,favor,secondwind,deepwick', 'upgrade order is the save code position order');
  ok(ED.UPGRADES.map(u => u.costs.length).join() === '5,5,3,3,2,3,3,3,3,2,3,2,4,2,2,3', 'rank counts are unchanged');
  const p = S.defaultProfile(); p.up = ED.UPGRADES.map(u => u.costs.length);
  same(S.decode(S.encode(p)).up, p.up, 'every maxed rank survives the code');
  const st = (meta) => ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta, pact: 0 });
  const a = st({ up: ED.UPGRADES.map(() => 0), mastery: 1 }), b = st({ up: ED.UPGRADES.map(u => u.costs.length), mastery: 10 });
  const d = (k) => b[k] - a[k];
  ok(Math.abs(d('dmg') - 0.24) < 1e-9 && Math.abs(d('hp') - 15) < 1e-9 && Math.abs(d('crit') - 0.09) < 1e-9 && Math.abs(d('cdr') - 0.1) < 1e-9 && Math.abs(d('armor') - 9) < 1e-9 && Math.abs(d('spd') - 0.03) < 1e-9 && Math.abs(d('xp') - 0.06) < 1e-9 && Math.abs(d('gold') - 0.06) < 1e-9,
    `full Hearth + mastery 10: +24% damage, +15 health, +9% crit, +10% recharge, +9 armor, +3% speed, +6% xp, +6% gold (got ${['dmg', 'hp', 'crit', 'cdr', 'armor', 'spd', 'xp', 'gold'].map(k => d(k).toFixed(3))})`);
}

// ---- relics: the v7 table (c / r / e drop, boss picks, curses), no element tag, the 14 element relics gone ----
{
  const gone = ['fang', 'embercharm', 'frostshard', 'stormidol', 'halo', 'gravecandle', 'wispjar', 'crest', 'gauntlet', 'frozenheart', 'brazier', 'glaciercore', 'lightningrod', 'venomgland'];
  ok(gone.every(id => !ED.RELICS[id]), 'the 14 element relics are gone');
  const sold = { c: 1, r: 1, e: 1 };
  ok(ED.RELIC_IDS.every(id => { const r = ED.RELICS[id]; return !('start' in r) && !('cost' in r) && !('req' in r) && !('el' in r) && (sold[r.rar] ? ED.RELIC_PRICE[r.rar] > 0 : ED.RELIC_PRICE[r.rar] === undefined); }), 'every relic is a plain pool entry; c / r / e have a shop price, boss relics and curses none');
  const byRar = {}; for (const id of ED.RELIC_IDS) byRar[ED.RELICS[id].rar] = (byRar[ED.RELICS[id].rar] || 0) + 1;
  same(['c', 'r', 'e', 'boss', 'curse'].map(k => byRar[k]), [28, 23, 12, 10, 10], 'relics per rarity (common, rare, epic, boss, curse)');
  ok(ED.relicFits === undefined && S.relicUnlocked === undefined && S.unlockRelic === undefined && S.relicReqMet === undefined, 'the Codex API is gone');
  // the pool in a world
  const w = new ED.World({ seed: 5, pact: 0, players: [{ pid: 'a', name: 'A', slot: 0, cls: 'knight', weapon: 'longsword', meta: META() }] });
  w.startRun();
  const drop = ED.RELIC_IDS.filter(id => sold[ED.RELICS[id].rar]), seen = new Set(), RAR = { c: 0, r: 1, e: 2 };
  for (let i = 0; i < 8000; i++) seen.add(w.rollRelic('c'));
  ok(seen.size === drop.length && [...seen].every(id => sold[ED.RELICS[id].rar]), `a roll reaches every c / r / e relic and never a boss relic or a curse (${seen.size} of ${drop.length})`);
  let low = 0; for (let i = 0; i < 400; i++) if (RAR[ED.RELICS[w.rollRelic('e')].rar] < 2) low++;
  ok(low === 0, 'a minimum rarity is respected');
  let boss = 0, curse = 0; for (let i = 0; i < 200; i++) { if (ED.RELICS[w.rollRelic('boss')].rar === 'boss') boss++; if (ED.RELICS[w.rollRelic('curse')].rar === 'curse') curse++; }
  ok(boss === 200 && curse === 200, 'boss relics and curses roll only when asked for exactly');
  const rest = new Set(drop); rest.delete('mask');
  ok(w.rollRelic('c', rest) === 'mask', 'an exclude set is respected');
  const hero = w.players.get('a'); for (const id of drop) hero.relics.push(id);
  ok(drop.includes(w.rollRelic('c')), 'with every relic held a roll still returns one');
  hero.relics.length = 0;
  hero.relics.push('mask');
  let mask = 0; for (let i = 0; i < 400; i++) if (w.rollRelic('c') === 'mask') mask++;
  ok(mask === 0, 'a relic a hero holds does not drop again');
  const W1 = ED.World.RELIC_W(1), W4 = ED.World.RELIC_W(4);
  ok(W1.c > W4.c && W1.r < W4.r && W1.e < W4.e, 'deeper strata weigh rare and epic relics up, commons down');
}

// ---- per-hero deed counters in the run summary ----
{
  const w = new ED.World({ seed: 11, pact: 0, players: [
    { pid: 'a', name: 'A', slot: 0, cls: 'knight', weapon: 'longsword', meta: META() },
    { pid: 'b', name: 'B', slot: 1, cls: 'cleric', weapon: ED.CLASSES.cleric.weapons[0], meta: META() },
    { pid: 'c', name: 'C', slot: 2, cls: 'ranger', weapon: ED.CLASSES.ranger.weapons[0], meta: META() }] });
  w.startRun();
  const [a, b, c] = ['a', 'b', 'c'].map(k => w.players.get(k));
  const quiet = () => { w.enemies.length = 0; w.enc = null; w.locked = false; };
  quiet();
  // relics: a holds 3 then loses 2, b holds 1
  w.giveRelic(a, 'whetstone'); w.giveRelic(a, 'boots'); w.giveRelic(a, 'buckler'); w.giveRelic(b, 'coin');
  a.relics.length = 1;
  const s0 = w.summary();
  ok(s0.players.a.maxRelics === 3 && s0.players.b.maxRelics === 1 && s0.players.c.maxRelics === 0, `maxRelics per hero is the most held: ${JSON.stringify([s0.players.a.maxRelics, s0.players.b.maxRelics, s0.players.c.maxRelics])}`);
  ok(s0.players.a.relics === 1, 'the end-of-run relic count stays the current one');
  // revive: b goes down next to a (c is far away); only a is credited
  c.x = a.x + 900; c.y = a.y;
  b.x = a.x + 20; b.y = a.y; b.hp = 0; b.downed = true; b.bleed = 18; b.revive = 0;
  for (let i = 0; i < 60 * 10 && b.downed; i++) { quiet(); w.update(1 / 60); }
  ok(!b.downed && !b.dead, 'the fallen hero was revived');
  const s1 = w.summary();
  ok(s1.revives === 1 && s1.players.a.revivesGiven === 1 && s1.players.b.revivesGiven === 0 && s1.players.c.revivesGiven === 0, `revive credit goes to the helper in reach: ${JSON.stringify([s1.revives, s1.players.a.revivesGiven, s1.players.b.revivesGiven, s1.players.c.revivesGiven])}`);
}

// ---- secrets, the Wardrobe and the Bellwarden flag ----
{ // a hand-built v7 code (written without save.js) decodes with empty Wardrobe fields; mastery 10 heroes wear Gilded
  const varint = (v) => { const o = []; do { const chunk = v % 128; v = Math.floor(v / 128); o.push(...bitsOf(v > 0 ? 1 : 0, 1), ...bitsOf(chunk, 7)); } while (v > 0); return o; };
  const head = (ver) => {
    const bits = [...bitsOf(ver, 8), ...bitsOf(5, 4)];
    for (const ch of 'Seven') bits.push(...bitsOf(S.NAME_CHARS.indexOf(ch), 6));
    bits.push(...varint(42), ...varint(4200), ...bitsOf(16, 6));
    for (let i = 0; i < 16; i++) bits.push(...bitsOf(0, 3));
    bits.push(...bitsOf(6, 4)); for (const m of [3600, 0, 900, 0, 0, 0]) bits.push(...varint(m));
    bits.push(...bitsOf(6, 4)); for (let k = 0; k < 6; k++) bits.push(...bitsOf(3, 6), 0, 0, 0);
    bits.push(...bitsOf(1, 6), ...bitsOf(26, 6)); for (let i = 0; i < 26; i++) bits.push(0);
    bits.push(...bitsOf(1, 4), ...bitsOf(0, 4), ...varint(9), ...varint(1), ...bitsOf(5, 3), ...varint(700), ...varint(1200), ...varint(4));
    return bits;
  };
  const bits = head(7);
  const p = S.decode(pack(bits));
  ok(p.name === 'Seven' && p.embers === 42 && p.stats.runs === 9 && p.stats.bossKills === 4 && p.news === 3, 'hand-built v7 code: the fields before the Wardrobe read as before, the v6 notice pending');
  const v8 = head(8).concat(bitsOf(0, 6), bitsOf(0, 4), [0], bitsOf(0, 4), bitsOf(0, 6), bitsOf(0, 4), varint(0), bitsOf(0, 4)); // empty secrets, wins, flag, evolutions, purchases, worn items
  const p8 = S.decode(pack(v8));
  ok(p8.name === 'Seven' && p8.stats.runs === 9 && p8.news === 3, `hand-built v8 code with runs (made before v6): the v6 notice pending, got news ${p8.news}`);
  ok(S.decode(pack([...bitsOf(9, 8)].concat(v8.slice(8)))).news === 4, 'the same body as a v9 code (made before v7): the v7 notice pending');
  ok(S.decode(pack([...bitsOf(9, 8)].concat(v8.slice(8)))).lore === 0, 'a v9 code: no Codex pages');
  const l10 = S.decode(pack([...bitsOf(10, 8)].concat(v8.slice(8), bitsOf(ED.LORE.length + 2, 6), bitsOf(0, ED.LORE.length - 3), [1, 0, 1, 1, 1])));
  ok(l10.lore === 2 ** (ED.LORE.length - 3) + 2 ** (ED.LORE.length - 1) && l10.name === 'Seven' && l10.news === 0, `a v10 code with 2 pages more than this build: its known pages read, the rest skipped, no news (${l10.lore})`);
  ok(p.secrets === 0 && p.heroWins === 0 && p.bellUnlocked === false && JSON.stringify(p.evo) === '{}' && p.cos.length === 0, 'hand-built v7 code: no secrets, wins, Bellwarden, evolutions or purchases');
  ok(p.wear.knight.aura === 'aura.gilded' && p.wear.pyro.aura === null && p.wear.camp === null, 'hand-built v7 code: the mastery 10 Knight wears Gilded, the others nothing');
  const g5 = S.decode(GOLD5);
  ok(g5.secrets === 0 && g5.cos.length === 0 && g5.wear.knight.skin === null, 'a v5 code decodes with an empty Wardrobe');
  const g3 = S.decode(GOLD3.code);
  ok(g3.wear.pyro.aura === 'aura.gilded' && g3.wear.knight.aura === null && g3.wear.ranger.aura === null, 'a v3 code: the mastery 10 hero (Pyromancer) wears Gilded');
  // a stored profile from before the Wardrobe gets Gilded too; a stored wear record is kept as it is
  const old = S.normalize({ v: 5, mastery: [3600, 0, 0, 0, 0, 0], stats: { runs: 3 } });
  ok(old.wear.knight.aura === 'aura.gilded', 'stored profile without a wear record: Gilded worn at mastery 10');
  const off = S.normalize(Object.assign(JSON.parse(JSON.stringify(old)), { wear: { knight: { aura: null } } }));
  ok(off.wear.knight.aura === null, 'Gilded taken off stays off after a reload');
}
{ // sanitising junk
  const p = S.normalize({ secrets: 'x', heroWins: -5, bellUnlocked: 'yes', cos: ['nope', 'skin.knight.a', 'skin.knight.secret', 'tint.longsword', 5, 'skin.knight.a'],
    evo: { longsword: -3, shortbow: 'q', nothing: 5, [ED.CLASSES.pyro.weapons[0]]: 2.7 },
    wear: { camp: 'camp.bluehearth', knight: { skin: 'skin.ranger.a', aura: 'aura.gilded', hat: 'hat.crown', pet: 7, title: 'skin.knight.a', tints: ['longsword', 'x'] }, bogus: { skin: 'skin.knight.a' } } });
  ok(p.secrets === 0 && p.heroWins === 0 && p.bellUnlocked === false, 'junk secrets, wins and flag become empty');
  same(p.cos, ['skin.knight.a'], 'only sold items stay in the purchases, once');
  same(p.evo, { [ED.CLASSES.pyro.weapons[0]]: 2 }, 'evolution counts: whole, positive, known base weapons only');
  ok(p.wear.camp === null && p.wear.bogus === undefined && Object.values(p.wear.knight).every(v => v === null || (Array.isArray(v) && !v.length)), 'unowned, misplaced and unknown worn items are dropped');
  const q = S.normalize({ secrets: 1 << ED.SECRET_IDX.crown | 1 << ED.SECRET_IDX.hearthsitter, cos: ['skin.knight.a'], evo: { longsword: 3 }, mastery: [3600],
    wear: { camp: 'camp.bluehearth', knight: { skin: 'skin.knight.a', aura: 'aura.gilded', hat: 'hat.crown', title: 'skin.knight.a', tints: ['longsword'] }, ranger: { skin: 'skin.knight.a', hat: 'hat.crown', aura: 'aura.gilded' } } });
  same([q.wear.camp, q.wear.knight.skin, q.wear.knight.aura, q.wear.knight.hat, q.wear.knight.title, q.wear.knight.tints], ['camp.bluehearth', 'skin.knight.a', 'aura.gilded', 'hat.crown', null, ['longsword']], 'owned items stay in their slots');
  same([q.wear.ranger.skin, q.wear.ranger.hat, q.wear.ranger.aura], [null, 'hat.crown', null], 'another hero cannot wear the Knight skin or Gilded below mastery 10');
}
{ // grants, purchases, wearing
  const p = S.defaultProfile();
  ok(S.grantSecret(p, 'hearthsitter') === ED.SECRETS[ED.SECRET_IDX.hearthsitter] && S.grantSecret(p, 'hearthsitter') === null && S.grantSecret(p, 'no_such') === null && p.secrets === 1, 'a secret is granted once; unknown ids are refused');
  ok(ED.cosOwned(p, 'camp.bluehearth', null) && S.wear(p, null, 'camp', 'camp.bluehearth') && p.wear.camp === 'camp.bluehearth', 'Hearthsitter gives the Blue Hearth, worn at the camp');
  ok(ED.SECRETS.every(s => (ED.COSMETIC[s.reward] && ED.COSMETIC[s.reward].gate.secret === s.id) || (s.reward === `skin.${s.id}.secret` && !ED.CLASSES[s.id])), 'every secret rewards an item gated by that secret (a hero secret once its hero exists)');
  ok(ED.COSMETICS.length === new Set(ED.COSMETICS.map(c => c.id)).size && ED.COSMETICS.every(c => ED.COS_SLOTS.indexOf(c.slot) >= 0), 'Wardrobe ids are unique and every slot is known');
  ok(ED.CLASS_IDS.every(c => ED.CLASSES[c].weapons.every(w => ED.COSMETIC['tint.' + w] && ED.COSMETIC['tint.' + w].gate.evolve === w) && ['a', 'b', 'secret'].every(k => ED.COSMETIC[`skin.${c}.${k}`])), 'every hero has three skins and a tint per base weapon');
  p.embers = 1000; p.lifetime = 50;
  ok(!S.buyCosmetic(p, 'skin.knight.a') && p.embers === 1000, 'a skin stays closed below its mastery');
  p.mastery[0] = ED.MASTERY_XP[3]; // mastery 4
  ok(S.cosOpen(p, 'skin.knight.a') && !S.cosOpen(p, 'skin.knight.b'), 'mastery 4 opens the first skin, not the second');
  ok(S.buyCosmetic(p, 'skin.knight.a') && p.embers === 850 && p.lifetime === 50 && ED.cosOwned(p, 'skin.knight.a', 'knight'), 'buying takes 150 embers and leaves lifetime');
  ok(!S.buyCosmetic(p, 'skin.knight.a') && p.embers === 850, 'an owned skin cannot be bought twice');
  ok(!S.buyCosmetic(p, 'skin.knight.secret') && !S.buyCosmetic(p, 'aura.gilded') && !S.buyCosmetic(p, 'tint.longsword') && !S.buyCosmetic(p, 'hat.crown') && !S.buyCosmetic(p, 'no_such') && p.embers === 850, 'secret, mastery and evolution items are never sold');
  p.mastery[0] = ED.MASTERY_XP[6]; p.embers = 299;
  ok(!S.buyCosmetic(p, 'skin.knight.b') && p.embers === 299, 'the second skin needs 300 embers');
  ok(S.refundTotal(p) === 0 && S.resetUpgrades(p) === 0 && p.embers === 299 && p.cos.indexOf('skin.knight.a') >= 0, 'Reset all neither refunds nor removes Wardrobe purchases');
  ok(!S.wear(p, 'ranger', 'skin', 'skin.knight.a') && !S.wear(p, 'knight', 'hat', 'skin.knight.a') && !S.wear(p, 'knight', 'skin', 'skin.knight.b') && !S.wear(p, 'knight', 'skin', 'no_such'), 'another hero, a wrong slot, an unowned item or an unknown id is refused');
  ok(S.wear(p, 'knight', 'skin', 'skin.knight.a') && p.wear.knight.skin === 'skin.knight.a' && S.wear(p, 'knight', 'skin', null) && p.wear.knight.skin === null, 'wear and take off a skin');
  ok(!S.wear(p, 'knight', 'tint', 'tint.longsword'), 'a tint needs its evolutions');
  p.evo.longsword = 3;
  ok(S.wear(p, 'knight', 'tint', 'tint.longsword') && S.wear(p, 'knight', 'tint', 'tint.longsword') && p.wear.knight.tints.join() === 'longsword' && S.wear(p, 'knight', 'tint', 'tint.longsword', false) && p.wear.knight.tints.length === 0, 'a tint is worn once and taken off');
  ok(!S.wear(p, 'knight', 'aura', 'aura.gilded'), 'Gilded needs the wearing hero at mastery 10');
  p.mastery[0] = ED.MASTERY_XP[9];
  ok(S.wear(p, 'knight', 'aura', 'aura.gilded') && !S.wear(p, 'ranger', 'aura', 'aura.gilded'), 'Gilded follows each hero\'s own mastery');
  same(S.wearBundle(p, 'knight'), { skin: null, aura: 'aura.gilded', hat: null, pet: null, trail: null, death: null, title: null, tints: [] }, 'the wear bundle lists the hero\'s items');
}
{ // run end: secrets, heroWins after Hollow Crown, evolutions, Gilded, the Bellwarden flag
  const runOf = (o) => Object.assign({ cls: 'knight', victory: true, stratum: 6, roomsCleared: 10, pact: 0, party: 1, embers: { rooms: 1, elites: 0, bosses: 0, victory: 0 } }, o);
  const p = S.defaultProfile();
  let res = S.applyRun(p, runOf({ pact: 10, gold777: true, me: { platino: true, thread: true, contrarian: true, heroSecret: true } }));
  same(res.secrets.map(s => s.id).sort(), ['change', 'contrarian', 'crown', 'knight', 'platino', 'thread', 'unkindled'].sort(), 'a run grants its secrets');
  ok(p.heroWins === 1, 'the victory joins heroWins after the Hollow Crown check');
  res = S.applyRun(p, runOf({ pact: 10, me: { heroSecret: true } }));
  ok(res.secrets.length === 0, 'secrets are never granted twice');
  const q = S.defaultProfile(); q.heroWins = 1;
  ok(!S.applyRun(q, runOf({ pact: 10 })).secrets.some(s => s.id === 'crown'), 'Hollow Crown needs a hero who never won');
  ok(!S.applyRun(S.defaultProfile(), runOf({ cls: 'ranger', me: { heroSecret: true } })).secrets.some(s => s.id === 'knight'), 'a hero secret goes to the hero who earned it');
  const r = S.defaultProfile(); r.up[0] = 1;
  ok(!S.applyRun(r, runOf({ victory: true })).secrets.some(s => s.id === 'unkindled') && !S.applyRun(S.defaultProfile(), runOf({ victory: false })).secrets.some(s => s.id === 'unkindled'), 'Unkindled needs a victory without Hearth upgrades');
  ok(S.applyRun(S.defaultProfile(), runOf({ victory: false, oneFace: true })).secrets.some(s => s.id === 'oneface'), 'One Face reads run.oneFace');
  // evolutions: three descents with the Longsword evolved (an Armory variant counts for its base) earn its tint
  const e = S.defaultProfile();
  S.applyRun(e, runOf({ evolved: true, weapon: 'longsword' }));
  S.applyRun(e, runOf({ evolved: false, weapon: 'longsword' }));
  S.applyRun(e, runOf({ evolved: true, weapon: 'longsword@heavy' }));
  const third = S.applyRun(e, runOf({ evolved: true, weapon: ED.ARMORY.knight[0].id }));
  ok(e.evo.longsword === 3 && third.unlocks.some(u => /Wardrobe: Longsword Sheen/.test(u)), `three evolved descents earn the Longsword tint (evo ${e.evo.longsword}, ${third.unlocks})`);
  S.applyRun(e, runOf({ evolved: true, weapon: 'longbow' }));
  ok(Object.keys(e.evo).join() === 'longsword', 'a weapon of another hero does not count');
  // Gilded is worn the run mastery 10 is reached
  const m = S.defaultProfile(); m.mastery[0] = ED.MASTERY_XP[9] - 1;
  const mr = S.applyRun(m, runOf({}));
  ok(m.wear.knight.aura === 'aura.gilded' && mr.unlocks.some(u => /mastery 10/.test(u)), 'reaching mastery 10 wears Gilded');
  // the Bellwarden: a victory with the bell rung, never a defeat
  const b = S.defaultProfile();
  S.applyRun(b, runOf({ victory: false, me: { bellRung: true } }));
  ok(!b.bellUnlocked, 'a defeat with the bell rung unlocks nothing');
  const br = S.applyRun(b, runOf({ me: { bellRung: true } }));
  ok(b.bellUnlocked === true && (!ED.CLASSES.bell || br.unlocks.indexOf('New hero: Bellwarden') >= 0), 'a victory with the bell rung unlocks the Bellwarden');
  ED.CLASSES.zz_bell = { unlock: { bell: true, text: '???' } };
  try { ok(S.classUnlocked(b, 'zz_bell') && !S.classUnlocked(S.defaultProfile(), 'zz_bell'), 'unlock.bell reads profile.bellUnlocked'); } finally { delete ED.CLASSES.zz_bell; }
  const back = S.decode(S.encode(b));
  ok(back.bellUnlocked === true && back.heroWins === b.heroWins && back.secrets === b.secrets, 'the flag, wins and secrets survive the code');
  // Many Faces: six heroes
  const D = ED.DEEDS[ED.DEED_IDX.manyfaces], f = S.defaultProfile();
  ok(D.desc === 'Unlock six heroes' && !D.check(f), 'Many Faces reads Unlock six heroes');
  f.bosses = 3; f.stats.runs = 4;
  ok(D.check(f), 'six unlocked heroes earn Many Faces');
}
{ // a code from a newer build with an extra secret and Wardrobe entries decodes here; ours decodes there
  const p = randomProfile(), sx = { id: 'zz_sec', name: 'Zz', desc: '', icon: 'x', reward: 'zz_cos', check: () => false }, cx = { id: 'zz_cos', slot: 'hat', cls: null, name: 'Zz', gate: { secret: 'zz_sec' } }, kx = { id: 'zz_kcos', slot: 'hat', cls: 'knight', name: 'Zk', gate: { mastery: 1, cost: 1 } };
  const withMore = (f) => {
    ED.SECRETS.push(sx); ED.SECRET_IDX.zz_sec = ED.SECRETS.length - 1; ED.COS_SCOPE[''].push(cx); ED.COS_SCOPE.knight.push(kx); ED.COSMETICS.push(cx, kx); ED.COSMETIC.zz_cos = cx; ED.COSMETIC.zz_kcos = kx;
    try { return f(); } finally { ED.SECRETS.pop(); delete ED.SECRET_IDX.zz_sec; ED.COS_SCOPE[''].pop(); ED.COS_SCOPE.knight.pop(); ED.COSMETICS.length -= 2; delete ED.COSMETIC.zz_cos; delete ED.COSMETIC.zz_kcos; }
  };
  const big = withMore(() => { const b = S.normalize(Object.assign(JSON.parse(JSON.stringify(p)), { secrets: p.secrets | (1 << (ED.SECRETS.length - 1)), cos: p.cos.concat('zz_kcos') })); b.wear.knight.hat = 'zz_kcos'; b.wear.ranger.hat = 'zz_cos'; return S.encode(b); });
  const r = S.decode(big);
  ok(r.secrets === p.secrets && r.cos.join() === p.cos.join() && r.bellUnlocked === p.bellUnlocked && JSON.stringify(r.evo) === JSON.stringify(p.evo), 'newer code, older build: extra secret and items skipped, the rest intact');
  ok(r.wear.knight.hat === null && r.wear.ranger.hat === null && r.wear.knight.skin === p.wear.knight.skin, 'newer code, older build: worn unknown items come off');
  const o = withMore(() => S.decode(S.encode(p)));
  ok(o.secrets === p.secrets && o.cos.join() === p.cos.join() && JSON.stringify(o.wear) === JSON.stringify(p.wear), 'old code, newer build: secrets, purchases and worn items intact');
}

console.log(fails ? `${fails} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(fails ? 1 : 0);
