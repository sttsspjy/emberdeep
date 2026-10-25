# Wickdeep

A cooperative roguelite that runs in the browser. Fight down through four strata, alone or with up to three friends. Builds are chosen, not rolled: pick up to two element paths (each one changes how you fight), choose a route for your hero, and choose your way across each stratum's map, where every door shows the room behind it. Carry embers back to the Hearth to grow stronger between runs.

No build step, no backend, no install. It is a static site: open it from any web host and play.

**Play online:** https://sttsspjy.github.io/emberdeep/ (the repository keeps its old name)

## Playing

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` (or the arrow keys) | Move |
| Mouse | Aim: attacks and skills go where the cursor is |
| Left mouse or `J` | Attack (hold). Also interacts with chests, shops and shrines. Some boons turn a held attack into something else (a flame cone, an ice lance, a flask, a guard, a finisher); the Bellwarden's hold winds the bell |
| `Q` | Skill 1 (rerolls the boon cards while they are open) |
| `E` | Skill 2 |
| Right mouse or `R` | Skill 3: the Pyromancer's Fireball. Heroes without a third skill cast skill 1 |
| `Space` | Dash: invulnerable while it lasts; a used charge refills in 1.5 seconds (1 with Shadow Cloak); Light Step adds a charge per rank, up to 3 |
| `Tab` | Character sheet: build, combat numbers and the map |
| `Esc` | Pause (also backs out of any menu) |

Every key and mouse button can be changed in **Settings > Controls**: click an action's slot, then press the new key or mouse button (`Esc` cancels, `Backspace` clears). A key that is already taken is swapped into the slot you replaced. **Reset to defaults** restores the table above, and bindings are saved with your other settings.

**Aiming is manual.** Attacks and many skills fly toward the cursor; ground skills (Rain of Arrows, Meteor, Sanctuary, Raise Legion) land on it; Shield Charge and Shadowstep travel toward it. Fireball flies toward it and bursts on the first foe or wall. There is no auto-aim. The cursor lights up over foes, and a landing preview shows where a ground skill will fall. **Settings > Controls** changes the cursor (reticle or system crosshair), its size and colour, and turns the skill aim preview on or off.

**Gamepad** (fixed layout): left stick moves, right stick aims (let go and you aim where you walk), `X` or right trigger attacks, right bumper is skill 1, `Y` or left trigger is skill 2, `B` is skill 3 (skill 1 for heroes without one), `A` or left bumper dashes, `Back` opens the character sheet, `Start` pauses. In the sheet the bumpers switch tabs, `B` closes it and `Y` switches the hero you view; on the boon offer screen `Y` rerolls the cards.

### The screen

The interface scales with your window (larger on big and 4K screens). Bottom-left is your hero: portrait, health bar (a pale segment is your shield), and above it the skill slots (three for the Pyromancer) and the dash with the key bound to each, a cooldown sweep with the seconds left, charge pips, and your path rings (a ring fills toward evolution). Messages appear above the hero block. Party members are listed top-left. Top-right shows the stratum, the room's row on the map and a **Next** strip: one icon per door, left to right, for the room it leads to (a violet bar marks a dark room, a red one an elite or champion fight). With Static Charge a `Charged` chip counts the foes your dash can set off. Level, experience and gold are bottom-centre, relics bottom-right, the boss bar top-centre. Prompts and signs always show your current keys.

### The character sheet

`Tab` opens the sheet, also while boon cards are open, so you can compare a card with your build. It has three tabs, switched with `Q` / `E` (bumpers on a pad) or `1` `2` `3`, and it opens on the tab you used last.

- **Build:** your paths with their affinity, keystone and evolution progress; your class route; every boon at its current rank with its full text and what the next rank adds; the statuses you apply; your relics.
- **Combat:** your weapon and each skill with the damage per hit and per cast, how it is built (every multiplier with its sources), your defence (armor, dodge, shields, healing) and what the foes of this stratum do to you.
- **Map:** the stratum's map from the start (bottom) to the boss (top): where you are, the rooms you visited, the next doors, the rooms ahead and the ones you can no longer reach; dark rooms carry a violet bar, elite and champion fights a red one, rooms not yet cleared their threat pips. Beside it: the current room's doors by name, the dark rooms ahead and the party.

Playing alone, the world waits while the sheet is open; in a party the run goes on.

## A run

- **Four strata** in a fixed order: the Ossuary, Glowmire, the Drowned Sanctum and the Starless Abyss, the finale. Each has its own palette, lighting, hazards, composed music (it thickens as the room fills and a boss brings its own variant of the theme), foes and boss. No stratum is weak to or resists an element.
- **The map.** Strata I to III are maps of 15 rows of rooms between the start camp and the boss. The camp opens onto several first rooms, paths split and merge on the way up, and doors only lead forward: there is no way back. The first row is fights, the middle row a treasure room and the last row a rest site; in between lie fights, dark rooms, elite fights, event shrines, shops and rest sites, so each fork asks what you need. Every door shows the next room's icon, name, reward and threat pips (more for elite fights, dark rooms and the upper half of the map); "No way back" reminds you as you near one. Fight rooms are wide and the camera scrolls with you.
- **The finale.** Stratum IV is short and fixed: a fight, a fight or a shrine, the twin champions, a rest site or a shop, the mimic champion, a rest site, then the Hollow King.
- **Every room has its own icon:** a stall for the shop, coins for gold, a chest for treasure, an amulet for a relic, a violet card for an epic boon, a card in your path colour for a boon, an anvil for a forge, a heart for max health, a campfire for rest, a fountain, altar, crossed swords or "?" for the shrines, a horned skull for elites, a red horned skull for champions and a crowned skull for the boss.
- **Room rewards.** A normal fight pays a boon (drawn from your own paths), gold, max health (+2 for the run) or a forge (rank up one boon). Elite fights pay a relic pick or an epic boon; champion fights pay a relic pick of rarer relics. Rewards appear in the middle of the room once it is clear; boons and forges are claimed by each hero, gold is shared, and a relic pick shows each hero three relics of their own: take one and the other two crumble. A hero who has maxed every boon on offer is offered a Purse of gold instead (the same gold as a gold reward), never a boon above its top rank.
- **Other rooms.** A rest site has a campfire (heal 35%) and an anvil (forge one boon); each hero uses one of them. A shop sells three relics (common, rare and epic), a healing potion, an epic boon and a forge. A treasure chest holds either a relic for each hero or a bigger pile of gold and a heart. Shrines: a fountain heals the party and raises the downed, an altar trades health for an epic boon, a gamble shrine sells a random relic, and a champion's trial is an elite fight for a rare relic.
- **Breakables.** Urns, glowing mushrooms, coral and void shards break when your attacks, shots, blasts or dashes hit them; now and then one hides a few coins or, rarely, a heart.
- **Relics** are run-long items from elite and champion fights, chests, shops, shrines and the first two bosses: 63 relics that each change a rule or make a trade, plus 10 boss relics with a big upside and a real cost. All can drop from your first run and none belongs to an element. Expect 8 to 10 in a full run.
- **Curses** are relics you never want: Pandora's Box and some events hand them out. Most lift after a while (fights won, kills, boon picks or the next stratum); the Tab sheet lists them apart with their progress.
- **Fights come in waves.** Every spawn is marked on the floor before the foe arrives, and each wave of the foes that matter brings packs of weak fodder in from the room's edges (more in dark rooms). Fodder takes a few hits (at least three at stratum I), nips for at most 3% of your health and slows you while it clings to you (down to half speed), so keep moving and dash out. It drops only experience motes, and every fight pays a fixed amount of experience however it goes. A fodder death sets off nothing: no spreads, explosions, refunds, shields, healing or stacks (your hits on it still chain). The last wave brings one strong foe under a bigger red marker; when that wave falls the room is clear and the fodder left crumbles. A foe still standing 45 seconds after it appeared weakens and starts to wither. Damage over time shows its numbers and makes a sound.
- **Deeper strata fight smarter.** From stratum II ranged foes aim where you are heading (more so the deeper you go), shots fly faster and rooms mix in foes from the stratum above; from stratum III elites can carry two affixes.
- **Bosses.** The Bone Warden duels in strings of telegraphed blows and raises bone walls, the Sporemother spreads a spore carpet from her pods, the Drowned King floods the room with the tide, and the Hollow King fights in the dark and then on a collapsing floor. Every boss telegraphs its attacks and changes in three phases; a boss fight has no fodder. The later bosses also fire aimed volleys at each hero (a warning line shows the path; change direction after it locks). The Hollow King grows furious if it lives too long: the track under its health bar fills toward a notch, and past it the boss hits harder and attacks faster every second.
- **Boss rewards.** Two seconds after a boss falls its rewards appear: the stratum I boss gives the fork of your class route and a pick of three boss relics, the stratum II boss a fork rank and a pick of three boss relics, the stratum III boss an epic boon and the last fork rank. Beating the Hollow King wins the run.
- You level up from experience and gain a boon at every second level (2, 4, 6, ...) and your class route card at level 3. Offers open only when the room is safe. Playing alone, the world waits while the boon cards are open (and while paused).
- A boon card shows what it is at a glance: its frame and icon wear its path (flame crown for Fire, ice shards, a lightning zigzag, dripping Poison, a Holy cathedral, torn Shadow, riveted steel for General), class route cards fly your hero's banner, and the frame metal and the gem at the bottom show the rarity (iron common, silver rare, violet epic, gold legendary). Keystones, evolutions and path gates get a gold trim and a bigger gem. Taking a card plays its own animation and sound.
- A winning run takes about 30 to 40 minutes.

### Dark rooms

**Dark rooms** are fights on their own nodes of the map in strata I to III, marked with a violet moon on the door, the Next strip and the map. They are optional: the path you pick decides how many you enter. Inside, foes hit 30% harder and the last wave brings an extra elite with a nasty affix; in return gold and experience pay 50% more (the Hearth's **Deep Wick** adds 10% of that per rank) and the room's reward is always one step better (gold becomes max health, max health a forge, a forge or a boon an epic boon). The door already shows the better reward.

## Builds: paths, routes, evolutions

### Paths

Boons belong to **paths**: six element paths and General. A hero follows at most **two element paths** per run, or becomes a **Generalist** and follows General alone. A path opens when you take its **gate** boon. Each element is one way to play, and its keystone and evolution change how you attack, dash or move. Your **affinity** in a path is the total ranks of its boons you own.

| Path | How it plays | Keystone | Evolution |
| --- | --- | --- | --- |
| **Fire** | Hits add Burn stacks; your dash leaves burning ground that stacks Burn on foes standing in it. | Firewalk: dashing through a burning foe copies its stacks to the foes around it. | Cinder: hold attack for a flame cone. |
| **Ice** | Hits chill and then freeze foes; a skill hit on a frozen foe Shatters it for extra damage. | Glacier Step: your dash raises an ice wall that blocks foes and their shots. | Glacial: hold attack to charge an ice lance that freezes what it pierces. |
| **Lightning** | Hits charge foes; your dash discharges every charged foe along its path, and each discharge jumps to other charged foes. | Storm Step: a dash aimed at a charged foe blinks you next to it first. | Tempest: a dash that discharges gives the dash charge back; discharges jump further. |
| **Poison** | Hits build Venom: envenomed foes hit softer, move slower and take damage, and at full Venom lose their guard. Your dash leaves a toxic cloud. | Toxic Wake: walking leaves a trail of clouds. | Venomous: hold attack to ready a flask, let go to lob it at the cursor. |
| **Holy** | Hits store Radiance that Smites the foe. Dash through a foe's attack at the last moment for a **perfect dodge**: the attack misses, the attacker is Smitten and you gain a shield. | Divine Riposte: after a perfect dodge your next attack Smites everything it hits. | Hallowed: hold attack to raise a guard; attacks from the front are perfect dodges and shots fly back. |
| **Shadow** | **Backstabs** (hits from behind, or on a stunned, frozen or blinded foe, or one busy with someone else) deal more and mark Doom; a foe whose health falls to its Doom is Reaped, a boss takes its Doom as damage. | Phantom Step: your dash leaves a decoy that foes go for. | Umbral: a dash aimed at a foe steps you behind it, and the next hit crits. |
| **General** | Generalist only: +15% damage, +5% crit chance, crits Bleed, open boons rank 1 higher. No element boons. | Finisher: hold attack to charge a guaranteed double-damage crit. | Masterwork: crits release a spectral strike; the finisher charges faster. |

- **Start offer:** a run begins with a choice of four gates. The Pyromancer, Cleric, Necromancer and Bellwarden always find their own element on it. The Knight, Ranger and Shade may instead take the Generalist.
- **Keystone:** at affinity 5 (General 6) a path can offer its keystone, an epic boon.
- **Evolution:** at affinity 10 (General 12) with the keystone, your next offers include the path's legendary weapon evolution, which takes nearly every rank of the path. One evolution per run; your weapon is renamed after the path (Cinder Longsword, Glacial Greatbow, and so on).
- **Hold attack:** an evolution or the Finisher turns a held attack (about a third of a second) into its move; your normal attacks pause while it runs. The Bellwarden's hold always winds the bell.
- **Forge:** picking a forge card ranks an owned boon up by one (never a route or fork card: bosses rank those).
- A room that rewards "a boon" offers one new element gate (while you have a free slot) and boons of the paths you follow. Level-ups offer open boons (every hero can take them), boons of your paths and keystones.
- **Health is a small whole number.** Heroes have a few dozen points of health at most, and a foe's hit costs a few: every hit counts. A max health reward is +2.
- **No life steal, little healing.** Hits and kills never heal you, and cleared rooms drop no hearts: hearts come from a few kills (elites more often), bosses and breakables. Healing comes from hearts, campfires, healing potions, the fountain, max health rewards, the Hearth's Provisions and the Elixir Flask, Sanctuary and Bone Harvest, and revives. **Shields** take the place of sustain: class shields give at most 3% of your max health per 10 seconds, all shield sources together at most 6%, and shields fade between fights.

### Class routes

Every hero also chooses a **route**: how their kit grows.

- At **team level 3** you pick one of four route cards: **Attack** (how your weapon fights), **Skill 1**, **Skill 2** or **Element** (the status your hero builds: Bleed for the Knight, Ranger and Shade; Fire, Holy, Shadow or Lightning for the others).
- At the **boss of stratum I** you pick a **fork** of your route: a Heavy or a Swift weapon (Attack), Burst or Guard (a skill), Focus or Spread (Element). A Heavy weapon hits slower and harder and Staggers foes; a Swift weapon hits fast, trades damage per hit for speed, and gives a burst of move speed after each attack.
- At the bosses of strata II and III your fork gains a **rank** on its own, with no pick, and a message names what it adds: rank 2 a new behaviour, rank 3 a transform that renames the card and changes how the skill or attack plays (skill forks transform too). Each class has 12 route cards.

## Heroes

You start with the **Knight**, **Ranger** and **Pyromancer**. Each hero has three weapons (unlocked by mastery, each with an Armory variant to buy) and two skills; the Pyromancer has a third. Skill cooldown reductions apply to every skill (full up to 40%, half beyond, 65% at most), and each hero's route cards shape the skills further.

| Hero | Skill 1 (Q) | Skill 2 (E) | Unlock |
| --- | --- | --- | --- |
| Knight | Shield Charge, 6 s: run through a pack, untouchable, stunning what you hit | Shield Throw, 9 s: a shield that ricochets between foes, stuns them and swats arrows, then returns; catch it for a shield | Start |
| Ranger | Volley, 5 s | Rain of Arrows, 10 s: a storm of arrows on a point | Start |
| Pyromancer (a caster: each Ember Bolt hit makes the spells recharge sooner; skill 3 on right mouse or `R` is Fireball, 2 charges, 2.5 s each: a shot that bursts and burns) | Flame Nova, 5 s: a fire blast around you that knocks foes back | Meteor, 8 s: telegraphed impact and burning crater | Start |
| Shade (35% base dodge) | Shadowstep, 4.5 s | Vanish, 11 s: smoke, stealth and a guaranteed-crit ambush | Defeat the Bone Warden |
| Cleric | Sanctuary, 11 s: heals you and allies near you, then holy ground that burns foes and cuts the damage allies take | Judgment, 9 s: a returning hammer that judges foes | Play 4 runs (clear a room in each) |
| Necromancer | Raise Legion, 12 s | Bone Harvest, 10 s: minions explode, then rise again | Defeat the Sporemother |
| Bellwarden (hold attack to wind the bell; let go to hurl it, it glows at full wind; press again to reel it home through foes) | Anchor Leap, 5 s: to your anchored bell, or a short leap; slams where you land | Peal, 10 s: every bell rings and stuns, stronger with Resonance from hurls and reels | A secret |

## The menus

The main menu has five entries. **Play** picks your hero, weapon and pact, then starts a solo run or opens a party (**Host a party**, or **Join a party** with a code). **Hearth** holds the upgrades, the Wardrobe and the chronicle. **Heroes** shows every hero's stats and mastery rewards. **Settings** holds Sound, Display (visual quality, frame cap, screen shake, damage numbers), Controls (cursor, cursor size, cursor colour, skill aim preview, key bindings) and your profile (name, save code, erase). **Credits** lists the art that Wickdeep is built from. `Esc` steps back out of a menu.

## Between runs (the Hearth)

- **Embers** are earned on every run that clears at least one room, win or lose. Spend them on 16 permanent upgrades. They matter (two points of health, 3% damage, three points of armor, a boon reroll, a few gold per rank), and hero mastery adds more up to level 10: a fully upgraded Hearth roughly doubles your odds over a half-upgraded one, but the build still decides a run. **Deep Wick** adds 10% gold and experience in dark rooms per rank, **Head Start** starts the run with a little experience, the **Stash** with a little gold, and **Second Wind** revives you once at a sliver of health if you fall outside a boss fight. Deeper strata reveal new upgrades.
- **Refunds are free:** every upgrade rank has a **Refund** button that returns its full cost, and **Reset all** (press it twice to confirm) returns every rank at once, so you can rebuild the Hearth for a new path.
- **Armory:** each hero's weapon variants, listed under the upgrades: an alternative version of a weapon with the same power and a different shape (the Arming Sword's slash-slash-lunge combo, the Earthbreaker's slam ahead, the Hooked Glaive's pull, the Radiant Mace's ring of light, the Sunlance's instant beam, the Mortar Tome's lobbed shell, the Shade's Boomerang Blades, the Votive Lamp's shielding pools of light, the Miasma Staff's trail of plague clouds, and more). A variant costs 40, 60 or 80 embers (for the first, second or third weapon), can be bought once its base weapon is unlocked, and refunds in full. An owned variant shows under its base weapon in the weapon picker of Play and the party lobby.
- **Heroes:** every run trains the hero you took, up to mastery 10. Mastery unlocks weapons and tiny permanent bonuses.
- **Deeds:** 26 achievements with ember rewards, including Evolved, **Into the Dark** (clear 6 dark rooms in one run) and **Cartographer** (clear two dark rooms and an elite room on one stratum), **Twinbreaker** and **Mimic Hunter** (clear the champion rooms of stratum IV).
- **Wardrobe:** looks for your heroes in the Hearth (and the lobby's Hearth): skins bought with embers at mastery 4 and 7, a weapon tint for each weapon you evolve in three runs, a golden aura at mastery 10, and more for those who find the secrets. Hover an item to preview it on your hero. Your party sees what you wear. Looks never change how a hero fights, and Wardrobe embers are not refunded.
- **Pacts:** ten optional difficulty tiers unlocked by winning, each paying more embers. They stack: the first three (tougher foes, harder hits, more elites) are gentle, the next two (scarce healing and less health, stronger bosses) are steep, then speed, prices, shots, frailty and an extra wave.
- The Hearth camp changes as you progress: more tents and lanterns, a banner per slain boss, a gate that glows with the colour of the deepest stratum you have reached, and a blood moon under a pact.

### Saving

Progress autosaves to the browser. **Settings > Profile** shows a portable save code (for example `WD1-XXXXX-XXXXX-…`). It packs the whole profile into letters and digits with a checksum. Paste it on any device or browser to continue (on a new device, use **I have a save code** on the first-run screen). No account or database is involved. Codes from earlier Wickdeep versions still load; the embers an old code spent on the removed relic Codex are refunded.

Wickdeep starts fresh profiles: saves and codes from Emberdeep (`ED1-…`) do not carry over, and the game says so if you paste one.

If you played an earlier version of Wickdeep, the first launch shows a one-time **"What changed"** notice with everything since the version you last played. The newest part: the branching map, four strata with no element weakness, one way to play per element, the removed boon layers (Ascended, duos, Mutations, Twists, Attunement and twelve stat boons), the caster Pyromancer with Fireball on its own key, the new boss fights and the reworked waves. Older profiles also see the earlier changes (small health numbers, a stronger Hearth, Armory variants, mouse aim, paths, shields, dark rooms, hordes, dash charges, fork ranks and more) and how many embers the Codex refunded.

Two tabs open on the same profile stay in step: each adopts the other's saved progress instead of overwriting it.

## Multiplayer

1. One player presses **Host a party** on the Play screen and shares the 5-character code, or the invite link.
2. Friends press **Join a party** and enter the code (or just open the link), pick a hero and press Ready. Everyone sees the pact the host has chosen.
3. The host presses **Begin**.

How it works:
- The host's browser runs the authoritative simulation. Friends connect peer-to-peer over WebRTC.
- The free public PeerJS broker handles the initial handshake. Its bundled STUN/TURN servers help connections get through home routers. There is no game server to run or maintain.
- Both ends exchange a heartbeat. A friend who goes silent for about 6 seconds (closed tab, crash, lost network) is removed from the run so the party is never left waiting; if the host goes silent, friends return to the results screen with the embers earned so far.

> **Note:** multiplayer depends on the free public PeerJS broker (`0.peerjs.com`) and its STUN/TURN servers. They are community services with no uptime guarantee. If the broker is down, solo play still works and parties can be tried again later. Some strict corporate or school networks block peer connections entirely.

The party shares in-run progression:
- One party level and one gold purse.
- Each hero picks their own boons, paths and class route.
- **Doors are a party decision:** the party moves on only when every living hero stands in the same door. The door shows who wants it ("Mira wants this door (1/2)") and the screen says who the party is waiting for.

At the end of the run everyone gets the embers, mastery and boss milestones from it (plus a party bonus). For example, a friend who helps beat the Bone Warden unlocks the Shade too.

Downed heroes can be revived by standing next to them. A hero who bleeds out returns at the next stratum. The run ends only when the whole party is down. After a run, the party returns to the lobby together; the lobby's **Hearth** button opens the upgrades and hero mastery so everyone can spend their embers before the next run.

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
src/sim/                  simulation: dungeon (the stratum maps), stats, world, combat, elements (the element verbs), build (offers, paths, evolutions, class routes),
                          skills, class-<hero>.js (each hero's skills and route hooks), enemy AI, bosses and boss-<name>.js, arena (boss arenas), champions, rooms, sheet (the Tab sheet model)
src/net.js                transports (PeerJS / local), host and client sessions, snapshots
src/game.js               a run in progress: local controller, client mirror, network routing
src/client/               input, aim, audio synth, adaptive score (score.js), icons, art atlas and actors, sprites, room art, effects (fx, pixfx, pickfx, cls-<hero>.js),
                          boss arenas, renderer, post (WebGL), HUD, camp, menus and pixel UI kit, boon cards, the Tab sheet UI, Wardrobe looks
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
node tools/sim.js 1 12 0.75 mid --from=4 --fight=twins       # walk to stratum IV and fight the twin champions (also boss, mimic)
node tools/journey.js 0.7 1           # a whole player journey from a fresh save
node tools/simpool.js 1 384 0.75 none,mid,max --pick=smart   # same bots in parallel, one line per profile
node tools/sheet.js --cls=all --routes --weapons             # analytic hero numbers, no bot runs
node tools/bal.js                                            # quick balance suite against the difficulty targets, about 3 minutes
node tools/browse.js                                         # headless browser smoke test
node tools/browse.js --scen=swing --cls=knight               # contact sheet PNG per melee weapon swing (two attacks, hold, idle)
node tools/browse.js --scen=cards --viewport=1920x1080       # every boon card kind, mid-pick frames, the fork reveal
```

