// Horde regression check (exit 1 on failure): foe roster, stage timelines, brains, telegraphs, spawner events, recycling, arena layouts. Usage: node tools/check-horde.js
// 1. Data: every roster / event / split id exists, has a brain and atlas art; timelines have 16 rows, caps 300 -> 700, rates rising into the mid-game; boss ids per stage.
// 2. Brains: each attack kind (ranged, exploder, charger, diver, brute) shows a warn zone >= 0.6 s before it deals damage; a stun cancels a wind-up and drops its telegraph.
// 3. Spawner: a weaponless god hero per stage reaches the alive cap by the mid-game, sees swarm events every 90 s, elites every 60 s from 2:00, bosses at 5/10/15 min; a missing boss script spawns a stand-in;
//    from an empty field at 6:00 / 8:00 (solo and a party of 4) the alive count refills to the density floor within 0.5 s without passing the cap; at the floor the rate is x1.
// 4. Recycling: a foe left 1000 px behind returns to the spawn ring. 5. Arena: deterministic, obstacle count in range, centre clear, features keep lanes.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();

// atlas anim ids (generated meta) without the client
const ART = (() => { const g = { ED: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'art', 'meta.js'), 'utf8'), { globalThis: g }); return g.ED.ART.anims; })();
const hasArt = (look) => !!(ART[look + '.walk'] || ART[look + '.idle'] || ART[look + '.walk.d'] || ART[look + '.walk.0']);

// ---------------- 1. data ----------------
const BOSSES = [['warden', 'twins', 'hollow'], ['spore', 'cyclops', 'king'], ['samurai', 'weaver', 'wickeater']];
const kinds = new Set();
ED.STAGES.forEach((sd, si) => {
  const ids = new Set();
  for (const row of sd.timeline) for (const r of row.roster) ids.add(r[0]);
  for (const id of sd.events.swarm.ring.concat(sd.events.swarm.stampede || [])) ids.add(id);
  for (const id of [...ids]) { const d = ED.FOES[id]; if (d && d.split) ids.add(d.split.id); }
  const bad = [...ids].filter(id => !ED.FOES[id] || !ED.AI[ED.FOES[id].ai] || !hasArt(ED.FOES[id].look));
  ok(!bad.length, `${sd.id}: ${ids.size} foe ids exist with a brain and art` + (bad.length ? ' (bad: ' + bad.join(',') + ')' : ''));
  const roster = new Set(); for (const row of sd.timeline) for (const r of row.roster) roster.add(r[0]);
  ok(roster.size >= 8, `${sd.id}: roster has ${roster.size} foes (>= 8)`);
  for (const id of ids) kinds.add(ED.FOES[id].split ? 'splitter' : ED.FOES[id].ai);
  const tl = sd.timeline;
  ok(tl.length === 16 && tl[0].cap === 300 && tl[12].cap === 700 && tl[15].cap === 700, `${sd.id}: 16 rows, cap ${tl[0].cap} -> ${tl[12].cap}`);
  ok(tl[10].rate >= tl[0].rate * 6 && tl.every((r, m) => m === 0 || m === 15 || r.rate >= tl[m - 1].rate), `${sd.id}: rate ${tl[0].rate} -> ${tl[10].rate} -> ${tl[14].rate}, never drops before 15:00`);
  ok(tl[0].floor === 0 && tl[3].floor === 0.3 && tl.slice(6).every(r => r.floor === 0.6), `${sd.id}: density floor ${tl.map(r => r.floor).slice(0, 7).join(' ')} of the cap`);
  const shifts = tl.filter((r, m) => m > 0 && JSON.stringify(r.roster) !== JSON.stringify(tl[m - 1].roster)).length;
  ok(shifts >= 13, `${sd.id}: roster weights shift ${shifts} of 15 minutes`);
  ok(JSON.stringify(sd.bosses.map(b => b.id)) === JSON.stringify(BOSSES[si]) && sd.bosses[2].final && sd.bosses.map(b => b.t).join() === '300,600,900', `${sd.id}: bosses ${sd.bosses.map(b => b.id + '@' + b.t).join(' ')}`);
});
ok(['chaser', 'swarm', 'brute', 'ranged', 'exploder', 'splitter', 'diver', 'charger'].every(k => kinds.has(k)), 'every foe kind appears: ' + [...kinds].join(','));

