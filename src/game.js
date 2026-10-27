// Run session (client side): owns the World on solo / host, or a snapshot mirror (ED.Net.Mirror) on a co-op client; reads local input, steps the fixed 60 Hz sim
// (or the own hero's prediction), drains events into FX / audio / HUD / UI, and keeps the view model ED.Game.view (ARCHITECTURE §10) that render.js and hud.js read.
// Solo / host: the view arrays alias the World arrays. Host: each remote client's inputs come out of a jitter buffer one client tick per sim tick (missing ticks repeat
// the newest input), snapshots go out at SNAP_HZ, offers as JSON when they change. Client: inputs go out at INPUT_HZ; the own hero (movement + dash) is predicted per local
// tick and reconciled on every snapshot (server state at the acked input, then the newer inputs replayed; the visible jump blends out); everything else is interpolated
// INTERP behind the newest snapshot, and snapshot events are released at that render time.
(function (ED) {
  'use strict';
  const C = ED.CONST, U = ED.U, STEP = C.TICK, MAX_STEPS = 8;
  const SNAP_TICKS = Math.max(1, Math.round(1 / (C.SNAP_HZ * STEP))), IN_DT = 1 / C.INPUT_HZ;
  const INTERP = 0.1;   // client render delay behind the newest snapshot (s): two snapshot intervals
  const JIT = 3;        // host: frames a client must have queued before its inputs start (jitter buffer depth)
  const BACKLOG = 9;    // host: more queued frames than this skips ahead to JIT
  const LATE = 8;       // host: this many late frames in a row re-anchor a client that fell behind
  const IDLE = 6;       // host: missing ticks after which a silent client's hero stops
  const HIST = 256, HM = HIST - 1;
  const SNAP_PX = 96;   // client: a correction larger than this snaps instead of blending
  const BLEND = 12;     // client: correction offset decay (1/s)
  const NET_EV_CAP = 5000;

  const blankView = () => ({ me: null, heroes: [], foes: [], projs: [], zones: [], pickups: [], props: null, stage: 0, seed: 0, time: 0, xp: 0, xpNext: 1, level: 1, kills: 0, gold: 0, boss: null, bossBar: null, events: [] });

  function Session() { this.onEnd = null; this.onEvent = null; this.clear(); }
  const S = Session.prototype;
  S.clear = function () {
    this.w = null; this.mode = 'off'; this.myPid = 'p1'; this.view = null; this.paused = false; this.acc = 0; this.ended = false;
    this.net = null; this.mir = null; this.rem = null; this.netEv = []; this.pidIdx = {}; this.snapTick = 0;
    if (this.bg) { clearInterval(this.bg); this.bg = 0; }
  };
  S.active = function () { return !!this.view; };
  S.coop = function () { return this.mode === 'host' || this.mode === 'client'; };

  // cfg: { mode: 'solo' | 'host', seed, stage, players: [{ pid, name, slot, cls, meta }], myPid, cheats, net (host: { send(pid, d), busy(pid), ended() }) }
  S.start = function (cfg) {
    this.clear();
    this.mode = cfg.mode || 'solo'; this.myPid = cfg.myPid || cfg.players[0].pid;
    const w = this.w = new ED.World({ seed: cfg.seed, stage: cfg.stage, players: cfg.players, cheats: cfg.cheats });
    const v = this.view = blankView();
    v.heroes = w.heroes; v.foes = w.foes; v.projs = w.projs; v.zones = w.zones; v.pickups = w.pickups; v.props = w.arena;
    v.stage = w.stage; v.seed = w.seed; v.me = w.hero(this.myPid);
    if (this.mode === 'host') this.hostSetup(cfg.net);
    if (ED.FX) ED.FX.clear();
    this.syncView();
    return w;
  };
  // A co-op run from the party (ED.Net.Party): cfg.mode 'host' (as start) or 'client' ({ seed, stage, myPid, roster: [{ pid, slot, name, cls }], net: { send(d), leave() } }).
  S.startNet = function (cfg) { return cfg.mode === 'client' ? this.startClient(cfg) : this.start(cfg); };
  S.stop = function () { this.clear(); };
  S.syncView = function () {
    const w = this.w, v = this.view; if (!w || !v) return;
    v.time = w.time; v.xp = w.xp; v.xpNext = w.xpNext; v.level = w.level; v.kills = w.kills; v.gold = w.gold; v.boss = w.boss; v.bossBar = w.bossBar; v.me = w.hero(this.myPid);
  };

  // Local input -> World / client latch (once per frame; edge flags latch until the next tick consumes them).
  const IN = { mx: 0, my: 0, ax: 0, ay: 0, dash: false, q: false, e: false, pick: 0, reroll: false, skip: false };
  S.control = function (inp) {
    if (this.mode === 'client') { this.clientControl(inp); return; }
    const w = this.w, me = w && w.hero(this.myPid);
    if (!me) return;
    const aim = ED.AimFx.point(me, inp);
    IN.mx = inp.mx; IN.my = inp.my; IN.ax = aim.wx; IN.ay = aim.wy;
    IN.dash = inp.dash; IN.q = inp.q; IN.e = inp.e; IN.pick = inp.pick; IN.reroll = inp.reroll; IN.skip = inp.skip;
    w.input(this.myPid, IN);
  };
  // Card pick from the UI (click): 0-based index.
  S.pick = function (i) { if (this.mode === 'client') this.clientPick(i + 1); else if (this.w) this.w.input(this.myPid, { pick: i + 1 }); };
  S.reroll = function () { if (this.mode === 'client') this.L.ed |= 8; else if (this.w) this.w.input(this.myPid, { reroll: true }); };
  S.skip = function () { if (this.mode === 'client') this.L.ed |= 16; else if (this.w) this.w.input(this.myPid, { skip: true }); };
  S.banish = function (i) { if (this.mode === 'client') this.clientBanish(i + 1); else if (this.w) this.w.input(this.myPid, { banish: i + 1 }); };

  // Advances by real time dt (fixed steps, at most cap) and routes events. Returns the number of steps run.
  S.update = function (dt, cap) {
    if (this.mode === 'client') return this.clientUpdate(dt);
    const w = this.w; if (!w || this.paused) return 0;
    this.acc = Math.min(this.acc + dt, STEP * (cap || MAX_STEPS));
    let n = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.rem) for (const rc of this.rem.values()) this.feed(rc);
      w.update(STEP); n++; this.drain();
    }
    if (this.rem && this.rem.size && w.tick - this.snapTick >= SNAP_TICKS) { this.snapTick = w.tick; this.sendSnaps(); }
    this.syncView();
    return n;
  };
  S.drain = function () {
    const w = this.w; if (!w) return;
    const evs = w.events, ctx = { me: this.myPid, crowd: (ED.Render && ED.Render.crowd) || 0 }, keep = this.rem && this.rem.size;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (keep && ev.t !== 'end' && this.netEv.length < NET_EV_CAP) this.netEv.push(ev);
      this.route(ev, ctx);
      if (ev.t === 'end' && !this.ended) {
        this.ended = true;
        if (this.mode === 'host') this.hostEnd(ev.summary);
        if (this.onEnd) this.onEnd(ev.summary);
      }
    }
    evs.length = 0;
  };
  S.route = function (ev, ctx) {
    if (ED.FX) ED.FX.handle(ev, ctx);
    sound(ev, this.myPid);
    if (this.onEvent) this.onEvent(ev);
  };
  // Leaves the run: solo / host end it as lost (a host ends it for everyone); a client leaves the party and gets its own results.
  S.quit = function () {
    if (this.mode === 'client') { if (this.net && this.net.leave) this.net.leave(); this.netLost('You left the run.'); return; }
    const w = this.w;
    if (w && w.state === 'play') { w.end(false); this.paused = false; this.drain(); }
  };

  // ---------------- host ----------------
  S.hostSetup = function (net) {
    const w = this.w;
    this.net = net || null; this.rem = new Map(); this.netEv = []; this.snapTick = 0; this.pidIdx = {};
    w.heroes.forEach((p, i) => { this.pidIdx[p.pid] = i; });
    for (const p of w.heroes) if (p.pid !== this.myPid) {
      this.rem.set(p.pid, {
        pid: p.pid, idx: this.pidIdx[p.pid], pidIdx: this.pidIdx, q: [], free: [], ack: 0, newest: 0, anchored: false, started: false, wait: 0, late: 0, miss: 0,
        lx: 0, ly: 0, lax: p.x + 100, lay: p.y, vw: C.VIEW_W, vh: C.VIEW_H, seq: 0, evs: null, carry: [], offer: null, bytes: 0,
      });
    }
    // A hidden host tab gets no animation frames: a timer keeps the shared run going (browsers throttle it, so it may run many steps at once).
    if (typeof document !== 'undefined' && this.rem.size) {
      let last = performance.now();
      this.bg = setInterval(() => {
        const t = performance.now(), d = (t - last) / 1000; last = t;
        if (document.hidden && this.mode === 'host' && this.w) this.update(Math.min(d, 1), 60);
      }, 50);
    }
  };
  // Binary input packet (or anything else) from client pid.
  S.onNetData = function (pid, d) {
    if (this.mode === 'client') { this.clientData(pid); return; }
    const rc = this.rem && this.rem.get(pid);
    if (!rc || !(d instanceof ArrayBuffer)) return;
    this.rc = rc;
    const v = ED.Net.decodeInput(d, this.pushFrame || (this.pushFrame = (seq, qx, qy, ax, ay, ed) => this.queueFrame(seq, qx, qy, ax, ay, ed)));
    if (v) { rc.vw = v.vw; rc.vh = v.vh; }
  };
  S.queueFrame = function (seq, qx, qy, ax, ay, ed) {
    const rc = this.rc;
    if (seq <= rc.newest) return; // already queued
    rc.newest = seq; rc.lx = qx; rc.ly = qy; rc.lax = ax; rc.lay = ay;
    if (!rc.anchored) { rc.anchored = true; rc.ack = seq - 1; }
    if (seq <= rc.ack) rc.late++;
    const f = rc.free.pop() || {};
    f.seq = seq; f.qx = qx; f.qy = qy; f.ax = ax; f.ay = ay; f.ed = ed;
    rc.q.push(f);
  };
  // One sim tick of client rc's input: the next frame in sequence, else the newest input repeated (stopped after IDLE missing ticks). Presses in skipped frames carry over.
  const RI = { mx: 0, my: 0, ax: 0, ay: 0, dash: false, q: false, e: false, pick: 0, reroll: false, skip: false };
  S.feed = function (rc) {
    if (!rc.anchored) return;
    const q = rc.q;
    if (rc.late >= LATE) { // the client fell behind (its tab stalled): restart from its newest frame
      rc.late = 0; rc.ack = rc.newest; rc.started = false; rc.wait = 0;
    }
    if (!rc.started) { if (q.length < JIT && ++rc.wait < 30) return; rc.started = true; }
    let ed = 0;
    const want = rc.ack + 1;
    while (q.length && q[0].seq < want) { ed |= q[0].ed; rc.free.push(q.shift()); }
    if (q.length > BACKLOG) while (q.length > JIT) { ed |= q[0].ed; rc.free.push(q.shift()); }
    let qx, qy;
    if (q.length) {
      const f = q.shift();
      rc.ack = f.seq; rc.miss = 0; rc.late = 0; ed |= f.ed; qx = f.qx; qy = f.qy; RI.ax = f.ax; RI.ay = f.ay;
      rc.free.push(f);
    } else {
      rc.ack = want; rc.miss++;
      const idle = rc.miss > IDLE; qx = idle ? 0 : rc.lx; qy = idle ? 0 : rc.ly; RI.ax = rc.lax; RI.ay = rc.lay;
    }
    RI.mx = qx / 127; RI.my = qy / 127;
    RI.dash = !!(ed & 1); RI.q = !!(ed & 2); RI.e = !!(ed & 4); RI.reroll = !!(ed & 8); RI.skip = !!(ed & 16); RI.pick = (ed >> 5) & 7;
    this.w.input(rc.pid, RI);
  };
  S.sendSnaps = function () {
    const w = this.w, net = this.net;
    if (!net) { this.netEv.length = 0; return; }
    for (const rc of this.rem.values()) {
      const p = w.heroes[rc.idx], offer = p && !p.dead ? p.offer || null : null;
      if (offer !== rc.offer) { rc.offer = offer; net.send(rc.pid, { t: 'offer', cards: offer }); }
      rc.evs = this.netEv;
      if (net.busy(rc.pid)) { ED.Net.keepEvents(rc); continue; }
      rc.seq++;
      const buf = ED.Net.encodeSnap(w, rc);
      rc.bytes = buf.byteLength;
      net.send(rc.pid, buf);
    }
    this.netEv.length = 0;
  };
  S.hostEnd = function (sum) {
    const net = this.net;
    if (net) { for (const rc of this.rem.values()) net.send(rc.pid, { t: 'end', summary: sum }); if (net.ended) net.ended(); }
  };
  // Client pid left mid-run: its hero falls (party size and foe scaling follow the players still here).
  S.netLeft = function (pid) {
    const w = this.w; if (!w || !this.rem) return;
    this.rem.delete(pid);
    const p = w.hero(pid);
    if (p && !p.dead && w.state === 'play') { p.dead = true; p.downed = false; p.offer = null; p.pend = 0; p.hp = 0; w.emit({ t: 'dead', pid, left: true }); }
    w.partyN = Math.max(1, 1 + this.rem.size);
  };

  // ---------------- client ----------------
  S.startClient = function (cfg) {
    this.clear();
    this.mode = 'client'; this.myPid = cfg.myPid; this.net = cfg.net || null;
    const M = this.mir = new ED.Net.Mirror({ stage: cfg.stage, seed: cfg.seed, roster: cfg.roster, myPid: cfg.myPid });
    this.view = M.view;
    this.P = { x: 0, y: 0, dashT: 0, dashCd: 0, dashDx: 1, dashDy: 0, mdir: 0, mvx: 0, mvy: 0, moving: false };
    this.L = { mx: 0, my: 0, ax: 0, ay: 0, ed: 0, pick: 0 };
    this.hist = []; for (let i = 0; i < HIST; i++) this.hist.push({ seq: 0, qx: 0, qy: 0, mx: 0, my: 0, ax: 0, ay: 0, ed: 0 });
    this.seq = 0; this.sent = 0; this.inT = 0; this.acc = 0;
    this.clock = 0; this.srvT = -1; this.srvAt = 0; this.rt = 0; this.rtOn = false; this.offX = 0; this.offY = 0; this.predOn = false; this.spd = 0;
    this.offerKeep = null; this.offerHold = 0;
    this.stats = { snaps: 0, bytes: 0, maxBytes: 0, corrN: 0, corrSum: 0, corrMax: 0, corrBig: 0, snapsTaken: 0 };
    this.evCtx = { me: this.myPid, crowd: 0 };
    this.relEv = (ev) => {
      if (ev.t === 'dash' && ev.pid === this.myPid) return; // predicted locally
      this.evCtx.crowd = (ED.Render && ED.Render.crowd) || 0;
      this.route(ev, this.evCtx);
    };
    if (ED.FX) ED.FX.clear();
    return M;
  };
  S.clientControl = function (inp) {
    const me = this.view && this.view.me, L = this.L;
    if (!me || !this.mir.ready) return;
    const aim = ED.AimFx.point(me, inp);
    L.mx = inp.mx; L.my = inp.my; L.ax = aim.wx; L.ay = aim.wy;
    L.ed |= (inp.dash ? 1 : 0) | (inp.q ? 2 : 0) | (inp.e ? 4 : 0) | (inp.reroll ? 8 : 0) | (inp.skip ? 16 : 0);
    if (inp.pick) this.clientPick(inp.pick);
  };
  // Card n (1..4): sent with the next tick; the strip hides at once (restored if the host has not answered within 1 s).
  S.clientPick = function (n) {
    const me = this.view && this.view.me;
    if (!me || !me.offer || !me.offer[n - 1]) return;
    this.L.pick = n; this.offerKeep = me.offer; me.offer = null; this.offerHold = 1;
  };
  // Host message for this client: ArrayBuffer snapshot, { t: 'offer', cards }, { t: 'end', summary }.
  S.clientData = function (d) {
    if (this.mode !== 'client' || this.ended) return;
    const M = this.mir, st = this.stats;
    if (d instanceof ArrayBuffer) {
      const T = M.apply(d);
      if (T < 0) return;
      st.snaps++; st.bytes += d.byteLength; if (d.byteLength > st.maxBytes) st.maxBytes = d.byteLength;
      if (T > this.srvT) { this.srvT = T; this.srvAt = this.clock; }
      this.reconcile();
      if (M.state !== 'play' && !this.endT) this.endT = this.clock; // the host's 'end' message follows
    } else if (d && d.t === 'offer') { const me = this.view.me; if (me) me.offer = Array.isArray(d.cards) && d.cards.length ? d.cards : null; this.offerHold = 0; this.offerKeep = null; }
    else if (d && d.t === 'end') this.finish(d.summary);
  };
  // Own hero: server state at the acked input, then every newer input replayed; the jump from the shown spot blends out over ~1 / BLEND s (or snaps when large).
  S.reconcile = function () {
    const M = this.mir, s = M.srv, P = this.P;
    this.spd = s.spd;
    if (!s.live) { this.copySrv(s); this.predOn = false; this.offX = this.offY = 0; return; }
    const bx = P.x + this.offX, by = P.y + this.offY, px = P.x, py = P.y, ack = M.ack;
    this.copySrv(s);
    if (!this.predOn) { this.predOn = true; this.offX = this.offY = 0; return; }
    if (ack <= this.seq && this.seq - ack < HIST - 1) for (let q = ack + 1; q <= this.seq; q++) this.step(this.hist[q & HM], false);
    const err = Math.hypot(P.x - px, P.y - py), st = this.stats;
    st.corrN++; st.corrSum += err; if (err > st.corrMax) st.corrMax = err; if (err > 2) st.corrBig++;
    this.offX = bx - P.x; this.offY = by - P.y;
    if (Math.hypot(this.offX, this.offY) > SNAP_PX) { this.offX = this.offY = 0; st.snapsTaken++; }
  };
  S.copySrv = function (s) { const P = this.P; P.x = s.x; P.y = s.y; P.dashT = s.dashT; P.dashCd = s.dashCd; P.dashDx = s.dashDx; P.dashDy = s.dashDy; P.mdir = s.mdir; P.mvx = s.mvx; P.mvy = s.mvy; P.moving = s.moving; };
  // One predicted tick of the own hero (World.updateHeroes movement and dash, same arithmetic); live: a real tick (emits the dash locally), else a replay.
  S.step = function (f, live) {
    const P = this.P, D = C.DASH, A = this.view.props, dt = STEP;
    P.dashCd -= dt;
    if ((f.ed & 1) && P.dashCd <= 0 && P.dashT <= 0) {
      const l = Math.hypot(f.mx, f.my);
      if (l > 0.1) { P.dashDx = f.mx / l; P.dashDy = f.my / l; } else { const a = Math.atan2(f.ay - P.y, f.ax - P.x); P.dashDx = Math.cos(a); P.dashDy = Math.sin(a); }
      P.dashT = D.t; P.dashCd = D.cd;
      if (live) this.route({ t: 'dash', pid: this.myPid, x: Math.round(P.x), y: Math.round(P.y), a: Math.atan2(P.dashDy, P.dashDx) }, this.evCtx);
    }
    if (P.dashT > 0) {
      const st = Math.min(dt, P.dashT), v = D.dist / D.t;
      ED.Arena.move(A, P, P.dashDx * v * st, P.dashDy * v * st, C.HERO_R);
      P.dashT -= dt; P.moving = true;
    } else {
      const sp = this.spd;
      P.moving = Math.abs(f.mx) + Math.abs(f.my) > 0.05;
      if (P.moving) { ED.Arena.move(A, P, f.mx * sp * dt, f.my * sp * dt, C.HERO_R); P.mdir = Math.atan2(f.my, f.mx); P.mvx = f.mx; P.mvy = f.my; }
    }
  };
  // One local tick: the latched input becomes frame seq (quantized exactly as the host will read it) and moves the predicted hero.
  S.localTick = function () {
    const L = this.L, f = this.hist[(++this.seq) & HM];
    f.seq = this.seq;
    f.qx = U.clamp(Math.round(L.mx * 127), -127, 127); f.qy = U.clamp(Math.round(L.my * 127), -127, 127);
    const mx = f.qx / 127, my = f.qy / 127, l = Math.hypot(mx, my);
    f.mx = l > 1 ? mx / l : mx; f.my = l > 1 ? my / l : my;
    f.ax = U.clamp(Math.round(L.ax * 2), -32768, 32767) / 2; f.ay = U.clamp(Math.round(L.ay * 2), -32768, 32767) / 2;
    f.ed = (L.ed & 31) | ((L.pick & 7) << 5); L.ed = 0; L.pick = 0;
    if (this.predOn) this.step(f, true);
  };
  S.clientUpdate = function (dt) {
    const M = this.mir, v = this.view; if (!M || this.ended) return 0;
    this.clock += dt;
    if (this.srvT < 0) return 0; // nothing from the host yet
    let n = 0;
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS);
    while (this.acc >= STEP) { this.acc -= STEP; this.localTick(); n++; }
    this.inT += dt;
    if (this.inT >= IN_DT && this.seq > this.sent && this.net) {
      this.inT = Math.min(this.inT - IN_DT, IN_DT);
      const R = ED.Render, from = Math.max(this.sent + 1, this.seq - 63);
      this.net.send(ED.Net.encodeInput(this.hist, HM, from, this.seq, R && R.bw ? R.bw : C.VIEW_W, R && R.bh ? R.bh : C.VIEW_H));
      this.sent = this.seq;
    }
    // render clock: follows the newest snapshot time minus INTERP, smoothed against arrival jitter
    const target = this.srvT + (this.clock - this.srvAt) - INTERP;
    if (!this.rtOn) { this.rt = target; this.rtOn = true; }
    else { this.rt += dt; const e = target - this.rt; if (Math.abs(e) > 0.25) this.rt = target; else this.rt += e * Math.min(1, dt * 4); }
    if (this.rt > this.srvT + 0.1) this.rt = this.srvT + 0.1;
    M.frame(this.rt);
    M.release(this.rt, this.relEv);
    // own hero
    const me = v.me, P = this.P;
    if (me) {
      const k = Math.exp(-BLEND * dt); this.offX *= k; this.offY *= k;
      if (!this.predOn) this.copySrv(M.srv);
      me.x = P.x + this.offX; me.y = P.y + this.offY;
      me.moving = P.moving; me.mdir = P.mdir; me.mvx = P.mvx; me.mvy = P.mvy; me.dashT = P.dashT; me.dashCd = Math.max(0, P.dashCd); me.dashDx = P.dashDx; me.dashDy = P.dashDy;
      me.face = Math.atan2(this.L.ay - me.y, this.L.ax - me.x);
      for (const sk of me.skills) if (sk.cd > 0) sk.cd = Math.max(0, sk.cd - dt);
      if (this.offerHold > 0 && (this.offerHold -= dt) <= 0 && !me.offer) me.offer = this.offerKeep;
    }
    // the host's run ended but its summary never came (connection dropped right after): end on local numbers
    if (this.endT && this.clock - this.endT > 3) this.netLost('The run ended.');
    return n;
  };
  S.finish = function (sum) {
    if (this.ended) return;
    this.ended = true;
    if (this.onEnd) this.onEnd(sum);
  };
  // The host is gone (or this client left): the run ends with the last known numbers; sum.note says why.
  S.netLost = function (msg) {
    if (this.mode !== 'client' || this.ended) return;
    const v = this.view, M = this.mir;
    this.finish({
      won: M ? M.state === 'won' : false, time: v.time, kills: v.kills, level: v.level, gold: v.gold, stage: v.stage, note: msg || '',
      perHero: (M ? M.heroes : []).map(h => ({ pid: h.pid, cls: h.cls, name: h.name, kills: h.kills | 0, dealt: {}, weapons: h.weapons.map(ws => ws.id) })),
    });
  };
  // Net numbers for a HUD or checks: { mode, rtt (client: s, input sent -> acked state shown), snapBytes, ... }.
  S.netStats = function () {
    if (this.mode === 'client') return Object.assign({ mode: 'client', delay: this.srvT >= 0 ? this.srvT + (this.clock - this.srvAt) - this.rt : 0, lastBytes: this.mir ? this.mir.bytes : 0 }, this.stats);
    if (this.mode === 'host' && this.rem) { const out = { mode: 'host', clients: [] }; for (const rc of this.rem.values()) out.clients.push({ pid: rc.pid, bytes: rc.bytes, queued: rc.q.length, ack: rc.ack }); return out; }
    return { mode: this.mode };
  };

  // Event -> audio (ED.Audio.event aggregates per frame; ED.Audio.flush plays once per frame).
  function sound(ev, myPid) { const a = ED.Audio; if (a && a.event) a.event(ev, myPid); }

  ED.Game = new Session();
  ED.Game.Session = Session;
})(globalThis.ED || (globalThis.ED = {}));
