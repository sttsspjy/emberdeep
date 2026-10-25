// In-world minigames (CB-4 kind 'game'): ED.MINIGAMES[id] = { id, name, kind, strata, w, reward, start(w, room), interact(w, p, prop) -> bool, update(w, dt), bot(w, p) -> action | null, hit?(w, p, i) }.
// The event resolver draws a game like any event; on the party's first entry startEvent (events.js) runs start (props + w.ev.game = { id, room, ph, ... }; w.ev.prop = the prop outcome gold drops at), every number rolled there
// from w.rng and shown on the game's props before a hero commits; evInteract runs interact, the world tick's updateEvent runs update. Payouts: ED.Events.outcome.
// Props: { kind 'mg_*', ev: def id, g: snapshot payload (net.js props row O[12]; g.ni = not interactable), v: resend version (net.js propSig) }. A started game ends by itself within GAME_MAX s; walking out of a door skips any game but the locked duel.
// Bot actions: { go: {x, y} walk there, dir: [dx, dy] walk this way, stop: stand, use: prop id to interact within 40 px, atk: {x, y} attack it within reach } (tools/sim.js botGame).
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, T = ED.CONST.TILE;
  const W = ED.World.prototype;
  const MG = ED.MINIGAMES = {};
  const M = ED.Minigames = { GAME_MAX: 60 };

  // The game state of the current room, else null (a game left behind in another room stays inert).
  const game = (w) => { const g = w.ev && w.ev.game; return g && g.room === w.roomId && MG[g.id] ? g : null; };
  M.game = game;
  const byId = (w, id) => w.props.find(x => x.id === id);
  const touch = (pr) => { if (pr) pr.v = (pr.v | 0) + 1; }; // props resend to clients
  const toast = (w, pid, text, info) => w.msgs.push(info ? { to: pid, t: 'toast', text, info: true } : { to: pid, t: 'toast', text });
  const round5 = (v) => Math.max(5, Math.round(v / 5) * 5);
  const near = (p, x, y, d) => U.dist2(p.x, p.y, x, y) <= d * d;
  const addProp = (w, def, kind, at, g, extra) => { const pr = Object.assign({ id: U.uid(), kind, x: at.x, y: at.y, state: 0, ev: def.id, g }, extra); w.props.push(pr); return pr; };
  const heroes = (w) => [...w.players.values()];
  // The living hero of lowest slot plays for the bot party where one hero acts for all.
  const lead = (w) => { let b = null; for (const q of w.players.values()) if (!q.downed && !q.dead && (!b || q.slot < b.slot)) b = q; return b; };
  const setup = (w, g) => { w.ev.game = g; return g; }; // w.ev: created by startEvent (events.js)
  const goldAt = (w, pr) => { w.ev.prop = pr.id; return pr; }; // outcome gold drops at this prop

  // Party stake: false (with a toast) when the party's gold is short.
  function stake(w, p, pr, amt) {
    if (w.gold < amt) { toast(w, p.pid, 'Not enough gold.'); return false; }
    w.gold -= amt;
    w.emit({ t: 'buy', pid: p.pid, x: pr.x, y: pr.y });
    return true;
  }

  // ---------------- hero hits on game targets (w.mgTargets [{ x, y, r, i }], set by the active game; rooms.js smashCircle / smashSeg / smashArc call these) ----------------
  const targets = (w) => { if (!game(w)) w.mgTargets = null; return w.mgTargets; };
  const hitT = (w, p, q) => { const g = game(w), def = g && MG[g.id]; if (p && def && def.hit) def.hit(w, p, q.i); };
  W.mgCircle = function (p, x, y, r) { const ts = targets(this); if (ts) for (const q of ts) if (U.dist2(q.x, q.y, x, y) <= (q.r + r) * (q.r + r)) hitT(this, p, q); };
  W.mgSeg = function (p, x0, y0, x1, y1, r) { const ts = targets(this); if (ts) for (const q of ts) if (U.segDist2(q.x, q.y, x0, y0, x1, y1) <= (q.r + r) * (q.r + r)) hitT(this, p, q); };
  W.mgArc = function (p, a, reach, arc) {
    const ts = targets(this); if (!ts) return;
    for (const q of ts) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d - q.r > reach) continue;
      if (arc < 6.2 && Math.abs(U.angDiff(a, Math.atan2(q.y - p.y, q.x - p.x))) > arc / 2 + Math.atan2(q.r, Math.max(d, 1))) continue;
      hitT(this, p, q);
    }
  };

  // Bot action of the active game for hero p (null: no game, or the game leaves p to its own play).
  M.bot = (w, p) => { const g = game(w); return g ? MG[g.id].bot(w, p) : null; };

  // True when (x, y) lies within m of zone z (a line of len along a, w wide, or a disc of r).
  const inZone = (z, x, y, m) => (z.len > 0 ? U.segDist2(x, y, z.x, z.y, z.x + Math.cos(z.a) * z.len, z.y + Math.sin(z.a) * z.len) < (z.w / 2 + m) ** 2 : U.dist2(x, y, z.x, z.y) < (z.r + m) ** 2);

  // ================= 1. Trap gauntlet (per hero) =================
  // A post at the west wall starts it; a chest stands at the east wall; the band between them (TRAP_X tiles in from each wall, full height) holds one trap per lane of about 72 px:
  // jet (a full-height line), spike (rows of discs, odd and even rows in turn) or blade (strips sweeping down, then up). Each trap warns (a foe-team telegraph, warn s) and strikes at its end:
  // a hero inside takes TRAP_DMG of max health (never below 1 health) and, when the hit lands (no dash, dodge or aegis), counts a hit. A hero who stood west of the band since the start claims the chest
  // once: GAUNT_PRIZE[min(hits, 4)] of gold G and a relic. The run ends at dur s or when every living hero has claimed.
  const TRAP_X = 4, TRAP_DMG = 0.12, GAUNT_PRIZE = [{ g: 1, relic: 'r' }, { g: 1, relic: 'c' }, { g: 1 }, { g: 0.5 }, { g: 0.25 }];
  M.GAUNT_PRIZE = GAUNT_PRIZE;
  const gauntPrize = (g, hits) => { const t = GAUNT_PRIZE[Math.min(hits, GAUNT_PRIZE.length - 1)]; return { gold: Math.round(g.gold * t.g), relic: t.relic }; };
  function trapZone(w, g, z) { z.custom = true; z.team = 1; z.mg = g.key; z.onEnd = trapStrike; return w.addZone(z); }
  function trapStrike(w, z) {
    const g = game(w);
    if (!g || g.key !== z.mg || g.ph !== 1) return;
    for (const p of w.players.values()) {
      if (p.downed || p.dead || !inZone(z, p.x, p.y, p.r * 0.6)) continue;
      const amt = Math.min(p.maxHp * TRAP_DMG, p.hp - 1);
      if (amt <= 0 || w.hurtPlayer(p, amt, { x: z.x, y: z.y })) { g.hits[p.pid] = (g.hits[p.pid] | 0) + 1; const post = byId(w, g.post); post.g.h[p.pid] = g.hits[p.pid]; touch(post); }
    }
    w.emit(z.len > 0 ? { t: 'mg', k: 'trap', x: Math.round(z.x), y: Math.round(z.y), x1: Math.round(z.x + Math.cos(z.a) * z.len), y1: Math.round(z.y + Math.sin(z.a) * z.len) } : { t: 'mg', k: 'trap', x: Math.round(z.x), y: Math.round(z.y), r: z.r });
  }
  function fireTrap(w, g, tr) {
    const [, , y0, y1] = g.field, W_ = g.warn;
    if (tr.k === 'jet') trapZone(w, g, { kind: 'teleLine', x: tr.x, y: y0, a: Math.PI / 2, len: y1 - y0, w: 26, dur: W_ });
    else if (tr.k === 'spike') {
      const n = Math.floor((y1 - y0) / 44);
      for (let i = tr.n & 1; i < n; i += 2) trapZone(w, g, { kind: 'tele', x: tr.x, y: y0 + 22 + i * 44, r: 21, dur: W_ });
    } else {
      const n = Math.floor((y1 - y0) / 40), down = !(tr.n & 1);
      for (let i = 0; i < n; i++) { const j = down ? i : n - 1 - i; trapZone(w, g, { kind: 'teleLine', x: tr.x - tr.w / 2, y: y0 + 20 + j * 40, a: 0, len: tr.w, w: 34, dur: W_ + i * 0.22 }); }
    }
  }
  function gauntEnd(w, g) {
    g.ph = 2;
    for (const z of w.zones) if (z.mg === g.key) z.dead = true;
    const post = byId(w, g.post), chest = byId(w, g.chest);
    post.g.ph = 2; post.state = 1; chest.state = 1; touch(post); touch(chest);
    w.emit({ t: 'mg', k: 'end', x: Math.round(post.x), y: Math.round(post.y) });
  }
  MG.gauntlet = {
    id: 'gauntlet', name: 'Trap Gauntlet', kind: 'game', strata: null, w: 6, reward: 'hero',
    start(w, room) {
      const s = w.stratum, rng = w.rng, c = D.center(room);
      const x0 = TRAP_X * T, x1 = (room.w - TRAP_X) * T, y0 = 2 * T, y1 = (room.h - 1) * T;
      const lanes = Math.max(2, Math.floor((x1 - x0) / 72)), lw = (x1 - x0) / lanes, warn = 0.95 - 0.05 * (s - 1), traps = [];
      const kinds = rng.shuffle(['jet', 'spike', 'blade']);
      for (let i = 0; i < lanes; i++) {
        const k = i < 3 ? kinds[i] : rng.pick(kinds), per = U.clamp(rng.range(1.8, 2.3) - 0.1 * (s - 1), warn + 0.6, 3);
        traps.push({ k, x: x0 + lw * (i + 0.5), w: lw, per: k === 'blade' ? Math.max(per, warn + 0.22 * Math.floor((y1 - y0) / 40) + 0.4) : per, next: rng.range(0, 1.2), n: 0 });
      }
      const g = setup(w, { id: 'gauntlet', key: U.uid(), room: w.roomId, ph: 0, t: 0, end: 0, dur: rng.int(30, 36), gold: Math.round((14 + 6 * s) * rng.range(0.9, 1.1)), warn, traps, field: [x0, x1, y0, y1], hits: {}, went: {} });
      const post = addProp(w, this, 'mg_gauntlet', D.clearSpot(room, 2.5 * T, c.y), { ph: 0, gold: g.gold, dur: g.dur, end: 0, h: {} });
      const chest = addProp(w, this, 'mg_chest', D.clearSpot(room, (room.w - 2.5) * T, c.y), { ni: 1, gold: g.gold }, { group: U.uid() });
      g.post = post.id; g.chest = goldAt(w, chest).id;
    },
    interact(w, p, pr) {
      const g = game(w); if (!g) return false;
      if (pr.id === g.post) {
        if (g.ph !== 0) return false;
        g.ph = 1; g.t = 0; g.end = w.time + g.dur;
        const chest = byId(w, g.chest);
        pr.g.ph = 1; pr.g.end = g.end; pr.g.ni = 1; chest.g.ni = 0; touch(pr); touch(chest);
        for (const q of w.players.values()) if (q.x < g.field[0]) g.went[q.pid] = true;
        w.emit({ t: 'mg', k: 'start', x: Math.round(pr.x), y: Math.round(pr.y) });
        return true;
      }
      if (pr.id !== g.chest || g.ph !== 1) return false;
      if (p.claimed[pr.group]) { toast(w, p.pid, 'You already claimed your prize.', true); return false; }
      if (!g.went[p.pid]) { toast(w, p.pid, 'Start from the post side of the traps.', true); return false; }
      p.claimed[pr.group] = true;
      const prize = gauntPrize(g, g.hits[p.pid] | 0);
      ED.Events.outcome(w, p, prize);
      w.msgs.push({ to: p.pid, t: 'claimed', group: pr.group });
      w.emit({ t: 'chest', x: pr.x, y: pr.y });
      if (heroes(w).every(q => q.downed || q.dead || q.claimed[pr.group])) gauntEnd(w, g);
      return true;
    },
    update(w, dt) {
      const g = game(w); if (!g || g.id !== 'gauntlet' || g.ph !== 1) return;
      g.t += dt;
      for (const q of w.players.values()) if (q.x < g.field[0] && !q.downed && !q.dead) g.went[q.pid] = true;
      if (w.time >= g.end) { gauntEnd(w, g); return; }
      for (const tr of g.traps) while (g.t >= tr.next) { fireTrap(w, g, tr); tr.next += tr.per; tr.n++; }
    },
    // Plays while healthy (above half health): starts at the post, then walks east to the chest, holding before a telegraph that strikes within 0.9 s and stepping out of one about to strike.
    bot(w, p) {
      const g = game(w), post = byId(w, g.post), chest = byId(w, g.chest);
      if (g.ph === 0) return p.hp > p.maxHp * 0.5 ? { go: post, use: post.id } : null;
      if (g.ph !== 1 || p.claimed[chest.group]) return null;
      if (!g.went[p.pid]) return { go: { x: g.field[0] - 30, y: p.y } };
      const zs = w.zones.filter(z => z.mg === g.key && !z.dead), ux = Math.sign(chest.x - p.x) || 1;
      const hot = (x, y, tl, m) => zs.some(z => z.dur - z.t < tl && inZone(z, x, y, m));
      if (hot(p.x, p.y, 0.5, p.r)) return { dir: [hot(p.x + ux * 30, p.y, 0.5, p.r) ? -ux : ux, 0] };
      if (p.x > g.field[0] - 20 && p.x < g.field[1] + 10 && hot(p.x + ux * 34, p.y, 0.9, p.r)) return { stop: true };
      return { go: chest, use: chest.id };
    },
  };

  // ================= 2. Shell game (party stake; gold to the party, a relic to the hero who picked) =================
  // A hooded dealer, three cups in slots 60 px apart. Interacting with the dealer bets the stake S: the pearl shows under its cup (SHOW s), the cups swap in pairs (ROUNDS[r]: n swaps of d s each, one cup arcing over, the other under),
  // then any hero picks a cup within PICK s (no pick loses). Rounds 1-2 pay 2S gold, round 3 a rare relic and the stake back; a loss or round 3 ends the game. A new round starts only while ROUND_T s remain of GAME_MAX.
  const SHELL = { show: 1.1, pick: 8, reveal: 1.6, roundT: 16, gap: 60, arc: 14, rounds: [{ n: 5, d: 0.5 }, { n: 7, d: 0.38 }, { n: 9, d: 0.28 }] };
  M.SHELL = SHELL;
  // World spot of cup ci at time t from the dealer's payload dg { sx, sy, sl (slot of each cup at the shuffle start), t0, d, sw (slot pairs, flat) }.
  M.cupAt = (dg, ci, t) => {
    const sl = dg.sl.slice(), n = dg.sw.length / 2, k = dg.d > 0 ? (t - dg.t0) / dg.d : 0, done = Math.min(n, Math.max(0, Math.floor(k)));
    for (let i = 0; i < done; i++) { const a = dg.sw[2 * i], b = dg.sw[2 * i + 1]; for (let c = 0; c < 3; c++) sl[c] = sl[c] === a ? b : sl[c] === b ? a : sl[c]; }
    if (k > 0 && done < n) {
      const a = dg.sw[2 * done], b = dg.sw[2 * done + 1], f = U.easeInOut(k - done);
      if (sl[ci] === a || sl[ci] === b) { const from = sl[ci], to = from === a ? b : a, up = from === a ? -1 : 1; return { x: U.lerp(dg.sx[from], dg.sx[to], f), y: dg.sy + up * SHELL.arc * Math.sin(f * Math.PI) }; }
    }
    return { x: dg.sx[sl[ci]], y: dg.sy };
  };
  function shellRound(w, g) {
    const R = SHELL.rounds[g.round - 1], rng = g.rng, d = byId(w, g.dealer), dg = d.g;
    g.pearl = rng.int(0, 2);
    const sw = [];
    let last = -1;
    for (let i = 0; i < R.n; i++) { let k = rng.int(0, 2); if (k === last) k = (k + 1 + rng.int(0, 1)) % 3; last = k; const pr = [[0, 1], [1, 2], [0, 2]][k]; if (rng.chance(0.5)) pr.reverse(); sw.push(pr[0], pr[1]); }
    g.ph = 1; g.t0 = w.time + SHELL.show; g.pickAt = g.t0 + R.n * R.d; g.pickEnd = g.pickAt + SHELL.pick;
    Object.assign(dg, { ph: 1, r: g.round, pe: g.pearl, sl: g.sl.slice(), t0: g.t0, d: R.d, sw, pk: -1, res: -1, ni: 1, end: g.pickEnd });
    for (let c = 0; c < 3; c++) { const cup = byId(w, g.cups[c]); cup.g.ni = 1; touch(cup); }
    touch(d);
  }
  function shellPhase(w, g, ph) {
    const d = byId(w, g.dealer);
    g.ph = ph; d.g.ph = ph;
    if (ph === 3) for (let c = 0; c < 3; c++) { g.sl[c] = slotOf(d.g, c); const cup = byId(w, g.cups[c]); cup.x = d.g.sx[g.sl[c]]; cup.y = d.g.sy; cup.g.ni = 0; touch(cup); }
    else for (const id of g.cups) { const cup = byId(w, id); if (!cup.g.ni) { cup.g.ni = 1; touch(cup); } }
    if (ph === 0) { d.g.ni = 0; d.g.r = g.round; }
    if (ph === 5) d.state = 1;
    touch(d);
  }
  const slotOf = (dg, ci) => { const pt = M.cupAt(dg, ci, 1e9); return dg.sx.indexOf(pt.x); };
  function shellPick(w, g, p, ci) {
    const d = byId(w, g.dealer), win = ci === g.pearl;
    d.g.pk = ci; d.g.res = win ? 1 : 0; g.revealEnd = w.time + SHELL.reveal;
    shellPhase(w, g, 4);
    const at = ci < 0 ? d : byId(w, g.cups[ci]);
    w.emit({ t: 'mg', k: win ? 'win' : 'lose', x: Math.round(at.x), y: Math.round(at.y), pid: p ? p.pid : '' });
    if (!win) return;
    if (g.round < 3) ED.Events.outcome(w, null, { gold: 2 * g.stake });
    else { ED.Events.outcome(w, null, { gold: g.stake }); if (p) ED.Events.outcome(w, p, { relic: 'r' }); }
  }
  MG.shells = {
    id: 'shells', name: 'Shell Game', kind: 'game', strata: null, w: 6, reward: 'party',
    start(w, room) {
      const s = w.stratum, rng = w.rng, c = D.center(room);
      const g = setup(w, { id: 'shells', room: w.roomId, ph: 0, round: 1, stake: round5((14 + 8 * s) * rng.range(0.85, 1.15)), sl: [0, 1, 2], cups: [], end: 0, rng: U.RNG(rng.seed()) });
      const at = D.clearSpot(room, c.x, c.y - 52), sy = Math.round(at.y + 70), sx = [-1, 0, 1].map(i => Math.round(at.x + i * 60));
      const d = goldAt(w, addProp(w, this, 'mg_dealer', at, { ph: 0, r: 1, s: g.stake, sx, sy, sl: [0, 1, 2], t0: 0, d: 0, sw: [], pe: -1, pk: -1, res: -1, end: 0 }));
      g.dealer = d.id;
      for (let i = 0; i < 3; i++) g.cups.push(addProp(w, this, 'mg_cup', { x: sx[i], y: sy }, { c: i, ni: 1 }).id);
    },
    interact(w, p, pr) {
      const g = game(w); if (!g) return false;
      if (pr.id === g.dealer) {
        if (g.ph !== 0) return false;
        if (g.end && w.time + SHELL.roundT > g.end) { shellPhase(w, g, 5); return false; }
        if (!stake(w, p, pr, g.stake)) return false;
        if (!g.end) g.end = w.time + SHELL.gap;
        shellRound(w, g);
        return true;
      }
      const ci = g.cups.indexOf(pr.id);
      if (ci < 0 || g.ph !== 3) return false;
      shellPick(w, g, p, ci);
      return true;
    },
    update(w, dt) {
      const g = game(w); if (!g || g.id !== 'shells') return;
      if (g.ph === 1 || g.ph === 2) {
        const d = byId(w, g.dealer);
        if (g.ph === 1 && w.time >= g.t0) shellPhase(w, g, 2);
        for (let c = 0; c < 3; c++) { const cup = byId(w, g.cups[c]), pt = M.cupAt(d.g, c, w.time); cup.x = pt.x; cup.y = pt.y; } // host positions for the interaction range (clients draw from the schedule)
        if (w.time >= g.pickAt) shellPhase(w, g, 3);
      } else if (g.ph === 3 && w.time >= g.pickEnd) shellPick(w, g, null, -1);
      else if (g.ph === 4 && w.time >= g.revealEnd) {
        const won = byId(w, g.dealer).g.res === 1;
        if (won && g.round < 3 && w.time + SHELL.roundT <= g.end) { g.round++; shellPhase(w, g, 0); }
        else shellPhase(w, g, 5);
      } else if (g.ph === 0 && g.end && w.time + SHELL.roundT > g.end) shellPhase(w, g, 5);
    },
    // The lead hero bets while the party keeps the stake + 20 gold, plays at most two rounds and finds the pearl with chance 0.8 / 0.6 / 0.45 by round (seeded by floor, room and round); the others wait.
    bot(w, p) {
      const g = game(w), d = byId(w, g.dealer), me = lead(w) === p;
      if (g.ph === 5 || (g.ph === 0 && (g.round > 2 || w.gold < g.stake + 20))) return null;
      if (!me) return { stop: true };
      if (g.ph === 0) return { go: { x: d.x, y: d.y + 22 }, use: d.id };
      if (g.ph !== 3) return { go: { x: d.x, y: d.y + 30 } };
      if (g.botCup === undefined || g.botR !== g.round) {
        const r = U.RNG(((w.floorSeed ^ (w.roomId * 2654435761)) >>> 0) + g.round * 97);
        g.botR = g.round; g.botCup = r.chance([0.8, 0.6, 0.45][g.round - 1]) ? g.pearl : (g.pearl + 1 + r.int(0, 1)) % 3;
      }
      const cup = byId(w, g.cups[g.botCup]);
      return { go: { x: cup.x, y: cup.y + 18 }, use: cup.id };
    },
  };

  // ================= 3. Wager duel (party stake and prize) =================
  // A herald offers a duel for stake S: the doors lock and a champion (the biome's elite with two rolled affixes, DUEL_HP x health) forms under a reinforcement telegraph. Kill it within dur s of its arrival
  // with no hero going down (heroes already down at the bet do not count) for round(S x mul) gold; otherwise it vanishes (no drops), every foe shot and zone goes with it, the stake is lost. The doors open either way.
  // Non-lethal: a hit that would down a hero while it runs leaves that hero at 1 health and loses the duel (duelSave).
  const DUEL_HP = 1.25;
  M.DUEL_HP = DUEL_HP;
  // combat.js playerLethal, before relic and Second Wind saves: true while the duel of this room runs (bet placed); p keeps 1 health and the duel is lost.
  W.duelSave = function (p) {
    const g = game(this);
    if (!g || g.id !== 'duel' || (g.ph !== 1 && g.ph !== 2)) return false;
    p.hp = 1; p.invuln = Math.max(p.invuln, 1);
    duelEnd(this, g, false);
    return true;
  };
  function duelEnd(w, g, win) {
    g.ph = win ? 3 : 4;
    const h = byId(w, g.herald);
    h.g.ph = g.ph; h.state = 1; touch(h);
    if (!win) {
      for (const e of w.enemies) if (e.hp > 0) { e.hp = 0; e.killed = true; w.emit({ t: 'puff', x: Math.round(e.x), y: Math.round(e.y), c: '#d8cbb8' }); }
      for (const q of w.projs) if (q.team !== 0) q.dead = true;
      for (const z of w.zones) if (z.team !== 0) z.dead = true;
    } else ED.Events.outcome(w, null, { gold: Math.round(g.stake * g.mul) });
    w.locked = false; w.enc = null;
    w.emit({ t: 'mg', id: 'duel', k: win ? 'won' : 'lost', x: Math.round(h.x), y: Math.round(h.y), v: win ? Math.round(g.stake * g.mul) : g.stake });
  }
  MG.duel = {
    id: 'duel', name: 'Wager Duel', kind: 'game', strata: null, w: 6, reward: 'party',
    start(w, room) {
      const s = w.stratum, rng = w.rng, c = D.center(room), aff = rng.shuffle(ED.AFFIX_IDS.slice()).slice(0, 2);
      const g = setup(w, { id: 'duel', room: w.roomId, ph: 0, stake: round5((20 + 12 * s) * rng.range(0.9, 1.1)), mul: rng.pick([2, 2.5, 3]), dur: Math.round(26 + 4 * s + rng.range(-2, 2)), type: ED.biomeFor(s).elite, aff, end: 0, foe: null, down: {} });
      g.herald = goldAt(w, addProp(w, this, 'mg_herald', D.clearSpot(room, c.x, c.y - 40), { ph: 0, s: g.stake, m: g.mul, d: g.dur, ty: g.type, af: aff, end: 0 })).id;
    },
    interact(w, p, pr) {
      const g = game(w); if (!g || pr.id !== g.herald || g.ph !== 0) return false;
      if (!stake(w, p, pr, g.stake)) return false;
      g.ph = 1;
      for (const q of w.players.values()) if (q.downed || q.dead) g.down[q.pid] = true;
      w.locked = true; w.enc = { kind: 'duel' }; // updateEncounter has no case for it: the game runs the fight
      w.emit({ t: 'lock' });
      const def = ED.ENEMIES[g.type], at = D.randomFloor(w.room, w.rng, w.alivePlayers(), ED.World.REINF_AVOID);
      w.addZone({ kind: 'spawn', x: at.x, y: at.y, r: def.r + 14, dur: ED.World.PACE.reinf, type: g.type, elite: true, affix: g.aff[0], big: 1, after: (e) => {
        e.elite2 = g.aff[1];
        if (g.aff[1] === 'swift') e.spd *= 1.4; else if (g.aff[1] === 'brutal') e.dmg *= 1.4; // the second affix's spawn effects (makeElite applied the first)
        e.hp *= DUEL_HP; e.maxHp = e.hp;
        if (ED.hasAffix(e, 'warded')) { e.ward = e.maxHp * 0.45; e.wardMax = e.ward; }
        g.foe = e; g.ph = 2; g.end = w.time + g.dur;
        const h = byId(w, g.herald); h.g.ph = 2; h.g.end = g.end; touch(h);
      } });
      w.emit({ t: 'reinf', x: Math.round(at.x), y: Math.round(at.y), type: g.type, el: 1 });
      pr.g.ph = 1; pr.g.ni = 1; touch(pr);
      return true;
    },
    update(w, dt) {
      const g = game(w); if (!g || g.id !== 'duel' || g.ph !== 2) return;
      const fell = heroes(w).some(q => (q.downed || q.dead) && !g.down[q.pid]);
      if (!(g.foe.hp > 0)) duelEnd(w, g, !fell);
      else if (fell || w.time >= g.end) duelEnd(w, g, false);
    },
    // The lead hero bets while every living hero holds 70% of max health and the party keeps the stake + 10 gold (the fight itself is the bot's normal play); otherwise the party leaves.
    bot(w, p) {
      const g = game(w);
      if (g.ph !== 0) return null;
      if (w.gold < g.stake + 10 || w.alivePlayers().some(q => q.hp < q.maxHp * 0.7)) return null;
      if (lead(w) !== p) return { stop: true };
      const h = byId(w, g.herald);
      return { go: { x: h.x, y: h.y + 22 }, use: h.id };
    },
  };

  // ================= 4. Lantern chase (party gold per wisp; all caught: +maxHp per hero) =================
  // Lighting the lantern frees n wisps (zones kind 'wisp', team 0, never hit) at floor spots WISP.avoid from every hero for dur s. A wisp wanders, flees heroes within flee (steering like the Platino, probing for open floor)
  // and is caught by a hero's touch: gold per wisp to the party; the last one caught pays maxHp bonus health to every living hero. Wisps left at the end fade.
  const WISP = { speed: 122, wander: 50, flee: 170, turn: 7.5, probe: 22, r: 6, touch: 6, avoid: 110, hp: 2 };
  M.WISP = WISP;
  const OPEN = (t) => t === 0 || t === 4;
  function steerWisp(w, z, dt) {
    const g = game(w);
    if (!g || g.key !== z.mg || g.ph !== 1) { z.dead = true; z.dur = 0; return; }
    let fx = 0, fy = 0;
    for (const p of w.players.values()) {
      if (p.downed || p.dead) continue;
      const dx = z.x - p.x, dy = z.y - p.y, d2 = dx * dx + dy * dy, rr = p.r + z.r + WISP.touch;
      if (d2 < rr * rr) { z.dead = true; z.dur = 0; wispCaught(w, g, z, p); return; }
      if (d2 < WISP.flee * WISP.flee) { const d = Math.sqrt(d2) || 1, k = 1 - d / WISP.flee; fx += dx / d * k; fy += dy / d * k; }
    }
    const fleeing = fx !== 0 || fy !== 0;
    if (fleeing) z.a += U.clamp(U.angDiff(z.a, Math.atan2(fy, fx)), -WISP.turn * dt, WISP.turn * dt);
    else { if ((z.wt -= dt) <= 0) { z.wt = g.rng.range(0.5, 1.3); z.wa = g.rng.range(-2.5, 2.5); } z.a += z.wa * dt; }
    for (let i = 0; i < 9; i++) {
      const a = z.a + (i === 0 ? 0 : (i & 1 ? 1 : -1) * [0.5, 1, 1.6, 2.4][(i - 1) >> 1]);
      if (OPEN(D.tileAt(w.room, z.x + Math.cos(a) * WISP.probe, z.y + Math.sin(a) * WISP.probe))) { z.a = a; break; }
    }
    const sp = fleeing ? WISP.speed : WISP.wander;
    ED.Sim.moveCircle(z, Math.cos(z.a) * sp * dt, Math.sin(z.a) * sp * dt, w.room, true, false);
  }
  function wispCaught(w, g, z, p) {
    g.caught++;
    const lan = byId(w, g.lantern);
    lan.g.c = g.caught; touch(lan);
    w.emit({ t: 'mg', k: 'catch', x: Math.round(z.x), y: Math.round(z.y), pid: p.pid });
    ED.Events.outcome(w, p, { gold: g.per });
    if (g.caught >= g.n) { ED.Events.outcome(w, null, { maxHp: WISP.hp }); wispEnd(w, g, true); }
  }
  function wispEnd(w, g, all) {
    g.ph = 2;
    for (const z of w.zones) if (z.mg === g.key && !z.dead) { z.dead = true; w.emit({ t: 'puff', x: Math.round(z.x), y: Math.round(z.y), c: '#ffe7a0' }); }
    const lan = byId(w, g.lantern);
    lan.g.ph = 2; lan.state = 1; touch(lan);
    w.emit({ t: 'mg', id: 'wisps', k: all ? 'won' : 'end', x: Math.round(lan.x), y: Math.round(lan.y), v: g.caught });
  }
  MG.wisps = {
    id: 'wisps', name: 'Lantern Chase', kind: 'game', strata: null, w: 6, reward: 'party',
    start(w, room) {
      const s = w.stratum, rng = w.rng, c = D.center(room);
      const g = setup(w, { id: 'wisps', key: U.uid(), room: w.roomId, ph: 0, n: rng.int(5, 7) + w.partySize() - 1, caught: 0, per: Math.round((3 + 2 * s) * rng.range(0.9, 1.1)), dur: rng.int(22, 28), end: 0, rng: U.RNG(rng.seed()) });
      g.lantern = goldAt(w, addProp(w, this, 'mg_lantern', D.clearSpot(room, c.x, c.y - 30), { ph: 0, n: g.n, c: 0, per: g.per, d: g.dur, hp: WISP.hp, end: 0 })).id;
    },
    interact(w, p, pr) {
      const g = game(w); if (!g || pr.id !== g.lantern || g.ph !== 0) return false;
      g.ph = 1; g.end = w.time + g.dur;
      const avoid = w.alivePlayers();
      for (let i = 0; i < g.n; i++) {
        const pt = D.randomFloor(w.room, g.rng, avoid, WISP.avoid);
        w.addZone({ kind: 'wisp', custom: true, team: 0, x: pt.x, y: pt.y, r: WISP.r, dur: g.dur + 1, a: g.rng.range(0, U.TAU), wa: 0, wt: 0, mg: g.key, update: steerWisp });
        w.emit({ t: 'puff', x: Math.round(pt.x), y: Math.round(pt.y), c: '#ffe7a0' });
      }
      pr.g.ph = 1; pr.g.end = g.end; pr.g.ni = 1; touch(pr);
      w.emit({ t: 'mg', k: 'start', x: Math.round(pr.x), y: Math.round(pr.y) });
      return true;
    },
    update(w, dt) {
      const g = game(w); if (!g || g.id !== 'wisps' || g.ph !== 1) return;
      if (w.time >= g.end) wispEnd(w, g, false);
    },
    // Every hero lights it if no one has, then runs at the nearest wisp's spot 0.25 s ahead.
    bot(w, p) {
      const g = game(w);
      if (g.ph === 0) { const l = byId(w, g.lantern); return { go: { x: l.x, y: l.y + 20 }, use: l.id }; }
      if (g.ph !== 1) return null;
      let best = null, bd = Infinity;
      for (const z of w.zones) if (z.mg === g.key && !z.dead) { const d = U.dist2(z.x, z.y, p.x, p.y); if (d < bd) { bd = d; best = z; } }
      if (!best) return { stop: true };
      const sp = bd < WISP.flee * WISP.flee ? WISP.speed : WISP.wander, tx = best.x + Math.cos(best.a) * sp * 0.25, ty = best.y + Math.sin(best.a) * sp * 0.25;
      return { dir: [tx - p.x, ty - p.y] };
    },
  };

  // ================= 5. Echo bells (party gold per round; all rounds: a boon offer per hero) =================
  // Striking the echo stone rings four bells (a diamond about the stone) in a rolled order (no bell twice in a row): round r plays the first ECHO.len[r] notes, ECHO.step[r] s each, then the party has ECHO.answer s to strike
  // them in order with any hero hit (a hit on the bell struck last is ignored: the tune never repeats a bell in a row). A right order pays gold G to the party; round 3 also grants every living hero a boon offer. A wrong bell or the timer ends the game.
  // The bells stand ECHO.at px from the stone, out of a Bellwarden's swing from it.
  const ECHO = { len: [3, 4, 5], step: [0.62, 0.52, 0.42], answer: 10, pause: 0.9, r: 13, at: [[-112, 0], [0, -88], [112, 0], [0, 88]] };
  M.ECHO = ECHO;
  function echoShow(w, g) {
    const st = byId(w, g.stone), r = g.round - 1;
    g.ph = 1; g.idx = 0; g.shown = -1; g.t0 = w.time + 0.5;
    g.ansAt = g.t0 + ECHO.len[r] * ECHO.step[r];
    if (g.seq[0] === g.last) g.last = -1; // the last bell struck stays deaf into the next round unless the tune opens on it
    w.mgTargets = null;
    Object.assign(st.g, { ph: 1, r: g.round, sq: g.seq.slice(0, ECHO.len[r]), t0: g.t0, st: ECHO.step[r], ok: 0, end: 0 });
    touch(st);
  }
  function echoEnd(w, g, res) {
    g.ph = 4; w.mgTargets = null;
    const st = byId(w, g.stone);
    st.g.ph = 4; st.g.res = res; st.state = 1; touch(st);
    w.emit({ t: 'mg', id: 'echo', k: res ? 'won' : 'lost', x: Math.round(st.x), y: Math.round(st.y), v: g.round - (res ? 0 : 1) });
  }
  MG.echo = {
    id: 'echo', name: 'Echo Bells', kind: 'game', strata: null, w: 6, reward: 'party',
    start(w, room) {
      const s = w.stratum, rng = w.rng, c = D.center(room), at = D.clearSpot(room, c.x, c.y);
      const seq = [];
      for (let i = 0; i < ECHO.len[2]; i++) { let b = rng.int(0, 3); if (i && b === seq[i - 1]) b = (b + 1 + rng.int(0, 2)) % 4; seq.push(b); }
      const g = setup(w, { id: 'echo', room: w.roomId, ph: 0, round: 1, idx: 0, seq, gold: Math.round((8 + 5 * s) * rng.range(0.9, 1.1)), last: -1, bells: [] });
      g.stone = goldAt(w, addProp(w, this, 'mg_echo', at, { ph: 0, r: 1, gold: g.gold, sq: [], t0: 0, st: 0, ok: 0, end: 0, res: -1 })).id;
      ECHO.at.forEach((o, i) => { g.bells.push({ x: at.x + o[0], y: at.y + o[1], r: ECHO.r, i }); addProp(w, this, 'mg_bell', { x: at.x + o[0], y: at.y + o[1] }, { i, ni: 1 }); });
    },
    interact(w, p, pr) {
      const g = game(w); if (!g || pr.id !== g.stone || g.ph !== 0) return false;
      pr.g.ni = 1;
      echoShow(w, g);
      w.emit({ t: 'mg', k: 'start', x: Math.round(pr.x), y: Math.round(pr.y) });
      return true;
    },
    update(w, dt) {
      const g = game(w); if (!g || g.id !== 'echo') return;
      if (g.ph === 1) { const k = Math.floor((w.time - g.t0) / ECHO.step[g.round - 1]); if (k > g.shown && k < ECHO.len[g.round - 1]) { g.shown = k; const b = g.bells[g.seq[k]]; w.emit({ t: 'mg', k: 'note', i: b.i, x: Math.round(b.x), y: Math.round(b.y) }); } } // each note of the tune rings for every viewer
      if (g.ph === 1 && w.time >= g.ansAt) { g.ph = 2; g.end = w.time + ECHO.answer; w.mgTargets = g.bells; const st = byId(w, g.stone); st.g.ph = 2; st.g.end = g.end; touch(st); }
      else if (g.ph === 2 && w.time >= g.end) echoEnd(w, g, 0);
      else if (g.ph === 3 && w.time >= g.next) { g.round++; echoShow(w, g); }
    },
    hit(w, p, i) {
      const g = game(w);
      if (g.ph !== 2 || i === g.last) return;
      g.last = i;
      const b = g.bells[i], ok = i === g.seq[g.idx];
      w.emit({ t: 'mg', k: 'bell', i, ok: ok ? 1 : 0, x: Math.round(b.x), y: Math.round(b.y), pid: p.pid });
      if (!ok) { echoEnd(w, g, 0); return; }
      g.idx++;
      const st = byId(w, g.stone); st.g.ok = g.idx; touch(st);
      if (g.idx < ECHO.len[g.round - 1]) return;
      ED.Events.outcome(w, null, { gold: g.gold });
      if (g.round >= ECHO.len.length) { ED.Events.outcome(w, null, { offer: 'boon' }); echoEnd(w, g, 1); return; }
      g.ph = 3; g.next = w.time + ECHO.pause; w.mgTargets = null; st.g.ph = 3; touch(st);
    },
    // Any hero strikes the stone; the lead hero listens on the stone and answers (melee: beside the bell, ranged: 110 px off, a Bellwarden 26 px outside it, attacking it), the others wait.
    bot(w, p) {
      const g = game(w), st = byId(w, g.stone);
      if (g.ph === 0) return { go: { x: st.x, y: st.y + 22 }, use: st.id };
      if (g.ph === 4) return null;
      if (lead(w) !== p) return { stop: true };
      if (g.ph !== 2) return { go: st };
      const b = g.bells[g.seq[g.idx]], d = Math.hypot(b.x - p.x, b.y - p.y) || 1;
      if (p.stats.kind === 'bell') { const o = Math.hypot(b.x - st.x, b.y - st.y) || 1, at = { x: b.x + (b.x - st.x) / o * 26, y: b.y + (b.y - st.y) / o * 26 }; return near(p, at.x, at.y, 30) ? { go: at, atk: b } : { go: at }; }
      const want = p.stats.melee ? Math.max(14, p.stats.weapon.range * 0.6) : 110;
      return d > want + 8 ? { go: { x: b.x + (p.x - b.x) / d * want, y: b.y + (p.y - b.y) / d * want }, atk: b } : { stop: true, atk: b };
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
