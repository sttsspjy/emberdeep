# Wickdeep — Agent Kanban

## Todo
- Dual review: opus + sonnet advisors, each does quality + soundness over `git diff d22d617..HEAD`; then Worker fix phase.
- Power curve check: boss HP 4.7k–145k, threat HP non-monotone → late player damage multiplicative?
- Balance out of band: mid room clear 21 s (25–40), elites 24–36 s (40–60), Bone Warden 49 s, rooms visited 87–91% (65–80), journey 4.08 h (2.5–4), fresh random depth 2.41.
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
