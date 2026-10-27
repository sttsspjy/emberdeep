// DOM screens (client only): title, hero select, stage select, Camp shop (+ save code), join, lobby, results; overlays: level-up cards, chest popup, pause, settings, credits.
// ED.UI.show(name) shows one screen ('title' | 'hero' | 'stage' | 'camp' | 'join' | 'lobby' | 'results' | 'none'); overlays toggle separately.
// Menus work with mouse and keyboard: arrows / WASD move focus spatially inside the top layer, Enter / Space press, Esc presses the layer's [data-back] button.
// Meta calls go through ED.Meta[fn](profile, ...) when the progress lane provides fn, else ED.Save. Co-op goes through ED.Net.host / join / start when present,
// else the lobby runs on the foundation ED.Net.Host / Client sessions (start then reports that co-op runs are unavailable).
(function (ED) {
  'use strict';
  const U = ED.U;
  const $ = (id) => document.getElementById(id);
  const UI = ED.UI = { offerSig: '', lastMode: 'solo', prePlayed: null };
  const SCREENS = ['title', 'hero', 'stage', 'camp', 'join', 'lobby', 'results'];
  const LAYERS = ['ov-settings', 'ov-credits', 'ov-pause', 'ov-offer']; // top-most first
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  UI.esc = esc;
  const App = () => ED.App;

  // ---------------- meta adapter ----------------
  const metaFn = (k, fb) => (ED.Meta && typeof ED.Meta[k] === 'function' ? ED.Meta[k] : fb);
  const M = {
    rank: (p, id) => metaFn('rank', ED.Save.rank)(p, id),
    cost: (p, id) => metaFn('cost', ED.Save.shopCost)(p, id),
    buy: (p, id) => metaFn('buy', ED.Save.buy)(p, id),
    refundTotal: (p) => metaFn('refundTotal', ED.Save.refundTotal)(p),
    refundAll: (p) => metaFn('refundAll', ED.Save.refundAll)(p),
    heroOpen: (p, cls) => metaFn('heroUnlocked', ED.Save.heroUnlocked)(p, cls),
    stageOpen: (p, i) => metaFn('stageUnlocked', ED.Save.stageUnlocked)(p, i),
  };
  UI.M = M;
  // Progress toward a hero's unlock rule (0..1) from the profile records.
  const unlockProgress = (p, rule) => {
    if (!rule) return { k: 0, txt: '' };
    let best = 0, kills = 0;
    for (const id in p.best) { best = Math.max(best, p.best[id].time || 0); kills = Math.max(kills, p.best[id].kills || 0); }
    if (rule.survive) return { k: best / rule.survive, txt: U.fmtTime(best) + ' / ' + U.fmtTime(rule.survive) };
    if (rule.kills) return { k: kills / rule.kills, txt: kills + ' / ' + rule.kills };
    if (rule.level) return { k: p.stats.bestLevel / rule.level, txt: 'Level ' + p.stats.bestLevel + ' / ' + rule.level };
    if (rule.beat !== undefined) return { k: p.beat.indexOf(rule.beat) >= 0 ? 1 : 0, txt: '' };
    return { k: 0, txt: '' };
  };

  // ---------------- atlas icons ----------------
  // Draws frame i of anim id fitted into canvas cv (integer scale fixed by frame 0, so animated frames never jump).
  const paint = (cv, id, i) => {
    const A = ED.Atlas, g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (!A || !A.ok || !id) return;
    const r = A.anim(id); if (!r) return;
    const f = r.f[0], size = Math.min(cv.width, cv.height), s = Math.max(1, Math.floor(size / Math.max(f.w, f.h)));
    g.imageSmoothingEnabled = false;
    g.save(); g.translate(Math.round(cv.width / 2 - (f.ox + f.w / 2 - r.ax) * s), Math.round(cv.height / 2 - (f.oy + f.h / 2 - r.ay) * s)); g.scale(s, s);
    A.draw(g, id, i | 0, 0, 0); g.restore();
  };
  UI.iconCanvas = (id, size, cls) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = size; cv.className = 'icon' + (cls ? ' ' + cls : '');
    paint(cv, id, 0);
    return cv;
  };
  // Animated portraits: redrawn by one rAF loop while a menu shows them.
  const anims = [];
  let animOn = false;
  const animCanvas = (id, size, cls) => { const cv = UI.iconCanvas(id, size, cls); cv._anim = id; cv._f = 0; anims.push(cv); kick(); return cv; };
  const kick = () => { if (!animOn) { animOn = true; requestAnimationFrame(animLoop); } };
  function animLoop(now) {
    const A = ED.Atlas, t = now / 1000;
    for (let i = anims.length - 1; i >= 0; i--) {
      const cv = anims[i];
      if (!cv.isConnected) { anims.splice(i, 1); continue; }
      if (!A || !A.ok || cv.offsetParent === null) continue;
      const f = A.frameAt(cv._anim, t + (cv._off || 0));
      if (f !== cv._f) { cv._f = f; paint(cv, cv._anim, f); }
    }
    if (anims.length && !(App() && App().state === 'run')) requestAnimationFrame(animLoop); else animOn = false;
  }
  const heroIcon = (cls) => (ED.HEROES[cls] && ED.HEROES[cls].icon) || 'hero.' + cls + '.idle';
  const keyOf = (action, dflt) => { const I = ED.Input, l = I && I.labels ? I.labels(action) : null; return (l && l[0]) || dflt; };

  // ---------------- screens ----------------
  UI.show = (name) => {
    for (const s of SCREENS) { const el = $('scr-' + s); if (el) el.hidden = s !== name; }
    $('ui').classList.toggle('in-run', name === 'none');
    if (name === 'none') {
      const A = App();
      UI.prePlayed = A && A.profile ? A.profile.played.slice() : null;
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
      const cv = animCanvas(heroIcon(cls), 64); cv._off = i * 0.37;
      if (!M.heroOpen(p, cls)) cv.classList.add('locked');
      th.appendChild(cv);
    });
    const N = ED.Net, ok = !!(N && (N.host || N.Host));
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
      b.appendChild(animCanvas(heroIcon(cls), 96));
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
    const big = animCanvas(heroIcon(cls), 192, 'big'); big._off = 0.3; box.appendChild(big);
    const head = document.createElement('div'); head.className = 'hd-head';
    const hpK = U.clamp(h.hp / 130, 0, 1), spK = U.clamp((h.speed - 70) / 30, 0.1, 1);
    head.innerHTML = `<span class="hd-name">${esc(h.name)}</span><span class="hd-txt">${esc(h.txt || '')}</span>` +
      `<div class="hd-stats"><span>HP</span><span class="meter"><i style="width:${(hpK * 100).toFixed(0)}%;background:var(--red)"></i></span><b>${h.hp}</b>` +
      `<span>Speed</span><span class="meter"><i style="width:${(spK * 100).toFixed(0)}%;background:var(--blue)"></i></span><b>${h.speed}</b></div>`;
    box.appendChild(head);
    if (open) {
      const kit = document.createElement('div'); kit.className = 'hd-kit';
      const sig = ED.WEAPONS[h.sig], q = ED.SKILLS[h.skills[0]], e = ED.SKILLS[h.skills[1]];
      if (sig) kit.appendChild(kitRow(sig.icon, '', sig.name, sig.txt));
      if (q) kit.appendChild(kitRow(q.icon, keyOf('skill1', 'Q'), q.name, q.txt));
      if (e) kit.appendChild(kitRow(e.icon, keyOf('skill2', 'E'), e.name, e.txt));
      box.appendChild(kit);
    } else {
      const pr = unlockProgress(A.profile, rule), lk = document.createElement('div'); lk.className = 'lock-box';
      lk.innerHTML = `<span>Locked: ${esc(rule.txt || 'not yet available')}</span>` + (pr.txt ? `<span class="hd-stats"><span class="meter" style="width:16em"><i style="width:${(U.clamp(pr.k, 0, 1) * 100).toFixed(0)}%"></i></span><span class="mut">${esc(pr.txt)}</span></span>` : '');
      box.appendChild(lk);
    }
    const nx = $('btn-hero-next');
    nx.disabled = !open; nx.textContent = open ? 'Next' : 'Locked';
  }

  // ---------------- stage select ----------------
  const stagePrev = new Map();
  // Stage card art: floor tiles, deco and the final boss (cached per stage once the atlas is ready); stagePreview returns a fresh canvas.
  function stagePreview(i) {
    const out = document.createElement('canvas'); out.width = 256; out.height = 128; out.className = 'prev';
    out.getContext('2d').drawImage(stageArt(i), 0, 0);
    return out;
  }
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
  const SHOP_ICON = { growth: 'deco.crystal.1', greed: 'pickup.coin', revival: 'prop.trial', reroll: 'prop.portal', skip: 'prop.sign', vigor: 'pickup.heart', mending: 'pickup.flask.red', magnet: 'pickup.xp', fortune: 'fx.star.stun' };
  const shopIcon = (s) => s.icon || SHOP_ICON[s.id] || (ED.PASSIVES[s.id] && ED.PASSIVES[s.id].icon) || 'pickup.coin';
  const pips = (n, max, next) => { let h = '<span class="pips">'; for (let k = 0; k < max; k++) h += `<i class="${k < n ? 'f' : k === n && next ? 'nx' : ''}"></i>`; return h + '</span>'; };
  UI.renderCamp = (flash) => {
    const A = App(), p = A.profile, list = $('shop-list');
    $('camp-gold').textContent = p.gold;
    paint($('camp-coin'), 'pickup.coin', 0);
    list.textContent = '';
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
    if (setFrom === 'pause' && App().state === 'run' && ED.Game.paused) $('ov-pause').hidden = false;
    else refocus();
  };
  function syncSettings() {
    const s = App().settings;
    for (const b of $('set-quality').children) { const on = (s.quality || 'auto') === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('role', 'radio'); }
    for (const k of ['music', 'sfx']) { $('set-' + k).value = s[k]; $('set-' + k + '-v').textContent = s[k]; }
    const tog = (id, v) => { const b = $(id); b.setAttribute('aria-pressed', v ? 'true' : 'false'); b.textContent = v ? 'On' : 'Off'; };
    tog('set-numbers', s.numbers !== false); tog('set-shake', s.shake !== false); tog('set-full', !!document.fullscreenElement);
  }
  // Screen shake off: the camera offset read by render.js (ED.FX.shakeXY) is zeroed; ED.FX.shakeOn mirrors the setting for the FX lane.
  function hookShake() {
    const F = ED.FX; if (!F || F._uiShake || typeof F.shakeXY !== 'function') return;
    const base = F.shakeXY; F._uiShake = true;
    F.shakeXY = (out) => { base(out); if (App().settings && App().settings.shake === false) { out.x = 0; out.y = 0; } return out; };
    F.shakeOn = App().settings.shake !== false;
  }

  // ---------------- level-up offer ----------------
  const pairName = (id) => (ED.PASSIVES[id] ? ED.PASSIVES[id].name : id);
  // Card face: badge, level pips, second line (evolution hint), evolution-ready flag.
  function cardInfo(me, c) {
    const o = { badge: '', bcls: '', max: 0, lvl: c.lvl || 0, sub: c.sub || '', evo: false, ready: false };
    if (c.kind === 'weapon' || c.kind === 'wlvl') {
      const d = ED.WEAPONS[c.id]; if (!d) return o;
      o.max = ED.weaponMaxLvl ? ED.weaponMaxLvl(d) : 8;
      o.badge = c.kind === 'weapon' ? 'NEW' : 'LV ' + c.lvl; o.bcls = c.kind === 'weapon' ? 'new' : 'lv';
      if (d.evo && d.pair && !o.sub) {
        const has = me && me.passives.some(ps => ps.id === d.pair);
        if (c.lvl >= o.max) { o.ready = !!has; o.sub = has ? 'Evolves at the next chest' : 'Evolves with ' + pairName(d.pair); }
        else o.sub = 'Evolves with ' + pairName(d.pair) + (has ? ' (owned)' : '');
        o.evo = true;
      } else if (d.sig && c.kind === 'weapon' && !o.sub) o.sub = 'Signature weapon';
    } else if (c.kind === 'passive' || c.kind === 'plvl') {
      const d = ED.PASSIVES[c.id]; o.max = d ? d.max : 5;
      o.badge = c.kind === 'passive' ? 'NEW' : 'LV ' + c.lvl; o.bcls = c.kind === 'passive' ? 'new' : 'lv';
      if (c.kind === 'passive' && me) for (const ws of me.weapons) {
        const wd = ED.WEAPONS[ws.id];
        if (wd && wd.pair === c.id && wd.evo && !wd.evolved && ws.lvl >= (ED.weaponMaxLvl ? ED.weaponMaxLvl(wd) : 8)) { o.ready = true; o.sub = 'Evolves ' + wd.name + '!'; break; }
      }
      o.evo = !!o.sub;
    } else if (c.kind === 'skill') {
      const d = ED.SKILLS[c.id]; o.max = d && ED.skillMaxLvl ? ED.skillMaxLvl(d) : 4;
      const idx = me ? me.skills.findIndex(sk => sk.id === c.id) : -1;
      o.badge = (idx === 1 ? keyOf('skill2', 'E') : keyOf('skill1', 'Q')) + ' skill LV ' + c.lvl; o.bcls = 'sk';
    }
    return o;
  }
  // Shows the hero's current offer; hides when there is none. Rebuilt only when the offer changes. solo: big cards (the run is paused); co-op: bottom strip.
  UI.syncOffer = (me, solo) => {
    const ov = $('ov-offer'), offer = me && !me.dead ? me.offer : null;
    const sig = offer ? offer.map(c => c.kind + c.id + c.lvl).join('|') + '|' + me.rerolls + me.skips + (solo ? 's' : 'c') : '';
    if (sig === UI.offerSig) return;
    UI.offerSig = sig;
    ov.hidden = !offer;
    ov.classList.toggle('strip', !solo);
    if (!offer) return;
    const v = ED.Game.view;
    $('offer-title').textContent = solo ? 'Level ' + (v ? v.level : '') + '!' : 'Level up: press 1-' + offer.length;
    const box = $('offer-cards'); box.textContent = '';
    offer.forEach((c, i) => {
      const f = cardInfo(me, c), b = document.createElement('button');
      b.className = 'offer-card k-' + c.kind + (f.ready ? ' evo-ready' : '');
      b.insertAdjacentHTML('beforeend', `<span class="key">${keyOf('pick' + (i + 1), String(i + 1))}</span>`);
      b.appendChild(UI.iconCanvas(c.icon, 64, 'ic'));
      b.insertAdjacentHTML('beforeend', `<b class="card-name">${esc(c.name)}</b>` + (f.badge ? `<span class="badge ${f.bcls}">${esc(f.badge)}</span>` : '') +
        `<span class="card-txt">${esc(c.txt)}</span>` + (f.sub ? `<span class="card-sub${f.evo ? ' evo' : ''}">${esc(f.sub)}</span>` : '') + (f.max > 1 ? pips(f.lvl, f.max, false) : ''));
      b.onclick = () => ED.Game.pick(i);
      box.appendChild(b);
    });
    const rr = $('btn-reroll'), sk = $('btn-skip');
    rr.textContent = 'Reroll (' + keyOf('reroll', 'R') + ') ' + me.rerolls; rr.disabled = !(me.rerolls > 0);
    sk.textContent = 'Skip (' + keyOf('skip', 'X') + ') ' + me.skips; sk.disabled = !(me.skips > 0);
    $('offer-foot').hidden = !(me.rerolls > 0 || me.skips > 0);
  };

  // ---------------- chest popup ----------------
  let chestT = 0, chestOut = 0;
  function hideChest(now) {
    clearTimeout(chestT); clearTimeout(chestOut);
    const el = $('ov-chest');
    if (now) { el.hidden = true; el.classList.remove('out'); return; }
    el.classList.add('out'); chestOut = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 350);
  }
  UI.showChest = (results) => {
    const me = ED.Game.view && ED.Game.view.me, list = $('chest-list'), el = $('ov-chest');
    list.textContent = '';
    let evo = false;
    for (const r of results) {
      const row = document.createElement('div'); row.className = 'chest-row';
      if (r.kind === 'evo') {
        evo = true; row.classList.add('evo');
        const a = ED.WEAPONS[r.from], b = ED.WEAPONS[r.id];
        if (a) row.appendChild(UI.iconCanvas(a.icon, 48));
        row.insertAdjacentHTML('beforeend', '<span class="arrow">&gt;</span>');
        if (b) row.appendChild(UI.iconCanvas(b.icon, 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(b ? b.name : r.id)}</span>`);
      } else if (r.kind === 'wlvl' || r.kind === 'plvl') {
        const d = r.kind === 'wlvl' ? ED.WEAPONS[r.id] : ED.PASSIVES[r.id], slot = me && (r.kind === 'wlvl' ? me.weapons : me.passives).find(x => x.id === r.id);
        if (d) row.appendChild(UI.iconCanvas(d.icon, 48));
        row.insertAdjacentHTML('beforeend', `<span>${esc(d ? d.name : r.id)}</span>` + (slot ? `<span class="lv">LV ${slot.lvl}</span>` : ''));
      } else {
        row.appendChild(UI.iconCanvas('pickup.coin', 48));
        row.insertAdjacentHTML('beforeend', '<span>+25 gold</span>');
      }
      row.style.animationDelay = (list.children.length * 0.12 + 0.15) + 's';
      list.appendChild(row);
    }
    $('chest-head').textContent = evo ? 'EVOLUTION!' : 'Chest!';
    if (evo && ED.HUD) ED.HUD.banner = null; // the popup replaces the 'evolved' banner
    clearTimeout(chestT); clearTimeout(chestOut);
    el.classList.remove('out'); el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    chestT = setTimeout(() => hideChest(false), evo ? 3800 : 2800);
  };
  UI.onEvent = (ev) => {
    if (ev.t === 'chest' && ev.pid === ED.Game.myPid && ev.results && ev.results.length) UI.showChest(ev.results);
  };

  // ---------------- pause ----------------
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
    row(me.weapons, ED.WEAPONS, ED.MAX_WEAPONS || 6);
    row(me.passives, ED.PASSIVES, ED.MAX_PASSIVES || 6);
  }

  // ---------------- results ----------------
  UI.renderResults = (sum, gained) => {
    hideChest(true);
    const A = App(), won = !!sum.won, t = $('res-title');
    t.textContent = won ? 'Victory!' : 'Fallen';
    t.className = 'res-title ' + (won ? 'won' : 'lost');
    const me = sum.perHero.find(h => h.pid === ED.Game.myPid) || sum.perHero[0], sd = ED.STAGES[sum.stage];
    $('res-sub').textContent = (sd ? sd.name : '') + (me && ED.HEROES[me.cls] ? '  -  ' + ED.HEROES[me.cls].name : '');
    $('res-stats').innerHTML = `<div><b>${U.fmtTime(sum.time)}</b><span>Time</span></div><div><b>${U.fmtNum(sum.kills)}</b><span>Kills</span></div><div><b>${sum.level}</b><span>Level</span></div><div><b>+${sum.gold}</b><span>Gold</span></div>`;
    const chart = $('res-chart');
    chart.textContent = '';
    if (me) {
      const rows = Object.entries(me.dealt).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
      let tot = 0; for (const r of rows) tot += r[1];
      const max = rows.length ? rows[0][1] : 1;
      chart.insertAdjacentHTML('beforeend', `<span class="ch-head">Damage dealt${rows.length ? ': ' + U.fmtNum(tot) : ''}</span>`);
      rows.forEach(([id, v], i) => {
        const wd = ED.WEAPONS[id], sk = ED.SKILLS[id], d = wd || sk, row = document.createElement('div');
        row.className = 'bar-row' + (wd && wd.evolved ? ' evo' : '') + (sk && !wd ? ' skill' : '');
        row.appendChild(UI.iconCanvas(d ? d.icon : 'fx.hit.spark', 48));
        row.insertAdjacentHTML('beforeend', `<span class="bar-name">${esc(d ? d.name : id)}</span><span class="bar"><i style="width:${Math.max(1.5, 100 * v / max).toFixed(1)}%;animation-delay:${(i * 0.06).toFixed(2)}s"></i></span><span class="bar-v">${U.fmtNum(v)}</span><span class="bar-p">${tot ? Math.round(100 * v / tot) : 0}%</span>`);
        chart.appendChild(row);
      });
      chart.hidden = !rows.length;
    }
    const party = $('res-party'); party.textContent = '';
    if (sum.perHero.length > 1) for (const h of sum.perHero) {
      const d = document.createElement('div'); d.className = 'pm';
      d.appendChild(UI.iconCanvas(heroIcon(h.cls), 48));
      d.insertAdjacentHTML('beforeend', `<span>${esc(h.name)}</span><span class="mut">${U.fmtNum(h.kills)} kills</span>`);
      party.appendChild(d);
    }
    const un = $('res-unlocks'); un.textContent = '';
    const add = (icon, text) => { const d = document.createElement('div'); d.className = 'unlock'; if (icon) d.appendChild(UI.iconCanvas(icon, 48)); d.insertAdjacentHTML('beforeend', `<span>${esc(text)}</span>`); un.appendChild(d); };
    if (gained) {
      for (const c of gained.unlocked || []) add(heroIcon(c), 'New hero: ' + (ED.HEROES[c] ? ED.HEROES[c].name : c));
      for (const s of gained.stages || []) add('', 'New stage: ' + (ED.STAGES[s] ? ED.STAGES[s].name : s));
    }
    if (me && UI.prePlayed && UI.prePlayed.indexOf(me.cls) < 0 && A.profile.played.indexOf(me.cls) >= 0 && ED.UNLOCKS.sigAfterRun) {
      const h = ED.HEROES[me.cls], w = h && ED.WEAPONS[h.sig];
      if (w) add(w.icon, w.name + ' joins the weapon pool');
    }
    UI.prePlayed = null;
    $('btn-res-again').hidden = UI.lastMode !== 'solo';
  };

  // ---------------- co-op lobby ----------------
  // Session: ED.Net.host(me, handlers) / ED.Net.join(code, me, handlers) when the net lane defines them, else new ED.Net.Host / Client (lobby only).
  // me = { name, cls, meta }; handlers: lobby(state), status(kind, msg), code(code), welcome(d), joined(pid), left(pid, name), error(msg), closed(msg).
  const L = UI.lobby = { sess: null, role: '', state: null, ready: false, pid: '' };
  const myPick = () => { const A = App(); return { name: A.profile.name, cls: A.sel.cls, meta: ED.Save.metaBundle(A.profile) }; };
  const handlers = () => ({
    lobby: (s) => { L.state = s; if (L.role === 'guest' && !$('scr-join').hidden) UI.show('lobby'); UI.renderLobby(); },
    status: (kind, msg) => { if (kind === 'error') say('lobby-msg', msg, true); else if (kind === 'open') say('lobby-msg', 'Party open. Share the code.'); },
    code: () => UI.renderLobby(),
    welcome: (d) => { L.pid = d.pid; say('join-msg', ''); UI.show('lobby'); UI.renderLobby(); },
    joined: () => say('lobby-msg', 'A hero joined.'),
    left: (pid, name) => say('lobby-msg', (name || 'A hero') + ' left.'),
    error: (msg) => { if (L.role === 'guest' && !$('scr-join').hidden) { say('join-msg', msg, true); closeSess(); } else say('lobby-msg', msg, true); },
    closed: (msg) => UI.leaveLobby(msg || 'The party closed.'),
  });
  const closeSess = () => { const s = L.sess; L.sess = null; L.state = null; L.ready = false; if (s && s.close) try { s.close(); } catch (e) { /* already closed */ } };
  UI.hostParty = () => {
    const N = ED.Net; ensureProfile();
    if (!N || !(N.host || N.Host)) { say('title-msg', 'Co-op is not available in this build.', true); return; }
    if (N.available && !N.available()) { say('title-msg', 'This browser cannot make peer connections.', true); return; }
    closeSess();
    L.role = 'host'; L.pid = 'host';
    try { L.sess = typeof N.host === 'function' ? N.host(myPick(), handlers()) : new N.Host(myPick(), handlers()); } catch (e) { say('title-msg', 'Could not open a party: ' + e.message, true); return; }
    if (!M.stageOpen(App().profile, App().sel.stage)) App().sel.stage = 0;
    if (L.sess) L.sess.stage = App().sel.stage;
    L.state = L.sess && L.sess.lobbyState ? L.sess.lobbyState() : null;
    say('lobby-msg', 'Opening the party...');
    UI.show('lobby'); UI.renderLobby();
  };
  UI.joinParty = () => {
    const N = ED.Net; ensureProfile();
    const code = N && N.cleanCode ? N.cleanCode($('inp-join').value) : String($('inp-join').value).toUpperCase();
    $('inp-join').value = code;
    if (code.length < 5) { say('join-msg', 'A party code has 5 letters.', true); return; }
    if (!N || !(N.join || N.Client)) { say('join-msg', 'Co-op is not available in this build.', true); return; }
    closeSess();
    L.role = 'guest'; L.pid = '';
    say('join-msg', 'Connecting...');
    try { L.sess = typeof N.join === 'function' ? N.join(code, myPick(), handlers()) : new N.Client(code, myPick(), handlers()); } catch (e) { say('join-msg', 'Could not join: ' + e.message, true); }
  };
  UI.leaveLobby = (msg) => {
    closeSess(); L.role = '';
    UI.renderTitle(); UI.show('title'); say('title-msg', msg || '', !!msg);
  };
  const myId = () => (L.sess && L.sess.pid) || L.pid || (L.role === 'host' ? 'host' : '');
  const sendPick = () => {
    const s = L.sess; if (!s) return;
    const pk = myPick();
    if (typeof s.setPick === 'function') s.setPick(pk);
    else if (L.role === 'host' && s.setMe) s.setMe({ cls: pk.cls, meta: pk.meta });
    else if (s.send) s.send({ t: 'pick', cls: pk.cls, meta: pk.meta });
    L.ready = false;
  };
  const sendReady = (v) => { const s = L.sess; if (!s) return; L.ready = v; if (typeof s.setReady === 'function') s.setReady(v); else if (s.send) s.send({ t: 'ready', v }); UI.renderLobby(); };
  const setStage = (i) => {
    const s = L.sess, A = App(); if (!s || L.role !== 'host' || !M.stageOpen(A.profile, i)) return;
    A.sel.stage = i; A.saveSel();
    if (typeof s.setStage === 'function') s.setStage(i); else { s.stage = i; if (s.broadcastLobby) s.broadcastLobby(); }
    UI.renderLobby();
  };
  UI.renderLobby = (st) => {
    if (st) L.state = st;
    const A = App(), s = L.state || { members: [], code: L.sess && L.sess.code, stage: A.sel.stage }, host = L.role === 'host', me = myId();
    const code = (L.sess && L.sess.code) || s.code || '-----';
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
      d.appendChild(animCanvas(heroIcon(m.cls), 96));
      const st2 = m.isHost ? ['host', 'Host'] : m.ready ? ['ready', 'Ready'] : ['wait', 'Not ready'];
      d.insertAdjacentHTML('beforeend', `<span class="sl-name">${esc(m.name)}${m.pid === me ? ' (you)' : ''}</span><span class="sl-hero">${esc(ED.HEROES[m.cls] ? ED.HEROES[m.cls].name : m.cls)}</span><span class="sl-st ${st2[0]}">${st2[1]}</span>`);
      slots.appendChild(d);
    }
    const mine = mem.find(x => x.pid === me), cur = mine ? mine.cls : A.sel.cls;
    const hr = $('lobby-heroes'); hr.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const h = ED.HEROES[cls]; if (!h) continue;
      const open = M.heroOpen(A.profile, cls), b = document.createElement('button');
      b.className = 'pick-btn' + (cur === cls ? ' on' : ''); b.disabled = !open; b.title = h.name + (open ? '' : ' (locked)');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', cur === cls ? 'true' : 'false'); b.setAttribute('aria-label', h.name);
      b.appendChild(UI.iconCanvas(heroIcon(cls), 48));
      b.onclick = () => { if (cur === cls) return; A.sel.cls = cls; A.saveSel(); sendPick(); UI.renderLobby(); const n = $('lobby-heroes').children[ED.HERO_IDS.indexOf(cls)]; if (n) n.focus(); };
      hr.appendChild(b);
    }
    const sr = $('lobby-stages'); sr.textContent = '';
    const stage = s.stage !== undefined ? s.stage : A.sel.stage;
    ED.STAGES.forEach((sd, i) => {
      const b = document.createElement('button');
      b.className = 'pick-btn txt' + (stage === i ? ' on' : ''); b.textContent = (i + 1) + '. ' + sd.name;
      b.disabled = !host || !M.stageOpen(A.profile, i);
      b.onclick = () => setStage(i);
      sr.appendChild(b);
    });
    const go = $('btn-lobby-go');
    if (host) {
      const allReady = mem.length > 0 && mem.every(m => m.ready || m.isHost);
      go.textContent = allReady ? 'Start run' : 'Waiting for ready'; go.disabled = !allReady;
    } else { go.textContent = L.ready ? 'Cancel ready' : 'Ready'; go.disabled = !L.sess || !mine; go.classList.toggle('on', L.ready); }
  };
  const lobbyGo = () => {
    if (L.role !== 'host') { sendReady(!L.ready); return; }
    const N = ED.Net;
    if (N && typeof N.start === 'function') { try { N.start(L.sess, { stage: App().sel.stage }); } catch (e) { say('lobby-msg', 'Could not start: ' + e.message, true); } }
    else say('lobby-msg', 'Co-op runs are not available in this build yet.', true);
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
  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea, a[href]';
  const items = (layer) => [...layer.querySelectorAll(FOCUSABLE)].filter(visible);
  function focusLayer() {
    const L0 = topLayer(); if (!L0) return;
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
    move(layer, d[0], d[1]);
  }

  // ---------------- bind ----------------
  UI.bind = () => {
    const A = App();
    $('btn-play').onclick = () => { ensureProfile(); say('title-msg', ''); UI.renderHeroes(); UI.show('hero'); };
    $('btn-host').onclick = () => { say('title-msg', ''); UI.hostParty(); };
    $('btn-join').onclick = () => { ensureProfile(); say('title-msg', ''); say('join-msg', ''); UI.show('join'); $('inp-join').focus(); };
    $('btn-camp').onclick = () => { ensureProfile(); say('title-msg', ''); UI.renderCamp(); UI.show('camp'); };
    $('btn-settings').onclick = () => UI.openSettings('title');
    $('btn-credits').onclick = () => { opener = $('btn-credits'); $('ov-credits').hidden = false; };
    $('btn-credits-close').onclick = () => { $('ov-credits').hidden = true; refocus(); };
    $('btn-hero-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-hero-next').onclick = () => { if (!M.heroOpen(A.profile, A.sel.cls)) return; UI.renderStages(); UI.show('stage'); };
    $('btn-stage-back').onclick = () => { UI.renderHeroes(); UI.show('hero'); };
    $('btn-start').onclick = () => { if (!M.stageOpen(A.profile, A.sel.stage) || !M.heroOpen(A.profile, A.sel.cls)) return; A.startSolo(); };
    $('btn-camp-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
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
    $('btn-join-back').onclick = () => { closeSess(); UI.renderTitle(); UI.show('title'); };
    $('btn-join-go').onclick = () => UI.joinParty();
    $('inp-join').addEventListener('input', () => { const N = ED.Net, el = $('inp-join'); el.value = N && N.cleanCode ? N.cleanCode(el.value) : el.value.toUpperCase(); });
    $('btn-lobby-leave').onclick = () => UI.leaveLobby('');
    $('btn-lobby-go').onclick = lobbyGo;
    $('btn-lobby-copy').onclick = () => { const c = $('lobby-code').textContent; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(() => say('lobby-msg', 'Code copied.'), () => {}); };
    $('btn-resume').onclick = () => A.togglePause(false);
    $('btn-pause-settings').onclick = () => UI.openSettings('pause');
    $('btn-quit').onclick = () => A.quitRun();
    $('btn-res-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-res-again').onclick = () => { if (M.heroOpen(A.profile, A.sel.cls) && M.stageOpen(A.profile, A.sel.stage)) A.startSolo(); else { UI.renderHeroes(); UI.show('hero'); } };
    $('btn-reroll').onclick = () => ED.Game.reroll();
    $('btn-skip').onclick = () => ED.Game.skip();
    // settings
    $('btn-settings-close').onclick = closeSettings;
    for (const b of $('set-quality').children) b.onclick = () => { A.settings.quality = b.dataset.v; store(); syncSettings(); };
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
    // keyboard and mouse share one highlight: moving the mouse over a button focuses it (a still cursor never steals focus when a screen changes under it)
    window.addEventListener('keydown', onKey, true);
    let lx = -1, ly = -1;
    $('ui').addEventListener('pointermove', (e) => {
      if (e.clientX === lx && e.clientY === ly) return;
      lx = e.clientX; ly = e.clientY;
      const b = e.target.closest && e.target.closest('button'); if (!b || b.disabled) return;
      const ae = document.activeElement; if (ae && (ae.tagName === 'INPUT' && ae.type !== 'range' || ae.tagName === 'TEXTAREA')) return;
      if (ae !== b) b.focus({ preventScroll: true });
    });
  };
})(globalThis.ED || (globalThis.ED = {}));
