// Multiplayer without a server of our own: the host's browser runs the authoritative simulation and peers
// connect over WebRTC data channels (PeerJS public broker for the handshake, STUN/TURN for NAT traversal).
// A BroadcastChannel transport (?net=local) lets two tabs of one browser play together offline.
(function (ED) {
  'use strict';
  const U = ED.U;
  const N = ED.Net = {};
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PREFIX = 'wickdeep-v1-';
  N.VERSION = 4; // bump whenever snapshots or floor generation change: mixed versions would desync
  // Heartbeat: PeerJS 'close' does not fire when a tab crashes or a network drops, so both ends ping and
  // treat a few seconds of silence as a disconnect (longer in the lobby, where little else is sent).
  const PING_MS = 2000, TIMEOUT_RUN = 6000, TIMEOUT_LOBBY = 10000;

  N.makeCode = () => { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; };
  N.cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  N.mode = () => { try { return new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'peer'; } catch (e) { return 'peer'; } };
  N.available = () => N.mode() === 'local' ? typeof BroadcastChannel !== 'undefined' : typeof window.Peer === 'function';

  // ---------------- transports ----------------
  function wrapPeerConn(conn) {
    const w = { id: conn.peer, _data: [], _close: [] };
    w.send = (o) => { try { if (conn.open) conn.send(o); } catch (e) { /* channel closed */ } };
    w.onData = (f) => w._data.push(f);
    w.onClose = (f) => w._close.push(f);
    w.close = () => { try { conn.close(); } catch (e) { /* ignore */ } };
    conn.on('data', (d) => { for (const f of w._data) f(d); });
    const fire = () => { if (w.closed) return; w.closed = true; for (const f of w._close) f(); };
    conn.on('close', fire); conn.on('error', fire);
    return w;
  }

  const PeerT = {
    host(code, h) {
      const peer = new window.Peer(PREFIX + code, { debug: 0 });
      peer.on('open', () => h.open && h.open(code));
      peer.on('connection', (conn) => { conn.on('open', () => h.conn(wrapPeerConn(conn))); });
      peer.on('error', (err) => h.error && h.error(err));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
      return { close: () => { try { peer.destroy(); } catch (e) { /* ignore */ } } };
    },
    join(code, h) {
      const peer = new window.Peer({ debug: 0 });
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; h.error && h.error({ type: 'timeout' }); } }, 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => { if (done) return; done = true; clearTimeout(timer); h.open(wrapPeerConn(conn)); });
        conn.on('error', () => { if (!done) { done = true; clearTimeout(timer); h.error && h.error({ type: 'peer-unavailable' }); } });
      });
      peer.on('error', (err) => { if (!done) { done = true; clearTimeout(timer); h.error && h.error(err); } });
      return { close: () => { try { peer.destroy(); } catch (e) { /* ignore */ } } };
    },
  };

  // Posting to a closed BroadcastChannel throws; every send here is fire-and-forget.
  const post = (ch, m) => { try { ch.postMessage(m); } catch (e) { /* channel already closed */ } };
  const LocalT = {
    host(code, h) {
      const ch = new BroadcastChannel('wickdeep-local-' + code);
      const conns = {};
      ch.onmessage = (m) => {
        const d = m.data;
        if (d.to !== 'host') return;
        if (d.type === 'join') {
          const w = { id: d.from, _data: [], _close: [] };
          w.send = (o) => post(ch, { type: 'msg', to: d.from, data: o });
          w.onData = (f) => w._data.push(f); w.onClose = (f) => w._close.push(f);
          w.close = () => { if (w.closed) return; w.closed = true; post(ch, { type: 'bye', to: d.from }); delete conns[d.from]; for (const f of w._close) f(); };
          conns[d.from] = w;
          post(ch, { type: 'accept', to: d.from });
          h.conn(w);
        } else if (d.type === 'msg' && conns[d.from]) { for (const f of conns[d.from]._data) f(d.data); }
        else if (d.type === 'bye' && conns[d.from]) { const w = conns[d.from]; delete conns[d.from]; w.closed = true; for (const f of w._close) f(); }
      };
      post(ch, { type: 'probe', to: 'none' });
      setTimeout(() => h.open && h.open(code), 50);
      window.addEventListener('beforeunload', () => { for (const id in conns) post(ch, { type: 'bye', to: id }); });
      return { close: () => { for (const id in conns) post(ch, { type: 'bye', to: id }); ch.close(); } };
    },
    join(code, h) {
      const ch = new BroadcastChannel('wickdeep-local-' + code);
      const me = 'L' + Math.random().toString(36).slice(2, 9);
      const w = { id: 'host', _data: [], _close: [] };
      let ok = false;
      w.send = (o) => { if (!w.closed) post(ch, { type: 'msg', to: 'host', from: me, data: o }); };
      w.onData = (f) => w._data.push(f); w.onClose = (f) => w._close.push(f);
      w.close = () => { if (w.closed) return; w.closed = true; post(ch, { type: 'bye', to: 'host', from: me }); ch.close(); };
      ch.onmessage = (m) => {
        const d = m.data;
        if (d.to !== me) return;
        if (d.type === 'accept') { ok = true; h.open(w); }
        else if (d.type === 'msg') { for (const f of w._data) f(d.data); }
        else if (d.type === 'bye') { for (const f of w._close) f(); }
      };
      post(ch, { type: 'join', to: 'host', from: me });
      setTimeout(() => { if (!ok) h.error && h.error({ type: 'peer-unavailable' }); }, 3000);
      window.addEventListener('beforeunload', () => { if (!w.closed) post(ch, { type: 'bye', to: 'host', from: me }); });
      return { close: () => w.close() };
    },
  };
  const transport = () => (N.mode() === 'local' ? LocalT : PeerT);

  N.errorText = (err) => {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'No party with that code is open. Check the code with your host.';
    if (t === 'timeout') return 'Could not reach that party. Your network may be blocking peer connections; try another network.';
    if (t === 'unavailable-id') return 'That party code is taken. Try hosting again.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the matchmaking broker. Check your internet connection.';
    if (t === 'browser-incompatible') return 'This browser does not support peer connections.';
    return 'Connection failed' + (t ? ' (' + t + ')' : '') + '.';
  };

  // A guest's hero choice, made safe for the host's simulation: a malformed message must never break everyone's run.
  const cleanPick = (d) => {
    const cls = ED.CLASS_IDS.indexOf(d.cls) >= 0 ? d.cls : ED.CLASS_IDS[0];
    const list = ED.CLASSES[cls].weapons, weapon = list.indexOf(d.weapon) >= 0 ? d.weapon : list[0];
    const m = d.meta && typeof d.meta === 'object' ? d.meta : {};
    const up = ED.UPGRADES.map((u, i) => U.clamp((Array.isArray(m.up) ? m.up[i] : 0) | 0, 0, u.costs.length));
    const relics = Array.isArray(m.relics) ? m.relics.filter(id => ED.RELIC_IDS.indexOf(id) >= 0) : [];
    return { cls, weapon, meta: { up, mastery: U.clamp(m.mastery | 0, 1, 10), relics } };
  };

  // ---------------- host session ----------------
  N.Host = function (me, handlers) {
    this.code = N.makeCode();
    this.handlers = handlers;
    this.conns = new Map();
    this.members = [Object.assign({ pid: 'host', slot: 0, ready: true, isHost: true }, me)];
    this.pact = 0; this.pactMax = me.pactMax || 0;
    this.started = false;
    this.attempts = 0;
    this.listen();
    this.hbPrev = this.pingT = performance.now();
    this.hb = setInterval(() => this.heartbeat(), 1000);
  };
  N.Host.prototype.listen = function () {
    this.t = transport().host(this.code, {
      open: () => this.handlers.status && this.handlers.status('open'),
      conn: (c) => this.onConn(c),
      error: (err) => {
        if (err && err.type === 'unavailable-id' && this.attempts++ < 4) { this.t.close(); this.code = N.makeCode(); this.listen(); this.handlers.code && this.handlers.code(this.code); return; }
        this.handlers.status && this.handlers.status('error', N.errorText(err));
      },
    });
  };
  N.Host.prototype.onConn = function (c) {
    let joined = false;
    c.lastSeen = performance.now();
    setTimeout(() => { if (!joined) c.close(); }, TIMEOUT_LOBBY); // never said hello
    c.onData((d) => {
      c.lastSeen = performance.now();
      if (!d || typeof d !== 'object') return;
      if (!joined) {
        if (d.t !== 'hello') return;
        if (d.ver !== N.VERSION) { c.send({ t: 'reject', reason: 'Your game version differs from the host. Refresh the page.' }); setTimeout(() => c.close(), 300); return; }
        if (this.started) { c.send({ t: 'reject', reason: 'That descent has already begun.' }); setTimeout(() => c.close(), 300); return; }
        if (this.members.length >= ED.CONST.MAX_PLAYERS) { c.send({ t: 'reject', reason: 'That party is full (4 heroes).' }); setTimeout(() => c.close(), 300); return; }
        joined = true;
        const used = new Set(this.members.map(m => m.slot));
        let slot = 0; while (used.has(slot)) slot++;
        const pid = 'p' + Math.random().toString(36).slice(2, 8);
        c.pid = pid;
        this.conns.set(pid, c);
        const pk = cleanPick(d);
        this.members.push({ pid, slot, name: ED.Save.sanitizeName(d.name), cls: pk.cls, weapon: pk.weapon, meta: pk.meta, ready: false, isHost: false, pactMax: d.pactMax | 0 });
        c.send({ t: 'welcome', pid, slot, code: this.code });
        this.broadcastLobby();
        this.handlers.joined && this.handlers.joined(pid);
        return;
      }
      this.onData(c.pid, d);
    });
    c.onClose(() => this.drop(c));
  };
  // Removes a member whose connection closed or went silent. Safe to call more than once.
  N.Host.prototype.drop = function (c) {
    if (this.closed || !c.pid || this.conns.get(c.pid) !== c) return;
    this.conns.delete(c.pid);
    const m = this.members.find(x => x.pid === c.pid);
    this.members = this.members.filter(x => x.pid !== c.pid);
    this.broadcastLobby();
    this.handlers.left && this.handlers.left(c.pid, m ? m.name : 'A hero');
  };
  N.Host.prototype.heartbeat = function () {
    const now = performance.now();
    // If this tab itself was asleep, its inbox is stale too: grant a fresh grace period instead of dropping everyone.
    if (now - this.hbPrev > 3000) for (const c of this.conns.values()) c.lastSeen = now;
    this.hbPrev = now;
    const limit = this.started ? TIMEOUT_RUN : TIMEOUT_LOBBY;
    for (const c of [...this.conns.values()]) if (now - c.lastSeen > limit) { c.close(); this.drop(c); }
    if (now - this.pingT >= PING_MS) { this.pingT = now; this.broadcast({ t: 'ping' }); }
  };
  N.Host.prototype.onData = function (pid, d) {
    if (d.t === 'ping') return;
    const m = this.members.find(x => x.pid === pid);
    if (!m) return;
    if (d.t === 'pick' && !this.started) { Object.assign(m, cleanPick(d)); m.ready = false; this.broadcastLobby(); }
    else if (d.t === 'ready' && !this.started) { m.ready = !!d.v; this.broadcastLobby(); }
    else if (this.handlers.data) this.handlers.data(pid, d);
  };
  N.Host.prototype.setMe = function (patch) { Object.assign(this.members[0], patch); this.broadcastLobby(); };
  N.Host.prototype.lobbyState = function () { return { t: 'lobby', code: this.code, pact: this.pact, members: this.members.map(m => ({ pid: m.pid, slot: m.slot, name: m.name, cls: m.cls, weapon: m.weapon, ready: m.ready, isHost: m.isHost })) }; };
  N.Host.prototype.broadcastLobby = function () { const s = this.lobbyState(); this.broadcast(s); this.handlers.lobby && this.handlers.lobby(s); };
  N.Host.prototype.broadcast = function (o) { for (const c of this.conns.values()) c.send(o); };
  N.Host.prototype.sendTo = function (pid, o) { const c = this.conns.get(pid); if (c) c.send(o); };
  N.Host.prototype.allReady = function () { return this.members.every(m => m.ready || m.isHost); };
  N.Host.prototype.close = function () {
    if (this.closed) return;
    this.closed = true; clearInterval(this.hb);
    this.broadcast({ t: 'closed' });
    setTimeout(() => { for (const c of this.conns.values()) c.close(); if (this.t) this.t.close(); }, 200);
  };

  // ---------------- client session ----------------
  N.Client = function (code, me, handlers) {
    this.code = code; this.handlers = handlers; this.me = me; this.pid = null;
    this.running = false; this.ended = false;
    this.t = transport().join(code, {
      open: (c) => {
        if (this.ended) { c.close(); return; }
        this.conn = c;
        this.lastSeen = this.hbPrev = this.pingT = performance.now();
        c.onData((d) => { this.lastSeen = performance.now(); this.onData(d); });
        c.onClose(() => this.lost());
        c.send(Object.assign({ t: 'hello', ver: N.VERSION }, me));
        this.hb = setInterval(() => this.heartbeat(), 1000);
      },
      error: (err) => { if (!this.ended) this.handlers.error && this.handlers.error(N.errorText(err)); },
    });
  };
  N.Client.prototype.onData = function (d) {
    if (!d || typeof d !== 'object' || this.ended || d.t === 'ping') return;
    if (d.t === 'welcome') { this.pid = d.pid; this.slot = d.slot; this.handlers.welcome && this.handlers.welcome(d); }
    else if (d.t === 'reject') { this.handlers.error && this.handlers.error(d.reason); }
    else if (d.t === 'lobby') this.handlers.lobby && this.handlers.lobby(d);
    else if (d.t === 'closed') this.lost('The host closed the party.');
    else {
      if (d.t === 'start') this.running = true; else if (d.t === 'end') this.running = false;
      if (this.handlers.data) this.handlers.data(d);
    }
  };
  N.Client.prototype.heartbeat = function () {
    const now = performance.now();
    if (now - this.hbPrev > 3000) this.lastSeen = now; // this tab was asleep; judge the host on fresh evidence
    this.hbPrev = now;
    if (now - this.lastSeen > (this.running ? TIMEOUT_RUN : TIMEOUT_LOBBY)) { this.lost('Lost connection to the host.'); return; }
    if (now - this.pingT >= PING_MS) { this.pingT = now; this.send({ t: 'ping' }); }
  };
  // The link to the host is gone (closed, timed out or told to leave): report it once and tear down.
  N.Client.prototype.lost = function (msg) {
    if (this.ended) return;
    this.close();
    if (this.handlers.closed) this.handlers.closed(msg);
  };
  N.Client.prototype.send = function (o) { if (this.conn && !this.ended) this.conn.send(o); };
  // Leaving on purpose: no 'closed' callback.
  N.Client.prototype.close = function () {
    if (this.ended) return;
    this.ended = true; clearInterval(this.hb);
    if (this.conn) this.conn.close();
    if (this.t) this.t.close();
  };

  // ---------------- snapshots ----------------
  const ST = ['move', 'windup', 'lunge', 'aim', 'spin', 'charge', 'fuse', 'cast', 'idle', 'atk', 'dash', 'wind', 'slam', 'air', 'roar', 'fade', 'burrow', 'erupt', 'bash', 'leap', 'dive']; // append only: indices are the wire format
  const ST_IDX = U.indexer(ST);
  const ZK = ['spawn', 'tele', 'teleLine', 'teleCone', 'laser', 'poison', 'fire', 'pfire', 'plague', 'sanct', 'pull', 'bomb', 'decoy', 'mire', 'rain', 'meteor', 'smoke'];
  const ZK_IDX = U.indexer(ZK);
  const PK = ['gold', 'xp', 'heart', 'orb'];
  const PK_IDX = U.indexer(PK);
  N.ST = ST; N.ZK = ZK; N.PK = PK;
  const r = Math.round, r2 = (v) => Math.round(v * 100) / 100;

  N.encodeSnap = (w, fx, full) => {
    const P = [], E = [], B = [], K = [], Z = [], A = [];
    for (const p of w.players.values()) {
      const fl = (p.moving ? 1 : 0) | (p.dashing ? 2 : 0) | (p.downed ? 4 : 0) | (p.dead ? 8 : 0) | (p.invuln > 0 ? 16 : 0) | (p.hurtT > 0 ? 32 : 0) | (p.bulwarkT > 0 ? 64 : 0) | (p.stealthT > 0 ? 128 : 0) | (p.ambush ? 256 : 0);
      P.push([p.pid, r(p.x), r(p.y), r2(p.face), Math.ceil(p.hp), p.maxHp, fl, r2(p.revive), p.critStacks | 0, p.aegisT > 0 ? 1 : 0, p.guardT > 0 ? 1 : 0, p.secondWind | 0, p.phoenixUsed ? 1 : 0, p.picks | 0, p.rerolls | 0, Math.ceil(p.shield || 0)]);
    }
    for (const e of w.enemies) {
      if (e.hp <= 0) continue;
      const fl = (e.flash > 0 ? 1 : 0) | (e.frozen > 0 ? 2 : 0) | (e.stun > 0 ? 4 : 0) | (e.burn > 0 ? 8 : 0) | (e.chill > 0 ? 16 : 0) | (e.exposed ? 32 : 0) | (e.charge > 0 ? 64 : 0) | (e.bleedPool > 0 ? 128 : 0) | (e.judged > 0 ? 256 : 0) | (e.blind > 0 ? 512 : 0);
      E.push([e.id, ED.ENEMY_IDX[e.type], r(e.x), r(e.y), Math.ceil(e.hp), r(e.maxHp), e.r, fl, ST_IDX[e.boss ? (e.pose || 'idle') : e.st] | 0, r2(e.aimA || 0), e.elite ? ED.AFFIX_IDS.indexOf(e.elite) : -1, r(e.ward || 0), r(e.wardMax || 0), e.phase | 0, e.face < 0 ? -1 : 1, r2(e.t || 0), r(e.chill || 0)]);
    }
    for (const pr of w.projs) B.push([pr.id, ED.PROJ_IDX[pr.kind] | 0, r(pr.x), r(pr.y), r(pr.vx), r(pr.vy), pr.r, pr.team]);
    for (const pk of w.pickups) K.push([pk.id, PK_IDX[pk.kind], r(pk.x), r(pk.y)]);
    for (const z of w.zones) Z.push([z.id, ZK_IDX[z.kind] | 0, r(z.x), r(z.y), r(z.r || 0), r2(z.t), r2(z.dur), r2(z.a || 0), r(z.len || 0), r(z.w || 0), r2(z.arc || 0), z.team | 0, z.elite ? 1 : 0, z.lob ? z.lob[0] : -99999, z.lob ? z.lob[1] : 0, r2(z.warm || 0), r(z.str || 0)]);
    for (const a of w.allies) A.push([a.id, a.owner, r(a.x), r(a.y), a.face]);
    const s = { t: 's', T: r2(w.time), s: w.stratum, fs: w.floorSeed, r: w.roomId, ep: w.roomEpoch | 0, L: w.locked ? 1 : 0, g: w.gold, x: Math.floor(w.xp), n: w.xpNext, l: w.level, li: Math.round(w.light * 10) / 10, lm: r(w.lightMax), dr: w.dread.tier | 0,
      wm: w.waitMsg || '', P, E, B, K, Z, A, F: fx };
    if (full) {
      s.O = w.props.map(p => [p.id, p.kind, r(p.x), r(p.y), p.state | 0, p.item || '', p.price || 0, p.group || 0, p.stype || '', p.text || '']);
      s.RS = w.floor.rooms.map(rm => { const st = w.roomState[rm.id]; return (st.visited ? 1 : 0) | (st.known ? 2 : 0) | (st.cleared ? 4 : 0); });
      s.RUN = { kills: w.run.kills, roomsCleared: w.run.roomsCleared, elitesKilled: w.run.elitesKilled, bosses: w.run.bosses, bossCount: w.run.bossCount, embers: w.run.embers, revives: w.run.revives, maxGold: w.run.maxGold, maxRelics: w.run.maxRelics, pact: w.pact,
        flawlessBoss: !!w.run.flawlessBoss, roomsVisited: w.run.roomsVisited, roomsTotal: w.run.roomsTotal, lightAtBoss: w.run.lightAtBoss.slice(), lightlessBoss: !!w.run.lightlessBoss, fullClear: !!w.run.fullClear, evolved: [...w.players.values()].some(p => !!p.evo) };
    }
    return s;
  };

  // Signature used by the host to decide when props / room state must be resent.
  N.propSig = (w) => w.roomId + '|' + w.props.map(p => p.id + ':' + (p.state | 0)).join(',') + '|' + w.floor.rooms.map(rm => { const st = w.roomState[rm.id]; return (st.visited ? 1 : 0) + (st.known ? 2 : 0) + (st.cleared ? 4 : 0); }).join('');
})(globalThis.ED || (globalThis.ED = {}));
