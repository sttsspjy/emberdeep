# Wickdeep — Game Design Spec

Canonical rules and numbers. Code follows this file; balance passes may retune numbers here and in code together.

## Pillars

1. **Builds are chosen, not rolled.** Paths gate boons, rooms show their reward before you enter, commitment unlocks a keystone and a weapon evolution.
2. **Every element has a job.** Burn = sustained damage, Freeze = control/burst, Discharge = crowds. Each stratum is weak to one element and resists another.
3. **Exploring is a wager.** More rooms = more power, but the lantern dims and the Deep grows stronger.
4. **Fights are read, not out-healed.** Low chip damage, heavy telegraphed damage, no sustain by default.

## 1. Damage model

- Enemy HP scale by stratum `s`: `1 + 0.65(s−1) + 0.08(s−1)²` (unchanged). Enemy damage scale: `1 + 0.22(s−1) + 0.03(s−1)²`.
- Contact damage: touching a foe outside an attack state = `0.4 × dmg`, contact cooldown 1.0 s. Attack states (`lunge`, `charge`, leaps) = `1.0 × dmg`.
- No weapon deflects projectiles passively (`deflect` removed). Projectiles are only stopped by: Knight's Bulwark, Spirit "Guardian Spirits" blades, Mirror Shard relic (chance).
- Lifesteal exists only in the Blood path. Leech healing per hero is capped at **2% max HP per second** (rolling 1 s window). DoT ticks never leech.
- Heart drop chance 4% (elites 40%).
- Every hit's damage is the same no matter how it was produced; statuses build from **damage dealt, never from hit count**, so attack speed and damage scale them equally.

## 2. Elements and statuses

Elements: `pyre`, `rime`, `storm`. Physical paths (`steel`, `blood`, `spirit`) ignore affinity.

**Affinity** `aff(el)`: stratum `biome.weak === el` → ×1.5, `biome.resist === el` → ×0.5, else ×1. Applies to that element's damage and status build-up.

| Stratum | Weak | Resist |
|---|---|---|
| I Ossuary | pyre | storm |
| II Glowmire | storm | pyre |
| III Rimefrost | pyre | rime |
| IV Cinderforge | rime | pyre |
| V Drowned Sanctum | storm | rime |
| VI Starless Abyss | rime | storm |

**Infusion**: a path gate sets an infusion stat. Every direct hero hit (weapon, skills, dash damage, evolution strikes; companions only with Elemental Bond) applies each owned infusion using that hit's final damage. DoT ticks, discharges and explosions flagged `noProc` never infuse.

### Burn (pyre)
- Infused hit: `e.burnPool += dmg × pyreInfuse × aff`.
- Tick every 0.5 s: deal `max(1, pool × 0.2) × (1 + burnMul)`, reduce pool by `max(1, pool × 0.2)`. Pyre damage, credited to `e.burnOwner`, never crits.

### Chill / Freeze (rime)
- Infused hit: `e.chill += ((dmg / e.maxHp) × 260 + 2) × rimeInfuse × (1 + chillMul) × aff × (boss 0.35 | elite 0.7 | 1)`.
- Decay: 1.5 s after the last gain, chill drops 25/s.
- While chilled: move speed × `1 − min(0.45, chill/180)`; attack wind-ups × `e.windMul = 1 + chill/220`; foe damage × `1 − chillWeaken`.
- At chill ≥ `100 × (1 + 0.5 × e.freezeRes)`: frozen for `1.6 × (1 + freezeDur)` s (elite ×0.75; boss flat 0.6 s), chill → 0, `freezeRes += 1` (decays 1 per 6 s).
- Frozen: no movement, AI or attacks; takes +25% damage (brittle).

### Charge / Discharge (storm)
- Infused hit: `e.charge += dmg × stormInfuse × aff`; `e.chargeOwner` = that hero.
- Every 1.0 s per foe (0.5 s with Tempest Arms): if charge > 0, discharge: `charge × (1 + shockMul)` hits the foe and arcs to up to `3 + arcs` nearest other foes within `140 × (1 + arcRange)`, each taking the same. Charge → 0. Arcs never add charge (duos excepted). Emits `chain`.

