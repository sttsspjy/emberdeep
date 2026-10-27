// Hero stat block and effective weapon / skill numbers (ARCHITECTURE §6-7).
// ED.Stats.compute(p) -> { maxHp, armor, regen, speed, pickup, might, haste, reach, velocity, duration, amount, luck, growth, greed, crit, critMul, revival, rerolls, skips, banishes }.
// Sources: hero base + passives (ED.PASSIVES[id].per x level, or per[level-1] for arrays) + meta shop ranks (p.meta.shop) + ED.HOOK[cls].stats(p, add).
// Additive keys add up; speed and pickup sums are fractions of the hero base; maxHp, armor, regen add flat.
(function (ED) {
  'use strict';
  const St = ED.Stats = {};
  const KEYS = ['maxHp', 'armor', 'regen', 'speed', 'pickup', 'might', 'haste', 'reach', 'velocity', 'duration', 'amount', 'luck', 'growth', 'greed', 'crit', 'critMul', 'revival', 'rerolls', 'skips', 'banishes'];
  St.KEYS = KEYS;
  St.PICKUP = 36; // base pickup radius (px)
  St.HASTE_CAP = 0.75;

  St.compute = (p) => {
    const h = ED.HEROES[p.cls] || {}, add = {};
    for (const k of KEYS) add[k] = 0;
    for (const ps of p.passives) {
      const d = ED.PASSIVES[ps.id]; if (!d) continue;
      for (const k in d.per) { const v = d.per[k]; add[k] = (add[k] || 0) + (Array.isArray(v) ? v[Math.min(v.length, ps.lvl) - 1] || 0 : v * ps.lvl); }
    }
    const shop = (p.meta && p.meta.shop) || {};
    for (const s of ED.SHOP) { const r = shop[s.id] | 0; if (r > 0) add[s.stat] = (add[s.stat] || 0) + s.per * Math.min(r, s.max); }
    const hk = ED.HOOK[p.cls];
    if (hk && hk.stats) hk.stats(p, add);
    const st = {
      maxHp: Math.round((h.hp || 100) + add.maxHp), armor: add.armor, regen: add.regen,
      speed: (h.speed || 90) * (1 + add.speed), pickup: St.PICKUP * (1 + add.pickup),
      might: add.might, haste: Math.min(St.HASTE_CAP, add.haste), reach: add.reach, velocity: add.velocity, duration: add.duration, amount: add.amount,
      luck: Math.max(0, add.luck), growth: add.growth, greed: add.greed, crit: (h.crit !== undefined ? h.crit : 0.05) + add.crit, critMul: 2 + add.critMul,
      revival: add.revival, rerolls: add.rerolls, skips: add.skips, banishes: add.banishes,
    };
    return st;
  };

  // Level mods of a weapon / skill def summed over its levels 2..lvl into `sum` (numbers add, booleans OR, strings: last wins). Returns sum.
  const sumLevels = (def, lvl, sum) => {
    for (const k in sum) delete sum[k];
    const L = def.levels || [];
    for (let i = 0; i < lvl - 1 && i < L.length; i++) {
      const m = L[i].mods; if (!m) continue;
      for (const k in m) { const v = m[k]; if (typeof v === 'number') sum[k] = (sum[k] || 0) + v; else if (typeof v === 'boolean') sum[k] = sum[k] || v; else sum[k] = v; }
    }
    return sum;
  };
  const SUM = {};
  // Weapon keys with fixed rules (ARCHITECTURE §6); every other key in base or level mods passes through (base + sum for numbers).
  const KNOWN = { dmg: 1, cd: 1, n: 1, pierce: 1, area: 1, speed: 1, dur: 1, knock: 1, range: 1, crit: 1 };

  // Effective numbers of weapon slot `slot` of hero p into ws.S (reused object): { dmg, cd, n, pierce, area, speed, dur, knock, range, crit, critMul, ...custom }.
  St.weapon = (p, slot) => {
    const ws = p.weapons[slot], def = ED.WEAPONS[ws.id], b = def.base, st = p.stats, sum = sumLevels(def, ws.lvl, SUM);
    const S = ws.S || (ws.S = {});
    for (const k in S) delete S[k];
    for (const k in b) if (!KNOWN[k]) S[k] = b[k];
    for (const k in sum) if (!KNOWN[k]) S[k] = typeof sum[k] === 'number' && typeof b[k] === 'number' ? b[k] + sum[k] : sum[k];
    S.dmg = (b.dmg || 0) * (1 + (sum.dmg || 0)) * (1 + st.might);
    S.cd = Math.max(0.12, (b.cd || 1) * (1 + (sum.cd || 0)) * (1 - st.haste));
    S.n = (b.n || 1) + (sum.n || 0) + (def.noAmount ? 0 : st.amount);
    S.pierce = (b.pierce || 0) + (sum.pierce || 0);
    S.area = (b.area || 1) * (1 + (sum.area || 0)) * (1 + st.reach);
    S.speed = (b.speed || 0) * (1 + (sum.speed || 0)) * (1 + st.velocity);
    S.dur = (b.dur || 0) * (1 + (sum.dur || 0)) * (1 + st.duration);
    S.knock = (b.knock || 0) * (1 + (sum.knock || 0));
    S.range = (b.range || 0) * (1 + (sum.range || 0)) * (1 + st.velocity);
    S.crit = st.crit + (b.crit || 0) + (sum.crit || 0);
    S.critMul = st.critMul;
    ws.Sv = p.statsV; ws.Sl = ws.lvl; ws.Sid = ws.id;
    return S;
  };

  // Effective numbers of hero skill `idx` (0 Q, 1 E) into sk.N (reused): { cd, dmg, r, dur, n, ...custom } with might on dmg, reach on r, duration on dur, no haste on cd.
  St.skill = (p, idx) => {
    const sk = p.skills[idx], def = ED.SKILLS[sk.id], b = def.base || {}, st = p.stats, sum = sumLevels(def, sk.lvl, SUM);
    const N = sk.N || (sk.N = {});
    for (const k in N) delete N[k];
    for (const k in b) N[k] = b[k];
    for (const k in sum) N[k] = typeof sum[k] === 'number' && typeof b[k] === 'number' ? b[k] + sum[k] : sum[k];
    N.cd = Math.max(1, (def.cd || 10) * (1 + (sum.cd || 0)));
    if (b.dmg !== undefined) N.dmg = b.dmg * (1 + (sum.dmg || 0)) * (1 + st.might);
    if (b.r !== undefined) N.r = b.r * (1 + (sum.r || 0)) * (1 + st.reach);
    if (b.dur !== undefined) N.dur = b.dur * (1 + (sum.dur || 0)) * (1 + st.duration);
    N.crit = st.crit; N.critMul = st.critMul;
    sk.Nv = p.statsV; sk.Nl = sk.lvl;
    return N;
  };
})(globalThis.ED || (globalThis.ED = {}));
