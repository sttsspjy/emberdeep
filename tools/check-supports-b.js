// Headless check of supports B: War Axe, Bramble Trail, Glaive, Chain Spark and their Forms (exit 1 on failure). Usage: node tools/check-supports-b.js
// 1. Each registers as a support (role, 3 paths x 3 ranks all naming one Form, Form with 2 refines, card lines <= 40 chars, an icon in art-src), goes into slot 1 next to the hero weapon and fires.
// 2. Every rank changes the fired shape (projectiles, reach, zones, foe hits, crits, stuns, moved foes, sizes over 4 s into a still foe grid while walking); the Form changes the 3/3/3 pattern.
// 3. Damage only in view: a 3/3/3 build and its Form never hurt a pinned foe 340 px away while hurting near ones.
// 4. Mechanics: the Glaive flies along the cursor past a nearer foe; axe knockback moves normal foes away from the hero but not bosses or knockback-immune brutes; thorn roots hold normal foes, not bosses.
// 5. Determinism: the same seed and inputs give the same digest; client draw hooks (wfx-b.js) run on a mock batch without non-finite args.
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
if (ED.MAX_WEAPONS < 3) ED.MAX_WEAPONS = 3;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const IDS = ['waraxe', 'bramble', 'glaive', 'chainspark'];
const ICONS = require('../art-src/wickdeep/icons.js').W;

