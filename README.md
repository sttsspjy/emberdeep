# Emberdeep

A cooperative roguelite dungeon crawler that runs in the browser. Descend through six strata of the Deep, alone or with up to three friends, and carry embers back to the Hearth to grow stronger between runs.

No build step, no backend, no install. It is a static site: open it from any web host and play.

**Play online:** https://sttsspjy.github.io/emberdeep/

## Playing

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| `J` or left mouse | Attack (hold). Also interacts with chests, shops and shrines |
| `K` or right mouse | Hero skill (rerolls the boon cards while they are open) |
| `Space` | Dash (brief invulnerability) |
| `Tab` | Map and character sheet |
| `Esc` | Pause / settings |

Aiming is automatic by default. Switch to mouse aiming in Settings. Gamepads also work.

### A descent (one round)

- Six strata in a fixed order: the Ossuary, Glowmire Grotto, Rimefrost Halls, the Cinderforge, the Drowned Sanctum and the Starless Abyss. Each has its own palette, lighting, hazards, music, enemy roster and boss.
- Each stratum is a procedurally generated floor with combat rooms (three in the first strata, fewer deeper down, where the fights are harder), a treasure room, an event shrine (fountain, blood altar, gamble shrine or champion's trial), a shop from stratum II on, and a boss.
- Clearing a room opens its doors and lets you choose a **boon**: one of 48 level-up upgrades, some unique to each hero. **Relics** come from chests, shops, shrines and bosses: 38 run-long items.
- A winning descent usually takes 11–17 minutes (higher pacts run longer). Every round is capped at 20 minutes by the **lantern**; the HUD shows how much light is left. When it burns out you retreat to the Hearth and keep everything you earned. Side rooms are optional, so a party running low on light can head straight for the boss.
- Playing alone, the world waits while the boon cards are open (and while paused), so reading them never costs lantern time.

### Between descents (meta progression)

- **Embers** are earned on every descent that clears at least one room, win or lose. Spend them at the Hearth on 15 permanent upgrades. Deeper strata reveal new upgrades.
- **Relic Codex:** unlock 22 more relics so they can appear in runs.
- **Heroes:** six classes (Knight, Ranger, Pyromancer, Shade, Cleric, Necromancer). Each has three weapons and a mastery track to level 10. New heroes unlock by beating bosses (the Cleric by completing four descents).
- **Deeds:** 23 achievements with ember rewards.
- **Pacts:** ten optional difficulty tiers unlocked by winning, each paying more embers.
- The Hearth camp changes as you progress: more tents and lanterns, a banner per slain boss, a gate that glows with the colour of the deepest stratum you've reached, and a blood moon under a pact.

### Saving

Progress autosaves to the browser. The **Save** tab shows a portable save code (for example `ED1-XXXXX-XXXXX-…`). It packs the whole profile into letters and digits with a checksum. Paste it on any device or browser to continue (on a new device, use **I have a save code** on the title screen). No account or database is involved.

Two tabs open on the same profile stay in step: each adopts the other's saved progress instead of overwriting it.

## Multiplayer

1. One player presses **Host a Party** and shares the 5-character code, or the invite link.
2. Friends press **Join a Party** and enter the code (or just open the link), pick a hero and press Ready. Everyone sees the pact the host has chosen.
3. The host presses **Begin**.

How it works:
- The host's browser runs the authoritative simulation. Friends connect peer-to-peer over WebRTC.
- The free public PeerJS broker handles the initial handshake. Its bundled STUN/TURN servers help connections get through home routers. There is no game server to run or maintain.
- Both ends exchange a heartbeat. A friend who goes silent for about 6 seconds (closed tab, crash, lost network) is removed from the descent so the party is never left waiting; if the host goes silent, friends return to the results screen with the embers earned so far.

> **Note:** multiplayer depends on the free public PeerJS broker (`0.peerjs.com`) and its STUN/TURN servers. They are community services with no uptime guarantee. If the broker is down, solo play still works and parties can be tried again later. Some strict corporate or school networks block peer connections entirely.

The party shares in-run progression:
- One party level and one gold purse.
- Each hero picks their own boons.
- Relics unlocked by *any* party member can drop for everyone.

At the end of the run everyone gets the embers, mastery and boss milestones from it (plus a party bonus). For example, a friend who helps beat the Bone Warden unlocks the Pyromancer too.

Downed heroes can be revived by standing next to them. A hero who bleeds out returns at the next stratum. The run ends only when the whole party is down. After a run, the party returns to the lobby together; the lobby's **Hearth** button opens the upgrades, relics and hero mastery so everyone can spend their embers before the next descent.

The host should keep the game tab open. The simulation keeps ticking when the tab is in the background, but closing it ends the run for everyone; friends keep the embers earned so far.

## Hosting it

Any static file host works. Upload this folder as-is:

- **GitHub Pages:** push the folder to a repository, then Settings → Pages → deploy from branch.
- **Netlify / Vercel / Cloudflare Pages:** drag and drop the folder, or point a project at it with no build command.
- **itch.io:** zip the folder and upload it as an HTML game.

For local play, serve the folder with any static server, for example `npx serve .` or `python -m http.server`. Opening `index.html` straight from disk also works for solo play.

### Local testing helpers

- `?net=local` makes tabs of the same browser connect over a BroadcastChannel instead of the internet.
- `?slot=2` keeps a second profile in the same browser.

Open `index.html?net=local` in one tab and `index.html?net=local&slot=2` in another to play both sides of a party offline.

## Project layout

```
index.html, style.css     page shell and UI styling
vendor/peerjs.min.js      WebRTC helper (PeerJS 1.5.4)
src/util.js               math, seeded RNG, colour helpers
src/data/                 strata, enemies, heroes & weapons, boons, relics, meta progression
src/save.js               profile storage and the save-code format
src/sim/                  simulation: dungeon generation, stats, world, combat, enemy AI, bosses, rooms
src/net.js                transports (PeerJS / local), host and client sessions, snapshots
src/game.js               a run in progress: local controller, client mirror, network routing
src/client/               input, audio synth, icons, sprites, room art, effects, renderer, HUD, camp, menus
src/main.js               app state machine and frame loop
tools/                    headless balance simulators (Node)
```

All art is drawn procedurally on canvas, and all sound is synthesized with WebAudio, so the game ships no image or audio files.

### Balance tools

The simulation code runs headless in Node, so balance can be measured with bot players:

```
node tools/sim.js 1 12 0.75 none      # 12 solo runs, fresh profile
node tools/sim.js 1 12 0.75 max - 5   # fully upgraded, every hero ("-"), Pact 5
node tools/journey.js 0.7 1           # a whole player journey from a fresh save
```

Bot results at the current tuning (solo, 72 runs each; bots use randomness, so expect a few points of noise):

| Profile | Win rate | Winning descent (game time) | Notes |
| --- | --- | --- | --- |
| Fresh profile | ~1–2% | — | Bots usually fall around stratum III |
| Half-upgraded | ~35–45% | ~12 min (longest ~17) | |
| Fully upgraded | ~75–85% | ~11 min (longest ~16) | |
| Fully upgraded, Pact 5 | ~30% | ~14 min (longest ~17.5) | |
| Fully upgraded, Pact 10 | ~3% | ~16 min | |

A party of two half-upgraded bots wins ~80% of the time (revives make parties sturdier). A simulated journey reaches its first victory after about 1.3–2.6 hours (typically ~1.7), unlocks every hero within the first hour and finishes the Hearth upgrades after 7–8 hours of play. The full Pact ladder takes longer. Human players are slower than the bots, so real descents run a few minutes longer than the game-time figures above.
