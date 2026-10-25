// Boons: level-up choices. mods are added per stack to the stat block (see sim/stats.js).
// rar: c common, r rare, e epic (keystones), l legendary (evolutions). need: 'proj' | 'melee' restricts by weapon kind. cls restricts to a hero (class boons live in classboons.js).
// Path boons: path = owning path, gate (opens the path; a hero owns at most MAX_PATHS gates), key (keystone, needs path affinity >= KEY_AFFINITY), evo (evolution card),
// deep (offered only from that stratum on), cross [pathA, pathB] (no path; offered only to a hero owning both gates, counts toward no affinity),
// open (offered to every hero, never gated, counts toward no affinity), filler (an open stat card: last resort once the hero owns MAX_PATHS paths),
// purse (gold card: only the exhausted-pool fallback offers it; picking it pays the room gold reward to the party gold and records no rank),
// pw { base, k } (a proc damage of base + k x Class Power, see ED.procDmg), hold (the hold-attack verb the card grants: ED.Stats.HOLD).
// Each path is one damage engine (src/sim/elements.js): Steel crits, Bleeds and charges a finisher; Flame stacks Burn that bursts on death; Frost freezes for any hit to Shatter; Storm charges foes until they discharge.
// No path card depends on the dash.
(function (ED) {
  'use strict';
  ED.PATHS = {
    general: { name: 'Steel', color: '#d9dfe8', icon: 'sword', evo: 'Masterwork', verb: 'Crits, Bleed and a charged finisher: the weapon all-in.' },
    fire: { name: 'Flame', color: '#ff7a2a', icon: 'flame', evo: 'Cinder', verb: 'Stack Burn; a burning foe that dies bursts and spreads its fire.' },
    ice: { name: 'Frost', color: '#7fe3ff', icon: 'snow', evo: 'Glacial', verb: 'Freeze foes, then Shatter them with any hit.' },
    lightning: { name: 'Storm', color: '#ffe66b', icon: 'bolt', evo: 'Tempest', verb: 'Charge foes until they discharge and arc to the next.' },
  };
  ED.PATH_IDS = Object.keys(ED.PATHS);
  ED.MAX_PATHS = 2; // path gates a hero owns
  ED.KEY_AFFINITY = 5; // path affinity a keystone needs
  ED.EVO_AFFINITY = 10; // path affinity (with its keystone owned) that unlocks the evolution card
  ED.keyAffinity = () => ED.KEY_AFFINITY;
  ED.evoAffinity = () => ED.EVO_AFFINITY;

  // Element infusion table: stat that sets the strength, status adder on the World, unit of the amount (dmg: the hit's damage; chill: its share of the foe's HP before the stratum lever), the status it builds and its look.
  // Fire, ice and lightning are the path elements; holy and shadow are class-only elements (Cleric, Necromancer: class skill parts and element routes build them).
  ED.ELEMENTS = {
    fire: { inf: 'fireInfuse', add: 'addBurn', unit: 'dmg', status: 'burn', name: 'Flame', color: '#ff7a2a', icon: 'flame' },
    ice: { inf: 'iceInfuse', add: 'addChill', unit: 'chill', status: 'chill', name: 'Frost', color: '#7fe3ff', icon: 'snow' },
    lightning: { inf: 'lightningInfuse', add: 'addCharge', unit: 'dmg', status: 'charge', name: 'Storm', color: '#ffe66b', icon: 'bolt' },
    holy: { inf: 'holyInfuse', add: 'addRadiance', unit: 'dmg', status: 'radiance', name: 'Holy', color: '#fff0c2', icon: 'sun' },
    shadow: { inf: 'shadowInfuse', add: 'addDoom', unit: 'dmg', status: 'doom', name: 'Shadow', color: '#a070ff', icon: 'mask' },
  };
  ED.ELEMENT_IDS = Object.keys(ED.ELEMENTS);
  // Display info (name, color, icon, status, sheet) of a path or an element id, or null.
  ED.pathInfo = (k) => (k && (ED.PATHS[k] || ED.ELEMENTS[k])) || null;

  // Statuses and foe debuffs for the sheet: name, colour, el (the element that tags it), mulKey (the stat that scales its damage), rule (one sentence of what it does; numbers as ED.CONST in src/sim/elements.js).
  ED.STATUS = {
    burn: { name: 'Burn', color: '#ff7a2a', el: 'fire', mulKey: 'burnMul', rule: 'Stacks on the foe (10 at most). Every stack deals its hero\'s Burn value per second for 4 s, whatever added it; a Kindle hero\'s stacks deal double to elites, bosses and champions. A burning foe that dies bursts (Flame): its foes nearby take the Burn it still held and catch half its stacks.' },
    chill: { name: 'Chill', color: '#7fe3ff', el: 'ice', mulKey: 'chillMul', rule: 'Slows the foe (up to 45%) and its wind-ups; a full gauge freezes it (elites 0.75 as long). Bosses never freeze: a full gauge slows them 40% for 2 s and leaves them Brittle.' },
    frozen: { name: 'Frozen', color: '#7fe3ff', el: 'ice', rule: 'A frozen foe cannot act and takes +25% damage. Any hero hit on it Shatters it (Frost): extra damage, chill to the foes around it, and the freeze ends. A Brittle boss Shatters for half.' },
    charge: { name: 'Charge', color: '#ffe66b', el: 'lightning', mulKey: 'shockMul', rule: 'Stored on the foe for 3 s, then fades. At 10% of the foe\'s health (elites 5%, bosses 2%) it discharges for 200% of the charge and jumps to your charged foes within 120.' },
    radiance: { name: 'Radiance', color: '#fff0c2', el: 'holy', mulKey: 'smiteMul', rule: 'Stored light Smites the foe at 12% of its health (elites 6%, bosses 2%) and shields heroes near it.' },
    doom: { name: 'Doom', color: '#a070ff', el: 'shadow', rule: 'A foe whose health falls to its Doom is Reaped. A boss is never Reaped: each time its Doom reaches 5% of its health it Tolls, taking that Doom as damage.' },
    bleed: { name: 'Bleed', color: '#d9dfe8', el: null, mulKey: 'bleedMul', rule: 'Physical: every 0.5 s, 20% of the pool (at least 1) is dealt as damage.' },
    judged: { name: 'Judged', color: '#ffd36b', el: 'holy', rule: 'Takes +20% damage; does not stack with other +20% vulnerability (Hailthorns, smoke).' },
    marked: { name: 'Marked', color: '#ff8a5a', el: null, rule: 'Takes extra damage from every hero.' },
    sundered: { name: 'Sundered', color: '#ffb04a', el: null, rule: 'Takes +4% damage from you per stack (up to 10).' },
    exposed: { name: 'Exposed', color: '#ef5a46', el: null, rule: 'A foe left alive too long takes ×1.5 damage and bleeds health.' },
    ailment: { name: 'Ailments', color: '#d9dfe8', el: null, rule: 'A foe counts one ailment for each of: Burn stacks or a Bleed pool worth 1% of its health; Chill of 25 or more, or Frozen; Charge worth 1% of its health; Radiance a quarter of the way to a Smite; Doom worth 2% of its health; Dazed (stunned or blinded); Sealed. Brand, Open Veins, Contagion and Gangrene read the count (at most 4).' }, // thresholds as World.ailments (combat.js)
  };

  const n1 = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  const per = (pr, el) => (pr.rate && pr.rate[el]) || 0;
  // Sheet readouts per status element. infuse: the stat that sets the status build-up; status: its ED.STATUS id; sheet.rows: stats listed under the status row;
  // sheet.est(proc, st, ref) -> { label, dps? (damage per second the status adds to one foe), one? (the same on an elite or boss, where it differs), secs? (seconds of your damage to its payoff) }.
  // proc.rate[el] = damage per second the hero's hits build into that element (infusion rates and statusPow included), proc.pool[el] = the built-in Burn per second (Nova and Meteor),
  // proc.bleed = Bleed built per second; ref = { hp, statusHp (HP before the stratum lever), r, boss } of a typical foe here.
  const PS = {
    fire: { rows: ['fireInfuse', 'burnMul', 'burnCap', 'wildfire', 'smother', 'pyreMul', 'pyrePass'], est: (pr, st) => { // below the stack cap Burn pays back its build-up x (1 + burnMul); the cap holds BURN_CAP + burnCap stacks of the hero's Burn value
      const C = ED.CONST, input = per(pr, 'fire') + (pr.pool && pr.pool.fire || 0), v = ED.burnValue(st), cap = C.BURN_CAP + st.burnCap, raw = v / (1 + st.burnMul);
      const stacks = raw > 0 ? Math.min(cap, input / raw) : 0, dps = stacks * v, one = dps * (st.pyre > 0 ? C.BURN_BIG : 1); // one: on an elite, boss or champion (Kindle, the only pyre source, doubles it)
      return { label: `Burn adds about ${n1(dps)} damage per second to a foe, ${n1(one)} to an elite or boss (${n1(stacks)} of ${cap} stacks; a stack deals ${n1(v)} per second for ${C.BURN_LIFE} s)`, dps, one, stacks };
    } },
    ice: { rows: ['iceInfuse', 'chillMul', 'freezeDur', 'shatter', 'shatterSplash', 'rime'], est: (pr, st, ref) => { // a Shatter every freeze cycle: one hit at x (1 + shatter), the hits of FREEZE_SET before it at the frozen +25%
      // each freeze raises the foe's next threshold by half (one step decays every RES_T s): the cycle is RES_T over the freezes the chill of RES_T seconds buys
      const C = ED.CONST, RES_T = 6, rate = per(pr, 'ice') / ref.statusHp * C.CHILL_K * (1 + st.chillMul), first = rate > 0 ? 100 / rate : 0;
      let n = 0, need = 0;
      while (rate > 0 && n < 60 && need + 100 * (1 + 0.5 * n) <= rate * RES_T) need += 100 * (1 + 0.5 * n++);
      const secs = n > 0 ? RES_T / n : first, hit = pr.hit || 0, aps = pr.aps || 0, cyc = secs + C.FREEZE_SET;
      const dps = rate > 0 && cyc > 0 ? (hit * st.shatter + (pr.dps || 0) * C.FREEZE_SET * (C.FROZEN_VULN + st.frozenVuln)) / cyc : 0;
      return { label: (rate > 0 ? `Freezes a ${n1(ref.hp)} HP foe in about ${n1(first)} s of your damage, then every ${n1(secs)} s (each freeze raises the next threshold by half)` : 'Builds no chill yet') + `; frozen ${n1(1.6 * (1 + st.freezeDur))} s; the next hit Shatters for +${Math.round(st.shatter * 100)}%` + (dps > 0 ? ` (about ${n1(dps)} per second)` : ''), secs, first, dps: aps > 0 ? dps : 0 };
    } },
    lightning: { rows: ['lightningInfuse', 'shockMul', 'jumps', 'arcStun', 'chargeHold', 'ground'], est: (pr, st, ref) => { // the charge a foe you keep hitting stores discharges at its threshold: DIS_K x (1 + shockMul) of the charge
      const C = ED.CONST, rate = per(pr, 'lightning'), at = ref.hp * (ref.boss ? C.CHARGE_AT.boss : C.CHARGE_AT.trash), secs = rate > 0 ? at / rate : 0, dps = rate * C.DIS_K * (1 + st.shockMul + st.capacitor);
      return { label: (rate > 0 ? `A ${n1(ref.hp)} HP foe discharges every ${n1(secs)} s of your damage, about ${n1(dps)} damage per second` : 'Builds no charge yet') + `; it jumps to your charged foes within ${Math.round(C.DIS_JUMP * (1 + st.jumpR))}`, dps, secs };
    } },
    holy: { rows: ['holyInfuse', 'smiteMul', 'smiteShield', 'holyCap'], est: (pr, st, ref) => {
      const C = ED.CONST, rate = per(pr, 'holy'), at = ref.hp * C.SMITE_AT.trash, secs = rate > 0 ? at / rate : 0, dps = rate * (1 + st.smiteMul);
      return { label: (rate > 0 ? `A Smite every ${n1(secs)} s on a ${n1(ref.hp)} HP foe, about ${n1(dps)} damage per second` : 'Stores no Radiance yet') + `; shield ${n1(Math.min(C.HOLY_GRANT_MAX, st.smiteShield) * 100)}% per Smite, once per ${C.HOLY_CD} s, up to ${n1(st.holyCap * 100)}%`, dps, secs };
    } },
    shadow: { rows: ['shadowInfuse'], est: (pr) => { // Doom marked from your damage: a foe is Reaped once your damage plus its Doom reach its health
      const i = per(pr, 'shadow') > 0 && pr.dps > 0 ? per(pr, 'shadow') / pr.dps : 0, share = 1 / (1 + i);
      return { label: (i > 0 ? `Reaps a foe once you deal ${Math.round(share * 100)}% of its health` : 'Marks no Doom yet') + `; bosses Toll at ${Math.round(ED.CONST.TOLL_AT * 100)}% Doom`, pct: share };
    } },
    general: { rows: ['crit', 'critDmg', 'bleed', 'bleedAll', 'bleedMul', 'lacerate', 'execute', 'critBig'], est: (pr, st, ref) => {
      let dps = (pr.bleed || 0) * (1 + st.bleedMul), pops = 0;
      if (st.hemo > 0 && pr.bleed > 0 && pr.dps > 0) { // Hemorrhage: the pool fills at the Bleed input and drains 40% a second; it pops once it holds hemoAt of the foe's health (a cycle is at least the 1 s cooldown), within the time to kill the reference foe; each pop pays hemoMul x the pool instead of the 1 x the drain would
        const fill = 0.4, at = st.hemoAt * ref.hp, ttk = ref.hp / pr.dps;
        if (fill * at < pr.bleed) {
          const t1 = -Math.log(1 - fill * at / pr.bleed) / fill;
          if (ttk >= t1) { pops = (ttk - t1) / Math.max(1, t1) + 1; dps += pops * at * (st.hemoMul - 1) * (1 + st.bleedMul) / ttk; }
        }
      }
      return { label: `Bleed adds about ${n1(dps)} damage per second to a foe` + (pops > 0 ? `, ${n1(pops)} Hemorrhage pops while a ${n1(ref.hp)} HP foe lasts` : ''), dps, pops };
    } },
  };
  for (const id in ED.ELEMENTS) Object.assign(ED.ELEMENTS[id], { infuse: ED.ELEMENTS[id].inf, sheet: PS[id] });
  for (const id in ED.PATHS) Object.assign(ED.PATHS[id], id === 'general' ? { infuse: 'bleed', status: 'bleed', sheet: PS.general } : { infuse: ED.ELEMENTS[id].inf, status: ED.ELEMENTS[id].status, sheet: PS[id] });
  // The Burn value of a hero: damage per second of one of its Burn stacks (BURN_K x Power x the damage stat x (1 + burnMul)); every stack the hero adds deals this, whatever added it.
  ED.burnValue = (st) => ED.CONST.BURN_K * st.power * Math.max(0.1, st.dmg) * (1 + st.burnMul);

  const B = ED.BOONS = {
    // ---- open: offered to every hero (filler: last resort once a hero owns MAX_PATHS paths) ----
    vigor: { name: 'Vigor', rar: 'c', icon: 'heart', open: true, filler: true, desc: '+{hp} max health and heal 2.', mods: { hp: 2 }, heal: 2, max: 3 },
    purse: { name: 'Purse', rar: 'c', icon: 'coin', open: true, purse: true, desc: '+{gold} gold for the party.', mods: {}, max: 1 },
    plating: { name: 'Plating', rar: 'c', icon: 'shield', open: true, filler: true, desc: '+{armor} armor.', mods: { armor: 3 }, max: 2 },
    focus: { name: 'Focus', rar: 'c', icon: 'hourglass', open: true, desc: 'Skills recharge {cdr} faster.', mods: { cdr: 0.10 }, max: 3 },
    lightstep: { name: 'Light Step', rar: 'c', icon: 'wing', open: true, filler: true, desc: 'Dash: +{dashN} charge.', mods: { dashN: 1 }, max: 1 },
    wide: { name: 'Wide Arcs', rar: 'r', icon: 'arc', open: true, desc: '+{area} area: melee reach, blasts and auras.', mods: { area: 0.15 }, max: 2 },
    evade: { name: 'Evasion', rar: 'r', icon: 'cloak', open: true, filler: true, desc: '+{dodge} chance to dodge attacks.', mods: { dodge: 0.04 }, max: 2 },
    pierce: { name: 'Piercing', rar: 'r', icon: 'arrow', open: true, desc: 'Projectiles pierce +{pierce} foe(s).', mods: { pierce: 1 }, need: 'proj', max: 2 },
    split: { name: 'Split Shot', rar: 'r', icon: 'arrows', open: true, desc: '+{projN} projectile(s) per attack, -{dmg} damage.', mods: { projN: 1, dmg: -0.08 }, need: 'proj', max: 2 },
    echo: { name: 'Echo', rar: 'e', icon: 'twinblue', open: true, desc: 'Your first skill holds a second charge.', mods: { charges: 1 }, max: 1 },
    laststand: { name: 'Last Stand', rar: 'e', icon: 'shieldgold', open: true, desc: 'Falling below 30% health grants 3s of 60% damage reduction (20s cooldown).', mods: { guardian: 1 }, max: 1 },
    trance: { name: 'Battle Trance', rar: 'e', icon: 'drum', open: true, desc: 'Using a skill grants +30% attack speed for 4s.', mods: { trance: 0.3 }, max: 1 },

    // ---- Steel: the weapon all-in (crits, Bleed, the finisher) ----
    generalist: { name: 'Tempered Steel', rar: 'r', icon: 'sword', path: 'general', gate: true, desc: '+{dmg} damage and +{crit} crit chance; crits Bleed for {bleed} of the hit.', mods: { dmg: 0.1, crit: 0.05, bleed: 0.3 }, max: 1 },
    keen: { name: 'Keen Eye', rar: 'c', icon: 'eye', path: 'general', desc: '+{crit} crit chance.', mods: { crit: 0.05 }, max: 3 },
    brutal: { name: 'Brutality', rar: 'r', icon: 'skull', path: 'general', desc: '+{critDmg} crit damage.', mods: { critDmg: 0.25 }, max: 3 },
    lacerate: { name: 'Lacerate', rar: 'r', icon: 'dagger', path: 'general', desc: '+{lacerate} damage to bleeding foes.', mods: { lacerate: 0.12 }, max: 2 },
    execute: { name: 'Executioner', rar: 'r', icon: 'axe', path: 'general', desc: '+{execute} damage to foes below 30% health.', mods: { execute: 0.25 }, max: 2 },
    deepcuts: { name: 'Deep Cuts', rar: 'r', icon: 'blades', path: 'general', desc: 'Bleed deals +{bleedMul}.', mods: { bleedMul: 0.3 }, max: 2 },
    opportunist: { name: 'Opportunist', rar: 'r', icon: 'hand', path: 'general', desc: '+25% damage to stunned, frozen or blinded foes.', mods: { opportunist: 0.25 }, max: 1 },
    sunder: { name: 'Sunder', rar: 'r', icon: 'blades', path: 'general', desc: 'Each crit makes that foe take +4% damage from you per stack (max 10).', mods: { sunder: 1 }, max: 1 },
    heartseeker: { name: 'Heartseeker', rar: 'r', icon: 'eye', path: 'general', deep: 2, desc: 'Crits on elites and bosses deal +{critBig} crit damage.', mods: { critBig: 0.35 }, max: 2 },
    killingedge: { name: 'Killing Edge', rar: 'e', icon: 'dagger', path: 'general', deep: 3, desc: 'A crit that kills a foe (not a horde foe) readies {killEdge*ck} guaranteed crit(s) (up to {killEdge*ck3} stored).', mods: { killEdge: 1 }, max: 1 },
    masterstroke: { name: 'Finisher', rar: 'e', icon: 'sword', path: 'general', key: true, desc: 'Hold attack to charge a finisher (full 1s after the hold starts at 0.35s); release it: a guaranteed crit at x2 damage that Bleeds for 50% of the hit (melee reach +30%). A finisher never Cleaves.', mods: { masterstroke: 1 }, hold: 'finisher', max: 1 },
    evo_general: { name: 'Masterwork Arms', rar: 'l', icon: 'sword', path: 'general', evo: 'general', desc: 'The finisher charges in 0.7s. A finisher on a bleeding foe tears its whole Bleed out at once (its own Bleed too) at x1.5.', mods: {}, max: 1 },

    // ---- Flame: Burn stacks; a burning foe's death bursts and spreads ----
    kindle: { name: 'Kindle', rar: 'r', icon: 'flame', path: 'fire', gate: true, desc: 'Hits add Burn stacks from {fireInfuse} of their damage; each stack deals {burn} per second for 4s (a foe holds 10; elites, bosses and champions take double). A burning foe that dies bursts: foes within 40 (+4 per stack) take half the Burn it still held and catch half its stacks.', mods: { fireInfuse: 0.5, pyre: 1 }, max: 1 },
    stoke: { name: 'Stoke the Flames', rar: 'r', icon: 'flame', path: 'fire', desc: 'Burn deals +{burnMul} damage.', mods: { burnMul: 0.25 }, max: 3 },
    kindling: { name: 'Kindling', rar: 'c', icon: 'ember', path: 'fire', desc: 'Foes hold +{burnCap:flat} of your Burn stacks.', mods: { burnCap: 3 }, max: 2 },
    wildfire: { name: 'Wildfire', rar: 'r', icon: 'flame', path: 'fire', desc: 'A foe holding 5 or more of your Burn stacks passes {wildfire:flat} stack(s) per second to a foe touching it.', mods: { wildfire: 1 }, max: 2 },
    smother: { name: 'Smother', rar: 'c', icon: 'shield', path: 'fire', desc: 'Foes holding 3 or more of your Burn stacks deal {smother} less damage.', mods: { smother: 0.12 }, max: 2 },
    fanflames: { name: 'Fan the Flames', rar: 'r', icon: 'ember', path: 'fire', desc: 'Death bursts pass {pyrePass} more of the stacks.', mods: { pyrePass: 0.25 }, max: 1 },
    scorched: { name: 'Scorched Earth', rar: 'e', icon: 'bomb', path: 'fire', key: true, desc: 'Where a death burst goes off the ground burns for 3s: foes on it gain a Burn stack every 0.5s, and foes that are not elites or bosses walk around it.', mods: { scorch: 1 }, max: 1 },
    backdraft: { name: 'Backdraft', rar: 'r', icon: 'bomb', path: 'fire', deep: 2, desc: 'Death bursts deal +{pyreMul} and reach {pyreR} farther.', mods: { pyreMul: 0.4, pyreR: 0.2 }, max: 2 },
    emberheart: { name: 'Ember Heart', rar: 'e', icon: 'shieldgold', path: 'fire', deep: 3, desc: 'Foes a death burst hits deal {pyreWeak} less damage for 3s.', mods: { pyreWeak: 0.25 }, max: 1 },
    evo_fire: { name: 'Cinder Arms', rar: 'l', icon: 'flame', path: 'fire', evo: 'fire', desc: 'Hold attack for 0.35s to channel a flame cone for up to 2s (melee reach x1.5, ranged 130): 60% of your attack damage per second to every foe in it, Burn x3. You move 40% slower while you channel.', mods: {}, hold: 'cone', max: 1 },

    // ---- Frost: freeze, then Shatter with any hit ----
    frostbite: { name: 'Frostbite', rar: 'r', icon: 'snow', path: 'ice', gate: true, desc: 'Hits chill; full chill freezes a foe for 1.6s (bosses are slowed 40% for 2s and turn Brittle). Frozen foes take +25% damage. Any hit on a foe frozen for 0.2s Shatters it: +{shatter} damage, 40 chill to foes within 60, and the freeze ends (a Brittle boss: half).', mods: { iceInfuse: 1, shatter: 1.5 }, max: 1 },
    deepcold: { name: 'Deep Cold', rar: 'r', icon: 'snow', path: 'ice', desc: '+{chillMul} chill build-up.', mods: { chillMul: 0.4 }, max: 3 },
    shatterpoint: { name: 'Shatterpoint', rar: 'r', icon: 'gem', path: 'ice', desc: 'Shatters deal +{shatter} more and burst for {shatterSplash} of their damage to foes within 60.', mods: { shatter: 1.4, shatterSplash: 0.1 }, max: 2 },
    permafrost: { name: 'Permafrost', rar: 'c', icon: 'shield', path: 'ice', desc: 'Freeze lasts {freezeDur} longer. Chilled foes deal {chillWeaken} less damage.', mods: { freezeDur: 0.3, chillWeaken: 0.1 }, max: 2 },
    glacier: { name: 'Glacier', rar: 'r', icon: 'shield', path: 'ice', desc: 'Frozen foes are solid: other foes cannot push through them and foe shots break on them (heroes, allies and your shots pass).', mods: { glacier: 1 }, max: 1 },
    coldcycle: { name: 'Cold Cycle', rar: 'r', icon: 'hourglass', path: 'ice', desc: 'Each Shatter takes {coldCycle:sec} off your skill cooldowns (at most once per 1.5s).', mods: { coldCycle: 0.4 }, max: 2 },
    absolutezero: { name: 'Absolute Zero', rar: 'e', icon: 'snow', path: 'ice', key: true, desc: 'A Shatter freezes every foe within 60 that is not a boss and was not frozen in the last 6s.', mods: { zeroFreeze: 1 }, max: 1 },
    rimebite: { name: 'Rimebite', rar: 'r', icon: 'gem', path: 'ice', deep: 2, desc: '+{rime} damage to chilled or frozen foes.', mods: { rime: 0.12 }, max: 2 },
    wintersheart: { name: "Winter's Heart", rar: 'e', icon: 'snow', path: 'ice', deep: 3, desc: 'Frozen foes take +{frozenVuln} more damage and stay frozen {freezeDur} longer.', mods: { frozenVuln: 0.25, freezeDur: 0.4 }, max: 1 },
    evo_ice: { name: 'Glacial Arms', rar: 'l', icon: 'snow', path: 'ice', evo: 'ice', desc: 'Hold attack to charge an ice lance (full 0.6s after the hold starts at 0.35s); release to fire it: it pierces every foe for up to 250% weapon damage and freezes foes that are not bosses.', mods: {}, hold: 'lance', max: 1 },

    // ---- Storm: charge with hits until the foe discharges ----
    staticcharge: { name: 'Static Charge', rar: 'r', icon: 'bolt', path: 'lightning', gate: true, desc: "Hits charge foes with {lightningInfuse} of their damage (held 3s, then fading). At 10% of a foe's health (elites 5%, bosses 2%) the charge discharges for 200% of it and jumps to your charged foes within 120, discharging them too.", mods: { lightningInfuse: 0.3 }, max: 1 },
    highvoltage: { name: 'High Voltage', rar: 'r', icon: 'star', path: 'lightning', desc: 'Discharges deal +{shockMul}.', mods: { shockMul: 0.2 }, max: 3 },
    conductor: { name: 'Conductor', rar: 'r', icon: 'bolt', path: 'lightning', desc: 'Discharges jump {jumps:flat} more time(s) and {jumpR} farther.', mods: { jumps: 1, jumpR: 0.3 }, max: 2 },
    overload: { name: 'Overload', rar: 'c', icon: 'magnet', path: 'lightning', desc: 'Discharges stun foes that are not bosses for {arcStun:sec} (elites half), at most once per second per foe.', mods: { arcStun: 0.25 }, max: 2 },
    longfuse: { name: 'Long Fuse', rar: 'c', icon: 'hourglass', path: 'lightning', desc: 'Charge holds {chargeHold:sec} longer before it fades.', mods: { chargeHold: 2 }, max: 2 },
    grounding: { name: 'Grounding', rar: 'c', icon: 'shield', path: 'lightning', desc: 'Charged foes deal {ground} less damage.', mods: { ground: 0.08 }, max: 2 },
    arcflash: { name: 'Arc Flash', rar: 'e', icon: 'bolt', path: 'lightning', key: true, desc: 'Each discharge also arcs to every uncharged foe within 120 for 75% of it and charges them with a quarter of that.', mods: { arcFlash: 1 }, max: 1 },
    galvanize: { name: 'Galvanize', rar: 'r', icon: 'star', path: 'lightning', deep: 2, desc: '+{galv} damage to charged foes.', mods: { galv: 0.1 }, max: 2 },
    capacitor: { name: 'Capacitor', rar: 'e', icon: 'magnet', path: 'lightning', deep: 3, desc: 'Discharges deal +{capacitor} and leave {capKeep} of the charge on the foe.', mods: { capacitor: 0.3, capKeep: 0.3 }, max: 1 },
    evo_lightning: { name: 'Tempest Arms', rar: 'l', icon: 'bolt', path: 'lightning', evo: 'lightning', desc: 'Hold attack for 0.35s to call a storm for up to 2s: every 0.3s a bolt strikes the foe nearest your aim within 220 for 60% of your attack damage per second, charging x3. You move 40% slower while you call it. Discharges jump 2 more times.', mods: { jumps: 2 }, hold: 'storm', max: 1 },

    // ---- cross-path cards: offered only to a hero owning both paths (no affinity) ----
    thermal: { name: 'Thermal Shock', rar: 'r', icon: 'gem', cross: ['fire', 'ice'], desc: 'A Shatter on a burning foe pays out half its Burn at once, x1.5.', mods: { thermal: 1 }, max: 1 },
    plasma: { name: 'Plasma', rar: 'r', icon: 'flame', cross: ['fire', 'lightning'], desc: 'Discharges add Burn from {plasma} of their damage.', mods: { plasma: 0.5 }, max: 1 },
    supercon: { name: 'Superconductor', rar: 'r', icon: 'bolt', cross: ['ice', 'lightning'], desc: 'Discharges deal +{supercon} to chilled or frozen foes.', mods: { supercon: 0.4 }, max: 1 },
    searing: { name: 'Searing Steel', rar: 'r', icon: 'ember', cross: ['general', 'fire'], desc: 'Crits add Burn from {critBurn} of the hit.', mods: { critBurn: 0.4 }, max: 1 },
    icebreaker: { name: 'Icebreaker', rar: 'r', icon: 'axe', cross: ['general', 'ice'], desc: 'Hits on a frozen foe always crit.', mods: { icebreak: 1 }, max: 1 },
    stormblade: { name: 'Stormblade', rar: 'r', icon: 'bolt', cross: ['general', 'lightning'], desc: 'A crit on one of your charged foes discharges it at once.', mods: { critDis: 1 }, max: 1 },
  };
  ED.BOON_IDS = Object.keys(B);
  ED.RARITY = {
    c: { name: 'Common', color: '#cfc6b6', w: 60 },
    r: { name: 'Rare', color: '#6fb2ff', w: 30 },
    e: { name: 'Epic', color: '#c98bff', w: 10 },
    l: { name: 'Legendary', color: '#ffb02e', w: 4 },
  };

  // Gate boon id per path.
  ED.PATH_GATE = {};
  for (const id in B) if (B[id].gate) ED.PATH_GATE[B[id].path] = id;

  // Path of a boon id, or null (open, cross and class boons).
  ED.boonPath = (id) => (ED.BOONS[id] && ED.BOONS[id].path) || null;
  // Sum of ranks owned in a path. Open and cross boons count toward none.
  ED.pathAffinity = (boons, path) => {
    let n = 0;
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.path === path && !b.open) n += boons[id]; }
    return n;
  };
  // Paths whose gate is owned, in pick order.
  ED.gatePaths = (boons) => {
    const out = [];
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.gate && boons[id] > 0 && !out.includes(b.path)) out.push(b.path); }
    return out;
  };
  // The hero's deepest path: the owned gate with the most affinity (first picked on a tie), or null before the start pick.
  ED.mainPath = (boons) => {
    let best = null, bn = -1;
    for (const k of ED.gatePaths(boons)) { const n = ED.pathAffinity(boons, k); if (n > bn) { bn = n; best = k; } }
    return best;
  };
  // Path of the evolution owned in boons, or null.
  ED.evoOf = (boons) => {
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.evo && boons[id] > 0) return b.evo; }
    return null;
  };
  // Highest rank a hero can hold of boon b.
  ED.maxRank = (b) => b.max || 5;
  // Damage of a proc defined as { pw: { base, k } } for a hero with Class Power st.power.
  ED.procDmg = (def, st) => (def.pw.base || 0) + def.pw.k * st.power;
})(globalThis.ED || (globalThis.ED = {}));
