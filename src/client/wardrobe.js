// Wardrobe screen (reached from the Camp): one tab per cosmetic kind (ED.COS_KINDS), skins per hero; every card has a preview, a state line and one button
// (Buy <price> / Wear / Take off; rewards name their achievement). Purchases and equips go through ED.Save (buyCos / wear) on ED.App.profile and persist at once.
// Previews: skins animate the hero sprite in the skin; tints recolour a slash sprite (ED.Pix ramp); kill and level-up effects are a static 64 x 64 art-px picture
// (the effect sprite recoloured, a fixed particle pattern in the effect's colours, the chosen hero under level-ups); titles and name colours are text.
(function (ED) {
  'use strict';
  const UI = ED.UI, SV = ED.Save, esc = UI.esc, T = ED.t, L = ED.tr;
  const $ = (id) => document.getElementById(id);
  const App = () => ED.App;
  const TABS = [['skin', () => T('Skins')], ['tint', () => T('Weapon tints')], ['kill', () => T('Kill effects')], ['lvl', () => T('Level-ups')], ['title', () => T('Titles')], ['ncol', () => T('Name colours')]];
  // Effect pictures by kind and style ('' = the default look): [particle pattern, colours, effect sprite ('' = none)].
  const PAT = {
    kill: { '': ['burst', ['#d8c8b0', '#ffffff'], ''], embers: ['rise', ['#ff7a2a', '#ffe08a'], 'fx.ember'], souls: ['rise', ['#9fdcff', '#ffffff'], 'fx.glint'],
      shatter: ['burst', ['#7fe3ff', '#c8f6ff'], 'fx.ice.burst'], gold: ['fall', ['#ffd24a', '#fff4c0'], 'pickup.coin'], nova: ['ring', ['#ff7ad9', '#ffffff'], ''] },
    lvl: { '': ['ring', ['#6ad7ff', '#ffffff'], ''], pillar: ['column', ['#fff0c2', '#ffffff'], ''], runes: ['ring', ['#a070ff', '#f2ecff'], 'fx.circle.spark'],
      fireworks: ['three', ['#ff7ad9', '#ffd36b', '#7fe3ff'], ''], ascend: ['burst', ['#ffd24a', '#ffffff'], 'fx.spark.magic'] },
  };
  const W = ED.Wardrobe = { tab: 'skin', hero: '' };
  const div = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; return d; };
  const mid = (id) => { const r = ED.Atlas.anim(id); return r ? r.n >> 1 : 0; };
  const PO = { variant: '' };
  // Draws the largest frame of anim id centred on (x, y) of context g (variant vk).
  function centred(g, id, x, y, vk) {
    const A = ED.Atlas, r = A.anim(id); if (!r) return;
    let bi = 0, ba = -1; r.f.forEach((f, i) => { if (f.w * f.h > ba) { ba = f.w * f.h; bi = i; } });
    const f = r.f[bi]; PO.variant = vk || '';
    A.draw(g, id, bi, Math.round(x - (f.ox + f.w / 2 - r.ax)), Math.round(y - (f.oy + f.h / 2 - r.ay)), PO);
  }
  // Kill / level-up picture of item d (null = default) on a 64 x 64 canvas.
  function fxPreview(kind, d) {
    const pat = PAT[kind][d ? d.style : ''] || PAT[kind][''], cols = pat[1], S = 64, c = S / 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = S; cv.className = 'icon wd-prev wd-fx';
    const g = cv.getContext('2d'), H = (i, k) => (ED.U.hash3(i, k, 7) % 1000) / 1000;
    g.imageSmoothingEnabled = false;
    const sq = (x, y, i) => { g.fillStyle = cols[i % cols.length]; const z = i % 4 ? 2 : 3; g.fillRect(Math.round(x), Math.round(y), z, z); };
    if (kind === 'lvl') { PO.variant = UI.heroVar(W.hero); ED.Atlas.draw(g, 'hero.' + W.hero + '.idle', 0, c, c + 20, PO); }
    if (pat[2]) centred(g, pat[2], c, kind === 'lvl' ? c + 6 : c, pat[2] === 'pickup.coin' ? '' : ED.Pix.variant(pat[2], cols[0]));
    const P = pat[0];
    if (P === 'burst') for (let i = 0; i < 16; i++) { const a = H(i, 1) * 6.283, r = 8 + H(i, 2) * 18; sq(c + Math.cos(a) * r, c + Math.sin(a) * r, i); }
    else if (P === 'rise') for (let i = 0; i < 12; i++) sq(c + (H(i, 1) - 0.5) * 22, c + 6 - H(i, 2) * 30, i);
    else if (P === 'fall') for (let i = 0; i < 12; i++) { const u = (i / 11 - 0.5) * 2; sq(c + u * 22, c + 4 - 24 * (1 - u * u) + H(i, 3) * 4, i); }
    else if (P === 'ring') { for (let i = 0; i < 20; i++) { const a = i / 20 * 6.283; sq(c + Math.cos(a) * 24 - 1, c + 6 + Math.sin(a) * (kind === 'lvl' ? 10 : 24) - 1, i); } if (kind === 'kill') for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; sq(c + Math.cos(a) * 10, c + Math.sin(a) * 10, i + 1); } }
    else if (P === 'column') for (let i = 0; i < 18; i++) sq(c + (H(i, 1) - 0.5) * 12, c + 20 - H(i, 2) * 50, i);
    else if (P === 'three') for (let b = 0; b < 3; b++) for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; g.fillStyle = cols[b]; g.fillRect(Math.round(c + (b - 1) * 18 + Math.cos(a) * 7), Math.round(14 + (b % 2) * 6 + Math.sin(a) * 7), 2, 2); }
    return cv;
  }

  // Preview canvas of item d (null = the slot's default look).
  function preview(kind, d) {
    const A = ED.Atlas, P = ED.Pix;
    if (kind === 'skin') { const cls = W.hero; return UI.animCanvas(UI.heroIcon(cls), 96, 'wd-prev', UI.heroVar(cls, d ? d.id : '')); }
    if (kind === 'kill' || kind === 'lvl') return fxPreview(kind, d);
    let id = 'fx.slash.arc';
    const ramp = d ? d.id : '';
    if (!A.has(id)) id = 'fx.burst';
    const vk = ramp && P ? P.variant(id, ramp) : '', cv = UI.iconCanvas(id, 96, 'wd-prev', vk);
    UI.paint(cv, id, mid(id), vk);
    return cv;
  }
  // Text preview of a title / name colour item (null = default), shown with the profile name.
  function textPrev(kind, d) {
    const p = App().profile, nc = SV.worn(p, 'ncol') && ED.COS_BY[SV.worn(p, 'ncol')], tt = SV.worn(p, 'title') && ED.COS_BY[SV.worn(p, 'title')];
    const title = kind === 'title' ? (d ? L(d.name) : '') : tt ? L(tt.name) : '', col = kind === 'ncol' ? (d ? d.col : '') : nc ? nc.col : '';
    const pv = div('wd-prev wd-tag');
    const cols = kind === 'ncol' && d && d.cols, st = cols ? `background:linear-gradient(90deg,${cols.join(',')});-webkit-background-clip:text;background-clip:text;color:transparent` : col ? 'color:' + col : '';
    pv.innerHTML = `<span class="wd-title">${esc(title || ' ')}</span><span class="wd-name" translate="no"${st ? ` style="${st}"` : ''}>${esc(p.name)}</span>`;
    return pv;
  }
  const achName = (id) => { const a = ED.ACHIEVEMENTS.find(x => x.id === SV.cosAch(id)); return a ? L(SV.achText(a).name) : T('an achievement'); };
  const slotCls = () => (W.tab === 'skin' ? W.hero : undefined);

  W.render = (flash) => {
    const A = App(), p = A.profile;
    if (!W.hero || !ED.HEROES[W.hero]) W.hero = A.sel.cls || ED.HERO_IDS[0];
    $('wd-gold').textContent = p.gold;
    UI.paint($('wd-coin'), 'pickup.coin', 0);
    const own = p.cos.length, all = ED.COSMETICS.length;
    $('wd-hint').textContent = SV.cosLeft(p) ? T('Looks only, never power. Owned {0} / {1}, {2} gold for the rest.', own, all, ED.U.fmtNum(SV.cosLeft(p))) : T('Looks only, never power. Owned {0} / {1}.', own, all);
    // tabs
    const tabs = $('wd-tabs'); tabs.textContent = '';
    for (const [k, name] of TABS) {
      const b = document.createElement('button'), on = k === W.tab;
      b.className = 'btn btn-sm' + (on ? ' on' : ''); b.textContent = name(); b.dataset.tab = k;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.onclick = () => { if (W.tab === k) return; W.tab = k; UI.say('wd-msg', ''); W.render(); const nb = tabs.querySelector('[data-tab="' + k + '"]'); if (nb) nb.focus(); };
      tabs.appendChild(b);
    }
    // hero row (skins only)
    const hr = $('wd-heroes'); hr.textContent = ''; hr.hidden = W.tab !== 'skin';
    if (W.tab === 'skin') for (const cls of ED.HERO_IDS) {
      const h = ED.HEROES[cls]; if (!h) continue;
      const b = document.createElement('button'), on = cls === W.hero;
      b.className = 'pick-btn' + (on ? ' on' : ''); b.dataset.cls = cls; b.title = L(h.name);
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('aria-label', L(h.name));
      b.appendChild(UI.iconCanvas(UI.heroIcon(cls), 48, '', UI.heroVar(cls)));
      b.onclick = () => { if (W.hero === cls) return; W.hero = cls; W.render(); const nb = hr.querySelector('[data-cls="' + cls + '"]'); if (nb) nb.focus(); };
      hr.appendChild(b);
    }
    // cards: the default look first, then the items of this tab (skins: of the chosen hero)
    const list = $('wd-list'); list.textContent = '';
    const kind = W.tab, cls = slotCls(), worn = SV.worn(p, kind, cls);
    const items = ED.COSMETICS.filter(d => d.kind === kind && (kind !== 'skin' || d.hero === cls));
    const card = (d) => {
      const id = d ? d.id : '', isWorn = id === worn, owned = !d || SV.cosOwned(p, id), cost = d ? SV.cosCost(p, id) : 0;
      const c = div('wd-item' + (isWorn ? ' worn' : '') + (owned ? ' owned' : ''));
      c.appendChild(kind === 'title' || kind === 'ncol' ? textPrev(kind, d) : preview(kind, d));
      const state = isWorn ? T('Worn') : owned ? T('Owned') : cost ? T('{0} gold', cost) : T('Reward: {0}', achName(id));
      c.insertAdjacentHTML('beforeend', `<span class="wd-iname">${esc(d ? L(d.name) : T('Default'))}</span><span class="wd-state">${esc(state)}</span>`);
      const b = document.createElement('button');
      b.className = 'btn btn-sm'; b.dataset.id = id || 'default';
      if (isWorn) { b.textContent = d ? T('Take off') : T('Worn'); b.disabled = !d; b.onclick = () => { SV.wear(p, '', kind, cls); A.persist(); W.render('default'); }; }
      else if (owned) { b.textContent = T('Wear'); b.onclick = () => { SV.wear(p, id, kind, cls); A.persist(); W.render(id); }; }
      else if (cost) {
        b.textContent = T('Buy {0}', cost); b.disabled = p.gold < cost;
        b.onclick = () => { if (!SV.buyCos(p, id)) return; SV.wear(p, id, kind, cls); A.persist(); UI.say('wd-msg', () => T('Bought and wearing {0}.', L(d.name))); W.render(id); };
      } else { b.textContent = T('Locked'); b.disabled = true; }
      c.appendChild(b);
      return c;
    };
    list.appendChild(card(null));
    for (const d of items) list.appendChild(card(d));
    if (flash) { const nb = list.querySelector('[data-id="' + flash + '"]'); if (nb && !nb.disabled) nb.focus(); else { const t = tabs.querySelector('.on'); if (t) t.focus(); } }
  };
})(globalThis.ED || (globalThis.ED = {}));
