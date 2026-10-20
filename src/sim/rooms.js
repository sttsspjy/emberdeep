// Room encounters (waves, bosses), props (chests, shops, shrines, rest sites, rewards, portals) and interactions.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, T = ED.CONST.TILE;
  const W = ED.World.prototype;

  const SIGNS = [
    'Hold J (or click) to attack. Your hero aims for you.',
    'Press K (or right-click) for your skill. Space dashes through danger.',
    'Clear a room to open its doors. The reward inside is shown on the door.',
    'Your lantern burns down as you explore. A dim light makes the Deep stronger.',
    'The skull on your map marks the stratum boss. Tab shows the map.',
  ];

  // Queues a boon offer; plain picks stand in until build.js provides grantOffer.
  const offer = (w, p, spec) => { if (w.grantOffer) w.grantOffer(p, spec); else { p.picks++; if (spec.src === 'epic') p.epicNext = true; } };

  // Regular foes of a biome that exist in the enemy table (rosters may name foes whose definitions land later).
  const rosterOf = (biome) => biome.enemies.filter(r => { const d = ED.ENEMIES[r[0]]; return d && !d.boss && !d.gloom && !d.ally && !d.minion; });

  // Spawn zones that gate wave progress (the Gloom's telegraph does not).
  const pendingSpawns = (w) => w.zones.some(z => z.kind === 'spawn' && !z.gloom);

  // ---------------- encounters ----------------
  W.beginEncounter = function (room, rs) {
    if (room.type === 'combat' || room.type === 'elite') {
      this.locked = true;
      this.enc = { kind: 'waves', waves: this.planWaves(room), wave: -1, t: 0.8 };
      this.emit({ t: 'lock' });
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

  // Budget = base x party x room danger (1 + 0.05 x distance) x dread wave multiplier. Elite rooms: 2 guaranteed elites (3 waves at Pact 10).
  W.planWaves = function (room) {
    const s = this.stratum, n = this.partySize(), dr = this.dread;
    const biome = ED.biomeFor(s), isElite = room.type === 'elite';
    const nW = 2 + (this.pact >= 10 ? 1 : 0);
    const budget = (7 + 2 * s) * this.threat().wave * (1 + 0.6 * (n - 1) + 0.2 * (n - 1) * (n - 2)) * (this.tutorial && s === 1 ? 0.75 : 1) * (room.danger || 1) * dr.wave;
    let roster = rosterOf(biome);
    if (s >= 2 && this.rng.chance(0.35)) {
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
    if (isElite) {
      waves[nW - 1].push({ type: biome.elite, elite: true });
      const first = waves[0];
      if (first.length) first[this.rng.int(0, first.length - 1)].elite = true;
      else first.push({ type: biome.elite, elite: true });
      return waves;
    }
    let eliteCh = 0.28 + (this.pact >= 3 ? 0.4 : 0) + (s >= 4 ? 0.1 : 0);
    if (this.tutorial && s === 1) eliteCh = 0.1;
    eliteCh += dr.elite;
    if (this.rng.chance(eliteCh)) {
      const wv = waves[this.rng.int(Math.min(1, nW - 1), nW - 1)];
      if (this.rng.chance(0.5)) wv.push({ type: biome.elite, elite: true });
      else if (wv.length) wv[this.rng.int(0, wv.length - 1)].elite = true;
    }
    if (s >= 3 && this.rng.chance(0.2 + (this.pact >= 3 ? 0.3 : 0))) waves[nW - 1].push({ type: biome.elite, elite: true });
    return waves;
  };

  W.updateEncounter = function (dt) {
    const enc = this.enc;
    if (!enc) return;
    enc.t -= dt;
    const pending = pendingSpawns(this);
    if (enc.kind === 'waves') {
      const alive = this.hostiles();
      const last = enc.wave >= enc.waves.length - 1;
      if (!last && enc.t <= 0 && !pending && (enc.wave < 0 || alive <= Math.max(1, Math.floor(enc.waves[enc.wave].length * 0.3)))) {
        enc.wave++;
        this.spawnWave(enc.waves[enc.wave]);
        enc.t = 1.2;
      } else if (last && alive === 0 && !pending && enc.t <= 0) {
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
    } else if (enc.kind === 'trial') {
      const alive = this.hostiles();
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

  W.spawnWave = function (list) {
    const avoid = this.alivePlayers();
    for (const it of list) {
      const def = ED.ENEMIES[it.type];
      const pt = D.randomFloor(this.room, this.rng, avoid, def.ai === 'turret' ? 150 : 120);
      this.addZone({ kind: 'spawn', x: pt.x, y: pt.y, r: def.r + 4, dur: 0.85 + this.rng.range(0, 0.35), type: it.type, elite: !!it.elite });
    }
  };

  // Clearing pays embers and gold (x dread bonus) and leaves the room's pre-announced reward at its centre.
  W.roomCleared = function () {
    const rs = this.roomState[this.roomId], room = this.room;
    rs.cleared = true;
    this.locked = false; this.enc = null;
    const s = this.stratum, bonus = this.dread.gold;
    this.run.roomsCleared++;
    this.run.embers.rooms += Math.round((1 + Math.round(s / 2)) * bonus);
    const c = this.alivePlayers()[0] || D.center(room);
    this.dropGold(c.x, c.y, (3 + Math.round(1.5 * s)) * bonus);
    if (this.rng.chance(0.3)) this.spawnPickup('heart', c.x, c.y, 1);
    if (room.reward) {
      const m = D.clearSpot(room, D.center(room).x, D.center(room).y);
      this.props.push({ id: U.uid(), kind: 'reward', x: m.x, y: m.y, item: room.reward, group: U.uid(), state: 0 });
    }
    this.checkFullClear();
    this.computeFlow();
    this.emit({ t: 'clear' });
  };

  W.onBossKilled = function (e) {
    const s = this.stratum;
    this.run.bosses |= 1 << (s - 1);
    this.run.bossCount++;
    this.run.embers.bosses += 8 * s;
    if (this.bossTier === 3) this.run.lightlessBoss = true;
    if (![...this.players.values()].some(p => p.hitThisBoss)) this.run.flawlessBoss = true;
    for (const x of this.enemies) if (x !== e && x.hp > 0) { x.hp = 0; this.emit({ t: 'die', x: Math.round(x.x), y: Math.round(x.y), type: x.type, el: 0, r: x.r }); }
    this.projs = this.projs.filter(p => p.team === 0);
    this.zones = this.zones.filter(z => z.team === 0);
    this.boss = null; this.enc = null; this.locked = false;
    this.roomState[this.roomId].cleared = true;
    this.emit({ t: 'bossDown', type: e.type, x: Math.round(e.x), y: Math.round(e.y) });
    this.dropXp(e.x, e.y, e.def.xp * (1 + 0.3 * (s - 1)));
    this.dropGold(e.x, e.y, 15 + 6 * s);
    this.spawnPickup('heart', e.x, e.y, 1); this.spawnPickup('heart', e.x, e.y, 1);
    if (s >= ED.CONST.STRATA) {
      this.run.embers.victory = 60;
      this.endRun(true);
      return;
    }
    const c = D.center(this.room);
    if (s % 2 === 0) this.spawnRelicChoices(c.x, c.y + 40, 'r');
    else for (const p of this.players.values()) offer(this, p, { src: 'epic' });
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
        SIGNS.forEach((txt, i) => props.push({ id: id(), kind: 'sign', x: c.x + (i - (SIGNS.length - 1) / 2) * 84, y: c.y + 58, text: txt, state: 0 }));
      } else {
        props.push({ id: id(), kind: 'sign', x: c.x, y: c.y + 58, text: ED.biomeFor(s).blurb, state: 0 });
      }
    } else if (room.type === 'treasure') {
      props.push({ id: id(), kind: 'chest', x: c.x, y: c.y, state: 0 });
    } else if (room.type === 'rest') {
      const group = U.uid();
      props.push({ id: id(), kind: 'campfire', x: c.x - 44, y: c.y, group, state: 0 });
      props.push({ id: id(), kind: 'anvil', x: c.x + 44, y: c.y, group, state: 0 });
    } else if (room.type === 'shop') {
      props.push({ id: id(), kind: 'merchant', x: c.x, y: c.y - 70, state: 0 });
      let favor = 0;
      for (const p of this.players.values()) favor = Math.max(favor, (p.meta.up && p.meta.up[ED.UPGRADE_IDX.favor]) || 0);
      const items = [];
      const taken = new Set();
      const nRelics = 2 + (favor >= 2 ? 1 : 0);
      for (let i = 0; i < nRelics; i++) { const r = this.rollRelic('c', taken); taken.add(r); items.push({ type: 'relic', item: r }); }
      items.push({ type: 'boon' });
      items.push({ type: 'potion' });
      items.push({ type: 'oil' });
      items.push({ type: 'forge' });
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

  // Lantern oil is 30 + 12s and a forge is 60 + 15s; everything else scales 12% per stratum. Favor (-10% per rank), the discount stat and the Pact 7 markup (x1.4) apply to all; rounded to 5, minimum 5.
  W.priceOf = function (it) {
    const s = this.stratum;
    let base;
    if (it.type === 'oil') base = 30 + 12 * s;
    else if (it.type === 'forge') base = 60 + 15 * s;
    else base = (it.type === 'relic' ? ED.RELIC_PRICE[ED.RELICS[it.item].rar] : it.type === 'boon' ? 75 : 30) * (1 + 0.12 * (s - 1));
    let favor = 0, discount = 0;
    for (const p of this.players.values()) {
      favor = Math.max(favor, (p.meta.up && p.meta.up[ED.UPGRADE_IDX.favor]) || 0);
      discount = Math.max(discount, p.stats.discount || 0);
    }
    base *= (1 - 0.1 * favor) * (1 - discount) * (this.pact >= 7 ? 1.4 : 1);
    return Math.max(5, Math.round(base / 5) * 5);
  };

  const PER_HERO_REWARDS = new Set(['class', 'forge', 'epic', 'vigor']);
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
        if (item.startsWith('boon:') || PER_HERO_REWARDS.has(item)) {
          // every hero claims once; the prop stays until all have
          if (p.claimed[pr.group]) { this.msgs.push({ to: pid, t: 'toast', text: 'You already claimed this reward.' }); return; }
          p.claimed[pr.group] = true;
          if (item.startsWith('boon:')) offer(this, p, { src: 'room', path: item.slice(5) });
          else if (item === 'vigor') { p.bonusHp += 12; this.recalc(p, false); this.healPlayer(p, p.maxHp * 0.2); this.sendBuild(p); }
          else offer(this, p, { src: item });
          this.msgs.push({ to: pid, t: 'claimed', group: pr.group });
          if (allClaimed(this, pr.group)) pr.state = 1;
        } else {
          pr.state = 1;
          if (item === 'gold') this.dropGold(pr.x, pr.y + 18, ED.World.rewardGold(s, this.dread.gold), true);
          else if (item === 'oil') this.addLight(15, pr.x, pr.y);
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
        if (pr.kind === 'campfire') this.healPlayer(p, p.maxHp * 0.35);
        else offer(this, p, { src: 'forge' });
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
        if (pr.stype === 'oil' && this.light >= this.lightMax - 0.5) { this.msgs.push({ to: pid, t: 'toast', text: 'Your lantern is already full.' }); return; }
        if (this.gold < pr.price) { this.msgs.push({ to: pid, t: 'toast', text: 'Not enough gold.' }); return; }
        this.gold -= pr.price; pr.state = 1;
        this.emit({ t: 'buy', pid, x: pr.x, y: pr.y });
        if (pr.stype === 'relic') this.giveRelic(p, pr.item);
        else if (pr.stype === 'potion') this.healPlayer(p, p.maxHp * 0.4);
        else if (pr.stype === 'boon') offer(this, p, { src: 'epic' });
        else if (pr.stype === 'forge') offer(this, p, { src: 'forge' });
        else if (pr.stype === 'oil') this.addLight(15, pr.x, pr.y);
        break;
      }
      case 'fountain': {
        pr.state = 1;
        for (const q of this.players.values()) { if (q.downed) { q.downed = false; q.hp = 1; } this.healPlayer(q, q.maxHp * 0.5); }
        this.emit({ t: 'fountain', x: pr.x, y: pr.y });
        break;
      }
      case 'altar': {
        pr.state = 1;
        const cost = Math.round(p.maxHp * 0.2);
        p.hp = Math.max(1, p.hp - cost);
        offer(this, p, { src: 'epic' });
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
})(globalThis.ED || (globalThis.ED = {}));
