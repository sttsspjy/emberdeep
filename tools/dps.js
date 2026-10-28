// Hero weapon yardstick: damage per second of one hero's weapon per build, on a crowd and on a single target (headless, deterministic, no passives, god mode).
// Usage: node tools/dps.js [cls ...] [--t 20]. Builds: base (no ranks), p0 / p1 / p2 (that path at rank 3), all (every path at rank 3), f0 / f1 / f2 / h0 / h1
// (path i at rank 3, or both hybrid paths, + its Form refined twice), F0.. (all 9 ranks + that Form refined twice). Forms missing from the def are skipped.
// crowd: 160 'skeleton' foes kept on the field (40-300 px around the hero, HP of minute 10 = 3.4x base); dps = damage dealt / s, kps = kills / s.
// single: one knockback-immune 'skelknight' with near-infinite HP 50 px to the right of the hero; dps on it.
// The hero casts its Q on cooldown at the nearest foe; wpn = weapon dps, q = skill dps (separate columns). Party level per build (skill scaling): base 1, p* 8, all 15, f*/h* 15, F*/H* 30.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U;
const args = process.argv.slice(2), T = +(args[args.indexOf('--t') + 1] || 0) || 20;
const classes = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--t');
const CROWD = 160, HPK = 3.4;

const world = (cls) => {
  const w = new ED.World({ seed: 7, stage: 0, players: [{ pid: 'p1', name: 'D', slot: 0, cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of w.sdef.timeline) { row.rate = 0; row.floor = 0; }
  w.sp.swarmT = w.sp.eliteT = Infinity; w.sdef = Object.assign({}, w.sdef, { bosses: [], bench: null });
  return w;
};
// Build: ranks per path [a, b, c] and the Form id to take (refined fully) or ''.
const apply = (w, p, ranks, form) => {
  const ws = p.weapons[0];
  for (let i = 0; i < 3; i++) for (let r = 0; r < ranks[i]; r++) w.rankPath(p, ws, i);
  if (form) { if (!w.takeForm(p, ws, form)) return false; while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return true;
};
const sq = (cls) => ED.HEROES[cls].skills[0];
// Damage of p: only the skill's row (q true) or every other row.
const dealt = (p, skill, q) => { let s = 0; for (const k in p.dealt) if ((k === skill) === q) s += p.dealt[k]; return s; };
const aim = (w, p) => { const e = w.nearestFoe(p.x, p.y, 300); p.in.ax = e ? e.x : p.x + 60; p.in.ay = e ? e.y : p.y; p.in.q = true; };
const LEVEL = { b: 1, p: 8, a: 15, f: 15, h: 15, F: 30, H: 30 };
const run = (cls, name, ranks, form, mode) => {
  const w = world(cls), p = w.heroes[0];
  w.level = LEVEL[name[0]] || 1; w.addXp = () => {}; // fixed build and level: no level-ups during the scenario
  if (!apply(w, p, ranks, form)) return null;
  const rng = U.RNG(3);
  let boss = null;
  const top = () => {
    if (mode === 'single') {
      if (!boss || boss.dead) boss = w.spawnFoe('skelknight', p.x + 50, p.y, { hpMul: 1e6 });
      boss.x = p.x + 50; boss.y = p.y; return;
    }
    let n = 0; for (const e of w.foes) if (!e.dead) n++;
    for (; n < CROWD; n++) {
      const a = rng.next() * U.TAU, d = 40 + Math.sqrt(rng.next()) * 260, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d * 0.6;
      if (!ED.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe('skeleton', x, y, { hpMul: HPK });
    }
  };
  const k0 = w.kills;
  for (let t = 0; t < T; t += ED.CONST.TICK) { top(); p.in.mx = 0; p.in.my = 0; aim(w, p); w.update(ED.CONST.TICK); }
  return { dps: dealt(p, sq(cls), false) / T, q: dealt(p, sq(cls), true) / T, kps: (w.kills - k0) / T };
};

const builds = (cls) => {
  const root = ED.WEAPONS[ED.HEROES[cls].sig], P = root.paths || [], out = [['base', [0, 0, 0], '']];
  for (let i = 0; i < P.length; i++) { const r = [0, 0, 0]; r[i] = 3; out.push(['p' + i, r, '']); }
  out.push(['all', [3, 3, 3], '']);
  for (let i = 0; i < P.length; i++) if (P[i].form) { const r = [0, 0, 0]; r[i] = 3; out.push(['f' + i, r, P[i].form]); }
  (root.hybrids || []).forEach((h, j) => { const r = [0, 0, 0]; r[h.need[0]] = 3; r[h.need[1]] = 3; out.push(['h' + j, r, h.form]); });
  for (let i = 0; i < P.length; i++) if (P[i].form) out.push(['F' + i, [3, 3, 3], P[i].form]);
  (root.hybrids || []).forEach((h, j) => out.push(['H' + j, [3, 3, 3], h.form]));
  return out;
};

const list = classes.length ? classes : ED.HERO_IDS;
console.log(`dps.js: ${T} s per scenario; crowd ${CROWD} skeletons at ${HPK}x HP; single = immortal skelknight at 50 px; Q cast on cooldown`);
for (const cls of list) {
  if (!ED.HEROES[cls]) { console.log('unknown hero ' + cls); continue; }
  console.log(`\n${cls} (${ED.HEROES[cls].sig})`);
  console.log('build  form            crowd wpn  crowd q  kills/s  single wpn  single q');
  for (const [name, ranks, form] of builds(cls)) {
    const c = run(cls, name, ranks, form, 'crowd'), s = run(cls, name, ranks, form, 'single');
    if (!c || !s) { console.log(`${name.padEnd(6)} ${String(form).padEnd(15)} (form not takeable)`); continue; }
    console.log(`${name.padEnd(6)} ${(form || '-').padEnd(15)} ${c.dps.toFixed(0).padStart(9)}  ${c.q.toFixed(0).padStart(7)}  ${c.kps.toFixed(1).padStart(7)}  ${s.dps.toFixed(0).padStart(10)}  ${s.q.toFixed(0).padStart(8)}`);
  }
}
