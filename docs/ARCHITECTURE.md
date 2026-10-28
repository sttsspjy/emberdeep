# Wickdeep — Architecture contract (survivors rewrite)

Canonical code contract. Rules and numbers live in [GAME-DESIGN.md](GAME-DESIGN.md). Legacy dungeon code is at git tag `legacy-wickdeep` (read with `git show legacy-wickdeep:<path>`, search with `git grep <pattern> legacy-wickdeep`); port pieces from it, never restore whole files.

## 1. Global rules

- Vanilla JS ES2020, no modules, no build step, global `ED` namespace, `'use strict'` IIFE per file. Opens from `file://`.
- `src/util.js`, `src/data/**`, `src/sim/**`, `src/heroes/**`, `src/weapons/**`, `src/save.js` run in Node (`tools/sim.js` vm). No DOM or `window` there. No `Math.random`, no `Date.now` there; use `w.rng` (U.RNG).
- Script order is listed twice: `index.html` and `tools/sim.js` `FILES`. Keep them in sync (the sim subset, same order).
- Hotkeys use `e.code`.
- No per-tick allocation in hot paths (foes, projectiles, gems, hits): pools plus in-place compaction.
- Comments: mechanism and output only, concise.

## 2. File layout and load order

```
index.html  style.css
src/util.js                 U (math, RNG, hash3), ED.CONST, ED.regLook / ED.LOOKS, client hook tables (ED.WeaponFx/SkillFx/BossFx/HeroFx/ZoneFx)
src/data/foes.js            ED.FOES, ED.FOE_IDS, ED.FOE_IDX (append-only wire index)
src/data/stages.js          ED.STAGES (theme {floor, deco, features, brazier, pal}, arena, foe {hp, dmg} stage multipliers, timeline [{rate, cap, floor, roster}] per minute, events {swarm {ring, stampede}}, elites, bosses)
src/data/passives.js        ED.PASSIVES, ED.PASSIVE_IDS
src/data/meta.js            ED.SHOP / ED.SHOP_IDS (permanent ranks), ED.SHOP_BASE, ED.UNLOCKS
src/save.js                 profile load/save, binary save code (v1, count-prefixed lists, append-only), Encyclopedia seen record, ED.Meta (profile facade)
src/sim/stats.js            ED.Stats: hero stat block, weapon effective numbers
src/sim/arena.js            ED.Arena: arena gen (obstacles, braziers), collision (bounds + circles), movement helpers
src/sim/grid.js             ED.Grid (mixed into World.prototype): foe spatial grid + separation; ED.HERO_VIEW, ED.inView (hero view rect)
src/sim/world.js            ED.World: ctor, tick order, players, run flow, downed/revive, events
src/sim/combat.js           hitFoe (view clamp), hit shapes (arc, blast, chain), targeting, statuses, projectile pool, zone pool, hurtHero, braziers
src/sim/foes.js             foe pool, spawnFoe, updateFoes (steer, brains, contact), killFoe, elites
src/sim/ai.js               ED.AI brains: chaser, swarm, brute, ranged, exploder, charger, diver, boss
src/sim/spawner.js          timeline director: rate, cap, density floor, ring spawns, events, elites, boss timers, recycling
src/sim/weapons.js          weapon runtime: the hero's one slot, auto-fire, facing aim, path ranks, Forms, refine; ED.WEAPONS registry
src/sim/skills.js           Q dispatch, host cooldowns, skill levels; ED.CAST registry
src/sim/progress.js         gems, pickups, magnet, XP/levels, card offers, chests, gold
src/sim/bosses.js           ED.Bosses.lib (runner, telegraph helpers), w.spawnBoss / addBossBody / bossBar
src/sim/boss-<id>.js        one file per boss; boss-king.js also defines ED.Bosses.libB (hazard zones, beam length, free spot, adds, pull, leap) for hollow/cyclops/samurai/weaver/wickeater (load after it); weaver and wickeater register their foe defs with ED.addFoe
src/heroes/<cls>.js         7 files: hero data, weapon (3 paths) + Form(s), Q cast, skill levels
src/net.js                  transports, lobby API (ED.Net.host/join/...), binary snapshots + inputs, interest culling, client mirror (ED.Net.Mirror)
src/game.js                 ED.Game (ED.Game.Session): solo / host / client run session, input jitter buffer, prediction + reconcile, view model
src/art/*.js                generated atlas (tools/art.js); never hand-edited
src/client/atlas.js pixfx.js   kept from legacy (ED.Atlas, ED.Pix)
src/client/gl.js            ED.Batch: WebGL2 (WebGL1 + ANGLE_instanced_arrays) instanced batcher sharing post.js's context, Canvas2D fallback
src/client/render.js        frame: camera, floor, layer order, telegraphs, present
src/client/post.js          WebGL post (bloom/grade/vignette); Post.gl() / Post.glCanvas() expose its context for gl.js
src/client/actors.js        picks anim/frame/flip/tint for heroes, foes, bosses, minions → ED.Batch
src/client/fx.js            juice: particles, death bursts, damage numbers, hit-stop, shake, flashes, rings, banners, offscreen arrows
src/client/hfx-a.js hfx-b.js  hero weapon / Form / skill visuals; hfx-a registers ED.ZoneActor.minion / boneknight; bfx-b wraps ED.FX.handle/update/draw/clear (calls the original first)
src/client/bfx-a.js bfx-b.js bfx-c.js  boss bodies (ED.BossFx) and boss zones (ED.ZoneFx)
src/client/audio.js         SFX: synth recipes pre-rendered per cue; ED.Audio.event(ev, myPid) (per-frame aggregation), flush(), play(name, vol, rate, pan), def(name, spec, recipe), setVolumes, preview
src/client/music.js         synthesized per-stage tracks (run / mid-boss / final), intensity from alive count and boss state; ED.Music.update(view, dt)
src/client/input.js aim.js  keyboard/mouse (e.code), aim
src/client/hud.js           in-run HUD (canvas)
src/client/ui.js            DOM screens
src/client/codex.js         Achievements (unlock progress, records) and Encyclopedia (heroes, weapons, passives, foes, bosses, stages) screens (ED.Codex)
src/main.js                 app state machine + frame loop
```

