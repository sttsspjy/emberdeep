// Class routes: every hero has four routes (Attack, Skill 1, Skill 2, Element), each a tier-1 card (the route) with two tier-2 forks. 72 cards, merged into ED.BOONS.
// The route card is offered to every hero at team level 3, the fork at the first boss; fork ranks 2 and 3 come with the second and fourth boss (see build.js rollOffer 'class').
// Card total at rank r = mods + up x (r - 1) + (r >= 3 ? r3 : 0) for every stat key (Stats.compute); slot damage (s1Dmg, s2Dmg) compounds across cards. Route and fork cards have no path: they never count toward affinity.
// Fields: tag (Heavy | Swift | Burst | Guard | Focus | Spread), plays (a T1 card's style line), forks ([idA, idB]), rider ('Name: sentence', appended from rank 3), coop (helps allies),
// weapon { kind: 'heavy' | 'swift', extra } (an attack fork's weapon transform; extra { mul: {field: factor}, add: {field: n}, ifNone: {field: value} } edits the fork after the rule).
// desc tokens: {key} the card's total as a percentage, {key:n} a number, {key:s} seconds, {key:ck} a number x the weapon's critK, {key:ck3} (3 + number) x critK, {key:a25} 2.5 + number, {key:dr} 15% + number; [text with tokens] is dropped while a token inside is 0.
(function (ED) {
  'use strict';
  const CB = ED.CLASS_BOONS = {};
  const card = (cls, route, tier, id, o) => { CB[id] = Object.assign({ rar: tier === 1 ? 'r' : 'e', cls, route, tier, max: tier === 1 ? 1 : 3, id }, o); };
  const BLEED = 'Your hits make foes Bleed for {bleedAll} of their damage, and every status you apply is {statusPow} stronger.';

  // ---------------- Knight (Shield Charge · Shield Throw) ----------------
  card('knight', 'attack', 1, 'k_atk', { name: 'Oath of Steel', icon: 'sword', forks: ['k_atk_h', 'k_atk_s'], plays: 'slash, slash, CLEAVE; time the Cleave into the pack.',
    desc: 'Every 3rd swing is a Cleave: +{cleave} damage, 40% more reach and arc, double knockback.', mods: { cleave: 0.6 } });
  card('knight', 'attack', 2, 'k_atk_h', { name: 'Oathbreaker', icon: 'hammer', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Your weapon becomes heavy (×1.8 slower, ×1.98 per hit; hits Stagger). Cleaves crack the ground: a shock at the swing tip (r72) deals {cShock} weapon damage and stuns {cStun:s}.[ Cleaves deal +{cleave} more.]',
    rider: 'Follow-Through: your first swing after a Shield Charge is a Cleave at +{chargeCleave}.', mods: { cShock: 0.5, cStun: 0.5 }, up: { cleave: 0.1, cShock: 0.15 }, r3: { chargeCleave: 0.5 } });
  card('knight', 'attack', 2, 'k_atk_s', { name: 'Sworn Blade', icon: 'blades', tag: 'Swift', weapon: { kind: 'swift' },
    desc: "Your weapon becomes swift (×0.55 interval, ×0.605 per hit; attacks give Flow). Cleaves deal +{cleave} more.[ +{atk} attack speed.] Parry: a Cleave that starts in the last 0.3 s of a foe's wind-up (its rim flashes white) cancels that attack and stuns it 0.6 s (elites: 0.3 s stun, no cancel; never bosses), at most once per 2.5 s.",
    rider: 'Riposte: each Parry readies {riposte:ck} guaranteed crits.', mods: { cleave: 0.3, parry: 1 }, up: { cleave: 0.1, atk: 0.03 }, r3: { riposte: 2 } });
  card('knight', 'skill1', 1, 'k_s1', { name: 'Vanguard', icon: 'shield', forks: ['k_s1_a', 'k_s1_b'], plays: 'charge in just before the big hit lands.',
    desc: 'Shield Charge recharges {s1Cdr} faster and deals +{s1Dmg}. After a Charge you are Braced for {brace:s}: {braceDR} less damage taken (at most once per 4 s).', mods: { s1Cdr: 0.3, s1Dmg: 0.25, brace: 1.5, braceDR: 0.25 } });
  card('knight', 'skill1', 2, 'k_s1_a', { name: 'Juggernaut', icon: 'star', tag: 'Burst',
    desc: 'Shield Charge goes 60% farther, deals +{s1Dmg}, and ends in a shockwave (r90) for {jugShock} of its impact.',
    rider: 'Shield Bash: each Charge ends by hurling a free Shield Throw along it at {bash} (no cooldown; it does not stun).', mods: { s1Range: 90, s1Dmg: 0.1, jugShock: 0.4 }, up: { s1Dmg: 0.1, jugShock: 0.1 }, r3: { bash: 0.6 } });
  card('knight', 'skill1', 2, 'k_s1_b', { name: 'Rallying Charge', icon: 'banner', tag: 'Guard', coop: true,
    desc: 'Where Shield Charge ends, you and allies within 100 gain a shield of {rally} max health (allies at most once per 8 s each). Its stun lasts {chargeStun:s} longer; Brace is {braceDR} stronger.',
    rider: 'Hold the Line: while you are Braced, allies within 100 are Braced too.', mods: { rally: 0.02, chargeStun: 0.5, braceDR: 0.05 }, up: { braceDR: 0.05, rally: 0.0025 }, r3: { braceAura: 100 } });
  card('knight', 'skill2', 1, 'k_s2', { name: 'Shieldmaster', icon: 'bulwark', forks: ['k_s2_a', 'k_s2_b'], plays: 'throw into every pack, catch, repeat.',
    desc: 'Shield Throw ricochets to {s2N:n} more foes, strikes +{s2Dmg}, and recharges {s2Cdr} faster.', mods: { s2N: 2, s2Dmg: 0.2, s2Cdr: 0.167 } });
  card('knight', 'skill2', 2, 'k_s2_a', { name: 'Shield Storm', icon: 'twin', tag: 'Burst',
    desc: 'Throw two shields in a V (±0.22 rad), each at {twinShield}, each with its own ricochets.[ Shield Throw deals +{s2Dmg}.]',
    rider: "Gathering Force: each ricochet adds +{gather} to that shield's next strike.", mods: { twinShield: 0.7 }, up: { s2Dmg: 0.1 }, r3: { gather: 0.15 } });
  card('knight', 'skill2', 2, 'k_s2_b', { name: 'Shield Orbit', icon: 'shieldgold', tag: 'Guard',
    desc: 'After you catch it, the shield orbits you for {orbit:s}, striking foes it passes for {orbitMul} of a strike (each once per 0.75 s) and destroying enemy shots it touches; each shot destroyed shortens the orbit by 0.75 s.',
    rider: 'Return to Sender: each shot the orbit destroys flies back as a shard at the nearest foe within 300 for {orbitReflect} of a strike.', mods: { orbit: 3, orbitMul: 0.15 }, up: { orbit: 0.5, orbitMul: 0.05 }, r3: { orbitReflect: 0.5 } });
  card('knight', 'element', 1, 'k_el', { name: 'Oath of Ruin', icon: 'fang', forks: ['k_el_a', 'k_el_b'], plays: 'everything you hit bleeds; stack ailments, then cash them in.', desc: BLEED, mods: { bleedAll: 0.1, statusPow: 0.15 } });
  card('knight', 'element', 2, 'k_el_a', { name: 'Brand of Ruin', icon: 'eye', tag: 'Focus', coop: true,
    desc: '+{brand} damage to a foe for each ailment on it (up to 4), from any hero.',
    rider: 'Ruin Seal: Shield Charge and Shield Throw strikes seal foes for {seal:s}; Sealed counts as one more ailment for every hero (bosses too).', mods: { brand: 0.06 }, up: { brand: 0.01 }, r3: { seal: 4 } });
  card('knight', 'element', 2, 'k_el_b', { name: 'Ruinous Blows', icon: 'axe', tag: 'Spread',
    desc: "Shield Charge and Shield Throw deal +{s1Dmg} and build your statuses at double strength, and the thrown shield carries wounds: each ricochet moves {carry} of the last foe's statuses to the next foe it strikes.",
    rider: 'Ruin Spreads: a foe killed by a shield strike hands {ruinSpread} of its statuses to each of the 2 nearest foes within 80.', mods: { ruinInf: 1, carry: 0.25, s1Dmg: 0.15, s2Dmg: 0.15 }, up: { carry: 0.1 }, r3: { ruinSpread: 0.5 } });

  // ---------------- Ranger (Volley · Rain of Arrows) ----------------
  card('ranger', 'attack', 1, 'r_atk', { name: 'Deadeye', icon: 'bow', forks: ['r_atk_h', 'r_atk_s'], plays: 'keep your distance; long shots ring.',
    desc: 'Your shots deal more the farther they fly: +0% at 80, rising to +{deadeye} at 260.', mods: { deadeye: 0.3 } });
  card('ranger', 'attack', 2, 'r_atk_h', { name: 'Ballista', icon: 'arrow', tag: 'Heavy', weapon: { kind: 'heavy', extra: { mul: { speed: 1.28 }, add: { pierce: 2 } } },
    desc: 'Heavy shots (×1.8 slower, ×1.98 per hit, Stagger) fly 28% faster than heavy shots usually do and pierce 2 more foes; each foe a shot passes through adds +{pierceRamp} to it.[ Deadeye is +{deadeye} stronger.]',
    rider: 'Splitting Bolt: a shot that passes through its last foe splits into 2 arrows (±0.3 rad) at {splitBolt}.', mods: { pierceRamp: 0.15 }, up: { pierceRamp: 0.1, deadeye: 0.05 }, r3: { splitBolt: 0.5 } });
  card('ranger', 'attack', 2, 'r_atk_s', { name: 'Quickdraw', icon: 'arrows', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift shots (×0.55 interval, ×0.605 per hit, Flow) deal +{wDmg} and slow foes {hitSlow} for 1 s (not bosses).[ Deadeye is +{deadeye} stronger.]',
    rider: 'Flurry: every {flurry:n}th shot fires 2 extra arrows in a narrow fan (±0.12 rad).', mods: { wDmg: 0.1, hitSlow: 0.15 }, up: { deadeye: 0.05, wDmg: 0.05 }, r3: { flurry: 5 } });
  card('ranger', 'skill1', 1, 'r_s1', { name: 'Fletcher', icon: 'arrows', forks: ['r_s1_a', 'r_s1_b'], plays: 'Volley is your main damage; cast it on cooldown.',
    desc: 'Volley fires {s1N:n} more arrows and recharges {s1Cdr} faster.', mods: { s1N: 3, s1Cdr: 0.2 } });
  card('ranger', 'skill1', 2, 'r_s1_a', { name: "Hunter's Mark", icon: 'eye', tag: 'Burst', coop: true,
    desc: 'Volley marks every foe it hits for {volleyMark:s}: marked foes take +{markV} damage from everyone.',
    rider: 'Relentless Hunt: when a marked foe dies, the mark leaps to the nearest unmarked foe within 120.', mods: { volleyMark: 4, markV: 0.12 }, up: { markV: 0.04 }, r3: { markLeap: 1 } });
  card('ranger', 'skill1', 2, 'r_s1_b', { name: 'Scattershot', icon: 'boot', tag: 'Guard',
    desc: 'Volley arrows deal +{volleyClose} to foes within 110 and knock them back 3× as hard, and Volley hops you 70 back from the cursor.',
    rider: 'Caltrops: the hop scatters caltrops where you stood (r50, 2.5 s): foes inside are slowed 40% and take 12 per second.', mods: { volleyClose: 0.4, volleyHop: 70 }, up: { volleyClose: 0.1 }, r3: { caltrops: 1 } });
  card('ranger', 'skill2', 1, 'r_s2', { name: 'Rainmaker', icon: 'rain', forks: ['r_s2_a', 'r_s2_b'], plays: 'drop a kill zone, kite foes through it.',
    desc: 'Rain of Arrows: +{s2Area} radius, lasts {s2Dur:s} longer, +{s2Dmg} damage.', mods: { s2Area: 0.3, s2Dur: 1, s2Dmg: 0.1 } });
  card('ranger', 'skill2', 2, 'r_s2_a', { name: 'Skyfall', icon: 'star', tag: 'Burst',
    desc: "The whole Rain lands at once 0.6 s after the cast: every volley's damage in one hit over a 15% wider area, stunning foes 0.5 s (not bosses).[ Rain deals +{s2Dmg} and is +{s2Area} wider.]",
    rider: 'Twin Sky: a second Skyfall lands 0.8 s later on the same spot at {skyTwin}.', mods: { skyfall: 1 }, up: { s2Dmg: 0.1, s2Area: 0.05 }, r3: { skyTwin: 0.5 } });
  card('ranger', 'skill2', 2, 'r_s2_b', { name: 'Hail of Thorns', icon: 'thorn', tag: 'Guard', coop: true,
    desc: 'Foes in the Rain are slowed 50% and take +20% damage (the same +20% as Judged).[ Rain deals +{s2Dmg}.]',
    rider: 'Second Shower: when the Rain ends, it falls again on the same spot for 2 s at {shower}.', mods: { rainHail: 1 }, up: { s2Dmg: 0.1 }, r3: { shower: 0.4 } });
  card('ranger', 'element', 1, 'r_el', { name: "Trapper's Craft", icon: 'leaf', forks: ['r_el_a', 'r_el_b'], plays: 'wound everything, and let the wounds work.', desc: BLEED, mods: { bleedAll: 0.1, statusPow: 0.15 } });
  card('ranger', 'element', 2, 'r_el_a', { name: 'Infected Wounds', icon: 'drop', tag: 'Focus',
    desc: 'Volley and Rain build your statuses {skillInfK} faster; your Bleed and Burn tick {bleedMul} harder.',
    rider: 'Gangrene: Volley and Rain deal +{festerHit} to foes with 3 or more ailments.', mods: { skillInfK: 0.5, bleedMul: 0.2, burnMul: 0.2 }, up: { bleedMul: 0.1, burnMul: 0.1 }, r3: { festerHit: 0.25 } });
  card('ranger', 'element', 2, 'r_el_b', { name: 'Contagion', icon: 'orb', tag: 'Spread',
    desc: 'When a foe with 2 or more ailments dies to your damage, {contagion} of each of its statuses passes to each of the 2 nearest foes within 100[ (+{contagionR:n})].',
    rider: 'Outbreak: it passes to the 3 nearest foes (33% each).', mods: { contagion: 0.5 }, up: { contagionR: 20 }, r3: { contagionN: 1 } });

  // ---------------- Pyromancer (Flame Nova · Meteor) ----------------
  card('pyro', 'attack', 1, 'p_atk', { name: 'Pyroclast', icon: 'flame', forks: ['p_atk_h', 'p_atk_s'], plays: 'plant your feet and pour fire; choose when to move.',
    desc: 'Standing still while attacking builds Channel: your weapon deals +{channel} every {chanStep:s}, up to +{chanCap}. Moving, or a pause longer than 0.6 s (1.25 attacks for slow weapons), resets it.', mods: { channel: 0.1, chanStep: 0.3, chanCap: 0.5 } });
  card('pyro', 'attack', 2, 'p_atk_h', { name: 'Magma Heart', icon: 'ember', tag: 'Heavy', weapon: { kind: 'heavy', extra: { ifNone: { explode: { r: 40, mul: 0.5 } } } },
    desc: 'Heavy shots (×1.8 slower, ×1.98 per hit, Stagger, 15% bigger blasts). Shots that have no blast gain one (r40, 50%), and every blast erupts again 0.4 s later at {aftershock}.',
    rider: 'Lava Pools: each aftershock leaves burning ground (2 s, {lavaPool} of the shot per second; a new pool on the same spot refreshes the old one).', mods: { aftershock: 0.3 }, up: { aftershock: 0.1 }, r3: { lavaPool: 0.3 } });
  card('pyro', 'attack', 2, 'p_atk_s', { name: 'Ember Rush', icon: 'bolt', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift shots (×0.55 interval, ×0.605 per hit, Flow). Channel builds twice as fast (every 0.15 s) and caps {chanCap} higher.',
    rider: 'Overheat: at full Channel your shots pierce 1 more foe and their blasts are 20% wider.', mods: { chanStep: -0.15, chanCap: 0.1 }, up: { chanCap: 0.05 }, r3: { overheat: 1 } });
  card('pyro', 'skill1', 1, 'p_s1', { name: 'Firestorm', icon: 'flame', forks: ['p_s1_a', 'p_s1_b'], plays: 'dive into packs and erupt.',
    desc: 'Flame Nova: +{s1Area} radius, +{s1Dmg} damage, recharges {s1Cdr} faster.', mods: { s1Area: 0.25, s1Dmg: 0.2, s1Cdr: 0.21 } });
  card('pyro', 'skill1', 2, 'p_s1_a', { name: 'Twin Nova', icon: 'twin', tag: 'Burst',
    desc: 'Nova erupts a second time 0.6 s later around you at {novaEcho}.',
    rider: 'Collapse: before the second eruption, foes within its radius are pulled {novaPull:n} px toward you.', mods: { novaEcho: 0.4 }, up: { novaEcho: 0.1 }, r3: { novaPull: 40 } });
  card('pyro', 'skill1', 2, 'p_s1_b', { name: 'Phoenix Mantle', icon: 'feather', tag: 'Guard',
    desc: 'Nova leaves a ring of fire (3 s), and if it hits a foe it shields you for {mantle} max health (at most once per 10 s).[ Nova deals +{s1Dmg}.]',
    rider: "Rebirth Flare: when the Mantle shield is used up, it bursts (r90) for {mantleBurst} of Nova's blast and knocks foes back.", mods: { novaRing: 1, mantle: 0.03 }, up: { s1Dmg: 0.1 }, r3: { mantleBurst: 0.5 } });
  card('pyro', 'skill2', 1, 'p_s2', { name: 'Starfall', icon: 'meteor', forks: ['p_s2_a', 'p_s2_b'], plays: 'call the sky down on every pack.',
    desc: 'Meteor: +{s2Dmg} damage; its crater lasts {s2Dur:s} longer.', mods: { s2Dmg: 0.15, s2Dur: 2 } });
  card('pyro', 'skill2', 2, 'p_s2_a', { name: 'Twin Meteor', icon: 'star', tag: 'Burst',
    desc: 'A second Meteor lands 0.6 s later on the foe nearest the impact (within 300) at {twinMeteor}.',
    rider: 'Meteor Shower: 0.3 s after each Meteor lands, 3 meteorites strike within 80 of it (r45, {meteorites} of the impact each).', mods: { twinMeteor: 0.6 }, up: { twinMeteor: 0.1 }, r3: { meteorites: 0.3 } });
  card('pyro', 'skill2', 2, 'p_s2_b', { name: 'Comet', icon: 'wing', tag: 'Guard',
    desc: 'You ride the Meteor: leap to the target point in 0.6 s (untouchable for the first 0.35 s) and land as the impact (+{comet}).',
    rider: 'Impact Crater: landing knocks foes back twice as far and stuns them {cometStun:s} (not bosses).', mods: { comet: 0.3 }, up: { comet: 0.1 }, r3: { cometStun: 0.5 } });
  card('pyro', 'element', 1, 'p_el', { name: 'Living Flame', icon: 'ember', forks: ['p_el_a', 'p_el_b'], plays: 'everything burns; weak and resisted strata matter.',
    desc: "Your skills deal +{classElMul} Fire damage, and your weapon sets foes alight for {wInfFire} of each hit (Kindle's rate counts instead when it is higher).", mods: { classElMul: 0.25, wInfFire: 0.15 } });
  card('pyro', 'element', 2, 'p_el_a', { name: 'White Heat', icon: 'flame', tag: 'Focus',
    desc: 'Your Burn deals +{burnMul}, and burning foes take +{searSkill} from your skills.',
    rider: 'Flashpoint: Nova and Meteor always crit foes whose Burn exceeds {burnCrit} of their health.', mods: { burnMul: 0.2, searSkill: 0.1 }, up: { burnMul: 0.1 }, r3: { burnCrit: 0.1 } });
  card('pyro', 'element', 2, 'p_el_b', { name: 'Heat Engine', icon: 'hourglass', tag: 'Spread',
    desc: "Each burning foe your Nova or Meteor hits cuts {heatEngine:s} from the other skill's cooldown (up to 1.5 s per cast).",
    rider: 'Chain Reaction: hitting {heatChain:n} or more burning foes with one cast refunds the other skill fully (at most once per 6 s).', mods: { heatEngine: 0.15 }, up: { heatEngine: 0.05 }, r3: { heatChain: 5 } });

  // ---------------- Shade (Shadowstep · Vanish) ----------------
  card('shade', 'attack', 1, 's_atk', { name: 'Bladedancer', icon: 'dagger', forks: ['s_atk_h', 's_atk_s'], plays: 'never stop; crit chains keep you hot.',
    desc: '+{crit} crit chance. Each crit grants Momentum: +{momentum} damage for 2.5 s, stacking {momMax:n} times.', mods: { crit: 0.08, momentum: 0.04, momMax: 5 } });
  card('shade', 'attack', 2, 's_atk_h', { name: 'Culling Blades', icon: 'wingblade', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Heavy blades (×1.8 slower, ×1.98 per hit, Stagger, wider reach): weapon hits on foes below {execCrit} health always crit.[ Crits deal +{critDmg} more.]',
    rider: 'Killing Rhythm: an execution crit that kills grants {execMom:n} Momentum.', mods: { execCrit: 0.25 }, up: { critDmg: 0.1 }, r3: { execMom: 3 } });
  card('shade', 'attack', 2, 's_atk_s', { name: 'Thousand Cuts', icon: 'blades', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift blades (×0.55 interval, ×0.605 per hit, Flow). Momentum holds {momMax:n} more stacks.',
    rider: 'Whirlwind: at full Momentum, every 4th attack also spins all around you at {bladeStorm} (knives: a ring of 6 at {bladeStorm}).', mods: { momMax: 2 }, up: { momMax: 1 }, r3: { bladeStorm: 0.6 } });
  card('shade', 'skill1', 1, 's_s1', { name: 'Ghost Walk', icon: 'cloak', forks: ['s_s1_a', 's_s1_b'], plays: 'blink through lines of foes, then unload.',
    desc: 'Shadowstep: +{s1Dmg} damage, recharges {s1Cdr} faster, and each foe it cuts readies {stepStack:ck} more crit attack (up to {stackMax:ck3}).', mods: { s1Cdr: 0.2, s1Dmg: 0.2, stepStack: 1, stackMax: 2 } });
  card('shade', 'skill1', 2, 's_s1_a', { name: 'Assassinate', icon: 'dagger', tag: 'Burst',
    desc: 'Shadowstep deals +{assassinate} to foes below 50% health, and a Shadowstep kill refunds it (at most once per 1.5 s).[ Shadowstep deals +{s1Dmg}.]',
    rider: 'Twin Cut: a second slash runs the Shadowstep path 0.15 s later at {stepTwin}.', mods: { assassinate: 0.4 }, up: { s1Dmg: 0.1 }, r3: { stepTwin: 0.5 } });
  card('shade', 'skill1', 2, 's_s1_b', { name: 'Afterimage', icon: 'mirror', tag: 'Guard',
    desc: 'Shadowstep leaves an afterimage where you stood; 1.2 s later it bursts (r80), hurting foes and blinding them 1 s (not bosses).[ Shadowstep deals +{s1Dmg}.]',
    rider: 'Lure: just before it bursts, the afterimage pulls foes within {afterPull:n} toward it.', mods: { afterimage: 1 }, up: { s1Dmg: 0.1 }, r3: { afterPull: 120 } });
  card('shade', 'skill2', 1, 's_s2', { name: 'Nightfall', icon: 'vanish', forks: ['s_s2_a', 's_s2_b'], plays: 'vanish, reposition, ambush.',
    desc: 'Vanish recharges {s2Cdr} faster; its smoke is {s2Area} wider, lasts {s2Dur:s} longer and foes inside take +20% damage; you move {stealthSpd} faster while unseen.', mods: { s2Cdr: 0.27, s2Area: 0.4, s2Dur: 2, smokeVuln: 1, stealthSpd: 0.3 } });
  card('shade', 'skill2', 2, 's_s2_a', { name: "Night's Edge", icon: 'mask', tag: 'Burst',
    desc: "Ambush deals ×{ambushMul:a25} of your weapon's base damage. An Ambush refunds Shadowstep; an Ambush kill refunds Vanish (at most once per 3 s).",
    rider: 'Ambush Sweep: Ambush also strikes every foe within {ambushCleave:n} of its target.', mods: { ambushMul: 1.5, nightsEdge: 1 }, up: { ambushMul: 0.25 }, r3: { ambushCleave: 70 } });
  card('shade', 'skill2', 2, 's_s2_b', { name: 'Veil of Night', icon: 'cloak', tag: 'Guard',
    desc: 'Vanish shields you for {veil} max health (at most once per 12 s); your smoke blinds each foe {veilBlind:s} longer (elites half); stealth lasts {stealthDur:s} longer.',
    rider: 'Shroud: your smoke slows foes 60% (from 40%) and lasts {s2Dur:s} longer.', mods: { veil: 0.03, veilBlind: 1, stealthDur: 1 }, up: { stealthDur: 0.5 }, r3: { shroud: 1, s2Dur: 2 } });
  card('shade', 'element', 1, 's_el', { name: 'Cruel Arts', icon: 'fang', forks: ['s_el_a', 's_el_b'], plays: 'open wounds, then rip them open.', desc: BLEED, mods: { bleedAll: 0.1, statusPow: 0.15 } });
  card('shade', 'element', 2, 's_el_a', { name: 'Open Veins', icon: 'drop', tag: 'Focus', coop: true,
    desc: 'Your crits deal +{veins} for each ailment on the foe (up to 4).',
    rider: 'Exsanguinate: crits on a foe with 4 ailments add Bleed equal to {exsang} of the hit.', mods: { veins: 0.1 }, up: { veins: 0.02 }, r3: { exsang: 0.25 } });
  card('shade', 'element', 2, 's_el_b', { name: 'Rupture', icon: 'heartbroken', tag: 'Spread',
    desc: "Shadowstep ruptures every foe it cuts and Ambush ruptures its target: {rupture} of the foe's Bleed and Burn hit at once at 150% (the pools lose that share), and half of the burst splashes foes within 60.",
    rider: 'Bloodbloom: a foe a rupture kills hands its remaining Bleed to the 2 nearest foes within 80.', mods: { rupture: 0.5 }, up: { rupture: 0.1 }, r3: { bloodbloom: 1 } });

  // ---------------- Cleric (Sanctuary · Judgment) ----------------
  card('cleric', 'attack', 1, 'c_atk', { name: 'Dawnbringer', icon: 'sun', forks: ['c_atk_h', 'c_atk_s'], plays: 'a stream of light ahead of every swing.', weapon: { extra: { ifNone: { wave: { every: 3, mul: 0.6 } } } },
    desc: 'Your waves of light come every 2nd attack and deal +{waveMul}; the Sacred Lantern gains waves too (60% of its damage).', mods: { waveEvery: -1, waveMul: 0.3 } });
  card('cleric', 'attack', 2, 'c_atk_h', { name: 'Sunhammer', icon: 'hammer', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Heavy weapon (×1.8 slower, ×1.98 per hit, Stagger). Your waves are twice as wide, travel 60% farther and stun foes {waveStun:s} (not bosses).[ Waves deal +{waveMul} more.]',
    rider: 'Solar Flare: each wave ends in a burst of light (r50) for {waveBurst} of the wave.', mods: { waveBig: 1, waveStun: 0.4 }, up: { waveMul: 0.1 }, r3: { waveBurst: 0.5 } });
  card('cleric', 'attack', 2, 'c_atk_s', { name: 'Crusader', icon: 'wing', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift weapon (×0.55 interval, ×0.605 per hit, Flow). Your waves steer toward foes within 25 degrees of where you aimed them and deal +{waveMul}.',
    rider: 'Litany: every {litany:n}th attack sends 3 waves in a fan (±0.25 rad).', mods: { waveHome: 2, waveMul: 0.1 }, up: { waveMul: 0.1 }, r3: { litany: 6 } });
  card('cleric', 'skill1', 1, 'c_s1', { name: 'Sanctum', icon: 'sun', forks: ['c_s1_a', 'c_s1_b'], plays: 'fight from holy ground.',
    desc: 'Sanctuary: +{s1Area} radius, lasts {s1Dur:s} longer (at most 60% of its cooldown), +{s1Dmg} damage; allies inside take {sanctDR:dr} less damage.', mods: { s1Area: 0.3, s1Dur: 2, s1Dmg: 0.5, sanctDR: 0.1 } });
  card('cleric', 'skill1', 2, 'c_s1_a', { name: 'Holy Fury', icon: 'star', tag: 'Burst',
    desc: 'Sanctuary deals +{s1Dmg} and stuns foes inside for {sanctStun:s} when cast (not bosses).',
    rider: 'Hallowed Ground: foes inside Sanctuary are Judged (+20% damage taken).', mods: { s1Dmg: 0.4, sanctStun: 1 }, up: { s1Dmg: 0.1 }, r3: { sanctJudge: 1 } });
  card('cleric', 'skill1', 2, 'c_s1_b', { name: 'Aura of Faith', icon: 'lantern', tag: 'Guard', coop: true,
    desc: 'Sanctuary centres on you and moves with you, but deals 40% less.[ Allies inside take {sanctDR} less damage again.]',
    rider: 'Embolden: allies (not you) inside your aura deal +{auraDmg} damage.', mods: { aura: 1, s1Dmg: -0.4 }, up: { sanctDR: 0.02 }, r3: { auraDmg: 0.1 } });
  card('cleric', 'skill2', 1, 'c_s2', { name: 'Hammer of Judgment', icon: 'hammer', forks: ['c_s2_a', 'c_s2_b'], plays: 'judge the pack, then the team cashes in.',
    desc: 'Judgment: +{s2Dmg} damage, flies {s2Range} farther, Judged lasts {judgeDur:s} longer, recharges {s2Cdr} faster.', mods: { s2Dmg: 0.3, s2Range: 0.4, judgeDur: 2, s2Cdr: 0.167 } });
  card('cleric', 'skill2', 2, 'c_s2_a', { name: 'Twin Hammers', icon: 'twin', tag: 'Burst',
    desc: 'Judgment throws two hammers in a V (±0.2 rad), each at {twinHammer}.[ Judgment deals +{s2Dmg}.]',
    rider: 'Second Flight: each hammer flies out once more after it returns (out, back, out, back).', mods: { twinHammer: 0.6 }, up: { s2Dmg: 0.1 }, r3: { thirdLeg: 1 } });
  card('cleric', 'skill2', 2, 'c_s2_b', { name: 'Verdict', icon: 'scroll', tag: 'Guard', coop: true,
    desc: 'Judged foes deal {judgeWeak} less damage (bosses half that). A Judged foe that dies bursts (r70) for Holy damage, stunning foes in it 0.4 s (not bosses).[ Judgment deals +{s2Dmg}.]',
    rider: 'Sentence: Verdict bursts Judge the foes they hit.', mods: { verdict: 1, judgeWeak: 0.2 }, up: { s2Dmg: 0.1 }, r3: { verdictJudge: 1 } });
  card('cleric', 'element', 1, 'c_el', { name: 'Radiant Faith', icon: 'sun', forks: ['c_el_a', 'c_el_b'], plays: 'every swing builds toward a Smite that shields the party.',
    desc: "Your skills deal +{classElMul} Holy damage, and your weapon stores Radiance for {wInfHoly} of each hit (Consecrate's rate counts instead when it is higher).", mods: { classElMul: 0.25, wInfHoly: 0.12 } });
  card('cleric', 'element', 2, 'c_el_a', { name: 'Guardian Light', icon: 'shieldgold', tag: 'Focus', coop: true,
    desc: 'Your Smites on elites and bosses deal +{smiteBig}, and heroes your Smites shield deal +{guardLight} damage for 6 s.',
    rider: 'Judging Light: your Smites Judge the foe for {smiteJudge:s}.', mods: { smiteBig: 0.5, guardLight: 0.08 }, up: { guardLight: 0.02 }, r3: { smiteJudge: 3 } });
  card('cleric', 'element', 2, 'c_el_b', { name: 'Prism', icon: 'arc', tag: 'Spread',
    desc: 'Your Smites deal +{smiteMul}, and a beam strikes the nearest other foe within 120 for {smiteBeam} of the Smite.',
    rider: 'Sunburst: the beam jumps once more, to another foe within 120, at half again.', mods: { smiteMul: 0.3, smiteBeam: 0.5 }, up: { smiteMul: 0.1 }, r3: { beamJumps: 1 } });

  // ---------------- Necromancer (Raise Legion · Bone Harvest) ----------------
  card('necro', 'attack', 1, 'n_atk', { name: 'Soul Command', icon: 'hand', forks: ['n_atk_h', 'n_atk_s'], plays: 'shoot to command the army.',
    desc: 'Your weapon deals +{wDmg} and Hexes what it hits for {hex:s}. Your minions rush the Hexed foe nearest you and deal +{hexMul} to Hexed foes.', mods: { wDmg: 0.2, hex: 3, hexMul: 0.2 } });
  card('necro', 'attack', 2, 'n_atk_h', { name: 'Gravecaller', icon: 'skull', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Heavy weapon (×1.8 slower, ×1.98 per hit, Stagger): each foe your weapon kills rises as a minion for 10 s (at most once per second).[ Hexed foes take +{hexMul} more from minions.]',
    rider: "Hex Burst: your weapon's Hex also lands on foes within {hexSpread:n} of the hit.", mods: { wRaise: 1 }, up: { hexMul: 0.1 }, r3: { hexSpread: 50 } });
  card('necro', 'attack', 2, 'n_atk_s', { name: 'Soul Barrage', icon: 'orb', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift weapon (×0.55 interval, ×0.605 per hit, Flow): foes you Hexed take +{hexSelf} from you.',
    rider: 'Quickened Dead: your minions attack {hexHaste} faster against foes you Hexed.', mods: { hexSelf: 0.1 }, up: { hexSelf: 0.05 }, r3: { hexHaste: 0.25 } });
  card('necro', 'skill1', 1, 'n_s1', { name: 'Endless Legion', icon: 'skull', forks: ['n_s1_a', 'n_s1_b'], plays: 'a standing army.',
    desc: '+{minions:n} max minion, Raise Legion raises {s1N:n} more, and your minions deal +{s1Dmg}.', mods: { minions: 1, s1N: 1, s1Dmg: 0.2 } });
  card('necro', 'skill1', 2, 'n_s1_a', { name: 'Bone Spikes', icon: 'bomb', tag: 'Burst',
    desc: 'Your minions burst when they expire, fall or are replaced (r60) for Shadow damage that marks Doom for half of it.[ Bursts deal +{s1Dmg} more.]',
    rider: 'Boneyard: a foe a Bone Spikes burst kills rises as a minion (at most once per 2 s).', mods: { boneSpikes: 1 }, up: { s1Dmg: 0.1 }, r3: { spikeRaise: 1 } });
  card('necro', 'skill1', 2, 'n_s1_b', { name: 'Bone Knights', icon: 'shield', tag: 'Guard',
    desc: 'Fewer, greater dead: at most 2 minions (Legion raises 2); each deals ×1.5, attacks every 0.5 s, cleaves foes within 30 of its target, and blocks enemy shots that touch it (each block costs it 1 s).[ Minions deal +{minionDmg} more.]',
    rider: 'Ironbone: Bone Knights last {knightLife} longer and stun the first foe they strike for {knightStun:s} (not bosses).', mods: { minions: -2, s1N: -2, knights: 1 }, up: { minionDmg: 0.1 }, r3: { knightLife: 0.5, knightStun: 0.5 } });
  card('necro', 'skill2', 1, 'n_s2', { name: 'Grim Harvest', icon: 'harvest', forks: ['n_s2_a', 'n_s2_b'], plays: 'build up, detonate, rebuild.',
    desc: 'Bone Harvest explosions deal +{s2Dmg} and are {s2Area} wider; it always raises {harvestRaise:n} after.', mods: { s2Dmg: 0.4, s2Area: 0.2, harvestRaise: 2 } });
  card('necro', 'skill2', 2, 'n_s2_a', { name: 'Corpse Explosion', icon: 'bomb', tag: 'Burst',
    desc: "Harvest also detonates up to {corpse:n} corpses (foes that died in the last 4 s) within 220 of you, each at {corpseMul} of a minion's burst.",
    rider: 'Bone Lances: before exploding, each minion flies to the foe nearest it within 200 and bursts on it for +{boneLance}.', mods: { corpse: 4, corpseMul: 0.7 }, up: { corpse: 1 }, r3: { boneLance: 0.25 } });
  card('necro', 'skill2', 2, 'n_s2_b', { name: 'Bone Armor', icon: 'harvest', tag: 'Guard',
    desc: 'Harvest shields you for {boneArmor} max health per minion harvested (up to {boneCap}, at most once per 12 s).',
    rider: 'Marrow Field: each harvested minion leaves bone shards (r40, 2 s) that slow foes 40%.', mods: { boneArmor: 0.02, boneCap: 0.05 }, up: { boneCap: 0.005 }, r3: { boneField: 1 } });
  card('necro', 'element', 1, 'n_el', { name: 'Grave Pact', icon: 'scroll', forks: ['n_el_a', 'n_el_b'], plays: 'the army Reaps for you.',
    desc: "Your skills deal +{classElMul} Shadow damage; your minions apply your statuses at 75% strength (from 50%) and mark Doom for {mInfShadow} of their damage (Mark of Doom's rate counts instead when it is higher).", mods: { classElMul: 0.25, minionInfuse: 0.25, mInfShadow: 0.2 } });
  card('necro', 'element', 2, 'n_el_a', { name: 'Abyssal Toll', icon: 'mask', tag: 'Focus',
    desc: 'Your Tolls deal +{tollMul}, and each Toll or Reaped elite empowers your minions +{abyssMin} for 6 s.',
    rider: "Abyssal Hunger: your minions' Doom counts double on elites and bosses.", mods: { tollMul: 0.4, abyssMin: 0.25 }, up: { tollMul: 0.1 }, r3: { abyssDoom: 1 } });
  card('necro', 'element', 2, 'n_el_b', { name: 'Rise Again', icon: 'hand', tag: 'Spread',
    desc: 'Every foe your Doom Reaps rises as a minion (at most once per 1.5 s); every boss Toll raises one.[ Minions deal +{minionDmg} more.]',
    rider: 'Risen Tide: minions risen this way deal +{tideMul} and last 4 s longer.', mods: { reapRaise: 1 }, up: { minionDmg: 0.1 }, r3: { tideMul: 0.3 } });

  Object.assign(ED.BOONS, CB);
  ED.BOON_IDS = Object.keys(ED.BOONS);

  // ---------------- route tables and helpers ----------------
  ED.ROUTES = ['attack', 'skill1', 'skill2', 'element'];
  ED.ELEMENT_ROUTE = { knight: 'Bleed', ranger: 'Bleed', pyro: 'Fire', shade: 'Bleed', cleric: 'Holy', necro: 'Shadow' };
  // ED.CLASS_CARDS[cls][route] = { t1: id, forks: [idA, idB] } (fork 0 = Heavy / Burst / Focus, fork 1 = Swift / Guard / Spread)
  ED.CLASS_CARDS = {};
  for (const id in CB) {
    const b = CB[id], tbl = ED.CLASS_CARDS[b.cls] || (ED.CLASS_CARDS[b.cls] = {});
    if (b.tier === 1) tbl[b.route] = { t1: id, forks: b.forks.slice() };
  }
  // Route label on a card or sheet row: 'Attack', the skill's name, or the element route's status ('Bleed', 'Fire', ...).
  ED.routeLabel = (cls, route) => {
    const c = ED.CLASSES[cls];
    return route === 'attack' ? 'Attack' : route === 'skill1' ? ED.SKILLS[c.skill].name : route === 'skill2' ? ED.SKILLS[c.skill2].name : ED.ELEMENT_ROUTE[cls];
  };
  // The hero's route state from its boons: { route, t1 (id), fork (id | null), rank (fork rank, 0 before a fork) }; route null before the level-3 pick.
  ED.classRoute = (boons, cls) => {
    const tbl = ED.CLASS_CARDS[cls], out = { route: null, t1: null, fork: null, rank: 0 };
    if (!tbl || !boons) return out;
    for (const r of ED.ROUTES) {
      const e = tbl[r];
      if (!(boons[e.t1] > 0)) continue;
      out.route = r; out.t1 = e.t1;
      for (const f of e.forks) if (boons[f] > 0) { out.fork = f; out.rank = boons[f]; }
      break;
    }
    return out;
  };
  // Total of every stat a class card gives at `rank`: mods + up x (rank - 1) + r3 from rank 3.
  ED.cardTotals = (b, rank) => {
    const t = {};
    for (const k in b.mods) t[k] = b.mods[k];
    if (rank >= 2 && b.up) for (const k in b.up) t[k] = (t[k] || 0) + b.up[k] * (rank - 1);
    if (rank >= 3 && b.r3) for (const k in b.r3) t[k] = (t[k] || 0) + b.r3[k];
    return t;
  };
  const trim = (v, d) => String(parseFloat(v.toFixed(d)));
  const fmtVal = (v, f, critK) => {
    switch (f) {
      case 'n': return trim(v, 1);
      case 's': return trim(v, 2) + ' s';
      case 'ck': return trim(Math.max(1, Math.round(v * critK)), 0);
      case 'ck3': return trim(Math.max(1, Math.round((3 + v) * critK)), 0);
      case 'a25': return trim(2.5 + v, 2);
      case 'dr': return trim((0.15 + v) * 100, 0) + '%';
      default: { const p = v * 100; return trim(p, Math.abs(p) >= 10 ? 0 : 2) + '%'; }
    }
  };
  const render = (tpl, tot, critK) => {
    let bad = false;
    const fill = (s) => s.replace(/\{(\w+)(?::(\w+))?\}/g, (m, k, f) => { const v = tot[k] || 0; if (!v) bad = true; return fmtVal(Math.abs(v) < 1e-9 ? 0 : v, f, critK); });
    return tpl.replace(/\[([^\]]*)\]/g, (m, seg) => { bad = false; const out = fill(seg); return bad ? '' : out; }).replace(/\{(\w+)(?::(\w+))?\}/g, (m, k, f) => fmtVal(tot[k] || 0, f, critK)).replace(/ {2,}/g, ' ').trim();
  };
  // Player-facing text of a boon: a class card at `rank` (default 1) with its numbers filled in (critK from the hero's stats `st`), else the boon's own desc.
  // The rider sentence joins from rank 3. Returns the string; ED.cardParts gives the pieces.
  ED.cardParts = (id, rank, st) => {
    const b = ED.BOONS[id];
    if (!b || !b.route) return { text: b ? b.desc : '', rider: '', riderName: '' };
    rank = Math.max(1, Math.min(b.max || 1, rank | 0 || 1));
    const tot = ED.cardTotals(b, rank), ck = (st && st.critK) || 1;
    const text = render(b.desc, tot, ck);
    let rider = '', riderName = '';
    if (b.rider) { const m = /^([^:]+): (.*)$/.exec(b.rider); riderName = m ? m[1] : ''; rider = m ? render(m[2], ED.cardTotals(b, 3), ck) : ''; }
    return { text, rider: rank >= 3 ? rider : '', riderName, riderFull: rider };
  };
  ED.boonText = (id, rank, st) => {
    const b = ED.BOONS[id];
    if (!b || !b.route) return b ? b.desc : '';
    const p = ED.cardParts(id, rank, st);
    return p.text + (p.rider ? ' ' + p.riderName + ': ' + p.rider : '');
  };
})(globalThis.ED || (globalThis.ED = {}));
