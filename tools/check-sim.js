// Headless sim regression check (exit 1 on failure). Usage: node tools/check-sim.js [--quick] (quick: 5-minute runs instead of 15).
// 1. Solo knight, 15:00 with scripted inputs (circle walk, Q / E / dash on timers, first card picked), god cheat: reaches the final boss spawn; run twice -> same digest.
// 2. 4 heroes (knight, ranger, pyro, cleric), same script, god cheat: no exceptions, reaches the final boss; run twice -> same digest.
// 3. Victory: solo ranger with { god, might: 60 } until the final boss dies (state 'won', 'end' event, summary).
// 4. Mortal solo knight run until it ends (no cheats): state 'lost' with a summary, or survives.
// 5. Every hero 90 s: no exceptions, Q and E cast, the signature weapon deals damage. 6. Invariants: hit events <= 200 per tick, foe telegraphs >= 0.6 s, alive cap respected.
// 7. Save: code round trip, applyRun unlocks and gold.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
const QUICK = process.argv.includes('--quick'), LEN = QUICK ? 300 : C.RUN_LEN;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };

// Scripted player: circles (radius grows with time), aims 80 px ahead, Q every 7 s, E every 11 s, dash every 5 s (phase per slot), picks the first card.
function drive(w, p, tick) {
  const t = tick / 60, a = t * 0.7 + p.slot * 1.6;
  w.input(p.pid, { mx: Math.cos(a), my: Math.sin(a), ax: p.x + Math.cos(a) * 80, ay: p.y + Math.sin(a) * 80, q: tick % 420 === 30 + p.slot * 7, e: tick % 660 === 60 + p.slot * 7, dash: tick % 300 === 90 + p.slot * 13, pick: p.offer ? 1 : 0 });
}
// Digest of the visible state: rolled over every second.
function stateHash(w) {
  let s = w.tick + '|' + w.kills + '|' + w.level + '|' + Math.floor(w.xp) + '|' + w.gold + '|' + w.foes.length + '|' + w.projs.length + '|' + w.pickups.length;
  for (const p of w.heroes) s += '|' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ',' + p.hp.toFixed(2) + ',' + p.weapons.map(x => x.id + x.lvl).join('') + p.passives.map(x => x.id + x.lvl).join('');
  let fx = 0, fy = 0; for (const e of w.foes) { fx += e.x; fy += e.y; }
  return U.hashStr(s + '|' + fx.toFixed(1) + '|' + fy.toFixed(1));
}
// Runs a world to `until` s (or its end). Returns { w, digest, maxHits, minTele, overCap, bosses, events, err }.
function run(cfg, until, stopAt) {
  const w = new ED.World(cfg), out = { w, digest: 0, maxHits: 0, minTele: Infinity, overCap: 0, bosses: [], ends: 0, casts: {}, err: null };
  try {
    for (let tick = 0; w.time < until && w.state === 'play'; tick++) {
      for (const p of w.heroes) drive(w, p, tick);
      w.update(C.TICK);
      let hits = 0;
      for (const ev of w.events) {
        if (ev.t === 'hit') hits++;
        else if (ev.t === 'boss' && ev.phase === 0) out.bosses.push(ev.id + '@' + Math.round(w.time));
        else if (ev.t === 'end') out.ends++;
        else if (ev.t === 'skill') out.casts[ev.id] = (out.casts[ev.id] || 0) + 1;
      }
      w.events.length = 0;
      if (hits > out.maxHits) out.maxHits = hits;
      for (const z of w.zones) if (z.team === 1 && z.warn && z.dur < out.minTele) out.minTele = z.dur;
      if (w.foes.length > Math.max(w.aliveCap(), 900) + 200) out.overCap++;
      if (tick % 60 === 0) out.digest = (Math.imul(out.digest, 31) + stateHash(w)) >>> 0;
      if (stopAt && stopAt(w)) break;
    }
  } catch (e) { out.err = e; }
  return out;
}
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
const t0 = Date.now();
const finalUp = (w) => w.bossList.some(e => e.final) && w.time > LEN + 3;

