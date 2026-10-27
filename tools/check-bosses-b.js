// Headless check of the bosses-b lane (exit 1 on failure): Drowned King, Hollow King, Demon Cyclops, Giant Samurai. Usage: node tools/check-bosses-b.js
// Per boss: spawned directly next to a solo knight (90 s, hero kept alive, boss HP forced to each phase in turn): no exceptions, every attack runs, phases 2 and 3 fire,
// hostile telegraphs >= 0.6 s (also enraged), its zones / shots reach the hero (hurt calls by source; landed hits share i-frames with the horde), every look it uses is registered, zones die with the boss,
// a mid-boss drops a chest and a final boss wins the run, and two runs with the same seed give the same digest.
// Mechanics: the King's whirlpool pulls a still hero, the Hollow King's shards orbit and the crown comes back, the Cyclops stomp wave expands, beams stop at obstacles, enrage x3 damage.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const players = (list) => list.map((cls, i) => ({ pid: 'p' + (i + 1), name: 'P' + (i + 1), slot: i, cls, meta: { shop: {}, sigs: [] } }));
const BOSSES = [
  { id: 'king', stage: 1, t: 600, attacks: ['beam', 'trident', 'leap', 'whirl', 'adds'] },
  { id: 'hollow', stage: 0, t: 900, final: true, attacks: ['combo', 'crown', 'blink', 'nova', 'starfall'] },
  { id: 'cyclops', stage: 1, t: 900, final: true, attacks: ['laser', 'stomp', 'leap', 'gaze', 'adds'] },
  { id: 'samurai', stage: 2, t: 300, attacks: ['dash', 'waves', 'iaido', 'spin'] },
];
const LEN = 90;

// Runs one boss fight. opt: { seed, party, enrage (time jump to ENRAGE_T at 5 s) }. Returns stats.
function fight(b, opt) {
  opt = opt || {};
  const w = new ED.World({ seed: opt.seed || 77, stage: b.stage, players: players(opt.party || ['knight']) });
  const out = { w, err: null, atk: {}, phases: [], minTele: Infinity, hurt: 0, hurtBy: {}, tryBy: {}, looks: new Set(), digest: 0, pullMoved: 0, maxShards: 0, crownOut: 0, crownMax: 0, waveMaxR: 0, beamCut: false, zonesAfter: -1, chest: false, won: false, enrDmg: 0, baseDmg: 0, addsSeen: 0 };
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
      if (e.vars && e.vars.st === 'atk') out.atk[e.vars.atk] = (out.atk[e.vars.atk] || 0) + 1;
      let shards = 0, crowns = 0;
      for (const z of w.zones) {
        if (z.dead) continue;
        if (z.team === 1) out.looks.add(z.k);
        if (z.team === 1 && z.warn && z.dur < out.minTele) out.minTele = z.dur;
        if (z.k === 'crownshard') shards++;
        if (z.k === 'stompwave') out.waveMaxR = Math.max(out.waveMaxR, z.r);
        if ((z.k === 'tidebeam' || z.k === 'eyelaser') && z.len < 300) out.beamCut = true;
      }
      for (const pr of w.projs) if (!pr.dead && pr.team === 1) { out.looks.add(pr.k); if (pr.k === 'crown') crowns++; }
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
  ok(b.attacks.every(k => r.atk[k] > 0), `${b.id}: every attack runs (${Object.keys(r.atk).map(k => k + ' ' + (r.atk[k] / 60).toFixed(1) + 's').join(', ')})`);
  ok(r.phases.includes(2) && r.phases.includes(3), `${b.id}: phases 2 and 3 (${r.phases.join(',')})`);
  ok(r.minTele >= 0.6, `${b.id}: hostile telegraphs >= 0.6 s (min ${r.minTele.toFixed(2)})`);
  ok(Object.keys(r.tryBy).filter(k => !/contact/.test(k)).length >= 2, `${b.id}: its attacks reach the hero (calls ${JSON.stringify(r.tryBy)}; landed ${JSON.stringify(r.hurtBy)})`);
  ok([...r.looks].every(k => ED.LOOK_IDX[k] !== undefined), `${b.id}: every look is registered (${[...r.looks].join(', ')})`);
  ok(r.zonesAfter === 0, `${b.id}: its zones die with it (${r.zonesAfter} left)`);
  ok(b.final ? r.won : r.chest, `${b.id}: ${b.final ? 'its death wins the run' : 'drops a chest'}`);
  if (b.id === 'king') { ok(r.pullMoved > 20, `king: whirlpool pulls a still hero (${r.pullMoved.toFixed(0)} px in 4 s)`); ok(r.addsSeen > 0, `king: telegraphed adds arrive (${r.addsSeen})`); }
  if (b.id === 'hollow') { ok(r.maxShards === 6, `hollow: 3 + 3 orbit shards by phase 3 (max ${r.maxShards})`); ok(r.crownOut > 0 && r.crownMax >= 3, `hollow: crowns fly (max ${r.crownMax} at once)`); }
  if (b.id === 'cyclops') ok(r.waveMaxR > 200, `cyclops: stomp wave rolls out (r ${r.waveMaxR.toFixed(0)})`);
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
