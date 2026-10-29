// Headless check for the Pyro tree (exit 1 on failure). Usage: node tools/check-hero-pyro.js
// 1. defs: 3 paths x 3 ranks, 3 pure Forms + 2 hybrids, card lines <= 40 chars that never name a Form; 2. every path rank and refine changes the effective numbers;
// 3. each Form is ready exactly when its paths are at rank 3, one Form per run; 4. every Form fires (crowd and no foe) and deals damage; 5. shells, death blasts and fire leaps act;
// 6. same seed -> same digest; 7. no damage outside the hero's view; 8. Meteor casts at levels 1-4 (echo at 3, extra meteors at 4), cooldown >= 6 s.
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

// 8. Meteor levels
{
  const def = ED.SKILLS.meteor;
  for (let L = 1; L <= 4; L++) {
    const w = world(3), p = w.heroes[0], rng = U.RNG(5); p.skills[0].lvl = L;
    w.weaponS(p, 0); // warm weapon numbers first: Stats.skill's weaponMul call may reuse its level-mod scratch (stats.js)
    const N = w.skillN(p, 0);
    ok(N.cd >= 6 && Math.abs(N.r - 55 * (L >= 2 ? 1.4 : 1)) < 1e-9, `Meteor level ${L}: cooldown ${N.cd} s >= 6, radius ${N.r}`);
    feed(w, p, rng, 60, 3);
    p.in.q = true; p.in.ax = p.x + 60; p.in.ay = p.y;
    let casts = 0, meteors = 0, echo = 0;
    for (let i = 0; i < 150; i++) {
      step(w, p); p.in.q = false;
      for (const ev of w.events) if (ev.t === 'skill' && ev.id === 'meteor') casts++;
      w.events.length = 0;
      let m = 0; for (const z of w.zones) { if (z.k === 'meteor' && !z.dead) m++; if (z.k === 'echo') echo = 1; }
      meteors = Math.max(meteors, m);
    }
    ok(casts === 1 && (p.dealt.meteor || 0) > 0, `Meteor level ${L}: casts once, deals ${Math.round(p.dealt.meteor || 0)}`);
    ok(meteors === (L >= 4 ? 3 : 1) && echo === (L >= 3 ? 1 : 0), `Meteor level ${L}: ${meteors} meteor(s), echo ${echo}`);
  }
  ok(def.levels.length === 3 && def.levels.every(l => l.txt.length <= 40), 'Meteor: 3 level cards, lines <= 40 chars');
}

console.log(`check-hero-pyro: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
