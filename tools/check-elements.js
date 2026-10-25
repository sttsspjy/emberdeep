// Usage: node tools/check-elements.js
// Headless checks of the element path rules against docs/GAME-DESIGN.md sections 2-3 in staged worlds: one staged test per card rule (Brushfire, Firebreak, Cinder Arms, Glacier, Shatter, Lingering Rime, Glacial Arms,
// Conduction, Storm Anchor, Capacitor, Tempest Arms, Neurotoxin, Hex the Strong, Lingering Venom, Venomous Arms, Martyr's Rebuke, Vigil, Hallowed Arms, Reaper's Chain, Quarry, Umbral Step, Umbral Arms),
// the Attunement conditionals, the duo rules, every Mutation and its sibling lockout, the solids rule (foes and their shots only), the fodder rules and the cost of fire pathing and solids at 200 foes.
// Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const C = ED.CONST, U = ED.U, T = ED.TILE || 32;

// A hero of cls (plus allies of o.allies classes) in a quiet start room: no crit or dodge, every affinity x1. s.log holds every hit { e, d, src }, s.evs the events.
function stage(cls, boons, o) {
  o = o || {};
  const classes = [cls].concat(o.allies || []);
  const w = new ED.World({ seed: o.seed || 7, pact: 0, players: classes.map((c, i) => ({ pid: 'p' + i, name: 'T' + i, slot: i, cls: c, weapon: ED.CLASSES[c].weapons[o.wi || 0], meta: META() })) });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  for (const q of w.players.values()) { w.recalc(q, true); q.offers.length = 0; q.picks = 0; q.offer = null; q.stats.crit = 0; q.stats.dodge = 0; }
  w.enemies.length = 0; w.enc = null; w.locked = false; w.msgs.length = 0; w.fx.length = 0; w.zones.length = 0; w.projs.length = 0;
  w.elemAff = () => 1; w.affC = () => 1;
  const log = [], evs = [], hit0 = w.hitEnemy;
  w.hitEnemy = function (e, base, src) { const d = hit0.call(this, e, base, src); log.push({ e, d, src: src || {} }); return d; };
  return { w, p, log, evs };
}
// A still foe (5000 HP unless hp given) that never attacks.
const foe = (w, x, y, o) => { o = o || {}; const e = w.spawnEnemy(o.type || 'skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.spawnT = 0; if (!o.keepHp) e.maxHp = e.hp = o.hp || 5000; return e; };
const run = (s, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { s.w.update(1 / 60); for (const ev of s.w.fx) s.evs.push(ev); s.w.fx.length = 0; if (f) f(i); } };
// Advances world time and runs the chain queue until it is empty (no foe or hero updates).
const chains = (w) => { for (let i = 0; i < 200 && w.chainQ.length; i++) { w.time += 1 / 60; w.updateChains(); } };
const dealt = (s, e) => s.log.filter(h => h.e === e).reduce((a, h) => a + h.d, 0);
const evOf = (s, t) => s.evs.concat(s.w.fx).filter(v => v.t === t);
const kill = (w, e, p, src) => w.hitEnemy(e, 1e9, Object.assign({ p, kind: 'explode', raw: true, noProc: true, crit: false, noGuard: true }, src));
const zonesOf = (w, kind) => w.zones.filter(z => z.kind === kind && !z.dead);
const rerank = (s, boons) => { for (const id in boons) s.p.boons[id] = boons[id]; s.w.recalc(s.p, true); s.p.stats.crit = 0; s.p.stats.dodge = 0; };

// ---------------- data: paths, retired cards, Mutations ----------------
{
  const RETIRED = ['searing', 'brittle', 'coldsnap', 'frostheart', 'thunderstep', 'stormcall', 'thundergauntlet', 'fester', 'noxiousstep', 'dawnstride', 'malice', 'souljar'];
  ok(RETIRED.every(id => ED.BOONS[id] && ED.BOONS[id].retired), 'the merged and dash cards stay defined, flagged retired');
  ok(!ED.BOONS.thunderhead, 'Thunderhead is gone (Capacitor is the Lightning keystone)');
  for (const el of ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow']) {
    let r = 0, key = 0, evo = 0;
    for (const id in ED.BOONS) { const b = ED.BOONS[id]; if (b.path !== el || b.retired || b.duo || b.cls || b.asc || b.mut) continue; if (b.key) key++; else if (b.evo) evo++; else r += b.max || 1; }
    ok(r === 11 && key === 1 && evo === 1, `${el}: 11 ranks of path cards, one keystone, one evolution (got ${r}, ${key}, ${evo})`);
  }
  ok(ED.BOONS.capacitor.key && ED.BOONS.capacitor.path === 'lightning', 'Capacitor is the Lightning keystone');
  const tokens = [];
  for (const id in ED.BOONS) { const b = ED.BOONS[id]; if (!(b.path || b.duo || b.mut) || b.cls) continue; for (const m of (b.desc || '').matchAll(/\{(\w+)\}/g)) if (m[1] !== 'pw' && !(m[1] in (b.mods || {}))) tokens.push(id + ':' + m[1]); }
  ok(!tokens.length, `every {stat} token of a path, duo or Mutation card is in its mods (${tokens.join()})`);
  const parents = ['conflag', 'abszero', 'capacitor', 'pandemic', 'radiantaegis', 'reaper', 'masterstroke', 'evo_fire', 'evo_ice', 'evo_lightning', 'evo_poison', 'evo_holy', 'evo_shadow', 'evo_general'];
  ok(ED.MUT_IDS.length === 28 && parents.every(of => ED.mutsOf(of).length === 2), `28 Mutations, two per keystone and evolution (${ED.MUT_IDS.length})`);
  ok(ED.MUT_IDS.every(id => { const b = ED.BOONS[id]; return b.rar === 'm' && b.max === 1 && !b.path && ED.BOONS[b.mut] && Object.keys(b.mods).length; }), 'each Mutation: rarity m, max 1, no path, a rule stat');
  ok(ED.MUT_IDS.every(id => Object.keys(ED.BOONS[id].mods).every(k => typeof ED.Stats.compute({ cls: 'ranger', weapon: 'longbow', boons: {}, relics: [], meta: META(), pact: 0 })[k] === 'number')), 'every Mutation stat is in the stat block');
  ok(!ED.mutFree({}, 'mut_firestorm'), 'lockout: no Mutation without its parent');
  ok(ED.mutFree({ conflag: 1 }, 'mut_firestorm') && ED.mutFree({ conflag: 1 }, 'mut_scorchedearth'), 'the parent unlocks both Mutations');
  ok(!ED.mutFree({ conflag: 1, mut_scorchedearth: 1 }, 'mut_firestorm') && !ED.mutFree({ conflag: 1, mut_firestorm: 1 }, 'mut_firestorm'), 'holding one Mutation locks out its sibling (and itself)');
  ok(ED.mutFree({ conflag: 1, mut_firestorm: 1, evo_fire: 1 }, 'mut_firewall'), 'a Mutation of another parent stays free');
}

// ---------------- Fire ----------------
{ // Brushfire: on the burn tick, touching foes that burn less catch 30% of the pool (capped at SPREAD_CAP of their HP and never above the source)
  const s = stage('pyro', { brushfire: 1 }), { w, p } = s;
  const a = foe(w, 300, 300), b = foe(w, 300 + a.r * 2 + 2, 300), c = foe(w, 300, 420), f = foe(w, 300 - a.r * 2 - 2, 300, { hp: 40 });
  a.burnPool = 100; a.burnTick = 0.01; a.burnOwner = p;
  w.tickStatuses(a, 0.02);
  near(b.burnPool, 0.3 * 80, 1e-6, 'Brushfire: a touching foe catches 30% of the pool left after the tick');
  ok(b.burnOwner === p && b.burn === 1, 'the spread Burn is the hero\'s');
  ok(c.burnPool === 0, 'Brushfire: a foe not touching catches nothing');
  near(f.burnPool, C.SPREAD_CAP * 40, 1e-6, 'Brushfire: capped at SPREAD_CAP of the receiver\'s HP (fodder rule)');
  a.burnPool = 100; a.burnTick = 0.01; b.burnPool = 75; w.tickStatuses(a, 0.02);
  near(b.burnPool, 80, 1e-6, 'Brushfire never lifts a foe above the source pool');
  const s0 = stage('pyro', {}), a0 = foe(s0.w, 300, 300), b0 = foe(s0.w, 300 + a0.r * 2 + 2, 300);
  a0.burnPool = 100; a0.burnTick = 0.01; a0.burnOwner = s0.p; s0.w.tickStatuses(a0, 0.02);
  ok(b0.burnPool === 0, 'no spread without Brushfire');
}
{ // Firebreak: a burning death leaves burning ground that blocks the paths of foes (at most FIREBREAK_MAX per hero)
  const s = stage('pyro', { firebreak: 1 }), { w, p } = s;
  const e = foe(w, p.x + 120, p.y); e.burnPool = 50; e.burnOwner = p;
  kill(w, e, p);
  const z = zonesOf(w, 'firebreak');
  ok(z.length === 1 && z[0].block === 1 && z[0].r === C.FIREBREAK_R && z[0].dur === C.FIREBREAK_T && z[0].owner === p.pid, 'Firebreak: a burning death leaves blocking ground (r 34, 3 s)');
  near(z[0].dps, ED.procDmg(ED.BOONS.firebreak, p.stats), 1e-9, 'Firebreak ground burns for the card\'s proc damage per second');
  const v = foe(w, z[0].x, z[0].y); run(s, 1.05);
  ok(dealt(s, v) > 0 && s.log.some(h => h.e === v && h.src.el === 'fire'), 'a foe on the ground takes Fire damage');
  for (let i = 0; i < 8; i++) { const k = foe(w, 100 + i * 40, 200); k.burnPool = 10; k.burnOwner = p; kill(w, k, p); }
  ok(zonesOf(w, 'firebreak').length === C.FIREBREAK_MAX, `at most ${C.FIREBREAK_MAX} Firebreak grounds per hero`);
  const s0 = stage('pyro', {}), e0 = foe(s0.w, s0.p.x + 120, s0.p.y); e0.burnPool = 50; e0.burnOwner = s0.p; kill(s0.w, e0, s0.p);
  ok(!zonesOf(s0.w, 'firebreak').length, 'no ground without Firebreak');
}
{ // Firebreak pathing: a non-elite ground foe walks around the fire (and out of it), an elite walks straight through
  const s = stage('pyro', { firebreak: 1 }), { w, p } = s, room = w.room;
  let ex = -1;
  for (let dx = 200; dx >= 140; dx -= 20) if (ED.Sim.los(room, p.x, p.y, p.x + dx, p.y, false) && ED.Sim.los(room, p.x, p.y - 60, p.x + dx, p.y - 60, false) && ED.Sim.los(room, p.x, p.y + 60, p.x + dx, p.y + 60, false)) { ex = dx; break; }
  ok(ex > 0, 'pathing stage: an open lane beside the hero');
  w.fireGround(p, p.x + ex / 2, p.y, 40, 30, 1);
  w.computeFlow();
  ok(!!w.flowM, 'blocking ground builds the masked field');
  const e = foe(w, p.x + ex, p.y), el = foe(w, p.x + ex, p.y, { elite: true, affix: 'swift' });
  const d = w.pathDir(e, p.x, p.y), de = w.pathDir(el, p.x, p.y);
  ok(de[0] < -0.99, `an elite walks straight through the fire (${de.map(v => v.toFixed(2))})`);
  ok(d[0] > -0.99, `a foe does not walk straight into the fire (${d.map(v => v.toFixed(2))})`);
  const m = w.fireMask, tile = (x, y) => m[Math.floor(y / T) * room.w + Math.floor(x / T)];
  const g = foe(w, p.x + ex / 2, p.y);
  let out = false;
  for (let i = 0; i < 60 && !out; i++) { const v = w.pathDir(g, p.x, p.y); g.x += v[0] * 4; g.y += v[1] * 4; out = !tile(g.x, g.y); }
  ok(out, 'a foe standing in the fire walks out of it');
  w.zones.length = 0; w.computeFlow();
  ok(w.flowM === null, 'no blocking ground: no masked field');
  const d2 = w.pathDir(e, p.x, p.y);
  ok(d2[0] < -0.99, 'the fire gone, the foe walks straight again');
}
{ // Cinder Arms: shots scorch their line, swings their arc band, shells their landing circle (CINDER_T s, CINDER_DPS x weapon per second, at most CINDER_MAX)
  const s = stage('ranger', { evo_fire: 1 }), { w, p } = s;
  w.playerAttack(p, 0);
  const z = zonesOf(w, 'cinder');
  ok(z.length === 1 && z[0].len > 0 && z[0].w === C.CINDER_W && z[0].dur === C.CINDER_T && !z[0].block, 'Cinder Arms: a shot scorches its line (16 wide, 2 s)');
  near(z[0].dps, p.stats.weapon.dmg * C.CINDER_DPS, 1e-9, 'scorched ground burns for 25% of the weapon per second');
  const e = foe(w, p.x + Math.min(60, z[0].len - 10), p.y + 30), on = foe(w, p.x + z[0].len * 0.5, p.y);
  ok(w.zoneHas(z[0], on) && !w.zoneHas(z[0], e), 'zoneHas: a foe on the line stands in it, one 30 px aside does not');
  w.projs.length = 0;
  for (let i = 0; i < 12; i++) w.playerAttack(p, i * 0.3);
  ok(zonesOf(w, 'cinder').length === C.CINDER_MAX, `at most ${C.CINDER_MAX} scorched grounds per hero`);
  const k = stage('knight', { evo_fire: 1 }); k.w.playerAttack(k.p, 0);
  const zk = zonesOf(k.w, 'cinder')[0];
  ok(zk && zk.arc > 0 && zk.w > 0 && zk.r > 0 && !zk.len, 'Cinder Arms: a swing scorches its arc band');
  ok(!!zk && !evOf(k, 'boom').length, 'Cinder Arms adds no explosion to the swing');
  const sh = stage('ranger', { evo_fire: 1 }); sh.p.stats.weapon = Object.assign({}, sh.p.stats.weapon, { lob: { t: 0.5 }, explode: { r: 40, mul: 1 } });
  sh.w.playerAttack(sh.p, 0); run(sh, 0.6);
  const zl = zonesOf(sh.w, 'cinder')[0];
  ok(zl && zl.r === 40 && !zl.len && !zl.arc, 'Cinder Arms: a shell scorches its landing circle');
  const n0 = stage('ranger', {}); n0.w.playerAttack(n0.p, 0);
  ok(!zonesOf(n0.w, 'cinder').length && n0.w.projs.every(q => !q.explode), 'no scorch and no blast without Cinder Arms');
}
{ // Mutations of Cinder Arms: Firewall (4 s, blocks), Ember Wake (steps scorch, attacks do not)
  const s = stage('ranger', { evo_fire: 1, mut_firewall: 1 }); s.w.playerAttack(s.p, 0);
  const z = zonesOf(s.w, 'cinder')[0];
  ok(z && z.dur === 4 && z.block === 1, 'Firewall: scorched ground lasts 4 s and blocks foe paths');
  const e = stage('ranger', { evo_fire: 1, mut_emberwake: 1 }); e.w.playerAttack(e.p, 0);
  ok(!zonesOf(e.w, 'cinder').length, 'Ember Wake: attacks do not scorch');
  e.p.lvx = 200; e.p.lvy = 0; e.w.updatePlayerCombat(e.p, 1 / 60);
  const zw = zonesOf(e.w, 'cinder')[0];
  ok(zw && zw.r === 24 && !zw.len, 'Ember Wake: walking leaves scorched ground (r 24)');
  e.w.updatePlayerCombat(e.p, 1 / 60);
  ok(zonesOf(e.w, 'cinder').length === 1, 'Ember Wake scorches every 0.15 s');
  e.p.lvx = 0; e.p.walkT = 0; e.w.updatePlayerCombat(e.p, 1 / 60);
  ok(zonesOf(e.w, 'cinder').length === 1, 'standing still leaves nothing');
}
{ // Conflagration Mutations: Firestorm (neighbours catch Burn, no splash damage), Scorched Earth (blocking ground)
  const s = stage('pyro', { conflag: 1, mut_firestorm: 1 }), { w, p } = s;
  const e = foe(w, 300, 300, { hp: 300 }), o = foe(w, 340, 300);
  e.hpLever = 1; e.burnPool = 100; e.burnOwner = p;
  w.checkCombust(e, p);
  ok(dealt(s, o) === 0, 'Firestorm: the neighbour takes no splash damage');
  chains(w);
  near(o.burnPool, 100 * C.SPLASH_MUL, 1e-6, 'Firestorm: the neighbour catches 60% of the pool as Burn');
  const g = stage('pyro', { conflag: 1, mut_scorchedearth: 1 }), e2 = foe(g.w, 300, 300, { hp: 300 }); e2.hpLever = 1; e2.burnPool = 100; e2.burnOwner = g.p;
  g.w.checkCombust(e2, g.p);
  const z = zonesOf(g.w, 'firebreak')[0];
  ok(z && z.r === 70 && z.dur === 3 && z.block === 1 && Math.abs(z.dps - 15) < 1e-6, 'Scorched Earth: the combustion leaves blocking ground (r 70, 3 s, 15% of the pool per second)');
  const b = stage('pyro', { conflag: 1 }), e3 = foe(b.w, 300, 300, { hp: 300 }), o3 = foe(b.w, 340, 300); e3.hpLever = 1; e3.burnPool = 100; e3.burnOwner = b.p;
  b.w.checkCombust(e3, b.p);
  ok(dealt(b, o3) > 0 && !zonesOf(b.w, 'firebreak').length, 'plain Conflagration still splashes damage and leaves no ground');
}

// ---------------- Ice ----------------
{ // Glacier: a frozen foe is solid: it never moves in separation, foe shots stop on it, heroes and hero shots pass
  const s = stage('ranger', { glacier: 1 }), { w, p } = s;
  const a = foe(w, p.x + 120, p.y), b = foe(w, p.x + 124, p.y);
  a.spd = b.spd = 50;
  w.freezeEnemy(a, p);
  ok(a.glacier === true, 'Glacier: a frozen foe is solid');
  const ax = a.x, bx = b.x;
  w.separate();
  ok(a.x === ax && b.x !== bx, 'separation moves the other foe, never the frozen one');
  ok(w.solidOn === true, 'a solid stands: foe shots test solids');
  const sh = foe(w, p.x + 200, p.y);
  w.enemyShoot(sh, Math.PI, 300, 'arrow', 1);
  const hp0 = p.hp; for (let i = 0; i < 60; i++) { w.updateProjectiles(1 / 60); w.separate(); }
  ok(p.hp === hp0 && !w.projs.some(q => q.team === 1), 'a foe shot stops on the frozen foe');
  w.spawnProj({ team: 0, kind: 'arrow', x: p.x + 10, y: p.y, a: 0, speed: 400, dmg: 10, life: 1, pierce: 0, owner: p.pid, wpn: true });
  const da = dealt(s, a); for (let i = 0; i < 30; i++) w.updateProjectiles(1 / 60);
  ok(dealt(s, a) > da, 'a hero shot strikes the frozen foe as any foe');
  a.frozen = 0.01; w.tickStatuses(a, 0.02);
  ok(a.glacier === false, 'thawed: no longer solid');
  const s0 = stage('ranger', {}), f0 = foe(s0.w, 300, 300); s0.w.freezeEnemy(f0, s0.p);
  ok(!f0.glacier, 'no solid without Glacier');
}
{ // Shatter: only a skill hit on a frozen foe shatters it (x(1 + shatter), an ice burst of the full hit within 90)
  const s = stage('ranger', { shatter: 1 }), { w, p } = s;
  const e = foe(w, 300, 300), o = foe(w, 360, 300);
  w.freezeEnemy(e, p);
  w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false });
  ok(e.frozen > 0 && dealt(s, o) === 0, 'a weapon hit does not shatter');
  s.log.length = 0;
  const d = w.hitEnemy(e, 100, { p, kind: 'skill', crit: false });
  near(d, 100 * p.stats.dmg * 1.6 * 1.25, 1e-6, 'a skill hit on a frozen foe deals x1.6 (and the frozen x1.25)');
  ok(e.frozen === 0 && evOf(s, 'shatter').length === 1, 'the skill hit ends the freeze with a shatter event');
  ok(dealt(s, o) > 0 && s.log.some(h => h.e === o && h.src.el === 'ice'), 'the burst strikes a foe within 90 as Ice');
}
{ // Lingering Rime: a thawing foe keeps 25% chill per rank
  const s = stage('ranger', { rime: 2 }), e = foe(s.w, 300, 300);
  s.w.freezeEnemy(e, s.p); e.frozen = 0.01; s.w.tickStatuses(e, 0.02);
  near(e.chill, 50, 1e-9, 'Lingering Rime rank 2: thaw leaves 50 chill');
}
{ // Glacial Arms: a frozen foe's death raises a solid pillar (4 s, at most 6); a skill hit beside it shatters it for 15% of the dead foe's HP (elites 7.5%) to foes within 80
  const s = stage('ranger', { evo_ice: 1 }), { w, p } = s;
  const e = foe(w, 300, 300, { hp: 1000 }), o = foe(w, 360, 300);
  w.freezeEnemy(e, p); kill(w, e, p);
  const z = zonesOf(w, 'pillar')[0];
  ok(z && z.solid && z.r === C.PILLAR_R && z.dur === C.PILLAR_T, 'Glacial Arms: a frozen death leaves a solid ice pillar');
  near(z.amt, 1000 * C.PILLAR_HP, 1e-9, 'its burst is worth 15% of the dead foe\'s HP');
  w.hitEnemy(o, 10, { p, kind: 'weapon', crit: false });
  ok(!z.dead, 'a weapon hit beside it does not shatter it');
  const t = foe(w, z.x + 30, z.y); s.log.length = 0;
  w.hitEnemy(t, 10, { p, kind: 'skill', crit: false });
  ok(z.dead, 'a skill hit beside it shatters it');
  chains(w);
  ok(s.log.some(h => h.e === o && h.src.el === 'ice' && Math.abs(h.d - 150) < 1e-6), 'the burst deals 150 Ice to a foe within 80');
  const el = foe(w, 300, 300, { elite: true, affix: 'swift', hp: 1000 }); w.freezeEnemy(el, p); kill(w, el, p);
  near(zonesOf(w, 'pillar').slice(-1)[0].amt, 1000 * C.PILLAR_HP * 0.5, 1e-9, 'an elite\'s pillar is worth half');
  for (let i = 0; i < 8; i++) { const k = foe(w, 100 + i * 50, 450); w.freezeEnemy(k, p); kill(w, k, p); }
  ok(zonesOf(w, 'pillar').length === C.PILLAR_MAX, `at most ${C.PILLAR_MAX} pillars per hero`);
  const s2 = stage('ranger', {}), f = foe(s2.w, 300, 300, { hp: 1000 }); s2.w.freezeEnemy(f, s2.p); kill(s2.w, f, s2.p);
  ok(!zonesOf(s2.w, 'pillar').length, 'no pillar without Glacial Arms');
  const s3 = stage('ranger', { evo_ice: 1 }, { allies: ['knight'] }), q = s3.w.players.get('p1'), f3 = foe(s3.w, 300, 300, { hp: 1000 });
  s3.w.freezeEnemy(f3, s3.p); kill(s3.w, f3, q);
  ok(zonesOf(s3.w, 'pillar').length === 1 && zonesOf(s3.w, 'pillar')[0].owner === 'p0', 'a foe it froze raises its pillar whoever kills it');
}
{ // solids rule: a pillar pushes foes out (never bosses), stops foe shots, never moves heroes or stops hero shots
  const s = stage('ranger', { evo_ice: 1 }), { w, p } = s;
  const z = w.addPillar(p, p.x + 100, p.y, { maxHp: 100 });
  const e = foe(w, z.x + 2, z.y); e.spd = 50;
  w.separate();
  ok(Math.hypot(e.x - z.x, e.y - z.y) >= z.r + e.r * 0.9 - 1e-6, 'a pillar pushes a foe out of it');
  const bt = Object.keys(ED.ENEMIES).find(k => ED.ENEMIES[k].boss), bo = foe(w, z.x + 2, z.y, { type: bt, keepHp: true }); bo.spd = 50;
  const bx = bo.x; w.separate();
  ok(bo.x === bx, 'a boss is never pushed');
  bo.hp = 0; w.enemies = w.enemies.filter(f => f.hp > 0);
  const hx = p.x, hy = p.y; p.x = z.x; p.y = z.y; w.separate();
  ok(p.x === z.x && p.y === z.y, 'a hero standing in a pillar is not moved');
  p.x = hx; p.y = hy;
  const sh = foe(w, z.x + 80, z.y); w.separate();
  w.enemyShoot(sh, Math.PI, 300, 'arrow', 1);
  const hp0 = p.hp; for (let i = 0; i < 60; i++) w.updateProjectiles(1 / 60);
  ok(p.hp === hp0 && !w.projs.some(q => q.team === 1), 'a foe shot stops on the pillar');
  w.enemies = [];
  const tgt = foe(w, z.x + 60, z.y);
  w.spawnProj({ team: 0, kind: 'arrow', x: p.x + 10, y: p.y, a: 0, speed: 400, dmg: 10, life: 1, pierce: 0, owner: p.pid, wpn: true });
  for (let i = 0; i < 40; i++) w.updateProjectiles(1 / 60);
  ok(dealt(s, tgt) > 0, 'a hero shot flies through the pillar to the foe behind it');
}
{ // Absolute Zero Mutations: Rime Lattice (a 3 s pillar instead of the nova), Flash Freeze (the 2 nearest non-elite foes freeze, through the chain)
  const s = stage('ranger', { abszero: 1, mut_rimelattice: 1 }), { w, p } = s;
  const e = foe(w, 300, 300), o = foe(w, 360, 300);
  w.freezeEnemy(e, p);
  const z = zonesOf(w, 'pillar')[0];
  ok(z && z.solid && Math.abs(z.dur - C.PILLAR_T * 0.75) < 1e-9 && o.chill === 0, 'Rime Lattice: freezing raises a 3 s solid pillar and no nova');
  const f = stage('ranger', { abszero: 1, mut_flashfreeze: 1 });
  const a = foe(f.w, 300, 300), b = foe(f.w, 340, 300), c = foe(f.w, 300, 350), d = foe(f.w, 330, 330, { elite: true, affix: 'swift' }), far = foe(f.w, 500, 300);
  f.w.freezeEnemy(a, f.p); chains(f.w);
  ok(b.frozen > 0 && c.frozen > 0, 'Flash Freeze: the 2 nearest foes within 100 freeze');
  ok(!(d.frozen > 0) && d.chill === 0, 'Flash Freeze skips elites (and no chill nova)');
  ok(!(far.frozen > 0), 'a foe 200 away stays');
}
{ // Glacial Arms Mutations: Glacier Wall (8 s, the burst freezes), Frost Mine (not solid, a touch shatters it)
  const s = stage('ranger', { evo_ice: 1, mut_glacierwall: 1 }), { w, p } = s;
  const z = w.addPillar(p, 300, 300, { maxHp: 100 }), o = foe(w, 340, 300);
  ok(z.dur === C.PILLAR_T * 2, 'Glacier Wall: pillars stand 8 s');
  w.shatterPillar(z); chains(w);
  ok(o.frozen > 0, 'Glacier Wall: the burst freezes the foes it hits');
  const m = stage('ranger', { evo_ice: 1, mut_frostmine: 1 }), zm = m.w.addPillar(m.p, 300, 300, { maxHp: 100 });
  ok(!zm.solid, 'Frost Mine: pillars are not solid');
  const t = foe(m.w, 300 + zm.r + 8, 300);
  m.w.updateZones(1 / 60);
  ok(zm.dead, 'Frost Mine: a touching foe shatters it');
}

