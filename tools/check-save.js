// Headless profile / meta check (exit 1 on failure). Usage: node tools/check-save.js
// 1. Default profile and unlock state. 2. Shop costs, buy, refund. 3. Save code round trip, typo tolerance, rejection messages, append-only lists.
// 4. normalize clamps junk. 5. applyRun: gold, records, each hero unlock rule, stage unlocks, signature weapon news. 6. ED.Meta API with a mock localStorage.
// 7. Meta ranks reach ED.Stats and the run's reroll / skip / banish counts.
'use strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { load } = require('./sim.js');
const ED = load(), S = ED.Save, M = ED.Meta;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
const summary = (o) => Object.assign({ won: false, time: 100, kills: 50, level: 5, gold: 40, stage: 0, perHero: [{ pid: 'p1', cls: 'knight', name: 'A', kills: 50, dealt: {}, weapons: ['cleave'] }] }, o);

// 1. default profile
const p0 = S.defaultProfile();
ok(eq(p0.heroes, ['knight', 'ranger', 'pyro']), 'start heroes: ' + p0.heroes.join(','));
ok(S.stageUnlocked(p0, 0) && !S.stageUnlocked(p0, 1) && !S.stageUnlocked(p0, 2), 'only stage 1 open at start');
ok(ED.SHOP.length === 13 && ED.SHOP_IDS[12] === 'banish' && ED.SHOP.every(s => s.icon), 'shop: 12 design ranks + banish appended, every row has an icon');

// 2. shop
const p = S.defaultProfile();
p.gold = 1000;
ok(S.shopCost(p, 'might') === 200 && S.buy(p, 'might') && p.gold === 800 && S.rank(p, 'might') === 1, 'buy might rank 1 for 200');
ok(S.shopCost(p, 'might') === 400 && S.buy(p, 'might') && p.gold === 400, 'rank 2 costs 400');
ok(!S.buy(p, 'might') && p.gold === 400 && S.rank(p, 'might') === 2, 'rank 3 (600) refused with 400 gold');
p.gold = 1e6; for (let i = 0; i < 9; i++) S.buy(p, 'revival');
ok(S.rank(p, 'revival') === 2 && S.shopCost(p, 'revival') === 0 && !S.buy(p, 'revival'), 'revival caps at 2, cost 0 when maxed');
ok(S.shopCost(p, 'nope') === 0 && !S.buy(p, 'nope'), 'unknown shop id refused');
const spent = 200 + 400 + 200 + 400, before = p.gold;
ok(S.refundTotal(p) === spent && S.refundAll(p) === spent && p.gold === before + spent && eq(p.shop, {}), 'refund returns every coin spent (' + spent + ') and clears ranks');

// 3. save code
const rich = S.defaultProfile();
Object.assign(rich, { name: 'Ash-9 Vale', gold: 123456789, lifetime: 987654321 });
rich.shop = { might: 5, vigor: 2, revival: 1, banish: 3, skip: 3 };
rich.heroes.push('necro', 'bell'); rich.played = ['knight', 'necro', 'pyro']; rich.beat = [0, 1];
rich.best = { [ED.STAGE_IDS[0]]: { time: 912, kills: 15000, level: 61, won: true }, [ED.STAGE_IDS[1]]: { time: 433, kills: 2100, level: 22, won: false } };
rich.stats = { runs: 77, wins: 3, kills: 400000, bestLevel: 61, bestKills: 15000, bestTime: 912 };
const code = S.encode(rich), back = S.decode(code);
ok(eq(back, S.normalize(rich)), 'rich profile round trip (' + code.length + ' chars)');
ok(code.length <= 160, 'code stays short: ' + code.length + ' chars');
ok(eq(S.decode(code.toLowerCase().replace(/-/g, ' ')), back), 'lowercase and spaces accepted');
const typo = code.replace(/0/g, 'O').replace(/1/g, 'I');
ok(eq(S.decode(typo), back), 'O/0 and I/1 confusions accepted');
const flip = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
ok(/checksum/.test(throwsMsg(() => S.decode(flip))), 'one wrong character fails the checksum');
ok(/begin with WK1/.test(throwsMsg(() => S.decode('XX1-ABCDE'))), 'wrong prefix rejected');
ok(/never uses/.test(throwsMsg(() => S.decode('WK1-AB#DE'))), 'foreign characters rejected');
ok(/fails its checksum|damaged/.test(throwsMsg(() => S.decode('WK1-AAAAA-AAAAA'))), 'random code rejected');
const wNew = S._writer(); wNew.u8(S.CODE_VERSION + 1); wNew.vu(0);
ok(/newer/.test(throwsMsg(() => S.decode(S._pack(wNew.b)))), 'a newer code version asks for a reload');
const wTrunc = S._writer(); wTrunc.u8(1); wTrunc.vu(3); wTrunc.u8(0);
ok(/damaged/.test(throwsMsg(() => S.decode(S._pack(wTrunc.b)))), 'a truncated body is reported as damaged');
// A code from a future build with longer lists (extra shop rank, hero, stage, stat) decodes; extras are dropped.
const wf = S._writer(), H = ED.HERO_IDS;
wf.u8(1); wf.vu(3); for (const ch of 'Bob') wf.u8('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -'.indexOf(ch));
wf.vu(500); wf.vu(900);
wf.vu(ED.SHOP.length + 2); for (let i = 0; i < ED.SHOP.length + 2; i++) wf.u8(i === 0 ? 4 : 1);
wf.vu(H.length + 1); for (let i = 0; i < H.length + 1; i++) wf.u8(3);
wf.vu(ED.STAGE_IDS.length + 1); for (let i = 0; i < ED.STAGE_IDS.length + 1; i++) { wf.u8(7); wf.vu(60 * (i + 1)); wf.vu(10); wf.vu(3); }
wf.vu(S.STAT_KEYS.length + 2); for (let i = 0; i < S.STAT_KEYS.length + 2; i++) wf.vu(i + 1);
const fut = S.decode(S._pack(wf.b));
ok(fut.name === 'Bob' && fut.gold === 500 && fut.shop.might === 4 && fut.shop.banish === 1 && fut.heroes.length === H.length && fut.played.length === H.length
  && fut.beat.length === ED.STAGE_IDS.length && fut.best[ED.STAGE_IDS[2]].time === 180 && fut.stats.bestTime === 6, 'future code with longer lists decodes, extras dropped');
