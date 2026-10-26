// Play button on the landing page: one tap must start the game, on touch
// devices too. iOS Safari cancels a tap if the tapped element is removed
// from the page mid-tap, so the button must not be replaced when auth
// finishes loading. (Chromium's touch emulation can't reproduce Safari's
// cancellation itself; these tests guard the cause and the single-tap flow.)
const { newPage, run, assertEqual } = require('./helpers/harness');

const SIGNED_IN = {
  fake: { user: { uid: 'u1', isAnonymous: false }, docs: { 'players/u1': { username: 'tester' } } },
  localStorage: { 'letterladder:accountUsername': 'tester' },
};

async function buttonSurvivesAuth(browser, base, opts){
  const { ctx, page } = await newPage(browser, { ...opts, mobile: true, fake: { ...opts.fake, authDelayMs: 800 } });
  await page.goto(base + '/index.html');
  await page.evaluate(() => { window.__playBtn = document.querySelector('.play-btn-full'); });
  await page.waitForFunction(() => window.__FAKE_FB_AUTH_FIRED > 0);
  await page.waitForTimeout(300);
  const same = await page.evaluate(() => window.__playBtn === document.querySelector('.play-btn-full') && window.__playBtn.isConnected);
  await ctx.close();
  return same;
}

// Touch starts before auth resolves and ends after it, like a tap landing
// just as the page finishes loading.
async function tapAcrossAuth(browser, base, opts){
  const { ctx, page } = await newPage(browser, { ...opts, mobile: true, fake: { ...opts.fake, authDelayMs: 800 } });
  await page.goto(base + '/index.html');
  const box = await page.locator('.play-btn-full').boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForFunction(() => window.__FAKE_FB_AUTH_FIRED > 0);
  await page.waitForTimeout(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  let navigated = true;
  try{ await page.waitForURL(/game\.html/, { timeout: 3000 }); }catch(e){ navigated = false; }
  await ctx.close();
  return navigated;
}

async function simpleTap(browser, base, opts){
  const { ctx, page } = await newPage(browser, { ...opts, mobile: true });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__FAKE_FB_AUTH_FIRED > 0);
  await page.tap('.play-btn-full');
  let navigated = true;
  try{ await page.waitForURL(/game\.html/, { timeout: 3000 }); }catch(e){ navigated = false; }
  await ctx.close();
  return navigated;
}

module.exports = run('Play button (mobile emulation)', [
  ['guest: Play button is not replaced when auth finishes loading', async ({ browser, base }) => {
    assertEqual(await buttonSurvivesAuth(browser, base, { fake: { user: null } }), true, 'same button element');
  }],
  ['signed-in: Play button is not replaced when auth finishes loading', async ({ browser, base }) => {
    assertEqual(await buttonSurvivesAuth(browser, base, SIGNED_IN), true, 'same button element');
  }],
  ['guest: a tap spanning auth loading starts the game in one tap', async ({ browser, base }) => {
    assertEqual(await tapAcrossAuth(browser, base, { fake: { user: null } }), true, 'navigated to game');
  }],
  ['signed-in: a tap spanning auth loading starts the game in one tap', async ({ browser, base }) => {
    assertEqual(await tapAcrossAuth(browser, base, SIGNED_IN), true, 'navigated to game');
  }],
  ['guest: single tap after load starts the game', async ({ browser, base }) => {
    assertEqual(await simpleTap(browser, base, { fake: { user: null } }), true, 'navigated to game');
  }],
  ['signed-in: single tap after load starts the game', async ({ browser, base }) => {
    assertEqual(await simpleTap(browser, base, SIGNED_IN), true, 'navigated to game');
  }],
]).then(failed => process.exit(failed ? 1 : 0));
