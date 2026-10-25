// Usage: node tools/check-ranger.js
// Headless checks of the 12 Ranger route cards (riders from rank 2, transforms at rank 3) and the Ranger events against GAME-DESIGN section 5, in staged rooms. Prints failures and exits 1 when any check fails.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ED } = require('./sim.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
const N = ED.Net;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

// A staged room with one Ranger at (60, 212): no foes, no encounter; crit 0 so damage is exact. extra: more heroes ({pid, cls, weapon}).
function stage(boons, wi, extra) {
  const meta = META(), players = [{ pid: 'p0', name: 'T', slot: 0, cls: 'ranger', weapon: ED.CLASSES.ranger.weapons[wi || 0], meta }];
  const w = new ED.World({ seed: 7, pact: 0, players });
  w.startRun();
  for (const x of extra || []) w.addPlayer({ pid: x.pid, name: x.pid, slot: 1, cls: x.cls || 'ranger', weapon: x.weapon || 'longbow', meta: META() });
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  for (const q of w.players.values()) { w.recalc(q, true); q.offers.length = 0; q.picks = 0; q.offer = null; q.stats.crit = 0; }
  w.enemies.length = 0; w.enc = null; w.locked = false;
  p.x = 60; p.y = 212;
  return { w, p };
}
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 5000; return e; };
const run = (w, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.update(1 / 60); if (f) f(); } };
const burn6 = (w, e, p) => { for (let i = 0; i < 6; i++) w.burnStack(e, p, 0); }; // six Burn stacks of p on e
const tap = (w) => { const all = []; return { all, step() { for (const ev of w.fx) all.push(ev); w.fx.length = 0; } }; };
const hit = (w, p, e, base, src) => { const hp = e.hp; w.hitEnemy(e, base, Object.assign({ p }, src)); return hp - e.hp; };
const RAD = (a) => a * Math.PI / 180;

// ---- Fletcher (r_s1): 10 arrows, 20% faster cooldown ----
{
  const { w, p } = stage({ r_s1: 1 });
  near(ED.Stats.skillNums('volley', p.stats).p.arrow.n, 10, 0, 'Fletcher: 10 arrows'); near(p.stats.skillCd, 4, 1e-9, 'Fletcher: Volley cooldown 4 s');
  w.projs.length = 0; w.playerSkill(p, 0, {}, 0);
  const arrows = w.projs.filter(q => q.part === 'volley.arrow');
  ok(arrows.length === 10, `Volley fires 10 arrows (got ${arrows.length})`);
  near(arrows[0].dmg, 18.4, 0.06, 'Volley arrow 18.4'); near(arrows[9].vy / arrows[9].vx, Math.tan(0.6), 1e-6, 'fan spans 1.2 rad');
  ok(!ED.Stats.skillNums('volley', stage({}).p.stats).move, 'no hop without Scattershot');
}

// ---- Deadeye (r_atk): shots grow with distance flown, far-shot flag from 75% of the ramp, weapon shots only ----
{
  const { w, p } = stage({ r_atk: 1 }); const e = foe(w, 300, 212), wp = { kind: 'weapon', wpn: true };
  const d = (dist, src) => hit(w, p, e, 100, Object.assign({ dist }, wp, src)); w.fx.length = 0;
  near(d(80), 100, 1e-6, 'Deadeye +0% at 80'); near(d(170), 120, 1e-6, 'Deadeye +20% at 170'); near(d(260), 140, 1e-6, 'Deadeye +40% at 260'); near(d(500), 140, 1e-6, 'Deadeye stops at +40%'); near(d(40), 100, 1e-6, 'Deadeye: nothing close');
  const far = w.fx.filter(ev => ev.t === 'hit' && ev.f).length; ok(far === 2, `far-shot flag on hits at >= 75% of the ramp (got ${far})`);
  near(hit(w, p, e, 100, { kind: 'skill', part: 'volley.arrow', dist: 300 }), 100, 1e-6, 'Deadeye: Volley arrows are not weapon shots');
  near(hit(w, p, e, 100, { kind: 'weapon', wpn: false, dist: 300 }), 100, 1e-6, 'Deadeye: twin and spectral repeats are not weapon hits');
  // a real arrow flying 246 px
  w.fx.length = 0; e.x = 60 + 270; e.hp = 5000; const hp0 = e.hp; w.playerAttack(p, 0); run(w, 1);
  const hv = w.fx.find(ev => ev.t === 'hit' && ev.pid === 'p0');
  ok(hv && hv.f === 1, 'a real far arrow carries the far-shot flag'); near(hp0 - e.hp, 12 * (1 + 0.3 * (246 - 80) / 180), 1.2, 'a real far arrow deals the ramped damage');
  const near1 = stage({ r_atk: 1 }); const e2 = foe(near1.w, 60 + 70, 212); near1.w.playerAttack(near1.p, 0); run(near1.w, 0.6); near(5000 - e2.hp, 11, 1e-6, 'a close arrow deals the plain 11');
}

// ---- Ballista (r_atk_h): heavy shots, +28% speed, +2 pierce, +15% per foe passed, Splitting Bolt from rank 2, Siege Ballista at rank 3 ----
{
  const { w, p } = stage({ r_atk: 1, r_atk_h: 1 }), wp = p.stats.weapon;
  near(wp.speed, 396 * 1.28, 0.01, 'Ballista speed x1.28 over the heavy bow'); near(wp.pierce, 2, 0, 'Ballista: +2 pierce'); ok(p.stats.heavy, 'Ballista is a Heavy fork');
  near(stage({ r_atk_h: 1 }, 1).p.stats.weapon.pierce, 4, 0, 'Arbalest keeps its pierce and gains 2');
  const e = foe(w, 300, 212); const ramp = (pass) => hit(w, p, e, 100, { kind: 'weapon', wpn: true, pass });
  near(ramp(0), 100, 1e-6, 'pierce ramp: first foe plain'); near(ramp(1), 115, 1e-6, 'pierce ramp +15%'); near(ramp(2), 130, 1e-6, 'pierce ramp +30%');
  near(hit(w, p, e, 100, { kind: 'skill', part: 'volley.arrow', pass: 2 }), 100, 1e-6, 'pierce ramp: weapon shots only');
  const r2 = stage({ r_atk_h: 2 }); near(r2.p.stats.pierceRamp, 0.25, 1e-9, 'rank 2: +10% per foe'); near(r2.p.stats.deadeye, 0.05, 1e-9, 'rank 2: Deadeye +5%');
  // a real shot through a line of foes: 100%, 115%, 130% of the first hit
  const L = stage({ r_atk_h: 1 }), es = [90, 120, 150].map(x => foe(L.w, x, 212)), ev0 = tap(L.w);
  L.w.playerAttack(L.p, 0); run(L.w, 0.7, ev0.step);
  const dm = es.map(f => 5000 - f.hp); near(dm[1] / dm[0], 1.15, 1e-6, 'a real shot: +15% on the second foe'); near(dm[2] / dm[0], 1.3, 1e-6, 'a real shot: +30% on the third foe'); ok(!ev0.all.some(v => v.t === 'split'), 'no Splitting Bolt below rank 2');
}
{ // Splitting Bolt (rank 2): pierce spent on the third foe, two arrows +-0.3 rad at 50%, short, no pierce, never split again, no second hit on the same foe
  const { w, p } = stage({ r_atk_h: 2 }), es = [90, 120, 150].map(x => foe(w, x, 212)), side = foe(w, 195, 150), evs = tap(w);
  w.playerAttack(p, 0); const main = w.projs.find(q => q.team === 0); const dmg0 = main.dmg;
  let kids = null, seen = 0;
  for (let i = 0; i < 90 && !kids; i++) { w.update(1 / 60); evs.step(); const c = w.projs.filter(q => q.noSplit); if (c.length) kids = c; }
  ok(kids && kids.length === 2, 'Splitting Bolt: two arrows when the third foe is struck');
  if (kids) {
    near(kids[0].dmg, dmg0 * 0.5, 1e-6, 'split arrows at 50%'); ok(kids[0].pierce === 0 && kids[0].life <= 0.4 + 1e-9 && kids[0].noSplit, 'split arrows: no pierce, life 0.4, no further split');
    near(Math.abs(Math.atan2(kids[0].vy, kids[0].vx) - Math.atan2(kids[1].vy, kids[1].vx)), 0.6, 0.02, 'split arrows fan +-0.3 rad');
    ok(kids[0].hit.has(es[2].id) && kids[0].hit.has(es[0].id), 'split arrows do not hit the foes the shot already struck');
  }
  run(w, 0.6, evs.step); ok(evs.all.filter(v => v.t === 'split').length === 1, 'one split event'); ok(evs.all.filter(v => v.t === 'hit' && !v.k).length === 3, 'the line is hit once each, the split arrows hit nobody they already passed');
  near(5000 - es[2].hp, dmg0 * 1.5, 1e-6, 'rank 2 pierce ramp +25% per foe'); void side; void seen;
  const two = stage({ r_atk_h: 2 }); [90, 120].forEach(x => foe(two.w, x, 212)); const t2 = tap(two.w); two.w.playerAttack(two.p, 0); run(two.w, 0.8, t2.step); ok(!t2.all.some(v => v.t === 'split'), 'no split while the shot still has pierce');
  near(stage({ r_atk_h: 2 }).p.stats.splitBolt, 0.5, 1e-9, 'rank 2: Splitting Bolt 50%'); near(stage({ r_atk_h: 3 }).p.stats.splitBolt, 0.5, 1e-9, 'rank 3 keeps it'); ok(!stage({ r_atk_h: 1 }).p.stats.splitBolt, 'no Splitting Bolt at rank 1');
}

