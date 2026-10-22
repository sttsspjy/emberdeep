// Usage: node tools/check-sim.js
// Headless regression checks of sim review fixes: crit-stack grants never lower the count, a boss kill purges hostile shots and pools whichever loop lands it, Smite duo statuses use the pre-affinity Smite,
// Frozen Heart goes through freezeEnemy, a departed hero leaves no thrown shield, fork and crit card text follows the hero's weapon. Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
function stage(cls, boons, seed, wi) {
  const w = new ED.World({ seed: seed || 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0;
  return { w, p };
}
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 1e6; return e; };

// ---- grantCrits: an 'add' source never lowers a count that a 'set' source raised past its own cap ----
{
  const { w, p } = stage('shade', { s_s1: 1, s_atk: 1, s_atk_s: 1, deathsedge: 1, doommark: 1 });
  ok(p.stats.critK > 1.5, `Swift Shade critK ${p.stats.critK}`);
  w.grantCrits(p, 3 + p.stats.stepStack * 3, 3 + p.stats.stackMax, 'set');
  const before = p.critStacks;
  w.onDoomPayoff(p);
  ok(before > Math.round(3 * p.stats.critK) && p.critStacks === before, `Death's Edge keeps ${before} stacks (got ${p.critStacks})`);
  p.critStacks = 0; w.onDoomPayoff(p);
  ok(p.critStacks === Math.round(p.stats.critK), `Death's Edge adds ${Math.round(p.stats.critK)} from empty (got ${p.critStacks})`);
  p.critStacks = Math.round(3 * p.stats.critK) - 1; w.onDoomPayoff(p);
  ok(p.critStacks === Math.round(3 * p.stats.critK), `Death's Edge stops at its cap (got ${p.critStacks})`);
  const k = stage('knight', { k_atk: 1, k_atk_s: 1 });
  k.p.critStacks = 9; k.w.grantCrits(k.p, 2, 5, 'add');
  ok(k.p.critStacks === 9, `Riposte keeps 9 stacks (got ${k.p.critStacks})`);
  k.p.critStacks = 2; k.w.grantCrits(k.p, 2, 5, 'set');
  ok(k.p.critStacks === Math.min(Math.round(5 * k.p.stats.critK), Math.max(2, Math.round(2 * k.p.stats.critK))), 'set raises to its grant');
}

// ---- boss kill purges hostile shots and pools, also when the killing blow lands inside the loop that owns the list ----
for (const mode of ['proj', 'zone', 'tick']) {
  const { w, p } = stage('ranger', {});
  const b = w.spawnEnemy('bonewarden', p.x + 150, p.y); b.spawnT = 0; b.hp = 1; b.spd = 0; b.cd = 9999;
  w.boss = b; w.locked = true;
  w.spawnProj({ team: 1, kind: 'bolt', x: p.x + 60, y: p.y, a: Math.PI / 2, speed: 1, dmg: 30, life: 4, src: b });
  w.addZone({ kind: 'poison', x: p.x, y: p.y, r: 60, dur: 5, dps: 20, team: 1 });
  if (mode === 'proj') w.spawnProj({ team: 0, kind: 'arrow', x: b.x, y: b.y, a: 0, speed: 10, dmg: 50, life: 1, owner: p.pid });
  else if (mode === 'zone') w.addZone({ kind: 'fire', x: b.x, y: b.y, r: 60, dur: 2, dps: 600, team: 0, owner: p.pid });
  else w.hitEnemy(b, 100, { p, kind: 'weapon' });
  for (let i = 0; i < 30 && b.hp > 0; i++) { if (mode === 'proj') w.updateProjectiles(1 / 60); else if (mode === 'zone') w.updateZones(1 / 60); }
  ok(b.hp <= 0 && !w.boss, `${mode}: boss dead`);
  const hp0 = p.hp; w.update(1 / 60); w.update(1 / 60);
  ok(!w.projs.some(q => q.team === 1) && !w.zones.some(z => z.team === 1), `${mode}: no hostile shot or pool left (projs ${w.projs.filter(q => q.team === 1).length}, zones ${w.zones.filter(z => z.team === 1).length})`);
  ok(p.hp >= hp0, `${mode}: the hero is not hurt after bossDown`);
}
{ // a shot or pool spawned by the killing blow's own loop survives the purge (the arrays are not reassigned mid-loop)
  const { w, p } = stage('ranger', {});
  const b = w.spawnEnemy('bonewarden', p.x + 150, p.y); b.spawnT = 0; b.hp = 1; b.spd = 0; b.cd = 9999;
  w.boss = b; w.locked = true;
  w.spawnProj({ team: 0, kind: 'arrow', x: b.x, y: b.y, a: 0, speed: 10, dmg: 50, life: 1, owner: p.pid });
  w.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y, a: 0, speed: 10, dmg: 50, life: 3, owner: p.pid });
  w.updateProjectiles(1 / 60);
  ok(w.projs.filter(q => q.team === 0).length === 1, `a hero shot after the killing one survives (${w.projs.length})`);
}

