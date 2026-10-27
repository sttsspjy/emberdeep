# Wickdeep

A co-op survivors-like that runs in the browser. Hordes pour into an open arena; your weapons fire on their own while you move, dodge, dash and fire two hero skills. Survive 15 minutes, beat the final boss, and spend the gold at Camp between runs.

No build step, no backend, no install. It is a static site: open it from any web host and play.

**Play online:** https://sttsspjy.github.io/emberdeep/ (the repository keeps its old name)

> The game is being rebuilt from the old dungeon roguelite. Solo play works now; online co-op, most heroes' full kits, general weapons and bosses are in progress.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD or arrow keys | Left stick |
| Aim skills | Mouse | Right stick |
| Skill 1 (Q) | Q or left mouse | RB |
| Skill 2 (E) | E or right mouse | LB |
| Dash | Space | A |
| Pick a level-up card | 1–4 or click | X / Y / B / RT |
| Reroll / skip cards | R / X | |
| Pause | Esc | Start |

Weapons fire automatically. Keys follow the physical key position, so they work on any keyboard layout.

## A run

1. Pick a hero, then a stage.
2. Collect the gems foes drop. Each level offers 3–4 cards: a new weapon, a weapon level, a passive or a skill level. Solo play pauses while you choose.
3. A weapon at level 8 evolves when you also own its paired passive: open the next chest to evolve it. Elites drop chests.
4. Bosses arrive at 5:00 and 10:00; the final boss at 15:00. Beat it to win.
5. Break braziers for gold, food, a magnet or a holy bomb.

## Heroes

Knight, Ranger and Pyro are open from the start. Necro: survive 10 minutes. Cleric: beat stage 1. Shade: kill 3000 foes in one run. Bellwarden: reach level 40 in one run. Stages 2 and 3 open when you beat the stage before.

## Camp and saving

Gold buys permanent ranks at Camp (damage, health, armor, regen, speed, pickup radius, XP, gold, luck, revivals, rerolls, skips). Refund all gives every coin back.

Progress saves in the browser automatically. Camp → **Show my code** gives a save code you can paste into **Load code** on another browser or device.

## Hosting it

Any static file host works. Upload this folder as-is:

- **GitHub Pages:** push the folder to a repository, then Settings → Pages → deploy from branch.
- **Netlify / Vercel / Cloudflare Pages:** drag and drop the folder, or point a project at it with no build command.
- **itch.io:** zip the folder and upload it as an HTML game.

For local play, serve the folder with any static server, for example `npx serve .` or `python -m http.server`. Opening `index.html` straight from disk also works.

`?slot=2` keeps a second profile in the same browser.

## Development

- Code contract: `docs/ARCHITECTURE.md`. Rules and numbers: `docs/GAME-DESIGN.md`.
- Checks (headless, exit 1 on failure): `node tools/check-sim.js`, `node tools/check-perf.js`, `node tools/art.js --check`, `node tools/browse.js smoke` (needs Playwright).

## Credits

The art in Wickdeep is built from third-party pixel-art packs and pixel fonts.

DawnLike tileset by DragonDePlatino (CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181), using the DawnBringer DB16 palette by DawnBringer. Cropped and recoloured for Wickdeep.

Free Pixel Effects Pack by CodeManu (Davit Masia), CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/ ; https://codemanu.itch.io/pixelart-effect-pack). Frames subsampled and recoloured for Wickdeep.

Pixel Operator font by Jayvee Enaguas (HarvettFox96), CC0.

16x16 DungeonTileset II by 0x72 (Robert); Dungeon Tileset II Extended by nijikokun; 16x16 Dark Dungeon by kosinaz; Ninja Adventure by Pixel-boy and AAA; Puny Characters by Shade; LuizMelo; Kenney; o_lobster; Aim studios; ansimuz.

The same credits are in the game under **Credits** in the main menu. `art-src/SOURCES.md` lists every vendored file with its pack, author, licence and hash.
