// Usage: node tools/check-cleric.js
// Headless checks of the 12 Cleric route cards against DESIGN-classes section 8 in staged rooms: waves (Dawnbringer, Sunhammer, Crusader), Sanctuary (Sanctum, Holy Fury, Aura of Faith), Judgment (Hammer of Judgment, Twin Hammers, Verdict)
// and the Holy element route (Radiant Faith, Guardian Light, Prism), plus the wire fields they use. Prints failures and exits 1 when any check fails.
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
    [{ c_atk: 1, c_atk_h: 1 }, { waveBig: 1, waveStun: 0.4, waveMul: 0.3, waveBurst: 0 }], [{ c_atk: 1, c_atk_h: 2 }, { waveMul: 0.4, waveBurst: 0 }], [{ c_atk: 1, c_atk_h: 3 }, { waveMul: 0.5, waveBurst: 0.5 }],
    [{ c_atk: 1, c_atk_s: 1 }, { waveHome: 2, waveMul: 0.4, litany: 0 }], [{ c_atk: 1, c_atk_s: 2 }, { waveMul: 0.5 }], [{ c_atk: 1, c_atk_s: 3 }, { waveMul: 0.6, litany: 6 }],
    [{ c_s1: 1 }, { s1Area: 0.3, s1Dur: 2, sanctDR: 0.1, s1Dmg: 0.5 }],
    [{ c_s1: 1, c_s1_a: 1 }, { sanctStun: 1, s1Dmg: 1.5 * 1.4 - 1, sanctJudge: 0 }], [{ c_s1: 1, c_s1_a: 2 }, { s1Dmg: 1.5 * 1.5 - 1 }], [{ c_s1: 1, c_s1_a: 3 }, { s1Dmg: 1.5 * 1.6 - 1, sanctJudge: 1 }],
    [{ c_s1: 1, c_s1_b: 1 }, { aura: 1, s1Dmg: 1.5 * 0.6 - 1, sanctDR: 0.1, auraDmg: 0 }], [{ c_s1: 1, c_s1_b: 2 }, { sanctDR: 0.12 }], [{ c_s1: 1, c_s1_b: 3 }, { sanctDR: 0.14, auraDmg: 0.1 }],
    [{ c_s2: 1 }, { s2Dmg: 0.3, s2Range: 0.4, judgeDur: 2, s2Cdr: 0.167 }],
    [{ c_s2: 1, c_s2_a: 1 }, { twinHammer: 0.6, thirdLeg: 0 }], [{ c_s2: 1, c_s2_a: 2 }, { s2Dmg: 1.3 * 1.1 - 1 }], [{ c_s2: 1, c_s2_a: 3 }, { thirdLeg: 1, s2Dmg: 1.3 * 1.2 - 1 }],
    [{ c_s2: 1, c_s2_b: 1 }, { verdict: 1, judgeWeak: 0.2, verdictJudge: 0 }], [{ c_s2: 1, c_s2_b: 2 }, { s2Dmg: 1.3 * 1.1 - 1 }], [{ c_s2: 1, c_s2_b: 3 }, { verdictJudge: 1, s2Dmg: 1.3 * 1.2 - 1 }],
    [{ c_el: 1 }, { classElMul: 0.25, wInfHoly: 0.12 }],
    [{ c_el: 1, c_el_a: 1 }, { smiteBig: 0.5, guardLight: 0.08, smiteJudge: 0 }], [{ c_el: 1, c_el_a: 2 }, { guardLight: 0.1 }], [{ c_el: 1, c_el_a: 3 }, { guardLight: 0.12, smiteJudge: 3 }],
    [{ c_el: 1, c_el_b: 1 }, { smiteMul: 0.3, smiteBeam: 0.5, beamJumps: 0 }], [{ c_el: 1, c_el_b: 2 }, { smiteMul: 0.4 }], [{ c_el: 1, c_el_b: 3 }, { smiteMul: 0.5, beamJumps: 1 }],
  ];
  for (const [b, want] of rows) { const st = build(0, b); for (const k in want) near(st[k], want[k], 1e-9, JSON.stringify(b) + ' ' + k); }
  ok(ED.CLASS_CARDS.cleric.attack.forks.join() === 'c_atk_h,c_atk_s' && ED.boonText('c_atk_h', 3).indexOf('Solar Flare') > 0 && !/[{}\[\]]/.test(ED.boonText('c_s1_b', 3)), 'card text and fork table');
}

