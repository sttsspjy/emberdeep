// Event rooms (StS "?" rooms): the host draws an event room's identity when the party first enters it (or a map outcome reveals it) from the stratum's text events, the shared pool and ED.MINIGAMES,
// minus the events seen this run; floor gen stays pure. Text events run a host-side dialog (personal: each hero chooses once; party: a vote); minigames run their own def hooks.
// Def: { id, name, kind: 'text' | 'game' | 'shrine', strata: [s..] | null (shared), w, rare, req(w), icon, look (prop art kind), prompt, party, roll(rng, s, w) -> v, text(v, w, p),
//   choices: [{ label(v, w, p), note(v, w, p), req(w, p, v) (false: greyed out), go(w, p, v, rng) -> flavour text }], safe (choice index), bot(w, p, v) -> choice index } (text kinds);
//   minigames: start(w, room), interact(w, p, prop), update(w, dt), end(w), bot(w, p) -> a bot action { go, dir, stop, use: prop id, atk } (tools/sim.js botGame) or null.
// Host-only (World methods and ED.Events); every draw uses w.rng.
(function (ED) {
  'use strict';
  const U = ED.U, D = ED.Dungeon, W = ED.World.prototype;
  const E = ED.Events = {};
  E.RARE = 0.05; // share of event draws taken from the rare events (while any is left)
  E.VOTE_T = 15; // seconds a party vote stays open; a missing vote then counts as the safe choice
  E.LOCK = 0.6; // seconds the dialog's choices ignore input after it opens (client)

  // ---------------- registry ----------------
  const vals = (src) => (src ? Object.values(src) : []); // an id-keyed object or an array
  E.all = () => vals(ED.EVENTS).concat(vals(ED.MINIGAMES)).filter(d => d && d.id);
  E.def = (id) => (id ? (ED.EVENTS && ED.EVENTS[id] && ED.EVENTS[id].id === id ? ED.EVENTS[id] : E.all().find(d => d.id === id) || null) : null);
  // Run fields: evSeen (id -> 1), evFlags (chain flags), lore (ED.LORE indices found).
  E.run = (w) => { const r = w.run; if (!r.evSeen) { r.evSeen = {}; r.evFlags = {}; r.lore = []; } return r; };
  E.flag = (w, k) => { E.run(w).evFlags[k] = 1; };
  E.has = (w, k) => !!E.run(w).evFlags[k];

  // An event id for stratum s: a rare one with chance RARE, else a common one, by weight w, from the defs of stratum s or the shared pool that pass req and were not seen this run. Every one seen: any common, unchained one again.
  E.draw = (w, s) => {
    const run = E.run(w), fits = (d) => !run.evSeen[d.id] && (!d.strata || d.strata.indexOf(s) >= 0) && (!d.req || d.req(w));
    const pool = E.all().filter(fits), rare = pool.filter(d => d.rare), common = pool.filter(d => !d.rare), wt = (d) => d.w || 1;
    let d = rare.length && (!common.length || w.rng.chance(E.RARE)) ? w.rng.weighted(rare, wt) : common.length ? w.rng.weighted(common, wt) : null;
    if (!d) { const any = E.all().filter(x => !x.rare && !x.req && (!x.strata || x.strata.indexOf(s) >= 0)); d = any.length ? w.rng.weighted(any, wt) : null; }
    if (d) run.evSeen[d.id] = 1;
    return d ? d.id : null;
  };

  // ---------------- room patches (CB-3) ----------------
  // Patches an unvisited room ahead (not the start or the boss): patch ⊂ { type, reward, event, reveal }; reveal on an event room draws its identity now. The merged patch per room (w.patches) rides full snapshots (net.js RP). Returns true when applied.
  W.patchRoom = function (id, patch) {
    const fl = this.floor, r = fl && fl.rooms[id], rs = this.roomState[id];
    if (!r || !patch || (rs && rs.visited) || r.type === 'boss' || r.type === 'start') return false;
    const p = {};
    if (patch.type && D.RETYPE.indexOf(patch.type) >= 0 && patch.type !== r.type) p.type = patch.type;
    if ('reward' in patch) p.reward = patch.reward || null;
    if (patch.event && E.def(patch.event)) { p.event = patch.event; E.run(this).evSeen[patch.event] = 1; }
    if (patch.reveal) { p.reveal = 1; if (!p.event && (p.type || r.type) === 'event' && (p.type || !r.event)) p.event = E.draw(this, this.stratum) || undefined; if (!p.event) delete p.event; }
    if (!Object.keys(p).length) return false;
    this.setPatch(id, p);
    return true;
  };
  // Merges p into room id's patch (a new type starts the room over) and applies the merged patch.
  W.setPatch = function (id, p) {
    const all = this.patches || (this.patches = {}), m = Object.assign({}, all[id] || {});
    if (p.type) { delete m.reward; delete m.event; delete m.reveal; }
    Object.assign(m, p);
    all[id] = m;
    this.patchN = (this.patchN | 0) + 1;
    D.patchRoom(this.floor, id, m);
  };
  // Unvisited rooms reachable from the current room (its exits onward), nearest row first, never the boss.
  E.ahead = (w) => {
    const fl = w.floor, out = [], seen = new Set([w.roomId]), q = [w.roomId];
    while (q.length) { const r = fl.rooms[q.shift()]; for (const id of r.exits || []) if (!seen.has(id)) { seen.add(id); q.push(id); const n = fl.rooms[id]; if (n.type !== 'boss' && !w.roomState[id].visited) out.push(n); } }
    return out.sort((a, b) => a.row - b.row || a.lane - b.lane);
  };
  const TYPE_NAME = { rest: 'a rest site', shop: 'a shop', elite: 'an elite fight', treasure: 'a treasure room', event: 'an event', combat: 'a fight' };
  // Map outcome what on rooms ahead: 'reveal' (up to n unknown event rooms get their identity), 'gild' (up to n plain fights within 3 rows pay one step better), or a room type (up to n plain fights within 3 rows become it). Returns its line ('' when nothing changed).
  E.mapChange = (w, what, n) => {
    const room = w.room, ahead = E.ahead(w), near = ahead.filter(r => r.row <= room.row + 3);
    let k = 0;
    if (what === 'reveal') {
      for (const r of ahead) if (k < n && r.type === 'event' && !r.event && w.patchRoom(r.id, { reveal: 1 })) k++;
      return k ? `The map shows ${k} event room${k > 1 ? 's' : ''} ahead` : 'No unknown rooms lie ahead';
    }
    const plain = w.rng.shuffle(near.filter(r => r.type === 'combat' && !r.dark));
    if (what === 'gild') {
      for (const r of plain) { const up = ED.World.REWARD_UP[r.reward]; if (k < n && up && w.patchRoom(r.id, { reward: up })) k++; }
      return k ? `${k} fight${k > 1 ? 's' : ''} ahead pay${k > 1 ? '' : 's'} better` : '';
    }
    if (!TYPE_NAME[what]) return '';
    for (const r of plain) if (k < n && w.patchRoom(r.id, { type: what })) k++;
    return k ? `${k === 1 ? 'A fight' : k + ' fights'} ahead became ${TYPE_NAME[what]}` : '';
  };

  // ---------------- lore ----------------
  // A page index not found this run: kind 'rare' draws a rare page, else a page of the stratum (or of none); -1 when none is left. A number names the page.
  E.pickLore = (w, kind) => {
    const L = ED.LORE || [], got = E.run(w).lore;
    if (typeof kind === 'number') return kind >= 0 && kind < L.length && got.indexOf(kind) < 0 ? kind : -1;
    const free = L.map((pg, i) => i).filter(i => got.indexOf(i) < 0), rare = kind === 'rare';
    let pool = free.filter(i => !!L[i].rare === rare && (rare || !L[i].s || L[i].s === w.stratum));
    if (!pool.length) pool = free.filter(i => !L[i].rare);
    return pool.length ? w.rng.pick(pool) : -1;
  };

  // ---------------- outcomes (CB-4) ----------------
  E.col = null; // while a choice resolves: { lines, off: pid -> 1 (an offer was granted), lore: page index or -1 }
  const curses = () => ED.RELIC_IDS.filter(id => ED.RELICS[id].rar === 'curse');
  const relicName = (id) => (ED.RELICS[id] ? ED.RELICS[id].name : id);
  // Takes relic id from p (World.removeRelic when present).
  E.dropRelic = (w, p, id) => {
    if (w.removeRelic) return w.removeRelic(p, id);
    const i = p.relics.indexOf(id);
    if (i < 0) return false;
    p.relics.splice(i, 1); w.recalc(p, false); w.sendBuild(p);
    return true;
  };
  // Relics p holds that are not curses (curse: true for the curses only).
  E.relicsOf = (p, curse) => p.relics.filter(id => ED.RELICS[id] && (ED.RELICS[id].rar === 'curse') === !!curse);
  const RAR_UP = { c: 'r', r: 'e', e: 'l', l: 'l' };
  E.rarUp = (rar) => RAR_UP[rar] || 'r';
  const spot = (w) => { const pr = w.ev && w.props.find(x => x.id === w.ev.prop); return pr ? { x: pr.x, y: pr.y } : D.center(w.room); };
  const pct = (f) => Math.round(Math.abs(f) * 100) + '%';
  // Applies spec to hero p (null: every hero who is not dead; party-wide parts once) and returns the lines saying what happened (also gathered in E.col while a choice resolves).
  // spec ⊂ { gold: ±n (party gold, exact), heal: ±fraction of max health (never below 1), raise (the downed stand up), maxHp: ±n, offer: 'boon' | 'epic' | 'forge', offerN, removeRelic: true | 'curse' | id,
  //   relic: rarity (p: one relic; null: a hoard, one pick per hero), curse: true, lore: true | 'rare' | index, flag, map: 'reveal' | 'gild' | room type, mapN, fight: 'ambush' | 'elite', pay: spec paid when that fight is won }.
  E.outcome = (w, p, spec) => {
    const out = [];
    if (!spec) return out;
    const heroes = p ? [p] : [...w.players.values()].filter(q => !q.dead), at = spot(w);
    if (spec.gold > 0) { w.dropGold(at.x, at.y + 16, spec.gold, true); out.push(`+${spec.gold} gold`); }
    else if (spec.gold < 0) { const g = Math.min(w.gold, -spec.gold); w.gold -= g; out.push(`-${g} gold`); }
    if (spec.raise) for (const q of heroes) if (q.downed) { q.downed = false; q.revive = 0; q.hp = 1; w.emit({ t: 'revived', pid: q.pid, x: q.x, y: q.y }); }
    if (spec.heal > 0) { for (const q of heroes) w.healPlayer(q, q.maxHp * spec.heal); out.push(`Healed ${pct(spec.heal)} of max health`); }
    else if (spec.heal < 0) {
      for (const q of heroes) { if (q.downed || q.dead) continue; const d = Math.min(q.hp - 1, q.maxHp * -spec.heal); if (d > 0) { q.hp -= d; w.emit({ t: 'altar', pid: q.pid, x: Math.round(q.x), y: Math.round(q.y), v: Math.round(d) }); } }
      out.push(`Lost ${pct(spec.heal)} of max health`);
    }
    if (spec.maxHp) {
      for (const q of heroes) { const d = spec.maxHp < 0 ? Math.max(spec.maxHp, Math.min(0, 5 - q.maxHp)) : spec.maxHp; q.bonusHp += d; w.recalc(q, false); w.sendBuild(q); }
      out.push(`${spec.maxHp > 0 ? '+' : ''}${spec.maxHp} max health`);
    }
    if (spec.removeRelic) for (const q of heroes) {
      const own = typeof spec.removeRelic === 'string' && spec.removeRelic !== 'curse' ? q.relics.filter(id => id === spec.removeRelic) : E.relicsOf(q, spec.removeRelic === 'curse');
      if (!own.length) continue;
      const id = w.rng.pick(own);
      if (E.dropRelic(w, q, id)) out.push(`${heroes.length > 1 ? q.name + ' lost' : 'Lost'}: ${relicName(id)}`);
    }
    if (spec.relic) {
      if (p) { const id = w.rollRelic(spec.relic); w.giveRelic(p, id); out.push('Relic: ' + relicName(id)); }
      else { w.spawnRelicChoices(at.x, at.y + 46, spec.relic); out.push('A relic for each hero'); }
    }
    if (spec.curse) for (const q of heroes) {
      const pool = curses().filter(id => q.relics.indexOf(id) < 0);
      if (pool.length) { const id = w.rng.pick(pool); w.giveRelic(q, id); out.push(`${heroes.length > 1 ? q.name + ' is cursed' : 'Cursed'}: ${relicName(id)}`); }
      else { q.bonusHp -= 2; w.recalc(q, false); w.sendBuild(q); out.push(`${heroes.length > 1 ? q.name + ': a' : 'A'} curse settles in: -2 max health`); }
    }
    if (spec.offer) {
      const n = spec.offerN || 1;
      for (const q of heroes) { for (let i = 0; i < n; i++) w.grantOffer(q, { src: spec.offer === 'boon' ? 'room' : spec.offer }); if (E.col) E.col.off[q.pid] = 1; }
      out.push((n > 1 ? n + ' ' : '') + (spec.offer === 'epic' ? 'epic boon' : spec.offer === 'forge' ? 'forge' : 'boon') + (n > 1 ? ' offers' : spec.offer === 'forge' ? ': rank up a boon' : ' offer') + (heroes.length > 1 ? ' for each hero' : ''));
    }
    if (spec.lore !== undefined && spec.lore !== false) {
      const i = E.pickLore(w, spec.lore);
      if (i >= 0) { E.run(w).lore.push(i); w.emit({ t: 'lore', i }); out.push(`Lore page: ${ED.LORE[i].title}`); if (E.col) E.col.lore = i; }
    }
    if (spec.flag) E.flag(w, spec.flag);
    if (spec.map) { const l = E.mapChange(w, spec.map, spec.mapN || 1); if (l) out.push(l); }
    if (spec.fight) { w.eventFight(spec.fight, spec.pay || null); out.push(spec.fight === 'elite' ? 'Elites attack!' : 'An ambush!'); }
    if (E.col) for (const l of out) E.col.lines.push(l);
    return out;
  };

  // ---------------- fights ----------------
  // An event fight in the current room: 'elite' = two waves led by an elite (the Champion's Trial), 'ambush' = two waves of the stratum's foes (the second with an elite from stratum II).
  // The room locks; when the last foe falls the fight pays embers (elite 4 + s, ambush 1 + s) and the pay spec to the party (fightDone).
  W.eventFight = function (kind, pay) {
    const s = this.stratum, biome = ED.biomeFor(s), n = this.partySize();
    const roster = biome.enemies.filter(r => { const d = ED.ENEMIES[r[0]]; return d && !d.boss && !d.ally && !d.minion && !d.fodder; });
    const w1 = [], w2 = [];
    if (kind === 'elite') {
      w1.push({ type: biome.elite, elite: true }); w2.push({ type: biome.elite, elite: true });
      for (let i = 0; i < 2 + n; i++) w1.push({ type: roster[i % roster.length][0] });
      for (let i = 0; i < 3 + n; i++) w2.push({ type: roster[(i + 1) % roster.length][0], elite: i === 0 });
    } else {
      for (let i = 0; i < 2 + n; i++) w1.push({ type: this.rng.weighted(roster, r => r[1])[0] });
      for (let i = 0; i < 3 + n; i++) w2.push({ type: this.rng.weighted(roster, r => r[1])[0], elite: i === 0 && s >= 2 });
    }
    E.closeAll(this);
    this.locked = true;
    this.enc = { kind: 'trial', waves: [w1, w2], wave: -1, t: 1, pay, embers: kind === 'elite' ? 4 + s : 1 + s };
    this.emit({ t: 'lock' });
  };
  // A won event fight (rooms.js updateEncounter): its embers, then its pay to the party, told to every hero.
  E.fightDone = (w, enc) => {
    w.run.embers.elites += enc.embers | 0;
    if (!enc.pay) return;
    const lines = E.outcome(w, null, enc.pay);
    if (lines.length) for (const q of w.players.values()) w.msgs.push({ to: q.pid, t: 'toast', text: lines.join(' · '), info: 1 });
  };

  // ---------------- the event of a room ----------------
  // First entry of an event room (world.js enterRoom): its identity (drawn now unless revealed), w.ev, then the def's start (minigames) or the text event's prop.
  W.startEvent = function (room, rs) {
    rs.evOn = 1;
    const id = room.event || E.draw(this, this.stratum), def = E.def(id);
    if (!def) return;
    if (room.event !== id) this.setPatch(room.id, { event: id });
    this.ev = { id, room: room.id, def, v: null, prop: 0, key: 0, done: {}, dlg: {}, vote: null, game: null };
    if (def.start) def.start(this, room);
    else {
      const c = D.center(room), pr = { id: U.uid(), kind: def.look || 'altar', ev: def.id, x: c.x, y: c.y, state: 0, group: U.uid(), text: def.prompt || 'Examine: ' + def.name };
      this.ev.v = def.roll ? def.roll(this.rng, this.stratum, this) || {} : {};
      this.ev.prop = pr.id;
      this.props.push(pr);
    }
  };
  // Leaving the room: open dialogs close on their heroes' screens; the def's end hook runs.
  W.endEvent = function () {
    const ev = this.ev;
    this.ev = null;
    if (!ev) return;
    E.closeAll(this, ev);
    if (ev.def && ev.def.end) ev.def.end(this, ev);
  };
  // Closes every open dialog and vote of the event (ev, default the current one) on its heroes' screens.
  E.closeAll = (w, ev) => {
    ev = ev || w.ev;
    if (!ev) return;
    const to = new Set(Object.keys(ev.dlg));
    if (ev.vote) for (const pid of ev.vote.pids) to.add(pid);
    for (const pid of to) w.msgs.push({ to: pid, t: 'evClose' });
    ev.dlg = {}; ev.vote = null;
  };
  W.updateEvent = function (dt) {
    const ev = this.ev;
    if (ev.vote) {
      const vt = ev.vote;
      vt.t -= dt;
      const live = vt.pids.filter(pid => { const q = this.players.get(pid); return q && !q.dead; });
      if (vt.t <= 0 || live.every(pid => pid in vt.votes)) E.resolveVote(this);
    }
    if (this.ev && this.ev.def && this.ev.def.update) this.ev.def.update(this, dt);
  };

  // ---------------- dialogs ----------------
  const str = (f, v, w, p) => (typeof f === 'function' ? f(v, w, p) : f || '');
  // A dialog spec of text def for hero p (null: the party): { title, text, ch: [[label, note, disabled]], safe, go(w, p, i) -> flavour, bot(w, p) -> i }.
  const textSpec = (w, def, p) => {
    const v = w.ev.v;
    return {
      title: def.name, text: str(def.text, v, w, p), safe: def.safe | 0,
      ch: def.choices.map(c => [str(c.label, v, w, p), str(c.note, v, w, p), c.req && !c.req(w, p, v) ? 1 : 0]),
      go: (w2, q, i) => def.choices[i].go(w2, q, w2.ev ? w2.ev.v : v, w2.rng) || '',
      bot: def.bot ? (w2, q) => def.bot(w2, q, v) : null,
    };
  };
  const openMsg = (pid, d, vote) => ({ to: pid, t: 'evOpen', k: d.k, title: d.title, text: d.text, ch: d.ch, s: d.safe | 0, v: vote ? Math.round(vote.t) : 0, n: vote ? vote.pids.length : 1, lock: E.LOCK });
  // Opens dialog spec for hero p (personal) or, with p null, a party vote of every living hero. Exposed for minigames (ED.Events.ask); prop: the prop id the choice consumes (its state turns 1 when everyone is done).
  E.ask = (w, p, spec, prop) => {
    const ev = w.ev;
    if (!ev) return false;
    const d = Object.assign({ k: ++ev.key, prop: prop || 0 }, spec);
    if (p) { ev.dlg[p.pid] = d; w.msgs.push(openMsg(p.pid, d)); return true; }
    const pids = w.alivePlayers().map(q => q.pid);
    if (!pids.length) return false;
    ev.vote = Object.assign(d, { pids, votes: {}, t: E.VOTE_T });
    for (const pid of pids) w.msgs.push(openMsg(pid, d, ev.vote));
    return true;
  };
  // A hero interacts with an event prop (rooms.js interact): a minigame def takes it; a text event opens the hero's dialog or the party vote (a vote already open shows again to a voter who has not voted).
  W.evInteract = function (p, pr) {
    const ev = this.ev, def = ev && E.def(pr.ev);
    if (!def || ev.room !== this.roomId) return;
    if (def.interact) { def.interact(this, p, pr); return; }
    if (!def.choices) return;
    const vt = ev.vote;
    if (vt) { if (vt.pids.indexOf(p.pid) >= 0 && !(p.pid in vt.votes)) this.msgs.push(openMsg(p.pid, vt, vt)); return; }
    if (ev.done[p.pid] || ev.dlg[p.pid]) { if (ev.done[p.pid]) this.msgs.push({ to: p.pid, t: 'toast', text: 'You have made your choice here.' }); else this.msgs.push(openMsg(p.pid, ev.dlg[p.pid])); return; }
    const spec = textSpec(this, def, def.party ? null : p);
    spec.group = pr.group;
    E.ask(this, def.party ? null : p, spec, pr.id);
  };
  // Runs choice i of dialog d for hero p (null: the party) and sends the result to pids: { k, title, text (flavour), out (outcome lines), lp (lore page or -1), o (1: an offer opens, the dialog closes itself) }.
  const resolve = (w, d, p, i, pids, head) => {
    E.col = { lines: [], off: {}, lore: -1 };
    let text = '';
    try { text = d.go(w, p, i) || ''; } finally { const c = E.col; E.col = null; d.res = c; }
    const c = d.res, ev = w.ev;
    for (const pid of pids) w.msgs.push({ to: pid, t: 'evResult', k: d.k, title: d.title, text: (head ? head + '\n' : '') + text, out: c.lines, lp: c.lore, o: c.off[pid] ? 1 : 0 });
    if (ev) for (const pid of pids) { ev.done[pid] = 1; const q = w.players.get(pid); if (q && d.group) { q.claimed[d.group] = true; w.msgs.push({ to: pid, t: 'claimed', group: d.group }); } }
    const pr = d.prop && w.props.find(x => x.id === d.prop);
    if (pr && ev && [...w.players.values()].every(q => q.dead || ev.done[q.pid])) pr.state = 1;
  };
  // A vote closes: the choice most heroes voted (a missing vote counts as the safe choice); a tie goes to the host's vote (slot 0), else the safe choice when tied, else the first tied.
  E.resolveVote = (w) => {
    const ev = w.ev, vt = ev.vote;
    ev.vote = null;
    const n = vt.ch.length, cnt = new Array(n).fill(0), pick = (pid) => (pid in vt.votes ? vt.votes[pid] : vt.safe);
    for (const pid of vt.pids) cnt[pick(pid)]++;
    const top = Math.max(...cnt), tied = cnt.map((c, i) => i).filter(i => cnt[i] === top);
    const host = [...w.players.values()].find(q => q.slot === 0), hv = host && vt.pids.indexOf(host.pid) >= 0 ? pick(host.pid) : -1;
    const i = tied.length === 1 ? tied[0] : tied.indexOf(hv) >= 0 ? hv : tied.indexOf(vt.safe) >= 0 ? vt.safe : tied[0];
    const pids = vt.pids.filter(pid => w.players.has(pid));
    resolve(w, vt, null, i, pids, vt.pids.length > 1 ? `The party chose: ${vt.ch[i][0]} (${cnt[i]}/${vt.pids.length})` : '');
    for (const q of w.players.values()) ev.done[q.pid] = 1;
    const pr = vt.prop && w.props.find(x => x.id === vt.prop);
    if (pr) pr.state = 1;
  };
  // A choice from hero pid for dialog key k (game.js 'evChoice'): a vote (others are told the tally) or the hero's own dialog. Disabled or stale choices are ignored.
  W.evChoice = function (pid, i, k) {
    const ev = this.ev, p = this.players.get(pid);
    if (!ev || !p) return;
    const vt = ev.vote;
    if (vt && vt.k === k) {
      if (vt.pids.indexOf(pid) < 0 || pid in vt.votes || !(i >= 0 && i < vt.ch.length) || vt.ch[i][2]) return;
      vt.votes[pid] = i;
      const cnt = vt.ch.map(() => 0);
      for (const q in vt.votes) cnt[vt.votes[q]]++;
      for (const q of vt.pids) this.msgs.push({ to: q, t: 'evTally', k, n: cnt });
      return;
    }
    const d = ev.dlg[pid];
    if (!d || d.k !== k || !(i >= 0 && i < d.ch.length) || d.ch[i][2]) return;
    delete ev.dlg[pid];
    resolve(this, d, p, i, [pid]);
  };

  // ---------------- bots (tools/sim.js) ----------------
  // Score of walking to event prop pr for bot hero p: 6 while the hero has a choice to make there (minigames: when def.bot's action uses that prop), else 0.
  E.botWant = (w, p, pr) => {
    const ev = w.ev, def = ev && E.def(pr.ev);
    if (!def || pr.state) return 0;
    if (def.interact) { const t = def.bot ? def.bot(w, p) : null; return t && t.use === pr.id ? 6 : 0; }
    if (ev.vote) return 0;
    return ev.done[p.pid] ? 0 : 6;
  };
  // Answers the open dialog or vote of bot hero p (def.bot, else the safe choice; a disabled pick falls back to safe). Returns true when it answered.
  E.botAnswer = (w, p) => {
    const ev = w.ev;
    if (!ev) return false;
    const vt = ev.vote, d = vt && vt.pids.indexOf(p.pid) >= 0 && !(p.pid in vt.votes) ? vt : ev.dlg[p.pid];
    if (!d) return false;
    let i = d.bot ? d.bot(w, p) : d.safe;
    if (!(i >= 0 && i < d.ch.length) || d.ch[i][2]) i = d.safe;
    w.evChoice(p.pid, i, d.k);
    return true;
  };
})(globalThis.ED || (globalThis.ED = {}));
