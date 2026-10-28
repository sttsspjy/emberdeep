# Necro — Summoner

**Role**: the army does the work. The hero hangs back, throws a few bone shards and keeps a horde of minions standing; corpses are fuel (raising, pools, Corpse Blast all consume fresh corpses ≤ 5 s old, in view). All damage, targeting and corpses stay inside the hero's view.

## Weapon: Bone Shard (auto, nearest)

Every 1.0 s: 1 piercing shard (12 dmg, pierce 3, 280 px/s, range 220) at the nearest foe, else along the facing. Then the **army** step: raises 1 minion while fewer than **3** live (at the freshest corpse within 200 px, else beside the hero), so the army stands from the first seconds. Skeletons: 10 s life, swing every 0.6 s for 0.65 × weapon damage in a 2.8 rad arc, leash 200 px, target foes within 150 px. Hard cap 24 minions per hero.

| Path | Rank 1 | Rank 2 | Rank 3 | Form |
|---|---|---|---|---|
| **Legion** (bigger army) | +2 skeletons, raised two at a time (cap +2, raise +1) | The slain rise as extra skeletons (15% per kill, up to cap + 4, 6 s life) | Skeletons cleave wider, +25% damage (arc +1.2 rad) | Bone Lord |
| **Shards** (hero projectiles) | +2 bone shards | Shards burst into 3 splinters (½ damage, pierce 1, where a shard stops) | +1 shard, shards seek foes, +25% damage (homing 3 rad/s) | Bone Storm |
| **Plague** (corpses → ground) | The dead rot into blight pools (1 pool per volley on the freshest corpse, else under the nearest foe not already in a pool) | +1 pool, pools spread wider (area +25%) | Pools burst as they dry, +25% damage (0.8 × damage blast, 1.15 × pool radius) | Plague Field |

Blight pool: radius 22 × area, 3 s, 0.3 × weapon damage per second to every foe inside (0.5 s ticks), slow 30%. At most 14 live pools per hero.

## Forms (one per run, path ranks keep applying, 2 refines each)

| Form | Needs | Pattern | Refine 1 | Refine 2 |
|---|---|---|---|---|
| **Bone Lord** | Legion 3 | The army rises as Bone Knights: 16 dmg base, cap 4, 12 s life, 3.0 rad stunning cleave (0.6 × dmg), every 3rd swing a ground slam (radius 50, 2.8 × dmg, stun 0.4) | +2 Bone Knights | Knights slam more often (every 2nd), +25% damage |
| **Bone Storm** | Shards 3 | 6 shards orbit the hero (radius 30, 1 s, re-hitting every 0.25 s), then launch homing; splinters as Shards 2 | +2 orbiting shards | +25% damage, pierce 2 more |
| **Plague Field** | Plague 3 | Lobs 2 blight globs at the densest cluster (the rest around it); plague pools 1.35 × dmg per second, 3.5 s, area +20%; a foe dying in a pool seeds a new pool where it fell | +1 glob, pools grow larger | +25% damage, pools last longer (+1.5 s) |
| **Lich** (hybrid) | Legion 3 + Plague 3 | The army rises as ghouls (cap 5, raise 2 per volley, 5 s life, 140 px/s) that rush a foe and burst on contact (radius 34, 1.15 × dmg), leaving a blight pool | +2 ghouls, raised faster | +25% damage, bigger bursts (+10 px) |
| **Ossuary** (hybrid) | Legion 3 + Shards 3 | The army rises as skeleton archers (cap 4, raise 2): hold 60–110 px off, loose a homing shard every 0.6 s (0.55 × dmg, pierce 9) | +2 skeleton archers | Archers loose 2 shards, +25% damage |

All Forms keep the hero's own shards except Plague Field (globs) and Bone Storm (orbit).

## Skill (Q): Corpse Blast — cooldown 10 s

Detonates, inside the view: a nova at the hero (1.2 r), every minion (1.4 r, 1.6 × damage), as many fresh corpses as minions blew (at least 2, at most 12; 0.8 r) and every own blight pool (pool radius, 1.2 × damage). Base 6 dmg, r 36, knockback 300 (crowd rescue); the weapon re-raises the army afterwards.

| Level | Card |
|---|---|
| 2 | +40% blast size |
| 3 | Blasts throw bone shards (first 16 blasts, 3 shards each) |
| 4 | Detonated minions rise again |

## dps.js (fixed build, no level-ups)

| build | form | crowd wpn | crowd q | kills/s | single wpn | single q |
|---|---|---|---|---|---|---|
| base | - | 579 | 165 | 4.0 | 46 | 2 |
| p0 | - | 1468 | 413 | 13.1 | 90 | 5 |
| p1 | - | 1040 | 235 | 9.0 | 106 | 3 |
| p2 | - | 1687 | 228 | 14.2 | 64 | 4 |
| all | - | 3033 | 367 | 25.9 | 205 | 10 |
| f0 | bonelord | 4025 | 228 | 31.6 | 302 | 15 |
| f1 | bonestorm | 4618 | 133 | 36.6 | 320 | 8 |
| f2 | plaguefield | 4459 | 223 | 35.1 | 370 | 18 |
| h0 | lich | 4898 | 70 | 38.0 | 337 | 23 |
| h1 | ossuary | 3918 | 249 | 30.7 | 423 | 12 |
| F0 | bonelord | 5474 | 291 | 43.6 | 517 | 41 |
| F1 | bonestorm | 5085 | 304 | 40.6 | 497 | 22 |
| F2 | plaguefield | 5586 | 415 | 45.5 | 400 | 31 |
| H0 | lich | 5905 | 40 | 45.1 | 505 | 37 |
| H1 | ossuary | 5016 | 252 | 39.2 | 497 | 22 |
