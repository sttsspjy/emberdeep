// Usage: node tools/check-necro.js
// Headless checks of the Necromancer's 12 route cards against DESIGN-classes section 9 in staged rooms: stat totals per rank, then every behaviour and rider (Hex, Gravecaller, Soul Barrage, Endless Legion, Bone Spikes,
// Bone Knights, Grim Harvest, Corpse Explosion, Bone Armor, Grave Pact, Abyssal Toll, Rise Again). Prints failures and exits 1 when any check fails.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ED } = require('./sim.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
const U = ED.U;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const C = ED.CONST;

// ---- staged world: one Necromancer, no foes, crit off (exact numbers) ----
function stage(boons, seed, wi) {
  const w = new ED.World({ seed: seed || 7, pact: 0, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'necro', weapon: ED.CLASSES.necro.weapons[wi || 0], meta: META() }] });
  w.startRun();
  const p = w.players.get('p0');
  for (const id in (boons || {})) p.boons[id] = boons[id];
  w.recalc(p, true); p.offers.length = 0; p.picks = 0; p.offer = null; p.stats.crit = 0;
  w.enemies.length = 0; w.enc = null; w.locked = false; w.allies.length = 0; w.fx.length = 0;
  return { w, p };
}
const foe = (w, x, y, o) => { const e = w.spawnEnemy('skeleton', x, y, o); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = 5000; return e; };
const run = (w, secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.update(1 / 60); if (f) f(); } };
const evs = (w, t) => w.fx.filter(e => e.t === t);
const lost = (e) => 5000 - e.hp;
const mine = (w, p) => w.allies.filter(a => a.owner === p.pid);
const hexIt = (e, bit) => { e.hexT = 3; e.hexBy = bit === undefined ? 1 : bit; };
const weaponHit = (w, p, e, dmg) => w.hitEnemy(e, dmg || 100, { p, kind: 'weapon', wpn: true, crit: false });
const burstOf = (p, mul) => ED.Stats.skillNums('harvest', p.stats).p.burst.dmg * (mul || 1);
const aff = (w) => w.affC('shadow');
// a minion standing next to foe e, ready to strike
const minionAt = (w, p, e, life) => { w.spawnMinion(p, e.x - 12, e.y, life || 12); const a = w.allies[w.allies.length - 1]; a.cd = 0; return a; };

// ---- stat totals per rank (section 9 table) ----
const tot = (cards) => { const st = {}; for (const id in cards) st[id] = cards[id]; return ED.Stats.compute({ cls: 'necro', weapon: 'bonewand', boons: cards, relics: [], meta: META(), pact: 0 }); };
{
  let s = tot({ n_atk: 1 }); near(s.wDmg, 0.2, 1e-9, 'Soul Command weapon +20%'); near(s.hex, 3, 1e-9, 'Hex 3 s'); near(s.hexMul, 0.2, 1e-9, 'minions +20% vs Hexed');
  s = tot({ n_atk: 1, n_atk_h: 3 }); ok(s.heavy && s.wRaise === 1, 'Gravecaller: Heavy weapon, weapon kills rise'); near(s.hexMul, 0.4, 1e-9, 'Gravecaller rank 3 Hex bonus +10% per rank'); near(s.hexSpread, 50, 1e-9, 'Hex Burst spread 50');
  s = tot({ n_atk: 1, n_atk_h: 1 }); near(s.hexSpread, 0, 1e-9, 'no Hex Burst before rank 3');
  s = tot({ n_atk: 1, n_atk_s: 3 }); ok(s.swift, 'Soul Barrage: Swift weapon'); near(s.hexSelf, 0.2, 1e-9, 'Soul Barrage +10%, +5% per rank'); near(s.hexHaste, 0.25, 1e-9, 'Quickened Dead 25%');
  s = tot({ n_s1: 1 }); near(s.s1Dmg, 0.2, 1e-9, 'Endless Legion: minions and spikes +20%'); near(s.maxMinions, 4, 1e-9, 'Endless Legion: 4 minions'); near(ED.Stats.skillNums('legion', s).p.minion.n, 4, 1e-9, 'Legion raises 4');
  s = tot({ n_s1: 1, n_s1_a: 2 }); ok(s.boneSpikes === 1 && s.spikeRaise === 1, 'Bone Spikes + Boneyard'); near(s.s1Dmg, 1.2 * 1.1 - 1, 1e-9, 'Bone Spikes +10% per rank (compounds with Endless Legion +20%)'); ok(!tot({ n_s1: 1, n_s1_a: 1 }).spikeRaise, 'no Boneyard at rank 1');
  s = tot({ n_s1: 1, n_s1_b: 2 }); near(s.maxMinions, 2, 1e-9, 'Bone Knights: at most 2'); near(ED.Stats.skillNums('legion', s).p.minion.n, 2, 1e-9, 'Legion raises 2'); ok(s.knights === 1, 'knights flag');
  near(s.minionDmg, 0.1, 1e-9, 'Bone Knights +10% per rank'); near(s.knightLife, 0.5, 1e-9, 'Ironbone life +50%'); near(s.knightStun, 0.5, 1e-9, 'Ironbone stun 0.5 s');
  s = tot({ n_s2: 1 }); near(s.s2Dmg, 0.4, 1e-9, 'Grim Harvest +40%'); near(s.s2Area, 0.2, 1e-9, 'Grim Harvest +20% wider'); near(s.harvestRaise, 2, 1e-9, 'Grim Harvest raises 2');
  near(ED.Stats.skillNums('harvest', s).p.burst.dmg, 40.2 * 1.4, 1e-6, 'Harvest burst 40.2 x 1.4'); near(ED.Stats.skillNums('harvest', s).p.burst.r, 72, 1e-9, 'Harvest radius 60 x 1.2');
  s = tot({ n_s2: 1, n_s2_a: 2 }); near(s.corpse, 5, 1e-9, 'Corpse Explosion 4 + 1 per rank'); near(s.corpseMul, 0.7, 1e-9, 'corpse burst 70%'); near(s.boneLance, 0.25, 1e-9, 'Bone Lances +25%');
  const hp = ED.Stats.skillNums('harvest', s).p; near(hp.corpse.dmg, hp.burst.dmg * 0.7, 1e-9, 'corpse part 70% of the burst'); near(hp.lance.dmg, hp.burst.dmg * 1.25, 1e-9, 'lance part +25%'); near(hp.corpse.r, hp.burst.r, 1e-9, 'corpse radius = burst radius'); ok(hp.corpse.on && hp.lance.on, 'corpse and lance parts on');
  s = tot({ n_s2: 1, n_s2_b: 3 }); near(s.boneArmor, 0.03, 1e-9, 'Bone Armor 3% per minion'); near(s.boneCap, 0.06, 1e-9, 'Bone Armor cap 5% + 0.5% per rank'); ok(s.boneField === 1 && !tot({ n_s2: 1, n_s2_b: 1 }).boneField && tot({ n_s2: 1, n_s2_b: 2 }).boneField === 1, 'Marrow Field from rank 2');
  s = tot({ n_el: 1 }); near(s.classElMul, 0.25, 1e-9, 'Grave Pact +25% Shadow skills'); near(s.minionInfuse, 0.25, 1e-9, 'minion infusion 0.75'); near(s.mInfShadow, 0.2, 1e-9, 'minion Doom 20%');
  s = tot({ n_el: 1, n_el_a: 3 }); near(s.tollMul, 0.6, 1e-9, 'Abyssal Toll +40%, +10% per rank'); near(s.abyssMin, 0.25, 1e-9, 'empower +25%'); ok(s.abyssDoom === 1, 'Abyssal Hunger at rank 3');
  s = tot({ n_el: 1, n_el_b: 3 }); ok(s.reapRaise === 1, 'Rise Again'); near(s.minionDmg, 0.2, 1e-9, 'Rise Again +10% minions per rank'); near(s.tideMul, 0.3, 1e-9, 'Risen Tide +30%');
  for (const id of ED.BOON_IDS.filter(i => ED.BOONS[i].cls === 'necro')) for (const r of [1, 2, 3]) ok(!/[{}\[\]]/.test(ED.boonText(id, r, { critK: 1 })), `card text ${id} rank ${r} has no raw tokens`);
}