// An older code with shorter lists (count prefixes smaller than today's) decodes with defaults.
const wo = S._writer();
wo.u8(1); wo.vu(0); wo.vu(10); wo.vu(10); wo.vu(2); wo.u8(1); wo.u8(2); wo.vu(3); wo.u8(1); wo.u8(1); wo.u8(1); wo.vu(1); wo.u8(0); wo.vu(0); wo.vu(0); wo.vu(0); wo.vu(1); wo.vu(4);
const old = S.decode(S._pack(wo.b));
ok(old.name === 'Wanderer' && old.shop.might === 1 && old.shop.vigor === 2 && !old.shop.banish && eq(old.heroes, ['knight', 'ranger', 'pyro']) && old.stats.runs === 4 && old.stats.bestTime === 0, 'older code with shorter lists decodes with defaults');

// 4. normalize
const n = S.normalize({ name: '<b>Evil</b>!!', gold: -5, lifetime: 'x', shop: { might: 99, vigor: -1, fake: 3 }, heroes: ['necro', 'ghost', 'necro'], played: ['knight', 'knight', 'x'], beat: [0, 0, 9, -1], best: { nope: {} }, stats: { runs: -3, kills: NaN } });
ok(n.name === 'bEvilb' && n.gold === 0 && n.lifetime === 0 && n.shop.might === 5 && n.shop.vigor === undefined && !('fake' in n.shop), 'normalize: name filtered, gold clamped, ranks clamped');
ok(eq(n.heroes, ['knight', 'ranger', 'pyro', 'necro']) && eq(n.played, ['knight']) && eq(n.beat, [0]) && eq(n.best, {}) && n.stats.runs === 0 && n.stats.kills === 0, 'normalize: unknown heroes / stages / stats dropped');
ok(eq(S.normalize(null), S.defaultProfile()), 'normalize(null) = default profile');

// 5. applyRun rules
const a = S.defaultProfile();
let r = S.applyRun(a, summary({ time: 599, gold: 40 }), 0, 'p1');
ok(a.gold === 40 && a.lifetime === 40 && a.stats.runs === 1 && r.unlocked.length === 0, 'run gold banked; 9:59 unlocks nothing');
ok(r.weapons[0] === 'cleave' && r.news.some(x => x.kind === 'weapon' && x.id === 'cleave') && eq(S.metaBundle(a).sigs, ['knight']), 'first knight run puts Cleave in the pool');
ok(r.records.length === 0, 'first run on a stage flags no records');
r = S.applyRun(a, summary({ time: 600, kills: 70 }), 0, 'p1');
ok(eq(r.unlocked, ['necro']) && r.news.some(x => x.kind === 'hero' && x.id === 'necro' && x.txt === 'New hero: Necromancer'.replace('Necromancer', ED.HEROES.necro.name)), 'surviving 10:00 unlocks Necro');
ok(r.weapons.length === 0 && eq(r.records, ['time', 'kills']), 'second run: no weapon news, records time and kills');
r = S.applyRun(a, summary({ perHero: [{ pid: 'p1', cls: 'ranger', kills: 2999 }], kills: 5000 }), 0, 'p1');
ok(r.unlocked.indexOf('shade') < 0, '2999 own kills (5000 party) does not unlock Shade');
r = S.applyRun(a, summary({ perHero: [{ pid: 'p2', cls: 'pyro', kills: 10 }, { pid: 'p1', cls: 'ranger', kills: 3000 }] }), 0, 'p1');
ok(eq(r.unlocked, ['shade']) && a.played.indexOf('ranger') >= 0 && a.played.indexOf('pyro') < 0, '3000 own kills unlock Shade; only my hero counts as played');
r = S.applyRun(a, summary({ level: 40 }), 0, 'p1');
ok(eq(r.unlocked, ['bell']), 'level 40 unlocks Bell');
ok(!S.stageUnlocked(a, 1), 'stage 2 locked before a win');
r = S.applyRun(a, summary({ won: true, time: 905 }), 0, 'p1');
ok(eq(r.unlocked, ['cleric']) && eq(r.stages, [1]) && S.stageUnlocked(a, 1) && a.best[ED.STAGE_IDS[0]].won && a.stats.wins === 1, 'beating stage 1 unlocks Cleric and stage 2');
r = S.applyRun(a, summary({ won: true, stage: 1 }));
ok(eq(r.stages, [2]) && S.stageUnlocked(a, 2) && a.best[ED.STAGE_IDS[1]], 'beating stage 2 (stage from the summary) unlocks stage 3');
ok(ED.HERO_IDS.every(c => S.heroUnlocked(a, c)), 'every hero unlocked');
const hp = S.heroProgress(S.defaultProfile(), 'shade');
ok(hp.prog === 0 && hp.need === 3000 && !hp.done, 'hero progress of a fresh profile');

