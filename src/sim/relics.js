// Relic engine: each hero's hook lists (p.rh: hook -> the held relic ids that have it), rebuilt on every recalc so a hook no relic holds costs one property check at its call site,
// the dispatch helpers those one-line call sites use (combat.js, world.js, rooms.js, build.js, skills.js), the relic API (removeRelic, relic picks) and every relic's behaviour (ED.RELIC_FX).
// Hooks (this = the world; host only):
//   hitMul(p, e, src) -> added to the hero multiplier · crit(p, e, src) -> true forces the crit · hit(p, e, dmg, crit, src) after a hit lands (never for a relic's own hits, src.relic) · attack(p) -> { mul, crit } for the whole attack
//   hurtPre(p, src) -> true blocks the hit · hurtMul(p, src) -> damage-taken factor · hurt(p, dmg, src) after a hit is taken · lethal(p) -> true when the hero is saved
//   kill(p, e, src) a foe that is not fodder fell to p · lock(p, room) a fight starts · clear(p, room) a fight is won · enter(p, room) a room is entered · cast(p, slot) a skill cast · dash(p) a dash (effects only, never recharge)
//   gold(p, v) -> gold a pickup gives · heart(p, amt) -> health a heart heals · boon(p, id) a boon pick · stratum(p, s) a stratum starts · level(p, level) a level-up · down(p, q) ally q went down · revive(p, q) p revived ally q
//   shop(p, prop) a buy · tick(p, dt) every tick of a standing hero · get(p) the relic was taken
// A non-function field aura (a damage share) puts the holder in the world's aura list: every hero within v.r of a holder adds it to its hits (Banner of Unity).
// p.rs: run counters per relic id (sent with the hero's build: the sheet reads them); p.rt: host-only timers and flags.
(function (ED) {
  'use strict';
  const U = ED.U, W = ED.World.prototype, R = ED.RELICS;
  const FX = ED.RELIC_FX = {};
  const v = (id) => R[id].v;
  const pw = (id, p) => ED.procDmg(R[id], p.stats);
  const big = (e) => !!(e && (e.elite || e.boss || (e.def && e.def.champ))); // elites, champions and bosses
  const addGold = (w, p, n) => { n = Math.round(n); if (!(n > 0)) return; w.gold += n; w.emit({ t: 'gold', v: n, pid: p.pid }); };
  // Foes within r of (x, y) that stand (live, spawned, hittable).
  const foesNear = (w, x, y, r) => {
    const q = w.foeScan(x, y, r), out = [];
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (e.hp > 0 && e.spawnT <= 0 && !e.def.invuln && !e.burrowed && U.dist2(e.x, e.y, x, y) < (r + e.r) * (r + e.r)) out.push(e); }
    w.foeEnd();
    return out;
  };

  // ---------------- hook lists ----------------
  W.relicHooks = function (p) {
    if (!p.rs) p.rs = {};
    if (!p.rt) p.rt = {};
    const rh = {};
    for (const id of p.relics) {
      const f = FX[id];
      if (f) for (const k in f) if (typeof f[k] === 'function') (rh[k] || (rh[k] = [])).push(id);
    }
    p.rh = rh;
    let aura = null; // heroes holding an aura relic: [hero, relic id]
    for (const q of this.players.values()) for (const id of q.relics) if (FX[id] && FX[id].aura) (aura || (aura = [])).push([q, id]);
    this.rAura = aura;
  };
  W.relicFire = function (p, hook, a, b, c, d) { const l = p.rh[hook]; for (let i = 0; i < l.length; i++) FX[l[i]][hook].call(this, p, a, b, c, d); };
  W.relicAny = function (p, hook, a, b) { const l = p.rh[hook]; for (let i = 0; i < l.length; i++) if (FX[l[i]][hook].call(this, p, a, b)) return true; return false; };
  W.relicProd = function (p, hook, a) { const l = p.rh[hook]; let m = 1; for (let i = 0; i < l.length; i++) m *= FX[l[i]][hook].call(this, p, a); return m; };
  W.relicMap = function (p, hook, x) { const l = p.rh[hook]; for (let i = 0; i < l.length; i++) x = FX[l[i]][hook].call(this, p, x); return x; }; // a value passed through every holder of the hook in turn
  // Fires hook for every hero holding it (party moments: a fight starts or is won, a room is entered, a level-up).
  W.relicAll = function (hook, a, b) { for (const p of this.players.values()) if (p.rh && p.rh[hook]) this.relicFire(p, hook, a, b); };
  // What p's relics add to the hero multiplier of a hit: the hitMul hooks plus every aura whose holder stands within its reach of p.
  W.relicHitMul = function (p, e, src) {
    let add = 0;
    const l = p.rh && p.rh.hitMul;
    if (l) for (let i = 0; i < l.length; i++) add += FX[l[i]].hitMul.call(this, p, e, src) || 0;
    const au = this.rAura;
    if (au) for (let i = 0; i < au.length; i++) { const q = au[i][0], a = v(au[i][1]); if (!q.downed && !q.dead && this.players.get(q.pid) === q && U.dist2(q.x, q.y, p.x, p.y) < a.r * a.r) add += FX[au[i][1]].aura; }
    return add;
  };
  // The factor and forced crit the attack hooks give one attack (a shared object, read at once).
  const ATK = { mul: 1, crit: false };
  W.relicAttack = function (p) {
    ATK.mul = 1; ATK.crit = false;
    const l = p.rh.attack;
    for (let i = 0; i < l.length; i++) { const o = FX[l[i]].attack.call(this, p); if (o) { ATK.mul *= o.mul || 1; if (o.crit) ATK.crit = true; } }
    return ATK;
  };
  // True when any hero holds relic id.
  W.relicHeld = function (id) { for (const p of this.players.values()) if (p.relics.indexOf(id) >= 0) return true; return false; };

  // ---------------- relic API ----------------
  // Takes relic id from p (CB-2): stats rebuilt and synced as giveRelic does; false when p does not hold it.
  W.removeRelic = function (p, id) {
    const i = p ? p.relics.indexOf(id) : -1;
    if (i < 0) return false;
    p.relics.splice(i, 1);
    delete p.rs[id];
    this.recalc(p, false);
    this.emit({ t: 'puff', x: Math.round(p.x), y: Math.round(p.y - 10), c: ED.RARITY[R[id].rar].color });
    this.sendBuild(p);
    return true;
  };
  // A curse's lift counter for p: one step; at lift.n the curse is gone (a toast tells its hero), else the build carries the count to the sheet.
  W.liftStep = function (p, id) {
    const n = (p.rs[id] | 0) + 1;
    if (n >= R[id].lift.n) { this.removeRelic(p, id); this.msgs.push({ to: p.pid, t: 'toast', text: R[id].name + ' is lifted.', info: true }); this.emit({ t: 'lifted', pid: p.pid, id, x: Math.round(p.x), y: Math.round(p.y) }); return; }
    p.rs[id] = n;
    this.sendBuild(p);
  };

  // Relic picks (elite, champion and boss rewards): every hero gets PICKS relics of its own (4 with Void Stone; owner = its pid, one group per hero) at the same spots in a row at (x, y);
  // the others see none (CB-5). Taking one crumbles the hero's others (rooms.js interact). minRar: 'c', 'r' or 'e' (that rarity or better) or 'boss'.
  W.PICKS = 3;
  W.spawnRelicPicks = function (x, y, minRar) {
    for (const p of this.players.values()) {
      const n = W.PICKS + (p.relics.indexOf('voidstone') >= 0 ? 1 : 0), group = U.uid(), taken = new Set();
      for (let i = 0; i < n; i++) {
        const id = this.rollRelic(minRar, taken);
        taken.add(id);
        this.props.push({ id: U.uid(), kind: 'relic', x: x + (i - (n - 1) / 2) * 56, y, item: id, group, owner: p.pid, state: 0 });
      }
    }
  };

  // ---------------- behaviour ----------------
  // An every-Nth attack relic: o on the empowered attack, which emits 'rproc' (the client's relic chime).
  const atkEvery = (id, o) => function (p) { if (p.atkCount % v(id).every) return null; this.emit({ t: 'rproc', pid: p.pid, k: id, x: Math.round(p.x), y: Math.round(p.y) }); return o; };
  // Explorer's Compass: unknown event rooms reachable within v.rows rows above the party's room get their identity (each reveal draws one event from the run's pool).
  const reveal = (w) => { if (!w.patchRoom || !w.room || !ED.Events) return; const top = w.room.row + v('compass').rows; for (const r of ED.Events.ahead(w)) if (r.row <= top && r.type === 'event' && !r.event) w.patchRoom(r.id, { reveal: true }); };
  const KNOCK = (w, p, list, k) => { for (const e of list) { if (e.boss) continue; const d = Math.hypot(e.x - p.x, e.y - p.y) || 1; e.kbx += (e.x - p.x) / d * k; e.kby += (e.y - p.y) / d * k; } };
  Object.assign(FX, {
    // common
    whetstone: { attack: atkEvery('whetstone', { mul: 1 + R.whetstone.v.mul }) },
    lodestone: { heart(p, amt) { return amt * v('lodestone').heart; } },
    pauldron: {
      hurt(p, dmg, src) {
        const e = src.e;
        if (!e || e.hp <= 0 || src.hazard) return;
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        this.hitEnemy(e, pw('pauldron', p), { p, kind: 'thorns', noProc: true, crit: false, relic: 'pauldron', knock: 160, kx: (e.x - p.x) / d, ky: (e.y - p.y) / d });
      },
    },
    coin: { gold(p, n) { const c = v('coin'); return this.rng.chance(c.ch) ? n * c.x : n; } },
    elixir: {
      stratum(p) { p.rt.elixir = false; },
      hurt(p) { const c = v('elixir'); if (p.hp > 0 && p.hp < p.maxHp * c.at && !p.rt.elixir) { p.rt.elixir = true; this.healPlayer(p, p.maxHp * c.heal); } },
    },
    boots: {
      dash(p) { p.rt.boots = this.time + v('boots').t; },
      hitMul(p, e, src) { return src.wpn && this.time < (p.rt.boots || -1) ? v('boots').mul : 0; },
    },
    buckler: {
      lock(p) { p.rt.buckler = true; },
      hurtPre(p, src) {
        if (!p.rt.buckler || src.hazard) return false;
        p.rt.buckler = false; p.invuln = 0.4;
        this.emit({ t: 'block', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), k: 'buckler' });
        return true;
      },
    },
    hourglass: { lock(p) { this.refundSkill(p, 0); this.refundSkill(p, 1); if (p.stats.skill3Charges) this.refundSkill(p, 2); } },
    glasseye: { crit(p, e) { return e.hp >= e.maxHp; } },
    lantern: { hitMul() { return this.room && this.room.dark ? v('lantern').mul : 0; } },
    pristine: { hitMul(p) { return p.hp >= p.maxHp ? v('pristine').mul : 0; } },
    rage: { hitMul(p) { const c = v('rage'); return p.hp < p.maxHp * c.at ? c.mul : 0; } },
    wraps: { hitMul(p, e) { const c = v('wraps'), d = Math.hypot(e.x - p.x, e.y - p.y) - e.r; return d <= c.near ? c.up : d > c.far ? -c.down : 0; } },
    spyglass: { hitMul(p, e) { const c = v('spyglass'), d = Math.hypot(e.x - p.x, e.y - p.y) - e.r; return d > c.far ? c.up : d <= c.near ? -c.down : 0; } },
    bandage: { clear(p) { this.healPlayer(p, v('bandage').heal); } },
    gust: { dash(p) { this.explode(p.x, p.y, v('gust').r, pw('gust', p), 0, p, 'shock', true, { relic: 'gust', knock: 220 }); } },
    warchest: { get(p) { addGold(this, p, v('warchest').gold); }, stratum(p) { addGold(this, p, v('warchest').gold); } },
    quill: { boon(p) { addGold(this, p, v('quill').gold); } },
    clover: { get(p) { p.rerolls++; } },
    ledger: {}, // rooms.js makeProps: one more shop relic while any hero holds it
    haggle: {
      enter(p, room) { if (room.type === 'shop') p.rt.haggle = this.roomEpoch; },
      shop(p, pr) { if (p.rt.haggle !== this.roomEpoch) return; p.rt.haggle = 0; addGold(this, p, pr.price * v('haggle').back); },
    },
    compass: {
      get() { reveal(this); },
      enter(p, room) { reveal(this); if (room.type === 'event') addGold(this, p, v('compass').gold); },
    },
    tooth: { kill(p, e) { const c = v('tooth'); this.grantCrits(p, e.elite ? c.elite : c.kill, c.cap, 'add'); } },
    piggy: { enter(p, room) { if (room.type === 'shop') { const c = v('piggy'); addGold(this, p, Math.min(c.max, this.gold * c.pct)); } } },
    lifeline: {
      revive(p, q) { q.hp = Math.max(q.hp, Math.round(q.maxHp * v('lifeline').hp)); },
      stratum(p) { p.rt.life = false; },
      hurt(p) {
        const c = v('lifeline');
        if (p.rt.life || !(p.hp > 0) || p.hp >= p.maxHp * c.at) return;
        p.rt.life = true;
        const list = foesNear(this, p.x, p.y, c.r);
        for (const e of list) this.stunFoe(e, c.stun);
        KNOCK(this, p, list, 320);
        this.emit({ t: 'nova', x: Math.round(p.x), y: Math.round(p.y), r: c.r, c: ED.RARITY.c.color });
      },
    },
    contract: { kill(p, e) { const c = v('contract'), n = e.def.champ ? c.champ : e.elite ? c.elite : 0; if (n) this.dropGold(e.x, e.y, n, true); } },
    star: { level(p) { const c = v('star'); this.grantCrits(p, c.crits, 3, 'add'); this.healPlayer(p, c.heal); } },
    // rare
    cloak: { dash(p) { p.stealthT = Math.max(p.stealthT || 0, v('cloak').t); } },
    wardrum: { hitMul(p) { const c = v('wardrum'); return p.toughRoom ? c.up : this.locked ? -c.down : 0; } },
    axe: {
      hit(p, e) {
        const c = v('axe');
        if (e.hp > 0 && !e.boss && !e.def.champ && !e.def.invuln && e.hp < e.maxHp * (e.elite ? c.elite : c.at)) this.killEnemy(e, p, { kind: 'execute', relic: 'axe' });
      },
    },
    mirror: {
      hurtPre(p, src) {
        if (!src.proj) return false;
        p.rt.mirror = (p.rt.mirror | 0) + 1;
        if (p.rt.mirror % v('mirror').every) return false;
        this.emit({ t: 'block', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), k: 'mirror' });
        return true;
      },
    },
    banner: { aura: R.banner.v.mul },
    bloodstone: { heart(p, amt) { return amt * v('bloodstone').heart; } },
    nail: {
      hitMul(p, e) { const c = v('nail'); return e.rnP === p.pid ? Math.min(c.max, c.per * e.rnN) : 0; },
      hit(p, e, dmg, crit, src) { if (src.kind === 'dot') return; if (e.rnP !== p.pid) { e.rnP = p.pid; e.rnN = 0; } e.rnN++; },
    },
    keg: { kill(p, e, src) { if (src.relic !== 'keg') this.explode(e.x, e.y, v('keg').r, pw('keg', p), 0, p, 'shock', true, { relic: 'keg' }); } },
    lens: {
      cast(p) { p.rt.lens = this.time + v('lens').t; },
      hitMul(p, e, src) { return src.wpn && this.time < (p.rt.lens || -1) ? v('lens').mul : 0; },
    },
    rune: { cast(p, slot) { if (slot > 1) return; p.rs.rune = ((p.rs.rune | 0) + 1) % v('rune').every; if (!p.rs.rune) this.refundSkill(p, slot); } },
    core: { hitMul(p, e, src) { const c = v('core'); return src.kind === 'skill' ? c.up : src.kind === 'weapon' ? -c.down : 0; } },
    stoneskin: { hurtMul(p) { const c = v('stoneskin'); return (p.stillT || 0) >= c.t ? c.mul : 1; } },
    lastbreath: {
      hurtPre(p, src) {
        const c = v('lastbreath');
        if (src.hazard || !(p.hp < p.maxHp * c.at) || !this.rng.chance(c.ch)) return false;
        p.invuln = 0.25;
        this.emit({ t: 'block', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y), k: 'lastbreath' });
        return true;
      },
    },
    oath: {
      lock(p) { p.rt.oath = false; },
      down(p) { oathOn(this, p); },
      hurt(p) { if (p.hp > 0 && p.hp < p.maxHp * v('oath').at) oathOn(this, p); },
      hitMul(p) { return this.time < (p.rt.oathT || -1) ? v('oath').mul : 0; },
    },
    dice: { get() { diceRoll(this); }, stratum() { diceRoll(this); } },
    ink: { get() { inkRooms(this); }, stratum() { inkRooms(this); } },
    relay: {
      heart(p, amt) {
        const c = v('relay');
        if (this.partySize() < 2) return amt * c.solo;
        for (const q of this.players.values()) if (q !== p && U.dist2(q.x, q.y, p.x, p.y) < c.r * c.r) this.healPlayer(q, amt * c.share);
        return amt;
      },
    },
    // epic
    phoenix: {
      lethal(p) {
        if (p.phoenixUsed) return false;
        const c = v('phoenix');
        p.phoenixUsed = true; p.hp = Math.round(p.maxHp * c.hp); p.invuln = 2.2;
        this.emit({ t: 'rise', pid: p.pid, k: 'phoenix', x: p.x, y: p.y });
        this.explode(p.x, p.y, c.r, pw('phoenix', p), 0, p, 'fire', false, { relic: 'phoenix' });
        return true;
      },
    },
    angel: {
      lethal(p) {
        if (p.angelUsed) return false;
        p.angelUsed = true; p.hp = 1; p.invuln = 2.2;
        this.emit({ t: 'rise', pid: p.pid, k: 'angel', x: p.x, y: p.y });
        return true;
      },
    },
    chalice: {
      kill(p, e, src) { // +1 max health per RELICS.chalice.kills kills up to full.hp (growth does not heal); bosses and minion bursts do not count
        const C = R.chalice;
        if (src.kind === 'minionBurst' || e.boss || p.chaliceHp >= C.full.hp) return;
        p.chaliceKills++;
        if (p.chaliceKills % C.kills === 0) { p.chaliceHp++; const hp = p.hp; this.recalc(p, false); p.hp = hp; if (p.chaliceHp % 5 === 0 || p.chaliceHp >= C.full.hp) this.sendBuild(p); }
      },
    },
    kingslayer: { hitMul(p, e) { const c = v('kingslayer'); return big(e) ? c.up : -c.down; } },
    soulcage: {
      kill(p, e) {
        const c = v('soulcage');
        p.rs.soulcage = ((p.rs.soulcage | 0) + 1) % c.every;
        if (p.rs.soulcage) return;
        const list = foesNear(this, e.x, e.y, c.r).sort((a, b) => U.dist2(a.x, a.y, e.x, e.y) - U.dist2(b.x, b.y, e.x, e.y) || a.id - b.id).slice(0, c.n), dmg = pw('soulcage', p);
        for (const t of list) {
          if (t.hp <= 0) continue;
          this.emit({ t: 'nova', x: Math.round(t.x), y: Math.round(t.y), r: Math.round(t.r + 14), c: ED.RARITY.e.color });
          this.hitEnemy(t, dmg, { p, kind: 'relic', noProc: true, crit: false, relic: 'soulcage', knock: 60, kx: 0, ky: -1 });
        }
      },
    },
    thorncrown: { hurt(p, dmg, src) { if (src.e && !src.hazard) this.explode(p.x, p.y, v('thorncrown').r, pw('thorncrown', p), 0, p, 'shock', true, { relic: 'thorncrown', knock: 180 }); } },
    timestop: {
      lock(p) { p.rt.stopT = this.time + v('timestop').t; },
      tick(p) {
        if (!(this.time < (p.rt.stopT || -1))) return;
        for (const e of this.enemies) if (e.hp > 0 && !e.boss && !e.rstop && e.spawnT <= 0) { e.rstop = 1; this.stunFoe(e, v('timestop').stun); }
      },
    },
    metronome: { attack: atkEvery('metronome', { mul: 1 + R.metronome.v.mul, crit: true }) },
    ricochet: {
      hit(p, e, dmg, crit, src) {
        if (!crit || src.kind === 'dot') return;
        const c = v('ricochet'), t = this.nearestEnemy(e.x, e.y, c.r, new Set([e.id]));
        if (t && t.hp > 0) this.hitEnemy(t, dmg * c.share, { p, kind: 'relic', raw: true, noProc: true, crit: false, relic: 'ricochet', x: e.x, y: e.y });
      },
    },
    // boss
    eyeoffate: { get(p) { p.rerolls = 0; }, stratum(p) { p.rerolls = 0; }, level(p) { p.rerolls = 0; } },
    pandora: {
      get(p) {
        const c = v('pandora');
        for (let i = 0; i < c.epics; i++) this.giveRelic(p, this.rollRelic('e'));
        for (let i = 0; i < c.curses; i++) this.giveRelic(p, this.rollRelic('curse'));
      },
    },
    voidstone: { hurtMul(p, src) { return src.e && big(src.e) && !src.e.boss ? v('voidstone').mul : 1; } },
    warpath: { kill(p, e) { if (!e.elite) return; this.spawnPickup('heart', e.x, e.y, 1); this.dropGold(e.x, e.y, v('warpath').gold, true); } },
    ghostlantern: { level(p, L) { if (L % 2) this.grantOffer(p, { src: 'level' }); }, gold() { return 0; } },
    // curses (lift counters are added below)
    c_dread: { hurtMul(p, src) { return src.e && big(src.e) && !src.e.boss ? v('c_dread').mul : 1; } },
    c_clumsy: {
      hitMul(p, e) { return (e.rfh | 0) & (1 << (p.slot | 0)) ? 0 : -v('c_clumsy').mul * p.stats.dmg; }, // about half the hit: the hero multiplier is st.dmg plus the conditional rows
      hit(p, e) { e.rfh = (e.rfh | 0) | (1 << (p.slot | 0)); },
    },
    c_decay: { heart(p, amt) { return amt * v('c_decay').heart; } },
    c_pain: { hurt(p, dmg) { if (dmg > 0 && p.hp > 0) p.hp -= 1; } },
    c_poverty: { gold(p, n) { return Math.round(n * v('c_poverty').mul); } },
  });
  function oathOn(w, p) { if (p.rt.oath) return; p.rt.oath = true; p.rt.oathT = w.time + v('oath').t; w.emit({ t: 'nova', x: Math.round(p.x), y: Math.round(p.y), r: 60, c: ED.RARITY.r.color }); }
  // Loaded Die: every gold reward of a room not yet visited becomes a boon, forge or vigor reward (CB-3 patchRoom; nothing without it).
  function diceRoll(w) {
    if (!w.patchRoom || !w.floor) return;
    for (const r of w.floor.rooms) if (r.reward === 'gold' && !w.roomState[r.id].visited) w.patchRoom(r.id, { reward: w.rng.pick(['boon', 'forge', 'vigor']) });
  }
  // Cartographer's Ink: v.n combat rooms (not dark) on rows past the party's room turn into event rooms (CB-3 patchRoom; nothing without it).
  function inkRooms(w) {
    if (!w.patchRoom || !w.floor) return;
    const row = w.room && w.floor.rooms[w.roomId] === w.room ? w.room.row | 0 : 0; // row 0 in the stratum hook (it runs before the new floor's start room is entered)
    const pool = w.floor.rooms.filter(r => r.type === 'combat' && !r.dark && r.row > row && !w.roomState[r.id].visited);
    for (let i = 0; i < v('ink').n && pool.length; i++) { const r = pool.splice(w.rng.int(0, pool.length - 1), 1)[0]; w.patchRoom(r.id, { type: 'event' }); }
  }
  // Curses with a lift: one counter step per matching moment (kill: foes p kills; elite: elites p kills; clear: fights won; boon: picks; stratum: stratum starts).
  const LIFT_HOOK = { kill: 'kill', elite: 'kill', clear: 'clear', boon: 'boon', stratum: 'stratum' };
  for (const id of ED.RELIC_IDS) {
    const L = R[id].lift;
    if (!L) continue;
    const f = FX[id] || (FX[id] = {}), h = LIFT_HOOK[L.on], prev = f[h];
    f[h] = function (p, a, b, c, d) {
      if (prev) prev.call(this, p, a, b, c, d);
      if (L.on !== 'elite' || (a && a.elite)) this.liftStep(p, id);
    };
  }

  // Attack counters of relics shown by the empower registry (src/data/empower.js, when loaded): test(p) is true when p's next attack is the empowered one. Twin Fang is its own 'twin' entry there.
  if (ED.EMPOWER) {
    const next = (p, n) => ((p.atkCount | 0) + 1) % n === 0;
    ED.EMPOWER.push({ id: 'whetstone', name: 'Whetstone', col: ED.RARITY.c.color, test: (p) => (p.relics || []).indexOf('whetstone') >= 0 && next(p, R.whetstone.v.every) });
    ED.EMPOWER.push({ id: 'metronome', name: 'Metronome', col: ED.RARITY.e.color, test: (p) => (p.relics || []).indexOf('metronome') >= 0 && next(p, R.metronome.v.every) });
  }
})(globalThis.ED || (globalThis.ED = {}));
