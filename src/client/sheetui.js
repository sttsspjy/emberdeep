// The Tab sheet: header, three tabs (Build, Combat, Map) rendered from ED.Sheet.compute, live refresh, spatial keyboard / mouse / gamepad focus, the lantern map canvas.
// A tab is rebuilt (innerHTML) only when its markup changes apart from its live cells (data-live text), which are patched in place; only the visible tab renders, at most twice a second.
(function (ED) {
  'use strict';
  const U = ED.U, UI = ED.UI, Sh = ED.Sheet, S = ED.Save;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc, n1 = Sh.n1;
  const TABS = ['build', 'combat', 'map'];
  const SH = { tab: 'build', viewPid: null, model: null, dirty: true, t: 99, sig: {}, live: {}, focusEl: null, focusKey: null, held: {}, mapKey: '', opened: false };
  UI.sheetState = SH;

  // ---------------- formatting helpers ----------------
  const X = (v) => '×' + v.toFixed(2);
  const pc = (v) => { const p = v * 100, a = Math.abs(p); return (a >= 10 ? String(Math.round(p)) : String(Math.round(p * 10) / 10)) + '%'; };
  const sgn = (v, s) => (v < 0 ? '−' : '+') + s;
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pl = (n, w) => (n === 1 ? w : w + 's');
  const colorOf = (el) => (ED.PATHS[el] ? ED.PATHS[el].color : '#d9dfe8');
  const ico = (name, color) => ED.Icons.url(name, color);
  const pathIco = (k) => ico(ED.PATHS[k].icon, ED.PATHS[k].color);
  const RAR = (r) => ED.RARITY[r];
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const WEAPON_ICON = { sword: 'sword', hammer: 'hammer', spear: 'arrow', bow: 'bow', crossbow: 'arrows', staff: 'flame', wand: 'star', tome: 'scroll', dagger: 'dagger', scythe: 'blades', mace: 'hammer', lantern: 'lantern' };
  const live = (key, text) => `<b data-live="${key}">${esc(text)}</b>`;
  const pips = (rank, max, col) => { let s = ''; for (let i = 1; i <= max; i++) s += `<i class="${i <= rank ? 'on' : ''}"${i <= rank ? ` style="background:${col}"` : ''}></i>`; return s; };
  const col = (name, body, cls) => `<section class="plate sh-col${cls ? ' ' + cls : ''}" data-col="${name}"><div class="sh-in">${body}</div></section>`;
  const head = (title, small) => `<h3 class="plate-h">${title}${small ? ` <small>${small}</small>` : ''}</h3>`;
  // Source chips of one stat: [{ label, kind, v, mul? }] -> "Base 100%", "Might 3 +12%", "Honed Edge ×1.15" (an Ascended multiplier); a negative contribution is the only red on the sheet.
  const chips = (rows, key) => rows.map(r => (r.kind === 'base' ? `<span>${esc(r.label)} <b>100%</b></span>`
    : r.mul ? `<span class="asc">${esc(r.label)} <b>${Sh.fmt(key, 1 + r.v, 'x')}</b></span>`
    : `<span class="${r.v < 0 ? 'neg' : ''}${r.kind === 'temp' ? ' tmp' : ''}">${esc(r.label)} <b>${sgn(r.v, Sh.fmt(key, Math.abs(r.v)))}</b></span>`)).join('');
  // src: the chip row as a string, or [{ lab, html }] for several labelled rows.
  const srcRows = (src) => (Array.isArray(src) ? src.filter(g => g.html).map(g => `<div class="sh-src"><span class="sh-sk">${g.lab}</span>${g.html}</div>`).join('') : src ? `<div class="sh-src">${src}</div>` : '');
  const stat = (k, label, value, sub, src, cls) => `<div class="sh-stat sh-f${cls ? ' ' + cls : ''}" data-k="${k}"><div class="sh-sl"><span class="sh-l">${label}</span><span class="sh-v">${value}</span></div>${sub ? `<div class="sh-sub">${sub}</div>` : ''}${srcRows(src)}</div>`;

  const viewed = () => {
    const s = ED.Game.s;
    if (SH.viewPid && s.view.players.get(SH.viewPid)) return s.view.players.get(SH.viewPid);
    SH.viewPid = null;
    return s.me;
  };

  // ---------------- header ----------------
  // "Weak: Fire → your Fire ×1.50" and "Resists: Ice → your Ice ×0.50" chips of a stratum (the multiplier only for elements the hero uses); the class element lists its skills (half the affinity) before its statuses.
  function affChips(a) {
    const chip = (el, kind) => {
      if (!el || !ED.PATHS[el]) return '';
      const mm = a.mine.find(x => x.el === el), nm = ED.PATHS[el].name;
      const mine = !mm ? '' : mm.skillMul !== null ? ` → your ${nm} skills ${X(mm.skillMul)} · statuses ${X(mm.mul)}` : ` → your ${nm} ${X(mm.mul)}`;
      return `<span class="aff-chip ${kind}" style="--pc:${colorOf(el)}"><img alt="" src="${pathIco(el)}">${kind === 'weak' ? 'Weak' : 'Resists'}: ${nm}${mine}</span>`;
    };
    return chip(a.weak, 'weak') + chip(a.resist, 'resist');
  }
  function paintHeader(m) {
    const h = m.hero, biome = ED.biomeFor(m.ctx.stratum), color = ED.PLAYER_COLORS[h.slot] || '#ff8a3d';
    const px = Math.ceil(3.6 * rem() * (window.devicePixelRatio || 1)), key = h.pid + '|' + h.cls + '|' + m.weapon.base + '|' + px + '|' + (ED.Actors && ED.Actors.on() ? 1 : 0);
    if ($('sh-port').dataset.key !== key) {
      const cv = UI.portrait(h.cls, Math.ceil(px / 2), h.slot, m.weapon.base);
      cv.className = 'sh-pcv'; $('sh-port').replaceChildren(cv); $('sh-port').dataset.key = key;
    }
    $('sh-name').textContent = h.name; $('sh-name').style.color = color;
    $('sh-class').textContent = ' · ' + h.clsName;
    const rt = m.build.route;
    $('sh-sub').textContent = m.weapon.name + (rt.route ? ' · ' + ED.routeLabel(h.cls, rt.route) + ' route' + (rt.fork ? ': ' + ED.BOONS[rt.fork].name + (rt.rank > 1 ? ' (rank ' + rt.rank + ')' : '') : '') : ' · no route yet');
    const xpf = U.clamp(h.xp / Math.max(1, h.xpNext), 0, 1);
    $('sh-lv').textContent = 'Lv ' + h.level; $('sh-xpbar').style.width = Math.round(100 * xpf) + '%'; $('sh-xp').textContent = Math.round(100 * xpf) + '%';
    $('sh-hp').textContent = `${h.hp} / ${h.maxHp}`; $('sh-hpbar').style.width = Math.round(100 * U.clamp(h.hp / Math.max(1, h.maxHp), 0, 1)) + '%';
    $('sh-shield').textContent = h.shield > 0 ? '+' + Math.ceil(h.shield) : ''; $('sh-shield').hidden = !(h.shield > 0);
    $('sh-gold').textContent = String(h.gold);
    if (!$('sh-coin').getAttribute('src')) $('sh-coin').src = ico('coin', '#ffd36b');
    $('sh-strat').textContent = `Stratum ${U.roman(m.ctx.stratum)} · ${biome.name}`;
    $('sh-aff').innerHTML = affChips(m.aff.now);
  }

  // ---------------- Build tab ----------------
  function pathRow(P) {
    const cells = [];
    for (let i = 1; i <= P.evo.at; i++) cells.push(`<i class="${i <= P.aff ? 'on' : ''}${i === P.key.at ? ' key' : ''}${i === P.evo.at ? ' star' + (P.evo.state === 'evolved' ? ' got' : '') : ''}"></i>`);
    const keyTxt = P.key.state === 'owned' ? `${esc(P.key.name)} <b>owned</b>` : P.key.state === 'offers' ? `${esc(P.key.name)} <b>in your offers</b>` : `${esc(P.key.name)} <span class="mut">needs ${P.key.need} more</span>`;
    const evoTxt = P.evo.state === 'evolved' ? `<b>Evolved:</b> ${esc(P.evo.name)}` : P.evo.state === 'ready' ? `${esc(P.evo.name)} <b>ready, in your next offer</b>`
      : P.evo.state === 'taken' ? `<span class="mut">${esc(P.evo.name)}: taken by ${esc(P.evo.takenBy)}</span>` : `${esc(P.evo.name)} <span class="mut">needs ${P.evo.need} more${P.evo.needKey ? ' and the keystone' : ''}</span>`;
    return `<div class="sh-path sh-f" data-k="path:${P.id}" style="--pc:${P.color}"><div class="sh-ph"><img alt="" src="${pathIco(P.id)}"><b>${esc(P.name)}</b><span class="sh-aff">affinity <b>${P.aff}</b></span></div>`
      + `<div class="aff-bar">${cells.join('')}</div>`
      + `<div class="sh-pl${P.key.state === 'owned' ? ' ok' : ''}"><u>◆</u> Keystone at ${P.key.at}: ${keyTxt}</div>`
      + `<div class="sh-pl${P.evo.state === 'evolved' ? ' ok' : ''}"><u>★</u> ${P.evo.state === 'evolved' ? '' : `Evolves at ${P.evo.at}${P.id === 'general' ? '' : ' with keystone'}: `}${evoTxt}</div></div>`;
  }
  function routeBlock(R) {
    let h = '';
    for (const nd of R.nodes) {
      if (R.route && !nd.chosen) { h += `<div class="sh-route off sh-f" data-k="r:${nd.route}"><b>${esc(nd.label)}</b> · ${esc(nd.name)} <span class="mut">(not taken)</span></div>`; continue; }
      h += `<div class="sh-route ${nd.chosen ? 'on' : 'open'} sh-f" data-k="r:${nd.route}"><div class="sh-rh"><img alt="" src="${ico(nd.icon, '#f0cf8a')}"><b>${esc(nd.label)}</b> · ${esc(nd.name)}${nd.chosen ? ' <u class="ok">✓</u>' : ''}</div>`
        + `<div class="sh-btx">${nd.chosen ? esc(nd.text) : `${esc(nd.when)}. Plays as: ${esc(nd.plays)}`}</div></div>`;
      if (!nd.chosen) continue;
      for (const f of nd.forks) {
        if (f.closed) { h += `<div class="sh-fork off sh-f" data-k="f:${f.id}"><b>${esc(f.name)}</b> <span class="mut">(not taken)</span></div>`; continue; }
        h += `<div class="sh-fork ${f.owned ? 'on' : 'open'} sh-f" data-k="f:${f.id}"><div class="sh-rh">${f.owned ? '<u class="ok">✓</u> ' : ''}<b>${esc(f.name)}</b>${f.tag ? `<span class="sh-kind">${esc(f.tag)}${f.coop ? ' · co-op' : ''}</span>` : ''}${f.owned ? `<span class="sh-pips">${pips(f.rank, f.max, 'var(--gold)')}</span>` : ''}</div>`
          + `<div class="sh-btx">${esc(f.text)}</div>${f.weapon ? `<div class="sh-sub">Weapon: ${esc(f.weapon)}</div>` : ''}${f.when ? `<div class="sh-next">${esc(f.when)}</div>` : ''}</div>`;
      }
    }
    return h;
  }
  const KIND_LABEL = { gate: 'gate', keystone: 'keystone', evolution: 'evolution', duo: 'duo', route: 'route', fork: 'fork', ascended: 'ascended' };
  function boonRow(b) {
    const P = b.path && ED.PATHS[b.path] ? ED.PATHS[b.path] : null, color = P ? P.color : '#b9ad9b', lab = KIND_LABEL[b.kind] || '';
    return `<div class="sh-boon sh-f" data-k="b:${b.id}" style="--pc:${color};--rc:${RAR(b.rar).color}"><img class="sh-bi" alt="" src="${ED.Icons.boonUrl(b.id)}"><div class="sh-bm">`
      + `<div class="sh-bt"><b class="sh-bn">${esc(b.name)}</b>${lab ? `<span class="sh-kind">${lab}${b.kind === 'fork' && b.tag ? ' · ' + esc(b.tag) : ''}</span>` : ''}<span class="sh-rar">${RAR(b.rar).name}</span>${b.max > 1 ? `<span class="sh-pips">${pips(b.rank, b.max, color)}</span>` : ''}</div>`
      + `<div class="sh-btx">${esc(b.text)}</div>${b.next ? `<div class="sh-next">Next rank: ${esc(b.next)}</div>` : ''}</div></div>`;
  }
  function renderBuild(m, p) {
    const B = m.build;
    let paths = '';
    for (const P of B.paths) paths += pathRow(P);
    if (B.generalist) paths += '<div class="sh-path empty">Element paths closed (Generalist)</div>';
    for (let i = 0; i < B.slotsFree; i++) paths += `<div class="sh-path empty sh-f" data-k="slot:${i}">Open element slot (${B.slots - B.slotsFree + i + 1} of ${B.slots})</div>`;
    if (B.classElementRow) { const c = B.classElementRow; paths += `<div class="sh-path elem sh-f" data-k="elem" style="--pc:${c.color}"><img alt="" src="${ico(c.icon, c.color)}"><span>${esc(c.name)} is your class element: your skills deal ${esc(c.name)} damage. Take the ${esc(c.name)} gate to infuse every hit.</span></div>`; }
    let duos = '';
    for (const d of B.duos) {
      duos += `<div class="sh-duo sh-f" data-k="d:${d.id}" style="--pc:${colorOf(d.duo[0])};--pc2:${colorOf(d.duo[1])}"><div class="sh-rh"><img alt="" src="${pathIco(d.duo[0])}"><img alt="" src="${pathIco(d.duo[1])}"><b>${esc(d.name)}</b>`
        + `${d.state === 'owned' ? '<span class="sh-kind">owned</span>' : d.state === 'offers' ? '<span class="sh-kind on">in your offers</span>' : `<span class="sh-kind">needs ${d.need} more</span>`}</div><div class="sh-btx">${esc(d.text)}</div></div>`;
    }
    if (B.duoWith) for (const d of B.duoWith) duos += `<div class="sh-duo sh-f" data-k="d:${d.id}" style="--pc:${d.withColor}"><div class="sh-rh"><span class="mut">with</span><img alt="" src="${pathIco(d.with)}"><b style="color:${d.withColor}">${esc(d.withName)}</b><b>${esc(d.name)}</b></div><div class="sh-btx">${esc(d.text)}</div></div>`;
    let left = head('Paths', B.generalist ? 'Generalist' : `${B.paths.filter(q => q.element).length}/${B.slots}`) + `<div class="sh-list">${paths}</div>`;
    if (duos) left += head('Duos') + `<div class="sh-list">${duos}</div>`;
    left += head('Class route', B.route.route ? esc(ED.routeLabel(m.hero.cls, B.route.route)) : 'choose at level 3') + `<div class="sh-list">${routeBlock(B.route)}</div>`;
    let boons = B.groups.length ? '' : '<div class="sh-empty">No boons yet. The first pick comes from the start offer.</div>';
    for (const g of B.groups) {
      const P = g.path ? ED.PATHS[g.path] : null, title = g.group === 'duo' ? 'Duo' : g.group === 'route' ? 'Class route' : g.group === 'asc' ? 'Ascended <small>multiplies the bonuses you hold</small>' : P ? `${P.name} <small>affinity ${ED.pathAffinity(p.boons || {}, g.path)}</small>` : 'Open <small>any hero, no path</small>';
      boons += `<div class="sh-bg"><div class="sh-gh"${P ? ` style="--pc:${P.color}"` : ''}>${P ? `<img alt="" src="${pathIco(g.path)}">` : ''}${title}</div>${g.items.map(boonRow).join('')}</div>`;
    }
    let status = '';
    for (const s of B.statuses) status += `<div class="sh-status sh-f" data-k="s:${s.id}" style="border-left-color:${s.color}"><b style="color:${s.color}">${esc(s.name)}</b>${esc(s.rule)}</div>`;
    for (const d of m.mult.debuffs) if (!B.statuses.some(s => s.id === d.id)) status += `<div class="sh-status sh-f" data-k="s:${d.id}:${d.text.length}" style="border-left-color:${d.color}"><b style="color:${d.color}">${esc(d.name)}</b>${esc(d.text)}</div>`;
    const mid = head('Boons', String(B.groups.reduce((n, g) => n + g.items.length, 0))) + `<div class="sh-boons">${boons}</div>` + (status ? head('Statuses') + `<div class="sh-list">${status}</div>` : '');
    let rel = B.relics.length ? '' : '<div class="sh-empty">No relics yet.</div>';
    for (const r of B.relics) {
      rel += `<div class="sh-relic sh-f" data-k="x:${r.id}" style="--rc:${RAR(r.rar).color}"><img class="sh-bi" alt="" src="${ED.Icons.relicUrl(r.id)}"><div class="sh-bm"><div class="sh-bt"><b class="sh-bn">${esc(r.name)}</b><span class="sh-rar">${RAR(r.rar).name}</span>${r.state ? `<span class="sh-state ${r.state}" data-live="rs:${r.id}">${r.state}</span>` : ''}</div>`
        + `<div class="sh-btx">${esc(r.text)}</div>${r.live ? `<div class="sh-live" data-live="rl:${r.id}">${esc(r.live)}</div>` : ''}</div></div>`;
    }
    return col('paths', left) + col('boons', mid) + col('relics', head('Relics', String(B.relics.length)) + `<div class="sh-list">${rel}</div>`);
  }

  // ---------------- Combat tab ----------------
  function weaponCard(m, color) {
    const w = m.weapon;
    let h = `<div class="sh-card sh-f" data-k="weapon" style="--pc:${color}"><div class="sh-ct"><img alt="" src="${ico(WEAPON_ICON[w.look] || 'sword', color)}"><b>${esc(w.name)}</b><span class="sh-chip">${w.kind === 'melee' ? 'melee' : 'ranged'}</span>${w.fork ? `<span class="sh-chip">${w.fork}</span>` : ''}</div>`;
    h += `<div class="sh-big">${n1(w.hit)}<small>per hit</small><span class="sh-crit">${n1(w.crit)} crit <small>(${pc(w.critChance)} · ${X(w.critMult)})</small></span></div>`;
    h += `<div class="sh-row"><b>${w.aps.toFixed(2)}</b> attacks/s <span class="mut">(base ${w.apsBase.toFixed(2)})</span>`;
    h += w.kind === 'melee' ? ` · reach ${w.reach} · ${w.allAround ? 'all around' : w.arcDeg + '°'}` : ` · ${w.n} ${w.n > 1 ? 'projectiles' : 'projectile'} · range ${w.range}${w.pierce ? ` · pierce ${w.pierce}` : ''}${w.homing ? ' · seeking' : ''}${w.blast ? ` · blast radius ${w.blast.r}` : ''}`;
    h += '</div>';
    if (w.fan) h += `<div class="sh-row mut">${w.oneFoe} of ${w.n} shots reach one foe at ${Sh.REF.d} px; all ${w.n} point-blank</div>`;
    for (const e of w.extras) h += `<div class="sh-row sh-ex"><span>${esc(e.label)}</span> <b>${n1(e.perAttack)}</b><span class="mut"> per attack${e.r ? ` (radius ${e.r})` : ''}${e.note ? ' · ' + esc(e.note) : ''}${e.el ? ' · ' + cap1(e.el) : ''}</span></div>`;
    for (const n of w.notes) h += `<div class="sh-row mut sh-ex">${esc(n)}</div>`;
    return h + `<div class="sh-tot">≈ <b>${n1(w.dps)}</b> damage/s on one foe${w.fan ? ` <span class="mut">(${n1(w.dpsAll)} if every shot lands)</span>` : ''}<small>every attack lands, no statuses, neutral stratum</small></div></div>`;
  }
  function partRow(q, stratum) {
    if (q.kind === 'zone') return `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv"></span><span class="sh-pn">${[q.r ? `radius ${q.r}` : '', q.dur ? `${Sh.secs(q.dur)}s` : '', q.note ? esc(q.note) : ''].filter(Boolean).join(' · ')}</span></div>`;
    let v = n1(q.here), n = '';
    if (q.kind === 'status') n = `${esc(q.statusName)} pool added${q.aff !== 1 ? ` · ${X(q.aff)} here` : ''}`;
    else if (q.kind === 'minion') n = `per strike · ${q.hitsEach} ${pl(q.hitsEach, 'strike')} each in ${Sh.secs(q.dur)}s · ${q.minions} ${pl(q.minions, 'minion')}`;
    else if (q.kind === 'sec') n = `per 0.5 s · ${q.oneFoe} ${pl(q.oneFoe, 'tick')} over ${Sh.secs(q.dur)}s · radius ${q.r}`;
    else {
      const bits = [];
      if (q.kind === 'tick') bits.push(`${q.oneFoe} ${pl(q.oneFoe, 'tick')} of ${Sh.secs(q.every)}s over ${Sh.secs(q.dur)}s`);
      else if (q.fanN) bits.push(`${q.oneFoe} of ${q.fanN} ${pl(q.fanN, 'arrow')} reach${q.oneFoe === 1 ? 'es' : ''} one foe`);
      else if (q.oneFoe === 0) bits.push(esc(q.note || 'conditional'));
      else if (q.oneFoe > 1) bits.push(`×${q.oneFoe} on one foe`);
      if (q.r) bits.push('radius ' + q.r);
      if (q.stun) bits.push(`stun ${Sh.secs(q.stun)}s`);
      if (q.alwaysCrit) bits.push('always crits'); else if (q.noCrit) bits.push('no crit');
      if (q.selfVuln) bits.push(`includes Judged +${Math.round(q.selfVuln * 100)}%`);
      if (q.delay) bits.push(`after ${Sh.secs(q.delay)}s`);
      if (q.note && q.oneFoe !== 0) bits.push(esc(q.note));
      n = bits.join(' · ');
    }
    const elc = q.el ? `<span class="sh-el" style="--pc:${colorOf(q.el)}">${cap1(q.el)}${q.aff !== 1 ? ` ${X(q.aff)} here` : ''}</span>` : '';
    const add = q.statusAdd ? `<div class="sh-part sub"><span class="sh-plab">+ ${esc(ED.STATUS[q.statusAdd.status].name)}</span><span class="sh-pv">${n1(q.statusAdd.here)}</span><span class="sh-pn">pool of half the hit${ED.elemMul(stratum, q.statusAdd.el) !== 1 ? ` · ${X(ED.elemMul(stratum, q.statusAdd.el))} here` : ''}</span></div>` : '';
    return `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv">${v}</span><span class="sh-pn">${n}${elc}</span></div>${add}`;
  }
  function skillCard(k, color, stratum) {
    let h = `<div class="sh-card sh-f" data-k="skill:${k.id}" style="--pc:${color}"><div class="sh-ct"><kbd>${esc(ED.Input.label(k.key))}</kbd><img alt="" src="${ico(k.icon, color)}"><b>${esc(k.name)}</b><span class="sh-cd">${k.cd.toFixed(1)}s <small>(base ${k.cdBase.toFixed(1)}s)</small></span>${k.charges > 1 ? `<span class="sh-pips">${pips(k.charges, k.charges, color)}</span>` : ''}</div>`;
    h += `<div class="sh-sub">${esc(cap1(k.aimText))}${k.aim === 'ground' ? ` (range ${k.range})` : k.aim === 'move' ? ` (${k.rangeMin}–${k.range})` : ''}</div>`;
    for (const q of k.parts) h += partRow(q, stratum);
    for (const he of k.heals) h += `<div class="sh-part"><span class="sh-plab">Heals</span><span class="sh-pv"></span><span class="sh-pn">${he.perMinion ? `${pc(he.perMinion)} of max health per minion, up to ${pc(he.cap)}` : `${pc(he.frac)} of max health`} · ${esc(he.label)}</span></div>`;
    const hits = k.parts.filter(q => q.kind !== 'zone' && q.kind !== 'status' && q.oneFoe > 0).reduce((n, q) => n + q.oneFoe, 0);
    return h + `<div class="sh-tot">Per cast on one foe: <b>${n1(k.perCast)}</b> <span class="mut">(${hits} ${hits === 1 ? 'hit' : 'hits'}${k.perCastAll > k.perCast + 0.5 ? `; ${n1(k.perCastAll)} if every shot lands` : ''})</span> · ≈ <b>${n1(k.dpsCd)}</b>/s over its cooldown</div></div>`;
  }
  function dashCard(m, color) {
    const d = m.dash;
    let h = `<div class="sh-card sh-f" data-k="dash" style="--pc:${color}"><div class="sh-ct"><kbd>${esc(ED.Input.label('dash'))}</kbd><img alt="" src="${ico('wing', color)}"><b>Dash</b><span class="sh-cd">${d.cd.toFixed(2)}s</span></div><div class="sh-sub">Untouchable for ${d.ifr}s while you dash</div>`;
    for (const q of d.parts) h += `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv">${q.dmg !== undefined ? n1(q.dmg) : ''}</span><span class="sh-pn">${q.per ? 'per ' + q.per + ' · ' : ''}${q.r ? 'radius ' + q.r + ' · ' : ''}${q.dur ? Sh.secs(q.dur) + 's · ' : ''}${esc(q.note || '')}</span></div>`;
    return h + '</div>';
  }
  function procsCard(m) {
    if (!m.procs.length) return '';
    return `<div class="sh-card sh-f" data-k="procs" style="--pc:#b9ad9b"><div class="sh-ct"><b>Procs</b><span class="mut">strikes that scale with your Power</span></div>${m.procs.map(q => `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv">${n1(q.dmg)}</span><span class="sh-pn">${esc(q.note)}</span></div>`).join('')}</div>`;
  }
  function offenseRows(m) {
    const M = m.mult, w = m.weapon;
    let h = '';
    h += stat('o:dmg', 'Damage', X(M.dmg.total), '', chips(M.dmg.rows, 'dmg'));
    h += stat('o:atk', 'Attack speed', X(M.atk.total), `${w.aps.toFixed(2)} attacks/s`, chips(M.atk.rows, 'atk'));
    h += stat('o:crit', 'Critical', `${pc(M.crit.total)} · ${X(M.crit.mult)}`, `the average hit counts ${X(M.crit.expected)}`, [{ lab: 'Chance', html: chips(M.crit.rows, 'crit') }, { lab: 'Damage', html: `<span>Base <b>${X(M.crit.base)}</b></span>` + chips(M.crit.rowsDmg, 'critDmg') }]);
    h += stat('o:area', 'Area', '+' + pc(M.area.total), `blasts and auras radius ${X(M.area.blast)} · melee arc ${X(M.area.arc)}`, chips(M.area.rows, 'area'));
    h += stat('o:cdr', 'Skill cooldown', M.cdr.eff > 0 ? '−' + pc(M.cdr.eff) : '0%', M.cdr.capped ? `raw ${pc(M.cdr.raw)}: full up to ${pc(M.cdr.soft)}, half above it, at most ${pc(M.cdr.max)}` : '', chips(M.cdr.rows, 'cdr'));
    if (M.projN.total || M.projN.pierce) h += stat('o:proj', 'Projectiles and pierce', `+${M.projN.total} · pierce +${M.projN.pierce}`, '', [{ lab: 'Projectiles', html: chips(M.projN.rows, 'projN') }, { lab: 'Pierce', html: chips(M.projN.rowsPierce, 'pierce') }]);
    for (const s of M.slots) {
      const cut = /Cdr$/.test(s.key), sg = (v) => ((cut ? v > 0 : v < 0) ? '−' : '+'); // a cooldown stat is a cut: Vanguard shows −30%
      h += stat('o:' + s.key, s.label, s.fmt === 'pct' ? sg(s.v) + pc(Math.abs(s.v)) : Sh.fmt(s.key, s.v), '', s.rows.map(r => `<span class="${r.v < 0 ? 'neg' : ''}">${esc(r.label)} <b>${sg(r.v)}${Sh.fmt(s.key, Math.abs(r.v))}</b></span>`).join(''));
    }
    for (const s of M.status) {
      const rows = s.rows.map(r => `<span>${esc(r.label)} <b>${Sh.fmt(r.key, r.v)}</b></span>`).join('');
      h += `<div class="sh-stat sh-f st" data-k="o:st:${s.el}" style="--pc:${s.color}"><div class="sh-sl"><span class="sh-l"><img alt="" src="${pathIco(s.el)}">${esc(ED.STATUS[s.status].name)}${s.builtin ? ' <span class="mut">from your class skills</span>' : ''}</span><span class="sh-v">${s.el === 'general' ? '' : X(s.aff) + ' here'}</span></div><div class="sh-sub">${esc(s.est.label)}</div>${rows ? `<div class="sh-src">${rows}</div>` : ''}</div>`;
    }
    if (M.debuffs.length) h += `<div class="sh-stat sh-f" data-k="o:deb"><div class="sh-sl"><span class="sh-l">Foe vulnerabilities you apply</span></div>${M.debuffs.map(d => `<div class="sh-cond"><b style="color:${d.color}">${esc(d.name)}</b>${d.v ? ` <b>+${pc(d.v)}</b>` : ''} ${esc(d.short || d.text)}</div>`).join('')}</div>`;
    if (M.cond.length) h += `<div class="sh-stat sh-f" data-k="o:cond"><div class="sh-sl"><span class="sh-l">Conditional damage</span></div>${M.cond.map(c => `<div class="sh-cond">${c.live !== null ? live('c:' + c.id, '+' + pc(c.live)) : '<b>+' + pc(c.v) + '</b>'} ${esc(c.label)}${c.live !== null ? ` <span class="mut">(+${pc(c.v)} ${c.id === 'idol' ? 'at most' : 'each'})</span>` : ''}</div>`).join('')}</div>`;
    return h;
  }
  function defenceRows(m) {
    const D = m.def;
    let h = '';
    h += stat('d:hp', 'Max health', String(D.maxHp), `${n1(D.hpBase)} × ${Math.round(D.hpMul * 100)}%`, [{ lab: 'Health', html: chips(D.hpRows, 'hp') }, { lab: 'Multiplier', html: chips(D.hpMulRows, 'hpMul') }]);
    h += stat('d:armor', 'Armor', n1(D.armor), `${pc(D.reduction)} less damage from hits`, chips(D.armorRows, 'armor'));
    h += stat('d:dodge', 'Dodge', pc(D.dodge), D.dodge >= 0.6 ? 'at the 60% cap' : '', chips(D.dodgeRows, 'dodge'));
    h += stat('d:taken', 'Damage taken', X(D.taken), D.vuln ? `armor ${X(D.armorMul)} · extra ${pc(D.vuln)}` : `armor ${X(D.armorMul)}`, chips(D.vulnRows, 'vuln'));
    h += stat('d:ehp', 'Effective health', n1(D.ehp), 'hits you can take, counting armor and dodge', '');
    const parts = [`${U.roman(m.ctx.stratum)} ${X(D.foeParts.depth * D.foeParts.threat)}`];
    if (D.foeParts.pact !== 1) parts.push(`pact ${X(D.foeParts.pact)}`);
    parts.push(`${m.lantern.name} ${X(D.foeParts.dread)}`);
    if (D.deepKnown) parts.push(`Dark rooms entered ${X(D.foeParts.deep)}`); // clients do not know the host's dark-room count
    h += stat('d:foe', 'Foes that spawn now hit', X(D.foeHere), parts.join(' · ') + '. Foes already alive keep the damage they spawned with.', '');
    h += stat('d:heal', 'Healing received', X(D.heal), `${X(D.healMul)} from your stats${D.pactHeal !== 1 ? ' and pact' : ''} · ${X(m.lantern.effect.heal)} from the ${m.lantern.name} lantern`, chips(D.healRows, 'heal'));
    for (const s of D.heals) h += stat('d:h:' + s.label, 'Heals: ' + esc(s.label), '', esc(s.text), '');
    h += stat('d:shield', 'Shield', live('shield', n1(D.shield)), `fades ${pc(0.02)} of max health per second between fights`, D.shields.map(s => `<span>${esc(s.label)} <b>${esc(s.text)}</b></span>`).join(''));
    const SW = D.window;
    h += stat('d:swin', 'Shield window', live('swin', `${pc(SW.allPct)} / ${pc(SW.allCap)}`), `Shield gained in the last ${SW.secs} s from all sources; from class sources ${live('swc', `${pc(SW.clsPct)} / ${pc(SW.clsCap)}`)}. ${esc(D.limits)}`, '');
    if (D.ready.length) h += stat('d:ready', 'Safeguards', '', '', D.ready.map(r => `<span class="rd${r.ready ? ' ok' : ''}">${esc(r.name)} <b data-live="rd:${r.id}">${r.ready ? 'ready' : r.once ? 'used' : 'recharging'}</b></span>`).join(''));
    if (D.situational.length) h += `<div class="sh-stat sh-f" data-k="d:sit"><div class="sh-sl"><span class="sh-l">Situational</span></div>${D.situational.map(s => `<div class="sh-cond"><b>${esc(s.label)}</b> ${esc(s.text)}</div>`).join('')}</div>`;
    return h;
  }
  function renderCombat(m) {
    const color = ED.PLAYER_COLORS[m.hero.slot] || '#ff8a3d', stratum = m.ctx.stratum, rt = m.build.route;
    let atk = `<div class="sh-compact"><div class="sh-subl">${esc(m.weapon.name)}${rt.route ? ' · ' + esc(ED.routeLabel(m.hero.cls, rt.route)) + ' route' : ''}</div><div class="sh-aff">${affChips(m.aff.now)}</div></div>`;
    atk += weaponCard(m, color);
    for (const k of m.skills) atk += skillCard(k, color, stratum);
    atk += dashCard(m, color) + procsCard(m);
    return col('attacks', head('Attacks') + `<div class="sh-list">${atk}</div>`) + col('offense', head('Offense') + `<div class="sh-list">${offenseRows(m)}</div>`) + col('defence', head('Defence') + `<div class="sh-list">${defenceRows(m)}</div>`);
  }

  // ---------------- Map tab ----------------
  function renderMapSide(m) {
    const L = m.lantern, A = m.aff, biome = ED.biomeFor(m.ctx.stratum);
    let h = `<div class="sh-stat sh-f" data-k="m:strat"><div class="sh-sl"><span class="sh-l">${U.roman(m.ctx.stratum)} ${esc(biome.name)}</span></div><div class="sh-aff2">${affChips(A.now)}</div>`;
    const cls = A.now.mine.filter(x => x.skillMul !== null && x.skillMul !== x.mul);
    if (cls.length) h += `<div class="sh-sub">Your class skills take half the affinity: ${cls.map(x => `${esc(x.name)} ${X(x.skillMul)}`).join(', ')}.</div>`;
    if (A.next) h += `<div class="sh-sub">Next, ${esc(A.next.short)}:</div><div class="sh-aff2">${affChips(A.next)}</div>`;
    h += '</div>';
    h += `<div class="sh-stat sh-f" data-k="m:lantern"><div class="sh-sl"><span class="sh-l">Lantern</span><span class="sh-v"><span class="sh-tier t${L.tier}">${L.name}</span></span></div>`
      + `<div class="sh-sub">Light ${live('light', `${n1(L.light)} / ${n1(L.lightMax)} (${Math.round(L.pct * 100)}%)`)}</div>`
      + `<div class="sh-cond">${L.name} lantern: foe damage ${X(L.effect.dmg)} · elite chance +${Math.round(L.effect.elite * 100)}%${L.effect.gloom ? ` · the Gloom hunts ${L.effect.gloom}s after you enter a room` : ''} · healing ${X(L.effect.heal)}</div>`
      + `<div class="sh-cond">New room: fight −${n1(L.cost.combat.pts)} (−${Math.round(L.cost.combat.pct * 100)}%) · elite −${n1(L.cost.elite.pts)} (−${Math.round(L.cost.elite.pct * 100)}%) · other −${n1(L.cost.other.pts)} (−${Math.round(L.cost.other.pct * 100)}%)</div>`
      + `<div class="sh-cond">Boss door now: heal ${Math.round(L.boss.heal * 100)}% · shield ${Math.round(L.boss.shield * 100)}% · ${L.boss.gold} gold · ${L.boss.embers} ${pl(L.boss.embers, 'ember')}</div>`
      + `<div class="sh-cond">Rooms explored ${live('rooms', `${L.rooms.seen} / ${L.rooms.total}`)} · Flare −${n1(L.flare.pts)} (−${Math.round(L.flare.pct * 100)}%)</div></div>`;
    h += `<div class="sh-stat sh-f" data-k="m:party"><div class="sh-sl"><span class="sh-l">Party</span></div>${m.partyRows}</div>`;
    return h;
  }

  // ---------------- model, refresh, render ----------------
  function computeModel() {
    const s = ED.Game.s, p = viewed(), ctx = Sh.ctx(s.view, p), m = Sh.compute(p, ctx);
    m.partyRows = ctx.heroes.map(q => `<div class="sh-party${q.pid === p.pid ? ' me' : ''}${q.dead ? ' dead' : ''}" data-pid="${esc(q.pid)}"><span style="color:${ED.PLAYER_COLORS[q.slot] || '#fff'}">${esc(q.name)} <span class="mut">${esc(ED.CLASSES[q.cls].name)}</span></span><b>${q.dead ? 'fallen' : q.downed ? 'down' : q.hp + ' / ' + q.maxHp}</b></div>`).join('');
    return m;
  }
  const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const liveOf = (html) => { const o = {}; html.replace(/data-live="([^"]+)"[^>]*>([^<]*)</g, (a, k, v) => { o[k] = v; return a; }); return o; };
  const structOf = (html) => html.replace(/(data-live="[^"]+"[^>]*>)[^<]*</g, '$1<');
  // Writes html into a panel. Same structure: only the live cells are patched; otherwise the panel is rebuilt keeping each column's scroll and the focused element (by data-k).
  function paint(panelId, html, force) {
    const el = $(panelId), sig = structOf(html);
    if (!force && sig === SH.sig[panelId]) {
      const lv = liveOf(html), old = SH.live[panelId] || {};
      for (const k in lv) if (lv[k] !== old[k]) { const n = el.querySelector(`[data-live="${k}"]`); if (n) n.textContent = unesc(lv[k]); }
      SH.live[panelId] = lv;
      return;
    }
    const scrolled = el.closest('.sh-in') ? [el.closest('.sh-in')] : [...el.querySelectorAll('.sh-in')], tops = scrolled.map(c => c.scrollTop);
    const fk = SH.focusEl && el.contains(SH.focusEl) ? SH.focusEl.dataset.k : SH.focusKey;
    el.innerHTML = html;
    SH.sig[panelId] = sig; SH.live[panelId] = liveOf(html);
    const again = el.closest('.sh-in') ? [el.closest('.sh-in')] : [...el.querySelectorAll('.sh-in')];
    again.forEach((c, i) => { c.scrollTop = tops[i] || 0; });
    SH.focusEl = null;
    if (fk) { const n = [...el.querySelectorAll('.sh-f')].find(x => x.dataset.k === fk); if (n) setFocus(n, false); }
  }
  function render(force) {
    if (!ED.Game.s) return;
    const s = ED.Game.s, p = viewed(), m = SH.model = computeModel();
    paintHeader(m);
    for (const t of TABS) { $('shp-' + t).hidden = t !== SH.tab; $('shtab-' + t).classList.toggle('on', t === SH.tab); $('shtab-' + t).setAttribute('aria-selected', t === SH.tab ? 'true' : 'false'); }
    if (SH.tab === 'build') paint('shp-build', renderBuild(m, p), force);
    else if (SH.tab === 'combat') paint('shp-combat', renderCombat(m), force);
    else { paint('shp-map-side', renderMapSide(m), force); mapDraw(force); }
    const w = s.me.picks | 0;
    $('sh-pill').textContent = w > 0 ? `${w} ${w === 1 ? 'boon' : 'boons'} waiting` : ''; $('sh-pill').hidden = !(w > 0);
    $('sh-view').hidden = !SH.viewPid; if (SH.viewPid) $('sh-view').textContent = `Viewing ${p.name}: back to you`;
    paintFoot();
    SH.dirty = false; SH.t = 0;
  }
  function paintFoot() {
    const I = ED.Input, k = (a) => `<kbd>${esc(I.label(a))}</kbd>`, gs = ED.Game.s, party = gs && gs.view && gs.view.players.size > 1; // Y cycles heroes: only with a party
    $('sh-keys').innerHTML = $('sh-foot').innerHTML = I.device === 'pad' ? '<kbd>LB</kbd><kbd>RB</kbd> tabs · <kbd>D-pad</kbd> move · <kbd>R stick</kbd> scroll · ' + (party ? '<kbd>Y</kbd> party · ' : '') + '<kbd>B</kbd> close'
      : `${k('skill1')}${k('skill2')} tabs · ${k('up')}${k('left')}${k('down')}${k('right')} move · <kbd>PgUp</kbd><kbd>PgDn</kbd> scroll · ${k('map')} or <kbd>Esc</kbd> close`;
  }

  // ---------------- public API ----------------
  UI.sheetDirty = () => { SH.dirty = true; };
  UI.sheetTick = (dt) => { SH.t += dt; if (SH.dirty || SH.t >= 0.5) render(false); };
  UI.sheetTab = (t) => {
    if (TABS.indexOf(t) < 0 || t === SH.tab) return;
    SH.tab = t; SH.focusEl = null; SH.focusKey = null;
    const a = ED.App;
    if (a && a.settings) { a.settings.sheetTab = t; S.storeSettings(a.settings); }
    if (!$('ov-sheet').hidden) { render(true); focusFirst(); if (ED.Audio) ED.Audio.play('hover'); }
  };
  UI.toggleSheet = (on) => {
    if (!ED.Game.s) return;
    const el = $('ov-sheet'), open = on === undefined ? el.hidden : !!on;
    if (open === !el.hidden) return;
    el.hidden = !open;
    if (!open) { SH.focusEl = null; SH.viewPid = null; return; }
    if (!SH.opened) { const saved = ED.App && ED.App.settings && ED.App.settings.sheetTab; if (TABS.indexOf(saved) >= 0) SH.tab = saved; SH.opened = true; }
    SH.sig = {}; SH.live = {};
    render(true);
    focusFirst();
  };

  // ---------------- focus and navigation ----------------
  const items = () => [...$('shp-' + SH.tab).querySelectorAll('.sh-f')].filter(n => n.offsetParent !== null);
  function focusFirst() { const it = items(); if (it.length) setFocus(it[0], false); }
  function setFocus(el, reveal) {
    if (SH.focusEl && SH.focusEl !== el) SH.focusEl.classList.remove('focus');
    SH.focusEl = el;
    if (!el) return;
    el.classList.add('focus'); SH.focusKey = el.dataset.k;
    if (reveal) revealEl(el);
  }
  // Scrolls the column holding el just enough to show it (never the page).
  function revealEl(el) {
    const c = el.closest('.sh-in'); if (!c) return;
    const a = el.getBoundingClientRect(), b = c.getBoundingClientRect(), pad = rem();
    if (a.top < b.top + pad) c.scrollTop -= b.top + pad - a.top; else if (a.bottom > b.bottom - pad) c.scrollTop += a.bottom - (b.bottom - pad);
  }
  // Moves the focus one step: up / down to the nearest element whose x-range overlaps, left / right to the nearest column then the row closest in height.
  function move(dir) {
    const it = items();
    if (!it.length) return;
    const cur = SH.focusEl && it.indexOf(SH.focusEl) >= 0 ? SH.focusEl : null;
    if (!cur) { setFocus(it[0], true); return; }
    const a = cur.getBoundingClientRect(), cy = (a.top + a.bottom) / 2, tol = 2 * rem();
    let best = null, bs = Infinity, bestGap = Infinity;
    for (const n of it) {
      if (n === cur) continue;
      const r = n.getBoundingClientRect(), ny = (r.top + r.bottom) / 2;
      if (dir === 'down' || dir === 'up') {
        if (Math.min(a.right, r.right) - Math.max(a.left, r.left) <= 4 || (dir === 'down' ? ny <= cy + 1 : ny >= cy - 1)) continue;
        const sc = Math.abs(ny - cy);
        if (sc < bs) { bs = sc; best = n; }
      } else {
        const gap = dir === 'right' ? r.left - a.right : a.left - r.right;
        if (gap < -2) continue;
        if (gap < bestGap - tol) { bestGap = gap; bs = Math.abs(ny - cy); best = n; } else if (gap <= bestGap + tol && Math.abs(ny - cy) < bs) { bs = Math.abs(ny - cy); best = n; if (gap < bestGap) bestGap = gap; }
      }
    }
    if (best) setFocus(best, true);
  }
  UI.sheetNav = (inp, dt) => {
    if (inp.back) { UI.toggleSheet(false); return; }
    const at = TABS.indexOf(SH.tab);
    if (inp.tabPrev) UI.sheetTab(TABS[(at + 2) % 3]);
    else if (inp.tabNext) UI.sheetTab(TABS[(at + 1) % 3]);
    else if (inp.tabN && !(ED.Input.boundCodes && ED.Input.boundCodes.has('Digit' + inp.tabN))) UI.sheetTab(TABS[inp.tabN - 1]);
    for (const d of ['up', 'down', 'left', 'right']) {
      let fire = !!inp[d];
      if (ED.Input.held(d)) { if (!fire) { SH.held[d] = (SH.held[d] || 0) + dt; if (SH.held[d] > 0.4) { SH.held[d] -= 0.09; fire = true; } } } else SH.held[d] = 0;
      if (fire) move(d);
    }
    if (inp.navY) move(inp.navY > 0 ? 'down' : 'up');
    if (inp.navX) move(inp.navX > 0 ? 'right' : 'left');
    if (inp.scrollY) { const c = (SH.focusEl && SH.focusEl.closest('.sh-in')) || $('shp-' + SH.tab).querySelector('.sh-in'); if (c) c.scrollTop += inp.scrollY * 45 * rem() * dt; }
    if (inp.cycle) cycleHero();
  };
  function cycleHero(to) {
    const s = ED.Game.s, ids = [...s.view.players.keys()];
    if (ids.length < 2) return;
    const nx = to || ids[(ids.indexOf(viewed().pid) + 1) % ids.length];
    SH.viewPid = nx === s.me.pid ? null : nx;
    SH.sig = {}; render(true);
  }

  // ---------------- map canvas ----------------
  // Sized from the column box (a hidden tab measures 0 and draws nothing); cells cap at 7.1 units; redrawn when the room, the room-state hash or the rounded light change.
  function mapDraw(force) {
    const v = ED.Game.s.view, box = $('sh-mapbox').getBoundingClientRect();
    if (!(box.width > 10 && box.height > 10)) return;
    const dpr = window.devicePixelRatio || 1, cw = Math.min(box.width, box.height * 6 / 5), ch = cw * 5 / 6, cv = $('map-canvas');
    let rs = ''; for (const id in v.roomState) { const q = v.roomState[id]; rs += (q.visited ? 1 : 0) + (q.known ? 2 : 0) + (q.cleared ? 4 : 0); }
    const key = [Math.round(cw), Math.round(ch), dpr, v.roomId, rs, Math.round(v.light), v.floorSeed].join('|');
    if (!force && key === SH.mapKey) return;
    SH.mapKey = key;
    cv.style.width = Math.round(cw) + 'px'; cv.style.height = Math.round(ch) + 'px';
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const c = cv.getContext('2d'), pad = 0.5 * rem() * dpr;
    c.clearRect(0, 0, W, H);
    ED.HUD.drawMap(c, v, pad, pad, W - 2 * pad, H - 2 * pad, rem() * dpr * 1.7, 0);
  }

  // ---------------- DOM events ----------------
  UI.wireSheet = () => {
    for (const t of TABS) $('shtab-' + t).addEventListener('click', () => UI.sheetTab(t));
    const root = $('ov-sheet');
    root.addEventListener('mouseover', (e) => { const n = e.target.closest && e.target.closest('.sh-f'); if (n && n !== SH.focusEl) setFocus(n, false); }); // hover marks, never scrolls
    root.addEventListener('click', (e) => {
      const n = e.target.closest && e.target.closest('.sh-f'); if (n) setFocus(n, false);
      const pr = e.target.closest && e.target.closest('.sh-party'); if (pr && ED.Game.s) cycleHero(pr.dataset.pid);
    });
    $('sh-view').addEventListener('click', () => cycleHero(ED.Game.s && ED.Game.s.me.pid));
    window.addEventListener('keydown', (e) => {
      if ($('ov-sheet').hidden) return;
      const c = (SH.focusEl && SH.focusEl.closest('.sh-in')) || $('shp-' + SH.tab).querySelector('.sh-in');
      if (!c) return;
      if (e.code === 'PageDown') c.scrollTop += c.clientHeight - 2 * rem();
      else if (e.code === 'PageUp') c.scrollTop -= c.clientHeight - 2 * rem();
      else if (e.code === 'Home') c.scrollTop = 0;
      else if (e.code === 'End') c.scrollTop = c.scrollHeight;
      else return;
      e.preventDefault();
    });
    window.addEventListener('resize', () => { if (!root.hidden) { SH.mapKey = ''; SH.dirty = true; } });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { SH.mapKey = ''; if (!root.hidden && SH.tab === 'map' && ED.Game.s) mapDraw(true); }).observe($('sh-mapbox'));
  };
})(globalThis.ED || (globalThis.ED = {}));
