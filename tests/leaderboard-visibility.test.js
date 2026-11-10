// Leaderboard visibility regression tests (the Sep 12 "default hidden" bug).
// A signed-in player's times are public unless they turned the profile
// toggle off; guests are public; timer-off solves never submit. The profile
// toggle must always show what the next solve will be filed as.
const { newPage, run, assertEqual } = require('./helpers/harness');

const DAY = '2026-10-30';
const NOW = new Date(DAY + 'T12:00:05-04:00');
const UID = 'acct1', NAME = 'Jeff_Test';
const ENTRY = `leaderboardEntries/${UID}_${DAY}_easy`;

function lsFor({ account = true, timer = 'timed' } = {}){
  const ls = { 'letterladder:timerChoice': timer, 'letterladder:timerChoiceMade': '1', 'letterladder:lastViewedDateKey': DAY, 'letterladder:activeTier': 'easy', 'letterladder:keyboardEnabled': 'true', 'letterladder:howToPlaySeen': '1' };
  if(account) ls['letterladder:accountUsername'] = NAME;
  return ls;
}
const realUser = { uid: UID, isAnonymous: false, email: 'jeff_test@players.letterladder.io' };
const playersDoc = extra => ({ [`players/${UID}`]: { username: NAME, usernameLower: 'jeff_test', createdAt: 1788844940627, authEmail: 'jeff_test@players.letterladder.io', ...extra } });