// ---------------- Lightning ----------------
{ // Storm Attunement: +ionize to charged foes
  const s = stage('ranger', { stormattune: 1 }), { w, p } = s, e = foe(w, 300, 300), c = foe(w, 360, 300);
  c.charge = 10; c.dischargeT = 9;
  const d0 = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false, noProc: true }), d1 = w.hitEnemy(c, 100, { p, kind: 'weapon', crit: false, noProc: true });
  near(d1 / d0, (p.stats.dmg + 0.1 * p.stats.dmgX) / p.stats.dmg, 1e-6, 'Storm Attunement: +10% to a charged foe');
}
{ // Conduction: a discharge deals +15% per other foe within 60 of the discharging foe (up to 5)
  const one = (k) => { const s = stage('ranger', { conduction: 1 }), e = foe(s.w, 300, 300); for (let i = 0; i < k; i++) foe(s.w, 300 + 30 * Math.cos(i), 300 + 30 * Math.sin(i)); e.charge = 100; s.w.discharge(e, s.p, 1); return dealt(s, e); };
  near(one(3) / one(0), 1.45, 1e-6, 'Conduction: three close foes, x1.45');
  near(one(7) / one(0), 1.75, 1e-6, 'Conduction: capped at five foes');
}
{ // Storm Anchor: each skill cast plants a solid anchor (4 s, at most 2) that zaps the nearest foe within 80 every 0.5 s; a discharge within 200 arcs to it and bursts there
  const s = stage('ranger', { stormanchor: 1 }), { w, p } = s;
  w.elementCast(p, 0);
  const z = zonesOf(w, 'anchor');
  ok(z.length === 1 && z[0].r === C.ANCHOR_REACH && z[0].sr === C.ANCHOR_R && z[0].solid && z[0].dur === C.ANCHOR_T, 'Storm Anchor: a cast plants a solid anchor (zap radius 80, solid 12, 4 s)');
  w.elementCast(p, 1); w.elementCast(p, 0);
  ok(zonesOf(w, 'anchor').length === C.ANCHOR_MAX, 'at most 2 anchors');
  w.zones.length = 0; w.elementCast(p, 0);
  const a = zonesOf(w, 'anchor')[0], e = foe(w, a.x + 50, a.y);
  for (let i = 0; i < 31; i++) w.updateZones(1 / 60);
  ok(s.log.some(h => h.e === e && h.src.el === 'lightning' && Math.abs(h.d - ED.procDmg(ED.BOONS.stormanchor, p.stats)) < 1e-6), 'the anchor zaps a foe within 80 for its proc damage');
  const c = foe(w, a.x + 150, a.y + 100), by = foe(w, a.x - 40, a.y - 30); c.charge = 50;
  s.log.length = 0; w.discharge(c, p, 1);
  ok(dealt(s, by) > 0, 'a discharge within 200 arcs to the anchor and bursts around it');
  const s0 = stage('ranger', {}); s0.w.elementCast(s0.p, 0);
  ok(!zonesOf(s0.w, 'anchor').length, 'no anchor without the card');
}
{ // Capacitor: the holder's charge never discharges on a timer; each skill cast detonates every foe it charged at x3 through the chain queue
  const s = stage('ranger', { capacitor: 1 }, { allies: ['ranger'] }), { w, p } = s, q = w.players.get('p1');
  const es = []; for (let i = 0; i < 9; i++) es.push(foe(w, 200 + i * 30, 300));
  for (const e of es) w.addCharge(e, 100, p);
  ok(es.every(e => e.dischargeT === Infinity), 'Capacitor: the holder\'s charge has no timer');
  for (let i = 0; i < 120; i++) for (const e of es) w.tickStatuses(e, 1 / 60);
  ok(es.every(e => e.charge === 100), 'no timed discharge after 2 s');
  const ally = foe(w, 300, 500); w.addCharge(ally, 100, q);
  ok(ally.dischargeT === 1, 'an ally\'s charge keeps its 1 s timer');
  w.elementCast(p, 0);
  ok(w.chainQ.filter(en => en.kind === 'detonate').length === 9, 'a cast queues a detonation per charged foe');
  w.time += C.CHAIN_HOP + 1e-6; w.updateChains();
  ok(es.filter(e => e.charge === 0).length === C.CHAIN_TICK, `detonations run CHAIN_TICK (${C.CHAIN_TICK}) a tick`);
  chains(w);
  ok(es.every(e => e.charge === 0) && ally.charge === 100, 'every charged foe of the holder detonated; the ally\'s waits');
  ok(evOf(s, 'detonate').length === 9 && evOf(s, 'detonate').every(v => v.pid === 'p0'), 'one detonate event per foe');
  const d1 = stage('ranger', { capacitor: 1 }), e1 = foe(d1.w, 300, 300); e1.charge = 100; e1.chargeOwner = d1.p; e1.dischargeT = Infinity;
  d1.w.elementCast(d1.p, 0); chains(d1.w);
  near(d1.log.find(h => h.e === e1).d, 300, 1e-6, 'a detonation discharges at x3');
  const e2 = foe(d1.w, 300, 300); d1.w.addCharge(e2, 50, d1.p);
  const nearest = foe(d1.w, d1.p.x + 5, d1.p.y + 400); d1.w.addCharge(nearest, 50, d1.p);
  d1.w.elementCast(d1.p, 0);
  ok(d1.w.chainQ[0].e === (U.dist2(e2.x, e2.y, d1.p.x, d1.p.y) < U.dist2(nearest.x, nearest.y, d1.p.x, d1.p.y) ? e2 : nearest), 'detonations queue nearest first');
  // Peal: the larger of x3 and the Peal's Resonance, never their product
  const pe = (res, slot) => { const b = stage('bell', { capacitor: 1 }), e = foe(b.w, 300, 300); e.charge = 100; e.chargeOwner = b.p; b.p.pealResLast = res; b.w.elementCast(b.p, slot); chains(b.w); return b.log.find(h => h.e === e).d; };
  near(pe(5, 1), 500, 1e-6, 'a Peal of Resonance x5 detonates at x5');
  near(pe(2, 1), 300, 1e-6, 'a Peal of Resonance x2 detonates at x3');
  near(pe(5, 0), 300, 1e-6, 'a Heave ignores the Peal\'s Resonance');
}
{ // Capacitor Mutations: Supercapacitor (x4, 30% less charge), Lightning Lattice (an anchor per cast; detonations arc to every anchor)
  const s = stage('ranger', { capacitor: 1, mut_supercapacitor: 1 }), e = foe(s.w, 300, 300);
  s.w.addCharge(e, 100, s.p);
  near(e.charge, 70, 1e-9, 'Supercapacitor: 30% less charge');
  s.w.elementCast(s.p, 0); chains(s.w);
  near(s.log.find(h => h.e === e).d, 280, 1e-6, 'Supercapacitor: detonates at x4');
  const l = stage('ranger', { capacitor: 1, mut_lattice: 1 }), { w, p } = l;
  w.elementCast(p, 0);
  const a = zonesOf(w, 'anchor')[0];
  ok(!!a, 'Lightning Lattice: a cast plants an anchor without the card');
  const c = foe(w, a.x + 600, a.y), by = foe(w, a.x + 30, a.y + 20);
  c.charge = 50; c.chargeOwner = p; c.dischargeT = Infinity;
  w.elementCast(p, 0); chains(w);
  ok(dealt(l, by) > 0, 'Lightning Lattice: a detonation arcs to an anchor 600 away');
  const n0 = stage('ranger', { stormanchor: 1 }), a0 = (n0.w.elementCast(n0.p, 0), zonesOf(n0.w, 'anchor')[0]), c0 = foe(n0.w, a0.x + 600, a0.y), b0 = foe(n0.w, a0.x + 30, a0.y + 20);
  c0.charge = 50; n0.w.discharge(c0, n0.p, 1);
  ok(dealt(n0, b0) === 0, 'without it an anchor 600 away takes no arc');
}
{ // Tempest Arms: the hero's charged foes form one nearest-neighbour chain (links within 120, up to 6); a foe crossing a link takes 50% of the weapon (once per 0.5 s)
  const s = stage('ranger', { evo_lightning: 1 }), { w, p } = s;
  const cs = [0, 1, 2].map(i => foe(w, p.x + 100 + i * 100, p.y)), far = foe(w, p.x + 450, p.y), mid = foe(w, p.x + 150, p.y + 2);
  for (const e of cs.concat(far)) { e.charge = 10; e.chargeOwner = p; e.dischargeT = 99; }
  far.x = p.x + 520;
  w.tethers(p);
  const ev = evOf(s, 'tether')[0];
  ok(ev && ev.pid === 'p0' && ev.pts.length === 6 && ev.pts[0] === Math.round(cs[0].x), 'Tempest Arms: one tether event, a chain of 3 foes from the one nearest the hero (the foe 220 away is not linked)');
  const h = s.log.find(x => x.e === mid);
  ok(h && Math.abs(h.d - p.stats.weapon.dmg * C.TETHER_MUL * p.stats.dmg) < 1e-6 && h.src.el === 'lightning', 'a foe crossing a link takes 50% of the weapon as Lightning');
  ok(!s.log.some(x => cs.includes(x.e)), 'the linked foes are not struck');
  s.log.length = 0; w.tethers(p);
  ok(!s.log.some(x => x.e === mid), 'once per 0.5 s per foe');
  const lw = stage('ranger', { evo_lightning: 1, mut_livewire: 1 }), e1 = foe(lw.w, lw.p.x + 80, lw.p.y), m1 = foe(lw.w, lw.p.x + 40, lw.p.y + 2);
  e1.charge = 10; e1.chargeOwner = lw.p; lw.w.tethers(lw.p);
  ok(dealt(lw, m1) > 0 && evOf(lw, 'tether')[0].pts[0] === Math.round(lw.p.x), 'Live Wire: the chain starts at the hero');
  const sn = stage('ranger', { evo_lightning: 1, mut_snareline: 1 }), a2 = foe(sn.w, sn.p.x + 100, sn.p.y), b2 = foe(sn.w, sn.p.x + 200, sn.p.y), m2 = foe(sn.w, sn.p.x + 150, sn.p.y + 2);
  for (const e of [a2, b2]) { e.charge = 10; e.chargeOwner = sn.p; }
  sn.w.tethers(sn.p);
  ok(m2.stun > 0 && dealt(sn, m2) === 0, 'Snare Line: a crossing foe is stunned, not struck');
}

