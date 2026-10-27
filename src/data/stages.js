// Stages. ED.STAGES[i] = { id, name, theme, arena, timeline, events, elites, bosses }; index i is the stage number (0 = stage 1).
// theme: { floor: [[tile anim, weight]], deco: [anim ids] (non-colliding scatter), obstacles: [{look, r:[min,max]}] (look '' = plain rock disc), brazier (anim),
//   pal: { bg, wall, accent, light } } (bg: void outside the arena, wall: obstacle fill, accent/light: post grade).
// arena: { size, obstacles: [min,max], braziers: [min,max], clear (no obstacle within this radius of the centre) }.
// timeline[m] (minute m; the last entry holds for the rest of the run): { rate (spawns/s solo), cap (alive cap solo), roster: [[foeId, weight]] }.
// events.swarm: { first, every, ids, n:[min,max] } a ring or stampede of swarmers; elites: { first, every }; bosses: [{ t (s), id, final }].
(function (ED) {
  'use strict';
  const capAt = (m) => Math.round(300 + Math.min(m, 12) * (400 / 12)); // GAME-DESIGN §7: 300 at 0:00 to 700 at 12:00
  // Placeholder timeline: rate r0 -> r1 over 14 minutes, roster rows [foeId, weight, fromMinute].
  const ramp = (r0, r1, rows) => {
    const out = [];
    for (let m = 0; m <= 15; m++) out.push({ rate: +(r0 + (r1 - r0) * Math.min(1, m / 14)).toFixed(2), cap: capAt(m), roster: rows.filter(r => m >= (r[2] || 0)).map(r => [r[0], r[1]]) });
    return out;
  };
  const T = (rate, m, roster) => ({ rate, cap: capAt(m), roster });

  ED.STAGES = [
    {
      id: 'ossuary', name: 'The Ossuary',
      theme: {
        floor: [['tile.floor.1', 40], ['tile.floor.2', 6], ['tile.floor.3', 6], ['tile.floor.4', 4], ['tile.floor.5', 3], ['tile.floor.6', 3], ['tile.floor.7', 2], ['tile.floor.8', 2]],
        deco: ['deco.bones.0', 'deco.bones.1', 'deco.bones.2', 'deco.bones.3', 'deco.bones.4', 'deco.skull', 'deco.moss.0', 'deco.moss.1', 'deco.candle.0', 'deco.puddle.0'],
        obstacles: [{ look: 'prop.column', r: [12, 16] }, { look: 'deco.pillarstub', r: [12, 18] }, { look: 'deco.urn.0', r: [12, 14] }, { look: '', r: [22, 40] }],
        brazier: 'tile.torch.floor',
        pal: { bg: '#0b0908', wall: '#2a2320', accent: '#ff8a3d', light: '#ffcf8a' },
      },
      arena: { size: 3200, obstacles: [20, 40], braziers: [12, 20], clear: 220 },
      timeline: [
        T(2.0, 0, [['bat', 5], ['skeleton', 5]]),
        T(3.0, 1, [['bat', 5], ['skeleton', 5], ['slime', 2]]),
        T(4.0, 2, [['bat', 4], ['skeleton', 5], ['slime', 2], ['bonearcher', 1]]),
        T(5.0, 3, [['bat', 4], ['skeleton', 5], ['slime', 3], ['bonearcher', 1], ['sporepuff', 1]]),
        T(6.0, 4, [['bat', 4], ['skeleton', 5], ['slime', 3], ['bonearcher', 2], ['sporepuff', 1], ['skelknight', 1]]),
        T(6.0, 5, [['bat', 5], ['skeleton', 5], ['slime', 3], ['bonearcher', 2], ['sporepuff', 1], ['skelknight', 1]]),
        T(8.0, 6, [['bat', 5], ['skeleton', 5], ['slime', 3], ['bonearcher', 2], ['sporepuff', 2], ['skelknight', 1]]),
        T(10.0, 7, [['bat', 5], ['skeleton', 5], ['slime', 4], ['bonearcher', 2], ['sporepuff', 2], ['skelknight', 2]]),
        T(12.0, 8, [['bat', 6], ['skeleton', 5], ['slime', 4], ['bonearcher', 3], ['sporepuff', 2], ['skelknight', 2]]),
        T(14.0, 9, [['bat', 6], ['skeleton', 5], ['slime', 4], ['bonearcher', 3], ['sporepuff', 2], ['skelknight', 2]]),
        T(14.0, 10, [['bat', 6], ['skeleton', 5], ['slime', 4], ['bonearcher', 3], ['sporepuff', 3], ['skelknight', 2]]),
        T(18.0, 11, [['bat', 6], ['skeleton', 5], ['slime', 4], ['bonearcher', 3], ['sporepuff', 3], ['skelknight', 3]]),
        T(22.0, 12, [['bat', 7], ['skeleton', 5], ['slime', 4], ['bonearcher', 3], ['sporepuff', 3], ['skelknight', 3]]),
        T(26.0, 13, [['bat', 7], ['skeleton', 5], ['slime', 5], ['bonearcher', 4], ['sporepuff', 3], ['skelknight', 3]]),
        T(30.0, 14, [['bat', 8], ['skeleton', 5], ['slime', 5], ['bonearcher', 4], ['sporepuff', 3], ['skelknight', 4]]),
        T(20.0, 15, [['bat', 8], ['skeleton', 5], ['slime', 5], ['bonearcher', 4], ['sporepuff', 3], ['skelknight', 4]]),
      ],
      events: { swarm: { first: 90, every: 90, ids: ['bat'], n: [40, 80] } },
      elites: { first: 120, every: 60 },
      bosses: [{ t: 300, id: 'warden' }, { t: 600, id: 'spore' }, { t: 900, id: 'hollow', final: true }],
    },
    {
      id: 'glowmire', name: 'The Glowmire',
      theme: {
        floor: [['tile.dark.floor.1', 30], ['tile.dark.floor.2', 6], ['tile.dark.floor.3', 6], ['tile.dark.floor.4', 4], ['tile.dark.floor.5', 3], ['tile.dark.floor.6', 3]],
        deco: ['deco.mushroom.0', 'deco.mushroom.1', 'deco.mushroom.2', 'deco.mushroom.3', 'deco.root.0', 'deco.root.1', 'deco.moss.2', 'deco.puddle.1', 'deco.puddle.2'],
        obstacles: [{ look: 'deco.pillarstub', r: [12, 18] }, { look: 'deco.crystal.0', r: [12, 14] }, { look: '', r: [22, 40] }],
        brazier: 'tile.torch.floor',
        pal: { bg: '#07090b', wall: '#1d2a2a', accent: '#7fe39a', light: '#c9ffd9' },
      },
      arena: { size: 3200, obstacles: [20, 40], braziers: [12, 20], clear: 220 },
      timeline: ramp(2.2, 32, [['glowlet', 5], ['myconid', 5], ['glowslime', 2, 1], ['cavespider', 3, 2], ['spitter', 2, 3], ['sporepuff', 1, 3], ['shroomhulk', 1, 4]]),
      events: { swarm: { first: 90, every: 90, ids: ['glowlet'], n: [40, 80] } },
      elites: { first: 120, every: 60 },
      bosses: [{ t: 300, id: 'twins' }, { t: 600, id: 'king' }, { t: 900, id: 'cyclops', final: true }],
    },
    {
      id: 'abyss', name: 'The Abyss',
      theme: {
        floor: [['tile.dark.floor.1', 20], ['tile.floor.1', 10], ['tile.dark.floor.4', 4], ['tile.floor.6', 3]],
        deco: ['deco.crystal.1', 'deco.crystal.2', 'deco.shard.0', 'deco.shard.1', 'deco.shard.2', 'deco.skull', 'deco.chain'],
        obstacles: [{ look: 'prop.column', r: [12, 16] }, { look: 'deco.crystal.2', r: [12, 14] }, { look: '', r: [22, 40] }],
        brazier: 'tile.torch.floor',
        pal: { bg: '#08060c', wall: '#241c33', accent: '#c58aff', light: '#ffc6f0' },
      },
      arena: { size: 3200, obstacles: [20, 40], braziers: [12, 20], clear: 220 },
      timeline: ramp(2.5, 34, [['starspawn', 5], ['shade', 5], ['jelly', 2, 1], ['voidwraith', 2, 2], ['sporepuff', 1, 3], ['horror', 1, 4]]),
      events: { swarm: { first: 90, every: 90, ids: ['starspawn'], n: [40, 80] } },
      elites: { first: 120, every: 60 },
      bosses: [{ t: 300, id: 'samurai' }, { t: 600, id: 'twins' }, { t: 900, id: 'hollow', final: true }],
    },
  ];
  ED.STAGE_IDS = ED.STAGES.map(s => s.id);
})(globalThis.ED || (globalThis.ED = {}));
