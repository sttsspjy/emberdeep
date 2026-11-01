// Headless profile / meta check (exit 1 on failure). Usage: node tools/check-save.js
// 1. Default profile and unlock state. 2. Shop costs, buy, refund. 3. Save code round trip, typo tolerance, rejection messages, append-only lists.
// 4. normalize clamps junk. 5. applyRun: gold, records, each hero unlock rule, stage unlocks, no weapon news. 6. ED.Meta API with a mock localStorage.
// 7. Meta ranks reach ED.Stats and the run's reroll / skip / banish counts. 8. seen: back-fill, run record (view rect, boss), merge, save code round trip, old / future codes.
// 9. Settings: old LMB / RMB skill binds cleared once, other mouse binds kept. 10. Achievements: data, earn once, applyRun news, save code, Camp-full / every-hero rules.
// 11. Economy: price table total, run-end gold of World.end per stage. 12. Cosmetics: data, buy / wear / take off, save code, old codes, peer bundles, achievement rewards.
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
const OLD_SHOP = ['might', 'vigor', 'plating', 'mending', 'swiftness', 'magnet', 'growth', 'greed', 'fortune', 'revival', 'reroll', 'skip', 'banish'];
ok(eq(ED.SHOP_IDS, OLD_SHOP.concat(['haste', 'reach', 'duration', 'velocity', 'multishot', 'focus'])) && ED.SHOP.every(s => s.icon && ED.Stats.KEYS.indexOf(s.stat) >= 0),
  'shop: the 13 old ranks in save order, 6 appended; every row has an icon and an ED.Stats key');

// 2. shop: price of rank r + 1 = cost x (r + 1)^2
const p = S.defaultProfile();
const MI = ED.SHOP.find(s => s.id === 'might'), price = (s, r) => s.cost * (r + 1) * (r + 1), B = MI.cost;
ok(ED.SHOP.every(s => [...Array(s.max).keys()].every(r => ED.shopPrice(s, r) === price(s, r))) && ED.shopPrice(MI, MI.max) === 0, 'price rule cost x (rank + 1)^2, 0 when maxed');
ok(ED.SHOP.filter(s => s.max > 1 && s.id !== 'revival').every(s => s.cost <= 120), 'cheap first ranks (<= 120) on every multi-rank row but Revival');
p.gold = B + 4 * B + 9 * B - 1;
ok(S.shopCost(p, 'might') === B && S.buy(p, 'might') && S.rank(p, 'might') === 1, 'buy might rank 1 for ' + B);
ok(S.shopCost(p, 'might') === 4 * B && S.buy(p, 'might') && p.gold === 9 * B - 1, 'rank 2 costs ' + 4 * B);
ok(!S.buy(p, 'might') && p.gold === 9 * B - 1 && S.rank(p, 'might') === 2, 'rank 3 (' + 9 * B + ') refused one coin short');
p.gold = 1e6; for (let i = 0; i < 9; i++) S.buy(p, 'revival');
const RV = ED.SHOP.find(s => s.id === 'revival');
ok(S.rank(p, 'revival') === 1 && S.shopCost(p, 'revival') === 0 && !S.buy(p, 'revival'), 'revival caps at 1, cost 0 when maxed');
ok(S.shopCost(p, 'nope') === 0 && !S.buy(p, 'nope'), 'unknown shop id refused');
const spent = 5 * B + RV.cost, before = p.gold;
ok(p.spent === spent && S.refundTotal(p) === spent && S.refundAll(p) === spent && p.gold === before + spent && eq(p.shop, {}) && p.spent === 0 && S.refundTotal(p) === 0, 'refund returns every coin spent (' + spent + ') and clears ranks');
const leg = S.normalize({ gold: 7, shop: { might: 5, revival: 2 } });
ok(leg.spent === 80 * 15 + 80 && S.refundTotal(leg) === 1280 && leg.shop.revival === 1 && leg.gold === 7 + 160, 'a profile from before spent was kept refunds at the old 80 x rank prices (1280; dropped Revival rank 2 paid back 160)');
const rv2 = S.normalize({ gold: 10, lifetime: 50, spent: 3000, shop: { revival: 2, might: 1 } }), rv2b = S.normalize(JSON.parse(JSON.stringify(rv2)));
ok(rv2.shop.revival === 1 && rv2.gold === 10 + 4 * RV.cost && rv2.spent === 3000 - 4 * RV.cost && rv2.lifetime === rv2.gold && eq(rv2b, rv2), 'Revival rank 2 clamps to 1 and refunds its price (' + 4 * RV.cost + ') once');
const rv3 = S.normalize({ gold: 0, spent: 100, shop: { revival: 9 } });
ok(rv3.shop.revival === 1 && rv3.gold === 100 && rv3.spent === 0, 'the Revival refund never exceeds spent; ranks past the former max are dropped unpaid');

