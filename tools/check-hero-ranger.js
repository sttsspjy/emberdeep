// Headless check of the Ranger tree (exit 1 on failure). Usage: node tools/check-hero-ranger.js
// 1. Every path rank changes the effective numbers or the fired pattern (arrows and foe hits of three volleys); card lines <= 40 chars.
// 2. Every Form (3 pure + 2 hybrid) is ready only under its rule (its path(s) at rank 3), locks the others once taken, refines twice and deals damage in a foe ring.
// 3. Mechanics: arrows fly along the cursor past nearer foes and elites; the split fan (two) aims its second half at a foe off the cursor line, else 0.35 rad off it; bounces turn arrows to unhit foes; kill shots fire from kills; Ballista bolts pierce a whole line; Rebound arrows turn at the view edge.
// 4. Damage only in view: a full 3/3/3 build of the Longbow and every Form never hurts a pinned foe 340 px away (outside the 320 px half view) while hurting a near one.
// 5. Vault at levels 1..4: zero damage leap toward the cursor, untouchable, gem pull on landing; L2 farther, L3 2 charges, L4 caltrops; obstacle-safe landing.
// 6. Determinism: the same seed and inputs give the same digest for every Form; client draw hooks run on a mock batch without non-finite args.
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const ROOT = ED.WEAPONS.longbow, FORMS = ED.weaponForms('longbow');

function world(seed) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'R', slot: 0, cls: 'ranger', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  return w;
}
const ring = (w, x, y, n, r, hpMul) => { for (let i = 0; i < n; i++) { const a = i / n * U.TAU; w.spawnFoe('skeleton', x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, { hpMul: hpMul || 1 }); } };
const ranks = (w, p, r) => { const ws = p.weapons[0]; for (let i = 0; i < 3; i++) for (let k = 0; k < r[i]; k++) w.rankPath(p, ws, i); w.recalc(p, false); return ws; };
const form = (w, p, ws, id) => { w.takeForm(p, ws, id); while (w.refineForm(p, ws)); w.recalc(p, false); };
const step = (w, n) => { for (let i = 0; i < n; i++) { w.update(C.TICK); w.events.length = 0; } };
const aimAt = (p, a) => { p.mdir = a; p.in.ax = p.x + Math.cos(a) * 100; p.in.ay = p.y + Math.sin(a) * 100; };

// 1. Pattern of three volleys into a still foe grid (20 px apart over the view, 40 px clear around the hero): projectiles made, foe hits (hit records), wide projectiles.
function pattern(r, fid) {
  const w = world(9), p = w.heroes[0];
  const ws = ranks(w, p, r);
  if (fid) form(w, p, ws, fid);
  for (let gx = -300; gx <= 300; gx += 20) for (let gy = -160; gy <= 160; gy += 20) if (Math.hypot(gx, gy) >= 40) w.spawnFoe('skeleton', p.x + gx, p.y + gy, { hpMul: 50 });
  for (const e of w.foes) e.spd = 0;
  ws.cd = 0;
  let pr = 0, hits = 0, wide = 0, fired = 0;
  const ids = new Set();
  for (let i = 0; i < 150; i++) {
    w.update(C.TICK);
    for (const ev of w.events) { if (ev.t === 'hit') hits++; if (ev.t === 'shoot') fired++; }
    w.events.length = 0;
    for (const q of w.projs) if (!q.dead && q.p === p && !ids.has(q.id)) { ids.add(q.id); pr++; if (q.r >= 7) wide++; }
    if (fired >= 3) ws.cd = 99;
  }
  const S = ED.Stats.weapon(p, 0), num = Object.keys(S).sort().map(k => k + ':' + (typeof S[k] === 'number' ? S[k].toFixed(3) : S[k])).join(',');
  return { pat: [pr, hits, wide].join('/'), num };
}
for (let i = 0; i < 3; i++) {
  let prev = pattern([0, 0, 0]);
  for (let k = 1; k <= 3; k++) {
    const r = [0, 0, 0]; r[i] = k;
    const cur = pattern(r), txt = ROOT.paths[i].ranks[k - 1].txt;
    ok(cur.pat !== prev.pat || cur.num !== prev.num, `${ROOT.paths[i].name} rank ${k} "${txt}" changes the attack (${prev.pat} -> ${cur.pat} projs/hits/wide)`);
    ok(txt.length <= 40, `card line <= 40 chars: "${txt}"`);
    prev = cur;
  }
}
for (const f of FORMS) for (let k = 1; k <= 2; k++) ok(ED.WEAPONS[f.id].refine[k - 1].txt.length <= 40 && ED.WEAPONS[f.id].txt.length <= 40, `${f.id} card lines <= 40 chars`);
for (const f of FORMS) { const a = pattern([3, 3, 3], f.id), b = pattern([3, 3, 3]); ok(a.pat !== b.pat, `${f.id}: a new pattern over the 3/3/3 Longbow (${b.pat} -> ${a.pat})`); }

