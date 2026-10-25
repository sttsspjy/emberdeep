// The Tab sheet: header, three tabs (Build, Combat, Map) rendered from ED.Sheet.compute, live refresh, spatial keyboard / mouse / gamepad focus, the pixel room map.
// A tab is rebuilt (innerHTML) only when its markup changes apart from its live cells (data-live text), which are patched in place; only the visible tab renders, at most twice a second.
// Pixel look: card frames baked here through ED.PixUI.frame (--fr-shcard[-variant], --fr-shdash, --fr-shmk-*, --fr-shstar-*); --tb on #ov-sheet = PixUI.bias in CSS px.
(function (ED) {
  'use strict';
  const U = ED.U, UI = ED.UI, Sh = ED.Sheet, S = ED.Save, PX = ED.PixUI;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc, n1 = Sh.n1;
  const TABS = ['build', 'combat', 'map'];
  const SHAPE = { beam: ' · a beam through every foe on its line', lob: ' · lobbed onto the cursor', boomerang: ' · flies out and back, every foe once each way', pool: ' · ends in a pool of light', trail: ' · leaves a trail of clouds' }; // weapon flight shapes (sheet weapon.shape)
  const SH = { tab: 'build', viewPid: null, model: null, dirty: true, t: 99, sig: {}, live: {}, focusEl: null, focusKey: null, held: {}, mv: null, opened: false }; // mv: the Map tab's ED.MapView
  UI.sheetState = SH;

  // ---------------- pixel frames ----------------
  // shcard: 9 x 9, slice 3: outline o, left stripe P (H = its top pixel), top line L, right line L, bottom line D, fill f. Variants: every path (tinted fill), gold
  // (evolved), route (class route nodes), dim (closed), p0-p3 (hero colours). shdash: open nodes,
  // 2-on 2-off dashes (border-image-repeat: repeat). shmk: 7 x 7 keystone diamond (off, bone, every path). shstar: 7 x 7 evolution star (off, ready, got).
  const FILL = '#120d0a';
  const tint = (c) => ({ P: c, H: U.shade(c, 0.45), L: U.mix(c, FILL, 0.62), f: U.mix(FILL, c, 0.07), D: U.mix(c, '#000000', 0.72) });
  if (PX) {
    const cardV = { gold: { P: '--gold', H: '#fff3c4', L: '--gold-lo', f: '#1a1209', D: '#3a2a12' }, route: { P: '--brass-hi', H: '--gold', L: '--brass', f: '#17110b', D: '#2c2014' }, dim: { P: '--line', H: '--line', L: '#2c2119', f: '#0e0a08', D: '#0b0806' } };
    for (const id of PX.PATHS) cardV[id] = tint(ED.pathInfo(id).color);
    ED.PLAYER_COLORS.forEach((c, i) => { cardV['p' + i] = tint(c); });
    PX.frame('shcard', {
      rows: ['.ooooooo.', 'oHHLLLLLo', 'oPPffffLo', 'oPPffffLo', 'oPPffffLo', 'oPPffffLo', 'oPPffffLo', 'oPPDDDDDo', '.ooooooo.'],
      pal: { o: '#222222', P: '--line-hi', H: '--line-hi', L: '--line', f: FILL, D: '#0b0806' }, slice: 3, variants: cardV,
    });
    PX.frame('shdash', {
      rows: ['..........', '.LLLL..LL.', '.L......L.', '.L......L.', '.L......L.', '..........', '..........', '.L......L.', '.LLLL..LL.', '..........'],
      pal: { L: '--line-hi' }, slice: 3,
    });
    const mkV = { off: { H: '#6f5338', P: '#3a2c22' }, bone: { H: '#ffffff', P: '--bone' } };
    for (const id of PX.PATHS) mkV[id] = { H: U.shade(ED.pathInfo(id).color, 0.6), P: ED.pathInfo(id).color };
    PX.frame('shmk', { rows: ['...o...', '..oHo..', '.oHHPo.', 'oHHPPPo', '.oPPPo.', '..oPo..', '...o...'], pal: { o: '#222222', H: '#6f5338', P: '#3a2c22' }, variants: mkV });
    PX.frame('shstar', {
      rows: ['...o...', '..oHo..', 'oooHSoo', 'oHHSSSo', '.oSSSo.', 'oSSoSSo', 'ooo.ooo'], pal: { o: '#222222', H: '#6f5338', S: '#3a2c22' },
      variants: { off: {}, ready: { H: '--ember-hi', S: '--ember' }, got: { H: '#fff3c4', S: '--r-legend' } },
    });
  }
  // Text origins inside the sheet sit on PixUI.bias: .sheet-wrap is offset by --tb.
  const bias = () => { const el = $('ov-sheet'); if (el && PX) el.style.setProperty('--tb', (PX.bias / PX.dpr) + 'px'); };
  bias();
  if (PX) PX.on(() => { bias(); SH.dirty = true; });

  // ---------------- formatting helpers ----------------
  const X = (v) => '×' + v.toFixed(2);
  const pc = (v) => { const p = v * 100, a = Math.abs(p); return (a >= 10 ? String(Math.round(p)) : String(Math.round(p * 10) / 10)) + '%'; };
  const sgn = (v, s) => (v < 0 ? '−' : '+') + s;
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pl = (n, w) => (n === 1 ? w : w + 's');
  const colorOf = (el) => (ED.pathInfo(el) ? ED.pathInfo(el).color : '#d9dfe8');
  const ico = (name, color) => ED.Icons.url(name, color);
  const pathIco = (k) => ico(ED.PATHS[k].icon, ED.PATHS[k].color);
  const img = (src, big) => `<img class="${big ? 'sh-i2' : 'sh-i1'}" alt="" src="${src}">`;
  const RAR = (r) => ED.RARITY[r];
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const WEAPON_ICON = { sword: 'sword', hammer: 'hammer', spear: 'arrow', bow: 'bow', crossbow: 'arrows', staff: 'flame', wand: 'star', tome: 'scroll', dagger: 'dagger', scythe: 'blades', mace: 'hammer', lantern: 'lantern', bell: 'bell' };
  const live = (key, text) => `<b data-live="${key}">${esc(text)}</b>`;
  const frc = (v) => `--frc:var(--fr-${v})`; // card frame variable for an inline style
  const chip = (text, color, cls) => `<span class="px-chip sh-chip${cls ? ' ' + cls : ''}"${color ? ` style="--pc:${color}"` : ''}>${text}</span>`;
  const pips = (rank, max, col) => { let s = ''; for (let i = 1; i <= max; i++) s += `<i${i <= rank ? ' class="on"' : ''}></i>`; return `<span class="sh-pips"${col ? ` style="--pc:${col}"` : ''}>${s}</span>`; };
  const col = (name, body) => `<section class="plate sh-col" data-col="${name}"><div class="sh-in">${body}</div></section>`;
  const head = (title, small) => `<h3 class="sh-h">${title}${small ? `<small>${small}</small>` : ''}</h3>`;
  // Source chips of one stat: [{ label, kind, v, mul? }] -> "Base 100%", "Might 3 +12%", "Honed Edge ×1.15" (a multiplier); a negative contribution is the only red on the sheet.
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
  function paintHeader(m) {
    const h = m.hero, biome = ED.biomeFor(m.ctx.stratum), color = ED.PLAYER_COLORS[h.slot] || '#ff8a3d';
    const key = h.pid + '|' + h.cls + '|' + m.weapon.base + '|' + (ED.Actors && ED.Actors.on() ? 1 : 0);
    if ($('sh-port').dataset.key !== key) { // a 64 px canvas until Actors.fit resizes it to one canvas px per device px of its box
      const cv = UI.portrait(h.cls, 32, h.slot, m.weapon.base);
      cv.className = 'sh-pcv'; $('sh-port').replaceChildren(cv); $('sh-port').dataset.key = key;
    }
    $('sh-name').textContent = h.name; $('sh-name').style.color = color;
    $('sh-class').textContent = ' · ' + h.clsName;
    const rt = m.build.route;
    $('sh-sub').textContent = m.weapon.name + (rt.route ? ' · ' + ED.routeLabel(h.cls, rt.route) + ' route' + (rt.fork ? ': ' + ED.cardName(rt.fork, rt.rank) + (rt.rank > 1 ? ' (rank ' + rt.rank + ')' : '') : '') : ' · no route yet');
    const xpf = U.clamp(h.xp / Math.max(1, h.xpNext), 0, 1), hpf = U.clamp(h.hp / Math.max(1, h.maxHp), 0, 1), shf = U.clamp(h.shield / Math.max(1, h.maxHp), 0, 1 - hpf);
    $('sh-lv').textContent = 'Lv ' + h.level; $('sh-xpm').style.setProperty('--f', xpf.toFixed(3)); $('sh-xp').textContent = Math.round(100 * xpf) + '%';
    $('sh-hp').textContent = `${h.hp} / ${h.maxHp}`;
    const hm = $('sh-hpm'); hm.style.setProperty('--f', hpf.toFixed(3)); hm.style.setProperty('--s', shf.toFixed(3)); hm.classList.toggle('low', hpf < 0.3);
    $('sh-shield').textContent = h.shield > 0 ? '+' + n1(h.shield) : ''; $('sh-shield').hidden = !(h.shield > 0);
    $('sh-gold').textContent = String(h.gold);
    if (!$('sh-coin').getAttribute('src')) $('sh-coin').src = ico('coin', '#ffd36b');
    $('sh-strat').textContent = `Stratum ${U.roman(m.ctx.stratum)} · ${biome.name}`;
  }

  // ---------------- Build tab ----------------
  // Path card: path-colour frame, affinity meter (one cell per affinity up to the evolution, the keystone diamond after cell key.at, the star last), keystone and evolution lines.
  function pathRow(P) {
    const cells = [], keyOwn = P.key.state === 'owned', evo = P.evo.state;
    const mk = keyOwn ? P.id : P.key.state === 'offers' ? 'bone' : 'off', star = evo === 'evolved' ? ' got' : evo === 'ready' ? ' ready' : '';
    for (let i = 1; i <= P.evo.at; i++) cells.push(`<i class="${i <= P.aff ? 'on' : ''}${i === P.key.at ? ' key' : ''}"></i>`);
    const keyTxt = keyOwn ? `${esc(P.key.name)} <b>owned</b>` : P.key.state === 'offers' ? `${esc(P.key.name)} <b>in your offers</b>` : `${esc(P.key.name)} <span class="mut">needs ${P.key.need} more</span>`;
    const evoTxt = evo === 'evolved' ? `<b>Evolved:</b> ${esc(P.evo.name)}` : evo === 'ready' ? `${esc(P.evo.name)} <b>ready, in your next offer</b>`
      : evo === 'taken' ? `<span class="mut">${esc(P.evo.name)}: taken by ${esc(P.evo.takenBy)}</span>` : `${esc(P.evo.name)} <span class="mut">needs ${P.evo.need} more${P.evo.needKey ? ' and the keystone' : ''}</span>`;
    return `<div class="shc sh-path sh-f" data-k="path:${P.id}" style="${frc('shcard-' + P.id)};--pc:${P.color}"><div class="sh-ph">${img(pathIco(P.id), true)}<b class="sh-pnam">${esc(P.name)}</b><span class="sh-pa">affinity <b>${P.aff}</b></span></div>`
      + `<div class="sh-aff-bar" style="--n:${P.evo.at};--mkb:var(--fr-shmk-${mk})">${cells.join('')}<b class="${star.trim()}"></b></div>`
      + `<div class="sh-pl${keyOwn ? ' got' : ''}"><i class="mk" style="background-image:var(--fr-shmk-${mk})"></i>Keystone at ${P.key.at}: ${keyTxt}</div>`
      + `<div class="sh-pl${evo === 'evolved' ? ' got' : ''}"><i class="mk star${star}"></i>${evo === 'evolved' ? '' : `Evolves at ${P.evo.at}${P.id === 'general' ? '' : ' with keystone'}: `}${evoTxt}</div></div>`;
  }
  // Route tree: the four route nodes (the chosen one framed in brass, the rest one dim line), the chosen route's forks under it on a brass trunk (owned gold, open dashed, closed dim).
  function routeBlock(R, cc) { // cc = the class colour (the route card's icon hue)
    let h = '';
    for (const nd of R.nodes) {
      if (R.route && !nd.chosen) { h += `<div class="shc off sh-route sh-f" data-k="r:${nd.route}"><div class="sh-rh"><b>${esc(nd.label)}</b> · ${esc(nd.name)} <span class="mut">(not taken)</span></div></div>`; continue; }
      h += `<div class="shc ${nd.chosen ? '' : 'dash'} sh-route sh-f" data-k="r:${nd.route}"${nd.chosen ? ` style="${frc('shcard-route')}"` : ''}><div class="sh-rh">${img(ico(nd.icon, cc), true)}<b>${esc(nd.label)}</b> · ${esc(nd.name)}${nd.chosen ? ' <span class="sh-check">✓</span>' : ''}</div>`
        + `<div class="sh-btx">${nd.chosen ? esc(nd.text) : `${esc(nd.when)}. Plays as: ${esc(nd.plays)}`}</div></div>`;
      if (!nd.chosen) continue;
      let f2 = '';
      for (const f of nd.forks) {
        if (f.closed) { f2 += `<div class="shc off sh-fork sh-f" data-k="f:${f.id}"><div class="sh-rh"><b>${esc(f.name)}</b> <span class="mut">(not taken)</span></div></div>`; continue; }
        f2 += `<div class="shc ${f.owned ? 'on' : 'dash'} sh-fork sh-f" data-k="f:${f.id}"${f.owned ? ` style="${frc('shcard-gold')}"` : ''}><div class="sh-rh">${f.owned ? '<span class="sh-check">✓</span>' : ''}<b>${esc(f.name)}</b>${f.tag ? chip(esc(f.tag) + (f.coop ? ' · co-op' : ''), 'var(--gold)') : ''}${f.owned ? pips(f.rank, f.max, 'var(--gold)') : ''}</div>`
          + `<div class="sh-btx">${esc(f.text)}</div>${f.weapon ? `<div class="sh-sub">Weapon: ${esc(f.weapon)}</div>` : ''}${f.when ? `<div class="sh-next">${esc(f.when)}</div>` : ''}</div>`;
      }
      if (f2) h += `<div class="sh-forks">${f2}</div>`;
    }
    return `<div class="sh-tree">${h}</div>`;
  }
  // A boon row's icon wears its card's identity hue (UI.boonIconColor), not its rarity.
  const boonIco = (id) => (UI.boonIconColor ? ico(ED.BOONS[id].icon, UI.boonIconColor(id)) : ED.Icons.boonUrl(id));
  const KIND_LABEL = { gate: 'gate', keystone: 'keystone', evolution: 'evolution', route: 'route', fork: 'fork' };
  function boonRow(b) {
    const P = b.path && ED.PATHS[b.path] ? ED.PATHS[b.path] : null, color = b.kind === 'route' || b.kind === 'fork' ? 'var(--gold)' : P ? P.color : '#b9ad9b', lab = KIND_LABEL[b.kind] || '';
    return `<div class="sh-boon sh-f" data-k="b:${b.id}" style="--pc:${color};--rc:${RAR(b.rar).color}"><img class="sh-i2" alt="" src="${boonIco(b.id)}"><div class="sh-bm">`
      + `<div class="sh-bt"><b class="sh-bn">${esc(b.name)}</b>${lab ? chip(lab + (b.kind === 'fork' && b.tag ? ' · ' + esc(b.tag) : '')) : ''}<span class="sh-rar">${RAR(b.rar).name}</span>${b.max > 1 ? pips(b.rank, b.max) : ''}</div>`
      + `<div class="sh-btx">${esc(b.text)}</div>${b.cost ? `<div class="sh-btx sh-cost">${esc(b.cost)}</div>` : ''}${b.next ? `<div class="sh-next"><b>Next rank</b>${esc(b.next)}</div>` : ''}</div></div>`;
  }
  function renderBuild(m, p) {
    const B = m.build;
    let paths = '';
    for (const P of B.paths) paths += pathRow(P);
    for (let i = 0; i < B.slotsFree; i++) paths += `<div class="shc dash sh-path slot sh-f" data-k="slot:${i}">Open path slot (${B.slots - B.slotsFree + i + 1} of ${B.slots})</div>`;
    if (B.classElementRow) { const c = B.classElementRow, el = c.el; paths += `<div class="shc sh-path elem sh-f" data-k="elem" style="${el ? frc('shcard-' + el) : ''}">${img(ico(c.icon, c.color), true)}<span>${esc(c.name)} is your class element: your skills deal ${esc(c.name)} damage.${ED.PATHS[el] ? ` Take the ${esc(ED.PATHS[el].name)} gate to infuse every hit.` : ''}</span></div>`; }
    let left = head('Paths', `${B.paths.length}/${B.slots}`) + `<div class="sh-list">${paths}</div>`;
    left += head('Class route', B.route.route ? esc(ED.routeLabel(m.hero.cls, B.route.route)) : 'at level 3') + routeBlock(B.route, ED.CLASSES[m.hero.cls].col.c);
    let boons = B.groups.length ? '' : '<div class="sh-empty">No boons yet. The first pick comes from the start offer.</div>';
    for (const g of B.groups) {
      const P = g.path ? ED.PATHS[g.path] : null, gc = g.group === 'route' ? 'var(--gold)' : P ? P.color : '';
      const title = g.group === 'route' ? 'Class route' : P ? `${P.name} <small>affinity <b>${ED.pathAffinity(p.boons || {}, g.path)}</b></small>` : 'Open <small>any hero, no path</small>';
      boons += `<div class="sh-bg"><div class="sh-gh"${gc ? ` style="--pc:${gc}"` : ''}>${P ? img(pathIco(g.path)) : ''}${title}</div>${g.items.map(boonRow).join('')}</div>`;
    }
    let status = '';
    for (const s of B.statuses) status += `<div class="sh-status sh-f" data-k="s:${s.id}" style="--sc:${s.color}"><b>${esc(s.name)}</b>${esc(s.rule)}</div>`;
    for (const d of m.mult.debuffs) if (!B.statuses.some(s => s.id === d.id)) status += `<div class="sh-status sh-f" data-k="s:${d.id}:${d.text.length}" style="--sc:${d.color}"><b>${esc(d.name)}</b>${esc(d.text)}</div>`;
    const mid = head('Boons', String(B.groups.reduce((n, g) => n + g.items.length, 0))) + (B.groups.length ? `<div class="sh-boons">${boons}</div>` : boons) + (status ? head('Statuses') + `<div class="sh-list">${status}</div>` : '');
    const held = B.relics.filter(r => !r.curse), curses = B.relics.filter(r => r.curse); // curses list apart and do not count as relics
    const relRow = (r) => `<div class="sh-relic sh-f" data-k="x:${r.id}" style="--rc:${RAR(r.rar).color}"><img class="sh-i2" alt="" src="${ED.Icons.relicUrl(r.id)}"><div class="sh-bm"><div class="sh-bt"><b class="sh-bn">${esc(r.name)}</b><span class="sh-rar">${RAR(r.rar).name}</span>${r.state ? `<span class="px-chip sh-state ${r.state}" data-live="rs:${r.id}">${r.state}</span>` : ''}</div>`
      + `<div class="sh-btx">${esc(r.text)}</div>${r.live ? `<div class="sh-live" data-live="rl:${r.id}">${esc(r.live)}</div>` : ''}</div></div>`;
    const rel = held.length ? held.map(relRow).join('') : '<div class="sh-empty">No relics yet.</div>';
    return col('paths', left) + col('boons', mid) + col('relics', head('Relics', String(held.length)) + `<div class="sh-list">${rel}</div>` + (curses.length ? head('Curses', String(curses.length)) + `<div class="sh-list">${curses.map(relRow).join('')}</div>` : ''));
  }

  // ---------------- Combat tab ----------------
  const heroFr = (m) => frc('shcard-p' + ((m.hero.slot | 0) % ED.PLAYER_COLORS.length));
  function weaponCard(m, color) {
    const w = m.weapon;
    let h = `<div class="shc sh-card sh-f" data-k="weapon" style="${heroFr(m)}"><div class="sh-ct">${img(ico(WEAPON_ICON[w.look] || 'sword', color), true)}<b>${esc(w.name)}</b>${chip(w.kind === 'melee' ? 'melee' : w.kind === 'bell' ? 'chained' : 'ranged', 'var(--muted)')}${w.fork ? chip(w.fork, 'var(--gold)') : ''}</div>`;
    h += `<div class="sh-big">${n1(w.hit)}<small>per hit</small><span class="sh-crit">${n1(w.crit)} crit <small>(${pc(w.critChance)} · ${X(w.critMult)})</small></span></div>`;
    h += `<div class="sh-row"><b>${w.aps.toFixed(2)}</b> ${w.kind === 'bell' ? 'loops/s' : 'attacks/s'} <span class="mut">(base ${w.apsBase.toFixed(2)})</span>`;
    h += w.kind === 'bell' ? ` · ${w.bells} ${w.bells > 1 ? 'bells' : 'bell'} · chain ${w.chain} · orbit ${w.orbit}` : w.kind === 'melee' ? ` · reach ${w.reach} · ${w.allAround ? 'all around' : w.arcDeg + '°'}` : ` · ${w.n} ${w.n > 1 ? 'projectiles' : 'projectile'} · range ${w.range}${SHAPE[w.shape] || ''}${w.pierce && !w.line ? ` · pierce ${w.pierce}` : ''}${w.homing ? ' · seeking' : ''}${w.blast ? ` · blast radius ${w.blast.r}` : ''}`;
    h += '</div>';
    if (w.fan) h += `<div class="sh-row mut">${w.oneFoe} of ${w.n} shots reach one foe at ${Sh.REF.d} px; all ${w.n} point-blank</div>`;
    for (const e of w.extras) h += `<div class="sh-row sh-ex"><span>${esc(e.label)}</span> <b>${n1(e.perAttack)}</b><span class="mut"> per attack${e.r ? ` (radius ${e.r})` : ''}${e.note ? ' · ' + esc(e.note) : ''}${e.el ? ' · ' + cap1(e.el) : ''}</span></div>`;
    for (const n of w.notes) h += `<div class="sh-row mut sh-ex">${esc(n)}</div>`;
    return h + `<div class="sh-tot">≈ <b>${n1(w.dps)}</b> damage/s on one foe${w.fan ? ` <span class="mut">(${n1(w.dpsAll)} if every shot lands)</span>` : ''}<small>every attack lands, no statuses, neutral stratum</small></div></div>`;
  }
  function partRow(q, stratum) {
    if (q.kind === 'zone') return `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv"></span><span class="sh-pn">${[q.r ? `radius ${q.r}` : '', q.dur ? `${Sh.secs(q.dur)}s` : '', q.note ? esc(q.note) : ''].filter(Boolean).join(' · ')}</span></div>`;
    let n = '';
    if (q.kind === 'status') n = `${esc(q.statusName)} pool added`;
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
    const elc = q.el ? chip(cap1(q.el), colorOf(q.el), 'sh-el') : '';
    const add = q.statusAdd ? `<div class="sh-part sub"><span class="sh-plab">+ ${esc(ED.STATUS[q.statusAdd.status].name)}</span><span class="sh-pv">${n1(q.statusAdd.here)}</span><span class="sh-pn">pool of half the hit</span></div>` : '';
    return `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv">${n1(q.here)}</span><span class="sh-pn">${n}${elc}</span></div>${add}`;
  }
  function skillCard(m, k, color, stratum) {
    let h = `<div class="shc sh-card sh-f" data-k="skill:${k.id}" style="${heroFr(m)};--pc:${color}"><div class="sh-ct"><kbd>${esc(ED.Input.label(k.key))}</kbd>${img(ico(k.icon, color), true)}<b>${esc(k.name)}</b><span class="sh-cd">${k.cd.toFixed(1)}s <small>(base ${k.cdBase.toFixed(1)}s)</small></span>${k.charges > 1 ? pips(k.charges, k.charges) : ''}</div>`;
    h += `<div class="sh-sub">${esc(cap1(k.aimText))}${k.aim === 'ground' ? ` (range ${k.range})` : k.aim === 'move' ? ` (${k.rangeMin}–${k.range})` : ''}</div>`;
    for (const q of k.parts) h += partRow(q, stratum);
    for (const he of k.heals) h += `<div class="sh-part"><span class="sh-plab">Heals</span><span class="sh-pv"></span><span class="sh-pn">${he.perMinion ? `${pc(he.perMinion)} of max health per minion, up to ${pc(he.cap)}` : `${pc(he.frac)} of max health`} · ${esc(he.label)}</span></div>`;
    const hits = k.parts.filter(q => q.kind !== 'zone' && q.kind !== 'status' && q.oneFoe > 0).reduce((n, q) => n + q.oneFoe, 0);
    return h + `<div class="sh-tot">Per cast on one foe: <b>${n1(k.perCast)}</b> <span class="mut">(${hits} ${hits === 1 ? 'hit' : 'hits'}${k.perCastAll > k.perCast + 0.5 ? `; ${n1(k.perCastAll)} if every shot lands` : ''})</span> · ≈ <b>${n1(k.dpsCd)}</b>/s over its cooldown</div></div>`;
  }
  function dashCard(m, color) {
    const d = m.dash;
    let h = `<div class="shc sh-card sh-f" data-k="dash" style="${heroFr(m)};--pc:${color}"><div class="sh-ct"><kbd>${esc(ED.Input.label('dash'))}</kbd>${img(ico('wing', color), true)}<b>Dash</b><span class="sh-cd">${d.cd.toFixed(2)}s${d.charges > 1 ? ' <small>each</small>' : ''}</span>${d.charges > 1 ? pips(d.charges, d.charges) : ''}</div><div class="sh-sub">${d.charges > 1 ? d.charges + ' charges · ' : ''}Untouchable for ${d.ifr}s while you dash</div>`;
    for (const q of d.parts) h += `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv">${q.dmg !== undefined ? n1(q.dmg) : ''}</span><span class="sh-pn">${q.per ? 'per ' + q.per + ' · ' : ''}${q.r ? 'radius ' + q.r + ' · ' : ''}${q.dur ? Sh.secs(q.dur) + 's · ' : ''}${esc(q.note || '')}</span></div>`;
    return h + '</div>';
  }
  function procsCard(m) {
    if (!m.procs.length) return '';
    return `<div class="shc sh-card sh-f" data-k="procs"><div class="sh-ct"><b>Procs</b><span class="mut">strikes that scale with your Power</span></div>${m.procs.map(q => `<div class="sh-part"><span class="sh-plab">${esc(q.label)}</span><span class="sh-pv">${n1(q.dmg)}</span><span class="sh-pn">${esc(q.note)}</span></div>`).join('')}</div>`;
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
      h += `<div class="sh-stat sh-f st" data-k="o:st:${s.el}" style="--pc:${s.color}"><div class="sh-sl"><span class="sh-l">${img(pathIco(s.el))}${esc(ED.STATUS[s.status].name)}${s.builtin ? ' <span class="mut">from your class skills</span>' : ''}</span></div><div class="sh-sub">${esc(s.est.label)}</div>${rows ? `<div class="sh-src">${rows}</div>` : ''}</div>`;
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
    if (D.foeParts.dark !== null) parts.push(`dark room ${X(D.foeParts.dark)}`);
    h += stat('d:foe', 'Foes that spawn now hit', X(D.foeHere), parts.join(' · ') + '. Foes already alive keep the damage they spawned with.', '');
    h += stat('d:heal', 'Healing received', X(D.healMul), `from your stats${D.pactHeal !== 1 ? ' and pact' : ''}`, chips(D.healRows, 'heal'));
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
    let atk = `<div class="sh-compact"><div class="sh-subl">${esc(m.weapon.name)}${rt.route ? ' · ' + esc(ED.routeLabel(m.hero.cls, rt.route)) + ' route' : ''}</div></div>`;
    atk += weaponCard(m, color);
    for (const k of m.skills) atk += skillCard(m, k, color, stratum);
    atk += dashCard(m, color) + procsCard(m);
    return col('attacks', head('Attacks') + `<div class="sh-list">${atk}</div>`) + col('offense', head('Offense') + `<div class="sh-list">${offenseRows(m)}</div>`) + col('defence', head('Defence') + `<div class="sh-list">${defenceRows(m)}</div>`);
  }

  // ---------------- Map tab ----------------
  // Stratum card (map row, the rooms behind the exit doors), dark-room rules (with the dark rooms still reachable), party.
  function renderMapSide(m) {
    const K = m.dark, biome = ED.biomeFor(m.ctx.stratum), v = ED.Game.s.view, fl = v.floor, cur = fl && fl.rooms[v.roomId];
    const rows = fl ? fl.rows | 0 : 0, row = cur ? cur.row | 0 : 0, where = !cur ? '' : cur.type === 'boss' ? 'Boss room' : cur.type === 'start' ? 'Start' : `Room ${row} of ${rows}`;
    let h = `<div class="sh-stat sh-f" data-k="m:strat"><div class="sh-sl"><span class="sh-l">${U.roman(m.ctx.stratum)} ${esc(biome.name)}</span><span class="sh-v">${live('row', where)}</span></div><div class="sh-sub">${esc(biome.blurb || '')}</div>`;
    const exits = cur && cur.exits ? cur.exits : [];
    if (exits.length) h += `<div class="sh-sub">${v.locked ? 'Doors open when the room is clear. ' : ''}Doors, left to right:</div>` + exits.map(id => `<div class="sh-cond">${esc(ED.Render.roomName(fl.rooms[id]))}</div>`).join('');
    h += '</div>';
    const ahead = fl && cur ? [...reachFrom(fl, cur.id)].filter(id => id !== cur.id && fl.rooms[id].dark).length : 0;
    h += `<div class="sh-stat sh-f" data-k="m:dark"><div class="sh-sl"><span class="sh-l">Dark rooms</span><span class="sh-v">${live('dark', `${ahead} ahead`)}</span></div>`
      + `<div class="sh-sub">Marked violet on the map and doors${K.here ? ' · you are in one' : ''}.</div>`
      + `<div class="sh-cond">Foes hit ${X(K.dmg)} · the last wave brings one more elite · the reward goes up one step · gold and experience dropped there ${X(K.loot)}</div></div>`;
    h += `<div class="sh-stat sh-f" data-k="m:party"><div class="sh-sl"><span class="sh-l">Party</span></div>${m.partyRows}</div>`;
    return h;
  }

  // ---------------- model, refresh, render ----------------
  function computeModel() {
    const s = ED.Game.s, p = viewed(), ctx = Sh.ctx(s.view, p), m = Sh.compute(p, ctx);
    m.partyRows = ctx.heroes.map(q => {
      const f = U.clamp(q.hp / Math.max(1, q.maxHp), 0, 1);
      return `<div class="sh-party${q.pid === p.pid ? ' me' : ''}${q.dead ? ' dead' : ''}" data-pid="${esc(q.pid)}"><span class="sh-pnm" style="color:${ED.PLAYER_COLORS[q.slot] || '#fff'}">${esc(q.name)} <span class="mut">${esc(ED.CLASSES[q.cls].name)}</span></span>`
        + `<b>${q.dead ? 'dead' : q.downed ? 'down' : q.hp + ' / ' + q.maxHp}</b><span class="sh-meter hp${f < 0.3 ? ' low' : ''}" style="--f:${q.dead ? 0 : f.toFixed(3)}"><i></i></span></div>`;
    }).join('');
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
    else { paint('shp-map-side', renderMapSide(m), force); mapView(force); }
    const w = s.me.picks | 0;
    $('sh-pill').textContent = w > 0 ? `${w} ${w === 1 ? 'boon' : 'boons'} waiting` : ''; $('sh-pill').hidden = !(w > 0);
    $('sh-view').hidden = !SH.viewPid; if (SH.viewPid) $('sh-view').textContent = `Viewing ${p.name}: back to you`;
    paintFoot();
    SH.dirty = false; SH.t = 0;
  }
  function paintFoot() {
    const I = ED.Input, k = (a) => `<kbd>${esc(I.label(a))}</kbd>`, gs = ED.Game.s, party = gs && gs.view && gs.view.players.size > 1; // Y cycles heroes: only with a party
    const html = I.device === 'pad' ? '<kbd>LB</kbd><kbd>RB</kbd> tabs · <kbd>D-pad</kbd> move · <kbd>R stick</kbd> scroll · ' + (party ? '<kbd>Y</kbd> party · ' : '') + '<kbd>B</kbd> close'
      : `${k('skill1')}${k('skill2')} tabs · ${k('up')}${k('left')}${k('down')}${k('right')} move · <kbd>PgUp</kbd><kbd>PgDn</kbd> scroll · ${k('map')} or <kbd>Esc</kbd> close`;
    if ($('sh-foot').innerHTML !== html) $('sh-keys').innerHTML = $('sh-foot').innerHTML = html;
  }

  // ---------------- public API ----------------
  UI.sheetDirty = () => { SH.dirty = true; };
  UI.sheetTick = (dt) => { SH.t += dt; if (SH.dirty || SH.t >= 0.5) render(false); };
  UI.sheetTab = (t) => {
    if (TABS.indexOf(t) < 0 || t === SH.tab) return;
    SH.tab = t; SH.focusEl = null; SH.focusKey = null;
    if (SH.mv) SH.mv.revealFor = null; // the Map tab opens on the current room
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
    if (SH.mv) SH.mv.revealFor = null;
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
    if (inp.scrollY) { const c = SH.tab === 'map' && SH.mv ? SH.mv.vp : (SH.focusEl && SH.focusEl.closest('.sh-in')) || $('shp-' + SH.tab).querySelector('.sh-in'); if (c) c.scrollTop += inp.scrollY * 45 * rem() * dt; } // the Map tab: the right stick scrolls the map
    if (inp.cycle) cycleHero();
  };
  function cycleHero(to) {
    const s = ED.Game.s, ids = [...s.view.players.keys()];
    if (ids.length < 2) return;
    const nx = to || ids[(ids.indexOf(viewed().pid) + 1) % ids.length];
    SH.viewPid = nx === s.me.pid ? null : nx;
    for (const c of $('ov-sheet').querySelectorAll('.sh-in')) c.scrollTop = 0; // another hero opens at the top of every column
    SH.focusEl = null; SH.focusKey = null; SH.sig = {}; render(true); focusFirst();
  }

  // ---------------- map ----------------
  // The Map tab: the floor map (ED.MapView, the same renderer as the M overlay) and its legend; the heading button opens the M overlay.
  const reachFrom = (fl, id) => ED.MapView.reach(fl, id);
  function mapView(force) {
    const fl = ED.Game.s.view.floor;
    ED.MapView.legend($('sh-legend'), fl);
    const b = $('sh-mapbtn'), t = 'Full map ' + ED.Input.label('mapview');
    if (b.textContent !== t) b.textContent = t;
    if (SH.mv) SH.mv.draw(force);
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
      if (SH.tab === 'map' && SH.mv) { if (SH.mv.scrollKey(e.code)) e.preventDefault(); return; } // the Map tab: the keys scroll the map
      const c = (SH.focusEl && SH.focusEl.closest('.sh-in')) || $('shp-' + SH.tab).querySelector('.sh-in');
      if (!c) return;
      if (e.code === 'PageDown') c.scrollTop += c.clientHeight - 2 * rem();
      else if (e.code === 'PageUp') c.scrollTop -= c.clientHeight - 2 * rem();
      else if (e.code === 'Home') c.scrollTop = 0;
      else if (e.code === 'End') c.scrollTop = c.scrollHeight;
      else return;
      e.preventDefault();
    });
    window.addEventListener('resize', () => { if (!root.hidden) SH.dirty = true; });
    SH.mv = ED.MapView.create($('sh-mapvp'), $('map-canvas'), $('sh-maptip'));
    $('sh-mapbtn').addEventListener('click', () => { UI.toggleSheet(false); ED.MapView.toggle(true); });
  };
})(globalThis.ED || (globalThis.ED = {}));
