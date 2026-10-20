# Wickdeep — Agent Kanban

## Todo
- After Perf A/B merge: overhead labels (hero names, DOWN/REVIVE, elite names) are 7 px world-space — make readable; minimap fits its panel to the floor bounds (cells small at 1440p) and the right column fades when the hero or a foe is under it; combined perf check at 2560 High: solo peak ≤ 4 ms, 4P peak ≤ 8 ms.
- User playtest 2, then PR `feat/wickdeep-rework` → `main` (merge commit).

## In-progress
- Perf B `fix/perf-draw-b` (wt-pb): enemy sprite cache, crowd LOD, FX text/glow, roundRect, Low without GPU.
- Balance `feat/balance-f2` (wt-bal): metrics (hits-to-kill, elite TTK, room time, DPS/stratum, damage share, CDR); fast trash (2–4 hits, elites 5–8 s, rooms 10–15 s, bosses 45–90 s, monotone HP curves); Storm arcs, CDR soft cap, Hemomancy cost by rank; Blood parity (gate spread ≤ 15); explore sweep peak 70–80% with Gloom ≥ 15% of damage when greedy; §10 targets (fresh smart 5–10%, winners 22–28 min); determinism.

## Done
- Prep refactor: build.js / skills.js / classboons.js split behind hooks.
- W1 paths/offers/evolutions · W2 statuses/damage · W3 skill 2/classes · W4 floors/rewards/lantern/dread · W5 enemies/AI/bosses · W6 WebGL post/lighting/tiles/fx.
- P2-A net v4/HUD/status visuals · P2-B rename/UI/save keys/README.
- W7 balance: World.THREAT, boss HP, XP, gold ×0.65, drain, Hearth steps; tools/simpool.js; smart-pick bot.
- F1: stealth last-seen targeting, telegraph stall/cancel, wind-up helper, vulnT, damage-based build-up, Cinder Arms on exploding weapons, client gloom-safe check, sim-time shards, burn level + vuln in snapshot v5, fixed 1/60 host step + render interpolation, FX pooling, dead code, stats.evo single source, hooks list. Bots: none 2% · mid 31% · max 73%, deterministic.
- F2-B pacing: EVO_AFFINITY 8, KEY_AFFINITY 4, level boon on even levels, boss epic only III/V, anvil odd strata, one shop build item, reward odds retuned. Median evolution stratum III. Bots: none 0% · mid 5% · max 33% (balance retunes).
- F2-C lantern: ROOM_COST 10/14/7 (first entry), drain ×4 slower, DREAD hp/wave 1 with elites +15/30/45%, gold ×1.5/2/2.5, reward upgrade 25/40% and Dark+ affix pool, Gloom hunter (8 s Dark, 3 s Lightless; 0.9× hero speed, 0.7 s wind-up lunge, touch 22% max HP), flare F (8 light, Gloom away 12 s, blind 1.5 s r160), oil +35 banishes, boss-door heal/shield/gold/embers, drain and Gloom delay paused during safe-room offers, N.VERSION 6. Explore sweep still monotone (more rooms = more wins): balance must fix.
- HUD: own `#hud` canvas at device resolution, u-scaled from style.css tokens; anchors hero bottom-left, party top-left, map + lantern top-right, xp bottom-centre, boss top-centre, messages above hero; key labels via `ED.Input.hint/fill`; sim sign strings carry `{action}` tokens.
- Juice: foe hit pose `F.xform` (lean/squash/crit pop) applied around `Sprites.enemy`, wind-up crouch + glow, element impact sprays, per-family death ghosts (cached snapshot), swing anticipation/smear/follow-through, emissive outlined pickups (XP mint diamond, gold coin), softer light falloff, layered hit/crit/die audio. Paint ops +<2%.
- F2-A sustain: SUSTAIN_CAP 1% max HP/s sliding window (`sustainHeal`) over leech, Blessed Strikes, hemorrhage, kill heals, feast, Sanguine steal, Judgment, Soul Siphon; Chalice +20 HP cap (1 per 4 kills); Gloom touch ≤ 25% max HP (GLOOM_CAP). Single sources ≤ +5 win points; Blood gate −12 vs random (balance fixes). Bots alone: none 1% · mid 22% · max 62%.
- Perf A: baked-sprite cache in render.js (16M px, lazy flipbook, bake budget 10/frame, dropped on resize) for tele rings/lines/cones, fire/poison, status overlays, projectiles, HP bars and labels; memoised U.rgba/hexToRgb/mix; High renders native up to 3.7 MP. Paint ops −71% solo peak, −75% at 80 foes; solo peak 7.1 → 5.1 ms, 80 foes 10.8 → 9.8 ms.
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
- 2026-10-21: F2-B, menus, F2-C merged; perf profiled. Bots (F1+F2-B+F2-C, smart, 384): none 10% · mid 33% · max 53%, fresh winners 37 min; deterministic. F2-A and wave 3a running.
