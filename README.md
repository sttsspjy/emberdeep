# Wickdeep

A cooperative roguelite that runs in the browser. Descend through six strata of the Deep, alone or with up to three friends. Builds are chosen, not rolled: pick your paths, read each stratum's weakness, choose a route for your hero, and decide how much of every floor your lantern can afford. Carry embers back to the Hearth to grow stronger between descents.

No build step, no backend, no install. It is a static site: open it from any web host and play.

**Play online:** https://sttsspjy.github.io/emberdeep/ (the repository keeps its old name)

## Playing

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` (or the arrow keys) | Move |
| Mouse | Aim: attacks and skills go where the cursor is |
| Left mouse or `J` | Attack (hold). Also interacts with chests, shops and shrines |
| `Q` or right mouse | Skill 1 (rerolls the boon cards while they are open) |
| `E` | Skill 2 |
| `Space` | Dash (brief invulnerability) |
| `F` | Lantern flare: spend 6 light to banish the Gloom and blind nearby foes |
| `Tab` | Character sheet: build, combat numbers and the map |
| `Esc` | Pause (also backs out of any menu) |

Every key and mouse button can be changed in **Settings > Controls**: click an action's slot, then press the new key or mouse button (`Esc` cancels, `Backspace` clears). A key that is already taken is swapped into the slot you replaced. **Reset to defaults** restores the table above, and bindings are saved with your other settings.

**Aiming is manual.** Attacks and many skills fly toward the cursor; ground skills (Rain of Arrows, Meteor, Sanctuary, Raise Legion) land on it; Shield Charge and Shadowstep travel toward it. There is no auto-aim. The cursor lights up over foes, and a landing preview shows where a ground skill will fall. **Settings > Controls** changes the cursor (reticle or system crosshair), its size and colour, and turns the skill aim preview on or off.

**Gamepad** (fixed layout): left stick moves, right stick aims (let go and you aim where you walk), `X` or right trigger attacks, `B` or right bumper is skill 1, `Y` or left trigger is skill 2, `A` or left bumper dashes, pressing the left stick fires the lantern flare, `Back` opens the character sheet, `Start` pauses. In the sheet the bumpers switch tabs, `B` closes it and `Y` switches the hero you view; on the boon offer screen `Y` rerolls the cards.

### The screen

The interface scales with your window (larger on big and 4K screens). Bottom-left is your hero: portrait, health bar (a pale segment is your shield), and above it the skill, dash and flare slots with the key bound to each, a cooldown sweep with the seconds left, and your path rings (a ring fills toward evolution). Messages appear above the hero block. Party members are listed top-left. Top-right shows the stratum, its weakness and resistance, the map (the number on a room is the light it costs) and the lantern: its tier, a meter with ticks at 50% and 25%, what the tier does, what a new room costs and what light at the boss door is worth. Level, experience and gold are bottom-centre, relics bottom-right, the boss bar top-centre. Prompts and signs always show your current keys.

### The character sheet

`Tab` opens the sheet, also while boon cards are open, so you can compare a card with your build. It has three tabs, switched with `Q` / `E` (bumpers on a pad) or `1` `2` `3`, and it opens on the tab you used last.

- **Build:** your paths with their affinity, keystone and evolution progress; duos; your class route; every boon at its current rank with its full text and what the next rank adds; the statuses you apply; your relics.
- **Combat:** your weapon and each skill with the damage per hit and per cast, how it is built (every multiplier with its sources), your defence (armor, dodge, shields, healing) and what the foes of this stratum do to you.
- **Map:** the stratum's weakness, the lantern and its room costs, the boss-door reward and the room map.

Playing alone, the world waits while the sheet is open; in a party the descent goes on.

## A descent

- Six strata in a fixed order: the Ossuary, Glowmire Grotto, Rimefrost Halls, the Cinderforge, the Drowned Sanctum and the Starless Abyss. Each has its own palette, lighting, hazards, music, enemy roster, boss and elemental weakness.
- Each stratum is a floor of 12 to 14 rooms: combat rooms, an elite room (two from stratum IV on), a treasure room, a shop, an event shrine (fountain, altar, gamble shrine or champion's trial), a rest site and the boss. Every door shows what waits inside before you open it.
- **Room rewards.** A normal fight pays a boon (drawn from your own paths), gold, a Vigor blessing (+max health), a forge (rank up one boon) or lantern oil. Elite rooms usually pay a relic and sometimes an epic boon. Rewards appear in the middle of the room once it is clear; boons and forges are claimed by each hero, gold, oil and relics are shared.
- **Rest sites** have a campfire (heal 35%) and, in strata I, III and V, an anvil (forge one boon); each hero uses one of them. **Shops** sell relics, a healing draught, lantern oil and one build item: an epic boon in strata I, III and V, a forge in strata II, IV and VI. The bosses of strata III and V also grant an epic boon.
- **Relics** are run-long items from elite rooms, chests, shops, shrines and bosses.
- You level up from kills and gain a boon at every second level (2, 4, 6, ...) and your class route card at level 3. Offers open only when the room is safe. Playing alone, the world waits while the boon cards are open (and while paused).
- A winning descent takes about 20 to 30 minutes.

### The lantern and Dread

Every room you have not visited yet costs lantern light: the number on its door (and on the map, and in the sheet's map) says how much (combat 12, elite 17, anything else 8 out of 100; red means the room drops you to a darker tier). The first three strata carry a bigger lantern (+30%, +20%, +10%). Going back through a room you have visited is free. The lantern does not burn on its own: light is spent on new rooms and on flares, and gained from oil. It refills when you enter the next stratum. Lantern oil (room rewards, shops) gives +35 light, and the **Deep Wick** Hearth upgrade raises the lantern's size.

**Light you still carry when you step into the boss room guards the whole party**: up to 50% of max health healed and a shield of up to 80% with a full lantern, plus a little gold and embers. The door and the lantern panel show what it will give.

The darker the lantern, the harder the Deep hits back (never with more health, so foes stay quick to kill), and the more it pays:

| Light left | Tier | Foe damage | Elite chance | Healing | Room gold and embers | Better room reward | Gloom |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50% or more | Bright | x1 | normal | x1 | x1 | no | no |
| 25% to 50% | Dim | x1.1 | +20% | x1 | x1.25 | no | no |
| Under 25% | Dark | x1.6 | +40% | x0.7 | x1.5 | 12% of cleared rooms | hunts after 8 s |
| 0% | Lightless | x2.3 | +60% | x0.5 | x1.75 | 20% of cleared rooms | hunts after 3 s |

**Greed compounds.** Every new room you enter Dark or Lightless makes the rest of that stratum hit harder, boss included (+28% foe damage per such room, up to five). In the dark an elite replaces some of a wave's ordinary foes (fewer, nastier), and Dark and Lightless elites carry the worse affixes. The **Gloom** is an invulnerable hunter that walks through walls at your speed (a dash only breaks away for a moment), keeps its distance, then winds up a red line and lunges along it: step off the line. A touch takes about a fifth of your health. Lightless, more Glooms join for every dark room you have entered (up to three). Drive them off with **lantern oil** (any light gained banishes them) or press **F** for a **lantern flare**: it costs 6 light, banishes the Gloom for 12 seconds and blinds the foes around you for 1.5 seconds. The flare can drop you into a darker tier, and at 0 light only oil helps. Running dry never ends a descent.

## Builds: paths, routes, weaknesses, evolutions

### Paths

Boons belong to **paths**: six element paths and General. A hero follows at most **two element paths** per run, or becomes a **Generalist** and follows General alone. A path opens when you take its **gate** boon, which also gives your hits their status. Your **affinity** in a path is the total ranks of its boons you own.

| Path | Status | Job |
| --- | --- | --- |
| **Fire** | Burn | Damage over time: hits add Burn that keeps ticking after you stop swinging. |
| **Ice** | Chill and Freeze | Control and burst: slow foes, freeze them solid, shatter them for extra damage. |
| **Lightning** | Charge and Discharge | Crowds: charge builds on foes and discharges arc between nearby enemies. |
| **Poison** | Venom | Amplifier: envenomed foes take more damage from you and your allies; full Venom breaks a foe's guard. |
| **Holy** | Radiance and Smite | Stored light Smites foes and shields the heroes near them. |
| **Shadow** | Doom | Marked foes whose health falls to their Doom are Reaped on the spot; bosses suffer Tolls instead. |
| **General** | Bleed (physical) | Generalist only: critical hits, bleeding foes and finishing blows. No elements, no element boons or relics, but stronger open boons. |

- **Start offer:** a descent begins with a choice of four gates. The Pyromancer, Cleric and Necromancer always find their own element on it. The Knight, Ranger and Shade may instead take the Generalist.
- **Keystone:** at affinity 5 (General 6) a path can offer its keystone, a build-defining epic boon.
- **Evolution:** at affinity 10 (General 12) with the keystone, your next offers include the path's legendary weapon evolution. A path holds 12 ranks (General 15), so this takes a real commitment. One evolution per run.
- **Duo boons:** two element paths that both reach affinity 4 offer a duo that combines them: Thermal Shock (Fire and Ice), Plasma (Fire and Lightning), Firedamp (Fire and Poison), Sunfire (Fire and Holy), Black Flame (Fire and Shadow), Superconductor (Ice and Lightning), Cryotoxin (Ice and Poison), Hoarlight (Ice and Holy), Black Ice (Ice and Shadow), Galvanic Venom (Lightning and Poison), Wrath of Heaven (Lightning and Holy), Black Lightning (Lightning and Shadow), Purge (Poison and Holy), Necrosis (Poison and Shadow) and Twilight (Holy and Shadow).
- **Forge:** picking a forge card ranks an owned boon up by one.
- A room that rewards "a boon" offers one new element gate (while you have a free slot) and boons of the paths you follow. Level-ups offer open boons, boons of your paths, keystones and duos.
- **No life steal.** Hits and kills never heal you. Healing comes from hearts, campfires, healing draughts, the fountain, Vigor, the Hearth's Provisions and the Elixir Flask, Sanctuary and Bone Harvest, the light you carry into the boss room, and revives. **Shields** take the place of sustain: class shields give at most 3% of your max health per 10 seconds, all shield sources together at most 6% (the Battle Ward an elite room grants and the boss-door shield are exempt), and shields fade between fights.

### Class routes

Every hero also chooses a **route**: how their kit grows.

- At **team level 3** you pick one of four route cards: **Attack** (how your weapon fights), **Skill 1**, **Skill 2** or **Element** (the status your hero builds: Bleed for the Knight, Ranger and Shade; Fire, Holy or Shadow for the others).
- At the **boss of stratum I** you pick a **fork** of your route: a Heavy or a Swift weapon (Attack), Burst or Guard (a skill), Focus or Spread (Element). A Heavy weapon hits slower and harder and Staggers foes; a Swift weapon hits fast, trades damage per hit for speed, and gives a burst of move speed after each attack.
- At the bosses of strata II and IV your fork gains **ranks**; rank 3 adds a named rider. Each class has 12 route cards.

### Elemental weaknesses

Every stratum is **weak** to one element (your damage and status build-up with it are x1.5) and **resists** another (x0.5). General and physical hits ignore this. The Chronicle tab in the Hearth lists it too.

| Stratum | Weak to | Resists |
| --- | --- | --- |
| I. The Ossuary | Holy | Shadow |
| II. Glowmire Grotto | Shadow | Holy |
| III. Rimefrost Halls | Fire | Ice |
| IV. The Cinderforge | Ice | Fire |
| V. Drowned Sanctum | Lightning | Poison |
| VI. The Starless Abyss | Poison | Lightning |

### Evolutions

Your weapon is renamed after the path (Cinder Longsword, Glacial Greatbow, and so on).

| Path | Evolution | What it adds |
| --- | --- | --- |
| Fire | Cinder | Melee swings launch a piercing flame crescent; projectiles explode on hit; Burn +25%. |
| Ice | Glacial | Every third attack fires five piercing ice shards; chill +25%. |
| Lightning | Tempest | Every fourth attack calls lightning; foes discharge twice as often. |
| Poison | Venomous | Every third attack bursts acid where it lands and builds extra Venom; Venom bonus +10%. |
| Holy | Hallowed | Every third attack releases a lance of light along your aim; Smites shield a little more. |
| Shadow | Umbral | A shadow twin repeats every attack; twin hits mark double Doom. |
| General | Masterwork | Critical hits release a spectral strike; +10% crit chance. |

## Heroes

You start with the **Knight**, **Ranger** and **Pyromancer**. Each hero has three weapons (unlocked by mastery) and two skills. Skill cooldown reductions apply to both (full up to 40%, half beyond, 65% at most), and each hero's route cards shape the skills further.

| Hero | Skill 1 (Q) | Skill 2 (E) | Unlock |
| --- | --- | --- | --- |
| Knight | Shield Charge, 6 s: run through a pack, untouchable, stunning what you hit | Shield Throw, 9 s: a shield that ricochets between foes, stuns them and swats arrows, then returns; catch it for a shield | Start |
| Ranger | Volley, 5 s | Rain of Arrows, 10 s: a storm of arrows on a point | Start |
| Pyromancer | Flame Nova, 7 s | Meteor, 12 s: telegraphed impact and burning crater | Start |
| Shade | Shadowstep, 4.5 s | Vanish, 11 s: smoke, stealth and a guaranteed-crit ambush | Defeat the Bone Warden |
| Cleric | Sanctuary, 11 s: heals you and allies near you, then holy ground that burns foes and cuts the damage allies take | Judgment, 9 s: a returning hammer that judges foes | Complete 4 descents |
| Necromancer | Raise Legion, 12 s | Bone Harvest, 10 s: minions explode, then rise again | Defeat the Sporemother |

## The menus

The main menu has five entries. **Descend** picks your hero, weapon and pact, then starts a solo descent or opens a party (**Host a party**, or **Join a party** with a code). **Hearth** holds the upgrades, the relic codex and the chronicle. **Heroes** shows every hero's stats and mastery rewards. **Settings** holds Sound, Display (visual quality, frame cap, screen shake, damage numbers), Controls (cursor, cursor size, cursor colour, skill aim preview, key bindings) and your profile (name, save code, erase). **Credits** lists the art that Wickdeep is built from. `Esc` steps back out of a menu.

## Between descents (the Hearth)

- **Embers** are earned on every descent that clears at least one room, win or lose. Spend them on 16 permanent upgrades, including **Deep Wick** (+6% lantern light per rank). Deeper strata reveal new upgrades.
- **Relic Codex:** 45 relics. 18 are available from the start; unlock the other 27 so they can appear in runs. Element relics (Fire, Ice, Lightning, Poison, Holy, Shadow) never reach a Generalist.
- **Heroes:** every descent trains the hero you took, up to mastery 10. Mastery unlocks weapons and permanent bonuses.
- **Deeds:** 26 achievements with ember rewards (including Evolved, Into the Dark and Cartographer).
- **Pacts:** ten optional difficulty tiers unlocked by winning, each paying more embers.
- The Hearth camp changes as you progress: more tents and lanterns, a banner per slain boss, a gate that glows with the colour of the deepest stratum you have reached, and a blood moon under a pact.

### Saving

Progress autosaves to the browser. **Settings > Profile** shows a portable save code (for example `WD1-XXXXX-XXXXX-…`). It packs the whole profile into letters and digits with a checksum. Paste it on any device or browser to continue (on a new device, use **I have a save code** on the first-run screen). No account or database is involved. Codes from earlier Wickdeep versions still load.

Wickdeep starts fresh profiles: saves and codes from Emberdeep (`ED1-…`) do not carry over, and the game says so if you paste one.

If you played an earlier version of Wickdeep, the first launch shows a one-time **"The Deep has changed"** notice. It lists what is different (mouse aim, the new paths, shields instead of life steal, the Knight's Shield Throw, the lantern no longer draining by itself) and any relics you own that were renamed or reworked.

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
- Each hero picks their own boons, paths and class route.
- Relics unlocked by *any* party member can drop for everyone.

At the end of the run everyone gets the embers, mastery and boss milestones from it (plus a party bonus). For example, a friend who helps beat the Bone Warden unlocks the Shade too.

Downed heroes can be revived by standing next to them. A hero who bleeds out returns at the next stratum. The run ends only when the whole party is down. After a run, the party returns to the lobby together; the lobby's **Hearth** button opens the upgrades, relics and hero mastery so everyone can spend their embers before the next descent.

The host should keep the game tab open. The simulation keeps ticking when the tab is in the background, but closing it ends the run for everyone; friends keep the embers earned so far. Everyone in a party needs the same version of the game: refresh if the host reports a mismatch.

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
src/data/                 strata, enemies, heroes, weapons and skills, boons, class routes, relics, meta progression
src/save.js               profile storage and the save-code format
src/sim/                  simulation: dungeon generation, stats, world, combat, build (offers, paths, evolutions, class routes),
                          skills, class-<hero>.js (each hero's skills and route hooks), enemy AI, bosses, rooms, sheet (the Tab sheet model)
src/net.js                transports (PeerJS / local), host and client sessions, snapshots
src/game.js               a run in progress: local controller, client mirror, network routing
src/client/               input, aim, audio synth, icons, art atlas and actors, sprites, room art, effects (fx, pixfx, cls-<hero>.js),
                          renderer, post (WebGL), HUD, camp, menus, the Tab sheet UI
src/main.js               app state machine and frame loop
src/art/                  generated atlas pages (data URIs) built from art-src/
art-src/                  vendored CC0 and CC-BY source art, with SOURCES.md (packs, licences, hashes)
tools/                    headless balance simulators and checks (Node), the art packer
docs/                     game design spec (rules and numbers), roadmap and agent notes
```

