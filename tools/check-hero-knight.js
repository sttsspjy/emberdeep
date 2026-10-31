// Headless check of the Knight tree (exit 1 on failure). Usage: node tools/check-hero-knight.js
// 1. Every path rank 1-5 (tune full) changes the effective numbers or the fired pattern (swings / booms / projectiles / zones of one attack string).
// 2. Every Form (1-2 per path) is ready only with its own path at rank 5, locks the others once taken, refines twice and deals damage in a foe ring.
// 3. Damage only in view: every path at rank 5 and every refined Form never hurts a pinned foe 340 px away (outside the 320 px half view) while hurting near ones.
// 3b. Rending Gale stays in a +-30 deg cone (refined): at >= 120 px only rays within 30 deg of the aim are hit; nothing past 45 deg at any distance (crescent bodies near the hero).
// 4. Aegis Ward at levels 1..5: zero damage; foes inside slide out to the edge and cannot walk back in for dur s; level numbers; L5 the ward follows the knight; bosses stay.
// 5. Determinism: the same seed and inputs give the same digest (hero, foes, damage) for every Form; client draw hooks run on a mock batch without non-finite args.
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const ROOT = ED.WEAPONS.cleave, FORMS = ED.weaponForms('cleave');

function world(seed) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'K', slot: 0, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  return w;
}
const ring = (w, x, y, n, r, hpMul) => { for (let i = 0; i < n; i++) { const a = i / n * U.TAU; w.spawnFoe('skeleton', x + Math.cos(a) * r, y + Math.sin(a) * r, { hpMul: hpMul || 1 }); } };
// Path ranks r = [r0, r1, r2] (one nonzero path; all zero: tune only), tune full.
const ranks = (w, p, r) => { const i = r.findIndex(x => x > 0); return w.setRanks(p, p.weapons[0], ED.TUNE_MAX, i, i >= 0 ? r[i] : 0); };

// 1. Pattern of one attack string: counts of swing / boom events, projectiles and zones made within 0.8 s after a fire in a still foe ring.
function pattern(r, form) {
  const w = world(9), p = w.heroes[0];
  const ws = ranks(w, p, r);
  if (form) { w.takeForm(p, ws, form); w.recalc(p, false); }
  ring(w, p.x, p.y, 24, 70, 50); ring(w, p.x, p.y, 24, 130, 50);
  for (const e of w.foes) e.spd = 0;
  ws.cd = 0; let sw = 0, bo = 0, pr = 0, zo = 0;
  const ids = new Set();
  for (let i = 0; i < 48; i++) {
    w.update(C.TICK);
    for (const ev of w.events) { if (ev.t === 'swing') sw++; if (ev.t === 'boom') bo++; }
    w.events.length = 0;
    for (const q of w.projs) if (!q.dead && q.p === p && !ids.has('p' + q.id)) { ids.add('p' + q.id); pr++; }
    for (const z of w.zones) if (!z.dead && z.p === p && !ids.has('z' + z.id)) { ids.add('z' + z.id); zo++; }
    if (i === 0) ws.cd = 99; // one attack string only
  }
  const S = ED.Stats.weapon(p, 0), num = Object.keys(S).sort().map(k => k + ':' + (typeof S[k] === 'number' ? S[k].toFixed(3) : S[k])).join(',');
  return { pat: [sw, bo, pr, zo].join('/'), num };
}
for (let i = 0; i < 3; i++) {
  let prev = pattern([0, 0, 0]);
  for (let k = 1; k <= ED.PATH_MAX; k++) {
    const r = [0, 0, 0]; r[i] = k;
    const cur = pattern(r), txt = k & 1 ? ROOT.paths[i].ranks[k >> 1].txt : 'generic step';
    ok(cur.pat !== prev.pat || cur.num !== prev.num, `${ROOT.paths[i].name} rank ${k} "${txt}" changes the attack (${prev.pat} -> ${cur.pat} swings/booms/projs/zones)`);
    ok(txt.length <= 40, `card line <= 40 chars: "${txt}"`);
    prev = cur;
  }
}
for (const f of FORMS) for (let k = 1; k <= 2; k++) ok(ED.WEAPONS[f.id].refine[k - 1].txt.length <= 40 && ED.WEAPONS[f.id].txt.length <= 40, `${f.id} card lines <= 40 chars`);

