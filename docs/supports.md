# Support weapons (canonical tree + numbers)

Pool of 8, 2 support slots per hero (GAME-DESIGN §4). Each: 3 paths x 3 ranks, one Form (any path at rank 3; from a chest).

## Censer
Horde (Garlic). An aura around you; every cooldown a pulse hits every foe inside.
Base: 3 dmg, cd 0.7 s, radius 40. dps.js crowd 231 (single 4).

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Size | aura +20% | a censer swings round at 0.8 R (12 px, 50%, every 0.2 s) | aura +20%, +1 censer |
| Ward | foes inside slowed 25% | pulses push out (knock 60), +20% dmg | every 3rd pulse blasts foes back (knock 240, 0.3 s stun) |
| Embers | pulses burn (40% dmg per s, 2 s) | each pulse drops a burning ember (12 px, 2.5 s, 80% per s) | burning foes slain burst (24 px, 60%; never chains) |

Form **Holy Censer** (base 6 dmg, cd 0.55 s, radius 60, push 110, slow 20%): kills inside the aura heal you 1 HP each, at most 3 HP/s. Refines: aura +20% · heals allies inside too, cap 5 HP/s.
All 9 ranks: crowd 988 (x4.3). Holy Censer + all ranks: 1331 (x1.35).

## Orbit Lanterns
Horde. Lanterns circle you (pierce all), each re-hitting a foe every 0.4 s; the ring is permanent and rebuilds in phase when it changes.
Base: 3 dmg, 3 lanterns, orbit 40 px, 1.7 rad/s, knock 70. dps.js crowd 252 (single 5).

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Count | +1 lantern | +1 lantern | +1 lantern |
| Radius | orbit +14 px, lanterns 15% bigger | counter-ring (ceil(n / 3) + 1 at 1.6x, other way) | rings swing in and out (0.65-1.35x, 3 s) |
| Flare | a lantern that hits bursts (16 px, 30%, once per 1.2 s) | bursts slow 40%, +20% dmg | bursts 50% wider |

Form **Sun Wheel** (base 2.4 dmg, cd 1.8 s, 4 suns, radius 60, 1.4 rad/s): a burning ring around you; every cooldown the suns burst in turn (26 px, full dmg, push 180, burn 100% dmg per s for 2 s). Refines: +2 suns · flares 35% more often.
All 9 ranks: crowd 917 (x3.6). Sun Wheel + all ranks: 1262 (x1.38).

## Meteor Call
Horde. Every cooldown meteors fall (0.7 s, 0.06 s apart) on random foes in view (the aim point 90 px out when none).
Base: 10 dmg, cd 2.4 s, 3 meteors, radius 22, knock 140. dps.js crowd 188, single 12.

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Volley | +1 meteor | +1 meteor | the first meteor hits the densest pack |
| Crater | burning ground (0.8 r, 2 s, 15% dmg per s) | craters 30% wider, 50% longer | craters erupt as they fade (50%) |
| Shower | every 0.6 s a small meteor (half size, 40% dmg) | 2 small meteors per shower | impacts throw 3 ember shards (30%) |

Form **Starfall** (base 5 dmg, cd 0.8 s, 1 star per volley + Volley ranks, star radius 21): a constant shower; every 8th volley a comet on the densest pack (2.5x dmg, 66 px, a crater that erupts, shards). Refines: +1 star · comets twice as often.
All 9 ranks: crowd 776 (x4.1). Starfall + all ranks: 1110 (x1.43).

## Frost Ring
Control. Every cooldown a ring grows from you to its radius in 0.45 s; its front hits each foe once: damage, push 70, slow 40% for 1.5 s. Extra rings of a volley follow 0.25 s apart at 50% dmg.
Base: 3 dmg, cd 2.4 s, radius 60. dps.js crowd 143 (single 1).

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Reach | rings 20% wider | rings 25% wider | full rings burst into 8 ice shards (40%, slow) |
| Chill | a frost floor at full size (ring radius, 2.25 s, slows 0.8x) | a second ring follows | slow 60%, frost floor twice as long |
| Shatter | every 3rd ring freezes 0.9 s | a shatter ring 0.7 s behind each freezing ring breaks frozen foes (+50%, ice burst, thaw) | every 2nd ring freezes |

Form **Glacier** (base 15 dmg, cd 2.2 s, radius 60, slow 50%): every ring freezes, stays where it rose and holds 1.2 s as a frost wall (every 0.5 s: 30% dmg and a refreeze in its band). Refines: +1 ring · walls hold 1 s longer.
All 9 ranks: crowd 582 (x4.1). Glacier + all ranks: 803 (x1.38).

Single-target numbers of these four stay below 15-30: the yardstick's lone foe at 50 px sits on the rim of 40-60 px auras and orbits, so it meets one hit window per pulse or pass.

