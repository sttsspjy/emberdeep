# Wickdeep — Agent Kanban

## Todo
- Fix phase F1 (FA sim bugs, FB client and net, FC cleanup and docs), then F2 design and balance after user answers. Plan: HANDOFF-2026-10-20.md.
- F2 balance acceptance: §10 table, explore sweep peak 70–80% rooms, forced leech ≤ +5, party gate spread ≤15.
- User playtest, then merge to main.

## In-progress
- (none)

## Done
- Prep refactor: build.js / skills.js / classboons.js split behind hooks.
- W1 paths/offers/evolutions · W2 statuses/damage · W3 skill 2/classes · W4 floors/rewards/lantern/dread · W5 enemies/AI/bosses · W6 WebGL post/lighting/tiles/fx.
- P2-A net v4/HUD/status visuals · P2-B rename/UI/save keys/README.
- W7 balance: World.THREAT, boss HP, XP, gold ×0.65, drain, Hearth steps; tools/simpool.js; smart-pick bot.

## Known traps
- See CLAUDE.md "Known default traps".
- Bot results are seeded: same simpool command must print identical numbers.

## Logs
- 2026-10-20: rework on `feat/wickdeep-rework`; W1–W7 + P2-A/B committed; handoff HANDOFF-2026-10-20.md.