### Bleed (steel)
- Critical hit by a hero with `bleed`: `e.bleedPool += hitDmg × bleed`. Drains like Burn (20% per 0.5 s). Physical, no affinity.

### Damage taken by foes (order)
1. Hero multiplier (dmg stat, conditionals: execute, searing, lacerate, berserk, momentum, idol, banner).
2. Crit ×critMult.
3. Foe vulnerability `1 + Σ(mark 0.25, judged 0.2, frozen 0.25, sunder stacks × 0.04)`.
4. Element affinity (elemental damage only).
5. `e.exposed` ×1.5.
6. Guard: if `e.def.guard = {arc, mul}` and the attack comes from within `arc/2` of `e.guardA` → ×mul (DoT, discharges and explosions ignore guard). Emits `guardhit`.
7. `e.dmgTakenMul` (default 1). `e.def.invuln`, `e.burrowed`, `e.invulnT > 0` → 0.
8. Ward absorbs as before.

## 3. Paths

Six paths. A hero owns at most **3 gates** (path slots) per run. `affinity(path)` = sum of ranks of that hero's boons in the path. Boon data: `path`, `gate: true`, `key: true` (needs affinity ≥ 3), `evo: '<path>'`, `duo: [a, b]` (needs both gates). Rarity: `c` common, `r` rare, `e` epic (keystones), `l` legendary (evolutions), `d` duo.

### Pyre — `#ff7a2a`, icon `flame`
| id | name | rar | max | effect |
|---|---|---|---|---|
| kindle | Kindle (gate) | r | 1 | Hits add 40% of their damage as Burn. `pyreInfuse 0.4` |
| stoke | Stoke the Flames | r | 3 | Burn deals +30% damage. `burnMul 0.3` |
| searing | Searing | c | 2 | +12% damage to burning foes. `searing 0.12` |
| wildfire | Wildfire | r | 2 | A burning foe that dies sets foes within 80 alight for 15% of its max HP per rank. `wildfire 0.15` |
| cindertrail | Cinder Trail | r | 1 | Your dash leaves burning ground. `dashFire 1` |
| conflag | Conflagration (key) | e | 1 | When a foe's Burn pool exceeds 30% of its current HP it combusts: the whole pool hits it and foes within 70 at once. `conflag 1` |
| evo_pyre | Cinder Arms (evolution) | l | 1 | Melee swings also launch a piercing flame crescent (60% weapon damage); projectiles explode on hit (50%, r40). Burn +25%. |

### Rime — `#7fe3ff`, icon `snow`
| id | name | rar | max | effect |
|---|---|---|---|---|
| frostbite | Frostbite (gate) | r | 1 | Hits chill; full chill freezes for 1.6 s; frozen foes take +25%. `rimeInfuse 1` |
| deepcold | Deep Cold | r | 3 | +35% chill build-up. `chillMul 0.35` |
| shatter | Shatter | r | 2 | A hit on a frozen foe ends the freeze, deals +80% per rank, and 50% of it bursts to foes within 60 (infused). `shatter 0.8` |
| coldsnap | Cold Snap | r | 1 | Dashing releases a frost ring (r80) adding 40 chill. `dashFrost 1` |
| permafrost | Permafrost | c | 2 | Freeze lasts 30% longer; chilled foes deal 10% less damage. `freezeDur 0.3, chillWeaken 0.1` |
| abszero | Absolute Zero (key) | e | 1 | Freezing a foe releases a frost nova adding 60 chill to foes within 100. `frostNova 1` |
| evo_rime | Glacial Arms (evolution) | l | 1 | Every 3rd attack also fires 5 piercing ice shards in a fan (50% weapon damage each, infused). Chill +25%. |

