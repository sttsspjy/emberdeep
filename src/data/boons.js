// Boons: level-up choices. mods are added per stack to the stat block (see sim/stats.js).
// rar: c common, r rare, e epic (keystones), l legendary (evolutions), d duo. need: 'proj' | 'melee' restricts by weapon kind. cls restricts to a hero (class boons live in classboons.js).
// Path boons: path = owning path, gate (opens the path; a hero owns MAX_ELEMENTS element gates or the Generalist gate), key (keystone, needs path affinity >= keyAffinity),
// evo (evolution card), duo [a, b] (needs both element gates), open (offered to every hero, never gated, counts toward no affinity), openMax (rank cap of a gated boon for a hero that is not a Generalist),
// purse (gold card: only the exhausted-pool fallback offers it; picking it pays the room gold reward to the party gold and records no rank), retired (kept defined for old ids and tools, never offered),
// pw { base, k } (a proc damage of base + k x Class Power, see ED.procDmg).
(function (ED) {
  'use strict';
  ED.PATHS = {
    fire: { name: 'Fire', color: '#ff7a2a', icon: 'flame', element: true, evo: 'Cinder' },
    ice: { name: 'Ice', color: '#7fe3ff', icon: 'snow', element: true, evo: 'Glacial' },
    lightning: { name: 'Lightning', color: '#ffe66b', icon: 'bolt', element: true, evo: 'Tempest' },
    poison: { name: 'Poison', color: '#9be33c', icon: 'drop', element: true, evo: 'Venomous' },
    holy: { name: 'Holy', color: '#fff0c2', icon: 'sun', element: true, evo: 'Hallowed' },
    shadow: { name: 'Shadow', color: '#a070ff', icon: 'mask', element: true, evo: 'Umbral' },
    general: { name: 'General', color: '#d9dfe8', icon: 'sword', element: false, evo: 'Masterwork' },
  };
  ED.PATH_IDS = Object.keys(ED.PATHS);
  ED.ELEMENT_IDS = ED.PATH_IDS.filter(k => ED.PATHS[k].element);
  ED.MAX_ELEMENTS = 2; // element gates a hero owns (the Generalist gate excludes them all)
  ED.KEY_AFFINITY = 5; // path affinity a keystone needs
  ED.EVO_AFFINITY = 10; // path affinity (with its keystone owned) that unlocks the evolution card
  ED.KEY_AFFINITY_GENERAL = 6; ED.EVO_AFFINITY_GENERAL = 12; // the same for the General path
  ED.DUO_AFFINITY = 4; // both element paths at this affinity put their duo on every offer until taken
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

  // Statuses and foe debuffs for the sheet: name, colour, el (the element that tags it), mulKey (the stat that scales its damage), rule (one sentence of what it does).
  ED.STATUS = {
    burn: { name: 'Burn', color: '#ff7a2a', el: 'fire', mulKey: 'burnMul', rule: 'Every 0.5 s, 20% of the pool (at least 1) is dealt as Fire damage.' },
    chill: { name: 'Chill', color: '#7fe3ff', el: 'ice', mulKey: 'chillMul', rule: 'Slows the foe (up to 45%) and its wind-ups; a full gauge freezes it (elites 0.75 as long, bosses only 0.6 s).' },
    frozen: { name: 'Frozen', color: '#7fe3ff', el: 'ice', rule: 'A frozen foe cannot act and takes +25% damage.' },
    charge: { name: 'Charge', color: '#ffe66b', el: 'lightning', mulKey: 'shockMul', rule: 'Every 1 s the stored charge discharges into the foe and 60% of it arcs to 3 nearby foes.' },
    venom: { name: 'Venom', color: '#9be33c', el: 'poison', mulKey: 'corrode', rule: 'Envenomed foes take up to +25% damage from you (half from allies); at full Venom the foe is Corroded and its guard breaks.' },
    radiance: { name: 'Radiance', color: '#fff0c2', el: 'holy', mulKey: 'smiteMul', rule: 'Stored light Smites the foe at 12% of its health (elites 6%, bosses 2%) and shields heroes near it.' },
    doom: { name: 'Doom', color: '#a070ff', el: 'shadow', mulKey: 'doomMul', rule: 'A foe whose health falls to its Doom is Reaped. A boss is never Reaped: each time its Doom reaches 5% of its health it Tolls, taking that Doom as damage.' },
    bleed: { name: 'Bleed', color: '#d9dfe8', el: null, mulKey: 'bleedMul', rule: 'Physical: every 0.5 s, 20% of the pool (at least 1) is dealt as damage. Never weak, never resisted.' },
    judged: { name: 'Judged', color: '#ffd36b', el: 'holy', rule: 'Takes +20% damage; does not stack with other +20% vulnerability (Hailthorns, smoke).' },
    marked: { name: 'Marked', color: '#ff8a5a', el: null, rule: 'Takes extra damage from every hero.' },
    sundered: { name: 'Sundered', color: '#ffb04a', el: null, rule: 'Takes +4% damage from you per stack (up to 10).' },
    exposed: { name: 'Exposed', color: '#ef5a46', el: null, rule: 'A foe left alive too long takes ×1.5 damage and bleeds health.' },
    ailment: { name: 'Ailments', color: '#d9dfe8', el: null, rule: 'A foe counts one ailment for each of: a Burn, Bleed or Charge pool worth 1% of its health; Chill of 25 or more, or Frozen; Venom above 25; Radiance a quarter of the way to a Smite; Doom worth 2% of its health; Dazed (stunned or blinded); Sealed. Brand, Open Veins, Contagion and Gangrene read the count (at most 4).' }, // thresholds as World.ailments (combat.js)
  };

  const n1 = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  const per = (pr, el) => (pr.rate && pr.rate[el]) || 0;
  // Sheet readouts per path. infuse: the stat that sets the status build-up; status: its ED.STATUS id; sheet.rows: stats listed under the path's status row;
  // sheet.est(proc, st, aff, ref) -> { label, dps? (damage per second the status adds to one foe), secs? (seconds of your damage to its payoff) }.
  // proc.rate[el] = damage per second the hero's hits build into that element (before the stratum affinity, infusion rates and statusPow included), proc.pool[el] = the built-in pool per second
  // (Nova and Meteor Burn), proc.bleed = Bleed built per second; aff = the stratum multiplier of the element; ref = { hp, statusHp (HP before the stratum lever), r } of a typical foe here.
  const PS = {
    fire: { rows: ['fireInfuse', 'burnMul', 'searing', 'wildfire', 'brushfire', 'conflag'], est: (pr, st, aff) => { const dps = (per(pr, 'fire') + (pr.pool && pr.pool.fire || 0)) * aff * (1 + st.burnMul); return { label: `Burn adds about ${n1(dps)} damage per second to a foe here`, dps }; } },
    ice: { rows: ['iceInfuse', 'chillMul', 'freezeDur', 'refreeze', 'shatter', 'brittle'], est: (pr, st, aff, ref) => {
      const rate = per(pr, 'ice') / ref.statusHp * ED.CONST.CHILL_K * (1 + st.chillMul) * aff, secs = rate > 0 ? 100 / rate : 0;
      return { label: (rate > 0 ? `Freezes a ${n1(ref.hp)} HP foe in about ${n1(secs)} s of your damage` : 'Builds no chill yet') + `; frozen ${n1(1.6 * (1 + st.freezeDur))} s (bosses 0.6 s)`, secs };
    } },
    lightning: { rows: ['lightningInfuse', 'shockMul', 'arcs', 'arcRange', 'arcStun', 'ionize', 'conduct'], est: (pr, st, aff) => { // Capacitor: the charge waits for a skill cast and detonates at CAP_MUL (the estimate assumes a cast before the foe dies)
      const cap = st.capacitor > 0, dps = per(pr, 'lightning') * aff * (1 - st.chargeSlow) * (1 + st.shockMul) * (cap ? ED.CONST.CAP_MUL + st.capMul : 1);
      return { label: `${cap ? 'Detonates on each skill cast for' : 'Discharges'} about ${n1(dps)} damage per second into the charged foe, 60% to ${3 + st.arcs} more within ${Math.round(140 * (1 + st.arcRange))}`, dps };
    } },
    poison: { rows: ['poisonInfuse', 'venomBuild', 'venomHold', 'venomSlow', 'corrode', 'fester'], est: (pr, st, aff, ref) => {
      const rate = per(pr, 'poison') / ref.statusHp * ED.CONST.VENOM_K * (1 + st.venomBuild) * aff, secs = rate > 0 ? 100 / rate : 0;
      return { label: (rate > 0 ? `Full Venom on a ${n1(ref.hp)} HP foe in about ${n1(secs)} s` : 'Builds no Venom yet') + `: +${Math.round((ED.CONST.VENOM_AMP + st.corrode) * 100)}% damage from you, half from allies; fades after ${n1(ED.CONST.VENOM_HOLD + st.venomHold)} s`, secs };
    } },
    holy: { rows: ['holyInfuse', 'smiteMul', 'smiteShield', 'holyCap', 'beacon', 'hallow'], est: (pr, st, aff, ref) => {
      const rate = per(pr, 'holy') * aff, at = ref.hp * ED.CONST.SMITE_AT.trash, secs = rate > 0 ? at / rate : 0, dps = rate * (1 + st.smiteMul);
      return { label: (rate > 0 ? `A Smite every ${n1(secs)} s on a ${n1(ref.hp)} HP foe, about ${n1(dps)} damage per second` : 'Stores no Radiance yet') + `; shield ${n1(Math.min(ED.CONST.HOLY_GRANT_MAX, st.smiteShield) * 100)}% per Smite (twice from elites and bosses), once per ${ED.CONST.HOLY_CD} s, up to ${n1(st.holyCap * 100)}%`, dps, secs };
    } },
    shadow: { rows: ['shadowInfuse', 'doomMul', 'doomTough', 'malice', 'reapChain', 'reaper'], est: (pr, st, aff) => {
      const i = per(pr, 'shadow') > 0 ? st.shadowInfuse * (1 + st.doomMul) * aff : 0, share = 1 / (1 + i), big = 1 / (1 + i * (ED.CONST.DOOM_TOUGH + st.doomTough));
      return { label: (i > 0 ? `Reaps a foe once you deal ${Math.round(share * 100)}% of its health (elites ${Math.round(big * 100)}%)` : 'Marks no Doom yet') + `; bosses Toll at ${Math.round(ED.CONST.TOLL_AT * 100)}% Doom`, pct: share };
    } },
    general: { rows: ['crit', 'critDmg', 'bleed', 'bleedAll', 'bleedMul', 'lacerate', 'execute'], est: (pr, st, aff, ref) => {
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
  // Elemental affinity of the hero's stratum: x1.5 weak, ÷1.5 resisted (x0.667), else x1 (General and physical hits ignore it). Class-skill hits take half of it (ED.affC).
  ED.elemMul = (stratum, el) => { const b = ED.biomeFor(stratum); return !el || el === 'general' ? 1 : b.weak === el ? 1.5 : b.resist === el ? 1 / 1.5 : 1; };
  ED.affC = (stratum, el) => 1 + (ED.elemMul(stratum, el) - 1) / 2;

  const B = ED.BOONS = {
    // ---- open General: offered to every hero ----
    vigor: { name: 'Vigor', rar: 'c', icon: 'heart', open: true, desc: '+{hp} max health and heal 2.', mods: { hp: 2 }, heal: 2, max: 3 },
    purse: { name: 'Purse', rar: 'c', icon: 'coin', open: true, purse: true, desc: '+{gold} gold for the party.', mods: {}, max: 1 },
    plating: { name: 'Plating', rar: 'c', icon: 'shield', open: true, desc: '+{armor} armor.', mods: { armor: 3 }, max: 2 },
    fleet: { name: 'Fleet Foot', rar: 'c', icon: 'boot', open: true, desc: '+{spd} move speed.', mods: { spd: 0.07 }, max: 2 },
    focus: { name: 'Focus', rar: 'c', icon: 'hourglass', open: true, desc: 'Skills recharge {cdr} faster.', mods: { cdr: 0.10 }, max: 3 },
    lightstep: { name: 'Light Step', rar: 'c', icon: 'wing', open: true, desc: 'Dash: +{dashN} charge(s).', mods: { dashN: 1 }, max: 2 },
    magnet: { name: 'Lodestar', rar: 'c', icon: 'magnet', open: true, desc: '+{pickup} pickup range and +{xp} experience.', mods: { pickup: 0.4, xp: 0.1 }, max: 2 },
    edge: { name: 'Sharpened Edge', rar: 'c', icon: 'sword', open: true, desc: '+{dmg} damage.', mods: { dmg: 0.10 }, max: 2 },
    quick: { name: 'Quickened Hands', rar: 'c', icon: 'hand', open: true, desc: '+{atk} attack speed.', mods: { atk: 0.10 }, max: 2 },
    bounty: { name: 'Bounty', rar: 'c', icon: 'coin', open: true, desc: '+{gold} gold.', mods: { gold: 0.25 }, max: 2 },
    stalwart: { name: 'Stalwart', rar: 'c', icon: 'heart', open: true, desc: '+{hpMul} max health.', mods: { hpMul: 0.04 }, max: 2 },
    mending: { name: 'Mending', rar: 'c', icon: 'potion', open: true, desc: '+{heal} healing received.', mods: { heal: 0.15 }, max: 2 },
    forager: { name: 'Forager', rar: 'c', icon: 'leaf', open: true, desc: 'Cleared rooms drop a heart {forager*10}% more often; hearts you pick up heal {forager*3}% more max health.', mods: { forager: 1 }, max: 2 },
    wide: { name: 'Wide Arcs', rar: 'r', icon: 'arc', open: true, desc: '+{area} area: melee reach, blasts and auras.', mods: { area: 0.15 }, max: 2 },
    evade: { name: 'Evasion', rar: 'r', icon: 'cloak', open: true, desc: '+{dodge} chance to dodge attacks.', mods: { dodge: 0.04 }, max: 2 },
    thorns: { name: 'Thornmail', rar: 'r', icon: 'thorn', open: true, desc: 'Attackers take {thorns} damage. +{armor} armor.', mods: { thorns: 10, armor: 2 }, max: 2 },
    pierce: { name: 'Piercing', rar: 'r', icon: 'arrow', open: true, desc: 'Projectiles pierce +{pierce} foe(s).', mods: { pierce: 1 }, need: 'proj', max: 2 },
    split: { name: 'Split Shot', rar: 'r', icon: 'arrows', open: true, desc: '+{projN} projectile(s) per attack, -{dmg} damage.', mods: { projN: 1, dmg: -0.08 }, need: 'proj', max: 2 },
    bladedash: { name: 'Blade Dash', rar: 'r', icon: 'wingblade', open: true, desc: 'Dashing through foes deals {dashDmg} Power ({dashDmg*P} damage).', mods: { dashDmg: 1.2 }, max: 1 },
    battleward: { name: 'Battle Ward', rar: 'r', icon: 'shieldgold', open: true, desc: 'When an elite room locks, gain a shield of {roomWard} max health.', mods: { roomWard: 0.03 }, max: 1 },
    echo: { name: 'Echo', rar: 'e', icon: 'twinblue', open: true, desc: 'Your first skill holds a second charge.', mods: { charges: 1 }, max: 1 },
    laststand: { name: 'Last Stand', rar: 'e', icon: 'shieldgold', open: true, desc: 'Falling below 30% health grants 3s of 60% damage reduction (20s cooldown).', mods: { guardian: 1 }, max: 1 },
    glass: { name: 'Glass Heart', rar: 'e', icon: 'heartbroken', open: true, desc: '+30% damage, -15% max health.', mods: { dmg: 0.3, hpMul: -0.15 }, max: 1 },
    trance: { name: 'Battle Trance', rar: 'e', icon: 'drum', open: true, desc: 'Using a skill grants +30% attack speed for 4s.', mods: { trance: 0.3 }, max: 1 },
    overcharge: { name: 'Overcharge', rar: 'e', icon: 'star', open: true, desc: 'Your skills also release a shockwave ({pw} damage: 150% Power + 10, radius 85).', mods: { overcharge: 1 }, pw: { base: 10, k: 1.5 }, max: 1 },

    // ---- Fire: ground and terrain ----
    kindle: { name: 'Kindle', rar: 'r', icon: 'flame', path: 'fire', gate: true, desc: 'Hits add {fireInfuse} of their damage as Burn.', mods: { fireInfuse: 0.35 }, max: 1 },
    fuel: { name: 'Ember Attunement', rar: 'c', icon: 'ember', path: 'fire', desc: 'Hits add {fireInfuse} more of their damage as Burn; +{searing} damage to burning foes.', mods: { fireInfuse: 0.08, searing: 0.12 }, max: 2 },
    stoke: { name: 'Stoke the Flames', rar: 'r', icon: 'flame', path: 'fire', desc: 'Burn deals +{burnMul} damage.', mods: { burnMul: 0.25 }, max: 3 },
    searing: { name: 'Searing', rar: 'c', icon: 'sun', path: 'fire', retired: true, desc: '+{searing} damage to burning foes.', mods: { searing: 0.12 }, max: 2 },
    wildfire: { name: 'Wildfire', rar: 'r', icon: 'flame', path: 'fire', desc: 'A burning foe that dies sets foes within 80 alight for {wildfire} of its base health.', mods: { wildfire: 0.15 }, max: 2 },
    brushfire: { name: 'Brushfire', rar: 'r', icon: 'flame', path: 'fire', desc: 'Every 0.5s a burning foe sets each foe touching it that burns less alight for {brushfire} of its Burn (a foe takes at most 25% of its health per spread).', mods: { brushfire: 0.3 }, max: 1 },
    firebreak: { name: 'Firebreak', rar: 'r', icon: 'ember', path: 'fire', desc: 'A burning foe that dies leaves burning ground (radius 34, 3s, {pw} per second: 4 + 50% Power). Your burning ground blocks the path of foes that are not elites or bosses: they walk around it.', mods: { firebreak: 1 }, pw: { base: 4, k: 0.5 }, max: 1 },
    cindertrail: { name: 'Cinder Trail', rar: 'r', icon: 'wing', path: 'fire', desc: 'Your dash leaves burning ground for 2.2s ({pw} per second: 6 + 60% Power).', mods: { dashFire: 1 }, pw: { base: 6, k: 0.6 }, max: 1 },
    conflag: { name: 'Conflagration', rar: 'e', icon: 'bomb', path: 'fire', key: true, desc: 'A foe whose Burn exceeds 30% of its remaining base health combusts: the whole pool hits it, and 60% of it hits foes within 70.', mods: { conflag: 1 }, max: 1 },
    evo_fire: { name: 'Cinder Arms', rar: 'l', icon: 'flame', path: 'fire', evo: 'fire', desc: "Your attacks scorch the ground along their path for 2s (a swing its arc, a shot its line): 25% of the weapon's damage per second as Fire to foes on it. Burn +25%.", mods: { burnMul: 0.25 }, strikes: [{ label: 'Scorched ground', on: 'any', perSec: 0.25, dur: 2, every: 1, crit: false, proc: false, el: 'fire' }], max: 1 },

    // ---- Ice: blocking and the skill cash-in ----
    frostbite: { name: 'Frostbite', rar: 'r', icon: 'snow', path: 'ice', gate: true, desc: 'Hits chill; full chill freezes for 1.6s. Frozen foes take +25% damage.', mods: { iceInfuse: 1 }, max: 1 },
    deepcold: { name: 'Frost Attunement', rar: 'c', icon: 'snow', path: 'ice', desc: '+{chillMul} chill build-up; +{brittle} damage to chilled or frozen foes.', mods: { chillMul: 0.35, brittle: 0.1 }, max: 2 },
    shatter: { name: 'Shatter', rar: 'r', icon: 'gem', path: 'ice', desc: "A skill hit on a frozen foe shatters it: the freeze ends, the hit deals +{shatter}, and an ice burst strikes foes within 90 for the hit's damage (it chills).", mods: { shatter: 0.6 }, max: 3 },
    brittle: { name: 'Brittle Cold', rar: 'c', icon: 'gem', path: 'ice', retired: true, desc: '+{brittle} damage to chilled or frozen foes.', mods: { brittle: 0.1 }, max: 2 },
    coldsnap: { name: 'Cold Snap', rar: 'r', icon: 'wing', path: 'ice', retired: true, desc: 'Dashing releases a frost ring (radius 80) dealing {dashFrost} Power ({dashFrost*P} damage); it chills.', mods: { dashFrost: 0.5 }, max: 1 },
    glacier: { name: 'Glacier', rar: 'r', icon: 'shield', path: 'ice', desc: 'Frozen foes are solid: other foes cannot push through them and foe shots break on them (heroes, allies and your shots pass).', mods: { glacier: 1 }, max: 1 },
    rime: { name: 'Lingering Rime', rar: 'c', icon: 'snow', path: 'ice', desc: 'A foe that thaws keeps {refreeze} of a full chill gauge.', mods: { refreeze: 0.25 }, max: 2 },
    permafrost: { name: 'Permafrost', rar: 'c', icon: 'shield', path: 'ice', desc: 'Freeze lasts {freezeDur} longer. Chilled foes deal {chillWeaken} less damage.', mods: { freezeDur: 0.3, chillWeaken: 0.1 }, max: 2 },
    frostheart: { name: 'Frozen Heart', rar: 'r', icon: 'snow', path: 'ice', retired: true, desc: 'When hit, freeze nearby foes (8s cooldown).', mods: { frozenHeart: 1 }, max: 1 },
    abszero: { name: 'Absolute Zero', rar: 'e', icon: 'snow', path: 'ice', key: true, desc: 'Freezing a foe releases a frost nova adding 60 chill to foes within 100.', mods: { frostNova: 1 }, max: 1 },
    evo_ice: { name: 'Glacial Arms', rar: 'l', icon: 'snow', path: 'ice', evo: 'ice', desc: "A foe that dies frozen leaves an ice pillar for 4s, solid to foes and their shots. A skill hit beside a pillar shatters it: an ice burst within 80 for 15% of the dead foe's health (elites 7.5%) that chills. Chill +25%.", mods: { chillMul: 0.25 }, strikes: [], max: 1 },

    // ---- Lightning: skill casts ----
    staticcharge: { name: 'Static Charge', rar: 'r', icon: 'bolt', path: 'lightning', gate: true, desc: 'Hits charge foes with 25% of their damage; each second they discharge to themselves and 3 nearby foes (60%).', mods: { lightningInfuse: 0.25 }, max: 1 },
    stormattune: { name: 'Storm Attunement', rar: 'c', icon: 'bolt', path: 'lightning', desc: 'Hits charge foes with {lightningInfuse} more of their damage; +{ionize} damage to charged foes.', mods: { lightningInfuse: 0.06, ionize: 0.1 }, max: 2 },
    conductor: { name: 'Conductor', rar: 'r', icon: 'bolt', path: 'lightning', desc: '+{arcs} arc target(s) and +{arcRange} arc range.', mods: { arcs: 1, arcRange: 0.3 }, max: 2 },
    highvoltage: { name: 'High Voltage', rar: 'r', icon: 'star', path: 'lightning', desc: 'Discharges deal +{shockMul}.', mods: { shockMul: 0.2 }, max: 2 },
    conduction: { name: 'Conduction', rar: 'r', icon: 'magnet', path: 'lightning', desc: 'A discharge deals +{conduct} for each other foe within 60 of the discharging foe (up to 5).', mods: { conduct: 0.15 }, max: 1 },
    stormanchor: { name: 'Storm Anchor', rar: 'r', icon: 'star', path: 'lightning', desc: 'Each skill cast plants a Storm Anchor where you stand for 4s (at most 2), solid to foes and their shots. Every 0.5s it zaps the nearest foe within 80 for {pw} (60% Power + 4) as Lightning; a discharge within 200 also arcs to it and bursts around it (radius 70, 60% of the discharge).', mods: { anchor: 1 }, pw: { base: 4, k: 0.6 }, max: 1 },
    shortcircuit: { name: 'Short Circuit', rar: 'r', icon: 'bolt', path: 'lightning', desc: 'A charged foe that dies discharges at once at +{shortCircuit}.', mods: { shortCircuit: 0.5 }, max: 1 },
    thunderstep: { name: 'Thunderstep', rar: 'r', icon: 'wingblade', path: 'lightning', retired: true, desc: 'Foes you dash through take {dashDmg} Power ({dashDmg*P} damage); it charges them.', mods: { dashDmg: 1 }, max: 1 },
    overload: { name: 'Overload', rar: 'c', icon: 'magnet', path: 'lightning', desc: 'Discharges stun non-boss foes for {arcStun:sec} (elites half), at most once per second per foe.', mods: { arcStun: 0.25 }, max: 1 },
    stormcall: { name: 'Storm Call', rar: 'r', icon: 'bolt', path: 'lightning', retired: true, desc: 'Critical hits charge foes with 60% of their damage.', mods: { critCharge: 0.6 }, max: 1 },
    thundergauntlet: { name: 'Thunder Gauntlet', rar: 'r', icon: 'bolt', path: 'lightning', retired: true, desc: 'Every 6th attack calls lightning on its target.', mods: { gauntlet: 1 }, max: 1 },
    capacitor: { name: 'Capacitor', rar: 'e', icon: 'bolt', path: 'lightning', key: true, desc: 'Foes you charge no longer discharge each second. Each skill cast detonates every foe you charged: its whole charge discharges at x3, rippling through the pack.', mods: { capacitor: 1 }, max: 1 },
    evo_lightning: { name: 'Tempest Arms', rar: 'l', icon: 'bolt', path: 'lightning', evo: 'lightning', desc: "Your charged foes within 120 of each other are tethered by arcs (one chain of up to 6). A foe crossing a tether takes 50% of your weapon's damage as Lightning (once per 0.5s per foe) and is charged by it.", mods: {}, strikes: [], max: 1 },

    // ---- Poison: crippling the dangerous foe ----
    envenom: { name: 'Envenom', rar: 'r', icon: 'drop', path: 'poison', gate: true, desc: 'Hits build Venom. Envenomed foes take up to +25% damage from you (+12.5% from allies); at full Venom a foe is Corroded and its guard breaks.', mods: { poisonInfuse: 1 }, max: 1 },
    potency: { name: 'Venom Attunement', rar: 'c', icon: 'potion', path: 'poison', desc: '+{venomBuild} Venom build-up; +{fester} damage to envenomed foes.', mods: { venomBuild: 0.3, fester: 0.1 }, max: 2 },
    caustic: { name: 'Caustic', rar: 'r', icon: 'drop', path: 'poison', desc: 'Venom bonus +{corrode} at full Venom.', mods: { corrode: 0.06 }, max: 2 },
    fester: { name: 'Fester', rar: 'c', icon: 'skull', path: 'poison', retired: true, desc: '+{fester} damage to envenomed foes.', mods: { fester: 0.1 }, max: 2 },
    sporeburst: { name: 'Spore Burst', rar: 'r', icon: 'bomb', path: 'poison', desc: 'An envenomed foe that dies gives foes within 80 {sporeBurst} of its Venom.', mods: { sporeBurst: 0.35 }, max: 2 },
    noxiousstep: { name: 'Noxious Step', rar: 'r', icon: 'wing', path: 'poison', retired: true, desc: 'Foes you dash through take {dashDmg} Power ({dashDmg*P} damage); that hit builds +{dashVenom} Venom.', mods: { dashDmg: 0.8, dashVenom: 2 }, max: 1 },
    neurotoxin: { name: 'Neurotoxin', rar: 'r', icon: 'potion', path: 'poison', desc: 'Foes at full Venom wind up 40% slower and move 25% slower (bosses half as much).', mods: { neuro: 1 }, max: 1 },
    hexstrong: { name: 'Hex the Strong', rar: 'r', icon: 'skull', path: 'poison', desc: 'An elite at full Venom loses its affixes (swift, brutal, warded, vampiric, volatile) until its Venom falls below 50.', mods: { hexStrong: 1 }, max: 1 },
    linger: { name: 'Lingering Venom', rar: 'c', icon: 'drop', path: 'poison', desc: 'Venom starts fading {venomHold:sec} later and fades {venomSlow} slower.', mods: { venomHold: 1, venomSlow: 0.25 }, max: 2 },
    pandemic: { name: 'Pandemic', rar: 'e', icon: 'orb', path: 'poison', key: true, desc: 'Every second, each Corroded foe gives {pandemic} of its Venom to the 2 nearest foes within 90 that hold less.', mods: { pandemic: 0.3 }, max: 1 },
    evo_poison: { name: 'Venomous Arms', rar: 'l', icon: 'drop', path: 'poison', evo: 'poison', desc: "Each hit plants a Venom dose in the foe (one at a time; more hits do not reset it). 3s later it bursts as Poison on the foe and foes within 50 for 10% of the foe's health times its Venom share (elites half, bosses a quarter). Venom bonus +10% at full Venom.", mods: { corrode: 0.1 }, strikes: [], max: 1 },

    // ---- Holy: being hit and holding ground ----
    consecrate: { name: 'Consecrate', rar: 'r', icon: 'sun', path: 'holy', gate: true, desc: "Hits store 30% of their damage as Radiance. At 12% of a foe's health (elites 6%, bosses 2%) it Smites for the stored amount and shields heroes within 160 for 1% max health (2% from elites and bosses), once per 3s each, up to 6%.", mods: { holyInfuse: 0.3 }, max: 1 },
    fervor: { name: 'Light Attunement', rar: 'c', icon: 'sun', path: 'holy', desc: 'Hits store {holyInfuse} more of their damage as Radiance; +{hallow} damage to foes holding Radiance.', mods: { holyInfuse: 0.08, hallow: 0.1 }, max: 2 },
    zealotry: { name: 'Zealotry', rar: 'r', icon: 'star', path: 'holy', desc: 'Smites deal +{smiteMul}.', mods: { smiteMul: 0.25 }, max: 2 },
    sanctity: { name: 'Sanctity', rar: 'r', icon: 'shieldgold', path: 'holy', desc: 'Smites shield {smiteShield} more; your Holy shield holds up to {holyCap} more.', mods: { smiteShield: 0.0025, holyCap: 0.03 }, max: 2 },
    beacon: { name: 'Beacon', rar: 'r', icon: 'lantern', path: 'holy', desc: 'Smites also strike foes within 70 for {beacon} of their damage.', mods: { beacon: 0.3 }, max: 2 },
    dawnstride: { name: 'Dawn Stride', rar: 'r', icon: 'wingblade', path: 'holy', retired: true, desc: 'Foes you dash through take {dashDmg} Power ({dashDmg*P} damage) and are blinded for 1s (elites 0.5s; bosses are never blinded). A foe is blinded this way at most once per 4s.', mods: { dashDmg: 0.8, dashBlind: 1 }, max: 1 },
    martyr: { name: "Martyr's Rebuke", rar: 'r', icon: 'shieldgold', path: 'holy', desc: "When your shield breaks, a holy nova strikes foes within 100 for {pw} (300% Power + 10), times the broken shield's size against 3% of your max health (x0.5 to x2); at most once a second.", mods: { rebuke: 1 }, pw: { base: 10, k: 3 }, max: 1 },
    vigil: { name: 'Vigil', rar: 'r', icon: 'lantern', path: 'holy', desc: 'Standing still for 1s consecrates the ground under you (radius 70) until you step off it: your hits on foes on it store twice the Radiance.', mods: { vigil: 1 }, max: 1 },
    radiantaegis: { name: 'Radiant Aegis', rar: 'e', icon: 'shieldgold', path: 'holy', key: true, desc: 'While you are shielded, your hits store twice the Radiance. Damage your shield absorbs strikes the attacker for 8 times that as Holy damage.', mods: { radiantAegis: 1 }, max: 1 },
    evo_holy: { name: 'Hallowed Arms', rar: 'l', icon: 'sun', path: 'holy', evo: 'holy', desc: 'While you are shielded, your attack becomes a lance of light along your aim (melee 150 long, shots 260, 20 wide): the same hit, as Holy, on every foe on the line. Smites shield 0.25% more.', mods: { smiteShield: 0.0025 }, strikes: [], max: 1 },

    // ---- Shadow: kills and the dash ----
    doommark: { name: 'Mark of Doom', rar: 'r', icon: 'mask', path: 'shadow', gate: true, desc: 'Hits mark 30% of their damage as Doom (elites and bosses take 70% of it). A foe whose health falls to its Doom is Reaped. A boss is never Reaped: each time its Doom reaches 5% of its health it Tolls, taking that Doom as damage.', mods: { shadowInfuse: 0.3 }, max: 1 },
    malignance: { name: 'Shadow Attunement', rar: 'c', icon: 'mask', path: 'shadow', desc: 'Hits mark {shadowInfuse} more of their damage as Doom; +{malice} damage to foes carrying Doom.', mods: { shadowInfuse: 0.08, malice: 0.1 }, max: 2 },
    malice: { name: 'Malice', rar: 'c', icon: 'skull', path: 'shadow', retired: true, desc: '+{malice} damage to foes carrying Doom.', mods: { malice: 0.1 }, max: 2 },
    inevitable: { name: 'Inevitable', rar: 'r', icon: 'skull', path: 'shadow', desc: 'Elites and bosses take {doomTough} more of your Doom (full at rank 2).', mods: { doomTough: 0.15 }, max: 2 },
    deathknell: { name: 'Death Knell', rar: 'r', icon: 'drum', path: 'shadow', desc: 'Each Reap (not of a horde foe) or Toll grants +4% damage for 6s, stacking up to {knell:n} times.', mods: { knell: 5 }, max: 2 },
    deathsedge: { name: "Death's Edge", rar: 'r', icon: 'dagger', path: 'shadow', desc: 'Each Reap (not of a horde foe) or Toll readies {deathsEdge*ck} guaranteed crit(s) (up to {deathsEdge*ck3} stored).', mods: { deathsEdge: 1 }, max: 1 },
    souljar: { name: 'Soul Jar', rar: 'c', icon: 'orb', path: 'shadow', retired: true, desc: 'Your hits mark {doomMul} more Doom.', mods: { doomMul: 0.2 }, max: 2 },
    reaperschain: { name: "Reaper's Chain", rar: 'r', icon: 'blades', path: 'shadow', desc: "A Reap passes {reapChain} of the Reaped foe's Doom to the nearest foe within 120 (at most 25% of its health), which may be Reaped in turn.", mods: { reapChain: 0.5 }, max: 1 },
    quarry: { name: 'Quarry', rar: 'r', icon: 'eye', path: 'shadow', desc: 'The last foe your skill hit is your Quarry for 8s: its Reap line is doubled.', mods: { quarry: 1 }, max: 1 },
    umbralstep: { name: 'Umbral Step', rar: 'r', icon: 'cloak', path: 'shadow', desc: 'Dashing through a foe Reaps it if its health is at most twice its Reap line.', mods: { dashReap: 1 }, max: 1 },
    reaper: { name: 'Reaper', rar: 'e', icon: 'axe', path: 'shadow', key: true, desc: 'A Reaped foe implodes: 20% of its health (elites 10%) as Shadow damage to foes within 80.', mods: { reaper: 0.2 }, max: 1 },
    evo_shadow: { name: 'Umbral Arms', rar: 'l', icon: 'mask', path: 'shadow', evo: 'shadow', desc: 'Each Reap makes the nearest foe within 160 your Quarry for 8s (its Reap line doubled) and, unless the Reaped foe was a horde foe, refunds a dash charge.', mods: {}, strikes: [], max: 1 },

    // ---- General (Generalist only; keen and brutal also open at rank 1 to element heroes) ----
    generalist: { name: 'Generalist', rar: 'r', icon: 'sword', path: 'general', gate: true, desc: 'Forsake the elements: you never see element boons. +15% damage, +5% crit chance; crits Bleed for 30% of the hit. Open boons can rank 1 higher.', mods: { dmg: 0.15, crit: 0.05, bleed: 0.3, openRank: 1 }, max: 1 },
    keen: { name: 'Keen Eye', rar: 'c', icon: 'eye', path: 'general', openMax: 1, desc: '+{crit} crit chance.', mods: { crit: 0.05 }, max: 2 },
    brutal: { name: 'Brutality', rar: 'r', icon: 'skull', path: 'general', openMax: 1, desc: '+{critDmg} crit damage.', mods: { critDmg: 0.25 }, max: 3 },
    lacerate: { name: 'Lacerate', rar: 'r', icon: 'dagger', path: 'general', desc: '+{lacerate} damage to bleeding foes.', mods: { lacerate: 0.12 }, max: 2 },
    execute: { name: 'Executioner', rar: 'r', icon: 'axe', path: 'general', desc: '+{execute} damage to foes below 30% health.', mods: { execute: 0.25 }, max: 2 },
    deepcuts: { name: 'Deep Cuts', rar: 'r', icon: 'blades', path: 'general', desc: 'Bleed deals +{bleedMul}.', mods: { bleedMul: 0.3 }, max: 2 },
    opportunist: { name: 'Opportunist', rar: 'r', icon: 'hand', path: 'general', desc: '+25% damage to stunned, frozen or blinded foes.', mods: { opportunist: 0.25 }, max: 1 },
    sunder: { name: 'Sunder', rar: 'r', icon: 'blades', path: 'general', desc: 'Each crit makes that foe take +4% damage from you per stack (max 10).', mods: { sunder: 1 }, max: 1 },
    masterstroke: { name: 'Masterstroke', rar: 'e', icon: 'sword', path: 'general', key: true, desc: 'Every 4th attack is a guaranteed crit at +30% that Bleeds for 50% of the hit.', mods: { masterstroke: 1 }, max: 1 },
    evo_general: { name: 'Masterwork Arms', rar: 'l', icon: 'sword', path: 'general', evo: 'general', desc: 'Crits release a spectral strike (a repeat swing or a spectral shot) at 60%. +10% crit chance.', mods: { crit: 0.1 }, strikes: [{ label: 'Spectral strike', on: 'any', mul: 0.6, every: 1, n: 1, crit: true, proc: true, onCrit: true }], max: 1 },

    // ---- duos (need both element gates; both paths at DUO_AFFINITY put the duo on every offer): one rule each ----
    thermalshock: { name: 'Thermal Shock', rar: 'd', icon: 'snow', duo: ['fire', 'ice'], desc: 'Freezing a burning foe detonates its Burn: the whole pool x2 hits it, and 60% of that bursts to foes within 70 and chills them.', mods: { thermal: 1 }, max: 1 },
    plasma: { name: 'Plasma', rar: 'd', icon: 'star', duo: ['fire', 'lightning'], desc: 'Discharges add Burn equal to 40% of their damage to every foe they hit.', mods: { plasma: 1 }, max: 1 },
    firedamp: { name: 'Firedamp', rar: 'd', icon: 'bomb', duo: ['fire', 'poison'], desc: 'A foe that dies burning and envenomed explodes: 20% of its health (elites 10%) as Fire damage to foes within 80, who catch Burn (50% of the blast) and Venom from it.', mods: { firedamp: 1 }, max: 1 },
    sunfire: { name: 'Sunfire', rar: 'd', icon: 'sun', duo: ['fire', 'holy'], desc: 'Smites set the foe and foes within 60 alight for 60% of the Smite.', mods: { sunfire: 1 }, max: 1 },
    blackflame: { name: 'Black Flame', rar: 'd', icon: 'ember', duo: ['fire', 'shadow'], desc: 'Burn still to come counts toward Doom: a foe is Reaped once its health falls to its Doom plus its Burn.', mods: { blackflame: 1 }, max: 1 },
    superconductor: { name: 'Superconductor', rar: 'd', icon: 'bolt', duo: ['ice', 'lightning'], desc: 'Discharges chill every foe they hit (as Frostbite, from their damage).', mods: { supercond: 1 }, max: 1 },
    cryotoxin: { name: 'Cryotoxin', rar: 'd', icon: 'potion', duo: ['ice', 'poison'], desc: "While frozen, a foe's Venom bonus is doubled.", mods: { cryotoxin: 1 }, max: 1 },
    hoarlight: { name: 'Hoarlight', rar: 'd', icon: 'gem', duo: ['ice', 'holy'], desc: "Smites chill the foe and foes within 70 by the Smite's damage.", mods: { hoarlight: 1 }, max: 1 },
    blackice: { name: 'Black Ice', rar: 'd', icon: 'snow', duo: ['ice', 'shadow'], desc: 'Frozen foes are Reaped at twice their Doom.', mods: { blackice: 1 }, max: 1 },
    galvanic: { name: 'Galvanic Venom', rar: 'd', icon: 'drop', duo: ['lightning', 'poison'], desc: 'Discharges build Venom in every foe they hit (from their damage).', mods: { galvanic: 1 }, max: 1 },
    wrathofheaven: { name: 'Wrath of Heaven', rar: 'd', icon: 'bolt', duo: ['lightning', 'holy'], desc: 'Every Smite calls a thunderbolt: 60% of the Smite as Lightning to foes within 70, and the smitten foe is charged with half of the bolt.', mods: { heavenwrath: 1 }, max: 1 },
    blacklightning: { name: 'Black Lightning', rar: 'd', icon: 'bolt', duo: ['lightning', 'shadow'], desc: 'Discharges mark 50% of their damage as Doom.', mods: { blackLight: 1 }, max: 1 },
    purge: { name: 'Purge', rar: 'd', icon: 'sun', duo: ['poison', 'holy'], desc: 'A Smite on a Corroded foe deals +50% and shields twice as much (still once per 3s each, at most 3%).', mods: { purge: 1 }, max: 1 },
    necrosis: { name: 'Necrosis', rar: 'd', icon: 'skull', duo: ['poison', 'shadow'], desc: "Venom raises the Reap line by up to 10% of the foe's health.", mods: { necrosis: 1 }, max: 1 },
    twilight: { name: 'Twilight', rar: 'd', icon: 'mask', duo: ['holy', 'shadow'], desc: "Each Reap forces a Smite on the nearest foe within 120, joined by a black-gold beam: its Radiance x1.5, and at least half a Smite's worth.", mods: { twilight: 1 }, max: 1 },
  };
  ED.BOON_IDS = Object.keys(B);
  ED.RARITY = {
    c: { name: 'Common', color: '#cfc6b6', w: 60 },
    r: { name: 'Rare', color: '#6fb2ff', w: 30 },
    e: { name: 'Epic', color: '#c98bff', w: 10 },
    l: { name: 'Legendary', color: '#ffb02e', w: 4 },
    d: { name: 'Duo', color: '#5ff2c0', w: 12 },
    a: { name: 'Ascended', color: '#ff5fd2', w: 0 },
    m: { name: 'Mutation', color: '#ff8a4a', w: 0 },
    t: { name: 'Twist', color: '#e8344e', w: 0 },
  };

  // Gate boon id per path.
  ED.PATH_GATE = {};
  for (const id in B) if (B[id].gate) ED.PATH_GATE[B[id].path] = id;

  // Path of a boon id, or null (open, duo and class boons).
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
  // Duo boon id of two element paths, or null.
  ED.duoOf = (a, b) => {
    for (const id in ED.BOONS) { const d = ED.BOONS[id].duo; if (d && d.includes(a) && d.includes(b) && a !== b) return id; }
    return null;
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
