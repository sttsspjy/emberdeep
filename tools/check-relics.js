// Usage: node tools/check-relics.js
// Headless checks of the relic engine (src/sim/relics.js) and relic sources: every relic id has a rarity, an icon mask, a description, a rule (a hook or a stat side) and a bot value (tools/pick.js RELIC_X);
// each hook category fires from its real call site in a staged world (hits, crits, attacks, hurt, lethal, kills, fight start and clear, room entry, casts, dashes, gold and heart pickups, boon picks,
// stratum start, level-ups, ally down and revive, shop buys, ticks, auras, get); curses never roll and lift; removeRelic; the shop's three relics and prices; per-hero relic picks (owner, group, crumble, no puff);
// boss rewards after the 2 s beat and not before; and a run with a relic set is the same state per seed. Prints failures and exits 1 when any check fails.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { ED } = require('./sim.js');
const PICK = require('./pick.js')(ED, require('./model.js')(ED));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'icons.js'), 'utf8'), { filename: 'icons.js' });
const R = ED.RELICS, FX = ED.RELIC_FX, V = (id) => R[id].v;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1 });
const run = (w, secs, f) => { for (let i = 0, k = Math.round(secs * 60); i < k; i++) { if (f) f(); w.update(1 / 60); } };

// A started run with n heroes (cls) at the start camp, no offers, no foes, no crits; relics given through giveRelic (their get hooks run).
function stage(relics, o) {
  o = o || {};
  const nh = o.n || 1, players = [];
  for (let i = 0; i < nh; i++) players.push({ pid: 'p' + i, name: 'T' + i, slot: i, cls: o.cls || 'knight', weapon: o.weapon || ED.CLASSES[o.cls || 'knight'].weapons[0], meta: META() });
  const w = new ED.World({ seed: o.seed || 7, pact: 0, players });
  w.startRun();
  const hs = [...w.players.values()];
  for (const p of hs) { p.offers.length = 0; p.picks = 0; p.offer = null; }
  w.enemies.length = 0; w.enc = null; w.locked = false; w.pickups.length = 0;
  for (const id of relics || []) w.giveRelic(hs[0], id);
  for (const p of hs) p.stats.crit = 0;
  hs.forEach((p, i) => { p.x = hs[0].x + i * 30; p.y = hs[0].y; });
  w.fx.length = 0; w.msgs.length = 0;
  return { w, p: hs[0], q: hs[1], hs };
}
// A still foe of type (default skeleton) at (x, y) with a deep health pool.
const foe = (w, x, y, type, hp) => { const e = w.spawnEnemy(type || 'skeleton', x, y); e.spd = 0; e.cd = 9999; e.maxHp = e.hp = hp || 50000; e.spawnT = 0; return e; };
const WPN = (p) => ({ p, kind: 'weapon', wpn: true, crit: false, noProc: true });

