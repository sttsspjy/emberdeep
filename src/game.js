// A run in progress: owns the authoritative world (solo/host) or a snapshot mirror (client),
// drives the local hero, routes network traffic and feeds events to effects and UI.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, N = ED.Net;
  const G = ED.Game = { s: null };

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
    if (d.r !== this.roomId) { this.roomId = d.r; this.room = this.floor.rooms[d.r]; this.snaps.length = 0; this.firstInRoom = true; }
    this.locked = !!d.L; this.gold = d.g; this.xp = d.x; this.xpNext = d.n; this.level = d.l; this.waitMsg = d.wm; this.time = d.T;
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
      p.critStacks = a[8]; p.aegisT = a[9] ? 0 : 1; p.guardT = a[10] ? 1 : 0; p.secondWind = a[11]; p.phoenixUsed = !!a[12]; p.picks = a[13]; p.rerolls = a[14];
      if (p.pid !== this.localPid) { p.moving = !!(fl & 1); p.dashing = !!(fl & 2); p.face = a[3]; }
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
      e.flash = fl & 1 ? 0.05 : 0; e.frozen = fl & 2 ? 1 : 0; e.stun = fl & 4 ? 1 : 0; e.burn = fl & 8 ? 1 : 0; e.chill = fl & 16 ? 1 : 0; e.exposed = !!(fl & 32);
      e.boss = !!e.def.boss;
      const st = N.ST[rb[8]] || 'move';
      if (e.boss) { e.pose = st; e.st = 'atk'; } else e.st = st;
      e.aimA = rb[9]; e.elite = rb[10] >= 0 ? ED.AFFIX_IDS[rb[10]] : null; e.ward = rb[11]; e.wardMax = rb[12]; e.phase = rb[13]; e.face = rb[14]; e.t = rb[15];
      e.renderT = this.renderT;
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
      this.zones = zb.list.map(z => ({ id: z[0], kind: N.ZK[z[1]], x: z[2], y: z[3], r: z[4], t: z[5] + el, dur: z[6], a: z[7], len: z[8], w: z[9], arc: z[10], team: z[11], elite: !!z[12], lob: z[13] > -99999 ? [z[13], z[14]] : null, warm: z[15], str: z[16] || 0 }));
    }
  };

  // ---------------- session lifecycle ----------------
  G.start = (mode, cfg) => {
    ED.FX.reset();
    U.resetUid(1);
    const s = G.s = { mode, cfg, localPid: cfg.localPid, net: cfg.net || null, fxBuf: [], snapT: 0, snapN: 0, inT: 0, epoch: 0, offer: null, offerOpen: false, ended: false, paused: false, prompt: null, sig: '', claimed: {} };
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
    s.ctl = { atkCd: 0, skillCd: 0, skill2Cd: 0, charges: s.me.stats.maxCharges, dashCd: 0, tranceT: 0, latch: false, target: null };
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

  G.stop = () => { G.s = null; };
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
    for (const ev of w.fx) {
      if (s.mode === 'host') s.fxBuf.push(ev);
      G.localEvent(ev);
    }
    w.fx.length = 0;
    for (const m of w.msgs) {
      if (m.to === s.localPid) G.message(m);
      else if (s.mode === 'host') s.net.sendTo(m.to, m);
    }
    w.msgs.length = 0;
  };

  G.localEvent = (ev) => {
    const s = G.s; if (!s) return;
    if (ev.t === 'room') {
      s.epoch = ev.ep;
      if (s.mode === 'client') {
        const mine = ev.pos.find(q => q[0] === s.localPid);
        if (mine) { s.me.x = mine[1]; s.me.y = mine[2]; s.me.vx = 0; s.me.vy = 0; s.me.dashT = 0; s.me.skillMove = null; }
      }
      ED.Render.updateCamera(s.view, s.me, 0, true);
      s.ctl.target = null;
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
      const sheet = document.getElementById('ov-sheet');
      if (!sheet.hidden) { ED.UI.toggleSheet(false); s.paused = !document.getElementById('ov-pause').hidden; }
      ED.UI.showBoons(m);
    }
    else if (m.t === 'offerDone') { s.offer = null; s.offerOpen = false; ED.UI.hideBoons(); }
    else if (m.t === 'claimed') s.claimed[m.group] = true;
    else if (m.t === 'toast') { ED.UI.toast(m.text); ED.Audio.play('deny'); }
    else if (m.t === 'refund') s.ctl.skill2Cd = 0; // Night's Edge: an Ambush kill refunds the second skill
  };

  // Network handlers.
  G.onHostData = (pid, d) => {
    const s = G.s; if (!s || s.mode !== 'host') return;
    const w = s.world;
    if (d.t === 'in') {
      const p = w.players.get(pid);
      if (p && d.e === w.roomEpoch && !p.downed && !p.dead) {
        p.x = +d.x || p.x; p.y = +d.y || p.y; p.face = +d.f || 0; p.moving = !!d.m; p.dashing = !!d.d; p.vx = +d.vx || 0; p.vy = +d.vy || 0;
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
    if (s.mode === 'client') { if (me.bulwarkT > 0) me.bulwarkT -= dt; if (me.tranceT > 0) me.tranceT -= dt; } // a mirror hero has no world tick
    if (ctl.charges < st.maxCharges) { ctl.skillCd -= dt; if (ctl.skillCd <= 0) { ctl.charges++; if (ctl.charges < st.maxCharges) ctl.skillCd = st.skillCd; else ctl.skillCd = 0; } }
    if (me.downed || me.dead || !view.room) { s.prompt = null; if (s.mode !== 'client') me.dashing = false; return; }
    let mx = inp.mx, my = inp.my;
    if (s.offerOpen) { mx = 0; my = 0; }
    // aim
    let aim = null;
    const set = ED.App.settings;
    if (inp.padAim !== undefined) aim = inp.padAim;
    else if (set.aim === 'mouse') { const wpt = ED.Render.toWorld(ED.Input.mouse.x * ED.Render.dpr, ED.Input.mouse.y * ED.Render.dpr); aim = Math.atan2(wpt.y - (me.y - 10), wpt.x - me.x); }
    else aim = autoAim(s, me, view);
    if (aim === null) aim = Math.atan2(me.mvy || 0, me.mvx || 1);
    me.face = aim;
    // interaction prompt
    s.prompt = null;
    let near = null, nd = 50 * 50;
    for (const p of view.props) {
      if (!ED.Render.interactable(p)) continue;
      if (view.locked && p.kind !== 'trial') continue;
      if (p.kind === 'relic' && s.claimed[p.group]) continue;
      const d = U.dist2(p.x, p.y, me.x, me.y);
      if (d < nd) { nd = d; near = p; }
    }
    if (near && !s.offerOpen) {
      const text = ED.Render.propPrompt(near, view);
      let desc = null, color = null;
      if (near.kind === 'relic' || near.stype === 'relic') { const r = ED.RELICS[near.item]; desc = r.desc; color = ED.RARITY[r.rar].color; }
      else if (near.stype === 'boon') desc = 'Grants an extra boon pick with no common options.';
      else if (near.kind === 'portal') desc = 'Step down into ' + ED.biomeFor(view.stratum + 1).name + '.';
      s.prompt = { x: near.x, y: near.y, text, desc, color, can: near.kind === 'shop' || near.kind === 'gamble' ? view.gold >= near.price : true };
    }
    if (!s.offerOpen) {
      if (inp.atkPressed && near) { G.act({ t: 'interact', id: near.id }); ctl.latch = true; ctl.atkCd = Math.max(ctl.atkCd, 0.25); }
      if (!inp.atk) ctl.latch = false;
      if (inp.atk && !ctl.latch && ctl.atkCd <= 0 && !near) {
        G.act({ t: 'atk', a: aim });
        const ws = ED.Stats.attackRate ? ED.Stats.attackRate(me) : 1 + (ctl.tranceT > 0 ? st.trance : 0) + (st.wardrum && me.hp < me.maxHp * 0.5 ? st.wardrum : 0);
        ctl.atkCd = st.atkInterval / ws;
        ED.FX.playerAttackAnim(s.localPid, aim);
        const w = st.weapon;
        if (w.kind === 'melee') {
          const reach = w.range * (1 + st.area * 0.5 + st.meleeReach), arc = Math.min(6.3, w.arc * (1 + st.area * 0.4));
          ED.FX.slash(me.x, me.y - 10, aim, reach, arc, ED.PLAYER_COLORS[me.slot]);
          ED.Audio.play(w.look === 'hammer' ? 'heavy' : 'swing');
        } else ED.Audio.play(w.proj === 'firebolt' || w.proj === 'fireball' || w.proj === 'spark' ? 'fire' : w.proj === 'soul' || w.proj === 'holy' || w.proj === 'plague' ? 'magic' : 'shoot', 0.8);
      }
      if (inp.skill && ctl.charges > 0) {
        const skill = ED.CLASSES[me.cls].skill;
        let data = null;
        if (skill === 'charge') {
          const end = Sim.castMove(view.room, me.x, me.y, aim, 150, me.r, view.locked);
          data = { x0: Math.round(me.x), y0: Math.round(me.y), x1: Math.round(end.x), y1: Math.round(end.y) };
          me.skillMove = { dx: Math.cos(aim), dy: Math.sin(aim), speed: 600, t: 0.25 };
        } else if (skill === 'step') {
          const dirA = (Math.hypot(mx, my) > 0.2) ? Math.atan2(my, mx) : aim;
          const end = Sim.castMove(view.room, me.x, me.y, dirA, 140, me.r, view.locked);
          data = { x0: Math.round(me.x), y0: Math.round(me.y), x1: Math.round(end.x), y1: Math.round(end.y) };
          me.x = end.x; me.y = end.y;
        }
        G.act({ t: 'skill', a: aim, data });
        if (ctl.charges === st.maxCharges) ctl.skillCd = st.skillCd;
        ctl.charges--;
        if (st.trance) { ctl.tranceT = 4; if (s.mode === 'client') me.tranceT = 4; }
      }
      const sk2 = ED.CLASSES[me.cls].skill2;
      if (inp.skill2 && sk2 && ctl.skill2Cd <= 0 && !(me.bulwarkT > 0)) {
        let data = null;
        if (sk2 === 'rain' || sk2 === 'meteor') { const tp = skillPoint(s, me, aim, inp, sk2 === 'rain' ? 260 : 300); data = { x: Math.round(tp.x), y: Math.round(tp.y) }; }
        else if (sk2 === 'bulwark' && s.mode === 'client') me.bulwarkT = 1.4 * (st.bastion ? 1.5 : 1); // host sets the authoritative timer
        G.act({ t: 'skill', a: aim, data, slot: 1 });
        ctl.skill2Cd = st.skill2Cd ?? ED.SKILLS[sk2].cd * Math.max(0.35, 1 - st.cdr);
        if (st.trance) { ctl.tranceT = 4; if (s.mode === 'client') me.tranceT = 4; }
      }
      if (inp.dash && ctl.dashCd <= 0 && !me.skillMove) {
        let dx = mx, dy = my;
        if (Math.hypot(dx, dy) < 0.2) { dx = Math.cos(aim); dy = Math.sin(aim); }
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        me.dashT = 0.17; me.dashDx = dx; me.dashDy = dy;
        ctl.dashCd = st.dashCd;
        G.act({ t: 'dash', dx, dy });
      }
    }
    if (me.bulwarkT > 0) { mx *= 0.5; my *= 0.5; }
    Sim.movePlayer(me, { mx, my }, dt, view.room, view.locked, view.zones);
    if (s.mode !== 'client') me.dashing = me.dashT > 0 || !!me.skillMove;
  }

  // Target point of Rain of Arrows / Meteor: cursor (mouse aim), else the auto-target, else 200 along the aim; clamped to range.
  function skillPoint(s, me, aim, inp, range) {
    let tx = me.x + Math.cos(aim) * 200, ty = me.y + Math.sin(aim) * 200;
    if (inp.padAim === undefined) {
      const tgt = s.ctl.target;
      if (ED.App.settings.aim === 'mouse') { const wpt = ED.Render.toWorld(ED.Input.mouse.x * ED.Render.dpr, ED.Input.mouse.y * ED.Render.dpr); tx = wpt.x; ty = wpt.y; }
      else if (tgt && tgt.hp > 0) { tx = tgt.x; ty = tgt.y; }
    }
    const d = Math.hypot(tx - me.x, ty - me.y);
    if (d > range) { tx = me.x + (tx - me.x) * range / d; ty = me.y + (ty - me.y) * range / d; }
    return { x: tx, y: ty };
  }

  function autoAim(s, me, view) {
    const st = me.stats, range = st.melee ? 230 : 420;
    let best = null, bs = Infinity;
    const fx = me.mvx || 0, fy = me.mvy || 0;
    for (const e of view.enemies) {
      if (e.hp <= 0 || e.def.invuln || e.burrowed) continue;
      const dx = e.x - me.x, dy = e.y - me.y, d = Math.hypot(dx, dy);
      if (d > range) continue;
      const dot = (dx * fx + dy * fy) / (d || 1);
      let sc = d * (1.2 - 0.3 * dot);
      if (!Sim.los(view.room, me.x, me.y, e.x, e.y, view.locked)) sc *= 3;
      if (e === s.ctl.target) sc *= 0.75;
      if (sc < bs) { bs = sc; best = e; }
    }
    s.ctl.target = best;
    return best ? Math.atan2(best.y - (me.y - 4), best.x - me.x) : null;
  }

  // ---------------- per-frame ----------------
  G.update = (dt, inp) => {
    const s = G.s; if (!s) return;
    const now = performance.now() / 1000;
    const alone = G.alone(), frozen = alone && s.paused;
    // Alone, the world waits while you read boon cards (offers only open in a safe room), so picking never costs lantern time.
    const hold = alone && s.offerOpen;
    if (!frozen) {
      if (s.offer) {
        const safe = !s.view.locked && !s.view.enemies.some(e => e.hp > 0);
        if (!safe && s.offerOpen) { ED.UI.hideBoons(); s.offerOpen = false; s.offerHidden = true; }
        else if (safe && !s.offerOpen && s.offerHidden) { s.offerHidden = false; s.offerOpen = true; ED.UI.showBoons(s.offer); }
      }
      if (s.offerOpen) {
        if (inp.left || inp.up) ED.UI.boonMove(-1);
        if (inp.right || inp.down) ED.UI.boonMove(1);
        if (inp.confirm) ED.UI.boonConfirm();
        if (inp.skill) ED.UI.boonReroll(true);
      }
      control(s, inp, dt);
      if (s.mode !== 'client') {
        const w = s.world;
        if (!hold) {
          const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
          for (let i = 0; i < steps; i++) w.update(dt / steps);
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
          s.net.send({ t: 'in', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, f: Math.round(me.face * 100) / 100, m: me.moving ? 1 : 0, d: (me.dashT > 0 || me.skillMove) ? 1 : 0, vx: Math.round(me.vx || 0), vy: Math.round(me.vy || 0), e: s.epoch });
        }
        s.me.dashing = s.me.dashT > 0 || !!s.me.skillMove;
      }
    }
    ED.FX.update(frozen ? 0 : dt);
    ED.Render.updateCamera(s.view, s.me.dead ? ([...s.view.players.values()].find(p => !p.dead) || s.me) : s.me, dt, false);
  };

  G.render = (t, dt) => {
    const s = G.s; if (!s) return;
    const c = ED.Render.ctx;
    ED.Render.frame(s.view, s.localPid, t, dt);
    ED.HUD.draw(c, s.view, s.me, Object.assign({}, s.ctl, { picks: s.me.picks || 0, offerOpen: s.offerOpen }), t, dt, { prompt: s.prompt, offerOpen: s.offerOpen });
  };
})(globalThis.ED || (globalThis.ED = {}));
