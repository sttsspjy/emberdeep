// Bench report page: build(summary) -> self-contained HTML string (no external files; opens from file://). summary = tools/bench.js summarize() output.
// The page script is client() plus the shared formatters below, injected with Function.prototype.toString; the data is JSON with '<' escaped (cannot close the script tag).
'use strict';

// Seconds -> "m:ss" (total seconds rounded first); '–' for null.
function mmss(s) {
  if (s === null || s === undefined || !isFinite(s)) return '–';
  const t = Math.round(Math.abs(s));
  return (s < 0 ? '−' : '') + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

const CSS = `
:root{--bg:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#6f6d68;--line:#e1e0d9;--axis:#c3c2b7;--accent:#2a78d6;--good:#006300;--bad:#c62f2f;--zebra:#f3f2ee;--mid:#f0efec;--warnbg:#fff4d6;--warnink:#6b4a00;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#a3a198;--line:#2c2c2a;--axis:#383835;--accent:#3987e5;--good:#0ca30c;--bad:#e66767;--zebra:#212120;--mid:#383835;--warnbg:#3a2e10;--warnink:#f3d58a;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1500px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:4px 0 2px}h2{font-size:18px;margin:0 0 4px}
.sub{color:var(--ink2);margin:0 0 12px}
section{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:14px 0}
.note{color:var(--muted);font-size:14px;margin:2px 0 10px}
ul.note{padding-left:18px}ul.note li{margin:2px 0}
.banner{background:var(--warnbg);color:var(--warnink);border-radius:6px;padding:6px 10px;margin:6px 0;font-size:14px;font-weight:600}
.bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0;display:flex;gap:16px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
.bar .banner{margin:0}
.bar label{display:flex;align-items:center;max-width:100%}.bar select{min-width:0;flex:1 1 auto}
label{font-size:14px;color:var(--ink2)}
select{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--axis);border-radius:6px;padding:4px 8px;margin-left:6px;max-width:100%}
.scroll{overflow-x:auto}
table{border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px}
th,td{padding:5px 9px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}
th{color:var(--ink2);font-weight:600;background:var(--surface)}
table.sort th{cursor:pointer;user-select:none}table.sort th:hover{color:var(--ink)}
th[data-dir="1"]::after{content:" ▲"}th[data-dir="-1"]::after{content:" ▼"}
tbody tr:nth-child(even){background:var(--zebra)}
tr.base td{font-weight:600}
.pos{color:var(--good)}.neg{color:var(--bad)}.dim{color:var(--muted)}
.ci{color:var(--muted);font-size:12px;font-weight:400}
td.few{opacity:.45}
table.heat td.c{min-width:66px;text-align:center;padding:4px 6px;border:2px solid var(--surface);line-height:1.15}
table.heat td.c b{display:block;font-size:15px}table.heat td.c i{font-style:normal;font-size:12px;opacity:.85}
table.heat td.c.sig{outline:2px solid var(--ink);outline-offset:-4px}
table.heat td.c.few{opacity:1;color:var(--muted);background:repeating-linear-gradient(45deg,transparent 0 5px,var(--zebra) 5px 10px)}
table.heat th.w{writing-mode:vertical-rl;transform:rotate(180deg);text-align:left;vertical-align:bottom;padding:8px 4px;max-height:140px}
table.heat tbody tr:nth-child(even){background:none}
.legend{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--ink2);margin:8px 0}
.legend .ramp{width:180px;height:12px;border-radius:3px;border:1px solid var(--line)}
table.funnel{width:100%}.funnel td.barcell,.funnel th.barcell{width:40%;min-width:160px;text-align:left}
.fb{height:14px;border-radius:0 4px 4px 0;background:var(--accent);min-width:2px}
.fb.k{background:var(--ink2);opacity:.55;margin-top:2px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px}
.grid2>div,.grid2>section{min-width:0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0;font-size:14px}dt{color:var(--ink2)}dd{margin:0;word-break:break-word}
#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--axis);border-radius:6px;padding:6px 9px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.18);display:none;z-index:9;white-space:pre}
@media (max-width:600px){main{padding:12px 16px}.grid2{grid-template-columns:1fr}}
`;

const BODY = `
<h1>Weapon balance bench</h1>
<p class="sub" id="headline"></p>
<div id="banners"></div>
<div class="bar"><label>Group<select id="grp"></select></label><span class="note" id="grpn"></span><span class="banner" id="sat" hidden>Win % saturated: compare TTK / hurt</span></div>

<section id="howto"><h2>Reading this report</h2><ul class="note">
<li>Win % is the whole build (signature + forced weapon + passives), not the forced weapon alone. Fill off: the bot takes no other weapons; fill on: it also picks up others.</li>
<li><b>Relative strength</b> (primary balance metric): the weapon minus the hero's mean over all forced weapons run on the same stage, hero, seed, meta, fill and skill (baseline excluded; the baseline row shows what no second weapon costs).</li>
<li>Δ vs baseline: the weapon minus the hero's signature-only run on the same tuple. It measures a free second weapon, so it is positive by construction.</li>
<li>Deltas pair only tuples present in both arms (TTK: both won). CI: 95% percentile bootstrap over tuples, <span id="bootn"></span> seeded resamples (deterministic). ● = CI excludes 0. Faded / hatched = fewer than <span id="minp"></span> pairs.</li>
<li>Final TTK: kill time minus spawn time of the last boss slot, won runs only. Boss TTK per slot: all runs that killed it. Hurt/min: damage taken / survival time × 60. Lost survival: mean time of lost runs only (timeouts included).</li>
<li>Dmg share: forced weapon + its evolution over all damage dealt, class skills included (baseline: the signature). Ranking order: win %, Wilson lower bound, final TTK ↑, hurt/min ↑.</li>
</ul></section>

<section id="ranking"><h2>Weapon ranking</h2>
<p class="note">Aggregated over heroes. Win 95% CI: Wilson. Click a header to sort.</p>
<div class="scroll"><table class="sort" id="rankT"></table></div></section>

<section id="heatmap"><h2>Hero × weapon</h2>
<label>Metric<select id="metric"></select></label>
<div class="legend" id="legend"></div>
<div class="scroll"><table class="heat" id="heatT"></table></div></section>

<section id="baseline"><h2>Baseline per hero</h2>
<p class="note">No forced weapon (with fill off: the signature only).</p>
<div class="scroll"><table class="sort" id="baseT"></table></div></section>

<div class="grid2">
<section id="deaths"><h2>Death causes</h2><p class="note">Lost runs only; timeout = survived to maxTime without killing the final boss.</p><div class="scroll"><table class="sort" id="deathT"></table></div>
<h2 id="taken" style="margin-top:16px">Damage taken by source</h2><p class="note">All runs of the group; share of all damage taken, average per run.</p><div class="scroll"><table class="sort" id="takenT"></table></div></section>
<section id="funnel"><h2>Boss funnel</h2><p class="note">Reached: the run lasted to the slot's spawn time (or killed it). Killed: the slot's boss died. Pooled groups use each run's own stage schedule.</p><div class="scroll"><table class="funnel" id="funT"></table></div></section>
</div>

<section id="meta"><h2>Run metadata</h2><dl id="metaL"></dl></section>
<div id="tip"></div>
`;

// Page script; runs in the browser with S = summary.
function client(S) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const nul = (x) => x === null || x === undefined;
  const pct = (x) => nul(x) ? '–' : Math.round(x * 100) + '%';
  // signed number; '±' when the formatted magnitude rounds to zero
  const sg = (x, f) => { if (nul(x)) return '–'; const s = f(Math.abs(x)); return (!/[1-9]/.test(s) ? '±' : x > 0 ? '+' : '−') + s; };
  const tone = (x, good) => nul(x) || x === 0 ? 'dim' : (x > 0) === (good > 0) ? 'pos' : 'neg';
  const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + 'h ' : '') + m + 'm ' + (s % 60) + 's'; };
  const secs = (x) => nul(x) ? '–' : Math.round(x) + ' s';
  const fix1 = (x) => nul(x) ? '–' : x.toFixed(1);
  const wname = (k) => k === 'baseline' ? 'Baseline' : (S.weapons[k] || k);
  const MINP = S.meta.minPairs || 8;
  // Paired-delta metrics: formatter and the sign that is good.
  const DM = { win: { f: x => Math.round(x * 100) + ' pt', good: 1, h: 'win' }, ttk: { f: x => Math.round(x) + ' s', good: -1, h: 'final TTK' }, hurt: { f: x => x.toFixed(1), good: -1, h: 'hurt/min' } };
  const few = (p) => !!p && p.n < MINP;
  const dhtml = (p, m) => !p ? '–' : '<span class="' + tone(p.d, DM[m].good) + '">' + sg(p.d, DM[m].f) + (p.sig ? ' ●' : '') + '</span>' +
    (nul(p.lo) ? '' : '<br><span class="ci">' + sg(p.lo, DM[m].f) + ' … ' + sg(p.hi, DM[m].f) + '</span>');
  const dtext = (p, m) => !p ? '–' : sg(p.d, DM[m].f) + (nul(p.lo) ? '' : ' [' + sg(p.lo, DM[m].f) + ', ' + sg(p.hi, DM[m].f) + ']') + (p.sig ? ' ●' : '') + ' n' + p.n;

  // Sortable table: cols = [{h, v(row) -> sort value, f(row) -> html, c(row) -> class, t: title}]
  function table(el, cols, rows, rowCls) {
    let sortI = -1, dir = 1;
    const draw = () => {
      const rs = rows.slice();
      if (sortI >= 0) rs.sort((a, b) => { const x = cols[sortI].v(a), y = cols[sortI].v(b); if (nul(x)) return 1; if (nul(y)) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
      el.innerHTML = '<thead><tr>' + cols.map((c, i) => '<th data-i="' + i + '"' + (i === sortI ? ' data-dir="' + dir + '"' : '') + (c.t ? ' title="' + esc(c.t) + '"' : '') + '>' + c.h + '</th>').join('') + '</tr></thead><tbody>' +
        rs.map(r => '<tr' + (rowCls && rowCls(r) ? ' class="' + rowCls(r) + '"' : '') + '>' + cols.map(c => '<td' + (c.c && c.c(r) ? ' class="' + c.c(r) + '"' : '') + '>' + c.f(r) + '</td>').join('') + '</tr>').join('') + '</tbody>';
    };
    el.onclick = (e) => { const th = e.target.closest('th'); if (!th) return; const i = +th.dataset.i; if (i === sortI) dir = -dir; else { sortI = i; dir = typeof cols[i].v(rows[0] || {}) === 'string' ? 1 : -1; } draw(); };
    draw();
  }
  const dcol = (ref, m, h, t) => ({ h, t, v: r => r[ref] && r[ref][m] ? r[ref][m].d : null, f: r => dhtml(r[ref] && r[ref][m], m), c: r => few(r[ref] && r[ref][m]) ? 'few' : '' });

  function ranking(g) {
    const slotCols = [];
    for (let i = 0; i < g.slots - 1; i++) slotCols.push({ h: 'Boss ' + (i + 1) + ' TTK', v: r => r.slotTTK[i], f: r => secs(r.slotTTK[i]), t: 'mean kill time - spawn time of slot ' + (i + 1) + ', runs that killed it' });
    table($('rankT'), [
      { h: 'Weapon', v: r => r.name, f: r => esc(r.name) + (r.weapon !== 'baseline' ? ' <span class="dim">' + esc(r.weapon) + '</span>' : '') },
      { h: 'n', v: r => r.n, f: r => r.n, t: 'runs' },
      { h: 'Heroes', v: r => r.heroes, f: r => r.heroes },
      { h: 'Win', v: r => r.win, f: r => pct(r.win) },
      { h: '95% CI', v: r => r.lo, f: r => '<span class="ci">' + pct(r.lo) + '–' + pct(r.hi) + '</span>', t: 'Wilson interval; sorts by the lower bound' },
      dcol('rel', 'win', 'Rel Δ win', 'relative strength: minus the hero mean over forced weapons, same tuple'),
      dcol('rel', 'ttk', 'Rel Δ final TTK', 'relative strength in final-boss TTK (negative = faster), both won'),
      dcol('rel', 'hurt', 'Rel Δ hurt/min', 'relative damage taken per minute (negative = safer)'),
      { h: 'Final TTK', v: r => r.finalTTK, f: r => secs(r.finalTTK), t: 'final boss kill - spawn, won runs' },
      ...slotCols,
      { h: 'Hurt/min', v: r => r.hurtMin, f: r => fix1(r.hurtMin), t: 'damage taken / survival time x 60' },
      { h: 'Lowest HP', v: r => r.hpLow, f: r => pct(r.hpLow), t: 'mean of each run\'s lowest HP fraction' },
      { h: 'Lost', v: r => r.lostN, f: r => r.lostN },
      { h: 'Lost survival', v: r => r.lostTime, f: r => mmss(r.lostTime), t: 'mean survival time of lost runs only' },
      { h: 'Kills/min', v: r => r.killsMin, f: r => r.killsMin.toLocaleString() },
      dcol('base', 'win', 'Δ win vs base', 'minus the hero baseline (signature only), same tuple: a free second weapon'),
      dcol('base', 'ttk', 'Δ TTK vs base'),
      dcol('base', 'hurt', 'Δ hurt vs base'),
      { h: 'Level', v: r => r.level, f: r => fix1(r.level) },
      { h: 'Dmg share', v: r => r.share, f: r => pct(r.share), t: 'forced weapon + evolution / all damage incl. class skills' },
      { h: 'Evolved', v: r => r.evoRate, f: r => pct(r.evoRate), t: 'runs where the weapon evolved' },
      { h: 'Evolve at', v: r => r.evoTime, f: r => mmss(r.evoTime), t: 'mean evolution time of evolved runs' },
    ], g.weapons, r => r.weapon === 'baseline' ? 'base' : '');
  }

  // Colour: sequential = one blue ramp light->dark; diverging = red (worse) <- grey -> blue (better). Numbers are always printed in the cell.
  const SEQ = [[205, 226, 251], [134, 182, 239], [57, 135, 229], [37, 106, 191], [13, 54, 107]];
  const RED = [208, 59, 59], BLUE = [37, 106, 191];
  const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  const seq = (t) => { t = Math.max(0, Math.min(1, t)) * (SEQ.length - 1); const i = Math.min(SEQ.length - 2, Math.floor(t)); return mix(SEQ[i], SEQ[i + 1], t - i); };
  const midRgb = () => { const m = getComputedStyle(document.documentElement).getPropertyValue('--mid').trim().match(/[0-9a-f]{2}/gi); return m ? m.map(h => parseInt(h, 16)) : [240, 239, 236]; };
  const div = (t) => { const m = midRgb(); return t >= 0 ? mix(m, BLUE, Math.min(1, t)) : mix(m, RED, Math.min(1, -t)); };
  const rgb = (c) => 'rgb(' + c.join(',') + ')';
  const inkOn = (c) => { const l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; return l > 0.55 ? '#0b0b0b' : '#ffffff'; };

  // Heatmap metrics: kind 'p' = 0..1 sequential, 'r' = sequential over the group's range, 'd' = paired delta (diverging by good direction).
  const HM = [
    ['win', 'Win %', 'p', c => c.win, pct],
    ['relWin', 'Relative strength: Δ win', 'd', c => c.rel && c.rel.win, null, 'win'],
    ['relTTK', 'Relative: Δ final TTK', 'd', c => c.rel && c.rel.ttk, null, 'ttk'],
    ['relHurt', 'Relative: Δ hurt/min', 'd', c => c.rel && c.rel.hurt, null, 'hurt'],
    ['baseWin', 'Δ win vs hero baseline', 'd', c => c.base && c.base.win, null, 'win'],
    ['finalTTK', 'Final-boss TTK (won runs)', 'r', c => c.finalTTK, secs],
    ['hurtMin', 'Damage taken / min', 'r', c => c.hurtMin, fix1],
    ['lostTime', 'Lost-run survival', 'r', c => c.lostTime, mmss],
    ['share', 'Dmg share', 'p', c => c.share, pct],
    ['evoRate', 'Evolution rate', 'p', c => c.evoRate, pct],
  ];
  $('metric').innerHTML = HM.map(m => '<option value="' + m[0] + '">' + esc(m[1]) + '</option>').join('');
  $('metric').value = 'relWin';

  function heatmap(g) {
    const M = HM.find(m => m[0] === $('metric').value) || HM[0], [, , kind, get, fmt0, dm] = M;
    const ws = g.weapons.map(w => w.weapon).sort((a, b) => (b === 'baseline') - (a === 'baseline'));
    const cells = Object.values(g.cells), vals = [];
    for (const c of cells) { const x = get(c); const v = kind === 'd' ? (x && !few(x) ? x.d : null) : x; if (!nul(v)) vals.push(v); }
    const dmax = Math.max(dm === 'win' ? 0.05 : dm === 'ttk' ? 2 : 0.2, ...vals.map(Math.abs));
    const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
    const fmt = kind === 'd' ? (v) => sg(v, DM[dm].f) : fmt0;
    const colour = (v) => kind === 'd' ? div(v * DM[dm].good / dmax) : kind === 'p' ? seq(v) : seq(hi > lo ? (v - lo) / (hi - lo) : 0.5);
    const lg = kind === 'd' ? 'linear-gradient(90deg,' + rgb(div(-1)) + ',' + rgb(div(0)) + ',' + rgb(div(1)) + ')' : 'linear-gradient(90deg,' + [0, .25, .5, .75, 1].map(t => rgb(seq(t))).join(',') + ')';
    const ends = kind === 'd' ? [sg(-dmax * DM[dm].good, DM[dm].f) + ' (worse)', sg(dmax * DM[dm].good, DM[dm].f) + ' (better)'] : kind === 'p' ? ['0%', '100%'] : [fmt(lo), fmt(hi)];
    $('legend').innerHTML = '<span>' + ends[0] + '</span><span class="ramp" style="background:' + lg + '"></span><span>' + ends[1] + '</span><span class="dim">· cell: value, then n' +
      (kind === 'd' ? ' pairs · ● CI excludes 0 (outlined) · hatched: n < ' + MINP : ' runs and win %') + ' · baseline first, then ranking order · hover for details</span>';
    let h = '<thead><tr><th>Hero</th>' + ws.map(w => '<th class="w">' + esc(wname(w)) + '</th>').join('') + '</tr></thead><tbody>';
    for (const hero of g.heroes) {
      const hn = (S.heroes.find(x => x.id === hero) || {}).name || hero;
      h += '<tr><th style="text-align:left">' + esc(hn) + '</th>';
      for (const w of ws) {
        const c = g.cells[hero + '|' + w];
        if (!c) { h += '<td class="c dim" title="' + esc(hn) + ' × ' + esc(wname(w)) + ': not run">·</td>'; continue; }
        const x = get(c), v = kind === 'd' ? (x ? x.d : null) : x, isFew = kind === 'd' && few(x), sig = kind === 'd' && x && x.sig && !isFew;
        const bg = nul(v) || isFew ? null : colour(v);
        const tip = hn + ' × ' + wname(w) + '\nruns ' + c.n + '   win ' + pct(c.win) + '   final TTK ' + secs(c.finalTTK) + '   hurt/min ' + fix1(c.hurtMin) +
          '\nrel Δ win ' + dtext(c.rel && c.rel.win, 'win') + '\nrel Δ TTK ' + dtext(c.rel && c.rel.ttk, 'ttk') + '\nrel Δ hurt ' + dtext(c.rel && c.rel.hurt, 'hurt') +
          (w === 'baseline' ? '' : '\nvs base: Δ win ' + dtext(c.base && c.base.win, 'win') + '\nvs base: Δ TTK ' + dtext(c.base && c.base.ttk, 'ttk')) + '\ndmg share ' + pct(c.share) + '   evolved ' + pct(c.evoRate);
        const sub = kind === 'd' ? 'n' + (x ? x.n : 0) : 'n' + c.n + ' · ' + (M[0] === 'win' ? secs(c.finalTTK) : pct(c.win));
        h += '<td class="c' + (isFew ? ' few' : '') + (sig ? ' sig' : '') + '" data-tip="' + esc(tip) + '"' + (bg ? ' style="background:' + rgb(bg) + ';color:' + inkOn(bg) + '"' : '') + '><b>' +
          (nul(v) ? '–' : fmt(v)) + (sig ? ' ●' : '') + '</b><i>' + sub + '</i></td>';
      }
      h += '</tr>';
    }
    $('heatT').innerHTML = h + '</tbody>';
  }

  function baseline(g) {
    if (!g.baseline.length) { $('baseT').onclick = null; $('baseT').innerHTML = '<tbody><tr><td class="dim">No baseline runs in this group.</td></tr></tbody>'; return; }
    table($('baseT'), [
      { h: 'Hero', v: r => r.name, f: r => esc(r.name) },
      { h: 'n', v: r => r.n, f: r => r.n },
      { h: 'Win', v: r => r.win, f: r => pct(r.win) },
      { h: '95% CI', v: r => r.lo, f: r => '<span class="ci">' + pct(r.lo) + '–' + pct(r.hi) + '</span>' },
      { h: 'Final TTK', v: r => r.finalTTK, f: r => secs(r.finalTTK) },
      { h: 'Hurt/min', v: r => r.hurtMin, f: r => fix1(r.hurtMin) },
      { h: 'Lowest HP', v: r => r.hpLow, f: r => pct(r.hpLow), t: 'mean of each run\'s lowest HP fraction' },
      { h: 'Lost', v: r => r.lostN, f: r => r.lostN },
      { h: 'Lost survival', v: r => r.lostTime, f: r => mmss(r.lostTime) },
      { h: 'Kills/min', v: r => r.killsMin, f: r => r.killsMin.toLocaleString() },
      { h: 'Level', v: r => r.level, f: r => fix1(r.level) },
      { h: 'Signature share', v: r => r.share, f: r => pct(r.share) },
      { h: 'Sig. evolved', v: r => r.evoRate, f: r => pct(r.evoRate) },
      { h: 'Evolve at', v: r => r.evoTime, f: r => mmss(r.evoTime) },
    ], g.baseline);
  }

  function deaths(g) {
    if (!g.deaths.length) { $('deathT').onclick = null; $('deathT').innerHTML = '<tbody><tr><td class="dim">No lost runs.</td></tr></tbody>'; return; }
    table($('deathT'), [
      { h: 'Cause', v: r => r.cause, f: r => esc(r.cause) },
      { h: 'Deaths', v: r => r.n, f: r => r.n },
      { h: 'Share of losses', v: r => r.pct, f: r => pct(r.pct) },
    ], g.deaths);
  }

  function taken(g) {
    if (!g.taken || !g.taken.length) { $('takenT').onclick = null; $('takenT').innerHTML = '<tbody><tr><td class="dim">No damage-taken data.</td></tr></tbody>'; return; }
    table($('takenT'), [
      { h: 'Source', v: r => r.cause, f: r => esc(r.cause) },
      { h: 'Share', v: r => r.pct, f: r => pct(r.pct) },
      { h: 'Per run', v: r => r.perRun, f: r => r.perRun.toLocaleString() },
    ], g.taken);
  }

  function funnel(g) {
    const n = g.n || 1;
    let h = '<thead><tr><th>Boss</th><th>At</th><th>Reached</th><th>Killed</th><th>Kill / reach</th><th>Mean TTK</th><th class="barcell">of all runs</th></tr></thead><tbody>';
    h += '<tr><td>Start</td><td>0:00</td><td>' + g.n + ' (100%)</td><td>–</td><td>–</td><td>–</td><td class="barcell"><div class="fb" style="width:100%"></div></td></tr>';
    for (const f of g.funnel) h += '<tr><td>' + esc(f.label) + '</td><td>' + mmss(f.t) + '</td><td>' + f.reached + ' (' + pct(f.reached / n) + ')</td><td>' + f.killed + ' (' + pct(f.killed / n) + ')</td><td>' +
      (f.reached ? pct(f.killed / f.reached) : '–') + '</td><td>' + secs(f.ttk) + '</td><td class="barcell" title="reached (blue) / killed (grey)"><div class="fb" style="width:' + (100 * f.reached / n) +
      '%"></div><div class="fb k" style="width:' + (100 * f.killed / n) + '%"></div></td></tr>';
    $('funT').innerHTML = h + '</tbody>';
  }

  function metaList() {
    const M = S.meta, c = M.cfg || {}, hs = Object.entries(M.hashes || {});
    const rows = [['Generated', M.generated], ['Started', M.created], ['Git commit', (M.commits && M.commits.length > 1 ? M.commits.join(', ') : M.commit) || '?'],
      ['Code hash', M.hash + (hs.length ? ' · results: ' + hs.map(([h, n]) => h + ' ×' + n).join(', ') : '')], ['Runner', c.runner || 'tools/bot.js'],
      ['Runs', M.runs + (M.errors ? ' (' + M.errors + ' errors)' : '')], ['Wall time', dur(M.wall) + ' over ' + (M.sessions || []).length + ' session(s)'],
      ['Avg wall time per run', nul(M.avgRunMs) ? '–' : (M.avgRunMs / 1000).toFixed(1) + ' s'],
      ['Stages', c.stages], ['Heroes', c.heroes], ['Weapons', c.weapons + (c.baseline === false ? ' (no baseline)' : ' + baseline')],
      ['Seeds', c.seeds + ' from ' + c.seed0], ['Meta', c.meta], ['Fill', c.fill], ['Skill', nul(c.skill) ? (M.legacy ? '1 (assumed: results predate skill)' : '–') : c.skill], ['Max time', mmss(c.maxTime)],
      ['Bootstrap', M.boot + ' resamples over paired tuples, seeded; min pairs ' + MINP],
      ['Processes', (M.sessions || []).map(s => s.jobs + (s.low ? ' (low priority)' : '') + (s.forced ? ' (--force)' : '')).join(', ')]];
    if (M.fake) rows.push(['Mode', 'stub runner results (not real runs)']);
    $('metaL').innerHTML = rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(nul(v) ? '–' : v) + '</dd>').join('');
    $('headline').textContent = M.runs + ' runs · commit ' + (M.commit || '?') + ' · code ' + M.hash + ' · ' + (M.generated || '').slice(0, 16).replace('T', ' ') + (M.fake ? ' · STUB DATA' : '');
    const b = [];
    if (M.mixed) b.push('Mixed code: results come from ' + hs.length + ' code hashes (' + hs.map(([h, n]) => h + ' ×' + n).join(', ') + '). Deltas may compare different code versions.');
    if (M.legacy) b.push(M.legacy + ' results predate skill and code hash: loaded as skill 1, hash unknown.');
    if (M.fake) b.push('Stub runner data: not real runs.');
    $('banners').innerHTML = b.map(x => '<div class="banner">' + esc(x) + '</div>').join('');
    $('bootn').textContent = M.boot; $('minp').textContent = MINP;
  }

  function render() {
    const g = S.groups[+$('grp').value];
    if (!g) return;
    $('grpn').textContent = g.n + ' runs · overall win ' + pct(g.overall.win) + ' · final TTK ' + secs(g.overall.finalTTK) + ' · hurt/min ' + fix1(g.overall.hurtMin);
    $('sat').hidden = !g.saturated;
    ranking(g); heatmap(g); baseline(g); deaths(g); taken(g); funnel(g);
  }
  $('grp').innerHTML = S.groups.map((g, i) => '<option value="' + i + '">' + esc(g.label) + (g.saturated ? ' (saturated)' : '') + '</option>').join('');
  const first = S.groups.findIndex(g => g.stage < 0);
  $('grp').value = String(Math.max(0, first));
  $('grp').onchange = render; $('metric').onchange = () => heatmap(S.groups[+$('grp').value]);
  const tip = $('tip');
  document.addEventListener('mousemove', (e) => {
    const td = e.target.closest && e.target.closest('[data-tip]');
    if (!td) { tip.style.display = 'none'; return; }
    tip.textContent = td.dataset.tip; tip.style.display = 'block';
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = e.clientY + 16 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  metaList();
  if (S.groups.length) render(); else $('grpn').textContent = 'No results.';
}

function build(S) {
  const data = JSON.stringify(S).replace(/</g, '\\u003c');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Wickdeep Bench Report</title>\n<style>' + CSS + '</style></head>\n<body><main>' +
    BODY + '</main>\n<script>\n"use strict";\n' + mmss.toString() + '\n(' + client.toString() + ')(' + data + ');\n</script>\n</body></html>\n';
}

module.exports = { build, mmss };
