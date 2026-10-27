// App shell: boot, the screen state machine (boot -> title -> hero -> stage -> run -> results) and the frame loop (rAF; the sim steps at a fixed 60 Hz inside ED.Game.update).
(function (ED) {
  'use strict';
  const S = ED.Save;
  const $ = (id) => document.getElementById(id);
  const A = ED.App = { state: 'boot', profile: null, settings: null, hasProfile: false, sel: { cls: 'knight', stage: 0 }, lastT: 0 };

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
  A.startSolo = (opt) => {
    opt = opt || {};
    const cls = opt.cls || A.sel.cls, stage = opt.stage !== undefined ? opt.stage : A.sel.stage;
    const seed = opt.seed !== undefined ? opt.seed : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    ED.Game.start({ mode: 'solo', seed, stage, players: [{ pid: 'p1', name: A.profile.name, slot: 0, cls, meta: S.metaBundle(A.profile) }], cheats: opt.cheats });
    A.enterRun(stage);
  };
  // Switches the app into a run that ED.Game already holds (solo, or a co-op run built by ED.Net on every peer).
  A.enterRun = (stage) => {
    ED.Game.onEnd = (sum) => A.onRunEnd(sum);
    A.runStage = stage;
    A.state = 'run'; ED.UI.show('none'); ED.UI.offerSig = '';
    if (ED.Audio && ED.Audio.init) ED.Audio.init();
    ED.Input.mask();
  };
  A.onRunEnd = (sum) => {
    const gained = S.applyRun(A.profile, sum, A.runStage, ED.Game.myPid);
    A.persist();
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
  A.togglePause = (v) => {
    if (A.state !== 'run') return;
    const on = v === undefined ? !ED.Game.paused : v;
    if (ED.Game.mode !== 'solo' && on) return; // co-op never pauses
    ED.Game.paused = on; $('ov-pause').hidden = !on;
    ED.Input.mask();
  };

  // ---------------- frame loop ----------------
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - A.lastT) / 1000));
    A.lastT = now;
    try {
      const inp = ED.Input.read();
      if (A.state === 'run' && ED.Game.active()) {
        if (inp.esc) A.togglePause();
        if (!ED.Game.paused) ED.Game.control(inp);
        ED.Game.update(ED.FX.hold > 0 ? 0 : dt); // hit-stop (FX, solo only) holds the sim
        if (!ED.Game.paused) ED.FX.update(dt);
        const v = ED.Game.view;
        if (v) {
          ED.Render.frame(v, dt);
          ED.HUD.draw(ED.Render.ctx, v, dt);
          ED.UI.syncOffer(v.me, ED.Game.mode === 'solo');
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

  // Events the shell reacts to (warning / evolution / level banners are drawn by ED.FX).
  const onEvent = () => {};

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
    ED.Game.onEvent = onEvent;
    ED.UI.bind();
    const unlock = () => { if (ED.Audio && ED.Audio.init) ED.Audio.init(); };
    window.addEventListener('pointerdown', unlock, { once: true }); window.addEventListener('keydown', unlock, { once: true });
    ED.Atlas.ready.then(() => {
      $('loading').hidden = true;
      A.state = 'title'; ED.UI.renderTitle(); ED.UI.show('title');
    });
    A.lastT = performance.now();
    requestAnimationFrame(frame);
  };
  const go = () => { try { A.boot(); } catch (e) { console.error(e); const l = $('loading'); l.hidden = false; l.textContent = 'Something went wrong while loading: ' + e.message; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})(globalThis.ED || (globalThis.ED = {}));
