// Headless check of the Knight tree (exit 1 on failure). Usage: node tools/check-hero-knight.js
// 1. Every path rank changes the effective numbers or the fired pattern (swings / booms / projectiles / zones of one attack string).
// 2. Every Form (3 pure + 2 hybrid) is ready only under its rule (its path(s) at rank 3), locks the others once taken, refines twice and deals damage in a foe ring.
// 3. Damage only in view: a full 3/3/3 build of every Form never hurts a pinned foe 340 px away (outside the 320 px half view) while hurting near ones.
// 4. Bulwark Shove at levels 1..4: zero damage; pushes foes out to the shove edge (elites half, immune foes stay), slows (L3 stuns); L4 ring blocks a foe walking in.
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
const ranks = (w, p, r) => { const ws = p.weapons[0]; for (let i = 0; i < 3; i++) for (let k = 0; k < r[i]; k++) w.rankPath(p, ws, i); w.recalc(p, false); return ws; };

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
  for (let k = 1; k <= 3; k++) {
    const r = [0, 0, 0]; r[i] = k;
    const cur = pattern(r), txt = ROOT.paths[i].ranks[k - 1].txt;
    ok(cur.pat !== prev.pat || cur.num !== prev.num, `${ROOT.paths[i].name} rank ${k} "${txt}" changes the attack (${prev.pat} -> ${cur.pat} swings/booms/projs/zones)`);
    ok(txt.length <= 40, `card line <= 40 chars: "${txt}"`);
    prev = cur;
  }
}
for (const f of FORMS) for (let k = 1; k <= 2; k++) ok(ED.WEAPONS[f.id].refine[k - 1].txt.length <= 40 && ED.WEAPONS[f.id].txt.length <= 40, `${f.id} card lines <= 40 chars`);

// 2. Form rules.
ok(FORMS.length === 5 && FORMS.filter(f => f.path < 0).length === 2, `5 Forms, 2 hybrids (${FORMS.map(f => f.id + '[' + f.need + ']').join(' ')})`);
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
  ring(w, p.x, p.y, 20, 60, 30); ring(w, p.x, p.y, 20, 110, 30);
  let err = null;
  try { for (let i = 0; i < 240; i++) { w.input(p.pid, { mx: 0.3, my: 0, ax: p.x + 60, ay: p.y }); w.update(C.TICK); w.events.length = 0; } } catch (e) { err = e; }
  ok(!err && p.dealt[f.id] > 0, `${f.id}: fires and deals ${Math.round(p.dealt[f.id] || 0)} in 4 s` + (err ? ': ' + err.stack : ''));
}

// 3. View clamp: pinned foes at 340 px (outside) and at 60-150 px (inside) for 5 s.
for (const f of [{ id: 'cleave' }].concat(FORMS)) {
  const w = world(4), p = w.heroes[0], ws = ranks(w, p, [3, 3, 3]);
  if (f.id !== 'cleave') { w.takeForm(p, ws, f.id); while (w.refineForm(p, ws)); w.recalc(p, false); }
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
  ok(hurtFar === 0 && hurtNear >= 6, `${f.id} 3/3/3: no damage outside the view (far hurt ${hurtFar}, near hurt ${hurtNear}/8)`);
}

