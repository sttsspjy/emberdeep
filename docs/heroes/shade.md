# Shade — Assassin

**Role**: rapid, narrow, short-range stabs toward the cursor; crits rolled per stab; executes; the elite / boss killer up close; survives through Shadow Step. Unlike the Knight (wide, slow arcs into a crowd), every Shade hit is a thin line.

HP 80, speed 84, crit 15%.

## Weapon: Twin Daggers (`daggers`)

- **Stab**: a line from the hero's hand toward the aim, 52 px long, 10 px wide (area scales both); every foe on the line is hit.
- **Strike**: 2 stabs per 0.5 s, spread evenly over the cooldown (one stab every 0.25 s), each re-aimed exactly along the cursor (no aim assist).
- **Crit per stab**: one roll per stab; a crit stab crits every foe it touches, others never crit. Weapon crit +10%.
- Base: 16 damage, knockback 14. Multishot adds stabs per strike.

## Paths

| Path | Rank 1 | Rank 3 | Rank 5 | Forms |
|---|---|---|---|---|
| **Flurry** (more, longer stabs) | +1 stab per flurry (n +1) | Stabs lunge much farther (length +26 px) | +1 stab, flurries come faster (n +1, cooldown −15%) | Thousand Cuts |
| **Lethality** (crit, execute) | Stabs execute foes under 10% HP (non-boss foes left at or under the line die) | +10% crit, crits stab much farther (crit stab length ×1.8, width ×1.4) | Executes burst, cutting foes nearby (execute line +5% → 15%; a 26 px cut, 0.6× damage) | Assassinate, Death Lotus |
| **Return** (thrown daggers) | Throw a dagger that flies back (every 1.2 s, along the cursor, out 100 px and back, pierces all, 0.6× damage) | +1 returning dagger (fanned 0.35 rad) | +1 dagger, they spin at the far end (0.4 s hover, re-hit every 0.15 s) | Shadow Fan, Reaper's Return |

Tables give the 3 shape ranks at path ranks 1 / 3 / 5; path ranks 2 and 4 are generic steps (+10% damage, cooldown x0.95). Before the path: 5 tune steps; the path is picked from a chest (one per slot, permanent); a path at rank 5 readies its Forms (GAME-DESIGN §4). A Form keeps only its own path's ranks.

The picked path's ranks keep applying after a Form (extra stabs, length, crit, execute, thrown daggers).

## Forms (one per run, 2 refines each)

| Form | Need | Pattern | Base | Refine 1 | Refine 2 |
|---|---|---|---|---|---|
| **Thousand Cuts** (`thousand`) | Flurry 5 | Stab storm: every stab jittered within ±0.36 rad of the aim, length ×0.8–1.15 | 14 dmg, 6 stabs / 0.4 s, 68 × 12 px, knockback 2 | +2 stabs per storm | Storm widens, stabs reach farther (cone +0.12 rad, length +14) |
| **Assassinate** (`assassinate`) | Lethality 5 | Marks the toughest foe within 220 px in view (boss ×4, elite ×2 weight; rechecked every 0.5 s). Stabs aim at the mark while it is in reach (+12 px) and within ±52° (0.9 rad) of the cursor, else along the cursor; hits on it always crit, ×1.1. A shadow cuts an X through the mark every 0.45 s (two 64 px lines, forced crits). A dying mark bursts (52 px, 2× damage, crits). | 12.6 dmg, 2 stabs / 0.45 s, crit +15% | The shadow strikes far more often (−0.2 s) | Shadow cuts reach twice as far (+40 px) |
| **Shadow Fan** (`shadowfan`) | Return 5 | Stabs + every 1 s a fan of 3 + thrown daggers along the cursor and as many behind (out 120 px and back, 0.42× damage); the return leg always crits | 14.7 dmg, 2 stabs / 0.45 s | +2 daggers each way | Daggers fly farther, +15% damage (+48 px) |
| **Death Lotus** (`lotus`) | Lethality 5 | Crit stabs bloom: 6 blades radiate from the first foe struck (0.6 × reach long, 0.32× damage) | 13.3 dmg, 4 stabs / 0.45 s, crit +15% | +2 blades per bloom | +10% crit, blades reach farther (+0.4 × reach) |
| **Reaper's Return** (`reaper`) | Return 5 | Stabs + every 1 s, 3 + thrown daggers that pin the first foe hit for 1.2 s (stabs on a pinned foe always crit), then tear out (24 px cut, crits) and fly back as crits | 12.6 dmg, 2 stabs / 0.45 s, thrown daggers full damage | +1 pinning dagger | +1 pinning dagger, thrown more often (−0.3 s) |

Forms show as `???` until discovered; no card line names a Form.

## Skill (Q): Shadow Step (`step`)

Zero damage. Blink toward the cursor (40–130 px, through foes and over obstacles), 0.35 s invulnerable. The afterimage left behind is a decoy for 2 s (scales with duration): every non-boss foe inside its view rect walks to it instead of the shade. Cooldown 8 s.

| Level | Card | Change |
|---|---|---|
| 2 | Blink 60 px farther | 190 px |
| 3 | The decoy lasts 3.5 s | decoy 3.5 s |
| 4 | 2 charges | two blinks stored, one recharge per 8 s |
| 5 | Foes lose you for 1.5 s after a step | for 1.5 s every non-boss foe chasing the shade walks to the decoy, wherever it is |

## dps.js (`node tools/dps.js shade`: weapon only, no Q casts, build fixed, no level-ups; builds: GAME-DESIGN §4 Power yardstick)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 680 | 8.7 | 77 |
| t5 | - |  | 1,018 | 13.4 | 125 |
| p0 | - |  | 1,792 | 25.4 | 371 |
| p1 | - |  | 1,486 | 20.3 | 186 |
| p2 | - |  | 1,518 | 21.0 | 227 |
| f00 | thousand | dir | 2,699 | 37.6 | 767 |
| f10 | assassinate | dir | 3,136 | 44.4 | 568 |
| f11 | lotus | dir | 2,514 | 35.4 | 360 |
| f20 | shadowfan | dir | 2,603 | 35.6 | 323 |
| f21 | reaper | dir | 2,162 | 30.7 | 504 |

All Forms directional; f rows within ±25% of their mean (2,623).
