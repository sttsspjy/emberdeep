# Ranger — Marksman

**Role**: long straight piercing lines in one direction; the best single-target and elite killer at range; weak against a surrounding crowd (Volley is the crowd answer). Unlike the Shade (short stabs up close), every Ranger hit comes from a distance along a line.

HP 90, speed 80, crit 8%.

## Weapon: Longbow (`longbow`)

- **Aim**: the nearest elite or boss within range in view, else the nearest foe, else straight along the facing.
- **Arrow**: pierces 8 foes, 300 px range (420 px/s); its first hit deals ×1.5.
- **Fan**: n arrows 0.18 rad apart; a fan of n deals (1 + 0.25 (n − 1)) × one arrow in total.
- Base: 20 damage, cooldown 0.55 s, knockback 25. Multishot adds fan arrows.

## Paths

| Path | Rank 1 | Rank 2 | Rank 3 | Form |
|---|---|---|---|---|
| **Spread** (wider) | +2 arrows in a fan (n +2) | The fan splits over two targets (half the arrows at the next nearest foe) | +25% damage, +2 arrows | Hail of Arrows |
| **Piercer** (deeper, heavier) | Arrows pierce 4 more, fly farther (pierce +4, range +20%) | Every 3rd shot: a heavy bolt (first arrow ×2 size, ×1.25 damage, always crits, pierce +4) | +25% damage, every 2nd shot heavy | Ballista |
| **Ricochet** (chains) | Arrows bounce to 2 more foes (after the last pierce, to the nearest unhit foe within 170 px) | Kills loose an arrow at the next foe (from the body, 60% damage, 1 pierce; 2 per volley) | +25% damage, +2 bounces | Seeker |

Path ranks keep applying after a Form; each Form reads the foreign path keys in its own way (below).

## Forms (one per run, 2 refines each)

| Form | Need | Pattern | Base | Refine 1 | Refine 2 |
|---|---|---|---|---|---|
| **Hail of Arrows** (`hail`) | Spread 3 | Full-damage fan (0.14 rad apart); an arrow's first hit splits off 3 arrows fanning forward (0.8× damage, 2 pierce, no further split). Pierce capped at 3, half the bounces | 22 dmg, 3 arrows / 0.7 s, pierce 1 | +2 arrows | +25% damage, pierce 2 more |
| **Ballista** (`ballista`) | Piercer 3 | 1 + (n − 1) / 2 giant bolts (12 px radius, 240 px/s) that pierce every foe until they leave the view and always crit; heavy volleys ×1.5 size, ×1.25 damage; bounces become arrows (⅓ damage) loosed from the first foe hit | 44 dmg, 1 bolt / 1.2 s, knockback 70 | +1 bolt | +25% damage, bolts 50% bigger |
| **Seeker** (`seeker`) | Ricochet 3 | Homing arrows (10 rad/s) launched in a wide fan; a kill does not spend pierce and keeps the arrow hunting (up to 2 kills, life ≥ 0.9 s). Fan factor 0.35, a quarter of the pierce | 38 dmg, 5 arrows / 0.68 s | +2 arrows | +25% damage, +2 bounces |
| **Gale Barrage** (`galeshot`) | Spread 3 + Piercer 3 (hybrid) | A stream of 1 + n full-damage arrows, one every 0.05 s, each re-aimed (±0.04 rad jitter); two targets: every 2nd arrow goes to the next foe; every (2 × heavy)-th arrow heavy | 26 dmg, 1.2 s cycle, pierce 16, 520 px/s | +2 arrows per stream | +25% damage, pierce 2 more |
| **Rebound** (`rebound`) | Piercer 3 + Ricochet 3 (hybrid) | Arrows reaching the view edge turn toward the foe nearest the Ranger (else mirror), forget their hits and regain their pierce, 2 + bounces times (life 3 s); no first-hit bonus | 42 dmg, 1 arrow / 0.9 s, pierce 8 | +2 arrows | +25% damage, 1 more rebound |

Forms show as `???` until discovered; no card line names a Form.

## Skill (Q): Volley (`volley`)

Arrow rain on the cursor area for 2 s: 36 arrows (scaled by area) fall at random spots inside a 90 px circle, each a 22 px hit. Base 3 damage per arrow (scales with the weapon and party level), cooldown 10 s.

| Level | Card | Change |
|---|---|---|
| 2 | Wider, harder rain that pins foes | radius +35%, damage +50%, hit foes slowed 60% for 0.8 s |
| 3 | Harder rain follows your cursor | the rain drifts to the cursor at 150 px/s, damage +50% |
| 4 | Two more rains flank it | two 0.8× rains beside it, across the aim |

## Balance (`node tools/dps.js ranger`, weapon dps; build fixed during the run, no XP)

| build | form | crowd wpn | crowd q | kills/s | single wpn | single q |
|---|---|---|---|---|---|---|
| base | – | 334 | 103 | 1.6 | 59 | 2 |
| p0 | – | 829 | 159 | 6.3 | 84 | 4 |
| p1 | – | 1,012 | 162 | 7.5 | 118 | 3 |
| p2 | – | 776 | 185 | 6.3 | 74 | 3 |
| all | – | 2,260 | 239 | 17.6 | 164 | 6 |
| f0 | hail | 4,296 | 166 | 34.5 | 394 | 6 |
| f1 | ballista | 4,484 | 288 | 38.0 | 251 | 11 |
| f2 | seeker | 2,945 | 341 | 25.7 | 428 | 5 |
| h0 | galeshot | 4,036 | 234 | 32.0 | 665 | 7 |
| h1 | rebound | 3,646 | 393 | 30.6 | 453 | 10 |
| F0 | hail | 5,669 | 256 | 46.2 | 521 | 11 |
| F1 | ballista | 5,259 | 436 | 45.0 | 669 | 21 |
| F2 | seeker | 5,962 | 259 | 47.8 | 648 | 13 |
| H0 | galeshot | 4,640 | 341 | 38.1 | 761 | 10 |
| H1 | rebound | 5,785 | 256 | 46.0 | 572 | 14 |
