// A run in progress: owns the authoritative world (solo/host) or a snapshot mirror (client),
// drives the local hero, routes network traffic and feeds events to effects and UI.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, N = ED.Net;
  const G = ED.Game = { s: null };
  const HERO_REWARD = /^(boon$|forge$|epic$|vigor$)/; // reward items every hero claims separately

  // ---------------- client-side mirror of the host's world ----------------
  function Mirror(cfg, localPid) {
    this.players = new Map();
    for (const pd of cfg.players) {
      const p = { pid: pd.pid, name: pd.name, slot: pd.slot, cls: pd.cls, weapon: pd.weapon, meta: pd.meta, boons: {}, relics: [], chaliceHp: 0,
        x: 0, y: 0, r: 10, face: 0, vx: 0, vy: 0, mvx: 1, mvy: 0, hp: 1, maxHp: 1, dashT: 0, invuln: 0, moving: false, downed: false, dead: false, revive: 0 };
      p.stats = ED.Stats.compute({ cls: p.cls, weapon: p.weapon, boons: {}, relics: [], meta: p.meta, pact: cfg.pact });
      p.hp = p.maxHp = p.stats.maxHp;
      p.wear = N.cleanWear(pd.wear, p.cls); // Wardrobe set of the hero pick (cosmetics.js; never read by the sim)
      if (ED.CLS && ED.CLS.bell) ED.CLS.bell.init(p); // bell state (class-bell.js): the own hero predicts it, the others mirror P[24]
      this.players.set(p.pid, p);
    }
    this.localPid = localPid; this.pact = cfg.pact;
    this.enemies = []; this.projs = []; this.pickups = []; this.zones = []; this.allies = []; this.props = [];
    this.floor = null; this.room = null; this.roomId = -1; this.roomState = {}; this.stratum = 0; this.floorSeed = 0;
    this.gold = 0; this.level = 1; this.xp = 0; this.xpNext = 20; this.time = 0; this.locked = false; this.waitMsg = '';
    this.snaps = []; this.renderT = 0; this.run = null; this.eMap = new Map(); this.critter = null;
  }
  Mirror.prototype.recalc = function (p) {
    p.stats = ED.Stats.compute({ cls: p.cls, weapon: p.weapon, boons: p.boons, relics: p.relics, meta: p.meta, pact: this.pact, chaliceHp: p.chaliceHp, bonusHp: p.bonusHp });
  };
  Mirror.prototype.apply = function (d, now) {
    if (d.s !== this.stratum || d.fs !== this.floorSeed) {
      this.stratum = d.s; this.floorSeed = d.fs;
      this.floor = ED.Dungeon.generate(d.s, d.fs);
      this.roomState = {};
      for (const rm of this.floor.rooms) this.roomState[rm.id] = { visited: false, known: false, cleared: false, broken: 0 };
      this.roomId = -1;
    }
    if (d.r !== this.roomId) {
      if (this.room && ED.Arena) ED.Arena.clear(this.room); // the arena of the room left (restores collapsed floor)
      this.roomId = d.r; this.room = this.floor.rooms[d.r]; this.snaps.length = 0; this.firstInRoom = true;
      const tough = this.room.type === 'elite' || this.room.type === 'boss';
      for (const p of this.players.values()) p.toughRoom = tough; // War Drum doubles in these rooms
    }
    this.locked = !!d.L; this.gold = d.g; this.xp = d.x; this.xpNext = d.n; this.level = d.l; this.waitMsg = d.wm; this.time = d.T;
    if (d.O) this.props = d.O.map(a => ({ id: a[0], kind: a[1], x: a[2], y: a[3], state: a[4], item: a[5], price: a[6], group: a[7], stype: a[8], text: a[9], owner: a[10] || '' }));
    if (d.RS) d.RS.forEach((b, i) => { this.roomState[i] = { visited: !!(b & 1), known: !!(b & 2), cleared: !!(b & 4), broken: d.BR ? d.BR[i] | 0 : 0 }; });
    if (d.RUN) this.run = d.RUN;
    if (ED.Arena) ED.Arena.decode(this.room, d.AR || null); // boss / champion arena (flood, darkness, lanterns, collapsed floor, mimic classes)
    const P = new Map(), E = new Map(), H = new Map(), K = new Map(), A = new Map();
    for (const a of d.P) P.set(a[0], a);
    for (const a of d.E) E.set(a[0], a);
    if (d.H) for (const a of d.H) H.set(a[0], a);
    for (const a of d.K) K.set(a[0], a);
    for (const a of d.A) A.set(a[0], a);
    this.snaps.push({ T: d.T, recv: now, P, E, H, K, A, C: d.C || null });
    if (this.snaps.length > 6) this.snaps.shift();
    // per-player vitals are taken straight from the newest snapshot
    for (const a of d.P) {
      const p = this.players.get(a[0]); if (!p) continue;
      p.hp = a[4]; p.maxHp = a[5]; const fl = a[6];
      p.downed = !!(fl & 4); p.dead = !!(fl & 8); p.invuln = fl & 16 ? 0.2 : 0; p.revive = a[7];
      p.critStacks = a[8]; p.aegisT = a[9] ? 1 : 0; p.guardT = a[10] ? 1 : 0; p.secondWind = a[11]; p.phoenixUsed = !!a[12]; p.picks = a[13]; p.rerolls = a[14];
      p.shield = a[15] || 0; p.rdy = a[16] | 0; p.stealthT = fl & 128 ? 1 : 0; p.ambush = !!(fl & 256); p.shieldOut = !!(fl & 64); p.airborne = !!(fl & 512); p.momN = a[17] | 0; p.shwC = a[18] || 0; p.shwA = a[19] || 0;
      if ((a[20] | 0) !== (p.chaliceHp | 0)) { p.chaliceHp = a[20] | 0; this.recalc(p); }
      p.glBuff = !!(fl & 1024); p.embolden = !!(fl & 2048); // Cleric buffs: Guardian Light, Embolden
      p.glT = p.glBuff ? 1 : 0; p.glV = a[22] || 0; p.auraT = p.embolden ? 1 : 0; p.auraV = a[23] || 0; // timed damage bonuses the Tab sheet and Stats read
      p.doorWant = a[26] | 0; p.sparks = a[27] | 0; // the door the hero waits in, Kindling Sparks (the HUD chip)
      if (p.pid !== this.localPid) { p.moving = !!(fl & 1); p.dashing = !!(fl & 2); p.face = a[3]; p.braceT = fl & 1048576 ? 1 : 0; p.tranceT = fl & 4096 ? 1 : 0; p.holdOn = !!(fl & 8192); } // the local hero predicts its own Trance and hold
      else if (this.firstInRoom) { p.x = a[1]; p.y = a[2]; }
    }
    this.firstInRoom = false;
    this.projBase = { T: d.T, recv: now, list: d.B };
    this.zoneBase = { recv: now, list: d.Z };
    for (const p of this.players.values()) { if (!P.has(p.pid)) { this.players.delete(p.pid); } }
    return d.F || [];
  };
  Mirror.prototype.update = function (dt, now) {
    const sn = this.snaps;
    if (!sn.length) return;
    const latest = sn[sn.length - 1];
    const hostNow = latest.T + (now - latest.recv);
    const target = hostNow - 0.1;
    if (!this.renderT || Math.abs(this.renderT - target) > 0.3) this.renderT = target; else this.renderT += dt + (target - this.renderT) * 0.08;
    let a = sn[0], b = sn[0];
    for (let i = 0; i < sn.length; i++) { if (sn[i].T <= this.renderT) a = sn[i]; if (sn[i].T > this.renderT) { b = sn[i]; break; } b = sn[i]; }
    const span = b.T - a.T, k = span > 0 ? U.clamp((this.renderT - a.T) / span, 0, 1) : 1;
    const lerpXY = (ra, rb) => (ra ? [U.lerp(ra[2], rb[2], k), U.lerp(ra[3], rb[3], k)] : [rb[2], rb[3]]);
    // remote heroes (interpolated) — the local hero is simulated locally
    for (const [pid, rb] of b.P) {
      if (pid === this.localPid) continue;
      const p = this.players.get(pid); if (!p) continue;
      const ra = a.P.get(pid);
      p.x = ra ? U.lerp(ra[1], rb[1], k) : rb[1]; p.y = ra ? U.lerp(ra[2], rb[2], k) : rb[2];
      bellInterp(p, ra && ra[24], rb[24], k);
    }
    // enemies
    const out = [];
    for (const [id, rb] of b.E) {
      const ra = a.E.get(id);
      let e = this.eMap.get(id);
      const type = ED.ENEMY_IDS[rb[1]];
      if (!e) { e = { id, type, def: ED.ENEMIES[type] }; this.eMap.set(id, e); }
      const xy = lerpXY(ra, rb);
      e.x = xy[0]; e.y = xy[1]; e.hp = rb[4]; e.maxHp = rb[5]; e.r = rb[6];
      const fl = rb[7];
      e.flash = fl & 1 ? 0.05 : 0; e.frozen = fl & 2 ? 1 : 0; e.stun = fl & 4 ? 1 : 0; e.burnLvl = (fl >> 11) & 3; e.burn = e.burnPool = e.burnLvl > 0 ? 1 : 0; e.chill = rb[16] || 0; e.exposed = !!(fl & 32);
      e.charge = fl & 64 ? 1 : 0; e.bleedPool = fl & 128 ? 1 : 0; e.judged = fl & 256 ? 1 : 0; e.blind = fl & 512 ? 1 : 0; e.vulnT = fl & 1024 ? 1 : 0;
      e.venomLvl = (fl >> 13) & 7; e.radLvl = (fl >> 16) & 3; e.doomLine = rb[17] || 0; // Venom pips (5 = Corroded), Radiance fill, Reap line (bosses: the Toll gauge)
      e.hexed = !!(fl & (1 << 18)); e.marked = !!(fl & (1 << 19)); e.sealed = !!(fl & (1 << 20)); e.ailN = (fl >> 21) & 7; // route states: Hexed, Marked, Sealed, ailment count
      e.burnN = (fl >> 24) & 15; // Burn stacks (the count drawn on the foe)
      e.boss = !!e.def.boss;
      const st = N.ST[rb[8]] || 'move';
      if (e.boss) { e.pose = st; e.st = 'atk'; } else e.st = st;
      e.burrowed = st === 'burrow' && !e.boss;
      e.aimA = rb[9]; e.elite = rb[10] >= 0 ? ED.AFFIX_IDS[rb[10]] : null; e.elite2 = rb[18] >= 0 ? ED.AFFIX_IDS[rb[18]] : null; e.ward = rb[11]; e.wardMax = rb[12]; e.phase = rb[13]; e.face = rb[14]; e.t = rb[15];
      e.furyT = rb[19] || 0; e.furyM = e.furyT > 0 ? ED.World.furyMul(this.stratum || 1, e.furyT) : 1; // boss fury clock (E[19]) and the multiplier the sim derives from it
      out.push(e);
    }
    // fodder rows (net.js H): HP is the sent fraction of World.fodderHp (what spawnEnemy gives), the rest of the foe state is the default one
    if (b.H.size) {
      const s = this.stratum || 1, pact = this.pact;
      for (const [id, rb] of b.H) {
        let e = this.eMap.get(id);
        if (!e || !e.fodder) {
          const type = ED.ENEMY_IDS[rb[1]], def = ED.ENEMIES[type];
          e = { id, type, def, fodder: true, x: 0, y: 0, hp: 1, maxHp: 1, r: def.r, face: 1, flash: 0, frozen: 0, stun: 0, chill: 0, burn: 0, burnPool: 0, burnLvl: 0, st: 'move', elite: null, boss: false, ward: 0, wardMax: 0, phase: 1, aimA: 0, t: 0, burrowed: false };
          this.eMap.set(id, e);
        }
        const xy = lerpXY(a.H.get(id), rb), fl = rb[5];
        e.x = xy[0]; e.y = xy[1]; e.maxHp = ED.World.fodderHp(e.def, s, pact); e.hp = rb[4] / 255 * e.maxHp;
        e.flash = fl & 1 ? 0.05 : 0; e.frozen = fl & 2 ? 1 : 0; e.stun = fl & 4 ? 1 : 0; e.chill = fl & 8 ? 40 : 0; e.burnLvl = fl & 16 ? 1 : 0; e.burn = e.burnPool = e.burnLvl; e.face = fl & 32 ? -1 : 1; e.burnN = (fl >> 6) & 15; e.charge = fl & 1024 ? 1 : 0; // the wire carries chilled and burning as flags: drawn at a mid chill and one flame
        out.push(e);
      }
    }
    if (this.eMap.size > out.length * 2 + 40) { const keep = new Map(); for (const e of out) keep.set(e.id, e); this.eMap = keep; }
    this.enemies = out;
    // pickups & allies
    this.pickups = []; for (const [id, rb] of b.K) { const ra = a.K.get(id); const xy = lerpXY(ra, rb); this.pickups.push({ id, kind: N.PK[rb[1]], x: xy[0], y: xy[1] }); }
    this.allies = []; for (const [id, rb] of b.A) { const ra = a.A.get(id); const xy = lerpXY(ra, rb); this.allies.push({ id, owner: rb[1], x: xy[0], y: xy[1], face: rb[4], k: rb[5] | 0 }); }
    const cb = b.C, ca = a.C; // the Platino (net.js C)
    this.critter = cb ? { x: ca ? U.lerp(ca[0], cb[0], k) : cb[0], y: ca ? U.lerp(ca[1], cb[1], k) : cb[1], face: cb[2] } : null;
    // projectiles: extrapolated to "now" so dodging reads true
    const pb = this.projBase;
    if (pb) {
      const el = Math.min(0.25, hostNow - pb.T);
      this.projs = pb.list.map(q => ({ id: q[0], kind: ED.PROJ_KINDS[q[1]], x: q[2] + q[4] * el, y: q[3] + q[5] * el, vx: q[4], vy: q[5], r: q[6], team: q[7] }));
    }
    const zb = this.zoneBase;
    if (zb) {
      const el = now - zb.recv;
      this.zones = zb.list.map(z => ({ id: z[0], kind: N.ZK[z[1]], x: z[2], y: z[3], r: z[4], t: z[5] + el, dur: z[6], a: z[7], len: z[8], w: z[9], arc: z[10], team: z[11], elite: z[12] === 1, big: z[12] === 2, lob: z[13] > -99999 ? [z[13], z[14]] : null, warm: z[15], str: z[16] || 0, fol: z[17] | 0 }));
      for (const z of this.zones) if (z.fol) for (const p of this.players.values()) if (p.slot === z.fol - 1) { z.x = p.x; z.y = p.y; break; } // a zone that follows its hero is drawn on the hero's smoothed position
    }
  };

  // ---------------- Bellwarden bells on the client ----------------
  // Every drawn bell carries ox / oy (its draw offset from its hero's drawn feet) and s (its state, ED.Bell.STATES). Remote heroes of a client: P[24] interpolated, a hand bell by angle about the hero (an orbit stays round
  // between snapshots), any other in the world. The local hero of a client predicts its own bells with class-bell.js itself (ED.CLS.bell.tick, ED.CAST heave / peal) on BELL_W, a world without foes, shots or effects
  // (pred: a hurl spends no attack count or crit stack), in fixed 1/60 s steps; each snapshot then corrects the prediction against the host's bells at the matching local moment (the send time of the input seq
  // the host echoes plus the time the host ran on it): a hand bell by BELL_ROT of the phase and BELL_SPD of the speed difference (a snap after BELL_BAD snapshots off by a wide margin), an anchored bell to the host's spot,
  // and a bell whose state is not the host's for BELL_STATE snapshots takes the host's when that is in hand or anchored (a flight or a reel runs on its own clock). Resonance is the host's (strikes build it).
  const BELL_ROT = 0.2, BELL_SPD = 0.2, BELL_BAD = 3, BELL_STATE = 2, BELL_HIST = 90, HAND = 0, ANCHOR = 2;
  const wrapA = (d) => d - U.TAU * Math.round(d / U.TAU);
  const NOOP = () => undefined, NONE = [];
  const BELL_W = { pred: true, room: null, locked: false, time: 0, projs: NONE, enemies: NONE, emit: NOOP, foeScan: () => NONE, foeEnd: NOOP, smashCircle: NOOP, hitEnemy: NOOP, explode: NOOP, skillBlast: NOOP, partSrc: NOOP, addShield: () => 0,
    stunFoe: NOOP, slowEnemy: NOOP, addZone: NOOP, nearestEnemy: () => null, discharge: NOOP, evoHit: NOOP, evoLine: NOOP, elementCast: NOOP };
  function bellInterp(p, ra, rb, k) {
    const bs = p.bells || (p.bells = []), H = N.BELL_HEAD, M = N.BELL_N;
    if (!rb) { bs.length = 0; p.bellLeap = null; p.bellWhirl = false; p.bellWind = false; p.bellRes = 0; return; }
    const n = (rb.length - H) / M | 0, same = !!ra && ra.length === rb.length, f = rb[H - 2];
    while (bs.length < n) bs.push({ x: 0, y: 0, vx: 0, vy: 0, ox: 0, oy: 0, s: HAND });
    bs.length = n;
    p.haul = (same ? U.lerp(ra[2], rb[2], k) : rb[2]) / 100; p.bellL = same ? U.lerp(ra[3], rb[3], k) : rb[3];
    p.bellWhirl = !!(f & 1); p.bellHauled = !!(f & 2); p.bellLeap = f & 4 ? p.bellLeap || {} : null; p.bellWind = !!(f & 8); p.bellSpin = f & 32 ? -1 : 1; p.spinT = f & 64 ? 1 : 0; p.bellRes = rb[H - 1] | 0;
    for (let i = 0; i < n; i++) {
      const j = H + M * i, b = bs[i], bx = rb[j], by = rb[j + 1], st = rb[j + 4], both = same && ra[j + 4] === st;
      if (both && st === HAND) {
        const ax = ra[j], ay = ra[j + 1], r0 = Math.hypot(ax, ay), r1 = Math.hypot(bx, by);
        if (r0 > 4 && r1 > 4) { const a0 = Math.atan2(ay, ax), th = a0 + wrapA(Math.atan2(by, bx) - a0) * k, rr = U.lerp(r0, r1, k); b.ox = Math.cos(th) * rr; b.oy = Math.sin(th) * rr; }
        else { b.ox = U.lerp(ax, bx, k); b.oy = U.lerp(ay, by, k); }
      } else if (both) { b.ox = U.lerp(ra[j], bx, k) - p.x; b.oy = U.lerp(ra[j + 1], by, k) - p.y; }
      else if (st === HAND) { b.ox = bx; b.oy = by; } else { b.ox = bx - p.x; b.oy = by - p.y; }
      b.vx = both ? U.lerp(ra[j + 2], rb[j + 2], k) : rb[j + 2]; b.vy = both ? U.lerp(ra[j + 3], rb[j + 3], k) : rb[j + 3];
      b.s = st; b.x = p.x + b.ox; b.y = p.y + b.oy;
    }
  }
  // Prediction state of the local client hero: step remainder acc (al = acc / STEP draws between steps), history of predicted bells (t, lp: an Anchor Leap in flight, b: [x, y, vx, vy, state] per bell as net.js packs them),
  // send time per input seq, st: snapshots each bell has been in another state than the host's. rn / re / rb / rs / rss: corrections made, their summed phase error (rad: absolute, and signed along the turning sense: > 0 the host's
  // bell leads), hand-bell snaps to the host, bells that took the host's state (read by tools/browse.js).
  const bellState = (s) => s.bp || (s.bp = { acc: 0, al: 1, hist: [], sent: new Map(), seq: 0, bad: 0, haul: false, press: 0, near: false, st: [], rn: 0, re: 0, rb: 0, rs: 0, rss: 0 });
  function bellPredict(s, dt, now) {
    const me = s.me, view = s.view;
    if (!me.bells || !me.stats || me.stats.weapon.kind !== 'bell') return;
    const B = bellState(s), w = BELL_W;
    w.room = view.room; w.locked = view.locked;
    if (!w.room || me.downed || me.dead) { B.acc = 0; B.al = 1; if (me.bells.length && ED.CLS.bell.down) ED.CLS.bell.down.call(w, me); return; } // a downed hero's bells come home, as on the host
    B.acc += dt;
    let n = 0;
    while (B.acc >= STEP - 1e-9 && n < MAX_STEPS) {
      const jx = me.lpx === undefined ? 0 : me.x - me.lpx, jy = me.lpy === undefined ? 0 : me.y - me.lpy; // world.js updatePlayer: the hero's measured velocity (the unwound bell trails it)
      if (jx * jx + jy * jy > 576) { me.lvx = 0; me.lvy = 0; } else { const q = Math.min(1, STEP * 10); me.lvx = (me.lvx || 0) + (jx / STEP - (me.lvx || 0)) * q; me.lvy = (me.lvy || 0) + (jy / STEP - (me.lvy || 0)) * q; }
      me.lpx = me.x; me.lpy = me.y;
      w.time += STEP; ED.CLS.bell.tick.call(w, me, STEP);
      B.acc -= STEP; n++;
      const h = B.hist.length >= BELL_HIST ? B.hist.shift() : { t: 0, lp: false, b: [] };
      h.t = now - B.acc; h.lp = !!me.bellLeap; h.b.length = 0;
      for (const b of me.bells) { const hand = b.s === HAND; h.b.push(hand ? b.x - me.bellPx : b.x, hand ? b.y - me.bellPy : b.y, b.vx, b.vy, b.s); }
      B.hist.push(h);
    }
    if (B.acc >= STEP) B.acc = 0;
    B.al = B.acc / STEP;
  }
  // An Anchor Leap or Peal of the local client hero, cast on its predicted bells at once (the host casts the same on its own).
  function bellCast(s, id, aim, data, N) {
    const me = s.me, st = me.stats;
    if (s.mode !== 'client' || !me.bells || st.weapon.kind !== 'bell' || !ED.CAST[id]) return;
    bellState(s); BELL_W.room = s.view.room; BELL_W.locked = s.view.locked;
    if (BELL_W.room) ED.CAST[id].call(BELL_W, me, aim, data || {}, st, N);
  }
  // Anchor Leap's target (class-bell.js ED.Bell.leapTarget on the bells as this machine has them), sent so the host leaps where the hero was shown it would.
  function bellLeapData(s, me, aim) {
    if (!me.bells || !ED.Bell || !ED.Bell.leapTarget) return null;
    const w = s.mode === 'client' ? BELL_W : s.world;
    if (w === BELL_W) { BELL_W.room = s.view.room; BELL_W.locked = s.view.locked; if (!BELL_W.room) return null; }
    const g = ED.Bell.leapTarget(w, me, aim);
    return { x: Math.round(g.x), y: Math.round(g.y) };
  }
  // The predicted bells at local time t, interpolated between the two history steps around it (a hand bell by angle about the carried spot, any other in the world; a bell changing state takes the later step); null outside the
  // history or across an Anchor Leap.
  const PAST = { b: [] };
  function bellPast(B, t) {
    const H = B.hist, M = N.BELL_N;
    for (let i = H.length - 1; i > 0; i--) {
      const h1 = H[i], h0 = H[i - 1];
      if (h0.t > t) continue;
      if (h1.t < t || h0.lp || h1.lp || h0.b.length !== h1.b.length) return null;
      const u = h1.t > h0.t ? (t - h0.t) / (h1.t - h0.t) : 1;
      PAST.b.length = 0;
      for (let j = 0; j < h1.b.length; j += M) {
        const s0 = h0.b[j + 4], s1 = h1.b[j + 4];
        if (s0 !== s1) { for (let q = 0; q < M; q++) PAST.b.push(h1.b[j + q]); continue; }
        if (s1 === HAND) {
          const a0 = Math.atan2(h0.b[j + 1], h0.b[j]), a = a0 + wrapA(Math.atan2(h1.b[j + 1], h1.b[j]) - a0) * u, rr = U.lerp(Math.hypot(h0.b[j], h0.b[j + 1]), Math.hypot(h1.b[j], h1.b[j + 1]), u);
          PAST.b.push(Math.cos(a) * rr, Math.sin(a) * rr);
        } else PAST.b.push(U.lerp(h0.b[j], h1.b[j], u), U.lerp(h0.b[j + 1], h1.b[j + 1], u));
        PAST.b.push(U.lerp(h0.b[j + 2], h1.b[j + 2], u), U.lerp(h0.b[j + 3], h1.b[j + 3], u), s1);
      }
      return PAST;
    }
    return null;
  }
  function bellReconcile(s, d) {
    const me = s.me, B = s.bp, H = N.BELL_HEAD, M = N.BELL_N;
    if (!B || !me.bells || !me.bells.length || me.downed || me.dead) return;
    const a = d.P.find((q) => q[0] === s.localPid), row = a && a[24];
    if (!row) return;
    me.bellRes = row[H - 1] | 0;
    const tS = B.sent.get(row[0]);
    if (tS === undefined) return;
    for (const q of B.sent.keys()) if (q < row[0] - 60) B.sent.delete(q);
    const n = (row.length - H) / M | 0, past = !(row[H - 2] & 4) && !me.bellLeap ? bellPast(B, tS + row[1] / 1000) : null; // the host ran row[1] ms on the echoed input: the local state as long after it was sent
    if (!past || n !== me.bells.length || past.b.length !== n * M) { B.bad = 0; return; } // an Anchor Leap runs on its own clock
    const L = Math.max(10, me.bellL || me.stats.weapon.chain);
    let off = false;
    for (let i = 0; i < n; i++) {
      const j = H + M * i, q = M * i, b = me.bells[i], hs = row[j + 4];
      if (hs !== past.b[q + 4]) { // the host's bell was in another state at that moment
        B.st[i] = (B.st[i] | 0) + 1;
        if (B.st[i] >= BELL_STATE && b.s !== hs && (hs === HAND || hs === ANCHOR)) {
          b.s = hs; b.fly = null; b.reel = null; b.reelQ = false;
          b.x = hs === HAND ? me.bellPx + row[j] : row[j]; b.y = hs === HAND ? me.bellPy + row[j + 1] : row[j + 1]; b.vx = row[j + 2]; b.vy = row[j + 3];
          B.st[i] = 0; B.rss++;
        }
        continue;
      }
      B.st[i] = 0;
      if (hs === ANCHOR) { if (b.s === ANCHOR && U.dist2(b.x, b.y, row[j], row[j + 1]) > 4) { b.x = row[j]; b.y = row[j + 1]; } continue; }
      if (hs !== HAND || b.s !== HAND) continue;
      const hx = row[j], hy = row[j + 1], lx = past.b[q], ly = past.b[q + 1], rh = Math.hypot(hx, hy), rl = Math.hypot(lx, ly);
      const sh = Math.hypot(row[j + 2], row[j + 3]), sl = Math.hypot(past.b[q + 2], past.b[q + 3]);
      if (sl > 40) { const kf = 1 + (U.clamp(sh / sl, 0.5, 1.5) - 1) * BELL_SPD; b.vx *= kf; b.vy *= kf; }
      if (rh < 8 || rl < 8) continue;
      const dA = wrapA(Math.atan2(hy, hx) - Math.atan2(ly, lx));
      if (Math.abs(dA) > 1.6 || Math.abs(rh - rl) > 0.6 * L) off = true;
      B.rn++; B.re += Math.abs(dA); B.rb += dA * (me.bellSpin || 1);
      const r = dA * BELL_ROT, c = Math.cos(r), sn = Math.sin(r), rx = b.x - me.bellPx, ry = b.y - me.bellPy, vx = b.vx, vy = b.vy;
      b.x = me.bellPx + rx * c - ry * sn; b.y = me.bellPy + rx * sn + ry * c; b.vx = vx * c - vy * sn; b.vy = vx * sn + vy * c;
    }
    B.st.length = n;
    B.bad = off ? B.bad + 1 : 0;
    if (B.bad >= BELL_BAD) { // still wrong after a few corrections: take the host's hand bells
      for (let i = 0; i < n; i++) { const j = H + M * i, b = me.bells[i]; if (row[j + 4] !== HAND || b.s !== HAND) continue; b.x = me.bellPx + row[j]; b.y = me.bellPy + row[j + 1]; b.vx = row[j + 2]; b.vy = row[j + 3]; }
      B.bad = 0; B.rs++;
    }
  }
  // Draw offsets of the bells simulated on this machine (solo / host world, the predicted client hero): between the last step's start (b.px, b.py) and end by the step remainder, a hand bell about the carried spot, any other
  // about the hero.
  function bellView(s) {
    const cl = s.mode === 'client';
    for (const p of s.view.players.values()) {
      if (!p.bells || !p.bells.length || (cl && p !== s.me)) continue;
      const al = cl ? (s.bp ? s.bp.al : 1) : s.alpha;
      for (const b of p.bells) {
        const px = b.px === undefined ? b.x : b.px, py = b.py === undefined ? b.y : b.py, x = px + (b.x - px) * al, y = py + (b.y - py) * al;
        if (b.s === HAND) { b.ox = x - p.bellPx; b.oy = y - p.bellPy; } else { b.ox = x - p.x; b.oy = y - p.y; }
      }
    }
  }

  G.Mirror = Mirror; // the client mirror constructor (headless checks)
  // ---------------- session lifecycle ----------------
  G.start = (mode, cfg) => {
    ED.FX.reset();
    ED.Render.darkLevel = 0;
    U.resetUid(1);
    if (ED.Actors) ED.Actors.reset();
    if (ED.Cos) ED.Cos.reset();
    const s = G.s = { mode, cfg, localPid: cfg.localPid, net: cfg.net || null, fxBuf: [], snapT: 0, snapN: 0, inT: 0, acc: 0, alpha: 1, epoch: 0, offer: null, offerOpen: false, ended: false, paused: false, prompt: null, sig: '', claimed: {} };
    if (mode === 'client') {
      s.mirror = new Mirror(cfg, cfg.localPid);
      s.view = s.mirror;
      s.me = s.mirror.players.get(cfg.localPid);
    } else {
      s.world = new ED.World({ seed: cfg.seed, pact: cfg.pact, players: cfg.players.map(p => Object.assign({}, p, { remote: p.pid !== cfg.localPid })), tutorial: cfg.tutorial });
      s.world.startRun();
      s.view = s.world;
      s.me = s.world.players.get(cfg.localPid);
      for (const pd of cfg.players) { const p = s.world.players.get(pd.pid); if (p) p.wear = N.cleanWear(pd.wear, p.cls); } // Wardrobe sets (client only: the sim never reads them)
    }
    s.view.pact = cfg.pact;
    s.ctl = { atkCd: 0, skillCd: 0, skill2Cd: 0, skill3Cd: 0, charges: s.me.stats.maxCharges, charges3: s.me.stats.skill3Charges, dashN: s.me.stats.dashCharges, dashT: 0, tranceT: 0, latch: false, aimA: 0, holdT: 0, holding: false };
    // Aim state read by ED.AimFx: cursor in CSS px (sx, sy) and world (wx, wy), device, angle, push fraction (frac) for stick or keyboard-only ground skills, ready ground skills, cooldown fraction, pulse/crit timestamps.
    s.aim = { sx: 0, sy: 0, wx: 0, wy: 0, a: 0, device: 'mouse', pointer: false, show: false, dead: false, foe: false, frac: 0.6, cd: 0, ground: [], pulseT: -9, critT: -9 };
    if (ED.AimFx) ED.AimFx.applyCursor();
    s.fxCtx = {
      localPid: s.localPid,
      player: (pid) => s.view.players.get(pid),
      players: () => s.view.players.values(),
      stratum: () => s.view.stratum || 1,
    };
    if (mode !== 'client') G.drainWorld(true);
    ED.Render.updateCamera(s.view, s.me, 0, true);
    return s;
  };

  G.stop = () => { G.s = null; if (ED.AimFx) ED.AimFx.hover(false, false); };
  // No one else is in this world (solo, or a hosted party whose friends have all left): it may wait for us.
  G.alone = () => { const s = G.s; return !!s && (s.mode === 'solo' || (s.mode === 'host' && s.world.players.size <= 1)); };

  // Host-side: apply an action coming from any hero (local or remote).
  G.applyAction = (w, pid, a) => {
    const p = w.players.get(pid);
    if (!p || !a) return;
    switch (a.t) {
      case 'atk': p.atkD = +a.d; w.playerAttack(p, +a.a || 0, 0, a.k); break; // d: the cursor distance of the attack (a lobbed weapon lands there)
      case 'skill': if ((a.slot | 0) >= 0 && (a.slot | 0) <= 2) w.playerSkill(p, +a.a || 0, a.data, a.slot | 0); break;
      case 'dash': // blink: Umbral Arms put the hero behind a foe; ox, oy: where the dash began; bx, by: where a Storm Step / Umbral Arms blink landed (fx only)
        if (Number.isFinite(a.bx) && Number.isFinite(a.by) && Number.isFinite(a.ox) && Number.isFinite(a.oy)) w.emit({ t: 'blink', pid, x0: +a.ox, y0: +a.oy, x1: +a.bx, y1: +a.by, k: a.blink ? 'behind' : 'storm' });
        w.playerDash(p, +a.dx || 0, +a.dy || 0, !!a.blink, +a.ox, +a.oy); break;
      case 'hold': w.playerHold(p, !!a.on, +a.a || 0, +a.d || 0); break; // the held-attack verb starts (on) or is released
      case 'interact': w.interact(pid, a.id); break;
      case 'pick': w.pickBoon(pid, a.i | 0); break;
      case 'reroll': w.reroll(pid); break;
      default: break;
    }
  };

  G.act = (a) => {
    const s = G.s; if (!s) return;
    if (s.mode === 'client') s.net.send({ t: 'act', a });
    else G.applyAction(s.world, s.localPid, a);
  };

  // Host/solo: process events and targeted messages produced by the world this frame.
  G.drainWorld = () => {
    const s = G.s, w = s.world;
    if (s.mode === 'host') for (const ev of w.fx) s.fxBuf.push(ev); // peers get every event (capped per snapshot); the local screen is capped per frame
    for (const ev of N.capFx(w.fx, N.CAPS_LOCAL)) G.localEvent(ev);
    w.fx.length = 0;
    for (const m of w.msgs) {
      if (m.to === s.localPid) G.message(m);
      else if (s.mode === 'host') s.net.sendTo(m.to, m);
    }
    w.msgs.length = 0;
  };

  const SHEET_EVENTS = { build: 1, boon: 1, evolve: 1, levelup: 1, room: 1, relic: 1, stratum: 1 }; // events that change what the open character sheet shows
  G.localEvent = (ev) => {
    const s = G.s; if (!s) return;
    if (SHEET_EVENTS[ev.t]) ED.UI.sheetDirty();
    if (ev.t === 'room') {
      s.epoch = ev.ep;
      if (s.mode === 'client') {
        const mine = ev.pos.find(q => q[0] === s.localPid);
        if (mine) { s.me.x = mine[1]; s.me.y = mine[2]; s.me.vx = 0; s.me.vy = 0; s.me.dashT = 0; s.me.skillMove = null; }
      }
      ED.Render.updateCamera(s.view, s.me, 0, true);
    } else if (ev.t === 'hit' && ev.c && ev.pid === s.localPid && s.aim) {
      s.aim.critT = performance.now();
    } else if (ev.t === 'build' && s.mode === 'client') {
      const p = s.mirror.players.get(ev.b.pid);
      if (p) {
        const hadEcho = p.stats.maxCharges;
        p.boons = ev.b.boons; p.relics = ev.b.relics; p.chaliceHp = ev.b.chaliceHp; p.bonusHp = ev.b.bonusHp || 0; p.rs = ev.b.rs || {}; s.mirror.recalc(p);
        if (p === s.me && p.stats.maxCharges > hadEcho) s.ctl.charges++;
      }
    } else if (ev.t === 'boon' && s.mode !== 'client' && ev.pid === s.localPid) {
      if (s.me.stats.maxCharges > s.ctl.charges && ED.BOONS[ev.id].mods.charges) s.ctl.charges++;
    } else if (ev.t === 'smash') {
      if (s.mode === 'client') { const rs = s.mirror.roomState[ev.r]; if (rs) rs.broken |= 1 << ev.i; } // the host world already holds its own bit
    } else if (ev.t === 'end') {
      if (s.mode === 'host' && !s.ended) {
        // flush everything (including this event) before the session is torn down, then confirm directly
        s.net.broadcast(N.encodeSnap(s.world, s.fxBuf, true)); s.fxBuf = [];
        s.net.broadcast({ t: 'end', summary: ev.summary });
      }
      if (!s.ended) { s.ended = true; ED.App.onRunEnd(ev.summary); }
      return;
    }
    ED.FX.handle(ev, s.fxCtx);
  };

  G.message = (m) => {
    const s = G.s; if (!s) return;
    if (m.t === 'offer') {
      s.offer = m; s.offerOpen = true; s.offerHidden = false;
      ED.UI.showBoons(m);
      ED.UI.sheetDirty();
    }
    else if (m.t === 'offerDone') { s.offer = null; s.offerOpen = false; ED.UI.hideBoons(); }
    else if (m.t === 'claimed') s.claimed[m.group] = true;
    else if (m.t === 'toast') { ED.UI.toast(m.text); if (!m.info) ED.Audio.play('deny'); } // info toasts are not refusals
    else if (m.t === 'forkRank') ED.UI.forkReveal(m); // a fork rank granted at a boss { id, rank }: the reveal card
    else if (m.t === 'blink' && s.me) { s.me.x = m.x; s.me.y = m.y; s.me.vx = 0; s.me.vy = 0; } // a Death Blossom blink of a hero the host does not move (a joined client): its place
    else if (m.t === 'leap' && s.me) { // the second Sun Dive leap { x, y, d (flight seconds), i (untouchable seconds) } of a joined client
      s.me.skillMove = ED.leapMove(s.view.room, s.view.locked, s.me, m.x, m.y, { t: m.d, iframes: m.i });
      if (s.me.skillMove) s.me.cometT = m.d;
    }
    else if (m.t === 'dashRefund' && s.me) { const c = s.ctl, st = s.me.stats; c.dashN = Math.min(st.dashCharges | 0, c.dashN + ((m.n | 0) || 1)); } // dash charges back { n } (Umbral Arms)
    else if (m.t === 'refund') { // cooldown refund { slot, s }: s seconds off (a charge returns when the cooldown reaches 0), no s = in full (slots 0 and 2: one charge); slot -1: s off every slot
      const c = s.ctl, st = s.me.stats;
      if (m.slot === 1 || m.slot === -1) c.skill2Cd = m.s ? Math.max(0, c.skill2Cd - m.s) : 0;
      if (m.slot === 0 || m.slot === -1) { if (m.s) { if (c.charges < st.maxCharges) c.skillCd -= m.s; } else c.charges = Math.min(st.maxCharges, c.charges + 1); }
      if (m.slot === 2 || m.slot === -1) { if (m.s) { if (c.charges3 < st.skill3Charges) c.skill3Cd -= m.s; } else c.charges3 = Math.min(st.skill3Charges, c.charges3 + 1); }
    }
  };

  // Network handlers.
  G.onHostData = (pid, d) => {
    const s = G.s; if (!s || s.mode !== 'host') return;
    const w = s.world;
    if (d.t === 'in') {
      const p = w.players.get(pid);
      if (p && d.e === w.roomEpoch && !p.downed && !p.dead) {
        p.x = +d.x || p.x; p.y = +d.y || p.y; p.face = +d.f || 0; if (isFinite(d.ax) && isFinite(d.ay)) { p.aimX = +d.ax; p.aimY = +d.ay; } p.moving = !!d.mv; p.dashing = !!d.d; p.skillIfr = !!d.m; p.vx = +d.vx || 0; p.vy = +d.vy || 0;
        if (d.h !== undefined) { p.haulIn = !!d.h; p.haulPress = d.hp | 0; p.haulNear = !!d.nh; p.inSeq = d.q | 0; p.inT = w.time; } // a Bellwarden's held attack, its press count, an interactable in range, the input seq its bells echo and when it arrived (net.js P[24])
        Sim.resolve(p, w.room, w.locked, false);
      }
    } else if (d.t === 'act') G.applyAction(w, pid, d.a);
  };
  G.onClientData = (d) => {
    const s = G.s; if (!s || s.mode !== 'client') return;
    if (d.t === 's') {
      const fx = s.mirror.apply(d, performance.now() / 1000);
      bellReconcile(s, d);
      for (const ev of fx) G.localEvent(ev);
    } else if (d.t === 'end') G.localEvent({ t: 'end', summary: d.summary });
    else if (d.t === 'offer' || d.t === 'offerDone' || d.t === 'claimed' || d.t === 'toast' || d.t === 'refund' || d.t === 'dashRefund' || d.t === 'forkRank' || d.t === 'blink' || d.t === 'leap') G.message(d);
  };
  G.onPeerLeft = (pid) => { const s = G.s; if (s && s.mode === 'host') { s.world.removePlayer(pid); } };

  // ---------------- local hero control ----------------
  function control(s, inp, dt) {
    const me = s.me, view = s.view, ctl = s.ctl, st = me.stats;
    ctl.atkCd -= dt; ctl.tranceT -= dt; ctl.skill2Cd -= dt;
    const cd0 = st.skillCd, cd1 = st.skill2Cd; // a cast's cooldown per slot
    if (Sim.dashTick(ctl, st, dt) && ED.FX && ED.FX.cue) ED.FX.cue('dcharge'); // a charge refilled
    if (s.mode === 'client') for (const k of MIRROR_TIMERS) if (me[k] > 0) me[k] -= dt; // a mirror hero has no world tick
    if (ctl.charges < st.maxCharges) { ctl.skillCd -= dt; while (ctl.skillCd <= 0 && ctl.charges < st.maxCharges) { ctl.charges++; ctl.skillCd = ctl.charges < st.maxCharges ? ctl.skillCd + cd0 : 0; } } // a refund past the running cooldown carries into the next charge
    if (ctl.charges3 > st.skill3Charges) ctl.charges3 = st.skill3Charges;
    if (ctl.charges3 < st.skill3Charges) { ctl.skill3Cd -= dt; while (ctl.skill3Cd <= 0 && ctl.charges3 < st.skill3Charges) { ctl.charges3++; ctl.skill3Cd = ctl.charges3 < st.skill3Charges ? ctl.skill3Cd + st.skill3Cd : 0; } } // skill 3 charges recharge one at a time the same way
    if (me.downed || me.dead || !view.room) {
      s.prompt = null; if (s.mode !== 'client') me.dashing = false;
      if (me.haulIn) me.haulIn = false;
      s.aim.show = false; s.aim.ground.length = 0; ED.AimFx.hover(ED.Input.device === 'pad', false);
      return;
    }
    let mx = inp.mx, my = inp.my;
    if (s.offerOpen) { mx = 0; my = 0; }
    const aim = aimOf(s, me, inp);
    me.face = aim;
    { const aw = ED.AimFx.want(me, s.aim, 260); me.aimX = aw.x; me.aimY = aw.y; } // the cursor point (a ground skill that follows it, Storm of Thorns, reads it on the host)
    // interaction prompt
    s.prompt = null;
    let near = null, nd = 50 * 50;
    for (const p of view.props) {
      if (!ED.Render.interactable(p)) continue;
      if (view.locked && p.kind !== 'trial') continue;
      if (s.claimed[p.group] && (p.kind === 'relic' || p.kind === 'campfire' || p.kind === 'anvil' || (p.kind === 'reward' && HERO_REWARD.test(p.item)))) continue;
      const d = U.dist2(p.x, p.y, me.x, me.y);
      if (d < nd) { nd = d; near = p; }
    }
    if (near && !s.offerOpen) {
      const text = ED.Render.propPrompt(near, view);
      let desc = null, color = null;
      if (near.kind === 'relic' || near.stype === 'relic') { const r = ED.RELICS[near.item]; desc = r.desc; color = ED.RARITY[r.rar].color; }
      else if (near.kind === 'portal') desc = 'Go to stratum ' + ED.U.roman(view.stratum + 1) + ': ' + ED.biomeFor(view.stratum + 1).name + '.';
      else { desc = ED.Render.propDesc(near, view); if (near.kind === 'reward') color = ED.Render.rewardColor(near.item); }
      s.prompt = { x: near.x, y: near.y, text, desc, color, can: near.kind === 'shop' || near.kind === 'gamble' ? view.gold >= near.price : true };
    }
    if (s.offerOpen && me.haulIn) me.haulIn = false;
    if (!s.offerOpen) {
      if (inp.atkPressed && near) { G.act({ t: 'interact', id: near.id }); ctl.latch = true; ctl.atkCd = Math.max(ctl.atkCd, 0.25); }
      if (!inp.atk) ctl.latch = false;
      if (st.weapon.kind === 'bell') { // the held attack winds the bells, a press reels anchored ones, a release hurls; near an interactable the attack interacts and a release never hurls (class-bell.js reads them)
        me.haulIn = !!inp.atk && !ctl.latch; me.haulNear = !!near;
        if (inp.atkPressed && !ctl.latch) me.haulPress = (me.haulPress | 0) + 1;
      }
      const H = st.hold && st.weapon.kind !== 'bell' ? ED.Stats.HOLD[st.hold] : null; // a held-attack verb: after H.at s held the attacks stop and the verb runs until release (or H.max)
      if (H && inp.atk && !ctl.latch && !near) {
        ctl.holdT += dt;
        if (!ctl.holding && ctl.holdT >= H.at) { ctl.holding = true; G.act({ t: 'hold', on: 1, a: aim }); }
      } else {
        if (ctl.holding) G.act({ t: 'hold', on: 0, a: aim, d: Math.round(Math.hypot(me.aimX - me.x, me.aimY - me.y)) });
        ctl.holding = false; ctl.holdT = 0;
      }
      if (s.mode === 'client') me.holdOn = ctl.holding && !(H && H.max > 0 && ctl.holdT - H.at >= H.max); // the walk slows while the verb runs (ED.Stats.moveRate)
      if (inp.atk && !ctl.latch && ctl.atkCd <= 0 && !near && !ctl.holding) {
        const k = ED.Stats.comboNext(me, view.time), w = ED.Stats.stepWeapon(st, k), cl = isCleave(me, st, w, view.time); // decided before the act: the sim spends the Follow-Through; k: the combo step this attack plays (the host takes it)
        G.act({ t: 'atk', a: aim, k, d: Math.round(Math.hypot(me.aimX - me.x, me.aimY - me.y)) });
        if (s.mode === 'client') { me.atkCount = (me.atkCount | 0) + 1; if (st.swift) me.flowT = ED.CONST.FLOW_T; if (cl) me.cleaveNext = 0; if (st.weapon.combo) { me.comboK = k; me.comboAt = view.time; } } // the host spends Follow-Through on the Cleave it grants
        ctl.atkCd = Math.max(ctl.atkCd, -dt) + ED.Stats.stepInterval(me); // carries the overshoot of this frame so the real rate equals the shown one
        if (w.kind === 'bell') { /* a hauled bell is not swung: no attack pose or cue (cls-bell.js sounds the swing) */ } else {
        s.aim.pulseT = performance.now();
        ED.FX.playerAttackAnim(s.localPid, aim, w);
        if (w.kind === 'melee') {
          const reach = w.range * (1 + st.area * 0.5 + st.meleeReach) * (cl ? 1.4 : 1), arc = Math.min(6.3, w.arc * (1 + st.area * 0.4) * (cl ? 1.4 : 1));
          if (w.ahead) ED.FX.slam(me.x, me.y - 10, aim, reach, w.ahead.r * (1 + st.area * 0.5) * (cl ? 1.4 : 1), cl ? '#ffd36b' : ED.PLAYER_COLORS[me.slot]);
          else ED.FX.slash(me.x, me.y - 10, aim, reach, arc, cl ? '#ffd36b' : ED.PLAYER_COLORS[me.slot]);
          ED.Audio.play(cl || w.look === 'hammer' ? 'heavy' : 'swing');
          if (cl) ED.FX.hitStop(0.06);
        } else ED.Audio.play(w.proj === 'firebolt' || w.proj === 'fireball' || w.proj === 'spark' ? 'fire' : w.proj === 'soul' || w.proj === 'holy' || w.proj === 'plague' ? 'magic' : 'shoot', 0.8);
        }
      }
      const cls = ED.CLASSES[me.cls];
      if ((inp.skill || (inp.skill3 && !cls.skill3)) && ctl.charges > 0) { // a hero without a skill 3 casts skill 1 on that binding
        const skill = cls.skill, N = ED.Stats.skillNums(skill, st), C = ED.CONST;
        let data = null;
        if (skill === 'charge') { // a run toward the cursor: clamp(cursor distance, CHARGE_MIN.., range), cut at walls, at CHARGE_SPEED, untouchable for its whole length; the sim sweeps it for contact
          const ww = ED.AimFx.want(me, s.aim, N.range), end = Sim.castMove(view.room, me.x, me.y, aim, U.clamp(ww.d, N.rangeMin, N.range), me.r, view.locked), len = Math.max(1, Math.hypot(end.x - me.x, end.y - me.y));
          data = { x0: Math.round(me.x), y0: Math.round(me.y), x1: Math.round(end.x), y1: Math.round(end.y) };
          me.skillMove = { dx: Math.cos(aim), dy: Math.sin(aim), speed: C.CHARGE_SPEED, t: len / C.CHARGE_SPEED, iframes: len / C.CHARGE_SPEED, age: 0 };
          if (s.mode === 'client') { // local estimates of what the host decides: Brace for the chip, Follow-Through for the Cleave smear
            if (st.brace && view.time >= (me.braceAt || -99) + C.BRACE_CD) { me.braceT = st.brace; me.braceAt = view.time; }
            if (st.chargeCleave) me.cleaveNext = view.time + len / C.CHARGE_SPEED + 1.5;
          }
        } else if (skill === 'step') {
          const end = ED.AimFx.stepLand(view, me, s.aim);
          data = { x0: Math.round(me.x), y0: Math.round(me.y), x1: Math.round(end.x), y1: Math.round(end.y) };
          me.x = end.x; me.y = end.y;
        } else data = skill === 'heave' ? bellLeapData(s, me, aim) : groundData(view, me, s.aim, skill, st);
        G.act({ t: 'skill', a: aim, data });
        bellCast(s, skill, aim, data, N);
        castMove(view, me, N, aim, data);
        if (ctl.charges === st.maxCharges) ctl.skillCd = cd0;
        ctl.charges--;
        if (st.trance) { ctl.tranceT = 4; if (s.mode === 'client') me.tranceT = 4; }
      }
      if (inp.skill3 && cls.skill3 && ctl.charges3 > 0) { // skill 3 (Fireball): flies along the aim; fires no on-cast boon procs (no Battle Trance)
        G.act({ t: 'skill', a: aim, data: null, slot: 2 });
        if (ctl.charges3 === st.skill3Charges) ctl.skill3Cd = st.skill3Cd;
        ctl.charges3--;
      }
      const sk2 = cls.skill2;
      if (inp.skill2 && sk2 && ctl.skill2Cd <= 0) {
        const N2 = ED.Stats.skillNums(sk2, st);
        let data = groundData(view, me, s.aim, sk2, st);
        if (sk2 === 'shieldthrow') { const ww = ED.AimFx.want(me, s.aim, N2.range); data = { d: Math.round(Math.hypot(ww.x - me.x, ww.y - (me.y - 4))) }; } // cursor distance: how far the shield flies
        G.act({ t: 'skill', a: aim, data, slot: 1 });
        bellCast(s, sk2, aim, data, N2);
        castMove(view, me, N2, aim, data);
        if (sk2 === 'vanish' && s.mode === 'client') me.stealthT = 2.5 + st.stealthDur; // the host's flag takes over with the next snapshot
        if (sk2 === 'meteor' && N2.move && s.mode === 'client') me.cometT = N2.move.t; // Comet: airborne until the landing
        ctl.skill2Cd = cd1;
        if (st.trance) { ctl.tranceT = 4; if (s.mode === 'client') me.tranceT = 4; }
      }
      if (inp.dash && !me.skillMove && Sim.dashTry(ctl, st)) {
        let dx = mx, dy = my;
        if (Math.hypot(dx, dy) < 0.2) { dx = Math.cos(aim); dy = Math.sin(aim); }
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const ox = me.x, oy = me.y, b = Sim.dashBlink(view.room, view.locked, me, st, view.enemies, Math.atan2(dy, dx)); // Storm Step / Umbral Arms: the hero blinks first (behind a foe the dash is spent there)
        if (b) { me.x = b.x; me.y = b.y; if (b.behind) { dx = 0; dy = 0; me.face = b.face; } else { dx = b.dx; dy = b.dy; } }
        me.dashT = ED.CONST.DASH.t; me.dashDx = dx; me.dashDy = dy;
        G.act(b ? { t: 'dash', dx, dy, blink: b.behind ? 1 : 0, ox: Math.round(ox), oy: Math.round(oy), bx: Math.round(b.x), by: Math.round(b.y) } : { t: 'dash', dx, dy, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
    Sim.movePlayer(me, { mx, my }, dt, view.room, view.locked, view.zones, view.enemies); // a crowd of foes touching the hero slows the walk
    if (s.mode !== 'client') me.dashing = me.dashT > 0; // a skill's own move is not a dash (no dash riders) and keeps its own i-frames (me.skillIfr)
    aimExtras(s, me, view);
  }

  const MIRROR_TIMERS = ['braceT', 'flowT', 'tranceT', 'stealthT', 'cometT'];
  // True when the next melee swing is a Cleave (Oath of Steel: every (3 + cleaveN)th attack, or the first after a Charge with Follow-Through): the viewer draws its own smear, the host decides the damage.
  function isCleave(me, st, w, now) {
    return st.cleave > 0 && w.kind === 'melee' && (now < (me.cleaveNext || 0) || ((me.atkCount | 0) + 1) % (3 + st.cleaveN) === 0);
  }
  // A skill's own movement from its stats (moveIf): a hop away from the cursor, a leap to the ground point; clipped at walls, untouchable for its i-frame window. The Charge and Shadowstep move in their own branch.
  function castMove(view, me, N, aim, data) {
    const mv = N.move;
    if (!mv || mv.k === 'charge') return;
    let dx, dy, dist;
    if (mv.k === 'hop') { dx = Math.cos(aim) * mv.dir; dy = Math.sin(aim) * mv.dir; dist = mv.dist; }
    else if (mv.k === 'leap' && data && data.x !== undefined) { dist = Math.hypot(data.x - me.x, data.y - me.y); dx = (data.x - me.x) / (dist || 1); dy = (data.y - me.y) / (dist || 1); }
    if (!(dist > 4)) return;
    const end = Sim.castMove(view.room, me.x, me.y, Math.atan2(dy, dx), dist, me.r, view.locked), real = Math.hypot(end.x - me.x, end.y - me.y);
    if (real < 4) return;
    me.skillMove = { dx: (end.x - me.x) / real, dy: (end.y - me.y) / real, speed: real / mv.t, t: mv.t, iframes: mv.iframes === undefined ? mv.t : mv.iframes, age: 0 };
  }

  // Aim angle of this frame, and the cursor state ED.AimFx draws from (s.aim). Aim origin is the projectile spawn point (x, y - 4).
  // The last angle is kept when the cursor is within 12 px of the origin or outside the window; before the first pointer event the aim follows the walking direction.
  // On a pad the right stick (latched 0.35 s after release) aims, else the left stick, else the last angle; no aim assist anywhere.
  const AIM_DEAD2 = 12 * 12;
  function aimOf(s, me, inp) {
    const I = ED.Input, R = ED.Render, a = s.aim, ctl = s.ctl, m = I.mouse, pad = I.device === 'pad';
    a.device = pad ? 'pad' : 'mouse'; a.pointer = !pad && m.moved > 0; a.show = true; a.dead = false;
    a.sx = m.x; a.sy = m.y;
    let ang = ctl.aimA;
    if (pad) {
      if (inp.padAim !== undefined) ang = inp.padAim;
      else if (Math.hypot(inp.mx, inp.my) > 0.2) ang = Math.atan2(inp.my, inp.mx);
    } else if (!a.pointer) {
      if (Math.hypot(me.mvx || 0, me.mvy || 0) > 0.1) ang = Math.atan2(me.mvy, me.mvx);
    } else {
      const w = R.toWorld(m.x * R.dpr, m.y * R.dpr), dx = w.x - me.x, dy = w.y - (me.y - 4);
      a.wx = w.x; a.wy = w.y;
      if (dx * dx + dy * dy > AIM_DEAD2) { if (m.inside) ang = Math.atan2(dy, dx); } else a.dead = true;
    }
    ctl.aimA = a.a = ang;
    a.frac = pad && inp.padMag !== undefined ? U.clamp((inp.padMag - 0.45) / 0.5, 0.3, 1) : 0.6; // stick push -> share of a ground skill's range
    let foe = false;
    if (a.pointer && m.inside) {
      for (const e of s.view.enemies) {
        if (e.hp <= 0 || e.burrowed || e.spawnT > 0) continue;
        const ex = a.wx - e.x, ey = a.wy - e.y, rr = e.r + 4;
        if (ex * ex + ey * ey <= rr * rr) { foe = true; break; }
      }
    }
    a.foe = foe;
    ED.AimFx.hover(pad, foe);
    return ang;
  }

  // data of a ground skill's cast: origin and landing point; null for any other skill.
  function groundData(view, me, a, id, st) {
    const ai = ED.skillAim(id, st);
    if (ai.aim !== 'ground') return null;
    const g = ED.AimFx.groundLand(view, me, a, ai.range, ai.walk);
    return { x0: Math.round(me.x), y0: Math.round(me.y), x: Math.round(g.x), y: Math.round(g.y) };
  }

  // After the frame's casts: ready ground/move skills for the landing preview and the attack-cooldown fraction for the cursor arc.
  // line: a shot skill (Fireball) previewed as its flight line to the first wall and its burst ring.
  function addReady(a, n, slot, id, st) {
    const ai = ED.skillAim(id, st), line = id === 'fireball';
    if (ai.aim !== 'ground' && id !== 'step' && !line) return n;
    const g = a.ground[n] || (a.ground[n] = {});
    g.slot = slot; g.id = id; g.move = ai.aim !== 'ground' && !line; g.line = line; g.range = ai.range || 140; g.walk = !!ai.walk;
    return n + 1;
  }
  function aimExtras(s, me, view) {
    const a = s.aim, ctl = s.ctl, st = me.stats, cls = ED.CLASSES[me.cls];
    let n = 0;
    if (ctl.charges > 0) n = addReady(a, n, 0, cls.skill, st);
    if (cls.skill2 && ctl.skill2Cd <= 0) n = addReady(a, n, 1, cls.skill2, st);
    if (cls.skill3 && ctl.charges3 > 0) n = addReady(a, n, 2, cls.skill3, st);
    a.ground.length = n;
    for (let i = 0; i < n; i++) { const g = a.ground[i]; g.r = g.move ? 0 : ED.skillRadius(g.id, st); }
    const iv = ED.Stats.attackInterval(me);
    a.cd = iv >= 0.45 && st.weapon.kind !== 'bell' ? U.clamp(ctl.atkCd / iv, 0, 1) : 0; // a bell has no attack cooldown to show
  }

  // ---------------- per-frame ----------------
  const STEP = 1 / 60, MAX_STEPS = 8; // the world advances in fixed 1/60 s steps at any frame rate
  // Render interpolation (solo/host): the sim records each mover's position before a step (px/py, never read by the sim);
  // G.render draws the foes, allies, shots and pickups at px + (x - px) * alpha, alpha = unspent frame time / STEP, then restores x/y exactly.
  // Heroes are not interpolated: the local hero is moved per frame by control(), remote ones by network input.
  const MOVERS = ['enemies', 'allies', 'projs', 'pickups'], JUMP2 = 48 * 48; // a larger step (blink, teleport) is drawn unsmoothed
  const markPrev = (w) => { for (const k of MOVERS) { const a = w[k]; for (let i = 0; i < a.length; i++) { const o = a[i]; o.px = o.x; o.py = o.y; } } };
  const interp = (w, al) => {
    for (const k of MOVERS) {
      const a = w[k];
      for (let i = 0; i < a.length; i++) {
        const o = a[i]; o.rx = o.x; o.ry = o.y;
        if (o.px === undefined) continue; // born this step: drawn at its current position
        const dx = o.x - o.px, dy = o.y - o.py;
        if (dx * dx + dy * dy <= JUMP2) { o.x = o.px + dx * al; o.y = o.py + dy * al; }
      }
    }
  };
  const unterp = (w) => { for (const k of MOVERS) { const a = w[k]; for (let i = 0; i < a.length; i++) { const o = a[i]; if (o.rx !== undefined) { o.x = o.rx; o.y = o.ry; } } } };
  // Mirrors World.isSafe: calm room, no live foe, no descent pending (clients see no pendingStratum).
  const isSafe = (v) => !v.locked && !v.pendingStratum && !v.enemies.some(e => e.hp > 0);
  // Music level from the viewed foe list (host, solo and client alike): 0 calm, 1 foes alive or the room locked, 2 heavy at 25 live foes (held until fewer than 12);
  // a boss piece plays its phase (1 -> 0 .. 3 -> 2), lifted to 1 by 8 or more summons.
  const musicLevel = (v, prev) => {
    let n = 0, boss = null;
    for (const e of v.enemies) { if (e.hp <= 0 || e.spawnT > 0) continue; if (e.boss) boss = e; else n++; }
    if (boss) return Math.max(Math.min(2, (boss.phase | 0) - 1), n >= 8 ? 1 : 0);
    if (n >= 25 || (prev === 2 && n >= 12)) return 2;
    return v.locked || n > 0 ? 1 : 0;
  };
  G.update = (dt, inp) => {
    const s = G.s; if (!s) return;
    const now = performance.now() / 1000;
    const alone = G.alone(), frozen = alone && s.paused;
    // Alone, the world waits while you read boon cards (offers only open in a safe room).
    const hold = alone && s.offerOpen;
    s.alpha = 1; // frozen, held or client: draw the newest state
    const sdt = alone ? dt * ED.FX.timeScale : dt; // hit-stop slows only a world nobody else shares; effects keep real time
    if (!frozen) {
      if (s.offer) {
        const safe = isSafe(s.view);
        if (!safe && s.offerOpen) { ED.UI.hideBoons(); s.offerOpen = false; s.offerHidden = true; }
        else if (safe && !s.offerOpen && s.offerHidden) { s.offerHidden = false; s.offerOpen = true; ED.UI.showBoons(s.offer); }
      }
      if (s.offerOpen) {
        if (inp.left || inp.up) ED.UI.boonMove(-1);
        if (inp.right || inp.down) ED.UI.boonMove(1);
        if (inp.confirm) ED.UI.boonConfirm();
        if (inp.reroll) ED.UI.boonReroll(true);
      }
      control(s, inp, sdt);
      if (s.mode !== 'client') {
        const w = s.world;
        if (!hold) {
          s.acc += sdt;
          let n = 0;
          while (s.acc >= STEP - 1e-9 && n < MAX_STEPS) { markPrev(w); w.update(STEP); s.acc -= STEP; n++; }
          if (s.acc >= STEP) s.acc = 0; // step cap hit: drop the backlog instead of spiralling
          s.alpha = s.acc > 0 ? s.acc / STEP : 0;
        }
        G.drainWorld();
        if (s.mode === 'host') {
          s.snapT -= dt;
          if (s.snapT <= 0) {
            s.snapT = 1 / ED.CONST.SNAP_HZ;
            const sig = N.propSig(w);
            const full = sig !== s.sig || (++s.snapN % 30 === 0);
            s.sig = sig;
            s.net.broadcast(N.encodeSnap(w, s.fxBuf, full));
            s.fxBuf = [];
          }
        }
      } else {
        s.mirror.update(dt, now);
        bellPredict(s, sdt, now);
        s.inT -= dt;
        const bell = s.me.bells && s.me.stats.weapon.kind === 'bell', B = bell ? bellState(s) : null;
        if (B && (B.haul !== !!s.me.haulIn || B.press !== (s.me.haulPress | 0) || B.near !== !!s.me.haulNear)) { B.haul = !!s.me.haulIn; B.press = s.me.haulPress | 0; B.near = !!s.me.haulNear; s.inT = 0; } // a hold, press or release, or the interactable flag changing: sent at once
        if (s.inT <= 0) {
          s.inT = 1 / ED.CONST.INPUT_HZ;
          const me = s.me, msg = { t: 'in', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, f: Math.round(me.face * 100) / 100, ax: Math.round(me.aimX || 0), ay: Math.round(me.aimY || 0), mv: me.moving ? 1 : 0, d: me.dashT > 0 ? 1 : 0, m: me.skillIfr ? 1 : 0, vx: Math.round(me.vx || 0), vy: Math.round(me.vy || 0), e: s.epoch };
          if (B) { msg.h = me.haulIn ? 1 : 0; msg.hp = me.haulPress | 0; msg.nh = me.haulNear ? 1 : 0; msg.q = ++B.seq; B.sent.set(B.seq, now); } // h: the held attack, hp: presses so far, nh: an interactable in range, q: the seq the host echoes in P[24]
          s.net.send(msg);
        }
        s.me.dashing = s.me.dashT > 0;
      }
    }
    ED.FX.update(frozen ? 0 : dt);
    if ((s.musT = (s.musT || 0) - dt) <= 0) { s.musT = 0.1; s.musLv = musicLevel(s.view, s.musLv); ED.Audio.setIntensity(s.musLv); }
    ED.Render.updateCamera(s.view, s.me.dead ? ([...s.view.players.values()].find(p => !p.dead) || s.me) : s.me, dt, false);
  };

  // Solo/host draw one step behind the sim, interpolated; the world clock shifts the same way so orbiting hazards stay in phase.
  G.render = (t, dt) => {
    const s = G.s; if (!s) return;
    if (s.mode === 'client' || s.alpha >= 1) { drawFrame(s, t, dt); return; }
    const w = s.world, tm = w.time;
    try { interp(w, s.alpha); w.time = tm - (1 - s.alpha) * STEP; drawFrame(s, t, dt); }
    finally { unterp(w); w.time = tm; }
  };
  const drawFrame = (s, t, dt) => {
    const c = ED.Render.ctx;
    const v = s.view, R = ED.Render;
    R.darkLevel += ((v.room && v.room.dark ? 1 : 0) - R.darkLevel) * Math.min(1, dt * 2.5); // eased so crossing a door never pops
    R.claimed = s.claimed;
    bellView(s);
    R.frame(s.view, s.localPid, t, dt);
    const ob = document.getElementById('ov-boon'), cover = s.offerOpen || !!(ob && !ob.hidden); // the boon overlay owns the screen: no banners or prompts under it
    ED.HUD.draw(c, s.view, s.me, Object.assign({}, s.ctl, { picks: s.me.picks || 0, offerOpen: s.offerOpen }), t, dt, { prompt: cover ? null : s.prompt, offerOpen: cover });
  };
})(globalThis.ED || (globalThis.ED = {}));
