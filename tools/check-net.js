// Co-op net check (exit 1 on failure). Host and client game sessions (ED.Game.Session) and parties (ED.Net.Party) run in one process over a fake transport
// (one-way latency 40 ms + 0-25 ms jitter, ordered; control messages go through JSON, binary messages are copied). Usage: node tools/check-net.js
// 1. Lobby: host, join, hero change, ready, stage; start builds the run on both peers.
// 2. 60 s co-op run (god cheat), scripted inputs on both heroes (walk, dash, Q / E, card picks by key): client foes match the host's within tolerance at render time,
//    nearly every host foe inside the client's view is shown, own-hero prediction corrections stay small, vitals / weapons / level match, offers resolve.
// 3. Downed / revive reach the client. 4. A late join is refused. 5. The host leaving ends the client's run with a note; a client quitting drops its hero on the host.
// 6. Snapshot bytes at 300 / 900 foes (+600 projectiles, 400 gems, a busy event window): reported; gate <= 12 KB at 900 (ARCHITECTURE §11); decode round trip exact to 0.25 px.
// 7. Late-game zones: 4 heroes with 6 evolved weapons each (thornwood / wrath / plague / stormcrown fields), max passives, 900 foes, 3 clients: every snapshot <= 12 KB;
//    client 1's mirrored zones equal the host's in-rect zones at every snapshot. 8. A client's banish reaches it as a new offer.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load } = require('./sim.js');
const ED = load(), U = ED.U, C = ED.CONST;
// client-side stubs (no DOM): FX / audio / render are not under test
ED.FX = { handle() {}, clear() {} }; ED.Render = { crowd: 0, bw: 641, bh: 361 }; ED.AimFx = { point: (me, inp) => ({ wx: inp.ax, wy: inp.ay }) };
for (const f of ['net.js', 'game.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
const N = ED.Net;
{ const r = U.RNG(4242); Math.random = r.next; } // party codes and pids: same every run
const GATE = 12 * 1024;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const t0 = Date.now();

// ---------------- fake transport (simulated clock) ----------------
let simMs = 0;
const jr = U.RNG(77), queue = [];
const later = (ms, fn) => { queue.push({ at: simMs + ms, fn, n: queue.length }); };
const pump = () => { queue.sort((a, b) => a.at - b.at || a.n - b.n); while (queue.length && queue[0].at <= simMs) queue.shift().fn(); };
const LAT = 40, JITTER = 25;
function endpoint(id) { return { id, _data: [], _close: [], closed: false, last: 0, onData(f) { this._data.push(f); }, onClose(f) { this._close.push(f); }, busy: () => false }; }
function pair() {
  const a = endpoint('client'), b = endpoint('host'), bytes = { up: 0, down: 0 };
  const wire = (from, to, dir) => {
    from.send = (o) => {
      if (from.closed) return;
      const bin = o instanceof ArrayBuffer, d = bin ? o.slice(0) : JSON.stringify(o);
      bytes[dir] += bin ? o.byteLength : d.length;
      const at = Math.max(from.last, simMs + LAT + jr.next() * JITTER); from.last = at; // ordered channel
      queue.push({ at, n: queue.length, fn: () => { if (!to.closed) for (const f of to._data) f(bin ? d : JSON.parse(d)); } });
    };
    from.close = () => {
      if (from.closed) return;
      from.closed = true; for (const f of from._close) f();
      later(LAT, () => { if (to.closed) return; to.closed = true; for (const f of to._close) f(); });
    };
  };
  wire(a, b, 'down'); wire(b, a, 'up'); // a lives on the host (sends down), b on the client
  return { hostSide: a, clientSide: b, bytes };
}
const hosts = {}, links = [];
N.useTransport({
  host(code, h) { hosts[code] = h; later(5, () => h.open && h.open(code)); return { close() { delete hosts[code]; } }; },
  join(code, h) {
    later(LAT, () => { const H = hosts[code]; if (!H) { h.error && h.error({ type: 'peer-unavailable' }); return; } const p = pair(); links.push(p); H.conn(p.hostSide); h.open(p.clientSide); });
    return { close() {} };
  },
});
const pumpFor = (ms, each) => { const end = simMs + ms; while (simMs < end) { simMs += 1000 / 60; if (each) each(); pump(); } };

// ---------------- 1. lobby ----------------
const gH = new ED.Game.Session(), gC = new ED.Game.Session();
const cbH = { errors: [] }, cbC = { errors: [], closed: [] };
cbH.onError = (m) => cbH.errors.push(m); cbC.onError = (m) => cbC.errors.push(m); cbC.onClosed = (m) => cbC.closed.push(m);
const pH = new N.Party(gH, cbH), pC = new N.Party(gC, cbC);
let endH = null, endC = null;
gH.onEnd = (s) => { endH = s; }; gC.onEnd = (s) => { endC = s; };
const code = pH.host('Hosty', 'knight');
pumpFor(100);
ok(pH.lobby.status === 'open' && pH.lobby.code === code && pH.lobby.members.length === 1, 'host lobby open (' + code + ')');
pC.join(code, 'Guesty', 'ranger');
pumpFor(300);
ok(pC.lobby.status === 'open' && pC.lobby.me && pH.lobby.members.length === 2 && pC.lobby.members.length === 2, 'client joined: both lobbies list 2 members');
pC.setHero('pyro'); pumpFor(200);
ok(pH.lobby.members[1].cls === 'pyro' && pC.lobby.members[1].cls === 'pyro', 'hero change reaches both lobbies');
ok(!pH.lobby.canStart && !pH.start(), 'start refused while the guest is not ready');
pC.setReady(true); pH.setStage(1); pumpFor(200);
ok(pH.lobby.canStart && pC.lobby.stage === 1 && pC.lobby.members[1].ready, 'ready + stage reach both lobbies; host can start');
pH.setStage(0); pumpFor(100);
ok(pH.start({ god: true }, 2024), 'host starts the run');
pumpFor(200, () => { gH.update(1 / 60); gC.update(1 / 60); });
ok(gH.mode === 'host' && gC.mode === 'client' && pC.lobby.inRun && gC.view && gC.mir.ready, 'both peers run (client mirror has snapshots)');
const w = gH.w, hostHero = w.hero('host'), cliPid = pC.lobby.me, cliHero = w.hero(cliPid);
ok(!!cliHero && cliHero.cls === 'pyro' && gC.view.props.obstacles.length === w.arena.obstacles.length, 'client hero exists on the host; arena rebuilt from the seed');

// ---------------- 2. 60 s run ----------------
const drive = (p, t, slot) => {
  const a = t * (0.6 + 0.3 * slot) + slot * 2;
  return { mx: Math.cos(a), my: Math.sin(a), ax: p.x + Math.cos(a * 1.3) * 90, ay: p.y + Math.sin(a * 1.3) * 90, dash: false, q: false, e: false, pick: 0, reroll: false, skip: false, esc: false };
};
const RING = 40, ring = []; // host foe positions per tick
const record = () => {
  let r = ring[w.tick % RING];
  if (!r) r = ring[w.tick % RING] = { tick: -1, map: new Map() };
  r.tick = w.tick; r.map.clear(); r.kills = w.kills; r.level = w.level; r.gold = w.gold; r.hp = cliHero.hp;
  for (const e of w.foes) if (!e.dead) r.map.set(e.id, [e.x, e.y]);
};
const hostAt = (tick) => { const r = ring[tick % RING]; return r && r.tick === tick ? r.map : null; };
const errs = [], cover = { seen: 0, want: 0 };
let checks = 0, frames = 0, hostPicks = 0, cliPicks = 0, maxCliBytes = 0, sumCliBytes = 0, nSnap = 0, cliDash = 0;
gH.onEvent = (ev) => { if (ev.t === 'pick' && ev.pid === cliPid && ev.kind !== 'skip') cliPicks++; if (ev.t === 'pick' && ev.pid === 'host') hostPicks++; };
gC.onEvent = (ev) => { if (ev.t === 'dash' && ev.pid === cliPid) cliDash++; };
const fr = U.RNG(5);
let cliDebt = 0;
const runFor = (sec, opt) => {
  opt = opt || {};
  const end = simMs + sec * 1000;
  while (simMs < end) {
    const dt = 1 / 60;
    simMs += dt * 1000; frames++;
    const t = simMs / 1000;
    // host frame
    const hi = drive(hostHero, t, 0);
    if (opt.hostTo) { const q = opt.hostTo(); hostHero.x = q.x; hostHero.y = q.y; hi.mx = hi.my = 0; }
    hi.dash = frames % 240 === 17; hi.q = frames % 400 === 50; hi.e = frames % 660 === 90; hi.pick = hostHero.offer ? 1 : 0;
    if (opt.crowd && frames % 20 === 0) { const sr = U.RNG(frames); for (let k = 0; k < 40 && w.foes.length < opt.crowd; k++) { const a = sr.next() * U.TAU, d = 120 + sr.next() * 380, x = cliHero.x + Math.cos(a) * d, y = cliHero.y + Math.sin(a) * d; if (!ED.Arena.blocked(w.arena, x, y, 8)) w.spawnFoe(ED.FOE_IDS[sr.int(0, 4)], x, y, { hpMul: 3 }); } }
    gH.control(hi); gH.update(dt); record();
    // client frame (uneven frame times, same average)
    cliDebt += dt;
    const cdt = Math.min(cliDebt, dt * (0.7 + 0.6 * fr.next()));
    cliDebt -= cdt;
    const me = gC.view.me;
    if (me) {
      const ci = opt.still ? { mx: 0, my: 0, ax: me.x + 50, ay: me.y, dash: false, q: false, e: false, pick: 0, reroll: false, skip: false } : drive(me, t, 1);
      if (!opt.still) { ci.dash = frames % 180 === 33; ci.q = frames % 420 === 70; ci.e = frames % 700 === 100; ci.pick = me.offer ? 1 + (frames % 3) % me.offer.length : 0; }
      gC.control(ci);
    }
    gC.update(cdt);
    pump();
    const s = gC.mir.bytes; if (s && gC.stats.snaps !== nSnap) { nSnap = gC.stats.snaps; sumCliBytes += s; if (s > maxCliBytes) maxCliBytes = s; }
    // compare client foes with the host at the client's render time (after 5 s, every 0.5 s)
    if (opt.compare && t > 5 && frames % 30 === 0) {
      const rt = gC.rt, tk = rt / C.TICK, t0i = Math.floor(tk), fa = tk - t0i, A = hostAt(t0i), B = hostAt(t0i + 1), old = hostAt(t0i - 4);
      if (A && B && old) {
        checks++;
        const shown = new Set();
        for (const e of gC.view.foes) {
          shown.add(e.id);
          const a = A.get(e.id), b = B.get(e.id);
          if (!a || !b) continue;
          errs.push(Math.hypot(e.x - (a[0] + (b[0] - a[0]) * fa), e.y - (a[1] + (b[1] - a[1]) * fa)));
        }
        const cx = gC.view.me.x, cy = gC.view.me.y;
        for (const [id, p] of A) if (old.has(id) && B.has(id) && Math.abs(p[0] - cx) < C.VIEW_W / 2 && Math.abs(p[1] - cy) < C.VIEW_H / 2) { cover.want++; if (shown.has(id)) cover.seen++; }
      }
    }
  }
};
runFor(38, { compare: true, crowd: 500 });
// downed: the host knocks the client hero down (god off for one hit), the client must see it, then the host stands on it until it revives
w.cheats.god = false; cliHero.invuln = 0; cliHero.dashT = 0; w.hurtHero(cliHero, 1e6); w.cheats.god = true;
ok(cliHero.downed, 'host: client hero downed');
runFor(0.6);
ok(gC.view.me.downed && gC.view.me.bleed > 0 && gC.view.me.bleed <= 20, `client sees itself downed (bleed ${gC.view.me.bleed.toFixed(1)} s)`);
runFor(3.5, { hostTo: () => ({ x: cliHero.x + 12, y: cliHero.y }) });
ok(!cliHero.downed && !cliHero.dead && !gC.view.me.downed && gC.view.me.hp > 0, `revived on the host and on the client (hp ${Math.round(gC.view.me.hp)})`);
runFor(18, { compare: true, crowd: 500 });
// settle with no input: prediction must land exactly on the host
runFor(1.5, { still: true });
const me = gC.view.me;
errs.sort((a, b) => a - b);
const med = errs[errs.length >> 1] || 0, p95 = errs[Math.floor(errs.length * 0.95)] || 0, pmax = errs[errs.length - 1] || 0;
ok(checks > 50 && errs.length > 2000, `compared ${errs.length} foe positions over ${checks} moments`);
ok(med <= 1 && p95 <= 4, `client foes vs host at render time: median ${med.toFixed(2)} px, p95 ${p95.toFixed(2)} px, max ${pmax.toFixed(1)} px`);
ok(cover.want > 0 && cover.seen / cover.want >= 0.99, `foes inside the client view shown: ${cover.seen} / ${cover.want}`);
const st = gC.stats, mean = st.corrSum / Math.max(1, st.corrN);
ok(st.corrN > 500 && mean <= 1 && st.corrBig / st.corrN <= 0.05, `own-hero prediction: ${st.corrN} reconciliations, mean correction ${mean.toFixed(3)} px, max ${st.corrMax.toFixed(1)} px, > 2 px: ${st.corrBig}, snaps ${st.snapsTaken}`);
ok(Math.hypot(me.x - cliHero.x, me.y - cliHero.y) < 0.01, `idle client hero sits on the host position (off by ${Math.hypot(me.x - cliHero.x, me.y - cliHero.y).toFixed(4)} px)`);
ok(cliDash >= 10, `client dashes predicted locally (${cliDash})`);
const atSnap = ring[Math.round(gC.mir.T / C.TICK) % RING];
ok(atSnap && atSnap.tick === Math.round(gC.mir.T / C.TICK) && Math.abs(me.hp - atSnap.hp) < 0.01 && me.maxHp === cliHero.maxHp && gC.view.level === atSnap.level && gC.view.kills === atSnap.kills && gC.view.gold === atSnap.gold, `vitals / level / kills / gold match the host at the snapshot tick (lv ${w.level}, kills ${w.kills})`);
const sig = (p) => p.weapons.map(x => x.id + x.lvl).join(',') + '|' + p.passives.map(x => x.id + x.lvl).join(',') + '|' + p.skills.map(x => x.id + x.lvl).join(',');
ok(sig(me) === sig(cliHero), 'client hero weapons / passives / skills match the host: ' + sig(me));
ok(cliPicks >= 5 && hostPicks >= 5 && !cliHero.pend, `co-op level-ups resolve without pause (client picks ${cliPicks}, host picks ${hostPicks}, client pending ${cliHero.pend})`);
ok(gH.rem.get(cliPid).ack > 3000, `host consumed client inputs (ack ${gH.rem.get(cliPid).ack})`);
const avgB = sumCliBytes / Math.max(1, nSnap);
console.log(`     snapshots ${nSnap} in ${(simMs / 1000).toFixed(0)} s sim, avg ${(avgB / 1024).toFixed(2)} KB, max ${(maxCliBytes / 1024).toFixed(2)} KB; link down ${(links[0].bytes.down / 1024 / (simMs / 1000)).toFixed(1)} KB/s, up ${(links[0].bytes.up / 1024 / (simMs / 1000)).toFixed(2)} KB/s`);
ok(maxCliBytes <= GATE, 'live snapshots <= 12 KB');

// ---------------- 4. late join ----------------
const gX = new ED.Game.Session(), cbX = { errors: [] }; cbX.onError = (m) => cbX.errors.push(m);
const pX = new N.Party(gX, cbX);
pX.join(code, 'Late', 'knight');
runFor(0.5);
ok(cbX.errors.length === 1 && /already started/.test(cbX.errors[0]) && gX.mode === 'off', 'late join refused: ' + cbX.errors[0]);

// ---------------- 5. host leaves ----------------
pH.leave();
runFor(0.5);
ok(!!endC && endC.note && /closed/.test(endC.note) && endC.perHero.length === 2 && endC.kills > 0, 'host leaving ends the client run with a summary (' + (endC && endC.note) + ')');
ok(pC.lobby.status === 'closed' && !pC.lobby.inRun, 'client party closed');

// client quitting: a fresh pair, 2 s in, the client quits
{
  const gH2 = new ED.Game.Session(), gC2 = new ED.Game.Session(), pH2 = new N.Party(gH2, {}), pC2 = new N.Party(gC2, {});
  let end2 = null; gC2.onEnd = (s) => { end2 = s; };
  const code2 = pH2.host('H2', 'knight'); pumpFor(100); pC2.join(code2, 'C2', 'ranger'); pumpFor(300); pC2.setReady(true); pumpFor(200);
  pH2.start({ god: true });
  const step = (sec) => { const end = simMs + sec * 1000; while (simMs < end) { simMs += 1000 / 60; gH2.update(1 / 60); gC2.update(1 / 60); pump(); } };
  step(2);
  const pid2 = pC2.lobby.me;
  gC2.quit();
  step(0.5);
  const h2 = gH2.w.hero(pid2);
  ok(end2 && /left/.test(end2.note) && h2.dead && gH2.w.state === 'play' && gH2.w.partyN === 1 && pH2.lobby.members.length === 1, 'client quit: its own results, hero gone on the host, host run continues');
  gH2.quit(); pH2.leave();
}
// host ends a run: the client gets the host's summary and the lobby comes back
{
  const gH3 = new ED.Game.Session(), gC3 = new ED.Game.Session(), pH3 = new N.Party(gH3, {}), pC3 = new N.Party(gC3, {});
  let e3 = null; gC3.onEnd = (s) => { e3 = s; };
  const code3 = pH3.host('H3', 'knight'); pumpFor(100); pC3.join(code3, 'C3', 'necro'); pumpFor(300); pC3.setReady(true); pumpFor(200);
  pH3.start({ god: true });
  const step = (sec) => { const end = simMs + sec * 1000; while (simMs < end) { simMs += 1000 / 60; gH3.update(1 / 60); gC3.update(1 / 60); pump(); } };
  step(3); gH3.quit(); step(0.5);
  ok(e3 && !e3.note && e3.perHero.length === 2 && !pH3.lobby.inRun && !pC3.lobby.inRun && pC3.lobby.status === 'open' && !pH3.lobby.members[1].ready, 'host quits: client gets the host summary, both lobbies back (guest not ready)');
  pH3.leave(); step(0.3);
}

// four heroes: three clients, each with its own culled snapshots, every peer sees all four heroes
{
  const gs = [0, 1, 2, 3].map(() => new ED.Game.Session()), ps = gs.map(g => new N.Party(g, {}));
  const code4 = ps[0].host('H4', 'knight'); pumpFor(100);
  ['ranger', 'cleric', 'bell'].forEach((cls, i) => ps[i + 1].join(code4, 'C' + i, cls));
  pumpFor(400); for (let i = 1; i < 4; i++) ps[i].setReady(true); pumpFor(200);
  ok(ps[0].lobby.members.length === 4 && ps[0].start({ god: true }), '4-hero party starts');
  const step = (sec) => {
    const end = simMs + sec * 1000;
    while (simMs < end) {
      simMs += 1000 / 60; const t = simMs / 1000;
      gs.forEach((g, i) => { const me = g.view && g.view.me; if (me) g.control(Object.assign(drive(me, t, i), { pick: me.offer ? 1 : 0 })); g.update(1 / 60); });
      pump();
    }
  };
  step(10);
  const w4 = gs[0].w;
  const good = gs.slice(1).every(g => g.mode === 'client' && g.view.heroes.length === 4 && g.stats.corrSum / Math.max(1, g.stats.corrN) < 1 && Math.hypot(g.view.me.x - w4.hero(g.myPid).x, g.view.me.y - w4.hero(g.myPid).y) < 40);
  ok(good, '4 heroes: every client sees 4 heroes, predicts its own (mean corrections ' + gs.slice(1).map(g => (g.stats.corrSum / Math.max(1, g.stats.corrN)).toFixed(3)).join(' / ') + ' px), host bytes ' + gs[0].netStats().clients.map(c => c.bytes).join(' / '));
  gs[0].quit(); step(0.3); ps[0].leave(); step(0.3);
}

// ---------------- 6. snapshot bytes ----------------
function scene(n, spread) {
  const W2 = new ED.World({ seed: 42, stage: 0, players: [{ pid: 'host', name: 'H', slot: 0, cls: 'ranger', meta: { shop: {}, sigs: [] } }, { pid: 'c', name: 'C', slot: 1, cls: 'knight', meta: { shop: {}, sigs: [] } }], cheats: { god: true } });
  for (const row of W2.sdef.timeline) row.rate = 0;
  W2.sp.swarmT = W2.sp.eliteT = Infinity; W2.sdef = Object.assign({}, W2.sdef, { bosses: [] });
  const p = W2.heroes[0], c = W2.heroes[1], rng = U.RNG(9), ids = ['bat', 'skeleton', 'slime', 'skelknight', 'bonearcher'];
  for (const id of ['knight', 'pyro', 'necro', 'cleric', 'bell']) W2.addWeapon(p, ED.HEROES[id].sig);
  for (const ws of p.weapons) ws.lvl = 8;
  const top = () => {
    while (W2.foes.length < n) { const x = c.x + spread(rng, 'x'), y = c.y + spread(rng, 'y'); if (!ED.Arena.blocked(W2.arena, x, y, 8)) W2.spawnFoe(ids[rng.int(0, ids.length - 1)], x, y, { hpMul: 400 }); }
    while (W2.projs.length < 600) { const a = rng.next() * U.TAU; W2.shoot(p, 'longbow', p.x + Math.cos(a) * rng.range(0, 300), p.y + Math.sin(a) * rng.range(0, 300), rng.next() * U.TAU, null, { look: 'arrow', dmg: 5, speed: 120, pierce: 9999, rehit: 0.5, life: 4 }); }
    let gems = 0; for (const g of W2.pickups) if (g.k[0] === 'x') gems++;
    while (gems < 400) { const a = rng.next() * U.TAU, d = 120 + rng.next() * 900; W2.spawnPickup('xp1', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1); gems++; }
  };
  const cc = { idx: 1, vw: 641, vh: 361, ack: 0, seq: 0, pidIdx: { host: 0, c: 1 }, evs: [], carry: [] };
  let max = 0, sum = 0, cnt = 0, buf = null, encMs = 0;
  for (let i = 0; i < 180; i++) {
    top(); W2.input('host', { mx: 0, my: 0, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 }); W2.input('c', { pick: c.offer ? 1 : 0 });
    W2.update(C.TICK);
    for (const ev of W2.events) cc.evs.push(ev);
    W2.events.length = 0;
    if (i % 3 === 2) { const q = process.hrtime.bigint(); cc.seq++; buf = N.encodeSnap(W2, cc); encMs += Number(process.hrtime.bigint() - q) / 1e6; cc.evs.length = 0; if (i > 60) { sum += buf.byteLength; cnt++; max = Math.max(max, buf.byteLength); } }
  }
  return { W2, c, cc, buf, max, avg: sum / cnt, encMs: encMs / 60 };
}
const disc = (r) => { let a = 0, d = 0; return (rng, ax) => { if (ax === 'x') { a = rng.next() * U.TAU; d = 30 + Math.sqrt(rng.next()) * r; return Math.cos(a) * d; } return Math.sin(a) * d; }; };
const rect = (rng, ax) => (ax === 'x' ? rng.range(-470, 470) : rng.range(-330, 330));
for (const [n, name, sp] of [[300, 'perf layout', disc(520)], [900, 'perf layout', disc(520)], [900, 'all in view', rect]]) {
  const r = scene(n, sp);
  console.log(`     ${String(n).padStart(3)} foes (${name}): snapshot avg ${(r.avg / 1024).toFixed(2)} KB, max ${(r.max / 1024).toFixed(2)} KB, encode ${r.encMs.toFixed(3)} ms`);
  if (n === 900) ok(r.max <= GATE, `${name}: 900-foe snapshots <= 12 KB (max ${(r.max / 1024).toFixed(2)} KB)`);
  if (n === 900 && name === 'all in view') {
    // decode round trip: every foe / projectile / pickup inside the rect arrives within 0.25 px
    const M = new N.Mirror({ stage: 0, seed: 42, roster: [{ pid: 'host', slot: 0, name: 'H', cls: 'ranger' }, { pid: 'c', slot: 1, name: 'C', cls: 'knight' }], myPid: 'c' });
    const cc1 = Object.assign({}, r.cc, { seq: r.cc.seq + 1, zc: null, evs: [], carry: [] }), buf = N.encodeSnap(r.W2, cc1), T = M.apply(buf); // fresh client: zones are sent in full
    M.frame(T);
    const byId = new Map(); for (const e of r.W2.foes) byId.set(e.id, e);
    let bad = 0; for (const e of M.view.foes) { const h = byId.get(e.id); if (!h || Math.abs(h.x - e.x) > 0.25 || Math.abs(h.y - e.y) > 0.25 || h.k !== e.k || h.elite !== e.elite) bad++; }
    const inR = r.W2.foes.filter(e => Math.abs(e.x - r.c.x) < 480 && Math.abs(e.y - r.c.y) < 340).length;
    ok(bad === 0 && M.view.foes.length >= inR && M.view.projs.length > 0 && M.view.pickups.length > 0, `decode round trip: ${M.view.foes.length} foes (${inR} in view), ${M.view.projs.length} projectiles, ${M.view.pickups.length} pickups, mismatches ${bad}`);
    const h = M.view.heroes.find(x => x.pid === 'host');
    ok(h && h.weapons.length === 6 && h.weapons.every(ws => ws.lvl === 8), 'hero weapon table decodes');
    // braziers: broken and relit states both reach the client (bitmask)
    const HB = r.W2.arena.braziers, MB = M.view.props.braziers, same = () => HB.every((b, i) => MB[i].broken === b.broken && MB[i].hp === (b.broken ? 0 : 1));
    const snap = () => { cc1.seq++; cc1.evs.length = 0; M.frame(M.apply(N.encodeSnap(r.W2, cc1))); };
    HB.forEach((b, i) => { if (i % 3 === 0) { b.broken = true; b.hp = 0; } }); snap();
    const brokeOk = same() && MB.some(b => b.broken);
    HB.forEach(b => { b.broken = false; b.hp = 1; }); snap();
    ok(brokeOk && same() && MB.every(b => !b.broken), `braziers: ${HB.length} decode broken, then relit`);
  }
}

// ---------------- 7. late-game zones ----------------
{
  const SETS = [['stormcrown', 'plague', 'starfall', 'barrage', 'whirlwind', 'sunwheel'], ['thornwood', 'hail', 'glacier', 'avalanche', 'choir', 'impaler'],
    ['wrath', 'inferno', 'bonestorm', 'cathedral', 'shadowfan', 'twinmoons'], ['thornwood', 'wrath', 'plague', 'stormcrown', 'starfall', 'barrage']];
  const cls = ['knight', 'ranger', 'pyro', 'cleric'];
  const W3 = new ED.World({ seed: 11, stage: 0, players: cls.map((c, i) => ({ pid: 'p' + i, name: 'P' + i, slot: i, cls: c, meta: { shop: {}, sigs: [] } })), cheats: { god: true } });
  W3.heroes.forEach((p, i) => {
    p.weapons.length = 0;
    for (const id of SETS[i]) { const ws = W3.addWeapon(p, id); if (ws) ws.lvl = 8; }
    for (const id of ['might', 'reach', 'duration', 'multishot', 'haste', 'velocity']) p.passives.push({ id, lvl: ED.PASSIVES[id].max });
    W3.recalc(p, true);
  });
  for (const row of W3.sdef.timeline) row.rate = 0;
  W3.sp.swarmT = W3.sp.eliteT = Infinity; W3.sdef = Object.assign({}, W3.sdef, { bosses: [] });
  const rng = U.RNG(3), ids = W3.sdef.timeline[W3.sdef.timeline.length - 1].roster.map(r => r[0]).filter(id => ED.FOES[id] && !ED.FOES[id].boss);
  const top = () => { let k = 0; while (W3.foes.length < 900 && k++ < 400) { const p = W3.heroes[rng.int(0, 3)], a = rng.next() * U.TAU, d = 60 + Math.sqrt(rng.next()) * 380, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; if (!ED.Arena.blocked(W3.arena, x, y, 8)) W3.spawnFoe(ids[rng.int(0, ids.length - 1)], x, y, { hpMul: 1 }); } };
  const pidIdx = {}; W3.heroes.forEach((p, i) => { pidIdx[p.pid] = i; });
  const ccs = [1, 2, 3].map(i => ({ idx: i, vw: 641, vh: 361, ack: 0, seq: 0, pidIdx, evs: null, carry: [] }));
  const M = new N.Mirror({ stage: 0, seed: 11, roster: cls.map((c, i) => ({ pid: 'p' + i, slot: i, name: 'P' + i, cls: c })), myPid: 'p1' });
  const evs = [], byId = new Map();
  let max = 0, sum = 0, cnt = 0, zMax = 0, zSum = 0, snaps = 0, bad = 0, miss = 0, firstBad = '';
  for (let i = 0; i < 900; i++) {
    top();
    W3.heroes.forEach((p, k) => { const a = i / 60 * 0.5 + k * 1.6; W3.input(p.pid, { mx: Math.cos(a) * 0.4, my: Math.sin(a) * 0.4, ax: p.x + 50, ay: p.y, pick: p.offer ? 1 : 0 }); });
    W3.update(C.TICK);
    for (const ev of W3.events) if (ev.t !== 'end') evs.push(ev);
    W3.events.length = 0;
    if (W3.tick % 3) continue;
    for (const cc of ccs) {
      cc.evs = evs; cc.seq++;
      const buf = N.encodeSnap(W3, cc);
      if (i > 180) { sum += buf.byteLength; cnt++; max = Math.max(max, buf.byteLength); }
      if (cc.idx !== 1) continue;
      const T = M.apply(buf); M.frame(T); snaps++;
      byId.clear(); for (const z of W3.zones) if (!z.dead) byId.set(z.id, z);
      const held = cc.zc.map, shown = M.view.zones;
      zMax = Math.max(zMax, held.size); zSum += held.size;
      for (const z of shown) {
        const h = held.has(z.id) && byId.get(z.id);
        const err = !h ? 'not held' : Math.abs(h.x - z.x) > 0.26 || Math.abs(h.y - z.y) > 0.26 ? 'pos' : Math.abs(h.r - z.r) > 0.26 || Math.abs(h.len - z.len) > 0.26 || Math.abs(U.angDiff(h.a, z.a)) > 0.001 ? 'shape'
          : h.k !== z.k || h.wid !== z.wid || !!h.warn !== !!z.warn || (h.team | 0) !== (z.team | 0) ? 'style' : Math.abs(h.t - z.t) > 0.006 && !(z.t >= z.dur - 0.006 && h.t >= h.dur - 0.006) ? 't' : '';
        if (err) { bad++; if (!firstBad) firstBad = `zone ${z.id} (${z.wid || z.k}) ${err}`; }
      }
      if (shown.length !== held.size) miss += Math.abs(held.size - shown.length);
    }
    evs.length = 0;
  }
  console.log(`     late game (4 x 6 evolved weapons, 900 foes): snapshot avg ${(sum / cnt / 1024).toFixed(2)} KB, max ${(max / 1024).toFixed(2)} KB; zones in client 1's rect avg ${(zSum / snaps).toFixed(0)}, max ${zMax}`);
  ok(zMax >= 300, `late game: zone-heavy scene (${zMax} zones in one client's rect)`);
  ok(max <= GATE, `late game: every snapshot <= 12 KB (max ${(max / 1024).toFixed(2)} KB)`);
  ok(bad === 0 && miss === 0, `late game: client zones equal the host's at all ${snaps} snapshots (mismatches ${bad}, count diffs ${miss}${firstBad ? ', first: ' + firstBad : ''})`);
}

// ---------------- 8. banish ----------------
{
  const sent = [], S = new ED.Game.Session();
  S.start({ mode: 'host', seed: 5, stage: 0, myPid: 'host', players: [{ pid: 'host', slot: 0, cls: 'knight' }, { pid: 'c1', slot: 1, cls: 'ranger' }],
    net: { send: (pid, d) => { if (!(d instanceof ArrayBuffer)) sent.push(JSON.parse(JSON.stringify(d))); }, busy: () => false, ended() {} } });
  const w5 = S.w, p = w5.hero('c1');
  p.banishes = 2; w5.addXp(w5.xpNext);
  for (let i = 0; i < 6; i++) S.update(1 / 60);
  const n0 = sent.filter(d => d.t === 'offer').length, before = p.offer.map(c => c.id).join(',');
  w5.input('c1', { banish: 1 });
  for (let i = 0; i < 12; i++) S.update(1 / 60);
  const offers = sent.filter(d => d.t === 'offer'), last = offers[offers.length - 1], now = p.offer.map(c => c.id).join(',');
  ok(n0 === 1 && offers.length === 2 && now !== before && last.cards.map(c => c.id).join(',') === now, `banish resends the offer (${before} -> ${last && last.cards.map(c => c.id).join(',')})`);
  S.quit();
}

console.log(`check-net: ${fails ? fails + ' failure(s)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