// ---- Smite duo statuses are built from the Smite before the holy affinity ----
for (const s of [1, 2]) {
  const { w, p } = stage('cleric', { sunfire: 1, hoarlight: 1, twilight: 1 });
  w.stratum = s; p.stats.sunfire = 1; p.stats.hoarlight = 1; p.stats.twilight = 1;
  const e = foe(w, p.x + 200, p.y), holy = w.elemAff('holy'), fire = w.elemAff('fire'), shadow = w.elemAff('shadow');
  w.smite(e, p, 100); // stored Radiance 100 already carries the holy affinity
  near(e.burnPool, 100 / holy * 0.6 * fire, 1e-6, `stratum ${s} Sunfire Burn`);
  near(e.doom, 100 / holy * (1 + p.stats.doomMul) * shadow, 1e-6, `stratum ${s} Twilight Doom`);
}
{
  const { w, p } = stage('pyro', { thermalshock: 1 });
  w.stratum = 3; // fire weak
  const a = foe(w, p.x + 100, p.y), b = foe(w, p.x + 130, p.y);
  a.burnPool = 100; a.burn = 50; a.burnOwner = p;
  w.freezeEnemy(a, p);
  for (let i = 0; i < 12; i++) w.update(1 / 60);
  const fireAff = w.elemAff('fire'), got = (1e6 - b.hp);
  ok(got > 0 && b.chill > 0, `Thermal splash hit and chilled the neighbour (dealt ${got}, chill ${b.chill})`);
  near(b.chill, got / fireAff / (b.maxHp / b.hpLever) * ED.CONST.CHILL_K * w.elemAff('ice'), 1e-6, 'Thermal splash chill ignores the fire affinity of the splash');
}

// ---- Frozen Heart freezes through freezeEnemy: elite factor, freeze event, no spawning or burrowed foes, bosses stay out ----
{
  const { w, p } = stage('knight', {});
  p.stats.frozenHeart = 1; p.frozenCd = 0; p.invuln = 0; p.shield = 0;
  const a = foe(w, p.x + 50, p.y), el = foe(w, p.x - 50, p.y); el.elite = 'swift';
  const sp = foe(w, p.x, p.y + 50); sp.spawnT = 1; const bu = foe(w, p.x, p.y - 50); bu.burrowed = true; const bo = foe(w, p.x + 60, p.y + 60); bo.boss = true;
  w.fx.length = 0;
  w.hurtPlayer(p, 1, { x: a.x, y: a.y });
  near(a.frozen, 1.6, 1e-9, 'Frozen Heart freezes a normal foe 1.6 s'); near(el.frozen, 1.2, 1e-9, 'Frozen Heart freezes an elite 0.9x0.75 of 1.6 s');
  ok(sp.frozen <= 0 && bu.frozen <= 0 && bo.frozen <= 0, 'Frozen Heart skips spawning, burrowed foes and bosses');
  ok(a.freezeRes === 1 && w.fx.some(ev => ev.t === 'freeze'), 'Frozen Heart counts freeze resistance and emits the freeze event');
}

