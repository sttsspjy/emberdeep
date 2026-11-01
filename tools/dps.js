// Weapon yardstick: damage per second of one weapon per build, on a crowd and on a single target (headless, deterministic, no passives, god mode, no Q casts).
// Usage: node tools/dps.js [cls ...] [--t 20] [--md]  (hero weapons; default every hero)
//        node tools/dps.js support [id ...] [--t 20] [--md]  (support weapons alone: knight stand-in with its hero weapon disabled, the support in slot 1; default every support)
// Builds (slot lifecycle, GAME-DESIGN §4): base (nothing); t5 (tune 5: damage 2, haste 2, area 1); p<i> (t5 + path i at rank 5); f<i><j> (p<i> + Form j of path i's list, refined twice).
// Party level per build (w.level; offers only, no weapon numbers): base 1, t5 6, p 15, f 25.
// crowd: 160 'skeleton' foes kept on the field (40-300 px around the hero, 3.4x base HP; a minute-10 foe has 2.1x); dps = damage dealt / s, kps = kills / s.
// single: one knockback-immune 'skelknight' (r 12) with near-infinite HP 50 px to the right of the hero; dps on it. Aim point = nearest foe.
// boss: the same target as a boss body (boss flag: no execute, stun, freeze or displacement) at r 24, 60 px to the right; dps on it (big-body multi-hit check).
// Hero runs end with the role check on f rows (GAME-DESIGN §4): kind 360 (OMNI, every Bell Form) vs dir; 360 crowd <= 0.6 x the hero's dir mean (Bell: the cross-hero dir mean);
// dir single >= 2 x the hero's best 360 single; each kind within ±25% of the hero's kind mean. Boss check over every hero run: a p row whose boss dps > 1.6 x the cross-hero
// mean of p rows, or a directional f row whose boss dps > 1.6 x the cross-hero mean of directional f rows (360 Forms are Garlic-tier by rule), is flagged. --md prints table rows as Markdown.
'use strict';
const { load } = require('./sim.js');
const ED = load(), U = ED.U;
const args = process.argv.slice(2), T = +(args[args.indexOf('--t') + 1] || 0) || 20, MD = args.includes('--md');
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--t');
const SUPPORT = names[0] === 'support';
if (SUPPORT) names.shift();
const CROWD = 160, HPK = 3.4;
const OMNI = new Set(['whirlwind', 'earthsplitter', 'tempest', 'halo', 'jray', 'bonestorm']); // 360° hero Forms besides Bell's
const kindOf = (fid) => (OMNI.has(fid) || ED.weaponRoot(fid) === ED.HEROES.bell.sig ? '360' : 'dir');