// 2. Form rules.
ok(FORMS.length === 5 && ROOT.paths.every(pa => pa.forms.length >= 1 && pa.forms.length <= 2) && FORMS.every(f => f.any.length === 1), `5 Forms, 1-2 per path, each on one path (${ROOT.paths.map(pa => pa.name + ': ' + pa.forms.join('+')).join('; ')})`);
for (const f of FORMS) {
  const w = world(3), p = w.heroes[0], ws = ranks(w, p, [0, 0, 0].map((x, i) => (i === f.path ? ED.PATH_MAX - 1 : 0)));
  const early = w.formsReady(p, ws).length, o = world(3), q = o.heroes[0], other = ranks(o, q, [0, 0, 0].map((x, i) => (i === (f.path + 1) % 3 ? ED.PATH_MAX : 0)));
  w.rankPath(p, ws, f.path);
  const ready = w.formsReady(p, ws).map(x => x.id);
  ok(!early && !o.formsReady(q, other).some(x => x.id === f.id) && ready.indexOf(f.id) >= 0, `${f.id}: ready only once ${ROOT.paths[f.path].name} reaches rank ${ED.PATH_MAX} (ready: ${ready.join(',')})`);
  ok(!w.formsReady(p, world(3).heroes[0].weapons[0]).length, `${f.id}: nothing ready with no ranks`);
  w.takeForm(p, ws, f.id);
  let rf = 0; while (w.refineForm(p, ws)) rf++;
  w.recalc(p, false);
  ok(ws.id === f.id && rf === 2 && !w.formsReady(p, ws).length && !w.takeForm(p, ws, FORMS.find(x => x.id !== f.id).id), `${f.id}: taken, refined ${rf}x, every other Form locked`);
  ring(w, p.x, p.y, 20, 60, 30); ring(w, p.x, p.y, 20, 110, 30);
  let err = null;
  try { for (let i = 0; i < 240; i++) { w.input(p.pid, { mx: 0.3, my: 0, ax: p.x + 60, ay: p.y }); w.update(C.TICK); w.events.length = 0; } } catch (e) { err = e; }
  ok(!err && p.dealt[f.id] > 0, `${f.id}: fires and deals ${Math.round(p.dealt[f.id] || 0)} in 4 s` + (err ? ': ' + err.stack : ''));
}

// 3. View clamp: pinned foes at 340 px (outside) and at 60-150 px (inside) for 5 s.
for (const f of [{ id: 'cleave', r: [5, 0, 0] }, { id: 'cleave', r: [0, 5, 0] }, { id: 'cleave', r: [0, 0, 5] }].concat(FORMS)) {
  const w = world(4), p = w.heroes[0], ws = f.r ? ranks(w, p, f.r) : w.setForm(p, p.weapons[0], f.id, 2);
  const far = [], near = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * U.TAU;
    far.push(w.spawnFoe('skeleton', p.x + (i & 1 ? 340 : -340), p.y + Math.sin(a) * 60, { hpMul: 1e4 }));
    near.push(w.spawnFoe('skeleton', p.x + Math.cos(a) * (60 + i * 12), p.y + Math.sin(a) * (60 + i * 12) * 0.6, { hpMul: 1e4 }));
  }
  const pos = far.concat(near).map(e => [e.x, e.y]);
  for (let i = 0; i < 300; i++) {
    far.concat(near).forEach((e, j) => { e.x = pos[j][0]; e.y = pos[j][1]; e.kbx = e.kby = 0; });
    p.mdir = i / 300 * U.TAU; p.in.ax = p.x + Math.cos(p.mdir) * 100; p.in.ay = p.y + Math.sin(p.mdir) * 100; w.update(C.TICK); w.events.length = 0;
  }
  const hurtFar = far.filter(e => e.hp < e.maxHp).length, hurtNear = near.filter(e => e.hp < e.maxHp).length;
  ok(hurtFar === 0 && hurtNear >= 3, `${f.id} ${f.r ? f.r.join('') : 'refined'}: no damage outside the view (far hurt ${hurtFar}, near hurt ${hurtNear}/8)`);
}

