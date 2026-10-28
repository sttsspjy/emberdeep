# Wickdeep — Game Design (canonical rules and numbers)

Co-op survivors-like (solo or up to 4 friends, browser, zero install). Hordes pour into an open arena; weapons fire on their own; the player moves, dodges, dashes and fires two hero skills. A good run turns the screen into a blender: by minute 12 the hero barely needs to move, bosses melt in seconds.

Units: world px (hero sprite ≈ 16–24 px tall), seconds. HP numbers are integers.

## 1. Design laws

1. **Upgrades change shape, not numbers.** Every weapon level adds one of: +1 projectile, +pierce, +bounce, +area, +duration, a second emitter, a new pattern. A flat damage step is allowed only on levels that also do something else. Players must see each pick on screen.
2. **Power multiplies, foes add.** Foe HP grows linearly with time; hero coverage (count × area × pierce × uptime) grows multiplicatively. Late runs out-scale the horde by design.
3. **Threat is the crowd, not the hit.** Contact damage is small (3–12 per hit at 100 max HP); death comes from getting surrounded, never from one trash hit.
4. **One line per card.** Level-up cards: name, icon, one line ≤ 40 characters ("+1 arrow, arrows pierce 1 more"). No paragraphs anywhere in a run.
5. **Big readable text.** Card text ≥ 20 px CSS, HUD numbers ≥ 16 px CSS, plain pixel font (no decorative faces).
6. **Every death is earned.** Elite and boss attacks are telegraphed ≥ 0.6 s.
7. **Determinism.** The sim is seeded and pure; never `Math.random` in `src/sim` or `src/data`.

## 2. Run structure (Survival mode)

- **Length**: 15:00. Bosses at 5:00 and 10:00; the final boss at 15:00. Killing the final boss wins the run. At 17:00, if it is still alive, the final boss enrages (×3 damage and speed).
- **Arena**: bounded 3200 × 3200 world px per stage, solid edge walls, 20–40 scattered obstacles (pillars, ruins; circle colliders, radius 12–40) that make chokepoints, 12–20 destructible braziers that drop pickups; any hero hit breaks one (swings, blasts, rings, pillars, and projectiles, which fly on without spending pierce), as does walking into it.
- **View**: about 640 × 360 world px (integer-scaled to the canvas). Each client follows its own hero.
- **Stages**: 3 stages (themes from the old biomes), each with its own foe roster, palette, two mid-bosses and a final boss. Stage 1 is open; beating stage N unlocks N+1. Stage choice happens before the run.
- **Victory screen**: time, kills, level, damage per weapon (bar chart), gold earned.

## 3. Hero

| Stat | Base |
|---|---|
| Max HP | 100 (per hero: 80–130) |
| Armor | 0 (flat reduction per hit, minimum 1 damage taken) |
| Regen | 0 HP/s |
| Move speed | 90 px/s (per hero: 80–100) |
| Pickup radius | 36 px |
| Dash (Space) | 0.2 s, 80 px, i-frames for its whole length, 3.5 s cooldown, 1 charge |
| Invulnerability after a hit | 0.5 s |

- **Controls**: WASD move (e.code), mouse aims skills, Space dash, Q and E hero skills, 1–4 pick a level-up card, Esc pause (solo only). No mouse button is bound by default: a click does nothing in a run.
- **Weapons fire on their own.** Targeting modes: `nearest`, `facing` (toward the nearest foe within ±100° of the movement direction, else the nearest foe in range, else straight along it; Twin Daggers ±52°; Bramble Trail always lashes along the movement direction), `random` (a random foe on screen), `around` (orbit or aura), `densest` (the densest foe cluster within range). **No foe in range**: every signature weapon, its evolution and the `facing` general weapons still fire on their normal cooldown and range along the facing direction (the last movement direction, kept while standing still): shots fly straight ahead, Cleave swings ahead, Bone Storm launches ahead, Smite / Wrath pillars land in a line ahead (60 px steps, kept on screen), Toll / Cathedral peal and Whirlwind spins in place. Other general weapons hold until a foe is in range.
- **Hero skills (Q/E)** aim at the mouse cursor, cooldowns 6–18 s, and must look and feel huge: screen-wide effects, hit-stop, shake. Skill cards in the level-up pool upgrade them (shape, not just numbers).
- **Slots**: 6 weapons, 6 passives. The hero's signature weapon fills slot 1 at start.

