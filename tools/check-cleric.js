// Usage: node tools/check-cleric.js
// Headless checks of the 12 Cleric route cards against DESIGN-classes section 8 in staged rooms: waves (Dawnbringer, Sunhammer, Crusader), Sanctuary (Sanctum, Holy Fury, Aura of Faith), Judgment (Hammer of Judgment, Twin Hammers, Verdict)
// and the Holy element route (Radiant Faith, Guardian Light, Prism), the rank 2 riders and rank 3 forms of the skill forks and of the attack and element forks (Dawn's Wake, Returning Light, Sunstrike, Spectrum) with the fodder audit, plus the wire fields they use. Prints failures and exits 1 when any check fails.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ED } = require('./sim.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
const U = ED.U, C = ED.CONST;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const build = (wi, boons) => ED.Stats.compute({ cls: 'cleric', weapon: ED.CLASSES.cleric.weapons[wi || 0], boons: boons || {}, relics: [], meta: META(), pact: 0 });
const DT = 1 / 60;

function stage(boons, wi, seed) {
  const w = new ED.World({ seed: seed || 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'cleric', weapon: ED.CLASSES.cleric.weapons[wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null;
  w.enemies.length = 0; w.enc = null; w.locked = false; p.stats.crit = 0;
  return { w, p };
}
const ally = (w, cls, x, y) => { const q = w.addPlayer({ pid: 'a' + w.players.size, name: 'A', slot: w.players.size, cls: cls || 'ranger', weapon: ED.CLASSES[cls || 'ranger'].weapons[0], meta: META() }); q.x = x; q.y = y; q.stats.crit = 0; q.hp = q.maxHp; return q; };
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 5000; return e; };
const run = (w, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.update(DT); if (f) f(); } };
const waves = (w) => w.projs.filter(q => q.kind === 'wave');
const evs = (w, t) => w.fx.filter(e => e.t === t);
const lost = (e) => 5000 - e.hp;
const smiteIt = (w, p, e, amt) => w.smite(e, p, amt);

// ---------------- card data: stat totals per rank ----------------
{
  const rows = [ // [boons], {stat: value}
    [{ c_atk: 1 }, { waveEvery: -1, waveMul: 0.3 }],
    [{ c_atk: 1, c_atk_h: 1 }, { waveBig: 1, waveStun: 0.4, waveMul: 0.3, waveBurst: 0, wake: 0 }], [{ c_atk: 1, c_atk_h: 2 }, { waveMul: 0.4, waveBurst: 0.8, wake: 0 }], [{ c_atk: 1, c_atk_h: 3 }, { waveMul: 0.5, waveBurst: 0.8, wake: 0.6 }],
    [{ c_atk: 1, c_atk_s: 1 }, { waveHome: 2, waveMul: 0.4, litany: 0, waveReturn: 0 }], [{ c_atk: 1, c_atk_s: 2 }, { waveMul: 0.5, litany: 16, waveReturn: 0 }], [{ c_atk: 1, c_atk_s: 3 }, { waveMul: 0.6, litany: 16, waveReturn: 0.5 }],
    [{ c_s1: 1 }, { s1Area: 0.3, s1Dur: 2, sanctDR: 0.1, s1Dmg: 0.5 }],
    [{ c_s1: 1, c_s1_a: 1 }, { sanctStun: 0.5, s1Dmg: 1.5 * 1.2 - 1, sanctJudge: 0, wrath: 0 }], [{ c_s1: 1, c_s1_a: 2 }, { s1Dmg: 1.5 * 1.4 - 1, sanctJudge: 1, wrath: 0 }], [{ c_s1: 1, c_s1_a: 3 }, { s1Dmg: 1.5 * 1.6 - 1, sanctJudge: 1, wrath: 1, wrathNova: 1.4, wrathPillar: 0.15 }],
    [{ c_s1: 1, c_s1_b: 1 }, { aura: 1, s1Dmg: 1.5 * 1.3 - 1, sanctDR: 0.2, auraDmg: 0, dawn: 0 }], [{ c_s1: 1, c_s1_b: 2 }, { s1Dmg: 1.5 * 1.6 - 1, sanctDR: 0.22, auraDmg: 0.1, dawn: 0 }], [{ c_s1: 1, c_s1_b: 3 }, { s1Dmg: 1.5 * 1.9 - 1, sanctDR: 0.24, auraDmg: 0.1, dawn: 1, aegisR: 40, aegisDR: 0.1, aegisStun: 0.3, aegisMul: 1 }],
    [{ c_s2: 1 }, { s2Dmg: 0.25, s2Range: 0.4, judgeDur: 1, s2Cdr: 0.167 }],
    [{ c_s2: 1, c_s2_a: 1 }, { twinHammer: 0.55, thirdLeg: 0, storm: 0 }], [{ c_s2: 1, c_s2_a: 2 }, { s2Dmg: 1.25 * 1.1 - 1, thirdLeg: 1, secondFlight: 0.55, storm: 0 }], [{ c_s2: 1, c_s2_a: 3 }, { thirdLeg: 1, secondFlight: 0.55, s2Dmg: 1.25 * 1.2 - 1, storm: 5, stormMul: 0.4 }],
    [{ c_s2: 1, c_s2_b: 1 }, { verdict: 2.5, judgeWeak: 0.5, verdictJudge: 0, fjEcho: 0 }], [{ c_s2: 1, c_s2_b: 2 }, { s2Dmg: 1.25 * 1.15 - 1, verdictJudge: 1, fjEcho: 0 }], [{ c_s2: 1, c_s2_b: 3 }, { verdictJudge: 1, s2Dmg: 1.25 * 1.3 - 1, fjEcho: 0.08, fjR: 10, fjStun: 0.6 }],
    [{ c_el: 1 }, { classElMul: 0.25, wInfHoly: 0.12 }],
    [{ c_el: 1, c_el_a: 1 }, { smiteBig: 0.5, guardLight: 0.08, smiteJudge: 0, sunstrike: 0 }], [{ c_el: 1, c_el_a: 2 }, { smiteBig: 0.5 + 0.4, guardLight: 0.1 + 0.02, smiteJudge: 3, sunstrike: 0 }], [{ c_el: 1, c_el_a: 3 }, { smiteBig: 0.5 + 0.4 + 0.5, guardLight: 0.12 + 0.02 + 0.04, smiteJudge: 3, sunstrike: 4 }],
    [{ c_el: 1, c_el_b: 1 }, { smiteMul: 0.3, smiteBeam: 0.5, beamJumps: 0, prismN: 0 }], [{ c_el: 1, c_el_b: 2 }, { smiteMul: 0.4, beamJumps: 1, prismN: 0 }], [{ c_el: 1, c_el_b: 3 }, { smiteMul: 0.5, beamJumps: 1, prismN: 4, prismRad: 0.05 }],
  ];
  for (const [b, want] of rows) { const st = build(0, b); for (const k in want) near(st[k], want[k], 1e-9, JSON.stringify(b) + ' ' + k); }
  ok(ED.CLASS_CARDS.cleric.attack.forks.join() === 'c_atk_h,c_atk_s' && ED.boonText('c_atk_h', 3).indexOf('Solar Flare') > 0 && !/[{}\[\]]/.test(ED.boonText('c_s1_b', 3)), 'card text and fork table');
}

// ---------------- Dawnbringer: a wave every 2nd attack at +30%; the Sacred Lantern gains waves ----------------
{
  const { w, p } = stage({ c_atk: 1 }); let k = 0, dmg = 0, rate = [];
  for (let i = 0; i < 6; i++) { w.projs.length = 0; w.playerAttack(p, 0); const ws = waves(w); k += ws.length; rate.push(ws.length); if (ws.length) dmg = ws[0].dmg; }
  ok(rate.join() === '0,1,0,1,0,1', `Dawnbringer: a wave on attacks 2, 4, 6 (got ${rate.join()})`);
  near(dmg, 23 * 0.9 * 1.3, 1e-6, 'Holy Mace wave damage 23 x 0.9 x 1.3');
  const base = stage({}); let b = 0; for (let i = 0; i < 6; i++) { base.w.projs.length = 0; base.w.playerAttack(base.p, 0); b += waves(base.w).length; }
  ok(b === 2, `no route: a wave every 3rd attack (got ${b})`);
  const L = stage({ c_atk: 1 }, 2); let lw = 0, ld = 0;
  for (let i = 0; i < 6; i++) { L.w.projs.length = 0; L.w.playerAttack(L.p, 0); const ws = waves(L.w); lw += ws.length; if (ws.length) ld = ws[0].dmg; }
  ok(lw === 3 && L.p.stats.weapon.wave.every === 3 && L.p.stats.weapon.wave.mul === 0.6, 'Sacred Lantern gains a wave (60%) with Dawnbringer'); near(ld, 16.9 * 0.6 * 1.3, 1e-6, 'Lantern wave damage 16.9 x 0.6 x 1.3');
  ok(!stage({}, 2).p.stats.weapon.wave, 'the Lantern has no wave without Dawnbringer');
}

// ---------------- Sunhammer: wide, far, stunning waves; Solar Flare ----------------
{
  const { w, p } = stage({ c_atk: 1, c_atk_h: 1 }); w.playerAttack(p, 0); w.projs.length = 0; w.playerAttack(p, 0);
  const wv = waves(w)[0], wp = p.stats.weapon;
  near(wv.r, 32, 1e-9, 'Sunhammer wave is twice as wide (16 x 2)'); near(wv.life, 0.55 * 1.6, 1e-9, 'Sunhammer wave travels 60% farther'); near(wv.stun, 0.4, 1e-9, 'Sunhammer wave stuns 0.4 s');
  near(wv.dmg, wp.dmg * 0.9 * 1.3, 1e-6, 'Sunhammer wave damage'); ok(p.stats.heavy && wv.wpn, 'Sunhammer is a Heavy weapon and the wave a weapon hit');
  // the stun: a common foe is stunned (and repeating-stun cooldown starts), an elite for half, a boss never
  const st0 = (kind) => { const s = stage({ c_atk: 1, c_atk_h: 1 }); const e = foe(s.w, s.p.x + 70, s.p.y); if (kind === 'elite') e.elite = 'swift'; if (kind === 'boss') e.boss = true; s.w.playerAttack(s.p, 0); s.w.projs.length = 0; s.w.playerAttack(s.p, 0); let got = 0; for (let i = 0; i < 90 && !got; i++) { s.w.update(DT); if (e.hp < 5000) got = e.stun + (e.stunCd > 0 ? 0.0001 : 0); } return got; };
  ok(st0('common') > 0.3 && st0('common') < 0.5, `wave stuns a common foe (${st0('common')})`); ok(st0('elite') > 0.1 && st0('elite') < 0.25, `elite stun halved (${st0('elite')})`); ok(!(st0('boss') > 0.0002), 'bosses are never stunned');
  const r2 = stage({ c_atk: 1, c_atk_h: 2 }); r2.w.playerAttack(r2.p, 0); r2.w.projs.length = 0; r2.w.playerAttack(r2.p, 0);
  near(waves(r2.w)[0].dmg, r2.p.stats.weapon.dmg * 0.9 * 1.4, 1e-6, 'Sunhammer rank 2: waves deal +10% more');
  // Solar Flare (rank 2): the wave ends in a burst of r50 at 80% of the wave, with no wave contact needed
  const f3 = stage({ c_atk: 1, c_atk_h: 2 }), flare = (S, x, y, why) => { const pr = { kind: 'wave', x, y, dmg: 100, infAdd: null }; ED.CLS.cleric.projEnd.call(S.w, pr, S.p, why); };
  const fin = foe(f3.w, f3.p.x + 40, f3.p.y), fout = foe(f3.w, f3.p.x + 70, f3.p.y + 1); flare(f3, f3.p.x, f3.p.y, 'life'); // 40 px from the burst: inside; 70 px: outside r50 + the foe's radius 11
  const sol = evs(f3.w, 'solar')[0]; ok(sol && sol.r === 50, 'Solar Flare event r50'); near(lost(fin), 100 * 0.8 * f3.p.stats.dmg, 0.05, 'Solar Flare deals 80% of the wave to a foe in r50'); ok(lost(fout) === 0, 'Solar Flare does not reach past r50');
  // end to end: a wave that runs into the east wall bursts there (the room is too small for the full range)
  const ew = stage({ c_atk: 1, c_atk_h: 2 }); let wall = ew.p.x; while (!ED.Dungeon.blocksShots(ED.Dungeon.tileAt(ew.w.room, wall, ew.p.y), false)) wall += 2;
  const bf = foe(ew.w, wall - 24, ew.p.y); ew.w.playerAttack(ew.p, 0); ew.w.projs.length = 0; ew.w.playerAttack(ew.p, 0); const wd = waves(ew.w)[0].dmg; let sn = 0; run(ew.w, 1.2, () => { sn += evs(ew.w, 'solar').length; ew.w.fx.length = 0; });
  ok(sn === 1 && lost(bf) > wd * ew.p.stats.dmg * 1.3, `a wave that ends at a wall bursts once, the foe there takes wave + burst (${lost(bf).toFixed(1)} of ${(wd * ew.p.stats.dmg).toFixed(1)} + 80%)`);
  const wa = stage({ c_atk: 1, c_atk_h: 2 }); wa.p.stats.area = 1; flare(wa, wa.p.x, wa.p.y, 'life'); ok(evs(wa.w, 'solar')[0].r === 50, 'Solar Flare radius is fixed at 50 whatever the area stat');
  const nf = stage({ c_atk: 1, c_atk_h: 1 }); flare(nf, nf.p.x, nf.p.y, 'life'); ok(evs(nf.w, 'solar').length === 0, 'no Solar Flare below rank 2');
}

// ---------------- Crusader: waves steer inside 25 degrees only; Litany fan every 16th attack (rank 2) ----------------
{
  const cone = 25 * Math.PI / 180, ang = (pr) => Math.atan2(pr.vy, pr.vx);
  const steer = (deg) => { const { w, p } = stage({ c_atk: 1, c_atk_s: 1 }); const a = deg * Math.PI / 180; foe(w, p.x + Math.cos(a) * 170, p.y + Math.sin(a) * 170); w.playerAttack(p, 0); w.projs.length = 0; w.playerAttack(p, 0); const wv = waves(w)[0]; for (let i = 0; i < 12; i++) w.updateProjectiles(DT); return ang(wv); };
  ok(steer(15) > 0.05 && steer(15) <= cone + 1e-9, `Crusader wave steers toward a foe 15 degrees off (${steer(15).toFixed(3)} rad)`); near(steer(40), 0, 1e-9, 'Crusader wave ignores a foe 40 degrees off');
  const one = stage({ c_atk: 1, c_atk_s: 1 }); one.w.playerAttack(one.p, 0); one.w.projs.length = 0; one.w.playerAttack(one.p, 0); const wv = waves(one.w)[0];
  near(wv.homing, 2, 1e-9, 'waveHome turn rate'); near(wv.homeCone, cone, 1e-9, 'cone 25 degrees'); near(wv.dmg, one.p.stats.weapon.dmg * 0.9 * 1.4, 1e-6, 'Crusader wave +10% (+30% Dawnbringer)'); ok(one.p.stats.swift, 'Crusader is a Swift weapon');
  const lit = stage({ c_atk: 1, c_atk_s: 2 }); const per = [], fan = [];
  for (let i = 0; i < 32; i++) { lit.w.projs.length = 0; lit.w.playerAttack(lit.p, 0); const ws = waves(lit.w); per.push(ws.length); if (ws.length === 3) fan.push(ws.map(q => +ang(q).toFixed(3)).sort((a, b) => a - b)); }
  ok(per.join() === '0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,3,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,3', `Litany (rank 2): the 16th and 32nd attack send three waves (got ${per.join()})`);
  ok(fan.length === 2 && fan.every(f => Math.abs(f[0] + 0.25) < 0.01 && Math.abs(f[1]) < 0.01 && Math.abs(f[2] - 0.25) < 0.01), 'Litany fan is -0.25, 0, +0.25 rad');
  const fw = waves(lit.w); near(fw[0].dmg, fw[1].dmg, 1e-9, 'fan waves deal equal damage'); ok(fw.every(q => q.homeCone > 0 && Math.abs(q.homeA0 - ang(q)) < 0.01), 'each fan wave steers around its own launch angle');
  const nolit = stage({ c_atk: 1, c_atk_s: 1 }); let m = 0; for (let i = 0; i < 32; i++) { nolit.w.projs.length = 0; nolit.w.playerAttack(nolit.p, 0); m += waves(nolit.w).length === 3 ? 1 : 0; } ok(m === 0, 'no Litany below rank 2');
}

// ---------------- Sanctum: radius, length (60% of the cooldown at most), damage, damage reduction ----------------
{
  const st = build(0, { c_s1: 1 }), N = ED.Stats.skillNums('sanctuary', st), q = N.p.zone;
  near(q.r, 130, 1e-9, 'Sanctum radius 100 x 1.3'); near(q.dur, 5.5, 1e-9, 'Sanctum lasts 3.5 + 2 s'); near(q.dmg, (13.5 + 1.2 * 23) * 1.5, 1e-9, 'Sanctum damage +50%'); near(N.cdEff, 11, 1e-9, 'Sanctuary cooldown 11 s');
  const quick = build(0, { c_s1: 1 }); quick.cdr = 0.4; quick.sn = null; near(ED.Stats.skillNums('sanctuary', quick).p.zone.dur, 0.6 * 11 * 0.6, 1e-9, 'Sanctuary lasts at most 60% of its cooldown (cdr 40%: 3.96 s)');
  const { w, p } = stage({ c_s1: 1 }); const a = ally(w, 'ranger', p.x + 40, p.y); a.stats.armor = p.stats.armor; const hit = (who) => { who.hp = who.maxHp; who.invuln = 0; w.hurtPlayer(who, 100, {}); return who.maxHp - who.hp; };
  const base = hit(a);
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 40, y: p.y }, 0);
  const z = w.zones.find(q2 => q2.kind === 'sanct');
  ok(z && Math.abs(z.x - (p.x + 40)) < 1 && z.r === 130 && !z.follow, 'Sanctuary lands on the cursor'); near(z.dr, 0.25, 1e-9, 'zone stores 25% damage reduction'); near(hit(a) / base, 0.75, 0.02, 'allies inside take 25% less damage');
  a.x = p.x + 400; near(hit(a) / base, 1, 0.01, 'no reduction outside');
  w.zones.push({ kind: 'sanct', x: a.x, y: a.y, r: 50, dr: 0.9, t: 0, dur: 9, team: 0, id: 98 }); near(hit(a) / base, 0.6, 0.02, 'a zone cuts damage by 40% at most');
  w.zones.push({ kind: 'sanct', x: a.x, y: a.y, r: 50, dr: 0.25, t: 0, dur: 9, team: 0, id: 99 }); near(hit(a) / base, 0.6, 0.02, 'overlapping Sanctuaries: only the best counts');
}

