// Usage: node tools/sheet-check.js [--verbose]
// Compares the numbers of ED.Sheet.compute with what the sim does. A pinned dummy foe (a non-boss, 1e9 health, radius REF.r, no AI) stands REF.d px in front of a staged hero with crit forced to 0;
// the tool buckets the damage of every hit by its skill part, casts each skill (with its flag-gated parts on), attacks with each weapon for 20 s and compares measured with modelled numbers.
// Prints the failures and exits 1 when any check fails. Also checks the A4 test vectors (fresh heroes, an elemental Pyromancer).
const { ED } = require('./sim.js');
const verbose = process.argv.includes('--verbose');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } else if (verbose) console.log('ok   ' + msg); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const rel = (a, b, tol, msg) => ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * tol), `${msg}: got ${a.toFixed ? a.toFixed(3) : a}, want ${b.toFixed ? b.toFixed(3) : b} (${tol * 100}%)`);
const W = ED.World.prototype, REF = ED.Sheet.REF, C = ED.CONST;
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const CTX = (o) => Object.assign({ stratum: 1, pact: 0, gold: 0, level: 5, xp: 0, xpNext: 100, dark: false, allyNear: 0, minions: 0, room: null, party: 1, rooms: { seen: 1, total: 10, darkTotal: 2, darkLeft: 2 }, heroes: [], time: 0 }, o || {});

// ---------------- test vectors (DESIGN-ux A4) ----------------
function modelOf(cls, boons, wi, o) {
  const b = { cls, weapon: ED.CLASSES[cls].weapons[wi || 0], boons: boons || {}, relics: (o && o.relics) || [], meta: META(), pact: 0 };
  const stats = ED.Stats.compute(b);
  if (o && o.stat) Object.assign(stats, o.stat);
  stats.sn = {};
  const p = { pid: 'p', name: 'T', cls, weapon: b.weapon, boons: b.boons, relics: b.relics, meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: (o && o.shield) || 0, picks: 0, slot: 0 };
  return ED.Sheet.compute(p, CTX(o && o.ctx), { raw: true });
}
{
  const V = { // weapon hit, avg, aps, dps; armor taken
    knight: [18, 18.675, 2.381, 44.47, 0.8824], ranger: [12, 12.9, 2.941, 37.94, 0.9231], pyro: [15, 15.5625, 2.0, 49.125, 0.9375], shade: [11, 11.99, 4.762, 57.1, 0.9231], cleric: [17, 17.64, 2.381, 54.6, 0.8955], necro: [9, 9.34, 2.5, 23.35, 0.9677],
  };
  for (const cls in V) { // every class: hit, avg at crit 0 (= hit), avg and dps at the class crit, attacks per second, armor
    const m = modelOf(cls, {}, 0, { stat: { crit: 0 } }), mc = modelOf(cls, {}, 0), v = V[cls], w = m.weapon;
    near(w.hit, v[0], 0.05, cls + ' weapon hit');
    near(w.avg, v[0], 0.05, cls + ' weapon avg at crit 0');
    near(mc.weapon.avg, v[1], 0.01, cls + ' weapon avg at the class crit');
    near(mc.weapon.dps, v[3], 0.1, cls + ' weapon dps');
    near(w.aps, v[2], 0.005, cls + ' attacks per second');
    near(m.def.taken, v[4], 0.0005, cls + ' damage taken');
  }
  const by = (m, s, p) => m.skills[s].parts.find(q => q.id === p);
  near(by(modelOf('knight', {}, 0, { stat: { crit: 0 } }), 0, 'impact').raw, 48.8, 0.05, 'Charge impact'); near(modelOf('knight', {}, 0).def.ehp, 153, 1, 'Knight effective health');
  const rg = modelOf('ranger', {}, 0, { stat: { crit: 0 } }), arrow = by(rg, 0, 'arrow');
  near(arrow.raw, 18.4, 0.05, 'Volley arrow'); ok(arrow.oneFoe === 3 && arrow.fanN === 7, `Volley: 3 of 7 arrows reach a foe at REF (got ${arrow.oneFoe} of ${arrow.fanN})`);
  near(rg.skills[0].perCast, 55.2, 0.1, 'Volley per cast on one foe'); near(rg.skills[0].perCastAll, 128.8, 0.1, 'Volley per cast, all 7'); near(rg.skills[1].perCast, 75.2, 0.1, 'Rain per cast (9.4 x 8)');
  const py = modelOf('pyro', {}, 0, { stat: { crit: 0 } });
  near(py.weapon.extras[0].perAttack, 9, 0.05, 'Fire Staff blast'); near(by(py, 0, 'blast').raw, 64.5, 0.05, 'Nova blast'); near(by(py, 0, 'burn').raw, 52.8, 0.05, 'Nova burn add'); near(by(py, 1, 'impact').raw, 89.5, 0.05, 'Meteor impact');
  near(by(py, 1, 'crater').here * by(py, 1, 'crater').oneFoe, 64.8, 0.1, 'Meteor crater, 6 ticks');
  const sh = modelOf('shade', {}, 0, { stat: { crit: 0 } });
  near(by(sh, 0, 'slash').raw, 40.6, 0.05, 'Shadowstep'); near(by(sh, 0, 'slash').avg, 71.05, 0.05, 'Shadowstep always crits'); near(by(sh, 1, 'ambush').avg, 48.125, 0.05, 'Ambush');
  const cl = modelOf('cleric', {}, 0, { stat: { crit: 0 }, ctx: { stratum: 3 } }), leg = by(cl, 1, 'leg');
  near(leg.pre, 50.16, 0.05, 'Judgment leg with its own vulnerability'); near(cl.skills[1].perCast, 100.3, 0.1, 'Judgment per cast (two legs)'); near(by(cl, 0, 'zone').here * 7, 106.4, 0.1, 'Sanctuary 7 ticks');
  const nc = modelOf('necro', {}, 0, { stat: { crit: 0 } }), mn = by(nc, 0, 'minion');
  near(mn.here, 9.69, 0.01, 'Minion hit'); ok(mn.oneFoe === 51, `Minions: 3 x 17 hits (got ${mn.oneFoe})`); near(by(nc, 1, 'burst').raw, 40.2, 0.05, 'Harvest burst');
  // Set 2: Sharpened Edge x2, Stoke x1, weak to Fire (stratum III), crit 5%. DEVIATION from DESIGN-ux A4: a class-element skill takes half the affinity (combat.js affC: x1.25, not x1.5), so Nova blast and crater use 1.25; statuses (Nova burn, Meteor burn add) take the full x1.5.
  const e2 = modelOf('pyro', { edge: 2, stoke: 1, kindle: 1 }, 0, { ctx: { stratum: 3 }, stat: { crit: 0.05 } });
  near(e2.mult.dmg.total, 1.2, 1e-9, 'Set 2 damage'); near(by(e2, 0, 'blast').here, 64.5 * 1.2 * (1 + 0.05 * 0.75) * 1.25, 0.05, 'Set 2 Nova blast (class skill: half affinity)');
  near(by(e2, 0, 'burn').here, 52.8 * 1.5 * 1.25, 0.05, 'Set 2 Nova burn (full affinity, Burn strength)');
  near(by(e2, 1, 'impact').statusAdd.here, 0.5 * by(e2, 1, 'impact').pre * 1.5 * 1.25, 0.05, 'Set 2 Meteor burn add (affinity once)');
  near(by(e2, 1, 'crater').here * by(e2, 1, 'crater').oneFoe, 6 * 10.8 * 1.2 * 1.25, 0.1, 'Set 2 crater, 6 ticks');
}

