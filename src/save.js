// Profile persistence: localStorage autosave plus a portable, checksummed save code.
// The save code packs the whole profile into bits -> bytes -> CRC16 -> light XOR scramble -> Crockford base32,
// grouped like ED1-XXXXX-XXXXX-... It needs no server: paste it on any device to restore progress.
(function (ED) {
  'use strict';
  const U = ED.U;
  // ?slot=2 keeps a second profile in the same browser (handy for two local tabs playing together).
  const SLOT = (() => { try { const v = new URLSearchParams(location.search).get('slot'); return v ? '.' + v.replace(/[^a-z0-9]/gi, '').slice(0, 8) : ''; } catch (e) { return ''; } })();
  const LS_KEY = 'emberdeep.profile.v1' + SLOT;
  const LS_SETTINGS = 'emberdeep.settings.v1';
  const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const CODE_VERSION = 1;

  const S = ED.Save = { KEY: LS_KEY, NAME_CHARS };

  S.defaultProfile = () => ({
    v: 1,
    name: 'Wanderer',
    embers: 0,
    lifetime: 0,
    up: ED.UPGRADES.map(() => 0),
    relics: ED.RELIC_IDS.map(id => (ED.RELICS[id].start ? 1 : 0)),
    mastery: ED.CLASS_IDS.map(() => 0),
    bosses: 0,
    deeds: 0,
    pactMax: 0,
    pactWin: -1,
    stats: { runs: 0, wins: 0, deepest: 0, kills: 0, bestTime: 0, bossKills: 0 },
    sel: { cls: 'knight', weapon: {} },
  });

  S.sanitizeName = (n) => {
    n = String(n || '').split('').filter(ch => NAME_CHARS.indexOf(ch) >= 0).join('').trim().slice(0, 12);
    return n || 'Wanderer';
  };

  // ---------------- localStorage ----------------
  S.load = () => {
    let raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { return S.normalize(JSON.parse(raw)); } catch (e) {
      // unreadable: keep a copy aside before the fresh profile overwrites it
      try { localStorage.setItem(LS_KEY + '.corrupt', raw); } catch (e2) { /* ignore */ }
      return null;
    }
  };
  S.store = (p) => { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); return true; } catch (e) { return false; /* storage blocked: save code still works */ } };
  S.erase = () => { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } };

  // Whatever was stored (old versions, hand edits, damage), return a well-formed profile.
  const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? U.clamp(n, lo, hi) : lo; };
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const BIG = 1e12;
  S.normalize = (p) => {
    const d = S.defaultProfile();
    if (!p || typeof p !== 'object') return d;
    const arr = (v) => (Array.isArray(v) ? v : []);
    const up = arr(p.up), relics = arr(p.relics), mastery = arr(p.mastery);
    d.name = S.sanitizeName(p.name);
    d.embers = int(p.embers, 0, BIG); d.lifetime = int(p.lifetime, 0, BIG);
    d.up = ED.UPGRADES.map((u, i) => int(up[i], 0, u.costs.length));
    d.relics = ED.RELIC_IDS.map((id, i) => (ED.RELICS[id].start || relics[i] ? 1 : 0));
    d.mastery = ED.CLASS_IDS.map((c, i) => int(mastery[i], 0, BIG));
    d.bosses = int(p.bosses, 0, 63);
    d.deeds = int(p.deeds, 0, 2 ** 31 - 1);
    d.pactMax = int(p.pactMax, 0, 10);
    d.pactWin = p.pactWin === undefined ? -1 : int(p.pactWin, -1, 10);
    const st = obj(p.stats);
    for (const k in d.stats) d.stats[k] = int(st[k], 0, k === 'deepest' ? 6 : BIG);
    const sel = obj(p.sel);
    d.sel = { cls: ED.CLASS_IDS.indexOf(sel.cls) >= 0 ? sel.cls : 'knight', weapon: {}, pact: int(sel.pact, 0, 10) };
    for (const c of ED.CLASS_IDS) { const wid = obj(sel.weapon)[c]; if (ED.CLASSES[c].weapons.indexOf(wid) >= 0) d.sel.weapon[c] = wid; }
    return d;
  };

  S.loadSettings = () => {
    const d = { master: 70, music: 55, sfx: 80, aim: 'auto', quality: 'high', shake: true, dmg: true };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')); } catch (e) { return d; }
  };
  S.storeSettings = (s) => { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) { /* ignore */ } };

  // ---------------- profile queries ----------------
  S.classUnlocked = (p, cls) => {
    const u = ED.CLASSES[cls].unlock;
    if (!u) return true;
    if (u.boss) return !!(p.bosses & (1 << (u.boss - 1)));
    if (u.runs) return p.stats.runs >= u.runs;
    return true;
  };
  S.relicUnlocked = (p, id) => !!p.relics[ED.RELIC_IDX[id]];
  S.masteryLevel = (p, cls) => ED.masteryLevel(p.mastery[ED.CLASS_IDS.indexOf(cls)] || 0);
  S.rank = (p, id) => p.up[ED.UPGRADE_IDX[id]] || 0;
  S.upgradeAvailable = (p, u) => p.stats.deepest >= u.tier || u.tier <= 1;
  S.relicReqMet = (p, id) => { const r = ED.RELICS[id].req; return !r || !r.boss || !!(p.bosses & (1 << (r.boss - 1))); };

  S.buyUpgrade = (p, id) => {
    const i = ED.UPGRADE_IDX[id], u = ED.UPGRADES[i];
    const r = p.up[i];
    if (r >= u.costs.length || !S.upgradeAvailable(p, u)) return false;
    const cost = u.costs[r];
    if (p.embers < cost) return false;
    p.embers -= cost; p.up[i] = r + 1;
    return true;
  };
  S.unlockRelic = (p, id) => {
    const i = ED.RELIC_IDX[id], def = ED.RELICS[id];
    if (p.relics[i] || !def.cost || !S.relicReqMet(p, id) || p.embers < def.cost) return false;
    p.embers -= def.cost; p.relics[i] = 1;
    return true;
  };

  // The meta bundle a player brings into a run (sent to the host in multiplayer).
  S.metaBundle = (p, cls) => ({
    up: p.up.slice(),
    mastery: S.masteryLevel(p, cls),
    relics: ED.RELIC_IDS.filter(id => S.relicUnlocked(p, id)),
  });

  // ---------------- run rewards ----------------
  // run: summary produced by the world for everyone in the party (shared progression).
  S.computeRewards = (p, run) => {
    const lines = [];
    const base = run.embers || { rooms: 0, elites: 0, bosses: 0, victory: 0 };
    if (base.rooms) lines.push(['Rooms cleared', base.rooms]);
    if (base.elites) lines.push(['Elites slain', base.elites]);
    if (base.bosses) lines.push(['Bosses defeated', base.bosses]);
    if (base.victory) lines.push(['Descent complete', base.victory]);
    const sub = base.rooms + base.elites + base.bosses + base.victory;
    let mult = 1;
    const att = S.rank(p, 'attunement');
    if (att) { mult += 0.1 * att; }
    if (run.pact) { mult += ED.PACT_EMBER_BONUS * run.pact; }
    if (run.party > 1) { mult += 0.1 * (run.party - 1); }
    if (run.emberBonus) { mult += run.emberBonus; }
    // A small floor so a bad run still pays, but only for a descent that actually fought (no abandon farming).
    const total = Math.max(S.runCounts(run) ? 5 : 0, Math.round(sub * mult));
    if (mult > 1.001) lines.push([`Bonus ×${mult.toFixed(2)}${run.party > 1 ? ' (party)' : ''}`, total - sub]);
    if (total > sub && mult <= 1.001) lines.push(['Pity embers', total - sub]);
    const masteryXp = Math.round((run.roomsCleared || 0) * 8 + (run.elitesKilled || 0) * 5 + (run.bossCount || 0) * 40 + (run.stratum || 0) * 15 + (run.victory ? 150 : 0) + (run.level || 0) * 2);
    return { lines, total, masteryXp };
  };

  S.runCounts = (run) => (run.roomsCleared || 0) >= 1 || !!run.victory;

  // Applies a finished run. Returns { rewards, unlocks: [text], deeds: [deed] }.
  S.applyRun = (p, run) => {
    const before = {
      classes: ED.CLASS_IDS.filter(c => S.classUnlocked(p, c)),
      mastery: S.masteryLevel(p, run.cls),
      tiers: p.stats.deepest,
      pactMax: p.pactMax,
    };
    const rewards = S.computeRewards(p, run);
    p.embers += rewards.total; p.lifetime += rewards.total;
    const ci = ED.CLASS_IDS.indexOf(run.cls);
    if (ci >= 0) p.mastery[ci] += rewards.masteryXp;
    if (S.runCounts(run)) p.stats.runs += 1; // descents toward unlocks: at least one room cleared
    p.stats.kills += run.kills | 0;
    p.stats.deepest = Math.max(p.stats.deepest, run.stratum | 0);
    p.stats.bossKills += run.bossCount | 0;
    p.bosses |= (run.bosses | 0);
    if (run.victory) {
      p.stats.wins += 1;
      if (!p.stats.bestTime || run.time < p.stats.bestTime) p.stats.bestTime = Math.round(run.time);
      p.pactWin = Math.max(p.pactWin, run.pact | 0);
      p.pactMax = Math.min(10, Math.max(p.pactMax, (run.pact | 0) + 1));
    }
    const unlocks = [];
    for (const c of ED.CLASS_IDS) if (S.classUnlocked(p, c) && before.classes.indexOf(c) < 0) unlocks.push('New hero: ' + ED.CLASSES[c].name);
    const ml = S.masteryLevel(p, run.cls);
    for (let l = before.mastery + 1; l <= ml; l++) unlocks.push(`${ED.CLASSES[run.cls].name} mastery ${l}: ${ED.MASTERY_REWARDS[l]}`);
    if (p.stats.deepest > before.tiers) {
      const fresh = ED.UPGRADES.filter(u => u.tier > Math.max(1, before.tiers) && u.tier <= p.stats.deepest);
      if (fresh.length) unlocks.push('New Hearth upgrades: ' + fresh.map(u => u.name).join(', '));
    }
    if (p.pactMax > before.pactMax) unlocks.push(`Pact ${p.pactMax} can now be sworn`);
    const deeds = S.checkDeeds(p, run);
    return { rewards, unlocks, deeds };
  };

  S.checkDeeds = (p, run) => {
    const got = [];
    ED.DEEDS.forEach((d, i) => {
      if (p.deeds & (1 << i)) return;
      let ok = false;
      try { ok = d.check(p, run); } catch (e) { ok = false; }
      if (ok) { p.deeds |= (1 << i); p.embers += d.reward; p.lifetime += d.reward; got.push(d); }
    });
    return got;
  };

  // ---------------- save code ----------------
  function BitWriter() { this.bits = []; }
  BitWriter.prototype.put = function (v, n) { for (let i = n - 1; i >= 0; i--) this.bits.push((v >>> i) & 1); };
  BitWriter.prototype.varint = function (v) {
    v = Math.max(0, Math.floor(v));
    do { let chunk = v % 128; v = Math.floor(v / 128); this.put(v > 0 ? 1 : 0, 1); this.put(chunk, 7); } while (v > 0);
  };
  BitWriter.prototype.bytes = function () {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 128 >> (i & 7); });
    return out;
  };
  function BitReader(bytes) { this.b = bytes; this.i = 0; }
  BitReader.prototype.get = function (n) {
    let v = 0;
    for (let k = 0; k < n; k++) {
      if (this.i >= this.b.length * 8) throw new Error('short');
      v = v * 2 + ((this.b[this.i >> 3] >> (7 - (this.i & 7))) & 1); this.i++;
    }
    return v;
  };
  BitReader.prototype.varint = function () {
    let v = 0, mul = 1, more = 1, guard = 0;
    while (more) { more = this.get(1); v += this.get(7) * mul; mul *= 128; if (++guard > 6) throw new Error('varint'); }
    return v;
  };

  const crc16 = (bytes) => {
    let c = 0xffff;
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i] << 8;
      for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    return c;
  };
  const scramble = (bytes) => {
    const r = U.RNG(0x5eed_e3b7);
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= Math.floor(r.next() * 256);
    return bytes;
  };
  const toB32 = (bytes) => {
    let out = '', buf = 0, n = 0;
    for (let i = 0; i < bytes.length; i++) {
      buf = (buf << 8) | bytes[i]; n += 8;
      while (n >= 5) { out += B32[(buf >>> (n - 5)) & 31]; n -= 5; }
      buf &= (1 << n) - 1;
    }
    if (n > 0) out += B32[(buf << (5 - n)) & 31];
    return out;
  };
  const fromB32 = (str) => {
    const bytes = []; let buf = 0, n = 0;
    for (const ch of str) {
      const v = B32.indexOf(ch);
      if (v < 0) throw new Error('char');
      buf = (buf << 5) | v; n += 5;
      if (n >= 8) { bytes.push((buf >>> (n - 8)) & 255); n -= 8; buf &= (1 << n) - 1; }
    }
    return new Uint8Array(bytes);
  };

  S.encode = (p) => {
    const w = new BitWriter();
    w.put(CODE_VERSION, 8);
    const name = S.sanitizeName(p.name);
    w.put(name.length, 4);
    for (const ch of name) w.put(NAME_CHARS.indexOf(ch), 6);
    w.varint(p.embers); w.varint(p.lifetime);
    ED.UPGRADES.forEach((u, i) => w.put(p.up[i] | 0, 3));
    ED.RELIC_IDS.forEach((id, i) => { if (!ED.RELICS[id].start) w.put(p.relics[i] ? 1 : 0, 1); });
    ED.CLASS_IDS.forEach((c, i) => w.varint(p.mastery[i] | 0));
    w.put(p.bosses & 63, 6);
    w.put(ED.DEEDS.length, 6);
    ED.DEEDS.forEach((d, i) => w.put((p.deeds >>> i) & 1, 1));
    w.put(p.pactMax, 4); w.put(p.pactWin + 1, 4);
    const st = p.stats;
    w.varint(st.runs); w.varint(st.wins); w.put(st.deepest & 7, 3); w.varint(st.kills); w.varint(st.bestTime); w.varint(st.bossKills);
    const body = w.bytes();
    const crc = crc16(body);
    const all = new Uint8Array(body.length + 2);
    all.set(body); all[body.length] = crc >> 8; all[body.length + 1] = crc & 255;
    const code = toB32(scramble(all));
    return 'ED1-' + code.match(/.{1,5}/g).join('-');
  };

  // Returns a normalized profile or throws an Error with a human-readable message.
  S.decode = (code) => {
    let s = String(code || '').toUpperCase().replace(/\s+/g, '').replace(/^ED1-?/, '').replace(/-/g, '');
    s = s.replace(/[IL]/g, '1').replace(/O/g, '0');
    if (s.length < 20) throw new Error('That code is too short. Copy the whole code, including every group.');
    let all;
    try { all = scramble(fromB32(s)); } catch (e) { throw new Error('That code contains characters a save code never uses.'); }
    if (all.length < 8) throw new Error('That code is too short.');
    // Trailing pad bits can create one extra zero byte; try both lengths.
    let body = null;
    for (const len of [all.length, all.length - 1]) {
      const b = all.slice(0, len - 2);
      const crc = (all[len - 2] << 8) | all[len - 1];
      if (crc16(b) === crc) { body = b; break; }
    }
    if (!body) throw new Error('That code fails its checksum. A character is probably mistyped or missing.');
    const r = new BitReader(body);
    const p = S.defaultProfile();
    try {
      const ver = r.get(8);
      if (ver !== CODE_VERSION) throw new Error('ver');
      const nl = r.get(4); let name = '';
      for (let i = 0; i < nl; i++) name += NAME_CHARS[r.get(6)] || '';
      p.name = S.sanitizeName(name);
      p.embers = r.varint(); p.lifetime = r.varint();
      ED.UPGRADES.forEach((u, i) => { p.up[i] = Math.min(u.costs.length, r.get(3)); });
      ED.RELIC_IDS.forEach((id, i) => { if (!ED.RELICS[id].start) p.relics[i] = r.get(1); });
      ED.CLASS_IDS.forEach((c, i) => { p.mastery[i] = r.varint(); });
      p.bosses = r.get(6);
      const nd = r.get(6); let deeds = 0;
      for (let i = 0; i < nd; i++) if (r.get(1)) deeds |= (1 << i);
      p.deeds = deeds;
      p.pactMax = Math.min(10, r.get(4)); p.pactWin = Math.min(10, r.get(4) - 1);
      p.stats.runs = r.varint(); p.stats.wins = r.varint(); p.stats.deepest = Math.min(6, r.get(3));
      p.stats.kills = r.varint(); p.stats.bestTime = r.varint(); p.stats.bossKills = r.varint();
    } catch (e) {
      throw new Error('That code is from an unknown version or is damaged.');
    }
    return S.normalize(p);
  };
})(globalThis.ED || (globalThis.ED = {}));