// ---------------- Holy Fury: +40% damage, a 1 s stun when cast; Hallowed Ground Judges the foes inside ----------------
{
  const st = build(0, { c_s1: 1, c_s1_a: 1 }); near(ED.Stats.skillNums('sanctuary', st).p.zone.dmg, (13.5 + 1.2 * 23) * 1.5 * 1.2, 1e-9, 'Holy Fury zone damage x1.5 x1.2');
  const { w, p } = stage({ c_s1: 1, c_s1_a: 1 }); const e = foe(w, p.x + 60, p.y), el = foe(w, p.x + 70, p.y + 10, { elite: 'swift' }), bs = foe(w, p.x + 80, p.y - 10); bs.boss = true; const out = foe(w, p.x + 380, p.y);
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 60, y: p.y }, 0);
  const sk = evs(w, 'skill')[0]; ok(sk && sk.hf === 1 && !sk.au && sk.k === 'sanctuary', 'skill event carries hf (Holy Fury)');
  near(e.stun, 0.5, 1e-9, 'foe inside is stunned 0.5 s'); near(el.stun, 0.25, 1e-9, 'elite stun halved'); near(bs.stun, 0, 1e-9, 'bosses are not stunned'); near(out.stun, 0, 1e-9, 'foe outside is not stunned'); ok(e.stunCd > 0, 'cast stun sets the stun cooldown');
  const r1 = stage({ c_s1: 1, c_s1_a: 1 }); const e1 = foe(r1.w, r1.p.x + 60, r1.p.y); r1.w.playerSkill(r1.p, 0, { x0: r1.p.x, y0: r1.p.y, x: r1.p.x + 60, y: r1.p.y }, 0); run(r1.w, 1); ok(lost(e1) > 0 && e1.judged <= 0, 'Holy Fury burns foes inside; no Judged below rank 2');
  const g = stage({ c_s1: 1, c_s1_a: 2 }); const gi = foe(g.w, g.p.x + 60, g.p.y), go = foe(g.w, g.p.x + 380, g.p.y);
  g.w.playerSkill(g.p, 0, { x0: g.p.x, y0: g.p.y, x: g.p.x + 60, y: g.p.y }, 0); run(g.w, 0.2); ok(gi.judged > 0.3 && go.judged <= 0, 'Hallowed Ground: foes inside are Judged, foes outside are not');
  const hp1 = gi.hp; g.w.hitEnemy(gi, 100, { p: g.p, kind: 'weapon', crit: false }); near(hp1 - gi.hp, 100 * 1.2 * g.p.stats.dmg, 0.5, 'Judged foes take +20%');
  run(g.w, 7); ok(!(gi.judged > 0), 'Judged fades 0.6 s after the zone ends');
}

// ---------------- Aura of Faith: centred on the Cleric, moves with them, deals 40% less; Embolden ----------------
{
  const { w, p } = stage({ c_s1: 1, c_s1_b: 2 }); const a = ally(w, 'ranger', p.x + 40, p.y), far = ally(w, 'knight', p.x + 500, p.y);
  const st = p.stats, N = ED.Stats.skillNums('sanctuary', st);
  ok(N.aim === 'self', 'Aura of Faith casts on the Cleric (aim self)'); near(N.p.zone.dmg, (13.5 + 1.2 * 23) * 1.5 * 1.6, 1e-9, 'Aura damage x1.5 x1.6 (rank 2)');
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 150, y: p.y + 90 }, 0); // the cursor is ignored
  const z = w.zones.find(q => q.kind === 'sanct'); ok(z && z.follow === p.pid && z.x === p.x && z.y === p.y, 'zone is at the caster and follows them'); near(z.dr, 0.15 + 0.22, 1e-9, 'Aura rank 2: 15% + 10% + 10% + 2%');
  const sk = evs(w, 'skill')[0]; ok(sk && sk.au === 1 && sk.x === Math.round(p.x), 'skill event carries au'); w.fx.length = 0;
  p.x += 30; run(w, 0.05); ok(Math.abs(z.x - p.x) < 1e-9 && Math.abs(z.y - p.y) < 1e-9, 'the aura moves with the Cleric');
  ok(a.auraT > 0, 'allies inside are Emboldened'); near(a.auraV, 0.1, 1e-9, 'Embolden +10%'); ok(!(p.auraT > 0), 'the Cleric itself is not Emboldened'); ok(!(far.auraT > 0), 'allies outside are not');
  const hitBy = (who) => { const e = foe(w, who.x + 20, who.y); const h = e.hp; w.hitEnemy(e, 100, { p: who, kind: 'weapon', crit: false }); return h - e.hp; };
  a.auraT = 0; const noBuff = hitBy(a); a.auraT = 1; a.auraV = 0.1; near(hitBy(a) / noBuff, (a.stats.dmg + 0.1) / a.stats.dmg, 0.01, 'Embolden adds 10% to the damage multiplier');
  run(w, 0.5); a.x = p.x + 600; run(w, 0.5); ok(!(a.auraT > 0), 'Embolden lapses 0.3 s after leaving the aura');
  const r1 = stage({ c_s1: 1, c_s1_b: 1 }); r1.w.playerSkill(r1.p, 0, { x0: r1.p.x, y0: r1.p.y, x: r1.p.x, y: r1.p.y }, 0); const al = ally(r1.w, 'ranger', r1.p.x + 20, r1.p.y); run(r1.w, 0.1); ok(!(al.auraT > 0), 'no Embolden before rank 2');
  near(build(0, { c_s1: 1, c_s1_b: 1 }).sanctDR, 0.2, 1e-9, 'Aura rank 1 adds 10% to Sanctum DR'); near(build(0, { c_s1: 1, c_s1_b: 2 }).sanctDR, 0.22, 1e-9, 'Aura +2% damage reduction per rank');
}

// ---------------- Hammer of Judgment: damage, range, Judged length, recharge ----------------
{
  const base = stage({ c_s2: 0 }), s = stage({ c_s2: 1 });
  const turnAt = (S) => { let t = 0; const real = ED.Dungeon.blocksShots; ED.Dungeon.blocksShots = () => false; S.w.playerSkill(S.p, 0, {}, 1); const h = S.p.hammers[0]; for (let i = 0; i < 120 && !t; i++) { S.w.update(DT); if (h.leg === 1 && !t) t = h.t; } ED.Dungeon.blocksShots = real; return t; }; // the staged room is too small for the full flight: walls off, time the turn
  const tb = turnAt(base), tc = turnAt(s);
  near(tb, 0.55, 0.02, 'the hammer turns after 0.55 s'); near(tc, 0.55 * 1.4, 0.02, 'Hammer of Judgment flies 40% farther (turns after 0.77 s)');
  near(ED.Stats.skillNums('judgment', s.p.stats).p.leg.dmg, (24.3 + 1.4 * 23) * 1.25, 1e-9, 'Judgment leg damage +25%'); near(s.p.stats.skill2Cd, 9 * (1 - 0.167), 1e-9, 'Judgment recharges 17% faster (7.5 s)');
  const j = stage({ c_s2: 1 }); const e = foe(j.w, j.p.x + 60, j.p.y); j.w.playerSkill(j.p, 0, {}, 1); let t = 0; run(j.w, 0.4, () => { if (e.judged > 0 && !t) t = e.judged; });
  near(t, 5, 0.1, 'Judged lasts 4 + 1 s'); ok(e.judgeOwner === 'p0' && e.judgeCast === 1, 'a hammer hit stamps the cast');
  const jb = stage({}); const eb = foe(jb.w, jb.p.x + 60, jb.p.y); jb.w.playerSkill(jb.p, 0, {}, 1); let t4 = 0; run(jb.w, 0.4, () => { if (eb.judged > 0 && !t4) t4 = eb.judged; }); near(t4, 4, 0.1, 'Judged lasts 4 s without the card');
  // the hit that Judges lands on a Judged foe: +20% in the leg itself
  const first = stage({}); const fe = foe(first.w, first.p.x + 60, first.p.y); first.w.playerSkill(first.p, 0, {}, 1); let got = 0; run(first.w, 0.3, () => { if (!got && fe.hp < 5000) got = lost(fe); });
  near(got, ED.Stats.skillNums('judgment', first.p.stats).p.leg.dmg * first.p.stats.dmg * 1.2 * first.w.affC('holy'), 0.05, 'the leg that Judges is itself boosted by 20% (Judged is set first; Holy affinity of the stratum)');
}

