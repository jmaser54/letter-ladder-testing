// Feedback below the puzzle: validation, progression checking, completion and
// hints. Uses the 2026-10-30 Easy puzzle (AT -> _ _ _ -> _ _ _ _ -> TAKEN).
// Each rejected guess produces exactly one message; the message area takes
// no space when empty; the red dot is centred on the message's first line.
const { newPage, run, assertEqual } = require('./helpers/harness');

const DAY = '2026-10-30';
const NOW = new Date(DAY + 'T12:00:05-04:00');

async function openGame(browser, base, { device = false, guesses } = {}){
  // keyboardEnabled: on phones the game is letter-tile-first; turning the
  // keyboard on (a player setting) lets the test type on mobile too.
  const ls = { 'letterladder:timerChoice': 'untimed', 'letterladder:howToPlaySeen': '1', 'letterladder:lastViewedDateKey': DAY, 'letterladder:activeTier': 'easy', 'letterladder:keyboardEnabled': 'true' };
  if(guesses) ls[`letterladder:guest:${DAY}:easy`] = JSON.stringify(guesses);
  const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: ls, mobile: device, now: NOW });
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

// Types into the currently active rung (the game shows one input at a time).
async function typeWord(page, word){
  const len = await page.evaluate(() => activeLength);
  await page.click(`#rung-input-${len}`);
  await page.keyboard.type(word, { delay: 25 });
  await page.waitForTimeout(400);
}
async function blurAway(page){ await page.click('h1.brand'); await page.waitForTimeout(400); }

const feedback = page => page.evaluate(() => {
  const el = document.querySelector('.feedback'); const r = el.getBoundingClientRect();
  return { messages: [...el.querySelectorAll('li')].map(li => li.textContent), text: el.textContent.trim(), height: Math.round(r.height), display: getComputedStyle(el).display };
});