// ---------------- 2. brains ----------------
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
// World with one weaponless hero standing still, no spawner; foe `id` placed d px to its right.
function lab(id, d, opts) {
  const w = new ED.World({ seed: 5, stage: 0, players: players(['knight']) });
  w.sdef = Object.assign({}, w.sdef, { timeline: w.sdef.timeline.map(r => Object.assign({}, r, { rate: 0 })), events: {}, elites: null, bosses: [] });
  const p = w.heroes[0]; p.weapons.length = 0; p.skills.length = 0; p.hp = p.maxHp = 1e6;
  w.arena.obstacles.length = 0; for (let i = 0; i < w.arena.cells.length; i++) w.arena.cells[i] = null;
  const e = w.spawnFoe(id, p.x + d, p.y, opts);
  return { w, p, e };
}
// Runs until `secs`; records the first warn zone of foe e (time) and the first hero hurt that is not contact (time).
function watch(w, p, e, secs, still) {
  let warnT = -1, warnDur = 0, hurtT = -1, shots = 0, booms = 0;
  for (let i = 0; i < secs * 60 && w.state === 'play'; i++) {
    w.input('p1', { mx: 0, my: still ? 0 : (i % 120 < 60 ? 1 : -1) * 0.3, ax: p.x + 50, ay: p.y });
    const hp0 = p.hp;
    w.update(C.TICK);
    for (const z of w.zones) if (z.warn && z.team === 1 && z.srcId === e.id && warnT < 0) { warnT = w.time; warnDur = z.dur; }
    for (const ev of w.events) { if (ev.t === 'eshoot') shots++; if (ev.t === 'boom' && ev.team === 1) { booms++; if (hurtT < 0 && p.hp < hp0) hurtT = w.time; } }
    w.events.length = 0;
  }
  return { warnT, warnDur, hurtT, shots, booms };
}
{ // ranged: warn line then shot, aim locked at the wind-up start
  const { w, p, e } = lab('priest', 200), r = watch(w, p, e, 5, true);
  ok(r.warnT > 0 && r.warnDur >= 0.6 && r.shots > 0, `ranged: telegraph ${r.warnDur.toFixed(2)} s at ${r.warnT.toFixed(2)} s, then ${r.shots} shots`);
}
{ // fan + elite: more shots
  const a = lab('spitter', 200), ra = watch(a.w, a.p, a.e, 2.5, true);
  const b = lab('spitter', 200, { elite: true }), rb = watch(b.w, b.p, b.e, 2.5, true);
  ok(ra.shots === 3 && rb.shots === 5, `fan: ${ra.shots} shots, elite ${rb.shots} shots`);
}
{ // exploder: telegraph, blast hurts after >= 0.6 s, the foe is gone
  const { w, p, e } = lab('imp', 120), r = watch(w, p, e, 4, true);
  ok(r.warnT > 0 && r.booms === 1 && r.hurtT - r.warnT >= 0.6 - 1e-6 && e.dead, `exploder: warn at ${r.warnT.toFixed(2)} s, blast hurts at ${r.hurtT.toFixed(2)} s, dies`);
}
{ // exploder killed during its fuse: no blast
  const { w, p, e } = lab('imp', 120);
  let blasts = 0;
  for (let i = 0; i < 240; i++) { w.update(C.TICK); if (e.st === 1 && !e.dead) w.hitFoe(e, 1e6, w.src(p, 'test', 'weapon')); for (const ev of w.events) if (ev.t === 'boom' && ev.team === 1) blasts++; w.events.length = 0; }
  ok(e.dead && blasts === 0 && !w.zones.some(z => z.srcId === e.id && !z.dead), 'exploder killed in its fuse: no blast, telegraph gone');
}
{ // brute: slam telegraph then blast
  const { w, p, e } = lab('skelknight', 60), r = watch(w, p, e, 4, true);
  ok(r.warnT > 0 && r.booms >= 1 && r.hurtT - r.warnT >= 0.6 - 1e-6, `brute: slam warn at ${r.warnT.toFixed(2)} s (${r.warnDur.toFixed(2)} s), hurts at ${r.hurtT.toFixed(2)} s`);
}
{ // horror slam throws a shot ring
  const { w, p, e } = lab('horror', 60), r = watch(w, p, e, 3, true);
  ok(r.shots >= 10, `brute slam ring: ${r.shots} shots`);
}
for (const id of ['icewolf', 'frostwisp']) { // charger / diver: lane, then a fast dash
  const { w, p, e } = lab(id, 180);
  let warnT = -1, dashV = 0, warnDur = 0;
  for (let i = 0; i < 300; i++) {
    w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y });
    const x0 = e.x, y0 = e.y; w.update(C.TICK);
    if (warnT < 0) for (const z of w.zones) if (z.srcId === e.id && z.warn) { warnT = w.time; warnDur = z.dur; }
    if (e.st === 2) dashV = Math.max(dashV, Math.hypot(e.x - x0, e.y - y0) * 60);
    w.events.length = 0;
  }
  ok(warnT > 0 && warnDur >= 0.6 && dashV > e.def.spd * 3, `${e.def.ai}: lane ${warnDur.toFixed(2)} s, dash ${Math.round(dashV)} px/s`);
}
{ // stun cancels a wind-up
  const { w, p, e } = lab('icewolf', 150);
  for (let i = 0; i < 400 && e.st !== 1; i++) { w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y }); w.update(C.TICK); }
  const z = e.tz; w.stun(e, 1); w.update(C.TICK);
  ok(z && e.st === 0 && z.dead, 'a stun cancels the wind-up and drops its telegraph');
}

