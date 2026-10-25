// Room encounters (waves, bosses), props (chests, shops, shrines, rest sites, rewards, portals) and interactions.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, T = ED.CONST.TILE;
  const W = ED.World.prototype;

  // {action} tokens are replaced with the player's key bindings when the sign is drawn (ED.Input.fill); the sim never reads bindings.
  const SIGNS = [
    'Aim with {aim}. Hold {attack} to attack where you aim.',
    '{skill1} and {skill2} cast your skills where you aim: some fly toward it, some land on it. {dash} dashes; you cannot be hit while dashing.',
    'Clear a room to open its doors. Each door shows the next room and its reward. Doors close behind you.',
    'A violet moon marks a dark room: harder foes, better rewards. You choose whether to enter.',
    '{map} opens your build, combat numbers and the map of every path to the boss ({skill1} / {skill2} switch tabs).',
  ];

  // Regular foes of a biome that exist in the enemy table (rosters may name foes whose definitions land later).
  const rosterOf = (biome) => biome.enemies.filter(r => { const d = ED.ENEMIES[r[0]]; return d && !d.boss && !d.ally && !d.minion; });

  // Spawn zones still counting down: any, threat only (a fodder pack carries n and never holds a threat wave or the clear back), and the foes they will add; a Hunted champion's zone (z.hunt) counts in none.
  const pendingSpawns = (w) => w.zones.some(z => z.kind === 'spawn' && !z.dead && !z.hunt);
  const pendingThreat = (w) => w.zones.some(z => z.kind === 'spawn' && !z.n && !z.dead && !z.hunt);
  const pendingFoes = (w) => { let n = 0; for (const z of w.zones) if (z.kind === 'spawn' && !z.dead && !z.hunt) n += z.n || 1; return n; };

  // ---------------- encounters ----------------
  // A champion room (stratum IV, room.champ 'twins' | 'mimic') runs W.startChampion (champions.js); its xp budget roomXp(room, 'champion') is paid as the clear pile.
  W.beginEncounter = function (room, rs) {
    if (room.type === 'champion') {
      for (const p of this.players.values()) if (!p.downed && !p.dead) this.onRoomLockBuild(p, room);
      this.startChampion(room);
      Object.assign(this.enc, { xpBudget: this.roomXp(room, 'champion'), xpOut: 0, xpThr: 0, xpClip: 0, xpThrCap: 0, xpThrAcc: 0, xpK: 0 });
    } else if (room.type === 'combat' || room.type === 'elite') {
      this.locked = true;
      this.enc = { kind: 'waves', waves: this.planWaves(room), wave: -1, t: ED.World.PACE.first };
      this.planHorde(room, this.enc);
      this.emit({ t: 'lock' });
      for (const p of this.players.values()) if (!p.downed && !p.dead) this.onRoomLockBuild(p, room);
    } else if (room.type === 'boss') {
      this.locked = true;
      this.enc = { kind: 'boss', t: 2.4, spawned: false };
      const def = ED.ENEMIES[ED.biomeFor(this.stratum).boss];
      this.emit({ t: 'bossIntro', type: ED.biomeFor(this.stratum).boss, name: def.name, title: def.title, quote: def.quote });
      this.emit({ t: 'lock' });
    } else {
      rs.cleared = true;
    }
  };

  // WAVES threat waves (+1 at Pact 10), each worth (7 + 2 D) x threat wave x party (D = World.depth at the room's row), the last x1.15. Elite rooms: an elite in the first wave and one in the last.
  // The last wave carries one reinforcement (reinf: a longer, bigger telegraph): the elite of an elite room, the affixed elite of a dark room (DARK_AFFIXES), else the biome roster's costliest foe.
  W.planWaves = function (room) {
    const s = this.stratum, n = this.partySize(), Wc = ED.World, D = Wc.depth(s, this.rowFrac(room)), Ds = Wc.depth(s);
    const biome = ED.biomeFor(s), isElite = room.type === 'elite';
    const nW = Wc.WAVES + (this.pact >= 10 ? 1 : 0);
    const budget = (7 + 2 * D) * this.threat().wave * (1 + 0.6 * (n - 1) + 0.2 * (n - 1) * (n - 2)) * (this.tutorial && s === 1 ? 0.75 : 1);
    const own = rosterOf(biome);
    let roster = own;
    if (s >= 2 && this.rng.chance(Wc.MIX_PREV)) {
      const prev = rosterOf(ED.biomeFor(s - 1)).map(([id, w]) => [id, w * 0.35]);
      roster = roster.concat(prev);
    }
    const waves = [];
    for (let i = 0; i < nW; i++) {
      const list = [];
      let b = budget * (i === nW - 1 ? 1.15 : 1) * this.rng.range(0.9, 1.1);
      let guard = 0;
      while (b > 0.5 && guard++ < 40) {
        const pick = this.rng.weighted(roster, r => r[1])[0];
        list.push({ type: pick });
        b -= ED.ENEMIES[pick].cost || 2;
      }
      waves.push(list);
    }
    const last = waves[nW - 1];
    if (isElite) {
      last.push({ type: biome.elite, elite: true, reinf: 1 });
      const first = waves[0];
      if (first.length) first[this.rng.int(0, first.length - 1)].elite = true;
      else first.push({ type: biome.elite, elite: true });
      return waves;
    }
    let eliteCh = 0.28 + (this.pact >= 3 ? ED.PACTS[3].eliteCh : 0) + (Ds >= 4 ? 0.1 : 0);
    if (this.tutorial && s === 1) eliteCh = 0.1;
    if (this.rng.chance(eliteCh)) {
      const wv = waves[this.rng.int(Math.min(1, nW - 1), nW - 1)];
      if (this.rng.chance(0.5)) wv.push({ type: biome.elite, elite: true });
      else if (wv.length) wv[this.rng.int(0, wv.length - 1)].elite = true;
    }
    if (Ds >= 3 && this.rng.chance(0.2 + (this.pact >= 3 ? ED.PACTS[3].eliteExtra : 0))) last.push({ type: biome.elite, elite: true });
    if (room.dark) last.push({ type: biome.elite, elite: true, affix: this.rng.pick(Wc.DARK_AFFIXES), reinf: 1 });
    else if (own.length) last.push({ type: own.reduce((a, r) => ((ED.ENEMIES[r[0]].cost || 2) > (ED.ENEMIES[a[0]].cost || 2) ? r : a))[0], reinf: 1 });
    return waves;
  };

  // Horde and xp budget of a combat or elite room, beside its threat waves: q = the room's fodder, fod[i] = wave i's share of it, spawned = fodder out so far, the 2-4 edges packs come from,
  // and the xp ledger (budget = W.roomXp, in the units that drop, split into fod = the fodder motes' share and thrCap = what threat drops may take; K = thrCap / the planned waves' threat xp; out = dropped so far, thr = the threat part, clip = cut away, acc / thrAcc = mote and threat fractions not yet dropped).
  W.planHorde = function (room, enc) {
    const s = this.stratum, n = this.partySize(), Wc = ED.World, kind = room.type === 'elite' || room.type === 'champion' ? room.type : 'combat';
    enc.q = Math.round(Wc.perStratum(Wc.FODDER_Q, s) * (kind === 'elite' ? 0.6 : 1) * (1 + 0.5 * (n - 1)) * (this.tutorial && s === 1 ? 0.6 : 1) * (room.dark ? Wc.DARK_FODDER : 1));
    const nW = enc.waves.length;
    enc.fod = [];
    for (let i = 0; i < nW; i++) enc.fod.push(Math.round(enc.q * (i + 1) / nW) - Math.round(enc.q * i / nW));
    enc.spawned = 0;
    enc.edges = this.rng.shuffle(['n', 's', 'e', 'w']).slice(0, this.rng.int(2, 4));
    enc.xpBudget = this.roomXp(room, kind);
    enc.xpFod = Math.round(Wc.FODDER_XP_SHARE * enc.xpBudget); enc.xpThrCap = enc.xpBudget - enc.xpFod;
    let plan = 0;
    for (const wv of enc.waves) for (const f of wv) plan += Wc.threatXp(ED.ENEMIES[f.type], s, f.elite);
    plan *= room.dark ? this.darkLoot() : 1;
    enc.xpK = plan > 0 ? enc.xpThrCap / plan : 1;
    enc.xpOut = 0; enc.xpThr = 0; enc.xpClip = 0; enc.xpAcc = 0; enc.xpThrAcc = 0;
  };

  // A floor point on edge d (n, s, e, w) of the room: just inside the edge's door when it has one, else a random floor tile of the wall ring. null when none is found.
  const edgePoint = (room, d, rng) => {
    if (room.doors[d] >= 0) {
      const e = D.entryPoint(room, d, 1), j = rng.range(-30, 30);
      const pt = d === 'n' || d === 's' ? { x: e.x + j, y: e.y } : { x: e.x, y: e.y + j };
      if (D.tileAt(room, pt.x, pt.y) === 0) return pt;
    }
    for (let k = 0; k < 10; k++) {
      const tx = d === 'w' ? 1 : d === 'e' ? room.w - 2 : rng.int(2, room.w - 3), ty = d === 'n' ? 2 : d === 's' ? room.h - 2 : rng.int(3, room.h - 3);
      if (room.tiles[ty * room.w + tx] === 0) return { x: (tx + rng.range(0.2, 0.8)) * T, y: (ty + rng.range(0.2, 0.8)) * T };
    }
    return null;
  };

  // Where a pack lands: one random point on each of the room's pack edges that is at least minD from every hero, one of them at random; the other edges, then any floor, when none qualifies. null when nothing does.
  W.packSpot = function (enc, minD) {
    const room = this.room, rng = this.rng, heroes = [];
    for (const p of this.players.values()) if (!p.dead) heroes.push(p);
    const far = (pt) => { for (const h of heroes) if (U.dist2(pt.x, pt.y, h.x, h.y) < minD * minD) return false; return true; };
    const pick = (dirs) => {
      const c = [];
      for (const d of dirs) { const pt = edgePoint(room, d, rng); if (pt && far(pt)) c.push(pt); }
      return c.length ? c[rng.int(0, c.length - 1)] : null;
    };
    const spot = pick(enc.edges) || pick(['n', 's', 'e', 'w'].filter(d => !enc.edges.includes(d)));
    if (spot) return spot;
    for (let k = 0; k < 30; k++) {
      const x = rng.int(2, room.w - 3), y = rng.int(3, room.h - 3);
      if (room.tiles[y * room.w + x] !== 0) continue;
      const pt = { x: (x + 0.5) * T, y: (y + 0.5) * T };
      if (far(pt)) return pt;
    }
    return null;
  };

  // Wave i's fodder, out with the wave: its share (cut so live foes + pending spawns stay within LIVE_CAP) as packs of at most PACK_MAX, one spawn zone each (r 40, the spawn telegraph),
  // at a pack spot PACK_AVOID from every hero (PACE.avoid when none is that far). A pack with no spot is dropped (the clear pile pays its xp).
  W.spawnPacks = function (enc, i) {
    const Wc = ED.World, type = ED.biomeFor(this.stratum).fodder;
    const left = Math.min((enc.fod && enc.fod[i]) || 0, Wc.LIVE_CAP[this.partySize() > 1 ? 1 : 0] - this.hostiles() - pendingFoes(this));
    if (!(left > 0) || !type) return;
    const k = Math.ceil(left / Wc.PACK_MAX), base = Math.floor(left / k), extra = left - base * k;
    for (let j = 0; j < k; j++) {
      const n = base + (j < extra ? 1 : 0), spot = this.packSpot(enc, Wc.PACK_AVOID) || this.packSpot(enc, Wc.PACE.avoid);
      if (!spot) continue;
      this.addZone({ kind: 'spawn', x: spot.x, y: spot.y, r: 40, dur: Wc.PACE.spawn, type, n });
      enc.spawned += n;
    }
  };

  // A resolved pack zone: z.n fodder at random points within z.r that are floor tiles (the zone's centre when a point is not).
  W.spawnPack = function (z) {
    const room = this.room, rng = this.rng;
    for (let i = 0; i < z.n; i++) {
      let x = z.x, y = z.y;
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, U.TAU), d = z.r * Math.sqrt(rng.next()), px = z.x + Math.cos(a) * d, py = z.y + Math.sin(a) * d;
        if (D.tileAt(room, px, py) === 0) { x = px; y = py; break; }
      }
      this.spawnEnemy(z.type, x, y);
    }
    this.emit({ t: 'spawned', x: Math.round(z.x), y: Math.round(z.y), el: 0 });
  };

  // When the last threat foe falls the room's fodder crumble: no kill, drop or on-death effect ({t: 'die', fd, cr} each; the clear pile pays the xp they still owed), and pending packs are dropped.
  W.crumbleFodder = function () {
    for (const e of this.enemies) {
      if (!e.fodder || e.hp <= 0) continue;
      e.hp = 0; e.killed = true;
      this.emit({ t: 'die', x: Math.round(e.x), y: Math.round(e.y), type: e.type, el: 0, r: e.r, fd: 1, cr: 1 });
    }
    for (const z of this.zones) if (z.kind === 'spawn' && z.n) z.dead = true;
  };

  // A fodder kill adds its share (the fodder xp / quota) to the room's mote and drops the whole units of it at the kill spot.
  W.fodderMote = function (x, y) {
    const enc = this.enc;
    if (!enc || enc.xpBudget === undefined || !(enc.q > 0)) return;
    enc.xpAcc += enc.xpFod / enc.q;
    const n = Math.floor(enc.xpAcc);
    if (n >= 1) { enc.xpAcc -= n; this.dropXp(x, y, n, true); }
  };

  // Waves: the next one (with its fodder) PACE.gap after the last, once no threat spawn is pending and at most nextAt of the current wave's threat foes stand, or the wave is maxAge old; fodder never holds a wave back.
  // The room clears at once when the last wave is out and its last threat foe (summons included) falls; the fodder still standing crumble.
  W.updateEncounter = function (dt) {
    const enc = this.enc;
    if (!enc) return;
    enc.t -= dt; enc.age = (enc.age || 0) + dt;
    if (enc.kind === 'waves') {
      if (enc.hunt && enc.hunt.killed && !enc.huntPaid) this.huntedPaid(enc);
      const P = ED.World.PACE, threat = this.hostiles(true);
      const last = enc.wave >= enc.waves.length - 1;
      if (!last && enc.t <= 0 && !pendingThreat(this) && (enc.wave < 0 || enc.age >= P.maxAge || threat <= Math.max(1, Math.floor(enc.waves[enc.wave].length * P.nextAt)))) {
        enc.wave++; enc.age = 0;
        this.spawnWave(enc.waves[enc.wave]);
        this.spawnPacks(enc, enc.wave);
        if (enc.wave === 1 && huntedParty(this)) this.spawnHunted(enc);
        enc.t = P.gap;
      } else if (last && threat === 0 && !pendingThreat(this) && enc.t <= 0) {
        this.crumbleFodder();
        this.roomCleared();
      }
    } else if (enc.kind === 'boss') {
      if (!enc.spawned && enc.t <= 0) {
        enc.spawned = true;
        const type = ED.biomeFor(this.stratum).boss;
        const c = D.center(this.room);
        const e = this.spawnEnemy(type, c.x, c.y - 70);
        e.st = 'idle'; e.t = 1.6; e.pose = 'roar';
        this.boss = e;
        for (const p of this.players.values()) p.hitThisBoss = false;
        this.emit({ t: 'bossSpawn', type });
      }
    } else if (enc.kind === 'champ') {
      this.updateChampion(enc, dt); // champions.js
    } else if (enc.kind === 'trial') {
      const alive = this.hostiles(), pending = pendingSpawns(this);
      if (enc.wave < enc.waves.length - 1 && enc.t <= 0 && !pending && alive === 0) {
        enc.wave++; this.spawnWave(enc.waves[enc.wave]); enc.t = 1.2;
      } else if (enc.wave >= enc.waves.length - 1 && alive === 0 && !pending && enc.t <= 0) {
        this.enc = null; this.locked = false;
        this.run.embers.elites += 4 + this.stratum;
        const c = D.center(this.room);
        this.spawnRelicChoices(c.x, c.y + 10, 'r');
        this.dropGold(c.x, c.y, 10 + 6 * this.stratum);
        this.emit({ t: 'clear', trial: 1 });
      }
    }
  };

  // A wave's threat foes, each from its own spawn zone at least PACE.avoid from every living hero (turrets avoidTurret); a reinforcement (reinf) lands REINF_AVOID away under a bigger telegraph of PACE.reinf s (zone big, {t: 'reinf'}).
  W.spawnWave = function (list) {
    const avoid = this.alivePlayers(), P = ED.World.PACE;
    for (const it of list) {
      const def = ED.ENEMIES[it.type], big = !!it.reinf;
      const pt = D.randomFloor(this.room, this.rng, avoid, big ? ED.World.REINF_AVOID : def.ai === 'turret' ? P.avoidTurret : P.avoid);
      this.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: def.r + (big ? 14 : 4), dur: big ? P.reinf : P.spawn + this.rng.range(0, P.spawnVar), type: it.type, elite: !!it.elite, affix: it.affix, plan: 1, big: big ? 1 : 0 });
      if (big) this.emit({ t: 'reinf', x: Math.round(pt.x), y: Math.round(pt.y), type: it.type, el: it.elite ? 1 : 0 });
    }
  };

  // Clearing pays embers and gold and leaves the room's pre-announced reward at its centre (a dark room's reward goes up one REWARD_UP step, announced by an 'upgrade' event).
  W.roomCleared = function () {
    const rs = this.roomState[this.roomId], room = this.room;
    rs.cleared = true;
    this.locked = false;
    for (const q of this.players.values()) q.mantleAmt = 0; // a Mantle shield is spent with the room
    const s = this.stratum;
    this.run.roomsCleared++;
    if (room.dark) this.run.darkCleared++;
    if (room.type === 'champion') this.run.champs = (this.run.champs | 0) | (room.champ === 'mimic' ? 2 : 1); // bit 0 twins, bit 1 mimic (deeds)
    if (room.bell) this.bellClear();
    this.huntedLeave();
    this.run.embers.rooms += 1 + Math.round(s / 2);
    const c = this.alivePlayers()[0] || D.center(room);
    const enc = this.enc;
    if (enc && enc.xpBudget !== undefined && enc.xpBudget > enc.xpOut) this.dropXp(c.x, c.y, enc.xpBudget - enc.xpOut, true); // the clear pile: what the room's xp budget still owes
    this.enc = null;
    this.dropGold(c.x, c.y, 3 + Math.round(1.5 * s));
    if (room.reward) {
      const m = D.clearSpot(room, D.center(room).x, D.center(room).y);
      let item = room.reward;
      const up = room.dark ? ED.World.REWARD_UP[item] : null;
      if (up) { item = up; this.emit({ t: 'upgrade', to: up, x: Math.round(m.x), y: Math.round(m.y) }); }
      this.props.push({ id: U.uid(), kind: 'reward', x: m.x, y: m.y, item, group: U.uid(), state: 0 });
    }
    this.checkFullClear(room);
    this.computeFlow();
    this.emit({ t: 'clear' });
    this.floorFights = (this.floorFights || 0) + 1;
    if (this.floor.platino === this.floorFights) this.spawnPlatino();
  };

  // p, src: the killing hero and the hit's source (killEnemy). Secrets: One Face (a party of four of one hero downs a stratum boss); at the Hollow King, Thread of Life (a standing hero below THREAD_HP of max health),
  // Toll for Thee (the Bellwarden's killing hit is a Peal hit: part 'peal.*') and the Against the Grain announcement (its field already holds; victory decides it in meta.js).
  const THREAD_HP = 0.03;
  W.onBossKilled = function (e, p, src) {
    const s = this.stratum;
    if (this.players.size === ED.CONST.MAX_PLAYERS) { let one = null, same = true; for (const q of this.players.values()) { if (one === null) one = q.cls; else if (q.cls !== one) same = false; } if (same) this.secretW('oneFace'); }
    if (s >= ED.CONST.STRATA) {
      for (const q of this.players.values()) {
        if (!q.downed && !q.dead && q.hp < q.maxHp * THREAD_HP) this.secretP(q, 'thread');
        if (q.sec.contrarian) this.emit({ t: 'secret', pid: q.pid });
      }
      if (p && p.cls === 'bell' && src && src.part && src.part.indexOf('peal.') === 0) this.secretP(p, 'heroSecret');
    }
    this.run.bosses |= 1 << (s - 1);
    this.run.bossCount++;
    this.run.embers.bosses += 8 * s;
    if (![...this.players.values()].some(p => p.hitThisBoss)) this.run.flawlessBoss = true;
    for (const x of this.enemies) if (x !== e && x.hp > 0) { x.hp = 0; this.emit({ t: 'die', x: Math.round(x.x), y: Math.round(x.y), type: x.type, el: 0, r: x.r }); }
    for (const q of this.projs) if (q.team !== 0) q.dead = true; // flagged, not refiltered: the kill may land inside the projectile/zone loops, which end by reassigning their own keep list
    for (const z of this.zones) if (z.team !== 0) z.dead = true;
    this.boss = null; this.enc = null; this.locked = false;
    if (ED.Arena) ED.Arena.clear(this.room); // the arena (flood, darkness, collapsed floor) ends with the boss
    this.roomState[this.roomId].cleared = true;
    this.emit({ t: 'bossDown', type: e.type, x: Math.round(e.x), y: Math.round(e.y) });
    this.dropXp(e.x, e.y, e.def.xp * (1 + 0.3 * (s - 1)));
    this.dropGold(e.x, e.y, 15 + 6 * s);
    this.spawnPickup('heart', e.x, e.y, 1); this.spawnPickup('heart', e.x, e.y, 1);
    for (const q of this.players.values()) q.mantleAmt = 0;
    if (s === 1) for (const q of this.players.values()) this.grantOffer(q, { src: 'class' }); // the fork offer at the first boss (downed heroes get it when they are back up)
    else if (s === 2 || s === 3) for (const q of this.players.values()) { this.grantForkRank(q); this.grantOffer(q, { src: 'twist' }); } // fork rank 2 and 3 at once and a Twist offer, downed and dead heroes too
    if (s >= ED.CONST.STRATA) {
      this.run.embers.victory = 60;
      this.endRun(true);
      return;
    }
    const c = D.center(this.room);
    if (s === 2) this.spawnRelicChoices(c.x, c.y + 40, 'r'); // boss II: relic hoard; boss III: epic offer; boss I: the class offer only
    else if (s === 3) for (const p of this.players.values()) this.grantOffer(p, { src: 'epic' });
    this.props.push({ id: U.uid(), kind: 'portal', x: c.x, y: c.y - 60, state: 0 });
  };

  // One relic per hero; each hero may claim one relic from a group.
  W.spawnRelicChoices = function (x, y, minRar) {
    const n = this.partySize() + (this.partySize() > 1 ? 0 : 1);
    const group = U.uid();
    const taken = new Set();
    for (let i = 0; i < n; i++) {
      const id = this.rollRelic(minRar, taken);
      taken.add(id);
      this.props.push({ id: U.uid(), kind: 'relic', x: x + (i - (n - 1) / 2) * 56, y, item: id, group, state: 0 });
    }
  };

  // ---------------- props ----------------
  W.makeProps = function (room) {
    const props = [];
    const c = D.center(room);
    const s = this.stratum;
    const id = () => U.uid();
    if (room.type === 'start') {
      if (this.tutorial && s === 1) {
        // Sign 0 (mouse aim) takes the centre slot, 50 px from the solo spawn; the rest fan out to both sides.
        const SLOT = [2, 1, 3, 0, 4];
        SIGNS.forEach((txt, i) => props.push({ id: id(), kind: 'sign', x: c.x + (SLOT[i] - (SIGNS.length - 1) / 2) * 84, y: c.y + 58, text: txt, state: 0 }));
      } else {
        props.push({ id: id(), kind: 'sign', x: c.x, y: c.y + 58, text: ED.biomeFor(s).blurb, state: 0 });
      }
    } else if (room.type === 'treasure') {
      props.push({ id: id(), kind: 'chest', x: c.x, y: c.y, state: 0 });
    } else if (room.type === 'rest') {
      const group = U.uid(); // each hero uses one of the two
      props.push({ id: id(), kind: 'campfire', x: c.x - 44, y: c.y, group, state: 0 });
      props.push({ id: id(), kind: 'anvil', x: c.x + 44, y: c.y, group, state: 0 });
    } else if (room.type === 'shop') {
      props.push({ id: id(), kind: 'merchant', x: c.x, y: c.y - 70, state: 0 });
      const items = [];
      const taken = new Set();
      for (let i = 0; i < 2; i++) { const r = this.rollRelic('c', taken); taken.add(r); items.push({ type: 'relic', item: r }); }
      items.push({ type: 'boon' }, { type: 'forge' }, { type: 'potion' }); // build items: an epic boon and a forge
      items.forEach((it, i) => {
        props.push({ id: id(), kind: 'shop', x: c.x + (i - (items.length - 1) / 2) * 62, y: c.y + 24, item: it.item || it.type, stype: it.type, price: this.priceOf(it), state: 0 });
      });
    } else if (room.type === 'event') {
      const ev = room.event;
      const prop = { id: id(), kind: ev, x: c.x, y: c.y, state: 0 };
      if (ev === 'gamble') prop.price = Math.round(35 + 18 * s);
      props.push(prop);
    }
    return props;
  };

  // A forge is 60 + 15s; everything else scales 12% per stratum. Favor (-4% per rank), the discount stat and the Pact 7 markup (x1.4) apply to all; rounded to 5, minimum 5.
  W.priceOf = function (it) {
    const s = this.stratum;
    let base;
    if (it.type === 'forge') base = 60 + 15 * s;
    else base = (it.type === 'relic' ? ED.RELIC_PRICE[ED.RELICS[it.item].rar] : it.type === 'boon' ? 75 : 30) * (1 + 0.12 * (s - 1));
    let favor = 0, discount = 0;
    for (const p of this.players.values()) {
      favor = Math.max(favor, (p.meta.up && p.meta.up[ED.UPGRADE_IDX.favor]) || 0);
      discount = Math.max(discount, p.stats.discount || 0);
    }
    base *= (1 - ED.UPGRADES[ED.UPGRADE_IDX.favor].discount * favor) * (1 - discount) * (this.pact >= 7 ? 1.4 : 1);
    return Math.max(5, Math.round(base / 5) * 5);
  };

  const PER_HERO_REWARDS = new Set(['boon', 'forge', 'epic', 'vigor', 'twist']);
  const forage = (p, share) => share + ED.World.FORAGER * (p.stats.forager || 0); // a heal share of max HP plus Forager's
  const allClaimed = (w, group) => [...w.players.values()].every(q => q.dead || q.claimed[group]);

  W.interact = function (pid, propId) {
    const p = this.players.get(pid);
    const pr = this.props.find(x => x.id === propId);
    if (!p || !pr || p.downed || p.dead || pr.state) return;
    if (Math.hypot(p.x - pr.x, p.y - pr.y) > 56) return;
    if (this.locked && pr.kind !== 'trial') return;
    const s = this.stratum;
    switch (pr.kind) {
      case 'chest': {
        pr.state = 1;
        this.emit({ t: 'chest', x: pr.x, y: pr.y });
        this.spawnRelicChoices(pr.x, pr.y + 46, 'c');
        this.dropGold(pr.x, pr.y, 5 + 3 * s);
        break;
      }
      case 'reward': {
        const item = pr.item;
        if (PER_HERO_REWARDS.has(item)) {
          // every hero claims once; the prop stays until all have
          if (p.claimed[pr.group]) { this.msgs.push({ to: pid, t: 'toast', text: 'You already claimed this reward.' }); return; }
          p.claimed[pr.group] = true;
          if (item === 'boon') this.grantOffer(p, { src: 'room' });
          else if (item === 'vigor') { p.bonusHp += 2; this.recalc(p, false); this.healPlayer(p, p.maxHp * forage(p, 0.2)); this.sendBuild(p); }
          else this.grantOffer(p, { src: item }); // forge, epic, twist
          this.msgs.push({ to: pid, t: 'claimed', group: pr.group });
          if (allClaimed(this, pr.group)) pr.state = 1;
        } else {
          pr.state = 1;
          if (item === 'gold') this.dropGold(pr.x, pr.y + 18, ED.World.rewardGold(s), true);
          else if (item === 'relic') this.spawnRelicChoices(pr.x, pr.y + 46, 'r');
        }
        this.emit({ t: 'claim', pid, item, x: pr.x, y: pr.y });
        break;
      }
      case 'campfire':
      case 'anvil': {
        // one use per hero across both props of the rest site
        if (p.claimed[pr.group]) { this.msgs.push({ to: pid, t: 'toast', text: 'You already used this rest site.' }); return; }
        p.claimed[pr.group] = true;
        if (pr.kind === 'campfire') this.healPlayer(p, p.maxHp * forage(p, 0.35));
        else this.grantOffer(p, { src: 'forge' });
        this.msgs.push({ to: pid, t: 'claimed', group: pr.group });
        this.emit({ t: 'claim', pid, item: pr.kind, x: pr.x, y: pr.y });
        if (allClaimed(this, pr.group)) for (const o of this.props) if (o.group === pr.group) o.state = 1;
        break;
      }
      case 'relic': {
        if (p.claimed[pr.group]) { this.msgs.push({ to: pid, t: 'toast', text: 'You already took a relic from this hoard.' }); return; }
        p.claimed[pr.group] = true;
        pr.state = 1;
        this.giveRelic(p, pr.item);
        this.msgs.push({ to: pid, t: 'claimed', group: pr.group });
        // once every hero has chosen, the rest of the hoard crumbles
        if ([...this.players.values()].every(q => q.claimed[pr.group])) {
          for (const o of this.props) if (o.kind === 'relic' && o.group === pr.group && !o.state) { o.state = 1; this.emit({ t: 'puff', x: o.x, y: o.y - 20, c: ED.RARITY[ED.RELICS[o.item].rar].color }); }
        }
        break;
      }
      case 'shop': {
        if (this.gold < pr.price) { this.msgs.push({ to: pid, t: 'toast', text: 'Not enough gold.' }); return; }
        this.gold -= pr.price; pr.state = 1;
        this.emit({ t: 'buy', pid, x: pr.x, y: pr.y });
        if (pr.stype === 'relic') this.giveRelic(p, pr.item);
        else if (pr.stype === 'potion') this.healPlayer(p, p.maxHp * forage(p, 0.4));
        else if (pr.stype === 'boon') this.grantOffer(p, { src: 'epic' });
        else if (pr.stype === 'forge') this.grantOffer(p, { src: 'forge' });
        break;
      }
      case 'fountain': {
        pr.state = 1;
        for (const q of this.players.values()) { if (q.downed) { q.downed = false; q.hp = 1; } this.healPlayer(q, q.maxHp * forage(q, 0.5)); }
        this.emit({ t: 'fountain', x: pr.x, y: pr.y });
        break;
      }
      case 'altar': {
        pr.state = 1;
        const cost = Math.round(p.maxHp * 0.2);
        p.hp = Math.max(1, p.hp - cost);
        this.grantOffer(p, { src: 'epic' });
        this.emit({ t: 'altar', pid, x: pr.x, y: pr.y, v: cost });
        break;
      }
      case 'gamble': {
        if (this.gold < pr.price) { this.msgs.push({ to: pid, t: 'toast', text: 'Not enough gold.' }); return; }
        this.gold -= pr.price; pr.state = 1;
        const roll = this.rng.next();
        const rar = roll < 0.12 ? 'e' : roll < 0.5 ? 'r' : 'c';
        this.giveRelic(p, this.rollRelic(rar));
        this.emit({ t: 'gamble', x: pr.x, y: pr.y });
        break;
      }
      case 'trial': {
        pr.state = 1;
        this.locked = true;
        const biome = ED.biomeFor(s), roster = rosterOf(biome);
        const n = this.partySize();
        const w1 = [{ type: biome.elite, elite: true }], w2 = [{ type: biome.elite, elite: true }];
        for (let i = 0; i < 2 + n; i++) w1.push({ type: roster[i % roster.length][0] });
        for (let i = 0; i < 3 + n; i++) w2.push({ type: roster[(i + 1) % roster.length][0], elite: i === 0 });
        this.enc = { kind: 'trial', waves: [w1, w2], wave: -1, t: 0.6 };
        this.emit({ t: 'lock' });
        break;
      }
      case 'portal': {
        pr.state = 1;
        this.collectAll();
        this.pendingStratum = { s: s + 1, t: 1.4 };
        this.emit({ t: 'descend', s: s + 1 });
        break;
      }
      default: return;
    }
  };

  // ---------------- the Drowned Bell (floor gen room.bell) ----------------
  // A hero's damaging hit within BELL_R of the bell rings it once per hero per run while the room's fight is on ({ t: 'bellrung', pid, x, y }). From then until the room clears the hero stays at or above BELL_HP of max health
  // (combat.js hurtPlayer breaks the watch) → p.sec.bellRung at the clear.
  const BELL_R = 14;
  ED.CONST.BELL_HP = 0.5;
  W.ringBell = function (p) {
    const b = this.room.bell;
    if (!p || p.bellS || p.downed || p.dead || !this.locked || this.roomState[this.roomId].cleared) return;
    p.bellS = p.hp < p.maxHp * ED.CONST.BELL_HP ? 2 : 1;
    this.emit({ t: 'bellrung', pid: p.pid, x: Math.round(b.x), y: Math.round(b.y) });
  };
  W.bellClear = function () {
    for (const p of this.players.values()) {
      if (p.bellS !== 1) continue;
      if (!p.downed && !p.dead && p.hp >= p.maxHp * ED.CONST.BELL_HP) { p.bellS = 3; this.secretP(p, 'bellRung'); } else p.bellS = 2;
    }
  };

  // ---------------- Hunted (Twist: stats.twHunted) ----------------
  // While any hero holds Hunted, a combat or elite room's second wave brings one champion: the biome elite with one affix from DARK_AFFIXES, e.hunted (snapshot flag bit 27), no xp (unplanned).
  // It never holds the room (hostiles and the pending-spawn counts skip it). Its kill grants every Hunted holder a room offer (opens once the room is safe); at the clear it leaves with a puff, its shots and telegraphs with it.
  const NO_AFFIX2 = ED.World.AFFIX2.map(() => 0);
  const huntedParty = (w) => { for (const p of w.players.values()) if (p.stats.twHunted > 0) return true; return false; };
  W.spawnHunted = function (enc) {
    const type = ED.biomeFor(this.stratum).elite, def = ED.ENEMIES[type], affix = this.rng.pick(ED.World.DARK_AFFIXES);
    const pt = D.randomFloor(this.room, this.rng, this.alivePlayers(), ED.World.PACE.avoid);
    this.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: def.r + 4, dur: ED.World.PACE.spawn, type, hunt: 1, after: (e) => {
      const a2 = ED.World.AFFIX2; ED.World.AFFIX2 = NO_AFFIX2; // one affix only
      try { this.makeElite(e, affix); } finally { ED.World.AFFIX2 = a2; }
      e.hunted = true; enc.hunt = e;
    } });
  };
  W.huntedPaid = function (enc) {
    enc.huntPaid = true;
    for (const p of this.players.values()) if (p.stats.twHunted > 0) this.grantOffer(p, { src: 'room' });
  };
  W.huntedLeave = function () {
    for (const z of this.zones) if (z.hunt) z.dead = true;
    for (const e of this.enemies) {
      if (!e.hunted || e.hp <= 0) continue;
      e.hp = 0;
      for (const z of this.zones) if (z.src === e) z.dead = true;
      for (const q of this.projs) if (q.src === e) q.dead = true;
      this.emit({ t: 'puff', x: Math.round(e.x), y: Math.round(e.y), c: '#e8344e' });
    }
  };

  // ---------------- the Platino (floor.platino: the fight clear on the floor that lets it out) ----------------
  // Out on a floor spot (PLATINO.avoid from every hero) at the floor.platino-th fight clear of its floor: wanders at wander px/s, flees heroes within flee at speed px/s (steering at turn rad/s, probing probe px ahead for open floor), gone after life s with a puff.
  // A hero touching it (within touch of the body) catches it: { t: 'platino', pid, x, y } and p.sec.platino. Own RNG stream; never in this.enemies (no hits, no aim, no bot target), drops nothing.
  const PLATINO = { speed: 130, wander: 60, flee: 190, turn: 7, probe: 24, life: 12, r: 7, touch: 6, avoid: 140 };
  ED.World.PLATINO = PLATINO;
  W.spawnPlatino = function () {
    const rng = U.RNG(((this.floorSeed ^ 0x51a7c0de) >>> 0) + this.roomId * 977);
    const pt = D.randomFloor(this.room, rng, this.alivePlayers(), PLATINO.avoid);
    this.critter = { x: pt.x, y: pt.y, r: PLATINO.r, a: rng.range(0, U.TAU), wa: 0, wt: 0, t: PLATINO.life, face: 1, rng };
    this.emit({ t: 'puff', x: Math.round(pt.x), y: Math.round(pt.y), c: '#e8f0ff' });
  };
  const OPEN = (t) => t === 0 || t === 4;
  W.updatePlatino = function (dt) {
    const c = this.critter, room = this.room, P = PLATINO;
    if ((c.t -= dt) <= 0) { this.critter = null; this.emit({ t: 'puff', x: Math.round(c.x), y: Math.round(c.y), c: '#e8f0ff' }); return; }
    let fx = 0, fy = 0;
    for (const p of this.players.values()) {
      if (p.downed || p.dead) continue;
      const dx = c.x - p.x, dy = c.y - p.y, d2 = dx * dx + dy * dy, rr = p.r + c.r + P.touch;
      if (d2 < rr * rr) { this.critter = null; this.emit({ t: 'platino', pid: p.pid, x: Math.round(c.x), y: Math.round(c.y) }); this.secretP(p, 'platino'); return; }
      if (d2 < P.flee * P.flee) { const d = Math.sqrt(d2) || 1, k = 1 - d / P.flee; fx += dx / d * k; fy += dy / d * k; }
    }
    const fleeing = fx !== 0 || fy !== 0;
    if (fleeing) c.a += U.clamp(U.angDiff(c.a, Math.atan2(fy, fx)), -P.turn * dt, P.turn * dt);
    else { if ((c.wt -= dt) <= 0) { c.wt = c.rng.range(0.5, 1.3); c.wa = c.rng.range(-2.5, 2.5); } c.a += c.wa * dt; }
    for (let i = 0; i < 9; i++) { // the first heading of a, a ± 0.5, ± 1, ± 1.6, ± 2.4 with open floor probe px ahead
      const a = c.a + (i === 0 ? 0 : (i & 1 ? 1 : -1) * [0.5, 1, 1.6, 2.4][(i - 1) >> 1]);
      if (OPEN(D.tileAt(room, c.x + Math.cos(a) * P.probe, c.y + Math.sin(a) * P.probe))) { c.a = a; break; }
    }
    const sp = fleeing ? P.speed : P.wander;
    ED.Sim.moveCircle(c, Math.cos(c.a) * sp * dt, Math.sin(c.a) * sp * dt, room, true, false);
    if (Math.abs(Math.cos(c.a)) > 0.2) c.face = Math.cos(c.a) < 0 ? -1 : 1;
  };

  // ---------------- breakable props ----------------
  // room.breakables (floor gen) break to a hero hit: roomState.broken is a bit mask over them. A smash drops gold (SMASH_GOLD of the time, 1-3, exact: the gold multiplier does not apply twice) and, separately, a heart (SMASH_HEART); no xp.
  const SMASH_R = 9, SMASH_GOLD = 0.25, SMASH_HEART = 0.01; // SMASH_R: px around a breakable's feet a hero hit must reach
  W.smashBreakable = function (i, p) {
    const bs = this.room.breakables, rs = this.roomState[this.roomId], b = bs[i];
    if (!b || (rs.broken & (1 << i))) return false;
    rs.broken |= 1 << i;
    const x = Math.round(b.x * T), y = Math.round(b.y * T);
    this.emit({ t: 'smash', i, x, y, k: b.k, r: this.roomId });
    if (this.rng.chance(SMASH_GOLD)) this.dropGold(x, y, 1 + this.rng.int(0, 2), true);
    if (this.rng.chance(SMASH_HEART)) this.spawnPickup('heart', x, y, 1);
    return true;
  };
  // Hero hits on the room's unbroken breakables (at most 8, a plain loop) and on the Drowned Bell: a circle (x, y, r), the segment (x0, y0)-(x1, y1) swept by a body of radius r, or the sector of reach and arc around the hero's facing a.
  W.smashCircle = function (p, x, y, r) {
    if (this.room.arena) this.wallCircle(p, x, y, r + 4); // boss walls (arena.js)
    const bl = this.room.bell; if (bl && p && !p.bellS && U.dist2(bl.x, bl.y, x, y) <= (BELL_R + r) * (BELL_R + r)) this.ringBell(p);
    const bs = this.room.breakables; if (!bs.length) return;
    const rs = this.roomState[this.roomId], rr = (SMASH_R + r) * (SMASH_R + r);
    for (let i = 0; i < bs.length; i++) {
      if (rs.broken & (1 << i)) continue;
      const dx = bs[i].x * T - x, dy = bs[i].y * T - y;
      if (dx * dx + dy * dy <= rr) this.smashBreakable(i, p);
    }
  };
  W.smashSeg = function (p, x0, y0, x1, y1, r, noRing) {
    if (this.room.arena) this.wallSeg(p, x0, y0, x1, y1, r + 4);
    const bl = this.room.bell; if (bl && p && !p.bellS && !noRing && U.segDist2(bl.x, bl.y, x0, y0, x1, y1) <= (BELL_R + r) * (BELL_R + r)) this.ringBell(p);
    const bs = this.room.breakables; if (!bs.length) return;
    const rs = this.roomState[this.roomId], rr = (SMASH_R + r) * (SMASH_R + r);
    for (let i = 0; i < bs.length; i++) {
      if (rs.broken & (1 << i)) continue;
      if (U.segDist2(bs[i].x * T, bs[i].y * T, x0, y0, x1, y1) <= rr) this.smashBreakable(i, p);
    }
  };
  W.smashArc = function (p, a, reach, arc) {
    if (this.room.arena) this.wallArc(p, a, reach, arc);
    const bl = this.room.bell;
    if (bl && p && !p.bellS) { const d = Math.hypot(bl.x - p.x, bl.y - p.y); if (d - BELL_R <= reach && (arc >= 6.2 || Math.abs(U.angDiff(a, Math.atan2(bl.y - p.y, bl.x - p.x))) <= arc / 2 + Math.atan2(BELL_R, Math.max(d, 1)))) this.ringBell(p); }
    const bs = this.room.breakables; if (!bs.length) return;
    const rs = this.roomState[this.roomId];
    for (let i = 0; i < bs.length; i++) {
      if (rs.broken & (1 << i)) continue;
      const dx = bs[i].x * T - p.x, dy = bs[i].y * T - p.y, d = Math.hypot(dx, dy);
      if (d - SMASH_R > reach) continue;
      if (arc < 6.2 && Math.abs(U.angDiff(a, Math.atan2(dy, dx))) > arc / 2 + Math.atan2(SMASH_R, Math.max(d, 1))) continue;
      this.smashBreakable(i, p);
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