// ---------------- Twin Hammers, Second Flight ----------------
{
  const count = (boons, secs) => { const S = stage(boons); const e = foe(S.w, S.p.x + 40, S.p.y); let hits = 0, turns = []; const orig = S.w.hitEnemy; S.w.hitEnemy = function (f, d, src) { if (src && src.part === 'judgment.leg') hits++; return orig.call(this, f, d, src); }; S.w.playerSkill(S.p, 0, {}, 1); const n0 = S.p.hammers.length; run(S.w, secs, () => { for (const ev of S.w.fx) if (ev.t === 'hturn') turns.push(ev.n); S.w.fx.length = 0; }); return { hits, n0, left: S.p.hammers.length, projs: S.w.projs.filter(q => q.kind === 'hammer').length, e, turns, S }; };
  const one = count({ c_s2: 1 }, 5), tw = count({ c_s2: 1, c_s2_a: 1 }, 5), sf = count({ c_s2: 1, c_s2_a: 2 }, 12);
  ok(one.n0 === 1 && one.hits === 2 && one.turns.join() === '1,4', `one hammer hits a foe on the axis twice (out and back); turns ${one.turns.join()}`);
  ok(tw.n0 === 2 && tw.hits === 4, `Twin Hammers: two hammers, two legs each (hits ${tw.hits})`);
  const th = stage({ c_s2: 1, c_s2_a: 1 }); th.w.playerSkill(th.p, 0, {}, 1); const angs = th.p.hammers.map(h => Math.atan2(h.pr.vy, h.pr.vx)).sort((a, b) => a - b); near(angs[0], -0.2, 1e-9, 'V angle -0.2'); near(angs[1], 0.2, 1e-9, 'V angle +0.2');
  const tl = ED.Stats.skillNums('judgment', th.p.stats).p.leg.dmg; near(tl, (24.3 + 1.4 * 23) * 1.25 * 0.55, 1e-9, 'each Twin hammer deals 55%');
  ok(sf.n0 === 2 && sf.hits === 8, `Second Flight: four legs each (hits ${sf.hits})`); ok(sf.turns.slice(0, 4).sort().join() === '1,1,2,2' && sf.left === 0 && sf.projs === 0, `Second Flight turns ${sf.turns.join()} and the hammers are gone`);
  { const S = stage({ c_s2: 1, c_s2_a: 2 }); near(S.p.stats.secondFlight, 0.55, 1e-9, 'Second Flight deals 55% of a hit'); const e = foe(S.w, S.p.x + 40, S.p.y), muls = []; const orig = S.w.hitEnemy; S.w.hitEnemy = function (f, d, src) { if (src && src.part === 'judgment.leg') muls.push(src.mul || 1); return orig.call(this, f, d, src); }; S.w.playerSkill(S.p, 0, {}, 1); run(S.w, 12); ok(muls.length === 8 && muls.filter(m => m === 1).length === 4 && muls.filter(m => Math.abs(m - 0.55) < 1e-9).length === 4, `legs 1-2 at full damage, the second flight at 55% (${muls.join()})`); void e; }
  const rk = build(0, { c_s2: 1, c_s2_a: 2 }); near(ED.Stats.skillNums('judgment', rk).p.leg.dmg, (24.3 + 1.4 * 23) * 1.25 * 1.1 * 0.55, 1e-9, 'Twin Hammers rank 2: +10%');
  // a wall on the way out turns the hammer (and the second out leg too)
  const wl = stage({ c_s2: 1, c_s2_a: 2 }); wl.w.playerSkill(wl.p, Math.PI, {}, 1); let turned = false; run(wl.w, 0.1); for (let i = 0; i < 400 && wl.p.hammers.length; i++) { wl.w.update(DT); if (wl.p.hammers.some(h => h.leg >= 1)) turned = true; } ok(turned, 'a hammer that meets a wall turns for home');
}

// ---------------- Verdict: weaken, queued burst, Sentence ----------------
{
  const { w, p } = stage({ c_s2: 1, c_s2_b: 1 });
  const jt = foe(w, p.x + 60, p.y), jb = foe(w, p.x + 70, p.y + 14); jb.boss = true; w.playerSkill(p, 0, {}, 1); run(w, 0.4);
  ok(jt.weakT > 4 && Math.abs(jt.weakV - 0.5) < 1e-9 && jb.weakT > 4 && Math.abs(jb.weakV - 0.25) < 1e-9, 'Judged foes are weakened by 50% (bosses 25%)');
  const q = ally(w, 'knight', p.x, p.y - 60); q.stats.armor = 0; const dmgFrom = (e) => { q.hp = q.maxHp; q.invuln = 0; w.hurtPlayer(q, 100, { e }); return q.maxHp - q.hp; };
  const plain = foe(w, p.x + 900, p.y); const full = dmgFrom(plain); near(dmgFrom(jt) / full, 0.5, 0.02, 'a weakened foe deals 50% less'); near(dmgFrom(jb) / full, 0.75, 0.02, 'a weakened boss deals 25% less');
  jt.weakT = 0; near(dmgFrom(jt) / full, 1, 0.01, 'the weaken ends with the timer');
}
{
  const { w, p } = stage({ c_s2: 1, c_s2_b: 1 }); const bx = p.x - 120, by = p.y;
  const dead = foe(w, bx, by), near1 = foe(w, bx + 40, by), el = foe(w, bx, by + 50, { elite: 'swift' }), bs = foe(w, bx - 40, by - 30); bs.boss = true; const far = foe(w, bx, by + 140), plainDead = foe(w, bx + 100, by - 100);
  dead.judged = 5; dead.judgeOwner = p.pid; dead.judgeCast = 1; dead.hp = 5;
  w.hitEnemy(dead, 999, { p, kind: 'weapon', crit: false }); ok(dead.hp <= 0, 'the Judged foe dies'); near(near1.stun, 0, 1e-9, 'the burst is queued, not instant'); ok(w.chainQ.some(en => en.kind === 'verdict'), 'Verdict queues a payoff');
  let stunN = 0, stunE = 0, stunB = 0; for (let i = 0; i < 40 && !evs(w, 'verdict').length; i++) { w.update(DT); if (evs(w, 'verdict').length) { stunN = near1.stun; stunE = el.stun; stunB = bs.stun; } }
  const v = ED.Stats.skillNums('judgment', p.stats).p.verdict, vev = evs(w, 'verdict')[0];
  near(v.dmg, (27 + 3 * 23) * 1.25 * 2.5, 1e-9, 'Verdict burst 96 x s2Dmg x the card 2.5'); near(v.r, 70, 1e-9, 'Verdict radius 70'); ok(vev && vev.r === 70 && Math.abs(vev.x - dead.x) < 1, 'verdict event at the dead foe');
  near(lost(near1), v.dmg * p.stats.dmg * w.affC(p.stats.element), 0.2, 'burst damage to a foe within 70 (Holy, class affinity)'); ok(lost(far) === 0 && lost(plainDead) === 0, 'foes beyond 70 are untouched');
  near(stunN, 0.4, 0.01, 'burst stun 0.4 s'); ok(Math.hypot(el.x - dead.x, el.y - dead.y) < 70 + el.r && stunE > 0.19 && stunE < 0.21, `elite burst stun is half (${stunE})`); ok(stunB === 0 && lost(bs) > 0, 'bosses take the burst but are not stunned');
  const q2 = stage({ c_s2: 1, c_s2_b: 1 }); const d2 = foe(q2.w, q2.p.x - 120, q2.p.y), n2 = foe(q2.w, q2.p.x - 80, q2.p.y); d2.hp = 5; q2.w.hitEnemy(d2, 99, { p: q2.p, kind: 'weapon', crit: false }); run(q2.w, 0.3); ok(lost(n2) === 0, 'a foe that was not Judged bursts nothing');
  const q3 = stage({ c_s2: 1, c_s2_b: 1 }); const d3 = foe(q3.w, q3.p.x - 120, q3.p.y), n3 = foe(q3.w, q3.p.x - 80, q3.p.y); d3.judged = 5; d3.hp = 5; let nv = 0; q3.w.hitEnemy(d3, 99, { p: q3.p, kind: 'weapon', crit: false }); run(q3.w, 0.3, () => { nv += evs(q3.w, 'verdict').length; q3.w.fx.length = 0; });
  ok(nv === 1 && lost(n3) > 0, 'a Judged death with no stamp (another Judge) still bursts for the Verdict owner');
  const q4 = stage({ c_s2: 1 }); const d4 = foe(q4.w, q4.p.x - 120, q4.p.y), n4 = foe(q4.w, q4.p.x - 80, q4.p.y); d4.judged = 5; d4.hp = 5; q4.w.hitEnemy(d4, 99, { p: q4.p, kind: 'weapon', crit: false }); run(q4.w, 0.3); ok(lost(n4) === 0, 'no Verdict burst without the card');
}
{ // Sentence: the burst Judges the foes it leaves standing (the blow itself is not boosted); a Judged foe that dies later bursts in turn; each death pays out once
  const { w, p } = stage({ c_s2: 1, c_s2_b: 2 }); const bx = p.x - 150, by = p.y;
  const d = foe(w, bx, by), b = foe(w, bx + 50, by), c = foe(w, bx + 100, by), z = foe(w, bx + 100, by + 150); d.judged = 5; d.hp = 5;
  let nv = 0; w.hitEnemy(d, 99, { p, kind: 'weapon', crit: false }); run(w, 0.3, () => { nv += evs(w, 'verdict').length; w.fx.length = 0; });
  const v = ED.Stats.skillNums('judgment', p.stats).p.verdict;
  ok(nv === 1 && b.judged > 4 && b.weakT > 4 && !(c.judged > 0) && lost(c) === 0 && lost(z) === 0, `Sentence: the burst Judges (and weakens) the foe it hit, not those beyond r70 (${nv} burst)`);
  near(lost(b), v.dmg * p.stats.dmg * w.affC(p.stats.element), 0.2, 'the burst hits before it Judges: no +20% on that blow');
  b.hp = 5; w.hitEnemy(b, 99, { p, kind: 'weapon', crit: false }); nv = 0; run(w, 0.3, () => { nv += evs(w, 'verdict').length; w.fx.length = 0; });
  ok(b.hp <= 0 && nv === 1 && c.judged > 4 && lost(c) > 0 && lost(z) === 0, `Sentence: the Judged neighbour bursts in turn and Judges the next foe (${nv} burst)`);
  const no = stage({ c_s2: 1, c_s2_b: 1 }); const d3 = foe(no.w, no.p.x - 150, no.p.y), b3 = foe(no.w, no.p.x - 110, no.p.y); d3.judged = 5; d3.hp = 5; no.w.hitEnemy(d3, 99, { p: no.p, kind: 'weapon', crit: false }); run(no.w, 0.3); ok(lost(b3) > 0 && !(b3.judged > 0), 'no Sentence at rank 1');
}
{ // the kill shield of Judgment ignores fodder (shields do), but a Verdict burst still comes from it
  const { w, p } = stage({ c_s2: 1, c_s2_b: 1 }); const e = foe(w, p.x + 80, p.y), n = foe(w, p.x + 100, p.y); e.fodder = true; w.playerSkill(p, 0, {}, 1); run(w, 0.3); e.hp = 3; p.shield = 0; w.hitEnemy(e, 99, { p, kind: 'weapon', crit: false }); run(w, 0.3); near(p.shield, 0, 1e-9, 'a Judged fodder foe dying gives no Judgment shield'); ok(lost(n) > 0, 'but its Verdict burst still lands');
}
{ // the kill shield of Judgment (3% max HP, once per cast) is kept
  const { w, p } = stage({ c_s2: 1 }); const e = foe(w, p.x + 80, p.y), e2 = foe(w, p.x + 90, p.y + 10); w.playerSkill(p, 0, {}, 1); run(w, 0.3); e.hp = 3; e2.hp = 3; p.shield = 0;
  w.hitEnemy(e, 99, { p, kind: 'weapon', crit: false }); w.hitEnemy(e2, 99, { p, kind: 'weapon', crit: false }); near(p.shield, 0.03 * p.maxHp, 0.01, 'Judgment kill shield 3% once per cast');
  const st = stage({ c_s2: 1 }); const s1 = foe(st.w, st.p.x + 80, st.p.y); st.w.playerSkill(st.p, 0, {}, 1); run(st.w, 0.3); ok(s1.judgeUntil > st.w.time + 4, 'a hammer hit stamps the end of its own Judged window');
  s1.judgeUntil = st.w.time - 1; s1.judged = 3; s1.hp = 3; st.p.shield = 0; st.w.hitEnemy(s1, 99, { p: st.p, kind: 'weapon', crit: false }); near(st.p.shield, 0, 1e-9, 'a foe Judged by another source after the hammer window lapsed gives no kill shield');
}