// ---------------- Dawnbringer: a wave every 2nd attack at +30%; the Sacred Lantern gains waves ----------------
{
  const { w, p } = stage({ c_atk: 1 }); let k = 0, dmg = 0, rate = [];
  for (let i = 0; i < 6; i++) { w.projs.length = 0; w.playerAttack(p, 0); const ws = waves(w); k += ws.length; rate.push(ws.length); if (ws.length) dmg = ws[0].dmg; }
  ok(rate.join() === '0,1,0,1,0,1', `Dawnbringer: a wave on attacks 2, 4, 6 (got ${rate.join()})`);
  near(dmg, 17 * 0.9 * 1.3, 1e-6, 'Holy Mace wave damage 17 x 0.9 x 1.3');
  const base = stage({}); let b = 0; for (let i = 0; i < 6; i++) { base.w.projs.length = 0; base.w.playerAttack(base.p, 0); b += waves(base.w).length; }
  ok(b === 2, `no route: a wave every 3rd attack (got ${b})`);
  const L = stage({ c_atk: 1 }, 2); let lw = 0, ld = 0;
  for (let i = 0; i < 6; i++) { L.w.projs.length = 0; L.w.playerAttack(L.p, 0); const ws = waves(L.w); lw += ws.length; if (ws.length) ld = ws[0].dmg; }
  ok(lw === 3 && L.p.stats.weapon.wave.every === 3 && L.p.stats.weapon.wave.mul === 0.6, 'Sacred Lantern gains a wave (60%) with Dawnbringer'); near(ld, 12.5 * 0.6 * 1.3, 1e-6, 'Lantern wave damage 12.5 x 0.6 x 1.3');
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
  // Solar Flare: the wave ends in a burst of r50 at 50% of the wave, with no wave contact needed
  const f3 = stage({ c_atk: 1, c_atk_h: 3 }), flare = (S, x, y, why) => { const pr = { kind: 'wave', x, y, dmg: 100, infAdd: null }; ED.CLS.cleric.projEnd.call(S.w, pr, S.p, why); };
  const fin = foe(f3.w, f3.p.x + 40, f3.p.y), fout = foe(f3.w, f3.p.x + 70, f3.p.y + 1); flare(f3, f3.p.x, f3.p.y, 'life'); // 40 px from the burst: inside; 70 px: outside r50 + the foe's radius 11
  const sol = evs(f3.w, 'solar')[0]; ok(sol && sol.r === 50, 'Solar Flare event r50'); near(lost(fin), 100 * 0.5 * f3.p.stats.dmg, 0.05, 'Solar Flare deals 50% of the wave to a foe in r50'); ok(lost(fout) === 0, 'Solar Flare does not reach past r50');
  // end to end: a wave that runs into the east wall bursts there (the room is too small for the full range)
  const ew = stage({ c_atk: 1, c_atk_h: 3 }); let wall = ew.p.x; while (!ED.Dungeon.blocksShots(ED.Dungeon.tileAt(ew.w.room, wall, ew.p.y), false)) wall += 2;
  const bf = foe(ew.w, wall - 24, ew.p.y); ew.w.playerAttack(ew.p, 0); ew.w.projs.length = 0; ew.w.playerAttack(ew.p, 0); const wd = waves(ew.w)[0].dmg; let sn = 0; run(ew.w, 1.2, () => { sn += evs(ew.w, 'solar').length; ew.w.fx.length = 0; });
  ok(sn === 1 && lost(bf) > wd * ew.p.stats.dmg * 1.3, `a wave that ends at a wall bursts once, the foe there takes wave + burst (${lost(bf).toFixed(1)} of ${(wd * ew.p.stats.dmg).toFixed(1)} + half)`);
  const wa = stage({ c_atk: 1, c_atk_h: 3 }); wa.p.stats.area = 1; flare(wa, wa.p.x, wa.p.y, 'life'); ok(evs(wa.w, 'solar')[0].r === 50, 'Solar Flare radius is fixed at 50 whatever the area stat');
  const nf = stage({ c_atk: 1, c_atk_h: 2 }); flare(nf, nf.p.x, nf.p.y, 'life'); ok(evs(nf.w, 'solar').length === 0, 'no Solar Flare below rank 3');
}