// ---------------- affinity chips: the class element's skills take half the affinity whichever source lists the element ----------------
{
  const aff = (cls, boons, stratum) => modelOf(cls, boons, 0, { ctx: { stratum } }).aff.now.mine;
  let a = aff('cleric', {}, 2).find(x => x.el === 'holy');
  ok(a && a.why === 'class' && a.mul === 0.5 && a.skillMul === 0.75, 'fresh Cleric, stratum II: Holy statuses x0.5, skills x0.75');
  a = aff('cleric', { consecrate: 1 }, 2).find(x => x.el === 'holy');
  ok(a && a.why === 'path' && a.mul === 0.5 && a.skillMul === 0.75, 'Cleric with the Holy gate keeps the class-skill affinity');
  a = aff('pyro', { kindle: 1 }, 3).find(x => x.el === 'fire');
  ok(a && a.mul === 1.5 && a.skillMul === 1.25, 'Pyromancer with Kindle, stratum III: statuses x1.5, skills x1.25');
  a = aff('knight', { kindle: 1 }, 3).find(x => x.el === 'fire');
  ok(a && a.skillMul === null, 'a Knight has no class element');
}
// every ED.SKILL_SHEET key names a part that exists (a renamed part would silently lose its oneFoe, selfVuln or infAdd)
for (const key in ED.SKILL_SHEET) { const [sid, pid] = key.split('.'); ok(ED.SKILLS[sid] && ED.SKILLS[sid].parts.some(q => q.id === pid), 'ED.SKILL_SHEET key ' + key + ' resolves to a skill part'); }

// ---------------- text at rank: every boon renders without a left-over token, numbers follow the rank ----------------
{
  const st = ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 });
  let bad = 0;
  for (const id of ED.BOON_IDS) { const b = ED.BOONS[id]; for (let r = 1; r <= (b.max || 5) + 1; r++) { const t = ED.Sheet.text(id, r, st); if (!t || /[{}\[\]]/.test(t)) { bad++; console.log('FAIL boon text ' + id + ' rank ' + r + ': ' + t); } } }
  ok(bad === 0, 'boon texts resolve at every rank');
  ok(ED.Sheet.text('edge', 1, st) === '+10% damage.' && ED.Sheet.text('edge', 2, st) === '+20% damage.', 'Sharpened Edge text follows the rank');
  ok(ED.Sheet.text('overcharge', 1, st).indexOf('37 damage') >= 0, 'Overcharge shows its damage at the Knight Power (10 + 1.5 x 18)');
  ok(ED.Sheet.text('forager', 2, st).indexOf('20% more often') >= 0 && ED.Sheet.text('forager', 2, st).indexOf('6% more max') >= 0, 'Forager numbers scale with the rank');
  ok(ED.Sheet.text('sanctity', 2, st).indexOf('0.5% more') >= 0 && ED.Sheet.text('sanctity', 2, st).indexOf('6% more') >= 0, 'small percentages keep their decimals');
  ok(ED.Sheet.text('k_atk_h', 3, st).indexOf('Follow-Through') >= 0, 'class cards render through boonText');
  // every number a token prints equals the stat the boon adds
  for (const id of ED.BOON_IDS) { const b = ED.BOONS[id]; if (b.route || !b.mods) continue; for (const k in b.mods) { const m = new RegExp('\\{' + k + '(\\*[^}:]+)?(:\\w+)?\\}').exec(b.desc); if (m && !m[1] && b.mods[k] !== 0) ok(ED.Sheet.text(id, 1, st).indexOf(ED.Sheet.fmt(k, Math.abs(b.mods[k]), m[2] && m[2].slice(1))) >= 0, 'token ' + k + ' of ' + id); } }
}

// ---------------- next rank, seconds, plurals, statuses and forks in the model ----------------
{
  const st = ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 }), S = ED.Sheet;
  ok(S.nextText('edge', 1, st) === '+20% damage', 'Next rank lists only the changed number: ' + S.nextText('edge', 1, st));
  { const rows = [].concat(...modelOf('knight', { edge: 2, quick: 1 }, 0).build.groups.map(g => g.items)); ok(rows.find(x => x.id === 'edge').next === null && rows.find(x => x.id === 'quick').next === '+20% attack speed', 'only a card below its last rank has a Next rank line'); }
  { // no Next-rank piece is a bare number: it names what changes
    let bare = 0;
    for (const id of ED.BOON_IDS) { const b = ED.BOONS[id]; for (let r = 1; r < (b.max || 1); r++) for (const piece of S.nextText(id, r, st).split(' · ')) if (!/[A-Za-z]{3,}/.test(piece.replace(/\d+(?:\.\d+)?\s?s\b/g, ''))) { bare++; console.log(`FAIL bare next-rank piece ${id} rank ${r}: "${piece}"`); } }
    ok(bare === 0, 'Next rank lines are never bare numbers');
    ok(S.nextText('k_s1_a', 1, st) === 'deals +20% · 50% of its impact · unlocks Shield Bash' && S.nextText('k_s2_b', 1, st) === 'orbits you for 4 s · 20% of a strike · unlocks Return to Sender' && S.nextText('k_s1_a', 2, st).indexOf('unlocks Avalanche') >= 0 && S.nextText('r_s2_b', 2, st).indexOf('unlocks Storm of Thorns') >= 0, 'Juggernaut and Shield Orbit name their numbers: ' + S.nextText('k_s1_a', 1, st) + ' / ' + S.nextText('k_s2_b', 1, st));
    ok(S.text('r_el_b', 2, st).indexOf('within 120.') >= 0 && S.text('r_el_b', 3, st).indexOf('within 140') >= 0 && S.nextText('r_el_b', 1, st) === 'foes within 120 · unlocks Outbreak', 'Contagion shows its total radius: ' + S.nextText('r_el_b', 1, st));
    ok(S.nextText('p_s2_b', 1, st) === 'impact (+40%) · unlocks Impact Crater' && S.nextText('p_s2_b', 2, st) === 'impact (+60%) · unlocks Sun Dive', 'Comet names what the +40% belongs to and what each rank unlocks: ' + S.nextText('p_s2_b', 1, st) + ' / ' + S.nextText('p_s2_b', 2, st));
    ok(['p_s1_a:Collapse:Supernova', 'p_s1_b:Rebirth Flare:Phoenix Form', 'p_s2_a:Meteor Shower:Cataclysm', 's_s1_a:Twin Cut:Death Blossom', 's_s1_b:Lure:Hall of Mirrors', 's_s2_a:Ambush Sweep:Eclipse', 's_s2_b:Shroud:Umbral Veil'].every(x => { const [id, r2, r3] = x.split(':'); return S.nextText(id, 1, st).indexOf('unlocks ' + r2) >= 0 && S.nextText(id, 2, st).indexOf('unlocks ' + r3) >= 0; }), 'the Pyromancer and Shade skill forks name their rank 2 rider and rank 3 transform in the Next rank line');
  }
  ok(S.nextText('k_el_a', 1, st).indexOf('unlocks Ruin Seal') >= 0 && S.nextText('k_el_a', 2, st).indexOf('unlocks Doombrand') >= 0 && S.nextText('k_el_a', 2, st).indexOf('6 ailments') >= 0, 'a route card names the rider it unlocks at rank 2 and the transform at rank 3');
  ok(S.fmt('arcStun', 0.25, 'sec') === '0.25s' && S.fmt('arcStun', 0.5, 'sec') === '0.5s' && S.fmt('venomHold', 2, 'sec') === '2s' && S.fmt('venomHold', 12, 'sec') === '12s', 'seconds keep two decimals below 1 s');
  ok(S.text('overload', 1, st).indexOf('0.25s') >= 0, 'Overload states its real stun time: ' + S.text('overload', 1, st));
  ok(S.text('pierce', 1, st).indexOf('+1 foe.') >= 0 && S.text('pierce', 2, st).indexOf('+2 foes.') >= 0, 'counts pluralise: ' + S.text('pierce', 1, st) + ' / ' + S.text('pierce', 2, st));
  const mb = modelOf('knight', { k_el: 1, k_el_a: 1 }, 0), ids = mb.build.statuses.map(x => x.id);
  ok(ids.indexOf('ailment') >= 0 && ids.indexOf('bleed') >= 0, 'Brand lists the Ailments rule and the Bleed rule: ' + ids.join(','));
  ok(modelOf('knight', { masterstroke: 1 }, 0).build.statuses.some(x => x.id === 'bleed'), 'Masterstroke lists the Bleed rule');
  const fk = modelOf('knight', { k_atk: 1, k_atk_h: 1 }, 0).build.route.nodes.find(n => n.route === 'attack').forks;
  ok(fk.find(x => x.id === 'k_atk_h').closed === false && fk.find(x => x.id === 'k_atk_s').closed === true && fk.find(x => x.id === 'k_atk_s').when === '', 'the sibling of the taken fork is closed');
  { // a fork at rank 3 carries its transform's name on the sheet (the route node and the boon list)
    const m3 = modelOf('knight', { k_s1: 1, k_s1_a: 3 }, 0), m2 = modelOf('knight', { k_s1: 1, k_s1_a: 2 }, 0), fn = (m) => m.build.route.nodes.find(n => n.route === 'skill1').forks.find(f => f.id === 'k_s1_a');
    ok(fn(m3).name === 'Avalanche' && fn(m2).name === 'Juggernaut' && fn(m3).text.indexOf('Avalanche:') >= 0 && fn(m2).text.indexOf('Avalanche') < 0, 'the route node names the transform from rank 3: ' + fn(m3).name + ' / ' + fn(m2).name);
    ok([].concat(...m3.build.groups.map(g => g.items)).some(r => r.id === 'k_s1_a' && r.name === 'Avalanche'), 'the boon list names the transform too');
  }
  const open = modelOf('knight', { k_atk: 1 }, 0).build.route.nodes.find(n => n.route === 'attack').forks;
  ok(open.every(x => !x.closed && x.when), 'before a fork both are open and say when they are offered');
  ok(ED.Sheet.shieldWindow({ shwC: 1.5, shwA: 2.5 }, 0).a === 2.5 && ED.Sheet.shieldWindow({ shwC: 1.5, shwA: 2.5 }, 0).c === 1.5, 'a mirror hero carries the shield window in shwC and shwA');
}

