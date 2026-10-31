# Wickdeep ??Kanban (agents)

Rules/numbers: GAME-DESIGN.md. Code contract: ARCHITECTURE.md (change it with the code). Legacy: tag `legacy-wickdeep`.

## Todo
- playtest: Last Light lap length / gold (60 s, 1 coin per 8 kills), Form x0.7 + late boss HP x2 feel, Ranger/Knight parity.
- sim: check-sim --quick fails 7 'reaches a Form by 420 s' (pre-existing at bedbe5b; full run passes).
- ranger: Seeker kill shots ignore the boss/elite skip.
- balance: fresh profile (meta none) loses every hero on stage 1 in bot runs (5-11 min, often at the 5:00 boss); max meta wins 6/7 (necro lost at 15:52). Tune from playtest.
- balance: Q share of hero damage 1-8% once a Form is taken (19-31% at base) on every hero; Q acts as utility late. User decides.
- net: real PeerJS over a real network untested.
- art: per-stage foe recolours; twins / weaver / wickeater borrow foe art; wanted sprites from hero workers (fissure strip, wind crescent, greatsword, ice bell, stab streak, giant bolt).
- ui (low): evolution popup covers the boss name banner when both fire together.
- mode: Waves mode (round + shop); rules not written yet.
- ui: gamepad does not drive DOM menus.
- codex: boss attack lines are a client copy (codex.js BOSS_TXT) of boss-*.js headers.

- forms: 7 hero paths have 1 Form (add a 2nd each); 16 support paths need 1 Form each.
- bot: passive policy spreads picks over 6 passives; rarely maxes 2 by 17:00.
- cosmetics: weapon tints miss hero-fx private pools (knight spin fans, slam rims); kill style is the viewer's own (die events carry no killer).
- tools: dps.js crowd uses HPK 3.4 (minute-10 HP is 2.1x since 0.11 growth); supports.md numbers depend on it.

## In progress


## Done
- Foundation: core sim, solo playable.
- 15 lanes merged; co-op runs start from the lobby UI.
- Fix round 2026-10-28: facing aim cone + weapon kill callbacks; stronger evolutions (stormcrown, twinmoons, choir, barrage); density floor; stage 3 bosses weaver + wickeater; spawn-once zones (NET_VERSION 4); hit-flash throttle, zone fade + Canvas2D zone LOD, hero markers, co-op slot palettes; phase banner number. Density floor refill (0.1 횞 deficit per tick, max 40). Canvas2D render gate 8 ms (WebGL 4 ms).
- Playtest prep 2026-10-28: facing aim falls back to the nearest foe in range (Cleave, Daggers, Shadow Fan, Bone Spear, Impaler; Bramble stays path-bound); dash 80 px, Shield Charge 110 (+40), Shadow Step 130 (+50); Achievements + Encyclopedia screens (src/client/codex.js).
- Bot bench 2026-10-28: bot-brain/bot/bench(+report, fake), seed-paired bootstrap ?, skill tiers 1 / 0.3, weapon-aware stance, ?bot watch mode (no save).
- Hero redesign 2026-10-29: one weapon per hero (3 paths x 3 ranks, 5 Forms incl. 2 hybrids, one Form per run, 2 refines), general weapons deleted, one Q skill (scales with weapon factor and party level), view clamp (ED.inView), hero/foe pace x0.8, roster tiers at 5:00/10:00 + 6 new foes, benchmark surge 12:00, XP curve 10+50(L-1)+1.5(L-1)^2, stage gold x1/1.5/2 + boss/win gold + kill bounty, pixel-true Batch shapes, per-hero hfx-<cls>.js + check-hero-<cls>.js + docs/heroes/<cls>.md, tools/dps.js yardstick, NET_VERSION 6.

