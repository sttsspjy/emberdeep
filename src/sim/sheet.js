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
    for (const k in ED.ENEMIES) { const e = ED.ENEMIES[k]; if (!e.boss && !e.minion && !e.ally && !e.fodder && e.hp > 0) hs.push(e.hp); }
    hs.sort((a, b) => a - b);
    return (medianHp = hs[hs.length >> 1] || 30);
  };
  // A typical foe of the context's stratum: hp (real), statusHp (before the stratum lever: the unit chill and Venom measure against), r.
  Sh.refFoe = (ctx) => {
    const s = ctx.stratum || 1, pact = ctx.pact | 0, thr = W.THREAT[Math.max(0, Math.min(W.THREAT.length - 1, s - 1))].hp;
    const hp = rosterMedian() * W.hpScale(s) * W.partyHpMul(ctx.party || 1) * (pact >= 1 ? 1.25 : 1) * (pact >= 10 ? 1.2 : 1);
    return { hp, statusHp: hp / thr, r: Sh.REF.r };
  };
  // The numbers about the run the sheet needs from a World or a Mirror (duck-typed: players, allies, floor, roomState, room, gold, level, xp).
  Sh.ctx = (view, p) => {
    let allyNear = 0, minions = 0;
    const party = [];
    if (view.players) for (const q of view.players.values()) {
      party.push({ pid: q.pid, name: q.name, cls: q.cls, hp: Math.ceil(q.hp), maxHp: q.maxHp, slot: q.slot | 0, downed: !!q.downed, dead: !!q.dead });
      if (q !== p && !q.downed && !q.dead && U.dist2(q.x, q.y, p.x, p.y) < 200 * 200) allyNear++;
    }
    if (view.allies) for (const a of view.allies) if (a.owner === p.pid && a.k !== 2) minions++; // a bone bomb (k 2) is not a minion
    const rooms = view.floor ? view.floor.rooms : [];
    let seen = 0, darkTotal = 0, darkLeft = 0;
    for (const r of rooms) {
      const s = view.roomState && view.roomState[r.id], visited = !!(s && s.visited);
      if (visited) seen++;
      if (r.dark) { darkTotal++; if (!visited) darkLeft++; }
    }
    return {
      stratum: view.stratum || 1, pact: view.pact | 0, gold: view.gold | 0, level: view.level || 1, xp: Math.floor(view.xp || 0), xpNext: view.xpNext || 1,
      dark: !!(view.room && view.room.dark), allyNear, minions, room: view.room ? { type: view.room.type, id: view.roomId } : null,
      party: view.players ? view.players.size : 1, rooms: { seen, total: rooms.length, darkTotal, darkLeft }, heroes: party, time: view.time || 0,
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
  // Pack assumptions of the Ranger forms. PACK_REF: the pack size a pack-only extra is written for (tools/sheet.js counts every extra once per foe of its pack). SIEGE_BLAST_HIT: share of siege bolts whose end blast catches a pack foe.
  // RIC_HIT: share of shots whose ricochet finds a second foe. PLAGUE_KEEP / PLAGUE_PACK: share of its pool inputs a dying foe (2+ ailments) still holds, and the pool input of a pack against one foe (skills hit every foe);
  // both and SPREAD_PAY (the share of a burst's value that a status spread pays) are fitted to a staged fight of a stratum III mid build against a pack of 4 trash foes. FESTER_UP: uptime of 3+ ailments for Gangrene.
  const PACK_REF = 4, SIEGE_BLAST_HIT = 0.5, RIC_HIT = 0.8, PLAGUE_KEEP = 0.9, PLAGUE_PACK = 1.5, SPREAD_PAY = 0.5, FESTER_UP = 0.5;
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
    if (cleaveEvery && st.fissure) add('Fissure', Wd * st.fissure * M / cleaveEvery, { stun: st.cStun, note: 'each Cleave: a fissure 180 long strikes every foe on it once, no crit' }); // Earthsplitter (class-knight.js fissure)
    if (cleaveEvery && st.bladeWave) add('Blade wave', Wd * st.bladeWave * M * EC / cleaveEvery, { proc: true, crit: true, note: 'each Cleave: a wave 180 long pierces every foe on it (a Parry fans three)' }); // Thousand Edges (class-knight.js bladeWaves)
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
    if (st.lich > 0) { // Lich Form: two soul bolts of lichMul of a hit with every attack inside the window that follows each Bone Harvest
      const up = Math.min(1, st.lichT / Math.max(st.lichT, St.skillNums('harvest', st).cdEff));
      add('Lich bolts', 2 * st.lichMul * avg * up, { proc: true, crit: true, note: `2 soul bolts per attack for ${n1(st.lichT)} s after each Bone Harvest, averaged over its cooldown` });
    }
    // Masterstroke (combat.js playerAttack): every MS.every-th attack crits for sure at MS.mul, and its blast and shock take the MS.mul too; the extra is that attack's surplus over a normal one
    const ms = st.masterstroke ? MS : null;
    if (ms) {
      let side = 0;
      for (const e of extras) if (e.label === 'Blast' || e.label === 'Shockwave') side += e.perAttack;
      add('Masterstroke', ((hit * cm * ms.mul - avg) * one + (ms.mul - 1) * side) / ms.every, { proc: true, note: `every ${ordinal(ms.every)} attack: a guaranteed crit at ×${ms.mul} that Bleeds for at least ${Math.round(ms.bleed * 100)}% of the hit` });
    }
    // Ranger riders and forms (class-ranger.js): Flurry's extra arrows (those of the fan that reach a foe at REF), the siege bolt's extra damage (every siege-th shot, x siegeMul) and its end blast, Storm Bow's ricochet
    if (!melee && st.flurry > 0) {
      const extra = 2 + Math.max(0, Math.round(st.flurryN)), step = extra > 2 ? 0.09 : 0.12, fo = [];
      for (let k = 0; k < extra; k++) fo.push((k & 1 ? 1 : -1) * ((k >> 1) + 1) * step);
      add('Flurry', avg * st.flurryMul * fanHits(fo, w.r) / st.flurry, { proc: true, crit: true, note: `every ${ordinal(st.flurry)} shot: ${extra} extra arrows at ${Math.round(st.flurryMul * 100)}%` });
    }
    if (!melee && st.siege > 0) {
      add('Siege bolt', avg * (st.siegeMul - 1) / st.siege, { proc: true, crit: true, note: `every ${ordinal(st.siege)} shot: ×${trim(st.siegeMul.toFixed(2))} damage, twice as wide, pierces every foe` });
      add('Siege blast', Wd * M * st.siegeMul * st.siegeBlast * SIEGE_BLAST_HIT / st.siege, { proc: true, packOnly: true, r: Math.round(60 * area), note: `where a siege bolt ends, in a pack (about ${Math.round(SIEGE_BLAST_HIT * 100)}% of the time), no crit` });
    }
    if (!melee && st.ricochet > 0) { // a shot (and each Flurry arrow, at its share) ricochets once, hitting a second foe in a pack about RIC_HIT of the time; extras count x the pack, so the value is per foe of a PACK_REF pack
      const shots = 1 + (st.flurry > 0 ? (2 + Math.max(0, Math.round(st.flurryN))) * st.flurryMul / st.flurry : 0);
      add('Ricochet', avg * st.ricochet * RIC_HIT * shots / PACK_REF, { proc: true, crit: true, packOnly: true, note: `${Math.round(st.ricochet * 100)}% to a second foe within 140, in a pack (about ${Math.round(RIC_HIT * 100)}% of the time)` });
    }
    let sum = 0;
    for (const e of extras) if (!e.packOnly) sum += e.perAttack; // a pack-only extra needs a second foe: it is left out of the damage on one foe
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
  const FESTER_PARTS = new Set(['volley.arrow', 'rain.tick', 'rain.sky', 'rain.sky2', 'rain.shower']); // the parts Gangrene boosts (class-ranger.js SKILL_PARTS)
  // One part of a skill at the hero's stats: hit (per landed hit with the hero multiplier), avg (with the crit chance), pre (with the vulnerability the part sets), here (with the stratum affinity), total (here x hits on one foe).
  // A class-element part takes half the stratum affinity (ED.affC) and the class-element multiplier; statuses take the full affinity.
  function partModel(q, skillId, st, ctx, wpn, R) {
    const stratum = ctx.stratum, clsEl = q.el === 'class' && st.element ? st.element : null, tag = clsEl || (q.el && q.el !== 'class' ? q.el : null);
    const aff = clsEl ? ED.affC(stratum, clsEl) : tag ? ED.elemMul(stratum, tag) : 1;
    const M = Math.max(0.1, st.dmg + (clsEl ? st.classElMul : 0)), cm = st.critMult, c = st.crit, EC = 1 + c * (cm - 1);
    const o = { id: q.id, label: q.label, per: q.per, el: tag, aff: R.x(aff), r: q.r && !q.pRad ? Math.round(q.r) : 0, dur: q.dur, every: q.every, delay: q.delay, count: q.count, n: q.n, attacks: q.attacks, stun: q.stun, knock: q.knock, note: q.note || '', proc: procDefault(q), radiance: q.radiance || 0, noCrit: !!q.noCrit, alwaysCrit: q.crit === true, selfVuln: q.selfVuln || 0, infAdd: q.infAdd || null };
    if (q.per === 'minion') { // a Bone Knight strikes every 0.5 s for x KNIGHT_MUL; the Death Knight (one unit) for x dkMul
      const per = q.dmg * (1 + st.minionDmg) * (C.COMP_MUL || 0.85) * (st.dk > 0 ? st.dkMul : st.knights > 0 ? C.KNIGHT_MUL : 1), live = st.dk > 0 ? 1 : Math.min(ctx.minions > 0 ? ctx.minions : q.n, st.maxMinions || 3), hits = Math.floor((q.dur || 0) / (st.knights > 0 ? 0.5 : q.every) + 1e-9);
      Object.assign(o, { kind: 'minion', raw: q.dmg, hit: per, avg: per, pre: per, here: per, hitsEach: hits, minions: live, oneFoe: live * hits, total: per * live * hits, kc: 0, dkCleave: st.dk > 0 });
      return finish(o, R);
    }
    if (q.per === 'status') {
      const S = ED.STATUS[q.status], mul = S && S.mulKey ? 1 + (st[S.mulKey] || 0) : 1, aff2 = S && S.el ? ED.elemMul(stratum, S.el) : 1;
      let pool = q.dmg * (q.status === 'burn' ? 1 + st.classElMul : 1);
      if (skillId === 'nova' && q.status === 'burn' && st.novaEcho > 0) pool *= 1 + st.novaEcho; // the second eruption (or the Supernova wave) adds the Burn again at novaEcho
      Object.assign(o, { kind: 'status', raw: q.dmg, status: q.status, statusName: S ? S.name : q.status, statusEl: S ? S.el : null, aff: R.x(aff2), pool, hit: 0, avg: pool, pre: pool, here: pool * aff2 * mul, total: pool * aff2 * mul, oneFoe: 1, kc: 0 });
      return finish(o, R);
    }
    if (q.per === 'zone') return finish(Object.assign(o, { kind: 'zone', raw: 0, hit: 0, avg: 0, pre: 0, here: 0, total: 0, oneFoe: 0, kc: 0 }), R);
    const sec = q.per === 'sec', always = q.crit === true, kc = always ? 1 : q.noCrit || sec ? 0 : c;
    let raw = q.dmg || 0, oneFoe = q.oneFoe;
    // Cast-time factors skillNums leaves out (the casts apply them): Shield Storm throws two shields (Aegis Tempest three) at twinShield each, all reach a foe at REF; Comet's impact lands at 1 + comet.
    if (skillId === 'shieldthrow' && (st.twinShield > 0 || st.tempest > 0) && (q.id === 'strike' || q.id === 'return')) { raw *= st.twinShield > 0 ? st.twinShield : 1; oneFoe = st.tempest > 0 ? Math.round(st.tempest) : 2; }
    else if (skillId === 'meteor' && q.id === 'impact' && st.comet > 0) raw *= 1 + st.comet;
    const fester = st.festerHit > 0 && FESTER_PARTS.has(skillId + '.' + q.id) ? 1 + st.festerHit * FESTER_UP : 1; // Gangrene: Volley and Rain hits on foes with 3+ ailments, at an assumed uptime
    const hit = raw * M * fester * (sec ? 0.5 : 1);
    if (q.fan) { // a fan spreads its arrows over fan radians (a ring: evenly round the circle); a later wave (q.waves) repeats the fan
      const offs = [];
      for (let i = 0; i < q.n; i++) offs.push(q.ring ? i / q.n * q.fan : q.n > 1 ? (i / (q.n - 1) - 0.5) * q.fan : 0);
      oneFoe = fanHits(offs, q.pr || 5) * (q.waves || 1); o.fanN = q.n; o.waves = q.waves || 1; o.fan = q.fan;
    }
    if (q.ref) { let hits = 0; for (let k = 0; k < q.n; k++) if (q.ref * (q.n - 1 - k) / q.n <= q.r + Sh.REF.r) hits++; oneFoe = hits; } // Starfall: the impacts walk from the hero to a target q.ref px away; a foe there is in reach of some of them
    if (q.id === 'ambush' && skillId === 'vanish') oneFoe = wpn.oneFoe; // each of the weapon's hits carries the Ambush value
    else if (skillId === 'vanish' && (q.id === 'edge' || q.id === 'clone')) oneFoe = wpn.oneFoe * (q.attacks || 0); // the Eclipse repeats and the clone's attacks: one weapon attack each
    if (skillId === 'judgment' && q.id === 'leg' && st.storm > 0) { // Hammerstorm: the fan of hammers (step 0.25 rad) that reach a foe at REF, four legs each
      const n = Math.round(st.storm), offs = [];
      for (let i = 0; i < n; i++) offs.push((i - (n - 1) / 2) * 0.25);
      oneFoe = fanHits(offs, q.r) * 4;
    }
    if (q.perMinion) { // one hit per minion: the minions you have now (all of them when none), or the ones this cast raises
      oneFoe = q.perMinion === 'cast' ? St.skillNums('legion', st).p.minion.n : ctx.minions > 0 ? Math.min(ctx.minions, st.maxMinions || 3) : st.maxMinions || 3;
      if (skillId === 'legion' && q.id === 'field') oneFoe = (oneFoe + (st.bloom > 0 ? C.BOMB_N : 0)) * q.count; // a bone field under every burst: the minions' and the bombs', each ticking q.count times
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
    if (!build) return [];
    const rows = St.breakdown(build, key).map(r => (r.mul ? { label: r.label, kind: r.kind, v: r.v, id: r.id, mul: true } : { label: r.label, kind: r.kind, v: r.v, id: r.id }));
    if (extra) for (const r of extra) if (r.v) rows.push(r);
    return rows;
  }

  // The model of hero p (a World hero, or a mirror hero with p.stats, boons, relics, meta, hp, maxHp, shield, picks) in context ctx (Sheet.ctx).
  // opts.raw keeps every number unrounded (tools, tests); otherwise numbers carry their display precision, so equal builds give equal JSON.
  // opts.numbers (tools): no source rows and no Build tab (build: null); every other number is the same.
  Sh.compute = (p, ctx, opts) => {
    const lite = !!(opts && opts.numbers), R = rounders(opts && opts.raw), st = p.stats, build = lite ? null : buildOf(p, ctx), cls = ED.CLASSES[p.cls];
    const ref = Sh.refFoe(ctx), s = ctx.stratum || 1, thr = W.THREAT[clampI(s - 1, 0, W.THREAT.length - 1)];
    const wpn = weaponModel(p, st, ctx, R);
    const skills = [];
    for (const [i, id] of [cls.skill, cls.skill2].entries()) if (id && ED.SKILLS[id]) skills.push(skillModel(id, i, p, st, ctx, wpn, R));
    const M = Math.max(0.1, st.dmg), cm = st.critMult, c = st.crit, EC = 1 + c * (cm - 1);

    // dash: recharge per charge, charges, i-frames and the dash boons' hits
    const dash = { cd: R.x(st.dashCd), charges: st.dashCharges, ifr: ED.CONST.DASH.t, parts: [] };
    if (st.dashDmg) dash.parts.push({ label: 'Dash hit', dmg: R.n(st.power * st.dashDmg * M * EC), per: 'foe passed', note: `${Math.round(st.dashDmg * 100)}% of Power, once per dash` });
    if (st.dashFrost) dash.parts.push({ label: 'Frost ring', dmg: R.n(st.power * st.dashFrost * M * EC), r: 80, note: `${Math.round(st.dashFrost * 100)}% of Power, chills` });
    if (st.dashFire) dash.parts.push({ label: 'Burning trail', dmg: R.n(ED.procDmg(ED.BOONS.cindertrail, st) * M), per: 'second', note: 'for 2.2 s, Fire' });
    if (st.dashBomb) dash.parts.push({ label: 'Bomb', dmg: R.n(ED.procDmg(ED.RELICS.satchel, st) * M), r: 60, note: 'where you dashed from' });
    if (st.dashBlind) dash.parts.push({ label: 'Blind', dur: R.x(st.dashBlind), note: 'foes you pass (elites half, never bosses)' });

    const proc = procModel(p, st, wpn, skills);
    elementForms(st, wpn, skills, proc, ref, R);
    if (st.contagion > 0) poolExtras(wpn, st, proc, s, R);
    if (p.cls === 'necro') { const ex = necroForms(st, wpn, skills, proc, ref, s, R); if (ex.length) { for (const e of ex) wpn._extras.push(e); refit(wpn, R); } }

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
      mult.cond.push({ id: r.key || r.id, label: r.key === 'brand' && st.brandCap > 4 ? r.label.replace('up to 4', 'up to ' + st.brandCap) : r.label, v: R.f(v), live: live === null ? null : R.f(live), per: r.per || null }); // Doombrand raises Brand's cap
    }
    mult.slots = [];
    for (const k of ['s1Dmg', 's1Area', 's1Dur', 's1N', 's1Cdr', 's2Dmg', 's2Area', 's2Dur', 's2N', 's2Cdr']) if (st[k]) mult.slots.push({ key: k, label: SIF(k).label, v: R.f(st[k]), fmt: SIF(k).fmt, rows: build ? St.breakdown(build, k).map(r => ({ label: r.label, kind: r.kind, v: r.v })) : [] });
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
    const pactMul = (ctx.pact >= 2 ? 1.25 : 1) * (ctx.pact >= 8 ? 1.2 : 1), darkMul = ctx.dark ? W.DARK_DMG : 1, foeHere = W.dmgScale(s) * thr.dmg * pactMul * darkMul;
    const def = {
      maxHp, hpBase: R.n(st.hp), hpMul: R.x(st.hpMul), hpRows: rowsOf(build, 'hp'), hpMulRows: rowsOf(build, 'hpMul'),
      armor: R.n(st.armor), armorMul: R.f(armorMul), reduction: R.f(1 - armorMul), armorRows: rowsOf(build, 'armor'), vuln: R.f(st.vuln), vulnRows: rowsOf(build, 'vuln'), taken: R.x(taken),
      dodge: R.f(st.dodge), dodgeRows: rowsOf(build, 'dodge'), ehp: R.n(maxHp / taken / (1 - st.dodge)),
      foeHere: R.x(foeHere), foeParts: { depth: R.x(W.dmgScale(s)), threat: R.x(thr.dmg), pact: R.x(pactMul), dark: ctx.dark ? R.x(darkMul) : null },
      healMul: R.x(st.healMul), healRows: rowsOf(build, 'heal'), pactHeal: R.x(St.pactHeal(ctx.pact | 0)),
      shield: Math.ceil(p.shield || 0), ready: [], situational: [], shields: [], heals: [], window: shieldWin(p, ctx, maxHp, R),
    };
    for (let i = 0; i < Sh.READY.length; i++) { const r = Sh.READY[i]; if (r.owned(st)) def.ready.push({ id: r.id, name: r.name, ready: readyOf(p, i), once: r.id === 'angel' || r.id === 'phoenix' }); }
    defenceExtras(p, st, def, skills);

    const hero = { pid: p.pid, name: p.name, cls: p.cls, clsName: cls.name, title: cls.title, level: ctx.level, xp: ctx.xp, xpNext: ctx.xpNext, hp: Math.ceil(p.hp), maxHp, shield: Math.ceil(p.shield || 0), gold: ctx.gold, picks: p.picks | 0, power: st.power, element: st.element, weaponName: wpn.name, slot: p.slot | 0 };
    const model = {
      hero, ctx: { stratum: s, pact: ctx.pact | 0, dark: !!ctx.dark, party: ctx.party }, weapon: wpn, skills, dash, proc: procOut(proc, R), mult, def, aff: affModel(p, st, ctx), build: lite ? null : buildModel(p, st, ctx, R), dark: darkModel(ctx),
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
    if (st.doombrand) add('marked', `Doombrand: a foe holding 4 or more ailments is Marked for 4 s and takes +${Math.round(st.brandMark * 100)}% damage from every hero.`, st.brandMark, 'from every hero, at 4 ailments');
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
    if (st.braceDR && st.lich > 0) S.push({ label: 'Lich Form', text: `${Math.round(Math.min(0.4, st.braceDR) * 100)}% less damage for ${n1(st.lichT)} s after Bone Harvest` });
    else if (st.braceDR) S.push({ label: 'Brace', text: `${Math.round(Math.min(0.4, st.braceDR) * 100)}% less damage for ${n1(st.brace)} s after a Shield Charge (once per ${C.BRACE_CD} s)` });
    if (p.cls === 'cleric') S.push({ label: 'Sanctuary', text: `allies inside take ${Math.round(Math.min(st.aegis > 0 ? C.DR_FLOOR : 0.4, 0.15 + st.sanctDR + st.aegisDR) * 100)}% less damage` });
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
    def.limits = `Class shields give at most ${pc(C.SHIELD_WIN_CLASS)} of max health per ${C.SHIELD_WIN_T} s and all sources ${pc(C.SHIELD_WIN_ALL)}; Battle Ward is exempt.`;
  }

  // Contagion and Plaguebearer (need the status model): pack-only extras on the pools of a dying foe. Every foe that dies with 2+ ailments leaves PLAGUE_KEEP of the pool inputs of the hero's damage
  // (Bleed, Burn at the stratum affinity; a pack takes PLAGUE_PACK x the single-target input) on it. Plaguebearer hands PACK_REF - 1 neighbours plagueBurst of it at once; Contagion and Outbreak move shares of it
  // (recipients x share) to the nearest foes as pools that drain over seconds, SPREAD_PAY of what a burst would pay.
  function poolExtras(wpn, st, proc, s, R) {
    const burn = ((proc.rate.fire || 0) * ED.elemMul(s, 'fire') + (proc.pool.fire || 0)) * (1 + st.burnMul), bleed = (proc.bleed || 0) * (1 + st.bleedMul);
    const unit = PLAGUE_KEEP * PLAGUE_PACK * (burn + bleed) / wpn._aps / PACK_REF, out = st.contagionN > 0;
    const push = (label, perAttack, note, r) => {
      const e = { label, perAttack, proc: false, packOnly: true, r, note };
      wpn._extras.push(e);
      wpn.extras.push(Object.assign({}, e, { perAttack: R.n(perAttack), perSec: R.n(perAttack * wpn._aps) }));
    };
    if (st.plague > 0) push('Plaguebearer burst', (PACK_REF - 1) * st.plagueBurst * unit, `a foe with 2+ ailments dying hands ${Math.round(st.plagueBurst * 100)}% of its Bleed and Burn to the foes round it, in a pack`, 90);
    else if (st.contagion > 0) push(out ? 'Outbreak spread' : 'Contagion spread', Math.min(out ? 3 : 2, PACK_REF - 1) * (out ? st.outbreak : st.contagion) * SPREAD_PAY * unit, `a foe with 2+ ailments dying passes its statuses to the nearest ${out ? 3 : 2} foes, in a pack`, 0);
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
    for (const e of wpn._extras) if (e.proc && !e.packOnly) { const ps = e.perAttack * aps; wDps += ps; critDps += e.crit ? ps * c * cm / (1 + c * (cm - 1)) : 0; feed(ps, 1, null, e.el ? null : wInf); }
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

  // ---------------- Knight element forms: Doombrand and Bloodquake ----------------
  // The count of ailments on a typical foe, [P(0), P(1), ...], from the assumptions of tools/sheet.js: an infusion 70%, the class element 50%, Bleed 70%, Dazed 35%, Sealed always.
  function ailmentDist(st) {
    let d = [1];
    const add = (q) => { const nd = new Array(d.length + 1).fill(0); for (let k = 0; k < d.length; k++) { nd[k] += d[k] * (1 - q); nd[k + 1] += d[k] * q; } d = nd; };
    for (const id of ED.ELEMENT_IDS) if (st[ED.ELEMENTS[id].inf] > 0) add(0.7); else if (st.element === id) add(0.5);
    if (st.bleed > 0 || st.bleedAll > 0 || st.masterstroke) add(0.7);
    add(0.35);
    if (st.seal > 0) d.unshift(0);
    return d;
  }
  const atLeast = (d, k) => d.reduce((s, v, i) => s + (i >= k ? v : 0), 0), meanMin = (d, cap) => d.reduce((s, v, i) => s + v * Math.min(i, cap), 0);
  const DOOM_AT = 4, BQUAKE_AT = 3, BQUAKE_R = 80, POOL_K = 2.5, PACK = 4; // POOL_K: a Bleed pool drains 40% a second, so it holds 2.5 s of income. PACK: the foes of the pack tools/sheet.js reads (the other 3 catch a burst)
  // Doombrand adds one weapon extra, the damage that the Mark (foes holding DOOM_AT ailments take +brandMark from every hero) and the two extra Brand ailments add to the weapon and the skills of the hero's own hits (co-op allies gain more, not counted).
  // Bloodquake adds the extra damage of its payout (pool x bloodquakeMul, one strike per cast on a foe) to the Shield Throw's damage on one foe, and a part for packs: each of the PACK - 1 others within BQUAKE_R catches bloodquakeSplash of the amount paid (a pool holds POOL_K x the Bleed income), at most SPREAD_CAP of a foe's health.
  // A strike detonates a foe holding BQUAKE_AT ailments at most once a second.
  function elementForms(st, wpn, skills, proc, ref, R) {
    if (st.doombrand > 0) {
      const d = ailmentDist(st), M = Math.max(0.1, st.dmg), p4 = atLeast(d, DOOM_AT), fBrand = st.brand * (meanMin(d, st.brandCap) - meanMin(d, 4)) / M, fMark = p4 * st.brandMark, f = (1 + fBrand) * (1 + fMark) - 1;
      let x = 0, sk = 0;
      for (const e of wpn._extras) x += e.perAttack;
      for (const k of skills) for (const q of k.parts) if (q.kind !== 'zone') sk += q._r.total / k._cd;
      const per = (wpn._avg * wpn.oneFoe + x + sk / wpn._aps) * f;
      wpn._extras.push({ label: 'Doombrand', perAttack: per, proc: false, note: `foes with ${DOOM_AT} ailments (about ${Math.round(p4 * 100)}% of the time) are Marked: +${Math.round(st.brandMark * 100)}% from every hero; Brand counts up to ${st.brandCap}` });
      refit(wpn, R);
    }
    if (st.bloodquake > 0 && skills.length > 1) {
      const k2 = skills[1], k1 = skills[0], strike = k2.parts.find(q => q.id === 'strike'), p3 = atLeast(ailmentDist(st), BQUAKE_AT);
      if (strike) {
        const bm = 1 + st.bleedMul, pool = POOL_K * proc.bleed, paid = pool * bm * (1 + st.bloodquakeMul), own = pool * bm * st.bloodquakeMul, give = Math.min(st.bloodquakeSplash * paid, C.SPREAD_CAP * ref.hp) * bm;
        const one = p3 * (k2._cd / k2._cd + k2._cd / k1._cd) * own, det = p3 * (Math.min(PACK, strike.n || 1) + PACK * k2._cd / k1._cd), gain = det * (own + (PACK - 1) * give);
        const q = { id: 'bloodquake', label: 'Bloodquake', per: 'hit', kind: 'hit', el: null, aff: 1, r: BQUAKE_R, proc: false, note: `a Charge or Throw strike on a foe with ${BQUAKE_AT} ailments pays out its Bleed pool at +${Math.round(st.bloodquakeMul * 100)}% and bursts ${Math.round(st.bloodquakeSplash * 100)}% of that to each foe near it (a pack only)`, raw: paid, hit: paid, avg: paid, pre: paid, here: paid, total: gain / PACK, oneFoe: 0, kc: 0, alwaysCrit: false, noCrit: true, selfVuln: 0 };
        k2.parts.push(finish(q, R));
        k2.perCast = R.n(k2.perCast + one); k2.perCastAll = R.n(k2.perCastAll + one); k2.dpsCd = R.n(k2.perCast / k2._cd);
      }
    }
  }
  // ---------------- Necromancer attack and element forms ----------------
  // Fitted assumptions (the sheet reads a lone foe and a pack of PACK_REF; tools/sheet-check.js measures the staged parts that a fight can isolate).
  // Hex: HEX_ONE the share of your hits that land on a foe already Hexed; HEX_BASE the share of a pack your weapon keeps Hexed on its own (a hit Hexes the foe it strikes for 3 s); HEX_PACK_R the radius a pack stands in (Hex Burst Hexes spread / HEX_PACK_R of the rest);
  // GRAVE_HEX / STORM_HEX the share of the rest that a Grave Bolt's line / the souls of Soul Storm Hex; GRAVE_LINE the foes of a pack on a Grave Bolt's line; SOUL_FOES the foes a projectile weapon strikes per second in a pack (a homing shot picks one at a time, a swing hits the pack).
  // Doom cards act on elites and bosses only: the lone foe of a Focus build is a boss (it Tolls: Toll bonus, Maw), the pack holds an elite TOUGH_PACK of the time (it is Reaped: empower, Maw on its neighbours), ELITE_UP the share of an elite fight that a 6 s empower or a 3 s maw covers.
  // Rise Again: REAP_FRAC the share of kills that are Reaps, PACK_KILLS the kill-rate factor of a pack, FREE_ONE / FREE_PACK the share of the Tide cap that stands alive in the lone-foe / pack column.
  const HEX_ONE = 0.95, HEX_BASE = 0.5, HEX_PACK_R = 90, GRAVE_HEX = 0.25, STORM_HEX = 0.7, GRAVE_LINE = 2.5, SOUL_FOES = 2;
  const TOUGH_PACK = 0.5, ELITE_UP = 0.3, REAP_FRAC = 0.7, PACK_KILLS = 1.4, FREE_ONE = 0.6, FREE_PACK = 0.9;
  // The share of a pack of n foes that carries the hero's Hex: the weapon alone, then Hex Burst, the line of a Grave Bolt and the souls of Soul Storm each reach a share of the rest.
  function hexCov(st, n) {
    if (n < 2) return 1;
    let c = HEX_BASE;
    if (st.hexSpread > 0) c += (1 - c) * Math.min(1, st.hexSpread / HEX_PACK_R);
    if (st.graveBolt > 0) c += (1 - c) * GRAVE_HEX;
    if (st.soulStorm > 0) c += (1 - c) * STORM_HEX;
    return c;
  }
  // The Hex, Grave Bolt, Soul Storm, Abyssal and Tide effects of class-necro.js as weapon extras (damage per attack on one foe; _pack(n): the total per attack in a pack of n). Per-second values are divided by the attack rate.
  function necroForms(st, wpn, skills, proc, ref, s, R) {
    const aps = wpn._aps, avg = wpn._avg, melee = wpn.kind === 'melee', M = Math.max(0.1, st.dmg), one = wpn.oneFoe, hasHex = st.hex > 0, mine = [];
    const pow = 1 + st.statusPow, kM = C.MINION_INFUSE + st.minionInfuse, aff = ED.elemMul(s, 'shadow') * (1 + st.doomMul), toughK = C.DOOM_TOUGH + st.doomTough;
    const hb = (n) => (melee ? n : Math.min(n, (wpn.n || 1) * (1 + (wpn.pierce || 0)))); // foes one attack's normal hits reach (tools/model.js packWeapon)
    let minionDps = 0, minionDoom = 0, minions = 0, strike = 0, dpsOne = avg * one * aps;
    const spells = [];
    for (const e of wpn._extras) if (!e.packOnly) dpsOne += e.perAttack * aps;
    for (const sk of skills) for (const m of sk.parts) {
      if (m.kind === 'zone' || m.kind === 'status') continue;
      const d = m._r.total / sk._cd;
      dpsOne += d;
      if (m.kind === 'minion') { minionDps += d; minions = Math.max(minions, m.minions); strike = m._r.pre; minionDoom += d * Math.max(st.shadowInfuse * kM, st.mInfShadow) * pow; } else spells.push({ d, area: m.r > 0 });
    }
    const add = (label, one1, pack, note, o) => mine.push(Object.assign({ label, perAttack: one1 / aps, proc: false, note, _pack: (n) => pack(n) / aps }, o));
    // Grave Bolt: every graveN-th attack, its shots (or a scythe swing) deal graveBolt times the damage; a shot pierces the pack along its line
    let graveOne = 0, gravePack = () => 0;
    if (st.graveBolt > 0 && st.graveN > 0) {
      const gb = st.graveBolt, ev = st.graveN, shots = melee ? 1 : (wpn.n || 1);
      graveOne = avg * one * (gb - 1) / ev * aps;
      gravePack = (n) => (melee ? avg * n * (gb - 1) : avg * (shots * gb * Math.min(n, Math.max(1 + (wpn.pierce || 0), GRAVE_LINE)) - hb(n))) / ev * aps;
      add('Grave Bolt', graveOne, gravePack, `every ${ordinal(ev)} attack: ×${trim(gb.toFixed(2))} damage${melee ? '' : ', twice as wide, pierces every foe'}; its kills rise`, { proc: true, crit: true });
    }
    // Soul Storm: a Hexed foe your weapon hits sends a soul (soulStorm of the hit) to another foe once per second; a lone foe has none to send it to
    if (st.soulStorm > 0 && hasHex) {
      const dealt = avg * (1 + st.hexSelf / M);
      const storm = (n) => (n < 2 ? 0 : Math.min(n, melee ? n : SOUL_FOES) * HEX_ONE * st.soulStorm * dealt);
      add('Soul Storm', storm(PACK_REF) / PACK_REF, storm, `a Hexed foe you hit sends a soul to another foe once per second, ${Math.round(st.soulStorm * 100)}% of the hit, in a pack`, { packOnly: true });
    }
    // Soul Barrage: your hits and area skills deal hexSelf more to Hexed foes (the minions are raw hits and read hexMul instead)
    if (st.hexSelf > 0 && hasHex) {
      const k = st.hexSelf / M, spell1 = spells.reduce((t, q) => t + q.d, 0);
      add('Hexed foes', (avg * one * aps + graveOne + spell1) * k * HEX_ONE, (n) => (avg * hb(n) * aps + gravePack(n) + spells.reduce((t, q) => t + q.d * (q.area ? n : 1), 0)) * k * hexCov(st, n), `your weapon and skills deal +${Math.round(st.hexSelf * 100)}% to Hexed foes (about ${Math.round(HEX_ONE * 100)}% of your hits on one foe)`);
    }
    // Soul Command, Quickened Dead: Hexed foes take hexMul more from minions and the minions strike hexHaste faster; minions rush a Hexed foe whenever one lives
    if (hasHex && minionDps > 0 && (st.hexMul > 0 || st.hexHaste > 0)) {
      const f = (1 + st.hexMul) / (1 - st.hexHaste) - 1;
      add('Hexed minions', minionDps * f, (n) => minionDps * f * (1 - (1 - hexCov(st, n)) ** 2), `minions strike Hexed foes ${Math.round(st.hexMul * 100)}% harder${st.hexHaste > 0 ? ' and ' + Math.round(st.hexHaste * 100) + '% faster' : ''}`);
    }
    // Abyssal Toll, Abyssal Maw: damage per second on a boss (the lone-foe column) or an elite (the pack column, TOUGH_PACK of the time). doomI: the Doom such a foe collects per second; a boss pays it back as Tolls, an elite is Reaped by it, both about 1:1.
    // The Toll gap (a Toll per TOLL_AT of the boss' health in Doom) sets how often a boss' 6 s empower and 3 s maw run; an elite's covers ELITE_UP of its fight.
    const doomI = (proc.rate.shadow || 0) * aff * toughK, boss = (n) => (n < 2 ? 1 : 0), tough = (n) => (n < 2 ? 1 : TOUGH_PACK);
    if (doomI > 0 && (st.tollMul > 0 || st.abyssMin > 0 || st.maw > 0)) {
      const gap = C.TOLL_AT * ED.ENEMIES[ED.biomeFor(s).boss].hp / doomI, up = (T, n) => boss(n) * Math.min(1, T / gap) + (1 - boss(n)) * ELITE_UP;
      const toll = (n) => tough(n) * (doomI * st.tollMul * boss(n) + minionDps * st.abyssMin * up(C.ABYSS_T, n) + (st.abyssDoom > 0 ? minionDoom * aff * toughK * st.abyssDoom * (1 + st.tollMul * boss(n)) : 0));
      if (st.tollMul > 0 || st.abyssMin > 0) add('Abyssal Toll', toll(1), toll, `on bosses and elites: Tolls +${Math.round(st.tollMul * 100)}%, minions +${Math.round(st.abyssMin * 100)}% after a Toll or a Reaped elite${st.abyssDoom > 0 ? ', minion Doom doubled' : ''}`);
      if (st.maw > 0) {
        const maw = (n) => tough(n) * (doomI * (1 + st.tollMul) * st.maw * C.MAW_T * boss(n) + (n < 2 ? 0 : doomI * st.maw * C.MAW_T * Math.min(2, n - 1)) + minionDps * st.mawHaste * up(C.MAW_T, n));
        add('Abyssal Maw', maw(1), maw, `a Toll or a Reaped elite opens a maw for ${C.MAW_T} s: foes in it take ${Math.round(st.maw * 100)}% of the Toll per second, minions near it strike ${Math.round(st.mawHaste * 100)}% faster`);
      }
    }
    // Risen Tide, Tide of the Dead: the minions risen from Reaps (rate: Reaps per second, the Reap share of the kills a hero's damage makes, held by the raise limit). Risen Tide buffs the share of the army they fill;
    // Tide of the Dead adds tideCap free minions (an alive share of the cap) and their falling bursts of Doom, 1:1 damage on trash
    if (st.reapRaise > 0 && minionDps > 0 && minions > 0) {
      const life = 10 + C.TIDE_LIFE, per = minionDps / minions, kills = REAP_FRAC * dpsOne / ref.hp, rises = (n) => Math.min(1 / (st.tideFree > 0 ? C.TIDE_CD : C.RISE_CD), kills * (n < 2 ? 1 : PACK_KILLS));
      if (st.tideFree > 0) {
        const alive = (n) => Math.min(st.tideCap * (n < 2 ? FREE_ONE : FREE_PACK), rises(n) * life), tm = 1 + st.tideMul;
        const tide = (n) => alive(n) * per * tm + alive(n) / life * (n < 2 ? 1 : Math.min(n, 3)) * st.tideDoom * strike * tm * aff;
        add('Tide of the Dead', tide(1), tide, `${trim(st.tideCap.toFixed(1))} extra minions outside the cap (about ${Math.round(FREE_ONE * 100)}% alive on one foe), each bursting Doom when it falls`);
      } else if (st.tideMul > 0) {
        const tide = (n) => minionDps * st.tideMul * Math.min(1, rises(n) * life / Math.max(1, st.maxMinions));
        add('Risen Tide', tide(1), tide, `minions risen from Reaps strike ${Math.round(st.tideMul * 100)}% harder and last longer`);
      }
    }
    return mine;
  }

  // Rebuilds the weapon model's totals and extras list after an extra was pushed on wpn._extras.
  function refit(wpn, R) {
    let sum = 0;
    for (const e of wpn._extras) if (!e.packOnly) sum += e.perAttack;
    wpn.dps = R.n((wpn._avg * wpn.oneFoe + sum) * wpn._aps); wpn.dpsAll = R.n((wpn._avg * wpn.n + sum) * wpn._aps);
    wpn.extras = wpn._extras.map(e => Object.assign({}, e, { perAttack: R.n(e.perAttack), perSec: R.n(e.perAttack * wpn._aps) }));
  }

  // ---------------- affinity and dark rooms ----------------
  function affModel(p, st, ctx) {
    const mine = [], seen = {};
    const push = (el, why) => { if (!el || seen[el] || !ED.PATHS[el] || !ED.PATHS[el].element) return; seen[el] = 1; mine.push({ el, name: ED.PATHS[el].name, color: ED.PATHS[el].color, why }); };
    for (const k of ED.elementGates(p.boons || {})) push(k, 'path');
    if (st.element) push(st.element, 'class');
    const at = (stratum) => {
      const b = ED.BIOMES[stratum - 1];
      return { stratum, name: b.name, short: b.short, weak: b.weak, resist: b.resist, mine: mine.map(m => ({ el: m.el, name: m.name, color: m.color, why: m.why, mul: ED.elemMul(stratum, m.el), skillMul: m.el === st.element ? ED.affC(stratum, m.el) : null })) }; // mul: statuses and tagged hits; skillMul: the class element's skills (half the affinity), whichever source listed the element
    };
    const s = clampI(ctx.stratum || 1, 1, ED.BIOMES.length);
    return { now: at(s), next: s < ED.BIOMES.length ? at(s + 1) : null };
  }
  // Dark rooms of the floor: unvisited / total, whether the hero stands in one, and the rule constants (foe damage, gold and xp multiplier).
  function darkModel(ctx) {
    return { left: ctx.rooms.darkLeft, total: ctx.rooms.darkTotal, here: !!ctx.dark, dmg: W.DARK_DMG, loot: W.DARK_LOOT, rooms: ctx.rooms };
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
        forks: e.forks.map((fid) => { const fb = ED.BOONS[fid], rank = boons[fid] | 0; return { id: fid, name: ED.cardName(fid, rank), icon: fb.icon, tag: fb.tag || '', coop: !!fb.coop, owned: rank > 0, rank, max: fb.max, closed: !!rt.fork && rt.fork !== fid, text: Sh.text(fid, rank || 1, st), when: rank ? (rank < fb.max ? ROUTE_WHEN[rank === 1 ? 'r2' : 'r3'] : '') : rt.fork ? '' : ROUTE_WHEN.fork, weapon: fb.weapon && fb.weapon.kind ? ED.forkWeapon(p.weapon, fid).name : null }; }),
      });
    }
    // boons grouped by owned path (gate, boons, keystone, evolution), duo, class route and open
    const rows = [];
    for (const id in boons) {
      const b = ED.BOONS[id], rank = boons[id];
      if (!b || !(rank > 0) || (b.cls && b.cls !== p.cls)) continue;
      const max = ED.maxRank(b, st), kind = b.evo ? 'evolution' : b.asc ? 'ascended' : b.key ? 'keystone' : b.gate ? 'gate' : b.duo ? 'duo' : b.route ? (b.tier === 1 ? 'route' : 'fork') : b.path && !b.open ? 'path' : 'open';
      const group = b.cls ? 'route' : b.duo ? 'duo' : b.asc ? 'asc' : b.path && !b.open && gates.includes(b.path) ? 'path:' + b.path : 'open';
      rows.push({ id, name: ED.cardName(id, rank), icon: b.icon, rar: b.rar, rank, max, kind, group, path: b.path || (b.duo ? b.duo[0] : null), path2: b.duo ? b.duo[1] : null, tag: b.tag || '', coop: !!b.coop, text: Sh.text(id, rank, st), next: rank < max ? Sh.nextText(id, rank, st) : null });
    }
    const groups = gates.map(k => 'path:' + k).concat(['duo', 'route', 'asc', 'open']).map(g => ({ group: g, path: g.indexOf('path:') === 0 ? g.slice(5) : null, items: rows.filter(r => r.group === g).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) })).filter(g => g.items.length);
    const relics = (p.relics || []).map(id => {
      const r = ED.RELICS[id], i = Sh.READY.findIndex(x => x.id === id);
      return { id, name: r.name, icon: r.icon, rar: r.rar, text: r.desc, live: relicLive(id, p, st, ctx), state: i >= 0 ? (readyOf(p, i) ? 'ready' : id === 'angel' || id === 'phoenix' ? 'used' : 'recharging') : null };
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
