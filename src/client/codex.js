// Achievements and Encyclopedia screens (client only; DOM in #scr-achieve / #scr-codex, shown through ED.UI.show).
// ED.Codex.renderAchievements(): one row per ED.UNLOCKS unlock (non-start heroes, non-start stages) with progress from ED.App.profile, plus lifetime and per-stage records.
// ED.Codex.renderCodex(tab?): tab row (heroes | weapons (hero weapons, then a Supports section) | passives | foes | bosses | stages), entry list and detail pane, read from the data tables. Only what the profile has met
// (profile.seen via ED.Save.isSeen; bosses by their foe id) is described: the rest lists as a '???' silhouette whose detail says 'Not discovered yet' (plus the unlock line for
// locked heroes / stages), and cross-references to unmet entries read '???'.
// List entries select on click or on keyboard focus (a hover-focus never changes the detail).
(function (ED) {
  'use strict';
  const U = ED.U, UI = ED.UI, SV = ED.Save, esc = UI.esc;
  const $ = (id) => document.getElementById(id);
  const C = ED.Codex = { tab: 'heroes', sel: {} };
  const App = () => ED.App;

  // ---------------- helpers ----------------
  const pct = (k) => (U.clamp(k, 0, 1) * 100).toFixed(0) + '%';
  const meter = (k) => `<span class="meter"><i style="width:${pct(k)}"></i></span>`;
  const div = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; return d; };
  // Atlas anim for a foe / boss look: idle, walk, four-way, eight-way, else the look itself.
  const lookIcon = (look) => {
    const A = ED.Atlas;
    if (A && A.ok) for (const s of ['.idle', '.walk', '.walk.d', '.walk.0', '']) if (A.has(look + s)) return look + s;
    return look + '.idle';
  };
  const foeIcon = (id) => (ED.FOES[id] ? lookIcon(ED.FOES[id].look) : '');
  const finalBoss = (sd) => (sd.bosses || []).find(b => b.final) || (sd.bosses || [])[0];
  const stageIcon = (i) => { const b = finalBoss(ED.STAGES[i]); return b ? foeIcon(b.id) : ''; };
  const UNSEEN = 'Not discovered yet';
  const seen = (k, id) => SV.isSeen(App().profile, k, id);
  const MODE = { cursor: 'Toward your cursor', around: 'Around you', random: 'Random foes', densest: 'Densest crowd' };
  const ROLE = { horde: 'Horde', control: 'Control', lane: 'Lane' };
  const supportRoots = () => ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved);

  // ---------------- achievements ----------------
  // Unlock rows: { sec, icon, name, rule, k (0..1), txt, done }.
  C.achievements = (p) => {
    const out = [], U0 = ED.UNLOCKS;
    for (const cls of ED.HERO_IDS) {
      const r = U0.heroes[cls], h = ED.HEROES[cls]; if (!r || r.start || !h) continue;
      const done = SV.heroUnlocked(p, cls), pr = UI.unlockProgress(p, r);
      out.push({ sec: 'Heroes', icon: UI.heroIcon(cls), name: h.name, rule: r.txt || '', k: done ? 1 : pr.k, txt: pr.txt || (done ? 'Done' : 'Not yet'), done });
    }
    ED.STAGES.forEach((sd, i) => {
      const r = U0.stages[i]; if (!r || r.start) return;
      const done = SV.stageUnlocked(p, i);
      out.push({ sec: 'Stages', icon: stageIcon(i), name: (i + 1) + '. ' + sd.name, rule: r.txt || '', k: done ? 1 : 0, txt: done ? 'Done' : 'Not yet', done });
    });
    return out;
  };
  C.renderAchievements = () => {
    const p = App().profile, rows = C.achievements(p), list = $('ach-list');
    list.textContent = '';
    let sec = '';
    for (const a of rows) {
      if (a.sec !== sec) { sec = a.sec; list.appendChild(div('cx-sec', esc(sec))); }
      const r = div('ach-row' + (a.done ? ' done' : ''));
      r.appendChild(UI.iconCanvas(a.icon, 64));
      r.insertAdjacentHTML('beforeend', `<span class="ach-name">${esc(a.name)}</span><span class="ach-rule">${esc(a.rule)}</span>` +
        `<span class="ach-prog">${meter(a.k)}<span class="ach-v">${esc(a.txt)}</span></span>`);
      r.setAttribute('aria-label', a.name + ': ' + a.rule + ', ' + a.txt);
      list.appendChild(r);
    }
    const n = rows.filter(a => a.done).length;
    $('ach-count').textContent = n + ' / ' + rows.length + ' unlocked';
    const st = p.stats, box = $('ach-rec');
    let h = '<span class="cx-h">Records</span><div class="rec-grid">' +
      [['Runs', st.runs], ['Wins', st.wins], ['Lifetime kills', U.fmtNum(st.kills)], ['Best time', U.fmtTime(st.bestTime)], ['Best kills (one run)', U.fmtNum(st.bestKills)], ['Best level', st.bestLevel]]
        .map(x => `<span>${x[0]}</span><b>${x[1]}</b>`).join('') + '</div><span class="cx-h">Stage bests</span>';
    ED.STAGES.forEach((sd, i) => {
      const b = p.best[sd.id];
      h += `<div class="rec-stage"><span class="rec-sn">${i + 1}. ${esc(sd.name)}</span>` + (b
        ? `<span class="${b.won ? 'won' : 'mut'}">${b.won ? 'Beaten' : 'Not beaten yet'}</span><div class="rec-grid"><span>Time</span><b>${U.fmtTime(b.time)}</b><span>Kills</span><b>${U.fmtNum(b.kills)}</b><span>Level</span><b>${b.level}</b></div>`
        : '<span class="mut">Not played yet</span>') + '</div>';
    });
    box.innerHTML = h;
    list.scrollTop = 0; box.scrollTop = 0; $('ach-body').scrollTop = 0;
  };

  // ---------------- encyclopedia: detail blocks ----------------
  // Head: icon (animated when anim), name, tag line, description.
  const head = (box, icon, name, tag, txt, opt) => {
    const o = opt || {}, hd = div('cx-head');
    const cv = o.anim ? UI.animCanvas(icon, 128) : UI.iconCanvas(icon, 128);
    if (o.locked) cv.classList.add('locked');
    hd.appendChild(cv);
    hd.insertAdjacentHTML('beforeend', `<div class="cx-title"><span class="cx-name">${esc(name)}</span>${tag ? `<span class="cx-tag">${esc(tag)}</span>` : ''}${txt ? `<span class="cx-txt">${esc(txt)}</span>` : ''}</div>`);
    box.appendChild(hd);
  };
  const chips = (box, pairs) => box.appendChild(div('cx-chips', pairs.filter(Boolean).map(x => `<span>${esc(x[0])} <b>${esc(x[1])}</b></span>`).join('')));
  const h3 = (box, t) => box.appendChild(div('cx-h', esc(t)));
  const para = (box, t, cls) => box.appendChild(div('cx-p' + (cls ? ' ' + cls : ''), esc(t)));
  // Icon row: [icon] name (+ key badge) / second line; hide: silhouette, '???' and UNSEEN instead of name and line.
  const ref = (box, icon, name, txt, key, hide) => {
    if (hide) { name = '???'; txt = UNSEEN; }
    const d = div('cx-ref' + (hide ? ' unseen' : '')); d.appendChild(UI.iconCanvas(icon, 48));
    d.insertAdjacentHTML('beforeend', `<b>${key ? `<span class="key">${esc(key)}</span>` : ''}${esc(name)}</b>${txt ? `<span>${esc(txt)}</span>` : ''}`);
    box.appendChild(d); return d;
  };
  // Level table: rows [label, text], one line per level.
  const lvls = (box, rows) => { if (rows.length) box.appendChild(div('cx-lv', rows.map(r => `<span class="k">${esc(r[0])}</span><span>${esc(r[1])}</span>`).join(''))); };
  const lockLine = (box, p, rule) => {
    const pr = UI.unlockProgress(p, rule), d = div('cx-lock', `<span>Locked: ${esc(rule.txt || 'not yet available')}</span>`);
    if (pr.txt) d.insertAdjacentHTML('beforeend', `<span class="cx-prog">${meter(pr.k)}<span class="mut">${esc(pr.txt)}</span></span>`);
    box.appendChild(d);
  };
  const skillBlock = (box, id, key) => {
    const d = ED.SKILLS[id]; if (!d) return;
    ref(box, d.icon, d.name, d.txt + (d.cd ? ' (' + d.cd + ' s cooldown)' : ''), key);
    lvls(box, (d.levels || []).map((l, i) => ['Lv ' + (i + 2), l.txt]));
  };
  // Forms of root weapon d: name and line once discovered, else ???; how to reach them stays hidden.
  const formLine = (box, d) => {
    const F = ED.weaponForms(d.id); if (!F.length) return;
    h3(box, F.length > 1 ? 'Forms (one per weapon, from chests)' : 'Form (from a chest)');
    for (const f of F) { const e = ED.WEAPONS[f.id]; ref(box, e.icon, e.name, e.txt, '', !seen('weapons', e.id)); }
  };

  const heroDetail = (box, cls) => {
    const h = ED.HEROES[cls], p = App().profile, open = SV.heroUnlocked(p, cls), rule = ED.UNLOCKS.heroes[cls] || {};
    head(box, UI.heroIcon(cls), h.name, rule.start ? 'Open from the start' : open ? 'Unlocked' : 'Locked', h.txt, { anim: true, locked: !open });
    chips(box, [['HP', h.hp], ['Speed', h.speed], h.crit ? ['Crit', Math.round(h.crit * 100) + '%'] : null]);
    if (!open) lockLine(box, p, rule);
    const sig = ED.WEAPONS[h.sig];
    if (sig) {
      h3(box, 'Weapon');
      ref(box, sig.icon, sig.name, sig.txt);
    }
    h3(box, 'Skill');
    skillBlock(box, h.skills[0], UI.keyOf('skill1', 'Q'));
  };
  const weaponDetail = (box, id) => {
    const d = ED.WEAPONS[id], hero = d.sig && ED.HEROES[d.sig], root = d.from && ED.WEAPONS[d.from];
    const tag = d.form ? 'Form' + (root ? ' of ' + root.name : '') : d.support ? 'Support' + (ROLE[d.role] ? ', ' + ROLE[d.role] : '') : 'Weapon' + (hero ? ', ' + hero.name : '');
    head(box, d.icon, d.name, tag, d.txt);
    if (MODE[d.mode]) chips(box, [['Aims', MODE[d.mode]]]);
    if (d.form) { if (d.refine) { h3(box, 'Refine'); lvls(box, d.refine.map((l, i) => ['Rank ' + (i + 1), l.txt])); } return; }
    for (const pa of d.paths || []) { h3(box, 'Path: ' + pa.name); lvls(box, pa.ranks.map((l, i) => ['Rank ' + (i + 1), l.txt])); }
    formLine(box, d);
  };
  // '+10% damage' at level n: every number in the line times n.
  const scaled = (txt, n) => txt.replace(/\d+(\.\d+)?/g, (v) => String(Math.round(+v * n * 100) / 100));
  const passiveDetail = (box, id) => {
    const d = ED.PASSIVES[id];
    head(box, d.icon, d.name, 'Passive, max level ' + d.max, d.lines ? '' : d.txt);
    if (d.lines) lvls(box, d.lines.map((t, i) => ['Lv ' + (i + 1), t]));
    else lvls(box, [['Each', d.txt], ['Lv ' + d.max, scaled(d.txt, d.max)]]);
  };

  // Foe appearances: { id: [{ stage, min }] } from the stage timelines; split children inherit the parent's.
  const appearances = () => {
    const out = {};
    const add = (id, i, m) => { const a = out[id] || (out[id] = []); const e = a.find(x => x.stage === i); if (!e) a.push({ stage: i, min: m }); else e.min = Math.min(e.min, m); };
    ED.STAGES.forEach((sd, i) => sd.timeline.forEach((row, m) => { for (const r of row.roster) if (r[1] > 0) add(r[0], i, m); }));
    for (const id in out) { const sp = ED.FOES[id] && ED.FOES[id].split; if (sp) for (const a of out[id]) add(sp.id, a.stage, a.min); }
    return out;
  };
  const KIND = {
    chaser: 'Chaser: walks straight at you', swarm: 'Swarmer: fast and weak, comes in packs', brute: 'Brute: slow and tough, a telegraphed slam',
    ranged: 'Ranged: stops at range and shoots', exploder: 'Exploder: bursts after a short fuse', charger: 'Charger: a telegraphed dash', diver: 'Diver: hovers, then a telegraphed dive',
  };
  const foeDetail = (box, id) => {
    const d = ED.FOES[id], ap = appearances()[id] || [];
    const kind = (KIND[d.ai] || '').split(': '), desc = kind[1] ? kind[1][0].toUpperCase() + kind[1].slice(1) : '';
    head(box, foeIcon(id), d.name, d.split ? 'Splitter' : kind[0], d.split ? 'Splits when it dies' : desc);
    chips(box, [['HP', d.hp], ['Speed', d.spd], ['XP', d.xp], d.kb === 0 ? ['Knockback', 'immune'] : null]);
    const L = [];
    if (d.split && ED.FOES[d.split.id]) L.push('Splits into ' + d.split.n[0] + '-' + d.split.n[1] + ' ' + ED.FOES[d.split.id].name);
    if (d.shot) L.push('Shoots ' + (d.shot.spread === 'ring' ? 'a ring of ' + d.shot.n + ' bolts' : d.shot.n > 1 ? 'a fan of ' + d.shot.n + ' bolts' : 'a bolt') + ' (' + d.shot.dmg + ' damage) every ' + d.shot.cd + ' s');
    if (d.boom) L.push('Bursts after ' + d.fuse + ' s: ' + d.boom.dmg + ' damage');
    if (d.slam) L.push('Slam: ' + d.slam.mul + 'x contact damage every ' + d.slam.cd + ' s' + (d.slam.ring ? ', plus a ring of ' + d.slam.ring.n + ' shots' : ''));
    if (d.charge) L.push('Dashes at you every ' + d.charge.cd + ' s');
    if (d.dive) L.push('Dives at you every ' + d.dive.cd + ' s');
    if (d.pack) L.push('Packs of ' + d.pack[0] + '-' + d.pack[1]);
    for (const t of L) para(box, t);
    para(box, 'HP shown at 0:00 solo; it grows every minute.', 'mut');
    if (ap.length) { h3(box, 'Appears in'); for (const a of ap) para(box, ED.STAGES[a.stage].name + ' from ' + U.fmtTime(a.min * 60)); }
  };

  // Boss pattern lines (one per phase), mirrored from the src/sim/boss-*.js headers.
  const BOSS_TXT = {
    warden: ['Strings of sword swings end in a slam that leaves him stuck: punish him then', '66%: longer strings, lunges, a ring of bone shards, bone waves', '33%: spectral swords fall on warned lines through every hero'],
    twins: ['The Lancer thrusts and sweeps; the Hammer slams, leaps and quakes', 'Together they pull you in or web the ground, then the Hammer lands there', 'A fallen twin rises again unless both fall together'],
    hollow: ['Three-swing combo, a crown thrown out and back, blink and cleave', '66%: three crown shards orbit him, three crowns per throw, skull novas', '33%: a second shard ring, double blinks, starfall on every hero'],
    spore: ['Rooted; grows a slowing, poisonous spore carpet around her and four pods', 'Kill a pod to clear the carpet around it; lashes and spore rings', '33%: she uproots and walks after you, bursts spiral'],
    cyclops: ['Eye laser sweep (walls block it), stomp shockwaves, leap slam with a fire ring', '66%: the laser sweeps back, double stomps, fire volleys', '33%: three lasers, triple stomps, spider adds'],
    king: ['Tidal beam sweep (walls block it), trident fan, leap slam, adds', '66%: two opposite beams, five tridents, a pulling whirlpool', '33%: a whirlpool follows him, the beams turn half a circle'],
    samurai: ['Dash slash along a warned lane, sword waves, a screen-long iaido cut', '66%: double dashes, five waves', '33%: triple dashes, a crossed iaido, spin slashes'],
    weaver: ['Rift gates open into portals that shoot; threads cross your spot; blink with a bolt ring', '66%: three gates, threads stay as strands, adds', '33%: four gates firing faster, four threads per weave'],
    wickeater: ['Devour: a warned cone drags you toward its bite', 'Closing dark: a shrinking ring, walk through its gap or dash', 'Lash fans and spiralling orb blooms; it swells at 33%'],
  };
  const bossOf = (key) => { const [si, bi] = key.split(':').map(Number); return ED.STAGES[si].bosses[bi]; }; // 'stage:index' -> stage boss row { id, t, final }
  const bossDetail = (box, key) => {
    const [si, bi] = key.split(':').map(Number), sd = ED.STAGES[si], b = sd.bosses[bi], d = ED.FOES[b.id];
    head(box, foeIcon(b.id), d.name, (b.final ? 'Final boss' : 'Mid-boss') + ', ' + sd.name + ' at ' + U.fmtTime(b.t), '');
    chips(box, [['HP', U.fmtNum(ED.bossHp(b.t, (sd.foe && sd.foe.hp) || 1)) + ' solo'], ['Speed', d.spd]]);
    h3(box, 'Attacks');
    lvls(box, (BOSS_TXT[b.id] || []).map((t, i) => [String(i + 1), t]));
    para(box, 'Every attack is telegraphed: a red outline marks where it lands.', 'mut');
    para(box, b.final ? 'Beat it to win the stage. Still alive at ' + U.fmtTime(ED.CONST.ENRAGE_T) + ', it enrages: x3 damage and speed.' : 'Drops a chest: pick a Form for a ready weapon, else an extra level-up.');
    para(box, 'HP grows with the party size.', 'mut');
  };
  const stageDetail = (box, i) => {
    const sd = ED.STAGES[i], p = App().profile, open = SV.stageUnlocked(p, i), rule = ED.UNLOCKS.stages[i] || {}, best = p.best[sd.id];
    const pv = UI.stagePreview(i); pv.classList.add('cx-prev'); if (!open) pv.classList.add('locked'); box.appendChild(pv);
    box.appendChild(div('cx-title', `<span class="cx-name">${i + 1}. ${esc(sd.name)}</span><span class="cx-tag">${rule.start ? 'Open from the start' : open ? 'Unlocked' : 'Locked'}</span>`));
    if (!open) lockLine(box, p, rule);
    chips(box, [['Foe HP', 'x' + sd.foe.hp], ['Foe damage', 'x' + sd.foe.dmg]]);
    h3(box, 'Bosses');
    for (const b of sd.bosses) if (ED.FOES[b.id]) { const on = seen('foes', b.id), r = ref(box, foeIcon(b.id), on ? ED.FOES[b.id].name : '???', U.fmtTime(b.t) + (b.final ? ', final boss' : '')); if (!on) r.classList.add('unseen'); }
    const ev = sd.events && sd.events.swarm;
    if (ev) para(box, 'Swarm wave every ' + ev.every + ' s from ' + U.fmtTime(ev.first));
    if (sd.elites) para(box, 'Elite every ' + sd.elites.every + ' s from ' + U.fmtTime(sd.elites.first) + ': it drops a chest');
    para(box, best ? 'Your best: ' + U.fmtTime(best.time) + ', ' + U.fmtNum(best.kills) + ' kills, level ' + best.level + (best.won ? ', beaten' : '') : 'Not played yet', best && best.won ? 'ok' : 'mut');
    h3(box, 'Foes');
    const ap = appearances(), ids = Object.keys(ap).filter(id => ap[id].some(a => a.stage === i)).sort((a, b) => ap[a].find(x => x.stage === i).min - ap[b].find(x => x.stage === i).min);
    const ro = div('cx-roster');
    for (const id of ids) { const s = document.createElement('span'), on = seen('foes', id); if (!on) s.className = 'unseen'; s.appendChild(UI.iconCanvas(foeIcon(id), 48)); s.insertAdjacentHTML('beforeend', esc(on ? ED.FOES[id].name : '???')); ro.appendChild(s); }
    box.appendChild(ro);
  };

  // Unmet entry: silhouette icon, '???', UNSEEN; rule (a locked hero / stage) adds its unlock line and progress.
  const unseenDetail = (box, icon, rule) => {
    head(box, icon, '???', '', UNSEEN, { locked: true });
    if (rule) lockLine(box, App().profile, rule);
  };

  // ---------------- encyclopedia: tabs and lists ----------------
  // Entry: { key, icon, name, cls } or { sec } (a list heading). Tab: kind (profile.seen list), seenId(key) (id in that list, default the key), hidden(box, key) (unmet entry).
  const TABS = [
    { id: 'heroes', name: 'Heroes', kind: 'heroes', detail: heroDetail,
      hidden: (box, c) => unseenDetail(box, UI.heroIcon(c), SV.heroUnlocked(App().profile, c) ? null : ED.UNLOCKS.heroes[c] || {}), list: () => ED.HERO_IDS.filter(c => ED.HEROES[c]).map(c => ({ key: c, icon: UI.heroIcon(c), name: ED.HEROES[c].name, cls: SV.heroUnlocked(App().profile, c) ? '' : 'locked' })) },
    { id: 'weapons', name: 'Weapons', kind: 'weapons', detail: weaponDetail, hidden: (box, id) => unseenDetail(box, ED.WEAPONS[id].icon), list: () => {
      const out = [];
      for (const cls of ED.HERO_IDS) {
        const h = ED.HEROES[cls], d = h && ED.WEAPONS[h.sig]; if (!d) continue;
        out.push({ sec: h.name });
        out.push({ key: d.id, icon: d.icon, name: d.name, cls: '' });
        for (const f of ED.weaponForms(d.id)) { const e = ED.WEAPONS[f.id]; out.push({ key: e.id, icon: e.icon, name: e.name, cls: 'evo' }); }
      }
      const S = supportRoots();
      if (S.length) out.push({ sec: 'Supports' });
      for (const id of S) {
        const d = ED.WEAPONS[id];
        out.push({ key: id, icon: d.icon, name: d.name, cls: '' });
        for (const f of ED.weaponForms(id)) { const e = ED.WEAPONS[f.id]; out.push({ key: e.id, icon: e.icon, name: e.name, cls: 'evo' }); }
      }
      return out;
    } },
    { id: 'passives', name: 'Passives', kind: 'passives', detail: passiveDetail, hidden: (box, id) => unseenDetail(box, ED.PASSIVES[id].icon), list: () => (ED.PASSIVE_IDS || Object.keys(ED.PASSIVES)).filter(id => ED.PASSIVES[id]).map(id => ({ key: id, icon: ED.PASSIVES[id].icon, name: ED.PASSIVES[id].name })) },
    { id: 'foes', name: 'Foes', kind: 'foes', detail: foeDetail, hidden: (box, id) => unseenDetail(box, foeIcon(id)), list: () => {
      const ap = appearances(), out = [];
      ED.STAGES.forEach((sd, i) => {
        const ids = Object.keys(ap).filter(id => ED.FOES[id] && !ED.FOES[id].boss && ap[id][0].stage === i).sort((a, b) => ap[a][0].min - ap[b][0].min || ED.FOES[a].idx - ED.FOES[b].idx);
        if (!ids.length) return;
        out.push({ sec: sd.name });
        for (const id of ids) out.push({ key: id, icon: foeIcon(id), name: ED.FOES[id].name });
      });
      return out;
    } },
    { id: 'bosses', name: 'Bosses', kind: 'foes', seenId: (k) => bossOf(k).id, detail: bossDetail, hidden: (box, k) => unseenDetail(box, foeIcon(bossOf(k).id)), list: () => {
      const out = [];
      ED.STAGES.forEach((sd, i) => { out.push({ sec: sd.name }); (sd.bosses || []).forEach((b, j) => { if (ED.FOES[b.id]) out.push({ key: i + ':' + j, icon: foeIcon(b.id), name: ED.FOES[b.id].name, cls: b.final ? 'evo' : '' }); }); });
      return out;
    } },
    { id: 'stages', name: 'Stages', kind: 'stages', seenId: (k) => ED.STAGE_IDS[+k], detail: (box, k) => stageDetail(box, +k),
      hidden: (box, k) => unseenDetail(box, stageIcon(+k), SV.stageUnlocked(App().profile, +k) ? null : ED.UNLOCKS.stages[+k] || {}), list: () => ED.STAGES.map((sd, i) => ({ key: String(i), icon: stageIcon(i), name: (i + 1) + '. ' + sd.name, cls: SV.stageUnlocked(App().profile, i) ? '' : 'locked' })) },
  ];
  const tabOf = (id) => TABS.find(t => t.id === id) || TABS[0];
  const met = (tab, key) => seen(tab.kind, tab.seenId ? tab.seenId(key) : key);
  const showDetail = (tab, key) => {
    const box = $('cx-detail'); box.textContent = ''; box.scrollTop = 0;
    if (key !== undefined && key !== null) (met(tab, key) ? tab.detail : tab.hidden)(box, key);
  };
  const select = (key) => {
    const tab = tabOf(C.tab); if (C.sel[tab.id] === key && $('cx-detail').childNodes.length) return;
    C.sel[tab.id] = key;
    for (const b of $('cx-list').querySelectorAll('.cx-item')) { const on = b.dataset.key === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    showDetail(tab, key);
  };
  C.renderCodex = (tabId) => {
    if (tabId) C.tab = tabId;
    const tab = tabOf(C.tab), tabs = $('cx-tabs');
    tabs.textContent = '';
    for (const t of TABS) {
      const b = document.createElement('button'), on = t.id === tab.id;
      b.className = 'btn btn-sm' + (on ? ' on' : ''); b.textContent = t.name; b.dataset.tab = t.id;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.onclick = () => { if (C.tab === t.id) return; C.renderCodex(t.id); const nb = tabs.querySelector('[data-tab="' + t.id + '"]'); if (nb) nb.focus(); };
      tabs.appendChild(b);
    }
    const list = $('cx-list'), entries = tab.list();
    list.textContent = ''; list.scrollTop = 0; $('cx-body').scrollTop = 0;
    const keys = entries.filter(e => e.key !== undefined).map(e => e.key);
    if (keys.indexOf(C.sel[tab.id]) < 0) C.sel[tab.id] = keys[0];
    for (const e of entries) {
      if (e.sec) { list.appendChild(div('cx-sec', esc(e.sec))); continue; }
      const b = document.createElement('button'), on = e.key === C.sel[tab.id], known = met(tab, e.key);
      b.className = 'cx-item' + (e.cls ? ' ' + e.cls : '') + (known ? '' : ' unseen') + (on ? ' on' : ''); b.dataset.key = e.key;
      b.setAttribute('role', 'option'); b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.appendChild(UI.iconCanvas(e.icon, 48));
      b.insertAdjacentHTML('beforeend', `<span>${esc(known ? e.name : '???')}</span>`);
      b.onclick = () => select(e.key);
      b.onfocus = () => { if (!b.matches(':hover')) select(e.key); };
      list.appendChild(b);
    }
    showDetail(tab, C.sel[tab.id]);
  };
})(globalThis.ED || (globalThis.ED = {}));
