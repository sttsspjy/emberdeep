// Usage: node tools/check-events.js
// Headless checks of event rooms (src/sim/events.js, src/data/events.js, src/data/lore.js): every def is well formed (2+ choices, a safe one, valid strata and icons), the pools (6+ events per stratum I-III, a shared pool,
// 3+ rare events, 3+ chains); floor gen leaves event identities unresolved; the resolver never repeats an event in a run and respects strata and req; a chain fires; every outcome kind applies; a personal dialog and
// a party vote (with its 15 s timeout, safe-choice default and host tie-break); the dialog's 0.6 s lock rides the open message; patchRoom (type, reward, reveal) reaches a client mirror through a full snapshot,
// refuses visited rooms; determinism per seed; the save code's lore section. Prints failures and exits 1 when any check fails.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { ED } = require('./sim.js');
const E = ED.Events, D = ED.Dungeon, S = ED.Save;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const hero = (i, cls) => ({ pid: 'p' + i, name: 'H' + i, slot: i, cls: cls || 'knight', weapon: ED.CLASSES[cls || 'knight'].weapons[0], meta: META() });
const world = (seed, k) => {
  const w = new ED.World({ seed, pact: 0, players: Array.from({ length: k || 1 }, (_, i) => hero(i)) });
  w.startRun();
  for (const p of w.players.values()) { p.offers.length = 0; p.offer = null; p.picks = 0; }
  w.msgs.length = 0; w.fx.length = 0;
  return w;
};
// Puts the party in a fresh event room of the current floor (the first unvisited one) with event id forced (null: drawn as in play).
const enterEvent = (w, id) => {
  const r = w.floor.rooms.find(x => x.type === 'event' && !w.roomState[x.id].visited);
  if (id) w.patchRoom(r.id, { event: id });
  w.enterRoom(r.id, 's');
  w.msgs.length = 0;
  return r;
};
// Hero pid steps up to prop pr and interacts with it.
const use = (w, pid, pr) => { const p = w.players.get(pid); p.x = pr.x; p.y = pr.y + 20; w.interact(pid, pr.id); };
const msgs = (w, t, pid) => w.msgs.filter(m => m.t === t && (!pid || m.to === pid));

// ---------------- defs and pools ----------------
{
  const defs = Object.values(ED.EVENTS);
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'icons.js'), 'utf8'), { filename: 'icons.js' });
  const M = ED.Icons.MASKS;
  ok(defs.length >= 30, `about 30 text events (${defs.length})`);
  for (const d of defs) {
    const ch = d.choices || [];
    ok(ch.length >= 2 && ch.length <= 4 && d.safe >= 0 && d.safe < ch.length && ch.every(c => typeof c.go === 'function' && c.label), `${d.id}: 2-4 choices with go hooks and a safe choice (${ch.length}, safe ${d.safe})`);
    ok(!d.strata || (Array.isArray(d.strata) && d.strata.every(s => s >= 1 && s <= ED.CONST.STRATA)), `${d.id}: strata null or within I-IV`);
    ok(!!M[d.icon] && typeof d.name === 'string' && d.name.length > 2 && (d.w || 1) > 0, `${d.id}: a known icon (${d.icon}), a name and a weight`);
    ok(['fountain', 'altar', 'gamble', 'trial', 'chest', 'sign', 'merchant', 'campfire', 'anvil'].indexOf(d.look) >= 0, `${d.id}: a prop look the renderer draws (${d.look})`);
  }
  const only = (s) => defs.filter(d => d.strata && d.strata.length === 1 && d.strata[0] === s && !d.req && !d.rare);
  for (const s of [1, 2, 3]) ok(only(s).length >= 6, `stratum ${s}: ${only(s).length} events of its own (6+)`);
  ok(defs.filter(d => !d.strata && !d.req && !d.rare).length >= 6, 'a shared pool of 6+ events');
  ok(defs.filter(d => d.rare).length >= 3, `3+ rare events (${defs.filter(d => d.rare).map(d => d.id)})`);
  ok(defs.filter(d => d.req).length >= 3, `3+ chain events (${defs.filter(d => d.req).map(d => d.id)})`);
  for (const id of ['fountain', 'altar', 'gamble', 'trial']) ok(!!ED.EVENTS[id], `today's shrine ${id} is an event`);
  ok(ED.LORE.length >= 20 && ED.LORE.filter(p => p.rare).length >= 2 && new Set(ED.LORE.map(p => p.id)).size === ED.LORE.length, `~24 lore pages with unique ids (${ED.LORE.length}, ${ED.LORE.filter(p => p.rare).length} rare)`);
}