// 3b. Rending Gale cone (refined, aim +x): pinned foes along rays at 30-240 px; at >= 120 px only rays within +-30 deg are hit (240 px still hit at 20 deg), at any distance none past +-45 deg.
{
  const hit = {};
  for (const deg of [0, 20, 30, 40, 60, 75, 90, 135, 180]) for (const sg of [1, -1]) {
    const w = world(4), p = w.heroes[0];
    w.setForm(p, p.weapons[0], 'gale', 2);
    const a = sg * deg * Math.PI / 180, F = [30, 60, 90, 120, 180, 240].map(d => ({ d, x: p.x + Math.cos(a) * d, y: p.y - 4 + Math.sin(a) * d }));
    for (const f of F) f.e = w.spawnFoe('skeleton', f.x, f.y, { hpMul: 1e4 });
    for (let i = 0; i < 240; i++) { for (const f of F) { f.e.x = f.x; f.e.y = f.y; f.e.kbx = f.e.kby = 0; f.e.spd = 0; } w.input(p.pid, { mx: 0, my: 0, ax: p.x + 100, ay: p.y - 4 }); w.update(C.TICK); w.events.length = 0; }
    for (const f of F) if (f.e.hp < f.e.maxHp) hit[f.d] = Math.max(hit[f.d] || 0, deg);
  }
  const far = Math.max(hit[120] || 0, hit[180] || 0, hit[240] || 0), any = Math.max(...Object.values(hit));
  ok(far <= 30 && any <= 45 && hit[120] >= 20 && hit[240] >= 20, `gale cone: widest ray hit by distance ${Object.keys(hit).map(d => d + ' px ' + hit[d] + ' deg').join(', ')}`);
}