// ---------------- the table ----------------
{
  const Ic = ED.Icons, M = Ic && Ic.MASKS;
  ok(!!M, 'icons.js loads its masks');
  const bad = [];
  for (const id of ED.RELIC_IDS) {
    const r = R[id], why = [];
    if (!ED.RARITY[r.rar]) why.push('rarity');
    if (!M || !M[r.icon]) why.push('icon ' + r.icon);
    if (typeof r.name !== 'string' || !r.name) why.push('name');
    if (typeof r.desc !== 'string' || r.desc.length < 12) why.push('desc');
    if (typeof PICK.RELIC_X[id] !== 'number') why.push('pick value');
    if (!FX[id] && !(r.mods && Object.keys(r.mods).length)) why.push('no rule (no hook and no stat side)');
    if (why.length) bad.push(id + ': ' + why.join(', '));
  }
  ok(!bad.length, 'every relic has a rarity, an icon mask, a name, a description, a bot value and a rule: ' + bad.join('; '));
  ok(Object.keys(PICK.RELIC_X).every(id => R[id]), 'every bot value names a relic');
  const curses = ED.RELIC_IDS.filter(ED.isCurse);
  ok(curses.length >= 8 && curses.length <= 10 && curses.every(id => R[id].rar === 'curse'), 'eight to ten curses: ' + curses.length);
  ok(curses.every(id => PICK.RELIC_X[id] <= 0), 'no curse has a positive bot prior');
  ok(curses.filter(id => R[id].lift).length >= 5 && curses.every(id => !R[id].lift || (R[id].lift.n > 0 && ['kill', 'elite', 'clear', 'boon', 'stratum'].includes(R[id].lift.on))), 'curses with a lift name a counted moment and a count');
  ok(ED.heldRelics(['whetstone', 'c_rust', 'crown']) === 2, 'curses do not count as held relics');
  // the sheet of a hero holding every relic (curses included): no throw, every relic and curse listed
  {
    const { w, p } = stage();
    p.relics = ED.RELIC_IDS.slice(); w.recalc(p, false);
    let m = null, err = '';
    try { m = ED.Sheet.compute(p, ED.Sheet.ctx(w, p)); } catch (e) { err = e.message; }
    ok(m && !err, 'the sheet of a hero holding every relic computes: ' + err);
    for (const k of ['dmg', 'hp', 'vuln', 'spd']) { let e2 = ''; try { ED.Stats.breakdown({ cls: 'knight', weapon: p.weapon, boons: {}, relics: ED.RELIC_IDS, meta: META(), pact: 0 }, k); } catch (e) { e2 = e.message; } ok(!e2, 'Stats.breakdown(' + k + ') with every relic: ' + e2); }
  }
  const { w } = stage();
  let bad2 = 0;
  for (let i = 0; i < 6000; i++) { const r = R[w.rollRelic(i % 3 ? 'c' : 'r')].rar; if (r === 'curse' || r === 'boss') bad2++; }
  ok(bad2 === 0, 'a c / r / e roll never gives a curse or a boss relic');
}