// ---------------- Radiant Faith: weapon Radiance, class skills +25% ----------------
{
  const rad = (boons, relic) => { const S = stage(boons); if (relic) { S.p.stats.holyInfuse = relic; S.p.stats.holyAdd = undefined; } const e = foe(S.w, S.p.x + 30, S.p.y); e.maxHp = e.hp = 1e9; const h = e.hp; S.w.playerAttack(S.p, 0); return { rad: e.rad, dealt: h - e.hp, S, e }; };
  const none = rad({}), rf = rad({ c_el: 1 }); ok(none.rad === 0, 'no Radiance without a gate or Radiant Faith');
  near(rf.rad, rf.dealt * 0.12 * rf.S.w.elemAff('holy'), 0.01 * rf.rad + 1e-6, 'weapon hit stores 12% of its damage as Radiance (x Holy affinity)');
  const cons = rad({ c_el: 1 }, 0.3), only = rad({}, 0.3); near(cons.rad / cons.dealt, only.rad / only.dealt, 1e-9, 'Consecrate (30%) counts instead when higher');
  const lowc = rad({ c_el: 1 }, 0.08); near(lowc.rad / lowc.dealt, 0.12 * rf.S.w.elemAff('holy'), 1e-9, 'Radiant Faith counts instead of a lower Consecrate');
  const L = stage({ c_el: 1 }, 2); const el = foe(L.w, L.p.x + 30, L.p.y); L.w.playerAttack(L.p, 0); run(L.w, 0.3); ok(el.rad > 0, 'Sacred Lantern orbs store Radiance too');
  const wv = stage({ c_atk: 1, c_el: 1 }); wv.w.playerAttack(wv.p, 0); wv.w.projs.length = 0; wv.w.playerAttack(wv.p, 0); near(waves(wv.w)[0].infAdd.holy, 0.12, 1e-9, 'waves carry the Radiance too');
  const leg = (boons) => { const S = stage(boons); const e = foe(S.w, S.p.x + 60, S.p.y); const h = e.hp; S.w.hitEnemy(e, 100, S.w.partSrc(S.p, ED.Stats.skillNums('judgment', S.p.stats), 'leg', {})); return h - e.hp; };
  const dm = stage({}).p.stats.dmg; near(leg({ c_el: 1 }) / leg({}), (dm + 0.25) / dm, 0.01, 'class skills +25% Holy damage (0.25 added to the damage multiplier)');
  const wk = (boons) => { const S = stage(boons); const e = foe(S.w, S.p.x + 30, S.p.y); const h = e.hp; S.w.hitEnemy(e, 100, { p: S.p, kind: 'weapon', crit: false, noProc: true }); return h - e.hp; }; near(wk({ c_el: 1 }), wk({}), 1e-9, 'weapon hits get no class-element bonus');
}

// ---------------- Guardian Light: bigger Smites on elites and bosses, a damage buff for the heroes they shield ----------------
{
  const sm = (boons, kind) => { const S = stage(boons); const e = foe(S.w, S.p.x + 60, S.p.y, kind === 'elite' ? { elite: 'swift' } : undefined); if (kind === 'boss') e.boss = true; e.maxHp = e.hp = 1e9; const h = e.hp; smiteIt(S.w, S.p, e, 1000); return { lost: h - e.hp, S, e }; };
  const b0 = sm({ c_el: 1 }, 'trash'), b1 = sm({ c_el: 1, c_el_a: 1 }, 'trash'), e0 = sm({ c_el: 1 }, 'elite'), e1 = sm({ c_el: 1, c_el_a: 1 }, 'elite'), bo1 = sm({ c_el: 1, c_el_a: 1 }, 'boss'), bo0 = sm({ c_el: 1 }, 'boss');
  near(b1.lost / b0.lost, 1, 1e-9, 'Guardian Light does not change Smites on common foes'); near(e1.lost / e0.lost, 1.5, 1e-9, 'Smites on elites +50%'); near(bo1.lost / bo0.lost, 1.5, 1e-9, 'Smites on bosses +50%');
  const S = stage({ c_el: 1, c_el_a: 1 }); const q = ally(S.w, 'knight', S.p.x + 100, S.p.y), far = ally(S.w, 'ranger', S.p.x + 600, S.p.y); const e = foe(S.w, S.p.x + 60, S.p.y); e.maxHp = e.hp = 1e9; smiteIt(S.w, S.p, e, 1000);
  ok(S.p.glT === 6 && Math.abs(S.p.glV - 0.08) < 1e-9 && q.glT === 6 && Math.abs(q.glV - 0.08) < 1e-9 && !(far.glT > 0), 'heroes the Smite shields (within 160) get +8% for 6 s');
  const hitBy = (who) => { const t = foe(S.w, who.x + 20, who.y); const h = t.hp; S.w.hitEnemy(t, 100, { p: who, kind: 'weapon', crit: false }); return h - t.hp; };
  const buffed = hitBy(q); q.glT = 0; near(buffed / hitBy(q), (q.stats.dmg + 0.08) / q.stats.dmg, 0.01, 'Guardian Light adds 8% to the damage multiplier');
  const r2 = stage({ c_el: 1, c_el_a: 2 }); const e2 = foe(r2.w, r2.p.x + 60, r2.p.y); smiteIt(r2.w, r2.p, e2, 1000); near(r2.p.glV, 0.12, 1e-9, 'rank 2: +12% (+2% from Judging Light)');
  const nob = stage({ c_el: 1 }); const e3 = foe(nob.w, nob.p.x + 60, nob.p.y); smiteIt(nob.w, nob.p, e3, 1000); ok(!(nob.p.glT > 0) && !(e3.judged > 0), 'no buff and no Judged without the card');
  const jl = stage({ c_el: 1, c_el_a: 3 }); const e4 = foe(jl.w, jl.p.x + 60, jl.p.y); smiteIt(jl.w, jl.p, e4, 1000); near(e4.judged, 3, 1e-9, 'Judging Light: the smitten foe is Judged 3 s'); near(jl.p.glV, 0.18, 1e-9, 'rank 3: +18% (+2% Judging Light, +4% Sunstrike)');
  const hc = stage({ c_el: 1, c_el_a: 1 }); const e5 = foe(hc.w, hc.p.x + 60, hc.p.y); smiteIt(hc.w, hc.p, e5, 1000); hc.p.glT = 2; const gv = hc.p.glV; smiteIt(hc.w, hc.p, e5, 1000); near(hc.p.glV, gv, 1e-9, 'the buff is not refreshed while the Holy shield cooldown runs');
}

// ---------------- Prism: bigger Smites, a beam to the nearest other foe, Sunburst jumps ----------------
{
  const S = stage({ c_el: 1, c_el_b: 1 }); const a = foe(S.w, S.p.x + 100, S.p.y), b = foe(S.w, S.p.x + 160, S.p.y), c = foe(S.w, S.p.x + 100, S.p.y + 100), far = foe(S.w, S.p.x + 100, S.p.y + 300);
  a.maxHp = a.hp = 1e9; smiteIt(S.w, S.p, a, 1000);
  const smite = 1000 * 1.3; near(1e9 - a.hp, smite, 1e-6, 'Prism Smite +30%'); ok(S.w.chainQ.some(en => en.kind === 'beam'), 'the beam is a queued payoff'); ok(lost(b) === 0, 'the beam is not instant');
  let beams = []; run(S.w, 0.3, () => { for (const e of S.w.fx) if (e.t === 'chain' && e.k === 'b') beams.push(e); S.w.fx.length = 0; });
  near(lost(b), smite * 0.5, 0.01, 'the beam deals half the Smite to the nearest other foe'); ok(lost(c) === 0 && lost(far) === 0, 'only the nearest foe within 120 is struck'); ok(beams.length === 1 && beams[0].pts.length === 2, 'one beam event, two points');
  const T = stage({ c_el: 1, c_el_b: 2 }); const a2 = foe(T.w, T.p.x + 100, T.p.y), b2 = foe(T.w, T.p.x + 160, T.p.y), c2 = foe(T.w, T.p.x + 220, T.p.y), d2 = foe(T.w, T.p.x + 280, T.p.y), e2 = foe(T.w, T.p.x + 100, T.p.y + 400);
  a2.maxHp = a2.hp = 1e9; smiteIt(T.w, T.p, a2, 1000); let n2 = 0; run(T.w, 0.5, () => { for (const e of T.w.fx) if (e.t === 'chain' && e.k === 'b') n2++; T.w.fx.length = 0; });
  const big = 1000 * 1.4; near(lost(b2), big * 0.5, 0.01, 'Sunburst: the first beam'); near(lost(c2), big * 0.25, 0.01, 'Sunburst: the jump deals half again'); ok(lost(d2) === 0 && lost(e2) === 0 && n2 === 2, `the beam jumps once (${n2} beams) and stops`);
  const U2 = stage({ c_el: 1, c_el_b: 2 }); const a3 = foe(U2.w, U2.p.x + 100, U2.p.y); a3.maxHp = a3.hp = 1e9; smiteIt(U2.w, U2.p, a3, 1000); near(1e9 - a3.hp, 1400, 1e-6, 'Prism rank 2: Smites +40%');
  const lone = stage({ c_el: 1, c_el_b: 1 }); const solo = foe(lone.w, lone.p.x + 100, lone.p.y); solo.maxHp = solo.hp = 1e9; smiteIt(lone.w, lone.p, solo, 1000); run(lone.w, 0.3); ok(!lone.w.chainQ.length && lone.w.fx.filter(e => e.t === 'chain').length === 0, 'a lone Smite fires no beam');
  const nat = stage({ c_el: 1, c_el_b: 1 }); const x1 = foe(nat.w, nat.p.x + 100, nat.p.y), x2 = foe(nat.w, nat.p.x + 150, nat.p.y); nat.w.addRadiance(x1, nat.w.smiteAt(x1) / nat.w.elemAff('holy'), nat.p); run(nat.w, 0.3); ok(lost(x1) > 0 && lost(x2) > 0, 'a natural Smite (Radiance gauge) also fires the beam');
  const dead = stage({ c_el: 1, c_el_b: 1 }); const k1 = foe(dead.w, dead.p.x + 100, dead.p.y), k2 = foe(dead.w, dead.p.x + 150, dead.p.y); k1.maxHp = k1.hp = 100; smiteIt(dead.w, dead.p, k1, 1000); run(dead.w, 0.3); ok(k1.hp <= 0 && lost(k2) > 0, 'the beam still fires when the Smite kills its foe');
}

