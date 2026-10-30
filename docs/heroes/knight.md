# Knight — Brawler

Role: wades into the crowd. Wide, heavy front arcs, stagger and knockback; directional Forms (Colossus Blade, Rending Gale) are the lane role: high per-hit, big foes (radius ≥ 12: brutes, elites, bosses) take ×1.6 from their sweeps and crescents; 360° Forms (Whirlwind, Earthsplitter, Blade Tempest) are Garlic-tier: 60 px reach at Form base, low per-hit, strong push. Q is mobility + crowd control.

## Weapon: Cleave (cursor)

Base: 24 dmg, cd 1.1 s, one 115° arc (2.0 rad), reach 56 px, knock 120. Attacks come in strings: extra swings follow 0.15 s apart (alternating ±0.3 rad) at 0.8× damage. Back swings deal 0.5× and carry no waves or slams. Aim: directional strings (Cleave, Colossus Blade, Rending Gale) swing exactly along the cursor, waves and crescents fly along it, back swings mirror it; 360° Forms ignore it.

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Greatblade → Colossus Blade | Bigger, slower swings that stagger (area +30%, cd +15%, stun 0.3 s) | Much wider arc, +30% damage (arc +0.9 rad) | Each swing ends in a ground slam (blast at the tip, r 24 × area, 0.8×) |
| Whirl → Whirlwind | Also swings behind you | +1 swing per attack | Last swing becomes a full spin (Cleave only, 0.6×) |
| Edge Wave → Rending Gale | Swings fling a crescent wave (piercing, 0.45×, ~125 px) | +2 waves in a fan | Waves fly back to you, +20% damage |

## Forms (one per run; path ranks keep applying)

| Form | Rule | Pattern | Refine 1 | Refine 2 |
|---|---|---|---|---|
| Colossus Blade | Greatblade 3 | One slow 200° sweep (58 dmg, cd 1.8 s, area 1.5, stagger 0.5 s); foes within half reach take +250%; big foes ×1.6; 3 cracks fan across the sweep and erupt 0.3 s later (≤ 200 px, 0.7×). Extra swings become +2 cracks each. | +2 ground cracks | +20% size, longer stagger |
| Whirlwind | Whirl 3 | 360° spins (12 dmg, cd 0.9 s, reach 50 × area 1.2 = 60 px); hits swirl foes around and outward (knock 150, elites half); cooldown runs 1.3× while moving; inner half +100%. | +1 spin per whirl | +15% spin size |
| Rending Gale | Edge Wave 3 | Swings fling 3 big piercing wind crescents (0.7×, ~175 px) that leave cut lines (0.45× dmg/s, 1 s); big foes take ×1.6 from sweeps and crescents. | +2 crescents | Cuts linger twice as long |
| Earthsplitter | Greatblade 3 + Whirl 3 | Heavy spins (25 dmg, cd 1.2 s, reach 46 px × Greatblade area 1.3 = 60 px, knock 160, inner half +100%); every 3rd attack 8 fissures radiate (≤ 200 px, erupt 0.35 s) plus a ground slam. | +4 fissures | Every 2nd attack |
| Blade Tempest | Whirl 3 + Edge Wave 3 | Spins (11 dmg, reach 60 px, knock 120, inner half +100%) release 3 blades that circle at 48 px, then spiral out to ~200 px (0.18×, re-hit 0.6 s); back = a second counter-turning ring; waves add blades. | +2 blades | +1 blade, +20% blade size |

Path keys in Forms: dmg / area / cd / stagger / slam / waves / return apply to every Form; back mirrors Colossus and Gale sweeps (Gale crescents too) and doubles Tempest rings; extra swings repeat spins (Colossus: +2 cracks each); spin applies to Cleave only. Velocity does not grow spin reach (area does).

## Q: Bulwark Shove (`shove`, cd 9 s)

Zero damage. Every foe within 120 px of the knight (r, scales with reach) slides out to r × 5/3 (200 px) from it and is slowed 50% for 3 s. Elites slide half the way; bosses and knockback-immune foes are not moved.

| Level | Card | Change |
|---|---|---|
| 2 | +30% shove radius | r 156, foes pushed out to 260 px |
| 3 | Shoved foes are stunned 1 s | stun 1 s, then the slow |
| 4 | Leaves a ring foes cannot cross | a ring at the shove edge holds 3 s at the cast point; non-boss foes cannot enter it (they can leave) |

## dps.js (`node tools/dps.js knight`: weapon only, no Q casts, build fixed, no level-ups)

| build | form | kind | crowd wpn | kills/s | single wpn |
|---|---|---|---|---|---|
| base | - |  | 746 | 1.1 | 22 |
| p0 | - |  | 1,660 | 6.7 | 45 |
| p1 | - |  | 1,797 | 7.6 | 32 |
| p2 | - |  | 1,982 | 8.3 | 98 |
| all | - |  | 3,815 | 18.1 | 142 |
| f0 | colossus | dir | 4,873 | 23.5 | 268 |
| f1 | whirlwind | 360° | 2,616 | 12.3 | 36 |
| f2 | gale | dir | 4,771 | 23.3 | 256 |
| h0 | earthsplitter | 360° | 2,648 | 11.7 | 96 |
| h1 | tempest | 360° | 2,611 | 11.6 | 35 |
| F0 | colossus | dir | 6,713 | 32.8 | 423 |
| F1 | whirlwind | 360° | 2,382 | 9.8 | 135 |
| F2 | gale | dir | 7,180 | 36.3 | 612 |
| H0 | earthsplitter | 360° | 3,708 | 17.3 | 138 |
| H1 | tempest | 360° | 2,704 | 10.8 | 80 |

Role rule (f / h rows): 360° Forms (Whirlwind, Earthsplitter, Blade Tempest) crowd ≤ 0.6 × directional mean (4,822 → ≤ 2,893); directional single ≥ 2 × the 360° best (96 → ≥ 192). Whirlwind's numbers are standing still; moving spins 1.3× faster.
