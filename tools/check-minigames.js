// Usage: node tools/check-minigames.js
// Headless checks of the minigames (src/sim/minigames.js), staged through the event framework (patchRoom names the game, entry runs startEvent -> def.start, interact goes through evInteract, the world tick runs def.update): every game sets up with its numbers on its props,
// can be won, lost and skipped, ends by itself within GAME_MAX s once started, replays identically for a seed, and the bot (tools/sim.js botGame) finishes or skips it. Also the props snapshot payload and resend.
// Prints failures and exits 1 when any check fails.
const { ED, botGame } = require('./sim.js');
if (!ED.Net) require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
const U = ED.U, MG = ED.MINIGAMES, M = ED.Minigames, N = ED.Net;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const DT = 1 / 60, IDS = ['gauntlet', 'shells', 'duel', 'wisps', 'echo'], FINAL = { gauntlet: 2, shells: 5, duel: [3, 4], wisps: 2, echo: 4 };
const done = (g) => [].concat(FINAL[g.id]).indexOf(g.ph) >= 0;

// A world in the first event room of stratum s (seed walked until the floor has one), patched to game id and entered (startEvent sets it up). Party gold 500.
// o.draw (a list of ids): no patch; every text event and the listed ids count as seen, so the resolver itself draws one of the other games.
function stage(id, seed, o) {
  o = o || {};
  const cls = o.cls || ['knight'];
  for (let k = 0; k < 40; k++) {
    const w = new ED.World({ seed: seed + k * 101, pact: 0, players: cls.map((c, i) => ({ pid: 'p' + i, name: 'T' + i, slot: i, cls: c, weapon: ED.CLASSES[c].weapons[0], meta: META() })) });
    w.startRun();
    if ((o.s || 1) > 1) w.enterStratum(o.s);
    const room = w.floor.rooms.find(r => r.type === 'event');
    if (!room) continue;
    if (o.draw) { const seen = ED.Events.run(w).evSeen; for (const d of Object.values(ED.EVENTS)) seen[d.id] = 1; for (const x of o.draw) seen[x] = 1; }
    else if (!w.patchRoom(room.id, { event: id })) continue;
    w.enterRoom(room.id, 's');
    w.gold = 500; w.fx.length = 0; w.msgs.length = 0;
    return w;
  }
  throw new Error('no event room');
}
const g0 = (w) => M.game(w);
const prop = (w, kind, i) => w.props.filter(x => x.kind === kind)[i || 0];
const hero = (w, i) => w.players.get('p' + (i || 0));
const at = (p, x, y) => { p.x = x; p.y = y; p.vx = 0; p.vy = 0; };
const use = (w, p, pr) => { at(p, pr.x, pr.y + 20); w.interact(p.pid, pr.id); };
let mgEv = [];
// One world tick (its event update runs the game); 'mg' events are kept in mgEv. hold: hero invulnerable (timeouts without damage).
function tick(w, hold) {
  if (hold) for (const p of w.players.values()) p.invuln = 1;
  w.update(DT);
  for (const ev of w.fx) if (ev.t === 'mg') mgEv.push(ev);
  w.fx.length = 0; w.msgs.length = 0;
}
const run = (w, sec, hold, until) => { for (let i = 0; i < sec * 60; i++) { tick(w, hold); if (until && until()) return i * DT; } return sec; };
const goldOut = (w) => w.pickups.filter(k => k.kind === 'gold').reduce((a, k) => a + k.val, 0), wealth = (w) => w.gold + goldOut(w); // party gold, dropped coins included