## Known traps
- Weapon ids are wire / save keys: addWeapon throws on a duplicate (Ranger's hybrid once overwrote Knight's gale).
- One weapon per hero: forms swap ws.id; root via ED.weaponRoot; path mods keep applying after a Form.
- Hero damage only inside the hero's view (ED.inView in hitFoe + targeting via w.vclamp).
- Q skills are zero damage: no dmg in skill base / levels / N.
- Hero statuses, knock and zone effects land only on foes in the hero's view (combat.js seen; zoneFoes filters hero zones).
- Supports are save keys in Save.SEEN_WEAPONS: append only.
- Support Forms (all 3 paths share one Form): ready when any path in f.any is at rank 3; f.need holds only the first.
- Sim/data/heroes/weapons/save run in Node: no DOM, no Math.random/Date.now; use w.rng.
- Script order twice: index.html and tools/sim.js FILES.
- Pooled entities are reused under new ids: holders keep object + id and compare.
- w.target around/densest return the shared scratch w.pt: copy before the next call.
- Foe telegraphs: team 1 warn zones, dur ??0.6 s (forced).
- 1 art px = 1 world px (Atlas K = 1); view 640횞360 integer-scaled.
- Weapon def.icon is forced to icon.w.<id> (cards / HUD); def.held keeps the in-hand sprite.
- Wire change (snapshot, input, look / weapon registration order) bumps ED.NET_VERSION.
- Zones are spawn-once per client (cc.zc): every encoded snapshot must reach that client's Mirror.
- Boss draw hooks read ED.Actors.hitFlash(e), not e.flash; headless checks stub ED.Actors.
- Kill effects tied to a weapon go in impl.kill (any holder), not ED.HOOK[cls].kill.
- Directional weapons aim with w.aimDir(p) (cursor, p.in.ax/ay); bots and browse.js drive must send ax/ay.
- tools/dps.js is the hero power yardstick (bands in GAME-DESIGN 짠4).

