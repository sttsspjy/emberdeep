// Analytic hero model shared by tools/sheet.js (the tables) and tools/pick.js (the bot's card values): hero damage on one foe and in a pack, effective health, the conditional-damage factor of a build.
// Factory: require('./model.js')(ED, { pack, surround }) -> the model functions; pack (default 4) is the foe count of "a pack"; surround: the pack stands all round the hero, so a fan reaches only the share its angle covers.
// No require of sim.js (the factory takes the loaded ED).
module.exports = (ED, opts) => {
  const C = ED.CONST, St = ED.Stats;
  const pack = Math.max(1, Math.round(opts && opts.pack || 4)), surround = !!(opts && opts.surround);

  // ---- hero damage on one foe and in a pack ----
  const SWEEP = new Set(['charge.impact', 'charge.shock', 'step.slash', 'judgment.leg', 'shieldthrow.return', 'vanish.ambush']);
  function packWeapon(m, n) {
    const w = m.weapon, st = null; void st;
    const hitsBase = w.kind === 'melee' ? n : Math.min(n, (w.n || 1) * (1 + (w.pierce || 0)));
    let sum = w._avg * hitsBase;
    for (const e of w._extras) sum += e.perAttack * (e.label === 'Twin Fang' ? hitsBase / (w.oneFoe || 1) : ONE_STREAM.has(e.label) ? 1 : FEW[e.label] ? Math.min(n, FEW[e.label]) : n);
    return sum * w._aps;
  }
  // Extras that do not grow with the pack: the two Lich bolts seek one foe each (the same total), Guardian Light's Smites ride the one Smite stream the status estimate counts; a Solar Flare burst (radius 50) and a Dawn's Wake strip (44 wide) catch about two foes of a pack.
  const ONE_STREAM = new Set(['Lich bolts', 'Heavy Smites', 'Sunstrike']), FEW = { 'Solar Flare': 2, "Dawn's Wake": 2 };
  function directDamage(m, n) {
    if (n === 1) return m.weapon.dps + m.skills.reduce((s, k) => s + k.dpsCd, 0);
    let sum = packWeapon(m, n);
    for (const k of m.skills) for (const q of k.parts) {
      if (q.kind === 'zone') continue;
      const key = k.id + '.' + q.id;
      let mul = q.r > 0 || SWEEP.has(key) ? n : 1;
      if (key === 'volley.arrow' || key === 'volley.wave') mul = Math.min(n, q.fanN * 2) * (q.waves || 1) / Math.max(1, q.oneFoe) * (surround ? Math.min(1, q.fan / (2 * Math.PI)) : 1);
      if (key === 'volley.burst') { sum += q.here * n * Math.min(2, n - 1) / k._cd; continue; } // a marked foe's burst reaches 2 other foes of the pack, one burst per foe of the pack
      if (key === 'step.blossom') { sum += q.here * Math.min(n - 1, q.n) / k._cd; continue; } // Death Blossom: the chain cuts one more foe of the pack per blink (the Shadowstep cut the first)
      if (key === 'shieldthrow.strike') mul = Math.min(n, 4 + 2);
      if (q.kind === 'minion') mul = q.dkCleave ? Math.min(n, 3) : 1; // the Death Knight cleaves a wide arc: about 3 foes of a pack
      if (key === 'vanish.ambush') mul = (m.weapon.kind === 'melee' ? n : Math.min(n, m.weapon.n)) / Math.max(1, q.oneFoe);
      sum += q._r.total * mul / k._cd;
    }
    return sum;
  }
  const statusDamage = (m) => m.mult.status.reduce((s, x) => s + (x.est && x.est.dps || 0), 0);
  const heroDamage = (m, n, k, e) => directDamage(m, n) * (k || 1) * (e || 1) + statusDamage(m); // k: the conditional-damage factor of the build (condFactor); e: echoK; statuses are raw damage
  // Final Judgment: every hit on a Judged foe echoes fjEcho to each other Judged foe of the pack (judged for 4 s + judgeDur of every Judgment cooldown), so a pack of n takes 1 + fjEcho x (n - 1) x the Judged share.
  const echoK = (p, m, n) => (p.stats.fjEcho > 0 && n > 1 ? 1 + p.stats.fjEcho * (n - 1) * Math.min(1, (4 + p.stats.judgeDur) / St.skillNums('judgment', p.stats).cdEff) : 1);

  // ---- defence: effective health with the uptime of a guard ----
  function defence(p, m) {
    const st = p.stats, out = { ehp: m.def.ehp, note: [] };
    let keep = 1;
    if (st.braceDR && !(st.lich > 0)) {
      const N = St.skillNums('charge', st), up = Math.min(1, st.brace / Math.max(C.BRACE_CD, N.cdEff)), dr = Math.min(0.4, st.braceDR);
      keep *= 1 - dr * up; out.note.push(`Brace -${Math.round(dr * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    if (st.phalanx > 0) { // Iron Phalanx: the War Banner lasts bannerDur of every Charge cooldown; fighting inside it 60% of the time, Brace-strength damage reduction and foes that deal bannerWeak less
      const N = St.skillNums('charge', st), up = 0.6 * Math.min(1, N.p.banner.dur / Math.max(N.p.banner.dur, N.cdEff)), dr = Math.min(0.4, st.braceDR);
      keep *= (1 - dr * up) * (1 - st.bannerWeak * up); out.note.push(`War Banner -${Math.round(dr * 100)}% and foes -${Math.round(st.bannerWeak * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    if (p.cls === 'cleric') {
      const N = St.skillNums('sanctuary', st), z = N.p.zone, up = Math.min(1, z.dur / N.cdEff), dr = Math.min(st.aegis > 0 ? C.DR_FLOOR : 0.4, 0.15 + st.sanctDR + st.aegisDR); // Radiant Aegis may cut up to the DR floor (combat.js still clamps a Sanctuary at 40% until it reads z.drCap)
      keep *= 1 - dr * up; out.note.push(`Sanctuary -${Math.round(dr * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    if (st.lich > 0) { // Lich Form: the Brace channel for lichT seconds after every Bone Harvest
      const up = Math.min(1, st.lichT / Math.max(st.lichT, St.skillNums('harvest', st).cdEff)), dr = Math.min(0.4, st.braceDR);
      keep *= 1 - dr * up; out.note.push(`Lich Form -${Math.round(dr * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    out.ehp = m.def.ehp / keep;
    // shield income (percent of max health per second, before the window caps)
    let inc = 0;
    const cd1 = St.skillNums(ED.CLASSES[p.cls].skill, st).cdEff, cd2 = St.skillNums(ED.CLASSES[p.cls].skill2, st).cdEff;
    if (p.cls === 'knight') { const n = St.skillNums('shieldthrow', st).p.strike.n; inc += Math.min(C.CATCH_MAX, C.CATCH_PER * n) / Math.max(C.KWARD_CD, cd2); }
    if (st.rally) inc += st.rally / Math.max(8, cd1);
    if (st.mantle) inc += st.mantle / Math.max(10, cd1);
    if (st.veil) inc += st.veil / Math.max(12, cd2);
    if (st.boneArmor) inc += Math.min(st.boneCap, st.boneArmor * 3) / Math.max(12, cd2);
    out.shield = Math.min(inc, C.SHIELD_WIN_CLASS / C.SHIELD_WIN_T);
    // trash stun uptime: each source stuns the foe for dur, then its stun cooldown (dur + STUN_DR) must pass
    let stun = 0;
    const src = [];
    if (p.cls === 'knight') { const q = St.skillNums('charge', st).p.impact; src.push([q.stun + st.chargeStun, cd1]); src.push([St.skillNums('shieldthrow', st).p.strike.stun, cd2]); }
    if (st.cShock && st.cStun) src.push([st.cStun, (3 + st.cleaveN) * m.weapon.interval]);
    if (st.sanctStun) src.push([st.sanctStun, cd1]);
    if (st.aegis > 0) src.push([st.aegisStun, 2]); // a Radiant Aegis pulse every 2 s
    if (st.waveStun && m.weapon.fork) src.push([st.waveStun, 3 * m.weapon.interval]);
    for (const [d, cd] of src) stun += Math.min(1, d / Math.max(cd, d + C.STUN_DR));
    out.stun = Math.min(1, stun);
    return out;
  }

  // ---- conditional damage: the ED.COND_DMG rows a build owns count at an assumed uptime (the bonus is additive with the Damage stat) ----
  const COND_NOTE = 'conditional damage at assumed uptimes: execute 30% of the time; burning, bleeding, chilled, envenomed, doomed 60-90% when the build applies it; stunned = the stun uptime; Brand = the ailments the build keeps up (at most 4); unknown rows 50%';
  function ailmentsKept(st, d) {
    let n = 0;
    for (const id of ED.ELEMENT_IDS) if (st[ED.ELEMENTS[id].inf] > 0) n += 0.7; else if (st.element === id) n += 0.5;
    if (st.bleed > 0 || st.bleedAll > 0 || st.masterstroke) n += 0.7;
    return Math.min(4, n + (d ? d.stun : 0) + (st.seal > 0 ? 1 : 0));
  }
  function uptime(id, st, m, d) {
    const has = (k) => st[k] > 0;
    switch (id) {
      case 'execute': return 0.3;
      case 'searing': return has('fireInfuse') || st.element === 'fire' ? 0.8 : 0;
      case 'lacerate': return has('bleedAll') ? 0.9 : has('bleed') || st.masterstroke ? Math.min(0.9, 1 - Math.pow(1 - st.crit, m.weapon.aps * 2)) : 0;
      case 'malice': return has('shadowInfuse') || st.element === 'shadow' ? 0.6 : 0;
      case 'brittle': return has('iceInfuse') ? 0.6 : 0;
      case 'fester': return has('poisonInfuse') ? 0.6 : 0;
      case 'opportunist': return Math.min(1, d.stun + (has('iceInfuse') ? 0.3 : 0));
      case 'knell': return 0.5 * Math.min(st.knell, 3);
      case 'brand': return ailmentsKept(st, d);
      case 'idol': return 1;
      case 'banner': return 1;
      default: return 0.5;
    }
  }
  // Cleric Smite cards. GL_UP: share of the time Guardian Light's buff is up on the Cleric (a Smite shields the Cleric every 3 s and the buff lasts 6 s). JUDGE_UP: share of a foe's life that a Smite's Judged window can cover (the first Smite and the last foes miss it);
  // JUDGE_HIT: share of Judgment casts that Judge the reference foe. Judging Light's +20% is the same +20% as Judgment's, so only the time Judgment leaves uncovered counts.
  const GL_UP = 0.9, JUDGE_UP = 0.75, JUDGE_HIT = 0.8;
  function judgeLight(p, m, smites) {
    const st = p.stats, h = m.mult.status.find(s => s.el === 'holy');
    if (!(st.smiteJudge > 0) || !smites) return 1;
    const own = Math.min(1, st.smiteJudge / Math.max(1e-3, h.est.secs || 99)) * JUDGE_UP;
    const hammer = ED.CLASSES[p.cls].skill2 === 'judgment' ? Math.min(1, (4 + st.judgeDur) / St.skillNums('judgment', st).cdEff) * JUDGE_HIT : 0;
    return 1 + 0.2 * own * (1 - hammer);
  }
  // The factor on hero hit damage: (Damage + sum of the owned conditional bonuses x uptime) / Damage, times Judging Light's Judged window.
  function condFactor(p, m, d) {
    const st = p.stats; let sum = 0;
    for (const r of ED.COND_DMG) {
      if (r.key === 'classElMul') continue; // already in the class-skill hits of the sheet
      if (r.key !== null ? !(st[r.key] > 0) : !(r.own && r.own(st))) continue;
      const id = r.key || r.id, v = id === 'idol' ? 0.1 : r.value ? r.value(st) : st[r.key];
      sum += v * uptime(id, st, m, d);
    }
    const holy = m.mult.status.find(s => s.el === 'holy'), smites = !!(holy && holy.est.dps > 0);
    if (st.guardLight > 0 && smites) sum += st.guardLight * GL_UP;
    return (Math.max(0.1, st.dmg) + sum) / Math.max(0.1, st.dmg) * judgeLight(p, m, smites);
  }

  // ---- one hero in one context: the sheet model, its defence, the conditional factor, hero damage on one foe and in a pack of `pack` ----
  function assess(p, ctx) {
    const m = ED.Sheet.compute(p, ctx, { raw: true, numbers: true }), d = defence(p, m), k = condFactor(p, m, d);
    return { m, d, k, one: heroDamage(m, 1, k), pack: heroDamage(m, pack, k, echoK(p, m, pack)), ehp: d.ehp };
  }

  // A copy of hero p holding relic `id` as well, the stat block rebuilt (the relic counterpart of ED.Sheet.withBoon).
  function withRelic(p, id, ctx) {
    const relics = (p.relics || []).concat(id), q = Object.assign({}, p, { relics });
    q.stats = St.compute({ cls: p.cls, weapon: p.weapon, boons: p.boons || {}, relics, meta: p.meta, pact: ctx ? ctx.pact | 0 : 0, chaliceHp: p.chaliceHp || 0, bonusHp: p.bonusHp || 0 });
    q.maxHp = (p.maxHp || p.stats.maxHp) + (q.stats.maxHp - p.stats.maxHp);
    return q;
  }

  return { pack, packWeapon, directDamage, statusDamage, heroDamage, echoK, defence, ailmentsKept, uptime, condFactor, assess, withRelic, COND_NOTE };
};
