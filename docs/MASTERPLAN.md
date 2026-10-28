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

## Hero redesign (after the first full playtest)
- [x] One weapon per hero: 3 paths, hidden Forms (5 per hero, 2 of them secret hybrids), one Form per run; general weapons removed
- [x] One skill (Q) per hero that grows with the weapon and your level
- [x] Each hero plays a different role: brawler, marksman, fire zones, summoner, healer, assassin, crowd control
- [x] Slower pace; no damage outside your screen; pixel-only drawing
- [x] Harder: new foe kinds at 5 and 10 minutes, a 12-minute benchmark surge, slower levelling
- [x] More gold: boss and win gold, later stages pay more, a kill bounty even when you lose
- [x] Form icons
- [ ] Readability pass on every Form's visuals
- [ ] Your playtest of the redesign

## Next
- [ ] Balance from your playtest (difficulty, Form strength, skill value)
- [ ] Co-op test over a real internet connection
- [ ] Art gaps: per-stage foe colours, own art for The Twins, Rift Weaver, Wick-Eater
- [ ] Waves mode (planned): second game mode; rules to be decided with you
- [ ] Publish on GitHub Pages