// 2. Form rules.
ok(FORMS.length === 5 && FORMS.filter(f => f.path < 0).length === 2 && ROOT.paths.some(pa => pa.form === 'hail'), `5 Forms, 2 hybrids, hail kept (${FORMS.map(f => f.id + '[' + f.need + ']').join(' ')})`);
for (const f of FORMS) {
  const w = world(3), p = w.heroes[0], ws = p.weapons[0];
  const early = [];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
    if (f.need.indexOf(i) < 0 || (i === f.need[f.need.length - 1] && k === 2)) continue;
    w.rankPath(p, ws, i); if (w.formsReady(p, ws).some(x => x.id === f.id)) early.push(i + ':' + k);
  }
  w.rankPath(p, ws, f.need[f.need.length - 1]);
  const ready = w.formsReady(p, ws).map(x => x.id);
  ok(!early.length && ready.indexOf(f.id) >= 0, `${f.id}: ready only once paths ${f.need.join('+')} reach rank 3 (early: ${early.join(',') || 'none'}; ready: ${ready.join(',')})`);
  ok(!w.formsReady(p, world(3).heroes[0].weapons[0]).length, `${f.id}: nothing ready with no ranks`);
  w.takeForm(p, ws, f.id);
  let rf = 0; while (w.refineForm(p, ws)) rf++;
  w.recalc(p, false);
  ok(ws.id === f.id && rf === 2 && !w.formsReady(p, ws).length && !w.takeForm(p, ws, FORMS.find(x => x.id !== f.id).id), `${f.id}: taken, refined ${rf}x, every other Form locked`);
  ring(w, p.x, p.y, 20, 70, 30); ring(w, p.x, p.y, 20, 130, 30);
  let err = null;
  try { for (let i = 0; i < 240; i++) { w.input(p.pid, { mx: 0.3, my: 0, ax: p.x + 60, ay: p.y }); w.update(C.TICK); w.events.length = 0; } } catch (e) { err = e; }
  ok(!err && p.dealt[f.id] > 0, `${f.id}: fires and deals ${Math.round(p.dealt[f.id] || 0)} in 4 s` + (err ? ': ' + err.stack : ''));
}

