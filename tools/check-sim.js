// Usage: node tools/check-sim.js
// Headless regression checks of sim review fixes: crit-stack grants never lower the count, a boss kill purges hostile shots and pools whichever loop lands it, Smite duo statuses use the pre-affinity Smite,
// Frozen Heart goes through freezeEnemy, a departed hero leaves no thrown shield, fork and crit card text follows the hero's weapon. Prints failures and exits 1 when any check fails.
const { ED, runBot } = require('./sim.js');
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

// ---- dark rooms: no lantern, dread or Gloom; the opt-in dark room's elite, foe damage, reward step and loot ----
{
  const { w, p } = stage('knight', {});
  const stale = ['light', 'lightMax', 'dread', 'deepRooms', 'gloomT', 'gloomN', 'bossTier'];
  ok(stale.every(k => !(k in w)), 'a World carries no lantern, dread or Gloom field');
  for (let i = 0; i < 300; i++) w.update(1 / 60);
  ok(stale.every(k => !(k in w)) && !w.enemies.some(e => e.type === 'gloom'), 'no lantern or Gloom field appears while time runs');
  ok(!ED.ENEMIES.gloom && !ED.AI.gloom && ['flare', 'addLight', 'banishGloom', 'updateLantern', 'bossLantern', 'lanternMax', 'updateDread', 'spawnGloom'].every(k => w[k] === undefined), 'the lantern, flare and Gloom code is gone');
  ok(!('roomCost' in ED.World) && !('DREAD' in ED.World) && !('FLARE' in ED.World), 'no room cost, dread table or flare table');
  ok(ED.World.DARK_DMG === 1.3 && ED.World.DARK_LOOT === 1.5 && ED.World.DARK_FODDER === 1.5, 'dark-room constants');
  const plain = w.floor.rooms.find(r => r.type === 'combat' && !r.dark), dark = w.floor.rooms.find(r => r.dark);
  ok(w.floor.rooms.filter(r => r.dark).length === 2 && !!plain && dark.type === 'combat', 'a floor has exactly two dark combat rooms');
  const sc = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true });
  ok(sc.dark.total === 2 && sc.dark.left === 2 && !sc.dark.here && sc.def.foeParts.dark === null, 'the sheet counts the two unvisited dark rooms');
  const dir = Object.keys(dark.doors).find(k => dark.doors[k] >= 0);
  w.fx.length = 0;
  w.enterRoom(dark.id, ED.Dungeon.OPP[dir]);
  ok(w.room === dark && w.fx.filter(e => e.t === 'dark').length === 1, 'entering a dark room emits one dark event');
  const sd = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true });
  ok(sd.dark.left === 1 && sd.dark.here && Math.abs(sd.def.foeParts.dark - 1.3) < 1e-9, 'the sheet shows the dark room the hero stands in');
  w.fx.length = 0;
  w.enterRoom(plain.id, ED.Dungeon.OPP[Object.keys(plain.doors).find(k => plain.doors[k] >= 0)]);
  ok(!w.fx.some(e => e.t === 'dark'), 'a plain room emits no dark event');
}
{ // the extra elite of the last wave, with an affix from DARK_AFFIXES
  const { w } = stage('knight', {});
  let darkSeen = 0, plainSeen = 0;
  for (let s = 1; s <= 6; s++) {
    w.enterStratum(s);
    for (const room of w.floor.rooms) {
      if (room.type !== 'combat') continue;
      for (let k = 0; k < 6; k++) {
        const waves = w.planWaves(room), last = waves[waves.length - 1], tagged = last.filter(it => it.affix);
        if (room.dark) { darkSeen++; ok(tagged.length === 1 && tagged[0].elite && ED.World.DARK_AFFIXES.includes(tagged[0].affix), `stratum ${s} dark room: one extra elite in the last wave with a dark affix`); }
        else { plainSeen++; ok(tagged.length === 0, `stratum ${s} plain room: no dark elite`); }
      }
    }
  }
  ok(darkSeen === 6 * 2 * 6 && plainSeen > 0, `dark rooms planned ${darkSeen}`);
}
{ // foe damage x1.3 in a dark room; minions and allies are not foes
  const { w, p } = stage('knight', {});
  const room = w.room;
  room.dark = false; const a = w.spawnEnemy('skeleton', p.x + 50, p.y), am = w.spawnEnemy('minion', p.x + 50, p.y);
  room.dark = true; const b = w.spawnEnemy('skeleton', p.x + 50, p.y), bm = w.spawnEnemy('minion', p.x + 50, p.y), c = w.spawnEnemy('skeleton', p.x + 50, p.y, { elite: true, affix: 'swift' });
  near(b.dmg / a.dmg, 1.3, 1e-9, 'a foe spawned in a dark room hits x1.3'); ok(bm.dmg === am.dmg, 'a minion keeps its damage in a dark room');
  near(b.maxHp / a.maxHp, 1, 1e-9, 'a dark room adds no foe health'); near(c.dmg / b.dmg, ED.World.ELITE.dmg, 1e-9, 'the dark multiplier stacks with the elite one');
  room.dark = false;
}
{ // the reward goes up one step; the upgrade event announces it
  for (const [from, to] of [['gold', 'vigor'], ['vigor', 'forge'], ['forge', 'epic'], ['boon', 'epic']]) {
    for (const dark of [true, false]) {
      const { w } = stage('knight', {});
      const room = w.floor.rooms.find(r => r.type === 'combat' && !!r.dark === dark), dir = Object.keys(room.doors).find(k => room.doors[k] >= 0);
      room.reward = from;
      w.enterRoom(room.id, ED.Dungeon.OPP[dir]); w.enemies.length = 0; w.zones.length = 0; w.fx.length = 0;
      w.roomCleared();
      const rw = w.props.find(q => q.kind === 'reward');
      ok(rw && rw.item === (dark ? to : from), `${dark ? 'dark' : 'plain'} room reward ${from} -> ${rw && rw.item}`);
      ok(w.fx.some(e => e.t === 'upgrade') === dark, `${dark ? 'dark' : 'plain'} room upgrade event (${from})`);
    }
  }
}
{ // gold and xp dropped in a dark room are x1.5: room clear, a claimed gold reward, foe drops
  const sum = (w, kind) => w.pickups.filter(k => k.kind === kind).reduce((a, k) => a + k.val, 0);
  const run = (dark) => {
    const { w, p } = stage('knight', {});
    w.room.dark = dark; w.room.type = 'combat'; w.pickups.length = 0;
    const out = {};
    w.dropGold(p.x, p.y, 100); out.gold = sum(w, 'gold'); w.pickups.length = 0;
    w.dropGold(p.x, p.y, 20, true); out.exact = sum(w, 'gold'); w.pickups.length = 0;
    w.dropXp(p.x, p.y, 40); out.xp = sum(w, 'xp'); w.pickups.length = 0;
    const e = w.spawnEnemy('skeleton', p.x + 50, p.y); w.killEnemy(e, p, {}); out.kill = sum(w, 'xp'); w.pickups.length = 0;
    const pr = { id: 9001, kind: 'reward', x: p.x, y: p.y, item: 'gold', group: 7, state: 0 }; w.props.push(pr); w.interact(p.pid, pr.id); out.reward = sum(w, 'gold'); w.pickups.length = 0;
    const rs = w.run.embers.rooms; w.enc = { kind: 'waves' }; w.roomState[w.roomId].cleared = false; w.room.reward = null; w.roomCleared(); out.clear = sum(w, 'gold'); out.embers = w.run.embers.rooms - rs;
    return out;
  };
  const n = run(false), d = run(true), L = ED.World.DARK_LOOT, G = ED.World.GOLD_MUL;
  ok(n.gold === Math.round(100 * G) && d.gold === Math.round(100 * G * L), `foe gold x1.5 (${n.gold} -> ${d.gold})`);
  ok(n.exact === 20 && d.exact === 30, `exact gold x1.5 (${n.exact} -> ${d.exact})`);
  ok(n.xp === 40 && d.xp === 60, `xp x1.5 (${n.xp} -> ${d.xp})`);
  ok(n.kill > 0 && d.kill === Math.round(n.kill * L), `a kill's xp x1.5 (${n.kill} -> ${d.kill})`);
  ok(n.reward === ED.World.rewardGold(1) && d.reward === Math.round(ED.World.rewardGold(1) * L), `a claimed gold reward x1.5 (${n.reward} -> ${d.reward})`);
  ok(d.clear > n.clear && d.embers === n.embers, `the room-clear gold x1.5 (${n.clear} -> ${d.clear}), embers unchanged`);
}
{ // bot exploration: --dark=never visits every non-dark room, --dark=always also the two dark rooms
  for (const [seed, cls] of [[1000, 'knight'], [1007, 'ranger'], [1014, 'pyro']]) {
    for (const dark of ['never', 'always']) {
      const r = runBot({ seed, n: 1, cls: [cls], skill: 0.75, up: ED.UPGRADES.map(() => 0), mastery: 1, relics: ED.RELIC_IDS.filter(id => ED.RELICS[id].start), pick: 'smart', dark, maxStratum: 2 });
      ok(r.left.length >= 1 && r.left.every(f => f.missed === 0), `${cls} ${dark}: every non-dark room visited (left ${JSON.stringify(r.left)})`);
      ok(r.left.length >= 1 && r.dark.slice(0, r.left.length).every(v => (dark === 'never' ? v === 0 : v === 2)), `${cls} ${dark}: dark rooms entered ${r.dark.join(',')}`);
    }
  }
}
console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
