// App shell: boot, the screen state machine (title -> hearth -> lobby -> run -> results) and the frame loop.
(function (ED) {
  'use strict';
  const S = ED.Save, U = ED.U;
  const $ = (id) => document.getElementById(id);
  const A = ED.App = {
    state: 'boot', profile: null, settings: null, hasProfile: false, sel: { cls: 'knight', weapon: 'longsword', pact: 0 },
    pendingJoin: null, host: null, client: null, myPid: null, lobbyState: null, runCls: 'knight',
  };

  A.inRun = () => A.state === 'run';

  // ---------------- profile ----------------
  A.persist = () => { A.storeOk = S.store(A.profile); };
  A.loadSel = () => {
    const p = A.profile;
    let cls = p.sel && p.sel.cls && ED.CLASSES[p.sel.cls] && S.classUnlocked(p, p.sel.cls) ? p.sel.cls : 'knight';
    A.sel.cls = cls;
    A.sel.weapon = A.weaponFor(cls);
    A.sel.pact = Math.min((p.sel && p.sel.pact) | 0, p.pactMax);
  };
  A.weaponFor = (cls) => {
    const p = A.profile, ml = S.masteryLevel(p, cls), list = ED.CLASSES[cls].weapons;
    const saved = p.sel && p.sel.weapon && p.sel.weapon[cls];
    const idx = list.indexOf(saved);
    return idx >= 0 && ED.weaponUnlocked(cls, idx, ml) ? saved : list[0];
  };
  A.saveSel = () => {
    const p = A.profile;
    p.sel = p.sel || { weapon: {} };
    p.sel.cls = A.sel.cls; p.sel.weapon = Object.assign({}, p.sel.weapon, { [A.sel.cls]: A.sel.weapon }); p.sel.pact = A.sel.pact;
    A.persist();
  };
  A.selectClass = (id) => { A.sel.cls = id; A.sel.weapon = A.weaponFor(id); A.saveSel(); };

  A.createProfile = (name) => {
    A.profile = S.defaultProfile();
    A.profile.name = S.sanitizeName(name);
    A.hasProfile = true;
    A.persist();
    A.loadSel();
    A.goHome();
  };
  A.replaceProfile = (p) => { A.profile = S.normalize(p); A.hasProfile = true; A.persist(); A.loadSel(); ED.UI.renderHearth(); };
  // First visit on a new device: restore a save code straight from the title screen.
  A.importProfile = (p) => { A.profile = S.normalize(p); A.hasProfile = true; A.persist(); A.loadSel(); A.goHome(); ED.UI.toast('Welcome back, <b>' + UIe(A.profile.name) + '</b>. Your progress is restored.'); };
  A.resetProfile = () => { S.erase(); A.profile = S.defaultProfile(); A.hasProfile = false; A.loadSel(); A.state = 'title'; ED.UI.renderTitle(); ED.UI.show('title'); };
  A.afterMetaChange = () => {
    const deeds = S.checkDeeds(A.profile, null);
    for (const d of deeds) ED.UI.toast(`Deed earned: <b>${d.name}</b> (+${d.reward} embers)`, ED.Icons.url(d.icon, '#e6c27a'));
    A.persist();
    if (A.state === 'lobby') { ED.UI.renderPartyHearth(); A.lobbyPick(); } // the host gets the new meta bundle
    else ED.UI.renderHearth();
  };

  // Another tab of this browser saved the same profile: adopt it so neither tab overwrites the other's progress.
  // During a run the newest copy is re-read when the run's rewards are applied.
  A.syncProfile = () => {
    const p = S.load();
    if (!p) {
      if (A.hasProfile && A.state !== 'run') { A.hasProfile = false; A.profile = S.defaultProfile(); A.loadSel(); A.closeNet(); A.state = 'title'; ED.UI.renderTitle(); ED.UI.show('title'); }
      return;
    }
    A.profile = p; A.hasProfile = true;
    if (A.state === 'run') return;
    A.loadSel();
    if (A.state === 'hearth') ED.UI.renderHearth();
    else if (A.state === 'title') ED.UI.renderTitle();
    else if (A.state === 'lobby') { ED.UI.renderPartyHearth(); A.lobbyPick(); }
    if (A.state === 'hearth' || A.state === 'lobby') ED.UI.toast('Progress updated from another tab.');
  };

  // The main menu (state 'title'): Descend, Hearth, Heroes, Settings.
  A.goHome = () => {
    A.closeNet();
    A.state = 'title';
    $('ov-hearth').hidden = true;
    $('ov-credits').hidden = true;
    ED.UI.renderTitle();
    ED.UI.show('title');
    ED.UI.maybeNews();
    ED.Audio.music('camp');
  };

  // A menu section (state 'hearth'): 'descend', 'upgrades', 'relics', 'chronicle' or 'heroes'.
  A.enterHearth = (tab) => {
    if (!A.hasProfile) { A.goHome(); return; }
    A.closeNet();
    A.state = 'hearth';
    $('ov-hearth').hidden = true;
    $('ov-credits').hidden = true;
    $('scr-title').inert = false;
    ED.UI.show('hearth');
    ED.UI.setTab(tab || 'descend');
    ED.Audio.music('camp');
    if (A.pendingJoin && (!tab || tab === 'descend')) {
      $('join-row').hidden = false; $('inp-join').value = A.pendingJoin;
      const code = A.pendingJoin; A.pendingJoin = null;
      if (ED.Net.available()) A.joinParty(code);
    }
  };

  // ---------------- settings ----------------
  A.applySettings = () => {
    const s = A.settings;
    S.storeSettings(s);
    ED.Audio.setVolumes(s);
    if (ED.Render.quality !== s.quality) ED.Render.setQuality(s.quality);
    ED.FX.setQuality(s.quality);
  };

  // ---------------- solo ----------------
  A.startSolo = () => {
    const p = A.profile;
    const cfg = {
      localPid: 'solo', seed: (Math.random() * 4294967295) >>> 0, pact: A.sel.pact, tutorial: p.stats.runs < 2,
      players: [{ pid: 'solo', name: p.name, slot: 0, cls: A.sel.cls, weapon: A.sel.weapon, meta: S.metaBundle(p, A.sel.cls) }],
    };
    A.beginRun('solo', cfg);
  };

  A.beginRun = (mode, cfg) => {
    A.state = 'run';
    A.runMode = mode;
    const me = cfg.players.find(x => x.pid === cfg.localPid);
    A.runCls = me ? me.cls : A.sel.cls;
    ED.UI.hideScreens();
    for (const id of ['ov-boon', 'ov-sheet', 'ov-pause', 'ov-settings', 'ov-hearth', 'modal']) $(id).hidden = true;
    ED.Game.start(mode, cfg);
    ED.Audio.music({ s: 1 });
  };

  A.onRunEnd = (summary, note) => {
    if (A.state !== 'run') return;
    const myPid = ED.Game.s ? ED.Game.s.localPid : A.myPid;
    const mine = summary.players && summary.players[myPid];
    const hero = ED.Game.s && ED.Game.s.me; // the local hero's evolution, read before the session is dropped
    const myEvo = hero && hero.stats && hero.stats.evo ? { path: hero.stats.evo, weapon: hero.stats.weapon ? hero.stats.weapon.name : ED.WEAPONS[hero.weapon] ? ED.WEAPONS[hero.weapon].name : '' } : null;
    // Deeds are per hero: the party-wide summary fields are replaced by this hero's own (a client's partial summary has no hero entry: its relic count is the held one, revives 0); the party's evolution stays for the results line.
    const run = Object.assign({}, summary, { cls: A.runCls, emberBonus: mine ? mine.emberBonus : 0, myEvo, partyEvolved: !!summary.evolved,
      evolved: !!(myEvo || (mine && mine.evo)), maxRelics: mine ? mine.maxRelics | 0 : hero && hero.relics ? hero.relics.length : 0, revives: mine ? mine.revivesGiven | 0 : 0 });
    const latest = A.storeOk !== false && S.load(); // another tab may have saved meanwhile (trust storage only if our own writes land)
    if (latest) A.profile = latest;
    const res = S.applyRun(A.profile, run);
    A.persist();
    ED.Game.stop();
    A.state = 'results';
    for (const id of ['ov-boon', 'ov-sheet', 'ov-pause', 'ov-settings']) $(id).hidden = true;
    ED.UI.renderResults(run, res, note);
    $('btn-res-back').textContent = (A.host || (A.client && A.client.conn)) ? 'Back to the party' : 'Return to camp';
    $('btn-res-back').onclick = () => A.resultsBack();
    ED.UI.show('results');
    ED.Audio.music('camp');
    if (A.host) { A.host.started = false; for (const m of A.host.members) m.ready = m.isHost; A.host.broadcastLobby(); }
  };

  A.resultsBack = () => {
    if (A.host) { A.state = 'lobby'; ED.UI.show('lobby'); A.host.broadcastLobby(); return; }
    if (A.client && A.client.conn && !A.client.dead) { A.state = 'lobby'; ED.UI.show('lobby'); if (A.lobbyState) ED.UI.renderLobby(A.lobbyState, A.myPid, false); return; }
    A.goHome();
  };

  A.abandonRun = () => {
    const s = ED.Game.s; if (!s) return;
    $('ov-pause').hidden = true; s.paused = false;
    if (s.mode === 'client') {
      const partial = Object.assign(A.partialSummary(s), { abandoned: true });
      A.closeNet();
      A.onRunEnd(partial, 'You left the descent. Embers earned so far are yours.');
    } else { if (s.world.state === 'play') s.world.abandoned = true; s.world.endRun(false); }
  };

  A.partialSummary = (s) => {
    const m = s.mirror, run = m.run || { embers: { rooms: 0, elites: 0, bosses: 0, victory: 0 } };
    return Object.assign({ victory: false, stratum: m.stratum || 1, time: Math.round(m.time || 0), level: m.level, party: m.players.size, pact: m.pact, players: {} }, run, { embers: Object.assign({ rooms: 0, elites: 0, bosses: 0, victory: 0 }, run.embers || {}) });
  };

  A.togglePause = (v) => {
    const s = ED.Game.s; if (!s) return;
    const on = v === undefined ? $('ov-pause').hidden : v;
    $('ov-pause').hidden = !on;
    $('pause-note').textContent = ED.Game.alone() ? 'The Deep waits for you.' : 'Your party is still fighting. Pausing does not stop the descent.';
    s.paused = on || !$('ov-sheet').hidden;
  };

  // ---------------- multiplayer ----------------
  const meMsg = () => ({ name: A.profile.name, cls: A.sel.cls, weapon: A.sel.weapon, meta: S.metaBundle(A.profile, A.sel.cls), pactMax: A.profile.pactMax });

  A.inviteLink = () => {
    const code = A.host ? A.host.code : A.client ? A.client.code : '';
    const local = ED.Net.mode() === 'local' ? '&net=local' : '';
    return location.origin + location.pathname + '?join=' + code + local;
  };

  A.hostParty = () => {
    if (!ED.Net.available()) { ED.UI.toast('Multiplayer needs an internet connection.'); return; }
    A.closeNet();
    A.myPid = 'host';
    A.host = new ED.Net.Host(meMsg(), {
      status: (st, err) => ED.UI.lobbyStatus(st === 'open' ? 'Party open. Share the code or the invite link.' : err, st === 'error'),
      code: () => A.host.broadcastLobby(),
      lobby: (state) => { A.lobbyState = state; if (A.state === 'lobby') ED.UI.renderLobby(state, 'host', true); },
      joined: () => { ED.Audio.play('relic'); },
      left: (pid, name) => { if (A.state === 'run') { ED.Game.onPeerLeft(pid); } else ED.UI.toast(`${UIe(name)} left the party`); },
      data: (pid, d) => ED.Game.onHostData(pid, d),
    });
    A.host.pact = A.sel.pact;
    A.state = 'lobby';
    ED.UI.show('lobby');
    ED.UI.lobbyStatus('Opening party…');
    A.host.broadcastLobby();
  };
  const UIe = (s) => ED.UI.esc(s);

  A.joinParty = (raw) => {
    const code = ED.Net.cleanCode(raw);
    if (code.length !== 5) { ED.UI.toast('Party codes are 5 characters, like K7QX2.'); return; }
    if (!ED.Net.available()) { ED.UI.toast('Multiplayer needs an internet connection.'); return; }
    A.closeNet();
    A.state = 'lobby';
    ED.UI.show('lobby');
    $('lobby-code').textContent = code;
    $('lobby-members').innerHTML = '';
    ED.UI.lobbyStatus('Connecting to party ' + code + '…');
    const cl = A.client = new ED.Net.Client(code, meMsg(), {
      welcome: (d) => { A.myPid = d.pid; ED.UI.lobbyStatus('Connected. Pick your hero, then press Ready.'); ED.Audio.play('relic'); },
      lobby: (st) => { A.lobbyState = st; if (A.state === 'lobby') ED.UI.renderLobby(st, A.myPid, false); },
      error: (msg) => {
        if (cl.dead || A.client !== cl) return;
        ED.UI.toast(UIe(msg));
        A.closeNet();
        if (A.state === 'lobby') A.enterHearth();
      },
      closed: (msg) => {
        if (cl.dead || A.client !== cl) return; // we left on purpose, or this is an old party
        cl.dead = true; A.client = null;
        if (A.state === 'run' && ED.Game.s && !ED.Game.s.ended) A.onRunEnd(A.partialSummary(ED.Game.s), (msg || 'The host left the descent.') + ' Embers earned so far are yours.');
        else if (A.state === 'lobby') { ED.UI.toast(UIe(msg || 'The party closed.')); A.enterHearth(); }
        else if (A.state === 'results') ED.UI.toast(UIe(msg || 'The party closed.'));
      },
      data: (d) => {
        if (d.t === 'start') {
          A.beginRun('client', { localPid: A.myPid, players: d.players, seed: d.seed, pact: d.pact, net: cl });
        } else ED.Game.onClientData(d);
      },
    });
  };

  A.lobbyPick = () => {
    if (A.host) A.host.setMe({ cls: A.sel.cls, weapon: A.sel.weapon, meta: S.metaBundle(A.profile, A.sel.cls) });
    else if (A.client) A.client.send({ t: 'pick', cls: A.sel.cls, weapon: A.sel.weapon, meta: S.metaBundle(A.profile, A.sel.cls) });
    if (A.lobbyState) ED.UI.renderLobby(A.lobbyState, A.myPid, !!A.host);
  };
  A.setLobbyPact = (v) => {
    if (!A.host) return;
    const pact = U.clamp(v | 0, 0, A.profile.pactMax);
    if (pact !== A.host.pact) for (const m of A.host.members) m.ready = m.isHost; // friends re-confirm a new pact
    A.host.pact = pact; A.host.broadcastLobby();
  };

  A.lobbyGo = () => {
    if (A.host) {
      if (!A.host.allReady()) return;
      const seed = (Math.random() * 4294967295) >>> 0;
      const players = A.host.members.map(m => ({ pid: m.pid, name: m.name, slot: m.slot, cls: m.cls, weapon: m.weapon, meta: m.meta }));
      A.host.started = true;
      const pact = A.host.pact;
      A.host.broadcast({ t: 'start', seed, pact, players });
      const fresh = A.profile.stats.runs < 2 && players.length === 1;
      A.beginRun('host', { localPid: 'host', players, seed, pact, net: A.host, tutorial: fresh });
    } else if (A.client && A.lobbyState) {
      const me = A.lobbyState.members.find(m => m.pid === A.myPid);
      A.client.send({ t: 'ready', v: !(me && me.ready) });
    }
  };

  A.leaveLobby = () => { A.closeNet(); A.enterHearth(); };
  A.closeNet = () => {
    if (A.host) { A.host.close(); A.host = null; }
    if (A.client) { const c = A.client; A.client = null; c.dead = true; c.close(); }
    A.lobbyState = null;
  };

  // ---------------- loop ----------------
  // Frame pacing. A browser that misses vsync alternates frame times (4 / 8 / 12 ms on a 240 Hz panel), which reads as judder. settings.frameCap decides what the loop does:
  // 'auto' (default) measures the vsync interval and the share of rAF intervals longer than one vsync, and presents every n-th rAF (n = 2: 120 fps on 240 Hz) while frames keep missing;
  // 'off' presents every rAF; '144' / '120' / '60' present every n-th rAF with the smallest n that keeps the rate at or below the cap (display rate / n). dt is smoothed to n vsync intervals whenever it lands within 10% of them.
  const Pace = A.pace = { vs: 0, n: 1, miss: 0, cap: 'auto', hz: 0, work: 0 };
  const RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
  const PD = new Float32Array(240); let pdI = 0, pdN = 0, pTick = 0, lastRaf = 0, pHold = performance.now() + 3000, pRetry = 0, pTrial = 0, pBad = 0, pEval = 0, pBack = 30000, dtErr = 0;
  function pObserve(ms, now) {
    if (!(ms > 1) || ms > 100) return;
    PD[pdI] = ms; pdI = (pdI + 1) % 240; if (pdN < 240) pdN++;
    if (pdN < 90 || now - pEval < 1000) return;
    pEval = now;
    const s = Array.from(PD.subarray(0, pdN)).sort((a, b) => a - b), base = s[Math.floor(pdN * 0.15)];
    let sum = 0, cnt = 0;
    for (let i = 0; i < pdN; i++) { const k = Math.max(1, Math.round(PD[i] / base)); if (Math.abs(PD[i] / k - base) < 0.25 * base) { sum += PD[i]; cnt += k; } }
    let vs = cnt ? sum / cnt : base;
    for (const r of RATES) if (Math.abs(vs * r - 1000) < 40) { vs = 1000 / r; break; } // snap to a known refresh rate: no drift from timer-precision noise
    Pace.vs = vs; Pace.hz = Math.round(1000 / vs);
    let m = 0; for (let i = 0; i < pdN; i++) if (PD[i] > 1.5 * vs) m++;
    Pace.miss = m / pdN;
    pAdapt(now);
  }
  function pSetN(n, now) { Pace.n = n; pdN = 0; pdI = 0; pTick = 0; pBad = 0; pHold = now + 2500; }
  function pAdapt(now) {
    const cap = (A.settings && A.settings.frameCap) || 'auto', vs = Pace.vs;
    if (cap !== Pace.cap) { Pace.cap = cap; pTrial = 0; pBad = 0; }
    if (cap === 'off') { if (Pace.n !== 1) pSetN(1, now); return; }
    if (cap !== 'auto') { const n = Math.max(1, Math.ceil(1000 / vs / (+cap || 60) - 0.05)); if (n !== Pace.n) pSetN(n, now); return; }
    if (now < pHold) return;
    const maxN = Math.max(1, Math.floor(1000 / vs / 72)); // never below ~72 fps
    if (pTrial) { // the faster cadence was just tried: keep it unless it misses again
      if (Pace.miss > 0.1) { const n = pTrial; pTrial = 0; pSetN(n, now); pBack = Math.min(480000, pBack * 2); pRetry = now + pBack; } else { pTrial = 0; pBack = 30000; } // a failed trial doubles the wait for the next one
    } else if (Pace.n < maxN && vs < 9.5 && Pace.miss > 0.2) { // frames keep missing vsync (three evaluations in a row): present every n+1-th rAF
      if (++pBad >= 3) { pSetN(Pace.n + 1, now); pRetry = now + pBack; }
    } else {
      pBad = 0;
      if (Pace.n > 1 && now > pRetry) { pTrial = Pace.n; pSetN(Pace.n - 1, now); } // try the faster cadence again now and then
    }
  }

  let last = performance.now(), hiddenTick = null, sheetFrames = 0, drawnW = 0, drawnH = 0;
  const anyOverlay = () => ['ov-pause', 'ov-settings', 'modal', 'ov-sheet'].some(id => !$(id).hidden); // the boon cards are no blocker: a hero keeps moving under them (UI.pickBoon masks the attack keys itself)
  const EMPTY = { mx: 0, my: 0, atk: false, skill: false, dash: false, atkPressed: false };
  function frame(now) {
    requestAnimationFrame(frame);
    pObserve(now - lastRaf, now); lastRaf = now;
    if (Pace.n > 1 && (++pTick % Pace.n) !== 0) return; // paced: this rAF is not presented
    let dt = (now - last) / 1000;
    const ideal = Pace.n * Pace.vs / 1000;
    if (Pace.vs && Math.abs(dt - ideal) < 0.1 * ideal) { const d = ideal - dtErr * 0.25; dtErr += d - dt; dt = d; } else dtErr = 0; // steady cadence: the vsync interval, drift pulled back toward real time
    dt = Math.min(0.05, dt);
    last = now;
    const t = now / 1000;
    const w0 = performance.now();
    const inp = ED.Input.read();
    if (A.state === 'run' && ED.Game.s) {
      const s = ED.Game.s, sheet = $('ov-sheet'), sheetWas = !sheet.hidden, openBefore = anyOverlay();
      if (inp.esc) {
        if (!$('ov-settings').hidden) $('ov-settings').hidden = true;
        else if (!$('modal').hidden) $('modal').hidden = true;
        else if (!sheet.hidden) ED.UI.toggleSheet(false);
        else A.togglePause();
      }
      if (inp.tab) ED.UI.toggleSheet(); // also during a boon offer: the sheet stacks above the cards
      if (!sheet.hidden) { ED.UI.sheetNav(inp, dt); ED.UI.sheetTick(dt); }
      s.paused = !$('ov-pause').hidden || !sheet.hidden;
      const blocked = sheetWas || !$('ov-pause').hidden || !$('ov-settings').hidden || !$('modal').hidden || !sheet.hidden;
      ED.Game.update(dt, blocked ? EMPTY : inp);
      if (ED.Game.s) {
        // under the sheet the world is paused (solo: no redraw, the canvases keep the last frame) or drawn every 3rd frame (party); a resize clears the canvases and redraws once
        const R = ED.Render, shot = R.W !== drawnW || R.H !== drawnH;
        if (sheet.hidden || shot || (!ED.Game.alone() && ++sheetFrames % 3 === 0)) { ED.Game.render(t, dt); drawnW = R.W; drawnH = R.H; }
      }
      if (openBefore && !anyOverlay()) ED.Input.mask(); // a closing overlay must not pass the press that closed it (or a held attack) to the game
    } else {
      ED.HUD.clear();
      ED.Camp.draw(ED.Render.ctx, A.profile, t, dt, A.state === 'hearth' || A.state === 'lobby' || (A.state === 'title' && A.hasProfile) ? A.sel.cls : null);
    }
    ED.Input.endFrame();
    Pace.work += (performance.now() - w0 - Pace.work) * 0.05;
  }

  // Keep a hosted world ticking while its tab is in the background (rAF stops there).
  function startHiddenTicker() {
    try {
      const src = 'let id=null;onmessage=e=>{clearInterval(id);if(e.data)id=setInterval(()=>postMessage(0),33)}';
      const wk = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      let prev = performance.now();
      wk.onmessage = () => {
        const now = performance.now(), dt = Math.min(0.1, (now - prev) / 1000); prev = now;
        if (document.hidden && A.state === 'run' && ED.Game.s && ED.Game.s.mode === 'host') ED.Game.update(dt, EMPTY);
      };
      document.addEventListener('visibilitychange', () => { prev = performance.now(); wk.postMessage(document.hidden ? 1 : 0); });
      hiddenTick = wk;
    } catch (e) { /* workers unavailable: host simply pauses while hidden */ }
  }

  A.boot = () => {
    const canvas = $('game');
    ED.Input.init(canvas);
    ED.Render.init(canvas);
    A.settings = S.loadSettings();
    ED.Input.setBinds(A.settings.binds);
    ED.Render.setQuality(A.settings.quality);
    ED.FX.setQuality(A.settings.quality);
    const p = S.load();
    A.hasProfile = !!p;
    A.profile = p || S.defaultProfile();
    A.loadSel();
    try { const j = new URLSearchParams(location.search).get('join'); if (j) A.pendingJoin = ED.Net.cleanCode(j); } catch (e) { /* no query */ }
    ED.UI.init();
    // Browsers only allow audio after a gesture. The first one starts the score; later ones just resume a suspended context.
    const unlock = () => {
      const first = !ED.Audio.ctx;
      ED.Audio.init();
      if (first && ED.Audio.ready) { ED.Audio.setVolumes(A.settings); ED.Audio.music(ED.Audio.track || 'camp'); }
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('storage', (e) => { if (e.key === S.KEY) A.syncProfile(); });
    A.state = 'title';
    ED.UI.renderTitle();
    ED.UI.show('title');
    ED.UI.maybeNews();
    if (!A.hasProfile) setTimeout(() => $('inp-name').focus(), 50);
    startHiddenTicker();
    // The first frame waits for the atlas pages to decode (3 s at most); the menus are DOM and already usable.
    const go1 = () => requestAnimationFrame((n) => { last = lastRaf = n; frame(n); });
    if (ED.Atlas && ED.Atlas.ready) Promise.race([ED.Atlas.ready, new Promise((r) => setTimeout(r, 3000))]).then(go1, go1); else go1();
    // test hook for automated checks
    window.__ED = ED;
  };

  const go = () => { try { A.boot(); } catch (e) { console.error(e); const l = $('loading'); l.hidden = false; l.textContent = 'Something went wrong while loading: ' + e.message; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})(globalThis.ED || (globalThis.ED = {}));
