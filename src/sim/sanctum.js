// The Sanctum (GAME-DESIGN §2): a stage boss entry with sanctum: true moves the final fight out of the arena into a closed room (C.SANCTUM) centred on the arena centre.
// w.sanctum: null outside; else { st (0 enter | 1 fight | 2 done), t0 (st 0: the scheduled fight start; then the sim time it started), x, y (room centre), w, h (room inner size), endT (st 2: the run ends then) }.
// st 0 (C.SANCTUM.fade s): no spawns, heroes take no damage. Teleport tick: every foe despawns (no drops, no kill credit), foe shots and telegraphs vanish, gems on the floor become party XP,
// coins are paid to the run, chests and food move into the room, heroes stand above the bottom wall at full HP (the dead and downed revived), arena.room is set (arena.js: bodies and
// projectiles see only the room walls), and the boss spawns through W.spawnBoss C.SANCTUM.boss px below the top wall. Spawner, elites, flocks and swarms stay off for the rest of the run.
// st 2: the boss died (bosses.js onBossKilled -> W.winSanctum): the win is banked, adds, shots and telegraphs vanish, gems fly to their nearest hero, heroes take no damage; the run ends won at endT (no Last Light).
// Events: 'sanctum' { ph: 0, t0 } entry, 'sanctum' { ph: 1, x, y } teleport, 'victory' { x, y } boss death.
(function (ED) {
  'use strict';
  const C = ED.CONST, SC = C.SANCTUM, W = ED.World.prototype;
  const ARRIVE = [0, -36, 36, -72], ARRIVE_IV = 1.5; // party arrival x offsets by slot; i-frames after the teleport (s)
  const isGem = (k) => k === 'xp1' || k === 'xp5' || k === 'xp25';

  // Room rectangle { x0, y0, x1, y1 } of sanctum state S (or a { x, y, w, h } of the same shape) into out.
  ED.sanctumRoom = (S, out) => { out.x0 = S.x - S.w / 2; out.y0 = S.y - S.h / 2; out.x1 = S.x + S.w / 2; out.y1 = S.y + S.h / 2; return out; };

  // Stage boss entry b ({ t, id, final, sanctum }) is due: the fade starts.
  W.enterSanctum = function (b) {
    if (this.sanctum) return;
    const c = this.arena.size / 2;
    this.sanctum = { st: 0, t0: this.time + SC.fade, x: c, y: c, w: SC.w, h: SC.h, endT: 0, b };
    this.emit({ t: 'sanctum', ph: 0, t0: this.sanctum.t0 });
  };
  // Per tick while w.sanctum is set (World.update): the teleport at t0, the run's end at endT.
  W.updateSanctum = function () {
    const S = this.sanctum;
    if (S.st === 0 && this.time >= S.t0) this.sanctumTeleport();
    else if (S.st === 2 && this.time >= S.endT) this.end(true);
  };
  W.sanctumTeleport = function () {
    const S = this.sanctum, R = this.arena.room = ED.sanctumRoom(S, {});
    for (const e of this.foes) if (!e.dead) this.despawnFoe(e);
    this.bossList.length = 0; this.boss = null;
    for (const pr of this.projs) if (pr.team === 1) pr.dead = true;
    for (const z of this.zones) if (z.team === 1) z.dead = true;
    // party: full HP at the bottom of the room, the dead and downed back up
    for (const p of this.heroes) {
      const back = p.dead || p.downed;
      p.dead = false; p.downed = false; p.bleed = 0; p.revive = 0; p.dashT = 0; p.slowT = 0; p.hp = p.maxHp; p.invuln = ARRIVE_IV;
      p.x = S.x + ARRIVE[p.slot & 3]; p.y = R.y1 - SC.foot; p.vx = p.vy = 0;
      if (back) this.emit({ t: 'revive', pid: p.pid });
    }
    this.refreshLiving();
    // floor loot: gems -> XP, coins -> gold (the first hero collects), chests and food move into the room
    const p0 = this.living[0];
    let n = 0;
    for (const g of this.pickups) {
      if (g.dead) continue;
      if (p0 && isGem(g.k)) { g.dead = true; this.addXp(g.val * (1 + p0.stats.growth) * (this.cheats.xp || 1)); }
      else if (p0 && g.k === 'gold') { g.dead = true; const v = Math.round(g.val * this.goldMul(p0)); this.gold += v; p0.goldGot += v; }
      else if (g.k === 'chest' || g.k === 'food') { g.x = S.x + ((n % 8) - 3.5) * 22; g.y = R.y1 - 28 - 14 * Math.floor(n / 8); g.pull = ''; g.t = 0; n++; }
      else g.dead = true;
    }
    S.st = 1; S.t0 = this.time;
    this.emit({ t: 'sanctum', ph: 1, x: Math.round(S.x), y: Math.round(S.y) });
    const b = S.b, at = { x: S.x, y: R.y0 + SC.boss }, scripted = ED.FOES[b.id] && typeof ED.Bosses[b.id] === 'function';
    const e = (scripted && this.spawnBoss(b, at)) || this.standInBoss(b);
    if (e) e.sanctum = true;
  };
  // The Sanctum boss died at (x, y) (bosses.js onBossKilled, after the final gold): banks the win; adds, foe shots and telegraphs vanish; gems fly to their nearest hero; the run ends after C.SANCTUM.end s.
  W.winSanctum = function (x, y) {
    const S = this.sanctum;
    if (S.st === 2 || this.state !== 'play') return;
    this.won = true; S.st = 2; S.endT = this.time + SC.end;
    this.emit({ t: 'victory', x: Math.round(x), y: Math.round(y) });
    this.clearFoes();
    for (const pr of this.projs) if (pr.team === 1) pr.dead = true;
    for (const z of this.zones) if (z.team === 1) z.dead = true;
    for (const g of this.pickups) if (!g.dead && !g.pull && isGem(g.k)) { const p = this.nearestHero(g.x, g.y); if (p) { g.pull = p.pid; g.t = 0; } }
  };
})(globalThis.ED || (globalThis.ED = {}));
