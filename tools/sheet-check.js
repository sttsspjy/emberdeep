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
    knight: [23.4, 24.2775, 2.381, 57.8, 0.5085], ranger: [11, 11.825, 2.941, 34.78, 0.9524], pyro: [9, 9.3375, 2.5, 23.344, 0.9375], shade: [11, 11.99, 4.762, 57.1, 0.6818], cleric: [23, 23.8625, 2.381, 73.86, 0.75], necro: [13.5, 14.0063, 2.5, 35.02, 1],
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
  near(by(modelOf('knight', {}, 0, { stat: { crit: 0 } }), 0, 'impact').raw, 63.44, 0.05, 'Charge impact'); near(modelOf('knight', {}, 0).def.ehp, 62.93, 0.5, 'Knight effective health');
  const rg = modelOf('ranger', {}, 0, { stat: { crit: 0 } }), arrow = by(rg, 0, 'arrow');
  near(arrow.raw, 18.4, 0.05, 'Volley arrow'); ok(arrow.oneFoe === 3 && arrow.fanN === 7, `Volley: 3 of 7 arrows reach a foe at REF (got ${arrow.oneFoe} of ${arrow.fanN})`);
  near(rg.skills[0].perCast, 55.2, 0.1, 'Volley per cast on one foe'); near(rg.skills[0].perCastAll, 128.8, 0.1, 'Volley per cast, all 7'); near(rg.skills[1].perCast, 75.2, 0.1, 'Rain per cast (9.4 x 8)');
  const py = modelOf('pyro', {}, 0, { stat: { crit: 0 } });
  ok(!py.weapon.extras.length, 'Fire Staff: plain bolts, no extras'); near(by(py, 0, 'blast').raw, 48.6, 0.05, 'Nova blast'); near(by(py, 0, 'burn').raw, 28.4, 0.05, 'Nova burn add'); near(by(py, 1, 'impact').raw, 73.6, 0.05, 'Meteor impact');
  near(by(py, 1, 'crater').here * by(py, 1, 'crater').oneFoe, 48.6, 0.1, 'Meteor crater, 6 ticks'); near(by(py, 2, 'burst').raw, 29, 0.05, 'Fireball burst');
  ok(py.skills[2].key === 'skill3' && py.skills[2].charges === 2, 'Fireball: the skill 3 card with 2 charges');
  const sh = modelOf('shade', {}, 0, { stat: { crit: 0 } });
  near(by(sh, 0, 'slash').raw, 55, 0.05, 'Shadowstep'); near(by(sh, 0, 'slash').avg, 96.25, 0.05, 'Shadowstep always crits'); near(by(sh, 1, 'ambush').avg, 77, 0.05, 'Ambush');
  const cl = modelOf('cleric', {}, 0, { stat: { crit: 0 }, ctx: { stratum: 3 } }), leg = by(cl, 1, 'leg');
  near(leg.pre, 72.6, 0.05, 'Judgment leg with its own vulnerability'); near(cl.skills[1].perCast, 145.2, 0.1, 'Judgment per cast (two legs)'); near(by(cl, 0, 'zone').here * 7, 165.2, 0.1, 'Sanctuary 7 ticks');
  const nc = modelOf('necro', {}, 0, { stat: { crit: 0 } }), mn = by(nc, 0, 'minion');
  near(mn.here, 14.535, 0.01, 'Minion hit'); ok(mn.oneFoe === 51, `Minions: 3 x 17 hits (got ${mn.oneFoe})`); near(by(nc, 1, 'burst').raw, 67, 0.05, 'Harvest burst');
  // Set 2: Stoke x1 (+burnMul Burn), Kindle, stratum III (no stratum is weak or resists: affinity x1), crit 5%.
  const e2 = modelOf('pyro', { stoke: 1, kindle: 1 }, 0, { ctx: { stratum: 3 }, stat: { crit: 0.05 } });
  near(e2.mult.dmg.total, 1, 1e-9, 'Set 2 damage'); near(by(e2, 0, 'blast').here, 48.6 * (1 + 0.05 * 0.75), 0.05, 'Set 2 Nova blast');
  const sk = 1 + ED.BOONS.stoke.mods.burnMul;
  near(by(e2, 0, 'burn').here, 28.4 * sk, 0.05, 'Set 2 Nova burn (Burn strength)');
  near(by(e2, 1, 'impact').statusAdd.here, 0.5 * by(e2, 1, 'impact').pre * sk, 0.05, 'Set 2 Meteor burn add');
  near(by(e2, 1, 'crater').here * by(e2, 1, 'crater').oneFoe, 6 * 8.1, 0.1, 'Set 2 crater, 6 ticks');
}

// every ED.SKILL_SHEET key names a part that exists (a renamed part would silently lose its oneFoe, selfVuln or infAdd)
for (const key in ED.SKILL_SHEET) { const [sid, pid] = key.split('.'); ok(ED.SKILLS[sid] && ED.SKILLS[sid].parts.some(q => q.id === pid), 'ED.SKILL_SHEET key ' + key + ' resolves to a skill part'); }

// ---------------- text at rank: every boon renders without a left-over token, numbers follow the rank ----------------
{
  const st = ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 });
  let bad = 0;
  for (const id of ED.BOON_IDS) { const b = ED.BOONS[id]; for (let r = 1; r <= (b.max || 5) + 1; r++) { const t = ED.Sheet.text(id, r, st); if (!t || /[{}\[\]]/.test(t)) { bad++; console.log('FAIL boon text ' + id + ' rank ' + r + ': ' + t); } } }
  ok(bad === 0, 'boon texts resolve at every rank');
  ok(ED.Sheet.text('focus', 1, st) === 'Skills recharge 10% faster.' && ED.Sheet.text('focus', 2, st) === 'Skills recharge 20% faster.', 'Focus text follows the rank');
  ok(ED.Sheet.text('b_s2_b', 1, st).indexOf('0.5% max health') >= 0 && ED.Sheet.text('b_s2_b', 1, st).indexOf('up to 2%') >= 0, 'small percentages keep their decimals');
  ok(ED.Sheet.text('k_atk_h', 3, st).indexOf('Follow-Through') >= 0, 'class cards render through boonText');
  // every number a token prints equals the stat the boon adds
  for (const id of ED.BOON_IDS) { const b = ED.BOONS[id]; if (b.route || !b.mods) continue; for (const k in b.mods) { const m = new RegExp('\\{' + k + '(\\*[^}:]+)?(:\\w+)?\\}').exec(b.desc); if (m && !m[1] && b.mods[k] !== 0) ok(ED.Sheet.text(id, 1, st).indexOf(ED.Sheet.fmt(k, Math.abs(b.mods[k]), m[2] && m[2].slice(1))) >= 0, 'token ' + k + ' of ' + id); } }
}

// ---------------- next rank, seconds, plurals, statuses and forks in the model ----------------
{
  const st = ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 }), S = ED.Sheet;
  ok(S.nextText('focus', 1, st) === '20% faster', 'Next rank lists only the changed number: ' + S.nextText('focus', 1, st));
  { const rows = [].concat(...modelOf('knight', { plating: 2, focus: 1 }, 0).build.groups.map(g => g.items)); ok(rows.find(x => x.id === 'plating').next === null && rows.find(x => x.id === 'focus').next === '20% faster', 'only a card below its last rank has a Next rank line'); }
  { // no Next-rank piece is a bare number: it names what changes
    let bare = 0;
    for (const id of ED.BOON_IDS) { const b = ED.BOONS[id]; for (let r = 1; r < (b.max || 1); r++) for (const piece of S.nextText(id, r, st).split(' · ')) if (!/[A-Za-z]{3,}/.test(piece.replace(/\d+(?:\.\d+)?\s?s\b/g, ''))) { bare++; console.log(`FAIL bare next-rank piece ${id} rank ${r}: "${piece}"`); } }
    ok(bare === 0, 'Next rank lines are never bare numbers');
    ok(S.nextText('k_s1_a', 1, st) === 'deals +16% · 41% of its impact · unlocks Shield Bash' && S.nextText('k_s2_b', 1, st) === 'bash deals +130% · unlocks Return to Sender' && S.nextText('k_s1_a', 2, st).indexOf('unlocks Avalanche') >= 0 && S.nextText('r_s2_b', 2, st).indexOf('unlocks Storm of Thorns') >= 0, 'Juggernaut and Shield Wall name their numbers: ' + S.nextText('k_s1_a', 1, st) + ' / ' + S.nextText('k_s2_b', 1, st));
    ok(S.text('r_el_b', 2, st).indexOf('within 120.') >= 0 && S.text('r_el_b', 3, st).indexOf('within 140') >= 0 && S.nextText('r_el_b', 1, st) === 'foes within 120 · unlocks Outbreak', 'Contagion shows its total radius: ' + S.nextText('r_el_b', 1, st));
    ok(S.nextText('p_s2_b', 1, st) === 'impact (+15%) · Meteor deals +30% · unlocks Impact Crater' && S.nextText('p_s2_b', 2, st) === 'impact (+20%) · Meteor deals +40% · unlocks Sun Dive', 'Comet names what the impact bonus belongs to and what each rank unlocks: ' + S.nextText('p_s2_b', 1, st) + ' / ' + S.nextText('p_s2_b', 2, st));
    ok(['p_s1_a:Collapse:Supernova', 'p_s1_b:Rebirth Flare:Phoenix Form', 'p_s2_a:Meteor Shower:Cataclysm', 's_s1_a:Twin Cut:Death Blossom', 's_s1_b:Lure:Hall of Mirrors', 's_s2_a:Ambush Sweep:Eclipse', 's_s2_b:Shroud:Umbral Veil'].every(x => { const [id, r2, r3] = x.split(':'); return S.nextText(id, 1, st).indexOf('unlocks ' + r2) >= 0 && S.nextText(id, 2, st).indexOf('unlocks ' + r3) >= 0; }), 'the Pyromancer and Shade skill forks name their rank 2 rider and rank 3 transform in the Next rank line');
  }
  ok(S.nextText('k_el_a', 1, st).indexOf('unlocks Ruin Seal') >= 0 && S.nextText('k_el_a', 2, st).indexOf('unlocks Doombrand') >= 0 && S.nextText('k_el_a', 2, st).indexOf('6 ailments') >= 0, 'a route card names the rider it unlocks at rank 2 and the transform at rank 3');
  ok(S.fmt('arcStun', 0.25, 'sec') === '0.25s' && S.fmt('arcStun', 0.5, 'sec') === '0.5s' && S.fmt('chargeHold', 2, 'sec') === '2s' && S.fmt('chargeHold', 12, 'sec') === '12s', 'seconds keep two decimals below 1 s');
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
  if (e._dummy && dealt > 0) hits.push({ part: (src && src.part) || (src && src.ambush ? 'vanish.ambush' : src && src.kind === 'minion' ? 'legion.minion' : undefined), kind: (src && src.kind) || 'weapon', raw: !!(src && src.raw), el: src && (src.el || src.clsEl), bleed: !!(src && src.bleed), wpn: !!(src && src.wpn), dealt, t: this.time, id: e.id });
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
  w.playerSkill(p, a, data || {}, slot);
  if (id === 'bulwark') { p.blocks = 1; w.skillRelease(p, a); } // a raise that stored one blocked attack (the sheet's BW_STORED), then the bash
}

