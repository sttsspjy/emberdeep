// Profile persistence: localStorage autosave plus a portable, checksummed save code (format version 1).
// Profile: { v, name, gold, lifetime, shop: { shopId: rank }, heroes: [unlocked cls], played: [cls with a finished run], beat: [stage indices beaten],
//   best: { stageId: { time, kills, level, won } }, stats: { runs, wins, kills, bestLevel } }. Settings live under their own key.
// Save code: 'WK1-' + base32(scramble(utf8(JSON) + CRC16)) in groups of 5. Unlock rules: ED.UNLOCKS (src/data/meta.js).
(function (ED) {
  'use strict';
  const U = ED.U;
  // ?slot=2 keeps a second profile in the same browser (two local tabs playing together).
  const SLOT = (() => { try { const v = new URLSearchParams(location.search).get('slot'); return v ? '.' + v.replace(/[^a-z0-9]/gi, '').slice(0, 8) : ''; } catch (e) { return ''; } })();
  const LS_KEY = 'wickdeep.survivors.v1' + SLOT, LS_SETTINGS = 'wickdeep.survivors.settings.v1';
  const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', PREFIX = 'WK1', CODE_VERSION = 1;
  const S = ED.Save = { KEY: LS_KEY, CODE_VERSION };
  const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);

  S.defaultProfile = () => ({
    v: 1, name: 'Wanderer', gold: 0, lifetime: 0, shop: {}, heroes: startHeroes(), played: [], beat: [], best: {},
    stats: { runs: 0, wins: 0, kills: 0, bestLevel: 0 },
  });
  const startHeroes = () => Object.keys(ED.UNLOCKS.heroes).filter(c => ED.UNLOCKS.heroes[c].start);
  S.sanitizeName = (n) => { n = String(n || '').split('').filter(ch => NAME_CHARS.indexOf(ch) >= 0).join('').trim().slice(0, 12); return n || 'Wanderer'; };

  // Any parsed object -> a valid profile (unknown fields dropped, numbers clamped).
  S.normalize = (o) => {
    const p = S.defaultProfile(); o = o && typeof o === 'object' ? o : {};
    p.name = S.sanitizeName(o.name);
    p.gold = Math.max(0, Math.floor(+o.gold || 0)); p.lifetime = Math.max(p.gold, Math.floor(+o.lifetime || 0));
    for (const s of ED.SHOP) { const r = o.shop ? Math.floor(+o.shop[s.id] || 0) : 0; if (r > 0) p.shop[s.id] = U.clamp(r, 0, s.max); }
    const heroOk = (c) => ED.UNLOCKS.heroes[c] !== undefined;
    if (Array.isArray(o.heroes)) for (const c of o.heroes) if (heroOk(c) && p.heroes.indexOf(c) < 0) p.heroes.push(c);
    if (Array.isArray(o.played)) p.played = o.played.filter((c, i, a) => heroOk(c) && a.indexOf(c) === i);
    if (Array.isArray(o.beat)) p.beat = o.beat.map(v => v | 0).filter((v, i, a) => v >= 0 && v < ED.STAGES.length && a.indexOf(v) === i);
    if (o.best && typeof o.best === 'object') for (const id of ED.STAGE_IDS) { const b = o.best[id]; if (b) p.best[id] = { time: +b.time || 0, kills: b.kills | 0, level: b.level | 0, won: !!b.won }; }
    if (o.stats) for (const k in p.stats) p.stats[k] = Math.max(0, Math.floor(+o.stats[k] || 0));
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
  S.shopCost = (p, id) => { const s = ED.SHOP.find(x => x.id === id); return s && S.rank(p, id) < s.max ? ED.SHOP_BASE * (S.rank(p, id) + 1) : 0; };
  S.buy = (p, id) => { const c = S.shopCost(p, id); if (!c || p.gold < c) return false; p.gold -= c; p.shop[id] = S.rank(p, id) + 1; return true; };
  S.refundTotal = (p) => { let t = 0; for (const s of ED.SHOP) for (let r = 0; r < S.rank(p, s.id); r++) t += ED.SHOP_BASE * (r + 1); return t; };
  S.refundAll = (p) => { p.gold += S.refundTotal(p); p.shop = {}; };
  // What a run needs from the profile (World players[].meta): shop ranks and the signature weapons unlocked for the general pool.
  S.metaBundle = (p) => ({ shop: Object.assign({}, p.shop), sigs: ED.UNLOCKS.sigAfterRun ? p.played.slice() : [] });

  // Applies a finished run: gold, records, unlocks. summary = World.summary(); pid = this player's hero. Returns { gold, unlocked: [cls], stages: [index] }.
  S.applyRun = (p, sum, stage, pid) => {
    const me = sum.perHero.find(h => h.pid === pid) || sum.perHero[0] || { cls: '', kills: 0 };
    const out = { gold: sum.gold | 0, unlocked: [], stages: [] };
    p.gold += out.gold; p.lifetime += out.gold;
    p.stats.runs++; if (sum.won) p.stats.wins++; p.stats.kills += sum.kills | 0; p.stats.bestLevel = Math.max(p.stats.bestLevel, sum.level | 0);
    const sid = ED.STAGE_IDS[stage], b = p.best[sid] || { time: 0, kills: 0, level: 0, won: false };
    p.best[sid] = { time: Math.max(b.time, Math.floor(sum.time)), kills: Math.max(b.kills, sum.kills | 0), level: Math.max(b.level, sum.level | 0), won: b.won || !!sum.won };
    if (me.cls && p.played.indexOf(me.cls) < 0) p.played.push(me.cls);
    if (sum.won && p.beat.indexOf(stage) < 0) { p.beat.push(stage); for (const i in ED.UNLOCKS.stages) if (ED.UNLOCKS.stages[i].beat === stage) out.stages.push(+i); }
    for (const cls in ED.UNLOCKS.heroes) {
      if (S.heroUnlocked(p, cls)) continue;
      const r = ED.UNLOCKS.heroes[cls];
      const ok = (r.survive && sum.time >= r.survive) || (r.beat !== undefined && p.beat.indexOf(r.beat) >= 0) || (r.kills && (me.kills | 0) >= r.kills) || (r.level && (sum.level | 0) >= r.level);
      if (ok) { p.heroes.push(cls); out.unlocked.push(cls); }
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
  const utf8 = (s) => new TextEncoder().encode(s), unutf8 = (b) => new TextDecoder().decode(b);

  S.encode = (p) => {
    const q = S.normalize(p);
    const body = utf8(JSON.stringify([CODE_VERSION, q.name, q.gold, q.lifetime, q.shop, q.heroes, q.played, q.beat, q.best, q.stats]));
    const all = new Uint8Array(body.length + 2), crc = crc16(body);
    all.set(body); all[body.length] = crc >> 8; all[body.length + 1] = crc & 255;
    return PREFIX + '-' + toB32(scramble(all)).match(/.{1,5}/g).join('-');
  };
  // Returns a normalized profile or throws an Error with a readable message.
  S.decode = (code) => {
    let s = String(code || '').toUpperCase().replace(/\s+/g, '');
    if (!s.startsWith(PREFIX)) throw new Error('Wickdeep save codes begin with ' + PREFIX + '-.');
    s = s.slice(PREFIX.length).replace(/-/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    let all;
    try { all = scramble(fromB32(s)); } catch (e) { throw new Error('That code contains characters a save code never uses.'); }
    let body = null;
    for (const len of [all.length, all.length - 1]) { if (len < 3) continue; const b = all.slice(0, len - 2); if (crc16(b) === ((all[len - 2] << 8) | all[len - 1])) { body = b; break; } }
    if (!body) throw new Error('That code fails its checksum. A character is probably mistyped or missing.');
    let a;
    try { a = JSON.parse(unutf8(body)); } catch (e) { throw new Error('That code is damaged.'); }
    if (!Array.isArray(a) || a[0] > CODE_VERSION) throw new Error('That code was made by a newer Wickdeep. Reload the page.');
    return S.normalize({ name: a[1], gold: a[2], lifetime: a[3], shop: a[4], heroes: a[5], played: a[6], beat: a[7], best: a[8], stats: a[9] });
  };
})(globalThis.ED || (globalThis.ED = {}));