// ---------------- the staged world ----------------
const hits = []; // [{ part, kind, dealt, el }]
const oHit = W.hitEnemy;
W.hitEnemy = function (e, base, src) {
  const dealt = oHit.call(this, e, base, src);
  if (e._dummy && dealt > 0) hits.push({ part: (src && src.part) || (src && src.ambush ? 'vanish.ambush' : src && src.kind === 'minion' ? 'legion.minion' : undefined), kind: (src && src.kind) || 'weapon', raw: !!(src && src.raw), el: src && (src.el || src.clsEl), bleed: !!(src && src.bleed), wpn: !!(src && src.wpn), dealt, t: this.time });
  return dealt;
};
const oUpd = W.updateEnemy;
W.updateEnemy = function (e, dt) {
  if (!e._dummy) return oUpd.call(this, e, dt);
  e.flash -= dt; e.mark -= dt; e.invulnT = (e.invulnT || 0) - dt; e.kbx = e.kby = 0; this.tickStatuses(e, dt);
};
function stage(cls, boons, wi, stat, relics, dist, crit) {
  const w = new ED.World({ seed: 11, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  if (relics) p.relics = relics.slice();
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  Object.assign(p.stats, stat || {}, { crit: crit || 0 }); p.stats.sn = {};
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0;
  const e = w.spawnEnemy('skeleton', p.x + (dist || REF.d), p.y - 4); e._dummy = true; e.spd = 0; e.cd = 1e9; e.r = REF.r; e.hp = e.maxHp = 1e9; e.def = Object.assign({}, e.def, { guard: undefined });
  hits.length = 0;
  return { w, p, e };
}
const run = (w, secs, f) => { for (let i = 0, k = Math.round(secs * 60); i < k; i++) { w.update(1 / 60); if (f) f(); } };
const sheetOf = (w, p) => ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true });

// Runs until nothing of the hero is left on the dummy (no Burn pool, no zone of the hero, no minion strike pending) or the cap, returns the hits by bucket.
function settle(w, e, cap) {
  for (let t = 0; t < cap * 60; t++) { w.update(1 / 60); if (t > 30 && !(e.burnPool > 0) && !w.zones.some(z => z.team === 0) && !w.projs.some(q => q.team === 0) && !w.allies.length && !(w.chainQ && w.chainQ.length)) break; }
  const by = {};
  for (const h of hits) {
    const key = h.part || (h.kind === 'dot' ? (h.raw ? 'status:' + (h.bleed ? 'bleed' : h.el) : 'zone') : h.kind);
    (by[key] || (by[key] = { n: 0, sum: 0 })); by[key].n++; by[key].sum += h.dealt;
  }
  return by;
}
// skill casts: data for the skill's aim toward the dummy
function cast(w, p, e, slot) {
  const id = slot ? ED.CLASSES[p.cls].skill2 : ED.CLASSES[p.cls].skill, N = ED.Stats.skillNums(id, p.stats), a = 0;
  let data = null;
  if (N.aim === 'ground') data = { x0: p.x, y0: p.y, x: e.x, y: e.y };
  else if (N.aim === 'move') data = { x0: p.x, y0: p.y, x1: e.x + 30, y1: e.y };
  else if (id === 'shieldthrow') data = { d: 160 };
  w.playerSkill(p, a, data || {}, slot);
}

