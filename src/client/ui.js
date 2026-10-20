// DOM screens and overlays: title, Hearth (meta hub), lobby, results, boon picker, character sheet, settings.
(function (ED) {
  'use strict';
  const U = ED.U, S = ED.Save;
  const UI = ED.UI = {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  UI.esc = esc;

  UI.show = (name) => {
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== 'scr-' + name;
    $('loading').hidden = true;
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

  const portrait = (cls, size, slot, weapon) => { const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; ED.Sprites.portrait(cv, cls, slot || 0, weapon); return cv; };

  // Path helpers: elements share ids with their paths (pyre, rime, storm); thresholds fall back to the design values when data does not export them.
  const KEY_AFF = () => ED.KEY_AFFINITY || 3, EVO_AFF = () => ED.EVO_AFFINITY || 5, LEECH_CAP = () => (ED.CONST && ED.CONST.LEECH_CAP) || 0.02;
  const pathIcon = (k) => ED.Icons.url(ED.PATHS[k].icon, ED.PATHS[k].color);
  const pathName = (k, wrap) => (ED.PATHS[k] ? (wrap ? `<i style="color:${ED.PATHS[k].color}">${ED.PATHS[k].name}</i>` : ED.PATHS[k].name) : '');
  UI.evoName = (path, weaponId) => (ED.PATHS[path] ? ED.PATHS[path].evo : '') + (ED.WEAPONS[weaponId] ? ' ' + ED.WEAPONS[weaponId].name : ' Arms');
  const affChip = (el, kind, small) => (el && ED.PATHS[el] ? `<span class="aff-chip ${kind}${small ? ' sm' : ''}" style="--pc:${ED.PATHS[el].color}"><img alt="" src="${pathIcon(el)}">${kind === 'weak' ? 'Weak to' : 'Resists'} ${ED.PATHS[el].name}</span>` : '');
  const affChips = (biome, small) => affChip(biome.weak, 'weak', small) + affChip(biome.resist, 'resist', small);

  // ---------------- title ----------------
  UI.renderTitle = () => {
    const A = ED.App;
    const has = !!A.hasProfile;
    $('title-new').hidden = has; $('title-cont').hidden = !has;
    if (has) $('title-name').textContent = A.profile.name;
    $('title-load').hidden = true;
    const jc = A.pendingJoin;
    $('title-join').hidden = !jc;
    if (jc) $('title-join-code').textContent = jc;
  };

  // ---------------- hearth ----------------
  UI.tab = 'descend';
  UI.setTab = (t) => {
    UI.tab = t;
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
    else if (UI.tab === 'heroes') renderHeroes();
    else if (UI.tab === 'chronicle') renderChronicle();
    else if (UI.tab === 'save') renderSave();
  };

  function classCards(container, selected, onPick) {
    const p = ED.App.profile;
    container.innerHTML = '';
    for (const id of ED.CLASS_IDS) {
      const c = ED.CLASSES[id];
      const unlocked = S.classUnlocked(p, id);
      const ml = S.masteryLevel(p, id);
      const b = document.createElement('button');
      b.className = 'class-card' + (id === selected ? ' on' : '') + (unlocked ? '' : ' locked');
      b.type = 'button';
      b.appendChild(portrait(id, 56));
      const info = document.createElement('div');
      info.innerHTML = `<div class="cn">${c.name}</div><div class="ct">${c.title}</div><div class="cm">${unlocked ? 'Mastery ' + ml : '🔒 ' + esc(c.unlock.text)}</div>`;
      b.appendChild(info);
      if (unlocked) b.onclick = () => { ED.Audio.play('click'); onPick(id); };
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
      b.innerHTML = `<b>${w.name}</b><small>${ok ? esc(w.desc) : 'Unlocks at mastery ' + (i === 1 ? 3 : 6)}</small>`;
      if (ok) b.onclick = () => { ED.Audio.play('click'); onPick(wid); };
      container.appendChild(b);
    });
  }

  function renderDescend() {
    const A = ED.App, p = A.profile;
    const cls = A.sel.cls, c = ED.CLASSES[cls];
    classCards($('class-list'), cls, (id) => { A.selectClass(id); renderDescend(); });
    const st = ED.Stats.compute({ cls, weapon: A.sel.weapon, boons: {}, relics: [], meta: S.metaBundle(p, cls), pact: A.sel.pact });
    const skills = [[c.skill, 'K', st.skillCd], [c.skill2, 'L', st.skill2Cd]].filter(x => ED.SKILLS[x[0]]);
    const ml = S.masteryLevel(p, cls);
    const hd = $('hero-detail');
    hd.innerHTML = `
      <div class="hd-top"><div id="hd-port"></div><div><div class="hd-name">${c.name}</div><div class="hd-title">${c.title} · Mastery ${ml}</div><p class="hd-desc">${esc(c.desc)}</p></div></div>
      <div class="hd-stats">
        <div class="hd-stat"><b>${st.maxHp}</b><span>Health</span></div>
        <div class="hd-stat"><b>${Math.round(st.armor)}</b><span>Armor</span></div>
        <div class="hd-stat"><b>${Math.round(st.moveSpeed)}</b><span>Speed</span></div>
        <div class="hd-stat"><b>${Math.round(st.crit * 100)}%</b><span>Crit</span></div>
      </div>
      <div class="hd-skills">${skills.map(([id, key, cd]) => { const sk = ED.SKILLS[id]; return `<div class="hd-skill"><img alt="" src="${ED.Icons.url(sk.icon, c.col.c)}"><div><b>${sk.name}</b> <small><kbd>${key}</kbd> ${cd.toFixed(1)}s cooldown</small><p>${esc(sk.desc)}</p></div></div>`; }).join('')}</div>
      <div class="weapon-row" id="weapon-row"></div>`;
    $('hd-port').appendChild(portrait(cls, 84, 0, A.sel.weapon));
    weaponChips($('weapon-row'), cls, A.sel.weapon, (wid) => { A.sel.weapon = wid; A.saveSel(); renderDescend(); });
    // pact
    const ar = $('asc-row');
    ar.hidden = p.pactMax <= 0;
    if (p.pactMax > 0) {
      const r = $('asc-range'); r.max = p.pactMax; r.value = Math.min(A.sel.pact, p.pactMax);
      $('asc-val').textContent = r.value;
      $('asc-desc').textContent = +r.value ? pactText(+r.value) : ''; // empty hides the line (keeps the column short)
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

  // Two lines for the descent loop (paths, lantern), then the single most useful next goal.
  function goalText(p) {
    const next = ED.CLASS_IDS.find(c => !S.classUnlocked(p, c));
    const tierNext = ED.UPGRADES.find(u => u.tier > p.stats.deepest);
    const lines = [
      `<b>Paths:</b> follow up to ${ED.MAX_GATES} of ${ED.PATH_IDS.map(k => pathName(k, true)).join(', ')}. Each stratum is weak to one element.`,
      '<b>Lantern:</b> every new room costs light (shown on its door). In the dark elites and the Gloom hunt you, but rooms pay more; <kbd>F</kbd> flares the Gloom away, and spare light shields you at the boss door.',
    ];
    if (p.stats.runs === 0) lines.push('<b>First goal:</b> reach the Bone Warden at the end of the Ossuary. Every descent pays embers, win or lose.');
    else if (next) lines.push(`<b>Next hero:</b> ${ED.CLASSES[next].name} (${esc(ED.CLASSES[next].unlock.text)}).`);
    else if (tierNext) lines.push(`<b>Reach stratum ${U.roman(tierNext.tier)}</b> to reveal new Hearth upgrades.`);
    else if (p.stats.wins > 0 && p.pactMax < 10) lines.push(`<b>Pacts:</b> complete a descent under Pact ${p.pactMax} to unlock Pact ${p.pactMax + 1}.`);
    else lines.push('<b>Every relic, hero and pact is yours.</b> The Deep still has deeds to earn.');
    return lines.join('<br>');
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
        const cost = r < max ? u.costs[r] : 0;
        card.innerHTML = `<img alt="" src="${ED.Icons.url(u.icon, '#ff9a4a')}"><div><div class="un">${u.name}</div><div class="ud">${open ? (r ? esc(u.desc(r)) : 'Next: ' + esc(u.step)) : '???'}</div><div class="pips">${pips}</div></div>`;
        if (open && r < max) {
          const b = document.createElement('button'); b.className = 'btn' + (p.embers >= cost ? ' btn-primary' : ''); b.type = 'button';
          b.innerHTML = `<span class="ember-ico"></span> ${cost} · ${esc(u.step)}`;
          b.disabled = p.embers < cost;
          b.onclick = () => { if (S.buyUpgrade(p, u.id)) { ED.Audio.play('buy'); ED.App.afterMetaChange(); } };
          card.lastElementChild.appendChild(b);
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
    for (const id of ids) {
      const r = ED.RELICS[id], un = S.relicUnlocked(p, id), col = ED.RARITY[r.rar].color;
      const card = document.createElement('div');
      card.className = 'relic-card' + (un ? '' : ' locked');
      card.style.setProperty('--rc', col);
      let req = '';
      if (!un && r.req && r.req.boss && !S.relicReqMet(p, id)) req = `Requires defeating ${ED.ENEMIES[ED.BIOMES[r.req.boss - 1].boss].name}`;
      card.innerHTML = `<img alt="" src="${ED.Icons.relicUrl(id)}"><div><div class="rn">${r.name}</div><div class="rd">${esc(r.desc)}</div><div class="rq">${ED.RARITY[r.rar].name}${req ? ' · ' + esc(req) : ''}</div></div>`;
      if (!un && !req) {
        const b = document.createElement('button'); b.className = 'btn' + (p.embers >= r.cost ? ' btn-primary' : ''); b.type = 'button';
        b.innerHTML = `<span class="ember-ico"></span> ${r.cost} · Unlock`; b.disabled = p.embers < r.cost;
        b.onclick = () => { if (S.unlockRelic(p, id)) { ED.Audio.play('relic'); ED.App.afterMetaChange(); } };
        card.lastElementChild.appendChild(b);
      }
      grid.appendChild(card);
    }
  }

  function renderHeroes(list) {
    const p = ED.App.profile;
    list = list || $('mastery-list');
    list.innerHTML = '';
    ED.CLASS_IDS.forEach((cls, ci) => {
      const c = ED.CLASSES[cls], xp = p.mastery[ci], ml = ED.masteryLevel(xp), un = S.classUnlocked(p, cls);
      const next = ED.MASTERY_XP[ml] !== undefined ? ED.MASTERY_XP[ml] : null, prev = ED.MASTERY_XP[ml - 1];
      const frac = next === null ? 1 : (xp - prev) / (next - prev);
      const card = document.createElement('div'); card.className = 'mast-card';
      const top = document.createElement('div'); top.className = 'mast-top';
      top.appendChild(portrait(cls, 54));
      const info = document.createElement('div');
      info.innerHTML = `<div class="mn">${c.name}</div><div class="ml">${un ? `Mastery ${ml}${next !== null ? ` · ${xp} / ${next} xp` : ' · complete'}` : '🔒 ' + esc(c.unlock.text)}</div>`;
      top.appendChild(info); card.appendChild(top);
      const bar = document.createElement('div'); bar.className = 'bar'; bar.innerHTML = `<i style="width:${Math.round(U.clamp(frac, 0, 1) * 100)}%"></i>`; card.appendChild(bar);
      const ul = document.createElement('ul'); ul.className = 'mast-rewards';
      for (let l = 2; l <= 10; l++) {
        let label = ED.MASTERY_REWARDS[l];
        if (l === 3) label = 'Weapon: ' + ED.WEAPONS[c.weapons[1]].name;
        if (l === 6) label = 'Weapon: ' + ED.WEAPONS[c.weapons[2]].name;
        ul.insertAdjacentHTML('beforeend', `<li class="${ml >= l ? 'got' : ''}"><b>Lv ${l}</b>${esc(label)}</li>`);
      }
      card.appendChild(ul);
      list.appendChild(card);
    });
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
      sl.insertAdjacentHTML('beforeend', `<div class="stratum${seen ? '' : ' unseen'}"><i style="background:radial-gradient(circle at 40% 35%, ${b.pal.accent}, ${b.pal.floorA})"></i><div><b>${U.roman(i + 1)}. ${seen ? b.name : '???'}</b><small>${seen ? esc(slain ? ED.LORE[i] : b.blurb) : 'Undiscovered'}</small><div class="aff-list">${affChips(b, true)}</div></div></div>`);
    });
  }

  function renderSave() {
    const p = ED.App.profile;
    $('save-code').textContent = S.encode(p);
    $('inp-rename').value = p.name;
    $('load-msg').textContent = ''; $('load-msg').className = 'msg';
    nameHint($('inp-rename'), $('rename-msg'));
  }

  // Names travel inside the save code, so only a small alphabet is kept. Say so instead of silently changing it.
  function nameHint(inp, msg) {
    const raw = inp.value.trim();
    const kept = raw.split('').filter(ch => S.NAME_CHARS.indexOf(ch) >= 0).join('').trim();
    const off = !!raw && kept !== raw;
    msg.textContent = off ? `Only letters A–Z, numbers, spaces and hyphens are kept: you will appear as "${S.sanitizeName(raw)}".` : 'Letters A–Z, numbers, spaces and hyphens · up to 12';
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
      div.insertAdjacentHTML('beforeend', `<div class="mn" style="color:${ED.PLAYER_COLORS[m.slot]}">${esc(m.name)}${m.pid === myPid ? ' (you)' : ''}</div><div class="mc">${ED.CLASSES[m.cls].name} · ${ED.WEAPONS[m.weapon].name}</div><div class="mr${m.ready || m.isHost ? ' ready' : ''}">${m.isHost ? 'Host' : m.ready ? 'Ready' : 'Not ready'}</div>`);
      mem.appendChild(div);
    }
    classCards($('lobby-classes'), A.sel.cls, (id) => { A.selectClass(id); A.lobbyPick(); });
    weaponChips($('lobby-weapons'), A.sel.cls, A.sel.weapon, (wid) => { A.sel.weapon = wid; A.saveSel(); A.lobbyPick(); });
    // pact: the host sets it; friends see what they are agreeing to
    const la = $('lobby-asc');
    la.hidden = isHost ? A.profile.pactMax <= 0 : !(state.pact > 0);
    $('lobby-asc-range').hidden = !isHost;
    $('lobby-asc-lbl').textContent = isHost ? 'Pact of the Deep' : 'Pact of the Deep (set by the host)';
    if (isHost) { $('lobby-asc-range').max = A.profile.pactMax; $('lobby-asc-range').value = state.pact; }
    $('lobby-asc-val').textContent = state.pact;
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
  UI.lobbyStatus = (text, err) => { $('lobby-status').textContent = text; $('lobby-status').style.color = err ? '#e2513f' : ''; };

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

  // [header, subtitle, path colour key] for an offer message { src, path, forge }.
  function offerHead(offer, me) {
    const src = offer.forge ? 'forge' : (offer.src || 'level');
    const owned = me && me.boons ? ED.gatePaths(me.boons) : [];
    const P = ED.PATHS[offer.path];
    if (src === 'room' && P) {
      if (owned.includes(offer.path)) return [`Boon of ${P.name}`, `Your ${P.name} affinity: ${ED.pathAffinity(me.boons, offer.path)}`, offer.path];
      if (owned.length < ED.MAX_GATES) return [`Boon of ${P.name}`, `A new path (${owned.length}/${ED.MAX_GATES} slots used)`, offer.path];
      return [OFFER_HEAD.level, `${P.name} is out of reach: your ${ED.MAX_GATES} path slots are full`, null];
    }
    if (src === 'class') return [`${me && ED.CLASSES[me.cls] ? ED.CLASSES[me.cls].name : 'Class'} technique`, '', null];
    if (src === 'start') return [OFFER_HEAD.start, `Paths gate your boons. A hero follows up to ${ED.MAX_GATES}.`, null];
    if (src === 'forge') return [OFFER_HEAD.forge, 'The boon you pick gains one rank.', null];
    return [OFFER_HEAD[src] || OFFER_HEAD.level, '', null];
  }

  // Small label under the name: path and role, duo pair, evolution weapon, class or neutral.
  function boonLabel(b, me) {
    if (b.evo) return `Evolution · ${esc(UI.evoName(b.evo, me && me.weapon))}`;
    if (b.duo) return `Duo · ${pathName(b.duo[0], true)} + ${pathName(b.duo[1], true)}`;
    if (b.path) return pathName(b.path, true) + (b.gate ? ' · Gate' : b.key ? ' · Keystone' : '');
    if (b.cls) return esc(ED.CLASSES[b.cls].name);
    return 'Neutral';
  }

  function boonCard(id, i, offer, me) {
    const b = ED.BOONS[id], max = b.max || 5;
    const have = me && me.boons ? (me.boons[id] || 0) : 0;
    const path = b.path || (b.duo && b.duo[0]) || null, path2 = b.duo ? b.duo[1] : null;
    const el = document.createElement('button'); el.type = 'button';
    el.className = ['boon-card', path && 'path-' + path, path2 && 'path2-' + path2, path2 && 'duo', b.key && 'key', b.evo && 'evo', offer.forge && 'forge'].filter(Boolean).join(' ');
    el.style.setProperty('--rc', ED.RARITY[b.rar].color);
    if (path && ED.PATHS[path]) el.style.setProperty('--pc', ED.PATHS[path].color);
    if (path2 && ED.PATHS[path2]) el.style.setProperty('--pc2', ED.PATHS[path2].color);
    const rank = have ? (have < max ? `Rank ${have} → ${have + 1} (max ${max})` : `Rank ${have} (max)`) : max > 1 ? `Max rank ${max}` : '';
    el.innerHTML = `<img alt="" src="${ED.Icons.boonUrl(id)}"><div class="bx"><div class="bn">${esc(b.name)}</div><div class="bm"><span class="br">${ED.RARITY[b.rar].name}</span><span class="bl">${boonLabel(b, me)}</span></div><div class="bd">${esc(b.desc)}</div>${rank ? `<div class="bk${have ? ' own' : ''}">${rank}</div>` : ''}</div>`;
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
    const rr = $('btn-reroll'), canRe = offer.rerolls > 0 && !offer.forge;
    rr.hidden = !canRe; rr.innerHTML = `<kbd>K</kbd> Reroll (${offer.rerolls})`;
    $('boon-hint-rr').hidden = !canRe;
    rr.onclick = () => UI.boonReroll(false);
    $('ov-boon').hidden = false;
    $('ov-boon').scrollTop = 0;
    paintFocus();
  };
  const paintFocus = () => { [...$('boon-cards').children].forEach((el, i) => el.classList.toggle('focus', i === boonFocus)); };
  UI.boonMove = (d) => { if (!boonOffer) return; boonFocus = (boonFocus + d + boonOffer.boons.length) % boonOffer.boons.length; paintFocus(); ED.Audio.play('hover'); };
  UI.boonConfirm = () => { if (!boonOffer || performance.now() < boonLock) return; UI.pickBoon(boonFocus); };
  UI.boonReroll = (byKey) => {
    if (!boonOffer || !(boonOffer.rerolls > 0) || boonOffer.forge || performance.now() < boonLock) return;
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

  // ---------------- character sheet (Tab) ----------------
  // One path row: icon, affinity, keystone and evolution status.
  function pathRow(k, me, evoPath) {
    const P = ED.PATHS[k], boons = me.boons || {}, aff = ED.pathAffinity(boons, k);
    const keyId = ED.BOON_IDS.find(id => ED.BOONS[id].key && ED.BOONS[id].path === k);
    const hasKey = !!(keyId && boons[keyId]);
    const keyLine = hasKey ? `Keystone: ${esc(ED.BOONS[keyId].name)}` : aff >= KEY_AFF() ? 'Keystone available in your offers' : `Keystone ready at ${KEY_AFF()}`;
    let evoLine;
    if (evoPath === k) evoLine = `Evolved: ${esc(UI.evoName(k, me.weapon))}`;
    else if (evoPath) evoLine = 'Evolution already taken';
    else if (hasKey && aff >= EVO_AFF()) evoLine = 'Evolution ready — it will appear in your next offer';
    else evoLine = `Evolves at ${EVO_AFF()} with keystone`;
    return `<div class="path-row${evoPath === k ? ' evolved' : ''}" style="--pc:${P.color}"><img alt="" src="${pathIcon(k)}"><div><div class="pr-head"><b>${P.name}</b><span>Affinity ${aff}</span></div><div class="pr-line${hasKey ? ' ok' : ''}">${keyLine}</div><div class="pr-line${evoPath === k ? ' ok' : ''}">${evoLine}</div></div></div>`;
  }

  // Boons grouped by path (pick order), then duo, class and neutral.
  function boonGroups(me) {
    const boons = me.boons || {}, ids = Object.keys(boons).filter(id => ED.BOONS[id] && boons[id] > 0);
    const chip = (id) => { const b = ED.BOONS[id]; return `<span class="chip${b.key ? ' key' : ''}${b.evo ? ' evo' : ''}" style="--rc:${ED.RARITY[b.rar].color}" title="${esc(b.desc)}"><img alt="" src="${ED.Icons.boonUrl(id)}">${esc(b.name)}${boons[id] > 1 ? ' ×' + boons[id] : ''}</span>`; };
    const groups = ED.gatePaths(boons).map(k => [`<span style="color:${ED.PATHS[k].color}">${ED.PATHS[k].name}</span> <small>${ED.pathAffinity(boons, k)}</small>`, ids.filter(id => ED.BOONS[id].path === k), ED.PATHS[k].color]);
    groups.push(['Duo', ids.filter(id => ED.BOONS[id].duo), '']);
    groups.push([`${ED.CLASSES[me.cls].name} technique`, ids.filter(id => ED.BOONS[id].cls), '']);
    groups.push(['Neutral', ids.filter(id => { const b = ED.BOONS[id]; return !b.path && !b.duo && !b.cls; }), '']);
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
    const shieldCap = Math.round(me.maxHp * (st.bloodShield || 0));
    const rows = [
      ['Health', `${Math.ceil(me.hp)} / ${me.maxHp}`], ['Damage', U.pct(st.dmg)], ['Attack speed', U.pct(st.atk)], ['Critical', `${Math.round(st.crit * 100)}% ×${st.critMult.toFixed(2)}`],
      ['Armor', Math.round(st.armor) + ` (−${Math.round((1 - ED.Stats.armorMul(st.armor)) * 100)}%)`], ['Move speed', Math.round(st.moveSpeed)], ['Skills K · L', `${st.skillCd.toFixed(1)}s · ${(st.skill2Cd || 0).toFixed(1)}s`], ['Dodge', Math.round(st.dodge * 100) + '%'],
      ['Life steal', Math.round(st.leech * 1000) / 10 + '%'], ['Level', view.level], ['Gold', view.gold],
    ];
    if (shieldCap > 0) rows.push(['Blood shield', `${Math.ceil(me.shield || 0)} / ${shieldCap}`]);
    $('sheet-dl').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const note = $('sheet-note');
    note.hidden = !(st.leech > 0 || st.hemorrhage);
    note.textContent = `Leech heals at most ${Math.round(LEECH_CAP() * 100)}% max health per second (${(me.maxHp * LEECH_CAP()).toFixed(1)} for you). Damage over time never leeches.`;
    $('sheet-relics').innerHTML = me.relics.length ? me.relics.map(id => { const r = ED.RELICS[id]; return `<span class="chip" style="--rc:${ED.RARITY[r.rar].color}" title="${esc(r.desc)}"><img alt="" src="${ED.Icons.relicUrl(id)}">${r.name}</span>`; }).join('') : '<span class="chip none">None yet</span>';
    $('sheet-boons').innerHTML = boonGroups(me);
    // paths: slots used, affinity, keystone and evolution
    const owned = ED.gatePaths(me.boons || {}), evoPath = ED.evoOf(me.boons || {});
    $('sheet-slots').textContent = `${owned.length}/${ED.MAX_GATES}`;
    $('sheet-paths').innerHTML = owned.map(k => pathRow(k, me, evoPath)).join('') + '<div class="path-row empty">Open path slot</div>'.repeat(Math.max(0, ED.MAX_GATES - owned.length));
    // stratum affinity: now and next
    const biome = ED.biomeFor(view.stratum), nb = view.stratum < ED.BIOMES.length ? ED.biomeFor(view.stratum + 1) : null;
    $('sheet-strat').innerHTML = `Stratum ${U.roman(view.stratum)} · ${esc(biome.name)}<br><small>Lantern ${Math.round(100 * view.light / Math.max(1, view.lightMax))}% · map numbers: light each unvisited room costs</small>`;
    $('sheet-aff').innerHTML = `<div class="aff-row">${affChips(biome)}</div>` + (nb ? `<div class="aff-row next"><span class="lbl">Next · ${nb.short}</span>${affChips(nb, true)}</div>` : '');
    const mc = $('map-canvas'), c = mc.getContext('2d');
    c.clearRect(0, 0, mc.width, mc.height);
    ED.HUD.drawMap(c, view, 10, 10, mc.width - 20, mc.height - 20, 1.6, 0);
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
  UI.openSettings = () => {
    const s = ED.App.settings;
    $('set-master').value = s.master; $('set-music').value = s.music; $('set-sfx').value = s.sfx;
    $('set-aim').value = s.aim; $('set-quality').value = s.quality; $('set-shake').checked = s.shake; $('set-dmg').checked = s.dmg;
    $('ov-settings').hidden = false;
  };

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
    $('btn-continue').onclick = () => A.enterHearth();
    $('btn-title-load').onclick = () => { A.enterHearth(); UI.setTab('save'); };
    // hearth
    for (const b of document.querySelectorAll('#hearth-tabs .tab')) b.onclick = () => { ED.Audio.play('click'); UI.setTab(b.dataset.tab); };
    $('btn-settings').onclick = () => UI.openSettings();
    $('asc-range').oninput = (e) => { A.sel.pact = +e.target.value; A.saveSel(); renderDescend(); };
    $('btn-solo').onclick = () => A.startSolo();
    $('btn-host').onclick = () => A.hostParty();
    $('btn-join').onclick = () => { $('join-row').hidden = !$('join-row').hidden; if (!$('join-row').hidden) $('inp-join').focus(); };
    $('btn-join-go').onclick = () => A.joinParty($('inp-join').value);
    $('inp-join').addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'NumpadEnter') A.joinParty($('inp-join').value); });
    // save tab
    $('btn-copy-code').onclick = () => copy($('save-code').textContent, $('btn-copy-code'));
    $('btn-load-code').onclick = () => {
      const msg = $('load-msg');
      try {
        const prof = S.decode($('inp-code').value);
        UI.confirm('Load this save?', `This replaces the profile in this browser with "${prof.name}" (${prof.embers} embers, ${prof.stats.runs} descents).`, 'Load save', () => {
          A.replaceProfile(prof); msg.textContent = 'Save loaded. Welcome back, ' + prof.name + '.'; msg.className = 'msg ok'; $('inp-code').value = '';
        });
      } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; }
    };
    $('inp-rename').addEventListener('input', () => nameHint($('inp-rename'), $('rename-msg')));
    $('btn-rename').onclick = () => { A.profile.name = S.sanitizeName($('inp-rename').value); A.persist(); renderSave(); UI.toast('Name saved: <b>' + esc(A.profile.name) + '</b>'); };
    $('btn-reset').onclick = () => UI.confirm('Erase this profile?', 'Every ember, upgrade and unlock in this browser will be lost. Copy your save code first if you want to keep it.', 'Erase', () => A.resetProfile());
    // lobby
    $('btn-copy-invite').onclick = () => copy(A.inviteLink(), $('btn-copy-invite'));
    $('btn-lobby-leave').onclick = () => A.leaveLobby();
    $('btn-lobby-go').onclick = () => A.lobbyGo();
    $('lobby-asc-range').oninput = (e) => A.setLobbyPact(+e.target.value);
    $('btn-lobby-hearth').onclick = () => UI.openPartyHearth();
    for (const b of document.querySelectorAll('#ph-tabs .tab')) b.onclick = () => { ED.Audio.play('click'); UI.phTab = b.dataset.tab; UI.renderPartyHearth(); };
    $('btn-ph-close').onclick = () => { $('ov-hearth').hidden = true; if (A.lobbyState) UI.renderLobby(A.lobbyState, A.myPid, !!A.host); };
    // results
    $('btn-res-back').onclick = () => A.enterHearth();
    $('btn-res-copy').onclick = () => copy($('res-code').textContent, $('btn-res-copy'));
    // pause & settings
    $('btn-resume').onclick = () => A.togglePause(false);
    $('btn-pause-settings').onclick = () => UI.openSettings();
    $('btn-abandon').onclick = () => UI.confirm('Abandon this descent?', 'You keep the embers earned so far.', 'Abandon', () => A.abandonRun());
    const setChange = () => {
      const s = A.settings;
      s.master = +$('set-master').value; s.music = +$('set-music').value; s.sfx = +$('set-sfx').value;
      s.aim = $('set-aim').value; s.quality = $('set-quality').value; s.shake = $('set-shake').checked; s.dmg = $('set-dmg').checked;
      A.applySettings();
    };
    for (const id of ['set-master', 'set-music', 'set-sfx', 'set-aim', 'set-quality', 'set-shake', 'set-dmg']) $(id).addEventListener('input', setChange);
    $('btn-settings-close').onclick = () => { $('ov-settings').hidden = true; };
    window.addEventListener('resize', () => { if (!$('ov-boon').hidden) paintDense(); });
    // Esc closes menu overlays outside a run (in a run the frame loop owns Esc)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || A.inRun()) return;
      if (!$('modal').hidden) $('modal').hidden = true;
      else if (!$('ov-settings').hidden) $('ov-settings').hidden = true;
      else if (!$('ov-hearth').hidden) $('btn-ph-close').click();
    });
    nameHint($('inp-name'), $('name-msg'));
    // UI sounds
    document.addEventListener('click', (e) => { if (e.target.closest('.btn')) ED.Audio.play('click'); });
  };
})(globalThis.ED || (globalThis.ED = {}));
