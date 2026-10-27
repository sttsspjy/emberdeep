// Headless sim regression check (exit 1 on failure). Usage: node tools/check-sim.js [--quick] (quick: 5-minute solo / 4-hero runs, the victory run on stage 1 only).
// 1. Solo knight, 15:00 with scripted inputs (circle walk, Q / E / dash on timers, first card picked), god cheat: reaches the final boss spawn; run twice -> same digest.
// 2. 4 heroes (knight, ranger, pyro, cleric), same script, god cheat: no exceptions, reaches the final boss; run twice -> same digest.
// 3. Victory per stage (knight / ranger / pyro on stages 1 / 2 / 3): a cheat build (signature at max level, every general weapon at max level while slots last, paired passives
//    at max level) with { god, might: 40 }, walking to chests: 3 bosses met, the stage's final boss dies (state 'won', one 'end' event, summary), every evolution-ready weapon
//    evolves; the stage 3 run twice -> same digest.
// 4. Mortal solo knight run until it ends (no cheats): state 'lost' with one 'end' event, or survives.
// 5. Every hero x every stage, 75 s, god cheat: no exceptions, Q and E cast, the signature weapon deals damage, foes die; combined digest printed.
// 6. Invariants on every run: hit events <= 200 per tick, foe telegraphs >= 0.6 s, alive cap respected.
// 7. Save: code round trip, applyRun unlocks and gold.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
const QUICK = process.argv.includes('--quick'), LEN = QUICK ? 300 : C.RUN_LEN;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };

