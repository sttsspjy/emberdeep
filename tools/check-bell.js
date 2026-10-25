// Usage: node tools/check-bell.js
// Headless checks of the Bellwarden (src/sim/class-bell.js) in staged rooms: determinism, the wind (orbit, hero speed, winding strikes are no attacks), the hurl threshold and flight, the anchored bell in the world frame,
// the reel (tap, drag, bosses), juggling, the snaps home (room change, downed, boss phase), Resonance (none from horde foes) and the Peal, an interactable in range never hurls, Anchor Leap, the variants,
// every evolution held through a loop and finite state through a brawl with every route card. Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
const C = ED.CONST, S = ED.Bell.STATES;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
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
const hits = [];
const oHit = ED.World.prototype.hitEnemy;
ED.World.prototype.hitEnemy = function (e, base, src) { const d = oHit.call(this, e, base, src); hits.push({ e, d, src: src || {}, t: this.time }); return d; };
const wind = (p) => Math.max(0, ...p.bells.filter(b => b.s === S.HAND).map(b => ED.Bell.windOf(p.stats, b)));
const evs = (w, t) => w.fx.filter(f => f.t === t);
// winds until ED.Bell.ready (at most 3 s), aims at (x, y) and releases for one tick; returns the wind it released at
function hurlAt(w, p, x, y) {
  p.haulIn = true;
  for (let i = 0; i < 180 && !ED.Bell.ready(w, p); i++) w.update(1 / 60);
  const v = wind(p);
  p.aimX = x; p.aimY = y; p.face = Math.atan2(y - p.y, x - p.x); p.haulIn = false; w.update(1 / 60);
  return v;
}
const flyOut = (w, p) => { for (let i = 0; i < 60 && p.bells.some(b => b.s === S.FLY); i++) w.update(1 / 60); };
const walk = (w, p) => () => ED.Sim.movePlayer(p, { mx: 0, my: 0 }, 1 / 60, w.room, w.locked, w.zones); // the hero's own movement (its skill move): the controlling machine runs it
const tap = (w, p) => { p.haulPress = (p.haulPress | 0) + 1; w.update(1 / 60); };

// ---- determinism: the same seed and inputs give the same bells and foes through wind, hurl and reel ----
{
  const sim = () => {
    const { w, p } = stage();
    for (let i = 0; i < 6; i++) foe(w, p.x + 30 + 18 * i, p.y + (i - 3) * 12);
    for (let k = 0; k < 3; k++) { hurlAt(w, p, p.x + 150, p.y); flyOut(w, p); tap(w, p); run(w, 0.5); }
    return JSON.stringify({ b: p.bells.map(b => [b.x, b.y, b.vx, b.vy, b.s]), hp: w.enemies.map(e => e.hp), r: p.bellRes });
  };
  ok(sim() === sim(), 'the bell physics is deterministic');
}

// ---- wind: full within 1.5 s from rest, the orbit, the hero at WIND_MOVE (Slipstream: full speed), winding strikes are no attacks ----
{
  const { w, p } = stage();
  const m0 = ED.Stats.moveRate(p);
  p.haulIn = true; run(w, 1.5);
  ok(wind(p) >= 1, `wound for 1.5 s the bell is at full wind (${wind(p).toFixed(2)})`);
  const r = Math.hypot(p.bells[0].x - p.x, p.bells[0].y - p.y), O = ED.Bell.orbit(p.stats.weapon);
  ok(Math.abs(r - O) < 6, `the wound bell orbits at ORBIT_K of the chain (${r.toFixed(0)} vs ${O.toFixed(0)})`);
  ok(Math.abs(ED.Stats.moveRate(p) - m0 * C.WIND_MOVE) < 1e-6, 'the hero moves at WIND_MOVE while winding');
  const s2 = stage({ b_atk: 1, b_atk_s: 2 });
  s2.p.haulIn = true; run(s2.w, 0.5);
  const mw = ED.Stats.moveRate(s2.p); s2.p.haulNear = true; s2.p.haulIn = false; s2.w.update(1 / 60);
  ok(s2.p.stats.slipstream > 0 && Math.abs(mw - ED.Stats.moveRate(s2.p)) < 1e-6, 'Slipstream keeps full speed while winding');
  const s3 = stage(), O3 = ED.Bell.orbit(s3.p.stats.weapon), e = foe(s3.w, s3.p.x + O3, s3.p.y);
  s3.p.haulIn = true; hits.length = 0;
  const a0 = s3.p.atkCount | 0;
  run(s3.w, 3, () => { e.x = s3.p.x + O3; e.y = s3.p.y; });
  const ws = hits.filter(h => h.src.part === 'bell.wind');
  ok(ws.length >= 3, `winding strikes land on a foe on the orbit (${ws.length})`);
  ok((s3.p.atkCount | 0) === a0, 'winding strikes never advance the attack count');
  ok(ws.every(h => h.src.mul <= C.WIND_CAP + 1e-9), 'a winding strike deals at most WIND_CAP');
}

