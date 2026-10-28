// App shell: boot, the screen state machine (boot -> title -> hero -> stage -> run -> results) and the frame loop (rAF; the sim steps at a fixed 60 Hz inside ED.Game.update).
// Bot watch (?bot=1 [&speed=N 1..16, default 4] [&seed=int] [&meta=none|max|profile, default profile]; solo runs only; meta as in
// tools/bot.js, so ?seed&meta replays a bench cell): boot loads tools/bot-brain.js (ED.Bot); a solo run gets ED.Game.bot, the sim runs N steps per real step within
// BOT_MS of work per frame, hit-stop and the offer overlay are skipped, sound effects thin out above x2, BracketLeft / BracketRight halve / double N, the HUD shows view.botTag /
// view.botPick, and the run is not applied to the profile. Without ?bot the normal path is unchanged.
(function (ED) {
  'use strict';
  const S = ED.Save;
  const $ = (id) => document.getElementById(id);
  const A = ED.App = { state: 'boot', profile: null, settings: null, hasProfile: false, sel: { cls: 'knight', stage: 0 }, lastT: 0 };
  const BOT_MS = 10; // bot watch: sim work budget per frame (ms); a slower machine runs below N instead of dropping frames
  const SEEN_DT = 0.25; // s between Encyclopedia discovery samples of the view (ED.Save.seenView)
  let seenRec = null, seenT = 0; // this run's discoveries (null on bot runs), merged into the profile at run end

  // ?bot params -> { speed, meta, seed, err, tag, pick, picks, rate } or null.
  A.bot = (() => {
    let q; try { q = new URLSearchParams(location.search); } catch (e) { return null; }
    if (!q.has('bot') || q.get('bot') === '0') return null;
    const sp = parseInt(q.get('speed'), 10), sd = parseInt(q.get('seed'), 10);
    return { speed: sp >= 1 ? Math.min(16, sp) : 4, meta: q.get('meta') || 'profile', seed: isFinite(sd) ? sd >>> 0 : undefined, err: '', tag: '', tagK: -1, pick: '', picks: 0, rate: 0 };
  })();
  const botSay = (text) => { const el = $('title-msg'); if (el) { el.textContent = text; el.classList.toggle('err', !!A.bot.err); } };
  const botHint = () => (A.bot.err ? 'Bot watch: ' + A.bot.err : 'Bot watch \u00d7' + A.bot.speed + ': pick a hero and stage, the bot plays ([ and ] change speed).');
  // Bot refused to start: back to the title with the reason.
  const botFail = (msg) => { A.bot.err = msg; ED.UI.renderTitle(); ED.UI.show('title'); botSay(botHint()); };

  A.inRun = () => A.state === 'run';
  A.persist = () => { A.storeOk = S.store(A.profile); };
  A.saveSel = () => { const s = A.settings; s.sel = { cls: A.sel.cls, stage: A.sel.stage }; S.storeSettings(s); };
  A.createProfile = (name) => { A.profile = S.defaultProfile(); A.profile.name = S.sanitizeName(name); ED.Meta.use(A.profile); A.hasProfile = true; A.persist(); };
  A.replaceProfile = (p) => { A.profile = S.normalize(p); ED.Meta.use(A.profile); A.hasProfile = true; A.persist(); };
  A.applySettings = () => {
    const s = A.settings;
    if (ED.Audio && ED.Audio.setVolumes) ED.Audio.setVolumes(s);
    ED.Render.setQuality(s.quality);
    ED.FX.numbers = s.numbers !== false;
    ED.FX.shakeOn = s.shake !== false;
    ED.Input.setBinds(s.binds);
  };

  // Starts a solo run with the selected hero and stage (seed from the clock: runs differ, the sim stays deterministic per seed).
  // Bot watch: refuses (title message) without ED.Bot or with an unknown ?meta.
  A.startSolo = (opt) => {
    opt = opt || {};
    const B = A.bot;
    if (B) {
      if (!ED.Bot) { botFail(B.err || 'tools/bot-brain.js has not loaded.'); return; }
      if (B.meta !== 'none' && B.meta !== 'max' && B.meta !== 'profile') { botFail('unknown meta "' + B.meta + '" (none, max or profile).'); return; }
    }
    const cls = opt.cls || A.sel.cls, stage = opt.stage !== undefined ? opt.stage : A.sel.stage;
    const seed = opt.seed !== undefined ? opt.seed : B && B.seed !== undefined ? B.seed : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const w = ED.Game.start({ mode: 'solo', seed, stage, players: [{ pid: 'p1', name: A.profile.name, slot: 0, cls, meta: B && B.meta !== 'profile' ? ED.Bot.metaFor(ED, B.meta) : S.metaBundle(A.profile) }], cheats: opt.cheats });
    if (B) {
      const p = w.hero('p1');
      let bot;
      try { bot = ED.Bot.create({ pid: 'p1', seed }); bot.onStart(w, p); }
      catch (e) { console.error(e); ED.Game.stop(); botFail('ED.Bot.create failed: ' + e.message); return; }
      ED.Game.bot = bot; B.err = ''; B.pick = ''; B.picks = 0; B.rate = B.speed; B.tagK = -1;
    }
    A.enterRun(stage);
  };
  // Switches the app into a run that ED.Game already holds (solo, or a co-op run built by ED.Net on every peer).
  A.enterRun = (stage) => {
    ED.Game.onEnd = (sum) => A.onRunEnd(sum);
    A.runStage = stage;
    seenRec = ED.Game.bot ? null : S.seenRun(); seenT = 0;
    A.state = 'run'; ED.UI.show('none'); ED.UI.offerSig = '';
    if (ED.Audio && ED.Audio.init) ED.Audio.init();
    ED.Input.mask();
  };
  A.onRunEnd = (sum) => {
    const botRun = !!ED.Game.bot;
    if (botRun && !sum.note) sum.note = 'Bot run: nothing was saved to the profile.';
    if (seenRec && !botRun) { seenSample(); S.mergeSeen(A.profile, seenRec); }
    seenRec = null;
    const gained = botRun ? null : S.applyRun(A.profile, sum, A.runStage, ED.Game.myPid);
    if (!botRun) A.persist();
    A.state = 'results';
    $('ov-offer').hidden = true; $('ov-pause').hidden = true;
    ED.UI.renderResults(sum, gained);
    ED.UI.show('results');
    ED.Game.stop();
  };
  A.quitRun = () => {
    A.togglePause(false);
    ED.Game.quit();
  };
  // Solo: pauses the sim. Co-op: opens the same menu (Resume / Settings / Leave) while the run goes on.
  A.togglePause = (v) => {
    if (A.state !== 'run') return;
    const coop = ED.Game.mode !== 'solo', el = $('ov-pause');
    const on = v === undefined ? (coop ? el.hidden : !ED.Game.paused) : v;
    if (!coop) ED.Game.paused = on;
    el.hidden = !on;
    el.querySelector('h2').textContent = coop ? 'Menu' : 'Paused';
    $('btn-quit').textContent = coop ? 'Leave run' : 'Quit run';
    ED.Input.mask();
  };

  // ---------------- frame loop ----------------
  // Records what the own view shows right now (camera rect of the last rendered frame) into this run's discoveries.
  const seenSample = () => { const R = ED.Render; if (seenRec && ED.Game.view) S.seenView(seenRec, ED.Game.view, R.camX, R.camY, R.bw, R.bh); };
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - A.lastT) / 1000));
    A.lastT = now;
    try {
      const inp = ED.Input.read();
      if (A.state === 'run' && ED.Game.active()) {
        const bot = ED.Game.bot;
        if (inp.esc) A.togglePause();
        if (bot) botStep(dt);
        else {
          if (!ED.Game.paused) ED.Game.control(inp);
          ED.Game.update(ED.FX.hold > 0 ? 0 : dt); // hit-stop (FX, solo only) holds the sim
        }
        if (!ED.Game.paused) ED.FX.update(dt);
        const v = ED.Game.view;
        if (v) {
          ED.Render.frame(v, dt);
          if (seenRec && (seenT -= dt) <= 0) { seenT = SEEN_DT; seenSample(); }
          ED.HUD.draw(ED.Render.ctx, v, dt);
          ED.UI.syncOffer(bot ? null : v.me, ED.Game.mode === 'solo');
          if (ED.Music) ED.Music.update(v, dt);
        }
        if (ED.Audio && ED.Audio.flush) ED.Audio.flush();
      } else if (A.state !== 'run') {
        const c = ED.Render.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0b0908'; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
        if (ED.Post && ED.Post.setVisible) ED.Post.setVisible(false);
      }
    } catch (e) { console.error(e); }
    ED.Input.endFrame();
    requestAnimationFrame(frame);
  }

  // Bot watch frame: speed keys, N x dt of sim within BOT_MS, no hit-stop, thin sound effects above x2; view.botTag 'BOT xN' (+ the reached rate when below 85% of N), view.botPick the last card.
  function botStep(dt) {
    const B = A.bot, G = ED.Game, I = ED.Input;
    if (I.pressed.has('BracketLeft')) B.speed = Math.max(1, B.speed >> 1);
    if (I.pressed.has('BracketRight')) B.speed = Math.min(16, B.speed << 1);
    G.sfxLite = B.speed > 2;
    const n = G.update(dt * B.speed, 8 * B.speed, BOT_MS);
    ED.FX.hold = 0;
    if (!G.paused && !(G.w && G.w.paused) && dt > 0) B.rate += (n * ED.CONST.TICK / dt - B.rate) * Math.min(1, dt * 2);
    const slow = B.rate < B.speed * 0.85, k = B.speed * 1000 + (slow ? Math.round(B.rate * 10) : 0);
    if (k !== B.tagK) { B.tagK = k; B.tag = 'BOT \u00d7' + B.speed + (slow ? '  (\u00d7' + B.rate.toFixed(1) + ')' : ''); }
    const v = G.view; if (v) { v.botTag = B.tag; v.botPick = B.pick; }
  }

  // Events the shell reacts to (warning / evolution / level banners are drawn by ED.FX). Bot watch: the local hero's picks name B.pick.
  const onEvent = () => {};
  const botEvent = (ev) => {
    if (ev.t !== 'pick' || ev.pid !== ED.Game.myPid) return;
    const B = A.bot, d = ED.WEAPONS[ev.id] || ED.PASSIVES[ev.id] || ED.SKILLS[ev.id], pa = ev.kind === 'path' && d && d.paths ? d.paths[ev.path] : null;
    B.picks++; B.pick = 'Picked ' + (pa ? d.name + ': ' + pa.name + ' ' + ev.lvl : d ? d.name + (ev.lvl ? ' ' + ev.lvl : '') : ev.kind);
  };

  A.boot = () => {
    A.settings = S.loadSettings();
    if (A.settings.sel) { A.sel.cls = ED.HEROES[A.settings.sel.cls] ? A.settings.sel.cls : 'knight'; A.sel.stage = A.settings.sel.stage | 0; }
    const p = S.load();
    A.profile = p || S.defaultProfile(); A.hasProfile = !!p; ED.Meta.use(A.profile);
    if (!S.stageUnlocked(A.profile, A.sel.stage)) A.sel.stage = 0;
    const canvas = $('game');
    ED.Input.init(canvas);
    ED.Render.init(canvas);
    ED.AimFx.applyCursor();
    A.applySettings();
    ED.Game.onEvent = A.bot ? botEvent : onEvent;
    if (A.bot) {
      const s = document.createElement('script');
      s.src = 'tools/bot-brain.js';
      s.onerror = () => { A.bot.err = 'tools/bot-brain.js did not load.'; s.remove(); if (A.state === 'title') botSay(botHint()); };
      document.head.appendChild(s);
    }
    ED.UI.bind();
    const unlock = () => { if (ED.Audio && ED.Audio.init) ED.Audio.init(); };
    window.addEventListener('pointerdown', unlock, { once: true }); window.addEventListener('keydown', unlock, { once: true });
    ED.Atlas.ready.then(() => {
      $('loading').hidden = true;
      A.state = 'title'; ED.UI.renderTitle(); ED.UI.show('title');
      if (A.bot) botSay(botHint());
    });
    A.lastT = performance.now();
    requestAnimationFrame(frame);
  };
  const go = () => { try { A.boot(); } catch (e) { console.error(e); const l = $('loading'); l.hidden = false; l.textContent = 'Something went wrong while loading: ' + e.message; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})(globalThis.ED || (globalThis.ED = {}));