// each case: class, boons/stats that switch parts on, the skill slot, the parts to compare, and what to expect of the hit counts
const GEO = new Set(['shieldthrow.return', 'shieldthrow.orbit', 'shieldthrow.reflect']); // need a second foe on the flight path or an orbiting shield
const PENDING = new Set(['sky', 'sky2', 'shower', 'twin', 'rocks', 'echo', 'after', 'corpse', 'lance', 'flare']); // parts of class routes whose sim side belongs to a class stream
let pend = 0;
const pending = (msg) => { pend++; if (verbose) console.log('pending ' + msg); };
// [class, stat switches, slot, dummy distance (default REF.d)]
const CASES = [
  ['knight', {}, 0], ['knight', {}, 1], ['knight', { jugShock: 0.4, s1Range: 90 }, 0], ['knight', { avalanche: 2, avaCrack: 0.5, avaStun: 0.8, jugShock: 0.4, s1Range: 90 }, 0], ['knight', { tempest: 3, twinShield: 0.7, vortexMul: 0.25, vortexDur: 2.5 }, 1], ['knight', { orbit: 3, orbitMul: 0.15 }, 1], ['knight', { twinShield: 0.7 }, 1],
  ['ranger', {}, 0], ['ranger', {}, 1], ['ranger', { deathMark: 0.5, deathWave: 0.6 }, 0], ['ranger', { thornburst: 20 }, 0], ['ranger', { skyfall: 1, starfall: 0.6 }, 1, 160], ['ranger', { thornstorm: 2 }, 1], ['ranger', { rainHail: 1 }, 1], ['ranger', { skyfall: 1 }, 1], ['ranger', { skyTwin: 0.5, skyfall: 1 }, 1], ['ranger', { shower: 0.4, rainHail: 1 }, 1],
  ['pyro', {}, 0], ['pyro', {}, 1], ['pyro', { novaRing: 1 }, 0], ['pyro', { twinMeteor: 0.6 }, 1, 0, true], ['pyro', { comet: 0.3 }, 1],
  ['pyro', { novaEcho: 0.5 }, 0], ['pyro', { novaEcho: 1, supernova: 2, supernovaPull: 30 }, 0], ['pyro', { novaRing: 1, phoenixMul: 2, phoenixDur: 4, dashTrail: 0.5 }, 0], ['pyro', { cataclysm: 0.6 }, 1],
  ['pyro', { comet: 0.6, sunDive: 1, diveTrail: 0.5 }, 1, undefined, false, { setup: (w, p, e) => { p.aimX = e.x; p.aimY = e.y; }, skip: ['crater', 'trail'] }],
  ['shade', {}, 0], ['shade', { stepTwin: 0.5 }, 0], ['shade', {}, 1, 28],
  ['shade', { blossom: 0.7, blossomN: 3, blossomMax: 6 }, 0], ['shade', { afterimage: 1, mirrorHall: 1 }, 0, 1],
  ['shade', { eclipse: 0.6, eclipseDur: 4 }, 1, 28, false, { drive: true }], ['shade', { umbral: 2, cloneMul: 0.5 }, 1, 28, false, { drive: true, skip: ['clone'] }],
  ['cleric', {}, 0], ['cleric', {}, 1], ['cleric', { twinHammer: 0.75 }, 1],
  ['cleric', { wrath: 1, wrathNova: 1.5, wrathPillar: 1.2 }, 0], ['cleric', { aura: 1, aegis: 1, aegisR: 40, aegisDR: 0.1, aegisStun: 0.3 }, 0], ['cleric', { storm: 5, stormMul: 0.45, thirdLeg: 1, twinHammer: 0.55, secondFlight: 0.25 }, 1], ['cleric', { verdict: 1, fjEcho: 0.2, fjR: 40, fjStun: 0.6 }, 1],
  ['necro', {}, 0], ['necro', { boneSpikes: 1 }, 0], ['necro', { boneSpikes: 1, bloom: 1, bloomField: 0.5, bloomBomb: 1.2 }, 0], ['necro', { knights: 1, maxMinions: 2, s1N: -2 }, 0], ['necro', { knights: 1, maxMinions: 2, s1N: -2, dk: 1, dkMul: 4.5, dkArc: 2.4, dkTaunt: 120 }, 0],
];
for (const [cls, stat, slot, dist, skipImpact, opt] of CASES) {
  const { w, p, e } = stage(cls, {}, 0, stat, null, dist);
  const id = slot ? ED.CLASSES[cls].skill2 : ED.CLASSES[cls].skill, tag = `${cls}.${id}${Object.keys(stat).length ? '+' + Object.keys(stat).join(',') : ''}`;
  if (opt && opt.setup) opt.setup(w, p, e);
  const m = sheetOf(w, p), sk = m.skills[slot];
  cast(w, p, e, slot);
  if (opt && opt.drive) { // Vanish forms: attack through the form's window (the first attack is the Ambush; a tick passes first so the dome's vulnerability is on)
    let next = 0.02; run(w, 0.02);
    run(w, 4.3, () => { if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); } });
  } else if (id === 'vanish') w.playerAttack(p, 0); // the Ambush
  const by = settle(w, e, 20);
  for (const q of sk.parts) {
    if (q.kind === 'zone' || (opt && opt.skip && opt.skip.indexOf(q.id) >= 0)) continue;
    const key = q.kind === 'sec' && !by[id + '.' + q.id] ? 'zone' : id + '.' + q.id, got = by[key]; // zone ticks: by part when the zone carries one
    if (q.kind === 'status') { const s = by['status:' + q.statusEl]; ok(s && Math.abs(s.sum - q.here) <= q.here * 0.03 + 0.2, `${tag} ${q.id}: status damage ${s ? s.sum.toFixed(1) : 0} vs ${q.here.toFixed(1)}`); continue; }
    if (q.oneFoe === 0 && !q.fanN) continue; // conditional parts (per minion, per corpse, per kill)
    if (!got && GEO.has(id + '.' + q.id)) continue;
    if (!got) { if (PENDING.has(q.id)) pending(`${tag} ${q.id}: no hit measured`); else ok(false, `${tag} ${q.id}: no hit measured`); continue; }
    if (skipImpact && q.id === 'impact') continue; // the twin meteor shares the impact's part name
    const per = got.sum / got.n;
    rel(per, q.here, 0.015, `${tag} ${q.id} per hit`);
    if (q.kind === 'minion') continue; // minions walk to the foe: the count is reported, not compared
    if (stat.tempest && q.id === 'return') continue; // which of the vortex shields cross the foe on the way home depends on where each spun: the damage per hit is compared, not the count
    ok(q.attacks !== undefined ? Math.abs(got.n - q.oneFoe) <= 1 : got.n === q.oneFoe, `${tag} ${q.id}: ${got.n} ${q.fanN ? 'arrows reached' : 'hits on'} the foe, modelled ${q.oneFoe}${q.attacks !== undefined ? ' (one attack more or less is the timing of the first)' : ''}`);
    if (q.statusAdd) { const s = by['status:' + q.statusAdd.el]; ok(s && Math.abs(s.sum - q.statusAdd.here * q.oneFoe) <= q.statusAdd.here * q.oneFoe * 0.03 + 0.2, `${tag} ${q.id}: status add ${s ? s.sum.toFixed(1) : 0} vs ${(q.statusAdd.here * q.oneFoe).toFixed(1)}`); }
  }
}

{ // Bone Harvest: every minion you have bursts on the foe next to it (the model counts the minions you have)
  const { w, p, e } = stage('necro', {}, 0, {});
  cast(w, p, e, 0); run(w, 0.5); hits.length = 0;
  const m = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true }), q = m.skills[1].parts.find(x => x.id === 'burst');
  cast(w, p, e, 1);
  const by = settle(w, e, 3), got = by['harvest.burst'];
  ok(got && got.n === q.oneFoe, `Bone Harvest: ${got ? got.n : 0} bursts on the foe, modelled ${q.oneFoe}`);
  if (got) rel(got.sum / got.n, q.here, 0.015, 'Bone Harvest burst per hit');
}

{ // Carrion Storm: every corpse that explodes launches 3 shards at the nearest foes; against one foe all of them land (the model's shard row is per corpse)
  const { w, p, e } = stage('necro', {}, 0, { corpse: 10, corpseMul: 0.9, carrionN: 3, carrionShard: 0.4 });
  w.corpses.push({ x: e.x + 20, y: e.y, t: w.time }, { x: e.x - 20, y: e.y + 10, t: w.time });
  const q = sheetOf(w, p).skills[1].parts.find(x => x.id === 'shard');
  cast(w, p, e, 1);
  const by = settle(w, e, 3), got = by['harvest.shard'];
  ok(got && got.n === 6 && by['harvest.corpse'] && by['harvest.corpse'].n === 2, `Carrion Storm: ${got ? got.n : 0} shard hits for 2 corpses, want 6`);
  if (got) rel(got.sum / got.n, q.here, 0.015, 'Carrion Storm shard per hit');
}

// ---------------- weapons: attacks on one foe, then the clouds and shots in flight finish ----------------
function weaponRun(cls, wi, boons, o) {
  o = o || {};
  const probe = stage(cls, boons, wi, null), wp = probe.p.stats.weapon, reach = wp.kind === 'melee' ? wp.range * (1 + 0.5 * probe.p.stats.area + probe.p.stats.meleeReach) : 0;
  const { w, p } = stage(cls, boons, wi, o.stat, null, reach ? reach * 0.55 : REF.d, o.crit);
  if (o.stratum) w.stratum = o.stratum;
  const m = sheetOf(w, p);
  let next = 0, atk = 0;
  run(w, o.secs || 20, () => { if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); atk++; } });
  run(w, 4);
  const total = hits.filter(h => !(h.kind === 'dot' && h.raw)).reduce((s, h) => s + h.dealt, 0), bleed = hits.filter(h => h.kind === 'dot' && h.raw && h.bleed).reduce((s, h) => s + h.dealt, 0);
  return { m, total, atk, bleed, secs: o.secs || 20 };
}
for (const cls of ED.CLASS_IDS) for (let wi = 0; wi < 3; wi++) {
  const r = weaponRun(cls, wi, {}), id = ED.CLASSES[cls].weapons[wi];
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.04, `${id} damage per attack on one foe`);
}
// forks and route weapons: Heavy, Swift and the Knight Cleave
for (const [cls, boons, tag] of [['knight', { k_atk: 1 }, 'Oath of Steel'], ['knight', { k_atk: 1, k_atk_h: 1 }, 'Oathbreaker'], ['knight', { k_atk: 1, k_atk_s: 1 }, 'Sworn Blade'], ['knight', { k_atk: 1, k_atk_h: 3 }, 'Earthsplitter'], ['knight', { k_atk: 1, k_atk_s: 3 }, 'Thousand Edges'], ['ranger', { r_atk: 1, r_atk_h: 1 }, 'Ballista'], ['cleric', { c_atk: 1, c_atk_s: 1 }, 'Crusader']]) {
  const r = weaponRun(cls, 0, boons, { secs: 24 });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.05, `${tag} damage per attack`);
}
// Masterstroke: every 4th attack crits for sure at x1.3 (the chance of a normal crit stays on the other three) and Bleeds for at least half the hit
for (const [cls, crit] of [['knight', 0], ['knight', 0.3], ['ranger', 0], ['pyro', 0.3], ['shade', 0]]) {
  const r = weaponRun(cls, 0, { masterstroke: 1 }, { secs: 60, crit }), plain = weaponRun(cls, 0, {}, { secs: 20, crit: 0 });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.04, `Masterstroke ${cls} damage per attack at crit ${crit}`);
  ok(r.m.weapon.extras.some(e => e.label === 'Masterstroke') && r.m.weapon.dps > plain.m.weapon.dps, `Masterstroke ${cls}: the weapon card lists it and dps rises`);
  rel(r.bleed / r.secs, r.m.proc.bleed, 0.08, `Masterstroke ${cls} Bleed damage per second at crit ${crit}`);
}
// evolutions: the strikes of each path (poison builds Venom, which raises later hits: not compared)
for (const [cls, evo, stratum] of [['knight', 'fire', 1], ['pyro', 'fire', 1], ['ranger', 'ice', 1], ['ranger', 'lightning', 1], ['cleric', 'holy', 3], ['shade', 'shadow', 1], ['ranger', 'general', 1], ['knight', 'general', 1], ['necro', 'ice', 1]]) {
  const boons = {}; boons['evo_' + evo] = 1;
  const r = weaponRun(cls, 0, boons, { secs: 30, stratum });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.06, `${cls} evolution ${evo} damage per attack`);
}

