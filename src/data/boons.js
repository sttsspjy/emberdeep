// Boons: level-up choices. mods are added per stack to the stat block (see sim/stats.js).
// rar: c common, r rare, e epic (keystones), l legendary (evolutions). need: 'proj' | 'melee' restricts by weapon kind. cls restricts to a hero (class boons live in classboons.js).
// Path boons: path = owning path, gate (opens the path; a hero owns MAX_ELEMENTS element gates or the Generalist gate), key (keystone, needs path affinity >= keyAffinity),
// evo (evolution card), open (offered to every hero, never gated, counts toward no affinity), openMax (rank cap of a gated boon for a hero that is not a Generalist),
// purse (gold card: only the exhausted-pool fallback offers it; picking it pays the room gold reward to the party gold and records no rank),
// pw { base, k } (a proc damage of base + k x Class Power, see ED.procDmg), hold (the hold-attack verb the card grants: ED.Stats.HOLD).
// Each element is one verb (src/sim/elements.js): Fire stacks Burn and lays burning ground, Ice freezes for a skill to Shatter, Lightning charges for the dash to discharge, Poison weakens and kites through clouds,
// Holy times perfect dodges, Shadow Backstabs; General crits, Bleeds and charges a finisher.
(function (ED) {
  'use strict';
  ED.PATHS = {
    fire: { name: 'Fire', color: '#ff7a2a', icon: 'flame', element: true, evo: 'Cinder', verb: 'Stack Burn and kite foes through burning ground.' },
    ice: { name: 'Ice', color: '#7fe3ff', icon: 'snow', element: true, evo: 'Glacial', verb: 'Freeze foes, then Shatter them with a skill.' },
    lightning: { name: 'Lightning', color: '#ffe66b', icon: 'bolt', element: true, evo: 'Tempest', verb: 'Charge foes, then dash past them to discharge.' },
    poison: { name: 'Poison', color: '#9be33c', icon: 'drop', element: true, evo: 'Venomous', verb: 'Weaken foes with Venom and drag them through clouds.' },
    holy: { name: 'Holy', color: '#fff0c2', icon: 'sun', element: true, evo: 'Hallowed', verb: 'Dash through attacks at the last moment to Smite the attacker.' },
    shadow: { name: 'Shadow', color: '#a070ff', icon: 'mask', element: true, evo: 'Umbral', verb: 'Hit foes from behind to mark Doom and Reap them.' },
    general: { name: 'General', color: '#d9dfe8', icon: 'sword', element: false, evo: 'Masterwork', verb: 'Crits, Bleed and a charged finisher.' },
  };
  ED.PATH_IDS = Object.keys(ED.PATHS);
  ED.ELEMENT_IDS = ED.PATH_IDS.filter(k => ED.PATHS[k].element);
  ED.MAX_ELEMENTS = 2; // element gates a hero owns (the Generalist gate excludes them all)
  ED.KEY_AFFINITY = 5; // path affinity a keystone needs
  ED.EVO_AFFINITY = 10; // path affinity (with its keystone owned) that unlocks the evolution card
  ED.KEY_AFFINITY_GENERAL = 6; ED.EVO_AFFINITY_GENERAL = 12; // the same for the General path
  ED.keyAffinity = (path) => (path === 'general' ? ED.KEY_AFFINITY_GENERAL : ED.KEY_AFFINITY);
  ED.evoAffinity = (path) => (path === 'general' ? ED.EVO_AFFINITY_GENERAL : ED.EVO_AFFINITY);

  // Element infusion table: stat that sets the strength, status adder on the World, unit of the amount (dmg: the hit's damage; chill and venom: its share of the foe's HP before the stratum lever).
  ED.ELEMENTS = {
    fire: { inf: 'fireInfuse', add: 'addBurn', unit: 'dmg' },
    ice: { inf: 'iceInfuse', add: 'addChill', unit: 'chill' },
    lightning: { inf: 'lightningInfuse', add: 'addCharge', unit: 'dmg' },
    poison: { inf: 'poisonInfuse', add: 'addVenom', unit: 'venom' },
    holy: { inf: 'holyInfuse', add: 'addRadiance', unit: 'dmg' },
    shadow: { inf: 'shadowInfuse', add: 'addDoom', unit: 'dmg' },
  };

  // Statuses and foe debuffs for the sheet: name, colour, el (the element that tags it), mulKey (the stat that scales its damage), rule (one sentence of what it does; numbers as ED.CONST in src/sim/elements.js).
  ED.STATUS = {
    burn: { name: 'Burn', color: '#ff7a2a', el: 'fire', mulKey: 'burnMul', rule: 'Stacks on the foe (10 at most). Every stack deals its hero\'s Burn value per second for 4 s, whatever added it.' },
    chill: { name: 'Chill', color: '#7fe3ff', el: 'ice', mulKey: 'chillMul', rule: 'Slows the foe (up to 45%) and its wind-ups; a full gauge freezes it (elites 0.75 as long). Bosses never freeze: a full gauge slows them 40% for 2 s.' },
    frozen: { name: 'Frozen', color: '#7fe3ff', el: 'ice', rule: 'A frozen foe cannot act and takes +25% damage. A hero skill hit on it Shatters it: extra damage and the freeze ends.' },
    charge: { name: 'Charge', color: '#ffe66b', el: 'lightning', mulKey: 'shockMul', rule: 'Stored on the foe for 3 s, then fades. Your dash discharges your charged foes within 50 of its path for 200% of the charge, jumping to your charged foes within 120.' },
    venom: { name: 'Venom', color: '#9be33c', el: 'poison', rule: 'Up to 100. An envenomed foe deals up to 30% less damage, moves up to 30% slower and takes up to 40% of its hero\'s Power per second. At 100 it is Corroded and its guard breaks.' },
    radiance: { name: 'Radiance', color: '#fff0c2', el: 'holy', mulKey: 'smiteMul', rule: 'Stored light Smites the foe at 12% of its health (elites 6%, bosses 2%) and shields heroes near it. A perfect dodge Smites the attacker at once.' },
    doom: { name: 'Doom', color: '#a070ff', el: 'shadow', mulKey: 'doomMul', rule: 'Marked by Backstabs. A foe whose health falls to its Doom is Reaped. A boss is never Reaped: each time its Doom reaches 5% of its health it Tolls, taking that Doom as damage.' },
    bleed: { name: 'Bleed', color: '#d9dfe8', el: null, mulKey: 'bleedMul', rule: 'Physical: every 0.5 s, 20% of the pool (at least 1) is dealt as damage.' },
    judged: { name: 'Judged', color: '#ffd36b', el: 'holy', rule: 'Takes +20% damage; does not stack with other +20% vulnerability (Hailthorns, smoke).' },
    marked: { name: 'Marked', color: '#ff8a5a', el: null, rule: 'Takes extra damage from every hero.' },
    sundered: { name: 'Sundered', color: '#ffb04a', el: null, rule: 'Takes +4% damage from you per stack (up to 10).' },
    exposed: { name: 'Exposed', color: '#ef5a46', el: null, rule: 'A foe left alive too long takes ×1.5 damage and bleeds health.' },
    ailment: { name: 'Ailments', color: '#d9dfe8', el: null, rule: 'A foe counts one ailment for each of: Burn stacks or a Bleed pool worth 1% of its health; Chill of 25 or more, or Frozen; Charge worth 1% of its health; Venom above 25; Radiance a quarter of the way to a Smite; Doom worth 2% of its health; Dazed (stunned or blinded); Sealed. Brand, Open Veins, Contagion and Gangrene read the count (at most 4).' }, // thresholds as World.ailments (combat.js)
  };

  const n1 = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  const per = (pr, el) => (pr.rate && pr.rate[el]) || 0;
  // Sheet readouts per path. infuse: the stat that sets the status build-up; status: its ED.STATUS id; sheet.rows: stats listed under the path's status row;
  // sheet.est(proc, st, ref) -> { label, dps? (damage per second the status adds to one foe), secs? (seconds of your damage to its payoff) }.
  // proc.rate[el] = damage per second the hero's hits build into that element (infusion rates and statusPow included), proc.pool[el] = the built-in Burn per second (Nova and Meteor),
  // proc.bleed = Bleed built per second; ref = { hp, statusHp (HP before the stratum lever), r } of a typical foe here.
  const PS = {
    fire: { rows: ['fireInfuse', 'burnMul', 'burnCap', 'wildfire', 'smother'], est: (pr, st) => { // below the stack cap Burn pays back its build-up x (1 + burnMul); the cap holds BURN_CAP + burnCap stacks of the hero's Burn value
      const C = ED.CONST, input = per(pr, 'fire') + (pr.pool && pr.pool.fire || 0), v = ED.burnValue(st), cap = C.BURN_CAP + st.burnCap, raw = v / (1 + st.burnMul);
      const stacks = raw > 0 ? Math.min(cap, input / raw) : 0, dps = stacks * v;
      return { label: `Burn adds about ${n1(dps)} damage per second to a foe (${n1(stacks)} of ${cap} stacks; a stack deals ${n1(v)} per second for ${C.BURN_LIFE} s)`, dps, stacks };
    } },
    ice: { rows: ['iceInfuse', 'chillMul', 'freezeDur', 'shatter', 'shatterSplash'], est: (pr, st, ref) => {
      const rate = per(pr, 'ice') / ref.statusHp * ED.CONST.CHILL_K * (1 + st.chillMul), secs = rate > 0 ? 100 / rate : 0;
      return { label: (rate > 0 ? `Freezes a ${n1(ref.hp)} HP foe in about ${n1(secs)} s of your damage` : 'Builds no chill yet') + `; frozen ${n1(1.6 * (1 + st.freezeDur))} s; a skill hit Shatters for +${Math.round(st.shatter * 100)}%`, secs };
    } },
    lightning: { rows: ['lightningInfuse', 'shockMul', 'chargeHold', 'arcs', 'arcStun'], est: (pr, st) => { // a dash every dashCd discharges what a foe you keep hitting stored since the last one (DIS_K x the charge)
      const C = ED.CONST, cd = st.dashCd || 1.5, held = per(pr, 'lightning') * Math.min(cd, C.CHARGE_HOLD + st.chargeHold), dis = held * C.DIS_K * (1 + st.shockMul), dps = dis / cd;
      return { label: `A dash every ${n1(cd)} s discharges about ${n1(dis)} damage from a foe you keep hitting (${n1(dps)} per second); it jumps to your charged foes within ${C.DIS_JUMP}`, dps };
    } },
    poison: { rows: ['poisonInfuse', 'venomBuild', 'venomHold', 'venomWeak', 'cloudR'], est: (pr, st, ref) => {
      const C = ED.CONST, rate = per(pr, 'poison') / ref.statusHp * C.VENOM_K * (1 + st.venomBuild), secs = rate > 0 ? 100 / rate : 0;
      return { label: (rate > 0 ? `Full Venom on a ${n1(ref.hp)} HP foe in about ${n1(secs)} s` : 'Builds no Venom yet') + `: it deals ${Math.round((C.VENOM_WEAK + st.venomWeak) * 100)}% less, moves ${Math.round(C.VENOM_SLOW * 100)}% slower and takes ${n1(C.VENOM_DOT * st.power)} per second; fades after ${n1(C.VENOM_HOLD + st.venomHold)} s`, secs, dps: rate > 0 ? C.VENOM_DOT * st.power * C.VENOM_UP : 0 };
    } },
    holy: { rows: ['holyInfuse', 'smiteMul', 'smiteShield', 'holyCap', 'pdWin'], est: (pr, st, ref) => {
      const C = ED.CONST, rate = per(pr, 'holy'), at = ref.hp * C.SMITE_AT.trash, secs = rate > 0 ? at / rate : 0, dps = rate * (1 + st.smiteMul);
      return { label: (rate > 0 ? `A Smite every ${n1(secs)} s on a ${n1(ref.hp)} HP foe, about ${n1(dps)} damage per second` : 'Stores no Radiance yet') + `; a perfect dodge Smites for its Radiance + ${n1(st.pdPow * st.power * (1 + st.smiteMul))}; shield ${n1(Math.min(C.HOLY_GRANT_MAX, st.smiteShield) * 100)}% per Smite, once per ${C.HOLY_CD} s, up to ${n1(st.holyCap * 100)}%`, dps, secs };
    } },
    shadow: { rows: ['shadowInfuse', 'backstab', 'doomMul', 'doomTough', 'deathsEdge'], est: (pr, st) => { // Backstabbing only: a foe is Reaped once your damage plus its Doom reach its health
      const i = per(pr, 'shadow') > 0 ? st.shadowInfuse * (1 + st.doomMul) : 0, share = 1 / (1 + i), big = 1 / (1 + i * (ED.CONST.DOOM_TOUGH + st.doomTough));
      return { label: (i > 0 ? `Backstabbing only, Reaps a foe once you deal ${Math.round(share * 100)}% of its health (elites ${Math.round(big * 100)}%); Backstabs deal +${Math.round(st.backstab * 100)}%` : 'Marks no Doom yet') + `; bosses Toll at ${Math.round(ED.CONST.TOLL_AT * 100)}% Doom`, pct: share };
    } },
    general: { rows: ['crit', 'critDmg', 'bleed', 'bleedAll', 'bleedMul', 'lacerate', 'execute'], est: (pr, st, ref) => {
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
  for (const id in PS) Object.assign(ED.PATHS[id], { infuse: id === 'general' ? 'bleed' : ED.ELEMENTS[id].inf, status: { fire: 'burn', ice: 'chill', lightning: 'charge', poison: 'venom', holy: 'radiance', shadow: 'doom', general: 'bleed' }[id], sheet: PS[id] });
  // The Burn value of a hero: damage per second of one of its Burn stacks (BURN_K x Power x the damage stat x (1 + burnMul)); every stack the hero adds deals this, whatever added it.
  ED.burnValue = (st) => ED.CONST.BURN_K * st.power * Math.max(0.1, st.dmg) * (1 + st.burnMul);

  const B = ED.BOONS = {
    // ---- open: offered to every hero ----
    vigor: { name: 'Vigor', rar: 'c', icon: 'heart', open: true, desc: '+{hp} max health and heal 2.', mods: { hp: 2 }, heal: 2, max: 3 },
    purse: { name: 'Purse', rar: 'c', icon: 'coin', open: true, purse: true, desc: '+{gold} gold for the party.', mods: {}, max: 1 },
    plating: { name: 'Plating', rar: 'c', icon: 'shield', open: true, desc: '+{armor} armor.', mods: { armor: 3 }, max: 2 },
    focus: { name: 'Focus', rar: 'c', icon: 'hourglass', open: true, desc: 'Skills recharge {cdr} faster.', mods: { cdr: 0.10 }, max: 3 },
    lightstep: { name: 'Light Step', rar: 'c', icon: 'wing', open: true, desc: 'Dash: +{dashN} charge(s).', mods: { dashN: 1 }, max: 2 },
    wide: { name: 'Wide Arcs', rar: 'r', icon: 'arc', open: true, desc: '+{area} area: melee reach, blasts and auras.', mods: { area: 0.15 }, max: 2 },
    evade: { name: 'Evasion', rar: 'r', icon: 'cloak', open: true, desc: '+{dodge} chance to dodge attacks.', mods: { dodge: 0.04 }, max: 2 },
    pierce: { name: 'Piercing', rar: 'r', icon: 'arrow', open: true, desc: 'Projectiles pierce +{pierce} foe(s).', mods: { pierce: 1 }, need: 'proj', max: 2 },
    split: { name: 'Split Shot', rar: 'r', icon: 'arrows', open: true, desc: '+{projN} projectile(s) per attack, -{dmg} damage.', mods: { projN: 1, dmg: -0.08 }, need: 'proj', max: 2 },
    bladedash: { name: 'Blade Dash', rar: 'r', icon: 'wingblade', open: true, desc: 'Dashing through foes deals {dashDmg} Power ({dashDmg*P} damage).', mods: { dashDmg: 1.2 }, max: 1 },
    echo: { name: 'Echo', rar: 'e', icon: 'twinblue', open: true, desc: 'Your first skill holds a second charge.', mods: { charges: 1 }, max: 1 },
    laststand: { name: 'Last Stand', rar: 'e', icon: 'shieldgold', open: true, desc: 'Falling below 30% health grants 3s of 60% damage reduction (20s cooldown).', mods: { guardian: 1 }, max: 1 },
    trance: { name: 'Battle Trance', rar: 'e', icon: 'drum', open: true, desc: 'Using a skill grants +30% attack speed for 4s.', mods: { trance: 0.3 }, max: 1 },

    // ---- Fire: Burn stacks and burning ground ----
    kindle: { name: 'Kindle', rar: 'r', icon: 'flame', path: 'fire', gate: true, desc: 'Hits add Burn stacks from {fireInfuse} of their damage; each stack deals {burn} per second for 4s (a foe holds 10). Your dash leaves burning ground for 2s: foes on it gain a stack every 0.5s.', mods: { fireInfuse: 0.35, dashFire: 1 }, max: 1 },
    stoke: { name: 'Stoke the Flames', rar: 'r', icon: 'flame', path: 'fire', desc: 'Burn deals +{burnMul} damage.', mods: { burnMul: 0.2 }, max: 3 },
    kindling: { name: 'Kindling', rar: 'c', icon: 'ember', path: 'fire', desc: 'Foes hold +{burnCap:flat} of your Burn stacks.', mods: { burnCap: 3 }, max: 2 },
    wildfire: { name: 'Wildfire', rar: 'r', icon: 'flame', path: 'fire', desc: 'A foe holding 5 or more of your Burn stacks passes {wildfire:flat} stack(s) per second to a foe touching it.', mods: { wildfire: 1 }, max: 2 },
    smother: { name: 'Smother', rar: 'c', icon: 'shield', path: 'fire', desc: 'Foes holding 5 or more Burn stacks deal {smother} less damage.', mods: { smother: 0.1 }, max: 2 },
    firebreak: { name: 'Firewall', rar: 'r', icon: 'ember', path: 'fire', desc: 'Your burning ground lasts 1s longer, and foes that are not elites or bosses walk around it.', mods: { firebreak: 1 }, max: 1 },
    firewalk: { name: 'Firewalk', rar: 'e', icon: 'bomb', path: 'fire', key: true, desc: 'Dashing through a burning foe copies its Burn stacks (up to {firewalk:flat}) to every foe within 50 of it.', mods: { firewalk: 4 }, max: 1 },
    evo_fire: { name: 'Cinder Arms', rar: 'l', icon: 'flame', path: 'fire', evo: 'fire', desc: 'Hold attack for 0.35s to channel a flame cone for up to 2s (melee reach x1.5, ranged 130): 60% of your attack damage per second to every foe in it, Burn x3. You move 40% slower while you channel. Burn +{burnMul}.', mods: { burnMul: 0.2 }, hold: 'cone', max: 1 },

    // ---- Ice: freeze, then Shatter with a skill ----
    frostbite: { name: 'Frostbite', rar: 'r', icon: 'snow', path: 'ice', gate: true, desc: 'Hits chill; full chill freezes a foe for 1.6s (bosses are slowed 40% for 2s instead). Frozen foes take +25% damage. A skill hit on a frozen foe Shatters it: +{shatter} damage and the freeze ends.', mods: { iceInfuse: 1, shatter: 0.5 }, max: 1 },
    deepcold: { name: 'Deep Cold', rar: 'r', icon: 'snow', path: 'ice', desc: '+{chillMul} chill build-up.', mods: { chillMul: 0.35 }, max: 3 },
    shatterpoint: { name: 'Shatterpoint', rar: 'r', icon: 'gem', path: 'ice', desc: 'Shatters deal +{shatter} more and burst for {shatterSplash} of their damage to foes within 60.', mods: { shatter: 0.5, shatterSplash: 0.25 }, max: 2 },
    permafrost: { name: 'Permafrost', rar: 'c', icon: 'shield', path: 'ice', desc: 'Freeze lasts {freezeDur} longer. Chilled foes deal {chillWeaken} less damage.', mods: { freezeDur: 0.3, chillWeaken: 0.1 }, max: 2 },
    glacier: { name: 'Glacier', rar: 'r', icon: 'shield', path: 'ice', desc: 'Frozen foes are solid: other foes cannot push through them and foe shots break on them (heroes, allies and your shots pass).', mods: { glacier: 1 }, max: 1 },
    coldcycle: { name: 'Cold Cycle', rar: 'r', icon: 'hourglass', path: 'ice', desc: 'Each Shatter takes {coldCycle:sec} off your skill cooldowns (at most once per 0.5s).', mods: { coldCycle: 0.5 }, max: 2 },
    glacierstep: { name: 'Glacier Step', rar: 'e', icon: 'snow', path: 'ice', key: true, desc: 'Your dash raises an ice wall along its path for 2.5s: foes cannot cross it and it stops foe shots.', mods: { iceWall: 1 }, max: 1 },
    evo_ice: { name: 'Glacial Arms', rar: 'l', icon: 'snow', path: 'ice', evo: 'ice', desc: 'Hold attack to charge an ice lance (full 0.6s after the hold starts at 0.35s); release to fire it: it pierces every foe for up to 250% weapon damage and freezes foes that are not bosses. Chill +{chillMul}.', mods: { chillMul: 0.25 }, hold: 'lance', max: 1 },

    // ---- Lightning: charge with hits, discharge with the dash ----
    staticcharge: { name: 'Static Charge', rar: 'r', icon: 'bolt', path: 'lightning', gate: true, desc: 'Hits charge foes with {lightningInfuse} of their damage (held 3s, then fading). Your dash discharges your charged foes within 50 of its path for 200% of their charge; each discharge jumps to your charged foes within 120.', mods: { lightningInfuse: 0.3 }, max: 1 },
    highvoltage: { name: 'High Voltage', rar: 'r', icon: 'star', path: 'lightning', desc: 'Discharges deal +{shockMul}.', mods: { shockMul: 0.2 }, max: 3 },
    conductor: { name: 'Conductor', rar: 'r', icon: 'bolt', path: 'lightning', desc: 'Each discharge also arcs to {arcs:flat} uncharged foe(s) within 120 for 50%.', mods: { arcs: 1 }, max: 2 },
    overload: { name: 'Overload', rar: 'c', icon: 'magnet', path: 'lightning', desc: 'Discharges stun foes that are not bosses for {arcStun:sec} (elites half), at most once per second per foe.', mods: { arcStun: 0.25 }, max: 2 },
    longfuse: { name: 'Long Fuse', rar: 'c', icon: 'hourglass', path: 'lightning', desc: 'Charge holds {chargeHold:sec} longer before it fades.', mods: { chargeHold: 2 }, max: 2 },
    thunderstep: { name: 'Thunderstep', rar: 'r', icon: 'wingblade', path: 'lightning', desc: 'Foes you dash through take {dashDmg} Power ({dashDmg*P} damage) and are charged by it.', mods: { dashDmg: 1, dashCharge: 1 }, max: 1 },
    stormstep: { name: 'Storm Step', rar: 'e', icon: 'bolt', path: 'lightning', key: true, desc: 'A dash aimed at one of your charged foes within 220 blinks you next to it first.', mods: { stormStep: 1 }, max: 1 },
    evo_lightning: { name: 'Tempest Arms', rar: 'l', icon: 'bolt', path: 'lightning', evo: 'lightning', desc: 'A dash that discharges a foe gives the dash charge back (once per 1.5s). Discharges jump 2 more times.', mods: {}, max: 1 },

    // ---- Poison: Venom weakens, clouds kite ----
    envenom: { name: 'Envenom', rar: 'r', icon: 'drop', path: 'poison', gate: true, desc: 'Hits build Venom. Envenomed foes deal up to 30% less damage, move up to 30% slower and take up to 40% Power ({vdot} damage) per second. Your dash leaves a toxic cloud (radius 40, 3s) that builds Venom.', mods: { poisonInfuse: 1, dashCloud: 1 }, max: 1 },
    potency: { name: 'Potent Toxin', rar: 'c', icon: 'potion', path: 'poison', desc: '+{venomBuild} Venom build-up; Venom starts fading {venomHold:sec} later.', mods: { venomBuild: 0.3, venomHold: 1 }, max: 2 },
    enfeeble: { name: 'Enfeeble', rar: 'r', icon: 'skull', path: 'poison', desc: 'At full Venom a foe deals a further {venomWeak} less damage.', mods: { venomWeak: 0.1 }, max: 2 },
    caustic: { name: 'Caustic', rar: 'r', icon: 'drop', path: 'poison', desc: 'Corroded foes take +{corrode} damage from every hero.', mods: { corrode: 0.1 }, max: 2 },
    miasma: { name: 'Miasma', rar: 'c', icon: 'orb', path: 'poison', desc: 'Your toxic clouds are {cloudR} wider and last {cloudT:sec} longer.', mods: { cloudR: 0.25, cloudT: 1 }, max: 2 },
    neurotoxin: { name: 'Neurotoxin', rar: 'r', icon: 'potion', path: 'poison', desc: 'Foes at full Venom wind up 40% slower (bosses 20%).', mods: { neuro: 1 }, max: 1 },
    toxicwake: { name: 'Toxic Wake', rar: 'e', icon: 'leaf', path: 'poison', key: true, desc: 'Walking leaves a small toxic cloud every 40 px (radius 30, 2s) that builds Venom.', mods: { toxicWake: 1 }, max: 1 },
    evo_poison: { name: 'Venomous Arms', rar: 'l', icon: 'drop', path: 'poison', evo: 'poison', desc: 'Hold attack to ready a flask (ready 0.6s after the hold starts at 0.35s); release to lob it at the cursor (up to 240): 150% weapon damage as Poison within 70 and a toxic cloud there for 4s that builds Venom twice as fast.', mods: {}, hold: 'flask', max: 1 },

    // ---- Holy: perfect dodges ----
    consecrate: { name: 'Consecrate', rar: 'r', icon: 'sun', path: 'holy', gate: true, desc: "Hits store 30% of their damage as Radiance; at 12% of a foe's health (elites 6%, bosses 2%) it Smites and shields heroes near it. Perfect dodge: dashing through a foe's attack or shot, or a hit landing within {pdWin:sec} after your dash, Smites the attacker for its Radiance + {pdPow*P} and shields you.", mods: { holyInfuse: 0.3, perfectDodge: 1, pdWin: 0.15, pdPow: 1.5 }, max: 1 },
    zealotry: { name: 'Zealotry', rar: 'r', icon: 'star', path: 'holy', desc: 'Smites deal +{smiteMul}.', mods: { smiteMul: 0.25 }, max: 3 },
    sanctity: { name: 'Sanctity', rar: 'r', icon: 'shieldgold', path: 'holy', desc: 'Smites shield {smiteShield} more; your Holy shield holds up to {holyCap} more.', mods: { smiteShield: 0.0025, holyCap: 0.03 }, max: 2 },
    grace: { name: 'Grace', rar: 'c', icon: 'feather', path: 'holy', desc: 'The perfect dodge window lasts {pdWin:sec} longer after your dash.', mods: { pdWin: 0.1 }, max: 2 },
    swiftgrace: { name: 'Swift Grace', rar: 'r', icon: 'wing', path: 'holy', desc: 'A perfect dodge gives the dash charge back (once per 2s).', mods: { pdRefund: 1 }, max: 1 },
    beacon: { name: 'Beacon', rar: 'r', icon: 'lantern', path: 'holy', desc: 'Smites also strike foes within 70 for {beacon} of their damage.', mods: { beacon: 0.3 }, max: 2 },
    riposte: { name: 'Divine Riposte', rar: 'e', icon: 'sun', path: 'holy', key: true, desc: 'After a perfect dodge, your next attack within 1.5s Smites every foe it hits for its Radiance + the hit.', mods: { pdStrike: 1 }, max: 1 },
    evo_holy: { name: 'Hallowed Arms', rar: 'l', icon: 'sun', path: 'holy', evo: 'holy', desc: 'Hold attack to raise a guard for up to 2.5s (you move 50% slower): attacks from the front are perfect dodges, and foe shots from the front fly back as Holy shots (200% weapon damage).', mods: {}, hold: 'guard', max: 1 },

    // ---- Shadow: Backstabs ----
    doommark: { name: 'Mark of Doom', rar: 'r', icon: 'mask', path: 'shadow', gate: true, desc: 'Backstab: a hit from behind a foe, or on a foe not targeting you, deals +{backstab} and marks {shadowInfuse} of its damage as Doom (elites and bosses take 70%). A foe whose health falls to its Doom is Reaped. A boss is never Reaped: each time its Doom reaches 5% of its health it Tolls, taking that Doom as damage.', mods: { shadowInfuse: 0.4, backstab: 0.3 }, max: 1 },
    cutthroat: { name: 'Cutthroat', rar: 'r', icon: 'dagger', path: 'shadow', desc: 'Backstabs deal +{backstab} more.', mods: { backstab: 0.15 }, max: 3 },
    souljar: { name: 'Soul Jar', rar: 'c', icon: 'orb', path: 'shadow', desc: 'Your Backstabs mark {doomMul} more Doom.', mods: { doomMul: 0.2 }, max: 2 },
    inevitable: { name: 'Inevitable', rar: 'c', icon: 'skull', path: 'shadow', desc: 'Elites and bosses take {doomTough} more of your Doom.', mods: { doomTough: 0.15 }, max: 2 },
    umbralstep: { name: 'Umbral Step', rar: 'r', icon: 'cloak', path: 'shadow', desc: 'Foes you dash through take {dashDmg} Power ({dashDmg*P} damage); your next 2 hits within 1.5s are Backstabs.', mods: { dashDmg: 0.8, dashBack: 2 }, max: 1 },
    deathsedge: { name: "Death's Edge", rar: 'r', icon: 'dagger', path: 'shadow', desc: 'Each Reap (not of a horde foe) or Toll readies {deathsEdge*ck} guaranteed crit(s) (up to {deathsEdge*ck3} stored).', mods: { deathsEdge: 1 }, max: 2 },
    phantom: { name: 'Phantom Step', rar: 'e', icon: 'mask', path: 'shadow', key: true, desc: 'Your dash leaves a decoy where it started for 2s: foes that are not bosses within 200 go for it instead of you.', mods: { decoy: 1 }, max: 1 },
    evo_shadow: { name: 'Umbral Arms', rar: 'l', icon: 'mask', path: 'shadow', evo: 'shadow', desc: 'A dash aimed at a foe within 200 steps you behind it; your next hit within 1s is a guaranteed crit.', mods: { stepBehind: 1 }, max: 1 },

    // ---- General (Generalist only; keen and brutal also open at rank 1 to element heroes) ----
    generalist: { name: 'Generalist', rar: 'r', icon: 'sword', path: 'general', gate: true, desc: 'Forsake the elements: you never see element boons. +15% damage, +5% crit chance; crits Bleed for 30% of the hit. Open boons can rank 1 higher.', mods: { dmg: 0.15, crit: 0.05, bleed: 0.3, openRank: 1 }, max: 1 },
    keen: { name: 'Keen Eye', rar: 'c', icon: 'eye', path: 'general', openMax: 1, desc: '+{crit} crit chance.', mods: { crit: 0.05 }, max: 2 },
    brutal: { name: 'Brutality', rar: 'r', icon: 'skull', path: 'general', openMax: 1, desc: '+{critDmg} crit damage.', mods: { critDmg: 0.25 }, max: 3 },
    lacerate: { name: 'Lacerate', rar: 'r', icon: 'dagger', path: 'general', desc: '+{lacerate} damage to bleeding foes.', mods: { lacerate: 0.12 }, max: 2 },
    execute: { name: 'Executioner', rar: 'r', icon: 'axe', path: 'general', desc: '+{execute} damage to foes below 30% health.', mods: { execute: 0.25 }, max: 2 },
    deepcuts: { name: 'Deep Cuts', rar: 'r', icon: 'blades', path: 'general', desc: 'Bleed deals +{bleedMul}.', mods: { bleedMul: 0.3 }, max: 2 },
    opportunist: { name: 'Opportunist', rar: 'r', icon: 'hand', path: 'general', desc: '+25% damage to stunned, frozen or blinded foes.', mods: { opportunist: 0.25 }, max: 1 },
    sunder: { name: 'Sunder', rar: 'r', icon: 'blades', path: 'general', desc: 'Each crit makes that foe take +4% damage from you per stack (max 10).', mods: { sunder: 1 }, max: 1 },
    masterstroke: { name: 'Finisher', rar: 'e', icon: 'sword', path: 'general', key: true, desc: 'Hold attack to charge a finisher (full 1s after the hold starts at 0.35s); release it: a guaranteed crit at x2 damage that Bleeds for 50% of the hit (melee reach +30%).', mods: { masterstroke: 1 }, hold: 'finisher', max: 1 },
    evo_general: { name: 'Masterwork Arms', rar: 'l', icon: 'sword', path: 'general', evo: 'general', desc: 'Crits release a spectral strike (a repeat swing or a spectral shot) at 60%. The finisher charges in 0.7s. +{crit} crit chance.', mods: { crit: 0.1 }, strikes: [{ label: 'Spectral strike', on: 'any', mul: 0.6, every: 1, n: 1, crit: true, proc: true, onCrit: true }], max: 1 },
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

  // Path of a boon id, or null (open and class boons).
  ED.boonPath = (id) => (ED.BOONS[id] && ED.BOONS[id].path) || null;
  // True when the hero took the Generalist gate; boons = { id: rank }.
  ED.isGeneralist = (boons) => !!(boons && boons.generalist > 0);
  // Sum of ranks owned in a path. Open boons count toward none; the General path counts only for a Generalist.
  ED.pathAffinity = (boons, path) => {
    if (path === 'general' && !ED.isGeneralist(boons)) return 0;
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
  // Element paths whose gate is owned, in pick order.
  ED.elementGates = (boons) => ED.gatePaths(boons).filter(k => ED.PATHS[k].element);
  // The hero's deepest path: 'general' for a Generalist, else the owned element gate with the most affinity (first picked on a tie), or null before the start pick.
  ED.mainPath = (boons) => {
    if (ED.isGeneralist(boons)) return 'general';
    let best = null, bn = -1;
    for (const k of ED.elementGates(boons)) { const n = ED.pathAffinity(boons, k); if (n > bn) { bn = n; best = k; } }
    return best;
  };
  // Path of the evolution owned in boons, or null.
  ED.evoOf = (boons) => {
    for (const id in boons) { const b = ED.BOONS[id]; if (b && b.evo && boons[id] > 0) return b.evo; }
    return null;
  };
  // Highest rank a hero can hold of boon b: openMax for a gated boon shown to a non-Generalist; open boons gain 1 rank (when they have 2+) with the Generalist gate. st = the hero's stat block.
  ED.maxRank = (b, st) => {
    const max = b.max || 5;
    if (b.openMax && !(st && st.openRank)) return b.openMax;
    return max + (b.open && max >= 2 && st && st.openRank ? 1 : 0);
  };
  // Damage of a proc defined as { pw: { base, k } } for a hero with Class Power st.power.
  ED.procDmg = (def, st) => (def.pw.base || 0) + def.pw.k * st.power;
})(globalThis.ED || (globalThis.ED = {}));
