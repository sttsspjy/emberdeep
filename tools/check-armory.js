// Usage: node tools/check-armory.js
// Headless checks of the Armory weapon variants: the ED.ARMORY lists (ids, base weapons, order, costs, names), their Heavy and Swift forks and looks, the weapon choice and its fallbacks (save, menu, host validation),
// the shape primitives in a staged room (combo steps and their reset, slam ahead, pull, ring, a fan of waves) and a short fight with every variant and each of its forks.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const fs = require('fs'), path = require('path'), vm = require('vm');
if (!ED.Net) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const S = ED.Save, St = ED.Stats;
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const VARIANTS = Object.keys(ED.WEAPONS).filter(id => ED.WEAPONS[id].variant);
const clsOf = (id) => ED.CLASS_IDS.find(c => ED.weaponIndex(c, id) >= 0);

// ---------------- the lists ----------------
{
  const names = new Set(Object.values(ED.FORK_NAMES)), base = new Set(Object.keys(ED.WEAPONS).filter(id => !ED.WEAPONS[id].variant).map(id => ED.WEAPONS[id].name));
  for (const c of ED.CLASS_IDS) {
    const list = ED.ARMORY[c];
    let last = -1;
    for (const e of list) {
      const w = ED.WEAPONS[e.id], wi = ED.CLASSES[c].weapons.indexOf(e.weapon);
      ok(w && w.variant === e.weapon && wi >= 0, `${c} ${e.id}: an ED.WEAPONS variant of the hero's ${e.weapon}`);
      ok(wi >= last, `${c} ${e.id}: the list is ordered by the base weapon's index`); last = wi;
      ok(e.cost === [40, 60, 80][wi], `${c} ${e.id}: costs ${[40, 60, 80][wi]} embers (got ${e.cost})`);
      ok(e.name === w.name && e.desc === w.desc && e.desc.length > 10, `${c} ${e.id}: name and text`);
      ok(!names.has(w.name) && !base.has(w.name), `${e.id}: the name ${w.name} is not a fork's or a base weapon's`);
      ok(w.kind === ED.WEAPONS[e.weapon].kind && w.look === ED.WEAPONS[e.weapon].look, `${e.id}: the kind and look family of its base`);
    }
    ok(list.length <= 63, c + ': the save code holds the list');
  }
  ok(VARIANTS.every(id => ED.ARMORY[clsOf(id)].some(e => e.id === id)), 'every variant weapon has its Armory entry');
  ok(JSON.stringify(ED.weaponChoices('knight').slice(0, 2)) === JSON.stringify(['longsword', 'armingsword']), 'weapon choices: a base weapon, then its variants');
}

// ---------------- forks and looks ----------------
for (const id of VARIANTS) {
  const cls = clsOf(id), t = ED.CLASS_CARDS[cls].attack, w = ED.WEAPONS[id];
  ok(ED.FORK_LOOKS[id] && ED.FORK_LOOKS[id].art && !ED.FORK_LOOKS[id].op, id + ': a look of its own (a sprite, no fork overlay)');
  for (const [k, fid] of [['heavy', t.forks[0]], ['swift', t.forks[1]]]) {
    const f = ED.forkWeapon(id, fid);
    ok(f !== w && f.fork === k && f.base === id && f.name === ED.FORK_NAMES[id + '@' + k], `${id}@${k}: forkWeapon names it ${ED.FORK_NAMES[id + '@' + k]}`);
    ok(ED.FORK_LOOKS[id + '@' + k] && ED.FORK_LOOKS[id + '@' + k].tint === ED.FORK_LOOKS[id].tint, `${id}@${k}: its fork look in the variant's tint`);
    for (const key of ['combo', 'ahead', 'pull', 'ring', 'variant', 'raise']) if (w[key]) ok(f[key] === w[key], `${id}@${k} keeps ${key}`);
    near(f.dmg / f.rate, 1.1 * w.dmg / w.rate, 0.01 * w.dmg / w.rate, `${id}@${k}: nominal damage per second 1.1 x the variant`);
    ok(ED.forkWeapon(id, fid) === f, `${id}@${k}: memoized`);
    const st = St.compute({ cls, weapon: id, boons: { [t.t1]: 1, [fid]: 1 }, relics: [], meta: META(), pact: 0 });
    ok(st.weaponId === id + '@' + k && st.weapon.name === f.name, `${id}@${k}: the stat block wields the fork`);
  }
  const c = w.combo;
  if (c) near(c.iv.reduce((a, b) => a + b, 0), c.steps.length, 1e-9, id + ': combo step intervals average the mean interval');
}

