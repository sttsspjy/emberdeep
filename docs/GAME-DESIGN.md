# Wickdeep — Game Design (canonical rules and numbers)

Co-op survivors-like (solo or up to 4 friends, browser, zero install). Hordes pour into an open arena; the hero's weapon fires on its own; the player moves, dodges, dashes and fires the hero skill. A good run turns the screen into a blender: by minute 12 the hero barely needs to move, bosses melt in seconds.

Units: world px (hero sprite ≈ 16–24 px tall), seconds. HP numbers are integers.

## 1. Design laws

1. **Upgrades change shape, not numbers.** Every path rank adds one of: +1 projectile, +pierce, +bounce, +area, +duration, a second emitter, a new pattern; a Form is a new pattern. A flat damage step is allowed only on ranks that also do something else. Players must see each pick on screen.
2. **Power multiplies, foes add.** Foe HP grows linearly with time; hero coverage (count × area × pierce × uptime) grows multiplicatively. Late runs out-scale the horde by design.
3. **Threat is the crowd, not the hit.** Contact damage is small (3–12 per hit at 100 max HP); death comes from getting surrounded, never from one trash hit.
4. **One line per card.** Level-up cards: name, icon, one line ≤ 40 characters ("+1 arrow, arrows pierce 1 more"). No paragraphs anywhere in a run.
5. **Big readable text.** Card text ≥ 20 px CSS, HUD numbers ≥ 16 px CSS, plain pixel font (no decorative faces).
6. **Every death is earned.** Elite and boss attacks are telegraphed ≥ 0.6 s.
7. **Determinism.** The sim is seeded and pure; never `Math.random` in `src/sim` or `src/data`.
8. **No off-screen wipe.** A hero's damage and targeting reach only its own view (§3).
9. **Every class is unique.** One own weapon and one skill per hero (support weapons are a shared pool); passives are generic stats and evolve nothing.

## 2. Run structure (Survival mode)

- **Length**: 15:00. Bosses at 5:00 and 10:00; the final boss at 15:00. Killing the final boss wins the run. At 17:00, if it is still alive, the final boss enrages (×3 damage and speed).
- **Phases**: 0:00–5:00, 5:00–10:00 and 10:00–15:00 each field their own roster (§7). **Benchmark** 12:00–15:00: a "surge" warning at 12:00, then elites every 30 s, an HP-heavy roster and a 70% density floor; the final boss stays the DPS check.
- **Pace**: foes walk 20–59 px/s (divers and swarmers fastest), so the hero (64–80 px/s) outpaces every walker; a foe spawned at 0:00 walks at 80% of that, rising linearly to 100% for foes spawned from 4:00 (fixed at spawn; bosses exempt); charges and dives fly 210–300 px/s at full speed all run.
- **Arena**: bounded 3200 × 3200 world px per stage, solid edge walls, 20–40 scattered obstacles (pillars, ruins; circle colliders, radius 12–40) that make chokepoints, 40–55 destructible braziers (≥ 220 px apart, about one on screen) that drop pickups; any hero hit breaks one (swings, blasts, rings, pillars, and projectiles, which fly on without spending pierce), as does walking into it. A broken brazier relights 60 s after breaking once no living hero is within 700 px.
- **View**: about 640 × 360 world px (integer-scaled to the canvas). Each client follows its own hero.
- **Stages**: 3 stages (themes from the old biomes), each with its own foe roster, palette, two mid-bosses and a final boss. Stage 1 is open; beating stage N unlocks N+1. Stage choice happens before the run.
- **Victory screen**: time, kills, level, damage per weapon (bar chart), gold earned.

## 3. Hero

| Stat | Base |
|---|---|
| Max HP | 100 (per hero: 80–130) |
| Armor | 0 (flat reduction per hit, minimum 1 damage taken) |
| Regen | 0 HP/s |
| Move speed | per hero: 68–80 px/s |
| Pickup radius | 48 px |
| Dash (Space) | 0.2 s, 80 px, i-frames for its whole length, 3.5 s cooldown, 1 charge |
| Invulnerability after a hit | 0.5 s |

