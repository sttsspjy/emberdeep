// Hero stat block and effective weapon / skill numbers (ARCHITECTURE §6-7).
// ED.Stats.compute(p) -> { maxHp, armor, regen, speed, pickup, might, haste, reach, velocity, duration, amount, luck, growth, greed, crit, critMul, revival, rerolls, skips, banishes, focus }.
// Sources: hero base + passives (ED.PASSIVES[id].per x level, or per[level-1] for arrays) + meta shop ranks (p.meta.shop) + ED.HOOK[cls].stats(p, add).
// Additive keys add up; speed and pickup sums are fractions of the hero base; maxHp, armor, regen add flat.
(function (ED) {
  'use strict';
  const St = ED.Stats = {};
  const KEYS = ['maxHp', 'armor', 'regen', 'speed', 'pickup', 'might', 'haste', 'reach', 'velocity', 'duration', 'amount', 'luck', 'growth', 'greed', 'crit', 'critMul', 'revival', 'rerolls', 'skips', 'banishes', 'focus'];
  St.KEYS = KEYS;
  St.PICKUP = 48; // base pickup radius (px)
  St.HASTE_CAP = 0.5;
  St.CD_MIN = 0.2;   // weapon cooldown floor (s)
  St.FOCUS_CAP = 0.5; // skill cooldown reduction cap
  // Tune steps (GAME-DESIGN §4), card order = ws.tk order: damage x (1 + dmg x count), cooldown x cd^count, area x (1 + area x count).
  ED.TUNE = [{ id: 'dmg', dmg: 0.15, txt: '+15% damage' }, { id: 'haste', cd: 0.91, txt: '+10% attack speed' }, { id: 'area', area: 0.12, txt: '+12% area' }];
  // Generic path step (path ranks 2 and 4): damage x (1 + dmg x steps), cooldown x cd^steps.
  ED.PATH_STEP = { dmg: 0.1, cd: 0.95, txt: '+10% damage, +5% speed' };

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
      revival: add.revival, rerolls: add.rerolls, skips: add.skips, banishes: add.banishes, focus: Math.min(St.FOCUS_CAP, Math.max(0, add.focus)),
    };
    return st;
  };

  // Mods summed into `sum` (numbers add, booleans OR, strings: last wins). Returns sum.
  const addMods = (m, sum) => { if (m) for (const k in m) { const v = m[k]; if (typeof v === 'number') sum[k] = (sum[k] || 0) + v; else if (typeof v === 'boolean') sum[k] = sum[k] || v; else sum[k] = v; } return sum; };
  const clear = (o) => { for (const k in o) delete o[k]; return o; };
  // Skill level mods: def.levels[0 .. lvl-2].
  const sumLevels = (def, lvl, sum) => {
    clear(sum);
    const L = def.levels || [];
    for (let i = 0; i < lvl - 1 && i < L.length; i++) addMods(L[i].mods, sum);
    return sum;
  };
  // Weapon mods of slot ws: the picked path's shape ranks (path rank 1 / 3 / 5 -> ranks[0 / 1 / 2]; kept after a Form) + the Form's refine ranks (ws.fl).
  const sumWeapon = (ws, root, form, sum) => {
    clear(sum);
    const pa = ws.path >= 0 && root && root.paths ? root.paths[ws.path] : null;
    if (pa) { const R = pa.ranks || [], n = (ws.pr[ws.path] + 1) >> 1; for (let r = 0; r < n && r < R.length; r++) addMods(R[r].mods, sum); }
    if (form && form.refine) for (let r = 0; r < ws.fl && r < form.refine.length; r++) addMods(form.refine[r].mods, sum);
    return sum;
  };
  const SUM = {}, ZERO3 = [0, 0, 0];
  // Weapon keys with fixed rules (ARCHITECTURE §6); every other key in base or mods passes through (base + sum for numbers).
  const KNOWN = { dmg: 1, cd: 1, n: 1, pierce: 1, area: 1, speed: 1, dur: 1, knock: 1, range: 1, crit: 1 };

  // Effective numbers of weapon slot `slot` of hero p into ws.S (reused object): { dmg, cd, n, pierce, area, speed, dur, knock, range, crit, critMul, ...custom }.
  // Base from ED.WEAPONS[ws.id].base (the Form's once taken); mods from sumWeapon; tune steps (ws.tk) and generic path steps (path ranks 2, 4) scale dmg, cd and area.
  St.weapon = (p, slot) => {
    const ws = p.weapons[slot], def = ED.WEAPONS[ws.id], root = ED.WEAPONS[ED.weaponRoot(ws)], b = def.base, st = p.stats;
    const sum = sumWeapon(ws, root, def.form ? def : null, SUM);
    const T = ED.TUNE, K = ws.tk || ZERO3, g = ws.path >= 0 ? ws.pr[ws.path] >> 1 : 0, PS = ED.PATH_STEP;
    const kDmg = (1 + T[0].dmg * K[0]) * (1 + PS.dmg * g), kCd = Math.pow(T[1].cd, K[1]) * Math.pow(PS.cd, g), kArea = 1 + T[2].area * K[2];
    const S = ws.S || (ws.S = {});
    clear(S);
    for (const k in b) if (!KNOWN[k]) S[k] = b[k];
    for (const k in sum) if (!KNOWN[k]) S[k] = typeof sum[k] === 'number' && typeof b[k] === 'number' ? b[k] + sum[k] : sum[k];
    S.dmg = (b.dmg || 0) * (1 + (sum.dmg || 0)) * kDmg * (1 + st.might);
    S.cd = Math.max(St.CD_MIN, (b.cd || 1) * (1 + (sum.cd || 0)) * kCd * (1 - st.haste));
    S.n = (b.n || 1) + (sum.n || 0) + (def.noAmount ? 0 : st.amount);
    S.pierce = (b.pierce || 0) + (sum.pierce || 0);
    S.area = (b.area || 1) * (1 + (sum.area || 0)) * kArea * (1 + st.reach);
    S.speed = (b.speed || 0) * (1 + (sum.speed || 0)) * (1 + st.velocity);
    S.dur = (b.dur || 0) * (1 + (sum.dur || 0)) * (1 + st.duration);
    S.knock = (b.knock || 0) * (1 + (sum.knock || 0));
    S.range = (b.range || 0) * (1 + (sum.range || 0)) * (1 + st.velocity);
    S.crit = st.crit + (b.crit || 0) + (sum.crit || 0);
    S.critMul = st.critMul;
    ws.Sv = p.statsV; ws.Sk = ED.weaponKey(ws); ws.Sid = ws.id;
    return S;
  };
  // Effective numbers of hero skill `idx` into sk.N (reused): { cd, r, dur, n, ...custom } with reach on r, duration on dur, focus (not haste) on cd. Skills deal no damage (no dmg key).
  St.skill = (p, idx) => {
    const sk = p.skills[idx], def = ED.SKILLS[sk.id], b = def.base || {}, st = p.stats, sum = sumLevels(def, sk.lvl, SUM);
    const N = sk.N || (sk.N = {});
    clear(N);
    for (const k in b) N[k] = b[k];
    for (const k in sum) N[k] = typeof sum[k] === 'number' && typeof b[k] === 'number' ? b[k] + sum[k] : sum[k];
    N.cd = Math.max(1, (def.cd || 10) * (1 + (sum.cd || 0)) * (1 - st.focus));
    if (b.r !== undefined) N.r = b.r * (1 + (sum.r || 0)) * (1 + st.reach);
    if (b.dur !== undefined) N.dur = b.dur * (1 + (sum.dur || 0)) * (1 + st.duration);
    N.crit = st.crit; N.critMul = st.critMul;
    sk.Nv = p.statsV; sk.Nl = sk.lvl;
    return N;
  };
})(globalThis.ED || (globalThis.ED = {}));