// Scripted player: circles, aims 80 px ahead, Q every 7 s, E every 11 s, dash every 5 s (phase per slot), picks the first card. seek: walks to the nearest chest within 700 px first.
function drive(w, p, tick, seek) {
  const t = tick / 60, a = t * 0.7 + p.slot * 1.6;
  let mx = Math.cos(a), my = Math.sin(a);
  if (seek) {
    let bd = 700 * 700, ch = null;
    for (const g of w.pickups) if (!g.dead && g.k === 'chest') { const d = U.dist2(p.x, p.y, g.x, g.y); if (d < bd) { bd = d; ch = g; } }
    if (ch) { const d = Math.sqrt(bd) || 1; mx = (ch.x - p.x) / d; my = (ch.y - p.y) / d; }
  }
  w.input(p.pid, { mx, my, ax: p.x + mx * 80, ay: p.y + my * 80, q: tick % 420 === 30 + p.slot * 7, e: tick % 660 === 60 + p.slot * 7, dash: tick % 300 === 90 + p.slot * 13, pick: p.offer ? 1 : 0 });
}
// Cheat build for hero p: owned weapons and every general weapon (non-signature, non-evolved, while slots last) at max level, their paired passives at max level.
// Returns the ids of the evolution-ready weapons.
function cheatBuild(w, p) {
  const pairs = [], maxL = (id) => ED.weaponMaxLvl(ED.WEAPONS[id]);
  for (const ws of p.weapons) { ws.lvl = maxL(ws.id); pairs.push(ED.WEAPONS[ws.id].pair); }
  for (const id of ED.WEAPON_IDS) {
    const d = ED.WEAPONS[id];
    if (p.weapons.length >= ED.MAX_WEAPONS) break;
    if (d.evolved || d.sig) continue;
    const ws = w.addWeapon(p, id); if (ws) { ws.lvl = maxL(id); pairs.push(d.pair); }
  }
  for (const id of pairs) if (id && ED.PASSIVES[id] && p.passives.length < ED.MAX_PASSIVES && !p.passives.some(x => x.id === id)) p.passives.push({ id, lvl: ED.PASSIVES[id].max });
  w.recalc(p, true);
  return p.weapons.filter(ws => w.weaponReady(p, ws)).map(ws => ws.id);
}
// Digest of the visible state: rolled over every second.
function stateHash(w) {
  let s = w.tick + '|' + w.kills + '|' + w.level + '|' + Math.floor(w.xp) + '|' + w.gold + '|' + w.foes.length + '|' + w.projs.length + '|' + w.pickups.length;
  for (const p of w.heroes) s += '|' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ',' + p.hp.toFixed(2) + ',' + p.weapons.map(x => x.id + x.lvl).join('') + p.passives.map(x => x.id + x.lvl).join('');
  let fx = 0, fy = 0; for (const e of w.foes) { fx += e.x; fy += e.y; }
  return U.hashStr(s + '|' + fx.toFixed(1) + '|' + fy.toFixed(1));
}
// Runs a world to `until` s (or its end). opt: { stopAt(w), setup(w) -> stored in out.setup, seek }.
// Returns { w, digest, maxHits, minTele, overCap, bosses, killed, evolved, ends, casts, err, setup }.
function run(cfg, until, opt) {
  opt = typeof opt === 'function' ? { stopAt: opt } : opt || {};
  const w = new ED.World(cfg), out = { w, digest: 0, maxHits: 0, minTele: Infinity, overCap: 0, bosses: [], killed: [], evolved: [], ends: 0, casts: {}, err: null, setup: null };
  try {
    if (opt.setup) out.setup = opt.setup(w);
    for (let tick = 0; w.time < until && w.state === 'play'; tick++) {
      for (const p of w.heroes) drive(w, p, tick, opt.seek);
      w.update(C.TICK);
      let hits = 0;
      for (const ev of w.events) {
        if (ev.t === 'hit') hits++;
        else if (ev.t === 'boss' && ev.phase === 0) out.bosses.push(ev.id + '@' + Math.round(w.time));
        else if (ev.t === 'boss' && ev.phase === -1) out.killed.push(ev.id + (ev.final ? '!' : ''));
        else if (ev.t === 'evolve') out.evolved.push(ev.from + '>' + ev.wid);
        else if (ev.t === 'end') out.ends++;
        else if (ev.t === 'skill') out.casts[ev.id] = (out.casts[ev.id] || 0) + 1;
      }
      w.events.length = 0;
      if (hits > out.maxHits) out.maxHits = hits;
      for (const z of w.zones) if (z.team === 1 && z.warn && z.dur < out.minTele) out.minTele = z.dur;
      if (w.foes.length > Math.max(w.aliveCap(), 900) + 200) out.overCap++;
      if (tick % 60 === 0) out.digest = (Math.imul(out.digest, 31) + stateHash(w)) >>> 0;
      if (opt.stopAt && opt.stopAt(w)) break;
    }
  } catch (e) { out.err = e; }
  return out;
}
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
const errOf = (r) => (r.err ? ': ' + r.err.stack : '');
// Hit-event cap, foe telegraph length and alive cap for run r.
const invariants = (r, tag) => {
  const bad = [];
  if (r.maxHits > 200) bad.push('hit events per tick ' + r.maxHits + ' > 200');
  if (r.overCap) bad.push('alive cap exceeded on ' + r.overCap + ' ticks');
  if (!(r.minTele === Infinity || r.minTele >= 0.6)) bad.push('foe telegraph ' + r.minTele + ' s < 0.6 s');
  ok(!bad.length, `${tag} invariants (max hits/tick ${r.maxHits}, min telegraph ${r.minTele === Infinity ? '-' : r.minTele} s)` + (bad.length ? ': ' + bad.join('; ') : ''));
};
const t0 = Date.now();
const finalUp = (w) => w.bossList.some(e => e.final) && w.time > LEN + 3;

