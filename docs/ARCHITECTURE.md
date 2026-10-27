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
src/util.js                 U (math, RNG, hash3), ED.CONST, ED.regLook / ED.LOOKS, client hook tables (ED.WeaponFx/SkillFx/BossFx/HeroFx)
src/data/foes.js            ED.FOES, ED.FOE_IDS, ED.FOE_IDX (append-only wire index)
src/data/stages.js          ED.STAGES (theme, arena, timeline, events, bosses)
src/data/passives.js        ED.PASSIVES, ED.PASSIVE_IDS
src/data/meta.js            ED.SHOP / ED.SHOP_IDS (permanent ranks), ED.SHOP_BASE, ED.UNLOCKS
src/save.js                 profile load/save, save code
src/sim/stats.js            ED.Stats: hero stat block, weapon effective numbers
src/sim/arena.js            ED.Arena: arena gen (obstacles, braziers), collision (bounds + circles), movement helpers
src/sim/grid.js             ED.Grid (mixed into World.prototype): foe spatial grid + separation
src/sim/world.js            ED.World: ctor, tick order, players, run flow, downed/revive, events
src/sim/combat.js           hitFoe, hit shapes (arc, blast, chain), targeting, statuses, projectile pool, zone pool, hurtHero, braziers
src/sim/foes.js             foe pool, spawnFoe, updateFoes (steer, brains, contact), killFoe, elites
src/sim/ai.js               ED.AI brains for special foes
src/sim/spawner.js          timeline director: rate, cap, ring spawns, events, elites, boss timers, recycling
src/sim/weapons.js          weapon runtime: slots, auto-fire, targeting, levels, evolution; ED.WEAPONS registry
src/sim/skills.js           Q/E dispatch, host cooldowns, skill levels; ED.CAST registry
src/sim/progress.js         gems, pickups, magnet, XP/levels, card offers, chests, gold
src/sim/bosses.js           ED.Bosses.lib (runner, telegraph helpers) + boss registry
src/sim/boss-<id>.js        one file per boss
src/weapons/general-a.js    6 general weapons + their evolutions (data + impl)
src/weapons/general-b.js    6 general weapons + their evolutions (data + impl)
src/heroes/<cls>.js         7 files: hero data, signature weapon + evolution, Q/E casts, skill levels
src/net.js                  transports, lobby, binary snapshots, interest culling
src/game.js                 session: local control, prediction, client mirror, view model
src/art/*.js                generated atlas (tools/art.js); never hand-edited
src/client/atlas.js pixfx.js   kept from legacy (ED.Atlas, ED.Pix)
src/client/gl.js            ED.Batch sprite batcher API (foundation: Canvas2D path only; the WebGL path is the GL lane)
src/client/render.js        frame: camera, floor, layer order, telegraphs, present
src/client/post.js          WebGL post (bloom/grade/vignette); Post.gl() / Post.glCanvas() expose its context for gl.js
src/client/actors.js        picks anim/frame/flip/tint for heroes, foes, bosses, minions → ED.Batch
src/client/fx.js            juice: particles, death bursts, damage numbers, hit-stop, shake, flashes, rings
src/client/audio.js         SFX synth with per-sound voice budget
src/client/music.js         synthesized music, intensity from alive count and boss state (foundation: stub ED.Music {update, stop})
src/client/input.js aim.js  keyboard/mouse (e.code), aim
src/client/hud.js           in-run HUD (canvas)
src/client/ui.js            DOM screens
src/main.js                 app state machine + frame loop
```

Node load order (`tools/sim.js` FILES): util, data/foes, data/stages, data/passives, data/meta, save, sim/stats, sim/arena, sim/grid, sim/world, sim/combat, sim/foes, sim/ai, sim/spawner, sim/weapons, sim/skills, sim/progress, sim/bosses, sim/boss-{warden, spore, king, hollow, twins, cyclops, samurai}, weapons/general-a, weapons/general-b, heroes/{knight, ranger, pyro, necro, cleric, shade, bell}. `require('./tools/sim.js').load()` resets `globalThis.ED`, runs FILES and returns ED.

Browser order (index.html): vendor/peerjs.min.js, the sim list above, src/net.js, src/game.js, src/art/*.js, client atlas, pixfx, gl, render, post, actors, fx, audio, music, input, aim, hud, ui, src/main.js.

## 3. Registries (how lanes plug in without editing core files)

- `ED.addWeapon(def, impl)` → `ED.WEAPONS[id] = def`, `ED.WIMPL[id] = impl`, appends `ED.WEAPON_IDS` (registration order = wire/card order, append-only), registers `def.look`. Called by `src/weapons/*.js` and `src/heroes/*.js`.
- `ED.addHero(def)` → `ED.HEROES[cls]`; def `{id, name, hp, speed, crit, sig, skills:[qId, eId], icon, col, txt}`. `ED.HERO_IDS` = knight, ranger, pyro, necro, cleric, shade, bell (append-only).
- `ED.addSkill(def, cast)` → `ED.SKILLS[id] = def` (`{id, name, icon, cd, txt, base:{dmg, r, dur, n, ...}, levels:[{mods, txt}] × 3}`; skills go lvl 1..4), `ED.CAST[id] = cast(w, p, x, y, N, sk)`: (x, y) aim point, N = `ED.Stats.skill(p, idx)`, sk the slot. Return false to refuse (no cooldown), else an object merged into the `skill` event, or nothing.
- `ED.addFoe(id, o)` → `ED.FOES[id]`, `ED.FOE_IDS`, `ED.FOE_IDX` (append-only). Defaults `{look:'foe.'+id, dirs:2, ai:'chaser', hp:12, spd:45, dmg:1 (contact multiplier), r:7, xp:1, kb:1}`; optional `brute, split:{id, n}, range, shot:{dmg, speed, look}, fuse, boom:{r, dmg}, scale, boss, noElite, noContact, solo`.
- `ED.AI[brain] = fn(w, e, dt)`; a def.ai without a brain runs `chaser`. Foundation brains: chaser, swarm, boss.
- `ED.Bosses[id] = fn(w, e, dt)`, built with `ED.Bosses.lib.runner(attacks, opts)`; `lib = {tele, line, cone, ring, aim, mv, approach, summon, runner, placeholder}` (signatures in bosses.js header comments).
- `ED.HOOK[cls]` — optional `{init(w, p), tick(w, p, dt), kill(w, p, e), hit(w, p, e, dealt, src), stats(p, add)}`.
- `ED.regLook(...names)` — projectile/zone look names; `ED.LOOK_IDX[name]` is the wire index (registration order). Projectile/zone `k` is the look name string.
- Client (tables defined in util.js): `ED.WeaponFx[wid] = {proj(B, pr, t), zone(B, z, t)}` (return true when drawn), `ED.SkillFx[skillId] = {zone(B, z, t)}`, `ED.BossFx[id] = {draw(B, e, t)}` (true replaces the default), `ED.HeroFx[cls] = fn(B, p, t)` (drawn after the hero).

## 4. Sim entities (render-visible fields are marked *)

All entities are plain objects from pools; `dead` marks removal; arrays are compacted in place once per tick.

**Hero** `p`: pid*, slot*, cls*, name*, meta (`{shop, sigs}`), x*, y*, vx, vy, face* (aim angle), mdir (movement angle, kept when still), mvx, mvy, moving*, r=10, hp*, maxHp*, stats (ED.Stats block), statsV, weapons*: `[{id, lvl, evo, cd, st:{}, S (cached effective numbers)}]` (max 6), passives*: `[{id, lvl}]` (max 6), skills*: `[{id, lvl, cd, cdMax, N}]` (Q, E), dashCd*, dashT*, dashDx, dashDy, invuln*, hurtT*, dr (damage reduction 0..1), slowT, slowK, downed*, bleed*, revive* (0..1), dead*, revUsed, kills, dealt (per weapon id map for the results screen), offer* (array of cards or null), pend (queued level-ups), rerolls, skips, pickInv, in (last input).

**Foe** `e`: id*, k* (FOE_IDX), def, x*, y*, vx, vy, r, hp, maxHp, hpQ* (0..255), dmg, spd, kbx, kby, face* (−1/1), flash* (s), st* (0 move, 1 windup, 2 act), stT*, elite*, boss*, slowT, slowK, burnT, burnDps, burnOwner, stunT*, freezeT*, hitT (last-hit tick stamp for pierce dedupe), vars (brain state, created lazily), dead. Internal: tgt (nearest living hero), cd (contact cooldown), age, invulnT, takeMul, scale* (draw scale), final, enraged, rushT/rx/ry (stampede heading), burnTick, hev/hevT (hit aggregation).

**Projectile** `pr`: id*, k* (look name), team (0 hero, 1 foe), owner (pid or foe id), p (hero), wid (weapon id), x*, y*, vx, vy, a*, sp, r, dmg, pierce, life, t, knock, critC, hits (pooled array of foe ids), rehit (s), homing (rad/s), ret (boomerang), solid (stops at obstacles), onHit, onEnd, tick, st (custom state), dead.

**Zone** `z`: id*, k* (look), team, x*, y*, r*, a*, len*, w*, arc* (cone), t*, dur*, tick, dps, dmg (warn resolve), follow (hero pid), src/srcId (caster foe), detached, followSrc, p, wid, slow, stun, freeze, burn, knock, onTick, onEnd, st, warn* (telegraph flag), dead. Shape: len > 0 line, arc > 0 cone, else circle. Telegraphs are zones with `warn` true; team 1 `dur` is forced ≥ 0.6 s. A team 1 telegraph dies with its caster unless `detached`.

**Pickup** `g`: id*, k* ('xp1','xp5','xp25','gold','food','magnet','bomb','chest'), x*, y*, val, vx, vy, pull (being vacuumed), dead.

**Prop** (obstacles and braziers): `ED.Arena.generate(stage, seed)` → `{size, obstacles:[{id, x, y, r, look}], braziers:[{id, x, y, r, hp, broken, look}], deco:[{x, y, look}], cell, cw, cells}`; deterministic, so clients rebuild it from the seed. Brazier breaks ride the `brazier` event. Helpers: `ED.Arena.near, collide(A, e, r), move(A, e, dx, dy, r), blocked(A, x, y, r), segBlocked(A, x0, y0, x1, y1, pad)`.

## 5. World

- `new ED.World({seed, stage, players:[{pid, name, slot, cls, meta:{shop, sigs}}], mode:'survival', cheats:{god, might, xp}})` (cheats: checks and tools only).
- `w.update(dt)` fixed step 1/60. Order: inputs → heroes (move, dash, timers, downed) → spawner → foes (brains, steer, contact) → grid rebuild + separation → weapons (auto-fire) → skills → projectiles → zones → pickups/progress → bosses timers → hit flush → compaction → run state (timer, victory, defeat).
- Helpers: `w.nextId()`, `w.hero(pid)`, `w.alive(p)`, `w.living` (living heroes), `w.nearestHero(x, y)`, `w.partyN`, `w.partyHp()`, `w.heal(p, v)`, `w.recalc(p, fill)`, `w.spawnFoe(k, x, y, {elite, hpMul, rush:[dx, dy]})`, `w.spawnPickup(k, x, y, val)`, `w.addXp(v)`, `w.addWeapon(p, id)`, `w.aliveCap()`, grid (`w.foesNear(x, y, r, out)`, `w.foeScan(x, y, r)` + `w.foeEnd()`, `w.foeTail(out)`, `w.nearestFoe(x, y, maxD, skip)`), statuses (`w.burn(e, dps, dur, p)`, `w.slow(e, k, dur)`, `w.freeze(e, dur)`, `w.stun(e, dur)`, `w.knock(e, kx, ky, force)`), `w.foeShoot(e, a, speed, look, dmg, r)`, `w.foeBlast(e, x, y, r, dmg, look)`, `w.steer(e, tx, ty, mul, dt)`.
- `w.time` (s), `w.minute()`, `w.paused` (solo level-up), `w.state` 'play' | 'won' | 'lost'.
- `w.input(pid, {mx, my, ax, ay, dash, q, e, pick, reroll, skip})` — applied at the next tick; the host calls it for remote players too.
- `w.emit(ev)` pushes events to `w.events` (cleared by the session after it reads them; cleared by the world above 6000). The type is `ev.t`: `hit` {id, x, y, dmg, crit} (aggregated per foe per tick, capped at 200 per tick, largest first), `die` {id, k, x, y, elite, boss}, `shoot` {pid, wid}, `swing` {pid, wid, x, y, a, r, arc, look}, `chain` {pid, wid, pts, look}, `skill` {pid, id, slot, x, y, a, ...cast fields}, `boom` {pid, wid, x, y, r, look, team}, `eshoot` {id, x, y, look}, `dash` {pid, x, y, a}, `pickup` {k, pid, x, y, val}, `heal` {pid, v}, `level` {level}, `offer` {pid, reroll}, `pick` {pid, kind, id, lvl}, `evolve` {pid, wid, from}, `hurt` {pid, dmg, x, y}, `down` / `dead` / `revive` {pid, charge}, `boss` {id, fid, phase (0 spawn, n phase, -1 killed, 'enrage'), final}, `brazier` {id, x, y, pid}, `chest` {pid, results:[{kind, id, from}]}, `warn` {kind:'swarm'|'elite'|'boss', ...}, `end` {won, summary}.
- `w.summary()` → `{won, time, kills, level, gold, stage, perHero:[{pid, cls, name, kills, dealt:{wid: dmg}, weapons}]}`.

## 6. Weapons

Weapon def (`ED.WEAPONS[id]`):
```
{ id, name, icon (atlas anim id), look (projectile look), txt (new-weapon card line), sig: cls|null,
  mode: 'nearest'|'facing'|'random'|'around'|'densest',
  base: {dmg, cd, n, pierce, area, speed, dur, knock, range, crit, critMul, ...custom},
  levels: [ {mods:{...}, txt:'one line'} × 7 ],   // levels 2..8
  pair: passiveId, evo: evolvedId,               // general weapons and signatures
  noAmount: true|undefined,                      // n ignores the amount stat
  evolved: true|undefined, from: baseId }        // evolved defs are not offered as cards
```
- Effective numbers `S = ED.Stats.weapon(p, slot)`: dmg = base.dmg × (1 + Σ lvl dmg) × (1 + might); cd = base.cd × (1 + Σ lvl cd) × (1 − haste), floor 0.12 s; n = base.n + Σ lvl n + amount (unless noAmount); area = base.area × (1 + Σ lvl area) × (1 + reach); speed × (1 + velocity); dur × (1 + duration); pierce = base.pierce + Σ lvl pierce; plus any custom keys passed through. Cached in `ws.S` until stats, level or id change. Skills: `ED.Stats.skill(p, idx)` → cd (no haste, min 1), dmg × might, r × reach, dur × duration, custom keys passed through.
- Impl (`ED.WIMPL[id]`): `{fire(w, p, ws, S) → bool fired, tick?(w, p, ws, S, dt), init?(w, p, ws), draw?}`. The runtime runs `tick`, decrements `ws.cd`; at ≤ 0 it calls `fire` (which picks targets via `w.target(mode, p, range)`); true resets `cd = S.cd` and emits `shoot`, false retries in 0.1 s.
- Primitives on World (combat.js): `w.shoot(p, wid, x, y, a, S, opt)` → projectile (opt `{look, speed, dmg, pierce, r, life, homing, ret, rehit, knock, solid, onHit(w, pr, e, dealt), onEnd(w, pr), tick(w, pr, dt), st}`); `w.arc(p, wid, x, y, a, r, arc, dmg, opt)` → hit count (opt `{knock, look, onHit(w, e, dealt), crit, slow, stun, freeze, burn, kind, noEv}`); `w.blast(p, wid, x, y, r, dmg, opt)`; `w.zone(opt)` (fields in §4); `w.chain(p, wid, e, hops, range, dmg, opt)`; `w.hitFoe(e, dmg, src)` → dealt; `w.target(mode, p, range)` → foe | null for nearest/random, scratch point `w.pt {x, y, a}` | null for densest, scratch point for facing (range ahead along `p.mdir`) and around (the hero); `w.densest(x, y, range)` → `w.pt` | null; `w.src(p, wid, kind, knock)` → pooled `{p, wid, crit, critC, knock, kx, ky, x, y, kind}`; `w.hitBraziers(x, y, r, p)`.
- Evolution: a weapon at level 8 whose `pair` passive is owned is evolution-ready; the next chest swaps `id` to `evo`, keeps the slot and level 8.

## 7. Hero stats

`ED.Stats.compute(p)` → `{maxHp, armor, regen, speed, pickup, might, haste, reach, velocity, duration, amount, luck, growth, greed, crit, critMul, revival, rerolls, skips}`. Sources: hero base + passives (`ED.PASSIVES[id].per` × lvl, or `per[key][lvl-1]` for arrays) + meta shop ranks (`p.meta.shop`) + `ED.HOOK[cls].stats(p, add)`. Recomputed on every pick (`w.recalc`).

## 8. Progress

- XP is party-wide (`w.xp`, `w.level`, `w.xpNext`; `ED.World.xpFor(L)` = 5 + 8(L−1) up to L 20, then 157 + 15(L−20)). On level-up, every living hero queues one (`p.pend`) and gets an offer (`p.offer` = 3–4 cards). Solo: `w.paused` until picked. Co-op: no pause; 1 s invulnerability after picking. Input `pick` (1..4), `reroll`, `skip` resolve it.
- Card: `{kind:'weapon'|'wlvl'|'passive'|'plvl'|'skill'|'gold'|'heal', id, lvl (after the pick), name, txt, sub (second line or ''), icon}`. `txt` is one line ≤ 40 characters. Signature weapons of other heroes are offered only when in `meta.sigs`.
- Gems merge above 350 on the ground. Magnet radius = stats.pickup. The magnet pickup vacuums all gems.

## 9. Net

- PeerJS transport kept from legacy (`git show legacy-wickdeep:src/net.js`). The host runs the World; clients send inputs at 30 Hz and receive snapshots at 20 Hz.
- Snapshots are binary (ArrayBuffer, DataView): header (tick, time, xp, level, flags), heroes (full), and foes / projectiles / pickups / zones inside the client's view rect plus a 160 px margin (interest culling), quantized (positions int16 at 0.5 px, hp as a byte), plus that tick window's events (capped). Target ≤ 12 KB per snapshot.
- Clients predict their own hero's movement and dash; everything else interpolates between snapshots.
- `ED.NET_VERSION` (= `ED.Net.VERSION`) bumps on any wire change.
- Foundation status: transports, lobby and member picks (`{cls, meta:{shop, sigs}}`) are wired; `ED.Net.encodeSnap` / `decodeSnap` are `null` stubs and co-op sessions are not started from the UI (net lane).

## 10. Client

- **View model** (`ED.Game.view`): `{me, heroes[], foes[], projs[], zones[], pickups[], props, stage, seed, time, xp, xpNext, level, kills, gold, boss, events[]}`. On host/solo, the arrays alias the World arrays; on clients, they come from decoded snapshots with the same render-visible field names (marked * in §4).
- **ED.Batch** (gl.js): `init(ctx)`, `begin(camX, camY, scale)`, `spr(animId, frame, x, y, o)` with `o = {flip, flash (0..1 white), alpha, rot, sx, sy, tint (0xRRGGBB mul), add (additive)}`, `rect(x, y, w, h, rgba)`, `circ(x, y, r, rgba, lw)` (no lw = fill), `line(x0, y0, x1, y1, lw, rgba)`, `cone(x, y, r, a, arc, rgba, lw)`, `shadow(x, y, rx)`, `img(src, x, y, w, h)`, `text(s, x, y, color, k, align, alpha)`, `end()`; `crowd` (live foe count for LOD), `stats`. Colours: `rgba` = 0xRRGGBBAA, `tint`/`color` = 0xRRGGBB. World units: 1 art px = 1 world px (`ED.Atlas` K = 1); the view is 640×360 world px integer-scaled to the canvas. The WebGL path: all atlas pages uploaded once as textures, instanced (ANGLE_instanced_arrays / WebGL2) quads, one draw per page per blend mode, y-sort done by the caller. The Canvas2D fallback implements the same API through `ED.Atlas.draw` with crowd LOD (skip shadows and flashes above 250 foes).
- **render.js** layer order: floor (cached chunk canvases or a GL tiled floor) → ground decals and zones/telegraphs → pickups → y-sorted actors (heroes, foes, minions, bosses, props) → projectiles → FX → overlays (damage numbers, bars, names, offscreen arrows) → post.
- Telegraphs must be readable over a dense horde (bright outline + fill pulse).
- Text sizes: card text ≥ 20 px CSS, HUD numbers ≥ 16 px CSS, plain pixel font ('Pixel Operator').

## 11. Performance gates

- `tools/check-perf.js`: 900 foes + 600 projectiles + 400 gems, sim ≤ 2.5 ms per tick average on this machine (report worst tick).
- `tools/browse.js crowd900`: frame time p95 ≤ 8 ms on the GPU path (headless Chromium), and the Canvas2D fallback stays playable (report p95).
- `tools/check-net.js` (net lane): snapshot bytes at 900 foes with interest culling ≤ 12 KB.

## 12. Checks (headless only, exit 1 on failure)

- `tools/check-sim.js`: a full 15-minute solo run and a 4-hero run with scripted inputs, no exceptions; two runs with the same seed and inputs give the same digest; victory reachable with a cheat build.
- `tools/check-perf.js`. Save checks live in check-sim (code round trip, applyRun). `tools/check-net.js` arrives with the net lane.
- `node tools/art.js --check`.
- `tools/browse.js smoke|crowdN` (Playwright, headless Chromium; never a visible window). Screenshots go to `%TEMP%/wickdeep-browse/`.