// each case: class, boons/stats that switch parts on, the skill slot, the parts to compare, and what to expect of the hit counts
const GEO = new Set(['bulwark.reflect']); // needs a blocked shot
const PENDING = new Set(['sky', 'sky2', 'shower', 'twin', 'rocks', 'echo', 'after', 'corpse', 'lance', 'flare']); // parts of class routes whose sim side belongs to a class stream
let pend = 0;
const pending = (msg) => { pend++; if (verbose) console.log('pending ' + msg); };
// [class, stat switches, slot, dummy distance (default REF.d)]
const BELL_RES = (w, p) => { run(w, 0.05); p.bellRes = ED.Bell.pealRes(p.stats); }; // a Peal at the mean Resonance the sheet assumes
const CASES = [
  ['knight', {}, 0], ['knight', {}, 1], ['knight', { jugShock: 0.4, s1Range: 90 }, 0], ['knight', { avalanche: 0.9, avaCrack: 0.3, avaStun: 0.8, jugShock: 0.4, s1Range: 90 }, 0], ['knight', { phalanx: 1, bannerDur: 5, bannerSlow: 0.4, bannerWeak: 0.25, bannerDmg: 0.1, braceDR: 0.1 }, 0], ['knight', { tempest: 1, vortexMul: 0.09, vortexDur: 2.5 }, 1], ['knight', { gather: 0.3 }, 1], ['knight', { shieldWall: 1, sendBack: 0.5 }, 1],
  ['ranger', {}, 0], ['ranger', {}, 1], ['ranger', { deathMark: 0.5, deathWave: 0.6 }, 0], ['ranger', { thornburst: 20, thornMul: 3 }, 0], ['ranger', { caltrops: 0.3, thornR: 0 }, 0, 30, false, { skip: ['arrow'] }], ['ranger', { skyfall: 1, starfall: 0.6 }, 1, 160], ['ranger', { thornstorm: 2 }, 1], ['ranger', { rainHail: 1 }, 1], ['ranger', { skyfall: 1 }, 1], ['ranger', { skyTwin: 0.5, skyfall: 1 }, 1], ['ranger', { shower: 0.4, rainHail: 1 }, 1],
  ['pyro', {}, 0], ['pyro', {}, 1], ['pyro', { novaRing: 1 }, 0], ['pyro', { twinMeteor: 0.6 }, 1, 0, true], ['pyro', { comet: 0.3 }, 1],
  ['pyro', { novaEcho: 0.5 }, 0], ['pyro', { novaEcho: 1, supernova: 2, supernovaPull: 30 }, 0], ['pyro', { novaRing: 1, phoenixMul: 2, phoenixDur: 4, dashTrail: 0.5 }, 0], ['pyro', { cataclysm: 0.6 }, 1],
  ['pyro', { comet: 0.2, sunDive: 0.6, diveTrail: 0.3 }, 1, undefined, false, { setup: (w, p, e) => { p.aimX = e.x; p.aimY = e.y; }, skip: ['crater', 'trail'] }],
  ['shade', {}, 0], ['shade', { stepTwin: 0.5 }, 0], ['shade', {}, 1, 28],
  ['shade', { blossom: 0.7, blossomN: 3, blossomMax: 6 }, 0], ['shade', { afterimage: 1, mirrorHall: 1 }, 0, 1],
  ['shade', { eclipse: 0.6, eclipseDur: 4 }, 1, 28, false, { drive: true }], ['shade', { umbral: 2, cloneMul: 0.5 }, 1, 28, false, { drive: true, skip: ['clone'] }], ['shade', { shroud: 1, shroudDmg: 0.3, s2Dur: 2 }, 1, 28],
  ['cleric', {}, 0], ['cleric', {}, 1], ['cleric', { twinHammer: 0.75 }, 1],
  ['cleric', { wrath: 1, wrathNova: 1.5, wrathPillar: 1.2 }, 0], ['cleric', { aura: 1, dawn: 1, aegisR: 40, aegisDR: 0.1, aegisStun: 0.3, aegisMul: 1 }, 0], ['cleric', { storm: 5, stormMul: 0.45, thirdLeg: 1, twinHammer: 0.55, secondFlight: 0.25 }, 1], ['cleric', { verdict: 1, fjEcho: 0.2, fjR: 40, fjStun: 0.6 }, 1],
  ['bell', {}, 0], ['bell', { wrecker: 1, smashStun: 0.6 }, 0, 150], ['bell', { wrecker: 1, wreckSpin: 0.5, spinDur: 1 }, 0, 60, false, { skip: ['spin'] }],
  ['bell', {}, 1, undefined, false, { setup: BELL_RES }], ['bell', { clap: 0.5 }, 1, undefined, false, { setup: BELL_RES, skip: ['clap'] }], ['bell', { pealEcho: 0.5 }, 1, undefined, false, { setup: BELL_RES }], ['bell', { tollN: 3, tollBolt: 0.6, lightningInfuse: 0.3 }, 1, undefined, false, { setup: BELL_RES }],
  ['necro', {}, 0], ['necro', { boneSpikes: 1 }, 0], ['necro', { boneSpikes: 1, bloom: 1, bloomField: 0.5, bloomBomb: 1.2 }, 0], ['necro', { knights: 1, maxMinions: 2, s1N: -2 }, 0], ['necro', { knights: 1, maxMinions: 2, s1N: -2, dk: 1, dkMul: 4.5, dkArc: 2.4, dkTaunt: 120 }, 0],
];
for (const [cls, stat, slot, dist, skipImpact, opt] of CASES) {
  const { w, p, e } = stage(cls, {}, 0, stat, null, dist);
  const id = slot ? ED.CLASSES[cls].skill2 : ED.CLASSES[cls].skill, tag = `${cls}.${id}${Object.keys(stat).length ? '+' + Object.keys(stat).join(',') : ''}`;
  if (opt && opt.setup) opt.setup(w, p, e);
  const m = sheetOf(w, p), sk = m.skills[slot], stack = ED.burnValue(p.stats) * C.BURN_LIFE; // Burn lands in whole stacks: one cast leaves under a stack of build-up unspent
  const near3 = (el, got, want) => el === 'fire' ? got <= want * 1.03 + 0.2 && got > want - stack - 0.2 : Math.abs(got - want) <= want * 0.03 + 0.2;
  cast(w, p, e, slot);
  if (opt && opt.drive) { // Vanish forms: attack through the form's window (the first attack is the Ambush; a tick passes first so the dome's vulnerability is on)
    let next = 0.02; run(w, 0.02);
    run(w, 4.3, () => { if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); } });
  } else if (id === 'vanish') w.playerAttack(p, 0); // the Ambush
  const by = settle(w, e, 20);
  for (const q of sk.parts) {
    if (q.kind === 'zone' || (opt && opt.skip && opt.skip.indexOf(q.id) >= 0)) continue;
    const key = q.kind === 'sec' && !by[id + '.' + q.id] ? 'zone' : id + '.' + q.id, got = by[key]; // zone ticks: by part when the zone carries one
    if (q.kind === 'status') { const s = by['status:' + q.statusEl]; ok(s && near3(q.statusEl, s.sum, q.here), `${tag} ${q.id}: status damage ${s ? s.sum.toFixed(1) : 0} vs ${q.here.toFixed(1)}`); continue; }
    if (q.oneFoe === 0 && !q.fanN) continue; // conditional parts (per minion, per corpse, per kill)
    if (!got && GEO.has(id + '.' + q.id)) continue;
    if (!got) { if (PENDING.has(q.id)) pending(`${tag} ${q.id}: no hit measured`); else ok(false, `${tag} ${q.id}: no hit measured`); continue; }
    if (skipImpact && q.id === 'impact') continue; // the twin meteor shares the impact's part name
    const per = got.sum / got.n;
    rel(per, q.here, 0.015, `${tag} ${q.id} per hit`);
    if (q.kind === 'minion') continue; // minions walk to the foe: the count is reported, not compared
    if (stat.tempest && q.id === 'return') continue; // which of the vortex shields cross the foe on the way home depends on where each spun: the damage per hit is compared, not the count
    ok(q.attacks !== undefined ? Math.abs(got.n - q.oneFoe) <= 1 : got.n === q.oneFoe, `${tag} ${q.id}: ${got.n} ${q.fanN ? 'arrows reached' : 'hits on'} the foe, modelled ${q.oneFoe}${q.attacks !== undefined ? ' (one attack more or less is the timing of the first)' : ''}`);
    if (q.statusAdd) { const s = by['status:' + q.statusAdd.el], want = q.statusAdd.here * q.oneFoe + (skipImpact && q.id === 'twin' ? sk.parts.find(x => x.id === 'impact').statusAdd.here : 0); ok(s && near3(q.statusAdd.el, s.sum, want), `${tag} ${q.id}: status add ${s ? s.sum.toFixed(1) : 0} vs ${want.toFixed(1)}`); } // the twin case measures the impact's Burn add with the twin's
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

{ // Bone Lances: every minion's burst becomes a lance on the foe (the burst part drops out), so a cast pays one lance per minion and no burst
  const { w, p, e } = stage('necro', {}, 0, { boneLance: 0.37 });
  cast(w, p, e, 0); run(w, 0.5); hits.length = 0;
  const m = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true }), k = m.skills[1], lance = k.parts.find(x => x.id === 'lance'), burst = k.parts.find(x => x.id === 'burst');
  ok(burst.oneFoe === 0 && burst._r.total === 0 && lance.oneFoe === 3, `Bone Lances: the burst part drops out, the lance counts one per minion (burst ${burst.oneFoe}, lance ${lance.oneFoe})`);
  near(k.perCast, lance._r.total, 1e-6, 'Bone Lances: the cast is the lances alone');
  cast(w, p, e, 1);
  const by = settle(w, e, 3), got = by['harvest.lance'];
  ok(got && got.n === lance.oneFoe && !by['harvest.burst'], `Bone Lances: ${got ? got.n : 0} lances and ${by['harvest.burst'] ? by['harvest.burst'].n : 0} bursts on the foe, modelled ${lance.oneFoe} and 0`);
  if (got) rel(got.sum / got.n, lance.here, 0.015, 'Bone Lance per hit');
}

