// DOM screens (client only): title, hero select, stage select, Camp shop (+ save code), join, lobby, results; achievements and encyclopedia are filled by codex.js (ED.Codex),
//   the Wardrobe by wardrobe.js (ED.Wardrobe); hero portraits wear the profile's skin (lobby: each member's);
//   overlays: level-up cards, chest popup, pause, settings, credits.
// ED.UI.show(name) shows one screen ('title' | 'hero' | 'stage' | 'camp' | 'wardrobe' | 'achieve' | 'codex' | 'join' | 'lobby' | 'results' | 'none'); overlays toggle separately.
// Menus work with mouse and keyboard: arrows / WASD move focus spatially inside the top layer, Enter / Space press, Esc presses the layer's [data-back] button.
//   A focused [data-scroll] box (a stop only while it overflows) scrolls on up / down until its edge, then focus moves on.
// Shop and unlock rules go through ED.Save with A.profile. Co-op goes through the ED.Net lobby API (host / join / setHero / setReady / setStage / start / leave, ED.Net.onChange).
(function (ED) {
  'use strict';
  const U = ED.U;
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
    if (rule.buy) { const r = of(p.gold, rule.buy, String); r.txt += ' gold'; return r; }
    if (rule.kills) return of(st.bestKills, rule.kills, String);
    if (rule.level) { const r = of(st.bestLevel, rule.level, String); r.txt = 'Level ' + r.txt; return r; }
    if (rule.beat !== undefined) return { k: p.beat.indexOf(rule.beat) >= 0 ? 1 : 0, txt: '' };
    if (rule.pure) return { k: p.pure.length ? 1 : 0, txt: SV.campRanks(p) ? 'Camp ranks owned: ' + SV.campRanks(p) + ' (Refund all at Camp)' : 'No Camp ranks owned' };
    return { k: 0, txt: '' };
  };
  // Earns achievements the profile now meets (records from before they existed, Camp purchases), saves, and returns their news entries.
  UI.evalAch = () => { const A = App(), n = M.evalAch(A.profile); if (n.length) A.persist(); return n; };

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
  function animLoop(now) {
    const A = ED.Atlas, t = now / 1000;
    for (let i = anims.length - 1; i >= 0; i--) {
      const cv = anims[i];
      if (!cv.isConnected) { anims.splice(i, 1); continue; }
      if (!A || !A.ok || cv.offsetParent === null) continue;
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
  const say = (id, text, err) => { const el = $(id); el.textContent = text || ''; el.classList.toggle('err', !!err); };

  // ---------------- title ----------------
  UI.renderTitle = () => {
    const A = App(), p = A.profile;
    $('name-row').hidden = A.hasProfile;
    const pl = $('profile-line');
    pl.innerHTML = A.hasProfile ? `<span>${esc(p.name)}</span><span><b>${p.gold}</b> gold</span><span><b>${p.stats.runs}</b> runs</span><span><b>${p.stats.wins}</b> wins</span>` : '';
    const th = $('title-heroes'); th.textContent = '';
    ED.HERO_IDS.forEach((cls, i) => {
      if (!ED.HEROES[cls]) return;
      const cv = animCanvas(heroIcon(cls), 64, '', heroVar(cls)); cv._off = i * 0.37;
      if (!M.heroOpen(p, cls)) cv.classList.add('locked');
      th.appendChild(cv);
    });
    const ok = netOk();
    $('btn-host').disabled = !ok; $('btn-join').disabled = !ok;
  };

  // ---------------- hero select ----------------
  UI.renderHeroes = () => {
    const A = App(), list = $('hero-list');
    list.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const h = ED.HEROES[cls]; if (!h) continue;
      const open = M.heroOpen(A.profile, cls), on = A.sel.cls === cls, rule = ED.UNLOCKS.heroes[cls] || {};
      const b = document.createElement('button');
      b.className = 'hero-tile' + (on ? ' on' : '') + (open ? '' : ' locked');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.dataset.cls = cls;
      b.appendChild(animCanvas(heroIcon(cls), 96, '', heroVar(cls)));
      b.insertAdjacentHTML('beforeend', `<span class="t-name">${esc(h.name)}</span><span class="t-lock">${open ? '' : 'Locked'}</span>`);
      b.setAttribute('aria-label', h.name + (open ? '' : ', locked: ' + (rule.txt || '')));
      b.onclick = (e) => {
        if (A.sel.cls === cls && open && e.detail === 0) { $('btn-hero-next').click(); return; } // Enter on the chosen hero continues
        A.sel.cls = cls; A.saveSel(); UI.renderHeroes(); const t = list.querySelector('[data-cls="' + cls + '"]'); if (t) t.focus();
      };
      b.ondblclick = () => { if (open) $('btn-hero-next').click(); };
      list.appendChild(b);
    }
    renderHeroDetail();
  };
  const kitRow = (icon, key, name, txt) => {
    const d = document.createElement('div'); d.className = 'kit';
    d.appendChild(UI.iconCanvas(icon, 48));
    d.insertAdjacentHTML('beforeend', `<b>${key ? `<span class="key">${esc(key)}</span>` : ''}${esc(name)}</b><span>${esc(txt || '')}</span>`);
    return d;
  };
  function renderHeroDetail() {
    const A = App(), cls = A.sel.cls, h = ED.HEROES[cls], box = $('hero-detail');
    box.textContent = '';
    if (!h) return;
    const open = M.heroOpen(A.profile, cls), rule = ED.UNLOCKS.heroes[cls] || {};
    box.classList.toggle('locked', !open);
    const big = animCanvas(heroIcon(cls), 192, 'big', heroVar(cls)); big._off = 0.3; box.appendChild(big);
    const head = document.createElement('div'); head.className = 'hd-head';
    const hpK = U.clamp(h.hp / 130, 0, 1), spK = U.clamp((h.speed - 70) / 30, 0.1, 1);
    head.innerHTML = `<span class="hd-name">${esc(h.name)}</span><span class="hd-txt">${esc(h.txt || '')}</span>` +
      `<div class="hd-stats"><span>HP</span><span class="meter"><i style="width:${(hpK * 100).toFixed(0)}%;background:var(--red)"></i></span><b>${h.hp}</b>` +
      `<span>Speed</span><span class="meter"><i style="width:${(spK * 100).toFixed(0)}%;background:var(--blue)"></i></span><b>${h.speed}</b></div>`;
    box.appendChild(head);
    if (open) {
      const kit = document.createElement('div'); kit.className = 'hd-kit';
      const sig = ED.WEAPONS[h.sig], q = ED.SKILLS[h.skills[0]];
      if (sig) kit.appendChild(kitRow(sig.icon, '', sig.name, sig.txt));
      if (q) kit.appendChild(kitRow(q.icon, keyOf('skill1', 'Q'), q.name, q.txt));
      box.appendChild(kit);
    } else {
      const pr = unlockProgress(A.profile, rule), lk = document.createElement('div'); lk.className = 'lock-box';
      lk.innerHTML = `<span>Locked: ${esc(rule.txt || 'not yet available')}</span>` + (pr.txt ? `<span class="hd-stats"><span class="meter" style="width:16em"><i style="width:${(U.clamp(pr.k, 0, 1) * 100).toFixed(0)}%"></i></span><span class="mut">${esc(pr.txt)}</span></span>` : '');
      const cost = M.heroCost(A.profile, cls);
      if (cost) {
        const b = document.createElement('button'); b.className = 'btn btn-sm'; b.id = 'btn-hero-buy';
        b.textContent = 'Unlock for ' + cost + ' gold'; b.disabled = A.profile.gold < cost;
        b.onclick = () => { if (M.buyHero(A.profile, cls)) { UI.evalAch(); A.persist(); UI.renderHeroes(); $('btn-hero-next').focus(); } };
        lk.appendChild(b);
      }
      box.appendChild(lk);
    }
    const nx = $('btn-hero-next');
    nx.disabled = !open; nx.textContent = open ? 'Next' : 'Locked';
  }

  // ---------------- stage select ----------------
  const stagePrev = new Map();
  // Stage card art: floor tiles, deco and the final boss (cached per stage once the atlas is ready); stagePreview returns a fresh canvas.
  const stagePreview = UI.stagePreview = (i) => {
    const out = document.createElement('canvas'); out.width = 256; out.height = 128; out.className = 'prev';
    out.getContext('2d').drawImage(stageArt(i), 0, 0);
    return out;
  };
  function stageArt(i) {
    if (stagePrev.has(i)) return stagePrev.get(i);
    const sd = ED.STAGES[i], cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d'), A = ED.Atlas, th = sd.theme;
    g.imageSmoothingEnabled = false; g.fillStyle = th.pal.bg; g.fillRect(0, 0, 256, 128);
    if (A && A.ok) {
      let tot = 0; for (const f of th.floor) tot += f[1];
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 16; tx++) {
        let r = U.hash3(tx, ty, 77 + i) % tot, id = th.floor[0][0];
        for (const f of th.floor) { r -= f[1]; if (r < 0) { id = f[0]; break; } }
        A.draw(g, id, 0, tx * 16, ty * 16);
      }
      for (let k = 0; k < 7; k++) { const d = th.deco[U.hash3(k, i, 5) % th.deco.length]; A.draw(g, d, 0, 12 + (U.hash3(k, 1, i) % 232), 14 + (U.hash3(k, 2, i) % 104)); }
      const fin = (sd.bosses || []).find(b => b.final) || (sd.bosses || [])[0], fd = fin && ED.FOES[fin.id];
      if (fd) {
        const id = A.has(fd.look + '.idle') ? fd.look + '.idle' : fd.look;
        g.save(); g.translate(128, 112); g.scale(2, 2); A.draw(g, id, 0, 0, 0); g.restore();
      }
    }
    const vg = g.createRadialGradient(128, 64, 30, 128, 64, 150); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = vg; g.fillRect(0, 0, 256, 128);
    if (A && A.ok) stagePrev.set(i, cv);
    return cv;
  }
  UI.renderStages = () => {
    const A = App(), list = $('stage-list');
    list.textContent = '';
    ED.STAGES.forEach((sd, i) => {
      if (M.stageHidden(A.profile, i)) return; // a hidden stage shows no card until it unlocks
      const open = M.stageOpen(A.profile, i), best = A.profile.best[sd.id], rule = ED.UNLOCKS.stages[i] || {}, on = A.sel.stage === i;
      const b = document.createElement('button');
      b.className = 'stage-card' + (on ? ' on' : '') + (open ? '' : ' locked');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('aria-disabled', open ? 'false' : 'true');
      b.appendChild(stagePreview(i));
      const bosses = (sd.bosses || []).map(x => (ED.FOES[x.id] ? ED.FOES[x.id].name : x.id)).join(', ');
      b.insertAdjacentHTML('beforeend', `<span class="sc-num">${i + 1}</span><div class="sc-body"><span class="sc-name">${esc(sd.name)}</span><span class="sc-line">${esc(bosses)}</span>` +
        (open ? (best ? `<span class="sc-best">Best ${U.fmtTime(best.time)}${best.won ? '  Beaten' : ''}</span>` : '<span class="sc-line">Not played yet</span>') : `<span class="sc-lock">Locked: ${esc(rule.txt || '')}</span>`) + '</div>');
      b.onclick = (e) => {
        if (!open) return;
        if (A.sel.stage === i && e.detail === 0) { $('btn-start').click(); return; }
        A.sel.stage = i; A.saveSel(); UI.renderStages(); const c = list.children[i]; if (c) c.focus();
      };
      b.ondblclick = () => { if (open) $('btn-start').click(); };
      list.appendChild(b);
    });
    $('btn-start').disabled = !M.stageOpen(A.profile, A.sel.stage) || !M.heroOpen(A.profile, A.sel.cls);
  };

  // ---------------- camp ----------------
  const shopIcon = (s) => s.icon || (ED.PASSIVES[s.id] && ED.PASSIVES[s.id].icon) || 'pickup.coin';
  const pips = (n, max, next) => { let h = '<span class="pips">'; for (let k = 0; k < max; k++) h += `<i class="${k < n ? 'f' : k === n && next ? 'nx' : ''}"></i>`; return h + '</span>'; };
  // Camp grid: heroes for sale (locked { buy } rules) first, then ED.SHOP rows. Earns achievements the profile meets (UI.evalAch) and names them in #camp-msg.
  UI.renderCamp = (flash) => {
    const A = App(), p = A.profile, list = $('shop-list'), got = UI.evalAch();
    const cm = $('camp-msg');
    if (got.length) cm.textContent = (flash && cm.textContent ? cm.textContent + '  ' : '') + got.map(a => a.txt).join('  '); else if (!flash) cm.textContent = '';
    $('camp-gold').textContent = p.gold;
    paint($('camp-coin'), 'pickup.coin', 0);
    list.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const cost = M.heroCost(p, cls), h = ED.HEROES[cls]; if (!cost || !h) continue;
      const row = document.createElement('div');
      row.className = 'shop-row hero-row' + (p.gold >= cost ? ' can' : '');
      row.appendChild(UI.iconCanvas(heroIcon(cls), 48));
      row.insertAdjacentHTML('beforeend', `<span class="s-name">${esc(h.name)}</span><span class="s-txt">Unlock this hero</span>`);
      const b = document.createElement('button');
      b.className = 'btn btn-sm'; b.textContent = 'Buy ' + cost; b.dataset.id = 'hero.' + cls; b.disabled = p.gold < cost;
      b.onclick = () => { if (M.buyHero(p, cls)) { A.persist(); $('camp-msg').textContent = 'New hero: ' + h.name; UI.renderCamp('hero.' + cls); } };
      row.appendChild(b);
      list.appendChild(row);
    }
    let own = 0, all = 0; for (const s of ED.SHOP) { own += M.rank(p, s.id); all += s.max; }
    $('camp-hint').textContent = 'Permanent ranks for every run. Ranks ' + own + ' / ' + all + (own < all ? ', ' + U.fmtNum(SV.shopLeft(p)) + ' gold to max all.' : ', all maxed.') + ' Refund any time.';
    for (const s of ED.SHOP) {
      const r = M.rank(p, s.id), cost = M.cost(p, s.id), row = document.createElement('div');
      row.className = 'shop-row' + (cost ? '' : ' maxed') + (cost && p.gold >= cost ? ' can' : '');
      row.appendChild(UI.iconCanvas(shopIcon(s), 48));
      row.insertAdjacentHTML('beforeend', `<span class="s-name">${esc(s.name)}</span><span class="s-txt">${esc(s.txt)}</span>${pips(r, s.max, false)}`);
      const b = document.createElement('button');
      b.className = 'btn btn-sm'; b.textContent = cost ? 'Buy ' + cost : 'Max'; b.dataset.id = s.id;
      b.disabled = !cost || p.gold < cost;
      b.onclick = () => { if (M.buy(p, s.id)) { A.persist(); UI.renderCamp(s.id); } };
      row.appendChild(b);
      if (flash === s.id) row.animate([{ boxShadow: '0 0 0 3px #000, 0 0 30px rgba(255,210,122,0.9)' }, { boxShadow: '0 0 0 3px #000' }], { duration: 600 });
      list.appendChild(row);
    }
    const ref = M.refundTotal(p), rb = $('btn-refund');
    rb.textContent = ref ? 'Refund all (+' + ref + ')' : 'Refund all'; rb.disabled = !ref;
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
    UI.offerSig = '';
    syncSettings();
  }
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
  function cardInfo(me, c) {
    const o = { name: c.name, txt: c.txt, badge: '', bcls: '', max: 0, lvl: c.lvl || 0, ready: false };
    if (c.kind === 'tune') {
      o.max = ED.TUNE_MAX || 5; o.badge = 'TUNE ' + c.lvl + '/' + o.max; o.bcls = 'lv';
    } else if (c.kind === 'path') {
      const d = ED.WEAPONS[c.id];
      o.name = (d ? d.name + ': ' : '') + c.name; o.max = ED.PATH_MAX || 5;
      o.badge = 'RANK ' + c.lvl + '/' + o.max; o.bcls = 'lv';
    } else if (c.kind === 'pathpick') {
      o.max = ED.PATH_MAX || 5; o.badge = 'PERMANENT'; o.bcls = 'perm';
    } else if (c.kind === 'support') {
      o.badge = 'NEW SUPPORT'; o.bcls = 'new';
    } else if (c.kind === 'form') {
      const known = formKnown(c.id), d = ED.WEAPONS[c.id], r = d && ED.WEAPONS[d.from];
      o.name = known ? c.name : '???'; o.txt = known ? c.txt : r ? 'Unknown form of ' + r.name : 'An unknown form';
      o.badge = 'FORM'; o.bcls = 'new'; o.ready = true;
    } else if (c.kind === 'refine') {
      const d = ED.WEAPONS[c.id]; o.max = d && d.refine ? d.refine.length : 2;
      o.badge = 'REFINE ' + c.lvl + '/' + o.max; o.bcls = 'lv';
    } else if (c.kind === 'passive' || c.kind === 'plvl') {
      const d = ED.PASSIVES[c.id]; o.max = d ? d.max : 5;
      o.badge = c.kind === 'passive' ? 'NEW' : 'LV ' + c.lvl; o.bcls = c.kind === 'passive' ? 'new' : 'lv';
    } else if (c.kind === 'skill') {
      const d = ED.SKILLS[c.id]; o.max = d && ED.skillMaxLvl ? ED.skillMaxLvl(d) : 5;
      o.badge = keyOf('skill1', 'Q') + ' skill LV ' + c.lvl; o.bcls = 'sk';
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
    const wd = chest && ED.WEAPONS[ED.weaponRoot(offer[0].id)], head = chest ? (offer[0].kind === 'form' ? 'Choose a Form' : 'Choose a path') + (wd ? ' · ' + wd.name : '') : '';
    $('offer-title').textContent = chest ? head + (solo ? '' : ': press 1-' + offer.length) : solo ? 'Level ' + (v ? v.level : '') + '!' : 'Level up: press 1-' + offer.length;
    const box = $('offer-cards'); box.textContent = '';
    offer.forEach((c, i) => {
      const f = cardInfo(me, c), b = document.createElement('button');
      const banOk = UI.banishOn && W.canBanish(offer, c);
      b.className = 'offer-card k-' + c.kind + (f.ready ? ' evo-ready' : '') + (banOk ? ' banish' : '');
      b.insertAdjacentHTML('beforeend', `<span class="key">${keyOf('pick' + (i + 1), String(i + 1))}</span>`);
      b.appendChild(UI.iconCanvas(c.kind === 'form' && f.name === '???' ? 'fx.spark.magic' : c.icon, 64, 'ic'));
      b.insertAdjacentHTML('beforeend', `<b class="card-name">${esc(f.name)}</b>` + (f.badge ? `<span class="badge ${f.bcls}">${esc(f.badge)}</span>` : '') +
        `<span class="card-txt">${esc(f.txt)}</span>` + (f.max > 1 ? pips(f.lvl, f.max, false) : ''));
      b.onclick = () => { if (!UI.banishOn) ED.Game.pick(i); else if (banOk) { UI.banishOn = false; ED.Game.banish(i); } };
      box.appendChild(b);
    });
    const rr = $('btn-reroll'), sk = $('btn-skip');
    rr.textContent = 'Reroll (' + keyOf('reroll', 'R') + ') ' + me.rerolls; rr.disabled = !(me.rerolls > 0);
    sk.textContent = 'Skip (' + keyOf('skip', 'X') + ') ' + me.skips; sk.disabled = !(me.skips > 0);
    const bn = $('btn-banish');
    const banAny = me.banishes > 0 && offer.some(c => W.canBanish(offer, c)); // Banish shows only with a banishable card on offer
    bn.textContent = (UI.banishOn ? 'Pick a card to banish ' : 'Banish ') + (me.banishes | 0); bn.disabled = !banAny; bn.hidden = !banAny; bn.classList.toggle('on', UI.banishOn);
    $('offer-foot').hidden = chest || !(me.rerolls > 0 || me.skips > 0 || banAny);
  };

  // ---------------- chest popup ----------------
  let chestT = 0, chestOut = 0;
  function hideChest(now) {
    clearTimeout(chestT); clearTimeout(chestOut);
    const el = $('ov-chest');
    if (now) { el.hidden = true; el.classList.remove('out'); return; }
    el.classList.add('out'); chestOut = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 350);
  }
  // Chest popup for results (chestFor); val 2: boss chest. A 'pathpick' / 'form' / 'offer' row (an offer follows) keeps the popup up longer.
  UI.showChest = (results, val) => {
    const me = ED.Game.view && ED.Game.view.me, list = $('chest-list'), el = $('ov-chest');
    list.textContent = '';
    let evo = false;
    for (const r of results) {
      const row = document.createElement('div'); row.className = 'chest-row';
      if (r.kind === 'offer' || r.kind === 'form' || r.kind === 'pathpick') {
        evo = true; row.classList.add('evo');
        row.appendChild(UI.iconCanvas(r.icon || 'fx.spark.magic', 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(r.txt || (r.kind === 'form' ? 'Choose a Form' : r.kind === 'pathpick' ? 'Choose a path' : 'An extra level-up'))}</span>`);
      } else if (r.kind === 'plvl' || r.kind === 'skill') {
        const d = r.kind === 'plvl' ? ED.PASSIVES[r.id] : ED.SKILLS[r.id], slot = me && (r.kind === 'plvl' ? me.passives : me.skills).find(x => x.id === r.id);
        if (d) row.appendChild(UI.iconCanvas(d.icon, 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(d ? d.name : r.id)}</span>` + `<span class="lv">LV ${slot ? slot.lvl : r.lvl}</span>`);
      } else {
        row.appendChild(UI.iconCanvas('pickup.coin', 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(r.txt || '+25 gold')}</span>`);
      }
      row.style.animationDelay = (list.children.length * 0.12 + 0.15) + 's';
      list.appendChild(row);
    }
    $('chest-head').textContent = (val === undefined ? evo : val >= 2) ? 'Boss chest!' : 'Chest!';
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
  // ws: { id, tune, path, pr, fl } (a net slot or a summary build entry).
  const buildLine = UI.buildLine = (ws) => {
    const d = ED.WEAPONS[ws.id], root = ED.WEAPONS[ED.weaponRoot(ws.id)];
    if (!d || !root) return '';
    const TM = ED.TUNE_MAX || 5, PM = ED.PATH_MAX || 5, pa = ws.path >= 0 && root.paths ? root.paths[ws.path] : null, out = ['Tune ' + (ws.tune | 0) + '/' + TM];
    if (pa) out.push(pa.name + ' ' + ((ws.pr && ws.pr[ws.path]) | 0) + '/' + PM);
    else if ((ws.tune | 0) >= TM && root.paths && root.paths.length) out.push('path: pick at a chest');
    if (d.form) out.push(d.name + ' Refine ' + (ws.fl | 0) + '/' + (d.refine ? d.refine.length : 2));
    else if (pa && ws.pr[ws.path] >= PM && ED.pathForms(root.id, ws.path).length) out.push('Form: boss chest');
    return root.name + ': ' + out.join(' · ');
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
        if (d) { s.appendChild(UI.iconCanvas(d.icon, 48)); s.insertAdjacentHTML('beforeend', `<b>${it.lvl}</b>`); s.title = d.name; }
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
  const R = { sum: null, anim: [], t0: 0, k: 1, skip: false, raf: 0, guardT: 0, fresh: new Set(), down: false, timer: 0, hover: -1 };
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
    d.style.animationDelay = (box.children.length * 0.05).toFixed(2) + 's';
    box.appendChild(d);
  };
  UI.renderResults = (sum, gained) => {
    hideChest(true);
    const scr = $('scr-results'), won = !!sum.won, t = $('res-title');
    R.sum = sum; R.anim = []; R.skip = false; R.k = 0; R.hover = -1; R.t0 = performance.now();
    scr.classList.remove('res-done');
    armGuard();
    t.textContent = won ? 'Victory' : 'Fallen';
    t.className = 'res-title ' + (won ? 'won' : 'lost');
    const me = sum.perHero.find(h => h.pid === ED.Game.myPid) || sum.perHero[0], sd = ED.STAGES[sum.stage], hd = me && ED.HEROES[me.cls], coop = sum.perHero.length > 1, lap = sum.lap || null;
    $('res-sub').innerHTML = [sd ? `<b>${esc(sd.name)}</b>` : '', hd ? `<b>${esc(hd.name)}</b>` : '', U.fmtTime(sum.time), coop ? sum.perHero.length + ' heroes' : ''].filter(Boolean).join('  ·  ');
    // tiles
    const tiles = $('res-tiles'), mine = me ? dealtTotal(me) : 0, top = me && me.top, topD = top && (ED.WEAPONS[top.id] || (ED.SKILLS && ED.SKILLS[top.id]));
    tiles.textContent = ''; tiles.classList.toggle('lap', !!lap);
    const plain = (v) => U.fmtNum(v), plus = (v) => '+' + Math.round(v);
    tile(tiles, 'Time', sum.time, (v) => U.fmtTime(v));
    tile(tiles, coop ? 'Party kills' : 'Kills', sum.kills, plain);
    tile(tiles, 'Level', sum.level, (v) => String(Math.round(v)));
    tile(tiles, 'Gold', sum.gold, plus, { icon: 'pickup.coin' });
    tile(tiles, coop ? 'Your damage' : 'Damage', me && me.dealt ? mine : null, fmtBig);
    tile(tiles, 'Best hit', top ? top.v : null, fmtBig, { icon: topD ? topD.icon : '', title: topD ? topD.name : '' });
    tile(tiles, 'Damage taken', me ? num(me.taken) : null, fmtBig, { cls: 'hurt' });
    tile(tiles, 'Healed', me ? num(me.healed) : null, fmtBig, { cls: 'heal' });
    if (lap) {
      const d = document.createElement('div'); d.className = 'tile lap';
      d.insertAdjacentHTML('beforeend', '<span>Last Light</span>');
      for (const [v, f] of [[lap.kills, (x) => '+' + U.fmtNum(x) + ' kills'], [lap.gold, (x) => '+' + Math.round(x) + ' gold']]) { const b = document.createElement('b'); b._v = +v || 0; b._f = f; b.textContent = f(0); R.anim.push(b); d.appendChild(b); }
      tiles.appendChild(d);
    }
    renderWeapons(sum, me);
    renderHighlights(sum, me);
    // passives
    const pas = $('res-pas'); pas.textContent = '';
    pas.insertAdjacentHTML('beforeend', '<span>Passives</span>');
    const pl = (me && me.pas) || [];
    for (const [id, lvl] of pl) {
      const d = ED.PASSIVES[id]; if (!d) continue;
      const s = document.createElement('div'); s.className = 'pslot'; s.title = d.name + ' ' + lvl + '/' + d.max;
      s.appendChild(UI.iconCanvas(d.icon, 48)); s.insertAdjacentHTML('beforeend', `<b>${lvl | 0}</b>`);
      pas.appendChild(s);
    }
    if (!pl.length) pas.insertAdjacentHTML('beforeend', '<span class="mut">none</span>');
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
    if (sum.note) add('', sum.note, 'note');
    if (gained) {
      for (const n of gained.news || []) add(n.kind === 'hero' ? heroIcon(n.id) : n.kind === 'ach' && ED.Codex ? ED.Codex.achIcon(n.id) : '', n.txt);
      if (gained.records && gained.records.length) add('', 'New record: ' + gained.records.join(', '));
    }
    $('btn-res-again').hidden = UI.lastMode !== 'solo';
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
    $('res-dmg-tot').textContent = tot ? fmtBig(tot) + ' total  ·  ' + fmtBig(tot / Math.max(1, sum.time)) + ' DPS' : '';
    box.insertAdjacentHTML('beforeend', '<div class="wt-head"><span></span><span class="nm">Weapon</span><span class="dmg">Damage</span><span class="pc">%</span><span>DPS</span><span>Kills</span></div>');
    const hasKw = !!h.kw;
    rows.slice(0, 8).forEach((r, i) => {
      const wd = ED.WEAPONS[r.id], b = r.kind === 'weapon' ? build.find(x => x.id === r.id) : null, s = r.kind === 'skill' ? sk.find(x => x[0] === r.id) : null;
      const own = r.kind === 'skill' ? sum.time : b && num(b.t0) !== null ? sum.time - b.t0 : 0, dps = own >= 1 && r.dmg > 0 ? r.dmg / own : 0;
      let line = '';
      if (b) {
        const root = ED.WEAPONS[ED.weaponRoot(b.id)];
        line = buildLine(b);
        if (root && root.id === b.id && line.startsWith(root.name + ': ')) line = line.slice(root.name.length + 2);
        if (b.t0 > 0) line += ' · from ' + U.fmtTime(b.t0);
      } else if (r.kind === 'skill') { const d = ED.SKILLS[r.id]; line = 'Skill' + (s && d ? ' · Level ' + s[1] + '/' + ED.skillMaxLvl(d) : ''); }
      else if (r.id === 'bomb') line = 'Pickup';
      const row = document.createElement('div');
      row.className = 'bar-row' + (wd && wd.evolved ? ' evo' : '') + (r.kind === 'skill' ? ' skill' : '');
      row.appendChild(UI.iconCanvas(r.icon || 'fx.hit.spark', 48));
      row.insertAdjacentHTML('beforeend', `<span class="bar-name">${esc(r.name)}</span><span class="bar"><i style="width:${r.dmg > 0 ? Math.max(1.5, 100 * r.dmg / max).toFixed(1) : 0}%;animation-delay:${(0.25 + i * 0.07).toFixed(2)}s"></i></span>`
        + `<span class="bar-v">${fmtBig(r.dmg)}</span><span class="bar-p">${Math.round(100 * r.frac)}%</span><span class="w-n">${dps ? fmtBig(dps) : '-'}</span><span class="w-n">${hasKw && r.kind !== 'other' ? U.fmtNum(r.kills || 0) : '-'}</span>`
        + `<span class="w-line">${esc(line)}</span>`);
      box.appendChild(row);
    });
  }
  // Highlights under the weapon table (shown when the viewport is tall enough): peak minute, kills per minute, gold picked up, fastest boss, downs, revives / bosses killed.
  function renderHighlights(sum, h) {
    const box = $('res-hl'), tl = sum.tl || [], B = sum.bosses || [], out = [];
    let pk = -1; tl.forEach((e, i) => { if (pk < 0 || e.k > tl[pk].k) pk = i; });
    if (pk >= 0) out.push(['Peak minute', U.fmtNum(tl[pk].k) + ' kills at ' + U.fmtTime(pk * 60)]);
    out.push(['Kills / min', U.fmtNum(sum.kills / Math.max(1, sum.time / 60))]);
    if (h && num(h.goldGot) !== null) out.push(['Gold picked up', U.fmtNum(h.goldGot)]);
    let fb = null; for (const b of B) if (b.t1 >= 0 && (!fb || b.t1 - b.t0 < fb.t1 - fb.t0)) fb = b;
    if (fb) out.push(['Fastest boss', U.fmtTime(fb.t1 - fb.t0) + ' ' + (ED.FOES[fb.id] ? ED.FOES[fb.id].name : '')]);
    if (h && num(h.downs) !== null) out.push(['Times downed', String(h.downs)]);
    if (sum.perHero.length > 1 && h && num(h.revs) !== null) out.push(['Revives given', String(h.revs)]);
    else if (B.length) out.push(['Bosses killed', B.filter(b => b.t1 >= 0).length + ' / ' + B.length]);
    box.innerHTML = out.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    box.hidden = !out.length;
  }
  function renderParty(sum, me) {
    const box = $('res-pane-party'); box.textContent = '';
    if (sum.perHero.length < 2) return;
    const v = (x) => (num(x) === null ? '-' : U.fmtNum(x));
    box.insertAdjacentHTML('beforeend', '<div class="ptab party hd"><span></span><span>Hero</span><span>Damage</span><span>Kills</span><span>Downs</span><span>Revives</span></div>');
    for (const h of sum.perHero) {
      const r = document.createElement('div'); r.className = 'ptab party' + (h === me ? ' me' : '');
      r.appendChild(UI.iconCanvas(heroIcon(h.cls), 48, '', h === me ? heroVar(h.cls) : ''));
      r.insertAdjacentHTML('beforeend', `<span>${esc(h.name)}</span><span>${h.dealt ? fmtBig(dealtTotal(h)) : '-'}</span><span>${v(h.kills)}</span><span>${v(h.downs)}</span><span>${v(h.revs)}</span>`);
      box.appendChild(r);
    }
  }
  function renderBosses(sum) {
    const box = $('res-pane-bosses'); box.textContent = '';
    const L = sum.bosses || [];
    if (!L.length) { box.insertAdjacentHTML('beforeend', '<span class="mut">No boss reached.</span>'); return; }
    box.insertAdjacentHTML('beforeend', '<div class="ptab boss hd"><span></span><span>Boss</span><span>Arrived</span><span>Killed in</span></div>');
    for (const b of L) {
      const d = ED.FOES[b.id], r = document.createElement('div'); r.className = 'ptab boss';
      r.appendChild(UI.iconCanvas(ED.Codex && ED.Codex.foeIcon ? ED.Codex.foeIcon(b.id) : '', 48));
      r.insertAdjacentHTML('beforeend', `<span>${esc(d ? d.name : b.id)}${b.f ? '<span class="tag">Final</span>' : ''}</span><span>${U.fmtTime(b.t0)}</span><span>${b.t1 >= 0 ? U.fmtTime(b.t1 - b.t0) : '<span class="no">alive</span>'}</span>`);
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
    if (!tl.length) { g.fillStyle = MUT; g.fillText('No full minute played.', 4 * dpr, fs + 4 * dpr); return; }
    let maxK = 1, maxLv = 1; for (const e of tl) { maxK = Math.max(maxK, e.k); maxLv = Math.max(maxLv, e.lv); }
    maxK = niceMax(maxK); maxLv = Math.max(5, Math.ceil(maxLv / 5) * 5);
    const lblK = fmtBig(maxK), lblLv = 'Lv ' + maxLv;
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
    const end = Math.min((i + 1) * 60, sum.time), boss = (sum.bosses || []).filter(b => b.t1 >= i * 60 && b.t1 < (i + 1) * 60).map(b => (ED.FOES[b.id] ? ED.FOES[b.id].name : b.id) + ' down');
    tip.textContent = U.fmtTime(i * 60) + '-' + U.fmtTime(end) + ':  ' + U.fmtNum(e.k) + ' kills · ' + fmtBig(e.d) + ' damage · Lv ' + e.lv + (boss.length ? ' · ' + boss.join(', ') : '');
    const bw = cv.parentNode.clientWidth, tw = tip.offsetWidth, cx = ev.clientX - r.left;
    tip.style.left = U.clamp(cx + 12, 0, Math.max(0, bw - tw)) + 'px';
  }

  // ---------------- co-op lobby ----------------
  // Drives the ED.Net lobby API; ED.Net.lobby { role, code, me, status, stage, members, inRun, canStart } is the single source of truth, ED.Net.onChange re-renders.
  const L = UI.lobby = { net: null };
  const NL = () => (ED.Net && ED.Net.lobby) || { role: '', code: '', me: '', status: 'idle', stage: 0, members: [], inRun: false, canStart: false };
  const netOk = () => !!(ED.Net && typeof ED.Net.host === 'function');
  const onJoin = () => !$('scr-join').hidden;
  let lastStatus = '';
  const wireNet = () => {
    const N = ED.Net; if (!N || L.net === N) return; L.net = N;
    N.onChange = (lb) => {
      if (lb.status !== lastStatus) {
        lastStatus = lb.status;
        if (lb.status === 'open') { if (lb.role === 'client') { say('join-msg', ''); if (onJoin()) UI.show('lobby'); } else say('lobby-msg', 'Party open. Share the code.'); }
      }
      if (!lb.inRun && App().state !== 'run' && !$('scr-lobby').hidden) UI.renderLobby();
    };
    N.onError = (msg) => { if (onJoin()) say('join-msg', msg, true); else say('lobby-msg', msg, true); };
    N.onClosed = (msg) => { if (App().state !== 'run' && App().state !== 'results') UI.leaveLobby(msg || 'The party closed.'); };
  };
  UI.hostParty = () => {
    const N = ED.Net; ensureProfile(); wireNet();
    if (!netOk()) { say('title-msg', 'Co-op is not available in this build.', true); return; }
    if (N.available && !N.available()) { say('title-msg', 'This browser cannot make peer connections.', true); return; }
    const A = App();
    if (!M.stageOpen(A.profile, A.sel.stage)) A.sel.stage = 0;
    try { N.host(A.profile.name, A.sel.cls); N.setStage(A.sel.stage); } catch (e) { say('title-msg', 'Could not open a party: ' + e.message, true); return; }
    say('lobby-msg', 'Opening the party...');
    UI.show('lobby'); UI.renderLobby();
  };
  UI.joinParty = () => {
    const N = ED.Net; ensureProfile(); wireNet();
    const code = N && N.cleanCode ? N.cleanCode($('inp-join').value) : String($('inp-join').value).toUpperCase();
    $('inp-join').value = code;
    if (code.length < 5) { say('join-msg', 'A party code has 5 letters.', true); return; }
    if (!netOk()) { say('join-msg', 'Co-op is not available in this build.', true); return; }
    if (N.available && !N.available()) { say('join-msg', 'This browser cannot make peer connections.', true); return; }
    say('join-msg', 'Connecting...');
    const A = App();
    try { N.join(code, A.profile.name, A.sel.cls); } catch (e) { say('join-msg', 'Could not join: ' + e.message, true); }
  };
  UI.leaveLobby = (msg) => {
    if (ED.Net && ED.Net.leave) ED.Net.leave();
    lastStatus = '';
    UI.renderTitle(); UI.show('title'); say('title-msg', msg || '', !!msg);
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
    $('lobby-title').textContent = host ? 'Your party' : 'Party';
    $('lobby-code').textContent = code;
    $('lobby-code-lbl').textContent = host ? 'Party code' : 'Joined';
    $('btn-lobby-copy').hidden = !host;
    const slots = $('lobby-slots'); slots.textContent = '';
    const mem = (s.members || []).slice().sort((a, b) => a.slot - b.slot);
    for (let i = 0; i < (ED.CONST.MAX_PLAYERS || 4); i++) {
      const m = mem.find(x => x.slot === i), d = document.createElement('div');
      if (!m) { d.className = 'slot empty'; d.innerHTML = `<span class="pnum">P${i + 1}</span><span>Waiting...</span>`; slots.appendChild(d); continue; }
      d.className = 'slot' + (m.pid === me ? ' me' : '');
      d.insertAdjacentHTML('beforeend', `<span class="pnum">P${i + 1}</span>`);
      const cs = m.cos || {}, nc = ED.COS_BY && ED.COS_BY[cs.ncol], tt = ED.COS_BY && ED.COS_BY[cs.title];
      d.appendChild(animCanvas(heroIcon(m.cls), 96, '', heroVar(m.cls, cs.skin || '')));
      const st2 = m.isHost ? ['host', 'Host'] : m.ready ? ['ready', 'Ready'] : ['wait', 'Not ready'];
      d.insertAdjacentHTML('beforeend', (tt && tt.kind === 'title' ? `<span class="sl-title">${esc(tt.name)}</span>` : '') +
        `<span class="sl-name"${nc && nc.kind === 'ncol' ? ` style="color:${nc.col}"` : ''}>${esc(m.name)}${m.pid === me ? ' (you)' : ''}</span><span class="sl-hero">${esc(ED.HEROES[m.cls] ? ED.HEROES[m.cls].name : m.cls)}</span><span class="sl-st ${st2[0]}">${st2[1]}</span>`);
      slots.appendChild(d);
    }
    const mine = mem.find(x => x.pid === me), cur = mine ? mine.cls : A.sel.cls;
    const hr = $('lobby-heroes'); hr.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const h = ED.HEROES[cls]; if (!h) continue;
      const open = M.heroOpen(A.profile, cls), b = document.createElement('button');
      b.className = 'pick-btn' + (cur === cls ? ' on' : ''); b.disabled = !open; b.title = h.name + (open ? '' : ' (locked)');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', cur === cls ? 'true' : 'false'); b.setAttribute('aria-label', h.name);
      b.appendChild(UI.iconCanvas(heroIcon(cls), 48, '', heroVar(cls)));
      b.onclick = () => { if (cur === cls) return; A.sel.cls = cls; A.saveSel(); sendPick(cls); UI.renderLobby(); const n = $('lobby-heroes').children[ED.HERO_IDS.indexOf(cls)]; if (n) n.focus(); };
      hr.appendChild(b);
    }
    const sr = $('lobby-stages'); sr.textContent = '';
    const stage = s.stage !== undefined ? s.stage : A.sel.stage;
    ED.STAGES.forEach((sd, i) => {
      if (stage !== i && M.stageHidden(A.profile, i)) return; // hidden until unlocked (shown when the host picked it)
      const b = document.createElement('button');
      b.className = 'pick-btn txt' + (stage === i ? ' on' : ''); b.textContent = (i + 1) + '. ' + sd.name;
      b.disabled = !host || !M.stageOpen(A.profile, i);
      b.onclick = () => setStage(i);
      sr.appendChild(b);
    });
    const go = $('btn-lobby-go');
    const ready = !!(mine && mine.ready);
    if (host) { go.textContent = s.canStart ? 'Start run' : 'Waiting for ready'; go.disabled = !s.canStart; }
    else { go.textContent = ready ? 'Cancel ready' : 'Ready'; go.disabled = s.status !== 'open' || !mine; go.classList.toggle('on', ready); }
  };
  const lobbyGo = () => {
    const lb = NL();
    if (lb.role !== 'host') { const mine = lb.members.find(x => x.pid === lb.me); ED.Net.setReady(!(mine && mine.ready)); return; }
    try { if (!ED.Net.start()) say('lobby-msg', 'Everyone must be ready.', true); } catch (e) { say('lobby-msg', 'Could not start: ' + e.message, true); }
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
    $('btn-credits').onclick = () => { opener = $('btn-credits'); $('ov-credits').hidden = false; };
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
      const done = () => say('code-msg', 'Code copied. Keep it somewhere safe.');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(done, () => { $('inp-code').select(); say('code-msg', 'Select the code and copy it.'); });
      else { $('inp-code').select(); say('code-msg', 'Select the code and copy it.'); }
    };
    $('btn-code-load').onclick = () => {
      try { A.replaceProfile(ED.Save.decode($('inp-code').value)); say('code-msg', 'Progress restored.'); UI.renderCamp(); }
      catch (e) { say('code-msg', e.message, true); }
    };
    $('btn-join-back').onclick = () => { if (ED.Net && ED.Net.leave) ED.Net.leave(); UI.renderTitle(); UI.show('title'); };
    $('btn-join-go').onclick = () => UI.joinParty();
    $('inp-join').addEventListener('input', () => { const N = ED.Net, el = $('inp-join'); el.value = N && N.cleanCode ? N.cleanCode(el.value) : el.value.toUpperCase(); });
    $('btn-lobby-leave').onclick = () => UI.leaveLobby('');
    $('btn-lobby-go').onclick = lobbyGo;
    $('btn-lobby-copy').onclick = () => { const c = $('lobby-code').textContent; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(() => say('lobby-msg', 'Code copied.'), () => {}); };
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
      else if (de.requestFullscreen) de.requestFullscreen().catch(() => say('title-msg', 'Fullscreen was refused by the browser.', true));
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