function world(seed) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'K', slot: 0, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  return w;
}
// Support `id` in hero p's next slot with ranks r and (fid) its Form refined fully; the hero weapon is held off by step().
const build = (w, p, id, r, fid) => {
  const ws = w.addWeapon(p, id);
  for (let i = 0; i < 3; i++) for (let k = 0; k < r[i]; k++) w.rankPath(p, ws, i);
  if (fid) { w.takeForm(p, ws, fid); while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return ws;
};
const step = (w, p) => { p.weapons[0].cd = 1e9; w.update(C.TICK); };
const formOf = (id) => ED.WEAPONS[id].paths[0].form;

// 1. Registration, slot 1, firing.
for (const id of IDS) {
  const d = ED.WEAPONS[id], f = d && ED.WEAPONS[formOf(id)];
  ok(d && d.support && ['horde', 'control', 'lane'].indexOf(d.role) >= 0 && d.paths.length === 3 && d.paths.every(pa => pa.ranks.length === 3 && pa.form === d.paths[0].form), `${id}: support def, role ${d && d.role}, 3 paths x 3 ranks naming ${d && d.paths[0].form}`);
  ok(f && f.support && f.form && f.evolved && f.from === id && f.refine.length === 2, `${id}: Form ${f && f.id} (2 refines)`);
  const lines = [d.txt, f.txt].concat(...d.paths.map(pa => pa.ranks.map(r => r.txt)), f.refine.map(r => r.txt));
  ok(lines.every(s => s.length <= 40), `${id}: card lines <= 40 chars`);
  ok(ICONS[id] && ICONS[f.id] && d.icon === 'icon.w.' + id, `${id}: icons icon.w.${id} / icon.w.${f.id} in art-src`);
  const w = world(3), p = w.heroes[0], ws = w.addWeapon(p, id);
  ok(ws && p.weapons[1] === ws && p.weapons.length === 2, `${id}: goes into slot 1 beside ${p.weapons[0].id}`);
  for (let i = 0; i < 12; i++) w.spawnFoe('skeleton', p.x + 60 + i * 9, p.y - 20 + (i % 3) * 20, { hpMul: 20 });
  let shots = 0;
  for (let i = 0; i < 180; i++) { p.in.ax = p.x + 100; p.in.ay = p.y; step(w, p); for (const ev of w.events) if (ev.t === 'shoot' && ev.wid === id) shots++; w.events.length = 0; }
  ok(shots >= 1 && (p.dealt[id] || 0) > 0, `${id}: fires (${shots} shots in 3 s) and deals damage (${Math.round(p.dealt[id] || 0)})`);
}

// 2. Shape of the attack: 4 s into a still foe grid (36-60 px apart over the view, 40 px clear around the hero; run at a per-weapon HP where kill effects show and at 20x HP), the hero walking a circle, aim up-right.
const PHP = { waraxe: 1.5, bramble: 0.09, glaive: 1.5, chainspark: 1.2 }, GAP = { waraxe: 60, bramble: 36, glaive: 36, chainspark: 36 };
const pattern = (id, r, fid) => run(id, r, fid, PHP[id]) + ' | ' + run(id, r, fid, 20);
function run(id, r, fid, hpMul) {
  const w = world(9), p = w.heroes[0], ws = build(w, p, id, r, fid);
  for (let gx = -300; gx <= 300; gx += GAP[id]) for (let gy = -160; gy <= 160; gy += GAP[id]) if (Math.hypot(gx, gy) >= 40) w.spawnFoe('skeleton', p.x + gx, p.y + gy, { hpMul });
  for (const e of w.foes) e.spd = 0;
  ws.cd = 0;
  const pid = new Set(), zid = new Set(), stun = new Set(), x0 = new Map();
  for (const e of w.foes) x0.set(e, [e.x, e.y]);
  let pr = 0, prR = 0, far = 0, zn = 0, zR = 0, zD = 0, hits = 0, crits = 0;
  for (let i = 0; i < 240; i++) {
    const a = i / 40;
    p.in.mx = Math.cos(a); p.in.my = Math.sin(a); p.in.ax = p.x + 100; p.in.ay = p.y - 40;
    step(w, p);
    for (const ev of w.events) if (ev.t === 'hit') { hits++; if (ev.crit) crits++; }
    w.events.length = 0;
    for (const q of w.projs) if (!q.dead && q.p === p && q.wid === ws.id) { far = Math.max(far, Math.hypot(q.x - p.x, q.y - p.y)); if (!pid.has(q.id)) { pid.add(q.id); pr++; prR += q.r; } }
    for (const z of w.zones) if (!z.dead && z.p === p && z.wid === ws.id && !zid.has(z.id)) { zid.add(z.id); zn++; zR = Math.max(zR, z.r); zD += z.dur; }
    for (const e of w.foes) if (!e.dead && e.stunT > 0) stun.add(e.id);
  }
  let moved = 0;
  for (const e of w.foes) if (!e.dead) moved += Math.hypot(e.x - x0.get(e)[0], e.y - x0.get(e)[1]);
  return [pr, Math.round(prR), Math.round(far), zn, Math.round(zR), Math.round(zD * 10), hits, crits, stun.size, Math.round(moved)].join('/');
}
for (const id of IDS) {
  const d = ED.WEAPONS[id];
  for (let i = 0; i < 3; i++) {
    let prev = pattern(id, [0, 0, 0]);
    for (let k = 1; k <= 3; k++) {
      const r = [0, 0, 0]; r[i] = k;
      const cur = pattern(id, r);
      ok(cur !== prev, `${id} ${d.paths[i].name} rank ${k} "${d.paths[i].ranks[k - 1].txt}": ${prev} -> ${cur} (projs/r/reach/zones/maxR/dur/hits/crits/stuns/moved)`);
      prev = cur;
    }
  }
  const a = pattern(id, [3, 3, 3]), b = pattern(id, [3, 3, 3], formOf(id));
  ok(a !== b, `${id} -> ${formOf(id)}: a new pattern over 3/3/3 (${a} -> ${b})`);
}

// 3. Damage only in view.
for (const id of IDS) for (const fid of ['', formOf(id)]) {
  const w = world(4), p = w.heroes[0];
  build(w, p, id, [3, 3, 3], fid);
  const far = w.spawnFoe('skeleton', p.x + 340, p.y, { hpMul: 50 }), hp0 = far.hp;
  for (let i = 0; i < 300; i++) {
    if (i % 60 === 0) for (let k = 0; k < 10; k++) { const a = k / 10 * U.TAU; w.spawnFoe('skeleton', p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 50, { hpMul: 2 }); }
    far.x = p.x + 340; far.y = p.y; far.spd = 0;
    p.in.ax = p.x + 300; p.in.ay = p.y;
    step(w, p); w.events.length = 0;
  }
  ok(far.hp === hp0 && (p.dealt[fid || id] || 0) > 0, `${fid || id} (3/3/3): the foe 340 px away is untouched (${far.hp}/${hp0}), near ones hurt (${Math.round(p.dealt[fid || id] || 0)})`);
}

// 4a. Glaive follows the cursor: a nearer foe on the left, cursor right / up.
for (const [ax, ay, a0] of [[100, 0, 0], [0, -100, -Math.PI / 2]]) {
  const w = world(6), p = w.heroes[0], ws = build(w, p, 'glaive', [0, 0, 0]);
  w.spawnFoe('skeleton', p.x - 40, p.y, { hpMul: 20 });
  ws.cd = 0; p.in.ax = p.x + ax; p.in.ay = p.y + ay;
  step(w, p);
  const q = w.projs.find(o => !o.dead && o.wid === 'glaive');
  ok(q && Math.abs(U.angDiff(Math.atan2(q.vy, q.vx), a0)) < 0.05, `glaive flies along the cursor (${a0.toFixed(2)} rad) past a nearer foe: ${q ? Math.atan2(q.vy, q.vx).toFixed(2) : 'none'}`);
}
// 4b. Axe knockback: still foes in columns across the axes' rising arc on the cursor side: skeletons, boss-flagged foes, knockback-immune brutes (one kind per run).
const axeRun = (kind) => {
  const w = world(7), p = w.heroes[0], es = [];
  build(w, p, 'waraxe', [0, 0, 0]);
  for (let gx = 24; gx <= 40; gx += 16) for (let gy = -80; gy <= -20; gy += 12) {
    const e = w.spawnFoe(kind === 'brute' ? 'skelknight' : 'skeleton', p.x + gx, p.y + gy, { hpMul: 1000 });
    if (kind === 'boss') e.boss = true;
    e.spd = 0; es.push(e);
  }
  const d0 = es.map(e => Math.hypot(e.x - p.x, e.y - p.y)), h0 = es.map(e => e.hp);
  let kb = 0;
  for (let i = 0; i < 150; i++) { p.in.ax = p.x + 100; p.in.ay = p.y; step(w, p); w.events.length = 0; for (const e of es) kb += Math.abs(e.kbx) + Math.abs(e.kby); }
  return { hit: es.filter((e, i) => e.hp < h0[i]).length, pushed: es.filter((e, i) => Math.hypot(e.x - p.x, e.y - p.y) > d0[i] + 6).length, moved: es.filter((e, i) => Math.abs(Math.hypot(e.x - p.x, e.y - p.y) - d0[i]) > 0.01).length, kb };
};
{
  const a = axeRun('skeleton'), b = axeRun('boss'), c = axeRun('brute');
  ok(a.hit > 0 && a.pushed >= 2, `war axe pushes normal foes away from the hero (${a.pushed} of ${a.hit} hit moved > 6 px outward)`);
  ok(b.hit > 0 && b.kb === 0 && b.moved === 0, `war axe hits bosses without knockback (${b.hit} hit, ${b.moved} moved)`);
  ok(c.hit > 0 && c.kb === 0 && c.moved === 0, `war axe hits knockback-immune brutes without moving them (${c.hit} hit, ${c.moved} moved)`);
}
// 4c. Roots: the first ring thorn erupts on the cursor side at the ring radius; a skeleton and a boss-flagged foe stand there.
{
  const w = world(8), p = w.heroes[0], ws = build(w, p, 'bramble', [0, 0, 0]), R = ED.WEAPONS.bramble.base.ringR;
  const sk = w.spawnFoe('skeleton', p.x + R, p.y - 3, { hpMul: 100 }), boss = w.spawnFoe('skeleton', p.x + R, p.y + 3, { hpMul: 1000 });
  boss.boss = true; sk.spd = 0; boss.spd = 0;
  const h0 = boss.hp;
  ws.cd = 0;
  let skRoot = 0, bossRoot = 0;
  for (let i = 0; i < 90; i++) { p.in.ax = p.x + 100; p.in.ay = p.y; step(w, p); w.events.length = 0; if (sk.stunT > 0) skRoot++; if (boss.stunT > 0) bossRoot++; }
  ok(skRoot > 10, `bramble roots a normal foe (${skRoot} rooted ticks)`);
  ok(bossRoot === 0 && boss.hp < h0, `bramble never roots a boss but hurts it (hp ${h0} -> ${boss.hp})`);
}

// 5. Determinism + client hooks on a mock batch.
const calls = { n: 0 };
const mockB = new Proxy({}, { get: (o, k) => (k === 'crowd' || k === 'zoneLite' ? 0 : (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite arg to B.' + String(k)); return true; }) });
ED.Atlas = { ok: true, has: () => true, anim: () => ({ n: 6 }), frameAt: () => 0 };
ED.WeaponFx = ED.WeaponFx || {};
globalThis.ED = ED;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'wfx-b.js'), 'utf8'), { filename: 'wfx-b.js' });
function digestRun(id, fid, draw) {
  const w = world(12), p = w.heroes[0], ws = build(w, p, id, [3, 3, 3], fid), wid = ws.id;
  let d = 0, err = null;
  try {
    for (let i = 0; i < 360; i++) {
      if (i % 60 === 0) for (let k = 0; k < 16; k++) { const a = k / 16 * U.TAU, r = 90 + (i % 7) * 15; w.spawnFoe('skeleton', p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.6, { hpMul: 8 }); }
      const e = w.nearestFoe(p.x, p.y, 300), a = i / 60;
      w.input(p.pid, { mx: Math.cos(a) * 0.5, my: Math.sin(a) * 0.5, ax: e ? e.x : p.x + 60, ay: e ? e.y : p.y, q: false });
      step(w, p); w.events.length = 0;
      if (draw) {
        for (const z of w.zones) { const f = !z.dead && ED.WeaponFx[z.wid]; if (f && f.zone) { f.zone(mockB, z, w.time); if (f.top) f.top(mockB, z, w.time); } }
        for (const q of w.projs) { const f = !q.dead && ED.WeaponFx[q.wid]; if (f && f.proj) f.proj(mockB, q, w.time); }
      }
      if (i % 30 === 0) { let s = w.tick + '|' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + '|' + Math.round(p.dealt[wid] || 0) + '|' + w.kills; for (const f of w.foes) if (!f.dead) s += '|' + f.x.toFixed(2) + ',' + f.hp; d = (Math.imul(d, 31) + U.hashStr(s)) >>> 0; }
    }
  } catch (e) { err = e; }
  return { d, err, dealt: p.dealt[wid] || 0 };
}
for (const id of IDS) for (const fid of ['', formOf(id)]) {
  const a = digestRun(id, fid, true), b = digestRun(id, fid, false);
  ok(!a.err && !b.err && a.d === b.d && a.dealt > 0, `${fid || id}: same digest twice (${a.d.toString(16)} / ${b.d.toString(16)})` + (a.err ? ': ' + a.err.stack : b.err ? ': ' + b.err.stack : ''));
}
ok(calls.n > 1000, `client hooks drew on the mock batch (${calls.n} calls)`);

console.log(`check-supports-b: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = fails ? 1 : 0;
