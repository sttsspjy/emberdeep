# Wickdeep — Agent Kanban

## Todo
- Playtest 2 feedback (user) → triage first; it can reorder everything below.
- Fresh profile: bots 2% vs 5–10% target; deaths spread III–V, numeric levers < 3 points each → needs a design lever (early power step) or a human-skill check.
- Hero spread (half-upgraded): Shade 20%, Necromancer 23% vs Ranger 45%.
- Winning descent 19–23 min vs 22–28 target (rooms quick): more content per stratum or new target (ask user).
- Weapon share < 30% for Pyre 25 / Steel 27 / Spirit 20 / Storm 23 (combust and companions carry).
- HUD: Deep stack and Gloom count need snapshot fields (+ `N.VERSION` bump).
- Untested: client path for flare, juice `foeAt` on mirror, sign tokens on clients, new sounds, one-frame delayed upload above 100 Hz.
- Perf headroom: atlas pages for baked sprites (−30–45% per drawImage), light pools batched by colour.

## In-progress
- (none)

## Done
- Prep refactor, W1–W7, P2-A/B: paths/evolutions, statuses, skill 2, floors/rewards/lantern, enemies/bosses, WebGL post, rename, bots.
- F1: stealth last-seen targeting, telegraph stall/cancel, damage-based build-up, fixed 1/60 host step + render interpolation (players excluded), FX pooling, stats.evo single source.
- Build pacing: EVO_AFFINITY 8, KEY_AFFINITY 4, level boon on even levels, fewer epic/forge offers; median evolution stratum III.
- Sustain: `W.sustainHeal` sliding window, `SUSTAIN_CAP` 0.3% max HP/s over hit/kill heals; Gloom touch ≤ 25% max HP.
- Lantern: ROOM_COST 12/17/8 on first entry, slow drain, strata I–III lantern ×1.3/1.2/1.1; dark tiers add foe damage ×1.1/1.6/2.3, elites, healing ×0.7/0.5, reward upgrades, gold — never foe HP; Deep stack +0.28 dmg per new dark room (≤ 5); Gloom hunter (Dark 8 s, Lightless 3 s, 1–3 Glooms); flare F (6 light) / oil banish; boss-door heal + shield. Explore sweep peaks at 81% rooms.
- Balance: monotone foe/boss HP; 2.5–3.8 hits per regular foe, elites 4–6 s, rooms ~14 s, bosses 45–75 s; `ARC_MUL`/`SPLASH_MUL` 0.6, `Stats.cdrEff` soft cap, Hemomancy 4% HP per rank, Blood damage + bleed on hit, Sanctuary 7% + 15% DR, hero HP ×1.08. Bots: fresh 2 · half 34 · full 71 · Pact 5 28 · 2P 55 · 3P 56%; gate spread 8; sustain sources ≤ +5.
- UI: design tokens (style.css), menus Descend/Hearth/Heroes/Settings, binding table + rebinding, `#hud` canvas with fixed anchors, panel fade, stacked overhead labels, `{action}` sign tokens.
- Juice: `FX.xform` hit pose, impact sprays, death ghosts, swing smear, emissive pickups, softer light falloff, layered hit audio.
- Perf: baked sprites (telegraphs, statuses, projectiles, bars, labels), enemy flipbooks `Sprites.FOE`, crowd LOD > 30 foes, delayed world upload above ~100 Hz, `Post.soft`. 2560 High: solo peak 3.7 ms, 4P peak 6.9 ms, 80 foes 4.0 ms.
- PR `feat/wickdeep-rework` → `main` (merge commit); live on GitHub Pages.

## Decisions (user)
- 2026-10-20: lantern per-room cost; darkness = danger (elites, loot, Gloom hunter), no meat-loaf, no heavy vision loss. Evolution by affinity. Gloom: oil + flare, damage cap. A veteran can win fresh (bots 5–10%). Old Emberdeep saves ignored. Fast trash. Q/E + rebinding. Bold dark-fantasy UI, Hades-like readability.
- 2026-10-21: merge to main without playtest 2.
- Playtest 1 notes: healing must-picks; middle-mouse skill awkward; "visuals" = feedback/animations, not lighting; lag with crowds at 1440p; HUD small/scattered, menus overloaded; trash too slow; lantern an annoyance, Gloom not scary.

## Known traps
- See CLAUDE.md "Known default traps".
- Bot results are seeded: same simpool command must print identical numbers (also across `--jobs`).
- Working tree files are CRLF (autocrlf=true): edit with Edit/Write, not `sed -i`.
- Perf: measure canvas op counts (deterministic) plus interleaved A/B timing; background bot batches add ±1 ms noise. `texSubImage2D` main-thread time is GPU-process backpressure.
- Darkness must never add foe HP (user rejected meat-loaf trash).

## Logs
- 2026-10-20: rework on `feat/wickdeep-rework`; W1–W7 + P2-A/B.
- 2026-10-21: F1, F2 (pacing, sustain, lantern), UI, juice, perf, balance merged; PR to main; handoff HANDOFF-2026-10-21.md.
