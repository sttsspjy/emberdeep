// Usage: node tools/check-sim.js
// Headless regression checks of sim review fixes: crit-stack grants never lower the count, a boss kill purges hostile shots and pools whichever loop lands it, Smite duo statuses use the pre-affinity Smite,
// Frozen Heart goes through freezeEnemy, a departed hero leaves no thrown shield, fork and crit card text follows the hero's weapon, the fodder horde (quota, drops, health, damage cap, xp budget, crowd slow, exposure, pack spots, live cap) and the stratum behaviour (lead aim, ground speed, mixed rosters, two-affix elites).
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
  const { w, p } = stage('cleric', { sunfire: 1 });
  w.stratum = s; p.stats.sunfire = 1;
  const e = foe(w, p.x + 200, p.y), holy = w.elemAff('holy'), fire = w.elemAff('fire');
  w.smite(e, p, 100); // stored Radiance 100 already carries the holy affinity
  near(e.burnPool, 100 / holy * 0.6 * fire, 1e-6, `stratum ${s} Sunfire Burn`);
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
  ok(forks.length === 2 * ED.CLASS_IDS.length, `2 fork cards per hero (${forks.length})`);
  for (const id of forks) {
    const b = ED.BOONS[id], cls = b.cls;
    for (const wid of ED.CLASSES[cls].weapons) {
      const bw = ED.WEAPONS[wid], fw = ED.forkWeapon(wid, id), st = { weaponId: wid, critK: 1 };
      const m = /×([\d.]+) (?:attack time|lockout), ×([\d.]+) damage per (?:hit|strike)/.exec(ED.cardParts(id, 1, st).text); // a bell: lockout, damage per strike
      ok(!!m, `${id} on ${wid} shows both factors`);
      if (m) { near(+m[1], fw.rate / bw.rate, 0.0006, `${id} on ${wid} rate factor`); near(+m[2], fw.dmg / bw.dmg, 0.0006, `${id} on ${wid} damage factor`); }
      ok(!/[{}\[\]]/.test(ED.cardParts(id, 3, st).text + ED.cardParts(id, 3, st).rider), `${id} on ${wid} has no raw token`);
    }
    const nom = /×([\d.]+) (?:attack time|lockout), ×([\d.]+) damage per (?:hit|strike)/.exec(ED.cardParts(id, 1).text), hv = b.weapon.kind === 'heavy';
    const want = cls === 'bell' ? (hv ? [1.2, 1.32] : [0.6, 0.66]) : hv ? [1.8, 1.98] : [0.55, 0.605];
    ok(nom && +nom[1] === want[0] && +nom[2] === want[1], `${id} without a hero shows the nominal factors`);
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
  const plain = w.floor.rooms.find(r => r.type === 'combat' && !r.dark), dark = w.floor.rooms.find(r => r.dark), nDark = w.floor.rooms.filter(r => r.dark).length;
  ok(nDark >= 1 && !!plain && w.floor.rooms.every(r => !r.dark || (r.type === 'combat' && r.row >= 3)), `dark rooms are combat rooms from map row 3 (${nDark} on the floor)`);
  const sc = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true });
  ok(sc.dark.total === nDark && sc.dark.left === nDark && !sc.dark.here && sc.def.foeParts.dark === null, 'the sheet counts the unvisited dark rooms');
  w.fx.length = 0;
  w.enterRoom(dark.id, 's');
  ok(w.room === dark && w.fx.filter(e => e.t === 'dark').length === 1, 'entering a dark room emits one dark event');
  const sd = ED.Sheet.compute(p, ED.Sheet.ctx(w, p), { raw: true });
  ok(sd.dark.left === nDark - 1 && sd.dark.here && Math.abs(sd.def.foeParts.dark - 1.3) < 1e-9, 'the sheet shows the dark room the hero stands in');
  w.fx.length = 0;
  w.enterRoom(plain.id, 's');
  ok(!w.fx.some(e => e.t === 'dark'), 'a plain room emits no dark event');
}
{ // the extra elite of the last wave, with an affix from DARK_AFFIXES
  const { w } = stage('knight', {});
  let darkSeen = 0, plainSeen = 0, darkRooms = 0;
  for (let s = 1; s <= ED.CONST.STRATA; s++) {
    w.enterStratum(s);
    for (const room of w.floor.rooms) {
      if (room.type !== 'combat') continue;
      if (room.dark) darkRooms++;
      for (let k = 0; k < 6; k++) {
        const waves = w.planWaves(room), last = waves[waves.length - 1], tagged = last.filter(it => it.affix);
        if (room.dark) { darkSeen++; ok(tagged.length === 1 && tagged[0].elite && ED.World.DARK_AFFIXES.includes(tagged[0].affix), `stratum ${s} dark room: one extra elite in the last wave with a dark affix`); }
        else { plainSeen++; ok(tagged.length === 0, `stratum ${s} plain room: no dark elite`); }
      }
    }
  }
  ok(darkRooms > 0 && darkSeen === darkRooms * 6 && plainSeen > 0, `dark rooms planned ${darkSeen}`);
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
      const room = w.floor.rooms.find(r => r.type === 'combat' && !!r.dark === dark);
      room.reward = from;
      w.enterRoom(room.id, 's'); w.enemies.length = 0; w.zones.length = 0; w.fx.length = 0;
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
{ // Deep Wick: darkLoot() = DARK_LOOT x (1 + 0.1 x the highest rank in the party), used by drops, the xp budget and the Tab sheet; clearing a dark room counts in run.darkCleared (summary and snapshot)
  const L = ED.World.DARK_LOOT, G = ED.World.GOLD_MUL, up = (r) => ED.UPGRADES.map(u => (u.id === 'deepwick' ? r : 0));
  const mk = (ranks) => {
    const w = new ED.World({ seed: 7, pact: 0, players: ranks.map((r, i) => ({ pid: 'p' + i, name: 'T' + i, slot: i, cls: 'knight', weapon: 'longsword', meta: { up: up(r), mastery: 1, relics: [] } })) });
    w.startRun(); for (const p of w.players.values()) { p.offers.length = 0; p.picks = 0; p.offer = null; }
    w.enemies.length = 0; w.enc = null; w.locked = false; w.room.type = 'combat'; w.room.reward = null; w.room.dark = true;
    return w;
  };
  const sum = (w, kind) => w.pickups.filter(k => k.kind === kind).reduce((a, k) => a + k.val, 0);
  near(mk([0]).darkLoot(), L, 1e-9, 'no Deep Wick: DARK_LOOT');
  near(mk([3]).darkLoot(), L * 1.3, 1e-9, 'rank 3: +30%');
  near(mk([1, 2]).darkLoot(), L * 1.2, 1e-9, 'a party takes its highest rank, not the sum');
  const w = mk([2]), p = w.players.values().next().value;
  w.pickups.length = 0; w.dropGold(p.x, p.y, 100); near(sum(w, 'gold'), Math.round(100 * G * L * 1.2), 0, 'foe gold uses darkLoot');
  w.pickups.length = 0; w.dropXp(p.x, p.y, 40); near(sum(w, 'xp'), Math.round(40 * L * 1.2), 0, 'xp uses darkLoot');
  const enc = { waves: [[]] }; w.planHorde(w.room, enc);
  ok(enc.xpBudget === Math.round(ED.World.ROOM_XP.combat[0] * L * 1.2), `the dark room's xp budget uses darkLoot (${enc.xpBudget})`);
  w.room.dark = false; w.pickups.length = 0; w.dropGold(p.x, p.y, 100); near(sum(w, 'gold'), Math.round(100 * G), 0, 'a normal room is unaffected');
  w.room.dark = true; w.roomState[w.roomId].cleared = false; w.enc = { kind: 'waves' };
  w.roomCleared();
  if (!ED.Net) require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
  ok(w.run.darkCleared === 1 && w.summary().darkCleared === 1 && ED.Net.encodeSnap(w, [], true).RUN.darkCleared === 1, 'a dark room clear counts in the run summary and the snapshot');
  w.room.dark = false; w.roomState[w.roomId].cleared = false; w.enc = { kind: 'waves' }; w.roomCleared();
  ok(w.run.darkCleared === 1, 'a normal room clear does not');
}
{ // Hearth effects at run start and stratum entry: Head Start xp, Stash gold (party maxima), Second Wind health, Insight rerolls, Provisions heal, Merchant's Favor prices
  const U = ED.UPGRADES, up = (o) => U.map(u => o[u.id] || 0);
  const mk = (metas) => {
    const w = new ED.World({ seed: 7, pact: 0, players: metas.map((m, i) => ({ pid: 'p' + i, name: 'T' + i, slot: i, cls: 'knight', weapon: 'longsword', meta: { up: up(m), mastery: m.mastery || 1, relics: [] } })) });
    w.startRun(); return w;
  };
  const w0 = mk([{}]), p0 = w0.players.get('p0');
  ok(w0.level === 1 && w0.gold === 0 && p0.rerolls === 0 && !p0.secondWind && p0.offers.length === 1 && p0.offers[0].src === 'start', 'no upgrades: level 1, no gold, no reroll, no revive, only the start offer');
  const w1 = mk([{ headstart: 1 }]), q1 = w1.players.get('p0');
  ok(w1.level === 1 && w1.xp === 15 && q1.offers.map(o => o.src).join() === 'start', `Head Start 1: 15 xp, no level yet (level ${w1.level}, xp ${w1.xp})`);
  const w2 = mk([{ headstart: 2 }, {}]);
  ok(w2.level === 2 && w2.xp === 0 && w2.players.get('p1').offers.map(o => o.src).join() === 'start,level', 'Head Start 2 (one hero in a party): 30 xp is level 2 for the whole party, with its level offer');
  ok(mk([{ stash: 2 }, { stash: 1 }]).gold === 10 && mk([{ stash: 1 }]).gold === 5, 'Stash: 5 gold per rank, the highest rank of the party');
  const sw = (r) => { const q = mk([{ secondwind: r }]).players.get('p0'); return [q.secondWind, q.swPct]; };
  ok(sw(1).join() === '1,0.05' && sw(2).join() === '1,0.1' && sw(0).join() === '0,0', 'Second Wind revives at 5% (rank 1) or 10% (rank 2); rank 0 has none');
  const rr = (r, ml) => mk([{ insight: r, mastery: ml || 1 }]).players.get('p0').rerolls;
  ok(rr(1) === 1 && rr(2) === 2 && rr(3) === 3 && rr(3, 8) === 4 && rr(0, 8) === 1, 'Insight gives one reroll per rank; mastery 8 adds one');
  const w3 = mk([{ provisions: 2 }]), q3 = w3.players.get('p0'); q3.hp = Math.round(q3.maxHp * 0.5); w3.onStratumBuild(q3, 2);
  near(q3.hp, Math.round(q3.maxHp * 0.5) + 0.04 * q3.maxHp, 1, 'Provisions 2 heals 4% of max health at stratum II');
  q3.hp = Math.round(q3.maxHp * 0.5); w3.onStratumBuild(q3, 1); ok(q3.hp === Math.round(q3.maxHp * 0.5), 'and nothing at stratum I');
  const price = (r) => mk([{ favor: r }]).priceOf({ type: 'boon' });
  ok(price(0) === 75 && price(1) === 70 && price(2) === 70, "Merchant's Favor: 4% cheaper per rank (the 75-gold epic boon: 75, 70, 70)");
}
// ---- stratum maps: layered graph, forward exits, threat pips, rewards, deterministic per seed ----
{
  const D = ED.Dungeon, FIGHT = { combat: 1, elite: 1, champion: 1 };
  const bad = {}, flag = (k) => { bad[k] = (bad[k] || 0) + 1; };
  let elitesIII = 0, twists = 0, twistEarly = 0, floors = 0;
  const sig = (f) => JSON.stringify(f.rooms.map(r => [r.type, r.row, r.lane, r.dark, r.reward, r.threat, r.doors, r.entry, r.event, r.w, r.h, Array.from(r.tiles).join(''), r.decor.length, !!r.bell])) + f.platino;
  for (let seed = 1; seed <= 200; seed++) for (let s = 1; s <= ED.CONST.STRATA; s++) {
    const f = D.generate(s, seed * 7919 + 13), rm = f.rooms, R = f.rows; floors++;
    if (seed <= 40 && sig(f) !== sig(D.generate(s, seed * 7919 + 13))) flag('determinism');
    if (R !== D.rowsOf(s) || rm[f.start].row !== 0 || rm[f.boss].row !== R + 1 || rm[f.start].type !== 'start' || rm[f.boss].type !== 'boss') flag('rows');
    const seen = new Set([f.start]), q = [f.start];
    while (q.length) for (const n of rm[q.pop()].exits) if (!seen.has(n)) { seen.add(n); q.push(n); }
    if (seen.size !== rm.length) flag('every room reachable from the start');
    for (const r of rm) {
      if (r.id !== f.boss && !r.exits.length) flag('every room but the boss has an exit');
      if (r.exits.some(n => rm[n].row !== r.row + 1)) flag('exits lead one row forward');
      if (r.exits.some((n, i) => r.doors['n' + i] !== n)) flag('exit doors n0, n1, ... in lane order');
      if (r.entry !== (r.row > 0)) flag('every room but the start has the sealed entry');
      const want = r.type === 'boss' ? 3 : FIGHT[r.type] ? Math.min(3, 1 + (r.type === 'elite' || r.type === 'champion') + r.dark + (2 * r.row > R)) : 0;
      if (r.threat !== want) flag('threat pips');
      if (!!r.bell !== (s === 3 && r.dark)) flag('the Drowned Bell stands in the dark rooms of stratum III only');
      if (r.type === 'elite') { if (r.reward === 'twist') { if (s < 3) twistEarly++; else twists++; } if (s >= 3) elitesIII++; }
    }
    if (f.platino !== -1 && !(f.platino >= 1 && f.platino <= 3)) flag('the Platino cue is a fight ordinal 1-3');
  }
  ok(!Object.keys(bad).length, `stratum maps (${floors}): ${JSON.stringify(bad)}`);
  ok(twistEarly === 0 && Math.abs(twists / elitesIII - 0.15) < 0.04, `elite Twist rewards from stratum III only, ${twists}/${elitesIII} of them`);
}
{ // co-op doors: the party leaves once every living hero stands in the same exit door; P[26] carries the door a hero waits in
  const D = ED.Dungeon, T = ED.CONST.TILE;
  const spot = (room, d) => ({ x: (room.doorX[d] + 0.5) * T, y: T });
  const mk = (n) => { const w = new ED.World({ seed: 9, pact: 0, players: [...Array(n)].map((_, i) => ({ pid: 'p' + i, name: 'H' + i, slot: i, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() })) }); w.startRun(); for (const p of w.players.values()) { p.offers.length = 0; p.picks = 0; p.offer = null; } return w; };
  const put = (p, pt) => { p.x = pt.x; p.y = pt.y; };
  const w = mk(2), room = w.room, [a, b] = [...w.players.values()], d = 'n0', d2 = 'n1';
  ok(room.type === 'start' && !w.locked && room.doors[d] >= 0 && room.doors[d2] >= 0, 'the start room has two open exits or more');
  put(a, spot(room, d)); w.checkDoors();
  const want = D.doorWant(d);
  ok(w.room === room && a.doorWant === want && want > 0 && b.doorWant === 0 && /H1/.test(w.waitMsg), `one hero in the door: the party waits (${w.waitMsg})`);
  const row = ED.Net.encodeSnap(w, [], true).P.find(q => q[0] === 'p0');
  ok(row[26] === want && D.wantDoor(row[26]) === d, `P[26] carries the wanted door (${row[26]})`);
  put(b, spot(room, d2)); w.checkDoors(); ok(w.room === room && b.doorWant === D.doorWant(d2), 'two heroes in different doors: nobody moves');
  put(b, spot(room, d)); w.checkDoors();
  ok(w.room.id === room.doors[d], 'both heroes in the same door: the party moves');
  const w2 = mk(2), r2 = w2.room, [c, e] = [...w2.players.values()];
  e.downed = true; e.bleed = 10; put(c, spot(r2, d)); w2.checkDoors();
  ok(w2.room.id === r2.doors[d] && e.downed, 'a downed hero moves with the party');
  const w3 = mk(1), r3 = w3.room, s0 = [...w3.players.values()][0];
  put(s0, spot(r3, d)); w3.checkDoors();
  ok(w3.room.id === r3.doors[d] && s0.doorWant === 0, 'solo: the door takes the hero at once');
}
{ // bot map walk (fully upgraded heroes): one room per map row from the start camp to the boss; --dark=never takes a path with the fewest dark rooms, --dark=always enters at least one per stratum
  for (const [seed, cls] of [[1000, 'knight'], [1028, 'ranger'], [1015, 'pyro']]) {
    for (const dark of ['never', 'always']) {
      const r = runBot({ seed, n: 1, cls: [cls], skill: 0.75, up: ED.UPGRADES.map(u => u.costs.length), mastery: 10, relics: ED.RELIC_IDS.filter(id => ED.RELICS[id].start), pick: 'smart', dark, maxStratum: 2 });
      ok(r.left.length >= 1 && r.left.every(f => f.visited === f.rows + 2), `${cls} ${dark}: one room per row, start to boss (${JSON.stringify(r.left)})`);
      ok(r.left.length >= 1 && r.left.every(f => (dark === 'never' ? f.dark === f.minDark : f.dark >= 1)), `${cls} ${dark}: dark rooms entered ${r.left.map(f => f.dark + '/' + f.minDark).join(',')}`);
    }
  }
}
{ // Cartographer: two dark rooms and an elite room cleared on one stratum
  const { w } = stage('knight', {});
  const clear = (room) => { w.enterRoom(room.id, 's'); w.enemies.length = 0; w.zones.length = 0; w.roomCleared(); };
  for (let s = 1; s <= 3 && !(w.floor.rooms.filter(r => r.dark).length >= 2 && w.floor.rooms.some(r => r.type === 'elite')); s++) w.enterStratum(s);
  const darks = w.floor.rooms.filter(r => r.dark), elite = w.floor.rooms.find(r => r.type === 'elite');
  if (darks.length >= 2 && elite) {
    clear(darks[0]); clear(elite); ok(!w.run.fullClear, 'one dark room and an elite: not yet');
    clear(darks[1]); ok(w.run.fullClear && w.summary().fullClear, 'two dark rooms and an elite: Cartographer');
    w.run.fullClear = false; w.enterStratum(w.stratum === 1 ? 2 : 1); clear(w.floor.rooms.find(r => r.dark)); ok(!w.run.fullClear, 'the count starts over on a new stratum');
  } else ok(false, 'stage floor has two dark rooms and an elite');
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
  const log = w.log;
  w.enterRoom(room.id, 's');
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
// A room of that kind on w's floor; on a floor without one (the finale map has no elite or dark rooms) a plain combat room is turned into one.
const roomOf = (w, kind) => {
  const r = w.floor.rooms.find(q => (kind === 'dark' ? q.dark : kind === 'elite' ? q.type === 'elite' : q.type === 'combat' && !q.dark));
  if (r || kind === 'combat') return r;
  const c = w.floor.rooms.find(q => q.type === 'combat' && !q.dark);
  if (kind === 'dark') c.dark = true; else c.type = 'elite';
  return c;
};
const budgetOf = (s, kind) => Math.round(W0.ROOM_XP[kind === 'elite' ? 'elite' : 'combat'][s - 1] * (kind === 'dark' ? W0.DARK_LOOT : 1));
{ // fodder data: one per biome, in no roster, appended after every other entry
  const ids = ED.BIOMES.map(b => b.fodder), idx = ids.map(id => ED.ENEMY_IDX[id]);
  const NB = ED.BIOMES.length;
  ok(ids.length === NB && new Set(ids).size === NB && ids.every(id => ED.ENEMIES[id] && ED.ENEMIES[id].fodder && ED.ENEMIES[id].ai === 'swarm' && ED.ENEMIES[id].cost === 0 && ED.ENEMIES[id].xp === 0 && ED.ENEMIES[id].hp === 7 && ED.ENEMIES[id].dmg === 1.5), 'one fodder def per biome, hp 7 dmg 1.5 xp 0');
  ok(idx.join() === [...Array(NB)].map((_, i) => ED.ENEMY_IDS.length - NB + i).join(), `fodder are the last wire indices (${idx})`);
  ok(ED.BIOMES.every(b => !b.enemies.some(r => ED.ENEMIES[r[0]].fodder)), 'fodder are in no roster');
  ok(ids.every(id => { const d = ED.ENEMIES[id], a = ED.ENEMIES[d.art]; return d.r >= 6 && d.r <= 8 && d.spd >= 62 && d.spd <= 90 && !!a && !a.fodder && !!d.fly === !!a.fly && d.look === a.look; }), 'fodder: radius 6-8, speed 62-90, art names an existing non-fodder type with the same flight and look');
}
{ // health curve 7 x (1 + 0.25 (s - 1)); pact multipliers apply, the stratum lever, the party multiplier and elites do not
  const { w } = stage('knight', {});
  const w2 = new ED.World({ seed: 7, pact: 0, players: [0, 1].map(i => ({ pid: 'p' + i, name: 'T', slot: i, cls: 'knight', weapon: ED.CLASSES.knight.weapons[0], meta: META() })) });
  w2.startRun();
  for (let s = 1; s <= ED.CONST.STRATA; s++) {
    w.stratum = s; w2.stratum = s;
    const e = w.spawnEnemy(fodderId(s), 0, 0), f = w2.spawnEnemy(fodderId(s), 0, 0), g = w.spawnEnemy(fodderId(s), 0, 0, { elite: true, affix: 'brutal' });
    near(e.maxHp, 7 * (1 + 0.25 * (s - 1)), 1e-9, `fodder health at stratum ${s}`);
    ok(f.maxHp === e.maxHp && g.maxHp === e.maxHp && !g.elite && g.r === e.r, `stratum ${s}: no party multiplier, never elite`);
    w.pact = 1; near(w.spawnEnemy(fodderId(s), 0, 0).maxHp, e.maxHp * ED.PACTS[1].foeHp, 1e-9, 'pact 1 health x Thicker Hides'); w.pact = 10; near(w.spawnEnemy(fodderId(s), 0, 0).maxHp, e.maxHp * ED.PACTS[1].foeHp * ED.PACTS[10].foeHp, 1e-9, 'pact 10 health x Thicker Hides x The Deep Hungers'); w.pact = 0;
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
  w.stratum = ED.CONST.STRATA; p.invuln = 0; const f = w.spawnEnemy('voidmote', p.x + 4, p.y); f.cd = 99; w.enc = {}; const hp0 = p.hp;
  w.updateEnemy(f, TICK);
  const cap = Math.max(1, Math.round(0.03 * p.maxHp));
  ok(hp0 - p.hp >= 1 && hp0 - p.hp <= cap && f.st === 'move', `touch damage ${hp0 - p.hp} within 1..${cap} and untelegraphed (state ${f.st})`);
}
{ // fodder kills: no gold, heart or Grail growth, no split; run counts; hit events carry fd
  const { w, p } = stage('knight', {});
  w.stratum = 3; p.stats.chalice = 1; p.chaliceKills = 0; w.pickups.length = 0;
  for (let i = 0; i < 300; i++) { const e = w.spawnEnemy('brinepolyp', p.x + 40, p.y); w.killEnemy(e, p, {}); }
  ok(!w.pickups.some(k => k.kind === 'gold' || k.kind === 'heart' || k.kind === 'xp') && p.chaliceKills === 0 && p.chaliceHp === 0, 'fodder kills drop no gold, heart or xp (outside a budgeted room) and do not grow the Grail');
  ok(w.run.fodderKills === 300 && w.run.kills >= 300 && p.kills === 300, `fodder kills are counted (${w.run.fodderKills}/${w.run.kills}/${p.kills})`);
  let g = 0; for (let i = 0; i < 300; i++) { const e = w.spawnEnemy('frozenskel', p.x + 40, p.y); w.killEnemy(e, p, {}); } for (const k of w.pickups) if (k.kind === 'gold' || k.kind === 'heart') g++;
  ok(g > 0, 'regular foes still drop gold or hearts (control)');
  const e = w.spawnEnemy('brinepolyp', p.x + 40, p.y), r = w.spawnEnemy('skeleton', p.x + 40, p.y); w.fx.length = 0;
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
  w.stratum = 4; const b4 = w.spawnEnemy(ED.biomeFor(4).boss, p.x + 300, p.y + 120); b4.spd = 0; b4.cd = 9999; b4.age = 200; w.updateEnemy(b4, TICK); ok(!b4.exposed, 'a boss of a fury stratum (IV) is never exposed'); w.stratum = 1;
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
  for (let s = 1; s <= ED.CONST.STRATA; s++) {
    const w = hordeWorld(s, ['knight']), w2 = hordeWorld(s, ['knight', 'ranger']), w4 = hordeWorld(s, ['knight', 'ranger', 'pyro', 'shade']), base = W0.FODDER_Q[s - 1];
    ok(Q(w, { type: 'combat', dark: false }) === base && Q(w, { type: 'combat', dark: true }) === Math.round(base * 1.5) && Q(w, { type: 'elite', dark: false }) === Math.round(base * 0.6), `stratum ${s} quota ${base} / dark / elite`);
    ok(Q(w2, { type: 'combat', dark: false }) === Math.round(base * 1.5) && Q(w4, { type: 'combat', dark: false }) === Math.round(base * 2.5), `stratum ${s} party quota`);
  }
  const wt = hordeWorld(1, ['knight'], true);
  ok(Q(wt, { type: 'combat', dark: false }) === Math.round(W0.FODDER_Q[0] * 0.6), `tutorial stratum I quota ${Q(wt, { type: 'combat', dark: false })}`);
  ok(W0.LIVE_CAP[0] === 120 && W0.LIVE_CAP[1] === 180 && W0.FODDER_XP_SHARE === 0.5 && W0.FODDER_Q.join() === '70,96,123,149,175,210' && W0.WAVES === 3 && W0.ROOM_XP.combat.join() === '30,47,74,103,131,150' && W0.ROOM_XP.elite.join() === '54,79,106,143,195,221', 'horde and xp constants');
}
// Every room kind of every stratum, played out by killing everything: the quota spawns, the room clears, fodder drop no gold or hearts, and the xp dropped is the budget
for (let s = 1; s <= ED.CONST.STRATA; s++) {
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
  const enc = w.enc; ok(enc && enc.xpBudget === W0.ROOM_XP.combat[0] && enc.xpFod === W0.ROOM_XP.combat[0] * W0.FODDER_XP_SHARE && enc.xpThrCap === W0.ROOM_XP.combat[0] * (1 - W0.FODDER_XP_SHARE) && enc.q === W0.FODDER_Q[0], `ledger ${JSON.stringify({ b: enc.xpBudget, f: enc.xpFod, t: enc.xpThrCap, q: enc.q })}`);
  const p = w.players.get('p0'); let got = 0;
  for (let i = 0; i < enc.q; i++) { const e = w.spawnEnemy('bonemite', p.x, p.y); const before = w.log.xp; w.killEnemy(e, p, {}); got += w.log.xp - before; }
  ok(got >= enc.xpFod - 1 && got <= enc.xpFod && enc.xpOut === got, `${enc.q} fodder kills drop ${got} of ${enc.xpFod}`);
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
  const w = hordeWorld(1, ['knight']), room = roomOf(w, 'combat');
  const r = playRoom(w, room, 'threat', 3.5), enc = r.enc, standing = w.hostiles();
  ok(!r.cleared && enc.wave === enc.waves.length - 1 && standing >= 6 && w.hostiles(true) === 0, `waves advance past standing fodder well before the ${W0.PACE.maxAge} s timer (wave ${enc.wave + 1}/${enc.waves.length} after ${r.t.toFixed(1)} s with ${standing} fodder standing)`);
  ok(enc.spawned < enc.q, `the quota is not out yet (${enc.spawned}/${enc.q}): the room stays locked`);
  const r2 = stepRoom(w, enc, 'threat', 60);
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
    w.enterRoom(room.id, 's');
    w.enc.edges = [near]; w.log.packs.length = 0; w.log.sides.clear(); w.log.packDist = Infinity;
    p.x = near === 'w' ? 7.5 * T : near === 'e' ? (room.w - 7.5) * T : room.w * T / 2; p.y = near === 'n' ? 8.5 * T : near === 's' ? (room.h - 7.5) * T : room.h * T / 2 + T;
    stepRoom(w, w.enc, 'none', 25);
    ok(w.log.packs.length >= 4 && w.log.packDist >= 220, `stratum ${s}: hero near the ${near} edge, ${w.log.packs.length} packs from ${[...w.log.sides].join('')}, nearest ${Math.round(w.log.packDist)} px`);
  }
}
{ // one run through the start-of-room rules: the first pack comes with the first threat wave, the next 2-3 s later
  const w = hordeWorld(2, ['knight']), room = roomOf(w, 'combat');
  w.enterRoom(room.id, 's');
  const times = [], p = w.players.get('p0');
  for (let i = 0; i < 60 * 14; i++) { p.invuln = 1e9; const n0 = w.log.packs.length, wv = w.enc.wave; w.update(TICK); if (w.log.packs.length > n0) times.push([w.time, w.enc.wave]); }
  ok(times.length >= 4 && times[0][1] === 0, `the first pack comes with wave 1 (${JSON.stringify(times[0])})`);
  const gaps = times.slice(1).map((t, i) => t[0] - times[i][0]);
  ok(gaps.every(g => g >= 2.0 - 1e-9 && g <= 3.0 + 0.05), `packs 2-3 s apart (${gaps.map(g => g.toFixed(2)).join(' ')})`);
}
{ // measured hero velocity and lead aim: a hero walking at a constant velocity is led toward the intercept point; L 0 aims straight at it; a jump resets the velocity; shot speed follows the stratum
  const { w, p } = stage('knight', {});
  p.lpx = null; p.lpy = null; p.lvx = 0; p.lvy = 0;
  for (let i = 0; i < 60; i++) { p.x += 100 * TICK; w.updatePlayer(p, TICK); }
  near(p.lvx, 100, 0.5, 'a hero walking 100 px/s to the right measures lvx 100'); near(p.lvy, 0, 1e-9, 'and lvy 0');
  near(W0.leadAngle(p.x, p.y + 300, p, 300, 0), -Math.PI / 2, 1e-9, 'L 0 aims straight at the hero');
  near(W0.leadAngle(p.x, p.y + 300, p, 300, 1), Math.atan2(-300, 300 * Math.sqrt(1 / 8)), 0.005, 'L 1 aims at the intercept point (shot 300 px/s, hero 100 px/s across, 300 px away)');
  near(W0.leadAngle(p.x, p.y + 300, { x: p.x, y: p.y }, 300, 1), -Math.PI / 2, 1e-9, 'a target without a measured velocity is aimed at straight');
  p.x += 100; w.updatePlayer(p, TICK); ok(p.lvx === 0 && p.lvy === 0, 'a jump over 24 px resets the measured velocity');
  ok(W0.LEAD[0] === 0 && W0.LEAD[1] === 0 && W0.LEAD[5] === 0.85, 'no lead on strata I-II, 0.85 at VI');
  const e = w.spawnEnemy('bonearcher', p.x + 100, p.y), b = w.spawnEnemy('bonewarden', p.x + 100, p.y);
  w.stratum = 6; const q = w.enemyShoot(e, 0, 200, 'arrow', 1, 6), qb = w.enemyShoot(b, 0, 200, 'bone', 1, 6);
  near(Math.hypot(q.vx, q.vy), 200 * W0.shotSpd(6), 1e-6, 'a foe shot at stratum VI flies x1.4'); near(Math.hypot(qb.vx, qb.vy), 200 * W0.bossShotSpd(6), 1e-6, 'a boss shot at stratum VI flies x1.5');
}
{ // stratum behaviour: lead aim of every aimed foe shot, ground speed, mixed rosters, two-affix elites
  const LD = W0.LEAD, U0 = ED.U, shots = (w) => w.projs.filter(q => q.team === 1);
  const until = (w, e, f, max) => { for (let i = 0; i < (max || 600); i++) { w.updateEnemy(e, TICK); if (f()) return true; } return false; };
  const dev = (ps, a) => ps.reduce((s, q) => s + U0.angDiff(Math.atan2(q.vy, q.vx), a), 0) / ps.length; // mean angular deviation of the shots from angle a
  // Forces the second affix: makeElite on a normal foe with the rng stubbed so the roll succeeds and picks `second`.
  const withAffixes = (w, e, first, second) => {
    const c = w.rng.chance, k = w.rng.pick; w.rng.chance = () => true; w.rng.pick = (a) => (a.includes(second) ? second : a[0]);
    try { w.makeElite(e, first); } finally { w.rng.chance = c; w.rng.pick = k; }
    return e;
  };
  // A knight at stratum s measured walking at (vx, vy) and a still foe 160 px left of it that attacks at once (web ready, no retreat step).
  const duel = (s, type, vx, vy, aff) => {
    const { w, p } = stage('knight', {}); w.stratum = s; p.lvx = vx; p.lvy = vy;
    const e = w.spawnEnemy(type, p.x - 160, p.y); e.spawnT = 0; e.spd = 0; e.cd = 0; e.vars.wcd = 0; e.vars.stepCd = 99;
    if (aff) withAffixes(w, e, aff[0], aff[1]);
    return { w, p, e };
  };
  const want = (e, p, spd, s) => W0.leadAngle(e.x, e.y - 4, p, spd * W0.shotSpd(s), LD[s - 1]);
  const straight = (e, p) => Math.atan2(p.y - (e.y - 4), p.x - e.x);
  // shooter: strata I-II aim straight, III+ lead
  for (const s of [1, 2, 3, 6]) {
    const { w, p, e } = duel(s, 'bonearcher', 90, 60), S = e.def.shot;
    ok(until(w, e, () => shots(w).length > 0), `stratum ${s}: the archer shoots`);
    const d = dev(shots(w), want(e, p, S.speed, s));
    ok(Math.abs(d) < 1e-9, `stratum ${s}: the archer's shots are centred on leadAngle with L ${LD[s - 1]} (off by ${d})`);
    if (s < 3) ok(Math.abs(dev(shots(w), straight(e, p))) < 1e-9, `stratum ${s}: no lead, aimed straight`);
    else ok(Math.abs(dev(shots(w), straight(e, p))) > 0.03, `stratum ${s}: the shot is led away from the straight line`);
  }
  { // the aim is recomputed every wind-up frame; a swift second affix shortens the wind-up
    const { w, p, e } = duel(6, 'bonearcher', 90, 0), S = e.def.shot;
    ok(until(w, e, () => e.st === 'aim'), 'the archer winds up'); near(e.t, S.windup, 1e-9, 'plain wind-up');
    const a1 = e.aimA; p.lvy = -90; w.updateEnemy(e, TICK);
    near(e.aimA, want(e, p, S.speed, 6), 1e-9, 'the aim is recomputed every wind-up frame'); ok(Math.abs(e.aimA - a1) > 0.01, 'and follows the hero turning');
    const t = duel(6, 'bonearcher', 0, 0, ['brutal', 'swift']);
    ok(until(t.w, t.e, () => t.e.st === 'aim'), 'the swift elite winds up'); near(t.e.t, S.windup * 0.7, 1e-9, 'swift in the second slot shortens the wind-up (x0.7)');
  }
  { // orbiter burst: leads during the aim phase, locks for the last 0.15 s
    const { w, p, e } = duel(4, 'drone', 80, 0), B = e.def.burst;
    ok(until(w, e, () => e.st === 'aim' && e.t <= 0.15), 'the drone aims');
    const lock = e.aimA;
    near(lock, want(e, p, B.speed, 4), 1e-9, 'the drone aims at the lead point (L 0.5)'); p.lvx = -200;
    ok(until(w, e, () => shots(w).length > 0), 'the drone fires');
    near(Math.atan2(shots(w)[0].vy, shots(w)[0].vx), lock, 1e-9, 'the burst keeps the angle locked in the last 0.15 s');
  }
  // turret spread, then the lobbed glob (the spitter alternates); the glob lands lvx x flight x L ahead
  for (const s of [2, 5]) {
    const { w, p, e } = duel(s, 'spitter', 100, 0), P = e.def.pattern;
    ok(until(w, e, () => shots(w).length > 0), `stratum ${s}: the spitter spreads`);
    ok(Math.abs(dev(shots(w), want(e, p, P.speed, s))) < 1e-9, `stratum ${s}: the turret spread is centred on leadAngle`);
    e.cd = 0; w.projs.length = 0;
    ok(until(w, e, () => w.zones.some(z => z.lob)), `stratum ${s}: the spitter lobs a glob`);
    const z = w.zones.find(q => q.lob);
    near(z.x, p.x + 100 * z.dur * LD[s - 1], 1e-6, `stratum ${s}: the glob lands ${LD[s - 1]} x lvx x flight ahead (flight ${z.dur})`); near(z.y, p.y, 1e-6, 'and on the hero row');
  }
  { const { w, p, e } = duel(5, 'imp', 0, -120);
    ok(until(w, e, () => w.zones.some(z => z.lob)), 'the imp lobs a fireball');
    const z = w.zones.find(q => q.lob); near(z.y, p.y - 120 * z.dur * LD[4], 1e-6, 'the lobber leads by lvy x flight x L'); near(z.x, p.x, 1e-6, 'and not sideways');
  }
  { // a lob whose lead point lies inside a wall lands on floor, short of it
    const { w, p, e } = duel(6, 'spitter', 400, 0), D0 = ED.Dungeon;
    let x = p.x; while (!D0.blocksShots(D0.tileAt(w.room, x, p.y), false) && x < p.x + 2000) x += 4;
    p.x = x - 30; e.x = p.x - 160; e.vars.n = 1;
    ok(until(w, e, () => w.zones.some(z => z.lob)), 'the glob is lobbed at a hero by a wall');
    const z = w.zones.find(q => q.lob);
    ok(!D0.blocksShots(D0.tileAt(w.room, z.x, z.y), false) && z.x < x && z.x > p.x, `a glob led into a wall lands on floor in front of it (x ${Math.round(z.x)}, wall at ${x}, hero ${Math.round(p.x)})`);
  }
  { // web shot: led, and its flight time matches the telegraphed landing circle at the final speed
    const { w, p, e } = duel(5, 'cavespider', 100, 0), Wb = e.def.web;
    ok(until(w, e, () => shots(w).some(q => q.kind === 'web')), 'the spider webs');
    const q = shots(w).find(r => r.kind === 'web'), z = w.zones.find(r => r.detached);
    ok(Math.abs(dev([q], want(e, p, Wb.speed, 5))) < 1e-9, 'the web is aimed at the lead point');
    near(q.life * Math.hypot(q.vx, q.vy), Math.hypot(z.x - e.x, z.y - e.y), 1e-6, 'the web flies exactly to its landing circle at the stratum shot speed');
  }
  { // caster wave
    const { w, p, e } = duel(5, 'siren', 100, 30), C = e.def.cast;
    ok(until(w, e, () => shots(w).length === C.n), 'the siren casts its wave');
    ok(Math.abs(dev(shots(w), want(e, p, C.speed, 5))) < 1e-9, 'the wave is centred on the lead angle');
  }
  { // caster wind-up telegraphs: a wave shows a cone that follows the led aim, a ring or homing cast a warn circle on the caster; both belong to the caster
    const { w, p, e } = duel(5, 'siren', 100, 30);
    ok(until(w, e, () => e.st === 'cast'), 'the siren winds up');
    const zc = w.zones.find(z => z.kind === 'teleCone' && z.src === e && z.warnOnly);
    ok(zc && Math.abs(zc.dur - e.t) < 1e-9 && zc.a === e.aimA, 'a wave wind-up shows a warn cone on the led aim for the whole wind-up');
    const r = duel(5, 'tidecaller', 100, 30);
    ok(until(r.w, r.e, () => r.e.st === 'cast'), 'the tidecaller winds up');
    ok(r.w.zones.some(z => z.kind === 'tele' && z.src === r.e && z.warnOnly && Math.abs(z.dur - r.e.t) < 1e-9), 'a ring wind-up shows a warn circle on the caster');
  }
  { // a spiral pattern starts straight at the hero (ring, laser and dive patterns are not led either)
    const { w, p, e } = duel(6, 'flameturret', 150, 0);
    ok(until(w, e, () => e.st === 'aim'), 'the totem winds up');
    near(e.aimA, Math.atan2(p.y - e.y, p.x - e.x), 1e-9, 'a spiral starts straight at the hero (no lead)');
  }
  { // ground speed: normal foes x foeSpd; bosses and fodder keep theirs
    const { w } = stage('knight', {});
    for (const s of [1, 4, 6]) {
      w.stratum = s;
      const sk = w.spawnEnemy('skeleton', 0, 0), bs = w.spawnEnemy('bonewarden', 0, 0), fd = w.spawnEnemy(fodderId(s), 0, 0);
      near(sk.spd, ED.ENEMIES.skeleton.spd * W0.foeSpd(s), 1e-9, `stratum ${s}: a normal foe moves x${W0.foeSpd(s)}`);
      ok(bs.spd === ED.ENEMIES.bonewarden.spd && fd.spd === ED.ENEMIES[fodderId(s)].spd, `stratum ${s}: a boss and a fodder foe keep their speed`);
    }
    near(W0.foeSpd(6), 1.2, 1e-9, 'x1.2 at stratum VI');
  }
  { // mixed rosters: the previous biome's foes join a room at MIX_PREV
    ok(W0.MIX_PREV === 0.6, 'MIX_PREV is 0.6');
    const w = hordeWorld(2, ['knight']), room = roomOf(w, 'combat');
    const only = new Set(ED.biomeFor(1).enemies.map(r => r[0]).filter(id => !ED.biomeFor(2).enemies.some(r => r[0] === id)));
    const share = (mp, n) => { W0.MIX_PREV = mp; let m = 0; for (let i = 0; i < n; i++) { w.rng = new U0.RNG(500 + i); if (w.planWaves(room).some(wv => wv.some(f => only.has(f.type)))) m++; } return m / n; };
    try {
      ok(only.size > 0 && share(0, 40) === 0, 'MIX_PREV 0: no foe of the previous biome');
      const all = share(1, 300), f = share(0.6, 300); ok(all > 0.6, `MIX_PREV 1: most rooms hold previous-biome foes (${all.toFixed(2)})`);
      ok(Math.abs(f - 0.6 * all) < 0.12, `MIX_PREV 0.6: ${f.toFixed(2)} of rooms hold previous-biome foes, 0.6 x ${all.toFixed(2)} expected`);
    } finally { W0.MIX_PREV = 0.6; }
  }
  { // two-affix elites
    const { w } = stage('knight', {});
    ok(W0.AFFIX2.join() === '0,0,0,0.35,0.6,0.85', 'AFFIX2 by stratum');
    const roll = (s, n, first) => {
      w.stratum = s; let two = 0, bad = 0;
      for (let i = 0; i < n; i++) {
        const e = { hp: 100, maxHp: 100, dmg: 10, spd: 50, r: 10, ward: 0, wardMax: 0 }; w.makeElite(e, first);
        if (e.elite2) two++;
        if (e.elite2 && (e.elite2 === e.elite || !ED.AFFIXES[e.elite2])) bad++;
        if (Math.abs(e.maxHp - 100 * (2.4 + 0.4 * (s - 1))) > 1e-9 || Math.abs(e.dmg - 9 * (ED.hasAffix(e, 'brutal') ? 1.4 : 1)) > 1e-9 || Math.abs(e.spd - 50 * (ED.hasAffix(e, 'swift') ? 1.4 : 1)) > 1e-9 || Math.abs(e.ward - (ED.hasAffix(e, 'warded') ? 0.45 * e.maxHp : 0)) > 1e-9) bad++;
      }
      return { p: two / n, bad };
    };
    for (const s of [1, 2, 3]) { const r = roll(s, 500); ok(r.p === 0 && r.bad === 0, `stratum ${s}: no second affix (${r.p})`); }
    for (const s of [4, 5, 6]) { const r = roll(s, 1500); near(r.p, W0.AFFIX2[s - 1], 0.06, `stratum ${s}: second affix chance`); ok(r.bad === 0, `stratum ${s}: elite2 differs from elite, HP and damage multipliers apply once, each affix effect once`); }
    ok(roll(6, 400, 'brutal').bad === 0, 'a given first affix (dark-room elite) is never repeated in slot 2');
    ok(ED.hasAffix({ elite: 'swift', elite2: 'brutal' }, 'brutal') && ED.hasAffix({ elite: 'swift' }, 'swift') && !ED.hasAffix({ elite: 'swift' }, 'brutal') && !ED.hasAffix({ elite: null }, 'swift'), 'hasAffix reads both slots');
    w.stratum = 4; const base = w.spawnEnemy('skeleton', 100, 100), mk = (first, second) => withAffixes(w, w.spawnEnemy('skeleton', 100, 100), first, second);
    const sw = mk('brutal', 'swift');
    near(sw.spd, base.spd * 1.4, 1e-9, 'swift in slot 2: speed x1.4'); near(sw.dmg, base.dmg * 0.9 * 1.4, 1e-9, 'brutal in slot 1: damage x1.4 once'); near(sw.maxHp, base.maxHp * (2.4 + 0.4 * 3), 1e-9, 'elite HP multiplier once');
    near(mk('swift', 'brutal').dmg, base.dmg * 0.9 * 1.4, 1e-9, 'brutal in slot 2: damage x1.4');
    const wd = mk('swift', 'warded'); near(wd.ward, wd.maxHp * 0.45, 1e-9, 'warded in slot 2: ward 45% of max HP');
    const vo = mk('swift', 'volatile'); w.zones.length = 0; w.killEnemy(vo, null, {});
    ok(w.zones.some(z => z.boom === 'fire' && z.r === 70), 'volatile in slot 2: explodes on death');
    const va = mk('swift', 'vampiric'), p = w.players.get('p0'); p.invuln = 0; va.hp = va.maxHp / 2; w.hurtPlayer(p, 10, { e: va, x: va.x, y: va.y });
    ok(va.hp > va.maxHp / 2, 'vampiric in slot 2: heals when it hurts a hero');
  }
}
{ // boss fights: aimed volley (count per phase, flight speed, lead at release, projectile kind), the phase-3 overlap, one sequence per living hero, grown summon lists, the fodder trickle
  const BV = W0.BOSS_VOL, B = ED.Bosses, Dn = ED.Dungeon, angD = ED.U.angDiff, KIND = { drownedking: 'trident', hollowking: 'void' }, VB = (s) => (B[ED.biomeFor(s).boss].attacks.volley ? undefined : 'drownedking'); // VB: a volley boss for stratum s (bosses I and II have none)
  // A boss of stratum s's biome (or `type`) standing still left of the heroes in the start room, hp out of reach; its volley shots (damage x0.6) are logged in w.vs with the heroes' state at the release.
  function bossWorld(s, classes, type) {
    const w = hordeWorld(s, classes), ps = [...w.players.values()], c = Dn.center(w.room);
    ps.forEach((p, i) => { p.x = c.x + 100; p.y = c.y + (i - (ps.length - 1) / 2) * 70; p.invuln = 1e9; });
    const b = w.spawnEnemy(type || ED.biomeFor(s).boss, c.x - 140, c.y);
    b.spd = 0; b.cd = 9999; b.hp = b.maxHp = 1e9; b.target = ps[0];
    const vs = w.vs = [], es = w.enemyShoot;
    w.enemyShoot = function (e, a, speed, kind, m, r, x) {
      const q = es.call(this, e, a, speed, kind, m, r, x);
      if (m === BV.dmg) vs.push({ t: this.time - w.t0, a, kind, q, x: e.x, y: e.y, hs: ps.map(p => ({ x: p.x, y: p.y, lvx: p.lvx, lvy: p.lvy, up: this.alive(p) })) });
      return q;
    };
    w.t0 = w.time;
    return { w, b, ps, c };
  }
  const go = (w, secs, each) => { for (let i = 0, n = Math.round(secs * 60); i < n; i++) { for (const p of w.players.values()) p.invuln = 1e9; if (each) each(i); w.update(TICK); } };
  const startVol = (w, b, phase) => { b.phase = phase || 1; b.st = 'atk'; b.atk = 'volley'; b.t = 0; b.vars = { wm: 1 }; B[b.type].attacks.volley.start(w, b); };
  const finalSp = (s) => BV.speed + BV.step * (s - 1), Lof = (s) => W0.LEAD[s - 1];
  const lead = (v, h, s) => W0.leadAngle(v.x, v.y - 4, h, finalSp(s), Lof(s)); // the angle a shot released at v should have toward hero state h
  ok(BV.speed === 320 && BV.step === 20 && BV.n.join() === '3,4,5' && W0.BOSS_OV_GAP === 5, 'volley constants');
  for (const type of Object.keys(KIND)) ok(B[type].attacks.volley && B[type].attacks.volley.w === 2 && !B[type].attacks.volley.phase, `${type} has the volley entry (weight 2, every phase)`);
  for (const type of ['bonewarden', 'sporemother']) ok(!B[type].attacks.volley, `${type} has no volley`);
  for (let ph = 1; ph <= 3; ph++) { // shots by phase, the first 0.5 s after the start, 0.12 s apart, then the main state moves on
    const { w, b } = bossWorld(4, ['knight']);
    startVol(w, b, ph); ok(b.vol && b.vol.n === BV.n[ph - 1], `phase ${ph}: volley of ${BV.n[ph - 1]}`);
    go(w, 1.15);
    ok(w.vs.length === BV.n[ph - 1], `phase ${ph}: ${w.vs.length} shots (want ${BV.n[ph - 1]})`);
    ok(w.vs.every((v, i) => Math.abs(v.t - w.vs[0].t - i * BV.gap) <= 1.5 * TICK) && w.vs[0].t >= BV.tele - 1e-9 && w.vs[0].t <= BV.tele + 2 * TICK, `phase ${ph}: first shot at ${w.vs[0].t.toFixed(2)} s, ${BV.gap} s apart`);
    ok(!b.vol && b.st === 'idle', `phase ${ph}: the main state resumes after the volley (${b.st})`);
    ok(w.zones.every(z => !(z.kind === 'teleLine' && z.src === b)), `phase ${ph}: the warn line is gone`);
  }
  for (let s = 1; s <= ED.CONST.STRATA; s++) { // flight speed 320 + 20 per stratum, the biome's kind, damage x0.6, the angle led by the stratum's share of a walking hero's velocity at the release
    const { w, b, ps } = bossWorld(s, ['knight'], VB(s)), p = ps[0];
    p.y -= 60; startVol(w, b, 1);
    go(w, 1.1, () => { p.y += 90 * TICK; });
    ok(w.vs.length === 3, `stratum ${s}: 3 shots (${w.vs.length})`);
    ok(w.vs.every(v => Math.abs(Math.hypot(v.q.vx, v.q.vy) - finalSp(s)) < 1e-6), `stratum ${s}: shots fly ${finalSp(s)} px/s (${w.vs.map(v => Math.hypot(v.q.vx, v.q.vy).toFixed(2))})`);
    ok(w.vs.every(v => v.kind === KIND[b.type] && v.q.kind === KIND[b.type] && Math.abs(v.q.dmg - 0.6 * b.dmg) < 1e-9), `stratum ${s}: ${KIND[b.type]} shots at 0.6 x boss damage`);
    ok(w.vs.every(v => Math.abs(angD(v.a, lead(v, v.hs[0], s))) < 1e-9 && Math.abs(angD(Math.atan2(v.q.vy, v.q.vx), v.a)) < 1e-9), `stratum ${s}: each shot is angled by leadAngle at its release`);
    const v = w.vs[2], off = Math.abs(angD(v.a, Math.atan2(v.hs[0].y - (v.y - 4), v.hs[0].x - v.x)));
    ok(Lof(s) === 0 ? off < 1e-9 : off > 0.03 * Lof(s), `stratum ${s}: aim ${Lof(s) ? 'leads by ' + off.toFixed(3) + ' rad' : 'is straight'}`);
  }
  { const S4 = ED.CONST.STRATA, { w, b } = bossWorld(S4, ['knight']); w.pact = 8; startVol(w, b, 1); go(w, 1.1); ok(w.vs.length === 3 && w.vs.every(v => Math.abs(Math.hypot(v.q.vx, v.q.vy) - finalSp(S4) * 1.2) < 1e-6), 'Pact 8: volley shots fly x1.2 like every foe shot'); }
  const B4 = B[ED.biomeFor(4).boss]; // the stratum IV boss
  { // the phase-3 overlap: a volley every 5 s on top of whatever the main state runs, never two at once; phase 2 has none
    B4.attacks.hold = { update: () => false };
    for (const ph of [2, 3]) {
      const { w, b } = bossWorld(4, ['knight']);
      b.phase = ph; b.st = 'atk'; b.atk = 'hold'; b.t = 0; b.vars = { wm: 1 };
      const starts = [], lines = [0]; let prev = null, mainKept = true;
      go(w, 16.2, () => {
        if (b.vol && b.vol !== prev) starts.push(w.time - w.t0);
        prev = b.vol;
        lines[0] = Math.max(lines[0], w.zones.filter(z => z.kind === 'teleLine' && z.src === b && !z.dead).length);
        if (b.vol && (b.st !== 'atk' || b.atk !== 'hold')) mainKept = false;
      });
      if (ph === 2) { ok(starts.length === 0 && w.vs.length === 0, `phase 2: no overlap volley (${starts.length})`); continue; }
      ok(starts.length === 3 && Math.abs(starts[0] - 5) <= 3 * TICK && starts.every((t, i) => i === 0 || (t - starts[i - 1] >= 5 - 1e-9 && t - starts[i - 1] <= 5 + 2 * TICK)), `phase 3: volleys at ${starts.map(t => t.toFixed(2))} s (want 5, then every 5)`);
      ok(mainKept && b.st === 'atk' && b.atk === 'hold', 'phase 3: the volley overlaps a running main attack and leaves it alone');
      ok(w.vs.length === 3 * BV.n[2], `phase 3: ${w.vs.length} shots (want ${3 * BV.n[2]})`);
      ok(lines[0] === 1, `phase 3: never two volleys at once (${lines[0]} warn lines at most, one hero)`);
      const vol = B4.attacks.volley; vol.start(w, b); const run = b.vol; vol.start(w, b);
      ok(run && b.vol === run && !vol.ok(w, b), 'a running volley is neither restarted nor chosen again');
    }
    delete B4.attacks.hold;
  }
  { // frozen: the sub-machine and its warn line stall; blindness and a phase change drop it
    const { w, b } = bossWorld(4, ['knight']);
    startVol(w, b, 1); go(w, 0.2); const t0 = b.vol.t; b.frozen = 5; go(w, 1); ok(b.vol && b.vol.t === t0 && w.vs.length === 0, 'a frozen boss does not tick its volley');
    b.frozen = 0; b.blind = 3; go(w, 0.1); ok(!b.vol && w.zones.every(z => !(z.kind === 'teleLine' && z.src === b)), 'a blinded boss drops its volley and its warn line');
    b.blind = 0; startVol(w, b, 1); go(w, 0.2); b.hp = b.maxHp * 0.5; go(w, 0.1); ok(!b.vol && b.phase === 2, 'a phase change drops the volley');
  }
  { // party: one sequence per living hero, each at its own hero, 0.15 s apart; a downed hero gets none
    const { w, b, ps } = bossWorld(3, ['knight', 'ranger', 'pyro', 'shade']);
    ps[3].downed = true; startVol(w, b, 2);
    ok(b.vol.seqs.length === 3, `3 living heroes: ${b.vol.seqs.length} sequences`);
    go(w, 1.6);
    const per = [0, 0, 0, 0], first = [Infinity, Infinity, Infinity, Infinity];
    for (const v of w.vs) { const i = v.hs.findIndex(h => h.up && Math.abs(angD(v.a, lead(v, h, 3))) < 1e-9); if (i >= 0) { per[i]++; first[i] = Math.min(first[i], v.t); } }
    ok(per.join() === '4,4,4,0' && w.vs.length === 12, `4 shots at each living hero, none at the downed one (${per})`);
    ok(Math.abs(first[1] - first[0] - BV.seq) <= 1.5 * TICK && Math.abs(first[2] - first[1] - BV.seq) <= 1.5 * TICK, `sequences ${BV.seq} s apart (${(first[1] - first[0]).toFixed(2)}, ${(first[2] - first[1]).toFixed(2)})`);
    ok(w.vs.every(v => v.t - first[0] <= BV.seq * 2 + BV.gap * 3 + 1.5 * TICK), 'the whole party volley ends 0.3 + 0.36 s after its first shot');
  }
  { // grown summon lists: +1 per living hero beyond the first, at most +3, drawn from the list
    const c4 = ['knight', 'ranger', 'pyro', 'shade'];
    const count = (cls, down, list) => { // B.lib.summon queues one spawn zone per entry of the grown list
      const { w, b, ps } = bossWorld(1, cls, 'drownedking'); for (let i = 0; i < down; i++) ps[ps.length - 1 - i].downed = true;
      b.vars = { wm: 1 }; w.zones.length = 0; B.lib.summon(w, b, list);
      return w.zones.filter(z => z.kind === 'spawn' && !z.n).map(z => z.type);
    };
    const L3 = ['skeleton', 'skeleton', 'skeleton'], L5 = ['skeleton', 'skeleton', 'bat', 'bat', 'bat'];
    ok(count(c4.slice(0, 1), 0, L3).length === 3, 'solo: the 3-entry list stays');
    ok(count(c4.slice(0, 2), 0, L3).length === 4, '2 heroes: 4 entries');
    ok(count(c4, 0, L3).length === 6, '4 heroes: 6 entries (+3)');
    ok(count(c4, 2, L3).length === 4, '4 heroes, 2 downed: 4 entries (living heroes count)');
    const l5 = count(c4, 0, L5);
    ok(l5.length === 8 && l5.every(t => t === 'skeleton' || t === 'bat'), `a 5-entry list, 4 heroes: 8 entries from the list (${l5})`);
    const { w } = bossWorld(1, ['knight'], 'drownedking'), n0 = w.hostiles(true);
    for (let i = 0; i < 12; i++) w.spawnEnemy('bonemite', 50, 50);
    ok(w.hostiles(true) === n0, 'fodder does not count toward a boss summon guard (threat foes only)');
    for (let i = 0; i < 6; i++) w.spawnEnemy('skeleton', 50, 50);
    ok(w.hostiles(true) === n0 + 6, 'six regular foes do');
  }
  for (const heroes of [['knight'], ['knight', 'ranger']]) { // the fodder trickle: packs of 4-6 every 7 s from the boss's spawn, edges 220 px from the heroes, held at the cap, none after the boss dies
    const s = 4, w = hordeWorld(s, heroes), room = w.floor.rooms.find(r => r.type === 'boss'), ps = [...w.players.values()], cap = W0.BOSS_FODDER_CAP[heroes.length > 1 ? 1 : 0];
    const live = () => w.enemies.filter(e => e.fodder && e.hp > 0).length, az = w.addZone, trick = [];
    w.addZone = function (z) { if (z.kind === 'spawn' && z.n) trick.push({ t: this.time, n: z.n, type: z.type, live: live() }); return az.call(this, z); };
    const t0 = w.time;
    playRoom(w, room, 'none', 70);
    ok(w.boss && w.boss.type === ED.biomeFor(s).boss && w.enc.kind === 'boss', `${heroes.length} hero(es): the boss fight runs`);
    ok(trick.length >= 3 && Math.abs(trick[0].t - t0 - 9.4) <= 3 * TICK, `first pack at ${(trick[0].t - t0).toFixed(2)} s (the boss spawns at 2.4 s, +7 s)`);
    ok(trick[1].t - trick[0].t >= 7 - 1e-9 && trick[1].t - trick[0].t <= 7 + 3 * TICK, `the next pack ${(trick[1].t - trick[0].t).toFixed(2)} s later`);
    ok(trick.slice(1).every((k, i) => k.t - trick[i].t >= 7 - 1e-9), 'packs at least 7 s apart');
    ok(trick.every(k => k.n >= 4 && k.n <= 6 && k.type === ED.biomeFor(s).fodder), `packs of 4-6 ${ED.biomeFor(s).fodder} (${trick.map(k => k.n)})`);
    ok(trick.every(k => k.live + k.n <= cap), `a pack lands only while it keeps live fodder within the cap of ${cap} (live before: ${trick.map(k => k.live)})`);
    ok(w.log.packDist >= W0.PACK_AVOID, `packs land ${Math.round(w.log.packDist)} px from the heroes (>= ${W0.PACK_AVOID})`);
    const idle = w.time - t0 - trick[trick.length - 1].t;
    ok(live() > cap - 6 && live() <= cap && idle > 7, `held at the cap: ${live()} fodder live, last pack ${idle.toFixed(1)} s ago`);
    const n0 = trick.length; for (const e of w.enemies.slice()) if (e.fodder && e.hp > 0) w.killEnemy(e, ps[0], {});
    go(w, 0.5); ok(trick.length === n0 + 1, 'a pack follows as soon as the fodder falls below the cap');
    ok(w.log.xp === 0, `fodder of a boss fight drop no xp (${w.log.xp})`);
    w.killEnemy(w.boss, ps[0], {}); const n1 = trick.length;
    ok(!w.enc && w.hostiles() === 0, 'the boss dies: the fight ends and every foe goes');
    go(w, 20); ok(trick.length === n1 && w.hostiles() === 0 && !w.zones.some(z => z.kind === 'spawn'), 'no pack after the boss dies');
  }
}
{ // veteran preset (sim.js --vet): flag parsing, the dodge plan against a shot and a telegraph (reaction time, walk, dash), the rider heading, skill charges, determinism, and an unchanged bot without the flag
  const { parseVet, vetThreats, vetRisk, vetPlan, vetRider } = require('./sim.js');
  const all = parseVet('1');
  ok(parseVet(undefined) === null && parseVet('0') === null && all.size === 4 && all.has('charges') && all.has('hazard') && parseVet('dodge,rider').has('rider') && !parseVet('dodge,rider').has('hazard'), '--vet parses to a feature set, off when absent or 0');
  const { w, p } = stage('knight', {});
  p.x = 160; // 5 tiles from the west wall: walking west the hero stops at the wall in the shot's line
  const t0 = w.time, c = { dashN: 1 }, SPD = 200, REACT = 0.18;
  w.spawnProj({ team: 1, kind: 'arrow', x: p.x + 150, y: p.y, a: Math.PI, speed: 300, r: 6, dmg: 20, life: 4 });
  ok(vetThreats(w, p, SPD, REACT) === null, 'a shot the hero has not yet had the reaction time to see is not dodged');
  w.time = t0 + 0.3;
  const T = vetThreats(w, p, SPD, REACT);
  ok(T && T.pj.length === 1, 'a shot older than the reaction time is a threat');
  const plan = vetPlan(w, p, c, -1, 0, SPD, T);
  ok(plan.risk > 0.5 && Math.abs(plan.my) > 0.3, `walking into a shot's line is risky (${plan.risk.toFixed(2)}) and the plan leaves the line (${plan.mx.toFixed(2)}, ${plan.my.toFixed(2)})`);
  ok(vetRisk(T, p, plan.mx, plan.my, 100, SPD, false) < 0.05, 'the planned heading clears the shot');
  const keep = vetPlan(w, p, c, 0, -1, SPD, T);
  ok(keep.risk === 0 && keep.mx === 0 && keep.my === -1, 'a wanted heading that is safe is kept');
  w.projs.length = 0;
  const e = foe(w, p.x + 200, p.y), z = w.addZone({ kind: 'teleCone', x: p.x + 60, y: p.y, a: Math.PI, r: 120, arc: 1.6, dur: 0.6, dmg: 20, team: 1, src: e });
  z.t = 0.3;
  const Tz = vetThreats(w, p, SPD, REACT), pz = vetPlan(w, p, c, 0, 0, SPD, Tz);
  ok(Tz && Tz.zn.length === 1 && pz.risk > 0.5 && (pz.mx || pz.my) && !pz.dash, `standing in a cone with 0.3 s left: the plan walks out (${pz.mx.toFixed(2)}, ${pz.my.toFixed(2)}), no dash`);
  z.t = 0.5; // 0.1 s left: walking cannot clear it, a dash is untouchable through the hit
  const Td = vetThreats(w, p, SPD, REACT), pd = vetPlan(w, p, c, 0, 0, SPD, Td), pn = vetPlan(w, p, { dashN: 0 }, 0, 0, SPD, Td);
  ok(pd.dash && vetRisk(Td, p, pd.dash[0], pd.dash[1], 72, SPD, true) < 0.05 && pn.dash === null, 'with 0.1 s left a dash heading clears the cone; without a charge there is none');
  w.zones.length = 0; w.enemies.length = 0;
  const r = stage('ranger', { bladedash: 1 }), row = [30, 55, 80].map(d => foe(r.w, r.p.x + d, r.p.y));
  const hd = vetRider(r.w, r.p, { dashN: 1 }, row, null, SPD);
  ok(hd && hd[0] > 0.9, `a row of 3 foes ahead: the rider dash goes through them (${hd && hd.map(v => v.toFixed(2))})`);
  ok(vetRider(r.w, r.p, { dashN: 0 }, row, null, SPD) === null && vetRider(r.w, r.p, { dashN: 1 }, row.slice(0, 2), null, SPD) === null, 'no rider dash without a charge or with 2 foes');
  const nr = stage('ranger', {}); ok(vetRider(nr.w, nr.p, { dashN: 1 }, [30, 55, 80].map(d => foe(nr.w, nr.p.x + d, nr.p.y)), null, SPD) === null, 'no rider dash without a dash rider');
  const run = (o) => runBot(Object.assign({ seed: 1000, n: 1, cls: ['ranger'], skill: 0.75, up: ED.UPGRADES.map(() => 0), mastery: 1, pick: 'smart', force: ['echo'], maxStratum: 1 }, o));
  const a = run({}), b = run({ vet: 'charges' }), id = ED.CLASSES.ranger.skill;
  ok(b.cnt.casts[id] > a.cnt.casts[id], `the second Echo charge is used (${a.cnt.casts[id]} -> ${b.cnt.casts[id]} casts of ${id})`);
  const v1 = run({ vet: '1' }), v2 = run({ vet: '1' }), off = run({ vet: '0' });
  ok(v1.time === v2.time && v1.kills === v2.kills && v1.hp === v2.hp, 'a --vet run is deterministic per seed');
  ok(a.time === off.time && a.kills === off.kills && a.hp === off.hp, 'without --vet (or --vet=0) the bot is unchanged');
}
{ // breakable props: floor gen (kinds, counts, spots, determinism), hero hits break them and foes, foe shots and hazards never do, drops
  const D = ED.Dungeon, T = ED.CONST.TILE;
  const laneOf = (r, x, y) => { const cx = Math.floor(r.w / 2), cy = Math.floor(r.h / 2) + 1; return (Math.abs(x - cx) <= 2 && y >= r.h - 4) || (y <= 4 && Object.keys(r.doors).some(d => Math.abs(x - r.doorX[d]) <= 2)) || (Math.abs(y - cy) <= 2 && (x <= 3 || x >= r.w - 4)); };
  let bad = [], fights = 0, others = 0, same = true;
  for (let s = 1; s <= ED.CONST.STRATA; s++) for (let seed = 1; seed <= 24; seed++) {
    const fl = D.generate(s, seed * 7919 + 13), again = D.generate(s, seed * 7919 + 13), brk = ED.biomeFor(s).breakable;
    for (const r of fl.rooms) {
      if (JSON.stringify(r.breakables) !== JSON.stringify(again.rooms[r.id].breakables) || JSON.stringify(r.decor) !== JSON.stringify(again.rooms[r.id].decor)) same = false;
      const fight = r.type === 'combat' || r.type === 'elite' || r.type === 'champion' || r.type === 'boss', c = D.center(r);
      if (fight) { fights++; if (r.breakables.length < 4 || r.breakables.length > 8) bad.push(`${s}/${seed} ${r.type} holds ${r.breakables.length}`); } else { others++; if (r.breakables.length > 3) bad.push(`${s}/${seed} ${r.type} holds ${r.breakables.length}`); }
      for (const d of r.decor) if (brk.includes(d.k)) bad.push(`${s}/${seed} ${d.k} baked into decor`);
      for (const b of r.breakables) {
        const tx = Math.floor(b.x), ty = Math.floor(b.y);
        if (!brk.includes(b.k)) bad.push(`${s}/${seed} kind ${b.k}`);
        if (r.tiles[ty * r.w + tx] !== 0) bad.push(`${s}/${seed} on tile code ${r.tiles[ty * r.w + tx]} (hazard, block, chasm or door)`);
        if (laneOf(r, tx, ty)) bad.push(`${s}/${seed} ${r.type} on a door lane`);
        if (Math.hypot(b.x * T - c.x, b.y * T - c.y) < T) bad.push(`${s}/${seed} ${r.type} within a tile of the centre`);
      }
    }
  }
  ok(same, 'floor gen is deterministic per (stratum, seed): breakables and decor');
  ok(!bad.length, `${fights} combat, elite and boss rooms hold 4-8 breakables and the ${others} others at most 3, none baked into decor, none on a door lane, a hazard or the centre${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);
  ok(ED.BIOMES.map((b) => b.breakable.join()).join() === 'urn,mushroom,coral,shard', `breakable kinds by stratum (${ED.BIOMES.map((b) => b.breakable.join())})`);
  ok(ED.BIOMES.every((b) => b.breakable.every((k) => b.decor.includes(k))), 'every breakable kind is a decor kind of its stratum');

  const arena = (cls) => { // a combat room with its breakables, no foes, the hero 40 px west of breakable 0
    const { w, p } = stage(cls, {}, 11);
    const rm = w.floor.rooms.find(r => r.type === 'combat' && !r.dark);
    w.enterRoom(rm.id, null); w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0; w.pickups.length = 0; w.fx.length = 0;
    const b = rm.breakables[0], bx = b.x * T, by = b.y * T, rs = w.roomState[rm.id];
    p.x = bx - 40; p.y = by;
    return { w, p, rm, rs, b, bx, by };
  };
  const smashes = (w) => w.fx.filter((e) => e.t === 'smash');
  { // a hero swing
    const { w, p, rs, b, bx, by } = arena('knight');
    ok(p.stats.weapon.kind === 'melee' && rs.broken === 0, 'the arena starts with every breakable whole');
    p.x = bx - 20; w.playerAttack(p, 0);
    ok(rs.broken === 1, `a melee swing breaks the breakable in front of it (mask ${rs.broken})`);
    const ev = smashes(w);
    ok(ev.length === 1 && ev[0].i === 0 && ev[0].k === b.k && ev[0].x === Math.round(bx) && ev[0].y === Math.round(by) && ev[0].r === w.roomId, `one smash event { i, x, y, k, r } (${JSON.stringify(ev)})`);
    w.playerAttack(p, 0); ok(smashes(w).length === 1 && rs.broken === 1, 'a broken breakable breaks once');
    const q = arena('knight'); q.p.x = q.bx - 20; q.w.playerAttack(q.p, Math.PI); ok(q.rs.broken === 0, 'a swing aimed away leaves it');
    const r2 = arena('knight'); r2.p.x = r2.bx - 200; r2.w.playerAttack(r2.p, 0); ok(r2.rs.broken === 0, 'a swing that falls short leaves it');
  }
  { // a hero projectile flies on after the smash
    const { w, p, rs, bx } = arena('ranger');
    p.x = bx - 80; w.playerAttack(p, 0);
    let flown = 0; for (; flown < 90 && !rs.broken; flown++) w.updateProjectiles(1 / 60);
    ok(rs.broken === 1 && flown < 90, `an arrow breaks the breakable it passes over (after ${flown} ticks)`);
    ok(w.projs.some(pr => pr.team === 0), 'the arrow is not consumed by it');
  }
  { // a blast, a skill blast, a dash
    const a = arena('pyro'); a.w.explode(a.bx + 20, a.by, 30, 10, 0, a.p); ok(a.rs.broken === 1, 'a blast breaks a breakable within its radius');
    const far = arena('pyro'); far.w.explode(far.bx + 80, far.by, 30, 10, 0, far.p); ok(far.rs.broken === 0, 'and leaves one outside it');
    const s = arena('knight'); s.w.skillBlast(s.p, s.bx, s.by + 10, 20, 5, { p: s.p, kind: 'skill', part: 'test' }); ok(s.rs.broken === 1, 'a skill blast breaks a breakable');
    const d = arena('shade'), x0 = d.bx - 90;
    d.p.dashing = true; d.p.x = x0; d.w.updatePlayerCombat(d.p, 1 / 60); ok(d.rs.broken === 0, 'a dash that has not reached it leaves it');
    d.p.x = d.bx + 90; d.w.updatePlayerCombat(d.p, 1 / 60); ok(d.rs.broken === 1, 'a dash breaks a breakable on the path it covered since the last tick');
    d.p.dashing = false; d.w.updatePlayerCombat(d.p, 1 / 60); ok(d.p.dashFx < 0, 'the dash path restarts with the next dash');
  }
  { // the movement and throw skills: Shield Charge, Shield Throw, Shadowstep
    const c = arena('knight'); c.p.x = c.bx - 80; c.w.playerSkill(c.p, 0, { x0: c.p.x, y0: c.p.y, x1: c.bx + 60, y1: c.by }, 0);
    for (let i = 0; i < 40; i++) c.w.update(1 / 60);
    ok(c.rs.broken === 1, `Shield Charge breaks a breakable on its run (mask ${c.rs.broken})`);
    const t = arena('knight'); t.p.x = t.bx - 80; t.w.playerSkill(t.p, 0, { d: 200 }, 1);
    for (let i = 0; i < 40; i++) t.w.update(1 / 60);
    ok(t.rs.broken === 1, `a thrown shield breaks a breakable on its flight (mask ${t.rs.broken})`);
    const s = arena('shade'); s.p.x = s.bx - 70; s.w.playerSkill(s.p, 0, { x0: s.p.x, y0: s.p.y, x1: s.bx + 60, y1: s.by }, 0);
    ok(s.rs.broken === 1, `Shadowstep breaks a breakable on its path (mask ${s.rs.broken})`);
  }
  { // never: a foe shot, a foe blast, a hazard pool, a telegraph, a foe on top of it
    const { w, p, rs, bx, by } = arena('knight');
    p.x = bx; p.y = by + 300; p.invuln = 99;
    w.spawnProj({ team: 1, kind: 'bolt', x: bx - 40, y: by, a: 0, speed: 300, r: 8, dmg: 5, life: 1, src: null });
    for (let i = 0; i < 40; i++) w.updateProjectiles(1 / 60);
    w.explode(bx, by, 60, 5, 1, null);
    w.addZone({ kind: 'poison', x: bx, y: by, r: 60, dur: 5, dps: 20, team: 1 });
    w.addZone({ kind: 'tele', x: bx, y: by, r: 60, dur: 0.1, dmg: 5, team: 1 });
    const e = foe(w, bx, by);
    for (let i = 0; i < 90; i++) w.updateZones(1 / 60);
    ok(rs.broken === 0 && !smashes(w).length && e.hp > 0, `a foe shot, a foe blast, a hazard pool, a telegraph and a foe over it leave it whole (mask ${rs.broken})`);
  }
  { // drops: 25% gold of 1-3 (exact), 1% heart, no xp
    const { w, rs } = arena('knight');
    const N = 20000, amt = { 1: 0, 2: 0, 3: 0 };
    let gold = 0, hearts = 0, xp = 0, odd = 0, evs = 0;
    for (let i = 0; i < N; i++) {
      rs.broken = 0; w.pickups.length = 0; w.fx.length = 0;
      w.smashBreakable(0, null); evs += smashes(w).length;
      const g = w.pickups.filter(q => q.kind === 'gold').reduce((a, q) => a + q.val, 0);
      if (g) { gold++; if (amt[g] === undefined) odd++; else amt[g]++; }
      if (w.pickups.some(q => q.kind === 'heart')) hearts++;
      if (w.pickups.some(q => q.kind === 'xp')) xp++;
    }
    near(gold / N, 0.25, 0.02, 'gold drop rate over 20000 smashes');
    ok(odd === 0 && [1, 2, 3].every(v => Math.abs(amt[v] / gold - 1 / 3) < 0.04), `gold amounts are 1, 2 or 3 in equal shares (${amt[1]}/${amt[2]}/${amt[3]}, other ${odd})`);
    near(hearts / N, 0.01, 0.004, 'heart drop rate');
    ok(xp === 0 && evs === N, `no xp, one event per smash (xp ${xp}, events ${evs})`);
  }
}
{ // boss fury: only strata with a start time run the fight clock; it starts at t (one 'fury' event), scales boss damage and the attack pause, caps at max and ignores phases, freezes, stuns and blinds
  const FB = W0.BOSS_FURY, Bs = ED.Bosses, Dn = ED.Dungeon;
  const fw = (s, type) => {
    const w = hordeWorld(s, ['knight']), p = w.players.values().next().value, c = Dn.center(w.room);
    p.x = c.x + 100; p.y = c.y; p.invuln = 1e9;
    const b = w.spawnEnemy(type || ED.biomeFor(s).boss, c.x - 140, c.y);
    b.spd = 0; b.cd = 9999; b.hp = b.maxHp = 1e9; b.target = p;
    return { w, b, p };
  };
  // Ticks the boss alone for secs (each(i) runs before a tick); returns the 'fury' events seen and the tick each came at.
  const run = (w, b, secs, each) => { const ev = []; for (let i = 0, k = Math.round(secs * 60); i < k; i++) { if (each) each(i); w.updateEnemy(b, TICK); for (const e of w.fx) if (e.t === 'fury') ev.push({ e, i: i + 1, x: b.x, y: b.y }); w.fx.length = 0; } return ev; };
  ok(FB.t.length === 6 && FB.t.slice(0, 3).every(v => v === 0) && FB.t.slice(3).every(v => v > 0) && FB.ramp > 0 && FB.max > 1 && FB.warn > 0, `BOSS_FURY: no start in strata I-III, one in IV-VI (${FB.t})`);
  ok(W0.furyMul(4, FB.t[3]) === 1 && W0.furyMul(1, 1e6) === 1 && W0.furyMul(3, 1e6) === 1 && W0.furyMul(6, 1e6) === FB.max, 'furyMul: 1 up to the start and at strata I-III, max far past it');
  near(W0.furyMul(5, FB.t[4] + 10), 1 + 10 * FB.ramp, 1e-12, 'furyMul ramps by BOSS_FURY.ramp per second past the start');
  for (let s = 1; s <= 3; s++) { // no fury at strata I-III, past 200 s
    const { w, b } = fw(s), ev = run(w, b, 205);
    ok(ev.length === 0 && b.furyT === 0 && b.furyM === 1 && b.dmg === b.dmgBase && !w.fx.some(e => e.t === 'fury'), `stratum ${s}: no fury at 205 s (events ${ev.length}, clock ${b.furyT}, x${b.furyM})`);
  }
  const M10 = 1 + 10 * FB.ramp; for (let s = 4; s <= 6; s++) { // starts at t exactly, once; x(1 + 10 ramp) ten seconds on
    const t = FB.t[s - 1], { w, b } = fw(s);
    ok(b.dmgBase === b.dmg && b.furyT === 0 && b.furyM === 1, `stratum ${s}: a fresh boss holds its base damage and a zero clock`);
    const ev = run(w, b, t + 10);
    ok(ev.length === 1 && Math.abs(ev[0].i * TICK - t) <= 1.5 * TICK, `stratum ${s}: one fury event at tick ${ev.length && ev[0].i} (${ev.length && (ev[0].i * TICK).toFixed(3)} s, want ${t})`);
    ok(ev.length === 1 && ev[0].e.type === b.type && ev[0].e.x === Math.round(ev[0].x) && ev[0].e.y === Math.round(ev[0].y), `stratum ${s}: the event names the boss and its spot`);
    near(b.furyT, t + 10, 2 * TICK, `stratum ${s}: clock after ${t + 10} s`);
    near(b.furyM, M10, 0.003, `stratum ${s}: x(1 + 10 ramp) ten seconds in`);
    near(b.dmg, b.dmgBase * b.furyM, 1e-9, `stratum ${s}: boss damage = base x multiplier`);
    ok(run(w, b, 30).length === 0, `stratum ${s}: the event never repeats`);
  }
  { // before the start the multiplier stays 1 and damage untouched (checked tick by tick)
    const { w, b } = fw(4); let bad = 0;
    for (let i = 0, k = Math.round((FB.t[3] - 0.1) * 60); i < k; i++) { w.updateEnemy(b, TICK); if (b.furyM !== 1 || b.dmg !== b.dmgBase) bad++; }
    ok(bad === 0, `stratum IV: x1 and base damage on every tick before ${FB.t[3]} s (${bad} off)`);
  }
  { // new zones and shots carry the scaled damage: a telegraphed pool (x0.9, stratum IV), a shot (x0.6)
    const { w, b } = fw(4);
    b.furyT = FB.t[3] + 10 - TICK; run(w, b, TICK); near(b.furyM, M10, 1e-9, 'jumped ten seconds past the start: x(1 + 10 ramp)');
    b.vars = { wm: 1 }; w.zones.length = 0; for (let i = 0; i < 4; i++) Bs.lib.drop(w, b, b.x + 40 * i, b.y, 24, 1, 0.9, 'bone');
    const zs = w.zones.filter(z => z.src === b && z.kind === 'tele');
    ok(zs.length > 3 && zs.every(z => Math.abs(z.dmg - b.dmgBase * M10 * 0.9) < 1e-9), `${zs.length} spike pools hit for base x(1 + 10 ramp) x0.9 (${zs[0] && zs[0].dmg.toFixed(3)} vs ${(b.dmgBase * M10 * 0.9).toFixed(3)})`);
    const q = w.enemyShoot(b, 0, 100, 'bone', 0.6, 6);
    near(q.dmg, b.dmgBase * M10 * 0.6, 1e-9, 'a volley shot carries base x(1 + 10 ramp) x0.6');
    const sk = w.spawnEnemy('skeleton', b.x + 40, b.y);
    ok(sk.dmgBase === undefined && sk.furyM === undefined && sk.furyT === undefined, 'a summon during fury carries no fury state');
  }
  { // the pause after an attack divides by the multiplier (windups and attack lengths are untouched)
    Bs[ED.biomeFor(4).boss].attacks.hold = { update: () => true };
    const { w, b } = fw(4), after = () => { b.st = 'atk'; b.atk = 'hold'; b.t = 0; b.vars = { wm: 1 }; run(w, b, TICK); return b.t; };
    b.furyT = 10; const t1 = after();
    near(t1, 1.05 * w.threat().pause, 1e-9, 'before the start the phase-1 pause is 1.05 x the stratum pause');
    b.furyT = FB.t[3] + 10 - TICK; const t2 = after();
    near(t2 * M10, t1, 0.003, `ten seconds into fury the pause is divided by 1 + 10 ramp (${t2.toFixed(4)} vs ${t1.toFixed(4)})`);
    b.furyT = 1e4; const t3 = after();
    near(t3, t1 / FB.max, 1e-9, 'at the cap the pause is divided by max');
    delete Bs[ED.biomeFor(4).boss].attacks.hold;
  }
  { // the multiplier caps at max and damage with it
    const { w, b } = fw(6);
    b.furyT = FB.t[5] + 1e3; run(w, b, TICK);
    ok(b.furyM === FB.max && Math.abs(b.dmg - b.dmgBase * FB.max) < 1e-9, `x${b.furyM} capped at ${FB.max}`);
  }
  { // the clock runs through phase changes, freezes, stuns and blinds
    const { w, b } = fw(4);
    const ev = run(w, b, 24, (i) => {
      if (i === 5 * 60) b.hp = b.maxHp * 0.55; // below every boss's first phase line (66% or 60%)
      if (i === 8 * 60) b.frozen = 2;
      if (i === 11 * 60) b.stun = 2;
      if (i === 14 * 60) b.blind = 2;
      if (i === 17 * 60) b.hp = b.maxHp * 0.25; // and the second (33% or 30%)
    });
    ok(b.phase === 3, `both phase changes ran (phase ${b.phase})`);
    near(b.furyT, 24, 2 * TICK, 'the clock read 24 s after 24 s of phases, a freeze, a stun and a blind');
    ok(ev.length === 0, 'no fury inside the first 24 s');
  }
}
{ // healing trim: no heart at a room clear, kill hearts 2%; Forager adds World.FORAGER of max HP per rank to hearts, campfires, fountains, draughts and Vigor rewards
  ok(ED.World.HEART_KILL === 0.02 && ED.World.FORAGER === 0.08, 'heart and Forager constants');
  const { w, p } = stage('knight', {});
  let hearts = 0;
  for (let i = 0; i < 60; i++) { w.pickups.length = 0; w.enc = { kind: 'waves' }; w.locked = true; w.roomState[w.roomId].cleared = false; w.room.reward = null; w.roomCleared(); hearts += w.pickups.filter(k => k.kind === 'heart').length; }
  ok(hearts === 0, `room clears drop no heart (${hearts} in 60)`);
  const heal = (rank, fn) => { p.stats.forager = rank; p.hp = 1; const h0 = p.hp; fn(); return p.hp - h0; };
  near(heal(2, () => w.collect(p, { kind: 'heart', val: 1 })) - heal(0, () => w.collect(p, { kind: 'heart', val: 1 })), 0.16 * p.maxHp, 1e-6, 'Forager 2: a heart heals 16% of max HP more');
  const fire = () => { const g = 9100 + Math.random(); w.props.push({ id: g, kind: 'campfire', x: p.x, y: p.y, group: g, state: 0 }); w.locked = false; w.interact(p.pid, g); };
  near(heal(1, fire) - heal(0, fire), 0.08 * p.maxHp, 1e-6, 'Forager 1: a campfire heals 8% of max HP more');
  p.stats.forager = 0;
}
{ // Hunted: a one-affix champion joins a combat room's second wave, never holds the room, pays a room offer to Hunted holders when killed, leaves with a puff at the clear
  const play = (hunted, killChamp) => {
    const w = hordeWorld(2, ['knight']), p = w.players.get('p0'), room = roomOf(w, 'combat');
    const dir = Object.keys(room.doors).find(k => room.doors[k] >= 0); w.enterRoom(room.id, ED.Dungeon.OPP[dir]);
    p.stats.twHunted = hunted ? 1 : 0;
    const enc = w.enc; let champ = null, seen = 0, t = 0;
    while (w.enc === enc && t < 200) {
      p.invuln = 1e9; w.update(TICK); t += TICK;
      for (const e of w.enemies) if (e.hunted && e.hp > 0) { champ = e; seen = Math.max(seen, w.enemies.filter(q => q.hunted && q.hp > 0).length); }
      for (const e of w.enemies.slice()) if (e.hp > 0 && e.spawnT <= 0 && (!e.hunted || killChamp)) w.killEnemy(e, p, {});
    }
    return { w, p, champ, seen, cleared: w.enc !== enc, enc };
  };
  const a = play(true, false);
  ok(a.cleared && a.champ && a.seen === 1 && a.champ.elite && !a.champ.elite2 && ED.World.DARK_AFFIXES.includes(a.champ.elite), `Hunted: one champion with one affix (${a.champ && a.champ.elite}/${a.champ && a.champ.elite2}) and the room still clears`);
  ok(a.champ && a.champ.hp <= 0 && !a.w.enemies.some(e => e.hunted && e.hp > 0) && a.w.fx.some(ev => ev.t === 'puff') && !a.p.offers.some(o => o.src === 'room'), 'left alive, it leaves with a puff at the clear and pays nothing');
  const b = play(true, true);
  ok(b.cleared && b.champ && b.champ.killed && b.p.offers.filter(o => o.src === 'room').length === 1, 'killed, it pays its holder one room offer');
  const c = play(false, true);
  ok(c.cleared && !c.champ, 'without Hunted no champion comes');
  const bit = ED.Net.encodeSnap(a.w, [], true);
  ok(Array.isArray(bit.E), 'snapshot encodes');
}
{ // Twist offers: bosses II and III grant one per hero beside their rewards (stratum I none); elite Twist rewards are per-hero claims
  for (const s of [1, 2, 3]) {
    const w = hordeWorld(s, ['knight', 'ranger']), boss = w.floor.rooms[w.floor.boss];
    w.enterRoom(boss.id, null);
    const e = w.spawnEnemy(ED.biomeFor(s).boss, 100, 100), p = w.players.get('p0');
    w.killEnemy(e, p, {});
    const tw = [...w.players.values()].map(q => q.offers.filter(o => o.src === 'twist').length);
    ok(tw.every(v => v === (s === 1 ? 0 : 1)), `boss ${s}: Twist offers per hero ${tw}`);
  }
  const w = hordeWorld(3, ['knight', 'ranger']), [p, q] = [...w.players.values()];
  const pr = { id: 9301, kind: 'reward', x: p.x, y: p.y, item: 'twist', group: 9302, state: 0 }; w.props.push(pr); q.x = p.x; q.y = p.y;
  w.interact(p.pid, pr.id); w.interact(p.pid, pr.id); ok(p.offers.filter(o => o.src === 'twist').length === 1 && !pr.state, 'a Twist reward: one claim per hero, the prop stays');
  w.interact(q.pid, pr.id); ok(q.offers.some(o => o.src === 'twist') && pr.state === 1, 'every hero claimed: it is spent');
}
{ // the Drowned Bell stands in every dark room of stratum III; the Platino comes out at the n-th fight clear of its floor
  const f = ED.Dungeon.generate(3, 4242), bells = f.rooms.filter(r => r.bell);
  ok(bells.length >= 1 && bells.length === f.rooms.filter(r => r.dark).length && bells.every(r => r.dark), `a Drowned Bell in each dark room of stratum III (${bells.length})`);
  const { w } = stage('knight', {});
  w.floor.platino = 2; w.floorFights = 0;
  const clear = () => { w.enc = { kind: 'waves' }; w.locked = true; w.roomState[w.roomId].cleared = false; w.room.reward = null; w.roomCleared(); };
  clear(); ok(!w.critter, 'first fight clear: no Platino'); clear(); ok(!!w.critter, 'second fight clear: the Platino is out');
}
console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