// Pack rules of tools/model.js against a tight pack of 4 pinned dummies (the first at the usual place, the others within 24 px of it): the parts that strike every foe of a pack in the sim count n foes in the pack column.
const addPack = (w, p, dist) => [[24, 0], [-12, 21], [-12, -21]].map(([dx, dy]) => { const f = w.spawnEnemy('skeleton', p.x + (dist || REF.d) + dx, p.y - 4 + dy); f._dummy = true; f.spd = 0; f.cd = 1e9; f.r = REF.r; f.hp = f.maxHp = 1e9; f.def = Object.assign({}, f.def, { guard: undefined }); return f; });
const MDp = require('./model.js')(ED, { pack: 4 });
const partPack = (m, k, q, n) => MDp.directDamage({ weapon: { kind: 'melee', _avg: 0, _extras: [], _aps: 1 }, skills: [Object.assign({}, k, { parts: [q], _cd: 1 })], boost: { pack: 0 } }, n);
{ // Twin Cut (Assassinate rank 2) cuts the whole path again: every pack foe the slash cuts; Avalanche cracks strike every carried foe; both count n foes
  const { w, p, e } = stage('shade', {}, 0, { stepTwin: 0.5 }); addPack(w, p);
  const m = sheetOf(w, p), k = m.skills[0], tw = k.parts.find(x => x.id === 'twin'), sl = k.parts.find(x => x.id === 'slash');
  cast(w, p, e, 0); const by = settle(w, e, 3);
  ok(by['step.twin'] && by['step.twin'].n === 4 && by['step.slash'].n === 4, `Twin Cut: ${by['step.twin'] ? by['step.twin'].n : 0} foes of the pack cut again, ${by['step.slash'].n} by the slash`);
  rel(partPack(m, k, tw, 4), by['step.twin'].sum, 0.02, 'Twin Cut in a pack of 4 (pack rule vs measured)'); rel(partPack(m, k, sl, 4), by['step.slash'].sum, 0.02, 'Shadowstep slash in a pack of 4 (pack rule vs measured)');
}
{
  const { w, p, e } = stage('knight', {}, 0, { avalanche: 0.9, avaCrack: 0.3, avaStun: 0.8, jugShock: 0.4, s1Range: 90 }); addPack(w, p);
  const m = sheetOf(w, p), k = m.skills[0], cr = k.parts.find(x => x.id === 'crack');
  cast(w, p, e, 0); const by = settle(w, e, 3);
  ok(by['charge.crack'] && by['charge.crack'].n === 4, `Avalanche: ${by['charge.crack'] ? by['charge.crack'].n : 0} carried foes struck by a crack`);
  rel(partPack(m, k, cr, 4), by['charge.crack'].sum, 0.02, 'Avalanche cracks in a pack of 4 (pack rule vs measured)');
}
{ // Bulwark bash and Shield Bash: the cone strikes every foe of the pack ahead once; both count n foes
  const { w, p, e } = stage('knight', {}, 0, {}, null, 50); addPack(w, p, 50);
  const m = sheetOf(w, p), k = m.skills[1], bq = k.parts.find(x => x.id === 'bash');
  cast(w, p, e, 1); const by = settle(w, e, 3), got = by['bulwark.bash'];
  ok(got && got.n === 4, `Bulwark: ${got ? got.n : 0} foes of the pack bashed`);
  rel(partPack(m, k, bq, 4), got ? got.sum : 0, 0.02, 'Bulwark bash in a pack of 4 (pack rule vs measured)');
  const s = stage('knight', {}, 0, { bash: 0.3 }, null, 60); addPack(s.w, s.p, 60);
  const sm = sheetOf(s.w, s.p), sk = sm.skills[0], bs = sk.parts.find(x => x.id === 'bash');
  s.w.playerSkill(s.p, 0, { x0: s.p.x, y0: s.p.y, x1: s.p.x + 20, y1: s.p.y }, 0); const sb = settle(s.w, s.e, 3)['charge.bash'];
  ok(sb && sb.n === 4, `Shield Bash: ${sb ? sb.n : 0} foes of the pack bashed where the Charge ends`);
  rel(partPack(sm, sk, bs, 4), sb ? sb.sum : 0, 0.02, 'Shield Bash in a pack of 4 (pack rule vs measured)');
}
{ // Meteor Shower: 3 meteorites fall at random within 80 of every impact, the twin's too (2 sets); the model counts the meteorites a lone foe takes (mean of 16 casts) and the burn each leaves
  const { w, p, e } = stage('pyro', {}, 0, { twinMeteor: 0.3, meteorites: 0.18 });
  const q = sheetOf(w, p).skills[1].parts.find(x => x.id === 'rocks');
  let n = 0;
  for (let i = 0; i < 16; i++) { cast(w, p, e, 1); const by = settle(w, e, 4); n += by['meteor.rocks'] ? by['meteor.rocks'].n : 0; hits.length = 0; w.zones.length = 0; }
  ok(q.sets === 2 && Math.abs(n / 16 - q.oneFoe) <= 0.7, `Meteor Shower: ${(n / 16).toFixed(2)} meteorites a cast on a lone foe, modelled ${q.oneFoe.toFixed(2)} (2 sets of 3)`);
  ok(q.statusAdd && q.statusAdd.pool > 0 && sheetOf(w, p).skills[1].parts.find(x => x.id === 'twin').statusAdd.pool > 0, 'Meteor Shower and Twin Meteor add Burn to the model');
}
{ // Rebirth Flare bursts when the Mantle shield is used up, and a Mantle comes at most once per 10 s: a Nova cast every ~5 s pays it in about half of the casts
  const { w, p } = stage('pyro', {}, 0, { mantleBurst: 0.5, mantle: 0.03 });
  const k = sheetOf(w, p).skills[0], fl = k.parts.find(x => x.id === 'flare');
  near(fl.oneFoe, Math.min(1, k.cd / C.MANTLE_CD), 1e-9, `Rebirth Flare counts ${fl.oneFoe.toFixed(2)} bursts per cast (Nova every ${k.cd.toFixed(1)} s, Mantle every ${C.MANTLE_CD} s)`);
  ok(fl.oneFoe > 0.3 && fl.oneFoe < 1, 'Rebirth Flare is a share of a burst per cast');
}