### Storm — `#ffe66b`, icon `bolt`
| id | name | rar | max | effect |
|---|---|---|---|---|
| staticcharge | Static Charge (gate) | r | 1 | Hits charge foes with 50% of their damage; every second charged foes discharge to themselves and 3 nearby foes. `stormInfuse 0.5` |
| conductor | Conductor | r | 2 | +1 arc target, +30% arc range. `arcs 1, arcRange 0.3` |
| highvoltage | High Voltage | r | 3 | Discharges deal +25%. `shockMul 0.25` |
| thunderstep | Thunderstep | r | 1 | Foes you dash through take 100% weapon damage (infused). `dashShock 1` |
| overload | Overload | c | 2 | Discharges stun non-boss foes 0.25 s per rank. `arcStun 0.25` |
| thunderhead | Thunderhead (key) | e | 1 | Each discharge has a 25% chance to drop a thunderbolt on the foe: 200% weapon damage, r60. `thunderbolt 0.25` |
| evo_storm | Tempest Arms (evolution) | l | 1 | Every 4th attack calls lightning on its target (150% weapon damage, r50, infused). Foes discharge every 0.5 s. |

### Steel — `#d9dfe8`, icon `sword`
| id | name | rar | max | effect |
|---|---|---|---|---|
| honededge | Honed Edge (gate) | r | 1 | +8% crit chance; crits make foes Bleed for 40% of the hit. `crit 0.08, bleed 0.4` |
| brutal | Brutality | r | 3 | +35% crit damage. `critDmg 0.35` |
| keen | Keen Eye | c | 2 | +6% crit chance. `crit 0.06` |
| lacerate | Lacerate | r | 2 | +15% damage to bleeding foes. `lacerate 0.15` |
| execute | Executioner | r | 2 | +40% damage to foes below 30% HP. `execute 0.4` |
| sunder | Sunder (key) | e | 1 | Each crit makes that foe take +4% damage from you (max +40%). `sunder 1` |
| evo_steel | Masterwork Arms (evolution) | l | 1 | Crits release a spectral strike (repeat swing or spectral projectile) at 60%. +10% crit chance. |

### Blood — `#d43a5a`, icon `drop`
| id | name | rar | max | effect |
|---|---|---|---|---|
| bloodpact | Blood Pact (gate) | r | 1 | Kills heal 1% max HP. Below 50% HP deal +15% damage. `killHealPct 0.01, berserk 0.15` |
| leech | Leech | r | 2 | Heal 2.5% of damage dealt (cap 2% max HP/s). `leech 0.025` |
| bloodrush | Bloodrush | r | 2 | Below 50% HP: +15% attack speed, +10% move speed. `bloodrush 0.15` |
| transfusion | Transfusion | c | 1 | Kills drop a blood orb 20% of the time (heals 4% max HP). `bloodOrb 0.2` |
| hemomancy | Hemomancy | r | 2 | Skills cost 4% current HP but deal +35%. `hemomancy 0.35` |
| crimsontide | Crimson Tide (key) | e | 1 | Overhealing becomes a blood shield (max 25% max HP) that absorbs damage first. `bloodShield 0.25` |
| evo_blood | Sanguine Arms (evolution) | l | 1 | Every attack also launches a blood scythe/shard (50%) that heals 15% of its damage (uncapped). Kill heals ×2. |

### Spirit — `#b78cff`, icon `orb`
| id | name | rar | max | effect |
|---|---|---|---|---|
| wispcall | Spirit Wisp (gate) | r | 1 | A wisp fights at your side. `wisp 1` |
| orbit | Orbiting Blades | r | 3 | +1 blade circles you. `orbit 1` |
| wispchoir | Wisp Choir | r | 2 | +1 wisp. `wisp 1` |
| kindred | Kindred | c | 2 | Companions (wisps, blades, minions) +35% damage. `compDmg 0.35` |
| guardians | Guardian Spirits | r | 1 | Blades destroy enemy projectiles they touch (each blade ≤ once per second). `bladeBlock 1` |
| bond | Elemental Bond (key) | e | 1 | Companion hits apply your infusions. `compInfuse 1` |
| evo_spirit | Ascendant Arms (evolution) | l | 1 | A spectral twin repeats every attack 0.15 s later at 50%. +1 wisp, +1 blade. |

