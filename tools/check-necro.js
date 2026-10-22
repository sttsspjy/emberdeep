// Usage: node tools/check-necro.js
// Headless checks of the Necromancer's 12 route cards against DESIGN-classes section 9 in staged rooms: stat totals per rank, then every behaviour and rider (Hex, Gravecaller, Soul Barrage, Endless Legion, Bone Spikes,
// Bone Knights, Grim Harvest, Corpse Explosion, Bone Armor, Grave Pact, Abyssal Toll, Rise Again). Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
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
  s = tot({ n_s1: 1, n_s1_a: 3 }); ok(s.boneSpikes === 1 && s.spikeRaise === 1, 'Bone Spikes + Boneyard'); near(s.s1Dmg, 1.2 * 1.2 - 1, 1e-9, 'Bone Spikes +10% per rank (compounds with Endless Legion +20%)');
  s = tot({ n_s1: 1, n_s1_b: 3 }); near(s.maxMinions, 2, 1e-9, 'Bone Knights: at most 2'); near(ED.Stats.skillNums('legion', s).p.minion.n, 2, 1e-9, 'Legion raises 2'); ok(s.knights === 1, 'knights flag');
  near(s.minionDmg, 0.2, 1e-9, 'Bone Knights +10% per rank'); near(s.knightLife, 0.5, 1e-9, 'Ironbone life +50%'); near(s.knightStun, 0.5, 1e-9, 'Ironbone stun 0.5 s');
  s = tot({ n_s2: 1 }); near(s.s2Dmg, 0.4, 1e-9, 'Grim Harvest +40%'); near(s.s2Area, 0.2, 1e-9, 'Grim Harvest +20% wider'); near(s.harvestRaise, 2, 1e-9, 'Grim Harvest raises 2');
  near(ED.Stats.skillNums('harvest', s).p.burst.dmg, 40.2 * 1.4, 1e-6, 'Harvest burst 40.2 x 1.4'); near(ED.Stats.skillNums('harvest', s).p.burst.r, 72, 1e-9, 'Harvest radius 60 x 1.2');
  s = tot({ n_s2: 1, n_s2_a: 3 }); near(s.corpse, 6, 1e-9, 'Corpse Explosion 4 + 1 per rank'); near(s.corpseMul, 0.7, 1e-9, 'corpse burst 70%'); near(s.boneLance, 0.25, 1e-9, 'Bone Lances +25%');
  const hp = ED.Stats.skillNums('harvest', s).p; near(hp.corpse.dmg, hp.burst.dmg * 0.7, 1e-9, 'corpse part 70% of the burst'); near(hp.lance.dmg, hp.burst.dmg * 1.25, 1e-9, 'lance part +25%'); near(hp.corpse.r, hp.burst.r, 1e-9, 'corpse radius = burst radius'); ok(hp.corpse.on && hp.lance.on, 'corpse and lance parts on');
  s = tot({ n_s2: 1, n_s2_b: 3 }); near(s.boneArmor, 0.03, 1e-9, 'Bone Armor 3% per minion'); near(s.boneCap, 0.06, 1e-9, 'Bone Armor cap 5% + 0.5% per rank'); ok(s.boneField === 1, 'Marrow Field at rank 3');
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
  const { w: w4, p: p4 } = stage({ n_s1: 1, n_s1_a: 3 }); near(ED.Stats.skillNums('legion', p4.stats).p.spikes.dmg, 23.5 * 1.44, 0.01, 'Spikes rank 3: +10% per rank');
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
  const { w, p } = stage({ n_s1: 1, n_s1_b: 3 }); w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 60, y: p.y }, 0);
  const ks = mine(w, p); near(ks[0].life, 18, 1e-9, 'Ironbone: 12 s x 1.5'); near(p.stats.minionDmg, 0.2, 1e-9, 'rank 3 minion damage +20%');
  const e = foe(w, p.x + 200, p.y); w.allies.length = 0; const a = minionAt(w, p, e); w.updateAllies(0);
  near(lost(e), 11.4 * 1.2 * 1.2 * C.COMP_MUL * C.KNIGHT_MUL, 0.01, 'rank 3 knight hit'); ok(e.stun >= 0.49 && e.stun <= 0.51, `a Bone Knight's strike stuns its foe 0.5 s (${e.stun})`);
  ok(evs(w, 'kstun').length === 1, 'the stun emits a kstun event'); e.stun = 0; a.cd = 0; w.updateAllies(0); ok(e.stun === 0 && evs(w, 'kstun').length === 1, 'a foe on stun cooldown is not stunned again'); e.stunCd = 0; a.cd = 0; w.updateAllies(0); ok(e.stun > 0.49 && evs(w, 'kstun').length === 2, 'and is stunned again once the cooldown is over');
  const boss = foe(w, p.x + 200, p.y + 100); boss.boss = true; const b2 = minionAt(w, p, boss); w.updateAllies(0); ok(boss.stun === 0, 'bosses are never stunned');
  const { w: w1, p: p1 } = stage({ n_s1: 1, n_s1_b: 2 }); w1.spawnMinion(p1, p1.x, p1.y, 12); near(mine(w1, p1)[0].life, 12, 1e-9, 'no Ironbone life before rank 3'); void b2;
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
  const { w, p } = stage({ n_s2: 1, n_s2_a: 3 }); const e = foe(w, p.x + 160, p.y), far = foe(w, p.x - 250, p.y); const m = minionAt(w, p, e); m.x = p.x; m.y = p.y; w.fx.length = 0;
  w.playerSkill(p, 0, {}, 1); near(lost(e), burstOf(p, 1.25) * aff(w), 0.05, 'a lance bursts on the foe for +25%'); ok(far.hp === 5000, 'a foe beyond 200 of the minion is not chosen');
  const l = evs(w, 'blance'); ok(l.length === 1 && l[0].x1 === Math.round(e.x) && l[0].pid === 'p0', 'blance event from the minion to the foe');
  const { w: w2, p: p2 } = stage({ n_s2: 1, n_s2_a: 3 }); const f = foe(w2, p2.x + 400, p2.y); const m2 = minionAt(w2, p2, f); m2.x = p2.x; m2.y = p2.y; w2.fx.length = 0; w2.playerSkill(p2, 0, {}, 1); ok(f.hp === 5000 && evs(w2, 'blance').length === 0, 'no foe within 200: the minion bursts where it stands');
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
  const { w, p } = stage({ n_s2: 1, n_s2_b: 3 }); const e = foe(w, p.x + 120, p.y); const out = foe(w, p.x + 120, p.y + 100);
  for (let i = 0; i < 3; i++) { w.spawnMinion(p, p.x + 120, p.y, 12); } w.playerSkill(p, 0, {}, 1);
  const zs = w.zones.filter(z => z.kind === 'shards'); ok(zs.length === 3 && zs.every(z => z.r === 40 && z.dur === 2 && z.owner === 'p0'), 'three harvested minions leave three shard zones');
  w.updateZones(1 / 60); ok(e.slowT > 0 && Math.abs(e.slowAmt - 0.4) < 1e-9 && !(out.slowT > 0), 'foes inside are slowed 40%, others are not');
  for (let i = 0; i < 125; i++) w.updateZones(1 / 60); ok(!w.zones.some(z => z.kind === 'shards'), 'the shards last 2 s');
  const { w: w1, p: p1 } = stage({ n_s2: 1, n_s2_b: 2 }); w1.spawnMinion(p1, p1.x, p1.y, 12); w1.playerSkill(p1, 0, {}, 1); ok(!w1.zones.some(z => z.kind === 'shards'), 'no Marrow Field before rank 3');
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

// ---- the luck roll still works for other builds, deterministic per seed ----
{
  const cnt = (seed) => { const { w, p } = stage({}, seed); for (let i = 0; i < 100; i++) { const e = foe(w, p.x + 50, p.y); e.hp = 1; weaponHit(w, p, e); } return w.allies.filter(a => a.life > 0).length; };
  const a = cnt(7), b = cnt(7); ok(a === b && a > 0, `luck roll is seeded (${a} of 100 kills rose, same on a rerun)`);
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
