// Usage: node tools/check-secrets.js
// Headless checks of the secret run fields (world.js secretP / secretW): each trigger fires in a constructed scenario and stays off in a near miss; the Drowned Bell (floor gen room.bell, rooms.js ringBell / bellClear)
// sits only on stratum III, deterministic per seed; the Platino (floor.platino: the fight clear that lets it out, rooms.js) is deterministic, harmless and leaves the world's RNG, foes and loot untouched; net.js carries every field.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const fs = require('fs'), path = require('path'), vm = require('vm');
if (!ED.Net) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' }); // the snapshot encoder
const D = ED.Dungeon, T = ED.CONST.TILE;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const DT = 1 / 60;

// A world of heroes (classes in order), started, offers cleared, the room emptied and unlocked; s > 1 enters that stratum first.
function stage(classes, s, seed) {
  const players = classes.map((cls, i) => ({ pid: 'p' + i, name: 'T' + i, slot: i, cls, weapon: ED.CLASSES[cls].weapons[0], meta: META() }));
  const w = new ED.World({ seed: seed || 7, pact: 0, players });
  w.startRun();
  if (s > 1) w.enterStratum(s);
  for (const p of w.players.values()) { p.offers.length = 0; p.picks = 0; p.offer = null; p.invuln = 0; }
  w.enemies.length = 0; w.enc = null; w.locked = false; w.zones.length = 0; w.projs.length = 0; w.chainQ.length = 0; w.fx.length = 0;
  return { w, p: w.players.get('p0') };
}
const mk = (w, p, type, dx, dy, o) => { const e = w.spawnEnemy(type, p.x + (dx || 60), p.y + (dy || 0), o); e.spd = 0; e.cd = 9999; return e; };
const secrets = (w, pid) => w.fx.filter(ev => ev.t === 'secret' && ev.pid === pid).length;
const bossOf = (s) => ED.biomeFor(s).boss;

// ---- Exact Change: party gold of exactly 777 at a tick's end ----
{
  const { w } = stage(['knight']);
  w.gold = 776; w.update(DT);
  ok(!w.run.gold777, 'gold 776: no Exact Change');
  w.gold = 777; w.update(DT);
  ok(w.run.gold777 && secrets(w, null) === 1, 'gold 777: Exact Change, one world secret event');
  w.gold = 0; w.update(DT); w.gold = 777; w.update(DT);
  ok(secrets(w, null) === 1, 'Exact Change announces once');
}

// ---- One Face: four heroes of one kind down a stratum boss ----
for (const party of [['knight', 'knight', 'knight', 'knight'], ['knight', 'knight', 'knight', 'ranger'], ['ranger', 'ranger', 'ranger']]) {
  const { w, p } = stage(party);
  const b = mk(w, p, bossOf(1));
  w.killEnemy(b, p, {});
  const want = party.length === 4 && party.every(c => c === party[0]);
  ok(!!w.run.oneFace === want, `One Face ${party.join('+')}: ${!!w.run.oneFace}`);
}

// ---- Thread of Life: a standing hero below 3% health when the Hollow King dies ----
for (const [frac, downed, want] of [[0.02, false, true], [0.04, false, false], [0.02, true, false]]) {
  const { w, p } = stage(['knight', 'ranger'], ED.CONST.STRATA);
  const q = w.players.get('p1');
  p.hp = p.maxHp * frac; p.downed = downed;
  const b = mk(w, q, bossOf(ED.CONST.STRATA));
  w.killEnemy(b, q, {});
  ok(p.sec.thread === want && !q.sec.thread, `Thread of Life at ${frac * 100}% ${downed ? 'downed' : 'standing'}: ${p.sec.thread}`);
  ok(w.victory || w.state === 'ending', 'the Hollow King ends the run');
}
{
  const { w, p } = stage(['knight'], 3);
  p.hp = p.maxHp * 0.02;
  w.killEnemy(mk(w, p, bossOf(3)), p, {});
  ok(!p.sec.thread, 'Thread of Life: a stratum III boss does not count');
}