// ---------------- skill forms (rank 2: the rider, rank 3: the transform) ----------------
const spy = (w) => { const log = [], o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const d = o.call(this, e, b, s); if (s && (s.part || s.echo)) log.push({ part: s.part || 'echo', e, d, t: this.time, mul: s.mul, crit: s.critOut }); return d; }; return log; };
const partHits = (log, part) => log.filter(h => h.part === part);
const tap = (w) => { const all = []; return { all, step() { for (const ev of w.fx) all.push(ev); w.fx.length = 0; } }; };
const castSanct = (w, p, dx) => w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + (dx === undefined ? 60 : dx), y: p.y }, 0);
{ // card names, riders and transforms of the four Cleric skill forks
  const FORKS = { c_s1_a: ['Holy Fury', 'Hallowed Ground', 'Wrath of Heaven'], c_s1_b: ['Aura of Faith', 'Embolden', 'Aegis of Dawn'], c_s2_a: ['Twin Hammers', 'Second Flight', 'Hammerstorm'], c_s2_b: ['Verdict', 'Sentence', 'Final Judgment'] };
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
}
{ // Wrath of Heaven (c_s1_a rank 3): a nova over the whole circle at 140% of a second of Sanctuary damage, then a pillar every 0.5 s on a random foe inside at 15% of a tick, preferring foes not struck in the last second
  const setup = (rank, seed, crit) => {
    const S = stage({ c_s1: 1, c_s1_a: rank }, 0, seed); S.p.stats.crit = crit || 0; S.N = ED.Stats.skillNums('sanctuary', S.p.stats); S.log = spy(S.w); S.ev = tap(S.w);
    const cx = S.p.x + 60;
    S.a = foe(S.w, cx, S.p.y); S.b = foe(S.w, cx + 20, S.p.y + 24); S.bs = foe(S.w, cx + 30, S.p.y - 24); S.bs.boss = true; S.out = foe(S.w, S.p.x - 90, S.p.y); S.foes = [S.a, S.b, S.bs];
    return S;
  };
  const S = setup(3, 7), N = S.N, m = S.p.stats.dmg * S.w.affC('holy');
  near(N.p.nova.dmg, N.p.zone.dmg * 1.4, 1e-9, 'Wrath: the nova is 140% of one second of Sanctuary damage'); near(N.p.pillar.dmg, N.p.zone.dmg * 0.075, 1e-9, 'a pillar is 15% of a half-second tick'); near(N.p.nova.r, N.p.zone.r, 1e-9, 'the nova covers the whole circle');
  ok(N.p.pillar.count === 11 && N.p.pillar.every === 0.5, `a pillar every 0.5 s of the 5.5 s Sanctuary (${N.p.pillar.count})`);
  S.a.fodder = true; castSanct(S.w, S.p);
  const sk = S.w.fx.find(v => v.t === 'skill'); ok(sk && sk.wr === 1 && sk.hf === 1, 'the skill event carries wr (Wrath) and hf (Holy Fury)');
  const nova = partHits(S.log, 'sanctuary.nova');
  ok(nova.length === 3 && nova.every(h => Math.abs(h.d - N.p.nova.dmg * m) < 0.01) && !nova.some(h => h.e === S.out), `the nova hits every foe inside (fodder and the boss too) for ${(N.p.nova.dmg * m).toFixed(1)}, nobody outside (${nova.length})`);
  ok(S.a.rad > 0, 'the nova stores Radiance');
  const z = S.w.zones.find(q => q.kind === 'sanct'); ok(z && z.w === 8 && Math.abs(z.r - N.p.zone.r) < 1e-9, 'a Sanctuary zone marked w 8 for the renderer');
  S.ev.step(); run(S.w, 6, S.ev.step);
  const pil = partHits(S.log, 'sanctuary.pillar'), pe = S.ev.all.filter(v => v.t === 'pillar');
  ok(pil.length === 11 && pe.length === 11, `eleven pillars and eleven events (${pil.length}, ${pe.length})`);
  ok(pil.every(h => Math.abs(h.d - N.p.pillar.dmg * m * 1.2) < 0.02 * N.p.pillar.dmg * m), `each pillar deals 7.5% of a second of Sanctuary damage to a Judged foe (${pil.length ? pil[0].d.toFixed(1) : '-'} vs ${(N.p.pillar.dmg * m * 1.2).toFixed(1)})`);
  ok(pil.slice(1).every((h, i) => Math.abs(h.t - pil[i].t - 0.5) < 0.02), 'pillars fall 0.5 s apart');
  ok(!pil.some(h => h.e === S.out) && pil.every(h => S.foes.indexOf(h.e) >= 0), 'only foes inside are struck'); ok(pil.slice(1).every((h, i) => h.e !== pil[i].e), 'with three foes inside a pillar never repeats the foe struck half a second before');
  ok(new Set(pil.map(h => S.foes.indexOf(h.e))).size === 3, 'fodder and the boss are struck as well as the others');
  ok(pil.every(h => !h.crit), 'pillars never crit'); ok(pe.every(v => Math.hypot(v.x - z.x, v.y - z.y) < N.p.zone.r + 30), 'a pillar event stands on a foe inside the circle');
  const rep = setup(3, 7); rep.a.fodder = true; castSanct(rep.w, rep.p); run(rep.w, 6); ok(partHits(rep.log, 'sanctuary.pillar').map(h => rep.foes.indexOf(h.e)).join() === pil.map(h => S.foes.indexOf(h.e)).join(), 'the same seed strikes the same foes (w.rng)');
  const lone = stage({ c_s1: 1, c_s1_a: 3 }), lf = foe(lone.w, lone.p.x + 60, lone.p.y), ll = spy(lone.w); castSanct(lone.w, lone.p); run(lone.w, 6); ok(partHits(ll, 'sanctuary.pillar').length === 11 && partHits(ll, 'sanctuary.pillar').every(h => h.e === lf), 'a lone foe takes every pillar');
  const cr = setup(3, 7, 1); castSanct(cr.w, cr.p); run(cr.w, 2); ok(partHits(cr.log, 'sanctuary.pillar').concat(partHits(cr.log, 'sanctuary.nova')).every(h => !h.crit), 'a hero at 100% crit chance lands no crit with the nova or the pillars');
  const r2 = setup(2, 7); castSanct(r2.w, r2.p); const rad2 = r2.a.rad; run(r2.w, 6); ok(!partHits(r2.log, 'sanctuary.nova').length && !partHits(r2.log, 'sanctuary.pillar').length && !r2.w.fx.some(v => v.t === 'pillar') && !r2.w.zones.some(q => q.w === 8) && rad2 === 0, 'rank 2 has the Hallowed Ground rider but no nova and no pillars');
  const r1 = setup(1, 7); castSanct(r1.w, r1.p); run(r1.w, 1); ok(!(r1.a.judged > 0) && !partHits(r1.log, 'sanctuary.pillar').length, 'rank 1: Holy Fury only');
}
{ // Aegis of Dawn (c_s1_b rank 3): +40 radius, a stun pulse every 2 s on non-boss foes inside (once per foe per pulse; every pulse after the cast's also strikes them for aegisMul of a second of Sanctuary damage), allies take a further 10% less under the DR floor, the uptime cap and the aura stay
  const setup = (rank) => {
    const S = stage({ c_s1: 1, c_s1_b: rank }); S.N = ED.Stats.skillNums('sanctuary', S.p.stats); S.log = spy(S.w); S.ev = tap(S.w);
    S.a = foe(S.w, S.p.x + 100, S.p.y); S.el = foe(S.w, S.p.x + 140, S.p.y + 20, { elite: 'swift' }); S.bs = foe(S.w, S.p.x + 120, S.p.y - 30); S.bs.boss = true; S.out = foe(S.w, S.p.x + 190, S.p.y);
    S.ally = ally(S.w, 'ranger', S.p.x - 30, S.p.y); S.ally.stats.armor = 0; return S;
  };
  const S = setup(3), N = S.N, z0 = N.p.zone;
  near(z0.r, 100 * 1.3 + 40, 1e-9, 'Aegis: the aura radius is 100 x 1.3 (Sanctum) + 40'); ok(N.aim === 'self' && N.p.pulse.on && N.p.pulse.stun === 0.3 && N.p.pulse.every === 2, 'the pulse part: 0.3 s every 2 s'); ok(!ED.Stats.skillNums('sanctuary', stage({ c_s1: 1, c_s1_b: 2 }).p.stats).p.pulse.on, 'the pulse part is off before rank 3');
  castSanct(S.w, S.p); S.ev.step(); const z = S.w.zones.find(q => q.kind === 'sanct');
  ok(z && z.follow === 'p0' && z.w === 9 && Math.abs(z.r - 170) < 1e-9, 'the aura follows the Cleric, marked w 9, radius 170'); near(z.dr, 0.15 + 0.24 + 0.1, 1e-9, 'damage reduction 15% + Sanctum 10% + Aura 14% + Aegis 10%'); near(z.drCap, C.DR_FLOOR, 1e-9, 'the zone may cut up to the DR floor (combat.js reads z.drCap)');
  ok(S.a.stun > 0.29 && S.a.stun <= 0.3 + 1e-9 && S.el.stun > 0.14 && S.el.stun <= 0.15 + 1e-9, `the cast pulses a stun: a common foe 0.3 s, an elite 0.15 s (${S.a.stun}, ${S.el.stun})`); ok(!(S.bs.stun > 0) && !(S.out.stun > 0), 'a boss and a foe outside the circle are not stunned');
  ok(S.ev.all.filter(v => v.t === 'aegispulse').length === 1 && S.ev.all.find(v => v.t === 'aegispulse').r === 170, 'an aegis event with the circle');
  S.a.stun = 0; S.el.stun = 0; run(S.w, 1.9, S.ev.step); ok(S.a.stun <= 0, 'no pulse before 2 s'); run(S.w, 0.2, S.ev.step); ok(S.a.stun > 0.15 && S.ev.all.filter(v => v.t === 'aegispulse').length === 2, 'the second pulse stuns again at 2 s');
  run(S.w, 2.1, S.ev.step); ok(S.ev.all.filter(v => v.t === 'aegispulse').length === 3, 'a third pulse at 4 s'); run(S.w, 3, S.ev.step); ok(S.ev.all.filter(v => v.t === 'aegispulse').length === 3 && !S.w.zones.some(q => q.kind === 'sanct'), 'the aura (5.5 s) ends with three pulses');
  { const ph = partHits(S.log, 'sanctuary.pulse'), mul = S.p.stats.dmg * S.w.affC('holy');
    near(N.p.pulse.dmg, N.p.zone.dmg * 1, 1e-9, 'the pulse part is 100% of a second of Sanctuary damage');
    ok(ph.length === 6 && [S.a, S.el, S.bs].every(f => ph.filter(h => h.e === f).length === 2) && !ph.some(h => h.e === S.out), `every pulse after the cast strikes each foe inside (a boss and an elite too): 2 x 3 hits (${ph.length})`);
    ok(ph.every(h => Math.abs(h.d - N.p.pulse.dmg * mul) < 0.05 && (Math.abs(h.t - 2) < 0.1 || Math.abs(h.t - 4) < 0.1) && h.crit === false), 'at 2 s and 4 s, never a crit, the part damage'); }
  { const T = setup(3); castSanct(T.w, T.p); T.a.stun = 0; T.a.stunCd = 0; T.w.zones.find(q => q.kind === 'sanct').gA = 2; T.w.update(1 / 60); ok(!(T.a.stun > 0), 'a foe pulsed less than 2 s ago is skipped even when another pulse comes due'); }
  // damage taken: a Sanctuary clamps at 40%, the Aegis at z.drCap
  const hit = (S2, who, src) => { who.hp = who.maxHp; who.invuln = 0; S2.w.hurtPlayer(who, 100, src || {}); return who.maxHp - who.hp; };
  const R3 = setup(3), R2 = setup(2); castSanct(R3.w, R3.p); castSanct(R2.w, R2.p);
  const c3 = hit(R3, R3.ally), c2 = hit(R2, R2.ally);
  ok(c3 <= c2 && c3 >= 50, `an ally in the Aegis takes at most what it takes in the Aura and at least 50% (${c3} vs ${c2})`);
  R3.ally.braceT = 5; R3.ally.stats.braceDR = 0.4; ok(hit(R3, R3.ally) >= 50, 'Brace with the Aegis never takes the hit below the DR floor of 50%');
  const R1 = setup(1); castSanct(R1.w, R1.p); run(R1.w, 2.2); ok(!R1.w.fx.some(v => v.t === 'aegispulse') && !(R1.a.stun > 0) && R1.w.zones.find(q => q.kind === 'sanct').w === undefined, 'ranks 1 and 2 never pulse'); ok(R2.w.zones.find(q => q.kind === 'sanct').drCap === undefined, 'and carry no DR cap');
  const quick = ED.Stats.compute({ cls: 'cleric', weapon: 'mace', boons: { c_s1: 1, c_s1_b: 3 }, relics: [], meta: META(), pact: 0 }); quick.cdr = 0.4; quick.sn = null; const qn = ED.Stats.skillNums('sanctuary', quick);
  ok(qn.p.zone.dur <= 0.6 * qn.cdEff + 1e-9, `the Aegis aura still lasts at most 60% of the cooldown (${qn.p.zone.dur.toFixed(2)} of ${qn.cdEff.toFixed(2)})`);
  const fod = setup(3); fod.a.fodder = true; castSanct(fod.w, fod.p); ok(fod.a.stun > 0, 'fodder is pulsed too');
}
{ // Hammerstorm (c_s2_a rank 3): five hammers in a fan of +-0.5 rad, two round trips each, every leg at 40%, each leg hits a foe once and Judges it
  const S = stage({ c_s2: 1, c_s2_a: 3 }), N = ED.Stats.skillNums('judgment', S.p.stats);
  near(N.p.leg.dmg, (24.3 + 1.4 * 23) * 1.25 * 1.2 * 0.4, 1e-9, 'a leg is 40% of a hit'); ok(S.p.stats.storm === 5 && S.p.stats.thirdLeg === 1, 'Hammerstorm keeps Second Flight (two round trips)');
  S.w.playerSkill(S.p, 0, {}, 1); const angs = S.p.hammers.map(h => Math.atan2(h.pr.vy, h.pr.vx)).sort((a, b) => a - b), sk = S.w.fx.find(v => v.t === 'skill');
  ok(S.p.hammers.length === 5 && angs.every((a, i) => Math.abs(a - (-0.5 + 0.25 * i)) < 1e-9), `five hammers fan out from -0.5 to +0.5 rad (${angs.map(a => a.toFixed(2))})`); ok(sk && sk.st === 1, 'the skill event carries st');
  const T = stage({ c_s2: 1, c_s2_a: 3 }); const e = foe(T.w, T.p.x + 40, T.p.y), bs = foe(T.w, T.p.x + 40, T.p.y - 2), fo = foe(T.w, T.p.x + 40, T.p.y + 2), far = foe(T.w, T.p.x + 150, T.p.y + 150); bs.boss = true; fo.fodder = true; const log = spy(T.w), ev = tap(T.w);
  const pin = [e, bs, fo, far].map(f => [f, f.x, f.y]); T.w.playerSkill(T.p, 0, {}, 1); run(T.w, 12, () => { ev.step(); for (const [f, x, y] of pin) { f.x = x; f.y = y; f.kbx = f.kby = 0; } }); // foes stay where they are: a hit knocks them off the paths
  const legs = partHits(log, 'judgment.leg'), per = (f) => legs.filter(h => h.e === f);
  ok(per(e).length === 20 && per(bs).length === 20 && per(fo).length === 20, `a foe next to the hero is hit once by every leg of all five hammers: 20 times (${per(e).length}, boss ${per(bs).length}, fodder ${per(fo).length})`);
  ok(per(e).every(h => h.mul === undefined || h.mul === 1) && per(e).slice(1).every(h => Math.abs(h.d - N.p.leg.dmg * T.p.stats.dmg * T.w.affC('holy') * 1.2) < 0.02 * N.p.leg.dmg * T.p.stats.dmg), 'every leg, the second flight too, deals 40% of a hit (+20% Judged)');
  ok(T.p.hammers.length === 0 && !T.w.projs.some(q => q.kind === 'hammer'), 'all five hammers come home and are caught'); ok(ev.all.filter(v => v.t === 'hturn' && v.n === 4).length >= 1 && per(far).length < 20, 'hammers turn at the far ends; a foe off to the side is struck less');
  const two = stage({ c_s2: 1, c_s2_a: 2 }); two.w.playerSkill(two.p, 0, {}, 1); ok(two.p.hammers.length === 2 && !two.w.fx.find(v => v.t === 'skill').st, 'rank 2 still throws two');
  const lg = stage({ c_s2: 1, c_s2_a: 3 }); const lf = foe(lg.w, lg.p.x + 40, lg.p.y); lg.w.playerSkill(lg.p, 0, {}, 1); run(lg.w, 1.2); ok(lf.judged > 0 && lf.judgeOwner === 'p0', 'the legs Judge and stamp the Judge');
}
{ // Final Judgment (c_s2_b rank 3): damage a Judged foe takes from the Cleric echoes 8% to every other Judged foe within 200 (a chain: no re-echo, no on-hit effects, fodder included); the Verdict burst grows to radius 80 and stuns 0.6 s
  const setup = (rank) => {
    const S = stage({ c_s2: 1, c_s2_b: rank }), bx = S.p.x - 150, by = S.p.y;
    S.A = foe(S.w, bx, by); S.B = foe(S.w, bx + 60, by); S.C = foe(S.w, bx + 120, by + 10); S.D = foe(S.w, bx + 260, by); S.E = foe(S.w, bx + 30, by + 40);
    for (const f of [S.A, S.B, S.C, S.D]) { f.judged = 9; f.judgeOwner = 'p0'; f.judgeCast = 1; }
    S.log = spy(S.w); S.ev = tap(S.w); return S;
  };
  const S = setup(3); S.p.stats.holyInfuse = 0.5; S.p.stats.bleedAll = 0.3; S.p.stats.holyAdd = undefined;
  const dA = (() => { const h0 = S.A.hp; S.w.hitEnemy(S.A, 100, { p: S.p, kind: 'weapon', crit: false }); return h0 - S.A.hp; })();
  ok(lost(S.B) === 0 && S.p.echoQ.size === 2, 'the echo is queued: not instant, two Judged foes within 200 of the struck one'); S.w.update(DT); S.ev.step();
  near(lost(S.B), dA * 0.08 * 1.2, 0.02, 'a Judged foe within 200 takes 8% of the damage (through its own +20%)'); near(lost(S.C), dA * 0.08 * 1.2, 0.02, 'every other Judged foe within 200 does'); ok(lost(S.D) === 0, 'a Judged foe 260 away does not'); ok(lost(S.E) === 0, 'a foe that is not Judged does not');
  near(lost(S.A), dA, 1e-9, 'the struck foe takes only the blow: an echo never echoes again'); ok(S.log.filter(h => h.part === 'echo').length === 2 && S.ev.all.filter(v => v.t === 'jecho').length === 2, 'two echo hits and two echo events');
  ok(S.B.rad === 0 && S.B.bleedPool === 0 && S.A.rad > 0 && S.A.bleedPool > 0, 'an echo carries no Radiance, Bleed or other on-hit effect (the blow did)');
  const a0 = S.A.hp; run(S.w, 0.2); near(a0 - S.A.hp, 0, 1e-6, 'nothing bounces back to the struck foe'); ok(S.p.echoQ.size === 0, 'the queue is empty again');
  S.w.hitEnemy(S.D, 100, { p: S.p, kind: 'weapon', crit: false }); S.w.update(DT); const cb = lost(S.C); ok(cb > dA * 0.08 * 1.2 * 1.5, 'a hit on the far foe echoes to the one within its 200');
  { const T = setup(3); const h0 = T.B.hp; T.w.hitEnemy(T.A, 100, { p: T.p, kind: 'dot', crit: false, noProc: true }); T.w.update(DT); ok(T.B.hp === h0 && T.p.echoQ.size === 0, 'status and zone ticks (kind dot) do not echo'); }
  { const T = setup(3); T.A.fodder = true; T.B.fodder = true; T.B.hp = 3; T.w.hitEnemy(T.A, 100, { p: T.p, kind: 'weapon', crit: false }); T.w.update(DT); ok(T.B.hp <= 0 && T.C.hp < 5000, 'fodder gives and takes echoes; an echo can kill'); }
  { const T = setup(3); T.C.boss = true; T.w.hitEnemy(T.A, 100, { p: T.p, kind: 'weapon', crit: false }); T.w.update(DT); ok(lost(T.C) > 0, 'a Judged boss takes the echo too'); }
  { const T = setup(3); T.A.hp = 10; T.w.hitEnemy(T.A, 1e6, { p: T.p, kind: 'weapon', crit: false }); T.w.update(DT); near(lost(T.B), 10 * 0.08 * 1.2, 0.02, 'a killing blow echoes what the foe had left, not the overkill'); }
  { const T = setup(3), al = ally(T.w, 'ranger', T.p.x, T.p.y + 60); T.w.hitEnemy(T.A, 100, { p: al, kind: 'weapon', crit: false }); T.w.update(DT); ok(lost(T.B) === 0, 'damage from another hero does not echo (from you)'); }
  { const T = setup(3); T.w.hitEnemy(T.A, 100, { p: T.p, kind: 'weapon', crit: false }); T.w.hitEnemy(T.A, 100, { p: T.p, kind: 'weapon', crit: false }); T.w.update(DT); ok(T.log.filter(h => h.part === 'echo' && h.e === T.B).length === 1, 'two hits in one tick echo as one hit per foe'); }
  { const T = setup(2); T.w.hitEnemy(T.A, 100, { p: T.p, kind: 'weapon', crit: false }); T.w.update(DT); ok(lost(T.B) === 0 && T.p.echoQ.size === 0, 'rank 2 does not echo'); }
  { // end to end: Judgment judges a line of foes, then a blow on the first echoes to the other
    const T = stage({ c_s2: 1, c_s2_b: 3 }); const f1 = foe(T.w, T.p.x + 60, T.p.y), f2 = foe(T.w, T.p.x + 110, T.p.y); T.w.playerSkill(T.p, 0, {}, 1); run(T.w, 0.5); ok(f1.judged > 0 && f2.judged > 0, 'both foes are Judged');
    const h0 = f2.hp; T.w.hitEnemy(f1, 100, { p: T.p, kind: 'weapon', crit: false }); run(T.w, 0.05); ok(f2.hp < h0, 'a blow on one echoes to the other');
  }
  // the Verdict burst
  const V = setup(3), VN = ED.Stats.skillNums('judgment', V.p.stats).p.verdict; near(VN.r, 80, 1e-9, 'the burst radius is 70 + 10'); near(VN.stun, 0.6, 1e-9, 'its stun is 0.6 s');
  const near1 = foe(V.w, V.A.x + 60, V.A.y + 20), edge = foe(V.w, V.A.x + 80, V.A.y + 60), el = foe(V.w, V.A.x - 70, V.A.y, { elite: 'swift' }), bs = foe(V.w, V.A.x, V.A.y - 60); bs.boss = true;
  V.B.judged = 0; V.C.judged = 0; V.D.judged = 0; V.A.hp = 5; V.w.hitEnemy(V.A, 99, { p: V.p, kind: 'weapon', crit: false }); let st1 = 0, st2 = 0, st3 = 0; for (let i = 0; i < 40 && !V.w.fx.some(v => v.t === 'verdict'); i++) { V.w.update(DT); if (V.w.fx.some(v => v.t === 'verdict')) { st1 = near1.stun; st2 = el.stun; st3 = bs.stun; } }
  const ve = V.w.fx.find(v => v.t === 'verdict'); ok(ve && ve.r === 80, 'the verdict event has radius 80'); ok(Math.hypot(near1.x - V.A.x, near1.y - V.A.y) < 80 + near1.r && lost(near1) > 0 && st1 > 0.59 && st1 <= 0.6 + 1e-9, `a foe at 63 is burst and stunned 0.6 s (${st1})`);
  ok(Math.hypot(edge.x - V.A.x, edge.y - V.A.y) > 80 + edge.r - 2 && lost(edge) === 0, 'a foe at 100 (beyond 80 + its body) is untouched'); ok(st2 > 0.29 && st2 <= 0.3 + 1e-9, `an elite is stunned 0.3 s (${st2})`); ok(st3 === 0 && lost(bs) > 0, 'a boss takes the burst and is never stunned');
  const V2 = setup(2), VN2 = ED.Stats.skillNums('judgment', V2.p.stats).p.verdict; ok(Math.abs(VN2.r - 70) < 1e-9 && VN2.stun === 0.4, 'rank 2: radius 70, stun 0.4 s');
}

