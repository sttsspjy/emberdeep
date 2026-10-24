// Analytic hero model shared by tools/sheet.js (the tables) and tools/pick.js (the bot's card values): hero damage on one foe and in a pack, effective health, the conditional-damage factor of a build.
// Factory: require('./model.js')(ED, { pack, surround }) -> the model functions; pack (default 4) is the foe count of "a pack"; surround: the pack stands all round the hero, so a fan reaches only the share its angle covers.
// No require of sim.js (the factory takes the loaded ED).
module.exports = (ED, opts) => {
  const C = ED.CONST, St = ED.Stats;
  const pack = Math.max(1, Math.round(opts && opts.pack || 4)), surround = !!(opts && opts.surround);

  // ---- hero damage on one foe and in a pack ----
  const SWEEP = new Set(['charge.impact', 'charge.shock', 'charge.crack', 'step.slash', 'step.twin', 'judgment.leg', 'shieldthrow.return', 'vanish.ambush', 'heave.strike', 'heave.reel', 'heave.spin']);
  const SCATTER_R = 80; // px a Meteor Shower meteorite may land from the impact (class-pyro.js)
  // Death bursts: a pack stands within PACK_R of its centre; a burst of radius r covers (r / PACK_R)^2 of it (at most all) and no more than NEIGH foes stand round one corpse.
  const PACK_R = 90, NEIGH = 3;
  const PIERCE_LINE = 0.5; // share of the pack foes behind the first that a piercing shot reaches (bot runs: a pierce-2 shot hits 2.07 of 3 foes with 4+ foes round the first, a pierce-3 shot 2.42 of 4)
  const LINE_ALL = 1 / 3; // the same for a line that strikes every foe on it (a beam, a boomerang leg): the tight pack of 4 of tools/sheet-check.js puts one of the three others on the line
  const cover = (r) => Math.min(1, (r / PACK_R) ** 2);
  const deathPairs = (n) => { let s = 0; for (let j = 1; j <= n; j++) s += Math.min(NEIGH, n - j); return s; }; // the pack dies one foe at a time: each death bursts on the foes still alive
  function packWeapon(m, n) {
    const w = m.weapon, st = null; void st;
    if (w._bell) { // a bell strikes one foe a strike: n foes on its orbit, each struck b.sps a second at b.k of the one-foe damage factor; an extra counts its _pack(n, b), its pack (foes it reaches) or the struck foe alone
      const b = w._bell(n);
      let per = w._avg * b.k;
      for (const e of w._extras) per += e._pack ? e._pack(n, b) : e.packOnly ? 0 : e.perAttack * b.k * (e.pack ? Math.min(n, e.pack) : 1);
      return per * b.sps * n * (w._up === undefined ? 1 : w._up); // _up: the share of the time the bell strikes (Heave and Peal on cooldown take it away)
    }
    const shots = w.n || 1, first = Math.min(shots, (w.fanOne === undefined ? 1 : w.fanOne) + n - 1); // the shots of a fan that miss the first foe find one other foe each
    const hitsBase = w.kind === 'melee' ? n : w.lob ? 0 : (first + (w.line ? LINE_ALL : PIERCE_LINE) * (Math.min(n, shots * (1 + (w.pierce || 0))) - Math.min(n, shots))) * (w.legs || 1);
    let sum = w._avg * hitsBase;
    for (const e of w._extras) sum += e._pack ? e._pack(n) : e.perAttack * (e.label === 'Twin Fang' ? hitsBase / (w.oneFoe || 1) : ONE_STREAM.has(e.label) ? 1 : FEW[e.label] ? Math.min(n, FEW[e.label]) : e.pack ? Math.min(n, e.pack) : n) * (e.packMul === undefined ? 1 : e.packMul); // pack: the pack foes the extra reaches; packMul: its value per pack foe over its one-foe value
    return sum * w._aps;
  }
  // Extras that do not grow with the pack: the two Lich bolts seek one foe each (the same total), Guardian Light's Smites ride the one Smite stream the status estimate counts; a Solar Flare burst (radius 50) and a Dawn's Wake strip (44 wide) catch about two foes of a pack.
  const ONE_STREAM = new Set(['Lich bolts', 'Heavy Smites', 'Sunstrike']), FEW = { 'Solar Flare': 2, "Dawn's Wake": 2 };
  function directDamage(m, n) {
    if (n === 1) return m.weapon.dps * (m.weapon._up === undefined ? 1 : m.weapon._up) + m.skills.reduce((s, k) => s + k.dpsCd, 0);
    let sum = packWeapon(m, n);
    for (const k of m.skills) for (const q of k.parts) {
      if (q.kind === 'zone') continue;
      const key = k.id + '.' + q.id;
      let mul = q.r > 0 || SWEEP.has(key) ? n : 1;
      if (key === 'volley.arrow' || key === 'volley.wave') mul = Math.min(n, q.fanN * 2) * (q.waves || 1) / Math.max(1, q.oneFoe) * (surround ? Math.min(1, q.fan / (2 * Math.PI)) : 1);
      if (key === 'volley.burst') { sum += q.here * n * Math.min(2, n - 1) / k._cd; continue; } // a marked foe's burst reaches 2 other foes of the pack, one burst per foe of the pack
      if (key === 'charge.bash') { sum += (q.bashStrike * Math.min(n, q.bashN) + q.bashReturn * n) / k._cd; continue; } // Shield Bash: the free shield ricochets over the pack and its return pass sweeps it, like a Throw
      if (key === 'step.blossom') { sum += q.here * Math.min(n - 1, q.n) / k._cd; continue; } // Death Blossom: the chain cuts one more foe of the pack per blink (the Shadowstep cut the first)
      if (key === 'judgment.verdict') { sum += q.here * deathPairs(n) * cover(q.r) / k._cd; continue; } // a Judged foe's death bursts on the foes still standing near it: the pack dies one foe at a time within a cooldown
      if (key === 'harvest.corpse') { sum += q.here * Math.min(q.cap, n) * Math.min(NEIGH, n - 1) * cover(q.r) / k._cd; continue; } // Harvest detonates the pack's kills of the cooldown (up to the corpse cap), each on the neighbours it left
      if (key === 'harvest.shard') { sum += q.here * Math.min(q.cap, n) * Math.min(q.shardN, n - 1) / k._cd; continue; } // Carrion Storm: each corpse sends its shards at the nearest foes left
      if (key === 'meteor.rocks') { sum += q.here * q.n * q.sets * n * Math.min(1, (q.r / SCATTER_R) ** 2) / k._cd; continue; } // Meteor Shower: each meteorite lands at random within SCATTER_R of the impact and strikes the share of a pack its circle covers
      if (key === 'shieldthrow.strike') { const h = Math.min(n, 4 + 2); mul = h * (1 + (q.gather || 0) * (h - 1) / 2); } // Gathering Force: strike k of a shield lands at 1 + gather x (k - 1)
      if (q.kind === 'minion') mul = q.dkCleave ? Math.min(n, 3) : 1; // the Death Knight cleaves a wide arc: about 3 foes of a pack
      if (key === 'vanish.ambush') { const hb = m.weapon.kind === 'melee' ? n : Math.min(n, m.weapon.n); mul = (hb + (n - hb) * (q.sweepR > 0 ? cover(q.sweepR) : 0)) / Math.max(1, q.oneFoe); } // Ambush Sweep: the pack foes the Ambush shots miss catch the sweep (those within sweepR of the target)
      sum += q._r.total * mul / k._cd;
    }
    return sum * (1 + (m.boost ? m.boost.pack : 0)); // boost.pack: a damage multiplier on the whole pack's damage (White Flame)
  }
  const statusDamage = (m) => m.mult.status.reduce((s, x) => s + (x.est && x.est.dps || 0), 0);
  const heroDamage = (m, n, k, e) => directDamage(m, n) * (k || 1) * (e || 1) + statusDamage(m); // k: the conditional-damage factor of the build (condFactor); e: echoK; statuses are raw damage
  // Final Judgment: every hit on a Judged foe echoes fjEcho to each other Judged foe of the pack (judged for 4 s + judgeDur of every Judgment cooldown), so a pack of n takes 1 + fjEcho x (n - 1) x the Judged share.
  const echoK = (p, m, n) => (p.stats.fjEcho > 0 && n > 1 ? 1 + p.stats.fjEcho * (n - 1) * Math.min(1, (4 + p.stats.judgeDur) / St.skillNums('judgment', p.stats).cdEff) : 1);

  // ---- defence: effective health with the uptime of a guard ----
  // WEAK_HIT: share of the time a foe carries Judged. SMOKE_HIT: share of the time a foe stands in the Vanish smoke. DK_UP: share of the time a Death Knight stands and holds the foes round it.
  const WEAK_HIT = 0.7, SMOKE_HIT = 0.75, DK_UP = 0.5;
  // WARD_HIT: share of the foes striking the Bellwarden that stand in its Ward Bell (it rings where the bell is, beside the hero). HOOK_HIT: share of them a Tether Hook catches and Shackles.
  // WHIRL_UP: share of the hits a Bellwarden takes while it hauls its bell at strike speed (the whirl guard, class-bell.js WHIRL_DR).
  const WARD_HIT = 0.8, HOOK_HIT = 0.5, WHIRL_UP = 0.8;
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
      const N = St.skillNums('sanctuary', st), z = N.p.zone, up = Math.min(1, z.dur / N.cdEff), dr = Math.min(st.dawn > 0 ? C.DR_FLOOR : 0.4, 0.15 + st.sanctDR + st.aegisDR); // Aegis of Dawn may cut up to the DR floor (z.drCap); other Sanctuaries clamp at 40%
      keep *= 1 - dr * up; out.note.push(`Sanctuary -${Math.round(dr * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    if (st.lich > 0) { // Lich Form: the Brace channel for lichT seconds after every Bone Harvest
      const up = Math.min(1, st.lichT / Math.max(st.lichT, St.skillNums('harvest', st).cdEff)), dr = Math.min(0.4, st.braceDR);
      keep *= 1 - dr * up; out.note.push(`Lich Form -${Math.round(dr * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    if (st.comet > 0) { // Comet: untouchable for the leap; Sun Dive adds the second leap and a grace after each landing (the first grace ends where the second leap begins)
      const N = St.skillNums('meteor', st), f = N.move ? N.move.iframes : 0, inv = st.sunDive > 0 ? 2 * f + Math.min(C.SUN_GRACE, C.SUN_GAP) + C.SUN_GRACE : f, share = Math.min(0.5, inv / N.cdEff);
      keep *= 1 - share; if (share >= 0.02) out.note.push(`Comet untouchable ${Math.round(share * 100)}% of the time`);
    }
    if (st.judgeWeak > 0) { // Verdict: a Judged foe (4 s + judgeDur of every Judgment cooldown, WEAK_HIT of the time on a foe) deals judgeWeak less
      const up = WEAK_HIT * Math.min(1, (4 + st.judgeDur) / St.skillNums('judgment', st).cdEff);
      keep *= 1 - st.judgeWeak * up; out.note.push(`Judged foes -${Math.round(st.judgeWeak * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    if (p.cls === 'bell') { keep *= 1 - C.WHIRL_DR * WHIRL_UP; out.note.push(`Whirl guard -${Math.round(C.WHIRL_DR * 100)}% x ${Math.round(WHIRL_UP * 100)}% uptime`); }
    if (st.wardDur > 0) { // Ward Bell: foes inside the ward deal wardWeak less, for wardDur of every Peal cooldown
      const up = WARD_HIT * Math.min(1, st.wardDur / St.skillNums('peal', st).cdEff);
      keep *= 1 - st.wardWeak * up; out.note.push(`Ward Bell foes -${Math.round(st.wardWeak * 100)}% x ${Math.round(up * 100)}% uptime`);
    }
    if (st.shackle > 0) { // Anchor Chain: hooked foes deal shackleWeak less for shackle s of every Heave cooldown
      const up = HOOK_HIT * Math.min(1, st.shackle / St.skillNums('heave', st).cdEff);
      keep *= 1 - st.shackleWeak * up; out.note.push(`Shackled foes -${Math.round(st.shackleWeak * 100)}% x ${Math.round(up * 100)}% uptime`);
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
    if (st.hookShield) inc += st.hookShield / Math.max(C.HOOK_CD, cd1); // Tether Hook: one hook shield per HOOK_CD
    if (st.pealShield) inc += Math.min(st.pealCap, st.pealShield * pack) / Math.max(C.PEAL_SH_CD, cd2); // Warding Toll: a Peal on a pack, once per PEAL_SH_CD
    out.shield = Math.min(inc, C.SHIELD_WIN_CLASS / C.SHIELD_WIN_T);
    // trash stun uptime: each source stuns the foe for dur, then its stun cooldown (dur + STUN_DR) must pass
    let stun = 0;
    const src = [];
    if (p.cls === 'knight') { const q = St.skillNums('charge', st).p.impact; src.push([q.stun + st.chargeStun, cd1]); src.push([St.skillNums('shieldthrow', st).p.strike.stun, cd2]); }
    if (st.cShock && st.cStun) src.push([st.cStun, (3 + st.cleaveN) * m.weapon.interval]);
    if (st.sanctStun) src.push([st.sanctStun, cd1]);
    if (st.dawn > 0) src.push([st.aegisStun, 2]); // an Aegis of Dawn pulse every 2 s
    if (st.waveStun && m.weapon.fork) src.push([st.waveStun, 3 * m.weapon.interval]);
    if (st.thornRoot > 0) src.push([st.thornRoot, cd1]); // Thornburst: a foe entering the caltrops is rooted
    if (st.knights > 0) src.push([st.knightStun, 1]); // Bone Knights stun a foe at most once per second
    if (p.cls === 'bell') { // Peal, Ground Breaker's smash and the Tether Hook landing (each cast), Wrecking Ball shocks (each Heavy Strike), Grounded discharges (every 4th strike, at most once a second)
      const N = St.skillNums('peal', st), w = m.weapon;
      src.push([N.p.wave.stun + st.pealStun, cd2]);
      if (st.smashStun > 0) src.push([st.smashStun, cd1]);
      if (st.hook > 0) src.push([st.hookStun, cd1]);
      if (st.wreckStun > 0 && w.heavy > 0) src.push([st.wreckStun, 1 / (w.aps * w.heavy)]);
      if (st.rodStun > 0) src.push([st.rodStun, Math.max(1, 4 / w.aps)]);
    }
    for (const [d, cd] of src) stun += Math.min(1, d / Math.max(cd, d + C.STUN_DR));
    out.hard = Math.min(1, stun); // hard stuns only: the conditional damage rows read this
    // control that is not a stun counts at its strength: a slow of s over a share of the time, a blind (the foe never starts an attack) or a taunt as a full stun, each for the share of the time it holds
    const ctl = (s, dur, cd) => s * Math.min(1, dur / Math.max(dur, cd));
    if (st.volleySlow > 0) stun += ctl(st.volleySlow, C.VOLLEY_SLOW_T, cd1); // Scattershot arrows
    if (st.caltrops > 0) stun += ctl(C.CALTROP_SLOW, St.skillNums('volley', st).p.caltrops.dur, cd1);
    if (st.rainHail > 0) { const N = St.skillNums('rain', st); stun += ctl(C.HAIL_SLOW, N.p.tick.dur + (N.p.shower.on ? N.p.shower.dur : 0), cd2); } // Hail of Thorns: the Rain and its Second Shower
    if (st.phoenixSlow > 0) stun += ctl(st.phoenixSlow, st.phoenixDur, cd1);
    if (st.afterimage > 0) { const N = St.skillNums('step', st), b = (N.p.mirror.on ? N.p.mirror : N.p.after).blind; stun += ctl(1, b, Math.max(C.BLIND_CD, cd1)); } // the burst blinds a foe b seconds, at most once per BLIND_CD
    if (st.veilBlind > 0) { const N = St.skillNums('vanish', st), b = N.p.blind.dur; stun += SMOKE_HIT * (ctl(1, b, N.cdEff) + (st.shroud ? ctl(0.6, N.p.smoke.dur, N.cdEff) : 0)); } // Veil of Night: the smoke blinds (and with Shroud slows) the foes inside
    if (st.dkTaunt > 0) stun += DK_UP; // Death Knight: foes within its reach go for it while it stands
    if (st.shackle > 0) stun += HOOK_HIT * ctl(0.5, st.shackle, cd1); // Anchor Chain: hooked foes slowed 50%
    out.stun = Math.min(1, stun);
    return out;
  }

  // ---- conditional damage: the ED.COND_DMG rows a build owns count at an assumed uptime (the bonus is additive with the Damage stat) ----
  const COND_NOTE = 'conditional damage at assumed uptimes: execute 30% of the time; burning, bleeding, chilled, envenomed, doomed 60-90% when the build applies it; stunned = the stun uptime; Brand = the ailments the build keeps up (at most 4); unknown rows 50%';
  function ailmentsKept(st, d) {
    let n = 0;
    for (const id of ED.ELEMENT_IDS) if (st[ED.ELEMENTS[id].inf] > 0) n += 0.7; else if (st.element === id) n += 0.5;
    if (st.bleed > 0 || st.bleedAll > 0 || st.masterstroke) n += 0.7;
    return Math.min(4, n + (d ? d.hard : 0) + (st.seal > 0 ? 1 : 0));
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
      case 'opportunist': return Math.min(1, d.hard + (has('iceInfuse') ? 0.3 : 0));
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
  // Foe vulnerability a skill card sets, as a factor on every hero hit: Hunter's Mark (+markV from every hero while the Volley's mark lasts), Hail of Thorns (+20% inside the Rain; the Rain's own hits already carry it, a small double count)
  // and Hallowed Ground (+20% inside Sanctuary on the share the Hammer's own Judged leaves open). MARK_HIT / RAIN_HIT / SANCT_HIT: share of the time a foe stands marked / in the Rain / in the Sanctuary.
  const MARK_HIT = 0.8, RAIN_HIT = 0.75, SANCT_HIT = 0.8;
  function vulnK(p) {
    const st = p.stats; let v = 0;
    if (st.markV > 0) v += st.markV * MARK_HIT * Math.min(1, st.volleyMark / St.skillNums('volley', st).cdEff);
    if (st.rainHail > 0) { const N = St.skillNums('rain', st); v += 0.2 * RAIN_HIT * Math.min(1, (N.p.tick.dur + (N.p.shower.on ? N.p.shower.dur : 0)) / N.cdEff); }
    if (st.sanctJudge > 0) { const N = St.skillNums('sanctuary', st), hammer = Math.min(1, (4 + st.judgeDur) / St.skillNums('judgment', st).cdEff) * SANCT_HIT; v += 0.2 * SANCT_HIT * Math.min(1, N.p.zone.dur / N.cdEff) * (1 - hammer); }
    return 1 + v;
  }
  // The factor on hero hit damage: (Damage + sum of the owned conditional bonuses x uptime x dmgX) / Damage, times Judging Light's Judged window and the vulnerability the cards set.
  function condFactor(p, m, d) {
    const st = p.stats; let sum = 0;
    for (const r of ED.COND_DMG) {
      if (r.key === 'classElMul') continue; // already in the class-skill hits of the sheet
      if (r.key !== null ? !(st[r.key] > 0) : !(r.own && r.own(st))) continue;
      const id = r.key || r.id, v = id === 'idol' ? 0.1 : r.value ? r.value(st) : st[r.key];
      sum += v * uptime(id, st, m, d);
    }
    if (m.weapon._mom) sum += st.momentum * m.weapon._mom.avg; // Momentum: the stacks a hit sees on average (ED.Sheet shadeForms)
    const holy = m.mult.status.find(s => s.el === 'holy'), smites = !!(holy && holy.est.dps > 0);
    if (st.guardLight > 0 && smites) sum += st.guardLight * GL_UP;
    return (Math.max(0.1, st.dmg) + sum * st.dmgX) / Math.max(0.1, st.dmg) * judgeLight(p, m, smites) * vulnK(p); // the bonuses carry the Ascended damage factor (combat.js hitEnemy)
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