// ---- Against the Grain: two paths opened on different strata, the second after stratum I ----
{
  const run = (gates) => { const { w, p } = stage(['knight']); for (const [id, s] of gates) { w.stratum = s; w.contrarianPick(p, ED.BOONS[id]); } return p; };
  ok(run([['kindle', 1], ['frostbite', 2]]).sec.contrarian, 'Flame on stratum I, Frost on stratum II: Against the Grain');
  ok(run([['generalist', 2], ['staticcharge', 3]]).sec.contrarian, 'Steel on stratum II, Storm on stratum III: Against the Grain');
  ok(!run([['kindle', 1], ['frostbite', 1]]).sec.contrarian, 'both paths on stratum I: not earned');
  ok(!run([['kindle', 2]]).sec.contrarian, 'one path: not earned');
  ok(!run([['kindle', 1], ['stoke', 2], ['smother', 3]]).sec.contrarian, 'path cards that are no gate do not count');
  const { w, p } = stage(['knight']);
  w.stratum = 2; p.offer = ['kindle']; p.offers.push({ src: 'level' }); p.picks = 1;
  w.pickBoon('p0', 0);
  ok(p.ctrEl.fire === 2 && !p.sec.contrarian, 'pickBoon records the stratum a gate was picked on');
  // the announcement waits for the Hollow King
  const v = stage(['knight'], ED.CONST.STRATA);
  v.p.sec.contrarian = true;
  v.w.killEnemy(mk(v.w, v.p, bossOf(ED.CONST.STRATA)), v.p, {});
  ok(secrets(v.w, 'p0') === 1, 'Against the Grain announces at the Hollow King');
}

// ---- Return to Sender (Knight): a boss felled by the returning shield ----
for (const [part, boss, cls, want] of [['shieldthrow.return', true, 'knight', true], ['shieldthrow.strike', true, 'knight', false], ['shieldthrow.return', false, 'knight', false], ['shieldthrow.return', true, 'ranger', false]]) {
  const { w, p } = stage([cls]);
  w.killEnemy(mk(w, p, boss ? bossOf(1) : 'skeleton'), p, { p, kind: 'skill', part });
  ok(p.sec.heroSecret === want, `Return to Sender ${cls} ${part} on ${boss ? 'a boss' : 'a foe'}: ${p.sec.heroSecret}`);
}

// ---- Long Shot (Ranger): one weapon shot kills three foes ----
for (const [nFoes, want] of [[3, true], [2, false]]) {
  const { w, p } = stage(['ranger']);
  for (let i = 0; i < nFoes; i++) { const e = mk(w, p, 'skeleton', 40 + 40 * i); e.hp = 1; }
  w.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y, a: 0, speed: 600, r: 5, dmg: 50, life: 1, pierce: 9, owner: p.pid, wpn: true, crit: false });
  for (let i = 0; i < 40; i++) w.updateProjectiles(DT);
  ok(p.sec.heroSecret === want, `Long Shot: one arrow, ${nFoes} kills: ${p.sec.heroSecret}`);
}

// ---- Bonfire (Pyromancer): thirty foes burning at once ----
for (const [nFoes, want] of [[30, true], [29, false]]) {
  const { w, p } = stage(['pyro']);
  for (let i = 0; i < nFoes; i++) { const e = mk(w, p, 'skeleton', 60 + (i % 10) * 20, (i / 10 | 0) * 20); e.burnPool = 50; e.burn = 1; e.burnOwner = p; }
  for (let i = 0; i < 2; i++) w.updateSkills(p, 0.2);
  ok(p.sec.heroSecret === want, `Bonfire: ${nFoes} burning: ${p.sec.heroSecret}`);
}

