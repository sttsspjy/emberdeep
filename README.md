# Wickdeep

A co-op survivors-like that runs in the browser. Hordes pour into an open arena; your weapons fire on their own while you move, dodge, dash and fire two hero skills. Survive 15 minutes, beat the final boss, and spend the gold at Camp between runs.

No build step, no backend, no install. It is a static site: open it from any web host and play.

**Play online:** https://sttsspjy.github.io/emberdeep/ (the repository keeps its old name)

> Balance is not tuned yet: numbers will change.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD or arrow keys | Left stick |
| Aim skills | Mouse | Right stick |
| Skill 1 (Q) | Q | RB |
| Skill 2 (E) | E | LB |
| Dash | Space | A |
| Pick a level-up card | 1–4 or click | X / Y / B / RT |
| Reroll / skip cards | R / X | |
| Banish a card | Banish button, then click the card | |
| Pause | Esc | Start |

Mouse buttons do nothing in a run by default; the mouse only aims. Weapons fire automatically. Facing weapons (Cleave, Twin Daggers, Bone Spear) swing or throw toward the nearest foe in front of you, or the nearest foe anywhere when none is in front. Keys follow the physical key position, so they work on any keyboard layout.

Menus work with the keyboard too: arrows or WASD move between buttons, Enter presses, Esc goes back.

## A run

1. Pick a hero, then a stage.
2. Collect the gems foes drop. Each level offers 3–4 cards: a new weapon, a weapon level, a passive or a skill level. Solo play pauses while you choose.
3. A weapon at level 8 evolves when you also own its paired passive: open the next chest to evolve it. Elites drop chests.
4. Bosses arrive at 5:00 and 10:00; the final boss at 15:00. Beat it to win.
5. Break braziers for gold, food, a magnet or a holy bomb.
6. The results screen shows how much damage each weapon and skill dealt.

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

Knight, Ranger and Pyro are open from the start. Necro: survive 10 minutes. Cleric: beat stage 1. Shade: kill 3000 foes in one run. Bellwarden: reach level 40 in one run. Stages 2 and 3 open when you beat the stage before.

## Camp and saving

Gold buys permanent ranks at Camp (damage, health, armor, regen, speed, pickup radius, XP, gold, luck, revivals, rerolls, skips, banishes). Refund all gives every coin back.

**Achievements** (main menu) lists every unlock with your progress toward it, plus your records: runs, wins, lifetime kills, best time, kills and level, and each stage's best run. **Encyclopedia** (main menu) describes every hero, weapon (with its levels and evolution recipe), passive, foe, boss and stage, locked ones included.

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
- Checks (headless, exit 1 on failure): `node tools/check-sim.js`, `node tools/check-perf.js`, `node tools/check-*.js`, `node tools/art.js --check`, `node tools/browse.js smoke|shots|coop|crowd900|late` (browser checks need Playwright; add `--software` for the Canvas2D path).
- Weapon balance bench: `node tools/bench.js` runs bot runs over stage × hero × weapon in parallel and writes `bench-out/<time>/report.html` (win %, final-boss kill time, damage taken per minute, strength relative to the hero's other weapons with 95% ranges, damage share, deaths) for a normal (`--skill 1`) and a sloppy (`0.3`) bot. `--quick` for a short look, `--help` for every flag. One run: `node tools/bot.js --stage 0 --hero knight --weapon bonespear`.
- Watch the bot: open `index.html?bot=1` (optional `&speed=1..16`, `&weapon=<id>`, `&fill=on|off`, `&seed=<n>`, `&meta=none|max|profile`; seed + weapon + fill + meta replay a bench cell), pick a hero and stage; `[` / `]` change speed. Bot runs are not saved to the profile.

## Credits

The art in Wickdeep is built from third-party pixel-art packs and pixel fonts.

DawnLike tileset by DragonDePlatino (CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181), using the DawnBringer DB16 palette by DawnBringer. Cropped and recoloured for Wickdeep.

Free Pixel Effects Pack by CodeManu (Davit Masia), CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/ ; https://codemanu.itch.io/pixelart-effect-pack). Frames subsampled and recoloured for Wickdeep.

Pixel Operator font by Jayvee Enaguas (HarvettFox96), CC0.

16x16 DungeonTileset II by 0x72 (Robert); Dungeon Tileset II Extended by nijikokun; 16x16 Dark Dungeon by kosinaz; Ninja Adventure by Pixel-boy and AAA; Puny Characters by Shade; LuizMelo; Kenney; o_lobster; Aim studios; ansimuz.

The same credits are in the game under **Credits** in the main menu. `art-src/SOURCES.md` lists every vendored file with its pack, author, licence and hash.
