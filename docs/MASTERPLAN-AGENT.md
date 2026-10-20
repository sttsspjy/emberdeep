# Wickdeep — Agent Kanban

## Todo
- Wave 3a (after F2-A/F2-C merge, parallel, disjoint ownership):
  - HUD: redesign on the menu design tokens, scales with resolution, key labels via `ED.Input.label` (hud.js hardcodes K/L), flare indicator; rooms.js tutorial signs; GAME-DESIGN controls lines; `ui.js:42` stale `|| 3`/`|| 5` fallbacks.
  - Juice: impact splashes, hit reactions, attack/death animations, XP shards readable, softer lighting. Owns sprites.js, fx.js, post.js, render.js entity loop.
  - Perf A: zone telegraphs batched (one path per colour, spokes merged, cached fills), projectiles single pass + cached sprite per kind/colour, status overlays cached + LOD, overheads, `U.rgba` allocation, 4K dpr floor compare bug, High pixel cap 2.8 MP → native. Owns render.js drawZones/drawStatus/drawProjectiles/drawOverheads, util.js.
  - Balance (one worker, whole CPU): fast trash (regular foes 2–4 hits early, elites 5–8 s, normal rooms 10–15 s, softer hits), fresh smart 5–10%, then R7 power curve (DPS-per-stratum metric, IV→V spike, monotone HP curve, Storm arcs, CDR soft cap, Hemomancy cost by rank). Acceptance: GAME-DESIGN §10 (update fresh target), explore sweep peak 70–80% rooms, every sustain source ≤ +5 win points, party gate spread ≤ 15, determinism.
- Wave 3b (after Juice): Perf B: foe sprite cache (atlas by look/colours/pose/facing/quantized frames; prototype 12.4 → 5.9 ms at 80 foes), crowd LOD above ~30 foes (eye/rim glow, elite aura, HP bars only when hurt, particle cap), slash gradients precomputed, particle fills batched, `roundRect`. Targets at 2560 High: solo peak scene (20 foes, ~77 shots, 25 zones) mean ≤ 4 ms; 4-player peak (~52 foes, 96 shots, 68 zones) ≤ 8 ms; Low without GPU (SwiftShader) empty room ≤ 16 ms.
- User playtest 2, then PR `feat/wickdeep-rework` → `main` (merge commit).

## In-progress
- F2-A `fix/f2-sustain`: shared sustain cap (~0.5% max HP/s) over leech/steal/blessed/on-kill heals; each sustain source ≤ +5 win points; Gloom hit ≤ 25% max HP.
- F2-C `feat/f2-lantern`: per-room light cost on doors/map + small drain; dread adds elites/loot, not HP/waves; vision shrink ≤ 15%; Gloom hunter at Dark/Lightless (fast, telegraphed lunges); flare (F, 8 light) and oil (+35) drive it off; boss-door light reward; drain paused during party offers.

## Done
- Prep refactor: build.js / skills.js / classboons.js split behind hooks.
- W1 paths/offers/evolutions · W2 statuses/damage · W3 skill 2/classes · W4 floors/rewards/lantern/dread · W5 enemies/AI/bosses · W6 WebGL post/lighting/tiles/fx.
- P2-A net v4/HUD/status visuals · P2-B rename/UI/save keys/README.
- W7 balance: World.THREAT, boss HP, XP, gold ×0.65, drain, Hearth steps; tools/simpool.js; smart-pick bot.
- F1: stealth last-seen targeting, telegraph stall/cancel, wind-up helper, vulnT, damage-based build-up, Cinder Arms on exploding weapons, client gloom-safe check, sim-time shards, burn level + vuln in snapshot v5, fixed 1/60 host step + render interpolation, FX pooling, dead code, stats.evo single source, hooks list. Bots: none 2% · mid 31% · max 73%, deterministic.
- F2-B pacing: EVO_AFFINITY 8, KEY_AFFINITY 4, level boon on even levels, boss epic only III/V, anvil odd strata, one shop build item, reward odds retuned. Median evolution stratum III. Bots: none 0% · mid 5% · max 33% (balance retunes).
- Menus: design tokens in style.css (1u scales with viewport), title Descend/Hearth/Heroes/Settings, binding table `ED.Input.ACTIONS/DEFAULTS` + rebinding (skill1 Q/RMB, skill2 E, flare F) saved in settings.
- Perf profile (2560×1440, RTX 4070S, background bots running): cost = canvas draw ops rasterized in the GPU process (~34 paint + 82 state ops per foe); not sim (0.66 ms/step at 80 foes), resolution, post or lighting. Solo peak scene mean 7.9–9.0 ms, p95 22; 80 foes 12.3 ms (sprites 6.3–7.2, status 2.2–2.7, FX 1.5); at solo peak zones −2.7, projectiles −1.4, sprites −1.9. Harnesses: scratchpad `perf/` (bench, crowd.js, ablation switches).

## Decisions (user, 2026-10-20)
- Lantern: per-room cost; darkness = danger (elites, loot, Gloom hunter), no meat-loaf, no heavy vision loss. Evolution: affinity thresholds. Gloom: oil + flare dispel, damage cap. Difficulty: a veteran can win fresh (bots 5–10%). Old Emberdeep saves: ignore silently. Pacing: fast trash. Skills: Q/E + rebinding. UI: bold dark-fantasy, Hades-like readability. Finish via PR.
- Playtest 1 notes: damage numbers showed float noise (fixed); healing boons still must-picks; middle-mouse skill awkward; "visuals" means juicy feedback/animations, not lighting (sharp lighting hid XP shards); lag with many mobs at 1440p; HUD small/scattered, menus hard to read, tilted, overloaded; trash too slow to kill; lantern felt like an annoyance, Gloom not scary, refills too small.

## Known traps
- See CLAUDE.md "Known default traps".
- Bot results are seeded: same simpool command must print identical numbers.
- Working tree files are CRLF (autocrlf=true): edit with Edit/Write, not `sed -i`.
- Perf: measure canvas op counts (deterministic) plus interleaved A/B timing; background bot batches add ±1 ms noise. `texSubImage2D` main-thread time is GPU-process backpressure, not upload cost.

## Logs
- 2026-10-20: rework on `feat/wickdeep-rework`; W1–W7 + P2-A/B committed; handoff HANDOFF-2026-10-20.md.
- 2026-10-20 (PC 2): F1 merged; F2 mechanisms, menu redesign and perf profiling running in worktrees.
- 2026-10-21: F2-B and menus merged; perf profiled; F2-A/F2-C running.
