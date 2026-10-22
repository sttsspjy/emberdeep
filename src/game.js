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
      p.mastery10 = (pd.meta && pd.meta.mastery >= 10);
      this.players.set(p.pid, p);
    }
    this.localPid = localPid; this.pact = cfg.pact;
    this.enemies = []; this.projs = []; this.pickups = []; this.zones = []; this.allies = []; this.props = [];
    this.floor = null; this.room = null; this.roomId = -1; this.roomState = {}; this.stratum = 0; this.floorSeed = 0;
    this.gold = 0; this.level = 1; this.xp = 0; this.xpNext = 20; this.time = 0; this.locked = false; this.waitMsg = '';
    this.snaps = []; this.renderT = 0; this.run = null; this.eMap = new Map();
    this.light = 100; this.lightMax = 100; this.dread = { tier: 0 }; this.deepRooms = 0;
  }
  Mirror.prototype.recalc = function (p) {
    p.stats = ED.Stats.compute({ cls: p.cls, weapon: p.weapon, boons: p.boons, relics: p.relics, meta: p.meta, pact: this.pact, chaliceHp: p.chaliceHp, bonusHp: p.bonusHp });
  };
  Mirror.prototype.apply = function (d, now) {
    if (d.s !== this.stratum || d.fs !== this.floorSeed) {
      this.stratum = d.s; this.floorSeed = d.fs;
      this.floor = ED.Dungeon.generate(d.s, d.fs);
      this.roomState = {};
      for (const rm of this.floor.rooms) this.roomState[rm.id] = { visited: false, known: false, cleared: false };
      this.roomId = -1;
    }
    if (d.r !== this.roomId) {
      this.roomId = d.r; this.room = this.floor.rooms[d.r]; this.snaps.length = 0; this.firstInRoom = true;
      const tough = this.room.type === 'elite' || this.room.type === 'boss';
      for (const p of this.players.values()) p.toughRoom = tough; // War Drum doubles in these rooms
    }
    this.locked = !!d.L; this.gold = d.g; this.xp = d.x; this.xpNext = d.n; this.level = d.l; this.waitMsg = d.wm; this.time = d.T;
    this.light = d.li; this.lightMax = d.lm || 100; this.dread = { tier: d.dr | 0 }; this.deepRooms = d.dp | 0;
    if (d.O) this.props = d.O.map(a => ({ id: a[0], kind: a[1], x: a[2], y: a[3], state: a[4], item: a[5], price: a[6], group: a[7], stype: a[8], text: a[9] }));
    if (d.RS) d.RS.forEach((b, i) => { this.roomState[i] = { visited: !!(b & 1), known: !!(b & 2), cleared: !!(b & 4) }; });
    if (d.RUN) this.run = d.RUN;
    const P = new Map(), E = new Map(), K = new Map(), A = new Map();
    for (const a of d.P) P.set(a[0], a);
    for (const a of d.E) E.set(a[0], a);
    for (const a of d.K) K.set(a[0], a);
    for (const a of d.A) A.set(a[0], a);
    this.snaps.push({ T: d.T, recv: now, P, E, K, A });
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
      p.glT = p.glBuff ? 1 : 0; p.glV = a[22] || 0; p.auraT = p.embolden ? 1 : 0; p.auraV = a[23] || 0; p.knellN = a[21] | 0; p.knellT = p.knellN ? 1 : 0; // timed damage bonuses the Tab sheet and Stats read
      if (p.pid !== this.localPid) { p.moving = !!(fl & 1); p.dashing = !!(fl & 2); p.face = a[3]; p.braceT = fl & 1048576 ? 1 : 0; p.tranceT = fl & 4096 ? 1 : 0; } // the local hero predicts its own Trance
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
      e.boss = !!e.def.boss;
      const st = N.ST[rb[8]] || 'move';
      if (e.boss) { e.pose = st; e.st = 'atk'; } else e.st = st;
      e.burrowed = st === 'burrow' && !e.boss;
      e.aimA = rb[9]; e.elite = rb[10] >= 0 ? ED.AFFIX_IDS[rb[10]] : null; e.ward = rb[11]; e.wardMax = rb[12]; e.phase = rb[13]; e.face = rb[14]; e.t = rb[15];
      out.push(e);
    }
    if (this.eMap.size > out.length * 2 + 40) { const keep = new Map(); for (const e of out) keep.set(e.id, e); this.eMap = keep; }
    this.enemies = out;
    // pickups & allies
    this.pickups = []; for (const [id, rb] of b.K) { const ra = a.K.get(id); const xy = lerpXY(ra, rb); this.pickups.push({ id, kind: N.PK[rb[1]], x: xy[0], y: xy[1] }); }
    this.allies = []; for (const [id, rb] of b.A) { const ra = a.A.get(id); const xy = lerpXY(ra, rb); this.allies.push({ id, owner: rb[1], x: xy[0], y: xy[1], face: rb[4] }); }
    // projectiles: extrapolated to "now" so dodging reads true
    const pb = this.projBase;
    if (pb) {
      const el = Math.min(0.25, hostNow - pb.T);
      this.projs = pb.list.map(q => ({ id: q[0], kind: ED.PROJ_KINDS[q[1]], x: q[2] + q[4] * el, y: q[3] + q[5] * el, vx: q[4], vy: q[5], r: q[6], team: q[7] }));
    }
    const zb = this.zoneBase;
    if (zb) {
      const el = now - zb.recv;
      this.zones = zb.list.map(z => ({ id: z[0], kind: N.ZK[z[1]], x: z[2], y: z[3], r: z[4], t: z[5] + el, dur: z[6], a: z[7], len: z[8], w: z[9], arc: z[10], team: z[11], elite: !!z[12], lob: z[13] > -99999 ? [z[13], z[14]] : null, warm: z[15], str: z[16] || 0, fol: z[17] | 0 }));
      for (const z of this.zones) if (z.fol) for (const p of this.players.values()) if (p.slot === z.fol - 1) { z.x = p.x; z.y = p.y; break; } // a zone that follows its hero is drawn on the hero's smoothed position
    }
  };

  // ---------------- session lifecycle ----------------
  G.start = (mode, cfg) => {
    ED.FX.reset();
    ED.Render.lightLevel = 1;
    U.resetUid(1);
    if (ED.Actors) ED.Actors.reset();
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
      for (const p of s.world.players.values()) p.mastery10 = p.meta && p.meta.mastery >= 10;
    }
    s.view.pact = cfg.pact;
    s.ctl = { atkCd: 0, skillCd: 0, skill2Cd: 0, charges: s.me.stats.maxCharges, dashCd: 0, tranceT: 0, latch: false, aimA: 0 };
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
      case 'atk': w.playerAttack(p, +a.a || 0); break;
      case 'skill': if ((a.slot | 0) === 0 || (a.slot | 0) === 1) w.playerSkill(p, +a.a || 0, a.data, a.slot | 0); break;
      case 'dash': w.playerDash(p, +a.dx || 0, +a.dy || 0); break;
      case 'flare': w.flare(p); break;
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

  const SHEET_EVENTS = { build: 1, boon: 1, evolve: 1, levelup: 1, dread: 1, room: 1, relic: 1, stratum: 1 }; // events that change what the open character sheet shows
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
        p.boons = ev.b.boons; p.relics = ev.b.relics; p.chaliceHp = ev.b.chaliceHp; p.bonusHp = ev.b.bonusHp || 0; s.mirror.recalc(p);
        if (p === s.me && p.stats.maxCharges > hadEcho) s.ctl.charges++;
      }
    } else if (ev.t === 'boon' && s.mode !== 'client' && ev.pid === s.localPid) {
      if (s.me.stats.maxCharges > s.ctl.charges && ED.BOONS[ev.id].mods.charges) s.ctl.charges++;
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
    else if (m.t === 'refund') { // cooldown refund { slot, s }: s seconds off (a charge returns when the cooldown reaches 0), no s = in full
      const c = s.ctl;
      if (m.slot === 1) c.skill2Cd = m.s ? Math.max(0, c.skill2Cd - m.s) : 0;
      else if (m.s) c.skillCd -= m.s;
      else c.charges = Math.min(s.me.stats.maxCharges, c.charges + 1);
    }
  };

  // Network handlers.
  G.onHostData = (pid, d) => {
    const s = G.s; if (!s || s.mode !== 'host') return;
    const w = s.world;
    if (d.t === 'in') {
      const p = w.players.get(pid);
      if (p && d.e === w.roomEpoch && !p.downed && !p.dead) {
        p.x = +d.x || p.x; p.y = +d.y || p.y; p.face = +d.f || 0; p.moving = !!d.mv; p.dashing = !!d.d; p.skillIfr = !!d.m; p.vx = +d.vx || 0; p.vy = +d.vy || 0;
        Sim.resolve(p, w.room, w.locked, false);
      }
    } else if (d.t === 'act') G.applyAction(w, pid, d.a);
  };
  G.onClientData = (d) => {
    const s = G.s; if (!s || s.mode !== 'client') return;
    if (d.t === 's') {
      const fx = s.mirror.apply(d, performance.now() / 1000);
      for (const ev of fx) G.localEvent(ev);
    } else if (d.t === 'end') G.localEvent({ t: 'end', summary: d.summary });
    else if (d.t === 'offer' || d.t === 'offerDone' || d.t === 'claimed' || d.t === 'toast' || d.t === 'refund') G.message(d);
  };
  G.onPeerLeft = (pid) => { const s = G.s; if (s && s.mode === 'host') { s.world.removePlayer(pid); } };

  // ---------------- local hero control ----------------
  function control(s, inp, dt) {
    const me = s.me, view = s.view, ctl = s.ctl, st = me.stats;
    ctl.atkCd -= dt; ctl.dashCd -= dt; ctl.tranceT -= dt; ctl.skill2Cd -= dt;
    if (s.mode === 'client') for (const k of MIRROR_TIMERS) if (me[k] > 0) me[k] -= dt; // a mirror hero has no world tick
    if (s.mode === 'client') { me.atkAge = (me.atkAge === undefined ? 9 : me.atkAge) + dt; me.chanT = st.channel > 0 && !me.moving && me.atkAge < ED.chanWindow(me) ? (me.chanT || 0) + dt : 0; } // Channel (a client's chip estimates the host's value)
    if (ctl.charges < st.maxCharges) { ctl.skillCd -= dt; while (ctl.skillCd <= 0 && ctl.charges < st.maxCharges) { ctl.charges++; ctl.skillCd = ctl.charges < st.maxCharges ? ctl.skillCd + st.skillCd : 0; } } // a refund past the running cooldown carries into the next charge
    if (me.downed || me.dead || !view.room) {
      s.prompt = null; if (s.mode !== 'client') me.dashing = false;
      s.aim.show = false; s.aim.ground.length = 0; ED.AimFx.hover(ED.Input.device === 'pad', false);
      return;
    }
    let mx = inp.mx, my = inp.my;
    if (s.offerOpen) { mx = 0; my = 0; }
    const aim = aimOf(s, me, inp);
    me.face = aim;
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
      else if (near.kind === 'portal') desc = 'Step down into ' + ED.biomeFor(view.stratum + 1).name + '.';
      else { desc = ED.Render.propDesc(near, view); if (near.kind === 'reward') color = ED.Render.rewardColor(near.item); }
      const full = near.stype === 'oil' && view.light >= view.lightMax - 0.5;
      s.prompt = { x: near.x, y: near.y, text, desc, color, can: near.kind === 'shop' || near.kind === 'gamble' ? view.gold >= near.price && !full : true };
    }
    if (!s.offerOpen) {
      if (inp.atkPressed && near) { G.act({ t: 'interact', id: near.id }); ctl.latch = true; ctl.atkCd = Math.max(ctl.atkCd, 0.25); }
      if (!inp.atk) ctl.latch = false;
      if (inp.atk && !ctl.latch && ctl.atkCd <= 0 && !near) {
        const w = st.weapon, cl = isCleave(me, st, w, view.time); // decided before the act: the sim spends the Follow-Through
        G.act({ t: 'atk', a: aim });
        if (s.mode === 'client') { me.atkCount = (me.atkCount | 0) + 1; if (st.swift) me.flowT = ED.CONST.FLOW_T; if (cl) me.cleaveNext = 0; } // the host spends Follow-Through on the Cleave it grants
        if (s.mode === 'client') me.atkAge = 0;
        ctl.atkCd = Math.max(ctl.atkCd, -dt) + ED.Stats.attackInterval(me); // carries the overshoot of this frame so the real rate equals the shown one
        s.aim.pulseT = performance.now();
        ED.FX.playerAttackAnim(s.localPid, aim);
        if (w.kind === 'melee') {
          const reach = w.range * (1 + st.area * 0.5 + st.meleeReach) * (cl ? 1.4 : 1), arc = Math.min(6.3, w.arc * (1 + st.area * 0.4) * (cl ? 1.4 : 1));
          ED.FX.slash(me.x, me.y - 10, aim, reach, arc, cl ? '#ffd36b' : ED.PLAYER_COLORS[me.slot]);
          ED.Audio.play(cl || w.look === 'hammer' ? 'heavy' : 'swing');
          if (cl) ED.FX.hitStop(0.06);
        } else ED.Audio.play(w.proj === 'firebolt' || w.proj === 'fireball' || w.proj === 'spark' ? 'fire' : w.proj === 'soul' || w.proj === 'holy' || w.proj === 'plague' ? 'magic' : 'shoot', 0.8);
      }
      if (inp.skill && ctl.charges > 0) {
        const skill = ED.CLASSES[me.cls].skill, N = ED.Stats.skillNums(skill, st), C = ED.CONST;
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
        } else data = groundData(view, me, s.aim, skill, st);
        G.act({ t: 'skill', a: aim, data });
        castMove(view, me, N, aim, data);
        if (ctl.charges === st.maxCharges) ctl.skillCd = st.skillCd;
        ctl.charges--;
        if (st.trance) { ctl.tranceT = 4; if (s.mode === 'client') me.tranceT = 4; }
      }
      const sk2 = ED.CLASSES[me.cls].skill2;
      if (inp.skill2 && sk2 && ctl.skill2Cd <= 0) {
        const N2 = ED.Stats.skillNums(sk2, st);
        let data = groundData(view, me, s.aim, sk2, st);
        if (sk2 === 'shieldthrow') { const ww = ED.AimFx.want(me, s.aim, N2.range); data = { d: Math.round(Math.hypot(ww.x - me.x, ww.y - (me.y - 4))) }; } // cursor distance: how far the shield flies
        G.act({ t: 'skill', a: aim, data, slot: 1 });
        castMove(view, me, N2, aim, data);
        if (sk2 === 'vanish' && s.mode === 'client') me.stealthT = 2.5 + st.stealthDur; // the host's flag takes over with the next snapshot
        if (sk2 === 'meteor' && N2.move && s.mode === 'client') me.cometT = N2.move.t; // Comet: airborne until the landing
        ctl.skill2Cd = st.skill2Cd;
        if (st.trance) { ctl.tranceT = 4; if (s.mode === 'client') me.tranceT = 4; }
      }
      if (inp.flare && view.light >= ED.World.FLARE.cost && view.room.type !== 'boss') G.act({ t: 'flare' }); // host checks light, room and cooldown
      if (inp.dash && ctl.dashCd <= 0 && !me.skillMove) {
        let dx = mx, dy = my;
        if (Math.hypot(dx, dy) < 0.2) { dx = Math.cos(aim); dy = Math.sin(aim); }
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        me.dashT = 0.17; me.dashDx = dx; me.dashDy = dy;
        ctl.dashCd = st.dashCd;
        G.act({ t: 'dash', dx, dy });
      }
    }
    Sim.movePlayer(me, { mx, my }, dt, view.room, view.locked, view.zones);
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
  function addReady(a, n, slot, id, st) {
    const ai = ED.skillAim(id, st);
    if (ai.aim !== 'ground' && id !== 'step') return n;
    const g = a.ground[n] || (a.ground[n] = {});
    g.slot = slot; g.id = id; g.move = ai.aim !== 'ground'; g.range = ai.range || 140; g.walk = !!ai.walk;
    return n + 1;
  }
  function aimExtras(s, me, view) {
    const a = s.aim, ctl = s.ctl, st = me.stats, cls = ED.CLASSES[me.cls];
    let n = 0;
    if (ctl.charges > 0) n = addReady(a, n, 0, cls.skill, st);
    if (cls.skill2 && ctl.skill2Cd <= 0) n = addReady(a, n, 1, cls.skill2, st);
    a.ground.length = n;
    for (let i = 0; i < n; i++) { const g = a.ground[i]; g.r = g.move ? 0 : ED.skillRadius(g.id, st); }
    const iv = ED.Stats.attackInterval(me);
    a.cd = iv >= 0.45 ? U.clamp(ctl.atkCd / iv, 0, 1) : 0;
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
  // Mirrors World.isSafe: calm room, no live foe except the invulnerable Gloom, no descent pending (clients see no pendingStratum).
  const isSafe = (v) => !v.locked && !v.pendingStratum && !v.enemies.some(e => e.hp > 0 && !e.def.gloom);
  // Music level from the viewed foe list (host, solo and client alike): 0 calm, 1 foes alive or the room locked, 2 heavy at 25 live foes (held until fewer than 12);
  // a boss piece plays its phase (1 -> 0 .. 3 -> 2), lifted to 1 by 8 or more summons.
  const musicLevel = (v, prev) => {
    let n = 0, boss = null;
    for (const e of v.enemies) { if (e.hp <= 0 || e.def.gloom || e.spawnT > 0) continue; if (e.boss) boss = e; else n++; }
    if (boss) return Math.max(Math.min(2, (boss.phase | 0) - 1), n >= 8 ? 1 : 0);
    if (n >= 25 || (prev === 2 && n >= 12)) return 2;
    return v.locked || n > 0 ? 1 : 0;
  };
  G.update = (dt, inp) => {
    const s = G.s; if (!s) return;
    const now = performance.now() / 1000;
    const alone = G.alone(), frozen = alone && s.paused;
    // Alone, the world waits while you read boon cards (offers only open in a safe room), so the Gloom's delay never runs while you pick.
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
        s.inT -= dt;
        if (s.inT <= 0) {
          s.inT = 1 / ED.CONST.INPUT_HZ;
          const me = s.me;
          s.net.send({ t: 'in', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, f: Math.round(me.face * 100) / 100, mv: me.moving ? 1 : 0, d: me.dashT > 0 ? 1 : 0, m: me.skillIfr ? 1 : 0, vx: Math.round(me.vx || 0), vy: Math.round(me.vy || 0), e: s.epoch });
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
    const v = s.view, R = ED.Render, lit = v.room && v.lightMax > 0 ? U.clamp(v.light / v.lightMax, 0, 1) : 1;
    R.lightLevel += (lit - R.lightLevel) * Math.min(1, dt * 2.5); // eased so a refill or a tier drop never pops
    R.claimed = s.claimed;
    R.frame(s.view, s.localPid, t, dt);
    const ob = document.getElementById('ov-boon'), cover = s.offerOpen || !!(ob && !ob.hidden); // the boon overlay owns the screen: no banners or prompts under it
    ED.HUD.draw(c, s.view, s.me, Object.assign({}, s.ctl, { picks: s.me.picks || 0, offerOpen: s.offerOpen }), t, dt, { prompt: cover ? null : s.prompt, offerOpen: cover });
  };
})(globalThis.ED || (globalThis.ED = {}));