// ---- Quickdraw (r_atk_s): swift shots, +7% damage, 15% slow for 1 s (not bosses), Flurry every 4th shot from rank 2, Storm Bow at rank 3 ----
{
  const { w, p } = stage({ r_atk_s: 1 }), wp = p.stats.weapon;
  ok(p.stats.swift, 'Quickdraw is a Swift fork'); near(wp.dmg, 6.655 * 1.07, 0.01, 'Quickdraw: +7% weapon damage'); near(p.stats.atkInterval, 0.187, 0.002, 'Quickdraw: x0.55 interval');
  const e = foe(w, 300, 212), b = foe(w, 330, 212); b.boss = true; const evs = tap(w); w.fx.length = 0;
  hit(w, p, e, 10, { kind: 'weapon', wpn: true }); near(e.slowAmt, 0.15, 1e-9, 'weapon hit slows 15%'); near(e.slowT, 1, 1e-9, 'for 1 s'); ok(w.fx.some(v => v.t === 'hit' && v.sl === 1), 'the hit event carries the slow flag');
  hit(w, p, b, 10, { kind: 'weapon', wpn: true }); ok(!(b.slowT > 0), 'bosses are not slowed');
  const e2 = foe(w, 360, 212); hit(w, p, e2, 10, { kind: 'skill', part: 'volley.arrow' }); ok(!(e2.slowT > 0), 'skills do not slow'); void evs;
  const r2 = stage({ r_atk_s: 2 }).p.stats; near(r2.wDmg, 0.12, 1e-9, 'rank 2: +5% damage (7% + 5%)'); near(r2.deadeye, 0.05, 1e-9, 'rank 2: Deadeye +5%');
}
{ // Flurry (rank 2): every 4th attack fires two more arrows +-0.12 rad
  const { w, p } = stage({ r_atk_s: 2 }); near(p.stats.flurry, 4, 0, 'rank 2: every 4th shot'); const counts = [], ang = [];
  for (let i = 0; i < 8; i++) { w.projs.length = 0; w.playerAttack(p, 0.3); const sh = w.projs.filter(q => q.team === 0); counts.push(sh.length); if (i === 3) for (const q of sh) ang.push(Math.atan2(q.vy, q.vx)); }
  ok(counts.join() === '1,1,1,3,1,1,1,3', `Flurry fires 2 extra arrows on every 4th shot (got ${counts.join()})`);
  ang.sort((a, b) => a - b); near(ang[0], 0.18, 1e-6, 'Flurry: -0.12 rad'); near(ang[1], 0.3, 1e-6, 'Flurry: the aimed arrow'); near(ang[2], 0.42, 1e-6, 'Flurry: +0.12 rad');
  w.projs.length = 0; p.atkCount = 3; w.playerAttack(p, 0); const sh = w.projs.filter(q => q.team === 0); ok(sh.every(q => Math.abs(q.dmg - p.stats.weapon.dmg) < 1e-9 && q.wpn), 'Flurry arrows are weapon arrows'); near(p.stats.flurryMul, 0.45, 1e-9, 'Flurry arrows deal 45% of a shot'); ok(sh.filter(q => Math.abs((q.mul || 1) - 0.45) < 1e-9).length === 2 && sh.filter(q => !q.mul).length === 1, 'the two extra arrows carry the 45% multiplier, the aimed arrow none');
  const tb = stage({ r_atk_s: 2 }, 2); tb.p.atkCount = 3; tb.w.projs.length = 0; tb.w.playerAttack(tb.p, 0); ok(tb.w.projs.filter(q => q.team === 0).length === 4, 'Twin Flatbows: the pair plus two Flurry arrows');
  const noF = stage({ r_atk_s: 1 }); noF.p.atkCount = 3; noF.w.projs.length = 0; noF.w.playerAttack(noF.p, 0); ok(noF.w.projs.filter(q => q.team === 0).length === 1, 'no Flurry at rank 1');
}
{ // Flurry arrows go through W.fireWeapon: evolution riders, homing and extra projectiles match the aimed arrow
  const shots = (boons, setup, after) => { const s = stage(boons); setup(s.p.stats); s.p.atkCount = 3; s.w.projs.length = 0; s.w.playerAttack(s.p, 0); if (after) after(s.w); return s.w.projs.filter(q => q.team === 0); };
  const rider = (q) => JSON.stringify([!!q.explode, !!q.spec, q.homing, q.burn, q.pierce, q.dmg, q.knock, q.r, q.speed]);
  for (const evo of ['fire', 'general']) {
    const sh = shots({ r_atk_s: 2 }, (st) => { st.evo = evo; });
    ok(sh.length === 3 && sh.every(q => rider(q) === rider(sh[0])), `Flurry arrows carry the ${evo} evolution rider of the aimed arrow`);
    ok(evo !== 'general' || sh.every(q => q.spec), 'Spectral Arms: every Flurry arrow can release a spectral copy');
  }
  for (const pn of [1, 2]) {
    const sh = shots({ r_atk_s: 2 }, (st) => { st.projN = pn; });
    ok(sh.length === pn + 3, `Split Shot +${pn}: the aimed fan of ${pn + 1} plus two Flurry arrows (got ${sh.length})`);
  }
  const hm = shots({ r_atk_s: 2 }, (st) => { st.homing = 3; }); ok(hm.length === 3 && hm.every(q => q.homing === 3), 'homing applies to the Flurry arrows');
}

// ---- Hunter's Mark (r_s1_a): Volley marks foes 4 s, +12% from everyone, strongest value wins, Relentless Hunt at rank 3 ----
{
  const { w, p } = stage({ r_s1: 1, r_s1_a: 1 }, 0, [{ pid: 'p1' }]); const q1 = w.players.get('p1');
  const es = [foe(w, 130, 212), foe(w, 160, 212), foe(w, 130, 180)], clean = foe(w, 200, 60);
  w.playerSkill(p, 0, {}, 0); run(w, 0.45);
  ok(es.every(e => e.mark > 3.4 && e.mark <= 4), 'every foe the Volley hit is marked for 4 s'); ok(es.every(e => Math.abs(e.markV - 0.12) < 1e-9 && e.markBy === 'p0'), 'with the 12% value and its owner');
  ok(!(clean.mark > 0), 'a foe the Volley missed is not marked');
  const dm = (e, who) => hit(w, who, e, 100, { kind: 'weapon' });
  const a = es[0], base = dm(clean, q1); near(dm(a, q1) / base, 1.12, 1e-6, 'marked foes take +12% from another hero'); near(dm(a, p) / base, 1.12, 1e-6, 'and from the Ranger');
  // strongest value wins, never adds
  a.markV = 0.2; a.mark = 1; a.markBy = 'p1'; ED.CLS.ranger.hitDone.call(w, p, a, 1, false, { part: 'volley.arrow' }); near(a.markV, 0.2, 1e-9, 'a weaker mark never lowers the value'); near(a.mark, 4, 1e-9, 'but refreshes the time');
  ok(w.hitEnemy && N.encodeSnap(w, [], false).E.some(r => (r[7] >> 19) & 1), 'the Marked flag (1 << 19) is on the wire');
  near(stage({ r_s1_a: 2 }).p.stats.markV, 0.16, 1e-9, 'rank 2: +16%'); ok(!stage({ r_s1_a: 1 }).p.stats.markLeap, 'no Relentless Hunt at rank 1'); near(stage({ r_s1_a: 2 }).p.stats.markLeap, 1, 0, 'rank 2: Relentless Hunt'); near(stage({ r_s1_a: 3 }).p.stats.markLeap, 1, 0, 'rank 3 keeps it');
}
{ // Relentless Hunt: a marked foe's death marks the nearest unmarked foe within 120 (fresh time, owner's value), only with the rider, never onto marked or far foes
  const { w, p } = stage({ r_s1: 1, r_s1_a: 2 }); const evs = tap(w);
  const a = foe(w, 200, 212), near1 = foe(w, 270, 212), nearer = foe(w, 240, 160), far = foe(w, 200, 340), marked = foe(w, 250, 250);
  for (const e of [a, marked]) { e.mark = 3; e.markV = 0.5; e.markBy = 'p0'; }
  hit(w, p, a, 1e9, { kind: 'weapon' }); evs.step();
  ok(nearer.mark > 3.9 && !(near1.mark > 0) && !(far.mark > 0), `the mark leaps to the nearest unmarked foe (nearer ${nearer.mark.toFixed(2)}, other ${near1.mark.toFixed(2)})`);
  near(nearer.markV, 0.16, 1e-9, 'the leaped mark carries the owner value (rank 2: 16%)'); near(marked.mark, 3, 1e-9, 'an already marked foe is left alone'); ok(evs.all.filter(v => v.t === 'hunt').length === 1, 'one hunt event');
  const h = evs.all.find(v => v.t === 'hunt'); ok(h && Math.abs(h.x1 - 240) < 1 && h.pid === 'p0', 'the hunt event runs from the dead foe to the new mark');
  const lone = stage({ r_s1: 1, r_s1_a: 2 }); const k = foe(lone.w, 200, 212), e2 = foe(lone.w, 200 + 135, 212); k.mark = 2; k.markV = 0.2; k.markBy = 'p0'; hit(lone.w, lone.p, k, 1e9, { kind: 'weapon' });
  ok(!(e2.mark > 0), 'nothing within 120: no leap'); ok(lone.w.fx.filter(v => v.t === 'hunt').length === 0, 'no hunt event without a target');
  const ch = stage({ r_s1: 1, r_s1_a: 2 }); const c1 = foe(ch.w, 300, 212), c2 = foe(ch.w, 360, 212), c3 = foe(ch.w, 420, 212); c1.mark = 3; c1.markV = 0.12; c1.markBy = 'p0';
  hit(ch.w, ch.p, c1, 1e9, { kind: 'weapon' }); ok(c2.mark > 0 && !(c3.mark > 0), 'the leap lands on the next foe only'); hit(ch.w, ch.p, c2, 1e9, { kind: 'weapon' }); ok(c3.mark > 0, 'a leaped mark leaps again');
  const lo = stage({ r_s1: 1, r_s1_a: 1 }), x = foe(lo.w, 200, 212), y = foe(lo.w, 250, 212); x.mark = 3; x.markV = 0.16; x.markBy = 'p0'; hit(lo.w, lo.p, x, 1e9, { kind: 'weapon' }); ok(!(y.mark > 0), 'rank 2 has no leap');
  const co = stage({ r_s1: 1, r_s1_a: 2 }, 0, [{ pid: 'p1' }]), xa = foe(co.w, 200, 212), xb = foe(co.w, 250, 212); xa.mark = 2; xa.markV = 0.2; xa.markBy = 'p0'; hit(co.w, co.w.players.get('p1'), xa, 1e9, { kind: 'weapon' }); ok(xb.mark > 0, 'a kill by an ally still leaps the Rangers mark');
}

