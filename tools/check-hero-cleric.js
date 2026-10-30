// Headless check of the Cleric tree (exit 1 on failure). Usage: node tools/check-hero-cleric.js
// 1. Defs: 3 paths x 3 ranks, 3 pure Forms + 2 hybrids, 2 refines each, card lines <= 40 chars and never naming a Form.
// 2. Every path rank changes the numbers and the pattern it promises (probe scene: a held ring of foes, pillars / leaps / aura / censers / beams counted).
// 3. Forms: each is ready exactly under its rule (pure: its path at 3; hybrid: both paths at 3; none once one is taken) and fires its own pattern.
// 4. Healing: the Censer aura heals an ally inside, Consecration ground heals a hero standing in it. 5. View clamp: no damage on foes outside the hero's view.
// 6. Sanctuary at every level: zero damage; heal, ward, revive, stunning rain. 7. Determinism: a 30 s maxed run per Form twice gives the same digest.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const player = (cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } });
// World with the spawner silenced and no XP (no level-up offers); god unless god === false.
function world(clsList, seed, god) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: clsList.map(player), cheats: { god: god !== false } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  return w;
}
const HP = { hpMul: 1 };
function ring(w, x, y, n, r, hpMul) { HP.hpMul = hpMul || 1; for (let i = 0; i < n; i++) { const a = i / n * U.TAU; w.spawnFoe('skeleton', x + Math.cos(a) * r, y + Math.sin(a) * r, HP); } }
const step = (w, s, fn) => { for (let i = 0; i < Math.round(s * 60); i++) { w.update(C.TICK); if (fn) fn(w.events); w.events.length = 0; } };
const build = (w, p, ranks, form) => {
  const ws = p.weapons[0];
  for (let i = 0; i < 3; i++) for (let r = 0; r < ranks[i]; r++) w.rankPath(p, ws, i);
  if (form) { w.takeForm(p, ws, form); while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return ws;
};
const FORMS = ['wrath', 'halo', 'jray', 'consecration', 'verdict'];
const root = ED.WEAPONS.smite;

// ---------------- 1. defs ----------------
{
  const forms = ED.weaponForms('smite').map(f => f.id).sort();
  ok(JSON.stringify(forms) === JSON.stringify(FORMS.slice().sort()), `smite Forms: ${forms.join(', ')}`);
  ok(root.paths.length === 3 && root.paths.every(pa => pa.ranks.length === 3) && root.hybrids.length === 2, 'smite: 3 paths x 3 ranks, 2 hybrids');
  const names = FORMS.map(id => ED.WEAPONS[id].name.toLowerCase()).concat(['judgment']);
  const lines = [];
  root.paths.forEach(pa => { lines.push(pa.name); pa.ranks.forEach(r => lines.push(r.txt)); });
  FORMS.forEach(id => { const d = ED.WEAPONS[id]; ok(d.form && d.from === 'smite' && d.refine.length === 2, `${id}: Form of smite, 2 refines`); lines.push(d.txt); d.refine.forEach(r => lines.push(r.txt)); });
  ED.SKILLS.sanctuary.levels.forEach(l => lines.push(l.txt));
  const long = lines.filter(s => s.length > 40), named = lines.filter(s => names.some(n => s.toLowerCase().indexOf(n) >= 0) && FORMS.every(id => ED.WEAPONS[id].txt !== s));
  ok(!long.length, 'card lines <= 40 chars' + (long.length ? ': ' + long.join(' | ') : ''));
  ok(!named.length, 'path, rank and refine lines never name a Form' + (named.length ? ': ' + named.join(' | ') : ''));
}

// ---------------- 2. ranks change numbers and pattern ----------------
// Probe: hero at rest, 24 foes on a 70 px ring and 24 on a 150 px ring (HP x 200, refreshed), 4 s. Returns pattern counts.
function probe(ranks, form) {
  const w = world(['cleric'], 21), p = w.heroes[0], ws = build(w, p, ranks, form);
  ring(w, p.x, p.y, 24, 70, 200); ring(w, p.x, p.y, 24, 150, 200);
  const seen = new Set(), o = { pillars: 0, leaps: 0, aura: 0, censers: 0, beams: 0, beamDur: 0, rays: 0, grounds: 0, halo: 0, dealt: 0 };
  step(w, 4, (evs) => {
    for (const ev of evs) if (ev.t === 'chain' && ev.wid === ws.id) o.leaps++;
    let beams = 0, rays = 0;
    for (const z of w.zones) {
      if (z.dead || z.p !== p) continue;
      if (z.k === 'beam') { beams++; o.beamDur = Math.max(o.beamDur, z.dur); }
      if (z.k === 'ray') rays++;
      if (z.k === 'aura') { o.aura = Math.max(o.aura, z.r); o.censers = Math.max(o.censers, z.w); }
      if (z.k === 'halo') { o.halo = Math.max(o.halo, z.r); o.censers = Math.max(o.censers, z.w); }
      if (seen.has(z.id)) continue;
      seen.add(z.id);
      if ((z.k === 'smite' || z.k === 'wrath') && z.wid === ws.id) o.pillars++;
      if (z.k === 'hallow') o.grounds++;
    }
    o.beams = Math.max(o.beams, beams); o.rays = Math.max(o.rays, rays);
  });
  o.dealt = Math.round(p.dealt[ws.id] || 0);
  o.S = JSON.stringify(w.weaponS(p, 0));
  return o;
}
{
  const at = (i, r) => { const k = [0, 0, 0]; k[i] = r; return k; };
  const P = [0, 1, 2].map(i => [0, 1, 2, 3].map(r => probe(at(i, r), '')));
  for (let i = 0; i < 3; i++) for (let r = 1; r <= 3; r++) ok(P[i][r].S !== P[i][r - 1].S && P[i][r].dealt > 0, `${root.paths[i].name} rank ${r}: numbers change, dealt ${P[i][r].dealt}`);
  const s = P[0], c = P[1], l = P[2];
  ok(s[1].pillars > s[0].pillars * 1.6, `Storm 1: +1 pillar (pillars ${s[0].pillars} -> ${s[1].pillars})`);
  ok(s[1].leaps === 0 && s[2].leaps > 0, `Storm 2: pillars leap (leaps ${s[1].leaps} -> ${s[2].leaps})`);
  ok(s[3].leaps > s[2].leaps * 1.6, `Storm 3: leaps strike 2 foes (leaps ${s[2].leaps} -> ${s[3].leaps})`);
  ok(c[0].aura === 0 && c[1].aura > 0, `Censer 1: an aura (r ${c[1].aura.toFixed(0)})`);
  ok(c[2].aura > c[1].aura * 1.2, `Censer 2: the aura grows (r ${c[1].aura.toFixed(0)} -> ${c[2].aura.toFixed(0)})`);
  ok(c[2].censers === 0 && c[3].censers === 2, `Censer 3: 2 censers (${c[3].censers})`);
  ok(l[0].beams === 0 && l[1].beams === 1, `Lance 1: a beam sweeps (${l[1].beams})`);
  ok(l[2].beams === 1 && l[2].beamDur > l[1].beamDur * 1.8, `Lance 2: it sweeps back (sweep ${l[1].beamDur.toFixed(2)} -> ${l[2].beamDur.toFixed(2)} s)`);
  ok(l[3].beams === 2, `Lance 3: a second beam (${l[3].beams})`);

  // ---------------- 3. Forms ----------------
  const ready = (ranks) => { const w = world(['cleric'], 3), p = w.heroes[0], ws = build(w, p, ranks, ''); return w.formsReady(p, ws).map(f => f.id).sort().join(','); };
  const R = [[[3, 0, 0], 'wrath'], [[0, 3, 0], 'halo'], [[0, 0, 3], 'jray'], [[3, 3, 0], 'consecration,halo,wrath'], [[3, 0, 3], 'jray,verdict,wrath'], [[0, 3, 3], 'halo,jray'],
    [[2, 3, 3], 'halo,jray'], [[3, 2, 2], 'wrath'], [[2, 2, 2], ''], [[3, 3, 3], 'consecration,halo,jray,verdict,wrath']];
  for (const [ranks, want] of R) { const got = ready(ranks); ok(got === want, `ranks ${ranks.join('')}: ready Forms [${got}]`); }
  {
    const w = world(['cleric'], 3), p = w.heroes[0], ws = build(w, p, [3, 3, 3], 'halo');
    ok(ws.id === 'halo' && w.formsReady(p, ws).length === 0 && !w.takeForm(p, ws, 'wrath'), 'one Form per run: none ready after Halo, a second take refused');
  }
  const F = {}; for (const id of FORMS) F[id] = probe([3, 3, 3], id);
  const all = probe([3, 3, 3], '');
  const need = { wrath: [3, 0, 0], halo: [0, 3, 0], jray: [0, 0, 3], consecration: [3, 3, 0], verdict: [3, 0, 3] }, f = {};
  for (const id of FORMS) { f[id] = probe(need[id], id); ok(f[id].dealt > 0, `${id} (ranks ${need[id].join('')}, refine 2): fires, dealt ${f[id].dealt}`); }
  ok(f.wrath.leaps > s[3].leaps * 1.5, `wrath: pillars hop foe to foe (chain links ${s[3].leaps} -> ${f.wrath.leaps})`);
  ok(f.halo.halo > 0 && f.halo.aura === 0 && f.halo.censers === 5, `halo: a ring wall (r ${f.halo.halo.toFixed(0)}) replaces the aura, 5 censers ride it`);
  ok(f.jray.rays === 5 && f.jray.beams === 0, `jray: 5 beams turn around the hero (${f.jray.rays}), no sweep`);
  ok(f.consecration.grounds > 0 && F.wrath.grounds === 0, `consecration: holy ground (${f.consecration.grounds} patches)`);
  ok(f.verdict.pillars > all.pillars * 1.5, `verdict: the beam calls pillars (pillars ${all.pillars} at 333 -> ${f.verdict.pillars})`);
  ok(F.wrath.beams === 2 && F.wrath.aura > 0 && F.wrath.censers === 2, 'wrath at 333 keeps the Censer aura and Lance beams');
}

// ---------------- 4. healing ----------------
{
  const w = world(['cleric', 'knight']), [c, k] = w.heroes; build(w, c, [0, 2, 0], '');
  k.x = c.x + 20; k.y = c.y; k.hp = 40; ring(w, c.x, c.y, 12, 40, 200);
  step(w, 3);
  ok(k.hp > 40, `Censer 2: the aura heals an ally inside while foes burn in it (${k.hp.toFixed(1)})`);
  const w2 = world(['cleric', 'knight']), [c2, k2] = w2.heroes; build(w2, c2, [0, 1, 0], '');
  k2.x = c2.x + 20; k2.y = c2.y; k2.hp = 40; ring(w2, c2.x, c2.y, 12, 40, 200); step(w2, 3);
  ok(k2.hp === 40, 'Censer 1: no healing yet');
  const w3 = world(['cleric']), p3 = w3.heroes[0]; build(w3, p3, [3, 3, 0], 'consecration');
  p3.hp = 40; w3.spawnFoe('skelknight', p3.x + 10, p3.y, { hpMul: 1e5 }); step(w3, 3);
  ok(p3.hp > 40 && w3.zones.some(z => z.k === 'hallow'), `consecration: standing in holy ground heals (${p3.hp.toFixed(1)})`);
}

// ---------------- 5. view clamp ----------------
{
  for (const id of FORMS) {
    const w = world(['cleric'], 8), p = w.heroes[0]; build(w, p, [3, 3, 3], id);
    p.passives.push({ id: 'reach', lvl: 5 }); w.recalc(p, false);
    ring(w, p.x, p.y, 16, 80, 500);
    const out = [], pos = [];
    for (let i = 0; i < 8; i++) { const x = p.x + (i % 2 ? 1 : -1) * (ED.HERO_VIEW.hw + 30), y = p.y - 60 + i * 15; out.push(w.spawnFoe('skeleton', x, y, { hpMul: 500 })); pos.push([x, y]); }
    step(w, 5, () => { out.forEach((e, i) => { e.x = pos[i][0]; e.y = pos[i][1]; }); }); // held just outside the view rect
    ok(out.every(e => e.hp === e.maxHp) && (p.dealt[id] || 0) > 0, `${id} at 333 + reach 5: foes outside the view untouched (dealt ${Math.round(p.dealt[id] || 0)} inside)`);
  }
}

// ---------------- 6. Sanctuary ----------------
{
  const cast = (w, p, x, y, lvl) => { p.skills[0].lvl = lvl; w.input(p.pid, { q: true, ax: x, ay: y }); w.update(C.TICK); w.events.length = 0; };
  for (let L = 1; L <= 4; L++) {
    const w = world(['cleric', 'knight']), [c, k] = w.heroes;
    k.x = c.x + 100; k.y = c.y; k.hp = 40; ring(w, k.x, k.y, 10, 30, 200);
    c.weapons.length = 0; k.weapons.length = 0; // skill only
    cast(w, c, k.x, k.y, L);
    const z = w.zones.find(q => q.k === 'sanct');
    let rain = 0, stun = 0; const seen = new Set();
    step(w, 1, () => { for (const q of w.zones) if (q.wid === 'sanctuary' && q.k === 'smite' && !seen.has(q.id)) { seen.add(q.id); rain++; } for (const e of w.foes) if (e.stunT > 0) stun++; });
    step(w, 2);
    let far = 0; for (const e of w.foes) if (!e.dead && U.dist(e.x, e.y, k.x, k.y) > 60) far++;
    if (L === 1) ok(far <= 3, `sanctuary L1: no ward, foes walk back in after the burst (${far}/10 beyond 60 px)`);
    ok(!!z && k.hp >= 44 && c.skills[0].cd >= 6, `sanctuary L${L}: cast, ally healed to ${k.hp.toFixed(0)}, cooldown ${c.skills[0].cd.toFixed(1)} s, r ${z ? z.r.toFixed(0) : '-'}, ${z ? z.dur.toFixed(1) : '-'} s`);
    if (L >= 2) ok(far >= 8, `sanctuary L${L}: wards foes out (${far}/10 beyond 60 px)`);
    ok(L >= 4 ? rain >= 3 && stun > 0 : rain === 0 && stun === 0, `sanctuary L${L}: rain pillars ${rain}, stun foe-ticks ${stun}`);
    const hurt = w.foes.filter(e => e.hp < e.maxHp).length;
    ok(hurt === 0 && !(c.dealt.sanctuary > 0), `sanctuary L${L}: zero damage (hurt ${hurt}, dealt ${c.dealt.sanctuary || 0})`);
  }
  for (const L of [2, 3]) {
    const w = world(['cleric', 'knight'], 5, false), [c, k] = w.heroes;
    k.x = c.x + 100; k.y = c.y; k.hp = 0; w.heroDown(k);
    cast(w, c, k.x, k.y, L); step(w, 2);
    ok(L === 3 ? !k.downed : k.downed, `sanctuary L${L}: downed ally inside ${L === 3 ? 'revived' : 'stays down'}`);
  }
}

// ---------------- 7. determinism ----------------
function digestRun(form, seed) {
  const w = world(['cleric'], seed), p = w.heroes[0]; build(w, p, [3, 3, 3], form); p.skills[0].lvl = 4;
  let d = 0;
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 30 === 0 && w.foes.length < 120) ring(w, p.x, p.y, 20, 80 + (tick % 7) * 20, 40);
    const a = tick / 60 * 0.6;
    w.input(p.pid, { mx: Math.cos(a) * 0.5, my: Math.sin(a) * 0.5, ax: p.x + 60, ay: p.y, q: p.skills[0].cd <= 0 });
    w.update(C.TICK); w.events.length = 0;
    if (tick % 60 === 0) { const s = w.kills + '|' + p.x.toFixed(2) + '|' + p.hp.toFixed(2) + '|' + w.foes.length + '|' + w.zones.length + '|' + Math.round(p.dealt[form] || 0); d = (Math.imul(d, 31) + U.hashStr(s)) >>> 0; }
  }
  return d;
}
for (const id of FORMS) { const a = digestRun(id, 61), b = digestRun(id, 61); ok(a === b, `${id}: same digest twice (${a})`); }

console.log(`check-hero-cleric: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