## Logs
- 2026-10-27 foundation committed on feat/survivors.
- 2026-10-28 all lanes merged; integration fixes; fix round committed (6 commits); all Node checks, art --check, browse smoke/shots/coop/crowd900 (GPU + software), late gates GPU pass; late gates software fail.
- 2026-10-28 playtest prep (aim fallback, mobility nerf, codex) + bot bench; dual review (Opus + Sonnet) and fix round; all checks pass; merged to main.
- 2026-10-29 hero redesign: phase 1 (core / horde / render) + phase 2 (7 hero trees) + Form icons + readability pass; all checks pass; merged to main.
- 2026-10-31 ranged pressure fix (fix/ranged-pressure): shooter cap 3→8, per-hero shot budget, no retreat, fans → lane streams, Spitcap lob, short shot life, calm 'aim' line (NET 9). Open: gem merge (>350 gems) can strand XP outside the hero's path; boss adds and splitter children skip the shooter cap.
- 2026-10-31 horde balance (fix/horde-balance): foe HP x0.37 + bat flocks (≤ alive cap +25%), Garlic-like Censer, Camp base 80 / bounty 1 per 10; bench 672 runs (5% wins: Bell 31%, Ranger 4%, rest 0%) → contact 3→9, shots x1.8 late, XP curve -26%, boss HP exponent 2, signature +10–25%, Pyro/Necro HP +15/+10, Stalker pack 1–2 mul 1; recheck 336 runs: 11% wins (Bell 46%, Ranger 25%, Cleric/Knight 2%, Shade/Pyro/Necro 0%). Open: melee/caster bot play is weak (dps.js puts Knight near Ranger); bot never takes passives (weapon cards score higher); Rending Gale crescents 0.7x now ≤ Edge Wave root.
- 2026-10-31 dash foes (fix/horde-balance): charger/diver/blinker share W.dasherCap (3+0.6/min, max 12) and the hero attack budget (shotTok → atkTok); charges/dives start only when the lane reaches the target, then rest 0.8 s; divers spiral in (no hover); quiet 'dash' lanes under shots (NET 10); REFILL_MIN 6; Abyss keeps Shade as chaser filler (caps had flooded it with Horrors). Before: 47–208 dashers alive from 5:00, 10 lanes on screen.
- 2026-10-31 playtest fixes (fix/horde-balance): hero hits push foes away from the hitter (meteors no longer shove foes in); heroes 78–84 px/s, non-swarm foe walk ×0.9; splitter children on the far side from the hero; hero damage hitbox 6 px (HERO_BODY 10 for walls/pickups); Cathedral one hit per toll + dmg 15→11 (F0 crowd 7574→3215; bench: Cathedral 19/19 wins, Bell without it 3/29); Carillon dmg 8 knock 110 (outward push had dropped it 24%).
- 2026-10-31 flocks fly through (fix/horde-balance): flock = pack or line (×1.5, 14 px apart) at 120 px/s × pace on a fixed heading through the hero's spot; flock/ring/stampede members never chase, despawn 360 px outside every view (no gem/kill), never recycled. Rending Gale cone ±30° (F2 crowd 4381→3345, single 612→1071). Next: progression redesign (Phase 1: 5 stat → elite-chest path pick → path ranks 1–5 → boss-chest Form fork of 2; 20-min runs, 4 bosses).
- 2026-10-31 progression v2 (feat/progression-v2): slot lifecycle tune 5 → elite-chest path pick (permanent) → path ranks 2–5 (shape 1/3/5, +10% dmg/+5% speed at 2/4) → boss-chest Form fork (from the 10:00 boss; hybrids re-homed as 2nd path Forms; 7 paths still have 1 Form) → refine 2; per-item card weights, guarantee only levels 2–3; 20-min runs (bosses 5/10/15/20, 15:00 borrowed with host-stage adds, bench 17:00, enrage 22:00); Forms tuned to the role rule (Bell 1,855–1,996). Bot (meta max) lv 45–56 at 20:00, first Form 10:00–14:00; meta none dies 9–13 min to brutes + ghouls. Next: Phase 2 (7 new hero Forms), Phase 3 (16 support Forms), Phase 4 meta scale-up.
- 2026-10-31 playtest round 3 (feat/balance-and-meta): gems at the cap merge within 80 px else absorb the farthest gem at the drop spot; magnets from hero kills (first 140 s, gap 100 s, p 0.003, replaces an uncollected one), braziers drop none; non-swarm HP growth 0.11/min; elite HP x15 x max(1, 60/def.hp); brute slam r = 34 + def.r, elite slam x1.35; W.bruteCap 2+0.35/min (max 8, elite brutes +2); Knight Aegis Ward (r 50, 6.5 s, cd 25; L5 follows); every Q 4 level mods (L5 capstone); xpFor +300 per level past 15; Camp 19 rows, price cost x (r+1)^2, total 43,360; gold 1 per 100 kills + 10/min + boss/win, stage gold 1/1.25/1.5; Shade buy 4000, Bell pure win, Necro survive 15:00; 29 achievements; Wardrobe 54 cosmetics (31,300 gold + 17 rewards), lobby cos bundle (NET 12).
- 2026-10-31 playtest round 3 (feat/balance-and-meta): gems at the cap merge within 80 px else absorb the farthest gem at the drop spot; magnets from hero kills (first 140 s, gap 100 s, p 0.003, replaces an uncollected one), braziers drop none; non-swarm HP growth 0.11/min; elite HP x15 x max(1, 60/def.hp); brute slam r = 34 + def.r, elite slam x1.35; W.bruteCap 2+0.35/min (max 8, elite brutes +2); Knight Aegis Ward (r 50, 6.5 s, cd 25; L5 follows); every Q has 4 level mods (L5 capstone); xpFor +300 per level past 15; Camp 19 rows, price cost x (r+1)^2, total 43,360; gold 1 per 100 kills + 10/min + boss/win, stage gold 1/1.25/1.5; Shade buy 4000, Bell no-Camp win, Necro survive 15:00; 29 achievements; Wardrobe 54 cosmetics (31,300 gold + 17 rewards), lobby cos bundle (NET 12).
- 2026-11-01 victory + balance (feat/victory-lap): Last Light (lap.js: final boss kill banks w.won, clears foes, 2 s calm, 60 s lap at cap 900, coin per 8 kills, no XP; NET 13); run stats (kills per weapon, taken, healed, top hit, downs, revives, per-minute timeline, boss log) + results screen (tiles, weapon table with DPS, timeline canvas, party/bosses tabs, 1.5 s input guard); hero Forms dmg x0.7 (Earthsplitter 15 for the role rule); boss HP x2 from 15:00; Ranger cd 0.7 range 260; Knight Cleave 36 + x1.6 big foes; Seeker homing skips bosses/elites while normal foes are in view; Revival max 1 (rank 2 refunded 2,200). browse smoke default 16 s (knight melee missed foes in 10 s at HEAD too).