### Heroes

| Hero | HP | Speed | Signature weapon (auto) | Q | E |
|---|---|---|---|---|---|
| Knight | 130 | 85 | **Cleave**: a wide sword arc toward the facing direction | Shield Charge: dash forward through foes, knock all aside | Bulwark: 3 s of 60% damage reduction and a shockwave that pushes the horde back |
| Ranger | 90 | 100 | **Longbow**: arrows at the nearest foe | Volley: a rain of arrows on a cursor area for 2 s | Snare Trap: drops a trap at the cursor that roots foes in a radius |
| Pyro | 85 | 92 | **Fire Bolt**: a bolt that bursts into a small fire pool | Meteor: a big impact at the cursor after a 0.5 s fall, burning ground | Flame Ring: an expanding fire ring around the hero |
| Necro | 95 | 88 | **Bone Shard**: piercing shards; foes its holder kills (any hero) have a 6% chance to rise as skeleton minions (max 8) | Raise Horde: raise 6 skeletons at once | Corpse Blast: detonates every minion and fresh corpse within view |
| Cleric | 110 | 88 | **Smite**: holy pillars strike random foes on screen | Sanctuary: a zone at the cursor that heals allies 5 HP/s and damages foes, 4 s | Judgment: a beam toward the cursor that sweeps 90° |
| Shade | 80 | 100 | **Twin Daggers**: fast thrown daggers in the facing direction, high crit | Shadow Step: blink to the cursor and leave a damaging afterimage | Fan of Knives: 24 daggers in a full circle |
| Bell | 115 | 86 | **Toll**: a bell orbits the hero; each peal sends a shockwave ring that pushes foes back | Great Peal: a huge ring that stuns every foe on screen for 1.2 s | Hurl Bell: throws a bell at the cursor; it drags foes in its path, then rings |

## 4. Weapons

Each weapon has levels 1–8. Level 8 plus its paired passive (any level) makes the weapon **evolution-ready**; the next chest from an elite or boss evolves it into its evolved form (a new pattern, not a number bump).

Signature weapons (one per hero above) can also appear for other heroes after the hero has been played once (unlock).

General weapons (12):

| Weapon | Mode | Pattern | Paired passive | Evolution |
|---|---|---|---|---|
| Orbit Lanterns | around | lanterns circle the hero | Duration | Sun Wheel: permanent ring of 8 lanterns, burns |
| Chain Spark | nearest | lightning arcs foe to foe | Reach | Storm Crown: 3 bolts every 0.5 s, arcs fork twice |
| Frost Ring | around | expanding ring that slows | Reach | Glacier: ring freezes foes solid for 1.5 s |
| Bramble Trail | facing | thorns erupt along the path walked | Duration | Thornwood: thorns persist and grab |
| Glaive | nearest | boomerang out and back, pierces | Velocity | Twin Moons: two glaive pairs spiral out, counter-rotating |
| Meteor Call | random | delayed impacts at random foes | Multishot | Starfall: constant shower |
| Bone Spear | facing | long piercing spear line | Might | Impaler: spear pins and drags foes |
| Blight Pool | around | poison pools dropped under the hero | Duration | Plague Field: pools spread to adjacent foes |
| Wisp | nearest | homing spirits seek foes | Multishot | Wisp Choir: wisps split on kill |
| Mortar | densest | lobbed bomb at the densest cluster | Reach | Barrage: 5-shell walking salvo, 5 bomblets each |
| Censer | around | damaging aura around the hero | Mending | Holy Censer: aura heals 1 HP per 30 foes killed in it |
| Ricochet | nearest | stones bounce between foes | Velocity | Avalanche: stones split on each bounce |

Signature evolutions (paired passive in brackets): Cleave → Whirlwind, 360° spins [Might]; Longbow → Hail of Arrows, arrows split on hit [Multishot]; Fire Bolt → Inferno, pools merge and spread [Duration]; Bone Shard → Bone Storm, shards orbit then launch, minion cap 16 [Haste]; Smite → Wrath, pillars chain to neighbours [Reach]; Twin Daggers → Shadow Fan, daggers return and crit twice [Velocity]; Toll → Cathedral, three bells orbit and peal in sequence [Reach].