// ---------------- hooks from their call sites ----------------
{ // hitMul (Pristine Halo): +mul at full health, none below
  const { w, p } = stage(['pristine']), e = foe(w, p.x + 30, p.y);
  const full = w.hitEnemy(e, 100, WPN(p)); p.hp = p.maxHp - 1;
  const hurt = w.hitEnemy(e, 100, WPN(p));
  ok(full > hurt * 1.1, `hitMul: Pristine Halo hits harder at full health (${full} vs ${hurt})`);
}
{ // crit (Glass Eye): a foe at full health takes a crit
  const { w, p } = stage(['glasseye']), e = foe(w, p.x + 30, p.y);
  const src = () => ({ p, kind: 'weapon', wpn: true, noProc: true });
  const a = w.hitEnemy(e, 100, src()), b = w.hitEnemy(e, 100, src());
  ok(a > b * 1.2, `crit: Glass Eye crits a foe at full health (${a} then ${b})`);
}
{ // hit (Rusted Nail): stacks per hero on the foe, adds to later hits
  const { w, p } = stage(['nail']), e = foe(w, p.x + 30, p.y);
  const a = w.hitEnemy(e, 100, WPN(p)); for (let i = 0; i < 8; i++) w.hitEnemy(e, 100, WPN(p));
  const b = w.hitEnemy(e, 100, WPN(p));
  ok(e.rnP === p.pid && e.rnN === 10 && b > a, `hit: Rusted Nail stacks (${e.rnN}) and its hits grow (${a} -> ${b})`);
}
{ // attack (Whetstone): every Nth attack is empowered
  const { w, p } = stage(['whetstone']), N = V('whetstone').every, muls = [];
  for (let k = 1; k <= N; k++) { p.atkCount = k; muls.push(w.relicAttack(p).mul); }
  ok(muls.filter(m => m > 1).length === 1 && muls[N - 1] === 1 + V('whetstone').mul, 'attack: Whetstone empowers one attack in ' + N + ': ' + muls.join());
}
{ // lock (fight start, via enterRoom) and hurtPre (Buckler): the first hit of a fight is blocked
  const { w, p } = stage(['buckler']);
  const room = w.floor.rooms.find(r => r.type === 'combat' && !r.dark);
  w.enterRoom(room.id, null);
  ok(w.locked && p.rt.buckler === true, 'lock: entering a fight readies the Buckler');
  const e = foe(w, p.x + 30, p.y), hp = p.hp; p.invuln = 0;
  const hit1 = w.hurtPlayer(p, 10, { e }); p.invuln = 0;
  const hit2 = w.hurtPlayer(p, 10, { e });
  ok(hit1 === false && hit2 === true && p.hp < hp, 'hurtPre: the Buckler blocks the first hit, not the second');
}
{ // hurtMul (Stoneskin): standing still cuts damage taken
  const { w, p } = stage(['stoneskin']), e = foe(w, p.x + 30, p.y);
  p.stillT = 0; let hp = p.hp; w.hurtPlayer(p, 20, { e }); const moving = hp - p.hp;
  p.invuln = 0; p.stillT = 2; hp = p.hp; w.hurtPlayer(p, 20, { e }); const still = hp - p.hp;
  ok(still < moving, `hurtMul: Stoneskin takes less standing still (${still} vs ${moving})`);
}
{ // hurt (Elixir): the first fall below 30% heals once per stratum
  const { w, p } = stage(['elixir']), e = foe(w, p.x + 30, p.y);
  p.hp = Math.round(p.maxHp * 0.32); w.hurtPlayer(p, Math.round(p.maxHp * 0.05), { e });
  const healed = p.hp > p.maxHp * 0.3; p.invuln = 0; const hp2 = p.hp;
  p.hp = Math.round(p.maxHp * 0.32); w.hurtPlayer(p, Math.round(p.maxHp * 0.05), { e });
  ok(healed && p.rt.elixir && p.hp < p.maxHp * 0.3 && hp2 > 0, 'hurt: the Elixir heals the first fall below 30%, not the second');
}
{ // lethal (Guardian Angel): a killing blow leaves 1 health, once
  const { w, p } = stage(['angel']), e = foe(w, p.x + 30, p.y);
  p.hp = 5; w.hurtPlayer(p, 999, { e });
  ok(!p.downed && p.hp === 1 && p.angelUsed, 'lethal: the Guardian Angel saves the hero at 1 health');
  p.invuln = 0; w.hurtPlayer(p, 999, { e });
  ok(p.downed, 'lethal: and only once');
}
{ // kill (Powder Keg): a non-fodder kill blasts the foes around it; a fodder kill does not
  const { w, p } = stage(['keg']), a = foe(w, p.x + 60, p.y), b = foe(w, p.x + 90, p.y);
  w.killEnemy(a, p, { kind: 'weapon' });
  ok(b.hp < b.maxHp, 'kill: the Powder Keg blasts around a slain foe');
  const fod = Object.keys(ED.ENEMIES).find(k => ED.ENEMIES[k].fodder), f = w.spawnEnemy(fod, p.x + 60, p.y + 60), c = foe(w, p.x + 70, p.y + 70), hc = c.hp;
  f.spawnT = 0; w.killEnemy(f, p, { kind: 'weapon' });
  ok(c.hp === hc, 'kill: fodder kills fire no relic kill hook');
}
{ // tick (Stopwatch): the fight start stuns every foe once while its window runs
  const { w, p } = stage(['timestop']), e = foe(w, p.x + 120, p.y);
  w.relicAll('lock', w.room); run(w, 0.1);
  ok(e.rstop === 1 && e.stun > 1.5, 'tick: the Stopwatch stuns the foes of a new fight: ' + e.stun);
}
{ // clear (Bandage): a won fight heals
  const { w, p } = stage(['bandage']);
  const room = w.floor.rooms.find(r => r.type === 'combat' && !r.dark);
  w.enterRoom(room.id, null); w.enemies.length = 0; p.hp = 10;
  w.roomCleared();
  ok(p.hp === 10 + V('bandage').heal, 'clear: the Bandage heals on a won fight: ' + p.hp);
}
{ // enter (Compass): an event room pays gold
  const { w, p } = stage(['compass']);
  const ev = w.floor.rooms.find(r => r.type === 'event');
  ok(!!ev, 'the staged floor has an event room');
  if (ev) { const g = w.gold; w.enterRoom(ev.id, null); ok(w.gold - g === V('compass').gold, 'enter: the Compass pays ' + V('compass').gold + ' gold in an event room: ' + (w.gold - g)); }
}
// ---------------- map relics (room patches): host floor vs a client floor rebuilt from the seed and a full snapshot's RP ----------------
{
  if (!ED.Net) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'), { filename: 'net.js' });
  const D = ED.Dungeon, N = ED.Net;
  const base = (w) => D.generate(w.stratum, w.floorSeed); // the floor as generated, before any patch
  // Rooms whose type, reward, event, w or h differ between the host floor and Dungeon.generate + applyPatches(full snapshot RP).
  const clientDiff = (w) => {
    const fl = base(w);
    D.applyPatches(fl, JSON.parse(JSON.stringify(N.encodeSnap(w, [], true))).RP);
    return w.floor.rooms.filter(r => { const q = fl.rooms[r.id]; return r.type !== q.type || r.reward !== q.reward || (r.event || null) !== (q.event || null) || r.w !== q.w || r.h !== q.h; }).length;
  };
  const stageWith = (relic, fit) => { for (let s = 7; s < 307; s += 3) { const st = stage([relic], { seed: s }); if (!fit || fit(st.w)) return st; } return null; };
  { // ink: v.n unvisited combat rooms ahead become event rooms, now and at each stratum start
    const w = stageWith('ink').w;
    for (const s of [1, 2]) {
      if (s > 1) w.enterStratum(s);
      const b = base(w), row = w.room.row;
      const turned = w.floor.rooms.filter(r => b.rooms[r.id].type === 'combat' && r.type === 'event');
      const other = w.floor.rooms.filter(r => b.rooms[r.id].type !== r.type).length - turned.length;
      ok(turned.length === V('ink').n && turned.every(r => r.row > row && !w.roomState[r.id].visited && !b.rooms[r.id].dark) && other === 0, `ink s${s}: ${turned.length} combat rooms ahead became event rooms (${other} other changes)`);
      const d = clientDiff(w);
      ok(d === 0, `ink s${s}: the client floor equals the host floor (${d} rooms differ)`);
    }
  }
  { // dice: every unvisited gold reward becomes boon, forge or vigor, now and at each stratum start
    const st = stageWith('dice', (w) => base(w).rooms.some(r => r.reward === 'gold'));
    ok(!!st, 'dice: a staged floor with gold rewards');
    if (st) for (const s of [1, 2]) {
      const w = st.w;
      if (s > 1) w.enterStratum(s);
      const b = base(w), gold = b.rooms.filter(r => r.reward === 'gold' && !w.roomState[r.id].visited);
      ok(gold.every(r => ['boon', 'forge', 'vigor'].indexOf(w.floor.rooms[r.id].reward) >= 0) && !w.floor.rooms.some(r => r.reward === 'gold' && !w.roomState[r.id].visited), `dice s${s}: ${gold.length} gold rewards became ${gold.map(r => w.floor.rooms[r.id].reward).join('/')}`);
      const d = clientDiff(w);
      ok(d === 0, `dice s${s}: the client floor equals the host floor (${d} rooms differ)`);
    }
  }
  { // compass: only unknown event rooms reachable within v.rows rows above the party's room get their identity, again on each room entry
    const R3 = V('compass').rows, E = ED.Events;
    const st = stageWith('compass', (w) => { const ev = w.floor.rooms.filter(r => r.type === 'event'); return ev.some(r => r.row <= R3) && ev.some(r => r.row > R3 + 1); });
    ok(!!st, 'compass: a staged floor with event rooms near and far');
    if (st) {
      const w = st.w;
      const known = () => w.floor.rooms.filter(r => r.type === 'event' && r.event && !w.roomState[r.id].visited);
      const check = (tag) => {
        const top = w.room.row + R3, near = E.ahead(w).filter(r => r.type === 'event' && r.row <= top), k = known();
        const far = w.floor.rooms.filter(r => r.type === 'event' && r.row > top);
        ok(near.length > 0 && near.every(r => !!r.event) && k.every(r => r.row <= top) && far.length > 0 && far.every(r => !r.event), `compass ${tag}: ${k.length} event rooms known, all within ${R3} rows of row ${w.room.row}; ${far.length} far ones unknown`);
        const seen = Object.keys(E.run(w).evSeen).length;
        ok(seen === k.length, `compass ${tag}: the run pool spends one event per known room (${seen} seen)`);
        const d = clientDiff(w);
        ok(d === 0, `compass ${tag}: the client floor equals the host floor (${d} rooms differ)`);
      };
      check('at get');
      const k0 = known().length;
      // climb one row through a room that is not an event room: its entry reveals one more row
      const next = w.room.exits.map(id => w.floor.rooms[id]).find(r => r.type !== 'event' && r.type !== 'boss');
      ok(!!next, 'compass: a room to climb into');
      if (next) {
        w.enterRoom(next.id, null); w.enemies.length = 0; w.enc = null; w.locked = false;
        if (w.floor.rooms.some(r => r.type === 'event' && r.row > w.room.row + R3)) check('after a room entry');
        ok(known().length >= k0, `compass: the entry keeps or adds known rooms (${k0} -> ${known().length})`);
      }
    }
  }
}
{ // cast (Focusing Lens): a skill cast empowers the next weapon hits for a while
  const { w, p } = stage(['lens'], { cls: 'pyro' });
  w.playerSkill(p, 0, { x0: p.x, y0: p.y, x: p.x + 40, y: p.y }, 0);
  ok(p.rt.lens > w.time, 'cast: the Lens arms on a skill cast');
  const e = foe(w, p.x + 30, p.y);
  ok(w.relicHitMul(p, e, WPN(p)) === V('lens').mul, 'cast: and the next weapon hits add its share');
}
{ // dash (Gust Charm, Swift Boots): the dash blasts around the hero and arms the boots
  const { w, p } = stage(['gust', 'boots']), e = foe(w, p.x + 40, p.y);
  w.playerDash(p, 1, 0);
  ok(e.hp < e.maxHp && p.rt.boots > w.time, 'dash: the Gust Charm blasts and the Swift Boots arm on a dash');
  ok(p.stats.dashCharges === stage().p.stats.dashCharges, 'dash: no relic adds a dash charge');
}
{ // gold and heart pickups (Pauper's Curse, Heartwood)
  const g0 = stage([]), g1 = stage(['c_poverty']);
  for (const s of [g0, g1]) { s.gold0 = s.w.gold; s.w.collect(s.p, { kind: 'gold', val: 20 }); }
  ok(g1.w.gold - g1.gold0 < g0.w.gold - g0.gold0, `gold: the curse thins gold pickups (${g1.w.gold - g1.gold0} vs ${g0.w.gold - g0.gold0})`);
  const h0 = stage([]), h1 = stage(['bloodstone']);
  for (const s of [h0, h1]) { s.p.hp = 10; s.w.collect(s.p, { kind: 'heart' }); }
  ok(h1.p.hp > h0.p.hp, `heart: Heartwood hearts heal more (${h1.p.hp} vs ${h0.p.hp})`);
}
{ // boon (Quill): a boon pick pays gold
  const { w, p } = stage(['quill']);
  w.grantOffer(p, { src: 'room' }); w.updateOffers(0);
  const i = p.offer.findIndex(id => !ED.BOONS[id].purse), g = w.gold;
  w.pickBoon(p.pid, i);
  ok(w.gold - g === V('quill').gold, 'boon: the Quill pays on a boon pick: ' + (w.gold - g));
}
{ // get and stratum (War Chest): gold when taken and at each stratum start
  const s0 = stage([]), g = s0.w.gold, { w } = stage(['warchest']);
  ok(w.gold - g === V('warchest').gold, 'get: the War Chest pays when taken');
  const g2 = w.gold; w.enterStratum(2);
  ok(w.gold - g2 === V('warchest').gold, 'stratum: and at a stratum start: ' + (w.gold - g2));
}
{ // level (Lucky Star): a level-up heals and grants crits
  const { w, p } = stage(['star']);
  p.hp = 10; w.addXp(w.xpNext);
  ok(p.hp === 10 + V('star').heal, 'level: the Lucky Star heals on a level-up');
}
{ // down (Oath) and revive (Lifeline Rope), two heroes
  const { w, p, q } = stage(['oath', 'lifeline'], { n: 2 });
  const e = foe(w, q.x + 200, q.y + 200); q.hp = 1; w.hurtPlayer(q, 999, { e });
  ok(q.downed && p.rt.oath && p.rt.oathT > w.time, 'down: an ally down sets off the Oath');
  w.enemies.length = 0; p.x = q.x + 10; p.y = q.y;
  run(w, 4);
  ok(!q.downed && q.hp >= Math.round(q.maxHp * V('lifeline').hp), `revive: the Lifeline Rope revives at ${V('lifeline').hp * 100}% (${q.hp} / ${q.maxHp})`);
}
{ // shop (Haggler's Purse): the first buy of a shop visit pays half back; the shop holds a common, a rare and an epic relic at 60 / 90 / 130
  const { w, p } = stage(['haggle']);
  const shop = Object.assign({}, w.room, { type: 'shop' }), props = w.makeProps(shop), rel = props.filter(x => x.stype === 'relic');
  ok(rel.length === 3 && rel.map(x => R[x.item].rar).join() === 'c,r,e', 'the shop sells three relics, common, rare and epic: ' + rel.map(x => R[x.item].rar).join());
  ok(rel.map(x => x.price).join() === '60,90,130', 'relic prices 60 / 90 / 130 at stratum I: ' + rel.map(x => x.price).join());
  ok(props.find(x => x.stype === 'boon').price === 65, 'an epic boon is 65 at stratum I');
  w.relicAll('enter', shop); w.props.push(...props); w.gold = 1000;
  const pr = rel[0]; pr.x = p.x; pr.y = p.y;
  w.interact(p.pid, pr.id);
  ok(p.relics.includes(pr.item) && w.gold === 1000 - pr.price + Math.round(pr.price * V('haggle').back), 'shop: the Haggler\'s Purse pays half of the first buy back: ' + w.gold);
}
{ // aura (Banner of Unity): a hero near the holder adds the share; far away none
  const { w, p, q } = stage(['banner'], { n: 2 }), e = foe(w, q.x + 30, q.y);
  ok(w.relicHitMul(q, e, WPN(q)) === FX.banner.aura, 'aura: an ally near the Banner adds its share');
  q.x += 400; ok(w.relicHitMul(q, e, WPN(q)) === 0, 'aura: none out of reach');
}
{ // curse lift (Clumsy Hands: 3 fights won) and removeRelic
  const { w, p } = stage(['c_clumsy']);
  w.relicAll('clear', w.room); w.relicAll('clear', w.room);
  ok(p.relics.includes('c_clumsy') && p.rs.c_clumsy === 2, 'a curse counts its lift');
  w.relicAll('clear', w.room);
  ok(!p.relics.includes('c_clumsy') && !p.rh.hitMul && w.msgs.some(m => m.t === 'toast' && /lifted/.test(m.text)), 'and lifts at its count (hooks rebuilt, toast)');
  w.giveRelic(p, 'crown'); const ch = p.stats.choices;
  ok(w.removeRelic(p, 'crown') && p.stats.choices < ch && !p.relics.includes('crown'), 'removeRelic takes a relic and its stats');
  ok(w.removeRelic(p, 'crown') === false, 'removeRelic is false for a relic not held');
}

