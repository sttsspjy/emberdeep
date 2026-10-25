// Usage: node tools/check-armory-b.js
// Headless checks of the projectile-shape Armory variants (Seeker Bow, Bolt Thrower, Sunlance, Cinder Scatter, Mortar Tome, Boomerang Blades, Votive Lamp, Bone Splinter, Miasma Staff) and their flight primitives in combat.js:
// data (base weapon, Armory cost by base index, fork names and looks), ED.forkWeapon on each, short fights with each variant and fork, and the beam, lob, boomerang, pool and trail rules with the route cards that act on them.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const U = ED.U, W = ED.World.prototype;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const VARIANTS = ['seekerbow', 'boltthrower', 'sunlance', 'cinderscatter', 'mortar', 'boomerang', 'votive', 'splinter', 'miasma'];
const clsOf = (id) => ED.CLASS_IDS.find(c => ED.CLASSES[c].weapons.includes(ED.WEAPONS[id].variant));

// hits on staged dummies (pinned, no AI, 1e9 health)
const hits = [];
const oHit = W.hitEnemy;
W.hitEnemy = function (e, base, src) { const d = oHit.call(this, e, base, src); if (e._dummy && d > 0) hits.push({ id: e.id, d, kind: src && src.kind, part: src && src.part, wpn: !!(src && src.wpn), t: this.time }); return d; };
const oUpd = W.updateEnemy;
W.updateEnemy = function (e, dt) { if (!e._dummy) return oUpd.call(this, e, dt); e.flash -= dt; e.mark -= dt; e.invulnT = (e.invulnT || 0) - dt; e.kbx = e.kby = 0; this.tickStatuses(e, dt); };
const dummy = (w, x, y) => { const e = w.spawnEnemy('skeleton', x, y); e._dummy = true; e.spd = 0; e.cd = 1e9; e.r = 12; e.hp = e.maxHp = 1e9; e.def = Object.assign({}, e.def, { guard: undefined }); return e; };
function stage(id, boons, o) {
  o = o || {};
  const cls = clsOf(id);
  const w = new ED.World({ seed: o.seed || 5, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: id, meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const b in (boons || {})) p.boons[b] = boons[b];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  p.stats.crit = o.crit || 0;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0;
  hits.length = 0;
  return { w, p };
}
const run = (w, secs, f) => { for (let i = 0, k = Math.round(secs * 60); i < k; i++) { if (f) f(); w.update(1 / 60); } };
const events = (w) => { const out = []; const em = w.emit; w.emit = function (ev) { out.push(ev); return em.call(this, ev); }; return out; };

// ---------------- data ----------------
const names = new Set(Object.values(ED.FORK_NAMES).filter((v, i, a) => a.indexOf(v) !== i));
ok(names.size === 0, 'fork names are unique: ' + [...names].join(', '));
for (const id of VARIANTS) {
  const w = ED.WEAPONS[id], cls = w && clsOf(id);
  ok(!!w && !!cls, `${id}: a weapon whose variant base belongs to a class`);
  if (!cls) continue;
  const bi = ED.CLASSES[cls].weapons.indexOf(w.variant), e = (ED.ARMORY[cls] || []).find(x => x.id === id);
  ok(!!e && e.weapon === w.variant && e.cost === [40, 60, 80][bi] && !!e.name && !!e.desc, `${id}: Armory entry on ${cls}, base ${w.variant}, cost ${e && e.cost} (base index ${bi})`);
  ok(!Object.values(ED.WEAPONS).some(x => x !== w && x.name === w.name) && !Object.values(ED.FORK_NAMES).includes(w.name), `${id}: name ${w.name} is its own`);
  for (const k of ['', '@heavy', '@swift']) ok(!!ED.FORK_LOOKS[id + k] && ED.FORK_LOOKS[id + k].art === 'weapon.' + w.variant, `${id}${k}: a look drawn from the base art`);
  const t = ED.CLASS_CARDS[cls].attack;
  for (const [fi, kind] of [[0, 'heavy'], [1, 'swift']]) {
    const f = ED.forkWeapon(id, t.forks[fi]), name = ED.FORK_NAMES[id + '@' + kind];
    ok(f && f.fork === kind && f.base === id && f.name === name && !!name, `${id}: forkWeapon ${kind} -> ${f && f.name}`);
    ok(f && f.dmg > 0 && f.rate > 0 && isFinite(f.dmg / f.rate) && Math.abs(f.dmg / f.rate / (w.dmg / w.rate) - 1.1) < 0.05, `${id} ${kind}: nominal dps x1.1`);
    ok(f && ['beam', 'lob', 'ret', 'pool', 'trail', 'homing', 'variant'].every(k => f[k] === w[k]), `${id} ${kind}: keeps its flight shape`);
  }
}
// save code round trip with every owned variant (one bit per entry)
{
  const S = ED.Save, p = S.defaultProfile();
  {
    for (const c of ED.CLASS_IDS) p.armory[c] = (ED.ARMORY[c] || []).map(() => 1);
    const q = S.decode(S.encode(p));
    ok(q && ED.CLASS_IDS.every(c => (ED.ARMORY[c] || []).every((e, i) => q.armory[c][i] === 1)), 'save code keeps every owned variant');
  }
}

// ---------------- short fights: each variant and each fork at rank 3 against live foes ----------------
for (const id of VARIANTS) {
  const cls = clsOf(id), t = ED.CLASS_CARDS[cls].attack;
  for (const boons of [{}, { [t.t1]: 1, [t.forks[0]]: 3 }, { [t.t1]: 1, [t.forks[1]]: 3 }]) {
    const { w, p } = stage(id, boons, { crit: 0.2 });
    for (let i = 0; i < 6; i++) { const e = w.spawnEnemy(i % 2 ? 'skeleton' : 'bonemite', p.x + 70 + (i % 3) * 24, p.y - 30 + i * 12); e.hp = e.maxHp = 400; }
    let err = null, next = 0;
    const hp0 = w.enemies.reduce((s, e) => s + e.hp, 0);
    try {
      run(w, 6, () => {
        const tg = w.nearestEnemy(p.x, p.y, 600);
        if (tg && w.time >= next) { p.atkD = Math.hypot(tg.x - p.x, tg.y - p.y); w.playerAttack(p, Math.atan2(tg.y - p.y, tg.x - p.x)); next = w.time + ED.Stats.attackInterval(p); }
        if (w.time > 2 && w.time < 2.02) w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 80, y: p.y, x1: p.x + 80, y1: p.y }, 0);
      });
      ED.Net && ED.Net.encodeSnap && ED.Net.encodeSnap(w, w.fx || [], true);
    } catch (e) { err = e; }
    const dealt = hp0 - w.enemies.reduce((s, e) => s + Math.max(0, e.hp), 0);
    ok(!err && dealt > 0, `${id} ${Object.keys(boons).join('+') || 'plain'}: a 6 s fight runs (${err ? err.stack.split('\n').slice(0, 2).join(' ') : Math.round(dealt) + ' damage'})`);
  }
}

