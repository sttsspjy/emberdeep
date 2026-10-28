# Wickdeep — Kanban (agents)

Rules/numbers: GAME-DESIGN.md. Code contract: ARCHITECTURE.md (change it with the code). Legacy: tag `legacy-wickdeep`.

## Todo
- playtest: user verdict on the hero redesign (difficulty, Form feel, Q value).
- balance: fresh profile (meta none) loses every hero on stage 1 in bot runs (5-11 min, often at the 5:00 boss); max meta wins 6/7 (necro lost at 15:52). Tune from playtest.
- balance: Q share of hero damage 1-8% once a Form is taken (19-31% at base) on every hero; Q acts as utility late. User decides.
- net: real PeerJS over a real network untested.
- art: per-stage foe recolours; twins / weaver / wickeater borrow foe art; wanted sprites from hero workers (fissure strip, wind crescent, greatsword, ice bell, stab streak, giant bolt).
- ui (low): evolution popup covers the boss name banner when both fire together.
- mode: Waves mode (round + shop); rules not written yet.
- ui: gamepad does not drive DOM menus.
- codex: boss attack lines are a client copy (codex.js BOSS_TXT) of boss-*.js headers.

## In progress
- art: 28 Form icons (feat/form-icons).
- fx: Form readability pass + per-Form shot harness (feat/form-visuals); Knight Whirlwind crescents whiten 1/3 of the view.

## Done
- Foundation: core sim, solo playable.
- 15 lanes merged; co-op runs start from the lobby UI.
- Fix round 2026-10-28: facing aim cone + weapon kill callbacks; stronger evolutions (stormcrown, twinmoons, choir, barrage); density floor; stage 3 bosses weaver + wickeater; spawn-once zones (NET_VERSION 4); hit-flash throttle, zone fade + Canvas2D zone LOD, hero markers, co-op slot palettes; phase banner number. Density floor refill (0.1 × deficit per tick, max 40). Canvas2D render gate 8 ms (WebGL 4 ms).
- Playtest prep 2026-10-28: facing aim falls back to the nearest foe in range (Cleave, Daggers, Shadow Fan, Bone Spear, Impaler; Bramble stays path-bound); dash 80 px, Shield Charge 110 (+40), Shadow Step 130 (+50); Achievements + Encyclopedia screens (src/client/codex.js).
- Bot bench 2026-10-28: bot-brain/bot/bench(+report, fake), seed-paired bootstrap Δ, skill tiers 1 / 0.3, weapon-aware stance, ?bot watch mode (no save).
- Hero redesign 2026-10-29: one weapon per hero (3 paths x 3 ranks, 5 Forms incl. 2 hybrids, one Form per run, 2 refines), general weapons deleted, one Q skill (scales with weapon factor and party level), view clamp (ED.inView), hero/foe pace x0.8, roster tiers at 5:00/10:00 + 6 new foes, benchmark surge 12:00, XP curve 10+50(L-1)+1.5(L-1)^2, stage gold x1/1.5/2 + boss/win gold + kill bounty, pixel-true Batch shapes, per-hero hfx-<cls>.js + check-hero-<cls>.js + docs/heroes/<cls>.md, tools/dps.js yardstick, NET_VERSION 6.

## Known traps
- Weapon ids are wire / save keys: addWeapon throws on a duplicate (Ranger's hybrid once overwrote Knight's gale).
- One weapon per hero: forms swap ws.id; root via ED.weaponRoot; path mods keep applying after a Form.
- Hero damage only inside the hero's view (ED.inView in hitFoe + targeting via w.vclamp).
- Stats.skill computes weaponMul before sumLevels (shared SUM scratch).
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
- tools/dps.js is the hero power yardstick (bands in GAME-DESIGN §4).

## Logs
- 2026-10-27 foundation committed on feat/survivors.
- 2026-10-28 all lanes merged; integration fixes; fix round committed (6 commits); all Node checks, art --check, browse smoke/shots/coop/crowd900 (GPU + software), late gates GPU pass; late gates software fail.
- 2026-10-28 playtest prep (aim fallback, mobility nerf, codex) + bot bench; dual review (Opus + Sonnet) and fix round; all checks pass; merged to main.
- 2026-10-29 hero redesign: phase 1 (core / horde / render) + phase 2 (7 hero trees) merged on feat/hero-paths; all Node checks, browse smoke/coop/late gates (GPU + software) pass; check-art waits on Form icons.
