# Wickdeep — Kanban (agents)

Rules/numbers: GAME-DESIGN.md. Code contract: ARCHITECTURE.md (change it with the code). Legacy: tag `legacy-wickdeep`.

## Todo
- balance: untuned (bot runs via tools/simpool / bal not ported yet); single-target weapons (wisp, daggers) far below area weapons; Multishot gives nothing at levels 1/3/5 (design call).
- art: per-stage foe recolours; Q/E skill icons; twins borrow skelknight art.
- net: real PeerJS over a real network untested (only BroadcastChannel + fake transport).
- audio: no per-attack boss cues (ED.Audio.def / play).
- render: floor is baked chunk canvases (no GPU-tiled floor); Canvas2D ignores tint.
- co-op: no visual substitute for hit-stop; host-only motion shows ~0.1 s late on clients.

## In progress

## Done
- Foundation: wipe + core sim, solo playable, check-sim / check-perf / browse smoke pass.
- 15 lanes merged (gl, juice, horde, wpn-a, wpn-b, heroes-a, heroes-b, progress, bosses-a, bosses-b, net, ui, audio, art, tools); co-op runs start from the lobby UI.

## Known traps
- Sim/data/heroes/weapons/save run in Node: no DOM, no Math.random/Date.now; use w.rng.
- Script order twice: index.html and tools/sim.js FILES.
- Pooled entities are reused under new ids: holders keep object + id and compare.
- w.target facing/around/densest return the shared scratch w.pt: copy before the next call.
- Foe telegraphs: team 1 warn zones, dur ≥ 0.6 s (forced).
- 1 art px = 1 world px (Atlas K = 1); view 640×360 integer-scaled.
- Weapon def.icon is forced to icon.w.<id> (cards / HUD); def.held keeps the in-hand sprite.
- Wire change (snapshot, input, look / weapon registration order) bumps ED.NET_VERSION.

## Logs
- 2026-10-27 foundation committed on feat/survivors.
- 2026-10-28 all lanes merged into feat/survivors; integration fixes (UI ↔ Net lobby / ED.Save, art ids, banish wire, boss bar on the wire).
