// Headless progression check (exit 1 on failure). Usage: node tools/check-progress.js
// Offers (count, luck 4th card, weapon-card guarantee at levels 2-3 only, card kinds tune / path / support / refine / passive / skill, per-item weight split, dilution, no chest cards in level-ups,
// gold / heal fallback, no empty offers, determinism), reroll / skip / banish, the slot lifecycle (tune 5 -> elite chest path pick -> path ranks 2-5 by cards -> boss chest Form fork -> refine;
// other paths never offered or applied), cache keys, Forms per path (re-homed hybrids reachable from exactly one path), slots (MAX_WEAPONS 3: hero weapon + 2 supports, addWeapon refusals),
// support cards, chest offers (one per chest for the first waiting slot, queueing, picks only, benchmark elites, co-op), elite rolls, gems (merge cap, value kept, magnet vacuum),
// gold with greed, party XP in co-op, holy bomb, damage table. Test supports 'tsa' / 'tsb' (Forms 'tsaf' / 'tsbf') are registered in this check's own ED only.
'use strict';
const { load } = require('./sim.js');
const ED = load(), C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const world = (cls, shop, n, seed) => new ED.World({ seed: seed || 5, stage: 0, players: Array.from({ length: n || 1 }, (_, i) => ({ pid: 'p' + (i + 1), slot: i, cls: i ? 'ranger' : cls || 'knight', meta: { shop: shop || {}, sigs: [] } })) });
const keys = (o) => o.map(c => ED.World.prototype.cardKey(c));
const tick = (w, s) => { for (let i = 0; i < Math.round(s * 60); i++) w.update(C.TICK); w.events.length = 0; };
const KINDS = ['tune', 'path', 'pathpick', 'support', 'form', 'refine', 'passive', 'plvl', 'skill', 'gold', 'heal'];
// Forms registered before the hybrid re-homing (hero weapons: 3 path Forms + 2 hybrids each).
const OLD_FORMS = ['colossus', 'whirlwind', 'gale', 'earthsplitter', 'tempest', 'hail', 'ballista', 'seeker', 'galeshot', 'rebound', 'inferno', 'firestorm', 'wildfire', 'pyre', 'napalm',
  'bonelord', 'bonestorm', 'plaguefield', 'lich', 'ossuary', 'wrath', 'halo', 'jray', 'consecration', 'verdict', 'thousand', 'assassinate', 'shadowfan', 'lotus', 'reaper',
  'cathedral', 'glaciertoll', 'carillon', 'undertow', 'windchime'];
