// DOM screens (client only): title, hero select, stage select, Camp shop (+ save code), join, lobby, results; achievements and encyclopedia are filled by codex.js (ED.Codex),
//   the Wardrobe by wardrobe.js (ED.Wardrobe); hero portraits wear the profile's skin (lobby: each member's);
//   overlays: level-up cards, chest popup, pause, settings, credits.
// Text: English sources through ED.t (T, templates) and ED.tr (L, registry and sim strings); player names carry translate="no". relang() re-renders the visible screen.
// ED.UI.show(name) shows one screen ('title' | 'hero' | 'stage' | 'camp' | 'wardrobe' | 'achieve' | 'codex' | 'join' | 'lobby' | 'results' | 'none'); overlays toggle separately.
// Menus work with mouse and keyboard: arrows / WASD move focus spatially inside the top layer, Enter / Space press, Esc presses the layer's [data-back] button.
//   A focused [data-scroll] box (a stop only while it overflows) scrolls on up / down until its edge, then focus moves on.
// Shop and unlock rules go through ED.Save with A.profile. Co-op goes through the ED.Net lobby API (host / join / setHero / setReady / setStage / start / leave, ED.Net.onChange).
(function (ED) {
  'use strict';
  const U = ED.U, T = ED.t, L = ED.tr;
  const $ = (id) => document.getElementById(id);
  const UI = ED.UI = { offerSig: '', lastMode: 'solo', banishOn: false };
  const SCREENS = ['title', 'hero', 'stage', 'camp', 'wardrobe', 'achieve', 'codex', 'join', 'lobby', 'results'];
  const LAYERS = ['ov-settings', 'ov-credits', 'ov-pause', 'ov-offer']; // top-most first
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  UI.esc = esc;
  const App = () => ED.App;

  // ---------------- meta adapter ----------------
  // Profile-explicit shop / unlock rules (ED.Save); ED.Meta shares the same profile object (main.js ED.Meta.use), the caller persists.
  const SV = ED.Save;
  const M = {
    rank: (p, id) => SV.rank(p, id),
    cost: (p, id) => SV.shopCost(p, id),
    buy: (p, id) => SV.buy(p, id),
    refundTotal: (p) => SV.refundTotal(p),
    refundAll: (p) => SV.refundAll(p),
    heroOpen: (p, cls) => SV.heroUnlocked(p, cls),
    stageOpen: (p, i) => SV.stageUnlocked(p, i),
    stageHidden: (p, i) => SV.stageHidden(p, i),
    heroCost: (p, cls) => SV.heroCost(p, cls),
    buyHero: (p, cls) => SV.buyHero(p, cls),
    evalAch: (p) => SV.evalAch(p),
  };
  UI.M = M;
  // Progress toward an ED.UNLOCKS rule: { k (0..1), txt ('' for beat / pure rules) } from the records ED.Save.applyRun checks (p.stats bestTime / bestKills / bestLevel) or gold for buy rules.
  const unlockProgress = UI.unlockProgress = (p, rule) => {
    if (!rule) return { k: 0, txt: '' };
    const st = p.stats, of = (cur, need, f) => ({ k: U.clamp(cur / need, 0, 1), txt: f(Math.min(cur, need)) + ' / ' + f(need) });
    if (rule.survive) return of(st.bestTime, rule.survive, U.fmtTime);
    if (rule.buy) return { k: U.clamp(p.gold / rule.buy, 0, 1), txt: T('{0} / {1} gold', Math.min(p.gold, rule.buy), rule.buy) };
    if (rule.kills) return of(st.bestKills, rule.kills, String);
    if (rule.level) return { k: U.clamp(st.bestLevel / rule.level, 0, 1), txt: T('Level {0} / {1}', Math.min(st.bestLevel, rule.level), rule.level) };
    if (rule.beat !== undefined) return { k: p.beat.indexOf(rule.beat) >= 0 ? 1 : 0, txt: '' };
    if (rule.pure) return { k: p.pure.length ? 1 : 0, txt: SV.campRanks(p) ? T('Camp ranks owned: {0} (Refund all at Camp)', SV.campRanks(p)) : T('No Camp ranks owned') };
    return { k: 0, txt: '' };
  };
  // Earns achievements the profile now meets (records from before they existed, Camp purchases), saves, and returns their news entries.
  UI.evalAch = () => { const A = App(), n = M.evalAch(A.profile); if (n.length) A.persist(); return n; };
  // Display line of a cosmetic (its name and kind noun), and of an ED.Save news entry (achievements rebuilt from id / gold / reward; hero / stage lines translated whole).
  const COS_LBL = { skin: (n) => T('{0} skin', n), tint: (n) => T('{0} weapon tint', n), kill: (n) => T('{0} kill effect', n), lvl: (n) => T('{0} level-up effect', n), title: (n) => T('{0} title', n), ncol: (n) => T('{0} name colour', n) };
  UI.cosLabel = (d) => (COS_LBL[d.kind] ? COS_LBL[d.kind](L(d.name)) : L(d.name));
  UI.rewardTxt = (gold, rid, sep) => { const rd = rid && ED.COS_BY ? ED.COS_BY[rid] : null; return [gold ? T('+{0} gold', gold) : '', rd ? UI.cosLabel(rd) : ''].filter(Boolean).join(sep || ', '); };
  UI.newsTxt = (n) => {
    if (n.kind !== 'ach') return L(n.txt);
    const rw = UI.rewardTxt(n.gold, n.reward);
    return rw ? T('Achievement: {0} ({1})', L(n.name), rw) : T('Achievement: {0}', L(n.name));
  };

  // ---------------- atlas icons ----------------
  // Draws frame i of anim id fitted into canvas cv (integer scale fixed by frame 0, so animated frames never jump); vk: Atlas variant key (skins, recolours).
  const VO = { variant: '' };
  const paint = UI.paint = (cv, id, i, vk) => {
    const A = ED.Atlas, g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (!A || !A.ok || !id) return;
    const r = A.anim(id); if (!r) return;
    const f = r.f[0], size = Math.min(cv.width, cv.height), s = Math.max(1, Math.floor(size / Math.max(f.w, f.h)));
    g.imageSmoothingEnabled = false;
    g.save(); g.translate(Math.round(cv.width / 2 - (f.ox + f.w / 2 - r.ax) * s), Math.round(cv.height / 2 - (f.oy + f.h / 2 - r.ay) * s)); g.scale(s, s);
    VO.variant = vk || ''; A.draw(g, id, i | 0, 0, 0, VO); g.restore();
  };
  UI.iconCanvas = (id, size, cls, vk) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = size; cv.className = 'icon' + (cls ? ' ' + cls : '');
    cv._var = vk || '';
    paint(cv, id, 0, cv._var);
    return cv;
  };
  // Animated portraits: redrawn by one rAF loop while a menu shows them.
  const anims = [];
  let animOn = false;
  const animCanvas = UI.animCanvas = (id, size, cls, vk) => { const cv = UI.iconCanvas(id, size, cls, vk); cv._anim = id; cv._f = 0; anims.push(cv); kick(); return cv; };
  const kick = () => { if (!animOn) { animOn = true; requestAnimationFrame(animLoop); } };
  // Registers a canvas whose cv._scene(t) the loop calls while it is visible (title art, stage cards).
  UI.addScene = (cv) => { if (anims.indexOf(cv) < 0) anims.push(cv); kick(); };
  function animLoop(now) {
    const A = ED.Atlas, t = now / 1000;
    for (let i = anims.length - 1; i >= 0; i--) {
      const cv = anims[i];
      if (!cv.isConnected) { anims.splice(i, 1); continue; }
      if (!A || !A.ok || cv.offsetParent === null) continue;
      if (cv._scene) { cv._scene(t); continue; }
      const f = A.frameAt(cv._anim, t + (cv._off || 0));
      if (f !== cv._f) { cv._f = f; paint(cv, cv._anim, f, cv._var); }
    }
    if (anims.length && !(App() && App().state === 'run')) requestAnimationFrame(animLoop); else animOn = false;
  }
  const heroIcon = UI.heroIcon = (cls) => (ED.HEROES[cls] && ED.HEROES[cls].icon) || 'hero.' + cls + '.idle';
  // Variant key of hero cls's portrait in skin id (default: the profile's worn skin; '' = the default look).
  const heroVar = UI.heroVar = (cls, skin) => { const p = App() && App().profile; if (skin === undefined) skin = p && p.wear ? SV.worn(p, 'skin', cls) : ''; return skin && ED.Cos ? ED.Cos.skinVar(heroIcon(cls), skin) : ''; };
  const keyOf = UI.keyOf = (action, dflt) => { const I = ED.Input, l = I && I.labels ? I.labels(action) : null; return (l && l[0]) || dflt; };

  // ---------------- screens ----------------
  UI.show = (name) => {
    for (const s of SCREENS) { const el = $('scr-' + s); if (el) el.hidden = s !== name; }
    $('ui').classList.toggle('in-run', name === 'none');
    if (name === 'none') {
      const A = App();
      UI.lastMode = ED.Game.mode || 'solo';
      $('ov-settings').hidden = true; $('ov-credits').hidden = true; hideChest(true);
      return;
    }
    kick();
    focusLayer();
  };
  const ensureProfile = () => { const A = App(); if (!A.hasProfile) A.createProfile($('inp-name').value); };
  // Title name field commit (Enter, change): renames and saves the profile (blank -> 'Wanderer'); before the first profile a non-blank name creates it. No re-render, so a
  // button clicked right after typing stays under the pointer.
  const commitName = () => {
    const A = App(), el = $('inp-name');
    if (!A.hasProfile) { if (!el.value.trim()) return; A.createProfile(el.value); }
    else { const n = SV.sanitizeName(el.value); if (n !== A.profile.name) { A.profile.name = n; A.persist(); } }
    el.value = A.profile.name;
  };
  // Status line: text is a string or a function returning it (kept and re-run on a language change).
  const say = (id, text, err) => { const el = $(id); el._say = typeof text === 'function' ? text : null; el.textContent = (el._say ? el._say() : text) || ''; el.classList.toggle('err', !!err); };
  UI.say = say;

  // ---------------- title ----------------
  UI.renderTitle = () => {
    const A = App(), p = A.profile;
    const nf = $('inp-name');
    if (A.hasProfile && document.activeElement !== nf) nf.value = p.name;
    const pl = $('profile-line');
    pl.innerHTML = A.hasProfile ? `<span>${T('{0} gold', `<b>${p.gold}</b>`)}</span><span>${T('{0} runs', `<b>${p.stats.runs}</b>`)}</span><span>${T('{0} wins', `<b>${p.stats.wins}</b>`)}</span>` : '';
    if (ED.Title) ED.Title.mount();
    const ok = netOk();
    $('btn-host').disabled = !ok; $('btn-join').disabled = !ok;
  };

  // ---------------- hero select ----------------
  // Roster tiles (locked: silhouette + the rule's short line); picking a tile only moves the selection (markHero), so focus and hover stay put.
  UI.renderHeroes = () => {
    const A = App(), list = $('hero-list');
    list.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const h = ED.HEROES[cls]; if (!h) continue;
      const open = M.heroOpen(A.profile, cls), rule = ED.UNLOCKS.heroes[cls] || {};
      const b = document.createElement('button');
      b.className = 'hero-tile' + (open ? '' : ' locked');
      b.setAttribute('role', 'radio'); b.dataset.cls = cls; b.style.setProperty('--hc', h.col || '#ff8a3d');
      b.appendChild(animCanvas(heroIcon(cls), 96, '', heroVar(cls)));
      b.insertAdjacentHTML('beforeend', `<span class="t-name">${esc(L(h.name))}</span>` + (open ? '' : `<span class="lock-ico"></span><span class="t-lock">${esc(L(rule.short || rule.txt || ''))}</span>`));
      b.setAttribute('aria-label', open ? L(h.name) : T('{0}, locked: {1}', L(h.name), L(rule.txt || '')));
      b.onclick = (e) => {
        if (A.sel.cls === cls && open && e.detail === 0) { $('btn-hero-next').click(); return; } // Enter on the chosen hero continues
        A.sel.cls = cls; A.saveSel(); markHero(); b.focus();
      };
      b.ondblclick = () => { if (open) $('btn-hero-next').click(); };
      list.appendChild(b);
    }
    markHero();
  };
  function markHero() {
    const A = App();
    for (const t of $('hero-list').children) { const on = t.dataset.cls === A.sel.cls; t.classList.toggle('on', on); t.setAttribute('aria-checked', on ? 'true' : 'false'); }
    renderHeroDetail();
  }
  const kitRow = (icon, key, name, txt) => {
    const d = document.createElement('div'); d.className = 'kit';
    d.appendChild(UI.iconCanvas(icon, 48));
    d.insertAdjacentHTML('beforeend', `<b>${key ? `<span class="key">${esc(key)}</span>` : ''}${esc(L(name))}</b><span>${esc(L(txt || ''))}</span>`);
    return d;
  };
  const meterRow = (label, k, col, val) => `<span>${esc(label)}</span><span class="meter"><i style="width:${(U.clamp(k, 0, 1) * 100).toFixed(0)}%;background:${col}"></i></span><b>${esc(val)}</b>`;
  // Detail plate: portrait column (bobbing idle sprite, records), identity column (role, name, line, HP / Speed / Crit), kit column (weapon, Q, the weapon's 3 paths
  //   by name and rank-1 line; Form names stay hidden). Locked: the kit column becomes the unlock panel (rule, progress, buy button).
  function renderHeroDetail() {
    const A = App(), p = A.profile, cls = A.sel.cls, h = ED.HEROES[cls], box = $('hero-detail');
    box.textContent = '';
    if (!h) return;
    const open = M.heroOpen(p, cls), rule = ED.UNLOCKS.heroes[cls] || {};
    box.classList.toggle('locked', !open); box.style.setProperty('--hc', h.col || '#ff8a3d');
    const pt = document.createElement('div'); pt.className = 'hd-portrait';
    const big = animCanvas(heroIcon(cls), 192, 'big', heroVar(cls)); big._off = 0.3; pt.appendChild(big);
    if (open) {
      const rec = (p.won.indexOf(cls) >= 0 ? `<span class="rtag ok">${T('Won a run')}</span>` : '') + (p.formed.indexOf(cls) >= 0 ? `<span class="rtag form">${T('Reached a Form')}</span>` : '');
      if (rec) pt.insertAdjacentHTML('beforeend', `<div class="hd-recs">${rec}</div>`);
    }
    box.appendChild(pt);
    const head = document.createElement('div'); head.className = 'hd-head';
    head.innerHTML = `<span class="hd-role">${esc(L(h.role || ''))}</span><span class="hd-name">${esc(L(h.name))}</span><span class="hd-txt">${esc(L(h.txt || ''))}</span>` +
      (open ? '<div class="hd-stats">' + meterRow(T('HP'), h.hp / 130, 'var(--red)', h.hp) + meterRow(T('Speed'), U.clamp((h.speed - 70) / 30, 0.1, 1), 'var(--blue)', h.speed) +
        meterRow(T('Crit'), (h.crit || 0) / 0.15, 'var(--gold)', Math.round((h.crit || 0) * 100) + '%') + '</div>' : '');
    box.appendChild(head);
    if (open) {
      const kit = document.createElement('div'); kit.className = 'hd-kit';
      const sig = ED.WEAPONS[h.sig], q = ED.SKILLS[h.skills[0]];
      if (sig) kit.appendChild(kitRow(sig.icon, '', sig.name, sig.txt));
      if (q) kit.appendChild(kitRow(q.icon, keyOf('skill1', 'Q'), q.name, q.txt));
      if (sig && sig.paths && sig.paths.length) {
        const ps = document.createElement('div'); ps.className = 'hd-paths';
        ps.innerHTML = `<div class="hd-ph">${T('Paths')}</div>` +
          sig.paths.map(pa => `<div class="path"><b>${esc(L(pa.name))}</b><span>${esc(L(pa.ranks && pa.ranks[0] ? pa.ranks[0].txt : ''))}</span></div>`).join('');
        kit.appendChild(ps);
      }
      box.appendChild(kit);
    } else {
      const pr = unlockProgress(p, rule), lk = document.createElement('div'); lk.className = 'lock-box';
      lk.innerHTML = `<div class="lk-head"><span class="lock-ico"></span><span class="lk-title">${T('Locked')}</span></div>` + `<span class="lk-rule">${esc(rule.txt ? L(rule.txt) : T('Not yet available'))}</span>` +
        (pr.txt ? `<span class="lk-prog"><span class="meter"><i style="width:${(U.clamp(pr.k, 0, 1) * 100).toFixed(0)}%"></i></span><span class="mut">${esc(pr.txt)}</span></span>` : '');
      const cost = M.heroCost(p, cls);
      if (cost) {
        const b = document.createElement('button'); b.className = 'btn btn-sm'; b.id = 'btn-hero-buy';
        b.textContent = T('Unlock for {0} gold', cost); b.disabled = p.gold < cost;
        b.onclick = () => { if (M.buyHero(p, cls)) { UI.evalAch(); A.persist(); UI.renderHeroes(); $('btn-hero-next').focus(); } };
        lk.appendChild(b);
      }
      box.appendChild(lk);
    }
    const nx = $('btn-hero-next');
    nx.disabled = !open; nx.textContent = open ? T('Next') : T('Locked');
  }

  // ---------------- stage select ----------------
  // Stage scene (no bosses): floor tiles and deco (cached per stage, SCENE_W x SCENE_H art px, cropped centred), a ring of the stage's roster foes idling
  //   around an accent-coloured light pool, then a dark vignette. Drawn at integer scales only.
  const SCENE_W = 320, SCENE_H = 192;
  const sceneBg = new Map(), sceneFoes = new Map();
  // Foe slots: [x, y] as fractions of the scene, flip (faces left); the 5th slot (back centre) holds the brute.
  const SLOTS = [[0.25, 0.62, 0], [0.38, 0.84, 0], [0.64, 0.82, 1], [0.76, 0.6, 1], [0.5, 0.46, 0]];
  const FLIP = { flip: true }, NOFLIP = { flip: false };
  const foeAnim = (id) => { const A = ED.Atlas, look = ED.FOES[id] ? ED.FOES[id].look : ''; for (const s of ['.idle', '.walk', '.walk.d', '.walk.0', '']) if (look && A.has(look + s)) return look + s; return ''; };
  const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16) || 0; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  function stageBg(i) {
    if (sceneBg.has(i)) return sceneBg.get(i);
    const th = ED.STAGES[i].theme, A = ED.Atlas, cv = document.createElement('canvas'), g = cv.getContext('2d');
    cv.width = SCENE_W; cv.height = SCENE_H; g.imageSmoothingEnabled = false;
    g.fillStyle = th.pal.bg; g.fillRect(0, 0, SCENE_W, SCENE_H);
    if (!A || !A.ok) return cv;
    let tot = 0; for (const f of th.floor) tot += f[1];
    for (let ty = 0; ty < SCENE_H / 16; ty++) for (let tx = 0; tx < SCENE_W / 16; tx++) {
      let r = U.hash3(tx, ty, 77 + i) % tot, id = th.floor[0][0];
      for (const f of th.floor) { r -= f[1]; if (r < 0) { id = f[0]; break; } }
      A.draw(g, id, 0, tx * 16, ty * 16);
    }
    for (let k = 0; k < 16; k++) { const d = th.deco[U.hash3(k, i, 5) % th.deco.length]; A.draw(g, d, 0, 8 + (U.hash3(k, 1, i) % (SCENE_W - 16)), 12 + (U.hash3(k, 2, i) % (SCENE_H - 16))); }
    sceneBg.set(i, cv);
    return cv;
  }
  // Up to 4 roster kinds in order of first appearance plus the first brute (rosters hold no bosses, elites or swarmers).
  function stageFoes(i) {
    if (sceneFoes.has(i)) return sceneFoes.get(i);
    const small = [], big = [];
    for (const row of ED.STAGES[i].timeline) for (const [id, wt] of row.roster) {
      const d = ED.FOES[id]; if (!(wt > 0) || !d || d.boss || small.indexOf(id) >= 0 || big.indexOf(id) >= 0) continue;
      (d.brute ? big : small).push(id);
    }
    const out = small.slice(0, 4).concat(big.slice(0, 1));
    sceneFoes.set(i, out);
    return out;
  }
  // Draws stage i's scene into g (already scaled: 1 unit = 1 art px), w x h art px, foe frames at time t (s).
  function drawScene(g, i, w, h, t) {
    const A = ED.Atlas, pal = ED.STAGES[i].theme.pal;
    g.imageSmoothingEnabled = false;
    g.drawImage(stageBg(i), (SCENE_W - w) >> 1, (SCENE_H - h) >> 1, w, h, 0, 0, w, h);
    const lx = w * 0.5, ly = h * 0.68, lg = g.createRadialGradient(lx, ly, 0, lx, ly, h * 0.62);
    lg.addColorStop(0, rgba(pal.accent, 0.34)); lg.addColorStop(0.55, rgba(pal.accent, 0.1)); lg.addColorStop(1, rgba(pal.accent, 0));
    g.globalCompositeOperation = 'lighter'; g.fillStyle = lg; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
    if (A && A.ok) {
      const ids = stageFoes(i), n = ids.length;
      for (const k of [4, 0, 3, 1, 2]) { // back to front
        const id = k === 4 ? (n > 4 ? ids[4] : '') : ids[k]; if (!id) continue;
        const an = foeAnim(id), s = SLOTS[k]; if (!an) continue;
        A.draw(g, an, A.frameAt(an, t + k * 0.29), Math.round(s[0] * w), Math.round(s[1] * h), s[2] ? FLIP : NOFLIP);
      }
    }
    const vg = g.createRadialGradient(w / 2, h * 0.58, h * 0.3, w / 2, h * 0.58, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.82)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }
  // Fixed 256 x 128 scene (Encyclopedia stage page).
  UI.stagePreview = (i) => {
    const out = document.createElement('canvas'); out.width = 256; out.height = 128; out.className = 'prev';
    drawScene(out.getContext('2d'), i, 256, 128, 0);
    return out;
  };
  // Stage card scene: the canvas matches its CSS box in device px (ResizeObserver) and draws art px at an integer scale (>= 2); redrawn by the menu anim loop at 10 fps.
  const sceneRO = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => { for (const e of es) fitScene(e.target); }) : null;
  function fitScene(cv) {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1, W = Math.round(r.width * d), H = Math.round(r.height * d);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    cv._k = Math.max(2, Math.floor(W / 140)); cv._tick = -1; cv._scene(performance.now() / 1000);
  }
  const scenePreview = (i) => {
    const cv = document.createElement('canvas'); cv.className = 'prev'; cv.width = 320; cv.height = 200; cv._k = 0; cv._tick = -1;
    cv._scene = (t) => {
      const tick = Math.floor(t * 10); if (tick === cv._tick) return; cv._tick = tick;
      const k = cv._k || 2, g = cv.getContext('2d');
      g.setTransform(k, 0, 0, k, 0, 0);
      drawScene(g, i, Math.min(SCENE_W, Math.ceil(cv.width / k)), Math.min(SCENE_H, Math.ceil(cv.height / k)), t);
      g.setTransform(1, 0, 0, 1, 0, 0);
    };
    if (sceneRO) sceneRO.observe(cv);
    anims.push(cv); kick();
    return cv;
  };
  const flamePips = (n, max) => {
    const d = document.createElement('span'); d.className = 'sc-pips';
    for (let k = 0; k < max; k++) { const cv = animCanvas('fx.flame', 32, 'pip' + (k < n ? '' : ' off')); cv._off = k * 0.21; d.appendChild(cv); }
    return d;
  };
  UI.renderStages = () => {
    const A = App(), p = A.profile, list = $('stage-list');
    if (sceneRO) for (const c of list.querySelectorAll('canvas.prev')) sceneRO.unobserve(c);
    list.textContent = '';
    ED.STAGES.forEach((sd, i) => {
      if (M.stageHidden(p, i)) return; // a hidden stage shows no card until it unlocks
      const open = M.stageOpen(p, i), best = p.best[sd.id], rule = ED.UNLOCKS.stages[i] || {};
      const b = document.createElement('button');
      b.className = 'stage-card' + (open ? '' : ' locked') + (rule.hidden ? ' deep' : '');
      b.dataset.stage = i; b.style.setProperty('--sc', sd.theme.pal.accent);
      b.setAttribute('role', 'radio'); b.setAttribute('aria-disabled', open ? 'false' : 'true');
      const art = document.createElement('div'); art.className = 'sc-art';
      art.appendChild(scenePreview(i));
      art.insertAdjacentHTML('beforeend', `<span class="sc-num">${i + 1}</span>` + (open ? '' : '<span class="lock-ico"></span>'));
      b.appendChild(art);
      const body = document.createElement('div'); body.className = 'sc-body';
      body.insertAdjacentHTML('beforeend', `<span class="sc-name">${esc(L(sd.name))}</span><span class="sc-blurb">${esc(L(sd.blurb || ''))}</span>`);
      const dg = document.createElement('div'); dg.className = 'sc-danger';
      dg.insertAdjacentHTML('beforeend', `<span>${T('Danger')}</span>`); dg.appendChild(flamePips(i + 1, 4));
      body.appendChild(dg);
      let rec;
      if (!open) rec = `<span class="sc-rec sc-lock">${esc(L(rule.txt || ''))}</span>`;
      else if (best) rec = '<span class="sc-rec">' + (best.won ? `<span class="rtag ok">${T('Cleared')}</span>` : '') +
        `<span class="kv"><span>${T('Best')}</span><b>${U.fmtTime(best.time)}</b></span><span class="kv"><span>${T('Kills')}</span><b>${U.fmtNum(best.kills)}</b></span></span>`;
      else rec = `<span class="sc-rec mut">${T('Not played yet')}</span>`;
      body.insertAdjacentHTML('beforeend', rec);
      b.appendChild(body);
      b.onclick = (e) => {
        if (!open) return;
        if (A.sel.stage === i && e.detail === 0) { $('btn-start').click(); return; }
        A.sel.stage = i; A.saveSel(); markStage(); b.focus();
      };
      b.ondblclick = () => { if (open) $('btn-start').click(); };
      list.appendChild(b);
    });
    markStage();
  };
  function markStage() {
    const A = App();
    for (const c of $('stage-list').children) { const on = +c.dataset.stage === A.sel.stage; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); }
    $('btn-start').disabled = !M.stageOpen(A.profile, A.sel.stage) || !M.heroOpen(A.profile, A.sel.cls);
  }

  // ---------------- camp ----------------
  const shopIcon = (s) => s.icon || (ED.PASSIVES[s.id] && ED.PASSIVES[s.id].icon) || 'pickup.coin';
  const pips = (n, max, next) => { let h = '<span class="pips">'; for (let k = 0; k < max; k++) h += `<i class="${k < n ? 'f' : k === n && next ? 'nx' : ''}"></i>`; return h + '</span>'; };
  // Camp grid: heroes for sale (locked { buy } rules) first, then ED.SHOP rows. Earns achievements the profile meets (UI.evalAch) and names them in #camp-msg.
  UI.renderCamp = (flash) => {
    const A = App(), p = A.profile, list = $('shop-list'), got = UI.evalAch();
    const cm = $('camp-msg');
    if (got.length) { const prev = flash && cm._say, line = () => (prev ? prev() + '  ' : '') + got.map(UI.newsTxt).join('  '); say('camp-msg', line); }
    else if (!flash) say('camp-msg', '');
    $('camp-gold').textContent = p.gold;
    paint($('camp-coin'), 'pickup.coin', 0);
    list.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const cost = M.heroCost(p, cls), h = ED.HEROES[cls]; if (!cost || !h) continue;
      const row = document.createElement('div');
      row.className = 'shop-row hero-row' + (p.gold >= cost ? ' can' : '');
      row.appendChild(UI.iconCanvas(heroIcon(cls), 48));
      row.insertAdjacentHTML('beforeend', `<span class="s-name">${esc(L(h.name))}</span><span class="s-txt">${T('Unlock this hero')}</span>`);
      const b = document.createElement('button');
      b.className = 'btn btn-sm'; b.textContent = T('Buy {0}', cost); b.dataset.id = 'hero.' + cls; b.disabled = p.gold < cost;
      b.onclick = () => { if (M.buyHero(p, cls)) { A.persist(); say('camp-msg', () => T('New hero: {0}', L(h.name))); UI.renderCamp('hero.' + cls); } };
      row.appendChild(b);
      list.appendChild(row);
    }
    let own = 0, all = 0; for (const s of ED.SHOP) { own += M.rank(p, s.id); all += s.max; }
    $('camp-hint').textContent = own < all ? T('Permanent ranks for every run. Ranks {0} / {1}, {2} gold to max all. Refund any time.', own, all, U.fmtNum(SV.shopLeft(p)))
      : T('Permanent ranks for every run. Ranks {0} / {1}, all maxed. Refund any time.', own, all);
    for (const s of ED.SHOP) {
      const r = M.rank(p, s.id), cost = M.cost(p, s.id), row = document.createElement('div');
      row.className = 'shop-row' + (cost ? '' : ' maxed') + (cost && p.gold >= cost ? ' can' : '');
      row.appendChild(UI.iconCanvas(shopIcon(s), 48));
      row.insertAdjacentHTML('beforeend', `<span class="s-name">${esc(L(s.name))}</span><span class="s-txt">${esc(L(s.txt))}</span>${pips(r, s.max, false)}`);
      const b = document.createElement('button');
      b.className = 'btn btn-sm'; b.textContent = cost ? T('Buy {0}', cost) : T('Max'); b.dataset.id = s.id;
      b.disabled = !cost || p.gold < cost;
      b.onclick = () => { if (M.buy(p, s.id)) { A.persist(); UI.renderCamp(s.id); } };
      row.appendChild(b);
      if (flash === s.id) row.animate([{ boxShadow: '0 0 0 3px #000, 0 0 30px rgba(255,210,122,0.9)' }, { boxShadow: '0 0 0 3px #000' }], { duration: 600 });
      list.appendChild(row);
    }
    const ref = M.refundTotal(p), rb = $('btn-refund');
    rb.textContent = ref ? T('Refund all (+{0})', ref) : T('Refund all'); rb.disabled = !ref;
    if (flash) { const nb = list.querySelector('[data-id="' + flash + '"]'); if (nb && !nb.disabled) nb.focus(); else $('btn-camp-back').focus(); }
  };

  // ---------------- settings ----------------
  let setFrom = '', opener = null;
  const store = () => { const A = App(); ED.Save.storeSettings(A.settings); A.applySettings(); };
  const refocus = () => { const o = opener; opener = null; if (o && visible(o)) o.focus(); else focusLayer(); };
  UI.openSettings = (from) => {
    setFrom = from || ''; opener = document.activeElement;
    syncSettings();
    if (from === 'pause') $('ov-pause').hidden = true;
    $('ov-settings').hidden = false;
  };
  const closeSettings = () => {
    $('ov-settings').hidden = true;
    if (setFrom === 'pause' && App().state === 'run' && (ED.Game.paused || ED.Game.mode !== 'solo')) $('ov-pause').hidden = false;
    else refocus();
  };
  function syncSettings() {
    const s = App().settings;
    const seg = (id, v) => { for (const b of $(id).children) { const on = v === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('role', 'radio'); } };
    seg('set-quality', s.quality || 'auto'); seg('set-lang', ED.I18N.lang);
    for (const k of ['music', 'sfx']) { $('set-' + k).value = s[k]; $('set-' + k + '-v').textContent = s[k]; }
    const tog = (id, v) => { const b = $(id); b.setAttribute('aria-pressed', v ? 'true' : 'false'); b.textContent = v ? ED.t('On') : ED.t('Off'); };
    tog('set-numbers', s.numbers !== false); tog('set-shake', s.shake !== false); tog('set-full', !!document.fullscreenElement);
  }
  // Language change: the visible screen re-renders in place (no focus move); offer cards rebuild; settings toggles relabel.
  function relang() {
    const on = (s) => !$('scr-' + s).hidden;
    if (on('title')) UI.renderTitle();
    if (on('hero')) UI.renderHeroes();
    if (on('stage')) UI.renderStages();
    if (on('camp')) UI.renderCamp();
    if (on('achieve')) ED.Codex.renderAchievements();
    if (on('codex')) ED.Codex.renderCodex();
    if (on('wardrobe')) ED.Wardrobe.render();
    if (on('lobby')) UI.renderLobby();
    if (on('results') && R.sum) UI.renderResults(R.sum, R.gained, true);
    if (!$('ov-pause').hidden) { UI.pauseLabels(); renderPauseBuild(); }
    if (!$('ov-chest').hidden && chestArgs) UI.showChest(chestArgs[0], chestArgs[1], true);
    if (!$('ov-credits').hidden) renderCredits();
    for (const el of document.querySelectorAll('#ui .msg')) if (el._say) el.textContent = el._say() || '';
    UI.offerSig = '';
    syncSettings();
  }
  // Pause overlay heading and quit button (co-op: the run goes on behind a menu).
  UI.pauseLabels = () => {
    const coop = ED.Game.mode !== 'solo', el = $('ov-pause');
    el.querySelector('h2').textContent = coop ? T('Menu') : T('Paused');
    $('btn-quit').textContent = coop ? T('Leave run') : T('Quit run');
  };
  // Credits: one paragraph per source; pack, people, licence names and links stay Latin (lang="en").
  const EN = (s) => `<span lang="en">${esc(s)}</span>`;
  const LINK = (u) => `<a href="${u}" target="_blank" rel="noopener" lang="en">${esc(u)}</a>`;
  const CCBY = 'https://creativecommons.org/licenses/by/4.0/';
  function renderCredits() {
    const P = (html, mut) => `<p${mut ? ' class="mut"' : ''}>${html}</p>`;
    $('credits-body').innerHTML =
      P(T('{0} tileset by {1} ({2}, {3} ; {4}), using the {5} palette by {6}. Cropped and recoloured for Wickdeep.', EN('DawnLike'), EN('DragonDePlatino'), EN('CC-BY 4.0'), LINK(CCBY),
        LINK('https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181'), EN('DawnBringer DB16'), EN('DawnBringer'))) +
      P(T('{0} by {1}, {2} ({3} ; {4}). Frames subsampled and recoloured for Wickdeep.', EN('Free Pixel Effects Pack'), EN('CodeManu (Davit Masia)'), EN('CC-BY 4.0'), LINK(CCBY), LINK('https://codemanu.itch.io/pixelart-effect-pack'))) +
      P(T('{0} font by {1}, {2}.', EN('Pixel Operator'), EN('Jayvee Enaguas (HarvettFox96)'), EN('CC0')), true) +
      P(T('Korean text: {0} font by {1}, {2} ({3}), subset as "{4}".', EN('NeoDunggeunmo'), EN('Eunbin Jeong (Dalgona.)'), EN('SIL Open Font License 1.1'), LINK('https://github.com/neodgm/neodgm'), EN('Wickdeep Hangul')), true) +
      P(T('More art: {0}.', EN('16x16 DungeonTileset II (0x72, Robert); Dungeon Tileset II Extended (nijikokun); 16x16 Dark Dungeon (kosinaz); Ninja Adventure (Pixel-boy, AAA); Puny Characters (Shade); LuizMelo; Kenney; o_lobster; Aim studios; ansimuz')), true) +
      P(T('Music and sound are synthesized in your browser.'), true);
  }
  UI.renderCredits = renderCredits;
  // Screen shake off: the camera offset read by render.js (ED.FX.shakeXY) is zeroed; ED.FX.shakeOn mirrors the setting for the FX lane.
  function hookShake() {
    const F = ED.FX; if (!F || F._uiShake || typeof F.shakeXY !== 'function') return;
    const base = F.shakeXY; F._uiShake = true;
    F.shakeXY = (out) => { base(out); if (App().settings && App().settings.shake === false) { out.x = 0; out.y = 0; } return out; };
    F.shakeOn = App().settings.shake !== false;
  }

  // ---------------- level-up offer ----------------
  // A Form shows as ??? until the profile has seen it (Encyclopedia record).
  const formKnown = UI.formKnown = (id) => !!(ED.Meta && ED.Meta.seen && ED.Meta.seen('weapons', id));
  // Card face: name, line, badge, rank pips, Form flag. Tune: weapon name, tune line, 'TUNE n/5'; path rank: weapon + path name, rank line, 'RANK n/5'; path pick: path name,
  // rank-1 line, 'PERMANENT'; support: support name, line; Form: name or ??? (line names the weapon it evolves); refine: Form name.
  // Sim card name / txt are English (ED.tr); a path step card (even rank) rebuilds its line '<path> <roman>: <ED.PATH_STEP.txt>' from the path id.
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
  function cardInfo(me, c) {
    const o = { name: L(c.name), txt: L(c.txt), badge: '', bcls: '', max: 0, lvl: c.lvl || 0, ready: false };
    if (c.kind === 'tune') {
      o.max = ED.TUNE_MAX || 5; o.badge = T('TUNE {0}/{1}', c.lvl, o.max); o.bcls = 'lv';
    } else if (c.kind === 'path') {
      const d = ED.WEAPONS[c.id], pa = d && d.paths && d.paths[c.path];
      o.name = d ? T('{0}: {1}', L(d.name), L(c.name)) : L(c.name); o.max = ED.PATH_MAX || 5;
      if (pa && !(c.lvl & 1) && ED.PATH_STEP) o.txt = T('{0} {1}: {2}', L(pa.name), ROMAN[c.lvl] || c.lvl, L(ED.PATH_STEP.txt));
      o.badge = T('RANK {0}/{1}', c.lvl, o.max); o.bcls = 'lv';
    } else if (c.kind === 'pathpick') {
      o.max = ED.PATH_MAX || 5; o.badge = T('PERMANENT'); o.bcls = 'perm';
    } else if (c.kind === 'support') {
      o.badge = T('NEW SUPPORT'); o.bcls = 'new';
    } else if (c.kind === 'form') {
      const known = formKnown(c.id), d = ED.WEAPONS[c.id], r = d && ED.WEAPONS[d.from];
      o.name = known ? L(c.name) : '???'; o.txt = known ? L(c.txt) : r ? T('Unknown form of {0}', L(r.name)) : T('An unknown form');
      o.badge = T('FORM'); o.bcls = 'new'; o.ready = true;
    } else if (c.kind === 'refine') {
      const d = ED.WEAPONS[c.id]; o.max = d && d.refine ? d.refine.length : 2;
      o.badge = T('REFINE {0}/{1}', c.lvl, o.max); o.bcls = 'lv';
    } else if (c.kind === 'passive' || c.kind === 'plvl') {
      const d = ED.PASSIVES[c.id]; o.max = d ? d.max : 5;
      o.badge = c.kind === 'passive' ? T('NEW') : T('LV {0}', c.lvl); o.bcls = c.kind === 'passive' ? 'new' : 'lv';
    } else if (c.kind === 'skill') {
      const d = ED.SKILLS[c.id]; o.max = d && ED.skillMaxLvl ? ED.skillMaxLvl(d) : 5;
      o.badge = T('{0} skill LV {1}', keyOf('skill1', 'Q'), c.lvl); o.bcls = 'sk';
    }
    return o;
  }
  // Shows the hero's current offer; hides when there is none. Rebuilt only when the offer changes. solo: big cards (the run is paused); co-op: bottom strip.
  UI.syncOffer = (me, solo) => {
    const ov = $('ov-offer'), offer = me && !me.dead ? me.offer : null;
    if (!offer || !(me.banishes > 0)) UI.banishOn = false;
    const sig = offer ? offer.map(c => c.kind + c.id + (c.path | 0) + ':' + (c.tk | 0) + c.lvl).join('|') + '|' + me.rerolls + me.skips + (me.banishes | 0) + (UI.banishOn ? 'b' : '') + (solo ? 's' : 'c') : '';
    if (sig === UI.offerSig) return;
    UI.offerSig = sig;
    ov.hidden = !offer;
    ov.classList.toggle('strip', !solo);
    if (!offer) return;
    const v = ED.Game.view, W = ED.World.prototype, chest = W.isChestOffer(offer); // chest offer (path pick, Form fork): picks only
    const wd = chest && ED.WEAPONS[ED.weaponRoot(offer[0].id)], head = chest ? (offer[0].kind === 'form' ? T('Choose a Form') : T('Choose a path')) + (wd ? ' · ' + L(wd.name) : '') : '';
    $('offer-title').textContent = chest ? (solo ? head : T('{0}: press 1-{1}', head, offer.length)) : solo ? T('Level {0}!', v ? v.level : '') : T('Level up: press 1-{0}', offer.length);
    const box = $('offer-cards'); box.textContent = '';
    offer.forEach((c, i) => {
      const f = cardInfo(me, c), b = document.createElement('button');
      const banOk = UI.banishOn && W.canBanish(offer, c);
      b.className = 'offer-card k-' + c.kind + (f.ready ? ' evo-ready' : '') + (banOk ? ' banish' : '');
      if (f.ready) b.dataset.flag = T('FORM');
      b.insertAdjacentHTML('beforeend', `<span class="key">${keyOf('pick' + (i + 1), String(i + 1))}</span>`);
      b.appendChild(UI.iconCanvas(c.kind === 'form' && f.name === '???' ? 'fx.spark.magic' : c.icon, 64, 'ic'));
      b.insertAdjacentHTML('beforeend', `<b class="card-name">${esc(f.name)}</b>` + (f.badge ? `<span class="badge ${f.bcls}">${esc(f.badge)}</span>` : '') +
        `<span class="card-txt">${esc(f.txt)}</span>` + (f.max > 1 ? pips(f.lvl, f.max, false) : ''));
      b.onclick = () => { if (!UI.banishOn) ED.Game.pick(i); else if (banOk) { UI.banishOn = false; ED.Game.banish(i); } };
      box.appendChild(b);
    });
    const rr = $('btn-reroll'), sk = $('btn-skip');
    rr.textContent = T('Reroll ({0}) {1}', keyOf('reroll', 'R'), me.rerolls); rr.disabled = !(me.rerolls > 0);
    sk.textContent = T('Skip ({0}) {1}', keyOf('skip', 'X'), me.skips); sk.disabled = !(me.skips > 0);
    const bn = $('btn-banish');
    const banAny = me.banishes > 0 && offer.some(c => W.canBanish(offer, c)); // Banish shows only with a banishable card on offer
    bn.textContent = UI.banishOn ? T('Pick a card to banish {0}', me.banishes | 0) : T('Banish {0}', me.banishes | 0); bn.disabled = !banAny; bn.hidden = !banAny; bn.classList.toggle('on', UI.banishOn);
    $('offer-foot').hidden = chest || !(me.rerolls > 0 || me.skips > 0 || banAny);
  };

  // ---------------- chest popup ----------------
  let chestT = 0, chestOut = 0, chestArgs = null;
  function hideChest(now) {
    clearTimeout(chestT); clearTimeout(chestOut);
    const el = $('ov-chest');
    if (now) { el.hidden = true; el.classList.remove('out'); return; }
    el.classList.add('out'); chestOut = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 350);
  }
  // Chest popup for results (chestFor); val 2: boss chest. A 'pathpick' / 'form' / 'offer' row (an offer follows) keeps the popup up longer. relabel: same popup in the new language (no restart).
  UI.showChest = (results, val, relabel) => {
    const me = ED.Game.view && ED.Game.view.me, list = $('chest-list'), el = $('ov-chest');
    chestArgs = [results, val];
    list.textContent = '';
    let evo = false;
    for (const r of results) {
      const row = document.createElement('div'); row.className = 'chest-row';
      if (r.kind === 'offer' || r.kind === 'form' || r.kind === 'pathpick') {
        evo = true; row.classList.add('evo');
        row.appendChild(UI.iconCanvas(r.icon || 'fx.spark.magic', 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(r.txt ? L(r.txt) : r.kind === 'form' ? T('Choose a Form') : r.kind === 'pathpick' ? T('Choose a path') : T('An extra level-up'))}</span>`);
      } else if (r.kind === 'plvl' || r.kind === 'skill') {
        const d = r.kind === 'plvl' ? ED.PASSIVES[r.id] : ED.SKILLS[r.id], slot = me && (r.kind === 'plvl' ? me.passives : me.skills).find(x => x.id === r.id);
        if (d) row.appendChild(UI.iconCanvas(d.icon, 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(d ? L(d.name) : r.id)}</span>` + `<span class="lv">${T('LV {0}', slot ? slot.lvl : r.lvl)}</span>`);
      } else {
        row.appendChild(UI.iconCanvas('pickup.coin', 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(r.txt ? L(r.txt) : T('+{0} gold', 25))}</span>`);
      }
      if (!relabel) row.style.animationDelay = (list.children.length * 0.12 + 0.15) + 's';
      list.appendChild(row);
    }
    $('chest-head').textContent = (val === undefined ? evo : val >= 2) ? T('Boss chest!') : T('Chest!');
    if (relabel) return;
    clearTimeout(chestT); clearTimeout(chestOut);
    el.classList.remove('out'); el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    chestT = setTimeout(() => hideChest(false), evo ? 3800 : 2800);
  };
  UI.onEvent = (ev) => {
    if (ev.t === 'chest' && ev.pid === ED.Game.myPid && ev.results && ev.results.length) UI.showChest(ev.results, ev.val);
  };

  // ---------------- pause ----------------
  // Weapon line of a slot: 'Weapon: Tune n/5 · Path n/5 · Form Refine n/2'; a path-ready slot ends '· path: pick at a chest', a Form-ready one '· Form: boss chest'.
  // ws: { id, tune, path, pr, fl } (a net slot or a summary build entry); bare: without the leading 'Weapon: '.
  const buildLine = UI.buildLine = (ws, bare) => {
    const d = ED.WEAPONS[ws.id], root = ED.WEAPONS[ED.weaponRoot(ws.id)];
    if (!d || !root) return '';
    const TM = ED.TUNE_MAX || 5, PM = ED.PATH_MAX || 5, pa = ws.path >= 0 && root.paths ? root.paths[ws.path] : null, out = [T('Tune {0}/{1}', ws.tune | 0, TM)];
    if (pa) out.push(L(pa.name) + ' ' + ((ws.pr && ws.pr[ws.path]) | 0) + '/' + PM);
    else if ((ws.tune | 0) >= TM && root.paths && root.paths.length) out.push(T('path: pick at a chest'));
    if (d.form) out.push(T('{0} Refine {1}/{2}', L(d.name), ws.fl | 0, d.refine ? d.refine.length : 2));
    else if (pa && ws.pr[ws.path] >= PM && ED.pathForms(root.id, ws.path).length) out.push(T('Form: boss chest'));
    return (bare ? '' : L(root.name) + ': ') + out.join(' · ');
  };
  function renderPauseBuild() {
    const me = ED.Game.view && ED.Game.view.me, box = $('pause-build');
    box.textContent = '';
    if (!me) return;
    const row = (items, defs, max) => {
      const r = document.createElement('div'); r.className = 'pb-row';
      for (let i = 0; i < max; i++) {
        const it = items[i], d = it && defs[it.id], s = document.createElement('div');
        s.className = 'pslot' + (d && d.evolved ? ' evo' : '');
        if (d) { s.appendChild(UI.iconCanvas(d.icon, 48)); s.insertAdjacentHTML('beforeend', `<b>${it.lvl}</b>`); s.title = L(d.name); }
        r.appendChild(s);
      }
      box.appendChild(r);
    };
    row(me.weapons, ED.WEAPONS, ED.MAX_WEAPONS || 1);
    for (const ws of me.weapons) { const l = document.createElement('div'); l.className = 'pb-line'; l.textContent = buildLine(ws); box.appendChild(l); }
    row(me.passives, ED.PASSIVES, ED.MAX_PASSIVES || 6);
  }

  // ---------------- results ----------------
  // Header, stat tiles (count up), weapon table (damage bar, share, DPS over the time owned, kills, build line), passives, timeline canvas, party / bosses tabs, unlocks.
  // Input guard: for GUARD_MS after it opens the screen eats every key and click and focuses nothing; afterwards a key acts only after a fresh keydown seen here (a key held from the run
  // never presses a button) and a pointer click only after a pointerdown seen here. A click outside the buttons finishes the animations.
  const GUARD_MS = 1500, ANIM_MS = 1100, TILE_STAGGER = 70;
  const R = { sum: null, gained: null, anim: [], t0: 0, k: 1, skip: false, raf: 0, guardT: 0, fresh: new Set(), down: false, timer: 0, hover: -1 };
  // 1.23M, 48.2k, else the integer.
  const fmtBig = UI.fmtBig = (n) => { n = Math.max(0, +n || 0); const t = (v, d) => v.toFixed(d).replace(/\.0+$/, ''); return n >= 1e6 ? t(n / 1e6, n >= 1e7 ? 1 : 2) + 'M' : n >= 1e4 ? t(n / 1e3, 1) + 'k' : String(Math.round(n)); };
  const dealtTotal = (h) => { let t = 0; for (const k in h.dealt || {}) t += +h.dealt[k] || 0; return t; };
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const resOn = () => !$('scr-results').hidden;
  const guarded = () => performance.now() < R.guardT;
  const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  function armGuard() {
    R.guardT = performance.now() + GUARD_MS; R.fresh.clear(); R.down = false;
    const ae = document.activeElement; if (ae && ae.blur && ae !== document.body) ae.blur();
    clearTimeout(R.timer);
    R.timer = setTimeout(() => {
      if (!resOn()) return;
      const ae2 = document.activeElement; if (ae2 && ae2 !== document.body && $('scr-results').contains(ae2)) return;
      const b = $('btn-res-again'); (visible(b) ? b : $('btn-res-back')).focus({ preventScroll: true });
    }, GUARD_MS + 30);
  }
  const guardKey = (e) => {
    if (!resOn() || (ED.Input && ED.Input.capturing && ED.Input.capturing())) return;
    if (e.type === 'keydown') { if (guarded() || e.repeat) eat(e); else R.fresh.add(e.code); return; }
    if (R.fresh.has(e.code)) R.fresh.delete(e.code); else eat(e);
  };
  const guardPtr = (e) => {
    if (!resOn()) return;
    if (e.type === 'pointerdown') { if (guarded()) eat(e); else R.down = true; return; }
    if (guarded() || (e.detail > 0 && !R.down)) { eat(e); return; }
    R.down = false;
    if (e.detail > 0 && !(e.target.closest && e.target.closest('button'))) UI.resSkip();
  };
  UI.resGuarded = () => resOn() && guarded();
  // Finishes the count-up, bar and timeline animations at once.
  UI.resSkip = () => { if (R.k >= 1) return; R.skip = true; $('scr-results').classList.add('res-done'); if (!R.raf) R.raf = requestAnimationFrame(animStep); };
  function animStep(now) {
    R.raf = 0;
    if (!R.sum || !resOn()) return;
    const el = now - R.t0, ease = (k) => 1 - Math.pow(1 - k, 3);
    R.anim.forEach((b, i) => { const k = R.skip ? 1 : U.clamp((el - i * TILE_STAGGER) / (ANIM_MS - 300), 0, 1); b.textContent = b._f(b._v * ease(k)); });
    R.k = R.skip ? 1 : U.clamp(el / ANIM_MS, 0, 1);
    drawTimeline();
    if (R.k < 1 || (!R.skip && el < ANIM_MS + R.anim.length * TILE_STAGGER)) R.raf = requestAnimationFrame(animStep);
    else R.k = 1;
  }
  const tile = (box, label, v, fmt, opt) => {
    const o = opt || {}, d = document.createElement('div');
    d.className = 'tile' + (o.cls ? ' ' + o.cls : '');
    if (o.icon) d.appendChild(UI.iconCanvas(o.icon, 48));
    const b = document.createElement('b');
    if (num(v) === null) b.textContent = '-'; else { b._v = v; b._f = fmt; b.textContent = fmt(0); R.anim.push(b); }
    d.appendChild(b);
    d.insertAdjacentHTML('beforeend', `<span>${esc(label)}</span>`);
    if (o.title) d.title = o.title;
    if (R.skip) d.style.animation = 'none';
    d.style.animationDelay = (box.children.length * 0.05).toFixed(2) + 's';
    box.appendChild(d);
  };
  // relabel: the same results in the current language (language switch), animations finished, no new input guard.
  UI.renderResults = (sum, gained, relabel) => {
    hideChest(true);
    const scr = $('scr-results'), won = !!sum.won, t = $('res-title');
    R.sum = sum; R.gained = gained || null; R.anim = []; R.skip = !!relabel; R.k = relabel ? 1 : 0; R.hover = -1; R.t0 = performance.now();
    scr.classList.toggle('res-done', !!relabel);
    if (!relabel) armGuard();
    t.textContent = won ? T('Victory') : T('Fallen');
    t.className = 'res-title ' + (won ? 'won' : 'lost');
    const me = sum.perHero.find(h => h.pid === ED.Game.myPid) || sum.perHero[0], sd = ED.STAGES[sum.stage], hd = me && ED.HEROES[me.cls], coop = sum.perHero.length > 1, lap = sum.lap || null;
    $('res-sub').innerHTML = [sd ? `<b>${esc(L(sd.name))}</b>` : '', hd ? `<b>${esc(L(hd.name))}</b>` : '', U.fmtTime(sum.time), coop ? T('{0} heroes', sum.perHero.length) : ''].filter(Boolean).join('  ·  ');
    // tiles
    const tiles = $('res-tiles'), mine = me ? dealtTotal(me) : 0, top = me && me.top, topD = top && (ED.WEAPONS[top.id] || (ED.SKILLS && ED.SKILLS[top.id]));
    tiles.textContent = ''; tiles.classList.toggle('lap', !!lap);
    const plain = (v) => U.fmtNum(v), plus = (v) => '+' + Math.round(v);
    tile(tiles, T('Time'), sum.time, (v) => U.fmtTime(v));
    tile(tiles, coop ? T('Party kills') : T('Kills'), sum.kills, plain);
    tile(tiles, T('Level'), sum.level, (v) => String(Math.round(v)));
    tile(tiles, T('Gold'), sum.gold, plus, { icon: 'pickup.coin' });
    tile(tiles, coop ? T('Your damage') : T('Damage'), me && me.dealt ? mine : null, fmtBig);
    tile(tiles, T('Best hit'), top ? top.v : null, fmtBig, { icon: topD ? topD.icon : '', title: topD ? L(topD.name) : '' });
    tile(tiles, T('Damage taken'), me ? num(me.taken) : null, fmtBig, { cls: 'hurt' });
    tile(tiles, T('Healed'), me ? num(me.healed) : null, fmtBig, { cls: 'heal' });
    if (lap) {
      const d = document.createElement('div'); d.className = 'tile lap';
      d.insertAdjacentHTML('beforeend', `<span>${T('Last Light')}</span>`);
      for (const [v, f] of [[lap.kills, (x) => T('+{0} kills', U.fmtNum(x))], [lap.gold, (x) => T('+{0} gold', Math.round(x))]]) { const b = document.createElement('b'); b._v = +v || 0; b._f = f; b.textContent = f(0); R.anim.push(b); d.appendChild(b); }
      if (relabel) d.style.animation = 'none';
      tiles.appendChild(d);
    }
    renderWeapons(sum, me);
    renderHighlights(sum, me);
    // passives
    const pas = $('res-pas'); pas.textContent = '';
    pas.insertAdjacentHTML('beforeend', `<span>${T('Passives')}</span>`);
    const pl = (me && me.pas) || [];
    for (const [id, lvl] of pl) {
      const d = ED.PASSIVES[id]; if (!d) continue;
      const s = document.createElement('div'); s.className = 'pslot'; s.title = L(d.name) + ' ' + lvl + '/' + d.max;
      s.appendChild(UI.iconCanvas(d.icon, 48)); s.insertAdjacentHTML('beforeend', `<b>${lvl | 0}</b>`);
      pas.appendChild(s);
    }
    if (!pl.length) pas.insertAdjacentHTML('beforeend', `<span class="mut">${T('none')}</span>`);
    pas.hidden = !(me && me.pas);
    // timeline legend: the lap key only with a lap
    $('res-key-lap').hidden = $('res-key-lap-t').hidden = !lap;
    hideTip();
    // party / bosses
    renderParty(sum, me);
    renderBosses(sum);
    $('res-tabbar').querySelector('[data-tab="party"]').hidden = !coop;
    setTab(coop ? 'party' : 'bosses');
    // unlocks
    const un = $('res-unlocks'); un.textContent = '';
    const add = (icon, text, cls) => { const d = document.createElement('div'); d.className = 'unlock' + (cls ? ' ' + cls : ''); if (icon) d.appendChild(UI.iconCanvas(icon, 48)); d.insertAdjacentHTML('beforeend', `<span>${esc(text)}</span>`); un.appendChild(d); };
    if (sum.note) add('', L(sum.note), 'note');
    if (gained) {
      for (const n of gained.news || []) add(n.kind === 'hero' ? heroIcon(n.id) : n.kind === 'ach' && ED.Codex ? ED.Codex.achIcon(n.id) : '', UI.newsTxt(n));
      const RECS = { time: T('time'), kills: T('kills'), level: T('level') };
      if (gained.records && gained.records.length) add('', T('New record: {0}', gained.records.map(r => RECS[r] || r).join(', ')));
    }
    $('btn-res-again').hidden = UI.lastMode !== 'solo';
    if (relabel) for (const el of scr.querySelectorAll('.res-unlocks > *, .bar i')) el.style.animation = 'none';
    cancelAnimationFrame(R.raf); R.raf = requestAnimationFrame(animStep);
  };
  // Weapon table of hero h: damage rows (ED.dmgRows, kills folded into Forms) plus held slots / skills that dealt nothing; DPS = damage / seconds owned (slot t0; skills: the whole run).
  function renderWeapons(sum, h) {
    const box = $('res-chart'); box.textContent = '';
    if (!h) { $('res-dmg-tot').textContent = ''; return; }
    const rows = ED.dmgRows(h), build = h.build || [], sk = h.sk || [];
    for (const b of build) if (!rows.some(r => r.id === b.id) && ED.WEAPONS[b.id]) rows.push({ id: b.id, kind: 'weapon', name: ED.WEAPONS[b.id].name, icon: ED.WEAPONS[b.id].icon, dmg: 0, frac: 0, kills: 0 });
    for (const [id] of sk) if (!rows.some(r => r.id === id) && ED.SKILLS[id]) rows.push({ id, kind: 'skill', name: ED.SKILLS[id].name, icon: ED.SKILLS[id].icon, dmg: 0, frac: 0, kills: 0 });
    let tot = 0, max = 1; for (const r of rows) { tot += r.dmg; max = Math.max(max, r.dmg); }
    $('res-dmg-tot').textContent = tot ? T('{0} total · {1} DPS', fmtBig(tot), fmtBig(tot / Math.max(1, sum.time))) : '';
    box.insertAdjacentHTML('beforeend', `<div class="wt-head"><span></span><span class="nm">${T('Weapon')}</span><span class="dmg">${T('Damage')}</span><span class="pc">%</span><span>DPS</span><span>${T('Kills')}</span></div>`);
    const hasKw = !!h.kw;
    rows.slice(0, 8).forEach((r, i) => {
      const wd = ED.WEAPONS[r.id], b = r.kind === 'weapon' ? build.find(x => x.id === r.id) : null, s = r.kind === 'skill' ? sk.find(x => x[0] === r.id) : null;
      const own = r.kind === 'skill' ? sum.time : b && num(b.t0) !== null ? sum.time - b.t0 : 0, dps = own >= 1 && r.dmg > 0 ? r.dmg / own : 0;
      let line = '';
      if (b) {
        const root = ED.WEAPONS[ED.weaponRoot(b.id)];
        line = buildLine(b, !!(root && root.id === b.id));
        if (b.t0 > 0) line += ' · ' + T('from {0}', U.fmtTime(b.t0));
      } else if (r.kind === 'skill') { const d = ED.SKILLS[r.id]; line = s && d ? T('Skill · Level {0}/{1}', s[1], ED.skillMaxLvl(d)) : T('Skill'); }
      else if (r.id === 'bomb') line = T('Pickup');
      const row = document.createElement('div');
      row.className = 'bar-row' + (wd && wd.evolved ? ' evo' : '') + (r.kind === 'skill' ? ' skill' : '');
      row.appendChild(UI.iconCanvas(r.icon || 'fx.hit.spark', 48));
      row.insertAdjacentHTML('beforeend', `<span class="bar-name">${esc(L(r.name))}</span><span class="bar"><i style="width:${r.dmg > 0 ? Math.max(1.5, 100 * r.dmg / max).toFixed(1) : 0}%;animation-delay:${(0.25 + i * 0.07).toFixed(2)}s"></i></span>`
        + `<span class="bar-v">${fmtBig(r.dmg)}</span><span class="bar-p">${Math.round(100 * r.frac)}%</span><span class="w-n">${dps ? fmtBig(dps) : '-'}</span><span class="w-n">${hasKw && r.kind !== 'other' ? U.fmtNum(r.kills || 0) : '-'}</span>`
        + `<span class="w-line">${esc(line)}</span>`);
      box.appendChild(row);
    });
  }
  // Highlights under the weapon table (shown when the viewport is tall enough): peak minute, kills per minute, gold picked up, fastest boss, downs, revives / bosses killed.
  function renderHighlights(sum, h) {
    const box = $('res-hl'), tl = sum.tl || [], B = sum.bosses || [], out = [];
    let pk = -1; tl.forEach((e, i) => { if (pk < 0 || e.k > tl[pk].k) pk = i; });
    if (pk >= 0) out.push([T('Peak minute'), T('{0} kills at {1}', U.fmtNum(tl[pk].k), U.fmtTime(pk * 60))]);
    out.push([T('Kills / min'), U.fmtNum(sum.kills / Math.max(1, sum.time / 60))]);
    if (h && num(h.goldGot) !== null) out.push([T('Gold picked up'), U.fmtNum(h.goldGot)]);
    let fb = null; for (const b of B) if (b.t1 >= 0 && (!fb || b.t1 - b.t0 < fb.t1 - fb.t0)) fb = b;
    if (fb) out.push([T('Fastest boss'), U.fmtTime(fb.t1 - fb.t0) + ' ' + (ED.FOES[fb.id] ? L(ED.FOES[fb.id].name) : '')]);
    if (h && num(h.downs) !== null) out.push([T('Times downed'), String(h.downs)]);
    if (sum.perHero.length > 1 && h && num(h.revs) !== null) out.push([T('Revives given'), String(h.revs)]);
    else if (B.length) out.push([T('Bosses killed'), B.filter(b => b.t1 >= 0).length + ' / ' + B.length]);
    box.innerHTML = out.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    box.hidden = !out.length;
  }
  function renderParty(sum, me) {
    const box = $('res-pane-party'); box.textContent = '';
    if (sum.perHero.length < 2) return;
    const v = (x) => (num(x) === null ? '-' : U.fmtNum(x));
    box.insertAdjacentHTML('beforeend', `<div class="ptab party hd"><span></span><span>${T('Hero')}</span><span>${T('Damage')}</span><span>${T('Kills')}</span><span>${T('Downs')}</span><span>${T('Revives')}</span></div>`);
    for (const h of sum.perHero) {
      const r = document.createElement('div'); r.className = 'ptab party' + (h === me ? ' me' : '');
      r.appendChild(UI.iconCanvas(heroIcon(h.cls), 48, '', h === me ? heroVar(h.cls) : ''));
      r.insertAdjacentHTML('beforeend', `<span translate="no">${esc(h.name)}</span><span>${h.dealt ? fmtBig(dealtTotal(h)) : '-'}</span><span>${v(h.kills)}</span><span>${v(h.downs)}</span><span>${v(h.revs)}</span>`);
      box.appendChild(r);
    }
  }
  function renderBosses(sum) {
    const box = $('res-pane-bosses'); box.textContent = '';
    const BL = sum.bosses || [];
    if (!BL.length) { box.insertAdjacentHTML('beforeend', `<span class="mut">${T('No boss reached.')}</span>`); return; }
    box.insertAdjacentHTML('beforeend', `<div class="ptab boss hd"><span></span><span>${T('Boss')}</span><span>${T('Arrived')}</span><span>${T('Killed in')}</span></div>`);
    for (const b of BL) {
      const d = ED.FOES[b.id], r = document.createElement('div'); r.className = 'ptab boss';
      r.appendChild(UI.iconCanvas(ED.Codex && ED.Codex.foeIcon ? ED.Codex.foeIcon(b.id) : '', 48));
      r.insertAdjacentHTML('beforeend', `<span>${esc(d ? L(d.name) : b.id)}${b.f ? `<span class="tag">${T('Final')}</span>` : ''}</span><span>${U.fmtTime(b.t0)}</span><span>${b.t1 >= 0 ? U.fmtTime(b.t1 - b.t0) : `<span class="no">${T('alive')}</span>`}</span>`);
      box.appendChild(r);
    }
  }
  function setTab(id) {
    for (const b of $('res-tabbar').querySelectorAll('.tab')) { const on = b.dataset.tab === id; b.classList.toggle('cur', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    $('res-pane-party').hidden = id !== 'party'; $('res-pane-bosses').hidden = id !== 'bosses';
  }

  // ---------------- results timeline ----------------
  // Canvas at integer device pixels: kills per minute bars (Last Light minutes gold), party level step line (right scale), boss bands (spawn -> kill, diamond at the kill), the lap shaded.
  // Grows left to right with R.k; hover shows that minute's kills, damage and level.
  const TL = { L: 0, T: 0, pw: 0, ph: 0, span: 60, dpr: 1 };
  const niceMax = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; };
  function drawTimeline() {
    const cv = $('res-tl'), sum = R.sum, box = cv.parentNode;
    if (!sum || !box || !box.clientWidth || !box.clientHeight) return;
    const dpr = TL.dpr = Math.max(1, Math.round(window.devicePixelRatio || 1)), W = Math.floor(box.clientWidth * dpr), H = Math.floor(box.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.imageSmoothingEnabled = false;
    const tl = sum.tl || [], fs = 16 * dpr, css = getComputedStyle(document.documentElement), col = (n, d) => (css.getPropertyValue(n) || d).trim() || d;
    const MUT = col('--mut', '#b9a68c'), GOLD = col('--gold', '#ffd27a'), EMB = col('--ember', '#ff8a3d'), VIO = col('--violet', '#b49cff'), EDGE = '#3a2c22';
    g.font = fs + 'px "Pixel Operator", "Wickdeep Hangul", monospace'; g.textBaseline = 'alphabetic';
    if (!tl.length) { g.fillStyle = MUT; g.fillText(ED.t('No full minute played.'), 4 * dpr, fs + 4 * dpr); return; }
    let maxK = 1, maxLv = 1; for (const e of tl) { maxK = Math.max(maxK, e.k); maxLv = Math.max(maxLv, e.lv); }
    maxK = niceMax(maxK); maxLv = Math.max(5, Math.ceil(maxLv / 5) * 5);
    const lblK = fmtBig(maxK), lblLv = ED.t('Lv {0}', maxLv);
    const L = Math.ceil(g.measureText(lblK).width) + 8 * dpr, Rr = Math.ceil(g.measureText(lblLv).width) + 8 * dpr, T = fs + 8 * dpr, B = fs + 8 * dpr;
    const pw = Math.max(10, W - L - Rr), ph = Math.max(10, H - T - B), span = Math.max(60, sum.time, tl.length * 60 - 59);
    Object.assign(TL, { L, T, pw, ph, span });
    const x = (s) => L + Math.round(Math.min(s, span) / span * pw), yK = (k) => T + ph - Math.round(k / maxK * ph), yL = (lv) => T + ph - Math.round((lv - 1) / (maxLv - 1) * ph);
    const reveal = L + Math.round(pw * R.k), lap = sum.lap;
    // grid and axes
    g.fillStyle = EDGE;
    for (let i = 0; i <= 2; i++) g.fillRect(L, T + Math.round(ph * i / 2), pw, dpr);
    g.fillStyle = MUT; g.textAlign = 'right';
    g.fillText(lblK, L - 4 * dpr, T + fs * 0.4); g.fillText('0', L - 4 * dpr, T + ph + fs * 0.35);
    g.textAlign = 'left'; g.fillStyle = VIO; g.fillText(lblLv, L + pw + 4 * dpr, T + fs * 0.4); g.fillText('1', L + pw + 4 * dpr, T + ph + fs * 0.35);
    const mins = span / 60, step = [1, 2, 5, 10].find(s => pw / mins * s >= 64 * dpr) || 10;
    g.fillStyle = MUT; g.textAlign = 'center';
    for (let m = 0; m <= mins + 1e-6; m += step) { const xx = x(m * 60); g.fillRect(xx, T + ph, dpr, 4 * dpr); g.fillText(m + ':00', U.clamp(xx, L + 12 * dpr, L + pw - 12 * dpr), H - 3 * dpr); }
    // Last Light
    if (lap) { const a = x(lap.t0), b = x(lap.t0 + (lap.dur || 60)); g.fillStyle = 'rgba(255, 210, 122, 0.16)'; g.fillRect(a, T, Math.max(dpr, b - a), ph); }
    g.save(); g.beginPath(); g.rect(0, 0, reveal + dpr, H); g.clip();
    // bars
    const gap = Math.max(dpr, Math.floor(pw / tl.length * 0.14));
    tl.forEach((e, i) => {
      const a = x(i * 60) + gap, b = x(Math.min((i + 1) * 60, span)) - gap, y = yK(e.k), inLap = lap && i * 60 >= lap.t0 - 30;
      if (b <= a || e.k <= 0) return;
      g.fillStyle = i === R.hover ? '#fff8e8' : inLap ? GOLD : EMB; g.fillRect(a, y, b - a, T + ph - y);
      g.fillStyle = 'rgba(255, 255, 255, 0.35)'; g.fillRect(a, y, b - a, Math.min(2 * dpr, T + ph - y));
    });
    // level step line
    g.fillStyle = VIO;
    let px = x(0), py = yL(1);
    const lw = 2 * dpr;
    tl.forEach((e, i) => {
      const nx = x(Math.min((i + 1) * 60, span)), ny = yL(e.lv);
      g.fillRect(px, py - dpr, nx - px + dpr, lw);
      g.fillRect(nx - dpr, Math.min(py, ny) - dpr, lw, Math.abs(ny - py) + lw);
      px = nx; py = ny;
    });
    // bosses: band spawn -> kill on the top row, diamond and dotted drop line at the kill
    for (const bs of sum.bosses || []) {
      const a = x(bs.t0), b = x(bs.t1 >= 0 ? bs.t1 : span), yy = T - 6 * dpr;
      g.fillStyle = bs.t1 >= 0 ? GOLD : '#ff6a5a'; g.fillRect(a, yy, Math.max(2 * dpr, b - a), 2 * dpr);
      if (bs.t1 < 0) continue;
      g.fillStyle = 'rgba(255, 210, 122, 0.55)';
      for (let yd = T; yd < T + ph; yd += 6 * dpr) g.fillRect(b, yd, dpr, 3 * dpr);
      g.fillStyle = GOLD; const r = 4 * dpr;
      for (let k = 0; k <= r; k++) g.fillRect(b - k, yy + 1 * dpr - (r - k), 2 * k + dpr, 2 * (r - k) + dpr);
    }
    g.restore();
  }
  function hideTip() { const t = document.querySelector('.res-tl-tip'); if (t) t.remove(); }
  function tlHover(ev) {
    const sum = R.sum, cv = $('res-tl'); if (!sum || !sum.tl || !sum.tl.length) return;
    const r = cv.getBoundingClientRect(), xs = (ev.clientX - r.left) * TL.dpr, s = (xs - TL.L) / TL.pw * TL.span, i = Math.floor(s / 60);
    const e = i >= 0 && i < sum.tl.length && xs <= TL.L + TL.pw ? sum.tl[i] : null;
    const was = R.hover; R.hover = e ? i : -1;
    if (was !== R.hover && R.k >= 1) drawTimeline();
    if (!e) { hideTip(); return; }
    let tip = document.querySelector('.res-tl-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'res-tl-tip'; cv.parentNode.appendChild(tip); }
    const end = Math.min((i + 1) * 60, sum.time), boss = (sum.bosses || []).filter(b => b.t1 >= i * 60 && b.t1 < (i + 1) * 60).map(b => T('{0} down', ED.FOES[b.id] ? L(ED.FOES[b.id].name) : b.id));
    tip.textContent = U.fmtTime(i * 60) + '-' + U.fmtTime(end) + ':  ' + T('{0} kills · {1} damage · Lv {2}', U.fmtNum(e.k), fmtBig(e.d), e.lv) + (boss.length ? ' · ' + boss.join(', ') : '');
    const bw = cv.parentNode.clientWidth, tw = tip.offsetWidth, cx = ev.clientX - r.left;
    tip.style.left = U.clamp(cx + 12, 0, Math.max(0, bw - tw)) + 'px';
  }

  // ---------------- co-op lobby ----------------
  // Drives the ED.Net lobby API; ED.Net.lobby { role, code, me, status, stage, members, inRun, canStart } is the single source of truth, ED.Net.onChange re-renders.
  const LB = UI.lobby = { net: null };
  const NL = () => (ED.Net && ED.Net.lobby) || { role: '', code: '', me: '', status: 'idle', stage: 0, members: [], inRun: false, canStart: false };
  const netOk = () => !!(ED.Net && typeof ED.Net.host === 'function');
  const onJoin = () => !$('scr-join').hidden;
  // net.js messages are English sources (ED.tr at display); 'Connection failed (<type>).' keeps the PeerJS error type.
  const netMsg = (m) => { const x = /^Connection failed(?: \((.+)\))?\.$/.exec(m); return !x ? L(m) : x[1] ? T('Connection failed ({0}).', x[1]) : T('Connection failed.'); };
  let lastStatus = '';
  const wireNet = () => {
    const N = ED.Net; if (!N || LB.net === N) return; LB.net = N;
    N.onChange = (lb) => {
      if (lb.status !== lastStatus) {
        lastStatus = lb.status;
        if (lb.status === 'open') { if (lb.role === 'client') { say('join-msg', ''); if (onJoin()) UI.show('lobby'); } else say('lobby-msg', () => T('Party open. Share the code.')); }
      }
      if (!lb.inRun && App().state !== 'run' && !$('scr-lobby').hidden) UI.renderLobby();
    };
    N.onError = (msg) => { say(onJoin() ? 'join-msg' : 'lobby-msg', () => netMsg(msg), true); };
    N.onClosed = (msg) => { if (App().state !== 'run' && App().state !== 'results') UI.leaveLobby(msg || (() => T('The party closed.'))); };
  };
  UI.hostParty = () => {
    const N = ED.Net; ensureProfile(); wireNet();
    if (!netOk()) { say('title-msg', () => T('Co-op is not available in this build.'), true); return; }
    if (N.available && !N.available()) { say('title-msg', () => T('This browser cannot make peer connections.'), true); return; }
    const A = App();
    if (!M.stageOpen(A.profile, A.sel.stage)) A.sel.stage = 0;
    try { N.host(A.profile.name, A.sel.cls); N.setStage(A.sel.stage); } catch (e) { say('title-msg', () => T('Could not open a party: {0}', L(e.message)), true); return; }
    say('lobby-msg', () => T('Opening the party...'));
    UI.show('lobby'); UI.renderLobby();
  };
  UI.joinParty = () => {
    const N = ED.Net; ensureProfile(); wireNet();
    const code = N && N.cleanCode ? N.cleanCode($('inp-join').value) : String($('inp-join').value).toUpperCase();
    $('inp-join').value = code;
    if (code.length < 5) { say('join-msg', () => T('A party code has 5 letters.'), true); return; }
    if (!netOk()) { say('join-msg', () => T('Co-op is not available in this build.'), true); return; }
    if (N.available && !N.available()) { say('join-msg', () => T('This browser cannot make peer connections.'), true); return; }
    say('join-msg', () => T('Connecting...'));
    const A = App();
    try { N.join(code, A.profile.name, A.sel.cls); } catch (e) { say('join-msg', () => T('Could not join: {0}', L(e.message)), true); }
  };
  // msg: shown on the title; an English source (net.js) or a function returning the text.
  UI.leaveLobby = (msg) => {
    if (ED.Net && ED.Net.leave) ED.Net.leave();
    lastStatus = '';
    UI.renderTitle(); UI.show('title'); say('title-msg', typeof msg === 'function' ? msg : msg ? () => netMsg(msg) : '', !!msg);
  };
  // Back from results: a party still open returns to its lobby.
  UI.backFromResults = () => {
    const lb = NL();
    if (lb.role && lb.status === 'open') { UI.show('lobby'); UI.renderLobby(); return; }
    if (lb.role) UI.leaveLobby(''); else { UI.renderTitle(); UI.show('title'); }
  };
  const myId = () => NL().me;
  const sendPick = (cls) => { if (ED.Net) ED.Net.setHero(cls); };
  const setStage = (i) => {
    const A = App(); if (NL().role !== 'host' || !M.stageOpen(A.profile, i)) return;
    A.sel.stage = i; A.saveSel();
    ED.Net.setStage(i);
    UI.renderLobby();
  };
  UI.renderLobby = (st) => {
    const A = App(), s = st || NL(), host = s.role === 'host', me = myId();
    const code = s.code || '-----';
    $('lobby-title').textContent = host ? T('Your party') : T('Party');
    $('lobby-code').textContent = code;
    $('lobby-code-lbl').textContent = host ? T('Party code') : T('Joined');
    $('btn-lobby-copy').hidden = !host;
    const slots = $('lobby-slots'); slots.textContent = '';
    const mem = (s.members || []).slice().sort((a, b) => a.slot - b.slot);
    for (let i = 0; i < (ED.CONST.MAX_PLAYERS || 4); i++) {
      const m = mem.find(x => x.slot === i), d = document.createElement('div');
      if (!m) { d.className = 'slot empty'; d.innerHTML = `<span class="pnum">P${i + 1}</span><span>${T('Waiting...')}</span>`; slots.appendChild(d); continue; }
      d.className = 'slot' + (m.pid === me ? ' me' : '');
      d.insertAdjacentHTML('beforeend', `<span class="pnum">P${i + 1}</span>`);
      const cs = m.cos || {}, nc = ED.COS_BY && ED.COS_BY[cs.ncol], tt = ED.COS_BY && ED.COS_BY[cs.title];
      d.appendChild(animCanvas(heroIcon(m.cls), 96, '', heroVar(m.cls, cs.skin || '')));
      const st2 = m.isHost ? ['host', T('Host')] : m.ready ? ['ready', T('Ready')] : ['wait', T('Not ready')];
      d.insertAdjacentHTML('beforeend', (tt && tt.kind === 'title' ? `<span class="sl-title">${esc(L(tt.name))}</span>` : '') +
        `<span class="sl-name"${nc && nc.kind === 'ncol' ? ` style="color:${nc.col}"` : ''}><span translate="no">${esc(m.name)}</span>${m.pid === me ? ' ' + T('(you)') : ''}</span><span class="sl-hero">${esc(ED.HEROES[m.cls] ? L(ED.HEROES[m.cls].name) : m.cls)}</span><span class="sl-st ${st2[0]}">${st2[1]}</span>`);
      slots.appendChild(d);
    }
    const mine = mem.find(x => x.pid === me), cur = mine ? mine.cls : A.sel.cls;
    const hr = $('lobby-heroes'); hr.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const h = ED.HEROES[cls]; if (!h) continue;
      const open = M.heroOpen(A.profile, cls), b = document.createElement('button');
      b.className = 'pick-btn' + (cur === cls ? ' on' : ''); b.disabled = !open; b.title = open ? L(h.name) : T('{0} (locked)', L(h.name));
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', cur === cls ? 'true' : 'false'); b.setAttribute('aria-label', L(h.name));
      b.appendChild(UI.iconCanvas(heroIcon(cls), 48, '', heroVar(cls)));
      b.onclick = () => { if (cur === cls) return; A.sel.cls = cls; A.saveSel(); sendPick(cls); UI.renderLobby(); const n = $('lobby-heroes').children[ED.HERO_IDS.indexOf(cls)]; if (n) n.focus(); };
      hr.appendChild(b);
    }
    const sr = $('lobby-stages'); sr.textContent = '';
    const stage = s.stage !== undefined ? s.stage : A.sel.stage;
    ED.STAGES.forEach((sd, i) => {
      if (stage !== i && M.stageHidden(A.profile, i)) return; // hidden until unlocked (shown when the host picked it)
      const b = document.createElement('button');
      b.className = 'pick-btn txt' + (stage === i ? ' on' : ''); b.textContent = (i + 1) + '. ' + L(sd.name);
      b.disabled = !host || !M.stageOpen(A.profile, i);
      b.onclick = () => setStage(i);
      sr.appendChild(b);
    });
    const go = $('btn-lobby-go');
    const ready = !!(mine && mine.ready);
    if (host) { go.textContent = s.canStart ? T('Start run') : T('Waiting for ready'); go.disabled = !s.canStart; }
    else { go.textContent = ready ? T('Cancel ready') : T('Ready'); go.disabled = s.status !== 'open' || !mine; go.classList.toggle('on', ready); }
  };
  const lobbyGo = () => {
    const lb = NL();
    if (lb.role !== 'host') { const mine = lb.members.find(x => x.pid === lb.me); ED.Net.setReady(!(mine && mine.ready)); return; }
    try { if (!ED.Net.start()) say('lobby-msg', () => T('Everyone must be ready.'), true); } catch (e) { say('lobby-msg', () => T('Could not start: {0}', L(e.message)), true); }
  };

  // ---------------- keyboard navigation ----------------
  const visible = (el) => !!el && !el.hidden && el.offsetParent !== null;
  const topLayer = () => {
    for (const id of LAYERS) {
      const el = $(id);
      if (!el.hidden && !(id === 'ov-offer' && el.classList.contains('strip'))) return el;
    }
    if (App() && App().state === 'run') return null;
    for (const s of SCREENS) { const el = $('scr-' + s); if (!el.hidden) return el; }
    return null;
  };
  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea, a[href], [data-scroll]';
  const scrolls = (el) => !el.hasAttribute('data-scroll') || el.scrollHeight > el.clientHeight + 1;
  const items = (layer) => [...layer.querySelectorAll(FOCUSABLE)].filter(el => visible(el) && scrolls(el));
  function focusLayer() {
    const L0 = topLayer(); if (!L0 || (L0.id === 'scr-results' && guarded())) return;
    if (L0.contains(document.activeElement) && document.activeElement !== document.body) return;
    const f = [...L0.querySelectorAll('[data-focus], .on')].find(e => visible(e) && !e.disabled) || items(L0)[0];
    if (f) f.focus({ preventScroll: false });
  }
  UI.focusLayer = focusLayer;
  // Moves focus to the nearest item in direction (dx, dy) from the focused one: edge gap along the direction plus 2x the gap across it (0 when the boxes overlap).
  function move(layer, dx, dy) {
    const list = items(layer), cur = document.activeElement;
    if (!list.length) return;
    if (!layer.contains(cur) || cur === layer) { focusLayer(); return; }
    const a = cur.getBoundingClientRect();
    let best = null, bd = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const along = dy > 0 ? r.top - a.bottom : dy < 0 ? a.top - r.bottom : dx > 0 ? r.left - a.right : a.left - r.right;
      const ahead = dy > 0 ? r.top > a.top + 2 : dy < 0 ? r.bottom < a.bottom - 2 : dx > 0 ? r.left > a.left + 2 : r.right < a.right - 2;
      if (!ahead) continue;
      const cross = dy ? Math.max(0, r.left - a.right, a.left - r.right) : Math.max(0, r.top - a.bottom, a.top - r.bottom);
      const d = Math.max(0, along) + cross * 2 + (r.left + r.top) * 0.001; // ties go to the top-left item
      if (d < bd) { bd = d; best = el; }
    }
    if (best) best.focus();
  }
  const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
  function onKey(e) {
    if (ED.Input && ED.Input.capturing && ED.Input.capturing()) return;
    const layer = topLayer(); if (!layer) return;
    const t = e.target, typing = t && (t.tagName === 'INPUT' && t.type !== 'range' || t.tagName === 'TEXTAREA');
    const run = App() && App().state === 'run';
    if (e.code === 'Escape') {
      if (run && layer.id !== 'ov-settings') return; // in a run, Esc belongs to pause (main.js)
      const back = layer.querySelector('[data-back]');
      if (back && visible(back)) { e.preventDefault(); e.stopPropagation(); back.click(); }
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && typing && t.id === 'inp-join') { e.preventDefault(); UI.joinParty(); return; }
    // Enter in the name field commits it and moves to Play (an IME composition keeps its Enter)
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && typing && t.id === 'inp-name') { if (e.isComposing) return; e.preventDefault(); commitName(); $('btn-play').focus(); return; }
    const d = DIRS[e.code];
    if (!d) return;
    if (typing && (e.code.startsWith('Key') || e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
    if (t && t.type === 'range' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
    if (run && layer.id === 'ov-offer' && e.code.startsWith('Key')) return;
    e.preventDefault();
    if (d[1] && t && t.hasAttribute && t.hasAttribute('data-scroll')) {
      const room = d[1] > 0 ? t.scrollHeight - t.clientHeight - t.scrollTop : t.scrollTop;
      if (room > 1) { t.scrollBy({ top: d[1] * Math.max(40, t.clientHeight * 0.4) }); return; }
    }
    move(layer, d[0], d[1]);
  }

  // ---------------- bind ----------------
  UI.bind = () => {
    const A = App();
    $('btn-play').onclick = () => { ensureProfile(); say('title-msg', ''); UI.renderHeroes(); UI.show('hero'); };
    $('btn-host').onclick = () => { say('title-msg', ''); UI.hostParty(); };
    $('btn-join').onclick = () => { ensureProfile(); say('title-msg', ''); say('join-msg', ''); UI.show('join'); $('inp-join').focus(); };
    $('btn-camp').onclick = () => { ensureProfile(); say('title-msg', ''); UI.renderCamp(); UI.show('camp'); };
    $('btn-achieve').onclick = () => { ensureProfile(); say('title-msg', ''); ED.Codex.renderAchievements(); UI.show('achieve'); };
    $('btn-codex').onclick = () => { ensureProfile(); say('title-msg', ''); ED.Codex.renderCodex(); UI.show('codex'); };
    $('btn-ach-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-codex-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-settings').onclick = () => UI.openSettings('title');
    $('btn-credits').onclick = () => { opener = $('btn-credits'); renderCredits(); $('ov-credits').hidden = false; };
    $('btn-credits-close').onclick = () => { $('ov-credits').hidden = true; refocus(); };
    $('btn-hero-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-hero-next').onclick = () => { if (!M.heroOpen(A.profile, A.sel.cls)) return; UI.renderStages(); UI.show('stage'); };
    $('btn-stage-back').onclick = () => { UI.renderHeroes(); UI.show('hero'); };
    $('btn-start').onclick = () => { if (!M.stageOpen(A.profile, A.sel.stage) || !M.heroOpen(A.profile, A.sel.cls)) return; A.startSolo(); };
    $('btn-camp-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-wardrobe').onclick = () => { ED.Wardrobe.render(); UI.show('wardrobe'); };
    $('btn-wd-back').onclick = () => { UI.renderCamp(); UI.show('camp'); $('btn-wardrobe').focus(); };
    $('btn-refund').onclick = () => { M.refundAll(A.profile); A.persist(); UI.renderCamp(); };
    $('btn-code-toggle').onclick = () => { const b = $('code-box'), open = b.hidden; b.hidden = !open; $('btn-code-toggle').setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) { $('inp-code').value = ED.Save.encode(A.profile); say('code-msg', ''); } };
    $('btn-code-copy').onclick = () => {
      const c = ED.Save.encode(A.profile); $('inp-code').value = c;
      const done = () => say('code-msg', () => T('Code copied. Keep it somewhere safe.'));
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(done, () => { $('inp-code').select(); say('code-msg', () => T('Select the code and copy it.')); });
      else { $('inp-code').select(); say('code-msg', () => T('Select the code and copy it.')); }
    };
    $('btn-code-load').onclick = () => {
      try { A.replaceProfile(ED.Save.decode($('inp-code').value)); say('code-msg', () => T('Progress restored.')); UI.renderCamp(); }
      catch (e) { const m = e.message; say('code-msg', () => L(m), true); } // ED.Save.decode errors are English sources
    };
    $('btn-join-back').onclick = () => { if (ED.Net && ED.Net.leave) ED.Net.leave(); UI.renderTitle(); UI.show('title'); };
    $('btn-join-go').onclick = () => UI.joinParty();
    $('inp-name').addEventListener('change', commitName);
    $('inp-join').addEventListener('input', () => { const N = ED.Net, el = $('inp-join'); el.value = N && N.cleanCode ? N.cleanCode(el.value) : el.value.toUpperCase(); });
    $('btn-lobby-leave').onclick = () => UI.leaveLobby('');
    $('btn-lobby-go').onclick = lobbyGo;
    $('btn-lobby-copy').onclick = () => { const c = $('lobby-code').textContent; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(() => say('lobby-msg', () => T('Code copied.')), () => {}); };
    $('btn-resume').onclick = () => A.togglePause(false);
    $('btn-pause-settings').onclick = () => UI.openSettings('pause');
    $('btn-quit').onclick = () => A.quitRun();
    $('btn-res-back').onclick = () => UI.backFromResults();
    $('btn-res-again').onclick = () => { if (M.heroOpen(A.profile, A.sel.cls) && M.stageOpen(A.profile, A.sel.stage)) A.startSolo(); else { UI.renderHeroes(); UI.show('hero'); } };
    $('btn-reroll').onclick = () => ED.Game.reroll();
    $('btn-skip').onclick = () => ED.Game.skip();
    $('btn-banish').onclick = () => { UI.banishOn = !UI.banishOn; UI.offerSig = ''; };
    // settings
    $('btn-settings-close').onclick = closeSettings;
    for (const b of $('set-quality').children) b.onclick = () => { A.settings.quality = b.dataset.v; store(); syncSettings(); };
    for (const b of $('set-lang').children) b.onclick = () => { if (ED.I18N.lang !== b.dataset.v) ED.I18N.set(b.dataset.v); };
    ED.I18N.on(relang);
    for (const k of ['music', 'sfx']) $('set-' + k).addEventListener('input', (e) => { A.settings[k] = +e.target.value; $('set-' + k + '-v').textContent = e.target.value; store(); });
    $('set-numbers').onclick = () => { A.settings.numbers = A.settings.numbers === false; store(); syncSettings(); };
    $('set-shake').onclick = () => { A.settings.shake = A.settings.shake === false; if (ED.FX) ED.FX.shakeOn = A.settings.shake; store(); syncSettings(); };
    $('set-full').onclick = () => {
      const de = document.documentElement;
      if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen().catch(() => {}); }
      else if (de.requestFullscreen) de.requestFullscreen().catch(() => say('title-msg', () => T('Fullscreen was refused by the browser.'), true));
    };
    document.addEventListener('fullscreenchange', syncSettings);
    hookShake();
    // events from the run (chest popup); chained after main.js's handler
    const prev = ED.Game.onEvent;
    ED.Game.onEvent = (ev) => { if (prev) prev(ev); UI.onEvent(ev); };
    // overlays that open focus their default button; pause shows the build
    const mo = new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target; if (el.hidden) continue;
        if (el.id === 'ov-pause') renderPauseBuild();
        if (el.id !== 'ov-offer') { const f = el.querySelector('[data-focus]'); if (f) f.focus(); }
      }
    });
    for (const id of LAYERS) mo.observe($(id), { attributes: true, attributeFilter: ['hidden'] });
    // results: tabs, timeline hover, input guard (registered before onKey so it can eat keys first)
    $('res-tabbar').onclick = (e) => { const b = e.target.closest && e.target.closest('.tab'); if (b) setTab(b.dataset.tab); };
    $('res-tl').addEventListener('mousemove', tlHover);
    $('res-tl').addEventListener('mouseleave', () => { hideTip(); if (R.hover >= 0) { R.hover = -1; drawTimeline(); } });
    window.addEventListener('resize', () => { if (R.sum && resOn()) drawTimeline(); });
    for (const t of ['keydown', 'keyup']) window.addEventListener(t, guardKey, true);
    for (const t of ['pointerdown', 'click']) window.addEventListener(t, guardPtr, true);
    // keyboard and mouse share one highlight: moving the mouse over a button focuses it (a still cursor never steals focus when a screen changes under it)
    window.addEventListener('keydown', onKey, true);
    let lx = -1, ly = -1;
    $('ui').addEventListener('pointermove', (e) => {
      if (e.clientX === lx && e.clientY === ly) return;
      lx = e.clientX; ly = e.clientY;
      const b = e.target.closest && e.target.closest('button'); if (!b || b.disabled || UI.resGuarded()) return;
      const ae = document.activeElement; if (ae && (ae.tagName === 'INPUT' && ae.type !== 'range' || ae.tagName === 'TEXTAREA')) return;
      if (ae !== b) b.focus({ preventScroll: true });
    });
  };
})(globalThis.ED || (globalThis.ED = {}));
