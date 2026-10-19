// Usage: node tools/journey.js [botSkill] [seed]   (V=1 for per-run detail)
// Simulates a player's whole journey: fresh profile -> runs -> rewards -> purchases, until everything is unlocked.
const { runBot, ED } = require('./sim.js');
const S = ED.Save, U = ED.U;
const skill = +(process.argv[2] || 0.7), seed0 = +(process.argv[3] || 1);
const p = S.defaultProfile();
let total = 0, runs = 0; const marks = {};
const mark = (k) => { if (!marks[k]) marks[k] = `run ${runs} @ ${(total / 3600).toFixed(2)}h`; };
const HUMAN = 1.35; // menus, reading, shopping, walking: humans take longer than the bot
while (runs < 140) {
  const unlocked = ED.CLASS_IDS.filter(c => S.classUnlocked(p, c));
  // play the least-mastered unlocked hero, like a curious player
  unlocked.sort((a, b) => p.mastery[ED.CLASS_IDS.indexOf(a)] - p.mastery[ED.CLASS_IDS.indexOf(b)]);
  const cls = runs % 3 === 2 ? unlocked[0] : unlocked[Math.min(unlocked.length - 1, runs % unlocked.length)];
  const ml = S.masteryLevel(p, cls);
  const wi = ml >= 6 ? 2 : ml >= 3 ? 1 : 0;
  const pact = p.stats.wins > 0 ? p.pactMax : 0;
  const r = runBot({ seed: seed0 * 1000 + runs * 13, n: 1, cls: [cls], weapon: wi, skill, up: p.up.slice(), mastery: ml, pact, tutorial: p.stats.runs < 2 });
  runs++; total += r.time * HUMAN + 45; // + time in the Hearth between runs
  const sum = r.sum; sum.cls = cls;
  const res = S.applyRun(p, sum); if (process.env.V) console.log(`  run ${runs} ${cls} s${sum.stratum}${sum.victory ? " WIN" : ""} +${res.rewards.total} embers (${res.rewards.lines.map(l => l[0].slice(0, 6) + ":" + l[1]).join(" ")}) deeds +${res.deeds.reduce((a, d) => a + d.reward, 0)} ups ${p.up.reduce((a, b) => a + b, 0)}`);
  if (sum.bosses & 1) mark('first Bone Warden kill');
  if (sum.bosses & 4) mark('first Rimeheart kill');
  if (sum.victory) mark('first victory');
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
  if (runs % 10 === 0) console.log(`run ${runs} ${U.fmtTime(total)} deepest ${p.stats.deepest} wins ${p.stats.wins} pactMax ${p.pactMax} embers ${p.embers} lifetime ${p.lifetime} ups ${p.up.reduce((a, b) => a + b, 0)} last: ${cls} s${sum.stratum} ${sum.victory ? 'WIN' : ''} ${U.fmtTime(r.time)}`);
  if (upsDone && relicsDone && p.pactWin >= 10) break;
}
console.log('\nMILESTONES'); for (const k in marks) console.log(' ', k.padEnd(26), marks[k]);
console.log(' mastery', ED.CLASS_IDS.map((c, i) => c + ':' + ED.masteryLevel(p.mastery[i])).join(' '));
console.log(' total', (total / 3600).toFixed(2), 'h over', runs, 'runs');
