// Sanctum check (exit 1 on failure). Usage: node tools/check-sanctum.js
// Stage 4 ('wickdeep') headless with the clock jumped to the Sanctum entry: 1. data (hidden unlock, sanctum boss entry, stage kin of borrowed kinds). 2. Entry: fade state, no spawns,
// heroes take no damage. 3. Teleport tick: every foe gone (a living mid-boss too, no drops / kill credit), foe shots and telegraphs gone, gems -> XP, chest moved into the room, heroes in the
// room at full HP (a downed co-op hero revived), arena.room set, boss spawned at the room's top through spawnBoss. 4. Clamping: heroes, foes, hero and foe projectiles stay inside the room;
// obstacles and braziers ignored. 5. The global enrage skips the Sanctum boss. 6. A bot fights inside the room for 60 s (no NaN, never outside). 7. Boss death: win banked, no Last Light,
// the run ends won after C.SANCTUM.end s. 8. Net: none / st 0 / st 1 round trip (st, t0, room), client prediction clamps to the room. 9. Determinism: same seed, same digest.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load } = require('./sim.js');
const Bot = require('./bot-brain.js');
const ED = load(), U = ED.U, C = ED.CONST, SC = C.SANCTUM;
ED.FX = { handle() {}, clear() {} }; ED.Render = { crowd: 0, bw: 641, bh: 361 }; ED.AimFx = { point: (me, inp) => ({ wx: inp.ax, wy: inp.ay }) };
for (const f of ['net.js', 'game.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
const N = ED.Net;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const STAGE = ED.STAGE_IDS.indexOf('wickdeep');
const inRoom = (R, x, y, m) => x >= R.x0 + m - 1e-6 && x <= R.x1 - m + 1e-6 && y >= R.y0 + m - 1e-6 && y <= R.y1 - m + 1e-6;

// 1. data
const sd = ED.STAGES[STAGE], last = sd && sd.bosses[sd.bosses.length - 1], rule = ED.UNLOCKS.stages[STAGE];
ok(STAGE === 3 && last && last.t === 1200 && last.final && last.sanctum && sd.bosses.slice(0, 3).every(b => !b.final), 'stage 4 is wickdeep: three mid-bosses, the 20:00 final boss in the Sanctum');
ok(rule && rule.hidden && rule.beatAll && rule.beatAll.join() === '0,1,2', 'stage 4 unlock: beatAll [0, 1, 2], hidden');
ok(ED.FOES[sd.events.flock.id] && ED.FOES[sd.events.flock.id].ai === 'swarm' && sd.timeline.every(row => row.roster.every(r => ED.FOES[r[0]])), 'stage 4 roster and its own flock swarmer exist');

// World with two heroes (co-op: a downed hero gets revived), clock jumped to 19:50.
const mk = (seed) => {
  const w = new ED.World({ seed, stage: STAGE, players: [{ pid: 'a', slot: 0, cls: 'knight' }, { pid: 'b', slot: 1, cls: 'ranger' }], cheats: { god: true } }); // god until the entry: the run must reach it
  for (let i = 0; i < 300; i++) { w.update(C.TICK); w.events.length = 0; }
  w.time = 1190; w.tick = 1190 * 60; w.sp.bossI = sd.bosses.length - 1; w.sp.warnI = w.sp.bossI - 1;
  return w;
};
const w = mk(7), [pa, pb] = w.heroes;
ok(w.stageKin('bat') === sd.events.flock.id && w.stageKin('skeleton') !== undefined, 'stage kin maps a borrowed swarmer to the stage flock foe');
// a living mid-boss, foes, foe shots, telegraphs, gems, a chest and a coin before the entry
const mid = w.spawnBoss({ t: 900, id: 'wickeater' }); w.updateBosses();
for (let i = 0; i < 40; i++) w.spawnFoe('shade', pa.x + 150 + (i % 8) * 12, pa.y + 120 + (i >> 3) * 12);
const sh = w.foeShoot(w.foes[w.foes.length - 1], 0, 100, 'bolt', 3, 4);
w.zone({ team: 1, warn: true, x: pa.x, y: pa.y, r: 30, dur: 5, dmg: 1, src: mid, look: 'tele' });
for (let i = 0; i < 10; i++) w.dropGem(pa.x + 300 + i * 20, pa.y + 300, 5);
w.spawnPickup('chest', pa.x + 500, pa.y - 400, 2); w.spawnPickup('gold', pa.x - 500, pa.y, 40);
w.cheats.god = false; pb.hp = 1; w.heroDown(pb); w.cheats.god = true;
const far = w.spawnFoe('shade', pa.x - 900, pa.y - 900), farId = far.id; far.spd = 0; // out of every view: nobody can kill it before the teleport
ok(mid && pb.downed, 'setup: a living mid-boss and a downed co-op hero before the entry');

// 2. entry
let ev0 = null, ev1 = null, step = 0;
let dieIds = new Set();
const tick = () => { w.input('a', { mx: 0, my: 0 }); w.update(C.TICK); for (const e of w.events) { if (e.t === 'sanctum' && e.ph === 0) ev0 = e; if (e.t === 'sanctum' && e.ph === 1) ev1 = e; if (e.t === 'die') dieIds.add(e.id); } w.events.length = 0; step++; };
while (!w.sanctum && step < 60 * 20) tick();
const S = w.sanctum;
ok(S && S.st === 0 && ev0 && Math.abs(S.t0 - (w.time + SC.fade)) < 0.05 && S.w === SC.w && S.h === SC.h && S.x === w.arena.size / 2 && S.y === w.arena.size / 2, 'entry at 20:00: st 0, t0 = fight start (+' + SC.fade + ' s), room centred, event');
w.cheats.god = false;
const nFoes = w.foes.filter(e => !e.dead).length, hp0 = pa.hp;
ok(w.hurtHero(pa, 50, null) === 0 && pa.hp === hp0, 'st 0: heroes take no damage');
tick(); tick();
ok(w.foes.filter(e => !e.dead).length <= nFoes, 'st 0: nothing spawns');

// 3. teleport
const xp0 = w.xp + w.level * 1e6;
let farDie = 0;
while (S.st === 0 && step < 60 * 30) tick();
if (dieIds.has(farId)) farDie++;
const R = w.arena.room, live = w.foes.filter(e => !e.dead);
ok(S.st === 1 && ev1 && Math.abs(S.t0 - w.time) < C.TICK * 1.5 && R && R.x0 === S.x - SC.w / 2 && R.y1 === S.y + SC.h / 2, 'teleport: st 1, t0 = now, arena.room set from the contract geometry');
ok(live.length >= 1 && live.every(e => e.boss) && w.bossList.indexOf(mid) < 0 && (far.dead || far.id !== farId) && farDie === 0 && mid.dead, 'every foe and the mid-boss gone without kill credit; only the Sanctum boss remains (' + live.length + ' bodies)');
const boss = w.boss;
ok(boss && boss.def.id === last.id && boss.final && boss.sanctum && Math.abs(boss.x - S.x) < 40 && inRoom(R, boss.x, boss.y, 0) && boss.y < S.y, 'boss spawned at the top of the room: (' + Math.round(boss.x) + ', ' + Math.round(boss.y) + ')');
ok(!w.projs.some(p => !p.dead && p.team === 1 && p !== null && p.owner !== boss.id) && !w.zones.some(z => !z.dead && z.team === 1 && z.src !== boss), 'old foe shots and telegraphs cleared');
ok(w.heroes.every(p => !p.dead && !p.downed && p.hp === p.maxHp && inRoom(R, p.x, p.y, 0) && p.y > S.y), 'heroes in the room at full HP, the downed one revived, standing in the bottom half');
ok(w.xp + w.level * 1e6 > xp0 && !w.pickups.some(g => !g.dead && /^xp/.test(g.k)), 'gems on the floor became party XP');
ok(w.pickups.some(g => !g.dead && g.k === 'chest' && inRoom(R, g.x, g.y, 0)) && !w.pickups.some(g => !g.dead && !inRoom(R, g.x, g.y, 0)), 'the chest moved into the room; nothing left outside');

// 4. clamping
const ob = w.arena.obstacles.find(o => inRoom(R, o.x, o.y, 0));
for (let i = 0; i < 720; i++) { w.input('a', { mx: 1, my: -1, ax: pa.x + 50, ay: pa.y }); w.update(C.TICK); w.events.length = 0; }
ok(Math.abs(pa.x - (R.x1 - C.HERO_BODY)) < 1 && Math.abs(pa.y - (R.y0 + C.HERO_BODY)) < 1, 'a hero walking into a corner stops at the room walls (' + Math.round(pa.x) + ', ' + Math.round(pa.y) + ')');
ok(!ob || !ED.Arena.blocked(w.arena, ob.x, ob.y, 4), 'obstacles inside the room rect are ignored' + (ob ? '' : ' (none in the rect this seed)'));
const add = w.spawnFoe('reaver', S.x, S.y); add.kbx = -5000; add.kby = 0;
for (let i = 0; i < 30; i++) { w.update(C.TICK); w.events.length = 0; }
ok(add.dead || inRoom(R, add.x, add.y, add.r - 0.01), 'a knocked-back foe stays inside the room');
const hs = w.shoot(pa, pa.weapons[0].id, S.x, S.y, Math.PI, { speed: 600, range: 2000, dmg: 0 }, { life: 5 }), fs2 = w.foeShoot(boss, Math.PI / 2, 600, 'bolt', 1, 4);
let outP = 0;
for (let i = 0; i < 120; i++) { w.update(C.TICK); w.events.length = 0; for (const p of [hs, fs2]) if (!p.dead && !inRoom(R, p.x, p.y, -12)) outP++; }
ok(hs.dead && fs2.dead && outP === 0, 'hero and foe projectiles die at the room walls');
let brk = 0; for (const b of w.arena.braziers) if (inRoom(R, b.x, b.y, 0)) { w.hitBraziers(b.x, b.y, 20, null); if (b.broken) brk++; }
ok(brk === 0, 'braziers inside the room rect cannot break');

// 5. enrage skip
const t5 = w.time; w.time = C.ENRAGE_T + 1; w.updateBosses(); w.time = t5;
ok(!boss.enraged, 'the global enrage at ' + C.ENRAGE_T + ' s skips the Sanctum boss');

// 6. bot in the room
const bot = Bot.create({ pid: 'a', seed: 7, skill: 1 }); bot.onStart(w, pa);
let nan = 0, out = 0;
for (let i = 0; i < 60 * 60 && w.state === 'play'; i++) {
  w.input('a', bot.think(w, pa)); w.update(C.TICK); w.events.length = 0;
  for (const p of w.heroes) { if (!isFinite(p.x) || !isFinite(p.y)) nan++; else if (!p.dead && !inRoom(R, p.x, p.y, C.HERO_BODY)) out++; }
  for (const e of w.foes) if (!e.dead && (!isFinite(e.x) || !inRoom(R, e.x, e.y, 0))) out++;
}
ok(nan === 0 && out === 0, 'a bot fights 60 s inside the room: no NaN, nobody outside (' + nan + ' / ' + out + ')');

// 7. boss death
let vic = 0, lapEv = 0;
if (w.state === 'play') {
  const g0 = w.gold;
  for (let k = 0; k < 6 && w.bossList.length; k++) { const e = w.bossList[0]; e.invulnT = 0; w.killFoe(e, w.src(pa, pa.weapons[0].id, 'x')); }
  for (const e of w.events) { if (e.t === 'victory') vic++; if (e.t === 'lap') lapEv++; } w.events.length = 0;
  ok(w.won && S.st === 2 && vic === 1 && !w.lap && w.gold > g0 && S.endT > w.time, 'boss death: win banked, final gold paid, st 2, no Last Light');
  ok(w.hurtHero(pa, 50, null) === 0, 'st 2: heroes take no damage');
  let n = 0; while (w.state === 'play' && n++ < 60 * (SC.end + 1)) { w.update(C.TICK); for (const e of w.events) if (e.t === 'lap') lapEv++; w.events.length = 0; }
  ok(w.state === 'won' && !w.lap && lapEv === 0 && Math.abs(n / 60 - SC.end) < 0.1, 'the run ends won ' + (n / 60).toFixed(2) + ' s later, no lap');
} else ok(false, 'run still in play before the boss kill (state ' + w.state + ')');

// 8. net round trip
{
  const w2 = mk(11), roster = w2.heroes.map(p => ({ pid: p.pid, slot: p.slot, name: p.pid, cls: p.cls }));
  const M = new N.Mirror({ stage: STAGE, seed: w2.seed, roster, myPid: 'b' });
  const cc = { idx: 1, vw: 641, vh: 361, ack: 0, seq: 0, pidIdx: { a: 0, b: 1 }, evs: [], carry: [] };
  const snap = () => { cc.seq++; cc.evs.length = 0; M.frame(M.apply(N.encodeSnap(w2, cc))); };
  snap();
  const none = M.view.sanctum === null && !M.view.props.room;
  while (!w2.sanctum) { w2.update(C.TICK); w2.events.length = 0; }
  snap();
  const s0 = M.view.sanctum && M.view.sanctum.st === 0 && Math.abs(M.view.sanctum.t0 - w2.sanctum.t0) < 1e-3 && !M.view.props.room;
  while (w2.sanctum.st === 0) { w2.update(C.TICK); w2.events.length = 0; }
  snap();
  const V = M.view.sanctum, MR = M.view.props.room, HR = w2.arena.room;
  ok(none && s0 && V && V.st === 1 && Math.abs(V.t0 - w2.sanctum.t0) < 1e-3 && V.x === w2.sanctum.x && V.y === w2.sanctum.y && V.w === SC.w && V.h === SC.h && MR && ['x0', 'y0', 'x1', 'y1'].every(k => MR[k] === HR[k]),
    'net: none, st 0 (t0) and st 1 (t0, room geometry) reach the client view and its arena');
  const P = { x: V.x, y: V.y, id: 1 };
  ED.Arena.move(M.view.props, P, 5000, 5000, C.HERO_BODY);
  ok(P.x === MR.x1 - C.HERO_BODY && P.y === MR.y1 - C.HERO_BODY, 'client prediction (ED.Arena.move on the mirror arena) clamps to the room');
}

// 9. determinism
const digest = (seed) => {
  const v = mk(seed); let d = 0;
  for (let i = 0; i < 60 * 25; i++) { v.input('a', { mx: Math.cos(i / 50), my: Math.sin(i / 70), ax: v.heroes[0].x + 40, ay: v.heroes[0].y, dash: i % 200 === 5 }); v.update(C.TICK); v.events.length = 0; if (i % 30 === 0) { let s = v.tick + '|' + (v.sanctum ? v.sanctum.st : -1); for (const p of v.heroes) s += '|' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.hp; for (const e of v.foes) if (!e.dead) s += '|' + e.id + ',' + e.x.toFixed(2); d = (Math.imul(d, 31) + U.hashStr(s)) >>> 0; } }
  return d;
};
const d1 = digest(5), d2 = digest(5);
ok(d1 === d2, 'determinism: same seed, same digest through the entry and the fight (' + d1 + ')');

console.log(fails ? 'check-sanctum: ' + fails + ' failure(s)' : 'check-sanctum: all passed');
process.exit(fails ? 1 : 0);