All art is pixel art from the CC0 and CC-BY packs listed under Credits, cropped, recoloured and packed into the game by `tools/art.js` as embedded data, and all sound is synthesized with WebAudio, so the game loads no separate image or audio files. The WebGL post-process (lighting, bloom) is optional: the Low quality setting uses plain 2D, and a browser without GPU acceleration (software WebGL) switches to it automatically at a reduced render resolution. Settings > Display has a frame cap (Auto, Uncapped, 144, 120 or 60 fps).

### Balance tools and checks

The simulation code runs headless in Node, so balance can be measured with bot players:

```
node tools/sim.js 1 12 0.75 none      # 12 solo runs, fresh profile
node tools/sim.js 1 12 0.75 max - 5   # fully upgraded, every hero ("-"), Pact 5
node tools/journey.js 0.7 1           # a whole player journey from a fresh save
node tools/simpool.js 1 384 0.75 none,mid,max --pick=smart   # same bots in parallel, one line per profile
node tools/sheet.js --cls=all --routes --weapons             # analytic hero numbers, no bot runs
```

Headless checks (each prints failures and exits 1 on any): `node tools/check-sim.js`, `check-classes.js`, `check-ranger.js`, `check-pyro.js`, `check-shade.js`, `check-cleric.js`, `check-necro.js`, `check-save.js`, `check-ux.js` and `sheet-check.js`; `node tools/art.js --check` verifies that `src/art/` matches a rebuild of `art-src/`. Targets for the bots live in docs/GAME-DESIGN.md §10.

## Credits

The art in Wickdeep is built from third-party pixel-art packs.

DawnLike tileset by DragonDePlatino (CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181), using the DawnBringer DB16 palette by DawnBringer. Cropped and recoloured for Wickdeep.

Free Pixel Effects Pack by CodeManu (Davit Masia), CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/ ; https://codemanu.itch.io/pixelart-effect-pack). Frames subsampled and recoloured for Wickdeep.

16x16 DungeonTileset II by 0x72 (Robert); Dungeon Tileset II Extended by nijikokun; 16x16 Dark Dungeon by kosinaz; Ninja Adventure by Pixel-boy and AAA; Puny Characters by Shade; LuizMelo; Kenney; o_lobster; Aim studios; ansimuz.

The same credits are in the game under **Credits** in the main menu. `art-src/SOURCES.md` lists every vendored file with its pack, author, licence and hash.
