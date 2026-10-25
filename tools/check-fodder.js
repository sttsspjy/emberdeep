// Usage: node tools/check-fodder.js
// Headless checks of the fodder contract in combat.js: a fodder death fires no on-death effect (World.onDeathFx: no class kill hook, no Death's Edge crit) and no Grail growth,
// while the same deaths of a foe that is not fodder still pay out; no element status spreads or bursts on any death; every kill still counts for the run (run.kills, p.kills, summary.kills), and the lifetime kill stat behind the First Blood, Slayer and Legend deeds counts foes that are not fodder;
// a stratum I fodder foe takes at least 3 attacks of every hero's first weapon at base stats (no crits; 2 for a heavy weapon). Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const S = ED.Save;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

function stage(cls, boons, relics, weapon) {
  const w = new ED.World({ seed: 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: weapon || ED.CLASSES[cls].weapons[0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  for (const r of (relics || [])) p.relics.push(r);
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0; w.chainQ.length = 0;
  return { w, p };
}
const FODDER = 'bonemite', THREAT = 'skeleton';
const mk = (w, p, type, dx) => { const e = w.spawnEnemy(type, p.x + (dx || 60), p.y); e.spd = 0; e.cd = 9999; return e; };

ok(ED.World.prototype.onDeathFx.call(null, { fodder: true }) === false && ED.World.prototype.onDeathFx.call(null, { fodder: false }) === true, 'onDeathFx: false for fodder, true otherwise');

// ---- a Reap: a fodder death readies no Death's Edge crit; a threat foe's does ----
for (const type of [FODDER, THREAT]) {
  const { w, p } = stage('shade', { doommark: 1, deathsedge: 1 });
  const e = mk(w, p, type); e.hp = 5; e.doom = 10; e.doomOwner = p;
  w.checkReap(e);
  const fod = type === FODDER;
  ok(e.killed && w.run.fodderKills === (fod ? 1 : 0), `${type}: the Reap killed it`);
  ok(fod ? !(p.critStacks | 0) : p.critStacks > 0, `${type}: Death's Edge crits ${p.critStacks | 0}`);
}

// ---- no element status spreads or bursts on death (fodder or not): the verbs act on living foes ----
for (const type of [FODDER, THREAT]) {
  const { w, p } = stage('ranger', { kindle: 1, wildfire: 2, staticcharge: 1, conductor: 2, envenom: 1, miasma: 2 });
  const e = mk(w, p, type), nb = mk(w, p, THREAT, 40);
  e.venom = 60; e.venomOwner = p; e.venomBy = 1; for (let i = 0; i < 6; i++) w.burnStack(e, p, 0); e.charge = 20; e.chargeOwner = p;
  w.fx.length = 0; w.chainQ.length = 0; w.killEnemy(e, p, {}); w.updateChains();
  ok(!(nb.venom > 0) && !(nb.burnN > 0) && !(nb.charge > 0), `${type}: a death passes no Venom, Burn or charge to the neighbour`);
  ok(!w.fx.some(v => v.t === 'boom') && !w.chainQ.length, `${type}: no death burst, nothing queued`);
}

// ---- class kill hooks never run for fodder: Death Mark (Ranger), Corpse Explosion corpses (Necromancer) ----
{
  const { w, p } = stage('ranger', {});
  p.stats.deathMark = 0.5;
  const e = mk(w, p, FODDER); e.mark = 5; e.markBy = p.pid; w.projs.length = 0;
  w.killEnemy(e, p, {});
  ok(w.projs.length === 0, `a marked fodder death fires no Death Mark arrows (${w.projs.length})`);
  const t = mk(w, p, THREAT); t.mark = 5; t.markBy = p.pid; w.killEnemy(t, p, {});
  ok(w.projs.length > 0, `a marked threat death does (${w.projs.length})`);
  const { w: wn, p: pn } = stage('necro', {}); pn.stats.corpse = 1;
  wn.killEnemy(mk(wn, pn, FODDER), pn, {}); ok(wn.corpses.length === 0, 'a fodder death leaves no corpse for Corpse Explosion');
  wn.killEnemy(mk(wn, pn, THREAT), pn, {}); ok(wn.corpses.length === 1, 'a threat death does');
}

// ---- Grail of Ages grows from kills that are not fodder ----
{
  const { w, p } = stage('knight', {}, ['chalice']);
  for (let i = 0; i < 30; i++) w.killEnemy(mk(w, p, FODDER), p, {});
  ok(p.chaliceKills === 0 && p.chaliceHp === 0, `30 fodder kills: no Grail growth (${p.chaliceKills}/${p.chaliceHp})`);
  const per = ED.RELICS.chalice.kills;
  for (let i = 0; i < per; i++) w.killEnemy(mk(w, p, THREAT), p, {});
  ok(p.chaliceKills === per && p.chaliceHp === 1, `${per} other kills: +1 health (${p.chaliceKills}/${p.chaliceHp})`);
}

// ---- every kill counts for the run; the lifetime stat and its deeds count foes that are not fodder ----
{
  const { w, p } = stage('knight', {});
  for (let i = 0; i < 40; i++) w.killEnemy(mk(w, p, FODDER), p, {});
  for (let i = 0; i < 9; i++) w.killEnemy(mk(w, p, THREAT), p, {});
  const sum = w.summary();
  ok(w.run.kills === 49 && w.run.fodderKills === 40 && p.kills === 49, `run.kills ${w.run.kills}, fodderKills ${w.run.fodderKills}, p.kills ${p.kills}: all kills count`);
  ok(sum.kills === 49 && sum.fodderKills === 40 && sum.players.p0.kills === 49, 'the run summary carries every kill and the fodder share');
  const prof = S.defaultProfile(), res = S.applyRun(prof, Object.assign({ cls: 'knight' }, sum));
  ok(prof.stats.kills === 9 && !res.deeds.some(d => d.id === 'firstblood'), `49 kills of which 40 fodder: lifetime kills ${prof.stats.kills}, First Blood stays locked`);
  for (let i = 0; i < 41; i++) w.killEnemy(mk(w, p, THREAT), p, {});
  const prof2 = S.defaultProfile(), res2 = S.applyRun(prof2, Object.assign({ cls: 'knight' }, w.summary()));
  ok(prof2.stats.kills === 50 && res2.deeds.some(d => d.id === 'firstblood'), `50 non-fodder kills unlock First Blood (${prof2.stats.kills})`);
  const prof3 = S.defaultProfile(); S.applyRun(prof3, { cls: 'knight', kills: 30, stratum: 1 });
  ok(prof3.stats.kills === 30, 'a partial summary without fodderKills counts every kill');
}

// ---- a fodder touch: one per hero per FODDER_TOUCH_CD, whatever the number of fodder on it ----
{
  const { w, p } = stage('knight', {});
  p.invuln = 0; w.enc = {};
  const fs = []; for (let i = 0; i < 6; i++) { const f = w.spawnEnemy(FODDER, p.x + 2, p.y); f.cd = 99; fs.push(f); }
  const hp0 = p.hp; let t = 0;
  for (; t < 3; t += 1 / 60) { w.time += 1 / 60; p.invuln = 0; for (const f of fs) { f.x = p.x + 2; f.y = p.y; f.recoil = 0; w.updateEnemy(f, 1 / 60); } }
  const hits = hp0 - p.hp, want = Math.ceil(3 / ED.World.FODDER_TOUCH_CD);
  ok(hits >= 1 && hits <= want, `6 fodder on a hero for 3 s: ${hits} touch damage (at most ${want})`);
}

// ---- hits to kill: a stratum I fodder foe takes at least 3 attacks of every hero's first weapon at base stats (no crits), 2 for a heavy weapon ----
const hitsToKill = (cls, weapon) => {
  const { w, p } = stage(cls, {}, [], weapon);
  p.stats.crit = 0; p.critStacks = 0; w.allies.length = 0;
  const wd = ED.WEAPONS[p.weapon], d = wd.kind === 'melee' ? Math.min(30, (wd.range || 40) * 0.6) : 110;
  const e = w.spawnEnemy(FODDER, p.x + d, p.y); e.spd = 0; e.cd = 9999; e.spawnT = 0;
  let k = 0;
  if (p.stats.kind === 'bell') { // bell strikes come from the bell's flight (class-bell.js): count strikes at the top speed factor (x1.8)
    for (; k < 30 && e.hp > 0; k++) w.hitEnemy(e, p.stats.weapon.dmg, { p, kind: 'weapon', wpn: false, mul: 1.8, part: 'bell.hurl' });
    return { k, hp: e.maxHp, heavy: !!p.stats.heavy };
  }
  for (; k < 30 && e.hp > 0; k++) {
    w.time += 2; w.playerAttack(p, 0);
    for (let i = 0; i < 90 && e.hp > 0; i++) { w.time += 1 / 60; w.updateProjectiles(1 / 60); w.updateZones(1 / 60); w.updateChains(); e.x = p.x + d; e.y = p.y; }
  }
  return { k, hp: e.maxHp, heavy: !!p.stats.heavy };
};
for (const cls of ED.CLASS_IDS) {
  const wpn = ED.CLASSES[cls].weapons[0], r = hitsToKill(cls, wpn);
  console.log(`hits to kill a stratum I fodder (${r.hp} hp): ${cls} ${wpn} ${r.k}`);
  ok(r.k >= (r.heavy ? 2 : 3) && r.k < 30, `${cls} ${wpn}: ${r.k} attacks kill a stratum I fodder foe (at least ${r.heavy ? 2 : 3})`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