// ---------------- Crusader: waves steer inside 25 degrees only; Litany fan every 6th attack ----------------
{
  const cone = 25 * Math.PI / 180, ang = (pr) => Math.atan2(pr.vy, pr.vx);
  const steer = (deg) => { const { w, p } = stage({ c_atk: 1, c_atk_s: 1 }); const a = deg * Math.PI / 180; foe(w, p.x + Math.cos(a) * 170, p.y + Math.sin(a) * 170); w.playerAttack(p, 0); w.projs.length = 0; w.playerAttack(p, 0); const wv = waves(w)[0]; for (let i = 0; i < 12; i++) w.updateProjectiles(DT); return ang(wv); };
  ok(steer(15) > 0.05 && steer(15) <= cone + 1e-9, `Crusader wave steers toward a foe 15 degrees off (${steer(15).toFixed(3)} rad)`); near(steer(40), 0, 1e-9, 'Crusader wave ignores a foe 40 degrees off');
  const one = stage({ c_atk: 1, c_atk_s: 1 }); one.w.playerAttack(one.p, 0); one.w.projs.length = 0; one.w.playerAttack(one.p, 0); const wv = waves(one.w)[0];
  near(wv.homing, 2, 1e-9, 'waveHome turn rate'); near(wv.homeCone, cone, 1e-9, 'cone 25 degrees'); near(wv.dmg, one.p.stats.weapon.dmg * 0.9 * 1.4, 1e-6, 'Crusader wave +10% (+30% Dawnbringer)'); ok(one.p.stats.swift, 'Crusader is a Swift weapon');
  const lit = stage({ c_atk: 1, c_atk_s: 3 }); const per = [], fan = [];
  for (let i = 0; i < 12; i++) { lit.w.projs.length = 0; lit.w.playerAttack(lit.p, 0); const ws = waves(lit.w); per.push(ws.length); if (ws.length === 3) fan.push(ws.map(q => +ang(q).toFixed(3)).sort((a, b) => a - b)); }
  ok(per.join() === '0,1,0,1,0,3,0,1,0,1,0,3', `Litany: the 6th and 12th attack send three waves (got ${per.join()})`);
  ok(fan.length === 2 && fan.every(f => Math.abs(f[0] + 0.25) < 0.01 && Math.abs(f[1]) < 0.01 && Math.abs(f[2] - 0.25) < 0.01), 'Litany fan is -0.25, 0, +0.25 rad');
  const fw = waves(lit.w); near(fw[0].dmg, fw[1].dmg, 1e-9, 'fan waves deal equal damage'); ok(fw.every(q => q.homeCone > 0 && Math.abs(q.homeA0 - ang(q)) < 0.01), 'each fan wave steers around its own launch angle');
  const nolit = stage({ c_atk: 1, c_atk_s: 2 }); let m = 0; for (let i = 0; i < 12; i++) { nolit.w.projs.length = 0; nolit.w.playerAttack(nolit.p, 0); m += waves(nolit.w).length === 3 ? 1 : 0; } ok(m === 0, 'no Litany below rank 3');
}

// ---------------- Sanctum: radius, length (60% of the cooldown at most), damage, damage reduction ----------------
{
  const st = build(0, { c_s1: 1 }), N = ED.Stats.skillNums('sanctuary', st), q = N.p.zone;
  near(q.r, 130, 1e-9, 'Sanctum radius 100 x 1.3'); near(q.dur, 5.5, 1e-9, 'Sanctum lasts 3.5 + 2 s'); near(q.dmg, (10 + 1.2 * 17) * 1.5, 1e-9, 'Sanctum damage +50%'); near(N.cdEff, 11, 1e-9, 'Sanctuary cooldown 11 s');
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
  const st = build(0, { c_s1: 1, c_s1_a: 1 }); near(ED.Stats.skillNums('sanctuary', st).p.zone.dmg, (10 + 1.2 * 17) * 1.5 * 1.4, 1e-9, 'Holy Fury zone damage x1.5 x1.4');
  const { w, p } = stage({ c_s1: 1, c_s1_a: 1 }); const e = foe(w, p.x + 60, p.y), el = foe(w, p.x + 70, p.y + 10, { elite: 'swift' }), bs = foe(w, p.x + 80, p.y - 10); bs.boss = true; const out = foe(w, p.x + 380, p.y);
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 60, y: p.y }, 0);
  const sk = evs(w, 'skill')[0]; ok(sk && sk.hf === 1 && !sk.au && sk.k === 'sanctuary', 'skill event carries hf (Holy Fury)');
  near(e.stun, 1, 1e-9, 'foe inside is stunned 1 s'); near(el.stun, 0.5, 1e-9, 'elite stun halved'); near(bs.stun, 0, 1e-9, 'bosses are not stunned'); near(out.stun, 0, 1e-9, 'foe outside is not stunned'); ok(e.stunCd > 0, 'cast stun sets the stun cooldown');
  const r1 = stage({ c_s1: 1, c_s1_a: 1 }); const e1 = foe(r1.w, r1.p.x + 60, r1.p.y); r1.w.playerSkill(r1.p, 0, { x0: r1.p.x, y0: r1.p.y, x: r1.p.x + 60, y: r1.p.y }, 0); run(r1.w, 1); ok(lost(e1) > 0 && e1.judged <= 0, 'Holy Fury burns foes inside; no Judged below rank 3');
  const g = stage({ c_s1: 1, c_s1_a: 3 }); const gi = foe(g.w, g.p.x + 60, g.p.y), go = foe(g.w, g.p.x + 380, g.p.y);
  g.w.playerSkill(g.p, 0, { x0: g.p.x, y0: g.p.y, x: g.p.x + 60, y: g.p.y }, 0); run(g.w, 0.2); ok(gi.judged > 0.3 && go.judged <= 0, 'Hallowed Ground: foes inside are Judged, foes outside are not');
  const hp1 = gi.hp; g.w.hitEnemy(gi, 100, { p: g.p, kind: 'weapon', crit: false }); near(hp1 - gi.hp, 100 * 1.2 * g.p.stats.dmg, 0.5, 'Judged foes take +20%');
  run(g.w, 7); ok(!(gi.judged > 0), 'Judged fades 0.6 s after the zone ends');
}

