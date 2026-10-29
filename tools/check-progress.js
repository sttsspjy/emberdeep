// Headless progression check (exit 1 on failure). Usage: node tools/check-progress.js
// Offers (count, luck 4th card, weapon-card guarantee, card kinds path / form / refine / passive / skill, weights, Form unlock and lock (one Form per run), gold / heal fallback, determinism), reroll / skip / banish,
// chests (elite: one passive / skill roll or gold; boss: an extra level-up), gems (merge cap, value kept, magnet vacuum), gold with greed, party XP in co-op, holy bomb, damage table.
'use strict';
const { load } = require('./sim.js');
const ED = load(), C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const world = (cls, shop, n, seed) => new ED.World({ seed: seed || 5, stage: 0, players: Array.from({ length: n || 1 }, (_, i) => ({ pid: 'p' + (i + 1), slot: i, cls: i ? 'ranger' : cls || 'knight', meta: { shop: shop || {}, sigs: [] } })) });
const keys = (o) => o.map(c => ED.World.prototype.cardKey(c));
const tick = (w, s) => { for (let i = 0; i < Math.round(s * 60); i++) w.update(C.TICK); w.events.length = 0; };
const KINDS = ['path', 'form', 'refine', 'passive', 'plvl', 'skill', 'gold', 'heal'];