// 3. Mechanics.
{ // cursor aim: a foe at 60 px and an elite at 150 px off the line do not pull the arrow
  const w = world(2), p = w.heroes[0], ws = p.weapons[0];
  const near = w.spawnFoe('skeleton', p.x + 60, p.y, { hpMul: 1e4 }), el = w.spawnFoe('skeleton', p.x, p.y + 150, { hpMul: 1e4, elite: true });
  near.spd = el.spd = 0; aimAt(p, 2.4); ws.cd = 0; w.update(C.TICK);
  const q = w.projs.find(x => !x.dead && x.p === p);
  ok(q && Math.abs(U.angDiff(q.a, 2.4)) < 1e-6, `Longbow fires along the cursor, not at the nearer foe or the elite (a ${q && q.a.toFixed(2)})`);
}
{ // split fan (two): second half at a foe off the cursor line, else 0.35 rad off the line
  for (const foe of [true, false]) {
    const w = world(2), p = w.heroes[0], ws = ranks(w, p, [2, 0, 0]);
    const e = foe ? w.spawnFoe('skeleton', p.x, p.y + 120, { hpMul: 1e4 }) : null; if (e) e.spd = 0;
    aimAt(p, 0); ws.cd = 0; w.update(C.TICK); ws.cd = 99;
    const qs = w.projs.filter(x => !x.dead && x.p === p), n = qs.length, b = foe ? Math.atan2(e.y - (p.y - 6), e.x - p.x) : 0.35, S = ED.Stats.weapon(p, 0);
    const lo = qs.slice(0, (n + 1) >> 1), hi = qs.slice((n + 1) >> 1), mid = (arr) => arr.reduce((s, q) => s + q.a, 0) / arr.length;
    ok(n === S.n && Math.abs(mid(lo)) < 1e-6 && Math.abs(U.angDiff(mid(hi), b)) < 1e-6, `split fan ${foe ? 'with' : 'without'} a foe off the line: halves at 0 / ${b.toFixed(2)} (${n} arrows, ${mid(lo).toFixed(2)} / ${hi.length ? mid(hi).toFixed(2) : '-'})`);
  }
}
{ // bounce: with pierce spent, an arrow turns to another foe
  const w = world(2), p = w.heroes[0], ws = ranks(w, p, [0, 0, 1]);
  const a = w.spawnFoe('skeleton', p.x + 80, p.y - 6, { hpMul: 1e4 }), b = w.spawnFoe('skeleton', p.x + 80, p.y + 110, { hpMul: 1e4 });
  a.spd = b.spd = 0; ws.cd = 0; w.update(C.TICK);
  const q = w.projs.find(x => !x.dead && x.p === p); q.pierce = 0;
  step(w, 50);
  ok(a.hp < a.maxHp && b.hp < b.maxHp, `Ricochet: the arrow bounces from the first foe to a second one 110 px off its line (hurt ${a.hp < a.maxHp}/${b.hp < b.maxHp})`);
}
{ // kill shots: kills loose arrows that are not volley arrows
  const w = world(2), p = w.heroes[0], ws = ranks(w, p, [0, 0, 2]);
  ring(w, p.x, p.y, 16, 60, 0.2); for (const e of w.foes) e.spd = 0;
  ws.cd = 0; let fired = 0, made = 0; const ids = new Set();
  for (let i = 0; i < 40; i++) { w.update(C.TICK); for (const ev of w.events) if (ev.t === 'shoot') fired++; w.events.length = 0; for (const q of w.projs) if (!q.dead && q.p === p && !ids.has(q.id)) { ids.add(q.id); made++; } if (fired) ws.cd = 99; }
  ok(fired === 1 && made > 1, `kill shots: one volley of 1 arrow made ${made} arrows`);
}
{ // Ballista bolts pierce a whole line of 12 foes
  const w = world(2), p = w.heroes[0], ws = ranks(w, p, [0, 3, 0]); form(w, p, ws, 'ballista');
  const line = []; for (let i = 0; i < 12; i++) { const e = w.spawnFoe('skeleton', p.x + 40 + i * 20, p.y - 6, { hpMul: 1e4 }); e.spd = 0; line.push(e); }
  ws.cd = 0; w.update(C.TICK); ws.cd = 99; step(w, 90);
  ok(line.every(e => e.hp < e.maxHp), `Ballista: one bolt hits all 12 foes of a line (${line.filter(e => e.hp < e.maxHp).length})`);
}
{ // Rebound: arrows turn at the view edge and fly back
  const w = world(2), p = w.heroes[0], ws = ranks(w, p, [0, 3, 3]); form(w, p, ws, 'rebound');
  aimAt(p, 0); ws.cd = 0; w.update(C.TICK); ws.cd = 99;
  const q = w.projs.find(x => !x.dead && x.p === p), vx0 = q.vx;
  let back = false; for (let i = 0; i < 90 && !q.dead; i++) { w.update(C.TICK); w.events.length = 0; if (q.vx * vx0 < 0) back = true; }
  ok(back && ED.inView(p, q.x, q.y, q.r), `Rebound: an arrow fired with no foe turns back at the view edge (x ${Math.round(q.x - p.x)})`);
}

