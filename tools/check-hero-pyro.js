// Headless check for the Pyro tree (exit 1 on failure). Usage: node tools/check-hero-pyro.js
// 1. defs: 3 paths x 3 ranks, 3 pure Forms + 2 hybrids, card lines <= 40 chars that never name a Form; 2. every path rank and refine changes the effective numbers;
// 3. each Form is ready exactly when its paths are at rank 3, one Form per run; 4. every Form fires (crowd and no foe) and deals damage; 5. shells, death blasts and fire leaps act;
// 6. same seed -> same digest; 7. no damage outside the hero's view; 8. Flashpoint at levels 1-4: zero damage push + flee, radius / flee / gem levels, telegraph cancel.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const ROOT = ED.WEAPONS.firebolt, FORMS = ED.weaponForms('firebolt');

const world = (seed) => {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'T', slot: 0, cls: 'pyro', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of w.sdef.timeline) { row.rate = 0; row.floor = 0; }
  w.sp.swarmT = w.sp.eliteT = Infinity; w.sdef = Object.assign({}, w.sdef, { bosses: [], bench: null });
  return w;
};
const build = (w, p, ranks, form) => {
  const ws = p.weapons[0];
  for (let i = 0; i < 3; i++) for (let r = 0; r < ranks[i]; r++) w.rankPath(p, ws, i);
  if (form) { w.takeForm(p, ws, form); while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return ws;
};
// Keeps n skeletons 30-200 px around the hero (seeded ring); returns the spawned count.
const feed = (w, p, rng, n, hpMul) => {
  let k = 0; for (const e of w.foes) if (!e.dead) k++;
  let s = 0;
  for (; k < n; k++, s++) { const a = rng.next() * U.TAU, d = 30 + rng.next() * 170; w.spawnFoe('skeleton', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.6, { hpMul: hpMul || 1 }); }
  return s;
};
const step = (w, p) => { w.update(C.TICK); p.offer = null; p.pend = 0; w.paused = false; };
const S0 = (w, p) => JSON.stringify(ED.Stats.weapon(p, 0));

// 1. defs
{
  const names = FORMS.map(f => ED.WEAPONS[f.id].name.toLowerCase());
  const lines = [];
  ok(ROOT.paths.length === 3 && ROOT.paths.every(pa => pa.ranks.length === 3 && pa.form), 'Fire Bolt: 3 paths x 3 ranks, each with a Form');
  for (const pa of ROOT.paths) for (const r of pa.ranks) lines.push(r.txt);
  ok(FORMS.filter(f => f.path >= 0).length === 3 && FORMS.filter(f => f.path < 0).length === 2, `3 pure Forms + 2 hybrids (${FORMS.map(f => f.id + ':' + f.need.join('+')).join(', ')})`);
  for (const f of FORMS) {
    const d = ED.WEAPONS[f.id];
    ok(d.form && d.evolved && d.from === 'firebolt' && d.refine.length === 2 && d.sig === 'pyro', `${f.id}: Form of firebolt, 2 refine ranks`);
    lines.push(d.txt); for (const r of d.refine) lines.push(r.txt);
  }
  ok(lines.every(l => l.length <= 40), 'card lines <= 40 chars' + lines.filter(l => l.length > 40).map(l => ' [' + l + ']').join(''));
  ok(lines.every(l => names.every(n => l.toLowerCase().indexOf(n) < 0)), 'no card line names a Form');
  ok(ED.WEAPON_IDS.indexOf('inferno') === ED.WEAPON_IDS.indexOf('firebolt') + 1, 'firebolt / inferno keep their registration order');
}

// 2. every rank and refine changes the numbers
{
  for (let i = 0; i < 3; i++) {
    const w = world(), p = w.heroes[0], ws = p.weapons[0];
    for (let r = 1; r <= 3; r++) {
      const a = S0(w, p); w.rankPath(p, ws, i); w.recalc(p, false); const b = S0(w, p);
      ok(a !== b, `${ROOT.paths[i].name} rank ${r} changes the numbers (${ROOT.paths[i].ranks[r - 1].txt})`);
    }
  }
  for (const f of FORMS) {
    const w = world(), p = w.heroes[0], ws = build(w, p, [3, 3, 3], '');
    w.takeForm(p, ws, f.id); w.recalc(p, false);
    for (let r = 1; r <= 2; r++) { const a = S0(w, p); w.refineForm(p, ws); w.recalc(p, false); ok(a !== S0(w, p), `${f.id} refine ${r} changes the numbers`); }
  }
}

// 3. Form rules
{
  let bad = [];
  for (let m = 0; m < 8; m++) {
    const ranks = [m & 1 ? 3 : 2, m & 2 ? 3 : 2, m & 4 ? 3 : 2];
    const w = world(), p = w.heroes[0], ws = build(w, p, ranks, ''), ready = w.formsReady(p, ws).map(f => f.id).sort().join(',');
    const want = FORMS.filter(f => f.need.every(i => ranks[i] === 3)).map(f => f.id).sort().join(',');
    if (ready !== want) bad.push(ranks.join('') + ': ' + ready + ' != ' + want);
    for (const f of FORMS) { const w2 = world(), p2 = w2.heroes[0], ws2 = build(w2, p2, ranks, ''); const took = w2.applyCard(p2, { kind: 'form', id: f.id }) || ws2.id === f.id; if (took !== (want.split(',').indexOf(f.id) >= 0)) bad.push(ranks.join('') + ' took ' + f.id); }
  }
  ok(!bad.length, 'each Form is takeable exactly when its paths are at rank 3' + (bad.length ? ': ' + bad.join('; ') : ''));
  const w = world(), p = w.heroes[0], ws = build(w, p, [3, 3, 3], 'pyre');
  ok(ws.id === 'pyre' && !w.formsReady(p, ws).length && !w.takeForm(p, ws, 'inferno'), 'one Form per run: none ready after one is taken');
}

// 4. every weapon fires in a crowd and with no foe
for (const id of ['firebolt'].concat(FORMS.map(f => f.id))) {
  const w = world(9), p = w.heroes[0], ws = build(w, p, [3, 3, 3], id === 'firebolt' ? '' : id), rng = U.RNG(4);
  let err = null;
  try { for (let i = 0; i < 360; i++) { if (i % 30 === 0) feed(w, p, rng, 80, 2); step(w, p); w.events.length = 0; } } catch (e) { err = e; }
  ok(!err && (p.dealt[id] || 0) > 0, `${id}: deals damage in a crowd (${Math.round(p.dealt[id] || 0)})` + (err ? ': ' + err.stack : ''));
  const v = world(9), q = v.heroes[0]; build(v, q, [3, 3, 3], id === 'firebolt' ? '' : id);
  q.mdir = 0; q.in.ax = q.x + 100; q.in.ay = q.y; v.foes.length = 0;
  let shots = 0, made = 0;
  for (let i = 0; i < 120; i++) { step(v, q); for (const ev of v.events) if (ev.t === 'shoot') shots++; v.events.length = 0; made = Math.max(made, v.zones.length + v.projs.length); }
  ok(shots > 0 && made > 0, `${id}: fires with no foe (${shots} shots, ${made} zones / projectiles)`);
}

// 5. shared mechanics: shells (Mortar on the root), death blasts (a burning foe killed), fire leaps
{
  const w = world(), p = w.heroes[0]; build(w, p, [0, 1, 0], ''); const rng = U.RNG(2);
  let shells = 0;
  for (let i = 0; i < 240; i++) { if (i % 30 === 0) feed(w, p, rng, 30, 3); step(w, p); w.events.length = 0; for (const z of w.zones) if (z.k === 'shell') shells = Math.max(shells, 1); }
  ok(shells > 0, 'Mortar rank 1: the root lobs shells');
  const v = world(), q = v.heroes[0]; build(v, q, [0, 0, 1], ''); v.foes.length = 0;
  for (let i = 0; i < 70; i++) step(v, q); // fills the blast budget
  const e = v.spawnFoe('skeleton', q.x + 40, q.y), f = v.spawnFoe('skeleton', q.x + 50, q.y + 6, { hpMul: 50 });
  v.burn(e, 1, 3, q); v.events.length = 0;
  const s = v.src(q, 'firebolt', 'weapon'); v.hitFoe(e, 1e6, s);
  let boom = null;
  for (let i = 0; i < 20 && !boom; i++) { step(v, q); boom = v.events.find(ev => ev.t === 'boom' && Math.abs(ev.x - e.x) < 2 && Math.abs(ev.y - e.y) < 2); v.events.length = 0; }
  ok(!!boom && f.hp < f.maxHp, `Combustion rank 1: a burning foe that dies explodes and hurts its neighbour (${boom ? 'boom r ' + boom.r : 'no boom'})`);
  const u = world(), h = u.heroes[0]; build(u, h, [0, 0, 3], ''); u.foes.length = 0; h.weapons[0].cd = 99;
  const a = u.spawnFoe('skeleton', h.x + 60, h.y, { hpMul: 50 }), b = u.spawnFoe('skeleton', h.x + 90, h.y, { hpMul: 50 });
  a.spd = b.spd = 0; u.burn(a, 1, 5, h);
  for (let i = 0; i < 60 && !(b.burnT > 0); i++) { h.weapons[0].cd = 99; step(u, h); a.x = h.x + 60; a.y = h.y; b.x = h.x + 90; b.y = h.y; }
  ok(b.burnT > 0, 'Combustion rank 3: fire leaps from a burning foe to its unburnt neighbour');
}

// 6. determinism
for (const id of ['firebolt'].concat(FORMS.map(f => f.id))) {
  const dig = () => {
    const w = world(21), p = w.heroes[0], rng = U.RNG(8); build(w, p, [3, 3, 3], id === 'firebolt' ? '' : id);
    let d = 0;
    for (let i = 0; i < 300; i++) { if (i % 30 === 0) feed(w, p, rng, 60, 2); p.in.q = true; p.in.ax = p.x + 40; p.in.ay = p.y; step(w, p); w.events.length = 0; d = (Math.imul(d, 31) + U.hashStr(w.kills + '|' + w.zones.length + '|' + w.projs.length + '|' + Math.round(p.dealt[p.weapons[0].id] || 0))) >>> 0; }
    return d;
  };
  const a = dig(), b = dig();
  ok(a === b, `${id}: same seed -> same digest (${a})`);
}

// 7. damage only in view: immobile foes 360 px right of the hero (outside the 320 px half-view) never take damage while the crowd burns
for (const id of ['firebolt'].concat(FORMS.map(f => f.id))) {
  const w = world(13), p = w.heroes[0], rng = U.RNG(6); build(w, p, [3, 3, 3], id === 'firebolt' ? '' : id);
  const far = [];
  for (let i = 0; i < 12; i++) far.push(w.spawnFoe('skeleton', p.x + 345 + (i % 3) * 14, p.y - 40 + (i >> 2) * 22, { hpMul: 5 }));
  for (let i = 0; i < 480; i++) {
    if (i % 30 === 0) feed(w, p, rng, 90, 2);
    for (const e of far) { e.x = p.x + 345 + (far.indexOf(e) % 3) * 14; e.spd = 0; }
    p.in.q = true; p.in.ax = p.x + 300; p.in.ay = p.y; step(w, p); w.events.length = 0;
  }
  ok(far.every(e => !e.dead && e.hp === e.maxHp), `${id}: no damage outside the view (${far.filter(e => e.hp < e.maxHp).length} of 12 far foes hurt)`);
}

// 8. Flashpoint levels (zero damage): foes within r slide 120 px away (elites half, bosses / knockback-immune stay) and flee from the hero for 2 s (L3 3.5 s), then return;
// L2 +30% radius; L4 pulls gems within 200 px; a foe in wind-up loses its telegraph.
{
  const def = ED.SKILLS.flashpoint, U2 = U.dist;
  ok(def.cd >= 7 && def.cd <= 16 && def.levels.length === 3 && def.levels.every(l => l.txt.length <= 40) && def.txt.length <= 40, `Flashpoint: cooldown ${def.cd} s, 3 level cards, lines <= 40 chars`);
  for (let L = 1; L <= 4; L++) {
    const w = world(3), p = w.heroes[0]; p.skills[0].lvl = L; p.weapons.length = 0;
    const N = w.skillN(p, 0), cx = p.x, cy = p.y;
    const foes = []; for (let i = 0; i < 12; i++) { const a = i / 12 * U.TAU, d = 30 + (i % 3) * 40; foes.push(w.spawnFoe('skeleton', cx + Math.cos(a) * d, cy + Math.sin(a) * d, { hpMul: 50 })); }
    const edge = w.spawnFoe('skeleton', cx, cy + 165, { hpMul: 50 }), el = w.spawnFoe('skeleton', cx - 50, cy - 30, { elite: true, hpMul: 5 }), im = w.spawnFoe('skelknight', cx + 20, cy - 60, { hpMul: 50 });
    const boss = w.spawnFoe('skeleton', cx - 30, cy + 60, { hpMul: 50 }); boss.boss = true;
    el.spd = im.spd = boss.spd = 0; // isolate the push from walking
    const wind = foes[1]; wind.st = 1; const tz = w.zone({ team: 1, warn: true, src: wind, x: wind.x, y: wind.y, r: 30, dur: 2, look: 'tele' }); wind.tz = tz; wind.tzId = tz.id;
    const gem = w.spawnPickup('xp5', cx + 180, cy, 5);
    const d0 = foes.map(e => U2(cx, cy, e.x, e.y)), de0 = U2(cx, cy, el.x, el.y), di0 = U2(cx, cy, im.x, im.y), db0 = U2(cx, cy, boss.x, boss.y);
    p.in.q = true; p.in.ax = cx + 60; p.in.ay = cy; step(w, p); p.in.q = false; w.events.length = 0;
    const fled = foes.filter(e => e.ovK === 1 && e.ovT > N.flee - 0.1).length, edgeHit = edge.ovK === 1;
    const cancelled = wind.st === 0 && tz.dead;
    for (let i = 0; i < 30; i++) { p.x = cx; p.y = cy; step(w, p); w.events.length = 0; }
    const pushed = foes.filter((e, i) => U2(cx, cy, e.x, e.y) >= d0[i] + 110).length, de = U2(cx, cy, el.x, el.y) - de0;
    for (let i = 0; i < 40; i++) { p.x = cx; p.y = cy; step(w, p); w.events.length = 0; }
    const mid = foes.map(e => U2(cx, cy, e.x, e.y));
    for (let i = 0; i < Math.round((N.flee + 0.6) * 60) - 70; i++) { p.x = cx; p.y = cy; step(w, p); w.events.length = 0; }
    const far = foes.map(e => U2(cx, cy, e.x, e.y));
    for (let i = 0; i < 60; i++) { p.x = cx; p.y = cy; step(w, p); w.events.length = 0; }
    const back = foes.filter((e, i) => U2(cx, cy, e.x, e.y) < far[i] - 10).length, kept = foes.filter((e, i) => far[i] > mid[i] + 10).length;
    const hurt = w.foes.filter(e => e.hp < e.maxHp).length;
    ok(N.cd >= 7 && Math.abs(N.r - 140 * (L >= 2 ? 1.3 : 1)) < 1e-9 && fled === 12 && edgeHit === (L >= 2) && hurt === 0 && !(p.dealt.flashpoint > 0),
      `Flashpoint L${L}: r ${N.r.toFixed(0)}, 12/12 flee ${N.flee} s (${fled}), foe at 165 px hit ${edgeHit}, zero damage (hurt ${hurt})`);
    ok(pushed === 12 && Math.abs(de - 60) < 10 && Math.abs(U2(cx, cy, im.x, im.y) - di0) < 3 && boss.ovT === 0 && Math.abs(U2(cx, cy, boss.x, boss.y) - db0) < 3,
      `Flashpoint L${L}: 12/12 pushed >= 110 px (${pushed}), elite ${de.toFixed(0)} px (half), immune foe moved ${Math.abs(U2(cx, cy, im.x, im.y) - di0).toFixed(0)} px, boss ${Math.abs(U2(cx, cy, boss.x, boss.y) - db0).toFixed(0)} px, boss flee ${boss.ovT}`);
    ok(kept >= 10 && back >= 10 && cancelled, `Flashpoint L${L}: foes keep fleeing (${kept}/12) then come back (${back}/12); wind-up telegraph cancelled ${cancelled}`);
    ok((L >= 4) === (gem.pull === p.pid), `Flashpoint L${L}: gem pull ${gem.pull === p.pid}`);
  }
}

console.log(`check-hero-pyro: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
