// Headless juice check (exit 1 on failure): runs src/client/actors.js + fx.js in Node against a recording ED.Batch and an atlas stub built from the generated art tables.
// 1. A 6-minute solo knight run (god, might) and a 2-minute 4-hero run feed every World event to FX.handle and draw every visible actor each 1/30 s frame:
//    no exceptions, every draw call has finite numbers and valid colours, every sprite id exists in the atlas, pools never exceed their caps, the actor state map stays bounded.
// 2. Damage numbers: merge per foe within 150 ms, a new number after it, at most 60 alive, off when FX.numbers is false.
// 3. Death budget: 400 deaths in one frame stay within the particle budget; elite and boss deaths shake and hit-stop (solo only, never on a host).
// 4. Facing: eight-way and four-way sheets face the nearest hero; wind-up holds the frame and leans; boss wind-up / act pick the attack halves; bosses without art draw a placeholder.
// 5. Non-2D Batch: elite outline falls back to four tinted white copies.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load } = require('./sim.js');
const ED = load(), C = ED.CONST;
const ROOT = path.join(__dirname, '..', 'src') + '/';
for (const f of ['meta.js', 'world.js', 'actors.js', 'bosses.js', 'fx.js', 'fxbig.js']) vm.runInThisContext(fs.readFileSync(ROOT + 'art/' + f, 'utf8'), { filename: 'art/' + f });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };

// ---------------- stubs ----------------
const ART = ED.ART;
const rec = (id) => {
  const a = ART.anims[id];
  if (a) return { id, n: a.f.length, fps: a.fps || 8, loop: a.loop !== false, ax: a.ax || 0, ay: a.ay || 0, anchors: a.anchors || {}, f: a.f.map(k => ART.frames[k]) };
  const f = ART.frames[id];
  return f ? { id, n: 1, fps: 1, loop: false, ax: f.ox + f.w / 2, ay: f.oy + f.h, anchors: {}, f: [f] } : null;
};
const recs = new Map();
ED.Atlas = {
  ok: true,
  has: (id) => !!ED.Atlas.anim(id),
  anim: (id) => { if (!recs.has(id)) recs.set(id, rec(id)); return recs.get(id); },
  frameAt: (id, t) => { const r = ED.Atlas.anim(id); if (!r) return 0; const k = Math.floor(t * r.fps); return r.loop ? ((k % r.n) + r.n) % r.n : Math.max(0, Math.min(r.n - 1, k)); },
  variant: () => false,
};
const bad = [];
const fin = (...v) => v.every(Number.isFinite);
const colOk = (c) => Number.isInteger(c) && c >= 0 && c <= 0xffffffff;
const note = (m) => { if (bad.length < 12) bad.push(m); };
const B = ED.Batch = {
  mode: 'test', crowd: 0, stats: { spr: 0, shapes: 0 }, ctx: null, calls: 0, sprs: [], keep: false, miss: new Set(),
  spr(id, fi, x, y, o) {
    B.calls++;
    if (B.keep) B.sprs.push({ id, fi, x, y, flip: o && o.flip, flash: o && o.flash, tint: o && o.tint, alpha: o && o.alpha, sx: o && o.sx });
    const r = ED.Atlas.anim(id);
    if (!r) { B.miss.add(id); return false; }
    if (!Number.isInteger(fi) || fi < 0 || fi >= r.n) note('frame ' + fi + ' of ' + id + ' (' + r.n + ')');
    if (!fin(x, y)) note('spr pos ' + id + ' ' + x + ',' + y);
    if (o) { if (o.alpha !== undefined && !(o.alpha >= 0 && o.alpha <= 1)) note('alpha ' + o.alpha + ' ' + id); if (o.flash && !(o.flash >= 0 && o.flash <= 1)) note('flash ' + o.flash); if (!fin(o.sx === undefined ? 1 : o.sx, o.sy === undefined ? 1 : o.sy, o.rot || 0)) note('spr o ' + id); }
    return true;
  },
  rect(x, y, w, h, c) { B.calls++; if (!fin(x, y, w, h) || !colOk(c)) note('rect ' + [x, y, w, h, c]); },
  circ(x, y, r, c, lw) { B.calls++; if (!fin(x, y, r, lw || 0) || !colOk(c)) note('circ ' + [x, y, r, c, lw]); },
  line(x0, y0, x1, y1, lw, c) { B.calls++; if (!fin(x0, y0, x1, y1, lw) || !colOk(c)) note('line ' + [x0, y0, x1, y1, lw, c]); },
  cone(x, y, r, a, arc, c, lw) { B.calls++; if (!fin(x, y, r, a, arc, lw || 0) || !colOk(c)) note('cone ' + [x, y, r, a, arc, c]); },
  shadow(x, y, rx) { B.calls++; if (!fin(x, y, rx)) note('shadow'); },
  text(s, x, y, c, k, al, alpha) { B.calls++; if (typeof s !== 'string' || !fin(x, y, k) || !colOk(c) || (alpha !== undefined && !(alpha >= 0 && alpha <= 1))) note('text ' + [s, x, y, c, k, alpha]); },
  img() { B.calls++; },
};
ED.Render = { camX: 0, camY: 0, bw: 640, bh: 360, crowd: 0, dpr: 1 };
ED.Game = { mode: 'solo', view: null };
for (const f of ['client/actors.js', 'client/fx.js']) vm.runInThisContext(fs.readFileSync(ROOT + f, 'utf8'), { filename: f });
const F = ED.FX, Ac = ED.Actors;