// ---- Soul Command: weapon hits Hex for 3 s; minions rush the Hexed foe nearest the owner and hit it +20% harder ----
{
  const { w, p } = stage({ n_atk: 1 });
  const e = foe(w, p.x + 45, p.y); p.face = 0; w.playerAttack(p, 0);
  run(w, 0.4); ok(e.hexT > 0 && e.hexT <= 3 && e.hexBy === 1, `a weapon shot Hexes its foe (hexT ${e.hexT.toFixed(2)})`);
  const e2 = foe(w, p.x - 45, p.y); w.hitEnemy(e2, 10, { p, kind: 'dash' }); ok(!(e2.hexT > 0), 'only weapon hits Hex');
  const e3 = foe(w, p.x, p.y + 45); w.hitEnemy(e3, 10, { p, kind: 'weapon', wpn: false }); ok(!(e3.hexT > 0), 'twin and spectral repeats (not weapon hits) do not Hex');
  e.hexT = 0.02; e.hexBy = 1; run(w, 0.1); ok(e.hexT <= 0 && e.hexBy === 0, 'the Hex mask clears when the Hex ends');
  // the Hex duration refreshes to the longer time, a second hero keeps its own bit
  e2.hexT = 1; e2.hexBy = 2; w.recalc(p, false); p.stats.crit = 0; weaponHit(w, p, e2); ok(e2.hexT > 2.9 && e2.hexBy === 3, 'Hex refreshes and keeps the other hero\'s bit');
}
{
  const { w, p } = stage({ n_atk: 1 });
  const near1 = foe(w, p.x + 70, p.y), hexed = foe(w, p.x - 150, p.y); hexIt(hexed); const a = minionAt(w, p, near1); a.x = p.x; a.y = p.y; a.cd = 99;
  const d0 = Math.hypot(a.x - hexed.x, a.y - hexed.y); for (let i = 0; i < 30; i++) w.updateAllies(1 / 60);
  ok(Math.hypot(a.x - hexed.x, a.y - hexed.y) < d0 - 30 && a.x < p.x - 30, 'a minion rushes the Hexed foe, not the nearer one');
  const far = foe(w, p.x + 900, p.y); hexIt(far); hexed.hexT = 0; hexed.hexBy = 0; a.x = p.x; a.y = p.y; for (let i = 0; i < 30; i++) w.updateAllies(1 / 60);
  ok(a.x > p.x, 'a Hexed foe beyond HEX_R of the owner is ignored (nearest foe)');
  hexIt(hexed, 2); hexed.hexT = 3; a.x = p.x; a.y = p.y; for (let i = 0; i < 30; i++) w.updateAllies(1 / 60); ok(a.x > p.x, 'only the owner\'s own Hex commands its minions');
}
{
  const { w, p } = stage({ n_atk: 1 }); const e = foe(w, p.x + 60, p.y), f = foe(w, p.x - 60, p.y);
  const a = minionAt(w, p, e); w.updateAllies(0); const plain = lost(e);
  hexIt(f); const b = minionAt(w, p, f); w.updateAllies(0); near(lost(f) / plain, 1.2, 0.002, 'minions hit Hexed foes +20%'); void a; void b;
  near(plain, ED.Stats.skillNums('legion', p.stats).p.minion.dmg * C.COMP_MUL, 0.01, 'minion strike 11.4 x 0.85');
}

// ---- Gravecaller: a weapon kill rises as a minion for 10 s, once per second, replacing the luck roll; Hex Burst at rank 3 ----
{
  const { w, p } = stage({ n_atk: 1, n_atk_h: 1 }); const kill = () => { const e = foe(w, p.x + 50, p.y); e.hp = 1; weaponHit(w, p, e); };
  kill(); ok(mine(w, p).length === 1 && Math.abs(mine(w, p)[0].life - 10) < 1e-9 && p.raiseT === C.GRAVE_CD, 'a weapon kill rises as a 10 s minion');
  kill(); ok(mine(w, p).length === 1, 'at most one Gravecaller raise per second'); p.raiseT = 0; kill(); ok(mine(w, p).length === 2, 'another after the second');
  const e = foe(w, p.x + 50, p.y); e.hp = 1; p.raiseT = 0; w.hitEnemy(e, 100, { p, kind: 'explode', crit: false }); ok(mine(w, p).length === 2, 'a kill that is not a weapon hit does not trigger Gravecaller (luck roll only)');
  ok(evs(w, 'raise').some(r => r.k === 'gc'), 'raise event carries the Gravecaller kind');
}
{
  const { w, p } = stage({ n_atk: 1, n_atk_h: 3 }); const e = foe(w, p.x + 50, p.y), nb = foe(w, p.x + 50, p.y + 40), far = foe(w, p.x + 50, p.y + 110);
  weaponHit(w, p, e); ok(nb.hexT > 0 && nb.hexBy === 1 && !(far.hexT > 0), 'Hex Burst: foes within 50 of the hit are Hexed too, farther ones are not');
  const { w: w1, p: p1 } = stage({ n_atk: 1, n_atk_h: 2 }); const e1 = foe(w1, p1.x + 50, p1.y), nb1 = foe(w1, p1.x + 50, p1.y + 40); weaponHit(w1, p1, e1); ok(!(nb1.hexT > 0), 'no Hex Burst below rank 3');
}

// ---- Soul Barrage: Hexed foes take +10% from you; Quickened Dead: minions 25% faster against them ----
{
  const { w, p } = stage({ n_atk: 1, n_atk_s: 1 }); const a = foe(w, p.x + 50, p.y), b = foe(w, p.x - 50, p.y); hexIt(a);
  p.stats.hex = 0; weaponHit(w, p, a, 100); weaponHit(w, p, b, 100); near(lost(a) / lost(b), 1.1, 0.002, 'Hexed foes take +10% from the Necromancer');
  const { w: w3, p: p3 } = stage({ n_atk: 1, n_atk_s: 3 }); const c = foe(w3, p3.x + 50, p3.y), d = foe(w3, p3.x - 50, p3.y); hexIt(c); p3.stats.hex = 0; weaponHit(w3, p3, c, 100); weaponHit(w3, p3, d, 100); near(lost(c) / lost(d), 1.2, 0.002, 'Soul Barrage rank 3: +20%');
  const m = minionAt(w3, p3, c); w3.updateAllies(0); near(m.cd, 0.7 * 0.75, 1e-9, 'Quickened Dead: 25% faster against a Hexed foe');
  const m2 = minionAt(w3, p3, d); w3.updateAllies(0); near(m2.cd, 0.7, 1e-9, 'normal speed against others');
  const { w: w2, p: p2 } = stage({ n_atk: 1, n_atk_s: 2 }); const f = foe(w2, p2.x + 50, p2.y); hexIt(f); const m3 = minionAt(w2, p2, f); w2.updateAllies(0); near(m3.cd, 0.7, 1e-9, 'no haste before rank 3');
}

// ---- Endless Legion: Raise Legion raises 4, the cap is 4 and the oldest falls ----
{
  const { w, p } = stage({ n_s1: 1 }); const cast = () => w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 60, y: p.y }, 0);
  cast(); ok(mine(w, p).length === 4, 'Legion raises 4'); const first = mine(w, p).map(a => a.id); cast(); w.updateAllies(0);
  ok(mine(w, p).length === 4 && mine(w, p).every(a => first.indexOf(a.id) < 0), 'a second cast replaces the oldest four, never more than the cap');
  for (let i = 0; i < 6; i++) w.spawnMinion(p, p.x, p.y, 12); w.updateAllies(0); ok(mine(w, p).length <= 4, 'six single raises stay within the cap');
}

// ---- Bone Spikes: minions burst on expiry, replacement and fall; Boneyard raises ----
{
  const { w, p } = stage({ n_s1: 1, n_s1_a: 1 }); const e = foe(w, p.x + 80, p.y), N = ED.Stats.skillNums('legion', p.stats);
  near(N.p.spikes.dmg, 23.5 * 1.2, 0.001, 'Spikes 23.5 x 1.2 (Endless Legion)'); const a = minionAt(w, p, e, 0.001); a.cd = 99; w.updateAllies(1 / 60);
  near(lost(e), 23.5 * 1.2 * aff(w), 0.01, 'a minion bursts on expiry for 23.5 Shadow x 1.2 (class affinity)'); ok(mine(w, p).length === 0, 'the burst minion is gone');
  const ba = evs(w, 'boom').filter(b => b.k === 'bone' && b.s === 1); ok(ba.length === 1 && ba[0].r === 60, 'boom event carries the Spikes flag and radius 60');
  near(e.doom, 23.5 * 1.2 * 0.5 * w.elemAff('shadow'), 0.01, 'the burst marks Doom for half of its damage');
  const { w: w2, p: p2 } = stage({ n_s1: 1, n_s1_a: 1 }); const e2 = foe(w2, p2.x + 80, p2.y);
  for (let i = 0; i < 4; i++) { const m = minionAt(w2, p2, e2); m.cd = 99; m.x = p2.x + 200; m.y = p2.y; m.life = 12 - i; }
  const oldest = mine(w2, p2).sort((u, v) => u.life - v.life)[0]; oldest.x = e2.x - 10; oldest.y = e2.y; w2.spawnMinion(p2, p2.x, p2.y, 12); w2.updateAllies(1 / 60);
  near(lost(e2), 23.5 * 1.2 * aff(w2), 0.01, 'the replaced (oldest) minion bursts'); ok(mine(w2, p2).length === 4, 'cap 4 holds');
  const { w: w4, p: p4 } = stage({ n_s1: 1, n_s1_a: 2 }); near(ED.Stats.skillNums('legion', p4.stats).p.spikes.dmg, 23.5 * 1.32, 0.01, 'Spikes rank 2: +10% per rank');
  const k1 = foe(w4, p4.x + 80, p4.y), k2 = foe(w4, p4.x + 100, p4.y); k1.hp = k2.hp = 5; const m = minionAt(w4, p4, k1, 0.001); m.cd = 99; w4.updateAllies(1 / 60);
  ok(k1.hp <= 0 && k2.hp <= 0 && mine(w4, p4).length === 1, 'Boneyard: a foe the burst kills rises, at most once per 2 s (two died, one rose)');
  ok(evs(w4, 'raise').some(r => r.k === 'yard'), 'Boneyard raise event');
  w4.time += 2.5; const k3 = foe(w4, p4.x + 80, p4.y); k3.hp = 5; const m2 = minionAt(w4, p4, k3, 0.001); m2.cd = 99; w4.updateAllies(1 / 60); ok(mine(w4, p4).length >= 2, 'Boneyard rises again after 2 s');
}

