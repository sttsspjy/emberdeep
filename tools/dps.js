// Weapon yardstick: damage per second of one weapon per build, on a crowd and on a single target (headless, deterministic, no passives, god mode, no Q casts).
// Usage: node tools/dps.js [cls ...] [--t 20]  (hero weapons; default every hero)
//        node tools/dps.js support [id ...] [--t 20]  (support weapons alone: knight stand-in with its hero weapon disabled, the support in slot 1; default every support)
// Builds: base (no ranks), p0 / p1 / p2 (that path at rank 3), all (every path at rank 3), f0 / f1 / f2 / h0 / h1 (path i at rank 3, or both hybrid paths, + its Form refined twice),
// F0.. (all 9 ranks + that Form refined twice; supports: one F row per Form id). Forms missing from the def are skipped.
// crowd: 160 'skeleton' foes kept on the field (40-300 px around the hero, HP of minute 10 = 3.4x base); dps = damage dealt / s, kps = kills / s.
// single: one knockback-immune 'skelknight' with near-infinite HP 50 px to the right of the hero; dps on it. Aim point = nearest foe. Party level per build: base 1, p* 8, all 15, f*/h* 15, F*/H* 30.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U;
const args = process.argv.slice(2), T = +(args[args.indexOf('--t') + 1] || 0) || 20;
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--t');
const SUPPORT = names[0] === 'support';
if (SUPPORT) names.shift();
const CROWD = 160, HPK = 3.4;

const world = (cls) => {
  const w = new ED.World({ seed: 7, stage: 0, players: [{ pid: 'p1', name: 'D', slot: 0, cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of w.sdef.timeline) { row.rate = 0; row.floor = 0; }
  w.sp.swarmT = w.sp.eliteT = Infinity; w.sdef = Object.assign({}, w.sdef, { bosses: [], bench: null });
  return w;
};
// Build: ranks per path [a, b, c] and the Form id to take (refined fully) or ''. Returns the measured slot index or -1.
const apply = (w, p, sup, ranks, form) => {
  let i = 0;
  if (sup) {
    if (ED.MAX_WEAPONS < 2) ED.MAX_WEAPONS = 2;
    if (!w.addWeapon(p, sup)) return -1;
    i = p.weapons.length - 1;
  }
  const ws = p.weapons[i];
  for (let k = 0; k < 3; k++) for (let r = 0; r < ranks[k]; r++) w.rankPath(p, ws, k);
  if (form) { if (!w.takeForm(p, ws, form)) return -1; while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return i;
};
// Damage of p from every source except its Q skill (and, with sup, except the hero weapon slot 0).
const dealt = (p, skip) => { let s = 0; for (const k in p.dealt) if (skip.indexOf(k) < 0) s += p.dealt[k]; return s; };
const aim = (w, p) => { const e = w.nearestFoe(p.x, p.y, 300); p.in.ax = e ? e.x : p.x + 60; p.in.ay = e ? e.y : p.y; p.in.q = false; };
const LEVEL = { b: 1, p: 8, a: 15, f: 15, h: 15, F: 30, H: 30 };
const run = (cls, sup, name, ranks, form, mode) => {
  const w = world(cls), p = w.heroes[0];
  w.level = LEVEL[name[0]] || 1; w.addXp = () => {}; // fixed build and level: no level-ups during the scenario
  const si = apply(w, p, sup, ranks, form);
  if (si < 0) return null;
  const skip = [ED.HEROES[cls].skills[0]];
  if (sup) for (const id of ED.WEAPON_IDS) if (ED.weaponRoot(id) === ED.HEROES[cls].sig) skip.push(id);
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
  for (let t = 0; t < T; t += ED.CONST.TICK) {
    top(); p.in.mx = 0; p.in.my = 0; aim(w, p);
    if (sup) p.weapons[0].cd = 1e9; // hero weapon disabled: the support is measured alone
    w.update(ED.CONST.TICK);
  }
  return { dps: dealt(p, skip) / T, kps: (w.kills - k0) / T };
};

const builds = (root) => {
  const P = root.paths || [], out = [['base', [0, 0, 0], '']], seen = {};
  for (let i = 0; i < P.length; i++) { const r = [0, 0, 0]; r[i] = 3; out.push(['p' + i, r, '']); }
  out.push(['all', [3, 3, 3], '']);
  for (let i = 0; i < P.length; i++) if (P[i].form) { const r = [0, 0, 0]; r[i] = 3; out.push(['f' + i, r, P[i].form]); }
  (root.hybrids || []).forEach((h, j) => { const r = [0, 0, 0]; r[h.need[0]] = 3; r[h.need[1]] = 3; out.push(['h' + j, r, h.form]); });
  for (let i = 0; i < P.length; i++) if (P[i].form && !seen[P[i].form]) { seen[P[i].form] = 1; out.push(['F' + i, [3, 3, 3], P[i].form]); }
  (root.hybrids || []).forEach((h, j) => out.push(['H' + j, [3, 3, 3], h.form]));
  return out;
};
const table = (cls, sup, root) => {
  console.log('build  form            crowd wpn  kills/s  single wpn');
  for (const [name, ranks, form] of builds(root)) {
    const c = run(cls, sup, name, ranks, form, 'crowd'), s = run(cls, sup, name, ranks, form, 'single');
    if (!c || !s) { console.log(`${name.padEnd(6)} ${String(form || '-').padEnd(15)} (not takeable)`); continue; }
    console.log(`${name.padEnd(6)} ${(form || '-').padEnd(15)} ${c.dps.toFixed(0).padStart(9)}  ${c.kps.toFixed(1).padStart(7)}  ${s.dps.toFixed(0).padStart(10)}`);
  }
};

console.log(`dps.js: ${T} s per scenario; crowd ${CROWD} skeletons at ${HPK}x HP; single = immortal skelknight at 50 px; no Q casts`);
if (SUPPORT) {
  const all = ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].form);
  if (!all.length) console.log('\nno support weapons registered (support: true defs)');
  for (const id of names.length ? names : all) {
    const d = ED.WEAPONS[id];
    if (!d || !d.support || d.form) { console.log('\nunknown support ' + id); continue; }
    console.log(`\n${id} (support, ${d.role || '?'}; knight stand-in, hero weapon off)`);
    table('knight', id, d);
  }
} else {
  for (const cls of names.length ? names : ED.HERO_IDS) {
    if (!ED.HEROES[cls]) { console.log('unknown hero ' + cls); continue; }
    console.log(`\n${cls} (${ED.HEROES[cls].sig})`);
    table(cls, '', ED.WEAPONS[ED.HEROES[cls].sig]);
  }
}