// ---------------- route forms (rank 2: the rider, rank 3: the transform): Sunhammer, Crusader, Guardian Light, Prism ----------------
{ // card names, riders and transforms of the four Cleric attack and element forks
  const FORKS = { c_atk_h: ['Sunhammer', 'Solar Flare', "Dawn's Wake"], c_atk_s: ['Crusader', 'Litany', 'Returning Light'], c_el_a: ['Guardian Light', 'Judging Light', 'Sunstrike'], c_el_b: ['Prism', 'Sunburst', 'Spectrum'] };
  for (const id in FORKS) {
    const [name, rider, form] = FORKS[id], b = ED.BOONS[id], P = [1, 2, 3].map(r => ED.cardParts(id, r, null));
    ok(!b.rider && b.rider2 && b.r2 && b.form && b.r3 && b.form.name === form, id + ' keeps its rider in rider2/r2 and its transform in form/r3');
    ok(P[0].rider2 === '' && P[1].rider2Name === rider && P[1].rider2 !== '' && P[2].rider2 !== '', id + ' rider ' + rider + ' from rank 2');
    ok(!P[0].form && !P[1].form && P[2].form && P[2].form.name === form && P[2].form.desc.length > 20 && !/[{}\[\]]/.test(P[2].form.desc) && !/[{}\[\]]/.test(P[1].rider2), id + ' transform ' + form + ' only at rank 3');
    ok(ED.cardName(id, 1) === name && ED.cardName(id, 2) === name && ED.cardName(id, 3) === form, id + ' card name: ' + name + ' then ' + form);
    ok(ED.boonText(id, 2, null).indexOf(form) < 0 && ED.boonText(id, 3, null).indexOf(form + ':') >= 0, id + ' card text names the transform only at rank 3');
    const t1 = ED.cardTotals(b, 1), t2 = ED.cardTotals(b, 2), t3 = ED.cardTotals(b, 3);
    for (const k in b.r2) ok(!(t1[k] > 0) ? t2[k] > 0 && t3[k] >= t2[k] : t2[k] > t1[k] && t3[k] >= t2[k], id + ' stat ' + k + ' (rank 2 rider)');
    for (const k in b.r3) ok(t3[k] > (t2[k] || 0), id + ' stat ' + k + ' (rank 3 transform)');
  }
  ok(/Every wave turns back/.test(ED.boonText('c_atk_s', 3, null)) && /3rd Smite/.test(ED.boonText('c_el_a', 3, null)), 'form texts name their mechanics');
}
{ // Dawn's Wake (c_atk_h rank 3): each wave leaves a 44 wide strip from the hand to the wave's end, growing with the wave and burning 2 s after it; foes on it take 60% of the wave per second in 0.25 s ticks as Holy class damage and store a quarter of the tick as Radiance
  const real = ED.Dungeon.blocksShots, WAKE = 0.6;
  const setup = (rank) => {
    const S = stage({ c_atk: 1, c_atk_h: rank }); ED.Dungeon.blocksShots = () => false; // the staged room is too small for the full range of the wave (282)
    S.on = foe(S.w, S.p.x + 60, S.p.y); S.fod = foe(S.w, S.p.x + 150, S.p.y); S.fod.fodder = true; S.off = foe(S.w, S.p.x + 60, S.p.y + 90); S.far = foe(S.w, S.p.x + 330, S.p.y);
    S.log = spy(S.w); S.ev = tap(S.w); S.w.playerAttack(S.p, 0); S.w.projs.length = 0; S.w.playerAttack(S.p, 0); S.wave = waves(S.w)[0];
    S.strips = () => S.w.zones.filter(q => q.kind === 'crack' && q.arc === 2); return S;
  };
  const S = setup(3), base = S.wave.dmg, tick = base * WAKE * 0.25, mul = S.p.stats.dmg * S.w.affC('holy'), z = S.strips()[0];
  ok(S.strips().length === 1 && z.len === 0 && z.owner === 'p0' && Math.abs(z.w - 44) < 1e-9 && Math.abs(z.a) < 1e-9 && z.x === S.p.x && z.y === S.p.y, 'one strip per wave, 44 wide, at the hand along the aim, length 0 at the start');
  run(S.w, 0.4); near(z.len, 0.4 * 320, 12, 'the strip grows with the wave (320 px/s)');
  let endAt = -1, endLen = 0; run(S.w, 0.6, () => { if (endAt < 0 && !waves(S.w).length) { endAt = S.w.time; endLen = z.len; } });
  near(endLen, 0.55 * 1.6 * 320, 8, 'the strip reaches the end of the wave (282)'); near(z.dur - z.t, 2 - (S.w.time - endAt), 0.05, 'it burns 2 s from the wave end');
  let gone = -1; run(S.w, 2.5, () => { if (gone < 0 && !S.strips().length) gone = S.w.time; }); near(gone - endAt, 2, 0.08, 'the strip is gone 2 s after its wave ended');
  const onH = partHits(S.log, 'wake').filter(h => h.e === S.on), fodH = partHits(S.log, 'wake').filter(h => h.e === S.fod);
  ok(onH.length >= 9 && onH.length <= 11, `a foe on the strip is ticked every 0.25 s while it burns (${onH.length} ticks)`); ok(onH.every(h => Math.abs(h.d - tick * mul) < 0.02 * tick * mul), `each tick deals ${(tick * mul).toFixed(2)} (60% of the wave per second x 0.25 s, Holy class affinity; ${onH.length ? onH[0].d.toFixed(2) : '-'})`);
  ok(onH.every(h => !h.crit) && onH.slice(1).every((h, i) => Math.abs(h.t - onH[i].t - 0.25) < 0.02), 'ticks never crit and fall 0.25 s apart');
  ok(partHits(S.log, 'wake').every(h => h.e !== S.off && h.e !== S.far), 'foes beside the strip and beyond its end are not ticked'); ok(fodH.length >= 5, `a horde foe is ticked as well (${fodH.length})`);
  near(S.on.rad, onH.length * tick * 0.25 * S.w.elemAff('holy'), 0.05 * S.on.rad, 'every tick stores a quarter of its raw damage as Radiance (x Holy affinity)'); ok(S.fod.rad > 0 && S.off.rad === 0, 'Radiance only on the foes struck');
  const T = setup(3); T.w.projs.length = 0; T.w.playerAttack(T.p, 0); T.w.projs.length = 0; T.w.playerAttack(T.p, 0); ok(T.strips().length === 2, 'two waves leave two strips');
  { const W2 = setup(3), sn = ED.Net.encodeSnap(W2.w, [], false), row = sn.Z.find(r => r[1] === ED.Net.ZK.indexOf('crack')); ok(row && row[10] === 2 && row[9] === 44, 'the wire row carries kind crack, arc 2 and width 44 (angle and length with it)'); }
  const R2 = setup(2); run(R2.w, 1); ok(!R2.strips().length && !partHits(R2.log, 'wake').length, 'rank 2 leaves no strip'); const ow = setup(3); ow.w.players.delete('p0'); run(ow.w, 0.2); ok(!ow.strips().length, 'a strip whose owner left ends at once');
  ED.Dungeon.blocksShots = real;
}
{ // Returning Light (c_atk_s rank 3): a wave that ends turns back from its end, aimed at the hero, at 50% of its damage; it steers like the outward wave, strikes each foe once per leg and never turns again
  const setup = (rank, boons) => {
    const S = stage(Object.assign({ c_atk: 1, c_atk_s: rank }, boons || {}));
    S.A = foe(S.w, S.p.x + 60, S.p.y); S.B = foe(S.w, S.p.x + 150, S.p.y); S.F = foe(S.w, S.p.x + 100, S.p.y); S.F.fodder = true; S.off = foe(S.w, S.p.x + 100, S.p.y + 110);
    S.log = spy(S.w); S.ev = tap(S.w); S.w.playerAttack(S.p, 0); S.w.projs.length = 0; S.w.playerAttack(S.p, 0); S.wave = waves(S.w)[0]; S.hits = (f) => partHits(S.log, 'wave').filter(h => h.e === f); return S;
  };
  const S = setup(3), D0 = S.wave.dmg; let ret = null, turnAt = -1, closest = 1e9, goneAt = -1;
  run(S.w, 2.4, () => { S.ev.step(); const r = S.w.projs.find(q => q.ret); if (r) { if (!ret) { ret = Object.assign({}, r); turnAt = S.w.time; } closest = Math.min(closest, Math.hypot(r.x - S.p.x, r.y - S.p.y)); } else if (ret && goneAt < 0) goneAt = S.w.time; });
  ok(ret && Math.abs(ret.x - (S.p.x + 176)) < 8 && Math.abs(ret.y - S.p.y) < 2, `the return wave starts where the wave ended (${ret && ret.x - S.p.x})`); ok(ret && Math.abs(Math.abs(Math.atan2(ret.vy, ret.vx)) - Math.PI) < 0.3 && ret.kind === 'wave' && ret.wpn && ret.part === 'wave', 'it flies back toward the hero as an ordinary wave');
  near(ret.dmg, D0 * 0.5, 1e-9, 'the return wave deals 50% of the wave'); near(ret.homing, 2, 1e-9, 'it steers like the outward wave (turn rate)'); near(ret.homeCone, 25 * Math.PI / 180, 1e-9, 'inside the same 25 degree cone'); near(ret.r, S.wave.r, 1e-9, 'and is as wide');
  ok(S.ev.all.filter(v => v.t === 'wret').length === 1 && S.ev.all.find(v => v.t === 'wret').pid === 'p0', 'one wret event for the turn'); ok(closest < 20 && goneAt > turnAt && goneAt - turnAt < 1.5, `the return wave comes home (${closest.toFixed(1)} px from the hero) and ends (${(goneAt - turnAt).toFixed(2)} s)`);
  const hA = S.hits(S.A), hB = S.hits(S.B), hF = S.hits(S.F), tw = (hs) => hs.length === 2 && Math.abs(hs[1].d / hs[0].d - 0.5) < 0.01 && hs[1].t - hs[0].t > 0.1;
  ok(tw(hA) && tw(hB) && tw(hF), `a foe on the way is struck once by each leg, the second at 50% (A ${hA.length}, B ${hB.length}, horde ${hF.length})`); ok(S.hits(S.off).length === 0, 'a foe off the line is struck by neither leg');
  ok(!S.w.projs.some(q => q.kind === 'wave') && S.ev.all.filter(v => v.t === 'wret').length === 1, 'a returning wave never turns again');
  { const T = setup(3); let moved = false, dmin = 1e9; run(T.w, 1.4, () => { const r = T.w.projs.find(q => q.ret); if (r) { if (!moved) { moved = true; T.p.y += 70; } dmin = Math.min(dmin, Math.hypot(r.x - T.p.x, r.y - T.p.y)); } }); ok(moved && dmin < 20, `the return wave follows a hero who moved away (${dmin.toFixed(1)} px)`); }
  { const T = stage({ c_atk: 1, c_atk_s: 3 }); let wall = T.p.x; while (!ED.Dungeon.blocksShots(ED.Dungeon.tileAt(T.w.room, wall, T.p.y), false)) wall += 2; T.p.x = wall - 100; T.w.playerAttack(T.p, 0); T.w.projs.length = 0; T.w.playerAttack(T.p, 0); let r = null; run(T.w, 0.6, () => { if (!r) { const q = T.w.projs.find(v => v.ret); if (q) r = Object.assign({}, q); } });
    ok(r && !ED.Dungeon.blocksShots(ED.Dungeon.tileAt(T.w.room, r.x, r.y), false) && r.x < wall && r.x > wall - 30, `a wave that hits a wall returns from just before it (${r && (wall - r.x).toFixed(1)} px off the wall)`); }
  { const T = setup(3); T.p.downed = true; run(T.w, 1.2); ok(!T.w.projs.some(q => q.ret) && !T.w.fx.some(v => v.t === 'wret'), 'a downed hero wave does not return'); }
  { const L = stage({ c_atk: 1, c_atk_s: 3 }); for (let i = 0; i < 16; i++) { L.w.projs.length = 0; L.w.playerAttack(L.p, 0); } ok(waves(L.w).length === 3, 'the 16th attack sends the Litany fan (3 waves)'); L.ev = tap(L.w); run(L.w, 0.7, L.ev.step); ok(L.ev.all.filter(v => v.t === 'wret').length === 3, 'all three waves of a Litany fan turn back'); }
  const R2 = setup(2); run(R2.w, 1.5); ok(!R2.w.projs.some(q => q.ret) && !R2.w.fx.some(v => v.t === 'wret') && S.hits(S.A).length === 2 && R2.hits(R2.A).length === 1, 'rank 2 waves do not return');
}
{ // Sunstrike (c_el_a rank 3): every 3rd Smite on the same foe (never a horde foe) deals x4 and doubles the shield it grants (a grant stays under 3% of max health); the 6th is one as well
  const setup = (rank) => { const S = stage({ c_el: 1, c_el_a: rank }); S.e = foe(S.w, S.p.x + 60, S.p.y); S.e.maxHp = S.e.hp = 1e9; S.ev = tap(S.w); S.smite = (f) => { f = f || S.e; const h = f.hp; S.p.holyT = 0; S.p.shield = 0; f.judged = 0; for (const s of S.p.shWin) { s.sec = -99; s.c = 0; s.a = 0; } S.w.smite(f, S.p, 1000); S.ev.step(); return { dmg: h - f.hp, shield: S.p.shield / S.p.maxHp }; }; return S; };
  const S = setup(3), r = [1, 2, 3, 4, 5, 6].map(() => S.smite());
  ok(r.map(x => x.dmg).join() === '1000,1000,4000,1000,1000,4000', `every 3rd Smite is x4 (${r.map(x => x.dmg)})`); ok(r.map(x => +(x.shield * 100).toFixed(2)).join() === '1,1,2,1,1,2', `its shield is doubled: 1% to 2% (${r.map(x => (x.shield * 100).toFixed(2))})`);
  ok(S.ev.all.filter(v => v.t === 'sunstrike').length === 2 && S.ev.all.filter(v => v.t === 'sunstrike').every(v => v.x === Math.round(S.e.x) && v.pid === 'p0'), 'one sunstrike event per Sunstrike, on the foe');
  const O = foe(S.w, S.p.x + 90, S.p.y); O.maxHp = O.hp = 1e9; ok(S.smite(O).dmg === 1000, 'each foe counts its own Smites (the first on another foe is a plain Smite)');
  { const El = setup(3), el = foe(El.w, El.p.x + 60, El.p.y, { elite: 'swift' }); el.maxHp = el.hp = 1e9; el.ward = 0; const q = [1, 2, 3].map(() => El.smite(el)), big = 1 + El.p.stats.smiteBig; ok(q.map(x => x.dmg).join() === [1000 * big, 1000 * big, 4000 * big].join() && q.map(x => +(x.shield * 100).toFixed(2)).join() === '2,2,3', `on an elite the Sunstrike multiplies the boosted Smite and its shield stops at the 3% grant cap (${q.map(x => x.dmg)} / ${q.map(x => (x.shield * 100).toFixed(2))})`); }
  { const F = setup(3), fd = foe(F.w, F.p.x + 60, F.p.y + 40); fd.fodder = true; fd.maxHp = fd.hp = 1e9; const q = [1, 2, 3, 4, 5, 6].map(() => F.smite(fd)); ok(q.every(x => x.dmg === 1000 && Math.abs(x.shield - 0.01) < 1e-9) && !F.ev.all.some(v => v.t === 'sunstrike') && !(fd.sunN > 0), 'a horde foe never counts toward a Sunstrike: plain Smites, plain shield, no event'); }
  { const R2 = setup(2); const q = [1, 2, 3].map(() => R2.smite()); ok(q.every(x => x.dmg === 1000 && Math.abs(x.shield - 0.01) < 1e-9) && !R2.ev.all.some(v => v.t === 'sunstrike'), 'rank 2 has no Sunstrike'); }
  { const N = stage({ c_el: 1 }); const e = foe(N.w, N.p.x + 60, N.p.y); e.maxHp = e.hp = 1e9; N.w.smite(e, N.p, 1000); ok(!(e.sunN > 0), 'a hero without the card keeps no count'); }
  { const T = stage({ c_el: 1, c_el_a: 3 }), e = foe(T.w, T.p.x + 60, T.p.y); e.maxHp = e.hp = 1e9; const dmgs = []; for (let i = 0; i < 3; i++) { T.p.holyT = 0; const h = e.hp; T.w.addRadiance(e, T.w.smiteAt(e) / T.w.elemAff('holy'), T.p); dmgs.push(h - e.hp); } ok(dmgs[0] > 0 && dmgs[2] > 3.9 * dmgs[1] && dmgs[2] < 4.1 * dmgs[1], `a natural Smite (the Radiance gauge) counts too (${dmgs.map(d => d.toFixed(0))})`); }
}
{ // Spectrum (c_el_b rank 3): the beam of a Smite strikes the nearest 4 other foes within 160 at 50% each (a horde foe too), the Sunburst jump follows the nearest at half again; each non-horde foe struck stores 5% of the Smite as Radiance, kept just under its gauge
  const setup = (rank) => {
    const S = stage({ c_el: 1, c_el_b: rank }), ys = S.p.y; S.A = foe(S.w, S.p.x + 100, ys); S.A.maxHp = S.A.hp = 1e9; // the Smitten foe; the others stand east of it at 40, 70, 100, 130 (the 3rd a horde foe), 150 and 400
    S.near = [40, 70, 100, 130].map(d => foe(S.w, S.A.x + d, ys)); S.near[2].fodder = true; S.fifth = foe(S.w, S.A.x + 150, ys); S.out = foe(S.w, S.A.x + 400, ys); S.ev = tap(S.w); return S;
  };
  const S = setup(3), smite = 1000 * 1.5; S.w.smite(S.A, S.p, 1000); const before = S.near.map(f => f.rad);
  ok(S.w.chainQ.length === 1 && S.w.chainQ[0].kind === 'beam', 'the Smite queues one beam payoff'); run(S.w, 0.5, S.ev.step);
  ok(S.near.every(f => Math.abs(lost(f) - smite * 0.5) < 0.01), `the four nearest other foes each take 50% of the Smite (${S.near.map(f => lost(f).toFixed(0))} of ${smite * 0.5})`);
  near(lost(S.fifth), smite * 0.25, 0.01, 'the Sunburst jump follows the nearest beam, at half again, onto the next foe within 120'); ok(lost(S.out) === 0, 'a foe beyond 160 is untouched');
  const bm = S.ev.all.filter(v => v.t === 'chain' && v.k === 'p'); ok(bm.length === 4 && bm.map(v => v.i).sort().join() === '0,1,2,3' && bm.every(v => v.pts.length === 2 && v.pts[0][0] === Math.round(S.A.x)), 'four Spectrum chain events (k p, i 0 to 3) from the Smitten foe'); ok(S.ev.all.filter(v => v.t === 'chain' && v.k === 'b').length === 1, 'only the Sunburst jump is a plain beam event');
  const want = smite * 0.05; ok([0, 1, 3].every(i => Math.abs(S.near[i].rad - before[i] - want) < 0.01) && S.near[2].rad === before[2] && S.fifth.rad === 0, `each non-horde foe struck stores 5% of the Smite as Radiance (${S.near.map(f => f.rad.toFixed(1))}); the horde foe and the jump foe store none`);
  ok(S.near.every(f => f.hp > 0) && S.near.concat([S.fifth]).every(f => f.hp === f.maxHp - lost(f)), 'beams never Smite');
  { const T = setup(3); const f = T.near[0]; f.rad = T.w.smiteAt(f) * 0.995; T.w.smite(T.A, T.p, 1000); run(T.w, 0.5); ok(Math.abs(lost(f) - smite * 0.5) < 0.01 && f.rad <= T.w.smiteAt(f), 'stored Radiance never reaches the gauge: a foe at the brink takes the beam and no Smite'); }
  { const T = setup(3); T.near[1].maxHp = T.near[1].hp = 100; T.w.smite(T.A, T.p, 1000); run(T.w, 0.5); ok(T.near[1].hp <= 0, 'a beam can kill'); }
  { const lone = stage({ c_el: 1, c_el_b: 3 }), a = foe(lone.w, lone.p.x + 100, lone.p.y); a.maxHp = a.hp = 1e9; lone.w.smite(a, lone.p, 1000); run(lone.w, 0.3); ok(!lone.w.chainQ.length && !lone.w.fx.some(v => v.t === 'chain'), 'a lone Smite fires no beam'); }
  { const two = stage({ c_el: 1, c_el_b: 3 }), a = foe(two.w, two.p.x + 100, two.p.y), b = foe(two.w, two.p.x + 150, two.p.y); a.maxHp = a.hp = 1e9; two.w.smite(a, two.p, 1000); run(two.w, 0.5); ok(Math.abs(lost(b) - smite * 0.5) < 0.01 && !two.w.chainQ.length, 'with one other foe there is one beam and nothing to jump to'); }
  { const R2 = setup(2); R2.w.smite(R2.A, R2.p, 1000); run(R2.w, 0.5, R2.ev.step); ok(lost(R2.near[0]) > 0 && R2.near.slice(1).every(f => lost(f) === 0 || f === R2.near[1]) && R2.ev.all.filter(v => v.t === 'chain' && v.k === 'p').length === 0, 'rank 2 keeps the single beam to the nearest foe (and its jump)'); }
  { const N = setup(3); N.w.addRadiance(N.A, N.w.smiteAt(N.A) / N.w.elemAff('holy'), N.p); run(N.w, 0.5); ok(N.near.filter(f => lost(f) > 0).length === 4, 'a natural Smite splits as well'); }
}

