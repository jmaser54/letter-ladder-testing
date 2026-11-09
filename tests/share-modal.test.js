// Share modal: appears after finishing any single puzzle, previews the exact
// text that is shared/copied (spoiler-free, tracked link), lists only the
// puzzles finished today, and replaces the old "Share results" link.
// Uses the 2026-10-30 puzzles (Easy AT→TAKEN, Medium ALE→STEALING, Hard AN→TRAIPSING).
const { newPage, run, assertEqual } = require('./helpers/harness');
const fs = require('fs'), path = require('path'), vm = require('vm');

const DAY = '2026-10-30';
const NOW = new Date(DAY + 'T12:00:05-04:00');
const LINK = 'letterladder.io/?utm_source=share&utm_medium=social&utm_campaign=share_results';
const WORDS = {
  easy: { 3: 'tan', 4: 'neat' },
  medium: { 4: 'lean', 5: 'glean', 6: 'angles', 7: 'tangles' },
  hard: { 3: 'ran', 4: 'rang', 5: 'grain', 6: 'rating', 7: 'prating', 8: 'pirating' },
};
const sched = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'puzzles.js'), 'utf8') + ';this.S=PUZZLE_SCHEDULE;', sched);
const PAST_COUNT = Object.keys(sched.S).filter(k => k < DAY).reduce((n, k) => n + Object.keys(sched.S[k]).length, 0);

function setup({ timer = 'timed', tier = 'easy', solved = [], hints = {}, account = false, stats } = {}){
  const scope = account ? 'dad' : 'guest';
  const ls = { 'letterladder:timerChoice': timer, 'letterladder:timerChoiceMade': '1', 'letterladder:howToPlaySeen': '1', 'letterladder:lastViewedDateKey': DAY, 'letterladder:activeTier': tier, 'letterladder:keyboardEnabled': 'true' };
  for(const t of solved){
    ls[`letterladder:${scope}:${DAY}:${t}`] = JSON.stringify(WORDS[t]);
    for(const flag of ['solvedCounted', 'playedCounted', 'startedCounted']) ls[`letterladder:${scope}:${DAY}:${t}:${flag}`] = '1';
  }
  for(const [t, n] of Object.entries(hints)) ls[`letterladder:${scope}:${DAY}:${t}:hintsUsed`] = String(n);
  const fake = { user: null };
  if(account){
    Object.assign(ls, { 'letterladder:accountUsername': 'dad', 'letterladder:dad:ownerUid': 'dad' });
    if(stats) ls['letterladder:dad:stats'] = JSON.stringify(stats);
    fake.user = { uid: 'dad', isAnonymous: false };
    fake.docs = { 'players/dad': { username: 'dad' } };
  }
  return { fake, localStorage: ls };
}

