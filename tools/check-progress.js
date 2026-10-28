// Headless progression check (exit 1 on failure). Usage: node tools/check-progress.js
// Offers (count, luck 4th card, slot rules, evolution hints and weights, signature pool, gold / heal fallback, determinism), reroll / skip / banish, chests (evolution first,
// level rolls, gold fallback, result list), gems (merge cap, value kept, magnet vacuum), gold with greed, party XP in co-op, holy bomb, damage table.
'use strict';
const { load } = require('./sim.js');
const ED = load(), C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const world = (cls, shop, n, seed) => new ED.World({ seed: seed || 5, stage: 0, players: Array.from({ length: n || 1 }, (_, i) => ({ pid: 'p' + (i + 1), slot: i, cls: i ? 'ranger' : cls || 'knight', meta: { shop: shop || {}, sigs: [] } })) });
const keys = (o) => o.map(c => ED.World.prototype.cardKey(c));
// Weapons to fill slots with: every base weapon except the knight's own signature (general weapons first).
const genIds = ED.WEAPON_IDS.filter(id => !ED.WEAPONS[id].evolved && ED.WEAPONS[id].sig !== 'knight').sort((a, b) => (ED.WEAPONS[a].sig ? 1 : 0) - (ED.WEAPONS[b].sig ? 1 : 0));
const tick = (w, s) => { for (let i = 0; i < Math.round(s * 60); i++) w.update(C.TICK); w.events.length = 0; };

