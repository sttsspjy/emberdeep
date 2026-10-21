// Usage: node tools/sheet.js [--cls=all|knight,ranger,...] [--routes] [--weapons] [--rank=1,2,3] [--stratum=3] [--mid] [--json]
// The analytic sheet (DESIGN-classes 13.1 step 1): hero numbers from ED.Sheet.compute for synthetic builds, in milliseconds, before any bot hours are spent.
//   (default)   per class: the fresh hero (weapon, skills with their parts, shares of direct damage, effective health)
//   --routes    per class x route x fork x rank: change in hero damage (one foe | a pack of 4) against the class without the card, for a fresh and a mid build (--mid prints only the mid build),
//               effective health with the uptime of the route's defence, shield income and stun uptime
//   --weapons   per weapon: damage per second on one foe and in a pack of 4 at the class Power, and the damage factor that puts it on the class median
// Hero damage = weapon dps + skill damage per cooldown (+ status estimates); a pack of 4: melee arcs, blasts, sweeps, waves and ricochets hit all four foes, a fan hits as many as it has arrows and pierces.
// The mid build: the class element's gate (else Fire) and a second gate, Sharpened Edge x2, Quickened Hands x2, Focus and Stalwart.
const { ED } = require('./sim.js');
const args = {};
for (const a of process.argv.slice(2)) { const m = /^--([a-z0-9]+)(?:=(.*))?$/i.exec(a); if (m) args[m[1]] = m[2] === undefined ? '1' : m[2]; }
const CLS = !args.cls || args.cls === 'all' ? ED.CLASS_IDS : args.cls.split(',');
const RANKS = (args.rank || '1,2,3').split(',').map(Number), STRATUM = +(args.stratum || 3), PACK = 4;
const C = ED.CONST, St = ED.Stats;
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });
const GATE2 = { knight: ['kindle', 'frostbite'], ranger: ['kindle', 'frostbite'], pyro: ['kindle', 'staticcharge'], shade: ['kindle', 'frostbite'], cleric: ['consecrate', 'frostbite'], necro: ['doommark', 'envenom'] };
const MID = (cls) => Object.assign({}, ...GATE2[cls].map(id => ({ [id]: 1 })), { edge: 2, quick: 2, focus: 1, stalwart: 1 });
const ctx = () => ({ stratum: STRATUM, pact: 0, gold: 0, level: 8, xp: 0, xpNext: 100, light: 100, lightMax: 100, tier: 0, deep: null, allyNear: 0, minions: 0, room: null, party: 1, rooms: { seen: 1, total: 10 }, heroes: [], time: 0 });
function hero(cls, wi, boons) {
  const b = { cls, weapon: ED.CLASSES[cls].weapons[wi || 0], boons: boons || {}, relics: [], meta: META(), pact: 0 };
  const stats = St.compute(b);
  return { pid: 'p', name: 'T', cls, weapon: b.weapon, boons: b.boons, relics: b.relics, meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 };
}
const model = (p) => ED.Sheet.compute(p, ctx(), { raw: true });

// ---- hero damage on one foe and in a pack ----
const SWEEP = new Set(['charge.impact', 'charge.shock', 'step.slash', 'judgment.leg', 'shieldthrow.return', 'vanish.ambush']);
function packWeapon(m, n) {
  const w = m.weapon, st = null; void st;
  const hitsBase = w.kind === 'melee' ? n : Math.min(n, (w.n || 1) * (1 + (w.pierce || 0)));
  let sum = w._avg * hitsBase;
  for (const e of w._extras) sum += e.perAttack * (e.label === 'Twin Fang' ? hitsBase / (w.oneFoe || 1) : n);
  return sum * w._aps;
}
function directDamage(m, n) {
  if (n === 1) return m.weapon.dps + m.skills.reduce((s, k) => s + k.dpsCd, 0);
  let sum = packWeapon(m, n);
  for (const k of m.skills) for (const q of k.parts) {
    if (q.kind === 'zone') continue;
    const key = k.id + '.' + q.id;
    let mul = q.r > 0 || SWEEP.has(key) ? n : 1;
    if (key === 'volley.arrow') mul = Math.min(n, q.fanN * 2) / Math.max(1, q.oneFoe);
    if (key === 'shieldthrow.strike') mul = Math.min(n, 4 + 2);
    if (q.kind === 'minion') mul = 1;
    if (key === 'vanish.ambush') mul = (m.weapon.kind === 'melee' ? n : Math.min(n, m.weapon.n)) / Math.max(1, q.oneFoe);
    sum += q._r.total * mul / k._cd;
  }
  return sum;
}
const statusDamage = (m) => m.mult.status.reduce((s, x) => s + (x.est && x.est.dps || 0), 0);
const heroDamage = (m, n) => directDamage(m, n) + statusDamage(m);

