// Profile persistence: localStorage autosave plus a portable, checksummed save code.
// The save code packs the whole profile into bits -> bytes -> CRC16 -> light XOR scramble -> Crockford base32,
// grouped like WD1-XXXXX-XXXXX-... It needs no server: paste it on any device to restore progress.
(function (ED) {
  'use strict';
  const U = ED.U;
  // ?slot=2 keeps a second profile in the same browser (handy for two local tabs playing together).
  const SLOT = (() => { try { const v = new URLSearchParams(location.search).get('slot'); return v ? '.' + v.replace(/[^a-z0-9]/gi, '').slice(0, 8) : ''; } catch (e) { return ''; } })();
  const LS_KEY = 'wickdeep.profile.v1' + SLOT;
  const LS_SETTINGS = 'wickdeep.settings.v1';
  const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const CODE_VERSION = 10; // 10: a lore section (6-bit count, a bit per ED.LORE page) after the worn items; 9: the layout of 8 (marks a code made after the v6 rules; older codes hold six-stratum boss bits and deepest); 8: count-prefixed sections after the stats (secrets, hero wins, the Bellwarden flag, evolutions, Wardrobe purchases and worn items); 7: the layout of 5 (marks a code made after the v5 difficulty); 6: the layout of 5 (marks a code made after the health rescale); 5: no relic bits, an Armory section (per hero: 6-bit count, 1 bit per entry) after mastery; 4: upgrades and heroes carry count prefixes too; 3: only the non-start relic bits do; 2 stored exactly V2_RELIC_BITS relic bits, V2_UPGRADES ranks and V2_HEROES mastery values. A count prefix keeps appended entries from shifting what follows.
  const ERA = 7; // profile era (S.defaultProfile v)
  const V2_RELIC_BITS = 26, V2_UPGRADES = 16, V2_HEROES = 6;
  // The relic list of save code v4 as [id, start, cost], in v4 RELIC_IDS order: old profiles (positional flags) and v2-v4 codes (non-start bits) decode against it, and the Codex embers they paid are refunded. Frozen.
  const V4_RELICS = [['whetstone', 1, 0], ['boots', 1, 0], ['buckler', 1, 0], ['heartstone', 1, 0], ['coin', 1, 0], ['hourglass', 1, 0], ['fang', 1, 0], ['embercharm', 1, 0], ['frostshard', 1, 0], ['lodestone', 1, 0], ['pauldron', 1, 0], ['wardrum', 1, 0], ['phoenix', 1, 0], ['stormidol', 1, 0], ['glasseye', 1, 0], ['elixir', 1, 0],
    ['axe', 0, 50], ['cloak', 0, 50], ['satchel', 0, 65], ['lantern', 0, 45], ['seeker', 0, 80], ['twinfang', 0, 80], ['mirror', 0, 80], ['crown', 0, 105], ['idol', 0, 60], ['wispjar', 0, 70], ['mask', 0, 70], ['banner', 0, 50], ['angel', 0, 115], ['crest', 0, 70], ['gauntlet', 0, 85], ['frozenheart', 0, 80], ['chalice', 0, 115], ['skull', 0, 90], ['ledger', 0, 50], ['stone', 0, 130], ['clover', 0, 60], ['aegis', 0, 85], ['brazier', 0, 70], ['glaciercore', 0, 70], ['lightningrod', 0, 70], ['bloodstone', 0, 60],
    ['halo', 1, 0], ['gravecandle', 1, 0], ['venomgland', 0, 70]];
  const V4_CODEX = V4_RELICS.map((r, i) => i).filter(i => !V4_RELICS[i][1]); // indices of the Codex relics, the order of the v2-v4 code bits
  const PREFIX = 'WD1';

  const S = ED.Save = { KEY: LS_KEY, NAME_CHARS };

  const armoryList = (cls) => ED.ARMORY[cls] || [];
  // { cls: [0 per entry] } for every hero.
  const blankArmory = () => { const a = {}; for (const c of ED.CLASS_IDS) a[c] = armoryList(c).map(() => 0); return a; };
  // Wardrobe worn items: { camp, cls: { skin, aura, hat, pet, trail, death, title, tints: [base weapon ids] } }, ids or null.
  const blankWearHero = () => { const o = {}; for (const k of ED.WEAR_SLOTS) o[k] = null; o.tints = []; return o; };
  const blankWear = () => { const o = { camp: null }; for (const c of ED.CLASS_IDS) o[c] = blankWearHero(); return o; };
  const baseWeapons = () => [].concat(...ED.CLASS_IDS.map(c => ED.CLASSES[c].weapons));

  S.defaultProfile = () => ({
    v: ERA, // profile era: below 3 a profile has a positional relics array; its Codex embers are refunded. news (the "What changed" notice, cleared once shown) = the oldest part not yet seen: 1 everything (era below 3), 2 the v5, v6 and v7 changes (eras 3-4), 3 the v6 and v7 changes (era 5), 4 the v7 changes (era 6); set only with runs or a refund
    news: 0,
    refunded: 0, // Codex embers refunded by that migration, printed by the notice
    name: 'Wanderer',
    embers: 0,
    lifetime: 0,
    up: ED.UPGRADES.map(() => 0),
    armory: blankArmory(),
    mastery: ED.CLASS_IDS.map(() => 0),
    bosses: 0,
    deeds: 0,
    pactMax: 0,
    pactWin: -1,
    stats: { runs: 0, wins: 0, deepest: 0, kills: 0, bestTime: 0, bossKills: 0 },
    secrets: 0, // bit i = ED.SECRETS[i] earned
    cos: [], // Wardrobe items bought with embers (ids in ED.COSMETICS order)
    evo: {}, // base weapon id -> descents in which it evolved
    heroWins: 0, // bit i = hero CLASS_IDS[i] has completed a descent
    bellUnlocked: false,
    lore: 0, // bit i (arithmetic, up to 52 pages) = ED.LORE[i] found (S.loreHas)
    wear: blankWear(),
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
    try {
      const old = JSON.parse(raw), p = S.normalize(old);
      if (old && typeof old === 'object' && (old.v | 0) < ERA) S.store(p); // migrated once: the stored copy drops the relics array so the refund cannot repeat, and its notice flag is set once
      return p;
    } catch (e) {
      // unreadable: keep a copy aside before the fresh profile overwrites it
      try { localStorage.setItem(LS_KEY + '.corrupt', raw); } catch (e2) { /* ignore */ }
      return null;
    }
  };
  S.store = (p) => { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); return true; } catch (e) { return false; /* storage blocked: save code still works */ } };
  S.erase = () => { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } };

  // Embers the Codex cost: the sum over the Codex relics a positional v4 flag array (one entry per V4_RELICS) holds.
  const codexRefund = (flags) => V4_CODEX.reduce((n, i) => n + (flags[i] ? V4_RELICS[i][2] : 0), 0);

  // Whatever was stored (old versions, hand edits, damage), return a well-formed profile.
  // Six-stratum profiles (era below 6, codes below 9) keep each stratum by name: Ossuary I, Glowmire II, Drowned Sanctum V -> III, Starless Abyss VI -> IV; the cut Rimefrost (III) and Cinderforge (IV) fall back to Glowmire.
  const SIX_DEEP = [0, 1, 2, 2, 2, 3, 4, 4]; // old deepest -> deepest (7 only from a damaged code)
  const sixDeep = (n) => SIX_DEEP[n] || 0;
  const sixBosses = (b) => (b & 3) | (((b >> 4) & 1) << 2) | (((b >> 5) & 1) << 3); // old boss bits 0, 1, 4, 5 -> 0, 1, 2, 3
  const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? U.clamp(n, lo, hi) : lo; };
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const BIG = 1e12;
  S.normalize = (p) => {
    const d = S.defaultProfile();
    if (!p || typeof p !== 'object') return d;
    const arr = (v) => (Array.isArray(v) ? v : []);
    const up = arr(p.up), mastery = arr(p.mastery), old = (p.v | 0) < 3;
    d.name = S.sanitizeName(p.name);
    d.embers = int(p.embers, 0, BIG); d.lifetime = int(p.lifetime, 0, BIG);
    d.refunded = int(p.refunded, 0, BIG);
    if (old) { const gain = codexRefund(arr(p.relics)); d.embers = Math.min(BIG, d.embers + gain); d.refunded = gain; }
    d.up = ED.UPGRADES.map((u, i) => int(up[i], 0, u.costs.length));
    const arm = obj(p.armory);
    for (const c of ED.CLASS_IDS) { const a = arr(arm[c]); d.armory[c] = armoryList(c).map((e, i) => (a[i] ? 1 : 0)); }
    d.mastery = ED.CLASS_IDS.map((c, i) => int(mastery[i], 0, BIG));
    const six = (p.v | 0) < 6; // a six-stratum profile: boss bits and deepest are remapped
    d.bosses = six ? sixBosses(int(p.bosses, 0, 63)) : int(p.bosses, 0, 63);
    d.deeds = int(p.deeds, 0, 2 ** 31 - 1);
    d.pactMax = int(p.pactMax, 0, 10);
    d.pactWin = p.pactWin === undefined ? -1 : int(p.pactWin, -1, 10);
    const st = obj(p.stats);
    for (const k in d.stats) d.stats[k] = k === 'deepest' ? (six ? sixDeep(int(st[k], 0, 7)) : int(st[k], 0, ED.CONST.STRATA)) : int(st[k], 0, BIG);
    d.secrets = int(p.secrets, 0, 2 ** 31 - 1);
    d.heroWins = int(p.heroWins, 0, 2 ** 31 - 1);
    d.bellUnlocked = p.bellUnlocked === true;
    d.lore = loreMask(p.lore);
    const ev = obj(p.evo);
    for (const w of baseWeapons()) { const k = int(ev[w], 0, 9999); if (k) d.evo[w] = k; }
    const cos = arr(p.cos);
    d.cos = ED.COSMETICS.filter(c => c.gate.cost && cos.indexOf(c.id) >= 0).map(c => c.id);
    normalizeWear(d, p.wear);
    const played = d.stats.runs > 0 || d.refunded > 0, v = p.v | 0;
    const pend = old ? 0 : v < 6 && (p.news | 0) === 3 ? 2 : int(p.news, 0, 4); // a notice still pending from an older era (before era 6 its 3 was the v5 part, 2 here)
    const gap = !played ? 0 : v < 3 ? 1 : v < 5 ? 2 : v < 6 ? 3 : v < ERA ? 4 : 0;
    d.news = pend && gap ? Math.min(pend, gap) : pend || gap;
    const sel = obj(p.sel);
    d.sel = { cls: ED.CLASS_IDS.indexOf(sel.cls) >= 0 ? sel.cls : 'knight', weapon: {}, pact: int(sel.pact, 0, 10) };
    for (const c of ED.CLASS_IDS) { const wid = obj(sel.weapon)[c]; if (ED.weaponIndex(c, wid) >= 0) d.sel.weapon[c] = wid; } // a base weapon or an Armory variant of the hero
    return d;
  };

  // Keeps only owned items in their own slots (d holds the sanitised ownership fields); a profile without a wear record (made before the Wardrobe) wears Gilded on every hero at mastery 10.
  function normalizeWear(d, src) {
    const fresh = !src || typeof src !== 'object';
    src = obj(src);
    d.wear = blankWear();
    const fits = (id, slot, cls) => { const c = ED.COSMETIC[id]; return !!c && c.slot === slot && (c.cls === null || c.cls === cls) && ED.cosOwned(d, id, cls); };
    if (fits(src.camp, 'camp', null)) d.wear.camp = src.camp;
    for (const c of ED.CLASS_IDS) {
      const h = obj(src[c]), o = d.wear[c];
      for (const k of ED.WEAR_SLOTS) if (fits(h[k], k, c)) o[k] = h[k];
      const tints = Array.isArray(h.tints) ? h.tints : [];
      o.tints = ED.CLASSES[c].weapons.filter(w => tints.indexOf(w) >= 0 && fits('tint.' + w, 'tint', c));
      if (fresh && fits('aura.gilded', 'aura', c)) o.aura = 'aura.gilded';
    }
  }

  S.loadSettings = () => {
    const d = { master: 70, music: 55, sfx: 80, quality: 'high', shake: true, dmg: true, cursor: 'reticle', reticle: 'm', reticleCol: 'ember', aimPreview: true, frameCap: 'auto' };
    let s = d;
    try { s = Object.assign(d, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')); } catch (e) { return d; }
    const pick = (v, list, def) => (list.indexOf(v) >= 0 ? v : def);
    delete s.aim; // the removed Auto-aim setting
    s.cursor = pick(s.cursor, ['reticle', 'system'], 'reticle'); s.reticle = pick(s.reticle, ['s', 'm', 'l'], 'm'); s.reticleCol = pick(s.reticleCol, ['ember', 'bone', 'frost'], 'ember');
    s.frameCap = pick(String(s.frameCap), ['auto', 'off', '144', '120', '60'], 'auto'); s.aimPreview = s.aimPreview !== false;
    return s;
  };
  S.storeSettings = (s) => { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) { /* ignore */ } };

  // ---------------- lore (ED.LORE pages, a bit each, kept with arithmetic so more than 31 fit) ----------------
  const loreN = () => Math.min(52, (ED.LORE || []).length);
  S.loreHas = (p, i) => i >= 0 && i < loreN() && Math.floor((p.lore || 0) / 2 ** i) % 2 === 1;
  // Marks page i found; returns true the first time.
  S.loreAdd = (p, i) => { if (!(i >= 0 && i < loreN()) || S.loreHas(p, i)) return false; p.lore = (p.lore || 0) + 2 ** i; return true; };
  // A stored lore mask with only known pages kept (0 for junk).
  function loreMask(v) { const n = Math.floor(Number(v)); if (!Number.isFinite(n) || n <= 0) return 0; let m = 0; for (let i = 0; i < loreN(); i++) if (Math.floor(n / 2 ** i) % 2 === 1) m += 2 ** i; return m; }

  // ---------------- profile queries ----------------
  S.classUnlocked = (p, cls) => {
    const u = ED.CLASSES[cls].unlock;
    if (!u) return true;
    if (u.bell) return !!p.bellUnlocked;
    if (u.boss) return !!(p.bosses & (1 << (u.boss - 1)));
    if (u.runs) return p.stats.runs >= u.runs;
    return true;
  };
  S.masteryLevel = (p, cls) => ED.masteryLevel(p.mastery[ED.CLASS_IDS.indexOf(cls)] || 0);
  S.rank = (p, id) => p.up[ED.UPGRADE_IDX[id]] || 0;
  S.upgradeAvailable = (p, u) => p.stats.deepest >= u.tier || u.tier <= 1;

  S.buyUpgrade = (p, id) => {
    const i = ED.UPGRADE_IDX[id], u = ED.UPGRADES[i];
    if (!u) return false;
    const r = p.up[i];
    if (r >= u.costs.length || !S.upgradeAvailable(p, u)) return false;
    const cost = u.costs[r];
    if (p.embers < cost) return false;
    p.embers -= cost; p.up[i] = r + 1;
    return true;
  };
  // Refunds are free and exact (the cost of the rank given up); lifetime embers never change.
  S.refundUpgrade = (p, id) => {
    const i = ED.UPGRADE_IDX[id], u = ED.UPGRADES[i];
    if (!u || !(p.up[i] > 0)) return false;
    p.embers += u.costs[p.up[i] - 1]; p.up[i] -= 1;
    return true;
  };

  // Armory: entry index of `id` in hero `cls`'s list, or -1.
  const armoryIdx = (cls, id) => armoryList(cls).findIndex(e => e.id === id);
  S.armoryOwned = (p, cls, id) => { const i = armoryIdx(cls, id); return i >= 0 && !!(p.armory && p.armory[cls] && p.armory[cls][i]); };
  const armoryRow = (p, cls) => {
    if (!p.armory) p.armory = blankArmory();
    const a = p.armory[cls] || (p.armory[cls] = []);
    while (a.length < armoryList(cls).length) a.push(0);
    return a;
  };
  // A weapon variant can be bought once the hero has unlocked its base weapon.
  S.armoryOpen = (p, cls, id) => { const e = armoryList(cls)[armoryIdx(cls, id)]; return !!e && (!e.weapon || ED.weaponUnlocked(cls, ED.weaponIndex(cls, e.weapon), S.masteryLevel(p, cls))); };
  S.buyArmory = (p, cls, id) => {
    const i = armoryIdx(cls, id);
    if (i < 0 || !S.armoryOpen(p, cls, id)) return false;
    const a = armoryRow(p, cls), cost = armoryList(cls)[i].cost;
    if (a[i] || p.embers < cost) return false;
    p.embers -= cost; a[i] = 1;
    return true;
  };
  S.refundArmory = (p, cls, id) => {
    const i = armoryIdx(cls, id);
    if (i < 0) return false;
    const a = armoryRow(p, cls);
    if (!a[i]) return false;
    p.embers += armoryList(cls)[i].cost; a[i] = 0;
    return true;
  };
  // Embers a full reset returns: every upgrade rank and every owned Armory entry.
  S.refundTotal = (p) => {
    let n = 0;
    ED.UPGRADES.forEach((u, i) => { for (let k = 0; k < (p.up[i] | 0); k++) n += u.costs[k]; });
    for (const c of ED.CLASS_IDS) armoryList(c).forEach((e, i) => { if (p.armory && p.armory[c] && p.armory[c][i]) n += e.cost; });
    return n;
  };
  // Clears every upgrade rank and Armory unlock and returns their embers; returns the amount.
  S.resetUpgrades = (p) => {
    const n = S.refundTotal(p);
    p.up = ED.UPGRADES.map(() => 0); p.armory = blankArmory(); p.embers += n;
    return n;
  };

  // ---------------- secrets and the Wardrobe ----------------
  // Marks secret `id` earned; returns the secret the first time, else null.
  S.grantSecret = (p, id) => {
    const i = ED.SECRET_IDX[id];
    if (i === undefined || ((p.secrets | 0) & (1 << i))) return null;
    p.secrets = (p.secrets | 0) | (1 << i);
    return ED.SECRETS[i];
  };
  // Grants every secret whose check passes for a finished run (pl: the local hero's summary entry); returns the new ones.
  S.checkSecrets = (p, run, pl) => {
    const got = [];
    ED.SECRETS.forEach((s, i) => {
      if ((p.secrets | 0) & (1 << i)) return;
      let ok = false;
      try { ok = s.check(p, run, pl || null); } catch (e) { ok = false; }
      if (ok && S.grantSecret(p, s.id)) got.push(s);
    });
    return got;
  };
  // An item sold for embers whose hero has reached the gate's mastery (owned or not).
  S.cosOpen = (p, id) => { const c = ED.COSMETIC[id]; return !!c && !!c.gate.cost && !!c.cls && S.masteryLevel(p, c.cls) >= c.gate.mastery; };
  // Buys item `id` (ember gate only): never refunded and outside Reset all; lifetime embers never change.
  S.buyCosmetic = (p, id) => {
    const c = ED.COSMETIC[id];
    if (!S.cosOpen(p, id) || ED.cosOwned(p, id, c.cls) || p.embers < c.gate.cost) return false;
    p.embers -= c.gate.cost;
    const had = Array.isArray(p.cos) ? p.cos : [];
    p.cos = ED.COSMETICS.filter(x => x.id === id || had.indexOf(x.id) >= 0).map(x => x.id);
    return true;
  };
  const wearRow = (p, cls) => {
    if (!p.wear || typeof p.wear !== 'object') p.wear = blankWear();
    if (!p.wear[cls]) p.wear[cls] = blankWearHero();
    return p.wear[cls];
  };
  // Wears item `id` in `slot` of hero `cls` (null empties the slot); slot 'camp' is the Hearth's (cls ignored); slot 'tint' adds that tint, or removes it when `on` is false.
  // Returns false for an item the hero does not own or that does not fit the slot.
  S.wear = (p, cls, slot, id, on) => {
    const c = id ? ED.COSMETIC[id] : null;
    if (id && (!c || c.slot !== slot)) return false;
    if (slot === 'camp') {
      if (c && !ED.cosOwned(p, id, null)) return false;
      if (!p.wear || typeof p.wear !== 'object') p.wear = blankWear();
      p.wear.camp = id || null;
      return true;
    }
    if (!ED.CLASSES[cls] || (c && ((c.cls !== null && c.cls !== cls) || !ED.cosOwned(p, id, cls)))) return false;
    const o = wearRow(p, cls);
    if (slot === 'tint') {
      if (!c) return false;
      const t = (o.tints || []).filter(w => w !== c.weapon);
      if (on !== false) t.push(c.weapon);
      o.tints = ED.CLASSES[cls].weapons.filter(w => t.indexOf(w) >= 0);
      return true;
    }
    if (ED.WEAR_SLOTS.indexOf(slot) < 0) return false;
    o[slot] = id || null;
    return true;
  };
  // The owned items hero `cls` wears, for the hero pick a party shares: { skin, aura, hat, pet, trail, death, title, tints }.
  S.wearBundle = (p, cls) => {
    const h = (p.wear && p.wear[cls]) || {}, out = {};
    for (const k of ED.WEAR_SLOTS) out[k] = h[k] && ED.cosOwned(p, h[k], cls) ? h[k] : null;
    out.tints = (h.tints || []).filter(w => ED.cosOwned(p, 'tint.' + w, cls));
    return out;
  };

  // The meta bundle a player brings into a run (sent to the host in multiplayer): upgrade ranks, mastery level and the ids of the hero's owned Armory entries.
  S.metaBundle = (p, cls) => ({
    up: p.up.slice(),
    mastery: S.masteryLevel(p, cls),
    armory: armoryList(cls).filter((e, i) => p.armory && p.armory[cls] && p.armory[cls][i]).map(e => e.id),
  });

  // ---------------- run rewards ----------------
  // run: summary produced by the world for everyone in the party (shared progression).
  S.computeRewards = (p, run) => {
    const lines = [];
    const base = run.embers || { rooms: 0, elites: 0, bosses: 0, victory: 0 };
    if (base.rooms) lines.push(['Rooms cleared', base.rooms]);
    if (base.elites) lines.push(['Elites killed', base.elites]);
    if (base.bosses) lines.push(['Bosses defeated', base.bosses]);
    if (base.victory) lines.push(['Run won', base.victory]);
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
    if (total > sub && mult <= 1.001) lines.push(['Minimum payout', total - sub]);
    const masteryXp = Math.round((run.roomsCleared || 0) * 8 + (run.elitesKilled || 0) * 5 + (run.bossCount || 0) * 40 + (run.stratum || 0) * 15 + (run.victory ? 150 : 0) + (run.level || 0) * 2);
    return { lines, total, masteryXp };
  };

  S.runCounts = (run) => (run.roomsCleared || 0) >= 1 || !!run.victory;

  // Applies a finished run; run.me is the local hero's entry of the summary's players (its secret fields), run.weapon the weapon the hero wielded.
  // Returns { rewards, unlocks: [text], deeds: [deed], secrets: [secret] }.
  S.applyRun = (p, run) => {
    const pl = run.me || null;
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
    p.stats.kills += Math.max(0, (run.kills | 0) - (run.fodderKills | 0)); // lifetime kills (First Blood, Slayer, Legend) count foes that are not horde fodder
    p.stats.deepest = Math.max(p.stats.deepest, run.stratum | 0);
    p.stats.bossKills += run.bossCount | 0;
    p.bosses |= (run.bosses | 0);
    if (run.victory) {
      p.stats.wins += 1;
      if (!p.stats.bestTime || run.time < p.stats.bestTime) p.stats.bestTime = Math.round(run.time);
      p.pactWin = Math.max(p.pactWin, run.pact | 0);
      p.pactMax = Math.min(10, Math.max(p.pactMax, (run.pact | 0) + 1));
    }
    if (run.victory && pl && pl.bellRung) p.bellUnlocked = true;
    const unlocks = [];
    // a descent in which the hero evolved its weapon counts toward that base weapon's tint
    const base = run.evolved && run.weapon ? ED.weaponBase(String(run.weapon).split('@')[0]) : null;
    if (base && ED.CLASSES[run.cls] && ED.CLASSES[run.cls].weapons.indexOf(base) >= 0) {
      if (!p.evo || typeof p.evo !== 'object') p.evo = {};
      const tint = ED.COSMETIC['tint.' + base], had = ED.cosOwned(p, tint.id, run.cls);
      p.evo[base] = Math.min(9999, (p.evo[base] | 0) + 1);
      if (!had && ED.cosOwned(p, tint.id, run.cls)) unlocks.push('Wardrobe: ' + tint.name);
    }
    for (const c of ED.CLASS_IDS) if (S.classUnlocked(p, c) && before.classes.indexOf(c) < 0) unlocks.push('New hero: ' + ED.CLASSES[c].name);
    const ml = S.masteryLevel(p, run.cls);
    for (let l = before.mastery + 1; l <= ml; l++) unlocks.push(`${ED.CLASSES[run.cls].name} mastery ${l}: ${ED.MASTERY_REWARDS[l]}`);
    if (p.stats.deepest > before.tiers) {
      const fresh = ED.UPGRADES.filter(u => u.tier > Math.max(1, before.tiers) && u.tier <= p.stats.deepest);
      if (fresh.length) unlocks.push('New Hearth upgrades: ' + fresh.map(u => u.name).join(', '));
    }
    if (p.pactMax > before.pactMax) unlocks.push(`Pact ${p.pactMax} unlocked`);
    if (before.mastery < 10 && ml >= 10 && ci >= 0) wearRow(p, run.cls).aura = 'aura.gilded'; // Gilded is worn when first earned
    const secrets = S.checkSecrets(p, run, pl); // before this victory joins heroWins (Hollow Crown reads the hero's earlier wins)
    if (run.victory && ci >= 0) p.heroWins = (p.heroWins | 0) | (1 << ci);
    const deeds = S.checkDeeds(p, run);
    for (const i of Array.isArray(run.lore) ? run.lore : []) if (S.loreAdd(p, i | 0)) unlocks.push('Codex: ' + ED.LORE[i | 0].title); // lore pages the party found (world.js summary)
    return { rewards, unlocks, deeds, secrets };
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

  // A worn item in the code: 0 none, else 1 + 2 × its index in its scope + 1 for the hero's scope (0 for the global one); unknown ids write 0.
  const cosRef = (id, cls) => {
    const c = id && ED.COSMETIC[id];
    if (!c) return 0;
    const i = ED.COS_SCOPE[c.cls === null ? '' : c.cls].indexOf(c);
    return c.cls === null ? 1 + 2 * i : c.cls === cls ? 2 + 2 * i : 0;
  };
  const cosAt = (v, cls) => { if (!v) return null; const list = (v - 1) & 1 ? (cls ? ED.COS_SCOPE[cls] : null) : ED.COS_SCOPE['']; const c = list && list[(v - 1) >> 1]; return c ? c.id : null; };

  S.encode = (p) => {
    const w = new BitWriter();
    w.put(CODE_VERSION, 8);
    const name = S.sanitizeName(p.name);
    w.put(name.length, 4);
    for (const ch of name) w.put(NAME_CHARS.indexOf(ch), 6);
    w.varint(p.embers); w.varint(p.lifetime);
    w.put(ED.UPGRADES.length, 6);
    ED.UPGRADES.forEach((u, i) => w.put(p.up[i] | 0, 3));
    w.put(ED.CLASS_IDS.length, 4);
    ED.CLASS_IDS.forEach((c, i) => w.varint(p.mastery[i] | 0));
    w.put(ED.CLASS_IDS.length, 4);
    for (const c of ED.CLASS_IDS) {
      const list = armoryList(c), owned = (p.armory && p.armory[c]) || [];
      if (list.length > 63) throw new Error('Too many Armory entries for the 6-bit count: widen it and bump CODE_VERSION');
      w.put(list.length, 6);
      list.forEach((e, i) => w.put(owned[i] ? 1 : 0, 1));
    }
    w.put(p.bosses & 63, 6);
    w.put(ED.DEEDS.length, 6);
    ED.DEEDS.forEach((d, i) => w.put((p.deeds >>> i) & 1, 1));
    w.put(p.pactMax, 4); w.put(p.pactWin + 1, 4);
    const st = p.stats;
    w.varint(st.runs); w.varint(st.wins); w.put(st.deepest & 7, 3); w.varint(st.kills); w.varint(st.bestTime); w.varint(st.bossKills);
    // v8: secrets, hero wins, the Bellwarden flag, evolutions per base weapon, Wardrobe purchases per scope, worn items
    w.put(ED.SECRETS.length, 6);
    ED.SECRETS.forEach((s, i) => w.put(((p.secrets | 0) >>> i) & 1, 1));
    w.put(ED.CLASS_IDS.length, 4);
    ED.CLASS_IDS.forEach((c, i) => w.put(((p.heroWins | 0) >>> i) & 1, 1));
    w.put(p.bellUnlocked ? 1 : 0, 1);
    w.put(ED.CLASS_IDS.length, 4);
    for (const c of ED.CLASS_IDS) { const ws = ED.CLASSES[c].weapons; w.put(ws.length, 3); for (const x of ws) w.varint((p.evo && p.evo[x]) | 0); }
    const cos = Array.isArray(p.cos) ? p.cos : [];
    const scopeBits = (list) => { if (list.length > 63) throw new Error('Too many Wardrobe entries for the 6-bit count: widen it and bump CODE_VERSION'); w.put(list.length, 6); for (const c of list) w.put(cos.indexOf(c.id) >= 0 ? 1 : 0, 1); };
    scopeBits(ED.COS_SCOPE['']);
    w.put(ED.CLASS_IDS.length, 4);
    for (const c of ED.CLASS_IDS) scopeBits(ED.COS_SCOPE[c] || []);
    const wear = p.wear || {};
    w.varint(cosRef(wear.camp, null));
    w.put(ED.CLASS_IDS.length, 4);
    for (const c of ED.CLASS_IDS) {
      const h = wear[c] || {}, ws = ED.CLASSES[c].weapons, t = h.tints || [];
      w.put(ED.WEAR_SLOTS.length, 4);
      for (const k of ED.WEAR_SLOTS) w.varint(cosRef(h[k], c));
      w.put(ws.length, 3);
      for (const x of ws) w.put(t.indexOf(x) >= 0 ? 1 : 0, 1);
    }
    // v10: lore pages
    if (loreN() > 63) throw new Error('Too many lore pages for the 6-bit count: widen it and bump CODE_VERSION');
    w.put(loreN(), 6);
    for (let i = 0; i < loreN(); i++) w.put(S.loreHas(p, i) ? 1 : 0, 1);
    const body = w.bytes();
    const crc = crc16(body);
    const all = new Uint8Array(body.length + 2);
    all.set(body); all[body.length] = crc >> 8; all[body.length + 1] = crc & 255;
    const code = toB32(scramble(all));
    return PREFIX + '-' + code.match(/.{1,5}/g).join('-');
  };

  // Returns a normalized profile or throws an Error with a human-readable message.
  S.decode = (code) => {
    let s = String(code || '').toUpperCase().replace(/\s+/g, '');
    // Save groups are 5 characters, so a shorter leading group is a prefix; only WD1 (dash optional) is ours.
    const head = (s.match(/^([A-Z0-9]{1,4})-/) || [])[1];
    if (s.startsWith('ED1')) throw new Error('That is an Emberdeep save code. Wickdeep starts a fresh profile, so old codes do not carry over. Wickdeep codes begin with ' + PREFIX + '-.');
    if (s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
    else if (head) throw new Error(`That code starts with "${head}-", but Wickdeep save codes begin with ${PREFIX}-.`);
    s = s.replace(/-/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
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
      if (ver > CODE_VERSION) throw Object.assign(new Error('That code was made by a newer Wickdeep. Reload the page to get the latest version.'), { keep: true });
      if (ver < 2) throw new Error('ver');
      const nl = r.get(4); let name = '';
      for (let i = 0; i < nl; i++) name += NAME_CHARS[r.get(6)] || '';
      p.name = S.sanitizeName(name);
      p.embers = r.varint(); p.lifetime = r.varint();
      const nu = ver >= 4 ? r.get(6) : V2_UPGRADES; // missing entries stay 0, extra ones are skipped
      for (let k = 0; k < nu; k++) { const v = r.get(3); if (k < ED.UPGRADES.length) p.up[k] = Math.min(ED.UPGRADES[k].costs.length, v); }
      let refund = 0; // v2-v4: the Codex relic bits follow the upgrades; their embers come back
      if (ver < 5) {
        const n = ver === 2 ? V2_RELIC_BITS : r.get(7);
        for (let k = 0; k < n; k++) { const bit = r.get(1); if (bit && k < V4_CODEX.length) refund += V4_RELICS[V4_CODEX[k]][2]; } // extra bits are skipped
      }
      const nm = ver >= 4 ? r.get(4) : V2_HEROES;
      for (let k = 0; k < nm; k++) { const v = r.varint(); if (k < ED.CLASS_IDS.length) p.mastery[k] = v; }
      if (ver >= 5) {
        const nc = r.get(4); // Armory: heroes beyond this build are skipped, missing entries stay 0
        for (let k = 0; k < nc; k++) {
          const ne = r.get(6), cls = ED.CLASS_IDS[k], list = cls ? armoryList(cls) : [];
          for (let i = 0; i < ne; i++) { const bit = r.get(1); if (bit && i < list.length) p.armory[cls][i] = 1; }
        }
      }
      p.bosses = ver < 9 ? sixBosses(r.get(6)) : r.get(6);
      const nd = r.get(6); let deeds = 0;
      for (let i = 0; i < nd; i++) if (r.get(1)) deeds |= (1 << i);
      p.deeds = deeds;
      p.pactMax = Math.min(10, r.get(4)); p.pactWin = Math.min(10, r.get(4) - 1);
      p.stats.runs = r.varint(); p.stats.wins = r.varint(); p.stats.deepest = ver < 9 ? sixDeep(r.get(3)) : Math.min(ED.CONST.STRATA, r.get(3));
      p.stats.kills = r.varint(); p.stats.bestTime = r.varint(); p.stats.bossKills = r.varint();
      if (ver >= 8) { // entries beyond this build are skipped, missing ones stay empty
        const ns = r.get(6); let sec = 0;
        for (let i = 0; i < ns; i++) if (r.get(1) && i < ED.SECRETS.length && i < 31) sec |= (1 << i);
        p.secrets = sec;
        const nw = r.get(4); let wins = 0;
        for (let i = 0; i < nw; i++) if (r.get(1) && i < ED.CLASS_IDS.length) wins |= (1 << i);
        p.heroWins = wins;
        p.bellUnlocked = r.get(1) === 1;
        const ne = r.get(4);
        for (let k = 0; k < ne; k++) {
          const cls = ED.CLASS_IDS[k], ws = cls ? ED.CLASSES[cls].weapons : [], n = r.get(3);
          for (let i = 0; i < n; i++) { const v = r.varint(); if (v && i < ws.length) p.evo[ws[i]] = v; }
        }
        const scope = (list) => { const n = r.get(6); for (let i = 0; i < n; i++) if (r.get(1) && list && i < list.length) p.cos.push(list[i].id); };
        scope(ED.COS_SCOPE['']);
        const nc = r.get(4);
        for (let k = 0; k < nc; k++) scope(ED.CLASS_IDS[k] ? ED.COS_SCOPE[ED.CLASS_IDS[k]] : null);
        const wear = { camp: cosAt(r.varint(), null) }, nh = r.get(4);
        for (let k = 0; k < nh; k++) {
          const cls = ED.CLASS_IDS[k], h = {}, nsl = r.get(4);
          for (let i = 0; i < nsl; i++) { const v = r.varint(); if (cls && i < ED.WEAR_SLOTS.length) h[ED.WEAR_SLOTS[i]] = cosAt(v, cls); }
          const ws = cls ? ED.CLASSES[cls].weapons : [], nt = r.get(3);
          h.tints = [];
          for (let i = 0; i < nt; i++) if (r.get(1) && i < ws.length) h.tints.push(ws[i]);
          if (cls) wear[cls] = h;
        }
        p.wear = wear;
        if (ver >= 10) { const nl = r.get(6); let lore = 0; for (let i = 0; i < nl; i++) if (r.get(1) && i < loreN()) lore += 2 ** i; p.lore = lore; } // pages beyond this build are skipped
      } else p.wear = undefined; // a code from before the Wardrobe: Gilded is worn where mastery 10 is reached (S.normalize)
      p.embers += refund; p.refunded = refund;
      const played = p.stats.runs > 0 || refund > 0;
      p.news = !played ? 0 : ver < 5 ? 1 : ver < 7 ? 2 : ver < 9 ? 3 : ver < 10 ? 4 : 0; // the oldest notice part the code's build had not shown: before the v4 rules all, before the v5 difficulty from v5, before v6 from v6, before v7 the v7 part
    } catch (e) {
      if (e && e.keep) throw e;
      throw new Error('That code is from an unknown version or is damaged.');
    }
    return S.normalize(p);
  };
})(globalThis.ED || (globalThis.ED = {}));
