// Usage: node tools/check-sim.js
// Headless regression checks of sim review fixes: crit-stack grants never lower the count, a boss kill purges hostile shots and pools whichever loop lands it, Smite duo statuses use the pre-affinity Smite,
// Frozen Heart goes through freezeEnemy, a departed hero leaves no thrown shield, fork and crit card text follows the hero's weapon, and the fodder horde (quota, drops, health, damage cap, xp budget, crowd slow, exposure, pack spots, live cap).
// Prints failures and exits 1 when any check fails; -v prints one line per played room.
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
// ---- fodder hordes: quota, drops, health, damage cap, xp budget, crowd slow, per-foe exposure, pack spots, live cap ----
const W0 = ED.World, TICK = 1 / 60;
const fodderId = (s) => ED.biomeFor(s).fodder;
// A world of `cls` heroes (one per entry) standing in the start room of stratum s; invulnerable, every spawn and xp drop logged in w.log.
function hordeWorld(s, classes, tutorial) {
  const w = new ED.World({ seed: 7, pact: 0, tutorial: !!tutorial, players: classes.map((cls, i) => ({ pid: 'p' + i, name: 'T' + i, slot: i, cls, weapon: ED.CLASSES[cls].weapons[0], meta: META() })) });
  w.startRun();
  if (s > 1) w.enterStratum(s);
  for (const p of w.players.values()) { p.offers.length = 0; p.picks = 0; p.offer = null; }
  const log = w.log = { xp: 0, gold: 0, hearts: 0, fodGold: 0, fodHearts: 0, packs: [], capBad: 0, packDist: Infinity, sides: new Set() };
  const sp0 = w.spawnPickup, az0 = w.addZone, ke0 = w.killEnemy;
  w.spawnPickup = function (kind, x, y, v) { if (kind === 'xp') log.xp += v; else if (kind === 'gold') log.gold += v; else if (kind === 'heart') log.hearts++; return sp0.call(this, kind, x, y, v); };
  w.killEnemy = function (e, p, src) { const g = log.gold, h = log.hearts, r = ke0.call(this, e, p, src); if (e.fodder) { log.fodGold += log.gold - g; log.fodHearts += log.hearts - h; } return r; }; // gold and hearts a fodder kill dropped
  w.addZone = function (z) {
    if (z.kind === 'spawn' && z.n) {
      log.packs.push(z);
      for (const p of this.players.values()) log.packDist = Math.min(log.packDist, Math.hypot(p.x - z.x, p.y - z.y));
      const live = this.hostiles() + this.zones.reduce((a, q) => a + (q.kind === 'spawn' ? q.n || 1 : 0), 0) + z.n;
      if (live > W0.LIVE_CAP[this.partySize() > 1 ? 1 : 0]) log.capBad++;
      const T = ED.CONST.TILE, r = this.room, d = [[z.y, 'n'], [r.h * T - z.y, 's'], [z.x, 'w'], [r.w * T - z.x, 'e']].sort((a, b) => a[0] - b[0])[0][1];
      log.sides.add(d);
    }
    return az0.call(this, z);
  };
  return w;
}
// Enters a room of w and plays it: each tick the heroes are invulnerable; kill 'all' slays every live foe after the update, 'threat' only the non-fodder, 'none' nothing. Ends when the room clears or after secs; returns the encounter (kept before it is nulled).
function playRoom(w, room, kill, secs) {
  const dir = Object.keys(room.doors).find(k => room.doors[k] >= 0), log = w.log;
  w.enterRoom(room.id, ED.Dungeon.OPP[dir]);
  log.xp = 0; log.gold = 0; log.hearts = 0; log.fodGold = 0; log.fodHearts = 0; log.packs.length = 0;
  return stepRoom(w, w.enc, kill, secs);
}
// Continues the encounter enc for up to secs more (same kill modes); peak = most foes standing at once.
function stepRoom(w, enc, kill, secs) {
  const heroes = [...w.players.values()];
  let t = 0, peak = 0;
  while (w.enc === enc && t < secs) {
    for (const p of heroes) p.invuln = 1e9;
    w.update(TICK); t += TICK;
    peak = Math.max(peak, w.hostiles());
    if (kill !== 'none') for (const e of w.enemies.slice()) if (e.hp > 0 && e.spawnT <= 0 && !e.boss && (kill === 'all' || !e.fodder)) w.killEnemy(e, heroes[0], {});
  }
  return { enc, t, peak, cleared: w.enc !== enc };
}
const roomOf = (w, kind) => w.floor.rooms.find(r => (kind === 'dark' ? r.dark : kind === 'elite' ? r.type === 'elite' : r.type === 'combat' && !r.dark));
const budgetOf = (s, kind) => Math.round(W0.ROOM_XP[kind === 'elite' ? 'elite' : 'combat'][s - 1] * (kind === 'dark' ? W0.DARK_LOOT : 1));
{ // fodder data: one per biome, in no roster, appended after every other entry
  const ids = ED.BIOMES.map(b => b.fodder), idx = ids.map(id => ED.ENEMY_IDX[id]);
  ok(ids.length === 6 && new Set(ids).size === 6 && ids.every(id => ED.ENEMIES[id] && ED.ENEMIES[id].fodder && ED.ENEMIES[id].ai === 'swarm' && ED.ENEMIES[id].cost === 0 && ED.ENEMIES[id].xp === 0 && ED.ENEMIES[id].hp === 7 && ED.ENEMIES[id].dmg === 6), 'six fodder defs, one per biome, hp 7 dmg 6 xp 0');
  ok(idx.join() === [...Array(6)].map((_, i) => ED.ENEMY_IDS.length - 6 + i).join(), `fodder are the last six wire indices (${idx})`);
  ok(ED.BIOMES.every(b => !b.enemies.some(r => ED.ENEMIES[r[0]].fodder)), 'fodder are in no roster');
  ok(ids.every(id => { const d = ED.ENEMIES[id], a = ED.ENEMIES[d.art]; return d.r >= 6 && d.r <= 8 && d.spd >= 62 && d.spd <= 90 && !!a && !a.fodder && !!d.fly === !!a.fly && d.look === a.look; }), 'fodder: radius 6-8, speed 62-90, art names an existing non-fodder type with the same flight and look');
}
{ // health curve 7 x (1 + 0.25 (s - 1)); pact multipliers apply, the stratum lever, the party multiplier and elites do not
  const { w } = stage('knight', {});
  const w2 = new ED.World({ seed: 7, pact: 0, players: [0, 1].map(i => ({ pid: 'p' + i, name: 'T', slot: i, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() })) });
  w2.startRun();
  for (let s = 1; s <= 6; s++) {
    w.stratum = s; w2.stratum = s;
    const e = w.spawnEnemy(fodderId(s), 0, 0), f = w2.spawnEnemy(fodderId(s), 0, 0), g = w.spawnEnemy(fodderId(s), 0, 0, { elite: true, affix: 'brutal' });
    near(e.maxHp, 7 * (1 + 0.25 * (s - 1)), 1e-9, `fodder health at stratum ${s}`);
    ok(f.maxHp === e.maxHp && g.maxHp === e.maxHp && !g.elite && g.r === e.r, `stratum ${s}: no party multiplier, never elite`);
    w.pact = 1; near(w.spawnEnemy(fodderId(s), 0, 0).maxHp, e.maxHp * 1.25, 1e-9, 'pact 1 health x1.25'); w.pact = 10; near(w.spawnEnemy(fodderId(s), 0, 0).maxHp, e.maxHp * 1.25 * 1.2, 1e-9, 'pact 10 health x1.5'); w.pact = 0;
  }
  w.stratum = 1; w.room.dark = false; const a = w.spawnEnemy('bonemite', 0, 0); w.room.dark = true; const b = w.spawnEnemy('bonemite', 0, 0); w.room.dark = false;
  near(b.dmg / a.dmg, 1.3, 1e-9, 'fodder damage x1.3 in a dark room');
}
{ // a touch from fodder takes at most 3% of max health (minimum 1); other foes are not capped
  const { w, p } = stage('knight', {});
  const f = w.spawnEnemy('bonemite', p.x + 10, p.y), k = w.spawnEnemy('skeleton', p.x + 10, p.y);
  p.maxHp = 200; p.hp = 200; p.invuln = 0; p.shield = 0;
  w.hurtPlayer(p, 5000, { e: f }); near(200 - p.hp, 6, 0, 'a fodder hit takes 3% of 200 = 6');
  p.hp = 200; p.invuln = 0; w.hurtPlayer(p, 60, { e: k }); ok(200 - p.hp > 6 && !p.downed, `another foe is not capped (${200 - p.hp})`);
  p.maxHp = 10; p.hp = 10; p.invuln = 0; w.hurtPlayer(p, 5000, { e: f }); near(10 - p.hp, 1, 0, 'a fodder hit takes at least 1');
  p.maxHp = 100; p.hp = 100; p.invuln = 0; p.shield = 50; w.hurtPlayer(p, 5000, { e: f }); ok(p.hp === 100 && p.shield === 47, `a shield absorbs the capped hit (hp ${p.hp}, shield ${p.shield})`);
  p.shield = 0; p.hp = 100; p.invuln = 0; w.hurtPlayer(p, 1, { e: f }); near(100 - p.hp, 1, 0, 'a weak fodder hit stays 1');
}
{ // a touch in the sim: fodder next to a hero hurts it by the cap at most
  const { w, p } = stage('knight', {});
  w.stratum = 6; p.invuln = 0; const f = w.spawnEnemy('voidmote', p.x + 4, p.y); f.cd = 99; w.enc = {}; const hp0 = p.hp;
  w.updateEnemy(f, TICK);
  const cap = Math.max(1, Math.round(0.03 * p.maxHp));
  ok(hp0 - p.hp >= 1 && hp0 - p.hp <= cap && f.st === 'move', `touch damage ${hp0 - p.hp} within 1..${cap} and untelegraphed (state ${f.st})`);
}
{ // fodder kills: no gold, heart or Grail growth, no split; run counts; hit events carry fd
  const { w, p } = stage('knight', {});
  w.stratum = 3; p.stats.chalice = 1; p.chaliceKills = 0; w.pickups.length = 0;
  for (let i = 0; i < 300; i++) { const e = w.spawnEnemy('rimemote', p.x + 40, p.y); w.killEnemy(e, p, {}); }
  ok(!w.pickups.some(k => k.kind === 'gold' || k.kind === 'heart' || k.kind === 'xp') && p.chaliceKills === 0 && p.chaliceHp === 0, 'fodder kills drop no gold, heart or xp (outside a budgeted room) and do not grow the Grail');
  ok(w.run.fodderKills === 300 && w.run.kills >= 300 && p.kills === 300, `fodder kills are counted (${w.run.fodderKills}/${w.run.kills}/${p.kills})`);
  let g = 0; for (let i = 0; i < 300; i++) { const e = w.spawnEnemy('frozenskel', p.x + 40, p.y); w.killEnemy(e, p, {}); } for (const k of w.pickups) if (k.kind === 'gold' || k.kind === 'heart') g++;
  ok(g > 0, 'regular foes still drop gold or hearts (control)');
  const e = w.spawnEnemy('rimemote', p.x + 40, p.y), r = w.spawnEnemy('skeleton', p.x + 40, p.y); w.fx.length = 0;
  w.hitEnemy(e, 1, { p, kind: 'weapon' }); w.hitEnemy(r, 1, { p, kind: 'weapon' });
  const hits = w.fx.filter(v => v.t === 'hit');
  ok(hits.length === 2 && hits[0].fd === 1 && hits[1].fd === undefined, 'the hit event of fodder carries fd');
}
{ // per-foe exposure: a foe is exposed after 45 s of its own life (a boss after 78), fodder never; a late spawn is not exposed by the room clock
  const { w, p } = stage('knight', {});
  w.enc = { kind: 'waves' }; w.roomTime = 500; p.invuln = 1e9;
  const a = foe(w, p.x + 300, p.y), bo = w.spawnEnemy('bonewarden', p.x + 300, p.y + 60), f = w.spawnEnemy('bonemite', p.x + 300, p.y - 60);
  bo.spd = 0; f.spd = 0; bo.cd = f.cd = 9999; f.maxHp = f.hp = 1e6;
  w.updateEnemy(a, TICK); ok(!a.exposed && Math.abs(a.age - TICK) < 1e-9, 'a foe spawned late in the room is not exposed by the room clock');
  a.age = 44.9; w.updateEnemy(a, TICK); ok(!a.exposed, 'not exposed at 44.9 s of age');
  a.age = 45.01; w.updateEnemy(a, TICK); ok(a.exposed, 'exposed past 45 s of age');
  bo.age = 77.9; w.updateEnemy(bo, TICK); ok(!bo.exposed, 'a boss is not exposed at 77.9 s'); bo.age = 78.01; w.updateEnemy(bo, TICK); ok(bo.exposed, 'a boss is exposed past 78 s');
  f.age = 500; w.updateEnemy(f, TICK); ok(!f.exposed, 'fodder are never exposed');
  const sp = foe(w, p.x + 300, p.y + 100); sp.spawnT = 1; w.updateEnemy(sp, TICK); ok(sp.age === 0 && sp.spawnT < 1, 'a spawning foe does not age');
}
{ // crowd slow: 8% per overlapping non-boss foe, at most 50%; spawning, dead and boss foes do not count; dashes and skill moves ignore it
  const { w, p } = stage('knight', {});
  const mk = (k) => { const a = []; for (let i = 0; i < k; i++) a.push({ x: p.x + 5 + i, y: p.y, r: 8, hp: 5, spawnT: 0, boss: false }); return a; };
  near(ED.Sim.crowdMul(p, mk(0)), 1, 1e-12, 'no foe: factor 1'); near(ED.Sim.crowdMul(p, undefined), 1, 1e-12, 'no list: factor 1');
  near(ED.Sim.crowdMul(p, mk(3)), 0.76, 1e-12, '3 foes: factor 0.76'); near(ED.Sim.crowdMul(p, mk(7)), 0.5, 1e-12, '7 foes: factor 0.5 (the floor)'); near(ED.Sim.crowdMul(p, mk(30)), 0.5, 1e-12, '30 foes: still 0.5');
  const mixed = mk(2).concat([{ x: p.x, y: p.y, r: 8, hp: 5, spawnT: 0, boss: true }, { x: p.x, y: p.y, r: 8, hp: 0, spawnT: 0 }, { x: p.x, y: p.y, r: 8, hp: 5, spawnT: 1 }, { x: p.x + 18.1, y: p.y, r: 8, hp: 5, spawnT: 0 }]);
  near(ED.Sim.crowdMul(p, mixed), 0.84, 1e-12, 'boss, dead, spawning and out-of-reach foes do not count');
  const walk = (foes, dash) => {
    const q = { x: 500, y: 300, r: 10, vx: 0, vy: 0, stats: p.stats, downed: false, dead: false, dashT: dash ? 100 : 0, dashDx: 1, dashDy: 0, skillMove: null };
    const hx = w.room.w * 16, hy = w.room.h * 16; q.x = hx - 200; q.y = hy;
    const fs = foes.map(f => Object.assign({}, f, { dx: f.x - p.x, dy: f.y - p.y }));
    let x40 = 0;
    for (let i = 0; i < 60; i++) {
      if (i === 40) x40 = q.x;
      for (const f of fs) { f.x = q.x + f.dx; f.y = q.y + f.dy; } // the crowd keeps pace with the hero
      ED.Sim.movePlayer(q, { mx: 1, my: 0 }, TICK, w.room, false, [], fs);
    }
    return q.x - x40; // distance of the last 20 ticks (the walk has settled)
  };
  const free = walk([], false), slow = walk(mk(7), false);
  near(slow / free, 0.5, 0.02, `walking with 7 foes touching covers half the distance (${slow.toFixed(1)} vs ${free.toFixed(1)})`);
  near(walk(mk(7), true), walk([], true), 1e-9, 'a dash ignores the crowd');
}
{ // quotas: FODDER_Q by stratum, x0.6 elite, x1.5 dark, x(1 + 0.5 (n - 1)) party, x0.6 tutorial stratum I
  const Q = (w, room) => { const enc = { waves: [] }; w.planHorde(room, enc); return enc.q; };
  for (let s = 1; s <= 6; s++) {
    const w = hordeWorld(s, ['knight']), w2 = hordeWorld(s, ['knight', 'ranger']), w4 = hordeWorld(s, ['knight', 'ranger', 'pyro', 'shade']), base = W0.FODDER_Q[s - 1];
    ok(Q(w, { type: 'combat', dark: false }) === base && Q(w, { type: 'combat', dark: true }) === Math.round(base * 1.5) && Q(w, { type: 'elite', dark: false }) === Math.round(base * 0.6), `stratum ${s} quota ${base} / dark / elite`);
    ok(Q(w2, { type: 'combat', dark: false }) === Math.round(base * 1.5) && Q(w4, { type: 'combat', dark: false }) === Math.round(base * 2.5), `stratum ${s} party quota`);
  }
  const wt = hordeWorld(1, ['knight'], true);
  ok(Q(wt, { type: 'combat', dark: false }) === 24, `tutorial stratum I quota ${Q(wt, { type: 'combat', dark: false })}`);
  ok(W0.LIVE_CAP[0] === 120 && W0.LIVE_CAP[1] === 180 && W0.FODDER_XP_SHARE === 0.5 && W0.ROOM_XP.combat.join() === '38,61,96,136,173,196' && W0.ROOM_XP.elite.join() === '71,103,139,187,257,290', 'horde and xp constants');
}
// Every room kind of every stratum, played out by killing everything: the quota spawns, the room clears, fodder drop no gold or hearts, and the xp dropped is the budget
for (let s = 1; s <= 6; s++) {
  for (const kind of ['combat', 'elite', 'dark']) {
    const w = hordeWorld(s, ['knight']), room = roomOf(w, kind);
    if (!room) { ok(false, `stratum ${s} has a ${kind} room`); continue; }
    const q = Math.round(W0.FODDER_Q[s - 1] * (kind === 'elite' ? 0.6 : kind === 'dark' ? 1.5 : 1));
    const r = playRoom(w, room, 'all', 400), enc = r.enc, tag = `stratum ${s} ${kind}`;
    if (process.argv.includes('-v')) console.log(`${s} ${kind}: ${r.t.toFixed(1)} s, ${w.log.packs.length} packs, fodder ${w.run.fodderKills}, threat ${w.run.kills - w.run.fodderKills}, xp ${w.log.xp}/${enc.xpBudget} (threat ${enc.xpThr}/${enc.xpThrCap}, cut ${enc.xpClip}), nearest hero ${Math.round(w.log.packDist)} px, sides ${[...w.log.sides].join('')}`);
    ok(r.cleared && enc.q === q && enc.spawned === q && w.run.fodderKills === q, `${tag}: the quota ${q} spawned (${enc.spawned}), was killed (${w.run.fodderKills}) and the room cleared in ${r.t.toFixed(0)} s`);
    ok(w.log.xp === budgetOf(s, kind) && enc.xpOut === budgetOf(s, kind), `${tag}: xp dropped ${w.log.xp} (ledger ${enc.xpOut}) = budget ${budgetOf(s, kind)}`);
    ok(enc.xpClip <= 1, `${tag}: planned threat drops fill the threat cap without a cut (cut ${enc.xpClip} of a ${enc.xpThrCap} cap)`);
    ok(enc.xpThr <= enc.xpThrCap && w.log.packs.length >= Math.ceil(q / 12) && w.log.packs.every(z => z.type === fodderId(s) && z.n >= 1 && z.n <= 12 && z.r === 40 && z.dur === W0.PACE.spawn), `${tag}: ${w.log.packs.length} packs of the biome's fodder, 1-12 each`);
    ok(w.log.capBad === 0 && w.log.packDist >= W0.PACK_AVOID, `${tag}: packs land ${Math.round(w.log.packDist)} px from the hero, the live cap holds`);
    ok(w.log.fodGold === 0 && w.log.fodHearts === 0 && w.log.gold > 0, `${tag}: ${w.run.fodderKills} fodder kills dropped no gold or heart (the room dropped ${w.log.gold} gold, ${w.log.hearts} hearts)`);
  }
}
{ // the xp mote ledger: a fodder kill drops its share as whole units, exact in total; threat drops are scaled so the planned waves fill their cap (xpK), never past it; the pile pays the rest
  const w = hordeWorld(1, ['knight']), room = roomOf(w, 'combat');
  const r = playRoom(w, room, 'none', 1);
  const enc = w.enc; ok(enc && enc.xpBudget === 38 && enc.xpFod === 19 && enc.xpThrCap === 19 && enc.q === 40, `ledger ${JSON.stringify({ b: enc.xpBudget, f: enc.xpFod, t: enc.xpThrCap, q: enc.q })}`);
  const p = w.players.get('p0'); let got = 0;
  for (let i = 0; i < enc.q; i++) { const e = w.spawnEnemy('bonemite', p.x, p.y); const before = w.log.xp; w.killEnemy(e, p, {}); got += w.log.xp - before; }
  ok(got >= enc.xpFod - 1 && got <= enc.xpFod && enc.xpOut === got, `40 fodder kills drop ${got} of ${enc.xpFod}`);
  let plan = 0; for (const wv of enc.waves) for (const f of wv) plan += W0.threatXp(ED.ENEMIES[f.type], 1, f.elite);
  near(enc.xpK * plan, enc.xpThrCap, 1e-9, `xpK scales the planned threat xp (${plan.toFixed(1)}) to the threat cap ${enc.xpThrCap}`);
  const un = w.spawnEnemy('skeleton', p.x, p.y), u0 = w.log.xp; w.killEnemy(un, p, {});
  ok(w.log.xp === u0 && !un.plan, 'an unplanned threat foe (summon, split) drops no xp in a budgeted room');
  const sk = w.spawnEnemy('skelknight', p.x, p.y, { elite: true, affix: 'swift', plan: 1 }), acc0 = enc.xpThrAcc, want = Math.floor(acc0 + W0.threatXp(ED.ENEMIES.skelknight, 1, true) * enc.xpK), room0 = enc.xpThrCap - enc.xpThr, b0 = w.log.xp;
  w.killEnemy(sk, p, {});
  ok(w.log.xp - b0 === Math.min(want, room0), `an elite's drop is scaled by xpK (whole units, the fraction carried) and cut to what is left of the threat cap (${w.log.xp - b0} of ${want}, ${room0} left)`);
  ok(enc.xpClip === Math.max(0, want - room0), `the cut is logged (${enc.xpClip})`);
}
{ // the horde never holds the threat waves back: with the fodder left standing, the waves still advance as the threat foes die; the room clears only after the last fodder
  const w = hordeWorld(3, ['knight']), room = roomOf(w, 'combat');
  const r = playRoom(w, room, 'threat', 3.5), enc = r.enc, standing = w.hostiles();
  ok(!r.cleared && enc.wave === enc.waves.length - 1 && standing >= 6 && w.hostiles(true) === 0, `waves advance past standing fodder well before the ${W0.PACE.maxAge} s timer (wave ${enc.wave + 1}/${enc.waves.length} after ${r.t.toFixed(1)} s with ${standing} fodder standing)`);
  ok(enc.spawned < enc.q, `the quota is not out yet (${enc.spawned}/${enc.q}): the room stays locked`);
  const r2 = stepRoom(w, enc, 'threat', 30);
  ok(!r2.cleared && enc.spawned === enc.q && w.hostiles() > 0, `with the quota out and fodder standing the room does not clear (${w.hostiles()} standing)`);
  const r3 = stepRoom(w, enc, 'all', 5);
  ok(r3.cleared && w.run.fodderKills === enc.q, `it clears once the last fodder falls (${w.run.fodderKills}/${enc.q})`);
}
{ // packs: spots at least 220 px from every hero, from several sides over rooms; the live cap holds and delays the quota; a pack is one spawn zone and resolves into n fodder on floor tiles
  const sides = new Set();
  for (const [s, cls] of [[1, ['knight', 'ranger']], [4, ['knight']], [6, ['knight']], [6, ['knight', 'ranger']]]) {
    const w = hordeWorld(s, cls);
    for (const kind of ['combat', 'elite', 'dark']) {
      const room = roomOf(w, kind), r = playRoom(w, room, 'none', 40), enc = r.enc;
      for (const d of w.log.sides) sides.add(d);
      ok(w.log.packs.length >= 1 && w.log.packDist >= 220 && w.log.capBad === 0, `stratum ${s} ${cls.length} hero(es) ${kind}: ${w.log.packs.length} packs, nearest hero ${Math.round(w.log.packDist)} px, cap respected`);
      const cap = W0.LIVE_CAP[cls.length > 1 ? 1 : 0], pend = w.zones.reduce((a, q) => a + (q.kind === 'spawn' ? q.n || 1 : 0), 0);
      ok(r.peak + pend <= cap, `stratum ${s} ${kind}: peak ${r.peak} standing (+ ${pend} pending) against the cap ${cap}`);
      if (process.argv.includes('-v')) console.log(`cap run: stratum ${s}, ${cls.length} hero(es), ${kind}: ${enc.spawned}/${enc.q} fodder out in 40 s, peak ${r.peak} standing, ${w.hostiles()} + ${pend} pending, cap ${cap}`);
      if (s === 6 && cls.length === 1 && kind !== 'elite') ok(enc.spawned < enc.q && r.peak >= cap - 40, `stratum VI ${kind}: the cap holds the quota back (${enc.spawned}/${enc.q} out, peak ${r.peak})`);
    }
  }
  ok(sides.size >= 3, `packs come from several sides (${[...sides].join('')})`);
  const w = hordeWorld(1, ['knight']), room = roomOf(w, 'combat'), r = playRoom(w, room, 'none', 3), pk = w.log.packs[0];
  ok(!!pk && pk.kind === 'spawn' && pk.n >= 6 && pk.n <= 12 && pk.type === 'bonemite', 'the first pack is one spawn zone with n and the biome fodder');
  const before = w.enemies.length; for (let i = 0; i < 80; i++) { w.players.get('p0').invuln = 1e9; w.update(TICK); }
  const fod = w.enemies.filter(e => e.fodder && e.hp > 0);
  ok(fod.length >= pk.n && fod.every(e => ED.Dungeon.tileAt(w.room, e.x, e.y) !== 1), `the pack resolved into fodder (${fod.length})`);
}
{ // a hero standing 6.5 tiles from the only pack edge of its room (closer than PACK_AVOID along a stretch of that edge): the packs skip that stretch, or go to another edge, and never land within 220 px
  const T = ED.CONST.TILE;
  for (const [s, near] of [[1, 'w'], [2, 'e'], [3, 'n'], [4, 's']]) {
    const w = hordeWorld(s, ['knight']), room = roomOf(w, 'combat'), p = w.players.get('p0');
    const dir = Object.keys(room.doors).find(k => room.doors[k] >= 0); w.enterRoom(room.id, ED.Dungeon.OPP[dir]);
    w.enc.edges = [near]; w.log.packs.length = 0; w.log.sides.clear(); w.log.packDist = Infinity;
    p.x = near === 'w' ? 7.5 * T : near === 'e' ? (room.w - 7.5) * T : room.w * T / 2; p.y = near === 'n' ? 8.5 * T : near === 's' ? (room.h - 7.5) * T : room.h * T / 2 + T;
    stepRoom(w, w.enc, 'none', 25);
    ok(w.log.packs.length >= 4 && w.log.packDist >= 220, `stratum ${s}: hero near the ${near} edge, ${w.log.packs.length} packs from ${[...w.log.sides].join('')}, nearest ${Math.round(w.log.packDist)} px`);
  }
}
{ // one run through the start-of-room rules: the first pack comes with the first threat wave, the next 2-3 s later
  const w = hordeWorld(2, ['knight']), room = roomOf(w, 'combat');
  const dir = Object.keys(room.doors).find(k => room.doors[k] >= 0); w.enterRoom(room.id, ED.Dungeon.OPP[dir]);
  const times = [], p = w.players.get('p0');
  for (let i = 0; i < 60 * 14; i++) { p.invuln = 1e9; const n0 = w.log.packs.length, wv = w.enc.wave; w.update(TICK); if (w.log.packs.length > n0) times.push([w.time, w.enc.wave]); }
  ok(times.length >= 4 && times[0][1] === 0, `the first pack comes with wave 1 (${JSON.stringify(times[0])})`);
  const gaps = times.slice(1).map((t, i) => t[0] - times[i][0]);
  ok(gaps.every(g => g >= 2.0 - 1e-9 && g <= 3.0 + 0.05), `packs 2-3 s apart (${gaps.map(g => g.toFixed(2)).join(' ')})`);
}
console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