async function open(browser, base, { docs = {}, user = realUser, ls = lsFor(), failReadPaths, readDelayMs, device = false } = {}){
  const { ctx, page } = await newPage(browser, { fake: { user, docs, failReadPaths, readDelayMs }, localStorage: ls, mobile: device, now: NOW });
  const logs = []; page.on('console', m => { if(/\[leaderboard\]/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`); });
  return { ctx, page, logs };
}
async function gameReady(page, base){
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}
async function solveEasy(page){
  for(const w of ['neat', 'tan']){
    const len = await page.evaluate(() => activeLength);
    await page.click(`#rung-input-${len}`); await page.keyboard.type(w, { delay: 20 }); await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1200);
}
const db = page => page.evaluate(() => window.__FAKE_FB.docs || {});
// Names shown on leaderboard.html for Easy.
async function boardEasy(page, base){
  await page.goto(base + '/leaderboard.html'); await page.waitForTimeout(1200);
  return page.$$eval('.tier-row', tiers => { const t = tiers.find(x => /Easy/.test(x.querySelector('.tier-label').textContent)); return t ? [...t.querySelectorAll('.score-row')].map(r => r.children[1].textContent.trim()) : []; });
}
async function profileToggle(page, base){
  await page.goto(base + '/profile.html');
  await page.waitForFunction(() => { const t = document.getElementById('leaderboard-vis-toggle'); return t && (t.hasAttribute('aria-pressed') || document.getElementById('leaderboard-vis-error')); }, null, { timeout: 10000 });
  return page.$eval('#leaderboard-vis-toggle', t => ({ pressed: t.getAttribute('aria-pressed'), disabled: t.disabled, error: (document.getElementById('leaderboard-vis-error') || {}).textContent || null }));
}

module.exports = run('Leaderboard visibility', [
  ['(a) real account with a MISSING players doc: solve is visible on the board, doc recreated', async ({ browser, base }) => {
    const { ctx, page, logs } = await open(browser, base, { docs: {} });
    await gameReady(page, base); await solveEasy(page);
    const d = await db(page);
    assertEqual(d[ENTRY] && d[ENTRY].visible, true, 'entry visible');
    assertEqual(d[`players/${UID}`] && [d[`players/${UID}`].username, d[`players/${UID}`].usernameLower, d[`players/${UID}`].authEmail, d[`players/${UID}`].leaderboardVisible], [NAME, 'jeff_test', 'jeff_test@players.letterladder.io', true], 'players doc recreated');
    assertEqual(logs.some(l => /entry written for "Jeff_Test".*visible=true/.test(l)), true, `outcome logged: ${JSON.stringify(logs)}`);
    assertEqual(await boardEasy(page, base), [NAME], 'on the leaderboard page under the username');
    await ctx.close();
  }],
  ['(a) real account, players doc without a setting (most accounts): visible', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base, { docs: playersDoc() });
    await gameReady(page, base); await solveEasy(page);
    assertEqual((await db(page))[ENTRY].visible, true, 'entry visible');
    assertEqual(await boardEasy(page, base), [NAME], 'on the board');
    await ctx.close();
  }],
  ['(a) opted out (toggle off): filed hidden and not on the board', async ({ browser, base }) => {
    const { ctx, page, logs } = await open(browser, base, { docs: playersDoc({ leaderboardVisible: false }) });
    await gameReady(page, base); await solveEasy(page);
    assertEqual((await db(page))[ENTRY].visible, false, 'entry hidden');
    assertEqual(logs.some(l => /visible=false \(players doc read - player turned the leaderboard toggle off\)/.test(l)), true, 'reason logged');
    assertEqual(await boardEasy(page, base), [], 'not on the board');
    await ctx.close();
  }],
  ['(a) players-doc read fails: one retry; then last known setting; otherwise visible with a loud error', async ({ browser, base }) => {
    // fails once → retry succeeds
    let r = await open(browser, base, { docs: playersDoc(), failReadPaths: { [`players/${UID}`]: 2 } }); // 1 for startup, 1 for the first submit try
    await gameReady(r.page, base); await solveEasy(r.page);
    assertEqual((await db(r.page))[ENTRY].visible, true, 'retry succeeded → visible');
    await r.ctx.close();
    // always fails, opted out earlier on this device → stays hidden
    r = await open(browser, base, { docs: playersDoc({ leaderboardVisible: false }), failReadPaths: { [`players/${UID}`]: 99 }, ls: { ...lsFor(), [`letterladder:leaderboardVisible:${UID}`]: 'false' } });
    await gameReady(r.page, base); await solveEasy(r.page);
    assertEqual([(await db(r.page))[ENTRY].visible, r.logs.some(l => /^error: .*read FAILED after retry - entry written visible=false/.test(l))], [false, true], 'last known setting used');
    await r.ctx.close();
    // always fails, nothing known → visible + console error
    r = await open(browser, base, { docs: playersDoc(), failReadPaths: { [`players/${UID}`]: 99 } });
    await gameReady(r.page, base); await solveEasy(r.page);
    assertEqual([(await db(r.page))[ENTRY].visible, r.logs.some(l => /^error: .*read FAILED after retry - entry written VISIBLE/.test(l))], [true, true], 'default visible, loudly logged');
    await r.ctx.close();
  }],
  ['(b) profile toggle shows exactly what the next solve is filed as (missing doc, no setting, on, off)', async ({ browser, base }) => {
    for(const [label, docs] of [['missing doc', {}], ['no setting', playersDoc()], ['on', playersDoc({ leaderboardVisible: true })], ['off', playersDoc({ leaderboardVisible: false })]]){
      const { ctx, page } = await open(browser, base, { docs });
      const t = await profileToggle(page, base);
      await gameReady(page, base); await solveEasy(page);
      const filed = (await db(page))[ENTRY].visible;
      assertEqual([t.pressed, t.disabled], [String(filed), false], `${label}: toggle shows ${t.pressed}, solve filed visible=${filed}`);
      await ctx.close();
    }
  }],
  ['(b) profile toggle: neutral and disabled until loaded; disabled with a message if the setting cannot be read', async ({ browser, base }) => {
    let r = await open(browser, base, { docs: playersDoc({ leaderboardVisible: false }), readDelayMs: 1500 });
    await r.page.goto(base + '/profile.html'); await r.page.waitForSelector('#leaderboard-vis-toggle'); await r.page.waitForTimeout(200);
    assertEqual(await r.page.$eval('#leaderboard-vis-toggle', t => [t.getAttribute('aria-pressed'), t.disabled]), [null, true], 'while loading: no state shown, not clickable');
    await r.ctx.close();
    r = await open(browser, base, { docs: playersDoc(), failReadPaths: { [`players/${UID}`]: 99 } });
    const t = await profileToggle(r.page, base);
    assertEqual([t.pressed, t.disabled, !!t.error], [null, true, true], 'read failed: disabled, message shown, no guessed state');
    await r.ctx.close();
  }],
  ['(c) toggle off hides the account\'s entries; on re-publishes them; stored state matches the display each time', async ({ browser, base }) => {
    const docs = { ...playersDoc(), [ENTRY]: { date: DAY, tier: 'easy', timeMs: 19924, hintsUsed: 0, displayName: NAME, uid: UID, isGuest: false, visible: true, createdAt: 1 },
      'leaderboardEntries/other': { date: DAY, tier: 'easy', timeMs: 5290, hintsUsed: 0, displayName: 'Guest', uid: 'g1', isGuest: true, visible: true, createdAt: 1 } };
    const { ctx, page } = await open(browser, base, { docs });
    assertEqual((await profileToggle(page, base)).pressed, 'true', 'fresh account shows ON');
    await page.click('#leaderboard-vis-toggle'); await page.waitForTimeout(600);
    let d = await db(page);
    assertEqual([await page.$eval('#leaderboard-vis-toggle', t => t.getAttribute('aria-pressed')), d[`players/${UID}`].leaderboardVisible, d[ENTRY].visible, d['leaderboardEntries/other'].visible], ['false', false, false, true], 'off: display, stored setting, own entry hidden, others untouched');
    assertEqual(await boardEasy(page, base), ['Guest'], 'gone from the board');
    assertEqual((await profileToggle(page, base)).pressed, 'false', 'reload shows OFF');
    await page.click('#leaderboard-vis-toggle'); await page.waitForTimeout(600);
    d = await db(page);
    assertEqual([await page.$eval('#leaderboard-vis-toggle', t => t.getAttribute('aria-pressed')), d[`players/${UID}`].leaderboardVisible, d[ENTRY].visible], ['true', true, true], 'on: display, stored, entry visible again');
    assertEqual(await boardEasy(page, base), ['Guest', NAME], 'back on the board');
    await ctx.close();
  }],
  ['(d) guest solve appears on the board as "Guest"; a timer-off solve submits nothing', async ({ browser, base }) => {
    let r = await open(browser, base, { user: null, ls: lsFor({ account: false }) });
    await gameReady(r.page, base); await solveEasy(r.page);
    const d = await db(r.page); const guestEntry = Object.entries(d).find(([k]) => k.startsWith('leaderboardEntries/'));
    assertEqual(guestEntry && [guestEntry[1].displayName, guestEntry[1].visible, guestEntry[1].isGuest], ['Guest', true, true], 'guest entry');
    assertEqual(await boardEasy(r.page, base), ['Guest'], 'guest on the board');
    await r.ctx.close();
    for(const account of [false, true]){
      r = await open(browser, base, { user: account ? realUser : null, docs: playersDoc(), ls: lsFor({ account, timer: 'untimed' }) });
      await gameReady(r.page, base); await solveEasy(r.page);
      const writes = await r.page.evaluate(() => (window.__FAKE_FB_WRITES || []).filter(w => /^(leaderboardEntries|scores)\//.test(w.path)).length);
      assertEqual(writes, 0, `timer off (${account ? 'account' : 'guest'}): nothing submitted`);
      await r.ctx.close();
    }
  }],
  ['rank line still counts a visible signed-in entry and guests', async ({ browser, base }) => {
    const docs = { ...playersDoc(), 'leaderboardEntries/g': { date: DAY, tier: 'easy', timeMs: 100, visible: true, uid: 'g', isGuest: true, displayName: 'Guest' },
      'leaderboardEntries/s': { date: DAY, tier: 'easy', timeMs: 200, visible: true, uid: 's', isGuest: false, displayName: 'Steve' } };
    const { ctx, page } = await open(browser, base, { docs });
    await gameReady(page, base); await solveEasy(page);
    await page.waitForSelector('.sm-scrim', { timeout: 9000 }); await page.click('.sm-close-x');
    await page.waitForFunction(() => /ranked #3/.test((document.getElementById('leaderboard-rank-text') || {}).textContent || ''), null, { timeout: 5000 });
    assertEqual(await boardEasy(page, base), ['Guest', 'Steve', NAME], 'board order');
    await ctx.close();
  }],
  ['15.1s sequence: an earlier solve today stays on the board (not replaced), and it is logged', async ({ browser, base }) => {
    const docs = { ...playersDoc(), [ENTRY]: { date: DAY, tier: 'easy', timeMs: 19924, hintsUsed: 0, displayName: NAME, uid: UID, isGuest: false, visible: true, createdAt: 1 } };
    const { ctx, page, logs } = await open(browser, base, { docs });
    await gameReady(page, base); await solveEasy(page);   // second solve today, on another device
    assertEqual((await db(page))[ENTRY].timeMs, 19924, 'first solve of the day kept');
    assertEqual(logs.some(l => /entry NOT written - already on the board with 19\.9s/.test(l)), true, `logged: ${JSON.stringify(logs)}`);
    await ctx.close();
  }],
  ['15.1s sequence: device remembers the account but its sign-in ended → no entry, loud log', async ({ browser, base }) => {
    const { ctx, page, logs } = await open(browser, base, { user: null, docs: playersDoc() });
    await gameReady(page, base);
    // As on the test site at 9:41: this browser still had the username saved, but Firebase had no signed-in user.
    await solveEasy(page);
    const entries = Object.keys(await db(page)).filter(k => k.startsWith('leaderboardEntries/'));
    assertEqual([entries.length, logs.some(l => /^error: .*entry NOT written - not signed in to Firebase \(this device remembers account "Jeff_Test"/.test(l))], [0, true], `no entry; ${JSON.stringify(logs)}`);
    await ctx.close();
  }],
  ['daily check republishes hidden entries of a player who never opted out, never of one who did', async ({ browser, base }) => {
    const hidden = (id, date) => ({ [`leaderboardEntries/${UID}_${date}_easy`]: { date, tier: 'easy', timeMs: 30000, uid: UID, displayName: NAME, isGuest: false, visible: false, createdAt: 1 } });
    for(const [label, pdoc, expectVisible] of [['missing doc', {}, true], ['never opted out', playersDoc(), true], ['opted out', playersDoc({ leaderboardVisible: false }), false]]){
      const { ctx, page } = await open(browser, base, { docs: { ...pdoc, ...hidden(1, '2026-10-28'), ...hidden(2, '2026-10-29') } });
      await gameReady(page, base); await page.waitForTimeout(800);
      const d = await db(page);
      assertEqual([d[`leaderboardEntries/${UID}_2026-10-28_easy`].visible, d[`leaderboardEntries/${UID}_2026-10-29_easy`].visible], [expectVisible, expectVisible], label);
      await ctx.close();
    }
  }],
]).then(failed => process.exit(failed ? 1 : 0));