// 3. save code
const rich = S.defaultProfile();
Object.assign(rich, { name: 'Ash-9 Vale', gold: 123456789, lifetime: 987654321 });
rich.shop = { might: 5, vigor: 2, revival: 1, banish: 3, skip: 3 };
rich.heroes.push('necro', 'bell'); rich.played = ['knight', 'necro', 'pyro']; rich.beat = [0, 1];
rich.best = { [ED.STAGE_IDS[0]]: { time: 912, kills: 15000, level: 61, won: true }, [ED.STAGE_IDS[1]]: { time: 433, kills: 2100, level: 22, won: false } };
rich.stats = { runs: 77, wins: 3, kills: 400000, bestLevel: 61, bestKills: 15000, bestTime: 912 };
const code = S.encode(rich), back = S.decode(code);
ok(eq(back, S.normalize(rich)), 'rich profile round trip (' + code.length + ' chars)');
ok(code.length <= 200, 'code stays short: ' + code.length + ' chars');
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
ok(a.gold === 90 && a.lifetime === 90 && r.gold === 40 && r.achGold === 50 && eq(r.achs.map(x => x.id), ['time5']) && a.stats.runs === 1 && r.unlocked.length === 0,
  'run gold (40) + Still Standing (+50) banked; 9:59 unlocks nothing');
ok(r.weapons.length === 0 && !r.news.some(x => x.kind === 'weapon') && eq(S.metaBundle(a).sigs, []) && a.played.indexOf('knight') >= 0, 'first knight run: played, no weapon news, no signature pool');
ok(ED.UNLOCKS.sigAfterRun === undefined, 'no sigAfterRun unlock rule');
ok(r.records.length === 0, 'first run on a stage flags no records');
r = S.applyRun(a, summary({ time: 899, kills: 70 }), 0, 'p1');
ok(r.unlocked.length === 0 && r.weapons.length === 0 && eq(r.records, ['time', 'kills']), '14:59 unlocks nothing; records time and kills');
r = S.applyRun(a, summary({ time: 900 }), 0, 'p1');
ok(eq(r.unlocked, ['necro']) && r.news.some(x => x.kind === 'hero' && x.id === 'necro' && x.txt === 'New hero: ' + ED.HEROES.necro.name), 'surviving 15:00 unlocks Necro');
r = S.applyRun(a, summary({ perHero: [{ pid: 'p1', cls: 'ranger', kills: 99999 }], kills: 99999, level: 80 }), 0, 'p1');
ok(r.unlocked.indexOf('shade') < 0 && r.unlocked.indexOf('bell') < 0, 'kills and levels unlock neither Shade nor Bell');
a.gold = 3999;
const shp = S.heroProgress(a, 'shade');
ok(S.heroCost(a, 'shade') === 4000 && !S.buyHero(a, 'shade') && !S.heroUnlocked(a, 'shade') && shp.need === 4000 && shp.cur === 3999 && !shp.done, 'Shade costs 4000 gold; 3999 refused, progress shows the gold');
a.gold = 4500;
ok(S.buyHero(a, 'shade') && a.gold === 500 && S.heroUnlocked(a, 'shade') && S.heroCost(a, 'shade') === 0 && !S.buyHero(a, 'shade') && a.heroes.indexOf('shade') === a.heroes.length - 1, 'Shade bought for 4000, once');
ok(S.heroCost(a, 'bell') === 0 && !S.buyHero(a, 'bell') && S.heroCost(a, 'knight') === 0, 'only { buy } heroes are for sale');
ok(!S.stageUnlocked(a, 1), 'stage 2 locked before a win');
r = S.applyRun(a, summary({ won: true, time: 1205, perHero: [{ pid: 'p1', cls: 'knight', kills: 10, ranks: 1 }] }), 0, 'p1');
ok(eq(r.unlocked, ['cleric']) && eq(r.stages, [1]) && S.stageUnlocked(a, 1) && a.best[ED.STAGE_IDS[0]].won && a.stats.wins === 1 && eq(a.pure, []) && eq(a.won, ['knight']),
  'a win with 1 Camp rank: Cleric and stage 2, no Bell');