// ---- the hurl: below WIND_GO a release drops the bell; at or above it the bell flies HURL_D x wind, strikes the foe on its path, lands anchored; an attack; the event ----
{
  const { w, p } = stage();
  p.haulIn = true; run(w, 0.05); p.haulIn = false; w.update(1 / 60);
  ok(p.bells[0].s === S.HAND, `a release under WIND_GO wind drops the bell (wind ${wind(p).toFixed(2)})`);
  const e = foe(w, p.x + 60, p.y), a0 = p.atkCount | 0; hits.length = 0; w.fx.length = 0;
  const v = hurlAt(w, p, p.x + 400, p.y);
  ok(p.bells[0].s === S.FLY && (p.atkCount | 0) === a0 + 1, `a release at wind ${v.toFixed(2)} hurls (an attack)`);
  flyOut(w, p);
  const b = p.bells[0], d = Math.hypot(b.x - p.x, b.y - p.y);
  ok(b.s === S.ANCHOR, 'the hurl lands anchored');
  ok(d <= C.HURL_D * v + 2 && d >= C.HURL_D * v - 12, `it flies HURL_D x wind (${d.toFixed(0)} px)`);
  ok(hits.some(h => h.e === e && h.src.part === 'bell.hurl' && h.src.mul >= C.HURL_K * v * v - 1e-6), 'the hurl strikes the foe on its path at HURL_K x wind^2');
  const ev = evs(w, 'hurl')[0];
  ok(ev && ev.pid === 'p0' && ev.k > 0 && Math.abs(ev.x - b.x) <= 1, "the 'hurl' event carries pid, spot and k");
}

// ---- the anchored bell lies in the world frame (no carry) ----
{
  const { w, p } = stage();
  hurlAt(w, p, p.x + 150, p.y); flyOut(w, p);
  const b = p.bells[0], x = b.x, y = b.y;
  for (let i = 0; i < 30; i++) { p.x -= 2; w.update(1 / 60); }
  ok(b.s === S.ANCHOR && Math.abs(b.x - x) < 1e-6 && Math.abs(b.y - y) < 1e-6, 'the anchored bell stays where it landed while the hero walks');
}

// ---- the reel: a tap reels the anchored bell home; it strikes each foe on its line once and drags a non-boss foe toward the hero, at most REEL_DRAG; a boss is not dragged ----
{
  for (const boss of [false, true]) {
    const { w, p } = stage();
    hurlAt(w, p, p.x + 180, p.y); flyOut(w, p);
    const b = p.bells[0], e = foe(w, p.x + 110, b.y, boss ? 'skelknight' : 'skeleton');
    if (boss) e.boss = true;
    const x0 = e.x; hits.length = 0; w.fx.length = 0;
    tap(w, p);
    ok(b.s === S.REEL && evs(w, 'reel').length === 1, `${boss ? 'boss: ' : ''}a tap reels the anchored bell (the 'reel' event)`);
    run(w, 0.6);
    const rs = hits.filter(h => h.e === e && h.src.part === 'bell.reel');
    ok(rs.length === 1, `${boss ? 'boss: ' : ''}the reel strikes the foe on its line once (${rs.length})`);
    ok(boss ? Math.abs(e.x - x0) < 1 : x0 - e.x > 20 && x0 - e.x <= C.REEL_DRAG + 1, `${boss ? 'a boss is not dragged' : 'the foe is dragged toward the hero'} (${(x0 - e.x).toFixed(0)} px)`);
    ok(b.s === S.HAND, `${boss ? 'boss: ' : ''}the reeled bell is home`);
  }
  const { w, p } = stage();
  hurlAt(w, p, p.x + 150, p.y); flyOut(w, p);
  p.haulIn = true; run(w, 0.8);
  ok(p.bells[0].s === S.HAND && wind(p) > 0.5, 'holding while anchored reels the bell and winds it again');
}