// ---------------- 3. spawner ----------------
function spawnRun(stage, until, mut) {
  const w = new ED.World({ seed: 77, stage, players: players(['knight']), cheats: { god: true } });
  const p = w.heroes[0]; p.weapons.length = 0; p.skills.length = 0;
  if (mut) mut(w);
  const out = { w, swarms: [], elites: [], bosses: [], alive: {}, capHit: -1, over: 0 };
  for (let i = 0; w.time < until; i++) {
    const a = i / 60 * 0.4; w.input('p1', { mx: Math.cos(a) * 0.6, my: Math.sin(a) * 0.6, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 });
    w.update(C.TICK);
    for (const ev of w.events) {
      if (ev.t === 'warn' && ev.kind === 'swarm') out.swarms.push(Math.round(w.time));
      else if (ev.t === 'warn' && ev.kind === 'elite') out.elites.push(Math.round(w.time));
      else if (ev.t === 'boss' && ev.phase === 0) out.bosses.push(ev.id + '@' + Math.round(w.time));
    }
    w.events.length = 0;
    if (i % 60 === 0) { const m = Math.floor(w.time / 60); out.alive[m] = Math.max(out.alive[m] || 0, w.foes.length); }
    if (out.capHit < 0 && w.foes.length >= w.aliveCap() - 5) out.capHit = Math.round(w.time);
    if (w.foes.length > 900) out.over++;
  }
  return out;
}
for (const st of [0, 1, 2]) {
  const r = spawnRun(st, 11 * 60 + 5);
  ok(r.swarms.slice(0, 5).join() === '90,180,270,360,450', `${ED.STAGES[st].id}: swarm events at ${r.swarms.join(',')}`);
  ok(r.elites.slice(0, 4).join() === '120,180,240,300', `${ED.STAGES[st].id}: elites at ${r.elites.slice(0, 6).join(',')}...`);
  ok(r.bosses.length === 2 && r.bosses[0].endsWith('@300') && r.bosses[1].endsWith('@600'), `${ED.STAGES[st].id}: bosses ${r.bosses.join(', ')}`);
  ok(r.capHit > 0 && r.capHit < 420 && r.over === 0, `${ED.STAGES[st].id}: alive cap reached at ${r.capHit} s (alive by minute ${Object.values(r.alive).join(' ')})`);
}
{ // density floor: an empty field refills to row.floor x cap within 0.5 s, never past the cap (no swarm / elite / boss timers); at the floor the rate is x1 (0.01 s step keeps acc < 1)
  const floorRun = (min, n, fill) => {
    const w = new ED.World({ seed: 77, stage: 0, players: players(Array(n).fill('knight')), cheats: { god: true } }), p = w.heroes[0];
    for (const h of w.heroes) { h.weapons.length = 0; h.skills.length = 0; }
    w.time = min * 60; w.sp.bossI = 99; w.sp.swarmT = w.sp.eliteT = Infinity;
    const row = w.timelineRow(), cap = w.aliveCap(), need = Math.ceil(row.floor * cap);
    if (fill) { for (let i = 0; i < need; i++) w.spawnFoe('skeleton', p.x + 600 + (i % 20) * 10, p.y + Math.floor(i / 20) * 10); w.sp.acc = 0; w.updateSpawner(0.01); return { k: w.sp.acc / (row.rate * (1 + 0.25 * (n - 1)) * 0.01), need }; }
    let t = -1, peak = 0;
    for (let i = 0; i < 30; i++) { w.update(C.TICK); w.events.length = 0; peak = Math.max(peak, w.foes.length); if (t < 0 && w.foes.length >= need) t = (i + 1) * C.TICK; }
    return { t, peak, need, cap };
  };
  for (const [min, n] of [[6, 1], [8, 1], [8, 4]]) {
    const r = floorRun(min, n);
    ok(r.t > 0 && r.t <= 0.5 + 1e-6 && r.peak <= r.cap, `density floor ${min}:00 x${n} hero(es): 0 -> ${r.need} foes in ${r.t.toFixed(2)} s (peak ${r.peak}, cap ${r.cap})`);
  }
  const hi = floorRun(8, 1, true);
  ok(Math.abs(hi.k - 1) < 1e-6, `density floor at 8:00 (${hi.need} foes): rate x${hi.k.toFixed(2)} at the floor`);
}
{ // a boss id without a script spawns a stand-in brute boss
  const r = spawnRun(0, 302, (w) => { w.sdef = Object.assign({}, w.sdef, { bosses: [{ t: 300, id: 'nobody' }] }); });
  const e = r.w.boss;
  ok(e && e.boss && e.elite && e.def.brute && e.maxHp === 2000, `missing boss script: stand-in ${e && e.def.id} (hp ${e && e.maxHp})`);
}

// ---------------- 4. recycling ----------------
{
  const { w, p, e } = lab('skeleton', 1000);
  for (let i = 0; i < 70; i++) { w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y }); w.update(C.TICK); }
  const d = Math.hypot(e.x - p.x, e.y - p.y);
  ok(d < 470, `a foe 1000 px behind returns to the spawn ring (${Math.round(d)} px)`);
}

// ---------------- 5. arena ----------------
for (let s = 0; s < 3; s++) {
  const sd = ED.STAGES[s], A1 = ED.Arena.generate(s, 4242), A2 = ED.Arena.generate(s, 4242), c = A1.size / 2;
  const n = A1.obstacles.length, inClear = A1.obstacles.filter(o => Math.hypot(o.x - c, o.y - c) < sd.arena.clear).length;
  ok(JSON.stringify(A1.obstacles) === JSON.stringify(A2.obstacles) && n >= sd.arena.obstacles[0] - 4 && n <= sd.arena.obstacles[1] && inClear === 0 && A1.braziers.length >= sd.arena.braziers[0],
    `${sd.id}: arena deterministic, ${n} obstacles, ${A1.braziers.length} braziers, centre clear`);
}

console.log(`check-horde: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