// ---- Bone Knights ----
{
  const { w, p } = stage({ n_s1: 1, n_s1_b: 1 }); w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 60, y: p.y }, 0);
  const ks = mine(w, p); ok(ks.length === 2 && ks.every(a => a.knight && a.r === C.KNIGHT_R), 'Legion raises 2 Bone Knights (r 13)');
  const e = foe(w, p.x + 300, p.y), side = foe(w, e.x + 25, e.y + 10), far = foe(w, e.x + 60, e.y); w.allies.length = 0;
  const a = minionAt(w, p, e); w.updateAllies(0);
  near(lost(e), 11.4 * 1.2 * C.COMP_MUL * C.KNIGHT_MUL, 0.01, 'a Bone Knight hits x1.5 (and Endless Legion +20%)'); near(a.cd, 0.5, 1e-9, 'attacks every 0.5 s'); near(lost(side), lost(e), 0.01, 'cleaves a foe within 30 of its target'); ok(far.hp === 5000, 'but not one farther away');
  const shot = (kn) => { w.projs.length = 0; w.fx.length = 0; w.spawnProj({ team: 1, kind: 'bone', x: kn.x + 6, y: kn.y, a: Math.PI, speed: 10, r: 4, dmg: 5, life: 3, owner: null, src: e }); const L = kn.life; w.updateAllies(0); return L - kn.life; };
  const kn = mine(w, p)[0]; near(shot(kn), 1, 1e-9, 'a Bone Knight blocks an enemy shot and loses 1 s'); ok(w.projs.every(q => q.life <= 0) && evs(w, 'kblock').length === 1, 'the shot is removed and a kblock event is emitted');
  const { w: wp, p: pp } = stage({ n_s1: 1 }); wp.spawnMinion(pp, pp.x, pp.y, 12); const pl = mine(wp, pp)[0]; pl.cd = 99;
  wp.spawnProj({ team: 1, kind: 'bone', x: pl.x + 6, y: pl.y, a: Math.PI, speed: 10, r: 4, dmg: 5, life: 3, owner: null, src: e }); const L0 = pl.life; wp.updateAllies(0); ok(pl.life === L0 && wp.projs.some(q => q.life > 0), 'a plain minion does not block');
}
{
  const { w, p } = stage({ n_s1: 1, n_s1_b: 2 }); w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 60, y: p.y }, 0);
  const ks = mine(w, p); near(ks[0].life, 18, 1e-9, 'Ironbone: 12 s x 1.5'); near(p.stats.minionDmg, 0.1, 1e-9, 'rank 2 minion damage +10%');
  const e = foe(w, p.x + 200, p.y); w.allies.length = 0; const a = minionAt(w, p, e); w.updateAllies(0);
  near(lost(e), 11.4 * 1.2 * 1.1 * C.COMP_MUL * C.KNIGHT_MUL, 0.01, 'rank 2 knight hit'); ok(e.stun >= 0.49 && e.stun <= 0.51, `a Bone Knight's strike stuns its foe 0.5 s (${e.stun})`);
  ok(evs(w, 'kstun').length === 1, 'the stun emits a kstun event'); e.stun = 0; a.cd = 0; w.updateAllies(0); ok(e.stun === 0 && evs(w, 'kstun').length === 1, 'a foe on stun cooldown is not stunned again'); e.stunCd = 0; a.cd = 0; w.updateAllies(0); ok(e.stun > 0.49 && evs(w, 'kstun').length === 2, 'and is stunned again once the cooldown is over');
  const boss = foe(w, p.x + 200, p.y + 100); boss.boss = true; const b2 = minionAt(w, p, boss); w.updateAllies(0); ok(boss.stun === 0, 'bosses are never stunned');
  const { w: w1, p: p1 } = stage({ n_s1: 1, n_s1_b: 1 }); w1.spawnMinion(p1, p1.x, p1.y, 12); near(mine(w1, p1)[0].life, 12, 1e-9, 'no Ironbone life at rank 1'); void b2;
}

// ---- Grim Harvest: +40% and 20% wider, always raises 2, heal at most 6% ----
{
  const { w, p } = stage({ n_s2: 1 }); const e = foe(w, p.x + 100, p.y); for (let i = 0; i < 3; i++) { const m = minionAt(w, p, e); m.x = p.x + 100 + i; m.y = p.y; }
  const edge = foe(w, p.x + 100 + 71, p.y); const out = foe(w, p.x + 100, p.y + 90); p.hp = 1; w.playerSkill(p, 0, {}, 1);
  near(lost(e), 3 * burstOf(p) * aff(w), 0.05, 'each of 3 minions bursts for 56.28'); ok(lost(edge) > 0 && out.hp === 5000, 'radius 72: a foe at 71 is hit, one at 90 is not');
  ok(mine(w, p).length === 2, 'Harvest raises 2 after'); near(p.hp, 1 + 0.06 * p.maxHp, 0.01, 'heal 3% per minion, at most 6% per cast');
  p.hp = 1; w.healPlayer(p, 0); w.playerSkill(p, 0, {}, 1); near(p.hp, 1 + 0.06 * p.maxHp, 0.01, 'two minions heal 6%');
  w.allies.length = 0; p.hp = 1; const hp0 = p.hp; w.playerSkill(p, 0, {}, 1); ok(p.hp === hp0 && mine(w, p).length === 2, 'no minions: no heal, raises 2');
  const { w: w1, p: p1 } = stage({}); w1.playerSkill(p1, 0, {}, 1); ok(mine(w1, p1).length === 2, 'base Harvest with none raises 2'); const m = minionAt(w1, p1, foe(w1, p1.x + 50, p1.y)); w1.allies = [m]; w1.playerSkill(p1, 0, {}, 1); ok(mine(w1, p1).length === 1, 'base Harvest with minions raises 1');
}