// ---------------- set-up: props, numbers on them, registry interface ----------------
for (const id of IDS) {
  const def = MG[id];
  ok(def && def.id === id && def.kind === 'game' && def.strata === null && def.w > 0 && (def.reward === 'hero' || def.reward === 'party'), id + ': def interface');
  ok(['start', 'interact', 'update', 'bot'].every(k => typeof def[k] === 'function'), id + ': start / interact / update / bot');
  const w = stage(id, 11), g = g0(w);
  ok(g && g.id === id && g.ph === 0 && g.room === w.roomId, id + ': state in w.ev.game, idle');
  ok(w.props.length >= 1 && w.props.every(x => x.ev === id && x.g && x.kind.indexOf('mg_') === 0), id + ': props carry ev and g');
  ok(w.props.every(x => ED.Dungeon.tileAt(w.room, x.x, x.y) === 0), id + ': props stand on floor');
  const s = N.encodeSnap(w, [], true), row = s.O.find(r => r[1] === w.props[0].kind);
  ok(row && row[11] === id && row[12] && typeof row[12] === 'object', id + ': props row carries ev [11] and the payload [12]');
  const sig = N.propSig(w); w.props[0].v = (w.props[0].v | 0) + 1;
  ok(N.propSig(w) !== sig, id + ': a touched prop resends');
}
{ // the numbers a hero reads before committing
  const a = stage('gauntlet', 3).props[0].g, b = stage('shells', 3).props[0].g, c = stage('duel', 3).props[0].g, d = stage('wisps', 3).props[0].g, e = stage('echo', 3).props[0].g;
  ok(a.gold > 0 && a.dur > 0 && a.dur <= 40, 'gauntlet shows prize gold and time: ' + a.gold + ' / ' + a.dur);
  ok(b.s >= 5 && b.s % 5 === 0, 'shells shows the stake: ' + b.s);
  ok(c.s > 0 && [2, 2.5, 3].indexOf(c.m) >= 0 && c.d > 0 && c.d <= 44 && c.af.length === 2 && c.af[0] !== c.af[1] && ED.ENEMIES[c.ty], 'duel shows stake, multiplier, time, foe and two affixes');
  ok(d.n >= 5 && d.per > 0 && d.d >= 20 && d.d <= 30, 'wisps show count, gold per wisp, time');
  ok(e.gold > 0, 'echo shows gold per round');
  ok(stage('duel', 3, { s: 3 }).props[0].g.s > c.s, 'stakes rise with the stratum');
}

// ---------------- 1. trap gauntlet ----------------
{
  let w = stage('gauntlet', 21), p = hero(w), g = g0(w);
  const post = prop(w, 'mg_gauntlet'), chest = prop(w, 'mg_chest');
  ok(chest.g.ni === 1 && !MG.gauntlet.interact(w, p, chest), 'gauntlet: the chest waits for the start');
  use(w, p, post);
  ok(g.ph === 1 && chest.g.ni === 0 && post.g.end > w.time, 'gauntlet: the post starts it');
  run(w, 3, true);
  ok(w.zones.some(z => z.mg === g.key && z.team === 1 && (z.kind === 'tele' || z.kind === 'teleLine')), 'gauntlet: traps telegraph as foe-team zones');
  const r0 = p.relics.length;
  use(w, p, chest);
  ok(p.relics.length === r0 + 1 && ED.RELICS[p.relics[r0]].rar !== 'c', 'gauntlet: unhurt pays a rare relic');
  ok(goldOut(w) === g.gold, 'gauntlet: unhurt pays its gold: ' + goldOut(w) + ' / ' + g.gold);
  ok(g.ph === 2 && chest.state === 1 && !w.zones.some(z => z.mg === g.key && !z.dead), 'gauntlet: won (every hero claimed): traps stop');
  // hits: a hero standing in a lane is struck, never below 1 health, and the prize falls
  w = stage('gauntlet', 22); p = hero(w); g = g0(w);
  use(w, p, prop(w, 'mg_gauntlet'));
  const tr = g.traps.find(q => q.k === 'jet') || g.traps[0];
  p.hp = 2;
  for (let i = 0; i < 12 * 60 && (g.hits[p.pid] | 0) < 3; i++) { at(p, tr.x, (g.field[2] + g.field[3]) / 2 + (tr.k === 'spike' ? 22 : 0)); p.invuln = 0; tick(w); }
  ok((g.hits[p.pid] | 0) >= 3 && p.hp >= 1 && !p.downed, 'gauntlet: traps hit (' + (g.hits[p.pid] | 0) + '), never below 1 health: ' + p.hp.toFixed(2));
  ok(prop(w, 'mg_gauntlet').g.h[p.pid] === g.hits[p.pid], 'gauntlet: hits ride the post payload');
  const r1 = p.relics.length; use(w, p, prop(w, 'mg_chest'));
  const tier = M.GAUNT_PRIZE[Math.min(g.hits[p.pid], M.GAUNT_PRIZE.length - 1)];
  ok(p.relics.length === r1 && goldOut(w) === Math.round(g.gold * tier.g) && tier.g < 1, 'gauntlet: a hurt hero gets less: ' + goldOut(w) + ' of ' + g.gold);
  // lost: the timer runs out with the chest unclaimed
  w = stage('gauntlet', 23); g = g0(w); p = hero(w);
  use(w, p, prop(w, 'mg_gauntlet'));
  const tEnd = run(w, 61, true, () => g.ph === 2);
  ok(g.ph === 2 && tEnd <= M.GAME_MAX && wealth(w) === 500 && prop(w, 'mg_chest').state === 1, 'gauntlet: times out in ' + tEnd.toFixed(1) + ' s with no prize');
  // a hero who never stood on the post side cannot claim
  w = stage('gauntlet', 24, { cls: ['knight', 'ranger'] }); g = g0(w);
  at(hero(w, 1), prop(w, 'mg_chest').x - 30, prop(w, 'mg_chest').y);
  use(w, hero(w), prop(w, 'mg_gauntlet'));
  at(hero(w, 1), prop(w, 'mg_chest').x - 30, prop(w, 'mg_chest').y); tick(w, true);
  w.interact('p1', prop(w, 'mg_chest').id);
  ok(!hero(w, 1).claimed[prop(w, 'mg_chest').group], 'gauntlet: the prize needs the crossing');
}