// ---------------- floor gen: identities unresolved ----------------
{
  let rooms = 0;
  for (let s = 1; s <= 4; s++) for (let seed = 1; seed <= 40; seed++) for (const r of D.generate(s, seed).rooms) if (r.type === 'event') { rooms++; ok(r.event === null, `floor gen leaves event rooms unresolved (s${s} seed ${seed})`); }
  ok(rooms > 100, `event rooms on the swept floors (${rooms})`);
}

// ---------------- resolver: no repeats, strata, req, chains ----------------
{
  const w = world(11);
  const seen = new Set();
  let dup = 0, wrong = 0, gated = 0;
  for (let s = 1; s <= 3; s++) {
    w.stratum = s;
    for (let i = 0; i < 9; i++) {
      const id = E.draw(w, s), d = E.def(id);
      if (seen.has(id)) dup++;
      seen.add(id);
      if (d.strata && d.strata.indexOf(s) < 0) wrong++;
      if (d.req) gated++;
    }
  }
  ok(dup === 0 && wrong === 0, `27 draws over strata I-III: no repeat (${dup}), none outside its strata (${wrong})`);
  ok(gated === 0, `no chain event without its flag (${gated})`);
  // a chain: the Gravekeeper's Debt flag lets the Collector in on stratum II, and it is likely
  let hits = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const v = world(seed);
    E.flag(v, 'debt'); v.stratum = 2;
    for (let i = 0; i < 3; i++) if (E.draw(v, 2) === 'collector') { hits++; break; }
  }
  ok(hits >= 20, `with the debt flag the Collector comes up within 3 stratum II draws in most runs (${hits}/40)`);
  // a whole chain in play: borrow on stratum I, then the Collector is drawn and pays
  const c = world(5);
  enterEvent(c, 'debt');
  const pr = c.props.find(x => x.ev === 'debt'), p = c.players.get('p0');
  use(c, 'p0', pr);
  const vt = c.ev.vote;
  ok(!!vt && msgs(c, 'evOpen', 'p0').length === 1, 'the party event opens a vote');
  const g0 = c.gold;
  c.evChoice('p0', 0, vt.k); c.update(1 / 60);
  ok(E.has(c, 'debt') && c.ev.vote === null && msgs(c, 'evResult', 'p0').length === 1, 'the vote resolved with the borrow choice and set the chain flag');
  for (let i = 0; i < 120; i++) c.update(1 / 60);
  c.collectAll();
  ok(c.gold > g0, `the borrowed gold reaches the purse (${g0} -> ${c.gold})`);
  c.enterStratum(2);
  c.run.evSeen = Object.assign({}, c.run.evSeen); // keep seen; draw until the Collector shows
  let got = false;
  for (let i = 0; i < 12 && !got; i++) got = E.draw(c, 2) === 'collector';
  ok(got, 'the Collector is drawn on stratum II after the debt');
  ok(p.pid === 'p0', 'hero intact');
}

