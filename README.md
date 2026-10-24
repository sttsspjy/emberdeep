# Wickdeep

A cooperative roguelite that runs in the browser. Descend through six strata of the Deep, alone or with up to three friends. Builds are chosen, not rolled: pick your paths, read each stratum's weakness, choose a route for your hero, and decide which dark rooms are worth the risk. Carry embers back to the Hearth to grow stronger between descents.

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
| `Space` | Dash: invulnerable while it lasts; a used charge refills in 1.5 seconds (1 with Shadow Cloak); Light Step adds a charge per rank, up to 3 |
| `Tab` | Character sheet: build, combat numbers and the map |
| `Esc` | Pause (also backs out of any menu) |

Every key and mouse button can be changed in **Settings > Controls**: click an action's slot, then press the new key or mouse button (`Esc` cancels, `Backspace` clears). A key that is already taken is swapped into the slot you replaced. **Reset to defaults** restores the table above, and bindings are saved with your other settings.

**Aiming is manual.** Attacks and many skills fly toward the cursor; ground skills (Rain of Arrows, Meteor, Sanctuary, Raise Legion) land on it; Shield Charge and Shadowstep travel toward it. There is no auto-aim. The cursor lights up over foes, and a landing preview shows where a ground skill will fall. **Settings > Controls** changes the cursor (reticle or system crosshair), its size and colour, and turns the skill aim preview on or off.

**Gamepad** (fixed layout): left stick moves, right stick aims (let go and you aim where you walk), `X` or right trigger attacks, `B` or right bumper is skill 1, `Y` or left trigger is skill 2, `A` or left bumper dashes, `Back` opens the character sheet, `Start` pauses. In the sheet the bumpers switch tabs, `B` closes it and `Y` switches the hero you view; on the boon offer screen `Y` rerolls the cards.

### The screen

The interface scales with your window (larger on big and 4K screens). Bottom-left is your hero: portrait, health bar (a pale segment is your shield), and above it the skill and dash slots with the key bound to each, a cooldown sweep with the seconds left, charge pips, and your path rings (a ring fills toward evolution). Messages appear above the hero block. Party members are listed top-left. Top-right shows the stratum, its weakness and resistance, and the map with each room's reward (a violet skull marks a dark room). Level, experience and gold are bottom-centre, relics bottom-right, the boss bar top-centre. Prompts and signs always show your current keys.

### The character sheet

`Tab` opens the sheet, also while boon cards are open, so you can compare a card with your build. It has three tabs, switched with `Q` / `E` (bumpers on a pad) or `1` `2` `3`, and it opens on the tab you used last.

- **Build:** your paths with their affinity, keystone and evolution progress; duos; your class route; every boon at its current rank with its full text and what the next rank adds; the statuses you apply; your relics.
- **Combat:** your weapon and each skill with the damage per hit and per cast, how it is built (every multiplier with its sources), your defence (armor, dodge, shields, healing) and what the foes of this stratum do to you.
- **Map:** the stratum's weakness, the dark rooms left on the floor and the room map.

Playing alone, the world waits while the sheet is open; in a party the descent goes on.

## A descent