// ---------------- beam ----------------
{
  const { w, p } = stage('sunlance'), ev = events(w);
  const a = dummy(w, p.x + 60, p.y - 4), b = dummy(w, p.x + 110, p.y - 4), c = dummy(w, p.x + 160, p.y - 4), off = dummy(w, p.x + 110, p.y + 40), far = dummy(w, p.x + 300, p.y - 4);
  w.playerAttack(p, 0);
  const by = (e) => hits.filter(h => h.id === e.id && h.kind === 'weapon');
  ok(by(a).length === 1 && by(b).length === 1 && by(c).length === 1 && w.projs.length === 0, 'Sunlance: one instant hit on every foe on the line, no projectile');
  ok(!by(off).length && !by(far).length, 'Sunlance: a foe off the line or past its length is not hit');
  ok(by(a)[0].wpn, 'Sunlance hits are weapon hits');
  const bev = ev.find(e => e.t === 'beam');
  ok(!!bev && Math.abs(bev.x1 - (p.x + 230)) <= 10, `Sunlance: a beam event to the end of its ${ED.WEAPONS.sunlance.speed * ED.WEAPONS.sunlance.life} px (${bev && bev.x1 - p.x})`);
}
{ // Ember Bolt: every foe the beam strikes cuts the spell cooldowns (one cut per foe struck)
  const { w, p } = stage('sunlance');
  dummy(w, p.x + 60, p.y - 4); dummy(w, p.x + 120, p.y - 4);
  p.emberAcc = 0; p.emberB = ED.CONST.EMBER_CAP; w.playerAttack(p, 0);
  const one = ED.CONST.EMBER_PS * p.stats.atkInterval;
  ok(Math.abs(p.emberAcc - 2 * one) < 1e-9, `Ember Bolt: a beam through two foes cuts twice (${p.emberAcc.toFixed(3)} s)`);
}
{ // Afterburn: after a spell the Sunlance fires two more beams in a fan
  const { w, p } = stage('sunlance', { p_atk: 1, p_atk_s: 1 }), ev = events(w);
  w.playerSkill(p, 0, {}, 2); w.playerAttack(p, 0);
  ok(ev.filter(e => e.t === 'beam').length === 3, `Afterburn: one attack after a spell fires 3 beams (${ev.filter(e => e.t === 'beam').length})`);
}
{ // a wall cuts the beam
  const { w, p } = stage('sunlance'), ev = events(w), room = w.room, T = ED.CONST.TILE;
  let wx = -1;
  for (let d = 40; d < 220; d += 4) { const t = ED.Dungeon.tileAt(room, p.x - d, p.y - 4); if (ED.Dungeon.blocksShots(t, false)) { wx = d; break; } }
  if (wx > 0) { w.playerAttack(p, Math.PI); const bev = ev.find(e => e.t === 'beam'); ok(bev && p.x - bev.x1 <= wx + 2, `a wall cuts the beam (${bev && p.x - bev.x1} <= ${wx})`); } else ok(true, 'no wall within reach to the west');
  void T;
}

