# Bell (Bellwarden) — controller / tank

Role: pushes, stuns, freezes and drags the horde; lowest raw damage, most control. Survives by never letting the horde touch it. Code: `src/heroes/bell.js`, visuals `src/client/hfx-bell.js`, check `tools/check-hero-bell.js`.

## Shared rules
- **Rings**: a ring grows from its centre (bell or hero) to its radius; each foe the front reaches is hit once. A push carries a foe at most to the ring's rim (never past it). Status and push land only inside the hero's view, like damage.
- **Big foes** (radius ≥ 12: brutes, elites, bosses): every weapon hit (rings and bell bodies) deals ×3.
- **Bell bodies**: each bell hits every foe it touches once per 0.4 s for dmg × body × 0.4, small push.

## Toll (base)
1 bronze bell orbits at 32 px (2.4 rad/s). Every 1.5 s it peals a 70 px ring: 9 damage, push 160. Body 0.5.

## Paths
| Path | Rank 1 | Rank 2 | Rank 3 | Form |
|---|---|---|---|---|
| **Peal** | +30% ring size, rings push harder (area +0.3, push +50%) | Each peal echoes in a wider ring (×1.35 radius, 60% damage, 0.25 s later, no push) | Rings stun 0.5 s, peal 15% faster | Cathedral |
| **Resonance** | Rings chill foes, slowing them 40% (2 s) | Foes slain by rings burst into ice (26 px, 40% damage, chill) | Peals leave frost (radius ½ ring, max 48 px, 2 s, 0.6 × dmg/s, slow 45%); +40% ring damage vs slowed / stunned / frozen foes | Glacier Toll |
| **Pendulum** | Bell swings wide (orbit +40 px) and hits harder (body +1) | +1 bell | +1 bell; bells swing out and back (0.5×–1.5× orbit) | Carillon |

## Forms (path ranks keep adding on top)
| Form | Rule | Pattern | Base | Refine 1 | Refine 2 |
|---|---|---|---|---|---|
| **Cathedral** | Peal 3 | Great bells peal one after another (0.18 s apart), then great rings (2× radius, 75% damage) burst from the hero | 4 bells, dmg 18, cd 1.6, ring 84 px, push 300, stun 0.2 | The great ring tolls twice | +25% ring size |
| **Glacier Toll** | Resonance 3 | Slow frost rings freeze foes 1.1 s (almost no push); the next ring that reaches a frozen foe shatters it (+60% damage, ice burst, thaw). Echo rings never freeze or shatter | 3 bells, dmg 12, cd 1.4, ring 78 px | +1 frost bell | +20% ring size, freeze +0.5 s |
| **Carillon** | Pendulum 3 | A fast wheel of bells: each peal they chime small rings (80% damage) from the inner rest radius, then the wheel swells out (0.6× → 1.5× orbit) and back in 0.8 s, sweeping the horde | 4 bells, dmg 16, cd 1.3, chime 40 px, body 2, spin 3.2 | +2 bells | Bells whirl faster and swing wider |
| **Undertow** (hybrid) | Peal 3 + Pendulum 3 | A ring closes in from 2.2× ring size to the hero (80% damage), dragging every foe it reaches onto the bells' fixed orbit (0.75× orbit); foes it cannot move (bosses, no knockback) take ×6. Then a clap ring to the orbit + 26 px (60% damage) stuns them stun + 0.4 s | 2 bells, dmg 14, cd 1.6, ring 80 px, body 1 | +1 bell | Drags from 25% farther |
| **Windchime** (hybrid) | Resonance 3 + Pendulum 3 | Every peal each bell drops a chime where it hangs; a chime stays 4 s and rings a 44 px ring every 0.6 s (55% damage, with chill / ice burst / resonance) | 1 bell, dmg 16, cd 1.3, body 1 | +1 bell, one more chime | Chimes ring 50% longer |

## Great Peal (Q)
Cooldown 16 s at every level. A ring from the hero to 370 px (about the whole view) in 0.5 s: 10 damage (+50% vs slowed / stunned / frozen foes), stun 1.2 s, push 180.
- L2: A second, wider peal follows (×1.25 radius, 75% damage and stun, 0.55 s later).
- L3: Shields you and allies for 1.5 s (every living hero inside the ring is invulnerable).
- L4: Pulls gems; stuns 0.5 s longer.

## dps.js (node tools/dps.js bell; no level-ups during the run)
| build | form | crowd wpn | crowd q | kills/s | single wpn | single q |
|---|---|---|---|---|---|---|
| base | - | 601 | 169 | 2.8 | 21 | 1 |
| p0 | - | 1129 | 270 | 8.3 | 38 | 2 |
| p1 | - | 1088 | 266 | 8.4 | 30 | 2 |
| p2 | - | 1223 | 238 | 8.3 | 37 | 1 |
| all | - | 2202 | 366 | 17.0 | 115 | 2 |
| f0 | cathedral | 3366 | 655 | 27.3 | 323 | 4 |
| f1 | glaciertoll | 3620 | 462 | 29.6 | 216 | 3 |
| f2 | carillon | 4550 | 551 | 37.9 | 344 | 3 |
| h0 | undertow | 4690 | 563 | 37.5 | 170 | 3 |
| h1 | windchime | 3956 | 606 | 33.7 | 185 | 4 |
| F0 | cathedral | 7339 | 1030 | 61.4 | 489 | 6 |
| F1 | glaciertoll | 7660 | 812 | 62.5 | 355 | 4 |
| F2 | carillon | 5783 | 916 | 49.8 | 545 | 5 |
| H0 | undertow | 6300 | 845 | 53.3 | 238 | 5 |
| H1 | windchime | 5512 | 941 | 47.9 | 291 | 5 |

Crowd damage drops when pushes hold the horde at the rings' rims; that is the role's trade.