// ---------------- Aura of Faith: centred on the Cleric, moves with them, deals 40% less; Embolden ----------------
{
  const { w, p } = stage({ c_s1: 1, c_s1_b: 3 }); const a = ally(w, 'ranger', p.x + 40, p.y), far = ally(w, 'knight', p.x + 500, p.y);
  const st = p.stats, N = ED.Stats.skillNums('sanctuary', st);
  ok(N.aim === 'self', 'Aura of Faith casts on the Cleric (aim self)'); near(N.p.zone.dmg, (10 + 1.2 * 17) * 1.5 * 0.6, 1e-9, 'Aura damage x1.5 x0.6');
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 150, y: p.y + 90 }, 0); // the cursor is ignored
  const z = w.zones.find(q => q.kind === 'sanct'); ok(z && z.follow === p.pid && z.x === p.x && z.y === p.y, 'zone is at the caster and follows them'); near(z.dr, 0.15 + 0.14, 1e-9, 'Aura rank 3: 15% + 10% + 4%');
  const sk = evs(w, 'skill')[0]; ok(sk && sk.au === 1 && sk.x === Math.round(p.x), 'skill event carries au'); w.fx.length = 0;
  p.x += 30; run(w, 0.05); ok(Math.abs(z.x - p.x) < 1e-9 && Math.abs(z.y - p.y) < 1e-9, 'the aura moves with the Cleric');
  ok(a.auraT > 0, 'allies inside are Emboldened'); near(a.auraV, 0.1, 1e-9, 'Embolden +10%'); ok(!(p.auraT > 0), 'the Cleric itself is not Emboldened'); ok(!(far.auraT > 0), 'allies outside are not');
  const hitBy = (who) => { const e = foe(w, who.x + 20, who.y); const h = e.hp; w.hitEnemy(e, 100, { p: who, kind: 'weapon', crit: false }); return h - e.hp; };
  a.auraT = 0; const noBuff = hitBy(a); a.auraT = 1; a.auraV = 0.1; near(hitBy(a) / noBuff, (a.stats.dmg + 0.1) / a.stats.dmg, 0.01, 'Embolden adds 10% to the damage multiplier');
  run(w, 0.5); a.x = p.x + 600; run(w, 0.5); ok(!(a.auraT > 0), 'Embolden lapses 0.3 s after leaving the aura');
  const r1 = stage({ c_s1: 1, c_s1_b: 1 }); r1.w.playerSkill(r1.p, 0, { x0: r1.p.x, y0: r1.p.y, x: r1.p.x, y: r1.p.y }, 0); const al = ally(r1.w, 'ranger', r1.p.x + 20, r1.p.y); run(r1.w, 0.1); ok(!(al.auraT > 0), 'no Embolden before rank 3');
  near(build(0, { c_s1: 1, c_s1_b: 1 }).sanctDR, 0.1, 1e-9, 'Aura rank 1 keeps Sanctum DR'); near(build(0, { c_s1: 1, c_s1_b: 2 }).sanctDR, 0.12, 1e-9, 'Aura +2% damage reduction per rank');
}

