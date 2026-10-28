// Headless bot run: one solo hero driven by tools/bot-brain.js through a whole survival run, sped up (no rendering). Deterministic per cfg.
// API: const { runOne } = require('./bot.js'); runOne({ stage: 0..2, cls, weapon: forced weapon id | null, seed, meta: 'none' | 'max', maxTime: s (default 18 * 60) }) -> result (sync).
// Forced weapon (a base id; evolved ids throw): added at level 1 next to the signature right after world creation.
// fill (default 'off' with a forced weapon, 'on' without): 'off' bans every other weapon card from the hero's pool at the start (Bot.isolate), so offers hold levels, passives,
//   skills, gold and meals and the run isolates signature + forced weapon; 'on' lets the bot take any weapon.
// meta (Bot.metaFor): 'max' = every ED.SHOP rank at max and every hero's signature in the pool (a full profile); 'none' = an empty profile.
// result: { stage, stageId, cls, weapon, seed, meta, won, time, level, kills, gold, death (killer / 'timeout' / null), bosses: [{ id (stage boss id), at (killed), spawn }], dealt: { id: dmg }, taken: { cause: dmg }, hurt (total taken),
//   build: { weapons: [{ id, lvl, evo }], passives: [{ id, lvl }] }, evolved: { fromId: s }, hpLow (min HP fraction), ticks, ms (wall clock), skill, fill, botMs (think() time, sampled every 16th tick x 16) }.
// Optional cfg: skill 0..1 (bot reflexes, default 1), fill 'off' | 'on'.
// CLI: node tools/bot.js --stage 0 --hero knight [--weapon bonespear] [--seed 1] [--meta max] [--max 1080] [--skill 0.5] [--fill off|on]  -> prints the result JSON and ms per game minute.
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
  cfg = Object.assign({ stage: 0, cls: 'knight', weapon: null, seed: 1, meta: 'none', maxTime: 18 * 60, skill: 1, fill: null }, cfg || {});
  if (cfg.fill === true || cfg.fill === false) cfg.fill = cfg.fill ? 'on' : 'off';
  if (cfg.fill !== 'on' && cfg.fill !== 'off') cfg.fill = cfg.weapon ? 'off' : 'on';
  const ED = load(), C = ED.CONST;
  const w = new ED.World({ seed: cfg.seed, stage: cfg.stage, players: [{ pid: 'p1', name: 'Bot', slot: 0, cls: cfg.cls, meta: Bot.metaFor(ED, cfg.meta) }] });
  const p = w.heroes[0], sig = (ED.HEROES[p.cls] || {}).sig;
  if (cfg.weapon && (!ED.WEAPONS[cfg.weapon] || ED.WEAPONS[cfg.weapon].evolved)) throw new Error('unknown or evolved weapon ' + cfg.weapon);
  if (cfg.weapon && cfg.weapon !== sig) w.addWeapon(p, cfg.weapon);
  if (cfg.fill === 'off') Bot.isolate(w, p, [sig, cfg.weapon].filter(Boolean));
  const bot = Bot.create({ pid: 'p1', weapon: cfg.weapon || null, seed: cfg.seed, skill: cfg.skill, fill: cfg.fill });
  bot.onStart(w, p);
  // damage taken per cause (wraps this world's hurtHero; the sim result is unchanged)
  const taken = {}, hurt = w.hurtHero;
  let lastCause = null;
  w.hurtHero = function (h, dmg, src) { const d = hurt.call(this, h, dmg, src); if (d > 0 && h === p) { lastCause = cause(src); taken[lastCause] = (taken[lastCause] || 0) + d; } return d; };
  // boss fights: phase-0 event opens one; every boss body (bossList, incl. split / revived bodies) maps to the newest open fight; a kill (phase -1) closes the body's fight
  const bosses = [], evolved = {}, fights = [], bodyFight = new Map();
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
      if (e.t === 'boss' && e.phase === 0) { const F = { id: e.id, spawn: Math.round(w.time * 10) / 10, open: true }; fights.push(F); bodyFight.set(e.fid, F); }
      else if (e.t === 'boss' && e.phase === -1) {
        const F = bodyFight.get(e.fid) || fights.find(x => x.open);
        if (F) F.open = false;
        bosses.push({ id: F ? F.id : e.id, at: Math.round(w.time * 10) / 10, spawn: F ? F.spawn : null });
      } else if (e.t === 'evolve' && e.pid === 'p1') evolved[e.from] = Math.round(w.time * 10) / 10;
    }
    ev.length = 0;
    const BL = w.bossList, Fn = fights.length ? fights[fights.length - 1] : null;
    if (Fn && Fn.open) for (let i = 0; i < BL.length; i++) if (!bodyFight.has(BL[i].id)) bodyFight.set(BL[i].id, Fn);
    const f = p.hp / p.maxHp; if (f < hpLow) hpLow = Math.max(0, f);
  }
  const won = w.state === 'won';
  const r = {
    skill: cfg.skill, fill: cfg.fill, stage: cfg.stage, stageId: ED.STAGES[cfg.stage] ? ED.STAGES[cfg.stage].id : '', cls: p.cls, weapon: cfg.weapon || null, seed: cfg.seed, meta: cfg.meta,
    won, time: Math.round(w.time * 100) / 100, level: w.level, kills: w.kills, gold: w.gold,
    death: won ? null : w.state === 'lost' ? lastCause || 'unknown' : 'timeout',
    bosses, dealt: {}, taken, hurt: 0,
    build: { weapons: p.weapons.map(ws => ({ id: ws.id, lvl: ws.lvl, evo: !!ws.evo })), passives: p.passives.map(ps => ({ id: ps.id, lvl: ps.lvl })) },
    evolved, hpLow: Math.round(hpLow * 1000) / 1000, ticks: w.tick, ms: 0, botMs: Math.round(Number(botNs) / 1e6),
  };
  for (const k in p.dealt) r.dealt[k] = Math.round(p.dealt[k]);
  for (const k in taken) r.hurt += taken[k];
  r.ms = Date.now() - t0;
  return r;
}
module.exports = { runOne, metaFor: Bot.metaFor };

if (require.main === module) {
  const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && i + 1 < a.length ? a[i + 1] : d; };
  const cfg = { stage: +arg('stage', 0), cls: arg('hero', 'knight'), weapon: arg('weapon', null), seed: +arg('seed', 1), meta: arg('meta', 'none'), maxTime: +arg('max', 18 * 60), skill: +arg('skill', 1), fill: arg('fill', null) };
  const r = runOne(cfg);
  console.log(JSON.stringify(r, null, 1));
  console.log(`ms per game minute: ${(r.ms / Math.max(1e-6, r.time / 60)).toFixed(0)} (${r.ms} ms for ${(r.time / 60).toFixed(2)} min)`);
}