{ // Ambush Sweep: a fan of knives strikes at most 3 foes of a pack; the sweep (every foe within ambushCleave of the target) reaches the rest, and the pack rule of tools/model.js counts it (a melee Ambush already strikes the whole pack)
  const MDs = require('./model.js')(ED, { pack: 4 });
  const packAmb = (cls, wi, cleave) => {
    const { w, p } = stage(cls, {}, wi, { ambushCleave: cleave }, null, 28);
    const spare = [[24, 0], [-12, 21], [-12, -21]].map(([dx, dy]) => { const f = w.spawnEnemy('skeleton', p.x + 28 + dx, p.y - 4 + dy); f._dummy = true; f.spd = 0; f.cd = 1e9; f.r = REF.r; f.hp = f.maxHp = 1e9; f.def = Object.assign({}, f.def, { guard: undefined }); return f; });
    const first = w.enemies.find(f => f._dummy && !spare.includes(f));
    w.playerSkill(p, Math.atan2(first.y - (p.y - 4), first.x - p.x), {}, 1); w.playerAttack(p, Math.atan2(first.y - (p.y - 4), first.x - p.x));
    run(w, 2);
    const m = sheetOf(w, p), q = m.skills[1].parts.find(x => x.id === 'ambush');
    return { foes: new Set(hits.filter(h => h.part === 'vanish.ambush' || h.part === 'vanish.sweep').map(h => h.id)).size, pack: MDs.directDamage({ weapon: { kind: m.weapon.kind, _avg: 0, _extras: [], _aps: 1, n: m.weapon.n, pierce: m.weapon.pierce }, skills: [Object.assign({}, m.skills[1], { parts: [q], _cd: 1 })], boost: { pack: 0 } }, 4) / q._r.total, sweepR: q.sweepR };
  };
  const k0 = packAmb('shade', 1, 0), k1 = packAmb('shade', 1, 70), d1 = packAmb('shade', 0, 70);
  ok(k0.foes <= 3 && k1.foes === 4, `Ambush Sweep: knives strike ${k0.foes} foes of the pack, with the sweep ${k1.foes}`);
  ok(k1.sweepR === 70 && k0.pack === 3 && k1.pack > k0.pack && k1.pack <= 4, `Ambush Sweep: the pack rule counts ${k0.pack} foes without the sweep and ${k1.pack.toFixed(2)} with it (knives)`);
  ok(d1.foes === 4 && d1.pack === 4, `Ambush Sweep: a melee Ambush already strikes the pack (${d1.foes} struck, modelled ${d1.pack})`);
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
// The Bellwarden loop as the sheet models it (class-bell.js ED.Bell.cycle): attack held; a one-tick release when ED.Bell.ready says so, the cursor at aim() (on the foe); then held again: the bell reels home as soon as it lands and winds on.
function bellLoop(w, p, aim) {
  let n = 0, rel = false;
  p.haulIn = true;
  return { tick() { if (rel) { p.haulIn = true; rel = false; return; } if (ED.Bell.ready(w, p)) { const a = aim(); p.face = Math.atan2(a.y - p.y, a.x - p.x); p.aimX = a.x; p.aimY = a.y; p.haulIn = false; rel = true; n++; } }, get n() { return n; } };
}
function weaponRun(cls, wi, boons, o) {
  o = o || {};
  const probe = stage(cls, boons, wi, null), wp = probe.p.stats.weapon, reach = wp.kind === 'melee' ? wp.range * (1 + 0.5 * probe.p.stats.area + probe.p.stats.meleeReach) : 0, bell = wp.kind === 'bell';
  const { w, p, e } = stage(cls, boons, wi, o.stat, null, bell ? ED.Bell.orbit(wp) : reach ? reach * 0.55 : REF.d, o.crit);
  if (o.stratum) w.stratum = o.stratum;
  const m = sheetOf(w, p);
  let next = 0, atk = 0;
  const ex = e.x, ey = e.y, loop = bell ? bellLoop(w, p, () => ({ x: ex, y: ey })) : null;
  if (bell) { run(w, 3, () => { loop.tick(); e.x = ex; e.y = ey; }); hits.length = 0; } // a bell: the loop runs 3 s first, then is measured; an attack is a hurl (the foe holds its spot on the orbit)
  const n0 = bell ? loop.n : 0;
  run(w, o.secs || 20, () => { if (bell) { loop.tick(); e.x = ex; e.y = ey; return; } if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); atk++; } });
  if (bell) { atk = loop.n - n0; p.haulIn = false; }
  run(w, bell ? 0 : 4);
  const total = hits.filter(h => !(h.kind === 'dot' && h.raw)).reduce((s, h) => s + h.dealt, 0), bleed = hits.filter(h => h.kind === 'dot' && h.raw && h.bleed).reduce((s, h) => s + h.dealt, 0);
  return { m, total, atk, bleed, secs: o.secs || 20 };
}
for (const cls of ED.CLASS_IDS) for (let wi = 0; wi < 3; wi++) {
  const r = weaponRun(cls, wi, {}), id = ED.CLASSES[cls].weapons[wi];
  if (cls === 'bell' && ED.WEAPONS[id].n > 1) continue; // juggled bells come home together and wind as a pair: the staged chase below holds them
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, cls === 'bell' ? 0.1 : 0.04, `${id} damage per attack on one foe`);
  if (cls === 'bell') rel(r.total / r.secs, r.m.weapon.dps / ED.Sheet.BELL_EFF.one, 0.25, `${id} damage a second on one foe on the orbit (the model before BELL_EFF)`); // 25%: a winding strike just before or after full wind moves a staged loop by a revolution
}
// Bellwarden forks: Heavy and Swift bells, Full Swing, the Wrecking Ball shock, Perpetual Motion
for (const [boons, wi, tag] of [[{ b_atk: 1, b_atk_h: 1 }, 0, 'Tolling Bell'], [{ b_atk: 1, b_atk_s: 1 }, 0, 'Chiming Bell'], [{ b_atk: 1, b_atk_h: 2 }, 1, 'Cathedral Bell rank 2'], [{ b_atk: 1, b_atk_s: 3 }, 2, 'Sleigh Bells rank 3']]) {
  const r = weaponRun('bell', wi, boons, { secs: 24 });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.1, `${tag} damage per loop`);
  rel(r.total / r.secs, r.m.weapon.dps / ED.Sheet.BELL_EFF.one, 0.25, `${tag} damage a second`);
}
// Bellwarden calibration (sheet.js BELL_EFF, HURL_PACK, REEL_PACK, BELL_MIX): a staged chase, the hero holding its spot and playing the loop at the nearest foe while skeletons (no hit hurts it) walk in from 140 px, 4 seeds x 30 s after 2 s;
// the weapon damage a second on one foe and on a pack of 4 against the sheet's one-foe dps and tools/model.js packWeapon, within 15% on one foe and 30% on the pack (a moving pack: knockback and drag change its drain weapon by weapon) for every bell weapon, Heavy and Swift
{
  const MDc = require('./model.js')(ED, { pack: 4 }), SECS = 30, SEEDS = 4, verbs = {};
  const chase = (wid, boons, nf, seed) => {
    const w = new ED.World({ seed, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'bell', weapon: wid, meta: META() }] });
    w.startRun(); const p = w.players.get('p0');
    Object.assign(p.boons, boons); w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null; p.stats.crit = 0;
    w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0;
    const m = sheetOf(w, p), foes = new Set();
    for (let i = 0; i < nf; i++) { const a = i / nf * 2 * Math.PI + seed, e = w.spawnEnemy('skeleton', p.x + Math.cos(a) * 140, p.y + Math.sin(a) * 140); e.spawnT = 0; e.hp = e.maxHp = 1e9; foes.add(e); }
    let dmg = 0, on = false;
    const h0 = W.hitEnemy;
    W.hitEnemy = function (e, b, s) { const d = h0.call(this, e, b, s); if (on && foes.has(e) && s && s.p === p && s.kind !== 'dot') { dmg += d; const k = s.part || s.kind; verbs[k] = (verbs[k] || 0) + d; } return d; };
    const x0 = p.x, y0 = p.y;
    const loop = bellLoop(w, p, () => { let best = null, bd = 1e9; for (const e of foes) { const d = (e.x - x0) ** 2 + (e.y - y0) ** 2; if (d < bd) { bd = d; best = e; } } return { x: best.x, y: best.y }; }); // the cursor on the nearest foe
    for (let t = 0; t < (SECS + 2) * 60; t++) { if (t === 120) on = true; p.hp = p.maxHp; p.x = x0; p.y = y0; w.update(1 / 60); loop.tick(); }
    W.hitEnemy = h0;
    return { got: dmg / SECS, want: nf > 1 ? MDc.packWeapon({ weapon: m.weapon }, nf) / m.weapon._up : m.weapon.dps }; // no casts here: the bell loops all the time (packWeapon takes _up)
  };
  for (const wid of ['bronzebell', 'stormbell', 'greatbell', 'wreckbell', 'handbells', 'chimes']) for (const [tag, boons] of [['', {}], [' Heavy', { b_atk: 1, b_atk_h: 1 }], [' Swift', { b_atk: 1, b_atk_s: 1 }]]) for (const nf of [1, 4]) {
    let got = 0, want = 0;
    for (let s = 1; s <= SEEDS; s++) { const r = chase(wid, boons, nf, s); got += r.got / SEEDS; want = r.want; }
    rel(got, want, nf > 1 ? 0.3 : 0.15, `${wid}${tag} weapon damage a second in a chase, ${nf > 1 ? 'a pack of ' + nf : 'one foe'} (sheet at BELL_EFF)`);
  }
  if (verbose) console.log('bell chase damage by part: ' + JSON.stringify(Object.fromEntries(Object.entries(verbs).map(([k, v]) => [k, Math.round(v)]))));
}
// forks and route weapons: Heavy, Swift and the Knight Cleave
for (const [cls, boons, tag] of [['knight', { k_atk: 1 }, 'Oath of Steel'], ['knight', { k_atk: 1, k_atk_h: 1 }, 'Oathbreaker'], ['knight', { k_atk: 1, k_atk_s: 1 }, 'Sworn Blade'], ['knight', { k_atk: 1, k_atk_h: 3 }, 'Earthsplitter'], ['knight', { k_atk: 1, k_atk_s: 3 }, 'Thousand Edges'], ['ranger', { r_atk: 1, r_atk_h: 1 }, 'Ballista'], ['cleric', { c_atk: 1, c_atk_s: 1 }, 'Crusader']]) {
  const r = weaponRun(cls, 0, boons, { secs: 24 });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.05, `${tag} damage per attack`);
}
// Masterstroke: attacks for St.HOLD.at s, then holds to full and releases the finisher (a guaranteed crit at FIN_MUL that Bleeds 50%); the cycle deals the model's hold dps
for (const cls of ['knight', 'ranger', 'pyro', 'shade']) {
  const wp = ED.WEAPONS[ED.CLASSES[cls].weapons[0]], probe = stage(cls, { masterstroke: 1 }, 0, null), reach = wp.kind === 'melee' ? wp.range * (1 + 0.5 * probe.p.stats.area + probe.p.stats.meleeReach) * 0.55 : REF.d;
  const { w, p } = stage(cls, { masterstroke: 1 }, 0, null, null, reach, 0), m = sheetOf(w, p), h = m.weapon._hold, H = ED.Stats.HOLD.finisher, full = ED.Stats.holdFull(p.stats);
  let next = 0, c0 = 0, held = false; const SECS = 30;
  run(w, SECS, () => {
    const t = w.time - c0;
    if (t < H.at) { if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); } }
    else if (!held) { w.playerHold(p, true, 0); held = true; }
    else if (t >= H.at + full + 1 / 120) { w.playerHold(p, false, 0); held = false; c0 = w.time; next = w.time; }
  });
  run(w, 4);
  const got = hits.reduce((s, x) => s + x.dealt, 0) / SECS;
  ok(h && h.label === 'Finisher' && h.dps > m.weapon.dps, `Masterstroke ${cls}: the weapon card lists the finisher and its cycle out-damages the plain attacks`);
  rel(got, h.dps, 0.12, `Masterstroke ${cls}: damage a second of the attack, hold and finisher cycle`);
}
// evolutions: the plain attack of an evolved hero against the model (no evolution adds shots)
for (const [cls, evo, stratum] of [['knight', 'fire', 1], ['pyro', 'fire', 1], ['ranger', 'ice', 1], ['ranger', 'lightning', 1], ['ranger', 'general', 1], ['knight', 'general', 1], ['necro', 'ice', 1]]) {
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
  near(ex(q2, 'Flurry').perAttack, q2.avg * ED.BOONS.r_atk_s.r2.flurryMul * 2 / 4, 1e-6, 'Flurry at rank 2: two arrows at flurryMul every 4th shot, both on a foe at REF');
  const ric = ex(q3, 'Ricochet'); ok(ric && ric.packOnly && !ex(q2, 'Ricochet'), 'Storm Bow lists a pack-only Ricochet');
  near(q3.dps, (q3.avg * q3.oneFoe + q3.extras.filter(e => !e.packOnly).reduce((s, e) => s + e.perAttack, 0)) * q3.aps, 0.01 * q3.dps, 'a pack-only extra is not in the damage on one foe');
  near(ric.perAttack, q3.avg * 0.4 * 0.8 * (1 + 3 * 0.45 / 4) / 4, 0.05, 'Ricochet: 40% x 0.8 hit rate per shot (and per Flurry arrow at its share), written for a pack of 4');
  const h2 = wm({ r_atk: 1, r_atk_h: 2 }), h3 = wm({ r_atk: 1, r_atk_h: 3 });
  ok(!ex(h2, 'Siege bolt') && ex(h3, 'Siege bolt') && ex(h3, 'Siege blast').packOnly && !ex(h3, 'Siege bolt').packOnly, 'Siege Ballista lists the bolt (one foe) and its blast (pack only)');
  near(ex(h3, 'Siege bolt').perAttack, h3.avg * 0.8 / 5, 1e-6, 'the siege bolt adds x1.8 on every 5th shot');
  const hr = modelOf('ranger', { r_el: 1, r_el_a: 2 }, 0).skills[0], hs = modelOf('ranger', { r_el: 1, r_el_a: 1 }, 0).skills[0];
  ok(hr.dpsCd > hs.dpsCd * 1.1, 'Gangrene raises Volley and Rain (50% at an assumed 50% uptime)');
  const bleedOf = (boons, extra) => modelOf('ranger', Object.assign({ kindle: 1, frostbite: 1 }, boons), 0, extra).mult.status.find(s => s.el === 'general');
  const b2 = bleedOf({ r_el: 1, r_el_a: 2 }), b3 = bleedOf({ r_el: 1, r_el_a: 3 }), bn = bleedOf({ r_el: 1, r_el_a: 3 }, { stat: { hemoAt: 0.9 } });
  ok(!b2.est.pops && b3.est.pops > 0 && b3.est.dps > b2.est.dps * 1.5, 'Hemorrhage adds pops to the Bleed estimate (' + b3.est.pops + ' pops while the reference foe lasts)'); ok(!bn.est.pops && bn.est.dps < b3.est.dps, 'a threshold the pool never reaches adds nothing');
  const pk = (boons) => modelOf('ranger', Object.assign({ kindle: 1 }, boons), 0).weapon.extras;
  const c1 = pk({ r_el: 1, r_el_b: 1 }).find(e => e.label === 'Contagion spread'), c2 = pk({ r_el: 1, r_el_b: 2 }).find(e => e.label === 'Outbreak spread'), c3 = pk({ r_el: 1, r_el_b: 3 });
  ok(c1 && c1.packOnly && c2 && c2.packOnly && c2.perAttack > c1.perAttack * 1.3, 'Contagion and Outbreak list a pack-only spread, Outbreak the larger'); ok(c3.some(e => e.label === 'Plaguebearer burst' && e.packOnly) && !c3.some(e => /spread/.test(e.label)), 'Plaguebearer lists its burst instead of the spread');
  const pb = c3.find(e => e.label === 'Plaguebearer burst'); ok(pb.perAttack > c2.perAttack * 1.3, 'the burst is worth more than the spread');
}

