// Headless check of the Shade tree (exit 1 on failure). Usage: node tools/check-hero-shade.js
// 1. Tree shape: 3 paths x 3 ranks, card lines <= 40 chars naming no Form; every rank changes the effective numbers; 3 pure Forms + 2 hybrids, each with 2 refines.
// 2. Form rules: each Form is ready only with its path(s) at rank 3, one Form per run; every Form fires and deals damage (10 s ring).
// 3. Mechanics: stab reach (a foe at 40 px is hit, one at 140 px is not), crit all-or-none per stab, execute, mark on the elite + shadow cuts, bloom blades, returning and fan daggers, pins.
// 4. View clamp: a foe outside the hero's view takes no weapon or skill damage. 5. Shadow Step at levels 1..4 casts, blinks and deals damage. 6. Determinism digest (60 s run, twice).
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const ROOT = 'daggers', FORMS = ['thousand', 'assassinate', 'shadowfan'], HYB = [['lotus', [0, 1]], ['reaper', [1, 2]]];

// World with the spawner and XP silenced; god cheat. Hero at rest aiming east (mdir 0, cursor 100 px east).
function world(seed) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'P', slot: 0, cls: 'shade', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  const p = w.heroes[0]; p.mdir = 0; p.in.ax = p.x + 100; p.in.ay = p.y;
  return w;
}
const step = (w, s, fn) => { for (let i = 0; i < Math.round(s * 60); i++) { if (fn) fn(i); w.update(C.TICK); w.events.length = 0; } };
const build = (w, p, ranks, form) => { const ws = p.weapons[0]; for (let i = 0; i < 3; i++) for (let r = 0; r < ranks[i]; r++) w.rankPath(p, ws, i); if (form) { w.takeForm(p, ws, form); while (w.refineForm(p, ws)); } w.recalc(p, false); return ws; };
const HP = { hpMul: 1 };
function ring(w, x, y, n, r, k, hpMul) { HP.hpMul = hpMul || 1; for (let i = 0; i < n; i++) { const a = i / n * U.TAU; w.spawnFoe(k || 'skeleton', x + Math.cos(a) * r, y + Math.sin(a) * r, HP); } }
const sKey = (S) => JSON.stringify(Object.keys(S).sort().map(k => [k, typeof S[k] === 'number' ? +S[k].toFixed(4) : S[k]]));

// 1. tree shape
const root = ED.WEAPONS[ROOT], names = FORMS.concat(HYB.map(h => h[0])).map(id => ED.WEAPONS[id] && ED.WEAPONS[id].name.toLowerCase());
ok(root.paths.length === 3 && root.paths.every(pa => pa.ranks.length === 3), 'Twin Daggers: 3 paths x 3 ranks');
const lines = [];
root.paths.forEach(pa => pa.ranks.forEach(r => lines.push(r.txt)));
for (const id of FORMS.concat(HYB.map(h => h[0]))) { const d = ED.WEAPONS[id]; lines.push(d.txt); d.refine.forEach(r => lines.push(r.txt)); }
ok(lines.every(l => l.length <= 40), 'every card line <= 40 chars');
ok(root.paths.every(pa => pa.ranks.every(r => !names.some(n => r.txt.toLowerCase().indexOf(n) >= 0))), 'no path rank line names a Form');
ok(root.paths.map(pa => pa.form).join() === FORMS.join(), 'pure Forms: ' + FORMS.join(', '));
ok(root.hybrids.length === 2 && HYB.every(([id, need], j) => root.hybrids[j].form === id && root.hybrids[j].need.join() === need.join()), 'hybrids: lotus (0+1), reaper (1+2)');
for (const id of FORMS.concat(HYB.map(h => h[0]))) { const d = ED.WEAPONS[id]; ok(d.form && d.evolved && d.from === ROOT && d.refine.length === 2, `${id}: Form of ${ROOT} with 2 refines`); }
for (let i = 0; i < 3; i++) {
  const w = world(), p = w.heroes[0], ws = p.weapons[0];
  let prev = sKey(w.weaponS(p, 0));
  for (let r = 0; r < 3; r++) { w.rankPath(p, ws, i); w.recalc(p, false); const k = sKey(w.weaponS(p, 0)); ok(k !== prev, `${root.paths[i].name} rank ${r + 1} changes the numbers ("${root.paths[i].ranks[r].txt}")`); prev = k; }
}
for (const id of FORMS.concat(HYB.map(h => h[0]))) {
  const w = world(), p = w.heroes[0], ws = build(w, p, [3, 3, 3], null);
  w.takeForm(p, ws, id); w.recalc(p, false);
  let prev = sKey(w.weaponS(p, 0));
  for (let r = 0; r < 2; r++) { w.refineForm(p, ws); w.recalc(p, false); const k = sKey(w.weaponS(p, 0)); ok(k !== prev, `${id} refine ${r + 1} changes the numbers`); prev = k; }
}