// ---------------- relic picks: one group of three per hero, owner-only ----------------
{
  const { w, p, q } = stage([], { n: 2 });
  const rw = { id: 9001, kind: 'reward', x: p.x, y: p.y, item: 'relic', group: 777, state: 0 };
  w.props.push(rw); w.interact(p.pid, rw.id);
  const picks = w.props.filter(x => x.kind === 'relic');
  const mine = picks.filter(x => x.owner === p.pid), theirs = picks.filter(x => x.owner === q.pid);
  ok(mine.length === 3 && theirs.length === 3, `a relic reward spawns three picks per hero (${mine.length}, ${theirs.length})`);
  ok(new Set(mine.map(x => x.group)).size === 1 && new Set(theirs.map(x => x.group)).size === 1 && mine[0].group !== theirs[0].group, 'one group per hero');
  ok(new Set(mine.map(x => x.item)).size === 3 && picks.every(x => ['c', 'r', 'e'].includes(R[x.item].rar)), 'three different relics, no boss relic or curse');
  const t = theirs[0]; q.x = t.x; q.y = t.y; p.x = t.x; p.y = t.y;
  w.interact(p.pid, t.id);
  ok(t.state === 0 && !p.relics.includes(t.item), 'a hero cannot take another hero\'s pick');
  const m = mine[1]; p.x = m.x; p.y = m.y; w.fx.length = 0; w.msgs.length = 0;
  w.interact(p.pid, m.id);
  ok(p.relics.includes(m.item) && mine.every(x => x.state === 1) && theirs.every(x => x.state === 0), 'taking a pick crumbles the hero\'s other picks only');
  ok(!w.fx.some(f => f.t === 'puff') && w.msgs.some(x => x.t === 'claimed' && x.to === p.pid && x.group === m.group), 'no sim puff; the claim is sent');
  // champion rooms: rare or better; Void Stone: a fourth pick
  const c = stage(['voidstone'], { n: 1 });
  c.w.room = Object.assign({}, c.w.room, { type: 'champion' });
  const r2 = { id: 9002, kind: 'reward', x: c.p.x, y: c.p.y, item: 'relic', group: 778, state: 0 };
  c.w.props.push(r2); c.w.interact(c.p.pid, r2.id);
  const cp = c.w.props.filter(x => x.kind === 'relic');
  ok(cp.length === 4 && cp.every(x => R[x.item].rar === 'r' || R[x.item].rar === 'e'), 'a champion pick is rare or better; Void Stone adds a fourth: ' + cp.map(x => R[x.item].rar).join());
}

