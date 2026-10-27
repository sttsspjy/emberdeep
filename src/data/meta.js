// Meta progression data (GAME-DESIGN §11). Rules are evaluated by src/save.js (ED.Save, ED.Meta).
// ED.SHOP: permanent Camp ranks in save order (append only): { id, name, icon (atlas anim), max, stat (ED.Stats key), per (value per rank), txt }. Cost of the next rank: SHOP_BASE x (rank + 1).
// ED.UNLOCKS: heroes: { cls: rule } where rule is { start } | { survive: s } | { beat: stage index } | { kills: n } (one run) | { level: n } (one run), txt = the lock line; stages: { index: rule };
//   sigAfterRun: a hero's signature weapon joins the general pool after that hero's first finished run.
(function (ED) {
  'use strict';
  ED.SHOP_BASE = 200;
  ED.SHOP = [
    { id: 'might', name: 'Might', icon: 'icon.p.might', max: 5, stat: 'might', per: 0.05, txt: '+5% damage' },
    { id: 'vigor', name: 'Vigor', icon: 'icon.p.vigor', max: 5, stat: 'maxHp', per: 10, txt: '+10 max HP' },
    { id: 'plating', name: 'Plating', icon: 'icon.p.plating', max: 3, stat: 'armor', per: 1, txt: '+1 armor' },
    { id: 'mending', name: 'Mending', icon: 'icon.p.mending', max: 5, stat: 'regen', per: 0.1, txt: '+0.1 HP/s regen' },
    { id: 'swiftness', name: 'Swiftness', icon: 'icon.p.swiftness', max: 3, stat: 'speed', per: 0.05, txt: '+5% move speed' },
    { id: 'magnet', name: 'Magnet', icon: 'icon.p.magnet', max: 3, stat: 'pickup', per: 0.1, txt: '+10% pickup radius' },
    { id: 'growth', name: 'Growth', icon: 'fx.spark.magic', max: 5, stat: 'growth', per: 0.05, txt: '+5% XP' },
    { id: 'greed', name: 'Greed', icon: 'pickup.coin', max: 5, stat: 'greed', per: 0.1, txt: '+10% gold' },
    { id: 'fortune', name: 'Fortune', icon: 'icon.p.fortune', max: 5, stat: 'luck', per: 0.05, txt: '+5% luck' },
    { id: 'revival', name: 'Revival', icon: 'fx.shield.gold', max: 2, stat: 'revival', per: 1, txt: '+1 revive per run' },
    { id: 'reroll', name: 'Reroll', icon: 'fx.ring.shock', max: 5, stat: 'rerolls', per: 1, txt: '+1 card reroll per run' },
    { id: 'skip', name: 'Skip', icon: 'fx.puff', max: 3, stat: 'skips', per: 1, txt: '+1 card skip per run' },
    { id: 'banish', name: 'Banish', icon: 'fx.sigil.skull', max: 3, stat: 'banishes', per: 1, txt: '+1 card banish per run' },
  ];
  ED.SHOP_IDS = ED.SHOP.map(s => s.id);
  ED.UNLOCKS = {
    heroes: {
      knight: { start: true }, ranger: { start: true }, pyro: { start: true },
      necro: { survive: 600, txt: 'Survive 10 minutes' },
      cleric: { beat: 0, txt: 'Beat stage 1' },
      shade: { kills: 3000, txt: 'Kill 3000 foes in one run' },
      bell: { level: 40, txt: 'Reach level 40 in one run' },
    },
    stages: { 0: { start: true }, 1: { beat: 0, txt: 'Beat stage 1' }, 2: { beat: 1, txt: 'Beat stage 2' } },
    sigAfterRun: true,
  };
})(globalThis.ED || (globalThis.ED = {}));
