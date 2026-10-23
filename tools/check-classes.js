// Usage: node tools/check-classes.js
// Headless checks of the class-route engine against docs/GAME-DESIGN.md section 5: fork weapon numbers, skill numbers at class Power, slot-damage compounding, the attack-interval floor,
// the shield window, stun rules and the Knight's Shield Throw and Shield Charge in a staged room. Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const build = (cls, wi, boons) => ED.Stats.compute({ cls, weapon: ED.CLASSES[cls].weapons[wi || 0], boons: boons || {}, relics: [], meta: META(), pact: 0 });

// ---- 36 fork weapons: dmg / rate and the fields the rule changes ----
const FORKS = [ // base, kind, dmg, rate, {field: value}
  ['longsword', 'heavy', 35.6, 0.756, { range: 55, arc: 2.09, knock: 169 }], ['longsword', 'swift', 10.9, 0.231, { range: 50, knock: 65 }],
  ['warhammer', 'heavy', 59.3, 1.3, { range: 59.4, arc: 2.42, knock: 312 }], ['warhammer', 'swift', 20.6, 0.451, { range: 54, knock: 120 }],
  ['glaive', 'heavy', 39.6, 0.9, { range: 90.2, arc: 0.83, knock: 195 }], ['glaive', 'swift', 12.1, 0.275, { range: 82, knock: 75 }],
  ['longbow', 'heavy', 23.8, 0.612, { r: 4.8, speed: 396, life: 0.94, knock: 80 }], ['longbow', 'swift', 7.26, 0.187, { speed: 528, life: 0.72 }],
  ['crossbow', 'heavy', 47.5, 1.296, { r: 6, speed: 504, life: 0.88, pierce: 2, knock: 240 }], ['crossbow', 'swift', 14.5, 0.396, { speed: 672, life: 0.68, pierce: 2, knock: 60 }],
  ['twinbows', 'heavy', 8.91, 0.45, { r: 4.8, speed: 378, life: 0.77, knock: 80 }], ['twinbows', 'swift', 2.72, 0.1375, { speed: 504, life: 0.6, spread: 0.12 }],
  ['firestaff', 'heavy', 29.7, 0.9, { r: 7.2, speed: 279 }], ['firestaff', 'swift', 9.08, 0.275, { speed: 372 }],
  ['emberwand', 'heavy', 11.9, 0.27, { r: 4.8, speed: 351 }], ['emberwand', 'swift', 5.28, 0.12, { speed: 468 }],
  ['inferno', 'heavy', 42.9, 1.3, { r: 10.8, speed: 225 }], ['inferno', 'swift', 18.2, 0.55, { speed: 300 }],
  ['daggers', 'heavy', 21.78, 0.378, { range: 46.2, arc: 1.43, knock: 78 }], ['daggers', 'swift', 6.91, 0.12, { range: 42, knock: 30 }],
  ['knives', 'heavy', 13.9, 0.648, { r: 4.8, speed: 432, knock: 80 }], ['knives', 'swift', 4.24, 0.198, { speed: 576, spread: 0.19 }],
  ['scythes', 'heavy', 31.68, 0.864, { range: 57.2, arc: 6.3, knock: 117 }], ['scythes', 'swift', 9.68, 0.264, { range: 52, knock: 45 }],
  ['mace', 'heavy', 33.7, 0.756, { range: 50.6, arc: 1.87, knock: 182 }], ['mace', 'swift', 10.3, 0.231, { range: 46, knock: 70 }],
  ['dawnhammer', 'heavy', 63.4, 1.296, { range: 57.2, arc: 2.42, knock: 286 }], ['dawnhammer', 'swift', 19.4, 0.396, { range: 52, knock: 110 }],
  ['lantern', 'heavy', 24.75, 0.756, { r: 7.2, speed: 270, pierce: 1, knock: 80 }], ['lantern', 'swift', 7.563, 0.231, { speed: 360, pierce: 1 }],
  ['bonewand', 'heavy', 17.8, 0.72, { r: 6, speed: 315, homing: 4 }], ['bonewand', 'swift', 5.45, 0.22, { speed: 420 }],
  ['soulscythe', 'heavy', 33.7, 1.008, { range: 57.2, arc: 2.64, knock: 143, raise: 0.12 }], ['soulscythe', 'swift', 10.3, 0.308, { range: 52, knock: 55 }],
  ['plaguestaff', 'heavy', 11.9, 1.08, {}], ['plaguestaff', 'swift', 3.63, 0.33, {}],
];
const CARD = { knight: ['k_atk_h', 'k_atk_s'], ranger: ['r_atk_h', 'r_atk_s'], pyro: ['p_atk_h', 'p_atk_s'], shade: ['s_atk_h', 's_atk_s'], cleric: ['c_atk_h', 'c_atk_s'], necro: ['n_atk_h', 'n_atk_s'] };
for (const [base, kind, dmg, rate, f] of FORKS) {
  const cls = ED.CLASS_IDS.find(c => ED.CLASSES[c].weapons.includes(base)), w = ED.forkWeapon(base, CARD[cls][kind === 'heavy' ? 0 : 1]);
  near(w.dmg, dmg, 0.06 + dmg * 0.002, base + '@' + kind + ' dmg'); near(w.rate, rate, 0.0011, base + '@' + kind + ' rate');
  for (const k in f) near(w[k], f[k], 0.011, base + '@' + kind + ' ' + k);
  ok(w.name === ED.FORK_NAMES[base + '@' + kind] && ED.FORK_LOOKS[base + '@' + kind], base + '@' + kind + ' name/look');
}
const pt = ED.forkWeapon('plaguestaff', 'n_atk_h'), pr = ED.forkWeapon('plaguestaff', 'n_atk_s');
near(pt.cloud.r, 50.6, 0.05, 'Plague Totem cloud r'); near(pt.cloud.dps, 19.8, 0.05, 'Plague Totem cloud dps'); near(pr.cloud.r, 44, 0.05, 'Plague Rod cloud r'); near(pr.cloud.dps, 6.05, 0.05, 'Plague Rod cloud dps');
near(ED.forkWeapon('firestaff', 'p_atk_h').explode.r, 46, 0.05, 'Magma Staff blast r'); near(ED.forkWeapon('inferno', 'p_atk_h').explode.r, 82.8, 0.05, 'Tome of Ruin blast r'); near(ED.forkWeapon('warhammer', 'k_atk_h').shock.r, 82.8, 0.05, 'Maul shock r');

