# Wickdeep — Masterplan

North-star: a co-op browser survivors-like (solo or up to 4 friends, zero install) where a good run turns the screen into a blender. Rules and numbers: [GAME-DESIGN.md](GAME-DESIGN.md). Code contract: [ARCHITECTURE.md](ARCHITECTURE.md). The old dungeon game is kept at git tag `legacy-wickdeep`.

## Survivors rebuild (Survival mode)
- [x] Foundation: arena, horde, spawner, level-up cards, Camp shop, save code
- [x] Renderer and juice: WebGL batcher with Canvas2D fallback, hit effects, shake, damage numbers, readable late game
- [x] Horde, stages and timelines: special foe brains, swarm events, elites, three stages, density floor
- [x] 12 general weapons and their evolutions
- [x] 7 heroes with signature weapons (and evolutions), Q and E skills
- [x] 9 bosses (3 per stage)
- [x] Co-op: host runs the game, friends join with a code, slot colours
- [x] HUD, menus, results screen, unlocks
- [x] Music and sound
- [x] Facing weapons aim at the nearest foe when none is in front; shorter dash, Shield Charge and Shadow Step
- [x] Achievements and Encyclopedia screens
- [x] Bot benchmark: win rate, boss kill time and damage taken per stage × hero × weapon (`node tools/bench.js`), bot watch mode (`?bot=1`)

## Next
- [ ] Your playtest: feel, balance, readability (all numbers untuned)
- [ ] Weapon balance pass using the bench report (bot wins ~100% on stages 1–2 at full skill: game may be too easy)
- [ ] Co-op test over a real internet connection
- [ ] Canvas2D fallback: late-game frames still over budget
- [ ] Art gaps: per-stage foe colours, Q/E skill icons, own art for The Twins, Rift Weaver, Wick-Eater
- [ ] Waves mode (planned): second game mode; rules to be decided with you
- [x] Merged into main
- [ ] Publish on GitHub Pages