{ // Judging Light (c_el_a rank 2): a Smite Judges its foe for 3 s (+20% damage taken); none at rank 1; the shield buff and elite Smites carry the rank 2 additions
  const sm = (boons) => { const S = stage(boons), e = foe(S.w, S.p.x + 60, S.p.y); e.maxHp = e.hp = 1e9; S.w.smite(e, S.p, 1000); return { S, e, judged: e.judged }; };
  const r1 = sm({ c_el: 1, c_el_a: 1 }), r2 = sm({ c_el: 1, c_el_a: 2 });
  near(r2.judged, 3, 1e-9, 'rank 2: the smitten foe is Judged 3 s'); ok(!(r1.judged > 0), 'rank 1: no Judged');
  const h0 = r2.e.hp; r2.S.w.hitEnemy(r2.e, 100, { p: r2.S.p, kind: 'weapon', crit: false }); near(h0 - r2.e.hp, 100 * 1.2 * (r2.S.p.stats.dmg + r2.S.p.glV), 0.5, 'a Judged foe takes +20% from the next hit (the Cleric’s own Guardian Light buff counts in its damage)');
  near(r2.S.p.stats.smiteBig, 0.9, 1e-9, 'rank 2: elite and boss Smites +90% (50% + 40%)'); near(r2.S.p.glV, 0.12, 1e-9, 'rank 2: the shield buff is +12%');
}
{ // the fodder audit of the Cleric route hooks: damage, chains and Radiance from damage run on horde foes; a refund, shield, buff grant or count never rides on one of them
  const { w, p } = stage({ c_s2: 1, c_s2_b: 2, c_el: 1, c_el_a: 3 }); const fd = foe(w, p.x + 70, p.y), nb = foe(w, p.x + 100, p.y); fd.fodder = true;
  w.playerSkill(p, 0, {}, 1); run(w, 0.3); fd.hp = 3; p.shield = 0; w.hitEnemy(fd, 99, { p, kind: 'weapon', crit: false }); run(w, 0.3);
  near(p.shield, 0, 1e-9, 'audit: a Judged horde foe dying grants no Judgment shield'); ok(lost(nb) > 0, 'audit: its Verdict burst (a chain) still lands');
  const S = stage({ c_el: 1, c_el_a: 3 }), f2 = foe(S.w, S.p.x + 60, S.p.y); f2.fodder = true; f2.maxHp = f2.hp = 1e9; for (let i = 0; i < 6; i++) S.w.smite(f2, S.p, 1000);
  ok(!(f2.sunN > 0) && !S.w.fx.some(v => v.t === 'sunstrike'), 'audit: six Smites on a horde foe count no Sunstrike');
  const B = stage({ c_el: 1, c_el_b: 3 }), a = foe(B.w, B.p.x + 100, B.p.y), b2 = foe(B.w, B.p.x + 130, B.p.y); a.maxHp = a.hp = 1e9; b2.fodder = true; B.w.smite(a, B.p, 1000); run(B.w, 0.4);
  ok(lost(b2) > 0 && b2.rad === 0, 'audit: a beam damages a horde foe and stores no Radiance in it');
  const W2 = stage({ c_atk: 1, c_atk_h: 3 }); const wf = foe(W2.w, W2.p.x + 60, W2.p.y); wf.fodder = true; const real = ED.Dungeon.blocksShots; ED.Dungeon.blocksShots = () => false; W2.w.playerAttack(W2.p, 0); W2.w.projs.length = 0; W2.w.playerAttack(W2.p, 0); run(W2.w, 1.5); ED.Dungeon.blocksShots = real;
  ok(lost(wf) > 0 && wf.rad > 0 && W2.p.shield === 0 && W2.p.critStacks === 0, 'audit: the Wake burns a horde foe and stores Radiance from the damage (as a Sanctuary does), and grants nothing else');
  const L = stage({ c_atk: 1, c_atk_s: 3 }); const lf = foe(L.w, L.p.x + 60, L.p.y); lf.fodder = true; L.w.playerAttack(L.p, 0); L.w.projs.length = 0; L.w.playerAttack(L.p, 0); run(L.w, 1.6);
  ok(lost(lf) > 0 && L.p.shield === 0 && !L.w.projs.some(q => q.kind === 'wave'), 'audit: waves, returning ones too, strike a horde foe for damage only');
}

