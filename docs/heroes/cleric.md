# Cleric — support / healer

Role: holy strikes on foes near the hero, healing and protecting allies, zone control. The only hero that sustains a party; solo healing only flows while foes are in reach (aura pulses that hit, holy ground, Sanctuary). Damage lands only inside the hero's view.

## Weapon: Smite (root)

- Base: dmg 23, cd 1.0 s, 1 pillar, pillar radius 26, range 230 px. Pillars fall 0.2 s on distinct random foes within range in view; pillars beyond the foe count fall again on random picks 0.1 s apart (single targets take them all). Pillars stay targeted. No foe: pillars stride out along the cursor direction.
- Emitters added by paths (all damage factors are of the weapon damage):
  - **Aura** (Censer): radius 48 / 62 (rank 1 / 2) × area; pulse every 0.5 s for 10%; with healing, a pulse that hit any foe heals heroes inside 0.6 HP/s.
  - **Censers** (Censer 3): orbit at 0.8 × aura radius, blast r 12 every 0.2 s for 25%, knock 60.
  - **Beam** (Lance): every 3 s, foe or no foe, a 130 px beam sweeps 1.9 rad centred on the cursor direction in 0.4 s; each foe crossed takes 75% and a 0.2 s stun.

## Paths

| Path | Rank 1 | Rank 3 | Rank 5 | Forms |
|---|---|---|---|---|
| Storm | +1 pillar (n +1) | Pillars leap to a nearby foe (1 leap: 70% radius, 40% dmg, within 110 px; no foe: strikes the spot again) | Leaps strike 2 foes (2 leaps) | Wrath |
| Censer | A holy aura burns foes near you (aura) | Aura grows and heals allies in it (radius 62, heal 0.6 HP/s) | 2 censers swing around you | Halo, Consecration |
| Lance | A holy beam sweeps foes every 3 s | The beam sweeps back again (2 passes) | A second beam sweeps behind you (2 beams, opposite) | Judgment Ray, Verdict |

Tables give the 3 shape ranks at path ranks 1 / 3 / 5; path ranks 2 and 4 are generic steps (+10% damage, cooldown x0.95). Before the path: 5 tune steps; the path is picked from a chest (one per slot, permanent); a path at rank 5 readies its Forms (GAME-DESIGN §4). A Form keeps only its own path's ranks.

## Forms (one per run; path ranks keep applying; base dmg 30, Verdict 48, Halo 24, Judgment Ray 23)

| Form | Rule | Pattern | Refine 1 | Refine 2 |
|---|---|---|---|---|
| Wrath | Storm 5 | 2 pillars (r 28); each starts a chain of 5 hops: the next pillar falls on the nearest foe within 120 px farther from the chain start (85% dmg, 0.1 s apart) | Chains hop 2 more times | +1 pillar, +20% damage |
| Halo | Censer 5 | The aura becomes a ring wall, radius 60 × area: the band (−14 / +10 px) hits every 0.25 s for 35%, slows 40%, shoves out (knock 140); inner pulses 80%; heal +0.6 HP/s; +1 censer riding the ring | The ring is 30% wider | +2 censers, +20% damage |
| Judgment Ray | Lance 5 | 1 + 1 + beams + passes holy beams (60 px) turn around the hero at 2.4 rad/s without pause, 35% per crossing; 3 pillars per volley | Beams reach 30% farther | +1 beam, +20% damage |
| Consecration | Censer 5 | Every volley pillar leaves holy ground (2 × pillar radius, 3 s × duration): 30% dps, 30% slow; heroes standing in any of it heal 1.2 HP/s (no stacking) | +1 pillar | +20% damage, ground burns hotter |
| Verdict | Lance 5 | Sweeps every 1.6 s and each beam calls a pillar every 0.06 s along it (at 50 / 78 / 100% of its length, 60% dmg, 85% radius) | Beams reach 30% farther | +1 pillar, +20% damage |

## Skill (Q): Sanctuary

- Zero damage. cd 14 s. Holy ground at the cursor, radius 80, 4 s: a cast burst knocks foes out; foes inside slowed 45%; every living hero inside heals 5 HP/s.
- L2: +35% area, wards foes out (shoved from the centre every 0.25 s). L3: lasts 50% longer, downed allies inside revive in about 1.3 s. L4: holy pillars rain inside (one every 0.25 s, 20 px, stun 0.6 s). L5: allies inside take 40% less damage (checked every 0.25 s).

## dps.js (`node tools/dps.js cleric`: weapon only, no Q casts, build fixed, no level-ups; builds: GAME-DESIGN §4 Power yardstick)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 440 | 4.4 | 23 |
| t5 | - |  | 614 | 6.8 | 36 |
| p0 | - |  | 1,269 | 15.7 | 174 |
| p1 | - |  | 1,369 | 17.4 | 71 |
| p2 | - |  | 1,398 | 18.0 | 62 |
| f00 | wrath | dir | 5,262 | 74.0 | 546 |
| f10 | halo | 360° | 2,486 | 33.9 | 195 |
| f11 | consecration | dir | 4,574 | 62.3 | 564 |
| f20 | jray | 360° | 2,373 | 31.9 | 211 |
| f21 | verdict | dir | 4,874 | 68.5 | 435 |

Role rule (f rows): 360° Forms (Halo, Judgment Ray) crowd ≤ 0.6 × directional mean (4,903 → ≤ 2,942): met; directional single ≥ 2 × the 360° best (211 → ≥ 422): met (Verdict 435 lowest); each kind within ±25% of its mean.