r = S.applyRun(a, summary({ won: true }), 0, 'p1');
ok(r.unlocked.indexOf('bell') < 0 && eq(a.pure, []), 'a summary without ranks (dropped connection) never counts as no-Camp');
r = S.applyRun(a, summary({ perHero: [{ pid: 'p1', cls: 'knight', kills: 10, ranks: 0 }] }), 0, 'p1');
ok(r.unlocked.indexOf('bell') < 0 && eq(a.pure, []), 'a no-Camp loss does not unlock Bell');
r = S.applyRun(a, summary({ won: true, stage: 1, perHero: [{ pid: 'p2', cls: 'pyro', kills: 10, ranks: 0 }, { pid: 'p1', cls: 'ranger', kills: 10, ranks: 0, form: true }] }), undefined, 'p1');
ok(eq(r.unlocked, ['bell']) && eq(a.pure, [1]) && eq(r.stages, [2]) && S.stageUnlocked(a, 2) && a.stats.coopWins === 1 && eq(a.won, ['knight', 'ranger']) && eq(a.formed, ['ranger']),
  'co-op no-Camp win of stage 2 (stage from the summary): Bell (my hero), stage 3, co-op win, my win and Form only');
ok(ED.HERO_IDS.every(c => S.heroUnlocked(a, c)), 'every hero unlocked');
const hp = S.heroProgress(S.defaultProfile(), 'necro');
ok(hp.prog === 0 && hp.need === 900 && !hp.done, 'hero progress of a fresh profile');

// 6. ED.Meta
store.clear(); M.p = null;
const mp = M.get();
ok(eq(mp, S.defaultProfile()), 'Meta.get() without storage = default profile');
const G0 = 6 * B;
mp.gold = G0;
const rows = M.shop();
ok(rows.length === ED.SHOP.length && rows[0].cost === B && rows[0].afford && rows[0].rank === 0 && !rows[0].maxed, 'Meta.shop rows');
ok(M.buy('might') && M.buy('might') && !M.buy('might') && M.gold() === G0 - 5 * B, 'Meta.buy charges ' + B + ' then ' + 4 * B + ', refuses ' + 9 * B);
ok(S.load().shop.might === 2 && S.load().spent === 5 * B, 'Meta.buy persists ranks and spent');
ok(M.shop()[0].val === 0.1 && M.refundTotal() === 5 * B && M.refund() === 5 * B && M.gold() === G0 && S.load().gold === G0, 'Meta.refund returns ' + 5 * B + ' and persists');
ok(M.unlocked('knight') && !M.unlocked('shade') && M.stageUnlocked(0) && !M.stageUnlocked(1), 'Meta.unlocked / stageUnlocked');
const news = M.recordRun(summary({ won: true, time: 900, kills: 2900, level: 41, perHero: [{ pid: 'me', cls: 'pyro', kills: 2900, ranks: 0 }] }), 'me');
ok(eq(news.filter(x => x.kind !== 'ach').map(x => x.kind + ':' + x.id).sort(), ['hero:bell', 'hero:cleric', 'hero:necro', 'stage:' + ED.STAGE_IDS[1]].sort())
  && eq(news.filter(x => x.kind === 'ach').map(x => x.id), ['time5', 'beat0', 'win.pyro', 'level40', 'pure']), 'Meta.recordRun returns every new unlock, then achievements: ' + news.map(x => x.txt).join(' | '));
ok(M.seen('heroes', 'knight') === false && typeof M.seen === 'function', 'Meta.seen reads the bound profile');
const AG = M.last.achGold;
ok(M.last.gold === 40 && AG === 50 + 200 + 150 + 200 + 400 && M.gold() === G0 + 40 + AG && S.load().stats.runs === 1 && M.heroes().every(h => h.unlocked || h.id === 'shade') && M.stages()[1].unlocked && M.stages()[0].best.won,
  'recordRun saved (run gold + achievement gold); heroes() and stages() rows reflect it');
const c2 = M.code(), restored = M.restore(S.encode(S.defaultProfile()));
ok(restored === M.get() && M.gold() === 0 && S.load().gold === 0, 'Meta.restore replaces and saves the bound profile');
ok(M.restore(c2) && M.gold() === G0 + 40 + AG && M.unlocked('bell') && M.get().ach.length === 5, 'Meta.code -> restore round trip');
ok(/checksum|damaged|never/.test(throwsMsg(() => M.restore('WK1-ZZZZZ'))) && M.unlocked('bell'), 'a bad code leaves the bound profile untouched');
M.get().gold = 4000;
ok(M.buyHero('shade') && M.unlocked('shade') && S.load().heroes.indexOf('shade') >= 0 && M.evalAch().map(x => x.id).join() === 'heroes' && S.load().ach.indexOf('heroes') >= 0, 'Meta.buyHero unlocks Shade and saves; Meta.evalAch then earns Full Roster');
M.use(S.defaultProfile());
ok(!M.unlocked('bell') && M.heroes().find(h => h.id === 'bell').txt === 'Win any stage with no Camp ranks', 'Meta.use binds another profile');