// ---------------- a run ----------------
function drive(w, p, tick) {
  const t = tick / 60, a = t * 0.7 + p.slot * 1.6;
  w.input(p.pid, { mx: Math.cos(a), my: Math.sin(a), ax: p.x + Math.cos(a) * 80, ay: p.y + Math.sin(a) * 80, q: tick % 420 === 30 + p.slot * 7, e: tick % 660 === 60 + p.slot * 7, dash: tick % 300 === 90 + p.slot * 13, pick: p.offer ? 1 : 0 });
}
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
function frame(v, t) {
  const me = v.me, R = ED.Render;
  if (me) { R.camX = Math.round(me.x - R.bw / 2); R.camY = Math.round(me.y - 10 - R.bh / 2); }
  const S = { x: 0, y: 0 }; F.shakeXY(S);
  const cx = R.camX + S.x, cy = R.camY + S.y, inV = (o) => o.x >= cx - 48 && o.x <= cx + R.bw + 48 && o.y >= cy - 48 && o.y <= cy + R.bh + 64;
  let crowd = 0;
  for (const g of v.pickups) if (!g.dead && inV(g)) Ac.pickup(B, g, t);
  for (const e of v.foes) if (!e.dead && inV(e)) crowd++;
  B.crowd = crowd; R.crowd = crowd;
  for (const e of v.foes) if (!e.dead && inV(e)) Ac.foe(B, e, t, v.heroes);
  for (const p of v.heroes) if (!p.dead) Ac.hero(B, p, t);
  F.draw(B, t); F.drawTop(B);
  return crowd;
}
function runJuice(label, cfg, secs) {
  const w = new ED.World(cfg), v = { me: null, heroes: w.heroes, foes: w.foes, projs: w.projs, zones: w.zones, pickups: w.pickups, props: w.arena, boss: null };
  ED.Game.view = v; ED.Game.mode = cfg.players.length > 1 ? 'host' : 'solo'; F.clear();
  const out = { err: null, over: [], maxActors: 0, maxCrowd: 0, frames: 0, evs: 0, maxCalls: 0, holds: 0 };
  try {
    for (let tick = 0; w.time < secs && w.state === 'play'; tick++) {
      for (const p of w.heroes) drive(w, p, tick);
      w.update(C.TICK);
      v.me = w.hero('p1'); v.boss = w.boss;
      const ctx = { me: 'p1', crowd: ED.Render.crowd };
      for (const ev of w.events) { F.handle(ev, ctx); out.evs++; }
      w.events.length = 0;
      if (F.hold > 0) out.holds++;
      if (tick % 2 === 1) {
        F.update(1 / 30);
        B.calls = 0;
        const crowd = frame(v, w.time);
        out.frames++; out.maxCrowd = Math.max(out.maxCrowd, crowd); out.maxCalls = Math.max(out.maxCalls, B.calls);
        const c = F.counts();
        for (const k in c) if (c[k].live > c[k].max || c[k].total > c[k].max) out.over.push(k + ' ' + c[k].live + '/' + c[k].total + '>' + c[k].max + ' @' + w.time.toFixed(1));
        out.maxActors = Math.max(out.maxActors, Ac.size());
      }
    }
  } catch (e) { out.err = e; }
  out.w = w;
  ok(!out.err, label + ': no exceptions' + (out.err ? ': ' + out.err.stack : ''));
  ok(!out.over.length, label + ': pools within caps' + (out.over.length ? ': ' + out.over.slice(0, 4).join('; ') : ''));
  ok(out.maxActors < 2600, label + ': actor state map bounded (max ' + out.maxActors + ')');
  console.log(`     ${label}: t ${w.time.toFixed(0)} s, kills ${w.kills}, level ${w.level}, events ${out.evs}, frames ${out.frames}, max crowd ${out.maxCrowd}, max draw calls ${out.maxCalls}, hit-stop ticks ${out.holds}`);
  return out;
}
const t0 = Date.now();
const solo = runJuice('solo knight 6:00', { seed: 77, stage: 0, players: players(['knight']), cheats: { god: true, might: 3 } }, 360);
ok(solo.holds > 0, 'solo: hit-stop happens (' + solo.holds + ' ticks)');
const party = runJuice('4 heroes 2:00', { seed: 78, stage: 1, players: players(['ranger', 'pyro', 'necro', 'bell']), cheats: { god: true } }, 120);
ok(party.holds === 0, 'co-op host: no hit-stop (' + party.holds + ')');
ok(!bad.length, 'draw calls carry finite numbers and valid colours' + (bad.length ? ': ' + bad.join(' | ') : ''));
const miss = [...B.miss].filter(id => !/^boss\.(cyclops|samurai)\./.test(id));
ok(!miss.length, 'every sprite id exists in the atlas' + (miss.length ? ': ' + miss.slice(0, 8).join(', ') : ''));

