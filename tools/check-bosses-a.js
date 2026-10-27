// Headless check for bosses warden, spore, twins (exit 1 on failure). Usage: node tools/check-bosses-a.js
// Per boss: spawned at its stage minute over a live horde vs a scripted hero (circles it, dashes, picks cards; HP kept topped up) for 60 s, HP forced through every phase:
// no exceptions, every attack key used, phase events, foe telegraphs >= 0.6 s, normal spawns at 50% while it lives, deterministic digest, client draw hooks run on a mock batch.
// Then killable with a cheat build (might x60): one 'boss' phase -1 event, a chest drops, w.boss clears. Twins: a fallen twin rises after its revive circle; both down ends the fight.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'client', 'bfx-a.js'), 'utf8'), { filename: 'bfx-a.js' });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));

// Attack usage counters: every runner attack start is wrapped once.
const used = {};
for (const id of ['warden', 'spore', 'twins', 'twinhammer']) {
  const fn = ED.Bosses[id], at = fn.attacks; used[id] = {};
  for (const k of Object.keys(at)) { const s0 = at[k].start; used[id][k] = 0; at[k].start = function (w, e) { used[id][k]++; if (s0) return s0.call(this, w, e); }; }
}
// Mock client: ED.Atlas / ED.Game / ED.Batch stand-ins so the draw hooks run headless.
const calls = { n: 0 };
const mockB = new Proxy({}, { get: (o, k) => (k === 'crowd' ? 0 : (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite arg to B.' + String(k)); return true; }) });
ED.Atlas = { ok: true, has: () => true, anim: () => ({ n: 8, f: [0, 1, 2, 3, 4, 5, 6, 7] }), frameAt: () => 0 };
function drawAll(w) {
  ED.Game = { view: { heroes: w.heroes } };
  for (const e of w.foes) { const f = !e.dead && ED.BossFx[e.def.id]; if (f && f.draw) f.draw(mockB, e, w.time); }
  for (const z of w.zones) { const f = !z.dead && ED.ZoneFx[z.k]; if (f) f(mockB, z, w.time); }
}

// Scripted hero: orbits the boss at ~110 px (radius breathes), aims at it, dashes every 4 s, Q/E on timers, picks the first card.
function drive(w, p, tick, boss) {
  const b = boss && !boss.dead ? boss : p, t = tick / 60, ang = Math.atan2(p.y - b.y, p.x - b.x), d = Math.hypot(p.x - b.x, p.y - b.y), want = 110 + 40 * Math.sin(t * 0.4);
  let mx = -Math.sin(ang), my = Math.cos(ang);
  if (d > want + 20) { mx -= Math.cos(ang); my -= Math.sin(ang); } else if (d < want - 20) { mx += Math.cos(ang); my += Math.sin(ang); }
  w.input(p.pid, { mx, my, ax: b.x, ay: b.y, dash: tick % 240 === 30 + p.slot * 9, q: tick % 420 === 60 + p.slot * 7, e: tick % 660 === 90 + p.slot * 7, pick: p.offer ? 1 : 0 });
}
const HUGE = 1e7;
// One boss fight. o: { id, stage, minute, cls, cheats, len, phaseAt: [[t, frac]], script(w, ctx, tick), mortal }. Returns stats.
function fight(o) {
  const w = new ED.World({ seed: o.seed || 4242, stage: o.stage, players: players(o.cls || ['knight']), cheats: o.cheats || {} });
  const T = o.minute * 60, out = { w, ctx: null, err: null, minTele: Infinity, phases: [], ends: 0, falls: 0, rises: 0, hurts: 0, digest: 0, chest: false, half: null, st3: 0, carpet: 0, slowed: 0, pods: 0, boss: null, endT: -1, swords: 0, combos: 0 };
  try {
    w.time = T; w.sp.bossI = 99; w.sp.swarmT = T + 90; w.sp.eliteT = T + 60;
    for (let i = 0; i < 300; i++) w.update(C.TICK); // horde warm-up
    w.events.length = 0;
    const e = out.boss = w.spawnBoss({ t: T, id: o.id });
    // 50% spawn rate while the boss lives: one 1 s spawner step at an alive cap of 0
    const acc0 = w.sp.acc; w.sp.acc = 0; w.aliveCap = () => 0; w.updateSpawner(1); const row = w.timelineRow();
    out.half = Math.abs(w.sp.acc - Math.min(10, row.rate * (1 + 0.25 * (w.partyN - 1)) * 0.5)) < 1e-6; delete w.aliveCap; w.sp.acc = acc0;
    const start = w.time, ctx = out.ctx = { e };
    for (let tick = 0; w.time - start < (o.len || 60) && w.state === 'play'; tick++) {
      for (const p of w.heroes) { drive(w, p, tick, w.boss || e); if (!o.mortal && !w.cheats.god && p.hp < HUGE / 2) { p.maxHp = HUGE; p.hp = HUGE; } }
      if (o.phaseAt) for (const [at, f] of o.phaseAt) if (Math.abs(w.time - start - at) < 1e-6 + C.TICK / 2) for (const b of w.bossList) b.hp = Math.max(1, Math.floor(b.maxHp * f));
      if (o.script) o.script(w, ctx, tick, w.time - start);
      w.update(C.TICK);
      for (const ev of w.events) {
        if (ev.t === 'boss') { if (typeof ev.phase === 'number' && ev.phase > 0) out.phases.push(ev.phase); if (ev.phase === -1) { out.ends++; out.endT = w.time - start; out.chest = w.pickups.some(g => !g.dead && g.k === 'chest' && g.val === 2); } if (ev.phase === 'fall') out.falls++; if (ev.phase === 'rise') out.rises++; }
        else if (ev.t === 'hurt') out.hurts++;
      }
      w.events.length = 0;
      for (const z of w.zones) {
        if (z.team === 1 && z.warn && z.dur < out.minTele) out.minTele = z.dur;
        if (z.k === 'sword' && z.t === C.TICK) out.swords++;
      }
      for (const b of w.bossList) if (b.st === 3) out.st3++;
      if (o.id === 'spore' && e.vars && e.vars.patches) { out.carpet = Math.max(out.carpet, e.vars.patches.length); for (const p of w.living) if (ED.Bosses.SPORE.onCarpet(e.vars, p)) out.slowed++; }
      let pods = 0; for (const f of w.foes) if (!f.dead && f.def.id === 'sporepod') pods++; out.pods = Math.max(out.pods, pods);
      if (tick % 10 === 0) drawAll(w);
      if (tick % 60 === 0) { let s = w.tick + '|' + w.kills + '|' + w.foes.length + '|' + w.zones.length; for (const b of w.bossList) s += '|' + b.x.toFixed(2) + ',' + b.y.toFixed(2) + ',' + b.hp; for (const p of w.heroes) s += '|' + p.x.toFixed(2) + ',' + p.y.toFixed(2); out.digest = (Math.imul(out.digest, 31) + U.hashStr(s)) >>> 0; }
      if (o.stop && o.stop(w, out)) break;
    }
  } catch (err) { out.err = err; }
  return out;
}
const reset = () => { for (const id in used) for (const k in used[id]) used[id][k] = 0; };
const allUsed = (id, skip) => Object.keys(used[id]).filter(k => !(skip || []).includes(k) && !used[id][k]);
const t0 = Date.now();

// ---------- Bone Warden (stage 1, 5:00) ----------
reset();
const wd = fight({ id: 'warden', stage: 0, minute: 5, phaseAt: [[20, 0.6], [38, 0.3]] });
ok(!wd.err, 'warden: 60 s throws nothing' + (wd.err ? ': ' + wd.err.stack : ''));
ok(wd.boss && wd.boss.maxHp === 2000, 'warden: HP 400 x 5 min = 2000 (' + (wd.boss && wd.boss.maxHp) + ')');
ok(allUsed('warden').length === 0, 'warden: every attack used ' + JSON.stringify(used.warden));
ok(wd.phases.join() === '2,3', 'warden: phases 2, 3 (' + wd.phases.join() + ')');
ok(wd.st3 > 0, 'warden: punish window opened after a slam (' + wd.st3 + ' ticks)');
ok(wd.swords > 0, 'warden: phase 3 sword lines fell (' + wd.swords + ')');
ok(wd.hurts > 0, 'warden: attacks land on a hero (' + wd.hurts + ' hits)');
ok(wd.minTele >= 0.6, 'warden: telegraphs >= 0.6 s (min ' + wd.minTele + ')');
ok(wd.half, 'warden: normal spawns at 50% while it lives');
const wd2 = fight({ id: 'warden', stage: 0, minute: 5, phaseAt: [[20, 0.6], [38, 0.3]] });
ok(wd.digest === wd2.digest, `warden: deterministic (${wd.digest} / ${wd2.digest})`);

// ---------- Sporemother (stage 1, 10:00) ----------
reset();
const sp = fight({ id: 'spore', stage: 0, minute: 10, phaseAt: [[25, 0.6], [42, 0.3]] });
ok(!sp.err, 'spore: 60 s throws nothing' + (sp.err ? ': ' + sp.err.stack : ''));
ok(sp.boss && sp.boss.maxHp === 4000, 'spore: HP 400 x 10 min = 4000 (' + (sp.boss && sp.boss.maxHp) + ')');
ok(allUsed('spore').length === 0, 'spore: every attack used ' + JSON.stringify(used.spore));
ok(sp.phases.join() === '2,3', 'spore: phases 2, 3 (' + sp.phases.join() + ')');
ok(sp.pods === 4, 'spore: 4 pods rose (' + sp.pods + ')');
ok(sp.carpet >= 8, 'spore: carpet spread (peak ' + sp.carpet + ' patches)');
ok(sp.slowed > 0, 'spore: hero stood on carpet (' + sp.slowed + ' ticks)');
ok(sp.boss && sp.boss.scale > 1.05, 'spore: uprooted in phase 3');
ok(sp.minTele >= 0.6, 'spore: telegraphs >= 0.6 s (min ' + sp.minTele + ')');
ok(sp.half, 'spore: normal spawns at 50% while it lives');
const sp2 = fight({ id: 'spore', stage: 0, minute: 10, phaseAt: [[25, 0.6], [42, 0.3]] });
ok(!sp2.err && sp2.boss.vars.patches.length > 0, 'spore: second run throws nothing');
{ // a destroyed pod clears the carpet around it (patches seeded on a live pod's slot, then the pod is killed)
  const w = sp2.w, e = sp2.boss, v = e.vars, sl = v.slots.find(s => s.pod && !s.pod.dead && s.pod.id === s.id);
  if (sl) {
    const near = () => v.patches.filter(o => !o.z.dead && o.z.id === o.id && U.dist2(o.x, o.y, sl.x, sl.y) <= 100 * 100).length;
    for (let i = 0; i < 3; i++) { const z = w.zone({ team: 1, look: 'spore', x: sl.x + i * 10, y: sl.y, r: 30, dur: 30, src: e }); v.patches.push({ z, id: z.id, x: z.x, y: z.y, R: 30 }); }
    const before = near(); w.killFoe(sl.pod, null); w.update(C.TICK);
    ok(before > 0 && near() === 0, 'spore: a destroyed pod clears the carpet around it (' + before + ' -> ' + near() + ')');
  } else ok(false, 'spore: no live pod left to test carpet clearing');
}

// ---------- Twins (stage 2, 5:00) ----------
reset();
const tw = fight({
  id: 'twins', stage: 1, minute: 5, len: 75, phaseAt: [[25, 0.45]],
  script: (w, ctx, tick, t) => {
    const P = ctx.P || (ctx.P = ctx.e.vars && ctx.e.vars.pair); if (!P) return;
    const up = (k) => { const f = P[k]; return f && !f.dead && f.id === P[k + 'id'] ? f : null; };
    if (Math.abs(t - 45) < C.TICK / 2) { const h = up('H'); if (h) { ctx.revFrom = h.id; w.hitFoe(h, h.hp + 1, w.src(w.heroes[0], 'test')); } }
    if (t > 45 && !ctx.risen && up('H') && up('H').id !== ctx.revFrom) { ctx.risen = up('H'); ctx.riseT = t; ctx.riseHp = up('H').hp / up('H').maxHp; }
  },
});
ok(!tw.err, 'twins: 75 s throws nothing' + (tw.err ? ': ' + tw.err.stack : ''));
ok(tw.w.bossList.length === 2 && tw.w.bossList.every(b => b.maxHp === 1000), 'twins: two bodies, 1000 HP each (400 x 5 min split)');
ok(allUsed('twins').length === 0, 'twins: every Lancer attack used ' + JSON.stringify(used.twins));
ok(allUsed('twinhammer').length === 0, 'twins: every Hammer attack used ' + JSON.stringify(used.twinhammer));
ok(tw.phases.join() === '2', 'twins: one phase-2 event at half combined HP (' + tw.phases.join() + ')');
ok(tw.falls === 1 && tw.rises === 1, `twins: a fallen twin rises (falls ${tw.falls}, rises ${tw.rises})`);
ok(tw.ctx && tw.ctx.risen && Math.abs(tw.ctx.riseT - 45 - ED.Bosses.TWINS.revive) < 0.1 && Math.abs(tw.ctx.riseHp - ED.Bosses.TWINS.reviveHp) < 0.02, 'twins: rises ' + ED.Bosses.TWINS.revive + ' s later at half health (' + (tw.ctx && tw.ctx.riseT) + ' s, ' + (tw.ctx && tw.ctx.riseHp) + ')');
ok(tw.ends === 0 && !tw.chest, 'twins: one fallen twin does not end the fight');
ok(tw.minTele >= 0.6, 'twins: telegraphs >= 0.6 s (min ' + tw.minTele + ')');
ok(tw.half, 'twins: normal spawns at 50% while they live');
ok(tw.w.bossBar.on && tw.w.bossBar.name === 'The Twins' && tw.w.bossBar.n === 2, 'twins: boss bar data (' + JSON.stringify(tw.w.bossBar) + ')');

// ---------- killable with a cheat build ----------
for (const [id, stage, minute] of [['warden', 0, 5], ['spore', 0, 10], ['twins', 1, 5]]) {
  const r = fight({ id, stage, minute, cls: ['knight'], cheats: { god: true, might: 60 }, len: 90, stop: (w, out) => out.ends > 0 && w.time > 0 });
  ok(!r.err, id + ': cheat kill throws nothing' + (r.err ? ': ' + r.err.stack : ''));
  ok(r.ends === 1 && r.chest && !r.w.boss && r.w.bossList.length === 0 && !r.w.bossBar.on, `${id}: killable with might x60 (ends ${r.ends}, chest ${r.chest}, at ${r.endT.toFixed(1)} s)`);
  ok(!r.w.zones.some(z => z.team === 1 && z.src && z.src.boss && !z.dead) && !r.w.projs.some(pr => pr.team === 1 && pr.e && pr.e.boss && !pr.dead), id + ': its shots and telegraphs vanish with it');
}
// Twins: both must fall inside the revive window; a lone kill revives.
{
  const r = fight({ id: 'twins', stage: 1, minute: 5, len: 40, script: (w, ctx, tick, t) => {
    const P = ctx.P || (ctx.P = ctx.e.vars && ctx.e.vars.pair); if (!P) return;
    if (Math.abs(t - 5) < C.TICK / 2) { const a = P.L; w.hitFoe(a, a.hp + 1, w.src(w.heroes[0], 'test')); }
    if (Math.abs(t - 8) < C.TICK / 2) { const b = P.H; if (!b.dead) w.hitFoe(b, b.hp + 1, w.src(w.heroes[0], 'test')); }
  } });
  ok(!r.err && r.ends === 1 && r.falls === 1 && r.rises === 0 && r.chest, `twins: both down inside the revive window ends the fight (ends ${r.ends}, falls ${r.falls}, rises ${r.rises}, chest ${r.chest})`);
}
ok(calls.n > 1000, 'client hooks drew on the mock batch (' + calls.n + ' calls)');
console.log('check-bosses-a: ' + (fails ? fails + ' failed' : 'all passed') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exit(fails ? 1 : 0);
