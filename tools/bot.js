// Headless bot run: one solo hero driven by tools/bot-brain.js through a whole survival run, sped up (no rendering). Deterministic per cfg.
// API: const { runOne } = require('./bot.js'); runOne({ stage: 0..3, cls, seed, meta: 'none' | 'max', maxTime: s (default 23 * 60) }) -> result (sync). The hero holds only its signature.
// meta (Bot.metaFor): 'max' = every ED.SHOP rank at max (a full profile); 'none' = an empty profile.
// result: { stage, stageId, cls, seed, meta, won, time, level, kills, gold, death (killer / 'timeout' / null), bosses: [{ id (stage boss id), at (killed), spawn, hit (first hero hit on any body), on }],
//   elites: [{ k (foe id), t (spawn s), hit (first hit s, null if never hit), ttk (death - first hit, null if not killed before the run ends or the win is banked), on }],
//   on: s under fire between first hit and death (ticks within ON s after an HP drop; a fight's bodies summed). dealt: { id: dmg }, taken: { cause: dmg }, hurt (total taken),
//   build: { weapons: [{ id, lvl, evo, pr: [path ranks], fl (refine) }], passives: [{ id, lvl }] }, evolved: { rootId: s (Form taken) }, hpLow (min HP fraction), ticks, ms (wall clock), skill,
//   botMs (think() time, sampled every 16th tick x 16), sanctum (true once the run reached the Sanctum room: a death after that died inside it) }.
// Optional cfg: skill 0..1 (bot reflexes, default 1).
// CLI: node tools/bot.js --stage 0 --hero knight [--seed 1] [--meta max] [--max 1380] [--skill 0.5]  -> prints the result JSON and ms per game minute.
'use strict';
const { load } = require('./sim.js');
const Bot = require('./bot-brain.js');

// Short name of a damage source (foe / foe shot / hostile zone).
function cause(src) {
  if (!src) return 'unknown';
  if (src.def) return src.def.id + (src.boss ? '' : src.elite ? ' (elite)' : '');
  // pooled shooters / casters may be reused under a new id: name them only while the id still matches, else by the shot / zone look
  if (src.team === 1 && src.hits) return (src.e && src.e.id === src.owner && src.e.def ? src.e.def.id : src.k || '?') + ' shot';
  if (src.dur !== undefined) { const s = src.src && src.src.id === src.srcId && src.src.def ? src.src.def.id : 'zone'; return s + ' ' + (src.k || 'zone'); }
  return 'unknown';
}