// Ranger riders and forms: Flurry, the siege bolt and the ricochet on the weapon card (a pack-only extra is left out of the damage on one foe), Gangrene on the skills, Hemorrhage and the pool bursts
for (const [cls, boons, tag] of [['ranger', { r_atk: 1, r_atk_s: 2 }, 'Flurry (Quickdraw rank 2)'], ['ranger', { r_atk: 1, r_atk_s: 3 }, 'Storm Bow'], ['ranger', { r_atk: 1, r_atk_h: 3 }, 'Siege Ballista']]) {
  const r = weaponRun(cls, 0, boons, { secs: 40 });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.05, `${tag} damage per attack on one foe`);
}
{
  const wm = (boons) => modelOf('ranger', boons, 0, { stat: { crit: 0 } }).weapon, ex = (m, l) => m.extras.find(e => e.label === l);
  const q2 = wm({ r_atk: 1, r_atk_s: 2 }), q3 = wm({ r_atk: 1, r_atk_s: 3 }), q1 = wm({ r_atk: 1, r_atk_s: 1 });
  ok(!ex(q1, 'Flurry') && ex(q2, 'Flurry') && ex(q3, 'Flurry') && ex(q3, 'Flurry').perAttack > ex(q2, 'Flurry').perAttack, 'Flurry appears at rank 2 and grows with Storm Bow');
  near(ex(q2, 'Flurry').perAttack, q2.avg * 0.3 * 2 / 4, 1e-6, 'Flurry at rank 2: two arrows at 30% every 4th shot, both on a foe at REF');
  const ric = ex(q3, 'Ricochet'); ok(ric && ric.packOnly && !ex(q2, 'Ricochet'), 'Storm Bow lists a pack-only Ricochet');
  near(q3.dps, (q3.avg * q3.oneFoe + q3.extras.filter(e => !e.packOnly).reduce((s, e) => s + e.perAttack, 0)) * q3.aps, 0.01 * q3.dps, 'a pack-only extra is not in the damage on one foe');
  near(ric.perAttack, q3.avg * 0.4 * 0.8 * (1 + 3 * 0.3 / 4) / 4, 0.05, 'Ricochet: 40% x 0.8 hit rate per shot (and per Flurry arrow at its share), written for a pack of 4');
  const h2 = wm({ r_atk: 1, r_atk_h: 2 }), h3 = wm({ r_atk: 1, r_atk_h: 3 });
  ok(!ex(h2, 'Siege bolt') && ex(h3, 'Siege bolt') && ex(h3, 'Siege blast').packOnly && !ex(h3, 'Siege bolt').packOnly, 'Siege Ballista lists the bolt (one foe) and its blast (pack only)');
  near(ex(h3, 'Siege bolt').perAttack, h3.avg * 0.5 / 5, 1e-6, 'the siege bolt adds x1.5 on every 5th shot');
  const hr = modelOf('ranger', { r_el: 1, r_el_a: 2 }, 0).skills[0], hs = modelOf('ranger', { r_el: 1, r_el_a: 1 }, 0).skills[0];
  ok(hr.dpsCd > hs.dpsCd * 1.1, 'Gangrene raises Volley and Rain (50% at an assumed 50% uptime)');
  const bleedOf = (boons, extra) => modelOf('ranger', Object.assign({ kindle: 1, frostbite: 1 }, boons), 0, extra).mult.status.find(s => s.el === 'general');
  const b2 = bleedOf({ r_el: 1, r_el_a: 2 }), b3 = bleedOf({ r_el: 1, r_el_a: 3 }), bn = bleedOf({ r_el: 1, r_el_a: 3 }, { stat: { hemoAt: 0.9 } });
  ok(!b2.est.pops && b3.est.pops > 0 && b3.est.dps > b2.est.dps * 1.5, 'Hemorrhage adds pops to the Bleed estimate (' + b3.est.pops + ' pops while the reference foe lasts)'); ok(!bn.est.pops && bn.est.dps < b3.est.dps, 'a threshold the pool never reaches adds nothing');
  const pk = (boons) => modelOf('ranger', Object.assign({ kindle: 1 }, boons), 0).weapon.extras;
  const c1 = pk({ r_el: 1, r_el_b: 1 }).find(e => e.label === 'Contagion spread'), c2 = pk({ r_el: 1, r_el_b: 2 }).find(e => e.label === 'Outbreak spread'), c3 = pk({ r_el: 1, r_el_b: 3 });
  ok(c1 && c1.packOnly && c2 && c2.packOnly && c2.perAttack > c1.perAttack * 1.3, 'Contagion and Outbreak list a pack-only spread, Outbreak the larger'); ok(c3.some(e => e.label === 'Plaguebearer burst' && e.packOnly) && !c3.some(e => /spread/.test(e.label)), 'Plaguebearer lists its burst instead of the spread');
  const pb = c3.find(e => e.label === 'Plaguebearer burst'); ok(pb.perAttack > c2.perAttack * 2, 'the burst is worth more than the spread');
}

// ---------------- shield window: the readout equals what addShield granted in the last 10 s ----------------
{
  const { w, p } = stage('knight', {}, 0, {});
  w.addShield(p, 3, 100, 'catch'); w.addShield(p, 2, 100, 'holy');
  let m = sheetOf(w, p);
  near(m.def.window.cls, 3, 0.01, 'shield window, class sources'); near(m.def.window.all, 5, 0.01, 'shield window, all sources');
  near(m.def.window.clsPct, 3 / p.maxHp, 1e-6, 'shield window as a share of max health');
  run(w, 11);
  m = sheetOf(w, p); near(m.def.window.all, 0, 0.001, 'the window empties after 10 s');
}

// ---------------- defence and the foes that spawn now ----------------
for (const [stratum, pact, dark, party, boons] of [[1, 0, false, 1, {}], [3, 2, true, 1, { plating: 2, evade: 0 }], [4, 8, true, 1, { mending: 2 }], [6, 10, false, 2, { edge: 1 }], [2, 4, true, 1, { glass: 1, stalwart: 2 }]]) {
  const { w, p } = stage('knight', boons, 0, {});
  w.pact = pact; w.recalc(p, true); w.enterStratum(stratum); w.room.dark = dark;
  if (party > 1) w.addPlayer({ pid: 'p1', name: 'B', slot: 1, cls: 'ranger', weapon: 'longbow', meta: META() });
  w.enemies.length = 0; w.enc = null; w.locked = false;
  const tag = `stratum ${stratum} pact ${pact} dark ${dark} party ${party}`, m = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true });
  const e = w.spawnEnemy('skeleton', p.x + 80, p.y), e2 = w.spawnEnemy('frozenskel', p.x + 90, p.y);
  rel(e.dmg / ED.ENEMIES.skeleton.dmg, m.def.foeHere, 1e-9, `foes that spawn now hit (${tag})`);
  rel(e2.hp, m.ref.hp, 1e-9, `reference foe health (${tag})`); rel(e2.hp / e2.hpLever, m.ref.statusHp, 1e-9, `reference foe status health (${tag})`);
  p.hp = p.maxHp; p.invuln = 0; w.hurtPlayer(p, 100, { hazard: true }); near(p.maxHp - p.hp, Math.max(1, Math.round(100 * m.def.taken)), 1, `damage taken from a 100 hit (${tag})`);
  p.hp = 1; const got = w.healPlayer(p, 10, true); rel(got, 10 * m.def.healMul, 1e-9, `healing received (${tag})`);
  ok(m.ctx.dark === dark && (m.def.foeParts.dark === null) === !dark, `dark-room flag of the sheet (${tag})`);
  ok(m.def.maxHp === p.maxHp && m.def.ehp > 0, `max health (${tag})`);
}