// ---------------- numbers ----------------
ED.Render.camX = -320; ED.Render.camY = -180; // synthetic events below happen around (0, 0)
F.clear(); ED.Game.mode = 'solo'; F.numbers = true;
F.number(1, 0, 0, 10, false); F.update(0.05); F.number(1, 0, 0, 15, false);
let c = F.counts().nums.live;
ok(c === 1, 'numbers merge within 150 ms (' + c + ' alive)');
F.update(0.12); F.number(1, 0, 0, 5, true);
ok(F.counts().nums.live === 2, 'a new number after 150 ms');
for (let i = 0; i < 150; i++) F.number(100 + i, i, 0, 3, i % 7 === 0);
ok(F.counts().nums.live === 60, 'at most 60 numbers alive (' + F.counts().nums.live + ')');
F.clear(); F.numbers = false; F.number(5, 0, 0, 9, false); ok(F.counts().nums.live === 0, 'numbers off'); F.numbers = true;

// ---------------- death budget, shake, hit-stop ----------------
F.clear(); F.update(0.016);
const ctx = { me: 'p1', crowd: 600 };
for (let i = 0; i < 400; i++) F.handle({ t: 'die', id: 9000 + i, k: ED.FOE_IDX.skeleton, x: i, y: 0, elite: false, boss: false }, ctx);
const pc = F.counts().parts.live;
ok(pc <= 18 * 8 + 56 + 10, '400 deaths in one frame stay in budget (' + pc + ' particles)');
ok(F.shake === 0 && F.hold === 0, 'normal deaths neither shake nor hit-stop');
F.update(0.5);
F.handle({ t: 'die', id: 1, k: ED.FOE_IDX.skelknight, x: 0, y: 0, elite: true, boss: false }, { me: 'p1', crowd: 0 });
ok(F.shake > 0 && F.hold > 0, 'elite death shakes and hit-stops');
F.clear(); F.update(1); ED.Game.mode = 'host';
F.handle({ t: 'skill', pid: 'p1', id: 'charge', slot: 0, x: 0, y: 0, a: 0 }, { me: 'p1', crowd: 0 });
ok(F.hold === 0 && F.shake > 0, 'host: a skill shakes without hit-stop');
F.clear(); F.update(1); ED.Game.mode = 'solo'; F.shakeOn = false;
F.handle({ t: 'skill', pid: 'p1', id: 'charge', slot: 0, x: 0, y: 0, a: 0 }, { me: 'p1', crowd: 0 });
ok(F.shake === 0 && F.hold > 0, 'shake setting off: no shake, hit-stop kept'); F.shakeOn = true;
F.clear(); F.update(1);
F.handle({ t: 'skill', pid: 'p1', id: 'charge', slot: 0, x: 0, y: 0, a: 0 }, { me: 'p1', crowd: 0 }); const s0 = F.shake; F.clear(); F.update(1);
F.handle({ t: 'skill', pid: 'p1', id: 'charge', slot: 0, x: 0, y: 0, a: 0 }, { me: 'p1', crowd: 900 });
ok(F.shake < s0 * 0.4, 'shake scales down with the crowd (' + F.shake.toFixed(2) + ' < ' + s0.toFixed(2) + ')');

