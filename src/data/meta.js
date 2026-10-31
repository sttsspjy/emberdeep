// Meta progression data (GAME-DESIGN §11). Rules are evaluated by src/save.js (ED.Save, ED.Meta).
// ED.SHOP: permanent Camp ranks in save order (append only): { id, name, icon (atlas anim), max, was (former higher max: owned ranks above max, up to was, are refunded on load),
//   stat (ED.Stats key), per (value per rank), cost (rank 1 price), txt }.
//   Price of rank r + 1 (r ranks owned): cost x (r + 1)^2 (ED.shopPrice).
// ED.UNLOCKS: heroes: { cls: rule } where rule is { start } | { survive: s } (one run) | { beat: stage index } | { buy: gold } (Camp purchase) | { pure: true } (win any stage
//   with 0 Camp ranks at run start), txt = the lock line; stages: { index: rule }.
// ED.ACHIEVEMENTS: save order (append only): { id, name, txt, icon ('' = derived from the rule by the UI), gold (paid once when earned), reward (ED.COSMETICS id granted when earned, '' = none), rule }.
//   Rule kinds (ED.Save.achProgress): { time: s } best run time | { beat: i } stage i beaten | { winWith: cls } a win as cls | { form: cls } cls's weapon reached a Form |
//   { runKills: n } own kills in one run | { kills: n } lifetime kills | { level: n } one run | { wins: n } lifetime | { pure: true } a win with 0 Camp ranks |
//   { coop: n } co-op wins | { heroes: true } every hero unlocked | { camp: true } every Camp rank maxed.
(function (ED) {
  'use strict';
  ED.SHOP = [
    { id: 'might', name: 'Might', icon: 'icon.p.might', max: 5, stat: 'might', per: 0.05, cost: 65, txt: '+5% damage' },
    { id: 'vigor', name: 'Vigor', icon: 'icon.p.vigor', max: 5, stat: 'maxHp', per: 10, cost: 35, txt: '+10 max HP' },
    { id: 'plating', name: 'Plating', icon: 'icon.p.plating', max: 3, stat: 'armor', per: 1, cost: 120, txt: '+1 armor' },
    { id: 'mending', name: 'Mending', icon: 'icon.p.mending', max: 5, stat: 'regen', per: 0.1, cost: 40, txt: '+0.1 HP/s regen' },
    { id: 'swiftness', name: 'Swiftness', icon: 'icon.p.swiftness', max: 3, stat: 'speed', per: 0.05, cost: 80, txt: '+5% move speed' },
    { id: 'magnet', name: 'Magnet', icon: 'icon.p.magnet', max: 3, stat: 'pickup', per: 0.1, cost: 40, txt: '+10% pickup radius' },
    { id: 'growth', name: 'Growth', icon: 'fx.spark.magic', max: 5, stat: 'growth', per: 0.05, cost: 55, txt: '+5% XP' },
    { id: 'greed', name: 'Greed', icon: 'pickup.coin', max: 5, stat: 'greed', per: 0.1, cost: 45, txt: '+10% gold' },
    { id: 'fortune', name: 'Fortune', icon: 'icon.p.fortune', max: 5, stat: 'luck', per: 0.05, cost: 45, txt: '+5% luck' },
    { id: 'revival', name: 'Revival', icon: 'fx.shield.gold', max: 1, was: 2, stat: 'revival', per: 1, cost: 550, txt: '+1 revive per run' },
    { id: 'reroll', name: 'Reroll', icon: 'fx.ring.shock', max: 5, stat: 'rerolls', per: 1, cost: 35, txt: '+1 card reroll per run' },
    { id: 'skip', name: 'Skip', icon: 'fx.puff', max: 3, stat: 'skips', per: 1, cost: 35, txt: '+1 card skip per run' },
    { id: 'banish', name: 'Banish', icon: 'fx.sigil.skull', max: 3, stat: 'banishes', per: 1, cost: 65, txt: '+1 card banish per run' },
    { id: 'haste', name: 'Haste', icon: 'icon.p.haste', max: 5, stat: 'haste', per: 0.04, cost: 65, txt: '-4% weapon cooldown' },
    { id: 'reach', name: 'Reach', icon: 'icon.p.reach', max: 5, stat: 'reach', per: 0.05, cost: 55, txt: '+5% area' },
    { id: 'duration', name: 'Duration', icon: 'icon.p.duration', max: 5, stat: 'duration', per: 0.05, cost: 40, txt: '+5% effect duration' },
    { id: 'velocity', name: 'Velocity', icon: 'icon.p.velocity', max: 5, stat: 'velocity', per: 0.06, cost: 35, txt: '+6% projectile speed' },
    { id: 'multishot', name: 'Multishot', icon: 'icon.p.multishot', max: 1, stat: 'amount', per: 1, cost: 4500, txt: '+1 projectile' },
    { id: 'focus', name: 'Focus', icon: 'fx.glint', max: 5, stat: 'focus', per: 0.04, cost: 55, txt: '-4% skill cooldown' },
  ];
  ED.SHOP_IDS = ED.SHOP.map(s => s.id);
  // Price of the next rank of shop row s with r ranks owned (0 when maxed).
  ED.shopPrice = (s, r) => (r < s.max ? s.cost * (r + 1) * (r + 1) : 0);
  ED.UNLOCKS = {
    heroes: {
      knight: { start: true }, ranger: { start: true }, pyro: { start: true },
      necro: { survive: 900, txt: 'Survive 15 minutes' },
      cleric: { beat: 0, txt: 'Beat stage 1' },
      shade: { buy: 4000, txt: 'Buy at Camp for 4000 gold' },
      bell: { pure: true, txt: 'Win any stage with no Camp ranks' },
    },
    stages: { 0: { start: true }, 1: { beat: 0, txt: 'Beat stage 1' }, 2: { beat: 1, txt: 'Beat stage 2' } },
  };
  const HEROES = ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell'];
  const A = (id, name, txt, gold, rule, icon, reward) => ({ id, name, txt, icon: icon || '', gold, reward: reward || '', rule });
  const VICTOR_SKIN = { knight: 'gilded', ranger: 'frost', pyro: 'azure', necro: 'bloodbound', cleric: 'dawn', shade: 'ghost', bell: 'golden' };
  ED.ACHIEVEMENTS = [
    A('time5', 'Still Standing', 'Survive 5 minutes', 50, { time: 300 }),
    A('beat0', 'Ossuary Cleared', 'Beat stage 1', 200, { beat: 0 }),
    A('beat1', 'Glowmire Cleared', 'Beat stage 2', 300, { beat: 1 }),
    A('beat2', 'Abyss Cleared', 'Beat stage 3', 400, { beat: 2 }, '', 'tint.abyss'),
  ].concat(
    HEROES.map(c => A('win.' + c, '', '', 150, { winWith: c }, '', 'skin.' + c + '.' + VICTOR_SKIN[c])), // name / txt from the hero name (ED.Save.achText)
    HEROES.map(c => A('form.' + c, '', '', 100, { form: c })),
    [
      A('kills5k', 'Reaper', 'Kill 5000 foes in one run', 100, { runKills: 5000 }, 'fx.sigil.skull', 'title.reaper'),
      A('kills15k', 'Blender', 'Kill 15000 foes in one run', 200, { runKills: 15000 }, 'fx.sigil.skull', 'title.blender'),
      A('life25k', 'Exterminator', 'Kill 25000 foes in total', 150, { kills: 25000 }, 'fx.blast.red'),
      A('life100k', 'Scourge', 'Kill 100000 foes in total', 300, { kills: 100000 }, 'fx.blast.red'),
      A('life250k', 'Extinction', 'Kill 250000 foes in total', 500, { kills: 250000 }, 'fx.blast.red', 'kill.supernova'),
      A('level40', 'Ascended', 'Reach level 40 in one run', 200, { level: 40 }, 'fx.spark.magic', 'lvl.ascension'),
      A('wins10', 'Veteran', 'Win 10 runs', 300, { wins: 10 }, 'pickup.chest', 'title.veteran'),
      A('pure', 'Purist', 'Win with no Camp ranks', 400, { pure: true }, 'fx.circle.white', 'title.purist'),
      A('coop', 'Fellowship', 'Win a co-op run', 200, { coop: 1 }, 'fx.shield.gold', 'title.companion'),
      A('heroes', 'Full Roster', 'Unlock every hero', 300, { heroes: true }, 'fx.star.stun', 'title.paragon'),
      A('camp', 'Fully Stocked', 'Max every Camp rank', 0, { camp: true }, 'pickup.gold', 'ncol.prism'),
    ]);
  ED.ACH_IDS = ED.ACHIEVEMENTS.map(a => a.id);
})(globalThis.ED || (globalThis.ED = {}));
