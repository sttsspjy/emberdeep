// Usage: node tools/sheet.js [--cls=all|knight,ranger,...] [--routes] [--parity [--strict]] [--weapons] [--rank=1,2,3] [--stratum=3] [--pack=4] [--surround] [--mid] [--json]
// The analytic sheet (docs/GAME-DESIGN.md section 10): hero numbers from ED.Sheet.compute for synthetic builds, in milliseconds, before any bot hours are spent.
//   (default)   per class: the fresh hero (weapon, skills with their parts, shares of direct damage, effective health)
//   --routes    per class x route x fork x rank: change in hero damage (one foe | a pack of 4) against the class without the card, for a fresh and a mid build (--mid prints only the mid build),
//               effective health with the uptime of the route's defence, shield income and stun uptime (stuns plus slows, blinds and taunts at their strength)
//   --parity    the power-budget bands on the mid build (ignores --stratum and --rank): stratum III with every fork at rank 2 (boss II grants it), stratum IV at rank 3 (boss III). Per class one line per fork: value (mean of the 1 foe and pack columns, %), the change against the class median, EHP and stun.
//               III rank 2: a non-Guard fork 31.5-38.5, a Guard fork >= 28. IV rank 3: non-Guard 54-66, Guard >= 48 and EHP >= +25% or stun >= 30%. Marks the forks outside; --strict exits 1 when any fork fails
//   --weapons   per weapon (each base weapon, then its Armory variants indented with their change against the base): damage per second on one foe and in a pack of 4 at the class Power, and the damage factor that puts it on the median of the base weapons
// Hero damage = (weapon dps + skill damage per cooldown) x the conditional-damage factor (ED.COND_DMG rows the build owns at assumed uptimes, see COND_NOTE) + status estimates; a pack of 4: melee arcs, blasts, sweeps, waves and ricochets hit all four foes, a fan hits as many as it has arrows; a piercing shot hits the first foe and half of the other foes it could pierce (tools/model.js PIERCE_LINE).
// The mid build: the class element's gate (else Fire) and a second gate, Sharpened Edge x2, Quickened Hands x2, Focus and Stalwart.
const { ED } = require('./sim.js');
const args = {};
for (const a of process.argv.slice(2)) { const m = /^--([a-z0-9]+)(?:=(.*))?$/i.exec(a); if (m) args[m[1]] = m[2] === undefined ? '1' : m[2]; }
const CLS = !args.cls || args.cls === 'all' ? ED.CLASS_IDS : args.cls.split(',');
const RANKS = (args.rank || '1,2,3').split(',').map(Number);
let STRATUM = +(args.stratum || 3); // --parity sets it per pass
const St = ED.Stats;
const M = require('./model.js')(ED, { pack: +(args.pack || 4), surround: !!args.surround }); // hero damage, defence and conditional factor live in the shared model (tools/pick.js reads the same one)
const { packWeapon, directDamage, heroDamage, echoK, defence, condFactor, COND_NOTE } = M, PACK = M.pack;
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const GATE2 = { knight: ['kindle', 'frostbite'], ranger: ['kindle', 'frostbite'], pyro: ['kindle', 'staticcharge'], shade: ['kindle', 'frostbite'], cleric: ['consecrate', 'frostbite'], necro: ['doommark', 'envenom'], bell: ['staticcharge', 'frostbite'] };
const MID = (cls) => Object.assign({}, ...GATE2[cls].map(id => ({ [id]: 1 })), { edge: 2, quick: 2, focus: 1, stalwart: 1 });
const ctx = () => ({ stratum: STRATUM, pact: 0, gold: 0, level: 8, xp: 0, xpNext: 100, dark: false, allyNear: 0, minions: 0, room: null, party: 1, rooms: { seen: 1, total: 10, darkTotal: 2, darkLeft: 2 }, heroes: [], time: 0 });
function hero(cls, wi, boons) {
  const b = { cls, weapon: typeof wi === 'string' ? wi : ED.CLASSES[cls].weapons[wi || 0], boons: boons || {}, relics: [], meta: META(), pact: 0 }; // wi: a weapon index or a weapon id (an Armory variant)
  const stats = St.compute(b);
  return { pid: 'p', name: 'T', cls, weapon: b.weapon, boons: b.boons, relics: b.relics, meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 };
}
const model = (p) => ED.Sheet.compute(p, ctx(), { raw: true });

const pct = (v, d) => (v * 100).toFixed(d === undefined ? 0 : d) + '%';
const f1 = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const sign = (v) => (v >= 0 ? '+' : '') + pct(v, 0);
const rows = [];
const out = (s) => { if (args.json) rows.push(s); else console.log(s); };