// ---------------- Hammer of Judgment: damage, range, Judged length, recharge ----------------
{
  const base = stage({ c_s2: 0 }), s = stage({ c_s2: 1 });
  const turnAt = (S) => { let t = 0; const real = ED.Dungeon.blocksShots; ED.Dungeon.blocksShots = () => false; S.w.playerSkill(S.p, 0, {}, 1); const h = S.p.hammers[0]; for (let i = 0; i < 120 && !t; i++) { S.w.update(DT); if (h.leg === 1 && !t) t = h.t; } ED.Dungeon.blocksShots = real; return t; }; // the staged room is too small for the full flight: walls off, time the turn
  const tb = turnAt(base), tc = turnAt(s);
  near(tb, 0.55, 0.02, 'the hammer turns after 0.55 s'); near(tc, 0.55 * 1.4, 0.02, 'Hammer of Judgment flies 40% farther (turns after 0.77 s)');
  near(ED.Stats.skillNums('judgment', s.p.stats).p.leg.dmg, (18 + 1.4 * 17) * 1.3, 1e-9, 'Judgment leg damage +30%'); near(s.p.stats.skill2Cd, 9 * (1 - 0.167), 1e-9, 'Judgment recharges 17% faster (7.5 s)');
  const j = stage({ c_s2: 1 }); const e = foe(j.w, j.p.x + 60, j.p.y); j.w.playerSkill(j.p, 0, {}, 1); let t = 0; run(j.w, 0.4, () => { if (e.judged > 0 && !t) t = e.judged; });
  near(t, 6, 0.1, 'Judged lasts 4 + 2 s'); ok(e.judgeOwner === 'p0' && e.judgeCast === 1, 'a hammer hit stamps the cast');
  const jb = stage({}); const eb = foe(jb.w, jb.p.x + 60, jb.p.y); jb.w.playerSkill(jb.p, 0, {}, 1); let t4 = 0; run(jb.w, 0.4, () => { if (eb.judged > 0 && !t4) t4 = eb.judged; }); near(t4, 4, 0.1, 'Judged lasts 4 s without the card');
  // the hit that Judges lands on a Judged foe: +20% in the leg itself
  const first = stage({}); const fe = foe(first.w, first.p.x + 60, first.p.y); first.w.playerSkill(first.p, 0, {}, 1); let got = 0; run(first.w, 0.3, () => { if (!got && fe.hp < 5000) got = lost(fe); });
  near(got, ED.Stats.skillNums('judgment', first.p.stats).p.leg.dmg * first.p.stats.dmg * 1.2 * first.w.affC('holy'), 0.05, 'the leg that Judges is itself boosted by 20% (Judged is set first; Holy affinity of the stratum)');
}

// ---------------- Twin Hammers, Second Flight ----------------
{
  const count = (boons, secs) => { const S = stage(boons); const e = foe(S.w, S.p.x + 40, S.p.y); let hits = 0, turns = []; const orig = S.w.hitEnemy; S.w.hitEnemy = function (f, d, src) { if (src && src.part === 'judgment.leg') hits++; return orig.call(this, f, d, src); }; S.w.playerSkill(S.p, 0, {}, 1); const n0 = S.p.hammers.length; run(S.w, secs, () => { for (const ev of S.w.fx) if (ev.t === 'hturn') turns.push(ev.n); S.w.fx.length = 0; }); return { hits, n0, left: S.p.hammers.length, projs: S.w.projs.filter(q => q.kind === 'hammer').length, e, turns, S }; };
  const one = count({ c_s2: 1 }, 5), tw = count({ c_s2: 1, c_s2_a: 1 }, 5), sf = count({ c_s2: 1, c_s2_a: 3 }, 12);
  ok(one.n0 === 1 && one.hits === 2 && one.turns.join() === '1,4', `one hammer hits a foe on the axis twice (out and back); turns ${one.turns.join()}`);
  ok(tw.n0 === 2 && tw.hits === 4, `Twin Hammers: two hammers, two legs each (hits ${tw.hits})`);
  const th = stage({ c_s2: 1, c_s2_a: 1 }); th.w.playerSkill(th.p, 0, {}, 1); const angs = th.p.hammers.map(h => Math.atan2(h.pr.vy, h.pr.vx)).sort((a, b) => a - b); near(angs[0], -0.2, 1e-9, 'V angle -0.2'); near(angs[1], 0.2, 1e-9, 'V angle +0.2');
  const tl = ED.Stats.skillNums('judgment', th.p.stats).p.leg.dmg; near(tl, (18 + 1.4 * 17) * 1.3 * 0.6, 1e-9, 'each Twin hammer deals 60%');
  ok(sf.n0 === 2 && sf.hits === 8, `Second Flight: four legs each (hits ${sf.hits})`); ok(sf.turns.slice(0, 4).sort().join() === '1,1,2,2' && sf.left === 0 && sf.projs === 0, `Second Flight turns ${sf.turns.join()} and the hammers are gone`);
  const rk = build(0, { c_s2: 1, c_s2_a: 2 }); near(ED.Stats.skillNums('judgment', rk).p.leg.dmg, (18 + 1.4 * 17) * 1.3 * 1.1 * 0.6, 1e-9, 'Twin Hammers rank 2: +10%');
  // a wall on the way out turns the hammer (and the second out leg too)
  const wl = stage({ c_s2: 1, c_s2_a: 3 }); wl.w.playerSkill(wl.p, Math.PI, {}, 1); let turned = false; run(wl.w, 0.1); for (let i = 0; i < 400 && wl.p.hammers.length; i++) { wl.w.update(DT); if (wl.p.hammers.some(h => h.leg >= 1)) turned = true; } ok(turned, 'a hammer that meets a wall turns for home');
}