// ---------------- 2. shell game ----------------
{
  let w = stage('shells', 31), p = hero(w), g = g0(w);
  const d = prop(w, 'mg_dealer'), gold0 = w.gold;
  use(w, p, d);
  ok(w.gold === gold0 - g.stake && g.ph === 1 && d.g.sw.length === 2 * M.SHELL.rounds[0].n, 'shells: the bet pays the stake and rolls the shuffle');
  run(w, 10, true, () => g.ph === 3);
  ok(g.ph === 3 && w.props.filter(x => x.kind === 'mg_cup').every(c => !c.g.ni), 'shells: cups open to a pick after the shuffle');
  const cups = w.props.filter(x => x.kind === 'mg_cup'), pearl = cups.find(c => c.g.c === g.pearl);
  ok(cups.every(c => Math.abs(c.x - M.cupAt(d.g, c.g.c, 1e9).x) < 1e-6), 'shells: host cups stand where the schedule ends');
  ok(new Set(cups.map(c => c.x)).size === 3, 'shells: three distinct slots');
  use(w, p, pearl);
  ok(g.ph === 4 && d.g.res === 1 && wealth(w) === 500 + g.stake, 'shells: won pays 2x the stake');
  run(w, 3, true, () => g.ph === 0);
  ok(g.ph === 0 && g.round === 2 && d.g.r === 2, 'shells: a win offers the next round');
  use(w, p, d); run(w, 10, true, () => g.ph === 3);
  ok(d.g.d < M.SHELL.rounds[0].d && d.g.sw.length > 2 * M.SHELL.rounds[0].n, 'shells: round 2 shuffles faster and longer');
  const wrong = w.props.filter(x => x.kind === 'mg_cup').find(c => c.g.c !== g.pearl), before = wealth(w);
  use(w, p, wrong);
  run(w, 3, true, () => g.ph === 5);
  ok(g.ph === 5 && d.g.res === 0 && wealth(w) === before && d.state === 1, 'shells: a wrong cup loses the stake and ends it');
  // no pick: the round is lost by itself, well within GAME_MAX
  w = stage('shells', 32); g = g0(w); p = hero(w);
  use(w, p, prop(w, 'mg_dealer'));
  const tEnd = run(w, 61, true, () => g.ph === 5);
  ok(g.ph === 5 && tEnd <= M.GAME_MAX, 'shells: times out in ' + tEnd.toFixed(1) + ' s');
  // short of gold: no bet
  w = stage('shells', 33); g = g0(w); w.gold = 1;
  use(w, hero(w), prop(w, 'mg_dealer'));
  ok(g.ph === 0 && w.gold === 1, 'shells: no bet without the stake');
  // round 3 pays a rare relic to the picker and the stake back
  w = stage('shells', 34); g = g0(w); p = hero(w);
  for (let r = 1; r <= 3; r++) { run(w, 3, true, () => g.ph === 0); use(w, p, prop(w, 'mg_dealer')); run(w, 10, true, () => g.ph === 3); use(w, p, w.props.find(x => x.kind === 'mg_cup' && x.g.c === g.pearl)); }
  ok(p.relics.length === 1 && ED.RELICS[p.relics[0]].rar !== 'c' && g.round === 3, 'shells: round 3 pays a rare relic');
}

