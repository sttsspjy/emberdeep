# Wickdeep — Kanban (agents)

Rules/numbers: GAME-DESIGN.md. Code contract: ARCHITECTURE.md (change it with the code). Legacy: tag `legacy-wickdeep`.

## Todo
- perf (high): Canvas2D late game over gate: `browse.js late[a|b|c] --software --gate` Render.frame p95 5.2–6.5 ms > 4 ms; `--quality=low` no gain (6.4 ms). GPU path 0.5–0.7 ms.
- spawn (med): density floor x3 not enough vs strong builds: shots at 8:00 show 35–279 alive vs floor ~340 (bell 35). Needs user call (higher boost / acc cap 10 / pack spawns).
- balance: untuned, numbers from GAME-DESIGN + user playtest only (no bot batches).
- net: real PeerJS over a real network untested (only BroadcastChannel + fake transport).
- art: per-stage foe recolours; Q/E skill icons; twins (skelknight), weaver (riftcaller), wickeater (horror) borrow foe art.
- ui (low): evolution popup covers the boss name banner when both fire together.
- mode: Waves mode planned, no rules yet (ask user).
- audio: no per-attack boss cues.
- co-op: no visual substitute for hit-stop; host-only motion shows ~0.1 s late on clients.

## In progress

## Done
- Foundation: core sim, solo playable.
- 15 lanes merged; co-op runs start from the lobby UI.
- Fix round 2026-10-28: facing aim cone + weapon kill callbacks; stronger evolutions (stormcrown, twinmoons, choir, barrage); density floor; stage 3 bosses weaver + wickeater; spawn-once zones (NET_VERSION 4); hit-flash throttle, zone fade + Canvas2D zone LOD, hero markers, co-op slot palettes; phase banner number.

## Known traps
- Sim/data/heroes/weapons/save run in Node: no DOM, no Math.random/Date.now; use w.rng.
- Script order twice: index.html and tools/sim.js FILES.
- Pooled entities are reused under new ids: holders keep object + id and compare.
- w.target facing/around/densest return the shared scratch w.pt: copy before the next call.
- Foe telegraphs: team 1 warn zones, dur ≥ 0.6 s (forced).
- 1 art px = 1 world px (Atlas K = 1); view 640×360 integer-scaled.
- Weapon def.icon is forced to icon.w.<id> (cards / HUD); def.held keeps the in-hand sprite.
- Wire change (snapshot, input, look / weapon registration order) bumps ED.NET_VERSION.
- Zones are spawn-once per client (cc.zc): every encoded snapshot must reach that client's Mirror.
- Boss draw hooks read ED.Actors.hitFlash(e), not e.flash; headless checks stub ED.Actors.
- Kill effects tied to a weapon go in impl.kill (any holder), not ED.HOOK[cls].kill.
- Facing weapons aim with w.facingAim / w.coneFoe (ED.FACING_CONE).

## Logs
- 2026-10-27 foundation committed on feat/survivors.
- 2026-10-28 all lanes merged; integration fixes; fix round committed (6 commits); all Node checks, art --check, browse smoke/shots/coop/crowd900 (GPU + software), late gates GPU pass; late gates software fail.