// ---------------- statuses on a foe of the reference health: the payoffs the estimates promise (weapon damage only, no crit) ----------------
function statusRun(boons, stratum, secs, until) {
  const { w, p, e } = stage('ranger', boons, 0, {});
  w.stratum = stratum;
  const m0 = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true }), ref = m0.ref;
  e.maxHp = e.hp = ref.hp; e.hpLever = ref.hp / ref.statusHp; // a foe of the reference health; the pin below keeps it alive unless the payoff is a kill
  let next = 0, t = null;
  for (let i = 0; i < secs * 60; i++) {
    if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); }
    w.update(1 / 60);
    if (until === 'freeze' && e.frozen > 0) { t = w.time; break; }
    if (until === 'venom' && e.venom >= 100) { t = w.time; break; }
    if (until === 'reap' && e.hp <= 0) { t = w.time; break; }
    if (until !== 'reap') e.hp = e.maxHp;
  }
  return { w, p, e, m0, t, ref };
}
{
  const r = statusRun({ frostbite: 1 }, 6, 12, 'freeze'), st = r.p.stats, pow = 1 + st.statusPow; // stratum VI: a reference foe of 230 health takes several hits to freeze
  const rate = r.m0.proc.split.weapon * st.iceInfuse * pow / r.ref.statusHp * C.CHILL_K * (1 + st.chillMul) * ED.elemMul(6, 'ice');
  ok(r.t !== null && Math.abs(r.t - 100 / rate) <= 100 / rate * 0.15 + 0.35, `time to freeze a reference foe ${r.t && r.t.toFixed(2)} s vs ${(100 / rate).toFixed(2)} s from the weapon`);
  const est = r.m0.mult.status.find(s => s.el === 'ice').est; ok(est.secs > 0 && est.secs <= 100 / rate + 1e-9, 'Ice estimate counts the skills on top of the weapon');
}
{
  const r = statusRun({ envenom: 1 }, 6, 16, 'venom'), st = r.p.stats, pow = 1 + st.statusPow;
  const rate = r.m0.proc.split.weapon * st.poisonInfuse * pow / r.ref.statusHp * C.VENOM_K * (1 + st.venomBuild) * ED.elemMul(6, 'poison');
  ok(r.t !== null && Math.abs(r.t - 100 / rate) <= 100 / rate * 0.15 + 0.35, `time to full Venom ${r.t && r.t.toFixed(2)} s vs ${(100 / rate).toFixed(2)} s from the weapon`);
}
{
  const r = statusRun({ staticcharge: 1, highvoltage: 2 }, 1, 20, null); // the discharge damage per second on one foe
  const st = r.p.stats, dps = hits.filter(h => h.kind === 'chain' && h.t > 6).reduce((s, h) => s + h.dealt, 0) / (r.w.time - 6), want = r.m0.proc.split.weapon * st.lightningInfuse * (1 + st.shockMul);
  rel(dps, want, 0.08, 'Charge: discharge damage per second on one foe');
}
{
  const r = statusRun({ consecrate: 1, zealotry: 2 }, 3, 20, null); // Smite damage per second (Holy is neutral in stratum III)
  const st = r.p.stats, dps = hits.filter(h => h.kind === 'smite').reduce((s, h) => s + h.dealt, 0) / r.w.time, want = r.m0.proc.split.weapon * st.holyInfuse * (1 + st.smiteMul);
  rel(dps, want, 0.1, 'Radiance: Smite damage per second on one foe');
}
{
  const r = statusRun({ doommark: 1, malignance: 2 }, 3, 40, 'reap'), st = r.p.stats; // Shadow is neutral in stratum III
  const dealt = hits.filter(h => h.kind !== 'dot' || !h.raw).reduce((s, h) => s + h.dealt, 0), i = st.shadowInfuse * (1 + st.doomMul);
  ok(r.t !== null && Math.abs(dealt / r.ref.hp - 1 / (1 + i)) <= 0.12, `Doom: a foe is Reaped after ${(dealt / r.ref.hp * 100).toFixed(0)}% of its health, modelled ${(100 / (1 + i)).toFixed(0)}%`);
}

// ---------------- Burn: a Kindle hero's pool drains into the damage the model predicts ----------------
{
  const { w, p } = stage('ranger', { kindle: 1, stoke: 1 }, 0, null, null, REF.d);
  const m = sheetOf(w, p);
  let next = 0;
  run(w, 30, () => { if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); } });
  const burn = hits.filter(h => h.raw && h.kind === 'dot' && h.el === 'fire' && h.t > 10).reduce((s, h) => s + h.dealt, 0) / (w.time - 10);
  const st = m.mult.status.find(s => s.el === 'fire');
  const want = m.proc.split.weapon * p.stats.fireInfuse * (1 + p.stats.burnMul); // the weapon's share of the model's Burn input (this run casts no skills)
  ok(st && Math.abs(burn - want) <= want * 0.08, `Burn damage per second ${burn.toFixed(1)} vs modelled ${want.toFixed(1)}`);
  ok(st && Math.abs(st.est.dps - (m.proc.split.weapon + m.proc.split.skills) * p.stats.fireInfuse * (1 + p.stats.burnMul)) <= 0.01, 'Burn estimate follows the damage that feeds it');
}

