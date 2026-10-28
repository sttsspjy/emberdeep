// Headless bot check (exit 1 on failure). Usage: node tools/check-bot.js
// 1. tools/bot-brain.js loads in Node without ED (reads it lazily) and think() returns a full input frame (E never pressed).
// 2. runOne determinism: the same 90 s cfg twice gives identical results (wall-clock fields aside); the result carries every field (no weapon / fill fields).
// 3. Pure reader: a 340 s stage-2 run (first boss at 5:00, a cyclops added at 2:00 for st.test hazards) where a second, discarded bot also thinks every tick ends identical to a plain run.
// 4. Build: a 300 s knight run holds one weapon, ranks one path to 3 and takes its Form when offered; the bot casts Q and never presses E.
// 5. Short-reach stance: a knight (Cleave) keeps a foe inside its swing reach on >= 20% of 120 s and holds bosses inside it.
// 6. Card order: a Form > refine > the path closest to rank 3 (one path to 3, then a second) > passives > skill.
// 7. Boss fights: every killed boss carries its spawn time under its stage id (the twins end on either body). skill 0.3 is deterministic and plays differently from skill 1.
'use strict';
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();

// 1. load without ED
delete globalThis.ED;
const Bot = require('./bot-brain.js');
ok(typeof Bot.create === 'function' && !globalThis.ED && !('isolate' in Bot), 'bot-brain loads in Node without ED (no isolate helper)');
const { load } = require('./sim.js');
const { runOne } = require('./bot.js');
{
  const ED = load(), w = new ED.World({ seed: 3, stage: 0, players: [{ pid: 'p1', cls: 'ranger', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
  const b = Bot.create({ pid: 'p1', seed: 3 }); if (b.onStart) b.onStart(w, p);
  let f = null, e = 0;
  for (let i = 0; i < 120; i++) { f = b.think(w, p); if (f.e) e++; w.input('p1', f); w.update(ED.CONST.TICK); w.events.length = 0; }
  const keys = ['mx', 'my', 'ax', 'ay', 'dash', 'q', 'e', 'pick', 'banish', 'reroll', 'skip'];
  ok(f && keys.every(k => k in f) && isFinite(f.ax) && Math.hypot(f.mx, f.my) <= 1.0001 && !e, 'think returns a full frame, E never pressed: ' + JSON.stringify(f));
  ok(Bot.metaFor(ED, 'max').sigs.length === 0 && Bot.metaFor(ED, 'max').shop.might === 5, 'metaFor max: every shop rank, no signature pool');
}

// 2. determinism + shape
const strip = (r) => { const o = Object.assign({}, r); delete o.ms; delete o.botMs; return JSON.stringify(o); };
const cfg = { stage: 1, cls: 'pyro', seed: 7, maxTime: 90 };
const a = runOne(cfg), b = runOne(cfg);
ok(strip(a) === strip(b), `runOne deterministic (90 s pyro: level ${a.level}, kills ${a.kills}, ${a.ms} ms / ${b.ms} ms)`);
const FIELDS = ['stage', 'stageId', 'cls', 'seed', 'meta', 'won', 'time', 'level', 'kills', 'gold', 'death', 'bosses', 'dealt', 'taken', 'hurt', 'build', 'evolved', 'hpLow', 'ticks', 'ms', 'botMs', 'skill'];
const miss = FIELDS.filter(k => !(k in a));
ok(!miss.length && !('weapon' in a) && !('fill' in a) && Array.isArray(a.bosses) && Array.isArray(a.build.weapons) && Array.isArray(a.build.passives) && typeof a.dealt === 'object',
  'result has every field, no weapon / fill' + (miss.length ? ': missing ' + miss.join(',') : ''));
ok(a.build.weapons.length === 1 && Array.isArray(a.build.weapons[0].pr) && a.build.weapons[0].pr.length === 3 && 'fl' in a.build.weapons[0], 'build weapon carries path ranks and refine: ' + JSON.stringify(a.build.weapons[0]));
ok(a.time >= 89 && a.time <= 91 && a.death === 'timeout' && a.ticks > 0, `maxTime stops the run (time ${a.time}, death ${a.death})`);

// 3. pure reader
{
  const run = (extra) => {
    const ED = load(), w = new ED.World({ seed: 9, stage: 2, players: [{ pid: 'p1', cls: 'necro', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
    const bot = Bot.create({ pid: 'p1', seed: 9 }), spy = Bot.create({ pid: 'p1', seed: 4, skill: 0.3 });
    bot.onStart(w, p); spy.onStart(w, p);
    let h = 0, bossT = -1, tests = 0, added = false;
    while (w.time < 340 && w.state === 'play') {
      if (!added && w.time >= 120) { added = true; w.spawnBoss({ t: 300, id: 'cyclops', final: false }); }
      if (extra) spy.think(w, p);
      w.input('p1', bot.think(w, p)); w.update(ED.CONST.TICK);
      p.hp = p.maxHp; // kept alive: the run must reach the first boss whatever the balance
      for (const ev of w.events) if (ev.t === 'boss' && ev.phase === 0 && ev.id === w.sdef.bosses[0].id) bossT = w.time;
      w.events.length = 0;
      if (w.tick % 30 === 0) for (const z of w.zones) if (!z.dead && z.team === 1 && z.st && typeof z.st.test === 'function') tests++;
      if (w.tick % 60 === 0) h = (Math.imul(h, 31) + ED.U.hashStr(w.kills + '|' + p.x.toFixed(3) + '|' + p.y.toFixed(3) + '|' + p.hp + '|' + w.foes.length + '|' + w.projs.length)) >>> 0;
    }
    return { h, t: w.time, bossT, tests, state: w.state };
  };
  const r1 = run(false), r2 = run(true);
  ok(r1.h === r2.h && r1.t === r2.t, `a second thinking bot changes nothing (digest ${r1.h} / ${r2.h}, ${r1.t.toFixed(0)} s, ${r1.state})`);
  ok(r1.bossT > 0 && r1.t > r1.bossT + 30 && r1.tests > 0, `pure-reader run covers the first boss (spawned ${r1.bossT.toFixed(0)} s, run to ${r1.t.toFixed(0)} s) and st.test hazards (${r1.tests} samples)`);
}

// 4. build through the bot's own picks
{
  const ED = load(), w = new ED.World({ seed: 2, stage: 0, players: [{ pid: 'p1', cls: 'knight', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
  const bot = Bot.create({ pid: 'p1', seed: 2 }); bot.onStart(w, p);
  let q = 0, e = 0, formAt = -1, formOffered = -1;
  while (w.time < 300 && w.state === 'play') {
    if (formOffered < 0 && p.offer && p.offer.some(c => c.kind === 'form')) formOffered = w.time;
    const f = bot.think(w, p); if (f.e) e++;
    w.input('p1', f); w.update(ED.CONST.TICK);
    p.hp = p.maxHp;
    for (const ev of w.events) { if (ev.t === 'skill') q++; if (ev.t === 'evolve' && formAt < 0) formAt = w.time; }
    w.events.length = 0;
  }
  const ws = p.weapons[0];
  ok(p.weapons.length === 1 && ws.root === 'cleave' && Math.max(...ws.pr) === 3, `one weapon, a path ranked to 3 (pr ${ws.pr.join('')}, lvl ${ws.lvl}, hero level ${w.level})`);
  ok(formOffered < 0 || (formAt >= formOffered && formAt - formOffered < 0.1 && ws.evo), `a Form card is taken at once (offered ${formOffered.toFixed(1)} s, taken ${formAt.toFixed(1)} s, weapon ${ws.id})`);
  ok(q > 0 && e === 0, `the bot casts Q (${q}) and never presses E`);
}

// 5. short-reach stance (Cleave)
{
  const ED = load(), w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
  const bot = Bot.create({ pid: 'p1', seed: 1 }); bot.onStart(w, p);
  let n = 0, inR = 0, R = 56;
  while (w.time < 120 && w.state === 'play') {
    w.input('p1', bot.think(w, p)); w.update(ED.CONST.TICK); w.events.length = 0;
    if (w.paused) continue;
    const S = w.weaponS(p, 0);
    R = S.range * S.area; n++;
    for (const e of w.foes) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) <= R + e.r) { inR++; break; }
  }
  ok(n > 0 && inR / n >= 0.2, `knight keeps a foe inside Cleave's reach on ${(inR / Math.max(1, n) * 100).toFixed(1)}% of ticks (need >= 20%)`);
  const B = { r: 40 }, hold = bot.bossHold(p, B) - B.r;
  ok(hold <= R && hold > p.r, `Cleave boss hold ${hold.toFixed(1)} px from the boss edge (reach ${R.toFixed(1)} px)`);
}

// 6. card order
{
  const ED = load(), w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0], ws = p.weapons[0];
  const bot = Bot.create({ pid: 'p1', seed: 1 }); bot.onStart(w, p);
  const path = (i) => ({ kind: 'path', id: 'cleave', path: i, lvl: ws.pr[i] + 1, name: '', txt: '', sub: '', icon: '', val: 0 });
  const card = (kind, id, lvl) => ({ kind, id, path: -1, lvl: lvl || 1, name: '', txt: '', sub: '', icon: '', val: 0 });
  const pick = (O) => { p.offer = O; const f = bot.think(w, p); p.offer = null; return f.pick ? O[f.pick - 1] : null; };
  const seq = [];
  for (let k = 0; k < 6; k++) {
    const O = [0, 1, 2].filter(i => ws.pr[i] < 3).map(path).concat([card('passive', 'might'), card('skill', 'charge', 2)]);
    const c = pick(O); seq.push(c.kind === 'path' ? 'p' + c.path : c.kind); if (c.kind === 'path') ws.pr[c.path]++;
  }
  ok(seq.join(',') === 'p0,p0,p0,p1,p1,p1', 'one path to rank 3 (the Form path first), then a second: ' + seq.join(','));
  ws.pr[0] = 1; ws.pr[1] = 2; ws.pr[2] = 0;
  const c2 = pick([path(0), path(1), path(2)]);
  ok(c2 && c2.path === 1, 'the path closest to rank 3 goes first: path ' + (c2 && c2.path));
  const f = pick([path(1), card('refine', 'whirlwind'), card('form', 'whirlwind'), card('passive', 'might')]), r = pick([path(1), card('refine', 'whirlwind'), card('passive', 'might')]);
  const s = pick([card('passive', 'mending'), card('skill', 'charge', 2), card('passive', 'might', 2)]);
  ok(f.kind === 'form' && r.kind === 'refine' && s.kind !== 'skill', `Form first (${f.kind}), then refine (${r.kind}); passives before the skill (${s.kind} ${s.id})`);
}

// 7. boss fights + skill tier
{
  const r = runOne({ stage: 0, cls: 'knight', seed: 1, maxTime: 660, meta: 'max' });
  const ids = r.bosses.map(b => b.id + '@' + b.spawn + '-' + b.at).join(',');
  ok(r.bosses.length >= 2 && r.bosses.every(b => b.spawn !== null && b.at >= b.spawn) && r.bosses.some(b => b.id === 'twins'), 'boss kills carry their spawn: ' + ids + ' (time ' + r.time + ', death ' + r.death + ')');
  const c = { stage: 2, cls: 'ranger', seed: 5, maxTime: 90, skill: 0.3 }, x = runOne(c), y = runOne(c), z = runOne(Object.assign({}, c, { skill: 1 }));
  ok(strip(x) === strip(y) && x.skill === 0.3, `skill 0.3 deterministic (kills ${x.kills} / ${y.kills})`);
  ok(x.hurt !== z.hurt || x.kills !== z.kills, `skill 0.3 plays differently from 1 (hurt ${x.hurt} / ${z.hurt}, kills ${x.kills} / ${z.kills})`);
}

console.log(`check-bot: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
