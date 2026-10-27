// Headless check (exit 1 on failure): Drowned King, Hollow King, Demon Cyclops, Giant Samurai, Rift Weaver, Wick-Eater. Usage: node tools/check-bosses-b.js
// Per boss: spawned directly next to a solo knight (90 s, hero kept alive, boss HP forced to each phase in turn): no exceptions, every attack runs, phases 2 and 3 fire,
// hostile telegraphs >= 0.6 s (also enraged), its zones / shots reach the hero (hurt calls by source; landed hits share i-frames with the horde), every look it uses is registered, zones die with the boss,
// a mid-boss drops a chest and a final boss wins the run, and two runs with the same seed give the same digest.
// Mechanics: the King's whirlpool pulls a still hero, the Hollow King's shards orbit and the crown comes back, the Cyclops stomp wave expands, beams stop at obstacles, enrage x3 damage,
// the Weaver's gates open and shoot and its strands stay, the Wick-Eater's dark ring closes in and its maw inhales.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'client', 'bfx-c.js'), 'utf8'), { filename: 'bfx-c.js' });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
// Mock client for the bfx-c draw hooks (weaver, wickeater): ED.Atlas / ED.Game / Batch stand-ins; a non-finite draw argument throws.
const draws = { n: 0 };
const mockB = new Proxy({}, { get: (o, k) => (k === 'crowd' ? 0 : (...a) => { draws.n++; for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite arg to B.' + String(k)); return true; }) });
ED.Atlas = { ok: true, has: () => true, anim: () => ({ n: 4, fps: 8, ax: 8, ay: 16, anchors: {} }), frameAt: () => 0 };
function drawAll(w) {
  ED.Game = { view: { heroes: w.heroes, foes: w.foes } };
  for (const e of w.foes) { const f = !e.dead && ED.BossFx[e.def.id]; if (f && f.draw) f.draw(mockB, e, w.time); }
  for (const z of w.zones) { const f = !z.dead && ED.ZoneFx[z.k]; if (f) f(mockB, z, w.time); }
  for (const pr of w.projs) { const f = !pr.dead && ED.WeaponFx[pr.wid]; if (f && f.proj) f.proj(mockB, pr, w.time); }
}
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
const BOSSES = [
  { id: 'king', stage: 1, t: 600, attacks: ['beam', 'trident', 'leap', 'whirl', 'adds'] },
  { id: 'hollow', stage: 0, t: 900, final: true, attacks: ['combo', 'crown', 'blink', 'nova', 'starfall'] },
  { id: 'cyclops', stage: 1, t: 900, final: true, attacks: ['laser', 'stomp', 'leap', 'gaze', 'adds'] },
  { id: 'samurai', stage: 2, t: 300, attacks: ['dash', 'waves', 'iaido', 'spin'] },
  { id: 'weaver', stage: 2, t: 600, attacks: ['gates', 'weave', 'blink', 'adds'] },
  { id: 'wickeater', stage: 2, t: 900, final: true, attacks: ['devour', 'dark', 'lash', 'bloom', 'adds'] },
];
const LEN = 90, ATK_SEEDS = 10;

// Runs one boss fight. opt: { seed, party, enrage (time jump to ENRAGE_T at 5 s) }. Returns stats.
function fight(b, opt) {
  opt = opt || {};
  const w = new ED.World({ seed: opt.seed || 77, stage: b.stage, players: players(opt.party || ['knight']) });
  const out = { w, err: null, atk: {}, phases: [], minTele: Infinity, hurt: 0, hurtBy: {}, tryBy: {}, looks: new Set(), digest: 0, pullMoved: 0, maxShards: 0, crownOut: 0, crownMax: 0, waveMaxR: 0, beamCut: false, zonesAfter: -1, chest: false, won: false, enrDmg: 0, baseDmg: 0, addsSeen: 0, gates: 0, gateShots: 0, strands: 0, darkMin: Infinity, inhale: 0 };
  // hero stays alive and on the spot: hurt calls are counted, HP is refilled
  const hurt = w.hurtHero;
  w.hurtHero = function (p, dmg, src) { p.hp = Math.max(p.hp, 1e6); const d = hurt.call(this, p, dmg, src); const k = !src ? 'other' : src.def ? (src.boss ? 'boss contact' : 'foe contact') : String(src.k); out.tryBy[k] = (out.tryBy[k] || 0) + 1; if (d > 0) { out.hurt++; out.hurtBy[k] = (out.hurtBy[k] || 0) + 1; } p.hp = p.maxHp; return d; };
  const e = w.spawnBoss({ t: b.t, id: b.id, final: !!b.final });
  e.takeMul = 0.0001;
  out.baseDmg = e.dmg;
  const foesAtStart = new Set(w.foes.map(f => f.id));
  try {
    for (let tick = 0; tick < LEN * 60 && w.state === 'play'; tick++) {
      const p = w.heroes[0], tt = tick / 60;
      // the hero circles the boss at ~130 px (still from 70 to 74 s, phase 3: pull test), picks the first card
      const a = tt * 0.6, still = tt >= 70 && tt < 74;
      const gx = e.x + Math.cos(a) * 130, gy = e.y + Math.sin(a) * 130, dx = gx - p.x, dy = gy - p.y, l = Math.hypot(dx, dy) || 1;
      w.input(p.pid, { mx: still ? 0 : dx / l, my: still ? 0 : dy / l, ax: e.x, ay: e.y, pick: p.offer ? 1 : 0 });
      if (tick === 30 * 60) e.hp = Math.round(e.maxHp * 0.6);
      if (tick === 55 * 60) e.hp = Math.round(e.maxHp * 0.3);
      if (opt.enrage && tick === 5 * 60) w.time = C.ENRAGE_T;
      const px = p.x, py = p.y;
      w.update(C.TICK);
      if (still && w.living.length && p.dashT <= 0) out.pullMoved += Math.hypot(p.x - px, p.y - py);
      for (const ev of w.events) if (ev.t === 'boss' && ev.fid === e.id && typeof ev.phase === 'number' && ev.phase > 0) out.phases.push(ev.phase);
      w.events.length = 0;
      if (tick % 6 === 0) drawAll(w);
      if (e.vars && e.vars.st === 'atk') out.atk[e.vars.atk] = (out.atk[e.vars.atk] || 0) + 1;
      let shards = 0, crowns = 0;
      for (const z of w.zones) {
        if (z.dead) continue;
        if (z.team === 1) out.looks.add(z.k);
        if (z.team === 1 && z.warn && z.dur < out.minTele) out.minTele = z.dur;
        if (z.k === 'crownshard') shards++;
        if (z.k === 'stompwave') out.waveMaxR = Math.max(out.waveMaxR, z.r);
        if ((z.k === 'tidebeam' || z.k === 'eyelaser') && z.len < 300) out.beamCut = true;
        if (z.k === 'riftgate') out.gates++;
        if (z.k === 'strand') out.strands++;
        if (z.k === 'darkring') out.darkMin = Math.min(out.darkMin, z.r);
        if (z.k === 'inhale') out.inhale++;
      }
      for (const pr of w.projs) if (!pr.dead && pr.team === 1) { out.looks.add(pr.k); if (pr.k === 'crown') crowns++; if (pr.k === 'voidbolt' && pr.t === 0) out.gateShots++; }
      out.maxShards = Math.max(out.maxShards, shards);
      if (crowns) out.crownOut++;
      out.crownMax = Math.max(out.crownMax, crowns);
      for (const f of w.foes) if (!f.dead && !f.boss && !foesAtStart.has(f.id) && U.dist2(f.x, f.y, e.x, e.y) < 120 * 120 && f.age < 0.05) out.addsSeen++;
      if (tick % 60 === 0) out.digest = (Math.imul(out.digest, 31) + U.hashStr([w.tick, e.x.toFixed(2), e.y.toFixed(2), e.hp, w.zones.length, w.projs.length, w.heroes[0].x.toFixed(2), out.hurt].join('|'))) >>> 0;
    }
    if (opt.enrage) out.enrDmg = e.dmg;
    // kill: owned zones must vanish, a mid-boss drops a chest, a final boss wins the run
    e.takeMul = 1;
    w.hitFoe(e, 1e9, w.src(w.heroes[0], 'test'));
    w.update(C.TICK); w.update(C.TICK);
    out.zonesAfter = w.zones.filter(z => !z.dead && (z.src === e)).length;
    out.chest = w.pickups.some(g => g.k === 'chest' && !g.dead);
    out.won = w.state === 'won';
  } catch (err) { out.err = err; }
  return out;
}

const t0 = Date.now();
for (const b of BOSSES) {
  const r = fight(b), r2 = fight(b);
  ok(!r.err, `${b.id}: ${LEN} s fight throws nothing` + (r.err ? ': ' + r.err.stack : ''));
  ok(r.digest === r2.digest, `${b.id}: same seed, same digest (${r.digest} / ${r2.digest})`);
  // attack picks are weighted random off the shared w.rng: counts add up over seeds 77, 1, 2, ... (at most ATK_SEEDS fights) until every key has run
  const atk = Object.assign({}, r.atk); let seeds = 1;
  for (; seeds < ATK_SEEDS && !b.attacks.every(k => atk[k] > 0); seeds++) { const r3 = fight(b, { seed: seeds }); for (const k in r3.atk) atk[k] = (atk[k] || 0) + r3.atk[k]; }
  ok(b.attacks.every(k => atk[k] > 0), `${b.id}: every attack runs within ${seeds} fight(s) (${Object.keys(atk).map(k => k + ' ' + (atk[k] / 60).toFixed(1) + 's').join(', ')})`);
  ok(r.phases.includes(2) && r.phases.includes(3), `${b.id}: phases 2 and 3 (${r.phases.join(',')})`);
  ok(r.minTele >= 0.6, `${b.id}: hostile telegraphs >= 0.6 s (min ${r.minTele.toFixed(2)})`);
  ok(Object.keys(r.tryBy).filter(k => !/contact/.test(k)).length >= 2, `${b.id}: its attacks reach the hero (calls ${JSON.stringify(r.tryBy)}; landed ${JSON.stringify(r.hurtBy)})`);
  ok([...r.looks].every(k => ED.LOOK_IDX[k] !== undefined), `${b.id}: every look is registered (${[...r.looks].join(', ')})`);
  ok(r.zonesAfter === 0, `${b.id}: its zones die with it (${r.zonesAfter} left)`);
  ok(b.final ? r.won : r.chest, `${b.id}: ${b.final ? 'its death wins the run' : 'drops a chest'}`);
  if (b.id === 'king') { ok(r.pullMoved > 20, `king: whirlpool pulls a still hero (${r.pullMoved.toFixed(0)} px in 4 s)`); ok(r.addsSeen > 0, `king: telegraphed adds arrive (${r.addsSeen})`); }
  if (b.id === 'hollow') { ok(r.maxShards === 6, `hollow: 3 + 3 orbit shards by phase 3 (max ${r.maxShards})`); ok(r.crownOut > 0 && r.crownMax >= 3, `hollow: crowns fly (max ${r.crownMax} at once)`); }
  if (b.id === 'cyclops') ok(r.waveMaxR > 200, `cyclops: stomp wave rolls out (r ${r.waveMaxR.toFixed(0)})`);
  if (b.id === 'weaver' || b.id === 'wickeater') ok(draws.n > 0, `${b.id}: client draw hooks run on a mock batch (${draws.n} calls so far)`);
  if (b.id === 'weaver') { ok(r.gates > 0 && r.gateShots > 0, `weaver: rift gates open and shoot (${r.gates} gate ticks, ${r.gateShots} bolts)`); ok(r.strands > 0, `weaver: strands stay from phase 2 (${r.strands} strand ticks)`); }
  if (b.id === 'wickeater') { ok(r.darkMin < 80, `wickeater: closing dark shrinks (min r ${r.darkMin.toFixed(0)})`); ok(r.inhale > 0, `wickeater: the maw inhales (${r.inhale} ticks)`); }
  // enraged (final bosses enrage at ENRAGE_T): x3 damage, telegraphs still >= 0.6 s
  if (b.final) {
    const en = fight(b, { enrage: true, seed: 5 });
    ok(!en.err && Math.abs(en.enrDmg - en.baseDmg * 3) < 1e-6, `${b.id}: enrage x3 damage (${en.baseDmg.toFixed(1)} -> ${en.enrDmg.toFixed(1)})` + (en.err ? ': ' + en.err.stack : ''));
    ok(en.minTele >= 0.6, `${b.id}: enraged telegraphs >= 0.6 s (min ${en.minTele.toFixed(2)})`);
  }
  // party of 4: no exceptions
  const q = fight(b, { party: ['knight', 'ranger', 'pyro', 'cleric'], seed: 9 });
  ok(!q.err, `${b.id}: 4-hero fight throws nothing` + (q.err ? ': ' + q.err.stack : ''));
}
// beams stop at obstacles (cover)
{
  const w = new ED.World({ seed: 3, stage: 1, players: players(['knight']) }), o = w.arena.obstacles[0], L = ED.Bosses.libB;
  const len = L.rayLen(w, o.x - o.r - 80, o.y, 0, 330);
  ok(len < 90 && len > 60, `beams stop at an obstacle (ray ${len} px to a pillar 80 px away)`);
}
console.log((fails ? 'check-bosses-b: ' + fails + ' failure(s)' : 'check-bosses-b: all passed') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exitCode = fails ? 1 : 0;