// ---- Unseen (Shade): five kills in one Vanish window ----
for (const [kills, recast, after, want] of [[5, false, false, true], [4, false, false, false], [4, true, false, false], [5, false, true, false]]) {
  const { w, p } = stage(['shade']);
  w.playerSkill(p, 0, {}, 1);
  ok(p.stealthT > 0, 'Vanish hides the Shade');
  for (let i = 0; i < kills; i++) {
    if (recast && i === kills - 1) w.playerSkill(p, 0, {}, 1);
    if (after) p.stealthT = 0;
    w.killEnemy(mk(w, p, 'skeleton', 60 + i * 10), p, {});
  }
  ok(p.sec.heroSecret === want, `Unseen: ${kills} kills${recast ? ', a new Vanish before the last' : ''}${after ? ', after the window' : ''}: ${p.sec.heroSecret}`);
}

// ---- Smiter (Cleric): 25 Smites on one boss in one fight ----
for (const [a, b, want] of [[25, 0, true], [24, 0, false], [12, 13, false]]) {
  const { w, p } = stage(['cleric']);
  const b1 = mk(w, p, bossOf(1));
  for (let i = 0; i < a; i++) w.smite(b1, p, 1);
  if (b) { w.enemies.length = 0; const b2 = mk(w, p, bossOf(1)); for (let i = 0; i < b; i++) w.smite(b2, p, 1); }
  ok(p.sec.heroSecret === want, `Smiter: ${a}${b ? ' + ' + b + ' on another boss' : ''} Smites: ${p.sec.heroSecret}`);
}

// ---- Risen Champion (Necromancer): an elite it slew rises as its minion ----
for (const [elite, cls, want] of [[true, 'necro', true], [false, 'necro', false], [true, 'knight', false]]) {
  const { w, p } = stage([cls]);
  if (cls === 'necro') { p.stats.wRaise = 1; p.raiseT = 0; }
  const e = mk(w, p, 'skeleton', 60, 0, { elite });
  w.killEnemy(e, p, { p, kind: 'weapon', wpn: true });
  ok(p.sec.heroSecret === want, `Risen Champion: ${elite ? 'elite' : 'foe'} killed by ${cls}: ${p.sec.heroSecret}`);
}

// ---- Toll for Thee (Bellwarden): the Hollow King slain by a Peal hit (generic: src.part 'peal.*') ----
const bellCls = (w, p) => { if (!ED.CLASSES.bell) p.cls = 'bell'; }; // until class-bell.js lands, a stand-in hero carries the id
for (const [s, part, want] of [[ED.CONST.STRATA, 'peal.wave', true], [ED.CONST.STRATA, 'heave.strike', false], [ED.CONST.STRATA - 1, 'peal.wave', false]]) {
  const { w, p } = stage([ED.CLASSES.bell ? 'bell' : 'knight'], s);
  bellCls(w, p);
  w.killEnemy(mk(w, p, bossOf(s)), p, { p, kind: 'skill', part });
  ok(p.sec.heroSecret === want, `Toll for Thee: stratum ${s} boss, ${part}: ${p.sec.heroSecret}`);
}

// ---- the Drowned Bell: floor gen ----
{
  let stray = 0, miss = 0, same = true, floorOk = true;
  for (let seed = 1; seed <= 120; seed++) {
    for (let s = 1; s <= ED.CONST.STRATA; s++) {
      const f = D.generate(s, seed * 7919), bells = f.rooms.filter(r => r.bell);
      if (s !== 3) { stray += bells.length; continue; }
      if (!bells.length || bells.length !== f.rooms.filter(r => r.dark).length || !bells.every(r => r.dark)) { miss++; continue; }
      const g = D.generate(s, seed * 7919), b = bells[0], b2 = g.rooms[b.id].bell;
      if (!b2 || b2.x !== b.bell.x || b2.y !== b.bell.y) same = false;
      if (D.tileAt(b, b.bell.x, b.bell.y) !== 0) floorOk = false;
    }
  }
  ok(stray === 0, `the Drowned Bell stands only on stratum III (${stray} elsewhere)`);
  ok(miss === 0, `every stratum III floor holds a bell in each of its dark rooms (${miss} without)`);
  ok(same, 'bell placement is the same for the same seed');
  ok(floorOk, 'the bell stands on open floor');
}

