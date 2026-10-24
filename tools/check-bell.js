// Usage: node tools/check-bell.js
// Headless checks of the Bellwarden (src/sim/class-bell.js) in staged rooms: determinism of the bell physics, strike damage by speed, the Haul's spin-up and the analytic model,
// walls, Heave and Peal parts (part ids, stuns, Thunderclap, Tether Hook), the whirl guard, fork weapons, the strike budget and finite state through a brawl with route cards.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const U = ED.U, C = ED.CONST, St = ED.Stats;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

// ---- staged world: one Bellwarden, no foes, crit off ----
function stage(boons, o) {
  o = o || {};
  const w = new ED.World({ seed: o.seed || 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'bell', weapon: o.weapon || 'bronzebell', meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null; p.stats.crit = 0;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.fx.length = 0;
  return { w, p };
}
const foe = (w, x, y, type) => { const e = w.spawnEnemy(type || 'skeleton', x, y); e.spawnT = 0; e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 1e7; return e; };
const run = (w, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.update(1 / 60); if (f) f(); } };
const speed = (b) => Math.hypot(b.vx, b.vy);
const hits = [];
const oHit = ED.World.prototype.hitEnemy;
ED.World.prototype.hitEnemy = function (e, base, src) { const d = oHit.call(this, e, base, src); hits.push({ e, base, d, src: src || {}, t: this.time }); return d; };

// ---- determinism: the same seed and inputs give the same bells and foes ----
{
  const sim = () => {
    const { w, p } = stage();
    for (let i = 0; i < 6; i++) foe(w, p.x + 30 + 8 * i, p.y + (i - 3) * 12);
    p.haulIn = true;
    run(w, 6, () => { p.x += Math.sin(w.time * 3) * 1.2; });
    return JSON.stringify({ b: p.bells.map(b => [b.x, b.y, b.vx, b.vy]), hp: w.enemies.map(e => e.hp) });
  };
  ok(sim() === sim(), 'the bell physics is deterministic');
}

// ---- spin-up: a hauled bell reaches the model's top speed on its orbit; let go, it slows ----
for (const wid of ['bronzebell', 'greatbell', 'handbells', 'wreckbell', 'chimes', 'stormbell']) {
  const { w, p } = stage({}, { weapon: wid });
  p.haulIn = true;
  run(w, 4);
  const wp = p.stats.weapon, m = ED.Bell.model(p.stats, 1, St.attackInterval(p), ED.Bell.rateGain(p));
  const v = p.bells.reduce((s, b) => s + speed(b), 0) / p.bells.length, d = Math.hypot(p.bells[0].x - p.x, p.bells[0].y - p.y);
  ok(p.bells.length === (wp.n || 1), `${wid}: ${wp.n || 1} bell(s)`);
  ok(Math.abs(v - m.top) < m.top * 0.04, `${wid}: hauled speed ${v.toFixed(0)} near the model's top ${m.top.toFixed(0)}`);
  near(d, ED.Bell.orbit(wp), 1.5, `${wid}: the hauled chain is the orbit`);
  ok(p.haul > 0.99, `${wid}: haul 1 while held`);
  p.haulIn = false; run(w, 1.5);
  ok(speed(p.bells[0]) < v * 0.3 && p.haul < 0.01 && p.bellL > ED.Bell.orbit(wp) + 1, `${wid}: let go, the bell slows and the chain lets out`);
}
{ // spin-up time: from rest to BELL_MIN within a second
  const { w, p } = stage();
  p.haulIn = true;
  let t = -1;
  run(w, 1.5, () => { if (t < 0 && speed(p.bells[0]) >= C.BELL_MIN) t = w.time; });
  ok(t > 0 && t < 1, `the Haul spins the bell to strike speed in ${t.toFixed(2)} s`);
}

// ---- strikes: damage = weapon dmg x clamp(speed / BELL_REF, 0.4, 1.8); none below BELL_MIN; a strike costs `loss` of the speed ----
{
  const { w, p } = stage();
  const e = foe(w, p.x + ED.Bell.orbit(p.stats.weapon), p.y);
  const ex = e.x, ey = e.y, pin = () => { e.x = ex; e.y = ey; e.kbx = e.kby = 0; }; // the foe holds its spot on the orbit
  p.haulIn = true; hits.length = 0; w.fx.length = 0;
  run(w, 5, pin);
  const st = w.fx.filter(x => x.t === 'bstrike'), wh = hits.filter(h => h.e === e && h.src.kind === 'weapon');
  ok(st.length > 4 && st.length === wh.length, `strikes land (${st.length} strikes, ${wh.length} weapon hits)`);
  let worst = 0;
  for (let i = 0; i < wh.length; i++) { const want = p.stats.weapon.dmg * U.clamp(st[i].v / C.BELL_REF, 0.4, 1.8) * p.stats.dmg; worst = Math.max(worst, Math.abs(wh[i].d - want) / want); }
  ok(worst < 0.02, `strike damage follows the speed (worst error ${(worst * 100).toFixed(1)}%)`);
  ok(st.every(x => x.v >= C.BELL_MIN), 'no strike below BELL_MIN');
  const gaps = wh.slice(1).map((h, i) => h.t - wh[i].t);
  ok(gaps.every(g => g >= St.attackInterval(p) - 1e-6), 'one strike per foe per lockout');
}
{ // a strike costs the bell `loss` of its speed (bosses x BOSS_LOSS)
  const { w, p } = stage();
  p.haulIn = true; run(w, 3);
  const b = p.bells[0], v0 = speed(b);
  p.haulIn = false;
  const e = foe(w, b.x + b.vx / 60, b.y + b.vy / 60); // in the bell's path next tick
  w.fx.length = 0;
  for (let i = 0; i < 3 && !w.fx.some(x => x.t === 'bstrike'); i++) w.update(1 / 60);
  ok(w.fx.some(x => x.t === 'bstrike') && speed(b) < v0 * (1 - p.stats.weapon.loss * 0.8), `a strike slows the bell (${v0.toFixed(0)} -> ${speed(b).toFixed(0)})`);
  void e;
}

// ---- the chain: a foe at the hero's feet is struck by the sweeping chain, once a revolution, at the bell's speed; knockback runs along the swing ----
{
  const { w, p } = stage();
  const e = foe(w, p.x + 2, p.y + 1);
  p.haulIn = true; run(w, 3);
  hits.length = 0; w.fx.length = 0;
  run(w, 6, () => { e.x = p.x + 2; e.y = p.y + 1; e.kbx = e.kby = 0; });
  const st = w.fx.filter(x => x.t === 'bstrike'), m = ED.Bell.model(p.stats, 1, St.attackInterval(p), ED.Bell.rateGain(p)), rev = speed(p.bells[0]) / (2 * Math.PI * ED.Bell.orbit(p.stats.weapon));
  ok(st.length > 0 && st.every(x => x.c === 1), `a foe over the hero is struck by the chain (${st.length} chain strikes)`);
  ok(Math.abs(st.length / 6 - Math.min(rev, 1 / St.attackInterval(p))) < 0.35, `the chain strikes it once a revolution (${(st.length / 6).toFixed(2)}/s, ${rev.toFixed(2)} revolutions/s)`);
  const wh = hits.filter(h => h.e === e && h.src.kind === 'weapon');
  ok(wh.length === st.length && wh.every((h, i) => Math.abs(h.d - p.stats.weapon.dmg * U.clamp(st[i].v / C.BELL_REF, 0.4, 1.8) * p.stats.dmg) < 0.02 * h.d), 'a chain strike deals the bell strike of its speed');
  const h0 = wh[0].src, rx = h0.x - p.x, ry = h0.y - p.y, dot = Math.abs(h0.kx * rx + h0.ky * ry) / (Math.hypot(rx, ry) || 1); // the bell's place at the strike: the swing is across the chain
  ok(dot < 0.15, `knockback runs along the swing, across the chain (cos to the chain ${dot.toFixed(2)})`);
  void m;
}

// ---- walls: a free bell bounces off a wall, a hauled bell whirls over it ----
{
  const { w, p } = stage();
  const D = ED.Dungeon;
  let wx = p.x; while (!D.blocksShots(D.tileAt(w.room, wx, p.y), false) && wx < p.x + 600) wx += 4;
  p.x = wx - 60; p.lpx = p.x; w.update(1 / 60);
  const b = p.bells[0];
  b.x = p.x + 30; b.y = p.y; b.vx = 500; b.vy = 0; p.haulIn = false;
  run(w, 0.25);
  ok(b.vx < 0 && !D.blocksShots(D.tileAt(w.room, b.x, b.y), false), 'a free bell bounces off a wall');
  p.haulIn = true; run(w, 3);
  ok(speed(b) > C.BELL_REF, `a hauled bell beside a wall keeps its speed (${speed(b).toFixed(0)})`);
}

// ---- Heave: strike on the way out, reel on the way back, part ids; Wrecker smash; Tether Hook ----
{
  const { w, p } = stage();
  const e = foe(w, p.x + 100, p.y);
  hits.length = 0;
  w.playerSkill(p, 0, {}, 0); run(w, 1.5);
  const parts = hits.filter(h => h.e === e).map(h => h.src.part);
  ok(parts.filter(x => x === 'heave.strike').length === 1 && parts.filter(x => x === 'heave.reel').length === 1, 'Heave strikes once out and reels once back: ' + parts.join(','));
  const N = St.skillNums('heave', p.stats), h = hits.find(x => x.src.part === 'heave.strike');
  near(h.d, N.p.strike.dmg * p.stats.dmg, 0.6, 'Heave strike damage');
  ok(!p.heave, 'the Heave ends');
}
{
  const { w, p } = stage({ b_s1: 1, b_s1_a: 2 });
  const e = foe(w, p.x + 150, p.y), e2 = foe(w, p.x + 300, p.y + 40);
  hits.length = 0;
  w.playerSkill(p, 0, {}, 0); run(w, 1.5);
  ok(hits.some(h => h.e === e && h.src.part === 'heave.smash') && e.stunCd > 0, 'Wrecker smashes where the flight ends and Ground Breaker stuns');
  void e2;
}
{
  const { w, p } = stage({ b_s1: 1, b_s1_b: 3 });
  const e = foe(w, p.x + 130, p.y);
  w.playerSkill(p, 0, {}, 0); run(w, 1.2);
  const d = Math.hypot(e.x - p.x, e.y - p.y);
  ok(d < p.stats.weapon.chain + 10 && e.stun > 0 && e.slowT > 0 && e.weakT > 0 && !e.hookedBy, `Tether Hook reels the foe in (130 -> ${d.toFixed(0)}), stuns and Shackles it`);
  ok(p.shield > 0, 'a hook shields the hero');
}

// ---- Peal: a wave around the bell, x PEAL_REST at rest, full at speed; stuns foes, never bosses; Thunderclap discharges ----
{
  const one = (fast, boons, type) => {
    const { w, p } = stage(boons);
    run(w, 0.05);
    const b = p.bells[0];
    if (fast) { b.vx = 0; b.vy = C.BELL_REF + 100; }
    const e = foe(w, b.x + 40, b.y, type);
    hits.length = 0; w.fx.length = 0;
    w.playerSkill(p, 0, {}, 1);
    const h = hits.find(x => x.e === e && x.src.part === 'peal.wave');
    run(w, 0.1);
    return { w, p, e, h, b };
  };
  const slow = one(false), fast = one(true), N = St.skillNums('peal', fast.p.stats);
  ok(fast.h && slow.h, 'the Peal hit carries the part id peal.wave');
  near(fast.h.d / slow.h.d, 1 / C.PEAL_REST, 0.02, 'a Peal at rest deals PEAL_REST of one at full swing');
  ok(speed(fast.b) < 1, 'the Peal stops the bell dead');
  ok(fast.e.stun > 0 || fast.e.stunCd > 0, 'the Peal stuns a foe');
  near(fast.h.base, N.p.wave.dmg, 0.01, 'Peal damage at full swing');
  const boss = one(true, {}, 'bonewarden');
  ok(boss.h && !(boss.e.stun > 0), 'the Peal never stuns a boss');
  const clap = one(true, { b_s2: 1, b_s2_a: 1 });
  ok(hits.some(x => x.e === clap.e && x.src.kind === 'chain'), 'Thunderclap discharges the foes the Peal charged');
}

// ---- whirl guard: WHIRL_DR less damage while hauling a bell at strike speed ----
{
  const { w, p } = stage();
  const e = foe(w, p.x + 200, p.y);
  const take = (whirl) => { p.invuln = 0; p.hp = p.maxHp; p.bellWhirl = whirl; w.hurtPlayer(p, 10, { e }); return p.maxHp - p.hp; };
  const plain = take(false), guard = take(true);
  ok(guard < plain && Math.abs(guard / plain - (1 - C.WHIRL_DR)) < 0.15, `the whirl guard cuts damage taken (${plain} -> ${guard})`);
  p.haulIn = true; run(w, 2);
  ok(p.bellWhirl === true, 'hauling at speed raises the guard');
}

// ---- forks: bell weapons stay bells, nominal 1.1x, Heavy strikes Stagger ----
for (const base of ['bronzebell', 'greatbell', 'handbells', 'stormbell', 'wreckbell', 'chimes']) for (const fk of ['b_atk_h', 'b_atk_s']) {
  const b = ED.WEAPONS[base], f = ED.forkWeapon(base, fk);
  ok(f.kind === 'bell' && (f.n || 1) === (b.n || 1) && Math.abs(f.dmg / f.rate - 1.1 * b.dmg / b.rate) < 0.02 * b.dmg / b.rate && f.name !== b.name, `${base}@${fk}: a bell fork at 1.1x nominal (${f.name})`);
}
{
  const { w, p } = stage({ b_atk: 1, b_atk_h: 1 });
  const e = foe(w, p.x + ED.Bell.orbit(p.stats.weapon), p.y);
  const ex = e.x, ey = e.y;
  let stag = false;
  p.haulIn = true; run(w, 3, () => { e.x = ex; e.y = ey; e.kbx = e.kby = 0; if (e.staggerT > 0) stag = true; });
  ok(p.stats.heavy && stag, 'Wrecking Ball strikes Stagger');
}

// ---- strike budget and finite state: a brawl with every route card at rank 3 ----
for (const set of [{ b_atk: 1, b_atk_h: 3, b_s1: 1, b_s1_a: 3, b_s2: 1, b_s2_a: 3, b_el: 1, b_el_a: 3 }, { b_atk: 1, b_atk_s: 3, b_s1: 1, b_s1_b: 3, b_s2: 1, b_s2_b: 3, b_el: 1, b_el_b: 3 }]) for (const wid of ['bronzebell', 'chimes']) {
  const { w, p } = stage(set, { weapon: wid });
  for (let i = 0; i < 40; i++) { const a = i / 40 * U.TAU, r = 30 + (i % 4) * 14; const e = foe(w, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); e.maxHp = e.hp = 400; }
  p.haulIn = true; w.fx.length = 0;
  let err = null, peak = 0, last = 0, cnt = 0, all = 0;
  try {
    run(w, 12, () => {
      if (w.time % 3 < 1 / 60) w.playerSkill(p, w.time, {}, 0);
      if (w.time % 5 < 1 / 60) w.playerSkill(p, 0, {}, 1);
      const k = w.fx.filter(x => x.t === 'bstrike').length; cnt += k; all += k; w.fx.length = 0;
      if (w.time - last >= 1) { peak = Math.max(peak, cnt); cnt = 0; last = w.time; }
    });
  } catch (x) { err = x; }
  ok(!err, `${wid} brawl runs${err ? ': ' + err.stack : ''}`);
  const fin = p.bells.every(b => [b.x, b.y, b.vx, b.vy].every(Number.isFinite)) && Number.isFinite(p.hp) && w.enemies.every(e => Number.isFinite(e.hp) && Number.isFinite(e.x));
  ok(fin, `${wid} brawl: no NaN in bells, hero or foes`);
  ok(all / 12 <= C.BELL_HITS && peak <= C.BELL_HITS * 1.1, `${wid} brawl: at most BELL_HITS strikes a second (mean ${(all / 12).toFixed(1)}, peak ${peak} with the 0.1 s burst)`);
}

ED.World.prototype.hitEnemy = oHit;
console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