// ---------------- boss rewards land after the beat ----------------
{
  const { w, hs } = stage([], { n: 2 });
  const b = w.spawnEnemy(ED.biomeFor(1).boss, w.players.get('p0').x + 100, w.players.get('p0').y);
  w.boss = b; w.onBossKilled(b, hs[0], {});
  const early = () => w.props.filter(x => x.kind === 'relic' || x.kind === 'portal').length + hs.reduce((a, p) => a + p.offers.length, 0);
  ok(early() === 0 && w.bossBeat && w.bossBeat.t === ED.World.BOSS_BEAT, 'no boss reward at the kill');
  run(w, ED.World.BOSS_BEAT - 0.1);
  ok(early() === 0, 'none before the beat ends');
  run(w, 0.2);
  const rel = w.props.filter(x => x.kind === 'relic');
  ok(!w.bossBeat && rel.length === 6 && rel.every(x => R[x.item].rar === 'boss') && hs.every(p => rel.filter(x => x.owner === p.pid).length === 3), 'after 2 s: three boss relic picks per hero');
  ok(w.props.some(x => x.kind === 'portal') && hs.every(p => p.offers.some(o => o.src === 'class')), 'and the portal and the class offer');
}

// ---------------- determinism ----------------
{
  const SET = ['keg', 'nail', 'soulcage', 'ricochet', 'coin', 'thorncrown', 'tooth', 'lastbreath'];
  const sig = () => {
    const { w, p } = stage(SET, { seed: 31 });
    for (let i = 0; i < 6; i++) { const e = w.spawnEnemy('skeleton', p.x + 60 + 20 * i, p.y + (i % 2 ? 30 : -30)); e.spawnT = 0; }
    let next = 0;
    run(w, 10, () => {
      if (w.time >= next) { const f = w.enemies.find(e => e.hp > 0); w.playerAttack(p, f ? Math.atan2(f.y - p.y, f.x - p.x) : 0); next = w.time + 0.4; }
      if (p.downed) { p.downed = false; p.hp = p.maxHp; }
    });
    return JSON.stringify({ hp: p.hp, gold: w.gold, rs: p.rs, crits: p.critN, foes: w.enemies.map(e => [e.type, Math.round(e.hp), Math.round(e.x), Math.round(e.y)]), kills: w.run.kills, picks: w.pickups.length });
  };
  const a = sig(), b = sig();
  ok(a === b, 'the same seed and relic set give the same state after 600 ticks');
  ok(JSON.parse(a).kills > 0, 'and the run fought (kills ' + JSON.parse(a).kills + ')');
}

console.log(`check-relics: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
