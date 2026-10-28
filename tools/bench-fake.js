// Fast deterministic stand-in for tools/bot.js runOne (tools/bench.js --runner ./bench-fake.js; used by tools/check-bench.js). Same cfg and result shape, values from a hash of
// stage, hero, seed, meta, skill. Win odds and boss TTK depend on the hero, so rankings differ; lower skill = fewer wins, more damage taken; long runs often take the path-0 Form.
// Stage 0's second boss is reported as 'twinhammer' with spawn null on odd seeds (the Twins' last body, as the real bot reports it). Exports fake: true (the report marks stub data).
'use strict';
function runOne(cfg) {
  const ED = runOne.ED || (runOne.ED = require('./sim.js').load());
  cfg = Object.assign({ stage: 0, cls: 'knight', seed: 1, meta: 'none', maxTime: 1080, skill: 1 }, cfg || {});
  const skill = cfg.skill;
  let h = 2166136261;
  for (const ch of JSON.stringify([cfg.stage, cfg.cls, cfg.seed, cfg.meta, skill])) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  let hq = 0;
  for (const ch of String(cfg.cls)) hq = (hq * 31 + ch.charCodeAt(0)) % 997;
  const st = ED.STAGES[cfg.stage], sig = ED.HEROES[cfg.cls].sig, maxT = cfg.maxTime, sched = st.bosses, fin = sched[sched.length - 1];
  const ttkOf = () => Math.round((8 + (hq % 40) * (1.6 - skill * 0.6) + rnd() * 12) * 10) / 10;
  const finTTK = ttkOf();
  const won = fin.t + finTTK <= maxT && rnd() < 0.3 + (hq % 50) / 100 - cfg.stage * 0.1 + (cfg.meta === 'max' ? 0.2 : 0) - (1 - skill) * 0.4;
  const time = won ? fin.t + finTTK : Math.round(Math.min(maxT, rnd() * maxT * 1.05) * 10) / 10;
  const bosses = [];
  for (const b of sched) {
    if (b.final) { if (won) bosses.push({ id: b.id, at: time, spawn: b.t }); continue; }
    const ttk = ttkOf();
    if (time < b.t + ttk) continue;
    const twin = cfg.stage === 0 && b.id === 'twins' && cfg.seed % 2 === 1;
    bosses.push({ id: twin ? 'twinhammer' : b.id, at: Math.round((b.t + ttk) * 10) / 10, spawn: twin ? null : b.t });
  }
  const form = ED.WEAPONS[sig].paths[0].form, took = time > 300 && rnd() < 0.7, evolved = {};
  const dealt = { [sig]: Math.round(time * 40 * (0.5 + rnd())), [ED.HEROES[cfg.cls].skills[0]]: Math.round(time * 5 * rnd()) };
  if (took) { dealt[form] = Math.round(time * 30 * (0.5 + rnd())); evolved[sig] = Math.round(240 + rnd() * (time - 240)); }
  const weapons = [{ id: took ? form : sig, lvl: took ? 8 : 5, evo: took, pr: took ? [3, 2, 1] : [2, 1, 1], fl: 0 }];
  const taken = {};
  let hurt = 0;
  for (const id of ['bat', 'ghoul', 'spit shot', 'ghoul (elite)']) { const d = Math.round(time * rnd() * (2.5 - skill * 1.5)); taken[id] = d; hurt += d; }
  for (const b of bosses) { const d = Math.round(100 * rnd()); taken[b.id] = d; hurt += d; }
  return { skill, stage: cfg.stage, stageId: st.id, cls: cfg.cls, seed: cfg.seed, meta: cfg.meta, won, time,
    level: Math.round(time / 25), kills: Math.round(time * 6 * (0.5 + rnd())), gold: Math.round(time / 3),
    death: won ? null : time >= maxT ? 'timeout' : ['bat', 'ghoul', 'spit shot', bosses.length ? 'twins' : 'warden'][Math.floor(rnd() * 4)],
    bosses, dealt, taken, hurt, build: { weapons, passives: [{ id: 'might', lvl: 3 }] }, evolved, hpLow: Math.round(rnd() * 1000) / 1000, ticks: Math.round(time * 60), ms: 1, botMs: 0 };
}
module.exports = { runOne, fake: true };
