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
    if (!/_atk_[hs] r\d/.test(src)) ok(!/×1\.98|×0\.605|×1\.8\b|×0\.55\b/.test(t), `${src}: no fixed fork multipliers (the weapon clamps them): ${t.slice(0, 80)}`); // fork cards print their own weapon's factors (check-sim)
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

// ---------------- dash charges: the shared constant, the stat block, the sheet row and the charge model of Sim.dashTick / Sim.dashTry ----------------
{
  const D = ED.CONST.DASH, S = ED.Sim;
  ok(D.t === 0.15 && D.speed === 480, 'ED.CONST.DASH is 0.15 s at 480 px/s: ' + JSON.stringify(D));
  const base = { cls: 'knight', weapon: 'longsword', boons: {}, relics: [], meta: META(), pact: 0 };
  const st0 = ED.Stats.compute(base);
  ok(st0.dashCd === 1.5 && st0.dashCharges === 1, 'a fresh hero has 1 dash charge, 1.5 s each: ' + st0.dashCd + ' / ' + st0.dashCharges);
  const sm = ED.Stats.compute(Object.assign({}, base, { boons: { lightstep: 2 } }));
  ok(sm.dashCd === 1.5 && sm.dashCharges === 1, 'dashcdr is ignored by the charge stats until it becomes charges');
  const stats = ED.Stats.compute(base); stats.sn = {};
  const p = { pid: 'p', name: 'T', cls: 'knight', weapon: base.weapon, boons: {}, relics: [], meta: base.meta, stats, hp: stats.maxHp, maxHp: stats.maxHp, shield: 0, picks: 0, slot: 0 };
  const sh = ED.Sheet.compute(p, ED.Sheet.ctx ? ED.Sheet.ctx({ stratum: 1, pact: 0, players: new Map(), allies: [] }, p) : {}, { raw: true }).dash;
  ok(sh.cd === 1.5 && sh.charges === 1 && sh.ifr === D.t, 'sheet dash row: recharge per charge, charges, i-frame seconds: ' + JSON.stringify({ cd: sh.cd, charges: sh.charges, ifr: sh.ifr }));
  const run = (c, st, secs) => { let r = 0; for (let i = Math.round(secs / 0.01); i > 0; i--) r += S.dashTick(c, st, 0.01); return r; };
  const mk = (cap) => ({ c: { dashN: cap, dashT: 0 }, st: { dashCharges: cap, dashCd: 1.5 } });
  { // (a) one charge: the second dash in a row is refused
    const { c, st } = mk(1);
    ok(S.dashTry(c, st) === true && S.dashTry(c, st) === false && c.dashN === 0, '1 charge: the first dash passes, the second is refused');
    // (b) a refill after 1.5 s
    run(c, st, 1.45); ok(c.dashN === 0 && S.dashTry(c, st) === false, '1 charge: no dash at 1.45 s');
    const r = run(c, st, 0.1); ok(r === 1 && c.dashN === 1 && c.dashT === 0 && S.dashTry(c, st) === true, '1 charge: a dash is possible again after 1.5 s');
  }
  { // (c) three charges back to back, then one refill per 1.5 s
    const { c, st } = mk(3);
    ok(S.dashTry(c, st) && S.dashTry(c, st) && S.dashTry(c, st) && !S.dashTry(c, st) && c.dashN === 0, '3 charges: three dashes back to back, the fourth is refused');
    const seen = [];
    run(c, st, 1.45); for (let k = 1; k <= 3; k++) { seen.push(c.dashN); run(c, st, 0.1); seen.push(c.dashN); run(c, st, 1.4); } // sampled 0.05 s before and after each 1.5 s mark
    ok(seen.join() === '0,1,1,2,2,3', '3 charges: one charge per 1.5 s, one at a time: ' + seen.join());
    ok(c.dashT === 0 && run(c, st, 5) === 0 && c.dashN === 3, '3 charges: full means the timer rests');
  }
  { // spending while recharging keeps the running timer
    const { c, st } = mk(3);
    S.dashTry(c, st); run(c, st, 1.0); S.dashTry(c, st);
    ok(c.dashN === 1 && Math.abs(c.dashT - 0.5) < 0.02, '3 charges: a second spend does not restart the timer: ' + c.dashT.toFixed(2));
    run(c, st, 0.55); ok(c.dashN === 2, '3 charges: the refill lands 1.5 s after the first spend: ' + c.dashN);
  }
  { // (d) the cap drops from 3 to 1 (stat recalc): the charges clamp; a rise while full starts a refill
    const { c, st } = mk(3);
    st.dashCharges = 1; S.dashTick(c, st, 0);
    ok(c.dashN === 1 && c.dashT === 0, 'dashCharges 3 -> 1 clamps the charges: ' + c.dashN);
    st.dashCharges = 3; run(c, st, 1.45); ok(c.dashN === 1, 'a raised cap starts the timer: still 1 at 1.45 s');
    run(c, st, 0.1); ok(c.dashN === 2, 'a raised cap: +1 charge at 1.5 s: ' + c.dashN);
  }
  { // a long frame carries its overshoot into the next charge
    const { c, st } = mk(3);
    c.dashN = 0; c.dashT = 1.5;
    ok(S.dashTick(c, st, 2.0) === 1 && c.dashN === 1 && Math.abs(c.dashT - 1.0) < 1e-9, 'a 2.0 s frame refills 1 charge and keeps 0.5 s of overshoot: ' + c.dashT);
  }
}

console.log(`${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
