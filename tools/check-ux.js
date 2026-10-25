// Usage: node tools/check-ux.js
// Headless checks of player-facing text and layout data: the tutorial signs near the spawn, no developer units or stale fixed multipliers in card texts, the Doom/Toll wording,
// Shield Storm and Comet in the sheet model, the Sundered status, the floor-map glyph table and route bits (src/client/icons.js), the offer lock gates (src/client/ui.js). Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

// ---------------- tutorial signs: the aim sign is the one nearest the solo spawn ----------------
{
  const w = new ED.World({ seed: 5, pact: 0, tutorial: true, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'knight', weapon: 'longsword', meta: META() }] });
  w.startRun();
  const me = w.players.get('p0'), signs = w.props.filter(q => q.kind === 'sign').map(q => ({ text: q.text, d: Math.hypot(q.x - me.x, q.y - me.y) })).sort((a, b) => a.d - b.d);
  ok(signs.length === 5, 'five tutorial signs: ' + signs.length);
  ok(/^Aim with \{aim\}/.test(signs[0].text) && signs[0].d <= 90, 'the sign within reach of the spawn is the mouse-aim sign: ' + signs[0].text.slice(0, 30) + ' at ' + Math.round(signs[0].d) + ' px');
  ok(signs.slice(1).every(s => s.d > 0), 'the other signs stand apart');
  const last = signs.find(s => /\{map\}/.test(s.text));
  ok(last && /\{map\} opens your build/.test(last.text) && !/shows the map/.test(last.text), 'the map sign names the sheet: ' + (last && last.text));
}

// ---------------- card and skill texts ----------------
{
  const texts = [];
  const add = (src, t) => { if (t) texts.push([src, String(t)]); };
  const st = ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 });
  for (const id in ED.BOONS) for (let r = 1; r <= (ED.BOONS[id].max || 1); r++) add(id + ' r' + r, ED.Sheet.text(id, r, st)); // route cards at rank 3 include their rider
  for (const id in ED.SKILLS) add('skill ' + id, ED.SKILLS[id].desc);
  for (const id in ED.WEAPONS) add('weapon ' + id, ED.WEAPONS[id].desc);
  for (const id in ED.RELICS) add('relic ' + id, ED.RELICS[id].desc);
  for (const id in ED.STATUS) add('status ' + id, ED.STATUS[id].rule);
  for (const u of ED.UPGRADES) { add('upgrade ' + u.id, u.step); add('upgrade ' + u.id + ' desc', typeof u.desc === 'function' ? u.desc(1) : u.desc); }
  for (const [src, t] of texts) {
    ok(!/±|\brad\b/.test(t), `${src}: no angles in radians: ${t.slice(0, 80)}`);
    ok(!/\(r\d|\br \d/.test(t), `${src}: radii read "radius N": ${t.slice(0, 80)}`);
    if (!/_atk_[hs] r\d/.test(src)) ok(!/×1\.98|×0\.605|×1\.8\b|×0\.55\b/.test(t), `${src}: no fixed fork multipliers (the weapon clamps them): ${t.slice(0, 80)}`); // fork cards print their own weapon's factors (check-sim)
    ok(!/Skill recharges/.test(t), `${src}: "Skills recharge": ${t.slice(0, 80)}`);
    ok(!/\{|\}|\[|\]/.test(t), `${src}: no left-over token: ${t.slice(0, 80)}`);
  }
  ok(/never Reaped/.test(ED.BOONS.doommark.desc) && /Tolls/.test(ED.BOONS.doommark.desc) && /never Reaped/.test(ED.STATUS.doom.rule), 'Doom: a boss is never Reaped, it Tolls');
  ok(/Open boons can rank 1 higher/.test(ED.BOONS.generalist.desc) && /Your Backstabs mark 20% more Doom/.test(ED.Sheet.text('souljar', 1, st)) && /Your Backstabs mark 40% more Doom/.test(ED.Sheet.text('souljar', 2, st)), 'Generalist and Soul Jar wording');
  ok(/foes inside take Holy damage/.test(ED.SKILLS.sanctuary.desc) && !/burn/i.test(ED.SKILLS.sanctuary.desc), 'Sanctuary does not burn');
  ok(/does not stack with other \+20% vulnerabilities/.test(ED.boonText('r_s2_b', 1, null)) && !/Judged/.test(ED.boonText('r_s2_b', 1, null)), 'Hail of Thorns does not lean on the Cleric term');
  ok(/Crush/.test(ED.SKILLS.charge.desc) && /never stunned/.test(ED.SKILLS.shieldthrow.desc), 'Shield Charge and Shield Throw name Crush and the boss rule');
  ok(/class shields are limited to 3% of max health per 10 s/.test(ED.WEAPONS.lantern.desc) && !/once per 1\.5s each/.test(ED.WEAPONS.lantern.desc), 'Sacred Lantern names the class-shield window');
  ok(ED.boonText('r_el_b', 2, null).indexOf('within 120') >= 0 && ED.boonText('r_el_b', 1, null).indexOf('within 100') >= 0, 'Contagion shows its total radius per rank');
}