// ---------------- lob ----------------
{
  const { w, p } = stage('mortar');
  const near = dummy(w, p.x + 50, p.y - 4), tgt = dummy(w, p.x + 180, p.y - 4);
  p.atkD = 180; w.playerAttack(p, 0);
  const z = w.zones.find(q => q.kind === 'tele' && q.team === 0 && q.lob);
  ok(!!z && Math.abs(z.x - (p.x + 180)) < 1 && z.r === ED.WEAPONS.mortar.explode.r, `Mortar: a friendly telegraph with the lob arc at the cursor distance, blast radius ${ED.WEAPONS.mortar.explode.r}`);
  run(w, 0.5);
  ok(!hits.length, 'Mortar: nothing is hit before the shell lands');
  run(w, 0.1);
  ok(hits.some(h => h.id === tgt.id && h.kind === 'weapon' && h.wpn) && !hits.some(h => h.id === near.id), 'Mortar: the landing hits foes in the blast as weapon hits and passes over the foe in between');
  hits.length = 0; p.atkD = 9999; w.playerAttack(p, 0);
  const z2 = w.zones.filter(q => q.kind === 'tele' && q.team === 0).pop();
  ok(z2 && Math.hypot(z2.x - p.x, z2.y - p.y) <= ED.WEAPONS.mortar.speed * ED.WEAPONS.mortar.life + 1, 'Mortar: the range clamps the landing');
  hits.length = 0; w.zones.length = 0; p.atkD = NaN; p.aimX = p.x + 120; p.aimY = p.y; w.playerAttack(p, 0);
  const z3 = w.zones.filter(q => q.kind === 'tele' && q.team === 0).pop();
  ok(z3 && Math.abs(z3.x - (p.x + 120)) < 1, 'Mortar: without an attack distance the cursor point decides');
  // a fixed seed lands the same blast twice
  const t1 = stage('mortar', {}, { crit: 0.3 }); dummy(t1.w, t1.p.x + 150, t1.p.y - 4); t1.p.atkD = 150; for (let i = 0; i < 5; i++) { t1.w.playerAttack(t1.p, 0); run(t1.w, 1); } const s1 = hits.reduce((s, h) => s + h.d, 0);
  const t2 = stage('mortar', {}, { crit: 0.3 }); dummy(t2.w, t2.p.x + 150, t2.p.y - 4); t2.p.atkD = 150; for (let i = 0; i < 5; i++) { t2.w.playerAttack(t2.p, 0); run(t2.w, 1); } const s2 = hits.reduce((s, h) => s + h.d, 0);
  ok(s1 > 0 && s1 === s2, 'Mortar: deterministic per seed');
}
{ // Ember Bolt and Living Flame on the shell: the landing is a weapon hit, so it cuts the spell cooldowns and adds Burn
  const { w, p } = stage('mortar', { p_el: 1 });
  const e = dummy(w, p.x + 150, p.y - 4); p.atkD = 150; p.emberAcc = 0; p.emberT = 99; // no flush to the client during the check
  w.playerAttack(p, 0); run(w, 0.1); ok(p.emberAcc === 0, 'Ember Bolt: nothing is cut before the shell lands');
  run(w, 0.55);
  ok(Math.abs(p.emberAcc - ED.CONST.EMBER_PS * p.stats.atkInterval) < 0.02, `Ember Bolt: the Mortar landing cuts the spell cooldowns (${p.emberAcc.toFixed(3)} s)`);
  run(w, 0.6);
  ok(e.burnPool > 0 || hits.some(h => h.kind === 'dot'), 'Living Flame: the Mortar blast sets the foe alight');
}

