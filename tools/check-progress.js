// Headless progression check (exit 1 on failure). Usage: node tools/check-progress.js
// Offers (count, luck 4th card, weapon-card guarantee, card kinds path / support / refine / passive / skill, weights, no Form in level-ups, gold / heal fallback, determinism), reroll / skip / banish,
// slots (MAX_WEAPONS 3: hero weapon + 2 supports, addWeapon refusals), support cards (new support, support paths, banish), Forms (deduped per id, one per slot, chest Form offers only:
// boss chest Form offer else an extra level-up, benchmark elite Form offer, queueing, picks only), chests (elite: one passive / skill roll or gold), gems (merge cap, value kept, magnet vacuum),
// gold with greed, party XP in co-op, holy bomb, damage table. Test supports 'tsa' / 'tsb' (Forms 'tsaf' / 'tsbf') are registered in this check's own ED only.
'use strict';
const { load } = require('./sim.js');
const ED = load(), C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const world = (cls, shop, n, seed) => new ED.World({ seed: seed || 5, stage: 0, players: Array.from({ length: n || 1 }, (_, i) => ({ pid: 'p' + (i + 1), slot: i, cls: i ? 'ranger' : cls || 'knight', meta: { shop: shop || {}, sigs: [] } })) });
const keys = (o) => o.map(c => ED.World.prototype.cardKey(c));
const tick = (w, s) => { for (let i = 0; i < Math.round(s * 60); i++) w.update(C.TICK); w.events.length = 0; };
const KINDS = ['path', 'support', 'form', 'refine', 'passive', 'plvl', 'skill', 'gold', 'heal'];
// test supports: 3 paths naming one Form, no-op impl
const NOP = { fire: () => true };
for (const id of ['tsa', 'tsb']) {
  ED.addWeapon({ id, name: 'Test ' + id, icon: 'icon.w.cleave', support: true, role: 'horde', mode: 'around', txt: 'Test support', base: { dmg: 10, cd: 1 }, hybrids: [],
    paths: [0, 1, 2].map(i => ({ id: id + i, name: 'P' + i, form: id + 'f', ranks: [0, 1, 2].map(r => ({ mods: { dmg: 0.1 }, txt: 'Rank ' + (r + 1) })) })) }, NOP);
  ED.addWeapon({ id: id + 'f', name: 'Test ' + id + ' Form', icon: 'icon.w.cleave', support: true, evolved: true, form: true, from: id, txt: 'Test Form', base: { dmg: 20, cd: 1 },
    refine: [{ mods: { dmg: 0.2 }, txt: 'Refine 1' }, { mods: { dmg: 0.2 }, txt: 'Refine 2' }] }, NOP);
}
const isWpn = (c) => c.kind === 'path' || c.kind === 'support' || c.kind === 'refine';

