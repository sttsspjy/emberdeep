// Stages. ED.STAGES[i] = { id, name, theme, arena, foe, gold, timeline, events, elites, bench, bosses }; index i is the stage number (0 = stage 1).
// theme: { floor: [[tile anim, weight]], deco: [anim ids] (non-colliding scatter), features: [obstacle feature] (src/sim/arena.js), brazier (anim),
//   pal: { bg, wall, accent, light } } (bg: void outside the arena, wall: obstacle fill, accent/light: post grade).
//   feature: { f: 'row' (colonnade) | 'arc' (broken wall with one gap) | 'cluster' (tight clump) | 'single', w (pick weight), look ('' = plain rock disc), r: [min, max], n: [min, max], gap: [min, max] (px between surfaces), spread (cluster radius) }.
// arena: { size, obstacles: [min, max] (colliders), braziers: [min, max], clear (no obstacle within this radius of the centre) }.
// foe: { hp, dmg } stage multipliers on foe and boss HP and on contact / shot damage. gold: multiplier on elite, boss and victory gold (GAME-DESIGN §9).
// Roster tiers: each stage's 0:00-5:00, 5:00-10:00 and 10:00-15:00 rosters differ (early kinds fade to weight 0, two new kinds per stage at 5:00 and 10:00); the swarmer joins at 1:00.
// timeline[m] (minute m; the last entry holds for the rest of the run): { rate (spawns/s solo), cap (alive cap solo), floor (density floor, fraction of the alive cap), roster: [[foeId, weight]] }.
// events.swarm: { first, every, ring: [ids], stampede: [ids] (used when in the current roster), n: [at first, at 12:00] } a closing ring or a stampede line of swarmers; elites: { first, every };
// bench: { t (s), elite (s between elites) } the benchmark phase (HP-heavy roster, density floor 0.7, a 'surge' warning); bosses: [{ t (s), id, final }].
(function (ED) {
  'use strict';
  const capAt = (m) => Math.round(m < 3 ? 80 + 70 * m : 300 + (Math.min(m, 12) - 3) * (400 / 9)); // GAME-DESIGN §7: 80 / 150 / 220 at 0:00-2:00, 300 at 3:00 to 700 at 12:00
  const floorAt = (m) => (m < 1 ? 0 : m >= 12 ? 0.7 : Math.min(0.6, (m + 1) / 20)); // GAME-DESIGN §7: density floor = alive cap x min(0.6, 0.05 x (minute + 1)) from 1:00 (none at 0:00), 0.7 from 12:00
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
  // Spawn rate per minute (solo spawns/s; GAME-DESIGN §7), shared by the stages (stage 3 x1.05); BENCH: the 12:00-15:00 benchmark phase.
  const RATE = [1.2, 2.2, 3.3, 4.5, 5.8, 7, 9.5, 12, 14, 16, 16.5, 19, 21, 23, 25, 22];
  const BENCH = { t: 720, elite: 30 };
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
      arena: { size: 3200, obstacles: [30, 40], braziers: [40, 55], clear: 220 },
      foe: { hp: 1, dmg: 1 }, gold: 1,
      timeline: timeline(
        RATE,
        {
          bat: [[1, 1], [3, 4], [7, 5], [11, 6]],
          skeleton: [[0, 9], [3, 7], [5, 3], [7, 0]],
          slime: [[1, 2], [3, 3], [5, 2], [7, 0]],
          priest: [[1, 1], [3, 2], [8, 2], [10, 0]],
          imp: [[2, 1], [4, 2], [6, 1], [8, 0]],
          drowned: [[4, 1], [6, 4], [10, 4], [12, 3]],
          icewolf: [[5, 2], [7, 3], [10, 2], [11, 0]],
          frostwisp: [[6, 1], [8, 3], [10, 1], [11, 0]],
          bulwark: [[5, 2], [7, 3], [11, 3], [13, 4]],
          skelknight: [[5, 0.6], [8, 1], [10, 2], [12, 3]],
          bonecaller: [[10, 1], [11, 2]],
        },
        { 2: { slime: 3 }, 4: { imp: 2 }, 6: { bulwark: 3 }, 8: { frostwisp: 3 }, 11: { bonecaller: 2 }, 13: { skelknight: 2 } }),
      events: { swarm: { first: 120, every: 90, ring: ['bat'], stampede: ['bat', 'skeleton', 'drowned'], n: [24, 80] } },
      elites: { first: 150, every: 60 }, bench: BENCH,
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
      arena: { size: 3200, obstacles: [30, 40], braziers: [40, 55], clear: 220 },
      foe: { hp: 0.85, dmg: 1 }, gold: 1.5,
      timeline: timeline(
        RATE,
        {
          glowlet: [[1, 1], [3, 5], [8, 6]],
          myconid: [[0, 9], [3, 7], [5, 3], [7, 0]],
          glowslime: [[1, 2], [3, 3], [5, 2], [7, 0]],
          spitter: [[1, 1], [3, 2], [8, 2], [10, 0]],
          sporepuff: [[2, 1], [4, 2], [6, 1], [8, 0], [10, 0], [11, 2]],
          reaver: [[4, 1], [6, 3], [10, 4], [13, 4]],
          cavespider: [[5, 2], [7, 3], [10, 2], [11, 0]],
          drone: [[6, 1], [8, 3], [10, 1], [11, 0]],
          bloater: [[5, 2], [7, 3], [11, 2]],
          shroomhulk: [[5, 0.6], [8, 1], [10, 2], [12, 3]],
          mirecrab: [[10, 0.6], [11, 1], [13, 1.5]],
        },
        { 2: { glowslime: 3 }, 4: { spitter: 2 }, 6: { bloater: 3 }, 8: { drone: 3 }, 11: { mirecrab: 1 }, 13: { shroomhulk: 2 } }),
      events: { swarm: { first: 120, every: 90, ring: ['glowlet'], stampede: ['glowlet', 'myconid', 'reaver'], n: [24, 80] } },
      elites: { first: 150, every: 60 }, bench: BENCH,
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
      arena: { size: 3200, obstacles: [30, 40], braziers: [40, 55], clear: 220 },
      foe: { hp: 0.9, dmg: 1 }, gold: 2,
      timeline: timeline(
        RATE.map(r => Math.round(r * 1.05 * 10) / 10),
        {
          starspawn: [[1, 1], [3, 5], [8, 6]],
          shade: [[0, 9], [3, 7], [5, 3], [7, 0]],
          jelly: [[1, 2], [3, 3], [5, 2], [7, 0]],
          voidwraith: [[1, 1], [3, 2], [8, 2], [10, 0]],
          gloom: [[2, 1], [4, 2], [6, 1], [8, 0], [10, 0], [11, 3]],
          eel: [[4, 1], [6, 3], [10, 2], [11, 0]],
          voideye: [[6, 1], [8, 3], [10, 1], [11, 0]],
          stalker: [[5, 2], [7, 3], [11, 3]],
          horror: [[5, 0.6], [8, 1], [10, 2], [12, 3]],
          riftcaller: [[9, 0.5], [10, 2]],
          colossus: [[10, 0.6], [11, 1], [13, 1.5]],
        },
        { 2: { jelly: 3 }, 4: { voidwraith: 2 }, 6: { stalker: 3 }, 8: { voideye: 3 }, 11: { colossus: 1 }, 13: { horror: 2 } }),
      events: { swarm: { first: 120, every: 90, ring: ['starspawn'], stampede: ['starspawn', 'shade', 'stalker'], n: [24, 80] } },
      elites: { first: 150, every: 60 }, bench: BENCH,
      bosses: [{ t: 300, id: 'samurai' }, { t: 600, id: 'weaver' }, { t: 900, id: 'wickeater', final: true }],
    },
  ];
  ED.STAGE_IDS = ED.STAGES.map(s => s.id);
})(globalThis.ED || (globalThis.ED = {}));