// ---------------- Poison ----------------
{ // Neurotoxin: at full Venom a foe moves 25% slower and winds up 40% longer (bosses half)
  const s = stage('ranger', { neurotoxin: 1 }), e = foe(s.w, 300, 300);
  e.venom = 100; e.venomOwner = s.p; e.venomT = 5; s.w.tickStatuses(e, 1 / 60);
  near(e.slow, 0.75, 1e-9, 'Neurotoxin: x0.75 speed'); near(e.windMul, 1.4, 1e-9, 'Neurotoxin: x1.4 wind-up');
  e.venom = 90; s.w.tickStatuses(e, 1 / 60);
  ok(e.slow === 1 && e.windMul === 1, 'below full Venom: no effect');
}
{ // Hex the Strong: an elite at full Venom loses its affixes until its Venom falls below 50
  const s = stage('ranger', { hexstrong: 1 }), e = foe(s.w, 300, 300, { elite: true, affix: 'brutal' }), dmg = e.dmg;
  e.venom = 100; e.venomOwner = s.p; e.venomT = 5; s.w.tickStatuses(e, 1 / 60);
  ok(e.affixOff && !ED.hasAffix(e, 'brutal') && Math.abs(e.dmg - dmg / 1.4) < 1e-9, 'Hex the Strong: affixes off (Brutal\'s damage divided out)');
  e.venom = 60; s.w.tickStatuses(e, 1 / 60);
  ok(e.affixOff, 'still off above 50');
  e.venom = 40; s.w.tickStatuses(e, 1 / 60);
  ok(!e.affixOff && ED.hasAffix(e, 'brutal') && Math.abs(e.dmg - dmg) < 1e-9, 'back below 50');
  const wd = foe(s.w, 400, 300, { elite: true, affix: 'warded' }); wd.venom = 100; wd.venomOwner = s.p; wd.venomT = 5; s.w.tickStatuses(wd, 1 / 60);
  const w0 = wd.ward; s.w.hitEnemy(wd, 100, { p: s.p, kind: 'weapon', crit: false, noProc: true });
  ok(wd.affixOff && w0 > 0 && wd.ward === w0, 'a hexed Warded elite\'s ward absorbs nothing');
}
{ // Lingering Venom: Venom fades 25% slower per rank once its hold ends
  const one = (b) => { const s = stage('ranger', b), e = foe(s.w, 300, 300); e.venom = 80; e.venomOwner = s.p; e.venomT = 0; s.w.tickStatuses(e, 1); return 80 - e.venom; };
  near(one({ linger: 1 }) / one({}), 0.75, 1e-9, 'Lingering Venom: fades 25% slower');
}
{ // Venomous Arms: a weapon hit plants a dose (one per hero) that bursts 3 s later for 10% of the foe's HP x its Venom share within 50 (elites half)
  const s = stage('ranger', { evo_poison: 1 }), { w, p } = s;
  const e = foe(w, p.x + 100, p.y, { hp: 1000 }), o = foe(w, p.x + 130, p.y);
  e.hpLever = 1; e.venom = 60; e.venomT = 99; e.venomOwner = p;
  w.spawnProj({ team: 0, kind: 'arrow', x: p.x + 10, y: p.y, a: 0, speed: 600, dmg: 1, life: 1, pierce: 0, owner: p.pid, wpn: true });
  for (let i = 0; i < 20; i++) w.updateProjectiles(1 / 60);
  ok(e.doses && e.doses.length === 1, 'Venomous Arms: a weapon hit plants a dose');
  w.evoHit(p, e, 0, {});
  ok(e.doses.length === 1, 'one dose per hero at a time');
  s.log.length = 0; w.time += 3.01; w.tickStatuses(e, 1 / 60);
  ok(!e.doses, 'the dose bursts after 3 s');
  ok(s.log.some(h => h.e === o && h.src.el === 'poison' && Math.abs(h.d - 1000 * C.DOSE_HP * 0.6) < 1e-6), 'the burst deals 10% HP x Venom share as Poison to a foe within 50');
  const el = foe(w, 300, 300, { elite: true, affix: 'swift', hp: 1000 }), o2 = foe(w, 330, 300); el.hpLever = 1; el.venom = 100; el.venomT = 99;
  w.evoHit(p, el, 0, {}); s.log.length = 0; w.time += 3.01; w.tickStatuses(el, 1 / 60);
  ok(s.log.some(h => h.e === o2 && Math.abs(h.d - 1000 * C.DOSE_HP * 0.5) < 1e-6), 'an elite\'s dose bursts for half');
  const inc = stage('ranger', { evo_poison: 1, mut_incubation: 1 }), e3 = foe(inc.w, 300, 300, { hp: 1000 }), o3 = foe(inc.w, 330, 300); e3.hpLever = 1; e3.venom = 50; e3.venomT = 99;
  inc.w.evoHit(inc.p, e3, 0, {}); inc.w.time += 3.01; inc.w.tickStatuses(e3, 1 / 60);
  ok(e3.doses && e3.doses.length === 1, 'Incubation: no burst at 3 s');
  inc.w.time += 3; inc.w.tickStatuses(e3, 1 / 60);
  ok(inc.log.some(h => h.e === o3 && Math.abs(h.d - 1000 * C.DOSE_HP * 0.5 * 2) < 1e-6), 'Incubation: bursts at 6 s for twice as much');
  const cat = stage('ranger', { evo_poison: 1, mut_catalyst: 1 }), e4 = foe(cat.w, 300, 300, { hp: 1000 }); e4.venom = 50; e4.venomT = 99;
  cat.w.evoHit(cat.p, e4, 0, {}); cat.w.tickStatuses(e4, 1 / 60);
  ok(e4.doses && e4.doses.length === 1, 'Catalyst: waits below full Venom');
  e4.venom = 100; cat.w.tickStatuses(e4, 1 / 60);
  ok(!e4.doses, 'Catalyst: bursts at once at full Venom');
}
{ // Pandemic Mutations: Miasma (every lower foe within 90, half the share), Virulence (spreads from above 50)
  const mk = (b, v) => { const s = stage('ranger', Object.assign({ pandemic: 1 }, b)), e = foe(s.w, 300, 300); e.venom = v; e.venomT = 99; e.venomOwner = s.p; e.plagueT = 0; const os = [0, 1, 2, 3].map(i => foe(s.w, 300 + 50 * Math.cos(i * 1.5), 300 + 50 * Math.sin(i * 1.5))); s.w.tickStatuses(e, 1 / 60); return os.map(o => o.venom); };
  const base = mk({}, 100), mi = mk({ mut_miasma: 1 }, 100);
  ok(base.filter(v => v > 0).length === 2, 'Pandemic: the 2 nearest');
  ok(mi.filter(v => v > 0).length === 4 && Math.abs(mi[0] - 100 * 0.3 * 0.5) < 1e-6, 'Miasma: every foe within 90, half the share');
  ok(mk({}, 60).every(v => v === 0) && mk({ mut_virulence: 1 }, 60).filter(v => v > 0).length === 2, 'Virulence: spreads from a foe above 50 Venom');
}