module.exports = run('Feedback messages', [
  // ---- Input restrictions that make some old errors impossible ----
  ['the rung box only ever holds letters from the top word, within its counts (typing)', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await page.click('#rung-input-4');
    await page.keyboard.type('9! z-', { delay: 25 });        // digits, symbols, space, letter not in TAKEN
    assertEqual(await page.inputValue('#rung-input-4'), '', 'after non-letters / letters not in TAKEN');
    await page.keyboard.type('ttk', { delay: 25 });          // TAKEN has one T
    assertEqual(await page.inputValue('#rung-input-4'), 'tk', 'after repeating T');
    await ctx.close();
  }],
  ['the rung box only ever holds allowed letters (paste / autofill)', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await page.click('#rung-input-4');
    const cdp = await ctx.newCDPSession(page);
    // 4 characters, as the box's maxlength (4) also trims longer pastes.
    await cdp.send('Input.insertText', { text: 'z!ne' });
    await page.waitForTimeout(300);
    assertEqual(await page.inputValue('#rung-input-4'), 'ne', 'after pasting junk');
    await ctx.close();
  }],

  // ---- One message per rejected guess ----
  ['too short (typed part of a word, then tapped away): one length message', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await typeWord(page, 'nea'); await blurAway(page);
    assertEqual((await feedback(page)).messages, ['Guess must be 4 letters long'], 'messages');
    await ctx.close();
  }],
  ['not an English word: one message', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await typeWord(page, 'takn');
    assertEqual((await feedback(page)).messages, ['Not a valid English word'], 'messages');
    await ctx.close();
  }],
  ['real word missing a bottom-word letter: one message naming the letter', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await typeWord(page, 'kent');
    assertEqual((await feedback(page)).messages, ["Guess doesn't include every letter from the bottom word: A"], 'messages');
    await ctx.close();
  }],
  ['non-word that is also missing a letter: still just one message', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await typeWord(page, 'tken');
    assertEqual((await feedback(page)).messages, ["Guess doesn't include every letter from the bottom word: A"], 'messages');
    await ctx.close();
  }],
  ['a rejected guess is not saved, and an accepted guess clears the message', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await typeWord(page, 'takn');
    assertEqual(await page.evaluate(() => loadGuesses('easy')), {}, 'guesses after rejection');
    await typeWord(page, 'neat');
    assertEqual(await page.evaluate(() => loadGuesses('easy')), { 4: 'neat' }, 'guesses after acceptance');
    const fb = await feedback(page);
    assertEqual([fb.messages, fb.height], [[], 0], 'message area after acceptance');
    await ctx.close();
  }],

  ['Android, letter tiles (keyboard off): a non-word built from tiles gets one message', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { device: 'Pixel 7' });
    await page.evaluate(() => localStorage.setItem('letterladder:keyboardEnabled', 'false'));
    await page.reload(); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    assertEqual(await page.$eval(`#rung-input-4`, el => el.readOnly), true, 'keyboard off (tile entry)');
    for(const letter of 'takn'){
      await page.tap(`.bank-tile[data-letter="${letter}"]:not(.used)`); await page.waitForTimeout(150);
    }
    await page.waitForTimeout(400);
    assertEqual((await feedback(page)).messages, ['Not a valid English word'], 'messages');
    await ctx.close();
  }],

  // ---- Invalid progression: one message, no heading, no ❌ ----
  ['invalid progression (missing letter): single message', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await typeWord(page, 'take');
    await typeWord(page, 'tan');
    const fb = await feedback(page);
    assertEqual(fb.messages, ['Invalid progression — "TAKE" is missing the "N" from "TAN"'], 'messages');
    assertEqual([fb.text.includes('❌'), await page.$$eval('.details', els => els.length)], [false, 0], 'no ❌ or separate detail line');
    await ctx.close();
  }],
  ['invalid progression (not a one-letter step): single message', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { guesses: { 3: 'ta', 4: 'neat' } });
    assertEqual((await feedback(page)).messages, ['Invalid progression — "AT" → "TA" isn\'t a valid one-letter step'], 'messages');
    await ctx.close();
  }],

  // ---- Completion and hints keep working ----
  ['solving the puzzle: no message, area collapsed, puzzle complete, Next puzzle shown', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await typeWord(page, 'neat');
    await typeWord(page, 'tan');
    const fb = await feedback(page);
    assertEqual([fb.text, fb.height], ['', 0], 'message area');
    assertEqual(await page.evaluate(() => [isTierComplete('easy'), isTierGenuinelyWon('easy'), !!document.getElementById('next-puzzle-btn')]), [true, true, true], 'complete / won / next button');
    await ctx.close();
  }],
  ['hint button still shows a hint for the active rung', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await page.click('#hint-btn'); await page.waitForTimeout(300);
    await page.click('.confirm-ok'); await page.waitForTimeout(400);   // "Are you sure you'd like to use a hint?"
    const hint = await page.evaluate(() => [document.getElementById('hint-display').textContent.trim(), getHintsUsed('easy')]);
    assertEqual([hint[0].length > 0, hint[1]], [true, 1], 'hint shown and counted');
    await ctx.close();
  }],

  // ---- Layout ----
  ['empty message area takes no vertical space (desktop and Android)', async ({ browser, base }) => {
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await openGame(browser, base, { device });
      const fb = await feedback(page);
      assertEqual([fb.text, fb.height, fb.display], ['', 0, 'none'], `empty area on ${device || 'desktop'}`);
      await ctx.close();
    }
  }],
  ['red dot is centred on the first line (one-line and wrapped messages)', async ({ browser, base }) => {
    for(const [device, guesses, word] of [[false, null, 'takn'], ['iPhone SE', { 3: 'tan' }, 'take']]){
      const { ctx, page } = await openGame(browser, base, { device, guesses: guesses || undefined });
      await typeWord(page, word);
      const m = await page.evaluate(() => {
        const li = document.querySelector('.error-list li'); const lr = li.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(li);
        const lines = [...new Set([...range.getClientRects()].map(r => Math.round(r.top)))];
        const first = range.getClientRects()[0];
        const b = getComputedStyle(li, '::before');
        const dotCenter = lr.top + parseFloat(b.top) + parseFloat(b.height) / 2;
        return { lines: lines.length, offset: Math.abs(dotCenter - (first.top + first.height / 2)) };
      });
      if(device === 'iPhone SE') assertEqual(m.lines > 1, true, 'message wraps on a narrow phone');
      assertEqual(m.offset <= 1, true, `dot centred on first line (off by ${m.offset.toFixed(2)}px, ${device || 'desktop'})`);
      await ctx.close();
    }
  }],
]).then(failed => process.exit(failed ? 1 : 0));
