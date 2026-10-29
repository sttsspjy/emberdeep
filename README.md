# Wickdeep

A co-op survivors-like that runs in the browser. Hordes pour into an open arena; your weapons fire on their own while you move, dodge, dash and fire your hero skill. Survive 15 minutes, beat the final boss, and spend the gold at Camp between runs.

No build step, no backend, no install. It is a static site: open it from any web host and play.

**Play online:** https://sttsspjy.github.io/emberdeep/ (the repository keeps its old name)

> Balance is not tuned yet: numbers will change.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD or arrow keys | Left stick |
| Aim weapon and skill | Mouse | Right stick (else the left stick direction) |
| Hero skill | Q | RB or LB |
| Dash | Space | A |
| Pick a level-up card | 1–4 or click | X / Y / B / RT |
| Reroll / skip cards | R / X | |
| Banish a card | Banish button, then click the card | |
| Pause | Esc | Start |

Mouse buttons do nothing in a run by default; the mouse aims. Your weapon fires automatically, straight toward the cursor: swings, arrows, bolts, shards, stabs and beam sweeps go exactly where you point. A few attacks pick their own targets on your screen: Pyro shells, Plague Field globs, Smite pillars, minions and the Shade's Assassinate mark. Orbits, auras and spins hit all around you. Keys follow the physical key position, so they work on any keyboard layout.

Menus work with the keyboard too: arrows or WASD move between buttons, Enter presses, Esc goes back.

## A run

1. Pick a hero, then a stage.
2. Collect the gems foes drop. Each level offers 3–4 cards: a rank on one of a weapon's three paths, a new support weapon (up to 2, from a shared pool of 8), a passive (up to 6) or a skill level. Every rank changes how the weapon looks and fires. Solo play pauses while you choose.
3. A path at rank 3 readies a **Form**: a new shape of that weapon. Forms come only from chests (see 4). Unknown Forms show as ???. Each weapon takes one Form; after that it can be refined twice.
4. A boss chest lets you pick a Form for one weapon with a Form ready (else it gives an extra level-up). Elite chests level a passive or your skill; from 12:00 they also offer a Form when one is ready. In co-op every hero gets a chest reward, whoever opens it.
5. Bosses arrive at 5:00 and 10:00; the final boss at 15:00. Beat it to win.
6. Break braziers for gold, food, a magnet or a holy bomb. A brazier relights a minute after it breaks once you are away from it; elites often drop food.
7. The results screen shows your build and how much damage each weapon and your skill dealt.

## Stages and bosses

| Stage | 5:00 | 10:00 | Final (15:00) |
|---|---|---|---|
| The Ossuary | Bone Warden | The Twins | Hollow King |
| The Glowmire | Sporemother | Demon Cyclops | Drowned King |
| The Abyss | Blue Samurai | Rift Weaver | The Wick-Eater |

Every boss and elite attack is telegraphed: a red outline marks where it lands. A final boss still alive at 17:00 enrages. The horde never thins out: if you kill faster than it arrives, more foes pour in.

## Co-op (2–4 players)

1. One player picks **Host co-op** and shares the 5-letter party code.
2. The others pick **Join co-op** and enter the code.
3. Everyone picks a hero and presses **Ready**; the host picks the stage and presses **Start run**.

The host's browser runs the game, so the host needs the steadiest connection. Co-op never pauses: level-up cards appear in a strip at the bottom, pick with 1–4 while you keep moving. Each player's hero wears their slot colour (gold, blue, green, pink); your own hero has a ring under it. A downed hero is revived by a teammate standing next to them. Leaving from the pause menu ends your part of the run.

## Heroes

Each hero has one weapon of their own (three paths, hidden Forms), room for two support weapons and one skill on Q, and each plays a different role: the Knight brawls inside the crowd, the Ranger shoots long piercing lines, the Pyro paints the ground with fire, the Necro grows an army, the Cleric heals and smites, the Shade stabs and crits up close, and the Bellwarden holds the horde back. Knight, Ranger and Pyro are open from the start. Necro: survive 10 minutes. Cleric: beat stage 1. Shade: kill 3000 foes in one run. Bellwarden: reach level 25 in one run. Stages 2 and 3 open when you beat the stage before.

## Camp and saving

Gold buys permanent ranks at Camp (damage, health, armor, regen, speed, pickup radius, XP, gold, luck, revivals, rerolls, skips, banishes). Refund all gives every coin back.

**Achievements** (main menu) lists every unlock with your progress toward it, plus your records: runs, wins, lifetime kills, best time, kills and level, and each stage's best run. **Encyclopedia** (main menu) describes every hero, weapon and support weapon (with its paths and the Forms you found), passive, foe, boss and stage you have met: heroes and stages you started a run with, weapons, Forms and passives you owned, foes you saw and bosses you fought. The rest shows as a dark "???" until you find it; locked heroes and stages still show how to unlock them.

Progress saves in the browser automatically. Camp → **Show my code** gives a save code you can paste into **Load code** on another browser or device. The code carries your Encyclopedia discoveries too; an older code still loads.

## Hosting it

Any static file host works. Upload this folder as-is:

- **GitHub Pages:** push the folder to a repository, then Settings → Pages → deploy from branch.
- **Netlify / Vercel / Cloudflare Pages:** drag and drop the folder, or point a project at it with no build command.
- **itch.io:** zip the folder and upload it as an HTML game.

For local play, serve the folder with any static server, for example `npx serve .` or `python -m http.server`. Opening `index.html` straight from disk also works.

`?slot=2` keeps a second profile in the same browser.

## Development

- Code contract: `docs/ARCHITECTURE.md`. Rules and numbers: `docs/GAME-DESIGN.md`.
- Checks (headless, exit 1 on failure): `node tools/check-sim.js`, `node tools/check-perf.js`, `node tools/check-*.js`, `node tools/art.js --check`, `node tools/browse.js smoke|shots|coop|crowd900|late` (browser checks need Playwright; add `--software` for the Canvas2D path).
- Hero balance bench: `node tools/bench.js` runs bot runs over stage × hero × seed in parallel and writes `bench-out/<time>/report.html` (win %, final-boss kill time, damage taken per minute, strength relative to the mean hero with 95% ranges, Form rate and time, deaths) for a normal (`--skill 1`) and a sloppy (`0.3`) bot. `--quick` for a short look, `--help` for every flag. One run: `node tools/bot.js --stage 0 --hero knight`.
- Watch the bot: open `index.html?bot=1` (optional `&speed=1..16`, `&seed=<n>`, `&meta=none|max|profile`; seed + meta replay a bench cell), pick a hero and stage; `[` / `]` change speed. Bot runs are not saved to the profile.

## Credits

The art in Wickdeep is built from third-party pixel-art packs and pixel fonts.

DawnLike tileset by DragonDePlatino (CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181), using the DawnBringer DB16 palette by DawnBringer. Cropped and recoloured for Wickdeep.

Free Pixel Effects Pack by CodeManu (Davit Masia), CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/ ; https://codemanu.itch.io/pixelart-effect-pack). Frames subsampled and recoloured for Wickdeep.

Pixel Operator font by Jayvee Enaguas (HarvettFox96), CC0.

16x16 DungeonTileset II by 0x72 (Robert); Dungeon Tileset II Extended by nijikokun; 16x16 Dark Dungeon by kosinaz; Ninja Adventure by Pixel-boy and AAA; Puny Characters by Shade; LuizMelo; Kenney; o_lobster; Aim studios; ansimuz.

The same credits are in the game under **Credits** in the main menu. `art-src/SOURCES.md` lists every vendored file with its pack, author, licence and hash.