// 6. ED.Meta
store.clear(); M.p = null;
const mp = M.get();
ok(eq(mp, S.defaultProfile()), 'Meta.get() without storage = default profile');
mp.gold = 700;
const rows = M.shop();
ok(rows.length === ED.SHOP.length && rows[0].cost === 200 && rows[0].afford && rows[0].rank === 0 && !rows[0].maxed, 'Meta.shop rows');
ok(M.buy('might') && M.buy('might') && !M.buy('might') && M.gold() === 100, 'Meta.buy charges 200 then 400, refuses 600');
ok(S.load().shop.might === 2, 'Meta.buy persists');
ok(M.shop()[0].val === 0.1 && M.refundTotal() === 600 && M.refund() === 600 && M.gold() === 700 && S.load().gold === 700, 'Meta.refund returns 600 and persists');
ok(M.unlocked('knight') && !M.unlocked('shade') && M.stageUnlocked(0) && !M.stageUnlocked(1), 'Meta.unlocked / stageUnlocked');
const news = M.recordRun(summary({ won: true, time: 900, kills: 3100, level: 41, perHero: [{ pid: 'me', cls: 'pyro', kills: 3100 }] }), 'me');
ok(eq(news.map(x => x.kind + ':' + x.id).sort(), ['hero:bell', 'hero:cleric', 'hero:necro', 'hero:shade', 'stage:' + ED.STAGE_IDS[1], 'weapon:' + ED.HEROES.pyro.sig].sort()), 'Meta.recordRun returns every new unlock: ' + news.map(x => x.txt).join(' | '));
ok(M.last.gold === 40 && S.load().stats.runs === 1 && M.heroes().every(h => h.unlocked) && M.stages()[1].unlocked && M.stages()[0].best.won, 'recordRun saved; heroes() and stages() rows reflect it');
const c2 = M.code(), restored = M.restore(S.encode(S.defaultProfile()));
ok(restored === M.get() && M.gold() === 0 && S.load().gold === 0, 'Meta.restore replaces and saves the bound profile');
ok(M.restore(c2) && M.gold() === 740 && M.unlocked('bell'), 'Meta.code -> restore round trip');
ok(/checksum|damaged|never/.test(throwsMsg(() => M.restore('WK1-ZZZZZ'))) && M.unlocked('bell'), 'a bad code leaves the bound profile untouched');
M.use(S.defaultProfile());
ok(!M.unlocked('bell') && M.heroes().find(h => h.id === 'bell').txt === 'Reach level 40 in one run', 'Meta.use binds another profile');

// 7. meta ranks reach the sim
const shop = { might: 3, vigor: 2, plating: 1, swiftness: 1, magnet: 2, growth: 1, greed: 2, fortune: 4, revival: 1, reroll: 2, skip: 1, banish: 3 };
const w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight', meta: { shop, sigs: [] } }] }), h = w.heroes[0], st = h.stats, base = ED.HEROES.knight;
const near = (x, y) => Math.abs(x - y) < 1e-9;
ok(near(st.might, 0.15) && st.maxHp === base.hp + 20 && st.armor === 1 && near(st.speed, base.speed * 1.05) && near(st.pickup, ED.Stats.PICKUP * 1.2), 'shop ranks: might, vigor, plating, swiftness, magnet');
ok(near(st.growth, 0.05) && near(st.greed, 0.2) && near(st.luck, 0.2) && st.revival === 1, 'shop ranks: growth, greed, fortune, revival');
ok(h.rerolls === 2 && h.skips === 1 && h.banishes === 3 && eq(h.banned, []), 'run starts with 2 rerolls, 1 skip, 3 banishes');
ok(h.hp === h.maxHp, 'hero starts at full HP with vigor');

console.log(`check-save: ${fails ? fails + ' failure(s)' : 'all passed'}`);
process.exitCode = fails ? 1 : 0;