// ---- Scattershot (r_s1_b): +40% within 110 and triple knockback, a 70 px hop, Caltrops at rank 3 ----
{
  const { w, p } = stage({ r_s1: 1, r_s1_b: 1 }); const e = foe(w, 300, 212), mv = ED.Stats.skillNums('volley', p.stats).move;
  ok(mv && mv.k === 'hop' && mv.dist === 70 && mv.dir === -1 && mv.t === 0.25 && mv.iframes === 0.25, 'Volley hops 70 px back over 0.25 s with 0.25 s of i-frames');
  const sh = (dist) => { e.kbx = e.kby = 0; const d = hit(w, p, e, 10, { kind: 'skill', part: 'volley.arrow', dist, knock: 60, kx: 1, ky: 0 }); return [d, e.kbx]; };
  let r = sh(50); near(r[0], 14, 1e-6, 'Scattershot +40% close'); near(r[1], 180, 1e-6, 'and triple knockback'); r = sh(109); near(r[0], 14, 1e-6, 'close up to 110');
  r = sh(111); near(r[0], 10, 1e-6, 'plain beyond 110'); near(r[1], 60, 1e-6, 'plain knockback beyond 110');
  e.slowT = 0; e.slowAmt = 0; sh(50); near(e.slowAmt, 0.3, 1e-9, 'every Volley arrow slows its foe 30%'); near(e.slowT, 1.2, 1e-9, 'for 1.2 s'); const bsl = foe(w, 340, 212); bsl.boss = true; hit(w, p, bsl, 10, { kind: 'skill', part: 'volley.arrow', dist: 50 }); near(bsl.slowAmt, 0.15, 1e-9, 'bosses are slowed half as much'); const wsl = foe(w, 360, 212); hit(w, p, wsl, 10, { kind: 'weapon', wpn: true, dist: 50 }); ok(!(wsl.slowT > 0), 'weapon shots do not slow'); void wsl;
  near(stage({ r_s1_b: 2 }).p.stats.volleyClose, 0.5, 1e-9, 'rank 2: +10% close bonus'); ok(!stage({ r_s1_b: 1 }).p.stats.caltrops && stage({ r_s1_b: 2 }).p.stats.caltrops, 'Caltrops come with rank 2');
  w.projs.length = 0; w.zones.length = 0; w.playerSkill(p, 0, {}, 0); ok(!w.zones.some(z => z.kind === 'shards'), 'no caltrops without the rider');
}
{ // Caltrops: where the hero stood, r 50, 2.5 s, slow 40%, 30% of a Volley arrow per second (the volley.caltrops part)
  const { w, p } = stage({ r_s1: 1, r_s1_b: 2 }); const inside = foe(w, 60 + 30, 212), outside = foe(w, 60 + 90, 212), x0 = p.x, y0 = p.y; w.zones.length = 0;
  const cp = ED.Stats.skillNums('volley', p.stats).p; near(cp.caltrops.dmg, cp.arrow.dmg * 0.3, 1e-9, 'the caltrops part is 30% of a Volley arrow per second');
  w.playerSkill(p, Math.PI, {}, 0); w.projs.length = 0; const z = w.zones.find(q => q.kind === 'shards'); // aimed at the wall: the arrows stay out of the way
  ok(z && z.x === x0 && z.y === y0 && z.r === 50 && z.dur === 2.5 && z.team === 0 && z.part === 'volley.caltrops', 'a shards zone on the hero feet, r 50, 2.5 s'); near(z.dps, cp.caltrops.dmg, 1e-9, 'Caltrops deal the part damage per second');
  p.x = 400; run(w, 1.0); near(inside.slowAmt, 0.4, 1e-9, 'foes inside are slowed 40%'); ok(!(outside.slowT > 0), 'foes outside are not'); run(w, 2.2);
  near(5000 - inside.hp, cp.caltrops.dmg * 2.5, 0.5, 'Caltrops deal their dps for 2.5 s'); ok(outside.hp === 5000, 'foes outside take nothing'); ok(!w.zones.some(q => q.kind === 'shards'), 'the patch ends'); ok(inside.slowAmt === 0, 'and the slow wears off');
  const big = stage({ r_s1: 1, r_s1_b: 2 }); big.p.stats.area = 1; big.w.zones.length = 0; big.w.playerSkill(big.p, Math.PI, {}, 0); near(big.w.zones.find(q => q.kind === 'shards').r, 75, 1e-9, 'the patch radius follows the area (50 x (1 + area / 2))');
}

// ---- Rainmaker (r_s2): +30% radius, +1 s (12 ticks), +10% damage ----
{
  const { w, p } = stage({ r_s2: 1 }); const rn = ED.Stats.skillNums('rain', p.stats), tk = rn.p.tick;
  near(tk.r, 104, 1e-6, 'Rainmaker radius 80 x 1.3'); near(tk.dur, 3, 1e-9, 'Rainmaker lasts 3 s'); near(tk.count, 12, 0, 'Rainmaker: 12 volleys'); near(tk.dmg, 9.4 * 1.1, 0.01, 'Rainmaker +10% damage'); near(p.stats.skill2Cd, 10, 1e-9, 'Rainmaker keeps its 10 s cooldown');
  const e = foe(w, 200, 212), log = []; const hk = w.hitEnemy; w.hitEnemy = function (f, b, s) { if (s && s.part) log.push(s.part); return hk.call(this, f, b, s); };
  w.zones.length = 0; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: 200, y: 212 }, 1); const z = w.zones.find(q => q.kind === 'rain'); ok(z && Math.abs(z.r - 104) < 1e-6, 'a rain zone of radius 104'); run(w, 3.6);
  ok(log.filter(s => s === 'rain.tick').length === 12, `12 arrow ticks (got ${log.filter(s => s === 'rain.tick').length})`); w.hitEnemy = hk; void e;
}

// ---- Skyfall (r_s2_a): the whole Rain lands once after 0.5 s, 30% wider, 0.5 s stun; Twin Sky 0.8 s later at 40% ----
{
  const { w, p } = stage({ r_s2: 1, r_s2_a: 1 }); const rn = ED.Stats.skillNums('rain', p.stats);
  near(rn.p.sky.dmg, 124.08, 0.1, 'Skyfall 124 in one hit'); near(rn.p.sky.r, 104 * 1.3, 1e-6, 'Skyfall is 30% wider'); ok(!rn.p.sky2.on, 'no Twin Sky at rank 1');
  near(ED.skillRadius('rain', p.stats), 104 * 1.3, 1e-6, 'the aim circle shows the wider Skyfall radius'); near(ED.skillRadius('rain', stage({ r_s2: 1 }).p.stats), 104, 1e-6, 'and the Rain radius without Skyfall');
  const inn = foe(w, 200, 212), edge = foe(w, 200 + 104 * 1.3 + 6, 212), out = foe(w, 200 + 104 * 1.3 + 40, 212), bs = foe(w, 200, 240); bs.boss = true;
  const evs = tap(w), log = []; const hk = w.hitEnemy; w.hitEnemy = function (f, b, s) { const d = hk.call(this, f, b, s); if (s && s.part) log.push({ part: s.part, e: f, d }); return d; };
  w.zones.length = 0; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: 200, y: 212 }, 1);
  ok(w.zones.length === 1 && w.zones[0].kind === 'skyfall' && Math.abs(w.zones[0].dur - 0.5) < 1e-9, 'a skyfall zone of 0.5 s (no tick zone)');
  run(w, 0.45, evs.step); ok(log.length === 0 && inn.hp === 5000, 'nothing lands before 0.5 s'); run(w, 0.1, evs.step);
  const hits = log.filter(h => h.part === 'rain.sky'); ok(hits.length === 3 && hits.every(h => Math.abs(h.d - 124.08) < 0.3), `the centre, edge and boss foes each take one 124 hit (got ${hits.map(h => h.d.toFixed(1))})`);
  ok(!log.some(h => h.e === out), 'a foe outside the circle is not hit'); ok(inn.stun > 0.4 && inn.stun <= 0.5 + 1e-9, `non-boss foes are stunned 0.5 s (got ${inn.stun.toFixed(2)})`); ok(!(bs.stun > 0), 'bosses are never stunned');
  ok(evs.all.filter(v => v.t === 'skyfx' && v.k === 0).length === 1, 'a landing event'); run(w, 1.5, evs.step); ok(log.length === 3 && log.every(h => h.part === 'rain.sky'), 'no further hits without Twin Sky'); w.hitEnemy = hk; void edge;
}
{ // Twin Sky: a second landing 0.8 s after the first at 40%, same spot, no stun; rank 2 adds damage and radius
  const { w, p } = stage({ r_s2: 1, r_s2_a: 2 }); const rn = ED.Stats.skillNums('rain', p.stats); near(rn.p.sky.dmg, 9.4 * 1.1 * 1.1 * 12, 0.2, 'rank 2 Skyfall damage (Rainmaker +10%, Skyfall +10% at rank 2)'); near(rn.p.sky2.dmg, rn.p.sky.dmg * 0.4, 1e-9, 'Twin Sky at 40%');
  const e = foe(w, 200, 212), evs = tap(w), log = []; const hk = w.hitEnemy; w.hitEnemy = function (f, b, s) { const d = hk.call(this, f, b, s); if (s && s.part) log.push({ part: s.part, t: w.time, d, stun: f.stun }); return d; };
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: 200, y: 212 }, 1); run(w, 0.7, evs.step); e.stun = 0; e.stunCd = 0; run(w, 1.0, evs.step);
  const a = log.find(h => h.part === 'rain.sky'), b = log.find(h => h.part === 'rain.sky2');
  ok(a && b && Math.abs((b.t - a.t) - 0.8) < 0.03, `Twin Sky lands 0.8 s later (${a && b ? (b.t - a.t).toFixed(2) : '-'})`); near(b.d / a.d, 0.4, 1e-6, 'Twin Sky deals 40%'); ok(!(e.stun > 0), 'Twin Sky does not stun again');
  ok(evs.all.filter(v => v.t === 'skyfx').map(v => v.k).join() === '0,1', 'two landing events'); w.hitEnemy = hk;
}

