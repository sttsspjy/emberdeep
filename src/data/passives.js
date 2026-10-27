// Passives (GAME-DESIGN §5). ED.PASSIVES[id] = { id, name, icon (atlas anim), max, per: { statKey: number (x level) | [value at level 1..max] }, txt (one line, card), lines? (card line per level 1..max, overrides txt) }.
// ED.Stats.compute sums `per` into the hero stat block. ED.PASSIVE_IDS order is the save / wire index: append only.
(function (ED) {
  'use strict';
  const P = ED.PASSIVES = {};
  const add = (id, name, icon, per, txt, lines) => { P[id] = { id, name, icon, max: 5, per, txt, lines: lines || null }; };
  add('might', 'Might', 'weapon.longsword', { might: 0.10 }, '+10% damage');
  add('haste', 'Haste', 'pickup.flask.yellow', { haste: 0.08 }, '-8% weapon cooldown');
  add('reach', 'Reach', 'fx.circle.white', { reach: 0.10 }, '+10% area');
  add('velocity', 'Velocity', 'proj.arrow', { velocity: 0.15 }, '+15% projectile speed and range');
  add('duration', 'Duration', 'fx.glint', { duration: 0.12 }, '+12% effect duration');
  add('multishot', 'Multishot', 'proj.knife', { amount: [0, 1, 1, 2, 2] }, '+1 projectile at levels 2 and 4',
    ['Levels 2 and 4: +1 projectile', '+1 projectile on every weapon', 'Level 4: +1 more projectile', '+1 projectile on every weapon', 'Max level']);
  add('vigor', 'Vigor', 'pickup.heart', { maxHp: 20 }, '+20 max HP');
  add('plating', 'Plating', 'shield.round', { armor: 1 }, '+1 armor');
  add('mending', 'Mending', 'pickup.flask.red', { regen: 0.3 }, '+0.3 HP/s regen');
  add('swiftness', 'Swiftness', 'fx.ember', { speed: 0.08 }, '+8% move speed');
  add('magnet', 'Magnet', 'pickup.xp', { pickup: 0.25 }, '+25% pickup radius');
  add('fortune', 'Fortune', 'pickup.coin', { luck: 0.10 }, '+10% luck');
  ED.PASSIVE_IDS = ['might', 'haste', 'reach', 'velocity', 'duration', 'multishot', 'vigor', 'plating', 'mending', 'swiftness', 'magnet', 'fortune'];
})(globalThis.ED || (globalThis.ED = {}));
