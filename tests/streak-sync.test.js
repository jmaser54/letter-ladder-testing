// Streak sync: merging this device's stats with the cloud copy must never
// revive a broken (stale) streak, the landing page must show the account's
// cloud streak (not just this device's possibly stale copy), and stat
// updates must not push stale local stats over newer cloud stats.
const { newPage, run, assertEqual, etDate } = require('./helpers/harness');

const TODAY = etDate(0), YESTERDAY = etDate(-1), OLD = etDate(-20);
const stat = (currentStreak, lastSolvedDate, extra = {}) =>
  ({ played: 30, solved: 25, currentStreak, maxStreak: Math.max(11, currentStreak), lastSolvedDate, ...extra });
const allTiers = s => ({ easy: s, medium: s, hard: s, total: s });

function account({ local, cloud, authDelayMs = 0, readDelayMs = 0, failReads = false }){
  const ls = { 'letterladder:accountUsername': 'tester', 'letterladder:tester:ownerUid': 'u1' };
  if(local) ls['letterladder:tester:stats'] = JSON.stringify(local);
  const docs = { 'players/u1': { username: 'tester' } };
  if(cloud) docs['playerStats/u1'] = cloud;
  return { fake: { user: { uid: 'u1', isAnonymous: false }, docs, authDelayMs, readDelayMs, failReads }, localStorage: ls };
}

// Loads the game on a device and returns the stats it settles on locally.
async function gameMerge(browser, base, opts){
  const { ctx, page } = await newPage(browser, account(opts));
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 10000 });
  const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('letterladder:tester:stats')));
  await ctx.close();
  return stats;
}

async function landingStreak(browser, base, opts){
  const { ctx, page } = await newPage(browser, account(opts));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__FAKE_FB_AUTH_FIRED > 0);
  await page.waitForTimeout(600 + (opts.readDelayMs || 0));
  const text = await page.textContent('#play-streak');
  await ctx.close();
  return text.trim();
}

module.exports = run('Streak sync', [
  // --- Game page merge (game.html pullStatsFromCloudIfNeeded) ---
  ['reported case: stale 11-day local streak must not override live 1-day cloud streak', async ({ browser, base }) => {
    const s = await gameMerge(browser, base, { local: allTiers(stat(11, OLD)), cloud: allTiers(stat(1, YESTERDAY, { played: 45, solved: 40 })) });
    assertEqual(s.total.currentStreak, 1, 'merged total streak');
    assertEqual(s.total.maxStreak, 11, 'best streak preserved');
    assertEqual(s.total.played, 45, 'played count from newer side');
  }],
  ['stale cloud streak must not override live local streak', async ({ browser, base }) => {
    const s = await gameMerge(browser, base, { local: allTiers(stat(3, YESTERDAY)), cloud: allTiers(stat(9, OLD)) });
    assertEqual(s.total.currentStreak, 3, 'merged total streak');
  }],
  ['both live: the longer streak wins', async ({ browser, base }) => {
    const s = await gameMerge(browser, base, { local: allTiers(stat(4, YESTERDAY)), cloud: allTiers(stat(5, TODAY)) });
    assertEqual(s.total.currentStreak, 5, 'merged total streak');
  }],
  ['both stale: streak is 0, best streak kept', async ({ browser, base }) => {
    const s = await gameMerge(browser, base, { local: allTiers(stat(6, OLD)), cloud: allTiers(stat(7, etDate(-5))) });
    assertEqual(s.total.currentStreak, 0, 'merged total streak');
    assertEqual(s.total.maxStreak, 11, 'best streak preserved');
  }],
  ['new device (no local stats) takes the live cloud streak', async ({ browser, base }) => {
    const s = await gameMerge(browser, base, { local: null, cloud: allTiers(stat(6, TODAY)) });
    assertEqual(s.total.currentStreak, 6, 'merged total streak');
  }],

  // --- Landing page display (index.html) ---
  ['landing: new device shows the account\'s live cloud streak', async ({ browser, base }) => {
    assertEqual(await landingStreak(browser, base, { local: null, cloud: allTiers(stat(6, YESTERDAY)) }), '🔥 6 day streak', 'landing streak');
  }],
  ['landing: stale local 11 + live cloud 1 shows 1', async ({ browser, base }) => {
    assertEqual(await landingStreak(browser, base, { local: allTiers(stat(11, OLD)), cloud: allTiers(stat(1, TODAY)) }), '🔥 1 day streak', 'landing streak');
  }],
  ['landing: stale cloud streak is not shown', async ({ browser, base }) => {
    assertEqual(await landingStreak(browser, base, { local: null, cloud: allTiers(stat(9, OLD)) }), '', 'landing streak');
  }],
  ['landing: cloud read fails -> falls back to this device\'s live streak', async ({ browser, base }) => {
    assertEqual(await landingStreak(browser, base, { local: allTiers(stat(2, TODAY)), cloud: allTiers(stat(5, TODAY)), failReads: true }), '🔥 2 day streak', 'landing streak');
  }],
  ['landing: guest shows no streak and makes no cloud read', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { fake: { user: null, docs: {} } });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.__FAKE_FB_AUTH_FIRED > 0);
    await page.waitForTimeout(500);
    assertEqual((await page.textContent('#play-streak')).trim(), '', 'landing streak');
    await ctx.close();
  }],

  // --- Write ordering: no stale local stats pushed over newer cloud stats ---
  ['revealing a solution while the cloud read is in flight does not upload stale stats', async ({ browser, base }) => {
    const local = allTiers(stat(11, OLD, { played: 20, solved: 18 }));
    const cloud = allTiers(stat(1, YESTERDAY, { played: 45, solved: 40 }));
    const { ctx, page } = await newPage(browser, account({ local, cloud, readDelayMs: 1500 }));
    await page.goto(base + '/game.html');
    await page.waitForFunction(() => typeof statsPullPromise !== 'undefined' && statsPullPromise !== null, null, { timeout: 10000 });
    await page.evaluate(() => recordLossIfNeeded('easy'));
    await page.waitForFunction(() => accountScopeReady === true, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const writes = await page.evaluate(() => (window.__FAKE_FB_WRITES || []).filter(w => w.path === 'playerStats/u1' && w.data.total));
    const stale = writes.filter(w => w.data.total.played < 45);
    assertEqual(stale.length, 0, 'playerStats writes carrying stale local counts');
    const final = await page.evaluate(() => JSON.parse(localStorage.getItem('letterladder:tester:stats')));
    assertEqual([final.easy.currentStreak, final.total.played], [0, 46], 'easy streak broken by the loss, played counted once on top of cloud');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