// The bell room of a stratum III world, entered (its fight locks the room); heroes on the bell's spot - 40 px.
function bellStage(classes) {
  const { w, p } = stage(classes, 3);
  const room = w.floor.rooms.find(r => r.bell);
  w.enterRoom(room.id, null);
  w.fx.length = 0;
  for (const q of w.players.values()) { q.x = room.bell.x; q.y = room.bell.y + 40; q.invuln = 0; q.hp = q.maxHp; }
  return { w, p, room, b: room.bell };
}
const rung = (w, pid) => w.fx.filter(ev => ev.t === 'bellrung' && ev.pid === pid).length;
{
  const { w, p, b } = bellStage(['knight', 'ranger']);
  ok(w.locked, 'the bell room locks for its fight');
  w.smashCircle(p, b.x + 60, b.y, 10);
  ok(p.bellS === 0, 'a hit 60 px away does not ring it');
  w.smashSeg(p, b.x - 30, b.y, b.x + 30, b.y, p.r, true);
  ok(p.bellS === 0 && !rung(w, 'p0'), 'a dash through it does not ring it');
  p.face = -Math.PI / 2; w.playerAttack(p, -Math.PI / 2);
  ok(p.bellS === 1 && rung(w, 'p0') === 1, 'a sword swing rings it (bellrung event)');
  w.smashCircle(p, b.x, b.y, 10);
  ok(rung(w, 'p0') === 1, 'once per hero');
  const q = w.players.get('p1');
  w.smashCircle(q, b.x, b.y, 10);
  ok(q.bellS === 1 && rung(w, 'p1') === 1, 'a second hero rings it too');
  q.hp = q.maxHp * 0.52; w.hurtPlayer(q, q.maxHp * 0.3, {});
  ok(q.hp < q.maxHp * 0.5 && q.bellS === 2, 'dropping below half health breaks the watch');
  w.roomCleared();
  ok(p.sec.bellRung && !q.sec.bellRung, 'the room clears: the hero who held kept it, the other did not');
  ok(secrets(w, 'p0') === 1 && secrets(w, 'p1') === 0, 'the keeper announces one secret');
  const { w: w2, p: p2, b: b2 } = bellStage(['knight']);
  w2.roomCleared();
  w2.smashCircle(p2, b2.x, b2.y, 10);
  ok(p2.bellS === 0, 'a bell struck after the clear stays silent');
  const { w: w3, p: p3, b: b3 } = bellStage(['knight']);
  p3.hp = p3.maxHp * 0.4; w3.smashCircle(p3, b3.x, b3.y, 10); w3.roomCleared();
  ok(p3.bellS === 2 && !p3.sec.bellRung, 'ringing it below half health spends the run\'s chance');
}