// ---- skill numbers at class Power (1.3) ----
const SK = [ // class, skill, part, dmg
  ['knight', 'charge', 'impact', 48.8], ['knight', 'shieldthrow', 'strike', 43.4], ['knight', 'shieldthrow', 'return', 21.7],
  ['ranger', 'volley', 'arrow', 18.4], ['ranger', 'rain', 'tick', 9.4],
  ['pyro', 'nova', 'blast', 64.5], ['pyro', 'nova', 'burn', 52.8], ['pyro', 'meteor', 'impact', 89.5], ['pyro', 'meteor', 'crater', 21.6],
  ['shade', 'step', 'slash', 40.6], ['shade', 'vanish', 'ambush', 27.5],
  ['cleric', 'sanctuary', 'zone', 30.4], ['cleric', 'judgment', 'leg', 41.8], ['necro', 'legion', 'minion', 11.4], ['necro', 'harvest', 'burst', 40.2],
];
for (const [cls, sk, part, dmg] of SK) near(ED.Stats.skillNums(sk, build(cls)).p[part].dmg, dmg, 0.06, `${sk}.${part}`);
{ const st = build('necro', 0, { n_s1: 1, n_s1_a: 1 }); near(ED.Stats.skillNums('legion', st).p.spikes.dmg, 5 + 0.8 * st.power, 1e-9, 'legion.spikes (rank 1: 5 + 0.8 x Power)'); }
const sky = ED.Stats.skillNums('rain', build('ranger', 0, { r_s2: 1, r_s2_a: 1 }));
near(sky.p.sky.dmg, 124.08, 0.1, 'Rainmaker + Skyfall sky');
ok(!ED.Stats.skillNums('rain', build('ranger')).p.sky.on && sky.p.sky.on, 'Skyfall part gated by its stat');
near(build('knight', 0, { k_s1: 1, k_s1_a: 1 }).s1Dmg, 0.375, 1e-9, 'slot damage compounds (Vanguard x1.25, Juggernaut x1.1)');
near(build('cleric', 0, { c_s1: 1, c_s1_b: 1 }).s1Dmg, 1.5 * 1.3 - 1, 1e-9, 'slot damage compounds (Sanctum x1.5, Aura x1.3)');
const jug3 = build('knight', 0, { k_s1: 1, k_s1_a: 3 });
near(jug3.jugShock, 0.6, 1e-9, 'Juggernaut rank 3 shock (0.4 + 2 x 0.1)'); near(jug3.bash, 0.6, 1e-9, 'Juggernaut rank 3 Shield Bash');
near(build('knight', 0, { k_s2: 1 }).skill2Cd, 9 * (1 - 0.167), 0.001, 'Shield Throw cooldown with Shieldmaster'); near(ED.Stats.skillNums('charge', build('knight', 0, { k_s1: 1, k_s1_a: 1 })).range, 240, 1e-9, 'Juggernaut Charge range');
const prs = ED.classRoute({ k_el: 1, k_el_b: 2 }, 'knight');
ok(prs.route === 'element' && prs.fork === 'k_el_b' && prs.rank === 2, 'classRoute');
ok(ED.CLASS_IDS.every(c => ED.ROUTES.every(r => ED.CLASS_CARDS[c][r] && ED.CLASS_CARDS[c][r].forks.length === 2)) && ED.BOON_IDS.filter(id => ED.BOONS[id].route).length === 72, '72 cards, 4 routes x 2 forks per class');
ok(ED.boonText('k_atk', 1).indexOf('+60%') >= 0 && ED.boonText('k_atk_h', 3).indexOf('Follow-Through') >= 0 && ED.boonText('k_atk_h', 1).indexOf('Follow-Through') < 0 && !/[{}\[\]]/.test(ED.boonText('s_s1', 1, { critK: 1 })), 'card text tokens');
// every stat key a card sets must exist in the stat block
const base0 = build('knight');
for (const id of ED.BOON_IDS) { const b = ED.BOONS[id]; if (!b.route) continue; for (const part of [b.mods, b.up || {}, b.r3 || {}]) for (const k in part) ok(k in base0, `card ${id} stat ${k} is in the stat block`); }

// ---- attack-interval floor (3.3) ----
ED.BOONS.test_fast = { name: 't', rar: 'c', icon: 'star', mods: { atk: 1 }, max: 1 };
const ew = build('pyro', 1, { test_fast: 1 }); // Ember Wand at attack speed x2: raw 0.075 s, floor 0.12 s, damage x1.6
near(ew.atkInterval, 0.12, 1e-9, 'floored interval'); near(ew.weapon.dmg, 6 * 1.6, 1e-9, 'floor turns speed into damage'); near(ew.atkFloor, 0.12, 1e-9, 'atkFloor');
const tb = build('ranger', 2, { test_fast: 1, split: 1 }); // Twin Shortbows + Split Shot: 3 shots, floor 0.18
near(tb.atkFloor, 0.18, 1e-9, 'shots raise the floor');
delete ED.BOONS.test_fast; ED.BOON_IDS = Object.keys(ED.BOONS);
const hv = build('knight', 0, { k_atk: 1, k_atk_h: 1 }), sw = build('knight', 0, { k_atk: 1, k_atk_s: 1 });
near(hv.critK, 0.42 / 0.756, 1e-9, 'Heavy critK'); near(sw.critK, 0.42 / 0.231, 1e-9, 'Swift critK'); ok(hv.heavy && !hv.swift && sw.swift && hv.weaponId === 'longsword@heavy', 'fork flags');

// ---- staged world ----
function stage(cls, boons, seed, wi) {
  const meta = META(), w = new ED.World({ seed: seed || 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls, weapon: ED.CLASSES[cls].weapons[wi || 0], meta }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  w.enemies.length = 0; w.enc = null; w.locked = false;
  return { w, p };
}
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 5000; return e; };
const run = (w, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.update(1 / 60); if (f) f(); } };

