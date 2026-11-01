// Profile persistence (localStorage autosave + portable checksummed save code), meta rules (shop, unlocks, records) and the ED.Meta API for the UI.
// Profile: { v, name, gold, lifetime, shop: { shopId: rank }, spent (gold paid for the owned ranks; Refund All returns it), heroes: [unlocked cls], played: [cls with a finished run],
//   won: [cls with a win], formed: [cls whose hero weapon reached a Form], beat: [stage indices beaten], pure: [stage indices won with 0 Camp ranks], ach: [achievement ids earned],
//   best: { stageId: { time, kills, level, won } }, stats: { runs, wins, kills (lifetime), bestLevel, bestKills (one run, own hero), bestTime (one run, s), coopWins },
//   seen: { heroes: [cls], weapons: [wid, evolved included], passives: [id], foes: [foe id, bosses included], stages: [stage id] } (Encyclopedia reveals),
//   cos: [owned cosmetic ids], wear: [worn cosmetic ids: one per ED.COS_KINDS slot, skins one per hero] (both in ED.COS_IDS order) }. Settings live under their own key.
// Save code: 'WK2-' + base32(scramble(bit-packed fields + CRC-15)) in groups of 5 (encode); decode also reads 'WK1-' (byte-packed v1). Positional lists (SHOP order, hero order
// ED.HERO_IDS, stage order, STAT_KEYS, SEEN_KEYS and each seen list's order, ED.ACH_IDS, ED.COS_IDS) carry a count: append only; a reorder or removal needs a new prefix (WK3).
// Rules: ED.UNLOCKS, ED.ACHIEVEMENTS (src/data/meta.js).
(function (ED) {
  'use strict';
  const U = ED.U;
  // ?slot=2 keeps a second profile in the same browser (two local tabs playing together).
  const SLOT = (() => { try { const v = new URLSearchParams(location.search).get('slot'); return v ? '.' + v.replace(/[^a-z0-9]/gi, '').slice(0, 8) : ''; } catch (e) { return ''; } })();
  const LS_KEY = 'wickdeep.survivors.v1' + SLOT, LS_SETTINGS = 'wickdeep.survivors.settings.v1';
  // Name alphabet: NAME_CHARS (index 0..63), then the 2,350 KS X 1001 Hangul syllables in code point order (index 64..2413; the Hangul font subset covers exactly these).
  const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
  // KS X 1001 syllables as Rice(k = 2) coded gaps (c - previous - 1, from U+ABFF), MSB first in base64; tools/check-save.js rebuilds it from TextDecoder('euc-kr').
  const HANGUL_KS = 'ASAEgAAAgAJ2CBQT0ab9hIGQQAgA3YIFAFCwQGm8HASBKAJEhMyCabwhQTsE03g4CQAgAkSE9ivWAnYOG/YSAoE1+wkDIJDIBZkEBoJ2CBQr/7ALsECgto03oQv2ETYJAgVsUPdN2HX7CdAEib2KCdhW3Y1+wiTABL/oJ2CaAKAEggAEgJ2CBQTuP9AhkQCBICdggUE7CCb+wmZBMAN7/23YOAngmgkLBNe7/bdjQqw6CYEgkMt+wmZBMEAoABgEABgJ2CBX/9gFAiASUQnYIFN7FP7CQJYJJTfv3bdg4/YTsE17v4pvBNN3FBIGQTX7CQsEASE7BAkBOwQP/+gmRAIEgJ2CBXv/YT4q/f7f/7CdCP9ftuw/9BIWDhuxpuwTQTsEAMAJ2CBQXR/0E7BAkBOwTQTsECnwcBOwTT8fq27BNN4JoJ2Ca93+wnaNBOwTQTsEhD+QnYJoIgASCQiAnYIAkVx/oJmQSIATsECgnoAx+wQzIJp9j/TeCabwcAFACQSyG8HH7b9t2sN2v+AkDIIBKAAQAEAloJ2CA0Fx/0EgZBIkJCwQKCeCA0/sAuwTT7v3YTsaf2EgBIJYN7v9hPim7RoJ2D/wEzIJAgJmQQJATsECh1/2EhaAr4odAgf6Cdh//9fv4oJ2j///6+Kbsf9BOwTQIQAkEBoJ2CBQTsE03cUAAgRAIEEJ2CBQTsECm+KALMgloJ8U3aFt2DgJ2CaCQsEkg+7CdxQTsE0KtGgmKBP+gkKAJggh2EJATsIfv/QTMhCm//39hIGQ6C7v3bdjX7Cdh17v9v/4oJmANN3sJ2CaCAIEAEBghOwQKCagEshvGggQBIAABJCdgmgCyIAADADdgiwmAUASYCdggUFtGgnYJoJ2CaCYEgmgnYQoJ2HQTsE0E7BJgJyQSAAAG7WAmBABADIRAMggCQnYIFBE3FN+wmZBIkJ2CabsIV+wmZBIDArBNexTdgmgvFBMCQTXu/2E7Bw3ewnYJ/0EgZBIQIRKgECgnYIFPx/oJ2CBXxXv/YTsEmBW7923Y/ugnYdex/r9/vtH/QTsMQAibBAEhOwQKZNx/oJ2CBQTsE0+7fignYJpvj/Tdgmu9hOwTXu39t2CabuKCdgn/QSAoE0E7BNBOwQKHv/QSFggUE7BNN2CBX7CdgmgncV8Vfv9hOwTTfFfFBOwTTd7Cdh/6CdgmgmKBAoJ2CBXx/oJmQQKCdgmn3b+wnYJgv7/b6NfsJ2Ca93+wnYdN3FBIGQcN2NBOwTQBZkEBoJ2CBQ//oJ2CBQTsE03YQq8HATsE18f6f23g4CQMgmvj/TdrDdo03YP/ATsE0E4QJoJ2CBXx/oJmQTQTsE0E7BApvGgnCBLQT0aC6NBPBNN4OAnCRpu4oJ8UE7BNBO0aCIAoEtN2HQTsEg';
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', PREFIX = 'WK2', CODE_VERSION = 2;
  const STAT_KEYS = ['runs', 'wins', 'kills', 'bestLevel', 'bestKills', 'bestTime', 'coopWins']; // save code order: append only
  const SEEN_KEYS = ['heroes', 'weapons', 'passives', 'foes', 'stages']; // save code order: append only
  // Weapon order of the seen list: append only (ED.WEAPON_IDS is load order). The first 24 ids are the old general weapons: supports reuse their ids; SEEN_DEAD ids are retired
  // (never registered again: dropped from profiles, skipped by WK2 codes, dead bits in WK1 codes); supports new since then append at the end.
  const SEEN_WEAPONS = ['lanterns', 'sunwheel', 'chainspark', 'stormcrown', 'frostring', 'glacier', 'bramble', 'thornwood', 'glaive', 'twinmoons', 'meteorcall', 'starfall', 'bonespear', 'impaler',
    'blight', 'plague', 'wisp', 'choir', 'mortar', 'barrage', 'censer', 'holycenser', 'ricochet', 'avalanche', 'cleave', 'whirlwind', 'longbow', 'hail', 'firebolt', 'inferno', 'boneshard', 'bonestorm',
    'smite', 'wrath', 'daggers', 'shadowfan', 'toll', 'cathedral',
    'colossus', 'gale', 'earthsplitter', 'tempest', 'ballista', 'seeker', 'galeshot', 'rebound', 'firestorm', 'wildfire', 'pyre', 'napalm', 'bonelord', 'plaguefield',
    'lich', 'ossuary', 'halo', 'jray', 'consecration', 'verdict', 'thousand', 'assassinate', 'lotus', 'reaper', 'glaciertoll', 'carillon', 'undertow', 'windchime',
    'waraxe', 'headsman'];
  const SEEN_DEAD = ['bonespear', 'impaler', 'blight', 'plague', 'wisp', 'choir', 'mortar', 'barrage', 'ricochet', 'avalanche'];
  const S = ED.Save = { KEY: LS_KEY, CODE_VERSION, STAT_KEYS, SEEN_KEYS, SEEN_WEAPONS };
  const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);
  const heroOrder = () => ED.HERO_IDS || Object.keys(ED.UNLOCKS.heroes);
  // Id order of seen list k (WK2 save code order): heroes ED.HERO_IDS, weapons SEEN_WEAPONS without SEEN_DEAD (+ registered weapons missing from it, profile only),
  // passives ED.PASSIVE_IDS, foes ED.FOE_IDS (bosses included), stages ED.STAGE_IDS.
  const LIVE_WEAPONS = SEEN_WEAPONS.filter(id => SEEN_DEAD.indexOf(id) < 0);
  const seenOrder = S.seenOrder = (k) => k === 'heroes' ? heroOrder() : k === 'weapons' ? LIVE_WEAPONS.concat((ED.WEAPON_IDS || []).filter(id => SEEN_WEAPONS.indexOf(id) < 0))
    : k === 'passives' ? ED.PASSIVE_IDS || [] : k === 'foes' ? ED.FOE_IDS || [] : k === 'stages' ? ED.STAGE_IDS || [] : [];
  const codeOrder = (k) => (k === 'weapons' ? SEEN_WEAPONS : seenOrder(k)); // WK1 bit order
  const codeOrder2 = (k) => (k === 'weapons' ? LIVE_WEAPONS : seenOrder(k)); // WK2 order (append only)

  S.defaultProfile = () => {
    const stats = {}; for (const k of STAT_KEYS) stats[k] = 0;
    const seen = {}; for (const k of SEEN_KEYS) seen[k] = [];
    return { v: 1, name: 'Wanderer', gold: 0, lifetime: 0, shop: {}, spent: 0, heroes: startHeroes(), played: [], won: [], formed: [], beat: [], pure: [], ach: [], best: {}, stats, seen, cos: [], wear: [] };
  };
  const startHeroes = () => Object.keys(ED.UNLOCKS.heroes).filter(c => ED.UNLOCKS.heroes[c].start);
  // Name alphabet map char -> index, and the Hangul list (built once from HANGUL_KS). S.hangulNames() -> a copy of that list.
  let HANGUL = null, NAME_IDX = null;
  const nameIdx = () => {
    if (NAME_IDX) return NAME_IDX;
    const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let i = 0, c = 0xabff; const bit = () => { const b = (A64.indexOf(HANGUL_KS[Math.floor(i / 6)]) >> (5 - i % 6)) & 1; i++; return b; };
    HANGUL = [];
    while (HANGUL.length < 2350) { let q = 0; while (bit()) q++; const g = q * 4 + bit() * 2 + bit(); c += g + 1; HANGUL.push(String.fromCharCode(c)); }
    NAME_IDX = new Map();
    for (let k = 0; k < NAME_CHARS.length; k++) NAME_IDX.set(NAME_CHARS[k], k);
    HANGUL.forEach((ch, k) => NAME_IDX.set(ch, 64 + k));
    return NAME_IDX;
  };
  S.hangulNames = () => (nameIdx(), HANGUL.slice());
  // Name: NFC, characters outside the name alphabet dropped, trimmed, at most 12 characters; '' -> 'Wanderer'.
  S.sanitizeName = (n) => {
    n = String(n || ''); if (n.normalize) n = n.normalize('NFC');
    const M = nameIdx(); let out = '';
    for (const ch of n) if (M.has(ch)) out += ch;
    out = out.trim().slice(0, 12).trim();
    return out || 'Wanderer';
  };
  const num = (v) => { v = Math.floor(+v || 0); return v > 0 && isFinite(v) ? Math.min(v, 1e12) : 0; };

  // Any parsed object -> a valid profile (unknown fields dropped, numbers clamped, start heroes always unlocked, hero / stage lists in save order).
  S.normalize = (o) => {
    const p = S.defaultProfile(); o = o && typeof o === 'object' ? o : {};
    p.name = S.sanitizeName(o.name);
    p.gold = num(o.gold); p.lifetime = Math.max(p.gold, num(o.lifetime));
    // Ranks above a row's max, up to its former max (s.was), are dropped and refunded once (the clamped rank is what gets stored): today's price (cost x rank^2, at most spent);
    // a profile without spent: the old rule (80 x rank). Ranks past was are dropped unpaid.
    const legacy = o.spent === undefined;
    let back = 0;
    for (const s of ED.SHOP) {
      const r = o.shop ? num(o.shop[s.id]) : 0; if (r > 0) p.shop[s.id] = U.clamp(r, 0, s.max);
      for (let k = s.max, e = Math.min(r, s.was | 0); k < e; k++) back += legacy ? 80 * (k + 1) : s.cost * (k + 1) * (k + 1);
    }
    // spent: a profile from before spent was kept gets the old price rule (80 x rank) so a refund never pays more than was paid.
    p.spent = !legacy ? num(o.spent) : ED.SHOP.reduce((t, s) => { const r = p.shop[s.id] | 0; return t + 40 * r * (r + 1); }, 0);
    if (!legacy) { back = Math.min(back, p.spent); p.spent -= back; }
    if (back > 0) { p.gold += back; p.lifetime = Math.max(p.lifetime, p.gold); }
    const heroOk = (c) => ED.UNLOCKS.heroes[c] !== undefined, clsList = (a) => (Array.isArray(a) ? a.filter((c, i) => heroOk(c) && a.indexOf(c) === i) : []);
    const stList = (a) => (Array.isArray(a) ? a.map(v => v | 0).filter((v, i, b) => v >= 0 && v < ED.STAGES.length && b.indexOf(v) === i) : []);
    if (Array.isArray(o.heroes)) for (const c of o.heroes) if (heroOk(c) && p.heroes.indexOf(c) < 0) p.heroes.push(c);
    p.played = clsList(o.played); p.won = clsList(o.won); p.formed = clsList(o.formed);
    p.beat = stList(o.beat); p.pure = stList(o.pure);
    if (Array.isArray(o.ach)) p.ach = ED.ACH_IDS.filter(id => o.ach.indexOf(id) >= 0);
    if (o.best && typeof o.best === 'object') for (const id of ED.STAGE_IDS) { const b = o.best[id]; if (b && typeof b === 'object') p.best[id] = { time: num(b.time), kills: num(b.kills), level: num(b.level), won: !!b.won }; }
    if (o.stats && typeof o.stats === 'object') for (const k of STAT_KEYS) p.stats[k] = num(o.stats[k]);
    const ord = heroOrder(), byOrd = (x, y) => ord.indexOf(x) - ord.indexOf(y);
    p.heroes.sort(byOrd); p.played.sort(byOrd); p.won.sort(byOrd); p.formed.sort(byOrd); p.beat.sort((x, y) => x - y); p.pure.sort((x, y) => x - y);
    // seen: known ids in seenOrder; back-fill: played heroes and their signature weapons, stages with a best or a win.
    const sn = o.seen && typeof o.seen === 'object' ? o.seen : {}, want = {};
    for (const k of SEEN_KEYS) want[k] = new Set(Array.isArray(sn[k]) ? sn[k] : []);
    for (const c of p.played) { want.heroes.add(c); const h = ED.HEROES && ED.HEROES[c]; if (h && h.sig) want.weapons.add(h.sig); }
    for (const i of p.beat) want.stages.add(ED.STAGE_IDS[i]);
    for (const id in p.best) want.stages.add(id);
    for (const k of SEEN_KEYS) p.seen[k] = seenOrder(k).filter(id => want[k].has(id));
    // cosmetics: known gold items, plus the reward of every earned achievement; worn ids must be owned, the last one listed per slot wins
    const own = new Set(Array.isArray(o.cos) ? o.cos.filter(id => { const d = cosDef(id); return d && d.price > 0; }) : []);
    for (const id of p.ach) { const r = achReward(id); if (r) own.add(r); }
    p.cos = cosIds().filter(id => own.has(id));
    if (Array.isArray(o.wear)) for (const id of o.wear) if (own.has(id)) setWear(p, id);
    return p;
  };

  // ---------------- storage ----------------
  S.load = () => { const L = ls(); if (!L) return null; try { const raw = L.getItem(LS_KEY); return raw ? S.normalize(JSON.parse(raw)) : null; } catch (e) { return null; } };
  S.store = (p) => { const L = ls(); if (!L) return false; try { L.setItem(LS_KEY, JSON.stringify(p)); return true; } catch (e) { return false; } };
  S.erase = () => { const L = ls(); if (L) try { L.removeItem(LS_KEY); } catch (e) { /* storage blocked */ } };
  // bindsV 1: skill 1 / skill 2 lost their LMB / RMB defaults; older saved binds still holding Mouse0 in skill1[1] or Mouse2 in skill2[1] are cleared once.
  const BINDS_V = 1;
  // lang: '' = auto (ED.I18N.detect: browser language), else 'en' | 'ko'.
  S.defaultSettings = () => ({ master: 70, music: 55, sfx: 80, quality: 'high', shake: true, numbers: true, lang: '', binds: null, bindsV: BINDS_V });
  S.loadSettings = () => {
    const d = S.defaultSettings(), L = ls(); if (!L) return d;
    try {
      const raw = L.getItem(LS_SETTINGS), s = JSON.parse(raw || '{}') || {};
      if (raw && (s.bindsV | 0) < BINDS_V) {
        const b = s.binds && typeof s.binds === 'object' ? s.binds : null;
        if (b && Array.isArray(b.skill1) && b.skill1[1] === 'Mouse0') b.skill1[1] = null;
        if (b && Array.isArray(b.skill2) && b.skill2[1] === 'Mouse2') b.skill2[1] = null;
        s.bindsV = BINDS_V; S.storeSettings(s);
      }
      return Object.assign(d, s);
    } catch (e) { return d; }
  };
  S.storeSettings = (s) => { const L = ls(); if (L) try { L.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) { /* storage blocked */ } };

  // ---------------- unlocks and shop ----------------
  S.heroUnlocked = (p, cls) => p.heroes.indexOf(cls) >= 0;
  // Stage rule (ED.UNLOCKS.stages): start | beat (that stage beaten) | beatAll (every listed stage beaten).
  S.stageUnlocked = (p, i) => { const r = ED.UNLOCKS.stages[i]; return !!r && !!ED.STAGES[i] && (!!r.start || (r.beat !== undefined && p.beat.indexOf(r.beat) >= 0) || (!!r.beatAll && r.beatAll.every(k => p.beat.indexOf(k) >= 0))); };
  // True while stage i is hidden (its rule has hidden and it is still locked): no stage card, lobby button, codex or achievement entry names it.
  S.stageHidden = (p, i) => { const r = ED.UNLOCKS.stages[i]; return !!(r && r.hidden) && !S.stageUnlocked(p, i); };
  S.rank = (p, id) => p.shop[id] | 0;
  // Cost of the next rank (ED.shopPrice: cost x (rank + 1)^2), 0 when maxed or unknown.
  S.shopCost = (p, id) => { const s = ED.SHOP.find(x => x.id === id); return s ? ED.shopPrice(s, S.rank(p, id)) : 0; };
  S.buy = (p, id) => { const c = S.shopCost(p, id); if (!c || p.gold < c) return false; p.gold -= c; p.spent += c; p.shop[id] = S.rank(p, id) + 1; return true; };
  // Gold of every remaining rank at today's prices (the shop total when nothing is owned).
  S.shopLeft = (p) => { let t = 0; for (const s of ED.SHOP) for (let r = S.rank(p, s.id); r < s.max; r++) t += ED.shopPrice(s, r); return t; };
  S.campRanks = (p) => { let n = 0; for (const s of ED.SHOP) n += S.rank(p, s.id); return n; };
  S.refundTotal = (p) => (S.campRanks(p) ? p.spent : 0);
  // Resets every rank and returns all gold spent on them (p.spent). Returns the amount refunded.
  S.refundAll = (p) => { const t = S.refundTotal(p); p.gold += t; p.spent = 0; p.shop = {}; return t; };
  // Camp price of hero cls (its { buy } rule), 0 when unlocked or not for sale; S.buyHero pays it and unlocks.
  S.heroCost = (p, cls) => { const r = ED.UNLOCKS.heroes[cls]; return r && r.buy && !S.heroUnlocked(p, cls) ? r.buy : 0; };
  S.buyHero = (p, cls) => {
    const c = S.heroCost(p, cls); if (!c || p.gold < c) return false;
    const ord = heroOrder(); p.gold -= c; p.heroes.push(cls); p.heroes.sort((x, y) => ord.indexOf(x) - ord.indexOf(y)); return true;
  };
  // What a run needs from the profile (World players[].meta): shop ranks (sigs: always empty, kept for older peers).
  S.metaBundle = (p) => ({ shop: Object.assign({}, p.shop), sigs: [] });
  // Progress of profile p toward hero cls's unlock rule: { done, prog (0..1), cur, need } (one-run records for survive / kills / level; gold for buy, done only once bought).
  S.heroProgress = (p, cls) => {
    const r = ED.UNLOCKS.heroes[cls] || {}, st = p.stats;
    let cur = 0, need = 1;
    if (r.start) cur = 1;
    else if (r.survive) { cur = st.bestTime; need = r.survive; }
    else if (r.beat !== undefined) cur = p.beat.indexOf(r.beat) >= 0 ? 1 : 0;
    else if (r.pure) cur = p.pure.length ? 1 : 0;
    else if (r.buy) { cur = p.gold; need = r.buy; }
    else if (r.kills) { cur = st.bestKills; need = r.kills; }
    else if (r.level) { cur = st.bestLevel; need = r.level; }
    return { done: S.heroUnlocked(p, cls) || (!r.buy && cur >= need), prog: Math.min(1, cur / need), cur: Math.min(cur, need), need };
  };

  // ---------------- cosmetics (Wardrobe) ----------------
  const cosIds = () => ED.COS_IDS || [];
  const cosDef = (id) => (ED.COS_BY && ED.COS_BY[id]) || null;
  const achReward = (achId) => { const a = ED.ACHIEVEMENTS.find(x => x.id === achId); return a && a.reward && cosDef(a.reward) ? a.reward : ''; };
  const sameSlot = (a, b) => a.kind === b.kind && (a.kind !== 'skin' || a.hero === b.hero);
  const cosSort = (list) => { const ord = cosIds(); list.sort((x, y) => ord.indexOf(x) - ord.indexOf(y)); return list; };
  // Wears owned item id in place of whatever was worn in its slot (skins: per hero).
  function setWear(p, id) { const d = cosDef(id); if (!d) return; p.wear = p.wear.filter(w => { const e = cosDef(w); return e && !sameSlot(e, d); }); p.wear.push(id); cosSort(p.wear); }
  S.cosOwned = (p, id) => p.cos.indexOf(id) >= 0;
  // Gold price of item id for profile p: 0 when owned, unknown or an achievement reward.
  S.cosCost = (p, id) => { const d = cosDef(id); return d && d.price > 0 && !S.cosOwned(p, id) ? d.price : 0; };
  S.buyCos = (p, id) => { const c = S.cosCost(p, id); if (!c || p.gold < c) return false; p.gold -= c; p.cos.push(id); cosSort(p.cos); return true; };
  // Wears owned item id (true), or with id '' takes off what slot (kind, cls for skins) holds.
  S.wear = (p, id, kind, cls) => {
    if (id) { if (!S.cosOwned(p, id)) return false; setWear(p, id); return true; }
    p.wear = p.wear.filter(w => { const e = cosDef(w); return e && !(e.kind === kind && (kind !== 'skin' || e.hero === cls)); });
    return true;
  };
  // Worn id of slot kind (skins: of hero cls), '' for the default look.
  S.worn = (p, kind, cls) => { for (const w of p.wear) { const d = cosDef(w); if (d && d.kind === kind && (kind !== 'skin' || d.hero === cls)) return w; } return ''; };
  // Achievement id whose reward is item id ('' when bought with gold).
  S.cosAch = (id) => { const a = ED.ACHIEVEMENTS.find(x => x.reward === id); return a ? a.id : ''; };
  // Gold of every item not yet owned (the Wardrobe total when nothing is owned; rewards excluded).
  S.cosLeft = (p) => { let t = 0; for (const d of ED.COSMETICS || []) t += S.cosCost(p, d.id); return t; };
  // What a run shows of profile p playing hero cls: { skin, tint, kill, lvl, title, ncol } (ids, '' = default).
  S.cosBundle = (p, cls) => { const o = {}; for (const k of ED.COS_KINDS || []) o[k] = S.worn(p, k, cls); return o; };
  // Any peer-sent bundle -> a valid one for hero cls (unknown ids, wrong kinds and another hero's skin become '').
  S.cosClean = (o, cls) => {
    const out = {}; o = o && typeof o === 'object' ? o : {};
    for (const k of ED.COS_KINDS || []) { const d = cosDef(o[k]); out[k] = d && d.kind === k && (k !== 'skin' || d.hero === cls) ? d.id : ''; }
    return out;
  };

  // ---------------- achievements ----------------
  const heroName = (c) => (ED.HEROES && ED.HEROES[c] ? ED.HEROES[c].name : c);
  const COS_NOUN = S.COS_NOUN = { skin: 'skin', tint: 'weapon tint', kill: 'kill effect', lvl: 'level-up effect', title: 'title', ncol: 'name colour' };
  // { name, txt } of achievement a (per-hero rows are named after the hero).
  S.achText = (a) => {
    const r = a.rule;
    if (r.winWith) return { name: heroName(r.winWith) + ' Victor', txt: 'Win a run as ' + heroName(r.winWith) };
    if (r.form) return { name: heroName(r.form) + ' Form', txt: 'Reach a Form as ' + heroName(r.form) };
    return { name: a.name, txt: a.txt };
  };
  // Progress of profile p toward achievement a: { done (earned), met (rule met now), cur, need, k (0..1) }.
  S.achProgress = (p, a) => {
    const r = a.rule, st = p.stats, all = () => heroOrder().filter(c => ED.UNLOCKS.heroes[c]);
    let cur = 0, need = 1;
    if (r.time) { cur = st.bestTime; need = r.time; }
    else if (r.beat !== undefined) cur = p.beat.indexOf(r.beat) >= 0 ? 1 : 0;
    else if (r.winWith) cur = p.won.indexOf(r.winWith) >= 0 ? 1 : 0;
    else if (r.form) cur = p.formed.indexOf(r.form) >= 0 ? 1 : 0;
    else if (r.runKills) { cur = st.bestKills; need = r.runKills; }
    else if (r.kills) { cur = st.kills; need = r.kills; }
    else if (r.level) { cur = st.bestLevel; need = r.level; }
    else if (r.wins) { cur = st.wins; need = r.wins; }
    else if (r.pure) cur = p.pure.length ? 1 : 0;
    else if (r.coop) { cur = st.coopWins; need = r.coop; }
    else if (r.heroes) { cur = all().filter(c => S.heroUnlocked(p, c)).length; need = all().length; }
    else if (r.camp) { cur = S.campRanks(p); need = ED.SHOP.reduce((t, s) => t + s.max, 0); }
    const done = p.ach.indexOf(a.id) >= 0;
    return { done, met: cur >= need, cur: done ? need : Math.min(cur, need), need, k: done ? 1 : Math.min(1, cur / need) };
  };
  // Earns every achievement profile p now meets: marks it, pays its gold (gold and lifetime), grants its cosmetic reward. Returns [{ kind: 'ach', id, name, txt, gold, reward }] in ED.ACH_IDS order.
  S.evalAch = (p) => {
    const out = [];
    for (const a of ED.ACHIEVEMENTS) {
      if (p.ach.indexOf(a.id) >= 0 || !S.achProgress(p, a).met) continue;
      p.ach.push(a.id); p.gold += a.gold; p.lifetime += a.gold;
      const t = S.achText(a), rw = achReward(a.id), rd = cosDef(rw);
      if (rw && !S.cosOwned(p, rw)) { p.cos.push(rw); cosSort(p.cos); }
      const extra = [a.gold ? '+' + a.gold + ' gold' : '', rd ? rd.name + ' ' + COS_NOUN[rd.kind] : ''].filter(Boolean).join(', ');
      out.push({ kind: 'ach', id: a.id, name: t.name, txt: 'Achievement: ' + t.name + (extra ? ' (' + extra + ')' : ''), gold: a.gold, reward: rw });
    }
    if (out.length) p.ach = ED.ACH_IDS.filter(id => p.ach.indexOf(id) >= 0);
    return out;
  };

  // Applies a finished run to profile p: gold, lifetime stats, stage records, played heroes, beaten stages and every unlock now earned.
  // sum = World.summary(); stage = stage index (default sum.stage); pid = this player's hero (its perHero ranks === 0 marks a no-Camp run). Returns { gold (run gold), achGold,
  // unlocked: [cls], stages: [index], weapons: [] (unused), records: ['time'|'kills'|'level'] (stage bests beaten; none on the stage's first run),
  // achs: [S.evalAch entries], news: [{ kind: 'hero'|'stage'|'ach', id, name, txt }] (unlocks first, then achievements) }.
  S.applyRun = (p, sum, stage, pid) => {
    if (stage === undefined || stage === null) stage = sum.stage | 0;
    const me = sum.perHero.find(h => h.pid === pid) || sum.perHero[0] || { cls: '', kills: 0 };
    const out = { gold: num(sum.gold), achGold: 0, unlocked: [], stages: [], weapons: [], records: [], achs: [], news: [] };
    p.gold += out.gold; p.lifetime += out.gold;
    const st = p.stats, time = Math.floor(+sum.time || 0), level = sum.level | 0, kills = me.kills | 0;
    st.runs++; if (sum.won) st.wins++; if (sum.won && sum.perHero.length > 1) st.coopWins++; st.kills += sum.kills | 0;
    st.bestLevel = Math.max(st.bestLevel, level); st.bestKills = Math.max(st.bestKills, kills); st.bestTime = Math.max(st.bestTime, time);
    const sid = ED.STAGE_IDS[stage];
    if (sid) {
      const b = p.best[sid];
      if (b) { if (time > b.time) out.records.push('time'); if ((sum.kills | 0) > b.kills) out.records.push('kills'); if (level > b.level) out.records.push('level'); }
      const o = b || { time: 0, kills: 0, level: 0, won: false };
      p.best[sid] = { time: Math.max(o.time, time), kills: Math.max(o.kills, sum.kills | 0), level: Math.max(o.level, level), won: o.won || !!sum.won };
    }
    const ord = heroOrder(), byOrd = (x, y) => ord.indexOf(x) - ord.indexOf(y), add = (list, v, cmp) => { if (list.indexOf(v) < 0) { list.push(v); list.sort(cmp); } };
    if (me.cls && ED.UNLOCKS.heroes[me.cls]) {
      add(p.played, me.cls, byOrd);
      if (sum.won) add(p.won, me.cls, byOrd);
      if (me.form) add(p.formed, me.cls, byOrd);
    }
    if (sum.won && me.ranks === 0 && ED.STAGES[stage]) add(p.pure, stage, (x, y) => x - y);
    if (sum.won && p.beat.indexOf(stage) < 0) {
      const was = ED.STAGES.map((sd, i) => S.stageUnlocked(p, i));
      p.beat.push(stage); p.beat.sort((x, y) => x - y);
      ED.STAGES.forEach((sd, i) => {
        if (was[i] || !S.stageUnlocked(p, i)) return;
        out.stages.push(i);
        const hid = !!(ED.UNLOCKS.stages[i] || {}).hidden;
        out.news.push({ kind: 'stage', id: ED.STAGE_IDS[i], name: sd.name, txt: hid ? 'Something stirs below: ' + sd.name + ' is open' : 'New stage: ' + sd.name });
      });
    }
    for (const cls of heroOrder()) {
      if (!ED.UNLOCKS.heroes[cls] || S.heroUnlocked(p, cls) || !S.heroProgress(p, cls).done) continue;
      p.heroes.push(cls); out.unlocked.push(cls);
      const name = ED.HEROES && ED.HEROES[cls] ? ED.HEROES[cls].name : cls;
      out.news.push({ kind: 'hero', id: cls, name, txt: 'New hero: ' + name });
    }
    out.achs = S.evalAch(p);
    for (const a of out.achs) { out.achGold += a.gold; out.news.push(a); }
    return out;
  };

  // ---------------- seen (Encyclopedia reveals) ----------------
  S.isSeen = (p, k, id) => !!(p && p.seen && p.seen[k] && p.seen[k].indexOf(id) >= 0);
  // Run record: { heroes, weapons, passives, foes, stages } as Sets of ids, filled on the client by S.seenView and folded in at run end by S.mergeSeen.
  S.seenRun = () => { const r = {}; for (const k of SEEN_KEYS) r[k] = new Set(); return r; };
  // Adds what view v (ED.Game.view) shows inside the world rect (x0, y0, w, h): the stage, the own hero's class, weapons (evolved included) and passives,
  // every foe overlapping the rect and the live boss. No allocation once every id is in.
  S.seenView = (r, v, x0, y0, w, h) => {
    if (!r || !v) return;
    const sid = ED.STAGE_IDS[v.stage]; if (sid) r.stages.add(sid);
    const me = v.me;
    if (me) {
      r.heroes.add(me.cls);
      for (let i = 0; i < me.weapons.length; i++) r.weapons.add(me.weapons[i].id);
      for (let i = 0; i < me.passives.length; i++) r.passives.add(me.passives[i].id);
    }
    const F = v.foes, ids = ED.FOE_IDS, x1 = x0 + w, y1 = y0 + h;
    for (let i = 0; i < F.length; i++) {
      const e = F[i], rr = e.r || 0;
      if (!e.dead && e.x + rr >= x0 && e.x - rr <= x1 && e.y + rr >= y0 && e.y - rr <= y1 && ids[e.k]) r.foes.add(ids[e.k]);
    }
    const b = v.boss; if (b && !b.dead && ids[b.k]) r.foes.add(ids[b.k]);
  };
  // Folds run record r into profile p (ids unknown to this build are dropped, lists stay in seenOrder). Returns the number of new entries.
  S.mergeSeen = (p, r) => {
    if (!p || !r) return 0;
    let n = 0;
    for (const k of SEEN_KEYS) {
      const cur = p.seen[k] || [], add = r[k] || new Set();
      const next = seenOrder(k).filter(id => cur.indexOf(id) >= 0 || add.has(id));
      n += next.length - cur.length; p.seen[k] = next;
    }
    return n;
  };

  // ---------------- save code ----------------
  const crc16 = (bytes) => {
    let c = 0xffff;
    for (let i = 0; i < bytes.length; i++) { c ^= bytes[i] << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
    return c;
  };
  const scramble = (bytes) => { const r = U.RNG(0x5eede3b7); for (let i = 0; i < bytes.length; i++) bytes[i] ^= Math.floor(r.next() * 256); return bytes; };
  const toB32 = (bytes) => {
    let out = '', buf = 0, n = 0;
    for (let i = 0; i < bytes.length; i++) { buf = (buf << 8) | bytes[i]; n += 8; while (n >= 5) { out += B32[(buf >>> (n - 5)) & 31]; n -= 5; } buf &= (1 << n) - 1; }
    if (n > 0) out += B32[(buf << (5 - n)) & 31];
    return out;
  };
  const fromB32 = (str) => {
    const bytes = []; let buf = 0, n = 0;
    for (const ch of str) { const v = B32.indexOf(ch); if (v < 0) throw new Error('char'); buf = (buf << 5) | v; n += 5; if (n >= 8) { bytes.push((buf >>> (n - 8)) & 255); n -= 8; buf &= (1 << n) - 1; } }
    return new Uint8Array(bytes);
  };
  // Byte writer / reader: u8, unsigned LEB128 varint (exact up to 2^53).
  const writer = () => {
    const b = [];
    return { b, u8: (v) => b.push(v & 255), vu: (v) => { v = num(v); while (v >= 128) { b.push((v % 128) | 128); v = Math.floor(v / 128); } b.push(v); } };
  };
  const reader = (b) => {
    let i = 0;
    const u8 = () => { if (i >= b.length) throw new Error('short'); return b[i++]; };
    return { u8, left: () => b.length - i, vu: () => { let v = 0, m = 1, x; do { x = u8(); v += (x & 127) * m; m *= 128; } while (x & 128 && m < 2 ** 56); return v; } };
  };

  // v1 body bytes -> 'WK1-' code string (CRC16 appended, scrambled, base32 in groups of 5).
  const pack = (body) => {
    const crc = crc16(body), all = new Uint8Array(body.length + 2);
    all.set(body); all[body.length] = crc >> 8; all[body.length + 1] = crc & 255;
    return 'WK1-' + toB32(scramble(all)).match(/.{1,5}/g).join('-');
  };
  S._pack = pack; S._writer = writer; // tools/check-save.js builds hand-made v1 codes with these
  // Bit list: n (ids of ord up to the last set one), ceil(n / 8) bytes, bit (i & 7) of byte (i >> 3) = ord[i] is in `has` (a Set).
  const writeBits = (o, ord, has) => {
    let m = ord.length; while (m > 0 && !has.has(ord[m - 1])) m--;
    o.vu(m);
    for (let i = 0; i < m; i += 8) { let v = 0; for (let j = 0; j < 8 && i + j < m; j++) if (has.has(ord[i + j])) v |= 1 << j; o.u8(v); }
  };
  const readBits = (r, ord) => {
    const m = r.vu(), ids = [];
    for (let i = 0; i < m; i += 8) { const v = r.u8(); for (let j = 0; j < 8 && i + j < m; j++) if ((v & (1 << j)) && ord[i + j]) ids.push(ord[i + j]); }
    return ids;
  };
  S._writeBits = writeBits;
  // Layout v1 (decode only): version, name (len + NAME_CHARS indices), gold, lifetime, [n shop ranks], [n heroes: flags bit0 unlocked, bit1 played, bit2 won, bit3 formed],
  // [n stages: flags bit0 beat, bit1 best won, bit2 has best, bit3 pure win; best time, kills, level], [n stats], then sections absent in older codes, in this order:
  // [n seen lists in SEEN_KEYS order: each a bit list], achievements (bit list over ED.ACH_IDS), spent, owned cosmetics, worn cosmetics (bit lists over ED.COS_IDS).
  // Every [list] starts with its count; bytes past what a decoder knows are ignored.
  const decodeV1 = (s) => {
    let all;
    try { all = scramble(fromB32(s)); } catch (e) { throw new Error(E_CHAR); }
    let body = null;
    for (const len of [all.length, all.length - 1]) { if (len < 3) continue; const b = all.slice(0, len - 2); if (crc16(b) === ((all[len - 2] << 8) | all[len - 1])) { body = b; break; } }
    if (!body) throw new Error(E_SUM);
    const r = reader(body), o = { shop: {}, heroes: [], played: [], won: [], formed: [], beat: [], pure: [], best: {}, stats: {}, seen: {} };
    try {
      if (r.u8() > 1) throw new Error('newer');
      let n = r.vu(), name = '';
      for (let i = 0; i < n; i++) name += NAME_CHARS[r.u8()] || '';
      o.name = name; o.gold = r.vu(); o.lifetime = r.vu();
      n = r.vu(); for (let i = 0; i < n; i++) { const v = r.u8(); if (ED.SHOP[i]) o.shop[ED.SHOP[i].id] = v; }
      const heroes = heroOrder();
      n = r.vu(); for (let i = 0; i < n; i++) { const f = r.u8(), c = heroes[i]; if (!c) continue; if (f & 1) o.heroes.push(c); if (f & 2) o.played.push(c); if (f & 4) o.won.push(c); if (f & 8) o.formed.push(c); }
      n = r.vu();
      for (let i = 0; i < n; i++) {
        const f = r.u8(), b = { time: r.vu(), kills: r.vu(), level: r.vu(), won: !!(f & 2) }, id = ED.STAGE_IDS[i];
        if (!id) continue;
        if (f & 1) o.beat.push(i);
        if (f & 4) o.best[id] = b;
        if (f & 8) o.pure.push(i);
      }
      n = r.vu(); for (let i = 0; i < n; i++) { const v = r.vu(); if (STAT_KEYS[i]) o.stats[STAT_KEYS[i]] = v; }
      n = r.left() ? r.vu() : 0;
      for (let li = 0; li < n; li++) { const k = SEEN_KEYS[li], ids = readBits(r, k ? codeOrder(k) : []); if (k) o.seen[k] = ids; }
      if (r.left()) o.ach = readBits(r, ED.ACH_IDS);
      if (r.left()) o.spent = r.vu();
      if (r.left()) o.cos = readBits(r, cosIds());
      if (r.left()) o.wear = readBits(r, cosIds());
    } catch (e) {
      if (e.message === 'newer') throw new Error(E_NEW);
      throw new Error(E_DMG);
    }
    return S.normalize(o);
  };

  // ---------------- save code v2 (WK2): bit-packed ----------------
  // Frozen WK2 tables (never edited; changing one needs a new prefix): SEEN_DEAD, V2N (count bases), shop rank widths (bit length of SHOP_FULL[i] for the first V2N.shop rows,
  // 4 bits after), SHOP_FULL (the ranks of the 'all bought' shop form), SHOP_COST / COS_PRICE / HERO_BUY (the prices spent and lifetime are checked against; live prices may differ).
  const SHOP_FULL = [5, 5, 3, 5, 3, 3, 5, 5, 5, 1, 5, 3, 3, 5, 5, 5, 5, 1, 5];
  const SHOP_COST = [65, 35, 120, 40, 80, 40, 55, 45, 45, 550, 35, 35, 65, 65, 55, 40, 35, 4500, 55];
  const COS_PRICE = [500, 1200, 0, 500, 1200, 0, 500, 1200, 0, 500, 1200, 0, 500, 1200, 0, 500, 1200, 0, 500, 1200, 0, 800, 800, 800, 1500, 2500, 0, 600, 900, 1400, 2000, 0,
    600, 1000, 1500, 0, 200, 400, 800, 1200, 0, 0, 0, 0, 0, 0, 200, 200, 300, 300, 400, 400, 600, 0];
  const HERO_BUY = [0, 0, 0, 0, 0, 4000, 0];
  const V2N = { sections: 15, shop: 19, heroes: 7, stages: 4, stats: 7, seen: 5, seenL: [7, 58, 12, 51, 4], ach: 30, cos: 54 };
  // Number forms [lo, wl] (wNum): gold, spent, runs, wins, lifetime kills, stage best time (s) / kills / level, co-op wins, stats past STAT_KEYS' first 7.
  const NP = { gold: [7, 5], spent: [7, 4], runs: [4, 4], wins: [3, 4], kills: [12, 4], time: [10, 2], bkills: [12, 3], level: [6, 2], coop: [3, 4], any: [8, 5] };
  const STAT_NP = [NP.runs, NP.wins, NP.kills, NP.level, NP.bkills, NP.time, NP.coop];
  const STAT_TOP = [null, null, null, 'level', 'kills', 'time', null]; // stat equal to the max of that stage-best field: one 0 bit
  const EG_TIME = 4, EG_LEVEL = 2; // exp-Golomb orders of a stage best's time / level below the stage maximum
  const SEED2 = 0x2b1d5eed, GROUP = 5;
  const E_CHAR = 'That code contains characters a save code never uses.', E_SUM = 'That code fails its checksum. A character is probably mistyped or missing.';
  const E_DMG = 'That code is damaged.', E_NEW = 'That code was made by a newer Wickdeep. Reload the page.';
  const bl = (v) => { let n = 0; while (v >= 1) { v = Math.floor(v / 2); n++; } return n; }; // bit length (0 for v < 1)
  const shopW = (i) => (i < V2N.shop ? bl(SHOP_FULL[i]) : 4);
  // CRC-15/CAN (poly 0x4599, init 0) over bits b[0..end).
  const crc15 = (b, end) => { let c = 0; for (let i = 0; i < end; i++) { const f = ((c >> 14) & 1) ^ b[i]; c = (c << 1) & 0x7fff; if (f) c ^= 0x4599; } return c; };
  // Bit writer / reader, MSB first: u(v, n) n-bit unsigned (exact up to 2^53), gam(v >= 1) Elias gamma.
  const bitW = () => {
    const b = [], u = (v, n) => { for (let i = n - 1; i >= 0; i--) b.push(Math.floor(v / 2 ** i) % 2); };
    return { b, u, bit: (v) => b.push(v ? 1 : 0), gam: (v) => { const n = bl(v); for (let i = 1; i < n; i++) b.push(0); u(v, n); } };
  };
  const bitR = (b, end) => {
    let i = 0;
    const bit = () => { if (i >= end) throw new Error('short'); return b[i++]; };
    const u = (n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 2 + bit(); return v; };
    return { bit, u, gam: () => { let z = 0; while (!bit()) if (++z > 40) throw new Error('bad'); return 2 ** z + u(z); } };
  };
  const gamCost = (v) => 2 * bl(v) - 1;
  // Number v >= 0: wl-bit slot s; s = 0: 0; s = 1: lo bits; 1 < s < 2^wl - 1: bit length lo + s - 1; s = 2^wl - 1: 6-bit bit length. A bit length L is followed by v's L - 1 bits
  // under its leading 1.
  const wNum = (o, v, P) => {
    v = num(v); const lo = P[0], wl = P[1], esc = 2 ** wl - 1, L = bl(v);
    if (!L) o.u(0, wl);
    else if (L <= lo) { o.u(1, wl); o.u(v, lo); }
    else { const s = L - lo + 1; if (s < esc) o.u(s, wl); else { o.u(esc, wl); o.u(L, 6); } o.u(v - 2 ** (L - 1), L - 1); }
  };
  const rNum = (r, P) => {
    const lo = P[0], wl = P[1], esc = 2 ** wl - 1, s = r.u(wl);
    if (!s) return 0;
    if (s === 1) return r.u(lo);
    const L = s < esc ? lo + s - 1 : r.u(6);
    if (L < 1 || L > 41) throw new Error('bad');
    return 2 ** (L - 1) + r.u(L - 1);
  };
  // Count m against base N: '0' m = 0, '10' m = N, '11' + bl(N - 1) bits: m (1..N-1), or 0 then gamma(m - N) for m > N.
  const wCnt = (o, m, N) => {
    if (!m) { o.bit(0); return; }
    o.bit(1); if (m === N) { o.bit(0); return; }
    o.bit(1); const w = bl(N - 1);
    if (m < N) o.u(m, w); else { o.u(0, w); o.gam(m - N); }
  };
  const rCnt = (r, N) => {
    if (!r.bit()) return 0;
    if (!r.bit()) return N;
    const v = r.u(bl(N - 1)); if (v && v >= N) throw new Error('bad');
    const m = v || N + r.gam(); if (m > 4096) throw new Error('bad');
    return m;
  };
  const cntCost = (m, N) => (!m ? 1 : m === N ? 2 : m < N ? 2 + bl(N - 1) : 2 + bl(N - 1) + gamCost(m - N));
  // Set over positions of st (1 in, 0 out, -1 free: normalize re-derives it): count m (last 'in' position + 1, or N when that is cheaper; position m - 1 is in), then a 2-bit form:
  // 0 every position < m; 1 bitmap of positions < m - 1; 2 gamma(n + 1) + n listed 'in' positions < m - 1 in bl(m - 2) bits each; 3 the same listing the 'out' positions.
  // The cheapest form is written. Both return the 'in' positions as the decoder reads them (free positions resolved).
  const wSet = (o, st, N) => {
    let m0 = 0; for (let i = st.length - 1; i >= 0; i--) if (st[i] === 1) { m0 = i + 1; break; }
    const cands = [m0]; if (N > m0 && st[N - 1] === -1) cands.push(N);
    let best = null;
    for (const m of cands) {
      if (!m) { best = { m: 0 }; break; }
      const iw = bl(m - 2); let nin = 0, nout = 0;
      for (let i = 0; i < m - 1; i++) { if (st[i] === 1) nin++; else if (st[i] === 0) nout++; }
      const cost = [nout ? Infinity : 0, m - 1, gamCost(nin + 1) + nin * iw, gamCost(nout + 1) + nout * iw];
      for (let k = 0; k < 4; k++) { const c = cntCost(m, N) + 2 + cost[k]; if (!best || c < best.c) best = { m, k, c }; }
    }
    wCnt(o, best.m, N);
    if (!best.m) return [];
    const m = best.m, k = best.k, iw = bl(m - 2), out = [];
    o.u(k, 2);
    if (k === 1) for (let i = 0; i < m - 1; i++) o.bit(st[i] === 1);
    else if (k >= 2) {
      const want = k === 2 ? 1 : 0, list = [];
      for (let i = 0; i < m - 1; i++) if (st[i] === want) list.push(i);
      o.gam(list.length + 1); for (const i of list) o.u(i, iw);
    }
    for (let i = 0; i < m - 1; i++) if (k === 0 || (k === 3 ? st[i] !== 0 : st[i] === 1)) out.push(i);
    out.push(m - 1);
    return out;
  };
  // Exp-Golomb order k: gamma(floor(v / 2^k) + 1), then the k low bits.
  const wEG = (o, v, k) => { const d = 2 ** k; o.gam(Math.floor(v / d) + 1); o.u(v % d, k); };
  const rEG = (r, k) => (r.gam() - 1) * 2 ** k + r.u(k);
  const rSet = (r, N) => {
    const m = rCnt(r, N); if (!m) return [];
    const k = r.u(2), iw = bl(m - 2), inn = new Array(m).fill(k === 0 || k === 3 ? 1 : 0);
    inn[m - 1] = 1;
    if (k === 1) for (let i = 0; i < m - 1; i++) inn[i] = r.bit();
    else if (k >= 2) {
      const n = r.gam() - 1; if (n >= m) throw new Error('bad');
      for (let j = 0; j < n; j++) { const i = r.u(iw); if (i >= m - 1) throw new Error('bad'); inn[i] = k === 2 ? 1 : 0; }
    }
    const out = []; for (let i = 0; i < m; i++) if (inn[i]) out.push(i);
    return out;
  };
  // Body bits -> code string: zero pad to 5n - 15 bits, CRC-15, each 5-bit symbol XOR a seeded keystream, base32 in groups of GROUP.
  const pack2 = (bits) => {
    const b = bits.slice(); while ((b.length + 15) % 5) b.push(0);
    const c = crc15(b, b.length); for (let k = 14; k >= 0; k--) b.push((c >> k) & 1);
    const r = U.RNG(SEED2); let s = '';
    for (let i = 0; i < b.length; i += 5) { let v = 0; for (let k = 0; k < 5; k++) v = v * 2 + b[i + k]; s += B32[v ^ Math.floor(r.next() * 32)]; }
    return PREFIX + '-' + s.match(new RegExp('.{1,' + GROUP + '}', 'g')).join('-');
  };
  // tools/check-save.js builds hand-made v2 codes and checks the frozen tables with these
  S._v2 = { bitW, wNum, wCnt, wSet, wEG, pack2, shopW, NP, V2N, SHOP_FULL, SHOP_COST, COS_PRICE, HERO_BUY, SEEN_DEAD, LIVE_WEAPONS };
  // Gold paid for what the written fields hold, at the frozen WK2 prices (positions past the tables count 0): shop ranks (cost x rank^2 per rank), owned cosmetics, unlocked heroes.
  const paidShop = (rk) => { let t = 0; for (let i = 0; i < SHOP_COST.length && i < rk.length; i++) { const r = rk[i]; t += SHOP_COST[i] * r * (r + 1) * (2 * r + 1) / 6; } return t; };
  const paidAt = (pos, table) => pos.reduce((t, i) => t + (table[i] || 0), 0);
  // Layout v2: section count (base V2N.sections), then sections in this order (a decoder reads the first min(count, known) and ignores the rest):
  //  0 name: 4-bit length (0 = 'Wanderer'), 1 bit wide, then per char a 6-bit (NAME_CHARS) or, wide, a 12-bit name alphabet index; 1 gold;
  //  2 shop: '0' none, '10' + count: SHOP_FULL ranks, '11' + count + ranks (shopW bits); 3-6 sets over ED.HERO_IDS: unlocked (start heroes free), played, won, formed;
  //  7 stages: count, per stage a flag symbol ('00' none, '01' best, '10' best won + beat, '11' + 4 bits: beat, pure, best, won), then with 2+ bests the max time and level;
  //    per best: time (2+ bests: exp-Golomb below the max), kills, level (the same); 8 stats: count, values in STAT_KEYS order (STAT_TOP ones: bit 0 = the stage-best max);
  //  9 seen: count, sets in SEEN_KEYS order over codeOrder2 (base V2N.seenL, 1 past it; played heroes, their signature weapons and played stages free);
  //  10 achievements over ED.ACH_IDS; 11 owned cosmetics over ED.COS_IDS (price-0 rewards free, worn ones in); 12 worn cosmetics: a set over the owned positions as written;
  //  13 spent: bit 0 = paidShop of the written ranks, else 1 + number; 14 lifetime: bit 0 = gold + spent + written cosmetics and heroes at frozen prices, else 1 + lifetime - gold.
  //  Counts, sets and numbers: wCnt, wSet, wNum. Trailing all-zero lists are cut by their count.
  S.encode = (p) => {
    const q = S.normalize(p), o = bitW(), heroes = heroOrder(), NM = nameIdx(), inL = (l, v) => l.indexOf(v) >= 0;
    wCnt(o, V2N.sections, V2N.sections);
    const nm = q.name === 'Wanderer' ? [] : Array.from(q.name, ch => NM.get(ch));
    o.u(nm.length, 4);
    if (nm.length) { const wide = nm.some(i => i >= 64); o.bit(wide); for (const i of nm) o.u(i, wide ? 12 : 6); }
    wNum(o, q.gold, NP.gold);
    const rk = ED.SHOP.map((s, i) => Math.min(S.rank(q, s.id), 2 ** shopW(i) - 1));
    let n = rk.length; while (n && !rk[n - 1]) n--;
    if (!n) o.bit(0);
    else if (rk.length === SHOP_FULL.length && rk.every((r, i) => r === SHOP_FULL[i])) { o.u(2, 2); wCnt(o, rk.length, V2N.shop); }
    else { o.u(3, 2); wCnt(o, n, V2N.shop); for (let i = 0; i < n; i++) o.u(rk[i], shopW(i)); }
    const start = startHeroes();
    const unl = wSet(o, heroes.map(c => (inL(q.heroes, c) ? (inL(start, c) ? -1 : 1) : 0)), V2N.heroes);
    for (const l of [q.played, q.won, q.formed]) wSet(o, heroes.map(c => (inL(l, c) ? 1 : 0)), V2N.heroes);
    const sf = ED.STAGE_IDS.map((id, i) => { const b = q.best[id]; return (inL(q.beat, i) ? 1 : 0) | (inL(q.pure, i) ? 2 : 0) | (b ? 4 : 0) | (b && b.won ? 8 : 0); });
    n = sf.length; while (n && !sf[n - 1]) n--;
    wCnt(o, n, V2N.stages);
    for (let i = 0; i < n; i++) { const f = sf[i]; if (f === 0) o.u(0, 2); else if (f === 4) o.u(1, 2); else if (f === 13) o.u(2, 2); else { o.u(3, 2); o.u(f, 4); } }
    const bs = ED.STAGE_IDS.slice(0, n).map(id => q.best[id]).filter(Boolean), top = { time: 0, kills: 0, level: 0 };
    for (const b of bs) for (const k in top) top[k] = Math.max(top[k], b[k]);
    if (bs.length > 1) { wNum(o, top.time, NP.time); wNum(o, top.level, NP.level); }
    for (const b of bs) {
      if (bs.length > 1) wEG(o, top.time - b.time, EG_TIME); else wNum(o, b.time, NP.time);
      wNum(o, b.kills, NP.bkills);
      if (bs.length > 1) wEG(o, top.level - b.level, EG_LEVEL); else wNum(o, b.level, NP.level);
    }
    const sv = STAT_KEYS.map(k => q.stats[k]);
    n = sv.length; while (n && !sv[n - 1]) n--;
    wCnt(o, n, V2N.stats);
    for (let i = 0; i < n; i++) { const t = STAT_TOP[i]; if (t) { o.bit(sv[i] !== top[t]); if (sv[i] === top[t]) continue; } wNum(o, sv[i], STAT_NP[i] || NP.any); }
    const free = { heroes: new Set(q.played), weapons: new Set(q.played.map(c => ED.HEROES && ED.HEROES[c] && ED.HEROES[c].sig).filter(Boolean)),
      stages: new Set(Object.keys(q.best).concat(q.beat.map(i => ED.STAGE_IDS[i]))) };
    const ss = SEEN_KEYS.map(k => { const has = new Set(q.seen[k]), f = free[k]; return codeOrder2(k).map(id => (has.has(id) ? (f && f.has(id) ? -1 : 1) : 0)); });
    n = ss.length; while (n && ss[n - 1].indexOf(1) < 0) n--;
    wCnt(o, n, V2N.seen);
    for (let k = 0; k < n; k++) wSet(o, ss[k], V2N.seenL[k] || 1);
    wSet(o, ED.ACH_IDS.map(id => (inL(q.ach, id) ? 1 : 0)), V2N.ach);
    const CI = cosIds(), own = wSet(o, CI.map(id => { const d = cosDef(id); return inL(q.wear, id) ? 1 : d && !d.price ? -1 : inL(q.cos, id) ? 1 : 0; }), V2N.cos);
    wSet(o, own.map(i => (inL(q.wear, CI[i]) ? 1 : 0)), own.length);
    const ps = paidShop(rk);
    o.bit(q.spent !== ps); if (q.spent !== ps) wNum(o, q.spent, NP.spent);
    const pl = q.gold + q.spent + paidAt(own, COS_PRICE) + paidAt(unl, HERO_BUY);
    o.bit(q.lifetime !== pl); if (q.lifetime !== pl) wNum(o, q.lifetime - q.gold, NP.gold);
    return pack2(o.b);
  };
  const decodeV2 = (s) => {
    const r0 = U.RNG(SEED2), b = [];
    for (const ch of s) { const v = B32.indexOf(ch); if (v < 0) throw new Error(E_CHAR); const x = v ^ Math.floor(r0.next() * 32); for (let k = 4; k >= 0; k--) b.push((x >> k) & 1); }
    const end = b.length - 15;
    let c = 0; for (let i = Math.max(0, end); i < b.length; i++) c = c * 2 + b[i];
    if (end < 5 || crc15(b, end) !== c) throw new Error(E_SUM);
    const r = bitR(b, end), o = { shop: {}, heroes: [], played: [], won: [], formed: [], beat: [], pure: [], best: {}, stats: {}, seen: {} };
    try {
      const n = rCnt(r, V2N.sections), has = (k) => k < n, heroes = heroOrder(), ids = (ord, idx) => idx.map(i => ord[i]).filter(Boolean);
      if (has(0)) {
        const len = r.u(4);
        if (len) { const wide = r.bit(); nameIdx(); let nm = ''; for (let i = 0; i < len; i++) { const x = r.u(wide ? 12 : 6); nm += x < 64 ? NAME_CHARS[x] : HANGUL[x - 64] || ''; } o.name = nm; }
      }
      o.gold = has(1) ? rNum(r, NP.gold) : 0;
      const rk = [];
      if (has(2) && r.bit()) {
        const full = !r.bit(), m = rCnt(r, V2N.shop);
        for (let i = 0; i < m; i++) { const v = full ? SHOP_FULL[i] || 0 : r.u(shopW(i)); rk.push(v); if (ED.SHOP[i]) o.shop[ED.SHOP[i].id] = v; }
      }
      const unl = has(3) ? rSet(r, V2N.heroes) : [];
      o.heroes = ids(heroes, unl);
      if (has(4)) o.played = ids(heroes, rSet(r, V2N.heroes));
      if (has(5)) o.won = ids(heroes, rSet(r, V2N.heroes));
      if (has(6)) o.formed = ids(heroes, rSet(r, V2N.heroes));
      const top = { time: 0, kills: 0, level: 0 };
      if (has(7)) {
        const m = rCnt(r, V2N.stages), fl = [];
        for (let i = 0; i < m; i++) { const sym = r.u(2); fl.push(sym === 0 ? 0 : sym === 1 ? 4 : sym === 2 ? 13 : r.u(4)); }
        const nb = fl.filter(f => f & 4).length;
        if (nb > 1) { top.time = rNum(r, NP.time); top.level = rNum(r, NP.level); }
        fl.forEach((f, i) => {
          let bst = null;
          if (f & 4) {
            bst = { time: nb > 1 ? top.time - rEG(r, EG_TIME) : rNum(r, NP.time), kills: rNum(r, NP.bkills), level: 0, won: !!(f & 8) };
            bst.level = nb > 1 ? top.level - rEG(r, EG_LEVEL) : rNum(r, NP.level);
            if (bst.time < 0 || bst.level < 0) throw new Error('bad');
            if (nb < 2) { top.time = bst.time; top.level = bst.level; }
            top.kills = Math.max(top.kills, bst.kills);
          }
          const id = ED.STAGE_IDS[i];
          if (!id) return;
          if (f & 1) o.beat.push(i);
          if (f & 2) o.pure.push(i);
          if (bst) o.best[id] = bst;
        });
      }
      if (has(8)) {
        const m = rCnt(r, V2N.stats);
        for (let i = 0; i < m; i++) { const t = STAT_TOP[i], v = t && !r.bit() ? top[t] : rNum(r, STAT_NP[i] || NP.any); if (STAT_KEYS[i]) o.stats[STAT_KEYS[i]] = v; }
      }
      if (has(9)) {
        const m = rCnt(r, V2N.seen);
        for (let k = 0; k < m; k++) { const idx = rSet(r, V2N.seenL[k] || 1), key = SEEN_KEYS[k]; if (key) o.seen[key] = ids(codeOrder2(key), idx); }
      }
      if (has(10)) o.ach = ids(ED.ACH_IDS, rSet(r, V2N.ach));
      const own = has(11) ? rSet(r, V2N.cos) : [];
      o.cos = ids(cosIds(), own);
      if (has(12)) o.wear = ids(cosIds(), rSet(r, own.length).filter(j => j < own.length).map(j => own[j]));
      o.spent = has(13) && r.bit() ? rNum(r, NP.spent) : paidShop(rk);
      o.lifetime = has(14) && r.bit() ? o.gold + rNum(r, NP.gold) : o.gold + o.spent + paidAt(own, COS_PRICE) + paidAt(unl, HERO_BUY);
    } catch (e) { throw new Error(E_DMG); }
    return S.normalize(o);
  };
  // Returns a normalized profile or throws an Error with a readable message (English source; the UI translates it). Prefix WK1 (also WKI / WKL) or WK2; dashes and spaces
  // ignored, lowercase accepted, I / L read as 1, O as 0. Entries beyond the lists this build knows are read and dropped.
  S.decode = (code) => {
    let s = String(code || '').toUpperCase().replace(/\s+/g, '');
    const mt = /^WK([0-9IL])/.exec(s), v = mt ? (/[IL]/.test(mt[1]) ? 1 : +mt[1]) : 0;
    if (v > CODE_VERSION) throw new Error(E_NEW);
    if (v < 1) throw new Error('Wickdeep save codes begin with ' + PREFIX + '-.');
    s = s.slice(3).replace(/-/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    return v === 1 ? decodeV1(s) : decodeV2(s);
  };

  // ---------------- ED.Meta: profile-bound API for the UI ----------------
  // Binds one profile (ED.Meta.use(p); lazily the stored one or a fresh default). Mutating calls persist through ED.Save.store.
  const M = ED.Meta = { p: null, last: null };
  M.use = (p) => (M.p = p);
  M.get = () => M.p || (M.p = S.load() || S.defaultProfile());
  M.save = () => S.store(M.get());
  M.gold = () => M.get().gold;
  // Shop rows in save order: { id, name, icon, txt, rank, max, cost (next rank, 0 when maxed), maxed, afford, val (current total bonus in stat units) }.
  M.shop = () => {
    const p = M.get();
    return ED.SHOP.map(s => { const rank = S.rank(p, s.id), cost = S.shopCost(p, s.id); return { id: s.id, name: s.name, icon: s.icon || '', txt: s.txt, rank, max: s.max, cost, maxed: rank >= s.max, afford: cost > 0 && p.gold >= cost, val: s.per * rank }; });
  };
  M.buy = (id) => { const ok = S.buy(M.get(), id); if (ok) M.save(); return ok; };
  M.buyHero = (cls) => { const ok = S.buyHero(M.get(), cls); if (ok) M.save(); return ok; };
  // Earns achievements the bound profile now meets (S.evalAch) and saves when any. Returns the new ones.
  M.evalAch = () => { const n = S.evalAch(M.get()); if (n.length) M.save(); return n; };
  M.refundTotal = () => S.refundTotal(M.get());
  M.refund = () => { const t = S.refundAll(M.get()); M.save(); return t; };
  M.unlocked = (cls) => S.heroUnlocked(M.get(), cls);
  M.stageUnlocked = (i) => S.stageUnlocked(M.get(), i);
  M.stageHidden = (i) => S.stageHidden(M.get(), i);
  // Hero rows in save order: { id, unlocked, played (a finished run), txt (lock rule, '' for start heroes), prog (0..1), cur, need }.
  M.heroes = () => {
    const p = M.get();
    return heroOrder().filter(c => ED.UNLOCKS.heroes[c]).map(c => { const g = S.heroProgress(p, c), r = ED.UNLOCKS.heroes[c]; return { id: c, unlocked: S.heroUnlocked(p, c), played: p.played.indexOf(c) >= 0, txt: r.txt || '', prog: g.prog, cur: g.cur, need: g.need }; });
  };
  // Stage rows: { i, id, name, unlocked, hidden (S.stageHidden), txt (lock rule), beat, best ({ time, kills, level, won } or null) }.
  M.stages = () => {
    const p = M.get();
    return ED.STAGES.map((sd, i) => { const r = ED.UNLOCKS.stages[i] || {}; return { i, id: ED.STAGE_IDS[i], name: sd.name, unlocked: S.stageUnlocked(p, i), hidden: S.stageHidden(p, i), txt: r.txt || '', beat: p.beat.indexOf(i) >= 0, best: p.best[ED.STAGE_IDS[i]] || null }; });
  };
  M.bundle = () => S.metaBundle(M.get());
  // Encyclopedia reveal of id in seen list k ('heroes'|'weapons'|'passives'|'foes'|'stages') for the bound profile.
  M.seen = (k, id) => S.isSeen(M.get(), k, id);
  // Records a finished run (World.summary(); pid = this player's hero) and saves. Returns the new unlocks [{ kind: 'hero'|'stage', id, name, txt }]; the full result is in ED.Meta.last.
  M.recordRun = (sum, pid) => { M.last = S.applyRun(M.get(), sum, sum.stage, pid); M.save(); return M.last.news; };
  M.code = () => S.encode(M.get());
  // Replaces the bound profile with a decoded save code and saves it. Throws an Error with a readable message on a bad code.
  M.restore = (code) => { M.p = S.decode(code); M.save(); return M.p; };
})(globalThis.ED || (globalThis.ED = {}));
