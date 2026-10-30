// Headless check for the Necro tree (exit 1 on failure). Usage: node tools/check-hero-necro.js
// 1. Every path rank changes the effective numbers; card lines <= 40 chars. 2. Forms: each pure Form is ready only with its path at rank 3, each hybrid only with both
// paths at rank 3; one Form per run; every Form fires and deals damage in a crowd. 3. Pattern checks: army cap / kill-rise extras, splinters, pools (cap, burst, spread),
// Bone Knight slams, ghoul bursts leave pools, archers shoot. 4. Damage lands only on foes inside the hero's view. 5. Bone Wall at levels 1-4 (block, ring, taunt, zero damage).
// 6. Same seed -> same digest.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const ROOT = ED.WEAPONS.boneshard, FORMS = ['bonelord', 'bonestorm', 'plaguefield', 'lich', 'ossuary'];

const world = (seed) => {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'N', slot: 0, cls: 'necro', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of w.sdef.timeline) { row.rate = 0; row.floor = 0; }
  w.sp.swarmT = w.sp.eliteT = Infinity; w.sdef = Object.assign({}, w.sdef, { bosses: [], bench: null });
  return w;
};
const build = (w, p, ranks, form) => {
  const ws = p.weapons[0];
  for (let i = 0; i < 3; i++) for (let k = 0; k < ranks[i]; k++) w.rankPath(p, ws, i);
  const took = form ? w.takeForm(p, ws, form) : true;
  if (form) while (w.refineForm(p, ws));
  w.recalc(p, false);
  return took;
};
// Keeps n skeletons 30-200 px around the hero; returns nothing.
const crowd = (w, p, rng, n) => {
  let c = 0; for (const e of w.foes) if (!e.dead) c++;
  for (; c < n; c++) { const a = rng.next() * U.TAU, d = 30 + rng.next() * 170, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d * 0.6; if (!ED.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe('skeleton', x, y, { hpMul: 2 }); }
};
// Runs secs in a crowd (no card picks, Q when q); calls each(w, p) per tick. Returns { w, p, dealt (weapon), q (skill), digest }.
const runCrowd = (ranks, form, secs, opt) => {
  opt = opt || {};
  const w = world(opt.seed), p = w.heroes[0], rng = U.RNG(opt.seed || 9);
  build(w, p, ranks, form);
  if (opt.lvl) p.skills[0].lvl = opt.lvl;
  let digest = 0;
  for (let i = 0; i < secs * 60; i++) {
    crowd(w, p, rng, opt.n || 120);
    p.offer = null; p.pend = 0;
    const e = w.nearestFoe(p.x, p.y, 300);
    w.input(p.pid, { mx: 0, my: 0, ax: e ? e.x : p.x + 60, ay: e ? e.y : p.y, q: !!opt.q });
    w.update(C.TICK);
    if (opt.each) opt.each(w, p);
    w.events.length = 0;
    digest = (Math.imul(digest, 31) + U.hashStr(w.kills + '|' + w.zones.length + '|' + w.projs.length + '|' + ED.Necro.liveMinions(p))) >>> 0;
  }
  let wd = 0; for (const k in p.dealt) if (k !== 'bonewall') wd += p.dealt[k];
  return { w, p, dealt: wd, q: p.dealt.bonewall || 0, digest };
};

// 1. ranks change the numbers; card lines
{
  const w = world(), p = w.heroes[0], ws = p.weapons[0];
  const snap = () => JSON.stringify(ED.Stats.weapon(p, 0));
  for (let i = 0; i < 3; i++) {
    for (let r = 0; r < 3; r++) {
      const a = snap(); w.rankPath(p, ws, i); w.recalc(p, false); const b = snap();
      ok(a !== b, `path ${ROOT.paths[i].id} rank ${r + 1} changes the numbers ("${ROOT.paths[i].ranks[r].txt}")`);
    }
  }
  const lines = [ROOT.txt].concat(...ROOT.paths.map(pa => pa.ranks.map(l => l.txt)), ...FORMS.map(f => [ED.WEAPONS[f].txt].concat(ED.WEAPONS[f].refine.map(l => l.txt))), ED.SKILLS.bonewall.levels.map(l => l.txt));
  const names = FORMS.map(f => ED.WEAPONS[f].name.toLowerCase());
  ok(lines.every(s => s.length <= 40), 'every card line <= 40 chars');
  ok(ROOT.paths.every(pa => pa.ranks.every(l => names.every(n => l.txt.toLowerCase().indexOf(n) < 0))), 'rank lines never name a Form');
}

// 2. Form rules
{
  const ready = (ranks) => { const w = world(), p = w.heroes[0]; build(w, p, ranks, ''); return w.formsReady(p, p.weapons[0]).map(f => f.id).sort().join(','); };
  ok(ready([2, 3, 3]) === 'bonestorm,plaguefield', `path 0 at rank 2: no Bone Lord, no hybrids (${ready([2, 3, 3])})`);
  ok(ready([3, 0, 0]) === 'bonelord', `Legion 3 -> Bone Lord only (${ready([3, 0, 0])})`);
  ok(ready([0, 3, 0]) === 'bonestorm', `Shards 3 -> Bone Storm only (${ready([0, 3, 0])})`);
  ok(ready([0, 0, 3]) === 'plaguefield', `Plague 3 -> Plague Field only (${ready([0, 0, 3])})`);
  ok(ready([3, 0, 3]) === 'bonelord,lich,plaguefield', `Legion 3 + Plague 3 -> Lich (${ready([3, 0, 3])})`);
  ok(ready([3, 3, 0]) === 'bonelord,bonestorm,ossuary', `Legion 3 + Shards 3 -> Ossuary (${ready([3, 3, 0])})`);
  const w = world(), p = w.heroes[0], ws = p.weapons[0];
  build(w, p, [3, 3, 3], 'lich');
  ok(ws.id === 'lich' && ws.fl === 2 && w.formsReady(p, ws).length === 0 && !w.takeForm(p, ws, 'bonelord'), 'one Form per run: Lich taken, refined twice, no other Form');
  for (const f of FORMS) {
    const need = f === 'lich' ? [3, 0, 3] : f === 'ossuary' ? [3, 3, 0] : f === 'bonelord' ? [3, 0, 0] : f === 'bonestorm' ? [0, 3, 0] : [0, 0, 3];
    const r = runCrowd(need, f, 6);
    ok(r.p.weapons[0].id === f && r.dealt > 0 && r.p.dealt[f] > 0, `${f}: fires and deals damage (${Math.round(r.dealt / 6)} dps)`);
  }
}

// 3. patterns
{
  // base army: 3 skeletons within 3 s, never more; Legion: 5 + up to 4 kill-rise extras.
  let peak = 0;
  runCrowd([0, 0, 0], '', 5, { each: (w, p) => { peak = Math.max(peak, ED.Necro.liveMinions(p)); } });
  ok(peak === 3, `base army holds 3 skeletons (peak ${peak})`);
  let early = 0;
  runCrowd([0, 0, 0], '', 3.2, { n: 0, each: (w, p) => { early = ED.Necro.liveMinions(p); } });
  ok(early === 3, `the army rises with no foes and no corpses (${early} after 3.2 s)`);
  let peakL = 0;
  runCrowd([2, 0, 0], '', 10, { n: 160, each: (w, p) => { peakL = Math.max(peakL, ED.Necro.liveMinions(p)); } });
  ok(peakL > 5 && peakL <= 9, `Legion 2: cap 5 plus kill-rise extras up to 9 (peak ${peakL})`);
  // splinters: Shards 2 spawns more hero projectiles than Shards 1.
  let pr1 = 0, pr2 = 0;
  runCrowd([0, 1, 0], '', 4, { each: (w) => { pr1 += w.projs.length; } });
  runCrowd([0, 2, 0], '', 4, { each: (w) => { pr2 += w.projs.length; } });
  ok(pr2 > pr1 * 1.5, `Shards 2: shards burst into splinters (projectile ticks ${pr1} -> ${pr2})`);
  // pools: Plague 1 spills pools, never above 14 live; Plague 3 pools burst (blast hits credited at dry-up); Plague Field spreads past the pools it lobs.
  let pools = 0, maxPools = 0;
  runCrowd([0, 0, 3], '', 8, { n: 160, each: (w, p) => { const n = p.pools ? p.pools.filter(z => !z.dead).length : 0; pools = Math.max(pools, n); maxPools = Math.max(maxPools, w.zones.filter(z => !z.dead && z.k === 'blight').length); } });
  ok(pools > 0 && maxPools <= 14, `Plague 3: pools spill (peak ${pools}, live blight zones <= 14: ${maxPools})`);
  let booms = 0;
  runCrowd([0, 0, 3], '', 6, { each: (w) => { for (const ev of w.events) if (ev.t === 'boom' && ev.look === 'blight') booms++; } });
  ok(booms > 0, `Plague 3: pools burst as they dry (${booms} bursts)`);
  let globs = 0, plague = 0;
  runCrowd([0, 0, 3], 'plaguefield', 6, { n: 160, each: (w) => { for (const pr of w.projs) if (!pr.dead && pr.k === 'glob' && pr.t === C.TICK) globs++; plague = Math.max(plague, w.zones.filter(z => !z.dead && z.k === 'plague').length); } });
  ok(globs > 0 && plague > 4, `Plague Field: lobs globs (${globs}) and pools spread from the slain (peak ${plague} plague pools)`);
  // Bone Lord: knights, slams.
  let knights = 0, slams = 0;
  runCrowd([3, 0, 0], 'bonelord', 6, { each: (w, p) => { knights = Math.max(knights, w.zones.filter(z => !z.dead && z.k === 'boneknight').length); for (const z of w.zones) if (z.k === 'boneslam' && z.t === C.TICK) slams++; } });
  ok(knights >= 8 && slams > 0, `Bone Lord: the army rises as Bone Knights (peak ${knights}) that slam (${slams})`);
  // Lich: ghouls burst (minion blasts) and leave pools.
  let ghouls = 0, gb = 0, gp = 0;
  runCrowd([3, 0, 3], 'lich', 6, { each: (w) => { ghouls = Math.max(ghouls, w.zones.filter(z => !z.dead && z.k === 'ghoul').length); for (const ev of w.events) if (ev.t === 'boom' && ev.look === 'ghoul') gb++; gp = Math.max(gp, w.zones.filter(z => !z.dead && z.k === 'blight').length); } });
  ok(ghouls > 0 && gb > 0 && gp > 0, `Lich: ghouls rise (peak ${ghouls}), burst (${gb}) and leave pools (peak ${gp})`);
  // Ossuary: archers shoot (archer shards are the r 6 projectiles; hero shards r 4, splinters r 3).
  let archers = 0, ashots = 0;
  runCrowd([3, 3, 0], 'ossuary', 6, { each: (w) => { archers = Math.max(archers, w.zones.filter(z => !z.dead && z.k === 'bonearcher').length); for (const pr of w.projs) if (!pr.dead && pr.r === 6 && pr.t <= C.TICK + 1e-9) ashots++; } });
  ok(archers >= 8 && ashots > 0, `Ossuary: the army rises as archers (peak ${archers}) that loose shards (${ashots})`);
}

// 4. damage only in view: a crowd inside the view and a ring far outside; every damaged foe overlaps the view.
{
  let out = 0, inn = 0;
  const hk = ED.HOOK.necro;
  ED.HOOK.necro = { hit(w, p, e) { if (ED.inView(p, e.x, e.y, e.r)) inn++; else out++; } };
  for (const f of ['', 'bonelord', 'bonestorm', 'plaguefield', 'lich', 'ossuary']) {
    const need = f === '' ? [3, 3, 3] : [3, 3, 3];
    runCrowd(need, f, 4, { q: true, lvl: 4, each: (w, p) => { if (w.tick % 30 === 0) for (let i = 0; i < 12; i++) { const a = i / 12 * U.TAU; w.spawnFoe('skeleton', p.x + Math.cos(a) * 420, p.y + Math.sin(a) * 260, { hpMul: 2 }); } } });
  }
  ED.HOOK.necro = hk;
  ok(inn > 0 && out === 0, `damage lands only inside the view (in ${inn}, out ${out})`);
}

// 5. Bone Wall at levels 1-4 (zero damage): an arc wall at the cursor that walking foes cannot cross (bosses can); L2 longer; L3 a ring that holds foes inside and out; L4 taunts foes within 160 px.
{
  const def = ED.SKILLS.bonewall;
  ok(def.cd >= 7 && def.cd <= 16 && def.levels.length === 3 && def.levels.every(l => l.txt.length <= 40) && def.txt.length <= 40, `Bone Wall: cooldown ${def.cd} s, 3 level cards, lines <= 40 chars`);
  const setup = (L) => { const w = world(), p = w.heroes[0]; p.weapons.length = 0; p.skills[0].lvl = L; return { w, p, N: w.skillN(p, 0), cx: p.x, cy: p.y }; };
  const tick = (w, p, cx, cy, n, each) => { for (let i = 0; i < n; i++) { p.x = cx; p.y = cy; p.offer = null; p.pend = 0; w.update(C.TICK); w.events.length = 0; if (each) each(); } };
  // walkers: 8 foes 70 px beyond the cursor (on the hero-cursor axis, +-30 px) walking at the hero; counts foes ever inside the wall's arc (radius < R - 2, within the span)
  const walk = (L, wall) => {
    const { w, p, N, cx, cy } = setup(L);
    const fs = []; for (let i = 0; i < 8; i++) { const e = w.spawnFoe('skeleton', cx + 220 + (i & 1) * 14, cy + (i - 3.5) * 8, { hpMul: 50 }); e.spd = 60; fs.push(e); }
    const boss = w.spawnFoe('skeleton', cx + 230, cy + 2, { hpMul: 50 }); boss.boss = true; boss.spd = 60;
    if (wall) { p.in.q = true; p.in.ax = cx + 150; p.in.ay = cy; }
    tick(w, p, cx, cy, 1); p.in.q = false;
    const z = w.zones.find(q => !q.dead && q.k === 'bonewall');
    let crossed = 0;
    const cx0 = z ? z.x : cx + 30, cy0 = z ? z.y : cy, R = z ? z.r : 120, half = z ? z.arc / 2 : 0.58;
    tick(w, p, cx, cy, 90, () => { for (const e of fs) if (!e.dead && U.dist(cx0, cy0, e.x, e.y) < R - 2 && Math.abs(U.angDiff(0, Math.atan2(e.y - cy0, e.x - cx0))) < half) crossed++; });
    const hurt = w.foes.filter(e => e.hp < e.maxHp).length;
    return { w, p, N, z, crossed, hurt, bossIn: U.dist(cx0, cy0, boss.x, boss.y) < R - 10 };
  };
  const ctl = walk(1, false);
  ok(ctl.crossed > 0, `Bone Wall control: without a wall the walkers pass the wall's spot (${ctl.crossed} foe-ticks)`);
  for (const L of [1, 2]) {
    const r = walk(L, true), len = r.z ? r.z.arc * r.z.r : 0;
    ok(!!r.z && Math.abs(len - (L >= 2 ? 200 : 140)) < 1e-6 && Math.abs(r.z.x + r.z.r - (r.p.x + 150)) < 1e-6 && r.crossed === 0 && r.hurt === 0 && !(r.p.dealt.bonewall > 0) && r.bossIn,
      `Bone Wall L${L}: ${len.toFixed(0)} px arc through the cursor, 0 walkers crossed (${r.crossed}), boss walks through ${r.bossIn}, zero damage (hurt ${r.hurt})`);
    tick(r.w, r.p, r.p.x, r.p.y, Math.round(r.N.dur * 60));
    ok(!r.w.zones.some(q => !q.dead && q.k === 'bonewall'), `Bone Wall L${L}: gone after ${r.N.dur} s`);
  }
  { // L3 ring: foes inside stay inside, foes outside stay outside
    const { w, p, N, cx, cy } = setup(3), mx = cx + 150;
    const ins = [], outs = [];
    for (let i = 0; i < 6; i++) { const a = i / 6 * U.TAU; ins.push(w.spawnFoe('skeleton', mx + Math.cos(a) * 30, cy + Math.sin(a) * 30, { hpMul: 50 })); outs.push(w.spawnFoe('skeleton', mx + 140 + Math.cos(a) * 20, cy + Math.sin(a) * 20, { hpMul: 50 })); }
    for (const e of w.foes) e.spd = 60;
    p.in.q = true; p.in.ax = mx; p.in.ay = cy; tick(w, p, cx, cy, 1); p.in.q = false;
    const z = w.zones.find(q => !q.dead && q.k === 'bonewall');
    let bad = 0;
    tick(w, p, cx, cy, 150, () => { for (const e of ins) if (U.dist(mx, cy, e.x, e.y) > N.ring) bad++; for (const e of outs) if (U.dist(mx, cy, e.x, e.y) < N.ring) bad++; });
    ok(!!z && z.arc === 0 && z.r === N.ring && z.x === mx && bad === 0, `Bone Wall L3: ring r ${N.ring} around the cursor holds 6 foes in and 6 out for 2.5 s (${bad} breaches)`);
  }
  { // L4 taunt: a foe 120 px off the ring walks to it, a boss does not
    const { w, p, N, cx, cy } = setup(4), mx = cx + 150;
    const e = w.spawnFoe('skeleton', mx, cy + N.ring + 120, { hpMul: 50 }), boss = w.spawnFoe('skeleton', mx, cy - N.ring - 120, { hpMul: 50 }); boss.boss = true;
    p.in.q = true; p.in.ax = mx; p.in.ay = cy; tick(w, p, cx, cy, 1); p.in.q = false;
    tick(w, p, cx, cy, 20);
    const lured = e.ovK === 2;
    tick(w, p, cx, cy, 300);
    const gap = U.dist(mx, cy, e.x, e.y) - N.ring;
    ok(lured && gap < 30 && boss.ovT === 0, `Bone Wall L4: foe 120 px off the ring lured (${lured}), now ${gap.toFixed(0)} px from it; boss never lured`);
  }
}

// 6. determinism
{
  const a = runCrowd([3, 3, 3], 'lich', 5, { q: true, lvl: 4, seed: 21 }), b = runCrowd([3, 3, 3], 'lich', 5, { q: true, lvl: 4, seed: 21 });
  ok(a.digest === b.digest && a.dealt === b.dealt, `same seed -> same digest (${a.digest} / ${b.digest})`);
}
console.log(`check-hero-necro: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