// ---- Hail of Thorns (r_s2_b): foes in the Rain slowed 50% and +20% damage; Second Shower at rank 3 ----
{
  const { w, p } = stage({ r_s2: 1, r_s2_b: 1 }); const e = foe(w, 200, 212), out = foe(w, 330, 212);
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: 200, y: 212 }, 1); run(w, 0.3); ok(!(e.slowAmt > 0), 'no slow before the arrows fall'); run(w, 0.2);
  near(e.slowAmt, 0.5, 1e-9, 'foes in the Rain are slowed 50%'); ok(e.vulnT > 0, 'and vulnerable'); ok(!(out.slowT > 0), 'foes outside the Rain are not slowed');
  near(hit(w, p, e, 100, { kind: 'weapon' }) / hit(w, p, out, 100, { kind: 'weapon' }), 1.2, 1e-6, 'vulnerable foes take +20%');
  near(stage({ r_s2_b: 2 }).p.stats.s2Dmg, 0, 1e-9, 'Hail of Thorns adds no Rain damage of its own');
}
{ // Second Shower: when the Rain ends it falls again on the same spot for 2 s at 15% per tick
  const { w, p } = stage({ r_s2: 1, r_s2_b: 2 }); const e = foe(w, 200, 212), evs = tap(w), log = []; const hk = w.hitEnemy; w.hitEnemy = function (f, b, s) { const d = hk.call(this, f, b, s); if (s && s.part) log.push({ part: s.part, t: w.time, b }); return d; };
  const rn = ED.Stats.skillNums('rain', p.stats); near(rn.p.shower.dmg, rn.p.tick.dmg * 0.15, 1e-9, 'Second Shower at 15% of a tick');
  w.zones.length = 0; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: 200, y: 212 }, 1); run(w, 6.2, evs.step);
  const tk = log.filter(h => h.part === 'rain.tick'), sh = log.filter(h => h.part === 'rain.shower');
  ok(tk.length === 12, `the Rain keeps its 12 ticks (got ${tk.length})`); ok(sh.length === 8, `the Shower lasts 2 s = 8 ticks (got ${sh.length})`);
  near(sh[0].b / tk[0].b, 0.15, 1e-6, 'a Shower tick is 15% of a Rain tick'); ok(sh[0].t >= tk[11].t - 1e-9 && sh[0].t - tk[11].t < 0.3, 'the Shower starts when the Rain ends');
  ok(evs.all.some(v => v.t === 'skyfx' && v.k === 2), 'a Shower event'); ok(w.zones.length === 0, 'no zone is left'); ok(e.slowAmt === 0, 'the slow wears off'); w.hitEnemy = hk;
  const no = stage({ r_s2: 1, r_s2_b: 1 }); const f = foe(no.w, 200, 212), l2 = []; const h2 = no.w.hitEnemy; no.w.hitEnemy = function (g, b, s) { if (s && s.part) l2.push(s.part); return h2.call(this, g, b, s); };
  no.w.playerSkill(no.p, 0, { x0: no.p.x, y0: no.p.y, x: 200, y: 212 }, 1); run(no.w, 6, null); ok(!l2.includes('rain.shower'), 'no Shower at rank 1'); void f;
}

// ---- Trapper's Craft (r_el): everything bleeds; Infected Wounds (r_el_a): Volley and Rain build statuses 50% faster, Bleed and Burn tick 20% harder, Gangrene at rank 3 ----
{
  const { w, p } = stage({ r_el: 1 }); const e = foe(w, 200, 212);
  hit(w, p, e, 100, { kind: 'weapon' }); near(e.bleedPool, 100 * 0.1 * 1.15, 1e-6, 'Trapper\'s Craft: 10% of the damage bleeds, statuses +15% stronger');
  const k = stage({ r_el: 1, r_el_a: 1 }); const a = foe(k.w, 200, 212), b = foe(k.w, 230, 212);
  hit(k.w, k.p, a, 100, { kind: 'skill', part: 'volley.arrow', infK: 1 }); hit(k.w, k.p, b, 100, { kind: 'skill', part: 'volley.arrow', infK: 1.5 }); near(b.bleedPool / a.bleedPool, 1.5, 1e-6, 'skill hits build statuses 50% faster');
  k.w.projs.length = 0; k.w.playerSkill(k.p, 0, {}, 0); ok(k.w.projs.every(q => q.team !== 0 || Math.abs(q.infK - 1.5) < 1e-9), 'Volley arrows carry the 1.5 build-up factor');
  const log = [], hk = k.w.hitEnemy; k.w.hitEnemy = function (f, bb, s) { if (s && s.part) log.push({ part: s.part, k: s.infK }); return hk.call(this, f, bb, s); };
  k.w.playerSkill(k.p, 0, { x0: k.p.x, y0: k.p.y, x: 200, y: 212 }, 1); run(k.w, 1); ok(log.some(h => h.part === 'rain.tick') && log.filter(h => h.part === 'rain.tick').every(h => h.k === 1.5), 'Rain ticks carry the 1.5 build-up factor'); k.w.hitEnemy = hk;
  // Bleed and Burn tick harder
  const bl = (cards) => { const s = stage(cards); const f = foe(s.w, 200, 212); f.bleedPool = 100; f.bleedOwner = s.p; f.bleedTick = 0.1; const h0 = f.hp; run(s.w, 0.2); return h0 - f.hp; };
  near(bl({ r_el_a: 1 }) / bl({}), 1.2, 1e-6, 'Bleed ticks 20% harder'); near(stage({ r_el_a: 2 }).p.stats.bleedMul, 0.3, 1e-9, 'rank 2: Bleed +30%'); near(stage({ r_el_a: 2 }).p.stats.burnMul, 0.3, 1e-9, 'rank 2: Burn +30%');
  const bn = (cards) => { const s = stage(cards); const f = foe(s.w, 200, 212); s.w.burnStack(f, s.p, 0); f.burnTick = 0.1; const h0 = f.hp; run(s.w, 0.2); return h0 - f.hp; };
  near(bn({ r_el_a: 1 }) / bn({}), 1.2, 1e-6, 'Burn ticks 20% harder');
}
{ // Gangrene (rank 2)
  const { w, p } = stage({ r_el_a: 2 }); near(p.stats.festerHit, 0.9, 1e-9, 'rank 2: Gangrene 90%'); near(stage({ r_el_a: 3 }).p.stats.festerHit, 0.9, 1e-9, 'rank 3 keeps Gangrene');
  const mk = (n) => { const e = foe(w, 200, 212); if (n >= 1) w.burnStack(e, p, 0); if (n >= 2) e.bleedPool = 400; if (n >= 3) e.chill = 30; return e; };
  const base = hit(w, p, mk(0), 100, { kind: 'skill', part: 'volley.arrow', noGuard: true });
  near(hit(w, p, mk(3), 100, { kind: 'skill', part: 'volley.arrow' }) / base, 1.9, 1e-6, 'Volley +90% on a foe with 3 ailments'); near(hit(w, p, mk(3), 100, { kind: 'skill', part: 'rain.tick' }) / base, 1.9, 1e-6, 'Rain +90% on a foe with 3 ailments');
  near(hit(w, p, mk(3), 100, { kind: 'skill', part: 'rain.sky' }) / base, 1.9, 1e-6, 'Skyfall +90% too'); near(hit(w, p, mk(2), 100, { kind: 'skill', part: 'volley.arrow' }) / base, 1, 1e-6, 'no bonus with 2 ailments');
  near(hit(w, p, mk(3), 100, { kind: 'weapon', wpn: true }) / base, 1, 1e-6, 'weapon shots get no Gangrene'); ok(w.ailments(mk(3)) === 3, 'three ailments counted');
  const lo = stage({ r_el_a: 1 }); const e = foe(lo.w, 200, 212); lo.w.burnStack(e, lo.p, 0); e.bleedPool = 400; e.chill = 30; near(hit(lo.w, lo.p, e, 100, { kind: 'skill', part: 'volley.arrow' }), 100, 1e-6, 'no Gangrene at rank 1');
}

