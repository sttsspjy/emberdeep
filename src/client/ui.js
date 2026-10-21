// DOM screens and overlays: main menu, sections (Descend, Hearth, Heroes), lobby, results, boon picker, character sheet, settings with key rebinding.
(function (ED) {
  'use strict';
  const U = ED.U, S = ED.Save;
  const UI = ED.UI = {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  UI.esc = esc;
  const LOCK = '<svg class="ico-lock" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7V5a3 3 0 0 1 6 0v2h1.2c.4 0 .8.4.8.8v6.4c0 .4-.4.8-.8.8H3.8c-.4 0-.8-.4-.8-.8V7.8c0-.4.4-.8.8-.8zm1.6 0h2.8V5a1.4 1.4 0 0 0-2.8 0z"/></svg>';
  const keys = (action) => ED.Input.labels(action).map(k => `<kbd>${esc(k)}</kbd>`).join('');

  UI.show = (name) => {
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== 'scr-' + name;
    $('loading').hidden = true;
    requestAnimationFrame(() => { const f = document.querySelector(`#scr-${name} [data-focus]`); if (f && f.offsetParent) f.focus({ preventScroll: true }); });
  };
  UI.hideScreens = () => { for (const el of document.querySelectorAll('.screen')) el.hidden = true; };

  UI.toast = (html, icon, life) => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--life', (life || 3.4) + 's');
    el.innerHTML = (icon ? `<img src="${icon}" alt="">` : '') + `<span>${html}</span>`;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), ((life || 3.4) + 0.5) * 1000);
  };

  UI.confirm = (title, text, yesLabel, onYes) => {
    $('modal-title').textContent = title; $('modal-text').textContent = text; $('modal-yes').textContent = yesLabel || 'Confirm';
    $('modal').hidden = false;
    $('modal-yes').onclick = () => { $('modal').hidden = true; onYes(); };
    $('modal-no').onclick = () => { $('modal').hidden = true; };
    $('modal-no').focus();
  };

  const copy = (text, btn) => {
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = o; }, 1400); };
    try { navigator.clipboard.writeText(text).then(done, () => { selectText(btn.previousElementSibling); }); } catch (e) { selectText(btn.previousElementSibling); }
  };
  const selectText = (el) => { if (!el) return; const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };

  const portrait = (cls, size, slot, weapon) => { const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; ED.Sprites.portrait(cv, cls, slot || 0, weapon); if (ED.Actors && ED.Actors.on()) ED.Actors.fit(cv, () => ED.Sprites.portrait(cv, cls, slot || 0, weapon)); return cv; };

  // Path helpers: elements share ids with their paths (fire, ice, lightning, poison, holy, shadow).
  const pathIcon = (k) => ED.Icons.url(ED.PATHS[k].icon, ED.PATHS[k].color);
  const pathName = (k, wrap) => (ED.PATHS[k] ? (wrap ? `<i style="color:${ED.PATHS[k].color}">${ED.PATHS[k].name}</i>` : ED.PATHS[k].name) : '');
  UI.evoName = (path, weaponId) => (ED.PATHS[path] ? ED.PATHS[path].evo : '') + (ED.WEAPONS[weaponId] ? ' ' + ED.WEAPONS[weaponId].name : ' Arms');
  const affChip = (el, kind) => (el && ED.PATHS[el] ? `<span class="aff-chip ${kind}" style="--pc:${ED.PATHS[el].color}"><img alt="" src="${pathIcon(el)}">${kind === 'weak' ? 'Weak to' : 'Resists'} ${ED.PATHS[el].name}</span>` : '');
  const affChips = (biome) => affChip(biome.weak, 'weak') + affChip(biome.resist, 'resist');

  // Roster keys: arrows move between menu entries and tabs.
  const arrowNav = (root, sel, prev, next) => root.addEventListener('keydown', (e) => {
    if (e.code !== prev && e.code !== next) return;
    const items = [...root.querySelectorAll(sel)].filter(b => !b.hidden && !b.disabled), i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); items[(i + (e.code === next ? 1 : -1) + items.length) % items.length].focus();
  });

  // ---------------- main menu ----------------
  UI.renderTitle = () => {
    const A = ED.App, p = A.profile;
    const has = !!A.hasProfile;
    $('title-new').hidden = has; $('title-menu').hidden = !has; $('title-profile').hidden = !has;
    if (has) {
      $('title-name').textContent = p.name; $('title-embers').textContent = p.embers;
      $('dot-hearth').hidden = !(canBuyUpgrade(p) || canBuyRelic(p));
    }
    $('title-load').hidden = true;
    const jc = A.pendingJoin;
    $('title-join').hidden = !jc || !has;
    if (jc) $('title-join-code').textContent = jc;
  };

  // ---------------- sections ----------------
  UI.tab = 'descend';
  const SECTION = { descend: 'Descend', upgrades: 'Hearth', relics: 'Hearth', chronicle: 'Hearth', heroes: 'Heroes' };
  UI.setTab = (t) => {
    UI.tab = t;
    $('sec-title').textContent = SECTION[t] || 'Descend';
    $('hearth-tabs').hidden = SECTION[t] !== 'Hearth';
    for (const b of document.querySelectorAll('#hearth-tabs .tab')) b.classList.toggle('on', b.dataset.tab === t);
    for (const p of document.querySelectorAll('.pane')) p.hidden = p.dataset.pane !== t;
    UI.renderHearth();
  };

  const canBuyUpgrade = (p) => ED.UPGRADES.some(u => S.upgradeAvailable(p, u) && p.up[ED.UPGRADE_IDX[u.id]] < u.costs.length && p.embers >= u.costs[p.up[ED.UPGRADE_IDX[u.id]]]);
  const canBuyRelic = (p) => ED.RELIC_IDS.some(id => !S.relicUnlocked(p, id) && S.relicReqMet(p, id) && p.embers >= (ED.RELICS[id].cost || 9999));

  UI.renderHearth = () => {
    const p = ED.App.profile;
    $('hearth-embers').textContent = p.embers;
    $('dot-upgrades').hidden = !canBuyUpgrade(p);
    $('dot-relics').hidden = !canBuyRelic(p);
    if (UI.tab === 'descend') renderDescend();
    else if (UI.tab === 'upgrades') renderUpgrades();
    else if (UI.tab === 'relics') renderRelics();
    else if (UI.tab === 'heroes') renderHeroes($('heroes-view'));
    else if (UI.tab === 'chronicle') renderChronicle();
  };

  // Hero tiles. `inspect` lets locked heroes be picked too (Heroes view); otherwise a locked tile only says how to unlock it.
  function rosterTiles(container, selected, onPick, inspect) {
    const p = ED.App.profile;
    container.innerHTML = '';
    for (const id of ED.CLASS_IDS) {
      const c = ED.CLASSES[id];
      const unlocked = S.classUnlocked(p, id);
      const b = document.createElement('button');
      b.className = 'hero-tile' + (id === selected ? ' on' : '') + (unlocked ? '' : ' locked');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', id === selected ? 'true' : 'false');
      b.appendChild(portrait(id, 64));
      const info = document.createElement('div');
      info.innerHTML = `<div class="cn">${c.name}</div><div class="cm">${unlocked ? 'Mastery ' + S.masteryLevel(p, id) : LOCK + esc(c.unlock.text)}</div>`;
      b.appendChild(info);
      if (unlocked || inspect) b.onclick = () => { ED.Audio.play('click'); onPick(id); };
      else b.onclick = () => UI.toast(`${c.name} unlocks: ${esc(c.unlock.text)}`);
      container.appendChild(b);
    }
  }

  function weaponChips(container, cls, selected, onPick) {
    const p = ED.App.profile, ml = S.masteryLevel(p, cls);
    container.innerHTML = '';
    ED.CLASSES[cls].weapons.forEach((wid, i) => {
      const w = ED.WEAPONS[wid], ok = ED.weaponUnlocked(cls, i, ml);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'weapon-chip' + (wid === selected ? ' on' : '') + (ok ? '' : ' locked');
      b.innerHTML = `<b>${w.name}</b><small>${ok ? esc(w.desc) : LOCK + 'Unlocks at mastery ' + (i === 1 ? 3 : 6)}</small>`;
      if (ok) b.onclick = () => { ED.Audio.play('click'); onPick(wid); };
      container.appendChild(b);
    });
  }

  // Pact levels 0..max as steps; every step up to the chosen one is lit because pacts stack.
  function pactSteps(container, value, max, onPick) {
    container.innerHTML = '';
    container.classList.toggle('ro', !onPick);
    for (let i = 0; i <= max; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = i; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', i === value ? 'true' : 'false');
      b.className = 'pact-step' + (i === value ? ' on' : i < value ? ' lit' : '');
      b.title = i ? ED.PACTS[i].desc : 'No pact';
      if (onPick) b.onclick = () => { ED.Audio.play('click'); onPick(i); }; else b.tabIndex = -1;
      container.appendChild(b);
    }
  }

  function renderDescend() {
    const A = ED.App, p = A.profile;
    const cls = A.sel.cls, c = ED.CLASSES[cls];
    rosterTiles($('class-list'), cls, (id) => { A.selectClass(id); renderDescend(); });
    const st = ED.Stats.compute({ cls, weapon: A.sel.weapon, boons: {}, relics: [], meta: S.metaBundle(p, cls), pact: A.sel.pact });
    const skills = [[c.skill, 'skill1', st.skillCd], [c.skill2, 'skill2', st.skill2Cd]].filter(x => ED.SKILLS[x[0]]);
    $('hero-detail').innerHTML = `
      <div class="hd-top"><div id="hd-port"></div><div><div class="hd-name">${c.name}</div><div class="hd-title">${c.title}</div><p class="hd-desc">${esc(c.desc)}</p></div></div>
      <div class="hd-skills">${skills.map(([id, act, cd]) => { const sk = ED.SKILLS[id]; return `<div class="hd-skill"><img alt="" src="${ED.Icons.url(sk.icon, c.col.c)}"><div><div class="sk-head"><b>${sk.name}</b>${keys(act)}<span class="cd">${cd.toFixed(1)}s cooldown</span></div><p>${esc(sk.desc)}</p></div></div>`; }).join('')}</div>`;
    $('hd-port').appendChild(portrait(cls, 96, 0, A.sel.weapon));
    weaponChips($('weapon-row'), cls, A.sel.weapon, (wid) => { A.sel.weapon = wid; A.saveSel(); renderDescend(); });
    const ar = $('asc-row');
    ar.hidden = p.pactMax <= 0;
    if (p.pactMax > 0) {
      const v = Math.min(A.sel.pact, p.pactMax);
      $('asc-val').textContent = v;
      pactSteps($('asc-steps'), v, p.pactMax, (i) => { A.sel.pact = i; A.saveSel(); renderDescend(); });
      $('asc-desc').textContent = pactText(v);
    }
    $('btn-host').disabled = !ED.Net.available();
    $('btn-join').disabled = !ED.Net.available();
    $('run-goal').innerHTML = goalText(p);
  }

  function pactText(v) {
    const lines = [];
    for (let i = 1; i <= v; i++) lines.push(ED.PACTS[i].desc);
    return v ? lines.join(' ') + ` Embers +${Math.round(ED.PACT_EMBER_BONUS * v * 100)}%.` : 'No pact sworn. The Deep as it is.';
  }

  // The single most useful next goal; the first two descents also get the two rules that shape a run.
  function goalText(p) {
    const next = ED.CLASS_IDS.find(c => !S.classUnlocked(p, c));
    const tierNext = ED.UPGRADES.find(u => u.tier > p.stats.deepest);
    const lines = [];
    if (p.stats.runs < 2) {
      lines.push(`<b>Paths:</b> follow up to ${ED.MAX_ELEMENTS} of ${ED.ELEMENT_IDS.map(k => pathName(k, true)).join(', ')}, or take the ${pathName('general', true)} path alone as a Generalist. Each stratum is weak to one element.`);
      lines.push(`<b>Lantern:</b> every new room costs light (shown on its door). In the dark elites and the Gloom hunt you, but rooms pay more; <kbd>${esc(ED.Input.label('flare'))}</kbd> flares the Gloom away, and spare light shields you at the boss door.`);
    }
    if (p.stats.runs === 0) lines.push('<b>First goal:</b> reach the Bone Warden at the end of the Ossuary. Every descent pays embers, win or lose.');
    else if (next) lines.push(`<b>Next hero:</b> ${ED.CLASSES[next].name} (${esc(ED.CLASSES[next].unlock.text)}).`);
    else if (tierNext) lines.push(`<b>Reach stratum ${U.roman(tierNext.tier)}</b> to reveal new Hearth upgrades.`);
    else if (p.stats.wins > 0 && p.pactMax < 10) lines.push(`<b>Pacts:</b> complete a descent under Pact ${p.pactMax} to unlock Pact ${p.pactMax + 1}.`);
    else lines.push('<b>Every relic, hero and pact is yours.</b> The Deep still has deeds to earn.');
    return lines.join('<br>');
  }

  function buyButton(cost, can, label, onClick) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'btn buy' + (can ? ' btn-primary' : ' cant');
    b.innerHTML = `<span class="ember-ico"></span>${cost}`;
    b.disabled = !can; b.setAttribute('aria-label', label); b.title = label;
    b.onclick = onClick;
    return b;
  }

  function renderUpgrades(grid) {
    const p = ED.App.profile;
    grid = grid || $('up-grid');
    grid.innerHTML = '';
    for (let tier = 1; tier <= 4; tier++) {
      const list = ED.UPGRADES.filter(u => u.tier === tier);
      const open = tier <= 1 || p.stats.deepest >= tier;
      const h = document.createElement('div'); h.className = 'tier-head';
      h.textContent = open ? (tier === 1 ? 'Foundations' : `Revealed at stratum ${U.roman(tier)}`) : `Reach stratum ${U.roman(tier)} to reveal`;
      grid.appendChild(h);
      for (const u of list) {
        const i = ED.UPGRADE_IDX[u.id], r = p.up[i], max = u.costs.length;
        const card = document.createElement('div');
        card.className = 'up-card' + (open ? '' : ' locked') + (r >= max ? ' maxed' : '');
        const pips = Array.from({ length: max }, (_, k) => `<span class="pip${k < r ? ' on' : ''}"></span>`).join('');
        card.innerHTML = `<img alt="" src="${ED.Icons.url(u.icon, '#ff9a4a')}"><div><div class="un">${u.name}${r >= max ? ' <span class="badge-max">Max</span>' : ''}</div><div class="ud">${open ? (r ? esc(u.desc(r)) : 'Not learned yet') : '???'}</div>${open && r < max ? `<div class="un2">Next: ${esc(u.step)}</div>` : ''}<div class="pips">${pips}</div></div>`;
        if (open && r < max) {
          const cost = u.costs[r];
          card.appendChild(buyButton(cost, p.embers >= cost, `Buy ${u.name}: ${u.step} for ${cost} embers`, () => { if (S.buyUpgrade(p, u.id)) { ED.Audio.play('buy'); ED.App.afterMetaChange(); } }));
        }
        grid.appendChild(card);
      }
    }
  }

  function renderRelics(grid) {
    const p = ED.App.profile;
    grid = grid || $('relic-grid');
    grid.innerHTML = '';
    const order = { c: 0, r: 1, e: 2, l: 3 };
    const ids = ED.RELIC_IDS.slice().sort((a, b) => (S.relicUnlocked(p, b) - S.relicUnlocked(p, a)) || order[ED.RELICS[a].rar] - order[ED.RELICS[b].rar]);
    const owned = ids.filter(id => S.relicUnlocked(p, id)).length;
    let lastOwned = null;
    for (const id of ids) {
      const r = ED.RELICS[id], un = S.relicUnlocked(p, id), col = ED.RARITY[r.rar].color;
      if (lastOwned !== un) {
        lastOwned = un;
        const h = document.createElement('div'); h.className = 'tier-head'; h.textContent = un ? `Unlocked (${owned})` : `Not yet unlocked (${ids.length - owned})`;
        grid.appendChild(h);
      }
      const card = document.createElement('div');
      let req = '';
      if (!un && r.req && r.req.boss && !S.relicReqMet(p, id)) req = `Requires defeating ${ED.ENEMIES[ED.BIOMES[r.req.boss - 1].boss].name}`;
      const buyable = !un && !req;
      card.className = 'relic-card' + (un ? '' : ' locked') + (buyable ? '' : ' nocost');
      card.style.setProperty('--rc', col);
      card.innerHTML = `<img alt="" src="${ED.Icons.relicUrl(id)}"><div><div class="rn">${r.name}</div><div class="rd">${esc(r.desc)}</div><div class="rq">${ED.RARITY[r.rar].name}${req ? ' · ' + esc(req) : ''}</div></div>`;
      if (buyable) card.appendChild(buyButton(r.cost, p.embers >= r.cost, `Unlock ${r.name} for ${r.cost} embers`, () => { if (S.unlockRelic(p, id)) { ED.Audio.play('relic'); ED.App.afterMetaChange(); } }));
      grid.appendChild(card);
    }
  }

  // Heroes: roster on the left, stats and mastery of the inspected hero on the right.
  UI.heroSel = null;
  function renderHeroes(container) {
    const A = ED.App, p = A.profile;
    if (!UI.heroSel || !ED.CLASSES[UI.heroSel]) UI.heroSel = A.sel.cls;
    const cls = UI.heroSel, c = ED.CLASSES[cls], ci = ED.CLASS_IDS.indexOf(cls);
    const un = S.classUnlocked(p, cls);
    container.innerHTML = '<div class="roster list"></div><div class="plate hv-detail"></div>';
    const list = container.firstChild, detail = container.lastChild;
    rosterTiles(list, cls, (id) => { UI.heroSel = id; renderHeroes(container); }, true);
    const xp = p.mastery[ci], ml = ED.masteryLevel(xp);
    const next = ED.MASTERY_XP[ml] !== undefined ? ED.MASTERY_XP[ml] : null, prev = ED.MASTERY_XP[ml - 1];
    const frac = next === null ? 1 : (xp - prev) / (next - prev);
    let html = `<div class="hd-top"><div id="hv-port"></div><div><div class="hd-name">${c.name}</div><div class="hd-title">${c.title}</div><p class="hd-desc">${esc(c.desc)}</p></div></div>`;
    if (!un) {
      html += `<div class="hd-skill"><div></div><div><div class="sk-head"><b>${LOCK}Locked</b></div><p>${esc(c.unlock.text)}</p></div></div>`;
    } else {
      const st = ED.Stats.compute({ cls, weapon: A.weaponFor(cls), boons: {}, relics: [], meta: S.metaBundle(p, cls), pact: 0 });
      html += `<div class="hd-stats">
        <div class="hd-stat"><b>${st.maxHp}</b><span>Health</span></div><div class="hd-stat"><b>${Math.round(st.armor)}</b><span>Armor</span></div>
        <div class="hd-stat"><b>${Math.round(st.moveSpeed)}</b><span>Speed</span></div><div class="hd-stat"><b>${Math.round(st.crit * 100)}%</b><span>Crit</span></div></div>
        <div><div class="mast-head"><b>Mastery ${ml}</b><span>${next !== null ? `${xp} / ${next} xp` : 'Complete'}</span></div><div class="bar"><i style="width:${Math.round(U.clamp(frac, 0, 1) * 100)}%"></i></div></div>
        <ul class="mast-rewards">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map(l => {
    let label = ED.MASTERY_REWARDS[l];
    if (l === 3) label = 'Weapon: ' + ED.WEAPONS[c.weapons[1]].name;
    if (l === 6) label = 'Weapon: ' + ED.WEAPONS[c.weapons[2]].name;
    return `<li class="${ml >= l ? 'got' : ''}"><b>Lv ${l}</b><span>${esc(label)}</span></li>`;
  }).join('')}</ul>`;
    }
    detail.innerHTML = html;
    detail.querySelector('#hv-port').appendChild(portrait(cls, 96, 0, un ? A.weaponFor(cls) : undefined));
    if (un) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-lg hv-pick' + (A.sel.cls === cls ? '' : ' btn-primary');
      b.textContent = A.sel.cls === cls ? 'Your hero for the next descent' : `Take ${c.name}`; b.disabled = A.sel.cls === cls;
      b.onclick = () => { A.selectClass(cls); if (A.state === 'lobby') A.lobbyPick(); renderHeroes(container); };
      detail.appendChild(b);
    }
  }

  function renderChronicle() {
    const p = ED.App.profile;
    const dl = $('deed-list'); dl.innerHTML = '';
    ED.DEEDS.forEach((d, i) => {
      const done = !!(p.deeds & (1 << i));
      dl.insertAdjacentHTML('beforeend', `<div class="deed${done ? ' done' : ''}"><img alt="" src="${ED.Icons.url(d.icon, done ? '#e6c27a' : '#8a7a6a')}"><div><div class="dn">${esc(d.name)}</div><div class="dd">${esc(d.desc)}</div></div><div class="dr">${done ? 'Earned' : '+' + d.reward + ' embers'}</div></div>`);
    });
    const st = p.stats;
    $('records').innerHTML = [
      ['Descents', st.runs], ['Victories', st.wins], ['Deepest stratum', st.deepest ? U.roman(st.deepest) : '—'], ['Foes slain', st.kills],
      ['Bosses slain', st.bossKills], ['Fastest victory', st.bestTime ? U.fmtTime(st.bestTime) : '—'], ['Highest pact won', p.pactWin >= 0 ? p.pactWin : '—'], ['Lifetime embers', p.lifetime],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const sl = $('strata-list'); sl.innerHTML = '';
    ED.BIOMES.forEach((b, i) => {
      const seen = st.deepest > i, slain = !!(p.bosses & (1 << i));
      sl.insertAdjacentHTML('beforeend', `<div class="stratum${seen ? '' : ' unseen'}"><i style="background:radial-gradient(circle at 40% 35%, ${b.pal.accent}, ${b.pal.floorA})"></i><div><b>${U.roman(i + 1)}. ${seen ? b.name : '???'}</b><small>${seen ? esc(slain ? ED.LORE[i] : b.blurb) : 'Undiscovered'}</small><div class="aff-list">${affChips(b)}</div></div></div>`);
    });
  }

  // Names travel inside the save code, so only a small alphabet is kept. Say so instead of silently changing it.
  function nameHint(inp, msg) {
    const raw = inp.value.trim();
    const kept = raw.split('').filter(ch => S.NAME_CHARS.indexOf(ch) >= 0).join('').trim();
    const off = !!raw && kept !== raw;
    msg.textContent = off ? `Only letters A–Z, numbers, spaces and hyphens are kept: you will appear as "${S.sanitizeName(raw)}".` : 'Letters A–Z, numbers, spaces and hyphens, up to 12';
    msg.className = 'msg name-msg' + (off ? ' warn' : '');
  }

  // ---------------- lobby ----------------
  UI.renderLobby = (state, myPid, isHost) => {
    const A = ED.App;
    $('lobby-code').textContent = state.code || '-----';
    const mem = $('lobby-members'); mem.innerHTML = '';
    for (let i = 0; i < ED.CONST.MAX_PLAYERS; i++) {
      const m = state.members.find(x => x.slot === i);
      const div = document.createElement('div');
      if (!m) { div.className = 'member empty'; div.textContent = 'Waiting for a hero…'; mem.appendChild(div); continue; }
      div.className = 'member';
      div.style.borderColor = ED.PLAYER_COLORS[m.slot];
      div.appendChild(portrait(m.cls, 64, m.slot, m.weapon));
      div.insertAdjacentHTML('beforeend', `<div><div class="mn" style="color:${ED.PLAYER_COLORS[m.slot]}">${esc(m.name)}${m.pid === myPid ? ' (you)' : ''}</div><div class="mc">${ED.CLASSES[m.cls].name} · ${ED.WEAPONS[m.weapon].name}</div></div><div class="mr${m.ready || m.isHost ? ' ready' : ''}">${m.isHost ? 'Host' : m.ready ? 'Ready' : 'Not ready'}</div>`);
      mem.appendChild(div);
    }
    rosterTiles($('lobby-classes'), A.sel.cls, (id) => { A.selectClass(id); A.lobbyPick(); });
    weaponChips($('lobby-weapons'), A.sel.cls, A.sel.weapon, (wid) => { A.sel.weapon = wid; A.saveSel(); A.lobbyPick(); });
    // pact: the host sets it; friends see what they are agreeing to
    const la = $('lobby-asc');
    la.hidden = isHost ? A.profile.pactMax <= 0 : !(state.pact > 0);
    $('lobby-asc-lbl').textContent = isHost ? 'Pact of the Deep' : 'Pact of the Deep (set by the host)';
    $('lobby-asc-val').textContent = state.pact;
    pactSteps($('lobby-asc-steps'), state.pact | 0, isHost ? A.profile.pactMax : (state.pact | 0), isHost ? (i) => A.setLobbyPact(i) : null);
    $('lobby-asc-desc').textContent = pactText(state.pact | 0);
    $('dot-lobby-hearth').hidden = !(canBuyUpgrade(A.profile) || canBuyRelic(A.profile));
    const me = state.members.find(x => x.pid === myPid);
    const go = $('btn-lobby-go');
    if (isHost) {
      const allReady = state.members.every(m => m.ready || m.isHost);
      go.textContent = state.members.length < 2 ? 'Begin (solo party)' : allReady ? 'Begin the descent' : 'Waiting for ready…';
      go.disabled = !allReady;
    } else {
      go.textContent = me && me.ready ? 'Not ready' : 'Ready';
      go.disabled = false;
    }
  };
  UI.lobbyStatus = (text, err) => { $('lobby-status').textContent = text; $('lobby-status').style.color = err ? 'var(--danger)' : ''; };

  // ---------------- party Hearth (spend embers without leaving the lobby) ----------------
  UI.phTab = 'upgrades';
  UI.openPartyHearth = () => { $('ov-hearth').hidden = false; UI.renderPartyHearth(); };
  UI.renderPartyHearth = () => {
    if ($('ov-hearth').hidden) return;
    const p = ED.App.profile;
    $('ph-embers').textContent = p.embers;
    $('ph-dot-upgrades').hidden = !canBuyUpgrade(p);
    $('ph-dot-relics').hidden = !canBuyRelic(p);
    for (const b of document.querySelectorAll('#ph-tabs .tab')) b.classList.toggle('on', b.dataset.tab === UI.phTab);
    for (const t of ['upgrades', 'relics', 'heroes']) $('ph-' + t).hidden = t !== UI.phTab;
    if (UI.phTab === 'upgrades') renderUpgrades($('ph-upgrades'));
    else if (UI.phTab === 'relics') renderRelics($('ph-relics'));
    else renderHeroes($('ph-heroes'));
  };

  // ---------------- boon picker ----------------
  // Cards ignore input for a moment after they appear, so a key or click meant for combat never picks one.
  let boonFocus = 0, boonOffer = null, boonLock = 0;
  const BOON_LOCK_MS = 700;
  const OFFER_HEAD = { start: 'Choose your first path', level: 'Choose a boon', epic: 'An epic boon', forge: 'Temper — rank up a boon' };

  // [header, subtitle, path colour key] for an offer message { src, forge }.
  function offerHead(offer, me) {
    const src = offer.forge ? 'forge' : (offer.src || 'level');
    const boons = me && me.boons ? me.boons : {}, main = ED.mainPath(boons);
    if (src === 'room') {
      const els = ED.elementGates(boons).length;
      return [OFFER_HEAD.level, ED.isGeneralist(boons) ? 'Boons of your General path' : els < ED.MAX_ELEMENTS ? `A new path may be offered (${els}/${ED.MAX_ELEMENTS} used)` : 'Boons of your paths', main];
    }
    if (src === 'class') {
      const cn = me && ED.CLASSES[me.cls] ? ED.CLASSES[me.cls].name : 'Class', rt = me && me.boons ? ED.classRoute(me.boons, me.cls) : null;
      if (offer.ctier === 1) return ['Choose your route', `It shapes how ${cn} fights`, null];
      if (offer.ctier === 2) return [`${rt && rt.route ? ED.routeLabel(me.cls, rt.route) : 'Route'}: choose your fork`, 'A fork changes how the route plays; later bosses deepen it', null];
      return ['Route mastery', 'Deepen your fork, or take a boon', null];
    }
    if (src === 'start') return [OFFER_HEAD.start, `Paths gate your boons: ${ED.MAX_ELEMENTS} element paths, or Generalist`, null];
    if (src === 'forge') return [OFFER_HEAD.forge, 'The boon you pick gains one rank.', null];
    return [OFFER_HEAD[src] || OFFER_HEAD.level, '', null];
  }

  // Path or owner line in the card header, ribbon for the card's role (gate, keystone, duo, evolution).
  function boonPathLine(b) {
    if (b.duo) return [`<span class="bc-path two">${pathName(b.duo[0], true)} + ${pathName(b.duo[1], true)}</span>`, true];
    if (b.path) return [`<span class="bc-path">${ED.PATHS[b.path].name}</span>`, false];
    if (b.cls) return [`<span class="bc-path">${esc(b.route ? ED.routeLabel(b.cls, b.route) : ED.CLASSES[b.cls].name)}</span>`, false];
    return ['<span class="bc-path">Open</span>', false];
  }
  const boonRibbon = (b, id) => (b.evo ? 'Evolution' : b.duo ? 'Duo' : b.key ? 'Keystone' : id === 'generalist' ? 'Forsake the elements' : b.gate ? 'Path gate' : b.route ? (b.tag ? b.tag + (b.coop ? ' · co-op' : '') : 'Route') : '');
  // The fork weapon of a class card as a small canvas drawn from the pixel atlas (null without art): tilted up-right about its grip.
  function weaponThumb(wid) {
    const A = ED.Atlas, id = ED.Sprites.forkAnim(wid); // the baked fork look: the same sprite the hero holds
    if (!id || !A || !A.ok || !A.has(id)) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = 88; cv.className = 'bc-wimg';
    const c = cv.getContext('2d'), an = A.anim(id), dir = (an && an.anchors && typeof an.anchors.dir === 'number') ? an.anchors.dir : 0;
    const rot = (45 - dir) * Math.PI / 180, vx = (an.fw / 2 - an.ax) * 2, vy = (an.fh / 2 - an.ay) * 2; // the sprite's centre, rotated about the grip, lands on the middle of the canvas
    A.draw(c, id, 0, Math.round(44 - (vx * Math.cos(rot) - vy * Math.sin(rot))), Math.round(44 - (vx * Math.sin(rot) + vy * Math.cos(rot))), { rot, anchor: 'grip' });
    return cv;
  }
  // Card body of a class route or fork card: the text at the offered rank (+ rider from rank 3), "Plays as" and "Forks" on a route card, the rank-3 rider name on lower ranks, the fork weapon of an Attack fork.
  function classBody(b, id, have, me) {
    const rk = Math.min(b.max, have + 1), P = ED.cardParts(id, rk, me && me.stats);
    let h = `<div class="bd">${esc(P.text)}${P.rider ? ` <b>${esc(P.riderName)}</b>: ${esc(P.rider)}` : ''}</div>`;
    if (b.tier === 1) h += `<div class="bplay">Plays as: ${esc(b.plays)}</div><div class="bplay">Forks: ${b.forks.map(f => esc(ED.BOONS[f].name)).join(' / ')}</div>`;
    else if (P.riderName && !P.rider) h += `<div class="bplay">Rank 3: ${esc(P.riderName)}</div>`;
    if (b.weapon && b.weapon.kind && me && ED.CLASSES[me.cls]) {
      const base = me.stats && me.stats.weaponId ? me.stats.weaponId.split('@')[0] : me.weapon, fw = ED.forkWeapon(base, id);
      h += `<div class="bweap" data-w="${base}@${b.weapon.kind}"><div><span>${esc(fw.name)}</span><small>${fw.dmg.toFixed(1)} damage every ${fw.rate.toFixed(2)} s</small></div></div>`;
    }
    return h;
  }
  // "Weak: <stratum>" chip of an element gate card: the stratum whose foes are weak to the path's element.
  const weakChip = (b) => {
    if (!b.gate || !ED.PATHS[b.path].element) return '';
    const bi = ED.BIOMES.find(x => x.weak === b.path);
    return bi ? `<span class="bc-weak" style="--pc:${ED.PATHS[b.path].color}">Weak: ${esc(bi.short)}</span>` : '';
  };

  function boonCard(id, i, offer, me) {
    const b = ED.BOONS[id], max = me && me.stats ? ED.maxRank(b, me.stats) : (b.max || 5);
    const have = me && me.boons ? (me.boons[id] || 0) : 0;
    const path = b.path || (b.duo && b.duo[0]) || null, path2 = b.duo ? b.duo[1] : null;
    const el = document.createElement('button'); el.type = 'button';
    el.className = ['boon-card', path ? 'path-' + path : b.cls ? 'class' : 'neutral', path2 && 'path2-' + path2, path2 && 'duo', b.key && 'key', b.evo && 'evo', offer.forge && 'forge'].filter(Boolean).join(' ');
    el.style.setProperty('--rc', ED.RARITY[b.rar].color);
    if (path && ED.PATHS[path]) el.style.setProperty('--pc', ED.PATHS[path].color);
    if (path2 && ED.PATHS[path2]) el.style.setProperty('--pc2', ED.PATHS[path2].color);
    const rank = have ? (have < max ? `Rank ${have} → ${have + 1} (max ${max})` : `Rank ${have} (max)`) : max > 1 ? `Max rank ${max}` : '';
    const ribbon = boonRibbon(b, id), [line, two] = boonPathLine(b);
    el.innerHTML = `${ribbon ? `<span class="bc-ribbon${two ? ' two' : ''}">${ribbon}</span>` : ''}<div class="bc-top">${line}<span class="bc-rar">${ED.RARITY[b.rar].name}</span></div><img class="bc-icon" alt="" src="${ED.Icons.boonUrl(id)}"><div class="bn">${esc(b.name)}</div>${b.evo ? `<div class="bsub">${esc(UI.evoName(b.evo, me && me.weapon))}</div>` : ''}${weakChip(b)}${b.route ? classBody(b, id, have, me) : `<div class="bd">${esc(b.desc)}</div>`}${rank ? `<div class="bk${have ? ' own' : ''}">${rank}</div>` : ''}`;
    const wb = el.querySelector('.bweap');
    if (wb) { const th = weaponThumb(wb.dataset.w); if (th) wb.insertBefore(th, wb.firstChild); }
    el.onclick = () => { if (performance.now() >= boonLock) UI.pickBoon(i); };
    el.onmouseenter = () => { boonFocus = i; paintFocus(); };
    return el;
  }

  // Five or six cards, or a phone-width screen, use the compact card layout.
  const paintDense = () => { $('boon-cards').classList.toggle('dense', !!boonOffer && (boonOffer.boons.length > 4 || window.innerWidth <= 560)); };

  UI.showBoons = (offer) => {
    boonOffer = offer; boonFocus = 0; boonLock = performance.now() + BOON_LOCK_MS;
    const wrap = $('boon-cards'); wrap.innerHTML = '';
    const me = ED.Game.s && ED.Game.s.me;
    offer.boons.forEach((id, i) => wrap.appendChild(boonCard(id, i, offer, me)));
    paintDense();
    const [head, sub, hp] = offerHead(offer, me);
    $('boon-head').textContent = head;
    $('boon-head').style.color = hp ? ED.PATHS[hp].color : '';
    $('boon-sub').textContent = sub; $('boon-sub').hidden = !sub;
    $('boon-count').textContent = offer.picks > 1 ? `(${offer.picks} waiting)` : '';
    const fixed = offer.src === 'class' && offer.ctier < 3; // a route or fork pick is a fixed choice: no reroll
    const rr = $('btn-reroll'), canRe = offer.rerolls > 0 && !offer.forge && !fixed;
    rr.hidden = !canRe; rr.innerHTML = `<kbd>${esc(ED.Input.label('skill1'))}</kbd> Reroll (${offer.rerolls})`;
    $('boon-hint').innerHTML = `${keyPair('left', 'right')} select · <kbd>${esc(ED.Input.label('attack'))}</kbd> or <kbd>Enter</kbd> take${fixed ? ' · Routes are fixed choices' : ''}`;
    rr.onclick = () => UI.boonReroll(false);
    $('ov-boon').hidden = false;
    $('ov-boon').scrollTop = 0;
    paintFocus();
  };
  const keyPair = (a, b) => `<kbd>${esc(ED.Input.label(a))}</kbd><kbd>${esc(ED.Input.label(b))}</kbd>`;
  const paintFocus = () => { [...$('boon-cards').children].forEach((el, i) => el.classList.toggle('focus', i === boonFocus)); };
  UI.boonMove = (d) => { if (!boonOffer) return; boonFocus = (boonFocus + d + boonOffer.boons.length) % boonOffer.boons.length; paintFocus(); ED.Audio.play('hover'); };
  UI.boonConfirm = () => { if (!boonOffer || performance.now() < boonLock) return; UI.pickBoon(boonFocus); };
  UI.boonReroll = (byKey) => {
    if (!boonOffer || !(boonOffer.rerolls > 0) || boonOffer.forge || (boonOffer.src === 'class' && boonOffer.ctier < 3) || performance.now() < boonLock) return;
    boonLock = performance.now() + BOON_LOCK_MS; // the fresh hand arrives in a moment; don't send twice
    if (byKey) ED.Audio.play('click');
    ED.Game.act({ t: 'reroll' });
  };
  UI.pickBoon = (i) => {
    if (!boonOffer) return;
    boonOffer = null;
    $('ov-boon').hidden = true;
    ED.Game.act({ t: 'pick', i });
    if (ED.Game.s) { ED.Game.s.offerOpen = false; ED.Game.s.offer = null; }
  };
  UI.hideBoons = () => { boonOffer = null; $('ov-boon').hidden = true; };

  // ---------------- character sheet (map key) ----------------
  // One path row: icon, affinity, keystone and evolution status.
  function pathRow(k, me, evoPath) {
    const P = ED.PATHS[k], boons = me.boons || {}, aff = ED.pathAffinity(boons, k);
    const keyId = ED.BOON_IDS.find(id => ED.BOONS[id].key && ED.BOONS[id].path === k);
    const hasKey = !!(keyId && boons[keyId]);
    const keyAff = ED.keyAffinity(k), evoAff = ED.evoAffinity(k);
    const keyLine = hasKey ? `Keystone: ${esc(ED.BOONS[keyId].name)}` : aff >= keyAff ? 'Keystone available in your offers' : `Keystone ready at ${keyAff}`;
    let evoLine;
    if (evoPath === k) evoLine = `Evolved: ${esc(UI.evoName(k, me.weapon))}`;
    else if (evoPath) evoLine = 'Evolution already taken';
    else if (hasKey && aff >= evoAff) evoLine = 'Evolution ready — it will appear in your next offer';
    else evoLine = `Evolves at ${evoAff} with keystone`;
    return `<div class="path-row${evoPath === k ? ' evolved' : ''}" style="--pc:${P.color}"><img alt="" src="${pathIcon(k)}"><div><div class="pr-head"><b>${P.name}</b><span>Affinity ${aff}</span></div><div class="pr-line${hasKey ? ' ok' : ''}">${keyLine}</div><div class="pr-line${evoPath === k ? ' ok' : ''}">${evoLine}</div></div></div>`;
  }

  // Boons grouped by path (pick order), then duo, class and neutral.
  function boonGroups(me) {
    const boons = me.boons || {}, ids = Object.keys(boons).filter(id => ED.BOONS[id] && boons[id] > 0);
    const chip = (id) => { const b = ED.BOONS[id]; return `<span class="chip${b.key ? ' key' : ''}${b.evo ? ' evo' : ''}" style="--rc:${ED.RARITY[b.rar].color}" title="${esc(ED.boonText(id, boons[id], me.stats))}"><img alt="" src="${ED.Icons.boonUrl(id)}">${esc(b.name)}${boons[id] > 1 ? ' ×' + boons[id] : ''}</span>`; };
    const paths = ED.gatePaths(boons);
    const groups = paths.map(k => [`${ED.PATHS[k].name} <small>affinity ${ED.pathAffinity(boons, k)}</small>`, ids.filter(id => ED.BOONS[id].path === k && !ED.BOONS[id].open), ED.PATHS[k].color]);
    groups.push(['Duo', ids.filter(id => ED.BOONS[id].duo), '']);
    groups.push(['Class route', ids.filter(id => ED.BOONS[id].cls), '']);
    groups.push(['Open', ids.filter(id => { const b = ED.BOONS[id]; return !b.duo && !b.cls && (!b.path || b.open || !paths.includes(b.path)); }), '']);
    const html = groups.filter(g => g[1].length).map(([h, list, col]) => `<div class="bg"${col ? ` style="--pc:${col}"` : ''}><div class="bg-h">${h}</div><div class="chip-list">${list.map(chip).join('')}</div></div>`).join('');
    return html || '<span class="chip none">None yet</span>';
  }

  UI.toggleSheet = (on) => {
    const s = ED.Game.s; if (!s) return;
    const el = $('ov-sheet');
    el.hidden = on === undefined ? !el.hidden : !on;
    if (el.hidden) return;
    const me = s.me, st = me.stats, view = s.view;
    $('sheet-hero').textContent = `${me.name} · ${ED.CLASSES[me.cls].name}`;
    const rows = [
      ['Health', `${Math.ceil(me.hp)} / ${me.maxHp}`], ['Damage', U.pct(st.dmg)], ['Attack speed', U.pct(st.atk)], ['Critical', `${Math.round(st.crit * 100)}% ×${st.critMult.toFixed(2)}`],
      ['Armor', Math.round(st.armor) + ` (−${Math.round((1 - ED.Stats.armorMul(st.armor)) * 100)}%)`], ['Move speed', Math.round(st.moveSpeed)],
      [`Skill cooldowns (${esc(ED.Input.label('skill1'))} · ${esc(ED.Input.label('skill2'))})`, `${st.skillCd.toFixed(1)}s · ${(st.skill2Cd || 0).toFixed(1)}s`], ['Dodge', Math.round(st.dodge * 100) + '%'],
      ['Shield', `${Math.ceil(me.shield || 0)}` + (st.holyInfuse ? ` (Holy holds up to ${Math.round(me.maxHp * st.holyCap)})` : '')], ['Level', view.level], ['Gold', view.gold],
    ];
    $('sheet-dl').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const note = $('sheet-note');
    note.hidden = false;
    note.textContent = `Nothing heals you for hitting or killing. Shields fade ${Math.round(ED.CONST.SHIELD_DECAY * 100)}% of max health per second between rooms.`;
    $('sheet-relics').innerHTML = me.relics.length ? me.relics.map(id => { const r = ED.RELICS[id]; return `<span class="chip" style="--rc:${ED.RARITY[r.rar].color}" title="${esc(r.desc)}"><img alt="" src="${ED.Icons.relicUrl(id)}">${r.name}</span>`; }).join('') : '<span class="chip none">None yet</span>';
    $('sheet-boons').innerHTML = boonGroups(me);
    // paths: slots used, affinity, keystone and evolution
    const owned = ED.gatePaths(me.boons || {}), evoPath = ED.evoOf(me.boons || {});
    const gen = ED.isGeneralist(me.boons || {}), slots = gen ? 0 : Math.max(0, ED.MAX_ELEMENTS - owned.length);
    $('sheet-slots').textContent = gen ? 'Generalist' : `${owned.length}/${ED.MAX_ELEMENTS}`;
    $('sheet-paths').innerHTML = owned.map(k => pathRow(k, me, evoPath)).join('') + '<div class="path-row empty">Open path slot</div>'.repeat(slots);
    // stratum affinity: now and next
    const biome = ED.biomeFor(view.stratum), nb = view.stratum < ED.BIOMES.length ? ED.biomeFor(view.stratum + 1) : null;
    $('sheet-strat').innerHTML = `Stratum ${U.roman(view.stratum)} · ${esc(biome.name)}<br><small>Lantern ${Math.round(100 * view.light / Math.max(1, view.lightMax))}% · map numbers: light each unvisited room costs</small>`;
    $('sheet-aff').innerHTML = affChips(biome);
    $('sheet-aff2').innerHTML = nb ? `<div class="aff-row">Next, ${esc(nb.short)}: ${affChips(nb)}</div>` : '';
    $('sheet-foot').innerHTML = `Press <kbd>${esc(ED.Input.label('map'))}</kbd> or <kbd>Esc</kbd> to close`;
    // the map canvas backs one device pixel per drawn pixel, so it stays sharp at any size
    const mc = $('map-canvas'), c = mc.getContext('2d');
    const w = mc.getBoundingClientRect().width || 360, dpr = window.devicePixelRatio || 1;
    mc.width = Math.round(w * dpr); mc.height = Math.round(w * dpr * 5 / 6);
    c.clearRect(0, 0, mc.width, mc.height);
    const pad = 10 * dpr;
    ED.HUD.drawMap(c, view, pad, pad, mc.width - 2 * pad, mc.height - 2 * pad, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * dpr, 0);
  };

  // ---------------- results ----------------
  UI.renderResults = (sum, res, note) => {
    const A = ED.App, p = A.profile;
    const win = sum.victory;
    const banner = $('res-banner');
    banner.textContent = win ? 'Victory' : sum.abandoned ? 'Retreat' : note ? 'Disconnected' : 'Fallen';
    banner.classList.toggle('win', !!win);
    const biome = ED.biomeFor(sum.stratum || 1);
    const tail = res.rewards.total > 0 ? 'The embers you carried still count.' : 'Clear at least one room for a descent to pay out.';
    $('res-sub').textContent = note || (win ? 'The Hollow King is broken. The Deep remembers your name.'
      : sum.abandoned ? `${sum.party > 1 ? 'Your party' : 'You'} turned back in ${biome.name}. ${tail}` : `You fell in ${biome.name}. ${tail}`);
    // world-summary fields below may be missing from a client's partial summary
    const total = sum.roomsTotal | 0, seen = Math.min(total, sum.roomsVisited | 0);
    const lights = Array.isArray(sum.lightAtBoss) ? sum.lightAtBoss.filter(v => typeof v === 'number') : [];
    $('res-stats').innerHTML = [
      ['Deepest stratum', `${U.roman(sum.stratum || 1)} · ${biome.short}`], ['Time', U.fmtTime(sum.time || 0)], ['Level reached', sum.level || 1],
      ['Rooms cleared', sum.roomsCleared || 0], total > 0 ? ['Rooms explored', `${seen} / ${total} (${Math.round(seen / total * 100)}%)`] : null,
      lights.length ? ['Average light at boss', Math.round(lights.reduce((a, b) => a + b, 0) / lights.length * 100) + '%'] : null,
      ['Foes slain', sum.kills || 0], ['Bosses slain', sum.bossCount || 0], ['Party', (sum.party || 1) + (sum.party > 1 ? ' heroes' : ' hero')],
      sum.pact ? ['Pact', sum.pact] : null,
    ].filter(Boolean).map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const evo = sum.myEvo && ED.PATHS[sum.myEvo.path] ? sum.myEvo : null, evoEl = $('res-evo');
    evoEl.hidden = !evo && !sum.evolved;
    evoEl.style.setProperty('--pc', evo ? ED.PATHS[evo.path].color : 'var(--r-legend)');
    evoEl.innerHTML = evo ? `<img alt="" src="${pathIcon(evo.path)}"><span>Evolved: <b>${esc(UI.evoName(evo.path, evo.weapon))}</b> <small>${ED.PATHS[evo.path].name} path</small></span>` : sum.evolved ? '<span>A hero in your party evolved their weapon.</span>' : '';
    $('res-embers').innerHTML = res.rewards.lines.map(([a, b]) => `<dt>${esc(a)}</dt><dd>+${b}</dd>`).join('') || '<dt>Nothing this time</dt><dd>0</dd>';
    $('res-ember-total').textContent = res.rewards.total;
    const ci = ED.CLASS_IDS.indexOf(sum.cls);
    const xp = p.mastery[ci], ml = ED.masteryLevel(xp);
    const next = ED.MASTERY_XP[ml], prev = ED.MASTERY_XP[ml - 1];
    const frac = next === undefined ? 1 : (xp - prev) / (next - prev);
    $('res-progress').innerHTML = `
      <div class="prog-line">${ED.CLASSES[sum.cls].name} mastery ${ml} <small>(+${res.rewards.masteryXp} xp)</small><div class="bar"><i style="width:${Math.round(frac * 100)}%"></i></div></div>
      <div class="prog-line">Embers now: <b>${p.embers}</b></div>
      ${res.deeds.map(d => `<div class="prog-line">Deed: <b>${esc(d.name)}</b> +${d.reward} embers</div>`).join('')}`;
    const ul = $('res-unlocks'); ul.innerHTML = '';
    for (const u of res.unlocks) ul.insertAdjacentHTML('beforeend', `<span class="unlock-pill">${esc(u)}</span>`);
    $('res-code').textContent = S.encode(p);
  };

  // ---------------- settings ----------------
  UI.settingsTab = 'sound';
  const fill = (inp) => { inp.style.setProperty('--fill', ((inp.value - inp.min) / (inp.max - inp.min) * 100) + '%'); const o = $('out-' + inp.id.slice(4)); if (o) o.textContent = inp.value; };
  UI.setSettingsTab = (t) => {
    if (t === 'profile' && $('stab-profile').hidden) t = 'sound';
    UI.settingsTab = t;
    for (const b of document.querySelectorAll('#set-tabs .tab')) b.classList.toggle('on', b.dataset.stab === t);
    for (const p of document.querySelectorAll('.set-pane')) p.hidden = p.dataset.spane !== t;
    if (t === 'controls') renderBindings();
    else { ED.Input.stopCapture(); }
    if (t === 'profile') renderProfile();
  };
  UI.openSettings = (tab) => {
    const A = ED.App, s = A.settings;
    $('set-master').value = s.master; $('set-music').value = s.music; $('set-sfx').value = s.sfx;
    $('set-quality').value = s.quality; $('set-framecap').value = s.frameCap; $('set-shake').checked = s.shake; $('set-dmg').checked = s.dmg;
    $('set-cursor').value = s.cursor; $('set-reticle').value = s.reticle; $('set-retcol').value = s.reticleCol; $('set-aimprev').checked = s.aimPreview !== false;
    for (const id of ['set-master', 'set-music', 'set-sfx']) fill($(id));
    $('stab-profile').hidden = A.inRun() || !A.hasProfile; // profile tools never appear mid-descent
    $('ov-settings').hidden = false;
    UI.setSettingsTab(tab || UI.settingsTab);
    const on = document.querySelector('#set-tabs .tab.on'); if (on) on.focus({ preventScroll: true });
  };
  UI.closeSettings = () => {
    ED.Input.stopCapture();
    $('ov-settings').hidden = true;
    const A = ED.App;
    if (A.state === 'hearth') UI.renderHearth(); else if (A.state === 'title') UI.renderTitle();
  };

  function renderProfile() {
    const p = ED.App.profile;
    $('save-code').textContent = S.encode(p);
    $('inp-rename').value = p.name;
    $('load-msg').textContent = ''; $('load-msg').className = 'msg';
    nameHint($('inp-rename'), $('rename-msg'));
  }

  // Key bindings: one row per action, two slots. Click a slot, press a key or mouse button; conflicts swap and say so.
  const setBindMsg = (text, kind) => { const m = $('bind-msg'); m.textContent = text || ''; m.className = 'bind-msg' + (kind === 'err' ? ' err' : ''); };
  function renderBindings(flash) {
    const I = ED.Input, list = $('bind-list');
    list.innerHTML = '';
    const cols = [document.createElement('div'), document.createElement('div')];
    cols.forEach(c => { c.className = 'bind-group'; });
    const place = { Movement: 0, Interface: 0, Combat: 1 };
    for (const grp of ['Movement', 'Combat', 'Interface']) {
      const col = cols[place[grp]];
      col.insertAdjacentHTML('beforeend', `<div class="bind-row bind-h"><h4>${grp}</h4><span class="bs">Primary</span><span class="bs">Alternate</span></div>`);
      for (const a of I.ACTIONS.filter(x => x.group === grp)) {
        const row = document.createElement('div'); row.className = 'bind-row';
        row.innerHTML = `<span>${a.label}</span>`;
        for (let s = 0; s < 2; s++) {
          const code = I.binds[a.id][s], b = document.createElement('button');
          b.type = 'button'; b.className = 'bind-slot' + (code ? '' : ' empty') + (flash && flash[0] === a.id && flash[1] === s ? ' flash' : '');
          b.dataset.a = a.id; b.dataset.s = s;
          b.textContent = code ? I.keyName(code) : 'empty';
          b.setAttribute('aria-label', `${a.label}, ${s ? 'alternate' : 'primary'} key: ${code ? I.keyName(code) : 'empty'}. Click to change.`);
          b.onclick = () => startCapture(b, a, s);
          row.appendChild(b);
        }
        col.appendChild(row);
      }
    }
    cols.forEach(c => list.appendChild(c));
  }
  function startCapture(btn, action, slot) {
    const I = ED.Input;
    for (const b of document.querySelectorAll('.bind-slot.listening')) { b.classList.remove('listening'); }
    btn.classList.add('listening'); btn.textContent = 'Press a key…';
    setBindMsg(`${action.label}: press a key or mouse button. Esc cancels, Backspace clears.`, '');
    I.capture((code) => {
      let r = null;
      if (code === null) setBindMsg('', '');
      else {
        r = code === 'Backspace' ? I.clearSlot(action.id, slot) : I.rebind(action.id, slot, code);
        setBindMsg(r.msg, r.ok ? 'ok' : 'err');
        if (r.ok) { const A = ED.App; A.settings.binds = I.exportBinds(); S.storeSettings(A.settings); }
      }
      renderBindings(r && r.ok ? [action.id, slot] : null);
      setTimeout(() => { const nb = document.querySelector(`.bind-slot[data-a="${action.id}"][data-s="${slot}"]`); if (nb && !$('ov-settings').hidden && UI.settingsTab === 'controls') nb.focus({ preventScroll: true }); }, 250);
    });
  }

  UI.init = () => {
    const A = ED.App;
    // title
    $('btn-begin').onclick = () => A.createProfile($('inp-name').value);
    $('inp-name').addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'NumpadEnter') A.createProfile($('inp-name').value); });
    $('inp-name').addEventListener('input', () => nameHint($('inp-name'), $('name-msg')));
    $('btn-have-code').onclick = () => { $('title-load').hidden = !$('title-load').hidden; if (!$('title-load').hidden) $('inp-title-code').focus(); };
    $('btn-title-code').onclick = () => {
      const msg = $('title-code-msg');
      try { A.importProfile(S.decode($('inp-title-code').value)); $('inp-title-code').value = ''; msg.textContent = ''; } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; }
    };
    $('mm-descend').onclick = () => A.enterHearth('descend');
    $('mm-hearth').onclick = () => A.enterHearth('upgrades');
    $('mm-heroes').onclick = () => A.enterHearth('heroes');
    $('mm-settings').onclick = () => UI.openSettings();
    for (const m of document.querySelectorAll('.menu')) arrowNav(m, '.menu-btn', 'ArrowUp', 'ArrowDown');
    arrowNav($('hearth-tabs'), '.tab', 'ArrowLeft', 'ArrowRight');
    arrowNav($('set-tabs'), '.tab:not([hidden])', 'ArrowLeft', 'ArrowRight');
    // sections
    $('btn-back').onclick = () => A.goHome();
    for (const b of document.querySelectorAll('#hearth-tabs .tab')) b.onclick = () => { ED.Audio.play('click'); UI.setTab(b.dataset.tab); };
    $('btn-solo').onclick = () => A.startSolo();
    $('btn-host').onclick = () => A.hostParty();
    $('btn-join').onclick = () => { $('join-row').hidden = !$('join-row').hidden; if (!$('join-row').hidden) $('inp-join').focus(); };
    $('btn-join-go').onclick = () => A.joinParty($('inp-join').value);
    $('inp-join').addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'NumpadEnter') A.joinParty($('inp-join').value); });
    // settings: profile tab
    $('btn-copy-code').onclick = () => copy($('save-code').textContent, $('btn-copy-code'));
    $('btn-load-code').onclick = () => {
      const msg = $('load-msg');
      try {
        const prof = S.decode($('inp-code').value);
        UI.confirm('Load this save?', `This replaces the profile in this browser with "${prof.name}" (${prof.embers} embers, ${prof.stats.runs} descents).`, 'Load save', () => {
          A.replaceProfile(prof); msg.textContent = 'Save loaded. Welcome back, ' + prof.name + '.'; msg.className = 'msg ok'; $('inp-code').value = ''; renderProfile();
        });
      } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; }
    };
    $('inp-rename').addEventListener('input', () => nameHint($('inp-rename'), $('rename-msg')));
    $('btn-rename').onclick = () => { A.profile.name = S.sanitizeName($('inp-rename').value); A.persist(); renderProfile(); UI.toast('Name saved: <b>' + esc(A.profile.name) + '</b>'); };
    $('btn-reset').onclick = () => UI.confirm('Erase this profile?', 'Every ember, upgrade and unlock in this browser will be lost. Copy your save code first if you want to keep it.', 'Erase', () => { $('ov-settings').hidden = true; A.resetProfile(); });
    // lobby
    $('btn-copy-invite').onclick = () => copy(A.inviteLink(), $('btn-copy-invite'));
    $('btn-lobby-leave').onclick = () => A.leaveLobby();
    $('btn-lobby-go').onclick = () => A.lobbyGo();
    $('btn-lobby-hearth').onclick = () => UI.openPartyHearth();
    for (const b of document.querySelectorAll('#ph-tabs .tab')) b.onclick = () => { ED.Audio.play('click'); UI.phTab = b.dataset.tab; UI.renderPartyHearth(); };
    $('btn-ph-close').onclick = () => { $('ov-hearth').hidden = true; if (A.lobbyState) UI.renderLobby(A.lobbyState, A.myPid, !!A.host); };
    // results
    $('btn-res-back').onclick = () => A.goHome();
    $('btn-res-copy').onclick = () => copy($('res-code').textContent, $('btn-res-copy'));
    // pause & settings
    $('btn-resume').onclick = () => A.togglePause(false);
    $('btn-pause-settings').onclick = () => UI.openSettings();
    $('btn-abandon').onclick = () => UI.confirm('Abandon this descent?', 'You keep the embers earned so far.', 'Abandon', () => A.abandonRun());
    for (const b of document.querySelectorAll('#set-tabs .tab')) b.onclick = () => { ED.Audio.play('click'); UI.setSettingsTab(b.dataset.stab); };
    const setChange = (e) => {
      const s = A.settings;
      s.master = +$('set-master').value; s.music = +$('set-music').value; s.sfx = +$('set-sfx').value;
      s.quality = $('set-quality').value; s.frameCap = $('set-framecap').value; s.shake = $('set-shake').checked; s.dmg = $('set-dmg').checked;
      s.cursor = $('set-cursor').value; s.reticle = $('set-reticle').value; s.reticleCol = $('set-retcol').value; s.aimPreview = $('set-aimprev').checked;
      if (e && e.target.type === 'range') fill(e.target);
      A.applySettings();
      if (ED.AimFx) ED.AimFx.applyCursor();
    };
    for (const id of ['set-master', 'set-music', 'set-sfx', 'set-quality', 'set-framecap', 'set-shake', 'set-dmg', 'set-cursor', 'set-reticle', 'set-retcol', 'set-aimprev']) $(id).addEventListener('input', setChange);
    $('btn-bind-reset').onclick = () => { ED.Input.resetBinds(); A.settings.binds = ED.Input.exportBinds(); S.storeSettings(A.settings); renderBindings(); setBindMsg('Controls reset to defaults.', 'ok'); };
    $('btn-settings-close').onclick = () => UI.closeSettings();
    window.addEventListener('resize', () => { if (!$('ov-boon').hidden) paintDense(); });
    // Esc closes menu overlays and steps back outside a run (in a run the frame loop owns Esc)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || A.inRun()) return;
      if (!$('modal').hidden) $('modal').hidden = true;
      else if (!$('ov-settings').hidden) UI.closeSettings();
      else if (!$('ov-hearth').hidden) $('btn-ph-close').click();
      else if (A.state === 'hearth' && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) A.goHome();
    });
    nameHint($('inp-name'), $('name-msg'));
    // UI sounds
    document.addEventListener('click', (e) => { if (e.target.closest('.btn, .menu-btn')) ED.Audio.play('click'); });
  };
})(globalThis.ED || (globalThis.ED = {}));