// 4. View clamp: pinned foes at 340 px (outside) and at 60-150 px (inside) for 5 s.
for (const f of [{ id: 'longbow' }].concat(FORMS)) {
  const w = world(4), p = w.heroes[0], ws = ranks(w, p, [3, 3, 3]);
  if (f.id !== 'longbow') form(w, p, ws, f.id);
  const far = [], near = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * U.TAU;
    far.push(w.spawnFoe('skeleton', p.x + (i & 1 ? 340 : -340), p.y + Math.sin(a) * 60, { hpMul: 1e4 }));
    near.push(w.spawnFoe('skeleton', p.x + Math.cos(a) * (60 + i * 12), p.y + Math.sin(a) * (60 + i * 12) * 0.6, { hpMul: 1e4 }));
  }
  const pos = far.concat(near).map(e => [e.x, e.y]);
  for (let i = 0; i < 300; i++) {
    far.concat(near).forEach((e, j) => { e.x = pos[j][0]; e.y = pos[j][1]; e.kbx = e.kby = 0; });
    aimAt(p, i / 300 * U.TAU); w.update(C.TICK); w.events.length = 0;
  }
  const hurtFar = far.filter(e => e.hp < e.maxHp).length, hurtNear = near.filter(e => e.hp < e.maxHp).length;
  ok(hurtFar === 0 && hurtNear >= 1, `${f.id} 3/3/3: no damage outside the view (far hurt ${hurtFar}, near hurt ${hurtNear}/8)`);
}