// 7. meta ranks reach the sim
const shop = { might: 3, vigor: 2, plating: 1, swiftness: 1, magnet: 2, growth: 1, greed: 2, fortune: 4, revival: 1, reroll: 2, skip: 1, banish: 3, haste: 2, reach: 1, duration: 3, velocity: 2, multishot: 1, focus: 5 };
const w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight', meta: { shop, sigs: [] } }] }), h = w.heroes[0], st = h.stats, base = ED.HEROES.knight;
const near = (x, y) => Math.abs(x - y) < 1e-9;
ok(near(st.might, 0.15) && st.maxHp === base.hp + 20 && st.armor === 1 && near(st.speed, base.speed * 1.05) && near(st.pickup, ED.Stats.PICKUP * 1.2), 'shop ranks: might, vigor, plating, swiftness, magnet');
ok(near(st.growth, 0.05) && near(st.greed, 0.2) && near(st.luck, 0.2) && st.revival === 1, 'shop ranks: growth, greed, fortune, revival');
ok(h.rerolls === 2 && h.skips === 1 && h.banishes === 3 && eq(h.banned, []), 'run starts with 2 rerolls, 1 skip, 3 banishes');
ok(h.hp === h.maxHp, 'hero starts at full HP with vigor');
ok(near(st.haste, 0.08) && near(st.reach, 0.05) && near(st.duration, 0.15) && near(st.velocity, 0.12) && st.amount === 1 && near(st.focus, 0.2), 'shop ranks: haste, reach, duration, velocity, multishot, focus');
ok(near(ED.Stats.skill(h, 0).cd, Math.max(1, ED.SKILLS[h.skills[0].id].cd * 0.8)), 'Focus 5 cuts the skill cooldown by 20%');

// 8. seen
const ids = (k) => S.seenOrder(k);
ok(S.SEEN_KEYS.every(k => eq(S.defaultProfile().seen[k], [])), 'default profile: nothing seen');
ok(ED.WEAPON_IDS.every(id => S.SEEN_WEAPONS.indexOf(id) >= 0) && new Set(S.SEEN_WEAPONS).size === S.SEEN_WEAPONS.length, 'every registered weapon has a slot in the append-only SEEN_WEAPONS order');
const bf = S.normalize({ played: ['necro', 'knight'], beat: [0], best: { [ED.STAGE_IDS[1]]: { time: 5 } }, seen: { foes: ['bat', 'nope'], weapons: ['zzz'] } });
ok(eq(bf.seen.heroes, ['knight', 'necro']) && eq(bf.seen.weapons, [ED.HEROES.knight.sig, ED.HEROES.necro.sig].sort((x, y) => ids('weapons').indexOf(x) - ids('weapons').indexOf(y)))
  && eq(bf.seen.stages, [ED.STAGE_IDS[0], ED.STAGE_IDS[1]]) && eq(bf.seen.foes, ['bat']), 'normalize back-fills played heroes + signatures and played stages, drops unknown ids');
const rec = S.seenRun(), FX = ED.FOE_IDX;
const view = { stage: 2, me: { cls: 'shade', weapons: [{ id: 'daggers' }, { id: 'shadowfan' }], passives: [{ id: 'haste' }] }, boss: { k: FX.samurai, dead: false },
  foes: [{ k: FX.bat, x: 100, y: 100, r: 6 }, { k: FX.slime, x: 700, y: 100, r: 6 }, { k: FX.skeleton, x: 643, y: 50, r: 6 }, { k: FX.jelly, x: 50, y: 50, r: 6, dead: true }] };