// ---------------- sheet: statuses and the model of the two fork effects ----------------
{
  ok(ED.STATUS.sundered && ED.STATUS.sundered.name === 'Sundered' && ED.STATUS.sundered.color !== ED.STATUS.marked.color, 'ED.STATUS.sundered exists apart from Marked');
  const model = (cls, boons) => {
    const b = { cls, weapon: ED.CLASSES[cls].weapons[0], boons, relics: [], meta: META(), pact: 0 }, stats = ED.Stats.compute(b);
    stats.sn = {};
    const p = { pid: 'p', name: 'T', cls, weapon: b.weapon, boons, relics: [], meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 };
    return ED.Sheet.compute(p, ED.Sheet.ctx ? ED.Sheet.ctx({ stratum: 1, pact: 0, players: new Map(), allies: [] }, p) : {}, { raw: true });
  };
  const sunder = model('shade', { sunder: 1 }).mult.debuffs.find(d => /Sunder|critical hit/.test(d.text));
  ok(sunder && sunder.id === 'sundered' && sunder.name === 'Sundered', 'Sunder files under Sundered, not Marked: ' + (sunder && sunder.id));
  const part = (m, s, id) => m.skills[s].parts.find(q => q.id === id);
  const k0 = model('knight', { k_s2: 1 }), k1 = model('knight', { k_s2: 1, k_s2_a: 1 });
  ok(Math.abs(part(k1, 1, 'strike').raw - 0.7 * part(k0, 1, 'strike').raw) < 1e-6 && part(k1, 1, 'strike').oneFoe === 2, 'Shield Storm: two shields at 70% each in the strike part');
  ok(k1.skills[1].perCast > k0.skills[1].perCast * 1.2, 'Shield Storm raises the Shield Throw per cast: ' + k0.skills[1].perCast.toFixed(1) + ' -> ' + k1.skills[1].perCast.toFixed(1));
  const m0 = model('pyro', { p_s2: 1 }), m3 = model('pyro', { p_s2: 1, p_s2_b: 3 });
  ok(Math.abs(part(m3, 1, 'impact').raw / part(m0, 1, 'impact').raw - 1.2 * 1.4 * 0.8) < 1e-6, 'Sun Dive (Comet rank 3): the impact part is the mean of the two landings (+20% each, the second at 60%) and the card Meteor damage +40%: x1.344: ' + (part(m3, 1, 'impact').raw / part(m0, 1, 'impact').raw).toFixed(3));
  ok(part(m3, 1, 'impact').oneFoe === 2 && part(m0, 1, 'impact').oneFoe === 1, 'Sun Dive lands twice: the impact part counts two hits on one foe');
  ok(part(model('knight', {}), 1, 'strike').r === 0 && part(model('knight', {}), 1, 'return').r === 0, 'projectile hit radii stay out of the sheet parts');
}