// Necromancer riders and forms: Grave Bolt and the Hexed-foe bonus on the weapon (a staged run), the pack and lone-foe values of the extras, and the power band of the four forks
{
  const ex = (wpn, l) => wpn.extras.find(e => e.label === l), MD = require('./model.js')(ED, { pack: 4 }), GATES = { kindle: 1, frostbite: 1 }, MIDN = { focus: 1 }; // MIDN: the path-neutral fork baseline
  { const r = weaponRun('necro', 0, { n_atk: 1, n_atk_h: 3 }, { secs: 30 }), g = ex(r.m.weapon, 'Grave Bolt'); ok(g && g.perAttack > 0, 'Grave Bolt lists a weapon extra'); if (g) rel(r.total / r.atk, r.m.weapon.avg * r.m.weapon.oneFoe + g.perAttack, 0.04, 'Grave Bolt damage per attack on one foe'); }
  { const r = weaponRun('necro', 0, { n_atk: 1, n_atk_s: 1 }, { secs: 30 }), h = ex(r.m.weapon, 'Hexed foes'); ok(h && h.perAttack > 0, 'Soul Barrage lists a Hexed foes extra'); if (h) rel(r.total / r.atk, r.m.weapon.avg * r.m.weapon.oneFoe + h.perAttack, 0.06, 'Soul Barrage damage per attack on a Hexed foe'); }
  { const r = weaponRun('necro', 1, { n_atk: 1, n_atk_h: 3 }, { secs: 30 }), g = ex(r.m.weapon, 'Grave Bolt'); ok(g && g.perAttack > 0 && r.m.weapon.kind === 'melee', 'the Soul Scythe lists the Grave Bolt too'); if (g) rel(r.total / r.atk, r.m.weapon.avg * r.m.weapon.oneFoe + g.perAttack, 0.04, 'Grave swing damage per attack on one foe'); }
  const wm = (boons) => modelOf('necro', Object.assign({}, GATES, boons), 0).weapon, mm = (boons) => modelOf('necro', Object.assign({}, GATES, boons), 0, { ctx: { stratum: 4 } });
  { // the extras exist from the rank that brings them, and a pack gets what a lone foe cannot
    const s2 = wm({ n_atk: 1, n_atk_s: 2 }), s3 = wm({ n_atk: 1, n_atk_s: 3 }), storm = ex(s3, 'Soul Storm');
    ok(!ex(s2, 'Soul Storm') && storm && storm.packOnly && storm._pack(1) === 0 && storm._pack(4) > 0 && Math.abs(storm.perAttack * 4 - storm._pack(4)) < 1e-9, 'Soul Storm is a pack-only extra: nothing against a lone foe, a soul per Hexed foe in a pack');
    ok(MD.packWeapon({ weapon: s3 }, 4) > MD.packWeapon({ weapon: s2 }, 4) * 1.05, 'Soul Storm raises the pack weapon damage');
    const g1 = wm({ n_atk: 1, n_atk_h: 2 }), g3 = wm({ n_atk: 1, n_atk_h: 3 }), ge = ex(g3, 'Grave Bolt');
    ok(!ex(g1, 'Grave Bolt') && ge && ge._pack(4) > ge.perAttack * 2, 'Grave Bolt pierces: a pack takes more of it than a lone foe');
    const h1 = ex(wm({ n_atk: 1, n_atk_s: 2 }), 'Hexed minions'), h0 = ex(wm({ n_atk: 1, n_atk_s: 1 }), 'Hexed minions'); ok(h0 && h1 && h1.perAttack > h0.perAttack * 1.3 && h1._pack(4) < h1.perAttack && h1._pack(4) > h0._pack(4), 'Quickened Dead raises the Hexed minions extra; a pack keeps fewer foes Hexed than a lone foe');
    const hb = ex(wm({ n_atk: 1, n_atk_h: 2 }), 'Hexed minions'), hb1 = ex(wm({ n_atk: 1, n_atk_h: 1 }), 'Hexed minions'); ok(hb._pack(4) / hb.perAttack > hb1._pack(4) / hb1.perAttack, 'Hex Burst keeps more of a pack Hexed');
    const a1 = ex(wm({ n_el: 1, n_el_a: 1 }), 'Abyssal Toll'), a3 = wm({ n_el: 1, n_el_a: 3 }); ok(a1 && ex(a3, 'Abyssal Maw') && !ex(wm({ n_el: 1, n_el_a: 2 }), 'Abyssal Maw') && ex(a3, 'Abyssal Maw').perAttack > a1.perAttack, 'the Maw is a rank 3 extra and pays more than the Toll bonus');
    const t2 = ex(wm({ n_el: 1, n_el_b: 2 }), 'Risen Tide'), t3 = ex(wm({ n_el: 1, n_el_b: 3 }), 'Tide of the Dead'); ok(!ex(wm({ n_el: 1, n_el_b: 1 }), 'Risen Tide') && t2 && t3 && t3._pack(4) > t3.perAttack && t3.perAttack > t2.perAttack, 'Risen Tide from rank 2, Tide of the Dead from rank 3, a pack raises more of the swarm');
  }
  { // the power band: against the class without the route card, the mean of one foe and a pack (tools/sheet.js --routes --mid) is +35% (+-10) at rank 2 (stratum III, after boss II) and +60% (+-10) at rank 3 (stratum IV, after boss III)
    const hero = (boons) => { const b = { cls: 'necro', weapon: 'bonewand', boons, relics: [], meta: META(), pact: 0 }, stats = ED.Stats.compute(b); stats.sn = {}; return { pid: 'p', name: 'T', cls: 'necro', weapon: b.weapon, boons, relics: [], meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 }; };
    const ass = (boons, stratum) => MD.assess(hero(boons), CTX({ stratum }));
    for (const stratum of [3, 4]) {
      const base = ass(MIDN, stratum), line = [];
      for (const [t1, f, lean] of [['n_atk', 'n_atk_h', 0], ['n_atk', 'n_atk_s', 1], ['n_el', 'n_el_a', 0], ['n_el', 'n_el_b', 1]]) {
        const gain = (r) => { const a = ass(Object.assign({}, MIDN, { [t1]: 1, [f]: r }), stratum); return [a.one / base.one - 1, a.pack / base.pack - 1]; };
        const g2 = gain(2), g3 = gain(3), m2 = (g2[0] + g2[1]) / 2, m3 = (g3[0] + g3[1]) / 2;
        if (stratum === 3) ok(m2 >= 0.25 && m2 <= 0.45, `${f} rank 2 at stratum ${stratum}: mean ${(m2 * 100).toFixed(0)}% (one foe ${(g2[0] * 100).toFixed(0)}%, pack ${(g2[1] * 100).toFixed(0)}%) is within 35% +- 10`);
        if (stratum === 4) ok(m3 >= 0.5 && m3 <= 0.7, `${f} rank 3 at stratum ${stratum}: mean ${(m3 * 100).toFixed(0)}% (one foe ${(g3[0] * 100).toFixed(0)}%, pack ${(g3[1] * 100).toFixed(0)}%) is within 60% +- 10`);
        if (stratum === 4) { if (f === 'n_el_a') ok(g3[0] > g3[1], 'Abyssal Toll leans to a single foe'); else if (lean) ok(g3[1] > g3[0], `${f} leans to packs`); }
        line.push(f);
      }
    }
  }
}

// Shade attack and element forms (ED.Sheet shadeForms): the execution extra, Whirlwind and Cyclone spins and the Momentum state against the sim; the pack-only and skill-part extras by structure
{
  const shadeBoons = (t1, fk, r) => ({ s_s1: 1, [t1]: 1, [fk]: r }); // Ghost Walk readies the crits that build Momentum
  const wm = (boons, o) => modelOf('shade', boons, (o && o.wi) || 0, Object.assign({ stat: { crit: 0 } }, o)).weapon, ex = (m, l) => m.extras.find(e => e.label === l);
  const MD = require('./model.js')(ED, { pack: 4 });
  // execution: against a foe always below the line every hit crits for sure; the weapon's damage per attack is hit x critMult (crit chance 0, no Momentum)
  { const r = weaponRun('shade', 0, shadeBoons('s_atk', 's_atk_h', 2), { secs: 24, stat: { execCrit: 1, momentum: 0 } });
    rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.05, 'Culling Blades: execution crits on a foe below the line, damage per attack');
    ok(ex(r.m.weapon, 'Execution') && Math.abs(ex(r.m.weapon, 'Execution').perAttack - r.m.weapon.hit * (r.m.weapon.critMult - 1)) < 1e-6, 'Execution adds (critMult - 1) x hit per attack when every attack executes'); }
  // Whirlwind and Cyclone at full Momentum (crit 1 fills the stacks at once and keeps them full): the spin hits (weapon hits that are not the weapon's own) per attack against the extra less the dash term and the Momentum bonus of the sim
  for (const [boons, label, tag] of [[shadeBoons('s_atk', 's_atk_s', 2), 'Whirlwind', 'Whirlwind (rank 2)'], [shadeBoons('s_atk', 's_atk_s', 3), 'Cyclone', 'Cyclone (rank 3)']]) {
    const r = weaponRun('shade', 0, boons, { secs: 24, crit: 1 }), m = r.m.weapon, st = ED.Stats.compute({ cls: 'shade', weapon: 'daggers', boons, relics: [], meta: META(), pact: 0 });
    const spin = hits.filter(h => h.kind === 'weapon' && !h.wpn && !h.raw).reduce((a, h) => a + h.dealt, 0), bonus = (st.dmg + st.momentum * st.momMax) / st.dmg, e = ex(m, label);
    const dash = st.cyclone > 0 ? 0.3 / m.aps * st.cyclone * m._avg * m._mom.pFull : 0; // the model counts a dash every 3 s, the run makes none
    ok(!!e && m._mom.pFull > 0.99, `${tag}: the weapon card lists ${label} and Momentum is full at crit 1`);
    rel(spin / r.atk / bonus, e.perAttack - dash, 0.06, `${tag}: spin damage per attack at full Momentum`);
  }
  // Momentum: the stacks a hit sees, against the sim (crit 20%, no readied crits; the first seconds of the run are the ramp)
  for (const [boons, tag] of [[shadeBoons('s_atk', 's_atk_s', 2), 'Thousand Cuts rank 2'], [shadeBoons('s_atk', 's_atk_s', 3), 'Thousand Cuts rank 3']]) {
    const { w, p } = stage('shade', boons, 0, { stackMax: -3 }, null, 30, 0.2), m = sheetOf(w, p).weapon;
    let next = 0, sum = 0, cnt = 0;
    run(w, 150, () => { if (w.time >= next) { sum += p.momT > 0 ? p.momN : 0; cnt++; w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); } });
    rel(sum / cnt, m._mom.avg, 0.06, `${tag}: Momentum stacks a hit sees (${(sum / cnt).toFixed(2)} of ${p.stats.momMax})`);
  }
  // the pack-only and skill-part extras by structure: they appear at their rank, grow with their numbers and stay out of the damage on one foe
  { const a = wm(shadeBoons('s_atk', 's_atk_h', 2)), b = wm(shadeBoons('s_atk', 's_atk_h', 3));
    ok(!ex(a, 'Guillotine') && ex(b, 'Guillotine') && ex(b, 'Guillotine').packOnly && ex(b, 'Execution').perAttack > ex(a, 'Execution').perAttack, 'Guillotine appears at rank 3 as a pack-only extra and the higher line raises Execution');
    const one = (m) => (m.avg * m.oneFoe + m.extras.filter(e => !e.packOnly).reduce((s, e) => s + e.perAttack, 0)) * m.aps; near(b.dps, one(b), 0.01 * b.dps, 'the Guillotine chain is not in the damage on one foe');
    const g = (n) => ex(wm(shadeBoons('s_atk', 's_atk_h', 3), { stat: { crit: 0, guillotine: n } }), 'Guillotine').perAttack; ok(g(1) > 0 && g(3) >= g(1), 'more strikes per attack never lower the Guillotine extra'); }
  { const s2 = wm(shadeBoons('s_atk', 's_atk_s', 2)), s3 = wm(shadeBoons('s_atk', 's_atk_s', 3)), s1 = wm(shadeBoons('s_atk', 's_atk_s', 1));
    ok(!ex(s1, 'Whirlwind') && ex(s2, 'Whirlwind') && !ex(s2, 'Cyclone') && ex(s3, 'Cyclone') && !ex(s3, 'Whirlwind') && ex(s3, 'Cyclone').perAttack > ex(s2, 'Whirlwind').perAttack, 'Whirlwind from rank 2, Cyclone from rank 3 instead of it, the spin worth more'); }
  { const gates = { kindle: 1, frostbite: 1 }, v1 = wm(Object.assign({}, gates, shadeBoons('s_el', 's_el_a', 1))), v3 = wm(Object.assign({}, gates, shadeBoons('s_el', 's_el_a', 3))); // two gates make 3 ailments common and 4 possible
    ok(ex(v1, 'Open Veins') && !ex(v1, 'Arterial Strike') && ex(v3, 'Arterial Strike') && ex(v3, 'Arterial crits') && ex(v3, 'Open Veins').perAttack > ex(v1, 'Open Veins').perAttack, 'Open Veins lists its extra; Arterial Strike adds the bonus and the readied crits at rank 3');
    ok(modelOf('shade', Object.assign({}, gates, shadeBoons('s_el', 's_el_a', 2)), 0).proc.bleed > modelOf('shade', Object.assign({}, gates, shadeBoons('s_el', 's_el_a', 1)), 0).proc.bleed, 'Exsanguinate adds to the Bleed input from rank 2'); }
  { const sk = (r, o) => modelOf('shade', Object.assign({ kindle: 1 }, shadeBoons('s_el', 's_el_b', r)), 0, o).skills, part = (k, s, id) => k[s].parts.find(q => q.id === id);
    const k1 = sk(1), k2 = sk(2), k3 = sk(3);
    ok(part(k1, 0, 'rupture') && part(k1, 1, 'rupture') && !part(k1, 0, 'bloodbloom') && part(k2, 0, 'bloodbloom') && !part(k2, 0, 'cascade') && part(k3, 0, 'cascade') && part(k3, 0, 'bloodbloom'), 'Rupture parts: Shadowstep and Ambush from rank 1, Bloodbloom from rank 2, Crimson Cascade from rank 3');
    ok(k1[0].perCast > modelOf('shade', { kindle: 1 }, 0).skills[0].perCast && k1[1].perCast > modelOf('shade', { kindle: 1 }, 0).skills[1].perCast, 'a rupture adds to the damage of a Shadowstep cast and of an Ambush on one foe');
    ok(part(k3, 0, 'cascade').total > 0 && Math.abs(k3[0].perCast - k2[0].perCast) < k2[0].perCast * 0.12, 'Crimson Cascade is a pack part: it needs other foes and leaves the damage of one foe to the rupture share');
    const c = (n) => part(sk(3, { stat: { cascadeN: n } }), 0, 'cascade').total; ok(c(8) > c(4) && c(4) > c(2), 'more leaps per cast raise the Cascade part'); }
  // model.js: the stacks a hit sees are part of the conditional factor of a Momentum build, and only of one
  { const fac = (boons) => { const m = modelOf('shade', boons, 0), p = { cls: 'shade', stats: ED.Stats.compute({ cls: 'shade', weapon: 'daggers', boons, relics: [], meta: META(), pact: 0 }) }; return MD.condFactor(p, m, MD.defence(p, m)); };
    ok(fac({}) === 1 && fac(shadeBoons('s_atk', 's_atk_s', 2)) > 1.2 && fac({ s_el: 1 }) === 1, 'the conditional factor adds Momentum only for a Momentum build'); }
}