S.seenView(rec, view, 0, 0, 640, 360);
ok(eq([...rec.heroes], ['shade']) && eq([...rec.weapons], ['daggers', 'shadowfan']) && eq([...rec.passives], ['haste']) && eq([...rec.stages], [ED.STAGE_IDS[2]]), 'seenView: own hero, weapons (evolved included), passives, stage');
ok(eq([...rec.foes].sort(), ['bat', 'samurai', 'skeleton']), 'seenView: foes overlapping the view rect and the live boss; off-view and dead foes skipped');
const sp = S.normalize({ played: ['knight'] }), added = S.mergeSeen(sp, rec);
ok(added === 8 && eq(sp.seen.heroes, ['knight', 'shade']) && eq(sp.seen.foes, ids('foes').filter(id => ['bat', 'samurai', 'skeleton'].indexOf(id) >= 0)) && S.isSeen(sp, 'weapons', 'shadowfan') && !S.isSeen(sp, 'weapons', 'longbow'), 'mergeSeen folds the run in save order (' + added + ' new)');
ok(S.mergeSeen(sp, rec) === 0, 'merging the same run again adds nothing');
const full = S.normalize(rich); for (const k of S.SEEN_KEYS) full.seen[k] = ids(k).slice();
const fullBack = S.decode(S.encode(full));
ok(eq(fullBack.seen, full.seen), 'everything seen: round trip (' + S.encode(full).length + ' chars)');
ok(eq(S.decode(S.encode(sp)).seen, sp.seen), 'partial seen: round trip');
const sv = S.normalize({ played: ['knight'] }), srec = S.seenRun();
S.seenView(srec, { stage: 0, me: { cls: 'knight', weapons: [{ id: 'cleave' }, { id: 'censer' }, { id: 'avalanche' }, { id: 'waraxe' }], passives: [] }, foes: [], boss: null }, 0, 0, 640, 360);
S.mergeSeen(sv, srec);
ok(['censer', 'avalanche', 'waraxe'].every(id => S.isSeen(sv, 'weapons', id) && S.isSeen(S.decode(S.encode(sv)), 'weapons', id)) && S.SEEN_WEAPONS.indexOf('waraxe') > S.SEEN_WEAPONS.indexOf('windchime'),
  'support slots (and their Forms) are seen and survive the save code; new supports append after the hero weapons');
// A v1 code from before the seen section: played Knight, stage 1 best -> back-fill only.
const wv = S._writer(); wv.u8(1); wv.vu(0); wv.vu(0); wv.vu(0); wv.vu(0); wv.vu(1); wv.u8(3); wv.vu(1); wv.u8(4); wv.vu(30); wv.vu(5); wv.vu(2); wv.vu(0);
const pre = S.decode(S._pack(wv.b));
ok(eq(pre.seen, { heroes: ['knight'], weapons: [ED.HEROES.knight.sig], passives: [], foes: [], stages: [ED.STAGE_IDS[0]] }), 'code without a seen section decodes; seen = back-fill');
// A future code: one more seen list and longer id lists; extras are dropped.
const wz = S._writer(); wz.u8(1); wz.vu(0); wz.vu(0); wz.vu(0); wz.vu(0); wz.vu(0); wz.vu(0); wz.vu(0);
wz.vu(S.SEEN_KEYS.length + 1); for (let li = 0; li <= S.SEEN_KEYS.length; li++) { const m = (li < S.SEEN_KEYS.length ? (li === 1 ? S.SEEN_WEAPONS.length : ids(S.SEEN_KEYS[li]).length) : 3) + 9; wz.vu(m); for (let i = 0; i < m; i += 8) wz.u8(255); }
const fz = S.decode(S._pack(wz.b));
ok(S.SEEN_KEYS.every(k => eq(fz.seen[k], ids(k).filter(id => k !== 'weapons' || S.SEEN_WEAPONS.indexOf(id) >= 0))), 'future code with more seen lists / ids decodes, extras dropped');

// 9. settings migration
const SK = 'wickdeep.survivors.settings.v1';
store.set(SK, JSON.stringify({ master: 40, binds: { skill1: ['KeyQ', 'Mouse0'], skill2: ['KeyE', 'Mouse2'], dash: ['Space', 'Mouse1'], reroll: ['KeyR', 'Mouse3'] } }));
const s1 = S.loadSettings();
ok(s1.master === 40 && s1.binds.skill1[1] === null && s1.binds.skill2[1] === null && s1.binds.dash[1] === 'Mouse1' && s1.binds.reroll[1] === 'Mouse3' && s1.bindsV === 1, 'old LMB / RMB skill defaults cleared, other mouse binds kept');
ok(JSON.parse(store.get(SK)).bindsV === 1 && JSON.parse(store.get(SK)).binds.skill1[1] === null, 'migration is written back');
store.set(SK, JSON.stringify({ bindsV: 1, binds: { skill1: ['KeyQ', 'Mouse0'] } }));
ok(S.loadSettings().binds.skill1[1] === 'Mouse0', 'a mouse bind made after the migration stays');
store.delete(SK);
ok(S.loadSettings().bindsV === 1 && S.loadSettings().binds === null && !store.has(SK), 'fresh settings: current version, nothing written');