// ---------------- 3. wager duel ----------------
{
  let w = stage('duel', 41), p = hero(w), g = g0(w);
  const h = prop(w, 'mg_herald'), gold0 = w.gold;
  use(w, p, h);
  ok(w.gold === gold0 - g.stake && w.locked && g.ph === 1, 'duel: the bet locks the room');
  run(w, 3, true, () => g.ph === 2);
  const e = g.foe;
  ok(g.ph === 2 && e && e.elite === g.aff[0] && e.elite2 === g.aff[1] && e.type === g.type, 'duel: the champion carries both rolled affixes');
  ok(Math.abs(e.maxHp / (ED.ENEMIES[g.type].hp * ED.World.hpScale(w.stratum, w.rowFrac()) * (ED.World.ELITE.hp + ED.World.ELITE.hpStep * (ED.World.depth(w.stratum) - 1)) * M.DUEL_HP) - 1) < 0.02, 'duel: champion health = elite x DUEL_HP');
  w.killEnemy(e, p, {});
  run(w, 0.5, true);
  ok(g.ph === 3 && !w.locked && wealth(w) >= 500 - g.stake + Math.round(g.stake * g.mul), 'duel: won pays stake x ' + g.mul + ' and unlocks');
  // lost: the timer
  w = stage('duel', 42); g = g0(w); p = hero(w);
  use(w, p, prop(w, 'mg_herald'));
  const tEnd = run(w, 61, true, () => g.ph === 4);
  ok(g.ph === 4 && tEnd <= M.GAME_MAX && !w.locked && !w.enemies.some(x => x.hp > 0), 'duel: times out in ' + tEnd.toFixed(1) + ' s; the champion vanishes, doors open');
  // lost: a lethal hit leaves the hero at 1 health (solo, holding Phoenix Feather and Guardian Angel: neither is spent) and the run goes on
  w = stage('duel', 43); g = g0(w); p = hero(w);
  w.giveRelic(p, 'phoenix'); w.giveRelic(p, 'angel');
  use(w, p, prop(w, 'mg_herald'));
  run(w, 3, true, () => g.ph === 2);
  p.invuln = 0; p.dashT = 0; p.shield = 0;
  const sw = p.secondWind | 0, hurt = w.hurtPlayer(p, p.maxHp * 50, { hazard: true });
  run(w, 0.5);
  ok(hurt && g.ph === 4 && !w.locked && p.hp === 1 && !p.downed && !p.dead && w.state === 'play', 'duel: a lethal hit leaves 1 health and loses the wager; the run goes on (hp ' + p.hp + ', ph ' + g.ph + ', ' + w.state + ')');
  ok(!p.phoenixUsed && !p.angelUsed && (p.secondWind | 0) === sw, 'duel: no relic or Second Wind save is spent');
  // co-op: the same for a second hero
  w = stage('duel', 47, { cls: ['knight', 'cleric'] }); g = g0(w);
  use(w, hero(w), prop(w, 'mg_herald'));
  run(w, 3, true, () => g.ph === 2);
  w.playerLethal(hero(w, 1));
  run(w, 0.2);
  ok(g.ph === 4 && !w.locked && hero(w, 1).hp === 1 && !hero(w, 1).downed, 'duel: a co-op hero is not downed either, the wager is lost');
  // a hero down before the bet does not count
  w = stage('duel', 44, { cls: ['knight', 'cleric'] }); g = g0(w);
  w.playerLethal(hero(w, 1));
  use(w, hero(w), prop(w, 'mg_herald'));
  run(w, 3, true, () => g.ph === 2);
  run(w, 0.5, true);
  ok(g.ph === 2, 'duel: a hero already down at the bet does not lose it');
}

// ---------------- 4. lantern chase ----------------
{
  let w = stage('wisps', 51), p = hero(w), g = g0(w);
  use(w, p, prop(w, 'mg_lantern'));
  const ws = () => w.zones.filter(z => z.mg === g.key && !z.dead);
  ok(g.ph === 1 && ws().length === g.n && ws().every(z => z.kind === 'wisp' && z.team === 0), 'wisps: the lantern frees n wisps');
  const s0 = N.encodeSnap(w, [], false);
  ok(s0.Z.filter(z => N.ZK[z[1]] === 'wisp').length === g.n, 'wisps: wisps ride the zone rows');
  const x0 = ws()[0].x; run(w, 1, true);
  ok(ws().length && ws().some(z => z.x !== x0), 'wisps: wisps move');
  const hp0 = p.maxHp;
  for (let i = 0; i < 60 * 30 && g.ph === 1; i++) { const z = ws()[0]; if (z) at(p, z.x, z.y); tick(w, true); }
  ok(g.ph === 2 && g.caught === g.n && wealth(w) === 500 + g.n * g.per && p.maxHp === hp0 + M.WISP.hp, 'wisps: catching all pays gold each and +' + M.WISP.hp + ' max health');
  // lost: nobody chases
  w = stage('wisps', 52); g = g0(w); p = hero(w);
  use(w, p, prop(w, 'mg_lantern'));
  at(p, 40, 70);
  const tEnd = run(w, 61, true, () => g.ph === 2);
  ok(g.ph === 2 && tEnd <= M.GAME_MAX && !w.zones.some(z => z.mg === g.key && !z.dead), 'wisps: time out in ' + tEnd.toFixed(1) + ' s (' + g.caught + ' caught by standing still)');
}

