# Cleric — support / healer

Role: holy strikes on foes near the hero, healing and protecting allies, zone control. The only hero that sustains a party; solo healing only flows while foes are in reach (aura pulses that hit, holy ground, Sanctuary). Damage lands only inside the hero's view.

## Weapon: Smite (root)

- Base: dmg 20, cd 1.0 s, 1 pillar, pillar radius 26, range 230 px. Pillars fall 0.2 s on distinct random foes within range in view; pillars beyond the foe count fall again on random picks 0.1 s apart (single targets take them all). Pillars stay targeted. No foe: pillars stride out along the cursor direction.
- Emitters added by paths (all damage factors are of the weapon damage):
  - **Aura** (Censer): radius 48 / 62 (rank 1 / 2) × area; pulse every 0.5 s for 10%; with healing, a pulse that hit any foe heals heroes inside 0.6 HP/s.
  - **Censers** (Censer 3): orbit at 0.8 × aura radius, blast r 12 every 0.2 s for 25%, knock 60.
  - **Beam** (Lance): every 3 s, foe or no foe, a 130 px beam sweeps 1.9 rad centred on the cursor direction in 0.4 s; each foe crossed takes 75% and a 0.2 s stun.

## Paths

| Path | Rank 1 | Rank 2 | Rank 3 | Form |
|---|---|---|---|---|
| Storm | +1 pillar (n +1) | Pillars leap to a nearby foe (1 leap: 70% radius, 40% dmg, within 110 px; no foe: strikes the spot again) | Leaps strike 2 foes (2 leaps) | Wrath |
| Censer | A holy aura burns foes near you (aura) | Aura grows and heals allies in it (radius 62, heal 0.6 HP/s) | 2 censers swing around you | Halo |
| Lance | A holy beam sweeps foes every 3 s | The beam sweeps back again (2 passes) | A second beam sweeps behind you (2 beams, opposite) | Judgment Ray |

## Forms (one per run; path ranks keep applying; base dmg 30, Halo 24, Judgment Ray 23)

| Form | Rule | Pattern | Refine 1 | Refine 2 |
|---|---|---|---|---|
| Wrath | Storm 3 | 2 pillars (r 28); each starts a chain of 5 hops: the next pillar falls on the nearest foe within 120 px farther from the chain start (85% dmg, 0.1 s apart) | Chains hop 2 more times | +1 pillar, +20% damage |
| Halo | Censer 3 | The aura becomes a ring wall, radius 60 × area: the band (−14 / +10 px) hits every 0.25 s for 35%, slows 40%, shoves out (knock 140); inner pulses 80%; heal +0.6 HP/s; +1 censer riding the ring | The ring is 30% wider | +2 censers, +20% damage |
| Judgment Ray | Lance 3 | 1 + 1 + beams + passes holy beams (60 px) turn around the hero at 2.4 rad/s without pause, 35% per crossing; 3 pillars per volley | Beams reach 30% farther | +1 beam, +20% damage |
| Consecration | Storm 3 + Censer 3 | Every volley pillar leaves holy ground (2 × pillar radius, 3 s × duration): 30% dps, 30% slow; heroes standing in any of it heal 1.2 HP/s (no stacking) | +1 pillar | +20% damage, ground burns hotter |
| Verdict | Storm 3 + Lance 3 | Sweeps every 1.6 s and each beam calls a pillar every 0.06 s along it (at 50 / 78 / 100% of its length, 170% dmg, 85% radius) | Beams reach 30% farther | +1 pillar, +20% damage |

## Skill (Q): Sanctuary

- Zero damage. cd 14 s. Holy ground at the cursor, radius 80, 4 s: a cast burst knocks foes out; foes inside slowed 45%; every living hero inside heals 5 HP/s.
- L2: +35% area, wards foes out (shoved from the centre every 0.25 s). L3: lasts 50% longer, downed allies inside revive in about 1.3 s. L4: holy pillars rain inside (one every 0.25 s, 20 px, stun 0.6 s).

## dps.js (`node tools/dps.js cleric`: weapon only, no Q casts, build fixed, no level-ups)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 410 | 0.0 | 20 |
| p0 | - |  | 1,226 | 3.4 | 73 |
| p1 | - |  | 1,180 | 3.1 | 32 |
| p2 | - |  | 1,091 | 1.9 | 28 |
| all | - |  | 2,204 | 8.6 | 98 |
| f0 | wrath | dir | 4,787 | 23.0 | 267 |
| f1 | halo | 360° | 2,564 | 12.0 | 105 |
| f2 | jray | 360° | 2,931 | 13.1 | 106 |
| h0 | consecration | dir | 5,143 | 24.1 | 480 |
| h1 | verdict | dir | 5,135 | 24.5 | 294 |
| F0 | wrath | dir | 5,575 | 27.4 | 310 |
| F1 | halo | 360° | 3,729 | 17.4 | 231 |
| F2 | jray | 360° | 3,994 | 19.2 | 244 |
| H0 | consecration | dir | 5,250 | 25.0 | 498 |
| H1 | verdict | dir | 5,400 | 26.2 | 320 |

Role rule (f / h rows): 360° Forms (Halo, Judgment Ray) crowd ≤ 0.6 × directional mean (5,022 → ≤ 3,013); directional single ≥ 2 × the 360° best (106 → ≥ 212).
