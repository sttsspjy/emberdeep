// Horde regression check (exit 1 on failure): foe roster, stage timelines, brains, telegraphs, spawner events, recycling, arena layouts. Usage: node tools/check-horde.js
// 1. Data: every roster / event / split id exists, has a brain and atlas art; timelines have 21 rows, caps 80 / 150 / 220 at 0:00-2:00 then 300 -> 700, rates rising until 19:00, density floors (none at 0:00); roster tiers (5:00 and 10:00 add kinds,
//    early kinds fade out, 15:00 adds none; no charger or diver from 11:00); no swarm-brain flyer in any roster (flocks only); boss ids per stage; foe wire order (tier foes after the boss bodies); the XP curve;
//    foe HP: base x (1 + 0.11 x minute) (swarm brain 0.06) x party x stage; swarmers and divers 10-11 HP; elite HP 15 x max(1, 60 / def.hp) x spawned HP.
// 2. Brains: each attack kind (ranged, exploder, charger, diver, brute, blinker) shows a warn zone >= 0.6 s before it deals damage; a stun cancels a wind-up and drops its telegraph;
//    ranged streams (one lane, 'aim' look, shot life), lobs (a fixed circle at the hero's spot, then a blast there; killing the caster cancels it), the per-hero attack budget, no retreat;
//    charge / dive reach (start only within min(range, lane - 12), 'dash' look, rest after the dash), divers close in without a token, charge / dive / blink starts spend atkTok;
//    guard (shield up, open after the bash), summoner (summons after its ring), pull slam (drags a still hero in), wall packs (a line across the approach);
//    slam radius vs Knight reach: a base Cleave hits each brute from 12 px outside its slam (elites: outside the x1.35 slam).
// 3. Spawner: a weaponless god hero per stage reaches the alive cap by the mid-game, sees swarm events every 120 s from 2:00, elites every 60 s from 2:30, bosses at 5/10 min; the 15:00 mid-boss and the 20:00 final boss per stage (HP, flags), enrage at ENRAGE_T;
//    a missing boss script spawns a stand-in;
//    from an empty field at 6:00 / 8:00 (solo and a party of 4) the alive count refills to the density floor within 0.5 s without passing the cap; at the floor the rate is x1.
//    benchmark phase: a 'surge' warning at 17:00, elites every 30 s. Curves at 15:00 / 20:00: contact damage 9 / 11, shot factor x1.8 / x2.1, swarm waves 50 by 12:00 -> 60 by 20:00.
//    flocks: every 18 s from 0:40, 8 -> 40 swarmers by 10:00 -> 52 by 20:00 x party factor, a pack within 40 px or a line (x1.5, >= 300 px at 10:00) on the spawn ring; past the alive cap, not past the hard cap;
//    flock, ring and stampede members fly through (fixed heading and speed, never back), despawn 360 px outside the view (no gem, kill or 'die'), never recycle, despawn at the arena bound.
//    brain caps: shooters, summoners, dashers (charger / diver / blinker) and brutes never pass their alive caps; dasher packs and stampedes trim to the room left.
// 4. Recycling: a foe left 1000 px behind returns to the spawn ring. 5. Arena: deterministic, obstacle count in range, centre clear, features keep lanes.
// 6. Gold: elite coins, mid-boss coin, final boss, run-end pay (kill bounty + minutes survived) and victory gold x the stage gold multiplier; w.summary().gold carries it.
// 7. Hero leeway: blasts, zero-damage blasts and projectiles push foes away from the hitting hero; splitter children start no closer to the hero than the parent; HERO_R 6 contact.
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
const BOSSES = [['warden', 'twins', 'cyclops', 'hollow'], ['spore', 'cyclops', 'weaver', 'king'], ['samurai', 'weaver', 'twins', 'wickeater']];
const kinds = new Set();
ED.STAGES.forEach((sd, si) => {
  const ids = new Set();
  for (const row of sd.timeline) for (const r of row.roster) ids.add(r[0]);
  for (const id of sd.events.swarm.ring.concat(sd.events.swarm.stampede || [], [sd.events.flock.id])) ids.add(id);
  for (const id of [...ids]) { const d = ED.FOES[id]; if (d && d.split) ids.add(d.split.id); }
  const bad = [...ids].filter(id => !ED.FOES[id] || !ED.AI[ED.FOES[id].ai] || !hasArt(ED.FOES[id].look));
  ok(!bad.length, `${sd.id}: ${ids.size} foe ids exist with a brain and art` + (bad.length ? ' (bad: ' + bad.join(',') + ')' : ''));
  const roster = new Set(); for (const row of sd.timeline) for (const r of row.roster) roster.add(r[0]);
  ok(roster.size >= 8, `${sd.id}: roster has ${roster.size} foes (>= 8)`);
  const fl = sd.events.flock, flyers = [...roster].filter(id => ED.FOES[id].ai === 'swarm' && !ED.FOES[id].solo);
  ok(!flyers.length && fl && ED.FOES[fl.id].ai === 'swarm' && fl.first === 40 && fl.every === 18 && fl.n.join() === '8,40,52' && sd.events.swarm.n.join() === '24,50,60', `${sd.id}: flock ${fl && fl.id} every ${fl && fl.every} s from ${fl && fl.first} s; flyers in rosters: ${flyers.join(',') || 'none'}`);
  for (const id of ids) kinds.add(ED.FOES[id].split ? 'splitter' : ED.FOES[id].ai);
  const tl = sd.timeline;
  ok(tl.length === 21 && tl[0].cap === 80 && tl[1].cap === 150 && tl[2].cap === 220 && tl[3].cap === 300 && tl.slice(12).every(r => r.cap === 700), `${sd.id}: 21 rows, cap ${tl[0].cap} -> ${tl[12].cap} (holds to 20:00)`);
  ok(tl[10].rate >= tl[0].rate * 6 && tl[19].rate > tl[14].rate && tl[20].rate < tl[19].rate && tl.every((r, m) => m === 0 || m === 20 || r.rate >= tl[m - 1].rate), `${sd.id}: rate ${tl[0].rate} -> ${tl[10].rate} -> ${tl[14].rate} -> ${tl[19].rate}, never drops before 20:00 (${tl[20].rate} under the final boss)`);
  ok(tl[0].floor === 0 && tl[1].floor === 0.1 && tl[4].floor === 0.25 && tl[9].floor === 0.5 && tl[10].floor === 0.55 && tl[11].floor === 0.6 && tl.slice(12).every(r => r.floor === 0.7), `${sd.id}: density floor ${tl.map(r => r.floor).join(' ')} of the cap`);
  const kindsAt = (a, b) => { const s = new Set(); for (let m = a; m < b; m++) for (const r of tl[m].roster) s.add(r[0]); return s; };
  const A = kindsAt(0, 5), B = kindsAt(5, 10), Cc = kindsAt(10, 15), D = kindsAt(15, 21), newB = [...B].filter(id => !A.has(id)), newC = [...Cc].filter(id => !A.has(id) && !B.has(id)), newD = [...D].filter(id => !A.has(id) && !B.has(id) && !Cc.has(id));
  const gone = [...kindsAt(0, 2)].filter(id => ED.FOES[id].ai !== 'swarm' && Cc.has(id) && !(sd.id === 'abyss' && id === 'shade'));
  const filler = tl.slice(5).every(row => row.roster.some(r => ED.FOES[r[0]].ai === 'chaser' && !ED.FOES[r[0]].split && r[1] >= 3));
  ok(filler, `${sd.id}: every minute from 5:00 keeps a plain chaser (weight >= 3) as the brain-cap filler`);
  ok(newB.length >= 3 && newC.length >= 1 && !gone.length && sd.bench && sd.bench.t === 1020 && sd.bench.elite === 30, `${sd.id}: tiers - new at 5:00 ${newB.join(',')}; new at 10:00 ${newC.join(',')}; opening kinds gone by 10:00 except swarmers`);
  const dashers = [...kindsAt(11, 21)].filter(id => (ED.FOES[id].ai === 'charger' || ED.FOES[id].ai === 'diver') && !ED.FOES[id].guard);
  const wt = (id, m) => (tl[m].roster.find(r => r[0] === id) || [0, 0])[1], heavy = [...D].filter(id => (ED.FOES[id].brute || newC.includes(id)) && wt(id, 19) >= wt(id, 15) * 1.25);
  ok(!newD.length && !dashers.length && heavy.length >= 2, `${sd.id}: no new kind needed at 15:00 (${newD.join(',') || 'none'}), no charger or diver from 11:00 (${dashers.join(',') || 'none'}); brute / 10:00 kinds +25% or more by 19:00: ${heavy.join(',')}`);
  const shifts = tl.filter((r, m) => m > 0 && JSON.stringify(r.roster) !== JSON.stringify(tl[m - 1].roster)).length;
  ok(shifts >= 18, `${sd.id}: roster weights shift ${shifts} of 20 minutes`);
  ok(JSON.stringify(sd.bosses.map(b => b.id)) === JSON.stringify(BOSSES[si]) && sd.bosses.map(b => !!b.final).join() === 'false,false,false,true' && sd.bosses.map(b => b.t).join() === '300,600,900,1200' && sd.bosses[3].t === C.RUN_LEN, `${sd.id}: bosses ${sd.bosses.map(b => b.id + '@' + b.t).join(' ')}`);
});
ok(['chaser', 'swarm', 'brute', 'ranged', 'exploder', 'splitter', 'diver', 'charger', 'summoner', 'march', 'blinker'].every(k => kinds.has(k)), 'every foe kind appears: ' + [...kinds].join(','));
{ // wire order: boss bodies keep their indices, tier foes follow them; XP curve
  const I = ED.FOE_IDX, X = ED.World.xpFor; let c10 = 0, c20 = 0, c30 = 0; for (let L = 1; L < 30; L++) { if (L < 10) c10 += X(L); if (L < 20) c20 += X(L); c30 += X(L); }
  ok(I.sporepod === 37 && I.twinhammer === 38 && I.weaver === 39 && I.wickeater === 40 && I.bulwark === 41 && I.colossus === 47 && ED.FOES.weaver.name === 'Rift Weaver', `foe wire order: boss bodies 37-40, tier foes 41-${ED.FOE_IDS.length - 1}`);
  ok(X(1) === 3 && c10 === 731 && c20 === 8106 && c30 === 47631, `XP curve: ${X(1)} for level 2, cumulative ${c10} / ${c20} / ${c30} to levels 10 / 20 / 30`);
}