// 10. achievements
const AI = ED.ACH_IDS;
ok(AI.length >= 25 && new Set(AI).size === AI.length && ED.ACHIEVEMENTS.every(x => typeof x.gold === 'number' && typeof x.reward === 'string' && S.achText(x).name && S.achText(x).txt),
  AI.length + ' achievements: unique ids, gold, reward id field, name and line');
ok(eq(AI.slice(0, 4), ['time5', 'beat0', 'beat1', 'beat2']) && ED.HERO_IDS.every(c => AI.indexOf('win.' + c) >= 0 && AI.indexOf('form.' + c) >= 0), 'per-stage, per-hero win and Form achievements');
const e = S.defaultProfile(); e.stats.bestKills = 5000;
const e1 = S.evalAch(e);
ok(eq(e1.map(x => x.id), ['kills5k']) && e.gold === 100 && e.lifetime === 100 && S.evalAch(e).length === 0 && e.gold === 100, 'an achievement pays its gold once');
const ac = S.defaultProfile(); ac.gold = 1e7;
for (const s of ED.SHOP) for (let i = 0; i < s.max; i++) S.buy(ac, s.id);
ok(S.shopLeft(ac) === 0 && S.evalAch(ac).map(x => x.id).join() === 'camp' && S.achProgress(ac, ED.ACHIEVEMENTS.find(x => x.id === 'camp')).done, 'every Camp rank maxed earns Fully Stocked');
S.refundAll(ac);
ok(S.achProgress(ac, ED.ACHIEVEMENTS.find(x => x.id === 'camp')).done && ac.ach.indexOf('camp') >= 0, 'a refund keeps an earned achievement');
const fr = S.normalize(rich); fr.won = ['knight', 'bell']; fr.formed = ['necro']; fr.pure = [2]; fr.ach = ['coop', 'beat0', 'camp']; fr.stats.coopWins = 3; fr.spent = 12345;
const frb = S.decode(S.encode(fr));
ok(eq(frb.won, ['knight', 'bell']) && eq(frb.formed, ['necro']) && eq(frb.pure, [2]) && eq(frb.ach, ['beat0', 'coop', 'camp']) && frb.stats.coopWins === 3 && frb.spent === 12345 && eq(frb, S.normalize(fr)),
  'save code carries wins, Forms, no-Camp wins, achievements (ED.ACH_IDS order), co-op wins and spent');
// A code from the previous build: 13 shop ranks, every hero unlocked, stats without coopWins, a seen section, no achievements or spent.
const wl = S._writer();
wl.u8(1); wl.vu(3); for (const ch of 'Old') wl.u8('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -'.indexOf(ch));
wl.vu(9000); wl.vu(20000);
wl.vu(13); for (let i = 0; i < 13; i++) wl.u8(i === 0 ? 5 : 1);
wl.vu(7); for (let i = 0; i < 7; i++) wl.u8(3);
wl.vu(3); for (let i = 0; i < 3; i++) { wl.u8(i < 2 ? 7 : 0); wl.vu(1200); wl.vu(9000); wl.vu(40); }
wl.vu(6); for (let i = 0; i < 6; i++) wl.vu(i + 1);
wl.vu(5); for (let i = 0; i < 5; i++) wl.vu(0);
const ol = S.decode(S._pack(wl.b));
ok(ol.gold === 9000 && ol.lifetime === 20000 && ol.shop.might === 5 && ol.shop.banish === 1 && !ol.shop.haste && eq(ol.heroes, ED.HERO_IDS) && eq(ol.beat, [0, 1]) && eq(ol.ach, []) && ol.stats.coopWins === 0
  && ol.spent === 40 * 30 + 12 * 80, 'a previous-build code keeps gold, ranks and every unlocked hero; spent from the old prices');
const olN = S.evalAch(ol);
ok(olN.some(x => x.id === 'beat0') && olN.some(x => x.id === 'heroes') && eq(ol.heroes, ED.HERO_IDS), 'its achievements are earned on the next check; no hero is revoked');

