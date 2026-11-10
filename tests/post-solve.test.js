// Game page: "Missed a day?" link before and after solving (same post-solve
// row for a typed solve and a View solution finish), leaderboard rank line,
// View solution first click, immediate Clear, load skeleton (no footer jump),
// and "Play today's puzzle" always opening today's game.
const { newPage, run, assertEqual } = require('./helpers/harness');
const fs = require('fs'), path = require('path'), vm = require('vm');

const DAY = '2026-10-30';
const NOW = new Date(DAY + 'T12:00:05-04:00');
const sched = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'puzzles.js'), 'utf8') + ';this.S=PUZZLE_SCHEDULE;', sched);
const PAST = Object.keys(sched.S).filter(k => k < DAY).reduce((n, k) => n + Object.keys(sched.S[k]).length, 0);
const LINK_TEXT = `Missed a day? Play ${PAST} past puzzles here`;

function base(extra = {}){
  return { 'letterladder:timerChoice': 'timed', 'letterladder:timerChoiceMade': '1', 'letterladder:lastViewedDateKey': DAY, 'letterladder:activeTier': 'easy', 'letterladder:keyboardEnabled': 'true', ...extra };
}
async function openGame(browser, b, { ls = base(), fake = { user: null }, url = '/game.html', device = false } = {}){
  const { ctx, page } = await newPage(browser, { fake, localStorage: ls, mobile: device, now: NOW });
  await page.goto(b + url);
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}
async function typeWord(page, word){ const len = await page.evaluate(() => activeLength); await page.click(`#rung-input-${len}`); await page.keyboard.type(word, { delay: 20 }); await page.waitForTimeout(400); }
const linkInfo = page => page.evaluate(() => {
  const a = document.getElementById('past-puzzles-link'); if(!a) return null;
  const sol = document.getElementById('solution-link'), next = document.getElementById('next-puzzle-btn');
  return { text: a.textContent.trim(), href: a.getAttribute('href'), dotted: getComputedStyle(a).borderBottomStyle,
    belowSolution: a.getBoundingClientRect().top > sol.getBoundingClientRect().bottom,
    belowNext: next ? a.getBoundingClientRect().top > next.getBoundingClientRect().bottom : null };
});