// ---- offers
{
  const w = world(), p = w.heroes[0];
  let o = w.makeOffer(p);
  ok(o.length === 3 && new Set(keys(o)).size === 3, '3 distinct cards at luck 0: ' + o.map(c => c.kind + ':' + c.id).join(' '));
  ok(o.every(c => c.txt && c.txt.length <= 40 && typeof c.sub === 'string' && c.icon && c.name), 'cards carry name, icon, txt <= 40 chars, sub');
  let all = true, four = 0;
  for (const id of ED.PASSIVE_IDS) for (let L = 1; L <= ED.PASSIVES[id].max; L++) { const t = (ED.PASSIVES[id].lines && ED.PASSIVES[id].lines[L - 1]) || ED.PASSIVES[id].txt; if (t.length > 40) all = false; }
  ok(all, 'every passive line <= 40 chars');
  p.stats.luck = 1; for (let i = 0; i < 20; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four === 20, 'luck 1 always gives a 4th card');
  p.stats.luck = 0.5; four = 0; for (let i = 0; i < 400; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four > 150 && four < 250, 'luck 0.5 gives a 4th card about half the time (' + four + '/400)');
  p.stats.luck = 0;
  const sigOther = ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].sig && ED.WEAPONS[id].sig !== 'knight' && !ED.WEAPONS[id].evolved);
  let seen = new Set();
  for (let i = 0; i < 300; i++) for (const c of w.makeOffer(p)) seen.add(c.id);
  ok(!sigOther.some(id => seen.has(id)), 'other heroes\' signature weapons stay out without meta.sigs');
  p.meta.sigs = ['ranger']; seen = new Set();
  for (let i = 0; i < 600; i++) for (const c of w.makeOffer(p)) seen.add(c.id);
  ok(seen.has(ED.HEROES.ranger.sig), 'a played hero\'s signature weapon joins the pool');
  p.meta.sigs = [];
  // full weapon slots: no new weapons; full passive slots: no new passives
  for (const id of genIds.slice(0, 5)) w.addWeapon(p, id);
  for (const id of ED.PASSIVE_IDS.slice(0, 6)) p.passives.push({ id, lvl: 1 });
  w.recalc(p, true);
  let bad = 0, lv = 0, cnt = 0;
  for (let i = 0; i < 300; i++) for (const c of w.makeOffer(p)) { cnt++; if (c.kind === 'weapon' || c.kind === 'passive') bad++; if (c.kind === 'wlvl' || c.kind === 'plvl') lv++; }
  ok(p.weapons.length === 6 && bad === 0, 'full slots: only owned items and skills are offered');
  ok(lv / cnt > 0.85, 'full slots favour owned levels (' + (100 * lv / cnt).toFixed(0) + '%)');
}
// ---- evolution hints
{
  const w = world(), p = w.heroes[0], cl = p.weapons[0];
  cl.lvl = 7;
  let c = w.cardPool(p).find(x => x.c.kind === 'wlvl' && x.c.id === 'cleave').c;
  ok(!c.evo && /Might/.test(c.sub), 'cleave 7 -> 8 without Might: "' + c.sub + '"');
  p.passives.push({ id: 'might', lvl: 1 }); w.recalc(p, false);
  const it = w.cardPool(p).find(x => x.c.kind === 'wlvl' && x.c.id === 'cleave');
  ok(it.c.evo && /Evolution ready/.test(it.c.sub) && it.w >= 7, 'cleave 7 -> 8 with Might: evo card, weight ' + it.w);
  p.passives.length = 0; cl.lvl = 8; w.recalc(p, false);
  const pm = w.cardPool(p).find(x => x.c.kind === 'passive' && x.c.id === 'might');
  ok(pm.c.evo && /Cleave evolves/.test(pm.c.sub) && pm.w >= 7, 'Might with cleave 8: "' + pm.c.sub + '", weight ' + pm.w);
  const pr = w.cardPool(p).find(x => x.c.kind === 'passive' && x.c.id === 'reach');
  ok(!pr.c.evo && /^Evolves: /.test(pr.c.sub), 'unrelated passive names what it evolves: "' + pr.c.sub + '"');
  const nw = w.cardPool(p).find(x => x.c.kind === 'weapon' && ED.WEAPONS[x.c.id].evo);
  ok(!nw || /^Evolves with /.test(nw.c.sub), 'new weapon card names its paired passive' + (nw ? ': "' + nw.c.sub + '"' : ' (no general weapon with an evolution yet)'));
}
// ---- fallback, gold card, determinism
{
  const w = world('knight', { greed: 2 }), p = w.heroes[0];
  p.weapons[0].lvl = ED.weaponMaxLvl(ED.WEAPONS[p.weapons[0].id]);
  for (const id of genIds.slice(0, 5)) { const ws = w.addWeapon(p, id); if (ws) ws.lvl = ED.weaponMaxLvl(ED.WEAPONS[id]); }
  for (const id of ED.PASSIVE_IDS.slice(0, 6)) p.passives.push({ id, lvl: 5 });
  for (const sk of p.skills) sk.lvl = ED.skillMaxLvl(ED.SKILLS[sk.id]);
  w.recalc(p, true);
  const o = w.makeOffer(p);
  ok(p.weapons.length === 6 && o.length === 2 && o[0].kind === 'gold' && o[1].kind === 'heal', 'everything maxed: Gold + Meal');
  ok(o[0].val === 30 && o[0].txt === '+30 gold', 'gold card x greed (+20%): ' + o[0].txt);
  p.offer = o; const g0 = w.gold; w.pickCard(p, 0);
  ok(w.gold === g0 + 30 && p.offer === null, 'picking Gold adds 30 gold');
  const a = world(null, null, 1, 77), b = world(null, null, 1, 77);
  const sa = [], sb = [];
  for (let i = 0; i < 30; i++) { sa.push(keys(a.makeOffer(a.heroes[0])).join()); sb.push(keys(b.makeOffer(b.heroes[0])).join()); }
  ok(sa.join('|') === sb.join('|'), 'offers are deterministic per seed');
}
// ---- reroll / skip / banish through inputs
{
  const w = world('knight', { reroll: 1, skip: 1, banish: 2 }), p = w.heroes[0];
  w.addXp(5); tick(w, 1 / 60);
  ok(p.offer && w.paused && p.rerolls === 1 && p.skips === 1 && p.banishes === 2, 'level 2: offer up, solo paused, counts from meta');
  const first = keys(p.offer);
  w.input('p1', { banish: 2 }); w.update(C.TICK);
  const k = first[1];
  ok(p.banishes === 1 && p.banned[0] === k && p.offer.length === 3 && keys(p.offer).indexOf(k) < 0 && keys(p.offer)[0] === first[0], 'banish card 2: removed (' + k + '), replaced in place, others kept');
  let leak = 0; for (let i = 0; i < 300; i++) if (keys(w.makeOffer(p)).indexOf(k) >= 0) leak++;
  ok(leak === 0, 'a banished item never returns');
  w.input('p1', { reroll: true }); w.update(C.TICK);
  ok(p.rerolls === 0 && p.offer, 'reroll spends one');
  w.input('p1', { reroll: true }); w.update(C.TICK);
  ok(p.rerolls === 0, 'reroll at 0 does nothing');
  w.input('p1', { skip: true }); w.update(C.TICK);
  ok(p.skips === 0 && !p.offer && !w.paused, 'skip closes the offer and unpauses');
  p.offer = [w.goldCard(p)]; p.banishes = 1;
  ok(!w.banishCard(p, 0) && p.banishes === 1, 'Gold cannot be banished');
  p.offer = null;
}
// ---- chests
{
  const w = world(), p = w.heroes[0], cl = p.weapons[0];
  cl.lvl = 8; p.passives.push({ id: 'might', lvl: 1 }); w.recalc(p, false);
  let r = w.openChest(p, 1);
  const ev = w.events.find(e => e.t === 'chest');
  ok(r.length === 1 && r[0].kind === 'evo' && r[0].from === 'cleave' && cl.id === ED.WEAPONS.cleave.evo && cl.evo, 'ready weapon evolves first: ' + r[0].txt);
  ok(ev && ev.results === r && ev.val === 1 && r[0].name && r[0].icon, 'chest event carries the result list');
  w.events.length = 0;
  const lv0 = p.passives[0].lvl;
  r = w.openChest(p, 2);
  ok(r.length === 1 && r[0].kind === 'plvl' && p.passives[0].lvl === lv0 + 1 && r[0].lvl === lv0 + 1, 'evolved weapon at max: the roll levels the passive');
  let counts = [0, 0, 0, 0];
  const w2 = world(), q = w2.heroes[0];
  for (const id of genIds.slice(0, 5)) w2.addWeapon(q, id);
  for (let i = 0; i < 300; i++) { for (const ws of q.weapons) ws.lvl = 1; counts[w2.openChest(q, 1).length]++; }
  ok(counts[1] > 0 && counts[2] > 0 && counts[3] > 0 && counts[0] === 0, 'luck 0 chests give 1-3 levels (' + counts.slice(1).join('/') + ')');
  counts = [0, 0, 0, 0];
  for (let i = 0; i < 100; i++) { for (const ws of q.weapons) ws.lvl = 1; q.stats.luck = 1; counts[w2.openChest(q, 1).length]++; }
  ok(counts[1] === 0 && counts[3] > 40, 'luck 1 chests give at least 2, often 3 (' + counts.slice(1).join('/') + ')');
  for (const ws of q.weapons) ws.lvl = 7;
  r = w2.openChest(q, 1);
  ok(q.weapons.every(ws => ws.lvl <= 8) && r.every(x => x.kind === 'wlvl' || x.kind === 'gold'), 'chest levels never pass max');
  for (const ws of q.weapons) ws.lvl = 8;
  for (const sk of q.skills) sk.lvl = 4;
  const g0 = w2.gold; r = w2.openChest(q, 1);
  ok(r.every(x => x.kind === 'gold') && w2.gold === g0 + 25 * r.length, 'nothing to level: 25 gold per roll');
}
// ---- gems, magnet, gold, bomb
{
  const w = world(), p = w.heroes[0];
  let sum = 0;
  for (let i = 0; i < 500; i++) { const v = i % 7 === 0 ? 5 : 1; sum += v; w.dropGem(100 + (i % 40) * 30, 100 + Math.floor(i / 40) * 30, v); }
  const gems = w.pickups.filter(g => g.k[0] === 'x' && !g.dead);
  ok(gems.length === 350 && gems.reduce((a, g) => a + g.val, 0) === sum, 'gems merge at 350 on the ground, total XP kept (' + sum + ')');
  ok(gems.some(g => g.val > 5 && g.k === 'xp5'), 'merged gems grow and change kind');
  w.spawnPickup('magnet', p.x, p.y, 1);
  tick(w, 3 / 60);
  ok(w.pickups.filter(g => g.k[0] === 'x' && !g.dead).every(g => g.pull === 'p1'), 'magnet pulls every gem on the map');
  for (let i = 0; i < 60 * 8 && w.pickups.some(g => g.k[0] === 'x' && !g.dead); i++) { w.update(C.TICK); w.events.length = 0; if (p.offer) { p.offer = null; p.pend = 0; w.paused = false; } }
  let total = w.xp; for (let L = 1; L < w.level; L++) total += ED.World.xpFor(L);
  ok(!w.pickups.some(g => g.k[0] === 'x' && !g.dead) && Math.abs(total - sum) < 1e-6, 'vacuumed gems reach the hero; XP total ' + total + ' = ' + sum);
  const wg = world('knight', { greed: 5 }), h = wg.heroes[0];
  wg.spawnPickup('gold', h.x + 5, h.y, 10); tick(wg, 0.5);
  ok(wg.gold === 15, 'gold pickup x greed (+50%): ' + wg.gold);
  h.stats.luck = 0.2; wg.spawnPickup('gold', h.x + 5, h.y, 10); tick(wg, 0.5);
  ok(wg.gold === 15 + 16, 'luck adds half its value to gold: ' + (wg.gold - 15));
  const wb = world(), hb = wb.heroes[0];
  wb.sdef = Object.assign({}, wb.sdef, { timeline: wb.sdef.timeline.map(r => Object.assign({}, r, { rate: 0, floor: 0 })) }); // no spawns: a pooled foe reused by the spawner would hide the kill
  const near = wb.spawnFoe(ED.FOE_IDS[0], hb.x + 100, hb.y), far = wb.spawnFoe(ED.FOE_IDS[0], hb.x + 600, hb.y), el = wb.spawnFoe(ED.FOE_IDS[0], hb.x - 100, hb.y, { elite: true });
  wb.spawnPickup('bomb', hb.x, hb.y, 1); tick(wb, 3 / 60);
  ok(near.dead && !far.dead && !el.dead && hb.dealt.bomb > 0, 'holy bomb kills non-elites on screen only');
}
// ---- braziers: drops, elite food, relight 60 s after breaking only while no living hero is within 700 px
{
  const w = world(), p = w.heroes[0], B = w.arena.braziers;
  w.sdef = Object.assign({}, w.sdef, { timeline: w.sdef.timeline.map(r => Object.assign({}, r, { rate: 0, floor: 0 })), events: {}, elites: null, bosses: [] });
  p.weapons.length = 0; p.skills.length = 0;
  ok(B.length >= 40 && B.length <= 55, 'arena has ' + B.length + ' braziers (40-55)');
  const drops = {}; for (const b of B) { w.breakBrazier(b, p); } for (const g of w.pickups) if (!g.dead) drops[g.k] = (drops[g.k] || 0) + 1;
  ok(B.every(b => b.broken && b.t === w.time) && drops.food > 0, 'every brazier breaks and drops (' + JSON.stringify(drops) + ')');
  const b = B.reduce((a, c) => (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? c : a));
  p.x = b.x + 300; p.y = b.y; tick(w, 61);
  ok(b.broken, 'a broken brazier stays broken while a hero is within 700 px (61 s)');
  const far = B.filter(c => Math.hypot(c.x - p.x, c.y - p.y) >= 700), lit = B.filter(c => !c.broken);
  ok(far.length > 0 && lit.length === far.length && lit.every(c => far.includes(c)), 'exactly the braziers 700+ px from the hero relit after 60 s (' + lit.length + ' lit)');
  p.x = b.x + 760; tick(w, 1.1);
  ok(!b.broken && b.hp === 1, 'the hero moves 760 px away: it relights within 1 s');
  let food = 0; for (let i = 0; i < 200; i++) { const e = w.spawnFoe('skeleton', p.x + 300, p.y, { elite: true }); const n0 = w.pickups.filter(g => g.k === 'food' && !g.dead).length; w.killFoe(e, w.src(p, 'test')); if (w.pickups.filter(g => g.k === 'food' && !g.dead).length > n0) food++; }
  ok(food > 70 && food < 130, 'elites drop food about half the time (' + food + ' / 200)');
}
// ---- co-op party XP
{
  const w = world('knight', {}, 2), [a, b] = w.heroes;
  w.addXp(5 + 13); tick(w, 2 / 60);
  ok(w.level === 3 && a.offer && b.offer && !w.paused, 'co-op: one shared bar, both heroes get offers, no pause (level ' + w.level + ')');
  ok(a.pend === 1 && b.pend === 1, 'second level-up queued for both');
  w.input('p1', { pick: 1 }); w.update(C.TICK);
  ok(a.invuln > 0.9 && a.offer && a.pend === 0, 'co-op pick: 1 s invulnerability, the queued offer follows');
  b.downed = true; w.addXp(ED.World.xpFor(w.level)); tick(w, 1 / 60);
  ok(b.pend >= 1, 'a downed hero keeps its queued level-ups');
}
// ---- damage table
{
  const rows = ED.dmgRows({ dealt: { cleave: 100, whirlwind: 300, charge: 50, bomb: 25, other: 5 }, weapons: ['whirlwind'] });
  ok(rows[0].id === 'whirlwind' && rows[0].dmg === 400 && !rows.some(r => r.id === 'cleave'), 'pre-evolution damage folds into the evolved weapon');
  ok(rows.find(r => r.id === 'charge').kind === 'skill' && rows.find(r => r.id === 'bomb').name === 'Holy Bomb' && Math.abs(rows.reduce((s, r) => s + r.frac, 0) - 1) < 1e-9, 'skills, bomb and other rows; fractions sum to 1');
}

console.log(`check-progress: ${fails ? fails + ' failure(s)' : 'all passed'}`);
process.exitCode = fails ? 1 : 0;