- **Controls**: WASD move (e.code), mouse aims the weapon and the skill (gamepad: right stick, else the left stick direction), Space dash, Q hero skill, 1–4 pick a level-up card, Esc pause (solo only). E and the mouse buttons are unbound by default.
- **The weapon fires on its own, toward the cursor.** Aim modes: `cursor` (directional: exactly along the cursor direction, foe or no foe, no aim assist; a cursor within 4 px of the hero uses the last movement direction), `random` (random foes on screen), `around` (orbit, aura or 360° pattern), `densest` (the densest foe cluster within range). Cursor: Cleave and its directional Forms (back swings mirror it), Edge Wave / Rending Gale crescents, every Ranger arrow (Spread's split fan: the second half at the nearest foe ≥ 0.35 rad off the cursor line, else 0.35 rad off it), Fire Bolt / Inferno / Pyre bolts, Bone Shard, Twin Daggers stabs and thrown daggers, Shadow Fan, the Lance sweep (centred on it); homing shots (Seeker, Wildfire seeds, seeking shards, Bone Storm's launch) leave along it, then home. **Targeted** (pick foes in view): Mortar shells, Firestorm and Napalm, Plague Field globs, Smite and its pillar Forms, minions, bounces and kill shots, Assassinate's mark (stabs take the mark while it is in reach and within 0.9 rad of the cursor). 360° patterns (Whirlwind, Earthsplitter, Blade Tempest, Toll and its Forms, Censer / Halo, Judgment Ray) ignore the cursor. **No foe in range**: every weapon still fires on its normal cooldown; targeted patterns fall back to the cursor direction (Smite / Wrath pillars stride out in a line, 60 px steps, kept on screen; Firestorm / Napalm land 120 px out; Plague Field globs 90 px out); Mortar shells wait for a foe.
- **No off-screen wipe**: a hero's damage (weapon, skill, minions, zones, burns) lands only on foes overlapping that hero's view rect (640 × 360 px centred on the hero's camera); its targeting picks only foes inside it, its projectiles vanish once fully outside it, and it breaks only braziers inside it.
- **Hero skill (Q)**: one per hero, aimed at the mouse cursor, cooldown 7–16 s, and must look and feel huge: screen-wide effects, hit-stop, shake. Skill cards upgrade it (3 levels, shape). **Utility, zero damage**: it moves, holds, blocks or diverts the horde (push, stun, slow, flee, lure, walls, heal, gem pull), so it matters more as the horde grows; the weapons do the killing. Bosses and knockback-immune foes are never displaced; bosses ignore flee, decoys, taunts and walls; elites take half the displacement. Up to 2 charges where a level grants them (one recharge per cooldown).
- **Slots**: 3 weapons (slot 1: the hero's own weapon, from the start and fixed; slots 2–3: supports picked from the shared pool), 6 passives.

### Heroes

Full trees and numbers: `docs/heroes/<cls>.md` (canonical per hero).

| Hero | Role | HP | Speed | Weapon (auto) | Q |
|---|---|---|---|---|---|
| Knight | Brawler | 130 | 68 | **Cleave**: a heavy sword arc toward the cursor | Bulwark Shove: foes within 120 px slide out to 200 px and are slowed 50% for 3 s |
| Ranger | Marksman | 90 | 80 | **Longbow**: piercing arrows along the cursor, first hit ×1.5 | Vault: leap 160 px toward the cursor over foes, untouchable; landing pulls gems within 200 px |
| Pyro | Area denial | 85 | 74 | **Fire Bolt**: a bolt that bursts into burning ground | Flashpoint: foes within 140 px are knocked 120 px back and flee from the hero for 2 s |
| Necro | Summoner | 95 | 70 | **Bone Shard**: piercing shards; keeps 3 skeletons raised from fresh corpses | Bone Wall: a 140 px curved wall at the cursor that foes cannot cross for 5 s |
| Cleric | Support | 110 | 70 | **Smite**: holy pillars on foes within 230 px | Sanctuary: a zone that knocks foes out, heals allies 5 HP/s and slows foes |
| Shade | Assassin | 80 | 80 | **Twin Daggers**: rapid narrow stabs, crits | Shadow Step: blink to the cursor; the afterimage is a decoy foes in its view chase for 2 s |
| Bell | Controller | 115 | 69 | **Toll**: an orbiting bell peals rings that hold the horde at the rim | Great Peal: stuns every foe in view for 1.2 s and pushes it back |

## 4. Weapons

Each hero has one own weapon (slot 1, fixed for the run) and gains up to 2 **support weapons** from a shared pool of 8 (a "new support" card appears while a support slot is free). Support trees and numbers: [supports.md](supports.md).

- **Paths**: each weapon has 3 paths of 3 ranks. Every rank is a visible shape change (law 1); levels 1 and 2 of a path may carry a damage step only beside a shape change.
- **Forms**: a path at rank 3 readies that path's Form (if it has one); 0–2 hidden **hybrid Forms** per hero need two specific paths at rank 3; a support's single Form is ready once any of its 3 paths is at rank 3. **One Form per slot**: taking it locks that slot's other Forms. Forms come **only from chests** (§9), never from level-ups: the Form offer lists every ready Form of every slot (up to 4) and the player picks one. A Form replaces the weapon's pattern; path ranks keep applying after it (the other paths can still reach rank 3). A Form then has 2 refine ranks.
- **Hidden**: a Form card shows `???` and "Unknown form of <weapon>" until the profile has owned that Form; no recipe is shown anywhere.
- **Numbers**: base damage 12–20 per hit, cooldown 0.6–1.6 s; cooldown floor 0.2 s; haste (passives + meta) caps at 50%.
- **Trees** (paths → Form; hybrids need both paths at rank 3):

| Hero | Path 0 → Form | Path 1 → Form | Path 2 → Form | Hybrids |
|---|---|---|---|---|
| Knight | Greatblade → Colossus Blade | Whirl → Whirlwind | Edge Wave → Rending Gale | Earthsplitter (0+1), Blade Tempest (1+2) |
| Ranger | Spread → Hail of Arrows | Piercer → Ballista | Ricochet → Seeker | Gale Barrage (0+1), Rebound (1+2) |
| Pyro | Blaze → Inferno | Mortar → Firestorm | Combustion → Wildfire | Pyre (Blaze+Combustion), Napalm (Blaze+Mortar) |
| Necro | Legion → Bone Lord | Shards → Bone Storm | Plague → Plague Field | Lich (Legion+Plague), Ossuary (Legion+Shards) |
| Cleric | Storm → Wrath | Censer → Halo | Lance → Judgment Ray | Consecration (Storm+Censer), Verdict (Storm+Lance) |
| Shade | Flurry → Thousand Cuts | Lethality → Assassinate | Return → Shadow Fan | Death Lotus (0+1), Reaper's Return (1+2) |
| Bell | Peal → Cathedral | Resonance → Glacier Toll | Pendulum → Carillon | Undertow (Peal+Pendulum), Windchime (Resonance+Pendulum) |

- **Power yardstick** (`tools/dps.js`, weapon only, minute-10 crowd, no passives, no Q): base 300–750 crowd dps; all 9 ranks 2,000–4,000; Form base (its path at rank 3, refined twice): directional Forms 3,400–5,600. **Role rule** at Form base: 360° Forms (spins, auras, orbits, every Bell Form) are Garlic-tier: crowd ≤ 0.6 × the hero's directional Form mean (Bell: 0.6 × the cross-hero directional mean, ≈ 2,780), reach ≤ 60 px, strong push; directional Forms deal ≥ 2 × the hero's best 360° Form on a single target. Forms of one kind (360° / directional) of one hero sit within ±25% of each other.

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

- XP to the next level: `xpFor(L) = 3.75 + 15 × (L − 1) + 2.025 × (L − 1)²`, rounded (4 for level 2; cumulative 987 to level 10, 6,907 to 20, 21,820 to 30).
- Each level offers 3 cards (4 with Fortune luck), drawn from: path rank of any slot (weapon name, path name, rank line), new support (if a support slot is free), Form refine, new passive (if a slot is free), passive level, hero skill upgrade (Q, 3 levels). Gold (+25) or heal (+30 HP) when nothing is left. No card has a second line.
- Reroll, Skip and Banish: counts come from meta upgrades. Banish removes one card's item from the run's pool and replaces that card (Gold and Meal cannot be banished); a path card banishes that path, a new-support card that support. A chest Form offer cannot be rerolled, skipped or banished.
- Card weights: path rank 4; new support 2.5; refine 3; passive level 3 (+1.5 when passive slots are full); new passive 2; skill 1.5. Weapon-card guarantee (path rank of any slot, new support, refine): every offer and reroll holds at least 1, and 2 while the party level is ≤ 5 (the first 4 offers), when the pool has them; those are drawn first from the weapon cards, the rest from the full pool, then the order is shuffled.
- **Solo**: the game pauses while picking. **Co-op**: no pause; cards appear in a compact strip at the bottom; pick with 1–4 while moving; 1 s of invulnerability after picking.
- XP is shared in co-op (one bar, everyone levels together, each player picks their own card).

## 7. Foes and spawning

- **Spawn timeline** per stage, per minute: spawn rate (foes/s), alive cap, weighted roster. Foes spawn on a ring 380–460 px from a random living hero, never inside walls or obstacles; successive spawn angles step by the golden angle (±0.3 rad), so the horde closes in from every side. Rate per minute 1.2 · 2.2 · 2.8 · 3.8 · 4.9 · 6 · 8.1 · 10.2 · 11.9 · 13.6 · 14 · 16.2 · 17.8 · 19.6 · 21.3 · 18.7 foes/s (stage 3 ×1.05); the 0:00 roster is chasers only, swarmers join at 1:00.
- **Roster tiers**: the opening kinds (chaser, splitter, ranged, exploder) fade to 0 by 7:00–10:00; each stage adds its charger, diver, brute and a new kind at 5:00 and a second new kind at 10:00 (chargers and divers leave at 11:00); swarmers stay all run. Ossuary: Bone Bulwark (5:00), Bone Caller (10:00). Glowmire: Bog Bloater (5:00), Mire Crab (10:00). Abyss: Rift Stalker (5:00), Void Colossus (10:00). From 12:00 the roster is brute-heavy (brute weight 3–5 of ~20).
- **Alive cap**: 80 / 150 / 220 at 0:00 / 1:00 / 2:00, 300 at 3:00 rising to 700 at 12:00 (solo); +25% per extra player, hard cap 900.
- **Density floor**: while fewer foes live than the floor, each tick spawns up to 10% of the deficit (max 40), refilling the screen within ~0.3 s. Floor = alive cap × min(0.6, 0.05 × (minute + 1)) from 1:00, 0.7 from 12:00: none at 0:00 (the run opens on an empty field), 10% at 1:00, 30% at 5:00, 60% from 11:00, 70% in the benchmark. A fast-killing build still faces a full screen.
- **Foe HP**: `base × (1 + 0.24 × minute) × (1 + 0.5 × (players − 1)) × stage HP` (stage HP 1 / 0.85 / 0.9: the later stages' rosters and bosses are tougher, the factor evens them out). Base HP at 0:00 solo: chasers 54–63 (3–5 hits of a level-1 signature weapon), swarmers (and splitter children) 24–34 (no one-hit kill from a level-1 weapon), brutes 300–520, Mire Crab 260, splitters 90–108, ranged / chargers / divers / exploders / tier kinds 24–120. Armour (damage taken ×): Bone Bulwark 0.35 shielded / 1.3 open, Mire Crab 0.7, Void Colossus 0.8.
- **Contact damage**: 3 at 0:00 rising to 12 at 15:00, × stage damage (1 / 1 / 1). Foe shots and blasts: base (shots 4–5, blasts 10–12 at 0:00) × (1 + 1.2 × min(1, t / 15:00)) × stage damage.
- **Foe kinds**: chaser (straight line), swarmer (fast, weak; packs of 3–4 at 0:00, 8–10 at 5:00, 12–16 from 10:00), brute (slow, 8× HP, knockback-immune, telegraphed slam), ranged (stops at 160 px, shoots a telegraphed bolt, fan or ring; only from inside the target's screen), exploder (telegraphed 0.7 s burst on contact), splitter (splits in 2–3 on death), charger (telegraphed dash; packs of 2–4), diver (telegraphed dive; packs of 3–5). Tier kinds: **guard** (Bone Bulwark: shield up, a 0.8 s-warned shield bash, then 1.6 s open), **summoner** (Bone Caller: holds 210 px, a 1 s summon ring raises 3 skeletons, every 8 s, below the alive cap), **double splitter** (Bog Bloater → 2 Bloatlings → 2–3 Glowlets each), **wall** (Mire Crab: packs of 3–4 spawn as a line 26 px apart and close in as a line; knockback-immune), **blinker** (Rift Stalker: packs of 2–3; marks a spot 36 px beside the target for 0.7 s, appears there, then a 0.6 s-warned 34 px slash), **pull brute** (Void Colossus: a 1.2 s slam wind-up drags heroes within 150 px toward it at 45 px/s; dash breaks free). Every attack telegraph is ≥ 0.6 s and aimed where the target stood when the wind-up began; killing, stunning or freezing the foe cancels it.
- **Events**: a swarm wave every 120 s from 2:00 (a ring of 24–50 swarmers closing in, or a stampede line crossing the screen; stampedes mix in the stage's walkers present in the current roster).
- **Elites**: one every 60 s from 2:30, every 30 s from 12:00 (a non-exploder roster foe at 2× size, 15× HP, glowing outline); drops a chest and, at 50%, food. Elite attacks change shape: ranged fire 2 more shots (ring casters 1.5×), charges and dives last 1.35× longer, brute slams get 1.5× radius plus a shot ring, splitters split into 3 extra children.
- **Off-screen culling**: foes farther than 900 px (elites 1300 px) from every hero teleport to a fresh spawn point ahead of a hero; bosses never.
- **Separation**: foes push apart on the spatial grid; they flow around obstacles.
- **XP income** (first-pass estimates, scaled from the earlier spawn rates; to be re-measured): a player who keeps up with the spawn rate collects about 2,000 / 8,100 / 20,800 XP by 5:00 / 10:00 / 15:00 (near level 11 / 19 / 26); one who kills faster draws more through the density floor (a max-level signature alone: about 2,600 / 13,000 / 34,000, near level 12 / 22 / 31). Level curve: `xpFor(L) = 3.75 + 15 × (L − 1) + 2.025 × (L − 1)²` (cumulative 987 to level 10, 6,907 to 20, 21,820 to 30): cheap early levels, so the opening offers come fast.

## 8. Bosses

Each boss: 2–3 telegraphed patterns, a health bar at the top, HP `= 1500 × (minute / 5)^2.5 × players factor × stage HP` (1500 / 8485 / 23383 at 5:00 / 10:00 / 15:00). Bosses drop a chest that opens a Form offer (one extra level-up offer when no Form is ready; §9). While a boss lives, normal spawns run at 50% rate.

- **Roster** (5:00 · 10:00 · final 15:00): Ossuary — Bone Warden · The Twins · Hollow King. Glowmire — Sporemother · Demon Cyclops · Drowned King. Abyss — Blue Samurai · Rift Weaver · The Wick-Eater.
- **Pace**: bosses walk 24–46 px/s; dashes 256–496 px/s; leaps fly 1.19–1.38 s; shots 81–340 px/s.
- **Rift Weaver**: rift gates around the target open into portals that shoot; warned threads cross the target (strands stay from phase 2); blink with a bolt ring; adds.
- **The Wick-Eater**: devour (warned cone inhales heroes toward a warned bite); closing dark (a ring shrinks onto it, pass through a gap or dash); lash fans; spiralling orb bloom; adds; swells at phase 3.

## 9. Pickups

- **XP gems**: small (1), medium (5, from elites and brutes), large (25). When more than 350 gems lie on the ground, new ones merge into the nearest gem.
- **Gold coins**: 1–5 from braziers (73%); 1–5 × stage gold from elites; a 150 × stage gold coin from each mid-boss; worth value × (1 + greed + luck / 2) to the collector. The final boss kill (300), the victory (300) and the run-end kill bounty (1 per 25 kills) pay × stage gold × the party's mean gold multiplier straight to the run's gold. Stage gold: ×1 / ×1.5 / ×2.
- **Food**: heals 30 HP; braziers (20%) and elites (50%, on top of the chest). No passive regen by default.
- **Magnet** (braziers, 5%): pulls every gem on the map.
- **Holy Bomb** (braziers, 2%): kills every non-elite foe on screen.
- **Chest**: boss chest (5:00, 10:00): a Form offer when any slot has a ready Form (pick one; one per chest), else one extra level-up offer. Elite chest: from the benchmark (12:00) a Form offer when a Form is ready; otherwise one roll levelling a random owned passive or the skill (never paths: those are choices), or gold when nothing can level. Co-op: whoever opens a chest, every hero that is not dead gets its own reward (downed heroes too; a downed hero picks its chest offers after revival).

## 10. Co-op

- 1–4 players, PeerJS; the host runs the sim.
- **Downed** at 0 HP: 20 s bleed-out; a teammate standing within 40 px for 2.5 s revives at 40% HP. All heroes down → defeat. Solo death ends the run unless a Revival charge is left (meta).
- Each client follows its own hero; foes and gems are snapshot only within the client's view plus a margin (interest culling).
- Each hero's damage lands only inside its own view (§3): a hero far from the fight cannot clear it for the party.

## 11. Meta progression

- **Gold** carries over, including a lost run's collected gold. Every run ends with a kill bounty: 1 gold per 25 kills × the stage gold multiplier × gold bonus (a 6-minute loss ≈ 150). A winning run pays about 1,400 / 2,100 / 2,800 gold on stages 1 / 2 / 3 at Greed 0, bounty included (shop total ≈ 27,600: full meta in about 15 wins plus the losses on the way). The Camp shop sells permanent ranks: Might (5), Vigor (5), Plating (3), Mending (5), Swiftness (3), Magnet (3), Growth (+5% XP, 5), Greed (+10% gold, 5), Fortune (5), Revival (2), Reroll (5), Skip (3), Banish (3). Cost: `base × (rank + 1)`, base 200; a refund button resets all.
- **Unlocks**: start with Knight, Ranger and Pyro. Necro: survive 10 minutes. Cleric: beat stage 1 (also opens stage 2; beating stage 2 opens stage 3). Shade: kill 3000 foes in one run. Bell: reach level 25 in one run.
- Profile autosaves in localStorage, plus a portable save code.
- **Encyclopedia** reveals only what the player met: heroes and stages a run started with, weapons (Forms included) and passives the own hero owned, foes in the own view, bosses fought. Recorded on every client from its own view, merged at run end (win, defeat or quit); bot runs never save. Unmet entries list as a "???" silhouette (detail: "Not discovered yet"; locked heroes and stages keep their unlock rule and progress).

## 12. Feel (juice)

- Pixel-only world: every world visual (sprites, zones, telegraphs, rings, cones, lines) is pixel art at 1 art px = 1 world px with hard edges (no anti-aliasing), integer-upscaled; only post effects (bloom, grade, vignette) are smooth.
- Hit flash on every hit (white 60 ms); knockback on non-brute foes.
- Death burst particles (pooled), capped per frame.
- Damage numbers: on by default, merged per foe per 150 ms, capped at 60 alive (oldest dropped); crits bigger and yellow.
- Hit-stop 40–80 ms and screen shake only on skills, elite deaths and boss hits; shake scales down with crowd size.
- Gem vacuum: gems fly to the hero with an accelerating curve and a rising pitch "tink" (pitch climbs within a 0.4 s combo window).
- Audio: per-sound voice budget so 900 deaths never clip; music intensity follows the alive count and boss state.

## 13. Performance budget

- 900 foes + 600 projectiles + 400 gems: sim ≤ 2.5 ms per 60 Hz tick on the host; render ≤ 4 ms per frame on WebGL batched sprites, ≤ 8 ms on the Canvas2D fallback (crowd LOD).
- Snapshots: binary, quantized, interest-culled, ≤ 12 KB per snapshot per client at 20 Hz.