// ---------------- Verdict: weaken, queued burst, Sentence ----------------
{
  const { w, p } = stage({ c_s2: 1, c_s2_b: 1 });
  const jt = foe(w, p.x + 60, p.y), jb = foe(w, p.x + 70, p.y + 14); jb.boss = true; w.playerSkill(p, 0, {}, 1); run(w, 0.4);
  ok(jt.weakT > 5 && Math.abs(jt.weakV - 0.2) < 1e-9 && jb.weakT > 5 && Math.abs(jb.weakV - 0.1) < 1e-9, 'Judged foes are weakened by 20% (bosses 10%)');
  const q = ally(w, 'knight', p.x, p.y - 60); q.stats.armor = 0; const dmgFrom = (e) => { q.hp = q.maxHp; q.invuln = 0; w.hurtPlayer(q, 100, { e }); return q.maxHp - q.hp; };
  const plain = foe(w, p.x + 900, p.y); const full = dmgFrom(plain); near(dmgFrom(jt) / full, 0.8, 0.02, 'a weakened foe deals 20% less'); near(dmgFrom(jb) / full, 0.9, 0.02, 'a weakened boss deals 10% less');
  jt.weakT = 0; near(dmgFrom(jt) / full, 1, 0.01, 'the weaken ends with the timer');
}
{
  const { w, p } = stage({ c_s2: 1, c_s2_b: 1 }); const bx = p.x - 120, by = p.y;
  const dead = foe(w, bx, by), near1 = foe(w, bx + 40, by), el = foe(w, bx, by + 50, { elite: 'swift' }), bs = foe(w, bx - 40, by - 30); bs.boss = true; const far = foe(w, bx, by + 140), plainDead = foe(w, bx + 100, by - 100);
  dead.judged = 5; dead.judgeOwner = p.pid; dead.judgeCast = 1; dead.hp = 5;
  w.hitEnemy(dead, 999, { p, kind: 'weapon', crit: false }); ok(dead.hp <= 0, 'the Judged foe dies'); near(near1.stun, 0, 1e-9, 'the burst is queued, not instant'); ok(w.chainQ.some(en => en.kind === 'verdict'), 'Verdict queues a payoff');
  let stunN = 0, stunE = 0, stunB = 0; for (let i = 0; i < 40 && !evs(w, 'verdict').length; i++) { w.update(DT); if (evs(w, 'verdict').length) { stunN = near1.stun; stunE = el.stun; stunB = bs.stun; } }
  const v = ED.Stats.skillNums('judgment', p.stats).p.verdict, vev = evs(w, 'verdict')[0];
  near(v.dmg, (20 + 3 * 17) * 1.3, 1e-9, 'Verdict burst 71 x s2Dmg'); near(v.r, 70, 1e-9, 'Verdict radius 70'); ok(vev && vev.r === 70 && Math.abs(vev.x - dead.x) < 1, 'verdict event at the dead foe');
  near(lost(near1), v.dmg * p.stats.dmg * w.affC(p.stats.element), 0.2, 'burst damage to a foe within 70 (Holy, class affinity)'); ok(lost(far) === 0 && lost(plainDead) === 0, 'foes beyond 70 are untouched');
  near(stunN, 0.4, 0.01, 'burst stun 0.4 s'); ok(Math.hypot(el.x - dead.x, el.y - dead.y) < 70 + el.r && stunE > 0.19 && stunE < 0.21, `elite burst stun is half (${stunE})`); ok(stunB === 0 && lost(bs) > 0, 'bosses take the burst but are not stunned');
  const q2 = stage({ c_s2: 1, c_s2_b: 1 }); const d2 = foe(q2.w, q2.p.x - 120, q2.p.y), n2 = foe(q2.w, q2.p.x - 80, q2.p.y); d2.hp = 5; q2.w.hitEnemy(d2, 99, { p: q2.p, kind: 'weapon', crit: false }); run(q2.w, 0.3); ok(lost(n2) === 0, 'a foe that was not Judged bursts nothing');
  const q3 = stage({ c_s2: 1, c_s2_b: 1 }); const d3 = foe(q3.w, q3.p.x - 120, q3.p.y), n3 = foe(q3.w, q3.p.x - 80, q3.p.y); d3.judged = 5; d3.hp = 5; let nv = 0; q3.w.hitEnemy(d3, 99, { p: q3.p, kind: 'weapon', crit: false }); run(q3.w, 0.3, () => { nv += evs(q3.w, 'verdict').length; q3.w.fx.length = 0; });
  ok(nv === 1 && lost(n3) > 0, 'a Judged death with no stamp (another Judge) still bursts for the Verdict owner');
  const q4 = stage({ c_s2: 1 }); const d4 = foe(q4.w, q4.p.x - 120, q4.p.y), n4 = foe(q4.w, q4.p.x - 80, q4.p.y); d4.judged = 5; d4.hp = 5; q4.w.hitEnemy(d4, 99, { p: q4.p, kind: 'weapon', crit: false }); run(q4.w, 0.3); ok(lost(n4) === 0, 'no Verdict burst without the card');
}
{ // Sentence: the burst Judges the foes it leaves standing (the blow itself is not boosted); a Judged foe that dies later bursts in turn; each death pays out once
  const { w, p } = stage({ c_s2: 1, c_s2_b: 3 }); const bx = p.x - 150, by = p.y;
  const d = foe(w, bx, by), b = foe(w, bx + 50, by), c = foe(w, bx + 100, by), z = foe(w, bx + 100, by + 150); d.judged = 5; d.hp = 5;
  let nv = 0; w.hitEnemy(d, 99, { p, kind: 'weapon', crit: false }); run(w, 0.3, () => { nv += evs(w, 'verdict').length; w.fx.length = 0; });
  const v = ED.Stats.skillNums('judgment', p.stats).p.verdict;
  ok(nv === 1 && b.judged > 4 && b.weakT > 4 && !(c.judged > 0) && lost(c) === 0 && lost(z) === 0, `Sentence: the burst Judges (and weakens) the foe it hit, not those beyond r70 (${nv} burst)`);
  near(lost(b), v.dmg * p.stats.dmg * w.affC(p.stats.element), 0.2, 'the burst hits before it Judges: no +20% on that blow');
  b.hp = 5; w.hitEnemy(b, 99, { p, kind: 'weapon', crit: false }); nv = 0; run(w, 0.3, () => { nv += evs(w, 'verdict').length; w.fx.length = 0; });
  ok(b.hp <= 0 && nv === 1 && c.judged > 4 && lost(c) > 0 && lost(z) === 0, `Sentence: the Judged neighbour bursts in turn and Judges the next foe (${nv} burst)`);
  const no = stage({ c_s2: 1, c_s2_b: 2 }); const d3 = foe(no.w, no.p.x - 150, no.p.y), b3 = foe(no.w, no.p.x - 110, no.p.y); d3.judged = 5; d3.hp = 5; no.w.hitEnemy(d3, 99, { p: no.p, kind: 'weapon', crit: false }); run(no.w, 0.3); ok(lost(b3) > 0 && !(b3.judged > 0), 'no Sentence below rank 3');
}
{ // the kill shield of Judgment (3% max HP, once per cast) is kept
  const { w, p } = stage({ c_s2: 1 }); const e = foe(w, p.x + 80, p.y), e2 = foe(w, p.x + 90, p.y + 10); w.playerSkill(p, 0, {}, 1); run(w, 0.3); e.hp = 3; e2.hp = 3; p.shield = 0;
  w.hitEnemy(e, 99, { p, kind: 'weapon', crit: false }); w.hitEnemy(e2, 99, { p, kind: 'weapon', crit: false }); near(p.shield, 0.03 * p.maxHp, 0.01, 'Judgment kill shield 3% once per cast');
  const st = stage({ c_s2: 1 }); const s1 = foe(st.w, st.p.x + 80, st.p.y); st.w.playerSkill(st.p, 0, {}, 1); run(st.w, 0.3); ok(s1.judgeUntil > st.w.time + 5, 'a hammer hit stamps the end of its own Judged window');
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
  const r2 = stage({ c_el: 1, c_el_a: 2 }); const e2 = foe(r2.w, r2.p.x + 60, r2.p.y); smiteIt(r2.w, r2.p, e2, 1000); near(r2.p.glV, 0.1, 1e-9, 'rank 2: +10%');
  const nob = stage({ c_el: 1 }); const e3 = foe(nob.w, nob.p.x + 60, nob.p.y); smiteIt(nob.w, nob.p, e3, 1000); ok(!(nob.p.glT > 0) && !(e3.judged > 0), 'no buff and no Judged without the card');
  const jl = stage({ c_el: 1, c_el_a: 3 }); const e4 = foe(jl.w, jl.p.x + 60, jl.p.y); smiteIt(jl.w, jl.p, e4, 1000); near(e4.judged, 3, 1e-9, 'Judging Light: the smitten foe is Judged 3 s'); near(jl.p.glV, 0.12, 1e-9, 'rank 3: +12%');
  const hc = stage({ c_el: 1, c_el_a: 1 }); const e5 = foe(hc.w, hc.p.x + 60, hc.p.y); smiteIt(hc.w, hc.p, e5, 1000); hc.p.glT = 2; const gv = hc.p.glV; smiteIt(hc.w, hc.p, e5, 1000); near(hc.p.glV, gv, 1e-9, 'the buff is not refreshed while the Holy shield cooldown runs');
}