// ---- juggle: a release hurls only the most-wound bell; the others keep winding ----
for (const wid of ['handbells', 'chimes']) {
  const { w, p } = stage({}, { weapon: wid });
  hurlAt(w, p, p.x + 150, p.y);
  const fly = p.bells.filter(b => b.s === S.FLY).length, hand = p.bells.filter(b => b.s === S.HAND).length;
  ok(fly === 1 && hand === p.bells.length - 1, `${wid}: one release hurls one bell (${fly} flying, ${hand} in hand)`);
  run(w, C.JUGGLE_T * 0.8);
  ok(p.bells.some(b => b.s === S.HAND && ED.Bell.windOf(p.stats, b) > 0.5), `${wid}: the other bells keep winding`);
}

// ---- snaps home: a room change, the hero downed (ticks missed, or ED.CLS.bell.down), a boss phase change ----
{
  const out = (w, p) => { hurlAt(w, p, p.x + 150, p.y); flyOut(w, p); return p.bells[0].s === S.ANCHOR; };
  let { w, p } = stage();
  out(w, p); p.bellRoom = null; w.update(1 / 60);
  ok(p.bells[0].s === S.HAND, 'a room change brings the bell home');
  ({ w, p } = stage()); out(w, p); p.bellTickT = w.time - 1; w.update(1 / 60);
  ok(p.bells[0].s === S.HAND, 'ticks missed (the hero was down) bring the bell home');
  ({ w, p } = stage()); out(w, p); ED.CLS.bell.down.call(w, p);
  ok(p.bells[0].s === S.HAND, 'ED.CLS.bell.down brings the bell home');
  ({ w, p } = stage());
  const bo = foe(w, p.x - 200, p.y, 'skelknight'); bo.boss = true; bo.phase = 1; w.boss = bo; w.update(1 / 60);
  ok(out(w, p), 'staged: the bell lies anchored beside a boss');
  bo.phase = 2; w.update(1 / 60);
  ok(p.bells[0].s === S.HAND, 'a boss phase change brings the bell home');
}

// ---- Resonance: none from horde foes; +1 per non-horde foe a hurl strikes and +1 for the hurl; the Peal spends it, its factor (>= 1) in p.pealResLast, and rings harder with it ----
{
  let { w, p } = stage();
  const f = foe(w, p.x + 60, p.y); f.fodder = true;
  hurlAt(w, p, p.x + 150, p.y); flyOut(w, p);
  ok((p.bellRes | 0) === 0, `a hurl through a horde foe builds no Resonance (${p.bellRes})`);
  ({ w, p } = stage());
  foe(w, p.x + 60, p.y);
  hurlAt(w, p, p.x + 150, p.y); flyOut(w, p);
  ok((p.bellRes | 0) === 2, `a hurl through one foe builds 2 Resonance (${p.bellRes})`);
  const peal = (res) => {
    const s = stage(), e = foe(s.w, s.p.x + 40, s.p.y);
    s.w.update(1 / 60); s.p.bellRes = res; hits.length = 0;
    s.w.playerSkill(s.p, 0, null, 1); run(s.w, 0.1);
    return { dmg: hits.filter(h => h.e === e && String(h.src.part || '').indexOf('peal') === 0).reduce((a, h) => a + h.d, 0), p: s.p };
  };
  const p0 = peal(0), p10 = peal(C.RES_MAX), want = 1 + C.RES_K * C.RES_MAX;
  ok(p0.dmg > 0 && Math.abs(p10.dmg / p0.dmg - want) < 0.05 * want, `a Peal at full Resonance rings x${want} (${(p10.dmg / Math.max(1, p0.dmg)).toFixed(2)})`);
  ok(p10.p.bellRes === 0 && Math.abs(p10.p.pealResLast - want) < 1e-9 && p0.p.pealResLast === 1, 'the Peal spends Resonance and sets p.pealResLast');
}

// ---- an interactable in range: a release never hurls ----
{
  const { w, p } = stage();
  p.haulIn = true; run(w, 1.5); p.haulNear = true; p.haulIn = false; w.update(1 / 60);
  ok(p.bells[0].s === S.HAND, 'with an interactable in range a release does not hurl');
}

