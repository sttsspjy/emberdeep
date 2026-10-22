# Wickdeep — Agent Kanban

## Todo
- Sign-off batch after Phase 3b: `node tools/simpool.js 1 384 0.75 none,mid,max --pick=smart` (one invocation); fill the "Measured" column of GAME-DESIGN §10 (every cell says pending sign-off).
- Firefox perf verification of the v3 renderer: frame times in Firefox and Chromium, solo and 4 players, 80 foes, 2560 High; v2 reference in HANDOFF-2026-10-21 (solo peak 3.7 ms, 4P 6.9 ms, 80 foes 4.0 ms).
- PR `feat/v3-overhaul` → `main` (merge commit) after sign-off and the render fixes; delete merged branches.
- Playtest 3 feedback (user) → triage first; it can reorder everything.
- Re-check after Phase 3b (open in the last worker reports): Guard forks lose too much HP versus Burst siblings (Veil of Night 0.92, Bone Armor 0.99–1.04, Pyromancer Guard forks 0.99–1.02 against 0.60–0.85); attack-route weapon-share target for crit and Momentum cards; Open Veins is the weakest Shade fork; Ember Rush and Magma Heart rarely reach full Channel in bot fights.
- Deeds are a 32-bit mask: a 33rd deed needs new storage and a `CODE_VERSION` bump (26 today).
- Aim banner for party clients on their first descent (host-solo tutorial signs only).
- Tooling: `simpool.js` workers run at idle priority and starve under CPU load; killed parents leave orphaned `--worker` processes.
- Unverified by a human: sound mix, presentation above 100 Hz.

## In-progress
- Phase 3b balance: class workers (routes, forks, weapons) and the global worker (threat, curves) retune numbers; GAME-DESIGN numbers follow their commits.
- Render review fixes. Open at HEAD: the hit-flash silhouette (`e.flash`, set by every hit including Burn and Bleed ticks) hides the red wind-up outline on foes and bosses (`actors.js`).

## Done
- v2 (live on main): paths, statuses, lantern rooms, UI, juice, perf, bot balance; see HANDOFF-2026-10-21.
- v3 art: `art-src/` → `tools/art.js` + `art-manifest.js` → `src/art/*.js` data URIs; `atlas.js` (ED.Bmp, ED.Atlas), `actors.js`, `pixfx.js`, `tiles.js`; per-class `cls-*.js` on the `ED.ClassFx` registry; Credits screen; `art.js --check`.
- v3 paths: Fire, Ice, Lightning, Poison, Holy, Shadow + General; `MAX_ELEMENTS` 2; keystone 5 (General 6), evolution 10 (12), duo 4; 15 duos; chain queue; `moveStatuses`; Generalist forsakes elements and element relics.
- v3 defence: no life steal; `addShield` window (class 3%, all 6% per 10 s); Knight Shield Throw replaces Bulwark; damage-taken floor `DR_FLOOR`.
- v3 classes: `classboons.js` (72 route cards), class offers (level 3 route, bosses I, II, IV fork and ranks), `ED.forkWeapon` (Heavy and Swift), `class-*.js` (`ED.CAST`, `ED.CLS`), skill parts in `ED.SKILLS` + `Stats.skillNums` as the one source for sim, sheet and bots.
- v3 aim: mouse-only, `Sim.groundPoint`, `aim.js`, pad right stick, Settings cursor options.
- v3 sheet: `sim/sheet.js` model, `client/sheetui.js`, source-breakdown stats (`Stats.sources`), `tools/sheet.js`, `sheet-check.js`.
- v3 lantern: passive drain removed; rooms and flares spend light.
- v3 Firefox work: low-res world buffer, sharp-bilinear GL upscale, ImageBitmap caches, HUD dirty redraw, frame cap setting.
- v3 save and net: `CODE_VERSION` 4 (count-prefixed lists), "The Deep has changed" notice, `N.VERSION` 7.
- v3 tools: `check-*.js` regression checks, bot flags `--route --fork --weapon --start --gates --force --mastery --out --pair`, `mid` and `max` presets carry Codex relics.
- Phase 3a review fixes (sim, save, net, ux) merged into `feat/v3-overhaul`.

## Decisions (user)
- 2026-10-20: lantern per-room cost; darkness = danger (elites, loot, Gloom hunter), no meat-loaf, no heavy vision loss. Evolution by affinity. Gloom: oil + flare, damage cap. A veteran can win fresh (bots 5–10%). Old Emberdeep saves ignored. Fast trash. Q/E + rebinding. Bold dark-fantasy UI, Hades-like readability.
- 2026-10-21: merge v2 to main without playtest 2.
- 2026-10-22: v3 asks: embedded pixel art, no passive lantern drain, Firefox speed, no auto-aim, Tab sheet, class routes, Fire/Ice/Lightning/Poison/Holy/Shadow + General, no life steal, Knight Shield Throw; deliver to main when everything is done.

## Known traps
- See CLAUDE.md "Known default traps".
- Bot results are seeded: the same simpool command prints identical numbers (also across `--jobs`). `mid` and `max` now include Codex relics, so pre-v3 baselines no longer compare.
- Working tree files are CRLF (autocrlf=true): edit with Edit/Write, not `sed -i`; check with `git ls-files --eol`.
- Perf: measure canvas op counts (deterministic) plus interleaved A/B timing; background bot batches add ±1 ms noise.
- Darkness must never add foe HP (user rejected meat-loaf trash).
- Class cards: a shield card is bounded by the class window (3% per 10 s); card text must not promise more.
- `Atlas.anim(id)` caches null for an id probed before `Pix.define` registers it: define baked anims before any probe.
- `ED.ClassFx.shot[kind]` returns true to replace the projectile body; false or nothing decorates it.
- Bot cost: small batches, one final confirm (user hates long bot runs).

## Logs
- 2026-10-20: rework on `feat/wickdeep-rework`; W1–W7 + P2-A/B.
- 2026-10-21: F1, F2 (pacing, sustain, lantern), UI, juice, perf, balance merged; v2 PR to main; handoff HANDOFF-2026-10-21.md.
- 2026-10-22: v3 overhaul on `feat/v3-overhaul` (art, paths, classes, aim, sheet, save v4, review fixes); docs pass; balance pending; handoff HANDOFF-2026-10-22.md.
