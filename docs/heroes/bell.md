# Bell (Bellwarden) — controller / tank

Role: pushes, stuns, freezes and drags the horde; lowest raw damage, most control. Survives by never letting the horde touch it. Code: `src/heroes/bell.js`, visuals `src/client/hfx-bell.js`, check `tools/check-hero-bell.js`.

## Shared rules
- **Rings**: a ring grows from its centre (bell or hero) to its radius; each foe the front reaches is hit once. A push carries a foe at most to the ring's rim (never past it). Status and push land only inside the hero's view, like damage.
- **Big foes** (radius ≥ 12: brutes, elites, bosses): every weapon hit (rings and bell bodies) deals ×3.
- **Bell bodies**: each bell hits every foe it touches once per 0.4 s for dmg × body × 0.4, small push.

## Toll (base)
1 bronze bell orbits at 32 px (2.4 rad/s). Every 1.5 s it peals a 70 px ring: 9 damage, push 160. Body 0.5.

## Paths
| Path | Rank 1 | Rank 3 | Rank 5 | Forms |
|---|---|---|---|---|
| **Peal** | +30% ring size, rings push harder (area +0.3, push +50%) | Each peal echoes in a wider ring (×1.35 radius, 60% damage, 0.25 s later, no push) | Rings stun 0.5 s, peal 15% faster | Cathedral, Undertow |
| **Resonance** | Rings chill foes, slowing them 40% (2 s) | Foes slain by rings burst into ice (26 px, 40% damage, chill) | Peals leave frost (radius ½ ring, max 48 px, 2 s, 0.6 × dmg/s, slow 45%); +40% ring damage vs slowed / stunned / frozen foes | Glacier Toll, Windchime |
| **Pendulum** | Bell swings wide (orbit +40 px) and hits harder (body +1) | +1 bell | +1 bell; bells swing out and back (0.5×–1.5× orbit) | Carillon |

Tables give the 3 shape ranks at path ranks 1 / 3 / 5; path ranks 2 and 4 are generic steps (+10% damage, cooldown x0.95). Before the path: 5 tune steps; the path is picked from a chest (one per slot, permanent); a path at rank 5 readies its Forms (GAME-DESIGN §4). A Form keeps only its own path's ranks.

## Forms (path ranks keep adding on top)
| Form | Rule | Pattern | Base | Refine 1 | Refine 2 |
|---|---|---|---|---|---|
| **Cathedral** | Peal 5 | Great bells peal one after another (0.18 s apart), then great rings (2× radius, 75% damage) burst from the hero. One toll hits a foe once with the bell rings and once with their echoes, however many bells reach it; the next toll waits for the sequence to end | 4 bells, dmg 11, cd 1.6, ring 84 px, push 300, stun 0.2 | The great ring tolls twice | +25% ring size |
| **Glacier Toll** | Resonance 5 | Slow frost rings freeze foes 1.1 s (almost no push); the next ring that reaches a frozen foe shatters it (+60% damage, ice burst, thaw). Echo rings never freeze or shatter | 3 bells, dmg 6, cd 1.4, ring 78 px | +1 frost bell | +20% ring size, freeze +0.5 s |
| **Carillon** | Pendulum 5 | A fast wheel of bells: each peal they chime small rings (80% damage) from the inner rest radius, then the wheel swells out (0.6× → 1.5× orbit) and back in 0.8 s, sweeping the horde | 4 bells, dmg 8, cd 1.3, knock 110, chime 40 px, body 2, spin 3.2 | +2 bells | Bells whirl faster and swing wider |
| **Undertow** | Peal 5 | A ring closes in from 2.2× ring size to the hero (80% damage), dragging every foe it reaches onto the bells' fixed orbit (0.75× orbit); foes it cannot move (bosses, no knockback) take ×6. Then a clap ring to the orbit + 26 px (60% damage) stuns them stun + 0.4 s | 2 bells, dmg 7, cd 1.6, ring 80 px, body 1 | +1 bell | Drags from 25% farther |
| **Windchime** | Resonance 5 | Every peal each bell drops a chime where it hangs; a chime stays 4 s and rings a 44 px ring every 0.6 s (55% damage, with chill / ice burst / resonance) | 1 bell, dmg 8, cd 1.3, body 1 | +1 bell, one more chime | Chimes ring 50% longer |

## Great Peal (Q)
Zero damage. Cooldown 16 s at every level. A ring from the hero to 370 px (about the whole view) in 0.5 s: stun 1.2 s, push 180 (to the ring's rim at most).
- L2: A second, wider peal follows (×1.25 radius, 75% stun, 0.55 s later).
- L3: Shields you and allies for 1.5 s (every living hero inside the ring is invulnerable).
- L4: Pulls gems; stuns 0.5 s longer.

## dps.js (`node tools/dps.js bell`: weapon only, no Q casts, build fixed, no level-ups; builds: GAME-DESIGN §4 Power yardstick)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 579 | 6.1 | 19 |
| t5 | - |  | 897 | 10.5 | 33 |
| p0 | - |  | 1,539 | 19.3 | 77 |
| p1 | - |  | 1,528 | 20.3 | 65 |
| p2 | - |  | 1,651 | 21.6 | 77 |
| f00 | cathedral | 360° | 3,698 | 47.9 | 159 |
| f01 | undertow | 360° | 3,032 | 40.0 | 208 |
| f10 | glaciertoll | 360° | 2,926 | 39.5 | 215 |
| f11 | windchime | 360° | 1,955 | 27.1 | 261 |
| f20 | carillon | 360° | 3,188 | 43.7 | 230 |

Role rule: every Bell Form is 360°; crowd ceiling 0.6 × the cross-hero directional f mean (3,575 → ≤ 2,145): only Windchime (1,955) meets it; Cathedral 3,698, Carillon 3,188, Undertow 3,032 and Glacier Toll 2,926 exceed it. Outside ±25% of the Bell mean (2,960): Windchime (−34%). Crowd damage drops when pushes hold the horde at the rings' rims; that is the role's trade.