// ---- Corpse Explosion ----
{
  const { w, p } = stage({ n_s2: 1, n_s2_a: 1 }); const ang = [0, 1.5708, 3.1416, 4.7124, 0.7854], pos = ang.map(a => [p.x + Math.cos(a) * 150, p.y + Math.sin(a) * 150]);
  const killAt = (x, y) => { const e = foe(w, x, y); weaponHit(w, p, e, 1e6); };
  for (let i = 0; i < 5; i++) { w.time += 0.2; killAt(pos[i][0], pos[i][1]); } ok(w.corpses.length === 5, 'kills leave corpses while the hero owns Corpse Explosion');
  const live = pos.map(q => foe(w, q[0], q[1])); w.fx.length = 0; w.playerSkill(p, 0, {}, 1);
  const bursts = evs(w, 'boom').filter(b => b.c === 1); ok(bursts.length === 4, `Harvest detonates 4 corpses at rank 1 (got ${bursts.length})`);
  const hit = live.filter(e => lost(e) > 0); ok(hit.length >= 4, 'the corpse bursts hit the foes standing there');
  near(Math.max(...live.map(lost)) / aff(w), burstOf(p, 0.7), 0.05, 'a corpse bursts at 70% of a minion burst'); ok(w.corpses.length === 1 && w.corpses[0].t < w.corpses[1 - 1].t + 1, 'corpses are used once (the oldest stays)');
  const { w: w2, p: p2 } = stage({ n_s2: 1, n_s2_a: 1 }); const e2 = foe(w2, p2.x + 100, p2.y); weaponHit(w2, p2, e2, 1e6); w2.time += 5; w2.playerSkill(p2, 0, {}, 1); ok(evs(w2, 'boom').filter(b => b.c === 1).length === 0, 'a corpse older than 4 s is not used');
  const { w: w3, p: p3 } = stage({ n_s2: 1, n_s2_a: 1 }); const e3 = foe(w3, p3.x + 300, p3.y); weaponHit(w3, p3, e3, 1e6); w3.playerSkill(p3, 0, {}, 1); ok(evs(w3, 'boom').filter(b => b.c === 1).length === 0, 'a corpse beyond 220 is not used');
  const { w: w4, p: p4 } = stage({ n_s2: 1, n_s2_a: 2 }); for (let i = 0; i < 7; i++) weaponHit(w4, p4, foe(w4, p4.x + 50 + i * 5, p4.y), 1e6); w4.fx.length = 0; w4.playerSkill(p4, 0, {}, 1); ok(evs(w4, 'boom').filter(b => b.c === 1).length === 5, 'rank 2 detonates 5');
  const { w: w5, p: p5 } = stage({ n_s2: 1 }); weaponHit(w5, p5, foe(w5, p5.x + 50, p5.y), 1e6); ok(w5.corpses.length === 0, 'no corpse list without the card');
  const { w: w6, p: p6 } = stage({ n_s2: 1, n_s2_a: 1 }); for (let i = 0; i < 20; i++) weaponHit(w6, p6, foe(w6, p6.x + 50, p6.y), 1e6); ok(w6.corpses.length === C.CORPSE_N, 'the corpse ring holds CORPSE_N');
  const bos = foe(w6, p6.x + 50, p6.y); bos.boss = true; const c0 = w6.corpses.length; weaponHit(w6, p6, bos, 1e6); ok(w6.corpses.length === c0, 'bosses leave no corpse');
}
{ // Bone Lances: each minion bursts on the foe nearest it within 200, for +25%
  const { w, p } = stage({ n_s2: 1, n_s2_a: 2 }); const e = foe(w, p.x + 160, p.y), far = foe(w, p.x - 250, p.y); const m = minionAt(w, p, e); m.x = p.x; m.y = p.y; w.fx.length = 0;
  w.playerSkill(p, 0, {}, 1); near(lost(e), burstOf(p, 1.25) * aff(w), 0.05, 'a lance bursts on the foe for +25%'); ok(far.hp === 5000, 'a foe beyond 200 of the minion is not chosen');
  const l = evs(w, 'blance'); ok(l.length === 1 && l[0].x1 === Math.round(e.x) && l[0].pid === 'p0', 'blance event from the minion to the foe');
  const { w: w2, p: p2 } = stage({ n_s2: 1, n_s2_a: 2 }); const f = foe(w2, p2.x + 400, p2.y); const m2 = minionAt(w2, p2, f); m2.x = p2.x; m2.y = p2.y; w2.fx.length = 0; w2.playerSkill(p2, 0, {}, 1); ok(f.hp === 5000 && evs(w2, 'blance').length === 0, 'no foe within 200: the minion bursts where it stands');
}

// ---- Bone Armor ----
{
  const { w, p } = stage({ n_s2: 1, n_s2_b: 1 }); const M = p.maxHp;
  for (let i = 0; i < 2; i++) w.spawnMinion(p, p.x, p.y, 12); p.hp = 1; w.playerSkill(p, 0, {}, 1);
  near(p.shield, 0.05 * M, 0.01, 'Bone Armor 3% x 2 = 6%, capped at 5% of max health (the card text)'); near(p.boneT, 12, 1e-9, 'Bone Armor once per 12 s'); ok(p.shieldBy.bone > 0 && !p.shieldBy.class && !(p.shieldClip.bone > 0), 'a bone shield outside the class window, nothing clipped');
  ok(evs(w, 'shielded').some(s => s.k === 'bone' && s.pid === 'p0'), 'shielded event with source bone');
  near(w.addShield(p, M, M, 'class'), 0.01 * M, 0.01, 'the class window is still empty: a class grant takes the rest of the 6% all-source window');
  const { w: w3, p: p3 } = stage({ n_s2: 1, n_s2_b: 1 }); for (let i = 0; i < 3; i++) w3.spawnMinion(p3, p3.x, p3.y, 12); w3.playerSkill(p3, 0, {}, 1); near(p3.shield, 0.05 * M, 0.01, 'rank 1: 3 minions give the 5% cap, not 6%');
  const { w: w4, p: p4 } = stage({ n_s2: 1, n_s2_b: 3 }); for (let i = 0; i < 3; i++) w4.spawnMinion(p4, p4.x, p4.y, 12); w4.playerSkill(p4, 0, {}, 1); near(p4.shield, 0.06 * M, 0.01, 'rank 3: 3 minions give 6% (cap 5% + 2 x 0.5%)');
  const s0 = p.shield; for (let i = 0; i < 2; i++) w.spawnMinion(p, p.x, p.y, 12); w.playerSkill(p, 0, {}, 1); near(p.shield, s0, 1e-9, 'no second shield while boneT runs');
  p.boneT = 0; w.time += 11; p.shield = 0; w.playerSkill(p, 0, {}, 1); ok(p.shield > 0, 'a new shield after the cooldown and the window');
  const { w: w1, p: p1 } = stage({ n_s2: 1, n_s2_b: 1 }); w1.playerSkill(p1, 0, {}, 1); ok(p1.shield === 0 && p1.boneT === 0, 'no minion harvested: no shield, no cooldown spent');
  const { w: w2, p: p2 } = stage({ n_s2: 1 }); w2.spawnMinion(p2, p2.x, p2.y, 12); w2.playerSkill(p2, 0, {}, 1); ok(p2.shield === 0, 'no shield without the card');
}
{ // Marrow Field: one shard zone per harvested minion (r 40, 2 s) that slows foes 40%
  const { w, p } = stage({ n_s2: 1, n_s2_b: 2 }); const e = foe(w, p.x + 120, p.y); const out = foe(w, p.x + 120, p.y + 100);
  for (let i = 0; i < 3; i++) { w.spawnMinion(p, p.x + 120, p.y, 12); } w.playerSkill(p, 0, {}, 1);
  const zs = w.zones.filter(z => z.kind === 'shards'); ok(zs.length === 3 && zs.every(z => z.r === 40 && z.dur === 2 && z.owner === 'p0'), 'three harvested minions leave three shard zones');
  w.updateZones(1 / 60); ok(e.slowT > 0 && Math.abs(e.slowAmt - 0.4) < 1e-9 && !(out.slowT > 0), 'foes inside are slowed 40%, others are not');
  for (let i = 0; i < 125; i++) w.updateZones(1 / 60); ok(!w.zones.some(z => z.kind === 'shards'), 'the shards last 2 s');
  const { w: w1, p: p1 } = stage({ n_s2: 1, n_s2_b: 1 }); w1.spawnMinion(p1, p1.x, p1.y, 12); w1.playerSkill(p1, 0, {}, 1); ok(!w1.zones.some(z => z.kind === 'shards'), 'no Marrow Field at rank 1');
}

// ---- Grave Pact ----
{
  const { w, p } = stage({ n_el: 1 }); near(p.stats.minionInfuse, 0.25, 1e-9, 'k = 0.75');
  const e = foe(w, p.x + 100, p.y); w.spawnMinion(p, e.x, e.y, 12); w.playerSkill(p, 0, {}, 1);
  near(lost(e), burstOf(p) * 1.25 * aff(w), 0.05, 'Grave Pact: Harvest bursts +25% Shadow'); void e;
  const f = foe(w, p.x + 100, p.y + 300), a = minionAt(w, p, f); w.updateAllies(0); const dmg = lost(f);
  near(dmg, 11.4 * C.COMP_MUL, 0.01, 'minion hits stay physical (no class bonus)'); near(f.doom, dmg * 0.2 * w.elemAff('shadow'), 0.01, 'minions mark Doom for 20% of their damage'); void a;
  const { w: w2, p: p2 } = stage({ n_el: 1, doommark: 1 }); near(p2.stats.shadowInfuse, 0.3, 1e-9, 'Mark of Doom 0.3'); const g = foe(w2, p2.x + 100, p2.y); const b2 = minionAt(w2, p2, g); w2.updateAllies(0); near(g.doom, lost(g) * 0.225 * w2.elemAff('shadow'), 0.01, 'Mark of Doom x k (22.5%) counts instead when higher');
  const { w: w3, p: p3 } = stage({}); const h = foe(w3, p3.x + 100, p3.y); minionAt(w3, p3, h); w3.updateAllies(0); near(h.doom, 0, 1e-9, 'no Doom without a gate or Grave Pact');
  void b2;
}

