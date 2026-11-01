# Necro — Summoner

**Role**: the army does the work. The hero hangs back, throws a few bone shards and keeps a horde of minions standing; corpses are fuel (raising, pools, Corpse Blast all consume fresh corpses ≤ 5 s old, in view). All damage, targeting and corpses stay inside the hero's view.

## Weapon: Bone Shard (auto, cursor)

Every 1.0 s: 1 piercing shard (15 dmg, pierce 3, 280 px/s, range 220) exactly along the cursor. Then the **army** step: raises 1 minion while fewer than **3** live (at the freshest corpse within 200 px, else beside the hero), so the army stands from the first seconds. Skeletons: 10 s life, swing every 0.6 s for 0.65 × weapon damage in a 2.8 rad arc, leash 200 px, target foes within 150 px. Hard cap 24 minions per hero.

| Path | Rank 1 | Rank 3 | Rank 5 | Forms |
|---|---|---|---|---|
| **Legion** (bigger army) | +2 skeletons, raised two at a time (cap +2, raise +1) | The slain rise as extra skeletons (15% per kill, up to cap + 4, 6 s life) | Skeletons cleave wider, +25% damage (arc +1.2 rad) | Bone Lord, Ossuary |
| **Shards** (hero projectiles) | +2 bone shards | Shards burst into 3 splinters (½ damage, pierce 1, where a shard stops) | +1 shard, shards seek foes, +25% damage (homing 3 rad/s) | Bone Storm |
| **Plague** (corpses → ground) | The dead rot into blight pools (1 pool per volley on the freshest corpse, else under the nearest foe not already in a pool) | +1 pool, pools spread wider (area +25%) | Pools burst as they dry, +25% damage (0.8 × damage blast, 1.15 × pool radius) | Plague Field, Lich |

Tables give the 3 shape ranks at path ranks 1 / 3 / 5; path ranks 2 and 4 are generic steps (+10% damage, cooldown x0.95). Before the path: 5 tune steps; the path is picked from a chest (one per slot, permanent); a path at rank 5 readies its Forms (GAME-DESIGN §4). A Form keeps only its own path's ranks.

Blight pool: radius 22 × area, 3 s, 0.3 × weapon damage per second to every foe inside (0.5 s ticks), slow 30%. At most 14 live pools per hero.

## Forms (one per run, path ranks keep applying, 2 refines each)

| Form | Needs | Pattern | Refine 1 | Refine 2 |
|---|---|---|---|---|
| **Bone Lord** | Legion 5 | The army rises as Bone Knights: 11.2 dmg base, cap 4, 12 s life, 3.0 rad stunning cleave (0.6 × dmg), every 3rd swing a ground slam (radius 50, 2.8 × dmg, stun 0.4) | +2 Bone Knights | Knights slam more often (every 2nd), +25% damage |
| **Bone Storm** | Shards 5 | 6 shards (4.9 dmg, knock 80) orbit the hero (radius 30, 1 s, re-hitting every 0.25 s at 0.3×), then launch along the cursor direction at full damage and home; splinters as Shards 2 | +2 orbiting shards | +25% damage, pierce 2 more |
| **Plague Field** | Plague 5 | Lobs 2 blight globs at the densest cluster (the rest around it; no foe: 90 px out along the cursor direction); plague pools 1.35 × dmg per second, 3.5 s, area +20%; a foe dying in a pool seeds a new pool where it fell | +1 glob, pools grow larger | +25% damage, pools last longer (+1.5 s) |
| **Lich** | Plague 5 | The army rises as ghouls: 14 dmg base, cap 5, raise 2 per volley, 5 s life, 140 px/s) that rush a foe and burst on contact (radius 34, 1.15 × dmg), leaving a blight pool | +2 ghouls, raised faster | +25% damage, bigger bursts (+10 px) |
| **Ossuary** | Legion 5 | The army rises as skeleton archers (cap 4, raise 2): target the nearest elite or boss within 170 px first, hold 60–110 px off, loose a homing shard every 0.6 s (0.65 × dmg, pierce 9; homes on elites and bosses first) | +2 skeleton archers | Archers loose 2 shards, +25% damage |

All Forms keep the hero's own shards except Plague Field (globs) and Bone Storm (orbit).

## Skill (Q): Bone Wall (`bonewall`) — cooldown 12 s

Zero damage. A curved bone wall at the cursor for 5 s (scales with duration): a 140 px arc square to the hero→cursor line, its ends curving toward the necro. Non-boss foes cannot cross it (they walk around its ends); bosses pass.

| Level | Card | Change |
|---|---|---|
| 2 | A longer wall | 200 px arc |
| 3 | The wall closes into a ring | a full ring of radius 80 around the cursor: foes inside stay in, foes outside stay out |
| 4 | Nearby foes target the wall | non-boss foes within 160 px of the wall walk to it and hold there instead of chasing the hero |
| 5 | Walls last 2x as long, slow 50% | 10 s; foes touching the wall (or held at it) slowed 50% |

## dps.js (`node tools/dps.js necro`: weapon only, no Q casts, build fixed, no level-ups; builds: GAME-DESIGN §4 Power yardstick)

| build | form | kind | crowd wpn | kills/s | single wpn | boss wpn |
|---|---|---|---|---|---|---|
| base | - |  | 591 | 4.7 | 61 | 61 |
| t5 | - |  | 746 | 6.5 | 85 | 85 |
| p0 | - |  | 2,045 | 17.6 | 187 | 187 |
| p1 | - |  | 1,677 | 14.8 | 246 | 247 |
| p2 | - |  | 2,087 | 17.9 | 140 | 140 |
| f00 | bonelord | dir | 2,656 | 21.7 | 380 | 380 |
| f01 | ossuary | dir | 3,373 | 27.9 | 428 | 428 |
| f10 | bonestorm | 360° | 1,658 | 13.7 | 166 | 207 |
| f20 | plaguefield | dir | 3,921 | 34.0 | 595 | 632 |
| f21 | lich | dir | 3,252 | 27.6 | 451 | 452 |

Role rule (f rows): Bone Storm (360° orbit) crowd ≤ 0.6 × directional mean (3,301 → ≤ 1,980): met; directional single ≥ 2 × Bone Storm (166 → ≥ 332): met; each kind within ±25% of its mean.