// ---- Contagion (r_el_b): a foe with 2+ ailments that dies to the Ranger passes 50% of each status to the 2 nearest foes within 100 (+20 per rank); Outbreak (rank 2): 3 foes at 120%; Plaguebearer (rank 3) ----
{
  const spread = (cards, setup) => {
    const { w, p } = stage(cards); const a = foe(w, 200, 212), ring = [[90, 0], [0, 70], [-95, 0], [60, 60], [130, 0]].map(([dx, dy]) => foe(w, 200 + dx, 212 + dy)); const evs = tap(w);
    burn6(w, a, p); a.bleedPool = 400; a.bleedOwner = p; a.chill = 40; a.chillOwner = p; if (setup) setup(a);
    hit(w, p, a, 1e9, { kind: 'weapon' }); run(w, 0.4, evs.step);
    return { got: ring.map(r => r.burnN | 0), bl: ring.map(r => r.bleedPool), chill: ring.map(r => r.chill), evs: evs.all, ring, w };
  };
  let s = spread({ r_el_b: 1 }); // nearest are (0,70)=70, (60,60)=85, (90,0)=90, (-95,0)=95 within 100; 130 is out
  ok(s.got.filter(v => v > 0).length === 2, `two foes receive (got ${s.got.map(v => v.toFixed(0))})`); ok(s.got[1] > 0 && s.got[3] > 0 && s.got[0] === 0 && s.got[4] === 0, 'the two nearest foes within 100 receive');
  near(s.got[1], 3, 0, '50% of the Burn stacks'); near(s.bl[1], 200, 1e-6, '50% of the Bleed pool'); ok(s.chill[1] > 0, 'and of the Chill gauge'); ok(s.evs.filter(v => v.t === 'chain' && v.k === 'c').length === 2, 'a chain thread per recipient');
  s = spread({ r_el_b: 1 }, a => { a.bleedPool = 0; a.chill = 0; }); ok(s.got.every(v => v === 0), 'one ailment: nothing spreads');
  s = spread({ r_el_b: 2 }); ok(s.got.filter(v => v > 0).length === 3 && s.got[1] > 0 && s.got[3] > 0 && s.got[0] > 0 && s.got[2] === 0 && s.got[4] === 0, 'rank 2 (reach 120): Outbreak passes to the three nearest, not the fourth (95)');
  const far = stage({ r_el_b: 1 }); const a = foe(far.w, 200, 212), f = foe(far.w, 200 + 118, 212); burn6(far.w, a, far.p); a.bleedPool = 400; a.bleedOwner = far.p; hit(far.w, far.p, a, 1e9, { kind: 'weapon' }); run(far.w, 0.4); ok(!(f.burnN > 0), 'a foe at 118 is out of reach at rank 1');
  const r2 = stage({ r_el_b: 2 }); const a2 = foe(r2.w, 200, 212), f2 = foe(r2.w, 200 + 118, 212); burn6(r2.w, a2, r2.p); a2.bleedPool = 400; a2.bleedOwner = r2.p; hit(r2.w, r2.p, a2, 1e9, { kind: 'weapon' }); run(r2.w, 0.4); ok(f2.burnN > 0, 'and in reach at rank 2 (120)');
  s = spread({ r_el_b: 2 }); near(s.got[1], 5, 0, 'Outbreak: 90% of the Burn stacks to each (6 x 0.9, rounded down)'); near(s.bl[1], 400 * 0.9, 1e-6, 'and 90% of the Bleed'); ok(s.evs.filter(v => v.t === 'chain' && v.k === 'c').length === 3, 'three threads'); near(stage({ r_el_b: 1 }).p.stats.outbreak, 0, 0, 'no Outbreak at rank 1');
  // someone else's kill, or a kill by a hero without the card, does not spread
  const o = stage({ r_el_b: 1 }, 0, [{ pid: 'p1' }]); const b = foe(o.w, 200, 212), g = foe(o.w, 240, 212); burn6(o.w, b, o.p); b.bleedPool = 400; hit(o.w, o.w.players.get('p1'), b, 1e9, { kind: 'weapon' }); run(o.w, 0.4); ok(!(g.burnN > 0), 'a kill by a hero without Contagion does not spread');
  const dead = stage({ r_el_b: 1 }); const d1 = foe(dead.w, 200, 212), d2 = foe(dead.w, 230, 212); d2.hp = 0; d2.killed = true; burn6(dead.w, d1, dead.p); d1.bleedPool = 400; d1.bleedOwner = dead.p; hit(dead.w, dead.p, d1, 1e9, { kind: 'weapon' }); run(dead.w, 0.3); ok(!(d2.burnN > 0), 'dead foes receive nothing');
  const cap = stage({ r_el_b: 1 }); const c1 = foe(cap.w, 200, 212), c2 = foe(cap.w, 230, 212); c2.maxHp = c2.hp = 200; burn6(cap.w, c1, cap.p); c1.bleedPool = 5000; c1.bleedOwner = cap.p; hit(cap.w, cap.p, c1, 1e9, { kind: 'weapon' }); run(cap.w, 0.25); ok(c2.bleedPool <= 0.25 * 200 + 1e-6 && c2.burnN === 3, 'a receiver takes at most 25% of its HP of Bleed; Burn passes as stacks (3 of 6)');
}