// ---------------- the weapon choice and its fallbacks ----------------
{
  const own = ['armingsword', 'earthbreaker'];
  ok(ED.weaponPick('knight', 'armingsword', 1, own) === 'armingsword', 'an owned variant of weapon 0 is wielded at mastery 1');
  ok(ED.weaponPick('knight', 'armingsword', 1, []) === 'longsword', 'a refunded variant falls back to its base');
  ok(ED.weaponPick('knight', 'earthbreaker', 2, own) === 'longsword', 'a variant of a locked base falls back to weapon 0');
  ok(ED.weaponPick('knight', 'earthbreaker', 3, own) === 'earthbreaker', 'a variant of an unlocked base is wielded');
  ok(ED.weaponPick('knight', 'katars', 10, ['katars']) === 'longsword' && ED.weaponPick('knight', undefined, 10, own) === 'longsword', "another hero's variant or no choice: weapon 0");
  ok(ED.weaponPick('knight', 'glaive', 6, []) === 'glaive' && ED.weaponPick('knight', 'glaive', 5, []) === 'longsword', 'base weapons keep their mastery gates');
  // host validation of a guest's pick
  const pick = (weapon, armory, cls) => ED.Net.cleanPick({ cls: cls || 'knight', weapon, meta: { up: [], mastery: 3, armory } });
  ok(pick('armingsword', ['armingsword']).weapon === 'armingsword', 'host: a variant the guest owns is accepted');
  ok(pick('armingsword', []).weapon === 'longsword', 'host: a variant the guest does not own becomes its base');
  ok(pick('katars', ['katars']).weapon === 'longsword', "host: another hero's variant becomes weapon 0");
  ok(pick(42, ['armingsword']).weapon === 'longsword' && pick('__proto__', []).weapon === 'longsword' && pick('constructor', []).weapon === 'longsword', 'host: a malformed weapon becomes weapon 0');
  ok(JSON.stringify(pick('hookglaive', ['hookglaive', 'nope']).meta.armory) === '["hookglaive"]', 'host: unknown armory ids are dropped');
  // the profile: a stored variant choice survives sanitizing, a buy waits for the base weapon
  const p = S.defaultProfile();
  p.sel = { cls: 'knight', weapon: { knight: 'earthbreaker', ranger: 'nonsense' } };
  const q = S.decode(S.encode(p)), sane = S.normalize(JSON.parse(JSON.stringify(p)));
  ok(q && q.armory && q.armory.knight.length === ED.ARMORY.knight.length, 'a fresh profile has a bit per Armory entry');
  ok(sane.sel.weapon.knight === 'earthbreaker' && sane.sel.weapon.ranger === undefined, 'a stored variant choice survives the profile check, nonsense does not');
  p.embers = 500;
  ok(!S.armoryOpen(p, 'knight', 'earthbreaker') && !S.buyArmory(p, 'knight', 'earthbreaker') && p.embers === 500, 'a variant of a locked base weapon cannot be bought');
  ok(S.armoryOpen(p, 'knight', 'armingsword') && S.buyArmory(p, 'knight', 'armingsword') && p.embers === 460, 'a variant of weapon 0 costs 40 embers');
  p.mastery[ED.CLASS_IDS.indexOf('knight')] = ED.MASTERY_XP[2]; // mastery 3: the Warhammer
  ok(S.buyArmory(p, 'knight', 'earthbreaker') && p.embers === 400, 'the Earthbreaker opens with the Warhammer and costs 60');
  ok(JSON.stringify(S.metaBundle(p, 'knight').armory) === '["armingsword","earthbreaker"]', 'the meta bundle carries the owned variants');
  ok(S.refundArmory(p, 'knight', 'earthbreaker') && p.embers === 460 && ED.weaponPick('knight', 'earthbreaker', 3, S.metaBundle(p, 'knight').armory) === 'warhammer', 'a refund returns the embers and the choice falls back to the Warhammer');
}