module.exports = run('Game page post-solve and loading', [
  ['before solving: "Missed a day?" link shows (under View solution, dotted)', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b);
    const l = await linkInfo(page);
    assertEqual([l.text, l.href, l.dotted, l.belowSolution], [LINK_TEXT, 'past-puzzles.html', 'dotted', true], 'link');
    await ctx.close();
  }],
  ['after a typed solve: Next puzzle, then the link', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b);
    await typeWord(page, 'neat'); await typeWord(page, 'tan');
    await page.waitForSelector('.sm-scrim'); await page.click('.sm-close-x'); await page.waitForTimeout(300);
    const l = await linkInfo(page);
    assertEqual([l.text, l.belowNext], [LINK_TEXT, true], 'link under Next puzzle');
    await ctx.close();
  }],
  ['after finishing with View solution (Hard too): same post-solve row', async ({ browser, base: b }) => {
    for(const [tier, hasNext] of [['medium', true], ['hard', false]]){
      const sol = { medium: { 4: 'lean', 5: 'glean', 6: 'angles', 7: 'tangles' }, hard: { 3: 'ran', 4: 'rang', 5: 'grain', 6: 'rating', 7: 'prating', 8: 'pirating' } }[tier];
      const ls = base({ 'letterladder:activeTier': tier, [`letterladder:guest:${DAY}:${tier}`]: JSON.stringify(sol), [`letterladder:guest:${DAY}:${tier}:solutionRevealedAsLoss`]: '1', [`letterladder:guest:${DAY}:${tier}:lossCounted`]: '1' });
      const { ctx, page } = await openGame(browser, b, { ls });
      const l = await linkInfo(page);
      assertEqual([l.text, l.belowNext === null ? 'no next' : 'next'], [LINK_TEXT, hasNext ? 'next' : 'no next'], `${tier} revealed`);
      assertEqual(l.belowSolution, false, `${tier}: link sits in the post-solve row, not at the bottom`);
      await ctx.close();
    }
  }],
  ['timed solve: "You finished Easy in … — that\'s #3 today" with a leaderboard link', async ({ browser, base: b }) => {
    const docs = {
      'leaderboardEntries/a': { date: DAY, tier: 'easy', timeMs: 100, visible: true, uid: 'x1' },
      'leaderboardEntries/b': { date: DAY, tier: 'easy', timeMs: 200, visible: true, uid: 'x2' },
      'leaderboardEntries/c': { date: DAY, tier: 'easy', timeMs: 300, visible: false, uid: 'x3' },      // hidden: not counted
      'leaderboardEntries/d': { date: DAY, tier: 'medium', timeMs: 50, visible: true, uid: 'x4' },     // other tier
      'leaderboardEntries/e': { date: DAY, tier: 'easy', timeMs: 9999999, visible: true, uid: 'x5' },  // slower
    };
    const { ctx, page } = await openGame(browser, b, { fake: { user: null, docs } });
    await typeWord(page, 'neat'); await typeWord(page, 'tan');
    await page.waitForSelector('.sm-scrim'); await page.click('.sm-close-x');
    await page.waitForFunction(() => /#\d+ today/.test((document.getElementById('leaderboard-rank') || {}).textContent || ''), null, { timeout: 5000 });
    const r = await page.evaluate(() => ({ text: document.getElementById('leaderboard-rank').textContent, href: document.querySelector('#leaderboard-rank a').getAttribute('href') }));
    assertEqual([/^You finished Easy in [\d.]+s — that's #3 today · View leaderboard$/.test(r.text), r.href], [true, 'leaderboard.html'], `rank line "${r.text}"`);
    await ctx.close();
  }],
  ['untimed solve: no rank line', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b, { ls: base({ 'letterladder:timerChoice': 'untimed' }) });
    await typeWord(page, 'neat'); await typeWord(page, 'tan'); await page.waitForTimeout(1500);
    assertEqual(await page.$('#leaderboard-rank').then(Boolean), false, 'rank line');
    await ctx.close();
  }],
  ['View solution works on the first click even while a rung box is focused', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b);
    await page.click('#rung-input-4'); await page.keyboard.type('ne', { delay: 20 });
    await page.click('#solution-link'); await page.waitForTimeout(400);
    assertEqual(await page.$('.confirm-overlay').then(Boolean), true, 'confirm dialog after one click');
    await ctx.close();
  }],
  ['Clear puzzle empties the grid immediately after confirming', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b);
    await typeWord(page, 'neat');
    await page.click('#clear-btn'); await page.waitForSelector('.confirm-ok');
    await page.click('.confirm-ok'); await page.waitForTimeout(120);
    const state = await page.evaluate(() => ({ guesses: loadGuesses('easy'), fading: !!document.querySelector('.ladder.fading-out'), filled: [...document.querySelectorAll('.rung')].filter(r => !r.classList.contains('anchor') && (r.value || r.textContent).trim()).length }));
    assertEqual(state, { guesses: {}, fading: false, filled: 0 }, 'cleared within ~0.1s');
    await ctx.close();
  }],
  ['loading: skeleton ladder right away, footer hidden until the game is drawn (no jump)', async ({ browser, base: b }) => {
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await newPage(browser, { fake: { user: null, authDelayMs: 1500 }, localStorage: base(), mobile: device, now: NOW });
      await page.goto(b + '/game.html'); await page.waitForTimeout(300);
      const early = await page.evaluate(() => ({ rungs: document.querySelectorAll('#panel .rung').length, panelVisible: getComputedStyle(document.getElementById('panel')).visibility, footer: getComputedStyle(document.querySelector('footer')).visibility, ladderBottom: Math.round(document.querySelector('#panel .ladder').getBoundingClientRect().bottom) }));
      assertEqual([early.rungs, early.panelVisible, early.footer], [4, 'visible', 'hidden'], `while loading (${device || 'desktop'})`);
      await page.waitForFunction(() => accountScopeReady === true, null, { timeout: 15000 }); await page.waitForTimeout(300);
      const late = await page.evaluate(() => ({ footer: getComputedStyle(document.querySelector('footer')).visibility, footerTop: Math.round(document.querySelector('footer').getBoundingClientRect().top), ladderBottom: Math.round(document.querySelector('#panel .ladder').getBoundingClientRect().bottom) }));
      assertEqual(late.footer, 'visible', 'footer shown once drawn');
      assertEqual(Math.abs(late.ladderBottom - early.ladderBottom) <= 2, true, `ladder did not move (${early.ladderBottom} → ${late.ladderBottom})`);
      assertEqual(late.footerTop > late.ladderBottom, true, 'footer below the game');
      await ctx.close();
    }
  }],
  ['"Play today\'s puzzle" (game.html?play=today) opens today\'s game even on a new day', async ({ browser, base: b }) => {
    const ls = base({ 'letterladder:lastViewedDateKey': '2026-10-29', 'letterladder:activeTier': 'hard' });
    const { ctx, page } = await openGame(browser, b, { ls, url: '/game.html?play=today' });
    assertEqual([page.url().includes('game.html'), await page.evaluate(() => [dateKey, activeTier])], [true, [DAY, 'easy']], 'opened today on Easy');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