// 11. economy
ok(S.shopLeft(S.defaultProfile()) === 41160, 'shop total (every rank) = 41160 gold: ' + S.shopLeft(S.defaultProfile()));
const C = ED.CONST;
ok(C.GOLD.bounty === 62 && C.GOLD.minute === 10 && C.GOLD.mid === 100 && C.GOLD.final === 300 && C.GOLD.win === 300 && eq(ED.STAGES.map(s => s.gold), [1, 1.25, 1.5]), 'gold table: 1 per 62 kills, 10 per minute, mid-boss 100, final 300, win 300; stage gold 1 / 1.25 / 1.5');
const endGold = (stage, kills, time, won) => { const w = new ED.World({ seed: 3, stage, players: [{ pid: 'p1', cls: 'knight', meta: { shop: {}, sigs: [] } }] }); w.kills = kills; w.time = time; w.end(won); return w.gold; };
ok(endGold(0, 3100, 630, false) === 150 && endGold(2, 3100, 630, false) === 225, 'a 10:30 loss with 3100 kills pays 50 + 100 (x1.5 on stage 3)');
ok(endGold(1, 12400, 1205, true) === Math.round(400 * 1.25) + Math.round(300 * 1.25), 'a win pays bounty + minutes, then the win bonus');

// 12. cosmetics (Wardrobe)
const CI = ED.COS_IDS, CB = ED.COS_BY, cosOf = (k) => ED.COSMETICS.filter(d => d.kind === k);
ok(new Set(CI).size === CI.length && ED.COSMETICS.every(d => ED.COS_KINDS.indexOf(d.kind) >= 0 && typeof d.price === 'number' && d.name && (d.price === 0 || (d.price >= 200 && d.price <= 2500))),
  CI.length + ' cosmetics: unique ids, known kinds, price 0 (reward) or 200-2500');
ok(ED.HERO_IDS.every(c => cosOf('skin').filter(d => d.hero === c).length >= 2) && cosOf('tint').length >= 6 && cosOf('kill').length >= 4 && cosOf('lvl').length >= 3 && cosOf('title').length >= 10 && cosOf('ncol').length >= 8,
  'every hero has 2+ skins; 6 tints, 4+ kill and 3+ level-up effects, 10 titles, 8 name colours');