// ---------------- Holy ----------------
{ // Light Attunement: +hallow to foes holding Radiance
  const s = stage('cleric', { fervor: 1 }), { w, p } = s, e = foe(w, 300, 300), r = foe(w, 360, 300);
  r.rad = 5;
  const d0 = w.hitEnemy(e, 100, { p, kind: 'weapon', crit: false, noProc: true }), d1 = w.hitEnemy(r, 100, { p, kind: 'weapon', crit: false, noProc: true });
  near(d1 / d0, (p.stats.dmg + 0.1 * p.stats.dmgX) / p.stats.dmg, 1e-6, 'Light Attunement: +10% to a foe holding Radiance');
}
{ // Martyr's Rebuke: a shield that breaks releases a holy nova (r 100, x0.5 to x2 by the shield's size, once per 1 s)
  const s = stage('cleric', { martyr: 1 }), { w, p } = s, e = foe(w, p.x + 60, p.y), far = foe(w, p.x + 200, p.y);
  w.state = 'play'; p.shield = p.maxHp * 0.03;
  w.hurtPlayer(p, p.maxHp, { e });
  const ev = evOf(s, 'rebuke');
  ok(ev.length === 1 && ev[0].pid === 'p0' && ev[0].r === C.REBUKE_R, 'Martyr\'s Rebuke: the broken shield emits a rebuke');
  near(dealt(s, e), ED.procDmg(ED.BOONS.martyr, p.stats) * p.stats.dmg, 1e-6, 'a shield of 3% max HP rebukes at x1 as Holy');
  ok(dealt(s, far) === 0, 'a foe 200 away is not struck');
  p.invuln = 0; p.hp = p.maxHp; p.shield = p.maxHp * 0.03; w.hurtPlayer(p, p.maxHp * 0.5, { e });
  ok(evOf(s, 'rebuke').length === 1, 'once per 1 s');
  w.time += 1.01; p.invuln = 0; p.hp = p.maxHp; p.shield = p.maxHp * 0.2; s.log.length = 0; w.hurtPlayer(p, p.maxHp * 0.5, { e });
  near(dealt(s, e), ED.procDmg(ED.BOONS.martyr, p.stats) * p.stats.dmg * 2, 1e-6, 'a large shield rebukes at x2');
  w.time += 1.01; p.invuln = 0; p.hp = p.maxHp; p.shield = p.maxHp * 0.2; w.hurtPlayer(p, 1, { e });
  ok(evOf(s, 'rebuke').length === 2, 'a shield that holds does not rebuke');
}
{ // Vigil: standing still 1 s consecrates the ground (r 70) for as long as the hero stays on it; holy build-up x2 for foes on it
  const s = stage('cleric', { vigil: 1, fervor: 1 }), { w, p } = s;
  run(s, 1.1);
  const z = zonesOf(w, 'vigil')[0];
  ok(z && z.owner === 'p0' && z.dur > 0 && Math.abs(z.r - C.VIGIL_R * (1 + 0.5 * p.stats.area)) < 1e-9, 'Vigil: standing still 1 s consecrates the ground');
  const ins = foe(w, p.x + 30, p.y), out = foe(w, p.x + 200, p.y);
  w.applyInfusions(ins, 100, p, {}, 1); w.applyInfusions(out, 100, p, {}, 1);
  near(ins.rad / out.rad, 2, 1e-9, 'a foe on it builds Radiance x2');
  p.x += z.r + 10; run(s, 2 / 60);
  ok(!zonesOf(w, 'vigil').length || zonesOf(w, 'vigil')[0] !== z, 'stepping off ends it');
}
{ // Hallowed Arms: while shielded the attack is a lance of light (shots 260, melee 150) that strikes every foe on it as Holy
  const s = stage('ranger', { evo_holy: 1 }), { w, p } = s, e = foe(w, p.x + 200, p.y), side = foe(w, p.x + 100, p.y + 60);
  p.shield = 50; w.playerAttack(p, 0);
  ok(evOf(s, 'lance').length === 1 && !w.projs.some(q => q.team === 0), 'Hallowed Arms: a shielded attack is a lance, not a shot');
  ok(s.log.some(h => h.e === e && h.src.el === 'holy' && h.src.wpn) && dealt(s, side) === 0, 'the lance strikes the foe on its line as Holy');
  p.shield = 0; w.fx.length = 0; s.evs.length = 0; w.playerAttack(p, 0);
  ok(!evOf(s, 'lance').length && w.projs.some(q => q.team === 0), 'unshielded: the normal shot');
  const t = stage('ranger', { evo_holy: 1, mut_twinlances: 1 }), back = foe(t.w, t.p.x - 150, t.p.y);
  t.p.shield = 50; t.w.playerAttack(t.p, 0);
  ok(dealt(t, back) > 0, 'Twin Lances: also behind you');
  const h = stage('knight', { evo_holy: 1, mut_halo: 1 }), r1 = foe(h.w, h.p.x, h.p.y + 120), r2 = foe(h.w, h.p.x - 120, h.p.y);
  h.p.shield = 50; h.w.playerAttack(h.p, 0);
  ok(dealt(h, r1) > 0 && dealt(h, r2) > 0, 'Halo: a ring around a melee hero (r 140)');
}
{ // Radiant Aegis Mutations: Wrathful Aegis (the strike hits every foe within 80), Penitence (double Radiance below half health, not while shielded)
  const s = stage('cleric', { radiantaegis: 1, mut_wrathfulaegis: 1 }), { w, p } = s, a = foe(w, p.x + 40, p.y), b = foe(w, p.x - 50, p.y);
  w.state = 'play'; p.shield = 30; w.hurtPlayer(p, 10, { e: a });
  ok(dealt(s, a) > 0 && dealt(s, b) > 0, 'Wrathful Aegis: the shield strikes every foe within 80');
  const pn = stage('cleric', { radiantaegis: 1, mut_penitence: 1, fervor: 1 }), e = foe(pn.w, 300, 300), e2 = foe(pn.w, 400, 300);
  pn.p.shield = 50; pn.w.applyInfusions(e, 100, pn.p, {}, 1);
  pn.p.shield = 0; pn.p.hp = pn.p.maxHp * 0.4; pn.w.applyInfusions(e2, 100, pn.p, {}, 1);
  near(e2.rad / e.rad, 2, 1e-9, 'Penitence: x2 below half health, x1 while shielded');
}

