// Stages. ED.STAGES[i] = { id, name, theme, arena, foe, timeline, events, elites, bosses }; index i is the stage number (0 = stage 1).
// theme: { floor: [[tile anim, weight]], deco: [anim ids] (non-colliding scatter), features: [obstacle feature] (src/sim/arena.js), brazier (anim),
//   pal: { bg, wall, accent, light } } (bg: void outside the arena, wall: obstacle fill, accent/light: post grade).
//   feature: { f: 'row' (colonnade) | 'arc' (broken wall with one gap) | 'cluster' (tight clump) | 'single', w (pick weight), look ('' = plain rock disc), r: [min, max], n: [min, max], gap: [min, max] (px between surfaces), spread (cluster radius) }.
// arena: { size, obstacles: [min, max] (colliders), braziers: [min, max], clear (no obstacle within this radius of the centre) }.
// foe: { hp, dmg } stage multipliers on foe HP and contact / shot damage.
// timeline[m] (minute m; the last entry holds for the rest of the run): { rate (spawns/s solo), cap (alive cap solo), floor (density floor, fraction of the alive cap), roster: [[foeId, weight]] }.
// events.swarm: { first, every, ring: [ids], stampede: [ids], n: [at first, at 12:00] } a closing ring or a stampede line of swarmers; elites: { first, every }; bosses: [{ t (s), id, final }].
(function (ED) {
  'use strict';
  const capAt = (m) => Math.round(300 + Math.min(m, 12) * (400 / 12)); // GAME-DESIGN §7: 300 at 0:00 to 700 at 12:00
  const floorAt = (m) => Math.min(0.6, m / 10); // GAME-DESIGN §7: density floor = alive cap x min(0.6, 0.1 x minute)
  // Weight of keyframes [[minute, weight], ...] at minute m: 0 before the first key, linear between keys, the last value after the last key.
  const keyAt = (keys, m) => {
    if (m < keys[0][0]) return 0;
    for (let i = 1; i < keys.length; i++) if (m < keys[i][0]) { const a = keys[i - 1], b = keys[i]; return a[1] + (b[1] - a[1]) * (m - a[0]) / (b[0] - a[0]); }
    return keys[keys.length - 1][1];
  };
  // Builds 16 minute rows from rate[16], roster { id: keyframes } and spikes { minute: { id: extra weight } } (a minute's signature foe).
  const timeline = (rate, roster, spikes) => {
    const out = [];
    for (let m = 0; m <= 15; m++) {
      const rows = [];
      for (const id in roster) { const wt = keyAt(roster[id], m) + ((spikes[m] && spikes[m][id]) || 0); if (wt > 0) rows.push([id, Math.round(wt * 10) / 10]); }
      out.push({ rate: rate[m], cap: capAt(m), floor: floorAt(m), roster: rows });
    }
    return out;
  };
  const ROW = (look, r, n, gap, w) => ({ f: 'row', w, look, r, n, gap });
  const ARC = (look, r, n, gap, w) => ({ f: 'arc', w, look, r, n, gap });
  const CLUSTER = (look, r, n, spread, w) => ({ f: 'cluster', w, look, r, n, spread });
  const ONE = (look, r, w) => ({ f: 'single', w, look, r, n: [1, 1] });

  ED.STAGES = [
    {
      id: 'ossuary', name: 'The Ossuary',
      theme: {
        floor: [['tile.floor.ossuary.1', 40], ['tile.floor.ossuary.2', 6], ['tile.floor.ossuary.3', 6], ['tile.floor.ossuary.4', 4], ['tile.floor.ossuary.5', 3], ['tile.floor.ossuary.6', 3], ['tile.floor.ossuary.7', 2], ['tile.floor.ossuary.8', 2]],
        deco: ['deco.bones.0', 'deco.bones.1', 'deco.bones.2', 'deco.bones.3', 'deco.bones.4', 'deco.skull', 'deco.moss.0', 'deco.moss.1', 'deco.candle.0', 'deco.candle.1', 'deco.puddle.0', 'deco.urn.0', 'deco.urn.1'],
        // colonnades of crypt columns (aisles the horde funnels through), lone pillar stubs, urn heaps, fallen rock
        features: [ROW('prop.pillar', [12, 15], [3, 5], [34, 56], 4), ONE('prop.pillar.broken', [13, 16], 2), CLUSTER('prop.grave.0', [8, 10], [2, 4], 22, 1), CLUSTER('prop.grave.2', [8, 10], [2, 3], 20, 1), ONE('prop.coffin', [9, 11], 1), ONE('prop.bonepile', [12, 14], 1), ONE('prop.ruin.0', [20, 24], 1), ONE('', [24, 38], 1)],
        brazier: 'prop.brazier',
        pal: { bg: '#0b0908', wall: '#2a2320', accent: '#ff8a3d', light: '#ffcf8a' },
      },
      arena: { size: 3200, obstacles: [30, 40], braziers: [14, 20], clear: 220 },
      foe: { hp: 1, dmg: 1 },
      timeline: timeline(
        [1.2, 2.2, 3.5, 5, 6.5, 7.5, 10, 12, 14, 16, 16, 20, 23, 26, 29, 22],
        {
          bat: [[0, 6], [3, 4], [7, 5], [11, 7], [14, 8]],
          skeleton: [[0, 6], [4, 5], [9, 4], [14, 4]],
          slime: [[1, 2], [3, 3], [8, 4], [14, 4]],
          drowned: [[3, 1], [6, 3], [10, 4], [14, 5]],
          priest: [[2, 1], [5, 2], [10, 3], [14, 3]],
          imp: [[3, 1], [6, 2], [11, 3]],
          icewolf: [[4, 1], [7, 2], [12, 3]],
          frostwisp: [[5, 1], [8, 2], [12, 3]],
          skelknight: [[5, 0.6], [8, 1.2], [12, 2]],
        },
        { 2: { slime: 4 }, 4: { priest: 3 }, 6: { icewolf: 5 }, 8: { imp: 4 }, 9: { frostwisp: 5 }, 11: { skelknight: 3 }, 13: { icewolf: 4, imp: 3 } }),
      events: { swarm: { first: 90, every: 90, ring: ['bat'], stampede: ['bat', 'skeleton'], n: [40, 80] } },
      elites: { first: 120, every: 60 },
      bosses: [{ t: 300, id: 'warden' }, { t: 600, id: 'twins' }, { t: 900, id: 'hollow', final: true }],
    },
    {
      id: 'glowmire', name: 'The Glowmire',
      theme: {
        floor: [['tile.floor.glowmire.1', 30], ['tile.floor.glowmire.2', 6], ['tile.floor.glowmire.3', 6], ['tile.floor.glowmire.4', 4], ['tile.floor.glowmire.5', 3], ['tile.floor.glowmire.6', 3]],
        deco: ['deco.mushroom.0', 'deco.mushroom.1', 'deco.mushroom.2', 'deco.mushroom.3', 'deco.root.0', 'deco.root.1', 'deco.moss.2', 'deco.puddle.1', 'deco.puddle.2', 'deco.puddle.3'],
        // broken ruin walls (arcs with one gap), root-choked stumps, glowing crystal pairs, boulders
        features: [ARC('prop.pillar.broken', [13, 16], [4, 6], [6, 14], 4), ONE('prop.shroom.0', [14, 18], 2), CLUSTER('prop.shroom.1', [9, 11], [2, 4], 22, 1), CLUSTER('prop.crystal.0', [12, 15], [2, 3], 22, 2), ONE('prop.crystal.1', [9, 11], 1), ONE('', [26, 40], 1)],
        brazier: 'prop.brazier',
        pal: { bg: '#07090b', wall: '#1d2a2a', accent: '#7fe39a', light: '#c9ffd9' },
      },
      arena: { size: 3200, obstacles: [30, 40], braziers: [14, 20], clear: 220 },
      foe: { hp: 1.3, dmg: 1.15 },
      timeline: timeline(
        [1.4, 2.5, 4, 5.5, 7, 8.5, 11, 13, 15.5, 17.5, 17.5, 22, 25, 28, 32, 24],
        {
          glowlet: [[0, 6], [3, 5], [8, 6], [14, 8]],
          myconid: [[0, 6], [5, 5], [10, 4], [14, 4]],
          glowslime: [[1, 2], [4, 3], [9, 4], [14, 4]],
          cavespider: [[2, 1], [5, 3], [10, 4], [14, 4]],
          spitter: [[3, 1], [6, 2], [10, 3], [14, 3]],
          sporepuff: [[3, 1], [7, 3], [12, 3]],
          reaver: [[4, 1], [8, 3], [13, 4]],
          drone: [[5, 1], [8, 2], [12, 3]],
          shroomhulk: [[5, 0.6], [8, 1.2], [12, 2]],
        },
        { 2: { cavespider: 3 }, 4: { spitter: 3 }, 6: { sporepuff: 5 }, 7: { reaver: 4 }, 9: { drone: 5 }, 11: { shroomhulk: 3 }, 13: { cavespider: 5, spitter: 2 } }),
      events: { swarm: { first: 90, every: 90, ring: ['glowlet'], stampede: ['glowlet', 'myconid'], n: [40, 80] } },
      elites: { first: 120, every: 60 },
      bosses: [{ t: 300, id: 'spore' }, { t: 600, id: 'cyclops' }, { t: 900, id: 'king', final: true }],
    },
    {
      id: 'abyss', name: 'The Abyss',
      theme: {
        floor: [['tile.floor.abyss.1', 30], ['tile.floor.abyss.2', 6], ['tile.floor.abyss.3', 6], ['tile.floor.abyss.4', 4], ['tile.floor.abyss.5', 3], ['tile.floor.abyss.6', 3], ['tile.floor.abyss.7', 2], ['tile.floor.abyss.8', 2]],
        deco: ['deco.crystal.1', 'deco.crystal.2', 'deco.shard.0', 'deco.shard.1', 'deco.shard.2', 'deco.skull', 'deco.chain', 'deco.candle.2'],
        // void crystal clusters, broken colonnades, lone shards
        features: [CLUSTER('prop.crystal.void.0', [12, 16], [3, 6], 34, 4), ROW('prop.obelisk', [9, 11], [2, 4], [40, 70], 2), ONE('prop.crystal.void.1', [9, 11], 1), ONE('prop.ruin.void.0', [20, 24], 1), ONE('prop.ruin.void.2', [13, 15], 1), ONE('', [22, 34], 1)],
        brazier: 'prop.brazier',
        pal: { bg: '#08060c', wall: '#241c33', accent: '#c58aff', light: '#ffc6f0' },
      },
      arena: { size: 3200, obstacles: [30, 40], braziers: [14, 20], clear: 220 },
      foe: { hp: 1.6, dmg: 1.3 },
      timeline: timeline(
        [1.6, 2.8, 4.5, 6, 8, 9.5, 12, 14.5, 17, 19, 19, 24, 27, 31, 35, 26],
        {
          starspawn: [[0, 6], [3, 5], [8, 6], [14, 8]],
          shade: [[0, 6], [5, 5], [10, 5], [14, 5]],
          jelly: [[1, 2], [4, 3], [9, 4], [14, 4]],
          voidwraith: [[2, 1], [5, 2], [10, 3], [14, 3]],
          eel: [[3, 1], [6, 3], [11, 4], [14, 4]],
          gloom: [[3, 1], [7, 3], [12, 3]],
          voideye: [[4, 1], [8, 3], [12, 3]],
          riftcaller: [[6, 0.6], [9, 1.5], [13, 2]],
          horror: [[5, 0.6], [8, 1.2], [12, 2]],
        },
        { 2: { voidwraith: 3 }, 4: { eel: 4 }, 6: { gloom: 5 }, 8: { voideye: 5 }, 9: { riftcaller: 3 }, 11: { horror: 3 }, 13: { eel: 4, gloom: 4 } }),
      events: { swarm: { first: 90, every: 90, ring: ['starspawn'], stampede: ['starspawn', 'shade'], n: [40, 80] } },
      elites: { first: 120, every: 60 },
      bosses: [{ t: 300, id: 'samurai' }, { t: 600, id: 'twins' }, { t: 900, id: 'hollow', final: true }],
    },
  ];
  ED.STAGE_IDS = ED.STAGES.map(s => s.id);
})(globalThis.ED || (globalThis.ED = {}));