// ---------------- facing and poses ----------------
F.clear(); F.update(0.016); B.keep = true;
const hero = { pid: 'p1', x: 0, y: 0, dead: false, downed: false };
const mkFoe = (id, x, y, extra) => Object.assign({ id: 5000 + Math.floor(Math.random() * 1e6), k: ED.FOE_IDX[id], def: ED.FOES[id], x, y, r: ED.FOES[id].r, face: 1, flash: 0, st: 0, stT: 0, elite: false, boss: !!ED.FOES[id].boss, freezeT: 0, stunT: 0, hpQ: 255, scale: 0, enraged: false }, extra || {});
const drawOne = (e, heroes) => { B.sprs.length = 0; Ac.foe(B, e, 1.0, heroes || [hero]); return B.sprs.filter(s => s.flash !== 1 || !s.tint).map(s => s.id); };
ok(drawOne(mkFoe('cavespider', -100, 0)).includes('foe.cavespider.walk.2'), 'eight-way: hero east -> walk.2 (E)');
ok(drawOne(mkFoe('cavespider', 0, -100)).includes('foe.cavespider.walk.0'), 'eight-way: hero south -> walk.0 (S)');
ok(drawOne(mkFoe('cavespider', 100, 100)).includes('foe.cavespider.walk.5'), 'eight-way: hero north-west -> walk.5 (NW)');
ok(drawOne(mkFoe('bat', 0, 100)).includes('foe.bat.walk.u'), 'four-way: hero north -> walk.u');
ok(drawOne(mkFoe('myconid', 100, 0)).includes('foe.myconid.walk.l'), 'four-way: hero west -> walk.l');
{
  const e = mkFoe('skeleton', -50, 0); drawOne(e); e.st = 1; drawOne(e);
  F.update(0.25); drawOne(e); const a = B.sprs.find(s => s.id.startsWith('foe.skeleton') && !s.tint);
  F.update(0.05); drawOne(e); const b = B.sprs.find(s => s.id.startsWith('foe.skeleton') && !s.tint);
  ok(a && b && a.fi === b.fi && a.x < -50, 'wind-up holds the frame and leans away from the hero (x ' + (a && a.x) + ')');
}
{
  const e = mkFoe('warden', -100, 0, { scale: 1 }); e.st = 1; drawOne(e); F.update(0.3); drawOne(e);
  const w1 = B.sprs.find(s => s.id === 'boss.bonewarden.attack');
  e.st = 2; drawOne(e); F.update(0.05); drawOne(e);
  const w2 = B.sprs.find(s => s.id === 'boss.bonewarden.attack');
  ok(w1 && w1.fi < 4 && w2 && w2.fi >= 4, 'boss wind-up holds the first attack half, act plays the second (' + (w1 && w1.fi) + ' / ' + (w2 && w2.fi) + ')');
  e.st = 0; e.flash = 0.06; F.update(0.5); drawOne(e);
  ok(B.sprs.some(s => s.id === 'boss.bonewarden.hit'), 'boss heavy-hit pose');
  const sm = mkFoe('spore', 100, 0); drawOne(sm);
  ok(B.sprs.some(s => s.id.startsWith('boss.sporemother') && !s.flip), 'front-facing boss never flips');
  const cy = mkFoe('cyclops', 0, -60); let threw = null; try { drawOne(cy); } catch (err) { threw = err; }
  ok(!threw, 'boss without art draws a placeholder');
}
{
  const e = mkFoe('skeleton', -60, 0, { elite: true, scale: 2 }); B.sprs.length = 0; Ac.foe(B, e, 1.0, [hero]);
  const tinted = B.sprs.filter(s => s.flash === 1 && s.tint === 0xffc94a).length;
  ok(tinted === 4, 'non-2D Batch: elite outline = 4 tinted copies (' + tinted + ')');
}
{
  const p = { pid: 'p9', slot: 0, cls: 'knight', x: 0, y: 0, face: Math.PI, moving: false, hurtT: 0, invuln: 0, dashT: 0, downed: false, weapons: [{ id: 'cleave', lvl: 1 }], dead: false };
  B.sprs.length = 0; Ac.hero(B, p, 1);
  const body = B.sprs.find(s => s.id.startsWith('hero.knight')), wpn = B.sprs.find(s => s.id === 'weapon.longsword');
  ok(body && body.flip && wpn, 'hero faces its aim (left) and holds its weapon');
  p.downed = true; p.revive = 0.5; p.bleed = 10; B.sprs.length = 0; Ac.hero(B, p, 1);
  ok(!B.sprs.some(s => s.id === 'weapon.longsword'), 'downed hero drops the weapon pose');
}
B.keep = false;
ok(!bad.length, 'pose tests draw valid calls' + (bad.length ? ': ' + bad.join(' | ') : ''));
console.log(`check-juice: ${fails ? fails + ' FAILED' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