// ---- the Platino ----
{
  let floors = 0, hits = 0, same = true, wrong = 0;
  for (let seed = 1; seed <= 400; seed++) for (let s = 1; s <= 3; s++) {
    const f = D.generate(s, seed * 104729), g = D.generate(s, seed * 104729);
    floors++;
    if (f.platino !== g.platino) same = false;
    if (f.platino >= 0) { hits++; if (!(f.platino >= 1 && f.platino <= 3)) wrong++; }
  }
  ok(same, 'the Platino cue is the same for the same seed');
  ok(wrong === 0, `the Platino comes out at the 1st to 3rd fight clear of its floor (${wrong} not)`);
  ok(hits / floors > 0.08 && hits / floors < 0.18, `about one floor in eight has a Platino (${hits}/${floors})`);
}
// Two worlds on one seed, entering the same combat room; `plat` lets the Platino out at its clear (the floor's first fight clear). Returns the world after `ticks` idle ticks past the clear.
function platRun(plat, ticks, moveHero) {
  const { w, p } = stage(['knight'], 1, 11);
  const room = w.floor.rooms.find(r => r.type === 'combat' && !r.dark);
  w.enterRoom(room.id, null);
  w.floor.platino = plat ? 1 : -1; w.floorFights = 0;
  w.enemies.length = 0; w.zones.length = 0; w.enc.q = 0; w.enc.spawned = 0; w.enc.wave = w.enc.waves.length - 1; w.enc.t = 0;
  for (let i = 0; i < ticks; i++) { if (moveHero) moveHero(w, p, i); w.update(DT); }
  return { w, p };
}
{
  const a = platRun(true, 1), b = platRun(false, 1);
  ok(a.w.roomState[a.w.roomId].cleared && !!a.w.critter && !b.w.critter, 'its room clears: the Platino is out (and only where named)');
  const c = a.w.critter;
  ok(c && D.tileAt(a.w.room, c.x, c.y) === 0, 'it stands on open floor');
  ok(c && Math.hypot(c.x - a.p.x, c.y - a.p.y) >= ED.World.PLATINO.avoid - 1, 'it appears away from the heroes');
  ok(!a.w.enemies.length && a.w.nearestEnemy(a.p.x, a.p.y, 2000) === null, 'it is no foe: nothing targets it');
  const enc = ED.Net.encodeSnap(a.w, [], true);
  ok(Array.isArray(enc.C) && enc.C.length === 3, 'snapshots carry it (C)');
  const A = platRun(true, 760), B = platRun(false, 760), A2 = platRun(true, 760);
  ok(!A.w.critter && A.w.fx.some(ev => ev.t === 'puff'), 'it leaves with a puff after 12 s');
  const sig = (w) => JSON.stringify([w.rng.next(), w.rng.next(), w.gold, Math.round(w.xp * 1000), w.level, w.pickups.map(k => [k.kind, Math.round(k.x), Math.round(k.y), k.val]), w.run.kills]);
  const sa = sig(A.w), sb = sig(B.w), sa2 = sig(A2.w);
  ok(sa === sb, 'no balance impact: the same RNG stream, gold, xp and pickups with or without it');
  const pos = (ticks) => { const r = platRun(true, ticks); return r.w.critter ? [Math.round(r.w.critter.x), Math.round(r.w.critter.y)].join(',') : 'gone'; };
  ok(pos(300) === pos(300), 'its path is deterministic');
  ok(sa2 === sa, 'the same seed repeats');
  // the hero walks onto it: caught
  const C = platRun(true, 400, (w, p) => { if (w.critter) { p.x = w.critter.x; p.y = w.critter.y; } });
  ok(C.p.sec.platino && C.w.fx.some(ev => ev.t === 'platino' && ev.pid === 'p0') && !C.w.critter, 'touching it catches it (platino event, run field)');
  ok(secrets(C.w, 'p0') === 1, 'the catch announces one secret');
  // it flees: a hero 100 px away and still; the gap grows
  const F = platRun(true, 1);
  const cr = F.w.critter; F.p.x = cr.x + 90; F.p.y = cr.y; ED.Sim.resolve(F.p, F.w.room, false, false);
  const d0 = Math.hypot(cr.x - F.p.x, cr.y - F.p.y);
  for (let i = 0; i < 30; i++) F.w.update(DT);
  ok(F.w.critter && Math.hypot(F.w.critter.x - F.p.x, F.w.critter.y - F.p.y) > d0 + 20, 'it flees a near hero');
}

// ---- net and summary ----
{
  ok(ED.Net.VERSION === 16, 'N.VERSION 16');
  const { w, p } = stage(['knight', 'ranger']);
  p.sec.platino = true; w.run.gold777 = true;
  const s = ED.Net.encodeSnap(w, [], true);
  ok(s.RUN.gold777 === true && s.RUN.oneFace === false, 'RUN carries the world fields');
  ok(s.RUN.pl && s.RUN.pl.p0 && s.RUN.pl.p0.platino === true && ['platino', 'contrarian', 'thread', 'heroSecret', 'bellRung'].every(k => k in s.RUN.pl.p1), 'RUN carries every hero\'s fields (pl)');
  const sum = w.summary();
  ok(sum.gold777 === true && sum.players.p0.platino === true && sum.players.p1.bellRung === false, 'the run summary carries them');
}

console.log(`${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);