// ---------------- Shadow ----------------
{ // Reaper's Chain: a Reap passes 50% of the foe's Doom to the nearest foe within 120 (at most SPREAD_CAP of its HP), which may be Reaped in turn
  const s = stage('shade', { reaperschain: 1 }), { w, p } = s;
  const e = foe(w, 300, 300, { hp: 100 }), o = foe(w, 360, 300, { hp: 1000 }), f = foe(w, 600, 300);
  e.doom = 200; e.doomOwner = p; w.checkReap(e);
  ok(e.hp <= 0, 'stage: the foe is Reaped');
  chains(w);
  near(o.doom, Math.min(100, C.SPREAD_CAP * 1000), 1e-9, 'Reaper\'s Chain: the nearest foe receives 50% of the Doom');
  ok(o.doomOwner === p && f.doom === 0 && evOf(s, 'reapchain').length === 1, 'one hand-off, to the nearest foe only, with a reapchain event');
  const s2 = stage('shade', { reaperschain: 1 }), a = foe(s2.w, 300, 300, { hp: 100 }), b = foe(s2.w, 360, 300, { hp: 1000 }), c = foe(s2.w, 420, 300, { hp: 5000 });
  b.hp = 40; a.doom = 200; a.doomOwner = s2.p; s2.w.checkReap(a); chains(s2.w);
  ok(b.hp <= 0 && c.doom > 0, 'the receiver Reaped in turn passes its Doom on');
}
{ // Quarry: the last foe your skill hit takes double the Doom line (8 s); a new skill target moves it
  const s = stage('shade', { quarry: 1 }), { w, p } = s, e = foe(w, 300, 300, { hp: 1000 }), o = foe(w, 400, 300, { hp: 1000 });
  w.hitEnemy(e, 1, { p, kind: 'skill', crit: false, noProc: true });
  ok(e.quarryT === C.QUARRY_T && e.quarryBy === 'p0', 'Quarry: a skill hit marks the foe for 8 s');
  e.doom = 100; e.doomOwner = p;
  near(w.doomLine(e), 200, 1e-9, 'Quarry: the Doom line doubles');
  w.hitEnemy(o, 1, { p, kind: 'skill', crit: false, noProc: true });
  ok(o.quarryT > 0 && e.quarryT === 0, 'a new skill target takes the mark');
  w.hitEnemy(o, 1, { p, kind: 'weapon', crit: false, noProc: true });
  const s0 = stage('shade', {}), e0 = foe(s0.w, 300, 300); s0.w.hitEnemy(e0, 1, { p: s0.p, kind: 'skill', crit: false, noProc: true });
  ok(!(e0.quarryT > 0), 'no mark without the card');
}
{ // Umbral Step: a dash through a foe at or below twice its Reap line Reaps it
  const s = stage('shade', { umbralstep: 1 }), { w, p } = s, e = foe(w, p.x + 5, p.y, { hp: 150 }), o = foe(w, p.x - 5, p.y, { hp: 250 });
  e.doom = 100; e.doomOwner = p; o.doom = 100; o.doomOwner = p;
  p.dashing = true; p.dashDx = 1; p.dashDy = 0; w.updatePlayerCombat(p, 1 / 60); p.dashing = false;
  ok(e.hp <= 0 && evOf(s, 'reap').length === 1, 'Umbral Step: 150 HP under a 100 Doom line is Reaped');
  ok(o.hp === 250, 'a foe above twice its line is not');
}
{ // Umbral Arms: a Reap makes the nearest foe within 160 your Quarry and refunds a dash charge (never from fodder)
  const s = stage('shade', { evo_shadow: 1 }), { w, p } = s, e = foe(w, 300, 300, { hp: 50 }), o = foe(w, 400, 300), f = foe(w, 600, 300);
  e.doom = 100; e.doomOwner = p; w.checkReap(e);
  ok(o.quarryT === C.QUARRY_T && o.quarryBy === 'p0' && !(f.quarryT > 0), 'Umbral Arms: the nearest foe within 160 becomes the Quarry');
  ok(w.msgs.filter(m => m.t === 'dashRefund' && m.to === 'p0' && m.n === 1).length === 1, 'and a dash charge comes back (dashRefund message)');
  const ft = ED.biomeFor(1).fodder, fd = foe(w, 300, 360, { type: ft, hp: 5 }); fd.doom = 100; fd.doomOwner = p;
  w.msgs.length = 0; w.checkReap(fd);
  ok(fd.hp <= 0 && fd.fodder && !w.msgs.some(m => m.t === 'dashRefund'), 'fodder rule: a fodder Reap refunds nothing');
  const ds = stage('shade', { evo_shadow: 1, mut_deathspiral: 1 }), a = foe(ds.w, 300, 300, { hp: 50 }), q = foe(ds.w, 380, 300, { hp: 50 });
  a.doom = 100; a.doomOwner = ds.p; ds.w.checkReap(a);
  ok(!ds.w.msgs.some(m => m.t === 'dashRefund') && q.quarryT > 0, 'Death Spiral: a Reap of a foe that is not the Quarry refunds nothing');
  q.doom = 100; q.doomOwner = ds.p; ds.w.checkReap(q);
  ok(ds.w.msgs.some(m => m.t === 'dashRefund' && m.n === 3), 'Death Spiral: a Reap of the Quarry refunds every charge');
  const sr = stage('shade', { evo_shadow: 1, mut_shadowrelay: 1 }), r0 = foe(sr.w, 300, 300, { hp: 50 }), r1 = foe(sr.w, 360, 300), r2 = foe(sr.w, 240, 300), r3 = foe(sr.w, 300, 420);
  r0.doom = 100; r0.doomOwner = sr.p; sr.w.checkReap(r0);
  ok(r1.quarryT > 0 && r2.quarryT > 0 && !(r3.quarryT > 0), 'Shadow Relay: the 2 nearest become Quarry');
}
{ // Reaper Mutations: Singularity (pulls foes within 120 in first), Grim Harvest (the implosion marks Doom instead of damage)
  const s = stage('shade', { reaper: 1, mut_singularity: 1 }), { w, p } = s, e = foe(w, 300, 300, { hp: 50 }), o = foe(w, 400, 300);
  e.doom = 100; e.doomOwner = p; w.checkReap(e); chains(w);
  ok(o.kbx < 0, 'Singularity: a foe within 120 is pulled toward the Reaped foe');
  const g = stage('shade', { reaper: 1, mut_grimharvest: 1 }), e2 = foe(g.w, 300, 300, { hp: 50 }), o2 = foe(g.w, 350, 300, { hp: 1000 });
  e2.maxHp = 1000; e2.hp = 50; e2.doom = 100; e2.doomOwner = g.p; g.w.checkReap(e2); chains(g.w);
  ok(dealt(g, o2) === 0, 'Grim Harvest: no implosion damage');
  near(o2.doom, Math.min(1000 * 0.2, C.SPREAD_CAP * 1000) * (1 + g.p.stats.doomMul) / (1 + g.p.stats.doomMul), 1e-6, 'Grim Harvest: 20% of the Reaped foe\'s HP as Doom (capped at SPREAD_CAP)');
}