// ---------------- 5. echo bells ----------------
{
  let w = stage('echo', 61), p = hero(w), g = g0(w);
  const bells = w.props.filter(x => x.kind === 'mg_bell');
  ok(bells.length === 4 && bells.every(b => b.g.ni), 'echo: four bells, not interactable');
  ok(g.seq.every((b, i) => !i || b !== g.seq[i - 1]), 'echo: no bell twice in a row');
  use(w, p, prop(w, 'mg_echo'));
  ok(g.ph === 1 && prop(w, 'mg_echo').g.sq.length === M.ECHO.len[0], 'echo: round 1 rings ' + M.ECHO.len[0] + ' notes');
  const strike = (i) => { const b = g.bells[i]; at(p, b.x, b.y + 30); w.mgCircle(p, b.x, b.y, 6); run(w, 0.35, true); };
  strike(g.seq[0]);
  ok(g.idx === 0, 'echo: a hit while the tune plays does nothing');
  for (let r = 0; r < 3; r++) { run(w, 6, true, () => g.ph === 2); for (let k = 0; k < M.ECHO.len[r]; k++) strike(g.seq[k]); }
  ok(g.ph === 4 && prop(w, 'mg_echo').g.res === 1 && wealth(w) === 500 + 3 * g.gold && p.offer, 'echo: three rounds pay gold each and a boon offer');
  { // every note of the tune rings as an event (sound for every viewer)
    const w2 = stage('echo', 64), g2 = g0(w2);
    mgEv = []; use(w2, hero(w2), prop(w2, 'mg_echo')); run(w2, 6, true, () => g2.ph === 2);
    const notes = mgEv.filter(e => e.k === 'note').map(e => e.i);
    ok(notes.join() === g2.seq.slice(0, M.ECHO.len[0]).join(), 'echo: the tune rings its notes in order: ' + notes.join());
  }
  // hits reach the bells through the hero hit hooks (a swing)
  w = stage('echo', 62); p = hero(w); g = g0(w);
  use(w, p, prop(w, 'mg_echo')); run(w, 6, true, () => g.ph === 2);
  const b0 = g.bells[g.seq[0]];
  at(p, b0.x, b0.y + 24); p.face = -Math.PI / 2;
  w.playerAttack(p, Math.atan2(b0.y - p.y, b0.x - p.x)); run(w, 0.3, true);
  ok(g.idx === 1, 'echo: a weapon swing strikes a bell');
  // lost: a wrong bell
  const bad = [0, 1, 2, 3].find(i => i !== g.seq[1]);
  w.mgCircle(p, g.bells[bad].x, g.bells[bad].y, 4);
  ok(g.ph === 4 && prop(w, 'mg_echo').g.res === 0 && !w.mgTargets, 'echo: a wrong bell ends it');
  // lost: the timer
  w = stage('echo', 63); g = g0(w);
  use(w, hero(w), prop(w, 'mg_echo'));
  const tEnd = run(w, 61, true, () => g.ph === 4);
  ok(g.ph === 4 && tEnd <= M.GAME_MAX, 'echo: times out in ' + tEnd.toFixed(1) + ' s');
}

// ---------------- skipping: leave by a door, before or during a game ----------------
for (const id of IDS) {
  for (const started of [false, true]) {
    if (started && id === 'duel') continue; // the duel locks the doors
    const w = stage(id, 71), p = hero(w), g = g0(w);
    if (started) { use(w, p, w.props[0]); run(w, 2.5, true); }
    const next = w.room.exits[0];
    w.enterRoom(next, Object.keys(w.room.doors).find(k => w.room.doors[k] === next));
    let threw = false;
    try { run(w, 1, true); w.mgCircle(p, p.x, p.y, 40); w.smashCircle(p, p.x, p.y, 40); } catch (e) { threw = e; }
    ok(!threw && !M.game(w) && !w.zones.some(z => z.mg) && !w.mgTargets && !MG[id].update(w, DT) && !M.bot(w, p), id + ': skipped ' + (started ? 'mid-game' : 'before it starts') + (threw ? ' threw ' + threw.message : ''));
  }
}

