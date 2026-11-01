// Headless check (exit 1 on failure): the Wickmother (src/sim/boss-wickmother.js) in a stand-in Sanctum. Usage: node tools/check-wickmother.js
// Harness: a stage-0 world at 20:00, every foe removed, the spawner off, w.sanctum = { st: 1, t0, x, y, w: 720, h: 480 } at the arena centre, the boss through W.spawnBoss.
// Checks: spawn (anchor, HP x WM.hp, two hands at WM.hand.hp), P1 ward (HP held, hits deal <= 1), one broken hand goes limp and regrows, both broken at once -> kneel (x WM.kneel.mul damage,
// ends after WM.kneel.t s, ward back), HP thresholds start P2 / P3 and clamp HP, P2 sconces (a hero lights one in WM.sconce.light s, a hand snuffs a lit one, all 4 lit -> kneel, out after),
// P3 (no ward, sconces gone, the melt band grows, bossBar.rev = the wick, the flood at the clock's end downs a hero), every attack runs and its zones reach a hero, hostile telegraphs >= 0.6 s,
// hazards after a telegraph carry st.tw >= 0.6, every look is registered, the bfx-d draw hooks run on every zone / foe / shot, her death ends the fight (hands gone, zones cleared),
// two runs with one seed give the same digest.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
C.ENRAGE_T = 1e9; // the Sanctum's room code skips the global final-boss enrage; this harness has none
require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'client', 'bfx-d.js'), 'utf8'), { filename: 'bfx-d.js' });
const WM = ED.Bosses.WICKMOTHER;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
// Mock client for the bfx-d hooks: a non-finite draw argument throws.
const mockB = new Proxy({}, { get: (o, k) => (k === 'crowd' ? 0 : (...a) => { for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite arg to B.' + String(k)); return true; }) });
ED.Atlas = { ok: true, has: () => true, anim: () => ({ n: 3, fps: 10, ax: 8, ay: 16, anchors: {} }), frameAt: () => 0 };
function drawAll(w) {
  ED.Game = { view: { heroes: w.heroes, foes: w.foes, zones: w.zones } };
  for (const e of w.foes) { const f = !e.dead && ED.BossFx[e.def.id]; if (f && f.draw) f.draw(mockB, e, w.time); }
  for (const z of w.zones) { const f = !z.dead && ED.ZoneFx[z.k]; if (f) f(mockB, z, w.time); }
  for (const pr of w.projs) { const f = !pr.dead && ED.WeaponFx[pr.wid]; if (f && f.proj) f.proj(mockB, pr, w.time); }
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls: 'knight', meta: { shop: {}, sigs: [] } }));

// Harness world: the boss in a stand-in Sanctum; opt: { seed, party, keep (hero HP refilled, default true) }. Returns { w, e, R, log }.
function harness(opt) {
  opt = opt || {};
  const w = new ED.World({ seed: opt.seed || 11, stage: 0, players: players(opt.party || 1) });
  w.time = 1200; w.updateSpawner = () => {};
  for (const f of w.foes) w.despawnFoe(f);
  const S = w.arena.size / 2, R = { x: S, y: S, w: 720, h: 480 };
  w.sanctum = { st: 1, t0: w.time, x: R.x, y: R.y, w: R.w, h: R.h };
  w.heroes.forEach((p, i) => { p.x = R.x - 60 + i * 40; p.y = R.y + 200; });
  const log = { ev: [], hurtBy: {}, warnMin: Infinity, twMin: Infinity, looks: new Set(), heads: new Set(), acts: new Set(), digest: 0 };
  const hurt = w.hurtHero;
  w.hurtHero = function (p, dmg, src) { const keep = opt.keep !== false; if (keep) p.hp = Math.max(p.hp, 1e6); const d = hurt.call(this, p, dmg, src); if (keep) p.hp = p.maxHp; if (d > 0) { const k = src && src.k ? src.k : src && src.def ? 'contact' : '?'; log.hurtBy[k] = (log.hurtBy[k] || 0) + 1; } return d; };
  const e = w.spawnBoss({ t: 1200, id: 'wickmother', final: true });
  return { w, e, R, log };
}
// One tick: hero 0 walks toward (gx, gy) when given (else circles under her), events logged, zones / shots audited, draws every 6th tick.
function step(h, gx, gy) {
  const { w, e, log } = h, p = w.heroes[0];
  if (gx === undefined) { const a = w.time * 0.7; gx = h.R.x + Math.cos(a) * 300; gy = h.R.y + 120 + Math.sin(a) * 110; }
  const dx = gx - p.x, dy = gy - p.y, l = Math.hypot(dx, dy);
  w.input(p.pid, { mx: l > 3 ? dx / l : 0, my: l > 3 ? dy / l : 0, ax: e.x, ay: e.y, pick: p.offer ? 1 : 0 });
  for (let i = 1; i < w.heroes.length; i++) w.input(w.heroes[i].pid, { mx: 0, my: 0, ax: e.x, ay: e.y, pick: w.heroes[i].offer ? 1 : 0 });
  w.update(C.TICK);
  for (const ev of w.events) if (ev.t === 'boss' && ev.id === 'wickmother') log.ev.push(ev.phase);
  w.events.length = 0;
  for (const z of w.zones) {
    if (z.dead || z.team !== 1) continue;
    log.looks.add(z.k);
    if (z.warn && z.dur < log.warnMin) log.warnMin = z.dur;
    if (!z.warn && z.st && z.st.mul > 0 && !z.st.inert && z.st.tw !== undefined && z.st.tw < log.twMin) log.twMin = z.st.tw;
  }
  for (const pr of w.projs) if (!pr.dead && pr.team === 1) log.looks.add(pr.k);
  const v = e.vars;
  if (v && v.head) log.heads.add(v.head.k);
  if (v) for (const H of v.H) if (H.a) log.acts.add(H.a.k);
  if (w.tick % 6 === 0) drawAll(w);
  if (w.tick % 30 === 0) { let d = log.digest; for (const f of w.foes) d = (Math.imul(d, 31) + Math.round(f.x * 4) + Math.round(f.y * 4) * 7 + f.hp) | 0; for (const z of w.zones) d = (Math.imul(d, 17) + Math.round(z.x) + Math.round(z.r) * 3) | 0; log.digest = d; }
}
const run = (h, s, gx, gy) => { for (let i = 0; i < s * 60 && h.w.state === 'play' && !h.e.dead; i++) step(h, gx, gy); };
const big = (h, f, mul) => h.w.hitFoe(f, mul, h.w.src(null, 'test'));
// Hit that takes the core to fraction k of its max HP (past a phase threshold, not lethal).
const toFrac = (h, k) => big(h, h.e, (h.e.hp - h.e.maxHp * k) / (h.e.takeMul || 1));
const handsUp = (h) => h.e.vars.H.filter((H) => H.e && !H.e.dead && H.e.id === H.id);

let h, err = null;
try {
  // ---------- spawn and P1 ----------
  h = harness();
  const { w, e, R } = h, v = e.vars;
  ok(e.x === R.x && e.y === R.y - R.h / 2 + WM.core.dy, 'core anchored at the room top + ' + WM.core.dy + ' px');
  ok(e.maxHp === Math.round(ED.bossHp(1200, w.partyHp() * ((w.sdef.foe && w.sdef.foe.hp) || 1)) * WM.hp), 'HP = boss HP x ' + WM.hp + ' (' + e.maxHp + ')');
  ok(handsUp(h).length === 2 && handsUp(h).every((H) => H.e.maxHp === Math.round(e.maxHp * WM.hand.hp)), 'two hands at ' + WM.hand.hp + ' x her HP');
  run(h, 3);
  const hp0 = e.hp, d1 = big(h, e, 5000);
  run(h, 0.2);
  ok(e.hp === hp0 && d1 <= 1, 'P1 ward: a 5000 hit deals ' + d1 + ', HP held');
  // one hand broken: limp, then regrows
  const H0 = v.H[0];
  big(h, H0.e, 1e7); run(h, 0.1);
  ok(H0.st === 'limp' && v.kneelT <= 0, 'one broken hand goes limp, no kneel');
  run(h, WM.hand.limp + WM.hand.regrow + 0.3);
  ok(H0.st === 'rest' && H0.e && H0.e.hp === H0.e.maxHp, 'the hand regrows after ' + WM.hand.limp + ' s at full HP');
  // both broken: kneel
  for (const H of handsUp(h)) big(h, H.e, 1e7);
  run(h, 0.6);
  ok(v.kneelT > 0 && h.log.ev.includes('kneel'), 'both hands broken -> she kneels');
  const hpK = e.hp, dk = big(h, e, 1000);
  ok(dk === Math.round(1000 * WM.kneel.mul) && e.hp === hpK - dk, 'kneel: x' + WM.kneel.mul + ' damage (1000 -> ' + dk + ')');
  ok(e.y > R.y - R.h / 2 + WM.core.dy + 20, 'kneel lowers the core');
  run(h, WM.kneel.t + 0.2);
  ok(v.kneelT <= 0 && h.log.ev.includes('rise'), 'kneel ends after ' + WM.kneel.t + ' s');
  const hp1 = e.hp; big(h, e, 5000); run(h, 0.1);
  ok(e.hp === hp1, 'ward back after the kneel');
  run(h, 17);
  run(h, 8, w.heroes[0].x, w.heroes[0].y); // standing still: drips land
  // ---------- P2 ----------
  for (const H of handsUp(h)) big(h, H.e, 1e7);
  run(h, 0.6);
  toFrac(h, 0.5); run(h, 0.1);
  ok(v.phase === 2 && h.log.ev.includes(2), 'P2 starts below ' + WM.phases[0]);
  ok(Math.abs(e.hp - Math.floor(e.maxHp * WM.phases[0])) <= 1, 'phase change clamps HP at the threshold');
  ok(v.sc.length === 4 && w.zones.filter((z) => !z.dead && z.k === 'wmsconce').length === 4, 'four sconces up');
  run(h, 1.5);
  const hp2 = e.hp; big(h, e, 5000); run(h, 0.1);
  ok(e.hp === hp2, 'P2 ward while the sconces are out');
  const sc0 = v.sc[0];
  for (let i = 0; i < 15 * 60 && !sc0.lit; i++) step(h, sc0.x, sc0.y);
  ok(sc0.lit && h.log.ev.includes('lit'), 'a hero lights a sconce by standing in it ' + WM.sconce.light + ' s');
  const scZ = w.zones.find((z) => !z.dead && z.k === 'wmsconce' && z.x === sc0.x && z.y === sc0.y);
  ok(scZ && scZ.w === 1, 'its zone carries the lit state');
  let snuffed = false;
  for (let i = 0; i < 40 * 60 && !snuffed; i++) { step(h); if (!sc0.lit) snuffed = true; }
  ok(snuffed && h.log.acts.has('snuff') && h.log.ev.includes('snuff'), 'a hand snuffs the lit sconce');
  // all four lit -> kneel; sconces out after
  for (let i = 0; i < 60 * 60 && v.kneelT <= 0; i++) { // hands kept broken (no snuffs); the hero walks to the nearest unlit sconce
    for (const H of handsUp(h)) big(h, H.e, 1e7);
    const p = w.heroes[0]; let best = null;
    for (const sc of v.sc) if (!sc.lit && (!best || U.dist2(p.x, p.y, sc.x, sc.y) < U.dist2(p.x, p.y, best.x, best.y))) best = sc;
    step(h, best ? best.x : p.x, best ? best.y : p.y);
  }
  ok(h.log.ev.filter((x) => x === 'kneel').length >= 2 && v.kneelT > 0, 'all four lit -> she kneels');
  run(h, WM.kneel.t + 0.2);
  ok(v.phase === 2 && v.sc.every((sc) => !sc.lit), 'the sconces go out when she rises');
  run(h, 30);
  // ---------- P3 ----------
  for (const sc of v.sc) { let n = 0; while (!sc.lit && n++ < 600 && v.phase === 2) step(h, sc.x, sc.y); }
  run(h, 0.2);
  toFrac(h, 0.1); run(h, 0.1);
  ok(v.phase === 3 && h.log.ev.includes(3), 'P3 starts below ' + WM.phases[1]);
  ok(!w.zones.some((z) => !z.dead && z.k === 'wmsconce'), 'sconces gone in P3');
  run(h, 1.2);
  const hp3 = e.hp, d3 = big(h, e, 1000);
  ok(d3 === 1000 && e.hp === hp3 - 1000, 'P3: no ward');
  run(h, 40);
  const melt = w.zones.find((z) => !z.dead && z.k === 'wmmelt');
  ok(melt && melt.w % 1000 > 20, 'melt band grows (' + (melt ? melt.w % 1000 : 0) + ' px at 40 s)');
  ok(Math.abs(w.bossBar.rev - v.wick) < 1e-9 && v.wick > 0.4 && v.wick < 0.7, 'boss bar rev = the wick (' + v.wick.toFixed(2) + ')');
  run(h, 55);
  ok(v.flood === 1 && h.log.ev.includes('wick') && h.log.ev.includes('flood'), 'the wick cue, then the flood');
  // coverage
  for (const k of ['slam', 'sweep', 'clap', 'snuff']) ok(h.log.acts.has(k), 'hand attack ' + k + ' ran');
  for (const k of ['rain', 'spiral', 'tide']) ok(h.log.heads.has(k), 'head attack ' + k + ' ran');
  for (const k of ['wmslam', 'wmshock', 'wmsweep', 'wmclap', 'wmdrip', 'wmtide', 'wmflame', 'wmmelt']) ok((h.log.hurtBy[k] || 0) > 0, k + ' reaches the hero (' + (h.log.hurtBy[k] || 0) + ')');
  ok(h.log.warnMin >= 0.6, 'hostile telegraphs >= 0.6 s (min ' + h.log.warnMin.toFixed(2) + ')');
  ok(h.log.twMin >= 0.6, 'hazards after a telegraph carry its lead >= 0.6 s (min ' + h.log.twMin.toFixed(2) + ')');
  const unreg = [...h.log.looks].filter((k) => ED.LOOK_IDX[k] === undefined);
  ok(!unreg.length, 'every zone / shot look registered' + (unreg.length ? ': ' + unreg.join(',') : ''));
  // ---------- the flood wipes ----------
  const hf = harness({ seed: 3, keep: false });
  hf.w.cheats.god = false;
  hf.e.vars.phase = 2; hf.e.hp = Math.floor(hf.e.maxHp * 0.3); run(hf, 0.2);
  ok(hf.e.vars.phase === 3, 'flood run: P3');
  hf.w.update = ((u) => function (dt) { for (const p of this.living) p.hp = Math.max(p.hp, 1e6); return u.call(this, dt); })(hf.w.update); // nothing but the flood can down the hero
  const st0 = hf.e.vars.burn0;
  run(hf, WM.burn.t - 1);
  hf.w.update = ED.World.prototype.update;
  for (const p of hf.w.heroes) p.hp = p.maxHp;
  let downAt = -1;
  for (let i = 0; i < (WM.burn.flood + 4) * 60 && downAt < 0; i++) { step(hf); if (!hf.w.living.length || hf.w.state !== 'play') downAt = hf.w.time - st0; }
  ok(downAt > WM.burn.t + WM.burn.flood - 0.1, 'the flood downs the hero only after the clock and its warning (' + downAt.toFixed(1) + ' s)');
  // ---------- death ----------
  const hd = harness({ seed: 5 });
  hd.e.vars.phase = 3; hd.e.vars.burn0 = hd.w.time; run(hd, 3);
  const core = hd.e;
  big(hd, core, 1e9); for (const ev of hd.w.events) if (ev.t === 'boss' && ev.id === 'wickmother') hd.log.ev.push(ev.phase); hd.w.update(C.TICK);
  ok(core.dead || core.def.id !== 'wickmother', 'she dies');
  ok(!hd.w.foes.some((f) => !f.dead && (f.def.id === 'wmhand' || f.def.id === 'wickmother')), 'hands gone with her');
  ok(!hd.w.zones.some((z) => !z.dead && z.team === 1 && /^wm/.test(z.k)), 'her zones cleared');
  ok(hd.w.won && hd.log.ev.includes(-1), 'her death wins the run');
  // ---------- co-op and determinism ----------
  const hc = harness({ seed: 9, party: 3 });
  run(hc, 30);
  ok(hc.e.maxHp > h.e.maxHp, 'co-op: party HP factor applies');
  const d = (s) => { const x = harness({ seed: s }); run(x, 40); return x.log.digest; };
  ok(d(21) === d(21), 'same seed -> same digest');
} catch (ex) { err = ex; }
if (err) { fails++; console.log('FAIL exception: ' + (err.stack || err)); }
console.log(fails ? fails + ' failure(s)' : 'all passed');
process.exit(fails ? 1 : 0);