Base weapon damage: 10–25 per hit at level 1, cooldown 0.6–2.5 s. Each level: one shape change; levels 4 and 8 also add +25% damage.

## 5. Passives (12, levels 1–5)

| Passive | Per level |
|---|---|
| Might | +10% damage |
| Haste | −8% weapon cooldown |
| Reach | +10% area |
| Velocity | +15% projectile speed and range |
| Duration | +12% effect duration |
| Multishot | +1 projectile at levels 2 and 4 (all projectile weapons) |
| Vigor | +20 max HP |
| Plating | +1 armor |
| Mending | +0.3 HP/s regen |
| Swiftness | +8% move speed |
| Magnet | +25% pickup radius |
| Fortune | +10% luck (more 4th cards, better chests, more gold) |

Max 6 passives. Passive cards also show a line naming the weapon they evolve.

## 6. Level-ups

- XP to the next level: `5 + 8 × (level − 1)` up to level 20, then `+15` per level.
- Each level offers 3 cards (4 with Fortune luck), drawn from: new weapon (if a slot is free), weapon level, new passive (if a slot is free), passive level, hero skill upgrade (Q/E, 3 levels each). Gold (+25) or heal (+30 HP) when nothing is left.
- Reroll, Skip and Banish: counts come from meta upgrades. Banish removes one card's item from the run's pool and replaces that card (Gold and Meal cannot be banished).
- Card weights: owned weapon level 4 (+2 when weapon slots are full); new weapon 3; owned passive level 3 (+1.5 when passive slots are full); new passive 2 (+1.5 if it pairs an owned weapon); skill 1.5 (+1 when all slots are full). A card that makes a weapon evolution-ready is flagged and weighted up.
- **Solo**: the game pauses while picking. **Co-op**: no pause; cards appear in a compact strip at the bottom; pick with 1–4 while moving; 1 s of invulnerability after picking.
- XP is shared in co-op (one bar, everyone levels together, each player picks their own card).

## 7. Foes and spawning

