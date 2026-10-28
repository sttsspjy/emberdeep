# Pyro — area denial

Paints the ground with fire. Instant hits are weak; pools, burns and death blasts carry the damage. Kites the horde through its own fire. HP 85, speed 74.

Shared rules: every damage source credits the slot's current weapon id. Ground fire (pools, pyres, fire lines) is capped at 12 + `pools` per hero; a new one past the cap ends the oldest. Pools set a short burn (0.15 × dmg/s, 1 s) on foes inside. Shell range 220 px, bolt range 210 px.

## Weapon: Fire Bolt (root)

dmg 12, cd 1.2 s, 1 bolt, speed 230. A bolt bursts at the first foe hit, or where it lands with no foe: blast 20 px × area (0.5 × dmg, burn 0.3 × dmg/s for 2 s) + fire pool 22 px × area (0.45 × dmg/s, 2.5 s).

| Path | Rank 1 | Rank 2 | Rank 3 | Form |
|---|---|---|---|---|
| **Blaze** (bigger, longer ground fire) | Fire bursts and pools 30% wider (area +0.3) | Fire pools last 60% longer (dur +0.6, cap +4) | Pools flare as they die, +20% damage (flare 0.8: end blast 1.2 r, 0.8 × dmg) | Inferno |
| **Mortar** (second emitter, lobbed) | Lobs a shell at the thickest crowd (every 2 × cd; 0.7 s flight; blast 34 px × area, 1.25 × dmg, knockback; leaves a pool) | +1 shell (second on a random foe in view) | Shells scatter 4 burning bomblets (0.45 r, 0.5 × shell dmg) | Firestorm |
| **Combustion** (chain reaction) | Burning foes explode when they die (3 blasts/s budget; 26 px × area, 0.7 × dmg, burn; 2 generations) | Death blasts fling 3 burning embers | Fire leaps between foes, +10% damage (every 0.5 s, up to 8 burning foes throw an ember at an unburnt foe ≤ 48 px) | Wildfire |

Path effects keep working after any Form (shells only outside Firestorm / Napalm, which lob their own).

## Forms (one per run; shown as ??? until discovered)

| Form | Rule | Pattern | Base | Refine 1 | Refine 2 |
|---|---|---|---|---|---|
| **Inferno** | Blaze 3 | Bolts make pools that merge into one growing pool (to 95 px) and each spreads once toward foes outside it (2 generations) | dmg 16, cd 1.0, 3 bolts, pierce 1, area 1.5, dur 3.5 | +1 bolt | +25% pool size, last 30% longer |
| **Firestorm** | Mortar 3 | A walking salvo: 3 + shells land in a line across the densest cluster (26 px × area apart, 0.08 s apart), each blasts and leaves a pool | dmg 24, cd 1.6, 3 shells, area 1.2 | +2 shells per salvo | Blasts 25% wider, +2 bomblets |
| **Wildfire** | Combustion 3 | Homing seeds: hit = blast + heavy burn (0.6 × dmg/s, 3 s), split into 3 sparks; death blasts 1.4×, budget 5/s (+path), 4 generations, 2 embers | dmg 16, cd 1.0, 3 seeds, area 1.2 | +1 seed, +1 ember per blast | Blasts 30% wider, fire leaps more |
| **Pyre** (hybrid) | Blaze 3 + Combustion 3 | Bolts plant pyres that smoulder 1.2 s, then erupt (1.4 r, dmg × (1 + flare/2)) and leave a pool | dmg 14, cd 1.1, 2 bolts, area 1.3 | +1 bolt | Eruptions 30% wider, +2 embers |
| **Napalm** (hybrid) | Blaze 3 + Mortar 3 | Canisters (2 + shells) on the densest cluster and random foes; each splashes and leaves a fire wall across the throw (90 px × area, 0.45 × dmg/s, 1.3 × dur) | dmg 16, cd 1.4, 2 canisters, area 1.2, dur 3 | +1 canister | Fire walls 25% longer, last longer |

No foe in range: bolts / seeds fly along the facing and burst where they land; Firestorm and Napalm land 120 px ahead.

## Skill (Q): Meteor

cd 11 s. Falls 0.6 s onto the cursor. Impact radius 55: whole radius takes 0.12 × dmg, knockback 320, short burn; core (0.4 r) takes 0.88 × more; a burning crater stays on the core (0.15 × dmg/s, 3 s). Base dmg 75 (scales with weapon factor and party level). Role: boss burst + crowd shove.

| Level | Card | Effect |
|---|---|---|
| 2 | +40% impact size | r × 1.4 |
| 3 | The crater erupts again 1 s later | second impact, 0.5 × dmg, 1.2 r |
| 4 | +2 meteors land around it | two 0.6 × dmg, 0.7 r meteors |

## dps.js (pyro, XP off)

| build | form | crowd wpn | crowd q | kills/s | single wpn | single q |
|---|---|---|---|---|---|---|
| base | - | 525 | 160 | 4.7 | 34 | 12 |
| p0 | - | 1300 | 199 | 11.2 | 54 | 19 |
| p1 | - | 1432 | 185 | 11.2 | 63 | 16 |
| p2 | - | 1409 | 190 | 11.9 | 37 | 17 |
| all | - | 3437 | 136 | 27.1 | 116 | 26 |
| f0 | inferno | 4281 | 61 | 32.3 | 142 | 32 |
| f1 | firestorm | 4976 | 154 | 39.0 | 144 | 41 |
| f2 | wildfire | 4673 | 114 | 37.0 | 137 | 29 |
| h0 | pyre | 5174 | 37 | 40.0 | 174 | 30 |
| h1 | napalm | 4770 | 129 | 36.4 | 255 | 31 |
| F0 | inferno | 6641 | 66 | 50.5 | 252 | 49 |
| F1 | firestorm | 7653 | 153 | 59.3 | 246 | 94 |
| F2 | wildfire | 6607 | 55 | 51.1 | 251 | 50 |
| H0 | pyre | 5900 | 82 | 45.1 | 240 | 44 |
| H1 | napalm | 5815 | 131 | 43.5 | 302 | 49 |
