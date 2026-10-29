// Headless check of the Bell's Toll tree and Great Peal (exit 1 on failure). Usage: node tools/check-hero-bell.js
// 1. Cards: 3 paths x 3 ranks, lines <= 40 chars that never name a Form; every rank changes the weapon's numbers and its pattern (checked per rank).
// 2. Forms: each is ready only under its rule (pure: its path at 3; hybrid: both paths at 3), one Form per run, refines twice, fires, and draws its own pattern.
// 3. View clamp: rings neither damage nor stun a foe outside the hero's view. 4. Great Peal at levels 1-4 (zero damage stun + push, echo, shield, gems, cooldown >= 7 s). 5. Determinism digest per Form.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const ROOT = ED.WEAPONS.toll, FORMS = ED.weaponForms('toll');

// Silent world (no spawner, no xp), god mode, hero facing east at rest.
function world(seed) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'P1', slot: 0, cls: 'bell', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  return w;
}
const HP = { hpMul: 1 };
// n foes of kind k on a ring of radius r around (x, y), HP x hpMul.
function ring(w, x, y, n, r, k, hpMul) { HP.hpMul = hpMul || 1; for (let i = 0; i < n; i++) { const a = i / n * U.TAU; w.spawnFoe(k || 'skeleton', x + Math.cos(a) * r, y + Math.sin(a) * r, HP); } }
// Runs s seconds; fn(tick) per tick; collects events of type t into out (optional). Returns error or null.
function run(w, s, fn, out) {
  try {
    for (let i = 0; i < Math.round(s * 60); i++) {
      if (fn) fn(i);
      w.update(C.TICK);
      if (out) for (const ev of w.events) out.push(ev);
      w.events.length = 0;
    }
  } catch (e) { return e; }
  return null;
}
// Hero with ranks [a, b, c] (and Form id refined fully, or '').
function build(ranks, form, seed) {
  const w = world(seed), p = w.heroes[0], ws = p.weapons[0];
  for (let i = 0; i < 3; i++) for (let r = 0; r < ranks[i]; r++) w.rankPath(p, ws, i);
  if (form) { w.takeForm(p, ws, form); while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return { w, p, ws };
}
const looks = (w, k) => w.zones.filter(z => !z.dead && z.k === k);
const S0 = (ranks, form) => { const { w, p } = build(ranks, form); return Object.assign({}, w.weaponS(p, 0)); };

// 1. cards and ranks
const names = FORMS.map(f => ED.WEAPONS[f.id].name.toLowerCase());
ok(ROOT.paths.length === 3 && ROOT.paths.every(pa => pa.ranks.length === 3), 'toll: 3 paths x 3 ranks');
const lines = [];
for (const pa of ROOT.paths) for (const rk of pa.ranks) lines.push(rk.txt);
for (const f of FORMS) for (const rf of ED.WEAPONS[f.id].refine) lines.push(rf.txt);
ok(lines.every(l => l.length <= 40 && !names.some(n => l.toLowerCase().includes(n))), 'card lines <= 40 chars, no Form named: ' + lines.filter(l => l.length > 40 || names.some(n => l.toLowerCase().includes(n))).join(' | '));
for (let i = 0; i < 3; i++) for (let r = 1; r <= 3; r++) {
  const a = [0, 0, 0], b = [0, 0, 0]; a[i] = r - 1; b[i] = r;
  const sa = S0(a, ''), sb = S0(b, ''), diff = Object.keys(sb).filter(k => sa[k] !== sb[k]);
  ok(diff.length > 0, `path ${ROOT.paths[i].name} rank ${r} changes ${diff.join(', ')}`);
}
// Pattern per rank: zones and statuses seen over s (3) s in 24-foe rings at 60 and 120 px (HP x hpMul, default 40) for ranks given; returns { maxWaves, looks, frozen, stunned, slowed, booms, rMin, rMax }.
function pattern(ranks, form, s, hpMul) {
  const { w, p, ws } = build(ranks, form, 9), seen = new Set(), ev = [];
  ring(w, p.x, p.y, 24, 60, 'skeleton', hpMul || 40); ring(w, p.x, p.y, 24, 120, 'skeleton', hpMul || 40);
  let maxWaves = 0, frozen = 0, stunned = 0, slowed = 0, rMin = 1e9, rMax = 0;
  const bellK = { toll: 'tollb', cathedral: 'cathb', glaciertoll: 'glacb', carillon: 'carb', undertow: 'tollb', windchime: 'tollb' }[ws.id];
  const err = run(w, s || 3, () => {
    let wv = 0;
    for (const z of w.zones) if (!z.dead) { seen.add(z.k); if (/w$/.test(z.k)) wv++; if (z.k === bellK) { const d = Math.hypot(z.x - p.x, z.y - p.y + 6); rMin = Math.min(rMin, d); rMax = Math.max(rMax, d); } }
    maxWaves = Math.max(maxWaves, wv);
    for (const e of w.foes) if (!e.dead) { if (e.freezeT > 0) frozen++; if (e.stunT > 0) stunned++; if (e.slowT > 0) slowed++; }
  }, ev);
  return { err, w, p, ws, maxWaves, looks: seen, frozen, stunned, slowed, booms: ev.filter(e => e.t === 'boom' && e.look === 'frost').length, rMin, rMax, dealt: p.dealt[ws.id] || 0 };
}
{
  const b = pattern([0, 0, 0]), e1 = pattern([2, 0, 0]), s3 = pattern([3, 0, 0]);
  ok(!b.err && b.dealt > 0 && b.looks.has('tollb') && b.looks.has('tollw'), `toll base: one bell, bronze rings, dealt ${Math.round(b.dealt)}`);
  ok(e1.maxWaves > b.maxWaves, `Peal 2: echo rings (${b.maxWaves} -> ${e1.maxWaves} waves at once)`);
  ok(b.stunned === 0 && s3.stunned > 0, `Peal 3: rings stun (${s3.stunned} foe-ticks)`);
  const c1 = pattern([0, 1, 0]), c2 = pattern([0, 2, 0], '', 7, 0.5), c3 = pattern([0, 3, 0]);
  ok(c1.looks.has('tollf') && c1.slowed > 0 && b.slowed === 0, 'Resonance 1: frost rings slow');
  ok(c2.booms > 0 && b.booms === 0, `Resonance 2: ring kills burst in ice (${c2.booms} bursts)`);
  ok(c3.looks.has('rime') && !c2.looks.has('rime'), 'Resonance 3: frost ground');
  const d1 = pattern([0, 0, 1]), d2 = pattern([0, 0, 2]), d3 = pattern([0, 0, 3]);
  ok(d1.rMax > b.rMax + 20, `Pendulum 1: wider orbit (${b.rMax.toFixed(0)} -> ${d1.rMax.toFixed(0)} px)`);
  const nb = (r) => looks(r.w, 'tollb').length;
  ok(nb(d2) === 2 && nb(d3) === 3, `Pendulum 2-3: +1 bell each (${nb(d2)}, ${nb(d3)})`);
  ok(d3.rMax / d3.rMin > 2 && d2.rMax - d2.rMin < 1, `Pendulum 3: bells swing out and back (${d3.rMin.toFixed(0)}..${d3.rMax.toFixed(0)} px)`);
}

// 2. Forms
ok(FORMS.length === 5 && FORMS.filter(f => f.path < 0).length === 2, 'toll: 3 pure Forms + 2 hybrids: ' + FORMS.map(f => f.id + '[' + f.need + ']').join(' '));
for (const f of FORMS) {
  const ready = (ranks) => { const { w, p, ws } = build(ranks, ''); return w.formsReady(p, ws).some(x => x.id === f.id); };
  const at = (v) => [0, 1, 2].map(i => (f.need.includes(i) ? v : 0));
  const others = [0, 1, 2].map(i => (f.need.includes(i) ? 0 : 3));
  const one = f.need.length > 1 ? [0, 1, 2].map(i => (i === f.need[0] ? 3 : 0)) : null;
  ok(!ready(at(2)) && !ready(others) && (!one || !ready(one)) && ready(at(3)), `${f.id}: ready only with path(s) ${f.need.join('+')} at rank 3`);
  const { w, p, ws } = build(at(3), '');
  ok(w.takeForm(p, ws, f.id) && w.formsReady(p, ws).length === 0 && !w.takeForm(p, ws, FORMS.find(x => x.id !== f.id).id), `${f.id}: taken; no other Form after it`);
  ok(w.refineForm(p, ws) === 1 && w.refineForm(p, ws) === 2 && w.refineForm(p, ws) === 0, `${f.id}: 2 refines`);
}
{
  const c = pattern([3, 0, 0], 'cathedral'), S = c.w.weaponS(c.p, 0);
  ok(!c.err && c.dealt > 0 && looks(c.w, 'cathb').length === (S.n | 0), `cathedral: ${S.n | 0} great bells, dealt ${Math.round(c.dealt)}`);
  const { w, p } = build([3, 0, 0], 'cathedral', 9), big = new Set();
  run(w, 2.5, () => { for (const z of w.zones) if (!z.dead && z.k === 'cathw' && z.x === p.x && z.y === p.y - 6 && z.st && z.st.R > S.r * S.area * 1.5) big.add(z.id); });
  ok(big.size >= 2, `cathedral: great rings burst from the hero (${big.size} in 2.5 s, refined: 2 per peal)`);
}
{
  const g = pattern([0, 3, 0], 'glaciertoll');
  ok(!g.err && g.dealt > 0 && g.frozen > 0 && g.looks.has('glacw') && g.looks.has('glacb'), `glacier toll: frost rings freeze (${g.frozen} foe-ticks), dealt ${Math.round(g.dealt)}`);
  ok(g.booms > 0, `glacier toll: frozen foes shatter (${g.booms} bursts)`);
}
{
  const c = pattern([0, 0, 3], 'carillon');
  ok(!c.err && c.dealt > 0 && looks(c.w, 'carb').length === (c.w.weaponS(c.p, 0).n | 0) && c.rMax / c.rMin > 2, `carillon: ${looks(c.w, 'carb').length} bells sweep ${c.rMin.toFixed(0)}..${c.rMax.toFixed(0)} px, dealt ${Math.round(c.dealt)}`);
}
{ // undertow: a closing ring drags far foes in (knockback-able foes at 150 px end nearer)
  const { w, p } = build([3, 0, 3], 'undertow', 9);
  ring(w, p.x, p.y, 16, 150, 'skeleton', 200);
  let d0 = 0; for (const e of w.foes) d0 += Math.hypot(e.x - p.x, e.y - p.y);
  w.foes.forEach(e => { e.spd = 0; });
  const seen = new Set(), err = run(w, 1.0, () => { for (const z of w.zones) if (!z.dead) seen.add(z.k); });
  let d1 = 0; for (const e of w.foes) d1 += Math.hypot(e.x - p.x, e.y - p.y);
  ok(!err && seen.has('underw') && d1 / 16 < d0 / 16 - 30 && (p.dealt.undertow || 0) > 0, `undertow: closing ring drags foes in (mean ${(d0 / 16).toFixed(0)} -> ${(d1 / 16).toFixed(0)} px)`);
}
{ // windchime: chimes stay where they fell and keep ringing after the hero leaves
  const { w, p } = build([0, 3, 3], 'windchime', 9);
  run(w, 1.0);
  const ch = looks(w, 'chime');
  const x0 = p.x, ids = new Set(ch.map(z => z.id));
  let rang = false;
  run(w, 1.5, () => { w.input(p.pid, { mx: 1, my: 0, ax: p.x + 50, ay: p.y }); for (const z of w.zones) if (!z.dead && z.k === 'chimew' && x0 - z.x > -100 && z.x < x0 + 70) rang = true; });
  const still = w.zones.filter(z => !z.dead && z.k === 'chime' && ids.has(z.id));
  ok(ch.length > 0 && still.length > 0 && p.x - x0 > 60 && rang, `windchime: ${ch.length} chimes dropped, ${still.length} still ringing after the hero walked ${Math.round(p.x - x0)} px`);
}
for (const f of FORMS) { // every Form fires and deals damage in a crowd with all ranks
  const r = pattern([3, 3, 3], f.id, 4);
  ok(!r.err && r.dealt > 0, `${f.id} (3/3/3, refined): 4 s, dealt ${Math.round(r.dealt)}` + (r.err ? ': ' + r.err.stack : ''));
}

// 3. view clamp: a foe just outside the view (below) is never hit or stunned by rings, Cathedral great rings or Great Peal; one inside is
for (const form of ['', 'cathedral']) {
  const { w, p } = build([3, 0, 0], form, 3);
  p.skills[0].lvl = 4;
  const out = w.spawnFoe('skeleton', p.x, p.y - ED.HERO_VIEW.oy + ED.HERO_VIEW.hh + 30, { hpMul: 50 }), inn = w.spawnFoe('skeleton', p.x + 90, p.y, { hpMul: 50 });
  out.spd = inn.spd = 0;
  let outHit = false;
  run(w, 3, (i) => { if (i === 10) w.input(p.pid, { q: true, ax: p.x, ay: p.y }); out.y = p.y - ED.HERO_VIEW.oy + ED.HERO_VIEW.hh + 30; out.x = p.x; if (out.hp < out.maxHp || out.stunT > 0) outHit = true; });
  ok(!outHit && inn.hp < inn.maxHp, `${form || 'toll'} + Great Peal: foe outside the view untouched (no damage, no stun), inside hit`);
}

// 4. Great Peal levels
{
  const lvl = (L) => {
    const w = world(3), p = w.heroes[0]; p.skills[0].lvl = L; p.weapons.length = 0; // skill only
    ring(w, p.x, p.y, 20, 120, 'skeleton', 50);
    const d0 = w.foes.map(e => U.dist(p.x, p.y, e.x, e.y));
    w.spawnPickup('xp5', p.x + 200, p.y, 5);
    const ev = [];
    let maxP = 0, stun = 0, inv = 0;
    run(w, 1.4, (i) => {
      if (i === 0) w.input(p.pid, { q: true, ax: p.x, ay: p.y });
      maxP = Math.max(maxP, looks(w, 'pealw').length);
      if (i === 36) { inv = p.invuln; for (const e of w.foes) if (!e.dead && e.stunT > 0) stun++; }
    }, ev);
    const g = w.pickups.find(x => x.k === 'xp5');
    const hurt = w.foes.filter(e => e.hp < e.maxHp).length, pushed = w.foes.filter((e, i) => U.dist(p.x, p.y, e.x, e.y) > d0[i] + 3).length;
    return { w, p, cast: ev.some(e => e.t === 'skill' && e.id === 'peal'), dealt: p.dealt.peal || 0, hurt, pushed, maxP, inv, gem: !g || g.pull === p.pid, stun, cd: p.skills[0].cdMax };
  };
  const L = [1, 2, 3, 4].map(lvl);
  L.forEach((r, i) => ok(r.cast && r.dealt === 0 && r.hurt === 0 && r.stun === 20 && r.pushed >= 15 && r.cd >= 7, `great peal L${i + 1}: cast, zero damage (hurt ${r.hurt}), ${r.stun}/20 stunned, ${r.pushed}/20 pushed, cd ${r.cd}`));
  ok(L[0].maxP === 1 && L[1].maxP === 2, `great peal L2: a second ring (${L[0].maxP} -> ${L[1].maxP})`);
  ok(L[1].inv < 0.1 && L[2].inv > 0.8, `great peal L3: shields the hero (${L[2].inv.toFixed(2)} s left at 0.6 s)`);
  ok(!L[2].gem && L[3].gem, 'great peal L4: pulls gems');
}

// 5. determinism: 20 s with Q spam per Form (3/3/3 refined), twice
const digest = (form) => {
  const { w, p } = build([3, 3, 3], form, 21);
  p.skills[0].lvl = 4;
  let d = 0;
  const rng = U.RNG(4);
  const err = run(w, 20, (i) => {
    if (i % 30 === 0) for (let k = 0; k < 12; k++) { const a = rng.next() * U.TAU, r = 60 + rng.next() * 200; w.spawnFoe(k % 5 ? 'skeleton' : 'skelknight', p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, HP); }
    const a = i / 60 * 0.7;
    w.input(p.pid, { mx: Math.cos(a) * 0.5, my: Math.sin(a) * 0.5, ax: p.x + 40, ay: p.y, q: i % 120 === 0 });
    if (i % 60 === 0) d = (Math.imul(d, 31) + U.hashStr(w.kills + '|' + p.x.toFixed(2) + '|' + w.foes.length + '|' + w.zones.length + '|' + Math.round(p.dealt[form] || 0))) >>> 0;
  });
  return { d, err };
};
for (const f of FORMS) { const a = digest(f.id), b = digest(f.id); ok(!a.err && !b.err && a.d === b.d, `${f.id}: same digest twice (${a.d})` + (a.err ? ': ' + a.err.stack : '')); }

console.log(`check-hero-bell: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