// ---------------- Knight Attack and Element forms in the model ----------------
{
  const K = (boons, stratum) => modelOf('knight', Object.assign({ edge: 2, quick: 2, focus: 1, stalwart: 1, kindle: 1, frostbite: 1 }, boons), 0, { ctx: { stratum: stratum || 3 } });
  const ex = (m, label) => m.weapon.extras.find(e => e.label === label);
  { // Earthsplitter: a fissure per Cleave (every 3rd swing), Thousand Edges: a blade wave per Cleave
    const h2 = K({ k_atk: 1, k_atk_h: 2 }), h3 = K({ k_atk: 1, k_atk_h: 3 }), fis = ED.BOONS.k_atk_h.r3.fissure;
    ok(!ex(h2, 'Fissure') && ex(h3, 'Fissure') && ex(h3, 'Cleave').note.indexOf('3rd swing') >= 0 && ex(h2, 'Cleave').note.indexOf('3rd swing') >= 0, 'Earthsplitter: a Fissure extra at rank 3 only, the Cleave stays every 3rd swing');
    rel(ex(h3, 'Fissure').perAttack, h3.weapon.hit * fis / 3, 0.01, 'Fissure damage per attack = weapon hit x fissure / 3');
    const s2 = K({ k_atk: 1, k_atk_s: 2 }), s3 = K({ k_atk: 1, k_atk_s: 3 });
    ok(!ex(s2, 'Blade wave') && ex(s3, 'Blade wave'), 'Thousand Edges: a Blade wave extra at rank 3 only');
    rel(ex(s3, 'Blade wave').perAttack, s3.weapon.avg * ED.BOONS.k_atk_s.r3.bladeWave / 3, 0.01, 'Blade wave per attack = weapon avg x bladeWave / 3');
  }
  { // Doombrand: an extra on the weapon, the Mark in the debuffs, Brand's cap in the condition row; none at rank 2
    const b2 = K({ k_el: 1, k_el_a: 2 }), b3 = K({ k_el: 1, k_el_a: 3 }), d = ex(b3, 'Doombrand');
    ok(!ex(b2, 'Doombrand') && d && d.perAttack > 0 && b3.weapon.dps > b2.weapon.dps, 'Doombrand adds a weapon extra and raises the damage per second; none at rank 2');
    ok(b3.mult.debuffs.some(x => x.id === 'marked' && x.name === 'Marked' && x.text.indexOf('Doombrand') >= 0) && !b2.mult.debuffs.some(x => x.id === 'marked'), 'the Mark is listed with the debuffs at rank 3');
    ok(b3.mult.cond.find(x => x.id === 'brand').label.indexOf('up to 6') >= 0 && b2.mult.cond.find(x => x.id === 'brand').label.indexOf('up to 4') >= 0, "Brand's condition row names its cap per rank");
    const lo = K({ k_el: 1, k_el_a: 3 }), hi = modelOf('knight', { edge: 2, quick: 2, focus: 1, stalwart: 1, kindle: 1, frostbite: 1, k_el: 1, k_el_a: 3 }, 0, { ctx: { stratum: 3 }, stat: { brandMark: ED.BOONS.k_el_a.r3.brandMark * 2 } });
    ok(hi.weapon.dps > lo.weapon.dps, 'a stronger Mark raises the Doombrand extra');
  }
  { // Bloodquake: the payout multiplier raises the Shield Throw's damage on one foe, a part for packs on top; the pack burst follows bloodquakeSplash
    const r2 = K({ k_el: 1, k_el_b: 2 }), r3 = K({ k_el: 1, k_el_b: 3 }), q = r3.skills[1].parts.find(x => x.id === 'bloodquake');
    ok(!r2.skills[1].parts.some(x => x.id === 'bloodquake') && q && q.oneFoe === 0 && q.r === 80, 'Bloodquake adds a part with no hit of its own on one foe, none at rank 2');
    rel(q.here, 2.5 * r3.proc.bleed * (1 + ED.BOONS.k_el_b.r3.bloodquakeMul), 1e-6, 'the Bloodquake payout is the Bleed pool (2.5 s of income) x (1 + bloodquakeMul)');
    const mid = { edge: 2, quick: 2, focus: 1, stalwart: 1, kindle: 1, frostbite: 1, k_el: 1, k_el_b: 3 }, part = (stat) => modelOf('knight', mid, 0, { ctx: { stratum: 3 }, stat }).skills[1].parts.find(x => x.id === 'bloodquake'), lo = part({ bloodquakeSplash: 0.1 }), hi = part({ bloodquakeSplash: 0.3 }), one = (stat) => modelOf('knight', mid, 0, { ctx: { stratum: 3 }, stat }).skills[1].perCast;
    ok(hi._r.total > lo._r.total && lo._r.total > 0, 'the pack burst follows bloodquakeSplash');
    ok(one({ bloodquakeMul: 2 }) > one({ bloodquakeMul: 1 }) && one({ bloodquakeMul: 1 }) > one({ bloodquake: 0 }) && one({ bloodquakeSplash: 0.1 }) === one({ bloodquakeSplash: 0.9 }), 'on one foe only bloodquakeMul counts: the Throw deals more with it, the splash adds nothing');
    ok(modelOf('knight', { k_el: 1, k_el_b: 3 }, 0).skills[1].parts.find(x => x.id === 'bloodquake')._r.total === 0, 'a build with fewer than 3 ailment sources never detonates');
  }
}