// ---------------- the primitives in a staged room ----------------
function stage(cls, weapon, boons) {
  const w = new ED.World({ seed: 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon, meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  p.stats.crit = 0;
  w.enemies.length = 0; w.enc = null; w.locked = false;
  return { w, p };
}
const foe = (w, x, y) => { const e = w.spawnEnemy('skeleton', x, y); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 50000; e.spawnT = 0; return e; };
const run = (w, secs) => { for (let i = 0; i < Math.round(secs * 60); i++) w.update(1 / 60); };
const spy = (w) => { const log = [], o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const d = o.call(this, e, b, s); if (d > 0) log.push({ e, d, part: s && s.part, kind: (s && s.kind) || 'weapon', t: this.time }); return d; }; return log; };
{ // combo: slash, slash, thrust (longer, narrower, harder); the steps cycle and restart after an idle
  const { w, p } = stage('knight', 'armingsword'), e = foe(w, p.x + 70, p.y), log = spy(w), ks = [];
  for (let i = 0; i < 4; i++) { w.playerAttack(p, 0); ks.push(p.comboK); run(w, St.stepInterval(p)); }
  ok(ks.join() === '0,1,2,0', 'Arming Sword: the steps cycle 0, 1, 2, 0: ' + ks.join());
  ok(log.length === 1 && log[0].e === e, 'of four attacks only the thrust (range x1.6) reaches a foe at 70: ' + log.length);
  run(w, 2); w.playerAttack(p, 0);
  ok(p.comboK === 0, 'the combo restarts after an idle longer than its reset');
  const iv = [0, 1, 2].map(k => { p.comboK = k; return St.stepInterval(p); });
  near(iv[0] / iv[2], 0.75, 1e-9, 'a quick slash takes 0.75 of the thrust\'s interval');
  near((iv[0] + iv[1] + iv[2]) / 3, St.attackInterval(p), 1e-9, 'the steps average the mean interval');
  const w2 = St.stepWeapon(p.stats, 2);
  near(w2.dmg / p.stats.weapon.dmg, 1.9, 1e-9, 'the thrust deals x1.9'); ok(w2.pose === 'thrust' && w2.arc < 1 && w2.range > p.stats.weapon.range, 'the thrust is long and narrow');
  const { w: w3, p: p3 } = stage('knight', 'armingsword'); w3.playerAttack(p3, 0, 0, 2);
  ok(p3.comboK === 2, 'a step the attacker\'s control sends is played'); w3.playerAttack(p3, 0, 0, 7); ok(p3.comboK === 0, 'a step out of range is decided by the host');
}
{ // burst bows: three shots 0.1 s apart, then a 0.55 s reload
  const { w, p } = stage('ranger', 'burstbows'), iv = [];
  for (let i = 0; i < 3; i++) { w.playerAttack(p, 0); iv.push(St.stepInterval(p)); run(w, iv[i]); }
  near(iv[0], 0.1, 1e-6, 'Burst Bows: 0.1 s between the shots of a burst'); near(iv[2], 0.55, 1e-6, 'Burst Bows: 0.55 s reload');
}
{ // katars: stab, stab, spin all around
  const { w, p } = stage('shade', 'katars'), front = foe(w, p.x + 25, p.y), back = foe(w, p.x - 25, p.y), log = spy(w);
  for (let i = 0; i < 3; i++) { w.playerAttack(p, 0); run(w, St.stepInterval(p)); }
  ok(log.filter(h => h.e === back).length === 1 && log.filter(h => h.e === front).length === 3, 'Katars: the stabs hit ahead, the spin all around');
}
{ // slam ahead: a foe at the slam point is hit, one behind the hero is not; the shock centres on the slam
  const { w, p } = stage('knight', 'earthbreaker'), far = foe(w, p.x + 90, p.y), back = foe(w, p.x - 20, p.y), log = spy(w);
  w.fx.length = 0; w.playerAttack(p, 0);
  ok(log.some(h => h.e === far && h.kind === 'weapon') && !log.some(h => h.e === back && h.kind === 'weapon'), 'Earthbreaker: the slam strikes ahead, not behind');
  const sw = w.fx.find(f => f.t === 'swing'), bm = w.fx.find(f => f.t === 'boom');
  ok(sw && sw.sr === 48 && sw.r === 58, 'the swing event carries the slam (r 58, sr 48)');
  ok(bm && Math.abs(bm.x - (p.x + 58)) <= 1, 'the shockwave centres on the slam point');
}
{ // pull: a struck foe is dragged toward the hero; a boss never
  const { w, p } = stage('knight', 'hookglaive'), e = foe(w, p.x + 70, p.y), x0 = e.x;
  w.fx.length = 0; w.playerAttack(p, 0); run(w, 0.6);
  ok(x0 - e.x > 25 && e.x > p.x + 20, `Hooked Glaive: the foe is pulled toward the hero (${(x0 - e.x).toFixed(1)} px)`);
  ok(w.fx.some(f => f.t === 'pull' && f.pts.length === 1), 'the pull event names the pulled foe');
  const { w: wb, p: pb } = stage('shade', 'chainsickle'), b = foe(wb, pb.x + 70, pb.y); b.boss = true; const bx = b.x;
  wb.playerAttack(pb, 0); run(wb, 0.6);
  ok(Math.abs(b.x - bx) < 1, 'Chain Sickle: a boss is never pulled');
}
{ // ring: every 3rd swing hits a foe behind the hero as Holy class damage; no wave
  const { w, p } = stage('cleric', 'radiantmace'), back = foe(w, p.x - 40, p.y), log = spy(w);
  for (let i = 0; i < 3; i++) { w.playerAttack(p, 0); run(w, St.stepInterval(p)); }
  ok(log.filter(h => h.e === back && h.part === 'ring').length === 1, 'Radiant Mace: the 3rd swing rings a foe behind the hero');
  ok(!w.projs.some(q => q.kind === 'wave'), 'Radiant Mace sends no wave');
  const st = St.compute({ cls: 'cleric', weapon: 'radiantmace', boons: { c_atk: 1 }, relics: [], meta: META(), pact: 0 });
  ok(!st.weapon.wave && st.weapon.ring, 'Dawnbringer gives a ring weapon no wave');
}
{ // a fan of waves: every 3rd slam sends three
  const { w, p } = stage('cleric', 'gavel');
  for (let i = 0; i < 3; i++) w.playerAttack(p, 0);
  ok(w.projs.filter(q => q.kind === 'wave').length === 3, "Judge's Gavel: three waves on the 3rd slam");
}
// ---------------- a short fight with every variant and each fork ----------------
for (const id of VARIANTS) {
  const cls = clsOf(id), t = ED.CLASS_CARDS[cls].attack;
  for (const boons of [{}, { [t.t1]: 1, [t.forks[0]]: 3 }, { [t.t1]: 1, [t.forks[1]]: 3 }]) {
    let err = null, dealt = 0;
    try {
      const { w, p } = stage(cls, id, boons);
      for (let i = 0; i < 6; i++) { const e = w.spawnEnemy('skeleton', p.x + 40 + 12 * i, p.y + (i - 3) * 14); e.spawnT = 0; }
      const hp0 = w.enemies.reduce((a, e) => a + e.hp, 0);
      let next = 0;
      for (let i = 0; i < 600; i++) { w.update(1 / 60); if (w.time >= next) { const f = w.enemies.find(e => e.hp > 0); w.playerAttack(p, f ? Math.atan2(f.y - p.y, f.x - p.x) : 0); next = w.time + St.stepInterval(p); } }
      dealt = hp0 - w.enemies.reduce((a, e) => a + Math.max(0, e.hp), 0);
    } catch (e) { err = e; }
    ok(!err, `${id} ${Object.keys(boons).join('+') || 'plain'}: a fight runs without errors${err ? ': ' + err.stack : ''}`);
    ok(dealt > 0, `${id} ${Object.keys(boons).join('+') || 'plain'}: deals damage`);
  }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