// 5. Vault (zero damage): leaps N.dist toward the cursor, untouchable, over foes; lands pulling gems within 200 px; L2 +60 px; L3 2 charges; L4 caltrops slow foes at the takeoff.
ok(ED.SKILLS.vault.cd >= 7 && ED.SKILLS.vault.cd <= 16 && ED.SKILLS.vault.levels.every(l => l.txt.length <= 40) && ED.SKILLS.vault.txt.length <= 40, `vault: cooldown ${ED.SKILLS.vault.cd} s, card lines <= 40 chars`);
for (let L = 1; L <= 4; L++) {
  const w = world(6), p = w.heroes[0], sk = p.skills[0]; sk.lvl = L; p.weapons.length = 0;
  const N = w.skillN(p, 0), x0 = p.x, y0 = p.y;
  for (let i = 0; i < 8; i++) { const e = w.spawnFoe('skeleton', x0 + 40 + i * 12, y0 + (i & 1 ? 8 : -8), { hpMul: 50 }); e.spd = 0; }
  const gNear = w.spawnPickup('xp5', x0 + N.dist + 150, y0, 5), gFar = w.spawnPickup('xp5', x0 + N.dist + 320, y0, 5);
  w.input(p.pid, { q: true, ax: x0 + 300, ay: y0 }); w.update(C.TICK); w.events.length = 0;
  const inv = p.invuln > N.t * 0.8;
  step(w, 30);
  const moved = p.x - x0, hurt = w.foes.filter(e => e.hp < e.maxHp).length;
  ok(Math.abs(moved - N.dist) < 4 && inv && hurt === 0 && !(p.dealt.vault > 0), `vault L${L}: leapt ${moved.toFixed(0)} of ${N.dist} px over 8 foes, untouchable ${inv}, zero damage (hurt ${hurt})`);
  ok(gNear.pull === p.pid && gFar.pull !== p.pid, `vault L${L}: landing pulls the gem at 150 px (${gNear.pull === p.pid}), not the one at 320 px (${gFar.pull === p.pid})`);
  // charges: a second press right after the leap
  const x1 = p.x; w.input(p.pid, { q: true, ax: p.x + 300, ay: p.y }); step(w, 30);
  ok((L >= 3) === (p.x - x1 > N.dist - 4), `vault L${L}: second leap at once ${p.x - x1 > N.dist - 4} (charges ${N.charges | 0})`);
  const cal = w.zones.filter(z => !z.dead && z.k === 'caltrops').sort((a, b) => U.dist2(p.x, p.y, a.x, a.y) - U.dist2(p.x, p.y, b.x, b.y))[0]; // the latest field (the first lies outside the view)
  if (L === 4) {
    const e = w.spawnFoe('skeleton', cal.x + 10, cal.y, { hpMul: 50 }); step(w, 15);
    ok(e.slowT > 1 && e.slowK >= 0.5 && e.hp === e.maxHp, `vault L4: caltrops slow a foe 50% (${e.slowK}, ${e.slowT.toFixed(1)} s), no damage`);
  } else ok(!cal, `vault L${L}: no caltrops`);
}
{ // obstacle-safe landing: aimed straight at an obstacle centre 160 px away
  const w = world(6), p = w.heroes[0], o = w.arena.obstacles.find(q => q.r > 10 && q.x > 400 && q.y > 400 && q.x < w.arena.size - 400 && q.y < w.arena.size - 400);
  p.x = o.x - 160; p.y = o.y; ED.Arena.collide(w.arena, p, p.r);
  w.input(p.pid, { q: true, ax: o.x, ay: o.y }); step(w, 30);
  ok(!ED.Arena.blocked(w.arena, p.x, p.y, p.r) && p.x < o.x, `vault: lands clear of an obstacle (${(o.x - p.x).toFixed(0)} px short of its centre, r ${o.r})`);
}

// 6. Determinism + client hooks on a mock batch.
const calls = { n: 0 };
const mockB = new Proxy({}, { get: (o, k) => (k === 'crowd' || k === 'zoneLite' ? 0 : (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite arg to B.' + String(k)); return true; }) });
ED.Atlas = { ok: true, has: () => true, anim: () => ({ n: 6 }), frameAt: () => 0 };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'hfx-ranger.js'), 'utf8'), { filename: 'hfx-ranger.js' });
function digestRun(fid, draw) {
  const w = world(12), p = w.heroes[0], ws = ranks(w, p, [3, 3, 3]);
  if (fid !== 'longbow') form(w, p, ws, fid);
  p.skills[0].lvl = 4;
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
      }
      if (i % 30 === 0) { let s = w.tick + '|' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + '|' + Math.round(p.dealt[fid] || 0) + '|' + Math.round(p.dealt.vault || 0) + '|' + w.kills; for (const e of w.foes) if (!e.dead) s += '|' + e.x.toFixed(2) + ',' + e.hp; d = (Math.imul(d, 31) + U.hashStr(s)) >>> 0; }
    }
  } catch (e) { err = e; }
  return { d, err, dealt: p.dealt[fid] || 0 };
}
for (const f of [{ id: 'longbow' }].concat(FORMS)) {
  const a = digestRun(f.id, true), b = digestRun(f.id, false);
  ok(!a.err && !b.err && a.d === b.d && a.dealt > 0, `${f.id}: same digest twice (${a.d.toString(16)} / ${b.d.toString(16)})` + (a.err ? ': ' + a.err.stack : ''));
}
ok(calls.n > 1000, `client hooks drew on the mock batch (${calls.n} calls)`);

console.log(`check-hero-ranger: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