- Six strata in a fixed order: the Ossuary, Glowmire Grotto, Rimefrost Halls, the Cinderforge, the Drowned Sanctum and the Starless Abyss. Each has its own palette, lighting, hazards, composed music (it thickens as the room fills and a boss brings its own variant of the theme), enemy roster, boss and elemental weakness.
- Each stratum is a floor of 10 or 11 rooms: four combat rooms (two of them dark), an elite room (two in strata V and VI), a treasure room (strata I, III, V) or an event shrine (fountain, altar, gamble shrine or champion's trial; strata II, IV, VI), a shop, a rest site and the boss. Fight rooms are wide and the camera scrolls with you. Every door shows what waits inside before you open it.
- **Room rewards.** A normal fight pays a boon (drawn from your own paths), gold, a Vigor blessing (+max health) or a forge (rank up one boon). Elite rooms usually pay a relic and sometimes an epic boon. Rewards appear in the middle of the room once it is clear; boons and forges are claimed by each hero, gold and relics are shared. A hero who has maxed every boon on offer is offered a Purse of gold instead (the same gold as a gold reward), never a boon above its top rank.
- **Breakables.** Urns, glowing mushrooms, crystals, crates, coral and void shards break when your attacks, shots, blasts or dashes hit them; now and then one hides a few coins or, rarely, a heart.
- **Rest sites** have a campfire (heal 35%) and, in strata I, III and V, an anvil (forge one boon); each hero uses one of them. **Shops** sell relics, a healing draught and one build item: an epic boon in strata I, III and V, a forge in strata II, IV and VI. The bosses of strata III and V also grant an epic boon.
- **Relics** are run-long items from elite rooms, chests, shops, shrines and bosses. All 31 can drop from your first descent and none belongs to an element; the element effects are path boons.
- **Hordes.** Beside the foes that matter, every fight pours in packs of weak fodder from the room's edges: about 40 kills a fight in stratum I, up to 120 in stratum VI, more in elite and dark rooms. Fodder dies in a hit or two, nips for at most 3% of your health and slows you while it clings to you (down to half speed), so keep moving and dash out. It drops only experience motes, and every fight pays a fixed amount of experience however it goes (summoned and split foes pay nothing). Kill effects that spread, chain or explode trigger on fodder; cooldown refunds, shields, healing, stacks and raised minions come only from the foes that matter. A foe still standing 45 seconds after it appeared weakens and starts to wither.
- **Deeper strata fight smarter.** From stratum III ranged foes aim where you are heading (more so the deeper you go), shots fly faster, rooms mix in foes from the stratum above, and from stratum IV elites can carry two affixes. Every boss fires aimed volleys at each hero (a warning line shows the path; change direction after it locks), adds one on top of everything else in its last phase, and fodder keeps trickling in during the fight. From stratum IV a boss that lives too long flies into a **fury**: the track under its health bar fills toward a notch, and past it the boss hits harder and attacks faster every second.
- You level up from experience and gain a boon at every second level (2, 4, 6, ...) and your class route card at level 3. Offers open only when the room is safe. Playing alone, the world waits while the boon cards are open (and while paused).
- A boon card shows what it is at a glance: its frame and icon wear its path (flame crown for Fire, ice shards, a lightning zigzag, dripping Poison, a Holy cathedral, torn Shadow, riveted steel for General), class route cards fly your hero's banner, duos split two frames, Ascended cards are gilded with wings, and the frame metal and the gem at the bottom show the rarity (iron common, silver rare, violet epic, gold legendary). Keystones, evolutions and path gates get a gold trim and a bigger gem. Taking a card plays its own animation and sound.
- A winning descent takes about 30 to 40 minutes.

### Dark rooms

Every floor has two **dark rooms**: combat rooms on dead ends, marked with a violet skull on the door and the map. They are optional. Inside, foes hit 30% harder and the last wave brings an extra elite with a nasty affix; in return gold and experience pay 50% more (the Hearth's **Deep Wick** adds 10% of that per rank) and the room's reward is always one step better (gold becomes Vigor, Vigor a forge, a forge or a boon an epic boon). The door already shows the better reward.

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
| **General** | Bleed (physical) | Generalist only: critical hits, bleeding foes and finishing blows. No elements and no element boons, but stronger open boons. |

- **Start offer:** a descent begins with a choice of four gates. The Pyromancer, Cleric and Necromancer always find their own element on it. The Knight, Ranger and Shade may instead take the Generalist.
- **Keystone:** at affinity 5 (General 6) a path can offer its keystone, a build-defining epic boon.
- **Evolution:** at affinity 10 (General 12) with the keystone, your next offers include the path's legendary weapon evolution. A path holds 12 ranks (General 15), so this takes a real commitment. One evolution per run.
- **Duo boons:** two element paths that both reach affinity 4 offer a duo that combines them: Thermal Shock (Fire and Ice), Plasma (Fire and Lightning), Firedamp (Fire and Poison), Sunfire (Fire and Holy), Black Flame (Fire and Shadow), Superconductor (Ice and Lightning), Cryotoxin (Ice and Poison), Hoarlight (Ice and Holy), Black Ice (Ice and Shadow), Galvanic Venom (Lightning and Poison), Wrath of Heaven (Lightning and Holy), Black Lightning (Lightning and Shadow), Purge (Poison and Holy), Necrosis (Poison and Shadow) and Twilight (Holy and Shadow).
- **Forge:** picking a forge card ranks an owned boon up by one (never a route or fork card: bosses rank those).
- **Ascended boons:** from stratum IV, a boon you have taken to its top rank can offer its **Ascended** upgrade (Honed Edge, Blur, Arrow Storm, Impaler, Hawk Eye, Savage, Vast, Titan, Bastion; Hemorrhage, Headsman and Bloodletting for Generalists). It sits first on a boon offer, takes no path, and multiplies the bonus you already hold instead of adding to it. At most two per stratum.
- A room that rewards "a boon" offers one new element gate (while you have a free slot) and boons of the paths you follow. Level-ups offer open boons, boons of your paths, keystones and duos.
- **Health is a small whole number.** A Knight starts at 40, a Necromancer at 14, and a foe's hit costs 2 to 4 from the first stratum: every hit counts. A Vigor blessing is +2, a Heartstone +4, a Hearth Vitality rank +2.
- **No life steal.** Hits and kills never heal you. Healing comes from hearts, campfires, healing draughts, the fountain, Vigor, the Hearth's Provisions and the Elixir Flask, Sanctuary and Bone Harvest, and revives. **Shields** take the place of sustain: class shields give at most 3% of your max health per 10 seconds, all shield sources together at most 6% (the Battle Ward an elite room grants is exempt), and shields fade between fights.

### Class routes

Every hero also chooses a **route**: how their kit grows.

- At **team level 3** you pick one of four route cards: **Attack** (how your weapon fights), **Skill 1**, **Skill 2** or **Element** (the status your hero builds: Bleed for the Knight, Ranger and Shade; Fire, Holy or Shadow for the others).
- At the **boss of stratum I** you pick a **fork** of your route: a Heavy or a Swift weapon (Attack), Burst or Guard (a skill), Focus or Spread (Element). A Heavy weapon hits slower and harder and Staggers foes; a Swift weapon hits fast, trades damage per hit for speed, and gives a burst of move speed after each attack.
- At the bosses of strata II and IV your fork gains a **rank** on its own, with no pick, and a message names what it adds: rank 2 a new behaviour, rank 3 a transform that renames the card and changes how the skill or attack plays (skill forks transform too). Each class has 12 route cards.

### Elemental weaknesses

Every stratum is **weak** to one element (your damage and status build-up with it are x1.5) and **resists** another (÷1.5, about x0.67). General and physical hits ignore this. The Chronicle tab in the Hearth lists it too.

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

You start with the **Knight**, **Ranger** and **Pyromancer**. Each hero has three weapons (unlocked by mastery, each with an Armory variant to buy) and two skills. Skill cooldown reductions apply to both (full up to 40%, half beyond, 65% at most), and each hero's route cards shape the skills further.

| Hero | Skill 1 (Q) | Skill 2 (E) | Unlock |
| --- | --- | --- | --- |
| Knight | Shield Charge, 6 s: run through a pack, untouchable, stunning what you hit | Shield Throw, 9 s: a shield that ricochets between foes, stuns them and swats arrows, then returns; catch it for a shield | Start |
| Ranger | Volley, 5 s | Rain of Arrows, 10 s: a storm of arrows on a point | Start |
| Pyromancer | Flame Nova, 7 s | Meteor, 12 s: telegraphed impact and burning crater | Start |
| Shade (35% base dodge) | Shadowstep, 4.5 s | Vanish, 11 s: smoke, stealth and a guaranteed-crit ambush | Defeat the Bone Warden |
| Cleric | Sanctuary, 11 s: heals you and allies near you, then holy ground that burns foes and cuts the damage allies take | Judgment, 9 s: a returning hammer that judges foes | Complete 4 descents |
| Necromancer | Raise Legion, 12 s | Bone Harvest, 10 s: minions explode, then rise again | Defeat the Sporemother |

## The menus

The main menu has five entries. **Descend** picks your hero, weapon and pact, then starts a solo descent or opens a party (**Host a party**, or **Join a party** with a code). **Hearth** holds the upgrades and the chronicle. **Heroes** shows every hero's stats and mastery rewards. **Settings** holds Sound, Display (visual quality, frame cap, screen shake, damage numbers), Controls (cursor, cursor size, cursor colour, skill aim preview, key bindings) and your profile (name, save code, erase). **Credits** lists the art that Wickdeep is built from. `Esc` steps back out of a menu.

## Between descents (the Hearth)

- **Embers** are earned on every descent that clears at least one room, win or lose. Spend them on 16 permanent upgrades. They matter (two points of health, 3% damage, three points of armor, a boon reroll, a few gold per rank), and hero mastery adds more up to level 10: a fully upgraded Hearth roughly doubles your odds over a half-upgraded one, but the build still decides a descent. **Deep Wick** adds 10% gold and experience in dark rooms per rank, **Head Start** begins the descent with a little experience, the **Stash** with a little gold, and **Second Wind** revives you once at a sliver of health if you fall outside a boss fight. Deeper strata reveal new upgrades.
- **Refunds are free:** every upgrade rank has a **Refund** button that returns its full cost, and **Reset all** (press it twice to confirm) returns every rank at once, so you can rebuild the Hearth for a new path.
- **Armory:** each hero's weapon variants, listed under the upgrades: an alternative version of a weapon with the same power and a different shape (the Arming Sword's slash-slash-lunge combo, the Earthbreaker's slam ahead, the Hooked Glaive's pull, the Radiant Mace's ring of light, the Sunlance's instant beam, the Mortar Tome's lobbed shell, the Shade's Boomerang Blades, the Votive Lamp's shielding pools of light, the Miasma Staff's trail of plague clouds, and more). A variant costs 40, 60 or 80 embers (for the first, second or third weapon), can be bought once its base weapon is unlocked, and refunds in full. An owned variant shows under its base weapon in the weapon picker of Descend and the party lobby.
- **Heroes:** every descent trains the hero you took, up to mastery 10. Mastery unlocks weapons and tiny permanent bonuses.
- **Deeds:** 26 achievements with ember rewards, including Evolved, **Into the Dark** (clear 6 dark rooms in one descent) and **Cartographer** (clear every room of a stratum, both dark rooms included).
- **Pacts:** ten optional difficulty tiers unlocked by winning, each paying more embers. They stack: the first three (tougher foes, harder hits, more elites) are gentle, the next two (scarce healing and less health, stronger bosses) are steep, then speed, prices, shots, frailty and an extra wave.
- The Hearth camp changes as you progress: more tents and lanterns, a banner per slain boss, a gate that glows with the colour of the deepest stratum you have reached, and a blood moon under a pact.

### Saving

Progress autosaves to the browser. **Settings > Profile** shows a portable save code (for example `WD1-XXXXX-XXXXX-…`). It packs the whole profile into letters and digits with a checksum. Paste it on any device or browser to continue (on a new device, use **I have a save code** on the first-run screen). No account or database is involved. Codes from earlier Wickdeep versions still load; the embers an old code spent on the removed relic Codex are refunded.

Wickdeep starts fresh profiles: saves and codes from Emberdeep (`ED1-…`) do not carry over, and the game says so if you paste one.

If you played an earlier version of Wickdeep, the first launch shows a one-time **"The Deep has changed"** notice. It lists what is different (the relic Codex is gone and every relic drops from the start, the element relics became path boons, free Hearth refunds and smaller upgrades, smaller generic health boons, a per-hero Armory list, kill effects on fodder, mouse aim, the new paths, shields instead of life steal, the Knight's Shield Throw, optional dark rooms in place of the lantern, bigger rooms with hordes, dash charges, rank 2 and rank 3 transforms at the bosses, Ascended boons, boss fury, music per stratum) and how many embers the Codex refunded. A profile from v4 or v4.1 sees only the newest part: small health numbers and harder hits, a stronger Hearth, the Armory weapon variants and the new melee swing.

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
- One party level and one gold purse.
- Each hero picks their own boons, paths and class route.

At the end of the run everyone gets the embers, mastery and boss milestones from it (plus a party bonus). For example, a friend who helps beat the Bone Warden unlocks the Shade too.

Downed heroes can be revived by standing next to them. A hero who bleeds out returns at the next stratum. The run ends only when the whole party is down. After a run, the party returns to the lobby together; the lobby's **Hearth** button opens the upgrades and hero mastery so everyone can spend their embers before the next descent.

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
src/client/               input, aim, audio synth, adaptive score (score.js), icons, art atlas and actors, sprites, room art, effects (fx, pixfx, cls-<hero>.js),
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
node tools/bal.js                                            # quick balance suite against the difficulty targets, about 3 minutes
node tools/browse.js                                         # headless browser smoke test
node tools/browse.js --scen=swing --cls=knight               # contact sheet PNG per melee weapon swing (two attacks, hold, idle)
node tools/browse.js --scen=cards --viewport=1920x1080       # every boon card kind, mid-pick frames, the fork reveal
```

`simpool.js` runs its workers at normal priority; add `--nice` for idle priority (Windows throttles idle priority while the machine is unattended).

`bal.js` prints a time estimate first, then one PASS/FAIL line per profile. It uses the veteran bot (a human proxy; `--vet=0` turns it off); `--from=N` starts the bots at stratum N and `--full` runs the sign-off sizes (about 25 minutes). `browse.js` is headless only, never a visible window: `--scen=smoke` (a short solo run), `crowd70` (frame cost with 70 live foes at Low and High quality) and `shots` (screenshots of the menus, a run and the Tab sheet). It needs Playwright.

Headless checks (each prints failures and exits 1 on any): `node tools/check-sim.js`, `check-build.js` (fork ranks, offer rules, Ascended boons), `check-classes.js`, `check-knight.js`, `check-ranger.js`, `check-pyro.js`, `check-shade.js`, `check-cleric.js`, `check-necro.js`, `check-fodder.js` (fodder kill hooks), `check-perf.js` (sim cost per tick with 70 to 200 foes), `check-save.js`, `check-armory.js` (Armory weapon variants: lists, forks, choice fallbacks, host validation, shape mechanics), `check-armory-b.js` (the projectile variants: beam, lob, return, pool and trail with their route cards), `check-ux.js`, `check-render.js` (hit flash rules and art anchors) and `sheet-check.js` (the Tab sheet's numbers against the sim); `node tools/art.js --check` verifies that `src/art/` matches a rebuild of `art-src/`. Targets for the bots live in docs/GAME-DESIGN.md §10.

## Credits

The art in Wickdeep is built from third-party pixel-art packs and pixel fonts.

DawnLike tileset by DragonDePlatino (CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181), using the DawnBringer DB16 palette by DawnBringer. Cropped and recoloured for Wickdeep.

Free Pixel Effects Pack by CodeManu (Davit Masia), CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/ ; https://codemanu.itch.io/pixelart-effect-pack). Frames subsampled and recoloured for Wickdeep.

Pixel Operator font by Jayvee Enaguas (HarvettFox96), CC0.

16x16 DungeonTileset II by 0x72 (Robert); Dungeon Tileset II Extended by nijikokun; 16x16 Dark Dungeon by kosinaz; Ninja Adventure by Pixel-boy and AAA; Puny Characters by Shade; LuizMelo; Kenney; o_lobster; Aim studios; ansimuz.

The same credits are in the game under **Credits** in the main menu. `art-src/SOURCES.md` lists every vendored file with its pack, author, licence and hash.