// 4. Aegis Ward (zero damage): foes inside r slide out to the edge (elites, knockback-immune foes too; bosses stay) and cannot walk back in for dur s; cd 25 (L4 20);
// L2 +20% radius; L3 +1.5 s; L5 the ward follows the knight. Edge foes stay inside base Cleave reach.
const qWorld = (L) => { const w = world(6), p = w.heroes[0]; p.weapons.length = 0; p.skills[0].lvl = L; return { w, p, N: w.skillN(p, 0) }; };
const qCast = (w, p, x, y) => { w.input(p.pid, { q: true, ax: x, ay: y }); w.update(C.TICK); w.events.length = 0; };
const qRun = (w, n, each) => { for (let i = 0; i < n; i++) { if (each) each(i); w.update(C.TICK); w.events.length = 0; } };
const QD = ED.SKILLS.shove;
ok(QD.name === 'Aegis Ward' && QD.cd === 25 && QD.levels.length === 4 && QD.levels.every(l => l.txt.length <= 40) && QD.txt.length <= 40, `ward: ${QD.name}, cooldown ${QD.cd} s, 4 level cards, lines <= 40 chars`);
{
  const want = [[50, 6.5, 25, false], [60, 6.5, 25, false], [60, 8, 25, false], [60, 8, 20, false], [60, 8, 20, true]];
  const got = [1, 2, 3, 4, 5].map(L => { const N = qWorld(L).N; return [N.r, N.dur, N.cd, !!N.follow]; });
  ok(got.every((g, i) => Math.abs(g[0] - want[i][0]) < 1e-6 && Math.abs(g[1] - want[i][1]) < 1e-6 && Math.abs(g[2] - want[i][2]) < 1e-6 && g[3] === want[i][3]),
    `ward levels r / dur / cd / follow: ${got.map(g => g[0].toFixed(0) + '/' + g[1].toFixed(1) + '/' + g[2].toFixed(0) + (g[3] ? '/F' : '')).join(', ')}`);
  ok(QD.base.r + 4 <= ED.WEAPONS.cleave.base.range, `ward edge (r ${QD.base.r} + foe radius, hero 4 px below the swing centre) inside base Cleave reach ${ED.WEAPONS.cleave.base.range} + foe radius`);
}
for (let L = 1; L <= 5; L++) {
  const { w, p, N } = qWorld(L), cx = p.x, cy = p.y;
  const foes = []; for (let i = 0; i < 12; i++) { const a = i / 12 * U.TAU, d = 6 + (i % 4) * (N.r - 10) / 3; foes.push(w.spawnFoe('skeleton', cx + Math.cos(a) * d, cy + Math.sin(a) * d, { hpMul: 50 })); }
  const el = w.spawnFoe('skeleton', cx + 10, cy + 5, { elite: true, hpMul: 50 }), im = w.spawnFoe('skelknight', cx - 12, cy - 8, { hpMul: 50 });
  const walk = []; for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * U.TAU; walk.push(w.spawnFoe('skeleton', cx + Math.cos(a) * (N.r + 50), cy + Math.sin(a) * (N.r + 50), { hpMul: 50 })); }
  for (const e of w.foes) e.spd = 0;
  qCast(w, p, cx + 100, cy);
  const cd0 = p.skills[0].cd;
  qRun(w, 30, () => { p.x = cx; p.y = cy; });
  const inner = foes.concat([el, im]), dmin = Math.min(...inner.map(e => U.dist(cx, cy, e.x, e.y) - e.r));
  const ward = w.zones.find(z => !z.dead && z.k === 'bulwark');
  ok(!!ward && dmin >= N.r - 1 && w.foes.every(e => e.hp === e.maxHp) && !(p.dealt.shove > 0) && Math.abs(cd0 - N.cd) < 0.05,
    `ward L${L}: r ${N.r.toFixed(0)}, 14 foes (elite, knockback-immune) out to >= r (${dmin.toFixed(1)}), zero damage, cooldown ${cd0.toFixed(1)} s`);
  for (const e of walk) { e.spd = 50; e.slowT = 0; e.slowK = 0; }
  let inside = 0, reachOk = true;
  qRun(w, Math.round((N.dur - 0.8) / C.TICK), () => {
    p.x = cx; p.y = cy;
    for (const e of w.foes) if (!e.dead && U.dist(cx, cy, e.x, e.y) < N.r + e.r - 0.5) inside++;
  });
  const near = walk.map(e => U.dist(cx, cy, e.x, e.y));
  if (L === 1) for (const e of walk) if (Math.hypot(e.x - cx, e.y - (cy - 4)) > ED.WEAPONS.cleave.base.range + e.r) reachOk = false;
  ok(inside === 0 && Math.max(...near) < N.r + 20 && reachOk, `ward L${L}: 8 foes walking in stay outside for ${(N.dur - 0.8).toFixed(1)} s (closest ${Math.min(...near).toFixed(0)}, farthest ${Math.max(...near).toFixed(0)} px)` + (L === 1 ? `, all within Cleave reach (${reachOk})` : ''));
  qRun(w, 60, () => { p.x = cx; p.y = cy; });
  ok(!w.zones.some(z => !z.dead && z.k === 'bulwark'), `ward L${L}: gone after ${N.dur.toFixed(1)} s`);
}
{ // a boss inside stays put; L5: the ward follows the walking knight and shoulders foes aside, stationary below L5
  for (const L of [4, 5]) {
    const { w, p, N } = qWorld(L), cx = p.x, cy = p.y;
    const boss = w.spawnFoe('skeleton', cx + 20, cy, { hpMul: 50 }); boss.boss = true;
    const lane = []; for (let i = 0; i < 6; i++) lane.push(w.spawnFoe('skeleton', cx + 100 + i * 30, cy + (i % 2 ? 8 : -8), { hpMul: 50 }));
    for (const e of w.foes) e.spd = 0;
    qCast(w, p, cx + 100, cy); qRun(w, 30, () => { p.x = cx; p.y = cy; });
    const bx = boss.x; boss.x = 1e5; boss.y = 1e5; boss.dead = true; // out of the way for the walk
    let maxOff = 0, inside = 0;
    qRun(w, 180, () => {
      w.input(p.pid, { mx: 1, my: 0, ax: p.x + 100, ay: p.y });
      const z = w.zones.find(q => !q.dead && q.k === 'bulwark');
      if (z) maxOff = Math.max(maxOff, U.dist(z.x, z.y, p.x, p.y));
      for (const e of lane) if (z && U.dist(z.x, z.y, e.x, e.y) < z.r + e.r - 0.5) inside++;
    });
    const z = w.zones.find(q => !q.dead && q.k === 'bulwark');
    if (L === 5) ok(!!z && maxOff < 3 && inside === 0 && p.x - cx > 100, `ward L5 follows the knight (${(p.x - cx).toFixed(0)} px walked, centre off by <= ${maxOff.toFixed(1)} px), ${inside} foe-ticks inside`);
    else ok(!!z && U.dist(z.x, z.y, cx, cy) < 1 && Math.abs(bx - (cx + 20)) < 1, `ward L4 stays at the cast point; a boss inside is not moved (${(bx - cx).toFixed(0)} px)`);
  }
}

