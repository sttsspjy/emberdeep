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
| **Cathedral** | Peal 3 | Great bells peal one after another (0.18 s apart), then great rings (2× radius, 75% damage) burst from the hero | 4 bells, dmg 15, cd 1.6, ring 84 px, push 300, stun 0.2 | The great ring tolls twice | +25% ring size |
| **Glacier Toll** | Resonance 3 | Slow frost rings freeze foes 1.1 s (almost no push); the next ring that reaches a frozen foe shatters it (+60% damage, ice burst, thaw). Echo rings never freeze or shatter | 3 bells, dmg 6, cd 1.4, ring 78 px | +1 frost bell | +20% ring size, freeze +0.5 s |
| **Carillon** | Pendulum 3 | A fast wheel of bells: each peal they chime small rings (80% damage) from the inner rest radius, then the wheel swells out (0.6× → 1.5× orbit) and back in 0.8 s, sweeping the horde | 4 bells, dmg 6, cd 1.3, chime 40 px, body 2, spin 3.2 | +2 bells | Bells whirl faster and swing wider |
| **Undertow** (hybrid) | Peal 3 + Pendulum 3 | A ring closes in from 2.2× ring size to the hero (80% damage), dragging every foe it reaches onto the bells' fixed orbit (0.75× orbit); foes it cannot move (bosses, no knockback) take ×6. Then a clap ring to the orbit + 26 px (60% damage) stuns them stun + 0.4 s | 2 bells, dmg 7, cd 1.6, ring 80 px, body 1 | +1 bell | Drags from 25% farther |
| **Windchime** (hybrid) | Resonance 3 + Pendulum 3 | Every peal each bell drops a chime where it hangs; a chime stays 4 s and rings a 44 px ring every 0.6 s (55% damage, with chill / ice burst / resonance) | 1 bell, dmg 8, cd 1.3, body 1 | +1 bell, one more chime | Chimes ring 50% longer |

## Great Peal (Q)
Zero damage. Cooldown 16 s at every level. A ring from the hero to 370 px (about the whole view) in 0.5 s: stun 1.2 s, push 180 (to the ring's rim at most).
- L2: A second, wider peal follows (×1.25 radius, 75% stun, 0.55 s later).
- L3: Shields you and allies for 1.5 s (every living hero inside the ring is invulnerable).
- L4: Pulls gems; stuns 0.5 s longer.

## dps.js (`node tools/dps.js bell`: weapon only, no Q casts, build fixed, no level-ups)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 640 | 0.0 | 21 |
| p0 | - |  | 1,258 | 3.4 | 37 |
| p1 | - |  | 1,145 | 3.8 | 29 |
| p2 | - |  | 1,385 | 3.7 | 37 |
| all | - |  | 2,316 | 9.3 | 117 |
| f0 | cathedral | 360° | 2,330 | 8.3 | 271 |
| f1 | glaciertoll | 360° | 2,644 | 11.6 | 105 |
| f2 | carillon | 360° | 2,747 | 12.0 | 130 |
| h0 | undertow | 360° | 2,441 | 8.8 | 86 |
| h1 | windchime | 360° | 2,688 | 11.4 | 91 |
| F0 | cathedral | 360° | 4,690 | 20.1 | 410 |
| F1 | glaciertoll | 360° | 3,749 | 16.2 | 179 |
| F2 | carillon | 360° | 2,851 | 11.9 | 206 |
| H0 | undertow | 360° | 3,090 | 13.1 | 117 |
| H1 | windchime | 360° | 3,623 | 16.4 | 141 |

Role rule: every Bell Form is 360°; crowd ceiling 0.6 × the cross-hero directional Form mean (f / h rows, 4,626 → ≤ 2,776). Crowd damage drops when pushes hold the horde at the rings' rims; that is the role's trade.
