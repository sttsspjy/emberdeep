// DOM screens (client only): title -> hero select -> stage select -> run; level-up card overlay, pause, results, Camp shop and save code, credits.
// ED.UI.show(name) shows one screen ('title' | 'hero' | 'stage' | 'camp' | 'results' | 'none'); overlays are toggled separately.
(function (ED) {
  'use strict';
  const U = ED.U;
  const $ = (id) => document.getElementById(id);
  const UI = ED.UI = { offerSig: '' };
  const SCREENS = ['title', 'hero', 'stage', 'camp', 'results'];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  UI.esc = esc;

  UI.show = (name) => {
    for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
    $('ui').classList.toggle('in-run', name === 'none');
    const f = name !== 'none' && document.querySelector('#scr-' + name + ' [data-focus]');
    if (f) f.focus();
  };
  // Atlas icon as a small canvas (cards, slots).
  UI.iconCanvas = (id, size) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = size; cv.className = 'icon';
    if (ED.Atlas.ok) ED.HUD.icon(cv.getContext('2d'), id, 0, 0, size);
    return cv;
  };

  // ---------------- title ----------------
  UI.renderTitle = () => {
    const A = ED.App, p = A.profile;
    $('name-row').hidden = A.hasProfile;
    $('profile-line').textContent = A.hasProfile ? p.name + '  -  ' + p.gold + ' gold  -  ' + p.stats.runs + ' runs' : '';
  };

  // ---------------- hero select ----------------
  UI.renderHeroes = () => {
    const A = ED.App, list = $('hero-list');
    list.textContent = '';
    for (const cls of ED.HERO_IDS) {
      const h = ED.HEROES[cls]; if (!h) continue;
      const unlocked = ED.Save.heroUnlocked(A.profile, cls), rule = ED.UNLOCKS.heroes[cls];
      const b = document.createElement('button');
      b.className = 'card hero-card' + (A.sel.cls === cls ? ' on' : '') + (unlocked ? '' : ' locked');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', A.sel.cls === cls ? 'true' : 'false');
      b.appendChild(UI.iconCanvas(h.icon, 64));
      const sig = ED.WEAPONS[h.sig], q = ED.SKILLS[h.skills[0]], e = ED.SKILLS[h.skills[1]];
      b.insertAdjacentHTML('beforeend', `<b class="card-name">${esc(h.name)}</b><span class="card-line">HP ${h.hp}  Speed ${h.speed}</span>` +
        `<span class="card-line">${esc(sig ? sig.name : '')}</span><span class="card-sub">Q ${esc(q ? q.name : '')}  E ${esc(e ? e.name : '')}</span>` +
        (unlocked ? '' : `<span class="card-lock">${esc(rule.txt || 'Locked')}</span>`));
      b.onclick = () => { A.sel.cls = cls; A.saveSel(); UI.renderHeroes(); };
      list.appendChild(b);
    }
  };

  // ---------------- stage select ----------------
  UI.renderStages = () => {
    const A = ED.App, list = $('stage-list');
    list.textContent = '';
    ED.STAGES.forEach((sd, i) => {
      const open = ED.Save.stageUnlocked(A.profile, i), best = A.profile.best[sd.id], rule = ED.UNLOCKS.stages[i];
      const b = document.createElement('button');
      b.className = 'card stage-card' + (A.sel.stage === i ? ' on' : '') + (open ? '' : ' locked');
      b.disabled = !open;
      b.insertAdjacentHTML('beforeend', `<b class="card-name">${i + 1}. ${esc(sd.name)}</b>` +
        (best ? `<span class="card-line">Best ${U.fmtTime(best.time)}  ${best.won ? 'Beaten' : ''}</span>` : '<span class="card-line">Not played</span>') +
        (open ? '' : `<span class="card-lock">${esc(rule.txt || 'Locked')}</span>`));
      b.onclick = () => { if (!open) return; A.sel.stage = i; A.saveSel(); UI.renderStages(); };
      list.appendChild(b);
    });
  };

  // ---------------- camp ----------------
  UI.renderCamp = () => {
    const A = ED.App, p = A.profile, S = ED.Save, list = $('shop-list');
    $('camp-gold').textContent = p.gold;
    list.textContent = '';
    for (const s of ED.SHOP) {
      const r = S.rank(p, s.id), cost = S.shopCost(p, s.id), row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `<b>${esc(s.name)}</b><span>${esc(s.txt)}</span><span class="rank">${r} / ${s.max}</span>`;
      const b = document.createElement('button');
      b.className = 'btn btn-sm'; b.textContent = cost ? 'Buy ' + cost : 'Max';
      b.disabled = !cost || p.gold < cost;
      b.onclick = () => { if (S.buy(p, s.id)) { A.persist(); UI.renderCamp(); } };
      row.appendChild(b); list.appendChild(row);
    }
  };

  // ---------------- level-up offer ----------------
  // Shows the hero's current offer (cards with icon, name, level, one line, optional second line); hides when there is none. Rebuilt only when the offer changes.
  UI.syncOffer = (me, solo) => {
    const ov = $('ov-offer'), offer = me && !me.dead ? me.offer : null;
    const sig = offer ? offer.map(c => c.kind + c.id + c.lvl).join('|') + '|' + me.rerolls + me.skips : '';
    if (sig === UI.offerSig) return;
    UI.offerSig = sig;
    ov.hidden = !offer;
    ov.classList.toggle('strip', !solo);
    if (!offer) return;
    const box = $('offer-cards'); box.textContent = '';
    offer.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'card offer-card k-' + c.kind;
      b.appendChild(UI.iconCanvas(c.icon, 48));
      const lv = c.kind === 'weapon' || c.kind === 'passive' ? 'New' : c.lvl ? 'Lv ' + c.lvl : '';
      b.insertAdjacentHTML('beforeend', `<span class="key">${i + 1}</span><b class="card-name">${esc(c.name)}</b><span class="card-lv">${lv}</span><span class="card-txt">${esc(c.txt)}</span>` + (c.sub ? `<span class="card-sub">${esc(c.sub)}</span>` : ''));
      b.onclick = () => ED.Game.pick(i);
      box.appendChild(b);
    });
    $('offer-foot').textContent = `Reroll (R): ${me.rerolls}    Skip (X): ${me.skips}`;
  };

  // ---------------- results ----------------
  UI.renderResults = (sum, gained) => {
    $('res-title').textContent = sum.won ? 'Victory' : 'Fallen';
    $('res-stats').innerHTML = `<div><b>${U.fmtTime(sum.time)}</b><span>Time</span></div><div><b>${sum.kills}</b><span>Kills</span></div><div><b>${sum.level}</b><span>Level</span></div><div><b>${sum.gold}</b><span>Gold</span></div>`;
    const me = sum.perHero.find(h => h.pid === ED.Game.myPid) || sum.perHero[0], chart = $('res-chart');
    chart.textContent = '';
    if (me) {
      const rows = Object.entries(me.dealt).sort((a, b) => b[1] - a[1]).slice(0, 10), max = rows.length ? rows[0][1] : 1;
      for (const [id, v] of rows) {
        const name = ED.WEAPONS[id] ? ED.WEAPONS[id].name : ED.SKILLS[id] ? ED.SKILLS[id].name : id;
        chart.insertAdjacentHTML('beforeend', `<div class="bar-row"><span class="bar-name">${esc(name)}</span><span class="bar"><i style="width:${Math.max(2, 100 * v / max).toFixed(1)}%"></i></span><span class="bar-v">${U.fmtNum(v)}</span></div>`);
      }
    }
    const un = [];
    if (gained) {
      for (const c of gained.unlocked) un.push('New hero: ' + (ED.HEROES[c] ? ED.HEROES[c].name : c));
      for (const s of gained.stages) un.push('New stage: ' + ED.STAGES[s].name);
    }
    $('res-unlocks').innerHTML = un.map(s => `<p>${esc(s)}</p>`).join('');
  };

  UI.bind = () => {
    const A = ED.App;
    $('btn-play').onclick = () => { if (!A.hasProfile) A.createProfile($('inp-name').value); UI.renderHeroes(); UI.show('hero'); };
    $('btn-camp').onclick = () => { if (!A.hasProfile) A.createProfile($('inp-name').value); UI.renderCamp(); UI.show('camp'); };
    $('btn-credits').onclick = () => { $('ov-credits').hidden = false; };
    $('btn-credits-close').onclick = () => { $('ov-credits').hidden = true; };
    $('btn-hero-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-hero-next').onclick = () => { UI.renderStages(); UI.show('stage'); };
    $('btn-stage-back').onclick = () => { UI.renderHeroes(); UI.show('hero'); };
    $('btn-start').onclick = () => A.startSolo();
    $('btn-camp-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
    $('btn-refund').onclick = () => { ED.Save.refundAll(A.profile); A.persist(); UI.renderCamp(); };
    $('btn-code-copy').onclick = () => { $('inp-code').value = ED.Save.encode(A.profile); $('code-msg').textContent = 'Copy this code to restore your progress anywhere.'; };
    $('btn-code-load').onclick = () => {
      try { A.replaceProfile(ED.Save.decode($('inp-code').value)); $('code-msg').textContent = 'Progress restored.'; UI.renderCamp(); }
      catch (e) { $('code-msg').textContent = e.message; }
    };
    $('btn-resume').onclick = () => A.togglePause(false);
    $('btn-quit').onclick = () => A.quitRun();
    $('btn-res-back').onclick = () => { UI.renderTitle(); UI.show('title'); };
  };
})(globalThis.ED || (globalThis.ED = {}));