// ---------------- General: Masterstroke and Masterwork Mutations ----------------
{
  const s = stage('ranger', { masterstroke: 1, mut_openingstroke: 1 }), { w, p } = s;
  for (let i = 0; i < 4; i++) w.playerAttack(p, 0);
  ok(!w.projs.some(q => q.ms), 'Opening Stroke: no 4th-attack Masterstroke');
  w.playerDash(p, 1, 0); w.playerAttack(p, 0);
  ok(w.projs.filter(q => q.ms).length >= 1 && !p.msReady, 'Opening Stroke: the first attack after a dash is the Masterstroke');
  const k = stage('ranger', { masterstroke: 1, mut_killingstroke: 1 }), e = foe(k.w, 300, 300, { hp: 1000 }), b = foe(k.w, 400, 300, { hp: 1000 });
  e.hp = 250; k.w.hitEnemy(e, 60, { p: k.p, kind: 'weapon', crit: false, noProc: true, ms: true });
  ok(e.hp <= 0, 'Killing Stroke: a Masterstroke leaving a foe below 20% kills it');
  b.hp = 250; k.w.hitEnemy(b, 60, { p: k.p, kind: 'weapon', crit: false, noProc: true });
  ok(b.hp > 0, 'an ordinary hit does not');
  const ec = stage('ranger', { evo_general: 1, mut_echoedge: 1 }), e1 = foe(ec.w, 300, 300);
  ec.w.evoHit(ec.p, e1, 0, { critOut: true, mul: 1 });
  ok(dealt(ec, e1) === 0, 'Echo Edge: no strike at once');
  ec.w.time += 0.41; ec.w.updatePlayerCombat(ec.p, 1 / 60);
  near(dealt(ec, e1), ec.p.stats.weapon.dmg * ec.p.stats.dmg, 1e-6, 'Echo Edge: 0.4 s later at 100%');
  const me = stage('ranger', { evo_general: 1, mut_mirroredge: 1 }), m1 = foe(me.w, 300, 300), m2 = foe(me.w, 380, 300);
  me.w.evoHit(me.p, m1, 0, { critOut: true, mul: 1 });
  ok(dealt(me, m1) === 0 && Math.abs(dealt(me, m2) - me.p.stats.weapon.dmg * 0.6 * me.p.stats.dmg) < 1e-6, 'Mirror Edge: the spectral strike hits the nearest other foe at 60%');
  const mw = stage('knight', { evo_general: 1 }), n1 = foe(mw.w, mw.p.x + 30, mw.p.y);
  mw.p.stats.crit = 1; mw.w.playerAttack(mw.p, 0);
  ok(mw.log.filter(h => h.e === n1).length === 2 && mw.log.some(h => h.e === n1 && h.src.spectral && h.src.mul === 0.6), 'Masterwork Arms: a crit swing repeats as one spectral swing at 60%, no extra spectral strike');
}
{ // evolution rule: no evolution adds hits on a count of attacks
  const counts = (evo) => { const s = stage('ranger', evo ? { [evo]: 1 } : {}); for (let i = 0; i < 12; i++) s.w.playerAttack(s.p, 0); return s.w.projs.filter(q => q.team === 0).length; };
  const n0 = counts(null);
  ok(['evo_fire', 'evo_ice', 'evo_lightning', 'evo_poison', 'evo_shadow', 'evo_general'].every(id => counts(id) === n0), 'no evolution adds shots to an attack');
}