// ---------------- dash charges: the shared constant, the stat block, the sheet row and the charge model of Sim.dashTick / Sim.dashTry ----------------
{
  const D = ED.CONST.DASH, S = ED.Sim;
  ok(D.t === 0.15 && D.speed === 480, 'ED.CONST.DASH is 0.15 s at 480 px/s: ' + JSON.stringify(D));
  const base = { cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 };
  const st0 = ED.Stats.compute(base);
  ok(st0.dashCd === 1.5 && st0.dashCharges === 1, 'a fresh hero has 1 dash charge, 1.5 s each: ' + st0.dashCd + ' / ' + st0.dashCharges);
  { // Light Step: +1 charge per rank; Shadow Cloak leaves the dash alone; the recharge floors at 1.0 s and the charges cap at 3
    const dash = (boons, relics) => { const s = ED.Stats.compute(Object.assign({}, base, { boons, relics: relics || [] })); return s.dashCharges + ' / ' + s.dashCd; };
    ok(dash({ lightstep: 1 }) === '2 / 1.5' && dash({ lightstep: 2 }) === '3 / 1.5', 'Light Step: ranks 1 and 2 give 2 and 3 charges, recharge unchanged: ' + dash({ lightstep: 1 }) + ', ' + dash({ lightstep: 2 }));
    ok(dash({}, ['cloak']) === '1 / 1.5' && dash({ lightstep: 2 }, ['cloak']) === '3 / 1.5', 'Shadow Cloak grants no dash charge or recharge: ' + dash({}, ['cloak']) + ', ' + dash({ lightstep: 2 }, ['cloak']));
    ED.RELICS.zzdash = { name: 'T', rar: 'c', icon: 'coin', desc: '', mods: { dashcdr: 0.9 } };
    ok(dash({ lightstep: 5 }, ['zzdash']) === '3 / 1', 'the recharge floors at 1.0 s and the charges cap at 3: ' + dash({ lightstep: 5 }, ['zzdash']));
    delete ED.RELICS.zzdash;
    ok(ED.Sheet.text('lightstep', 1) === 'Dash: +1 charge.' && ED.Sheet.text('lightstep', 2) === 'Dash: +2 charges.' && ED.Sheet.nextText('lightstep', 1) === '+2 charges' && ED.Sheet.STAT_INFO.dashN.label === 'Dash charges' && ED.Sheet.STAT_INFO.dashcdr.label === 'Dash recharge', 'Light Step card text and the sheet labels: ' + ED.Sheet.text('lightstep', 2));
  }
  const stats = ED.Stats.compute(base); stats.sn = {};
  const p = { pid: 'p', name: 'T', cls: 'knight', weapon: base.weapon, boons: {}, relics: [], meta: base.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 };
  const sh = ED.Sheet.compute(p, ED.Sheet.ctx ? ED.Sheet.ctx({ stratum: 1, pact: 0, players: new Map(), allies: [] }, p) : {}, { raw: true }).dash;
  ok(sh.cd === 1.5 && sh.charges === 1 && sh.ifr === D.t, 'sheet dash row: recharge per charge, charges, i-frame seconds: ' + JSON.stringify({ cd: sh.cd, charges: sh.charges, ifr: sh.ifr }));
  const run = (c, st, secs) => { let r = 0; for (let i = Math.round(secs / 0.01); i > 0; i--) r += S.dashTick(c, st, 0.01); return r; };
  const mk = (cap) => ({ c: { dashN: cap, dashT: 0 }, st: { dashCharges: cap, dashCd: 1.5 } });
  { // (a) one charge: the second dash in a row is refused
    const { c, st } = mk(1);
    ok(S.dashTry(c, st) === true && S.dashTry(c, st) === false && c.dashN === 0, '1 charge: the first dash passes, the second is refused');
    // (b) a refill after 1.5 s
    run(c, st, 1.45); ok(c.dashN === 0 && S.dashTry(c, st) === false, '1 charge: no dash at 1.45 s');
    const r = run(c, st, 0.1); ok(r === 1 && c.dashN === 1 && c.dashT === 0 && S.dashTry(c, st) === true, '1 charge: a dash is possible again after 1.5 s');
  }
  { // (c) three charges back to back, then one refill per 1.5 s
    const { c, st } = mk(3);
    ok(S.dashTry(c, st) && S.dashTry(c, st) && S.dashTry(c, st) && !S.dashTry(c, st) && c.dashN === 0, '3 charges: three dashes back to back, the fourth is refused');
    const seen = [];
    run(c, st, 1.45); for (let k = 1; k <= 3; k++) { seen.push(c.dashN); run(c, st, 0.1); seen.push(c.dashN); run(c, st, 1.4); } // sampled 0.05 s before and after each 1.5 s mark
    ok(seen.join() === '0,1,1,2,2,3', '3 charges: one charge per 1.5 s, one at a time: ' + seen.join());
    ok(c.dashT === 0 && run(c, st, 5) === 0 && c.dashN === 3, '3 charges: full means the timer rests');
  }
  { // spending while recharging keeps the running timer
    const { c, st } = mk(3);
    S.dashTry(c, st); run(c, st, 1.0); S.dashTry(c, st);
    ok(c.dashN === 1 && Math.abs(c.dashT - 0.5) < 0.02, '3 charges: a second spend does not restart the timer: ' + c.dashT.toFixed(2));
    run(c, st, 0.55); ok(c.dashN === 2, '3 charges: the refill lands 1.5 s after the first spend: ' + c.dashN);
  }
  { // (d) the cap drops from 3 to 1 (stat recalc): the charges clamp; a rise while full starts a refill
    const { c, st } = mk(3);
    st.dashCharges = 1; S.dashTick(c, st, 0);
    ok(c.dashN === 1 && c.dashT === 0, 'dashCharges 3 -> 1 clamps the charges: ' + c.dashN);
    st.dashCharges = 3; run(c, st, 1.45); ok(c.dashN === 1, 'a raised cap starts the timer: still 1 at 1.45 s');
    run(c, st, 0.1); ok(c.dashN === 2, 'a raised cap: +1 charge at 1.5 s: ' + c.dashN);
  }
  { // a long frame carries its overshoot into the next charge
    const { c, st } = mk(3);
    c.dashN = 0; c.dashT = 1.5;
    ok(S.dashTick(c, st, 2.0) === 1 && c.dashN === 1 && Math.abs(c.dashT - 1.0) < 1e-9, 'a 2.0 s frame refills 1 charge and keeps 0.5 s of overshoot: ' + c.dashT);
  }
}

