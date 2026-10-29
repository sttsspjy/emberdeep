# Knight — Brawler

Role: wades into the crowd. Wide, heavy front arcs, stagger and knockback; strongest when surrounded (360 Forms and Colossus hit foes hugging the knight twice), moderate on single targets. Q is mobility + crowd control.

## Weapon: Cleave (cursor)

Base: 24 dmg, cd 1.1 s, one 115° arc (2.0 rad), reach 56 px, knock 120. Attacks come in strings: extra swings follow 0.15 s apart (alternating ±0.3 rad) at 0.8× damage. Back swings deal 0.5× and carry no waves or slams. Aim: directional strings (Cleave, Colossus Blade, Rending Gale) swing exactly along the cursor, waves and crescents fly along it, back swings mirror it; 360° Forms ignore it.

| Path | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Greatblade → Colossus Blade | Bigger, slower swings that stagger (area +30%, cd +15%, stun 0.3 s) | Much wider arc, +30% damage (arc +0.9 rad) | Each swing ends in a ground slam (blast at the tip, r 24 × area, 0.8×) |
| Whirl → Whirlwind | Also swings behind you | +1 swing per attack | Last swing becomes a full spin (Cleave only) |
| Edge Wave → Rending Gale | Swings fling a crescent wave (piercing, 0.45×, ~125 px) | +2 waves in a fan | Waves fly back to you, +20% damage |

## Forms (one per run; path ranks keep applying)

| Form | Rule | Pattern | Refine 1 | Refine 2 |
|---|---|---|---|---|
| Colossus Blade | Greatblade 3 | One slow 200° sweep (58 dmg, cd 1.8 s, area 1.5, stagger 0.5 s); foes within half reach take +250%; 3 cracks fan across the sweep and erupt 0.3 s later (≤ 200 px, 0.7×). Extra swings become +2 cracks each. | +2 ground cracks | +20% size, longer stagger |
| Whirlwind | Whirl 3 | 360° spins (28 dmg, cd 0.9 s); hits swirl foes around the knight; cooldown runs 1.7× while moving; inner half +100%. | +1 spin per whirl | +25% spin size |
| Rending Gale | Edge Wave 3 | Swings fling 3 big piercing wind crescents (0.7×, ~175 px) that leave cut lines (0.45× dmg/s, 1 s). | +2 crescents | Cuts linger twice as long |
| Earthsplitter | Greatblade 3 + Whirl 3 | Heavy spins (36 dmg, cd 1.2 s, inner half +100%); every 3rd attack 8 fissures radiate (≤ 200 px, erupt 0.35 s) plus a ground slam. | +4 fissures | Every 2nd attack |
| Blade Tempest | Whirl 3 + Edge Wave 3 | Spins (34 dmg, inner half +100%) release 3 blades that circle at 48 px, then spiral out to ~200 px (0.12×, re-hit 0.3 s); back = a second counter-turning ring; waves add blades. | +2 blades | +1 blade, +20% blade size |

Path keys in Forms: dmg / area / cd / stagger / slam / waves / return apply to every Form; back mirrors Colossus and Gale sweeps (Gale crescents too) and doubles Tempest rings; extra swings repeat spins (Colossus: +2 cracks each); spin applies to Cleave only.

## Q: Shield Charge (cd 7 s)

Rush 120 px over 0.28 s toward the cursor, untouchable. Foes the shield meets take 0.4×, are stunned 0.8 s and carried along (max 10; more are knocked aside). A boss or knockback-immune foe stops the charge. Impact at the end: blast ahead, dmg × (1 + 0.1 per carried foe, max 12), flings foes forward. Base 20 dmg (scales with weapon factor and party level).

| Level | Change |
|---|---|
| 2 | Longer charge, wider shield (180 px, width +12, carry 18) |
| 3 | Ends in a stunning shockwave (r 120, 0.8×, stun 1.2 s) |
| 4 | Shockwave hurls 8 shields |

## dps.js (20 s)

| build | form | crowd wpn | crowd q | single wpn | single q |
|---|---|---|---|---|---|
| base | - | 540 | 104 | 22 | 4 |
| p0 | - | 1,123 | 198 | 45 | 7 |
| p1 | - | 1,648 | 144 | 39 | 6 |
| p2 | - | 1,225 | 169 | 98 | 7 |
| all | - | 3,091 | 259 | 154 | 11 |
| f0 | colossus | 4,379 | 216 | 189 | 23 |
| f1 | whirlwind | 4,702 | 127 | 142 | 7 |
| f2 | gale | 3,542 | 126 | 180 | 7 |
| h0 | earthsplitter | 3,790 | 151 | 203 | 14 |
| h1 | tempest | 4,728 | 147 | 119 | 12 |
| F0 | colossus | 5,496 | 229 | 342 | 37 |
| F1 | whirlwind | 6,223 | 141 | 276 | 15 |
| F2 | gale | 6,080 | 286 | 444 | 13 |
| H0 | earthsplitter | 5,561 | 68 | 273 | 23 |
| H1 | tempest | 5,651 | 78 | 247 | 22 |

Q share of crowd damage: ~19% at base, 1–5% at Form builds (crowd foes die to the weapon first; the Q's dealt damage is capped by the HP it touches). Whirlwind's single number is standing still; moving spins 1.7× faster.
