// Art coverage check (exit 1 on failure): the built atlas (src/art/meta.js) holds every sprite the game data and code name, and hero palettes stay distinct (swap applied, key colours present).
// Heroes (idle/run/hit + icon), weapons (def.icon, icon.w.<id> for every registered weapon and every def.evo), skills and passives (def.icon, icon.p.<id>),
// foes and bosses (a walk/idle set for def.look), stage themes (floors, deco, obstacles, brazier), pickup kinds (pickup.<k>), icon size (<= 16 x 16),
// and every quoted art id in src/ (except src/art), tools/ and index.html. Run node tools/art.js --check for the build itself.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load } = require('./sim.js');
const ROOT = path.join(__dirname, '..');
const ED = load();
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/art/meta.js'), 'utf8'), { filename: 'src/art/meta.js' });
const A = ED.ART.anims, F = ED.ART.frames;
let fails = 0;
const bad = (msg) => { fails++; console.error('FAIL ' + msg); };
const need = (id, what) => { if (!id || !A[id]) bad(what + ': no anim ' + JSON.stringify(id)); };
const SET = ['.idle', '.walk', '.walk.d', '.walk.0'];
const hasSet = (look) => !!A[look] || SET.some((s) => A[look + s]);

for (const cls of ED.HERO_IDS) {
  const h = ED.HEROES[cls]; if (!h) { bad('hero ' + cls + ' not registered'); continue; }
  for (const st of ['idle', 'run', 'hit']) need('hero.' + cls + '.' + st, 'hero ' + cls);
  need(h.icon, 'hero ' + cls + ' icon');
}
// Hero palettes: every player-colour key colour is present (the co-op recolour finds pixels), and no two heroes share most of their body colours.
const heroPal = (cls) => new Set((ED.ART.pal['hero.' + cls + '.idle'] || []).filter((h) => h !== '#222222'));
for (const cls of ED.HERO_IDS) {
  const sw = ED.ART.swaps && ED.ART.swaps[cls], p = heroPal(cls);
  if (!sw || !sw.key || !sw.key.length) { bad('hero ' + cls + ': no ED.ART.swaps key colours'); continue; }
  for (const k of sw.key) if (!p.has(k)) bad('hero ' + cls + ': key colour ' + k + ' not in hero.' + cls + '.idle');
}
for (let i = 0; i < ED.HERO_IDS.length; i++) for (let j = i + 1; j < ED.HERO_IDS.length; j++) {
  const a = heroPal(ED.HERO_IDS[i]), b = heroPal(ED.HERO_IDS[j]);
  let n = 0; for (const h of a) if (b.has(h)) n++;
  if (n / Math.max(1, Math.min(a.size, b.size)) >= 0.5) bad('heroes ' + ED.HERO_IDS[i] + ' / ' + ED.HERO_IDS[j] + ': ' + n + ' shared body colours (palette swap missing?)');
}
const evos = new Set();
for (const id of ED.WEAPON_IDS) {
  const d = ED.WEAPONS[id];
  need(d.icon, 'weapon ' + id + ' def.icon'); need('icon.w.' + id, 'weapon ' + id);
  if (d.evo) evos.add(d.evo);
}
for (const id of evos) need('icon.w.' + id, 'evolution ' + id);
for (const id of Object.keys(ED.SKILLS || {})) need(ED.SKILLS[id].icon, 'skill ' + id + ' def.icon');
for (const id of ED.PASSIVE_IDS) { need(ED.PASSIVES[id].icon, 'passive ' + id + ' def.icon'); need('icon.p.' + id, 'passive ' + id); }
for (const id of ED.FOE_IDS) {
  const d = ED.FOES[id];
  if (!hasSet(d.look)) bad('foe ' + id + ': no art set for look ' + d.look);
  if (d.boss && /^boss\./.test(d.look)) for (const st of ['idle', 'hit']) need(d.look + '.' + st, 'boss ' + id);
}
for (const s of ED.STAGES) {
  const th = s.theme;
  for (const [id] of th.floor) need(id, 'stage ' + s.id + ' floor');
  for (const id of th.deco) need(id, 'stage ' + s.id + ' deco');
  for (const o of th.features) if (o.look) need(o.look, 'stage ' + s.id + ' obstacle');
  need(th.brazier, 'stage ' + s.id + ' brazier');
}
for (const k of ['xp1', 'xp5', 'xp25', 'gold', 'food', 'magnet', 'bomb', 'chest']) need('pickup.' + k, 'pickup kind ' + k);
need('prop.brazier', 'brazier'); need('prop.brazier.broken', 'broken brazier');
for (const id of Object.keys(A)) if (id.startsWith('icon.')) for (const f of A[id].f) if (F[f].w > 16 || F[f].h > 16) bad(id + ': icon frame ' + F[f].w + 'x' + F[f].h + ' exceeds 16x16');

// Quoted art ids in code and markup.
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (path.relative(ROOT, p) !== path.join('src', 'art')) walk(p); } else if (/\.(js|html)$/.test(f)) files.push(p); } };
walk(path.join(ROOT, 'src')); walk(path.join(ROOT, 'tools')); files.push(path.join(ROOT, 'index.html'));
let refs = 0;
for (const f of files) {
  if (/[\\/]tools[\\/](art|art-manifest|check-art)\.js$/.test(f) || /[\\/]client[\\/](audio|music)\.js$/.test(f)) continue; // audio cue names share the dotted form
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/'((?:tile|prop|deco|pickup|icon|boss|weapon|shield|cos|fx|fxbig|proj|hero|foe)\.[a-z0-9_.]+)'/g)) {
    if (/\.$|\.js$/.test(m[1])) continue; // id prefixes and file names
    refs++; if (!hasSet(m[1])) bad(path.relative(ROOT, f) + ': no anim ' + m[1]);
  }
}
console.log('check-art: ' + Object.keys(A).length + ' anims, ' + ED.WEAPON_IDS.length + ' weapons, ' + evos.size + ' evolutions, ' + refs + ' quoted ids' + (fails ? ', ' + fails + ' FAILED' : ', ok'));
process.exit(fails ? 1 : 0);