// ---------------- duos: one rule each ----------------
{
  const dis = (duo) => { const s = stage('ranger', { [duo]: 1 }), e = foe(s.w, 300, 300), o = foe(s.w, 340, 300); e.charge = 100; s.w.discharge(e, s.p, 1); return o; };
  ok(dis('plasma').burnPool > 0, 'Plasma: discharges add Burn to every foe hit');
  ok(dis('superconductor').chill > 0, 'Superconductor: discharges chill');
  ok(dis('galvanic').venom > 0, 'Galvanic: discharges build Venom');
  const cr = stage('ranger', { cryotoxin: 1 }), c1 = foe(cr.w, 300, 300), c2 = foe(cr.w, 400, 300);
  for (const e of [c1, c2]) { e.venom = 50; e.venomBy = 1; }
  cr.w.freezeEnemy(c1, cr.p); c2.frozen = 0;
  const v1 = cr.w.hitEnemy(c1, 100, { p: cr.p, kind: 'weapon', crit: false, noProc: true }), v2 = cr.w.hitEnemy(c2, 100, { p: cr.p, kind: 'weapon', crit: false, noProc: true });
  near(v1 / v2, (1.25 + 0.5 * C.VENOM_AMP * 2) / (1 + 0.5 * C.VENOM_AMP), 1e-6, 'Cryotoxin: frozen foes take twice the Venom bonus');
  const ho = stage('cleric', { hoarlight: 1 }), h1 = foe(ho.w, 300, 300), h2 = foe(ho.w, 350, 300);
  ho.w.smite(h1, ho.p, 50);
  ok(h1.chill > 0 && h2.chill > 0, 'Hoarlight: a Smite chills the foe and foes within 70');
  const bi = stage('shade', { blackice: 1 }), b1 = foe(bi.w, 300, 300); b1.doom = 50; b1.doomOwner = bi.p; b1.frozen = 1;
  near(bi.w.doomLine(b1), 100, 1e-9, 'Black Ice: a frozen foe\'s Doom line doubles');
  const bf = stage('shade', { blackflame: 1 }), f1 = foe(bf.w, 300, 300); f1.doom = 50; f1.doomOwner = bf.p; f1.burnPool = 30;
  near(bf.w.doomLine(f1), 50 + 30 * (1 + bf.p.stats.burnMul), 1e-9, 'Black Flame: Burn to come counts toward the Doom line');
  const nc = stage('shade', { necrosis: 1 }), n1 = foe(nc.w, 300, 300, { hp: 1000 }); n1.doom = 10; n1.doomOwner = nc.p; n1.venom = 50;
  near(nc.w.doomLine(n1), 10 + 1000 * 0.1 * 0.5, 1e-9, 'Necrosis: Venom raises the Doom line (10% of HP at full)');
  const tw = stage('shade', { twilight: 1 }), t1 = foe(tw.w, 300, 300, { hp: 50 }), t2 = foe(tw.w, 360, 300);
  t1.doom = 100; t1.doomOwner = tw.p; tw.w.checkReap(t1); chains(tw.w);
  ok(evOf(tw, 'smite').length === 1 && dealt(tw, t2) > 0, 'Twilight: a Reap forces a Smite on the nearest foe');
  const tw2 = stage('cleric', { twilight: 1 }), t3 = foe(tw2.w, 300, 300); tw2.w.smite(t3, tw2.p, 100);
  ok(!(t3.doom > 0), 'Twilight: a Smite adds no Doom (one rule)');
  const wr = stage('cleric', { wrathofheaven: 1 }), w1 = foe(wr.w, 300, 300), w2 = foe(wr.w, 340, 300);
  wr.w.smite(w1, wr.p, 100); chains(wr.w);
  ok(w1.charge > 0 && dealt(wr, w2) > 0, 'Wrath of Heaven: a Smite calls a bolt and charges the foe');
  const ts = stage('pyro', { thermalshock: 1 }), th = foe(ts.w, 300, 300), tn = foe(ts.w, 340, 300); th.burnPool = 100; th.burnOwner = ts.p;
  ts.w.freezeEnemy(th, ts.p); chains(ts.w);
  ok(th.burnPool === 0 && dealt(ts, th) > 0 && tn.chill > 0, 'Thermal Shock: freezing a burning foe detonates its Burn');
}

