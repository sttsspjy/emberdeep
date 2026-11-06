# Mobile plan

Goal: the same static site plays well on a phone (landscape, one thumb stick, no aiming), installs as a PWA, and can optionally ship as an APK. No language migration: the JS / WebGL / WebAudio / PeerJS stack runs in mobile browsers as is.

## Decisions (user, 2026-11-06)
- **Landscape.** The 640 × 360 view is a sim rule (`ED.inView`; ai.js, grid.js, progress.js, cleric.js, ranger.js), so portrait would change balance and co-op fairness.
- **No twin-stick** (covers too much screen). One floating move stick (left half), small Q and dash buttons (right thumb), pause button.
- **Auto-aim, per weapon.** The old auto-aim only chased foes in a fixed priority order, so the hero could not push through a chosen direction. The fix follows the VS model: each weapon (path / Form) carries its own aim style, so the player never aims and still steers the attack by moving.
- **Packaging:** PWA first; TWA APK (Bubblewrap) only if a Play Store listing is wanted. Capacitor only if an offline bundled APK is required.
- **Testing:** a real Android phone over USB (`chrome://inspect`) for fps and thermals; `tools/browse.js` Playwright mobile emulation (touch, landscape, DPR 3) for headless layout / touch smoke. No WSL needed; the Android emulator (Android Studio, native Windows) only for an APK install check, never for perf.

## Auto-aim rules (draft; verify per path / Form)
Applies when the hero's aim mode is `auto` (per player; default on touch devices, Settings toggle everywhere). Cursor mode stays unchanged.

| Style | Direction | For |
|---|---|---|
| `facing` | last movement direction (`p.mdir`) | melee / sweeps / cones / waves: Cleave and directional Forms, Edge Wave / Rending Gale, Twin Daggers stabs, Lance sweep, Shadow Fan |
| `nearest` | nearest live foe **or intact brazier** inside the view, pure distance, no kind priority; none → `facing` | single shots: Longbow arrows, Fire Bolt / Inferno / Pyre bolts, Bone Shard, thrown daggers, Headsman axes |
| `random` | random foe in view; none → `facing` | launch angle of homing shots: Seeker, Wildfire seeds, seeking shards, Bone Storm |
| unchanged | existing targeted / `around` / `densest` rules | Mortar, Firestorm, Napalm, Smite, minions, 360° patterns |

- Mechanism: one branch in `W.aimDir(p)` (src/sim/weapons.js) reading the weapon's `autoAim` field when `p.in.auto` is set. Sim-side, so deterministic (`w.rng` for `random`) and host-authoritative; clients send a 1-bit input flag (bump `ED.NET_VERSION`).
- Q skill in `auto`: per-skill rule in hero data (e.g. Vault / Bone Wall along `facing`; 360° skills unchanged). Dash: along the stick, else `facing`.
- Balance: bench bot runs in both modes (`tools/bench.js`, bot sends `auto`); tune weapons that lose clearly in `auto` so neither mode is the weak one. GAME-DESIGN §3 aim section updated with the code.

## Checklist
1. [ ] Auto-aim: `autoAim` per path / Form, `W.aimDir` branch, input flag + NET bump, Settings toggle, GAME-DESIGN §3, check-hero-<cls> cases, bench both modes.
2. [ ] Touch input: `ED.Input` device `touch`; floating stick, Q / dash / pause buttons (sizes and positions in Settings); tap cards, reroll, skip; touch-friendly DOM menus; HUD hints show touch glyphs.
3. [ ] Screen: landscape lock + fullscreen on first tap; "rotate your phone" overlay in portrait; safe-area insets; 4 level-up cards fit a 360 px-tall CSS viewport with text ≥ 20 px.
4. [ ] Lifecycle: solo pauses on `visibilitychange`; co-op host shows a "keep the app open" warning; audio resumes on first touch (iOS).
5. [ ] Perf on a real mid-range phone: crowd900 and late gates as host; quality auto-pick (Canvas2D / low) from a short boot benchmark.
6. [ ] `browse.js --mobile` (Playwright device emulation): smoke, shots, card layout, touch stick.
7. [ ] PWA: manifest, service worker (cache-first, no-op on `file://`), icons; needs the site live on GitHub Pages first.
8. [ ] (Optional) TWA APK via Bubblewrap (JDK + Android SDK on Windows); Digital Asset Links file must sit at the domain root.
9. [ ] README: mobile controls, install to home screen.

## Known traps
- PWA manifest, service worker and icons are runtime files: an exception to North-star rule ② that needs user approval.
- TWA `/.well-known/assetlinks.json` must be at the domain root: a project site (`<user>.github.io/emberdeep`) needs the `<user>.github.io` repo or a custom domain.
- Mobile co-op over carrier data often fails without a TURN relay (CGNAT); a TURN server is a backend (rule ①). Wi-Fi co-op mostly works.
- A phone host that backgrounds the app freezes the sim for every player.
- Sim speed on phones is unmeasured (desktop: ~2.5 ms per tick at 900 foes; phones are ~3–5× slower).

## Ask the user
1. Default aim on desktop: keep cursor, or offer `auto` as an option only?
2. Approve the per-weapon style table above (especially `nearest` vs `facing` for Longbow and Fire Bolt)?
3. Allow manifest / service worker / icon files (rule ② exception)?
4. Play Store (TWA, $25 Google developer account) or home-screen PWA only? iOS too?
