# Knight — Brawler

Role: wades into the crowd. Wide, heavy front arcs, stagger and knockback; directional Forms (Colossus Blade, Rending Gale) are the lane role: high per-hit, big foes (radius ≥ 12: brutes, elites, bosses) take ×1.6 from their sweeps and Gale crescents; 360° Forms (Whirlwind, Earthsplitter, Blade Tempest) are Garlic-tier: 60 px reach at Form base, low per-hit, strong push. Q is mobility + crowd control.

## Weapon: Cleave (cursor)

Base: 36 dmg, cd 1.1 s, one 115° arc (2.0 rad), reach 56 px, knock 120. Big foes (radius ≥ 12: brutes, elites, bosses) take ×1.6 from every Cleave swing and slam (not from waves). Attacks come in strings: extra swings follow 0.15 s apart (alternating ±0.3 rad) at 0.8× damage. Back swings deal 0.5× and carry no waves or slams. Aim: directional strings (Cleave, Colossus Blade, Rending Gale) swing exactly along the cursor, waves and crescents fly along it, back swings mirror it; 360° Forms ignore it.

| Path | Rank 1 | Rank 3 | Rank 5 |
|---|---|---|---|
| Greatblade → Colossus Blade, Earthsplitter | Bigger, slower swings that stagger (area +30%, cd +15%, stun 0.3 s) | Much wider arc, +30% damage (arc +0.9 rad) | Each swing ends in a ground slam (blast at the tip, r 24 × area, 0.8×) |
| Whirl → Whirlwind | Also swings behind you | +1 swing per attack | Last swing becomes a full spin (Cleave only, 0.6×) |
| Edge Wave → Rending Gale, Blade Tempest | Swings fling a crescent wave (piercing, 0.7×, ~125 px; the waves of one swing hit a foe once per leg, out / back) | +2 waves in a fan | Waves fly back to you, +20% damage |

Tables give the 3 shape ranks at path ranks 1 / 3 / 5; path ranks 2 and 4 are generic steps (+10% damage, cooldown x0.95). Before the path: 5 tune steps; the path is picked from a chest (one per slot, permanent); a path at rank 5 readies its Forms (GAME-DESIGN §4). A Form keeps only its own path's ranks.

## Forms (one per run; path ranks keep applying)

| Form | Rule | Pattern | Refine 1 | Refine 2 |
|---|---|---|---|---|
| Colossus Blade | Greatblade 5 | One slow 200° sweep (40.6 dmg, cd 1.8 s, area 1.5, stagger 0.5 s); foes within half reach take +250%; big foes ×1.6; 3 cracks fan across the sweep and erupt 0.3 s later (≤ 200 px, 0.7×). Extra swings become +2 cracks each. | +2 ground cracks | +20% size, longer stagger |
| Whirlwind | Whirl 5 | 360° spins (8.4 dmg, cd 0.9 s, reach 50 × area 1.2 = 60 px); hits swirl foes around and outward (knock 150, elites half); cooldown runs 1.3× while moving; inner half +100%. | +1 spin per whirl | +15% spin size |
| Rending Gale | Edge Wave 5 | A ±30° cone straight ahead (12.6 dmg, cd 0.7 s): the swing arc is at most 60°, no back swing, extra swings stay on the aim line; 3 big piercing wind crescents (0.4×, start 2 × their radius out, ~235 px) fan within ±18° and leave cut lines (0.3× dmg/s, 1 s, ≤ 200 px); returning crescents end at their start distance; the crescents of one swing hit a foe at most 7 times per leg (out / back); big foes take ×1.6 from sweeps and crescents. | +2 crescents | Cuts linger twice as long |
| Earthsplitter | Greatblade 5 | Heavy spins (15 dmg, cd 1.2 s, reach 46 px × Greatblade area 1.3 = 60 px, knock 160, inner half +100%); every 3rd attack 8 fissures radiate (≤ 200 px, erupt 0.35 s) plus a ground slam. | +4 fissures | Every 2nd attack |
| Blade Tempest | Edge Wave 5 | Spins (7.7 dmg, reach 60 px, knock 120, inner half +100%) release 3 blades that circle at 48 px, then spiral out to ~200 px (0.18×, re-hit 0.6 s); back = a second counter-turning ring; waves add blades. | +2 blades | +1 blade, +20% blade size |

Path keys in Forms: dmg / area / cd / stagger / slam / waves / return apply to every Form; back mirrors Colossus sweeps and doubles Tempest rings; Gale ignores back and arc beyond its cone; extra swings repeat spins (Colossus: +2 cracks each); spin applies to Cleave only. Velocity does not grow spin reach (area does).

## Q: Aegis Ward (`shove`, cd 25 s)

Zero damage. A ward of radius 50 (r, scales with reach) at the knight for 6.5 s (scales with duration). Foes inside slide out to its edge; while it holds, no non-boss foe stands within r + its radius of the centre (elites and knockback-immune foes included; bosses ignore it). Projectiles pass. r 50 keeps foes on the edge inside base Cleave reach (56 + foe radius from 4 px above the knight).

| Level | Card | Change |
|---|---|---|
| 2 | +20% ward radius | r 60 |
| 3 | The ward holds 1.5 s longer | 8 s |
| 4 | Ward cooldown 25 s to 20 s | cd 20 s |
| 5 | The ward moves with you | the ward centre follows the knight every tick: walking shoulders foes aside |

## dps.js (`node tools/dps.js knight`: weapon only, no Q casts, build fixed, no level-ups; builds: GAME-DESIGN §4 Power yardstick)

| build | form | kind | crowd wpn | kills/s | single wpn | boss wpn |
|---|---|---|---|---|---|---|
| base | - |  | 905 | 12.1 | 52 | 52 |
| t5 | - |  | 1,069 | 14.3 | 83 | 83 |
| p0 | - |  | 2,031 | 29.3 | 221 | 221 |
| p1 | - |  | 1,769 | 25.0 | 160 | 160 |
| p2 | - |  | 2,307 | 32.9 | 244 | 244 |
| f00 | colossus | dir | 3,630 | 51.1 | 387 | 387 |
| f01 | earthsplitter | 360째 | 1,867 | 25.3 | 98 | 98 |
| f10 | whirlwind | 360째 | 1,636 | 22.8 | 100 | 100 |
| f20 | gale | dir | 2,970 | 40.9 | 639 | 663 |
| f21 | tempest | 360째 | 1,582 | 19.7 | 48 | 58 |

Role rule (f rows): 360° Forms (Earthsplitter, Whirlwind, Blade Tempest) crowd ≤ 0.6 × directional mean (3,300 → ≤ 1,980): met; directional single ≥ 2 × the 360° best (100 → ≥ 200): met; each kind within ±25% of its mean. Whirlwind's numbers are standing still; moving spins 1.3× faster.