// ---------------- shield window: the readout equals what addShield granted in the last 10 s ----------------
{
  const { w, p } = stage('knight', {}, 0, {});
  w.addShield(p, 0.8, 100, 'catch'); w.addShield(p, 0.5, 100, 'holy'); // under the 3% / 6% windows of a 45-health Knight
  let m = sheetOf(w, p);
  near(m.def.window.cls, 0.8, 0.01, 'shield window, class sources'); near(m.def.window.all, 1.3, 0.01, 'shield window, all sources');
  near(m.def.window.clsPct, 0.8 / p.maxHp, 1e-6, 'shield window as a share of max health');
  run(w, 11);
  m = sheetOf(w, p); near(m.def.window.all, 0, 0.001, 'the window empties after 10 s');
}

// ---------------- defence and the foes that spawn now ----------------
for (const [stratum, pact, dark, party, boons] of [[1, 0, false, 1, {}], [3, 2, true, 1, { plating: 2, evade: 0 }], [4, 8, true, 1, {}], [6, 10, false, 2, {}], [2, 4, true, 1, {}]]) {
  const { w, p } = stage('knight', boons, 0, {});
  w.pact = pact; w.recalc(p, true); w.enterStratum(stratum); w.room.dark = dark;
  if (party > 1) w.addPlayer({ pid: 'p1', name: 'B', slot: 1, cls: 'ranger', weapon: 'longbow', meta: META() });
  w.enemies.length = 0; w.enc = null; w.locked = false;
  const tag = `stratum ${stratum} pact ${pact} dark ${dark} party ${party}`, m = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true });
  const e = w.spawnEnemy('skeleton', p.x + 80, p.y), e2 = w.spawnEnemy('frozenskel', p.x + 90, p.y);
  rel(e.dmg / ED.ENEMIES.skeleton.dmg, m.def.foeHere, 1e-9, `foes that spawn now hit (${tag})`);
  rel(e2.hp, m.ref.hp, 1e-9, `reference foe health (${tag})`); rel(e2.hp / e2.hpLever, m.ref.statusHp, 1e-9, `reference foe status health (${tag})`);
  const mh = p.maxHp; p.maxHp = p.hp = 1e4; p.invuln = 0; w.hurtPlayer(p, 100, { hazard: true }); near(p.maxHp - p.hp, Math.max(1, Math.round(100 * m.def.taken)), 1, `damage taken from a 100 hit (${tag})`); p.maxHp = mh; // 1e4 health: the probe hit must not down the hero
  p.hp = 1; const got = w.healPlayer(p, 10, true); rel(got, 10 * m.def.healMul, 1e-9, `healing received (${tag})`);
  ok(m.ctx.dark === dark && (m.def.foeParts.dark === null) === !dark, `dark-room flag of the sheet (${tag})`);
  ok(m.def.maxHp === p.maxHp && m.def.ehp > 0, `max health (${tag})`);
}

// ---------------- statuses on a foe of the reference health: the payoffs the estimates promise (weapon damage only, no crit) ----------------
function statusRun(boons, stratum, secs, until, each, stat) { // stat: stats set on the hero (the class-only Holy and Shadow engines)
  const { w, p, e } = stage('ranger', boons, 0, {});
  w.stratum = stratum; if (stat) Object.assign(p.stats, stat);
  const m0 = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true }), ref = m0.ref;
  e.maxHp = e.hp = ref.hp; e.hpLever = ref.hp / ref.statusHp; // a foe of the reference health; the pin below keeps it alive unless the payoff is a kill
  let next = 0, t = null;
  for (let i = 0; i < secs * 60; i++) {
    if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); }
    w.update(1 / 60);
    if (each) each(w, p, e);
    if (until === 'freeze' && e.frozen > 0) { t = w.time; break; }
    if (until === 'reap' && e.hp <= 0) { t = w.time; break; }
    if (until !== 'reap') e.hp = e.maxHp;
  }
  return { w, p, e, m0, t, ref };
}
{
  const r = statusRun({ frostbite: 1 }, 6, 12, 'freeze'), st = r.p.stats, pow = 1 + st.statusPow; // stratum VI: a reference foe of 230 health takes several hits to freeze
  const rate = r.m0.proc.split.weapon * st.iceInfuse * pow / r.ref.statusHp * C.CHILL_K * (1 + st.chillMul);
  ok(r.t !== null && Math.abs(r.t - 100 / rate) <= 100 / rate * 0.15 + 0.35, `time to freeze a reference foe ${r.t && r.t.toFixed(2)} s vs ${(100 / rate).toFixed(2)} s from the weapon`);
  const est = r.m0.mult.status.find(s => s.el === 'ice').est; ok(est.first > 0 && est.first <= 100 / rate + 1e-9 && est.secs >= est.first - 1e-9, 'Ice estimate counts the skills on top of the weapon; later freezes take longer (freeze resistance)');
}
{ // Storm: the foe discharges at its threshold; the discharge damage a second is the charge income x DIS_K x (1 + shockMul)
  const r = statusRun({ staticcharge: 1, highvoltage: 2 }, 1, 20, null);
  const dps = hits.filter(h => h.kind === 'chain' && h.el === 'lightning' && h.t > 6).reduce((s, h) => s + h.dealt, 0) / (r.w.time - 6), st = r.p.stats;
  const want = r.m0.proc.split.weapon * st.lightningInfuse * (1 + st.statusPow) * C.DIS_K * (1 + st.shockMul + st.capacitor); // the Lightning estimate on the weapon alone (it counts the skills too)
  rel(dps, want, 0.15, 'Charge: discharge damage per second on one foe, threshold discharges');
}
{
  const r = statusRun({}, 3, 20, null, null, { holyInfuse: 0.4, smiteMul: 0.3 }); // Smite damage per second (Holy is neutral in stratum III)
  const st = r.p.stats, dps = hits.filter(h => h.kind === 'smite').reduce((s, h) => s + h.dealt, 0) / r.w.time, want = r.m0.proc.split.weapon * st.holyInfuse * (1 + st.smiteMul);
  rel(dps, want, 0.1, 'Radiance: Smite damage per second on one foe');
}
{
  const r = statusRun({}, 3, 40, 'reap', null, { shadowInfuse: 0.4 }), st = r.p.stats; // Shadow is neutral in stratum III
  const dealt = hits.filter(h => h.kind !== 'dot' || !h.raw).reduce((s, h) => s + h.dealt, 0), i = st.shadowInfuse * (1 + (st.doomMul || 0));
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
  const capDps = (C.BURN_CAP + p.stats.burnCap) * ED.burnValue(p.stats); // a foe holds at most the cap of stacks
  ok(st && Math.abs(st.est.dps - Math.min(capDps, (m.proc.split.weapon + m.proc.split.skills) * p.stats.fireInfuse * (1 + p.stats.burnMul))) <= 0.01, 'Burn estimate follows the damage that feeds it, up to the stack cap');
}