// ---------------- fodder rules ----------------
{
  const ft = ED.biomeFor(1).fodder;
  const s = stage('ranger', { capacitor: 1 }), { w, p } = s, fd = foe(w, 300, 300, { type: ft, hp: 20 }), o = foe(w, 330, 300);
  w.addCharge(fd, 10, p); w.elementCast(p, 0); chains(w);
  ok(fd.hp <= 0 || fd.charge === 0, 'fodder rule: a charged fodder foe detonates (chains: yes)');
  const k = stage('cleric', { martyr: 1 }), e = foe(k.w, k.p.x + 40, k.p.y, { type: ft, hp: 5 });
  k.w.state = 'play'; k.p.shield = 1; k.w.hurtPlayer(k.p, 50, { e });
  ok(evOf(k, 'rebuke').length === 1, 'Martyr\'s Rebuke answers a fodder touch (a nova, not a stack)');
  const q = stage('shade', { evo_shadow: 1, reaperschain: 1 }), f1 = foe(q.w, 300, 300, { type: ft, hp: 5 }), big = foe(q.w, 340, 300, { hp: 1000 });
  f1.doom = 100; f1.doomOwner = q.p; q.w.checkReap(f1); chains(q.w);
  ok(big.doom > 0 && big.doom <= C.SPREAD_CAP * 1000 && !q.w.msgs.some(m => m.t === 'dashRefund'), 'a fodder Reap still chains its Doom (spread capped) but refunds nothing');
}

// ---------------- cost of fire pathing and solids at 200 foes ----------------
{
  const tick = (zones) => {
    const s = stage('ranger', {}), { w, p } = s, rng = new U.RNG(5);
    p.invuln = 1e9;
    for (let i = 0; i < 200; i++) { const e = w.spawnEnemy('skeleton', p.x + rng.range(-300, 300), p.y + rng.range(-200, 200)); e.spawnT = 0; e.hp = e.maxHp = 1e9; e.cd = 9999; }
    if (zones) for (let i = 0; i < 6; i++) { w.fireGround(p, p.x + 60 * (i - 3), p.y + 80, 34, 1e9, 0); w.addPillar(p, p.x + 60 * (i - 3), p.y - 80, { maxHp: 1 }, 1e9); }
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 240; i++) w.update(1 / 60);
    return Number(process.hrtime.bigint() - t0) / 1e6 / 240;
  };
  const a = Math.min(tick(false), tick(false)), b = Math.min(tick(true), tick(true));
  console.log(`200 foes: ${a.toFixed(3)} ms/tick plain, ${b.toFixed(3)} ms/tick with 6 Firebreak grounds and 6 pillars`);
  ok(b < a * 1.6 + 0.3, `fire pathing and solids cost at most +60% at 200 foes (${a.toFixed(3)} -> ${b.toFixed(3)} ms)`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