// ---------------- bots finish or skip every game; determinism ----------------
// The bot party plays the room as tools/sim.js does: ED.Minigames.bot -> botGame; with no action it fights the nearest foe (the duel) and takes offer 0. Returns a digest of the outcome.
function botPlay(id, seed, cls, s, draw) {
  const w = stage(id, seed, { cls, s, draw }), g = g0(w), ctl = {};
  for (const p of w.players.values()) { ctl[p.pid] = { atk: 0 }; p.hp = p.maxHp; }
  let t = 0, acted = false;
  for (; t < 90 && !done(g); t += DT) {
    for (const p of w.players.values()) {
      const c = ctl[p.pid]; c.atk -= DT;
      if (p.offer) w.pickBoon(p.pid, 0);
      if (p.downed || p.dead) continue;
      const a = M.bot(w, p);
      let v = [0, 0];
      if (a) { acted = true; v = botGame(w, p, c, a); }
      else {
        const e = w.enemies.find(x => x.hp > 0 && x.spawnT <= 0);
        if (e) { const d = Math.hypot(e.x - p.x, e.y - p.y); v = [(e.x - p.x) / d, (e.y - p.y) / d]; if (c.atk <= 0 && d < (p.stats.melee ? p.stats.weapon.range + e.r : 300)) { w.playerAttack(p, Math.atan2(e.y - p.y, e.x - p.x)); c.atk = ED.Stats.stepInterval(p); } }
        else if (g.ph === 0 && acted === false) break; // the bot skips: it leaves the room
      }
      ED.Sim.movePlayer(p, { mx: v[0], my: v[1] }, DT, w.room, w.locked, w.zones, null);
    }
    tick(w);
    if (w.state !== 'play') break;
  }
  const hs = [...w.players.values()];
  return { g, t, w, dig: JSON.stringify([g.ph, g.round, g.caught, g.idx, g.hits, w.gold, goldOut(w), hs.map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.hp * 10), p.relics.join('.')])]) };
}
{
  const tally = {};
  for (const id of IDS) {
    for (const [cls, s] of [[['knight'], 1], [['ranger'], 2], [['pyro', 'shade'], 1], [['cleric'], 3]]) {
      for (let k = 0; k < 3; k++) {
        const r = botPlay(id, 200 + k * 13, cls, s), out = done(r.g) ? 'done' : r.w.state !== 'play' ? 'wipe' : r.g.ph === 0 ? 'skip' : 'stuck'; // wipe: the party fell (the run ends)
        tally[id] = tally[id] || { done: 0, skip: 0, wipe: 0, stuck: 0 }; tally[id][out]++;
        ok(out !== 'stuck' && r.t <= M.GAME_MAX + 5, `${id}: bot ${cls.join('+')} s${s} seed ${k} ${out} at ph ${r.g.ph} in ${r.t.toFixed(1)} s`);
      }
    }
    const a = botPlay(id, 300, ['knight'], 1), b = botPlay(id, 300, ['knight'], 1);
    ok(a.dig === b.dig, id + ': deterministic for a seed');
  }
  console.log('bot outcomes: ' + IDS.map(id => `${id} ${tally[id].done} done / ${tally[id].skip} skipped` + (tally[id].wipe ? ` / ${tally[id].wipe} party fell` : '')).join(' · '));
}

// ---------------- the resolver draws each game, and the bots play it to its end through interact and the world tick ----------------
{
  const drawn = [];
  for (let k = 0; k < IDS.length; k++) {
    const r = botPlay(null, 400 + k * 7, ['pyro', 'shade'], 1, drawn), id = r.w.ev && r.w.ev.id;
    ok(IDS.indexOf(id) >= 0 && drawn.indexOf(id) < 0 && r.w.room.event === id && r.g && r.g.id === id, `resolver: draw ${k + 1} is a new game (${id})`);
    ok(r.g && done(r.g), `resolver: ${id} played to its end by the bots (ph ${r.g && r.g.ph}, ${r.t.toFixed(1)} s)`);
    drawn.push(id);
  }
}

console.log(`${n - fails}/${n} minigame checks passed`);
process.exit(fails ? 1 : 0);