// ---------------- Prism: bigger Smites, a beam to the nearest other foe, Sunburst jumps ----------------
{
  const S = stage({ c_el: 1, c_el_b: 1 }); const a = foe(S.w, S.p.x + 100, S.p.y), b = foe(S.w, S.p.x + 160, S.p.y), c = foe(S.w, S.p.x + 100, S.p.y + 100), far = foe(S.w, S.p.x + 100, S.p.y + 300);
  a.maxHp = a.hp = 1e9; smiteIt(S.w, S.p, a, 1000);
  const smite = 1000 * 1.3; near(1e9 - a.hp, smite, 1e-6, 'Prism Smite +30%'); ok(S.w.chainQ.some(en => en.kind === 'beam'), 'the beam is a queued payoff'); ok(lost(b) === 0, 'the beam is not instant');
  let beams = []; run(S.w, 0.3, () => { for (const e of S.w.fx) if (e.t === 'chain' && e.k === 'b') beams.push(e); S.w.fx.length = 0; });
  near(lost(b), smite * 0.5, 0.01, 'the beam deals half the Smite to the nearest other foe'); ok(lost(c) === 0 && lost(far) === 0, 'only the nearest foe within 120 is struck'); ok(beams.length === 1 && beams[0].pts.length === 2, 'one beam event, two points');
  const T = stage({ c_el: 1, c_el_b: 3 }); const a2 = foe(T.w, T.p.x + 100, T.p.y), b2 = foe(T.w, T.p.x + 160, T.p.y), c2 = foe(T.w, T.p.x + 220, T.p.y), d2 = foe(T.w, T.p.x + 280, T.p.y), e2 = foe(T.w, T.p.x + 100, T.p.y + 400);
  a2.maxHp = a2.hp = 1e9; smiteIt(T.w, T.p, a2, 1000); let n2 = 0; run(T.w, 0.5, () => { for (const e of T.w.fx) if (e.t === 'chain' && e.k === 'b') n2++; T.w.fx.length = 0; });
  const big = 1000 * 1.5; near(lost(b2), big * 0.5, 0.01, 'Sunburst: the first beam'); near(lost(c2), big * 0.25, 0.01, 'Sunburst: the jump deals half again'); ok(lost(d2) === 0 && lost(e2) === 0 && n2 === 2, `the beam jumps once (${n2} beams) and stops`);
  const U2 = stage({ c_el: 1, c_el_b: 2 }); const a3 = foe(U2.w, U2.p.x + 100, U2.p.y); a3.maxHp = a3.hp = 1e9; smiteIt(U2.w, U2.p, a3, 1000); near(1e9 - a3.hp, 1400, 1e-6, 'Prism rank 2: Smites +40%');
  const lone = stage({ c_el: 1, c_el_b: 1 }); const solo = foe(lone.w, lone.p.x + 100, lone.p.y); solo.maxHp = solo.hp = 1e9; smiteIt(lone.w, lone.p, solo, 1000); run(lone.w, 0.3); ok(!lone.w.chainQ.length && lone.w.fx.filter(e => e.t === 'chain').length === 0, 'a lone Smite fires no beam');
  const nat = stage({ c_el: 1, c_el_b: 1 }); const x1 = foe(nat.w, nat.p.x + 100, nat.p.y), x2 = foe(nat.w, nat.p.x + 150, nat.p.y); nat.w.addRadiance(x1, nat.w.smiteAt(x1) / nat.w.elemAff('holy'), nat.p); run(nat.w, 0.3); ok(lost(x1) > 0 && lost(x2) > 0, 'a natural Smite (Radiance gauge) also fires the beam');
  const dead = stage({ c_el: 1, c_el_b: 1 }); const k1 = foe(dead.w, dead.p.x + 100, dead.p.y), k2 = foe(dead.w, dead.p.x + 150, dead.p.y); k1.maxHp = k1.hp = 100; smiteIt(dead.w, dead.p, k1, 1000); run(dead.w, 0.3); ok(k1.hp <= 0 && lost(k2) > 0, 'the beam still fires when the Smite kills its foe');
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
  const z = s.Z.find(r => r[1] === ED.Net.ZK.indexOf('sanct')); ok(z && z[17] === 1 + p.slot, 'a following zone carries its owner slot + 1');
  const w2 = stage({ c_s1: 1 }); w2.w.playerSkill(w2.p, 0, { x0: w2.p.x, y0: w2.p.y, x: w2.p.x + 40, y: w2.p.y }, 0); const s2 = ED.Net.encodeSnap(w2.w, [], false); ok(s2.Z.find(r => r[1] === ED.Net.ZK.indexOf('sanct'))[17] === 0, 'a placed Sanctuary carries 0');
  const caps = ED.Net.CAPS; ok(caps.solar > 0 && caps.verdict > 0 && caps.hturn > 0 && caps.chain > 0, 'new events are capped'); const many = []; for (let i = 0; i < 40; i++) many.push({ t: 'solar' }); ok(ED.Net.capFx(many, caps).length === caps.solar, 'capFx trims solar');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
