// Last Light (GAME-DESIGN §2): the final boss's death banks the win (w.won: from then on the run can only end as a win), clears the field, then after C.LAP.calm s runs a C.LAP.dur s lap at the hard cap.
// w.lap: null until then, else { t0 (sim time the lap starts), dur, kills (hero kills during the lap), gold (coin gold collected during the lap), ph (0 calm, 1 lap) }; kept through end().
// Events: 'victory' { x, y } at the kill; 'lap' { ph: 1, dur } when the lap starts; 'lap' { ph: 2 } when the timer runs out (every foe dies), then 'end' (won).
// During the lap: spawner.js floods at the hard cap (100% floor, the final-minute roster; no flocks, swarms, elites or bosses), every C.LAP.coin-th hero kill drops a coin of 1 x stage gold (foes.js -> lapKill), no XP (progress.js).
(function (ED) {
  'use strict';
  const C = ED.CONST, W = ED.World.prototype;
  const COIN_CAP = 120, MERGE_R = 80; // at COIN_CAP coins on the ground a new coin merges into a non-pulled coin within MERGE_R px
  const isGem = (g) => g.k.charCodeAt(0) === 120; // 'x': xp gems

  // Every living foe dies at once ('die' events for the client; no kill credit, drops or splits); boss bodies leave the fight list.
  W.clearFoes = function () {
    for (const e of this.foes) {
      if (e.dead) continue;
      if (e.st) this.foeCancel(e);
      e.dead = true; e.hp = 0; e.hpQ = 0;
      this.emit({ t: 'die', id: e.id, k: e.k, x: Math.round(e.x), y: Math.round(e.y), elite: e.elite, boss: e.boss });
    }
    this.bossList.length = 0; this.boss = null;
  };
  // Final boss died at (x, y): banks the win, clears foes, foe shots and telegraphs, sends every free xp gem to its nearest living hero, starts the calm.
  W.startLap = function (x, y) {
    if (this.lap || this.state !== 'play') return;
    this.won = true;
    this.lap = { t0: this.time + C.LAP.calm, dur: C.LAP.dur, kills: 0, gold: 0, ph: 0 };
    this.emit({ t: 'victory', x: Math.round(x), y: Math.round(y) });
    this.clearFoes();
    for (const pr of this.projs) if (pr.team === 1) pr.dead = true;
    for (const z of this.zones) if (z.team === 1) z.dead = true;
    for (const g of this.pickups) if (!g.dead && !g.pull && isGem(g)) { const p = this.nearestHero(g.x, g.y); if (p) { g.pull = p.pid; g.t = 0; } }
  };
  // End-of-tick lap clock (World.runState): starts the lap at t0 (gems still on the ground vanish), ends the run as a win at t0 + dur. Returns true when the run ended.
  W.updateLap = function () {
    const lp = this.lap;
    if (lp.ph === 0 && this.time >= lp.t0) {
      lp.ph = 1;
      for (const g of this.pickups) if (!g.dead && isGem(g)) g.dead = true;
      this.emit({ t: 'lap', ph: 1, dur: lp.dur });
    }
    if (lp.ph === 1 && this.time >= lp.t0 + lp.dur) { this.clearFoes(); this.emit({ t: 'lap', ph: 2 }); this.end(true); return true; }
    return false;
  };
  // Foe e killed during the calm or lap (by hero p, or null): lap kill count, a coin every C.LAP.coin hero kills of the lap.
  W.lapKill = function (e, p) {
    const lp = this.lap;
    if (!p || !lp.ph) return;
    lp.kills++;
    if (lp.kills % C.LAP.coin === 0) this.dropCoin(e.x, e.y, this.sdef.gold || 1);
  };
  // Gold coin of value v at (x, y); at COIN_CAP coins on the ground it merges into the nearest non-pulled coin within MERGE_R px. Returns the coin holding v.
  W.dropCoin = function (x, y, v) {
    let n = 0, near = null, nd = MERGE_R * MERGE_R;
    for (const g of this.pickups) {
      if (g.dead || g.k !== 'gold') continue;
      n++;
      if (!g.pull) { const d = (g.x - x) * (g.x - x) + (g.y - y) * (g.y - y); if (d <= nd) { nd = d; near = g; } }
    }
    if (n >= COIN_CAP && near) { near.val += v; return near; }
    return this.spawnPickup('gold', x, y, v);
  };
  // Lap state for the view model into out: { ph (0 none, 1 calm, 2 lap), rem (s left of the calm or lap), gold, kills }.
  W.lapView = function (out) {
    const lp = this.lap;
    if (!lp) { out.ph = 0; out.rem = 0; out.gold = 0; out.kills = 0; return out; }
    out.ph = lp.ph ? 2 : 1; out.rem = Math.max(0, lp.ph ? lp.t0 + lp.dur - this.time : lp.t0 - this.time); out.gold = lp.gold; out.kills = lp.kills;
    return out;
  };
})(globalThis.ED || (globalThis.ED = {}));
