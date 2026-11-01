// Translation coverage check (exit 1 on failure). Usage: node tools/check-i18n.js [--report] [--warn]
// English sources: display fields (DISPLAY_KEYS) of the data registries (REGISTRIES, loaded with tools/sim.js), the literal card strings of src/sim/progress.js, literal first args
// of ED.t / ED.tr / T calls in src/**/*.js (not src/art, src/i18n) and the data-i18n / data-i18n-attr sources of index.html.
// Tables: src/client/i18n.js + src/i18n/*.js run in a fresh vm context. Per language != 'en': a source is covered by its exact key or its numeric-normalised key (ED.I18N.norm).
// Fails on missing keys (listed in normalised form) and on placeholder mismatches (a translation whose {n} set differs from its key's). Unused keys are listed, never fail.
// --report: every missing key grouped by source. --warn: exit 0 whatever the result.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load } = require('./sim.js');
const ROOT = path.resolve(__dirname, '..'), SRC = path.join(ROOT, 'src');
const REPORT = process.argv.includes('--report'), WARN = process.argv.includes('--warn');
const REGISTRIES = ['HEROES', 'WEAPONS', 'SKILLS', 'PASSIVES', 'SHOP', 'TUNE', 'PATH_STEP', 'FOES', 'STAGES', 'ACHIEVEMENTS', 'UNLOCKS', 'COSMETICS'];
const DISPLAY_KEYS = new Set(['name', 'txt', 'lines', 'desc', 'title', 'label', 'sub', 'tip', 'hint', 'flavor']);

const sources = new Map(); // English string -> Set of source labels
const add = (s, from) => {
  if (typeof s !== 'string') return;
  s = s.replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]/.test(s)) return;
  if (!sources.has(s)) sources.set(s, new Set());
  sources.get(s).add(from);
};

// 1. data registries
const ED = load();
for (const r of REGISTRIES) {
  const walk = (v, key, depth) => {
    if (depth > 8 || v === null || v === undefined || typeof v === 'function') return;
    if (typeof v === 'string') { if (DISPLAY_KEYS.has(key)) add(v, r); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth + 1); return; }
    if (typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], k, depth + 1);
  };
  if (ED[r] === undefined) { console.error('registry ED.' + r + ' missing'); process.exitCode = 1; continue; }
  walk(ED[r], '', 0);
}

// 2. progress.js card literals: name: '...', fallbacks || '...', and '+' + n + ' suffix' templates
const unq = (lit) => vm.runInNewContext(lit);
const prog = fs.readFileSync(path.join(SRC, 'sim', 'progress.js'), 'utf8');
for (const m of prog.matchAll(/\bname: ('(?:\\.|[^'\\])*')/g)) add(unq(m[1]), 'progress.js');
for (const m of prog.matchAll(/\|\| ('(?:\\.|[^'\\])*')/g)) add(unq(m[1]), 'progress.js');
for (const m of prog.matchAll(/\btxt: '([^']*)' \+ [^'\n]+? \+ '([^']*)'/g)) add(m[1] + '1' + m[2], 'progress.js'); // sample number: normalised to {0}

