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
src/util.js                 U (math, RNG, uid), ED.CONST
src/data/foes.js            ED.FOES, ED.FOE_IDS, ED.FOE_IDX (append-only wire index)
src/data/stages.js          ED.STAGES (theme, arena, timeline, events, bosses)
src/data/passives.js        ED.PASSIVES, ED.PASSIVE_IDS
src/data/meta.js            ED.SHOP (permanent ranks), ED.UNLOCKS
src/save.js                 profile load/save, save code
src/sim/stats.js            ED.Stats: hero stat block, weapon effective numbers
src/sim/arena.js            ED.Arena: arena gen (obstacles, braziers), collision (bounds + circles), movement helpers
src/sim/grid.js             foe spatial grid + separation (ported from legacy world.js)
src/sim/world.js            ED.World: ctor, tick order, players, run flow, downed/revive, events
src/sim/combat.js           hitFoe, explode, statuses, projectile pool, zone pool, hurtHero
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
src/client/gl.js            ED.Batch WebGL sprite batcher (+ Canvas2D fallback implementing the same API)
src/client/render.js        frame: camera, floor, layer order, telegraphs, present
src/client/post.js          WebGL post (bloom/grade/vignette), shares the context with gl.js
src/client/actors.js        picks anim/frame/flip/tint for heroes, foes, bosses, minions → ED.Batch
src/client/fx.js            juice: particles, death bursts, damage numbers, hit-stop, shake, flashes, rings
src/client/audio.js         SFX synth with per-sound voice budget
src/client/music.js         synthesized music, intensity from alive count and boss state
src/client/input.js aim.js  keyboard/mouse (e.code), aim
src/client/hud.js           in-run HUD (canvas)
src/client/ui.js            DOM screens
src/main.js                 app state machine + frame loop
```

Node load order (`tools/sim.js` FILES): util, data/*, save, sim/stats, sim/arena, sim/grid, sim/world, sim/combat, sim/foes, sim/ai, sim/spawner, sim/weapons, sim/skills, sim/progress, sim/bosses, sim/boss-*, weapons/*, heroes/*.

## 3. Registries (how lanes plug in without editing core files)

- `ED.WEAPONS[id] = def` and `ED.WIMPL[id] = impl` — registered by `src/weapons/*.js` and `src/heroes/*.js`.
- `ED.HEROES[cls] = def`, `ED.HERO_IDS` (order: knight, ranger, pyro, necro, cleric, shade, bell; append-only).
- `ED.CAST[skillId] = fn` — Q/E casts.
- `ED.AI[brain] = fn(w, e, dt)`.
- `ED.Bosses[id] = fn(w, e, dt)` via `ED.Bosses.lib.runner`.
- `ED.HOOK` — optional per-hero hooks `{init(w,p), tick(w,p,dt), kill(w,p,e), hit(w,p,e,dmg,src)}` keyed by cls.
- Client: `ED.WeaponFx[id]`, `ED.SkillFx[skillId]`, `ED.BossFx[id]` — optional draw hooks the renderer calls when present.

## 4. Sim entities (render-visible fields are marked *)

All entities are plain objects from pools; `dead` marks removal; arrays are compacted in place once per tick.

**Hero** `p`: pid*, slot*, cls*, name*, x*, y*, vx, vy, face* (aim angle), mvx, mvy, moving*, r=10, hp*, maxHp*, stats (ED.Stats block), weapons*: `[{id, lvl, evo, cd, st:{}}]` (max 6), passives*: `[{id, lvl}]` (max 6), skills*: `[{id, lvl, cd, cdMax}]` (Q, E), dashCd*, dashT*, invuln*, hurtT*, downed*, bleed*, revive* (0..1), dead*, kills, dealt (per weapon id map for the results screen), offer* (array of cards or null), rerolls, skips.

**Foe** `e`: id*, k* (FOE_IDX), def, x*, y*, vx, vy, r, hp, maxHp, hpQ* (0..255), dmg, spd, kbx, kby, face* (−1/1), flash* (s), st* (0 move, 1 windup, 2 act), stT*, elite*, boss*, slowT, slowK, burnT, burnDps, burnOwner, stunT*, freezeT*, hitT (last-hit tick stamp for pierce dedupe), vars (brain state, created lazily), dead.

**Projectile** `pr`: id*, k* (look id string index), team (0 hero, 1 foe), owner (pid or foe id), wid (weapon id), x*, y*, vx, vy, a*, r, dmg, pierce, life, hits (small int array of foe ids, pooled), homing, ret, onHit, onEnd, dead.

**Zone** `z`: id*, k* (look), team, x*, y*, r*, a*, len*, w*, t*, dur*, tick, dps, follow, warn* (telegraph flag), dead. Telegraphs are zones with `warn` true and `dur` ≥ 0.6 s for foe/boss attacks.

**Pickup** `g`: id*, k* ('xp1','xp5','xp25','gold','food','magnet','bomb','chest'), x*, y*, val, vx, vy, pull (being vacuumed), dead.

**Prop** (obstacles and braziers): from `ED.Arena.generate(stage, seed)`; deterministic, so clients rebuild it from the seed. Braziers carry `hp` and a broken flag that rides events.

## 5. World

- `new ED.World({seed, stage, players:[{pid, name, slot, cls, meta}], mode:'survival'})`.
- `w.update(dt)` fixed step 1/60. Order: inputs → heroes (move, dash, timers, downed) → spawner → foes (brains, steer, contact) → grid rebuild + separation → weapons (auto-fire) → skills → projectiles → zones → pickups/progress → bosses timers → compaction → run state (timer, victory, defeat).
- `w.time` (s), `w.minute()`, `w.paused` (solo level-up), `w.state` 'play' | 'won' | 'lost'.
- `w.input(pid, {mx, my, ax, ay, dash, q, e, pick, reroll, skip})` — applied at the next tick; the host calls it for remote players too.
- `w.emit(ev)` pushes events to `w.events` (cleared by the session after it reads them). Event types: `hit` (aggregated per foe per tick: id, x, y, dmg, crit), `die` (foe id, k, x, y, elite, boss), `shoot` (weapon id, pid), `swing`, `skill` (pid, id, x, y, a), `boom` (x, y, r, look), `pickup` (k, pid), `level` (level), `offer` (pid), `evolve` (pid, wid), `hurt` (pid, dmg), `down`/`revive` (pid), `boss` (id, phase), `brazier` (id), `chest` (pid, results), `warn` (event announcements: swarm, elite, boss incoming), `end` (won, summary). Hit events are capped at 200 per tick (largest first).
- `w.summary()` → `{won, time, kills, level, gold, perHero:[{pid, cls, dealt:{wid: dmg}}]}`.

## 6. Weapons

Weapon def (`ED.WEAPONS[id]`):
```
{ id, name, icon (atlas anim id), sig: cls|null, mode: 'nearest'|'facing'|'random'|'around'|'densest',
  base: {dmg, cd, n, pierce, area, speed, dur, knock, range},
  levels: [ {mods:{...}, txt:'one line'} × 7 ],   // levels 2..8
  pair: passiveId, evo: evolvedId,               // general weapons and signatures
  evolved: true|undefined }                       // evolved defs are not offered as cards
```
- Effective numbers `S = ED.Stats.weapon(p, slot)`: dmg = base.dmg × (1 + Σ lvl dmg) × (1 + might); cd = base.cd × (1 + Σ lvl cd) × (1 − haste), floor 0.12 s; n = base.n + Σ lvl n + amount; area = base.area × (1 + Σ lvl area) × (1 + reach); speed × (1 + velocity); dur × (1 + duration); pierce = base.pierce + Σ lvl pierce; plus any custom flag mods (booleans/numbers passed through).
- Impl (`ED.WIMPL[id]`): `{fire(w, p, ws, S) → bool fired, tick?(w, p, ws, S, dt), draw?}`. The runtime decrements `ws.cd`; at ≤ 0 it calls `fire` (which picks targets via `w.target(mode, p, range)`) and resets `cd = S.cd` when it returns true.
- Primitives on World (combat.js): `w.shoot(p, wid, x, y, a, S, opt)` → projectile; `w.arc(p, wid, x, y, a, r, arc, dmg, opt)`; `w.blast(p, wid, x, y, r, dmg, opt)`; `w.zone(opt)`; `w.chain(p, wid, e, hops, range, dmg)`; `w.hitFoe(e, dmg, src)` → dealt; `w.target(mode, p, range)` → foe | point; `w.densest(x, y, range)` → point. `src` objects are pooled; `src = {p, wid, crit, knock, kx, ky, kind}`.
- Evolution: a weapon at level 8 whose `pair` passive is owned is evolution-ready; the next chest swaps `id` to `evo`, keeps the slot and level 8.

## 7. Hero stats

`ED.Stats.compute(p)` → `{maxHp, armor, regen, speed, pickup, might, haste, reach, velocity, duration, amount, luck, growth, greed, crit, critMul, revival}`. Sources: hero base + passives (`ED.PASSIVES[id].per` × lvl) + meta shop ranks + hero hooks. Recomputed on every pick.

## 8. Progress

- XP is party-wide (`w.xp`, `w.level`, `w.xpNext`). On level-up, every living hero gets an offer (`p.offer` = 3–4 cards). Solo: `w.paused` until picked. Co-op: no pause; 1 s invulnerability after picking.
- Card: `{kind:'weapon'|'wlvl'|'passive'|'plvl'|'skill'|'gold'|'heal', id, lvl, name, txt, icon}`. `txt` is one line ≤ 40 characters.
- Gems merge above 350 on the ground. Magnet radius = stats.pickup. The magnet pickup vacuums all gems.

## 9. Net

- PeerJS transport kept from legacy (`git show legacy-wickdeep:src/net.js`). The host runs the World; clients send inputs at 30 Hz and receive snapshots at 20 Hz.
- Snapshots are binary (ArrayBuffer, DataView): header (tick, time, xp, level, flags), heroes (full), and foes / projectiles / pickups / zones inside the client's view rect plus a 160 px margin (interest culling), quantized (positions int16 at 0.5 px, hp as a byte), plus that tick window's events (capped). Target ≤ 12 KB per snapshot.
- Clients predict their own hero's movement and dash; everything else interpolates between snapshots.
- `ED.NET_VERSION` bumps on any wire change.

## 10. Client

- **View model** (`ED.Game.view`): `{me, heroes[], foes[], projs[], zones[], pickups[], props, stage, time, xp, level, boss, events[]}`. On host/solo, the arrays alias the World arrays; on clients, they come from decoded snapshots with the same render-visible field names (marked * in §4).
- **ED.Batch** (gl.js): `begin(camX, camY, scale)`, `spr(animId, frame, x, y, o)` with `o = {flip, flash (0..1 white), alpha, rot, sx, sy, tint (0xRRGGBB mul), add (additive)}`, `rect(x, y, w, h, rgba)`, `end()`. The WebGL path: all atlas pages uploaded once as textures, instanced (ANGLE_instanced_arrays / WebGL2) quads, one draw per page per blend mode, y-sort done by the caller. The Canvas2D fallback implements the same API through `ED.Atlas.draw` with crowd LOD (skip shadows and flashes above 250 foes).
- **render.js** layer order: floor (cached chunk canvases or a GL tiled floor) → ground decals and zones/telegraphs → pickups → y-sorted actors (heroes, foes, minions, bosses, props) → projectiles → FX → overlays (damage numbers, bars, names, offscreen arrows) → post.
- Telegraphs must be readable over a dense horde (bright outline + fill pulse).
- Text sizes: card text ≥ 20 px CSS, HUD numbers ≥ 16 px CSS, plain pixel font ('Pixel Operator').

## 11. Performance gates

- `tools/check-perf.js`: 900 foes + 600 projectiles + 400 gems, sim ≤ 2.5 ms per tick average on this machine (report worst tick).
- `tools/browse.js crowd900`: frame time p95 ≤ 8 ms on the GPU path (headless Chromium), and the Canvas2D fallback stays playable (report p95).
- `tools/check-net.js`: snapshot bytes at 900 foes with interest culling ≤ 12 KB.

## 12. Checks (headless only, exit 1 on failure)

- `tools/check-sim.js`: a full 15-minute solo run and a 4-hero run with scripted inputs, no exceptions; two runs with the same seed and inputs give the same digest; victory reachable with a cheat build.
- `tools/check-perf.js`, `tools/check-net.js`, `tools/check-save.js`.
- `node tools/art.js --check`.
- `tools/browse.js smoke|shots|crowdN` (Playwright, headless Chromium; never a visible window).
