# Wickdeep — Game Design Spec

Canonical rules and numbers. Code follows this file; a balance pass changes numbers here and in code together.

## Pillars

1. **Builds are chosen, not rolled.** Paths gate boons, rooms show their reward before you enter, commitment unlocks a keystone and a weapon evolution, and every hero picks a class route (attack, skill 1, skill 2 or element) with a fork.
2. **Every element has a job.** Fire = sustained damage, Ice = control and burst, Lightning = crowds, Poison = amplifier, Holy = Smite and shields, Shadow = Reap and execute, General = crits and Bleed. Each stratum is weak to one element and resists another.
3. **Exploring is a wager.** More rooms = more power, but every new room costs lantern light and the Deep grows stronger as it dims; light you keep shields and heals you at the boss door.
4. **Fights are read, not out-healed.** Low chip damage, heavy telegraphed damage, no sustain by default: nothing heals from hits or kills, and shields are windowed.

## 1. Damage model

- Foe HP = base × `1 + 0.65(s−1) + 0.08(s−1)²` × **threat HP** × party multiplier. Foe damage = base × `1 + 0.22(s−1) + 0.03(s−1)²` × **threat damage** (below 1 in every stratum). Boss HP is absolute (below), scaled by party, pact and dread.
- **Threat** per stratum (`World.THREAT`): HP ×, damage ×, wave budget ×, attack-cooldown rate `cdRate` (foe cooldowns tick faster by this fraction, negative = slower, only while the foe can act; wind-ups never change; bosses are exempt), boss pause × (time between boss attacks):

| Stratum | HP × | Damage × | Wave × | `cdRate` | Boss pause × |
|---|---|---|---|---|---|
| I | 2.2 | 0.5 | 0.8 | −40% | 2 |
| II | 1.62 | 0.5 | 0.75 | −30% | 1.7 |
| III | 1.3 | 0.5 | 0.7 | −10% | 1.4 |
| IV | 1 | 0.4 | 0.66 | 0 | 1.2 |
| V | 1.07 | 0.78 | 0.62 | +15% | 1 |
| VI | 1.02 | 0.98 | 0.6 | +30% | 0.9 |

  Effective foe HP multiplier (depth curve × threat HP): 2.2 / 2.8 / 3.4 / 3.7 / 5.2 / 6.4. Effective foe damage multiplier (depth curve × threat damage): 0.5 / 0.6 / 0.8 / 0.8 / 1.8 / 2.8.
- Boss HP: Bone Warden 4,350 · Sporemother 5,950 · Rimeheart 16,500 · Forgelord 17,400 · Drowned King 50,400 · Hollow King 59,000. Boss base damage 6.4 (Forgelord 5.5, Drowned King 8, Hollow King 7.5). A foe still alive 45 s into its encounter (bosses 78 s) is **exposed**: ×1.5 damage taken, ×1.5 speed, and it loses 4% of its max HP per second (bosses 1.2%).
- Elite HP × `2.4 + 0.4(s−1)` (`World.ELITE`), damage × 0.9, radius × 1.22. Affixes: swift (×1.4 speed, wind-ups ×0.7 but never under 0.4 s), brutal (×1.4 damage), warded (ward = 45% of max HP), volatile (explodes on death), vampiric (heals ×3 the damage it deals a hero).
- Party multiplier (n = other heroes): foe HP `1 + 0.85n + 0.3n(n−1)` (two heroes ×1.85, three ×3.3, four ×5.35), wave budget `1 + 0.6n + 0.2n(n−1)`. A downed hero bleeds out in 18 s when no ally revives them (solo: at once).
- HP-relative statuses (Chill and Venom build-up, Conflagration, Wildfire) measure against foe HP before the stratum lever (bosses: `refHp`, the design HP 800–7,800), so inflating HP does not weaken them.
- Contact damage: touching a foe outside an attack state = `0.4 × dmg`, contact cooldown 1.0 s. Attack states (`lunge`, `charge`, `leap`, `bash`, `dive`) and the Gloom = `1.0 × dmg`. Boss contact damage × 0.8.
- Every hit's damage is the same no matter how it was produced; statuses build from **damage dealt, never from hit count**, so attack speed and damage scale them equally.

### Damage dealt by a hero (order, `hitEnemy`)