// 3. ED.t / ED.tr / T literal first args in src (generated art and the tables excluded)
const jsFiles = [];
const scan = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (!/^(art|i18n)$/.test(f.name) || dir !== SRC) scan(p); } else if (f.name.endsWith('.js')) jsFiles.push(p); } };
scan(SRC);
const CALL = /(?:\bED\.tr?|(?<![\w.$])T)\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\$])*`)/g;
for (const f of jsFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel === 'src/client/i18n.js') continue;
  for (const m of fs.readFileSync(f, 'utf8').matchAll(CALL)) add(unq(m[1]), rel);
}

// 4. index.html data-i18n / data-i18n-attr sources
const ent = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
  const at = {}; for (const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) at[a[1]] = a[2] === undefined ? '' : ent(a[2]);
  if ('data-i18n' in at) {
    const inner = html.slice(m.index + m[0].length).split('<')[0];
    const s = at['data-i18n'] || ent(inner);
    if (!s.trim()) { console.error('index.html: empty data-i18n source on <' + m[1] + (at.id ? '#' + at.id : '') + '>'); process.exitCode = 1; }
    add(s, 'index.html');
  }
  if (at['data-i18n-attr']) for (const a of at['data-i18n-attr'].split(',').map(x => x.trim())) add(at['data-i18n-' + a] !== undefined ? at['data-i18n-' + a] : at[a], 'index.html');
}

// 5. tables
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(SRC, 'client', 'i18n.js'), 'utf8'), ctx, { filename: 'src/client/i18n.js' });
const tdir = path.join(SRC, 'i18n'), tfiles = fs.existsSync(tdir) ? fs.readdirSync(tdir).filter(f => f.endsWith('.js')).sort() : [];
for (const f of tfiles) vm.runInContext(fs.readFileSync(path.join(tdir, f), 'utf8'), ctx, { filename: 'src/i18n/' + f });
const I = ctx.ED.I18N, langs = Object.keys(I.tables).filter(l => l !== 'en');
if (!langs.length) langs.push('ko');

const phs = (s) => [...new Set([...String(s).matchAll(/\{(\d+)\}/g)].map(m => +m[1]))].sort((a, b) => a - b).join(',');
let bad = 0;
console.log('i18n: ' + sources.size + ' English sources; tables ' + (tfiles.join(', ') || 'none'));
for (const lang of langs) {
  const tb = I.tables[lang] || {}, used = new Set(), miss = new Map(); // normalised key -> sources
  for (const [s, from] of sources) {
    const n = I.norm(s);
    if (tb[s] !== undefined) { used.add(s); continue; }
    if (n.nums.length && tb[n.key] !== undefined) { used.add(n.key); continue; }
    const k = n.nums.length ? n.key : s;
    if (!miss.has(k)) miss.set(k, new Set());
    for (const x of from) miss.get(k).add(x);
  }
  const mism = Object.keys(tb).filter(k => phs(k) !== phs(tb[k]));
  const unused = Object.keys(tb).filter(k => !used.has(k));
  const keys = Object.keys(tb).length, cov = sources.size ? ((sources.size - [...sources.keys()].filter(s => { const n = I.norm(s); return tb[s] === undefined && !(n.nums.length && tb[n.key] !== undefined); }).length) / sources.size * 100) : 100;
  console.log(`${lang}: ${keys} keys, coverage ${cov.toFixed(1)}%, missing ${miss.size}, placeholder mismatches ${mism.length}, unused ${unused.length}`);
  for (const k of mism) console.log(`  MISMATCH ${JSON.stringify(k)} -> ${JSON.stringify(tb[k])}`);
  if (REPORT) {
    const groups = new Map();
    for (const [k, from] of miss) { const g = [...from].sort().join(' + '); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); }
    for (const g of [...groups.keys()].sort()) { console.log(`  missing from ${g} (${groups.get(g).length}):`); for (const k of groups.get(g)) console.log('    ' + JSON.stringify(k)); }
    if (unused.length) { console.log(`  unused (${unused.length}):`); for (const k of unused) console.log('    ' + JSON.stringify(k)); }
  } else {
    if (miss.size) console.log('  first missing: ' + [...miss.keys()].slice(0, 8).map(k => JSON.stringify(k)).join(', ') + (miss.size > 8 ? ' ... (--report lists all)' : ''));
    if (unused.length) console.log('  unused: ' + unused.slice(0, 8).map(k => JSON.stringify(k)).join(', ') + (unused.length > 8 ? ' ...' : ''));
  }
  bad += miss.size + mism.length;
}
if (bad || process.exitCode) { console.log('check-i18n: FAIL' + (WARN ? ' (--warn: exit 0)' : '')); if (!WARN) process.exitCode = 1; else process.exitCode = 0; }
else console.log('check-i18n: ok');