// ---------------- floor-map glyphs (src/client/icons.js): one table, distinct silhouette and colour, labels, route bits ----------------
{
  const fs = require('fs'), path = require('path'), vm = require('vm');
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'icons.js'), 'utf8'), { filename: 'icons.js' });
  const Ic = ED.Icons, M = Ic.MASKS;
  const mask = (g) => { const m = M[g]; return typeof m === 'string' ? M[m] : m; };
  const valid = (g) => { const m = mask(g); return !!m && m.length === 16 && m.every(r => r.length === 16); };
  // glyph identity -> [glyph, colour, label] as the map draws it
  const room = (type, extra) => Ic.room(Object.assign({ type, reward: null, dark: false, event: null }, extra || {}), null, ED.World.REWARD_UP);
  const G = {};
  for (const rw of ['gold', 'boon', 'epic', 'relic', 'forge', 'vigor']) { const r = Ic.reward(rw, null); G[rw] = [r[0], r[1], r[2]]; }
  for (const t of ['shop', 'treasure', 'rest', 'elite', 'boss']) { const r = room(t); G[t] = [r.icon, r.color, r.label]; }
  for (const ev of [null, 'fountain', 'altar', 'trial', 'gamble']) { const r = room('event', { event: ev }); G[ev ? 'event:' + ev : 'event'] = [r.icon, r.color, r.label]; } // null: not yet drawn (events.js)
  G.dark = Ic.DARK.slice();
  const want = { shop: ['stall', 'Shop'], gold: ['coins', 'Gold'], treasure: ['chest', 'Treasure'], relic: ['amulet', 'Relic'], epic: ['cardepic', 'Epic'], boon: ['card', 'Boon'], forge: ['anvil', 'Forge'], vigor: ['heart', 'Health'],
    rest: ['campfire', 'Rest'], event: ['question', 'Event'], 'event:fountain': ['fountain', 'Still Fountain'], 'event:altar': ['altar', 'Blood Altar'], 'event:trial': ['swords', "Champion's Trial"], 'event:gamble': ['coin', "Gambler's Shrine"], elite: ['skullhorn', 'Elite'], boss: ['skullcrown', 'Boss'], dark: ['moon', 'Dark'] };
  for (const id in want) ok(G[id] && G[id][0] === want[id][0] && G[id][2] === want[id][1] && valid(G[id][0]), `map glyph ${id}: ${want[id][0]} "${want[id][1]}" (16x16 mask): ${G[id] && G[id].join(' ')}`);
  const ids = Object.keys(want), sil = (g) => mask(g).map(r => r.replace(/[^.]/g, '#')).join('');
  const diff = (a, b) => { const x = sil(a), y = sil(b); let d = 0; for (let i = 0; i < 256; i++) if (x[i] !== y[i]) d++; return d; };
  const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), dist = (a, b) => { const p = rgb(a), q = rgb(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = G[ids[i]], b = G[ids[j]];
    ok(a[0] !== b[0] || dist(a[1], b[1]) >= 60, `${ids[i]} and ${ids[j]} differ in glyph or colour: ${a[0]} ${a[1]} / ${b[0]} ${b[1]}`);
  }
  ok(diff('stall', 'coins') >= 40 && dist(G.shop[1], G.gold[1]) >= 120, 'shop and gold never read alike: silhouettes differ in ' + diff('stall', 'coins') + ' cells, colours ' + Math.round(dist(G.shop[1], G.gold[1])) + ' apart');
  for (const [a, b] of [['skullhorn', 'skullcrown'], ['skullhorn', 'skull'], ['skullcrown', 'skull'], ['chest', 'stall'], ['coins', 'coin'], ['amulet', 'chest']]) ok(diff(a, b) >= 12, `${a} and ${b} silhouettes differ: ${diff(a, b)} cells`);
  ok(dist(G.epic[1], G.boon[1]) >= 60, 'boon and epic cards differ in colour');
  ok(Ic.reward('boon', 'fire')[1] === ED.PATHS.fire.color && Ic.reward('relic', null)[3] === 'Relics' && Ic.reward('nope', null)[2] === 'Reward', 'boon card wears the path colour; long names; unknown rewards read "Reward"');
  // every generated room has a glyph and a label (start excepted); a dark room previews its stepped-up reward; elite labels name the reward
  let rooms = 0; const bad = [];
  for (let s = 1; s <= ED.CONST.STRATA; s++) for (let seed = 1; seed <= 6; seed++) {
    const fl = ED.Dungeon.generate(s, seed * 7919 + s);
    for (const r of fl.rooms) {
      if (r.type === 'start') continue;
      rooms++;
      const g = Ic.room(r, null, ED.World.REWARD_UP);
      if (!g || !valid(g.icon) || !g.label) { bad.push(r.type + ':' + r.reward); continue; }
      if (r.dark && r.reward && ED.World.REWARD_UP[r.reward] && g.reward !== ED.World.REWARD_UP[r.reward]) bad.push('dark ' + r.reward + ' -> ' + g.reward);
      if (r.type === 'elite' && r.reward && !/^Elite \S/.test(g.label)) bad.push('elite label ' + g.label);
      if (g.badge && !valid(g.badge[0])) bad.push('badge ' + g.badge[0]);
    }
  }
  ok(rooms > 100 && !bad.length, `every generated room (${rooms}) maps to a glyph and a label: ${bad.slice(0, 4).join(', ')}`);
  // route bits: every room is reachable from the start; exits only lead forward, so the way back closes
  const fl0 = ED.Dungeon.generate(3, 4242), rt0 = Ic.route(fl0, fl0.start, {});
  ok(rt0[fl0.start] === 5 && fl0.rooms.every(r => rt0[r.id] & 1), 'every room is reachable from the start room');
  const mk = (id, row, doors) => ({ id, row, lane: 0, type: 'combat', doors });
  const line = { rooms: [mk(0, 0, { n0: 1 }), mk(1, 1, { n0: 2, n1: 3 }), mk(2, 2, {}), mk(3, 2, {})] }; // 0 -> 1 -> 2 or 3
  const rt1 = Ic.route(line, 1, { 0: { visited: true }, 1: { visited: true } });
  ok(rt1[0] === 2 && rt1[1] === 7 && rt1[2] === 1 && rt1[3] === 1, 'route bits from room 1: the walked room behind is closed (2), both forward rooms reachable (1): ' + Array.from(rt1).join());
  const rt2 = Ic.route(line, 2, { 0: { visited: true }, 1: { visited: true }, 2: { visited: true } });
  ok(rt2[3] === 0 && rt2[2] === 7, 'the branch not taken closes once its sibling is entered: ' + Array.from(rt2).join());
  const sheetSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'sheetui.js'), 'utf8');
  ok(!/dead end/.test(sheetSrc), 'the sheet never calls dark rooms dead ends');
}

// ---------------- offer lock (ui.js; the live timing runs in tools/browse.js --scen=cards) ----------------
{
  const ui = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'client', 'ui.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(/const BOON_LOCK_MS = UI\.OFFER_LOCK_MS = 600;/.test(ui), 'the offer lock is 600 ms');
  ok(/el\.onclick = \(\) => \{ if \(performance\.now\(\) >= boonLock\)/.test(ui), 'a card click waits for the lock');
  ok(/UI\.boonConfirm = \(\) => \{ if \(!boonOffer \|\| performance\.now\(\) < boonLock\) return;/.test(ui), 'the confirm key and pad wait for the lock');
  ok(/UI\.boonReroll = [^\n]*\n[^\n]*performance\.now\(\) < boonLock\) return;/.test(ui), 'the reroll waits for the lock');
  ok(/boonLock = performance\.now\(\) \+ BOON_LOCK_MS;[^\n]*\n[^\n]*\n\s*wrap\.style\.setProperty\('--lock'[^\n]*classList\.add\('locking'\)/.test(ui), 'each hand restarts the lock and its fill sweep');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
