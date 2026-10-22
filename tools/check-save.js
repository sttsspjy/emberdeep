// Usage: node tools/check-save.js
// Headless checks of the profile and save code: golden v2 (main era) and v3 (count prefix on relics only) codes still load, v4 round trips and survives appended upgrades/heroes/relics/deeds in both directions,
// a code from a newer build and a Codex overflow report clearly, the pre-v3 profile gets its one-time news flag, and the per-hero deed counters (maxRelics, revivesGiven) in the run summary.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const S = ED.Save, U = ED.U;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const throws = (f, re, msg) => { let m = null; try { f(); } catch (e) { m = e.message; } ok(m !== null && re.test(m), `${msg}: ${m === null ? 'did not throw' : m}`); };

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

// ---- golden codes: written by main's save.js (version 2) and by the pre-count-prefix v3 build; values in GOLD2 / GOLD3 ----
const GOLD2 = {
  code: 'WD1-ENRDZ-330MV-D9HWH-D9BTC-FCJSD-W3C0A-VE1AJ-4KEM9-7QGQH-MR5TQ-6KQ5D-4KBFM-6HGC9-3EX0V-E2',
  name: 'Old Hand', embers: 1234, lifetime: 98765, up: [1, 4, 3, 2, 1, 0, 3, 2, 1, 1, 3, 1, 2, 1, 1, 2],
  relicsNonStart: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], mastery: [0, 120, 5000, 33, 0, 777],
  bosses: 22, deeds: 665, pactMax: 3, pactWin: 1, stats: { runs: 41, wins: 2, deepest: 5, kills: 9001, bestTime: 1432, bossKills: 17 },
};
const GOLD3 = {
  code: 'WD1-EJ093-0BSWA-2P3J7-S2ZAE-ZBARV-HDNKQ-3JFCZ-4HY5P-M6FQQ-ZP935-NPF59-3H142-C67AZ-K7Z5G-MT',
  name: 'Preview', embers: 777, lifetime: 4242, up: [2, 1, 0, 1, 1, 3, 0, 1, 2, 2, 0, 0, 2, 1, 0, 1],
  relicsNonStart: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], mastery: [10, 0, 4000, 0, 250, 9],
  bosses: 53, deeds: 196613, pactMax: 2, pactWin: 0, stats: { runs: 12, wins: 1, deepest: 6, kills: 3100, bestTime: 1111, bossKills: 8 },
};
const nonStart = () => ED.RELIC_IDS.filter(id => !ED.RELICS[id].start);
function checkGolden(g, label, wantNews) {
  const p = S.decode(g.code);
  ok(p.name === g.name && p.embers === g.embers && p.lifetime === g.lifetime, `${label}: name, embers, lifetime`);
  same(p.up, g.up.concat(ED.UPGRADES.slice(g.up.length).map(() => 0)), `${label}: upgrade ranks`);
  const got = nonStart().map(id => p.relics[ED.RELIC_IDX[id]]);
  same(got.slice(0, g.relicsNonStart.length), g.relicsNonStart, `${label}: Codex relics`);
  ok(got.slice(g.relicsNonStart.length).every(v => v === 0), `${label}: relics appended since stay locked`);
  same(p.mastery, g.mastery, `${label}: mastery`);
  ok(p.bosses === g.bosses && p.deeds === g.deeds && p.pactMax === g.pactMax && p.pactWin === g.pactWin, `${label}: bosses, deeds, pacts`);
  same(p.stats, g.stats, `${label}: stats`);
  ok(p.news === wantNews, `${label}: news flag is ${wantNews}, got ${p.news}`);
}
checkGolden(GOLD2, 'v2 code from main', 1);
checkGolden(GOLD3, 'v3 code', 0);

