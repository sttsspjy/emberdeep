# Wickdeep — Agent Kanban

## v4 contracts (all advisors; change only by agreement)
- **Branches**: integration `feat/v4` (game-f1 merges). Each advisor works in its own worktree `../game-<area>` on `feat/v4-<area>` cut from `feat/v4`, merges into it (merge only). Branches that touch `combat.js` are cut after the spatial grid is merged.
- **Gate E1** (game-88: grid, bigger rooms, fodder, lantern → Dark doors, dash charges, crowd slow) lands before anyone tunes numbers; until then 6a and f1 build mechanics only.
- **Fodder** `e.fodder = true`: no heart, gold or per-kill relic/boon drops; drops XP motes summing to the room XP budget (6a sets it). Kill hooks: chains and explosions trigger (once per foe per chain id); refunds, shields and permanent stacks never do. Each owner guards its own hooks (path boons 6a, class hooks f1).
- **Dash**: `st.dashCharges = min(3, 1 + dashN)`, `st.dashCd = max(1.0, 1.5 × (1 − dashcdr))`, `CONST.DASH = {t: 0.15, speed: 480}`; untouchable for the whole dash. Sources: Light Step `dashN` +1/rank (max 2), Shadow Cloak `dashcdr` 1/3.
- **Fork ranks**: `W.grantForkRank(p)` auto-grants rank 2 at boss II and rank 3 at boss IV with a reveal card; the boss reward is unchanged; forge never ranks route or fork cards. Rank 2 = a visible new behaviour, rank 3 = a transform (new form, big number). Applies to all four routes.
- **Ascended**: rarity `a`, from stratum IV, a maxed boon's upgrade in its own multiplicative bucket; pinned to slot 1 when eligible.
- **Power budget** (`tools/sheet.js`, packs configurable): hero DPS ÷ threat-foe HP rises 15–25% per stratum IV→VI; fork parity (`node tools/sheet.js --parity`, mid build, mean of the one-foe and pack-of-4 columns): at IV with rank 2 every non-Guard fork +31.5–38.5% and every Guard ≥ +28%; at VI with rank 3 every non-Guard fork +54–66% and every Guard ≥ +48% plus ≥ +25% effective health or ≥ 30% control (stun column: stuns, plus slows, blinds and taunts at their strength); transforms favour pack damage so bosses stay a check. **Boss time to kill** (`tools/bal.js` smart `--vet`, `--runs=144` on the smart cell, the "boss time to kill by class" line): every hero within ±25% of the six-hero median at bosses II and IV; levers: weapons and attack routes 6a, skill numbers f1.
- **Difficulty** (user 2026-10-22): no-Hearth runs win rarely, and the gap comes from pick knowledge, not Hearth stats. Fresh random picks skill 0.75 ≤ 1%; fresh smart (min-max) picks + veteran preset 10–20%, deaths mostly at bosses IV–VI; Hearth gap (max − none, same policy) ≤ half the knowledge gap (smart − random, fresh). Smart picks must model synergies, so path design needs real synergies and traps.
- **Ownership**: game-88 encounters (world.js THREAT/encounter/lantern, rooms.js waves, dungeon.js, ai.js, bosses.js, combat.js grid, game.js dash/crowd slow, hud/render/tiles/input for its features, net.js fodder row, bot movement in tools/sim.js, GAME-DESIGN §6–8). game-6a build and meta (boons.js, relics.js, meta.js, save.js, build.js, stats.js except `skillNums`, classboons attack and element routes, hero base stats and weapons in classes.js, world.js relic functions, rooms.js reward and shop tables, camp/ui upgrades pages, bot pick scoring, GAME-DESIGN §1–4 and §9). game-f1 skills, audio, tools, integration (classboons skill routes, `ED.CAST` and skill hooks in class-*.js, `St.skillNums`, cls-*.js skill fx, audio.js, fx.js sound hooks, tools/bal.js, tools/browse.js, sim CLI and stage start, GAME-DESIGN §5 skills and §11, docs). `ROUTE_KEYS`: one line per advisor. sheet.js: each models its own cards.
- **Art**: branches edit only `tools/art-manifest.js` and `art-src/`; f1 regenerates `src/art/` once per integration (`node tools/art.js`, then `--check`). New effects prefer runtime `Pix.define` bakes.
- **Versions**: `N.VERSION` bumped by f1 at the mid build and the final build; `CODE_VERSION` 5 owned by 6a.
- **Testing**: agents never open a visible browser window (headless only, one reused browser); the user does the vsync fps check. Bot checks ≤ 3 min (`tools/bal.js`), one final confirm ≤ 15 min.