ok(cosOf('skin').every(d => Object.keys(d.map).every(h => ED.HERO_IDS.indexOf(d.hero) >= 0 && /^#[0-9a-f]{6}$/.test(h) && /^#[0-9a-f]{6}$/.test(d.map[h]))) && cosOf('tint').every(d => d.ramp.length === 5),
  'skin maps are #rrggbb -> #rrggbb; tint ramps have 5 colours');
const rewards = ED.ACHIEVEMENTS.filter(a => a.reward);
ok(rewards.every(a => CB[a.reward] && CB[a.reward].price === 0) && ED.COSMETICS.filter(d => !d.price).every(d => S.cosAch(d.id)) && new Set(rewards.map(a => a.reward)).size === rewards.length,
  rewards.length + ' achievement rewards: each a distinct price-0 cosmetic, every price-0 cosmetic is the reward of an achievement');
const cosTotal = S.cosLeft(S.defaultProfile());
ok(cosTotal >= 25000 && cosTotal <= 35000, 'Wardrobe total (gold items) = ' + cosTotal + ' (25,000-35,000)');
const cp = S.defaultProfile(); cp.gold = 1000;
const OB = 'skin.knight.obsidian', VG = 'skin.knight.verdigris', RW = 'skin.knight.gilded';
ok(S.cosCost(cp, OB) === CB[OB].price && !S.buyCos(cp, OB) && cp.gold === 1000 && !S.cosOwned(cp, OB), 'a skin over the gold is refused');
ok(S.buyCos(cp, VG) && cp.gold === 1000 - CB[VG].price && S.cosOwned(cp, VG) && S.cosCost(cp, VG) === 0 && !S.buyCos(cp, VG), 'buy Verdigris once; owned costs 0');
ok(S.cosCost(cp, RW) === 0 && !S.buyCos(cp, RW) && !S.wear(cp, RW) && S.worn(cp, 'skin', 'knight') === '', 'a reward skin cannot be bought or worn before its achievement');
ok(S.wear(cp, VG) && S.worn(cp, 'skin', 'knight') === VG && S.worn(cp, 'skin', 'ranger') === '', 'wear Verdigris on the knight only');
cp.gold = 1e5; S.buyCos(cp, OB); S.buyCos(cp, 'skin.ranger.autumn'); S.buyCos(cp, 'tint.crimson'); S.buyCos(cp, 'tint.azure'); S.buyCos(cp, 'title.lamplighter'); S.buyCos(cp, 'ncol.gold'); S.buyCos(cp, 'kill.embers'); S.buyCos(cp, 'lvl.pillar');
S.wear(cp, OB); S.wear(cp, 'skin.ranger.autumn'); S.wear(cp, 'tint.crimson'); S.wear(cp, 'tint.azure'); S.wear(cp, 'title.lamplighter'); S.wear(cp, 'ncol.gold'); S.wear(cp, 'kill.embers'); S.wear(cp, 'lvl.pillar');
ok(S.worn(cp, 'skin', 'knight') === OB && S.worn(cp, 'skin', 'ranger') === 'skin.ranger.autumn' && S.worn(cp, 'tint') === 'tint.azure' && cp.wear.length === 7, 'one worn per slot (a new tint replaces the old), skins per hero');
ok(eq(S.cosBundle(cp, 'knight'), { skin: OB, tint: 'tint.azure', kill: 'kill.embers', lvl: 'lvl.pillar', title: 'title.lamplighter', ncol: 'ncol.gold' }) && S.cosBundle(cp, 'pyro').skin === '', 'run bundle: own skin of the hero plus the global slots');
S.wear(cp, '', 'tint'); S.wear(cp, '', 'skin', 'ranger');
ok(S.worn(cp, 'tint') === '' && S.worn(cp, 'skin', 'ranger') === '' && S.worn(cp, 'skin', 'knight') === OB, 'take off a tint and the skin of one hero');
const cpb = S.decode(S.encode(cp));
ok(eq(cpb.cos, cp.cos) && eq(cpb.wear, cp.wear) && eq(cpb, S.normalize(cp)), 'save code carries owned and worn cosmetics (' + cp.cos.length + ' owned, ' + cp.wear.length + ' worn)');
ok(eq(S.cosClean({ skin: OB, tint: 'tint.azure', kill: 'title.reaper', title: 'nope', ncol: 'ncol.gold' }, 'knight'), { skin: OB, tint: 'tint.azure', kill: '', lvl: '', title: '', ncol: 'ncol.gold' }) && S.cosClean({ skin: OB }, 'ranger').skin === '' && eq(S.cosClean(null, 'knight'), { skin: '', tint: '', kill: '', lvl: '', title: '', ncol: '' }),
  'peer bundles cleaned: wrong kinds, unknown ids and the skin of another hero dropped');
const jn = S.normalize({ cos: ['nope', VG, RW], wear: [RW, VG, 'tint.crimson'] });
ok(eq(jn.cos, [VG]) && eq(jn.wear, [VG]), 'normalize: unknown and unearned ids dropped, only owned items worn');
// rewards: earned achievements grant their item, also for profiles that earned them before cosmetics existed
const rp = S.defaultProfile(); rp.won = ['knight'];
const rn = S.evalAch(rp).find(x => x.id === 'win.knight');
ok(rn && rn.reward === RW && S.cosOwned(rp, RW) && /Gilded skin/.test(rn.txt) && S.wear(rp, RW), 'Knight Victor grants and announces the Gilded skin; it can be worn');
ok(S.cosOwned(S.normalize({ ach: ['camp', 'kills5k'] }), 'ncol.prism') && S.cosOwned(S.normalize({ ach: ['camp', 'kills5k'] }), 'title.reaper'), 'achievements earned earlier grant their rewards on load');
// a code from before cosmetics (sections end at spent) decodes with nothing worn and the rewards of its achievements
const wp = S._writer();
wp.u8(1); wp.vu(1); wp.u8(0); wp.vu(500); wp.vu(900); wp.vu(0); wp.vu(0); wp.vu(0); wp.vu(0); wp.vu(0);
const achBits = (ids) => { const m = ED.ACH_IDS.indexOf(ids[ids.length - 1]) + 1; wp.vu(m); for (let i = 0; i < m; i += 8) { let v = 0; for (let j = 0; j < 8 && i + j < m; j++) if (ids.indexOf(ED.ACH_IDS[i + j]) >= 0) v |= 1 << j; wp.u8(v); } };
achBits(['beat2']); wp.vu(77);
const pc = S.decode(S._pack(wp.b));
ok(pc.gold === 500 && pc.spent === 77 && eq(pc.ach, ['beat2']) && eq(pc.cos, ['tint.abyss']) && eq(pc.wear, []), 'a pre-Wardrobe code: gold and spent kept, nothing worn, the Abyss tint from its achievement');

console.log(`check-save: ${fails ? fails + ' failure(s)' : 'all passed'}`);
process.exitCode = fails ? 1 : 0;
