// Horde regression check (exit 1 on failure): foe roster, stage timelines, brains, telegraphs, spawner events, recycling, arena layouts. Usage: node tools/check-horde.js
// 1. Data: every roster / event / split id exists, has a brain and atlas art; timelines have 16 rows, caps 300 -> 700, rates rising into the mid-game, density floors; roster tiers (5:00 and 10:00 add kinds,
//    early kinds fade out); boss ids per stage; foe wire order (tier foes after the boss bodies); the XP curve.
// 2. Brains: each attack kind (ranged, exploder, charger, diver, brute, blinker) shows a warn zone >= 0.6 s before it deals damage; a stun cancels a wind-up and drops its telegraph;
//    guard (shield up, open after the bash), summoner (summons after its ring), pull slam (drags a still hero in), wall packs (a line across the approach).
// 3. Spawner: a weaponless god hero per stage reaches the alive cap by the mid-game, sees swarm events every 90 s, elites every 60 s from 2:00, bosses at 5/10/15 min; a missing boss script spawns a stand-in;
//    from an empty field at 6:00 / 8:00 (solo and a party of 4) the alive count refills to the density floor within 0.5 s without passing the cap; at the floor the rate is x1.
//    benchmark phase: a 'surge' warning at 12:00, elites every 30 s.
// 4. Recycling: a foe left 1000 px behind returns to the spawn ring. 5. Arena: deterministic, obstacle count in range, centre clear, features keep lanes.
// 6. Gold: elite coins, mid-boss coin, final boss and victory gold x the stage gold multiplier; w.summary().gold carries it.
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
  ok(tl[0].floor === 0.15 && tl[4].floor === 0.35 && tl[9].floor === 0.6 && tl.slice(10, 12).every(r => r.floor === 0.6) && tl.slice(12).every(r => r.floor === 0.7), `${sd.id}: density floor ${tl.map(r => r.floor).join(' ')} of the cap`);
  const kindsAt = (a, b) => { const s = new Set(); for (let m = a; m < b; m++) for (const r of tl[m].roster) s.add(r[0]); return s; };
  const A = kindsAt(0, 5), B = kindsAt(5, 10), Cc = kindsAt(10, 15), newB = [...B].filter(id => !A.has(id)), newC = [...Cc].filter(id => !A.has(id) && !B.has(id));
  const gone = [...kindsAt(0, 2)].filter(id => ED.FOES[id].ai !== 'swarm' && Cc.has(id));
  ok(newB.length >= 3 && newC.length >= 1 && !gone.length && sd.bench && sd.bench.t === 720 && sd.bench.elite === 30, `${sd.id}: tiers - new at 5:00 ${newB.join(',')}; new at 10:00 ${newC.join(',')}; opening kinds gone by 10:00 except swarmers`);
  const shifts = tl.filter((r, m) => m > 0 && JSON.stringify(r.roster) !== JSON.stringify(tl[m - 1].roster)).length;
  ok(shifts >= 13, `${sd.id}: roster weights shift ${shifts} of 15 minutes`);
  ok(JSON.stringify(sd.bosses.map(b => b.id)) === JSON.stringify(BOSSES[si]) && sd.bosses[2].final && sd.bosses.map(b => b.t).join() === '300,600,900', `${sd.id}: bosses ${sd.bosses.map(b => b.id + '@' + b.t).join(' ')}`);
});
ok(['chaser', 'swarm', 'brute', 'ranged', 'exploder', 'splitter', 'diver', 'charger', 'summoner', 'march', 'blinker'].every(k => kinds.has(k)), 'every foe kind appears: ' + [...kinds].join(','));
{ // wire order: boss bodies keep their indices, tier foes follow them; XP curve
  const I = ED.FOE_IDX, X = ED.World.xpFor; let c10 = 0, c20 = 0, c30 = 0; for (let L = 1; L < 30; L++) { if (L < 10) c10 += X(L); if (L < 20) c20 += X(L); c30 += X(L); }
  ok(I.sporepod === 37 && I.twinhammer === 38 && I.weaver === 39 && I.wickeater === 40 && I.bulwark === 41 && I.colossus === 47 && ED.FOES.weaver.name === 'Rift Weaver', `foe wire order: boss bodies 37-40, tier foes 41-${ED.FOE_IDS.length - 1}`);
  ok(X(1) === 10 && c10 === 2198 && c20 === 11908 && c30 === 32168, `XP curve: ${X(1)} for level 2, cumulative ${c10} / ${c20} / ${c30} to levels 10 / 20 / 30`);
}

