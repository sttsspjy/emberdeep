// Usage: node tools/check-empower.js
// Headless checks of the empowered-attack registry (src/data/empower.js): for every ED.EMPOWER entry a staged hero attacks 24 times and the entry's test, read before each attack,
// must equal what that attack actually did in the sim (Cleave, twin strike, waves, ring, Litany, Grave Bolt, siege bolt, Flurry, Whirlwind); W.empowerOf and the snapshot's P[28].
// Prints failures and exits 1 when any check fails.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ED } = require('./sim.js');
const W = ED.World.prototype;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const clsOf = (id) => ED.CLASS_IDS.find(c => ED.CLASSES[c].weapons.includes(ED.WEAPONS[id].variant || id));
const idx = (id) => ED.EMPOWER.findIndex(e => e.id === id);

// what each attack did: melee swings (rep, o, arc), weapon fires, rings, Grave swing options
const rec = { swings: [], fires: [], rings: 0, grave: 0 };
const oSwing = W.meleeSwing, oFire = W.fireWeapon, oRing = W.heroRing;
W.meleeSwing = function (p, a, w, crit, rep, o) { rec.swings.push({ rep, o: o || {}, arc: w.arc }); return oSwing.apply(this, arguments); };
W.fireWeapon = function (p, a, w, crit, o) { rec.fires.push(o || {}); return oFire.apply(this, arguments); };
W.heroRing = function (p, w, co, echo) { if (!echo) rec.rings++; return oRing.apply(this, arguments); };
const oOpts = ED.CLS.necro.attackOpts;
ED.CLS.necro.attackOpts = function () { const r = oOpts.apply(this, arguments); if (r) rec.grave++; return r; };