// ---------------- outcomes ----------------
{
  const w = world(21, 2), [a, b] = [...w.players.values()];
  enterEvent(w, 'coffer');
  const lines = (spec, p) => E.outcome(w, p === undefined ? a : p, spec);
  w.gold = 100;
  lines({ gold: -30 }); ok(w.gold === 70, `gold -30 (${w.gold})`);
  lines({ gold: -500 }); ok(w.gold === 0, 'gold never below 0');
  lines({ gold: 40 }); for (let i = 0; i < 120; i++) w.update(1 / 60); w.collectAll(); ok(w.gold >= 40, `gold +40 drops for the party (${w.gold})`);
  a.hp = a.maxHp * 0.5; const h0 = a.hp; lines({ heal: 0.25 }); ok(a.hp > h0, 'heal +');
  a.hp = a.maxHp; lines({ heal: -0.3 }); ok(Math.abs(a.hp - a.maxHp * 0.7) < 1e-6, `heal - (${a.hp} of ${a.maxHp})`);
  a.hp = 2; lines({ heal: -0.9 }); ok(a.hp >= 1, 'a health cost never goes below 1');
  b.downed = true; b.hp = 0; lines({ raise: true, heal: 0.3 }, null); ok(!b.downed && b.hp > 1, 'raise stands the downed up and heals the party');
  const mh = a.maxHp; lines({ maxHp: 3 }); ok(a.maxHp === mh + 3, `max health +3 (${mh} -> ${a.maxHp})`);
  lines({ maxHp: -2 }); ok(a.maxHp === mh + 1, 'max health -2');
  for (const o of ['boon', 'epic', 'forge']) { a.offers.length = 0; lines({ offer: o }); ok(a.offers.length === 1 && a.offers[0].src === (o === 'boon' ? 'room' : o), `offer ${o}`); }
  a.offers.length = 0; b.offers.length = 0; lines({ offer: 'boon', offerN: 2 }, null); ok(a.offers.length === 2 && b.offers.length === 2, 'party offers: two each');
  a.offers.length = 0; b.offers.length = 0;
  const r0 = a.relics.length; lines({ relic: 'r' }); ok(a.relics.length === r0 + 1 && ED.RELICS[a.relics[r0]], 'relic for the hero');
  const props0 = w.props.length; lines({ relic: 'c' }, null); ok(w.props.filter(x => x.kind === 'relic').length >= w.partySize() && w.props.length > props0, 'a relic hoard for the party (one pick per hero)');
  const r1 = a.relics.length; lines({ removeRelic: true }); ok(a.relics.length === r1 - 1, 'remove a random relic');
  const id = a.relics[0] || 'whetstone'; if (!a.relics.length) w.giveRelic(a, id); const r2 = a.relics.length; lines({ removeRelic: id, relic: 'e' }); ok(a.relics.length === r2 && a.relics.indexOf(id) < 0, 'swap: the named relic out, a new one in');
  const curses = ED.RELIC_IDS.filter(k => ED.RELICS[k].rar === 'curse'), m2 = a.maxHp, c2 = a.relics.length;
  lines({ curse: true }); ok(curses.length ? a.relics.length === c2 + 1 && ED.RELICS[a.relics[c2]].rar === 'curse' : a.maxHp === m2 - 2, `a curse (${curses.length ? 'curse relic' : 'no curse relics yet: -2 max health'})`);
  const lore0 = E.run(w).lore.length; const ll = lines({ lore: true }); ok(E.run(w).lore.length === lore0 + 1 && /^Lore page: /.test(ll[0]) && !ED.LORE[E.run(w).lore[lore0]].rare, 'a lore page (not rare)');
  lines({ lore: 'rare' }); ok(ED.LORE[E.run(w).lore[lore0 + 1]].rare === true, 'a rare lore page');
  ok(w.summary().lore.length === lore0 + 2, 'the run summary carries the pages found');
  lines({ flag: 'testflag' }); ok(E.has(w, 'testflag'), 'flag');
  // map: reveal, a type, gild
  const ahead = E.ahead(w);
  ok(ahead.length > 0 && ahead.every(r => !w.roomState[r.id].visited && r.type !== 'boss'), `rooms ahead (${ahead.length})`);
  const evAhead = ahead.filter(r => r.type === 'event').length, rv = lines({ map: 'reveal', mapN: 99 }, null);
  ok(ahead.filter(r => r.type === 'event').every(r => !!r.event && r.reveal) && (evAhead === 0 || /event room/.test(rv[0])), `reveal: every event room ahead has its identity (${evAhead})`);
  const fights = ahead.filter(r => r.type === 'combat' && !r.dark && r.row <= w.room.row + 3).length, rt = lines({ map: 'rest' }, null);
  ok(fights === 0 || (/rest site/.test(rt[0]) && E.ahead(w).filter(r => r.type === 'rest' && w.patches[r.id]).length === 1), `a fight ahead became a rest site (${rt})`);
  const gl = lines({ map: 'gild', mapN: 2 }, null); ok(gl.length === 0 || /pay/.test(gl[0]), `gild (${gl})`);
  // fight: the room locks, waves run, the clear pays embers and the pay spec
  w.msgs.length = 0;
  const emb = w.run.embers.elites;
  lines({ fight: 'elite', pay: { gold: 25, offer: 'forge' } }, null);
  ok(w.locked && w.enc && w.enc.kind === 'trial' && w.enc.waves.length === 2 && w.enc.waves[0][0].elite, 'an elite fight locks the room with two waves led by an elite');
  let guard = 0;
  while (w.locked && guard++ < 60 * 60) { for (const e of w.enemies) if (e.hp > 0 && !(e.spawnT > 0)) w.killEnemy(e, a, { kind: 'weapon' }); w.update(1 / 60); }
  ok(!w.locked && w.run.embers.elites === emb + 4 + w.stratum + 3 * (2 + Math.floor(w.stratum / 2)) && a.offers.some(o => o.src === 'forge') && b.offers.some(o => o.src === 'forge'), `the won fight pays embers and its pay (${w.run.embers.elites - emb} embers: 4 + s, plus 3 elite kills)`);
  ok(msgs(w, 'toast').filter(m => /gold/.test(m.text)).length === 2, 'each hero is told what the fight paid');
}

