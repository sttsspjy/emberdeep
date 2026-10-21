// Usage: node tools/journey.js [botSkill] [seed] [--journeys=N] [--until=win|done] [--pick=smart|random]   (V=1 for per-run detail)
// Simulates a player's whole journey: fresh profile -> runs -> rewards -> purchases, until the first victory (--until=win) or until everything is unlocked.
// Runs use the smart pick policy; --journeys=N repeats the journey with N seeds and prints the first-victory hours of each.
const { runBot, ED } = require('./sim.js');
const S = ED.Save, U = ED.U;
const HUMAN = 1.35; // menus, reading, shopping, walking: humans take longer than the bot
const flags = {}, args = [];
for (const a of process.argv.slice(2)) { const m = /^--([a-z]+)(?:=(.*))?$/i.exec(a); if (m) flags[m[1]] = m[2] === undefined ? '1' : m[2]; else args.push(a); }
const skill = +(args[0] || 0.7), seed0 = +(args[1] || 1), journeys = +(flags.journeys || 1), until = flags.until || 'done', pick = flags.pick || 'smart';

function journey(seed0, quiet) {
  const p = S.defaultProfile();
  let total = 0, runs = 0, rooms = 0, roomsTotal = 0; const marks = {};
  const mark = (k) => { if (!marks[k]) marks[k] = { run: runs, hours: total / 3600 }; };
  while (runs < 140) {
    const unlocked = ED.CLASS_IDS.filter(c => S.classUnlocked(p, c));
    // play the least-mastered unlocked hero, like a curious player
    unlocked.sort((a, b) => p.mastery[ED.CLASS_IDS.indexOf(a)] - p.mastery[ED.CLASS_IDS.indexOf(b)]);
    const cls = runs % 3 === 2 ? unlocked[0] : unlocked[Math.min(unlocked.length - 1, runs % unlocked.length)];
    const ml = S.masteryLevel(p, cls);
    const wi = ml >= 6 ? 2 : ml >= 3 ? 1 : 0;
    const pact = p.stats.wins > 0 ? p.pactMax : 0;
    const r = runBot({ seed: seed0 * 1000 + runs * 13, n: 1, cls: [cls], weapon: wi, skill, up: p.up.slice(), mastery: ml, pact, tutorial: p.stats.runs < 2, pick, relics: ED.RELIC_IDS.filter(id => S.relicUnlocked(p, id)) });
    runs++; total += r.time * HUMAN + 45; // + time in the Hearth between runs
    const sum = r.sum; sum.cls = cls;
    rooms += r.rooms.visited; roomsTotal += r.rooms.total;
    const res = S.applyRun(p, sum); if (process.env.V && !quiet) console.log(`  run ${runs} ${cls} s${sum.stratum}${sum.victory ? " WIN" : ""} ${U.fmtTime(r.time)} +${res.rewards.total} embers (${res.rewards.lines.map(l => l[0].slice(0, 6) + ":" + l[1]).join(" ")}) deeds +${res.deeds.reduce((a, d) => a + d.reward, 0)} ups ${p.up.reduce((a, b) => a + b, 0)}`);
    if (sum.bosses & 1) mark('first Bone Warden kill');
    if (sum.bosses & 4) mark('first Rimeheart kill');
    if (sum.victory) mark('first victory');
    if (p.deeds & (1 << ED.DEED_IDX.evolved)) mark('first evolution');
    if (p.deeds & (1 << ED.DEED_IDX.cartographer)) mark('first full clear');
    if (p.deeds & (1 << ED.DEED_IDX.intothedark)) mark('first Lightless boss');
    if (p.pactWin >= 3) mark('won pact 3');
    if (p.pactWin >= 6) mark('won pact 6');
    // spend: cheapest available upgrade or relic first
    for (let guard = 0; guard < 50; guard++) {
      const opts = [];
      ED.UPGRADES.forEach((u, i) => { if (S.upgradeAvailable(p, u) && p.up[i] < u.costs.length) opts.push({ cost: u.costs[p.up[i]], buy: () => S.buyUpgrade(p, u.id) }); });
      ED.RELIC_IDS.forEach(id => { const d = ED.RELICS[id]; if (!S.relicUnlocked(p, id) && d.cost && S.relicReqMet(p, id)) opts.push({ cost: d.cost * 1.3, buy: () => S.unlockRelic(p, id) }); });
      opts.sort((a, b) => a.cost - b.cost);
      if (!opts.length || !opts[0].buy()) break;
    }
    S.checkDeeds(p, null);
    if (ED.CLASS_IDS.every(c => S.classUnlocked(p, c))) mark('all heroes unlocked');
    const upsDone = ED.UPGRADES.every((u, i) => p.up[i] >= u.costs.length);
    const relicsDone = ED.RELIC_IDS.every(id => S.relicUnlocked(p, id));
    if (upsDone) mark('all Hearth upgrades');
    if (relicsDone) mark('all relics');
    if (runs % 10 === 0 && !quiet) console.log(`run ${runs} ${U.fmtTime(total)} deepest ${p.stats.deepest} wins ${p.stats.wins} pactMax ${p.pactMax} embers ${p.embers} lifetime ${p.lifetime} ups ${p.up.reduce((a, b) => a + b, 0)} last: ${cls} s${sum.stratum} ${sum.victory ? 'WIN' : ''} ${U.fmtTime(r.time)}`);
    if (until === 'win' ? sum.victory : upsDone && relicsDone && p.pactWin >= 10) break;
  }
  return { p, marks, total, runs, rooms, roomsTotal };
}

if (journeys > 1) {
  const hours = [], nruns = [];
  for (let j = 0; j < journeys; j++) {
    const r = journey(seed0 + j, true);
    const m = r.marks['first victory'];
    hours.push(m ? m.hours : Infinity); nruns.push(m ? m.run : Infinity);
    console.log(`journey ${j} (seed ${seed0 + j}): first victory ${m ? `run ${m.run} @ ${m.hours.toFixed(2)}h` : 'none in ' + r.runs + ' runs'}`);
  }
  const done = hours.filter(Number.isFinite).sort((a, b) => a - b);
  console.log(`first victory: median ${done.length ? done[Math.floor(done.length / 2)].toFixed(2) : '-'} h (min ${done.length ? done[0].toFixed(2) : '-'}, max ${done.length ? done[done.length - 1].toFixed(2) : '-'}), ${done.length}/${journeys} journeys won; runs to first victory ${nruns.filter(Number.isFinite).sort((a, b) => a - b).join(' ')}`);
} else {
  const r = journey(seed0, false);
  console.log('\nMILESTONES'); for (const k in r.marks) console.log(' ', k.padEnd(26), `run ${r.marks[k].run} @ ${r.marks[k].hours.toFixed(2)}h`);
  console.log(' mastery', ED.CLASS_IDS.map((c, i) => c + ':' + ED.masteryLevel(r.p.mastery[i])).join(' '));
  console.log(' total', (r.total / 3600).toFixed(2), 'h over', r.runs, 'runs; rooms visited', Math.round(100 * r.rooms / Math.max(1, r.roomsTotal)) + '%');
}