// ---- v4 round trips ----
const rnd = U.RNG(4242);
const ri = (a, b) => a + Math.floor(rnd.next() * (b - a + 1));
function randomProfile() {
  const p = S.defaultProfile();
  p.name = S.sanitizeName('Hero ' + ri(0, 99999)); p.embers = ri(0, 99999); p.lifetime = p.embers + ri(0, 999999);
  p.up = ED.UPGRADES.map(u => ri(0, u.costs.length)); p.relics = ED.RELIC_IDS.map(id => (ED.RELICS[id].start || rnd.next() < 0.5 ? 1 : 0));
  p.mastery = ED.CLASS_IDS.map(() => (rnd.next() < 0.3 ? 0 : ri(0, 200000))); p.bosses = ri(0, 63); p.deeds = ri(0, 2 ** 26 - 1);
  p.pactMax = ri(0, 10); p.pactWin = ri(-1, p.pactMax);
  p.stats = { runs: ri(0, 5000), wins: ri(0, 900), deepest: ri(0, 6), kills: ri(0, 1e7), bestTime: ri(0, 9000), bossKills: ri(0, 3000) };
  return S.normalize(p);
}
let rt = 0;
for (let i = 0; i < 300; i++) {
  const p = randomProfile(), q = S.decode(S.encode(p));
  if (JSON.stringify(q) !== JSON.stringify(Object.assign({}, p, { sel: q.sel }))) { rt++; if (rt < 3) console.log('  round trip differs', JSON.stringify(p), JSON.stringify(q)); }
}
ok(rt === 0, `v4 round trip: ${rt} of 300 profiles differ`);

// ---- appended entries never shift what follows (both directions) ----
function withAppended(f) {
  const u = { id: 'zz_up', name: 'Zz', tier: 1, costs: [1, 2, 3], icon: 'x', step: '', desc: () => '' };
  ED.UPGRADES.push(u); ED.CLASS_IDS.push('zz_cls'); ED.CLASSES.zz_cls = { weapons: [] }; ED.RELIC_IDS.push('zz_rel'); ED.RELICS.zz_rel = { name: 'Zz', rar: 'c', start: false, cost: 10 };
  ED.DEEDS.push({ id: 'zz_deed', name: 'Zz', desc: '', icon: 'x', reward: 1, check: () => false });
  try { return f(); } finally { ED.UPGRADES.pop(); ED.CLASS_IDS.pop(); delete ED.CLASSES.zz_cls; ED.RELIC_IDS.pop(); delete ED.RELICS.zz_rel; ED.DEEDS.pop(); }
}
{
  const p = randomProfile(), old = S.encode(p);
  const q = withAppended(() => S.decode(old)); // a code from before the append, read by a newer build
  same(q.up.slice(0, ED.UPGRADES.length), p.up, 'old code, newer build: upgrade ranks');
  ok(q.up[ED.UPGRADES.length] === 0 && q.mastery[ED.CLASS_IDS.length] === 0 && q.relics[ED.RELIC_IDS.length] === 0, 'old code, newer build: appended entries start at 0');
  ok(q.name === p.name && q.embers === p.embers && q.lifetime === p.lifetime && q.bosses === p.bosses && q.deeds === p.deeds && q.pactMax === p.pactMax && q.pactWin === p.pactWin, 'old code, newer build: scalar fields intact');
  same(q.mastery.slice(0, ED.CLASS_IDS.length), p.mastery, 'old code, newer build: mastery');
  same(q.relics.slice(0, ED.RELIC_IDS.length), p.relics, 'old code, newer build: relics');
  same(q.stats, p.stats, 'old code, newer build: stats');
  const big = withAppended(() => { const b = randomProfile(); b.up[ED.UPGRADES.length - 1] = 3; b.mastery[ED.CLASS_IDS.length - 1] = 12345; b.relics[ED.RELIC_IDS.length - 1] = 1; return { b, code: S.encode(b) }; });
  const r = S.decode(big.code); // a code from a newer build, read by this one
  same(r.up, big.b.up.slice(0, ED.UPGRADES.length), 'newer code, older build: upgrade ranks');
  same(r.mastery, big.b.mastery.slice(0, ED.CLASS_IDS.length), 'newer code, older build: mastery');
  ok(r.name === big.b.name && r.embers === big.b.embers && r.bosses === big.b.bosses && r.pactMax === big.b.pactMax && JSON.stringify(r.stats) === JSON.stringify(big.b.stats), 'newer code, older build: fields after the lists intact');
}

