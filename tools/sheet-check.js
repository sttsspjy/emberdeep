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
const W = ED.World.prototype, REF = ED.Sheet.REF;
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const CTX = (o) => Object.assign({ stratum: 1, pact: 0, gold: 0, level: 5, xp: 0, xpNext: 100, light: 100, lightMax: 100, tier: 0, deep: null, allyNear: 0, minions: 0, room: null, party: 1, rooms: { seen: 1, total: 10 }, heroes: [], time: 0 }, o || {});

// ---------------- test vectors (DESIGN-ux A4) ----------------
function modelOf(cls, boons, wi, o) {
  const b = { cls, weapon: ED.CLASSES[cls].weapons[wi || 0], boons: boons || {}, relics: (o && o.relics) || [], meta: META(), pact: 0 };
  const stats = ED.Stats.compute(b);
  if (o && o.stat) Object.assign(stats, o.stat);
  stats.sn = {};
  const p = { pid: 'p', name: 'T', cls, weapon: b.weapon, boons: b.boons, relics: b.relics, meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 };
  return ED.Sheet.compute(p, CTX(o && o.ctx), { raw: true });
}
{
  const V = { // weapon hit, avg, aps, dps; armor taken
    knight: [18, 18.675, 2.381, 44.47, 0.8824], ranger: [12, 12.9, 2.941, 37.94, 0.9231], pyro: [12, 12.45, 2.0, 39.3, 0.9677], shade: [10, 10.9, 4.762, 51.9, 0.9524], cleric: [17, 17.64, 2.381, 54.6, 0.8955], necro: [9, 9.34, 2.5, 23.35, 0.9677],
  };
  for (const cls in V) {
    const m = modelOf(cls, {}, 0, { stat: { crit: 0 } }), v = V[cls], w = m.weapon;
    near(w.hit, v[0], 0.05, cls + ' weapon hit');
    if (cls !== 'pyro' && cls !== 'shade' && cls !== 'cleric' && cls !== 'necro' && cls !== 'ranger') near(w.avg, v[0], 0.05, cls + ' weapon avg at crit 0');
    near(w.aps, v[2], 0.005, cls + ' attacks per second');
    near(m.def.taken, v[4], 0.0005, cls + ' damage taken');
  }
  const kn = modelOf('knight', {}, 0), by = (m, s, p) => m.skills[s].parts.find(q => q.id === p);
  near(kn.weapon.avg, 18.675, 0.01, 'Knight weapon avg'); near(kn.weapon.dps, 44.47, 0.1, 'Knight weapon dps');
  near(by(modelOf('knight', {}, 0, { stat: { crit: 0 } }), 0, 'impact').raw, 48.8, 0.05, 'Charge impact'); near(modelOf('knight', {}, 0).def.ehp, 153, 1, 'Knight effective health');
  const rg = modelOf('ranger', {}, 0, { stat: { crit: 0 } }), arrow = by(rg, 0, 'arrow');
  near(arrow.raw, 18.4, 0.05, 'Volley arrow'); ok(arrow.oneFoe === 3 && arrow.fanN === 7, `Volley: 3 of 7 arrows reach a foe at REF (got ${arrow.oneFoe} of ${arrow.fanN})`);
  near(rg.skills[0].perCast, 55.2, 0.1, 'Volley per cast on one foe'); near(rg.skills[0].perCastAll, 128.8, 0.1, 'Volley per cast, all 7'); near(rg.skills[1].perCast, 75.2, 0.1, 'Rain per cast (9.4 x 8)');
  const py = modelOf('pyro', {}, 0, { stat: { crit: 0 } });
  near(py.weapon.extras[0].perAttack, 7.2, 0.05, 'Fire Staff blast'); near(by(py, 0, 'blast').raw, 52, 0.05, 'Nova blast'); near(by(py, 0, 'burn').raw, 40.8, 0.05, 'Nova burn add'); near(by(py, 1, 'impact').raw, 72, 0.05, 'Meteor impact');
  near(by(py, 1, 'crater').here * by(py, 1, 'crater').oneFoe, 52.8, 0.1, 'Meteor crater, 6 ticks');
  const sh = modelOf('shade', {}, 0, { stat: { crit: 0 } });
  near(by(sh, 0, 'slash').raw, 34, 0.05, 'Shadowstep'); near(by(sh, 0, 'slash').avg, 59.5, 0.05, 'Shadowstep always crits'); near(by(sh, 1, 'ambush').avg, 43.75, 0.05, 'Ambush');
  const cl = modelOf('cleric', {}, 0, { stat: { crit: 0 }, ctx: { stratum: 3 } }), leg = by(cl, 1, 'leg');
  near(leg.pre, 50.16, 0.05, 'Judgment leg with its own vulnerability'); near(cl.skills[1].perCast, 100.3, 0.1, 'Judgment per cast (two legs)'); near(by(cl, 0, 'zone').here * 7, 106.4, 0.1, 'Sanctuary 7 ticks');
  const nc = modelOf('necro', {}, 0, { stat: { crit: 0 } }), mn = by(nc, 0, 'minion');
  near(mn.here, 9.69, 0.01, 'Minion hit'); ok(mn.oneFoe === 51, `Minions: 3 x 17 hits (got ${mn.oneFoe})`); near(by(nc, 1, 'burst').raw, 40.2, 0.05, 'Harvest burst');
  // Set 2: Sharpened Edge x2, Stoke x1, weak to Fire (stratum III), crit 5%
  const e2 = modelOf('pyro', { edge: 2, stoke: 1, kindle: 1 }, 0, { ctx: { stratum: 3 }, stat: { crit: 0.05 } });
  near(e2.mult.dmg.total, 1.2, 1e-9, 'Set 2 damage'); near(by(e2, 0, 'blast').here, 52 * 1.2 * (1 + 0.05 * 0.75) * 1.25, 0.05, 'Set 2 Nova blast (class skill: half affinity)');
  near(by(e2, 0, 'burn').here, 40.8 * 1.5 * 1.25, 0.05, 'Set 2 Nova burn (full affinity, Burn strength)');
  near(by(e2, 1, 'impact').statusAdd.here, 0.5 * by(e2, 1, 'impact').pre * 1.5 * 1.25, 0.05, 'Set 2 Meteor burn add (affinity once)');
  near(by(e2, 1, 'crater').here * by(e2, 1, 'crater').oneFoe, 6 * 8.8 * 1.2 * 1.25, 0.1, 'Set 2 crater, 6 ticks');
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
function stage(cls, boons, wi, stat, relics, dist) {
  const w = new ED.World({ seed: 11, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  if (relics) p.relics = relics.slice();
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  Object.assign(p.stats, stat || {}, { crit: 0 }); p.stats.sn = {};
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
  ['knight', {}, 0], ['knight', {}, 1], ['knight', { jugShock: 0.4, s1Range: 90 }, 0], ['knight', { orbit: 3, orbitMul: 0.15 }, 1],
  ['ranger', {}, 0], ['ranger', {}, 1], ['ranger', { rainHail: 1 }, 1], ['ranger', { skyfall: 1 }, 1], ['ranger', { shower: 0.4, skyTwin: 0.5, skyfall: 1 }, 1],
  ['pyro', {}, 0], ['pyro', {}, 1], ['pyro', { novaRing: 1 }, 0], ['pyro', { twinMeteor: 0.6 }, 1, 0, true],
  ['shade', {}, 0], ['shade', { stepTwin: 0.5 }, 0], ['shade', {}, 1, 28],
  ['cleric', {}, 0], ['cleric', {}, 1], ['cleric', { twinHammer: 0.75 }, 1],
  ['necro', {}, 0], ['necro', { boneSpikes: 1 }, 0],
];
for (const [cls, stat, slot, dist, skipImpact] of CASES) {
  const { w, p, e } = stage(cls, {}, 0, stat, null, dist);
  const id = slot ? ED.CLASSES[cls].skill2 : ED.CLASSES[cls].skill, tag = `${cls}.${id}${Object.keys(stat).length ? '+' + Object.keys(stat).join(',') : ''}`;
  const m = sheetOf(w, p), sk = m.skills[slot];
  cast(w, p, e, slot);
  if (id === 'vanish') w.playerAttack(p, 0); // the Ambush
  const by = settle(w, e, 20);
  for (const q of sk.parts) {
    if (q.kind === 'zone') continue;
    const key = q.kind === 'sec' ? 'zone' : id + '.' + q.id, got = by[key];
    if (q.kind === 'status') { const s = by['status:' + q.statusEl]; ok(s && Math.abs(s.sum - q.here) <= q.here * 0.03 + 0.2, `${tag} ${q.id}: status damage ${s ? s.sum.toFixed(1) : 0} vs ${q.here.toFixed(1)}`); continue; }
    if (q.oneFoe === 0 && !q.fanN) continue; // conditional parts (per minion, per corpse, per kill)
    if (!got && GEO.has(id + '.' + q.id)) continue;
    if (!got) { if (PENDING.has(q.id)) pending(`${tag} ${q.id}: no hit measured`); else ok(false, `${tag} ${q.id}: no hit measured`); continue; }
    if (skipImpact && q.id === 'impact') continue; // the twin meteor shares the impact's part name
    const per = got.sum / got.n;
    rel(per, q.here, 0.015, `${tag} ${q.id} per hit`);
    if (q.kind === 'minion') continue; // minions walk to the foe: the count is reported, not compared
    ok(got.n === q.oneFoe, `${tag} ${q.id}: ${got.n} ${q.fanN ? 'arrows reached' : 'hits on'} the foe, modelled ${q.oneFoe}`);
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

// ---------------- weapons: attacks on one foe, then the clouds and shots in flight finish ----------------
function weaponRun(cls, wi, boons, o) {
  o = o || {};
  const probe = stage(cls, boons, wi, null), wp = probe.p.stats.weapon, reach = wp.kind === 'melee' ? wp.range * (1 + 0.5 * probe.p.stats.area + probe.p.stats.meleeReach) : 0;
  const { w, p } = stage(cls, boons, wi, o.stat, null, reach ? reach * 0.55 : REF.d);
  if (o.stratum) w.stratum = o.stratum;
  const m = sheetOf(w, p);
  let next = 0, atk = 0;
  run(w, o.secs || 20, () => { if (w.time >= next) { w.playerAttack(p, 0); next = w.time + ED.Stats.attackInterval(p); atk++; } });
  run(w, 4);
  const total = hits.filter(h => !(h.kind === 'dot' && h.raw)).reduce((s, h) => s + h.dealt, 0);
  return { m, total, atk };
}
for (const cls of ED.CLASS_IDS) for (let wi = 0; wi < 3; wi++) {
  const r = weaponRun(cls, wi, {}), id = ED.CLASSES[cls].weapons[wi];
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.04, `${id} damage per attack on one foe`);
}
// forks and route weapons: Heavy, Swift and the Knight Cleave
for (const [cls, boons, tag] of [['knight', { k_atk: 1 }, 'Oath of Steel'], ['knight', { k_atk: 1, k_atk_h: 1 }, 'Oathbreaker'], ['knight', { k_atk: 1, k_atk_s: 1 }, 'Sworn Blade'], ['ranger', { r_atk: 1, r_atk_h: 1 }, 'Ballista'], ['cleric', { c_atk: 1, c_atk_s: 1 }, 'Crusader']]) {
  const r = weaponRun(cls, 0, boons, { secs: 24 });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.05, `${tag} damage per attack`);
}
// evolutions: the strikes of each path (poison builds Venom, which raises later hits: not compared)
for (const [cls, evo, stratum] of [['knight', 'fire', 1], ['pyro', 'fire', 1], ['ranger', 'ice', 1], ['ranger', 'lightning', 1], ['cleric', 'holy', 3], ['shade', 'shadow', 1], ['ranger', 'general', 1], ['knight', 'general', 1], ['necro', 'ice', 1]]) {
  const boons = {}; boons['evo_' + evo] = 1;
  const r = weaponRun(cls, 0, boons, { secs: 30, stratum });
  rel(r.total / r.atk, r.m.weapon.dps / r.m.weapon.aps, 0.06, `${cls} evolution ${evo} damage per attack`);
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

W.hitEnemy = oHit; W.updateEnemy = oUpd;
console.log(`${n} checks, ${fails} failed` + (pend ? `, ${pend} pending (class routes still to be built by their streams)` : ''));
process.exit(fails ? 1 : 0);