// 2. Form rules + every Form fires
{
  const ready = (pr) => { const w = world(), p = w.heroes[0], ws = build(w, p, pr, null); return w.formsReady(p, ws).map(f => f.id).sort().join(); };
  ok(ready([0, 0, 0]) === '' && ready([2, 2, 2]) === '', 'no Form below rank 3');
  ok(ready([3, 0, 0]) === 'thousand' && ready([0, 3, 0]) === 'assassinate' && ready([0, 0, 3]) === 'shadowfan', 'one path at 3: its pure Form only');
  ok(ready([3, 3, 0]) === 'assassinate,lotus,thousand', 'paths 0+1 at 3: + Death Lotus');
  ok(ready([0, 3, 3]) === 'assassinate,reaper,shadowfan', 'paths 1+2 at 3: + Reaper\'s Return');
  ok(ready([3, 0, 3]) === 'shadowfan,thousand', 'paths 0+2 at 3: no hybrid');
  const w = world(), p = w.heroes[0], ws = build(w, p, [3, 3, 3], 'lotus');
  ok(ws.id === 'lotus' && w.formsReady(p, ws).length === 0 && !w.takeForm(p, ws, 'thousand'), 'one Form per run: none ready once taken, a second take fails');
  for (const id of FORMS.concat(HYB.map(h => h[0]))) {
    const w2 = world(20), p2 = w2.heroes[0];
    build(w2, p2, [3, 3, 3], id);
    let err = null;
    try { step(w2, 10, (i) => { if (i % 30 === 0 && w2.foes.filter(e => !e.dead).length < 30) ring(w2, p2.x, p2.y, 16, 50 + (i % 4) * 20, 'skeleton', 15); }); } catch (e) { err = e; }
    ok(!err && (p2.dealt[id] || 0) > 0, `${id}: fires, 10 s dps ${Math.round((p2.dealt[id] || 0) / 10)}` + (err ? ': ' + err.stack : ''));
  }
}

