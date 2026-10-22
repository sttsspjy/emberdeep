# Wickdeep — Agent Kanban

## v4 contracts (all advisors; change only by agreement)
- **Branches**: integration `feat/v4` (game-f1 merges). Each advisor works in its own worktree `../game-<area>` on `feat/v4-<area>` cut from `feat/v4`, merges into it (merge only). Branches that touch `combat.js` are cut after the spatial grid is merged.
- **Gate E1** (game-88: grid, bigger rooms, fodder, lantern → Dark doors, dash charges, crowd slow) lands before anyone tunes numbers; until then 6a and f1 build mechanics only.
- **Fodder** `e.fodder = true`: no heart, gold or per-kill relic/boon drops; drops XP motes summing to the room XP budget (6a sets it). Kill hooks: chains and explosions trigger (once per foe per chain id); refunds, shields and permanent stacks never do. Each owner guards its own hooks (path boons 6a, class hooks f1).
- **Dash**: `st.dashCharges` (1, cap 3), `st.dashCd` (recharge per charge 1.5 s, floor 1.0), `CONST.DASH = {t: 0.15, speed: 480}`; untouchable for the whole dash. E1 sets the base; 6a turns `dashcdr` sources into charges.
- **Fork ranks**: `W.grantForkRank(p)` auto-grants rank 2 at boss II and rank 3 at boss IV with a reveal card; the boss reward is unchanged; forge never ranks route or fork cards. Rank 2 = a visible new behaviour, rank 3 = a transform (new form, big number). Applies to all four routes.
- **Ascended**: rarity `a`, from stratum IV, a maxed boon's upgrade in its own multiplicative bucket; pinned to slot 1 when eligible.
- **Power budget** (`tools/sheet.js`, packs configurable): hero DPS ÷ threat-foe HP rises 15–25% per stratum IV→VI; at IV and VI every non-Guard fork is within ±10% of the class route median hero damage (sheet `--routes`, mid build, mean of one foe and pack), and every Guard fork reaches ≥ 80% of that median plus ≥ +25% effective health; transforms favour pack damage so bosses stay a check. Fork targets before parity: rank 2 ≈ +35%, rank 3 ≈ +60%.
- **Difficulty** (user 2026-10-22): no-Hearth runs win rarely, and the gap comes from pick knowledge, not Hearth stats. Fresh random picks skill 0.75 ≤ 1%; fresh smart (min-max) picks + veteran preset 10–20%, deaths mostly at bosses IV–VI; Hearth gap (max − none, same policy) ≤ half the knowledge gap (smart − random, fresh). Smart picks must model synergies, so path design needs real synergies and traps.
- **Ownership**: game-88 encounters (world.js THREAT/encounter/lantern, rooms.js waves, dungeon.js, ai.js, bosses.js, combat.js grid, game.js dash/crowd slow, hud/render/tiles/input for its features, net.js fodder row, bot movement in tools/sim.js, GAME-DESIGN §6–8). game-6a build and meta (boons.js, relics.js, meta.js, save.js, build.js, stats.js except `skillNums`, classboons attack and element routes, world.js relic functions, rooms.js reward and shop tables, camp/ui upgrades pages, bot pick scoring, GAME-DESIGN §1–4 and §9). game-f1 skills, audio, tools, integration (classboons skill routes, `ED.CAST` and skill hooks in class-*.js, `St.skillNums`, cls-*.js skill fx, audio.js, fx.js sound hooks, tools/bal.js, tools/browse.js, sim CLI and stage start, GAME-DESIGN §5 skills and §11, docs). `ROUTE_KEYS`: one line per advisor. sheet.js: each models its own cards.
- **Art**: branches edit only `tools/art-manifest.js` and `art-src/`; f1 regenerates `src/art/` once per integration (`node tools/art.js`, then `--check`). New effects prefer runtime `Pix.define` bakes.
- **Versions**: `N.VERSION` bumped by f1 at the mid build and the final build; `CODE_VERSION` 5 owned by 6a.
- **Testing**: agents never open a visible browser window (headless only, one reused browser); the user does the vsync fps check. Bot checks ≤ 3 min (`tools/bal.js`), one final confirm ≤ 15 min.