// 5. Determinism + client hooks on a mock batch.
const calls = { n: 0 };
const mockB = new Proxy({}, { get: (o, k) => (k === 'crowd' || k === 'zoneLite' ? 0 : (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite arg to B.' + String(k)); return true; }) });
ED.Atlas = { ok: true, has: () => true, anim: () => ({ n: 6 }), frameAt: () => 0 };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'hfx-knight.js'), 'utf8'), { filename: 'hfx-knight.js' });
function digestRun(form, draw) {
  const w = world(12), p = w.heroes[0];
  w.setForm(p, p.weapons[0], form, 2);
  p.skills[0].lvl = 5;
  let d = 0, err = null;
  try {
    for (let i = 0; i < 360; i++) {
      if (i % 60 === 0) ring(w, p.x, p.y, 16, 90 + (i % 7) * 15, 8);
      const e = w.nearestFoe(p.x, p.y, 300), a = i / 60;
      w.input(p.pid, { mx: Math.cos(a) * 0.5, my: Math.sin(a) * 0.5, ax: e ? e.x : p.x + 60, ay: e ? e.y : p.y, q: true });
      w.update(C.TICK); w.events.length = 0;
      if (draw) {
        for (const z of w.zones) { const f = !z.dead && (ED.WeaponFx[z.wid] || ED.SkillFx[z.wid]); if (f && f.zone) f.zone(mockB, z, w.time); }
        for (const q of w.projs) { const f = !q.dead && ED.WeaponFx[q.wid]; if (f && f.proj) f.proj(mockB, q, w.time); }
        ED.HeroFx.knight(mockB, p, w.time);
      }
      if (i % 30 === 0) { let s = w.tick + '|' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + '|' + Math.round(p.dealt[form] || 0) + '|' + Math.round(p.dealt.shove || 0) + '|' + w.kills; for (const e of w.foes) if (!e.dead) s += '|' + e.x.toFixed(2) + ',' + e.hp; d = (Math.imul(d, 31) + U.hashStr(s)) >>> 0; }
    }
  } catch (e) { err = e; }
  return { d, err, dealt: p.dealt[form] || 0 };
}
for (const f of FORMS) {
  const a = digestRun(f.id, true), b = digestRun(f.id, false);
  ok(!a.err && !b.err && a.d === b.d && a.dealt > 0, `${f.id}: same digest twice (${a.d.toString(16)} / ${b.d.toString(16)})` + (a.err ? ': ' + a.err.stack : ''));
}
ok(calls.n > 1000, `client hooks drew on the mock batch (${calls.n} calls)`);

console.log(`check-hero-knight: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