// 3. mechanics
const sp = (w, p, k, dx, dy, o) => { const e = w.spawnFoe(k, p.x + dx, p.y + dy, o || { hpMul: 1000 }); e.spd = 0; e.def = Object.assign({}, e.def, { kb: 0 }); return e; };
{ // reach: base stab hits a foe 40 px ahead, never one 140 px ahead
  const w = world(), p = w.heroes[0], near = sp(w, p, 'skeleton', 40, -6), far = sp(w, p, 'skeleton', 140, -6);
  step(w, 2);
  ok(near.hp < near.maxHp && far.hp === far.maxHp, `stab reach: 40 px foe hit (${near.maxHp - near.hp}), 140 px foe untouched`);
}
{ // crit all-or-none per stab: two foes on one stab line take equal damage every stab
  const w = world(), p = w.heroes[0], a = sp(w, p, 'skeleton', 24, -6), b = sp(w, p, 'skeleton', 44, -6);
  let same = 0, n = 0;
  for (let i = 0; i < 240; i++) { const ha = a.hp, hb = b.hp; w.update(C.TICK); w.events.length = 0; const da = ha - a.hp, db = hb - b.hp; if (da > 0 || db > 0) { n++; if (da === db) same++; } }
  ok(n > 4 && same === n, `crit rolled per stab: ${same}/${n} stabs dealt equal damage to both foes on the line`);
}
{ // execute: Lethality rank 1 kills a foe left under 10% HP
  const w = world(), p = w.heroes[0]; build(w, p, [0, 1, 0], null);
  const e = w.spawnFoe('skelknight', p.x + 30, p.y - 6, { hpMul: 1 }); e.spd = 0;
  e.hp = Math.ceil(e.maxHp * 0.1) + 5;
  step(w, 1);
  ok(e.dead, `execute: a foe near 10% HP dies to one stab (${e.dead ? 'dead' : e.hp + ' HP left'})`);
}
{ // cursor aim: stabs go along the cursor past a foe 46 px north; Assassinate stabs take the mark only within 0.9 rad of the cursor
  const w = world(), p = w.heroes[0], n = sp(w, p, 'skeleton', 0, -46);
  step(w, 1);
  ok(n.hp === n.maxHp, `stabs follow the cursor (east), a foe north is untouched (${n.maxHp - n.hp} dealt)`);
  const stabs = (dx, dy) => {
    const w = world(), p = w.heroes[0]; build(w, p, [0, 3, 0], 'assassinate');
    const el = sp(w, p, 'skelknight', 34, 14); w.promoteElite(el); el.spd = 0;
    p.in.ax = p.x + dx; p.in.ay = p.y + dy;
    const as = [], seen = new Set();
    step(w, 1, () => { for (const z of w.zones) if (!z.dead && (z.k === 'stab' || z.k === 'stabx') && !seen.has(z.id)) { seen.add(z.id); as.push(z.a); } });
    return { as, m: Math.atan2(el.y - p.y + 6, el.x - p.x), c: Math.atan2(dy, dx) };
  };
  const inC = stabs(100, 0), outC = stabs(54, -84);
  ok(inC.as.length > 0 && inC.as.every(a => Math.abs(U.angDiff(a, inC.m)) < 1e-6), `assassinate: the mark ${(inC.m).toFixed(2)} rad off the cursor draws the stabs (${inC.as.length})`);
  ok(outC.as.length > 0 && outC.as.every(a => Math.abs(U.angDiff(a, outC.c)) < 1e-6), `assassinate: a mark ${Math.abs(U.angDiff(outC.c, outC.m)).toFixed(2)} rad off the cursor does not; stabs go along the cursor (${outC.as.length})`);
}
{ // Assassinate: the elite is marked over trash; the shadow's X cuts hit it 150 px away, forced crits
  const w = world(), p = w.heroes[0]; build(w, p, [0, 3, 0], 'assassinate');
  for (let i = 0; i < 6; i++) sp(w, p, 'skeleton', -60 - i * 12, 40);
  const el = sp(w, p, 'skelknight', 150, 0); w.promoteElite(el); el.spd = 0;
  let crits = 0;
  step(w, 3, () => { for (const ev of w.events) if (ev.t === 'hit' && ev.id === el.id && ev.crit) crits++; });
  const ws = p.weapons[0];
  ok(ws.st.mark === el && el.hp < el.maxHp, `assassinate marks the elite and its shadow cuts it from 150 px (dealt ${Math.round(el.maxHp - el.hp)})`);
  ok(w.zones.some(z => z.k === 'smark' && !z.dead), 'assassinate: a mark zone sits on the elite');
}
{ // Death Lotus: a crit stab blooms blades that hit a foe beside its first foe
  const w = world(), p = w.heroes[0]; build(w, p, [3, 3, 0], 'lotus');
  p.stats.crit = 1; for (const ws of p.weapons) ws.Sv = -1;
  const a = sp(w, p, 'skelknight', 30, -6), side = sp(w, p, 'skeleton', 30, 22);
  step(w, 0.5, () => { a.x = p.x + 30; a.y = p.y - 6; side.x = p.x + 30; side.y = p.y + 22; });
  ok(side.hp < side.maxHp, `death lotus: bloom blades hit the foe beside the struck one (${side.maxHp - side.hp})`);
}
{ // Return: thrown daggers fly out and come back; Shadow Fan throws both ways
  const w = world(), p = w.heroes[0]; build(w, p, [0, 0, 1], null);
  let seen = 0, back = false;
  step(w, 2, () => { for (const pr of w.projs) if (!pr.dead && pr.k === 'rknife') { seen++; if (pr.back) back = true; } });
  ok(seen > 0 && back, 'return rank 1: a thrown dagger flies out and back');
  const w2 = world(), p2 = w2.heroes[0]; build(w2, p2, [0, 0, 3], 'shadowfan');
  let fwd = 0, rear = 0;
  step(w2, 0.6, () => { for (const pr of w2.projs) if (!pr.dead && pr.k === 'sknife' && pr.t < 0.05) { if (Math.cos(pr.a) > 0) fwd++; else rear++; } });
  ok(fwd > 0 && rear > 0 && fwd === rear, `shadow fan: daggers forward (${fwd}) and behind (${rear})`);
}
{ // Reaper's Return: a pinning dagger sticks to its foe (follows it), then tears back
  const w = world(), p = w.heroes[0]; build(w, p, [0, 3, 3], 'reaper');
  const e = sp(w, p, 'skelknight', 90, -6);
  let pinned = 0, tore = false;
  step(w, 3, (i) => { e.x = p.x + 90 + (i % 60 < 30 ? 10 : 0); const P = p.weapons[0].st.pins; if (P.length && P.some(s => s.id === e.id)) pinned++; for (const pr of w.projs) if (!pr.dead && pr.k === 'pknife' && pr.back && pr.critC === 1) tore = true; });
  ok(pinned > 30 && tore, `reaper: a dagger stays pinned in the foe (${pinned} ticks) and tears back as a crit`);
}