// ---- skill forms (rank 2: the rider, rank 3: the transform) ----
const spy = (w) => { const log = [], o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const d = o.call(this, e, b, s); if (s && s.part) log.push({ part: s.part, e, d, t: this.time }); return d; }; return log; };
const partHits = (log, part) => log.filter(h => h.part === part);
const arrowsOf = (w, part) => w.projs.filter(q => q.team === 0 && q.part === part);
{ // Death Mark (r_s1_a rank 3): three waves 0.12 s apart (2 and 3 at 60%), arrows steer toward marked foes, a dying marked foe (never fodder) bursts into 4 piercing arrows at 50%
  const waves = (rank) => {
    const { w, p } = stage({ r_s1: 1, r_s1_a: rank }); const seen = new Set(), got = []; w.playerSkill(p, 0.2, {}, 0); const t0 = w.time;
    for (let i = 0; i < 40; i++) { for (const q of w.projs.filter(r => r.team === 0 && r.part && r.part.indexOf('volley.') === 0)) if (!seen.has(q.id)) { seen.add(q.id); got.push({ t: w.time - t0, dmg: q.dmg, x: q.x }); } w.update(1 / 60); }
    return got;
  };
  const w3 = waves(3), w2 = waves(2), base = ED.Stats.skillNums('volley', stage({ r_s1: 1, r_s1_a: 3 }).p.stats).p.arrow;
  const at = (g, lo, hi) => g.filter(a => a.t >= lo && a.t < hi);
  ok(at(w3, 0, 0.05).length === 10 && at(w3, 0.1, 0.17).length === 10 && at(w3, 0.22, 0.3).length === 10 && w3.length === 30, `Death Mark: three waves of ${base.n} arrows (${at(w3, 0, 0.05).length}, ${at(w3, 0.1, 0.17).length}, ${at(w3, 0.22, 0.3).length})`);
  ok(Math.abs(at(w3, 0.1, 0.17)[0].t - 0.12) < 0.03 && Math.abs(at(w3, 0.22, 0.3)[0].t - 0.24) < 0.03, 'the waves follow 0.12 s apart');
  near(at(w3, 0.1, 0.17)[0].dmg / at(w3, 0, 0.05)[0].dmg, 0.1, 1e-6, 'waves 2 and 3 deal 10%'); near(at(w3, 0.22, 0.3)[0].dmg / at(w3, 0, 0.05)[0].dmg, 0.1, 1e-6, 'wave 3 deals 10%');
  ok(w2.length === 10, 'rank 2 looses one wave');
  const heading = (rank, marked, foeAt) => {
    const { w, p } = stage({ r_s1: 1, r_s1_a: rank }); const f = foe(w, foeAt[0], foeAt[1]); if (marked) { f.mark = 5; f.markV = 0.12; f.markBy = 'p0'; }
    w.playerSkill(p, 0, {}, 0); const as = arrowsOf(w, 'volley.arrow').slice(0, 10).map((q, i) => ({ q, a0: (i / 9 - 0.5) * 1.2 })); run(w, 0.15);
    return Math.max(...as.map(({ q, a0 }) => Math.abs(Math.atan2(q.vy, q.vx) - a0)));
  };
  const turn = heading(3, true, [330, 120]);
  ok(turn > 0.12 && turn <= 3 * 0.15 + 1e-6, `arrows steer toward a marked foe at no more than 3 rad/s (${turn.toFixed(2)} rad in 0.15 s)`);
  ok(heading(3, false, [330, 120]) < 1e-6 && heading(2, true, [330, 120]) < 1e-6, 'they ignore unmarked foes, and rank 2 does not steer');
  { // the burst
    const bw = (rank, marked) => { const { w, p } = stage({ r_s1: 1, r_s1_a: rank }); const f = foe(w, 250, 212); if (marked !== false) { f.mark = 5; f.markV = 0.12; f.markBy = 'p0'; } return { w, p, f }; };
    const a = bw(3), N = ED.Stats.skillNums('volley', a.p.stats), evs = tap(a.w); hit(a.w, a.p, a.f, 1e9, { kind: 'weapon' }); const bursts = arrowsOf(a.w, 'volley.burst'); evs.step();
    ok(bursts.length === 4, `a marked foe bursts into 4 arrows (${bursts.length})`);
    ok(bursts.every(q => Math.abs(q.dmg - N.p.arrow.dmg * 0.2) < 1e-9 && q.pierce === 3 && q.hk === 'skill'), 'each at 20% of a Volley arrow, piercing 3');
    const angs = bursts.map(q => Math.atan2(q.vy, q.vx)).sort((x, y) => x - y); near(angs[1] - angs[0], Math.PI / 2, 1e-6, 'a cross, 90 degrees apart'); ok(evs.all.some(v => v.t === 'dmburst'), 'a burst event for the viewer');
    const b = bw(3, false); hit(b.w, b.p, b.f, 1e9, { kind: 'weapon' }); ok(arrowsOf(b.w, 'volley.burst').length === 0, 'an unmarked foe bursts nothing');
    const fd = bw(3); fd.f.fodder = true; hit(fd.w, fd.p, fd.f, 1e9, { kind: 'weapon' }); ok(arrowsOf(fd.w, 'volley.burst').length === 0, 'a marked fodder foe bursts nothing (fodder deaths fire no on-death effect)');
    const c = bw(2); hit(c.w, c.p, c.f, 1e9, { kind: 'weapon' }); ok(arrowsOf(c.w, 'volley.burst').length === 0, 'rank 2 has no burst');
    // burst arrows hit and do not mark
    const d = bw(3), other = foe(d.w, 350, 312); hit(d.w, d.p, d.f, 1e9, { kind: 'weapon' }); run(d.w, 0.9); ok(other.hp < 5000 && !(other.mark > 0), 'burst arrows hit a foe past the mark leap (r120) and do not mark it');
  }
}
{ // Thornburst (r_s1_b rank 3): a ring of 20 arrows at x3 damage piercing 3, the hop and the close bonus stay, caltrops cover 3x the area and root a foe 0.5 s once per patch (not bosses)
  const { w, p } = stage({ r_s1: 1, r_s1_b: 3 }), N = ED.Stats.skillNums('volley', p.stats), q = N.p.arrow;
  ok(q.n === 20 && q.ring && Math.abs(q.fan - 2 * Math.PI) < 1e-9, 'Thornburst: a full ring of 20 arrows'); const mv = N.move; ok(mv && mv.k === 'hop' && mv.dist === 70, 'and the hop');
  w.projs.length = 0; w.playerSkill(p, 0.4, {}, 0); const as = arrowsOf(w, 'volley.arrow'), ang = as.map(a => Math.atan2(a.vy, a.vx)).sort((x, y) => x - y);
  ok(as.length === 20 && Math.abs(ang[1] - ang[0] - 2 * Math.PI / 20) < 1e-6 && as.every(a => Math.abs(a.dmg - q.dmg * 3) < 1e-9 && a.pierce === 3), 'twenty evenly spaced arrows at x3 damage, piercing 3'); ok(as.some(a => Math.abs(Math.atan2(a.vy, a.vx) - 0.4) < 1e-6), 'one of them flies along the aim');
  const e = foe(w, 300, 212); near(hit(w, p, e, 10, { kind: 'skill', part: 'volley.arrow', dist: 50, knock: 60, kx: 1, ky: 0 }), 16, 1e-6, 'the close bonus stays (+60% at rank 3)');
  ok(ED.Stats.skillNums('volley', stage({ r_s1: 1, r_s1_b: 2 }).p.stats).p.arrow.n === 10, 'rank 2 keeps the fan of 10');
  const z0 = w.zones.find(z => z.kind === 'shards'); near(z0.r, 87, 1e-9, 'the caltrops cover three times the area (r 87)');
  const t = stage({ r_s1: 1, r_s1_b: 3 }); t.w.zones.length = 0; t.w.playerSkill(t.p, Math.PI, {}, 0); t.w.projs.length = 0; const inside = foe(t.w, 60 + 30, 212), boss = foe(t.w, 60, 212 + 40); boss.boss = true; const away = foe(t.w, 60 + 110, 212); t.p.x = 400;
  run(t.w, 1 / 60); near(inside.slowAmt, 1, 1e-9, 'a foe entering is rooted'); near(boss.slowAmt, 0.4, 1e-9, 'a boss is only slowed 40%'); ok(away.slowAmt === 0, 'a foe outside (r 86.6 plus its body) is untouched');
  run(t.w, 0.3); near(inside.slowAmt, 1, 1e-9, 'still rooted 0.3 s in'); run(t.w, 0.3); near(inside.slowAmt, 0.4, 1e-9, 'after 0.5 s the root ends and the 40% slow remains');
  inside.x = 300; run(t.w, 0.5); inside.x = 60 + 30; run(t.w, 1 / 30); ok(inside.slowAmt < 1, 'a foe that leaves and returns is not rooted again');
  const r2 = stage({ r_s1: 1, r_s1_b: 2 }); r2.w.zones.length = 0; r2.w.playerSkill(r2.p, Math.PI, {}, 0); r2.w.projs.length = 0; const f2 = foe(r2.w, 60 + 30, 212); r2.p.x = 400; run(r2.w, 1 / 60);
  near(r2.w.zones.find(z => z.kind === 'shards').r, 50, 1e-9, 'rank 2 keeps radius 50'); near(f2.slowAmt, 0.4, 1e-9, 'and only slows');
}
{ // Starfall Barrage (r_s2_a rank 3): five Skyfall impacts walk from the hero to the cursor, 0.12 s apart, r70 at 60%, stun 0.4 s (not bosses); rank 2 keeps Skyfall and Twin Sky
  const { w, p } = stage({ r_s2: 1, r_s2_a: 3 }), N = ED.Stats.skillNums('rain', p.stats), q = N.p.star;
  ok(q.on && !N.p.sky.on && !N.p.sky2.on && q.n === 5, 'the barrage replaces the single landing and Twin Sky'); near(q.dmg, N.p.sky.dmg * 0.45, 1e-9, 'each impact is 45% of a Skyfall'); near(q.r, 70 * 1.4, 1e-6, 'impact radius 70 (with the Rain area)');
  const near1 = foe(w, 250, 212), tgt = foe(w, 300, 212), bs = foe(w, 252, 240), start = foe(w, 80, 212); bs.boss = true;
  const log = spy(w), evs = tap(w); w.zones.length = 0; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: 300, y: 212 }, 1);
  const zs = w.zones.filter(z => z.kind === 'starfall'); ok(zs.length === 5 && !w.zones.some(z => z.kind === 'skyfall' || z.kind === 'rain'), 'five starfall zones, no Skyfall');
  ok(zs.every((z, k) => Math.abs(z.x - (60 + 240 * (k + 1) / 5)) < 1e-6 && Math.abs(z.y - 212) < 1e-6 && Math.abs(z.dur - (0.35 + 0.12 * k)) < 1e-9 && z.r === q.r), 'they walk from the hero to the cursor, 0.12 s apart');
  run(w, 1.2, evs.step); const hs = partHits(log, 'rain.star'), land = evs.all.filter(v => v.t === 'skyfx' && v.k === 3);
  ok(land.length === 5, `five landing events (${land.length})`); ok(hs.length > 5 && hs.every(h => Math.abs(h.d - q.dmg) < 0.2), `every foe in reach takes 45% of a Skyfall (${hs.length} hits)`);
  ok(hs.filter(h => h.e === tgt).length >= 3 && hs.filter(h => h.e === start).length >= 1, 'a foe at the end is in reach of several impacts');
  ok(!partHits(log, 'rain.sky').length && !partHits(log, 'rain.sky2').length, 'no Skyfall or Twin Sky hit');
  const st = stage({ r_s2: 1, r_s2_a: 3 }), s1 = foe(st.w, 300, 212), s2 = foe(st.w, 300, 250); s2.boss = true; let stunned = 0, bossStun = 0; st.w.playerSkill(st.p, 0, { x0: st.p.x, y0: st.p.y, x: 300, y: 212 }, 1);
  run(st.w, 1.2, () => { stunned = Math.max(stunned, s1.stun); bossStun = Math.max(bossStun, s2.stun); }); ok(stunned > 0.3 && stunned <= 0.4 + 1e-9 && bossStun === 0, `impacts stun 0.4 s, never a boss (${stunned.toFixed(2)})`);
  const r2 = stage({ r_s2: 1, r_s2_a: 2 }); r2.w.zones.length = 0; r2.w.playerSkill(r2.p, 0, { x0: r2.p.x, y0: r2.p.y, x: 300, y: 212 }, 1); ok(r2.w.zones.length === 1 && r2.w.zones[0].kind === 'skyfall', 'rank 2 casts the single Skyfall (and Twin Sky)');
}
{ // Storm of Thorns (r_s2_b rank 3): the Rain follows the cursor at 120 px/s for 1.5 times as long and lays bramble patches (r40, 3 s, slow 30%) every 0.5 s; the Second Shower falls where it ended
  const { w, p } = stage({ r_s2: 1, r_s2_b: 3 }), N = ED.Stats.skillNums('rain', p.stats), tk = N.p.tick;
  near(tk.dur, 4.5, 1e-9, 'the Rain lasts 1.5 times as long (3 s to 4.5 s)'); near(tk.count, 18, 1e-9, '18 ticks'); ok(ED.Stats.skillNums('rain', stage({ r_s2: 1, r_s2_b: 2 }).p.stats).p.tick.count === 12, 'rank 2: 12 ticks');
  p.aimX = 320; p.aimY = 212; w.zones.length = 0; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: 140, y: 212 }, 1); const z = w.zones.find(q => q.kind === 'rain'); const xs = {}, patches = new Set(), evs = tap(w);
  run(w, 1.7, () => { xs[Math.round((z.t) * 60)] = z.x; for (const b of w.zones) if (b.kind === 'bramble') patches.add(b.id); evs.step(); });
  near(xs[Math.round(1.2 * 60)] - xs[Math.round(0.2 * 60)], 120, 4, 'the Rain follows the cursor at 120 px/s'); ok(z.x <= 320 + 1e-6 && z.x > 300, `and stops at the cursor, within range (${z.x.toFixed(0)})`);
  ok(patches.size >= 3, `a bramble patch about every 0.5 s along its path (${patches.size} in 1.7 s)`);
  const br = w.zones.find(b => b.kind === 'bramble'); ok(br && br.r === 40 && Math.abs(br.dur - 3) < 1e-9, 'patches: r40, 3 s'); const slowed = foe(w, br.x, br.y); run(w, 1 / 30); near(slowed.slowAmt, 0.3, 1e-9, 'foes in a patch are slowed 30%');
  const s = stage({ r_s2: 1, r_s2_b: 3 }); s.p.aimX = 140; s.p.aimY = 212; const f = foe(s.w, 140, 212), log = spy(s.w), ev2 = tap(s.w); s.w.playerSkill(s.p, 0, { x0: s.p.x, y0: s.p.y, x: 140, y: 212 }, 1); run(s.w, 8.8, ev2.step);
  ok(partHits(log, 'rain.tick').length === 18, `a still Storm ticks 18 times (${partHits(log, 'rain.tick').length})`); ok(partHits(log, 'rain.shower').length === 8, 'and the Second Shower follows (8 ticks)');
  ok(ev2.all.some(v => v.t === 'skyfx' && v.k === 2 && Math.abs(v.x - 140) < 3), 'the Shower falls where the Storm ended');
  const r2 = stage({ r_s2: 1, r_s2_b: 2 }); r2.p.aimX = 320; r2.p.aimY = 212; r2.w.zones.length = 0; r2.w.playerSkill(r2.p, 0, { x0: r2.p.x, y0: r2.p.y, x: 140, y: 212 }, 1); const z2 = r2.w.zones.find(q => q.kind === 'rain'); run(r2.w, 1.5);
  ok(Math.abs(z2.x - 140) < 1e-6 && !r2.w.zones.some(q => q.kind === 'bramble'), 'rank 2: the Rain stays put and lays nothing');
  const g = stage({ r_s2: 1, r_s2_b: 3 }); g.w.zones.length = 0; g.w.playerSkill(g.p, 0, { x0: g.p.x, y0: g.p.y, x: 140, y: 212 }, 1); const z3 = g.w.zones.find(q => q.kind === 'rain'); g.p.face = 0; run(g.w, 1.5); ok(Math.abs(z3.x - 140) < 1, 'without a streamed cursor it follows the aim at its distance (here: stays)');
}