// 1. solo determinism + reaching the final boss
const soloCfg = () => ({ seed: 1234, stage: 0, players: players(['knight']), cheats: { god: true } });
const s1 = run(soloCfg(), LEN + 10, finalUp), s2 = run(soloCfg(), LEN + 10, finalUp);
ok(!s1.err && !s2.err, 'solo 15:00 runs throw nothing' + errOf(s1));
ok(s1.digest === s2.digest, `solo digest equal (${s1.digest} / ${s2.digest})`);
ok(s1.w.bossList.some(e => e.final) || QUICK, `solo reaches the final boss (bosses ${s1.bosses.join(', ')}; t ${s1.w.time.toFixed(0)} s, kills ${s1.w.kills}, level ${s1.w.level})`);
ok(QUICK || s1.bosses.length >= 3, 'solo meets 3 bosses');
invariants(s1, 'solo');
// 2. four heroes
const quadCfg = () => ({ seed: 99, stage: 0, players: players(['knight', 'ranger', 'pyro', 'cleric']), cheats: { god: true } });
const q1 = run(quadCfg(), LEN + 10, finalUp), q2 = run(quadCfg(), LEN + 10, finalUp);
ok(!q1.err && !q2.err, '4-hero runs throw nothing' + errOf(q1));
ok(q1.digest === q2.digest, `4-hero digest equal (${q1.digest} / ${q2.digest})`);
ok(QUICK || q1.w.bossList.some(e => e.final), `4-hero reaches the final boss (bosses ${q1.bosses.join(', ')}; kills ${q1.w.kills}, level ${q1.w.level}, peak cap ${q1.w.aliveCap()})`);
invariants(q1, '4-hero');
// 3. victory per stage with a cheat build
const VICTORY = [['knight', 0, 7], ['ranger', 1, 8], ['pyro', 2, 9]].slice(0, QUICK ? 1 : 3);
const vcfg = (cls, st, seed) => ({ seed, stage: st, players: players([cls]), cheats: { god: true, might: 40 } });
const vopt = { seek: true, setup: (w) => cheatBuild(w, w.heroes[0]) };
let sum = null;
for (const [cls, st, seed] of VICTORY) {
  const v = run(vcfg(cls, st, seed), C.RUN_LEN + 150, vopt), fin = ED.STAGES[st].bosses.find(b => b.final), tag = `stage ${st + 1} ${cls}`;
  ok(!v.err, tag + ': victory run throws nothing' + errOf(v));
  ok(v.w.state === 'won' && v.ends === 1 && v.killed.includes(fin.id + '!'), `${tag}: victory (state ${v.w.state}, t ${v.w.time.toFixed(0)} s, level ${v.w.level}, kills ${v.w.kills}; met ${v.bosses.join(', ')}; killed ${v.killed.join(', ')}; digest ${v.digest})`);
  ok(v.bosses.length >= 3, `${tag}: meets ${v.bosses.length} bosses`);
  ok(v.setup.every(id => v.evolved.some(e => e.startsWith(id + '>'))), `${tag}: ready weapons evolve (ready ${v.setup.join(',') || 'none'}; evolved ${v.evolved.join(',') || 'none'}; build ${v.w.heroes[0].weapons.map(x => x.id + x.lvl).join(',')})`);
  invariants(v, tag);
  if (st === 0) {
    sum = v.w.summary();
    const dealt = sum.perHero[0].dealt;
    ok(sum.won && sum.perHero.length === 1 && Object.keys(dealt).some(k => ED.WEAPONS[k] && dealt[k] > 0), 'summary carries per-weapon damage (' + Object.keys(dealt).join(',') + ')');
  }
  if (st === 2) { const v2 = run(vcfg(cls, st, seed), C.RUN_LEN + 150, vopt); ok(!v2.err && v2.digest === v.digest, `${tag}: victory digest equal (${v.digest} / ${v2.digest})`); }
}
// 4. mortal run
const m = run({ seed: 5, stage: 0, players: players(['knight']) }, LEN);
ok(!m.err, `mortal run throws nothing (state ${m.w.state} at ${m.w.time.toFixed(0)} s, level ${m.w.level})` + errOf(m));
ok(m.w.state !== 'lost' || m.ends === 1, 'a lost run emits one end event');
// 5. every hero x every stage
let mdig = 0;
for (let st = 0; st < ED.STAGES.length; st++) for (const cls of ED.HERO_IDS) {
  const r = run({ seed: 11 + st, stage: st, players: players([cls]), cheats: { god: true } }, 75);
  const h = ED.HEROES[cls], dealt = r.w.heroes[0].dealt[h.sig] || 0, q = r.casts[h.skills[0]] || 0, e = r.casts[h.skills[1]] || 0;
  mdig = (Math.imul(mdig, 31) + r.digest) >>> 0;
  ok(!r.err && q > 0 && e > 0 && dealt > 0 && r.w.kills > 0, `stage ${st + 1} ${cls}: 75 s, Q ${q} E ${e}, ${h.sig} dealt ${Math.round(dealt)}, kills ${r.w.kills}, level ${r.w.level}` + errOf(r));
  if (r.maxHits > 200 || r.overCap || !(r.minTele === Infinity || r.minTele >= 0.6)) invariants(r, `stage ${st + 1} ${cls}`);
}
console.log('     hero x stage digest ' + mdig);
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