// ---- a departed Knight leaves no thrown shield ----
{
  const w = new ED.World({ seed: 7, pact: 0, players: [{ pid: 'p0', name: 'K', slot: 0, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() }, { pid: 'p1', name: 'R', slot: 1, cls: 'ranger', weapon: ED.CLASSES.ranger.weapons[0], meta: META() }] });
  w.startRun(); w.enemies.length = 0; w.enc = null; w.projs.length = 0; w.zones.length = 0;
  const k = w.players.get('p0'); w.playerSkill(k, 0, { d: 280 }, 1);
  ok(k.shields.length === 1 && w.projs.some(q => q.ghost), 'the Knight threw a shield');
  w.removePlayer('p0');
  w.update(1 / 60);
  ok(!w.projs.some(q => q.ghost), 'the shield of a departed Knight is gone');
}

// ---- card text follows the hero's weapon ----
{
  const forks = ED.BOON_IDS.filter(id => ED.BOONS[id].weapon && ED.BOONS[id].weapon.kind);
  ok(forks.length === 12, `12 fork cards (${forks.length})`);
  for (const id of forks) {
    const b = ED.BOONS[id], cls = b.cls;
    for (const wid of ED.CLASSES[cls].weapons) {
      const bw = ED.WEAPONS[wid], fw = ED.forkWeapon(wid, id), st = { weaponId: wid, critK: 1 };
      const m = /×([\d.]+) attack time, ×([\d.]+) damage per hit/.exec(ED.cardParts(id, 1, st).text);
      ok(!!m, `${id} on ${wid} shows both factors`);
      if (m) { near(+m[1], fw.rate / bw.rate, 0.0006, `${id} on ${wid} rate factor`); near(+m[2], fw.dmg / bw.dmg, 0.0006, `${id} on ${wid} damage factor`); }
      ok(!/[{}\[\]]/.test(ED.cardParts(id, 3, st).text + ED.cardParts(id, 3, st).rider), `${id} on ${wid} has no raw token`);
    }
    const nom = /×([\d.]+) attack time, ×([\d.]+) damage per hit/.exec(ED.cardParts(id, 1).text);
    ok(nom && +nom[1] === (b.weapon.kind === 'heavy' ? 1.8 : 0.55) && +nom[2] === (b.weapon.kind === 'heavy' ? 1.98 : 0.605), `${id} without a hero shows the nominal factors`);
  }
  ok(/×1\.3 attack time, ×1\.43 damage per hit/.test(ED.cardParts('p_atk_h', 1, { weaponId: 'inferno' }).text), 'Tome of Ruin shows the capped heavy factors');
  ok(/×0\.8 attack time, ×0\.88 damage per hit/.test(ED.cardParts('p_atk_s', 1, { weaponId: 'emberwand' }).text), 'Flicker Wand shows the floored swift factors');
  ok(/×0\.8 attack time/.test(ED.cardParts('p_atk_s', 1, { weaponId: 'emberwand@swift' }).text), 'a forked weaponId reads its base');
  const de = (st) => ED.Sheet.text('deathsedge', 1, st);
  ok(de({ critK: 1 }).indexOf('readies 1 guaranteed crit (up to 3 stored)') >= 0, "Death's Edge text at critK 1: " + de({ critK: 1 }));
  ok(de(null).indexOf('readies 1 guaranteed crit (up to 3 stored)') >= 0, "Death's Edge text without a hero");
  ok(de({ critK: 0.556 }).indexOf('1 guaranteed crit (up to 2 stored)') >= 0, "Death's Edge text on a Heavy weapon: " + de({ critK: 0.556 }));
  ok(de({ critK: 1.8 }).indexOf('2 guaranteed crits (up to 5 stored)') >= 0, "Death's Edge text on a Swift weapon: " + de({ critK: 1.8 }));
  ok(/elites 0\.5 s, not bosses/.test(ED.cardParts('s_s1_b', 1).text), 'Afterimage text states the elite blind');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
