// Usage: node tools/sim.js <heroes> <runs> <botSkill 0-1> <meta none|mid|max> [classes] [pact]
// Headless simulation harness: loads the game's sim files in a VM and drives bot heroes through full runs.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src') + '/';
const files = ['util.js', 'data/biomes.js', 'data/enemies.js', 'data/classes.js', 'data/boons.js', 'data/relics.js', 'data/meta.js', 'save.js',
  'sim/dungeon.js', 'sim/stats.js', 'sim/world.js', 'sim/combat.js', 'sim/ai.js', 'sim/bosses.js', 'sim/rooms.js'];
const ctx = { console, Math, Date, Object, Array, Set, Map, JSON, Uint8Array, Int16Array, Int32Array, Number, String, Error, parseInt, isNaN };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of files) vm.runInContext(fs.readFileSync(ROOT + f, 'utf8'), ctx, { filename: f });
const ED = ctx.ED;
const U = ED.U, T = ED.CONST.TILE, D = ED.Dungeon;

function bfsDir(room, locked, sx, sy, tx, ty) {
  const w = room.w, h = room.h;
  const s = Math.floor(sy / T) * w + Math.floor(sx / T), g = Math.floor(ty / T) * w + Math.floor(tx / T);
  if (s === g) return [tx - sx, ty - sy];
  const prev = new Int32Array(w * h).fill(-1); prev[s] = s;
  const q = [s];
  while (q.length) {
    const i = q.shift(); if (i === g) break;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || prev[j] >= 0) continue;
      const t = room.tiles[j];
      if (t === 0 || t === 4 || (t === 5 && !locked)) { prev[j] = i; q.push(j); }
    }
  }
  if (prev[g] < 0) return [tx - sx, ty - sy];
  let c = g; let path = [c];
  while (prev[c] !== s && c !== s) { c = prev[c]; path.push(c); }
  const nx = (c % w + 0.5) * T, ny = (Math.floor(c / w) + 0.5) * T;
  return [nx - sx, ny - sy];
}