const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
{ // foe HP: non-swarm base x (1 + 0.11 x minute), swarm brain x (1 + 0.06 x minute), x (1 + 0.5 x (players - 1)) x stage HP; boss parts keep 0.24
  const hp = (stage, n, t, id) => { const w = new ED.World({ seed: 1, stage, players: players(Array(n).fill('knight')) }); w.time = t; return w.spawnFoe(id, 0, 0).maxHp; };
  const r = [hp(0, 1, 0, 'skeleton'), hp(0, 1, 600, 'skeleton'), hp(0, 1, 0, 'bat'), hp(0, 1, 600, 'bat'), hp(2, 1, 0, 'starspawn'), hp(1, 1, 0, 'glowlet'), hp(0, 4, 0, 'skeleton'), hp(0, 1, 0, 'skelknight'), hp(0, 1, 300, 'sporepod')];
  const swarmHp = ED.FOE_IDS.map(id => ED.FOES[id]).filter(d => (d.ai === 'swarm' || d.ai === 'diver') && !d.boss).map(d => d.hp);
  ok(r.join() === '20,42,10,16,10,9,50,111,132' && swarmHp.every(v => v >= 10 && v <= 11), `foe HP: skeleton ${r[0]} / ${r[1]} at 0:00 / 10:00, bat ${r[2]} / ${r[3]}, starspawn ${r[4]} (x0.9), glowlet ${r[5]} (x0.85), skeleton x4 ${r[6]}, skeleton knight ${r[7]}, spore pod ${r[8]} at 5:00; swarmers and divers ${swarmHp.join(',')}`);
}
{ // elite HP: 15 x max(1, 60 / def.hp) x spawned HP (small foes get the 60-HP floor, brutes 15x)
  const w = new ED.World({ seed: 1, stage: 0, players: players(['knight']) }), el = (id) => w.spawnFoe(id, 0, 0, { elite: true }).maxHp;
  const r = [el('skeleton'), el('icewolf'), el('skelknight')];
  w.time = 600; r.push(el('skeleton'));
  ok(r.join() === '900,900,1665,1890', `elite HP: skeleton ${r[0]}, grave hound ${r[1]}, skeleton knight ${r[2]} at 0:00; skeleton ${r[3]} at 10:00`);
}