## War Axe
Control. Axes thrown upward toward the cursor's side fall with gravity across the screen, pierce, and knock every foe hit away from the hero (bosses and knockback-immune brutes ignore it).
Base: 20 dmg, cd 1.5 s, 2 axes, pierce 4, knock 260 (about 26 px), radius 7. dps.js crowd 131 (single 13).

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Count | +1 axe | axes fly to both sides | +15% dmg, +1 axe |
| Heft | axes 30% bigger, knock +30% | hits stagger (0.35 s stun) | pierce +2, knock +30% |
| Return | 1 bounce on landing (24 px below the throw) | the bounce flies back toward you | +15% dmg, +1 bounce |

Form **Avalanche** (base 18 dmg, 2 axes, pierce 4, area 1.1, knock 300): a landing axe thuds (knockback ring, no damage) and splits into 3 small axes (30% dmg, 1 pierce). Refines: +1 axe · +20% dmg, splits into 5.
All 9 ranks: crowd 491 (x3.75). Avalanche + all ranks: 714 (x1.45).

## Bramble Trail
Control. Thorn patches root foes (0.5 s stun, then 0.8 s immune; bosses never, elites half) and prick them for little damage (3 per s, one hit per second). Walking drops a patch every 22 px; each cooldown a ring erupts around you, starting on the cursor side.
Base: cd 1.6 s, ring of 5 patches at 48 px, patch radius 8.5, 1.8 s. dps.js crowd 106 (standing still: ring only).

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Length | thorns last 30% longer | trail 3 thorns wide | trail 5 wide, +30% duration |
| Snare | +2 ring thorns | thorns 20% wider, roots +0.3 s | second ring at 1.7x radius |
| Barbs | a root also stabs (70% of a hit) | rooted kills sprout a patch (6 per cooldown) | stabs always crit, roots +0.2 s |

Form **Thornwood** (base 2.5 dmg, cd 1.8 s, 5 thickets, radius 10, area 1.1, 2.2 s, root 0.6 s, immune only 0.4 s): thickets last longer and re-grab. Refines: +20% dmg, 15% wider · +2 thickets, roots +0.2 s.
At most 140 live patches per hero. All 9 ranks: crowd 427 (x4.0). Thornwood + all ranks: 612 (x1.43).

## Glaive
Lane. Boomerangs thrown along the cursor fly out half their range and back; each trip cuts the first foe for a full hit and the next 3 for 30%, the rest for nothing. A fan of n glaives deals (1 + 0.4 (n - 1)) x one glaive.
Base: 32 dmg, cd 1.0 s, 1 glaive, range 320 (160 out), speed 260, radius 9. dps.js crowd 120, single 62.

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Twin | +1 glaive (0.3 rad fan) | +1 glaive | +1 glaive |
| Reach | range +30%, speed +20% | spins 0.45 s at the far end (full re-hits every 0.12 s) | cuts 2 more foes, range +20% |
| Edge | 40% bigger, later cuts +10% | the return trip always crits | +15% dmg, 30% bigger |

Form **Twin Moons** (base 23 dmg, cd 1.5 s, 2 moons each way, radius 13, loop radius 62 x range / 320, at most 85): the moons leave along the cursor and loop out on both sides, back through you and on along the cursor, so a foe on the line is cut twice; per half loop the first foe takes the full hit, the next ones only through Edge. Refines: +1 moon each way · +25% dmg, wider loops.
All 9 ranks: crowd 454 (x3.8), single 224 (x3.6). Twin Moons + all ranks: crowd 646 (x1.42), single 411 (x1.83).

## Chain Spark
Lane, single target. Each cooldown a bolt strikes the nearest elite or boss in view (else the nearest foe), then jumps to the nearest unhit foe within 90 px, damage x0.5 per jump. n bolts deal (1 + 0.5 (n - 1)) x one bolt; extra bolts strike random foes in view. At most 32 foes per bolt.
Base: 56 dmg, cd 0.9 s, 2 jumps, range 320. dps.js crowd 107, single 62.

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Chain | +1 jump | +1 bolt at another foe | +1 jump, jump range +20 px |
| Voltage | first foe +30% dmg, 0.2 s stun | first foe struck a second time (40%) | bolts 15% faster |
| Fork | a kill forks 1 arc (50% of the killing hit) | the arc splits in two at the first foe | kills fork 2 arcs |

Form **Storm Crown** (base 37 dmg, cd 0.8 s, first foe x1.2 and 0.25 s stun, 1 jump at x0.4, range 340): a crown of sparks over your head; bolts fall from the sky and fork in two at the first jump (Fork rank 2 adds a third branch). Refines: +1 sky bolt · +25% dmg, forks 1 jump deeper.
All 9 ranks: crowd 428 (x4.0), single 206 (x3.3). Storm Crown + all ranks: crowd 666 (x1.56), single 300 (x1.46).
