// Headless check of support weapons (a): Censer, Orbit Lanterns, Meteor Call, Frost Ring and their Forms (exit 1 on failure). Usage: node tools/check-supports-a.js
// 1. Defs: support roots with 3 paths x 3 ranks all naming one Form (2 refines), card lines <= 40 chars that never name the Form, icons in the atlas.
// 2. Slot 1: each joins a hero beside its weapon, fires and damages foes in view. 3. Shape: every path rank changes the pattern signature (zones / shots / statuses seen).
// 4. Forms: ready from any path at rank 3, taken, change the pattern; feature probes (heal, wheel, stars + comet, frost walls). 5. View clamp. 6. Determinism per seed.
'use strict';
const fs = require('fs'), path = require('path');
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST, VW = ED.HERO_VIEW;
if (ED.MAX_WEAPONS < 3) ED.MAX_WEAPONS = 3;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();
const IDS = ['censer', 'lanterns', 'meteorcall', 'frostring'];
const SAME_LOOKS = { meteorcall03: 1 }; // Volley 3 (densest-pack aim): dense probe
const META = fs.readFileSync(path.join(__dirname, '..', 'src', 'art', 'meta.js'), 'utf8');

// Silent world (no spawner, no xp), god mode; the hero weapon is held but never fires.
function world(seed) {
  const w = new ED.World({ seed: seed || 5, stage: 0, players: [{ pid: 'p1', name: 'P1', slot: 0, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  w.updateSpawner = function () {}; w.addXp = function () {};
  return w;
}
const HP = { hpMul: 1 };
function ring(w, x, y, n, r, hpMul) { HP.hpMul = hpMul || 1; for (let i = 0; i < n; i++) { const a = i / n * U.TAU; w.spawnFoe('skeleton', x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, HP); } }
function run(w, s, fn, out) {
  try {
    for (let i = 0; i < Math.round(s * 60); i++) {
      const p = w.heroes[0]; if (p.weapons[0]) p.weapons[0].cd = 1e9;
      if (fn) fn(i);
      w.update(C.TICK);
      if (out) for (const ev of w.events) out.push(ev);
      w.events.length = 0;
    }
  } catch (e) { return e; }
  return null;
}
// Hero with support `id` in slot 1 at ranks [a, b, c] (and its Form refined fully).
function build(id, ranks, form, seed) {
  const w = world(seed), p = w.heroes[0], ws = w.addWeapon(p, id);
  if (!ws) return { w, p, ws: null };
  for (let i = 0; i < 3; i++) for (let r = 0; r < ranks[i]; r++) w.rankPath(p, ws, i);
  if (form) { w.takeForm(p, ws, form); while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return { w, p, ws };
}
const dealt = (p, ws) => (p.dealt[ws.root] || 0) + (p.dealt[ED.WEAPONS[ws.root].paths[0].form] || 0) + (p.dealt.burn || 0);
const b4 = (v) => Math.round(v / 4) * 4;
// Pattern signature over s s against two 24-foe rings (inner 0.5 x HP, outer 40 x HP): zone looks (max live count, max r), shot looks (max live count, distance range from the hero),
// statuses seen (slowed / frozen / burning / knocked), the strongest slow, freeze onsets, boom looks, max zone dur per look.
function pattern(id, ranks, form, s, seed) {
  const { w, p, ws } = build(id, ranks, form, seed || 9), ev = [];
  ring(w, p.x, p.y, 24, 45, 0.5); ring(w, p.x, p.y, 24, 100, 40);
  const zc = {}, zr = {}, zd = {}, pc = {}, pd = {}, st = { slow: 0, frozen: 0, burn: 0, knock: 0 };
  let slowK = 0, fon = 0;
  const wasF = new Set();
  const err = run(w, s || 5, (tick) => {
    const cz = {}, cp = {};
    for (const z of w.zones) if (!z.dead && z.p === p) { cz[z.k] = (cz[z.k] || 0) + 1; zr[z.k] = Math.max(zr[z.k] || 0, b4(z.r)); zd[z.k] = Math.max(zd[z.k] || 0, Math.round(z.dur * 10) / 10); }
    for (const pr of w.projs) if (!pr.dead && pr.p === p && tick > 30) {
      cp[pr.k] = (cp[pr.k] || 0) + 1;
      const d = b4(Math.hypot(pr.x - p.x, pr.y - p.y)), r = pd[pr.k] || (pd[pr.k] = [1e9, 0]);
      r[0] = Math.min(r[0], d); r[1] = Math.max(r[1], d);
    }
    for (const k in cz) zc[k] = Math.max(zc[k] || 0, cz[k]);
    for (const k in cp) pc[k] = Math.max(pc[k] || 0, cp[k]);
    let onset = false;
    for (const e of w.foes) if (!e.dead) {
      if (e.slowT > 0) { st.slow = 1; slowK = Math.max(slowK, Math.round(e.slowK * 10) / 10); }
      if (e.freezeT > 0) { st.frozen = 1; if (!wasF.has(e.id)) { wasF.add(e.id); onset = true; } } else wasF.delete(e.id);
      if (e.burnT > 0) st.burn = 1;
      if (Math.abs(e.kbx) + Math.abs(e.kby) > 5) st.knock = 1;
    }
    if (onset) fon++;
  }, ev);
  const booms = {}; for (const e of ev) if (e.t === 'boom' && e.pid === p.pid) booms[e.look] = 1;
  const sig = JSON.stringify({ zc, zr, zd, pc, pd, st, slowK, fon, booms: Object.keys(booms).sort() });
  return { err, w, p, ws, sig, zc, zr, zd, pc, pd, st, slowK, fon, booms, dealt: ws ? dealt(p, ws) : 0 };
}

for (const id of IDS) {
  const d = ED.WEAPONS[id], fid = d && d.paths && d.paths[0].form, F = fid && ED.WEAPONS[fid];
  // 1. defs
  ok(d && d.support && d.role && !d.evolved && d.paths.length === 3 && d.paths.every(pa => pa.ranks.length === 3 && pa.form === fid) && (d.hybrids || []).length === 0,
    `${id}: support (${d && d.role}), 3 paths x 3 ranks, all naming ${fid}`);
  ok(F && F.support && F.evolved && F.form && F.from === id && F.refine.length === 2, `${fid}: Form of ${id}, 2 refines`);
  const lines = [d.txt, F.txt]; for (const pa of d.paths) for (const rk of pa.ranks) lines.push(rk.txt); for (const rf of F.refine) lines.push(rf.txt);
  const nm = F.name.toLowerCase(), bad = lines.filter((l, i) => l.length > 40 || (i !== 1 && l.toLowerCase().includes(nm)));
  ok(!bad.length, `${id}: card lines <= 40 chars, Form unnamed` + (bad.length ? ': ' + bad.join(' | ') : ''));
  ok(META.includes('"icon.w.' + id + '"') && META.includes('"icon.w.' + fid + '"') && d.icon === 'icon.w.' + id, `${id}: icons icon.w.${id} / icon.w.${fid} in the atlas`);

  // 2. slot 1, fires, damages
  const b = pattern(id, [0, 0, 0], '', 4);
  ok(b.ws && b.p.weapons.length === 2 && b.p.weapons[1] === b.ws && !ED.WEAPONS[b.p.weapons[0].id].support, `${id}: joins slot 1 beside the hero weapon`);
  ok(!b.err && b.dealt > 0, `${id} base: fires, dealt ${Math.round(b.dealt)} in 4 s` + (b.err ? ': ' + b.err.stack : ''));

  // 3. shape per rank (SAME_LOOKS: ranks whose change the signature cannot see; probed below)
  for (let i = 0; i < 3; i++) for (let r = 1; r <= 3; r++) {
    if (SAME_LOOKS[id + i + r]) continue;
    const a = [0, 0, 0], c = [0, 0, 0]; a[i] = r - 1; c[i] = r;
    const pa = pattern(id, a, '', 6), pc = pattern(id, c, '', 6);
    ok(!pc.err && pa.sig !== pc.sig, `${id} ${d.paths[i].name} ${r}: pattern changes` + (pa.sig === pc.sig ? ' (same: ' + pc.sig + ')' : '') + (pc.err ? ': ' + pc.err.stack : ''));
  }

  // 4. Form: ready from any path at rank 3 only, taken once, refined twice, changes the pattern
  for (let i = 0; i < 3; i++) {
    const r2 = [0, 0, 0], r3 = [0, 0, 0]; r2[i] = 2; r3[i] = 3;
    const A = build(id, r2, ''), B = build(id, r3, '');
    ok(A.w.formsReady(A.p, A.ws).length === 0 && B.w.formsReady(B.p, B.ws).some(f => f.id === fid), `${id}: ${d.paths[i].name} at rank 3 readies ${fid}`);
    if (i === 0) ok(B.w.takeForm(B.p, B.ws, fid) && B.ws.id === fid && B.w.formsReady(B.p, B.ws).length === 0 && B.w.refineForm(B.p, B.ws) === 1 && B.w.refineForm(B.p, B.ws) === 2 && B.w.refineForm(B.p, B.ws) === 0,
      `${fid}: taken, no second Form, 2 refines`);
  }
  const all = pattern(id, [3, 3, 3], '', 5), fm = pattern(id, [3, 3, 3], fid, 5);
  ok(!fm.err && fm.dealt > 0 && fm.sig !== all.sig, `${fid} (3/3/3, refined): new pattern, dealt ${Math.round(fm.dealt)} (all ranks ${Math.round(all.dealt)})` + (fm.err ? ': ' + fm.err.stack : ''));

  // 6. determinism
  const dg = (seed) => { const r = pattern(id, [3, 3, 3], fid, 3, seed); let h = Math.round(r.dealt); for (const e of r.w.foes) h = (h * 31 + Math.round(e.x * 4) + Math.round(e.hp)) % 1e9; return h; };
  ok(dg(11) === dg(11), `${id}: deterministic per seed`);
}

// 3b. probes the generic signature does not pin down
{
  const z = (r, k) => r.zr[k] || 0;
  const b = pattern('censer', [0, 0, 0], '', 3), s1 = pattern('censer', [1, 0, 0], '', 3), s2 = pattern('censer', [2, 0, 0], '', 3);
  ok(z(s1, 'censer') > z(b, 'censer') && s2.w.zones.some(q => !q.dead && q.k === 'censer' && q.w === 1), `censer Size: wider aura (${z(b, 'censer')} -> ${z(s1, 'censer')} px), a swinging censer`);
  const w1 = pattern('censer', [0, 1, 0], '', 3), w2 = pattern('censer', [0, 2, 0], '', 3), w3 = pattern('censer', [0, 3, 0], '', 4);
  ok(!b.st.slow && w1.st.slow && !w1.st.knock && w2.st.knock && w3.zc.cward > 0, 'censer Ward: slow, push, ward blasts');
  const e1 = pattern('censer', [0, 0, 1], '', 3), e2 = pattern('censer', [0, 0, 2], '', 3), e3 = pattern('censer', [0, 0, 3], '', 6);
  ok(!b.st.burn && e1.st.burn && e2.zc.cember > 0 && e3.booms.fire && !e2.booms.fire, 'censer Embers: burn, ember patches, kill bursts');
  const l0 = pattern('lanterns', [0, 0, 0], '', 2), l1 = pattern('lanterns', [1, 0, 0], '', 2), r1 = pattern('lanterns', [0, 1, 0], '', 2), r2 = pattern('lanterns', [0, 2, 0], '', 2), r3 = pattern('lanterns', [0, 3, 0], '', 4);
  ok(l1.pc.lantern === l0.pc.lantern + 1, `lanterns Count 1: +1 lantern (${l0.pc.lantern} -> ${l1.pc.lantern})`);
  ok(r1.pd.lantern[1] > l0.pd.lantern[1] && r2.pc.lantern > r1.pc.lantern && r2.pd.lantern[1] > r1.pd.lantern[1] * 1.4 && r3.pd.lantern[0] < r2.pd.lantern[0] - 8,
    `lanterns Radius: wider orbit, counter-ring, swing in and out (${JSON.stringify([l0.pd.lantern, r1.pd.lantern, r2.pd.lantern, r3.pd.lantern])})`);
  const fl1 = pattern('lanterns', [0, 0, 1], '', 3), fl3 = pattern('lanterns', [0, 0, 3], '', 3);
  ok(!l0.zc.lflare && fl1.zc.lflare > 0 && z(fl3, 'lflare') > z(fl1, 'lflare'), 'lanterns Flare: bursts on hit, wider at rank 3');
  // Meteor dense: a 10-foe pack and 20 spread single foes; the first meteor of each volley lands in the pack
  const dense = (rk) => {
    const { w, p } = build('meteorcall', [rk, 0, 0], '', 3);
    HP.hpMul = 400; for (let i = 0; i < 10; i++) w.spawnFoe('skeleton', p.x + 200 + (i % 5) * 6, p.y - 60 + Math.floor(i / 5) * 6, HP);
    for (let i = 0; i < 20; i++) w.spawnFoe('skeleton', p.x - 280 + (i % 10) * 56, p.y + (i < 10 ? 120 : -130), HP);
    let hits = 0, all = 0; const seen = new Set();
    run(w, 6, () => { for (const z of w.zones) if (!z.dead && z.k === 'meteor' && !seen.has(z.id)) { seen.add(z.id); all++; if (z.x > p.x + 150 && z.y < p.y) hits++; } w.foes.forEach(e => { e.spd = 0; }); });
    return hits / Math.max(1, all);
  };
  const d2 = dense(2), d3 = dense(3);
  ok(d3 > d2 + 0.1, `meteorcall Volley 3: meteors seek the densest pack (${(d2 * 100).toFixed(0)}% -> ${(d3 * 100).toFixed(0)}%)`);
  const m0 = pattern('meteorcall', [0, 0, 0], '', 5), c1 = pattern('meteorcall', [0, 1, 0], '', 5), c2 = pattern('meteorcall', [0, 2, 0], '', 5);
  ok(!m0.zc.mcrater && c1.zc.mcrater > 0 && z(c2, 'mcrater') > z(c1, 'mcrater') && c2.zd.mcrater > c1.zd.mcrater, 'meteorcall Crater: burning ground, wider and longer');
  const sh1 = pattern('meteorcall', [0, 0, 1], '', 5), sh3 = pattern('meteorcall', [0, 0, 3], '', 5);
  ok(!m0.zc.mshower && sh1.zc.mshower > 0 && sh3.pc.ember > 0, 'meteorcall Shower: small meteors, ember shards');
  const f0 = pattern('frostring', [0, 0, 0], '', 6), f1 = pattern('frostring', [1, 0, 0], '', 6), f3 = pattern('frostring', [3, 0, 0], '', 6);
  ok(z(f1, 'frostring') > z(f0, 'frostring') && f3.pc.iceshard > 0 && !f0.pc.iceshard, `frostring Reach: wider rings (${z(f0, 'frostring')} -> ${z(f1, 'frostring')} px), ice shards`);
  const ch1 = pattern('frostring', [0, 1, 0], '', 6), ch2 = pattern('frostring', [0, 2, 0], '', 6), ch3 = pattern('frostring', [0, 3, 0], '', 6);
  ok(!f0.zc.mrime && ch1.zc.mrime > 0 && ch2.zc.frostring > ch1.zc.frostring && ch3.slowK > ch2.slowK && ch3.zd.mrime > ch2.zd.mrime, 'frostring Chill: frost floor, second ring, stronger slow and longer frost');
  const sa1 = pattern('frostring', [0, 0, 1], '', 10), sa2 = pattern('frostring', [0, 0, 2], '', 10), sa3 = pattern('frostring', [0, 0, 3], '', 10);
  ok(!f0.st.frozen && sa1.fon > 0 && sa2.booms.frost && sa2.zc.shatterw > 0 && !sa1.booms.frost && sa3.fon > sa1.fon, `frostring Shatter: freezes (${sa1.fon} -> ${sa3.fon} onsets in 10 s), shatter bursts`);
}

// 4b. Form probes
{
  // Holy Censer: kills inside the aura heal the holder, capped at S.heal HP/s
  const { w, p } = build('censer', [3, 0, 0], 'holycenser', 3), S = w.weaponS(p, 1);
  p.hp = 20; ring(w, p.x, p.y, 40, 30, 0.2);
  let heals = 0; const ev = [];
  run(w, 2, () => { if (w.foes.filter(e => !e.dead).length < 30) ring(w, p.x, p.y, 20, 30, 0.2); }, ev);
  for (const e of ev) if (e.t === 'heal' && e.pid === p.pid) heals += e.v;
  ok(heals > 0 && heals <= S.heal * 2 + 1, `holycenser: kills in the aura heal ${heals} HP in 2 s (cap ${S.heal} HP/s), radius ${Math.round(S.rad * S.area)} px`);
  ok(ED.WEAPONS.holycenser.base.rad <= 60 && ED.WEAPONS.sunwheel.base.rad <= 60 && ED.WEAPONS.glacier.base.rad <= 60, '360-degree Forms: base radius <= 60 px');
  const sw = pattern('lanterns', [3, 0, 0], 'sunwheel', 3);
  ok(sw.pc.sunlantern >= 9 && !sw.pc.lantern && sw.zc.sunring === 1 && sw.zc.lflare > 0 && sw.st.burn, `sunwheel: ${sw.pc.sunlantern} suns, burning ring, flares`);
  const sf = pattern('meteorcall', [3, 0, 0], 'starfall', 6);
  ok(sf.zc.star > 0 && sf.zc.comet > 0 && !sf.zc.meteor, `starfall: star shower (${sf.zc.star} at once) and comets`);
  // Glacier: rings freeze every foe they reach and stay where they rose as walls while the hero walks away
  const { w: gw, p: gp } = build('frostring', [0, 0, 3], 'glacier', 3);
  ring(gw, gp.x, gp.y, 16, 40, 40);
  let frozen = 0, stay = false; const x0 = gp.x;
  run(gw, 1.6, (i) => { gw.input(gp.pid, { mx: i > 40 ? 1 : 0, my: 0, ax: gp.x + 50, ay: gp.y }); for (const e of gw.foes) if (!e.dead && e.freezeT > 0) frozen++; for (const z of gw.zones) if (!z.dead && z.k === 'glacier' && z.t > 1 && Math.abs(z.x - x0) < 1 && gp.x - x0 > 20) stay = true; });
  ok(frozen > 0 && stay, `glacier: rings freeze (${frozen} foe-ticks) and hold as walls where they rose`);
}

// 5. view clamp: a foe pinned just outside the holder's view is never hit or given a status, with foes in view to aim at
for (const id of IDS) {
  const fid = ED.WEAPONS[id].paths[0].form;
  for (const form of ['', fid]) {
    const { w, p, ws } = build(id, [3, 3, 3], form, 4);
    ring(w, p.x, p.y, 20, 50, 30);
    HP.hpMul = 30;
    const far = w.spawnFoe('skeleton', p.x + VW.hw + 30, p.y - VW.oy, HP), fx = far.x, fy = far.y;
    let touched = false;
    const err = run(w, 5, () => {
      far.x = fx; far.y = fy; far.kbx = far.kby = 0;
      if (far.hp < far.maxHp || far.slowT > 0 || far.freezeT > 0 || far.burnT > 0 || far.stunT > 0) touched = true;
    });
    ok(!err && !touched && dealt(p, ws) > 0, `${form || id}: no damage or status outside the view (dealt ${Math.round(dealt(p, ws))} inside)` + (err ? ': ' + err.stack : ''));
  }
}

console.log(`\n${fails ? fails + ' FAILED' : 'all ok'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