// test supports: 3 paths listing one Form, no-op impl
const NOP = { fire: () => true };
for (const id of ['tsa', 'tsb']) {
  ED.addWeapon({ id, name: 'Test ' + id, icon: 'icon.w.cleave', support: true, role: 'horde', mode: 'around', txt: 'Test support', base: { dmg: 10, cd: 1 },
    paths: [0, 1, 2].map(i => ({ id: id + i, name: 'P' + i, forms: [id + 'f'], ranks: [0, 1, 2].map(r => ({ mods: { dmg: 0.1 }, txt: 'Rank ' + (r + 1) })) })) }, NOP);
  ED.addWeapon({ id: id + 'f', name: 'Test ' + id + ' Form', icon: 'icon.w.cleave', support: true, evolved: true, form: true, from: id, txt: 'Test Form', base: { dmg: 20, cd: 1 },
    refine: [{ mods: { dmg: 0.2 }, txt: 'Refine 1' }, { mods: { dmg: 0.2 }, txt: 'Refine 2' }] }, NOP);
}
const isWpn = (c) => c.kind === 'tune' || c.kind === 'path' || c.kind === 'support' || c.kind === 'refine';
const sum = (pool, f) => pool.filter(x => f(x.c)).reduce((s, x) => s + x.w, 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;
// Opens the next queued offer of p and picks card i (1-based) through inputs.
const pickVia = (w, i) => { w.input('p1', { pick: i }); w.update(C.TICK); w.events.length = 0; };

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
    for (const pa of d.paths) { if ((pa.name + ' IV: ' + ED.PATH_STEP.txt).length > 40) all = false; for (const r of pa.ranks) if (!r.txt || r.txt.length > 40) all = false; }
    for (const f of ED.weaponForms(d.id)) { const fd = ED.WEAPONS[f.id]; if (!fd.txt || fd.txt.length > 40) all = false; for (const r of fd.refine) if (!r.txt || r.txt.length > 40) all = false; }
  }
  ok(all && ED.TUNE.every(t => t.txt.length <= 40), 'every passive, tune, path rank (generic steps included), support, Form and refine line <= 40 chars (' + roots.length + ' root weapons)');
  p.stats.luck = 1; for (let i = 0; i < 20; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four === 20, 'luck 1 always gives a 4th card');
  p.stats.luck = 0.5; four = 0; for (let i = 0; i < 400; i++) if (w.makeOffer(p).length === 4) four++;
  ok(four > 150 && four < 250, 'luck 0.5 gives a 4th card about half the time (' + four + '/400)');
  p.stats.luck = 0;
  const seen = new Set();
  for (let i = 0; i < 300; i++) for (const c of w.makeOffer(p)) { seen.add(c.kind); if (c.kind === 'tune' && c.id !== 'cleave') seen.add('bad'); if (c.kind === 'support' && !ED.WEAPONS[c.id].support) seen.add('bad'); }
  ok(seen.has('tune') && seen.has('support') && seen.has('passive') && seen.has('skill') && !seen.has('path') && !seen.has('pathpick') && !seen.has('form') && !seen.has('refine') && !seen.has('bad'),
    'start pool: own weapon tune, new supports, passives, skill; no path, path pick, Form or refine (' + [...seen].join(',') + ')');
  // per-item weights: each group's total split over its cards
  const pool = w.cardPool(p), sup = ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved);
  const tune = pool.filter(x => x.c.kind === 'tune'), sp = pool.filter(x => x.c.kind === 'support'), ps = pool.filter(x => x.c.kind === 'passive');
  ok(tune.length === 3 && tune.every(x => near(x.w, 1)) && sp.length === sup.length && near(sum(pool, c => c.kind === 'support'), 3) && ps.length === ED.PASSIVE_IDS.length && near(sum(pool, c => c.kind === 'passive'), 4)
    && near(sum(pool, c => c.kind === 'skill'), 1.5), `weights: slot 3 over 3 tune kinds, new support 3 over ${sup.length}, new passive 4 over ${ps.length}, skill 1.5`);
  // dilution: a 1-slot hero with 6 free passive slots sees a new passive in >= 40% of offers (past the guarantee levels)
  w.level = 10; let pc = 0;
  for (let i = 0; i < 600; i++) if (w.makeOffer(p).some(c => c.kind === 'passive')) pc++;
  ok(pc / 600 >= 0.4, `dilution: a new passive in ${(pc / 6).toFixed(0)}% of offers (1 slot, 6 free passive slots)`);
  // weapon guarantee: >= 1 weapon card in the offers of levels 2 and 3 only
  const wpn = (o) => o.filter(isWpn).length, slot = new Set();
  let g2 = 99, g3 = 99, none4 = 0;
  w.level = 2; for (let i = 0; i < 200; i++) { const o = w.makeOffer(p); g2 = Math.min(g2, wpn(o)); o.forEach((c, j) => { if (!isWpn(c)) slot.add(j); }); }
  w.level = 3; for (let i = 0; i < 200; i++) g3 = Math.min(g3, wpn(w.makeOffer(p)));
  w.level = 4; for (let i = 0; i < 300; i++) if (!wpn(w.makeOffer(p))) none4++;
  w.level = 3; p.pend = 1; let q2 = 99; for (let i = 0; i < 100; i++) q2 = Math.min(q2, wpn(w.makeOffer(p))); p.pend = 0; // queued offer: level 3 - 1 pending = the level-2 offer
  w.level = 1;
  ok(g2 >= 1 && g3 >= 1 && q2 >= 1 && none4 > 0 && slot.has(0), `weapon guarantee: min ${g2} / ${g3} weapon cards at levels 2 / 3 (queued ${q2}); ${none4}/300 offers at level 4 without one; non-weapon cards reach slot 1`);
  // full passive slots: no new passives, levels weighted up
  for (const id of ED.PASSIVE_IDS.slice(0, 6)) p.passives.push({ id, lvl: 1 });
  w.recalc(p, true);
  let bad = 0;
  for (let i = 0; i < 200; i++) for (const c of w.makeOffer(p)) if (c.kind === 'passive') bad++;
  ok(bad === 0 && w.cardPool(p).filter(x => x.c.kind === 'plvl').every(x => x.w === 3), 'full passive slots: no new passives, passive level weight 3');
  p.passives.length = 2; w.recalc(p, true);
  ok(w.cardPool(p).filter(x => x.c.kind === 'plvl').every(x => x.w === 2), 'free passive slots: passive level weight 2');
}
// ---- slot lifecycle: tune 5 -> elite chest path pick -> path ranks 2-5 -> boss chest Form fork -> refine
{
  const w = world(), p = w.heroes[0], ws = p.weapons[0], d = ED.WEAPONS.cleave;
  ok(ws.tune === 0 && ws.tk.join('') === '000' && ws.path === -1 && ws.pr.join('') === '000' && ws.lvl === 1 && !w.pathReady(p, ws), 'a fresh slot: tune 0, no path, lvl 1');
  const tc = (k) => w.cardPool(p).find(x => x.c.kind === 'tune' && x.c.tk === k);
  let c = tc(0).c;
  ok(c.id === 'cleave' && c.lvl === 1 && c.path === -1 && c.name === d.name && c.txt === ED.TUNE[0].txt && c.icon === d.icon && w.cardKey(c) === 't:cleave:0', 'tune card: root id, tk, step count, weapon name, tune line, key t:<root>:<k>');
  const S0 = Object.assign({}, w.weaponS(p, 0));
  p.offer = [c]; w.pickCard(p, 0);
  ok(ws.tune === 1 && ws.tk.join('') === '100' && ws.lvl === 2 && near(w.weaponS(p, 0).dmg, S0.dmg * 1.15), `damage tune: +15% damage (${S0.dmg.toFixed(2)} -> ${w.weaponS(p, 0).dmg.toFixed(2)}), lvl 2`);
  w.tuneSlot(p, ws, 0); w.tuneSlot(p, ws, 0);
  ok(ws.tk[0] === 3 && !w.tuneSlot(p, ws, 0) && !tc(0) && tc(1) && tc(2) && near(tc(1).w, 1.5), 'a tune kind caps at 3 and leaves the pool; the slot weight 3 splits over the 2 left');
  w.tuneSlot(p, ws, 1);
  const S4 = Object.assign({}, w.weaponS(p, 0)); w.tuneSlot(p, ws, 2);
  ok(near(w.weaponS(p, 0).area, S4.area * 1.12) && near(w.weaponS(p, 0).cd, S0.cd * 0.91), `area tune +12% area, haste tune cooldown x0.91 (cd ${S0.cd.toFixed(3)} -> ${w.weaponS(p, 0).cd.toFixed(3)})`);
  ok(ws.tune === 5 && !w.tuneSlot(p, ws, 1) && w.pathReady(p, ws) && !w.cardPool(p).some(x => x.c.id === 'cleave'), 'tune caps at 5: the slot is path-ready and offers no level-up cards');
  let leak = 0, short = 0;
  for (let i = 0; i < 300; i++) { const o = w.makeOffer(p); if (o.some(x => x.id === 'cleave')) leak++; if (o.length < 3) short++; }
  ok(!leak && !short, `path-ready: no cleave card in 300 offers, none short (${leak}, ${short})`);
  ok(!w.rankPath(p, ws, 0) && !w.formsReady(p, ws).length, 'no path rank or Form before the path pick');
  // elite chest: path pick
  w.events.length = 0;
  const r1 = w.openChest(p, 1), ev1 = w.events.find(e => e.t === 'chest');
  ok(r1.length === 1 && r1[0].kind === 'pathpick' && r1[0].txt === 'Choose a path' && p.pendPath === 1 && ev1 && ev1.results === r1, 'elite chest with a path-ready slot: queues a path-pick offer, the chest event says so');
  ok(w.openChest(p, 1)[0].kind !== 'pathpick' && p.pendPath === 1, 'a second elite chest does not queue the same slot twice');
  w.updateProgress();
  const po = p.offer;
  ok(po && w.isChestOffer(po) && !w.isFormOffer(po) && po.length === 3 && po.every((x, i) => x.kind === 'pathpick' && x.id === 'cleave' && x.path === i && x.lvl === 1 && x.name === d.paths[i].name && x.txt === d.paths[i].ranks[0].txt && w.cardKey(x) === 'k:cleave:' + i)
    && p.pendPath === 0 && w.paused, 'the path-pick offer opens: one card per path (path name, rank-1 line), solo pauses');
  p.rerolls = p.skips = p.banishes = 1;
  w.input('p1', { reroll: true }); w.update(C.TICK); w.input('p1', { banish: 1 }); w.update(C.TICK); w.input('p1', { skip: true }); w.update(C.TICK);
  ok(p.offer === po && p.rerolls === 1 && p.skips === 1 && p.banishes === 1, 'a path-pick offer cannot be rerolled, banished or skipped');
  w.events.length = 0; w.input('p1', { pick: 3 }); w.update(C.TICK);
  const pk = w.events.find(e => e.t === 'pick');
  ok(ws.path === 2 && ws.pr.join('') === '001' && ws.lvl === 7 && !w.pathReady(p, ws) && !p.offer && !w.paused && pk && pk.kind === 'pathpick' && pk.path === 2, 'picking Edge Wave: path 2 at rank 1, lvl 7, unpauses');
  ok(w.weaponS(p, 0).wave === 1 && !w.pickPath(p, ws, 0) && !w.rankPath(p, ws, 0) && !w.rankPath(p, ws, 1), 'the pick applies its rank-1 shape; the path is permanent, other paths never rank');
  // path ranks 2-5 by level-up cards, only the picked path
  const other = new Set(); for (let i = 0; i < 300; i++) for (const x of w.makeOffer(p)) if (x.id === 'cleave' && (x.kind !== 'path' || x.path !== 2)) other.add(x.kind + x.path);
  ok(!other.size, 'after the pick every cleave card is the picked path (' + [...other].join(',') + ')');
  const steps = [];
  for (let r = 2; r <= ED.PATH_MAX; r++) {
    const it = w.cardPool(p).filter(x => x.c.id === 'cleave'), a = Object.assign({}, w.weaponS(p, 0));
    if (it.length !== 1 || it[0].c.kind !== 'path' || it[0].c.lvl !== r || it[0].w !== 3) { steps.push('bad card at ' + r); break; }
    const pc = it[0].c; p.offer = [pc]; w.pickCard(p, 0);
    const b = w.weaponS(p, 0), shape = r & 1;
    steps.push(r + ':' + pc.txt);
    if (shape ? pc.txt !== d.paths[2].ranks[r >> 1].txt : pc.txt !== 'Edge Wave ' + ['', '', 'II', '', 'IV'][r] + ': ' + ED.PATH_STEP.txt || !near(b.dmg, a.dmg * (1 + 0.1 * (r >> 1)) / (1 + 0.1 * ((r - 1) >> 1))) || !near(b.cd, a.cd * 0.95)) steps.push('bad step ' + r);
  }
  ok(ws.pr[2] === 5 && ws.lvl === 11 && !steps.some(s => s.startsWith('bad')), 'path ranks 2-5 by cards: 3 / 5 shape lines, 2 / 4 +10% damage and cooldown x0.95 (' + steps.join(' | ') + ')');
  ok(!w.rankPath(p, ws, 2) && !w.cardPool(p).some(x => x.c.id === 'cleave' || x.c.kind === 'form'), 'path caps at 5: Form-ready, no level-up card for the slot');
  ok(w.formsReady(p, ws).map(f => f.id).join() === d.paths[2].forms.join() && d.paths[2].forms.length === 2, 'Form-ready: the picked path\'s 2 Forms (' + d.paths[2].forms.join(', ') + ')');
  const re = w.openChest(p, 1)[0];
  ok(re.kind !== 'form' && re.kind !== 'pathpick' && !p.pendForm, 'elite chest outside the benchmark: no Form offer (' + re.kind + ')');
  const rb = w.openChest(p, 2);
  ok(rb.length === 1 && rb[0].kind === 'form' && rb[0].txt === 'Choose a Form' && p.pendForm === 1, 'boss chest with a Form-ready slot: queues a Form offer');
  w.updateProgress();
  const fo = p.offer;
  ok(fo && w.isFormOffer(fo) && w.isChestOffer(fo) && fo.map(x => x.id).join() === d.paths[2].forms.join() && fo.every(x => x.kind === 'form' && x.path === 2 && w.cardKey(x) === 'f:' + x.id) && w.paused,
    'the Form offer opens: one card per Form of the picked path, solo pauses');
  p.rerolls = p.skips = p.banishes = 1;
  w.input('p1', { reroll: true }); w.update(C.TICK); w.input('p1', { banish: 1 }); w.update(C.TICK); w.input('p1', { skip: true }); w.update(C.TICK);
  ok(p.offer === fo && p.rerolls === 1 && p.skips === 1 && p.banishes === 1, 'a Form offer cannot be rerolled, banished or skipped');
  w.events.length = 0; w.input('p1', { pick: 2 }); w.update(C.TICK);
  const ev = w.events.find(e => e.t === 'evolve'), F = fo[1].id, FD = ED.WEAPONS[F];
  ok(ws.id === F && ws.evo && ws.lvl === 12 && ev && ev.from === 'cleave' && ev.wid === F && !p.offer && !w.paused, `picking ${F}: the weapon id swaps, emits evolve, lvl 12, unpauses`);
  ok(!w.formsReady(p, ws).length && !w.takeForm(p, ws, fo[0].id) && w.openChest(p, 2)[0].kind === 'offer', 'one Form per slot: none ready after it, a second take refused, a boss chest gives an extra level-up');
  p.pend = 0;
  const S1 = w.weaponS(p, 0);
  ok(S1.ret === true && S1.wave >= (FD.base.wave || 0) + 3 && !S1.back && !S1.slam, `the picked path's shape ranks keep applying to the Form, no other path's (wave ${S1.wave}, ret ${S1.ret})`);
  const rc = w.cardPool(p).find(x => x.c.kind === 'refine');
  ok(rc && rc.w === 3 && rc.c.id === F && rc.c.lvl === 1 && w.cardKey(rc.c) === 'x:' + F && w.cardPool(p).filter(x => x.c.id === F || x.c.id === 'cleave').length === 1, 'refine card offered (the slot\'s only card, weight 3, key x:<form>)');
  const RK = Object.keys(FD.refine[0].mods).find(k => typeof FD.refine[0].mods[k] === 'number'), n0 = w.weaponS(p, 0)[RK];
  p.offer = [rc.c]; w.pickCard(p, 0);
  ok(ws.fl === 1 && w.weaponS(p, 0)[RK] > n0, 'refine 1 applies its mods (' + RK + ' ' + n0 + ' -> ' + w.weaponS(p, 0)[RK] + ')');
  w.refineForm(p, ws);
  ok(ws.fl === 2 && ws.lvl === 14 && !w.refineForm(p, ws) && !w.cardPool(p).some(x => x.c.id === F), 'refine caps at 2 (lvl 14 = 1 + tune 5 + path 5 + Form + refine 2) and leaves the pool');
  // cache key: no collisions over every tune split, path, rank, refine
  const ks = new Set(); let n = 0;
  for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) for (let e = 0; e <= 3 && a + b + e <= 5; e++) for (let pa = -1; pa < 3; pa++) for (let r = 0; r <= 5; r++) for (let fl = 0; fl <= 2; fl++) {
    if ((pa < 0) !== (r === 0)) continue;
    const pr = [0, 0, 0]; if (pa >= 0) pr[pa] = r;
    ks.add(ED.weaponKey({ tk: [a, b, e], tune: a + b + e, path: pa, pr, fl })); n++;
  }
  ok(ks.size === n, `weapon cache key: ${ks.size} distinct keys for ${n} slot states`);
}
// ---- Forms per path: every Form registered before the re-homing is reachable from exactly one path of its root
{
  const bad = [];
  for (const id of OLD_FORMS) {
    const d = ED.WEAPONS[id], f = d && ED.weaponForms(d.from).find(x => x.id === id);
    if (!d || !d.form || !f || f.any.length !== 1) bad.push(id);
  }
  const per = ED.HERO_IDS.map(cls => { const r = ED.WEAPONS[ED.HEROES[cls].sig]; return r.paths.every(pa => pa.forms.length >= 1 && pa.forms.length <= 2) && ED.weaponForms(r.id).length === 5; });
  const heroForms = ED.HERO_IDS.reduce((s, cls) => s + ED.weaponForms(ED.HEROES[cls].sig).length, 0);
  ok(!bad.length && per.every(Boolean) && heroForms === OLD_FORMS.length, `${OLD_FORMS.length} hero Forms each on exactly one path, 1-2 per path, 5 per hero` + (bad.length ? ': ' + bad.join(',') : ''));
  const sups = ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved && !/^ts/.test(id));
  ok(sups.every(id => { const F = ED.weaponForms(id); return F.length === 1 && F[0].any.join() === '0,1,2'; }), `supports: every path lists the support's one Form (${sups.length} supports)`);
  ok(ED.HERO_IDS.every(cls => !ED.WEAPONS[ED.HEROES[cls].sig].hybrids), 'no hybrid recipes left');
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
  ok(s1 && s1.root === 'tsa' && s1.tune === 0 && s1.path === -1 && !w.cardPool(p).some(x => x.c.kind === 'support' && x.c.id === 'tsa') && !w.addWeapon(p, 'tsa') && !w.addWeapon(p, 'tsaf'),
    'picking it fills slot 1 (tune 0, no path); that support leaves the pool, a second copy or its Form is refused');
  const st = w.cardPool(p).filter(x => x.c.id === 'tsa');
  ok(st.length === 3 && st.every(x => x.c.kind === 'tune' && near(x.w, 1) && x.c.name === 'Test tsa' && x.c.icon === ED.WEAPONS.tsa.icon), 'support tune cards: 3 kinds, slot weight 3');
  const S0 = w.weaponS(p, 1).dmg; p.offer = [st[0].c]; w.pickCard(p, 0);
  ok(s1.tk[0] === 1 && w.weaponS(p, 1).dmg > S0, 'a support tune step applies to slot 1 (' + S0.toFixed(1) + ' -> ' + w.weaponS(p, 1).dmg.toFixed(1) + ')');
  p.passives.push({ id: 'might', lvl: 5 }); w.recalc(p, false);
  ok(w.weaponS(p, 1).dmg > S0 * 1.1 + 1 && ED.Stats.weapon(p, 1) === s1.S, 'supports scale with passives (might): ' + w.weaponS(p, 1).dmg.toFixed(1));
  ok(w.addWeapon(p, 'tsb') && p.weapons.length === 3 && !w.cardPool(p).some(x => x.c.kind === 'support') && !w.addWeapon(p, ED.WEAPON_IDS.find(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved && !p.weapons.some(s => s.root === id)) || 'tsa'),
    'slot 2 filled: no new support cards, no 4th weapon');
  // two path-ready slots: one path-pick offer per chest, the first ready slot in slot order first
  w.setRanks(p, s1, ED.TUNE_MAX); w.setRanks(p, p.weapons[0], ED.TUNE_MAX);
  const a = w.openChest(p, 1)[0], b = w.openChest(p, 2)[0], c = w.openChest(p, 1)[0];
  ok(a.kind === 'pathpick' && b.kind === 'pathpick' && c.kind !== 'pathpick' && p.pendPath === 2, `two path-ready slots: two chests queue two path picks, a third does not (${a.kind}, ${b.kind}, ${c.kind})`);
  w.updateProgress();
  ok(p.offer && p.offer.every(x => x.kind === 'pathpick' && x.id === 'cleave'), 'the first path-pick offer is the hero weapon\'s (slot 0)');
  pickVia(w, 2); w.updateProgress();
  ok(p.weapons[0].path === 1 && p.offer && p.offer.every(x => x.kind === 'pathpick' && x.id === 'tsa') && p.offer.map(x => x.name).join() === 'P0,P1,P2', 'after that pick the support\'s path-pick offer opens');
  pickVia(w, 1);
  ok(s1.path === 0 && s1.pr.join('') === '100' && !p.offer && !p.pendPath, 'support path picked: path 0 at rank 1');
  // support Form: 1 per path; Form offers per slot in slot order
  w.setRanks(p, s1, ED.TUNE_MAX, 0, ED.PATH_MAX); w.setRanks(p, p.weapons[0], ED.TUNE_MAX, 1, ED.PATH_MAX);
  ok(w.formsReady(p, s1).map(f => f.id).join() === 'tsaf' && w.formsReady(p, p.weapons[0]).map(f => f.id).join() === ED.WEAPONS.cleave.paths[1].forms.join(), 'support at rank 5: its one Form ready; the hero weapon its path\'s Forms');
  ok(w.openChest(p, 2)[0].kind === 'form' && w.openChest(p, 2)[0].kind === 'form' && w.openChest(p, 2)[0].kind === 'offer' && p.pendForm === 2, 'two Form-ready slots: two boss chests queue two Form offers, a third gives a level-up');
  p.pend = 0; w.updateProgress();
  ok(p.offer && p.offer.map(x => x.id).join() === ED.WEAPONS.cleave.paths[1].forms.join(), 'the first Form offer is the hero weapon\'s path Forms: ' + (p.offer || []).map(x => x.id).join());
  pickVia(w, 1); w.updateProgress();
  ok(p.weapons[0].evo && p.offer && p.offer.length === 1 && p.offer[0].id === 'tsaf', 'then the support\'s Form offer: one card');
  pickVia(w, 1);
  ok(s1.id === 'tsaf' && s1.evo && !p.offer && !p.pendForm, 'the support evolves');
  const rc = w.cardPool(p).find(x => x.c.kind === 'refine' && x.c.id === 'tsaf');
  ok(rc && rc.w === 3, 'a support Form offers refine cards (weight 3)');
  // banish a new-support card
  const w2 = world('knight', { banish: 1 }), q = w2.heroes[0];
  const cs = w2.cardPool(q).find(x => x.c.kind === 'support').c;
  q.offer = [cs, w2.goldCard(q)]; ok(w2.banishCard(q, 0) && q.banned.indexOf('w:' + cs.id) >= 0, 'a new-support card can be banished (key w:' + cs.id + ')');
  let leak = 0; for (let i = 0; i < 300; i++) if (w2.makeOffer(q).some(x => x.kind === 'support' && x.id === cs.id)) leak++;
  const sw = w2.cardPool(q).filter(x => x.c.kind === 'support');
  ok(leak === 0 && sw.length && near(sw.reduce((s, x) => s + x.w, 0), 3), 'the banished support never returns; the support weight 3 splits over the others');
}
// ---- chest offers: fallback, queueing behind a level-up, a vanished slot, benchmark elites, boss path picks, co-op
{
  const w = world(), p = w.heroes[0];
  let r = w.openChest(p, 2);
  ok(r[0].kind === 'offer' && p.pend === 1 && !p.pendForm && !p.pendPath, 'boss chest with nothing waiting: an extra level-up');
  p.pend = 0;
  w.setRanks(p, p.weapons[0], ED.TUNE_MAX);
  r = w.openChest(p, 2);
  ok(r[0].kind === 'pathpick' && p.pendPath === 1, 'boss chest with a path-ready slot and no Form ready: a path-pick offer');
  p.pendPath = 0;
  w.setRanks(p, p.weapons[0], ED.TUNE_MAX, 0, ED.PATH_MAX);
  const a = w.openChest(p, 2)[0], b = w.openChest(p, 2)[0];
  ok(a.kind === 'form' && b.kind === 'offer' && p.pendForm === 1 && p.pend === 1, 'one Form-ready slot, two boss chests: one Form offer, then an extra level-up');
  p.pend = 0; p.pendForm = 0;
  w.addXp(ED.World.xpFor(1)); w.updateProgress();
  const lvl = p.offer;
  ok(lvl && !w.isChestOffer(lvl) && w.openChest(p, 2)[0].kind === 'form' && p.offer === lvl && p.pendForm === 1, 'a Form offer queues behind an open level-up offer');
  w.input('p1', { pick: 1 }); w.update(C.TICK);
  ok(w.isFormOffer(p.offer) && w.paused, 'after the pick the queued Form offer opens (solo pauses)');
  p.offer = null; p.pendForm = 0; w.paused = false;
  p.pendForm = 1; w.takeForm(p, p.weapons[0], w.formsReady(p, p.weapons[0])[0].id); w.updateProgress();
  ok(!p.offer && p.pend === 1 && !p.pendForm, 'a queued Form offer with nothing ready left becomes an extra level-up');
  p.pend = 0;
  p.pendPath = 1; w.updateProgress();
  ok(!p.offer && p.pend === 1 && !p.pendPath, 'a queued path pick with nothing path-ready becomes an extra level-up');
  p.pend = 0;
  // benchmark elites: a Form offer only from the benchmark and only with a Form ready; a path pick first
  const e = world(), h = e.heroes[0]; h.passives.push({ id: 'might', lvl: 1 }); e.recalc(h, false);
  e.setRanks(h, h.weapons[0], ED.TUNE_MAX, 0, ED.PATH_MAX);
  const r0 = e.openChest(h, 1)[0];
  e.sp.bench = true;
  const r1 = e.openChest(h, 1)[0];
  e.takeForm(h, h.weapons[0], e.formsReady(h, h.weapons[0])[0].id); h.pendForm = 0;
  const r2 = e.openChest(h, 1)[0];
  e.addWeapon(h, 'tsa'); e.setRanks(h, h.weapons[1], ED.TUNE_MAX);
  const r3 = e.openChest(h, 1)[0];
  ok(r0.kind !== 'form' && r1.kind === 'form' && h.pendForm === 0 && r2.kind !== 'form' && r3.kind === 'pathpick', `elite chest: a Form offer only from the benchmark with a Form ready; a path pick whenever a slot is path-ready (${r0.kind}, ${r1.kind}, ${r2.kind}, ${r3.kind})`);
  // co-op: each hero gets its own chest result
  const c = world('knight', {}, 2), [k, rg] = c.heroes;
  c.setRanks(k, k.weapons[0], ED.TUNE_MAX, 0, ED.PATH_MAX); c.events.length = 0;
  c.openChest(rg, 2);
  const evs = c.events.filter(x => x.t === 'chest');
  ok(evs.length === 2 && evs.find(x => x.pid === 'p1').results[0].kind === 'form' && evs.find(x => x.pid === 'p2').results[0].kind === 'offer' && k.pendForm === 1 && rg.pend === 1,
    'co-op boss chest: the hero with a ready Form gets a Form offer, the other an extra level-up');
}
// ---- no softlock: random level-ups and chests with random picks never open an empty offer, and the lifecycle completes
{
  let empty = 0, opened = 0, done = 0;
  for (let s = 1; s <= 6; s++) {
    const w = world('knight', {}, 1, 100 + s), p = w.heroes[0], R = ED.U.RNG(s);
    w.addWeapon(p, 'tsa');
    for (let i = 0; i < 400; i++) {
      const roll = R.next();
      if (roll < 0.7) p.pend++; else w.openChest(p, roll < 0.9 ? 1 : 2);
      for (let k = 0; k < 8 && (p.offer || p.pend > 0 || p.pendPath > 0 || p.pendForm > 0); k++) {
        w.updateProgress();
        if (!p.offer) continue;
        opened++; if (!p.offer.length) { empty++; p.offer = null; continue; }
        w.pickCard(p, R.int(0, p.offer.length - 1)); w.paused = false;
      }
    }
    if (p.weapons.every(ws => ws.evo && ws.fl === 2)) done++;
  }
  ok(!empty && opened > 1000 && done === 6, `random runs: ${opened} offers opened, ${empty} empty; ${done}/6 runs finish every slot (Form refined twice)`);
}
// ---- fallback, gold card, determinism
{
  const w = world('knight', { greed: 2 }), p = w.heroes[0];
  w.setForm(p, p.weapons[0], ED.WEAPONS.cleave.paths[0].forms[0], 2);
  for (const id of ['tsa', 'tsb']) w.setForm(p, w.addWeapon(p, id), id + 'f', 2);
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
  const first = keys(p.offer), bi = p.offer.findIndex(c => w.canBanish(p.offer, c)), o0 = p.offer.findIndex((c, i) => i !== bi);
  w.input('p1', { banish: bi + 1 }); w.update(C.TICK);
  const k = first[bi];
  ok(bi >= 0 && p.banishes === 1 && p.banned[0] === k && p.offer.length === 3 && keys(p.offer).indexOf(k) < 0 && keys(p.offer)[o0] === first[o0], 'banish card ' + (bi + 1) + ': removed (' + k + '), replaced in place, others kept');
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
  // tune and path rank cards cannot be banished (a slot's only way forward); refine, support, passive and skill cards can
  const w2 = world('knight', { banish: 3 }), q = w2.heroes[0], tc = w2.cardPool(q).find(x => x.c.kind === 'tune').c;
  q.offer = [tc, w2.goldCard(q)];
  const t1 = w2.banishCard(q, 0);
  w2.setRanks(q, q.weapons[0], ED.TUNE_MAX, 0, 2); const pc = w2.cardPool(q).find(x => x.c.kind === 'path').c; q.offer = [pc];
  const t2 = w2.banishCard(q, 0);
  w2.setForm(q, q.weapons[0], ED.WEAPONS.cleave.paths[0].forms[0], 0); const rc = w2.cardPool(q).find(x => x.c.kind === 'refine').c; q.offer = [rc, w2.goldCard(q)];
  ok(!t1 && !t2 && q.banishes === 3 && w2.banishCard(q, 0) && q.banishes === 2 && !w2.cardPool(q).some(x => x.c.kind === 'refine'), 'tune and path rank cards cannot be banished; a refine card can');
}
// ---- elite chest rolls
{
  const w = world(), p = w.heroes[0], ws = p.weapons[0];
  w.setRanks(p, ws, 2);
  const tk0 = ws.tk.join(), id0 = ws.id;
  p.passives.push({ id: 'might', lvl: 1 }); w.recalc(p, false);
  let r = w.openChest(p, 1);
  const ev = w.events.find(e => e.t === 'chest');
  ok(r.length === 1 && (r[0].kind === 'plvl' || r[0].kind === 'skill') && ws.id === id0 && ws.tk.join() === tk0 && ws.path === -1, 'elite chest, nothing waiting: one passive / skill roll, never a weapon step (' + r[0].kind + ' ' + r[0].id + ')');
  ok(ev && ev.results === r && ev.val === 1 && r[0].name && r[0].icon && r[0].txt, 'chest event carries the result list');
  let pl = 0, sl = 0;
  for (let i = 0; i < 200; i++) { p.passives[0].lvl = 1; p.skills[0].lvl = 1; const x = w.openChest(p, 1)[0]; if (x.kind === 'plvl') pl++; else if (x.kind === 'skill') sl++; }
  ok(pl > 50 && sl > 50, 'elite rolls pick a passive or the skill (' + pl + '/' + sl + ')');
  p.passives[0].lvl = 5; p.skills[0].lvl = ED.skillMaxLvl(ED.SKILLS[p.skills[0].id]);
  const g0 = w.gold; r = w.openChest(p, 1);
  ok(r.length === 1 && r[0].kind === 'gold' && w.gold === g0 + 25, 'nothing to level: 25 gold');
  w.events.length = 0;
  const pend0 = p.pend; r = w.openChest(p, 2);
  ok(r.length === 1 && r[0].kind === 'offer' && p.pend === pend0 + 1 && r[0].txt, 'boss chest, nothing waiting: one extra level-up offer (' + r[0].txt + ')');
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