// ---- default: the fresh hero ----
if (!args.routes && !args.weapons && !args.parity || args.fresh) {
  for (const cls of CLS) {
    const p = hero(cls), m = model(p), tot = directDamage(m, 1);
    out(`\n== ${ED.CLASSES[cls].name} (Power ${p.stats.power}, ${m.weapon.name}) stratum ${STRATUM}`);
    out(`  weapon  ${f1(m.weapon.dps)} dps one foe | ${f1(directDamage({ weapon: m.weapon, skills: [] }, PACK))} in a pack of ${PACK}   ${m.weapon.extras.map(e => `${e.label} ${f1(e.perAttack)}`).join(', ')}`);
    for (const k of m.skills) {
      out(`  ${pad(k.name, 15)} ${f1(k.perCast)} per cast on one foe (${k.cd.toFixed(1)} s) = ${f1(k.dpsCd)} dps, ${pct(k.dpsCd / tot)} of direct damage`);
      for (const q of k.parts) if (q.kind !== 'zone') out(`      ${pad(q.label, 16)} ${q.kind === 'status' ? 'status ' + f1(q.here) : `hit ${f1(q.here)} x ${q.oneFoe}`}${q.r ? ` r ${q.r}` : ''}${q.note ? '  (' + q.note + ')' : ''}`);
    }
    const d = defence(p, m);
    out(`  weapon share ${pct(m.weapon.dps / tot)} | effective health ${f1(d.ehp)} | statuses ${m.mult.status.map(s => `${s.name} ${f1(s.est.dps || 0)}/s`).join(', ') || '-'}`);
  }
}

// ---- routes ----
// One class under the `base` boons: the base numbers, then per route the route card alone (fork null) and each fork at each of `ranks`; every change is against the class without the route card.
function routeRows(cls, base, ranks) {
  const pb = hero(cls, 0, base), mb = model(pb), db = defence(pb, mb), kb = condFactor(pb, mb, db), b1 = heroDamage(mb, 1, kb), b4 = heroDamage(mb, PACK, kb, echoK(pb, mb, PACK)), rows = [];
  for (const r of ED.ROUTES) {
    const e = ED.CLASS_CARDS[cls][r];
    const add = (name, fork, rank, boons) => {
      const p = hero(cls, 0, boons), m = model(p), d = defence(p, m), k = condFactor(p, m, d), h1 = heroDamage(m, 1, k), h4 = heroDamage(m, PACK, k, echoK(p, m, PACK));
      rows.push({ route: r, name, fork, rank, d1: h1 / b1 - 1, d4: h4 / b4 - 1, ehp: d.ehp / db.ehp - 1, shield: d.shield, stun: d.stun, wdps: m.weapon.dps, s1: m.skills[0].dpsCd, s2: m.skills[1] ? m.skills[1].dpsCd : 0, note: d.note.join('; ') });
    };
    add(`${ED.routeLabel(cls, r)} (${ED.BOONS[e.t1].name})`, null, 0, Object.assign({}, base, { [e.t1]: 1 }));
    for (const fid of e.forks) for (const rank of ranks) add(`   ${ED.BOONS[fid].name} r${rank}`, fid, rank, Object.assign({}, base, { [e.t1]: 1, [fid]: rank }));
  }
  return { b1, b4, ehp: db.ehp, rows };
}
function routeTable(label, boonsFor) {
  out(`\n###### ${label}`);
  out(`  (${COND_NOTE})`);
  for (const cls of CLS) {
    const t = routeRows(cls, boonsFor(cls), RANKS);
    out(`\n== ${ED.CLASSES[cls].name}: base ${f1(t.b1)} one foe | ${f1(t.b4)} pack, effective health ${f1(t.ehp)}`);
    out(`  ${pad('route / fork', 34)} ${rpad('1 foe', 7)} ${rpad('pack', 7)} ${rpad('EHP', 6)} ${rpad('shield/s', 9)} ${rpad('stun', 5)}  weapon dps  skill1  skill2   notes`);
    for (const w of t.rows) out(`  ${pad(w.name, 34)} ${rpad(sign(w.d1), 7)} ${rpad(sign(w.d4), 7)} ${rpad(sign(w.ehp), 6)} ${rpad(pct(w.shield, 2), 9)} ${rpad(pct(w.stun), 5)}  ${rpad(f1(w.wdps), 10)}  ${rpad(f1(w.s1), 6)}  ${rpad(f1(w.s2), 6)}   ${w.note}`);
  }
}
if (args.routes) {
  if (!args.mid) routeTable('fresh build', () => ({}));
  routeTable('mid build (2 gates, Sharpened Edge x2, Quickened Hands x2, Focus, Stalwart)', MID);
}