// ---------------- personal dialog ----------------
{
  const w = world(31, 2);
  enterEvent(w, 'altar');
  const pr = w.props.find(x => x.ev === 'altar'), a = w.players.get('p0'), b = w.players.get('p1');
  ok(pr && pr.kind === 'altar' && pr.text && pr.group, 'the text event stands as a prop with its look, prompt and group');
  ok(w.room.event === 'altar' && w.patches[w.room.id].event === 'altar', 'the identity rides a room patch');
  use(w, 'p0', pr);
  const op = msgs(w, 'evOpen', 'p0')[0];
  ok(op && op.v === 0 && op.lock === 0.6 && op.s === ED.EVENTS.altar.safe && op.ch.length === 3 && op.ch.every(c => c.length === 3) && op.title === 'Blood Altar', 'a personal dialog opens for that hero only, with the 0.6 s lock');
  ok(!msgs(w, 'evOpen', 'p1').length, 'not for the other hero');
  w.msgs.length = 0;
  w.evChoice('p0', 0, op.k + 1); ok(!msgs(w, 'evResult').length && w.ev.dlg.p0, 'a stale key is ignored');
  a.hp = a.maxHp;
  w.evChoice('p0', 0, op.k);
  const res = msgs(w, 'evResult', 'p0')[0];
  ok(res && res.o === 1 && res.out.some(l => /epic/.test(l)) && a.offers.some(o => o.src === 'epic') && a.hp < a.maxHp, `the choice resolves: blood paid, an epic offer, the result says so (${res && res.out})`);
  ok(msgs(w, 'claimed', 'p0').length === 1 && !pr.state, 'the hero is marked claimed; the prop stays for the other hero');
  w.msgs.length = 0; use(w, 'p0', pr); ok(msgs(w, 'toast', 'p0').length === 1 && !msgs(w, 'evOpen').length, 'a hero chooses once');
  use(w, 'p1', pr); const ob = msgs(w, 'evOpen', 'p1')[0];
  w.evChoice('p1', 2, ob.k);
  ok(pr.state === 1, 'the prop is spent once every hero chose');
  // a disabled choice cannot be taken
  const v = world(32); enterEvent(v, 'gamble'); v.gold = 0;
  const gp = v.props.find(x => x.ev === 'gamble'); use(v, 'p0', gp);
  const go = msgs(v, 'evOpen', 'p0')[0];
  ok(go.ch[0][2] === 1 && go.ch[1][2] === 1 && go.ch[2][2] === 0, 'unaffordable choices are greyed out');
  v.evChoice('p0', 0, go.k); ok(!!v.ev.dlg.p0 && !msgs(v, 'evResult').length, 'a greyed-out choice is refused');
  // leaving the room closes an open dialog
  v.msgs.length = 0; const nxt = v.room.exits[0]; v.enterRoom(nxt, 'n0');
  ok(msgs(v, 'evClose', 'p0').length === 1 && v.ev === null, 'leaving closes the open dialog');
}