// ---- offers
{
  const w = world(), p = w.heroes[0];
  let o = w.makeOffer(p);
  ok(o.length === 3 && new Set(keys(o)).size === 3, '3 distinct cards at luck 0: ' + o.map(c => c.kind + ':' + c.id).join(' '));
  ok(o.every(c => KINDS.includes(c.kind) && c.txt && c.txt.length <= 40 && c.sub === '' && c.icon && c.name), 'cards carry a known kind, name, icon, txt <= 40 chars, empty sub');
  let all = true, four = 0;
  for (const id of ED.PASSIVE_IDS) for (let L = 1; L <= ED.PASSIVES[id].max; L++) { const t = (ED.PASSIVES[id].lines && ED.PASSIVES[id].lines[L - 1]) || ED.PASSIVES[id].txt; if (t.length > 40) all = false; }
  const roots = ED.HERO_IDS.map(cls => ED.HEROES[cls].sig).concat(ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved));
  for (const id of roots) {
    const d = ED.WEAPONS[id];
    if (d.support && (!d.txt || d.txt.length > 40)) all = false;
    for (const pa of d.paths) for (const r of pa.ranks) if (!r.txt || r.txt.length > 40) all = false;
    for (const f of ED.weaponForms(d.id)) { const fd = ED.WEAPONS[f.id]; if (!fd.txt || fd.txt.length > 40) all = false; for (const r of fd.refine) if (!r.txt || r.txt.length > 40) all = false; }
  }
  ok(all, 'every passive, path rank, support, Form and refine line <= 40 chars (' + roots.length + ' root weapons)');
  p.stats.luck = 1; for (let i = 0; i < 20; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four === 20, 'luck 1 always gives a 4th card');
  p.stats.luck = 0.5; four = 0; for (let i = 0; i < 400; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four > 150 && four < 250, 'luck 0.5 gives a 4th card about half the time (' + four + '/400)');
  p.stats.luck = 0;
  const seen = new Set();
  for (let i = 0; i < 300; i++) for (const c of w.makeOffer(p)) { seen.add(c.kind); if (c.kind === 'path' && c.id !== 'cleave') seen.add('bad'); if (c.kind === 'support' && !ED.WEAPONS[c.id].support) seen.add('bad'); }
  ok(seen.has('path') && seen.has('support') && seen.has('passive') && seen.has('skill') && !seen.has('form') && !seen.has('refine') && !seen.has('bad'),
    'start pool: own weapon paths, new supports, passives, skill; no Form, no refine (' + [...seen].join(',') + ')');
  // pool weights
  const pool = w.cardPool(p), wt = (k) => (pool.find(x => x.c.kind === k) || {}).w;
  const sup = ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved);
  ok(wt('path') === 4 && wt('support') === 2.5 && wt('passive') === 2 && wt('skill') === 1.5 && pool.filter(x => x.c.kind === 'path').length === 3 && pool.filter(x => x.c.kind === 'support').length === sup.length,
    'weights: path 4 (3 paths), new support 2.5 (' + sup.length + ' supports, Forms excluded), new passive 2, skill 1.5');
  // weapon guarantee: >= 2 weapon cards while party level <= 5, >= 1 after; weapon cards not pinned to slot 1
  const wpn = (o) => o.filter(isWpn).length;
  let lo = 99, hi = 99, slot = new Set();
  for (let i = 0; i < 200; i++) { const o = w.makeOffer(p); lo = Math.min(lo, wpn(o)); o.forEach((c, j) => { if (!isWpn(c)) slot.add(j); }); }
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
  const F = d.paths[0].form, FD = ED.WEAPONS[F];
  let noForm = !w.cardPool(p).some(x => x.c.kind === 'form');
  for (let i = 0; i < 200; i++) if (w.makeOffer(p).some(c => c.kind === 'form')) noForm = false;
  ok(w.formsReady(p, ws).some(f => f.id === F) && noForm, 'rank 3 readies the path Form; level-up offers never hold a Form card');
  w.events.length = 0;
  const rb = w.openChest(p, 2), evb = w.events.find(e => e.t === 'chest');
  ok(rb.length === 1 && rb[0].kind === 'form' && rb[0].txt === 'Choose a Form' && p.pendForm === 1 && p.pend === 0 && evb && evb.results === rb, 'boss chest with a ready Form: queues a Form offer, the chest event says so');
  w.updateProgress();
  const fo = p.offer;
  ok(fo && w.isFormOffer(fo) && fo.length === 1 && fo[0].kind === 'form' && fo[0].id === F && fo[0].path === 0 && w.cardKey(fo[0]) === 'f:' + F && p.pendForm === 0 && w.paused,
    'the Form offer opens: one card per ready Form, solo pauses');
  p.rerolls = p.skips = p.banishes = 1;
  w.input('p1', { reroll: true }); w.update(C.TICK); w.input('p1', { banish: 1 }); w.update(C.TICK); w.input('p1', { skip: true }); w.update(C.TICK);
  ok(p.offer === fo && p.rerolls === 1 && p.skips === 1 && p.banishes === 1, 'a Form offer cannot be rerolled, banished or skipped');
  w.events.length = 0; w.input('p1', { pick: 1 }); w.update(C.TICK);
  const ev = w.events.find(e => e.t === 'evolve');
  ok(ws.id === F && ws.evo && ws.lvl === 5 && ev && ev.from === 'cleave' && ev.wid === F && !p.offer && !w.paused, 'picking the Form swaps the weapon id, emits evolve, lvl 5, unpauses');
  ok(w.formsReady(p, ws).length === 0, 'one Form per slot: the hero weapon has no other Form ready');
  w.rankPath(p, ws, 1); w.rankPath(p, ws, 1); w.rankPath(p, ws, 1);
  ok(ws.pr[1] === 3 && !w.formsReady(p, ws).length && w.openChest(p, 2)[0].kind === 'offer', 'another path at rank 3 after a Form: still none; a boss chest gives an extra level-up');
  p.pend = 0; p.offer = null; w.paused = false;
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
// ---- slots and supports
{
  const w = world(), p = w.heroes[0];
  ok(ED.MAX_WEAPONS === 3 && p.weapons.length === 1 && p.weapons[0].root === 'cleave', 'MAX_WEAPONS 3; a run starts with the hero weapon in slot 0');
  ok(!w.addWeapon(p, 'longbow') && !w.addWeapon(p, 'cleave') && !w.addWeapon(p, 'whirlwind'), 'refused: a second hero weapon, the same root, a Form of the held root');
  const sc = w.cardPool(p).find(x => x.c.kind === 'support' && x.c.id === 'tsa').c;
  ok(sc.name === 'Test tsa' && sc.txt === 'Test support' && sc.icon === ED.WEAPONS.tsa.icon && w.cardKey(sc) === 'w:tsa', 'new support card: name, icon, txt, key w:<root>');
  p.offer = [sc]; w.pickCard(p, 0);
  const s1 = p.weapons[1];
  ok(s1 && s1.root === 'tsa' && !w.cardPool(p).some(x => x.c.kind === 'support' && x.c.id === 'tsa') && !w.addWeapon(p, 'tsa') && !w.addWeapon(p, 'tsaf'), 'picking it fills slot 1; that support leaves the pool, a second copy or its Form is refused');
  const sp = w.cardPool(p).filter(x => x.c.kind === 'path' && x.c.id === 'tsa');
  ok(sp.length === 3 && sp.every(x => x.w === 4 && x.c.name === 'P' + x.c.path && x.c.icon === ED.WEAPONS.tsa.icon), 'support path cards: 3 paths, weight 4');
  const S0 = w.weaponS(p, 1).dmg; p.offer = [sp[1].c]; w.pickCard(p, 0);
  ok(s1.pr[1] === 1 && w.weaponS(p, 1).dmg > S0, 'a support path rank applies to slot 1 (' + S0.toFixed(1) + ' -> ' + w.weaponS(p, 1).dmg.toFixed(1) + ')');
  p.passives.push({ id: 'might', lvl: 5 }); w.recalc(p, false);
  ok(w.weaponS(p, 1).dmg > S0 * 1.1 + 1 && ED.Stats.weapon(p, 1) === s1.S, 'supports scale with passives (might): ' + w.weaponS(p, 1).dmg.toFixed(1));
  let guar = 99; for (let i = 0; i < 100; i++) guar = Math.min(guar, w.makeOffer(p).filter(isWpn).length);
  ok(guar >= 2, 'support path cards count for the weapon guarantee');
  const F = ED.weaponForms('tsa');
  ok(F.length === 1 && F[0].id === 'tsaf' && F[0].any.join() === '0,1,2', 'support Forms dedupe: one Form named by all 3 paths');
  w.rankPath(p, s1, 1); w.rankPath(p, s1, 1);
  ok(w.formsReady(p, s1).map(f => f.id).join() === 'tsaf' && !w.formsReady(p, p.weapons[0]).length, 'any support path at rank 3 readies its Form');
  ok(w.addWeapon(p, 'tsb') && p.weapons.length === 3 && !w.cardPool(p).some(x => x.c.kind === 'support') && !w.addWeapon(p, ED.WEAPON_IDS.find(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved && !p.weapons.some(s => s.root === id)) || 'tsa'),
    'slot 2 filled: no new support cards, no 4th weapon');
  // Form offer: hero weapon + support ready; the pick evolves only its slot
  w.setRanks(p, p.weapons[0], 3, false); w.events.length = 0;
  ok(w.openChest(p, 2)[0].kind === 'form', 'boss chest: Form offer');
  w.updateProgress();
  ok(p.offer && p.offer.length === 2 && p.offer.map(c => c.id).join() === ED.WEAPONS.cleave.paths[0].form + ',tsaf', 'Form offer lists the ready Forms of every slot in slot order: ' + p.offer.map(c => c.id).join());
  w.input('p1', { pick: 2 }); w.update(C.TICK);
  ok(s1.id === 'tsaf' && s1.evo && !p.weapons[0].evo && !w.formsReady(p, s1).length && w.formsReady(p, p.weapons[0]).length === 1, 'picking the support Form evolves slot 1 only; the hero Form stays ready');
  const rc = w.cardPool(p).find(x => x.c.kind === 'refine' && x.c.id === 'tsaf');
  ok(rc && rc.w === 3, 'a support Form offers refine cards (weight 3)');
  // banish a new-support card
  const w2 = world('knight', { banish: 1 }), q = w2.heroes[0];
  const cs = w2.cardPool(q).find(x => x.c.kind === 'support').c;
  q.offer = [cs, w2.goldCard(q)]; ok(w2.banishCard(q, 0) && q.banned.indexOf('w:' + cs.id) >= 0, 'a new-support card can be banished (key w:' + cs.id + ')');
  let leak = 0; for (let i = 0; i < 300; i++) if (w2.makeOffer(q).some(c => c.kind === 'support' && c.id === cs.id)) leak++;
  ok(leak === 0 && w2.cardPool(q).some(x => x.c.kind === 'support'), 'the banished support never returns; other supports stay');
  // more than 4 ready Forms: 4 cards, deterministic per seed
  const four = (seed) => { const u = world('knight', {}, 1, seed), h = u.heroes[0]; u.setRanks(h, h.weapons[0], 9, false); u.addWeapon(h, 'tsa'); u.addWeapon(h, 'tsb'); u.setRanks(h, h.weapons[1], 3, false); u.setRanks(h, h.weapons[2], 3, false); return [u.formsReadyAll(h).length, u.makeFormOffer(h).map(c => c.id).join()]; };
  const fa = four(9), fb = four(9);
  ok(fa[0] > 4 && fa[1].split(',').length === 4 && fa[1] === fb[1] && new Set(fa[1].split(',')).size === 4, `${fa[0]} ready Forms: a Form offer of 4 distinct cards, same per seed (${fa[1]})`);
}
// ---- chest Form gate: fallback, two chests one slot, queueing behind a level-up, benchmark elites, co-op
{
  const w = world(), p = w.heroes[0];
  let r = w.openChest(p, 2);
  ok(r[0].kind === 'offer' && p.pend === 1 && !p.pendForm, 'boss chest without a ready Form: an extra level-up');
  p.pend = 0;
  w.setRanks(p, p.weapons[0], 3, false);
  const a = w.openChest(p, 2)[0], b = w.openChest(p, 2)[0];
  ok(a.kind === 'form' && b.kind === 'offer' && p.pendForm === 1 && p.pend === 1, 'one ready slot, two boss chests: one Form offer, then an extra level-up');
  p.pend = 0; p.pendForm = 0;
  w.addXp(ED.World.xpFor(1)); w.updateProgress();
  const lvl = p.offer;
  ok(lvl && !w.isFormOffer(lvl) && w.openChest(p, 2)[0].kind === 'form' && p.offer === lvl && p.pendForm === 1, 'a Form offer queues behind an open level-up offer');
  w.input('p1', { pick: 1 }); w.update(C.TICK);
  ok(w.isFormOffer(p.offer) && w.paused, 'after the pick the queued Form offer opens (solo pauses)');
  p.offer = null; p.pendForm = 0; w.paused = false;
  // a queued Form offer whose Form is gone by then turns into a level-up
  p.pendForm = 1; w.takeForm(p, p.weapons[0], w.formsReady(p, p.weapons[0])[0].id); w.updateProgress();
  ok(!p.offer && p.pend === 1 && !p.pendForm, 'a queued Form offer with nothing ready left becomes an extra level-up');
  p.pend = 0;
  // benchmark elites
  const e = world(), h = e.heroes[0]; h.passives.push({ id: 'might', lvl: 1 }); e.recalc(h, false);
  e.setRanks(h, h.weapons[0], 3, false);
  const r0 = e.openChest(h, 1)[0];
  e.sp.bench = true;
  const r1 = e.openChest(h, 1)[0];
  e.takeForm(h, h.weapons[0], e.formsReady(h, h.weapons[0])[0].id); h.pendForm = 0;
  const r2 = e.openChest(h, 1)[0];
  ok(r0.kind !== 'form' && r1.kind === 'form' && h.pendForm === 0 && r2.kind !== 'form', `elite chest: a Form offer only from the benchmark and only with a Form ready (${r0.kind}, ${r1.kind}, ${r2.kind})`);
  // co-op: each hero gets its own chest result
  const c = world('knight', {}, 2), [k, rg] = c.heroes;
  c.setRanks(k, k.weapons[0], 3, false); c.events.length = 0;
  c.openChest(rg, 2);
  const evs = c.events.filter(x => x.t === 'chest');
  ok(evs.length === 2 && evs.find(x => x.pid === 'p1').results[0].kind === 'form' && evs.find(x => x.pid === 'p2').results[0].kind === 'offer' && k.pendForm === 1 && rg.pend === 1,
    'co-op boss chest: the hero with a ready Form gets a Form offer, the other an extra level-up');
}
// ---- fallback, gold card, determinism
{
  const w = world('knight', { greed: 2 }), p = w.heroes[0];
  w.setRanks(p, p.weapons[0], 9, true);
  for (const id of ['tsa', 'tsb']) w.setRanks(p, w.addWeapon(p, id), 9, true);
  for (const id of ED.PASSIVE_IDS.slice(0, 6)) p.passives.push({ id, lvl: 5 });
  for (const sk of p.skills) sk.lvl = ED.skillMaxLvl(ED.SKILLS[sk.id]);
  w.recalc(p, true);
  const o = w.makeOffer(p);
  ok(p.weapons.length === 3 && p.weapons.every(ws => ws.evo && ws.fl === 2) && o.length === 2 && o[0].kind === 'gold' && o[1].kind === 'heal', 'everything maxed: Gold + Meal');
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
  w.setRanks(p, ws, 2, false);
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
  ok(r.length === 1 && r[0].kind === 'offer' && p.pend === pend0 + 1 && r[0].txt, 'boss chest, no Form ready: one extra level-up offer (' + r[0].txt + ')');
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
  const Q = ED.HEROES.knight.skills[0], rows = ED.dmgRows({ dealt: { cleave: 100, whirlwind: 300, [Q]: 50, bomb: 25, other: 5 }, weapons: ['whirlwind'] });
  ok(rows[0].id === 'whirlwind' && rows[0].dmg === 400 && !rows.some(r => r.id === 'cleave'), 'pre-evolution damage folds into the evolved weapon');
  ok(rows.find(r => r.id === Q).kind === 'skill' && rows.find(r => r.id === 'bomb').name === 'Holy Bomb' && Math.abs(rows.reduce((s, r) => s + r.frac, 0) - 1) < 1e-9, 'skills, bomb and other rows; fractions sum to 1');
}

console.log(`check-progress: ${fails ? fails + ' failure(s)' : 'all passed'}`);
process.exitCode = fails ? 1 : 0;