const world = (cls) => {
  const w = new ED.World({ seed: 7, stage: 0, players: [{ pid: 'p1', name: 'D', slot: 0, cls, meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of w.sdef.timeline) { row.rate = 0; row.floor = 0; }
  w.sp.swarmT = w.sp.eliteT = w.sp.flockT = Infinity; w.sdef = Object.assign({}, w.sdef, { bosses: [], bench: null });
  return w;
};
const TUNE5 = [0, 1, 2, 0, 1]; // t5 kinds: damage 2, haste 2, area 1
// Build b = { tune, path, form } on the measured slot (sup: support id added to slot 1). Returns the slot index or -1 when a step is refused.
const apply = (w, p, sup, b) => {
  let i = 0;
  if (sup) {
    if (!w.addWeapon(p, sup)) return -1;
    i = p.weapons.length - 1;
  }
  const ws = p.weapons[i];
  for (let k = 0; k < b.tune; k++) if (!w.tuneSlot(p, ws, TUNE5[k])) return -1;
  if (b.path >= 0) { if (!w.pickPath(p, ws, b.path)) return -1; while (w.rankPath(p, ws, b.path)); }
  if (b.form) { if (!w.formsReady(p, ws).some(f => f.id === b.form) || !w.takeForm(p, ws, b.form)) return -1; while (w.refineForm(p, ws)); }
  w.recalc(p, false);
  return i;
};
// Damage of p from every source except its Q skill (and, with sup, except the hero weapon slot 0).
const dealt = (p, skip) => { let s = 0; for (const k in p.dealt) if (skip.indexOf(k) < 0) s += p.dealt[k]; return s; };
const aim = (w, p) => { const e = w.nearestFoe(p.x, p.y, 300); p.in.ax = e ? e.x : p.x + 60; p.in.ay = e ? e.y : p.y; p.in.q = false; };
const LEVEL = { b: 1, t: 6, p: 15, f: 25 };
const run = (cls, sup, b, mode) => {
  const w = world(cls), p = w.heroes[0];
  w.level = LEVEL[b.name[0]] || 1; w.addXp = () => {}; // fixed build and level: no level-ups during the scenario
  const si = apply(w, p, sup, b);
  if (si < 0) return null;
  const skip = [ED.HEROES[cls].skills[0]];
  if (sup) for (const id of ED.WEAPON_IDS) if (ED.weaponRoot(id) === ED.HEROES[cls].sig) skip.push(id);
  const rng = U.RNG(3);
  let boss = null;
  const top = () => {
    if (mode !== 'crowd') {
      const big = mode === 'boss', dx = big ? 60 : 50;
      if (!boss || boss.dead) { boss = w.spawnFoe('skelknight', p.x + dx, p.y, { hpMul: 1e6 }); if (big) { boss.r = 24; boss.scale = 2; boss.boss = true; } }
      boss.x = p.x + dx; boss.y = p.y; return;
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
  const out = [{ name: 'base', tune: 0, path: -1, form: '' }, { name: 't5', tune: 5, path: -1, form: '' }];
  (root.paths || []).forEach((pa, i) => out.push({ name: 'p' + i, tune: 5, path: i, form: '' }));
  (root.paths || []).forEach((pa, i) => ED.pathForms(root.id, i).forEach((fid, j) => out.push({ name: 'f' + i + j, tune: 5, path: i, form: fid })));
  return out;
};
const n0 = (v) => Math.round(v).toLocaleString('en-US');
// Prints the table of one weapon; returns its rows [{ name, form, kind, crowd, kps, single, boss }].
const table = (cls, sup, root) => {
  const rows = [];
  if (MD) console.log('| build | form | kind | crowd wpn | kills/s | single wpn | boss wpn |\n|---|---|---|---|---|---|---|');
  else console.log('build  form            kind  crowd wpn  kills/s  single wpn  boss wpn');
  for (const b of builds(root)) {
    const c = run(cls, sup, b, 'crowd'), s = run(cls, sup, b, 'single'), g = run(cls, sup, b, 'boss'), kind = b.form && !sup ? kindOf(b.form) : '';
    if (!c || !s || !g) { console.log(`${b.name.padEnd(6)} ${String(b.form || '-').padEnd(15)} (not takeable)`); continue; }
    rows.push({ name: b.name, form: b.form, kind, crowd: c.dps, kps: c.kps, single: s.dps, boss: g.dps });
    if (MD) console.log(`| ${b.name} | ${b.form || '-'} | ${kind === '360' ? '360°' : kind} | ${n0(c.dps)} | ${c.kps.toFixed(1)} | ${n0(s.dps)} | ${n0(g.dps)} |`);
    else console.log(`${b.name.padEnd(6)} ${(b.form || '-').padEnd(15)} ${kind.padEnd(4)} ${c.dps.toFixed(0).padStart(9)}  ${c.kps.toFixed(1).padStart(7)}  ${s.dps.toFixed(0).padStart(10)}  ${g.dps.toFixed(0).padStart(8)}`);
  }
  return rows;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
// Role check over f rows of every hero run (R: { cls: rows }); prints one line per hero and every flagged Form.
const roleCheck = (R) => {
  const all = [];
  for (const cls in R) for (const r of R[cls]) if (r.form && r.kind === 'dir') all.push(r.crowd);
  const cross = mean(all);
  console.log(`\nrole check (f rows; cross-hero dir crowd mean ${n0(cross)})`);
  for (const cls in R) {
    const F = {}; // one entry per Form id (first row)
    for (const r of R[cls]) if (r.form && !F[r.form]) F[r.form] = r;
    const fs = Object.values(F), dir = fs.filter(r => r.kind === 'dir'), omni = fs.filter(r => r.kind === '360');
    const dm = mean(dir.map(r => r.crowd)), om = mean(omni.map(r => r.crowd)), ceil = 0.6 * (dir.length ? dm : cross), best = Math.max(0, ...omni.map(r => r.single));
    const flags = [];
    for (const r of omni) if (r.crowd > ceil) flags.push(`${r.form} 360 crowd ${n0(r.crowd)} > ${n0(ceil)}`);
    if (omni.length) for (const r of dir) if (r.single < 2 * best) flags.push(`${r.form} dir single ${n0(r.single)} < 2 x ${n0(best)}`);
    for (const [L, m, k] of [[dir, dm, 'dir'], [omni, om, '360']]) for (const r of L) if (L.length > 1 && Math.abs(r.crowd / m - 1) > 0.25) flags.push(`${r.form} ${k} crowd ${n0(r.crowd)} outside ±25% of ${n0(m)}`);
    console.log(`${cls.padEnd(7)} dir mean ${n0(dm)}  360 mean ${n0(om)}  360 ceiling ${n0(ceil)}  360 best single ${n0(best)}  ${flags.length ? 'FLAGS: ' + flags.join('; ') : 'ok'}`);
  }
  // boss check: p rows / directional f rows against 1.6 x the cross-hero boss dps mean of their class
  for (const k of ['p', 'f']) {
    const rs = []; for (const cls in R) for (const r of R[cls]) if (r.name[0] === k && r.kind !== '360') rs.push([cls, r]);
    const m = mean(rs.map(x => x[1].boss)), cap = 1.6 * m, top = {};
    for (const [cls, r] of rs) if (!top[cls] || r.boss > top[cls].boss) top[cls] = r;
    const over = rs.filter(x => x[1].boss > cap).map(x => `${x[0]} ${x[1].form || x[1].name} ${n0(x[1].boss)}`);
    console.log(`boss ${k === 'p' ? 'p' : 'dir f'} rows: cross-hero mean ${n0(m)}, cap 1.6x ${n0(cap)}; best per hero ${Object.keys(top).map(c => c + ' ' + n0(top[c].boss)).join(', ')}  ${over.length ? 'FLAGS: ' + over.join('; ') : 'ok'}`);
  }
};

console.log(`dps.js: ${T} s per scenario; crowd ${CROWD} skeletons at ${HPK}x HP; single = immortal skelknight (r 12) at 50 px; boss = immortal boss body (r 24) at 60 px; no Q casts`);
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
  const R = {};
  for (const cls of names.length ? names : ED.HERO_IDS) {
    if (!ED.HEROES[cls]) { console.log('unknown hero ' + cls); continue; }
    console.log(`\n${cls} (${ED.HEROES[cls].sig})`);
    R[cls] = table(cls, '', ED.WEAPONS[ED.HEROES[cls].sig]);
  }
  roleCheck(R);
}