// ---------------- boomerang ----------------
{
  const { w, p } = stage('boomerang');
  const e = dummy(w, p.x + 80, p.y - 4), far = dummy(w, p.x + 220, p.y - 4);
  w.playerAttack(p, 0);
  let maxD = 0; run(w, 1.2, () => { for (const q of w.projs) if (q.kind === 'boomerang') maxD = Math.max(maxD, Math.hypot(q.x - p.x, q.y - p.y)); });
  const on = hits.filter(h => h.id === e.id && h.kind === 'weapon').length;
  ok(on === 2, `Boomerang: a foe on its path is struck once each way (${on})`);
  ok(!hits.some(h => h.id === far.id), 'Boomerang: a foe past its reach is not struck');
  ok(!w.projs.some(q => q.kind === 'boomerang'), 'Boomerang: it is caught again');
  ok(maxD > 150 && maxD < 200, `Boomerang: it flies out about 170 px (${Math.round(maxD)})`);
}
{ // a boomerang flies back to where the hero stands now
  const { w, p } = stage('boomerang');
  w.playerAttack(p, 0); run(w, 0.3); p.y += 40;
  let caught = false; run(w, 1, () => { if (!w.projs.length) caught = true; });
  ok(caught, 'Boomerang: it homes back on a hero who moved');
}
{ // Thousand Cuts Whirlwind: the ring of 6 is boomerangs too
  const { w, p } = stage('boomerang', { s_atk: 1, s_atk_s: 2 });
  p.momN = p.stats.momMax; p.momT = 2; p.atkCount = 3;
  w.playerAttack(p, 0);
  ok(p.stats.bladeStorm > 0 && w.projs.filter(q => q.ret).length >= 7, `Thousand Cuts: the Whirlwind ring flies out and back (${w.projs.filter(q => q.ret).length} boomerangs)`);
}

// ---------------- pool (Votive Lamp) ----------------
{
  const { w, p } = stage('votive');
  w.addPlayer({ pid: 'p1', name: 'B', slot: 1, cls: 'knight', weapon: 'longsword', meta: META() });
  const q = w.players.get('p1'); w.recalc(q, true); q.hp = q.maxHp; q.shield = 0; q.lanternT = 0;
  const e = dummy(w, p.x + 80, p.y - 4); q.x = e.x; q.y = e.y + 20;
  p.shield = 0;
  w.playerAttack(p, 0); run(w, 0.4);
  const z = w.zones.find(z => z.kind === 'holypool');
  ok(!!z && z.owner === 'p0', 'Votive Lamp: the orb ends in a pool of light');
  ok(q.shield > 0 && q.shield <= q.maxHp * 0.015 + 1e-6, `Votive Lamp: an ally in the pool is shielded 1.5% (${q.shield.toFixed(2)})`);
  ok(!(p.shield > 0), 'Votive Lamp: its owner is not');
  const s0 = q.shield; run(w, 0.5); w.playerAttack(p, 0); run(w, 0.4);
  ok(q.shield === s0 || q.lanternT > 0, 'Votive Lamp: at most once per 1.5 s per ally');
  run(w, 2.5);
  ok(hits.filter(h => h.id === e.id && h.kind === 'dot' && h.wpn).length >= 3, 'Votive Lamp: the pool ticks on the foe as a weapon zone');
}
{ // Dawnbringer: the Votive Lamp sends waves like the Sacred Lantern
  const { w, p } = stage('votive', { c_atk: 1 });
  ok(!!p.stats.weapon.wave, 'Dawnbringer gives the Votive Lamp waves');
  w.playerAttack(p, 0); w.playerAttack(p, 0);
  ok(w.projs.some(q => q.kind === 'wave'), 'Dawnbringer: a wave flies');
}