// ---- parity ----
// Fixed bands on the printed columns (whole percents): the fork value is the mean of the 1 foe and pack columns, the EHP and stun columns are read the same way.
const PARITY = { passes: [{ stratum: 3, rank: 2, lo: 31.5, hi: 38.5, guard: 28 }, { stratum: 4, rank: 3, lo: 54, hi: 66, guard: 48, ehp: 25, stun: 30 }] };
let parityFails = 0;
function parityTable() {
  const col = (v) => +(v * 100).toFixed(0), cpct = (n) => (n >= 0 ? '+' : '') + n + '%';
  for (const P of PARITY.passes) {
    STRATUM = P.stratum;
    out(`\n###### parity: mid build, stratum ${P.stratum}, forks at rank ${P.rank} (value = mean of 1 foe and pack, %; non-Guard ${P.lo}-${P.hi}, Guard >= ${P.guard}${P.ehp ? `, and EHP >= +${P.ehp}% or stun >= ${P.stun}%` : ''}; the median is for information)`);
    for (const cls of CLS) {
      const forks = routeRows(cls, MID(cls), [P.rank]).rows.filter(w => w.fork).map(w => Object.assign(w, { value: (col(w.d1) + col(w.d4)) / 2, guard: ED.BOONS[w.fork].tag === 'Guard', ehpC: col(w.ehp), stunC: col(w.stun) }));
      const v = forks.map(w => w.value).sort((a, b) => a - b), med = (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      out(`\n== ${ED.CLASSES[cls].name}: median ${f1(med)}`);
      out(`  ${pad('fork', 34)} ${rpad('value', 7)} ${rpad('vs med', 7)} ${rpad('EHP', 6)} ${rpad('stun', 5)}`);
      for (const w of forks) {
        const why = [];
        if (!w.guard && (w.value < P.lo || w.value > P.hi)) why.push(`${f1(w.value)} outside ${P.lo}-${P.hi}`);
        if (w.guard && w.value < P.guard) why.push(`${f1(w.value)} below ${P.guard}`);
        if (w.guard && P.ehp && w.ehpC < P.ehp && w.stunC < P.stun) why.push(`EHP ${cpct(w.ehpC)} < +${P.ehp}% and stun ${w.stunC}% < ${P.stun}%`);
        if (why.length) parityFails++;
        out(`  ${pad(w.name.trim() + (w.guard ? ' [Guard]' : ''), 34)} ${rpad(f1(w.value), 7)} ${rpad(sign(w.value / med - 1), 7)} ${rpad(cpct(w.ehpC), 6)} ${rpad(w.stunC + '%', 5)}${why.length ? '  FAIL ' + why.join('; ') : ''}`);
      }
    }
  }
  out(`\n${parityFails} fork${parityFails === 1 ? '' : 's'} outside the bands`);
}
if (args.parity) parityTable();

// ---- weapons ----
if (args.weapons) {
  out(`\n###### weapons at the class Power (dps on one foe | pack of ${PACK} | mean; dmg factor to the class median)`);
  for (const cls of CLS) {
    const list = ED.weaponChoices(cls).map((id) => {
      const p = hero(cls, id), m = model(p), one = m.weapon.dps, pack = packWeapon(m, PACK), hero1 = heroDamage(m, 1, condFactor(p, m, defence(p, m)));
      return { id, name: m.weapon.name, one, pack, mean: (one + pack) / 2, hero1, variant: ED.WEAPONS[id].variant };
    });
    const med = list.filter(w => !w.variant).map(w => w.mean).sort((a, b) => a - b)[1], baseOf = (w) => list.find(x => x.id === w.variant);
    out(`\n== ${ED.CLASSES[cls].name}`);
    for (const w of list) out(`  ${pad((w.variant ? '  ' : '') + w.name, 18)} ${rpad(f1(w.one), 6)} | ${rpad(f1(w.pack), 6)} | ${rpad(f1(w.mean), 6)}   dmg x${(med / w.mean).toFixed(2)}   hero ${f1(w.hero1)} dps${w.variant ? `   vs ${baseOf(w).name} ${sign(w.mean / baseOf(w).mean - 1)}` : ''}`);
  }
}
if (args.json) console.log(JSON.stringify(rows));
if (args.parity && args.strict && parityFails) process.exitCode = 1;
