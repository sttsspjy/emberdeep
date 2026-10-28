# Wickdeep — Kanban (agents)

Rules/numbers: GAME-DESIGN.md. Code contract: ARCHITECTURE.md (change it with the code). Legacy: tag `legacy-wickdeep`.

## Todo
- balance: untuned; numbers from GAME-DESIGN, user playtests and tools/bench.js bot runs.
- net: real PeerJS over a real network untested (only BroadcastChannel + fake transport).
- art: per-stage foe recolours; Q/E skill icons; twins (skelknight), weaver (riftcaller), wickeater (horror) borrow foe art.
- ui (low): evolution popup covers the boss name banner when both fire together.
- mode: Waves mode (round + shop) on the same core; rules not written yet.
- audio: no per-attack boss cues.
- co-op: no visual substitute for hit-stop; host-only motion shows ~0.1 s late on clients.
- ui: gamepad does not drive DOM menus (Input.read pad nav unused outside runs).
- balance: Censer / Lanterns weak, Chain Spark strong (bench full-v2); skill 1 wins ~100% stages 0–1.
- bot: lanterns ring band / toll swing approximated; facing projectiles don't steer to the boss.
- codex: boss attack lines are a client copy (codex.js BOSS_TXT) of boss-*.js headers; bonearcher in no stage roster.

## In progress

## Done
- Foundation: core sim, solo playable.
- 15 lanes merged; co-op runs start from the lobby UI.
- Fix round 2026-10-28: facing aim cone + weapon kill callbacks; stronger evolutions (stormcrown, twinmoons, choir, barrage); density floor; stage 3 bosses weaver + wickeater; spawn-once zones (NET_VERSION 4); hit-flash throttle, zone fade + Canvas2D zone LOD, hero markers, co-op slot palettes; phase banner number. Density floor refill (0.1 × deficit per tick, max 40). Canvas2D render gate 8 ms (WebGL 4 ms).
- Playtest prep 2026-10-28: facing aim falls back to the nearest foe in range (Cleave, Daggers, Shadow Fan, Bone Spear, Impaler; Bramble stays path-bound); dash 80 px, Shield Charge 110 (+40), Shadow Step 130 (+50); Achievements + Encyclopedia screens (src/client/codex.js).
- Bot bench 2026-10-28: bot-brain/bot/bench(+report, fake), seed-paired bootstrap Δ, skill tiers 1 / 0.3, weapon-aware stance, ?bot watch mode (no save).

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
- 2026-10-28 playtest prep (aim fallback, mobility nerf, codex) + bot bench; dual review (Opus + Sonnet) and fix round; all checks pass; merged to main.