1. **Hero multiplier** (one additive sum, at least ×0.1): `dmg` stat + conditional rows (execute: foes below 30% HP; searing: burning; lacerate: bleeding; malice: carrying Doom; brittle: chilled or frozen; fester: envenomed; opportunist: stunned, frozen or blinded; Death Knell stacks; Brand per ailment; Guardian Light; Embolden) + the class hook (`hitMul`: Momentum, Channel, Soul Barrage…) + class-element skill hits (`classElMul`), Golden Idol (+1% per 15 party gold, at most 20%), Banner of Unity. The `dmg` stat itself is `1 + Σ additive sources`, then **× (1 + x) for each owned Ascended boon** (§3): the Ascended bucket sits after every additive source of the stat block. Known gap: the conditional rows, the class hook and Idol/Banner are added to `dmg` inside `hitEnemy`, so an Ascended ×`dmg` multiplies only the stat part until the hit multiplier moves into `combat.js`.
2. **Crit** × `critMult` (1.75 + crit damage; chance capped at 95%), then the class `critMul`.
3. The hit's own factor `src.mul` (Cleave, Ambush, Deadeye by distance flown, Ballista's pierce ramp, Gathering Force, Gangrene, …); with the Shatter boon, a hit on a frozen foe takes its bonus and ends the freeze.
4. **Foe vulnerability** `1 + Σ`: Marked (Hunter's Mark, `markV`) · Judged or `vulnT` (+0.2, once: Judgment, Hail of Thorns, smoke do not stack) · Frozen +0.25 · Sunder +0.04 per stack (own stacks, max 10) · Venom `venom/100 × (0.25 + corrode)` (full from the hero who added Venom, ×0.5 from allies). Co-op debuffs are single foe states: the strongest value wins, they never add.
5. **Element affinity** (§2): ×1.5 weak, ×0.5 resisted. Class-skill parts tagged `el: class` take half of it (×1.25 / ×0.75); their statuses take the full value.
6. `exposed` ×1.5.
7. **Guard**: a foe with `guard {arc, mul}` takes ×mul from attacks inside the arc (damage over time, discharges and explosions ignore it; a Corroded foe has none). Emits `guardhit`.
8. `dmgTakenMul` (default 1). Invulnerable, burrowed or `invulnT` foes take 0.
9. **Ward** (warded elites) absorbs 75% of each hit until it breaks.

Status ticks, Smites, Tolls and discharges are `raw` hits: no hero multiplier, no crit, no further infusion.

### Damage taken by a hero (order, `hurtPlayer`)

1. Untouchable while: hit-invulnerable (0.6 s after a hit, 0.3 s after a hazard), dashing, or inside a skill move's i-frames (`skillIfr`).
2. Mirror Shard (25% chance to shrug off a projectile), then dodge (cap 60%, not against hazards; 0.25 s untouchable after), then Aegis Charm (blocks one hit per 10 s).
3. `amount × 60/(60 + armor) × (1 + vuln)`.
4. **Brace** (Knight, Vanguard) × the best **Sanctuary** here; their product never goes below ×0.5 (`DR_FLOOR`). Then Last Stand ×0.4, then a Judged foe's weakening (Verdict), then Chill (`chillWeaken`).
5. Rounded, at least 1. A Gloom touch is at most 25% of max HP (`GLOOM_CAP`).
6. The **shield** absorbs first, then health. Thorns strike the attacker; a vampiric elite heals 3× the damage dealt.

### Shields

- Every shield a hero receives passes one sliding 10 s window in `World.addShield`, except Battle Ward and the boss door: **class sources give at most 3% of max HP per window, all sources together at most 6%** (`SHIELD_WIN_CLASS`, `SHIELD_WIN_ALL`). Holy (Smite) and Bone Armor shields count only in the all-sources window.
- Sources: Rallying Charge, Shield Throw catch, Phoenix Mantle, Veil of Night, Judgment kill shield, Sacred Lantern orbs (class window); Smites (Holy); Bone Armor; Battle Ward (5% max HP when an elite room locks); the boss door.
- Shields fade by 2% of max HP per second while no room is locked and outside boss rooms (`SHIELD_DECAY`). A shield above its cap is never lowered. Dread's healing multiplier scales shield gains. A downed or dead hero gains none.

### Healing

- No life steal: hits, kills, damage over time and shield overflow never heal. Heal sources: hearts 22% max HP + 6 (+3% per Forager rank); campfire 35% (once per hero); healing draught 40% (shop); fountain 50% (also raises the downed); Vigor reward 20%; Vigor boon 15; Provisions (Hearth) 10% per rank and Elixir Flask 20% at each stratum after the first; Sanctuary 7% on cast (you and allies within 180); Bone Harvest 3% per minion harvested, at most 6%; the boss door (§7); revive; Second Wind, Phoenix Feather and Guardian Angel (one-off saves).
- Healing received × `healMul` = (1 + Mending, Heartwood and Elixir bonuses) × pact × the dread tier (§7).
- Hearts drop from kills (4%, elites 40%), cleared rooms (36%, +10% per Forager rank in the party, at most 80%) and bosses (two).

### Stopping shots, stuns and moves

- Enemy projectiles are stopped only by: the Shield Throw in flight, Shield Orbit, Bone Knights, and Mirror Shard (chance). No weapon deflects.
- **Hero stuns** (`stunFoe`): bosses are never stunned; elites take half; a stun sets `stunCd = dur + 2 s` and one landing while `stunCd > 0` lasts half as long; repeating sources (waves, shocks, Overload, Shield Orbit contacts, Bone Knight strikes) skip while `stunCd > 0` and set it to at least 1 s.
- **Stagger**: a Heavy weapon's direct hit stuns a non-boss foe 0.2 s (elites 0.1 s), once per 2 s per foe, never while `stunCd > 0`; it does not set `stunCd`. Hit-stop is client render only; the sim never pauses.
- **Parry** (Sworn Blade): a Cleave that starts in the last 0.3 s of a foe's wind-up cancels it and stuns 0.6 s (elites: stun 0.3 s, no cancel; never bosses), once per 2.5 s per hero and 4 s per foe.
- Skill moves (Charge, Shadowstep, Comet, Scattershot hop) never fire dash riders; their i-frames last the `iframes` seconds of the move.

### Weapons

Weapon index 0 is available at once, index 1 at mastery 3, index 2 at mastery 6. Attack interval is `rate / attack speed`, never under `max(0.12 s, 0.06 s × shots)`: attack speed beyond that floor becomes weapon damage. Fork columns are the Heavy and Swift versions (§5).

| Hero | Weapon | dmg · interval | Notes | Heavy | Swift |
|---|---|---|---|---|---|
| Knight | Longsword | 18 · 0.42 | arc 1.9, range 50 | Greatsword 35.6 · 0.756 | Saber 10.9 · 0.231 |
| | Warhammer | 34 · 0.82 | shockwave r72 at 50% | Maul 59.3 · 1.3 | War Pick 20.6 · 0.451 |
| | Glaive | 20 · 0.5 | range 82, arc 0.75 | Halberd 39.6 · 0.9 | Spear 12.1 · 0.275 |
| Ranger | Longbow | 12 · 0.34 | arrows | Greatbow 23.8 · 0.612 | Hunting Bow 7.26 · 0.187 |
| | Heavy Crossbow | 24 · 0.72 | pierce 2 | Arbalest 47.5 · 1.296 | Repeater 14.5 · 0.396 |
| | Twin Shortbows | 4.5 · 0.25 | 2 arrows | Twin Recurves 8.91 · 0.45 | Twin Flatbows 2.72 · 0.138 |
| Pyromancer | Fire Staff | 15 · 0.5 | blast r40 at 60% | Magma Staff 29.7 · 0.9 | Spark Staff 9.08 · 0.275 |
| | Ember Wand | 6 · 0.15 | sparks build 15% Burn | Cinder Rod 11.9 · 0.27 | Flicker Wand 5.28 · 0.12 |
| | Inferno Tome | 30 · 1.0 | blast r72 at 80% | Tome of Ruin 42.9 · 1.3 | Pocket Grimoire 18.2 · 0.55 |
| Shade | Twin Daggers | 11 · 0.21 | range 42 | Twin Kukris 21.8 · 0.378 | Stilettos 6.91 · 0.12 |
| | Throwing Knives | 7 · 0.36 | fan of 3 | Chakrams 13.9 · 0.648 | Darts 4.24 · 0.198 |
| | Crescent Scythes | 16 · 0.48 | full circle | Great Scythes 31.7 · 0.864 | Sickles 9.68 · 0.264 |
| Cleric | Holy Mace | 17 · 0.42 | wave every 3rd swing, 90% | Morning Star 33.7 · 0.756 | Flail 10.3 · 0.231 |
| | Dawn Hammer | 32 · 0.72 | wave every 3rd swing, 100% | Sunforged Maul 63.4 · 1.296 | Dawn Pick 19.4 · 0.396 |
| | Sacred Lantern | 12.5 · 0.42 | pierce 1; orbs shield allies | Great Lantern 24.8 · 0.756 | Censer 7.56 · 0.231 |
| Necromancer | Bone Wand | 9 · 0.4 | seeking bolts | Skull Staff 17.8 · 0.72 | Finger Wand 5.45 · 0.22 |
| | Soul Scythe | 17 · 0.56 | kills raise +12% more often | Death Scythe 33.7 · 1.008 | Soul Sickle 10.3 · 0.308 |
| | Plague Staff | 6 · 0.6 | cloud r44, 10 dps, 2.6 s | Plague Totem 11.9 · 1.08 | Plague Rod 3.63 · 0.33 |

Base hero HP: Knight 135 · Ranger 117 · Pyromancer 106 · Shade 116 · Cleric 121 · Necromancer 91 (armor and Class Power: §5).

## 2. Elements and statuses

Seven statuses: Burn, Chill (Freeze included), Charge, Venom, Radiance, Doom (element paths) and Bleed (General, physical). Elements: `fire`, `ice`, `lightning`, `poison`, `holy`, `shadow`. General and physical hits ignore affinity.

**Affinity** `elemAff(el)`: stratum `biome.weak === el` → ×1.5, `biome.resist === el` → ×0.5, else ×1. It applies to that element's damage and status build-up. Each element is weak in exactly one stratum and resisted in exactly one.

| Stratum | Weak | Resist |
|---|---|---|
| I Ossuary | holy | shadow |
| II Glowmire | shadow | holy |
| III Rimefrost | fire | ice |
| IV Cinderforge | ice | fire |
| V Drowned Sanctum | lightning | poison |
| VI Starless Abyss | poison | lightning |

**Infusion**: a path gate sets an infusion stat (`fireInfuse`, `iceInfuse`, `lightningInfuse`, `poisonInfuse`, `holyInfuse`, `shadowInfuse`). Every direct hero hit (weapon, skills, dash riders, evolution strikes; minions at half strength) applies each owned infusion from the hit's damage **before** its affinity: amount = unit × rate × (1 + `statusPow`), where the unit is the damage (Burn, Charge, Radiance, Doom) or the share of the foe's HP before the stratum lever (Chill ×340, Venom ×300). Each adder applies its own affinity once. Class skill parts add rates (`infAdd`) without a gate; relics add to the infusion stat. Status ticks, Smites, Tolls, discharges and explosions flagged `noProc` never infuse.

### Burn (fire)
- `burnPool += amount × aff`. Every 0.5 s the pool pays `max(1, pool × 0.2)` (never more than the pool) as Fire damage × (1 + `burnMul`), credited to the Burn owner; it never crits. Conflagration (keystone) checks after every addition.

### Chill and Freeze (ice)
- `chill += amount × (1 + chillMul) × aff × (boss 0.35 | elite 0.7 | 1)`. Chill holds 1.5 s after the last gain, then drops 25/s.
- While chilled: move speed × `1 − min(0.45, chill/180)`; wind-ups × `1 + chill/220`; foe damage × `1 − chillWeaken`.
- At chill ≥ `100 × (1 + 0.5 × freezeRes)`: frozen for `1.6 × (1 + freezeDur)` s (elites ×0.75; bosses 0.6 s), chill → 0, `freezeRes += 1` (decays 1 per 6 s). Frozen: no movement, AI or attacks; +25% damage taken.

### Charge and Discharge (lightning)
- `charge += amount × aff`. Every 1.0 s per foe (0.5 s with Tempest Arms) a charged foe discharges: `charge × (1 + shockMul)` hits it and arcs to up to `3 + arcs` nearest other foes within `140 × (1 + arcRange)`, each taking 60% (`ARC_MUL`). Arcs add no charge (duos excepted).

### Venom (poison)
- A gauge 0–100: `venom += amount × (1 + venomBuild) × aff × (boss 0.35 | elite 0.7 | 1)`. It holds 3 s (+`venomHold`) after the last gain, then falls 8/s. An envenomed foe takes up to `+25%` (+`corrode` at full Venom) from the hero who built it, half of that from allies. At 100 the foe is **Corroded**: its guard is gone.
- Moved Venom (Spore Burst, Pandemic, spreads) skips the build bonus and affinity.

### Radiance and Smite (holy)
- `rad += amount × aff`, never decays. At `SMITE_AT × the foe's real HP` (trash 12%, elite 6%, boss 2%) the owner **Smites**: Holy damage equal to the stored Radiance × (1 + `smiteMul`, + `smiteBig` on elites and bosses). Each hero within 160 of the smitten foe gains a shield of `smiteShield` (1% base, ×2 from elites and bosses, at most 3%) of max HP, once per 3 s per hero, up to `holyCap` (6% base) — Holy shields pass the all-sources window only.

### Doom, Reap and Toll (shadow)
- `doom += amount × (1 + doomMul) × aff × (elite or boss: 0.7 + doomTough)`. A non-boss foe whose HP (plus ward) falls to its Doom is **Reaped** and dies to the Doom owner. A boss is never Reaped: each time its Doom reaches 5% of its max HP it **Tolls**, taking that Doom as damage and resetting it. Reaps and Tolls feed Death Knell and Death's Edge.

### Bleed (General)
- A crit by a hero with `bleed` (or any hit with `bleedAll`) adds `hit × rate × (1 + statusPow)` to the pool. Drains like Burn (20% per 0.5 s), × (1 + `bleedMul`). Physical, no affinity.

### Ailments and spreads
- A foe's **ailments** (0–9, read as at most 4): one each for a Burn, Bleed or Charge pool worth 1% of its HP; Chill ≥ 25 or Frozen; Venom above 25; Radiance a quarter of the way to a Smite; Doom worth 2% of its HP; Dazed (stunned or blinded); Sealed. The host sends the count. Brand, Open Veins, Contagion and Gangrene read it.
- A **spread** moves pools: a recipient takes at most 25% of its own HP per pool (`SPREAD_CAP`), Frozen is never copied, each foe receives at most once per chain.
- **Chain queue**: payoffs of duos and keystones (Smite, Reap, Toll, discharge, freeze, a death) open a chain id; the payoffs they spawn queue behind it 0.08 s per hop, each foe pays at most once per chain id, and a trigger hero runs at most 6 entries per tick.

## 3. Paths

Seven paths: six element paths and General. A hero follows at most **2 element paths** (`MAX_ELEMENTS`) or takes the **Generalist** gate and follows General alone. `affinity(path)` = sum of ranks of the hero's boons in that path (open boons count toward none; General counts only for a Generalist).

- Gate: opens the path and sets its infusion. Keystone (`key`): offered at affinity ≥ 5 (General: 6). Evolution (`evo`): its card is prepended to every offer at affinity ≥ 10 (General: 12) with the path's keystone owned and no evolution yet. Duo: both element paths at affinity ≥ 4 put their duo on every offer until it is taken.
- An element path holds 12 to 14 ranks before its evolution (Fire, Poison, Holy 12; Ice 13; Lightning, Shadow 14; General 15). Rarity: `c` common, `r` rare, `e` epic (keystones), `l` legendary (evolutions), `d` duo.
- **Class element**: Pyromancer = fire, Cleric = holy, Necromancer = shadow. Their class-skill parts deal that element without a gate; their own gate is on their start offer. Knight, Ranger and Shade have no class element (their element route is Bleed).
- **Generalist** (start offer of Knight, Ranger and Shade only): +15% damage, +5% crit chance, crits Bleed for 30% of the hit, open boons rank 1 higher; the hero never sees element boons (relics are element-free and reach every hero). Keen Eye and Brutality are open at rank 1 to element heroes.
- The sheet and offers colour each path: Fire `#ff7a2a`, Ice `#7fe3ff`, Lightning `#ffe66b`, Poison `#9be33c`, Holy `#fff0c2`, Shadow `#a070ff`, General `#d9dfe8`.

### Fire — icon `flame`
| id | name | rar | max | effect (per rank) |
|---|---|---|---|---|
| kindle | Kindle (gate) | r | 1 | Hits add 35% of their damage as Burn. |
| fuel | Fuel the Fire | c | 2 | +8% more Burn from hits. |
| stoke | Stoke the Flames | r | 3 | Burn deals +25%. |
| searing | Searing | c | 2 | +12% damage to burning foes. |
| wildfire | Wildfire | r | 2 | A burning foe that dies sets foes within 80 alight for 15% of its base HP. |
| cindertrail | Cinder Trail | r | 1 | The dash leaves burning ground for 2.2 s: 6 + 60% P per second. |
| conflag | Conflagration (key) | e | 1 | A foe whose Burn exceeds 30% of its current base HP combusts: the whole pool hits it and 60% (`SPLASH_MUL`) hits foes within 70. |
| evo_fire | Cinder Arms | l | 1 | Melee swings also launch a piercing flame crescent (60%); shots explode (50%, r40); exploding weapons blast 30% wider and leave burning ground (0.4 × weapon damage per second, 2 s). Burn +25%. |

### Ice — icon `snow`
| id | name | rar | max | effect (per rank) |
|---|---|---|---|---|
| frostbite | Frostbite (gate) | r | 1 | Hits chill (`iceInfuse` 1: the hit's share of the foe's HP × 340); full chill freezes. |
| deepcold | Deep Cold | r | 3 | +35% chill build-up. |
| shatter | Shatter | r | 2 | Hitting a frozen foe ends the freeze for +80% damage; half of it bursts to foes within 60 (infused). |
| brittle | Brittle Cold | c | 2 | +10% damage to chilled or frozen foes. |
| coldsnap | Cold Snap | r | 1 | Dashing releases a frost ring (r80) for 50% P that chills. |
| permafrost | Permafrost | c | 2 | Freeze lasts 30% longer; chilled foes deal 10% less. |
| frostheart | Frozen Heart | r | 1 | When hit, freezes foes within 120 (8 s cooldown; was an element relic). |
| abszero | Absolute Zero (key) | e | 1 | Freezing a foe releases a frost nova adding 60 chill to foes within 100. |
| evo_ice | Glacial Arms | l | 1 | Every 3rd attack fires 5 piercing ice shards in a fan (50% each, infused). Chill +25%. |

### Lightning — icon `bolt`
| id | name | rar | max | effect (per rank) |
|---|---|---|---|---|
| staticcharge | Static Charge (gate) | r | 1 | Hits charge foes with 25% of their damage. |
| conductor | Conductor | r | 2 | +1 arc target, +30% arc range. |
| highvoltage | High Voltage | r | 3 | Discharges deal +20%. |
| shortcircuit | Short Circuit | r | 2 | A charged foe that dies discharges at once at +25%. |
| thunderstep | Thunderstep | r | 1 | Foes you dash through take 100% P (charges them). |
| overload | Overload | c | 2 | Discharges stun non-boss foes 0.25 s (elites half), at most once per second per foe. |
| stormcall | Storm Call | r | 1 | Critical hits charge foes with 60% of their damage (was an element relic). |
| thundergauntlet | Thunder Gauntlet | r | 1 | Every 6th attack calls lightning on its target (220% of weapon damage, r40, no crit; was an element relic). |
| thunderhead | Thunderhead (key) | e | 1 | Each discharge has a 25% chance to drop a thunderbolt: 200% P, r60; one hero drops at most one per 0.6 s. |
| evo_lightning | Tempest Arms | l | 1 | Every 4th attack calls lightning on the foe nearest the point 80 ahead of your aim, within 220 (150% weapon damage, r50). Foes discharge every 0.5 s. |

### Poison — icon `drop`
| id | name | rar | max | effect (per rank) |
|---|---|---|---|---|
| envenom | Envenom (gate) | r | 1 | Hits build Venom (`poisonInfuse` 1: the hit's share of the foe's HP × 300). |
| potency | Potent Toxin | c | 2 | +30% Venom build-up; Venom holds 1 s longer. |
| caustic | Caustic | r | 3 | +6% Venom bonus at full Venom. |
| fester | Fester | c | 2 | +10% damage to envenomed foes. |
| sporeburst | Spore Burst | r | 2 | An envenomed foe that dies gives foes within 80 35% of its Venom. |
| noxiousstep | Noxious Step | r | 1 | Foes you dash through take 80% P and gain Venom from that hit at +200%. |
| pandemic | Pandemic (key) | e | 1 | Every second each Corroded foe gives 30% of its Venom to the 2 nearest foes within 90 that hold less. |
| evo_poison | Venomous Arms | l | 1 | Every 3rd attack bursts acid where it lands (melee: swing tip; projectiles: the first shot, on hit or at range end): r50, 60% weapon damage as Poison, +200% Venom. Venom bonus +10%. |

### Holy — icon `sun`
| id | name | rar | max | effect (per rank) |
|---|---|---|---|---|
| consecrate | Consecrate (gate) | r | 1 | Hits store 30% of their damage as Radiance. |
| fervor | Fervor | c | 2 | +8% more Radiance from hits. |
| zealotry | Zealotry | r | 3 | Smites deal +25%. |
| sanctity | Sanctity | r | 2 | Smites shield 0.25% more; the Holy shield holds up to 3% more. |
| beacon | Beacon | r | 2 | Smites also strike foes within 70 for 30% of their damage. |
| dawnstride | Dawn Stride | r | 1 | Foes you dash through take 80% P and are blinded 1 s (elites 0.5 s, never bosses; once per 4 s per foe). |
| radiantaegis | Radiant Aegis (key) | e | 1 | While shielded your hits store twice the Radiance; damage your shield absorbs strikes the attacker for 200% as Holy. |
| evo_holy | Hallowed Arms | l | 1 | Every 3rd attack releases a lance of light along your aim (melee 150 long, projectiles 260, 20 wide): 80% weapon damage as Holy to every foe on it. Smites shield 0.25% more. |

### Shadow — icon `mask`
| id | name | rar | max | effect (per rank) |
|---|---|---|---|---|
| doommark | Mark of Doom (gate) | r | 1 | Hits mark 30% of their damage as Doom. |
| malignance | Malignance | c | 2 | +8% more Doom from hits. |
| malice | Malice | c | 2 | +10% damage to foes carrying Doom. |
| inevitable | Inevitable | r | 2 | Elites and bosses take 15% more of your Doom (full at rank 2). |
| deathknell | Death Knell | r | 2 | Each Reap or Toll grants +4% damage for 6 s, stacking up to 5 times per rank. |
| deathsedge | Death's Edge | r | 1 | Each Reap or Toll readies 1 guaranteed crit (up to 3 stored; scaled by the weapon fork). |
| souljar | Soul Jar | c | 2 | Your hits mark 20% more Doom (`doomMul`; was an element relic). |
| umbralstep | Umbral Step | r | 1 | Foes you dash through take 80% P and gain Doom from that hit at +60%. |
| reaper | Reaper (key) | e | 1 | A Reaped foe implodes: 20% of its max HP (elites 10%) as Shadow damage to foes within 80. |
| evo_shadow | Umbral Arms | l | 1 | A shadow twin repeats every attack 0.15 s later at 40%; twin hits mark double Doom. |

### General — icon `sword`
| id | name | rar | max | effect (per rank) |
|---|---|---|---|---|
| generalist | Generalist (gate) | r | 1 | Forsake the elements: +15% damage, +5% crit chance, crits Bleed for 30% of the hit; open boons rank 1 higher. |
| keen | Keen Eye (open rank 1) | c | 2 | +5% crit chance. |
| brutal | Brutality (open rank 1) | r | 3 | +25% crit damage. |
| lacerate | Lacerate | r | 2 | +12% damage to bleeding foes. |
| execute | Executioner | r | 2 | +25% damage to foes below 30% HP. |
| deepcuts | Deep Cuts | r | 2 | Bleed deals +30%. |
| opportunist | Opportunist | r | 1 | +25% damage to stunned, frozen or blinded foes. Offered only to a hero that can stun, freeze or blind (§4). |
| sunder | Sunder | r | 1 | Each crit adds Sunder stacks to the foe (`(dmg / foeHp) × 60`, at most 2 per crit, max 10): +4% damage from you per stack. |
| masterstroke | Masterstroke (key) | e | 1 | Every 4th attack is a guaranteed crit at +30% that Bleeds for at least 50% of the hit. |
| evo_general | Masterwork Arms | l | 1 | Crits release a spectral strike (repeat swing or spectral shot) at 60%. +10% crit chance. |

### Evolutions

One per run. The weapon is renamed with the prefix before its (fork) name: Cinder (fire), Glacial (ice), Tempest (lightning), Venomous (poison), Hallowed (holy), Umbral (shadow), Masterwork (general). Strikes count as hero hits (they infuse) and never trigger further evolution extras.

### Duo boons (rar `d`, max 1, need both element gates; 15)
| id | paths | effect |
|---|---|---|
| thermalshock Thermal Shock | fire+ice | Burning foes build chill 25% faster. Freezing a burning foe detonates its Burn: the pool × 2 hits it, 60% of that bursts to foes within 70 and chills them. |
| plasma Plasma | fire+lightning | Discharges add Burn equal to 40% of their damage; a burning foe arcs to 1 more foe. |
| firedamp Firedamp | fire+poison | A foe that dies burning and envenomed explodes: 20% of its max HP (elites 10%) as Fire to foes within 80, who catch Burn (50% of the blast) and Venom. |
| sunfire Sunfire | fire+holy | Smites set the foe and foes within 60 alight for 60% of the Smite. |
| blackflame Black Flame | fire+shadow | Burn still to come counts toward Doom; a Reaped burning foe hands its Burn to the nearest foe within 90. |
| superconductor Superconductor | ice+lightning | Discharges chill what they hit; a frozen foe's discharge deals +50% and arcs to 2 more foes at full strength. |
| cryotoxin Cryotoxin | ice+poison | Envenomed foes build chill 25% faster; a frozen foe's Venom bonus doubles. |
| hoarlight Hoarlight | ice+holy | Smites chill the foe and foes within 70 by the Smite's damage; Smites on frozen foes deal double. |
| blackice Black Ice | ice+shadow | Frozen foes are Reaped at twice their Doom; a Reaped frozen foe shatters for 20% of its max HP (elites 10%) as Ice within 70. |
| galvanic Galvanic Venom | lightning+poison | Discharges build Venom in what they hit; a Corroded foe arcs to 1 more foe. |
| wrathofheaven Wrath of Heaven | lightning+holy | Every Smite calls a thunderbolt: 60% of the Smite as Lightning within 70; the smitten foe is charged with 30% of the Smite. Discharges store 30% of their damage as Radiance in the discharging foe. |
| blacklightning Black Lightning | lightning+shadow | Discharges mark 50% of their damage as Doom. |
| purge Purge | poison+holy | A Smite on a Corroded foe deals +50% and shields twice as much. |
| necrosis Necrosis | poison+shadow | Venom raises the Reap line by up to 10% of the foe's HP; Corroded bosses take Tolls 25% harder. |
| twilight Twilight | holy+shadow | Smites mark their damage as Doom. Each Reap forces a Smite on the nearest foe within 120 (Radiance × 1.5, at least half a Smite). |

### Open boons (every hero, no path, low caps)
vigor (c,3: +15 max HP, heal 15) · plating (c,2: +5 armor) · fleet (c,2: +7% move) · focus (c,3: skills −10% cooldown) · lightstep (c,2: dash −20% cooldown) · magnet (c,2: +40% pickup, +10% xp) · edge (c,2: +10% damage) · quick (c,2: +10% attack speed) · bounty (c,2: +25% gold) · stalwart (c,2: +6% max HP) · mending (c,2: +15% healing received) · forager (c,2: hearts drop 10% more often and heal 3% more) · wide (r,2: +15% area) · evade (r,2: +6% dodge) · thorns (r,2: attackers take 10, +4 armor) · pierce (r,2, ranged: +1 pierce) · split (r,2, ranged: +1 projectile, −8% damage) · bladedash (r,1: dash through foes for 120% P) · battleward (r,1: shield 5% max HP when an elite room locks) · echo (e,1: skill 1 holds 2 charges) · laststand (e,1: below 30% HP, 3 s of −60% damage taken, 20 s cooldown) · glass (e,1: +30% damage, −15% max HP) · trance (e,1: a skill grants +30% attack speed 4 s) · overcharge (e,1: skills release a shockwave, 10 + 150% P, r85).

### Ascended boons (rar `a`, max 1, no path; `src/data/ascended.js`)

The upgrade of a maxed open or General boon, id `asc_<base>`, colour `#ff5fd2`. It counts toward no affinity and carries the base's weapon-kind need. Eligible when the stratum is IV or deeper (`ED.ASC_STRATUM`), the base boon is owned at its max rank for this hero (`ED.maxRank`: a Generalist needs open boons one rank higher), the card is not owned and fewer than 2 (`ED.ASC_PER_STRATUM`) Ascended cards were taken this stratum. Offer rules: §4.

Stat rule: `x` multiplies the stat block after every additive source (`s[key] *= 1 + x`); `mods` add like a boon's. `dmg`, `atk`, `spd` and `hpMul` are totals around 1, so the factor is on the total; `crit`, `critDmg`, `area`, `armor`, `pierce`, `lacerate`, `execute` and `bleedMul` are sums, so it is on the bonus you hold. Several factors on one key multiply. The sheet lists a factor as `×1.15` after the additive rows of its stat. Known gap: §1 step 1 (hit-time damage rows).

| base (max rank) | id | name | effect |
|---|---|---|---|
| edge (2) | asc_edge | Honed Edge | ×1.15 damage |
| quick (2) | asc_quick | Blur | ×1.15 attack speed |
| split (2, ranged) | asc_split | Arrow Storm | +1 projectile, ×1.1 damage |
| pierce (2, ranged) | asc_pierce | Impaler | +2 pierce, ×1.1 damage |
| keen (open rank 1) | asc_keen | Hawk Eye | ×1.3 crit chance |
| brutal (open rank 1) | asc_brutal | Savage | ×1.5 crit damage bonus |
| wide (2) | asc_wide | Vast | ×1.5 area |
| vigor (3) | asc_vigor | Titan | ×1.12 max health |
| plating (2) | asc_plating | Bastion | ×1.5 armor |
| lacerate (2, Generalist) | asc_lacerate | Hemorrhage | ×2 damage to bleeding foes |
| execute (2, Generalist) | asc_execute | Headsman | ×2 damage to foes below 30% HP |
| deepcuts (2, Generalist) | asc_deepcuts | Bloodletting | ×1.5 Bleed damage |

## 4. Offers

- A hero holds a queue `p.offers` of offer specs; `p.picks === p.offers.length`. Offers open only when the room is safe. API: `W.grantOffer(p, spec)`.
- Spec `src`: `start` · `level` · `room` · `class` · `forge` · `epic`.
- Cards: 3 (+1 with Crown of Choice); `epic` 4 (+1). An evolution card and a duo are prepended to `level`, `room` and `epic` offers and take no slot.
- **Ascended pin** (`level`, `room`, `epic` only; never `start`, `class` or `forge`): when any Ascended card is eligible (§3), one of them (uniform) is slot 1 of the drawn cards, behind the prepended evolution and duo cards; the draw fills the other n − 1 slots. `p.ascN` counts the Ascended picks of the stratum (reset when a stratum starts).
- **start** (once, at run start; the Head Start upgrade adds `level` offers): 4 cards. Pyromancer, Cleric, Necromancer: their class gate plus 3 random other element gates. Knight, Ranger, Shade: 3 random element gates plus the Generalist gate (last).
- **level**: every even level (2, 4, 6, …). Pool: open boons, non-gate boons of the hero's own paths (a Generalist: gated General boons), element gates while a slot is free (and no Generalist gate), keystones at affinity ≥ 5 (General 6). Weight = rarity weight (`c` 60, `r` 30 + 2.5s + 60·luck, `e` 10 + 2s + 40·luck, other 10) × (own path 2.5) × (gate 0.8); at most one gate per offer. Weapon-kind boons (`pierce`, `split`) need a projectile weapon. **Hygiene**: Opportunist needs a hero that can stun, freeze or blind a foe (`W.canDaze`: a Heavy fork, Knight, Shade, an owned `iceInfuse`, `frozenHeart`, `arcStun`, `dashBlind`, `waveStun`, `sanctStun`, `cStun`, `chargeStun`, `orbitStun`, `knightStun`, `cometStun` or `parry`, or a stun or blind skill part whose stat is set: Skyfall, Verdict, Afterimage); from stratum IV the utility commons bounty, magnet, forager, fleet and mending weigh ×0.25.
- **room** (reward `boon`): card 1 = one unowned element gate while a slot is free, weighted by coverage (weak this or next stratum ×2, weak where an owned gate is resisted ×2, resisted next stratum ×0.5, class element ×2); the rest from the hero's own paths, then open boons at rarity ≥ r. A Generalist draws the level pool.
- **epic**: level pool, rarity ≥ r, 4 cards, keystones ×2. Sources: elite-room reward (25%), boss of stratum III and V, shop (odd strata), altar.
- **forge**: up to 3 owned boons below max (no evolutions, never route or fork cards: fork ranks come from bosses, §5); picking ranks one up. None → level offer. Sources: normal-room reward (8%), rest-site anvil (odd strata), shop (even strata).
- **class**: the route system (§5): team level 3 (route, `ctier` 1) and boss I (fork, `ctier` 2). Fixed cards, no draw padding, no prepends. A class spec of a hero that already holds a fork becomes a level offer. Fork ranks 2 and 3 are not offers (§5).
- Offer message to client: `{t:'offer', boons, rerolls, picks, src, path, forge, ctier, route}`. Rerolls (Q on keyboard, Y on a pad; from Insight and mastery 8) work on every offer except forge, route and fork picks. In a party a pick untouched for 45 s is taken for the hero: the first non-evolution card (so never the Generalist gate), a random card for a route or fork pick.
- **Pacing targets**: see §10.

## 5. Heroes, skills and class routes

Class Power **P** (table below) scales every skill and proc. Per-attack extras scale from the equipped (forked) weapon's damage; per-cast attack modifiers (Ambush, crit-stack grants) are fork-neutral. Skill damage = (base + k × P) × (1 + slot damage) before the hero multiplier, crit and affinity.

| Hero | HP | Armor | Power P | Speed | Crit | Unlock |
|---|---|---|---|---|---|---|
| Knight | 135 | 8 | 18 | 116 | 5% | start |
| Ranger | 117 | 5 | 12 | 128 | 10% | start |
| Pyromancer (fire) | 106 | 4 | 17 | 120 | 5% | start |
| Shade | 116 | 5 | 13 | 138 | 12% | defeat the Bone Warden |
| Cleric (holy) | 121 | 7 | 17 | 114 | 5% | complete 4 descents |
| Necromancer (shadow) | 91 | 2 | 9 | 120 | 5% | defeat the Sporemother |

### Skills (skill 1 = slot 0, skill 2 = slot 1)

| Hero | Skill | cd | Aim | Effect |
|---|---|---|---|---|
| Knight | **Shield Charge** | 6 | move 60–150 px toward the cursor | Run at 600 px/s, untouchable. Every foe passed takes 20 + 1.6P, stun 1.0 s, knock 260; ×1.4 on foes your shield stunned (Crush). |
| Knight | **Shield Throw** | 9 | direction; the cursor's distance (120–280 px) sets the flight | The shield strikes up to 4 foes (ricochet reach 180): 20 + 1.3P each, stun 0.9 s; bosses ×1.5 and never stunned. It returns (10 + 0.65P to foes it passes) and is caught: shield 0.5% max HP per foe struck, at most 2%, once per 6 s. In flight it swats enemy shots. |
| Ranger | **Volley** | 5 | direction | 7 piercing arrows (fan 1.2 rad, pierce 1), 4 + 1.2P each. |
| Ranger | **Rain of Arrows** | 10 | ground, ≤ 260 | After 0.35 s, every 0.25 s for 2 s all foes within r80 take 4 + 0.45P. |
| Pyromancer | **Flame Nova** | 7 | self | Blast r105: 22 + 2.5P, knock 200, Fire; every foe struck gains a Burn add of 12 + 2.4P. |
| Pyromancer | **Meteor** | 12 | ground, ≤ 300 | 0.9 s telegraph, impact r95: 30 + 3.5P, knock 220, Fire, adds Burn = 50% of the impact; crater r60 for 3 s: 8 + 0.8P per second. |
| Shade | **Shadowstep** | 4.5 | move 40–140 px toward the cursor | Blink; every foe on the path takes a guaranteed crit of 12 + 2.2P; the next 3 attacks crit. |
| Shade | **Vanish** | 11 | self | Smoke r75 for 3 s (foes inside slowed 40%, blinded up to 2 s each, elites half, never bosses). Unseen for 2.5 s: foes lose you and attack the spot they last saw you. The next attack is an **Ambush**: guaranteed crit for 2.5 × the unforked weapon's damage. Attacking ends stealth. |
| Cleric | **Sanctuary** | 11 | ground, ≤ 200 | Heals you and allies within 180 for 7% max HP. Holy ground r100 for 3.5 s: foes take 10 + 1.2P per second (stores Radiance from a quarter of each tick); allies inside take 15% less damage. |
| Cleric | **Judgment** | 9 | direction | A hammer flies out and returns, piercing; each leg hits a foe once for 18 + 1.4P (it takes the Judged +20% itself) and Judges it for 4 s (+20% damage taken). A foe that dies while the hammer's own Judged window runs shields heroes within 160 for 3% max HP, once per cast (class window). |
| Necromancer | **Raise Legion** | 12 | ground, ≤ 160, standable | 3 minions for 12 s (max 3 minions); each strikes every 0.7 s for 6 + 0.6P. Any non-boss foe you are credited with (weapon, skills, Reaps, status damage, minions) may rise for 10 s (12%, +weapon raise). |
| Necromancer | **Bone Harvest** | 10 | self | Each minion bursts (r60, 24 + 1.8P, Shadow) and heals you 3% max HP (at most 6%); then 1 new minion rises (2 when you had none). |

- Class-element parts (Fire, Holy, Shadow) take half affinity; Bleed-route heroes have none. Minion damage × 0.85 (`COMP_MUL`); minions infuse at 50%.
- Skill cooldown reduction applies to both slots and counts fully up to 0.4, half above it, at most 0.65 (`Stats.cdrEff`); route cooldown cuts (`s1Cdr`, `s2Cdr`, at most 0.4 each) multiply after. Cooldowns are client-authoritative; refunds reach the client as `refund` messages.
- Uptime caps: Brace starts at most every 4 s; Sanctuary lasts at most 0.6 × its effective cooldown; Vanish's smoke blinds a foe at most 0.5 × its cooldown.

### Controls and aim

- Defaults (every action has two rebindable slots, keyboard codes or mouse buttons, saved in settings): move WASD / arrows; attack left mouse / J (also interacts); skill 1 Q / right mouse (rerolls boon cards while they are open); skill 2 E; dash Space; lantern flare F; map and sheet Tab; pause Esc. Hotkeys use `e.code`. Prompts and signs show the live binding (`{action}` tokens).
- **Gamepad** (fixed layout): left stick moves, right stick aims, X or RT attacks, B or RB skill 1, Y or LT skill 2, A or LB dashes, L3 flare, Back opens the sheet, Start pauses. In menus and the sheet LB/RB switch tabs, B goes back, Y rerolls an offer (cycles heroes in the sheet).
- **Aim is manual.** There is no auto-aim and no aim assist. The aim origin is the projectile spawn point (hero x, y − 4). Attacks and `dir` skills fly toward the cursor; `ground` skills (Rain, Meteor, Sanctuary, Raise Legion) land on the cursor, clamped to range and cut at the first wall (chasms do not stop them; Raise Legion lands on a standable spot); `move` skills (Charge, Shadowstep) travel toward it; `self` skills ignore it. The last angle is kept when the cursor is within 12 px of the origin or outside the window; before the first pointer event the aim follows the walking direction. On a pad the right stick aims (held 0.35 s after release), else the left stick, else the last angle; ground skills reach `range × clamp((push − 0.45) / 0.5, 0.3, 1)` of the right stick's push.

### Heavy and Swift (attack forks)

A fork replaces the weapon with a derived version (`ED.forkWeapon`, pure), so a re-tune of the base weapon carries over. Nominal damage per second is 1.1 × the base.

| | Attack time | Damage per hit | Other |
|---|---|---|---|
| Heavy | ×1.8 (never over 1.3 s) | × 1.1 × the time factor (nominal ×1.98) | Melee reach ×1.1, arc ×1.1, knockback ×1.3; shots r ×1.2, speed ×0.9, life ×1.1, knockback ×2; blasts ×1.15. Hits Stagger. |
| Swift | ×0.55 (never under the floor) | × 1.1 × the time factor (nominal ×0.605) | Knockback ×0.5; shots speed ×1.2, life ×0.85, spread ×0.85. Flow: +15% move speed for 0.5 s after each attack. |

Crit-stack grants (Shadowstep, Riposte, Death's Edge) are multiplied by `critK = base interval / fork interval`.

### Route system

- Each hero has four routes: **Attack**, **Skill 1**, **Skill 2** and **Element** (the status route: Bleed for Knight, Ranger and Shade; Fire, Holy, Shadow for the others). A route is a tier-1 card with two tier-2 forks: 12 cards per class, 72 in all (`src/data/classboons.js`).
- **Moments** (every hero, every party member): team level 3 → pick 1 of the 4 route cards; boss of stratum I → pick 1 of the route's 2 forks (rank 1); boss of stratum II → the fork gains rank 2 (a new behaviour: the card's `r2` numbers and `rider2`); boss of stratum IV → rank 3 (a transform: `r3` numbers, the named rider and the `form` name). Ranks 2 and 3 are granted by `W.grantForkRank` with no pick, to every hero including downed and dead ones, and announced with a reveal (message `forkRank {id, rank}` to the hero, event `forkRank` to everyone); the other boss rewards are unchanged. A hero without a fork when a rank falls due banks it (`p.forkDue`) and gets the banked ranks when the fork card is picked. The forge never ranks route or fork cards. A downed hero receives the route and fork picks when back up.
- Route and fork cards never count toward path affinity and appear only in class offers. Card totals: `mods + up × (rank − 1) + r3` (rank 3). Slot damage (`s1Dmg`, `s2Dmg`) compounds card by card. Co-op cards help allies. Card text on the offer and the sheet is the exact source of every number below.
- Fork tags: Attack forks **Heavy** / **Swift**; skill forks **Burst** (damage) / **Guard** (shields, damage reduction, stuns, slows, blinds, shot swats); element forks **Focus** (single target, bosses) / **Spread** (packs).

| Hero | Route | Route card | Fork A | Fork B |
|---|---|---|---|---|
| Knight | Attack | **Oath of Steel**: every 3rd swing is a Cleave: +60%, +40% reach and arc, ×2 knockback | **Oathbreaker** (Heavy): Cleaves crack the ground (shock r72, 50% of the weapon, stun 0.3 s). Rank 2 Follow-Through: the swing after a Charge Cleaves. Rank 3 **Earthsplitter**: each Cleave also splits a fissure 180 forward that erupts after 0.25 s and strikes every foe on it once for 80% of the weapon, stun 0.3 s (repeating) | **Sworn Blade** (Swift): Cleave +30%, Parry. Rank 2 Riposte: a Parry readies 2 crits. Rank 3 **Thousand Edges**: every Cleave launches a piercing blade wave (180 long, 24 wide, a hero shot) at 80% of the weapon; a Parry fans 3 waves 0.35 rad apart |
| | Skill 1 | **Vanguard**: Charge cooldown −30%, +25% damage; Brace 1.5 s after a Charge: −25% damage taken | **Juggernaut** (Burst): +90 px range, +10%, shockwave r90 at 40%. Rider Shield Bash: a free Shield Throw at 60% | **Rallying Charge** (Guard, co-op): shield 2% max HP to you and allies within 100, stun +0.5 s, Charge +10%, Brace 10 points stronger (−35%, cap −40%). Rider Hold the Line: allies braced with you |
| | Skill 2 | **Shieldmaster**: Throw +2 ricochets, +20%, cooldown −16.7% | **Shield Storm** (Burst): two shields in a V at 70% each. Rider Gathering Force +15% per ricochet | **Shield Orbit** (Guard): the caught shield orbits 3.5 s, strikes at 15%, stuns 0.3 s (repeating) and destroys shots. Rider Return to Sender |
| | Element | **Oath of Ruin**: all hits Bleed for 16%, statuses +15% | **Brand of Ruin** (Focus, co-op): +6% per ailment (≤ 4) from every hero. Rank 2 Ruin Seal: Charge and Throw strikes seal foes 4 s (one more ailment, bosses too). Rank 3 **Doombrand**: Brand +6% more per ailment (14% in all) and counts ≤ 6; a foe holding ≥ 4 ailments (any hero's) is Marked 4 s, +20% damage from every hero (Hunter's Mark at rank 3; the strongest Mark on a foe applies) | **Ruinous Blows** (Spread): Charge and Throw +15% (+70% at rank 2, +110% at rank 3), statuses ×2, 25% of statuses carry on a ricochet. Rank 2 Ruin Spreads: a foe killed by a shield strike hands 50% of its statuses to the 2 nearest within 80. Rank 3 **Cataclysm**: a Charge or Throw strike on a foe with ≥ 3 ailments pays its Bleed pool out at once at ×2 and bursts 80% of the amount paid to foes within 80 as new Bleed (≤ 25% of their health; once per second per foe) |
| Ranger | Attack | **Deadeye**: +0% at 80 px rising to +40% at 260 | **Ballista** (Heavy): shots ×1.28 faster, +2 pierce, +15% per foe passed, +10% damage. Rider Splitting Bolt | **Quickdraw** (Swift): +10% weapon, slows 15% (not bosses). Rider Flurry: every 5th shot fires 2 extra arrows, each at 25% of a shot |
| | Skill 1 | **Fletcher**: Volley +3 arrows, cooldown −20% | **Hunter's Mark** (Burst, co-op): marks hit foes 4 s, +12% damage from everyone. Rider Relentless Hunt | **Scattershot** (Guard): +40% within 110, ×3 knockback, every arrow slows 30% for 1.2 s (bosses half as much), hop 70 back in 0.25 s (untouchable). Rider Caltrops |
| | Skill 2 | **Rainmaker**: Rain +30% radius, +1 s, +10% | **Skyfall** (Burst): the whole Rain lands at once after 0.5 s over a 30% wider area, stun 0.5 s. Rider Twin Sky | **Hail of Thorns** (Guard, co-op): foes in the Rain slowed 50%, +20% damage. Rider Second Shower |
| | Element | **Trapper's Craft**: all hits Bleed for 10%, statuses +15% | **Infected Wounds** (Focus): Volley and Rain build statuses +50%, Bleed and Burn +20%. Rider Gangrene | **Contagion** (Spread): a foe with ≥ 2 ailments dying passes 50% of its statuses to the 2 nearest within 100. Rider Outbreak |
| Pyromancer | Attack | **Pyroclast**: standing still builds Channel: +10% per 0.3 s up to +50% | **Magma Heart** (Heavy): blasts erupt again 0.4 s later at 30%. Rider Lava Pools | **Ember Rush** (Swift): Channel twice as fast, cap +60%. Rider Overheat |
| | Skill 1 | **Firestorm**: Nova +25% radius, +20%, cooldown −21% | **Twin Nova** (Burst): second eruption 0.6 s later at 40%. Rider Collapse | **Phoenix Mantle** (Guard): ring of fire 3 s; a Nova that hits shields you 3% (once per 10 s). Rider Rebirth Flare |
| | Skill 2 | **Starfall**: Meteor +15%, crater +2 s | **Twin Meteor** (Burst): a second Meteor at 60% on the nearest foe. Rider Meteor Shower | **Comet** (Guard): you ride the Meteor, untouchable 0.35 s, land as the impact +30%. Rider Impact Crater |
| | Element | **Living Flame**: skills +25% Fire; the weapon sets foes alight for 15% of each hit | **White Heat** (Focus): Burn +20%, burning foes take +10% from skills. Rider Flashpoint | **Heat Engine** (Spread): each burning foe a skill hits cuts 0.15 s from the other's cooldown. Rider Chain Reaction |
| Shade | Attack | **Bladedancer**: +8% crit; each crit grants Momentum: +4% damage 2.5 s, 5 stacks | **Culling Blades** (Heavy): hits on foes below 25% HP always crit. Rider Killing Rhythm | **Thousand Cuts** (Swift): Momentum +2 stacks. Rider Whirlwind |
| | Skill 1 | **Ghost Walk**: Shadowstep +20%, cooldown −20%, each foe cut readies +1 crit attack | **Assassinate** (Burst): +30% below half HP, a kill refunds it. Rider Twin Cut | **Afterimage** (Guard): a decoy bursts after 1.2 s (r80, blinds 1 s). Rider Lure |
| | Skill 2 | **Nightfall**: Vanish cooldown −27%, smoke +40% wide, +2 s, +20% damage to foes inside, +30% move speed unseen | **Night's Edge** (Burst): Ambush ×3.75 the weapon; an Ambush refunds Shadowstep, an Ambush kill refunds Vanish. Rider Ambush Sweep | **Veil of Night** (Guard): Vanish shields 3% (once per 12 s), longer blind and stealth, Ambush ×3 the weapon. Rider Shroud |
| | Element | **Cruel Arts**: all hits Bleed for 10%, statuses +15% | **Open Veins** (Focus, co-op): crits +15% per ailment (≤ 4). Rider Exsanguinate | **Rupture** (Spread): Shadowstep and Ambush rupture 50% of Bleed and Burn pools at 150%. Rider Bloodbloom |
| Cleric | Attack | **Dawnbringer**: waves every 2nd attack, +30%; the Lantern gains waves | **Sunhammer** (Heavy): waves twice as wide, 60% farther, stun 0.4 s. Rider Solar Flare | **Crusader** (Swift): waves steer toward foes within 25°, +10%. Rider Litany: every 6th attack fans 3 waves |
| | Skill 1 | **Sanctum**: Sanctuary +30% radius, +2 s, +50%, allies take 25% less | **Holy Fury** (Burst): +20%, stun 0.5 s on cast. Rider Hallowed Ground: foes inside Judged | **Aura of Faith** (Guard, co-op): Sanctuary follows you, −10% damage, damage taken inside cut a further 10%. Rider Embolden: allies inside +10% damage |
| | Skill 2 | **Hammer of Judgment**: Judgment +25%, +40% range, Judged +1 s, cooldown −16.7% | **Twin Hammers** (Burst): two hammers at 55%. Rider Second Flight: each flies out once more, that flight at 25% of a hit | **Verdict** (Guard, co-op): Judged foes deal 40% less (bosses half that), a Judged foe dying bursts (r70, stun 0.4 s). Rider Sentence |
| | Element | **Radiant Faith**: skills +25% Holy; the weapon stores Radiance for 12% of each hit | **Guardian Light** (Focus, co-op): Smites on elites and bosses +50%; shielded heroes +8% damage 6 s. Rider Judging Light | **Prism** (Spread): Smites +30%, a beam to the nearest other foe for 50%. Rider Sunburst |
| Necromancer | Attack | **Soul Command**: weapon +20%, Hexes what it hits 3 s; minions rush the Hexed foe and deal +20% to it | **Gravecaller** (Heavy): foes your weapon kills rise as minions. Rider Hex Burst | **Soul Barrage** (Swift): Hexed foes take +10% from you. Rider Quickened Dead |
| | Skill 1 | **Endless Legion**: +1 max minion, Legion raises 1 more, minions +20% | **Bone Spikes** (Burst): minions burst on expiry (r60, marks Doom). Rider Boneyard | **Bone Knights** (Guard): at most 2 minions, ×2 damage, cleave, block shots, strikes stun 0.5 s (repeating, not bosses). Rider Ironbone: last 50% longer |
| | Skill 2 | **Grim Harvest**: Harvest +40%, 20% wider, always raises 2 | **Corpse Explosion** (Burst): detonates up to 4 recent corpses at 70%. Rider Bone Lances | **Bone Armor** (Guard): shield 3% max HP per minion harvested (≤ 5%, once per 12 s). Rider Marrow Field |
| | Element | **Grave Pact**: skills +25% Shadow; minions apply statuses at 75% and mark Doom for 20% | **Abyssal Toll** (Focus): Tolls +40%, empower minions. Rider Abyssal Hunger | **Rise Again** (Spread): every Reaped foe rises as a minion. Rider Risen Tide |

## 6. Floors, rooms and rewards

Per stratum: start, boss, treasure, shop, event shrine, rest site, normal combat `[5,5,6,6,6,6][s−1]`, elite combat `[1,1,1,2,2,2][s−1]` → 12–14 rooms. Grid bounds ±4, tree layout. Boss = farthest dead end, BFS distance ≥ 4. Utility rooms prefer dead ends; elite rooms prefer distance ≥ 3. Floor generation is pure per `(stratum, seed)`.

- Wave budget = `(7 + 2s)` × threat wave × party × `danger = 1 + 0.05 × distance` × dread wave. Pacing (`World.PACE`): the first wave 0.5 s after the lock, spawn telegraph 0.7–0.95 s, the next wave when at most 45% of the current one stands (gap ≥ 0.9 s) or the current one is 6 s old; foes spawn ≥ 100 px from every hero (turrets 130). Elite rooms: same budget, 2 waves + 2 elites guaranteed (3 waves under Pact 10).
- **Rewards** are fixed at generation and shown on doors and the map before entering:
  - normal combat: `boon` 50% · `gold` 19% · `vigor` 13% · `forge` 8% · `oil` 10%. Each kind gets its share of the floor's combat rooms (rounded by a weighted draw on the remainders). A `boon` reward is claimed by each hero as a room offer drawn from that hero's own paths; no room pays a class card.
  - elite: `relic` 75% · `epic` 25%.
- On clear, a `reward` prop appears at the room centre. Per-hero claims: `boon`, `forge`, `epic`, `vigor` (+12 max HP, heal 20%). Party claims (once): `gold` (`round((15 + 8s) × dread bonus × 0.65)`), `oil` (+35 light), `relic` (a relic hoard, one pick per hero).
- **Boss**: 2 hearts, gold and the class offer of strata I, II, IV (§5). Stratum II and IV: a relic hoard (rarity ≥ r). Stratum III and V: an `epic` offer per hero. Stratum VI ends the run.
- **Rest site**: a campfire (heal 35%) and, on odd strata only, an anvil (forge offer); each hero uses one.
- **Shop**: 2 relics (+1 with Merchant's Favor 2), healing draught (40%), lantern oil (+35 light, `45 + 15s` gold) and one build item: an epic boon (75 gold) on odd strata, a forge (`60 + 15s` gold) on even strata. Relic, epic boon and draught prices scale 12% per stratum; every price is −10% per Favor rank, −25% with Merchant's Ledger, ×1.4 under Pact 7, rounded to 5 (minimum 5).
- **Event shrines**: fountain (heals the party 50%, raises the downed), altar (pay 20% max HP for an epic offer), gamble shrine (`35 + 18s` gold for a random relic: 12% epic, 38% rare, 50% common), champion's trial (an elite fight for a rare relic).
- **Relics**: 31, all in the drop pool from the first descent (common 8, rare 12, epic 6, legendary 5). No relic carries an element: the 14 element relics are gone and their unique effects are the path boons Storm Call, Thunder Gauntlet, Frozen Heart and Soul Jar (§3). There is no Codex and no Generalist relic rule. `RELIC_PRICE` c 70 · r 110 · e 160 · l 220. A roll draws at or above the requested rarity from the relics no hero holds (the whole list when every relic is held); weights c 50, r 34 + 3s, e 14 + 3s, l 3 + s. The Reliquary upgrade (§9) starts a descent with a random common (rank 1) or rare-or-better (rank 2) relic.
- XP from level L to L+1: `round(30 + 3(L−1) + 6(L−1)²)`. Even levels grant a `level` offer; level 3 also grants the route card.
- Every gold drop (kills, room clears, chests, rewards, bosses) is scaled by ×0.65 (`World.GOLD_MUL`); shop prices are not scaled.

## 7. Lantern and Dread

- `w.light` ∈ [0, lightMax]; `lightMax = 100 × (1 + 0.06 × Deep Wick rank) × World.LANTERN_MUL[s−1]` (best Deep Wick in party; `LANTERN_MUL` = 1.3 / 1.2 / 1.1 / 1 / 1 / 1, so strata I–III are bright). Refills to max at each stratum.
- **The lantern never drains by itself.** Light is spent only on new rooms and flares, and gained from oil.
- **Room cost**: entering a room not yet visited costs light, paid before its encounter is planned (the tier it leaves you in applies to that room): `World.ROOM_COST` combat 12 · elite 17 · treasure, shop, event, rest 8 (not scaled by Deep Wick or `LANTERN_MUL`). Revisits, the start room and the boss room are free. Light cannot go below 0 (running over means Lightless, never a block). Clients derive the cost from the room type: the number is drawn on each unvisited door preview (red when it drops the tier) and on each unvisited map cell; the room event carries `lc` (cost paid).
- **Oil** (room reward or shop, `World.OIL_LIGHT`) gives +35 light.
- **Boss door**: on first entering the boss room the light left converts into a reward, `World.bossLight(f, s)` with `f = light / lightMax`: every living hero heals `0.5 f` of max HP (healing multipliers apply) and gains a shield of `0.8 f` of max HP (never lowers a bigger one; outside the shield window), the party gets `round(f (10 + 5s))` gold (not scaled by dread or the gold multiplier) and `round(f (2 + s))` embers. Light is not consumed. Emits `{t:'wick', f, heal, shield, gold, embers}`; the door preview and the HUD lantern panel show what is on offer.
- **Dread tier** by `light / lightMax`: ≥ 0.5 Bright (0) · ≥ 0.25 Dim (1) · > 0 Dark (2) · 0 Lightless (3). **Darkness never adds foe HP** (trash stays quick to kill): it adds foe damage, elites, a hunter and lost healing.

| Tier | Foe damage | Elite chance | Healing | Gold & embers from rooms | Reward upgrade chance | Gloom hunts |
|---|---|---|---|---|---|---|
| Bright | ×1 | +0 | ×1 | ×1 | 0 | no |
| Dim | ×1.1 | +0.2 | ×1 | ×1.25 | 0 | no |
| Dark | ×1.6 | +0.4 | ×0.7 | ×1.5 | 0.12 | 8 s after entering a room |
| Lightless | ×2.3 | +0.6 | ×0.5 | ×1.75 | 0.2 | 3 s after entering a room |

- `w.dread` holds the tier's `{hp, dmg, elite, wave: 1, gold, up, gloom, glooms, heal}`; `hp`/`dmg` apply at spawn, not to minions, allies or the Gloom; `heal` multiplies every heal and shield a hero receives. The boss takes the tier of the moment its room is entered.
- **The Deep hits harder**: every new room entered Dark or Lightless adds to a stratum counter (`w.deepRooms`, counted up to `DEEP_MAX` 5, reset each stratum). Foes spawned from then on in the stratum, bosses too, deal `1 + DEEP × deepRooms` (`World.DEEP` 0.28) times the damage of their tier; HP never changes.
- **Fewer, nastier** (Dim and darker): each elite in a wave displaces `World.ELITE_BODIES` (4) budget of plain foes (one plain foe always stays); Dark and Lightless elites roll their affix from brutal / vampiric / warded / swift.
- **Darkness pays**: at Dark and Lightless a cleared room's reward is upgraded one step with chance `up` (gold → vigor → forge → epic, boon → epic; relic, epic and oil stay); `{t:'upgrade', to, x, y}` announces it.
- **The Gloom** (Dark and Lightless, non-boss non-start rooms): a telegraphed spawn (1.5 s) at the floor point farthest from the heroes, then a hunter: invulnerable, passes through walls, speed 1.05 × the target's move speed (a dash only breaks away for a moment), keeps 100 px away, and every 1.6 s winds up 0.55 s with a fixed aim line toward the hero, then lunges 170 px. A touch deals `World.GLOOM_HIT` (0.19) of the toughest living hero's max HP, at most 25% of the victim's max HP. Dark hunts with 1 Gloom; Lightless with 1 plus `floor(deepRooms / GLOOM_STEP)` (1), at most `GLOOM_MAX` (3), each spawning `GLOOM_GAP` (4) s after the last. Ignored by room-clear checks; despawns when you leave the room.
- **Driving it off**: any light gained (`addLight`: oil) banishes every Gloom and resets its timer. **Lantern flare** (`F`, pad L3; action `flare`): costs 6 light, needs light ≥ 6, not in the boss room, 1 s cooldown; banishes the Gloom for 12 s and blinds non-boss foes within 160 px for 1.5 s. It can push the lantern into a darker tier. At 0 light only oil answers the Gloom.
- Emits `{t:'dread', tier}` on tier change. A safe room with an open boon offer holds the Gloom's delay (and, solo, freezes the world).

## 8. Enemies

- Every telegraphed wind-up (lob flights included) lasts `max(t × rate, min(t, 0.4)) × e.windMul`: `rate` 0.7 for swift elites, 1 otherwise; `windMul` default 1. Foes with `e.blind > 0` cannot start attacks. Stunned or frozen foes do nothing.
- A wind-up telegraph (zone with `src`) stalls while its caster is frozen or stunned and is cancelled, without hitting, when it dies. Ground bursts placed on their own (lobbed globs, web, boss spikes, spore fields, mire, fire rain) are `detached`: they resolve on their own clock.
- **No untelegraphed teleports.** When a hero is within 80 and the step is off cooldown (7 s), casters telegraph 0.6 s (marker at origin and destination) and step 150 away.
- Signature foe per biome:
  - I **Bone Priest** (support): raises a dead skeleton (telegraphed), wards an ally.
  - II **Mire Worm** (burrower): travels under ground (untargetable, visible trail), erupts under the hero after a 0.8 s ground telegraph, spore ring.
  - III **Frost Sentinel** (guard): frontal shield `guard {arc 2.2, mul 0.2}` blocks from the front, shield-bash charge.
  - IV **Ember Drone** (orbiter): circles the hero at ~160, fires 3-shot bursts.
  - V **Drowned Reaver** (leaper): leaps to the hero's position (landing circle), cleaving cone on landing.
  - VI **Rift Caller** (summoner): opens a telegraphed rift that spawns 2 starspawn every 6 s.
  - **Gloom** (Dark and Lightless hunter, any stratum).
- Bosses use telegraphed attacks in three phases (HP 66% / 33%; the Hollow King 60% / 30%); the pause between attacks is 1.05 / 0.7 / 0.45 s by phase × 0.8 under Pact 5+ × the stratum's boss pause. After a boss falls, hostile shots and pools are removed.
- Floor hazards (spikes, poison, lava, void) hurt for 4-6 per tick × `World.HAZARD_MUL` (0.5), scaled by 20% per stratum.

## 9. Hearth (meta) and save

- **Deep Wick** (tier 1): +6% lantern light per rank, costs 40/90/160. 16 upgrades in all; steps per rank: Vitality +6 max health, Might +4% damage, Fortune +10% gold, Fleetness +4% move speed, Provisions heal 10%, Bulwark +2 armor, Precision +2% crit, Wisdom +5% experience, Alacrity +4% skill recharge. Mastery 10 levels per hero: 2 +5% damage · 3 second weapon · 4 +10 max health · 5 skills recharge 8% faster · 6 third weapon · 7 +4% crit · 8 +1 reroll · 9 +8% damage · 10 golden aura. The relic upgrade (id `armory`) is named Reliquary.
- **Refunds**: every upgrade rank and Armory entry refunds its full cost on demand (`S.refundUpgrade`, `S.refundArmory`); Reset all (`S.resetUpgrades`, a two-step confirm in the UI: the first press arms it for 3 s) refunds every rank and entry at once. `lifetime` embers never change on a purchase or refund.
- **Armory**: `ED.ARMORY[hero]` lists per-hero sidegrade unlocks `{ id, name, desc, cost }`, bought and refunded in the Upgrades page below the upgrades (a hero's section shows while its list is non-empty and the hero is unlocked). The lists are empty until content lands. The meta bundle carries each hero's owned entry ids (`meta.armory`); the profile stores `armory: { hero: [0|1 per entry] }`.
- 26 deeds including Evolved (evolve a weapon, 40) · Into the Dark (defeat a boss while Lightless, 50) · Cartographer (clear every room of a stratum, 40) · Relic Keeper (hold 10 relics in one descent, 60; the slot of the removed Archivist). Ten pacts raise difficulty and embers (`PACT_EMBER_BONUS` 0.08 per level).
- Profile key `wickdeep.profile.v1`, save code prefix `WD1-`, peer prefix `wickdeep-v1-`. No other profile key is imported; Emberdeep `ED1-` codes are refused.
- **Save code** (`CODE_VERSION` 5): positional lists (UPGRADES, CLASS_IDS mastery, then the Armory, then DEEDS) each carry a count prefix, so appending an entry never shifts what follows; the decoder skips extra entries and leaves missing ones at 0. The Armory section follows mastery: a hero count (4 bits), then per hero an entry count (6 bits) and 1 bit per entry (at most 63 entries per hero; more cannot be written). Versions 2, 3 and 4 still decode (their relic bits are read against the frozen v4 relic table and refunded as embers); a newer version is refused with "reload the page". Reordering or removing an entry bumps `CODE_VERSION`.
- **Codex migration**: a stored profile below era 3 (profile `v` 3 has no `relics` array) or a v2-v4 code holds the old Codex relics; their costs (the frozen v4 table in `save.js`) are added to `embers` once (never to `lifetime`), the amount is kept in `profile.refunded`, and `S.load` writes the migrated profile back so a reload cannot refund again.
- **Returning players**: a profile below era 3 or a code below version 5 gets `news = 1` when it has runs or a refund; a one-time "The Deep has changed" notice lists the changes (relics, Hearth refunds, the v3 rules) and the refunded embers, then clears the flag and `refunded`.
- Settings (`wickdeep.settings.v1`): volumes, quality, frame cap, screen shake, damage numbers, key bindings, cursor, cursor size, cursor colour, skill aim preview, last Tab-sheet tab (`sheetTab`).

## 10. Balance targets (bots, `tools/sim.js`, skill 0.75)

Measured cells are the sign-off batch at skill 0.75, taken at `cd1074d` (solo rows on the commit before its party HP change, which solo runs do not read). Smart pick policy unless noted; 384 runs each (two and three heroes: 192), six heroes in rotation. Skill 0.75 is the share of ticks the bot pays attention to floor hazards and the lantern flare, and the chance it reads each Gloom lunge telegraph; hazard tiles are routed around. The `mid` and `max` presets carry the Codex relics (mid: start relics plus Codex relics costing ≤ 70 without a boss requirement). Runs (`node tools/simpool.js <args>`): Fresh random `1 384 0.75 none --pick=random`; Fresh smart, Half-upgraded and Fully upgraded `1 384 0.75 none,mid,max --pick=smart`; Pact 5 `1 384 0.75 max - 5 --pick=smart`; Two heroes `2 192 0.75 mid --pick=smart`; Three heroes `3 192 0.75 mid --pick=smart`. `simpool.js` runs at normal priority; `--nice` opts into idle priority, which Windows throttles while the machine is unattended.

| Profile | Target win | Measured | Target depth | Measured |
|---|---|---|---|---|
| Fresh, random picks | ≤ 5% | 2% | 2.5–3.5 | 4.59 |
| Fresh, smart picks | 5–10% | 1% | 2.5–3.5 | 4.62 |
| Half-upgraded | 25–40% | 34% | — | 5.68 |
| Fully upgraded | 65–80% | 65% | — | 5.91 |
| Fully upgraded, Pact 5 | 20–35% | 25% | — | 5.66 |
| Two heroes, half-upgraded | 45–70% | 51% | — | 5.86 |
| Three heroes, half-upgraded | 45–70% | 42% | — | 5.90 |

- **Paths** (96-run batches, mid, smart, paired by seed): offers per stratum 5.5–6.5; keystone on the main path median stratum II; evolution quartiles for element mains [3 3 4], 60–85% evolved by stratum IV entry; Generalist median evolution not earlier than the element-main median; duo taken in ≥ 60% of two-gate runs by the end of stratum IV, median stratum III. Spread (paired mean depth): forced starts within 0.3 strata of each other; none more than 0.2 above a random start; Generalist within ±0.2 of random; Poison co-op party at most 0.2 above random + random. Measured: spread 0.21 strata, best forced start +0.06 over random, Generalist −0.10 against random, Poison co-op +0.06; a two-gate pair kills a boss in 0.91–0.96 of a mono-gate build's time.
- **Classes** (`tools/sheet.js` first, then `--route=rotate --fork=rotate --weapon=rotate`): each skill route raises its own skill's share of direct damage by ≥ 8 points; the attack route raises the weapon share by ≥ 8 points over the mean of the two skill arms; the element route raises the status share by ≥ 6 points. Each route's boss time to kill at strata II and IV within ±15% of the class median; each weapon within ±15% of its class median (knob: that weapon's `dmg`); Heavy within ±10% of Swift in packs; Guard forks lose 60–85% of the HP of their Burst sibling; ≥ 90% of runs that kill the stratum IV boss reach fork rank 3 under `--mastery=fork`.
- **No sustain by default**: HP lost per combat room ≥ 4.5% of max HP and per elite room ≥ 7.5% for every fork and base kit; a Knight on Shield Orbit takes ≥ 50% of the attack arm's projectile damage; class shield absorbed per boss-fight second ≤ 0.3% max HP, all sources ≤ 0.6%. Measured: no heal per kill or per hit; Holy shields absorb 0.09–0.12% max HP per boss-fight second.
- **Control caps**: trash stun uptime per hero ≤ 40%; Brace uptime ≤ 40%; Sanctuary DR uptime ≤ 60%; smoke blind per foe ≤ 50%. Perf: peak projectiles alive per hero ≤ 40; live zones per hero ≤ 8; hit events ≤ 60 per second per hero.
- **Pacing targets** (half-upgraded): a regular foe dies in 2–4 weapon hits on strata I–II, an elite in 5–8 s, boss fights last 45–90 s (fresh up to 110 s), a winning descent takes 22–28 min.
- **Hero spread** (solo, 64 runs per hero): half-upgraded Cleric 45% · Ranger 44% · Knight 42% · Necromancer 27% · Pyromancer 22% · Shade 22% (a paired 384-run Pyromancer + Shade batch at seeds 20000+ read 28%); fully upgraded Ranger 73% · Necromancer 72% · Knight 69% · Cleric 66% · Pyromancer 55% · Shade 55%.
- **Explore sweep**: `--explore=<minLight>` (default 0.3, `EXPLORE_MIN_LIGHT`; negative = explore everything) makes the bot explore the nearest unvisited room while paying its cost leaves the lantern at or above the value. Intent: the win rate peaks at an interior value, because a hero that explores everything meets the Deep's full stack, up to 3 Glooms and halved healing.
- Power curve (`tools/sim.js` summary lines): damage share by source, weapon share by main path ≥ 20% each, hero damage per second over the bare weapon by stratum, cooldown reduction at run end.
- **Open gaps at sign-off**:
  - Fresh smart picks win 1% (target 5–10%) and fresh depth is about 4.6 (target 2.5–3.5).
  - Three heroes, half-upgraded win 42% (target 45–70%).
  - Guard forks: 5 of 12 Guard/Burst HP-lost ratios sit inside 0.60–0.85 (bot noise ±0.15 at n = 20–48).
  - Ranger forks lose 3.5–4.4% max HP per combat room (floor 4.5%).
  - Peak live zones per hero exceed 8 in some Pyromancer and Knight runs.
  - The weapon-arm target (index 1 and 2 weapons) is not measured.

## 11. Interface, renderer and art

### Tab sheet

`Tab` (pad Back) opens the sheet in a run, also while a boon offer is open (an offer does not close it). Solo, the world freezes while it is open; in a party the descent continues. It opens on the last tab used. Q/E (pad LB/RB) or 1–3 switch tabs; Tab or Esc (pad B) closes; in a party a click on the party list or Y (pad) switches the viewed hero. Every number comes from `ED.Sheet.compute` (`src/sim/sheet.js`, pure, identical on host, client and Node) and refreshes live, at most twice a second.

- **Build**: owned element paths (or General) with affinity, keystone and evolution state; duos (owned, available, or what each second gate would unlock); the class route tree with forks and next-rank text; every boon at its current rank with full text and the next-rank delta; statuses the build applies with their rules; relics with live values.
- **Combat**: weapon card (damage per hit and crit, attacks per second, reach, extras, damage per second on one foe); a card per skill (effective cooldown, aim, every part with its per-hit damage, radius, duration, count, per cast on one foe, damage per second); dash; offence multipliers each with its sources (damage, attack speed, crit, area, skill cooldown raw → effective, projectiles, a status row per owned element); defence (max HP, armor reduction, dodge, taken multiplier, healing received, current shield and the shield window); foes that spawn now hit ×(depth × threat × pact × dread × Deep).
- **Map**: the stratum card (affinity now and next), the lantern (tier, light, room costs, boss-door reward, flare), the room map, the party.

### HUD

Canvas `#hud` above the world at device resolution (capped by pixel count); unit `u = clamp(13, min(W / 110, H / 62), 36)` CSS px, the same as `style.css`; minimum text 0.85u; panels use the menu look (soot fill, 2 px line, brass corner brackets). It repaints only when a signature of the shown values changes, an animation runs, or a safety interval passes. Fixed anchors, nothing floats:

- **Bottom-left, hero block**: portrait medallion, name, weapon (fork and evolution names), large health bar (numbers, pale shield segment after the health, damage ghost, pulse under 30%); above it the ability slots skill 1, skill 2, dash and flare with live key caps, cooldown sweep and seconds, charge pips (a thrown shield lights skill 2 until it is caught); path rings (a ring fills to the evolution threshold, a tick marks the keystone threshold, a star marks the evolved path); the route sigil; status chips (Brace, Momentum, Channel, Hexed foes, the next Cleave, Guardian Light, Embolden); the message feed stacks above.
- **Top-left**: party frames (name, class, health; DOWN with revive progress; Fallen).
- **Top-right**: stratum name, stratum number, weak/resists chips, minimap (light cost on unvisited rooms), then the lantern panel: tier, percent, meter with tint zones and ticks at 50% and 25%, one effect line, room costs and the boss-door reward.
- **Bottom-centre**: level, xp bar, gold; a pending-boon pill above it. **Bottom-right**: relics. **Top-centre**: boss bar with phase marks.
- **Panel fade**: every panel eases to 35% alpha in 0.15 s while a hero, foe or pickup is on screen beneath it, and back 0.2 s after the last overlap (the boss bar is a panel too); prompts and messages never fade.
- **In the world**: hero names print at the hero; a downed hero shows `DOWN` (own) or `REVIVE` (ally). World text is the 8 px pixel font at 2 world px per font px (16 world px line height); foe health bars are 2 world px (3 when scale is below 2); elite labels use the affix colour. A hero who owns Brand, Open Veins, Contagion or Gangrene sees ailment pips under foe bars; Sworn Blade shows the Parry rim on a foe in the last 0.3 s of a wind-up.
- **Cursor and aim extras** (`src/client/aim.js`): a procedural reticle cursor (or the system crosshair; three sizes and colours) that lights over foes; an attack-cooldown arc, an attack pulse and a crit flash; the landing preview of ground skills (setting "Skill aim preview"); a chevron on a pad.
- **Toasts** (DOM, in a run): top-centre below the boss bar. **At the prop**: interaction prompt with the attack key and a description card; tutorial and stratum signs draw as a screen-space card using `{attack}`, `{aim}`, `{skill1}`, `{skill2}`, `{dash}`, `{flare}`, `{map}` tokens. The aim sign stands beside the solo spawn.
- **Menus**: Descend, Hearth, Heroes, Settings, Credits. Settings: Sound (master, music, effects), Display (quality High/Low, frame cap, screen shake, damage numbers), Controls (cursor, cursor size, cursor colour, skill aim preview, key bindings), Profile. The Credits screen shows the CC-BY attribution.

### Renderer

- The world draws into one small offscreen buffer at 1 buffer px = 1 world px (two alternating buffers); the present step upscales it to the screen (sharp-bilinear in WebGL, nearest on the 2D fallback) and applies the fractional camera offset, so scrolling stays smooth. The screen scale `R.scale` snaps to half steps so one art px (2 world px) is a whole number of screen px; the minimum view is 720 × 420 world px and the snap can show a little more.
- WebGL post (`post.js`): bloom at half the buffer, per-biome colour grade, vignette, grain, chromatic aberration. It is optional: Low quality uses plain 2D, and a software GL context switches to it at a reduced resolution.
- Cached art is a canvas first and swaps to an `ImageBitmap` once ready (`ED.Bmp`); recolours and rotated sprites are cached, never rebuilt per frame. Frame pacing: the loop measures the display rate and presents every n-th frame while frames keep missing vsync (setting Frame cap: Auto, Uncapped, 144, 120 or 60 fps).
- **Hit feedback** (visual only): a foe flashes for 66 ms on a hit and cannot flash again until 120 ms after that flash ended; damage over time and zone ticks never flash. An ordinary foe's flash is a white silhouette over its body, a boss gets a 50% white overlay on its normal body, and the red wind-up outline shows under both. Damage numbers of one style that land within 150 ms at one spot add into a single number that pops again; a spot keeps at most 3 live numbers (the oldest goes first) and numbers over the same spot stack upward by one text height.

### Art

- No runtime asset files: art is embedded as data URIs. Vendored third-party packs (CC0 and CC-BY 4.0: 0x72, nijikokun, kosinaz, Ninja Adventure, Puny, DawnLike, LuizMelo, Kenney, o_lobster, Aim studios, ansimuz, CodeManu) live in `art-src/` (licences and hashes in `art-src/SOURCES.md`); `tools/art.js` with `tools/art-manifest.js` crops and packs frames into atlas pages `src/art/{meta,world,actors,bosses,fx,fxbig}.js` (`ED.ART`: pages, frames, anims, palette, font, swaps) deterministically. `node tools/art.js --check` fails when `src/art/` differs from a rebuild.
- Runtime: `atlas.js` (`ED.Bmp`, `ED.Atlas`: page decode, recolour and rotation caches, pixel font), `actors.js` (hero, foe and boss animations, one default attack animation per class), `pixfx.js` (`ED.Pix` pixel drawing helpers), `tiles.js`, `fx.js` and the per-class `cls-<class>.js` files that register into the `ED.ClassFx` hook registry (`shot[kind]` returns true to replace a projectile body). If the art pages fail to load, drawing falls back to the older procedural code.
- Attribution is required (CC-BY 4.0): the README Credits section and the in-game Credits screen carry it.
