// Headless UI check (never a visible window): walks every screen and overlay in headless Chromium with mouse and keyboard, asserts the flows and
// minimum text sizes, and saves screenshots (ui-*.png) to --outdir (default <tmp>/wickdeep-browse). Co-op lobby runs over ?net=local (BroadcastChannel) with two pages.
// Usage: node tools/check-ui.js [--viewport=1920x1080] [--outdir=DIR] [--timeout=180]. Exit 0 pass, 1 check failure, 2 harness error.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const arg = (k, d) => { const a = process.argv.find(s => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const VP = /^(\d+)x(\d+)$/.exec(arg('viewport', '1920x1080')), OUT = arg('outdir', path.join(os.tmpdir(), 'wickdeep-browse')), TIMEOUT = +arg('timeout', 180);
const ROOT = path.resolve(__dirname, '..');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not next to the repo */ }
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), npx = path.join(la, 'npm-cache', '_npx');
  let dirs = []; try { dirs = fs.readdirSync(npx); } catch (e) { /* none */ }
  const c = dirs.map(d => path.join(npx, d, 'node_modules', 'playwright')).filter(d => fs.existsSync(path.join(d, 'package.json'))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const d of c) { try { return require(d); } catch (e) { /* next */ } }
  throw new Error('playwright not found (npx --yes playwright install chromium)');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const serve = () => new Promise((res, rej) => {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
    fs.readFile(f, (err, data) => { if (err) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(data); });
  });
  srv.once('error', rej); srv.listen(0, '127.0.0.1', () => res({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
});

const fails = [], shots = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); console.log((ok ? '  ok   ' : '  FAIL ') + msg); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  delete process.env.PWDEBUG;
  const pw = loadPlaywright(), server = await serve();
  const browser = await pw.chromium.launch({ headless: true, args: ['--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  const dog = setTimeout(() => { console.log('timeout'); process.exit(2); }, TIMEOUT * 1000);
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: +VP[1], height: +VP[2] }, deviceScaleFactor: 1 });
    await ctx.route((u) => u.protocol.startsWith('http') && u.origin !== server.base, (r) => r.abort());
    const open = async (q) => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.goto(server.base + '/index.html' + (q || ''), { waitUntil: 'load' });
      await page.waitForFunction(() => window.ED && ED.App && ED.App.state === 'title' && ED.Atlas.ok, null, { timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      return page;
    };
    const shot = async (page, name) => { const f = path.join(OUT, 'ui-' + name + '.png'); await wait(250); await page.screenshot({ path: f }); shots.push(f); };
    const vis = (page, id) => page.evaluate((i) => { const e = document.getElementById(i); return !!e && !e.hidden && e.offsetParent !== null || (!!e && !e.hidden && getComputedStyle(e).position === 'fixed'); }, id);
    const active = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
    // Smallest computed font size (CSS px) among visible elements matching sel.
    const minFont = (page, sel) => page.evaluate((s) => { let m = 1e9; for (const e of document.querySelectorAll(s)) if (e.offsetParent !== null && e.textContent.trim()) m = Math.min(m, parseFloat(getComputedStyle(e).fontSize)); return m === 1e9 ? 0 : m; }, sel);

    console.log('title');
    const page = await open('?net=local');
    await shot(page, 'title');
    for (const id of ['btn-play', 'btn-host', 'btn-join', 'btn-camp', 'btn-achieve', 'btn-codex', 'btn-settings', 'btn-credits']) check(await vis(page, id), id + ' visible');
    check(await active(page) === 'btn-play', 'Play focused on the title');
    await page.keyboard.press('ArrowDown');
    { const a = await active(page); check(a === 'btn-host', 'ArrowDown moves to Host (' + a + ')'); }
    await page.keyboard.press('ArrowRight');
    check(await active(page) === 'btn-join', 'ArrowRight moves to Join');
    await page.keyboard.press('ArrowUp');
    check(await active(page) === 'btn-play', 'ArrowUp returns to Play');
    await page.keyboard.press('Enter');
    check(await vis(page, 'scr-hero'), 'Enter opens hero select');

    console.log('hero select');
    check(await page.locator('.hero-tile').count() === 7, '7 hero tiles');
    check(await page.locator('.hero-tile.locked').count() === 4, '4 locked heroes at start');
    await page.locator('.hero-tile[data-cls="necro"]').click();
    check(/Survive 10 minutes/.test(await page.locator('#hero-detail').innerText()), 'locked hero shows its unlock rule');
    check(await page.locator('#btn-hero-next').isDisabled(), 'Next disabled on a locked hero');
    await shot(page, 'hero-locked');
    await page.locator('.hero-tile[data-cls="ranger"]').click();
    const hd = await page.locator('#hero-detail').innerText();
    check(/Longbow/.test(hd) && /Volley/.test(hd) && /Snare/.test(hd), 'detail lists signature weapon and Q / E');
    check(await minFont(page, '#hero-detail span, #hero-detail b, .hero-tile .t-name') >= 20, 'hero select text >= 20 px');
    await shot(page, 'hero');
    await page.keyboard.press('Enter'); // focused tile is the chosen hero: continue
    check(await vis(page, 'scr-stage'), 'Enter on the chosen hero opens stage select');

    console.log('stage select');
    check(await page.locator('.stage-card').count() === 3 && await page.locator('.stage-card.locked').count() === 2, '3 stages, 2 locked');
    check(/Beat stage 1/.test(await page.locator('.stage-card').nth(1).innerText()), 'locked stage shows its rule');
    await shot(page, 'stage');
    await page.keyboard.press('Escape');
    check(await vis(page, 'scr-hero'), 'Esc goes back to hero select');
    await page.keyboard.press('Escape');
    check(await vis(page, 'scr-title'), 'Esc goes back to the title');

    console.log('camp');
    await page.evaluate(() => { ED.App.profile.gold = 5000; ED.App.persist(); });
    await page.locator('#btn-camp').click();
    const nShop = await page.evaluate(() => ED.SHOP.length);
    check(await page.locator('.shop-row').count() === nShop, nShop + ' shop ranks');
    await page.locator('.shop-row button[data-id="might"]').click();
    let pr = await page.evaluate(() => ({ g: ED.App.profile.gold, r: ED.App.profile.shop.might | 0 }));
    check(pr.g === 4800 && pr.r === 1, 'buy Might: rank 1, gold 4800');
    await page.locator('.shop-row button[data-id="might"]').click();
    check(/Refund all \(\+600\)/.test(await page.locator('#btn-refund').innerText()), 'refund shows the total');
    await shot(page, 'camp');
    await page.locator('#btn-refund').click();
    pr = await page.evaluate(() => ({ g: ED.App.profile.gold, r: ED.App.profile.shop.might | 0 }));
    check(pr.g === 5000 && pr.r === 0, 'refund returns all gold');
    await page.locator('#btn-code-toggle').click();
    check(/^WK1-/.test(await page.locator('#inp-code').inputValue()), 'save code shown');
    check(await minFont(page, '.shop-row span, .shop-row button') >= 20, 'camp text >= 20 px');
    await page.keyboard.press('Escape');
    check(await vis(page, 'scr-title'), 'Esc leaves the camp');

    console.log('achievements');
    await page.evaluate(() => { const p = ED.App.profile; p.stats.bestTime = 432; p.stats.bestKills = 1840; p.stats.bestLevel = 31; p.played = ['knight']; ED.App.persist(); });
    await page.locator('#btn-achieve').click();
    check(await vis(page, 'scr-achieve'), 'Achievements opens');
    const nAch = await page.evaluate(() => { const U0 = ED.UNLOCKS; return ED.HERO_IDS.filter(c => !U0.heroes[c].start).length + Object.keys(U0.stages).filter(i => !U0.stages[i].start).length + (U0.sigAfterRun ? ED.HERO_IDS.length : 0); });
    check(await page.locator('.ach-row').count() === nAch, nAch + ' unlock rows');
    check(await page.locator('.ach-row.done').count() === 1, 'one done (Cleave after a Knight run)');
    const at = await page.locator('#ach-list').innerText();
    check(/7:12 \/ 10:00/.test(at) && /1840 \/ 3000/.test(at) && /Level 31 \/ 40/.test(at), 'unlock progress texts');
    check(/1 \/ \d+ unlocked/.test(await page.locator('#ach-count').innerText()), 'header counts unlocks');
    check(/Lifetime kills/.test(await page.locator('#ach-rec').innerText()) && await page.locator('.rec-stage').count() === 3, 'records and 3 stage bests');
    check(await minFont(page, '#scr-achieve span, #scr-achieve b') >= 20, 'achievements text >= 20 px');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('scr-achieve').scrollWidth <= innerWidth), 'achievements: no horizontal scroll');
    await shot(page, 'achieve');
    await page.keyboard.press('Escape');
    check(await vis(page, 'scr-title'), 'Esc leaves achievements');

    console.log('encyclopedia: only what was met');
    await page.evaluate(() => { const p = ED.App.profile; p.seen = ED.Save.normalize(p).seen; ED.App.persist(); }); // back-fill of one Knight run: Knight + Cleave
    await page.locator('#btn-codex').click();
    check(await vis(page, 'scr-codex'), 'Encyclopedia opens');
    const cxNames = () => page.evaluate(() => [...document.querySelectorAll('#cx-list .cx-item')].map(b => (b.classList.contains('unseen') ? '-' : '+') + b.textContent));
    { const n = await cxNames(); check(n[0] === '+Knight' && n.slice(1).every(x => x === '-???') && n.length === 7, 'heroes: only Knight named, the rest "???" (' + n.join(',') + ')'); }
    check(/Evolves into \?\?\? with/.test(await page.locator('#cx-detail').innerText()), 'Knight: unmet evolution reads ???');
    await page.locator('.cx-item[data-key="ranger"]').click();
    { const t = await page.locator('#cx-detail').innerText(); check(/Not discovered yet/.test(t) && !/Volley|Ranger/.test(t), 'unmet open hero: only "Not discovered yet"'); }
    await page.locator('.cx-item[data-key="necro"]').click();
    { const t = await page.locator('#cx-detail').innerText(); check(/Not discovered yet/.test(t) && /Locked: Survive 10 minutes/.test(t) && !/Lv 4|Necro/.test(t), 'unmet locked hero: unlock line kept, nothing else'); }
    await shot(page, 'codex-unseen');
    await page.locator('#cx-tabs [data-tab="weapons"]').click();
    { const n = await cxNames(), nw = await page.evaluate(() => ED.WEAPON_IDS.length); check(n.filter(x => x[0] === '+').join() === '+Cleave' && n.length === nw, 'weapons: only Cleave named of ' + nw); }
    for (const t of ['passives', 'foes', 'bosses', 'stages']) {
      await page.locator('#cx-tabs [data-tab="' + t + '"]').click();
      const n = await cxNames();
      check(n.length > 0 && n.every(x => x === '-???') && /Not discovered yet/.test(await page.locator('#cx-detail').innerText()), t + ': every entry "???" (' + n.length + ')');
    }
    await page.locator('.cx-item[data-key="1"]').click();
    { const t = await page.locator('#cx-detail').innerText(); check(/Not discovered yet/.test(t) && /Locked/.test(t) && !/Glowmire|Bosses/.test(t), 'unmet locked stage: unlock line kept, nothing else'); }
    await page.locator('#cx-tabs [data-tab="heroes"]').click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const p = ED.App.profile; for (const k of ED.Save.SEEN_KEYS) p.seen[k] = ED.Save.seenOrder(k).slice(); ED.App.persist(); });

    console.log('encyclopedia');
    await page.locator('#btn-codex').click();
    check(await vis(page, 'scr-codex'), 'Encyclopedia opens');
    check(await page.locator('#cx-tabs button').count() === 6, '6 tabs');
    check(await page.evaluate(() => document.activeElement.dataset.tab) === 'heroes', 'focus starts on the Heroes tab');
    await page.keyboard.press('ArrowDown');
    if (await active(page) === 'cx-detail') await page.keyboard.press('ArrowLeft'); // a long detail pane sits under the tab
    check(await page.evaluate(() => document.activeElement.dataset.key) === 'knight', 'arrows reach the first list entry');
    await page.keyboard.press('ArrowDown');
    check(/Volley/.test(await page.locator('#cx-detail').innerText()), 'keyboard focus selects (Ranger: Volley)');
    await page.locator('.cx-item[data-key="necro"]').click();
    check(/Locked: Survive 10 minutes/.test(await page.locator('#cx-detail').innerText()) && /Lv 4/.test(await page.locator('#cx-detail').innerText()), 'locked hero shows unlock line and skill levels');
    check(await minFont(page, '#scr-codex span, #scr-codex b, #scr-codex button') >= 20, 'encyclopedia text >= 20 px');
    await shot(page, 'codex-hero');
    const tabs = { weapons: /Evolution/, passives: /Evolves/, foes: /Appears in/, bosses: /Attacks/, stages: /Bosses/ };
    for (const t in tabs) {
      await page.locator('#cx-tabs [data-tab="' + t + '"]').click();
      const n = await page.locator('.cx-item').count(), txt = await page.locator('#cx-detail').innerText();
      check(n > 0 && tabs[t].test(txt), t + ': ' + n + ' entries, detail filled');
      check(await page.evaluate(() => document.getElementById('scr-codex').scrollWidth <= innerWidth), t + ': no horizontal scroll');
      await shot(page, 'codex-' + t);
    }
    check(await page.locator('#cx-tabs [data-tab="weapons"]').count() === 1, 'weapons tab present');
    await page.locator('#cx-tabs [data-tab="weapons"]').click();
    check(await page.locator('.cx-item').count() === await page.evaluate(() => ED.WEAPON_IDS.length), 'every weapon listed');
    await page.setViewportSize({ width: 480, height: 800 });
    await wait(200);
    check(await page.evaluate(() => document.getElementById('scr-codex').scrollWidth <= innerWidth), 'encyclopedia at 480 px: no horizontal scroll');
    await shot(page, 'codex-narrow');
    await page.keyboard.press('Escape');
    await page.locator('#btn-achieve').click();
    check(await page.evaluate(() => document.getElementById('scr-achieve').scrollWidth <= innerWidth), 'achievements at 480 px: no horizontal scroll');
    await shot(page, 'achieve-narrow');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: +VP[1], height: +VP[2] });
    check(await vis(page, 'scr-title'), 'Esc returns to the title');
    await page.evaluate(() => { const p = ED.App.profile; p.stats.bestTime = 0; p.stats.bestKills = 0; p.stats.bestLevel = 0; p.played = []; for (const k of ED.Save.SEEN_KEYS) p.seen[k] = []; ED.App.persist(); });

    console.log('settings and credits');
    await page.locator('#btn-settings').click();
    check(await vis(page, 'ov-settings'), 'settings opens');
    await page.locator('#set-quality [data-v="low"]').click();
    await page.locator('#set-shake').click();
    await page.locator('#set-music').fill('25');
    await shot(page, 'settings');
    const st = await page.evaluate(() => ({ q: ED.App.settings.quality, sh: ED.App.settings.shake, mu: ED.App.settings.music, rq: ED.Render.quality, ls: JSON.parse(localStorage.getItem('wickdeep.survivors.settings.v1') || '{}') }));
    check(st.q === 'low' && st.rq === 'low' && st.ls.quality === 'low', 'quality low applied and saved');
    check(st.sh === false && st.ls.shake === false, 'screen shake off saved');
    check(st.mu === 25 && st.ls.music === 25, 'music volume saved');
    await page.keyboard.press('Escape');
    check(!(await vis(page, 'ov-settings')), 'Esc closes settings');
    check(await active(page) === 'btn-settings', 'focus returns to the Settings button');
    await page.evaluate(() => { ED.App.settings.quality = 'auto'; ED.App.settings.shake = true; ED.Save.storeSettings(ED.App.settings); ED.App.applySettings(); });
    await page.locator('#btn-credits').click();
    const cr = await page.locator('#ov-credits').innerText();
    check(/DawnLike/.test(cr) && /CodeManu/.test(cr) && /CC-BY 4\.0/.test(cr), 'credits name the CC-BY packs');
    await shot(page, 'credits');
    await page.keyboard.press('Escape');

    console.log('co-op lobby (local transport)');
    await page.locator('#btn-host').click();
    check(await vis(page, 'scr-lobby'), 'Host opens the lobby');
    await page.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.getElementById('lobby-code').textContent), null, { timeout: 5000 });
    const code = await page.locator('#lobby-code').innerText();
    const g = await open('?net=local&slot=2');
    await g.locator('#inp-name').fill('Guest');
    await g.locator('#btn-join').click();
    check(await vis(g, 'scr-join'), 'Join opens the code screen');
    await g.locator('#inp-join').fill(code.toLowerCase());
    await g.keyboard.press('Enter');
    await g.waitForFunction(() => !document.getElementById('scr-lobby').hidden, null, { timeout: 8000 }).catch(() => {});
    check(await vis(g, 'scr-lobby'), 'guest reaches the lobby');
    await page.waitForFunction(() => document.querySelectorAll('#lobby-slots .slot:not(.empty)').length === 2, null, { timeout: 5000 }).catch(() => {});
    check(await page.locator('#lobby-slots .slot:not(.empty)').count() === 2, 'host sees 2 members');
    check(await page.locator('#btn-lobby-go').isDisabled(), 'Start waits for ready');
    await g.locator('#lobby-heroes .pick-btn').nth(2).click();
    await g.locator('#btn-lobby-go').click();
    await page.waitForFunction(() => !document.getElementById('btn-lobby-go').disabled, null, { timeout: 5000 }).catch(() => {});
    check(!(await page.locator('#btn-lobby-go').isDisabled()), 'Start enabled when everyone is ready');
    check(/Pyro/.test(await page.locator('#lobby-slots').innerText()), 'guest hero pick reaches the host');
    await shot(page, 'lobby-host'); await shot(g, 'lobby-guest');
    await g.locator('#btn-lobby-leave').click();
    check(await vis(g, 'scr-title'), 'guest leaves to the title');
    await g.close();
    await page.locator('#btn-lobby-leave').click();
    check(await vis(page, 'scr-title'), 'host leaves to the title');

    console.log('run: HUD, level-up, chest, pause');
    await page.evaluate(() => { ED.App.startSolo({ cls: 'knight', stage: 0, seed: 7, cheats: { god: true } }); });
    await wait(1500);
    await page.evaluate(() => { const w = ED.Game.w; w.addXp(w.xpNext - w.xp + 1); });
    await page.waitForFunction(() => !document.getElementById('ov-offer').hidden, null, { timeout: 5000 }).catch(() => {});
    check(await vis(page, 'ov-offer'), 'level-up cards shown (solo)');
    const nCards = await page.locator('.offer-card').count();
    check(nCards >= 3 && nCards <= 4, '3-4 cards');
    check(await minFont(page, '.offer-card .card-txt, .offer-card .card-name, .offer-card .card-sub, .offer-card .badge') >= 20, 'card text >= 20 px');
    await shot(page, 'offer');
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => document.getElementById('ov-offer').hidden, null, { timeout: 5000 }).catch(() => {});
    check(!(await vis(page, 'ov-offer')), 'key 1 picks a card');
    // build a full kit, one evolution-ready weapon and a boss
    await page.evaluate(() => {
      const w = ED.Game.w, p = w.heroes[0];
      for (const id of ED.WEAPON_IDS) { if (p.weapons.length >= 6) break; const d = ED.WEAPONS[id]; if (!d.evolved && (!d.sig || d.sig === 'knight') && !p.weapons.some(x => x.id === id)) w.addWeapon(p, id); }
      p.weapons.forEach((ws, i) => { ws.lvl = Math.min(8, 1 + i * 2); });
      p.weapons[0].lvl = 8;
      for (const id of ['might', 'haste', 'reach', 'vigor', 'magnet']) if (p.passives.length < 6 && !p.passives.some(x => x.id === id)) p.passives.push({ id, lvl: 2 });
      w.recalc(p, true); p.hp = Math.round(p.maxHp * 0.22); p.skills[1].cd = 6;
      w.spawnBoss({ t: 300, id: 'warden' });
    });
    await wait(800);
    await shot(page, 'hud');
    check(await page.evaluate(() => ED.HUD.k >= (ED.Render.dpr || 1)), 'HUD scale keeps text at or above its CSS size');
    await page.evaluate(() => { const w = ED.Game.w; w.openChest(w.heroes[0]); });
    await wait(500);
    check(await vis(page, 'ov-chest'), 'chest popup shown');
    check(/EVOLUTION/.test(await page.locator('#ov-chest').innerText()), 'chest popup announces the evolution');
    await shot(page, 'chest');
    await page.keyboard.press('Escape');
    await wait(150);
    check(await vis(page, 'ov-pause'), 'Esc pauses');
    check(await page.locator('#pause-build .pslot canvas').count() >= 6, 'pause shows the build');
    await shot(page, 'pause');
    await page.locator('#btn-pause-settings').click();
    check(await vis(page, 'ov-settings') && !(await vis(page, 'ov-pause')), 'settings from pause');
    await page.keyboard.press('Escape');
    await wait(150);
    check(await vis(page, 'ov-pause') && !(await vis(page, 'ov-settings')), 'Esc in settings returns to pause');
    check(await page.evaluate(() => ED.Game.paused), 'still paused');
    await page.locator('#btn-resume').click();
    check(!(await page.evaluate(() => ED.Game.paused)), 'Resume unpauses');
    // mouse buttons are unbound by default: clicks on the game do nothing; a mouse button bound by the player casts
    const sk = () => page.evaluate(() => ED.Game.w.heroes[0].skills.map(x => x.cd));
    await page.evaluate(() => { for (const x of ED.Game.w.heroes[0].skills) x.cd = 0; });
    await page.mouse.click(+VP[1] / 2 + 200, +VP[2] / 2, { button: 'left' }); await page.mouse.click(+VP[1] / 2 + 200, +VP[2] / 2, { button: 'right' });
    await wait(200);
    check((await sk()).every(c => c === 0), 'left / right click on the game casts nothing');
    check(await page.evaluate(() => ED.Input.label('skill1') === 'Q' && ED.Input.hint('skill1') === 'Q' && ED.Input.hint('skill2') === 'E'), 'skill hints show Q / E only');
    check(await page.evaluate(() => ED.Input.rebind('skill1', 1, 'Mouse0').ok && ED.Input.hint('skill1') === 'Q / LMB'), 'LMB can still be bound to skill 1');
    await page.mouse.click(+VP[1] / 2 + 200, +VP[2] / 2, { button: 'left' });
    await wait(200);
    { const c = await sk(); check(c[0] > 0 && c[1] === 0, 'bound LMB casts skill 1 (' + c.join(',') + ')'); }
    await page.evaluate(() => ED.Input.setBinds(ED.App.settings.binds));
    check(await page.evaluate(() => ED.Input.isDefault()), 'binds back to the defaults');

    console.log('co-op HUD: strip, teammates, arrows');
    await page.evaluate(() => ED.App.quitRun());
    {
      const sn = await page.evaluate(() => ED.App.profile.seen);
      check(sn.heroes.join() === 'knight' && sn.stages.join() === 'ossuary' && sn.weapons.length >= 6 && sn.passives.length >= 5 && sn.foes.indexOf('warden') >= 0, 'quit run records hero, stage, own weapons / passives and the boss (' + sn.weapons.length + ' weapons, ' + sn.foes.join(',') + ')');
      check(await page.evaluate(() => JSON.parse(localStorage.getItem(ED.Save.KEY)).seen.foes.indexOf('warden') >= 0), 'seen autosaved at run end');
    }
    await page.evaluate(() => {
      ED.UI.show('none');
      const meta = ED.Save.metaBundle(ED.App.profile);
      ED.Game.start({ mode: 'host', seed: 3, stage: 0, myPid: 'host', cheats: { god: true }, players: [{ pid: 'host', name: 'Host', slot: 0, cls: 'knight', meta }, { pid: 'p2', name: 'Robin', slot: 1, cls: 'ranger', meta }, { pid: 'p3', name: 'Ash', slot: 2, cls: 'pyro', meta }] });
      ED.App.state = 'run';
      const w = ED.Game.w, b = w.heroes[1], c = w.heroes[2];
      b.x += 700; b.y -= 150; c.x -= 60; c.y += 40; c.downed = true; c.bleed = 14; c.revive = 0.4;
      w.addXp(w.xpNext - w.xp + 1);
    });
    await wait(700);
    check(await page.evaluate(() => document.getElementById('ov-offer').classList.contains('strip') && !document.getElementById('ov-offer').hidden), 'co-op offer is a bottom strip');
    check(await page.evaluate(() => getComputedStyle(document.getElementById('ov-offer')).pointerEvents === 'none'), 'strip lets the mouse through to the game');
    await shot(page, 'coop');

    console.log('results');
    await page.evaluate(() => {
      const w = ED.Game.w, p = w.heroes[0];
      p.dealt = { cleave: 48210, whirlwind: 22100, charge: 9100, bulwark: 2100 };
      w.kills = 3120; w.level = 41; w.gold = 186; w.time = 905;
      ED.Game.onEnd = (s) => ED.App.onRunEnd(s);
      w.end(true); ED.Game.drain();
    });
    await wait(400);
    check(await vis(page, 'scr-results'), 'results screen');
    check(await page.locator('.bar-row').count() === 4, 'per-weapon damage bars');
    check(/Victory/.test(await page.locator('#res-title').innerText()), 'victory title');
    await wait(800);
    await shot(page, 'results');
    await page.locator('#btn-res-back').click();
    check(await vis(page, 'scr-title'), 'results back to title');
  } finally {
    clearTimeout(dog);
    await browser.close(); server.srv.close();
  }
  for (const e of errors) check(false, e.slice(0, 300));
  for (const s of shots) console.log('shot ' + s);
  console.log(fails.length ? 'check-ui: FAIL (' + fails.length + ')' : 'check-ui: PASS');
  return fails.length ? 1 : 0;
}
main().then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 2; });