// ---------------- trail (Miasma Staff) ----------------
{
  const { w, p } = stage('miasma');
  w.playerAttack(p, 0); run(w, 1.0);
  const zs = w.zones.filter(z => z.kind === 'plague');
  ok(zs.length === 3, `Miasma Staff: a free flight leaves 3 clouds (${zs.length})`);
  const xs = zs.map(z => Math.round(z.x - p.x)).sort((a, b) => a - b);
  ok(xs[0] > 30 && xs[1] - xs[0] >= 35, `Miasma Staff: the clouds lie along the path (${xs.join(', ')})`);
}
{
  const { w, p } = stage('miasma');
  const e = dummy(w, p.x + 80, p.y - 4);
  w.playerAttack(p, 0); run(w, 0.3);
  const zs = w.zones.filter(z => z.kind === 'plague'), parts = zs.reduce((t, z) => t + z.parts.length, 0);
  ok(parts === 2 && zs.every(z => Math.hypot(z.x - e.x, z.y - e.y) < z.r + e.r), `Miasma Staff: a bolt that strikes a foe at 80 lays two clouds on it (the last joins the one before it: ${zs.length} zones, ${parts} clouds)`);
}
{ // Gravecaller's Grave Bolt keeps laying the trail while it pierces
  const { w, p } = stage('miasma', { n_atk: 1, n_atk_h: 3 });
  for (let i = 0; i < 3; i++) dummy(w, p.x + 60 + i * 40, p.y - 4);
  p.atkCount = p.stats.graveN - 1; w.playerAttack(p, 0);
  ok(w.projs.some(q => q.grave && q.trail), 'Grave Bolt on the Miasma Staff: the bolt keeps its trail');
  run(w, 1);
  ok(w.zones.filter(z => z.kind === 'plague').length === 3, 'Grave Bolt on the Miasma Staff: three clouds along the pierced line');
}

// ---------------- multi-bolt variants ----------------
{
  const { w, p } = stage('splinter', { n_atk: 1, n_atk_h: 3 });
  p.atkCount = p.stats.graveN - 1; w.playerAttack(p, 0);
  ok(w.projs.filter(q => q.grave).length === 3, 'Grave Bolt on the Bone Splinter: each of the three shards is a Grave Bolt');
}
{
  const { w, p } = stage('splinter');
  w.playerAttack(p, 0);
  ok(w.projs.length === 3 && w.projs.every(q => !q.homing), 'Bone Splinter: three shards, none seeking');
}
{
  const { w, p } = stage('boltthrower', { r_atk: 1, r_atk_h: 3 });
  p.atkCount = p.stats.siege - 1; w.playerAttack(p, 0);
  ok(w.projs.filter(q => q.siege).length === 3, 'Siege Ballista on the Bolt Thrower: each bolt of the siege shot is a siege bolt');
}
{
  const { w, p } = stage('seekerbow');
  w.playerAttack(p, 0);
  ok(w.projs.length === 1 && w.projs[0].homing === ED.WEAPONS.seekerbow.homing, 'Seeker Bow: one homing arrow');
  const e = dummy(w, p.x + 120, p.y + 50);
  run(w, 1);
  ok(hits.some(h => h.id === e.id), 'Seeker Bow: the arrow finds a foe off its line');
}
{
  const { w, p } = stage('cinderscatter');
  w.playerAttack(p, 0);
  ok(w.projs.length === 5 && w.projs.every(q => q.kind === 'spark' && !q.burn), 'Cinder Scatter: five plain sparks');
}

console.log(`${n - fails}/${n} armory-b checks passed`);
if (fails) process.exitCode = 1;