### Duo boons (rar `d`, need both gates)
| id | paths | effect |
|---|---|---|
| thermalshock | pyre+rime | When a burning foe freezes, its Burn pool is dealt instantly ×2. |
| plasma | pyre+storm | Discharges add Burn equal to 40% of their damage. |
| superconductor | rime+storm | Discharges add 25 chill; frozen foes arc to 2 extra targets. |
| hemorrhage | steel+blood | Bleed heals you 10% of its damage (counts toward the leech cap). |
| staticedge | steel+storm | Crits discharge the foe's charge instantly at +50%. |
| serrated | steel+rime | Crits on chilled foes add 35 chill; frozen foes take +50% crit damage. |
| soulfire | spirit+pyre | Companion hits add Burn equal to 60% of their damage. |
| feast | spirit+blood | Companion kills heal you 1% max HP; companions +20% damage. |

### Neutral boons (no path; low caps)
vigor (c,3: +15 max HP, heal 15) · plating (c,2: +5 armor) · fleet (c,2: +7% move) · focus (c,3: skills −10% cd) · lightstep (c,2: dash −20% cd) · magnet (c,2: +40% pickup, +10% xp) · edge (c,2: +10% damage) · quick (c,2: +10% attack speed) · wide (r,2: +15% area) · bounty (c,2: +25% gold) · evade (r,2: +6% dodge) · thorns (r,2: attackers take 10, +4 armor) · pierce (r,2, ranged: +1 pierce) · split (r,2, ranged: +1 projectile, −8% damage) · bladedash (r,1: dashing through foes deals 120% weapon damage) · echo (e,1: K skill holds 2 charges) · laststand (e,1) · glass (e,1: +30% damage, −15% max HP) · trance (e,1: a skill grants +30% attack speed 4 s) · overcharge (e,1: skills release a shockwave).

Removed from the old pool: leech/keen/brutal/execute (moved to paths), kindle/frost/static (now gates), mend, twin, burst, thirst, momentum, bulwark.

## 4. Offers

- A hero holds a queue `p.offers` of offer specs; `p.picks === p.offers.length`. Offers open only when the room is safe (as before). API: `W.grantOffer(p, spec)`.
- Spec `src`: `level` · `room` (with `path`) · `class` · `start` · `forge` · `epic`.
- Cards: 3 (+1 with Crown of Choice).
- **level**: eligible pool = neutral + non-gate boons of owned paths + gates while slots are free + keystones at affinity ≥ 3 + duos with both gates + class boons. Weight = rarity weight (c 60, r 30 + 2.5s + 60·luck, e 10 + 2s + 40·luck, d 12) × (owned path 2.5) × (gate 0.8) × (class 1.4).
- **room(path X)**: X owned → 3 cards from X (non-gates, keystone if eligible, duos involving X). X not owned and a slot free → card 1 = X's gate, cards 2–3 from the level pool. Slots full and X not owned → level offer with rarity ≥ r.
- **class**: 3 class boons of the hero (fill from level pool if fewer).
- **start**: 3 gates of distinct random paths (granted once at run start).
- **forge**: up to 3 owned boons below max; picking ranks one up. None → level offer.
- **epic**: level pool, rarity ≥ r, 4 cards, keystones ×2.
- **Evolution**: when a path has affinity ≥ 5 and its keystone is owned and the hero has no evolution, every non-forge offer adds that path's `evo_*` card first. Picking sets `p.evo = path`, emits `{t:'evolve', pid, path}`. One evolution per run. Weapon display name: `Cinder | Glacial | Tempest | Masterwork | Sanguine | Ascendant` + weapon name.
- Offer message to client: `{t:'offer', boons, rerolls, picks, src, path}`. Rerolls work on every offer except forge.

## 5. Skills (K = slot 0, L = slot 1)

Slot 0 skills unchanged (charge, volley, nova, step, sanctuary, legion). Slot 1:

