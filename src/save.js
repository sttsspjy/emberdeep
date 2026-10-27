// Profile persistence (localStorage autosave + portable checksummed save code, format version 1), meta rules (shop, unlocks, records) and the ED.Meta API for the UI.
// Profile: { v, name, gold, lifetime, shop: { shopId: rank }, heroes: [unlocked cls], played: [cls with a finished run], beat: [stage indices beaten],
//   best: { stageId: { time, kills, level, won } }, stats: { runs, wins, kills (lifetime), bestLevel, bestKills (one run, own hero), bestTime (one run, s) } }. Settings live under their own key.
// Save code: 'WK1-' + base32(scramble(positional bytes + CRC16)) in groups of 5. Positional lists (SHOP order, hero order ED.HERO_IDS, stage order, STAT_KEYS) carry a count prefix:
// append only; a reorder or removal bumps CODE_VERSION. Unlock rules: ED.UNLOCKS (src/data/meta.js).
(function (ED) {
  'use strict';
  const U = ED.U;
  // ?slot=2 keeps a second profile in the same browser (two local tabs playing together).
  const SLOT = (() => { try { const v = new URLSearchParams(location.search).get('slot'); return v ? '.' + v.replace(/[^a-z0-9]/gi, '').slice(0, 8) : ''; } catch (e) { return ''; } })();
  const LS_KEY = 'wickdeep.survivors.v1' + SLOT, LS_SETTINGS = 'wickdeep.survivors.settings.v1';
  const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', PREFIX = 'WK1', CODE_VERSION = 1;
  const STAT_KEYS = ['runs', 'wins', 'kills', 'bestLevel', 'bestKills', 'bestTime']; // save code order: append only
  const S = ED.Save = { KEY: LS_KEY, CODE_VERSION, STAT_KEYS };
  const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);
  const heroOrder = () => ED.HERO_IDS || Object.keys(ED.UNLOCKS.heroes);

  S.defaultProfile = () => {
    const stats = {}; for (const k of STAT_KEYS) stats[k] = 0;
    return { v: 1, name: 'Wanderer', gold: 0, lifetime: 0, shop: {}, heroes: startHeroes(), played: [], beat: [], best: {}, stats };
  };
  const startHeroes = () => Object.keys(ED.UNLOCKS.heroes).filter(c => ED.UNLOCKS.heroes[c].start);
  S.sanitizeName = (n) => { n = String(n || '').split('').filter(ch => NAME_CHARS.indexOf(ch) >= 0).join('').trim().slice(0, 12); return n || 'Wanderer'; };
  const num = (v) => { v = Math.floor(+v || 0); return v > 0 && isFinite(v) ? Math.min(v, 1e12) : 0; };

  // Any parsed object -> a valid profile (unknown fields dropped, numbers clamped, start heroes always unlocked, hero / stage lists in save order).
  S.normalize = (o) => {
    const p = S.defaultProfile(); o = o && typeof o === 'object' ? o : {};
    p.name = S.sanitizeName(o.name);
    p.gold = num(o.gold); p.lifetime = Math.max(p.gold, num(o.lifetime));
    for (const s of ED.SHOP) { const r = o.shop ? num(o.shop[s.id]) : 0; if (r > 0) p.shop[s.id] = U.clamp(r, 0, s.max); }
    const heroOk = (c) => ED.UNLOCKS.heroes[c] !== undefined;
    if (Array.isArray(o.heroes)) for (const c of o.heroes) if (heroOk(c) && p.heroes.indexOf(c) < 0) p.heroes.push(c);
    if (Array.isArray(o.played)) p.played = o.played.filter((c, i, a) => heroOk(c) && a.indexOf(c) === i);
    if (Array.isArray(o.beat)) p.beat = o.beat.map(v => v | 0).filter((v, i, a) => v >= 0 && v < ED.STAGES.length && a.indexOf(v) === i);
    if (o.best && typeof o.best === 'object') for (const id of ED.STAGE_IDS) { const b = o.best[id]; if (b && typeof b === 'object') p.best[id] = { time: num(b.time), kills: num(b.kills), level: num(b.level), won: !!b.won }; }
    if (o.stats && typeof o.stats === 'object') for (const k of STAT_KEYS) p.stats[k] = num(o.stats[k]);
    const ord = heroOrder(), byOrd = (x, y) => ord.indexOf(x) - ord.indexOf(y);
    p.heroes.sort(byOrd); p.played.sort(byOrd); p.beat.sort((x, y) => x - y);
    return p;
  };

  // ---------------- storage ----------------
  S.load = () => { const L = ls(); if (!L) return null; try { const raw = L.getItem(LS_KEY); return raw ? S.normalize(JSON.parse(raw)) : null; } catch (e) { return null; } };
  S.store = (p) => { const L = ls(); if (!L) return false; try { L.setItem(LS_KEY, JSON.stringify(p)); return true; } catch (e) { return false; } };
  S.erase = () => { const L = ls(); if (L) try { L.removeItem(LS_KEY); } catch (e) { /* storage blocked */ } };
  S.defaultSettings = () => ({ master: 70, music: 55, sfx: 80, quality: 'high', shake: true, numbers: true, binds: null });
  S.loadSettings = () => { const d = S.defaultSettings(), L = ls(); if (!L) return d; try { return Object.assign(d, JSON.parse(L.getItem(LS_SETTINGS) || '{}')); } catch (e) { return d; } };
  S.storeSettings = (s) => { const L = ls(); if (L) try { L.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) { /* storage blocked */ } };

  // ---------------- unlocks and shop ----------------
  S.heroUnlocked = (p, cls) => p.heroes.indexOf(cls) >= 0;
  S.stageUnlocked = (p, i) => { const r = ED.UNLOCKS.stages[i]; return !!r && (r.start || p.beat.indexOf(r.beat) >= 0); };
  S.rank = (p, id) => p.shop[id] | 0;
  // Cost of the next rank (SHOP_BASE x (rank + 1)), 0 when maxed or unknown.
  S.shopCost = (p, id) => { const s = ED.SHOP.find(x => x.id === id); return s && S.rank(p, id) < s.max ? ED.SHOP_BASE * (S.rank(p, id) + 1) : 0; };
  S.buy = (p, id) => { const c = S.shopCost(p, id); if (!c || p.gold < c) return false; p.gold -= c; p.shop[id] = S.rank(p, id) + 1; return true; };
  S.refundTotal = (p) => { let t = 0; for (const s of ED.SHOP) for (let r = 0; r < S.rank(p, s.id); r++) t += ED.SHOP_BASE * (r + 1); return t; };
  // Resets every rank and returns all gold spent on them. Returns the amount refunded.
  S.refundAll = (p) => { const t = S.refundTotal(p); p.gold += t; p.shop = {}; return t; };
  // What a run needs from the profile (World players[].meta): shop ranks and the heroes whose signature weapon joined the general pool.
  S.metaBundle = (p) => ({ shop: Object.assign({}, p.shop), sigs: ED.UNLOCKS.sigAfterRun ? p.played.slice() : [] });
  // Progress of profile p toward hero cls's unlock rule: { done, prog (0..1), cur, need } (one-run records for survive / kills / level).
  S.heroProgress = (p, cls) => {
    const r = ED.UNLOCKS.heroes[cls] || {}, st = p.stats;
    let cur = 0, need = 1;
    if (r.start) cur = 1;
    else if (r.survive) { cur = st.bestTime; need = r.survive; }
    else if (r.beat !== undefined) cur = p.beat.indexOf(r.beat) >= 0 ? 1 : 0;
    else if (r.kills) { cur = st.bestKills; need = r.kills; }
    else if (r.level) { cur = st.bestLevel; need = r.level; }
    return { done: S.heroUnlocked(p, cls) || cur >= need, prog: Math.min(1, cur / need), cur: Math.min(cur, need), need };
  };

  // Applies a finished run to profile p: gold, lifetime stats, stage records, played heroes, beaten stages and every unlock now earned.
  // sum = World.summary(); stage = stage index (default sum.stage); pid = this player's hero. Returns { gold, unlocked: [cls], stages: [index], weapons: [signature wid],
  // records: ['time'|'kills'|'level'] (stage bests beaten; none on the stage's first run), news: [{ kind: 'hero'|'stage'|'weapon', id, name, txt }] }.
  S.applyRun = (p, sum, stage, pid) => {
    if (stage === undefined || stage === null) stage = sum.stage | 0;
    const me = sum.perHero.find(h => h.pid === pid) || sum.perHero[0] || { cls: '', kills: 0 };
    const out = { gold: num(sum.gold), unlocked: [], stages: [], weapons: [], records: [], news: [] };
    p.gold += out.gold; p.lifetime += out.gold;
    const st = p.stats, time = Math.floor(+sum.time || 0), level = sum.level | 0, kills = me.kills | 0;
    st.runs++; if (sum.won) st.wins++; st.kills += sum.kills | 0;
    st.bestLevel = Math.max(st.bestLevel, level); st.bestKills = Math.max(st.bestKills, kills); st.bestTime = Math.max(st.bestTime, time);
    const sid = ED.STAGE_IDS[stage];
    if (sid) {
      const b = p.best[sid];
      if (b) { if (time > b.time) out.records.push('time'); if ((sum.kills | 0) > b.kills) out.records.push('kills'); if (level > b.level) out.records.push('level'); }
      const o = b || { time: 0, kills: 0, level: 0, won: false };
      p.best[sid] = { time: Math.max(o.time, time), kills: Math.max(o.kills, sum.kills | 0), level: Math.max(o.level, level), won: o.won || !!sum.won };
    }
    if (me.cls && ED.UNLOCKS.heroes[me.cls] && p.played.indexOf(me.cls) < 0) {
      p.played.push(me.cls);
      const h = ED.HEROES && ED.HEROES[me.cls], wd = h && ED.WEAPONS && ED.WEAPONS[h.sig];
      if (ED.UNLOCKS.sigAfterRun && wd) { out.weapons.push(wd.id); out.news.push({ kind: 'weapon', id: wd.id, name: wd.name, txt: wd.name + ' joins the weapon pool' }); }
    }
    if (sum.won && p.beat.indexOf(stage) < 0) {
      p.beat.push(stage);
      for (const i in ED.UNLOCKS.stages) if (ED.UNLOCKS.stages[i].beat === stage && ED.STAGES[+i]) { out.stages.push(+i); out.news.push({ kind: 'stage', id: ED.STAGE_IDS[+i], name: ED.STAGES[+i].name, txt: 'New stage: ' + ED.STAGES[+i].name }); }
    }
    for (const cls of heroOrder()) {
      if (!ED.UNLOCKS.heroes[cls] || S.heroUnlocked(p, cls) || !S.heroProgress(p, cls).done) continue;
      p.heroes.push(cls); out.unlocked.push(cls);
      const name = ED.HEROES && ED.HEROES[cls] ? ED.HEROES[cls].name : cls;
      out.news.push({ kind: 'hero', id: cls, name, txt: 'New hero: ' + name });
    }
    return out;
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
    return { u8, vu: () => { let v = 0, m = 1, x; do { x = u8(); v += (x & 127) * m; m *= 128; } while (x & 128 && m < 2 ** 56); return v; } };
  };

  // Body bytes -> code string (CRC16 appended, scrambled, base32 in groups of 5).
  const pack = (body) => {
    const crc = crc16(body), all = new Uint8Array(body.length + 2);
    all.set(body); all[body.length] = crc >> 8; all[body.length + 1] = crc & 255;
    return PREFIX + '-' + toB32(scramble(all)).match(/.{1,5}/g).join('-');
  };
  S._pack = pack; S._writer = writer; // tools/check-save.js builds hand-made codes with these
  // Layout v1: version, name (len + NAME_CHARS indices), gold, lifetime, [n shop ranks], [n heroes: flags bit0 unlocked, bit1 played],
  // [n stages: flags bit0 beat, bit1 best won, bit2 has best; best time, kills, level], [n stats]. Every [list] starts with its count.
  S.encode = (p) => {
    const q = S.normalize(p), o = writer(), heroes = heroOrder();
    o.u8(CODE_VERSION);
    o.vu(q.name.length); for (const ch of q.name) o.u8(NAME_CHARS.indexOf(ch));
    o.vu(q.gold); o.vu(q.lifetime);
    o.vu(ED.SHOP.length); for (const s of ED.SHOP) o.u8(S.rank(q, s.id));
    o.vu(heroes.length); for (const c of heroes) o.u8((q.heroes.indexOf(c) >= 0 ? 1 : 0) | (q.played.indexOf(c) >= 0 ? 2 : 0));
    o.vu(ED.STAGE_IDS.length);
    ED.STAGE_IDS.forEach((id, i) => { const b = q.best[id]; o.u8((q.beat.indexOf(i) >= 0 ? 1 : 0) | (b && b.won ? 2 : 0) | (b ? 4 : 0)); o.vu(b ? b.time : 0); o.vu(b ? b.kills : 0); o.vu(b ? b.level : 0); });
    o.vu(STAT_KEYS.length); for (const k of STAT_KEYS) o.vu(q.stats[k]);
    return pack(o.b);
  };
  // Returns a normalized profile or throws an Error with a readable message. Entries beyond the lists this build knows are read and dropped.
  S.decode = (code) => {
    let s = String(code || '').toUpperCase().replace(/\s+/g, '').replace(/^WK[IL]/, 'WK1');
    if (!s.startsWith(PREFIX)) throw new Error('Wickdeep save codes begin with ' + PREFIX + '-.');
    s = s.slice(PREFIX.length).replace(/-/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    let all;
    try { all = scramble(fromB32(s)); } catch (e) { throw new Error('That code contains characters a save code never uses.'); }
    let body = null;
    for (const len of [all.length, all.length - 1]) { if (len < 3) continue; const b = all.slice(0, len - 2); if (crc16(b) === ((all[len - 2] << 8) | all[len - 1])) { body = b; break; } }
    if (!body) throw new Error('That code fails its checksum. A character is probably mistyped or missing.');
    const r = reader(body), o = { shop: {}, heroes: [], played: [], beat: [], best: {}, stats: {} };
    try {
      if (r.u8() > CODE_VERSION) throw new Error('newer');
      let n = r.vu(), name = '';
      for (let i = 0; i < n; i++) name += NAME_CHARS[r.u8()] || '';
      o.name = name; o.gold = r.vu(); o.lifetime = r.vu();
      n = r.vu(); for (let i = 0; i < n; i++) { const v = r.u8(); if (ED.SHOP[i]) o.shop[ED.SHOP[i].id] = v; }
      const heroes = heroOrder();
      n = r.vu(); for (let i = 0; i < n; i++) { const f = r.u8(), c = heroes[i]; if (!c) continue; if (f & 1) o.heroes.push(c); if (f & 2) o.played.push(c); }
      n = r.vu();
      for (let i = 0; i < n; i++) {
        const f = r.u8(), b = { time: r.vu(), kills: r.vu(), level: r.vu(), won: !!(f & 2) }, id = ED.STAGE_IDS[i];
        if (!id) continue;
        if (f & 1) o.beat.push(i);
        if (f & 4) o.best[id] = b;
      }
      n = r.vu(); for (let i = 0; i < n; i++) { const v = r.vu(); if (STAT_KEYS[i]) o.stats[STAT_KEYS[i]] = v; }
    } catch (e) {
      if (e.message === 'newer') throw new Error('That code was made by a newer Wickdeep. Reload the page.');
      throw new Error('That code is damaged.');
    }
    return S.normalize(o);
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
  M.refundTotal = () => S.refundTotal(M.get());
  M.refund = () => { const t = S.refundAll(M.get()); M.save(); return t; };
  M.unlocked = (cls) => S.heroUnlocked(M.get(), cls);
  M.stageUnlocked = (i) => S.stageUnlocked(M.get(), i);
  // Hero rows in save order: { id, unlocked, played (signature weapon in the pool), txt (lock rule, '' for start heroes), prog (0..1), cur, need }.
  M.heroes = () => {
    const p = M.get();
    return heroOrder().filter(c => ED.UNLOCKS.heroes[c]).map(c => { const g = S.heroProgress(p, c), r = ED.UNLOCKS.heroes[c]; return { id: c, unlocked: S.heroUnlocked(p, c), played: p.played.indexOf(c) >= 0, txt: r.txt || '', prog: g.prog, cur: g.cur, need: g.need }; });
  };
  // Stage rows: { i, id, name, unlocked, txt (lock rule), beat, best ({ time, kills, level, won } or null) }.
  M.stages = () => {
    const p = M.get();
    return ED.STAGES.map((sd, i) => { const r = ED.UNLOCKS.stages[i] || {}; return { i, id: ED.STAGE_IDS[i], name: sd.name, unlocked: S.stageUnlocked(p, i), txt: r.txt || '', beat: p.beat.indexOf(i) >= 0, best: p.best[ED.STAGE_IDS[i]] || null }; });
  };
  M.bundle = () => S.metaBundle(M.get());
  // Records a finished run (World.summary(); pid = this player's hero) and saves. Returns the new unlocks [{ kind: 'hero'|'stage'|'weapon', id, name, txt }]; the full result is in ED.Meta.last.
  M.recordRun = (sum, pid) => { M.last = S.applyRun(M.get(), sum, sum.stage, pid); M.save(); return M.last.news; };
  M.code = () => S.encode(M.get());
  // Replaces the bound profile with a decoded save code and saves it. Throws an Error with a readable message on a bad code.
  M.restore = (code) => { M.p = S.decode(code); M.save(); return M.p; };
})(globalThis.ED || (globalThis.ED = {}));
