// Text events of event rooms (events.js draws and runs them; the def fields are listed there). strata null: the shared pool; req: a chain gate on a run flag set by an earlier event.
// party: one vote of the living heroes (p is null in the choice hooks: every hero is affected); else each hero chooses once for themself. Element-neutral.
(function (ED) {
  'use strict';
  const EV = ED.EVENTS = {};
  const add = (d) => { d.kind = d.kind || 'text'; EV[d.id] = d; };
  const O = (w, p, spec) => ED.Events.outcome(w, p, spec);
  const has = (w, k) => ED.Events.has(w, k);
  const round5 = (n) => Math.round(n / 5) * 5;
  const pc = (f) => Math.round(f * 100) + '%';
  const hpOver = (p, f) => !p || p.hp > p.maxHp * f; // a personal health cost is payable (a party pays from every hero, never below 1)
  const hurt = (w, p, f) => (p ? [p] : [...w.players.values()]).some(q => !q.dead && q.hp < q.maxHp * f);
  const healthy = (w) => [...w.players.values()].every(q => q.dead || q.hp >= q.maxHp * 0.6);
  const relics = (p) => (p ? ED.Events.relicsOf(p).length : 0);
  const LEAVE = (text) => ({ label: 'Leave', note: '', go: () => text });
  // The swap of a relic for a random one a rarity higher (Hollow Mirror, Votive Pool).
  const upSwap = (w, p) => { const own = ED.Events.relicsOf(p); if (!own.length) return; const id = w.rng.pick(own); O(w, p, { removeRelic: id, relic: ED.Events.rarUp(ED.RELICS[id].rar) }); };

  // ================= shared pool =================
  add({ id: 'fountain', name: 'Still Fountain', icon: 'fountain', look: 'fountain', strata: null, w: 7, party: true,
    roll: (r, s) => ({ h: 0.4 + 0.05 * r.int(0, 3), g: 15 + 5 * s + r.int(0, 10), wish: r.chance(0.5) }),
    text: () => 'Black water stands perfectly still in a stone basin. Nothing ripples it, not even your breath. A cup of cracked bone rests on the rim, and the bottom glints with old coins.',
    choices: [
      { label: 'Drink', note: (v) => `The party heals ${pc(v.h)}; the downed stand up`, go: (w, p, v) => { O(w, p, { heal: v.h, raise: true }); w.emit({ t: 'fountain', x: w.room.w * 16, y: w.room.h * 16 }); return 'Cold as a crypt, and it tastes of iron. Every wound closes a little.'; } },
      { label: 'Toss a coin and wish', note: (v) => `${v.g} gold: ???`, req: (w, p, v) => w.gold >= v.g, go: (w, p, v) => { if (v.wish) { O(w, p, { gold: -v.g, maxHp: 2 }); return 'The water swallows the coin without a sound. Something in you settles deeper.'; } O(w, p, { gold: -v.g }); O(w, p, { gold: v.g * 3 }); return 'The fountain coughs, and spits back a rusted purse heavier than your coin.'; } },
      LEAVE('You leave the water undisturbed.'),
    ], safe: 2, bot: (w, p, v) => (hurt(w, null, 0.7) ? 0 : w.gold >= v.g + 40 ? 1 : 2) });

  add({ id: 'altar', name: 'Blood Altar', icon: 'altar', look: 'altar', strata: null, w: 7,
    roll: (r) => { const c = 0.15 + 0.05 * r.int(0, 2); return { c, c2: c + 0.15 }; },
    text: () => 'A slab of red stone, warm to the touch. Grooves in its surface lead to a drain worn smooth by centuries of offerings. It is not thirsty. It is patient.',
    choices: [
      { label: 'Offer blood', note: (v) => `Lose ${pc(v.c)} of max health: an epic boon`, req: (w, p, v) => hpOver(p, v.c), go: (w, p, v) => { O(w, p, { heal: -v.c, offer: 'epic' }); return 'The stone drinks. A shape of light rises from the drain.'; } },
      { label: 'Offer more', note: (v) => `Lose ${pc(v.c2)}: an epic boon and +2 max health`, req: (w, p, v) => hpOver(p, v.c2), go: (w, p, v) => { O(w, p, { heal: -v.c2, offer: 'epic', maxHp: 2 }); return 'You give until your vision greys. The altar gives back more than it took.'; } },
      LEAVE('You keep your blood where it is.'),
    ], safe: 2, bot: (w, p, v) => (hpOver(p, 0.85) ? 0 : 2) });

  add({ id: 'gamble', name: "Gambler's Shrine", icon: 'coin', look: 'gamble', strata: null, w: 7,
    roll: (r, s) => { const g = round5(35 + 18 * s); return { g, g2: round5(g * 1.8), bite: r.chance(0.3) }; },
    text: () => 'A grinning chest squats on a pedestal. A brass plate reads: ONE COIN, ONE WONDER. NO REFUNDS. The lid twitches.',
    choices: [
      { label: (v) => `Pay ${v.g} gold`, note: 'A random relic (12% epic, 38% rare)', req: (w, p, v) => w.gold >= v.g, go: (w, p, v) => { const x = w.rng.next(); O(w, p, { gold: -v.g, relic: x < 0.12 ? 'e' : x < 0.5 ? 'r' : 'c' }); w.emit({ t: 'gamble', x: p.x, y: p.y }); return 'The lid snaps open and shut. Something is left behind on the plate.'; } },
      { label: (v) => `Pay ${v.g2} gold`, note: 'A rare or better relic. It may bite.', req: (w, p, v) => w.gold >= v.g2, go: (w, p, v) => { O(w, p, { gold: -v.g2, relic: w.rng.chance(0.25) ? 'e' : 'r' }); if (v.bite) { O(w, p, { heal: -0.15 }); return 'It pays, and then it bites. Fair is fair.'; } return 'The chest purrs and coughs up something good.'; } },
      LEAVE('No refunds, no thank you.'),
    ], safe: 2, bot: (w, p, v) => (w.gold >= v.g2 + 60 ? 1 : w.gold >= v.g + 40 ? 0 : 2) });

  add({ id: 'trial', name: "Champion's Trial", icon: 'swords', look: 'trial', strata: null, w: 7, party: true,
    text: () => 'Crossed blades hang over a ring of scorched sand. Whoever fought here last did not leave. A voice from nowhere says: Prove it.',
    choices: [
      { label: 'Take the trial', note: 'An elite fight: a rare relic for each hero and gold', go: (w, p, v) => { O(w, p, { fight: 'elite', pay: { relic: 'r', gold: 10 + 6 * w.stratum } }); return 'The sand stirs. Champions rise from it.'; } },
      LEAVE('The voice laughs as you go.'),
    ], safe: 1, bot: (w) => (healthy(w) ? 0 : 1) });

  add({ id: 'delver', name: 'Lost Delver', icon: 'lantern', look: 'campfire', strata: [1, 2], w: 8, party: true,
    roll: (r, s) => ({ g: 30 + 10 * s + r.int(0, 10) }),
    text: () => 'A delver of the Order sits by a dying fire, wick burnt down to the nub, one leg bent the wrong way. "Don\'t suppose you have a spare light," she says. Her pack bulges.',
    choices: [
      { label: 'Share your light', note: 'Each hero loses 10% health. She will remember.', go: (w, p) => { O(w, p, { heal: -0.1, flag: 'delver', lore: true }); return 'You splint the leg and trade her a length of wick. She presses a crumpled page into your hand. "Read it later. And watch for me deeper down."'; } },
      { label: 'Take her pack', note: (v) => `+${v.g} gold. She will remember too.`, go: (w, p, v) => { O(w, p, { gold: v.g, flag: 'robbed' }); return 'She does not fight you. She only watches you go, and starts to laugh.'; } },
      LEAVE('You walk on. Her fire gutters behind you.'),
    ], safe: 2, bot: () => 0 });

  add({ id: 'delverReturn', name: 'The Delver Returns', icon: 'lantern', look: 'campfire', strata: [2, 3, 4], w: 60, party: true, req: (w) => has(w, 'delver'),
    text: () => 'A familiar limp. The delver you splinted waves from a ledge, her wick blazing. "Told you I would find you. I found something too."',
    choices: [
      { label: 'Accept her gift', note: 'A rare relic for each hero', go: (w, p) => { O(w, p, { relic: 'r' }); return 'She hands out trinkets from the deep like sweets.'; } },
      { label: 'Ask her to scout ahead', note: 'Reveal the event rooms ahead; two fights pay better', go: (w, p) => { O(w, p, { map: 'reveal', mapN: 99 }); O(w, p, { map: 'gild', mapN: 2 }); return 'She sketches the rooms ahead from memory, and marks the richest with a thumbprint of soot.'; } },
    ], safe: 0, bot: () => 0 });

  add({ id: 'delverRevenge', name: 'Debt of the Road', icon: 'skull', look: 'campfire', strata: [2, 3, 4], w: 60, party: true, req: (w) => has(w, 'robbed'),
    roll: (r, s) => ({ g: 50 + 20 * s }),
    text: () => 'The delver you robbed is back, and she brought friends. "You took my pack. I will take it out of your hide or out of your purse. Your choice."',
    choices: [
      { label: (v) => `Pay her ${v.g} gold`, note: 'She lets you pass', req: (w, p, v) => w.gold >= v.g, go: (w, p, v) => { O(w, p, { gold: -v.g }); return 'She counts every coin twice, then spits and steps aside.'; } },
      { label: 'Fight', note: 'An ambush. Her pack is still full.', go: (w, p) => { O(w, p, { fight: 'ambush', pay: { gold: 30 + 15 * w.stratum, relic: 'c' } }); return '"Thought so," she says, and whistles.'; } },
    ], safe: 1, bot: (w, p, v) => (healthy(w) || w.gold < v.g ? 1 : 0) });

  add({ id: 'cartographer', name: 'The Cartographer', icon: 'scroll', look: 'merchant', strata: null, w: 6, party: true,
    roll: (r, s) => ({ c1: round5(20 + 10 * s), c2: round5(40 + 15 * s) }),
    text: () => 'An old man has pinned a hundred maps to the wall, every one of them wrong. "Except this one," he says, tapping a sheet. "This one is yours. For a price."',
    choices: [
      { label: (v) => `Buy the chart (${v.c1} gold)`, note: 'Reveal every unknown event room ahead', req: (w, p, v) => w.gold >= v.c1, go: (w, p, v) => { O(w, p, { gold: -v.c1, map: 'reveal', mapN: 99 }); return 'The ink is still wet. The rooms on it are not where you expected.'; } },
      { label: (v) => `Buy a shortcut (${v.c2} gold)`, note: 'A fight ahead becomes a rest site', req: (w, p, v) => w.gold >= v.c2, go: (w, p, v) => { O(w, p, { gold: -v.c2, map: 'rest' }); return 'He crosses out a room with a flourish. "There. Now it is a nice place for a nap."'; } },
      LEAVE('"Your loss," he says, and goes back to drawing.'),
    ], safe: 2, bot: (w, p, v) => (hurt(w, null, 0.5) && w.gold >= v.c2 + 30 ? 1 : 2) });

  add({ id: 'stair', name: 'Collapsed Stair', icon: 'boot', look: 'sign', strata: null, w: 6,
    roll: (r, s) => ({ good: r.chance(0.55), g: 25 + 10 * s }),
    text: (v) => 'The floor gives way to a broken stair spiralling into the dark. Something glints at the bottom. Something else breathes. ' + (v.good ? 'A warm draft rises from below.' : 'The air from below smells of musk.'),
    choices: [
      { label: 'Climb down', note: '???', go: (w, p, v) => { if (v.good) { O(w, p, { relic: 'c' }); return 'The glint is a relic. The breathing was only the wind.'; } O(w, p, { heal: -0.2 }); return 'The breathing was a pit adder. You climb back up with less blood than you went down with.'; } },
      { label: 'Search the rubble', note: (v) => `About ${v.g} gold`, go: (w, p, v) => { O(w, p, { gold: v.g }); return 'Old coins, dropped by older delvers.'; } },
      LEAVE('Some stairs are better left broken.'),
    ], safe: 2, bot: (w, p, v) => (v.good ? 0 : 1) });

  add({ id: 'coffer', name: 'Chained Coffer', icon: 'chest', look: 'chest', strata: null, w: 6,
    roll: (r, s) => ({ g: 30 + 12 * s }),
    text: () => 'A coffer bound in nine chains, each stamped with a warning in a different tongue. All nine say the same thing.',
    choices: [
      { label: 'Break the chains', note: 'A rare relic and a curse', go: (w, p) => { O(w, p, { relic: 'r', curse: true }); return 'The ninth chain parts with a sigh of relief. So does something else.'; } },
      { label: 'Pry a gap', note: (v) => `About ${v.g} gold`, go: (w, p, v) => { O(w, p, { gold: v.g }); return 'You fish out what coins you can reach without opening it.'; } },
      LEAVE('Nine warnings is enough warnings.'),
    ], safe: 2, bot: () => 1 });

  const STATUE = ['knight', 'priest', 'thief'], CLUE = ['Give to the one who never lowered a shield.', 'Give to the one whose hands are clean.', 'Give to the one who would take it anyway.'];
  add({ id: 'statues', name: 'Three Statues', icon: 'eye', look: 'altar', strata: null, w: 6,
    roll: (r, s) => ({ a: r.int(0, 2), g: 10 + 5 * s }),
    text: (v) => `Three statues stand in a row, a knight, a priest and a thief, each holding out an open palm. Words are carved at their feet: "${CLUE[v.a]}"`,
    choices: STATUE.map((who, i) => ({ label: `A coin for the ${who}`, note: (v) => `${v.g} gold: ???`, req: (w, p, v) => w.gold >= v.g,
      go: (w, p, v) => { if (v.a === i) { O(w, p, { gold: -v.g, offer: 'epic' }); return 'The stone fingers close. Somewhere, a lock turns.'; } O(w, p, { gold: -v.g, heal: -0.1 }); return 'The palm snaps shut on your fingers, coin and all.'; } }))
      .concat([LEAVE('You keep your coins and your fingers.')]),
    safe: 3, bot: (w, p, v) => (w.gold >= v.g ? v.a : 3) });

  add({ id: 'pilgrim', name: 'Ember Pilgrim', icon: 'flame', look: 'campfire', strata: null, w: 6,
    roll: (r, s) => ({ g: round5(40 + 15 * s) }),
    text: () => 'A pilgrim tends a small fire of embers that were once delvers. "Trade with the dead," she says. "They are generous, if you are."',
    choices: [
      { label: (v) => `Trade ${v.g} gold`, note: 'A forge: rank up a boon', req: (w, p, v) => w.gold >= v.g, go: (w, p, v) => { O(w, p, { gold: -v.g, offer: 'forge' }); return 'The embers flare and you feel an old skill sharpen.'; } },
      { label: 'Trade 3 max health', note: 'An epic boon', go: (w, p) => { O(w, p, { maxHp: -3, offer: 'epic' }); return 'Some of your warmth goes into the fire. Something of theirs comes back.'; } },
      { label: 'Trade a relic', note: 'Lose a random relic: two boon offers', req: (w, p) => relics(p) > 0, go: (w, p) => { O(w, p, { removeRelic: true, offer: 'boon', offerN: 2 }); return 'The relic melts like wax. The dead are pleased.'; } },
      LEAVE('"Another time," she says.'),
    ], safe: 3, bot: (w, p, v) => (w.gold >= v.g + 50 ? 0 : 3) });

  add({ id: 'library', name: 'Sealed Library', icon: 'scroll', look: 'sign', strata: null, w: 3, rare: true, party: true,
    text: () => 'Shelves of drowned books, preserved by some patient magic. Most crumble at a touch. One shelf hums, and the books on it are warm.',
    choices: [
      { label: 'Read', note: 'A rare lore page and a boon for each hero', go: (w, p) => { O(w, p, { lore: 'rare', offer: 'boon' }); return 'You read until your wicks burn low. Some of it was about you.'; } },
      { label: 'Take the gilded tome', note: 'An epic relic for each hero, and a curse', go: (w, p) => { O(w, p, { relic: 'e', curse: true }); return 'The shelf stops humming. Every book on it turns to face you.'; } },
      LEAVE('You leave the books to their sleep.'),
    ], safe: 0, bot: () => 0 });

  add({ id: 'mirror', name: 'Hollow Mirror', icon: 'mirror', look: 'altar', strata: null, w: 3, rare: true,
    text: () => 'A tall mirror shows the room behind you, but not you. In it, the relics you carry shine brighter than they do in your hands.',
    choices: [
      { label: 'Reach through', note: 'Swap a random relic for a random one a rarity higher', req: (w, p) => relics(p) > 0, go: (w, p) => { upSwap(w, p); return 'Your hand comes back colder, holding something better.'; } },
      { label: 'Shatter it', note: 'An epic boon and a curse', go: (w, p) => { O(w, p, { offer: 'epic', curse: true }); return 'Seven years of something. You are not sure it is luck.'; } },
      LEAVE('You do not like how it watches you leave.'),
    ], safe: 2, bot: (w, p) => (relics(p) > 0 ? 0 : 2) });

  add({ id: 'herald', name: 'The Hollow Herald', icon: 'crown', look: 'trial', strata: [2, 3, 4], w: 3, rare: true, party: true,
    text: () => 'A figure in a crown of black glass bows low. "My king sends his regards, and an offer. Kneel, and be spared a little. Refuse, and be tested."',
    choices: [
      { label: 'Kneel', note: 'A legendary relic and a curse for each hero', go: (w, p) => { O(w, p, { relic: 'l', curse: true }); return '"Wise," says the herald. The crown on his head flickers, hungry.'; } },
      { label: 'Refuse', note: 'An elite fight: an epic boon each and a rare lore page', go: (w, p) => { O(w, p, { fight: 'elite', pay: { offer: 'epic', lore: 'rare' } }); return '"Pity," says the herald, and steps aside for his guard.'; } },
      LEAVE('You ignore him. He is gone when you look again.'),
    ], safe: 2, bot: (w) => (healthy(w) ? 1 : 2) });

  // ================= stratum I: Ossuary =================
  add({ id: 'debt', name: "Gravekeeper's Debt", icon: 'coins', look: 'merchant', strata: [1], w: 10, party: true,
    roll: (r) => ({ g: 60 + 5 * r.int(0, 4) }),
    text: () => 'A gravekeeper with a lantern and a ledger. "Delvers always need coin and never have it. I lend. I collect. Deeper down."',
    choices: [
      { label: (v) => `Borrow ${v.g} gold`, note: 'He will collect, with interest', go: (w, p, v) => { O(w, p, { gold: v.g, flag: 'debt' }); return 'He writes your names in the ledger, very neatly.'; } },
      { label: 'Ask about the dead', note: 'A lore page', go: (w, p) => { O(w, p, { lore: true }); return 'He talks for an hour. Most of it is gossip, some of it is history.'; } },
      LEAVE('"I will be here," he says. "I am always here."'),
    ], safe: 2, bot: () => 1 });

  add({ id: 'collector', name: 'The Collector', icon: 'coins', look: 'merchant', strata: [2, 3], w: 60, party: true, req: (w) => has(w, 'debt'),
    roll: (r, s) => ({ g: 110 + 20 * (s - 2) }),
    text: () => 'The gravekeeper\'s ledger arrives before he does, floating open at your page. "Borrowed in the Ossuary. Interest compounds in the dark."',
    choices: [
      { label: (v) => `Pay ${v.g} gold`, note: 'A lore page for your trouble', req: (w, p, v) => w.gold >= v.g, go: (w, p, v) => { O(w, p, { gold: -v.g, lore: true }); return 'He tears out your page. "A pleasure. Here, something to read."'; } },
      { label: 'Pay in blood', note: 'Each hero loses 3 max health', go: (w, p) => { O(w, p, { maxHp: -3 }); return 'He takes it in a little bone cup, and writes PAID in red.'; } },
      { label: 'Refuse', note: 'His bailiffs are waiting', go: (w, p) => { O(w, p, { fight: 'ambush', pay: { gold: 20 + 10 * w.stratum } }); return 'He sighs, and snaps the ledger shut.'; } },
    ], safe: 1, bot: (w, p, v) => (w.gold >= v.g + 30 ? 0 : healthy(w) ? 2 : 1) });

  add({ id: 'reliquary', name: 'Locked Reliquary', icon: 'chest', look: 'chest', strata: [1], w: 10, party: true,
    roll: (r) => ({ loud: r.chance(0.4) }),
    text: () => 'A reliquary of bone and silver, sealed with a lock shaped like a bell. A bone key hangs beside it on a hook, far too big for the lock.',
    choices: [
      { label: 'Take the bone key', note: 'Somewhere deeper, a lock will fit it', go: (w, p) => { O(w, p, { flag: 'key' }); return 'It is heavy, and faintly wet.'; } },
      { label: 'Smash the reliquary', note: 'A common relic for each hero. The noise will carry.', go: (w, p, v) => { if (v.loud) { O(w, p, { fight: 'ambush', pay: { relic: 'c' } }); return 'The crash echoes down every corridor, and something answers.'; } O(w, p, { relic: 'c' }); return 'Bone and silver everywhere. Nothing comes. This time.'; } },
      LEAVE('You leave it locked.'),
    ], safe: 2, bot: () => 0 });

  add({ id: 'vault', name: 'Drowned Vault', icon: 'chest', look: 'chest', strata: [3], w: 60, party: true, req: (w) => has(w, 'key'),
    text: () => 'A vault door in the shape of a drowned bell. The bone key from the Ossuary turns in it with a sound like a sob.',
    choices: [
      { label: 'Open the vault', note: 'An epic relic for each hero', go: (w, p) => { O(w, p, { relic: 'e' }); return 'The Drowned King\'s tithe, a thousand years unspent.'; } },
      { label: 'Leave the key in the lock', note: 'A rare lore page; the party heals 50%', go: (w, p) => { O(w, p, { lore: 'rare', heal: 0.5 }); return 'The door sighs, and something old is finally allowed to rest.'; } },
    ], safe: 0, bot: () => 0 });

  add({ id: 'choir', name: 'Bone Choir', icon: 'skull', look: 'altar', strata: [1], w: 10, party: true,
    roll: (r) => ({ g: 25 + r.int(0, 10), angry: r.chance(0.35) }),
    text: () => 'A wall of skulls sings in harmony, jaws clacking in time. The song is old and slow, and it wants a voice.',
    choices: [
      { label: 'Join the song', note: 'The party heals 30%; a lore page', go: (w, p) => { O(w, p, { heal: 0.3, lore: true }); return 'Your voices are terrible. The skulls do not mind.'; } },
      { label: 'Pry out the gold teeth', note: (v) => `+${v.g} gold. The choir may object.`, go: (w, p, v) => { O(w, p, { gold: v.g }); if (v.angry) { O(w, p, { curse: true }); return 'The song turns into a single long note, and it follows you.'; } return 'The choir sings on, a little lisping.'; } },
      LEAVE('You let them sing.'),
    ], safe: 2, bot: (w) => (hurt(w, null, 0.8) ? 0 : 2) });

  add({ id: 'scales', name: 'Ossuary Scales', icon: 'hourglass', look: 'altar', strata: [1], w: 10,
    roll: (r) => ({ g: 30 + 5 * r.int(0, 4), win: r.chance(0.5) }),
    text: () => 'A great iron scale. On one pan, a single tooth. On the other, nothing. Carved on the beam: WHAT IS A LIFE WORTH?',
    choices: [
      { label: (v) => `Weigh ${v.g} gold`, note: '???', req: (w, p, v) => w.gold >= v.g, go: (w, p, v) => { if (v.win) { O(w, p, { gold: -v.g, offer: 'epic' }); return 'The pans balance. A drawer slides open in the beam.'; } O(w, p, { gold: -v.g }); return 'The tooth outweighs your gold. The scale keeps it anyway.'; } },
      { label: 'Weigh your blood', note: '-2 max health: a rare relic', go: (w, p) => { O(w, p, { maxHp: -2, relic: 'r' }); return 'Three drops, and the pans balance exactly.'; } },
      LEAVE('Some questions are rhetorical.'),
    ], safe: 2, bot: () => 1 });

  add({ id: 'knight', name: 'Restless Knight', icon: 'shield', look: 'trial', strata: [1], w: 10, party: true,
    text: () => 'A skeleton in rusted plate stands guard over an empty niche. Its sword is missing. It turns its helm toward you and raises its fists.',
    choices: [
      { label: 'Accept the duel', note: 'An elite fight: a forge for each hero and gold', go: (w, p) => { O(w, p, { fight: 'elite', pay: { offer: 'forge', gold: 10 + 5 * w.stratum } }); return 'It salutes. Others step out of the walls to second it.'; } },
      { label: 'Lay it to rest', note: 'The party heals 25%; a lore page', go: (w, p) => { O(w, p, { heal: 0.25, lore: true }); return 'You fold its hands over its chest. It lets you.'; } },
      LEAVE('It watches you all the way to the door.'),
    ], safe: 1, bot: (w) => (healthy(w) ? 0 : 1) });

  const COFFIN = { gold: 'Something inside chinks like coins when it rattles.', relic: 'Light leaks through the cracks in the lid.', ambush: 'Something inside is scratching to get out.' };
  add({ id: 'coffin', name: 'Rattling Coffin', icon: 'skull', look: 'chest', strata: [1], w: 10, party: true,
    roll: (r, s) => ({ k: r.pick(['gold', 'relic', 'ambush']), g: 25 + 10 * s }),
    text: (v) => 'A coffin stands on end in the middle of the room, shaking. ' + COFFIN[v.k],
    choices: [
      { label: 'Open it', note: '???', go: (w, p, v) => { if (v.k === 'gold') { O(w, p, { gold: v.g }); return 'A miser was buried with his savings. He will not miss them.'; } if (v.k === 'relic') { O(w, p, { relic: 'c' }); return 'A saint\'s keepsakes, one for each of you.'; } O(w, p, { fight: 'ambush', pay: { gold: v.g } }); return 'It was not a coffin. It was a door.'; } },
      { label: 'Nail it shut', note: 'A lore page', go: (w, p) => { O(w, p, { lore: true }); return 'Carved inside the lid, a story. You read it before the last nail.'; } },
      LEAVE('You let it rattle.'),
    ], safe: 2, bot: (w, p, v) => (v.k !== 'ambush' || healthy(w) ? 0 : 1) });

  // ================= stratum II: Glowmire =================
  add({ id: 'garden', name: 'Spore Garden', icon: 'leaf', look: 'campfire', strata: [2], w: 10, party: true,
    roll: (r) => ({ c: 30 + 5 * r.int(0, 4), sour: r.chance(0.3) }),
    text: () => 'Glowing caps grow in neat rows here, as if someone still tends them. A seed pod the size of a fist pulses gently in a pot of black loam.',
    choices: [
      { label: (v) => `Nurse the seed (${v.c} gold)`, note: 'Carry it down. It will grow.', req: (w, p, v) => w.gold >= v.c, go: (w, p, v) => { O(w, p, { gold: -v.c, flag: 'seed' }); return 'You buy a pouch of loam from no one and leave the coins in the pot. The seed is warm in your pack.'; } },
      { label: 'Eat the caps', note: 'The party heals 35%; ???', go: (w, p, v) => { O(w, p, { heal: 0.35 }); if (v.sour) { O(w, p, { maxHp: -2 }); return 'Delicious, and then not.'; } return 'Earthy, glowing, and surprisingly filling.'; } },
      LEAVE('You leave the garden to its gardener, wherever they are.'),
    ], safe: 2, bot: (w, p, v) => (w.gold >= v.c + 40 ? 0 : hurt(w, null, 0.6) ? 1 : 2) });

  add({ id: 'bloom', name: 'Bloom in the Deep', icon: 'sun', look: 'campfire', strata: [3], w: 60, party: true, req: (w) => has(w, 'seed'),
    text: () => 'The seed you carried from the Glowmire has split its husk. A flower of pale light opens in the drowned dark, and it is warm.',
    choices: [
      { label: 'Breathe it in', note: 'Full heal and +3 max health for each hero', go: (w, p) => { O(w, p, { heal: 1, maxHp: 3, raise: true }); return 'It smells of the surface, of spring, of home.'; } },
      { label: 'Harvest it', note: 'An epic boon for each hero', go: (w, p) => { O(w, p, { offer: 'epic' }); return 'Each petal is a memory of light. You take them all.'; } },
    ], safe: 0, bot: (w) => (hurt(w, null, 0.6) ? 0 : 1) });

  add({ id: 'hag', name: 'Mire Hag', icon: 'potion', look: 'merchant', strata: [2], w: 10,
    roll: (r, s) => ({ good: r.chance(0.5), g: 20 + 10 * s }),
    text: () => 'A crone stirs a pot that smells of rot and honey. "Everything has a price, dearie. Even the soup. Especially the soup."',
    choices: [
      { label: 'Drink her brew', note: '???', go: (w, p, v) => { if (v.good) { O(w, p, { maxHp: 3, heal: 0.2 }); return 'Vile, and then wonderful.'; } O(w, p, { maxHp: -2, gold: v.g }); return 'Vile, and then worse. She pays you for being a good sport.'; } },
      { label: 'Give her a relic', note: 'Lose a random relic: an epic boon', req: (w, p) => relics(p) > 0, go: (w, p) => { O(w, p, { removeRelic: true, offer: 'epic' }); return 'She drops it in the pot. The soup improves.'; } },
      LEAVE('"Suit yourself," she says, and tastes the spoon.'),
    ], safe: 2, bot: () => 0 });

  add({ id: 'pool', name: 'Glowing Pool', icon: 'drop', look: 'fountain', strata: [2], w: 10, party: true,
    roll: (r, s) => ({ h: 0.35 + 0.05 * r.int(0, 2), g: 30 + 10 * s, sour: r.chance(0.25) }),
    text: () => 'Light pools here like water. Tiny luminous fish swim in it, and at the bottom lies a scatter of coins.',
    choices: [
      { label: 'Bathe', note: (v) => `The party heals ${pc(v.h)}; ???`, go: (w, p, v) => { O(w, p, { heal: v.h }); if (v.sour) { O(w, p, { curse: true }); return 'The light clings to your skin long after you climb out.'; } return 'The fish nibble the grime off your armour.'; } },
      { label: 'Fish out the coins', note: (v) => `About ${v.g} gold`, go: (w, p, v) => { O(w, p, { gold: v.g }); return 'The fish are furious.'; } },
      LEAVE('You leave the pool its coins.'),
    ], safe: 2, bot: (w) => (hurt(w, null, 0.6) ? 0 : 1) });

  add({ id: 'caravan', name: 'Sunken Caravan', icon: 'banner', look: 'chest', strata: [2], w: 10, party: true,
    roll: (r, s) => ({ amb: r.chance(0.5), g: 40 + 15 * s }),
    text: (v) => 'Half a wagon juts from the bog, its oxen long since gone to the mire. The cargo boxes are still lashed down. ' + (v.amb ? 'Bubbles rise in the mud around it, slow and regular, like breathing.' : 'The mud around it is still.'),
    choices: [
      { label: 'Dig out the cargo', note: (v) => `About ${v.g} gold; ???`, go: (w, p, v) => { if (v.amb) { O(w, p, { fight: 'ambush', pay: { gold: v.g, relic: 'c' } }); return 'The mud stands up.'; } O(w, p, { gold: v.g }); return 'Salted coin, a merchant\'s whole fortune.'; } },
      { label: 'Take the map case', note: 'Reveal the event rooms ahead', go: (w, p) => { O(w, p, { map: 'reveal', mapN: 99 }); return 'The merchant knew this road well. Better than you.'; } },
      LEAVE('You leave the bog its wagon.'),
    ], safe: 2, bot: (w, p, v) => (v.amb && !healthy(w) ? 1 : 0) });

  const CAPS = ['red', 'blue', 'gold'], HINT = ['"Not the colour of the deep. Not the colour of greed."', '"Not the colour of blood. Not the colour of greed."', '"Not the colour of blood. Not the colour of the deep."'];
  add({ id: 'oracle', name: 'Fungal Oracle', icon: 'orb', look: 'altar', strata: [2], w: 10,
    roll: (r) => ({ a: r.int(0, 2) }),
    text: (v) => `A mound of fungus with a face in it, ancient and patient. Three caps grow from its crown: red, blue and gold. "Eat the right one," it breathes. ${HINT[v.a]}`,
    choices: CAPS.map((c, i) => ({ label: `Eat the ${c} cap`, note: '???', go: (w, p, v) => { if (v.a === i) { O(w, p, { offer: 'epic', heal: 0.2 }); return 'Visions. Some of them useful.'; } O(w, p, { heal: -0.15 }); return 'Not that one. Definitely not that one.'; } }))
      .concat([LEAVE('"Coward," it breathes, fondly.')]),
    safe: 3, bot: (w, p, v) => v.a });

  add({ id: 'lanternbearer', name: 'The Lantern-Bearer', icon: 'sun', look: 'campfire', strata: [2], w: 10, party: true,
    text: () => 'A lantern-bearer of the old road, lost for a hundred years, still walks the same loop. His light is failing. "Is this the way down?" he asks, every time.',
    choices: [
      { label: 'Walk him to the stair', note: 'Each hero loses 10% health; a forge each and a lore page', go: (w, p) => { O(w, p, { heal: -0.1, offer: 'forge', lore: true }); return 'At the top of the stair he thanks you, and steps down, and is gone.'; } },
      { label: 'Take his lantern', note: 'A rare relic for each hero, and a curse', go: (w, p) => { O(w, p, { relic: 'r', curse: true }); return 'He keeps walking the loop, in the dark now, asking.'; } },
      LEAVE('You point him the wrong way. Everyone does.'),
    ], safe: 2, bot: () => 0 });

  // ================= stratum III: Drowned Sanctum =================
  add({ id: 'ferry', name: 'The Ferryman', icon: 'hand', look: 'merchant', strata: [3], w: 10, party: true,
    roll: (r, s) => ({ c: 40 + 5 * r.int(0, 4), g: 25 + 10 * s }),
    text: () => 'A hooded ferryman waits at the edge of a flooded nave, pole in hand. "The far shore is drier," he says, "and closer to where you are going."',
    choices: [
      { label: (v) => `Pay ${v.c} gold`, note: 'A fight ahead becomes a rest site; the party heals 20%', req: (w, p, v) => w.gold >= v.c, go: (w, p, v) => { O(w, p, { gold: -v.c, heal: 0.2, map: 'rest' }); return 'He poles you across in silence, and lets you off somewhere quiet.'; } },
      { label: 'Swim', note: 'Each hero loses 20% health; gold in the shallows', go: (w, p, v) => { O(w, p, { heal: -0.2, gold: v.g }); return 'Cold, dark and full of teeth. Also coins.'; } },
      LEAVE('"I will wait," he says.'),
    ], safe: 2, bot: (w, p, v) => (hurt(w, null, 0.5) && w.gold >= v.c ? 0 : 2) });

  add({ id: 'tidebell', name: 'Tide Bell', icon: 'bell', look: 'trial', strata: [3], w: 10, party: true,
    text: () => 'A bronze bell hangs from a rotted beam, green with age, half under the water. A rope dangles within reach.',
    choices: [
      { label: 'Ring it', note: 'The drowned answer: an elite fight for a relic each', go: (w, p) => { O(w, p, { fight: 'elite', pay: { relic: 'r', gold: 15 + 5 * w.stratum } }); return 'One note, and the water boils.'; } },
      { label: 'Muffle it', note: 'A lore page; the party heals 20%', go: (w, p) => { O(w, p, { lore: true, heal: 0.2 }); return 'You wrap the clapper in cloth. Somewhere, something goes back to sleep.'; } },
      LEAVE('You do not touch the rope.'),
    ], safe: 1, bot: (w) => (healthy(w) ? 0 : 1) });

  add({ id: 'votive', name: 'Votive Pool', icon: 'gem', look: 'fountain', strata: [3], w: 10,
    roll: (r, s) => ({ g: 40 + 5 * r.int(0, 4), bite: r.chance(0.5), find: 40 + 10 * s }),
    text: () => 'Pilgrims once threw offerings into this pool. The water is so clear you can see every one of them, and the long pale thing that guards them.',
    choices: [
      { label: (v) => `Throw ${v.g} gold`, note: 'A full heal', req: (w, p, v) => w.gold >= v.g, go: (w, p, v) => { O(w, p, { gold: -v.g, heal: 1 }); return 'The water glows where your coins settle.'; } },
      { label: 'Throw a relic', note: 'Swap a random relic for a random one a rarity higher', req: (w, p) => relics(p) > 0, go: (w, p) => { upSwap(w, p); return 'The guardian takes your offering, and returns a better one.'; } },
      { label: 'Reach in', note: '???', go: (w, p, v) => { if (v.bite) { O(w, p, { heal: -0.25 }); return 'The long pale thing was awake.'; } O(w, p, { gold: v.find }); return 'The long pale thing was asleep.'; } },
      LEAVE('You leave the offerings to their keeper.'),
    ], safe: 3, bot: (w, p, v) => (hurt(w, p, 0.5) && w.gold >= v.g ? 0 : relics(p) > 0 ? 1 : 3) });

  add({ id: 'abbot', name: 'The Drowned Abbot', icon: 'chalice', look: 'altar', strata: [3], w: 10,
    text: () => 'The ghost of an abbot kneels in a flooded pew. "I let them ring the bell," he says. "I knew what would answer. Will you hear my confession?"',
    choices: [
      { label: 'Absolve him', note: 'Lift one of your curses; a lore page', go: (w, p) => { const n = O(w, p, { removeRelic: 'curse' }).length; if (!n) O(w, p, { heal: 0.2 }); O(w, p, { lore: true }); return 'He weeps, and something heavy leaves you with him.'; } },
      { label: 'Condemn him', note: 'An epic boon, and a curse', go: (w, p) => { O(w, p, { offer: 'epic', curse: true }); return 'He nods, as if he expected it. His guilt has to go somewhere.'; } },
      LEAVE('You let him pray alone.'),
    ], safe: 2, bot: () => 0 });

  add({ id: 'armory', name: 'Flooded Armory', icon: 'sword', look: 'chest', strata: [3], w: 10,
    roll: (r) => ({ cut: r.chance(0.35) }),
    text: () => 'Racks of weapons stand under a foot of water, most of them rust. A few still shine.',
    choices: [
      { label: 'Dive for the shining ones', note: 'A forge: rank up a boon; ???', go: (w, p, v) => { O(w, p, { offer: 'forge' }); if (v.cut) { O(w, p, { heal: -0.15 }); return 'The water hides edges.'; } return 'A blade worth learning from.'; } },
      { label: 'Take a shield from the rack', note: '+3 max health', go: (w, p) => { O(w, p, { maxHp: 3 }); return 'Dented, but it was made to last.'; } },
      LEAVE('You leave the old arms to the water.'),
    ], safe: 2, bot: () => 0 });

  add({ id: 'clam', name: 'Giant Clam', icon: 'drop', look: 'chest', strata: [3], w: 10,
    roll: (r) => ({ snap: r.chance(0.5) }),
    text: () => 'A clam as big as a cart, its shell parted just a crack. Inside, a pearl the size of a fist glows softly. The shell twitches.',
    choices: [
      { label: 'Grab the pearl', note: '???', go: (w, p, v) => { if (v.snap) { O(w, p, { heal: -0.3 }); return 'It was faster than it looked.'; } O(w, p, { relic: 'r' }); return 'You snatch it and the shell closes on nothing.'; } },
      { label: 'Pry it open slowly', note: 'Lose 10% health: a common relic', req: (w, p) => hpOver(p, 0.1), go: (w, p) => { O(w, p, { heal: -0.1, relic: 'c' }); return 'Slow and steady, and only a little pinched.'; } },
      LEAVE('You leave the clam its pearl.'),
    ], safe: 2, bot: (w, p) => (hpOver(p, 0.6) ? 1 : 2) });

  ED.EVENT_IDS = Object.keys(EV);
})(globalThis.ED || (globalThis.ED = {}));
