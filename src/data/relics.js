// Relics: run-long items that change a rule or make a trade-off. Data here (name, rarity, icon, text, numbers); behaviour in src/sim/relics.js (ED.RELIC_FX hooks).
// rar: c common · r rare · e epic (drop, shop and gamble pools) · boss (boss picks only) · curse (never rolled unless asked, never sold, not counted as a held relic).
// mods: the stat side of a relic (ED.Stats.sources). pw { base, k }: a proc of base + k x Class Power (ED.procDmg). v: the numbers the behaviour reads. lift { on, n }: a curse lifts after n of
// 'kill' (foes you kill that are not fodder), 'elite' (elites you kill), 'clear' (fights cleared), 'boon' (boons you pick) or 'stratum' (stratum starts).
(function (ED) {
  'use strict';
  const R = ED.RELICS = {
    // ---- common ----
    whetstone: { name: 'Whetstone', rar: 'c', icon: 'sword', desc: 'Every 4th attack deals +60% damage.', v: { every: 4, mul: 0.6 } },
    lodestone: { name: 'Lodestone', rar: 'c', icon: 'magnet', desc: 'Gold and experience fly to you from anywhere in the room. Hearts heal you 25% less.', mods: { pickup: 9 }, v: { heart: 0.75 } },
    pauldron: { name: 'Spiked Pauldron', rar: 'c', icon: 'thorn', desc: 'A foe that hits you takes 150% Power and is knocked back.', pw: { k: 1.5 } },
    coin: { name: 'Lucky Coin', rar: 'c', icon: 'coin', desc: 'Gold you pick up has a 12% chance to be worth five times as much.', v: { ch: 0.12, x: 5 } },
    elixir: { name: 'Elixir Flask', rar: 'c', icon: 'potion', desc: 'Once per stratum, dropping below 30% health heals you 30% of your max health.', v: { at: 0.3, heal: 0.3 } },
    boots: { name: "Traveler's Boots", rar: 'c', icon: 'boot', desc: 'Weapon hits in the 0.6 s after a dash deal +40% damage.', v: { t: 0.6, mul: 0.4 } },
    buckler: { name: 'Iron Buckler', rar: 'c', icon: 'shield', desc: 'The first hit you take in each fight is blocked.' },
    heartstone: { name: 'Heartstone', rar: 'c', icon: 'heart', desc: '+6 max health. All healing you receive is 25% weaker.', mods: { hp: 6, heal: -0.25 } },
    hourglass: { name: 'Sand Hourglass', rar: 'c', icon: 'hourglass', desc: 'When a fight starts, your skills are recharged.' },
    glasseye: { name: 'Glass Eye', rar: 'c', icon: 'eye', desc: 'Your hits on foes at full health always crit.' },
    lantern: { name: 'Soul Lantern', rar: 'c', icon: 'lantern', desc: 'A brighter light. In dark rooms you deal +20% damage.', mods: { light: 0.35 }, v: { mul: 0.2 } },
    pristine: { name: 'Pristine Halo', rar: 'c', icon: 'sun', desc: 'At full health you deal +20% damage.', v: { mul: 0.2 } },
    rage: { name: 'Blood Rage', rar: 'c', icon: 'heartbroken', desc: 'Below 40% health you deal +30% damage.', v: { at: 0.4, mul: 0.3 } },
    wraps: { name: "Brawler's Wraps", rar: 'c', icon: 'hand', desc: '+25% damage to foes within 70 of you; 15% less to foes beyond 150.', v: { near: 70, far: 150, up: 0.25, down: 0.15 } },
    spyglass: { name: 'Spyglass', rar: 'c', icon: 'arrow', desc: '+25% damage to foes beyond 180 of you; 15% less to foes within 70.', v: { near: 70, far: 180, up: 0.25, down: 0.15 } },
    bandage: { name: 'Field Bandage', rar: 'c', icon: 'leaf', desc: 'Clearing a fight heals you 2 health.', v: { heal: 2 } },
    gust: { name: 'Gust Charm', rar: 'c', icon: 'wing', desc: 'Dashing knocks back foes within 70 of you and deals 60% Power to them.', pw: { k: 0.6 }, v: { r: 70 } },
    warchest: { name: 'War Chest', rar: 'c', icon: 'chest', desc: 'The party gains 25 gold now and at the start of each stratum.', v: { gold: 25 } },
    quill: { name: 'Gilded Quill', rar: 'c', icon: 'feather', desc: 'Each boon you pick gives the party 5 gold.', v: { gold: 5 } },
    clover: { name: 'Four-Leaf Clover', rar: 'c', icon: 'clover', desc: '+1 boon reroll now and at the start of each stratum.', mods: { cloverRerolls: 1 } },
    ledger: { name: "Merchant's Ledger", rar: 'c', icon: 'scroll', desc: 'Shops stock one more relic.' },
    haggle: { name: "Haggler's Charm", rar: 'c', icon: 'coins', desc: 'The first item you buy in each shop costs half: the other half comes back as gold.', v: { back: 0.5 } },
    compass: { name: "Explorer's Compass", rar: 'c', icon: 'question', desc: 'Event rooms up to 3 rows ahead show what they hold on the map. Entering an event room gives the party 10 gold.', v: { gold: 10, rows: 3 } },
    tooth: { name: 'Shark Tooth', rar: 'c', icon: 'fang', desc: 'Killing an elite readies 3 crits; any other kill readies 1 (at most 3 ready).', v: { elite: 3, kill: 1, cap: 3 } },
    piggy: { name: 'Piggy Bank', rar: 'c', icon: 'pig', desc: 'Entering a shop, the party gains 15% of its gold (at most 30).', v: { pct: 0.15, max: 30 } },
    lifeline: { name: 'Lifeline Rope', rar: 'c', icon: 'rope', desc: 'You revive allies twice as fast, and an ally you revive rises with 60% health. Once per stratum, falling below 25% health knocks back and stuns foes within 140 of you for 1 s.', mods: { reviveK: 1 }, v: { hp: 0.6, at: 0.25, r: 140, stun: 1 } },
    contract: { name: 'Bounty Contract', rar: 'c', icon: 'scroll', desc: 'Elites you kill drop 10 gold; champions 30.', v: { elite: 10, champ: 30 } },
    star: { name: 'Wishing Star', rar: 'c', icon: 'star', desc: 'Each level-up readies 2 crits and heals you 1 health.', v: { crits: 2, heal: 1 } },
    // ---- rare ----
    satchel: { name: 'Bomb Satchel', rar: 'r', icon: 'bomb', desc: 'Dashing drops a bomb that explodes for 200% Power.', mods: { dashBomb: 1 }, pw: { k: 2 } },
    cloak: { name: 'Shadow Cloak', rar: 'r', icon: 'cloak', desc: 'Dashing hides you from foes for 0.8 s; attacking ends it.', v: { t: 0.8 } },
    wardrum: { name: 'War Drum', rar: 'r', icon: 'drum', desc: '+25% damage in elite, champion and boss rooms; 5% less in other fights.', v: { up: 0.25, down: 0.05 } },
    axe: { name: "Headsman's Axe", rar: 'r', icon: 'axe', desc: 'Your hits kill foes below 12% health (elites below 6%). Not bosses or champions.', v: { at: 0.12, elite: 0.06 } },
    seeker: { name: 'Seeker Gem', rar: 'r', icon: 'gem', desc: 'Your shots seek foes. Melee reach +20%.', mods: { homing: 3, meleeReach: 0.2 } },
    mirror: { name: 'Mirror Shard', rar: 'r', icon: 'mirror', desc: 'Every 3rd projectile that would hit you is shrugged off.', v: { every: 3 } },
    aegis: { name: 'Aegis Charm', rar: 'r', icon: 'shieldgold', desc: 'Every 10 s, the next hit you take is blocked.', mods: { aegis: 1 } },
    mask: { name: 'Berserker Mask', rar: 'r', icon: 'mask', desc: '+35% damage. You take 20% more damage.', mods: { dmg: 0.35, vuln: 0.2 } },
    idol: { name: 'Golden Idol', rar: 'r', icon: 'idol', desc: '+1% damage for every 15 party gold (at most +20%).', mods: { idol: 1 } },
    banner: { name: 'Banner of Unity', rar: 'r', icon: 'banner', desc: 'You and every ally within 200 of you deal +12% damage.', v: { r: 200, mul: 0.12 } },
    skull: { name: 'Cursed Skull', rar: 'r', icon: 'skull', desc: 'Take 25% more damage. Earn 50% more embers this run.', mods: { vuln: 0.25, emberBonus: 0.5 } },
    bloodstone: { name: 'Heartwood', rar: 'r', icon: 'heart', desc: 'Hearts heal you twice as much. 3 less max health.', mods: { hp: -3 }, v: { heart: 2 } },
    nail: { name: 'Rusted Nail', rar: 'r', icon: 'dagger', desc: 'Each of your hits on a foe makes it take +3% more from your hits (at most +30%).', v: { per: 0.03, max: 0.3 } },
    keg: { name: 'Powder Keg', rar: 'r', icon: 'meteor', desc: 'Foes you kill (not fodder) burst for 100% Power around them.', pw: { k: 1 }, v: { r: 70 } },
    lens: { name: 'Focusing Lens', rar: 'r', icon: 'orb', desc: 'Weapon hits in the 1.5 s after you cast a skill deal +40% damage.', v: { t: 1.5, mul: 0.4 } },
    rune: { name: 'Rune of Echoes', rar: 'r', icon: 'seal', desc: 'Every 4th cast of skill 1 or skill 2 is refunded.', v: { every: 4 } },
    core: { name: 'Overcharged Core', rar: 'r', icon: 'arc', desc: 'Skill hits deal +30% damage; weapon hits 15% less.', v: { up: 0.3, down: 0.15 } },
    stoneskin: { name: 'Stoneskin Idol', rar: 'r', icon: 'bulwark', desc: 'Take 30% less damage after standing still for 0.5 s.', v: { t: 0.5, mul: 0.7 } },
    lastbreath: { name: 'Last Breath', rar: 'r', icon: 'moon', desc: 'Below 30% health, 35% of hits miss you.', v: { at: 0.3, ch: 0.35 } },
    oath: { name: 'Oathstone', rar: 'r', icon: 'shield', desc: 'When an ally goes down or you fall below 30% health, you deal +40% damage for 8 s (once per fight).', v: { at: 0.3, mul: 0.4, t: 8 } },
    dice: { name: 'Loaded Die', rar: 'r', icon: 'dice', desc: 'Now and at the start of each stratum, every gold reward on the map becomes a boon, forge or vigor reward.' },
    ink: { name: "Cartographer's Ink", rar: 'r', icon: 'map', desc: 'Now and at the start of each stratum, two combat rooms ahead turn into event rooms.', v: { n: 2 } },
    relay: { name: 'Shared Spoils', rar: 'r', icon: 'potion', desc: 'Hearts you pick up also heal allies within 250 of you by half as much. Alone, hearts heal you 30% more.', v: { r: 250, share: 0.5, solo: 1.3 } },
    // ---- epic ----
    phoenix: { name: 'Phoenix Feather', rar: 'e', icon: 'feather', desc: 'Once per run, a killing blow raises you at 50% health in a blast of 300% Power.', mods: { phoenix: 1 }, pw: { base: 0, k: 3 }, v: { hp: 0.5, r: 110 } },
    angel: { name: 'Guardian Angel', rar: 'e', icon: 'wing', desc: 'Once per stratum, a killing blow leaves you at 1 health instead.', mods: { angel: 1 } },
    twinfang: { name: 'Twin Fang', rar: 'e', icon: 'twin', desc: 'Every 4th attack strikes twice.', mods: { twinEvery: 4 } },
    chalice: { name: 'Grail of Ages', rar: 'e', icon: 'chalice', desc: '+1 max health per 12 kills this run (at most +8; growth does not heal). At +8: +10% damage.', mods: { chalice: 1 }, kills: 12, full: { hp: 8, mods: { dmg: 0.1 } } },
    stone: { name: "Philosopher's Stone", rar: 'e', icon: 'gem', desc: '+2% damage and +0.5 max health per relic held (curses do not count).', mods: { stone: 1 }, perRelic: { dmg: 0.02, hp: 0.5 } },
    kingslayer: { name: 'Kingslayer', rar: 'e', icon: 'skullcrown', desc: '+35% damage to elites, champions and bosses; 10% less to other foes.', v: { up: 0.35, down: 0.1 } },
    glassheart: { name: 'Glass Heart', rar: 'e', icon: 'heartbroken', desc: '+45% damage. 40% less max health.', mods: { dmg: 0.45, hpMul: -0.4 } },
    soulcage: { name: 'Soul Cage', rar: 'e', icon: 'lantern', desc: 'Every 12th foe you kill (not fodder) frees a spirit that strikes the 5 nearest foes for 250% Power.', pw: { k: 2.5 }, v: { every: 12, n: 5, r: 320 } },
    thorncrown: { name: 'Crown of Thorns', rar: 'e', icon: 'thorn', desc: 'When a foe hits you, every foe within 160 of you takes 300% Power and is knocked back. You take 10% more damage.', mods: { vuln: 0.1 }, pw: { k: 3 }, v: { r: 160 } },
    timestop: { name: 'Stopped Clock', rar: 'e', icon: 'hourglass', desc: 'For the first 5 s of each fight, every foe that appears is stunned for 2 s (elites 1 s). Not bosses.', v: { t: 5, stun: 2 } },
    metronome: { name: 'Metronome', rar: 'e', icon: 'bell', desc: 'Every 8th attack is a crit that deals +50% damage.', v: { every: 8, mul: 0.5 } },
    ricochet: { name: 'Ricochet Coin', rar: 'e', icon: 'arrows', desc: 'Your crits bounce: the nearest other foe within 150 takes 50% of the hit.', v: { r: 150, share: 0.5 } },
    // ---- boss (bosses I and II: one pick of 3 per hero) ----
    crown: { name: 'Crown of Choice', rar: 'boss', icon: 'crown', desc: 'Every boon offer shows one more card. Campfires no longer heal you.', mods: { choices: 1, noRest: 1 } },
    midas: { name: "Midas' Touch", rar: 'boss', icon: 'coins', desc: 'Gold you pick up is doubled. Shop prices +50%.', mods: { gold: 1, markup: 0.5 } },
    ironclad: { name: 'Ironclad Plate', rar: 'boss', icon: 'bulwark', desc: 'Take 35% less damage. You move 15% slower.', mods: { vuln: -0.35, spd: -0.15 } },
    sundial: { name: 'Sundial', rar: 'boss', icon: 'sun', desc: 'Skills recharge 40% faster. Your weapon deals 20% less damage.', mods: { cdr: 0.4, wDmg: -0.2 } },
    eyeoffate: { name: 'Eye of Fate', rar: 'boss', icon: 'eye', desc: 'Boon offers lean far toward rarer cards. You lose every boon reroll and gain none.', mods: { luck: 0.6 } },
    pandora: { name: "Pandora's Box", rar: 'boss', icon: 'chest', desc: 'Gain 2 random epic relics and 2 random curses.', v: { epics: 2, curses: 2 } },
    voidstone: { name: 'Void Stone', rar: 'boss', icon: 'gem', desc: 'Your relic picks show 4 relics instead of 3. Elites and champions deal 25% more damage to you.', v: { mul: 1.25 } },
    bloodpact: { name: 'Blood Pact', rar: 'boss', icon: 'skull', desc: '+35% damage. All healing you receive is halved.', mods: { dmg: 0.35, heal: -0.5 } },
    warpath: { name: 'Warpath Totem', rar: 'boss', icon: 'drum', desc: 'Every fight adds one more elite to its last wave. Elites you kill drop a heart and 15 gold.', v: { gold: 15 } },
    ghostlantern: { name: 'Ghost Lantern', rar: 'boss', icon: 'lantern', desc: 'Odd levels grant a boon offer as well. Gold you pick up is worth nothing.' },
    // ---- curses (never dropped or sold; events hand them out) ----
    c_frailty: { name: 'Frailty', rar: 'curse', icon: 'heartbroken', desc: '15% less max health. Lifts after you clear 5 fights.', mods: { hpMul: -0.15 }, lift: { on: 'clear', n: 5 } },
    c_rust: { name: 'Rust', rar: 'curse', icon: 'sword', desc: 'Your weapon deals 15% less damage. Lifts after 40 kills.', mods: { wDmg: -0.15 }, lift: { on: 'kill', n: 40 } },
    c_greed: { name: "Greed's Toll", rar: 'curse', icon: 'coins', desc: 'Shop prices +30%.', mods: { markup: 0.3 } },
    c_dread: { name: 'Dread', rar: 'curse', icon: 'skullhorn', desc: 'Elites and champions deal 25% more damage to you. Lifts after you kill 3 elites.', v: { mul: 1.25 }, lift: { on: 'elite', n: 3 } },
    c_clumsy: { name: 'Clumsiness', rar: 'curse', icon: 'hand', desc: 'Your first hit on each foe deals 50% less. Lifts after you clear 3 fights.', v: { mul: 0.5 }, lift: { on: 'clear', n: 3 } },
    c_decay: { name: 'Decay', rar: 'curse', icon: 'leaf', desc: 'Hearts heal you half as much. Lifts at the start of the next stratum.', v: { heart: 0.5 }, lift: { on: 'stratum', n: 1 } },
    c_doubt: { name: 'Doubt', rar: 'curse', icon: 'question', desc: 'Boon offers show one card fewer. Lifts after you pick 3 boons.', mods: { choices: -1 }, lift: { on: 'boon', n: 3 } },
    c_leaden: { name: 'Leaden Feet', rar: 'curse', icon: 'boot', desc: 'You move 10% slower. Lifts after you clear 4 fights.', mods: { spd: -0.1 }, lift: { on: 'clear', n: 4 } },
    c_pain: { name: 'Hex of Pain', rar: 'curse', icon: 'skull', desc: 'Every hit you take costs 1 more health. Lifts after 50 kills.', lift: { on: 'kill', n: 50 } },
    c_poverty: { name: 'Poverty', rar: 'curse', icon: 'coin', desc: 'Gold you pick up is worth 30% less.', v: { mul: 0.7 } },
  };
  ED.RELIC_IDS = Object.keys(R);
  ED.RELIC_PRICE = { c: 60, r: 90, e: 130 }; // boss relics and curses are never sold
  ED.isCurse = (id) => !!(R[id] && R[id].rar === 'curse');
  ED.heldRelics = (relics) => { let n = 0; for (const id of relics || []) if (R[id] && R[id].rar !== 'curse') n++; return n; }; // relics held, curses left out
  // Relic rarities beside the boon rarities (ED.RARITY c / r / e / l, boons.js): boss relics and curses.
  Object.assign(ED.RARITY, { boss: { name: 'Boss', color: '#ff5d5d', w: 0 }, curse: { name: 'Curse', color: '#9fb05a', w: 0 } });
})(globalThis.ED || (globalThis.ED = {}));
