# Wickdeep — Kanban (agents)

Rules/numbers: GAME-DESIGN.md. Code contract: ARCHITECTURE.md (change it with the code). Legacy: tag `legacy-wickdeep`.

## Todo (lanes; branch from the foundation commit, own files only)
- gl: `src/client/gl.js` WebGL path of ED.Batch (instanced quads, one draw per page/blend), same API as the Canvas2D path; crowd900 p95 ≤ 8 ms.
- juice: `src/client/fx.js` hit-stop, death bursts, flashes, rings; ED.WeaponFx/SkillFx draw hooks.
- horde: `src/sim/ai.js` brains ranged/exploder/brute (fall back to chaser now), `src/data/foes.js`, `src/data/stages.js` timelines, `src/sim/spawner.js` events.
- weapons-a: `src/weapons/general-a.js` 6 general weapons + evolutions (stub now).
- weapons-b: `src/weapons/general-b.js` 6 general weapons + evolutions (stub now).
- heroes-1: `src/heroes/{knight,ranger,pyro,necro}.js` — knight/ranger done; pyro/necro placeholders, evolutions inferno/bonestorm undefined.
- heroes-2: `src/heroes/{cleric,shade,bell}.js` placeholders; evolutions wrath/shadowfan/cathedral undefined.
- progression: `src/sim/progress.js`, `src/data/passives.js`, `src/data/meta.js`, `src/save.js` (unlock flow, shop UI data, CODE_VERSION append-only).
- bosses: `src/sim/boss-<id>.js` × 7 (placeholder runner now); cyclops/samurai/twins art missing.
- net: `src/net.js` binary snapshots (ED.Net.encodeSnap/decodeSnap are null), interest culling, client prediction in `src/game.js`, lobby UI, `tools/check-net.js`.
- ui: `src/client/hud.js`, `src/client/ui.js`, `index.html`, `style.css` (icon scale, lobby, unlock toasts).
- audio: `src/client/audio.js` cue names still legacy; `src/client/music.js` stub.
- art: `tools/art-manifest.js` + `art-src/` (foe recolour per stage, boss sheets, weapon icons); `node tools/art.js --check`.
- tools: bot driver for balance (`tools/sim.js` load()), browse.js scenarios.

## In progress

## Done
- Foundation: wipe + core sim, solo playable, check-sim / check-perf / browse smoke pass.

## Known traps
- Sim/data/heroes/weapons/save run in Node: no DOM, no Math.random/Date.now; use w.rng.
- Script order twice: index.html and tools/sim.js FILES.
- Pooled entities are reused under new ids: holders keep object + id and compare.
- w.target facing/around/densest return the shared scratch w.pt: copy before the next call.
- Foe telegraphs: team 1 warn zones, dur ≥ 0.6 s (forced).
- 1 art px = 1 world px (Atlas K = 1); view 640×360 integer-scaled.
- CLAUDE.md file map and traps still describe the legacy dungeon game.

## Logs
- 2026-10-27 foundation committed on feat/survivors.