## Todo
- Phase 0: spatial foe grid + headless perf gate 150 foes ≤ 4 ms per frame (88) · bot pick scoring by marginal value with synergies, re-baseline (6a) · `tools/bal.js`, stage start `--from=N`, `tools/browse.js`, harness speed (f1).
- Phase 1: E1 (88) · Ascended, fork-rank grant, attack and element transforms, pool hygiene, Codex → Armory, refunds, save v5 (6a) · skill transforms and skill numbers, skill and kill SFX with a voice cap, per-stratum adaptive music (f1). Ranger and Knight first.
- Phase 2: stratum behaviour (lead aim, speeds, mixed rosters, two-affix elites) and bosses (fast aimed volleys, phase 3 overlap, party scaling) (88) · retune with `tools/bal.js` (all) · mid playtest build, Ranger and Knight complete.
- Phase 3: transforms for the other four heroes · breakable props, small heart (88) · bot co-op check · one final confirm · docs, README, PR to `main`.
- Carried over: dead `minionBurst` guard (`class-necro.js`, `combat.js`) · two Necromancers with Soul Command show no command stream · deeds are a 31-bit mask (a 32nd deed needs new profile storage) · aim banner for party clients · orphaned `simpool.js --worker` processes after a killed parent · Cleric Sacred Lantern ally shield gets its own allowance · optional key that opens the sheet on Map · DawnLike "Platino" sprite hidden somewhere.

## In-progress
- v4 Phase 0.

## Done
- v3 merged to `main` (PR #2): art, paths, class routes, aim, Tab sheet, no life steal, save v4, Firefox perf, balance sign-off at `cd1074d`.
- v2 (live on main): paths, statuses, lantern rooms, UI, juice, perf, bot balance; see HANDOFF-2026-10-21.

## Decisions (user)
- 2026-10-20: evolution by affinity; fast trash; Q/E + rebinding; bold dark-fantasy UI, Hades-like readability. (Lantern rules of this date are superseded on 2026-10-22.)
- 2026-10-21: merge v2 to main without playtest 2.
- 2026-10-22 (v3): embedded pixel art, Firefox speed, no auto-aim, Tab sheet, class routes, six elements + General, no life steal, Knight Shield Throw.
- 2026-10-22 (playtest 3, all recommended options): lantern meter, room costs, Gloom and flare removed, 2 opt-in Dark doors per floor · ARPG hordes (about 40 kills per room at I to 120 at VI, ≤ 120 live) · rooms about 2× area with a scrolling camera, 9–10 rooms per floor, a win in 30–40 min · dash charges · crowds slow the hero (floor ×0.5) · fodder touch damage ≤ 3% max HP, untelegraphed · late power from Ascended boons, fork transforms (rank 2 and 3, auto-granted) and skill transforms, per hero and fork · about 32 boon picks per run · chains and explosions trigger on fodder, refunds, shields and stacks do not · Codex removed, non-element relics in the pool from the start, element relics become path boons, embers refunded · per-hero Armory of sidegrade unlocks inside Upgrades · free refunds and Reset all · small Hearth stats stay · dark-fantasy synth music per stratum with intensity layers and a boss theme · fodder shows only crits and summed numbers · breakable props · solo-first tuning, co-op bot-checked · mid playtest with Ranger and Knight complete · headless testing only.

## Known traps
- See CLAUDE.md "Known default traps".
- Bot results are seeded: the same simpool command prints identical numbers (also across `--jobs`).
- Bots under-model a human: the v3 smart bot never took Split Shot (scored below Vigor), so v3 §10 rows measured a crippled projectile build.
- Working tree files are CRLF (autocrlf=true): edit with Edit/Write, not `sed -i`; check with `git ls-files --eol`.
- Perf: measure canvas op counts (deterministic) plus interleaved A/B timing; background bot batches add ±1 ms noise.
- Class cards: a shield card is bounded by the class window (3% per 10 s); card text must not promise more.
- `Atlas.anim(id)` caches a miss once the art pages have decoded; `Pix.define` drops the cached record of the id it registers (`Atlas.forget`).
- `simpool.js` runs at normal priority; `--nice` (idle priority) crawls on an unattended Windows machine.
- `ED.ClassFx.shot[kind]` returns true to replace the projectile body; false or nothing decorates it.
- Bot cost: small batches, one final confirm (user hates long bot runs).

## Logs
- 2026-10-20: rework on `feat/wickdeep-rework`; W1–W7 + P2-A/B.
- 2026-10-21: F1, F2 (pacing, sustain, lantern), UI, juice, perf, balance merged; v2 PR to main; handoff HANDOFF-2026-10-21.md.
- 2026-10-22: v3 overhaul merged to main (PR #2); handoff HANDOFF-2026-10-22.md.
- 2026-10-22: playtest 3 triage by three advisors (f1, 6a, 88); v4 on `feat/v4`.
