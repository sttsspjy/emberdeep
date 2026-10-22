// Usage: node tools/check-fodder.js
// Headless checks of the fodder kill-hook contract in combat.js: a fodder death still runs chains and explosions (Reaper, Spore Burst, Wildfire, Short Circuit) but grants no Death Knell or Death's Edge stack and no Grail growth;
// every kill still counts for the run (run.kills, p.kills, summary.kills), and the lifetime kill stat behind the First Blood, Slayer and Legend deeds counts foes that are not fodder.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const S = ED.Save;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

function stage(cls, boons, relics) {
  const w = new ED.World({ seed: 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[0], meta: META() }] });
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

// ---- a Reap: Death Knell and Death's Edge stack only from a foe that is not fodder; the Reaper blast is queued for both ----
for (const type of [FODDER, THREAT]) {
  const { w, p } = stage('shade', { deathknell: 1, deathsedge: 1, reaper: 1 });
  const e = mk(w, p, type); e.hp = 5; e.doom = 10; e.doomOwner = p;
  w.checkReap(e);
  const fod = type === FODDER;
  ok(e.killed && w.run.fodderKills === (fod ? 1 : 0), `${type}: the Reap killed it`);
  ok(fod ? p.knellN === 0 && p.knellT === 0 : p.knellN === 1 && p.knellT > 0, `${type}: Death Knell stacks ${p.knellN}`);
  ok(fod ? !(p.critStacks | 0) : p.critStacks > 0, `${type}: Death's Edge crits ${p.critStacks | 0}`);
  ok(w.chainQ.some(q => q.kind === 'reaper'), `${type}: the Reaper implosion is queued either way`);
}

// ---- explosions and chains run on a fodder death ----
{
  const { w, p } = stage('ranger', { sporeburst: 1, wildfire: 1, shortcircuit: 1 });
  const e = mk(w, p, FODDER), nb = mk(w, p, THREAT, 40);
  e.venom = 60; e.venomOwner = p; e.venomBy = 1; e.burnPool = 30; e.burnOwner = p; e.charge = 20; e.chargeOwner = p;
  w.killEnemy(e, p, {});
  ok(nb.venom > 0, 'Spore Burst: a fodder death gives its neighbours Venom');
  ok(nb.burnPool > 0, 'Wildfire: a burning fodder death sets its neighbours alight');
  ok(w.chainQ.some(q => q.kind === 'sc'), 'Short Circuit: a charged fodder death queues its discharge');
}

// ---- Grail of Ages grows from kills that are not fodder ----
{
  const { w, p } = stage('knight', {}, ['chalice']);
  for (let i = 0; i < 30; i++) w.killEnemy(mk(w, p, FODDER), p, {});
  ok(p.chaliceKills === 0 && p.chaliceHp === 0, `30 fodder kills: no Grail growth (${p.chaliceKills}/${p.chaliceHp})`);
  for (let i = 0; i < 3; i++) w.killEnemy(mk(w, p, THREAT), p, {});
  ok(p.chaliceKills === 3 && p.chaliceHp === 1, `3 other kills: +1 health (${p.chaliceKills}/${p.chaliceHp})`);
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

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
