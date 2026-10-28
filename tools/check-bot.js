// Headless bot check (exit 1 on failure). Usage: node tools/check-bot.js
// 1. tools/bot-brain.js loads in Node without ED (reads it lazily) and think() returns a full input frame.
// 2. runOne determinism: the same 90 s cfg twice gives identical results (wall-clock fields aside); the result carries every field.
// 3. Pure reader: a 340 s stage-2 run (first boss at 5:00, a cyclops added at 2:00 for st.test hazards) where a second, discarded bot also thinks every tick ends identical to a plain run.
// 4. Forced weapon: present in the build (or its evolution); fill 'off' ends with only the signature + forced weapon (or their evolutions); baseline fill 'off' keeps the signature only;
//    runOne rejects an evolved weapon id.
// 5. Short-reach stance: knight + censer keeps a foe inside the aura on >= 20% of 120 s and holds bosses inside it.
// 6. Card order: signature / forced levels alternate (lower level first, ties to the forced one), then the forced pair passive, then the signature's.
// 7. Boss fights: every killed boss carries its spawn time under its stage id (the twins end on either body). skill 0.3 is deterministic and plays differently from skill 1.
'use strict';
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();

// 1. load without ED
delete globalThis.ED;
const Bot = require('./bot-brain.js');
ok(typeof Bot.create === 'function' && !globalThis.ED, 'bot-brain loads in Node without ED');
const { load } = require('./sim.js');
const { runOne } = require('./bot.js');
{
  const ED = load(), w = new ED.World({ seed: 3, stage: 0, players: [{ pid: 'p1', cls: 'ranger', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
  const b = Bot.create({ pid: 'p1', weapon: null, seed: 3 }); if (b.onStart) b.onStart(w, p);
  let f = null;
  for (let i = 0; i < 120; i++) { f = b.think(w, p); w.input('p1', f); w.update(ED.CONST.TICK); w.events.length = 0; }
  const keys = ['mx', 'my', 'ax', 'ay', 'dash', 'q', 'e', 'pick', 'banish', 'reroll', 'skip'];
  ok(f && keys.every(k => k in f) && isFinite(f.ax) && Math.hypot(f.mx, f.my) <= 1.0001, 'think returns a full frame: ' + JSON.stringify(f));
}

// 2. determinism + shape
const strip = (r) => { const o = Object.assign({}, r); delete o.ms; delete o.botMs; return JSON.stringify(o); };
const cfg = { stage: 1, cls: 'pyro', weapon: 'wisp', seed: 7, maxTime: 90 };
const a = runOne(cfg), b = runOne(cfg);
ok(strip(a) === strip(b), `runOne deterministic (90 s pyro + wisp: level ${a.level}, kills ${a.kills}, ${a.ms} ms / ${b.ms} ms)`);
const FIELDS = ['stage', 'stageId', 'cls', 'weapon', 'seed', 'meta', 'won', 'time', 'level', 'kills', 'gold', 'death', 'bosses', 'dealt', 'taken', 'hurt', 'build', 'evolved', 'hpLow', 'ticks', 'ms', 'botMs', 'skill', 'fill'];
const miss = FIELDS.filter(k => !(k in a));
ok(!miss.length && Array.isArray(a.bosses) && Array.isArray(a.build.weapons) && Array.isArray(a.build.passives) && typeof a.dealt === 'object', 'result has every field' + (miss.length ? ': missing ' + miss.join(',') : ''));
ok(a.time >= 89 && a.time <= 91 && a.death === 'timeout' && a.ticks > 0, `maxTime stops the run (time ${a.time}, death ${a.death})`);

// 3. pure reader
{
  const run = (extra) => {
    const ED = load(), w = new ED.World({ seed: 9, stage: 2, players: [{ pid: 'p1', cls: 'necro', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
    const bot = Bot.create({ pid: 'p1', weapon: null, seed: 9 }), spy = Bot.create({ pid: 'p1', weapon: 'mortar', seed: 4, skill: 0.3 });
    bot.onStart(w, p); spy.onStart(w, p);
    let h = 0, bossT = -1, tests = 0, added = false;
    while (w.time < 340 && w.state === 'play') {
      if (!added && w.time >= 120) { added = true; w.spawnBoss({ t: 300, id: 'cyclops', final: false }); }
      if (extra) spy.think(w, p);
      w.input('p1', bot.think(w, p)); w.update(ED.CONST.TICK);
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

// 4. forced weapon and isolation
{
  const ED = load(), base = (id) => { const d = ED.WEAPONS[id]; return d && d.evolved ? d.from : id; };
  const r = runOne({ stage: 0, cls: 'knight', weapon: 'bonespear', seed: 2, maxTime: 300 });
  const ids = r.build.weapons.map(x => base(x.id));
  ok(r.fill === 'off' && ids.includes('bonespear') && ids.every(id => id === 'cleave' || id === 'bonespear'), `forced bonespear, fill off (default): build ${r.build.weapons.map(x => x.id + x.lvl).join(',')}`);
  const lv = r.build.weapons.find(x => base(x.id) === 'bonespear');
  ok(lv && lv.lvl >= 6, `forced weapon levelled (bonespear form ${lv && lv.id} level ${lv && lv.lvl} at 5:00)`);
  const n = runOne({ stage: 0, cls: 'shade', weapon: null, seed: 2, maxTime: 240, fill: 'off' });
  ok(n.build.weapons.length === 1 && base(n.build.weapons[0].id) === 'daggers', `baseline fill off keeps the signature only: ${n.build.weapons.map(x => x.id).join(',')}`);
  const o = runOne({ stage: 0, cls: 'shade', weapon: null, seed: 2, maxTime: 240, fill: 'on' });
  ok(o.fill === 'on' && o.build.weapons.length > 1, `fill on takes more weapons: ${o.build.weapons.map(x => x.id).join(',')}`);
  let msg = '';
  try { runOne({ stage: 0, cls: 'knight', weapon: 'holycenser', seed: 1, maxTime: 1 }); } catch (e) { msg = e.message; }
  ok(/evolved/.test(msg), 'runOne rejects an evolved weapon: ' + (msg || 'no error'));
}

// 5. short-reach stance (seed 1: the pre-stance bot had 16% here)
{
  const ED = load(), w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
  w.addWeapon(p, 'censer'); Bot.isolate(w, p, ['cleave', 'censer']);
  const bot = Bot.create({ pid: 'p1', weapon: 'censer', seed: 1 }); bot.onStart(w, p);
  let n = 0, inR = 0, R = 44;
  while (w.time < 120 && w.state === 'play') {
    w.input('p1', bot.think(w, p)); w.update(ED.CONST.TICK); w.events.length = 0;
    if (w.paused) continue;
    const i = p.weapons.findIndex(x => x.id === 'censer' || x.id === 'holycenser');
    R = 44 * w.weaponS(p, i).area; n++;
    for (const e of w.foes) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) <= R + e.r) { inR++; break; }
  }
  ok(n > 0 && inR / n >= 0.2, `knight + censer keeps a foe inside the aura on ${(inR / Math.max(1, n) * 100).toFixed(1)}% of ticks (need >= 20%)`);
  const B = { r: 40 }, hold = bot.bossHold(p, B) - B.r;
  ok(hold <= R && hold > p.r, `censer boss hold ${hold.toFixed(1)} px from the boss edge (aura ${R.toFixed(1)} px)`);
}

// 6. card order: knight + censer
{
  const ED = load(), w = new ED.World({ seed: 1, stage: 0, players: [{ pid: 'p1', cls: 'knight', meta: { shop: {}, sigs: [] } }] }), p = w.heroes[0];
  w.addWeapon(p, 'censer');
  const bot = Bot.create({ pid: 'p1', weapon: 'censer', seed: 1 }); bot.onStart(w, p);
  const wl = (id) => p.weapons.find(x => x.id === id);
  const card = (kind, id) => ({ kind, id, lvl: kind === 'wlvl' ? wl(id).lvl + 1 : 1, evo: false, val: 0 });
  const pick = (O) => { p.offer = O; const f = bot.think(w, p); p.offer = null; return f.pick ? O[f.pick - 1].id : 'none'; };
  const seq = [];
  for (let k = 0; k < 6; k++) { const id = pick([card('wlvl', 'cleave'), card('wlvl', 'censer'), card('passive', 'mending'), card('passive', 'might')]); seq.push(id + (id === 'none' ? '' : wl(id).lvl)); wl(id).lvl++; }
  ok(seq.join(',') === 'censer1,cleave1,censer2,cleave2,censer3,cleave3', 'signature / forced levels alternate, ties to the forced weapon: ' + seq.join(','));
  wl('cleave').lvl = 2; wl('censer').lvl = 4;
  const a = pick([card('wlvl', 'censer'), card('wlvl', 'cleave')]), b = pick([card('passive', 'might'), card('passive', 'mending'), card('skill', 'charge')]);
  ok(a === 'cleave' && b === 'mending', `lower level first (${a}), then the forced pair passive before the signature's (${b})`);
}

// 7. boss fights + skill tier
{
  const r = runOne({ stage: 0, cls: 'knight', weapon: null, seed: 1, maxTime: 660, fill: 'off' });
  const ids = r.bosses.map(b => b.id + '@' + b.spawn + '-' + b.at).join(',');
  ok(r.bosses.length >= 2 && r.bosses.every(b => b.spawn !== null && b.at >= b.spawn) && r.bosses.some(b => b.id === 'twins'), 'boss kills carry their spawn: ' + ids);
  const c = { stage: 2, cls: 'ranger', weapon: null, seed: 5, maxTime: 90, skill: 0.3 }, x = runOne(c), y = runOne(c), z = runOne(Object.assign({}, c, { skill: 1 }));
  ok(strip(x) === strip(y) && x.skill === 0.3, `skill 0.3 deterministic (kills ${x.kills} / ${y.kills})`);
  ok(x.hurt !== z.hurt || x.kills !== z.kills, `skill 0.3 plays differently from 1 (hurt ${x.hurt} / ${z.hurt}, kills ${x.kills} / ${z.kills})`);
}

console.log(`check-bot: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