// ---------------- 2. brains ----------------
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
const still = (w, p) => w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y });
{ // stream: an elite bolt caster fires shot.n + 2 shots down one locked lane, shot i at speed x (1 - 0.12 i), each living (d + 160) / speed s; its telegraph is an 'aim' line
  const { w, p, e } = lab('priest', 150, { elite: true }), S = e.def.shot;
  let look = '', pr = [], d = 0;
  for (let i = 0; i < 300 && !pr.length; i++) {
    still(w, p); d = Math.hypot(e.x - p.x, e.y - p.y); w.update(C.TICK); w.events.length = 0;
    for (const z of w.zones) if (z.warn && z.srcId === e.id && !look) look = z.k + (z.len > 0 ? ' line' : '');
    pr = w.projs.filter(q => !q.dead && q.team === 1 && q.owner === e.id);
  }
  const sp = pr.map(q => q.sp).sort((a, b) => b - a);
  ok(look === 'aim line' && pr.length === S.n + 2 && pr.every(q => Math.abs(q.a - pr[0].a) < 1e-9) && sp.every((v, i) => Math.abs(v - S.speed * (1 - 0.12 * i)) < 1e-6)
    && pr.every(q => Math.abs(q.life + q.t - Math.min(4, (d + 160) / q.sp)) < 0.02), `stream: elite ${pr.length} shots in one lane at ${sp.map(Math.round).join('/')} px/s, life ${pr.map(q => (q.life + q.t).toFixed(2)).join('/')} s, telegraph ${look}`);
}
{ // lob: a warned circle (>= 0.6 s, fixed) at the still hero's spot, then a team-1 blast there that hurts; a hero that walks off is missed; killing the caster in the wind-up cancels it
  const lob = (move, kill) => {
    const { w, p, e } = lab('spitter', 150), o = { zx: 0, zy: 0, zr: 0, dur: 0, moved: 0, boom: null, hurt: false, hx: 0, hy: 0 };
    let z = null, hp0 = 0;
    for (let i = 0; i < 400 && !o.boom; i++) {
      w.input('p1', { mx: z && move ? -1 : 0, my: 0, ax: p.x - 50, ay: p.y });
      w.update(C.TICK);
      if (!z) { z = w.zones.find(q => q.warn && q.srcId === e.id && !q.dead) || null; if (z) { o.zx = z.x; o.zy = z.y; o.zr = z.r; o.dur = z.dur; o.hx = p.x; o.hy = p.y; hp0 = p.hp; } }
      else if (!z.dead) o.moved = Math.max(o.moved, Math.hypot(z.x - o.zx, z.y - o.zy));
      if (z && kill && !e.dead) w.hitFoe(e, 1e6, w.src(p, 'test', 'weapon'));
      for (const ev of w.events) if (ev.t === 'boom' && ev.team === 1) o.boom = ev;
      w.events.length = 0;
    }
    o.hurt = !!z && p.hp < hp0; o.away = Math.hypot(p.x - o.zx, p.y - o.zy);
    return o;
  };
  const a = lob(false), b = lob(true), c = lob(false, true);
  ok(a.boom && a.dur >= 0.6 && Math.hypot(a.zx - a.hx, a.zy - a.hy) < 1 && a.moved === 0 && a.zr === 30 && Math.hypot(a.boom.x - a.zx, a.boom.y - a.zy) <= 1 && a.hurt,
    `lob: ${a.dur.toFixed(2)} s circle r ${a.zr} on the hero's spot, blast there hurts a still hero`);
  ok(b.boom && !b.hurt && b.away > b.zr, `lob: a hero that walked ${Math.round(b.away)} px off is missed`);
  ok(!c.boom, 'lob: killing the spitter in its wind-up cancels the blast');
}
{ // attack budget: 8 bolt casters around a still hero at 0:00 start at most 1 + 0.5 x 10 attacks in 10 s (tokens start at 1, refill 0.5 / s)
  const { w, p } = lab('priest', 150);
  for (let k = 1; k < 8; k++) { const a = k * U.TAU / 8; w.spawnFoe('priest', p.x + Math.cos(a) * 150, p.y + Math.sin(a) * 150); }
  const seen = new Set();
  for (let i = 0; i < 600; i++) { still(w, p); w.update(C.TICK); w.events.length = 0; for (const z of w.zones) if (z.warn && z.team === 1) seen.add(z.id); }
  ok(seen.size >= 5 && seen.size <= 6, `attack budget: 8 casters start ${seen.size} attacks in 10 s`);
}
{ // no retreat: a bolt caster 60 px from a still hero (inside range - 50) strafes, never backs off
  const { w, p, e } = lab('priest', 60); let dMax = 0;
  for (let i = 0; i < 120; i++) { still(w, p); w.update(C.TICK); w.events.length = 0; dMax = Math.max(dMax, Math.hypot(e.x - p.x, e.y - p.y)); }
  ok(dMax < 70, `no retreat: a caster 60 px away stays within ${dMax.toFixed(1)} px over 2 s`);
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
for (const id of ['icewolf', 'eel', 'bulwark', 'frostwisp', 'voideye']) { // charge / dive reach: starts only at 50 < d <= min(range, lane - 12) with a 'dash' lane through the target's spot; stands still `rest` s after the dash
  const { w, p, e } = lab(id, 260), V = e.def.charge || e.def.dive, L = V.speed * V.dur + e.r, lim = Math.min(V.range, L - 12), restS = e.def.guard ? e.def.guard.open : V.rest;
  let startD = -1, look = '', past = 0, restT = -1, moved = 0;
  for (let i = 0; i < 600 && restT < 0; i++) {
    p.atkTok = 2; still(w, p);
    const st0 = e.st, d = Math.hypot(e.x - p.x, e.y - p.y); w.update(C.TICK); w.events.length = 0;
    if (st0 === 0 && e.st === 1 && startD < 0) { startD = d; const z = e.tz; look = z ? z.k : ''; past = z ? z.len - Math.hypot(z.x - p.x, z.y - p.y) : 0; }
    if (st0 === 2 && e.st === 3) {
      const rx = e.x, ry = e.y;
      for (let j = 0; j < 600 && e.st === 3; j++) { p.atkTok = 0; still(w, p); w.update(C.TICK); w.events.length = 0; moved = Math.max(moved, Math.hypot(e.x - rx, e.y - ry)); restT = (j + 1) / 60; }
    }
  }
  ok(startD > 50 && startD <= lim + 1 && look === 'dash' && past >= 11 && Math.abs(restT - restS) < 0.05 && moved < 0.5,
    `${id}: starts at ${startD.toFixed(1)} px (limit ${lim.toFixed(1)}), '${look}' lane ${past.toFixed(1)} px past the hero, rests ${restT.toFixed(2)} s (want ${restS}), moved ${moved.toFixed(1)} px`);
}
{ // diver without a token: spirals in (no orbit-hold), closer after 3 s
  const { w, p, e } = lab('frostwisp', 200);
  for (let i = 0; i < 180; i++) { p.atkTok = 0; still(w, p); w.update(C.TICK); w.events.length = 0; }
  const d1 = Math.hypot(e.x - p.x, e.y - p.y);
  ok(d1 < 110 && e.st === 0, `diver with no token: 200 -> ${d1.toFixed(1)} px in 3 s, no dive`);
}
for (const [id, d] of [['icewolf', 120], ['frostwisp', 100], ['stalker', 160]]) { // charge / dive / blink starts spend one atkTok each; none start below 1
  const a = lab(id, d); let spent = -1;
  for (let i = 0; i < 300 && spent < 0; i++) { a.p.atkTok = 1.5; still(a.w, a.p); const s0 = a.e.st; a.w.update(C.TICK); a.w.events.length = 0; if (s0 === 0 && a.e.st === 1) spent = 1.5 - a.p.atkTok; }
  const b = lab(id, d); let starts = 0;
  for (let i = 0; i < 300; i++) { b.p.atkTok = 0; still(b.w, b.p); const s0 = b.e.st; b.w.update(C.TICK); b.w.events.length = 0; if (s0 === 0 && b.e.st === 1) starts++; }
  ok(Math.abs(spent - 1) < 0.02 && starts === 0, `${ED.FOES[id].ai}: a start spends ${spent.toFixed(2)} atkTok; ${starts} starts in 5 s at 0 tokens`);
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
{ // slam radius vs Knight reach: a base Cleave (range x area from 4 px above the hero, + foe radius) hits a brute pinned straight below the hero with the hero's hitbox
  // 12 px outside its slam circle (elites: 2x radius, slam x1.35, 4 px); a slam blast at that radius misses the hero
  const B = ED.FOE_IDS.filter(id => ED.FOES[id].brute), CB = ED.WEAPONS.cleave.base, out = [];
  for (const id of B) for (const elite of [false, true]) {
    const w = new ED.World({ seed: 5, stage: 0, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
    w.sdef = Object.assign({}, w.sdef, { timeline: w.sdef.timeline.map(r => Object.assign({}, r, { rate: 0, floor: 0 })), events: {}, elites: null, bosses: [] });
    w.arena.obstacles.length = 0; for (let i = 0; i < w.arena.cells.length; i++) w.arena.cells[i] = null;
    const S = ED.FOES[id].slam, R = S.r * (elite ? 1.35 : 1), D = R + C.HERO_R + (elite ? 4 : 12), e = w.spawnFoe(id, p.x, p.y + D, { elite, hpMul: 100 });
    const geo = CB.range * CB.area - 4 + e.r >= D;
    for (let i = 0; i < 120 && e.hp === e.maxHp; i++) { e.x = p.x; e.y = p.y + D; e.acd = 9; w.input('p1', { mx: 0, my: 0, ax: e.x, ay: e.y }); w.update(C.TICK); w.events.length = 0; }
    const hp0 = p.hp; w.foeBlast(e, e.x, e.y, R, 50, 'shock'); w.events.length = 0;
    out.push({ id, elite, ok: geo && e.hp < e.maxHp && p.hp === hp0, s: `${id}${elite ? '*' : ''} slam ${R.toFixed(1)} at ${D.toFixed(1)} px` });
  }
  ok(out.every(o => o.ok), `slam vs base Knight reach (${CB.range * CB.area} px): ${out.map(o => o.s + (o.ok ? '' : ' FAIL')).join(', ')}`);
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
  ok(r.swarms.slice(0, 5).join() === '120,240,360,480,600', `${ED.STAGES[st].id}: swarm events at ${r.swarms.join(',')}`);
  ok(r.elites.slice(0, 4).join() === '150,210,270,330', `${ED.STAGES[st].id}: elites at ${r.elites.slice(0, 6).join(',')}...`);
  ok(r.bosses.length === 2 && r.bosses[0].endsWith('@300') && r.bosses[1].endsWith('@600'), `${ED.STAGES[st].id}: bosses ${r.bosses.join(', ')}`);
  ok(r.capHit > 0 && r.capHit < 420 && r.over === 0, `${ED.STAGES[st].id}: alive cap reached at ${r.capHit} s (alive by minute ${Object.values(r.alive).join(' ')})`);
}
{ // density floor: an empty field refills to row.floor x cap within 0.5 s, never past the cap (no swarm / elite / boss timers); at the floor the rate is x1 (0.01 s step keeps acc < 1)
  const floorRun = (min, n, fill) => {
    const w = new ED.World({ seed: 77, stage: 0, players: players(Array(n).fill('knight')), cheats: { god: true } }), p = w.heroes[0];
    for (const h of w.heroes) { h.weapons.length = 0; h.skills.length = 0; }
    w.time = min * 60; w.sp.bossI = 99; w.sp.swarmT = w.sp.eliteT = w.sp.flockT = Infinity;
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
{ // opening: no instant fill at 0:00 (0.5 s holds at most 2 foes); spawn spread: the 1:00 refill (density floor) surrounds a still hero from every octant;
  // foes walk at 80% speed at 0:00, 100% from 4:00
  const v0 = new ED.World({ seed: 77, stage: 0, players: players(['knight']), cheats: { god: true } });
  for (let i = 0; i < 30; i++) { v0.update(C.TICK); v0.events.length = 0; }
  ok(v0.foes.length <= 2, `opening: ${v0.foes.length} foes after 0.5 s`);
  const w = new ED.World({ seed: 77, stage: 0, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
  p.weapons.length = 0; p.skills.length = 0; w.time = 60; w.sp.bossI = 99; w.sp.swarmT = w.sp.eliteT = w.sp.flockT = Infinity;
  for (let i = 0; i < 30; i++) { w.update(C.TICK); w.events.length = 0; }
  const oct = new Array(8).fill(0);
  for (const e of w.foes) oct[Math.floor(((Math.atan2(e.y - p.y, e.x - p.x) + U.TAU) % U.TAU) / U.TAU * 8) % 8]++;
  ok(w.foes.length >= 12 && oct.every(n => n >= 1) && Math.max(...oct) <= w.foes.length * 0.3, `1:00 refill: ${w.foes.length} foes, per octant ${oct.join(' ')}`);
  const sk = ED.FOES.skeleton.spd, s0 = (w.time = 0, w.spawnFoe('skeleton', 0, 0).spd), s2 = (w.time = 120, w.spawnFoe('skeleton', 0, 0).spd), s4 = (w.time = 240, w.spawnFoe('skeleton', 0, 0).spd);
  ok(Math.abs(s0 - sk * 0.8) < 1e-9 && Math.abs(s2 - sk * 0.9) < 1e-9 && s4 === sk, `foe pace: skeleton ${s0.toFixed(1)} / ${s2.toFixed(1)} / ${s4} px/s at 0:00 / 2:00 / 4:00`);
}
{ // flocks: a weaponless god hero, roster spawns off, sees one flock every 18 s from 0:40; sizes by time, party and formation (line x1.5); a tight pack or a line across the heading on the ring,
  // every member flying through the hero's spot; past the alive cap, not the hard cap
  const flockWorld = (n, stage, seed) => {
    const w = new ED.World({ seed: seed || 78, stage: stage || 0, players: players(Array(n).fill('knight')), cheats: { god: true } });
    for (const h of w.heroes) { h.weapons.length = 0; h.skills.length = 0; }
    w.sdef = Object.assign({}, w.sdef, { timeline: w.sdef.timeline.map(r => Object.assign({}, r, { rate: 0, floor: 0 })), events: { flock: w.sdef.events.flock }, elites: null, bosses: [] });
    return w;
  };
  const size = (fl, t, n, line) => { const v = t < 600 ? fl.n[0] + (fl.n[1] - fl.n[0]) * U.clamp((t - fl.first) / (600 - fl.first), 0, 1) : fl.n[1] + (fl.n[2] - fl.n[1]) * Math.min(1, (t - 600) / 600); return Math.round(v * (1 + 0.25 * (n - 1)) * (line ? 1.5 : 1)); };
  // members F around hero h: centroid distance d, line (on one line across the heading), span (lateral extent), head (heading at h's spot), tight (pack within 80 px)
  const shape = (F, h) => {
    const cx = F.reduce((s, e) => s + e.x, 0) / (F.length || 1), cy = F.reduce((s, e) => s + e.y, 0) / (F.length || 1), d = Math.hypot(cx - h.x, cy - h.y), ux = (h.x - cx) / d, uy = (h.y - cy) / d;
    const along = F.map(e => (e.x - cx) * ux + (e.y - cy) * uy), lat = F.map(e => -(e.x - cx) * uy + (e.y - cy) * ux);
    const line = F.length > 1 && along.every(v => Math.abs(v) < 1), span = F.length ? Math.max(...lat) - Math.min(...lat) : 0;
    const head = F.every(e => e.rushT > 0 && Math.abs(e.rx - ux) < 0.15 && Math.abs(e.ry - uy) < 0.15), tight = F.every(e => Math.hypot(e.x - cx, e.y - cy) <= 80);
    return { n: F.length, d, line, span, head, tight, id: F.length ? F[0].def.id : '' };
  };
  const FL0 = ED.STAGES[0].events.flock, w = flockWorld(1), p = w.heroes[0], times = [], forms = [];
  let last = 0;
  for (let i = 0; w.time < 100; i++) {
    const n0 = w.foes.length; w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y }); w.update(C.TICK); w.events.length = 0;
    if (w.foes.length > last) { times.push(Math.round(w.time) + 'x' + (w.foes.length - last)); forms.push(shape(w.foes.slice(n0), p).line ? 'line' : 'pack'); }
    last = w.foes.length;
  }
  const want = times.map((s, i) => { const t = +s.split('x')[0]; return t + 'x' + size(FL0, t, 1, forms[i] === 'line'); });
  ok(times.length === 4 && times.join() === want.join() && forms.includes('line') && forms.includes('pack'), `flocks at ${times.join(', ')} (time s x size; ${forms.join(', ')})`);
  const one = (n, t, fill, stage, seed) => {
    const v = flockWorld(n, stage, seed), h = v.heroes[0]; v.time = t; v.sp.flockT = t;
    for (let i = 0; i < fill; i++) v.spawnFoe('skeleton', h.x + 600 + (i % 30) * 4, h.y + Math.floor(i / 30) * 4);
    const n0 = v.foes.length; v.updateSpawner(0);
    return Object.assign(shape(v.foes.slice(n0), h), { cap: v.aliveCap(), alive: v.foes.length });
  };
  const a = one(1, 600, 0), b = one(4, 600, 0), c = one(1, 900, 0), d = one(1, 40, 80), e = one(4, 900, 880), f = one(1, 600, 750), g = one(1, 300, 0, 2), h = one(1, 1200, 0), h2 = one(1, 1500, 0);
  ok(a.n === size(FL0, 600, 1, a.line) && b.n === size(FL0, 600, 4, b.line) && c.n === size(FL0, 900, 1, c.line) && g.n === size(ED.STAGES[2].events.flock, 300, 1, g.line) && g.id === 'starspawn'
    && c.n === (c.line ? 69 : 46) && h.n === (h.line ? 78 : 52) && h2.n === (h2.line ? 78 : 52),
    `flock size: ${a.n} at 10:00 solo, ${b.n} x4, ${c.n} at 15:00, ${h.n} at 20:00, ${h2.n} at 25:00, Abyss ${g.n} ${g.id} at 5:00 (lines x1.5)`);
  let pk = null, ln = null;
  for (let s = 1; s < 40 && !(pk && ln); s++) { const r = one(1, 600, 0, 0, s); if (r.line) ln = ln || r; else pk = pk || r; }
  ok(pk && pk.head && pk.tight && pk.d >= 340 && pk.d <= 470, `pack flock: ${pk && pk.n} within 80 px, ${pk && Math.round(pk.d)} px out, every member heading through the hero's spot`);
  ok(ln && ln.head && ln.n === 60 && ln.span >= 300 && ln.d >= 340 && ln.d <= 470, `line flock: ${ln && ln.n} on one line spanning ${ln && Math.round(ln.span)} px across the heading, ${ln && Math.round(ln.d)} px out, heading through the hero's spot`);
  ok((d.n === 8 || d.n === 12) && d.alive > d.cap && f.alive === Math.round(f.cap * 1.25) && e.n === 20 && e.alive === 900, `flock past the alive cap (${d.alive} alive, cap ${d.cap}), at most +25% (${f.alive} at cap ${f.cap}); hard cap holds (${e.n} spawned at 880 -> ${e.alive})`);

  // fly-through: pack, line, closing ring and stampede members (still hero) keep heading and speed (120 x pace), never come back once 40 px past the hero,
  // despawn more than 360 px outside its view; no gem, kill or 'die'
  const V = ED.HERO_VIEW, OUT = 360;
  const flyRun = (spawn) => {
    const v = flockWorld(1, 0, 3), h = v.heroes[0]; v.time = 600; v.sp.flockT = Infinity;
    const n0 = v.foes.length; spawn(v, h); const F = v.foes.slice(n0), ids = new Set(F.map(m => m.id));
    const st = F.map(m => ({ m, id: m.id, rx: m.rx, ry: m.ry, best: -Infinity, past: false, done: false }));
    let turn = 0, back = 0, slow = 0, die = 0, inView = 0, t = 0;
    for (; t < 20 * 60 && st.some(s => !s.done); t++) {
      v.input('p1', { mx: 0, my: 0, ax: h.x + 50, ay: h.y }); v.update(C.TICK);
      for (const ev of v.events) if (ev.t === 'die' && ids.has(ev.id)) die++;
      v.events.length = 0;
      for (const s of st) {
        const m = s.m;
        if (s.done) continue;
        if (m.dead || m.id !== s.id) {
          s.done = true;
          if (Math.abs(m.x - h.x) <= V.hw + OUT && Math.abs(m.y - h.y + V.oy) <= V.hh + OUT) inView++;
          continue;
        }
        if (m.rx !== s.rx || m.ry !== s.ry) turn++;
        if (!(m.freezeT > 0 || m.stunT > 0) && Math.abs(Math.hypot(m.vx, m.vy) - 120 * v.foePace()) > 1e-6) slow++;
        const proj = (m.x - h.x) * s.rx + (m.y - h.y) * s.ry;
        if (proj > 40) s.past = true; // cleared the hero body and the crossing crowd (separation nudges)
        if (s.past && proj < s.best - 2) back++;
        s.best = Math.max(s.best, proj);
      }
    }
    const gems = v.pickups.filter(g => !g.dead && g.k === 'gem').length;
    return { n: F.length, gone: st.every(s => s.done), t: t / 60, turn, back, slow, die, inView, gems, kills: v.kills };
  };
  const flockPick = (line) => (v, h) => {
    for (let i = 0; i < 40; i++) {
      const n0 = v.foes.length, c = v.flockEvent(FL0, h), F = v.foes.slice(n0);
      if (c && shape(F, h).line === line) return;
      for (const m of F) v.despawnFoe(m);
      v.compact();
    }
  };
  const swarmPick = (ring) => (v, h) => {
    for (let i = 0; i < 40; i++) {
      const n0 = v.foes.length; v.swarmEvent(ED.STAGES[0].events.swarm, h);
      const ev = v.events.find(x => x.t === 'warn' && x.kind === 'swarm'); v.events.length = 0;
      if (ev && ev.ring === ring) return;
      for (const m of v.foes.slice(n0)) v.despawnFoe(m);
      v.compact();
    }
  };
  for (const [name, fn] of [['pack', flockPick(false)], ['line', flockPick(true)], ['ring', swarmPick(true)], ['stampede', swarmPick(false)]]) {
    const r = flyRun(fn);
    ok(r.n > 0 && r.gone && !r.turn && !r.back && !r.slow && !r.die && !r.inView && !r.gems && !r.kills,
      `${name} fly-through: ${r.n} members all gone in ${r.t.toFixed(1)} s; heading changes ${r.turn}, speed off ${r.slow}, came back ${r.back}, despawned within view+360 ${r.inView}, 'die' ${r.die}, gems ${r.gems}, kills ${r.kills}`);
  }
  { // never recycled: a rusher 1000 px out (beyond FAR) flying at the hero keeps its course; one flying into the arena bound despawns without a 'die'
    const v = flockWorld(1, 0, 3), h = v.heroes[0], m = v.spawnFoe('bat', h.x + 1000, h.y, { rush: [-1, 0, 20, 96] }), x0 = m.x, id = m.id;
    let die = 0;
    for (let i = 0; i < 70; i++) { v.input('p1', { mx: 0, my: 0, ax: h.x + 50, ay: h.y }); v.update(C.TICK); v.events.length = 0; }
    const moved = x0 - m.x, alive = !m.dead && m.id === id, wall = v.spawnFoe('bat', 20, h.y, { rush: [-1, 0, 20, 96] });
    for (let i = 0; i < 30; i++) { v.input('p1', { mx: 0, my: 0, ax: h.x + 50, ay: h.y }); v.update(C.TICK); for (const ev of v.events) if (ev.t === 'die') die++; v.events.length = 0; }
    ok(alive && Math.abs(m.y - h.y) < 1e-6 && Math.abs(moved - 96 * 70 / 60) < 1 && wall.dead && !die, `rushers never recycle: ${Math.round(moved)} px straight in 70 ticks from 1000 px out; a rusher at the arena bound despawns silently`);
  }
}
{ // benchmark phase: a 'surge' warning at 17:00, then elites every 30 s
  const w = new ED.World({ seed: 77, stage: 1, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
  p.weapons.length = 0; p.skills.length = 0; w.time = 1015; w.sp.eliteT = 1020; w.sp.swarmT = w.sp.flockT = Infinity; w.sp.bossI = 99;
  const surge = [], el = [];
  for (let i = 0; i < 70 * 60; i++) { w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 }); w.update(C.TICK); for (const ev of w.events) if (ev.t === 'warn') (ev.kind === 'surge' ? surge : ev.kind === 'elite' ? el : []).push(Math.round(w.time)); w.events.length = 0; }
  ok(surge.join() === '1020' && el.join() === '1020,1050,1080', `benchmark: surge at ${surge.join()}, elites at ${el.join()}`);
}
{ // 15:00 mid-boss and 20:00 final boss per stage: ids, flags, HP 1500 x (t / 300)^2 x stage HP (twins: two halves); the final boss enrages at ENRAGE_T, not before
  for (const st of [0, 1, 2]) {
    const sd = ED.STAGES[st], k = sd.foe.hp, seen = [];
    const w = new ED.World({ seed: 77, stage: st, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
    p.weapons.length = 0; p.skills.length = 0; w.sp.swarmT = w.sp.flockT = w.sp.eliteT = Infinity; w.sp.bossI = 2; w.sp.warnI = 1;
    const step = (until) => {
      while (w.time < until) {
        w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 }); w.update(C.TICK);
        for (const ev of w.events) if (ev.t === 'boss' && ev.phase === 0) seen.push(ev.id + '@' + Math.round(w.time) + (ev.final ? '!' : ''));
        w.events.length = 0;
      }
    };
    w.time = 894; step(901);
    const mids = w.bossList.slice(), hps = mids.map(e => e.maxHp), midHp = hps.reduce((s, v) => s + v, 0);
    for (const e of mids) w.killFoe(e, null);
    w.time = 1194; step(1201);
    const fin = w.bossList.find(e => e.final), finHp = fin && fin.maxHp;
    w.time = 1318; step(1319.5); const pre = fin && fin.enraged; step(1320.5);
    const want = sd.bosses[2].id + '@900,' + sd.bosses[3].id + '@1200!';
    ok(seen.join() === want && Math.abs(midHp - Math.round(27000 * k)) <= 1 && finHp === Math.round(48000 * k) && !pre && fin.enraged && w.state === 'play',
      `${sd.id}: 15:00 ${seen[0]} (HP ${hps.join(' + ')}), final ${seen[1]} (HP ${finHp}), enraged at ${C.ENRAGE_T} s: ${!!pre} -> ${!!(fin && fin.enraged)}`);
  }
}
{ // damage curves: contact 3 / 9 / 11 and shot factor x1 / x1.8 / x2.1 at 0:00 / 15:00 / 20:00, holding after; swarm waves 50 by 12:00 -> 60 by 20:00 (+-4, minus blocked spots)
  const w = new ED.World({ seed: 77, stage: 0, players: players(['knight']) }), at = (t, f) => { w.time = t; return Math.round(w[f]() * 1000) / 1000; };
  const cd = [0, 450, 900, 1050, 1200, 1500].map(t => at(t, 'contactDmg')).join('/'), fk = [0, 900, 1200, 1500].map(t => at(t, 'foeDmgK')).join('/');
  const sw = (t) => {
    const v = new ED.World({ seed: 5, stage: 0, players: players(['knight']), cheats: { god: true } }), h = v.heroes[0], ns = [];
    v.time = t;
    for (let i = 0; i < 6; i++) { const n0 = v.foes.length; v.swarmEvent(v.sdef.events.swarm, h); ns.push(v.foes.length - n0); for (const f of v.foes) v.despawnFoe(f); v.compact(); v.events.length = 0; }
    return ns;
  };
  const s12 = sw(720), s20 = sw(1200), s25 = sw(1500), near = (ns, n) => ns.every(x => x <= n + 4 && x >= n - 14);
  ok(cd === '3/6/9/10/11/11' && fk === '1/1.8/2.1/2.1' && near(s12, 50) && near(s20, 60) && near(s25, 60) && Math.max(...s20) > 54,
    `curves: contact ${cd} at 0:00/7:30/15:00/17:30/20:00/25:00, shot factor ${fk} at 0:00/15:00/20:00/25:00; swarm waves ${s12.join(',')} at 12:00, ${s20.join(',')} at 20:00, ${s25.join(',')} at 25:00`);
}
{ // a boss id without a script spawns a stand-in brute boss
  const r = spawnRun(0, 302, (w) => { w.sdef = Object.assign({}, w.sdef, { bosses: [{ t: 300, id: 'nobody' }] }); });
  const e = r.w.boss;
  ok(e && e.boss && e.elite && e.def.brute && e.maxHp === 1500, `missing boss script: stand-in ${e && e.def.id} (hp ${e && e.maxHp})`);
}

{ // shooter caps: round(min(8, 3 + 0.4 x minute) x party) ranged alive, round(2 x party) summoners; a weaponless god hero never sees more (bosses off)
  const cw = new ED.World({ seed: 77, stage: 0, players: players(['knight']) }), c4 = new ED.World({ seed: 77, stage: 0, players: players(['knight', 'knight', 'knight', 'knight']) });
  const caps = [0, 300, 600, 720].map(t => (cw.time = t, cw.shooterCap())).join('/');
  ok(caps === '3/5/7/8' && c4.shooterCap() === 5 && cw.summonerCap() === 2 && c4.summonerCap() === 4, `shooter cap ${caps} at 0:00/5:00/10:00/12:00 solo, ${c4.shooterCap()} at 0:00 x4; summoners ${cw.summonerCap()} / ${c4.summonerCap()}`);
  const capRun = (stage, t0, t1, ai, capFn) => {
    const w = new ED.World({ seed: 77, stage, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
    p.weapons.length = 0; p.skills.length = 0; w.time = t0; w.sp.bossI = 99; w.sp.swarmT = Infinity; w.sp.eliteT = t0 + 30;
    let over = 0, peak = 0;
    for (let i = 0; w.time < t1; i++) {
      const a = i / 60 * 0.4; w.input('p1', { mx: Math.cos(a) * 0.6, my: Math.sin(a) * 0.6, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 });
      w.update(C.TICK); w.events.length = 0;
      let n = 0; for (const e of w.foes) if (!e.dead && !e.boss && e.def.ai === ai) n++;
      peak = Math.max(peak, n); if (n > w[capFn]()) over++;
    }
    return { over, peak };
  };
  const r = capRun(1, 180, 420, 'ranged', 'shooterCap'), s = capRun(0, 600, 690, 'summoner', 'summonerCap');
  ok(r.over === 0 && r.peak >= 4, `Glowmire 3:00-7:00: ranged alive peak ${r.peak}, ${r.over} ticks over the cap`);
  ok(s.over === 0 && s.peak >= 1, `Ossuary 10:00-11:30: summoners alive peak ${s.peak}, ${s.over} ticks over the cap`);
}
{ // dasher cap: round(min(12, 3 + 0.6 x minute) x party) chargers + divers + blinkers alive; packs and stampedes trim to the room left
  const cw = new ED.World({ seed: 77, stage: 0, players: players(['knight']) }), c4 = new ED.World({ seed: 77, stage: 0, players: players(['knight', 'knight', 'knight', 'knight']) });
  const caps = [0, 300, 600, 900, 1200].map(t => (cw.time = t, cw.dasherCap())).join('/');
  ok(caps === '3/6/9/12/12' && c4.dasherCap() === 5, `dasher cap ${caps} at 0:00/5:00/10:00/15:00/20:00 solo, ${c4.dasherCap()} at 0:00 x4`);
  const dash = (e) => !e.dead && !e.boss && (e.def.ai === 'charger' || e.def.ai === 'diver' || e.def.ai === 'blinker');
  const run = (stage, t0, t1) => {
    const w = new ED.World({ seed: 77, stage, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
    p.weapons.length = 0; p.skills.length = 0; w.time = t0; w.sp.bossI = 99; w.sp.swarmT = t0 + 20; w.sp.eliteT = t0 + 10;
    let over = 0, peak = 0;
    for (let i = 0; w.time < t1; i++) {
      const a = i / 60 * 0.4; w.input('p1', { mx: Math.cos(a) * 0.6, my: Math.sin(a) * 0.6, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 });
      w.update(C.TICK); w.events.length = 0;
      let n = 0; for (const e of w.foes) if (dash(e)) n++;
      peak = Math.max(peak, n); if (n > w.dasherCap()) over++;
    }
    return { over, peak };
  };
  const r = [0, 1, 2].map(st => run(st, 300, 540));
  ok(r.every(x => x.over === 0 && x.peak >= 4), `5:00-9:00 dashers alive peak ${r.map(x => x.peak).join('/')} (stages 1/2/3), ticks over the cap ${r.map(x => x.over).join('/')}`);
  { // pack trim: 5 divers alive at 5:00 (cap 6) and a hound-only roster: one hound joins, then nothing
    const w = new ED.World({ seed: 77, stage: 0, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
    w.sdef = Object.assign({}, w.sdef, { timeline: w.sdef.timeline.map(row => Object.assign({}, row, { roster: [['icewolf', 1]], floor: 0 })), events: {}, elites: null, bosses: [] });
    w.time = 300; for (let i = 0; i < 5; i++) w.spawnFoe('frostwisp', p.x + 300, p.y + i * 20);
    w.sp.acc = 8; w.updateSpawner(0);
    const hounds = w.foes.filter(e => e.def.id === 'icewolf').length;
    ok(hounds === 1 && w.foes.filter(dash).length === 6, `pack trim: ${hounds} hound joins 5 divers under the cap of 6`);
  }
  // stampede (Abyss at 6:00 lists Rift Stalkers): none join with dashers at the cap; below it, exactly the room left
  const stamp = (pre) => {
    const v = new ED.World({ seed: 9, stage: 2, players: players(['knight']), cheats: { god: true } }), q = v.heroes[0], ev = v.sdef.events.swarm;
    v.time = 360; for (let i = 0; i < pre; i++) v.spawnFoe('voideye', q.x + 300, q.y + i * 20);
    let st = 0, tries = 0;
    while (!st && tries++ < 40) {
      const n0 = v.foes.length; v.swarmEvent(ev, q);
      const e = v.events.find(x => x.t === 'warn' && x.kind === 'swarm'); v.events.length = 0;
      if (e && !e.ring) st = v.foes.length - n0; else { for (const f of v.foes.slice(n0)) v.killFoe(f, null); v.update(C.TICK); v.events.length = 0; }
    }
    return { st, stalkers: v.foes.filter(e => !e.dead && e.def.id === 'stalker').length, cap: v.dasherCap() };
  };
  const full = stamp(7), part = stamp(5);
  ok(full.st > 0 && full.stalkers === 0 && part.stalkers === part.cap - 5, `stampede: ${full.st} members, ${full.stalkers} stalkers at the cap; ${part.stalkers} stalkers with room ${part.cap - 5}`);
}
{ // brute cap: round(min(8, 2 + 0.35 x minute) x party) brutes alive (elites count; elite brutes may exceed it by 2); a weaponless god hero never sees more (bosses off)
  const cw = new ED.World({ seed: 77, stage: 0, players: players(['knight']) }), c4 = new ED.World({ seed: 77, stage: 0, players: players(['knight', 'knight', 'knight', 'knight']) });
  const caps = [0, 300, 600, 900, 1200].map(t => (cw.time = t, cw.bruteCap())).join('/');
  ok(caps === '2/4/6/7/8' && c4.bruteCap() === 4, `brute cap ${caps} at 0:00/5:00/10:00/15:00/20:00 solo, ${c4.bruteCap()} at 0:00 x4`);
  const run = (stage, t0, t1) => {
    const w = new ED.World({ seed: 77, stage, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
    p.weapons.length = 0; p.skills.length = 0; w.time = t0; w.sp.bossI = 99; w.sp.swarmT = t0 + 20; w.sp.eliteT = t0 + 5;
    w.sdef = Object.assign({}, w.sdef, { elites: { first: 0, every: 10 } });
    let over = 0, peak = 0;
    for (let i = 0; w.time < t1; i++) {
      const a = i / 60 * 0.4; w.input('p1', { mx: Math.cos(a) * 0.6, my: Math.sin(a) * 0.6, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 });
      w.update(C.TICK); w.events.length = 0;
      let n = 0; for (const e of w.foes) if (!e.dead && !e.boss && e.def.ai === 'brute') n++;
      peak = Math.max(peak, n); if (n > w.bruteCap() + 2) over++;
    }
    return { over, peak };
  };
  const r = [0, 1, 2].map(st => run(st, 780, 900));
  ok(r.every(x => x.over === 0 && x.peak >= 5), `13:00-15:00 (elites every 10 s) brutes alive peak ${r.map(x => x.peak).join('/')} (stages 1/2/3), ticks over the cap ${r.map(x => x.over).join('/')}`);
  { // an elite brute takes the last room (cap 2 at 0:00, one hulk alive, hulk-only roster); the next spawner tick adds no brute
    const w = new ED.World({ seed: 77, stage: 1, players: players(['knight']), cheats: { god: true } }), p = w.heroes[0];
    w.sdef = Object.assign({}, w.sdef, { timeline: w.sdef.timeline.map(row => Object.assign({}, row, { roster: [['shroomhulk', 1]], rate: 0, floor: 0 })), events: {}, elites: { first: 0, every: 999 }, bosses: [] });
    w.spawnFoe('shroomhulk', p.x + 300, p.y); w.sp.eliteT = 0; w.updateSpawner(0);
    const elite = w.foes.filter(e => e.elite).length; w.sp.acc = 8; w.updateSpawner(0);
    ok(elite === 1 && w.foes.length === 2, `brute cap: an elite hulk fills the room (${elite} elite), then ${w.foes.length - 2} more brutes spawn`);
  }
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
    w.time = 1200; const fin = w.standInBoss({ t: 1200, id: 'x', final: true }); w.killFoe(fin, null); const g0 = w.gold, banked = w.won && w.state === 'play'; w.time = w.lap.t0 + w.lap.dur; w.update(C.TICK); // skips the Last Light lap
    const end = w.events.find(ev => ev.t === 'end');
    const runEnd = Math.round((Math.floor(w.kills / G.bounty) + G.minute * Math.floor(w.time / 60)) * k) + Math.round(G.win * k); // kill bounty + minutes survived, then the win
    return { ok: eliteC >= k && eliteC <= Math.round(5 * k) && midC === Math.round(G.mid * k) && g0 === Math.round(G.final * k) && banked && w.state === 'won' && end && end.summary.gold === w.gold && w.gold === g0 + runEnd, k, eliteC, midC, fin: g0, total: w.gold };
  };
  for (const s of [0, 1, 2]) { const r = goldRun(s); ok(r.ok, `${ED.STAGES[s].id} gold x${r.k}: elite coins ${r.eliteC}, mid-boss coin ${r.midC}, final boss ${r.fin}, summary ${r.total} with the win bonus`); }
}

// ---------------- 7. hero leeway ----------------
{ // knockback: a blast centred behind a foe (foe between it and the hero), its zero-damage form and a projectile flying back at the hero all push the foe away from the hero
  const push = (hit) => { const { w, p, e } = lab('skeleton', 40, { hpMul: 100 }); e.kbx = e.kby = 0; hit(w, p, e); return e.kbx; };
  const kb = push((w, p, e) => w.blast(p, 'test', e.x + 20, e.y, 30, 1, { knock: 200 }));
  const kb0 = push((w, p, e) => w.blast(p, 'test', e.x + 20, e.y, 30, 0, { knock: 200 }));
  const kbp = push((w, p, e) => { w.shoot(p, 'test', e.x + 12, e.y, Math.PI, null, { speed: 300, dmg: 1, pierce: 9, knock: 200, life: 1 }); w.updateProjs(C.TICK); });
  ok(kb > 0 && kb0 > 0 && kbp > 0, `hero hits push foes away from the hitting hero: blast ${Math.round(kb)}, zero-damage blast ${Math.round(kb0)}, returning shot ${Math.round(kbp)} px/s (+x = away)`);
}
{ // splitters: every child starts at least as far from the hero as its parent was, at any bearing, elite or not
  let worst = Infinity, kids = 0;
  for (const id of ['slime', 'glowslime', 'jelly', 'bloater', 'bloatling']) for (let k = 0; k < 8; k++) for (const elite of [false, true]) {
    const a = k / 8 * U.TAU, { w, p, e } = lab(id, 0, { elite });
    e.x = p.x + Math.cos(a) * 30; e.y = p.y + Math.sin(a) * 30;
    const d0 = Math.hypot(e.x - p.x, e.y - p.y), n0 = w.foes.length; w.killFoe(e, null);
    for (const c of w.foes.slice(n0)) { worst = Math.min(worst, Math.hypot(c.x - p.x, c.y - p.y) - d0); kids++; }
  }
  ok(kids > 0 && worst >= -1e-9, `splitter children land on the far side: ${kids} children, closest ${worst.toFixed(2)} px beyond the parent's distance`);
}
{ // hitbox: HERO_R 6; contact needs overlap at r 6
  const touch = (gap) => { const { w, p, e } = lab('skeleton', 0); e.x = p.x + e.r + C.HERO_R + gap; e.spd = 0; p.invuln = 0; const hp0 = p.hp; w.input('p1', { mx: 0, my: 0, ax: p.x + 50, ay: p.y }); w.update(C.TICK); return p.hp < hp0; };
  const { p } = lab('skeleton', 200);
  ok(C.HERO_R === 6 && p.r === 6 && !touch(0.5) && touch(-0.5), `hero hitbox r ${p.r}: no contact 0.5 px apart, contact at 0.5 px overlap`);
}

console.log(`check-horde: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