`simpool.js` runs its workers at normal priority; add `--nice` for idle priority (Windows throttles idle priority while the machine is unattended).

`bal.js` prints a time estimate first, then one PASS/FAIL line per profile. It uses the veteran bot (a human proxy; `--vet=0` turns it off); `--from=N` starts the bots at stratum N and `--full` runs the sign-off sizes (about 25 minutes). `browse.js` is headless only, never a visible window: `--scen=smoke` (a short solo run), `crowd70` (frame cost with 70 live foes at Low and High quality), `shots` (screenshots of the menus, a run and the Tab sheet), `screens`, `sheet`, `boss`, `arenas`, `verbs`, `bell`, `wardrobe`, `cosmetics`, `picks`, `cards` and `swing` (see the file header). It needs Playwright.

Headless checks (each prints failures and exits 1 on any): `node tools/check-sim.js`, `check-build.js` (fork ranks, offer rules), `check-classes.js`, `check-knight.js`, `check-ranger.js`, `check-pyro.js` (Ember Bolt, Fireball and the Pyromancer's routes), `check-shade.js`, `check-cleric.js`, `check-necro.js`, `check-bell.js`, `check-fodder.js` (fodder rules), `check-perf.js` (sim cost per tick with 70 to 200 foes), `check-save.js`, `check-secrets.js`, `check-armory.js` (Armory weapon variants: lists, forks, choice fallbacks, host validation, shape mechanics), `check-armory-b.js` (the projectile variants: beam, lob, return, pool and trail with their route cards), `check-elements.js` (the element verbs, Burn, hold attacks, solids), `check-late.js` (the Purse, forge offers, no removed card kinds), `check-ux.js`, `check-render.js` (hit flash rules and art anchors) and `sheet-check.js` (the Tab sheet's numbers against the sim); `node tools/art.js --check` verifies that `src/art/` matches a rebuild of `art-src/`. Targets for the bots live in docs/GAME-DESIGN.md §10.

## Credits

The art in Wickdeep is built from third-party pixel-art packs and pixel fonts.

DawnLike tileset by DragonDePlatino (CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181), using the DawnBringer DB16 palette by DawnBringer. Cropped and recoloured for Wickdeep.

Free Pixel Effects Pack by CodeManu (Davit Masia), CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/ ; https://codemanu.itch.io/pixelart-effect-pack). Frames subsampled and recoloured for Wickdeep.

Pixel Operator font by Jayvee Enaguas (HarvettFox96), CC0.

16x16 DungeonTileset II by 0x72 (Robert); Dungeon Tileset II Extended by nijikokun; 16x16 Dark Dungeon by kosinaz; Ninja Adventure by Pixel-boy and AAA; Puny Characters by Shade; LuizMelo; Kenney; o_lobster; Aim studios; ansimuz.

The same credits are in the game under **Credits** in the main menu. `art-src/SOURCES.md` lists every vendored file with its pack, author, licence and hash.