// ---------------- party vote: majority, timeout, tie-break ----------------
{
  const vote = (seed, k, votes, wait) => {
    const w = world(seed, k);
    enterEvent(w, 'trial');
    const pr = w.props.find(x => x.ev === 'trial');
    use(w, 'p1', pr);
    const vt = w.ev.vote;
    for (const [pid, i] of votes) w.evChoice(pid, i, vt.k);
    for (let t = 0; t < (wait || 0) * 60 && w.ev && w.ev.vote; t++) w.update(1 / 60);
    if (w.ev && w.ev.vote) w.update(1 / 60);
    return { w, vt, pr };
  };
  { const { w, vt } = vote(41, 3, [['p0', 0], ['p1', 0], ['p2', 1]]);
    ok(vt.pids.length === 3 && w.locked && w.enc && w.enc.kind === 'trial', 'majority: two of three take the trial, the fight starts');
    ok(msgs(w, 'evTally').length === 9, 'each vote is told to every voter'); }
  { const { w } = vote(42, 2, [['p1', 1]]);
    ok(w.ev.vote && !w.locked, 'one of two voted: the vote waits'); }
  { const { w } = vote(42, 2, [['p1', 0]], 15.2);
    ok(!w.ev.vote && !w.locked, 'after 15 s the missing vote counts as the safe choice (Leave): a tie 1-1 goes to the host\'s safe vote'); }
  { const { w } = vote(43, 2, [['p0', 0], ['p1', 1]]);
    ok(w.locked, 'a 1-1 tie goes to the host (slot 0): the trial'); }
  { const { w, pr } = vote(44, 2, [['p0', 1], ['p1', 1]]);
    ok(!w.locked && pr.state === 1 && msgs(w, 'evResult').length === 2, 'both leave: the prop is spent, both see the result'); }
  { const w = world(45, 2); enterEvent(w, 'trial'); const pr = w.props.find(x => x.ev === 'trial'); use(w, 'p0', pr);
    w.players.get('p1').dead = true; w.evChoice('p0', 1, w.ev.vote.k); w.update(1 / 60);
    ok(!w.ev.vote, 'a dead voter is not waited for'); }
}

// ---------------- bots ----------------
{
  const w = world(51, 2);
  enterEvent(w);
  ok(w.ev && E.def(w.ev.id) && w.room.event === w.ev.id, `a drawn event (${w.ev && w.ev.id})`);
  for (let k = 0; k < 20; k++) for (const p of w.players.values()) {
    for (const pr of w.props) if (pr.ev && E.botWant(w, p, pr) > 0) use(w, p.pid, pr);
    E.botAnswer(w, p);
    w.update(1 / 60);
  }
  const pr = w.props.find(x => x.ev);
  ok(!pr || pr.state === 1 || w.locked, `bots resolve the event (${w.ev && w.ev.id})`);
}

// ---------------- patchRoom: host and client mirror agree ----------------
{
  const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
  if (!ED.Net) load('net.js');
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : stub()), apply: () => stub() });
  for (const k of ['FX', 'Render', 'UI', 'HUD', 'Input', 'Audio', 'AimFx']) if (!ED[k]) ED[k] = stub();
  load('game.js');
  const N = ED.Net, G = ED.Game;
  const w = world(61);
  const m = new G.Mirror({ pact: 0, players: [hero(0)] }, 'p0');
  const wire = (s) => JSON.parse(JSON.stringify(s));
  m.apply(wire(N.encodeSnap(w, [], true)), 0);
  const ahead = E.ahead(w), fight = ahead.find(r => r.type === 'combat' && !r.dark), ev = ahead.find(r => r.type === 'event'), other = ahead.find(r => r.type === 'combat' && r !== fight && !r.dark);
  const sig0 = N.propSig(w);
  ok(w.patchRoom(fight.id, { type: 'elite' }), 'patch a fight ahead into an elite room');
  ok(N.propSig(w) !== sig0, 'a patch changes the prop signature (a full snapshot follows)');
  if (ev) ok(w.patchRoom(ev.id, { reveal: 1 }) && !!ev.event, 'reveal an event room ahead: its identity is drawn');
  if (other) { w.patchRoom(other.id, { reward: 'gold' }); w.patchRoom(other.id, { type: 'shop' }); w.patchRoom(other.id, { type: 'rest' }); }
  ok(!w.patchRoom(w.roomId, { type: 'shop' }), 'the current (visited) room refuses a patch');
  ok(!w.patchRoom(w.floor.boss, { type: 'shop' }), 'the boss room refuses a patch');
  const same = (r, q) => r.type === q.type && r.w === q.w && r.h === q.h && r.reward === q.reward && (r.event || null) === (q.event || null) && r.threat === q.threat && JSON.stringify(r.doors) === JSON.stringify(q.doors) && Array.from(r.tiles).join('') === Array.from(q.tiles).join('') && r.decor.length === q.decor.length && r.breakables.length === q.breakables.length;
  ok(fight.type === 'elite' && fight.threat >= 2 && (fight.reward === 'relic' || fight.reward === 'epic') && !fight.dark, `the elite room is rebuilt: threat ${fight.threat}, reward ${fight.reward}`);
  if (other) ok(other.type === 'rest' && other.reward === null && other.h === 11, 'a second type starts over: the rest site has no reward and its own height');
  m.apply(wire(N.encodeSnap(w, [], true)), 0.05);
  let diff = 0;
  for (const r of w.floor.rooms) if (!same(r, m.floor.rooms[r.id])) diff++;
  ok(diff === 0, `the client mirror's floor equals the host's after a full snapshot (${diff} rooms differ)`);
  const again = m.floor.rooms[fight.id].tiles;
  m.apply(wire(N.encodeSnap(w, [], true)), 0.1);
  ok(m.floor.rooms[fight.id].tiles === again, 'an unchanged patch is not applied twice');
  // the route: a new floor clears the patches
  w.enterStratum(2);
  ok(Object.keys(w.patches).length === 0, 'a new stratum starts without patches');
  // late reader: a fresh mirror built from one full snapshot
  const w2 = world(62), f2 = E.ahead(w2).find(r => r.type === 'combat' && !r.dark);
  w2.patchRoom(f2.id, { type: 'treasure' });
  const m2 = new G.Mirror({ pact: 0, players: [hero(0)] }, 'p0');
  m2.apply(wire(N.encodeSnap(w2, [], true)), 0);
  ok(same(w2.floor.rooms[f2.id], m2.floor.rooms[f2.id]) && m2.floor.rooms[f2.id].type === 'treasure', 'a mirror that joins late reads every patch from one full snapshot');
  // event props reach the mirror with their def id
  enterEvent(w2, 'coffer');
  m2.apply(wire(N.encodeSnap(w2, [], true)), 0.1);
  ok(m2.props.some(x => x.ev === 'coffer' && x.kind === 'chest'), 'an event prop reaches the client with its def id (O[11])');
}