// ---- attack and element forms (rank 3 transforms): Siege Ballista, Storm Bow, Hemorrhage, Plaguebearer ----
const wShots = (w) => w.projs.filter(q => q.team === 0 && q.wpn);
{ // Siege Ballista (r_atk_h rank 3): every 5th shot is a siege bolt (pierces all, twice as wide, x1.8)
  const { w, p } = stage({ r_atk: 1, r_atk_h: 3 }), wr = p.stats.weapon.r, flags = [];
  near(p.stats.siege, 5, 0, 'rank 3: one shot in 5'); near(p.stats.siegeMul, 1.8, 1e-9, 'siege x1.8'); near(p.stats.siegeBlast, 0.3, 1e-9, 'blast 30%'); ok(p.stats.splitBolt === 0.5, 'rank 3 keeps Splitting Bolt');
  for (let i = 0; i < 10; i++) {
    w.projs.length = 0; w.playerAttack(p, 0.3); const q = wShots(w)[0]; flags.push(q.siege ? 'S' : 'n');
    if (q.siege) ok(q.pierce === 999 && Math.abs(q.r - 2 * wr) < 1e-9 && Math.abs(q.mul - 1.8) < 1e-9, 'a siege bolt pierces every foe, is twice as wide and deals x1.8');
    else ok(!q.mul && q.r === wr && q.pierce === 2, 'a plain shot is unchanged');
  }
  ok(flags.join('') === 'nnnnSnnnnS', `the 5th and 10th shot are siege bolts (got ${flags.join('')})`);
  const two = stage({ r_atk: 1, r_atk_h: 2 }); two.p.atkCount = 4; two.w.projs.length = 0; two.w.playerAttack(two.p, 0); ok(!wShots(two.w)[0].siege, 'no siege bolt at rank 2');
  const tw = stage({ r_atk: 1, r_atk_h: 3 }, 2); tw.p.atkCount = 4; tw.w.projs.length = 0; tw.w.playerAttack(tw.p, 0); ok(wShots(tw.w).length === 2 && wShots(tw.w).every(q => q.siege), 'both arrows of a paired weapon are bolts');
}
{ // pierce-all, damage and width
  const line = (count) => { const { w, p } = stage({ r_atk: 1, r_atk_h: 3 }), es = [100, 130, 160, 190, 220, 250].map(x => foe(w, x, 212)); p.atkCount = count; w.projs.length = 0; w.playerAttack(p, 0); run(w, 0.5); return { es, hurt: es.filter(e => e.hp < 5000).length }; };
  const s = line(4), n = line(0);
  ok(s.hurt === 6, `a siege bolt hits all six foes in line (got ${s.hurt})`); ok(n.hurt === 4 && n.es[3].hp > n.es[2].hp, `a plain shot hits three (pierce 2); the fourth is only reached by the split arrows (got ${n.hurt})`);
  near((5000 - s.es[0].hp) / (5000 - n.es[0].hp), 1.8, 1e-6, 'the first foe takes x1.8');
  // the arrows fly at y 208 (4 px above the hero's feet)
  const side = (count) => { const { w, p } = stage({ r_atk: 1, r_atk_h: 3 }), e = foe(w, 200, 212); e.y = 208 + e.r + 7; p.atkCount = count; w.projs.length = 0; w.playerAttack(p, 0); run(w, 0.5); return e.hp < 5000; };
  ok(side(4) && !side(0), 'the doubled radius reaches a foe 7 px beyond where a plain shot misses');
}
{ // the blast: where the range ends, 30% of the shot with the siege factor, radius 60 x area; at a wall; where a guard stops the bolt
  const fly = (setup, a, area) => {
    const { w, p } = stage({ r_atk: 1, r_atk_h: 3 }), evs = tap(w); if (area) p.stats.area = area;
    const pre = setup ? setup(w, p) : null; p.atkCount = 4; w.projs.length = 0; w.playerAttack(p, a || 0); const sh = wShots(w)[0], dmg = sh.dmg * sh.mul; run(w, 1.5, evs.step);
    return { w, p, evs, dmg, pre, booms: evs.all.filter(v => v.t === 'boom' && v.k === 'siege') };
  };
  const probe = fly(null); ok(probe.booms.length === 1 && probe.booms[0].r === 60, 'one siege blast of radius 60 where the range ends'); const bx = probe.booms[0].x;
  const r = fly((w) => ({ inn: foe(w, bx - 20, 212 + 40), out: foe(w, bx - 20, 212 + 40 + 75) })), ref = stage({ r_atk: 1, r_atk_h: 3 }), re = foe(ref.w, 300, 212);
  near(5000 - r.pre.inn.hp, hit(ref.w, ref.p, re, r.dmg * 0.3, { kind: 'explode', crit: false, noGuard: true }), 0.01, 'the blast deals 30% of the shot with the siege factor'); ok(r.pre.out.hp === 5000, 'a foe 75 px further out is untouched');
  near(fly(null, 0, 1).booms[0].r, 90, 0, 'area +100% widens the blast (60 x 1.5)');
  const g = fly((w) => { const k = w.spawnEnemy('skelknight', 200, 212); k.spd = 0; k.cd = 9999; k.maxHp = k.hp = 5000; k.guardA = Math.PI; return { k, back: foe(w, 215, 240), far: foe(w, 300, 212) }; });
  ok(g.booms.length === 1 && Math.abs(g.booms[0].x - 200) < 45, `a guard stops the bolt and the blast goes off there (x ${g.booms.length ? g.booms[0].x : '-'})`); ok(g.pre.far.hp === 5000, 'nothing behind the guard is pierced'); ok(g.pre.back.hp < 5000, 'the blast reaches a foe close behind it');
  const wall = fly(null, Math.PI); ok(wall.booms.length === 1 && wall.booms[0].x < 80, 'a bolt that hits a wall blasts there, once');
  const plain = stage({ r_atk: 1, r_atk_h: 3 }), evp = tap(plain.w); plain.p.atkCount = 0; plain.w.projs.length = 0; plain.w.playerAttack(plain.p, 0); run(plain.w, 1.5, evp.step); ok(!evp.all.some(v => v.t === 'boom'), 'a plain shot ends without a blast');
  const fod = stage({ r_atk: 1, r_atk_h: 3 }), f = foe(fod.w, 150, 212); f.fodder = true; fod.p.atkCount = 4; fod.w.projs.length = 0; fod.w.playerAttack(fod.p, 0); run(fod.w, 0.5); ok(f.hp < 5000, 'a fodder foe in the line takes the bolt');
}

// ---- Storm Bow (r_atk_s rank 3): a ricochet per shot, a bigger Flurry ----
{
  const mk = (cards) => { const s = stage(Object.assign({ r_atk: 1, r_atk_s: 3 }, cards)); s.evs = tap(s.w); return s; };
  let s = mk();
  near(s.p.stats.ricochet, 0.4, 1e-9, 'rank 3: ricochet 40%'); near(s.p.stats.flurryN, 1, 0, 'Flurry gains one arrow'); ok(!stage({ r_atk: 1, r_atk_s: 2 }).p.stats.ricochet, 'no ricochet at rank 2');
  const a = foe(s.w, 150, 212), b = foe(s.w, 150, 300), c = foe(s.w, 150, 330); // b is 88 from a, c 118
  s.w.projs.length = 0; s.w.playerAttack(s.p, 0); run(s.w, 0.7, s.evs.step);
  near((5000 - b.hp) / (5000 - a.hp), 0.4, 1e-6, 'the ricochet deals 40% of the shot to the nearest other foe'); ok(c.hp === 5000, 'a farther foe in reach is skipped');
  const rc = s.evs.all.filter(v => v.t === 'chain' && v.k === 'r'); ok(rc.length === 1 && Math.abs(rc[0].pts[0][0] - 150) <= 1 && rc[0].pts[1][1] > rc[0].pts[0][1] + 60, 'one streak event from the struck foe to the new one');
  s = mk(); const a1 = foe(s.w, 150, 212), out = foe(s.w, 150 + 141, 212); s.w.playerAttack(s.p, 0); run(s.w, 0.7, s.evs.step); ok(out.hp === 5000 && !s.evs.all.some(v => v.k === 'r'), 'a foe 141 away is out of reach');
  s = mk(); foe(s.w, 150, 212); foe(s.w, 150, 250); const a3 = foe(s.w, 150, 288); s.w.projs.length = 0; s.w.playerAttack(s.p, 0); run(s.w, 0.7, s.evs.step); ok(s.evs.all.filter(v => v.t === 'chain' && v.k === 'r').length === 1 && a3.hp === 5000, 'one ricochet per shot, it does not chain on');
  s = mk(); const b1 = foe(s.w, 150, 212), b2 = foe(s.w, 180, 212), b3 = foe(s.w, 150, 250);
  const pr = s.w.spawnProj({ team: 0, kind: 'arrow', x: 140, y: 212, a: 0, speed: 100, r: 4, dmg: 10, life: 1, pierce: 3, owner: 'p0', wpn: true }); pr.hit = new Set([b2.id]); ED.CLS.ranger.projHit.call(s.w, pr, b1, { critOut: false });
  ok(b3.hp < 5000 && b2.hp === 5000, 'a foe the shot already hit is not the ricochet target');
  s = mk(); const c1 = foe(s.w, 150, 212), c2 = foe(s.w, 150, 250), prc = s.w.spawnProj({ team: 0, kind: 'arrow', x: 150, y: 212, a: 0, speed: 100, r: 4, dmg: 10, life: 1, owner: 'p0', wpn: true });
  ED.CLS.ranger.projHit.call(s.w, prc, c1, { critOut: true }); near(5000 - c2.hp, 10 * s.p.stats.dmg * 0.4 * s.p.stats.critMult, 1e-6, 'the ricochet is a crit when the hit was');
  s = mk(); const d1 = foe(s.w, 150, 212), d2 = foe(s.w, 150, 250); s.p.atkCount = 3; s.w.projs.length = 0; s.w.playerAttack(s.p, 0); const arrows = wShots(s.w).length; run(s.w, 0.7, s.evs.step);
  ok(arrows === 4, `a Flurry attack fires four arrows at rank 3 (got ${arrows})`); ok(s.evs.all.filter(v => v.t === 'chain' && v.k === 'r').length >= 3 && d1.hp < 5000 && d2.hp < 5000, 'the Flurry arrows that land ricochet once each');
  s = mk(); const e1 = foe(s.w, 150, 212), e2 = foe(s.w, 150, 250); e1.fodder = e2.fodder = true; s.w.projs.length = 0; s.w.playerAttack(s.p, 0); run(s.w, 0.7, s.evs.step); ok(e2.hp < 5000, 'fodder foes ricochet and are ricocheted to');
  s = mk({ r_el: 1 }); const t1 = foe(s.w, 150, 212), t2 = foe(s.w, 150, 250); s.w.projs.length = 0; s.w.playerAttack(s.p, 0); run(s.w, 0.3); ok(t2.bleedPool > 0 && t2.bleedPool < t1.bleedPool, 'the ricochet hit builds Bleed from its (smaller) damage');
}
{ // Flurry at rank 3: 3 extra arrows at -0.09, +0.09 and -0.18 (the odd one swaps sides every Flurry)
  const { w, p } = stage({ r_atk: 1, r_atk_s: 3 }), angs = [];
  for (const cnt of [3, 7]) { p.atkCount = cnt; w.projs.length = 0; w.playerAttack(p, 0.3); angs.push(wShots(w).map(q => Math.atan2(q.vy, q.vx) - 0.3).sort((x, y) => x - y)); }
  ok(angs[0].length === 4 && angs[1].length === 4, 'rank 3: the aimed arrow plus 3 extras');
  [-0.09, 0, 0.09, 0.18].forEach((v, i) => near(angs[0][i], v, 1e-6, 'Flurry arrow ' + i)); [-0.18, -0.09, 0, 0.09].forEach((v, i) => near(angs[1][i], v, 1e-6, 'the next Flurry, mirrored: arrow ' + i));
}