// ---- Abyssal Toll ----
{
  const { w, p } = stage({ n_el: 1, n_el_a: 1 }); const bos = foe(w, p.x + 100, p.y); bos.boss = true; bos.maxHp = bos.hp = 5000; bos.doomOwner = p; w.fx.length = 0;
  w.addDoom(bos, 800, p); ok(p.abyssT === C.ABYSS_T && evs(w, 'abyss').length === 1 && evs(w, 'toll').length === 1, 'a boss Toll empowers the minions for 6 s');
  const f = foe(w, p.x + 100, p.y + 300); const m = minionAt(w, p, f); w.updateAllies(0); near(lost(f), 11.4 * C.COMP_MUL * 1.25, 0.01, 'empowered minions hit +25%');
  p.abyssT = 0; f.hp = 5000; m.cd = 0; w.updateAllies(0); near(lost(f), 11.4 * C.COMP_MUL, 0.01, 'back to normal after the empower');
  const common = foe(w, p.x + 100, p.y + 150); common.hp = 200; w.addDoom(common, 900, p); ok(common.hp <= 0 && p.abyssT === 0, 'a Reaped common foe does not empower');
  const elite = foe(w, p.x + 100, p.y - 150); elite.elite = 'swift'; elite.hp = 200; w.addDoom(elite, 1500, p); ok(elite.hp <= 0 && p.abyssT === C.ABYSS_T, 'a Reaped elite empowers the minions');
  const { w: w1, p: p1 } = stage({}); const b1 = foe(w1, p1.x + 100, p1.y); b1.boss = true; w1.addDoom(b1, 800, p1); ok(p1.abyssT === 0, 'no empower without the card');
}

// ---- Rise Again ----
{
  const { w, p } = stage({ n_el: 1, n_el_b: 1 }); const reap = (hp) => { const e = foe(w, p.x + 100, p.y); e.hp = hp || 100; w.addDoom(e, 900, p); return e; };
  const e = reap(); ok(e.hp <= 0 && mine(w, p).length === 1 && Math.abs(mine(w, p)[0].life - 10) < 1e-9 && p.raiseT === C.RISE_CD, 'a Reaped foe rises as a minion for 10 s'); reap(); ok(mine(w, p).length === 1, 'at most once per 1.5 s'); p.raiseT = 0; reap(); ok(mine(w, p).length === 2, 'again after the cooldown');
  ok(evs(w, 'raise').some(r => r.k === 'again'), 'raise event kind again'); ok(!mine(w, p)[0].tide, 'no Risen Tide before rank 3');
  const bos = foe(w, p.x + 200, p.y); bos.boss = true; bos.maxHp = bos.hp = 5000; bos.doomOwner = p; const n0 = mine(w, p).length; w.addDoom(bos, 800, p); ok(mine(w, p).length === n0 + 1 || n0 >= p.stats.maxMinions, 'a boss Toll raises one');
  const nonreap = foe(w, p.x + 100, p.y + 100); nonreap.hp = 1; p.raiseT = 0; const n1 = mine(w, p).length; weaponHit(w, p, nonreap, 100); ok(mine(w, p).length <= n1 + 1, 'a weapon kill does not trigger the guaranteed raise (luck roll only)');
}
{
  const { w, p } = stage({ n_el: 1, n_el_b: 3 }); const e = foe(w, p.x + 100, p.y); e.hp = 100; w.addDoom(e, 900, p); const a = mine(w, p)[0];
  ok(a && a.tide && Math.abs(a.life - 14) < 1e-9, 'Risen Tide: a Reaped minion lasts 14 s'); ok(evs(w, 'raise').some(r => r.k === 'tide'), 'Risen Tide raise event kind tide'); const f = foe(w, p.x + 100, p.y + 300); a.x = f.x - 12; a.y = f.y; a.cd = 0; w.updateAllies(0);
  near(lost(f), ED.Stats.skillNums('legion', p.stats).p.minion.dmg * 1.2 * C.COMP_MUL * 1.3, 0.01, 'Risen Tide minions hit +30% (and rank 3 minions +20%)');
  w.spawnMinion(p, p.x, p.y, 10); const plain = mine(w, p).find(m => !m.tide); ok(plain && Math.abs(plain.life - 10) < 1e-9, 'other minions are unchanged');
  const bos = foe(w, p.x + 200, p.y); bos.boss = true; bos.maxHp = bos.hp = 5000; bos.doomOwner = p; w.allies.length = 0; w.addDoom(bos, 800, p); const t = mine(w, p)[0]; ok(t && t.tide && Math.abs(t.life - 14) < 1e-9, 'a Toll raise is a Risen Tide minion too');
}