// 1. solo determinism + reaching the final boss
const soloCfg = () => ({ seed: 1234, stage: 0, players: players(['knight']), cheats: { god: true } });
const s1 = run(soloCfg(), LEN + 10, finalUp), s2 = run(soloCfg(), LEN + 10, finalUp);
ok(!s1.err && !s2.err, 'solo 15:00 runs throw nothing' + (s1.err ? ': ' + s1.err.stack : ''));
ok(s1.digest === s2.digest, `solo digest equal (${s1.digest} / ${s2.digest})`);
ok(s1.w.bossList.some(e => e.final) || QUICK, `solo reaches the final boss (bosses ${s1.bosses.join(', ')}; t ${s1.w.time.toFixed(0)} s, kills ${s1.w.kills}, level ${s1.w.level})`);
ok(QUICK || s1.bosses.length >= 3, 'solo meets 3 bosses');
// 2. four heroes
const quadCfg = () => ({ seed: 99, stage: 0, players: players(['knight', 'ranger', 'pyro', 'cleric']), cheats: { god: true } });
const q1 = run(quadCfg(), LEN + 10, finalUp), q2 = run(quadCfg(), LEN + 10, finalUp);
ok(!q1.err && !q2.err, '4-hero runs throw nothing' + (q1.err ? ': ' + q1.err.stack : ''));
ok(q1.digest === q2.digest, `4-hero digest equal (${q1.digest} / ${q2.digest})`);
ok(QUICK || q1.w.bossList.some(e => e.final), `4-hero reaches the final boss (bosses ${q1.bosses.join(', ')}; kills ${q1.w.kills}, level ${q1.w.level}, peak cap ${q1.w.aliveCap()})`);
for (const r of [s1, q1]) { ok(r.maxHits <= 200, 'hit events per tick <= 200 (max ' + r.maxHits + ')'); ok(r.overCap === 0, 'alive cap respected'); ok(r.minTele === Infinity || r.minTele >= 0.6, 'foe telegraphs >= 0.6 s (min ' + r.minTele + ')'); }
// 3. victory with a cheat build
const v = run({ seed: 7, stage: 0, players: players(['ranger']), cheats: { god: true, might: 60 } }, C.RUN_LEN + 120);
ok(!v.err, 'victory run throws nothing' + (v.err ? ': ' + v.err.stack : ''));
ok(v.w.state === 'won' && v.ends === 1, `victory reachable (state ${v.w.state}, t ${v.w.time.toFixed(0)} s, ends ${v.ends})`);
const sum = v.w.summary();
ok(sum.won && sum.perHero.length === 1 && sum.perHero[0].dealt.longbow > 0, 'summary carries per-weapon damage');
// 4. mortal run
const m = run({ seed: 5, stage: 0, players: players(['knight']) }, LEN);
ok(!m.err, `mortal run throws nothing (state ${m.w.state} at ${m.w.time.toFixed(0)} s, level ${m.w.level})` + (m.err ? ': ' + m.err.stack : ''));
ok(m.w.state !== 'lost' || m.ends === 1, 'a lost run emits one end event');
// 5. every hero
for (const cls of ED.HERO_IDS) {
  const r = run({ seed: 11, stage: 0, players: players([cls]), cheats: { god: true } }, 90);
  const h = ED.HEROES[cls], dealt = r.w.heroes[0].dealt[h.sig] || 0;
  ok(!r.err && (r.casts[h.skills[0]] || 0) > 0 && (r.casts[h.skills[1]] || 0) > 0 && dealt > 0, `${cls}: 90 s, Q ${r.casts[h.skills[0]] || 0} E ${r.casts[h.skills[1]] || 0}, ${h.sig} dealt ${Math.round(dealt)}, kills ${r.w.kills}` + (r.err ? ': ' + r.err.stack : ''));
}
// 6. stages 2 and 3 run
for (const st of [1, 2]) { const r = run({ seed: 3, stage: st, players: players(['pyro']), cheats: { god: true } }, 120); ok(!r.err && r.w.kills > 0, `stage ${st + 1}: 120 s, kills ${r.w.kills}` + (r.err ? ': ' + r.err.stack : '')); }
// 7. save
const S = ED.Save, p = S.defaultProfile();
p.name = 'Tester'; p.gold = 450; S.buy(p, 'might');
const back = S.decode(S.encode(p));
ok(back.name === 'Tester' && back.gold === 250 && back.shop.might === 1, 'save code round trip');
const g = S.applyRun(p, Object.assign({}, sum, { time: 700, level: 41 }), 0, 'p1');
ok(g.unlocked.includes('necro') && g.unlocked.includes('cleric') && g.unlocked.includes('bell') && p.beat.includes(0) && S.stageUnlocked(p, 1), 'applyRun unlocks heroes and stage 2: ' + g.unlocked.join(','));
let bad = false; try { S.decode('WK1-AAAAA-AAAAA'); bad = true; } catch (e) { /* rejected */ }
ok(!bad, 'a broken code is rejected');

console.log(`check-sim: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