function stage(weapon, stats) {
  const w = new ED.World({ seed: 9, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: clsOf(weapon), weapon, meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0;
  Object.assign(p.stats, { crit: 0 }, stats);
  p.atkCount = 0;
  return { w, p };
}
// One attack: returns the projectiles it spawned (owner p0).
function attack(w, p) {
  rec.swings.length = 0; rec.fires.length = 0; rec.rings = 0; rec.grave = 0; w.projs.length = 0; w.fx.length = 0;
  w.playerAttack(p, 0);
  return w.projs.filter(q => q.owner === p.pid);
}
// Runs `count` attacks: before each, the entry's test and W.empowerOf; after it, fired(shots) says whether the effect happened. pre(p, i) stages per-attack state.
function series(label, id, weapon, stats, fired, o) {
  o = o || {};
  const { w, p } = stage(weapon, stats), e = ED.EMPOWER[idx(id)];
  ok(!!e, `${label}: entry ${id} registered`);
  if (!e) return;
  let yes = 0, no = 0, bad = 0;
  for (let i = 0; i < (o.count || 24); i++) {
    if (o.pre) o.pre(p, i, w);
    const want = e.test(p, (p.atkCount | 0) + 1, w.time), k = w.empowerOf(p);
    const shots = attack(w, p), did = !!fired(shots, p, w);
    if (want !== did) { bad++; if (bad <= 3) ok(false, `${label}: attack ${p.atkCount} test ${want}, sim ${did}`); }
    if (did && !(k > 0)) ok(false, `${label}: attack ${p.atkCount} empowered in the sim but empowerOf 0`);
    if (did) yes++; else no++;
    w.time += 0.5;
  }
  ok(bad === 0 && yes > 0 && no > 0, `${label}: the test matches the sim on every attack (${yes} empowered, ${no} plain, ${bad} wrong)`);
}

const waves = (s) => s.filter(q => q.kind === 'wave').length;
series('Cleave every 3rd', 'cleave', 'longsword', { cleave: 0.5, cleaveN: 0 }, () => rec.swings.some(s => s.o.cleave > 0));
series('Cleave every 5th (cleaveN 2)', 'cleave', 'longsword', { cleave: 0.5, cleaveN: 2 }, () => rec.swings.some(s => s.o.cleave > 0));
series('Cleave Follow-Through window', 'cleave', 'warhammer', { cleave: 0.5, cleaveN: 0, chargeCleave: 0.3 }, () => rec.swings.some(s => s.o.cleave > 0), { pre: (p, i, w) => { if (i % 5 === 0) p.cleaveNext = w.time + 0.3; } });
series('Twin strike (melee)', 'twin', 'longsword', { twinEvery: 5 }, () => rec.swings.some(s => s.rep === 1 && !s.o.spectral && !s.o.twin));
series('Twin strike (shot)', 'twin', 'longbow', { twinEvery: 4 }, () => rec.fires.length === 2);
series('Holy Mace wave', 'wave', 'mace', {}, (s) => waves(s) > 0);
series('Dawn Hammer wave (waveEvery -1)', 'wave', 'dawnhammer', { waveEvery: -1 }, (s) => waves(s) > 0);
series("Judge's Gavel fan", 'wave', 'gavel', {}, (s) => waves(s) === 3);
series('Radiant Mace ring', 'ring', 'radiantmace', {}, () => rec.rings > 0);
series('Litany on the mace', 'litany', 'mace', { litany: 2 }, (s) => waves(s) === 3);
series('Litany on the gavel', 'litany', 'gavel', { litany: 2 }, (s) => waves(s) === 5);
series('Litany on the ring', 'litany', 'radiantmace', { litany: 2 }, (sh, p, w) => w.fx.some(e => e.t === 'hring' && e.k === 3));
series('Grave Bolt swing', 'grave', 'soulscythe', { graveBolt: 1.5, graveN: 3 }, () => rec.grave > 0);
series('Grave Bolt shot', 'grave', 'bonewand', { graveBolt: 1.5, graveN: 3 }, (s) => s.some(q => q.grave));
series('Siege bolt', 'siege', 'longbow', { siege: 5, siegeMul: 1.8 }, (s) => s.some(q => q.siege));
series('Flurry', 'flurry', 'longbow', { flurry: 4, flurryMul: 0.45 }, (s) => s.filter(q => q.team === 0).length >= 3);
series('Whirlwind at full Momentum', 'whirl', 'daggers', { bladeStorm: 0.05, momMax: 5 }, () => rec.swings.some(s => s.o.twin && s.arc >= 6.3),
  { pre: (p, i) => { p.momN = i % 3 === 2 ? 3 : 5; p.momT = 2.5; } });
series('Whirlwind (knives)', 'whirl', 'knives', { bladeStorm: 0.05, momMax: 5 }, (s) => s.filter(q => q.mul === 0.05).length >= 6, { pre: (p) => { p.momN = 5; p.momT = 2.5; } });

// priority, downed, snapshot
{
  const { w, p } = stage('mace', { cleave: 0.5, cleaveN: 0 });
  p.atkCount = 2; ok(w.empowerOf(p) === idx('cleave') + 1, 'Cleave outranks the wave on the same attack');
  p.atkCount = 0; ok(w.empowerOf(p) === 0, 'a plain next attack: 0');
  p.atkCount = 2; p.downed = true; ok(w.empowerOf(p) === 0, 'a downed hero: 0'); p.downed = false;
  const fs0 = stage('longsword', { cleave: 0.5, cleaveN: 0, hold: 'finisher' }), fp = fs0.p; // a held Finisher: its release is attack 3 and never Cleaves
  fp.atkCount = 2; fp.holdOn = true; const fk = fs0.w.empowerOf(fp); rec.swings.length = 0; fs0.w.playerAttack(fp, 0, 0, undefined, true);
  ok(fk !== idx('cleave') + 1 && rec.swings.length > 0 && !rec.swings.some(s => s.o.cleave > 0), `a held Finisher shows no Cleave and its release does not Cleave (${fk})`);
  fp.holdOn = false; fp.atkCount = 5; ok(fs0.w.empowerOf(fp) === idx('cleave') + 1, 'the Cleave shows again once the hold ends');
  ok(ED.EMPOWER.every(e => /^#[0-9a-f]{6}$/i.test(e.col) && e.id && e.name) && new Set(ED.EMPOWER.map(e => e.col)).size === ED.EMPOWER.length && new Set(ED.EMPOWER.map(e => e.id)).size === ED.EMPOWER.length, 'every entry has its own id and colour');
  try {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
    const N = ED.Net;
    ok(N.VERSION === 16, `N.VERSION 16 (${N.VERSION})`);
    p.atkCount = 2; const s1 = JSON.parse(JSON.stringify(N.encodeSnap(w, [], false)));
    p.atkCount = 0; const s0 = JSON.parse(JSON.stringify(N.encodeSnap(w, [], false)));
    ok(s1.P[0][28] === idx('cleave') + 1 && s0.P[0][28] === 0, `P[28] carries W.empowerOf (${s1.P[0][28]}, ${s0.P[0][28]})`);
  } catch (err) { ok(false, 'net.js loads in Node: ' + err.message); }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
