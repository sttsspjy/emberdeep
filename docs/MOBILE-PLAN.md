# Mobile plan

Goal: the same static site plays well on a phone (landscape, one thumb stick, no aiming), installs as a PWA, and can optionally ship as an APK. No language migration: the JS / WebGL / WebAudio / PeerJS stack runs in mobile browsers as is.

## Decisions (user, 2026-11-06)
- **Landscape.** The 640 × 360 view is a sim rule (`ED.inView`; ai.js, grid.js, progress.js, cleric.js, ranger.js), so portrait would change balance and co-op fairness.
- **No twin-stick** (covers too much screen). One floating move stick (left half), small Q and dash buttons (right thumb), pause button.
- **Auto-aim, per weapon.** The old auto-aim only chased foes in a fixed priority order, so the hero could not push through a chosen direction. The fix follows the VS model: each weapon (path / Form) carries its own aim style, so the player never aims and still steers the attack by moving.
- **Packaging:** PWA first; TWA APK (Bubblewrap) only if a Play Store listing is wanted. Capacitor only if an offline bundled APK is required.
- **Testing:** a real Android phone over USB (`chrome://inspect`) for fps and thermals; `tools/browse.js` Playwright mobile emulation (touch, landscape, DPR 3) for headless layout / touch smoke. No WSL needed; the Android emulator (Android Studio, native Windows) only for an APK install check, never for perf.

## Auto-aim (built; rules in GAME-DESIGN §3)
- Per player `p.in.auto` (input `ed` bit 11, a level; NET_VERSION 15). `W.aimDir` follows the firing def's `autoAim`: `nearest` (default; elite / boss within 300 px first, else nearest foe or intact brazier), `crowd` (melee arcs, stabs, waves, Lance: the arc within reach holding the most weight, elite 4, boss 10), `random` (Seeker, Wildfire), `facing`. No target → heading.
- Q in auto: `autoAim` on the skill def (`self` / `facing d` / `densest d`), resolved by `W.autoPoint`. Dash without stick: heading.
- Parity bench (448 runs per mode, meta max wins): cursor 159/224, auto 155/224; per hero within CI. Lever is aim styles only, never weapon numbers.

## Checklist
1. [x] Auto-aim per weapon / Form / skill, Settings "Aim: Auto / Cursor" (unset: auto on touch), bench both modes.
2. [x] Touch input: floating left stick, Q / dash / pause buttons (S / M / L), tap menus, touch labels.
3. [x] Screen: fullscreen + landscape lock on first tap, rotate overlay, safe areas, cards fit 360 px tall.
4. [x] Lifecycle: solo auto-pause when hidden or portrait; host "keep the app open" note in the lobby; audio unlock on touchend.
5. [ ] Perf on a real mid-range phone (headless CPU x4: WebGL 9.5 ms p50 frame at crowd900; Canvas2D ~33 ms). Quality `auto` (default): hardware WebGL → high, else low; bloom off when the first-run median frame > 22 ms; phone post canvas at 1 px per world px.
6. [x] `browse.js --mobile` smoke / shots / `cards` / `portrait`, `--cpu N`.
7. [x] PWA: manifest, `sw.js` (cache-first, all-or-nothing background update, reload only on the title), icons (`tools/icons.js`); Share button, lobby Invite link `#join=CODE`.
8. [ ] (Optional) TWA APK — not planned (PWA only).
9. [x] README: mobile controls, install, invite.

## Known traps
- Low (Canvas2D) costs ~5x the main-thread CPU of WebGL on phones: never auto-pick it when hardware WebGL works.
- Mobile co-op over carrier data often fails without a TURN relay (CGNAT); a TURN server is a backend (rule ①). Wi-Fi co-op mostly works.
- A phone host that backgrounds the app freezes the sim for every player.
- Right after a deploy the Pages CDN may serve mixed old / new files; the SW update can cache that mix until the next update.