function runBot(opts) {
  U.resetUid(1);
  const players = [];
  for (let i = 0; i < opts.n; i++) {
    const cls = opts.cls[i % opts.cls.length];
    players.push({ pid: 'p' + i, name: 'Bot' + i, slot: i, cls, weapon: ED.CLASSES[cls].weapons[opts.weapon || 0],
      meta: { up: opts.up || ED.UPGRADES.map(() => 0), mastery: opts.mastery || 1, relics: ED.RELIC_IDS.filter(id => ED.RELICS[id].start) } });
  }
  const w = new ED.World({ seed: opts.seed, pact: opts.pact || 0, players, tutorial: opts.tutorial });
  w.startRun();
  const ctl = {};
  for (const p of w.players.values()) ctl[p.pid] = { atk: 0, skill: 0, dash: 0, goal: null };
  const dt = 1 / 60;
  let steps = 0;
  const maxSteps = 60 * 60 * 30;
  let lastRoomT = 0;
  const log = [];
  let stratumStart = 0, bossStart = 0;
  while (w.state !== 'over' && steps < maxSteps) {
    steps++;
    for (const p of w.players.values()) {
      const c = ctl[p.pid];
      c.atk -= dt; c.skill -= dt; c.dash -= dt;
      if (p.offer) { w.pickBoon(p.pid, Math.floor(Math.random() * p.offer.length)); }
      if (p.downed || p.dead) continue;
      let mx = 0, my = 0;
      const foes = w.enemies.filter(e => e.hp > 0 && e.spawnT <= 0);
      if (foes.length) {
        let tgt = null, bd = 1e9;
        for (const e of foes) { const d = U.dist2(e.x, e.y, p.x, p.y); if (d < bd) { bd = d; tgt = e; } }
        const d = Math.sqrt(bd);
        const ideal = p.stats.melee ? (p.stats.weapon.range * 0.6 + tgt.r) : 170;
        const skill = opts.skill ?? 0.75;
        let dir;
        if (d > ideal + 10) dir = bfsDir(w.room, w.locked, p.x, p.y, tgt.x, tgt.y);
        else if (d < ideal - 20) dir = [p.x - tgt.x, p.y - tgt.y];
        else dir = [-(tgt.y - p.y), tgt.x - p.x];
        // dodge projectiles
        let danger = false;
        for (const pr of w.projs) if (pr.team === 1 && U.dist2(pr.x, pr.y, p.x, p.y) < 55 * 55) { danger = true; dir = [dir[0] + (p.x - pr.x) * 2, dir[1] + (p.y - pr.y) * 2]; }
        for (const z of w.zones) if ((z.kind === 'tele' || z.kind === 'poison' || z.kind === 'fire') && z.team === 1 && U.dist2(z.x, z.y, p.x, p.y) < (z.r + 12) ** 2) { danger = true; dir = [p.x - z.x + dir[0] * 0.2, p.y - z.y + dir[1] * 0.2]; }
        const l = Math.hypot(dir[0], dir[1]) || 1; mx = dir[0] / l; my = dir[1] / l;
        if (Math.random() > skill) { mx += (Math.random() - 0.5) * 1.5; my += (Math.random() - 0.5) * 1.5; }
        const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
        const inRange = p.stats.melee ? d - tgt.r < p.stats.weapon.range : d < 380;
        if (c.atk <= 0 && inRange) { w.playerAttack(p, a); c.atk = p.stats.atkInterval / (1 + (p.tranceT > 0 ? p.stats.trance : 0)); }
        if (c.skill <= 0 && d < 160) {
          const sk = ED.CLASSES[p.cls].skill;
          let data = null;
          if (sk === 'charge') { const e2 = ED.Sim.castMove(w.room, p.x, p.y, a, 150, p.r, w.locked); data = { x0: p.x, y0: p.y, x1: e2.x, y1: e2.y }; p.skillMove = { dx: Math.cos(a), dy: Math.sin(a), speed: 600, t: 0.25 }; }
          if (sk === 'step') { const e2 = ED.Sim.castMove(w.room, p.x, p.y, a, 140, p.r, w.locked); data = { x0: p.x, y0: p.y, x1: e2.x, y1: e2.y }; p.x = e2.x; p.y = e2.y; }
          w.playerSkill(p, a, data); c.skill = p.stats.skillCd;
        }
        if (danger && c.dash <= 0 && Math.random() < skill * 0.5) { p.dashT = 0.17; p.dashDx = mx; p.dashDy = my; w.playerDash(p, mx, my); c.dash = p.stats.dashCd; }
      } else if (!w.locked) {
        // loot first
        const pr = w.props.find(x => !x.state && (x.kind === 'chest' || (x.kind === 'relic' && !p.claimed[x.group]) || x.kind === 'fountain' || (x.kind === 'shop' && w.gold >= x.price) || x.kind === 'altar' && p.hp > p.maxHp * 0.6));
        const portal = w.props.find(x => x.kind === 'portal' && !x.state);
        let goal = null;
        if (pr) goal = pr; else if (portal) goal = portal;
        if (goal) {
          if (U.dist(goal.x, goal.y, p.x, p.y) < 40) w.interact(p.pid, goal.id);
          const dir = bfsDir(w.room, w.locked, p.x, p.y, goal.x, goal.y);
          const l = Math.hypot(dir[0], dir[1]) || 1; mx = dir[0] / l; my = dir[1] / l;
        } else {
          // head for nearest unvisited room, boss last
          const room = w.room;
          const fl = w.floor;
          // BFS over rooms to find path to target room
          const unvisitedNonBoss = fl.rooms.filter(r => !w.roomState[r.id].visited && r.type !== 'boss');
          const target = unvisitedNonBoss.length ? null : fl.boss;
          const prev = {}; prev[room.id] = -1; const q = [room.id]; let found = null;
          while (q.length) {
            const id = q.shift(); const r = fl.rooms[id];
            if (id !== room.id && ((target === null && !w.roomState[id].visited && r.type !== 'boss') || id === target)) { found = id; break; }
            for (const dd in r.doors) { const n = r.doors[dd]; if (n >= 0 && prev[n] === undefined) { if (fl.rooms[n].type === 'boss' && target === null) continue; prev[n] = id; q.push(n); } }
          }
          if (found !== null) {
            let step = found; while (prev[step] !== room.id) step = prev[step];
            const dd = Object.keys(room.doors).find(k => room.doors[k] === step);
            const r = D.doorRect(room, dd);
            const gx = (r.x0 + r.x1 + 1) / 2 * T + (dd === 'e' ? 30 : dd === 'w' ? -30 : 0), gy = (r.y0 + r.y1 + 1) / 2 * T + (dd === 's' ? 30 : dd === 'n' ? -30 : 0);
            const dir = bfsDir(room, w.locked, p.x, p.y, U.clamp(gx, 4, room.w * T - 4), U.clamp(gy, 4, room.h * T - 4));
            const l = Math.hypot(dir[0], dir[1]) || 1; mx = dir[0] / l; my = dir[1] / l;
          }
        }
      }
      ED.Sim.movePlayer(p, { mx, my }, dt, w.room, w.locked, w.zones);
    }
    const prevStratum = w.stratum, prevRoom = w.roomId;
    w.update(dt);
    for (const ev of w.fx) {
      if (ev.t === 'bossSpawn') bossStart = w.time;
      if (ev.t === 'bossDown') log.push(`  boss ${ev.type} down in ${(w.time - bossStart).toFixed(0)}s (t=${U.fmtTime(w.time)}, lvl ${w.level})`);
      if (ev.t === 'stratum') { if (ev.s > 1) log.push(`  stratum ${ev.s - 1} took ${(w.time - stratumStart).toFixed(0)}s`); stratumStart = w.time; }
    }
    w.fx.length = 0; w.msgs.length = 0;
    if (w.roomTime > 150 && w.locked && !w.boss) { log.push('  STUCK in room ' + w.roomId + ' type ' + w.room.type + ' hostiles ' + w.hostiles()); break; }
  }
  const p0 = [...w.players.values()][0];
  return { state: w.state, victory: w.victory, stratum: w.stratum, time: w.time, level: w.level, kills: w.run.kills, relics: p0.relics.length, log, sum: w.summary ? w.summary() : null, hp: p0.hp | 0, maxHp: p0.maxHp };
}