| Class | Skill | cd | Effect |
|---|---|---|---|
| Knight | **Bulwark** | 9 | Raise a shield 1.4 s toward your aim; move ×0.5. Hits from within ±75° of facing are blocked (≤ 6 counted); projectiles from the front are reflected (friendly, 15 + 100% weapon damage). On release: bash cone r70 arc 1.6 for `(20 + 1.2 × weapon) × (1 + 0.25 × blocks)`, knock 220. |
| Ranger | **Rain of Arrows** | 10 | Target point (≤ 260). After 0.35 s, arrows fall for 2 s in r80: every 0.25 s all foes inside take `4 + 0.45 × weapon` (infused). |
| Pyromancer | **Meteor** | 12 | Target point (≤ 300). 0.9 s telegraph, impact r95: `30 + 3.5 × weapon`, knock 220, adds Burn = 50% of the impact (even without Kindle), crater (pfire r60, 3 s). |
| Shade | **Vanish** | 11 | Smoke r75 for 3 s (foes inside slowed 40%, cannot start attacks). Stealth 2.5 s: foes cannot target you. Next attack within stealth (+0.5 s) is an Ambush: guaranteed crit, +150%. Attacking ends stealth. |
| Cleric | **Judgment** | 9 | A hammer flies 0.55 s out and returns, piercing; each leg hits a foe once for `18 + 1.4 × weapon` and Judges it 4 s (+20% damage taken). A judged foe dying heals allies within 160 by 3% max HP. |
| Necromancer | **Bone Harvest** | 10 | Each of your minions explodes (r60, `24 + 1.8 × weapon`); heal 3% max HP per minion; then raise 1 minion (12 s). No minions: raise 2. |

Skill cooldown reduction applies to both slots. Class boons (2 per skill, 4 per class):

| Class | Existing | New |
|---|---|---|
| Knight | shieldwall, quake | **bastion** (r): Bulwark lasts 50% longer, bash stuns 1.2 s · **mirrorguard** (e): Bulwark blocks from every side and reflects at 250% |
| Ranger | mark, arrowstorm (was `storm`) | **barrage** (r): Rain +40% radius, +1 s · **hailthorns** (e): foes inside Rain are slowed 50% and take +20% damage |
| Pyromancer | combust, phoenixnova | **twinmeteor** (e): a second Meteor lands 0.6 s later on the nearest foe · **moltencore** (r): crater lasts 3× longer, burns 2× hotter |
| Shade | assassin, decoy | **smokescreen** (r): smoke +40% radius, +2 s, foes inside take +20% · **nightsedge** (e): an Ambush kill refunds Vanish |
| Cleric | wrath, blessed | **twinhammer** (r): Judgment throws two hammers in a V · **verdict** (e): judged foes explode on death (60 + 150% weapon, r70) |
| Necromancer | legionplus, bonespikes | **grimharvest** (r): Harvest explosions +50%, raise 2 · **soulsiphon** (e): minion hits heal you 1 (≤ 4/s) |

Controls: K / X / right mouse = skill 1; L / C / E / middle mouse = skill 2; gamepad skill 1 = B/RB, skill 2 = Y/LT.

**Starting heroes**: Knight, Ranger, Pyromancer. Locked: Shade (defeat the Bone Warden), Cleric (complete 4 descents), Necromancer (defeat the Sporemother).

## 6. Floors, rooms and rewards

Per stratum: start, boss, treasure, shop, event shrine, rest site, normal combat `[5,5,6,6,6,6][s−1]`, elite combat `[1,1,1,2,2,2][s−1]` → 12–14 rooms. Grid bounds ±4, tree layout. Boss = farthest dead end, BFS distance ≥ 4. Utility rooms prefer dead ends; elite rooms prefer distance ≥ 3.

- Wave budget × `danger = 1 + 0.05 × distance`. Elite rooms: 2 waves + 2 elites guaranteed (3 waves under Pact 10).
- **Rewards** are fixed at generation (deterministic from the floor seed) and shown on doors and the map before entering:
  - normal combat: `boon:<path>` 50% (each path at most twice per floor) · `gold` 12% · `vigor` 10% · `forge` 10% · `oil` 10% · `class` 8%. Each floor has ≥ 3 `boon:*` and ≥ 1 `oil`.
  - elite: `relic` 50% · `epic` 50%.
