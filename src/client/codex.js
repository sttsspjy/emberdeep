// Achievements and Encyclopedia screens (client only; DOM in #scr-achieve / #scr-codex, shown through ED.UI.show).
// ED.Codex.renderAchievements(): earns what the profile now meets (ED.UI.evalAch), then one row per ED.UNLOCKS unlock (non-start heroes, non-start stages) and per ED.ACHIEVEMENTS entry
// (progress, gold reward) from ED.App.profile, plus lifetime and per-stage records. ED.Codex.achIcon(id): atlas icon of an achievement.
// ED.Codex.renderCodex(tab?): tab row (heroes | weapons (hero weapons, then a Supports section) | passives | foes | bosses | stages), entry list and detail pane, read from the data tables. Only what the profile has met
// (profile.seen via ED.Save.isSeen; bosses by their foe id) is described: the rest lists as a '???' silhouette whose detail says 'Not discovered yet' (plus the unlock line for
// locked heroes / stages), and cross-references to unmet entries read '???'. A hidden stage (ED.Save.stageHidden) and its foes, bosses, records and achievement stay out of every list until it unlocks.
// List entries select on click or on keyboard focus (a hover-focus never changes the detail). Text: ED.t templates (T) and ED.tr for registry strings (L), built at render time.
(function (ED) {
  'use strict';
  const U = ED.U, UI = ED.UI, SV = ED.Save, esc = UI.esc, T = ED.t, L = ED.tr;
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
  const foeIcon = C.foeIcon = (id) => (ED.FOES[id] ? lookIcon(ED.FOES[id].look) : '');
  const finalBoss = (sd) => (sd.bosses || []).find(b => b.final) || (sd.bosses || [])[0];
  const stageIcon = (i) => { const b = finalBoss(ED.STAGES[i]); return b ? foeIcon(b.id) : ''; };
  const seen = (k, id) => SV.isSeen(App().profile, k, id);
  const MODE = { cursor: () => T('Toward your cursor'), around: () => T('Around you'), random: () => T('Random foes'), densest: () => T('Densest crowd'), nearest: () => T('Nearest foe') };
  const ROLE = { horde: () => T('Horde'), control: () => T('Control'), lane: () => T('Lane') };
  const supportRoots = () => ED.WEAPON_IDS.filter(id => ED.WEAPONS[id].support && !ED.WEAPONS[id].evolved);

  // ---------------- achievements ----------------
  // Icon of achievement id: its data icon, else from the rule (stage boss, hero, hero weapon), else a chest.
  C.achIcon = (id) => {
    const a = ED.ACHIEVEMENTS.find(x => x.id === id); if (!a) return 'pickup.chest';
    const r = a.rule, h = ED.HEROES[r.winWith || r.form], w = h && r.form ? ED.WEAPONS[h.sig] : null;
    return a.icon || (r.beat !== undefined ? stageIcon(r.beat) : w ? w.icon : h ? UI.heroIcon(h.id) : 'pickup.chest');
  };
  // Progress text of achievement a: time or counts as 'cur / need', single goals 'Done' / 'Not yet'.
  const achTxt = (a, g) => (g.done ? T('Done') : g.need === 1 ? T('Not yet') : a.rule.time ? U.fmtTime(g.cur) + ' / ' + U.fmtTime(g.need) : U.fmtNum(g.cur) + ' / ' + U.fmtNum(g.need));
  // Rows: { sec (display heading), ach (an achievement row), icon, name, rule, k (0..1), txt, done, gold (achievements: reward, else undefined), reward (achievements: cosmetic id or '') }; unlock rows first.
  C.achievements = (p) => {
    const out = [], U0 = ED.UNLOCKS;
    for (const cls of ED.HERO_IDS) {
      const r = U0.heroes[cls], h = ED.HEROES[cls]; if (!r || r.start || !h) continue;
      const done = SV.heroUnlocked(p, cls), pr = UI.unlockProgress(p, r);
      out.push({ sec: T('Heroes'), icon: UI.heroIcon(cls), name: L(h.name), rule: L(r.txt || ''), k: done ? 1 : pr.k, txt: done ? T('Done') : pr.txt || T('Not yet'), done });
    }
    ED.STAGES.forEach((sd, i) => {
      const r = U0.stages[i]; if (!r || r.start || SV.stageHidden(p, i)) return;
      const done = SV.stageUnlocked(p, i);
      out.push({ sec: T('Stages'), icon: stageIcon(i), name: (i + 1) + '. ' + L(sd.name), rule: L(r.txt || ''), k: done ? 1 : 0, txt: done ? T('Done') : T('Not yet'), done });
    });
    for (const a of ED.ACHIEVEMENTS) {
      const g = SV.achProgress(p, a), t = SV.achText(a);
      if (a.rule.beat !== undefined && SV.stageHidden(p, a.rule.beat)) { out.push({ sec: T('Achievements'), ach: true, icon: 'pickup.chest', name: '???', rule: T('Something waits below'), k: 0, txt: T('Not yet'), done: false, gold: a.gold, reward: '' }); continue; }
      out.push({ sec: T('Achievements'), ach: true, icon: C.achIcon(a.id), name: L(t.name), rule: L(t.txt), k: g.k, txt: achTxt(a, g), done: g.done, gold: a.gold, reward: a.reward || '' });
    }
    return out;
  };
  C.renderAchievements = () => {
    const got = UI.evalAch(), p = App().profile, rows = C.achievements(p), list = $('ach-list');
    list.textContent = '';
    let sec = '';
    for (const a of rows) {
      if (a.sec !== sec) { sec = a.sec; list.appendChild(div('cx-sec', esc(sec))); }
      const r = div('ach-row' + (a.done ? ' done' : ''));
      r.appendChild(UI.iconCanvas(a.icon, 64));
      const rw = esc(UI.rewardTxt(a.gold, a.reward, ' · '));
      r.insertAdjacentHTML('beforeend', `<span class="ach-name">${esc(a.name)}</span><span class="ach-rule">${esc(a.rule)}${rw ? ` <span class="ach-gold">${rw}</span>` : ''}</span>` +
        `<span class="ach-prog">${meter(a.k)}<span class="ach-v">${esc(a.txt)}</span></span>`);
      r.setAttribute('aria-label', a.name + ': ' + a.rule + (rw ? ', ' + rw : '') + ', ' + a.txt);
      list.appendChild(r);
    }
    const unl = rows.filter(a => !a.ach), ach = rows.filter(a => a.ach), cnt = [unl.filter(a => a.done).length, unl.length, ach.filter(a => a.done).length, ach.length];
    $('ach-count').textContent = got.length ? T('{0} / {1} unlocked, {2} / {3} achievements. New: {4}', ...cnt, got.map(a => L(a.name) + (a.gold ? ' +' + a.gold : '')).join(', '))
      : T('{0} / {1} unlocked, {2} / {3} achievements', ...cnt);
    const st = p.stats, box = $('ach-rec');
    let h = `<span class="cx-h">${T('Records')}</span><div class="rec-grid">` +
      [[T('Runs'), st.runs], [T('Wins'), st.wins], [T('Lifetime kills'), U.fmtNum(st.kills)], [T('Best time'), U.fmtTime(st.bestTime)], [T('Best kills (one run)'), U.fmtNum(st.bestKills)], [T('Best level'), st.bestLevel]]
        .map(x => `<span>${x[0]}</span><b>${x[1]}</b>`).join('') + `</div><span class="cx-h">${T('Stage bests')}</span>`;
    ED.STAGES.forEach((sd, i) => {
      if (SV.stageHidden(p, i)) return;
      const b = p.best[sd.id];
      h += `<div class="rec-stage"><span class="rec-sn">${i + 1}. ${esc(L(sd.name))}</span>` + (b
        ? `<span class="${b.won ? 'won' : 'mut'}">${b.won ? T('Beaten') : T('Not beaten yet')}</span><div class="rec-grid"><span>${T('Time')}</span><b>${U.fmtTime(b.time)}</b><span>${T('Kills')}</span><b>${U.fmtNum(b.kills)}</b><span>${T('Level')}</span><b>${b.level}</b></div>`
        : `<span class="mut">${T('Not played yet')}</span>`) + '</div>';
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
  // Icon row: [icon] name (+ key badge) / second line; hide: silhouette, '???' and 'Not discovered yet' instead of name and line.
  const ref = (box, icon, name, txt, key, hide) => {
    if (hide) { name = '???'; txt = T('Not discovered yet'); }
    const d = div('cx-ref' + (hide ? ' unseen' : '')); d.appendChild(UI.iconCanvas(icon, 48));
    d.insertAdjacentHTML('beforeend', `<b>${key ? `<span class="key">${esc(key)}</span>` : ''}${esc(name)}</b>${txt ? `<span>${esc(txt)}</span>` : ''}`);
    box.appendChild(d); return d;
  };
  // Level table: rows [label, text], one line per level.
  const lvls = (box, rows) => { if (rows.length) box.appendChild(div('cx-lv', rows.map(r => `<span class="k">${esc(r[0])}</span><span>${esc(r[1])}</span>`).join(''))); };
  const lockLine = (box, p, rule) => {
    const pr = UI.unlockProgress(p, rule), d = div('cx-lock', `<span>${esc(T('Locked: {0}', rule.txt ? L(rule.txt) : T('not yet available')))}</span>`);
    if (pr.txt) d.insertAdjacentHTML('beforeend', `<span class="cx-prog">${meter(pr.k)}<span class="mut">${esc(pr.txt)}</span></span>`);
    box.appendChild(d);
  };
  const skillBlock = (box, id, key) => {
    const d = ED.SKILLS[id]; if (!d) return;
    ref(box, d.icon, L(d.name), d.cd ? T('{0} ({1} s cooldown)', L(d.txt), d.cd) : L(d.txt), key);
    lvls(box, (d.levels || []).map((l, i) => [T('Lv {0}', i + 2), L(l.txt)]));
  };
  // Weapon tree of root weapon d: tune kinds, then per path its shape ranks (path ranks 1 / 3 / 5) and its Forms (name and line once discovered, else ???).
  const weaponTree = (box, d) => {
    h3(box, T('Tune ({0} level-ups, at most {1} of one)', ED.TUNE_MAX || 5, ED.TUNE_KIND_MAX || 3));
    lvls(box, (ED.TUNE || []).map(t => [T('Tune'), L(t.txt)]));
    (d.paths || []).forEach((pa, i) => {
      h3(box, T('Path: {0}', L(pa.name)));
      lvls(box, pa.ranks.map((l, k) => [T('Rank {0}', 2 * k + 1), L(l.txt)]).concat(ED.PATH_STEP ? [[T('Rank {0}, {1}', 2, 4), L(ED.PATH_STEP.txt)]] : []));
      for (const id of ED.pathForms(d.id, i)) { const e = ED.WEAPONS[id]; ref(box, e.icon, L(e.name), L(e.txt), '', !seen('weapons', e.id)); }
    });
  };
  const openTag = (rule, open) => (rule.start ? T('Open from the start') : open ? T('Unlocked') : T('Locked'));

  const heroDetail = (box, cls) => {
    const h = ED.HEROES[cls], p = App().profile, open = SV.heroUnlocked(p, cls), rule = ED.UNLOCKS.heroes[cls] || {};
    head(box, UI.heroIcon(cls), L(h.name), (h.role ? L(h.role) + ', ' : '') + openTag(rule, open), L(h.txt), { anim: true, locked: !open });
    chips(box, [[T('HP'), h.hp], [T('Speed'), h.speed], h.crit ? [T('Crit'), Math.round(h.crit * 100) + '%'] : null]);
    if (!open) lockLine(box, p, rule);
    const sig = ED.WEAPONS[h.sig];
    if (sig) {
      h3(box, T('Weapon'));
      ref(box, sig.icon, L(sig.name), L(sig.txt));
    }
    h3(box, T('Skill'));
    skillBlock(box, h.skills[0], UI.keyOf('skill1', 'Q'));
  };
  const weaponDetail = (box, id) => {
    const d = ED.WEAPONS[id], hero = d.sig && ED.HEROES[d.sig], root = d.from && ED.WEAPONS[d.from];
    const tag = d.form ? (root ? T('Form of {0}', L(root.name)) : T('Form')) : d.support ? (ROLE[d.role] ? T('Support weapon, {0}', ROLE[d.role]()) : T('Support weapon')) : hero ? T('Weapon, {0}', L(hero.name)) : T('Weapon');
    head(box, d.icon, L(d.name), tag, L(d.txt));
    if (MODE[d.mode]) chips(box, [[T('Aims'), MODE[d.mode]()]]);
    if (d.form) { if (d.refine) { h3(box, T('Refine')); lvls(box, d.refine.map((l, i) => [T('Rank {0}', i + 1), L(l.txt)])); } return; }
    weaponTree(box, d);
  };
  // '+10% damage' at level n: every number in the line times n.
  const scaled = (txt, n) => txt.replace(/\d+(\.\d+)?/g, (v) => String(Math.round(+v * n * 100) / 100));
  const passiveDetail = (box, id) => {
    const d = ED.PASSIVES[id];
    head(box, d.icon, L(d.name), T('Passive, max level {0}', d.max), d.lines ? '' : L(d.txt));
    if (d.lines) lvls(box, d.lines.map((t, i) => [T('Lv {0}', i + 1), L(t)]));
    else lvls(box, [[T('Each'), L(d.txt)], [T('Lv {0}', d.max), L(scaled(d.txt, d.max))]]);
  };

  // Foe appearances: { id: [{ stage, min }] } from the stage timelines and flocks; split children inherit the parent's.
  const appearances = () => {
    const out = {}, pr = App().profile;
    const add = (id, i, m) => { const a = out[id] || (out[id] = []); const e = a.find(x => x.stage === i); if (!e) a.push({ stage: i, min: m }); else e.min = Math.min(e.min, m); };
    ED.STAGES.forEach((sd, i) => { if (SV.stageHidden(pr, i)) return; sd.timeline.forEach((row, m) => { for (const r of row.roster) if (r[1] > 0) add(r[0], i, m); }); const fl = sd.events && sd.events.flock; if (fl) add(fl.id, i, Math.floor(fl.first / 60)); });
    for (const id in out) { const sp = ED.FOES[id] && ED.FOES[id].split; if (sp) for (const a of out[id]) add(sp.id, a.stage, a.min); }
    return out;
  };
  // Foe kind: [label, line] by ai ('swarm' with solo: a lone chaser).
  const kindOf = (d) => {
    switch (d.ai === 'swarm' && d.solo ? 'solo' : d.ai) {
      case 'chaser': return [T('Chaser'), T('Walks straight at you')];
      case 'swarm': return [T('Swarmer'), T('Fast and weak; flocks fly straight past you')];
      case 'solo': return [T('Swarmer'), T('Fast and weak, chases you')];
      case 'brute': return [T('Brute'), T('Slow and tough, a telegraphed slam')];
      case 'ranged': return [T('Ranged'), T('Stops at range and shoots')];
      case 'exploder': return [T('Exploder'), T('Bursts after a short fuse')];
      case 'charger': return [T('Charger'), T('A short telegraphed dash, then a pause')];
      case 'diver': return [T('Diver'), T('Closes in, then a telegraphed dive and a pause')];
    }
    return ['', ''];
  };
  const shotLine = (s) => (s.lob ? T('Lobs a blast at your spot ({0} damage) every {1} s', s.dmg, s.cd) : s.spread === 'ring' ? T('Shoots a ring of {0} bolts ({1} damage) every {2} s', s.n, s.dmg, s.cd)
    : s.n > 1 ? T('Shoots a stream of {0} bolts ({1} damage) every {2} s', s.n, s.dmg, s.cd) : T('Shoots a bolt ({0} damage) every {1} s', s.dmg, s.cd));
  const foeDetail = (box, id) => {
    const d = ED.FOES[id], ap = appearances()[id] || [], kind = kindOf(d);
    head(box, foeIcon(id), L(d.name), d.split ? T('Splitter') : kind[0], d.split ? T('Splits when it dies') : kind[1]);
    chips(box, [[T('HP'), d.hp], [T('Speed'), d.spd], [T('XP'), d.xp], d.kb === 0 ? [T('Knockback'), T('immune')] : null]);
    const out = [];
    if (d.split && ED.FOES[d.split.id]) out.push(T('Splits into {0}-{1} {2}', d.split.n[0], d.split.n[1], L(ED.FOES[d.split.id].name)));
    if (d.shot) out.push(shotLine(d.shot));
    if (d.boom) out.push(T('Bursts after {0} s: {1} damage', d.fuse, d.boom.dmg));
    if (d.slam) out.push(d.slam.ring ? T('Slam: {0}x contact damage every {1} s, plus a ring of {2} shots', d.slam.mul, d.slam.cd, d.slam.ring.n) : T('Slam: {0}x contact damage every {1} s', d.slam.mul, d.slam.cd));
    if (d.charge) out.push(T('Dashes at you every {0} s', d.charge.cd));
    if (d.dive) out.push(T('Dives at you every {0} s', d.dive.cd));
    if (d.pack) out.push(T('Packs of {0}-{1}', d.pack[0], d.pack[1]));
    for (const t of out) para(box, t);
    para(box, T('HP shown at 0:00 solo; it grows every minute.'), 'mut');
    if (ap.length) { h3(box, T('Appears in')); for (const a of ap) para(box, T('{0} from {1}', L(ED.STAGES[a.stage].name), U.fmtTime(a.min * 60))); }
  };

  // Boss pattern lines (one per phase), mirrored from the src/sim/boss-*.js headers.
  const BOSS_TXT = {
    warden: () => [T('Strings of sword swings end in a slam that leaves him stuck: punish him then'), T('66%: longer strings, lunges, a ring of bone shards, bone waves'), T('33%: spectral swords fall on warned lines through every hero')],
    twins: () => [T('The Lancer thrusts and sweeps; the Hammer slams, leaps and quakes'), T('Together they pull you in or web the ground, then the Hammer lands there'), T('A fallen twin rises again unless both fall together')],
    hollow: () => [T('Three-swing combo, a crown thrown out and back, blink and cleave'), T('66%: three crown shards orbit him, three crowns per throw, skull novas'), T('33%: a second shard ring, double blinks, starfall on every hero')],
    spore: () => [T('Rooted; grows a slowing, poisonous spore carpet around her and four pods'), T('Kill a pod to clear the carpet around it; lashes and spore rings'), T('33%: she uproots and walks after you, bursts spiral')],
    cyclops: () => [T('Eye laser sweep (walls block it), stomp shockwaves, leap slam with a fire ring'), T('66%: the laser sweeps back, double stomps, fire volleys'), T('33%: three lasers, triple stomps, spider adds')],
    king: () => [T('Tidal beam sweep (walls block it), trident fan, leap slam, adds'), T('66%: two opposite beams, five tridents, a pulling whirlpool'), T('33%: a whirlpool follows him, the beams turn half a circle')],
    samurai: () => [T('Dash slash along a warned lane, sword waves, a screen-long iaido cut'), T('66%: double dashes, five waves'), T('33%: triple dashes, a crossed iaido, spin slashes')],
    weaver: () => [T('Rift gates open into portals that shoot; threads cross your spot; blink with a bolt ring'), T('66%: three gates, threads stay as strands, adds'), T('33%: four gates firing faster, four threads per weave')],
    wickeater: () => [T('Devour: a warned cone drags you toward its bite'), T('Closing dark: a shrinking ring, walk through its gap or dash'), T('Lash fans and spiralling orb blooms; it swells at 33%')],
    wickmother: () => [T('Her heart is warded: break both wax hands at once and she kneels, heart exposed'), T('70%: the room darkens; light all four sconces at once to make her kneel'), T('35%: no ward; slay her before the great wick burns out and the flame floods the room')],
  };
  const bossOf = (key) => { const [si, bi] = key.split(':').map(Number); return ED.STAGES[si].bosses[bi]; }; // 'stage:index' -> stage boss row { id, t, final }
  const bossDetail = (box, key) => {
    const [si, bi] = key.split(':').map(Number), sd = ED.STAGES[si], b = sd.bosses[bi], d = ED.FOES[b.id];
    head(box, foeIcon(b.id), L(d.name), b.final ? T('Final boss, {0} at {1}', L(sd.name), U.fmtTime(b.t)) : T('Mid-boss, {0} at {1}', L(sd.name), U.fmtTime(b.t)), '');
    chips(box, [[T('HP'), T('{0} solo', U.fmtNum(ED.bossHp(b.t, (sd.foe && sd.foe.hp) || 1)))], [T('Speed'), d.spd]]);
    h3(box, T('Attacks'));
    lvls(box, (BOSS_TXT[b.id] ? BOSS_TXT[b.id]() : []).map((t, i) => [String(i + 1), t]));
    para(box, T('Every attack is telegraphed: a red outline marks where it lands.'), 'mut');
    para(box, b.sanctum ? T('Fought alone in the Sanctum: every other foe is gone. Beat it to win the stage.') : b.final ? T('Beat it to win the stage. Still alive at {0}, it enrages: x3 damage and speed.', U.fmtTime(ED.CONST.ENRAGE_T))
      : T('Drops a chest: pick a Form for a ready weapon (from the 10:00 boss on), else a path, else an extra level-up.'));
    para(box, T('HP grows with the party size.'), 'mut');
  };
  const stageDetail = (box, i) => {
    const sd = ED.STAGES[i], p = App().profile, open = SV.stageUnlocked(p, i), rule = ED.UNLOCKS.stages[i] || {}, best = p.best[sd.id];
    const pv = UI.stagePreview(i); pv.classList.add('cx-prev'); if (!open) pv.classList.add('locked'); box.appendChild(pv);
    box.appendChild(div('cx-title', `<span class="cx-name">${i + 1}. ${esc(L(sd.name))}</span><span class="cx-tag">${openTag(rule, open)}</span>` + (sd.blurb ? `<span class="cx-txt">${esc(L(sd.blurb))}</span>` : '')));
    if (!open) lockLine(box, p, rule);
    chips(box, [[T('Foe HP'), 'x' + sd.foe.hp], [T('Foe damage'), 'x' + sd.foe.dmg]]);
    h3(box, T('Bosses'));
    for (const b of sd.bosses) if (ED.FOES[b.id]) { const on = seen('foes', b.id), r = ref(box, foeIcon(b.id), on ? L(ED.FOES[b.id].name) : '???', b.final ? T('{0}, final boss', U.fmtTime(b.t)) : U.fmtTime(b.t)); if (!on) r.classList.add('unseen'); }
    const fl = sd.events && sd.events.flock, ev = sd.events && sd.events.swarm;
    if (fl && ED.FOES[fl.id]) para(box, T('{0} flocks every {1} s from {2}, flying past', L(ED.FOES[fl.id].name), fl.every, U.fmtTime(fl.first)));
    if (ev) para(box, T('Swarm wave every {0} s from {1}', ev.every, U.fmtTime(ev.first)));
    if (sd.elites) para(box, T('Elite every {0} s from {1}: it drops a chest', sd.elites.every, U.fmtTime(sd.elites.first)));
    para(box, !best ? T('Not played yet') : best.won ? T('Your best: {0}, {1} kills, level {2}, beaten', U.fmtTime(best.time), U.fmtNum(best.kills), best.level)
      : T('Your best: {0}, {1} kills, level {2}', U.fmtTime(best.time), U.fmtNum(best.kills), best.level), best && best.won ? 'ok' : 'mut');
    h3(box, T('Foes'));
    const ap = appearances(), ids = Object.keys(ap).filter(id => ap[id].some(a => a.stage === i)).sort((a, b) => ap[a].find(x => x.stage === i).min - ap[b].find(x => x.stage === i).min);
    const ro = div('cx-roster');
    for (const id of ids) { const s = document.createElement('span'), on = seen('foes', id); if (!on) s.className = 'unseen'; s.appendChild(UI.iconCanvas(foeIcon(id), 48)); s.insertAdjacentHTML('beforeend', esc(on ? L(ED.FOES[id].name) : '???')); ro.appendChild(s); }
    box.appendChild(ro);
  };

  // Unmet entry: silhouette icon, '???', 'Not discovered yet'; rule (a locked hero / stage) adds its unlock line and progress.
  const unseenDetail = (box, icon, rule) => {
    head(box, icon, '???', '', T('Not discovered yet'), { locked: true });
    if (rule) lockLine(box, App().profile, rule);
  };

  // ---------------- encyclopedia: tabs and lists ----------------
  // Entry: { key, icon, name, cls } or { sec } (a list heading); names and headings are display text (translated when the list is built). Tab: name() (display), kind (profile.seen list),
  //   seenId(key) (id in that list, default the key), hidden(box, key) (unmet entry).
  const TABS = [
    { id: 'heroes', name: () => T('Heroes'), kind: 'heroes', detail: heroDetail,
      hidden: (box, c) => unseenDetail(box, UI.heroIcon(c), SV.heroUnlocked(App().profile, c) ? null : ED.UNLOCKS.heroes[c] || {}), list: () => ED.HERO_IDS.filter(c => ED.HEROES[c]).map(c => ({ key: c, icon: UI.heroIcon(c), name: L(ED.HEROES[c].name), cls: SV.heroUnlocked(App().profile, c) ? '' : 'locked' })) },
    { id: 'weapons', name: () => T('Weapons'), kind: 'weapons', detail: weaponDetail, hidden: (box, id) => unseenDetail(box, ED.WEAPONS[id].icon), list: () => {
      const out = [];
      for (const cls of ED.HERO_IDS) {
        const h = ED.HEROES[cls], d = h && ED.WEAPONS[h.sig]; if (!d) continue;
        out.push({ sec: L(h.name) });
        out.push({ key: d.id, icon: d.icon, name: L(d.name), cls: '' });
        for (const f of ED.weaponForms(d.id)) { const e = ED.WEAPONS[f.id]; out.push({ key: e.id, icon: e.icon, name: L(e.name), cls: 'evo' }); }
      }
      const S = supportRoots();
      if (S.length) out.push({ sec: T('Supports') });
      for (const id of S) {
        const d = ED.WEAPONS[id];
        out.push({ key: id, icon: d.icon, name: L(d.name), cls: '' });
        for (const f of ED.weaponForms(id)) { const e = ED.WEAPONS[f.id]; out.push({ key: e.id, icon: e.icon, name: L(e.name), cls: 'evo' }); }
      }
      return out;
    } },
    { id: 'passives', name: () => T('Passives'), kind: 'passives', detail: passiveDetail, hidden: (box, id) => unseenDetail(box, ED.PASSIVES[id].icon), list: () => (ED.PASSIVE_IDS || Object.keys(ED.PASSIVES)).filter(id => ED.PASSIVES[id]).map(id => ({ key: id, icon: ED.PASSIVES[id].icon, name: L(ED.PASSIVES[id].name) })) },
    { id: 'foes', name: () => T('Foes'), kind: 'foes', detail: foeDetail, hidden: (box, id) => unseenDetail(box, foeIcon(id)), list: () => {
      const ap = appearances(), out = [];
      ED.STAGES.forEach((sd, i) => {
        const ids = Object.keys(ap).filter(id => ED.FOES[id] && !ED.FOES[id].boss && ap[id][0].stage === i).sort((a, b) => ap[a][0].min - ap[b][0].min || ED.FOES[a].idx - ED.FOES[b].idx);
        if (!ids.length) return;
        out.push({ sec: L(sd.name) });
        for (const id of ids) out.push({ key: id, icon: foeIcon(id), name: L(ED.FOES[id].name) });
      });
      return out;
    } },
    { id: 'bosses', name: () => T('Bosses'), kind: 'foes', seenId: (k) => bossOf(k).id, detail: bossDetail, hidden: (box, k) => unseenDetail(box, foeIcon(bossOf(k).id)), list: () => {
      const out = [];
      ED.STAGES.forEach((sd, i) => { if (SV.stageHidden(App().profile, i)) return; out.push({ sec: L(sd.name) }); (sd.bosses || []).forEach((b, j) => { if (ED.FOES[b.id]) out.push({ key: i + ':' + j, icon: foeIcon(b.id), name: L(ED.FOES[b.id].name), cls: b.final ? 'evo' : '' }); }); });
      return out;
    } },
    { id: 'stages', name: () => T('Stages'), kind: 'stages', seenId: (k) => ED.STAGE_IDS[+k], detail: (box, k) => stageDetail(box, +k),
      hidden: (box, k) => unseenDetail(box, stageIcon(+k), SV.stageUnlocked(App().profile, +k) ? null : ED.UNLOCKS.stages[+k] || {}), list: () => ED.STAGES.map((sd, i) => ({ key: String(i), icon: stageIcon(i), name: (i + 1) + '. ' + L(sd.name), cls: SV.stageUnlocked(App().profile, i) ? '' : 'locked' })).filter(r => !SV.stageHidden(App().profile, +r.key)) },
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
      b.className = 'btn btn-sm' + (on ? ' on' : ''); b.textContent = t.name(); b.dataset.tab = t.id;
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