// ---------------- Cleric Attack and Element forms in the model ----------------
{
  const MIDC = { consecrate: 1, frostbite: 1, edge: 2, quick: 2, focus: 1, stalwart: 1 };
  const Cm = (boons, o) => modelOf('cleric', Object.assign({}, MIDC, boons), 0, { ctx: { stratum: (o && o.stratum) || 4 }, stat: Object.assign({ crit: 0 }, o && o.stat) });
  const ex = (m, label) => m.weapon.extras.find(e => e.label === label), sec = (m, label) => ex(m, label).perAttack * m.weapon.aps;
  const heroOf = (boons, stat) => { const b = { cls: 'cleric', weapon: ED.CLASSES.cleric.weapons[0], boons: Object.assign({}, MIDC, boons), relics: [], meta: META(), pact: 0 }, stats = ED.Stats.compute(b); Object.assign(stats, { crit: 0 }, stat); stats.sn = {}; return { pid: 'p', name: 'T', cls: 'cleric', weapon: b.weapon, boons: b.boons, relics: [], meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 }; };
  const MD = require('./model.js')(ED, { pack: 4 });
  const holy = (m) => m.mult.status.find(s => s.el === 'holy').est;
  { // Solar Flare (rank 2) and Dawn's Wake (rank 3) of Sunhammer: pieces of the wave, kept apart from the pack-only extras
    const h1 = Cm({ c_atk: 1, c_atk_h: 1 }), h2 = Cm({ c_atk: 1, c_atk_h: 2 }), h3 = Cm({ c_atk: 1, c_atk_h: 3 }), wol = (m) => ex(m, 'Wave of light').perAttack;
    ok(!ex(h1, 'Solar Flare') && ex(h2, 'Solar Flare') && ex(h3, 'Solar Flare') && !ex(h2, "Dawn's Wake") && ex(h3, "Dawn's Wake"), 'Sunhammer lists Solar Flare from rank 2 and Dawn’s Wake at rank 3 only');
    rel(ex(h2, 'Solar Flare').perAttack, wol(h2) * 0.8 * 0.3, 1e-6, 'Solar Flare = wave x waveBurst (0.8) x 0.3 (the share of waves whose burst catches a foe)');
    rel(ex(h3, "Dawn's Wake").perAttack, wol(h3) * 0.6 * 1.5 * ED.affC(4, 'holy'), 1e-6, "Dawn's Wake = wave x wake (0.6) x 1.5 s on the strip x the Holy class affinity (no crit)");
    ok(!ex(h3, 'Solar Flare').packOnly && !ex(h3, "Dawn's Wake").packOnly && ex(h3, "Dawn's Wake").radiance > 0, 'both count on one foe; the strip also stores Radiance');
    const w0 = Cm({ c_atk: 1, c_atk_h: 3 }, { stat: { wake: 0 } });
    ok(h3.proc.rate.holy > w0.proc.rate.holy && Math.abs(h3.proc.rate.holy - w0.proc.rate.holy - ex(h3, "Dawn's Wake").radiance * h3.weapon.aps) < 1e-6, 'the strip adds a quarter of its raw damage to the Radiance income');
    rel(MD.packWeapon(h3, 4) - MD.packWeapon(w0, 4), ex(h3, "Dawn's Wake").perAttack * 2 * h3.weapon.aps, 1e-6, 'in a pack of 4 the strip (and the burst) catch about 2 foes');
    rel(MD.packWeapon(h2, 4) - MD.packWeapon(Cm({ c_atk: 1, c_atk_h: 2 }, { stat: { waveBurst: 0 } }), 4), ex(h2, 'Solar Flare').perAttack * 2 * h2.weapon.aps, 1e-6, 'a Solar Flare burst catches about 2 foes of a pack');
  }
  { // Litany (rank 2) and Returning Light (rank 3) of Crusader: two side waves per Litany attacks, a second pass at waveReturn
    const s1 = Cm({ c_atk: 1, c_atk_s: 1 }), s2 = Cm({ c_atk: 1, c_atk_s: 2 }), s3 = Cm({ c_atk: 1, c_atk_s: 3 }), wol = (m) => ex(m, 'Wave of light').perAttack;
    ok(!ex(s1, 'Litany') && ex(s2, 'Litany') && !ex(s2, 'Returning Light') && ex(s3, 'Returning Light') && ex(s3, 'Litany'), 'Crusader lists Litany from rank 2 and Returning Light at rank 3 only');
    rel(ex(s2, 'Litany').perAttack, wol(s2) * 2 * 2 / 16, 1e-6, 'Litany = 2 extra waves (a wave comes every 2nd attack) every 16th attack');
    rel(ex(s3, 'Returning Light').perAttack, wol(s3) * 0.5 * 0.75, 1e-6, 'Returning Light = wave x waveReturn (0.5) x 0.75 (foes on the way back)');
    rel(ex(s3, 'Litany').perAttack, wol(s3) * 2 * 2 / 16 * (1 + 0.5 * 0.75), 1e-6, 'the Litany side waves return too');
    ok(s3.weapon.dps > s2.weapon.dps && s2.weapon.dps > s1.weapon.dps, 'each rank raises the weapon damage per second');
  }
  { // Judging Light (rank 2) and Sunstrike (rank 3) of Guardian Light: a Judged window on the model's condition factor, extras on the one Smite stream
    const g1 = Cm({ c_el: 1, c_el_a: 1 }), g2 = Cm({ c_el: 1, c_el_a: 2 }), g3 = Cm({ c_el: 1, c_el_a: 3 }), S = (m) => holy(m).dps;
    ok(ex(g1, 'Heavy Smites') && ex(g2, 'Heavy Smites') && !ex(g2, 'Sunstrike') && ex(g3, 'Sunstrike') && !ex(g3, 'Sunstrike').packOnly, 'Guardian Light lists Heavy Smites and, at rank 3, Sunstrike (one foe)');
    rel(sec(g1, 'Heavy Smites'), S(g1) * 0.5 * 0.6, 1e-6, 'Heavy Smites = the Smite stream x smiteBig (0.5) x 0.6 (the share that lands on elites and bosses)');
    rel(sec(g3, 'Sunstrike'), S(g3) * 0.7 * (4 - 1) / 3, 1e-6, 'Sunstrike = the Smite stream x 0.7 (foes taking 3+ Smites) x (4 - 1) / 3');
    rel(MD.packWeapon(g3, 4) - MD.packWeapon(Cm({ c_el: 1, c_el_a: 3 }, { stat: { sunstrike: 0 } }), 4), ex(g3, 'Sunstrike').perAttack * g3.weapon.aps, 1e-6, 'Sunstrike and Heavy Smites ride the one Smite stream: nothing more in a pack');
    const k = (boons, stat) => { const p = heroOf(boons, stat), m = ED.Sheet.compute(p, { stratum: 4, pact: 0, gold: 0, level: 5, xp: 0, xpNext: 100, dark: false, allyNear: 0, minions: 0, room: null, party: 1, rooms: { seen: 1, total: 10, darkTotal: 2, darkLeft: 2 }, heroes: [], time: 0 }, { raw: true, numbers: true }); return MD.condFactor(p, m, MD.defence(p, m)); };
    const cd = ED.Stats.skillNums('judgment', heroOf({ c_el: 1, c_el_a: 2 }).stats).cdEff, jl = 1 + 0.2 * 0.75 * (1 - Math.min(1, 4 / cd) * 0.8);
    rel(k({ c_el: 1, c_el_a: 2 }) / k({ c_el: 1, c_el_a: 2 }, { smiteJudge: 0 }), jl, 1e-6, 'Judging Light multiplies hero damage by 1 + 20% x 0.75 x the time Judgment leaves uncovered');
    ok(k({ c_el: 1, c_el_a: 2 }, { smiteJudge: 0 }) > k({ c_el: 1, c_el_a: 2 }, { smiteJudge: 0, guardLight: 0 }), 'Guardian Light’s own damage buff counts in the condition factor');
    ok(g2.mult.debuffs.some(d => d.id === 'judged' && /Smites Judge their foe for 3 s/.test(d.text)) && !g1.mult.debuffs.some(d => /Smites Judge/.test(d.text)), 'the Judged debuff names the Smites from rank 2');
    ok(/Sunstrike/.test(g3.def.shields.find(x => x.label === 'Holy Smite').text) && !/Sunstrike/.test(g2.def.shields.find(x => x.label === 'Holy Smite').text), 'the Holy Smite shield names the Sunstrike from rank 3');
  }
  { // Sunburst (rank 2) and Spectrum (rank 3) of Prism: pack-only extras per foe of a pack of 4
    const p1 = Cm({ c_el: 1, c_el_b: 1 }), p2 = Cm({ c_el: 1, c_el_b: 2 }), p3 = Cm({ c_el: 1, c_el_b: 3 }), S = (m) => holy(m).dps, mul = (m) => m.weapon.extras.find(e => e.label === 'Prism beam');
    ok(mul(p1).packOnly && !ex(p1, 'Sunburst') && ex(p2, 'Sunburst').packOnly && !ex(p2, 'Spectrum') && ex(p3, 'Spectrum').packOnly, 'Prism lists its beam (pack only), Sunburst from rank 2 and Spectrum at rank 3');
    rel(sec(p1, 'Prism beam'), S(p1) * 0.5, 1e-6, 'Prism beam = the Smite stream x smiteBeam (0.5)'); rel(sec(p2, 'Sunburst'), S(p2) * 0.5 * 0.5, 1e-6, 'Sunburst = one more hop at half a beam');
    rel(sec(p3, 'Spectrum'), S(p3) * 0.5 * 2 + S(p3) * 0.05 * (1 + 0.5) * 3, 1e-6, 'Spectrum = 2 more beams (3 others in a pack of 4) + 5% of a Smite as Radiance in each of 3 foes, paid back at 1 + smiteMul');
    rel(p3.weapon.dps, (p3.weapon.avg * p3.weapon.oneFoe + p3.weapon.extras.filter(e => !e.packOnly).reduce((s, e) => s + e.perAttack, 0)) * p3.weapon.aps, 0.01, 'the beams are left out of the damage on one foe');
    ok(MD.packWeapon(p3, 4) - MD.packWeapon(Cm({ c_el: 1, c_el_b: 3 }, { stat: { prismN: 0 } }), 4) > 3 * sec(p3, 'Spectrum') * 0.99, 'in a pack every foe of the 4 beams to the others (x4)');
    const lone = Cm({ c_atk: 1, c_el: 1, c_el_b: 3 }, { stat: { smiteBeam: 0 } }); ok(!ex(lone, 'Prism beam') && !ex(lone, 'Spectrum'), 'no beam, no Spectrum extra without the Prism beam');
  }
  { // the band: each attack and element fork stays inside the Power budget at strata IV and VI (rank 2 near +35%, rank 3 near +60% over the class without the card, mean of one foe and a pack of 4)
    const base = (s) => { const p = heroOf({}), m = ED.Sheet.compute(p, CTX({ stratum: s }), { raw: true, numbers: true }), d = MD.defence(p, m), k = MD.condFactor(p, m, d); return [MD.heroDamage(m, 1, k), MD.heroDamage(m, 4, k, MD.echoK(p, m, 4))]; };
    const mean = (boons, s) => { const p = heroOf(boons), m = ED.Sheet.compute(p, CTX({ stratum: s }), { raw: true, numbers: true }), d = MD.defence(p, m), k = MD.condFactor(p, m, d), b = base(s); return (MD.heroDamage(m, 1, k) / b[0] + MD.heroDamage(m, 4, k, MD.echoK(p, m, 4)) / b[1]) / 2 - 1; };
    for (const s of [4, 6]) for (const [t1, fork] of [['c_atk', 'c_atk_h'], ['c_atk', 'c_atk_s'], ['c_el', 'c_el_a'], ['c_el', 'c_el_b']]) {
      const r2 = mean({ [t1]: 1, [fork]: 2 }, s), r3 = mean({ [t1]: 1, [fork]: 3 }, s);
      ok(r2 > 0.25 && r2 < 0.45, `${fork} rank 2 at stratum ${s}: +${(r2 * 100).toFixed(0)}% (band 25 to 45)`); ok(r3 > 0.5 && r3 < 0.7, `${fork} rank 3 at stratum ${s}: +${(r3 * 100).toFixed(0)}% (band 50 to 70)`);
    }
  }
}

// the sheet shows the shield the way the HUD does (rounded up), so the host and a client reading the snapshot agree
{ const m = modelOf('knight', {}, 0, { shield: 2.4 }); ok(m.def.shield === 3 && m.hero.shield === 3, `shield 2.4 reads ${m.def.shield} (defence) and ${m.hero.shield} (header), want 3`); }

W.hitEnemy = oHit; W.updateEnemy = oUpd;
console.log(`${n} checks, ${fails} failed` + (pend ? `, ${pend} pending (class routes still to be built by their streams)` : ''));
process.exit(fails ? 1 : 0);
