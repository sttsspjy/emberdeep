// Class routes: every hero has four routes (Attack, Skill 1, Skill 2, Element), each a tier-1 card (the route) with two tier-2 forks. 84 cards, merged into ED.BOONS.
// The route card is offered to every hero at team level 3, the fork at the first boss; fork ranks 2 and 3 are granted at the second and fourth boss (build.js W.grantForkRank).
// Card total at rank r = mods + up x (r - 1) + (r >= 2 ? r2 : 0) + (r >= 3 ? r3 : 0) for every stat key (Stats.compute); slot damage (s1Dmg, s2Dmg) compounds across cards. Route and fork cards have no path: they never count toward affinity.
// Fields: tag (Heavy | Swift | Burst | Guard | Focus | Spread), plays (a T1 card's style line), forks ([idA, idB]), rider2 ('Name: sentence', appended from rank 2),
// form ({ name, desc }: the rank-3 transform; its name replaces the card name from rank 3, see ED.cardName), coop (helps allies),
// weapon { kind: 'heavy' | 'swift', extra } (an attack fork's weapon transform; extra { mul: {field: factor}, add: {field: n}, ifNone: {field: value} } edits the fork after the rule).
// desc tokens: {key} the card's total as a percentage, {key:n} a number, {key:s} seconds, {key:ck} a number x the weapon's critK, {key:ck3} (3 + number) x critK, {key:a4} 4 + number (the Ambush factor), {key:r100} 100 + number, {key:dr} 15% + number; [text with tokens] is dropped while a token inside is 0.
(function (ED) {
  'use strict';
  const CB = ED.CLASS_BOONS = {};
  const card = (cls, route, tier, id, o) => { CB[id] = Object.assign({ rar: tier === 1 ? 'r' : 'e', cls, route, tier, max: tier === 1 ? 1 : 3, id }, o); };
  const BLEED = 'Your hits make foes Bleed for {bleedAll} of their damage, and every status you apply is {statusPow} stronger.';

  // ---------------- Knight (Shield Charge · Bulwark) ----------------
  card('knight', 'attack', 1, 'k_atk', { name: 'Oath of Steel', icon: 'sword', forks: ['k_atk_h', 'k_atk_s'], plays: 'slash, slash, CLEAVE; time the Cleave into the pack.',
    desc: 'Every 3rd swing is a Cleave: +{cleave} damage, 40% more reach and arc, double knockback.', mods: { cleave: 0.6 } });
  card('knight', 'attack', 2, 'k_atk_h', { name: 'Oathbreaker', icon: 'hammer', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Your weapon becomes heavy (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit; hits Stagger). Cleaves crack the ground: a shock at the swing tip (radius 72) deals {cShock} weapon damage and stuns {cStun:s}.[ Cleaves deal +{cleave} more.]',
    rider2: 'Follow-Through: your first swing after a Shield Charge is a Cleave at +{chargeCleave}.', mods: { cShock: 0.25, cStun: 0.3 }, up: { cleave: 0.1, cShock: 0.15 }, r2: { chargeCleave: 0.5 }, r3: { fissure: 0.8 },
    form: { name: 'Earthsplitter', desc: 'Each Cleave splits the ground ahead: a fissure runs 180 forward along your aim, erupts 0.25 s later and strikes every foe on it once for {fissure} weapon damage, stunning them {cStun:s}.' } });
  card('knight', 'attack', 2, 'k_atk_s', { name: 'Sworn Blade', icon: 'blades', tag: 'Swift', weapon: { kind: 'swift' },
    desc: "Your weapon becomes swift (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit; attacks give Flow). Cleaves deal +{cleave} more.[ +{atk} attack speed.] Parry: a Cleave that starts in the last 0.3 s of a foe's wind-up (its rim flashes white) cancels that attack and stuns it 0.6 s (elites: 0.3 s stun, no cancel; never bosses), at most once per 2.5 s.",
    rider2: 'Riposte: each Parry readies {riposte:ck} guaranteed crits.', mods: { cleave: 0.2, parry: 1 }, up: { cleave: 0.1, atk: 0.03 }, r2: { riposte: 2 }, r3: { bladeWave: 1 },
    form: { name: 'Thousand Edges', desc: 'Every Cleave launches a blade wave along your aim, 180 long and 24 wide, that pierces every foe on it for {bladeWave} weapon damage. A Parry launches 3 waves in a fan instead.' } });
  card('knight', 'skill1', 1, 'k_s1', { name: 'Vanguard', icon: 'shield', forks: ['k_s1_a', 'k_s1_b'], plays: 'charge in just before the big hit lands.',
    desc: 'Shield Charge recharges {s1Cdr} faster and deals +{s1Dmg}. After a Charge you are Braced for {brace:s}: {braceDR} less damage taken (at most once per 4 s).', mods: { s1Cdr: 0.3, s1Dmg: 0.25, brace: 1.5, braceDR: 0.25 } });
  card('knight', 'skill1', 2, 'k_s1_a', { name: 'Juggernaut', icon: 'star', tag: 'Burst',
    desc: 'Shield Charge goes 60% farther, deals +{s1Dmg}, and ends in a shockwave (radius 90) for {jugShock} of its impact.',
    rider2: 'Shield Bash: each Charge ends in a free Bulwark bash along it at {bash} (no cooldown, no stored power, no stun).', mods: { s1Range: 90, s1Dmg: 0.1, jugShock: 0.4 }, up: { s1Dmg: 0.1, jugShock: 0.1 }, r2: { bash: 0.3 }, r3: { avalanche: 0.9, avaCrack: 0.3, avaStun: 0.8 },
    form: { name: 'Avalanche', desc: "Foes in the Charge's path are carried along with you (elites are knocked aside, bosses stand). The shockwave becomes a giant slam (radius 160) for {avalanche} of the impact that stuns foes {avaStun:s}, and 3 cracks run 220 outward from it and erupt 0.3 s later for {avaCrack} of the impact. Bosses take ×1.5 from the slam and are never stunned." } });
  card('knight', 'skill1', 2, 'k_s1_b', { name: 'Rallying Charge', icon: 'banner', tag: 'Guard', coop: true,
    desc: 'Where Shield Charge ends, you and allies within 100 gain a shield of {rally} max health (allies at most once per 8 s each). Its stun lasts {chargeStun:s} longer; Brace is {braceDR} stronger; Shield Charge deals +{s1Dmg}.',
    rider2: 'Hold the Line: while you are Braced, allies within 100 are Braced too.', mods: { rally: 0.02, chargeStun: 0.5, braceDR: 0.1, s1Dmg: 0.6 }, up: { braceDR: 0.025, rally: 0.0025, s1Dmg: 0.3 }, r2: { braceAura: 100 }, r3: { phalanx: 1, bannerSlow: 0.4, bannerWeak: 0.25, bannerDur: 5, bannerDmg: 0.08 },
    form: { name: 'Iron Phalanx', desc: 'The Charge sweeps a band 70 wide and destroys foe shots in it. Where it ends it plants a War Banner for {bannerDur:s} (radius 120) and pulses a 0.4 s stun: foes inside are slowed {bannerSlow}, deal {bannerWeak} less damage (bosses half as much) and take {bannerDmg} of the Charge impact every second, and you and allies inside are Braced.' } });
  card('knight', 'skill2', 1, 'k_s2', { name: 'Shieldmaster', icon: 'bulwark', forks: ['k_s2_a', 'k_s2_b'], plays: 'raise the shield into the big hit, then bash back.',
    desc: 'Bulwark stores {s2N:n} more blocked attacks, bashes for +{s2Dmg}, and recharges {s2Cdr} faster.', mods: { s2N: 2, s2Dmg: 0.2, s2Cdr: 0.167 } });
  card('knight', 'skill2', 2, 'k_s2_a', { name: 'Shield Slam', icon: 'twin', tag: 'Burst',
    desc: 'Your Bulwark bash deals +{s2Dmg}.',
    rider2: 'Gathering Force: each blocked attack stores +{gather} more power (+25% becomes +55%).', mods: { s2Dmg: 0.35 }, up: { s2Dmg: 0.7 }, r2: { gather: 0.3 }, r3: { tempest: 1, vortexMul: 0.03, vortexDur: 2.5 },
    form: { name: 'Aegis Tempest', desc: 'The bash opens a vortex at its tip for {vortexDur:s} (radius 100): it pulls foes in (not bosses) and strikes every foe inside 4 times a second for {vortexMul} of the bash per stored block (at least one).' } });
  card('knight', 'skill2', 2, 'k_s2_b', { name: 'Shield Wall', icon: 'shieldgold', tag: 'Guard',
    desc: 'The raised shield covers 180 degrees, and every foe whose attack it blocks is stunned {wallStun:s} (at most once per 1 s per foe; not bosses).[ Bulwark bash deals +{s2Dmg}.]',
    rider2: 'Return to Sender: every shot the shield blocks flies back at its shooter for {sendBack} of a bash.', mods: { shieldWall: 1, wallStun: 0.3, s2Dmg: 0.5 }, up: { s2Dmg: 0.8 }, r2: { sendBack: 0.5 }, r3: { bastion: 4, bastionWard: 0.005, s2Dmg: 0.5 },
    form: { name: 'Bastion', desc: 'You can hold the shield up to {bastion:s}, and each blocked attack shields you for {bastionWard} max health (up to 2% per raise, at most once per 6 s).' } });
  card('knight', 'element', 1, 'k_el', { name: 'Oath of Ruin', icon: 'fang', forks: ['k_el_a', 'k_el_b'], plays: 'everything you hit bleeds; stack ailments, then cash them in.', desc: BLEED, mods: { bleedAll: 0.16, statusPow: 0.15 } });
  card('knight', 'element', 2, 'k_el_a', { name: 'Brand of Ruin', icon: 'eye', tag: 'Focus', coop: true,
    desc: '+{brand} damage to a foe for each of its first {brandCap:n} ailments, from any hero.',
    rider2: 'Ruin Seal: Shield Charge and Bulwark bash strikes seal foes for {seal:s}; Sealed counts as one more ailment for every hero (bosses too).', mods: { brand: 0.08, brandCap: 4 }, up: { brand: 0.01 }, r2: { seal: 4 }, r3: { doombrand: 1, brandMark: 0.2, brandCap: 2, brand: 0.02 },
    form: { name: 'Doombrand', desc: 'Brand now counts up to {brandCap:n} ailments. A foe holding 4 or more ailments is Doombranded for 4 s: Marked, it takes +{brandMark} damage from every hero (the strongest Mark on a foe applies).' } });
  card('knight', 'element', 2, 'k_el_b', { name: 'Ruinous Blows', icon: 'axe', tag: 'Spread',
    desc: "Shield Charge and Bulwark deal +{s1Dmg} and build your statuses at double strength, and the bash spreads wounds: it moves {carry} of each struck foe's statuses to the 2 nearest foes within 60 it did not strike.",
    rider2: 'Ruin Spreads: a foe killed by a bash hands {ruinSpread} of its statuses to each of the 2 nearest foes within 80.', mods: { ruinInf: 1, carry: 0.25, s1Dmg: 0.15, s2Dmg: 0.15 }, up: { carry: 0.1, s1Dmg: 0.15, s2Dmg: 0.15 }, r2: { ruinSpread: 0.5, s1Dmg: 0.55, s2Dmg: 0.55 }, r3: { bloodquake: 1, bloodquakeMul: 1, bloodquakeSplash: 0.8 },
    form: { name: 'Bloodquake', desc: 'A Shield Charge or Bulwark bash strike on a foe with 3 or more ailments detonates its wounds: its Bleed pool hits it at once for {bloodquakeMul} more than it would have dealt, and {bloodquakeSplash} of the amount paid bursts to foes within 80, who start Bleeding for it (at most once per second per foe).' } });

  // ---------------- Ranger (Volley · Rain of Arrows) ----------------
  card('ranger', 'attack', 1, 'r_atk', { name: 'Deadeye', icon: 'bow', forks: ['r_atk_h', 'r_atk_s'], plays: 'keep your distance; long shots ring.',
    desc: 'Your shots deal more the farther they fly: +0% at 80, rising to +{deadeye} at 260.', mods: { deadeye: 0.4 } });
  card('ranger', 'attack', 2, 'r_atk_h', { name: 'Ballista', icon: 'arrow', tag: 'Heavy', weapon: { kind: 'heavy', extra: { mul: { speed: 1.28 }, add: { pierce: 2 } } },
    desc: 'Heavy shots (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Stagger) fly 28% faster than heavy shots usually do and pierce 2 more foes; each foe a shot passes through adds +{pierceRamp} to it. Shots deal +{wDmg}.[ Deadeye is +{deadeye} stronger.]',
    rider2: 'Splitting Bolt: a shot that passes through its last foe splits into 2 arrows in a V at {splitBolt}.', mods: { pierceRamp: 0.15, wDmg: 0.2 }, up: { pierceRamp: 0.1, deadeye: 0.05 }, r2: { splitBolt: 0.5 }, r3: { siege: 5, siegeMul: 1.8, siegeBlast: 0.3 },
    form: { name: 'Siege Ballista', desc: 'One shot in {siege:n} is a siege bolt: it pierces every foe, is twice as wide, deals ×{siegeMul:x} damage and ends in a blast (radius 60) for {siegeBlast} of the shot when it hits a wall, a guard or the end of its range.' } });
  card('ranger', 'attack', 2, 'r_atk_s', { name: 'Quickdraw', icon: 'arrows', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift shots (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Flow) deal +{wDmg} and slow foes {hitSlow} for 1 s (not bosses).[ Deadeye is +{deadeye} stronger.]',
    rider2: 'Flurry: every {flurry:n}th shot fires 2 extra arrows in a narrow fan, each at {flurryMul} of a shot.', mods: { wDmg: 0.07, hitSlow: 0.15 }, up: { deadeye: 0.05, wDmg: 0.05 }, r2: { flurry: 4, flurryMul: 0.45 }, r3: { ricochet: 0.4, flurryN: 1 },
    form: { name: 'Storm Bow', desc: "Each shot ricochets once to the nearest other foe within 140 for {ricochet} of its damage, and Flurry's extra arrows rise by {flurryN:n}." } });
  card('ranger', 'skill1', 1, 'r_s1', { name: 'Fletcher', icon: 'arrows', forks: ['r_s1_a', 'r_s1_b'], plays: 'Volley is your main damage; cast it on cooldown.',
    desc: 'Volley fires {s1N:n} more arrows and recharges {s1Cdr} faster.', mods: { s1N: 3, s1Cdr: 0.2 } });
  card('ranger', 'skill1', 2, 'r_s1_a', { name: "Hunter's Mark", icon: 'eye', tag: 'Burst', coop: true,
    desc: 'Volley marks every foe it hits for {volleyMark:s}: marked foes take +{markV} damage from everyone. Volley deals +{s1Dmg}.',
    rider2: 'Relentless Hunt: when a marked foe dies, the mark leaps to the nearest unmarked foe within 120.', mods: { volleyMark: 4, markV: 0.12, s1Dmg: 0.15 }, up: { markV: 0.04, s1Dmg: 0.3 }, r2: { markLeap: 1 }, r3: { deathMark: 0.2, deathWave: 0.1 },
    form: { name: 'Death Mark', desc: 'Volley looses 3 waves 0.12 s apart (the 2nd and 3rd at {deathWave}), and its arrows steer gently toward marked foes. A marked foe that dies bursts into 4 piercing arrows, each {deathMark} of a Volley arrow.' } });
  card('ranger', 'skill1', 2, 'r_s1_b', { name: 'Scattershot', icon: 'boot', tag: 'Guard',
    desc: 'Volley arrows deal +{volleyClose} to foes within 110 and knock them back 3× as hard, every arrow slows its foe {volleySlow} for 1.2 s (bosses half as much), and Volley hops you 70 back from the cursor.',
    rider2: 'Caltrops: the hop scatters caltrops where you stood (radius 50, 2.5 s): foes inside are slowed 40% and take {caltrops} of a Volley arrow every second.', mods: { volleyClose: 0.4, volleyHop: 70, volleySlow: 0.3 }, up: { volleyClose: 0.1 }, r2: { caltrops: 0.3 }, r3: { thornburst: 20, thornRoot: 0.5, thornMul: 3, thornR: 37 },
    form: { name: 'Thornburst', desc: 'Volley becomes a full ring of {thornburst:n} arrows, each dealing ×{thornMul:x} and piercing 3 foes (the close-range bonus stays), and still hops you back. The caltrops cover three times the area (radius 87) and root foes that enter them for {thornRoot:s} (not bosses; once per foe per patch).' } });
  card('ranger', 'skill2', 1, 'r_s2', { name: 'Rainmaker', icon: 'rain', forks: ['r_s2_a', 'r_s2_b'], plays: 'drop a kill zone, kite foes through it.',
    desc: 'Rain of Arrows: +{s2Area} radius, lasts {s2Dur:s} longer, +{s2Dmg} damage.', mods: { s2Area: 0.3, s2Dur: 1, s2Dmg: 0.1 } });
  card('ranger', 'skill2', 2, 'r_s2_a', { name: 'Skyfall', icon: 'star', tag: 'Burst',
    desc: "The whole Rain lands at once 0.5 s after the cast: every volley's damage in one hit over a 30% wider area, stunning foes 0.5 s (not bosses).[ Rain deals +{s2Dmg} and is +{s2Area} wider.]",
    rider2: 'Twin Sky: a second Skyfall lands 0.8 s later on the same spot at {skyTwin}.', mods: { skyfall: 1 }, up: { s2Dmg: 0.1, s2Area: 0.05 }, r2: { skyTwin: 0.4 }, r3: { starfall: 0.45 },
    form: { name: 'Starfall Barrage', desc: 'Skyfall becomes 5 impacts that walk from you to the cursor, 0.12 s apart (replacing the single landing and Twin Sky): each lands in radius 70 for {starfall} of a Skyfall and stuns foes 0.4 s (not bosses).' } });
  card('ranger', 'skill2', 2, 'r_s2_b', { name: 'Hail of Thorns', icon: 'thorn', tag: 'Guard', coop: true,
    desc: 'Foes in the Rain are slowed 50% and take +20% damage (does not stack with other +20% vulnerabilities).',
    rider2: 'Second Shower: when the Rain ends, it falls again on the same spot for 2 s at {shower}.', mods: { rainHail: 1 }, r2: { shower: 0.15 }, r3: { thornstorm: 1.5 },
    form: { name: 'Storm of Thorns', desc: 'The Rain follows your cursor at 120 per second and lasts {thornstorm:n} times as long, leaving a bramble patch (radius 40, 3 s, slowing foes 30%) every 0.5 s along its path. The Second Shower falls where the Rain ends.' } });
  card('ranger', 'element', 1, 'r_el', { name: "Trapper's Craft", icon: 'leaf', forks: ['r_el_a', 'r_el_b'], plays: 'wound everything, and let the wounds work.', desc: BLEED, mods: { bleedAll: 0.1, statusPow: 0.15 } });
  card('ranger', 'element', 2, 'r_el_a', { name: 'Infected Wounds', icon: 'drop', tag: 'Focus',
    desc: 'Volley and Rain build your statuses {skillInfK} faster; your Bleed and Burn tick {bleedMul} harder.',
    rider2: 'Gangrene: Volley and Rain deal +{festerHit} to foes with 3 or more ailments.', mods: { skillInfK: 0.5, bleedMul: 0.2, burnMul: 0.2 }, up: { bleedMul: 0.1, burnMul: 0.1 }, r2: { festerHit: 0.9 }, r3: { hemo: 1, hemoAt: 0.04, hemoMul: 3, hemoBoss: 0.003 },
    form: { name: 'Hemorrhage', desc: 'Your hit on a foe whose Bleed has reached {hemoAt} of its max health (bosses: {hemoBoss}) makes the whole pool hit at once for ×{hemoMul:x} and empties it. At most once per second per foe (bosses: every 4 s).' } });
  card('ranger', 'element', 2, 'r_el_b', { name: 'Contagion', icon: 'orb', tag: 'Spread',
    desc: 'When a foe with 2 or more ailments dies to your damage, {contagion} of each of its statuses passes to each of the 2 nearest foes within {contagionR:r100}.',
    rider2: 'Outbreak: it passes to the 3 nearest foes ({outbreak} each).', mods: { contagion: 0.5 }, up: { contagionR: 20 }, r2: { contagionN: 1, outbreak: 0.9 }, r3: { plague: 1, plagueBurst: 0.85 },
    form: { name: 'Plaguebearer', desc: 'A foe with 2 or more ailments that dies to your damage bursts (radius 90): every foe inside takes {plagueBurst} of its remaining Bleed and Burn at once and catches its other statuses.' } });

  // ---------------- Pyromancer (Flame Nova · Meteor · Fireball) ----------------
  card('pyro', 'attack', 1, 'p_atk', { name: 'Spellweaver', icon: 'flame', forks: ['p_atk_h', 'p_atk_s'], plays: 'bolt between spells; every hit brings the next spell sooner.',
    desc: 'Your bolt hits cut your spell cooldowns {emberMul} more (still at most 0.8 s per second), and Fireball holds {s3Ch:n} more charge.', mods: { emberMul: 0.5, s3Ch: 1 } });
  card('pyro', 'attack', 2, 'p_atk_h', { name: 'Kindling', icon: 'ember', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Heavy bolts (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Stagger). Each bolt hit stores a Spark, up to {sparkMax:n}. Your next Nova, Meteor or Fireball spends them all: +{spark} damage per Spark.',
    rider2: 'Flashfire: every {flashfire:n}th Spark your spells spend gives back a Fireball charge.', mods: { spark: 0.12, sparkMax: 3 }, up: { spark: 0.04 }, r2: { flashfire: 6 }, r3: { pyreBolt: 0.9 },
    form: { name: 'Pyre Bolt', desc: 'Your bolts burst where they hit (radius 36) for {pyreBolt} of the hit.' } });
  card('pyro', 'attack', 2, 'p_atk_s', { name: 'Quickcast', icon: 'bolt', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift bolts (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Flow). Afterburn: after each Nova, Meteor or Fireball, your next {afterN:n} attacks fire 2 extra bolts in a narrow fan, each at {afterburn} of a bolt.',
    rider2: 'Chain Cast: a spell cast within 1.5 s of a different spell deals +{chainCast}.', mods: { afterburn: 0.25, afterN: 3 }, up: { afterburn: 0.05 }, r2: { chainCast: 0.05 }, r3: { stormT: 2, afterburn: 0.4 },
    form: { name: 'Spell Storm', desc: 'For {stormT:s} after each spell, every attack fires 4 extra bolts in a fan instead (no 3-attack limit).' } });
  card('pyro', 'skill1', 1, 'p_s1', { name: 'Firestorm', icon: 'flame', forks: ['p_s1_a', 'p_s1_b'], plays: 'dive into packs and erupt.',
    desc: 'Flame Nova: +{s1Area} radius, +{s1Dmg} damage, recharges {s1Cdr} faster.', mods: { s1Area: 0.25, s1Dmg: 0.2, s1Cdr: 0.2 } });
  card('pyro', 'skill1', 2, 'p_s1_a', { name: 'Twin Nova', icon: 'twin', tag: 'Burst',
    desc: 'Nova erupts a second time 0.6 s later around you at {novaEcho}.',
    rider2: 'Collapse: before the second eruption, foes within its radius are pulled {novaPull:n} px toward you.', mods: { novaEcho: 0.5 }, up: { novaEcho: 0.2 }, r2: { novaPull: 40 }, r3: { supernova: 2, novaEcho: 0.3, supernovaPull: 30 },
    form: { name: 'Supernova', desc: "The second eruption becomes a shockwave that grows from the Nova's radius to radius 220 over 0.5 s, striking every foe it crosses for {novaEcho} of the Nova. Then the centre collapses and pulls foes {supernovaPull:n} px inward (not bosses). The Nova's Burn is {supernova:n} times as strong." } });
  card('pyro', 'skill1', 2, 'p_s1_b', { name: 'Phoenix Mantle', icon: 'feather', tag: 'Guard',
    desc: 'Nova leaves a ring of fire (3 s), and if it hits a foe it shields you for {mantle} max health (at most once per 10 s).[ Nova deals +{s1Dmg}.]',
    rider2: "Rebirth Flare: when the Mantle shield is used up, it bursts (radius 90) for {mantleBurst} of Nova's blast and knocks foes back.", mods: { novaRing: 1, mantle: 0.03 }, up: { s1Dmg: 0.05 }, r2: { mantleBurst: 0.5 }, r3: { phoenixMul: 1.4, phoenixDur: 4, dashTrail: 0.5, phoenixSlow: 0.4 },
    form: { name: 'Phoenix Form', desc: "The ring of fire follows you for {phoenixDur:s} (radius 70) and burns {phoenixMul:n} times as hard; foes inside it are slowed {phoenixSlow}. While it burns, you leave a trail of fire patches as you move (radius 24, 2 s, one every 40 px) that deal {dashTrail} of the ring's damage per second." } });
  card('pyro', 'skill2', 1, 'p_s2', { name: 'Starfall', icon: 'meteor', forks: ['p_s2_a', 'p_s2_b'], plays: 'call the sky down on every pack.',
    desc: 'Meteor: +{s2Dmg} damage; its crater lasts {s2Dur:s} longer.', mods: { s2Dmg: 0.15, s2Dur: 2 } });
  card('pyro', 'skill2', 2, 'p_s2_a', { name: 'Twin Meteor', icon: 'star', tag: 'Burst',
    desc: 'A second Meteor lands 0.6 s later on the foe nearest the impact (within 300) at {twinMeteor}. Meteor deals +{s2Dmg}.',
    rider2: 'Meteor Shower: 0.3 s after each Meteor lands, 3 meteorites strike within 80 of it (radius 45, {meteorites} of the impact each).', mods: { twinMeteor: 0.3, s2Dmg: 0.15 }, up: { twinMeteor: 0.1, s2Dmg: 0.05 }, r2: { meteorites: 0.06 }, r3: { cataclysm: 0.42 },
    form: { name: 'Cataclysm', desc: "Meteor falls as five: one on the cursor and four around it at 80 px, 0.1 s apart, each for {cataclysm} of an impact (they replace the second Meteor and the Shower). Their craters merge into one lava field (radius 140) that burns for the crater's duration." } });
  card('pyro', 'skill2', 2, 'p_s2_b', { name: 'Comet', icon: 'wing', tag: 'Guard',
    desc: 'You ride the Meteor: leap to the target point in 0.6 s (untouchable for the first 0.35 s) and land as the impact (+{comet}). Meteor deals +{s2Dmg}.',
    rider2: 'Impact Crater: landing knocks foes back twice as far, stuns them {cometStun:s} (not bosses) and leaves a crater that burns {craterMul:n} times as hard.', mods: { comet: 0.1, s2Dmg: 0.2 }, up: { comet: 0.05, s2Dmg: 0.1 }, r2: { cometStun: 0.5, craterMul: 2 }, r3: { sunDive: 0.6, diveTrail: 0.3 },
    form: { name: 'Sun Dive', desc: "You are untouchable for the whole leap and for 0.6 s after each landing. 0.5 s after you land you leap again toward the cursor (as far as the Meteor reaches) and land as a second impact at {sunDive} of the first. Both flights leave a burning trail that deals {diveTrail} of the crater's damage per second." } });
  card('pyro', 'element', 1, 'p_el', { name: 'Living Flame', icon: 'ember', forks: ['p_el_a', 'p_el_b'], plays: 'everything burns; keep the fire going.',
    desc: "Your spells deal +{classElMul} Fire damage, and your bolts add Burn for {wInfFire} of each hit (the Flame path's rate counts instead when it is higher).", mods: { classElMul: 0.25, wInfFire: 0.15 } });
  card('pyro', 'element', 2, 'p_el_a', { name: 'White Heat', icon: 'flame', tag: 'Focus',
    desc: 'Your Burn deals +{burnMul}, and burning foes take +{searSkill} from your spells.',
    rider2: 'Flashpoint: your spells always crit a foe that has burned for {flashT:s} without a break.', mods: { burnMul: 0.25, searSkill: 0.1 }, up: { burnMul: 0.05 }, r2: { flashT: 6 }, r3: { whiteHot: 0.4, whiteT: 3 },
    form: { name: 'White Flame', desc: 'A foe that has burned for {whiteT:s} without a break turns white-hot: it takes +{whiteHot} damage from all your hits.' } });
  card('pyro', 'element', 2, 'p_el_b', { name: 'Heat Engine', icon: 'hourglass', tag: 'Spread',
    desc: "Each burning foe your Nova or Meteor hits cuts {heatEngine:s} from the other skill's cooldown (up to 1.5 s per cast).[ Nova and Meteor deal +{s1Dmg}.]",
    rider2: 'Chain Reaction: hitting {heatChain:n} or more burning foes with one cast refunds the other skill fully (at most once per 6 s).', mods: { heatEngine: 0.15 }, up: { heatEngine: 0.05 }, r2: { heatChain: 2, s1Dmg: 0.15, s2Dmg: 0.15 }, r3: { heatMax: 4, infernoMul: 2 },
    form: { name: 'Inferno Engine', desc: 'Each burning foe your Nova or Meteor hits stores 1 Heat (a boss 3), up to {heatMax:n}. At full Heat your next Nova or Meteor is an Inferno: radius ×1.4, ×{infernoMul:x} damage and Burn, and the Heat empties.' } });

  // ---------------- Shade (Shadowstep · Vanish) ----------------
  card('shade', 'attack', 1, 's_atk', { name: 'Bladedancer', icon: 'dagger', forks: ['s_atk_h', 's_atk_s'], plays: 'never stop; crit chains keep you hot.',
    desc: '+{crit} crit chance. Each crit grants Momentum: +{momentum} damage for 2.5 s, stacking {momMax:n} times.', mods: { crit: 0.08, momentum: 0.04, momMax: 5 } });
  card('shade', 'attack', 2, 's_atk_h', { name: 'Culling Blades', icon: 'wingblade', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Heavy blades (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Stagger, wider reach): weapon hits on foes below {execCrit} health always crit.[ Crits deal +{critDmg} more.]',
    rider2: 'Killing Rhythm: an execution crit that kills grants {execMom:n} Momentum (not on horde foes).', mods: { execCrit: 0.1 }, up: { critDmg: 0.03 }, r2: { execMom: 3 }, r3: { execCrit: 0.4, guillotine: 3 },
    form: { name: 'Guillotine', desc: 'The execution line rises to {execCrit} health. An execution crit that kills carries to the nearest foe within 100 below that line: a free execution strike at the same damage, up to {guillotine:n} times per attack.' } });
  card('shade', 'attack', 2, 's_atk_s', { name: 'Thousand Cuts', icon: 'blades', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift blades (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Flow). Momentum holds {momMax:n} more stacks.',
    rider2: 'Whirlwind: at full Momentum, every 4th attack also spins all around you at {bladeStorm} (knives: a ring of 6 at {bladeStorm}).', mods: { momMax: 1 }, up: { momMax: 1 }, r2: { bladeStorm: 0.05 }, r3: { cyclone: 0.25 },
    form: { name: 'Cyclone', desc: "At full Momentum every attack also spins all around you at {cyclone} (knives: a ring of 6), and a dash ends in a spin; the 4th spin keeps Whirlwind's {bladeStorm} if that is higher." } });
  card('shade', 'skill1', 1, 's_s1', { name: 'Ghost Walk', icon: 'cloak', forks: ['s_s1_a', 's_s1_b'], plays: 'blink through lines of foes, then unload.',
    desc: 'Shadowstep: +{s1Dmg} damage, recharges {s1Cdr} faster, and readies {stepCrit:ck} crit attacks, {stepStack:ck} more per foe it cuts (up to {stackMax:ck3}).', mods: { s1Cdr: 0.2, s1Dmg: 0.2, stepCrit: 3, stepStack: 1, stackMax: 2 } });
  card('shade', 'skill1', 2, 's_s1_a', { name: 'Assassinate', icon: 'dagger', tag: 'Burst',
    desc: 'Shadowstep deals +{assassinate} to foes below 50% health, and a Shadowstep kill refunds it (at most once per 1.5 s).[ Shadowstep deals +{s1Dmg}.]',
    rider2: 'Twin Cut: a second slash runs the Shadowstep path 0.15 s later at {stepTwin}.', mods: { assassinate: 0.4 }, up: { s1Dmg: 0.1 }, r2: { stepTwin: 0.3 }, r3: { blossom: 1.0, blossomN: 3, blossomMax: 6 },
    form: { name: 'Death Blossom', desc: 'After the blink you blink on to the nearest foe not yet cut within 120 of where you stand, {blossomN:n} more times, 0.1 s apart and untouchable meanwhile. Each blink cuts for a guaranteed critical hit of {blossom} of a Shadowstep slash. Killing a foe (not a horde foe) adds one more blink, up to {blossomMax:n}.' } });
  card('shade', 'skill1', 2, 's_s1_b', { name: 'Afterimage', icon: 'mirror', tag: 'Guard',
    desc: 'Shadowstep leaves an afterimage where you stood; 1.2 s later it bursts (radius 80), hurting foes and blinding them 1 s (elites 0.5 s, not bosses).[ Shadowstep deals +{s1Dmg}.]',
    rider2: 'Lure: just before it bursts, the afterimage pulls foes within {afterPull:n} toward it.', mods: { afterimage: 1 }, up: { s1Dmg: 0.1 }, r2: { afterPull: 120 }, r3: { mirrorHall: 0.7 },
    form: { name: 'Hall of Mirrors', desc: 'Shadowstep leaves three mirror images in a triangle (radius 50) around where you stood, instead of one afterimage. Each pulls foes in like the afterimage and bursts 1.5 s later (radius 80, blinds 1.5 s, elites 0.75 s, not bosses) for {mirrorHall} of a Shadowstep slash.' } });
  card('shade', 'skill2', 1, 's_s2', { name: 'Nightfall', icon: 'vanish', forks: ['s_s2_a', 's_s2_b'], plays: 'vanish, reposition, ambush.',
    desc: 'Vanish recharges {s2Cdr} faster; its smoke is {s2Area} wider, lasts {s2Dur:s} longer and foes inside take +20% damage; you move {stealthSpd} faster while unseen.', mods: { s2Cdr: 0.27, s2Area: 0.4, s2Dur: 2, smokeVuln: 1, stealthSpd: 0.3 } });
  card('shade', 'skill2', 2, 's_s2_a', { name: "Night's Edge", icon: 'mask', tag: 'Burst',
    desc: "Vanish recharges {s2Cdr} faster. Ambush deals ×{ambushMul:a4} of your weapon's base damage. An Ambush refunds Shadowstep; an Ambush kill refunds Vanish (at most once per 3 s).",
    rider2: 'Ambush Sweep: Ambush also strikes every foe within {ambushCleave:n} of its target.', mods: { ambushMul: 3, nightsEdge: 1, s2Cdr: 0.13 }, up: { ambushMul: 2 }, r2: { ambushCleave: 70 }, r3: { eclipse: 0.07, eclipseDur: 4 },
    form: { name: 'Eclipse', desc: "Vanish's smoke becomes a dark dome (radius 140) that lasts {eclipseDur:s}. While you stand inside you stay unseen and every attack is an Ambush for {eclipse} of the full one, not only the next (the extra Ambushes refund nothing). Foes inside take +20% damage." } });
  card('shade', 'skill2', 2, 's_s2_b', { name: 'Veil of Night', icon: 'cloak', tag: 'Guard',
    desc: 'Vanish shields you for {veil} max health (at most once per 12 s) and recharges {s2Cdr} faster; your smoke blinds each foe {veilBlind:s} longer (elites half); stealth lasts {stealthDur:s} longer; Ambush deals ×{ambushMul:a4} of your weapon\'s base damage.',
    rider2: 'Shroud: your smoke slows foes 60%, lasts {s2Dur:s} longer and chokes every foe inside for {shroudDmg} of an Ambush per second.', mods: { veil: 0.03, veilBlind: 1, stealthDur: 1, ambushMul: 2, s2Cdr: 0.13 }, up: { stealthDur: 0.5, ambushMul: 0.5 }, r2: { shroud: 1, s2Dur: 2, shroudDmg: 0.3 }, r3: { umbral: 2, cloneMul: 0.5 },
    form: { name: 'Umbral Veil', desc: 'Vanish leaves a shadow clone where you stood for 4 s. It repeats each of your weapon attacks from its own spot toward your aim for {cloneMul} of the damage, and foes (not bosses) go for it as if it were you. Your smoke blinds {umbral:n} times as long (the cooldown cap still holds).' } });
  card('shade', 'element', 1, 's_el', { name: 'Cruel Arts', icon: 'fang', forks: ['s_el_a', 's_el_b'], plays: 'open wounds, then rip them open.', desc: BLEED, mods: { bleedAll: 0.1, statusPow: 0.15 } });
  card('shade', 'element', 2, 's_el_a', { name: 'Open Veins', icon: 'drop', tag: 'Focus', coop: true,
    desc: 'Your crits deal +{veins} for each ailment on the foe (up to 4).',
    rider2: 'Exsanguinate: crits on a foe with 4 ailments add Bleed equal to {exsang} of the hit.', mods: { veins: 0.2 }, up: { veins: 0.01 }, r2: { exsang: 1.6 }, r3: { arterial: 0.25, arterialN: 1 },
    form: { name: 'Arterial Strike', desc: 'A crit on a foe with 3 or more ailments is Arterial: +{arterial} damage, and it readies {arterialN:ck} crit attack (at most once per second; horde foes do not).' } });
  card('shade', 'element', 2, 's_el_b', { name: 'Rupture', icon: 'heartbroken', tag: 'Spread',
    desc: "Shadowstep ruptures every foe it cuts and Ambush ruptures its target: {rupture} of the foe's Bleed and Burn hit at once at 150% (the pools lose that share), and half of the burst splashes foes within 60. Shadowstep deals +{s1Dmg}.",
    rider2: 'Bloodbloom: a foe a rupture kills hands its remaining Bleed to the 2 nearest foes within 80.', mods: { rupture: 0.5, s1Dmg: 0.3 }, up: { rupture: 0.1 }, r2: { bloodbloom: 1 }, r3: { cascade: 1, cascadeN: 4 },
    form: { name: 'Crimson Cascade', desc: 'A rupture that kills a foe (horde foes too) leaps to the nearest bleeding or burning foe within 120 and ruptures {cascade} of its Bleed and Burn, up to {cascadeN:n} leaps per cast.' } });

  // ---------------- Cleric (Sanctuary · Judgment) ----------------
  card('cleric', 'attack', 1, 'c_atk', { name: 'Dawnbringer', icon: 'sun', forks: ['c_atk_h', 'c_atk_s'], plays: 'a stream of light ahead of every swing.', weapon: { extra: { ifNone: { wave: { every: 3, mul: 0.6 } } } },
    desc: 'Your waves of light come every 2nd attack and deal +{waveMul}; the Sacred Lantern gains waves too (60% of its damage).', mods: { waveEvery: -1, waveMul: 0.3 } });
  card('cleric', 'attack', 2, 'c_atk_h', { name: 'Sunhammer', icon: 'hammer', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Heavy weapon (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Stagger). Your waves are twice as wide, travel 60% farther and stun foes {waveStun:s} (not bosses).[ Waves deal +{waveMul} more.]',
    rider2: 'Solar Flare: each wave ends in a burst of light (radius 50) for {waveBurst} of the wave.', mods: { waveBig: 1, waveStun: 0.4 }, up: { waveMul: 0.14 }, r2: { waveBurst: 0.8 }, r3: { wake: 0.6 },
    form: { name: "Dawn's Wake", desc: "Each wave leaves a strip of holy fire along its whole path for 2 s: foes on it take {wake} of the wave's damage per second as Holy damage, and the fire stores Radiance." } });
  card('cleric', 'attack', 2, 'c_atk_s', { name: 'Crusader', icon: 'wing', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift weapon (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Flow). Your waves steer toward foes within 25 degrees of where you aimed them and deal +{waveMul}.',
    rider2: 'Litany: every {litany:n}th attack sends 3 waves in a fan.', mods: { waveHome: 2, waveMul: 0.05 }, up: { waveMul: 0.07 }, r2: { litany: 16 }, r3: { waveReturn: 0.55 },
    form: { name: 'Returning Light', desc: 'Every wave turns back at the end of its flight and flies home to you, striking each foe on the way for {waveReturn} of its damage and steering like the outward wave. Litany fans return too.' } });
  card('cleric', 'skill1', 1, 'c_s1', { name: 'Sanctum', icon: 'sun', forks: ['c_s1_a', 'c_s1_b'], plays: 'fight from holy ground.',
    desc: 'Sanctuary: +{s1Area} radius, lasts {s1Dur:s} longer (at most 60% of its cooldown), +{s1Dmg} damage; allies inside take {sanctDR:dr} less damage. Casting it heals you and allies within 180 for 7% max health.', mods: { s1Area: 0.3, s1Dur: 2, s1Dmg: 0.5, sanctDR: 0.1, sanctHeal: 1 } });
  card('cleric', 'skill1', 2, 'c_s1_a', { name: 'Holy Fury', icon: 'star', tag: 'Burst',
    desc: 'Sanctuary deals +{s1Dmg} and stuns foes inside for {sanctStun:s} when cast (not bosses).',
    rider2: 'Hallowed Ground: foes inside Sanctuary are Judged (+20% damage taken).', mods: { s1Dmg: 0.15, sanctStun: 0.5 }, up: { s1Dmg: 0.2 }, r2: { sanctJudge: 1 }, r3: { wrath: 1, wrathNova: 0.9, wrathPillar: 0.15 },
    form: { name: 'Wrath of Heaven', desc: 'Sanctuary opens with a nova over its whole circle for {wrathNova} of a second of its damage. Then every half second a pillar of light falls on a random foe inside for {wrathPillar} of one of its half-second damage ticks (it prefers foes not struck in the last second).' } });
  card('cleric', 'skill1', 2, 'c_s1_b', { name: 'Aura of Faith', icon: 'lantern', tag: 'Guard', coop: true,
    desc: 'Sanctuary centres on you and moves with you, and deals +{s1Dmg}. Damage taken inside is cut by a further {sanctDR}.',
    rider2: 'Embolden: allies (not you) inside your aura deal +{auraDmg} damage.', mods: { aura: 1, s1Dmg: 0.3, sanctDR: 0.1 }, up: { s1Dmg: 0.3, sanctDR: 0.02 }, r2: { auraDmg: 0.1 }, r3: { dawn: 1, aegisR: 40, aegisDR: 0.1, aegisStun: 0.3, aegisMul: 1 },
    form: { name: 'Aegis of Dawn', desc: 'The radius of the aura grows by {aegisR:n} and it pulses every 2 seconds, stunning foes inside {aegisStun:s} (not bosses); every pulse after the first also strikes them for {aegisMul} of a second of its damage. Allies inside take a further {aegisDR} less damage, and the Sanctuary may now cut up to 50%.' } });
  card('cleric', 'skill2', 1, 'c_s2', { name: 'Hammer of Judgment', icon: 'hammer', forks: ['c_s2_a', 'c_s2_b'], plays: 'judge the pack, then the team cashes in.',
    desc: 'Judgment: +{s2Dmg} damage, flies {s2Range} farther, Judged lasts {judgeDur:s} longer, recharges {s2Cdr} faster.', mods: { s2Dmg: 0.25, s2Range: 0.4, judgeDur: 1, s2Cdr: 0.167 } });
  card('cleric', 'skill2', 2, 'c_s2_a', { name: 'Twin Hammers', icon: 'twin', tag: 'Burst',
    desc: 'Judgment throws two hammers in a narrow V, each at {twinHammer}.[ Judgment deals +{s2Dmg}.]',
    rider2: 'Second Flight: each hammer flies out once more after it returns (out, back, out, back), the second flight at {secondFlight} of a hit.', mods: { twinHammer: 0.55 }, up: { s2Dmg: 0.1 }, r2: { thirdLeg: 1, secondFlight: 0.55 }, r3: { storm: 5, stormMul: 0.38 },
    form: { name: 'Hammerstorm', desc: 'Judgment throws {storm:n} hammers in a wide fan instead of two. Each flies out and back twice, every leg at {stormMul} of a hit (the second flight is no weaker), and each leg still Judges the foes it strikes.' } });
  card('cleric', 'skill2', 2, 'c_s2_b', { name: 'Verdict', icon: 'scroll', tag: 'Guard', coop: true,
    desc: 'Judged foes deal {judgeWeak} less damage (bosses half that). A Judged foe that dies bursts (radius 70) for Holy damage ×{verdict:x}, stunning foes in it 0.4 s (not bosses); when it dies within the hammer\'s own Judged time, you and allies within 160 gain a shield of 3% max health (once per cast).[ Judgment deals +{s2Dmg}.]',
    rider2: 'Sentence: Verdict bursts Judge the foes they hit.', mods: { verdict: 2.5, judgeWeak: 0.5 }, up: { s2Dmg: 0.15 }, r2: { verdictJudge: 1 }, r3: { fjEcho: 0.08, fjR: 10, fjStun: 0.6 },
    form: { name: 'Final Judgment', desc: 'Judged foes are bound together: damage a Judged foe takes from you echoes {fjEcho} of itself to every other Judged foe within 200 (an echo never echoes again and carries no on-hit effects). The Verdict burst grows {fjR:n} wider and stuns {fjStun:s}.' } });
  card('cleric', 'element', 1, 'c_el', { name: 'Radiant Faith', icon: 'sun', forks: ['c_el_a', 'c_el_b'], plays: 'every swing builds toward a Smite that shields the party.',
    desc: "Your skills deal +{classElMul} Holy damage, and your weapon stores Radiance for {wInfHoly} of each hit (your Radiance from other sources adds to it).", mods: { classElMul: 0.25, wInfHoly: 0.12 } });
  card('cleric', 'element', 2, 'c_el_a', { name: 'Guardian Light', icon: 'shieldgold', tag: 'Focus', coop: true,
    desc: 'Your Smites on elites and bosses deal +{smiteBig}, and heroes your Smites shield deal +{guardLight} damage for 6 s.',
    rider2: 'Judging Light: your Smites Judge the foe for {smiteJudge:s}.', mods: { smiteBig: 0.5, guardLight: 0.08 }, up: { guardLight: 0.02 }, r2: { smiteJudge: 3, smiteBig: 0.4, guardLight: 0.02 }, r3: { sunstrike: 4, smiteBig: 0.4, guardLight: 0.04 },
    form: { name: 'Sunstrike', desc: 'Every 3rd Smite on the same foe (never a horde foe) is a Sunstrike: ×{sunstrike:x} damage, and the shield it grants is doubled (at most 3% of max health).' } });
  card('cleric', 'element', 2, 'c_el_b', { name: 'Prism', icon: 'arc', tag: 'Spread',
    desc: 'Your Smites deal +{smiteMul}, and a beam strikes the nearest other foe within 120 for {smiteBeam} of the Smite.',
    rider2: 'Sunburst: the beam jumps once more, to another foe within 120, at half again.', mods: { smiteMul: 0.5, smiteBeam: 0.5 }, r2: { beamJumps: 1 }, r3: { prismN: 4, prismRad: 0.01 },
    form: { name: 'Spectrum', desc: 'The beam splits into up to {prismN:n} beams, one to each of the nearest other foes within 160, each for {smiteBeam} of the Smite (Sunburst still jumps from the nearest). Each foe a beam strikes, a horde foe excepted, stores Radiance toward its next Smite ({prismRad} of this one). Beams never Smite.' } });

  // ---------------- Necromancer (Raise Legion · Bone Harvest) ----------------
  card('necro', 'attack', 1, 'n_atk', { name: 'Soul Command', icon: 'hand', forks: ['n_atk_h', 'n_atk_s'], plays: 'shoot to command the army.',
    desc: 'Your weapon deals +{wDmg} and Hexes what it hits for {hex:s}. Your minions rush the Hexed foe nearest you and deal +{hexMul} to Hexed foes.', mods: { wDmg: 0.2, hex: 3, hexMul: 0.2 } });
  card('necro', 'attack', 2, 'n_atk_h', { name: 'Gravecaller', icon: 'skull', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Heavy weapon (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Stagger): each foe your weapon kills rises as a minion for 10 s (at most once per second).[ Hexed foes take +{hexMul} more from minions.]',
    rider2: "Hex Burst: your weapon's Hex also lands on foes within {hexSpread:n} of the hit.", mods: { wRaise: 1 }, up: { hexMul: 0.1 }, r2: { hexSpread: 60, hexMul: 0.4 }, r3: { graveBolt: 1.5, graveN: 3 },
    form: { name: 'Grave Bolt', desc: 'One attack in {graveN:n} is a Grave Bolt: the shot pierces every foe, is twice as wide and deals ×{graveBolt:x} damage (a scythe swing deals ×{graveBolt:x}). It Hexes every foe it hits, and every foe it kills (not a horde foe) rises as a minion with no Gravecaller limit.' } });
  card('necro', 'attack', 2, 'n_atk_s', { name: 'Soul Barrage', icon: 'orb', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Swift weapon (×{fkRate:x} attack time, ×{fkDmg:x} damage per hit, Flow): foes you Hexed take +{hexSelf} from you.',
    rider2: 'Quickened Dead: your minions attack {hexHaste} faster against foes you Hexed.', mods: { hexSelf: 0.1 }, up: { hexSelf: 0.05 }, r2: { hexHaste: 0.25 }, r3: { soulStorm: 2.5 },
    form: { name: 'Soul Storm', desc: 'Once per second, a foe you Hexed that your weapon hits releases a soul that seeks another foe within 150 (one you have not Hexed first), striking it for {soulStorm} of the hit and Hexing it.' } });
  card('necro', 'skill1', 1, 'n_s1', { name: 'Endless Legion', icon: 'skull', forks: ['n_s1_a', 'n_s1_b'], plays: 'a standing army.',
    desc: '+{minions:n} max minion and Raise Legion raises {s1N:n} more.', mods: { minions: 1, s1N: 1 } });
  card('necro', 'skill1', 2, 'n_s1_a', { name: 'Bone Spikes', icon: 'bomb', tag: 'Burst',
    desc: 'Your minions burst when they expire, fall or are replaced (radius 60) for Shadow damage that marks Doom for half of it.[ Bursts deal +{s1Dmg} more.]',
    rider2: 'Boneyard: a foe a Bone Spikes burst kills rises as a minion (at most once per 2 s).', mods: { boneSpikes: 1 }, up: { s1Dmg: 0.04 }, r2: { spikeRaise: 1 }, r3: { bloom: 1, bloomField: 0.3, bloomBomb: 1.1 },
    form: { name: 'Ossuary Bloom', desc: 'Minions also burst when Bone Harvest consumes them, and every burst leaves a field of bone spikes for 2 seconds that deals {bloomField} of the burst each second. Raise Legion also raises 2 bone bombs for 5 seconds: they run at the nearest foe and explode for {bloomBomb} of a burst, leaving a field of their own.' } });
  card('necro', 'skill1', 2, 'n_s1_b', { name: 'Bone Knights', icon: 'shield', tag: 'Guard',
    desc: 'Fewer, greater dead: at most 2 minions (Legion raises 2); each deals ×2, attacks every 0.5 s, cleaves foes within 30 of its target, and blocks foe shots that touch it (each block costs it 1 s). Their strikes stun foes {knightStun:s} (at most once per 1 s per foe, not bosses).[ Minions deal +{minionDmg} more.]',
    rider2: 'Ironbone: Bone Knights last {knightLife} longer.', mods: { minions: -2, s1N: -2, knights: 1, knightStun: 0.5 }, up: { minionDmg: 0.1 }, r2: { knightLife: 0.5 }, r3: { dk: 1, dkMul: 2.75, dkArc: 2.4, dkTaunt: 120 },
    form: { name: 'Death Knight', desc: 'Raise Legion raises one Death Knight instead of the two Bone Knights: it strikes for ×{dkMul:x} the damage of a minion, cleaves a wide arc (about 140 degrees) and taunts every foe within {dkTaunt:n} (not bosses): they come for it, and it blocks their shots. It counts as 2 minions and stands until it falls or you raise another.' } });
  card('necro', 'skill2', 1, 'n_s2', { name: 'Grim Harvest', icon: 'harvest', forks: ['n_s2_a', 'n_s2_b'], plays: 'build up, detonate, rebuild.',
    desc: 'Bone Harvest explosions deal +{s2Dmg} and are {s2Area} wider; it always raises {harvestRaise:n} after.', mods: { s2Dmg: 0.4, s2Area: 0.2, harvestRaise: 2 } });
  card('necro', 'skill2', 2, 'n_s2_a', { name: 'Corpse Explosion', icon: 'bomb', tag: 'Burst',
    desc: "Harvest also detonates up to {corpse:n} corpses (foes that died in the last 4 s) within 220 of you, each at {corpseMul} of a minion's burst.",
    rider2: 'Bone Lances: before exploding, each minion flies to the foe nearest it within 200 and bursts on it for +{boneLance}.', mods: { corpse: 4, corpseMul: 0.3 }, up: { corpse: 1 }, r2: { boneLance: 0.37 }, r3: { corpse: 4, corpseMul: 0.4, carrionN: 3, carrionShard: 0.5 },
    form: { name: 'Carrion Storm', desc: 'Every corpse Harvest detonates (up to {corpse:n}, now at {corpseMul}) launches {carrionN:n} bone shards at the nearest foes for {carrionShard} of a minion\'s burst each.' } });
  card('necro', 'skill2', 2, 'n_s2_b', { name: 'Bone Armor', icon: 'harvest', tag: 'Guard',
    desc: 'Harvest heals you 3% max health per minion harvested (up to 6%) and shields you for {boneArmor} max health per minion (up to {boneCap}, at most once per 12 s). [ Bone Harvest explosions deal +{s2Dmg}.]',
    rider2: 'Marrow Field: each harvested minion leaves bone shards (radius 40, 2 s) that slow foes 40%.', mods: { boneArmor: 0.03, boneCap: 0.05, harvestHeal: 1 }, up: { boneCap: 0.005, s2Dmg: 0.4 }, r2: { boneField: 1 }, r3: { lich: 1, lichT: 6.5, lichMul: 0.3, lichLife: 2, braceDR: 0.35 },
    form: { name: 'Lich Form', desc: 'For {lichT:s} after Bone Harvest your weapon fires 2 extra soul bolts at {lichMul} of a hit, the minions you raise last {lichLife:n} times as long, and you take {braceDR} less damage.' } });
  card('necro', 'element', 1, 'n_el', { name: 'Grave Pact', icon: 'scroll', forks: ['n_el_a', 'n_el_b'], plays: 'the army Reaps for you.',
    desc: "Your skills deal +{classElMul} Shadow damage; your minions apply your statuses at 75% strength (from 50%) and mark Doom for {mInfShadow} of their damage.", mods: { classElMul: 0.25, minionInfuse: 0.25, mInfShadow: 0.2 } });
  card('necro', 'element', 2, 'n_el_a', { name: 'Abyssal Toll', icon: 'mask', tag: 'Focus',
    desc: 'Your Tolls deal +{tollMul}, and each Toll or Reaped elite empowers your minions +{abyssMin} for 6 s.',
    rider2: "Abyssal Hunger: your minions' Doom counts double on elites and bosses.", mods: { tollMul: 0.4, abyssMin: 0.25 }, up: { tollMul: 0.1 }, r2: { abyssDoom: 1, tollMul: 0.35 }, r3: { maw: 0.2, mawHaste: 0.3 },
    form: { name: 'Abyssal Maw', desc: 'Each Toll on a boss, and each Reaped elite, opens a maw (radius 60) beneath it for 3 s: foes in it take {maw} of the Toll per second (a Reaped elite counts its Doom as the Toll), and your minions within 120 of it attack {mawHaste} faster.' } });
  card('necro', 'element', 2, 'n_el_b', { name: 'Rise Again', icon: 'hand', tag: 'Spread',
    desc: 'Every foe your Doom Reaps rises as a minion (at most once per 1.5 s); every boss Toll raises one.[ Minions deal +{minionDmg} more.]',
    rider2: 'Risen Tide: minions risen this way deal +{tideMul} and last 4 s longer.', mods: { reapRaise: 1 }, up: { minionDmg: 0.08 }, r2: { tideMul: 0.5 }, r3: { tideFree: 1, tideCap: 2, tideDoom: 2 },
    form: { name: 'Tide of the Dead', desc: 'Rise Again raises without its 1.5 s limit (at most 2 per second). The minions it raises do not count against your minion cap (up to {tideCap:n} extra), and each bursts when it falls (radius 60), marking Doom worth {tideDoom} of its strike on every foe inside. Horde foes never rise.' } });

  // ---------------- Bellwarden (Anchor Leap · Peal) ----------------
  card('bell', 'attack', 1, 'b_atk', { name: 'Full Swing', icon: 'bell', forks: ['b_atk_h', 'b_atk_s'], plays: 'wind to the glow, then let it fly.',
    desc: 'A hurl at full wind (the bell glows) is a Full Swing: +{fullSwing} damage and an impact {fullR} wider.', mods: { fullSwing: 0.25, fullR: 0.3 } });
  card('bell', 'attack', 2, 'b_atk_h', { name: 'Wrecking Ball', icon: 'hammer', tag: 'Heavy', weapon: { kind: 'heavy' },
    desc: 'Your bell becomes heavy (×{fkRate:x} lockout, ×{fkDmg:x} damage per strike; a full-wind hurl Staggers and its impact is 20% wider). Where a hurl lands it cracks the ground: a shock (radius 70) for {wreck} of the hurl that stuns {wreckStun:s} (not bosses).[ Full Swings deal +{fullSwing} more.]',
    rider2: 'Unstoppable: a hurl carries the foes it strikes along its flight, up to {hurlCarry:n} px (not bosses).', mods: { wreck: 0.4, wreckStun: 0.3 }, up: { fullSwing: 0.15, wreck: 0.05 }, r2: { hurlCarry: 40 }, r3: { demolish: 1 },
    form: { name: 'Demolisher', desc: 'A Full Swing lands as a quake: its shock is twice as wide (radius 140), deals {demolish} more of the hurl and throws foes away from the impact.' } });
  card('bell', 'attack', 2, 'b_atk_s', { name: 'Pendulum', icon: 'bolt', tag: 'Swift', weapon: { kind: 'swift' },
    desc: 'Your bell becomes swift (×{fkRate:x} lockout, ×{fkDmg:x} damage per strike; winding gives Flow and reels are 30% faster). Winding spins the bell up {haulAcc} faster.[ Full Swings deal +{fullSwing} more.]',
    rider2: 'Slipstream: you move at full speed while winding.', mods: { haulAcc: 0.22 }, up: { haulAcc: 0.05, fullSwing: 0.12 }, r2: { slipstream: 1 }, r3: { perpetual: 1, windCap: 0.9 },
    form: { name: 'Perpetual Motion', desc: 'Winding strikes no longer cost the bell any wind, and they deal up to ×{windCap:x} instead of ×0.6.' } });
  card('bell', 'skill1', 1, 'b_s1', { name: 'Long Chain', icon: 'bell', forks: ['b_s1_a', 'b_s1_b'], plays: 'hurl the bell, then leap after it.',
    desc: 'Anchor Leap recharges {s1Cdr} faster and its slam deals +{s1Dmg}; a leap from the hand carries you {leapR} farther.', mods: { s1Cdr: 0.2, s1Dmg: 0.25, leapR: 0.4 } });
  card('bell', 'skill1', 2, 'b_s1_a', { name: 'Wrecker', icon: 'bomb', tag: 'Burst',
    desc: 'The slam deals +{s1Dmg} and is {s1Area} wider, and you land with every bell in hand at full wind, ready to hurl.',
    rider2: 'Ground Breaker: the slam stuns foes {smashStun:s} (not bosses).', mods: { s1Dmg: 0.25, s1Area: 0.25, wrecker: 1 }, up: { s1Dmg: 0.15 }, r2: { smashStun: 0.6 }, r3: { wreckSpin: 0.12, spinDur: 1.5 },
    form: { name: 'Wrecking Spin', desc: 'After the slam your bells whirl round you by themselves for {spinDur:s}: every foe on their orbit takes {wreckSpin} of the slam (each foe at most once per 0.4 s).' } });
  card('bell', 'skill1', 2, 'b_s1_b', { name: 'Tether Hook', icon: 'hand', tag: 'Guard',
    desc: 'A slam that strikes a foe shields you for {hookShield} max health (at most once per 8 s), and the leap keeps you untouchable {leapIfr:s} longer. The slam deals +{s1Dmg}.',
    rider2: 'Reel In: the slam first drags every foe within {hookPull:n} of it to its centre (not bosses).', mods: { hookShield: 0.02, leapIfr: 0.3, s1Dmg: 0.6 }, up: { s1Dmg: 0.3 }, r2: { hookPull: 140 }, r3: { shackle: 4, shackleWeak: 0.3 },
    form: { name: 'Anchor Chain', desc: 'Foes the slam strikes are Shackled for {shackle:s}: slowed 50% and dealing {shackleWeak} less damage.' } });
  card('bell', 'skill2', 1, 'b_s2', { name: 'Great Peal', icon: 'bell', forks: ['b_s2_a', 'b_s2_b'], plays: 'build Resonance with hurls and reels, then ring it.',
    desc: 'Peal: +{s2Area} radius and +{s2Dmg} damage.', mods: { s2Area: 0.3, s2Dmg: 0.25 } });
  card('bell', 'skill2', 2, 'b_s2_a', { name: 'Thunderclap', icon: 'bolt', tag: 'Burst',
    desc: 'The Peal charges the foes it strikes for half of its damage and discharges them at once at +{clap}. Peal deals +{s2Dmg}.',
    rider2: 'Reverberation: the Peal rings again 0.5 s later on the same spot at {pealEcho}.', mods: { clap: 0.5, s2Dmg: 0.2 }, up: { clap: 0.15, s2Dmg: 0.1 }, r2: { pealEcho: 0.5 }, r3: { tollN: 3, tollBolt: 0.5 },
    form: { name: 'Thunder Toll', desc: 'Every Peal also calls a thunderbolt on each of the {tollN:n} most charged foes within 220 of each bell (radius 50) for {tollBolt} of the Peal.' } });
  card('bell', 'skill2', 2, 'b_s2_b', { name: 'Warding Toll', icon: 'shieldgold', tag: 'Guard', coop: true,
    desc: 'Peal deals +{s2Dmg}, destroys foe shots within half again its radius and shields you for {pealShield} max health per foe it strikes (up to {pealCap}, at most once per 10 s).',
    rider2: 'Sanctus: the Peal stuns {pealStun:s} longer.', mods: { pealSwat: 1, pealShield: 0.005, pealCap: 0.02, s2Dmg: 1.45 }, up: { s2Dmg: 0.45, pealCap: 0.0025 }, r2: { pealStun: 0.3 }, r3: { wardDur: 8, wardWeak: 0.5, s2Dmg: 1.5 },
    form: { name: 'Ward Bell', desc: 'The Peal leaves a ringing ward where it rang (its radius) for {wardDur:s}: foes inside deal {wardWeak} less damage (not bosses).' } });
  card('bell', 'element', 1, 'b_el', { name: 'Storm Bronze', icon: 'bolt', forks: ['b_el_a', 'b_el_b'], plays: 'every strike charges; the storm pays it out.',
    desc: "Your skills deal +{classElMul} Lightning damage, and your bell charges foes for {wInfLightning} of each strike (the Storm path's rate counts instead when it is higher).", mods: { classElMul: 0.25, wInfLightning: 0.15 } });
  card('bell', 'element', 2, 'b_el_a', { name: 'Lightning Rod', icon: 'bolt', tag: 'Focus',
    desc: 'A hurl strike on a charged foe deals +{rod} and discharges it at once.',
    rider2: "Grounded: a hurl's discharge stuns the foe {rodStun:s} (not bosses; at most once a second).", mods: { rod: 1.7 }, up: { rod: 0.3 }, r2: { rodStun: 0.3 }, r3: { stormBolt: 2 },
    form: { name: 'Skybreaker', desc: 'The anchored bell draws the storm: a thunderbolt (radius 50) strikes where it lands and again every second while it lies there, for {stormBolt} of your weapon damage, charging the foes it hits for half.' } });
  card('bell', 'element', 2, 'b_el_b', { name: 'Chain Toll', icon: 'arc', tag: 'Spread',
    desc: 'Each reel strike arcs to the nearest other foe within 90 for {chainArc} of the strike, as Lightning that charges it like a strike (no other foe near: back into the struck foe); your strikes charge foes for {wInfLightning} more of their damage.',
    rider2: 'Forked Toll: the arc jumps on to {arcN:n} more foe.', mods: { chainArc: 1.5, wInfLightning: 0.1 }, up: { chainArc: 0.3 }, r2: { arcN: 1 }, r3: { arcN: 1, tollStorm: 0.6 },
    form: { name: 'Toll of the Storm', desc: 'The arc jumps on to one more foe, and each reel makes the chain a live wire: every foe within 20 of it, between you and the bell, takes {tollStorm} of the reel strike as Lightning.' } });

  Object.assign(ED.BOONS, CB);
  ED.BOON_IDS = Object.keys(ED.BOONS);

  // ---------------- route tables and helpers ----------------
  ED.ROUTES = ['attack', 'skill1', 'skill2', 'element'];
  ED.ELEMENT_ROUTE = { knight: 'Bleed', ranger: 'Bleed', pyro: 'Fire', shade: 'Bleed', cleric: 'Holy', necro: 'Shadow', bell: 'Lightning' };
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
  // Total of every stat a class card gives at `rank`: mods + up x (rank - 1) + r2 from rank 2 + r3 from rank 3.
  ED.cardTotals = (b, rank) => {
    const t = {};
    for (const k in b.mods) t[k] = b.mods[k];
    if (rank >= 2 && b.up) for (const k in b.up) t[k] = (t[k] || 0) + b.up[k] * (rank - 1);
    if (rank >= 2 && b.r2) for (const k in b.r2) t[k] = (t[k] || 0) + b.r2[k];
    if (rank >= 3 && b.r3) for (const k in b.r3) t[k] = (t[k] || 0) + b.r3[k];
    return t;
  };
  // Display name of a boon at `rank`: a class card's form name from rank 3, else its name.
  ED.cardName = (id, rank) => {
    const b = ED.BOONS[id];
    return !b ? id : b.form && rank >= 3 ? b.form.name : b.name;
  };
  const trim = (v, d) => String(parseFloat(v.toFixed(d)));
  const fmtVal = (v, f, critK) => {
    switch (f) {
      case 'n': return trim(v, 1);
      case 's': return trim(v, 2) + ' s';
      case 'ck': return trim(Math.max(1, Math.round(v * critK)), 0);
      case 'ck3': return trim(Math.max(1, Math.round((3 + v) * critK)), 0);
      case 'x': return trim(v, 3);
      case 'a4': return trim(4 + v, 2);
      case 'r100': return trim(100 + v, 0);
      case 'dr': return trim((0.15 + v) * 100, 0) + '%';
      default: { const p = v * 100; return trim(p, Math.abs(p) >= 10 ? 0 : 2) + '%'; }
    }
  };
  const render = (tpl, tot, critK) => {
    let bad = false;
    const fill = (s) => s.replace(/\{(\w+)(?::(\w+))?\}/g, (m, k, f) => { const v = tot[k] || 0; if (!v) bad = true; return fmtVal(Math.abs(v) < 1e-9 ? 0 : v, f, critK); });
    return tpl.replace(/\[([^\]]*)\]/g, (m, seg) => { bad = false; const out = fill(seg); return bad ? '' : out; }).replace(/\{(\w+)(?::(\w+))?\}/g, (m, k, f) => fmtVal(tot[k] || 0, f, critK)).replace(/ {2,}/g, ' ').trim();
  };
  // Rate and damage factors of an attack fork card on the hero's base weapon (st.weaponId; the Heavy cap and Swift floor bend them); the nominal ones without a weapon.
  const FORK_NOMINAL = { heavy: { rate: 1.8, dmg: 1.98 }, swift: { rate: 0.55, dmg: 0.605 } };
  const forkRatios = (b, st) => { // without a hero: the nominal factors (a bell card: those of the class's first bell, as every bell forks by the same factors)
    const base = st && st.weaponId ? String(st.weaponId).split('@')[0] : b.cls === 'bell' ? ED.CLASSES.bell.weapons[0] : null, bw = base && ED.WEAPONS[base], fw = bw && ED.forkWeapon(base, b);
    return fw && fw !== bw ? { rate: fw.rate / bw.rate, dmg: fw.dmg / bw.dmg } : FORK_NOMINAL[b.weapon.kind] || { rate: 1, dmg: 1 };
  };
  // Player-facing text of a boon: a class card at `rank` (default 1) with its numbers filled in (critK from the hero's stats `st`), else the boon's own desc.
  // rider2 joins from rank 2 (numbers at max(rank, 2)); rider2Full holds the sentence before its rank; form is the rank-3 transform ({ name, desc } with its numbers filled in, or null; formFull: the same before rank 3).
  // Returns the pieces; ED.boonText joins them.
  ED.cardParts = (id, rank, st) => {
    const b = ED.BOONS[id];
    if (!b || !b.route) return { text: b ? b.desc : '', rider2: '', rider2Name: '', form: null, formFull: null };
    rank = Math.max(1, Math.min(b.max || 1, rank | 0 || 1));
    const tot = ED.cardTotals(b, rank), ck = (st && st.critK) || 1;
    if (b.weapon && b.weapon.kind) { const fk = forkRatios(b, st); tot.fkRate = fk.rate; tot.fkDmg = fk.dmg; }
    const text = render(b.desc, tot, ck);
    const split = (s, at) => { const m = s ? /^([^:]+): (.*)$/.exec(s) : null; return m ? [m[1], render(m[2], ED.cardTotals(b, at), ck)] : ['', '']; };
    const [rider2Name, rider2] = split(b.rider2, Math.max(2, rank));
    const formAt = (r) => (b.form ? { name: b.form.name, desc: render(b.form.desc, ED.cardTotals(b, r), ck) } : null);
    return { text, rider2: rank >= 2 ? rider2 : '', rider2Name, rider2Full: rider2, form: rank >= 3 ? formAt(3) : null, formFull: formAt(3) };
  };
  ED.boonText = (id, rank, st) => {
    const b = ED.BOONS[id];
    if (!b || !b.route) return b ? b.desc : '';
    const p = ED.cardParts(id, rank, st);
    return p.text + (p.rider2 ? ' ' + p.rider2Name + ': ' + p.rider2 : '') + (p.form ? ' ' + p.form.name + ': ' + p.form.desc : '');
  };
})(globalThis.ED || (globalThis.ED = {}));