// ---------------- bookkeeping and edges: zone damage part, a hero that goes down mid-flight, a room change ----------------
{
  const { w, p } = stage({ c_s1: 1 }); const e = foe(w, p.x + 40, p.y); let part = null; const orig = w.hitEnemy;
  w.hitEnemy = function (f, d, src) { if (src && src.kind === 'dot' && src.part) part = src.part; return orig.call(this, f, d, src); };
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 40, y: p.y }, 0); run(w, 0.7); ok(part === 'sanctuary.zone' && lost(e) > 0, 'Sanctuary ticks are reported as part sanctuary.zone');
  const d = stage({ c_s2: 1, c_s2_a: 3 }); ally(d.w, 'knight', d.p.x + 30, d.p.y); d.w.playerSkill(d.p, 0, {}, 1); d.p.downed = true; d.p.bleed = 99; run(d.w, 5); d.p.downed = false; d.p.bleed = 0; run(d.w, 2);
  ok(d.p.hammers.length === 0 && !d.w.projs.some(q => q.kind === 'hammer'), 'hammers of a hero who was down are gone when they get up');
  const r = stage({ c_s2: 1 }); r.w.playerSkill(r.p, 0, {}, 1); const room0 = r.w.room; r.p.hammers[0].room = { other: true }; run(r.w, 0.2); ok(r.p.hammers.length === 0 && room0 === r.w.room, 'a hammer from another room is dropped');
  const z = stage({ c_s1: 1, c_s1_a: 3 }); ally(z.w, 'knight', z.p.x + 30, z.p.y); const zf = foe(z.w, z.p.x + 40, z.p.y); z.w.playerSkill(z.p, 0, { x0: z.p.x, y0: z.p.y, x: z.p.x + 40, y: z.p.y }, 0); z.p.dead = true; let thrown = false; try { run(z.w, 1); } catch (e) { thrown = true; } ok(!thrown && zf.judged > 0, 'a dead owner leaves the zone running without throwing (it still Judges)');
}

// ---------------- wire: hero flags, zone follow field, event caps ----------------
{
  const { w, p } = stage({ c_s1: 1, c_s1_b: 3 }); const q = ally(w, 'knight', p.x + 30, p.y);
  w.playerSkill(p, 0, {}, 0); run(w, 0.1);
  let s = ED.Net.encodeSnap(w, [], false); const row = (pid) => s.P.find(r => r[0] === pid);
  ok((row(q.pid)[6] & 2048) && !(row(q.pid)[6] & 1024) && !(row(p.pid)[6] & 2048), 'hero flag 1 << 11: Emboldened');
  q.glT = 3; s = ED.Net.encodeSnap(w, [], false); ok((row(q.pid)[6] & 1024) !== 0 && !(row(p.pid)[6] & 1024), 'hero flag 1 << 10: Guardian Light buff');
  q.glV = 0.0834; q.auraV = 0.1; q.knellN = 3; q.knellT = 6; q.tranceT = 2; s = ED.Net.encodeSnap(w, [], false);
  ok(row(q.pid)[21] === 3 && row(p.pid)[21] === 0 && row(q.pid)[22] === 0.083 && row(p.pid)[22] === 0 && row(q.pid)[23] === 0.1 && row(p.pid)[23] === 0, 'P[21..23]: Death Knell stacks, Guardian Light and Embolden bonus; 0 on a hero without them');
  ok((row(q.pid)[6] & 4096) !== 0 && !(row(p.pid)[6] & 4096), 'hero flag 1 << 12: Battle Trance'); q.knellT = 0; q.glT = 0; q.auraT = 0; q.tranceT = 0; s = ED.Net.encodeSnap(w, [], false);
  ok(row(q.pid)[21] === 0 && row(q.pid)[22] === 0 && row(q.pid)[23] === 0 && !(row(q.pid)[6] & 4096), 'expired Knell, Guardian Light, Embolden and Trance are off the wire');
  const z = s.Z.find(r => r[1] === ED.Net.ZK.indexOf('sanct')); ok(z && z[17] === 1 + p.slot, 'a following zone carries its owner slot + 1');
  const w2 = stage({ c_s1: 1 }); w2.w.playerSkill(w2.p, 0, { x0: w2.p.x, y0: w2.p.y, x: w2.p.x + 40, y: w2.p.y }, 0); const s2 = ED.Net.encodeSnap(w2.w, [], false); ok(s2.Z.find(r => r[1] === ED.Net.ZK.indexOf('sanct'))[17] === 0, 'a placed Sanctuary carries 0');
  const caps = ED.Net.CAPS; ok(caps.solar > 0 && caps.verdict > 0 && caps.hturn > 0 && caps.chain > 0, 'new events are capped'); const many = []; for (let i = 0; i < 40; i++) many.push({ t: 'solar' }); ok(ED.Net.capFx(many, caps).length === caps.solar, 'capFx trims solar');
}

// ---------------- Judgment's boss factor: a boss takes x2 from every hammer leg; Verdict and Sanctuary carry none ----------------
{
  const BOSS = 2;
  const legs = (boons, boss) => { // one cast at a lone foe 60 px away (common or boss), held in place so every leg finds it
    const S = stage(boons), e = foe(S.w, S.p.x + 60, S.p.y); if (boss) e.boss = true;
    const log = spy(S.w); S.w.playerSkill(S.p, 0, {}, 1); run(S.w, 12, () => { e.kbx = 0; e.kby = 0; });
    return { S, e, hits: partHits(log, 'judgment.leg') };
  };
  const leg = ED.SKILLS.judgment.parts.find(q => q.id === 'leg');
  ok(leg.bossMul === BOSS && /bosses ×2/.test(leg.note) && /bosses take ×2 from the hammer/.test(ED.SKILLS.judgment.desc), 'skill data and text name the boss factor (Judgment x2)');
  ok(!ED.SKILLS.judgment.parts.some(q => q.id !== 'leg' && q.bossMul) && !ED.SKILLS.sanctuary.parts.some(q => q.bossMul), 'Verdict, the echo and Sanctuary carry no boss factor');
  for (const [name, boons, want] of [['one hammer', { c_s2: 1 }, 2], ['Second Flight', { c_s2: 1, c_s2_a: 2 }, 8], ['Hammerstorm', { c_s2: 1, c_s2_a: 3 }, 10]]) {
    const a = legs(boons, false), b = legs(boons, true);
    ok(a.hits.length >= want && b.hits.length === a.hits.length, `${name}: at least ${want} legs strike a common foe and a boss alike (${a.hits.length}, ${b.hits.length})`);
    ok(a.hits.length === b.hits.length && a.hits.every((h, i) => Math.abs(b.hits[i].d / h.d - BOSS) < 1e-6), `${name}: every leg deals x2 to a boss`);
  }
  { // a common foe takes the plain leg (the hammer Judges it first: +20%)
    const a = legs({ c_s2: 1 }, false), N = ED.Stats.skillNums('judgment', a.S.p.stats);
    near(a.hits[0].d / (N.p.leg.dmg * a.S.p.stats.dmg * 1.2 * a.S.w.affC(a.S.p.stats.element)), 1, 0.01, 'a common foe takes the plain hammer leg');
    ok(!(a.e.stun > 0), 'the hammer stuns nobody');
  }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