// ---------------- 2. brains ----------------
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
// World with one weaponless hero standing still, no spawner; foe `id` placed d px to its right.
function lab(id, d, opts) {
  const w = new ED.World({ seed: 5, stage: 0, players: players(['knight']) });
  w.sdef = Object.assign({}, w.sdef, { timeline: w.sdef.timeline.map(r => Object.assign({}, r, { rate: 0, floor: 0 })), events: {}, elites: null, bosses: [] });
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
{ // guard: shield up takes x0.35, the bash leaves a 1.6 s open window (st 3) taking x1.3
  const { w, p, e } = lab('bulwark', 120);
  const up = e.takeMul; let open = 0, openT = 0;
  for (let i = 0; i < 600 && !open; i++) { w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y }); w.update(C.TICK); w.events.length = 0; if (e.st === 3) { open = e.takeMul; openT = w.time; } }
  let back = 0; for (let i = 0; i < 120; i++) { w.update(C.TICK); w.events.length = 0; if (e.st !== 3 && !back) back = w.time; }
  ok(up === 0.35 && open === 1.3 && back - openT > 1.5 && e.takeMul === 0.35, `guard: x${up} shielded, x${open} open for ${(back - openT).toFixed(2)} s after the bash`);
}
{ // summoner: a summon ring >= 0.6 s, then 3 skeletons
  const { w, p, e } = lab('bonecaller', 200), r = watch(w, p, e, 4, true);
  const sk = w.foes.filter(f => f !== e && f.def.id === 'skeleton').length;
  ok(r.warnT > 0 && r.warnDur >= 0.6 && sk === 3, `summoner: ring ${r.warnDur.toFixed(2)} s at ${r.warnT.toFixed(2)} s, ${sk} skeletons raised`);
}
{ // blinker: a flank mark, then a slash circle >= 0.6 s that hurts a still hero
  const { w, p, e } = lab('stalker', 160), r = watch(w, p, e, 5, true);
  ok(r.warnT > 0 && r.booms >= 1 && r.hurtT - r.warnT >= 1.2 - 1e-6 && Math.hypot(e.x - p.x, e.y - p.y) < 60, `blinker: mark at ${r.warnT.toFixed(2)} s, slash hurts at ${r.hurtT.toFixed(2)} s, ${Math.round(Math.hypot(e.x - p.x, e.y - p.y))} px beside the hero`);
}
{ // pull slam: the wind-up drags a still hero toward the colossus, then the slam hurts
  const { w, p, e } = lab('colossus', 100); const d0 = Math.hypot(e.x - p.x, e.y - p.y);
  let dMin = d0, pulled = 0;
  for (let i = 0; i < 240; i++) { const x0 = p.x; w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y }); w.update(C.TICK); w.events.length = 0; if (e.st === 1) pulled += Math.abs(p.x - x0); dMin = Math.min(dMin, Math.hypot(e.x - p.x, e.y - p.y)); }
  ok(pulled > 30 && p.hp < p.maxHp, `pull slam: hero dragged ${Math.round(pulled)} px in the wind-up, slammed`);
}
{ // wall pack: a line across the approach, spacing def.wall, members keep their offsets
  const { w, p } = lab('skeleton', 2000); const n = w.spawnWall('mirecrab', p.x + 400, p.y, 4, p);
  const crabs = w.foes.filter(f => f.def.id === 'mirecrab'), xs = crabs.map(f => Math.round(f.x)), ys = crabs.map(f => Math.round(f.y)).sort((a, b) => a - b);
  ok(n === 4 && xs.every(x => x === p.x + 400) && ys[1] - ys[0] === ED.FOES.mirecrab.wall && crabs.every(f => f.takeMul === 0.7), `wall pack: ${n} crabs in a line ${ys.join(',')} (armour x0.7)`);
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
{ // spawn spread: the opening wave (density floor at 0:00) surrounds a still hero from every octant; swarm packs are 4-6 at 0:00, 12-16 at 5:00, 20-30 at 10:00
  const w = new ED.World({ seed: 77, stage: 0, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
  p.weapons.length = 0; p.skills.length = 0;
  for (let i = 0; i < 30; i++) { w.update(C.TICK); w.events.length = 0; }
  const oct = new Array(8).fill(0);
  for (const e of w.foes) oct[Math.floor(((Math.atan2(e.y - p.y, e.x - p.x) + U.TAU) % U.TAU) / U.TAU * 8) % 8]++;
  ok(w.foes.length >= 25 && oct.every(n => n >= 1) && Math.max(...oct) <= w.foes.length * 0.3, `opening wave: ${w.foes.length} foes, per octant ${oct.join(' ')}`);
  const packs = (min) => {
    const v = new ED.World({ seed: 78, stage: 0, players: players(['knight']), cheats: { god: true } }), out = [];
    v.sdef = Object.assign({}, v.sdef, { timeline: v.sdef.timeline.map(r => Object.assign({}, r, { rate: 0, floor: 0, roster: [['bat', 1]] })), events: {}, elites: null, bosses: [] });
    v.time = min * 60;
    for (let i = 0; i < 30; i++) { for (const e of v.foes) e.dead = true; v.foes.length = 0; v.sp.acc = 1; v.updateSpawner(0); if (v.foes.length) out.push(v.foes.length); }
    return out.sort((a, b) => a - b);
  };
  for (const [min, lo, hi] of [[0, 4, 6], [5, 12, 16], [10, 20, 30]]) {
    const s = packs(min), med = s[s.length >> 1];
    ok(s.length >= 20 && s[s.length - 1] <= hi && med >= lo, `swarm packs at ${min}:00: ${s[0]}-${s[s.length - 1]} (median ${med}, design ${lo}-${hi})`);
  }
}
{ // benchmark phase: a 'surge' warning at 12:00, then elites every 30 s
  const w = new ED.World({ seed: 77, stage: 1, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
  p.weapons.length = 0; p.skills.length = 0; w.time = 715; w.sp.eliteT = 720; w.sp.swarmT = Infinity; w.sp.bossI = 99;
  const surge = [], el = [];
  for (let i = 0; i < 70 * 60; i++) { w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y }); w.update(C.TICK); for (const ev of w.events) if (ev.t === 'warn') (ev.kind === 'surge' ? surge : ev.kind === 'elite' ? el : []).push(Math.round(w.time)); w.events.length = 0; }
  ok(surge.join() === '720' && el.join() === '720,750,780', `benchmark: surge at ${surge.join()}, elites at ${el.join()}`);
}
{ // a boss id without a script spawns a stand-in brute boss
  const r = spawnRun(0, 302, (w) => { w.sdef = Object.assign({}, w.sdef, { bosses: [{ t: 300, id: 'nobody' }] }); });
  const e = r.w.boss;
  ok(e && e.boss && e.elite && e.def.brute && e.maxHp === 1500, `missing boss script: stand-in ${e && e.def.id} (hp ${e && e.maxHp})`);
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

// ---------------- 6. gold ----------------
{
  const goldRun = (stage) => {
    const w = new ED.World({ seed: 5, stage, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0], k = ED.STAGES[stage].gold, G = C.GOLD;
    p.weapons.length = 0; p.skills.length = 0;
    const coins = () => w.pickups.filter(g => !g.dead && g.k === 'gold').reduce((s, g) => s + g.val, 0);
    const el = w.spawnFoe('skeleton', p.x + 300, p.y, { elite: true }); w.killFoe(el, null); const eliteC = coins();
    w.time = 300; const mid = w.standInBoss({ t: 300, id: 'x' }); w.killFoe(mid, null); const midC = coins() - eliteC;
    w.time = 900; const fin = w.standInBoss({ t: 900, id: 'x', final: true }); w.killFoe(fin, null); const g0 = w.gold; w.update(C.TICK);
    const end = w.events.find(ev => ev.t === 'end');
    return { ok: eliteC >= k && eliteC <= Math.round(5 * k) && midC === G.mid * k && g0 === G.final * k && w.state === 'won' && end && end.summary.gold === w.gold && w.gold === (G.final + G.win) * k, k, eliteC, midC, fin: g0, total: w.gold };
  };
  for (const s of [0, 1, 2]) { const r = goldRun(s); ok(r.ok, `${ED.STAGES[s].id} gold x${r.k}: elite coins ${r.eliteC}, mid-boss coin ${r.midC}, final boss ${r.fin}, summary ${r.total} with the win bonus`); }
}

console.log(`check-horde: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