// 4. view clamp: a foe outside the view takes nothing (weapon Forms + Q)
for (const id of [null, 'thousand', 'assassinate', 'shadowfan', 'lotus', 'reaper']) {
  const w = world(9), p = w.heroes[0]; build(w, p, [3, 3, 3], id);
  p.skills[0].lvl = 4;
  const out = sp(w, p, 'skelknight', 0, ED.HERO_VIEW.hh + 40), inn = sp(w, p, 'skelknight', 40, -6);
  step(w, 4, (i) => { out.x = p.x; out.y = p.y + ED.HERO_VIEW.hh + 40; if (i % 60 === 0) w.input(p.pid, { q: true, ax: p.x + 30, ay: p.y }); });
  ok(out.hp === out.maxHp && inn.hp < inn.maxHp, `${id || 'daggers'}: no damage outside the view (in-view foe dealt ${Math.round(inn.maxHp - inn.hp)})`);
}

// 5. Shadow Step levels
for (let L = 1; L <= 4; L++) {
  const w = world(30 + L), p = w.heroes[0]; p.weapons.length = 0; p.skills[0].lvl = L;
  ring(w, p.x + 100, p.y, 10, 30, 'skeleton', 20);
  const x0 = p.x;
  w.input(p.pid, { q: true, ax: p.x + 400, ay: p.y }); w.update(C.TICK); w.events.length = 0;
  const moved = p.x - x0; step(w, 1.2);
  const N = w.skillN(p, 0);
  ok(moved > 120 && (p.dealt.step || 0) > 0 && N.cd >= 6, `shadow step L${L}: blinks ${Math.round(moved)} px, dealt ${Math.round(p.dealt.step || 0)}, cd ${N.cd} s`);
}

// 6. determinism: 60 s with level-ups, Q and dash spam, same digest twice
function full(seed) {
  const w = new ED.World({ seed, stage: 0, players: [{ pid: 'p1', name: 'P', slot: 0, cls: 'shade', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  const p = w.heroes[0]; build(w, p, [3, 3, 3], 'reaper');
  let digest = 0;
  for (let tick = 0; tick < 3600; tick++) {
    const a = tick / 60 * 0.7;
    w.input(p.pid, { mx: Math.cos(a), my: Math.sin(a), ax: p.x + Math.cos(a * 3) * 120, ay: p.y + Math.sin(a * 3) * 120, q: tick % 30 === 0, dash: tick % 300 === 90, pick: p.offer ? 1 : 0 });
    w.update(C.TICK); w.events.length = 0;
    if (tick % 60 === 0) { const s = w.kills + '|' + w.level + '|' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + '|' + w.foes.length + '|' + w.projs.length + '|' + w.zones.length; digest = (Math.imul(digest, 31) + U.hashStr(s)) >>> 0; }
  }
  return { digest, kills: w.kills };
}
{
  const a = full(41), b = full(41);
  ok(a.digest === b.digest && a.kills > 0, `determinism: same digest twice (${a.digest}, kills ${a.kills})`);
}

console.log(`check-hero-shade: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