async function openGame(browser, base, opts = {}, device = false, url = '/game.html'){
  const { ctx, page } = await newPage(browser, { ...setup(opts), mobile: device, now: NOW });
  if(!device) await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(base + url);
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

async function solveActive(page, tier){
  for(let i = 0; i < 8 && !(await page.evaluate(t => isTierComplete(t), tier)); i++){
    const len = await page.evaluate(() => activeLength);
    await page.click(`#rung-input-${len}`);
    await page.keyboard.type(WORDS[tier][len], { delay: 20 });
    await page.waitForTimeout(350);
  }
}

const modalText = page => page.$eval('.share-modal-overlay .share-preview', el => el.textContent);
const modalOpen = page => page.$('.share-modal-overlay').then(Boolean);
async function waitModal(page, ms = 4000){ await page.waitForSelector('.share-modal-overlay', { timeout: ms }); return modalText(page); }

module.exports = run('Share modal', [
  ['finishing one puzzle opens the modal with the exact spoiler-free text; old link is gone', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await solveActive(page, 'easy');
    const text = await waitModal(page);
    const lines = text.split('\n');
    assertEqual(lines[0], 'Letter Ladder — Oct 30, 2026', 'date line');
    assertEqual(/^Easy: (\d+\.\d)s$|^Easy: \d+m \d+s$/.test(lines[1]), true, `time line "${lines[1]}"`);
    assertEqual(lines.slice(2), [LINK, 'Can you beat my time?'], 'link and closing lines');
    assertEqual(['tan', 'neat', 'taken', 'TAN', 'NEAT', 'TAKEN'].some(w => text.includes(w)), false, 'no answers in the text');
    assertEqual(await page.$$eval('a', as => as.filter(a => /share results/i.test(a.textContent)).length), 0, 'old "Share results" link removed');
    assertEqual(await page.$eval('.share-modal-share', b => [b.textContent.trim(), b.className.includes('btn-primary')]), ['Share Results', true], 'orange Share Results button');
    await ctx.close();
  }],
  ['desktop: Share Results copies exactly the previewed text and confirms "Copied!"', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await solveActive(page, 'easy');
    const text = await waitModal(page);
    await page.click('.share-modal-share'); await page.waitForTimeout(300);
    assertEqual(await page.evaluate(() => navigator.clipboard.readText()), text, 'clipboard content');
    assertEqual(await page.textContent('.share-modal-status'), 'Copied!', 'confirmation');
    await ctx.close();
  }],
  ['Android: Share Results opens the native share sheet with exactly the previewed text', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { ...setup(), mobile: 'Pixel 7', now: NOW });
    await ctx.addInitScript(() => { navigator.share = async (data) => { window.__shared = data; }; });
    await page.goto(base + '/game.html');
    await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    await solveActive(page, 'easy');
    const text = await waitModal(page);
    await page.tap('.share-modal-share'); await page.waitForTimeout(300);
    assertEqual(await page.evaluate(() => window.__shared), { text }, 'shared data');
    await ctx.close();
  }],
  ['Next puzzle goes to the next difficulty; Close and × close the modal', async ({ browser, base }) => {
    let r = await openGame(browser, base);
    await solveActive(r.page, 'easy'); await waitModal(r.page);
    await r.page.click('.share-modal-next'); await r.page.waitForTimeout(400);
    assertEqual([await modalOpen(r.page), await r.page.evaluate(() => activeTier)], [false, 'medium'], 'after Next puzzle');
    await r.ctx.close();
    r = await openGame(browser, base);
    await solveActive(r.page, 'easy'); await waitModal(r.page);
    await r.page.click('.share-modal-close'); await r.page.waitForTimeout(300);
    assertEqual(await modalOpen(r.page), false, 'after Close');
    await r.ctx.close();
  }],
  ['lists only puzzles finished today, with hints used', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { tier: 'medium', solved: ['easy'], hints: { easy: 1, medium: 0 } });
    await solveActive(page, 'medium');
    const lines = (await waitModal(page)).split('\n');
    assertEqual(lines[1], 'Easy: solved (1 hint)', 'easy line (finished earlier, untimed)');
    assertEqual(/^Medium: /.test(lines[2]) && !lines.some(l => l.startsWith('Hard')), true, `medium listed, hard not: ${JSON.stringify(lines)}`);
    await ctx.close();
  }],
  ['signed-in player: streak line is included', async ({ browser, base }) => {
    const stat = (cs, d) => ({ played: 10, solved: 10, currentStreak: cs, maxStreak: 9, lastSolvedDate: d });
    const stats = { easy: stat(4, '2026-10-29'), medium: stat(4, '2026-10-29'), hard: stat(4, '2026-10-29'), total: stat(4, '2026-10-29') };
    const { ctx, page } = await openGame(browser, base, { account: true, stats });
    await solveActive(page, 'easy');
    const lines = (await waitModal(page)).split('\n');
    assertEqual(lines.includes('🔥 Streak: 4 days'), true, `streak line in ${JSON.stringify(lines)}`);
    await ctx.close();
  }],
  ['untimed player: no time, and a closing line that fits', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { timer: 'untimed' });
    await solveActive(page, 'easy');
    assertEqual((await waitModal(page)).split('\n'), ['Letter Ladder — Oct 30, 2026', 'Easy: solved', LINK, 'Can you solve it?'], 'text');
    await ctx.close();
  }],
  ['completing all three: modal waits for the ladder celebration, then appears', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { tier: 'hard', solved: ['easy', 'medium'] });
    await solveActive(page, 'hard');
    await page.waitForTimeout(2000);
    assertEqual(await modalOpen(page), false, 'not shown during the celebration');
    const lines = (await waitModal(page, 12000)).split('\n');
    assertEqual(lines.slice(1, 4).map(l => l.split(':')[0]), ['Easy', 'Medium', 'Hard'], 'all three listed');
    await ctx.close();
  }],
  ['does not reappear on reload, and not for already-finished puzzles', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await solveActive(page, 'easy'); await waitModal(page);
    await page.reload(); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(2000);
    assertEqual(await modalOpen(page), false, 'after reload');
    await ctx.close();
  }],
  ['after finishing, the "Missed a day?" link shows under Next puzzle', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await solveActive(page, 'easy'); await waitModal(page);
    await page.click('.share-modal-close'); await page.waitForTimeout(300);
    const link = await page.$eval('#past-puzzles-link', a => [a.getAttribute('href'), a.textContent.trim(), a.getBoundingClientRect().height > 0]);
    assertEqual(link, ['past-puzzles.html', `Missed a day? Play past puzzles — ${PAST_COUNT} puzzles`, true], 'link');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
