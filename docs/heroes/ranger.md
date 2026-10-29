# Ranger — Marksman

**Role**: long straight piercing lines in one direction; the best single-target and elite killer at range; weak against a surrounding crowd (Volley is the crowd answer). Unlike the Shade (short stabs up close), every Ranger hit comes from a distance along a line.

HP 90, speed 80, crit 8%.

## Weapon: Longbow (`longbow`)

- **Aim**: exactly along the cursor, foe or no foe (no aim assist).
- **Arrow**: pierces 8 foes, 300 px range (420 px/s); its first hit deals ×1.5.
- **Fan**: n arrows 0.18 rad apart; a fan of n deals (1 + 0.25 (n − 1)) × one arrow in total.
- Base: 20 damage, cooldown 0.55 s, knockback 25. Multishot adds fan arrows.

## Paths

| Path | Rank 1 | Rank 2 | Rank 3 | Form |
|---|---|---|---|---|
| **Spread** (wider) | +2 arrows in a fan (n +2) | The fan splits over two targets (half the arrows at the nearest foe ≥ 0.35 rad off the cursor line, else 0.35 rad off it) | +25% damage, +2 arrows | Hail of Arrows |
| **Piercer** (deeper, heavier) | Arrows pierce 4 more, fly farther (pierce +4, range +20%) | Every 3rd shot: a heavy bolt (first arrow ×2 size, ×1.25 damage, always crits, pierce +4) | +25% damage, every 2nd shot heavy | Ballista |
| **Ricochet** (chains) | Arrows bounce to 2 more foes (after the last pierce, to the nearest unhit foe within 170 px) | Kills loose an arrow at the next foe (from the body, 60% damage, 1 pierce; 2 per volley) | +25% damage, +2 bounces | Seeker |

Path ranks keep applying after a Form; each Form reads the foreign path keys in its own way (below).

## Forms (one per run, 2 refines each)

| Form | Need | Pattern | Base | Refine 1 | Refine 2 |
|---|---|---|---|---|---|
| **Hail of Arrows** (`hail`) | Spread 3 | Full-damage fan (0.14 rad apart); an arrow's first hit splits off 3 arrows fanning forward (0.8× damage, 2 pierce, no further split). Pierce capped at 3, half the bounces | 22 dmg, 3 arrows / 0.7 s, pierce 1 | +2 arrows | +25% damage, pierce 2 more |
| **Ballista** (`ballista`) | Piercer 3 | 1 + (n − 1) / 2 giant bolts (12 px radius, 240 px/s) that pierce every foe until they leave the view and always crit; heavy volleys ×1.5 size, ×1.25 damage; bounces become arrows (⅓ damage) loosed from the first foe hit | 44 dmg, 1 bolt / 1.2 s, knockback 70 | +1 bolt | +25% damage, bolts 50% bigger |
| **Seeker** (`seeker`) | Ricochet 3 | Homing arrows (10 rad/s) launched in a wide fan along the cursor; a kill does not spend pierce and keeps the arrow hunting (up to 2 kills, life ≥ 0.9 s). Fan factor 0.35, a quarter of the pierce | 44 dmg, 5 arrows / 0.68 s | +2 arrows | +25% damage, +2 bounces |
| **Gale Barrage** (`galeshot`) | Spread 3 + Piercer 3 (hybrid) | A stream of 1 + n full-damage arrows, one every 0.05 s, each re-aimed along the cursor (±0.04 rad jitter); two targets: every 2nd arrow takes the split fan's second aim; every (2 × heavy)-th arrow heavy | 26 dmg, 1.2 s cycle, pierce 16, 520 px/s | +2 arrows per stream | +25% damage, pierce 2 more |
| **Rebound** (`rebound`) | Piercer 3 + Ricochet 3 (hybrid) | Arrows reaching the view edge turn toward the foe nearest the Ranger (else mirror), forget their hits and regain their pierce, 2 + bounces times (life 3 s); no first-hit bonus | 42 dmg, 1 arrow / 0.9 s, pierce 8 | +2 arrows | +25% damage, 1 more rebound |

Forms show as `???` until discovered; no card line names a Form.

## Skill (Q): Vault (`vault`)

Zero damage. Leap 160 px toward the cursor over 0.34 s, over foes and obstacles, untouchable (the landing steps back along the line to the first free spot). On landing every xp gem within 200 px flies to the ranger. Cooldown 9 s.

| Level | Card | Change |
|---|---|---|
| 2 | Leap 60 px farther | 220 px |
| 3 | 2 charges | two leaps stored, one recharge per 9 s |
| 4 | Caltrops at takeoff slow pursuers | a 56 px caltrop field at the takeoff for 3 s: foes inside slowed 50% for 2 s |

## dps.js (`node tools/dps.js ranger`: weapon only, no Q casts, build fixed, no level-ups)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 338 | 0.4 | 54 |
| p0 | - |  | 846 | 2.7 | 143 |
| p1 | - |  | 1,087 | 3.3 | 116 |
| p2 | - |  | 698 | 1.9 | 68 |
| all | - |  | 2,288 | 9.8 | 226 |
| f0 | hail | dir | 4,419 | 22.6 | 557 |
| f1 | ballista | dir | 5,287 | 27.6 | 251 |
| f2 | seeker | dir | 3,470 | 17.9 | 491 |
| h0 | galeshot | dir | 4,245 | 20.4 | 675 |
| h1 | rebound | dir | 3,802 | 18.9 | 454 |
| F0 | hail | dir | 6,660 | 33.6 | 848 |
| F1 | ballista | dir | 6,771 | 35.3 | 669 |
| F2 | seeker | dir | 6,914 | 35.0 | 914 |
| H0 | galeshot | dir | 4,575 | 22.0 | 772 |
| H1 | rebound | dir | 6,039 | 29.6 | 582 |

All Forms directional; f / h rows within ±25% of their mean.