// shield window: class sources 3% / holy+class 6% per 10 s
{
  const { w, p } = stage('cleric'); const M = p.maxHp;
  const g1 = w.addShield(p, M, M, 'class'), g2 = w.addShield(p, M, M, 'class'), g3 = w.addShield(p, M, M, 'holy'), g4 = w.addShield(p, M, M, 'holy');
  near(g1, 0.03 * M, 1e-9, 'class window 3%'); near(g2, 0, 1e-9, 'class window spent'); near(g3, 0.03 * M, 1e-9, 'holy fills to 6%'); near(g4, 0, 1e-9, 'all-source window spent');
  near(w.addShield(p, M, M, 'ward'), M - 0.06 * M, 1e-6, 'Battle Ward is outside the window'); p.shield = 0;
  w.time += 11; near(w.addShield(p, M, M, 'class'), 0.03 * M, 1e-9, 'window slides');
}
// stun rules: first stun dur + 2 s cooldown, a second one while it runs lasts half, repeating sources skip, elites half, bosses never
{
  const { w } = stage('knight'); const e = foe(w, 300, 200);
  near(w.stunFoe(e, 1, false), 1, 1e-9, 'stun applied'); near(e.stunCd, 3, 1e-9, 'stunCd = dur + STUN_DR');
  e.stun = 0; near(w.stunFoe(e, 1, false), 0.5, 1e-9, 'stun while stunCd runs lasts half'); near(w.stunFoe(e, 0.4, true), 0, 1e-9, 'repeating stun skipped');
  const el = foe(w, 320, 200); el.elite = 'swift'; near(w.stunFoe(el, 1, false), 0.5, 1e-9, 'elite stun halved');
  const b = foe(w, 340, 200); b.boss = true; near(w.stunFoe(b, 1, false), 0, 1e-9, 'bosses are never stunned');
}
// Shield Throw: four foes in a line are struck once each and stunned, the shield returns and is caught (0.5% per foe, 2% at most), a shot in its path is swatted
{
  const { w, p } = stage('knight'); const x0 = p.x, y0 = p.y;
  const es = [1, 2, 3, 4, 5].map(k => foe(w, x0 + 45 * k, y0));
  let ric = 0, catches = 0, got = 0, swat = 0; const stunned = new Set();
  w.spawnProj({ team: 1, kind: 'bone', x: x0 + 20, y: y0 - 6, a: Math.PI, speed: 20, r: 4, dmg: 1, life: 3, owner: null, src: es[0] });
  w.playerSkill(p, 0, { d: 280 }, 1);
  ok(p.shields.length === 1 && w.projs.some(q => q.kind === 'shield'), 'Shield Throw spawns a shield projectile');
  run(w, 3, () => { for (const e of es) if (e.stunCd > 0) stunned.add(e); for (const ev of w.fx) { if (ev.t === 'ric') ric++; if (ev.t === 'catch') { catches++; got += ev.v; } if (ev.t === 'deflect') swat++; } w.fx.length = 0; });
  ok(ric === 4, `Shield Throw strikes 4 foes (got ${ric})`); ok(es.slice(0, 4).every(e => e.hp < 5000), 'foes hit');
  ok(es.slice(0, 4).every(e => stunned.has(e)), 'struck foes stunned'); ok(catches === 1 && p.shields.length === 0, 'caught once, no shield left');
  near(got, 0.02 * p.maxHp, 0.01, 'catch shield 4 foes x 0.5% = 2%'); ok(swat >= 1, 'enemy shot swatted');
  ok(!w.projs.some(q => q.kind === 'shield'), 'shield projectile removed after the catch');
  // a second catch inside KWARD_CD gives nothing
  p.kWardT = 5; p.shield = 0; w.playerSkill(p, 0, { d: 280 }, 1); let again = 0; run(w, 3, () => { for (const ev of w.fx) if (ev.t === 'catch') again += ev.v; w.fx.length = 0; }); near(again, 0, 1e-9, 'catch shield once per 6 s');
}
{ // Shield Throw into a wall with no foes: no grant, nothing left
  const { w, p } = stage('knight'); let v = 0, c = 0;
  w.playerSkill(p, Math.PI, { d: 280 }, 1); run(w, 3, () => { for (const ev of w.fx) if (ev.t === 'catch') { c++; v += ev.v; } w.fx.length = 0; });
  ok(c === 1 && v === 0 && p.shields.length === 0, 'a throw at nothing is caught without a shield');
}
{ // Shield Storm: two shields, one catch grant for the cast
  const { w, p } = stage('knight', { k_s2: 1, k_s2_a: 1 }); const es = [1, 2, 3, 4].map(k => foe(w, p.x + 40 * k, p.y)); let c = 0, v = 0;
  w.playerSkill(p, 0, { d: 280 }, 1); ok(p.shields.length === 2, 'Shield Storm throws two');
  run(w, 3, () => { for (const ev of w.fx) if (ev.t === 'catch') { c++; v += ev.v; } w.fx.length = 0; });
  ok(c === 2 && v > 0 && p.shields.length === 0, `Shield Storm: both caught, one grant (catches ${c}, shield ${v.toFixed(1)})`); void es;
}
// Shield Charge: contact sweep hits foes on the path once, stuns them, Crush on shield-stunned foes, the hero is untouchable during the run
{
  const { w, p } = stage('knight'); const es = [60, 100, 140].map(d => foe(w, p.x + d, p.y)); const away = foe(w, p.x, p.y + 100);
  es[1].shieldStunT = 5;
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 150, y1: p.y }, 0);
  ok(p.charge && p.invuln > 0.3, 'Charge starts a sweep and grants i-frames');
  const hp0 = es.map(e => e.hp); run(w, 1 / 60); ok(es[0].hp === hp0[0] && es[2].hp === hp0[2], 'foes ahead are not hit at cast time');
  run(w, 0.6);
  ok(es.every(e => e.hp < 5000) && away.hp === 5000, 'Charge hits every foe on its path and nobody else');
  ok(es.every(e => e.stunCd > 0), 'Charge stuns'); near((5000 - es[1].hp) / (5000 - es[0].hp), 1.4, 0.15, 'Crush +40% on a shield-stunned foe'); ok(!p.charge, 'sweep ended');
}
// Cleave: every 3rd swing of Oath of Steel is a Cleave (+60%)
{
  const { w, p } = stage('knight', { k_atk: 1 }); const e = foe(w, p.x + 30, p.y); const dealt = [];
  for (let i = 0; i < 6; i++) { const h = e.hp; p.stats.crit = 0; w.playerAttack(p, 0); dealt.push(h - e.hp); }
  ok(dealt[2] > dealt[0] * 1.4 && dealt[5] > dealt[3] * 1.4 && dealt[1] < dealt[2], `Cleave on swings 3 and 6 (${dealt.map(v => v.toFixed(0)).join(' ')})`);
}
// Brace cuts damage taken by braceDR, Hold the Line shares it, the best Sanctuary stacks with it and the product never falls below DR_FLOOR
{
  const { w, p } = stage('knight', { k_s1: 1, k_s1_b: 3 }); const q = ED.Stats.armorMul(p.stats.armor), hit = () => { p.hp = p.maxHp; p.invuln = 0; w.hurtPlayer(p, 100, {}); return p.maxHp - p.hp; };
  const base = hit(); p.braceT = 1; const braced = hit(); near(braced / base, 0.6, 0.03, 'Brace -40% (Vanguard 25 + Rallying rank 3: 15)');
  p.braceT = 0; const ally = w.addPlayer({ pid: 'p1', name: 'A', slot: 1, cls: 'ranger', weapon: 'longbow', meta: META() }); ally.x = p.x + 40; ally.y = p.y; ally.hp = ally.maxHp;
  p.braceT = 1; p.boons.k_s1_b = 3; w.recalc(p, false); ally.invuln = 0; const a0 = ally.hp; w.hurtPlayer(ally, 100, {}); const aHit = a0 - ally.hp;
  ally.hp = ally.maxHp; ally.invuln = 0; p.braceT = 0; w.hurtPlayer(ally, 100, {}); const aBase = ally.maxHp - ally.hp; near(aHit / aBase, 1 - Math.min(0.4, p.stats.braceDR), 0.04, 'Hold the Line braces allies within 100');
  p.braceT = 1; w.zones.push({ kind: 'sanct', x: p.x, y: p.y, r: 80, dr: 0.4, t: 0, dur: 9, team: 0, id: 99 }); const floor = hit(); near(floor / base, 0.5, 0.03, 'DR floor 0.5 (Brace x Sanctuary)');
}
// Parry (Sworn Blade): a Cleave in the last 0.3 s of a wind-up cancels it and stuns; otherwise nothing; once per 2.5 s
{
  const { w, p } = stage('knight', { k_atk: 1, k_atk_s: 1 }); const e = foe(w, p.x + 30, p.y); e.st = 'windup'; e.t = 0.2; e.hp = e.maxHp = 5000; p.atkCount = 2; let ev = 0;
  w.playerAttack(p, 0); for (const f of w.fx) if (f.t === 'parry') ev++; w.fx.length = 0;
  ok(ev === 1 && e.stun > 0 && e.st === 'move' && e.parryT > w.time, 'Parry cancels the wind-up and stuns'); near(e.stun, 0.6, 0.01, 'Parry stun 0.6 s');
  const e2 = foe(w, p.x + 30, p.y - 4); e2.st = 'windup'; e2.t = 0.2; p.atkCount = 5; w.playerAttack(p, 0); ok(e2.st === 'windup', 'Parry once per 2.5 s per hero');
  const { w: w2, p: p2 } = stage('knight', { k_atk: 1, k_atk_s: 1 }); const e3 = foe(w2, p2.x + 30, p2.y); e3.st = 'windup'; e3.t = 0.8; p2.atkCount = 2; w2.playerAttack(p2, 0); ok(e3.st === 'windup' && e3.stun === 0, 'no parry early in a wind-up');
}
// moments: team level 3 grants the route offer, boss I the fork offer; bosses II and IV rank the fork up without an offer (tools/check-build.js)
{
  const { w, p } = stage('ranger'); w.addXp(69); ok(p.offers.filter(o => o.src === 'class').length === 1, 'level 3 route offer');
  const lv = w.level; w.addXp(1e5); ok(w.level > lv && p.offers.filter(o => o.src === 'class').length === 1, 'only level 3 grants a route');
  for (const s of [1, 2, 3, 4, 5]) { p.offers.length = 0; w.stratum = s; w.boss = null; const b = w.spawnEnemy(ED.biomeFor(s).boss, 100, 100); w.onBossKilled(b); ok(p.offers.some(o => o.src === 'class') === (s === 1), 'boss ' + s + ' class grant'); }
}
// weapon clouds merge: many shots on one spot keep one cloud zone, the damage per second adds up
{
  const { w, p } = stage('necro', {}, 7, 2); const wp = p.stats.weapon; let z0 = null;
  for (let i = 0; i < 6; i++) { const z = w.spawnCloud(p.pid, p.x + 60, p.y, { r: wp.cloud.r, dps: wp.cloud.dps, dur: wp.cloud.dur }); z0 = z0 || z; w.update(0.1); }
  ok(w.zones.filter(z => z.kind === 'plague').length === 1 && z0.parts.length >= 5, 'cloud merge keeps one zone per spot');
}
// skill-move i-frames: the hero is untouchable while the move's window is open, and only then; a real dash is separate
{
  const { w, p } = stage('knight'); p.skillMove = { dx: 1, dy: 0, speed: 100, t: 0.4, iframes: 0.2, age: 0 }; let on = 0, off = 0;
  for (let i = 0; i < 30; i++) { ED.Sim.movePlayer(p, { mx: 0, my: 0 }, 1 / 60, w.room, w.locked, w.zones); if (i < 10) on += p.skillIfr ? 1 : 0; else if (i > 14) off += p.skillIfr ? 1 : 0; }
  ok(on === 10 && off === 0 && !p.dashing, 'skill move i-frames follow iframes, not the move length');
}
// a downed hero loses its thrown shields; Shield Charge sets Brace once per BRACE_CD
{
  const { w, p } = stage('knight', { k_s1: 1 }); w.playerSkill(p, 0, { d: 200 }, 1); ok(p.shields.length === 1, 'shield out'); p.downed = true; p.bleed = 99; w.update(1 / 60); ok(p.shields.length === 0 && !w.projs.some(q => q.kind === 'shield'), 'a downed hero loses its shield');
  p.downed = false; p.braceAt = -99; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 50, y1: p.y }, 0); ok(p.braceT > 1.4, 'Charge starts Brace'); const t1 = p.braceT; p.braceT = 0; w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + 50, y1: p.y }, 0); ok(p.braceT === 0 && t1 > 0, 'Brace once per BRACE_CD');
}
// ailments, status moves and crit grants
{
  const { w, p } = stage('knight'); const a = foe(w, p.x + 60, p.y), b2 = foe(w, p.x + 90, p.y);
  a.burnPool = 600; a.burnOwner = p; a.chill = 50; a.bleedPool = 400; a.bleedOwner = p; a.stun = 1; ok(w.ailments(a) === 4, 'ailments: Burn, Chill, Bleed, Dazed');
  w.moveStatuses(a, b2, 0.5); near(b2.burnPool, 300, 1e-6, 'moved Burn pool'); near(a.burnPool, 300, 1e-6, 'source loses the moved Burn'); ok(b2.chill > 0 && b2.burnOwner === p, 'chill moved, owner kept');
  const big = 0.25 * b2.maxHp; a.burnPool = 1e9; w.moveStatuses(a, b2, 1); ok(b2.burnPool <= 300 + big + 1e-6, 'a spread gives at most 25% of the receiver HP per pool');
  const hk = stage('knight', { k_atk: 1, k_atk_h: 1 }).p; hk.critStacks = 0; ED.World.prototype.grantCrits.call(null, hk, 3, 3, 'set'); ok(hk.critStacks === 2, 'Heavy fork grants fewer crit stacks (3 x 0.56 -> 2)');
  const sk = stage('knight', { k_atk: 1, k_atk_s: 1 }).p; ED.World.prototype.grantCrits.call(null, sk, 3, 5, 'set'); ok(sk.critStacks === 5, 'Swift fork grants more (3 x 1.82 -> 5)');
}
// every class: all four routes can be taken in a staged world and the offers hold the right cards
{
  for (const cls of ED.CLASS_IDS) {
    const { w, p } = stage(cls);
    p.offers.length = 0; w.grantOffer(p, { src: 'class' }); let o = w.rollOffer(p, p.offers[0]);
    ok(o.length === 4 && o.every(id => ED.BOONS[id].tier === 1), cls + ' route offer');
    p.boons[o[0]] = 1; p.offers[0] = { src: 'class' }; o = w.rollOffer(p, p.offers[0]);
    ok(o.length === 2 && o.every(id => ED.BOONS[id].tier === 2), cls + ' fork offer');
    p.boons[o[0]] = 1; p.offers[0] = { src: 'class' }; o = w.rollOffer(p, p.offers[0]);
    ok(p.offers[0].src === 'level' && o.length === 3 && !o.some(id => ED.BOONS[id].cls), cls + ' fork held: a class spec becomes a level offer (no ctier 3)');
  }
}
// p.shieldOut (wire flag 1 << 6) follows the thrown shields; a new throw relaunches the orbiting shield instead of adding one
{
  const { w, p } = stage('knight', { k_s2: 1, k_s2_b: 1 }); const es = [1, 2].map(k => foe(w, p.x + 40 * k, p.y));
  ok(p.shieldOut === false, 'shieldOut starts false'); w.playerSkill(p, 0, { d: 280 }, 1); ok(p.shieldOut === true, 'a throw sets shieldOut');
  let t = 0; while (t < 4 && !(p.shields[0] && p.shields[0].leg === 'orbit')) { run(w, 0.05); t += 0.05; }
  ok(p.shields.length === 1 && p.shields[0].leg === 'orbit' && p.shieldOut, 'caught shield orbits and shieldOut stays set');
  const pr0 = p.shields[0].pr; w.playerSkill(p, 0, { d: 280 }, 1);
  ok(p.shields.length === 1 && p.shields[0].leg === 'out' && p.shields[0].pr === pr0 && w.projs.filter(q => q.kind === 'shield').length === 1, 'a new throw relaunches the orbiting shield');
  w.clearShields(p); ok(!p.shieldOut && !p.shields.length, 'clearShields clears shieldOut'); void es;
  { // the orbit's contact stuns a non-boss foe 0.3 s (repeating: once per cooldown), bosses never
    const o = stage('knight', { k_s2: 1, k_s2_b: 1 }); o.w.playerSkill(o.p, 0, { d: 280 }, 1); let u = 0; while (u < 4 && !(o.p.shields[0] && o.p.shields[0].leg === 'orbit')) { run(o.w, 0.05); u += 0.05; }
    const sp = o.p.shields[0].pr, f1 = foe(o.w, sp.x, sp.y), bs = foe(o.w, sp.x, sp.y); bs.boss = true; f1.stun = 0; f1.stunCd = 0; run(o.w, 0.05);
    ok(f1.stun > 0.2 && f1.stun <= 0.3 + 1e-9, 'Shield Orbit contact stuns 0.3 s (' + f1.stun.toFixed(2) + ')'); ok(!(bs.stun > 0), 'bosses are not stunned by the orbit'); ok(f1.stunCd > 0.5, 'the repeating stun sets the stun cooldown');
  }
  const sw = stage('knight'); sw.w.playerSkill(sw.p, 0, { d: 200 }, 1); sw.p.downed = true; sw.p.bleed = 99; sw.w.update(1 / 60); ok(!sw.p.shieldOut, 'a downed hero has no shieldOut');
}
// Stagger needs a Heavy weapon hit of kind weapon (not a cloud tick or a blast); Shadowstep knocks foes back; Rain parts carry their radius and the Second Shower a fixed 2 s
{
  const { w, p } = stage('knight', { k_atk: 1, k_atk_h: 1 }); const a = foe(w, p.x + 50, p.y), b = foe(w, p.x + 70, p.y), c = foe(w, p.x + 90, p.y);
  w.hitEnemy(a, 1, { p, kind: 'dot', wpn: true }); w.hitEnemy(b, 1, { p, kind: 'explode', wpn: true }); w.hitEnemy(c, 1, { p, kind: 'weapon', wpn: true });
  ok(a.stun === 0 && b.stun === 0 && c.stun > 0, 'Stagger only from a Heavy weapon hit of kind weapon');
  near(ED.Stats.skillNums('step', build('shade')).p.slash.knock, 60, 1e-9, 'Shadowstep knockback');
  const rn = ED.Stats.skillNums('rain', build('ranger', 0, { r_s2: 1, r_s2_a: 2, r_s2_b: 2 })), tk = rn.p.tick;
  near(rn.p.sky.r, tk.r * 1.3, 1e-6, 'Skyfall radius'); near(rn.p.sky2.r, rn.p.sky.r, 1e-6, 'Twin Sky radius'); near(rn.p.shower.r, tk.r, 1e-6, 'Second Shower radius');
  near(tk.dur, 3, 1e-9, 'Rainmaker lengthens the Rain'); near(rn.p.shower.dur, 2, 1e-9, 'Second Shower is a fixed 2 s'); near(rn.p.shower.count, 8, 1e-9, 'Second Shower ticks');
}
// shared seams: cone homing, shot end hook, shot distance, Toll factor and hook, Abyssal Hunger
{
  const { w, p } = stage('ranger'); const a0 = 0, cone = 25 * Math.PI / 180, ang = (pr) => Math.atan2(pr.vy, pr.vx);
  const out = foe(w, p.x + 120, p.y + 90); // 37 degrees off the launch angle
  const pr1 = w.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y, a: a0, speed: 300, r: 4, dmg: 1, life: 1, owner: p.pid, homing: 8, homeA0: a0, homeCone: cone, pierce: 5 });
  for (let i = 0; i < 20; i++) w.updateProjectiles(1 / 60);
  near(ang(pr1), 0, 1e-9, 'cone homing ignores a foe outside the cone');
  w.enemies.length = 0; w.projs.length = 0; const inn = foe(w, p.x + 150, p.y + 60); // 22 degrees: inside
  const pr2 = w.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y, a: a0, speed: 300, r: 4, dmg: 1, life: 1, owner: p.pid, homing: 8, homeA0: a0, homeCone: cone, pierce: 5 });
  for (let i = 0; i < 10; i++) w.updateProjectiles(1 / 60);
  ok(ang(pr2) > 0.05 && ang(pr2) <= cone + 1e-9, 'cone homing steers toward a foe inside the cone and never past it'); void out; void inn;
  w.enemies.length = 0; w.projs.length = 0; const seen = [], realEnd = ED.CLS.ranger.projEnd; ED.CLS.ranger.projEnd = (pr, owner, why) => seen.push(why);
  const pr3 = w.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y, a: 0, speed: 100, r: 4, dmg: 1, life: 0.05, owner: p.pid });
  for (let i = 0; i < 6; i++) w.updateProjectiles(1 / 60);
  w.spawnProj({ team: 0, kind: 'arrow', x: p.x, y: p.y, a: Math.PI, speed: 900, r: 4, dmg: 1, life: 5, owner: p.pid, hk: 'skill' });
  for (let i = 0; i < 120; i++) w.updateProjectiles(1 / 60);
  ED.CLS.ranger.projEnd = realEnd; ok(seen.join() === 'life,wall', `projEnd hook on life end and wall (got ${seen.join()})`);
  near(pr3.dist, 5, 1.5, 'every hero shot accumulates its distance');
}
{
  const dmg = (st) => { const { w, p } = stage('necro', st); const b = foe(w, p.x + 100, p.y); b.boss = true; b.maxHp = b.hp = 1000; b.doomOwner = p; b.doom = ED.CONST.TOLL_AT * 1000; let calls = 0; ED.CLS.necro.toll = () => { calls++; }; w.checkToll(b); delete ED.CLS.necro.toll; return { d: 1000 - b.hp, calls }; };
  const base = dmg({}), buff = dmg({ n_el: 1, n_el_a: 1 });
  near(buff.d / base.d, 1.4, 0.01, 'Abyssal Toll: Tolls deal +40%'); ok(base.calls === 1 && buff.calls === 1, 'toll hook called once per Toll');
  const doom = (st, elite) => { const { w, p } = stage('necro', st); p.stats.shadowInfuse = 0.5; const e = foe(w, p.x + 100, p.y); if (elite) e.elite = 'swift'; w.applyInfusions(e, 100, p, { kind: 'minion' }, 1); return e.doom; };
  near(doom({ n_el: 1, n_el_a: 3 }, true) / doom({ n_el: 1, n_el_a: 1 }, true), 2, 1e-6, 'Abyssal Hunger doubles minion Doom on elites'); near(doom({ n_el: 1, n_el_a: 3 }, false) / doom({ n_el: 1, n_el_a: 1 }, false), 1, 1e-6, 'Abyssal Hunger leaves common foes alone');
}
// ---- skill forms of the Knight and Ranger (rank 2: the rider; rank 3: the transform) ----
const U_ang = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const spy = (w) => { const log = [], o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const px = e.x, py = e.y, d = o.call(this, e, b, s); if (s && s.part) log.push({ part: s.part, e, d, t: this.time, px, py }); return d; }; return log; };
const partHits = (log, part) => log.filter(h => h.part === part);
const charge = (w, p, len) => w.playerSkill(p, 0, { x0: p.x, y0: p.y, x1: p.x + len, y1: p.y }, 0);
{ // card text and totals of the eight skill forks: the rider joins at rank 2, the transform and its name at rank 3
  const FORKS = { k_s1_a: ['Juggernaut', 'Shield Bash', 'Avalanche'], k_s1_b: ['Rallying Charge', 'Hold the Line', 'Iron Phalanx'], k_s2_a: ['Shield Storm', 'Gathering Force', 'Aegis Tempest'], k_s2_b: ['Shield Orbit', 'Return to Sender', 'Bastion'],
    r_s1_a: ["Hunter's Mark", 'Relentless Hunt', 'Death Mark'], r_s1_b: ['Scattershot', 'Caltrops', 'Thornburst'], r_s2_a: ['Skyfall', 'Twin Sky', 'Starfall Barrage'], r_s2_b: ['Hail of Thorns', 'Second Shower', 'Storm of Thorns'] };
  for (const id in FORKS) {
    const [name, rider, form] = FORKS[id], b = ED.BOONS[id], P = [1, 2, 3].map(r => ED.cardParts(id, r, null));
    ok(!b.rider && b.rider2 && b.r2 && b.form && b.r3 && b.form.name === form, id + ' keeps its rider in rider2/r2 and its transform in form/r3');
    ok(P[0].rider2 === '' && P[1].rider2Name === rider && P[1].rider2 !== '' && P[2].rider2 !== '', id + ' rider ' + rider + ' from rank 2');
    ok(!P[0].form && !P[1].form && P[2].form && P[2].form.name === form && P[2].form.desc.length > 20 && !/[{}\[\]]/.test(P[2].form.desc), id + ' transform ' + form + ' only at rank 3');
    ok(ED.cardName(id, 1) === name && ED.cardName(id, 2) === name && ED.cardName(id, 3) === form, id + ' card name: ' + name + ' then ' + form);
    ok(ED.boonText(id, 2, null).indexOf(form) < 0 && ED.boonText(id, 3, null).indexOf(form + ':') >= 0, id + ' card text names the transform only at rank 3');
    const t1 = ED.cardTotals(b, 1), t2 = ED.cardTotals(b, 2), t3 = ED.cardTotals(b, 3);
    for (const k in b.r2) ok(!t1[k] && t2[k] > 0 && t3[k] > 0, id + ' stat ' + k + ' (rank 2 rider)');
    for (const k in b.r3) ok(t3[k] > 0 && (k in b.mods || k in (b.up || {}) ? t3[k] > t2[k] : !t2[k] && !t1[k]), id + ' stat ' + k + ' (rank 3 transform)');
  }
  const tt = (id, r) => ED.cardTotals(ED.BOONS[id], r);
  near(tt('k_s1_a', 3).avalanche, 0.9, 1e-9, 'Avalanche slam 90% of the impact'); near(tt('k_s1_a', 3).avaStun, 0.8, 1e-9, 'Avalanche stun 0.8'); near(tt('k_s1_a', 3).avaCrack, 0.3, 1e-9, 'Avalanche cracks 30%');
  near(tt('k_s1_b', 3).bannerDur, 5, 1e-9, 'War Banner 5 s'); near(tt('k_s1_b', 3).bannerSlow, 0.4, 1e-9, 'War Banner slow 40%'); near(tt('k_s1_b', 3).bannerWeak, 0.25, 1e-9, 'War Banner weakens 25%');
  near(tt('k_s2_a', 3).tempest, 3, 1e-9, 'Aegis Tempest three shields'); near(tt('k_s2_a', 3).vortexMul, 0.03, 1e-9, 'vortex 3% of a strike'); near(tt('k_s2_a', 3).vortexDur, 2.5, 1e-9, 'vortex 2.5 s'); near(tt('k_s2_b', 3).orbitMul, 0.15, 1e-9, 'Bastion strike 15%');
  const N3 = ED.Stats.skillNums('charge', build('knight', 0, { k_s1: 1, k_s1_a: 3 }));
  near(N3.p.quake.dmg, N3.p.impact.dmg * 0.9, 1e-6, 'quake part: 90% of the impact'); near(N3.p.crack.dmg, N3.p.impact.dmg * 0.3, 1e-6, 'crack part: 30% of the impact');
  ok(!N3.p.shock.on && ED.Stats.skillNums('charge', build('knight', 0, { k_s1: 1, k_s1_a: 2 })).p.shock.on, 'the slam replaces the shockwave part at rank 3 only');
}
{ // Avalanche (k_s1_a rank 3): the Charge carries foes, slams for 90% (r160, stun 0.8, bosses x1.5 never stunned), 3 cracks erupt after 0.3 s at 30% (a foe struck by one); ranks 1 and 2 do none of it
  const go = (rank) => {
    const { w, p } = stage('knight', { k_s1: 1, k_s1_a: rank }); p.x = 60; p.y = 192; const log = spy(w), x1 = p.x + 144; // castMove stops on 8 px steps
    const path = [40, 60, 80, 100, 120].map((d, i) => foe(w, p.x + d, p.y + (i % 2 ? 12 : -12))), elite = foe(w, p.x + 70, p.y + 18), side = foe(w, x1, p.y + 90), boss = foe(w, x1 - 10, p.y - 30), lone = foe(w, x1 + 190, p.y), gap = foe(w, x1 + 190 * Math.cos(1.05), p.y + 190 * Math.sin(1.05));
    elite.elite = 'swift'; boss.boss = true;
    const ev = [], kinds = []; let stunSide = 0, stunBoss = 0, front = null;
    charge(w, p, 150);
    run(w, 0.9, () => { if (!front && !p.charge) front = path.map(e => e.x); for (const f of w.fx) ev.push(f); w.fx.length = 0; for (const z of w.zones) kinds.push(z.kind); if (side.stun > stunSide) stunSide = side.stun; if (boss.stun > stunBoss) stunBoss = boss.stun; });
    return { w, p, log, path, elite, side, boss, lone, gap, x1, kinds, ev, stunSide, stunBoss, front };
  };
  const r3 = go(3), r2 = go(2), r1 = go(1), imp = ED.Stats.skillNums('charge', r3.p.stats).p.impact.dmg;
  ok(r3.front.every(x => x > r3.x1 - 4 && x < r3.x1 + 40), `foes on the path are carried to the front of the run (${r3.front.map(x => Math.round(x - r3.x1)).join(',')})`);
  ok(r2.front.some(x => x < r2.x1 - 30) && r1.front.some(x => x < r1.x1 - 30), 'ranks 1 and 2 carry nobody');
  ok(Math.abs(r3.elite.x - r3.x1) > 50 && Math.abs(r3.elite.y - r3.p.y) > 24, `an elite is knocked aside, not carried (${Math.round(r3.elite.x - r3.x1)}, ${Math.round(r3.elite.y - r3.p.y)})`);
  ok(Math.abs(r3.boss.x - (r3.x1 - 10)) < 24, 'a boss stands');
  const q = partHits(r3.log, 'charge.quake');
  ok(q.length === 8 && q.every(h => Math.abs(h.d / imp - (h.e === r3.boss ? 1.35 : 0.9)) < 0.01), `the slam hits ${q.length} foes at 90% of the impact, the boss at 135% (${q.map(h => (h.d / imp).toFixed(2)).join(' ')})`);
  ok(!q.some(h => h.e === r3.lone || h.e === r3.gap), 'the slam stops at radius 160');
  ok(r3.stunSide > 0.6 && r3.stunSide <= 0.8 + 1e-9, `the slam stuns a foe off the path 0.8 s (${r3.stunSide.toFixed(2)})`); ok(!(r3.stunBoss > 0), 'a boss is never stunned by the slam');
  const cr = partHits(r3.log, 'charge.crack');
  ok(r3.kinds.filter(k => k === 'crack').length >= 3 && cr.length >= 2 && cr.every(h => Math.abs(h.d / imp - 0.3) < 0.01), `the cracks erupt on the foes along them at 30% (${cr.length} hits)`);
  ok(cr.some(h => h.e === r3.lone) && !cr.some(h => h.e === r3.gap), 'a foe on a crack is struck, one between two cracks is not');
  ok(new Set(cr.map(h => h.e.id)).size === cr.length, 'a foe is struck by at most one crack');
  { const tc = r3.log.find(h => h.part === 'charge.crack'), tq = r3.log.find(h => h.part === 'charge.quake'); ok(tc && tq && Math.abs((tc.t - tq.t) - 0.3) < 0.04, 'the cracks erupt 0.3 s after the slam'); }
  ok(r3.ev.some(f => f.t === 'quake' && f.r === 160) && r3.ev.filter(f => f.t === 'crack').length >= 2, 'quake and crack events for the viewer');
  ok(partHits(r2.log, 'charge.quake').length === 0 && partHits(r2.log, 'charge.crack').length === 0 && partHits(r2.log, 'charge.shock').length > 0, 'rank 2 keeps the plain shockwave (r90)');
  ok(partHits(r3.log, 'charge.shock').length === 0, 'rank 3: no shockwave under the slam');
}
{ // Iron Phalanx (k_s1_b rank 3): a band 70 wide, enemy shots destroyed, a War Banner (5 s, r120, stun pulse, slow 40%, 25% weaker foes, DR for heroes inside); ranks 1 and 2 have no banner
  const t3 = stage('knight', { k_s1: 1, k_s1_b: 3 }), t2 = stage('knight', { k_s1: 1, k_s1_b: 2 });
  for (const t of [t3, t2]) {
    t.p.x = 60; t.p.y = 192; t.end = t.p.x + 144;
    t.band = foe(t.w, t.p.x + 100, t.p.y + 40); t.shot = t.w.spawnProj({ team: 1, kind: 'bone', x: t.p.x + 120, y: t.p.y + 30, a: Math.PI, speed: 1, r: 4, dmg: 1, life: 5, owner: null, src: t.band });
    t.in = foe(t.w, t.end + 60, t.p.y); t.boss = foe(t.w, t.end, t.p.y + 70); t.boss.boss = true; t.out = foe(t.w, t.end + 170, t.p.y);
    t.ally = t.w.addPlayer({ pid: 'p1', name: 'A', slot: 1, cls: 'ranger', weapon: 'longbow', meta: META() }); t.ally.x = t.end + 40; t.ally.y = t.p.y - 30; t.ally.hp = t.ally.maxHp; t.ally.invuln = 0;
    charge(t.w, t.p, 150); run(t.w, 0.5);
  }
  ok(t3.band.hp < 5000 && !(t2.band.hp < 5000), 'Iron Phalanx hits a foe 40 off the path (band 70 wide), rank 2 does not');
  ok(t3.shot.life <= 0 && t2.shot.life > 0, 'enemy shots in the band are destroyed');
  const bz = t3.w.zones.find(z => z.kind === 'sanct' && z.w === 7);
  ok(bz && Math.abs(bz.r - 120) < 1e-9 && Math.abs(bz.dur - 5) < 1e-9 && Math.abs(bz.x - (t3.end)) < 2 && !t2.w.zones.some(z => z.w === 7), 'a War Banner (r120, 5 s) at the end of the run; none at rank 2');
  ok(t3.in.stunCd > 0, 'the plant pulses a stun on foes inside'); near(t3.in.slowAmt, 0.4, 1e-9, 'foes inside are slowed 40%'); near(t3.boss.slowAmt, 0.2, 1e-9, 'bosses half as much'); ok(!(t3.out.slowT > 0), 'foes outside are not');
  near(t3.in.weakV, 0.25, 1e-9, 'foes inside deal 25% less'); near(t3.boss.weakV, 0.125, 1e-9, 'bosses 12.5% less');
  const dmg = (t, who, src) => { who.hp = who.maxHp; who.invuln = 0; t.w.hurtPlayer(who, 100, src || {}); return who.maxHp - who.hp; };
  const inBanner = dmg(t3, t3.ally), noBanner = dmg(t2, t2.ally);
  near(inBanner / noBanner, 1 - Math.min(0.4, t3.p.stats.braceDR), 0.04, "an ally inside is Braced (the Knight's Brace strength)");
  t3.ally.x = t3.end + 200; near(dmg(t3, t3.ally) / noBanner, 1, 0.04, 'an ally outside is not');
  t3.ally.x = t3.end + 40; const weak = dmg(t3, t3.ally, { e: t3.in }), plain = dmg(t3, t3.ally, { e: t3.out }); near(weak / plain, 0.75, 0.05, 'a foe inside the banner hits 25% weaker');
  run(t3.w, 5.2); ok(!t3.w.zones.some(z => z.w === 7), 'the banner ends after 5 s');
}
{ // Aegis Tempest (k_s2_a rank 3): three shields, a vortex at the last foe struck, then the shields return; rank 2 throws two and spins nothing
  const go = (rank, fodder) => {
    const { w, p } = stage('knight', { k_s2: 1, k_s2_a: rank }); p.stats.crit = 0; const log = spy(w), es = [1, 2, 3, 4, 5].map(k => foe(w, p.x + 45 * k, p.y + (k % 2 ? 6 : -6)));
    if (fodder) for (const e of es) e.fodder = true;
    w.playerSkill(p, 0, { d: 280 }, 1); const n0 = p.shields.length, legs = new Set(), catches = []; let vz = null, pull = null;
    run(w, 7, () => {
      const z = w.zones.find(q => q.kind === 'vortex');
      if (z && !vz) vz = { x: z.x, y: z.y, r: z.r, dur: z.dur, warm: z.warm, t0: z.t, at: w.time };
      if (z && z.t >= z.warm && !pull) pull = { z, t: z.t, d: es.map(e => Math.hypot(e.x - z.x, e.y - z.y)) };
      if (z && pull && !pull.d1 && z.t - pull.t >= 1) pull.d1 = es.map(e => Math.hypot(e.x - z.x, e.y - z.y));
      for (const s of p.shields) legs.add(s.leg);
      for (const f of w.fx) if (f.t === 'catch') catches.push(f);
      w.fx.length = 0;
    });
    return { w, p, log, es, n0, vz, catches, legs, pull };
  };
  const t3 = go(3), t2 = go(2), N = ED.Stats.skillNums('shieldthrow', t3.p.stats), strike = N.p.strike.dmg;
  ok(t3.n0 === 3 && t2.n0 === 2, `Aegis Tempest throws three shields, Shield Storm two (${t3.n0}, ${t2.n0})`);
  ok(t3.vz && Math.abs(t3.vz.r - 100) < 1e-9 && t3.vz.dur >= 2.5 && t3.vz.dur < 3.3 && t3.legs.has('vortex') && !t2.vz && !t2.legs.has('vortex'), `a vortex (r100, 2.5 s once the shields arrive) forms where the ricochets end; none at rank 2 (${t3.vz && t3.vz.dur.toFixed(2)})`);
  const lastStrike = partHits(t3.log, 'shieldthrow.strike').pop();
  ok(t3.vz && lastStrike && Math.hypot(t3.vz.x - lastStrike.px, t3.vz.y - lastStrike.py) < 1, 'the vortex forms on the last foe struck');
  const vh = partHits(t3.log, 'shieldthrow.vortex');
  ok(vh.length >= 20 && vh.every(h => Math.abs(h.d / strike - 0.03) < 0.01), `the vortex strikes for 3% of a strike (${vh.length} hits, ${vh[0] ? (vh[0].d / strike).toFixed(2) : '-'})`);
  const perFoe = {}; for (const h of vh) perFoe[h.e.id] = (perFoe[h.e.id] || 0) + 1; const counts = Object.values(perFoe).sort((a, b) => b - a);
  ok(counts.length >= 2 && counts[0] >= 9 && counts[0] <= 11, `a foe inside the whole time is struck 4 times a second for 2.5 s (${counts.join(',')})`);
  ok(t3.pull && t3.pull.d1 && t3.pull.d.some((d0, i) => d0 > 40 && d0 < 100 && d0 - t3.pull.d1[i] > 40), `foes inside are pulled in about 60 px/s (${t3.pull && t3.pull.d1 ? t3.pull.d.map((d0, i) => Math.round(d0) + '>' + Math.round(t3.pull.d1[i])).join(' ') : '-'})`);
  ok(t3.catches.length === 3 && t3.p.shields.length === 0, `all three shields come home and are caught (${t3.catches.length})`);
  ok(!partHits(t2.log, 'shieldthrow.vortex').length, 'rank 2 has no vortex hits');
  { // a boss is not pulled; the vortex does not stun
    const { w, p } = stage('knight', { k_s2: 1, k_s2_a: 3 }); const es = [1, 2].map(k => foe(w, p.x + 50 * k, p.y)), bs = foe(w, p.x + 150, p.y + 50); bs.boss = true;
    w.playerSkill(p, 0, { d: 160 }, 1); const x0 = bs.x, y0 = bs.y; let z = null;
    run(w, 6, () => { z = z || w.zones.find(q => q.kind === 'vortex'); });
    ok(z && Math.hypot(bs.x - x0, bs.y - y0) < 25, 'a boss is not pulled (only knocked by the strikes)');
  }
  { // the catch counts the non-fodder foes struck: a throw into fodder shields nobody, the vortex still forms
    const f = go(3, true);
    ok(f.catches.reduce((s, c) => s + c.v, 0) === 0 && t3.catches.reduce((s, c) => s + c.v, 0) > 0, 'fodder struck by the shields does not feed the catch shield');
    ok(f.vz && partHits(f.log, 'shieldthrow.vortex').length > 0, 'the vortex still forms on fodder and strikes it');
  }
}
{ // Bastion (k_s2_b rank 3): two shields orbit opposite each other (r60) until the next Throw, strike for 15%, never shortened by shots; a Throw sends one, a room change keeps the pair
  const prime = (rank) => { const t = stage('knight', { k_s2: 1, k_s2_b: rank }); t.p.stats.crit = 0; t.es = [1, 2].map(k => foe(t.w, t.p.x + 40 * k, t.p.y)); t.w.playerSkill(t.p, 0, { d: 200 }, 1); let n = 0; while (n++ < 400 && !(t.p.shields.some(s => s.leg === 'orbit'))) run(t.w, 0.05); return t; };
  const b = prime(3), o = prime(2), orbiting = (t) => t.p.shields.filter(s => s.leg === 'orbit');
  b.w.enemies.length = 0; run(b.w, 0.1);
  ok(orbiting(b).length === 2 && orbiting(o).length === 1, `Bastion keeps two shields in orbit, Shield Orbit one (${orbiting(b).length}, ${orbiting(o).length})`);
  const [a1, a2] = orbiting(b), hx = b.p.x, hy = b.p.y - 4;
  near(Math.hypot(a1.pr.x - hx, a1.pr.y - hy), 60, 1, 'orbit radius 60'); near(Math.hypot(a2.pr.x - hx, a2.pr.y - hy), 60, 1, 'the second shield at radius 60'); near(Math.abs(U_ang(Math.atan2(a1.pr.y - hy, a1.pr.x - hx) - Math.atan2(a2.pr.y - hy, a2.pr.x - hx))), Math.PI, 0.05, 'the two shields sit opposite each other');
  near(Math.hypot(orbiting(o)[0].pr.x - o.p.x, orbiting(o)[0].pr.y - (o.p.y - 4)), 44, 1, 'Shield Orbit keeps radius 44');
  ok(a1.orbitDur === Infinity, 'the orbit does not time out'); run(b.w, 12); run(o.w, 12);
  ok(orbiting(b).length === 2 && orbiting(o).length === 0, 'after 12 s the Bastion pair still orbits, the plain orbit is over');
  { // a shot the orbit destroys does not shorten it
    const t = prime(3); const e = foe(t.w, t.p.x + 300, t.p.y - 150); let swat = 0;
    for (let i = 0; i < 4; i++) { const s = orbiting(t)[0]; t.w.spawnProj({ team: 1, kind: 'bone', x: s.pr.x, y: s.pr.y, a: 0, speed: 1, r: 4, dmg: 1, life: 5, owner: null, src: e }); run(t.w, 0.1); for (const f of t.w.fx) if (f.t === 'deflect') swat++; t.w.fx.length = 0; }
    ok(swat >= 3 && orbiting(t).length === 2 && orbiting(t)[0].orbitDur === Infinity, `shots are destroyed (${swat}) and the orbit stays`);
  }
  { // orbit strikes: 15% of a strike, 0.3 s stun
    const t = prime(3), N = ED.Stats.skillNums('shieldthrow', t.p.stats), log = spy(t.w); t.w.enemies.length = 0; run(t.w, 0.1);
    const s = orbiting(t)[0], f1 = foe(t.w, s.pr.x, s.pr.y); f1.stun = 0; f1.stunCd = 0; run(t.w, 0.06);
    const oh = partHits(log, 'shieldthrow.orbit'); ok(oh.length >= 1 && Math.abs(oh[0].d / N.p.strike.dmg - 0.15) < 0.01, `an orbit strike deals 15% of a strike (${oh[0] ? (oh[0].d / N.p.strike.dmg).toFixed(2) : '-'})`);
    ok(f1.stun > 0.2 && f1.stun <= 0.3 + 1e-9, 'and stuns 0.3 s');
  }
  { // a Throw sends one shield out, the other keeps orbiting; the sent one rejoins opposite it
    const t = prime(3); t.w.enemies.length = 0; run(t.w, 0.1); t.w.playerSkill(t.p, 0, { d: 160 }, 1);
    ok(t.p.shields.length === 2 && t.p.shields.filter(s => s.leg === 'orbit').length === 1 && t.p.shields.filter(s => s.leg === 'out').length === 1, 'a Throw sends one orbiting shield out and leaves the other');
    run(t.w, 3); const [s1, s2] = orbiting(t); ok(orbiting(t).length === 2, 'the thrown shield rejoins the orbit'); near(Math.abs(U_ang(s1.orbitA - s2.orbitA)), Math.PI, 0.06, 'opposite the shield that stayed');
  }
  { // a room change clears every shield, the living Bastion Knight gets its pair back; a downed one does not
    const t = prime(3); t.w.clearShields(t.p); ok(t.p.shields.length === 0 && t.p.bastionKeep, 'a room change clears the shields and remembers the orbit'); run(t.w, 0.1);
    ok(orbiting(t).length === 2, 'the pair is back around the Knight');
    const d = prime(3); d.p.downed = true; d.w.clearShields(d.p); ok(!d.p.bastionKeep && d.p.shields.length === 0, 'a downed Knight loses the orbit');
  }
}
console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