## Todo
- Next (priority order; HANDOFF-2026-10-23): Hearth rule (+10.0 vs 8.95; refunds before rank cuts) · Armory content · path payoff · boss melee windows, then take back melee EHP · deterministic Shade evasion · sheet model gaps from the audits (Bone Knights cleave, Death Blossom, Throw return, Volley pack, Burn double count, Contagion one-foe term, Siege reach) · in-class weapon spreads · bot co-op check.
- Carried over: dead `minionBurst` guard (`class-necro.js`, `combat.js`) · two Necromancers with Soul Command show no command stream · deeds are a 31-bit mask (a 32nd deed needs new profile storage) · aim banner for party clients · orphaned `simpool.js --worker` processes after a killed parent · Cleric Sacred Lantern ally shield gets its own allowance · optional key that opens the sheet on Map · DawnLike "Platino" sprite hidden somewhere.

## In-progress
- Playtest of v4 on main (user).

## Done
- v4 merged to `main` (2026-10-23): Phase 0–3 and the retune: bal.js, `--from`, `--vet`, browse.js · grid, rooms, hordes, fodder, dark rooms, dash charges, crowd slow, lead aim, volleys, breakables, boss fury IV–VI · Ascended, fork ranks, attack/element/skill transforms for all six heroes, Codex removed, Armory shell, refunds, save v5 · adaptive score, hit/kill/skill SFX, fury cue · all 48 forks in the parity bands · boss TTK band · IV–VI calibration (fury as the knowledge check) · Second Wind outside bosses, Purse card · melee hero EHP, Shadowstep grace.
- v3 merged to `main` (PR #2): art, paths, class routes, aim, Tab sheet, no life steal, save v4, Firefox perf, balance sign-off at `cd1074d`.
- v2 (live on main): paths, statuses, lantern rooms, UI, juice, perf, bot balance; see HANDOFF-2026-10-21.

## Decisions (user)
- 2026-10-20: evolution by affinity; fast trash; Q/E + rebinding; bold dark-fantasy UI, Hades-like readability. (Lantern rules of this date are superseded on 2026-10-22.)
- 2026-10-21: merge v2 to main without playtest 2.
- 2026-10-22 (v3): embedded pixel art, Firefox speed, no auto-aim, Tab sheet, class routes, six elements + General, no life steal, Knight Shield Throw.
- 2026-10-22 (playtest 3, all recommended options): lantern meter, room costs, Gloom and flare removed, 2 opt-in Dark doors per floor · ARPG hordes (about 40 kills per room at I to 120 at VI, ≤ 120 live) · rooms about 2× area with a scrolling camera, 9–10 rooms per floor, a win in 30–40 min · dash charges · crowds slow the hero (floor ×0.5) · fodder touch damage ≤ 3% max HP, untelegraphed · late power from Ascended boons, fork transforms (rank 2 and 3, auto-granted) and skill transforms, per hero and fork · about 32 boon picks per run · chains and explosions trigger on fodder, refunds, shields and stacks do not · Codex removed, non-element relics in the pool from the start, element relics become path boons, embers refunded · per-hero Armory of sidegrade unlocks inside Upgrades · free refunds and Reset all · small Hearth stats stay · dark-fantasy synth music per stratum with intensity layers and a boss theme · fodder shows only crits and summed numbers · breakable props · solo-first tuning, co-op bot-checked · mid playtest with Ranger and Knight complete · headless testing only.
- 2026-10-23: small Hearth (full Hearth adds at most half of what smart picks add; bal.js bands: fresh random <= 1%, fresh smart 10-20%, mid 12-24%, max 15-27%, pact 5 5-15%, every cell with --vet) · boss fury (soft enrage, visible on the boss bar) on the bosses of strata IV-VI only · v4 to main by 12:06 for an office playtest.

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
- 2026-10-23: v4 retune and release to main under a 3-hour deadline; handoff HANDOFF-2026-10-23.md.
