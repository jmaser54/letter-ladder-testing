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
// The modal follows the celebration (confetti lasts up to ~4.2s) by ~1.2s.
async function waitModal(page, ms = 9000){ await page.waitForSelector('.sm-scrim', { timeout: ms }); await page.waitForTimeout(150); }
const modalInfo = page => page.evaluate(() => {
  const q = s => document.querySelector(s);
  return {
    wordmark: q('.sm-wordmark').innerText.replace(/\s+/g, ' '),
    pill: q('.sm-pill').innerText, time: q('.sm-big-time').textContent, challenge: q('.sm-challenge').textContent,
    date: q('.sm-date').textContent, cardText: q('.sm-card-body').textContent.replace(/\s+/g, ''),
    rungs: [...document.querySelectorAll('.sm-rung')].map(r => [...r.querySelectorAll('.sm-tile')].map(t => t.textContent).join('')),
    // Clean card: no top row or rung numbers; widest row centred, all rows share its left edge.
    layout: (() => { const body = q('.sm-card-body').getBoundingClientRect(), lad = q('.sm-ladder').getBoundingClientRect(), cs = getComputedStyle(q('.sm-card-body'));
      const inner = [body.left + parseFloat(cs.paddingLeft), body.right - parseFloat(cs.paddingRight)];
      return { topRow: !!q('.sm-card-top'), numbers: !!q('.sm-rung-num'), centred: Math.abs((lad.left + lad.right) / 2 - (inner[0] + inner[1]) / 2) <= 1,
        sameLeft: new Set([...document.querySelectorAll('.sm-rung')].map(r => Math.round(r.getBoundingClientRect().left))).size === 1,
        fits: [...document.querySelectorAll('.sm-tile')].every(t => { const b = t.getBoundingClientRect(); return b.left >= inner[0] - 0.5 && b.right <= inner[1] + 0.5; }) }; })(),
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
    assertEqual([m.wordmark, m.pill, m.challenge, m.date, m.logo, m.hasClose], ['LETTER LADDER', 'EASY', 'Can you beat my time?', 'Friday, Oct 30, 2026', 'og-image.png', true], 'header and result block (long date stays above the card)');
    assertEqual([m.layout, m.cardText.includes('OCT30'), m.cardText.includes('HINT')], [{ topRow: false, numbers: false, centred: true, sameLeft: true, fits: true }, false, false], 'clean card: no date, hints or rung numbers; ladder centred');
    assertEqual(/^\d+\.\ds$|^\d+m \d+s$/.test(m.time), true, `big time "${m.time}"`);
    assertEqual(m.rungs, ['?????', '✓✓✓✓', '✓✓✓', 'AT'], 'ladder: hidden end word, check rungs, start word');
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
  ['Copy text copies clean text ending in the short link letterladder.io/s/ (no long UTM URL)', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await solveActive(page, 'easy'); await waitModal(page);
    await page.click('.sm-copy-btn'); await page.waitForTimeout(300);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    assertEqual([lines[0], lines[lines.length - 2], lines[lines.length - 1], text.includes('utm_')], ['Letter Ladder — Oct 30, 2026', 'Can you beat my time?', 'letterladder.io/s/', false], 'copied text');
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
    // Clean card: no long date, no top row. Hard 2026-10-30 = 8 rows of 25px tiles:
    // 3 × (header/result 168 + card padding 14 + ladder 235 + 13 + play bar 48 + 18).
    assertEqual(size, [1032, 1488], 'image size (shorter: date and top row gone)');
    // The amber "?" row (the widest) is centred in the card (card spans x 18-326).
    const span = await page.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => {
      const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
      const y = Math.round((168 + 14 + 12.5) * 3), row = g.getImageData(0, y, i.width, 1).data; let L = -1, R = -1;
      for(let x = 0; x < i.width; x++){ const [rr, gg, bb] = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]]; if(Math.abs(rr - 232) < 12 && Math.abs(gg - 163) < 12 && Math.abs(bb - 61) < 12){ if(L < 0) L = x; R = x; } }
      r([L, R]); }; i.src = src; }), dataUrl);
    const off = (span[0] + span[1]) / 2 - 172 * 3;
    assertEqual(span[0] > 18 * 3 && span[1] < 326 * 3 && Math.abs(off) <= 3, true, `"?" row ${span} is inside the card and centred (off by ${off}px)`);
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
  ['hints and untimed: card shows no hints line; text keeps "(2 hints)"; "Solved", "Can you solve it?"', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { timer: 'untimed', hints: { easy: 2 } });
    await solveActive(page, 'easy'); await waitModal(page);
    const m = await modalInfo(page);
    assertEqual([m.time, m.challenge, m.cardText.includes('HINT')], ['Solved', 'Can you solve it?', false], 'modal');
    assertEqual((await page.evaluate(() => buildShareText())).split('\n').slice(1, 2), ['Easy: solved (2 hints)'], 'text');
    await ctx.close();
  }],
  ['Hard (last puzzle): no Next puzzle button, and the long ladder fits on a small phone', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { tier: 'hard', solved: ['easy', 'medium'] }, 'iPhone SE');
    await page.evaluate(() => localStorage.setItem('letterladder:keyboardEnabled', 'true'));
    await page.reload(); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    await solveActive(page, 'hard');
    await waitModal(page, 22000);
    const m = await modalInfo(page);
    assertEqual([m.buttons, m.rungs[0], m.rungs[m.rungs.length - 1]], [['Share my result', 'Copy text'], '?????????', 'AN'], 'buttons and ladder ends');
    assertEqual(m.layout, { topRow: false, numbers: false, centred: true, sameLeft: true, fits: true }, 'long ladder centred, nothing cut off');
    const fits = await page.$eval('.sm-ladder', el => el.scrollWidth <= el.clientWidth + 1);
    assertEqual(fits, true, 'ladder fits the card width');
    await ctx.close();
  }],
  ['timing: opens ~1.2s after the final word locks in, with the confetti still falling (first puzzle of the day)', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base);
    await page.evaluate(() => {
      const orig = markSolvedIfNeeded; window.markSolvedIfNeeded = markSolvedIfNeeded = function(...a){ if(!window.__wonAt) window.__wonAt = performance.now(); return orig.apply(this, a); };
      new MutationObserver(() => { if(document.querySelector('.sm-scrim') && !window.__modalAt){ window.__modalAt = performance.now(); window.__confettiAtModal = document.querySelectorAll('.confetti-piece').length; } }).observe(document.body, { childList: true });
    });
    await solveActive(page, 'easy'); await waitModal(page, 4000);
    const { ms, confetti } = await page.evaluate(() => ({ ms: Math.round(window.__modalAt - window.__wonAt), confetti: window.__confettiAtModal }));
    console.log(`        measured: modal visible ${ms}ms after the win (Easy, 1st puzzle); ${confetti} confetti pieces still falling`);
    assertEqual([ms >= 1100 && ms <= 1600, confetti > 0], [true, true], `modal ${ms}ms after the win, confetti playing (${confetti} pieces)`);
    await ctx.close();
  }],
  ['timing: third puzzle of the day also ~1.2s; climb runs behind the modal; "completed all three" banner shows after it closes', async ({ browser, base }) => {
    const { ctx, page } = await openGame(browser, base, { tier: 'hard', solved: ['easy', 'medium'] });
    await page.evaluate(() => {
      const orig = markSolvedIfNeeded; window.markSolvedIfNeeded = markSolvedIfNeeded = function(...a){ if(!window.__wonAt) window.__wonAt = performance.now(); return orig.apply(this, a); };
      new MutationObserver(() => {
        if(document.querySelector('.sm-scrim') && !window.__modalAt){ window.__modalAt = performance.now(); window.__climbBehind = !!document.querySelector('.ladder-climb-overlay'); }
        if(document.querySelector('.summit-banner') && document.querySelector('.sm-scrim')) window.__bannerOverModal = true;
        if(document.querySelector('.summit-banner') && !window.__bannerAt) window.__bannerAt = performance.now();
      }).observe(document.body, { childList: true });
    });
    await solveActive(page, 'hard'); await waitModal(page, 4000);
    const t = await page.evaluate(() => ({ ms: Math.round(window.__modalAt - window.__wonAt), climb: window.__climbBehind }));
    console.log(`        measured: modal visible ${t.ms}ms after the win (Hard, 3rd puzzle)`);
    assertEqual([t.ms >= 1100 && t.ms <= 1600, t.climb], [true, true], `modal ${t.ms}ms after the win, ladder climb still playing behind it`);
    assertEqual((await modalInfo(page)).pill, 'HARD', 'Hard result');
    await page.waitForTimeout(7000); // climb finishes while the modal is open
    assertEqual(await page.evaluate(() => [!!window.__bannerAt, !!window.__bannerOverModal]), [false, false], 'banner held while the modal is open');
    await page.click('.sm-close-x');
    await page.waitForSelector('.summit-banner', { timeout: 2000 });
    assertEqual(await page.evaluate(() => !!window.__bannerOverModal), false, 'banner shown after the modal closed, never on top of it');
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