// ---- skill forms (rank 2: the rider, rank 3: the transform) ----
const spy = (w) => { const log = [], o = w.hitEnemy; w.hitEnemy = function (e, b, s) { const d = o.call(this, e, b, s); if (s && s.part) log.push({ part: s.part, e, d, t: this.time, crit: s.critOut }); return d; }; return log; };
const partHits = (log, part) => log.filter(h => h.part === part);
const tap = (w) => { const all = []; return { all, step() { for (const ev of w.fx) all.push(ev); w.fx.length = 0; } }; };
const cast0 = (w, p) => w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 60, y: p.y }, 0);
{ // card names, riders and transforms of the four Necromancer skill forks
  const FORKS = { n_s1_a: ['Bone Spikes', 'Boneyard', 'Ossuary Bloom'], n_s1_b: ['Bone Knights', 'Ironbone', 'Death Knight'], n_s2_a: ['Corpse Explosion', 'Bone Lances', 'Carrion Storm'], n_s2_b: ['Bone Armor', 'Marrow Field', 'Lich Form'] };
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
{ // Ossuary Bloom (n_s1_a rank 3): every burst (expiry, replacement, Harvest) leaves a bone field (r50, 2 s, 50% of the burst per second); Raise Legion raises 2 bone bombs (5 s) that run at the nearest foe and explode (r60, 120% of a burst)
  const S = stage({ n_s1: 1, n_s1_a: 3 }), N = ED.Stats.skillNums('legion', S.p.stats), sp = N.p.spikes;
  near(N.p.field.dmg, sp.dmg * 0.5, 1e-9, 'the field deals 50% of the burst per second'); near(N.p.field.r, 50, 1e-9, 'field radius 50'); near(N.p.field.dur, 2, 1e-9, 'field lasts 2 s'); near(N.p.bomb.dmg, sp.dmg * 1.2, 1e-9, 'a bomb is 120% of a burst'); near(N.p.bomb.r, sp.r, 1e-9, 'bomb radius 60 (the burst radius)');
  ok(N.p.field.on && N.p.bomb.on && !ED.Stats.skillNums('legion', stage({ n_s1: 1, n_s1_a: 2 }).p.stats).p.field.on, 'the field and bomb parts are rank 3');
  cast0(S.w, S.p); const bombs = S.w.allies.filter(a => a.bomb), mins = S.w.allies.filter(a => !a.bomb);
  ok(mins.length === 4 && bombs.length === 2 && bombs.every(b => b.k === 2 && b.life === 5 && !b.knight && b.owner === 'p0') && mins.every(m => m.k === 0), `Legion raises 4 minions and 2 bombs (${mins.length}, ${bombs.length})`);
  ok(S.w.fx.filter(v => v.t === 'raise' && v.k === 'bomb').length === 2, 'two raise events of kind bomb'); cast0(S.w, S.p); S.w.updateAllies(0);
  ok(S.w.allies.filter(a => !a.bomb && a.life > 0).length === 4 && S.w.allies.filter(a => a.bomb).length === 4, 'bombs are outside the cap: a second cast replaces the minions, the bombs add up');
  const snap = ED.Net.encodeSnap(S.w, [], false); ok(snap.A.some(r => r[5] === 2) && snap.A.every(r => r.length === 6), 'allies carry k on the wire (2 = bomb)');
  // bombs run at a foe and explode on it
  const T = stage({ n_s1: 1, n_s1_a: 3 }); const e = foe(T.w, T.p.x + 180, T.p.y), other = foe(T.w, T.p.x + 180, T.p.y + 140), log = spy(T.w), ev = tap(T.w); cast0(T.w, T.p); T.w.allies = T.w.allies.filter(a => a.bomb); const xs = T.w.allies.map(b => b.x);
  run(T.w, 0.25, ev.step); ok(T.w.allies.every((b, i) => b.x > xs[i] + 20) && !partHits(log, 'legion.bomb').length, 'the bombs run at the foe (190 px/s) and have not burst yet'); run(T.w, 1.75, ev.step);
  const bh = partHits(log, 'legion.bomb'), m = T.p.stats.dmg * T.w.affC('shadow');
  ok(bh.length === 2 && bh.every(h => h.e === e && Math.abs(h.d - N.p.bomb.dmg * m) < 0.05), `both bombs burst on the foe for 120% of a burst (${bh.length} hits, ${bh[0] ? bh[0].d.toFixed(1) : '-'} vs ${(N.p.bomb.dmg * m).toFixed(1)})`); ok(other.hp === 5000 && !T.w.allies.some(a => a.bomb), 'a foe 140 away is unharmed and the bombs are gone');
  ok(ev.all.filter(v => v.t === 'boom' && v.b === 1 && v.r === 60).length === 2, 'two boom events flagged b (bomb)');
  const fields = T.w.zones.filter(z => z.kind === 'shards' && z.w === 11); ok(fields.length === 2 && fields.every(z => z.r === 50 && z.dur === 2 && Math.abs(z.dps - N.p.field.dmg) < 1e-9 && z.owner === 'p0'), 'each bomb leaves a field (shards zone, w 11)');
  run(T.w, 2.2, ev.step); const fh = partHits(log, 'legion.field'); ok(fh.length === 8 && fh.every(h => Math.abs(h.d - N.p.field.dmg * 0.5 * m) < 0.05), `two fields tick 4 times each at half the field damage per second (${fh.length} ticks)`); ok(!T.w.zones.some(z => z.w === 11), 'the fields end after 2 s');
  // bombs expire in place
  const I = stage({ n_s1: 1, n_s1_a: 3 }); cast0(I.w, I.p); I.w.allies = I.w.allies.filter(a => a.bomb); const ie = tap(I.w); run(I.w, 4.9, ie.step); ok(I.w.allies.length === 2, 'with no foe the bombs wait for their 5 s'); run(I.w, 0.3, ie.step); ok(I.w.allies.length === 0 && ie.all.filter(v => v.t === 'boom' && v.b === 1).length === 2 && I.w.zones.filter(z => z.w === 11).length === 2, 'and burst when the time is up, leaving their fields');
  // fodder and bosses are targets too
  const F = stage({ n_s1: 1, n_s1_a: 3 }); const ff = foe(F.w, F.p.x + 150, F.p.y); ff.fodder = true; const fl = spy(F.w); cast0(F.w, F.p); F.w.allies = F.w.allies.filter(a => a.bomb); run(F.w, 2, null); ok(partHits(fl, 'legion.bomb').length === 2, 'bombs run at fodder too');
  // minions: expiry bursts and leaves a field; replacement; Harvest consumption (Ossuary Bloom only)
  const M = stage({ n_s1: 1, n_s1_a: 3 }); const me = foe(M.w, M.p.x + 80, M.p.y), ml = spy(M.w); const a = minionAt(M.w, M.p, me, 0.001); a.cd = 99; M.w.updateAllies(1 / 60);
  ok(partHits(ml, 'legion.spikes').length === 1 && M.w.zones.filter(z => z.w === 11).length === 1, 'a minion that expires bursts and leaves a field'); run(M.w, 2.2); ok(partHits(ml, 'legion.field').length === 4, 'the field ticks 4 times');
  { const H = stage({ n_s1: 1, n_s1_a: 3 }); const he = foe(H.w, H.p.x + 100, H.p.y), hl = spy(H.w); for (let i = 0; i < 3; i++) { const q = minionAt(H.w, H.p, he); q.cd = 99; } H.w.playerSkill(H.p, 0, {}, 1);
    ok(partHits(hl, 'harvest.burst').length === 3 && partHits(hl, 'legion.spikes').length === 3 && H.w.zones.filter(z => z.w === 11).length === 3, 'Harvest consumes each minion with its burst, a Bone Spikes burst and a field (the minions are "killed")'); }
  { const H = stage({ n_s1: 1, n_s1_a: 2 }); const he = foe(H.w, H.p.x + 100, H.p.y), hl = spy(H.w); for (let i = 0; i < 3; i++) { const q = minionAt(H.w, H.p, he); q.cd = 99; } H.w.playerSkill(H.p, 0, {}, 1);
    ok(partHits(hl, 'harvest.burst').length === 3 && !partHits(hl, 'legion.spikes').length && !H.w.zones.some(z => z.w === 11), 'rank 2: Harvest bursts only'); }
  { const H = stage({ n_s1: 1, n_s1_a: 2 }); cast0(H.w, H.p); ok(H.w.allies.every(a => a.k === 0) && H.w.allies.length === 4, 'rank 2 raises no bombs'); }
  { // Boneyard keeps working at rank 2 and 3, and never raises fodder
    for (const rank of [2, 3]) {
      const B = stage({ n_s1: 1, n_s1_a: rank }); const k1 = foe(B.w, B.p.x + 80, B.p.y), k2 = foe(B.w, B.p.x + 100, B.p.y); k1.hp = k2.hp = 5; k1.fodder = true; const m1 = minionAt(B.w, B.p, k1, 0.001); m1.cd = 99; B.w.updateAllies(1 / 60);
      ok(k1.hp <= 0 && k2.hp <= 0 && mine(B.w, B.p).filter(q => q.life > 0).length === 1, `rank ${rank}: Boneyard raises one of two kills (the fodder never rises)`);
      const B2 = stage({ n_s1: 1, n_s1_a: rank }); const f1 = foe(B2.w, B2.p.x + 80, B2.p.y); f1.hp = 5; f1.fodder = true; const m2 = minionAt(B2.w, B2.p, f1, 0.001); m2.cd = 99; B2.w.updateAllies(1 / 60); ok(f1.hp <= 0 && mine(B2.w, B2.p).length === 0, `rank ${rank}: a fodder kill raises nothing`);
    }
  }
}
{ // Death Knight (n_s1_b rank 3): one Death Knight in place of the Bone Knights (x4.5, cleave arc 2.4, taunts foes within 120, blocks shots), counts as 2 minions, stands until it falls or the next Raise Legion
  const S = stage({ n_s1: 1, n_s1_b: 3 }), st = S.p.stats, N = ED.Stats.skillNums('legion', st);
  ok(st.dk === 1 && st.knights === 1 && st.maxMinions === 2 && Math.abs(st.dkMul - 4.5) < 1e-9 && Math.abs(st.dkArc - 2.4) < 1e-9 && st.dkTaunt === 120 && Math.abs(st.knightLife - 0.5) < 1e-9, 'Death Knight stats: x4.5, arc 2.4, taunt 120, cap 2, Ironbone');
  cast0(S.w, S.p); let dk = mine(S.w, S.p); const first = dk[0];
  ok(dk.length === 1 && first.dk && first.knight && first.k === 1 && first.r === C.DK_R && Math.abs(first.life - C.DK_LIFE * 1.5) < 1e-9 && S.w.fx.filter(v => v.t === 'dkraise').length === 1, 'Raise Legion raises one Death Knight (life 40 x 1.5) and a dkraise event');
  S.w.fx.length = 0; cast0(S.w, S.p); S.w.updateAllies(0); dk = mine(S.w, S.p); ok(dk.length === 1 && dk[0] !== first && first.dead === true, 'the next Raise Legion replaces it');
  ok(S.w.spawnMinion(S.p, S.p.x, S.p.y, 12) === null && mine(S.w, S.p).length === 1, 'it holds the cap alone: no other raise while it stands (and it is never the replaced oldest)');
  for (let i = 0; i < 40; i++) S.w.rng.chance(0.5); const lf = dk[0].life; run(S.w, 20); ok(mine(S.w, S.p).length === 1 && Math.abs(mine(S.w, S.p)[0].life - lf) < 1e-9, 'it does not run down with time');
  S.p.hp = 1; S.w.playerSkill(S.p, 0, {}, 1); ok(mine(S.w, S.p).length === 1 && S.p.hp === 1, 'Bone Harvest neither bursts nor heals from the Death Knight');
  const snap = ED.Net.encodeSnap(S.w, [], false); ok(snap.A.some(r => r[5] === 1), 'it travels on the wire as k 1');
  { // damage, stun and the arc
    const T = stage({ n_s1: 1, n_s1_b: 3 }), tn = ED.Stats.skillNums('legion', T.p.stats); const t = foe(T.w, T.p.x + 200, T.p.y); T.w.allies.length = 0; const a = T.w.spawnDeathKnight(T.p, t.x - 14, t.y); a.cd = 0;
    const A = foe(T.w, a.x + 20, a.y + 25), B = foe(T.w, a.x - 30, a.y), Cc = foe(T.w, a.x + 40, a.y + 60), D = foe(T.w, a.x + 10, a.y - 45), E = foe(T.w, a.x + 25, a.y - 15); E.boss = true; A.fodder = true; T.w.fx.length = 0;
    T.w.updateAllies(0); const want = tn.p.minion.dmg * (1 + T.p.stats.minionDmg) * C.COMP_MUL * 4.5;
    near(lost(t), want, 0.01, 'a Death Knight strike is x4.5 of a minion strike'); near(lost(A), want, 0.01, 'the cleave hits a foe 51 degrees off (fodder too)'); near(lost(E), want, 0.01, 'and a boss inside the arc'); ok(lost(B) === 0 && lost(Cc) === 0 && lost(D) === 0, 'not a foe behind it, one beyond 54 + its body, or one 77 degrees off the other side');
    near(t.stun, 0.5, 1e-9, 'the strike stuns its target 0.5 s'); ok(A.stun === 0, 'cleaved foes are not stunned'); near(a.cd, 0.5, 1e-9, 'it strikes every 0.5 s'); const sw = evs(T.w, 'dkswing'); ok(sw.length === 1 && Math.abs(sw[0].a) < 0.01, 'a dkswing event with the aim');
  }
  { // taunt
    const T = stage({ n_s1: 1, n_s1_b: 3 }); T.w.allies.length = 0; const a = T.w.spawnDeathKnight(T.p, T.p.x + 170, T.p.y);
    const in1 = foe(T.w, a.x - 100, a.y), in2 = foe(T.w, a.x + 60, a.y + 40), out = foe(T.w, a.x - 140, a.y), bs = foe(T.w, a.x - 50, a.y + 30), fo = foe(T.w, a.x, a.y - 100); bs.boss = true; fo.fodder = true; a.cd = 99; T.w.updateAllies(1 / 60);
    ok(in1.target === a && in2.target === a && fo.target === a && in1.tgtT >= 0.39, 'foes within 120 (fodder too) target the Death Knight'); ok(out.target !== a && bs.target !== a, 'a foe beyond 120 and a boss do not');
    a.life = 0; T.w.updateAllies(1 / 60); T.w.update(1 / 60); T.w.update(1 / 60); ok(a.dead && in1.target === T.p, 'when it falls the foes turn back to the hero');
  }
  { // taunted foes walk to it
    const walk = (dk) => { const T = stage({ n_s1: 1, n_s1_b: 3 }); T.w.allies.length = 0; const x = T.p.x + 100; const e = T.w.spawnEnemy('skeleton', x, T.p.y); e.cd = 9999; e.maxHp = e.hp = 5000; if (dk) { const a = T.w.spawnDeathKnight(T.p, x + 90, T.p.y); a.cd = 99; } run(T.w, 0.7); return e.x - x; };
    ok(walk(true) > 20 && walk(false) < -20, `a taunted foe walks to the Death Knight, an untaunted one to the hero (${walk(true).toFixed(0)}, ${walk(false).toFixed(0)})`);
  }
  { // durability: blocked shots and touching foes
    const T = stage({ n_s1: 1, n_s1_b: 3 }); T.w.allies.length = 0; const a = T.w.spawnDeathKnight(T.p, T.p.x + 200, T.p.y); a.cd = 99; const e = foe(T.w, a.x, a.y), el = foe(T.w, a.x + 8, a.y + 4, { elite: 'swift' }); const L = a.life;
    T.w.spawnProj({ team: 1, kind: 'bone', x: a.x + 6, y: a.y - 20, a: Math.PI, speed: 10, r: 4, dmg: 5, life: 3, owner: null, src: e }); T.w.updateAllies(1 / 60); near(L - a.life, 1 + C.DK_HIT * 3, 1e-9, 'a blocked shot costs 1 s and each touching foe 0.4 s (an elite 0.8)'); ok(T.w.projs.every(q => q.life <= 0) && evs(T.w, 'kblock').length === 1, 'the shot is destroyed');
    const l1 = a.life; T.w.updateAllies(1 / 60); near(a.life, l1, 1e-9, 'the same foes cost nothing again within a second'); T.w.time += 1.05; T.w.updateAllies(1 / 60); near(l1 - a.life, C.DK_HIT * 3, 1e-9, 'but again after it');
    a.life = 0.2; T.w.time += 1.05; T.w.updateAllies(1 / 60); T.w.updateAllies(1 / 60); ok(!mine(T.w, T.p).length && a.dead, 'at 0 it falls');
  }
  { // ranks 1 and 2 raise two plain Bone Knights
    for (const rank of [1, 2]) { const R = stage({ n_s1: 1, n_s1_b: rank }); cast0(R.w, R.p); ok(mine(R.w, R.p).length === 2 && mine(R.w, R.p).every(m => m.knight && !m.dk && m.k === 0), `rank ${rank}: two Bone Knights`); }
  }
}
{ // Carrion Storm (n_s2_a rank 3): Harvest detonates up to 10 recent corpses at 90%; each detonation launches 3 bone shards (40% of a burst) at the nearest foes, once per detonation
  const setup = (rank, nCorpses, foes) => {
    const S = stage({ n_s2: 1, n_s2_a: rank }); S.log = spy(S.w); S.ev = tap(S.w);
    for (let i = 0; i < nCorpses; i++) { const an = i * 0.5236; S.w.time += 0.1; const c = foe(S.w, S.p.x + Math.cos(an) * 120, S.p.y + Math.sin(an) * 60); if (i % 3 === 0) c.fodder = true; weaponHit(S.w, S.p, c, 1e6); }
    S.live = (foes || []).map(([dx, dy]) => foe(S.w, S.p.x + dx, S.p.y + dy)); S.N = ED.Stats.skillNums('harvest', S.p.stats); S.log.length = 0; return S;
  };
  const S = setup(3, 12, [[30, 0], [-40, 20], [10, -50]]), hp = S.N.p;
  ok(S.p.stats.corpse === 10 && Math.abs(S.p.stats.corpseMul - 0.9) < 1e-9 && S.p.stats.carrionN === 3 && Math.abs(S.p.stats.carrionShard - 0.4) < 1e-9 && S.p.stats.boneLance === 0.25, 'Carrion Storm stats: 10 corpses, 90%, 3 shards at 40% (Bone Lances keeps its +25%)');
  near(hp.corpse.dmg, hp.burst.dmg * 0.9, 1e-9, 'a corpse part is 90% of a burst'); near(hp.shard.dmg, hp.burst.dmg * 0.4, 1e-9, 'a shard is 40% of a burst'); ok(S.w.corpses.length === 12, 'twelve corpses (fodder too) are on record');
  S.w.playerSkill(S.p, 0, {}, 1); S.ev.step();
  const booms = S.ev.all.filter(v => v.t === 'boom' && v.c === 1), shards = S.w.projs.filter(q => q.part === 'harvest.shard');
  ok(booms.length === 10 && booms.every(v => v.cs === 1) && S.w.corpses.length === 2, `ten corpses detonate (the most recent), two stay (${booms.length}, ${S.w.corpses.length})`);
  ok(shards.length === 30 && shards.every(q => q.kind === 'bone' && q.team === 0 && q.hk === 'skill' && Math.abs(q.dmg - hp.shard.dmg) < 1e-9 && q.pierce === 0), `each detonation launches 3 shards: 30 (${shards.length})`);
  const aimed = [0, 0, 0]; for (const q of shards) { const a = Math.atan2(q.vy, q.vx); let bi = 0, bd = 9; S.live.forEach((f, i) => { const d = Math.abs(U.angDiff(a, Math.atan2(f.y - q.y - 4, f.x - q.x))); if (d < bd) { bd = d; bi = i; } }); aimed[bi]++; }
  ok(aimed.every(n => n === 10), `with three foes standing, every detonation sends one shard to each (${aimed})`);
  run(S.w, 1.2, S.ev.step); ok(S.log.filter(h => h.part === 'harvest.shard').length > 0 && S.ev.all.filter(v => v.t === 'boom' && v.c === 1).length === 10 && S.w.projs.every(q => q.part !== 'harvest.shard' || q.life <= 0) , 'the shards hit and detonate nothing more: still ten detonations');
  { // one corpse, four foes: the three nearest get a shard each, the fourth none
    const T = setup(3, 0, []); const c = foe(T.w, T.p.x + 100, T.p.y); weaponHit(T.w, T.p, c, 1e6); const f1 = foe(T.w, c.x + 30, c.y), f2 = foe(T.w, c.x - 60, c.y), f3 = foe(T.w, c.x, c.y + 90), f4 = foe(T.w, c.x, c.y - 200);
    T.w.playerSkill(T.p, 0, {}, 1); const sh = T.w.projs.filter(q => q.part === 'harvest.shard'), tg = [f1, f2, f3, f4].map(f => sh.filter(q => Math.abs(U.angDiff(Math.atan2(q.vy, q.vx), Math.atan2(f.y - q.y - 4, f.x - q.x))) < 0.02).length);
    ok(sh.length === 3 && tg.join() === '1,1,1,0', `three shards at the three nearest foes, none at the fourth (${tg})`);
    const U1 = setup(3, 0, []); const c1 = foe(U1.w, U1.p.x + 100, U1.p.y); weaponHit(U1.w, U1.p, c1, 1e6); foe(U1.w, c1.x + 40, c1.y); U1.w.playerSkill(U1.p, 0, {}, 1); ok(U1.w.projs.filter(q => q.part === 'harvest.shard').length === 3, 'a lone foe takes all three');
    const U0 = setup(3, 0, []); const c0 = foe(U0.w, U0.p.x + 100, U0.p.y); weaponHit(U0.w, U0.p, c0, 1e6); U0.w.playerSkill(U0.p, 0, {}, 1); ok(U0.w.projs.filter(q => q.part === 'harvest.shard').length === 0 && U0.w.fx.some(v => v.t === 'boom' && v.c === 1), 'no foe: the corpse still detonates, no shards');
    const UB = setup(3, 0, []); const cb = foe(UB.w, UB.p.x + 100, UB.p.y); weaponHit(UB.w, UB.p, cb, 1e6); const bb = foe(UB.w, cb.x + 40, cb.y); bb.boss = true; UB.w.playerSkill(UB.p, 0, {}, 1); run(UB.w, 1); ok(lost(bb) > 0, 'shards hit a boss too');
  }
  { const R = setup(2, 8, [[30, 0]]); R.w.playerSkill(R.p, 0, {}, 1); ok(R.w.fx.filter(v => v.t === 'boom' && v.c === 1).length === 5 && !R.w.fx.some(v => v.cs) && !R.w.projs.some(q => q.part === 'harvest.shard'), 'rank 2: five corpses, no shards'); }
}
{ // Lich Form (n_s2_b rank 3): 5 s after Bone Harvest the weapon fires 2 extra soul bolts at 40%, raised minions last twice as long, 20% less damage taken through the Brace channel (under the DR floor); the shield stays as Bone Armor gives it
  const S = stage({ n_s2: 1, n_s2_b: 3 }), st = S.p.stats; S.p.stats.armor = 0;
  ok(st.lich === 1 && st.lichT === 5 && Math.abs(st.lichMul - 0.4) < 1e-9 && st.lichLife === 2 && Math.abs(st.braceDR - 0.2) < 1e-9 && st.boneField === 1, 'Lich Form stats: 5 s, 40%, x2 life, 20% less damage (Marrow Field kept)');
  const hurt = (S2) => { S2.p.hp = S2.p.maxHp; S2.p.invuln = 0; S2.p.shield = 0; S2.w.hurtPlayer(S2.p, 30, {}); return S2.p.maxHp - S2.p.hp; };
  const base = hurt(S); ok(!(S.p.lichT > 0), 'no window before Bone Harvest');
  for (let i = 0; i < 3; i++) S.w.spawnMinion(S.p, S.p.x, S.p.y, 12); S.w.fx.length = 0; S.w.playerSkill(S.p, 0, {}, 1);
  ok(S.p.lichT === 5 && S.p.braceT === 5 && S.w.fx.some(v => v.t === 'lich' && v.pid === 'p0'), 'Bone Harvest opens the window (a lich event, the Brace channel 5 s)');
  ok(mine(S.w, S.p).length === 2 && mine(S.w, S.p).every(m => Math.abs(m.life - 24) < 1e-9), 'the minions raised by that Harvest live 24 s');
  near(hurt(S) / base, 0.8, 1e-9, '20% less damage taken inside the window'); S.w.spawnMinion(S.p, S.p.x, S.p.y, 10); ok(Math.abs(S.w.allies[S.w.allies.length - 1].life - 20) < 1e-9, 'any raise in the window (a kill roll too) lives twice as long');
  S.w.zones.push({ kind: 'sanct', x: S.p.x, y: S.p.y, r: 80, dr: 0.4, t: 0, dur: 9, team: 0, id: 99 }); near(hurt(S) / base, 0.5, 1e-9, 'with a Sanctuary on top the product stops at the DR floor (x0.5)'); S.w.zones.length = 0;
  S.w.projs.length = 0; S.w.playerAttack(S.p, 0); const bolts = S.w.projs.filter(q => q.kind === 'soul' && q.wpn), W0 = S.p.stats.weapon.dmg;
  ok(bolts.length === 3, `the Bone Wand shot plus two extra soul bolts (${bolts.length})`);
  const extra = bolts.filter(q => Math.abs(q.dmg - W0 * 0.4) < 1e-9); ok(extra.length === 2 && extra.every(q => q.homing > 0 && Math.abs(Math.abs(Math.atan2(q.vy, q.vx)) - 0.22) < 1e-6), 'the extras deal 40% of a hit, seek, and fly 0.22 rad either side');
  { const T = stage({ n_s2: 1, n_s2_b: 3 }, 7); T.p.stats.armor = 0; const e = foe(T.w, T.p.x + 70, T.p.y); T.w.playerSkill(T.p, 0, {}, 1); T.w.allies.length = 0; T.w.projs.length = 0; T.w.playerAttack(T.p, 0); run(T.w, 1);
    near(lost(e), T.p.stats.weapon.dmg * T.p.stats.dmg * 1.8, T.p.stats.weapon.dmg * 0.05, 'a foe in front takes the shot and both bolts (1 + 0.4 + 0.4 of a hit)'); }
  for (const wi of [1, 2]) { const T = stage({ n_s2: 1, n_s2_b: 3 }, 7, wi); T.w.playerSkill(T.p, 0, {}, 1); T.w.projs.length = 0; T.w.playerAttack(T.p, 0); const ex = T.w.projs.filter(q => q.kind === 'soul'); ok(ex.length === 2 && ex.every(q => Math.abs(q.dmg - T.p.stats.weapon.dmg * 0.4) < 1e-9), `${ED.CLASSES.necro.weapons[wi]}: two soul bolts at 40% of its hit`); }
  run(S.w, 5.1); ok(S.p.lichT <= 0 && S.p.braceT <= 0, 'the window ends after 5 s'); S.w.projs.length = 0; S.w.playerAttack(S.p, 0); ok(S.w.projs.filter(q => q.kind === 'soul').length === 1, 'no extra bolts after it'); near(hurt(S) / base, 1, 1e-9, 'and full damage taken'); S.w.allies.length = 0; S.w.spawnMinion(S.p, S.p.x, S.p.y, 12); ok(Math.abs(S.w.allies[0].life - 12) < 1e-9, 'minions live their normal time');
  { const T = stage({ n_s2: 1, n_s2_b: 3 }); T.w.playerSkill(T.p, 0, {}, 1); run(T.w, 3); T.w.playerSkill(T.p, 0, {}, 1); ok(T.p.lichT === 5, 'a new Harvest renews the window'); }
  { // the shield is Bone Armor's: nothing extra from the form
    const T = stage({ n_s2: 1, n_s2_b: 3 }), U2 = stage({ n_s2: 1, n_s2_b: 2 }), M = T.p.maxHp; for (const X of [T, U2]) { for (let i = 0; i < 3; i++) X.w.spawnMinion(X.p, X.p.x, X.p.y, 12); X.w.playerSkill(X.p, 0, {}, 1); }
    ok(Math.abs(T.p.shield - 0.06 * M) < 0.01 && Math.abs(U2.p.shield - 0.055 * M) < 0.01, 'rank 3 Harvest shields 6% (cap 5% + 2 x 0.5%), rank 2 5.5%: the card, not the form'); const sw = ED.Sheet.shieldWindow(T.p, T.w.time); ok(sw.a <= C.SHIELD_WIN_ALL * M + 0.01 && sw.c === 0, 'inside the all-sources window and outside the class window');
  }
  { const R = stage({ n_s2: 1, n_s2_b: 2 }); for (let i = 0; i < 2; i++) R.w.spawnMinion(R.p, R.p.x, R.p.y, 12); R.w.playerSkill(R.p, 0, {}, 1); R.w.projs.length = 0; R.w.playerAttack(R.p, 0); ok(!(R.p.lichT > 0) && R.w.projs.filter(q => q.kind === 'soul').length === 1 && Math.abs(mine(R.w, R.p)[0].life - 12) < 1e-9, 'rank 2 opens no window'); }
}

{ // fodder never rises: not by Gravecaller, not by the luck roll; its corpse still counts for Corpse Explosion
  const { w, p } = stage({ n_atk: 1, n_atk_h: 1 }); const e = foe(w, p.x + 50, p.y); e.fodder = true; e.hp = 1; weaponHit(w, p, e); ok(mine(w, p).length === 0 && p.raiseT <= 0, 'a fodder kill raises nothing (Gravecaller)');
  const c = stage({ n_s2: 1, n_s2_a: 1 }); const f = foe(c.w, c.p.x + 50, c.p.y); f.fodder = true; weaponHit(c.w, c.p, f, 1e6); ok(c.w.corpses.length === 1, 'a fodder death leaves a corpse');
  let rose = 0; for (let i = 0; i < 200; i++) { const s2 = stage({}, 7 + (i % 5)); const g = foe(s2.w, s2.p.x + 50, s2.p.y); g.fodder = true; g.hp = 1; weaponHit(s2.w, s2.p, g); rose += mine(s2.w, s2.p).length; } ok(rose === 0, 'the luck roll never raises fodder (' + rose + ' of 200)');
}

// ---- the luck roll still works for other builds, deterministic per seed ----
{
  const cnt = (seed) => { const { w, p } = stage({}, seed); for (let i = 0; i < 100; i++) { const e = foe(w, p.x + 50, p.y); e.hp = 1; weaponHit(w, p, e); } return w.allies.filter(a => a.life > 0).length; };
  const a = cnt(7), b = cnt(7); ok(a === b && a > 0, `luck roll is seeded (${a} of 100 kills rose, same on a rerun)`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