// ---- defence: effective health with the uptime of a guard ----
function defence(p, m) {
  const st = p.stats, out = { ehp: m.def.ehp, note: [] };
  let keep = 1;
  if (st.braceDR) {
    const N = St.skillNums('charge', st), up = Math.min(1, st.brace / Math.max(C.BRACE_CD, N.cdEff)), dr = Math.min(0.4, st.braceDR);
    keep *= 1 - dr * up; out.note.push(`Brace -${Math.round(dr * 100)}% x ${Math.round(up * 100)}% uptime`);
  }
  if (p.cls === 'cleric') {
    const N = St.skillNums('sanctuary', st), z = N.p.zone, up = Math.min(1, z.dur / N.cdEff), dr = Math.min(0.4, 0.15 + st.sanctDR);
    keep *= 1 - dr * up; out.note.push(`Sanctuary -${Math.round(dr * 100)}% x ${Math.round(up * 100)}% uptime`);
  }
  out.ehp = m.def.ehp / keep;
  // shield income (percent of max health per second, before the window caps)
  let inc = 0;
  const cd1 = St.skillNums(ED.CLASSES[p.cls].skill, st).cdEff, cd2 = St.skillNums(ED.CLASSES[p.cls].skill2, st).cdEff;
  if (p.cls === 'knight') { const n = St.skillNums('shieldthrow', st).p.strike.n; inc += Math.min(C.CATCH_MAX, C.CATCH_PER * n) / Math.max(C.KWARD_CD, cd2); }
  if (st.rally) inc += st.rally / Math.max(8, cd1);
  if (st.mantle) inc += st.mantle / Math.max(10, cd1);
  if (st.veil) inc += st.veil / Math.max(12, cd2);
  if (st.boneArmor) inc += Math.min(st.boneCap, st.boneArmor * 3) / Math.max(12, cd2);
  out.shield = Math.min(inc, C.SHIELD_WIN_CLASS / C.SHIELD_WIN_T);
  // trash stun uptime: each source stuns the foe for dur, then its stun cooldown (dur + STUN_DR) must pass
  let stun = 0;
  const src = [];
  if (p.cls === 'knight') { const q = St.skillNums('charge', st).p.impact; src.push([q.stun + st.chargeStun, cd1]); src.push([St.skillNums('shieldthrow', st).p.strike.stun, cd2]); }
  if (st.cShock && st.cStun) src.push([st.cStun, (3 + st.cleaveN) * m.weapon.interval]);
  if (st.sanctStun) src.push([st.sanctStun, cd1]);
  if (st.waveStun && m.weapon.fork) src.push([st.waveStun, 3 * m.weapon.interval]);
  for (const [d, cd] of src) stun += Math.min(1, d / Math.max(cd, d + C.STUN_DR));
  out.stun = Math.min(1, stun);
  return out;
}

const pct = (v, d) => (v * 100).toFixed(d === undefined ? 0 : d) + '%';
const f1 = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const sign = (v) => (v >= 0 ? '+' : '') + pct(v, 0);
const rows = [];
const out = (s) => { if (args.json) rows.push(s); else console.log(s); };

// ---- default: the fresh hero ----
if (!args.routes && !args.weapons || args.fresh) {
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
function routeTable(label, boonsFor) {
  out(`\n###### ${label}`);
  for (const cls of CLS) {
    const base = boonsFor(cls), pb = hero(cls, 0, base), mb = model(pb), b1 = heroDamage(mb, 1), b4 = heroDamage(mb, PACK), db = defence(pb, mb);
    out(`\n== ${ED.CLASSES[cls].name}: base ${f1(b1)} one foe | ${f1(b4)} pack, effective health ${f1(db.ehp)}`);
    out(`  ${pad('route / fork', 34)} ${rpad('1 foe', 7)} ${rpad('pack', 7)} ${rpad('EHP', 6)} ${rpad('shield/s', 9)} ${rpad('stun', 5)}  weapon dps  skill1  skill2   notes`);
    for (const r of ED.ROUTES) {
      const e = ED.CLASS_CARDS[cls][r];
      const emit = (name, boons) => {
        const p = hero(cls, 0, boons), m = model(p), d = defence(p, m), h1 = heroDamage(m, 1), h4 = heroDamage(m, PACK);
        out(`  ${pad(name, 34)} ${rpad(sign(h1 / b1 - 1), 7)} ${rpad(sign(h4 / b4 - 1), 7)} ${rpad(sign(d.ehp / db.ehp - 1), 6)} ${rpad(pct(d.shield, 2), 9)} ${rpad(pct(d.stun), 5)}  ${rpad(f1(m.weapon.dps), 10)}  ${rpad(f1(m.skills[0].dpsCd), 6)}  ${rpad(f1(m.skills[1] ? m.skills[1].dpsCd : 0), 6)}   ${d.note.join('; ')}`);
      };
      emit(`${ED.routeLabel(cls, r)} (${ED.BOONS[e.t1].name})`, Object.assign({}, base, { [e.t1]: 1 }));
      for (const fid of e.forks) for (const rank of RANKS) emit(`   ${ED.BOONS[fid].name} r${rank}`, Object.assign({}, base, { [e.t1]: 1, [fid]: rank }));
    }
  }
}
if (args.routes) {
  if (!args.mid) routeTable('fresh build', () => ({}));
  routeTable('mid build (2 gates, Sharpened Edge x2, Quickened Hands x2, Focus, Stalwart)', MID);
}

// ---- weapons ----
if (args.weapons) {
  out(`\n###### weapons at the class Power (dps on one foe | pack of ${PACK} | mean; dmg factor to the class median)`);
  for (const cls of CLS) {
    const list = ED.CLASSES[cls].weapons.map((id, wi) => {
      const m = model(hero(cls, wi)), one = m.weapon.dps, pack = packWeapon(m, PACK), hero1 = heroDamage(m, 1);
      return { id, name: m.weapon.name, one, pack, mean: (one + pack) / 2, hero1 };
    });
    const med = list.map(w => w.mean).sort((a, b) => a - b)[1];
    out(`\n== ${ED.CLASSES[cls].name}`);
    for (const w of list) out(`  ${pad(w.name, 18)} ${rpad(f1(w.one), 6)} | ${rpad(f1(w.pack), 6)} | ${rpad(f1(w.mean), 6)}   dmg x${(med / w.mean).toFixed(2)}   hero ${f1(w.hero1)} dps`);
  }
}
if (args.json) console.log(JSON.stringify(rows));