// ---- offers
{
  const w = world(), p = w.heroes[0];
  let o = w.makeOffer(p);
  ok(o.length === 3 && new Set(keys(o)).size === 3, '3 distinct cards at luck 0: ' + o.map(c => c.kind + ':' + c.id).join(' '));
  ok(o.every(c => KINDS.includes(c.kind) && c.txt && c.txt.length <= 40 && c.sub === '' && c.icon && c.name), 'cards carry a known kind, name, icon, txt <= 40 chars, empty sub');
  let all = true, four = 0;
  for (const id of ED.PASSIVE_IDS) for (let L = 1; L <= ED.PASSIVES[id].max; L++) { const t = (ED.PASSIVES[id].lines && ED.PASSIVES[id].lines[L - 1]) || ED.PASSIVES[id].txt; if (t.length > 40) all = false; }
  for (const cls of ED.HERO_IDS) {
    const d = ED.WEAPONS[ED.HEROES[cls].sig];
    for (const pa of d.paths) for (const r of pa.ranks) if (!r.txt || r.txt.length > 40) all = false;
    for (const f of ED.weaponForms(d.id)) { const fd = ED.WEAPONS[f.id]; if (!fd.txt || fd.txt.length > 40) all = false; for (const r of fd.refine) if (!r.txt || r.txt.length > 40) all = false; }
  }
  ok(all, 'every passive, path rank, Form and refine line <= 40 chars');
  p.stats.luck = 1; for (let i = 0; i < 20; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four === 20, 'luck 1 always gives a 4th card');
  p.stats.luck = 0.5; four = 0; for (let i = 0; i < 400; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four > 150 && four < 250, 'luck 0.5 gives a 4th card about half the time (' + four + '/400)');
  p.stats.luck = 0;
  const seen = new Set();
  for (let i = 0; i < 300; i++) for (const c of w.makeOffer(p)) { seen.add(c.kind); if (c.kind === 'path' && c.id !== 'cleave') seen.add('bad'); }
  ok(seen.has('path') && seen.has('passive') && seen.has('skill') && !seen.has('form') && !seen.has('refine') && !seen.has('bad'), 'start pool: own weapon paths, passives, skill; no Form yet (' + [...seen].join(',') + ')');
  ok(ED.MAX_WEAPONS === 1 && !w.addWeapon(p, 'longbow'), 'one weapon per hero: a second weapon cannot be added');
  // pool weights
  const pool = w.cardPool(p), wt = (k) => (pool.find(x => x.c.kind === k) || {}).w;
  ok(wt('path') === 4 && wt('passive') === 2 && wt('skill') === 1.5 && pool.filter(x => x.c.kind === 'path').length === 3, 'weights: path 4 (3 paths), new passive 2, skill 1.5');
  // weapon guarantee: >= 2 weapon cards while party level <= 5, >= 1 after; weapon cards not pinned to slot 1
  const wpn = (o) => o.filter(c => c.kind === 'path' || c.kind === 'form' || c.kind === 'refine').length;
  let lo = 99, hi = 99, slot = new Set();
  for (let i = 0; i < 200; i++) { const o = w.makeOffer(p); lo = Math.min(lo, wpn(o)); o.forEach((c, j) => { if (c.kind !== 'path') slot.add(j); }); }
  w.level = 6; for (let i = 0; i < 200; i++) hi = Math.min(hi, wpn(w.makeOffer(p))); w.level = 1;
  ok(lo >= 2 && hi >= 1 && slot.has(0), `weapon guarantee: min ${lo} weapon cards at level <= 5, min ${hi} after; non-weapon cards reach slot 1`);
  // full passive slots: no new passives, levels weighted up
  for (const id of ED.PASSIVE_IDS.slice(0, 6)) p.passives.push({ id, lvl: 1 });
  w.recalc(p, true);
  let bad = 0;
  for (let i = 0; i < 200; i++) for (const c of w.makeOffer(p)) if (c.kind === 'passive') bad++;
  ok(bad === 0 && w.cardPool(p).find(x => x.c.kind === 'plvl').w === 4.5, 'full passive slots: no new passives, passive level weight 4.5');
}
// ---- paths, Forms, refine
{
  const w = world(), p = w.heroes[0], ws = p.weapons[0], d = ED.WEAPONS.cleave;
  const path0 = () => w.cardPool(p).find(x => x.c.kind === 'path' && x.c.path === 0);
  let c = path0().c;
  ok(c.id === 'cleave' && c.lvl === 1 && c.name === d.paths[0].name && c.txt === d.paths[0].ranks[0].txt && c.icon === d.icon, 'path card: root id, rank 1, path name, rank line');
  ok(w.cardKey(c) === 'r:cleave:0', 'path banish key r:<root>:<i>');
  const S0 = ED.Stats.weapon(p, 0).area;
  p.offer = [c]; w.pickCard(p, 0);
  ok(ws.pr[0] === 1 && ws.lvl === 2 && w.weaponS(p, 0).area > S0, 'picking a path rank: pr[0] 1, lvl 2, its mods apply (area ' + S0.toFixed(2) + ' -> ' + w.weaponS(p, 0).area.toFixed(2) + ')');
  w.rankPath(p, ws, 0); w.rankPath(p, ws, 0);
  ok(ws.pr[0] === 3 && !w.rankPath(p, ws, 0) && !w.cardPool(p).some(x => x.c.kind === 'path' && x.c.path === 0), 'path caps at rank 3 and leaves the pool');
  const fc = w.cardPool(p).find(x => x.c.kind === 'form');
  ok(fc && fc.c.id === d.paths[0].form && fc.w === 6 && fc.c.path === 0 && w.cardKey(fc.c) === 'f:' + fc.c.id, 'rank 3 unlocks the path Form card (weight 6, key f:<form>)');
  p.offer = [fc.c]; w.pickCard(p, 0);
  const ev = w.events.find(e => e.t === 'evolve');
  const F = d.paths[0].form, FD = ED.WEAPONS[F];
  ok(ws.id === F && ws.evo && ws.lvl === 5 && ev && ev.from === 'cleave' && ev.wid === F, 'taking the Form swaps the weapon id, emits evolve, lvl 5');
  ok(!w.cardPool(p).some(x => x.c.kind === 'form') && w.formsReady(p, ws).length === 0, 'one Form per run: no more Form cards');
  w.rankPath(p, ws, 1); w.rankPath(p, ws, 1); w.rankPath(p, ws, 1);
  ok(ws.pr[1] === 3 && !w.cardPool(p).some(x => x.c.kind === 'form'), 'another path at rank 3 after a Form: still no Form');
  const S1 = w.weaponS(p, 0);
  ok(S1.back === true && S1.n >= (FD.base.n || 1) + 1, 'path mods keep applying after the Form (back, n ' + S1.n + ')');
  const rc = w.cardPool(p).find(x => x.c.kind === 'refine');
  ok(rc && rc.w === 3 && rc.c.id === F && rc.c.lvl === 1 && w.cardKey(rc.c) === 'x:' + F, 'refine card offered (weight 3, key x:<form>)');
  const RK = Object.keys(FD.refine[0].mods).find(k => typeof FD.refine[0].mods[k] === 'number'), n0 = w.weaponS(p, 0)[RK];
  p.offer = [rc.c]; w.pickCard(p, 0);
  ok(ws.fl === 1 && w.weaponS(p, 0)[RK] > n0, 'refine 1 applies its mods (' + RK + ' ' + n0 + ' -> ' + w.weaponS(p, 0)[RK] + ')');
  w.refineForm(p, ws);
  ok(ws.fl === 2 && !w.refineForm(p, ws) && !w.cardPool(p).some(x => x.c.kind === 'refine'), 'refine caps at 2 and leaves the pool');
  // hybrid Forms (if any hero defines one) need both paths at rank 3
  let hy = 0;
  for (const cls of ED.HERO_IDS) for (const f of ED.weaponForms(ED.HEROES[cls].sig)) if (f.path < 0) {
    hy++;
    const w2 = world(cls), q = w2.heroes[0], s = q.weapons[0];
    for (let r = 0; r < 3; r++) w2.rankPath(q, s, f.need[0]);
    const a = w2.formsReady(q, s).some(x => x.id === f.id);
    for (let r = 0; r < 3; r++) w2.rankPath(q, s, f.need[1]);
    ok(!a && w2.formsReady(q, s).some(x => x.id === f.id), cls + ': hybrid ' + f.id + ' needs both paths at rank 3');
  }
  ok(ED.HERO_IDS.every(cls => ED.weaponForms(ED.HEROES[cls].sig).length >= 1), 'every hero weapon has at least one Form (' + hy + ' hybrids)');
}
// ---- fallback, gold card, determinism
{
  const w = world('knight', { greed: 2 }), p = w.heroes[0];
  w.setRanks(p, p.weapons[0], 9, true);
  for (const id of ED.PASSIVE_IDS.slice(0, 6)) p.passives.push({ id, lvl: 5 });
  for (const sk of p.skills) sk.lvl = ED.skillMaxLvl(ED.SKILLS[sk.id]);
  w.recalc(p, true);
  const o = w.makeOffer(p);
  ok(p.weapons[0].evo && p.weapons[0].fl === 2 && o.length === 2 && o[0].kind === 'gold' && o[1].kind === 'heal', 'everything maxed: Gold + Meal');
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
  w.addXp(ED.World.xpFor(1)); tick(w, 1 / 60);
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
  // banishing one path keeps the other paths
  const w2 = world(), q = w2.heroes[0];
  q.banned.push('r:cleave:1');
  const paths = new Set(); for (let i = 0; i < 300; i++) for (const c of w2.makeOffer(q)) if (c.kind === 'path') paths.add(c.path);
  ok(!paths.has(1) && paths.has(0) && paths.has(2), 'a banished path leaves only that path out of the pool');
}
// ---- chests
{
  const w = world(), p = w.heroes[0], ws = p.weapons[0];
  w.setRanks(p, ws, 3, false);
  const pr0 = ws.pr.join(), id0 = ws.id;
  p.passives.push({ id: 'might', lvl: 1 }); w.recalc(p, false);
  let r = w.openChest(p, 1);
  const ev = w.events.find(e => e.t === 'chest');
  ok(r.length === 1 && (r[0].kind === 'plvl' || r[0].kind === 'skill') && ws.id === id0 && ws.pr.join() === pr0, 'elite chest: one passive / skill roll, never a path or Form (' + r[0].kind + ' ' + r[0].id + ')');
  ok(ev && ev.results === r && ev.val === 1 && r[0].name && r[0].icon && r[0].txt, 'chest event carries the result list');
  let pl = 0, sl = 0;
  for (let i = 0; i < 200; i++) { p.passives[0].lvl = 1; p.skills[0].lvl = 1; const x = w.openChest(p, 1)[0]; if (x.kind === 'plvl') pl++; else if (x.kind === 'skill') sl++; }
  ok(pl > 50 && sl > 50, 'elite rolls pick a passive or the skill (' + pl + '/' + sl + ')');
  p.passives[0].lvl = 5; p.skills[0].lvl = ED.skillMaxLvl(ED.SKILLS[p.skills[0].id]);
  const g0 = w.gold; r = w.openChest(p, 1);
  ok(r.length === 1 && r[0].kind === 'gold' && w.gold === g0 + 25, 'nothing to level: 25 gold');
  w.events.length = 0;
  const pend0 = p.pend; r = w.openChest(p, 2);
  ok(r.length === 1 && r[0].kind === 'offer' && p.pend === pend0 + 1 && r[0].txt, 'boss chest: one extra level-up offer (' + r[0].txt + ')');
  w.updateProgress();
  ok(p.offer && p.pend === pend0, 'the extra level-up opens an offer');
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
  w.addXp(ED.World.xpFor(1) + ED.World.xpFor(2)); tick(w, 2 / 60);
  ok(w.level === 3 && a.offer && b.offer && !w.paused, 'co-op: one shared bar, both heroes get offers, no pause (level ' + w.level + ')');
  ok(a.pend === 1 && b.pend === 1, 'second level-up queued for both');
  w.input('p1', { pick: 1 }); w.update(C.TICK);
  ok(a.invuln > 0.9 && a.offer && a.pend === 0, 'co-op pick: 1 s invulnerability, the queued offer follows');
  b.downed = true; w.addXp(ED.World.xpFor(w.level)); tick(w, 1 / 60);
  ok(b.pend >= 1, 'a downed hero keeps its queued level-ups');
}
// ---- co-op chests: every hero that is not dead gets its own reward and 'chest' event
{
  const w = world('knight', {}, 3), [a, b, c] = w.heroes;
  for (const h of w.heroes) { h.passives.push({ id: 'might', lvl: 1 }); w.recalc(h, false); }
  b.downed = true; c.dead = true; w.events.length = 0;
  const lv = (h) => h.passives[0].lvl + h.skills[0].lvl, l0 = w.heroes.map(lv);
  const r = w.openChest(a, 1), evs = w.events.filter(e => e.t === 'chest');
  ok(evs.length === 2 && evs[0].pid === a.pid && evs[0].results === r && evs[1].pid === b.pid && lv(a) === l0[0] + 1 && lv(b) === l0[1] + 1 && lv(c) === l0[2], 'co-op elite chest: opener and downed hero each roll and get their own event; the dead hero gets nothing');
  const p0 = w.heroes.map(h => h.pend); w.events.length = 0;
  w.openChest(a, 2);
  ok(w.events.filter(e => e.t === 'chest').length === 2 && a.pend === p0[0] + 1 && b.pend === p0[1] + 1 && c.pend === p0[2], 'co-op boss chest: an extra level-up for every hero that is not dead');
}
// ---- damage table
{
  const rows = ED.dmgRows({ dealt: { cleave: 100, whirlwind: 300, charge: 50, bomb: 25, other: 5 }, weapons: ['whirlwind'] });
  ok(rows[0].id === 'whirlwind' && rows[0].dmg === 400 && !rows.some(r => r.id === 'cleave'), 'pre-evolution damage folds into the evolved weapon');
  ok(rows.find(r => r.id === 'charge').kind === 'skill' && rows.find(r => r.id === 'bomb').name === 'Holy Bomb' && Math.abs(rows.reduce((s, r) => s + r.frac, 0) - 1) < 1e-9, 'skills, bomb and other rows; fractions sum to 1');
}

console.log(`check-progress: ${fails ? fails + ' failure(s)' : 'all passed'}`);
process.exitCode = fails ? 1 : 0;
