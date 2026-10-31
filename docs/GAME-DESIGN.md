# Wickdeep — Game Design (canonical rules and numbers)

Co-op survivors-like (solo or up to 4 friends, browser, zero install). Hordes pour into an open arena; the hero's weapon fires on its own; the player moves, dodges, dashes and fires the hero skill. A good run turns the screen into a blender: by minute 12 the hero barely needs to move, bosses melt in seconds.

Units: world px (hero sprite ≈ 16–24 px tall), seconds. HP numbers are integers.

## 1. Design laws

1. **Upgrades change shape, not numbers.** Every shape rank of a path (path ranks 1 / 3 / 5) adds one of: +1 projectile, +pierce, +bounce, +area, +duration, a second emitter, a new pattern; a Form is a new pattern. A flat damage step is allowed only on shape ranks that also do something else. Exceptions by design (§4): the 5 tune steps before the path pick and the generic path ranks 2 / 4 are plain number steps. Players must see each shape pick on screen.
2. **Power multiplies, foes add.** Foe HP grows linearly with time; hero coverage (count × area × pierce × uptime) grows multiplicatively. Late runs out-scale the horde by design.
3. **Threat is the crowd, not the hit.** Contact damage is small (3–9 per hit at 100 max HP); death comes from getting surrounded, never from one trash hit.
4. **One line per card.** Level-up cards: name, icon, one line ≤ 40 characters ("+1 arrow, arrows pierce 1 more"). No paragraphs anywhere in a run.
5. **Big readable text.** Card text ≥ 20 px CSS, HUD numbers ≥ 16 px CSS, plain pixel font (no decorative faces).
6. **Every death is earned.** Elite and boss attacks are telegraphed ≥ 0.6 s.
7. **Determinism.** The sim is seeded and pure; never `Math.random` in `src/sim` or `src/data`.
8. **No off-screen wipe.** A hero's damage and targeting reach only its own view (§3).
9. **Every class is unique.** One own weapon and one skill per hero (support weapons are a shared pool); passives are generic stats and evolve nothing.

## 2. Run structure (Survival mode)

- **Length**: 20:00. Mid-bosses at 5:00, 10:00 and 15:00; the final boss at 20:00. Killing the final boss wins the run. At 22:00, if it is still alive, the final boss enrages (×3 damage and speed).
- **Phases**: 0:00–5:00, 5:00–10:00 and 10:00–15:00 each field their own roster; 15:00–20:00 adds no kind and turns the 10:00 roster brute-heavy (§7). **Benchmark** 17:00–20:00: a "surge" warning at 17:00, then elites every 30 s, an HP-heavy roster and a 70% density floor; the final boss stays the DPS check.
- **Pace**: foes walk 18–55 px/s (swarmers 41–55 and divers 50–53 fastest; every other walker 18–48), so the hero (78–84 px/s) outpaces every walker; a foe spawned at 0:00 walks at 80% of that, rising linearly to 100% for foes spawned from 4:00 (fixed at spawn; bosses exempt); charges and dives fly 210–300 px/s at full speed all run.
- **Arena**: bounded 3200 × 3200 world px per stage, solid edge walls, 20–40 scattered obstacles (pillars, ruins; circle colliders, radius 12–40) that make chokepoints, 40–55 destructible braziers (≥ 220 px apart, about one on screen) that drop pickups; any hero hit breaks one (swings, blasts, rings, pillars, and projectiles, which fly on without spending pierce), as does walking into it. A broken brazier relights 60 s after breaking once no living hero is within 700 px.
- **View**: about 640 × 360 world px (integer-scaled to the canvas). Each client follows its own hero.
- **Stages**: 3 stages (themes from the old biomes), each with its own foe roster, palette, three mid-bosses (the 15:00 one borrowed from another stage) and a final boss. Stage 1 is open; beating stage N unlocks N+1. Stage choice happens before the run.
- **Victory screen**: time, kills, level, damage per weapon (bar chart), gold earned.

## 3. Hero

| Stat | Base |
|---|---|
| Max HP | 100 (per hero: 80–130) |
| Armor | 0 (flat reduction per hit, minimum 1 damage taken) |
| Regen | 0 HP/s |
| Move speed | per hero: 78–84 px/s |
| Hitbox | 6 px radius (foe contact, foe shots, zones, blasts, slams); walls, pickups and braziers use a 10 px body |
| Pickup radius | 48 px |
| Dash (Space) | 0.2 s, 80 px, i-frames for its whole length, 3.5 s cooldown, 1 charge |
| Invulnerability after a hit | 0.5 s |