// ---- Anchor Leap: from the hand a short leap; with the bell anchored a yank to it, the bell home after the slam ----
{
  let { w, p } = stage();
  const x0 = p.x; p.aimX = p.x + 300; p.aimY = p.y;
  w.playerSkill(p, 0, null, 0);
  ok(!!p.skillMove && !!p.bellLeap, 'Anchor Leap from the hand leaps');
  run(w, 0.6, walk(w, p));
  ok(p.x - x0 > 40 && p.x - x0 <= C.LEAP_D * (1 + (p.stats.leapR || 0)) + 4, `it lands up to LEAP_D ahead (${(p.x - x0).toFixed(0)} px)`);
  ({ w, p } = stage());
  hurlAt(w, p, p.x + 190, p.y); flyOut(w, p);
  const b = p.bells[0], bx = b.x, by = b.y; p.aimX = bx; p.aimY = by;
  w.playerSkill(p, 0, null, 0); run(w, 0.6, walk(w, p));
  ok(Math.hypot(p.x - bx, p.y - by) < 12 && b.s === S.HAND, `Anchor Leap yanks the hero to the anchored bell and brings it home (${Math.hypot(p.x - bx, p.y - by).toFixed(0)} px off)`);
}

// ---- variants: the Storm Bell rings on a hurl strike; the Wrecking Bell's hurl ricochets off a wall ----
{
  let { w, p } = stage({}, { weapon: 'stormbell' });
  foe(w, p.x + 60, p.y); const e2 = foe(w, p.x + 60, p.y + 24); hits.length = 0;
  hurlAt(w, p, p.x + 61, p.y); flyOut(w, p);
  ok(hits.some(h => h.e === e2 && h.src.part === 'bell.ring'), 'a Storm Bell hurl strike rings the foe beside it');
  ({ w, p } = stage({}, { weapon: 'wreckbell' }));
  const end = ED.Sim.castMove(w.room, p.x, p.y, 0, 3000, p.r, false);
  p.x = end.x - 90; w.update(1 / 60);
  let legs = 0;
  hurlAt(w, p, p.x + 200, p.y);
  for (let i = 0; i < 60 && p.bells[0].s === S.FLY; i++) { w.update(1 / 60); if (p.bells[0].fly) legs = Math.max(legs, p.bells[0].fly.legs); }
  ok(legs >= 1, `a Wrecking Bell hurl into a wall ricochets (${legs} legs)`);
}

// ---- every evolution held: wind, hurl, reel and Peal never throw ----
for (const evo of Object.keys(ED.PATHS)) {
  const { w, p } = stage();
  p.stats.evo = evo; p.shield = 20;
  for (let i = 0; i < 5; i++) foe(w, p.x + 40 + 25 * i, p.y + (i % 2) * 10);
  let err = null;
  try {
    for (let k = 0; k < 3; k++) { hurlAt(w, p, p.x + 150, p.y); flyOut(w, p); tap(w, p); run(w, 0.4); }
    w.playerSkill(p, 0, null, 1); run(w, 0.5);
  } catch (e) { err = e; }
  ok(!err, `the ${evo} evolution through a loop and a Peal${err ? ': ' + err.message : ''}`);
}

// ---- a brawl with every route card at rank 3: finite bells, foes and Resonance ----
{
  const boons = {};
  for (const route of ED.ROUTES) { const e = ED.CLASS_CARDS.bell[route]; boons[e.t1] = 1; for (const f of e.forks) boons[f] = 3; }
  for (const wid of ['bronzebell', 'wreckbell', 'chimes']) {
    const { w, p } = stage(boons, { weapon: wid });
    for (let i = 0; i < 30; i++) { const a = i * 0.7, r = 50 + (i % 6) * 25, e = foe(w, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); e.spd = 40; e.hp = e.maxHp = 400; }
    let rel = false, t = 0, err = null;
    try {
      run(w, 20, () => {
        p.hp = p.maxHp; t++;
        if (rel) { p.haulIn = true; rel = false; } else if (ED.Bell.ready(w, p)) { p.aimX = p.x + 120; p.aimY = p.y + 40; p.face = 0.3; p.haulIn = false; rel = true; } else p.haulIn = true;
        if (t % 300 === 0) w.playerSkill(p, 0.5, null, 0);
        if (t % 420 === 0) w.playerSkill(p, 0, null, 1);
      });
    } catch (e) { err = e; }
    const fin = !err && p.bells.every(b => [b.x, b.y, b.vx, b.vy].every(Number.isFinite)) && w.enemies.every(e => Number.isFinite(e.x) && Number.isFinite(e.hp)) && Number.isFinite(p.bellRes);
    ok(fin, `${wid} with every route card: finite state after a 20 s brawl${err ? ': ' + err.message : ''}`);
  }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
