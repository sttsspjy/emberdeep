# Handoff 2026-10-24 (UI)

The pixel UI overhaul (user request 2026-10-23) is on `feat/ui-pixel` (game-ui advisor, worktree `.claude/worktrees/ui-adv`). It is cut from `feat/v4-1` and holds all of `feat/v4-1` up to `c64f950` (armory-a, armory-b, hp-scale). It is not merged into `feat/v4-1`: tell game-4a before merging (agreement 2026-10-23). Rules: [GAME-DESIGN.md](GAME-DESIGN.md) §11 (UI pixel kit, Boon cards, HUD, Tab sheet, Audio, Art). Kanban: [MASTERPLAN-AGENT.md](MASTERPLAN-AGENT.md).

## Implemented (mechanism)
- **Fonts**:
  - Vendored in `art-src/fonts/`: Pixel Operator (CC0) only. Titles, banners, names, tabs and menu items are Pixel Operator Bold (user, 2026-10-24).
  - `tools/art.js` re-grids them to 16 font px per em and packs them as WOFF into `src/art/fonts.css`, linked before `style.css`. Google Fonts are gone, and `browse.js` blocks every external host.
  - Wordmark and results word: 1 font px = 3 art px (`--fs-word` 48k), colour bands on font rows.
- **Grid** (`src/client/pixui.js`, `ED.PixUI`):
  - k = floor(min(W·dpr/480, H·dpr/270)) device px per art px. CSS vars `--p`, `--pf`, `--dp`, `--ic*`; font tokens are 16n device px.
  - Chromium/Windows DOM text needs a .5 device-px origin: `PixUI.bias` and `PixUI.snap` handle it.
- **Frames**: ASCII masks are baked at boot through `PixUI.frame` into `--fr-*` data URLs and used via `border-image` or `PixUI.nine` (canvas). Masks live in:
  - `uiart.js`: base and HUD;
  - `screenart.js`: tabs, Hearth plaque, Armory rack, results banner, menu vignette;
  - `cardart.js`: card frames, built lazily per kind × metal × extra;
  - `sheetui.js`: sheet frames.
  - Bake cost is about 40 ms at boot plus about 14 ms for the first offer.
- **Cards** (`ui.js` boon section, `cardart.js`):
  - The kind comes from `ED.PickFx.kind`; rarity is the frame metal and the socket gem; key / evo / gate get gold trim.
  - A pick calls `PickFx.play`, sends the act at once, runs the card animation for 0.36 s and hides the overlay at 380 ms (160 ms on Low quality or reduced motion).
  - Icons take the path or class colour (`UI.boonIconColor`, which the sheet also uses).
- **Pick feedback** (`pickfx.js`): a cue per kind (`A.play('pick', v, kind)`) and a hero burst on the existing `boon` / `relic` events; the Purse now emits a `boon` event (`build.js`). `'buy'` is the Hearth cue and `'shop'` the in-run shop cue.
- **HUD** (`hud.js`):
  - Text is rasterised through 1-bit glyph masks (`ED.HUD.pixText`, also used by `aim.js`), because canvas fillText is never crisp on Chromium/Windows.
  - Health has one segment per 1–2 HP, with a shield column fill and the number on its own plate.
  - Pulses are part of the repaint signature.
- **Sheet** (`sheetui.js`): pixel frames, its own map canvas; shields show one decimal under 10 (`Sheet.shownShield`, same rule as the HUD).
- **Icons** (`icons.js`): 58 hand-authored 16×16 masks with an auto outline and a medallion, output nearest ×k.
- **Tests**: `browse.js` scenarios `picks`, `cards`, `screens` and `sheet` (all fail on layout, kind or focus regressions).
- **Final run on `0ebeecf`**:
  - Every node check passed.
  - `smoke,shots,sheet,screens,cards,picks` passed at 1280x720, 1920x1080 and 2560x1440, and smoke passed in Firefox.
  - crowd70 frame p50 was 1.5 / 1.6 ms (low / high) and HUD.draw 0.2 ms.

## Remaining (priority, reason)
1. **User look check and the vsync fps check**: the screenshots are headless only, and no human has heard the 13 pick cues or the shop cue.
2. **Merge `feat/ui-pixel` into `feat/v4-1`** after the user's OK. Merge `feat/v4-1` into `feat/ui-pixel` first if it moved; expect `style.css`, `ui.js` and `tools/browse.js` conflicts and resolve them as a union.
3. **Not verified**:
   - dpr ≠ 1 (laptop 125% / 150% scaling);
   - gamepad navigation in menus;
   - Firefox visuals beyond smoke;
   - phone width under 560 px for the cards;
   - route bursts for heroes other than the Knight;
   - real multiplayer party frames.
4. **Known small issues**:
   - At 2560×1440 body text is 32 px (t = 2), large but fitting; 24 px would not be crisp.
   - At 800×600 k = 1, so frames are 1 px thin.
   - A white hero flash of about 60 ms on every pick, from outside the pick code.
   - The menu vignette bakes twice on resize (about 10 ms each).
   - The sheet map's room icons are large at 1080p (cap 44 art px).

## Questions for the user (next session start)
1. How does the pixel UI look and feel: cards per path, pick animation and sounds, menus, HUD health bar, Tab sheet?
2. Is body text size OK at your resolution (16 px at 1080p, 32 px at 1440p)? Do the Pixel Operator Bold titles read well?
3. Should the pick sounds be louder or quieter? Is any card type's sound or burst wrong?
4. OK to merge `feat/ui-pixel` into `feat/v4-1`?
