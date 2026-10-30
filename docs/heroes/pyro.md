# Pyro — area denial

Paints the ground with fire. Instant hits are weak; pools, burns and death blasts carry the damage. Kites the horde through its own fire. HP 85, speed 74.

Shared rules: every damage source credits the slot's current weapon id. Ground fire (pools, pyres, fire lines) is capped at 12 + `pools` per hero; a new one past the cap ends the oldest. Pools set a short burn (0.15 × dmg/s, 1 s) on foes inside. Shell range 220 px, bolt range 210 px.

## Weapon: Fire Bolt (root)

dmg 12, cd 1.2 s, 1 bolt, speed 230, fired along the cursor (bolts and Wildfire seeds; seeds home after launch). A bolt bursts at the first foe hit, or where it lands with no foe: blast 20 px × area (0.5 × dmg, burn 0.3 × dmg/s for 2 s) + fire pool 22 px × area (0.45 × dmg/s, 2.5 s).

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

Mortar shells, Firestorm and Napalm stay targeted (densest cluster, then random foes). No foe in range: bolts / seeds burst where they land; Firestorm and Napalm land 120 px out along the cursor direction; Mortar shells wait for a foe.

## Skill (Q): Flashpoint (`flashpoint`)

Zero damage. cd 10 s. A flash at the pyro: every foe within 140 px (r, scales with reach) is knocked 120 px back (elites 60; bosses and knockback-immune foes stay) and flees from the pyro for 2 s (bosses never flee). Role: a breathing gap when the horde closes in.

| Level | Card | Effect |
|---|---|---|
| 2 | +30% flash radius | r 182 |
| 3 | Foes flee 1.5 s longer | flee 3.5 s |
| 4 | The flash pulls in gems | xp gems within 200 px fly to the pyro |

## dps.js (`node tools/dps.js pyro`: weapon only, no Q casts, build fixed, no level-ups)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 481 | 1.9 | 34 |
| p0 | - |  | 1,246 | 5.8 | 51 |
| p1 | - |  | 1,393 | 5.1 | 62 |
| p2 | - |  | 1,224 | 5.5 | 35 |
| all | - |  | 3,483 | 17.3 | 112 |
| f0 | inferno | dir | 4,296 | 20.8 | 141 |
| f1 | firestorm | dir | 5,066 | 24.9 | 139 |
| f2 | wildfire | dir | 4,930 | 25.0 | 136 |
| h0 | pyre | dir | 5,025 | 24.9 | 174 |
| h1 | napalm | dir | 4,976 | 22.7 | 248 |
| F0 | inferno | dir | 6,909 | 34.1 | 245 |
| F1 | firestorm | dir | 8,279 | 41.0 | 229 |
| F2 | wildfire | dir | 6,995 | 35.0 | 248 |
| H0 | pyre | dir | 6,044 | 29.6 | 234 |
| H1 | napalm | dir | 5,916 | 28.1 | 290 |

All Forms directional; f / h rows within ±25% of their mean.