function runOne(cfg) {
  const t0 = Date.now();
  cfg = Object.assign({ stage: 0, cls: 'knight', seed: 1, meta: 'none', maxTime: 23 * 60, skill: 1 }, cfg || {});
  const ED = load(), C = ED.CONST;
  const w = new ED.World({ seed: cfg.seed, stage: cfg.stage, players: [{ pid: 'p1', name: 'Bot', slot: 0, cls: cfg.cls, meta: Bot.metaFor(ED, cfg.meta) }] });
  const p = w.heroes[0];
  const bot = Bot.create({ pid: 'p1', seed: cfg.seed, skill: cfg.skill });
  bot.onStart(w, p);
  // damage taken per cause (wraps this world's hurtHero; the sim result is unchanged)
  const taken = {}, hurt = w.hurtHero;
  let lastCause = null;
  w.hurtHero = function (h, dmg, src) { const d = hurt.call(this, h, dmg, src); if (d > 0 && h === p) { lastCause = cause(src); taken[lastCause] = (taken[lastCause] || 0) + d; } return d; };
  // boss fights: phase-0 event opens one; every boss body (bossList, incl. split / revived bodies) maps to the newest open fight; a kill (phase -1) closes the body's fight
  const bosses = [], evolved = {}, fights = [], bodyFight = new Map();
  // elites: one record per spawner elite ('warn' elite event); live ones keep the foe ref (pooled: valid while its id matches) until the 'die' event or a despawn
  const elites = [], elLive = [], ON = 0.5, r1 = (v) => Math.round(v * 10) / 10;
  // under-fire clock of record R at total HP h (R.ph: HP last tick, R.last: time of the last HP drop)
  const fire = (R, h) => { if (h < R.ph) R.last = w.time; R.ph = h; if (R.last >= 0 && w.time - R.last <= ON) R.on += C.TICK; };
  let hpLow = 1, iter = 0, botNs = 0n;
  const maxIter = Math.ceil(cfg.maxTime * 60 * 1.5) + 20000;
  while (w.state === 'play' && w.time < cfg.maxTime && iter++ < maxIter) {
    let fr;
    if ((iter & 15) === 0) { const b0 = process.hrtime.bigint(); fr = bot.think(w, p); botNs += (process.hrtime.bigint() - b0) * 16n; }
    else fr = bot.think(w, p);
    w.input('p1', fr);
    w.update(C.TICK);
    const ev = w.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'boss' && e.phase === 0) { const F = { id: e.id, spawn: Math.round(w.time * 10) / 10, hit: null, open: true, ph: Infinity, last: -1, on: 0 }; fights.push(F); bodyFight.set(e.fid, F); }
      else if (e.t === 'boss' && e.phase === -1) {
        const F = bodyFight.get(e.fid) || fights.find(x => x.open);
        if (F) F.open = false;
        const at = Math.round(w.time * 10) / 10;
        bosses.push({ id: F ? F.id : e.id, at, spawn: F ? F.spawn : null, hit: F ? (F.hit === null ? at : F.hit) : null, on: F ? r1(F.on + C.TICK) : null });
      } else if (e.t === 'evolve' && e.pid === 'p1') evolved[e.from] = Math.round(w.time * 10) / 10;
      else if (e.t === 'warn' && e.kind === 'elite') {
        const F = w.foes; let f = null;
        for (let j = F.length - 1; j >= 0; j--) if (F[j].id === e.id) { f = F[j]; break; }
        const E = { k: f ? f.def.id : '', t: Math.round(w.time * 10) / 10, hit: null, ttk: null, f, id: e.id, ph: Infinity, last: -1, on: 0 };
        elites.push(E); if (f) elLive.push(E);
      } else if (e.t === 'die' && e.elite && !e.boss) {
        for (let j = 0; j < elLive.length; j++) {
          const E = elLive[j];
          if (E.id !== e.id) continue;
          const at = Math.round(w.time * 10) / 10;
          if (E.hit === null) E.hit = at;
          if (!w.won) { E.ttk = r1(at - E.hit); E.on = E.on + C.TICK; }
          elLive.splice(j, 1); break;
        }
      }
    }
    ev.length = 0;
    for (let j = elLive.length - 1; j >= 0; j--) {
      const E = elLive[j], f = E.f;
      if (f.dead || f.id !== E.id) { elLive.splice(j, 1); continue; }
      if (E.hit === null && f.hp < f.maxHp) E.hit = r1(w.time);
      if (E.hit !== null) fire(E, f.hp);
    }
    const BL = w.bossList, Fn = fights.length ? fights[fights.length - 1] : null;
    if (Fn && Fn.open) {
      let h = 0;
      for (let i = 0; i < BL.length; i++) {
        const b = BL[i]; h += b.hp;
        if (!bodyFight.has(b.id)) bodyFight.set(b.id, Fn);
        if (Fn.hit === null && b.hp < b.maxHp) Fn.hit = r1(w.time);
      }
      if (Fn.hit !== null) fire(Fn, h);
    }
    const f = p.hp / p.maxHp; if (f < hpLow) hpLow = Math.max(0, f);
  }
  const won = w.state === 'won' || !!w.won; // a banked win (final boss dead) cut by maxTime during the Last Light is still a win
  const r = {
    skill: cfg.skill, stage: cfg.stage, stageId: ED.STAGES[cfg.stage] ? ED.STAGES[cfg.stage].id : '', cls: p.cls, seed: cfg.seed, meta: cfg.meta,
    won, time: Math.round(w.time * 100) / 100, level: w.level, kills: w.kills, gold: w.gold,
    death: won ? null : w.state === 'lost' ? lastCause || 'unknown' : 'timeout',
    bosses, elites: elites.map(E => ({ k: E.k, t: E.t, hit: E.hit, ttk: E.ttk, on: E.ttk === null ? null : r1(E.on) })), dealt: {}, taken, hurt: 0,
    build: { weapons: p.weapons.map(ws => ({ id: ws.id, lvl: ws.lvl, evo: !!ws.evo, tune: ws.tune, path: ws.path, pr: ws.pr.slice(), fl: ws.fl })), passives: p.passives.map(ps => ({ id: ps.id, lvl: ps.lvl })) },
    evolved, hpLow: Math.round(hpLow * 1000) / 1000, ticks: w.tick, ms: 0, botMs: Math.round(Number(botNs) / 1e6),
    sanctum: !!(w.sanctum && w.sanctum.st >= 1),
  };
  for (const k in p.dealt) r.dealt[k] = Math.round(p.dealt[k]);
  for (const k in taken) r.hurt += taken[k];
  r.ms = Date.now() - t0;
  return r;
}
module.exports = { runOne, metaFor: Bot.metaFor };

if (require.main === module) {
  const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && i + 1 < a.length ? a[i + 1] : d; };
  const cfg = { stage: +arg('stage', 0), cls: arg('hero', 'knight'), seed: +arg('seed', 1), meta: arg('meta', 'none'), maxTime: +arg('max', 23 * 60), skill: +arg('skill', 1) };
  const r = runOne(cfg);
  console.log(JSON.stringify(r, null, 1));
  console.log(`ms per game minute: ${(r.ms / Math.max(1e-6, r.time / 60)).toFixed(0)} (${r.ms} ms for ${(r.time / 60).toFixed(2)} min)`);
}
