// Timer default: first-time visitors must start with the timer ON, and
// existing preferences (local or account) must not be overwritten.
const { newPage, run, assertEqual } = require('./helpers/harness');

const ACCOUNT = {
  user: { uid: 'u1', isAnonymous: false },
  docs: { 'players/u1': { username: 'tester' }, 'playerStats/u1': { timerChoice: 'timed' } },
};

async function playFromLanding(page, base){
  await page.goto(base + '/index.html');
  await page.click('.play-btn-full');
  await page.waitForURL(/game\.html/);
  // Wait for the game's auth/startup sequence to finish.
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

module.exports = run('Timer default', [
  ['first-time visitor (auth already resolved) gets timer ON', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { fake: { user: null } });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.__FAKE_FB_AUTH_FIRED > 0);
    await page.click('.play-btn-full');
    await page.waitForURL(/game\.html/);
    await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true);
    assertEqual(await page.evaluate(() => getTimerChoice()), 'timed', 'timer choice in game');
    assertEqual(await page.evaluate(() => localStorage.getItem('letterladder:timerChoice')), null, 'nothing forced into storage');
    await ctx.close();
  }],
  ['first-time visitor tapping before auth resolves gets timer ON', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { fake: { user: null, authDelayMs: 1500 } });
    await playFromLanding(page, base);
    assertEqual(await page.evaluate(() => getTimerChoice()), 'timed', 'timer choice in game');
    await ctx.close();
  }],
  ['returning guest who turned the timer off keeps it off', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: { 'letterladder:timerChoice': 'untimed' } });
    await playFromLanding(page, base);
    assertEqual(await page.evaluate(() => getTimerChoice()), 'untimed', 'timer choice in game');
    await ctx.close();
  }],
  ['signed-in player tapping before auth resolves keeps their timed preference (local and cloud)', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, {
      fake: { ...ACCOUNT, authDelayMs: 1500 },
      localStorage: { 'letterladder:accountUsername': 'tester', 'letterladder:timerChoice': 'timed', 'letterladder:timerChoiceMade': '1' },
    });
    await playFromLanding(page, base);
    assertEqual(await page.evaluate(() => getTimerChoice()), 'timed', 'timer choice in game');
    const cloudUntimedWrites = await page.evaluate(() => (window.__FAKE_FB_WRITES || []).filter(w => w.path === 'playerStats/u1' && w.data.timerChoice === 'untimed').length);
    assertEqual(cloudUntimedWrites, 0, 'cloud writes of timerChoice=untimed');
    await ctx.close();
  }],
  ['signed-in player on a new device gets their saved account preference', async ({ browser, base }) => {
    const fake = { ...ACCOUNT, docs: { ...ACCOUNT.docs, 'playerStats/u1': { timerChoice: 'untimed' } } };
    const { ctx, page } = await newPage(browser, { fake, localStorage: { 'letterladder:accountUsername': 'tester' } });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.__FAKE_FB_AUTH_FIRED > 0);
    await page.click('.play-btn-full');
    await page.waitForURL(/game\.html/);
    await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true);
    assertEqual(await page.evaluate(() => getTimerChoice()), 'untimed', 'timer choice in game');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