module.exports = { runBot, ED };
if (require.main === module) {
  const args = process.argv.slice(2);
  const n = +(args[0] || 1), runs = +(args[1] || 5), skill = +(args[2] || 0.75), meta = args[3] || 'none';
  const cls = (args[4] && args[4] !== '-' ? args[4] : 'knight,ranger,pyro,shade,cleric,necro').split(','); // '-' = every hero
  const up = meta === 'max' ? ED.UPGRADES.map(u => u.costs.length) : meta === 'mid' ? ED.UPGRADES.map(u => Math.ceil(u.costs.length / 2)) : ED.UPGRADES.map(() => 0);
  let wins = 0, depth = 0, time = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = runBot({ seed: 1000 + i * 7, n, cls: [cls[i % cls.length]].concat(cls), skill, up, pact: +(args[5] || 0), mastery: meta === 'max' ? 10 : meta === 'mid' ? 5 : 1 });
    if (r.victory) wins++;
    depth += r.stratum; time += r.time;
    console.log(`run ${i} ${cls[i % cls.length]}: ${r.victory ? 'WIN' : r.state} stratum ${r.stratum} time ${U.fmtTime(r.time)} lvl ${r.level} kills ${r.kills} relics ${r.relics} (${Date.now() - t0}ms)`);
    for (const l of r.log) console.log(l);
  }
  console.log(`\nwins ${wins}/${runs} avg depth ${(depth / runs).toFixed(2)} avg time ${U.fmtTime(time / runs)}`);
}
