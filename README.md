# Wickdeep

A cooperative roguelite that runs in the browser. Descend through six strata of the Deep, alone or with up to three friends. Builds are chosen, not rolled: pick your paths, read each stratum's weakness, and decide how much of every floor your lantern can afford. Carry embers back to the Hearth to grow stronger between descents.

No build step, no backend, no install. It is a static site: open it from any web host and play.

**Play online:** https://sttsspjy.github.io/emberdeep/ (the repository keeps its old name)

## Playing

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` (or the arrow keys) | Move |
| Left mouse or `J` | Attack (hold). Also interacts with chests, shops and shrines |
| `Q` or right mouse | Skill 1 (rerolls the boon cards while they are open) |
| `E` | Skill 2 |
| `Space` | Dash (brief invulnerability) |
| `F` | Lantern flare: spend 8 light to banish the Gloom and blind nearby foes |
| `Tab` | Map and character sheet: paths, boons, stats |
| `Esc` | Pause (also backs out of any menu) |

Every key and mouse button can be changed in **Settings > Controls**: click an action's slot, then press the new key or mouse button (`Esc` cancels, `Backspace` clears). A key that is already taken is swapped into the slot you replaced. **Reset to defaults** restores the table above, and bindings are saved with your other settings.

Aiming is automatic by default. Switch to mouse aiming in Settings. Gamepads also work (fixed layout): left stick moves, right stick aims, `X` or right trigger attacks, `B` or right bumper is skill 1, `Y` or left trigger is skill 2, `A` or left bumper dashes, pressing the left stick fires the lantern flare.

## A descent

- Six strata in a fixed order: the Ossuary, Glowmire Grotto, Rimefrost Halls, the Cinderforge, the Drowned Sanctum and the Starless Abyss. Each has its own palette, lighting, hazards, music, enemy roster, boss and elemental weakness.
- Each stratum is a floor of 12 to 14 rooms: combat rooms, an elite room (two from stratum IV on), a treasure room, a shop, an event shrine (fountain, blood altar, gamble shrine or champion's trial), a rest site and the boss. Every door shows what waits inside before you open it.
- **Room rewards.** A normal fight pays a boon of one path (the door shows which), gold, a Vigor blessing (+max health), a forge (rank up one boon), lantern oil or a class boon. Elite rooms usually pay a relic and sometimes an epic boon. Rewards appear in the middle of the room once it is clear; boons and forges are claimed by each hero, gold, oil and relics are shared.
- **Rest sites** have a campfire (heal 35%) and, in strata I, III and V, an anvil (forge one boon); each hero uses one of them. **Shops** sell relics, a healing draught, lantern oil and one build item: an epic boon in strata I, III and V, a forge in strata II, IV and VI. The bosses of strata III and V also grant an epic boon.
- **Relics** are run-long items from elite rooms, chests, shops, shrines and bosses.
- You level up from kills and gain a boon at every second level (2, 4, 6, ...). Offers open only when the room is safe. Playing alone, the world waits while the boon cards are open (and while paused).
- A winning descent is designed to take 22 to 32 minutes.

### The lantern and Dread

Every room you have not visited yet costs lantern light: the number on its door (and on the map, and in the Tab map) says how much (combat 10, elite 14, anything else 7 out of 100; red means the room drops you to a darker tier). Going back through a room you have visited is free. The lantern also burns slowly while you stay on a floor, but not in boss rooms and not while a safe room waits for a boon pick. It refills when you enter the next stratum. Lantern oil (room rewards, shops) gives +35 light, and the **Deep Wick** Hearth upgrade raises the lantern's size.

**Light you still carry when you step into the boss room guards the whole party**: up to 30% of max health healed and a shield of up to 40% with a full lantern, plus a little gold and embers. The door and the lantern panel show what it will give.

Darkness does not make foes tougher; it makes the Deep hunt you:

| Light left | Tier | Foe damage | Elite chance | Room gold and embers | Better room reward | Gloom |
| --- | --- | --- | --- | --- | --- | --- |
| 50% or more | Bright | x1 | normal | x1 | no | no |
| 25% to 50% | Dim | x1 | +15% | x1.5 | no | no |
| Under 25% | Dark | x1.05 | +30% | x2 | 25% of cleared rooms | hunts after 8 s |
| 0% | Lightless | x1.1 | +45% | x2.5 | 40% of cleared rooms | hunts after 3 s |

In the dark an elite replaces some of a wave's ordinary foes (fewer, nastier), and Dark and Lightless elites carry the worse affixes. The **Gloom** is an invulnerable hunter that walks through walls at nearly your speed (a dash outruns it), keeps its distance, then winds up a red line and lunges along it: step off the line. A touch takes about a fifth of your health. Drive it off with **lantern oil** (any light gained banishes it) or press **F** for a **lantern flare**: it costs 8 light, banishes the Gloom for 12 seconds and blinds the foes around you for 1.5 seconds. The flare can drop you into a darker tier. Running dry never ends a descent.

## Builds: paths, weaknesses, evolutions

Boons belong to six **paths**. A hero follows at most **three** paths per run. A path opens when you take its **gate** boon, which also gives your hits an elemental or physical effect. Your **affinity** in a path is the total ranks of its boons you own.

| Path | Element | Job |
| --- | --- | --- |
| **Pyre** | Burn | Damage over time: hits add Burn that keeps ticking after you stop swinging. |
| **Rime** | Chill and Freeze | Control and burst: slow foes, freeze them solid, shatter them for extra damage. |
| **Storm** | Charge and Discharge | Crowds: charge builds on foes and discharges arc between nearby enemies. |
| **Steel** | Bleed (physical) | Critical hits and execution: bigger crits, bleeding foes and finishing blows. |
| **Blood** | Physical | Sustain by risk: heal from kills, hit harder when hurt, trade health for skill damage. |
| **Spirit** | Physical | Companions: wisps and orbiting blades fight for you, and bonds share your element. |

- **Keystone:** at affinity 4 a path can offer its keystone, a build-defining epic boon.
- **Evolution:** at affinity 8 with the keystone, your next offers include the path's legendary weapon evolution. A path holds 9 to 11 ranks, so this takes a real commitment. One evolution per run.
- **Duo boons:** owning the gates of two paths unlocks boons that combine them (Thermal Shock, Plasma, Superconductor, Hemorrhage, Static Edge, Serrated Frost, Soulfire, Spirit Feast).
- **Forge:** picking a forge card ranks an owned boon up by one.
- A room that rewards "a boon of Pyre" offers Pyre boons (or the Pyre gate, if you have not opened that path). Level-ups offer neutral boons, boons of your paths, keystones, duos and your hero's class boons. The start of a descent lets you choose your first path from three gates.
- Life steal exists only in the Blood path, and heals at most 1.2% of your max health per second. Damage over time never leeches.

### Elemental weaknesses

Every stratum is **weak** to one element (your damage and status build-up with it are x1.5) and **resists** another (x0.5). Physical paths ignore this. The Chronicle tab in the Hearth lists it too.

| Stratum | Weak to | Resists |
| --- | --- | --- |
| I. The Ossuary | Pyre | Storm |
| II. Glowmire Grotto | Storm | Pyre |
| III. Rimefrost Halls | Pyre | Rime |
| IV. The Cinderforge | Rime | Pyre |
| V. Drowned Sanctum | Storm | Rime |
| VI. The Starless Abyss | Rime | Storm |

### Evolutions

Your weapon is renamed after the path (Cinder Longsword, Glacial Longbow, and so on).

| Path | Evolution | What it adds |
| --- | --- | --- |
| Pyre | Cinder | Melee swings launch a piercing flame crescent; projectiles explode on hit; Burn +25%. |
| Rime | Glacial | Every third attack fires five piercing ice shards; chill +25%. |
| Storm | Tempest | Every fourth attack calls lightning; foes discharge twice as often. |
| Steel | Masterwork | Critical hits release a spectral strike; +10% crit chance. |
| Blood | Sanguine | Every attack also launches a blood scythe that heals you; kill heals are doubled. |
| Spirit | Ascendant | A spectral twin repeats every attack; +1 wisp and +1 blade. |

## Heroes

You start with the **Knight**, **Ranger** and **Pyromancer**. Each hero has three weapons (unlocked by mastery) and two skills. Skill cooldown reductions apply to both, and each skill has class boons of its own.

| Hero | Skill 1 (Q) | Skill 2 (E) | Unlock |
| --- | --- | --- | --- |
| Knight | Shield Charge, 6 s | Bulwark, 9 s: block and reflect arrows, then bash | Start |
| Ranger | Volley, 5 s | Rain of Arrows, 10 s: a storm of arrows on a point | Start |
| Pyromancer | Flame Nova, 7 s | Meteor, 12 s: telegraphed impact and burning crater | Start |
| Shade | Shadowstep, 4.5 s | Vanish, 11 s: smoke, stealth and a guaranteed-crit ambush | Defeat the Bone Warden |
| Cleric | Sanctuary, 11 s | Judgment, 9 s: a returning hammer that judges foes | Complete 4 descents |
| Necromancer | Raise Legion, 12 s | Bone Harvest, 10 s: minions explode, then rise again | Defeat the Sporemother |

## The menus

The main menu has four entries. **Descend** picks your hero, weapon and pact, then starts a solo descent or opens a party (**Host a party**, or **Join a party** with a code). **Hearth** holds the upgrades, the relic codex and the chronicle. **Heroes** shows every hero's stats and mastery rewards. **Settings** holds sound, display, controls and your profile (name, save code, erase). `Esc` steps back out of a menu.

## Between descents (the Hearth)

- **Embers** are earned on every descent that clears at least one room, win or lose. Spend them on 16 permanent upgrades, including **Deep Wick** (+6% lantern light per rank). Deeper strata reveal new upgrades.
- **Relic Codex:** 42 relics. 16 are available from the start; unlock the other 26 so they can appear in runs.
- **Heroes:** every descent trains the hero you took, up to mastery 10. Mastery unlocks weapons and permanent bonuses.
- **Deeds:** 26 achievements with ember rewards (including Evolved, Into the Dark and Cartographer).
- **Pacts:** ten optional difficulty tiers unlocked by winning, each paying more embers.
- The Hearth camp changes as you progress: more tents and lanterns, a banner per slain boss, a gate that glows with the colour of the deepest stratum you have reached, and a blood moon under a pact.

### Saving

Progress autosaves to the browser. **Settings > Profile** shows a portable save code (for example `WD1-XXXXX-XXXXX-…`). It packs the whole profile into letters and digits with a checksum. Paste it on any device or browser to continue (on a new device, use **I have a save code** on the first-run screen). No account or database is involved.

Wickdeep starts fresh profiles: saves and codes from Emberdeep (`ED1-…`) do not carry over, and the game says so if you paste one.

Two tabs open on the same profile stay in step: each adopts the other's saved progress instead of overwriting it.

## Multiplayer

1. One player presses **Host a party** on the Descend screen and shares the 5-character code, or the invite link.
2. Friends press **Join a party** and enter the code (or just open the link), pick a hero and press Ready. Everyone sees the pact the host has chosen.
3. The host presses **Begin**.

How it works:
- The host's browser runs the authoritative simulation. Friends connect peer-to-peer over WebRTC.
- The free public PeerJS broker handles the initial handshake. Its bundled STUN/TURN servers help connections get through home routers. There is no game server to run or maintain.
- Both ends exchange a heartbeat. A friend who goes silent for about 6 seconds (closed tab, crash, lost network) is removed from the descent so the party is never left waiting; if the host goes silent, friends return to the results screen with the embers earned so far.

> **Note:** multiplayer depends on the free public PeerJS broker (`0.peerjs.com`) and its STUN/TURN servers. They are community services with no uptime guarantee. If the broker is down, solo play still works and parties can be tried again later. Some strict corporate or school networks block peer connections entirely.

The party shares in-run progression:
- One party level, one gold purse and one lantern.
- Each hero picks their own boons and paths.
- Relics unlocked by *any* party member can drop for everyone.

At the end of the run everyone gets the embers, mastery and boss milestones from it (plus a party bonus). For example, a friend who helps beat the Bone Warden unlocks the Shade too.

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
src/data/                 strata, enemies, heroes, weapons and skills, boons, class boons, relics, meta progression
src/save.js               profile storage and the save-code format
src/sim/                  simulation: dungeon generation, stats, world, combat, build (offers, paths, evolutions),
                          skills (the two class skills), enemy AI, bosses, rooms
src/net.js                transports (PeerJS / local), host and client sessions, snapshots
src/game.js               a run in progress: local controller, client mirror, network routing
src/client/               input, audio synth, icons, sprites, room art, effects, renderer, post (WebGL), HUD, camp, menus
src/main.js               app state machine and frame loop
tools/                    headless balance simulators (Node)
docs/                     game design spec (rules and numbers), roadmap and agent notes
```

All art is drawn procedurally on canvas, and all sound is synthesized with WebAudio, so the game ships no image or audio files. The WebGL post-process (lighting, bloom) is optional: the Low quality setting uses plain 2D.

### Balance tools

The simulation code runs headless in Node, so balance can be measured with bot players:

```
node tools/sim.js 1 12 0.75 none      # 12 solo runs, fresh profile
node tools/sim.js 1 12 0.75 max - 5   # fully upgraded, every hero ("-"), Pact 5
node tools/journey.js 0.7 1           # a whole player journey from a fresh save
node tools/simpool.js 1 384 0.75 none,mid,max --pick=smart   # same bots in parallel, one line per profile
```

Current bot results (skill 0.75, smart picks, 384 runs each): fresh profile 1% wins, half-upgraded 31%, fully upgraded 71%, fully upgraded with Pact 5 24%; mid-profile parties of 2 and 3 win 58% and 64%. A winning descent takes about 27 minutes. Targets live in docs/GAME-DESIGN.md §10.
