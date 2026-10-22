# Wickdeep — Agent Kanban

## Todo
- PR `feat/v3-overhaul` → `main` (merge commit) after the Firefox check; delete merged branches.
- Playtest 3 feedback (user) → triage first; it can reorder everything.
- Balance gaps after sign-off (priority, reason):
  1. Fresh-profile difficulty: fresh smart wins 1% (target 5–10%), fresh depth 4.6 (target 2.5–3.5). Reason: decision 2026-10-20 (a veteran can win fresh, bots 5–10%); depth above target with wins below target means an easy early game and a hard end. Needs a lever, then the two Fresh rows again.
  2. Party rows: three heroes half-upgraded win 42% (target 45–70%). Reason: only signed-off row below target besides Fresh.
  3. Guard-band precision: 5 of 12 Guard/Burst HP-lost ratios inside 0.60–0.85, bot noise ±0.15 at n = 20–48; needs about 60 runs per cell or `--routes` arms before any retune. Reason: current data cannot separate noise from fault.
  4. Ranger intake floor: forks lose 3.5–4.4% max HP per combat room (floor 4.5%). Reason: "no sustain by default" target.
  5. Zone budget: peak live zones per hero above 8 in some Pyromancer and Knight runs. Reason: perf cap in §10.
  6. Weapon arm: the index 1 and 2 weapon target (`--weapon=rotate`) is not measured. Reason: the ±15% weapon-versus-class-median target is untested for those weapons.
  7. Share-metric definition: decide whether route and weapon shares count direct damage only or all damage (statuses and procs), then align `sim.js`, `sheet.js` and §10. Reason: the ≥ 8 and ≥ 6 point route targets read differently by definition.
  8. `sheet.js` does not model Bone Knight ×2, Shield Orbit stun, Flurry or Scattershot slow. Reason: the sheet and `tools/sheet.js` numbers omit those effects.
  9. Dead `minionBurst` guard (`class-necro.js`, `combat.js`): no code emits that kind. Reason: remove or wire it.
  10. Two Necromancers with Soul Command show no command stream (the wire has no Hex owner). Reason: co-op readability.
- Deeds are a 31-bit mask in profile storage and decode (`1 << i`, load clamps to 2^31 − 1): a 32nd deed resets every deed on reload and needs new profile storage; the save code's 6-bit deed count holds 63, so no `CODE_VERSION` bump (26 today).
- Aim banner for party clients on their first descent (host-solo tutorial signs only).
- Tooling: killed `simpool.js` parents have left orphaned `--worker` processes (not re-checked since the priority change).
- Unverified by a human: sound mix, presentation above 100 Hz.

## In-progress
- Firefox perf verification of the v3 renderer: frame times in Firefox and Chromium, solo and 4 players, 80 foes, 2560 High; v2 reference in HANDOFF-2026-10-21 (solo peak 3.7 ms, 4P 6.9 ms, 80 foes 4.0 ms). The result goes here.

## Done
- Phase 3b balance signed off at `cd1074d` (skill 0.75; GAME-DESIGN §10 holds every number): class routes, hero base stats, threat damage V and VI, party foe HP `1 + 0.85n + 0.3n(n−1)`.
- Phase 3a render review fixes: hit flash never from DoT ticks, boss flash as a 50% overlay, wind-up outline always visible, damage numbers summed and stacked, boss bar fades like a panel.
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
- `Atlas.anim(id)` caches a miss once the art pages have decoded; `Pix.define` drops the cached record of the id it registers (`Atlas.forget`).
- `simpool.js` runs at normal priority; `--nice` (idle priority) crawls on an unattended Windows machine.
- `ED.ClassFx.shot[kind]` returns true to replace the projectile body; false or nothing decorates it.
- Bot cost: small batches, one final confirm (user hates long bot runs).

## Logs
- 2026-10-20: rework on `feat/wickdeep-rework`; W1–W7 + P2-A/B.
- 2026-10-21: F1, F2 (pacing, sustain, lantern), UI, juice, perf, balance merged; v2 PR to main; handoff HANDOFF-2026-10-21.md.
- 2026-10-22: v3 overhaul on `feat/v3-overhaul` (art, paths, classes, aim, sheet, save v4, review fixes); docs pass; balance signed off at `cd1074d`, render fixes merged, Firefox check open; handoff HANDOFF-2026-10-22.md.