- **Spawn timeline** per stage, per minute: spawn rate (foes/s), alive cap, weighted roster. Foes spawn on a ring 380–460 px from a random living hero, never inside walls or obstacles.
- **Alive cap**: 300 at 0:00 rising to 700 at 12:00 (solo); +25% per extra player, hard cap 900.
- **Density floor**: while fewer foes live than the floor, each tick spawns up to 10% of the deficit (max 40), refilling the screen within ~0.3 s. Floor = alive cap × min(0.6, 0.1 × minute): 0 at 0:00, 60% from 6:00. A fast-killing build still faces a full screen.
- **Foe HP**: `base × (1 + 0.18 × minute) × (1 + 0.5 × (players − 1)) × stage HP` (stage HP 1 / 1.3 / 1.6).
- **Contact damage**: 3 at 0:00 rising to 12 at 15:00, × stage damage (1 / 1.15 / 1.3). Foe shots and blasts: base × (1 + 1.2 × min(1, t / 15:00)) × stage damage.
- **Foe kinds**: chaser (straight line), swarmer (fast, weak; packs of 12–16 at 0:00 growing to 20–30 by 10:00), brute (slow, 8× HP, knockback-immune, telegraphed slam), ranged (stops at 160 px, shoots a telegraphed bolt, fan or ring; only from inside the target's screen), exploder (telegraphed 0.7 s burst on contact), splitter (splits in 2–3 on death), charger (telegraphed dash; packs of 2–4), diver (telegraphed dive; packs of 3–5). Every attack telegraph is ≥ 0.6 s and aimed where the target stood when the wind-up began; killing, stunning or freezing the foe cancels it.
- **Events**: a swarm wave every 90 s (a ring of 40–80 swarmers closing in, or a stampede line crossing the screen).
- **Elites**: one every 60 s from 2:00 (a non-exploder roster foe at 2× size, 25× HP, glowing outline); drops a chest. Elite attacks change shape: ranged fire 2 more shots (ring casters 1.5×), charges and dives last 1.35× longer, brute slams get 1.5× radius plus a shot ring, splitters split into 3 extra children.
- **Off-screen culling**: foes farther than 900 px (elites 1300 px) from every hero teleport to a fresh spawn point ahead of a hero; bosses never.
- **Separation**: foes push apart on the spatial grid; they flow around obstacles.

## 8. Bosses

Each boss: 2–3 telegraphed patterns, a health bar at the top, HP `= 400 × minute × players factor`. Mid-bosses drop a chest with evolution priority. While a boss lives, normal spawns run at 50% rate.

- **Roster** (5:00 · 10:00 · final 15:00): Ossuary — Bone Warden · The Twins · Hollow King. Glowmire — Sporemother · Demon Cyclops · Drowned King. Abyss — Blue Samurai · Rift Weaver · The Wick-Eater.
- **Rift Weaver**: rift gates around the target open into portals that shoot; warned threads cross the target (strands stay from phase 2); blink with a bolt ring; adds.
- **The Wick-Eater**: devour (warned cone inhales heroes toward a warned bite); closing dark (a ring shrinks onto it, pass through a gap or dash); lash fans; spiralling orb bloom; adds; swells at phase 3.

## 9. Pickups

- **XP gems**: small (1), medium (5, from elites and brutes), large (25). When more than 350 gems lie on the ground, new ones merge into the nearest gem.
- **Gold coins**: 1–5 from braziers and elites (meta currency), worth value × (1 + greed + luck / 2).
- **Food**: heals 30 HP; braziers only (8% chance). No default sustain.
- **Magnet** (braziers, 3%): pulls every gem on the map.
- **Holy Bomb** (braziers, 2%): kills every non-elite foe on screen.
- **Chest**: from elites and bosses: evolves the first evolution-ready weapon; otherwise 1 roll, a 2nd at 30% + luck, a 3rd at 10% + luck / 2; each roll levels a random owned item (weapons weight 2, passives 1), or pays gold when nothing can level.

## 10. Co-op

- 1–4 players, PeerJS; the host runs the sim.
- **Downed** at 0 HP: 20 s bleed-out; a teammate standing within 40 px for 2.5 s revives at 40% HP. All heroes down → defeat. Solo death ends the run unless a Revival charge is left (meta).
- Each client follows its own hero; foes and gems are snapshot only within the client's view plus a margin (interest culling).

## 11. Meta progression

- **Gold** carries over. The Camp shop sells permanent ranks: Might (5), Vigor (5), Plating (3), Mending (5), Swiftness (3), Magnet (3), Growth (+5% XP, 5), Greed (+10% gold, 5), Fortune (5), Revival (2), Reroll (5), Skip (3), Banish (3). Cost: `base × (rank + 1)`, base 200; a refund button resets all.
- **Unlocks**: start with Knight, Ranger and Pyro. Necro: survive 10 minutes. Cleric: beat stage 1 (also opens stage 2; beating stage 2 opens stage 3). Shade: kill 3000 foes in one run. Bell: reach level 40 in one run. Each hero's signature weapon joins the general pool after the hero's first run.
- Profile autosaves in localStorage, plus a portable save code.
- **Encyclopedia** reveals only what the player met: heroes and stages a run started with, weapons (evolutions included) and passives the own hero owned, foes in the own view, bosses fought. Recorded on every client from its own view, merged at run end (win, defeat or quit); bot runs never save. Unmet entries list as a "???" silhouette (detail: "Not discovered yet"; locked heroes and stages keep their unlock rule and progress).

## 12. Feel (juice)

- Hit flash on every hit (white 60 ms); knockback on non-brute foes.
- Death burst particles (pooled), capped per frame.
- Damage numbers: on by default, merged per foe per 150 ms, capped at 60 alive (oldest dropped); crits bigger and yellow.
- Hit-stop 40–80 ms and screen shake only on skills, elite deaths and boss hits; shake scales down with crowd size.
- Gem vacuum: gems fly to the hero with an accelerating curve and a rising pitch "tink" (pitch climbs within a 0.4 s combo window).
- Audio: per-sound voice budget so 900 deaths never clip; music intensity follows the alive count and boss state.

## 13. Performance budget

- 900 foes + 600 projectiles + 400 gems: sim ≤ 2.5 ms per 60 Hz tick on the host; render ≤ 4 ms per frame on WebGL batched sprites, ≤ 8 ms on the Canvas2D fallback (crowd LOD).
- Snapshots: binary, quantized, interest-culled, ≤ 12 KB per snapshot per client at 20 Hz.
