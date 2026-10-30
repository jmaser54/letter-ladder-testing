// Timer clock button: only an intentional tap/click may turn the timer on or
// off. A touch that starts on the clock and slides/scrolls away, or that the
// browser cancels, must leave the timer (and the account's saved preference)
// unchanged. Also checks that a timed solve by a signed-in player is recorded.
const { newPage, run, assertEqual } = require('./helpers/harness');

const DAY = '2026-10-30';                       // scheduled day used for the solve test
const NOW = new Date(DAY + 'T12:00:00-04:00');
const ANDROID = 'Pixel 7', IPHONE = 'iPhone 13';

function signedIn(){
  return {
    fake: { user: { uid: 'dad', isAnonymous: false }, docs: { 'players/dad': { username: 'dad' }, 'playerStats/dad': { timerChoice: 'timed' } } },
    localStorage: {
      'letterladder:accountUsername': 'dad', 'letterladder:dad:ownerUid': 'dad',
      'letterladder:timerChoice': 'timed', 'letterladder:timerChoiceMade': '1',
      'letterladder:howToPlaySeen': '1', 'letterladder:lastViewedDateKey': DAY, 'letterladder:activeTier': 'easy',
    },
  };
}

async function openGame(browser, base, device){
  const { ctx, page } = await newPage(browser, { ...signedIn(), mobile: device || false, now: NOW });
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

const timerState = page => page.evaluate(() => ({
  choice: localStorage.getItem('letterladder:timerChoice'),
  cloud: (window.__FAKE_FB.docs['playerStats/dad'] || {}).timerChoice,
  running: !!document.querySelector('.timer-widget-btn:not(.timer-widget-btn--off)'),
}));
const ON = { choice: 'timed', cloud: 'timed', running: true };
const OFF = { choice: 'untimed', cloud: 'untimed', running: false };

// Raw touch sequence on the timer control via CDP: start at its centre, then
// move by each [dx, dy] in `moves`, then end (or cancel).
async function touchTimer(ctx, page, moves = [], end = 'touchEnd'){
  const box = await page.locator('#timer-widget button').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for(const [dx, dy] of moves) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
  await page.waitForTimeout(600);
}

const slideAway = [[0, 40], [0, 80], [0, 120], [0, 160], [0, 200], [0, 240]];

module.exports = run('Timer clock button (touch + click)', [
  ['Android: tapping the running clock turns the timer off (intentional)', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    assertEqual(await timerState(page), ON, 'before');
    await touchTimer(ctx, page);
    assertEqual(await timerState(page), OFF, 'after tap');
    await ctx.close();
  }],
  ['Android: a tap with slight finger jitter still counts as a tap', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    await touchTimer(ctx, page, [[2, 3], [4, 2]]);
    assertEqual(await timerState(page), OFF, 'after jittery tap');
    await ctx.close();
  }],
  ['Android: tapping the Off toggle turns the timer back on and the clock runs', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    await touchTimer(ctx, page);
    assertEqual(await timerState(page), OFF, 'after first tap');
    await touchTimer(ctx, page);
    assertEqual(await timerState(page), ON, 'after second tap');
    await ctx.close();
  }],
  ['Android: a touch that starts on the clock and slides away leaves the timer on', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    await touchTimer(ctx, page, slideAway);
    assertEqual(await timerState(page), ON, 'after slide');
    const untimedWrites = await page.evaluate(() => (window.__FAKE_FB_WRITES || []).filter(w => w.path === 'playerStats/dad' && w.data.timerChoice === 'untimed').length);
    assertEqual(untimedWrites, 0, 'cloud writes of untimed');
    await ctx.close();
  }],
  ['Android: a short drag (30px) on the clock is not a tap', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    await touchTimer(ctx, page, [[0, 15], [0, 30]]);
    assertEqual(await timerState(page), ON, 'after short drag');
    await ctx.close();
  }],
  ['Android: a touch the browser cancels leaves the timer on', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    await touchTimer(ctx, page, [], 'touchCancel');
    assertEqual(await timerState(page), ON, 'after touchcancel');
    await ctx.close();
  }],
  ['Android: a real scroll gesture starting on the clock leaves the timer on', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    const box = await page.locator('#timer-widget button').boundingBox();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, yDistance: -300, gestureSourceType: 'touch', speed: 800 });
    await page.waitForTimeout(600);
    assertEqual(await timerState(page), ON, 'after scroll gesture');
    await ctx.close();
  }],
  ['Android: sliding across the Off toggle does not turn the timer on', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, ANDROID);
    await touchTimer(ctx, page);
    assertEqual(await timerState(page), OFF, 'turned off by tap');
    await touchTimer(ctx, page, slideAway);
    assertEqual(await timerState(page), OFF, 'after slide over Off toggle');
    await ctx.close();
  }],
  ['iPhone: slide away leaves the timer on; a tap still turns it off', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, IPHONE);
    await touchTimer(ctx, page, slideAway);
    assertEqual(await timerState(page), ON, 'after slide');
    await touchTimer(ctx, page);
    assertEqual(await timerState(page), OFF, 'after tap');
    await ctx.close();
  }],
  ['desktop: clicking the clock turns it off, clicking again turns it on', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, false);
    await page.click('#timer-widget button'); await page.waitForTimeout(400);
    assertEqual(await timerState(page), OFF, 'after first click');
    await page.click('#timer-widget button'); await page.waitForTimeout(400);
    assertEqual(await timerState(page), ON, 'after second click');
    await ctx.close();
  }],
  ['signed-in timed solve records the time (score + leaderboard entry), even after a slide on the clock', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, false);
    // A stray slide first (desktop page still accepts CDP touch input).
    await touchTimer(ctx, page, slideAway);
    assertEqual(await timerState(page), ON, 'timer still on after the slide');
    // 10/30 Easy: at -> tan -> neat -> taken. The game shows one word box
    // at a time (the active rung), so fill whichever rung is active.
    const words = { 3: 'tan', 4: 'neat' };
    for(let i = 0; i < 4 && !(await page.evaluate(() => isTierComplete('easy'))); i++){
      const len = await page.evaluate(() => activeLength);
      await page.click(`#rung-input-${len}`); // the touch moved focus off the word box
      await page.keyboard.type(words[len], { delay: 30 });
      await page.waitForTimeout(500);
    }
    assertEqual(await page.evaluate(() => isTierComplete('easy')), true, 'puzzle solved');
    await page.waitForTimeout(1500);
    const writes = await page.evaluate(() => (window.__FAKE_FB_WRITES || []).filter(w => w.path === 'scores/dad_2026-10-30_easy' || w.path === 'leaderboardEntries/dad_2026-10-30_easy'));
    const paths = writes.map(w => w.path).sort();
    assertEqual(paths, ['leaderboardEntries/dad_2026-10-30_easy', 'scores/dad_2026-10-30_easy'], 'timed records written');
    const ok = writes.every(w => w.data.timeMs > 0 && w.data.uid === 'dad' && w.data.displayName === 'dad');
    assertEqual(ok, true, 'records have a time and belong to the player');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