// ---------------- Knight Attack and Element forms in the model ----------------
{
  const K = (boons, stratum) => modelOf('knight', Object.assign({ focus: 1, kindle: 1, frostbite: 1 }, boons), 0, { ctx: { stratum: stratum || 3 } });
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
    const lo = K({ k_el: 1, k_el_a: 3 }), hi = modelOf('knight', { focus: 1, kindle: 1, frostbite: 1, k_el: 1, k_el_a: 3 }, 0, { ctx: { stratum: 3 }, stat: { brandMark: ED.BOONS.k_el_a.r3.brandMark * 2 } });
    ok(hi.weapon.dps > lo.weapon.dps, 'a stronger Mark raises the Doombrand extra');
  }
  { // Bloodquake: the payout multiplier raises the Bulwark bash damage on one foe, a part for packs on top; the pack burst follows bloodquakeSplash
    const r2 = K({ k_el: 1, k_el_b: 2 }), r3 = K({ k_el: 1, k_el_b: 3 }), q = r3.skills[1].parts.find(x => x.id === 'bloodquake');
    ok(!r2.skills[1].parts.some(x => x.id === 'bloodquake') && q && q.oneFoe === 0 && q.r === 80, 'Bloodquake adds a part with no hit of its own on one foe, none at rank 2');
    rel(q.here, 2.5 * r3.proc.bleed * (1 + ED.BOONS.k_el_b.r3.bloodquakeMul), 1e-6, 'the Bloodquake payout is the Bleed pool (2.5 s of income) x (1 + bloodquakeMul)');
    const mid = { focus: 1, kindle: 1, frostbite: 1, k_el: 1, k_el_b: 3 }, part = (stat) => modelOf('knight', mid, 0, { ctx: { stratum: 3 }, stat }).skills[1].parts.find(x => x.id === 'bloodquake'), lo = part({ bloodquakeSplash: 0.1 }), hi = part({ bloodquakeSplash: 0.3 }), one = (stat) => modelOf('knight', mid, 0, { ctx: { stratum: 3 }, stat }).skills[1].perCast;
    ok(hi._r.total > lo._r.total && lo._r.total > 0, 'the pack burst follows bloodquakeSplash');
    ok(one({ bloodquakeMul: 2 }) > one({ bloodquakeMul: 1 }) && one({ bloodquakeMul: 1 }) > one({ bloodquake: 0 }) && one({ bloodquakeSplash: 0.1 }) === one({ bloodquakeSplash: 0.9 }), 'on one foe only bloodquakeMul counts: the bash deals more with it, the splash adds nothing');
    ok(modelOf('knight', { k_el: 1, k_el_b: 3 }, 0).skills[1].parts.find(x => x.id === 'bloodquake')._r.total === 0, 'a build with fewer than 3 ailment sources never detonates');
  }
}

// ---------------- Cleric Attack and Element forms in the model ----------------
{
  const MIDC = { generalist: 1, focus: 1 }; // Steel: no pack status, so a pack's extra damage is the wave's own
  const Cm = (boons, o) => modelOf('cleric', Object.assign({}, MIDC, boons), 0, { ctx: { stratum: (o && o.stratum) || 4 }, stat: Object.assign({ crit: 0 }, o && o.stat) });
  const ex = (m, label) => m.weapon.extras.find(e => e.label === label), sec = (m, label) => ex(m, label).perAttack * m.weapon.aps;
  const heroOf = (boons, stat, base) => { const b = { cls: 'cleric', weapon: ED.CLASSES.cleric.weapons[0], boons: Object.assign({}, base || MIDC, boons), relics: [], meta: META(), pact: 0 }, stats = ED.Stats.compute(b); Object.assign(stats, { crit: 0 }, stat); stats.sn = {}; return { pid: 'p', name: 'T', cls: 'cleric', weapon: b.weapon, boons: b.boons, relics: [], meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 }; };
  const MD = require('./model.js')(ED, { pack: 4 });
  const holy = (m) => m.mult.status.find(s => s.el === 'holy').est;
  { // Solar Flare (rank 2) and Dawn's Wake (rank 3) of Sunhammer: pieces of the wave, kept apart from the pack-only extras
    const h1 = Cm({ c_atk: 1, c_atk_h: 1 }), h2 = Cm({ c_atk: 1, c_atk_h: 2 }), h3 = Cm({ c_atk: 1, c_atk_h: 3 }), wol = (m) => ex(m, 'Wave of light').perAttack;
    ok(!ex(h1, 'Solar Flare') && ex(h2, 'Solar Flare') && ex(h3, 'Solar Flare') && !ex(h2, "Dawn's Wake") && ex(h3, "Dawn's Wake"), 'Sunhammer lists Solar Flare from rank 2 and Dawn’s Wake at rank 3 only');
    rel(ex(h2, 'Solar Flare').perAttack, wol(h2) * ED.BOONS.c_atk_h.r2.waveBurst * 0.3, 1e-6, 'Solar Flare = wave x waveBurst x 0.3 (the share of waves whose burst catches a foe)');
    rel(ex(h3, "Dawn's Wake").perAttack, wol(h3) * ED.BOONS.c_atk_h.r3.wake * 1.5, 1e-6, "Dawn's Wake = wave x wake x 1.5 s on the strip x the Holy class affinity (no crit)");
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
    const wr = ED.BOONS.c_atk_s.r3.waveReturn; rel(ex(s3, 'Returning Light').perAttack, wol(s3) * wr * 0.75, 1e-6, 'Returning Light = wave x waveReturn x 0.75 (foes on the way back)');
    rel(ex(s3, 'Litany').perAttack, wol(s3) * 2 * 2 / 16 * (1 + wr * 0.75), 1e-6, 'the Litany side waves return too');
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
    const sb = ED.BOONS.c_el_b.mods.smiteBeam; rel(sec(p1, 'Prism beam'), S(p1) * sb, 1e-6, 'Prism beam = the Smite stream x smiteBeam'); rel(sec(p2, 'Sunburst'), S(p2) * sb * 0.5, 1e-6, 'Sunburst = one more hop at half a beam');
    rel(sec(p3, 'Spectrum'), S(p3) * sb * 2 + S(p3) * 0.01 * (1 + 0.5) * 3, 1e-6, 'Spectrum = 2 more beams (3 others in a pack of 4) + 1% of a Smite as Radiance in each of 3 foes, paid back at 1 + smiteMul');
    rel(p3.weapon.dps, (p3.weapon.avg * p3.weapon.oneFoe + p3.weapon.extras.filter(e => !e.packOnly).reduce((s, e) => s + e.perAttack, 0)) * p3.weapon.aps, 0.01, 'the beams are left out of the damage on one foe');
    ok(MD.packWeapon(p3, 4) - MD.packWeapon(Cm({ c_el: 1, c_el_b: 3 }, { stat: { prismN: 0 } }), 4) > 3 * sec(p3, 'Spectrum') * 0.99, 'in a pack every foe of the 4 beams to the others (x4)');
    const lone = Cm({ c_atk: 1, c_el: 1, c_el_b: 3 }, { stat: { smiteBeam: 0 } }); ok(!ex(lone, 'Prism beam') && !ex(lone, 'Spectrum'), 'no beam, no Spectrum extra without the Prism beam');
  }
  { // the band: each attack and element fork stays inside the Power budget (rank 2 at stratum III near +35%, rank 3 at stratum IV near +60% over the class without the card, mean of one foe and a pack of 4)
    const NEU = { focus: 1 }; // the path-neutral fork baseline (no path gate)
    const base = (s) => { const p = heroOf({}, null, NEU), m = ED.Sheet.compute(p, CTX({ stratum: s }), { raw: true, numbers: true }), d = MD.defence(p, m), k = MD.condFactor(p, m, d); return [MD.heroDamage(m, 1, k), MD.heroDamage(m, 4, k, MD.echoK(p, m, 4))]; };
    const mean = (boons, s) => { const p = heroOf(boons, null, NEU), m = ED.Sheet.compute(p, CTX({ stratum: s }), { raw: true, numbers: true }), d = MD.defence(p, m), k = MD.condFactor(p, m, d), b = base(s); return (MD.heroDamage(m, 1, k) / b[0] + MD.heroDamage(m, 4, k, MD.echoK(p, m, 4)) / b[1]) / 2 - 1; };
    for (const [t1, fork] of [['c_atk', 'c_atk_h'], ['c_atk', 'c_atk_s'], ['c_el', 'c_el_a'], ['c_el', 'c_el_b']]) {
      const r2 = mean({ [t1]: 1, [fork]: 2 }, 3), r3 = mean({ [t1]: 1, [fork]: 3 }, 4);
      ok(r2 > 0.25 && r2 < 0.45, `${fork} rank 2 at stratum 3: +${(r2 * 100).toFixed(0)}% (band 25 to 45)`); ok(r3 > 0.5 && r3 < 0.7, `${fork} rank 3 at stratum 4: +${(r3 * 100).toFixed(0)}% (band 50 to 70)`);
    }
  }
}

