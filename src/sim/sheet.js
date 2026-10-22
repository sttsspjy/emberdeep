// The character sheet model (Tab menu): every number a hero's build shows, derived from the stat block, the data tables and the same formulas the sim uses.
// Pure and deterministic (no DOM, no World mutation): the host, a client mirror and the Node tools (tools/sheet.js, tools/sheet-check.js) compute identical models from {p, ctx}.
(function (ED) {
  'use strict';
  const U = ED.U, St = ED.Stats, W = ED.World, C = ED.CONST;
  const Sh = ED.Sheet = {};

  // The reference foe of "per cast on one foe": hits land at REF.d px on a foe of radius REF.r (the median roster radius 11, rounded up so that no fan sits on a hit boundary).
  Sh.REF = { d: 80, r: 12 };

  // ---------------- stat labels and formats ----------------
  // fmt: pct (0.35 -> 35%), flat (a count or points), sec (seconds), x (a multiplier); an unknown stat is a percentage. group: offense | defense | utility | an element id.
  const SI = (label, fmt, group) => ({ label, fmt, group });
  Sh.STAT_INFO = {
    dmg: SI('Damage', 'pct', 'offense'), atk: SI('Attack speed', 'pct', 'offense'), crit: SI('Critical chance', 'pct', 'offense'), critDmg: SI('Critical damage', 'pct', 'offense'), area: SI('Area', 'pct', 'offense'),
    cdr: SI('Skill cooldown', 'pct', 'offense'), projN: SI('Projectiles', 'flat', 'offense'), pierce: SI('Pierce', 'flat', 'offense'), execute: SI('Execute', 'pct', 'offense'), wDmg: SI('Weapon damage', 'pct', 'offense'),
    dashDmg: SI('Dash damage', 'pct', 'offense'), dashFrost: SI('Dash frost ring', 'pct', 'offense'), dashcdr: SI('Dash cooldown', 'pct', 'utility'), idol: SI('Golden Idol', 'flat', 'offense'), banner: SI('Banner of Unity', 'pct', 'offense'),
    hp: SI('Max health', 'flat', 'defense'), hpMul: SI('Max health', 'pct', 'defense'), armor: SI('Armor', 'flat', 'defense'), dodge: SI('Dodge', 'pct', 'defense'), vuln: SI('Damage taken', 'pct', 'defense'), heal: SI('Healing received', 'pct', 'defense'),
    thorns: SI('Thorns', 'flat', 'defense'), roomWard: SI('Battle Ward', 'pct', 'defense'), mirror: SI('Mirror Shard', 'pct', 'defense'), spd: SI('Move speed', 'pct', 'utility'), pickup: SI('Pickup range', 'pct', 'utility'), xp: SI('Experience', 'pct', 'utility'),
    gold: SI('Gold', 'pct', 'utility'), luck: SI('Luck', 'pct', 'utility'), light: SI('Lantern light', 'pct', 'utility'), minions: SI('Max minions', 'flat', 'utility'), minionDmg: SI('Minion damage', 'pct', 'offense'), charges: SI('Skill charges', 'flat', 'utility'),
    forager: SI('Forager', 'flat', 'utility'), trance: SI('Battle Trance', 'pct', 'offense'), wardrum: SI('War Drum', 'pct', 'offense'), knell: SI('Death Knell stacks', 'flat', 'shadow'), deathsEdge: SI("Death's Edge crits", 'flat', 'shadow'),
    fireInfuse: SI('Burn from hits', 'pct', 'fire'), burnMul: SI('Burn damage', 'pct', 'fire'), searing: SI('Damage to burning', 'pct', 'fire'), wildfire: SI('Wildfire', 'pct', 'fire'), conflag: SI('Conflagration', 'flat', 'fire'),
    iceInfuse: SI('Chill from hits', 'pct', 'ice'), chillMul: SI('Chill build-up', 'pct', 'ice'), freezeDur: SI('Freeze length', 'pct', 'ice'), shatter: SI('Shatter', 'pct', 'ice'), brittle: SI('Damage to chilled', 'pct', 'ice'), chillWeaken: SI('Chilled foes deal', 'pct', 'ice'),
    lightningInfuse: SI('Charge from hits', 'pct', 'lightning'), shockMul: SI('Discharge damage', 'pct', 'lightning'), arcs: SI('Arc targets', 'flat', 'lightning'), arcRange: SI('Arc range', 'pct', 'lightning'), arcStun: SI('Discharge stun', 'sec', 'lightning'),
    shortCircuit: SI('Short Circuit', 'pct', 'lightning'), thunderbolt: SI('Thunderbolt chance', 'pct', 'lightning'),
    poisonInfuse: SI('Venom from hits', 'pct', 'poison'), venomBuild: SI('Venom build-up', 'pct', 'poison'), venomHold: SI('Venom hold', 'sec', 'poison'), corrode: SI('Venom bonus', 'pct', 'poison'), fester: SI('Damage to envenomed', 'pct', 'poison'), sporeBurst: SI('Spore Burst', 'pct', 'poison'),
    holyInfuse: SI('Radiance from hits', 'pct', 'holy'), smiteMul: SI('Smite damage', 'pct', 'holy'), smiteShield: SI('Smite shield', 'pct', 'holy'), holyCap: SI('Holy shield cap', 'pct', 'holy'), beacon: SI('Beacon', 'pct', 'holy'),
    shadowInfuse: SI('Doom from hits', 'pct', 'shadow'), doomMul: SI('Doom strength', 'pct', 'shadow'), doomTough: SI('Doom on elites', 'pct', 'shadow'), malice: SI('Damage to Doomed', 'pct', 'shadow'), reaper: SI('Reaper', 'pct', 'shadow'),
    bleed: SI('Bleed on crits', 'pct', 'general'), bleedAll: SI('Bleed on hits', 'pct', 'general'), bleedMul: SI('Bleed damage', 'pct', 'general'), lacerate: SI('Damage to bleeding', 'pct', 'general'), sunder: SI('Sunder', 'flat', 'general'), opportunist: SI('Opportunist', 'pct', 'general'),
    s1Dmg: SI('Skill 1 damage', 'pct', 'offense'), s1Area: SI('Skill 1 area', 'pct', 'offense'), s1Dur: SI('Skill 1 duration', 'sec', 'offense'), s1N: SI('Skill 1 count', 'flat', 'offense'), s1Cdr: SI('Skill 1 cooldown', 'pct', 'offense'),
    s2Dmg: SI('Skill 2 damage', 'pct', 'offense'), s2Area: SI('Skill 2 area', 'pct', 'offense'), s2Dur: SI('Skill 2 duration', 'sec', 'offense'), s2N: SI('Skill 2 count', 'flat', 'offense'), s2Cdr: SI('Skill 2 cooldown', 'pct', 'offense'),
    statusPow: SI('Status strength', 'pct', 'offense'), classElMul: SI('Class-element damage', 'pct', 'offense'),
  };
  const SIF = (key) => Sh.STAT_INFO[key] || { label: key, fmt: 'pct', group: 'offense' };
  const n1 = (v) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  const trim = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10 < 4 ? n % 10 : 0]);
  // Display text of value v of stat `key`: pct rounds to a whole percent (one decimal below 10, two below 1), flat and sec follow the damage rounding (sec adds 's'), x is a two-decimal multiplier.
  Sh.fmt = (key, v, fmt) => {
    const f = fmt || SIF(key).fmt;
    if (f === 'x') return '×' + v.toFixed(2);
    if (f === 'sec') return Sh.secs(v) + 's';
    if (f === 'flat' || f === 'n') return n1(v);
    const p = v * 100, a = Math.abs(p);
    return (a >= 10 ? String(Math.round(p)) : a >= 1 ? trim(p.toFixed(1)) : trim(p.toFixed(2))) + '%';
  };
  // Seconds without the unit: two decimals below 1 s (0.25), one below 10, whole from 10; trailing zeros dropped.
  Sh.secs = (v) => { const a = Math.abs(v); return trim(a >= 10 ? String(Math.round(v)) : a >= 1 ? v.toFixed(1) : v.toFixed(2)); };
  Sh.n1 = n1;

  // ---------------- text at rank ----------------
  // Boon text at `rank`: {stat} renders |mods[stat]| x rank in the stat's format (":pct|flat|sec|x" overrides it), {stat*K} that number times K (K = P: the hero's Power; ck / ck3: see below), {pw} the proc damage of the boon at the hero's Power.
  // Class cards render through ED.boonText. st (the hero's stat block) is optional: without it {pw} reads as its formula and {stat*P} as a Power share.
  const TOKEN = /\{(\w+)(?:\*(\w+(?:\.\d+)?))?(?::(\w+))?\}/g;
  const PLURAL = /(\d+(?:\.\d+)?)((?:\s+[\w-]+){1,2})\(s\)/g; // "+2 foe(s)" reads "+2 foes", "+1 foe(s)" reads "+1 foe"
  Sh.text = (id, rank, st) => {
    const b = ED.BOONS[id];
    if (!b) return '';
    rank = Math.max(1, rank | 0 || 1);
    if (b.route) return ED.boonText(id, rank, st);
    return b.desc.replace(TOKEN, (m, key, mulBy, f) => {
      if (key === 'pw') return b.pw ? (st ? String(Math.round(ED.procDmg(b, st))) : `${Math.round(b.pw.k * 100)}% Power${b.pw.base ? ' + ' + b.pw.base : ''}`) : m;
      const v = Math.abs((b.mods && b.mods[key]) || 0) * rank;
      if (mulBy === 'ck' || mulBy === 'ck3') return String(Math.max(1, Math.round(v * (mulBy === 'ck3' ? 3 : 1) * ((st && st.critK) || 1)))); // *ck / *ck3: the number and three times it, x the hero's critK (as W.grantCrits scales a grant and its cap)
      if (mulBy) return n1(v * (mulBy === 'P' ? (st ? st.power : 1) : +mulBy));
      return Sh.fmt(key, v, f);
    }).replace(PLURAL, (m, num, words) => num + words + (Math.abs(+num) === 1 ? '' : 's'));
  };

  // The "Next rank" line: the changed numbers of the text at rank + 1 (runs of words the text at rank lacks, found by a word-level diff that ignores trailing punctuation), a lone number with up to NEXT_WORDS - 1 words after it ("+30% damage"),
  // joined with " · ", and the rider a route card gains at rank 3.
  const NEXT_WORDS = 3, NEXT_RUN = 6, NEXT_STOP = /^(to|of|the|a|an|and|or|from|for|in|on|at|by|with|as|that|their|its|is|are|your|you|than|per|each)$/i;
  const wordKey = (w) => w.replace(/[.,;:]+$/, '');
  const bareNum = (ph) => !/[A-Za-z]{3,}/.test(ph.join(' ').replace(/\d+(?:\.\d+)?\s?s\b/g, '')); // numbers and units only, no noun
  // A lone number ph (Z[a..a+ph.length)) names nothing: borrow the noun from its clause. The unchanged words after it (to the clause end, at most 4, a trailing "'s" takes its noun),
  // else up to 3 words before it (2 or more once a content word is in), else its whole sentence.
  function withNoun(Z, a, ph, same) {
    const stop = (w) => NEXT_STOP.test(wordKey(w)), m = Z.length, fw = [];
    for (let k = a + ph.length; fw.length < 4 && k < m && same[k] && !/[.,;:]$/.test(Z[k - 1]) && !/^\(/.test(Z[k]); k++) fw.push(Z[k]);
    while (fw.length && stop(fw[fw.length - 1])) fw.pop();
    for (let k = a + ph.length + fw.length; fw.length && /'s$/.test(wordKey(fw[fw.length - 1])) && fw.length < 6 && k < m && same[k]; k++) fw.push(Z[k]);
    let out = ph;
    if (fw.length) out = ph.concat(fw);
    else {
      const bw = [];
      for (let k = a - 1; k >= 0 && bw.length < 3 && !/[.,;:)]$/.test(Z[k]); k--) { bw.unshift(Z[k]); if (bw.length >= 2 && bw.some(w => !stop(w))) break; }
      while (bw.length > 1 && stop(bw[0])) bw.shift();
      out = bw.concat(ph);
      if (bareNum(out)) { // no content word in reach: the sentence the number sits in
        let s0 = a, s1 = a + ph.length;
        while (s0 > 0 && !/[.]$/.test(Z[s0 - 1])) s0--;
        while (s1 < m && !/[.]$/.test(Z[s1 - 1])) s1++;
        out = Z.slice(s0, s1);
      }
    }
    if (out.length && /^\(/.test(out[0]) && !out.some(w => /\)/.test(w))) out = [out[0].slice(1)].concat(out.slice(1)); // an opening bracket without its close
    return out;
  }
  Sh.nextText = (id, rank, st) => {
    const b = ED.BOONS[id];
    if (!b) return '';
    rank = Math.max(1, rank | 0 || 1);
    const body = (r) => (b.route ? ED.cardParts(id, r, st).text : Sh.text(id, r, st)), A = body(rank).split(/\s+/), Z = body(rank + 1).split(/\s+/), out = [];
    const n = A.length, m = Z.length, L = [];
    for (let i = 0; i <= n; i++) L.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = wordKey(A[i]) === wordKey(Z[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const same = new Array(m).fill(false); // Z words that A has too (longest common subsequence)
    for (let i = 0, j = 0; i < n && j < m;) { if (wordKey(A[i]) === wordKey(Z[j])) { same[j] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    for (let j = 0; j < m; j++) {
      if (same[j]) continue;
      let e = j;
      while (e < m && !same[e]) e++;
      const j0 = j;
      let ph = Z.slice(j, e);
      const d = ph.findIndex(w => /\d/.test(w));
      j = e;
      if (d < 0) continue;
      const ph0 = ph.length > NEXT_RUN;
      if (ph0) ph = ph.slice(d, d + NEXT_WORDS);
      for (let k = e; ph.length < NEXT_WORDS && k < m && same[k] && !/[.,;:]$/.test(ph[ph.length - 1]) && !/^\(/.test(Z[k]); k++) ph.push(Z[k]);
      while (ph.length > 1 && NEXT_STOP.test(wordKey(ph[ph.length - 1]))) ph.pop();
      if (bareNum(ph)) ph = withNoun(Z, j0 + (ph0 ? d : 0), ph, same);
      out.push(wordKey(ph.join(' ')));
    }
    if (b.route && (rank + 1 === 2 || rank + 1 === 3)) { // the rider a route card gains at rank 2 (rider2) or 3 (rider, or the transform's name)
      const P = ED.cardParts(id, 3, st), nm = rank + 1 === 2 ? P.rider2Name : P.form ? P.form.name : P.riderName;
      if (nm) out.push('unlocks ' + nm);
    }
    return out.join(' · ');
  };

  // ---------------- ready states of defensive items (net.js sends them as one bitfield) ----------------
  // [{ id, name, owned(st), ready(p) }]; append only (a bit per row). A mirror hero carries the bits in p.rdy.
  Sh.READY = [
    { id: 'aegis', name: 'Aegis Charm', owned: (st) => st.aegis > 0, ready: (p) => !(p.aegisT > 0) },
    { id: 'guardian', name: 'Last Stand', owned: (st) => st.guardian > 0, ready: (p) => !(p.guardCd > 0) },
    { id: 'frozenheart', name: 'Frozen Heart', owned: (st) => st.frozenHeart > 0, ready: (p) => !(p.frozenCd > 0) },
    { id: 'angel', name: 'Guardian Angel', owned: (st) => st.angel > 0, ready: (p) => !p.angelUsed },
    { id: 'phoenix', name: 'Phoenix Feather', owned: (st) => st.phoenix > 0, ready: (p) => !p.phoenixUsed },
  ];
  Sh.readyBits = (p) => { let b = 0; for (let i = 0; i < Sh.READY.length; i++) if (Sh.READY[i].ready(p)) b |= 1 << i; return b; };
  // Shield received in the last SHIELD_WIN_T seconds in health: { c: class sources, a: all sources } (world.js addShield). A mirror hero carries the host's sums in shwC / shwA (net.js).
  Sh.shieldWindow = (p, time) => {
    if (!p.shWin) return { c: p.shwC || 0, a: p.shwA || 0 };
    const now = Math.floor(time || 0);
    let c = 0, a = 0;
    for (const s of p.shWin) if (now - s.sec < C.SHIELD_WIN_T) { c += s.c; a += s.a; }
    return { c, a };
  };
  const readyOf = (p, i) => (p.rdy !== undefined ? !!(p.rdy & (1 << i)) : Sh.READY[i].ready(p));

  // ---------------- the reference foe and the context ----------------
  let medianHp = 0;
  const rosterMedian = () => {
    if (medianHp) return medianHp;
    const hs = [];
    for (const k in ED.ENEMIES) { const e = ED.ENEMIES[k]; if (!e.boss && !e.minion && !e.gloom && !e.ally && e.hp > 0) hs.push(e.hp); }
    hs.sort((a, b) => a - b);
    return (medianHp = hs[hs.length >> 1] || 30);
  };
  // A typical foe of the context's stratum: hp (real), statusHp (before the stratum lever: the unit chill and Venom measure against), r.
  Sh.refFoe = (ctx) => {
    const s = ctx.stratum || 1, pact = ctx.pact | 0, thr = W.THREAT[Math.max(0, Math.min(W.THREAT.length - 1, s - 1))].hp;
    const hp = rosterMedian() * W.hpScale(s) * W.partyHpMul(ctx.party || 1) * (pact >= 1 ? 1.25 : 1) * (pact >= 10 ? 1.2 : 1);
    return { hp, statusHp: hp / thr, r: Sh.REF.r };
  };
  // The numbers about the run the sheet needs from a World or a Mirror (duck-typed: players, allies, floor, roomState, dread, light, gold, level, xp, deepRooms).
  Sh.ctx = (view, p) => {
    let allyNear = 0, minions = 0;
    const party = [];
    if (view.players) for (const q of view.players.values()) {
      party.push({ pid: q.pid, name: q.name, cls: q.cls, hp: Math.ceil(q.hp), maxHp: q.maxHp, slot: q.slot | 0, downed: !!q.downed, dead: !!q.dead });
      if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 200 * 200) allyNear++;
    }
    if (view.allies) for (const a of view.allies) if (a.owner === p.pid) minions++;
    const rooms = view.floor ? view.floor.rooms : [];
    let seen = 0;
    for (const r of rooms) { const s = view.roomState && view.roomState[r.id]; if (s && s.visited) seen++; }
    return {
      stratum: view.stratum || 1, pact: view.pact | 0, gold: view.gold | 0, level: view.level || 1, xp: Math.floor(view.xp || 0), xpNext: view.xpNext || 1, light: view.light === undefined ? 100 : view.light, lightMax: view.lightMax || 100,
      tier: view.dread ? view.dread.tier | 0 : 0, deep: view.deepRooms === undefined || view.deepRooms === null ? null : view.deepRooms, allyNear, minions, room: view.room ? { type: view.room.type, id: view.roomId } : null,
      party: view.players ? view.players.size : 1, rooms: { seen, total: rooms.length }, heroes: party, time: view.time || 0,
    };
  };

  // ---------------- small helpers ----------------
  // Rounding of one compute call: n damage-like numbers (whole from 10, one decimal below), f fractions (four decimals), x multipliers (two decimals); raw keeps every number as computed.
  const rounders = (raw) => (raw ? { n: (v) => v, f: (v) => v, x: (v) => v } : {
    n: (v) => (!isFinite(v) ? 0 : Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10),
    f: (v) => Math.round(v * 10000) / 10000,
    x: (v) => Math.round(v * 100) / 100,
  });
  const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Shots of a fan that reach a foe at REF.d: those whose lateral offset there is within REF.r + the shot radius.
  const fanHits = (offsets, projR) => { let n = 0; for (let i = 0; i < offsets.length; i++) if (Math.cos(offsets[i]) > 0 && Sh.REF.d * Math.abs(Math.sin(offsets[i])) < Sh.REF.r + projR) n++; return n; }; // an arrow flying away from the foe (a ring) never reaches it
  const buildOf = (p, ctx) => ({ cls: p.cls, weapon: p.weapon, boons: p.boons || {}, relics: p.relics || [], meta: p.meta, pact: ctx.pact | 0, chaliceHp: p.chaliceHp || 0, bonusHp: p.bonusHp || 0 });
  // Drops the internal raw-number fields (names starting with an underscore) from a model.
  const strip = (o) => {
    if (Array.isArray(o)) { for (const v of o) if (v && typeof v === 'object') strip(v); return o; }
    for (const k in o) { if (k.charCodeAt(0) === 95) delete o[k]; else if (o[k] && typeof o[k] === 'object') strip(o[k]); }
    return o;
  };

  // ---------------- weapon ----------------
  const MS = { every: 4, mul: 1.3, bleed: 0.5 }; // Masterstroke as combat.js playerAttack plays it
  // Damage numbers are per landed hit before the stratum affinity and any status; dps counts every attack landing on one foe (a fan: the shots that reach it at REF).
  // extras: damage each attack adds besides the main hits (blasts, shocks, waves, clouds, evolution strikes, relics): { label, perAttack, perSec, proc (feeds statuses), el?, note? }.
  function weaponModel(p, st, ctx, R) {
    const w = st.weapon, melee = w.kind === 'melee', M = Math.max(0.1, st.dmg), c = st.crit, cm = st.critMult, EC = 1 + c * (cm - 1), Wd = w.dmg, evo = st.evo, area = 1 + 0.5 * st.area;
    const aps = 1 / St.attackInterval(p), apsBase = 1 / st.atkInterval;
    const n = melee ? 1 : (w.n || 1) + st.projN, sp = n > 1 ? Math.max(w.spread || 0, 0.13) : 0, offs = [];
    for (let i = 0; i < n; i++) offs.push((i - (n - 1) / 2) * sp);
    const one = melee ? 1 : fanHits(offs, w.r), hit = Wd * M, avg = hit * EC;
    const extras = [], add = (label, perAttack, o) => { if (perAttack > 0) extras.push(Object.assign({ label, perAttack, proc: false }, o)); };
    const cleaveEvery = melee && st.cleave > 0 ? 3 + st.cleaveN : 0, cleaveK = cleaveEvery ? st.cleave / cleaveEvery : 0;
    if (cleaveEvery) add('Cleave', avg * cleaveK, { proc: true, crit: true, note: `every ${ordinal(cleaveEvery)} swing: +${Math.round(st.cleave * 100)}% damage, 40% more reach and arc` });
    if (melee && w.shock) add('Shockwave', Wd * w.shock.mul * M * (1 + cleaveK), { r: Math.round(w.shock.r * area), note: 'each swing, no crit' });
    if (cleaveEvery && st.cShock) add('Cleave shock', Wd * st.cShock * M / cleaveEvery, { r: Math.round(72 * area), stun: st.cStun, note: 'each Cleave, no crit' });
    // the blast of a shot (its own, or the Cinder Arms blast of a plain shot), its aftershock, its cloud
    const pyre = evo === 'fire';
    const blast = !melee ? (w.explode ? { r: w.explode.r * area * (pyre ? 1.3 : 1), mul: w.explode.mul } : pyre ? { r: 40 * area, mul: 0.5 } : null) : null;
    if (blast) add('Blast', Wd * blast.mul * M * one, { proc: true, r: Math.round(blast.r), note: 'each shot that lands, no crit' });
    if (blast && st.aftershock) add('Aftershock', Wd * blast.mul * M * st.aftershock * one, { r: Math.round(blast.r), note: '0.4 s after each blast' });
    if (!melee && w.cloud) { const ticks = w.cloud.dur / 0.5; add('Plague cloud', ticks * w.cloud.dps * 0.5 * M * one, { r: Math.round(w.cloud.r * area), note: `about ${n1(ticks)} ticks over ${n1(w.cloud.dur)}s per shot (clouds that merge tick on one 0.5 s grid), no crit` }); }
    if (w.wave) { const every = Math.max(1, w.wave.every + st.waveEvery); add('Wave of light', Wd * w.wave.mul * (1 + st.waveMul) * M * EC / every, { proc: true, crit: true, note: (every === 1 ? 'every attack' : `every ${ordinal(every)} attack`) + ', pierces every foe in line' }); }
    if (st.gauntlet) add('Thunder Gauntlet', Wd * 2.2 * M / 6, { proc: true, el: 'lightning', note: 'every 6th attack, no crit' });
    // evolution strikes (data on the evolution boon)
    const evoBoon = evo && ED.BOONS['evo_' + evo], attackTotal = avg * one + (blast ? Wd * blast.mul * M * one : 0);
    for (const s of (evoBoon && evoBoon.strikes) || []) {
      if ((s.on === 'melee' && !melee) || (s.on === 'proj' && melee) || (s.ifNoBlast && (w.explode || melee)) || (s.ifBlast && !w.explode)) continue;
      let per;
      if (s.perSec) per = s.perSec * s.dur * Wd * M * one;
      else if (s.fan) { const o = []; for (let i = 0; i < s.fan.n; i++) o.push((i - (s.fan.n - 1) / 2) * s.fan.step); per = s.mul * Wd * M * (s.crit ? EC : 1) * fanHits(o, s.fan.r) / s.every; }
      else if (s.of === 'attack') per = s.mul * attackTotal;
      else if (s.onCrit) per = s.mul * c * avg * one;
      else per = s.mul * Wd * M * (s.crit ? EC : 1) * (s.n || 1) / s.every;
      add(s.label, per, { proc: !!s.proc, crit: !!s.crit, el: s.el || null, note: s.every > 1 ? `every ${ordinal(s.every)} attack` : s.onCrit ? 'when you crit' : '' });
    }
    if (st.twinEvery) add('Twin Fang', attackTotal / st.twinEvery, { proc: true, note: `every ${ordinal(st.twinEvery)} attack strikes twice` });
    // Masterstroke (combat.js playerAttack): every MS.every-th attack crits for sure at MS.mul, and its blast and shock take the MS.mul too; the extra is that attack's surplus over a normal one
    const ms = st.masterstroke ? MS : null;
    if (ms) {
      let side = 0;
      for (const e of extras) if (e.label === 'Blast' || e.label === 'Shockwave') side += e.perAttack;
      add('Masterstroke', ((hit * cm * ms.mul - avg) * one + (ms.mul - 1) * side) / ms.every, { proc: true, note: `every ${ordinal(ms.every)} attack: a guaranteed crit at ×${ms.mul} that Bleeds for at least ${Math.round(ms.bleed * 100)}% of the hit` });
    }
    let sum = 0;
    for (const e of extras) sum += e.perAttack;
    const dps = (avg * one + sum) * aps, dpsAll = (avg * n + sum) * aps;
    const notes = [];
    if (st.atkOver > 1.0001) notes.push(`Attack speed cap ${n1(1 / st.atkFloor)}/s: the excess adds +${Math.round((st.atkOver - 1) * 100)}% damage`);
    if (st.heavy) notes.push(`Heavy: a hit Staggers a foe for ${C.STAGGER} s (elites half)`);
    if (st.swift) notes.push(`Swift: +${Math.round(C.FLOW_SPD * 100)}% move speed for ${C.FLOW_T} s after each attack`);
    const out = {
      id: st.weaponId, base: p.weapon, name: (evo && ED.PATHS[evo] ? ED.PATHS[evo].evo + ' ' : '') + (w.name || ED.WEAPONS[p.weapon].name), kind: w.kind, fork: st.heavy ? 'heavy' : st.swift ? 'swift' : null, evo: evo || null,
      look: w.look, hit: R.n(hit), crit: R.n(hit * cm), avg: R.n(avg), n, oneFoe: one, aps: R.x(aps), apsBase: R.x(apsBase), interval: R.x(1 / aps), floorBinds: st.atkOver > 1.0001,
      critChance: R.f(c), critMult: R.x(cm), dps: R.n(dps), dpsAll: R.n(dpsAll), fan: !melee && n > 1, notes,
      extras: extras.map(e => Object.assign({}, e, { perAttack: R.n(e.perAttack), perSec: R.n(e.perAttack * aps) })),
      _hit: hit, _avg: avg, _aps: aps, _extras: extras, _ms: ms,
    };
    if (melee) { const arc = Math.min(6.3, w.arc * (1 + 0.4 * st.area)); out.reach = Math.round(w.range * (1 + 0.5 * st.area + st.meleeReach)); out.arcDeg = Math.round(arc * 57.2958); out.allAround = arc >= 6.2; }
    else { out.range = Math.round(w.speed * w.life); out.pierce = (w.pierce || 0) + st.pierce; out.homing = (w.homing || 0) + (st.homing || 0) > 0; out.blast = blast ? { r: Math.round(blast.r), mul: blast.mul } : null; }
    return out;
  }

  // ---------------- skills ----------------
  const procDefault = (q) => (q.proc !== undefined ? !!q.proc : q.per === 'hit' || q.per === 'tick');
  // One part of a skill at the hero's stats: hit (per landed hit with the hero multiplier), avg (with the crit chance), pre (with the vulnerability the part sets), here (with the stratum affinity), total (here x hits on one foe).
  // A class-element part takes half the stratum affinity (ED.affC) and the class-element multiplier; statuses take the full affinity.
  function partModel(q, skillId, st, ctx, wpn, R) {
    const stratum = ctx.stratum, clsEl = q.el === 'class' && st.element ? st.element : null, tag = clsEl || (q.el && q.el !== 'class' ? q.el : null);
    const aff = clsEl ? ED.affC(stratum, clsEl) : tag ? ED.elemMul(stratum, tag) : 1;
    const M = Math.max(0.1, st.dmg + (clsEl ? st.classElMul : 0)), cm = st.critMult, c = st.crit, EC = 1 + c * (cm - 1);
    const o = { id: q.id, label: q.label, per: q.per, el: tag, aff: R.x(aff), r: q.r && !q.pRad ? Math.round(q.r) : 0, dur: q.dur, every: q.every, delay: q.delay, count: q.count, n: q.n, stun: q.stun, knock: q.knock, note: q.note || '', proc: procDefault(q), radiance: q.radiance || 0, noCrit: !!q.noCrit, alwaysCrit: q.crit === true, selfVuln: q.selfVuln || 0, infAdd: q.infAdd || null };
    if (q.per === 'minion') {
      const per = q.dmg * (1 + st.minionDmg) * (C.COMP_MUL || 0.85), live = Math.min(ctx.minions > 0 ? ctx.minions : q.n, st.maxMinions || 3), hits = Math.floor((q.dur || 0) / q.every + 1e-9);
      Object.assign(o, { kind: 'minion', raw: q.dmg, hit: per, avg: per, pre: per, here: per, hitsEach: hits, minions: live, oneFoe: live * hits, total: per * live * hits, kc: 0 });
      return finish(o, R);
    }
    if (q.per === 'status') {
      const S = ED.STATUS[q.status], mul = S && S.mulKey ? 1 + (st[S.mulKey] || 0) : 1, aff2 = S && S.el ? ED.elemMul(stratum, S.el) : 1, pool = q.dmg * (q.status === 'burn' ? 1 + st.classElMul : 1);
      Object.assign(o, { kind: 'status', raw: q.dmg, status: q.status, statusName: S ? S.name : q.status, statusEl: S ? S.el : null, aff: R.x(aff2), pool, hit: 0, avg: pool, pre: pool, here: pool * aff2 * mul, total: pool * aff2 * mul, oneFoe: 1, kc: 0 });
      return finish(o, R);
    }
    if (q.per === 'zone') return finish(Object.assign(o, { kind: 'zone', raw: 0, hit: 0, avg: 0, pre: 0, here: 0, total: 0, oneFoe: 0, kc: 0 }), R);
    const sec = q.per === 'sec', always = q.crit === true, kc = always ? 1 : q.noCrit || sec ? 0 : c;
    let raw = q.dmg || 0, oneFoe = q.oneFoe;
    // Cast-time factors skillNums leaves out (the casts apply them): Shield Storm throws two shields (Aegis Tempest three) at twinShield each, all reach a foe at REF; Comet's impact lands at 1 + comet.
    if (skillId === 'shieldthrow' && (st.twinShield > 0 || st.tempest > 0) && (q.id === 'strike' || q.id === 'return')) { raw *= st.twinShield > 0 ? st.twinShield : 1; oneFoe = st.tempest > 0 ? Math.round(st.tempest) : 2; }
    else if (skillId === 'meteor' && q.id === 'impact' && st.comet > 0) raw *= 1 + st.comet;
    const hit = raw * M * (sec ? 0.5 : 1);
    if (q.fan) { // a fan spreads its arrows over fan radians (a ring: evenly round the circle); a later wave (q.waves) repeats the fan
      const offs = [];
      for (let i = 0; i < q.n; i++) offs.push(q.ring ? i / q.n * q.fan : q.n > 1 ? (i / (q.n - 1) - 0.5) * q.fan : 0);
      oneFoe = fanHits(offs, q.pr || 5) * (q.waves || 1); o.fanN = q.n; o.waves = q.waves || 1; o.fan = q.fan;
    }
    if (q.ref) { let hits = 0; for (let k = 0; k < q.n; k++) if (q.ref * (q.n - 1 - k) / q.n <= q.r + Sh.REF.r) hits++; oneFoe = hits; } // Starfall: the impacts walk from the hero to a target q.ref px away; a foe there is in reach of some of them
    if (q.id === 'ambush' && skillId === 'vanish') oneFoe = wpn.oneFoe; // each of the weapon's hits carries the Ambush value
    if (q.perMinion) { // one hit per minion: the minions you have now (all of them when none), or the ones this cast raises
      oneFoe = q.perMinion === 'cast' ? St.skillNums('legion', st).p.minion.n : ctx.minions > 0 ? Math.min(ctx.minions, st.maxMinions || 3) : st.maxMinions || 3;
      o.perMinion = true;
    }
    const avg = hit * (1 + kc * (cm - 1)), pre = avg * (1 + o.selfVuln), here = pre * aff;
    Object.assign(o, { kind: sec ? 'sec' : q.per === 'tick' ? 'tick' : 'hit', raw, hit, avg, pre, here, oneFoe: oneFoe === undefined ? 1 : oneFoe, critHit: hit * cm, kc, _hit: hit });
    if (sec) o.tick = hit;
    if (q.statusAdd) { // a status add riding on the hit (Meteor): a share of the damage before affinity, built with the status' own affinity and strength
      for (const k in q.statusAdd) {
        const S = ED.STATUS[k], a2 = S && S.el ? ED.elemMul(stratum, S.el) : 1, mul = S && S.mulKey ? 1 + (st[S.mulKey] || 0) : 1;
        o.statusAdd = { status: k, pool: pre * q.statusAdd[k], here: pre * q.statusAdd[k] * a2 * mul, el: S ? S.el : null };
      }
    }
    o.total = (here + (o.statusAdd ? o.statusAdd.here : 0)) * o.oneFoe;
    return finish(o, R);
  }
  // Keeps the raw numbers in underscore fields (for sums), then rounds the visible ones.
  function finish(o, R) {
    o._r = { pre: o.pre, avg: o.avg, total: o.total, pool: o.pool, sa: o.statusAdd ? o.statusAdd.pool : 0, hit: o._hit !== undefined ? o._hit : o.hit };
    for (const k of ['raw', 'hit', 'avg', 'pre', 'here', 'total', 'critHit', 'tick', 'pool']) if (typeof o[k] === 'number') o[k] = R.n(o[k]);
    if (o.statusAdd) o.statusAdd = Object.assign({}, o.statusAdd, { pool: R.n(o.statusAdd.pool), here: R.n(o.statusAdd.here) });
    if (typeof o.dur === 'number') o.dur = R.x(o.dur);
    delete o._hit;
    return o;
  }
  // Shield Bash (Juggernaut rank 3): a free Shield Throw along the charge at `bash` x its damage, striking and returning; no stun.
  function bashPart(q, st, R) {
    const N = St.skillNums('shieldthrow', st), a = N.p.strike, b = N.p.return, M = Math.max(0.1, st.dmg), EC = 1 + st.crit * (st.critMult - 1), k = st.bash;
    const hit = (a.dmg + b.dmg) / 2 * k * M;
    return finish({ id: q.id, label: q.label, per: 'hit', kind: 'hit', el: null, aff: 1, r: 0, proc: true, note: 'a free Shield Throw along the run, no stun', raw: (a.dmg + b.dmg) * k, hit, avg: hit * EC, pre: hit * EC, here: hit * EC, total: hit * EC * 2, oneFoe: 2, kc: st.crit, alwaysCrit: false, noCrit: false, selfVuln: 0 }, R);
  }

  const AIM_TEXT = { dir: 'toward the cursor', ground: 'lands on the cursor', move: 'toward the cursor', self: 'around you' };
  function skillModel(id, slot, p, st, ctx, wpn, R) {
    const sk = ED.SKILLS[id], N = St.skillNums(id, st), parts = [];
    let perCast = 0, perCastAll = 0;
    for (const q of N.parts) {
      if (!q.on) continue;
      const m = id === 'charge' && q.id === 'bash' ? bashPart(q, st, R) : partModel(q, id, st, ctx, wpn, R);
      parts.push(m);
      if (m.kind !== 'zone') { perCast += m._r.total; perCastAll += m.fanN ? m._r.avg * (1 + m.selfVuln) * m.aff * m.fanN * m.waves : m._r.total; }
    }
    const cd = N.cdEff, heals = [];
    for (const q of N.parts) if (q.on && q.heal) {
      const h = q.heal;
      if (h.key) heals.push({ label: h.note || 'heals on cast', frac: C[h.key] });
      else if (h.perMinion) heals.push({ label: h.note || 'heals on cast', perMinion: h.perMinion, cap: h.cap });
    }
    return {
      id, slot, name: sk.name, icon: sk.icon, key: slot ? 'skill2' : 'skill1', cd: R.x(cd), cdBase: sk.cd, charges: slot === 0 ? st.maxCharges : 1, aim: N.aim, aimText: AIM_TEXT[N.aim] || '', range: N.range, rangeMin: N.rangeMin,
      parts, perCast: R.n(perCast), perCastAll: R.n(perCastAll), dpsCd: R.n(perCast / cd), heals, _cd: cd,
    };
  }

  // ---------------- compute ----------------
  // Contribution rows of one stat: [{ label, kind, v, id?, mul? }] from ED.Stats.breakdown (an Ascended multiplier row has mul: true, v = f for a factor of 1 + f) plus the live (temporary) rows of the hero.
  function rowsOf(build, key, extra) {
    const rows = St.breakdown(build, key).map(r => (r.mul ? { label: r.label, kind: r.kind, v: r.v, id: r.id, mul: true } : { label: r.label, kind: r.kind, v: r.v, id: r.id }));
    if (extra) for (const r of extra) if (r.v) rows.push(r);
    return rows;
  }

  // The model of hero p (a World hero, or a mirror hero with p.stats, boons, relics, meta, hp, maxHp, shield, picks) in context ctx (Sheet.ctx).
  // opts.raw keeps every number unrounded (tools, tests); otherwise numbers carry their display precision, so equal builds give equal JSON.
  Sh.compute = (p, ctx, opts) => {
    const R = rounders(opts && opts.raw), st = p.stats, build = buildOf(p, ctx), cls = ED.CLASSES[p.cls];
    const ref = Sh.refFoe(ctx), s = ctx.stratum || 1, tier = clampI(ctx.tier | 0, 0, W.DREAD.length - 1), dread = W.DREAD[tier], thr = W.THREAT[clampI(s - 1, 0, W.THREAT.length - 1)];
    const wpn = weaponModel(p, st, ctx, R);
    const skills = [];
    for (const [i, id] of [cls.skill, cls.skill2].entries()) if (id && ED.SKILLS[id]) skills.push(skillModel(id, i, p, st, ctx, wpn, R));
    const M = Math.max(0.1, st.dmg), cm = st.critMult, c = st.crit, EC = 1 + c * (cm - 1);

    // dash: cooldown, i-frames and the dash boons' hits
    const dash = { cd: R.x(st.dashCd), ifr: 0.17, parts: [] };
    if (st.dashDmg) dash.parts.push({ label: 'Dash hit', dmg: R.n(st.power * st.dashDmg * M * EC), per: 'foe passed', note: `${Math.round(st.dashDmg * 100)}% of Power, once per dash` });
    if (st.dashFrost) dash.parts.push({ label: 'Frost ring', dmg: R.n(st.power * st.dashFrost * M * EC), r: 80, note: `${Math.round(st.dashFrost * 100)}% of Power, chills` });
    if (st.dashFire) dash.parts.push({ label: 'Burning trail', dmg: R.n(ED.procDmg(ED.BOONS.cindertrail, st) * M), per: 'second', note: 'for 2.2 s, Fire' });
    if (st.dashBomb) dash.parts.push({ label: 'Bomb', dmg: R.n(ED.procDmg(ED.RELICS.satchel, st) * M), r: 60, note: 'where you dashed from' });
    if (st.dashBlind) dash.parts.push({ label: 'Blind', dur: R.x(st.dashBlind), note: 'foes you pass (elites half, never bosses)' });

    const proc = procModel(p, st, wpn, skills);

    // offense multipliers, each with its sources
    const mult = {}, dmgExtra = [], atkExtra = [], rate = St.attackRate(p);
    if (st.momentum && p.momN > 0) dmgExtra.push({ label: `Momentum ×${p.momN | 0}`, kind: 'temp', v: st.momentum * (p.momN | 0), live: true });
    if (p.knellT > 0 && p.knellN > 0) dmgExtra.push({ label: `Death Knell ×${p.knellN}`, kind: 'temp', v: 0.04 * p.knellN, live: true });
    if (st.wardrum) atkExtra.push({ label: 'War Drum' + (p.toughRoom ? ' (elite or boss room: doubled)' : ' (doubled in elite and boss rooms)'), kind: 'temp', v: st.wardrum * (p.toughRoom ? 2 : 1), live: !!p.toughRoom });
    if (p.tranceT > 0 && st.trance > 0) atkExtra.push({ label: 'Battle Trance (active)', kind: 'temp', v: st.trance, live: true });
    mult.dmg = { total: R.x(st.dmg + dmgExtra.reduce((a, r) => a + r.v, 0)), rows: rowsOf(build, 'dmg', dmgExtra) };
    mult.atk = { total: R.x(rate - 1 + st.atk), base: R.x(st.atk), aps: R.x(wpn.aps), rows: rowsOf(build, 'atk', atkExtra) };
    mult.crit = { total: R.f(c), mult: R.x(cm), base: R.x(cm - st.critDmg), expected: R.x(EC), rows: rowsOf(build, 'crit'), rowsDmg: rowsOf(build, 'critDmg') };
    mult.area = { total: R.f(st.area), blast: R.x(1 + 0.5 * st.area), arc: R.x(1 + 0.4 * st.area), rows: rowsOf(build, 'area') };
    mult.cdr = { raw: R.f(st.cdr), eff: R.f(St.cdrEff(st.cdr)), soft: St.CDR_SOFT, max: St.CDR_MAX, capped: st.cdr > St.CDR_SOFT, rows: rowsOf(build, 'cdr') };
    mult.projN = { total: st.projN, rows: rowsOf(build, 'projN'), pierce: st.pierce, rowsPierce: rowsOf(build, 'pierce') };
    mult.cond = [];
    for (const r of ED.COND_DMG) {
      if (r.key !== null ? !(st[r.key] > 0) : !(r.own && r.own(st, p))) continue;
      const live = r.live ? r.live(st, p, ctx) : null, v = r.value ? r.value(st, p) : st[r.key];
      mult.cond.push({ id: r.key || r.id, label: r.label, v: R.f(v), live: live === null ? null : R.f(live), per: r.per || null });
    }
    mult.slots = [];
    for (const k of ['s1Dmg', 's1Area', 's1Dur', 's1N', 's1Cdr', 's2Dmg', 's2Area', 's2Dur', 's2N', 's2Cdr']) if (st[k]) mult.slots.push({ key: k, label: SIF(k).label, v: R.f(st[k]), fmt: SIF(k).fmt, rows: St.breakdown(build, k).map(r => ({ label: r.label, kind: r.kind, v: r.v })) });
    mult.status = [];
    const statusEls = ED.ELEMENT_IDS.filter(el => st[ED.ELEMENTS[el].inf] > 0 || st.element === el).concat(st.bleed > 0 || st.bleedAll > 0 || st.masterstroke ? ['general'] : []);
    for (const el of statusEls) {
      const P = ED.PATHS[el], aff = el === 'general' ? 1 : ED.elemMul(s, el), est = P.sheet.est(proc, st, aff, ref);
      mult.status.push({
        el, name: P.name, color: P.color, icon: P.icon, status: P.status, infuse: R.f(st[P.infuse] || 0), aff: R.x(aff), builtin: el === st.element && !(st[P.infuse] > 0),
        est: Object.assign({}, est, { dps: est.dps === undefined ? undefined : R.n(est.dps), secs: est.secs === undefined ? undefined : R.n(est.secs), pct: est.pct === undefined ? undefined : R.f(est.pct) }),
        rows: P.sheet.rows.filter(k => st[k]).map(k => ({ key: k, label: SIF(k).label, v: R.f(st[k]), fmt: SIF(k).fmt })),
      });
    }
    mult.debuffs = debuffs(p, st);

    // defence
    const armorMul = St.armorMul(st.armor), taken = armorMul * (1 + st.vuln), maxHp = p.maxHp || st.maxHp;
    const deepOn = ctx.deep !== null && ctx.deep !== undefined, deepMul = deepOn ? 1 + W.DEEP * Math.min(W.DEEP_MAX, ctx.deep) : 1;
    const pactMul = (ctx.pact >= 2 ? 1.25 : 1) * (ctx.pact >= 8 ? 1.2 : 1), foeHere = W.dmgScale(s) * thr.dmg * pactMul * dread.dmg * deepMul;
    const def = {
      maxHp, hpBase: R.n(st.hp), hpMul: R.x(st.hpMul), hpRows: rowsOf(build, 'hp'), hpMulRows: rowsOf(build, 'hpMul'),
      armor: R.n(st.armor), armorMul: R.f(armorMul), reduction: R.f(1 - armorMul), armorRows: rowsOf(build, 'armor'), vuln: R.f(st.vuln), vulnRows: rowsOf(build, 'vuln'), taken: R.x(taken),
      dodge: R.f(st.dodge), dodgeRows: rowsOf(build, 'dodge'), ehp: R.n(maxHp / taken / (1 - st.dodge)),
      foeHere: R.x(foeHere), foeParts: { depth: R.x(W.dmgScale(s)), threat: R.x(thr.dmg), pact: R.x(pactMul), dread: R.x(dread.dmg), deep: deepOn ? R.x(deepMul) : null }, deepKnown: deepOn,
      healMul: R.x(st.healMul), heal: R.x(st.healMul * (dread.heal === undefined ? 1 : dread.heal)), healRows: rowsOf(build, 'heal'), pactHeal: R.x(St.pactHeal(ctx.pact | 0)),
      shield: Math.ceil(p.shield || 0), ready: [], situational: [], shields: [], heals: [], window: shieldWin(p, ctx, maxHp, R),
    };
    for (let i = 0; i < Sh.READY.length; i++) { const r = Sh.READY[i]; if (r.owned(st)) def.ready.push({ id: r.id, name: r.name, ready: readyOf(p, i), once: r.id === 'angel' || r.id === 'phoenix' }); }
    defenceExtras(p, st, def, skills);

    const hero = { pid: p.pid, name: p.name, cls: p.cls, clsName: cls.name, title: cls.title, level: ctx.level, xp: ctx.xp, xpNext: ctx.xpNext, hp: Math.ceil(p.hp), maxHp, shield: Math.ceil(p.shield || 0), gold: ctx.gold, picks: p.picks | 0, power: st.power, element: st.element, weaponName: wpn.name, slot: p.slot | 0 };
    const model = {
      hero, ctx: { stratum: s, pact: ctx.pact | 0, tier, party: ctx.party }, weapon: wpn, skills, dash, proc: procOut(proc, R), mult, def, aff: affModel(p, st, ctx), build: buildModel(p, st, ctx, R), lantern: lanternModel(ctx, R, s),
      ref: { hp: R.n(ref.hp), statusHp: R.n(ref.statusHp), r: ref.r }, procs: procList(st, M, R),
    };
    return opts && opts.raw ? model : strip(model);
  };

  // Damage of the items whose strike is a coefficient of Class Power (after the hero multiplier).
  function procList(st, M, R) {
    const out = [], A = 1 + 0.5 * st.area;
    const row = (label, def, note, o) => out.push(Object.assign({ label, dmg: R.n(ED.procDmg(def, st) * M), note }, o));
    if (st.overcharge) row('Overcharge', ED.BOONS.overcharge, `a shockwave with every skill, r ${Math.round(85 * A)}`);
    if (st.thunderbolt) row('Thunderhead', ED.BOONS.thunderhead, `${Math.round(st.thunderbolt * 100)}% per discharge, r 60, Lightning, once per ${C.BOLT_CD} s`, { el: 'lightning' });
    if (st.dashBomb) row('Bomb Satchel', ED.RELICS.satchel, 'where you dash from, r 60');
    if (st.phoenix) row('Phoenix Feather', ED.RELICS.phoenix, 'once per descent when you fall, r 110');
    return out;
  }

  // Foe vulnerabilities and debuffs the build applies, with their rules.
  function debuffs(p, st) {
    const out = [], add = (id, text, v, short) => out.push({ id, name: ED.STATUS[id].name, color: ED.STATUS[id].color, text, v: v || 0, short: short || '' });
    if (st.iceInfuse > 0) add('frozen', ED.STATUS.frozen.rule, 0.25, 'while frozen');
    if (ED.CLASSES[p.cls].skill2 === 'judgment') add('judged', 'Judgment Judges every foe it hits: it takes +20% damage for ' + n1(4 + st.judgeDur) + ' s. Does not stack with other +20% vulnerability.', 0.2, `for ${n1(4 + st.judgeDur)} s (does not stack with other +20%)`);
    if (st.rainHail) add('judged', 'Foes in your Rain take +20% damage (the same +20% as Judged).', 0.2, 'inside your Rain');
    if (st.smokeVuln) add('judged', 'Foes in your smoke take +20% damage (the same +20% as Judged).', 0.2, 'inside your smoke');
    if (st.markV) add('marked', `Marked foes take +${Math.round(st.markV * 100)}% damage from every hero` + (st.volleyMark ? ` for ${n1(st.volleyMark)} s.` : '.'), st.markV, 'from every hero');
    if (st.sunder) add('sundered', 'Each critical hit makes the foe take +4% more damage from you per stack (up to 10).', 0.04, 'per Sunder stack, up to 10');
    if (st.poisonInfuse > 0) add('venom', `Envenomed foes take up to +${Math.round((C.VENOM_AMP + st.corrode) * 100)}% damage from you, half from allies.`, C.VENOM_AMP + st.corrode, 'at full Venom, half from allies');
    return out;
  }

  // The shield window of the hero now: health received from class sources and from all sources in the last SHIELD_WIN_T seconds, with the caps (class sources and all sources).
  function shieldWin(p, ctx, maxHp, R) {
    const w = Sh.shieldWindow(p, ctx.time), mh = Math.max(1, maxHp);
    return { cls: R.n(w.c), all: R.n(w.a), clsPct: R.f(w.c / mh), allPct: R.f(w.a / mh), clsCap: C.SHIELD_WIN_CLASS, allCap: C.SHIELD_WIN_ALL, secs: C.SHIELD_WIN_T };
  }
  // Situational damage reduction, shield sources and heals.
  function defenceExtras(p, st, def, skills) {
    const S = def.situational, sh = def.shields, pc = (v) => trim((v * 100).toFixed(1)) + '%';
    if (st.guardian) S.push({ label: 'Last Stand', text: 'below 30% health: 60% less damage for 3 s (once per 20 s)' });
    if (st.aegis) S.push({ label: 'Aegis Charm', text: 'blocks the next hit completely; recharges in 10 s' });
    if (st.mirror) S.push({ label: 'Mirror Shard', text: `${Math.round(st.mirror * 100)}% to shrug off a projectile` });
    if (st.braceDR) S.push({ label: 'Brace', text: `${Math.round(Math.min(0.4, st.braceDR) * 100)}% less damage for ${n1(st.brace)} s after a Shield Charge (once per ${C.BRACE_CD} s)` });
    if (p.cls === 'cleric') S.push({ label: 'Sanctuary', text: `allies inside take ${Math.round(Math.min(0.4, 0.15 + st.sanctDR) * 100)}% less damage` });
    if (st.judgeWeak) S.push({ label: 'Verdict', text: `Judged foes deal ${Math.round(st.judgeWeak * 100)}% less damage (bosses half)` });
    if (st.chillWeaken) S.push({ label: 'Permafrost', text: `chilled foes deal ${Math.round(st.chillWeaken * 100)}% less damage` });
    if (st.frozenHeart) S.push({ label: 'Frozen Heart', text: 'when hit, freezes foes within 120 (8 s cooldown)' });
    if (st.thorns) S.push({ label: 'Thorns', text: `attackers take ${n1(st.thorns)} damage` });
    if (st.holyInfuse > 0 || st.element === 'holy') sh.push({ label: 'Holy Smite', text: `${pc(Math.min(C.HOLY_GRANT_MAX, st.smiteShield))} per Smite (twice from elites and bosses), once per ${C.HOLY_CD} s per hero, up to ${pc(st.holyCap)}` });
    if (p.cls === 'knight') sh.push({ label: 'Shield Throw catch', text: `${pc(C.CATCH_PER)} per foe struck, up to ${pc(C.CATCH_MAX)}, once per ${C.KWARD_CD} s` });
    if (st.rally) sh.push({ label: 'Rallying Charge', text: `${pc(st.rally)} for you and allies within 100` });
    if (st.mantle) sh.push({ label: 'Phoenix Mantle', text: `${pc(st.mantle)} after a Nova that hits a foe (once per 10 s)` });
    if (st.veil) sh.push({ label: 'Veil of Night', text: `${pc(st.veil)} when you vanish (once per 12 s)` });
    if (st.boneArmor) sh.push({ label: 'Bone Armor', text: `${pc(st.boneArmor)} per minion harvested, up to ${pc(st.boneCap)} (once per 12 s)` });
    if (st.roomWard) sh.push({ label: 'Battle Ward', text: `${pc(st.roomWard)} when an elite room locks` });
    if (p.cls === 'cleric') sh.push({ label: 'Judgment kill', text: '3% for allies within 160, once per cast' });
    if (p.weapon === 'lantern') sh.push({ label: 'Sacred Lantern', text: `${pc(0.015)} of an ally's health per orb, at most once per ${C.LANTERN_CD} s per ally, up to ${pc(C.CLASS_SHIELD_CAP)}; counts toward the class-shield limit of ${pc(C.SHIELD_WIN_CLASS)} per ${C.SHIELD_WIN_T} s` });
    for (const k of skills) for (const h of k.heals) def.heals.push({ label: k.name, text: h.perMinion ? `${pc(h.perMinion)} of max health per minion, up to ${pc(h.cap)}` : `${pc(h.frac)} of max health for you and allies within 180` });
    def.limits = `Class shields give at most ${pc(C.SHIELD_WIN_CLASS)} of max health per ${C.SHIELD_WIN_T} s and all sources ${pc(C.SHIELD_WIN_ALL)}; Battle Ward and the boss door are exempt.`;
  }

  // ---------------- statuses fed by the hero's damage ----------------
  // proc.dps: damage per second of the hero's hits that run heroProcs (crit chance averaged), proc.critDps what the crit hits among them deal per second;
  // proc.rate[el] / proc.pool[el] / proc.bleed as in ED.PATHS[el].sheet.est; proc.split = { weapon, skills, minions } of dps.
  function procModel(p, st, wpn, skills) {
    const c = st.crit, cm = st.critMult, pow = 1 + st.statusPow, rate = {}, pool = {}, split = { weapon: 0, skills: 0, minions: 0 };
    let critDps = 0, all = 0;
    const feed = (dmgPerSec, k, infAdd, wInf) => {
      for (const id of ED.ELEMENT_IDS) {
        let r = st[ED.ELEMENTS[id].inf] + ((infAdd && infAdd[id]) || 0);
        if (wInf && wInf[id] !== undefined) r = Math.max(r, wInf[id]);
        if (r > 0) rate[id] = (rate[id] || 0) + dmgPerSec * r * k * pow;
      }
    };
    // weapon: the attack's hits (the main hits feed with the class weapon rate) and the extras that run procs
    const aps = wpn._aps, wInf = { fire: st.wInfFire || 0, holy: st.wInfHoly || 0 }, one = wpn.oneFoe;
    const direct = wpn._avg * one * aps;
    let wDps = direct;
    feed(direct, 1, null, wInf);
    const ms = wpn._ms; // Masterstroke: 1 attack in ms.every crits for sure at ms.mul, the others at the crit chance
    critDps += wpn._hit * cm * one * aps * (ms ? (1 - 1 / ms.every) * c + ms.mul / ms.every : c);
    const msBleed = ms ? wpn._hit * cm * ms.mul / ms.every * one * aps * Math.max(0, ms.bleed - st.bleed) * pow : 0; // the Bleed it adds above the Bleed on crits
    for (const e of wpn._extras) if (e.proc) { const ps = e.perAttack * aps; wDps += ps; critDps += e.crit ? ps * c * cm / (1 + c * (cm - 1)) : 0; feed(ps, 1, null, e.el ? null : wInf); }
    if (st.weapon.burn) pool.fire = (pool.fire || 0) + direct * st.weapon.burn * pow;
    split.weapon = wDps; all += wDps;
    for (const sk of skills) {
      for (const m of sk.parts) {
        const r = m._r;
        if (m.kind === 'minion') { const per = r.pre * m.oneFoe / sk._cd; feed(per, C.MINION_INFUSE + st.minionInfuse, m.infAdd, null); split.minions += per; all += per; continue; }
        if (m.radiance && m.kind === 'sec') rate.holy = (rate.holy || 0) + m.raw * m.radiance * m.oneFoe * 0.5 / sk._cd; // a Sanctuary tick stores a quarter of its damage (no hero multiplier)
        if (m.kind === 'status') { if (m.statusEl) pool[m.statusEl] = (pool[m.statusEl] || 0) + r.pool / sk._cd; continue; }
        if (m.statusAdd && m.statusAdd.el) pool[m.statusAdd.el] = (pool[m.statusAdd.el] || 0) + r.sa * m.oneFoe / sk._cd;
        if (!m.proc || !m.oneFoe) continue;
        const dps = r.pre * m.oneFoe / sk._cd;
        feed(dps, 1, m.infAdd, null);
        split.skills += dps; all += dps; critDps += r.hit * cm * m.kc * (1 + m.selfVuln) * m.oneFoe / sk._cd;
      }
    }
    return { dps: all, critDps, rate, pool, bleed: critDps * st.bleed * pow + msBleed + all * st.bleedAll * pow, split };
  }
  function procOut(pr, R) {
    const rate = {}, pool = {};
    for (const k in pr.rate) rate[k] = R.n(pr.rate[k]);
    for (const k in pr.pool) pool[k] = R.n(pr.pool[k]);
    return { dps: R.n(pr.dps), critDps: R.n(pr.critDps), rate, pool, bleed: R.n(pr.bleed), split: { weapon: R.n(pr.split.weapon), skills: R.n(pr.split.skills), minions: R.n(pr.split.minions) } };
  }

  // ---------------- affinity and lantern ----------------
  function affModel(p, st, ctx) {
    const mine = [], seen = {};
    const push = (el, why) => { if (!el || seen[el] || !ED.PATHS[el] || !ED.PATHS[el].element) return; seen[el] = 1; mine.push({ el, name: ED.PATHS[el].name, color: ED.PATHS[el].color, why }); };
    for (const k of ED.elementGates(p.boons || {})) push(k, 'path');
    if (st.element) push(st.element, 'class');
    for (const id of p.relics || []) if (ED.RELICS[id] && ED.RELICS[id].el) push(ED.RELICS[id].el, 'relic');
    const at = (stratum) => {
      const b = ED.BIOMES[stratum - 1];
      return { stratum, name: b.name, short: b.short, weak: b.weak, resist: b.resist, mine: mine.map(m => ({ el: m.el, name: m.name, color: m.color, why: m.why, mul: ED.elemMul(stratum, m.el), skillMul: m.el === st.element ? ED.affC(stratum, m.el) : null })) }; // mul: statuses and tagged hits; skillMul: the class element's skills (half the affinity), whichever source listed the element
    };
    const s = clampI(ctx.stratum || 1, 1, ED.BIOMES.length);
    return { now: at(s), next: s < ED.BIOMES.length ? at(s + 1) : null };
  }
  function lanternModel(ctx, R, s) {
    const lm = Math.max(1, ctx.lightMax), light = ctx.light, f = clampI(light / lm, 0, 1), tier = clampI(ctx.tier | 0, 0, W.DREAD.length - 1), D = W.DREAD[tier];
    const pts = (v) => ({ pts: R.n(v), pct: R.f(v / lm) });
    const boss = W.bossLight(f, s);
    return {
      tier, name: ['Bright', 'Dim', 'Dark', 'Lightless'][tier], light: R.n(light), lightMax: R.n(lm), pct: R.f(f), effect: { dmg: D.dmg, elite: D.elite, gloom: D.gloom, glooms: D.glooms, heal: D.heal, gold: D.gold, up: D.up },
      cost: { combat: pts(W.ROOM_COST.combat), elite: pts(W.ROOM_COST.elite), other: pts(W.ROOM_COST.shop) }, boss: { heal: R.f(boss.heal), shield: R.f(boss.shield), gold: boss.gold, embers: boss.embers }, flare: pts(W.FLARE.cost), rooms: ctx.rooms,
    };
  }

  // ---------------- build tab ----------------
  const AILMENT_STATS = ['brand', 'veins', 'contagion', 'festerHit', 'exsang']; // stats that read the ailment count of a foe (World.ailments)
  const ROUTE_WHEN = { t1: 'Offered at team level 3', fork: 'Offered when the stratum I boss falls', r2: 'Rank 2 when the stratum II boss falls', r3: 'Rank 3 when the stratum IV boss falls' };
  const KIND_ORDER = { gate: 0, path: 1, open: 1, route: 0, fork: 1, keystone: 2, evolution: 3, duo: 0, ascended: 0 };
  function buildModel(p, st, ctx, R) {
    const boons = p.boons || {}, gen = ED.isGeneralist(boons), gates = ED.gatePaths(boons), evoPath = ED.evoOf(boons), paths = [];
    for (const k of gates) {
      const P = ED.PATHS[k], aff = ED.pathAffinity(boons, k), keyId = ED.BOON_IDS.find(id => ED.BOONS[id].key && ED.BOONS[id].path === k), evoId = 'evo_' + k, keyAt = ED.keyAffinity(k), evoAt = ED.evoAffinity(k), hasKey = !!(keyId && boons[keyId]);
      const key = { id: keyId, name: keyId ? ED.BOONS[keyId].name : '', owned: hasKey, at: keyAt, state: hasKey ? 'owned' : aff >= keyAt ? 'offers' : 'needs', need: Math.max(0, keyAt - aff) };
      let evoState, takenBy = null;
      if (evoPath === k) evoState = 'evolved'; else if (evoPath) { evoState = 'taken'; takenBy = ED.PATHS[evoPath].name; } else if (hasKey && aff >= evoAt) evoState = 'ready'; else evoState = 'needs';
      paths.push({ id: k, name: P.name, color: P.color, icon: P.icon, element: P.element, aff, key, evo: { id: evoId, name: ED.BOONS[evoId] ? ED.BOONS[evoId].name : '', at: evoAt, state: evoState, takenBy, need: Math.max(0, evoAt - aff), needKey: !hasKey } });
    }
    // duos: the owned one, the one both gates would offer, or what each second gate would add to a single gate
    const duos = [], els = ED.elementGates(boons);
    for (const id in boons) if (ED.BOONS[id] && ED.BOONS[id].duo && boons[id] > 0) duos.push({ id, name: ED.BOONS[id].name, duo: ED.BOONS[id].duo, state: 'owned', text: Sh.text(id, 1, st) });
    let duoWith = null;
    if (!gen && els.length === 2 && !duos.length) {
      const id = ED.duoOf(els[0], els[1]);
      if (id) { const a0 = ED.pathAffinity(boons, els[0]), a1 = ED.pathAffinity(boons, els[1]); duos.push({ id, name: ED.BOONS[id].name, duo: ED.BOONS[id].duo, state: a0 >= ED.DUO_AFFINITY && a1 >= ED.DUO_AFFINITY ? 'offers' : 'needs', text: Sh.text(id, 1, st), need: Math.max(0, ED.DUO_AFFINITY - Math.min(a0, a1)) }); }
    } else if (!gen && els.length === 1) {
      duoWith = [];
      for (const g of ED.ELEMENT_IDS) { if (g === els[0]) continue; const id = ED.duoOf(els[0], g); if (id) duoWith.push({ id, name: ED.BOONS[id].name, with: g, withName: ED.PATHS[g].name, withColor: ED.PATHS[g].color, text: Sh.text(id, 1, st) }); }
    }
    // class route tree
    const rt = ED.classRoute(boons, p.cls), tbl = ED.CLASS_CARDS[p.cls], route = { cls: p.cls, route: rt.route, fork: rt.fork, rank: rt.rank, nodes: [] };
    for (const r of ED.ROUTES) {
      const e = tbl[r], b = ED.BOONS[e.t1];
      route.nodes.push({
        route: r, label: ED.routeLabel(p.cls, r), id: e.t1, name: b.name, icon: b.icon, chosen: rt.route === r, closed: !!rt.route && rt.route !== r, plays: b.plays, text: Sh.text(e.t1, 1, st), when: ROUTE_WHEN.t1,
        forks: e.forks.map((fid) => { const fb = ED.BOONS[fid], rank = boons[fid] | 0; return { id: fid, name: fb.name, icon: fb.icon, tag: fb.tag || '', coop: !!fb.coop, owned: rank > 0, rank, max: fb.max, closed: !!rt.fork && rt.fork !== fid, text: Sh.text(fid, rank || 1, st), when: rank ? (rank < fb.max ? ROUTE_WHEN[rank === 1 ? 'r2' : 'r3'] : '') : rt.fork ? '' : ROUTE_WHEN.fork, weapon: fb.weapon && fb.weapon.kind ? ED.forkWeapon(p.weapon, fid).name : null }; }),
      });
    }
    // boons grouped by owned path (gate, boons, keystone, evolution), duo, class route and open
    const rows = [];
    for (const id in boons) {
      const b = ED.BOONS[id], rank = boons[id];
      if (!b || !(rank > 0) || (b.cls && b.cls !== p.cls)) continue;
      const max = ED.maxRank(b, st), kind = b.evo ? 'evolution' : b.asc ? 'ascended' : b.key ? 'keystone' : b.gate ? 'gate' : b.duo ? 'duo' : b.route ? (b.tier === 1 ? 'route' : 'fork') : b.path && !b.open ? 'path' : 'open';
      const group = b.cls ? 'route' : b.duo ? 'duo' : b.asc ? 'asc' : b.path && !b.open && gates.includes(b.path) ? 'path:' + b.path : 'open';
      rows.push({ id, name: b.name, icon: b.icon, rar: b.rar, rank, max, kind, group, path: b.path || (b.duo ? b.duo[0] : null), path2: b.duo ? b.duo[1] : null, tag: b.tag || '', coop: !!b.coop, text: Sh.text(id, rank, st), next: rank < max ? Sh.nextText(id, rank, st) : null });
    }
    const groups = gates.map(k => 'path:' + k).concat(['duo', 'route', 'asc', 'open']).map(g => ({ group: g, path: g.indexOf('path:') === 0 ? g.slice(5) : null, items: rows.filter(r => r.group === g).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) })).filter(g => g.items.length);
    const relics = (p.relics || []).map(id => {
      const r = ED.RELICS[id], i = Sh.READY.findIndex(x => x.id === id);
      return { id, name: r.name, icon: r.icon, rar: r.rar, text: r.desc, live: relicLive(id, p, st, ctx), state: i >= 0 ? (readyOf(p, i) ? 'ready' : id === 'angel' || id === 'phoenix' ? 'used' : 'recharging') : null, el: r.el || null };
    });
    const statuses = [];
    for (const m of ED.ELEMENT_IDS) if (st[ED.ELEMENTS[m].inf] > 0 || st.element === m) { const S = ED.STATUS[ED.PATHS[m].status]; statuses.push({ id: ED.PATHS[m].status, name: S.name, color: S.color, rule: S.rule, el: m }); }
    if (st.bleed > 0 || st.bleedAll > 0 || st.masterstroke) statuses.push({ id: 'bleed', name: ED.STATUS.bleed.name, color: ED.STATUS.bleed.color, rule: ED.STATUS.bleed.rule, el: null });
    if (AILMENT_STATS.some(k => st[k] > 0)) statuses.push({ id: 'ailment', name: ED.STATUS.ailment.name, color: ED.STATUS.ailment.color, rule: ED.STATUS.ailment.rule, el: null });
    return {
      generalist: gen, paths, slotsFree: gen ? 0 : Math.max(0, ED.MAX_ELEMENTS - gates.length), slots: ED.MAX_ELEMENTS, evolved: evoPath, picks: p.picks | 0,
      classElementRow: !gen && st.element && !gates.includes(st.element) ? { el: st.element, name: ED.PATHS[st.element].name, color: ED.PATHS[st.element].color, icon: ED.PATHS[st.element].icon } : null,
      duos, duoWith, route, groups, relics, statuses,
    };
  }
  // The live value of a relic whose effect depends on the run.
  function relicLive(id, p, st, ctx) {
    const n = (p.relics || []).length;
    if (id === 'idol') return `Now +${Math.round(Math.min(0.2, Math.floor((ctx.gold || 0) / 15) * 0.01) * 100)}% damage`;
    if (id === 'banner') return `Now +${Math.round(st.banner * (1 + (ctx.allyNear | 0)) * 100)}% damage`;
    if (id === 'chalice') return `Now +${p.chaliceHp | 0} of 30 health` + ((p.chaliceHp | 0) >= 30 ? ', +10% damage' : '');
    if (id === 'stone') return `Now +${2 * n}% damage, +${2 * n} health`;
    if (id === 'wardrum') return p.toughRoom ? 'Now +20% (elite or boss room)' : null;
    return null;
  }

  // ---------------- offers: the change a card makes ----------------
  // A copy of hero p with boon `id` one rank higher and the stat block rebuilt (ctx supplies the pact).
  Sh.withBoon = (p, id, ctx) => {
    const boons = Object.assign({}, p.boons || {});
    boons[id] = (boons[id] || 0) + 1;
    const q = Object.assign({}, p, { boons });
    q.stats = St.compute({ cls: p.cls, weapon: p.weapon, boons, relics: p.relics || [], meta: p.meta, pact: ctx ? ctx.pact | 0 : 0, chaliceHp: p.chaliceHp || 0, bonusHp: p.bonusHp || 0 });
    q.maxHp = (p.maxHp || p.stats.maxHp) + (q.stats.maxHp - p.stats.maxHp); // the hero's own max health plus what the card adds (a mirror's snapshot value leads its rebuilt stats)
    return q;
  };
  // The (at most 2) numbers a card changes most, from the models of the hero now (a) and with the card (b): [{ label, from, to, unit, better }].
  Sh.deltas = (a, b) => {
    const cands = [];
    const push = (label, from, to, unit, lowerBetter) => {
      if (Math.abs(to - from) < 1e-9) return;
      const rel = from > 0 ? Math.abs(to - from) / from : to > 0 ? Infinity : 0;
      if (rel >= 0.005) cands.push({ label, from, to, unit, better: lowerBetter ? to < from : to > from, rel });
    };
    push('Weapon', a.weapon.dps, b.weapon.dps, 'dps');
    for (let i = 0; i < 2; i++) if (a.skills[i] && b.skills[i]) push(a.skills[i].name, a.skills[i].perCast, b.skills[i].perCast, 'per cast');
    const sumDps = (m) => m.mult.status.reduce((s, x) => s + (x.est && x.est.dps || 0), 0);
    push('Status damage', sumDps(a), sumDps(b), 'dps');
    push('Effective health', a.def.ehp, b.def.ehp, '');
    push('Max health', a.def.maxHp, b.def.maxHp, '');
    for (let i = 0; i < 2; i++) if (a.skills[i] && b.skills[i]) push(a.skills[i].name + ' cooldown', a.skills[i].cd, b.skills[i].cd, 's', true);
    cands.sort((x, y) => y.rel - x.rel);
    return cands.slice(0, 2).map(d => ({ label: d.label, from: d.from, to: d.to, unit: d.unit, better: d.better }));
  };
})(globalThis.ED || (globalThis.ED = {}));