// ---- clear errors ----
throws(() => S.decode(pack(bitsOf(9, 8).concat(bitsOf(0, 120)))), /newer Wickdeep.*Reload/, 'code from a newer version');
throws(() => S.decode(pack(bitsOf(1, 8).concat(bitsOf(0, 120)))), /unknown version or is damaged/, 'version 1 code');
throws(() => S.decode(pack(bitsOf(4, 8).concat(bitsOf(0, 4), bitsOf(0xffffffff, 32), bitsOf(0xffffffff, 32), bitsOf(0xffffffff, 32)))), /unknown version or is damaged/, 'v4 code with a damaged body');
{
  const extra = [];
  for (let i = 0; i < 101; i++) { const id = 'zz_r' + i; ED.RELIC_IDS.push(id); ED.RELICS[id] = { name: 'Zz', rar: 'c', start: false, cost: 1 }; extra.push(id); }
  try { throws(() => S.encode(S.defaultProfile()), /Too many Codex relics/, 'Codex relics beyond the 7-bit count'); }
  finally { for (const id of extra) { ED.RELIC_IDS.pop(); delete ED.RELICS[id]; } }
}
ok(typeof S.encode(S.defaultProfile()) === 'string', 'encode works again after the overflow probe');

// ---- the one-time news flag ----
{
  const base = S.defaultProfile();
  ok(base.news === 0 && base.v === 2, 'a new profile starts at era 2 with no news');
  ok(S.normalize({ v: 1, stats: { runs: 3 } }).news === 1, 'era-1 profile with runs gets the news');
  ok(S.normalize({ stats: { runs: 3 } }).news === 1, 'profile with no era and runs gets the news');
  ok(S.normalize({ v: 1, stats: { runs: 0 } }).news === 0, 'era-1 profile without runs gets none');
  ok(S.normalize({ v: 2, news: 1, stats: { runs: 3 } }).news === 1, 'pending news survives a reload');
  ok(S.normalize({ v: 2, news: 0, stats: { runs: 3 } }).news === 0, 'cleared news stays cleared');
  ok(S.normalize(JSON.parse(JSON.stringify(S.normalize({ v: 1, stats: { runs: 3 } })))).news === 1, 'stored news round-trips through JSON');
  const seen = S.normalize({ v: 1, stats: { runs: 3 } }); seen.news = 0;
  ok(S.normalize(JSON.parse(JSON.stringify(seen))).news === 0, 'once cleared and stored the notice does not return');
  ok(S.decode(S.encode(Object.assign(randomProfile(), { news: 1 }))).news === 0, 'a v4 code carries no news');
}

// ---- Codex relics and the repurposed ones the notice names ----
for (const id of ['fang', 'wardrum', 'wispjar', 'crest', 'chalice', 'bloodstone']) ok(!!ED.RELICS[id], `relic ${id} still exists (the notice maps old names onto it)`);

// ---- per-hero deed counters in the run summary ----
{
  const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
  const w = new ED.World({ seed: 11, pact: 0, players: [
    { pid: 'a', name: 'A', slot: 0, cls: 'knight', weapon: 'longsword', meta: META() },
    { pid: 'b', name: 'B', slot: 1, cls: 'cleric', weapon: ED.CLASSES.cleric.weapons[0], meta: META() },
    { pid: 'c', name: 'C', slot: 2, cls: 'ranger', weapon: ED.CLASSES.ranger.weapons[0], meta: META() }] });
  w.startRun();
  const [a, b, c] = ['a', 'b', 'c'].map(k => w.players.get(k));
  const quiet = () => { w.enemies.length = 0; w.enc = null; w.locked = false; };
  quiet();
  // relics: a holds 3 then loses 2 (a Generalist's transmute can shrink the list), b holds 1
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

console.log(fails ? `${fails} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(fails ? 1 : 0);