// ---------------- Pyromancer Attack and Element forks in the model ----------------
{
  const MID = { kindle: 1, staticcharge: 1, focus: 1 };
  const P = (boons, stat, stratum) => modelOf('pyro', Object.assign({}, MID, boons), 0, { stat: Object.assign({ crit: 0 }, stat), ctx: { stratum: stratum || 4 } });
  const ex = (m, label) => m.weapon.extras.find(e => e.label === label);
  const stOf = (boons) => ED.Stats.compute({ cls: 'pyro', weapon: 'firestaff', boons: Object.assign({}, MID, boons), relics: [], meta: META(), pact: 0 });
  const MD = require('./model.js')(ED, { pack: 4 });
  { // Ember Bolt: a second of bolt hits cuts EMBER_PS x the hits a second x the attack interval (at most EMBER_CAP), and every spell cooldown shrinks by 1 + that cut
    for (const boons of [{}, { p_atk: 1 }, { p_atk: 1, p_atk_s: 1 }]) {
      const m = P(boons), st = stOf(boons), a = m.weapon.aps, hb = m.weapon.oneFoe * a, ab = ex(m, 'Afterburn'), ha = ab ? ab.perAttack * a / (m.weapon.avg * st.afterburn) : 0;
      const cut = Math.min(C.EMBER_CAP, C.EMBER_PS * st.atkInterval / Math.max(1, (st.weapon.n || 1) + st.projN) * (1 + st.emberMul) * (hb + ha));
      for (const [i, id] of [[0, 'nova'], [1, 'meteor'], [2, 'fireball']]) rel(m.skills[i]._cd, ED.Stats.skillNums(id, st).cdEff / (1 + cut), 1e-6, `Ember Bolt cuts the ${id} cooldown by 1 + ${cut.toFixed(2)} for ${JSON.stringify(boons)}`);
      ok(m.weapon.notes.some(t => /^Ember Bolt/.test(t)), 'the weapon card says how much Ember Bolt cuts');
    }
    const none = P({}), sw = P({ p_atk: 1 });
    ok(sw.skills[0]._cd < none.skills[0]._cd && sw.skills[2].charges === none.skills[2].charges + 1, 'Spellweaver cuts more and adds a Fireball charge');
  }
  { // Kindling: Sparks (rank 1), Flashfire (rank 2), Pyre Bolt (rank 3: the bolt's Blast)
    const h1 = P({ p_atk: 1, p_atk_h: 1 }), h2 = P({ p_atk: 1, p_atk_h: 2 }), h3 = P({ p_atk: 1, p_atk_h: 3 }), st3 = stOf({ p_atk: 1, p_atk_h: 3 });
    ok(ex(h1, 'Sparks') && !ex(h1, 'Flashfire') && ex(h2, 'Flashfire') && !ex(h2, 'Blast') && ex(h3, 'Blast'), 'Kindling lists Sparks from rank 1, Flashfire from rank 2, the Pyre Bolt blast at rank 3');
    ok(st3.weapon.explode && st3.weapon.explode.r === C.PYRE_R && st3.weapon.explode.mul === st3.pyreBolt, `Pyre Bolt gives the bolt a blast of radius ${C.PYRE_R} at pyreBolt of the hit`);
    const sf = ED.Stats.compute({ cls: 'pyro', weapon: 'mortar', boons: { p_atk: 1, p_atk_h: 3 }, relics: [], meta: META(), pact: 0 });
    near(sf.weapon.explode.mul, ED.WEAPONS.mortar.explode.mul + sf.pyreBolt, 1e-9, 'a weapon with a blast gains pyreBolt on it');
    const st1 = stOf({ p_atk: 1, p_atk_h: 1 }), between = h1.weapon.oneFoe * h1.weapon.aps / h1.weapon._spells, n = Math.min(st1.sparkMax, between);
    let sk = 0; for (const k of h1.skills) for (const q of k.parts) if (q.kind !== 'zone') sk += q._r.total / k._cd;
    rel(ex(h1, 'Sparks').perAttack * h1.weapon.aps, sk * st1.spark * n, 1e-6, `Sparks = the spells' damage a second x ${st1.spark} x ${n.toFixed(2)} Sparks a spell`);
    ok(h3.weapon.dps > h2.weapon.dps && h2.weapon.dps > h1.weapon.dps, 'each Kindling rank adds damage');
  }
  { // Quickcast: Afterburn (rank 1), Chain Cast (rank 2), Spell Storm (rank 3)
    const s1 = P({ p_atk: 1, p_atk_s: 1 }), s2 = P({ p_atk: 1, p_atk_s: 2 }), s3 = P({ p_atk: 1, p_atk_s: 3 });
    ok(ex(s1, 'Afterburn') && ex(s1, 'Afterburn').proc && !ex(s1, 'Chain Cast') && ex(s2, 'Chain Cast') && ex(s3, 'Afterburn').perAttack > ex(s2, 'Afterburn').perAttack, 'Quickcast lists Afterburn from rank 1, Chain Cast from rank 2, and Spell Storm widens Afterburn at rank 3');
    ok(s3.weapon.dps > s2.weapon.dps && s2.weapon.dps > s1.weapon.dps, 'each Quickcast rank adds damage');
  }
  { // Flashpoint and White Flame (White Heat): by burning time
    const w1 = P({ p_el: 1, p_el_a: 1 }), w2 = P({ p_el: 1, p_el_a: 2 }), w3 = P({ p_el: 1, p_el_a: 3 });
    ok(!ex(w1, 'Flashpoint') && ex(w2, 'Flashpoint') && ex(w3, 'Flashpoint'), 'Flashpoint from rank 2');
    ok(ex(P({ p_el: 1, p_el_a: 2 }, { flashT: 0.5 }), 'Flashpoint').perAttack > ex(P({ p_el: 1, p_el_a: 2 }, { flashT: 4 }), 'Flashpoint').perAttack, 'a shorter Flashpoint burning time crits more often');
    const wf = ex(w3, 'White Flame'); ok(!ex(w2, 'White Flame') && wf && wf.perAttack > 0 && wf.packMul === 0, 'White Flame is a rank 3 extra worth nothing in the pack sum (the pack multiplier carries it)');
    ok(w3.boost.pack > 0 && !w2.boost.pack && !w1.boost.pack, 'the model carries the pack multiplier of White Flame');
    const dmg0 = MD.directDamage(Object.assign({}, w3, { boost: { pack: 0 } }), 4);
    rel(MD.directDamage(w3, 4), dmg0 * (1 + w3.boost.pack), 1e-9, 'tools/model.js multiplies the pack damage by 1 + boost.pack');
    const fast = P({ p_el: 1, p_el_a: 3 }, { whiteT: 0.5 }), slow = P({ p_el: 1, p_el_a: 3 }, { whiteT: 5 }); ok(ex(fast, 'White Flame').perAttack > ex(slow, 'White Flame').perAttack && fast.boost.pack > slow.boost.pack, 'a shorter burn time keeps foes white-hot for more of a fight');
    ok(MD.heroDamage(w3, 1, 1) > MD.heroDamage(w2, 1, 1) && MD.heroDamage(w3, 4, 1) > MD.heroDamage(w2, 4, 1), 'rank 3 deals more than rank 2, on one foe and in a pack');
  }
  { // Heat Engine, Chain Reaction, Inferno Engine (Element Spread): skill casts per second
    const g1 = P({ p_el: 1, p_el_b: 1 }), g2 = P({ p_el: 1, p_el_b: 2 }), g3 = P({ p_el: 1, p_el_b: 3 });
    const he1 = ex(g1, 'Heat Engine'), he2 = ex(g2, 'Heat Engine'); ok(he1 && he2 && he1.perAttack > 0 && he2.packMul > he1.packMul, 'Heat Engine lists the extra casts from rank 1; Chain Reaction raises them in a pack more than on one foe');
    ok(g2.skills[0].perCast > g1.skills[0].perCast * 1.14 && g2.skills[1].perCast > g1.skills[1].perCast * 1.14, 'Heat Engine rank 2 raises Nova and Meteor damage by 15%');
    const noCr = P({ p_el: 1, p_el_b: 2 }, { heatChain: 0 }); ok(ex(noCr, 'Heat Engine').packMul < he2.packMul && Math.abs(ex(noCr, 'Heat Engine').perAttack - he2.perAttack) < 0.5 * he2.perAttack, 'without Chain Reaction a pack gains less');
    const cr1 = P({ p_el: 1, p_el_b: 2 }, { heatChain: 1 }); ok(ex(cr1, 'Heat Engine').perAttack > he2.perAttack * 1.5, 'a Chain Reaction that one burning foe sets off helps on one foe');
    ok(!ex(g2, 'Inferno') && ex(g3, 'Inferno') && ex(g3, 'Inferno').perAttack > 0 && ex(g3, 'Inferno').packMul > 1.5, 'Inferno is a rank 3 extra worth more per foe in a pack (casts reach full Heat sooner)');
    const i1 = ex(P({ p_el: 1, p_el_b: 3 }, { infernoMul: 3 }), 'Inferno'), i2 = ex(P({ p_el: 1, p_el_b: 3 }, { infernoMul: 5 }), 'Inferno'); rel(i2.perAttack / i1.perAttack, 4 / 2, 1e-6, 'Inferno: the gain is (infernoMul - 1) per Inferno');
    const m6 = ex(P({ p_el: 1, p_el_b: 3 }, { heatMax: 8 }), 'Inferno'), m3 = ex(P({ p_el: 1, p_el_b: 3 }, { heatMax: 2 }), 'Inferno'); ok(m3.perAttack > m6.perAttack, 'a smaller Heat store makes Infernos more frequent');
    ok(MD.heroDamage(g3, 4, 1) > MD.heroDamage(g2, 4, 1) * 1.15 && MD.heroDamage(g3, 1, 1) > MD.heroDamage(g2, 1, 1), 'rank 3 deals more than rank 2');
  }
  { // the budget (MASTERPLAN-AGENT): rank 2 and 3 of the four forks against the class without the route card, mean of one foe and a pack of 4 (rank 2 at stratum 3, rank 3 at stratum 4), the numbers of tools/sheet.js --routes --mid --cls=pyro. Heat Engine rank 2 adds +15% to Nova and Meteor beside Chain Reaction.
    const hero = (boons) => { const b = { cls: 'pyro', weapon: 'firestaff', boons: Object.assign({ focus: 1 }, boons), relics: [], meta: META(), pact: 0 }, stats = ED.Stats.compute(b); return { pid: 'p', name: 'T', cls: 'pyro', weapon: b.weapon, boons: b.boons, relics: [], meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 }; }; // path-neutral fork baseline: Focus only
    const dmg = (boons, stratum) => MD.assess(hero(boons), CTX({ stratum }));
    for (const [t1, id, lo2] of [['p_atk', 'p_atk_h', 0.25], ['p_atk', 'p_atk_s', 0.25], ['p_el', 'p_el_a', 0.25], ['p_el', 'p_el_b', 0.25]]) for (const [rank, lo, hi, stratum] of [[2, lo2, 0.45, 3], [3, 0.5, 0.7, 4]]) {
      { const b = dmg({}, stratum), m = dmg({ [t1]: 1, [id]: rank }, stratum), mean = ((m.one / b.one - 1) + (m.pack / b.pack - 1)) / 2;
        ok(mean >= lo && mean <= hi, `${id} rank ${rank} at stratum ${stratum}: ${(mean * 100).toFixed(0)}% against the route-less hero (want ${lo * 100}-${hi * 100}%)`);
      }
    }
  }
}

// The power budget of all 48 forks (tools/sheet.js --parity): the mid build of tools/model.js forkBase, the mean of the 1 foe and pack columns (whole percents) against the class without the route card.
// Stratum III at rank 2 (granted at boss II): a non-Guard fork 31.5-38.5, a Guard fork >= 28. Stratum IV at rank 3 (boss III): non-Guard 54-66, Guard >= 48 and +25% EHP or 30% stun.
{
  const MD = require('./model.js')(ED, { pack: 4 }), col = (v) => Math.round(v * 100);
  const assess = (cls, boons, stratum) => {
    const b = { cls, weapon: ED.CLASSES[cls].weapons[0], boons, relics: [], meta: META(), pact: 0 }, stats = ED.Stats.compute(b);
    return MD.assess({ pid: 'p', name: 'T', cls, weapon: b.weapon, boons, relics: [], meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 }, CTX({ stratum, level: 8 }));
  };
  for (const cls of ED.CLASS_IDS) {
    for (const [stratum, rank, lo, hi, gmin] of [[3, 2, 31.5, 38.5, 28], [4, 3, 54, 66, 48]]) {
      for (const route of ED.ROUTES) {
        const e = ED.CLASS_CARDS[cls][route], mid = MD.forkBase(cls, route), base = assess(cls, mid, stratum);
        for (const fid of e.forks) {
          const a = assess(cls, Object.assign({}, mid, { [e.t1]: 1, [fid]: rank }), stratum), v = (col(a.one / base.one - 1) + col(a.pack / base.pack - 1)) / 2, guard = ED.BOONS[fid].tag === 'Guard';
          if (!guard) ok(v >= lo && v <= hi, `${fid} (${ED.BOONS[fid].name}) rank ${rank} at stratum ${stratum}: ${v} within ${lo}-${hi}`);
          else {
            ok(v >= gmin, `${fid} (${ED.BOONS[fid].name}, Guard) rank ${rank} at stratum ${stratum}: ${v} reaches ${gmin}`);
            if (rank === 3) ok(col(a.ehp / base.ehp - 1) >= 25 || col(a.d.stun) >= 30, `${fid} rank 3 holds +25% EHP or 30% stun (EHP ${col(a.ehp / base.ehp - 1)}%, stun ${col(a.d.stun)}%)`);
          }
        }
      }
    }
  }
}

// the sheet shows the shield the way the HUD does (one decimal under 10, whole above), so the host and a client reading the snapshot agree
for (const [v, want, txt] of [[0.24, 0.2, '0.2'], [2.46, 2.5, '2.5'], [9.94, 9.9, '9.9'], [12.6, 13, '13']]) {
  const m = modelOf('knight', {}, 0, { shield: v });
  ok(m.def.shield === want && m.hero.shield === want && ED.Sheet.n1(m.hero.shield) === txt, `shield ${v} reads ${m.def.shield} (defence) and ${m.hero.shield} (header) as ${ED.Sheet.n1(m.hero.shield)}, want ${txt}`);
}

W.hitEnemy = oHit; W.updateEnemy = oUpd;
console.log(`${n} checks, ${fails} failed` + (pend ? `, ${pend} pending (class routes still to be built by their streams)` : ''));
process.exit(fails ? 1 : 0);