// ---- Hemorrhage (r_el_a rank 3): a hit on a foe whose Bleed is 4% of its health (a boss 0.3%) pops the pool at x3 ----
{
  const mk = (rank, boss) => { const s = stage({ r_el: 1, r_el_a: rank }); s.e = foe(s.w, 200, 212); s.e.boss = !!boss; s.e.bleedOwner = s.p; return s; };
  let s = mk(3);
  near(s.p.stats.hemoAt, 0.04, 1e-9, 'rank 3: Bleed at 4%'); near(s.p.stats.hemoMul, 3, 1e-9, 'pops x3'); near(s.p.stats.hemoBoss, 0.003, 1e-9, 'bosses 0.3%'); ok(!stage({ r_el: 1, r_el_a: 2 }).p.stats.hemo, 'no Hemorrhage at rank 2');
  const bm = s.p.stats.bleedMul, plain = hit(s.w, s.p, s.e, 100, { kind: 'weapon' }), add = plain * s.p.stats.bleedAll * (1 + s.p.stats.statusPow); // add: the Bleed the hit itself builds before it can pop
  s.e.hp = 5000; s.e.bleedPool = 199 - add - 1; const d0 = hit(s.w, s.p, s.e, 100, { kind: 'weapon' }); ok(s.e.bleedPool > 150 && Math.abs(d0 - plain) < 1e-6, 'a pool just under 4% of the health does not pop');
  s = mk(3); s.e.bleedPool = 200; const evs = tap(s.w), d1 = hit(s.w, s.p, s.e, 100, { kind: 'weapon' }); evs.step();
  near(d1, plain + (200 + add) * 3 * (1 + bm), 1e-6, 'a 4% pool pops for x3 (with the Bleed damage bonus), on top of the hit'); near(s.e.bleedPool, 0, 1e-9, 'and is emptied'); ok(evs.all.filter(v => v.t === 'chain' && v.k === 'm').length === 1, 'one pop event for the viewer');
  s.e.bleedPool = 400; near(hit(s.w, s.p, s.e, 100, { kind: 'weapon' }), plain, 1e-6, 'the same foe does not pop again within 1 s'); run(s.w, 1.05); s.e.bleedPool = 400;
  near(hit(s.w, s.p, s.e, 100, { kind: 'weapon' }), plain + (400 + add) * 3 * (1 + bm), 1e-6, 'and does after 1 s');
  s = mk(3); const o = foe(s.w, 260, 212); o.bleedPool = 400; o.bleedOwner = s.p; s.e.bleedPool = 400; hit(s.w, s.p, s.e, 100, { kind: 'weapon' }); near(o.bleedPool, 400, 1e-9, 'only the struck foe pops');
  s = mk(3); s.e.bleedPool = 400; near(hit(s.w, s.p, s.e, 100, { kind: 'dot', bleed: true, noProc: true, raw: true }), 100, 1e-6, 'a status tick never pops it'); near(s.e.bleedPool, 400, 1e-9, 'and leaves the pool');
  s = mk(3); s.e.bleedPool = 400; ok(hit(s.w, s.p, s.e, 100, { kind: 'skill', part: 'volley.arrow' }) > 400 * 3, 'a skill hit pops it too');
  s = mk(3); s.e.fodder = true; s.e.bleedPool = 400; hit(s.w, s.p, s.e, 1, { kind: 'weapon' }); near(s.e.bleedPool, 0, 1e-9, 'a fodder foe pops too');
  s = mk(3, true); s.e.bleedPool = 14 - add - 1; hit(s.w, s.p, s.e, 100, { kind: 'weapon' }); ok(s.e.bleedPool > 10 - add, 'a boss pool under 0.3% does not pop');
  s = mk(3, true); s.e.bleedPool = 16 - add; const db = hit(s.w, s.p, s.e, 100, { kind: 'weapon' }); near(db, plain + 16 * 3 * (1 + bm), 1e-6, 'a boss pops at 0.3%');
  const again = (secs) => { run(s.w, secs); s.e.bleedPool = 50; return hit(s.w, s.p, s.e, 100, { kind: 'weapon' }); };
  near(again(2), plain, 1e-6, 'a boss does not pop again after 2 s'); near(again(1.1), plain, 1e-6, 'nor after 3.1 s'); near(again(1), plain + (50 + add) * 3 * (1 + bm), 1e-6, 'but does after 4 s');
}

// ---- Plaguebearer (r_el_b rank 3): a dying foe with 2+ ailments bursts (r90): 85% of its Bleed and Burn to every foe inside, its other statuses spread ----
{
  const mk = (rank, cfg) => {
    const { w, p } = stage({ r_el: 1, r_el_b: rank }), a = foe(w, 200, 212), n1 = foe(w, 240, 212), n2 = foe(w, 200, 285), outside = foe(w, 200, 112), evs = tap(w);
    burn6(w, a, p); a.bleedPool = 400; a.bleedOwner = p; a.chill = 40; a.chillOwner = p; if (cfg) cfg(a);
    return { w, p, a, n1, n2, outside, evs, due: () => 0.85 * (a.bleedPool * (1 + p.stats.bleedMul) + a.burnPool * (1 + p.stats.burnMul)) };
  };
  let s = mk(3);
  near(s.p.stats.plagueBurst, 0.85, 1e-9, 'rank 3: bursts 85%'); ok(!stage({ r_el: 1, r_el_b: 2 }).p.stats.plague, 'no Plaguebearer at rank 2');
  const due = s.due(); hit(s.w, s.p, s.a, 1e9, { kind: 'weapon' }); run(s.w, 0.03, s.evs.step); ok(s.n1.hp === 5000 && !s.evs.all.some(v => v.k === 'g'), 'the burst waits 0.05 s');
  run(s.w, 0.1, s.evs.step); near(5000 - s.n1.hp, due, 1e-6, `a foe inside takes 85% of the Bleed and of the Burn still due (${due.toFixed(0)})`); near(5000 - s.n2.hp, due, 1e-6, 'every foe inside takes it (a second one 73 away too)'); ok(s.outside.hp === 5000, 'a foe 100 away does not');
  ok(s.evs.all.filter(v => v.t === 'chain' && v.k === 'g').length === 1, 'one burst event'); near(s.a.bleedPool + s.a.burnPool + (s.a.burnN | 0), 0, 1e-9, 'the corpse gives up its Bleed and its Burn stacks');
  ok(s.n1.chill > 0 && s.n2.chill > 0, 'the other statuses (Chill) spread to every foe inside'); ok(!(s.n1.burnN > 0) && s.n1.bleedPool === 0, 'Burn and Bleed do not spread'); ok(s.outside.chill === 0, 'nor to a foe outside');
  s = mk(3, a => { a.bleedPool = 0; a.chill = 0; }); hit(s.w, s.p, s.a, 1e9, { kind: 'weapon' }); run(s.w, 0.3); ok(s.n1.hp === 5000, 'a foe with one ailment bursts nothing');
  s = mk(3); s.a.fodder = true; hit(s.w, s.p, s.a, 1e9, { kind: 'weapon' }); run(s.w, 0.3); ok(s.n1.hp === 5000, 'a fodder foe bursts nothing (fodder deaths fire no on-death effect)');
  s = mk(2); hit(s.w, s.p, s.a, 1e9, { kind: 'weapon' }); run(s.w, 0.3); ok(s.n1.hp === 5000 && s.n1.burnN > 0, 'at rank 2 the statuses spread (Outbreak) and nothing bursts');
  const o2 = stage({ r_el: 1, r_el_b: 3 }, 0, [{ pid: 'p1' }]), b = foe(o2.w, 200, 212), g = foe(o2.w, 240, 212); burn6(o2.w, b, o2.p); b.bleedPool = 400; hit(o2.w, o2.w.players.get('p1'), b, 1e9, { kind: 'weapon' }); run(o2.w, 0.3); ok(g.hp === 5000, 'a kill by a hero without the card bursts nothing');
  const { w, p } = stage({ r_el: 1, r_el_b: 3 }), a = foe(w, 200, 212), c1 = foe(w, 270, 212), c2 = foe(w, 340, 212); burn6(w, a, p); a.bleedPool = 400; a.bleedOwner = p; // a chain of deaths
  c1.maxHp = c1.hp = 300; c1.bleedTick = 5; c1.bleedPool = 200; c1.bleedOwner = p; c1.chill = 40; hit(w, p, a, 1e9, { kind: 'weapon' }); run(w, 0.6);
  ok(c1.hp <= 0, 'the burst kills a weak neighbour'); near(5000 - c2.hp, 0.85 * 200 * (1 + p.stats.bleedMul), 1e-6, 'whose own burst, at its own pools, reaches the next foe');
}

// ---- events and the wire ----
{
  ok(N.CAPS.skyfx === 6 && N.CAPS.hunt === 6 && N.CAPS.split === 8 && N.CAPS_LOCAL.skyfx === 2, 'the Ranger events are capped per snapshot');
  const evs = []; for (let i = 0; i < 20; i++) evs.push({ t: 'split', x: i }); ok(N.capFx(evs, N.CAPS).length === 8, 'capFx cuts splits to 8');
}
console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
