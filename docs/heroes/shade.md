# Shade — Assassin

**Role**: rapid, narrow, short-range stabs toward the facing foe; crits rolled per stab; executes; the elite / boss killer up close; survives through Shadow Step. Unlike the Knight (wide, slow arcs into a crowd), every Shade hit is a thin line.

HP 80, speed 80, crit 15%.

## Weapon: Twin Daggers (`daggers`)

- **Stab**: a line from the hero's hand toward the aim, 52 px long, 10 px wide (area scales both); every foe on the line is hit.
- **Strike**: 2 stabs per 0.5 s, spread evenly over the cooldown (one stab every 0.25 s), each re-aimed: nearest foe within ±52° of the facing (0.9 rad), else the nearest foe in reach, else straight along the facing.
- **Crit per stab**: one roll per stab; a crit stab crits every foe it touches, others never crit. Weapon crit +10%.
- Base: 13 damage, knockback 14. Multishot adds stabs per strike.

## Paths

| Path | Rank 1 | Rank 2 | Rank 3 | Form |
|---|---|---|---|---|
| **Flurry** (more, longer stabs) | +1 stab per flurry (n +1) | Stabs lunge much farther (length +26 px) | +1 stab, flurries come faster (n +1, cooldown −15%) | Thousand Cuts |
| **Lethality** (crit, execute) | Stabs execute foes under 10% HP (non-boss foes left at or under the line die) | +10% crit, crits stab much farther (crit stab length ×1.8, width ×1.4) | Executes burst, cutting foes nearby (execute line +5% → 15%; a 26 px cut, 0.6× damage) | Assassinate |
| **Return** (thrown daggers) | Throw a dagger that flies back (every 1.2 s, out 100 px and back, pierces all, 0.6× damage) | +1 returning dagger (fanned 0.35 rad) | +1 dagger, they spin at the far end (0.4 s hover, re-hit every 0.15 s) | Shadow Fan |

Path ranks keep applying after a Form (extra stabs, length, crit, execute, thrown daggers).

## Forms (one per run, 2 refines each)

| Form | Need | Pattern | Base | Refine 1 | Refine 2 |
|---|---|---|---|---|---|
| **Thousand Cuts** (`thousand`) | Flurry 3 | Stab storm: every stab jittered within ±0.36 rad of the aim, length ×0.8–1.15 | 20 dmg, 6 stabs / 0.4 s, 68 × 12 px, knockback 2 | +2 stabs per storm | Storm widens, stabs reach farther (cone +0.12 rad, length +14) |
| **Assassinate** (`assassinate`) | Lethality 3 | Marks the toughest foe within 220 px in view (boss ×4, elite ×2 weight; rechecked every 0.5 s). Stabs aim at the mark; hits on it always crit, ×1.1. A shadow cuts an X through the mark every 0.45 s (two 64 px lines, forced crits). A dying mark bursts (52 px, 2× damage, crits). | 17 dmg, 2 stabs / 0.45 s, crit +15% | The shadow strikes far more often (−0.2 s) | Shadow cuts reach twice as far (+40 px) |
| **Shadow Fan** (`shadowfan`) | Return 3 | Stabs + every 1 s a fan of 3 + thrown daggers forward and as many behind (out 120 px and back, 0.42× damage); the return leg always crits | 21 dmg, 2 stabs / 0.45 s | +2 daggers each way | Daggers fly farther, +15% damage (+48 px) |
| **Death Lotus** (`lotus`) | Flurry 3 + Lethality 3 (hybrid) | Crit stabs bloom: 6 blades radiate from the first foe struck (0.6 × reach long, 0.32× damage) | 20 dmg, 4 stabs / 0.45 s, crit +15% | +2 blades per bloom | +10% crit, blades reach farther (+0.4 × reach) |
| **Reaper's Return** (`reaper`) | Lethality 3 + Return 3 (hybrid) | Stabs + every 1 s, 3 + thrown daggers that pin the first foe hit for 1.2 s (stabs on a pinned foe always crit), then tear out (24 px cut, crits) and fly back as crits | 18 dmg, 2 stabs / 0.45 s, thrown daggers full damage | +1 pinning dagger | +1 pinning dagger, thrown more often (−0.3 s) |

Forms show as `???` until discovered; no card line names a Form.

## Skill (Q): Shadow Step (`step`)

Blink toward the cursor (40–130 px, through foes and over obstacles), 0.35 s invulnerable; every foe on the path takes a forced crit, is shoved aside and stunned 0.4 s. The afterimage left behind detonates after 0.8 s (44 px, 1.5× damage). Base 11 damage (scales with the weapon and party level), cooldown 8 s.

| Level | Card | Change |
|---|---|---|
| 2 | Afterimage throws knives | 3 knives at random foes in view every 0.2 s until it detonates |
| 3 | Blink farther, cut a wider path | range +50 px, path width +18 px, afterimage +30% radius |
| 4 | Recast once within 2.5 s | a second free blink; the cooldown resumes if unused |

## Balance (`node tools/dps.js shade`, weapon dps; build fixed during the run, no XP)

| build | form | crowd wpn | crowd q | kills/s | single wpn | single q |
|---|---|---|---|---|---|---|
| base | – | 630 | 186 | 4.6 | 62 | 3 |
| p0 | – | 1,275 | 230 | 10.9 | 150 | 5 |
| p1 | – | 1,531 | 219 | 12.9 | 70 | 5 |
| p2 | – | 1,101 | 236 | 8.7 | 98 | 5 |
| all | – | 2,636 | 198 | 21.6 | 204 | 6 |
| f0 | thousand | 3,060 | 337 | 26.1 | 522 | 9 |
| f1 | assassinate | 3,009 | 323 | 25.4 | 435 | 7 |
| f2 | shadowfan | 4,221 | 205 | 33.3 | 238 | 10 |
| h0 | lotus | 4,900 | 92 | 38.3 | 475 | 9 |
| h1 | reaper | 3,778 | 203 | 31.0 | 413 | 8 |
| F0 | thousand | 4,042 | 309 | 33.6 | 672 | 12 |
| F1 | assassinate | 4,268 | 305 | 35.1 | 710 | 11 |
| F2 | shadowfan | 5,790 | 105 | 44.9 | 461 | 15 |
| H0 | lotus | 4,787 | 149 | 37.9 | 540 | 12 |
| H1 | reaper | 4,107 | 179 | 33.3 | 631 | 11 |
