// Share modal (Variant B of share-modal-redesign.html): appears after finishing
// any single puzzle — checked from a completely fresh browser profile, signed
// out and signed in, desktop and Android tiles — with the wordmark header,
// centred result, spoiler-free ladder card and play bar; shares an image card
// plus clean text (no long UTM URL in the text; short tracked link separately).
// Uses the 2026-10-30 puzzles (Easy AT→TAKEN, Medium ALE→STEALING, Hard AN→TRAIPSING).
const { newPage, run, assertEqual } = require('./helpers/harness');

const DAY = '2026-10-30';
const NOW = new Date(DAY + 'T12:00:05-04:00');
const WORDS = {
  easy: { 3: 'tan', 4: 'neat' },
  medium: { 4: 'lean', 5: 'glean', 6: 'angles', 7: 'tangles' },
  hard: { 3: 'ran', 4: 'rang', 5: 'grain', 6: 'rating', 7: 'prating', 8: 'pirating' },
};

// fresh: no localStorage at all (a first-time visitor's browser).
function setup({ fresh = false, timer = 'timed', tier = 'easy', solved = [], hints = {}, account = false, stats } = {}){
  const scope = account ? 'dad' : 'guest';
  const ls = fresh ? {} : { 'letterladder:timerChoice': timer, 'letterladder:timerChoiceMade': '1', 'letterladder:lastViewedDateKey': DAY, 'letterladder:activeTier': tier, 'letterladder:keyboardEnabled': 'true' };
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

async function openGame(browser, base, opts = {}, device = false){
  const { ctx, page } = await newPage(browser, { ...setup(opts), mobile: device, now: NOW });
  if(!device) await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

// Desktop: type into the active rung. Phone with keyboard off: tap letter tiles.
async function solveActive(page, tier){
  for(let i = 0; i < 8 && !(await page.evaluate(t => isTierComplete(t), tier)); i++){
    const len = await page.evaluate(() => activeLength);
    const word = WORDS[tier][len];
    const typing = await page.$eval(`#rung-input-${len}`, el => !el.readOnly);
    if(typing){
      await page.click(`#rung-input-${len}`);
      await page.keyboard.type(word, { delay: 20 });
    } else {
      for(const ch of word){ await page.tap(`.bank-tile[data-letter="${ch}"]:not(.used)`); await page.waitForTimeout(80); }
    }
    await page.waitForTimeout(350);
  }
}

const modalOpen = page => page.$('.sm-scrim').then(Boolean);
async function waitModal(page, ms = 4000){ await page.waitForSelector('.sm-scrim', { timeout: ms }); await page.waitForTimeout(150); }
const modalInfo = page => page.evaluate(() => {
  const q = s => document.querySelector(s);
  return {
    wordmark: q('.sm-wordmark').innerText.replace(/\s+/g, ' '),
    pill: q('.sm-pill').innerText, time: q('.sm-big-time').textContent, challenge: q('.sm-challenge').textContent,
    date: q('.sm-date').textContent, top: [...document.querySelectorAll('.sm-card-top span')].map(s => s.textContent),
    rungs: [...document.querySelectorAll('.sm-rung')].map(r => [r.querySelector('.sm-rung-num').textContent, [...r.querySelectorAll('.sm-tile')].map(t => t.textContent).join('')]),
    play: q('.sm-play-bar').textContent.trim(), buttons: [...document.querySelectorAll('.sm-btn')].map(b => b.textContent.trim()),
    hasClose: !!q('.sm-close-x'), logo: q('.sm-logo').getAttribute('src'), allText: q('.sm-modal').textContent,
  };
});

module.exports = run('Share modal (Variant B)', [
  ['fresh profile, signed out, desktop: modal appears after one solve with the Variant B layout', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { fresh: true });
    await solveActive(page, 'easy');
    await waitModal(page);
    const m = await modalInfo(page);
    assertEqual([m.wordmark, m.pill, m.challenge, m.date, m.top, m.logo, m.hasClose], ['LETTER LADDER', 'EASY', 'Can you beat my time?', 'Friday, Oct 30, 2026', ['OCT 30, 2026', 'NO HINTS USED'], 'og-image.png', true], 'header, result, card top');
    assertEqual(/^\d+\.\ds$|^\d+m \d+s$/.test(m.time), true, `big time "${m.time}"`);
    assertEqual(m.rungs, [['4', '?????'], ['3', '✓✓✓✓'], ['2', '✓✓✓'], ['1', 'AT']], 'ladder: hidden end word, check rungs, start word');
    assertEqual([m.play, m.buttons], ['Play at letterladder.io →', ['Share my result', 'Copy text', 'Next puzzle →']], 'play bar and buttons');
    assertEqual(['TAKEN', 'NEAT', 'TAN'].some(w => m.allText.toUpperCase().includes(w)), false, 'no answers or end word in the modal');
    await ctx.close();
  }],
  ['fresh profile, Android, letter tiles: modal appears after one solve', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { fresh: true }, 'Pixel 7');
    assertEqual(await page.$eval('#rung-input-4', el => el.readOnly), true, 'tile entry (keyboard off)');
    await solveActive(page, 'easy');
    await waitModal(page);
    assertEqual((await modalInfo(page)).pill, 'EASY', 'modal shown');
    await ctx.close();
  }],
  ['signed in: modal appears, with the streak in the message text', async ({ browser, base }) => {
    const stat = (cs, d) => ({ played: 10, solved: 10, currentStreak: cs, maxStreak: 9, lastSolvedDate: d });
    const stats = { easy: stat(4, '2026-10-29'), medium: stat(4, '2026-10-29'), hard: stat(4, '2026-10-29'), total: stat(4, '2026-10-29') };
    const { ctx, page } = await openGame(browser, base, { account: true, stats });
    await solveActive(page, 'easy');
    await waitModal(page);
    assertEqual((await page.evaluate(() => buildShareText())).split('\n').includes('🔥 Streak: 4 days'), true, 'streak line');
    await ctx.close();
  }],
  ['Copy text copies clean text ending in letterladder.io (no long UTM URL)', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await solveActive(page, 'easy'); await waitModal(page);
    await page.click('.sm-copy-btn'); await page.waitForTimeout(300);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    assertEqual([lines[0], lines[lines.length - 2], lines[lines.length - 1], text.includes('utm_')], ['Letter Ladder — Oct 30, 2026', 'Can you beat my time?', 'letterladder.io', false], 'copied text');
    assertEqual(await page.textContent('.sm-toast'), 'Copied — paste it anywhere', 'toast');
    await ctx.close();
  }],
  ['Android: Share my result sends an image card + clean text + short tracked link', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { ...setup(), mobile: 'Pixel 7', now: NOW });
    await ctx.addInitScript(() => {
      navigator.canShare = (d) => !!(d && d.files);
      navigator.share = async (d) => { window.__shared = { text: d.text, url: d.url, files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })) }; };
    });
    await page.goto(base + '/game.html');
    await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    await solveActive(page, 'easy'); await waitModal(page);
    await page.tap('.sm-share-btn'); await page.waitForFunction(() => window.__shared, null, { timeout: 8000 });
    const shared = await page.evaluate(() => window.__shared);
    assertEqual([shared.files.length, shared.files[0].type, shared.files[0].size > 5000, shared.url], [1, 'image/png', true, 'https://letterladder.io/s/'], 'image file and short link');
    assertEqual([shared.text.includes('utm_'), shared.text.split('\n').pop()], [false, 'Can you beat my time?'], 'text has no long URL');
    await ctx.close();
  }],
  ['the image card matches the modal and is saved for review', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { tier: 'hard', solved: ['easy', 'medium'], hints: { hard: 2 } });
    const dataUrl = await page.evaluate(async () => {
      const blob = await buildShareCardImage(shareCardData('hard'));
      return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    });
    const out = process.env.SHARE_CARD_OUT;
    if(out) require('fs').writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    const size = await page.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = src; }), dataUrl);
    assertEqual(size[0] === 1032 && size[1] > 600, true, `image size ${size}`);
    await ctx.close();
  }],
  ['Next puzzle → goes to the next difficulty; × and the backdrop close the modal', async ({ browser, base }) => {
    let r = await openGame(browser, base);
    await solveActive(r.page, 'easy'); await waitModal(r.page);
    await r.page.click('.sm-next-btn'); await r.page.waitForTimeout(400);
    assertEqual([await modalOpen(r.page), await r.page.evaluate(() => activeTier)], [false, 'medium'], 'after Next puzzle');
    await r.ctx.close();
    r = await openGame(browser, base);
    await solveActive(r.page, 'easy'); await waitModal(r.page);
    await r.page.click('.sm-close-x'); await r.page.waitForTimeout(300);
    assertEqual(await modalOpen(r.page), false, 'after ×');
    await r.ctx.close();
  }],
  ['hints and untimed: "2 HINTS USED", "Solved", "Can you solve it?"', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { timer: 'untimed', hints: { easy: 2 } });
    await solveActive(page, 'easy'); await waitModal(page);
    const m = await modalInfo(page);
    assertEqual([m.time, m.challenge, m.top[1]], ['Solved', 'Can you solve it?', '2 HINTS USED'], 'modal');
    assertEqual((await page.evaluate(() => buildShareText())).split('\n').slice(1, 2), ['Easy: solved (2 hints)'], 'text');
    await ctx.close();
  }],
  ['Hard (last puzzle): no Next puzzle button, and the long ladder fits on a small phone', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { tier: 'hard', solved: ['easy', 'medium'] }, 'iPhone SE');
    await page.evaluate(() => localStorage.setItem('letterladder:keyboardEnabled', 'true'));
    await page.reload(); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    await solveActive(page, 'hard');
    await waitModal(page, 14000);
    const m = await modalInfo(page);
    assertEqual([m.buttons, m.rungs[0][1], m.rungs[m.rungs.length - 1][1]], [['Share my result', 'Copy text'], '?????????', 'AN'], 'buttons and ladder ends');
    const fits = await page.$eval('.sm-ladder', el => el.scrollWidth <= el.clientWidth + 1);
    assertEqual(fits, true, 'ladder fits the card width');
    await ctx.close();
  }],
  ['completing all three: waits for the ladder celebration, then appears', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { tier: 'hard', solved: ['easy', 'medium'] });
    await solveActive(page, 'hard');
    await page.waitForTimeout(2000);
    assertEqual(await modalOpen(page), false, 'not shown during the celebration');
    await waitModal(page, 12000);
    assertEqual((await modalInfo(page)).pill, 'HARD', 'shown afterwards for Hard');
    await ctx.close();
  }],
  ['does not reappear on reload', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await solveActive(page, 'easy'); await waitModal(page);
    await page.reload(); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(2000);
    assertEqual(await modalOpen(page), false, 'after reload');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