Node load order (`tools/sim.js` FILES): util, data/foes, data/stages, data/passives, data/meta, save, sim/stats, sim/arena, sim/grid, sim/world, sim/combat, sim/foes, sim/ai, sim/spawner, sim/weapons, sim/skills, sim/progress, sim/bosses, sim/boss-{warden, spore, king, hollow, twins, cyclops, samurai, weaver, wickeater}, heroes/{knight, ranger, pyro, necro, cleric, shade, bell}. `require('./tools/sim.js').load()` resets `globalThis.ED`, runs FILES and returns ED.

Browser order (index.html): vendor/peerjs.min.js, the sim list above, src/net.js, src/game.js, src/art/*.js, client atlas, pixfx, gl, render, post, actors, fx, hfx-a, hfx-b, bfx-a, bfx-b, bfx-c, audio, music, input, aim, hud, ui, src/main.js.

## 3. Registries (how lanes plug in without editing core files)

- `ED.addWeapon(def, impl)` → `ED.WEAPONS[id] = def`, `ED.WIMPL[id] = impl`, appends `ED.WEAPON_IDS` (registration order = wire order, append-only), registers `def.look`; sets `def.icon = 'icon.w.<id>'` (card / HUD icon) and keeps the given icon as `def.held` (sprite in the hero's hand). impl `{fire(w, p, ws, S) → bool, tick?(w, p, ws, S, dt), init?(w, p, ws), kill?(w, p, ws, S, e)}`; `kill` runs (via `w.weaponKill`, before `ED.HOOK[cls].kill`) for every foe its holder kills by any source, e.g. Bone Shard / Bone Storm kill-rise. Facing aim: `w.facingAim(p, a0, range, cone = ED.FACING_CONE 1.75 rad)` → angle to the nearest in-view foe in the cone, else a0; `w.coneFoe` same but null when none; `w.heroFoe(p, range, skip)` nearest in-view foe. Called by `src/heroes/*.js` (root def and its Forms in the hero's file). Passive icons are `icon.p.<id>`.
- `ED.addHero(def)` → `ED.HEROES[cls]`; def `{id, name, hp, speed, crit, sig, skills:[qId], icon, col, txt}`. `ED.HERO_IDS` = knight, ranger, pyro, necro, cleric, shade, bell (append-only).
- `ED.addSkill(def, cast)` → `ED.SKILLS[id] = def` (`{id, name, icon, cd, txt, base:{dmg, r, dur, n, ...}, levels:[{mods, txt}] × 3}`; skills go lvl 1..4), `ED.CAST[id] = cast(w, p, x, y, N, sk)`: (x, y) aim point, N = `w.skillN(p, 0)`, sk the slot. Return false to refuse (no cooldown), else an object merged into the `skill` event, or nothing.
- `ED.addFoe(id, o)` → `ED.FOES[id]`, `ED.FOE_IDS`, `ED.FOE_IDX` (append-only). Defaults `{look:'foe.'+id, dirs:2, ai:'chaser', hp:12, spd:45, dmg:1 (contact multiplier), r:7, xp:1, kb:1}`; optional `brute, split:{id, n}, range, shot:{dmg, speed, look, n, spread (rad or 'ring'), cd, wind}, slam, charge, dive, pack:[min, max], fuse, boom:{r, dmg, look}, scale, boss, noElite, noContact, solo`.
- `ED.AI[brain] = fn(w, e, dt)`; a def.ai without a brain runs `chaser`. Brains: chaser, swarm, brute, ranged, exploder, charger, diver, boss. Attacks: a warn zone ≥ 0.6 s aimed at the target's spot at wind-up start; the brain deals the damage when the wind-up ends; `w.foeCancel(e)` (death, stun, freeze) removes it.
- `ED.Bosses[id] = fn(w, e, dt)`, built with `ED.Bosses.lib.runner(attacks, opts)` (the function carries `.attacks .spawn .kill .bar`); `lib = {tele, line, cone, shot, ring, ringAt, aim, dist, mv, near, approach, summon, hazard (no i-frames), slowHero, pull, leapTo, inside, ram, vars, force, runner, placeholder}`. Attack `{w (0 = forced only), phase, ok, wind, start, update → done, end}`; opts `{phases, frac, idle, tick, onPhase, pause, phaseEv, spawn, kill (false keeps the fight going), bar}` (signatures in bosses.js comments). Tuning tables: `ED.Bosses.KING / HOLLOW / CYCLOPS / SAMURAI / TWINS / SPORE / WEAVER / WICK`.
- `ED.HOOK[cls]` — optional `{init(w, p), tick(w, p, dt), kill(w, p, e), hit(w, p, e, dealt, src), stats(p, add)}`.
- `ED.regLook(...names)` — projectile/zone look names; `ED.LOOK_IDX[name]` is the wire index (registration order). Projectile/zone `k` is the look name string.
- Client (tables defined in util.js): `ED.WeaponFx[wid] = {proj(B, pr, t), zone(B, z, t), top(B, z, t)}` (return true when drawn; `top` draws after the actors), `ED.SkillFx[skillId] = {zone, top}`, `ED.ZoneFx[look] = fn(B, z, t)` (zones without a weapon id, e.g. boss zones; true replaces the default), `ED.BossFx[id] = {draw(B, e, t)}` (true replaces the default), `ED.HeroFx[cls] = fn(B, p, t)` (drawn after the hero), `ED.ZoneActor[look] = fn(B, z, t)` (render.js: zones y-sorted with the actors, e.g. minions).

## 4. Sim entities (render-visible fields are marked *)

All entities are plain objects from pools; `dead` marks removal; arrays are compacted in place once per tick.

**Hero** `p`: pid*, slot*, cls*, name*, meta (`{shop, sigs}`; sigs unused), x*, y*, vx, vy, face* (aim angle), mdir (movement angle, kept when still), mvx, mvy, moving*, r=10, hp*, maxHp*, stats (ED.Stats block), statsV, weapons*: `[{id*, root, lvl* (display: 1 + Σpr + Form + fl), pr* ([rank × 3]), fl* (refine 0–2), evo* (Form taken), cd, st:{}, S (cached effective numbers)}]` (max 1), passives*: `[{id, lvl}]` (max 6), skills*: `[{id, lvl, cd, cdMax, N}]` (Q only), dashCd*, dashT*, dashDx, dashDy, invuln*, hurtT*, dr (damage reduction 0..1), slowT, slowK, downed*, bleed*, revive* (0..1), dead*, revUsed, kills, dealt (per weapon id map for the results screen), offer* (array of cards or null), pend (queued level-ups), rerolls*, skips*, banishes*, banned (card keys removed this run), pickInv, in (last input), fxf* (u16) / fxv* (f32) free fields for hero visuals.

**Foe** `e`: id*, k* (FOE_IDX), def, x*, y*, vx, vy, r, hp, maxHp, hpQ* (0..255), dmg, spd, kbx, kby, face* (−1/1), flash* (s), st* (0 move, 1 windup, 2 act, 3 vulnerable, 4 airborne), stT* (clients derive it from st changes), elite*, boss*, slowT, slowK, burnT, burnDps, burnOwner, stunT*, freezeT*, hitT (last-hit tick stamp for pierce dedupe), vars (brain state, created lazily), dead. Internal: tgt (nearest living hero), cd (contact cooldown), age, invulnT, takeMul, scale* (draw scale), final, enraged, rushT/rx/ry (stampede heading), burnTick, hev/hevT (hit aggregation), acd / aa / tz / tzId (brain attack cooldown, aim angle, telegraph zone and its id).

**Projectile** `pr`: id*, k* (look name), team* (0 hero, 1 foe), owner (pid or foe id), p (hero), wid* (weapon id; boss shots use their look), x*, y*, vx, vy, a*, sp, r, dmg, pierce, life, t, knock, critC, hits (pooled array of foe ids), rehit (s), homing (rad/s), ret (boomerang), solid (stops at obstacles), onHit, onEnd, tick, st (custom state), dead.

**Zone** `z`: id*, k* (look), team*, x*, y*, r* (may change live), a*, len*, w* (lines: width; circles: free per-look value, e.g. minion swing flash, censer count), arc* (cone), t*, dur*, tick, dps, dmg (warn resolve), follow (hero pid), src/srcId (caster foe), detached, followSrc, p, wid*, slow, stun, freeze, burn, knock, onTick, onEnd, st, warn* (telegraph flag), dead. Shape: len > 0 line, arc > 0 cone, else circle. Telegraphs are zones with `warn` true; team 1 `dur` is forced ≥ 0.6 s. A team 1 telegraph dies with its caster unless `detached`.

**Pickup** `g`: id*, k* ('xp1','xp5','xp25','gold','food','magnet','bomb','chest'), x*, y*, val, vx, vy, pull (being vacuumed), dead.

**Prop** (obstacles and braziers): `ED.Arena.generate(stage, seed)` → `{size, obstacles:[{id, x, y, r, look}], braziers:[{id, x, y, r, hp, broken, t (sim time it broke), look}], deco:[{x, y, look}], cell, cw, cells}`; deterministic, so clients rebuild it from the seed. Brazier breaks ride the `brazier` event; the sim relights a brazier 60 s after it broke once no living hero is within 700 px (progress.js), and the snapshot's broken bitmask carries both states. Helpers: `ED.Arena.near, collide(A, e, r), move(A, e, dx, dy, r), blocked(A, x, y, r), segBlocked(A, x0, y0, x1, y1, pad)`.

## 5. World

- `new ED.World({seed, stage, players:[{pid, name, slot, cls, meta:{shop, sigs}}], mode:'survival', cheats:{god, might, xp}})` (cheats: checks and tools only).
- `w.update(dt)` fixed step 1/60. Order: inputs → heroes (move, dash, timers, downed) → spawner → foes (brains, steer, contact) → grid rebuild + separation → weapons (auto-fire) → skills → projectiles → zones → pickups/progress → bosses timers → hit flush → compaction → run state (timer, victory, defeat).
- Helpers: `w.foeDmgK()` (shot / blast damage curve × stage), `w.foeCancel(e)`, `w.spawnPack`, `w.swarmEvent`, `w.standInBoss(b)` (stage brute as boss when an id has no script), `w.spawnBoss(b)`, `w.bossHp(t)` (HP of a boss due at t s), `w.addBossBody(e)`, `w.bossBar` `{on, id, name, q, phase, final, enraged, n, rev}`, `w.nextId()`, `w.hero(pid)`, `w.alive(p)`, `w.living` (living heroes), `w.nearestHero(x, y)`, `w.partyN`, `w.partyHp()`, `w.heal(p, v)`, `w.recalc(p, fill)`, `w.spawnFoe(k, x, y, {elite, hpMul, rush:[dx, dy, seconds]})`, `w.spawnPickup(k, x, y, val)`, `w.addXp(v)`, `w.addWeapon(p, id)`, `w.aliveCap()`, grid (`w.foesNear(x, y, r, out)`, `w.foeScan(x, y, r)` + `w.foeEnd()`, `w.foeTail(out)`, `w.nearestFoe(x, y, maxD, skip)`), statuses (`w.burn(e, dps, dur, p)`, `w.slow(e, k, dur)`, `w.freeze(e, dur)`, `w.stun(e, dur)`, `w.knock(e, kx, ky, force)`), `w.foeShoot(e, a, speed, look, dmg, r)`, `w.foeBlast(e, x, y, r, dmg, look)`, `w.steer(e, tx, ty, mul, dt)`.
- `w.time` (s), `w.minute()`, `w.paused` (solo level-up), `w.state` 'play' | 'won' | 'lost'.
- `w.input(pid, {mx, my, ax, ay, dash, q, e, pick, banish, reroll, skip})` — applied at the next tick; the host calls it for remote players too.
- `w.emit(ev)` pushes events to `w.events` (cleared by the session after it reads them; cleared by the world above 6000). The type is `ev.t`: `hit` {id, x, y, dmg, crit} (aggregated per foe per tick, capped at 200 per tick, largest first), `die` {id, k, x, y, elite, boss}, `shoot` {pid, wid}, `swing` {pid, wid, x, y, a, r, arc, look}, `chain` {pid, wid, pts, look}, `skill` {pid, id, slot, x, y, a, ...cast fields}, `boom` {pid, wid, x, y, r, look, team}, `eshoot` {id, x, y, look}, `dash` {pid, x, y, a}, `pickup` {k, pid, x, y, val}, `heal` {pid, v}, `level` {level}, `offer` {pid, reroll}, `pick` {pid, kind, id, lvl, path}, `evolve` {pid, wid (Form), from} (a Form taken), `hurt` {pid, dmg, x, y}, `down` / `dead` / `revive` {pid, charge}, `boss` {id, fid, phase (0 spawn, n phase, -1 killed, 'enrage', 'fall' / 'rise' (twins)), final}, `brazier` {id, x, y, pid}, `chest` {pid, val, results:[{kind:'plvl'|'skill'|'gold'|'offer', id, lvl, name, icon, txt, val}]}, `warn` {kind:'swarm'|'elite'|'boss', ...}, `end` {won, summary}.
- `w.summary()` → `{won, time, kills, level, gold, stage, perHero:[{pid, cls, name, kills, dealt:{wid: dmg}, weapons, build:[{id, pr, fl}]}]}`.
- View clamp: `ED.inView(p, x, y, r)` (grid.js; rect `ED.HERO_VIEW` {hw 320, hh 180, oy 10}, centred on (p.x, p.y − oy)). `hitFoe` drops damage whose `src.p` hero does not see the foe; `w.vclamp` (a hero or null, set by updateWeapons / updateSkills per hero, updateProjs / updateZones per own-team entity) makes `nearestFoe` and `densest` skip foes outside that hero's view; `target` (all modes) and `heroFoe` set it themselves; hero projectiles die fully outside their owner's view; `hitBraziers` / `projBraziers` with a hero break only braziers in its view.

## 6. Weapons

Weapon defs (`ED.WEAPONS[id]`), one root per hero plus its Forms:
```
root: { id, name, icon (atlas anim id), look (projectile look), txt, sig: cls, mode: 'nearest'|'facing'|'random'|'around'|'densest',
  base: {dmg, cd, n, pierce, area, speed, dur, knock, range, crit, critMul, ...custom},
  paths: [ {id, name, ranks: [{mods:{...}, txt:'one line'} × 3], form: formId|null} × 3 ],
  hybrids: [ {need: [i, j], form: formId} ] (0–2),
  noAmount: true|undefined }                      // n ignores the amount stat
form: { id, name, icon, look, txt (Form card line), sig, mode, base, evolved: true, form: true, from: rootId, refine: [{mods, txt} × 2], noAmount }
```
- Slot `ws = {id, root, lvl, pr, fl, evo, cd, st, S}`. `w.rankPath(p, ws, i)` (rank ≤ 3), `w.formsReady(p, ws)` → `[{id, path (−1 hybrid), need}]` (none once a Form is taken), `w.takeForm(p, ws, formId)` (id swap, st reset, impl.init, `evolve` event), `w.refineForm(p, ws)`, `w.setRanks(p, ws, n, form)` (tools: n ranks path 0 → 2, optionally the first Form refined fully); `ED.weaponRoot(idOrSlot)`, `ED.weaponForms(rootId)`, `ED.PATH_MAX` 3, `ED.MAX_WEAPONS` 1.
- Effective numbers `S = ED.Stats.weapon(p, slot)`: base = `WEAPONS[ws.id].base` (the Form's once taken); mods Σ = the root's path ranks per `ws.pr` (kept after a Form) + the Form's `refine[0..fl−1]`. dmg = base.dmg × (1 + Σ dmg) × (1 + might); cd = base.cd × (1 + Σ cd) × (1 − haste), haste cap 0.5, floor 0.2 s; n = base.n + Σ n + amount (unless noAmount); area = base.area × (1 + Σ area) × (1 + reach); speed × (1 + velocity); dur × (1 + duration); pierce = base.pierce + Σ pierce; custom keys pass through (numbers add to base). Cached in `ws.S` until stats, ranks, refine or id change. `ED.Stats.weaponMul(p)` = S.dmg / (root base dmg × (1 + might)).
- Skill numbers `w.skillN(p, 0)` = `ED.Stats.skill(p, 0, partyLevel)`: cd (no haste, min 1), dmg = base × (1 + Σ lvl dmg) × (1 + might) × weaponMul × (1 + 0.05 × (level − 1)), r × reach, dur × duration, custom keys passed through; cached until stats, skill level or party level change.
- Impl (`ED.WIMPL[id]`): `{fire(w, p, ws, S) → bool fired, tick?(w, p, ws, S, dt), init?(w, p, ws), kill?(w, p, ws, S, e), draw?}`. The runtime runs `tick`, decrements `ws.cd`; at ≤ 0 it calls `fire` (which picks targets via `w.target(mode, p, range)`; facing weapons aim with `w.facingAim`, see §3); true resets `cd = S.cd` and emits `shoot`, false retries in 0.1 s.
- Primitives on World (combat.js): `w.shoot(p, wid, x, y, a, S, opt)` → projectile (opt `{look, speed, dmg, pierce, r, life, homing, ret, rehit, knock, solid, onHit(w, pr, e, dealt), onEnd(w, pr), tick(w, pr, dt), st}`); `w.arc(p, wid, x, y, a, r, arc, dmg, opt)` → hit count (opt `{knock, look, onHit(w, e, dealt), crit, slow, stun, freeze, burn, kind, noEv}`); `w.blast(p, wid, x, y, r, dmg, opt)`; `w.zone(opt)` (fields in §4); `w.chain(p, wid, e, hops, range, dmg, opt)`; `w.hitFoe(e, dmg, src)` → dealt; `w.target(mode, p, range)` → foe | null for nearest/random, scratch point `w.pt {x, y, a}` | null for densest, scratch point for facing (range ahead along `p.mdir`) and around (the hero); `w.densest(x, y, range)` → `w.pt` | null; `w.src(p, wid, kind, knock)` → pooled `{p, wid, crit, critC, knock, kx, ky, x, y, kind}`; `w.hitBraziers(x, y, r, p)` (arc and blast call it; hero projectiles break braziers on contact through per-arena buckets, `w.projBraziers(pr)`, without spending pierce).


## 7. Hero stats

`ED.Stats.compute(p)` → `{maxHp, armor, regen, speed, pickup, might, haste, reach, velocity, duration, amount, luck, growth, greed, crit, critMul, revival, rerolls, skips}`. Sources: hero base + passives (`ED.PASSIVES[id].per` × lvl, or `per[key][lvl-1]` for arrays) + meta shop ranks (`p.meta.shop`) + `ED.HOOK[cls].stats(p, add)`. Recomputed on every pick (`w.recalc`).

## 8. Progress

- XP is party-wide (`w.xp`, `w.level`, `w.xpNext`; `ED.World.xpFor(L)` = 5 + 8(L−1) up to L 20, then 157 + 15(L−20)). On level-up, every living hero queues one (`p.pend`) and gets an offer (`p.offer` = 3–4 cards). Solo: `w.paused` until picked. Co-op: no pause; 1 s invulnerability after picking. Input `pick` (1..4), `banish` (1..4, `p.banishes`; replaces that card and adds its key to `p.banned`), `reroll`, `skip` resolve it.
- Card: `{kind:'path'|'form'|'refine'|'passive'|'plvl'|'skill'|'gold'|'heal', id (path: root id; form / refine: Form id), path (path index; Form: −1 hybrid), lvl (after the pick), name (path: path name), txt, sub (''), icon, val (gold / heal)}`. `txt` is one line ≤ 40 characters. Banish keys (`w.cardKey`): `r:<root>:<i>`, `f:<form>`, `x:<form>` (refine), `p:<id>`, `s:<id>`. The client shows a Form as `???` / "An unknown form" unless `ED.Meta.seen('weapons', id)`.
- Chests: `w.openChest(p, val)`: val 1 (elite) levels one random owned passive or skill below max, else gold; val 2 (boss) adds `p.pend++` (one extra offer).
- Gems merge above 350 on the ground. Magnet radius = stats.pickup. The magnet pickup vacuums all gems.
- `w.openChest(p, val)` → chest results (also the `chest` event). `ED.dmgRows(hero)` → `[{id, kind, name, icon, dmg, frac}]` for the results screen (pre-Form damage folded into the Form row).
- `ED.Meta` (save.js) wraps the profile main.js shares through `ED.Meta.use(p)`: `get, save, gold, shop(), buy(id), refund(), refundTotal(), unlocked(cls), stageUnlocked(i), heroes(), stages(), bundle(), seen(k, id), recordRun(sum, pid) → news, code(), restore(code)`. Profile-explicit rules stay on `ED.Save` (`rank, shopCost, buy, refundAll, heroUnlocked, stageUnlocked, applyRun → {gold, unlocked, stages, weapons, records, news}`).
- `profile.seen {heroes, weapons, passives, foes, stages}` (Encyclopedia reveals, ids in `ED.Save.seenOrder(k)`): main.js samples `ED.Save.seenView(rec, view, camera rect)` every 0.25 s of a non-bot run (own hero class / weapons / passives, stage, foes overlapping the camera, `view.boss`) and folds it in with `mergeSeen` at run end before `applyRun`. `normalize` back-fills played heroes + signatures and stages with a best or a win. Save code: an optional seen section after the stats (bitsets over HERO_IDS, `ED.Save.SEEN_WEAPONS` (append-only; `ED.WEAPON_IDS` is load order; the 24 removed general weapon ids stay as dead bits), PASSIVE_IDS, FOE_IDS, STAGE_IDS); codes without it still decode.

## 9. Net

- Transports: PeerJS (`serialization: 'raw'`; text = JSON, snapshots and inputs = ArrayBuffer), BroadcastChannel (`?net=local`), or a test transport (`N.useTransport(T)`). The host runs the World; clients send inputs at 30 Hz (one frame per local 60 Hz tick: i8 move, i16 aim, u16 edges dash/q/e (e unused)/reroll/skip, pick << 5, banish << 8) and get snapshots at 20 Hz.
- Snapshot (`N.encodeSnap(w, cc)`, `apply(buf)` on `ED.Net.Mirror`): header, boss + boss bar, broken braziers, heroes (full; weapons: id, u8 lvl | evo << 7, u8 pr0 | pr1 << 2 | pr2 << 4 | fl << 6; skills: Q only), then zones spawn-once per client (full record when a zone enters the client's rect or changes; a moved zone sends only its position; unchanged zones send nothing and age on the client; then ids of zones that died or left; the host keeps what each client holds in `cc.zc`), foes / projectiles / pickups inside the client's view + 160 px (3-byte positions, delta ids), capped events (100 hits, 120 deaths, 80 misc binary, 24 pickups, 48 JSON of other types). A busy channel skips a snapshot; its JSON events carry over. Offers go as JSON `{t:'offer', cards}`, the end as `{t:'end', summary}`.
- Host: remote inputs play from a 3-frame jitter buffer (missing frames repeat the newest; the hero stops after 6). Client: own hero movement and dash predicted with the sim's arithmetic and reconciled on each snapshot (blend); everything else interpolated 0.1 s behind; events released at that render time. Host-only displacement (Charge, whirlpool pull) arrives through the correction blend.
- Lobby API (default party): `ED.Net.host(name, cls)` → code, `join(code, name, cls)`, `setHero(cls)`, `setReady(v)`, `setStage(i)`, `start(cheats?, seed?)` → bool, `leave()`; state `ED.Net.lobby {role, code, me, status, error, stage, members[{pid, slot, name, cls, ready, isHost}], inRun, canStart}`; callbacks `ED.Net.onChange(lobby)`, `onError(msg)`, `onClosed(msg)` (set by ui.js). A start builds the run on every peer and calls `ED.App.enterRun(stage)`. Late joins are refused; a leaving client's hero dies; a lost host ends the run with `sum.note`.
- `ED.NET_VERSION` (= `ED.Net.VERSION`, now 5) bumps on any wire change. Wire ids (looks, weapons, skills, foes, passives) are registration order, so they must be registered at script load.

## 10. Client

- **View model** (`ED.Game.view`): `{me, heroes[], foes[], projs[], zones[], pickups[], props, stage, seed, time, xp, xpNext, level, kills, gold, boss, bossBar, events[]}`. `ED.Game.w` is null on clients: client code reads `ED.Game.view`; `ED.Game.active()`, `coop()`, `quit()`, `netStats()`. On host/solo, the arrays alias the World arrays; on clients, they come from decoded snapshots with the same render-visible field names (marked * in §4).
- **ED.Batch** (gl.js): `init(ctx)`, `use('gl'|'2d')`, `size(w, h)`, `begin(camX, camY, scale, bg?)`, `spr(animId, frame, x, y, o)` with `o = {flip, flash (0..1 white, applied before tint), alpha, rot, sx, sy, tint (0xRRGGBB mul; WebGL only), add (additive), variant}`, `rect(x, y, w, h, rgba)`, `circ(x, y, r, rgba, lw)` (no lw = fill), `line(x0, y0, x1, y1, lw, rgba)`, `cone(x, y, r, a, arc, rgba, lw)`, `shadow(x, y, rx)`, `img(src, x, y, w, h, alpha)` (a canvas whose content changes carries an increasing `.ver`), `text(s, x, y, color, k, align, alpha)`, `poly(P, n, lw, rgba)` (polyline through n x,y pairs of P; one stroke on 2D), `fade(k)` (alpha multiplier for following draws until `fade(1)` / `begin`), `zcirc(x, y, r, rgba, lw)` + `zflush()` (zone LOD discs: with `zoneUnion` batched per colour into one union path, else plain `circ`), `end()`; `out {tex, w, h}` (WebGL target post.js composites), `readPixels()`, `glError`, `mode`, `ctx` (in WebGL mode a bridge canvas, one upload per use), `crowd` (live foe count for LOD), `zoneLoad` / `zoneN` (own-team zone coverage of the view and count), `zoneLite` (2D zone LOD: hooks draw a fill + rim through `zcirc`, details dropped), `zoneUnion` (2D canvas is software-rasterised), `stats {draws, inst}`. `Post.render(null, {tex})` takes a texture already on the shared context. Colours: `rgba` = 0xRRGGBBAA, `tint`/`color` = 0xRRGGBB. World units: 1 art px = 1 world px (`ED.Atlas` K = 1); the view is 640×360 world px integer-scaled to the canvas. The WebGL path: all atlas pages uploaded once as textures, instanced (ANGLE_instanced_arrays / WebGL2) quads, one draw per page per blend mode, y-sort done by the caller. The Canvas2D fallback implements the same API through `ED.Atlas.draw` with crowd LOD (skip shadows and flashes above 250 foes).
- **render.js** layer order: floor (cached 256 px chunk canvases) → zones / telegraph fills → pickups → y-sorted actors (heroes, foes, ED.ZoneActor zones, bosses, props; radix sort on typed arrays) → projectiles → zone `top` overlays → FX → hostile telegraph outlines (over the horde) → hero markers (`Actors.heroTop`: local hero slot-colour ring, outline and sprite again; allies outline) → overlays (names, bars) → post. Own-team zones (team 0) draw before enemy zones and fade together once their coverage passes 0.6 of the view (alpha √(0.6 / coverage), floor 0.4), `top` overlays included. Every list is culled to the view. `Render.gpu`, `Render.crowd`.
- Telegraphs must be readable over a dense horde (bright outline + fill pulse).
- Hit flash: a sprite shows white at most 60 ms per 250 ms (600 ms for foes above 250 on screen); BossFx draw hooks read `ED.Actors.hitFlash(e)`, not `e.flash`.
- Hero art: `ED.ART.swaps[cls].key` = player-colour key colours (the per-hero palette swap is baked into `hero.<cls>.*` by tools/art.js); in co-op `Actors.hero` draws Atlas variant `pal:pc<slot>` (key colours → shades of the slot colour, `Actors.SLOT_COL`).
- Text sizes: card text ≥ 20 px CSS, HUD numbers ≥ 16 px CSS, plain pixel font ('Pixel Operator').

## 11. Performance gates

- `tools/check-perf.js`: 900 foes + 600 projectiles + 400 gems, sim ≤ 2.5 ms per tick average on this machine (report worst tick).
- `tools/browse.js crowd900`: frame time p95 ≤ 8 ms on the GPU path (headless Chromium, measured uncapped, no vsync; enforced with `--gate`), and the Canvas2D fallback (`--software`) stays playable (report p95).
- `tools/browse.js late[a|b|c]`: staged late game (six evolved weapons, boss, 900 foes at real HP): Render.frame p95 ≤ 4 ms on WebGL, ≤ 8 ms on Canvas2D (GAME-DESIGN §13; enforced with `--gate`).
- `tools/check-net.js`: snapshot bytes at 900 foes with interest culling ≤ 12 KB.

## 12. Checks (headless only, exit 1 on failure)

- `tools/check-sim.js` (`--quick`): per stage a 15-minute cheat-build victory run (3 bosses met, final boss killed, one Form taken), every hero reaches a Form, every hero 75 s on every stage (casts Q only, weapon damage), determinism digests, hit cap, 0.6 s telegraph minimum, alive cap.
- Node: `check-perf.js` (`--split`), `check-horde.js`, `check-heroes-a.js`, `check-heroes-b.js`, `check-bosses-a.js`, `check-bosses-b.js`, `check-progress.js`, `check-save.js`, `check-net.js` (fake transport, latency + jitter), `check-juice.js` (mock batch), `check-art.js`, `node tools/art.js --check`.
- Browser (Playwright, headless Chromium; never a visible window): `check-gl.js`, `check-ui.js`, `check-audio.js`, `tools/browse.js smoke|shots|coop|crowdN|late[a|b|c] [--gate] [--software]`. `browse.js` injects the test-only `ED.Debug` API (`fastForward, give, evolve, spawnBoss, setTime, levelUp, chest, win, lose, god, state`). Output goes to `%TEMP%/wickdeep-browse/` (shots: a timestamped folder). `browse.js botwatch`: bot watch mode runs ≥ 3× real time and picks cards on its own.
- Bot: `tools/bot-brain.js` (UMD policy `ED.Bot`; Node and the `?bot=1` watch mode in src/main.js), `tools/bot.js` (`runOne(cfg)` one headless run; `ED.Bot.create({pid, seed, skill})`; picks Form, refine, one path to rank 3 then the next, passives, skill), `tools/bench.js` (parallel stage × hero × seed × meta × skill matrix; strength relative to the mean hero → `bench-out/` results.jsonl, meta.json with code hash, summary.json, report.html built by `bench-report.js`; seed-paired Δ with bootstrap CIs; `--resume` refuses a changed code hash or maxTime without `--force`; `--report`; `--runner bench-fake.js` for tests). Checks: `check-bot.js`, `check-bench.js`.