- On clear, a `reward` prop appears at the room centre. Per-hero claims: `boon:<path>` → room offer, `class`, `forge`, `epic`, `vigor` (+12 max HP via `p.bonusHp`, heal 20%). Party claims (once): `gold` (15 + 8s, × dread bonus), `oil` (+25 light), `relic` (relic hoard as from a chest).
- **Rest site**: a campfire (heal 35%) and an anvil (forge offer); each hero uses one.
- **Shop**: 2 relics (+1 with Merchant's Favor 2), epic boon, healing draught (40%), lantern oil (+30 light, `25 + 10s` gold), forge (`60 + 15s` gold).
- XP per level: `round(24 + 10(L−1) + 1.2(L−1)²)`. Level-ups grant `level` offers.

## 7. Lantern and Dread

- `w.light` ∈ [0, lightMax]; `lightMax = 100 × (1 + 0.1 × Deep Wick rank)` (best in party). Refills to max at each stratum.
- Drain per second = `100 / [270, 280, 290, 300, 310, 320][s−1]`, only while playing, not in the boss room, not during stratum transition (solo boon picking already freezes the world).
- **Dread tier** by `light / lightMax`: ≥ 0.5 Bright (0) · ≥ 0.25 Dim (1) · > 0 Dark (2) · 0 Lightless (3).

| Tier | Foe HP & damage | Elite chance | Wave budget | Gold & embers from rooms |
|---|---|---|---|---|
| Bright | ×1 | +0 | ×1 | ×1 |
| Dim | ×1.12 | +0.10 | ×1.05 | ×1.5 |
| Dark | ×1.25 | +0.20 | ×1.15 | ×2 |
| Lightless | ×1.4 | +0.35 | ×1.25 | ×2 |

- Applied at spawn through `w.dread = {hp, dmg}`. The boss takes the multiplier of the tier when its room is entered (light does not drain there).
- **Lightless**: 4 s after entering a non-boss, non-start room, a telegraphed **Gloom** stalker spawns: invulnerable, passes through walls, speed 50, contact damage 35 × stratum damage scale, ignored by room-clear checks; despawns when you leave the room.
- Emits `{t:'dread', tier}` on tier change. Renderer darkens the world and shrinks hero light with the light fraction.
- The global 20-minute lantern is removed.

## 8. Enemies

- Every telegraphed wind-up is multiplied by `e.windMul` (default 1). Foes with `e.blind > 0` cannot start attacks. Stunned/frozen foes do nothing.
- **No untelegraphed teleports.** Casters lose the random blink; instead, when a hero is within 80 and the step is off cooldown (7 s), they telegraph 0.6 s (marker at origin and destination) and step 150 away.
- Every biome gets new attack patterns on existing foes and at least one new foe:
  - I **Bone Priest** (support): raises a dead skeleton (telegraphed), wards an ally.
  - II **Mire Worm** (burrower): travels under ground (untargetable, visible trail), erupts under the hero after a 0.8 s ground telegraph, spore ring.
  - III **Frost Sentinel** (guard): frontal shield `guard {arc 2.2, mul 0.2}` blocks projectiles from the front, shield-bash charge.
  - IV **Ember Drone** (orbiter): circles the hero at ~160, fires 3-shot bursts.
  - V **Drowned Reaver** (leaper): leaps to the hero's position (landing circle), cleaving cone on landing.
  - VI **Rift Caller** (summoner): opens a telegraphed rift that spawns 2 starspawn every 6 s.
  - **Gloom** (Lightless stalker, any stratum).
- Each boss gains one new telegraphed attack.

## 9. Hearth (meta)

- New upgrade **Deep Wick** (tier 1): +10% lantern light per rank, costs 40/90/160.
- New deeds: Evolved (evolve a weapon, 40) · Into the Dark (defeat a boss while Lightless, 50) · Cartographer (clear every room of a stratum, 40).
- Profile key `wickdeep.profile.v1`, save code prefix `WD1-`, peer prefix `wickdeep-v1-`. Old Emberdeep saves are not imported.

## 10. Balance targets (bots, `tools/sim.js`, skill 0.75)

| Profile | Win rate | Avg depth |
|---|---|---|
| Fresh | ≤ 5% | 2.5–3.5 |
| Half-upgraded | 25–40% | — |
| Fully upgraded | 65–80% | — |
| Fully upgraded, Pact 5 | 20–35% | — |

- Winning descent 22–32 min game time with ~70% of rooms explored.
- No single boon or relic forced from the start raises the fresh-profile win rate by more than 15 points.
