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
  UI.portrait = portrait;

  // Path helpers: elements share ids with their paths (fire, ice, lightning, poison, holy, shadow).
  const pathIcon = (k) => ED.Icons.url(ED.PATHS[k].icon, ED.PATHS[k].color);
  const pathName = (k, wrap) => (ED.PATHS[k] ? (wrap ? `<i style="color:${ED.PATHS[k].color}">${ED.PATHS[k].name}</i>` : ED.PATHS[k].name) : '');
  // Evolved weapon name from a weapon name (the fork's name after an Attack fork: 'Cinder Greatsword').
  UI.evoName = (path, weaponName) => (ED.PATHS[path] ? ED.PATHS[path].evo : '') + ' ' + (weaponName || 'Arms');
  const heroWeaponName = (p) => (p && p.stats && p.stats.weapon ? p.stats.weapon.name : p && ED.WEAPONS[p.weapon] ? ED.WEAPONS[p.weapon].name : '');
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
      $('dot-hearth').hidden = !canBuy(p);
    }
    $('title-load').hidden = true;
    const jc = A.pendingJoin;
    $('title-join').hidden = !jc || !has;
    if (jc) $('title-join-code').textContent = jc;
  };

  // One-time notice for a profile made before the current rules (profile.news): relic and Hearth changes, then the v3 rules, and the embers the Codex refunded. Closing it clears the flag.
  const MOVED_RELICS = ['stormcall', 'thundergauntlet', 'frostheart', 'souljar']; // the element relics that became path boons
  UI.maybeNews = () => {
    const A = ED.App, p = A.profile;
    if (!A.hasProfile || !p.news) return;
    $('news-body').innerHTML = [
      '<b>Relics:</b> the Codex is gone. Every relic can drop from your first descent, and relics no longer belong to an element.',
      `<b>Element relics are path boons now:</b> ${MOVED_RELICS.map(id => `${esc(ED.BOONS[id].name)} (${pathName(ED.BOONS[id].path, true)})`).join(', ')}. The other element relics are gone: their paths already hold the same effects as boons.`,
      p.refunded > 0 ? `<b>Refunded:</b> the ${p.refunded} embers you spent on the Codex are back in your purse.` : '',
      '<b>Hearth:</b> every upgrade rank can be refunded for its full cost, and Reset all returns everything at once. Upgrades are small now, so your build choices decide a descent. The Reliquary became the Stash (starting gold), Head Start begins the descent with some experience and Deep Wick boosts the gold and experience of dark rooms. Each hero has an Armory list for sidegrade unlocks (empty in this release).',
      '<b>Builds:</b> generic health and armor boons are smaller; a path (its boons, keystone and weapon evolution) is what makes a build strong. Kill effects that spread, chain or explode work on fodder; refunds, shields, healing and stacks need the foes that matter.',
      '<b>Aim:</b> attacks and ground skills go toward the mouse cursor (right stick on a pad). The Auto-aim setting is gone.',
      `<b>Paths:</b> follow up to ${ED.MAX_ELEMENTS} of ${ED.ELEMENT_IDS.map(k => pathName(k, true)).join(', ')}, or take the ${pathName('general', true)} path alone as a Generalist. Blood and Spirit are gone.`,
      '<b>No life steal:</b> hits do not heal you any more. Shields take their place.',
      '<b>Knight:</b> Shield Throw replaces Bulwark.',
      '<b>Dark rooms:</b> the lantern, the Gloom and oil are gone. Each floor has two optional dark rooms: harder fights, richer rewards.',
    ].filter(Boolean).map(t => `<p>${t}</p>`).join('');
    $('ov-news').hidden = false;
    requestAnimationFrame(() => $('btn-news-close').focus({ preventScroll: true })); // after the screen's own focus
  };

  // ---------------- sections ----------------
  UI.tab = 'descend';
  const SECTION = { descend: 'Descend', upgrades: 'Hearth', chronicle: 'Hearth', heroes: 'Heroes' };
  UI.setTab = (t) => {
    UI.tab = t;
    $('sec-title').textContent = SECTION[t] || 'Descend';
    $('hearth-tabs').hidden = SECTION[t] !== 'Hearth';
    for (const b of document.querySelectorAll('#hearth-tabs .tab')) b.classList.toggle('on', b.dataset.tab === t);
    for (const p of document.querySelectorAll('.pane')) p.hidden = p.dataset.pane !== t;
    UI.renderHearth();
  };

  const canBuyUpgrade = (p) => ED.UPGRADES.some(u => S.upgradeAvailable(p, u) && p.up[ED.UPGRADE_IDX[u.id]] < u.costs.length && p.embers >= u.costs[p.up[ED.UPGRADE_IDX[u.id]]]);
  const armoryOf = (cls) => ED.ARMORY[cls] || [];
  const armoryHas = (p, cls, i) => !!(p.armory && p.armory[cls] && p.armory[cls][i]);
  // An Armory entry of an unlocked hero is affordable.
  const canBuyArmory = (p) => ED.CLASS_IDS.some(c => S.classUnlocked(p, c) && armoryOf(c).some((e, i) => !armoryHas(p, c, i) && p.embers >= e.cost));
  const canBuy = (p) => canBuyUpgrade(p) || canBuyArmory(p);

  UI.renderHearth = () => {
    const p = ED.App.profile;
    $('hearth-embers').textContent = p.embers;
    $('dot-upgrades').hidden = !canBuy(p);
    if (UI.tab === 'descend') renderDescend();
    else if (UI.tab === 'upgrades') renderUpgrades();
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

  // One line per skill of the numbers its parts have for a boonless hero ("Impact 49 · stun 1s · Shockwave …"), from the sheet model.
  function skillFacts(cls, st) {
    const out = {};
    try {
      const Sh = ED.Sheet, p = { pid: 'camp', name: '', cls, weapon: st.weaponId.split('@')[0], boons: {}, relics: [], meta: { up: [], mastery: 1 }, stats: st, hp: st.maxHp, maxHp: st.maxHp, shield: 0, picks: 0, slot: 0 };
      const m = Sh.compute(p, Sh.ctx({ stratum: 1, pact: 0, players: new Map(), allies: [] }, p), { raw: true });
      for (const k of m.skills) {
        out[k.id] = k.parts.filter(q => q.kind !== 'zone').map(q => {
          const bits = [q.label + ' ' + Sh.n1(q.kind === 'status' ? q.here : q.hit)];
          if (q.kind === 'tick' || q.kind === 'sec') bits.push(`${q.oneFoe} ticks`);
          else if (q.kind === 'minion') bits.push(`${q.hitsEach} strikes each`);
          if (q.r) bits.push('radius ' + q.r);
          if (q.stun) bits.push('stun ' + Sh.n1(q.stun) + 's');
          return bits.join(' ');
        }).join(' · ');
      }
    } catch (e) { /* the description alone */ }
    return out;
  }

  function renderDescend() {
    const A = ED.App, p = A.profile;
    const cls = A.sel.cls, c = ED.CLASSES[cls];
    rosterTiles($('class-list'), cls, (id) => { A.selectClass(id); renderDescend(); });
    const st = ED.Stats.compute({ cls, weapon: A.sel.weapon, boons: {}, relics: [], meta: S.metaBundle(p, cls), pact: A.sel.pact });
    const skills = [[c.skill, 'skill1', st.skillCd], [c.skill2, 'skill2', st.skill2Cd]].filter(x => ED.SKILLS[x[0]]);
    const facts = skillFacts(cls, st);
    $('hero-detail').innerHTML = `
      <div class="hd-top"><div id="hd-port"></div><div><div class="hd-name">${c.name}</div><div class="hd-title">${c.title}</div><p class="hd-desc">${esc(c.desc)}</p></div></div>
      <div class="hd-skills">${skills.map(([id, act, cd]) => { const sk = ED.SKILLS[id]; return `<div class="hd-skill"><img alt="" src="${ED.Icons.url(sk.icon, c.col.c)}"><div><div class="sk-head"><b>${sk.name}</b>${keys(act)}<span class="cd">${cd.toFixed(1)}s cooldown</span></div><p>${esc(sk.desc)}</p>${facts[id] ? `<div class="sk-facts">${esc(facts[id])}</div>` : ''}</div></div>`; }).join('')}</div>`;
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
      const gen = ED.CLASS_IDS.filter(c => !ED.CLASSES[c].element).map(c => ED.CLASSES[c].name); // heroes without a class element can go Generalist
      lines.push('<b>Aim:</b> aim with the mouse; skills go to the cursor. At level 3 you choose a class route.');
      lines.push(`<b>Paths:</b> follow up to ${ED.MAX_ELEMENTS} of ${ED.ELEMENT_IDS.map(k => pathName(k, true)).join(', ')}, or, as ${gen.slice(0, -1).join(', ')} or ${gen[gen.length - 1]}, take the ${pathName('general', true)} path alone as a Generalist. Each stratum is weak to one element.`);
      lines.push('<b>Dark rooms:</b> a door marked dark leads to an optional dead end: foes hit harder and an extra elite joins, but the reward is a step richer and gold and experience drop in larger piles.');
    }
    if (p.stats.runs === 0) lines.push('<b>First goal:</b> reach the Bone Warden at the end of the Ossuary. Every descent pays embers, win or lose.');
    else if (next) lines.push(`<b>Next hero:</b> ${ED.CLASSES[next].name} (${esc(ED.CLASSES[next].unlock.text)}).`);
    else if (tierNext) lines.push(`<b>Reach stratum ${U.roman(tierNext.tier)}</b> to reveal new Hearth upgrades.`);
    else if (!p.stats.wins) lines.push('<b>Next goal:</b> defeat the Hollow King to complete a descent and unlock Pacts.');
    else if (p.pactMax < 10) lines.push(`<b>Pacts:</b> complete a descent under Pact ${p.pactMax} to unlock Pact ${p.pactMax + 1}.`);
    else lines.push('<b>Every hero and pact is yours.</b> The Deep still has deeds to earn.');
    return lines.map(l => '<p>' + l + '</p>').join('');
  }

  function buyButton(cost, can, label, onClick) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'btn buy' + (can ? ' btn-primary' : ' cant');
    b.innerHTML = `<span class="ember-ico"></span>${cost}`;
    b.disabled = !can; b.setAttribute('aria-label', label); b.title = label;
    b.onclick = onClick;
    return b;
  }

  function refundButton(gain, label, onClick) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'btn btn-small btn-ghost refund';
    b.textContent = `Refund +${gain}`;
    b.setAttribute('aria-label', label); b.title = label;
    b.onclick = onClick;
    return b;
  }
  // Refund and Buy stacked in a card's last column; data-fk names each button so a re-render can put keyboard focus back.
  function actionsCell(card, key, refund, buy) {
    const d = document.createElement('div'); d.className = 'up-act';
    if (refund) { refund.dataset.fk = key + ':refund'; d.appendChild(refund); }
    if (buy) { buy.dataset.fk = key + ':buy'; d.appendChild(buy); }
    card.appendChild(d);
  }
  // After a re-render: focus the button with the same key, else a sibling button of the same card or section, else nothing.
  function restoreFocus(grid, fk) {
    if (!fk) return;
    const btns = [...grid.querySelectorAll('[data-fk]')].filter(b => !b.disabled);
    const stem = (k) => k.slice(0, k.lastIndexOf(':'));
    const el = btns.find(b => b.dataset.fk === fk) || btns.find(b => stem(b.dataset.fk) === stem(fk));
    if (el) el.focus({ preventScroll: true });
  }

  // Reset all: the first click arms the button for 3 s (a click elsewhere disarms it), the second refunds every upgrade rank and Armory unlock.
  let resetTimer = 0;
  function paintReset(b) {
    const n = S.refundTotal(ED.App.profile), armed = !!resetTimer && n > 0;
    b.textContent = armed ? `Confirm reset (+${n} embers)` : 'Reset all';
    b.classList.toggle('btn-danger', armed);
    b.disabled = n <= 0;
    const label = armed ? `Confirm: refund every upgrade rank and Armory unlock for ${n} embers` : `Reset all: refund every upgrade rank and Armory unlock (${n} embers)`;
    b.setAttribute('aria-label', label); b.title = label;
  }
  function disarmReset() {
    if (!resetTimer) return;
    clearTimeout(resetTimer); resetTimer = 0;
    for (const b of document.querySelectorAll('.btn-reset')) paintReset(b);
  }

  function renderUpgrades(grid) {
    const p = ED.App.profile;
    grid = grid || $('up-grid');
    const fk = document.activeElement && grid.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
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
        if (r > 0 || (open && r < max)) {
          const back = r > 0 ? refundButton(u.costs[r - 1], `Refund ${u.name} rank ${r}: +${u.costs[r - 1]} embers`, () => { if (S.refundUpgrade(p, u.id)) ED.App.afterMetaChange(); }) : null;
          const cost = u.costs[r];
          const buy = open && r < max ? buyButton(cost, p.embers >= cost, `Buy ${u.name}: ${u.step} for ${cost} embers`, () => { if (S.buyUpgrade(p, u.id)) { ED.Audio.play('buy'); ED.App.afterMetaChange(); } }) : null;
          actionsCell(card, 'u:' + u.id, back, buy);
        }
        grid.appendChild(card);
      }
    }
    // Armory: each unlocked hero's sidegrade entries (a hero section is absent while its list is empty)
    for (const c of ED.CLASS_IDS) {
      const list = armoryOf(c);
      if (!list.length || !S.classUnlocked(p, c)) continue;
      const cl = ED.CLASSES[c];
      const h = document.createElement('div'); h.className = 'tier-head'; h.textContent = `${cl.name} Armory`;
      grid.appendChild(h);
      list.forEach((e, i) => {
        const own = armoryHas(p, c, i);
        const card = document.createElement('div');
        card.className = 'up-card' + (own ? ' maxed' : '');
        card.innerHTML = `<img alt="" src="${ED.Icons.url(e.icon || 'chest', cl.col.c)}"><div><div class="un">${esc(e.name)}${own ? ' <span class="badge-max">Owned</span>' : ''}</div><div class="ud">${esc(e.desc)}</div></div>`;
        if (own) actionsCell(card, `a:${c}:${e.id}`, refundButton(e.cost, `Refund ${e.name}: +${e.cost} embers`, () => { if (S.refundArmory(p, c, e.id)) ED.App.afterMetaChange(); }), null);
        else actionsCell(card, `a:${c}:${e.id}`, null, buyButton(e.cost, p.embers >= e.cost, `Buy ${e.name} for ${e.cost} embers`, () => { if (S.buyArmory(p, c, e.id)) { ED.Audio.play('buy'); ED.App.afterMetaChange(); } }));
        grid.appendChild(card);
      });
    }
    const foot = document.createElement('div'); foot.className = 'up-foot';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn btn-reset'; reset.dataset.fk = 'reset:all';
    paintReset(reset);
    reset.onclick = () => {
      if (!resetTimer) { resetTimer = setTimeout(disarmReset, 3000); paintReset(reset); return; }
      clearTimeout(resetTimer); resetTimer = 0;
      if (S.resetUpgrades(p) > 0) { ED.Audio.play('buy'); ED.App.afterMetaChange(); } else paintReset(reset);
    };
    foot.appendChild(reset);
    grid.insertBefore(foot, grid.firstChild); // above the first tier, visible without scrolling
    restoreFocus(grid, fk);
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
    $('dot-lobby-hearth').hidden = !canBuy(A.profile);
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
    $('ph-dot-upgrades').hidden = !canBuy(p);
    for (const b of document.querySelectorAll('#ph-tabs .tab')) b.classList.toggle('on', b.dataset.tab === UI.phTab);
    for (const t of ['upgrades', 'heroes']) $('ph-' + t).hidden = t !== UI.phTab;
    if (UI.phTab === 'upgrades') renderUpgrades($('ph-upgrades'));
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
      return [`${rt && rt.route ? ED.routeLabel(me.cls, rt.route) : 'Route'}: choose your fork`, 'A fork changes how the route plays; the second and fourth bosses rank it up', null];
    }
    if (src === 'start') { // only heroes without a class element are offered the General gate
      const cl = me && ED.CLASSES[me.cls];
      return [OFFER_HEAD.start, cl && cl.element ? `Paths gate your boons: pick up to ${ED.MAX_ELEMENTS} element paths` : `Paths gate your boons: ${ED.MAX_ELEMENTS} element paths, or Generalist`, null];
    }
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
  const boonRibbon = (b, id) => (b.evo ? 'Evolution' : b.asc ? 'Ascended' : b.duo ? 'Duo' : b.key ? 'Keystone' : id === 'generalist' ? 'Forsake the elements' : b.gate ? 'Path gate' : b.route ? (b.tag ? b.tag + (b.coop ? ' · co-op' : '') : 'Route') : '');
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
    let h = `<div class="bd">${esc(P.text)}${P.rider2 ? ` <b>${esc(P.rider2Name)}</b>: ${esc(P.rider2)}` : ''}${P.rider ? ` <b>${esc(P.riderName)}</b>: ${esc(P.rider)}` : ''}${P.form ? ` <b>${esc(P.form.name)}</b>: ${esc(P.form.desc)}` : ''}</div>`;
    if (b.tier === 1) h += `<div class="bplay">Plays as: ${esc(b.plays)}</div><div class="bplay">Forks: ${b.forks.map(f => esc(ED.BOONS[f].name)).join(' / ')}</div>`;
    else {
      const nx = [];
      if (P.rider2Name && !P.rider2) nx.push('Rank 2: ' + P.rider2Name);
      if (b.form && !P.form) nx.push('Rank 3: ' + b.form.name); else if (P.riderName && !P.rider && !b.form) nx.push('Rank 3: ' + P.riderName);
      if (nx.length) h += `<div class="bplay">${esc(nx.join(' · '))}</div>`;
    }
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

  // The (at most 2) numbers each offered card changes most: [[{ label, from, to, unit, better }]] from the hero's sheet models now and with each card (computed once per offer).
  function offerDeltas(offer, me) {
    const s = ED.Game.s;
    if (!s || !me || !me.stats) return [];
    try {
      const Sh = ED.Sheet, ctx = Sh.ctx(s.view, me), base = Sh.compute(me, ctx);
      return offer.boons.map(id => Sh.deltas(base, Sh.compute(Sh.withBoon(me, id, ctx), ctx)));
    } catch (e) { return []; }
  }
  const deltaHtml = (list) => (list && list.length ? `<div class="bdl">${list.map(d => `<span class="${d.better ? 'up' : 'down'}">${esc(d.label)} ${ED.Sheet.n1(d.from)} → ${ED.Sheet.n1(d.to)}${d.unit ? ' ' + d.unit : ''}</span>`).join('')}</div>` : '');
  function boonCard(id, i, offer, me, deltas) {
    const b = ED.BOONS[id], max = me && me.stats ? ED.maxRank(b, me.stats) : (b.max || 5);
    const have = me && me.boons ? (me.boons[id] || 0) : 0;
    const path = b.path || (b.duo && b.duo[0]) || null, path2 = b.duo ? b.duo[1] : null;
    const el = document.createElement('button'); el.type = 'button';
    el.className = ['boon-card', path ? 'path-' + path : b.cls ? 'class' : 'neutral', path2 && 'path2-' + path2, path2 && 'duo', b.key && 'key', b.evo && 'evo', b.asc && 'asc', offer.forge && 'forge'].filter(Boolean).join(' ');
    el.style.setProperty('--rc', ED.RARITY[b.rar].color);
    if (path && ED.PATHS[path]) el.style.setProperty('--pc', ED.PATHS[path].color);
    if (path2 && ED.PATHS[path2]) el.style.setProperty('--pc2', ED.PATHS[path2].color);
    const rank = have ? (have < max ? `Rank ${have} → ${have + 1} (max ${max})` : `Rank ${have} (max)`) : max > 1 ? `Max rank ${max}` : '';
    const ribbon = boonRibbon(b, id), [line, two] = boonPathLine(b);
    el.innerHTML = `${ribbon ? `<span class="bc-ribbon${two ? ' two' : ''}">${ribbon}</span>` : ''}<div class="bc-top">${line}<span class="bc-rar">${ED.RARITY[b.rar].name}</span></div><img class="bc-icon" alt="" src="${ED.Icons.boonUrl(id)}"><div class="bn">${esc(b.name)}</div>${b.evo ? `<div class="bsub">${esc(UI.evoName(b.evo, heroWeaponName(me)))}</div>` : ''}${weakChip(b)}${b.route ? classBody(b, id, have, me) : `<div class="bd">${esc(ED.Sheet.text(id, Math.min(max, have + 1), me && me.stats))}</div>`}${deltaHtml(deltas)}${rank ? `<div class="bk${have ? ' own' : ''}">${rank}</div>` : ''}`;
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
    const dl = offerDeltas(offer, me);
    offer.boons.forEach((id, i) => wrap.appendChild(boonCard(id, i, offer, me, dl[i])));
    paintDense();
    const [head, sub, hp] = offerHead(offer, me);
    $('boon-head').textContent = head;
    $('boon-head').style.color = hp ? ED.PATHS[hp].color : '';
    $('boon-sub').textContent = sub; $('boon-sub').hidden = !sub;
    $('boon-count').textContent = offer.picks > 1 ? `(${offer.picks} waiting)` : '';
    const fixed = offer.src === 'class'; // a route or fork pick is a fixed choice: no reroll
    const rr = $('btn-reroll'), canRe = offer.rerolls > 0 && !offer.forge && !fixed;
    const pad = ED.Input.device === 'pad';
    rr.hidden = !canRe; rr.innerHTML = `<kbd>${pad ? 'Y' : esc(ED.Input.label('skill1'))}</kbd> Reroll (${offer.rerolls})`;
    $('boon-hint').innerHTML = (pad ? '<kbd>D-pad</kbd> select · <kbd>X</kbd> take · <kbd>Back</kbd> sheet' : `${keyPair('left', 'right')} select · <kbd>${esc(ED.Input.label('attack'))}</kbd> or <kbd>Enter</kbd> take · <kbd>${esc(ED.Input.label('map'))}</kbd> character sheet`) + (fixed ? ' · Routes are fixed choices' : '');
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
    if (!boonOffer || !(boonOffer.rerolls > 0) || boonOffer.forge || boonOffer.src === 'class' || performance.now() < boonLock) return;
    boonLock = performance.now() + BOON_LOCK_MS; // the fresh hand arrives in a moment; don't send twice
    if (byKey) ED.Audio.play('click');
    ED.Game.act({ t: 'reroll' });
  };
  UI.pickBoon = (i) => {
    if (!boonOffer) return;
    boonOffer = null;
    $('ov-boon').hidden = true;
    ED.Input.mask(['attack', 'skill1', 'skill2', 'dash']); // the pick press (or a held attack) must not reach the hero; movement keys stay live
    ED.Game.act({ t: 'pick', i });
    if (ED.Game.s) { ED.Game.s.offerOpen = false; ED.Game.s.offer = null; }
  };
  UI.hideBoons = () => { boonOffer = null; $('ov-boon').hidden = true; };

  // ---------------- fork rank reveal ----------------
  // A card at the top of the screen for FORK_REVEAL_MS when a boss ranks the hero's fork up ({ id, rank }): rank 2 names the new behaviour, rank 3 the transform big, with its text and the card's art. It takes no input.
  const FORK_REVEAL_MS = 8000;
  let forkTimer = 0;
  UI.forkReveal = (m) => {
    const b = ED.BOONS[m.id], el = $('ov-fork');
    if (!b || !el || !(m.rank >= 2)) return;
    const me = ED.Game.s && ED.Game.s.me, P = ED.cardParts(m.id, m.rank, me && me.stats), big = m.rank >= 3, form = big && P.form;
    const name = form ? P.form.name : P.rider2Name || P.riderName || ED.cardName(m.id, m.rank), text = form ? P.form.desc : big && P.rider ? P.rider : P.rider2;
    const route = b.route ? ED.routeLabel(b.cls, b.route) : '';
    el.className = 'fork-reveal ' + (big ? 'big' : 'small');
    el.innerHTML = `<img class="fr-icon" alt="" src="${ED.Icons.boonUrl(m.id)}"><div class="fr-body"><div class="fr-kick">${esc(route)}${route ? ' · ' : ''}${esc(b.name)} · rank ${m.rank}${form ? ' · transformed' : ''}</div><div class="fr-name">${esc(name)}</div><div class="fr-text">${esc(text ? text.charAt(0).toUpperCase() + text.slice(1) : '')}</div></div>`;
    el.hidden = true; void el.offsetWidth; el.hidden = false; // restarts the animation of a card that is still up
    clearTimeout(forkTimer);
    forkTimer = setTimeout(() => { el.hidden = true; }, FORK_REVEAL_MS);
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
    $('res-stats').innerHTML = [
      ['Deepest stratum', `${U.roman(sum.stratum || 1)} · ${biome.short}`], ['Time', U.fmtTime(sum.time || 0)], ['Level reached', sum.level || 1],
      ['Rooms cleared', sum.roomsCleared || 0], total > 0 ? ['Rooms explored', `${seen} / ${total} (${Math.round(seen / total * 100)}%)`] : null,
      ['Foes slain', sum.kills || 0], ['Bosses slain', sum.bossCount || 0], ['Party', (sum.party || 1) + (sum.party > 1 ? ' heroes' : ' hero')],
      sum.pact ? ['Pact', sum.pact] : null,
    ].filter(Boolean).map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const evo = sum.myEvo && ED.PATHS[sum.myEvo.path] ? sum.myEvo : null, evoEl = $('res-evo');
    evoEl.hidden = !evo && !sum.partyEvolved;
    evoEl.style.setProperty('--pc', evo ? ED.PATHS[evo.path].color : 'var(--r-legend)');
    evoEl.innerHTML = evo ? `<img alt="" src="${pathIcon(evo.path)}"><span>Evolved: <b>${esc(UI.evoName(evo.path, evo.weapon))}</b> <small>${ED.PATHS[evo.path].name} path</small></span>` : sum.partyEvolved ? '<span>A hero in your party evolved their weapon.</span>' : '';
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
  // The menu behind the Credits / Settings dialogs takes no focus while one is open.
  const titleInert = (on) => { const t = $('scr-title'); if (t) t.inert = on; };
  UI.openSettings = (tab) => {
    const A = ED.App, s = A.settings;
    $('set-master').value = s.master; $('set-music').value = s.music; $('set-sfx').value = s.sfx;
    $('set-quality').value = s.quality; $('set-framecap').value = s.frameCap; $('set-shake').checked = s.shake; $('set-dmg').checked = s.dmg;
    $('set-cursor').value = s.cursor; $('set-reticle').value = s.reticle; $('set-retcol').value = s.reticleCol; $('set-aimprev').checked = s.aimPreview !== false;
    for (const id of ['set-master', 'set-music', 'set-sfx']) fill($(id));
    $('stab-profile').hidden = A.inRun() || !A.hasProfile; // profile tools never appear mid-descent
    if (A.state === 'title') titleInert(true);
    $('ov-settings').hidden = false;
    UI.setSettingsTab(tab || UI.settingsTab);
    const on = document.querySelector('#set-tabs .tab.on'); if (on) on.focus({ preventScroll: true });
  };
  UI.closeSettings = () => {
    ED.Input.stopCapture();
    $('ov-settings').hidden = true;
    titleInert(false);
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
    $('mm-credits').onclick = () => { titleInert(true); $('ov-credits').hidden = false; $('btn-credits-close').focus({ preventScroll: true }); };
    $('btn-credits-close').onclick = () => { $('ov-credits').hidden = true; titleInert(false); $('mm-credits').focus({ preventScroll: true }); };
    $('btn-news-close').onclick = () => { $('ov-news').hidden = true; A.profile.news = 0; A.profile.refunded = 0; A.persist(); if ($('mm-descend').offsetParent) $('mm-descend').focus({ preventScroll: true }); };
    document.addEventListener('click', (e) => { if (resetTimer && !e.target.closest('.btn-reset')) disarmReset(); }, true);
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
      else if (!$('ov-news').hidden) $('btn-news-close').click();
      else if (!$('ov-credits').hidden) $('btn-credits-close').click();
      else if (!$('ov-settings').hidden) UI.closeSettings();
      else if (!$('ov-hearth').hidden) $('btn-ph-close').click();
      else if (A.state === 'hearth' && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) A.goHome();
    });
    nameHint($('inp-name'), $('name-msg'));
    UI.wireSheet();
    ED.Icons.fit(); window.addEventListener('resize', () => ED.Icons.fit());
    // UI sounds
    document.addEventListener('click', (e) => { if (e.target.closest('.btn, .menu-btn')) ED.Audio.play('click'); });
  };
})(globalThis.ED || (globalThis.ED = {}));
