# Wickdeep — Agent Kanban

## Todo
- Wave 3 (after F2 mechanisms merge): HUD redesign on the menu design tokens (real key labels via `ED.Input.label`); visual feedback (impact splashes, hit reactions, death/attack animations, XP shards readable under lighting, softer lighting); perf fixes from the profiling report.
- Balance (one worker, whole CPU, after F2 merge): fast trash (regular foes 2–4 hits early, elites 5–8 s, normal rooms 10–15 s, softer hits), fresh smart 5–10%, then R7 power curve (DPS-per-stratum metric, IV→V spike, monotone HP curve, Storm arcs, CDR soft cap, Hemomancy cost by rank). Acceptance: GAME-DESIGN §10 (update fresh target), explore sweep peak 70–80% rooms, every sustain source ≤ +5 win points, party gate spread ≤ 15, determinism.
- User playtest 2, then PR `feat/wickdeep-rework` → `main` (merge commit).

## In-progress
- F2-A `fix/f2-sustain`: shared sustain cap (~0.5% max HP/s) over leech/steal/blessed/on-kill heals; each sustain source ≤ +5 win points; Gloom hit ≤ 25% max HP.
- F2-B `feat/f2-pacing`: EVO_AFFINITY ~8, KEY_AFFINITY 4–5, epic/forge offers halved, level boon every other level; median evolution stratum III–IV.
- F2-C `feat/f2-lantern`: per-room light cost on doors/map + small drain; dread adds elites/loot, not HP/waves; vision shrink ≤ 15%; Gloom hunter at Dark/Lightless (fast, telegraphed lunges); flare (F, 8 light) and oil (+35) drive it off; boss-door light reward; drain paused during party offers.
- `feat/ui-menus`: bold dark-fantasy menus, title = Descend/Hearth/Heroes/Settings, binding table + rebinding (skill1 RMB/Q, skill2 E, flare F), design tokens for the HUD.
- Perf profiling (read-only): crowds of 40–120 foes at 2560×1440.

## Done
- Prep refactor: build.js / skills.js / classboons.js split behind hooks.
- W1 paths/offers/evolutions · W2 statuses/damage · W3 skill 2/classes · W4 floors/rewards/lantern/dread · W5 enemies/AI/bosses · W6 WebGL post/lighting/tiles/fx.
- P2-A net v4/HUD/status visuals · P2-B rename/UI/save keys/README.
- W7 balance: World.THREAT, boss HP, XP, gold ×0.65, drain, Hearth steps; tools/simpool.js; smart-pick bot.
- F1: stealth last-seen targeting, telegraph stall/cancel, wind-up helper, vulnT, damage-based build-up, Cinder Arms on exploding weapons, client gloom-safe check, sim-time shards, burn level + vuln in snapshot v5, fixed 1/60 host step + render interpolation, FX pooling, dead code, stats.evo single source, hooks list. Bots: none 2% · mid 31% · max 73%, deterministic.

## Decisions (user, 2026-10-20)
- Lantern: per-room cost; darkness = danger (elites, loot, Gloom hunter), no meat-loaf, no heavy vision loss. Evolution: affinity thresholds. Gloom: oil + flare dispel, damage cap. Difficulty: a veteran can win fresh (bots 5–10%). Old Emberdeep saves: ignore silently. Pacing: fast trash. Skills: Q/E + rebinding. UI: bold dark-fantasy, Hades-like readability. Finish via PR.
- Playtest 1 notes: damage numbers showed float noise (fixed); healing boons still must-picks; middle-mouse skill awkward; "visuals" means juicy feedback/animations, not lighting (sharp lighting hid XP shards); lag with many mobs at 1440p; HUD small/scattered, menus hard to read, tilted, overloaded; trash too slow to kill; lantern felt like an annoyance, Gloom not scary, refills too small.

## Known traps
- See CLAUDE.md "Known default traps".
- Bot results are seeded: same simpool command must print identical numbers.
- Working tree files are CRLF (autocrlf=true): edit with Edit/Write, not `sed -i`.

## Logs
- 2026-10-20: rework on `feat/wickdeep-rework`; W1–W7 + P2-A/B committed; handoff HANDOFF-2026-10-20.md.
- 2026-10-20 (PC 2): F1 merged; F2 mechanisms, menu redesign and perf profiling running in worktrees.