// 4. Bulwark Shove (zero damage): foes within r slide out to r x 5/3 and are slowed (L3: stunned), elites half the way, bosses / knockback-immune foes stay; L2 +30% radius; L4 ring foes cannot cross.
const qWorld = (L) => { const w = world(6), p = w.heroes[0]; p.weapons.length = 0; p.skills[0].lvl = L; return { w, p, N: w.skillN(p, 0) }; };
const qCast = (w, p, x, y) => { w.input(p.pid, { q: true, ax: x, ay: y }); w.update(C.TICK); w.events.length = 0; };
const qRun = (w, n, each) => { for (let i = 0; i < n; i++) { if (each) each(i); w.update(C.TICK); w.events.length = 0; } };
ok(ED.SKILLS.shove.cd >= 7 && ED.SKILLS.shove.cd <= 16 && ED.SKILLS.shove.levels.every(l => l.txt.length <= 40) && ED.SKILLS.shove.txt.length <= 40, `shove: cooldown ${ED.SKILLS.shove.cd} s, card lines <= 40 chars`);
for (let L = 1; L <= 4; L++) {
  const { w, p, N } = qWorld(L), cx = p.x, cy = p.y, to = N.r * 5 / 3;
  const foes = []; for (let i = 0; i < 12; i++) { const a = i / 12 * U.TAU, d = 20 + (i % 4) * (N.r - 30) / 3; foes.push(w.spawnFoe('skeleton', cx + Math.cos(a) * d, cy + Math.sin(a) * d, { hpMul: 50 })); }
  const out = w.spawnFoe('skeleton', cx + to + 60, cy, { hpMul: 50 });
  for (const e of w.foes) e.spd = 0;
  qCast(w, p, cx + 100, cy);
  const slowed = foes.filter(e => e.slowT > 2).length, stunned = foes.filter(e => e.stunT > 0.5).length;
  qRun(w, 45, () => { p.x = cx; p.y = cy; });
  const dmin = Math.min(...foes.map(e => U.dist(cx, cy, e.x, e.y))), hurt = w.foes.filter(e => e.hp < e.maxHp).length;
  ok(dmin >= to - 6 && slowed === 12 && (L >= 3) === (stunned === 12) && hurt === 0 && !(p.dealt.shove > 0) && p.skills[0].cd > 6,
    `shove L${L}: r ${N.r.toFixed(0)}, 12 foes pushed to >= ${dmin.toFixed(0)} of ${to.toFixed(0)} px, slowed ${slowed}, stunned ${stunned}, zero damage (hurt ${hurt})`);
  const ring = w.zones.find(z => !z.dead && z.k === 'bulwark');
  if (L === 4) {
    out.spd = 60; out.slowT = 0; out.slowK = 0; out.x = cx + Math.cos(U.TAU / 24) * (to + 60); out.y = cy + Math.sin(U.TAU / 24) * (to + 60); // between the pushed foes
    let inside = 0; qRun(w, 100, () => { p.x = cx; p.y = cy; if (U.dist(cx, cy, out.x, out.y) < to - 4) inside++; });
    ok(!!ring && inside === 0 && U.dist(cx, cy, out.x, out.y) < to + 30, `shove L4: ring r ${ring ? ring.r.toFixed(0) : '-'} holds; a foe walking in stays outside (${U.dist(cx, cy, out.x, out.y).toFixed(0)} px)`);
  } else ok(!ring, `shove L${L}: no ring`);
}
{
  const { w, p, N } = qWorld(1), cx = p.x, cy = p.y, to = N.r * 5 / 3;
  const el = w.spawnFoe('skeleton', cx + 40, cy, { elite: true, hpMul: 5 }), im = w.spawnFoe('skelknight', cx - 50, cy, { hpMul: 50 });
  for (const e of w.foes) e.spd = 0;
  qCast(w, p, cx + 100, cy); qRun(w, 45, () => { p.x = cx; p.y = cy; });
  const de = U.dist(cx, cy, el.x, el.y), di = U.dist(cx, cy, im.x, im.y), want = 40 + (to - 40) / 2;
  ok(Math.abs(de - want) < 12 && Math.abs(di - 50) < 3 && el.hp === el.maxHp, `shove: elite pushed half the way (${de.toFixed(0)} px, want ~${want.toFixed(0)}), knockback-immune foe stays (${di.toFixed(0)} px)`);
}

// 5. Determinism + client hooks on a mock batch.
const calls = { n: 0 };
const mockB = new Proxy({}, { get: (o, k) => (k === 'crowd' || k === 'zoneLite' ? 0 : (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite arg to B.' + String(k)); return true; }) });
ED.Atlas = { ok: true, has: () => true, anim: () => ({ n: 6 }), frameAt: () => 0 };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'hfx-knight.js'), 'utf8'), { filename: 'hfx-knight.js' });
function digestRun(form, draw) {
  const w = world(12), p = w.heroes[0], ws = ranks(w, p, [3, 3, 3]);
  w.takeForm(p, ws, form); while (w.refineForm(p, ws)); w.recalc(p, false);
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