// ---------------- determinism ----------------
{
  const play = (seed) => {
    const w = world(seed, 2), out = [];
    for (let s = 1; s <= 2; s++) {
      for (let i = 0; i < 3; i++) {
        const r = w.floor.rooms.find(x => x.type === 'event' && !w.roomState[x.id].visited);
        if (!r) break;
        w.enterRoom(r.id, 's');
        const pr = w.props.find(x => x.ev);
        out.push(w.ev && w.ev.id, JSON.stringify(w.ev && w.ev.v));
        if (pr) { for (const p of w.players.values()) { if (E.botWant(w, p, pr)) use(w, p.pid, pr); E.botAnswer(w, p); } w.update(1 / 60); }
        out.push(w.gold, [...w.players.values()].map(p => p.relics.join() + '/' + p.maxHp + '/' + Math.round(p.hp)).join(';'));
        w.locked = false; w.enc = null; w.enemies.length = 0;
      }
      w.enterStratum(s + 1);
    }
    return out.join('|');
  };
  ok(play(71) === play(71), 'the same seed and choices give the same events, rolls and outcomes');
  ok(play(71) !== play(72), 'another seed differs');
}

// ---------------- save: lore ----------------
{
  const p = S.defaultProfile();
  ok(p.lore === 0 && !S.loreHas(p, 0), 'a fresh profile has no lore');
  ok(S.loreAdd(p, 3) && !S.loreAdd(p, 3) && S.loreHas(p, 3), 'a page is added once');
  S.loreAdd(p, ED.LORE.length - 1);
  const q = S.decode(S.encode(p));
  ok(S.loreHas(q, 3) && S.loreHas(q, ED.LORE.length - 1) && !S.loreHas(q, 4) && q.lore === p.lore, 'lore survives the save code');
  ok(S.normalize({ lore: -5 }).lore === 0 && S.normalize({ lore: 'x' }).lore === 0 && S.normalize({ lore: 2 ** 40 }).lore === 0, 'junk lore masks are cleared');
  const r = S.applyRun(S.defaultProfile(), { cls: 'knight', stratum: 1, roomsCleared: 1, embers: { rooms: 1, elites: 0, bosses: 0, victory: 0 }, lore: [0, 2, 2, 999] });
  ok(r.unlocks.filter(u => /^Codex: /.test(u)).length === 2, `a run's pages join the Codex once each (${r.unlocks})`);
}

console.log(`${n - fails}/${n} event checks passed`);
if (fails) process.exit(1);
