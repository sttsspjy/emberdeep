// Usage: node tools/check-ux.js
// Headless checks of player-facing text and layout data: the tutorial signs near the spawn, no developer units or stale fixed multipliers in card texts, the Doom/Toll wording,
// Shield Storm and Comet in the sheet model, the Sundered status. Prints failures and exits 1 when any check fails.
const { ED } = require('./sim.js');
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const META = () => ({ up: ED.UPGRADES.map(() => 0), mastery: 1, relics: [] });

// ---------------- tutorial signs: the aim sign is the one nearest the solo spawn ----------------
{
  const w = new ED.World({ seed: 5, pact: 0, tutorial: true, players: [{ pid: 'p0', name: 'T', slot: 0, cls: 'knight', weapon: 'longsword', meta: META() }] });
  w.startRun();
  const me = w.players.get('p0'), signs = w.props.filter(q => q.kind === 'sign').map(q => ({ text: q.text, d: Math.hypot(q.x - me.x, q.y - me.y) })).sort((a, b) => a.d - b.d);
  ok(signs.length === 5, 'five tutorial signs: ' + signs.length);
  ok(/^Aim with \{aim\}/.test(signs[0].text) && signs[0].d <= 90, 'the sign within reach of the spawn is the mouse-aim sign: ' + signs[0].text.slice(0, 30) + ' at ' + Math.round(signs[0].d) + ' px');
  ok(signs.slice(1).every(s => s.d > 0), 'the other signs stand apart');
  const last = signs.find(s => /skull/.test(s.text));
  ok(last && /\{map\} opens your build/.test(last.text) && !/shows the map/.test(last.text), 'the map sign names the sheet: ' + (last && last.text));
}

// ---------------- card and skill texts ----------------
{
  const texts = [];
  const add = (src, t) => { if (t) texts.push([src, String(t)]); };
  const st = ED.Stats.compute({ cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 });
  for (const id in ED.BOONS) for (let r = 1; r <= (ED.BOONS[id].max || 1); r++) add(id + ' r' + r, ED.Sheet.text(id, r, st)); // route cards at rank 3 include their rider
  for (const id in ED.SKILLS) add('skill ' + id, ED.SKILLS[id].desc);
  for (const id in ED.WEAPONS) add('weapon ' + id, ED.WEAPONS[id].desc);
  for (const id in ED.RELICS) add('relic ' + id, ED.RELICS[id].desc);
  for (const id in ED.STATUS) add('status ' + id, ED.STATUS[id].rule);
  for (const u of ED.UPGRADES) { add('upgrade ' + u.id, u.step); add('upgrade ' + u.id + ' desc', typeof u.desc === 'function' ? u.desc(1) : u.desc); }
  for (const [src, t] of texts) {
    ok(!/±|\brad\b/.test(t), `${src}: no angles in radians: ${t.slice(0, 80)}`);
    ok(!/\(r\d|\br \d/.test(t), `${src}: radii read "radius N": ${t.slice(0, 80)}`);
    ok(!/×1\.98|×0\.605|×1\.8\b|×0\.55\b/.test(t), `${src}: no fixed fork multipliers (the weapon clamps them): ${t.slice(0, 80)}`);
    ok(!/Skill recharges/.test(t), `${src}: "Skills recharge": ${t.slice(0, 80)}`);
    ok(!/\{|\}|\[|\]/.test(t), `${src}: no left-over token: ${t.slice(0, 80)}`);
  }
  ok(/never Reaped/.test(ED.BOONS.doommark.desc) && /Tolls/.test(ED.BOONS.doommark.desc) && /never Reaped/.test(ED.STATUS.doom.rule), 'Doom: a boss is never Reaped, it Tolls');
  ok(/Open boons can rank 1 higher/.test(ED.BOONS.generalist.desc) && /Your hits mark 40% more Doom/.test(ED.RELICS.wispjar.desc), 'Generalist and Soul Jar wording');
  ok(/foes inside take Holy damage/.test(ED.SKILLS.sanctuary.desc) && !/burn/i.test(ED.SKILLS.sanctuary.desc), 'Sanctuary does not burn');
  ok(/does not stack with other \+20% vulnerabilities/.test(ED.boonText('r_s2_b', 1, null)) && !/Judged/.test(ED.boonText('r_s2_b', 1, null)), 'Hail of Thorns does not lean on the Cleric term');
  ok(/Crush/.test(ED.SKILLS.charge.desc) && /never stunned/.test(ED.SKILLS.shieldthrow.desc), 'Shield Charge and Shield Throw name Crush and the boss rule');
  ok(/class shields are limited to 3% of max health per 10 s/.test(ED.WEAPONS.lantern.desc) && !/once per 1\.5s each/.test(ED.WEAPONS.lantern.desc), 'Sacred Lantern names the class-shield window');
  ok(ED.boonText('r_el_b', 2, null).indexOf('within 120') >= 0 && ED.boonText('r_el_b', 1, null).indexOf('within 100') >= 0, 'Contagion shows its total radius per rank');
}

// ---------------- sheet: statuses and the model of the two fork effects ----------------
{
  ok(ED.STATUS.sundered && ED.STATUS.sundered.name === 'Sundered' && ED.STATUS.sundered.color !== ED.STATUS.marked.color, 'ED.STATUS.sundered exists apart from Marked');
  const model = (cls, boons) => {
    const b = { cls, weapon: ED.CLASSES[cls].weapons[0], boons, relics: [], meta: META(), pact: 0 }, stats = ED.Stats.compute(b);
    stats.sn = {};
    const p = { pid: 'p', name: 'T', cls, weapon: b.weapon, boons, relics: [], meta: b.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 };
    return ED.Sheet.compute(p, ED.Sheet.ctx ? ED.Sheet.ctx({ stratum: 1, pact: 0, players: new Map(), allies: [] }, p) : {}, { raw: true });
  };
  const sunder = model('shade', { sunder: 1 }).mult.debuffs.find(d => /Sunder|critical hit/.test(d.text));
  ok(sunder && sunder.id === 'sundered' && sunder.name === 'Sundered', 'Sunder files under Sundered, not Marked: ' + (sunder && sunder.id));
  const part = (m, s, id) => m.skills[s].parts.find(q => q.id === id);
  const k0 = model('knight', { k_s2: 1 }), k1 = model('knight', { k_s2: 1, k_s2_a: 1 });
  ok(Math.abs(part(k1, 1, 'strike').raw - 0.7 * part(k0, 1, 'strike').raw) < 1e-6 && part(k1, 1, 'strike').oneFoe === 2, 'Shield Storm: two shields at 70% each in the strike part');
  ok(k1.skills[1].perCast > k0.skills[1].perCast * 1.2, 'Shield Storm raises the Shield Throw per cast: ' + k0.skills[1].perCast.toFixed(1) + ' -> ' + k1.skills[1].perCast.toFixed(1));
  const m0 = model('pyro', { p_s2: 1 }), m3 = model('pyro', { p_s2: 1, p_s2_b: 3 });
  ok(Math.abs(part(m3, 1, 'impact').raw / part(m0, 1, 'impact').raw - 1.5) < 1e-6, 'Comet rank 3: impact x1.5: ' + (part(m3, 1, 'impact').raw / part(m0, 1, 'impact').raw).toFixed(3));
  ok(part(model('knight', {}), 1, 'strike').r === 0 && part(model('knight', {}), 1, 'return').r === 0, 'projectile hit radii stay out of the sheet parts');
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