- **Controls**: WASD move (e.code), mouse aims the weapon and the skill (gamepad: right stick, else the left stick direction), Space dash, Q hero skill, 1–4 pick a level-up card, Esc pause (solo only). E and the mouse buttons are unbound by default.
- **The weapon fires on its own, toward the cursor.** Aim modes: `cursor` (directional: exactly along the cursor direction, foe or no foe, no aim assist; a cursor within 4 px of the hero uses the last movement direction), `random` (random foes on screen), `around` (orbit, aura or 360° pattern), `densest` (the densest foe cluster within range). Cursor: Cleave and its directional Forms (back swings mirror it), Edge Wave / Rending Gale crescents, every Ranger arrow (Spread's split fan: the second half at the nearest foe ≥ 0.35 rad off the cursor line, else 0.35 rad off it), Fire Bolt / Inferno / Pyre bolts, Bone Shard, Twin Daggers stabs and thrown daggers, Shadow Fan, the Lance sweep (centred on it); homing shots (Seeker, Wildfire seeds, seeking shards, Bone Storm's launch) leave along it, then home. **Targeted** (pick foes in view): Mortar shells, Firestorm and Napalm, Plague Field globs, Smite and its pillar Forms, minions, bounces and kill shots, Assassinate's mark (stabs take the mark while it is in reach and within 0.9 rad of the cursor). 360° patterns (Whirlwind, Earthsplitter, Blade Tempest, Toll and its Forms, Censer / Halo, Judgment Ray) ignore the cursor. **No foe in range**: every weapon still fires on its normal cooldown; targeted patterns fall back to the cursor direction (Smite / Wrath pillars stride out in a line, 60 px steps, kept on screen; Firestorm / Napalm land 120 px out; Plague Field globs 90 px out); Mortar shells wait for a foe.
- **No off-screen wipe**: a hero's damage and statuses (weapon, skill, minions, zones, burns, slows, stuns, freezes, knockback) land only on foes overlapping that hero's view rect (640 × 360 px centred on the hero's camera); its targeting picks only foes inside it, its projectiles vanish once fully outside it, and it breaks only braziers inside it.
- **Hero skill (Q)**: one per hero, aimed at the mouse cursor, cooldown 7–16 s (Knight's ward 25 s), and must look and feel huge: screen-wide effects, hit-stop, shake. Skill cards upgrade it (4 levels to level 5; level 5 is a capstone that changes the skill's shape, column Q level 5 below). **Utility, zero damage**: it moves, holds, blocks or diverts the horde (push, stun, slow, flee, lure, walls, heal, gem pull), so it matters more as the horde grows; the weapons do the killing. Bosses and knockback-immune foes are never displaced (the Knight's ward keeps knockback-immune foes out too); bosses ignore flee, decoys, taunts and walls; elites take half the displacement. Up to 2 charges where a level grants them (one recharge per cooldown; pips beside the Q slot).
- **Slots**: 3 weapons (slot 1: the hero's own weapon, from the start and fixed; slots 2–3: supports picked from the shared pool), 6 passives.

### Heroes

Full trees and numbers: `docs/heroes/<cls>.md` (canonical per hero).

| Hero | Role | HP | Speed | Weapon (auto) | Q | Q level 5 |
|---|---|---|---|---|---|---|
| Knight | Brawler | 130 | 78 | **Cleave**: a heavy sword arc toward the cursor | Aegis Ward (cd 25 s): a 50 px ward at the hero for 6.5 s; foes inside slide to its edge and no non-boss foe can step in (projectiles pass) | The ward follows the Knight |
| Ranger | Marksman | 90 | 84 | **Longbow**: piercing arrows along the cursor, first hit ×1.5 | Vault: leap 160 px toward the cursor over foes, untouchable; landing pulls gems within 200 px | Each landing pulls every gem in view |
| Pyro | Area denial | 100 | 80 | **Fire Bolt**: a bolt that bursts into burning ground | Flashpoint: foes within 140 px are knocked 120 px back and flee from the hero for 2 s | A second flash bursts 1 s later at the hero |
| Necro | Summoner | 105 | 78 | **Bone Shard**: piercing shards; keeps 3 skeletons raised from fresh corpses | Bone Wall: a 140 px curved wall at the cursor that foes cannot cross for 5 s | Walls last 2× as long and slow foes touching them 50% |
| Cleric | Support | 110 | 78 | **Smite**: holy pillars on foes within 230 px | Sanctuary: a zone that knocks foes out, heals allies 5 HP/s and slows foes | Allies inside take 40% less damage |
| Shade | Assassin | 80 | 84 | **Twin Daggers**: rapid narrow stabs, crits | Shadow Step: blink to the cursor; the afterimage is a decoy foes in its view chase for 2 s | For 1.5 s every foe chasing the Shade turns to the decoy |
| Bell | Controller | 115 | 78 | **Toll**: an orbiting bell peals rings that hold the horde at the rim | Great Peal: stuns every foe in view for 1.2 s and pushes it back | Erases every foe shot in view |

## 4. Weapons

Each hero has one own weapon (slot 1, fixed for the run) and gains up to 2 **support weapons** from a shared pool of 8 (a "new support" card appears while a support slot is free). Support trees and numbers: [supports.md](supports.md).

- **Slot lifecycle** (hero weapon and supports alike; slot level = 1 + tune + path rank + Form + refine, max 14):
  1. **Tune** (5 level-up cards): Damage +15% weapon damage, Haste cooldown ×0.91 ("+10% attack speed"), Area +12% area; at most 3 of one kind. Steps add up per kind (damage × (1 + 0.15 n)).
  2. **Path pick** (chest): at tune 5 the slot is path-ready and offers no level-up cards. An elite chest (or a boss chest with no Form ready) offers one card per path: path name and its rank-1 shape line. The pick is permanent (path rank 1); the other paths never apply to that slot.
  3. **Path ranks 2–5** (level-up cards, one per slot): ranks 1 / 3 / 5 are the path's 3 shape ranks (visible shape changes with small numbers, law 1); ranks 2 / 4 are generic steps: +10% damage and cooldown ×0.95 ("<Path> II: +10% damage, +5% speed"). Damage mostly comes from the Form.
  4. **Form fork** (chest): at path rank 5 the slot is Form-ready and offers no level-up cards. A boss chest from the 10:00 boss on (the 5:00 boss chest never forks a Form; or a benchmark elite chest) offers that path's Forms (2 for hero paths with 2, else 1). The Form replaces the pattern; the picked path's shape ranks keep applying. **One Form per slot.**
  5. **Refine** 1–2 (level-up cards).
- **Paths and Forms**: each weapon has 3 paths of 3 shape ranks. Hero paths list 1–2 Forms; each of a support's 3 paths lists its single Form.
- **Hidden**: a Form card shows `???` and "Unknown form of <weapon>" until the profile has owned that Form; no recipe is shown anywhere.
- **Numbers**: base damage 12–20 per hit, cooldown 0.6–1.6 s; a support's base direct hit kills a swarmer (10 HP) in ≤ 2 hits; cooldown floor 0.2 s; haste (passives + meta) caps at 50%.
- **Trees** (path → Forms):

| Hero | Path 0 → Forms | Path 1 → Forms | Path 2 → Forms |
|---|---|---|---|
| Knight | Greatblade → Colossus Blade, Earthsplitter | Whirl → Whirlwind | Edge Wave → Rending Gale, Blade Tempest |
| Ranger | Spread → Hail of Arrows, Gale Barrage | Piercer → Ballista | Ricochet → Seeker, Rebound |
| Pyro | Blaze → Inferno | Mortar → Firestorm, Napalm | Combustion → Wildfire, Pyre |
| Necro | Legion → Bone Lord, Ossuary | Shards → Bone Storm | Plague → Plague Field, Lich |
| Cleric | Storm → Wrath | Censer → Halo, Consecration | Lance → Judgment Ray, Verdict |
| Shade | Flurry → Thousand Cuts | Lethality → Assassinate, Death Lotus | Return → Shadow Fan, Reaper's Return |
| Bell | Peal → Cathedral, Undertow | Resonance → Glacier Toll, Windchime | Pendulum → Carillon |

- **Power yardstick** (`tools/dps.js`, weapon only, minute-10 crowd, no passives, no Q). Builds: **base**; **t5** (tune 5: damage 2, haste 2, area 1); **p<i>** (t5 + path i at rank 5); **f<i><j>** (p<i> + Form j of path i, refined twice). Measured hero crowd dps: base 305–680; t5 475–1,050; p 1,270–2,440; f directional 2,470–5,260 (cross-hero mean 3,552); f 360° 1,790–2,500 (Bell 1,855–2,000). **Role rule** on f rows: 360° Forms (spins, auras, orbits, every Bell Form) are Garlic-tier: crowd ≤ 0.6 × the hero's directional f mean (Bell: 0.6 × the cross-hero directional f mean, ≈ 2,130), reach ≤ 60 px, strong push; directional Forms deal ≥ 2 × the hero's best 360° Form on a single target. Forms of one kind (360° / directional) of one hero sit within ±25% of their mean. `dps.js` prints this check after the hero tables.

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

Max 6 passives. Passives are generic stats: they evolve nothing and name no weapon. Haste caps at 50% (§4).

## 6. Level-ups

- XP to the next level: `xpFor(L) = 3 + 11 × (L − 1) + 1.5 × (L − 1)²`, rounded (3 for level 2; cumulative 731 to level 10, 5,106 to 20, 16,131 to 30).
- Each level offers 3 cards (4 with Fortune luck), drawn from: each owned slot's next step (§4: a tune card per kind below its cap, else the next path rank, else the next refine; nothing while the slot waits for a chest), new support (if a support slot is free), new passive (if a slot is free), passive level, hero skill upgrade (Q, 4 levels). Path picks and Forms come only from chest offers (§9). Gold (+25) or heal (+30 HP) when nothing is left. No card has a second line.
- Reroll, Skip and Banish: counts come from meta upgrades. Banish removes one card's item from the run's pool and replaces that card; a new-support card banishes that support. Gold, Meal, tune and path rank cards cannot be banished (a slot's only way to its path pick and Form). Chest offers (path pick, Form) cannot be rerolled, skipped or banished.
- Card weights are per item, so no single build line dominates and luck matters: each owned slot 3 in total, split evenly over its cards; new support 3 in total, split over the free supports; new passive 4 in total, split over the unowned passives (while a passive slot is free); passive level 2 each (3 with every passive slot full); skill 1.5. Banished cards leave the split. Weapon-card guarantee (tune, path rank, new support, refine): the offers of levels 2 and 3 draw their first card from the weapon cards when the pool has one; the order is then shuffled. No guarantee after level 3.
- **Solo**: the game pauses while picking. **Co-op**: no pause; cards appear in a compact strip at the bottom; pick with 1–4 while moving; 1 s of invulnerability after picking.
- XP is shared in co-op (one bar, everyone levels together, each player picks their own card).

## 7. Foes and spawning

- **Spawn timeline** per stage, per minute: spawn rate (foes/s), alive cap, weighted roster. Foes spawn on a ring 380–460 px from a random living hero, never inside walls or obstacles; successive spawn angles step by the golden angle (±0.3 rad), so the horde closes in from every side. Rate per minute 1.2 · 2.2 · 2.8 · 3.8 · 4.9 · 6 · 8.1 · 10.2 · 11.9 · 13.6 · 14 · 16.2 · 17.8 · 19.6 · 21.3 · 22.5 · 23.5 · 24.5 · 25.5 · 26 · 24 foes/s (stage 3 ×1.05; the 20:00 dip runs under the final boss); the 0:00 roster is chasers only. Swarmers are in no roster: they come only in flocks and swarm waves (Events).
- **Roster tiers**: the opening kinds (chaser, splitter, ranged, exploder) fade to 0 by 7:00–10:00, except Abyss's Shade (its only plain chaser: every minute keeps a plain chaser as the filler when brain caps re-pick); each stage adds its charger, diver, brute and a new kind at 5:00 and a second new kind at 10:00 (chargers and divers leave at 11:00). Ossuary: Bone Bulwark (5:00), Bone Caller (10:00). Glowmire: Bog Bloater (5:00), Mire Crab (10:00). Abyss: Rift Stalker (5:00), Void Colossus (10:00). From 12:00 the roster is brute-heavy (brute weight 3–5 of ~20; alive brutes stay under the brute cap). 15:00–20:00 adds no kind: the brute and the 10:00 kind weigh ~30% more by 18:00 (brute 3 → 3.9), spikes at 16:00 and 18:00, the plain chaser filler stays ≥ 3, no chargers or divers.
- **Alive cap**: 80 / 150 / 220 at 0:00 / 1:00 / 2:00, 300 at 3:00 rising to 700 at 12:00, holding to 20:00 (solo); +25% per extra player, hard cap 900.
- **Density floor**: while fewer foes live than the floor, each tick spawns 10% of the deficit (at least 6, at most 40), refilling the screen within ~0.4 s. Floor = alive cap × min(0.6, 0.05 × (minute + 1)) from 1:00, 0.7 from 12:00: none at 0:00 (the run opens on an empty field), 10% at 1:00, 30% at 5:00, 60% from 11:00, 70% in the benchmark. A fast-killing build still faces a full screen.
- **Foe HP**: `base × (1 + g × minute) × (1 + 0.5 × (players − 1)) × stage HP`, fixed at spawn; g = 0.06 for swarmers (swarm brain, splitter children included), 0.11 for every other foe (×3.2 at 20:00; boss parts 0.24; bosses: §8). Stage HP 1 / 0.85 / 0.9 (the later stages' rosters and bosses are tougher, the factor evens them out). Base HP at 0:00 solo: chasers 20–27 (one level-1 Knight hit until about 1:30), swarmers and divers 10–11 (one regular hit of a level-1 signature weapon, Bell's 9-damage aura aside), exploders 11–13, ranged and chargers 16–24, splitters 33–40 (Bloatling 13), tier kinds 22–44, brutes 111–192, Mire Crab 96. Armour (damage taken ×): Bone Bulwark 0.35 shielded / 1.3 open, Mire Crab 0.7, Void Colossus 0.8.
- **Contact damage**: 3 at 0:00 rising to 9 at 15:00 and 11 at 20:00 (then holds), × stage damage (1 / 1 / 1). Foe shots and blasts: base (shots 4–5, blasts 10–12 at 0:00) × (1 + 0.8 × min(1, t / 15:00) + 0.3 × clamp((t − 15:00) / 5:00, 0, 1)) × stage damage (×1.8 at 15:00, ×2.1 at 20:00).
- **Foe kinds**: chaser (straight line), swarmer (fast, weak, the stage's flyer; flocks and swarm waves only), brute (slow, 8× HP, knockback-immune, telegraphed slam; slam radius 34 + body radius (46 / 47 / 48 / 49 px for Skeleton Knight / Shroom Hulk / Abyssal Horror / Void Colossus), so a base-reach Knight cleave hits it from 12 px outside the slam), ranged (holds 160–200 px and never backs away; a telegraphed bolt or a stream of bolts down one aim line (each next shot 12% slower), a shot ring, or a lob: a 0.9 s-warned 30 px circle at the target's spot, then a blast there; only from inside the target's screen; shots fly 160 px past the target, at most 4 s), exploder (telegraphed 0.7 s burst on contact), splitter (splits in 2–3 on death; the children land on a ±70° half-arc on the far side from the nearest hero, never closer to it than the parent), charger (chases; a telegraphed dash only when its lane (dash speed × time + radius) reaches 12 px past the target's spot, then stands still 0.8 s; packs of 2–4), diver (spirals in at its walk speed (inward + 0.7 × sideways), a telegraphed dive under the same lane rule, then stands still 0.8 s; packs of 3–5). Charge and dive lanes are quiet: two thin edge lines and a centre progress line, drawn under foe shots, no warning sound. Tier kinds: **guard** (Bone Bulwark: shield up, a 0.8 s-warned shield bash, then 1.6 s open), **summoner** (Bone Caller: holds 210 px, a 1 s summon ring raises 3 skeletons, every 8 s, below the alive cap), **double splitter** (Bog Bloater → 2 Bloatlings → 2–3 Glowlets each), **wall** (Mire Crab: packs of 3–4 spawn as a line 26 px apart and close in as a line; knockback-immune), **blinker** (Rift Stalker: packs of 1–2; marks a spot 36 px beside the target for 0.7 s, appears there, then a 0.6 s-warned 34 px slash), **pull brute** (Void Colossus: a 1.2 s slam wind-up drags heroes within 150 px toward it at 45 px/s; dash breaks free). Every attack telegraph is ≥ 0.6 s and aimed where the target stood when the wind-up began; killing, stunning or freezing the foe cancels it.
- **Shooter cap**: alive ranged foes ≤ round(min(8, 3 + 0.4 × minute) × (1 + 0.25 × (players − 1))) (solo 3 / 5 / 7 at 0:00 / 5:00 / 10:00, 8 from 12:00); summoners ≤ round(2 × the same party factor). A capped roster pick re-rolls among the other kinds; elites never promote a capped kind.
- **Dasher cap**: alive chargers, divers and blinkers together ≤ round(min(12, 3 + 0.6 × minute) × the same party factor) (solo 3 / 6 / 9 at 0:00 / 5:00 / 10:00, 12 from 15:00). Packs shrink to the room left; stampedes skip dasher members at the cap; elites never promote a capped kind.
- **Brute cap**: alive brutes ≤ round(min(8, 2 + 0.35 × minute) × the same party factor) (solo 2 / 4 / 6 / 7 at 0:00 / 5:00 / 10:00 / 15:00, 8 from 15:43). A capped pick re-rolls among the other kinds; elite brutes may exceed the cap by 2.
- **Attack budget**: each hero holds attack tokens (start 1, max 2, refill 0.5 + 0.05 × minute per s); each ranged, charge, dive or blink start against that hero spends one; with none left a shooter keeps moving and waits, chargers and blinkers keep chasing, divers keep closing in.
- **Events**: a **flock** every 18 s from 0:40: round(n × (1 + 0.25 × (players − 1))) swarmers, n 8 at 0:40 rising linearly to 40 at 10:00 and 52 at 20:00 (then holds), on the spawn ring at the next golden-angle step around a random living hero, 50/50 one tight pack (40 px) or one line (× 1.5 swarmers, 14 px apart across the heading); flocks ignore the density floor and may exceed the alive cap by 25% (never the hard cap 900). A swarm wave every 120 s from 2:00 (a ring of 24–60 swarmers closing in: 24 at 2:00 rising to 50 by 12:00 and 60 by 20:00 (±4), or a stampede line crossing the screen; stampedes mix in the stage's walkers present in the current roster). **Fly-through**: flock and swarm-wave members fly one fixed heading through the hero's spot (where it stood at spawn) at 120 px/s × foe pace and never turn or chase; once past every living hero and more than 360 px outside every hero's design view (wide windows show up to ~320 px more), or at the arena edge, they vanish (no gem, no kill): a missed flock is missed XP.
- **Elites**: one every 60 s from 2:30, every 30 s from 17:00 (a non-exploder roster foe at 2× size, 15 × max(1, 60 / its base HP) × its spawned HP (small foes get the 60-HP floor: a chaser elite ~45×; brutes 15×), glowing outline); drops a chest and, at 50%, food. Elite attacks change shape: ranged fire 2 more shots in their stream (ring casters 1.5×, lob circles 1.5× radius), charges and dives last 1.35× longer, brute slams get 1.35× radius plus a shot ring, splitters split into 3 extra children.
- **Off-screen culling**: foes farther than 900 px (elites 1300 px) from every hero teleport to a fresh spawn point ahead of a hero; bosses never.
- **Separation**: foes push apart on the spatial grid; they flow around obstacles.
- **XP income** (first-pass estimates, scaled from the earlier spawn rates; to be re-measured): a player who keeps up with the spawn rate collects about 2,000 / 8,100 / 20,800 XP by 5:00 / 10:00 / 15:00 (near level 11 / 19 / 26); one who kills faster draws more through the density floor (a max-level signature alone: about 2,600 / 13,000 / 34,000, near level 12 / 22 / 31). Level curve: `xpFor(L) = 3.75 + 15 × (L − 1) + 2.025 × (L − 1)²` (cumulative 987 to level 10, 6,907 to 20, 21,820 to 30): cheap early levels, so the opening offers come fast.

## 8. Bosses

Each boss: 2–3 telegraphed patterns, a health bar at the top, HP `= 1500 × (minute / 5)^2 × players factor × stage HP` (1500 / 6000 / 13500 / 24000 at 5:00 / 10:00 / 15:00 / 20:00; a multi-body boss splits it, e.g. the Twins two halves). Bosses drop a chest: a Form fork when a weapon is Form-ready, else a path pick when one is path-ready, else an extra level-up (§9). While a boss lives, normal spawns run at 50% rate.

- **Roster** (5:00 · 10:00 · 15:00 · final 20:00): Ossuary — Bone Warden · The Twins · Demon Cyclops · Hollow King. Glowmire — Sporemother · Demon Cyclops · Rift Weaver · Drowned King. Abyss — Blue Samurai · Rift Weaver · The Twins · The Wick-Eater. The 15:00 mid-boss is borrowed from another stage for now.
- **Adds**: boss adds come from the host stage's roster by kind (same brain; a swarmer becomes the stage's flock foe; home-stage adds stay as written) and respect the brain caps (§7): a ranged, summoner, dasher or brute add at its cap is skipped.
- **Pace**: bosses walk 24–46 px/s; dashes 256–496 px/s; leaps fly 1.19–1.38 s; shots 81–340 px/s.
- **Rift Weaver**: rift gates around the target open into portals that shoot; warned threads cross the target (strands stay from phase 2); blink with a bolt ring; adds.
- **The Wick-Eater**: devour (warned cone inhales heroes toward a warned bite); closing dark (a ring shrinks onto it, pass through a gap or dash); lash fans; spiralling orb bloom; adds; swells at phase 3.

## 9. Pickups

- **XP gems**: small (1), medium (5, from elites and brutes), large (25). At 350 gems on the ground a new drop still lands where the foe died: it merges into the nearest gem within 80 px, else the gem farthest from every hero vanishes and its value rides on the new gem (XP is never lost).
- **Gold coins**: 1–5 from braziers (78%); 1–5 × stage gold from elites; a 100 × stage gold coin from each mid-boss; worth value × (1 + greed + luck / 2) to the collector. The final boss kill (300), the victory (300) and the run-end pay (win or loss: 1 per 100 kills + 10 per full minute survived) pay × stage gold × the party's mean gold multiplier straight to the run's gold. Stage gold: ×1 / ×1.25 / ×1.5.
- **Food**: heals 30 HP; braziers (20%) and elites (50%, on top of the chest). No passive regen by default.
- **Magnet** (hero kills of non-boss foes, 0.3% per kill, from 2:20 and at least 100 s after the previous magnet; a new magnet replaces an uncollected one; ≈ first at 2:30–4:00, 8–10 per 20-minute run): pulls every gem on the map. Drawn with a pulsing blue halo.
- **Holy Bomb** (braziers, 2%): kills every non-elite foe on screen.
- **Chest**: a chest queues at most one chest offer, for the first waiting slot in slot order (hero weapon first), and only while the hero has more waiting slots of that kind than queued offers. Elite chest: a path-pick offer when a slot is path-ready (§4); else from the benchmark a Form offer when a slot is Form-ready; else one roll levelling a random owned passive or the skill, or gold when nothing can level. Boss chest (5:00, 10:00, 15:00): a Form offer (that slot's path Forms) when a slot is Form-ready, from the 10:00 boss on; else a path-pick offer when a slot is path-ready; else one extra level-up offer. A queued chest offer whose slot no longer waits becomes an extra level-up. Chest offers take picks only. Co-op: whoever opens a chest, every hero that is not dead gets its own reward (downed heroes too; a downed hero picks its chest offers after revival).

## 10. Co-op

- 1–4 players, PeerJS; the host runs the sim.
- **Downed** at 0 HP: 20 s bleed-out; a teammate standing within 40 px for 2.5 s revives at 40% HP. All heroes down → defeat. Solo death ends the run unless a Revival charge is left (meta).
- Each client follows its own hero; foes and gems are snapshot only within the client's view plus a margin (interest culling).
- Each hero's damage lands only inside its own view (§3): a hero far from the fight cannot clear it for the party.

## 11. Meta progression

- **Gold** carries over, including a lost run's collected gold. Survival and bosses pay more than kill count (§9): at Greed 0 a 10-minute loss pays ≈ 300–450 (the 5:00 mid-boss 100, 100 for ten minutes, ≈ 50 bounty, a few coins); a 20-minute win ≈ 1,500 / 2,000 / 2,500 on stages 1 / 2 / 3 (bot wins with every Camp rank, gold bonus divided out: 1,605 / 2,436 / 2,553; a no-Camp win on stage 2: 2,043; three mid-bosses 300, final + win 600, minutes 200, bounty ≈ 270–390). Greed and Fortune raise it up to ×1.625.
- **Camp shop**: permanent ranks; price of rank r + 1 = `cost × (r + 1)²` (cheap first ranks, steep tops); Refund All returns every coin paid for the owned ranks (a profile from before this rule refunds at the old 80 × rank prices). Shop total 43,360 ≈ 15 full runs (≈ 5 hours) with Greed bought along the way; achievements (≈ 5,350) pay for Shade.

  | Rank | Max | Per rank | cost | Total |
  |---|---|---|---|---|
  | Might | 5 | +5% damage | 65 | 3,575 |
  | Vigor | 5 | +10 max HP | 35 | 1,925 |
  | Plating | 3 | +1 armor | 120 | 1,680 |
  | Mending | 5 | +0.1 HP/s | 40 | 2,200 |
  | Swiftness | 3 | +5% move speed | 80 | 1,120 |
  | Magnet | 3 | +10% pickup radius | 40 | 560 |
  | Growth | 5 | +5% XP | 55 | 3,025 |
  | Greed | 5 | +10% gold | 45 | 2,475 |
  | Fortune | 5 | +5% luck | 45 | 2,475 |
  | Revival | 2 | +1 revive per run | 550 | 2,750 |
  | Reroll | 5 | +1 reroll per run | 35 | 1,925 |
  | Skip | 3 | +1 skip per run | 35 | 490 |
  | Banish | 3 | +1 banish per run | 65 | 910 |
  | Haste | 5 | −4% weapon cooldown | 65 | 3,575 |
  | Reach | 5 | +5% area | 55 | 3,025 |
  | Duration | 5 | +5% effect duration | 40 | 2,200 |
  | Velocity | 5 | +6% projectile speed and range | 35 | 1,925 |
  | Multishot | 1 | +1 projectile (weapons that fire them; Knight's and Bell's own weapons fire none) | 4,500 | 4,500 |
  | Focus | 5 | −4% skill cooldown (cap 50%) | 55 | 3,025 |
- **Unlocks**: start with Knight, Ranger and Pyro. Necro: survive 15 minutes. Cleric: beat stage 1 (also opens stage 2; beating stage 2 opens stage 3). Shade: buy for 4,000 gold (Camp or the hero-select lock). Bell: win any stage with 0 Camp ranks at run start (Refund All first; co-op counts the local player's ranks). Unlocked heroes are never revoked.
- **Achievements** (29, each pays its gold once; a reward id slot for cosmetics): survive 5:00 (50); beat stage 1 / 2 / 3 (200 / 300 / 400); win with each hero (150 each); reach each hero's Form (100 each); 5,000 / 15,000 kills in one run (100 / 200); 25,000 / 100,000 / 250,000 lifetime kills (150 / 300 / 500); level 40 in a run (200); 10 wins (300); a no-Camp win (400); a co-op win (200); every hero unlocked (300); every Camp rank maxed (0, cosmetic later). Checked at run end, after a Camp purchase and when the Camp or Achievements screen opens (records from before an achievement existed pay then); the results screen lists new ones next to the unlocks.
- Profile autosaves in localStorage, plus a portable save code.
- **Encyclopedia** reveals only what the player met: heroes and stages a run started with, weapons (Forms included) and passives the own hero owned, foes in the own view, bosses fought. Recorded on every client from its own view, merged at run end (win, defeat or quit); bot runs never save. Unmet entries list as a "???" silhouette (detail: "Not discovered yet"; locked heroes and stages keep their unlock rule and progress).

## 12. Feel (juice)

- Pixel-only world: every world visual (sprites, zones, telegraphs, rings, cones, lines) is pixel art at 1 art px = 1 world px with hard edges (no anti-aliasing), integer-upscaled; only post effects (bloom, grade, vignette) are smooth.
- Hit flash on every hit (white 60 ms); knockback on non-brute foes, always away from the hitting hero (a blast or shot behind a foe never pushes it into the hero); explicit pulls (Bell) keep their own direction.
- Death burst particles (pooled), capped per frame.
- Damage numbers: on by default, merged per foe per 150 ms, capped at 60 alive (oldest dropped); crits bigger and yellow.
- Hit-stop 40–80 ms and screen shake only on skills, elite deaths and boss hits; shake scales down with crowd size.
- Gem vacuum: gems fly to the hero with an accelerating curve and a rising pitch "tink" (pitch climbs within a 0.4 s combo window).
- Audio: per-sound voice budget so 900 deaths never clip; music intensity follows the alive count and boss state.

## 13. Performance budget

- 900 foes + 600 projectiles + 400 gems: sim ≤ 2.5 ms per 60 Hz tick on the host; render ≤ 4 ms per frame on WebGL batched sprites, ≤ 8 ms on the Canvas2D fallback (crowd LOD).
- Snapshots: binary, quantized, interest-culled, ≤ 12 KB per snapshot per client at 20 Hz.
