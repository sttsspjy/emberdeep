// Multiplayer without a server of our own: the host's browser runs the authoritative World and peers connect over WebRTC data channels
// (PeerJS public broker for the handshake). A BroadcastChannel transport (?net=local) lets two tabs of one browser play together offline.
// Parts: transports (raw PeerJS channel: strings carry JSON control messages, ArrayBuffers carry binary snapshots / inputs), lobby sessions (N.Host / N.Client, heartbeat),
// binary snapshots (N.encodeSnap: interest-culled, quantized; N.Mirror: client-side decode + interpolation), binary input packets, and N.Party (lobby flow API; ED.Net.host / join / ... use the default one).
(function (ED) {
  'use strict';
  const U = ED.U, C = ED.CONST, TAU = U.TAU;
  const N = ED.Net = {};
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PREFIX = 'wickdeep-sv-';
  N.VERSION = ED.NET_VERSION = 7; // bump on any wire change: mixed versions would desync
  // Heartbeat: PeerJS 'close' does not fire when a tab crashes or a network drops, so both ends ping and
  // treat a few seconds of silence as a disconnect (longer in the lobby, where little else is sent).
  const PING_MS = 2000, TIMEOUT_RUN = 6000, TIMEOUT_LOBBY = 10000;
  const BUSY_BYTES = 65536; // a channel with more than this queued skips snapshots (a stale snapshot is worthless)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  N.makeCode = () => { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; };
  N.cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  N.mode = () => { try { return new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'peer'; } catch (e) { return 'peer'; } };
  N.available = () => (N.mode() === 'local' ? typeof BroadcastChannel !== 'undefined' : typeof window !== 'undefined' && typeof window.Peer === 'function');

  // ---------------- transports ----------------
  // A wrapped connection: { id, send(o) (ArrayBuffer as is, anything else as JSON), onData(f), onClose(f), close(), busy() }.
  function wrapPeerConn(conn) {
    const w = { id: conn.peer, _data: [], _close: [] };
    w.send = (o) => { try { if (conn.open) conn.send(o instanceof ArrayBuffer ? o : JSON.stringify(o)); } catch (e) { /* channel closed */ } };
    w.busy = () => { const dc = conn.dataChannel; return (conn.bufferSize | 0) > 0 || !!(dc && dc.bufferedAmount > BUSY_BYTES); };
    w.onData = (f) => w._data.push(f);
    w.onClose = (f) => w._close.push(f);
    w.close = () => { try { conn.close(); } catch (e) { /* ignore */ } };
    conn.on('data', (raw) => {
      let d = raw;
      if (typeof raw === 'string') { try { d = JSON.parse(raw); } catch (e) { return; } }
      else if (ArrayBuffer.isView(raw)) d = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      for (const f of w._data) f(d);
    });
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
        // raw: no BinaryPack / JSON framing by PeerJS (its JSON mode caps messages at 16 KB); wrapPeerConn frames strings as JSON itself.
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
        conn.on('open', () => { if (done) return; done = true; clearTimeout(timer); h.open(wrapPeerConn(conn)); });
        conn.on('error', () => { if (!done) { done = true; clearTimeout(timer); h.error && h.error({ type: 'peer-unavailable' }); } });
      });
      peer.on('error', (err) => { if (!done) { done = true; clearTimeout(timer); h.error && h.error(err); } });
      return { close: () => { try { peer.destroy(); } catch (e) { /* ignore */ } } };
    },
  };

  // Posting to a closed BroadcastChannel throws; every send here is fire-and-forget (structured clone carries objects and ArrayBuffers).
  const post = (ch, m) => { try { ch.postMessage(m); } catch (e) { /* channel already closed */ } };
  const notBusy = () => false;
  const LocalT = {
    host(code, h) {
      const ch = new BroadcastChannel('wickdeep-local-' + code);
      const conns = {};
      ch.onmessage = (m) => {
        const d = m.data;
        if (d.to !== 'host') return;
        if (d.type === 'join') {
          const w = { id: d.from, _data: [], _close: [], busy: notBusy };
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
      const w = { id: 'host', _data: [], _close: [], busy: notBusy };
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
  let forced = null;
  // Test hook: every new session uses transport T ({ host(code, h), join(code, h) }) instead of PeerJS / BroadcastChannel; null restores the default.
  N.useTransport = (T) => { forced = T; };
  const transport = () => forced || (N.mode() === 'local' ? LocalT : PeerT);

  N.errorText = (err) => {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'No party with that code is open. Check the code with your host.';
    if (t === 'timeout') return 'Could not reach that party. Your network may be blocking peer connections; try another network.';
    if (t === 'unavailable-id') return 'That party code is taken. Try hosting again.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the matchmaking broker. Check your internet connection.';
    if (t === 'browser-incompatible') return 'This browser does not support peer connections.';
    return 'Connection failed' + (t ? ' (' + t + ')' : '') + '.';
  };

  // A guest's hero choice, made safe for the host's simulation: { cls, meta: { shop, sigs } } with unknown ids dropped and ranks clamped.
  const cleanPick = (d) => {
    const cls = ED.HERO_IDS.indexOf(d.cls) >= 0 ? d.cls : ED.HERO_IDS[0];
    const m = d.meta && typeof d.meta === 'object' ? d.meta : {}, shop = {};
    for (const s of ED.SHOP) { const r = m.shop ? Math.floor(+m.shop[s.id] || 0) : 0; if (r > 0) shop[s.id] = U.clamp(r, 0, s.max); }
    const sigs = Array.isArray(m.sigs) ? m.sigs.filter((c, i, a) => ED.HERO_IDS.indexOf(c) >= 0 && a.indexOf(c) === i) : [];
    return { cls, meta: { shop, sigs } };
  };
  N.cleanPick = cleanPick;

  // ---------------- host session ----------------
  N.Host = function (me, handlers) {
    this.code = N.makeCode();
    this.handlers = handlers;
    this.conns = new Map();
    this.members = [Object.assign({ pid: 'host', slot: 0, ready: true, isHost: true }, me)];
    this.stage = 0;
    this.started = false;
    this.attempts = 0;
    this.listen();
    this.hbPrev = this.pingT = now();
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
    c.lastSeen = now();
    setTimeout(() => { if (!joined) c.close(); }, TIMEOUT_LOBBY); // never said hello
    c.onData((d) => {
      c.lastSeen = now();
      if (!d || typeof d !== 'object') return;
      if (!joined) {
        if (d.t !== 'hello') return;
        if (d.ver !== N.VERSION) { c.send({ t: 'reject', reason: 'Your game version differs from the host. Refresh the page.' }); setTimeout(() => c.close(), 300); return; }
        if (this.started) { c.send({ t: 'reject', reason: 'That run has already started.' }); setTimeout(() => c.close(), 300); return; }
        if (this.members.length >= C.MAX_PLAYERS) { c.send({ t: 'reject', reason: 'That party is full (4 heroes).' }); setTimeout(() => c.close(), 300); return; }
        joined = true;
        const used = new Set(this.members.map(m => m.slot));
        let slot = 0; while (used.has(slot)) slot++;
        const pid = 'p' + Math.random().toString(36).slice(2, 8);
        c.pid = pid;
        this.conns.set(pid, c);
        const pk = cleanPick(d);
        this.members.push({ pid, slot, name: ED.Save.sanitizeName(d.name), cls: pk.cls, meta: pk.meta, ready: false, isHost: false });
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
    const t = now();
    // If this tab itself was asleep, its inbox is stale too: grant a fresh grace period instead of dropping everyone.
    if (t - this.hbPrev > 3000) for (const c of this.conns.values()) c.lastSeen = t;
    this.hbPrev = t;
    const limit = this.started ? TIMEOUT_RUN : TIMEOUT_LOBBY;
    for (const c of [...this.conns.values()]) if (t - c.lastSeen > limit) { c.close(); this.drop(c); }
    if (t - this.pingT >= PING_MS) { this.pingT = t; this.broadcast({ t: 'ping' }); }
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
  N.Host.prototype.setStage = function (i) { this.stage = U.clamp(i | 0, 0, ED.STAGES.length - 1); this.broadcastLobby(); };
  N.Host.prototype.lobbyState = function () { return { t: 'lobby', code: this.code, stage: this.stage, started: this.started, members: this.members.map(m => ({ pid: m.pid, slot: m.slot, name: m.name, cls: m.cls, ready: m.ready, isHost: m.isHost })) }; };
  N.Host.prototype.broadcastLobby = function () { const s = this.lobbyState(); this.broadcast(s); this.handlers.lobby && this.handlers.lobby(s); };
  N.Host.prototype.broadcast = function (o) { for (const c of this.conns.values()) c.send(o); };
  N.Host.prototype.sendTo = function (pid, o) { const c = this.conns.get(pid); if (c) c.send(o); };
  N.Host.prototype.busy = function (pid) { const c = this.conns.get(pid); return !c || !!(c.busy && c.busy()); };
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
        this.lastSeen = this.hbPrev = this.pingT = now();
        c.onData((d) => { this.lastSeen = now(); this.onData(d); });
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
    const t = now();
    if (t - this.hbPrev > 3000) this.lastSeen = t; // this tab was asleep; judge the host on fresh evidence
    this.hbPrev = t;
    if (t - this.lastSeen > (this.running ? TIMEOUT_RUN : TIMEOUT_LOBBY)) { this.lost('Lost connection to the host.'); return; }
    if (t - this.pingT >= PING_MS) { this.pingT = t; this.send({ t: 'ping' }); }
  };
  // The link to the host is gone (closed, timed out or told to leave): report it once and tear down.
  N.Client.prototype.lost = function (msg) {
    if (this.ended) return;
    this.close();
    if (this.handlers.closed) this.handlers.closed(msg || 'Lost connection to the host.');
  };
  N.Client.prototype.send = function (o) { if (this.conn && !this.ended) this.conn.send(o); };
  // Leaving on purpose: no 'closed' callback.
  N.Client.prototype.close = function () {
    if (this.ended) return;
    this.ended = true; clearInterval(this.hb);
    if (this.conn) this.conn.close();
    if (this.t) this.t.close();
  };

  // ---------------- binary wire ----------------
  // One shared scratch buffer for encoding (single-threaded); a finished message is sliced out of it. Varints are 7 bits per byte, little end first.
  const SNAP = 1, INPUT = 2;
  const CAP = 1 << 16, LIMIT = CAP - 2048; // entity sections stop at LIMIT bytes (never reached at 900 foes)
  const wb = new ArrayBuffer(CAP), wd = new DataView(wb), wu = new Uint8Array(wb);
  let o = 0;
  const w8 = (v) => { wu[o++] = v & 255; };
  const w16 = (v) => { wd.setUint16(o, v & 0xffff, true); o += 2; };
  const wi16 = (v) => { wd.setInt16(o, U.clamp(Math.round(v), -32768, 32767), true); o += 2; };
  const w32 = (v) => { wd.setUint32(o, v >>> 0, true); o += 4; };
  const wf32 = (v) => { wd.setFloat32(o, v, true); o += 4; };
  const wv = (v) => { v = v > 0 ? Math.min(0xffffffff, Math.floor(v)) : 0; while (v >= 128) { wu[o++] = (v & 127) | 128; v = Math.floor(v / 128); } wu[o++] = v; };
  // String from a table: index + 1, or 0 then up to 255 latin-1 bytes for a string the table lacks.
  const wstr = (map, s) => {
    s = s == null ? '' : String(s);
    const i = map[s];
    if (i !== undefined) { wv(i + 1); return; }
    wv(0); const n = Math.min(255, s.length); w8(n); for (let k = 0; k < n; k++) wu[o++] = s.charCodeAt(k) & 255;
  };
  const qa8 = (a) => Math.round((a || 0) * 256 / TAU) & 255;
  const qa16 = (a) => Math.round((a || 0) * 65536 / TAU) & 0xffff;
  const ms16 = (s) => U.clamp(Math.round((s || 0) * 1000), 0, 65535);
  const NOPR = [0, 0, 0];
  const q8 = (v, k) => U.clamp(Math.round(v * k), 0, 255);
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null, dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  let rv8, ro = 0, rdv = null;
  const r8 = () => rv8[ro++];
  const r16 = () => { const v = rdv.getUint16(ro, true); ro += 2; return v; };
  const ri16 = () => { const v = rdv.getInt16(ro, true); ro += 2; return v; };
  const r32 = () => { const v = rdv.getUint32(ro, true); ro += 4; return v; };
  const rf32 = () => { const v = rdv.getFloat32(ro, true); ro += 4; return v; };
  const rv = () => { let v = 0, m = 1, b; do { b = rv8[ro++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
  const rstr = (arr) => { const i = rv(); if (i) return arr[i - 1] || ''; const n = r8(); let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(rv8[ro++]); return s; };
  const da8 = (v) => v * TAU / 256;
  const da16 = (v) => v * TAU / 65536;
  const reader = (buf) => { rv8 = new Uint8Array(buf); rdv = new DataView(buf); ro = 0; };

  // Wire string tables (built on first use, after every script registered its ids; identical on every peer because script order is fixed).
  const PICK_KINDS = ['xp1', 'xp5', 'xp25', 'gold', 'food', 'magnet', 'bomb', 'chest'];
  let TB = null;
  const tables = () => {
    if (TB) return TB;
    const W = [''].concat(ED.WEAPON_IDS, Object.keys(ED.SKILLS || {})), S = Object.keys(ED.SKILLS || {});
    TB = { W, Wm: U.indexer(W), S, Sm: U.indexer(S), P: ED.PASSIVE_IDS, Pm: U.indexer(ED.PASSIVE_IDS), K: PICK_KINDS, Km: U.indexer(PICK_KINDS), L: ED.LOOKS, Lm: ED.LOOK_IDX };
    return TB;
  };

  // ---------------- snapshot encode (host) ----------------
  // Layout: u8 SNAP, u32 seq, u32 tick, u32 ack (last input seq applied for this client), f32 xp, f32 xpNext, u16 level, u32 kills, u32 gold, u8 state (0 play, 1 won, 2 lost),
  // i16 ox, oy (cull rect origin), boss (varint id + 1 or 0; varint k, u8 hpQ, u8 flags), boss bar (u8 flags 1 on 2 final 4 enraged; if on: varint foe index, u8 q, u8 phase, u8 n, u8 rev (255 none)), braziers (u8 n + broken bitmask), u8 heroes + records,
  // then u16-counted sections: zones (+ u16-counted ids of zones gone), foes, projectiles, pickups, hits, deaths, misc binary events, JSON events.
  // Foes / projectiles / pickups / positional events are kept only inside the client's view + MARGIN; their positions are 3 bytes (12 + 12 bits at 0.5 px from the rect origin).
  // Ids: arrays are in spawn order, so ids ascend: each id is written as delta from the previous (with 2 flag bits); a delta of 0 escapes to an absolute id.
  const MARGIN = 160;
  const HIT_CAP = 100, DIE_CAP = 120, MISC_CAP = 80, PICK_CAP = 24, JSON_CAP = 48, CARRY_CAP = 64;
  N.MARGIN = MARGIN;
  let ox = 0, oy = 0, RW = 0, RH = 0;
  const inR = (x, y) => x >= ox && y >= oy && x < ox + RW && y < oy + RH;
  const circR = (x, y, r) => x + r >= ox && y + r >= oy && x - r < ox + RW && y - r < oy + RH;
  const wpos = (x, y) => {
    const qx = U.clamp(Math.round((x - ox) * 2), 0, 4095), qy = U.clamp(Math.round((y - oy) * 2), 0, 4095), v = qx | (qy << 12);
    wu[o++] = v & 255; wu[o++] = (v >>> 8) & 255; wu[o++] = (v >>> 16) & 255;
  };
  let prevId = 0;
  const wid = (id, bits, nb) => { const d = id - prevId; if (d > 0 && d < 0x3ffffff) wv(d * (1 << nb) + bits); else { wv(bits); wv(id); } prevId = id; };
  const BIN_EV = { hit: 1, die: 1, swing: 1, boom: 1, shoot: 1, eshoot: 1, pickup: 1, chain: 1, hurt: 1, dash: 1, end: 1 };
  N.isJsonEvent = (ev) => !BIN_EV[ev.t];
  const scratchA = [], scratchB = [], scratchC = [];
  const byDmg = (a, b) => b.dmg - a.dmg, byId = (a, b) => a.id - b.id, byNum = (a, b) => a - b;
  const pidOf = (pidIdx, pid) => { const i = pidIdx[pid]; return i === undefined ? 255 : i; };
  const hasFx = (p) => p.fxf !== undefined || p.fxv !== undefined;

  // w: World; cc: { idx (recipient hero index), vw, vh (its view in world px), ack, seq, pidIdx ({ pid: hero index }), evs (events since the last snapshot), carry (JSON events kept from skipped snapshots),
  //   zc (zones this client holds; created here) }. Every returned snapshot must reach that client's Mirror (zones are sent once).
  // Returns an ArrayBuffer (a copy; the scratch is reused).
  N.encodeSnap = (w, cc) => {
    const T = tables();
    o = 0;
    const me = w.heroes[cc.idx], cx = me ? me.x : w.arena.size / 2, cy = me ? me.y : w.arena.size / 2;
    const hw = U.clamp((cc.vw || C.VIEW_W) / 2, C.VIEW_W / 2, 640) + MARGIN, hh = U.clamp((cc.vh || C.VIEW_H) / 2, C.VIEW_H / 2, 400) + MARGIN;
    ox = Math.floor(cx - hw); oy = Math.floor(cy - hh); RW = Math.ceil(hw * 2); RH = Math.ceil(hh * 2);
    w8(SNAP); w32(cc.seq); w32(w.tick); w32(cc.ack || 0);
    wf32(w.xp); wf32(w.xpNext); w16(w.level); w32(w.kills); w32(w.gold);
    w8(w.state === 'won' ? 1 : w.state === 'lost' ? 2 : 0);
    wi16(ox); wi16(oy);
    const b = w.boss;
    if (b && !b.dead) { wv(b.id + 1); wv(b.k); w8(b.hpQ); w8((b.enraged ? 1 : 0) | (b.final ? 2 : 0)); } else wv(0);
    const bb = w.bossBar;
    if (bb && bb.on) { w8(1 | (bb.final ? 2 : 0) | (bb.enraged ? 4 : 0)); wv(Math.max(0, ED.FOE_IDS.indexOf(bb.id))); w8(U.clamp(Math.round(bb.q), 0, 255)); w8(bb.phase | 0); w8(bb.n | 0); w8(bb.rev < 0 ? 255 : U.clamp(Math.round(bb.rev * 254), 0, 254)); } else w8(0);
    const BR = w.arena.braziers, nb = Math.min(BR.length, 255);
    w8(nb); for (let i = 0; i < nb; i += 8) { let m = 0; for (let k = 0; k < 8 && i + k < nb; k++) if (BR[i + k].broken) m |= 1 << k; w8(m); }
    // heroes (all, full)
    w8(w.heroes.length);
    for (let i = 0; i < w.heroes.length; i++) {
      const p = w.heroes[i], st = p.stats || {}, dashing = p.dashT > 0;
      w8(i); wf32(p.x); wf32(p.y); w8(qa8(p.face)); w8(qa8(p.mdir));
      w8(Math.round(U.clamp(p.mvx || 0, -1, 1) * 127) & 255); w8(Math.round(U.clamp(p.mvy || 0, -1, 1) * 127) & 255);
      w8((p.moving ? 1 : 0) | (p.downed ? 2 : 0) | (p.dead ? 4 : 0) | (dashing ? 8 : 0) | (hasFx(p) ? 16 : 0));
      wf32(p.hp); w16(Math.round(p.maxHp)); wf32((st.speed || 0) * (p.slowT > 0 ? 1 - (p.slowK || 0) : 1));
      w16(ms16(p.dashCd)); w16(ms16(p.invuln)); w16(ms16(p.hurtT)); w16(ms16(p.bleed)); w8(q8(p.revive || 0, 255));
      if (dashing) { w16(ms16(p.dashT)); wf32(p.dashDx); wf32(p.dashDy); }
      w8(p.rerolls | 0); w8(p.skips | 0); w8(p.banishes | 0); wv(p.kills | 0);
      w8(p.skills.length); for (const sk of p.skills) { wstr(T.Sm, sk.id); w8(sk.lvl); w16(ms16(sk.cd)); w16(ms16(sk.cdMax)); }
      w8(p.weapons.length); for (const ws of p.weapons) { wstr(T.Wm, ws.id); w8((ws.lvl & 127) | (ws.evo ? 128 : 0)); const R = ws.pr || NOPR; w8((R[0] & 3) | (R[1] & 3) << 2 | (R[2] & 3) << 4 | (ws.fl & 3) << 6); }
      w8(p.passives.length); for (const ps of p.passives) { wstr(T.Pm, ps.id); w8(ps.lvl); }
      if (hasFx(p)) { w16(p.fxf | 0); wf32(p.fxv || 0); }
    }
    // zones: spawn-once per client (cc.zc holds what this client has; the reliable ordered channel delivers every snapshot sent).
    // Records: head = delta << 3 | 4 rectPos | 2 sameStyle | 1 full; pos = 3-byte rect position when rectPos, else i16 x, y (lines and big circles reach far past the rect).
    // full: [style unless sameStyle (equal to the previous full record): look, u8 flags, u16 r, [line: u16 w], [cone: u8 arc], [f32 w], varint dur ms, wid], pos, u16 a, [line: u16 len], varint t ms.
    // moved only: pos. Zones the client holds unchanged are not written (it ages t itself). Then u16 n + ids of held zones that died or left the rect.
    const zc = cc.zc || (cc.zc = { map: new Map(), pool: [], stamp: 0 }), ZM = zc.map, stamp = ++zc.stamp;
    let at = o; w16(0); let n = 0; prevId = 0;
    let yk = null, ywid = '', yfl = 0, yr = 0, yw = 0, yarc = 0, ydur = 0;
    for (const z of w.zones) {
      if (z.dead) continue;
      if (z.len > 0) { const ex = z.x + Math.cos(z.a) * z.len, ey = z.y + Math.sin(z.a) * z.len, r = z.w / 2; if (Math.max(z.x, ex) + r < ox || Math.min(z.x, ex) - r >= ox + RW || Math.max(z.y, ey) + r < oy || Math.min(z.y, ey) - r >= oy + RH) continue; }
      else if (!circR(z.x, z.y, z.r)) continue;
      let c = ZM.get(z.id);
      if (o > LIMIT) { if (c) c.seen = stamp; continue; } // held as is; a stale record differs next time and goes out again
      const qx = U.clamp(Math.round(z.x * 2), -32768, 32767), qy = U.clamp(Math.round(z.y * 2), -32768, 32767);
      const rp = z.x >= ox && z.y >= oy && z.x < ox + 2047 && z.y < oy + 2047 ? 4 : 0;
      const line = z.len > 0, cone = z.arc > 0, zw = !line && z.w ? 16 : 0;
      const fl = (z.team ? 1 : 0) | (z.warn ? 2 : 0) | (line ? 4 : 0) | (cone ? 8 : 0) | zw;
      if (!c || c.k !== z.k || c.wid !== z.wid || c.fl !== fl || c.r !== z.r || c.a !== z.a || c.len !== z.len || c.w !== z.w || c.arc !== z.arc || c.dur !== z.dur || Math.abs(z.t - c.t - (w.tick - c.tick) * C.TICK) > 0.004) {
        const same = z.k === yk && z.wid === ywid && fl === yfl && z.r === yr && z.w === yw && z.arc === yarc && z.dur === ydur;
        wid(z.id, rp | (same ? 2 : 0) | 1, 3);
        if (!same) {
          wstr(T.Lm, z.k); w8(fl); w16(U.clamp(Math.round(z.r * 2), 0, 65535));
          if (line) w16(U.clamp(Math.round(z.w * 2), 0, 65535));
          if (cone) w8(q8(z.arc, 40));
          if (zw) wf32(z.w);
          wv(Math.round(z.dur * 1000)); wstr(T.Wm, z.wid);
          yk = z.k; ywid = z.wid; yfl = fl; yr = z.r; yw = z.w; yarc = z.arc; ydur = z.dur;
        }
        if (rp) wpos(z.x, z.y); else { w16(qx); w16(qy); }
        w16(qa16(z.a)); if (line) w16(U.clamp(Math.round(z.len * 2), 0, 65535));
        wv(Math.round(z.t * 1000));
        if (!c) { c = zc.pool.pop() || {}; c.id = z.id; ZM.set(z.id, c); }
        c.k = z.k; c.wid = z.wid; c.fl = fl; c.r = z.r; c.a = z.a; c.len = z.len; c.w = z.w; c.arc = z.arc; c.dur = z.dur; c.t = z.t; c.tick = w.tick;
      } else if (qx !== c.qx || qy !== c.qy) { wid(z.id, rp, 3); if (rp) wpos(z.x, z.y); else { w16(qx); w16(qy); } }
      else { c.seen = stamp; continue; }
      c.qx = qx; c.qy = qy; c.seen = stamp;
      n++;
    }
    wd.setUint16(at, n, true);
    const gone = scratchA; gone.length = 0;
    for (const c of ZM.values()) if (c.seen !== stamp) gone.push(c.id);
    gone.sort(byNum);
    w16(gone.length); prevId = 0;
    for (let i = 0; i < gone.length; i++) { const id = gone[i]; wid(id, 0, 0); zc.pool.push(ZM.get(id)); ZM.delete(id); }
    gone.length = 0;
    // foes: head = delta << 2 | sameK << 1 | hasFlags; [k]; pos; [flags: 1 flash, 2 face left, 4 elite, 8 frozen, 16 stunned, 32 burning, 64 slowed, 128 more: u8 st, u8 hpQ, u8 r, u8 scale x16, u8 (1 enraged)]
    at = o; w16(0); n = 0; prevId = 0;
    let pk = -1;
    for (const e of w.foes) {
      if (e.dead || !inR(e.x, e.y) || o > LIMIT) continue;
      const def = e.def, more = e.elite || e.boss || e.st || e.enraged || e.r !== def.r || (e.scale || 1) !== (def.scale || 1);
      const f = (e.flash > 0 ? 1 : 0) | (e.face < 0 ? 2 : 0) | (e.elite ? 4 : 0) | (e.freezeT > 0 ? 8 : 0) | (e.stunT > 0 ? 16 : 0) | (e.burnT > 0 ? 32 : 0) | (e.slowT > 0 ? 64 : 0) | (more ? 128 : 0);
      const same = e.k === pk;
      wid(e.id, (same ? 2 : 0) | (f ? 1 : 0), 2);
      if (!same) { wv(e.k); pk = e.k; }
      wpos(e.x, e.y);
      if (f) w8(f);
      if (more) { w8(e.st | 0); w8(e.hpQ); w8(U.clamp(Math.round(e.r), 0, 255)); w8(q8(e.scale || 1, 16)); w8(e.enraged ? 1 : 0); }
      n++;
    }
    wd.setUint16(at, n, true);
    // projectiles: head = delta << 1 | sameStyle; [style: look, wid, u8 team << 7 | r x2]; pos; u8 angle
    at = o; w16(0); n = 0; prevId = 0;
    let sk = '', sw = '', sr = -1;
    for (const pr of w.projs) {
      if (pr.dead || !inR(pr.x, pr.y) || o > LIMIT) continue;
      const rr = (pr.team ? 128 : 0) | U.clamp(Math.round(pr.r * 2), 0, 127), same = pr.k === sk && pr.wid === sw && rr === sr;
      wid(pr.id, same ? 1 : 0, 1);
      if (!same) { wstr(T.Lm, pr.k); wstr(T.Wm, pr.wid); w8(rr); sk = pr.k; sw = pr.wid; sr = rr; }
      wpos(pr.x, pr.y); w8(qa8(Math.atan2(pr.vy, pr.vx)));
      n++;
    }
    wd.setUint16(at, n, true);
    // pickups: head = delta << 1 | sameK; [k]; pos
    at = o; w16(0); n = 0; prevId = 0; sk = '';
    for (const g of w.pickups) {
      if (g.dead || !inR(g.x, g.y) || o > LIMIT) continue;
      const same = g.k === sk;
      wid(g.id, same ? 1 : 0, 1);
      if (!same) { wstr(T.Km, g.k); sk = g.k; }
      wpos(g.x, g.y);
      n++;
    }
    wd.setUint16(at, n, true);
    // events
    const evs = cc.evs || [], pidIdx = cc.pidIdx || {}, hits = scratchA, dies = scratchB, misc = scratchC;
    hits.length = dies.length = misc.length = 0;
    let picks = 0;
    for (const ev of evs) {
      const t = ev.t;
      if (t === 'hit') { if (inR(ev.x, ev.y)) hits.push(ev); }
      else if (t === 'die') { if (inR(ev.x, ev.y)) dies.push(ev); }
      else if (t === 'swing' || t === 'eshoot') { if (inR(ev.x, ev.y)) misc.push(ev); }
      else if (t === 'boom') { if (circR(ev.x, ev.y, ev.r || 0)) misc.push(ev); }
      else if (t === 'pickup') { if ((pidIdx[ev.pid] === cc.idx || inR(ev.x, ev.y)) && picks < PICK_CAP) { picks++; misc.push(ev); } }
      else if (t === 'chain') { const p = ev.pts; if (p && p.length >= 2 && (inR(p[0], p[1]) || inR(p[p.length - 2], p[p.length - 1]))) misc.push(ev); }
      else if (t === 'shoot') { const p = w.heroes[pidIdx[ev.pid]]; if (p && (pidIdx[ev.pid] === cc.idx || inR(p.x, p.y))) misc.push(ev); }
      else if (t === 'hurt' || t === 'dash') misc.push(ev);
    }
    if (hits.length > HIT_CAP) { hits.sort(byDmg); hits.length = HIT_CAP; }
    hits.sort(byId);
    if (dies.length > DIE_CAP) { let k = 0; for (let i = 0; i < dies.length; i++) if (dies[i].elite || dies[i].boss) { const t = dies[k]; dies[k++] = dies[i]; dies[i] = t; } dies.length = DIE_CAP; }
    dies.sort(byId);
    w16(hits.length); prevId = 0;
    for (const ev of hits) { wid(ev.id, 0, 0); wpos(ev.x, ev.y); wv(Math.min(0x7fffffff, Math.round(ev.dmg)) * 2 + (ev.crit ? 1 : 0)); }
    w16(dies.length); prevId = 0;
    for (const ev of dies) { wid(ev.id, 0, 0); wpos(ev.x, ev.y); wv(ev.k * 4 + (ev.elite ? 2 : 0) + (ev.boss ? 1 : 0)); }
    at = o; w16(0); n = 0;
    for (const ev of misc) {
      if (n >= MISC_CAP || o > LIMIT) break;
      const t = ev.t, pi = pidOf(pidIdx, ev.pid);
      if (t === 'swing') { w8(3); w8(pi); wstr(T.Wm, ev.wid); wpos(ev.x, ev.y); w8(qa8(ev.a)); w16(U.clamp(Math.round(ev.r), 0, 65535)); w8(q8(ev.arc || 0, 40)); wstr(T.Lm, ev.look); }
      else if (t === 'boom') { w8(4); w8(pi); wstr(T.Wm, ev.wid); wi16(ev.x * 2); wi16(ev.y * 2); w16(U.clamp(Math.round(ev.r), 0, 65535)); wstr(T.Lm, ev.look); w8(ev.team ? 1 : 0); }
      else if (t === 'shoot') { w8(5); w8(pi); wstr(T.Wm, ev.wid); }
      else if (t === 'eshoot') { w8(6); wv(ev.id); wpos(ev.x, ev.y); wstr(T.Lm, ev.look); }
      else if (t === 'pickup') { w8(7); wstr(T.Km, ev.k); w8(pi); wi16(ev.x * 2); wi16(ev.y * 2); wv(Math.round(ev.val || 0)); }
      else if (t === 'chain') { const p = ev.pts, m = Math.min(255, p.length >> 1); w8(8); w8(pi); wstr(T.Wm, ev.wid); wstr(T.Lm, ev.look); w8(m); for (let k = 0; k < m * 2; k++) wi16(p[k] * 2); }
      else if (t === 'hurt') { w8(9); w8(pi); wv(Math.round(ev.dmg)); wi16(ev.x * 2); wi16(ev.y * 2); }
      else if (t === 'dash') { w8(10); w8(pi); wi16(ev.x * 2); wi16(ev.y * 2); w8(qa8(ev.a)); }
      n++;
    }
    wd.setUint16(at, n, true);
    // JSON events (rare, varied shapes): kept ones from skipped snapshots first
    at = o; w16(0); n = 0;
    const carry = cc.carry;
    const json = (ev) => {
      if (n >= JSON_CAP || !enc) return;
      let s; try { s = JSON.stringify(ev); } catch (e) { return; }
      if (!s || o + 2 + s.length * 3 > CAP - 16) return;
      const r = enc.encodeInto(s, wu.subarray(o + 2));
      wd.setUint16(o, r.written, true); o += 2 + r.written; n++;
    };
    if (carry) { for (const ev of carry) json(ev); carry.length = 0; }
    for (const ev of evs) if (!BIN_EV[ev.t]) json(ev);
    wd.setUint16(at, n, true);
    return wb.slice(0, o);
  };
  // A skipped snapshot (busy channel): its JSON events wait for the next one.
  N.keepEvents = (cc) => { const c = cc.carry || (cc.carry = []); for (const ev of cc.evs || []) if (!BIN_EV[ev.t] && c.length < CARRY_CAP) c.push(ev); };

  // ---------------- client mirror (decode + interpolation) ----------------
  // Every entity keeps its last 4 samples (server time, x, y, sample flags). The view draws them at render time rt (behind the newest snapshot):
  // lerp between the samples around rt, a short extrapolation past the newest, nothing before the first sample (spawns appear on time).
  // An entity missing from a snapshot stays until rt reaches that snapshot's time (culled or dead), then returns to the pool.
  const HN = 4, GAP = 0.3, EXTRA = 0.1;
  const mkTrack = (o) => { o.ht = [0, 0, 0, 0]; o.hx = [0, 0, 0, 0]; o.hy = [0, 0, 0, 0]; o.hf = [0, 0, 0, 0]; o.n = 0; o.hi = -1; o.born = 0; o.gone = -1; o.seen = 0; o.dead = false; return o; };
  const sample = (o, T, x, y, f, seq) => {
    if (o.n === 0) o.born = T;
    o.hi = (o.hi + 1) & 3; o.ht[o.hi] = T; o.hx[o.hi] = x; o.hy[o.hi] = y; o.hf[o.hi] = f;
    if (o.n < HN) o.n++;
    o.seen = seq; o.gone = -1;
  };
  // Sets o.x / o.y at time rt; returns the index of the sample used for flags, or -1 when the entity is not visible yet.
  const interp = (o, rt) => {
    if (o.n === 0 || rt < o.born - 1e-4) return -1;
    let j = o.hi, k = 0;
    while (k < o.n - 1 && o.ht[j] > rt) { j = (j - 1) & 3; k++; }
    if (o.ht[j] > rt) { o.x = o.hx[j]; o.y = o.hy[j]; return j; } // older than every kept sample
    if (k === 0) { // past the newest: extrapolate from the last two samples
      const i = (j - 1) & 3, dt = o.ht[j] - o.ht[i];
      if (o.n >= 2 && dt > 1e-4 && dt < GAP) { const e = Math.min(rt - o.ht[j], EXTRA) / dt; o.x = o.hx[j] + (o.hx[j] - o.hx[i]) * e; o.y = o.hy[j] + (o.hy[j] - o.hy[i]) * e; }
      else { o.x = o.hx[j]; o.y = o.hy[j]; }
      return j;
    }
    const n = (j + 1) & 3, span = o.ht[n] - o.ht[j];
    if (span > GAP || span <= 1e-6) { o.x = o.hx[j]; o.y = o.hy[j]; return j; }
    const t = (rt - o.ht[j]) / span;
    o.x = o.hx[j] + (o.hx[n] - o.hx[j]) * t; o.y = o.hy[j] + (o.hy[n] - o.hy[j]) * t;
    return j;
  };
  N.interp = interp;
  function Tracks(make, apply) { this.map = new Map(); this.list = []; this.pool = []; this.make = make; this.apply = apply; }
  Tracks.prototype.get = function (id) {
    let e = this.map.get(id);
    if (!e) { e = this.pool.pop() || mkTrack(this.make()); e.id = id; e.n = 0; e.hi = -1; e.gone = -1; e.dead = false; this.map.set(id, e); this.list.push(e); }
    return e;
  };
  Tracks.prototype.sweep = function (seq, T) { const L = this.list; for (let i = 0; i < L.length; i++) { const e = L[i]; if (e.seen !== seq && e.gone < 0) e.gone = T; } };
  // Interpolates every track at rt into out (cleared first); drops tracks whose gone time has passed.
  Tracks.prototype.frame = function (rt, out) {
    const L = this.list; let n = 0;
    out.length = 0;
    for (let i = 0; i < L.length; i++) {
      const e = L[i];
      if (e.gone >= 0 && rt >= e.gone) { this.map.delete(e.id); e.dead = true; this.pool.push(e); continue; }
      L[n++] = e;
      const j = interp(e, rt);
      if (j < 0) continue;
      if (this.apply) this.apply(e, e.hf[j], rt - e.ht[j], rt);
      out.push(e);
    }
    L.length = n;
  };
  Tracks.prototype.clear = function () { for (const e of this.list) this.pool.push(e); this.list.length = 0; this.map.clear(); };

  const foeApply = (e, f, since, rt) => { e.flash = f & 1 ? 0.06 : 0; e.face = f & 2 ? -1 : 1; e.freezeT = f & 8 ? 1 : 0; e.stunT = f & 16 ? 1 : 0; e.burnT = f & 32 ? 1 : 0; e.slowT = f & 64 ? 1 : 0; const st = f >>> 8; if (st !== e.st) { e.st = st; e.st0 = rt; } e.stT = rt - e.st0; };
  const projApply = (pr, f, since, rt) => { pr.a = da8(f); pr.t = rt - pr.born; };
  const zoneApply = (z, f, since) => { z.t = Math.min(z.dur, f + Math.max(0, since)); };
  const zoneAge = (z, T) => z.hf[z.hi] + (T - z.ht[z.hi]); // zone t at server time T from its newest sample
  const heroFields = () => ({ pid: '', slot: 0, cls: 'knight', name: '', x: 0, y: 0, r: C.HERO_R, face: 0, mdir: 0, mvx: 0, mvy: 0, moving: false, hp: 1, maxHp: 1, spd: 0, dashCd: 0, dashT: 0, dashDx: 1, dashDy: 0, invuln: 0, hurtT: 0, downed: false, bleed: 0, revive: 0, dead: false, kills: 0, rerolls: 0, skips: 0, banishes: 0, weapons: [], passives: [], skills: [], offer: null, fxf: 0, fxv: 0 });

  // cfg: { stage, seed, roster: [{ pid, slot, name, cls }] (World hero order), myPid }. view: the ARCHITECTURE §10 view model, arrays rebuilt by frame(rt).
  N.Mirror = function (cfg) {
    this.roster = cfg.roster; this.myPid = cfg.myPid; this.seq = 0; this.T = 0; this.ack = 0; this.ready = false; this.state = 'play';
    this.view = { me: null, heroes: [], foes: [], projs: [], zones: [], pickups: [], props: ED.Arena.generate(cfg.stage | 0, cfg.seed >>> 0), stage: cfg.stage | 0, seed: cfg.seed >>> 0, time: 0, xp: 0, xpNext: 1, level: 1, kills: 0, gold: 0, boss: null, events: [] };
    this.heroes = cfg.roster.map((r, i) => { const h = mkTrack(heroFields()); h.pid = r.pid; h.slot = r.slot | 0; h.cls = r.cls; h.name = r.name || 'Hero'; h.idx = i; return h; });
    this.myIdx = this.heroes.findIndex(h => h.pid === cfg.myPid);
    this.me = this.heroes[this.myIdx] || null; // view.me from the first snapshot on
    this.srv = { x: 0, y: 0, dashT: 0, dashCd: 0, dashDx: 1, dashDy: 0, mdir: 0, mvx: 0, mvy: 0, moving: false, spd: 0, live: false };
    this.boss = { id: 0, k: 0, x: 0, y: 0, hpQ: 255, enraged: false, final: false, dead: false };
    this.bossBar = { on: false, id: '', name: '', q: 0, phase: 0, final: false, enraged: false, n: 0, rev: -1 };
    this.foes = new Tracks(() => ({ id: 0, k: 0, def: null, x: 0, y: 0, r: 7, hpQ: 255, face: 1, flash: 0, st: 0, stT: 0, st0: 0, elite: false, boss: false, scale: 1, enraged: false, freezeT: 0, stunT: 0, burnT: 0, slowT: 0 }), foeApply);
    this.projs = new Tracks(() => ({ id: 0, k: '', wid: '', team: 0, x: 0, y: 0, a: 0, r: 4, t: 0 }), projApply);
    this.picks = new Tracks(() => ({ id: 0, k: 'xp1', x: 0, y: 0 }), null);
    this.zones = new Tracks(() => ({ id: 0, k: '', wid: '', team: 0, warn: false, x: 0, y: 0, r: 0, a: 0, len: 0, w: 0, arc: 0, t: 0, dur: 1 }), zoneApply);
    this.zs = { k: '', f: 0, r: 0, w: 0, arc: 0, dur: 1, wid: '' }; // zone style of the previous full record (decode)
    this.evq = []; // { T, ev } in arrival order
    this.bytes = 0;
  };
  const MP = N.Mirror.prototype;
  // Decodes one snapshot (older or repeated ones are ignored). Returns its server time, or -1.
  MP.apply = function (buf) {
    const TBL = tables(), v = this.view;
    reader(buf);
    if (r8() !== SNAP) return -1;
    const seq = r32();
    if (seq <= this.seq) return -1;
    this.seq = seq; this.bytes = buf.byteLength;
    const tick = r32(), T = tick * C.TICK;
    this.T = T; this.ack = r32();
    v.xp = rf32(); v.xpNext = rf32(); v.level = r16(); v.kills = r32(); v.gold = r32();
    const stv = r8(); this.state = stv === 1 ? 'won' : stv === 2 ? 'lost' : 'play';
    ox = ri16(); oy = ri16();
    const bid = rv();
    if (bid) { const B = this.boss; B.id = bid - 1; B.k = rv(); B.hpQ = r8(); const f = r8(); B.enraged = !!(f & 1); B.final = !!(f & 2); B.dead = false; v.boss = B; } else v.boss = null;
    const bf = r8(), BB = this.bossBar;
    if (bf & 1) { const d = ED.FOES[ED.FOE_IDS[rv()]]; BB.on = true; BB.final = !!(bf & 2); BB.enraged = !!(bf & 4); BB.id = d ? d.id : ''; BB.name = d ? d.name : 'Boss'; BB.q = r8(); BB.phase = r8(); BB.n = r8(); const rv8b = r8(); BB.rev = rv8b === 255 ? -1 : rv8b / 254; } else BB.on = false;
    v.bossBar = BB;
    const nb = r8(), BR = v.props.braziers;
    for (let i = 0; i < nb; i += 8) { const m = r8(); for (let k = 0; k < 8 && i + k < nb; k++) if (BR[i + k]) { const br = !!(m & (1 << k)); BR[i + k].broken = br; BR[i + k].hp = br ? 0 : 1; } }
    // heroes
    const nh = r8();
    for (let c = 0; c < nh; c++) {
      const h = this.heroes[r8()] || mkTrack(heroFields()), mine = h === this.me, x = rf32(), y = rf32(), face = da8(r8()), mdir = da8(r8());
      const mvx = ((r8() << 24) >> 24) / 127, mvy = ((r8() << 24) >> 24) / 127, fl = r8();
      h.hp = rf32(); h.maxHp = r16(); h.spd = rf32();
      const dashCd = r16() / 1000; h.invuln = r16() / 1000; h.hurtT = r16() / 1000; h.bleed = r16() / 1000; h.revive = r8() / 255;
      let dashT = 0, ddx = 1, ddy = 0;
      if (fl & 8) { dashT = r16() / 1000; ddx = rf32(); ddy = rf32(); }
      h.rerolls = r8(); h.skips = r8(); h.banishes = r8(); h.kills = rv();
      h.downed = !!(fl & 2); h.dead = !!(fl & 4);
      let n = r8(); const S = h.skills; for (let i = 0; i < n; i++) { const s = S[i] || (S[i] = { id: '', lvl: 1, cd: 0, cdMax: 1 }); s.id = rstr(TBL.S); s.lvl = r8(); s.cd = r16() / 1000; s.cdMax = r16() / 1000; } S.length = n;
      n = r8(); const Wp = h.weapons; for (let i = 0; i < n; i++) { const s = Wp[i] || (Wp[i] = { id: '', root: '', lvl: 1, evo: false, pr: [0, 0, 0], fl: 0 }); s.id = rstr(TBL.W); s.root = ED.weaponRoot(s.id); const l = r8(); s.lvl = l & 127; s.evo = !!(l & 128); const r = r8(); s.pr[0] = r & 3; s.pr[1] = r >> 2 & 3; s.pr[2] = r >> 4 & 3; s.fl = r >> 6 & 3; } Wp.length = n;
      n = r8(); const Ps = h.passives; for (let i = 0; i < n; i++) { const s = Ps[i] || (Ps[i] = { id: '', lvl: 1 }); s.id = rstr(TBL.P); s.lvl = r8(); } Ps.length = n;
      if (fl & 16) { h.fxf = r16(); h.fxv = rf32(); } else { h.fxf = 0; h.fxv = 0; }
      if (mine) { const s = this.srv; s.x = x; s.y = y; s.mdir = mdir; s.mvx = mvx; s.mvy = mvy; s.moving = !!(fl & 1); s.dashT = dashT; s.dashCd = dashCd; s.dashDx = ddx; s.dashDy = ddy; s.spd = h.spd; s.live = !h.downed && !h.dead; }
      else { h.face = face; h.mdir = mdir; h.mvx = mvx; h.mvy = mvy; h.moving = !!(fl & 1); h.dashT = dashT; h.dashCd = dashCd; h.dashDx = ddx; h.dashDy = ddy; sample(h, T, x, y, 0, seq); }
    }
    // zones (spawn-once, see encodeSnap): full records, moves, then ids that died or left; held zones not written stay and age with server time
    const ZT = this.zones, ZS = this.zs;
    let n = r16(); prevId = 0;
    for (let i = 0; i < n; i++) {
      const id = rid(3), bits = lastBits;
      if (!(bits & 1)) { const p = zpos(bits), z = ZT.map.get(id); if (z && z.n && z.gone < 0) sample(z, T, p.x, p.y, zoneAge(z, T), seq); continue; }
      if (!(bits & 2)) {
        ZS.k = rstr(TBL.L); const f = ZS.f = r8(); ZS.r = r16() / 2;
        ZS.w = f & 4 ? r16() / 2 : 0;
        ZS.arc = f & 8 ? r8() / 40 : 0;
        if (f & 16) ZS.w = rf32();
        ZS.dur = rv() / 1000; ZS.wid = rstr(TBL.W);
      }
      const z = ZT.get(id), p = zpos(bits), f = ZS.f;
      z.k = ZS.k; z.team = f & 1; z.warn = !!(f & 2); z.r = ZS.r; z.w = ZS.w; z.arc = ZS.arc; z.dur = ZS.dur; z.wid = ZS.wid;
      z.a = da16(r16()); z.len = f & 4 ? r16() / 2 : 0;
      sample(z, T, p.x, p.y, rv() / 1000, seq);
    }
    n = r16(); prevId = 0;
    for (let i = 0; i < n; i++) { const z = ZT.map.get(rid(0)); if (z && z.gone < 0) z.gone = T; }
    // held zones: a new sample at T keeps a zone that moved earlier from extrapolating; one far past its duration (lost state) is dropped
    for (let i = 0, L = ZT.list; i < L.length; i++) {
      const z = L[i];
      if (z.seen === seq || z.gone >= 0 || !z.n) continue;
      const age = zoneAge(z, T);
      if (age > z.dur + 1) z.gone = T; else if (z.n >= 2) sample(z, T, z.hx[z.hi], z.hy[z.hi], age, seq);
    }
    // foes
    n = r16(); prevId = 0;
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const id = rid(2), bits = lastBits;
      if (!(bits & 2)) pk = rv();
      const e = this.foes.get(id), p = rpos();
      if (e.k !== pk || !e.def) { e.k = pk; e.def = ED.FOES[ED.FOE_IDS[pk]] || ED.FOES[ED.FOE_IDS[0]]; }
      const def = e.def, f = bits & 1 ? r8() : 0;
      e.elite = !!(f & 4); e.boss = !!def.boss;
      let st = 0;
      if (f & 128) { st = r8(); e.hpQ = r8(); e.r = r8(); e.scale = r8() / 16; e.enraged = !!(r8() & 1); }
      else { e.hpQ = 255; e.r = def.r; e.scale = def.scale || 1; e.enraged = false; }
      sample(e, T, p.x, p.y, (f & 127) | (st << 8), seq);
    }
    // projectiles
    n = r16(); prevId = 0;
    let sk = '', sw = '', sr = 0;
    for (let i = 0; i < n; i++) {
      const id = rid(1);
      if (!(lastBits & 1)) { sk = rstr(TBL.L); sw = rstr(TBL.W); sr = r8(); }
      const pr = this.projs.get(id), p = rpos(), a = r8();
      pr.k = sk; pr.wid = sw; pr.team = sr & 128 ? 1 : 0; pr.r = (sr & 127) / 2;
      sample(pr, T, p.x, p.y, a, seq); // pr.t (age) counts from the first sample
    }
    // pickups
    n = r16(); prevId = 0; sk = '';
    for (let i = 0; i < n; i++) {
      const id = rid(1);
      if (!(lastBits & 1)) sk = rstr(TBL.K);
      const g = this.picks.get(id), p = rpos();
      g.k = sk;
      sample(g, T, p.x, p.y, 0, seq);
    }
    this.foes.sweep(seq, T); this.projs.sweep(seq, T); this.picks.sweep(seq, T);
    // events (released at their snapshot's time, with the entities they belong to)
    const R = this.roster, pidAt = (i) => (R[i] ? R[i].pid : '');
    n = r16(); prevId = 0;
    for (let i = 0; i < n; i++) { const id = rid(0), p = rpos(), d = rv(); this.evq.push({ T, ev: { t: 'hit', id, x: p.x, y: p.y, dmg: Math.floor(d / 2), crit: !!(d & 1) } }); }
    n = r16(); prevId = 0;
    for (let i = 0; i < n; i++) { const id = rid(0), p = rpos(), d = rv(); this.evq.push({ T, ev: { t: 'die', id, k: d >> 2, x: p.x, y: p.y, elite: !!(d & 2), boss: !!(d & 1) } }); }
    n = r16();
    for (let i = 0; i < n; i++) {
      const ty = r8(); let ev = null;
      if (ty === 3) { const pid = pidAt(r8()), wid = rstr(TBL.W), p = rpos(); ev = { t: 'swing', pid, wid, x: p.x, y: p.y, a: da8(r8()), r: r16(), arc: r8() / 40, look: rstr(TBL.L) }; }
      else if (ty === 4) { const pid = pidAt(r8()), wid = rstr(TBL.W), x = ri16() / 2, y = ri16() / 2; ev = { t: 'boom', pid, wid, x, y, r: r16(), look: rstr(TBL.L), team: r8() }; }
      else if (ty === 5) { const pid = pidAt(r8()); ev = { t: 'shoot', pid, wid: rstr(TBL.W) }; }
      else if (ty === 6) { const id = rv(), p = rpos(); ev = { t: 'eshoot', id, x: p.x, y: p.y, look: rstr(TBL.L) }; }
      else if (ty === 7) { const k = rstr(TBL.K), pid = pidAt(r8()), x = ri16() / 2, y = ri16() / 2; ev = { t: 'pickup', k, pid, x, y, val: rv() }; }
      else if (ty === 8) { const pid = pidAt(r8()), wid = rstr(TBL.W), look = rstr(TBL.L), m = r8(), pts = []; for (let k = 0; k < m * 2; k++) pts.push(ri16() / 2); ev = { t: 'chain', pid, wid, pts, look }; }
      else if (ty === 9) { const pid = pidAt(r8()), dmg = rv(); ev = { t: 'hurt', pid, dmg, x: ri16() / 2, y: ri16() / 2 }; }
      else if (ty === 10) { const pid = pidAt(r8()), x = ri16() / 2, y = ri16() / 2; ev = { t: 'dash', pid, x, y, a: da8(r8()) }; }
      else break; // unknown type: the rest of this section cannot be parsed
      this.evq.push({ T, ev });
    }
    n = r16();
    for (let i = 0; i < n; i++) {
      const len = r16();
      if (dec) { try { this.evq.push({ T, ev: JSON.parse(dec.decode(rv8.subarray(ro, ro + len))) }); } catch (e) { /* skip a broken event */ } }
      ro += len;
    }
    if (this.evq.length > 2000) this.evq.splice(0, this.evq.length - 2000);
    this.ready = true; v.me = this.me;
    return T;
  };
  let lastBits = 0;
  // Id with nb flag bits (bits in lastBits); see wid().
  function rid(nb) {
    const h = rv(), m = 1 << nb, d = Math.floor(h / m);
    lastBits = h % m;
    const id = d ? prevId + d : rv();
    prevId = id;
    return id;
  }
  const PT = { x: 0, y: 0 };
  function rpos() { const v = rv8[ro] | (rv8[ro + 1] << 8) | (rv8[ro + 2] << 16); ro += 3; PT.x = ox + (v & 4095) / 2; PT.y = oy + (v >>> 12) / 2; return PT; }
  function zpos(bits) { if (bits & 4) return rpos(); PT.x = ri16() / 2; PT.y = ri16() / 2; return PT; } // zone position: rect-relative or absolute

  // Rebuilds the view arrays at render time rt (remote heroes interpolated; the own hero is placed by the session's prediction).
  MP.frame = function (rt) {
    const v = this.view;
    v.time = rt;
    this.zones.frame(rt, v.zones); this.foes.frame(rt, v.foes); this.projs.frame(rt, v.projs); this.picks.frame(rt, v.pickups);
    const B = v.boss; if (B) { const f = this.foes.map.get(B.id); if (f) { B.x = f.x; B.y = f.y; } }
    v.heroes.length = 0;
    for (const h of this.heroes) { if (h !== this.me) { if (h.n) interp(h, rt); else continue; } else if (!this.ready) continue; v.heroes.push(h); }
  };
  // Calls fn(ev) for every queued event whose snapshot time is <= rt, in order.
  MP.release = function (rt, fn) {
    const q = this.evq; let i = 0;
    while (i < q.length && q[i].T <= rt) fn(q[i++].ev);
    if (i) q.splice(0, i);
  };
  N.decodeSnap = (buf, mirror) => mirror.apply(buf);

  // ---------------- input packets (client -> host) ----------------
  // u8 INPUT, u32 first seq, u8 n, u16 view w, u16 view h, then per local tick: i8 mx, i8 my (x127), i16 ax, ay (x2), u16 edges (1 dash, 2 q, 4 e, 8 reroll, 16 skip, pick << 5, banish << 8).
  // frames: ring of { seq, qx, qy, ax, ay, ed } indexed by seq & mask.
  N.encodeInput = (ring, mask, from, to, vw, vh) => {
    o = 0;
    const n = Math.min(255, to - from + 1);
    w8(INPUT); w32(from); w8(n); w16(Math.round(vw)); w16(Math.round(vh));
    for (let s = from; s < from + n; s++) { const f = ring[s & mask]; w8(f.qx & 255); w8(f.qy & 255); wi16(f.ax * 2); wi16(f.ay * 2); w16(f.ed); }
    return wb.slice(0, o);
  };
  // Calls fn(seq, mx, my, ax, ay, ed) for each frame in the packet; returns { vw, vh } or null for a bad packet.
  const VIEW = { vw: 0, vh: 0 };
  N.decodeInput = (buf, fn) => {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 10) return null;
    reader(buf);
    if (r8() !== INPUT) return null;
    const from = r32(), n = r8();
    VIEW.vw = r16(); VIEW.vh = r16();
    if (buf.byteLength < 10 + n * 8) return null;
    for (let i = 0; i < n; i++) { const qx = (r8() << 24) >> 24, qy = (r8() << 24) >> 24, ax = ri16() / 2, ay = ri16() / 2; fn(from + i, qx, qy, ax, ay, r16()); }
    return VIEW;
  };

  // ---------------- party (lobby flow API) ----------------
  // N.Party(game): one lobby session bound to a game session (ED.Game by default). ED.Net.host / join / setHero / setReady / setStage / start / leave and ED.Net.lobby use the default party.
  // lobby: { role: '' | 'host' | 'client', code, me (own pid), status: 'idle' | 'connecting' | 'open' | 'closed' | 'error', error, stage, members: [{ pid, slot, name, cls, ready, isHost }], inRun, canStart }.
  // Callbacks (UI): N.onChange(lobby) on any lobby change, N.onError(msg) when hosting / joining fails or the host refuses, N.onClosed(msg) when the party ends outside a run
  // (a host leaving mid-run ends the run with sum.note instead). A run starts on every peer through ED.App.enterRun(stage) after the session is built.
  N.Party = function (game, cb) {
    this.game = game || null; this.cb = cb || N; this.sess = null;
    this.lobby = { role: '', code: '', me: '', status: 'idle', error: '', stage: 0, members: [], inRun: false, canStart: false };
  };
  const PP = N.Party.prototype;
  PP.G = function () { return this.game || ED.Game; };
  PP.changed = function () {
    const L = this.lobby, s = this.sess;
    L.canStart = L.role === 'host' && L.status === 'open' && !L.inRun && !!s && s.allReady();
    if (this.cb.onChange) this.cb.onChange(L);
  };
  PP.fail = function (msg) { this.lobby.error = msg; if (this.cb.onError) this.cb.onError(msg); this.changed(); };
  // Own lobby pick: hero cls (default: the hero selected in the menus) and permanent ranks from the profile.
  PP.pick = function (cls) {
    const A = ED.App, prof = A && A.profile;
    cls = cls || (A && A.sel && A.sel.cls) || ED.HERO_IDS[0];
    return cleanPick({ cls, meta: prof && ED.Save.metaBundle ? ED.Save.metaBundle(prof) : { shop: {}, sigs: [] } });
  };
  PP.setLobby = function (st) {
    const L = this.lobby;
    L.code = st.code || L.code; L.stage = st.stage | 0; L.members = st.members.slice().sort((a, b) => a.slot - b.slot);
    this.changed();
  };
  // Opens a party; returns its code (a taken code is replaced: watch lobby.code).
  PP.host = function (name, cls) {
    this.leave();
    const pk = this.pick(cls), L = this.lobby, tok = this.tok = {}, live = () => this.tok === tok;
    L.role = 'host'; L.me = 'host'; L.status = 'connecting'; L.error = ''; L.inRun = false; L.stage = 0;
    const s = this.sess = new N.Host({ name: ED.Save.sanitizeName(name), cls: pk.cls, meta: pk.meta }, {
      status: (st, msg) => { if (!live()) return; if (st === 'open') { L.status = 'open'; this.changed(); } else { L.status = 'error'; this.fail(msg); } },
      code: (c) => { if (live()) { L.code = c; this.changed(); } },
      lobby: (st) => { if (live()) this.setLobby(st); },
      left: (pid) => { const G = this.G(); if (live() && L.inRun && G.mode === 'host') G.netLeft(pid); },
      data: (pid, d) => { const G = this.G(); if (live() && L.inRun && G.mode === 'host') G.onNetData(pid, d); },
    });
    L.code = s.code;
    s.broadcastLobby();
    return s.code;
  };
  PP.join = function (code, name, cls) {
    this.leave();
    const pk = this.pick(cls), L = this.lobby, tok = this.tok = {}, live = () => this.tok === tok;
    L.role = 'client'; L.status = 'connecting'; L.error = ''; L.code = N.cleanCode(code); L.inRun = false;
    const s = this.sess = new N.Client(L.code, { name: ED.Save.sanitizeName(name), cls: pk.cls, meta: pk.meta }, {
      welcome: (d) => { if (!live()) return; L.me = d.pid; L.status = 'open'; this.changed(); },
      error: (msg) => { if (!live()) return; L.status = 'error'; this.tok = null; this.sess = null; s.close(); this.fail(msg); },
      lobby: (st) => { if (live()) this.setLobby(st); },
      closed: (msg) => {
        if (!live()) return;
        const G = this.G(), wasRun = L.inRun;
        L.status = 'closed'; L.error = msg; L.inRun = false; this.sess = null; this.tok = null;
        if (wasRun && G.mode === 'client') G.netLost(msg);
        else if (this.cb.onClosed) this.cb.onClosed(msg);
        this.changed();
      },
      data: (d) => {
        if (!live()) return;
        const G = this.G();
        if (d.t === 'start') this.begin(d);
        else if (L.inRun && G.mode === 'client') { if (d.t === 'end') { L.inRun = false; this.changed(); } G.onNetData(d); }
      },
    });
    this.changed();
  };
  PP.setHero = function (cls) {
    const s = this.sess; if (!s || this.lobby.inRun) return;
    const pk = this.pick(cls);
    if (this.lobby.role === 'host') s.setMe({ cls: pk.cls, meta: pk.meta }); else s.send({ t: 'pick', cls: pk.cls, meta: pk.meta });
  };
  PP.setReady = function (v) { const s = this.sess; if (s && this.lobby.role === 'client' && !this.lobby.inRun) s.send({ t: 'ready', v: !!v }); };
  PP.setStage = function (i) { const s = this.sess; if (s && this.lobby.role === 'host' && !this.lobby.inRun) s.setStage(i); };
  // Host: starts the run for everyone when all guests are ready (cheats and seed: checks and tools only). Returns true when it started.
  PP.start = function (cheats, seed) {
    const s = this.sess, L = this.lobby;
    if (!s || L.role !== 'host' || L.inRun || !s.allReady()) return false;
    seed = seed ? seed >>> 0 : ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0) || 1;
    const members = s.members.slice().sort((a, b) => a.slot - b.slot);
    const roster = members.map(m => ({ pid: m.pid, slot: m.slot, name: m.name, cls: m.cls }));
    s.started = true;
    s.broadcast({ t: 'start', seed, stage: s.stage, roster, ver: N.VERSION });
    L.inRun = true;
    const G = this.G();
    G.startNet({ mode: 'host', seed, stage: s.stage, myPid: 'host', players: members.map(m => ({ pid: m.pid, slot: m.slot, name: m.name, cls: m.cls, meta: m.meta })), cheats, net: this.hostNet(s) });
    this.enter(s.stage);
    this.changed();
    return true;
  };
  PP.hostNet = function (s) {
    return {
      send: (pid, d) => s.sendTo(pid, d), busy: (pid) => s.busy(pid), linked: (pid) => s.conns.has(pid),
      ended: () => { if (this.sess !== s) return; s.started = false; this.lobby.inRun = false; for (const m of s.members) if (!m.isHost) m.ready = false; s.broadcastLobby(); },
    };
  };
  PP.begin = function (d) {
    const s = this.sess, L = this.lobby;
    if (d.ver !== N.VERSION || !Array.isArray(d.roster) || !d.roster.some(r => r.pid === s.pid)) { L.status = 'error'; this.tok = null; this.sess = null; s.close(); this.fail('The host runs a different game version. Refresh the page.'); return; }
    L.inRun = true; L.stage = d.stage | 0;
    this.G().startNet({ mode: 'client', seed: d.seed >>> 0, stage: d.stage | 0, myPid: s.pid, roster: d.roster, net: { send: (o2) => s.send(o2), leave: () => this.leave() } });
    this.enter(d.stage | 0);
    this.changed();
  };
  PP.enter = function (stage) { const A = ED.App; if (!this.game && A && A.enterRun) A.enterRun(stage | 0); };
  // Leaves the party (a host closes it for everyone). Safe when idle.
  PP.leave = function () {
    const s = this.sess, L = this.lobby;
    this.sess = null; this.tok = null;
    if (s) s.close();
    L.role = ''; L.code = ''; L.me = ''; L.status = 'idle'; L.error = ''; L.members = []; L.inRun = false;
    if (s) this.changed();
  };

  const party = N.party = new N.Party(null, N);
  N.host = (name, cls) => party.host(name, cls);
  N.join = (code, name, cls) => party.join(code, name, cls);
  N.setHero = (cls) => party.setHero(cls);
  N.setReady = (v) => party.setReady(v);
  N.setStage = (i) => party.setStage(i);
  N.start = (cheats, seed) => party.start(cheats, seed);
  N.leave = () => party.leave();
  N.lobby = party.lobby;
  N.onChange = null; N.onError = null; N.onClosed = null;
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('beforeunload', () => party.leave());
})(globalThis.ED || (globalThis.ED = {}));
