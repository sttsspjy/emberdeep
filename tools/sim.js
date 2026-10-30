// Headless sim loader: runs the sim subset of the game's scripts (FILES, the same order as index.html) in this Node context and returns the ED namespace.
// Usage: const { load, FILES } = require('./sim.js'); const ED = load(); const w = new ED.World({ seed, stage: 0, players: [{ pid: 'p1', cls: 'knight' }] });
// load() starts from a fresh globalThis.ED each call. Main context on purpose: a vm context makes every global read go through an interceptor (~3x slower).
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src') + '/';
const BOSSES = ['warden', 'spore', 'king', 'hollow', 'twins', 'cyclops', 'samurai', 'weaver', 'wickeater'];
const HEROES = ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell'];
const FILES = ['util.js', 'data/foes.js', 'data/stages.js', 'data/passives.js', 'data/meta.js', 'save.js',
  'sim/stats.js', 'sim/arena.js', 'sim/grid.js', 'sim/world.js', 'sim/combat.js', 'sim/foes.js', 'sim/ai.js', 'sim/spawner.js', 'sim/weapons.js', 'sim/skills.js', 'sim/progress.js', 'sim/bosses.js',
  ...BOSSES.map(b => 'sim/boss-' + b + '.js'), ...HEROES.map(h => 'heroes/' + h + '.js'), 'weapons/support-a.js', 'weapons/support-b.js'];
const SRC = new Map();
function load() {
  globalThis.ED = {};
  for (const f of FILES) {
    if (!SRC.has(f)) SRC.set(f, fs.readFileSync(ROOT + f, 'utf8'));
    vm.runInThisContext(SRC.get(f), { filename: f });
  }
  return globalThis.ED;
}
module.exports = { load, FILES, ROOT };
