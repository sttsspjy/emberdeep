// Derives a hero's stat block from class, weapon, Hearth upgrades, mastery, pact, boons and relics.
// Pure and deterministic: the host and each client compute identical numbers from the same build.
(function (ED) {
  'use strict';
  const U = ED.U;
  const St = ED.Stats = {};

  // ATK_FLOOR / ATK_FLOOR_SHOT: shortest attack interval (s) of a weapon and extra per projectile of one attack; attack speed beyond it becomes weapon damage.
  // FLOW_SPD / FLOW_T: Swift forks give +15% move speed for 0.5 s after each attack. ROUTE_CDR_MAX: cap of a route's cooldown cut (s1Cdr, s2Cdr), applied after the soft cap.
  Object.assign(ED.CONST, { ATK_FLOOR: 0.12, ATK_FLOOR_SHOT: 0.06, FLOW_SPD: 0.15, FLOW_T: 0.5, ROUTE_CDR_MAX: 0.4 });

  // Stat keys of the class routes (docs/GAME-DESIGN.md section 5): slot stats first, then one group per class, all 0 until a card sets them.
  const ROUTE_KEYS = ('s1Dmg s1Area s1Dur s1N s1Cdr s1Range s2Dmg s2Area s2Dur s2N s2Cdr s2Range s3Dmg s3Area s3Dur s3N s3Cdr s3Range s3Ch wDmg bleedAll'
    + ' cleave cleaveN cShock cStun chargeCleave parry riposte brace braceDR braceAura jugShock bash rally chargeStun gather shieldWall wallStun sendBack bastionWard ruinInf carry ruinSpread brand seal'
    + ' deadeye pierceRamp splitBolt hitSlow flurry flurryMul volleySlow volleyClose volleyHop caltrops volleyMark markV markLeap skyfall skyTwin rainHail shower skillInfK festerHit contagion contagionR contagionN'
    + ' emberMul spark sparkMax flashfire pyreBolt afterburn afterN chainCast stormT novaEcho novaPull novaRing mantle mantleBurst twinMeteor meteorites comet cometStun wInfFire searSkill flashT heatEngine heatChain'
    + ' momentum momMax execCrit execMom bladeStorm stepCrit stepStack stackMax assassinate stepTwin afterimage afterPull smokeVuln stealthSpd stealthDur ambushMul nightsEdge ambushCleave veil veilBlind shroud veins exsang rupture bloodbloom'
    + ' supernova supernovaPull phoenixMul phoenixDur dashTrail cataclysm sunDive diveTrail blossom blossomN blossomMax mirrorHall eclipse eclipseDur umbral cloneMul'
    + ' waveEvery waveMul waveBig waveStun waveBurst waveHome litany sanctHeal sanctDR sanctStun sanctJudge aura auraDmg judgeDur judgeWeak twinHammer thirdLeg secondFlight verdict verdictJudge wInfHoly smiteBig guardLight smiteJudge smiteBeam beamJumps'
    + ' hex hexMul wRaise hexSpread hexSelf hexHaste spikeRaise knights knightLife knightStun harvestRaise corpse corpseMul boneLance harvestHeal boneArmor boneCap boneField minionInfuse mInfShadow tollMul abyssMin abyssDoom reapRaise tideMul'
    + ' wrath wrathNova wrathPillar dawn aegisR aegisDR aegisStun storm stormMul fjEcho fjR fjStun bloom bloomField bloomBomb dk dkMul dkArc dkTaunt carrionN carrionShard lich lichT lichMul lichLife'
    + ' avalanche avaCrack avaStun phalanx bannerSlow bannerWeak bannerDur tempest vortexMul vortexDur bastion deathMark deathWave thornburst thornRoot starfall thornstorm'
    + ' bannerDmg thornMul thornR phoenixSlow shroudDmg aegisMul craterMul'
    + ' fissure bladeWave doombrand brandMark brandCap bloodquake bloodquakeMul bloodquakeSplash'
    + ' siege siegeMul siegeBlast ricochet flurryN hemo hemoAt hemoMul hemoBoss plague plagueBurst outbreak'
    + ' wake waveReturn sunstrike prismN prismRad'
    + ' whiteHot whiteT heatMax infernoMul'
    + ' graveBolt graveN soulStorm maw mawHaste tideFree tideCap tideDoom'
    + ' guillotine cyclone arterial arterialN cascade cascadeN'
    + ' fullSwing fullR wreck wreckStun hurlCarry demolish haulAcc slipstream perpetual windCap leapR wrecker smashStun wreckSpin spinDur hookShield leapIfr hookPull shackle shackleWeak'
    + ' clap pealEcho tollN tollBolt pealSwat pealShield pealCap pealStun wardDur wardWeak wInfLightning rod rodStun stormBolt chainArc arcN tollStorm').split(' ');

  const BASE = () => {
    const s = {
      hp: 0, hpMul: 1, armor: 0, spd: 1, dmg: 1, atk: 1, crit: 0, critDmg: 0, cdr: 0,
      pickup: 0, xp: 0, gold: 0, luck: 0, heal: 0, projN: 0, pierce: 0, area: 0, dodge: 0, thorns: 0,
      dashN: 0, dashBomb: 0, execute: 0,
      guardian: 0, trance: 0,
      charges: 0,
      minions: 0, minionDmg: 0, boneSpikes: 0, phoenix: 0, strataHeal: 0, wardrum: 0,
      homing: 0, meleeReach: 0, mirror: 0, choices: 0, idol: 0, vuln: 0, banner: 0, angel: 0,
      chalice: 0, emberBonus: 0, discount: 0, stone: 0, cloverRerolls: 0, aegis: 0, light: 0, markup: 0, reviveK: 0, noRest: 0,
      // status route hooks (+X% to every status amount the hero applies; +X% to class-element skill hits)
      statusPow: 0, classElMul: 0,
      // path engines (src/sim/elements.js): Flame, Frost, Storm, Steel (Bleed, crits and the finisher), the cross-path cards; holy and shadow are class-only elements
      fireInfuse: 0, burnMul: 0, burnCap: 0, wildfire: 0, smother: 0, pyre: 0, pyrePass: 0, pyreMul: 0, pyreR: 0, pyreWeak: 0, scorch: 0,
      iceInfuse: 0, chillMul: 0, shatter: 0, shatterSplash: 0, freezeDur: 0, chillWeaken: 0, glacier: 0, coldCycle: 0, zeroFreeze: 0, rime: 0, frozenVuln: 0,
      lightningInfuse: 0, shockMul: 0, jumps: 0, jumpR: 0, arcStun: 0, chargeHold: 0, ground: 0, arcFlash: 0, galv: 0, capacitor: 0, capKeep: 0,
      holyInfuse: 0, smiteMul: 0, smiteShield: 0.01, holyCap: 0.06, // smiteShield and holyCap start at the base every hero smites with
      shadowInfuse: 0,
      bleed: 0, bleedMul: 0, lacerate: 0, sunder: 0, opportunist: 0, masterstroke: 0, twinEvery: 0, critBig: 0, killEdge: 0,
      thermal: 0, plasma: 0, supercon: 0, critBurn: 0, icebreak: 0, critDis: 0,
    };
    for (let i = 0; i < ROUTE_KEYS.length; i++) s[ROUTE_KEYS[i]] = 0;
    return s;
  };

  // Skill cooldown reduction: full up to CDR_SOFT, half above it, never more than CDR_MAX.
  St.CDR_SOFT = 0.4; St.CDR_MAX = 0.65;
  St.cdrEff = (c) => (c <= St.CDR_SOFT ? Math.max(0, c) : Math.min(St.CDR_MAX, St.CDR_SOFT + (c - St.CDR_SOFT) * 0.5));

  // Edits a weapon copy with a class card's weapon.extra: mul { field: factor }, add { field: n }, ifNone { field: value } (sets a field the weapon lacks).
  function applyExtra(w, ex) {
    if (ex.mul) for (const k in ex.mul) if (typeof w[k] === 'number') w[k] *= ex.mul[k];
    if (ex.add) for (const k in ex.add) w[k] = (w[k] || 0) + ex.add[k];
    if (ex.ifNone) for (const k in ex.ifNone) if (!w[k] && !(k === 'wave' && w.ring)) w[k] = Object.assign({}, ex.ifNone[k]); // a ring weapon's ring stands in for the wave
  }

  const NO_MODS = Object.freeze({}); // the mods of a source with no stat side
  // Every source of a stat block, in the order the stat block adds them: [{ kind, id, label, mods, n, rank?, card?, x? }]; a source adds mods[key] x n to its key.
  // Order: class, Hearth upgrades, mastery levels, pacts, boons (insertion order), relics, Philosopher's Stone per relic held, reward health, a full Grail. A class card (card: true) carries its totals at `rank`
  // (n is 1) and compounds slot damage. build: { cls, weapon, boons: {id: n}, relics: [id], meta: { up: [], mastery }, pact, chaliceHp, bonusHp }.
  St.sources = (build) => {
    const cls = ED.CLASSES[build.cls], meta = build.meta || { up: [], mastery: 1 }, out = [];
    out.push({ kind: 'class', id: build.cls, label: cls.name, mods: { hp: cls.hp, armor: cls.armor, crit: cls.crit, dodge: cls.dodge || 0 }, n: 1 });
    for (const u of ED.UPGRADES) {
      const n = u.mods && meta.up && meta.up[ED.UPGRADE_IDX[u.id]] || 0;
      if (n > 0) out.push({ kind: 'hearth', id: u.id, label: u.name + ' ' + n, mods: u.mods, n });
    }
    const ml = meta.mastery || 1;
    for (const l in ED.MASTERY_MODS) if (ml >= +l) out.push({ kind: 'mastery', id: 'mastery' + l, label: 'Mastery ' + l, mods: ED.MASTERY_MODS[l], n: 1 });
    const pact = build.pact || 0;
    for (let i = 1; i <= pact && i < ED.PACTS.length; i++) if (ED.PACTS[i].mods) out.push({ kind: 'pact', id: 'pact' + i, label: 'Pact ' + i + ': ' + ED.PACTS[i].name, mods: ED.PACTS[i].mods, n: 1 });
    const boons = build.boons || {};
    for (const id in boons) {
      const b = ED.BOONS[id], n = boons[id];
      if (!b || !(n > 0)) continue;
      if (!b.route) { out.push({ kind: 'boon', id, label: b.name + (n > 1 ? ' ×' + n : ''), mods: b.mods, n }); continue; }
      if (b.cls !== build.cls) continue;
      out.push({ kind: 'card', id, label: ED.cardName(id, n) + (n > 1 ? ' ×' + n : ''), mods: ED.cardTotals(b, n), n: 1, rank: n, card: true }); // card total per rank: mods + up x (rank - 1) + r2 + r3
    }
    const relics = build.relics || [];
    for (const id of relics) if (ED.RELICS[id]) out.push({ kind: 'relic', id, label: ED.RELICS[id].name, mods: ED.RELICS[id].mods || NO_MODS, n: 1 }); // a relic with no stat side has no mods
    if (relics.indexOf('stone') >= 0) out.push({ kind: 'relic', id: 'stone', label: ED.RELICS.stone.name + ' (per relic)', mods: ED.RELICS.stone.perRelic, n: ED.heldRelics(relics) }); // curses do not count
    if (build.chaliceHp) out.push({ kind: 'reward', id: 'chalice', label: 'Grail of Ages kills', mods: { hp: build.chaliceHp }, n: 1 });
    if (build.bonusHp) out.push({ kind: 'reward', id: 'vigor', label: 'Vigor rewards', mods: { hp: build.bonusHp }, n: 1 });
    if (relics.indexOf('chalice') >= 0 && (build.chaliceHp || 0) >= ED.RELICS.chalice.full.hp) out.push({ kind: 'relic', id: 'chalice', label: ED.RELICS.chalice.name + ' (full)', mods: ED.RELICS.chalice.full.mods, n: 1 });
    return out;
  };

  // The contributions to stat `key` of every source: [{ kind, id, label, v, rank? }], preceded by a Base row (v 1) for the multiplicative stats. Slot damage (s1Dmg, s2Dmg) lists each card's factor part; the stat compounds them.
  const BASE_ONE = { dmg: 1, atk: 1, spd: 1, hpMul: 1 };
  St.breakdown = (build, key) => {
    const rows = [], src = St.sources(build);
    if (BASE_ONE[key]) rows.push({ kind: 'base', id: 'base', label: 'Base', v: BASE_ONE[key] });
    for (const r of src) {
      const m = r.mods[key];
      if (m) rows.push({ kind: r.kind, id: r.id, label: r.label, v: m * r.n, rank: r.rank });
    }
    return rows;
  };

  // Healing factor of the pacts up to level `pact` (ED.PACTS[i].heroMul.heal multiplies healMul).
  const pactHeal = (pact) => {
    let m = 1;
    for (let i = 1; i <= pact && i < ED.PACTS.length; i++) if (ED.PACTS[i].heroMul && ED.PACTS[i].heroMul.heal) m *= ED.PACTS[i].heroMul.heal;
    return m;
  };
  St.pactHeal = pactHeal;

  St.compute = (build) => {
    const cls = ED.CLASSES[build.cls];
    const base = ED.WEAPONS[build.weapon];
    const s = BASE();
    let m1 = 1, m2 = 1, m3 = 1, fork = null; // slot damage compounds card by card (each card's text is its exact factor)
    const extras = [];
    let hold = null;
    for (const r of St.sources(build)) {
      if (!r.card) { for (const k in r.mods) s[k] = (s[k] || 0) + r.mods[k] * r.n; if (r.kind === 'boon' && ED.BOONS[r.id].hold) hold = ED.BOONS[r.id].hold; continue; }
      const tot = r.mods;
      for (const k in tot) {
        if (k === 's1Dmg') m1 *= 1 + tot[k]; else if (k === 's2Dmg') m2 *= 1 + tot[k]; else if (k === 's3Dmg') m3 *= 1 + tot[k]; else s[k] = (s[k] || 0) + tot[k];
      }
      const b = ED.BOONS[r.id];
      if (b.weapon) { if (b.weapon.kind && !fork) fork = r.id; if (b.weapon.extra) extras.push(b.weapon.extra); }
    }
    s.s1Dmg = m1 - 1; s.s2Dmg = m2 - 1; s.s3Dmg = m3 - 1;

    const out = s;
    out.power = cls.power; out.element = cls.element || null; // Class Power scales every non-attack proc (ED.procDmg)
    out.hold = hold; // the hold-attack verb of an owned card (St.HOLD), or null
    out.maxHp = Math.max(5, Math.round(s.hp * Math.max(0.3, s.hpMul)));
    out.moveSpeed = cls.spd * U.clamp(s.spd, 0.5, 2.2);
    // weapon: the fork transform of an owned attack fork, card extras, wDmg, and the attack-interval floor (speed beyond the floor becomes damage)
    const fw = fork ? ED.forkWeapon(build.weapon, fork) : base, kind = fork ? ED.BOONS[fork].weapon.kind : null;
    const w = Object.assign({}, fw);
    if (w.cloud) w.cloud = Object.assign({}, w.cloud);
    for (let i = 0; i < extras.length; i++) applyExtra(w, extras[i]);
    const C = ED.CONST, shots = w.kind === 'proj' ? (w.n || 1) + s.projN : 1, floor = Math.max(C.ATK_FLOOR, C.ATK_FLOOR_SHOT * shots);
    if (s.pyreBolt > 0 && w.kind === 'proj') w.explode = w.explode ? Object.assign({}, w.explode, { mul: w.explode.mul + s.pyreBolt }) : { r: C.PYRE_R, mul: s.pyreBolt }; // Pyre Bolt (Kindling rank 3): a shot without a blast gains one, a blast gains pyreBolt of the hit
    const raw = w.rate / Math.max(0.3, s.atk), over = Math.max(1, floor / raw);
    w.dmg = w.dmg * (1 + s.wDmg) * over;
    if (w.cloud) w.cloud.dps = w.cloud.dps * (1 + s.wDmg) * over;
    out.atkInterval = Math.max(floor, raw); out.atkFloor = floor; out.atkOver = over;
    out.weapon = w; out.weaponId = fork ? build.weapon + '@' + kind : build.weapon;
    out.baseWDmg = base.dmg * (1 + s.wDmg); out.critK = base.rate / fw.rate; // critK: crit-stack grants scale with the fork's attack rate (a Heavy hit is worth more crits' damage)
    out.heavy = kind === 'heavy'; out.swift = kind === 'swift';
    const cdr = St.cdrEff(s.cdr), rc = (n) => 1 - Math.min(C.ROUTE_CDR_MAX, s['s' + n + 'Cdr']);
    out.skillCd = ED.SKILLS[cls.skill].cd * (1 - cdr) * rc(1);
    out.skill2Cd = cls.skill2 && ED.SKILLS[cls.skill2] ? ED.SKILLS[cls.skill2].cd * (1 - cdr) * rc(2) : 0;
    const k3 = cls.skill3 && ED.SKILLS[cls.skill3]; // skill 3: recharge seconds per charge and its charges (0 for a class without one)
    out.skill3Cd = k3 ? k3.cd * (1 - cdr) * rc(3) : 0; out.skill3Charges = k3 ? (k3.charges || 1) + s.s3Ch : 0;
    out.dashCd = 1.5; out.dashCharges = Math.min(2, 1 + s.dashN); // recharge seconds per charge, max charges (base 1, cap 2)
    out.pickupR = 46 * (1 + s.pickup);
    out.critMult = 1.75 + s.critDmg;
    out.crit = Math.min(0.95, s.crit);
    out.dodge = Math.min(0.6, s.dodge);
    out.healMul = (1 + s.heal) * pactHeal(build.pact || 0);
    out.maxCharges = 1 + (s.charges > 0 ? 1 : 0);
    out.maxMinions = 3 + s.minions;
    out.lightR = 200 * (1 + s.light);
    out.evo = ED.evoOf ? ED.evoOf(build.boons || {}) : null;
    out.kind = w.kind;
    out.melee = w.kind === 'melee';
    return out;
  };

  // Damage-reduction from armor: 60 armor halves incoming damage.
  St.armorMul = (armor) => 60 / (60 + Math.max(0, armor));

  // Dynamic rates. Attack interval = max(stats.atkFloor, stats.atkInterval / attackRate(p)); movement speed = stats.moveSpeed * moveRate(p).
  // War Drum (wardrum) doubles in elite and boss rooms (p.toughRoom). Temporary speed is capped by the floor, never turned into damage.
  St.attackRate = (p) => {
    const s = p.stats;
    return 1 + (p.tranceT > 0 ? s.trance : 0) + s.wardrum * (p.toughRoom ? 2 : 1);
  };
  St.attackInterval = (p) => Math.max(p.stats.atkFloor, p.stats.atkInterval / St.attackRate(p));
  // Combo weapons (weapon.combo): the weapon of step k (dmg, range and arc times the step's factors; cached on the stat block), the step hero p attacks with next at time `now`
  // (0 after an idle longer than the combo's reset, at least 1.25 x the longest step interval) and the interval after its last attack (the step's share of the mean interval).
  St.stepWeapon = (st, k) => {
    const w = st.weapon, c = w.combo;
    if (!c) return w;
    const cw = st.cw || (st.cw = []);
    if (cw[k]) return cw[k];
    const q = c.steps[k] || {}, o = Object.assign({}, w, { step: k, pose: q.pose || null });
    if (q.mul) o.dmg = w.dmg * q.mul;
    if (q.range && o.range) o.range = w.range * q.range;
    if (q.arc && o.arc) o.arc = Math.min(6.3, w.arc * q.arc);
    return (cw[k] = o);
  };
  St.comboNext = (p, now) => {
    const c = p.stats.weapon.combo;
    if (!c) return 0;
    const idle = Math.max(c.reset, 1.25 * St.attackInterval(p) * Math.max.apply(null, c.iv));
    return p.comboAt === undefined || now - p.comboAt > idle ? 0 : ((p.comboK | 0) + 1) % c.steps.length;
  };
  St.stepInterval = (p) => { const c = p.stats.weapon.combo; return St.attackInterval(p) * (c ? c.iv[p.comboK | 0] || 1 : 1); };
  // Move rate: Flow (Swift forks, p.flowT) and the unseen speed of Nightfall (stealthSpd while p.stealthT), times the slow of a held verb (p.holdOn: St.HOLD[st.hold].slow) and of a raised Bulwark (BULWARK_SLOW).
  St.BULWARK_SLOW = 0.5;
  St.moveRate = (p) => {
    const s = p.stats, h = p.holdOn && s.hold ? St.HOLD[s.hold] : null;
    return (1 + (p.flowT > 0 ? ED.CONST.FLOW_SPD : 0) + (p.stealthT > 0 ? s.stealthSpd : 0)) * (h && h.slow ? 1 - h.slow : 1) * (p.bulwarkOn ? 1 - St.BULWARK_SLOW : 1);
  };
  // Hold-attack verbs (stats.hold, set by a card's hold field): the client starts one once attack is held `at` s (normal attacks stop) and ends it on release. max: the verb ends itself after max s (0: until release);
  // full: seconds of holding (from the start) to a full charge (lance, finisher; the finisher's full is FULL_EVO with Masterwork Arms); slow: share of move speed lost while it runs. Bell weapons fire them on a full-wind hurl (class-bell.js).
  St.HOLD = { cone: { at: 0.35, max: 2, slow: 0.4 }, lance: { at: 0.35, full: 0.6 }, storm: { at: 0.35, max: 2, slow: 0.4 }, finisher: { at: 0.35, full: 1 } };
  St.FULL_EVO = 0.7;
  St.holdFull = (st) => (st.hold === 'finisher' && st.evo === 'general' ? St.FULL_EVO : (St.HOLD[st.hold] && St.HOLD[st.hold].full) || 0);

  // Numbers of a skill for a stat block, the one source for the sim, the sheet and the bots. Returns
  // { id, slot, aim, range, rangeMin, move, cd, cdEff, parts: [{id, label, on, dmg, r, dur, n, count, ...the part's data}], p: {partId: part} } (cached on st).
  // Parts also carry the sheet fields raw (dmg), noCrit, selfVuln (the vulnerability the part sets before its own hit) and oneFoe (hits on one foe per cast; undefined for a fan and for a per-minion part, which the sheet resolves).
  St.skillNums = (id, st) => {
    const c = st.sn || (st.sn = {});
    if (c[id]) return c[id];
    const sk = ED.SKILLS[id];
    if (!sk) return null;
    const pre = 's' + (sk.slot + 1), A = 1 + 0.5 * st.area, sD = st[pre + 'Dmg'], sA = st[pre + 'Area'], sU = st[pre + 'Dur'], sN = st[pre + 'N'];
    const cdEff = sk.cd * (1 - St.cdrEff(st.cdr)) * (1 - Math.min(ED.CONST.ROUTE_CDR_MAX, st[pre + 'Cdr']));
    let aim = sk.aim, move = sk.move || null;
    if (sk.aimIf) for (const k in sk.aimIf) if (st[k]) aim = sk.aimIf[k];
    if (sk.moveIf) for (const k in sk.moveIf) if (st[k]) move = sk.moveIf[k];
    const out = { id, slot: sk.slot, aim, range: sk.range === undefined ? 0 : sk.range + (sk.rangeAdd ? st[sk.rangeAdd] : 0), rangeMin: sk.rangeMin || 0, move, cd: sk.cd, cdEff, walk: !!sk.walk, parts: [], p: {} };
    if (sk.blockMax) { out.blockMax = sk.blockMax + Math.round(sN || 0); out.blockMul = sk.blockMul + st.gather; out.hold = st[sk.holdKey] > 0 ? st[sk.holdKey] : sk.hold; } // a held skill (Bulwark): blocks that store power, power per block, longest hold
    for (const d of sk.parts) {
      const q = Object.assign({}, d);
      q.on = (!d.if || !!st[d.if]) && !(d.ifNot && st[d.ifNot]); // ifNot: a part another card replaces (Skyfall replaces the Rain ticks)
      let dmg = 0;
      if (d.of) {
        const b = out.p[d.of];
        dmg = b.dmg * (d.mul ? st[d.mul] : 1) * (d.mulFix || 1) * (d.mul1 ? 1 + st[d.mul1] : 1) * (d.times === 'ticks' ? b.count : 1);
      } else if (d.base !== undefined || d.pow !== undefined) {
        const X = d.on === 'W' ? st.weapon.dmg : d.on === 'B' ? st.baseWDmg : st.power;
        dmg = ((d.base || 0) + ((d.pow || 0) + (d.powKey ? st[d.powKey] : 0)) * X) * (1 + sD);
      }
      if (d.mulIf) for (const k in d.mulIf) if (st[k]) dmg *= d.mulIf[k];
      if (d.mulStat && st[d.mulStat] > 0) dmg *= st[d.mulStat]; // mulStat: the stat is a damage factor (Supernova's Burn)
      if (d.mulFirst) for (const k of d.mulFirst) if (st[k]) { dmg *= st[k]; break; } // mulFirst: the first listed stat that is set is the factor (Hammerstorm before Twin Hammers)
      q.dmg = dmg;
      q.r = d.rOf ? out.p[d.rOf].r * d.rMul : d.r ? d.r * A * (1 + sA) * (d.rMul || 1) : 0;
      if (d.rAddKey && q.r > 0) q.r += st[d.rAddKey]; // rAddKey: the stat adds px to the radius after every scaling (Aegis of Dawn, Final Judgment)
      if (d.mulKey) q.mulv = st[d.mulKey];
      if (d.durKey) q.dur = (d.dur || 0) + st[d.durKey]; else if (d.dur !== undefined) q.dur = d.dur + (d.durFix ? 0 : sU); // durFix: a fixed length, no slot duration
      if (d.durMulKey && st[d.durMulKey] > 0 && q.dur !== undefined) q.dur *= st[d.durMulKey]; // durMulKey: the stat is a length factor (Storm of Thorns)
      if (d.durCd && st[d.durCd] && q.dur !== undefined) q.dur = cdEff; // durCd: lasts until the skill is cast again (Bastion)
      if (d.capCd && q.dur !== undefined) q.dur = Math.min(q.dur, d.capCd * cdEff);
      if (d.n !== undefined) q.n = d.n + (d.nFix ? 0 : sN); // nFix: a count the slot's count does not change
      if (d.nOf) q.n = out.p[d.nOf].n; // the count of another part (Death Mark's later waves)
      if (d.nKey) q.n = st[d.nKey]; // nKey: the stat is the count (Death Blossom's cuts)
      if (d.ringKey && st[d.ringKey] > 0) { q.n = st[d.ringKey]; q.fan = U.TAU; q.ring = true; if (d.ringPierce) q.pierce = (d.pierce || 0) + d.ringPierce; } // ringKey: the stat is the arrow count of a full ring (Thornburst), ringPierce the pierce it adds
      if (d.stunKey && st[d.stunKey] > 0) q.stun = st[d.stunKey]; // stunKey: the stat is the stun while it is set
      if (d.perAtk && q.dur !== undefined) q.attacks = Math.floor(q.dur / st.atkInterval + 1e-9) + (d.perAtk === 'skip' ? 0 : 1); // perAtk: one hit per weapon attack from the cast on within dur ('skip': the attack at the cast itself is the Ambush, so only the later ones count)
      if (d.per === 'tick') q.count = Math.round(q.dur / d.every);
      else if (d.per === 'sec') q.count = Math.ceil(q.dur / 0.5 - 1e-9);
      // sheet fields: raw = dmg before the hero multiplier; selfVuln = the vulnerability the part sets before its own hit; oneFoe = hits on one foe per cast (undefined: a fan or a per-minion count the sheet resolves)
      q.raw = dmg; q.noCrit = !!d.noCrit;
      const sv = d.selfVuln;
      q.selfVuln = !sv ? 0 : typeof sv === 'number' ? sv : (!sv.if || st[sv.if]) ? sv.v : 0;
      if (d.perAtk) q.oneFoe = q.attacks;
      else if (d.oneEvery) { q.oneFoe = Math.floor((q.dur || 0) / d.every + 1e-9); if (d.oneMul) for (const k in d.oneMul) if (st[k]) q.oneFoe *= d.oneMul[k]; }
      else if (d.oneFoe !== undefined) { q.oneFoe = d.oneFoe; if (d.oneMul) for (const k in d.oneMul) if (st[k]) q.oneFoe *= d.oneMul[k]; }
      else if (d.perMinion) q.oneFoe = undefined; // one hit per minion: the sheet counts the minions
      else if (d.per === 'tick' || d.per === 'sec') q.oneFoe = q.count;
      else if (d.per === 'minion') q.oneFoe = (q.n || 0) * Math.floor((q.dur || 0) / d.every + 1e-9);
      else if (d.per === 'status') q.oneFoe = 1;
      else if (d.per === 'hit' && !d.fan) q.oneFoe = 1;
      out.parts.push(q); out.p[d.id] = q;
    }
    return (c[id] = out);
  };
})(globalThis.ED || (globalThis.ED = {}));
