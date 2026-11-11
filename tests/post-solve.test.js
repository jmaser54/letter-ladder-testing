// Game page: post-solve order ("Missed a day?" always at the bottom), the
// two-line leaderboard result, "Share results", practice mode after Clear on
// a solved puzzle, View solution first click, immediate Clear, load skeleton
// (no footer jump), the dictionary loading after the game is interactive,
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
  const last = [...document.querySelectorAll('#panel a, #panel button')].filter(e => e.offsetParent).pop();
  return { text: a.textContent.trim(), href: a.getAttribute('href'), dotted: getComputedStyle(a).borderBottomStyle,
    belowSolution: a.getBoundingClientRect().top > sol.getBoundingClientRect().bottom,
    belowNext: next ? a.getBoundingClientRect().top > next.getBoundingClientRect().bottom : null, isLast: last === a };
});
// Visible links/buttons in the panel, top to bottom.
const panelOrder = page => page.evaluate(() => [...document.querySelectorAll('#panel a, #panel button, #leaderboard-rank-text, #practice-note')]
  .filter(e => e.offsetParent && !e.closest('.ladder') && !e.closest('.bank-tiles'))
  .map(e => ({ id: e.id || e.className, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom }))
  .sort((a, b) => a.top - b.top));
async function solveEasy(page, words = ['neat', 'tan']){ for(const w of words) await typeWord(page, w); }
async function closeModal(page){ await page.waitForSelector('.sm-scrim', { timeout: 9000 }); await page.click('.sm-close-x'); await page.waitForTimeout(300); }

module.exports = run('Game page post-solve and loading', [
  ['before solving: "Missed a day?" link shows (under View solution, dotted)', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b);
    const l = await linkInfo(page);
    assertEqual([l.text, l.href, l.dotted, l.belowSolution, l.isLast], [LINK_TEXT, 'past-puzzles.html', 'dotted', true, true], 'link');
    await ctx.close();
  }],
  ['after a timed solve: result → View leaderboard → Next puzzle → Share results → Clear → View solution → Missed a day', async ({ browser, base: b }) => {
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await openGame(browser, b, { device, ls: base({ 'letterladder:keyboardEnabled': 'true' }) });
      await solveEasy(page); await closeModal(page);
      await page.waitForFunction(() => /ranked #\d+/.test((document.getElementById('leaderboard-rank-text') || {}).textContent || ''), null, { timeout: 5000 });
      const order = await panelOrder(page);
      assertEqual(order.map(o => o.id), ['leaderboard-rank-text', 'leaderboard-rank-link', 'next-puzzle-btn', 'share-results-link', 'clear-btn', 'solution-link', 'past-puzzles-link'], `order (${device || 'desktop'})`);
      const gap = Math.round(order[1].top - order[0].bottom);
      assertEqual(gap >= 10, true, `breathing room between the result and View leaderboard (${gap}px)`);
      assertEqual((await linkInfo(page)).text, LINK_TEXT, 'missed-a-day text');
      await ctx.close();
    }
  }],
  ['after finishing with View solution (Hard too): same post-solve row', async ({ browser, base: b }) => {
    for(const [tier, hasNext] of [['medium', true], ['hard', false]]){
      const sol = { medium: { 4: 'lean', 5: 'glean', 6: 'angles', 7: 'tangles' }, hard: { 3: 'ran', 4: 'rang', 5: 'grain', 6: 'rating', 7: 'prating', 8: 'pirating' } }[tier];
      const ls = base({ 'letterladder:activeTier': tier, [`letterladder:guest:${DAY}:${tier}`]: JSON.stringify(sol), [`letterladder:guest:${DAY}:${tier}:solutionRevealedAsLoss`]: '1', [`letterladder:guest:${DAY}:${tier}:lossCounted`]: '1' });
      const { ctx, page } = await openGame(browser, b, { ls });
      const l = await linkInfo(page);
      assertEqual([l.text, l.belowNext === null ? 'no next' : 'next'], [LINK_TEXT, hasNext ? 'next' : 'no next'], `${tier} revealed`);
      assertEqual([l.belowSolution, l.isLast], [true, true], `${tier}: link at the very bottom, below View solution`);
      assertEqual(await page.$('#share-results-link').then(Boolean), false, `${tier}: no Share results for a revealed puzzle`);
      await ctx.close();
    }
  }],
  ['timed solve: "Completed in … — ranked #3 on today\'s Easy", View leaderboard on its own line, no "·"', async ({ browser, base: b }) => {
    const docs = {
      'leaderboardEntries/a': { date: DAY, tier: 'easy', timeMs: 100, visible: true, uid: 'x1' },
      'leaderboardEntries/b': { date: DAY, tier: 'easy', timeMs: 200, visible: true, uid: 'x2' },
      'leaderboardEntries/c': { date: DAY, tier: 'easy', timeMs: 300, visible: false, uid: 'x3' },      // hidden: not counted
      'leaderboardEntries/d': { date: DAY, tier: 'medium', timeMs: 50, visible: true, uid: 'x4' },     // other tier
      'leaderboardEntries/e': { date: DAY, tier: 'easy', timeMs: 9999999, visible: true, uid: 'x5' },  // slower
    };
    const { ctx, page } = await openGame(browser, b, { fake: { user: null, docs } });
    await solveEasy(page); await closeModal(page);
    await page.waitForFunction(() => /ranked #\d+/.test((document.getElementById('leaderboard-rank-text') || {}).textContent || ''), null, { timeout: 5000 });
    const r = await page.evaluate(() => ({ text: document.getElementById('leaderboard-rank-text').textContent, block: document.getElementById('leaderboard-rank').textContent, link: document.getElementById('leaderboard-rank-link').textContent, href: document.getElementById('leaderboard-rank-link').getAttribute('href') }));
    assertEqual([/^Completed in [\d.]+s — ranked #3 on today's Easy$/.test(r.text), r.link, r.href, r.block.includes('·')], [true, 'View leaderboard', 'leaderboard.html', false], `rank line "${r.text}"`);
    const st = await page.evaluate(() => { const t = document.getElementById('leaderboard-rank-text'), time = t.querySelector('.leaderboard-rank-time'), cs = getComputedStyle(t);
      return { weight: cs.fontWeight, style: cs.fontStyle, color: cs.color, time: time && time.textContent, timeColor: time && getComputedStyle(time).color, linkWeight: getComputedStyle(document.getElementById('leaderboard-rank-link')).fontWeight }; });
    assertEqual([st.weight, st.style, st.color, /^[\d.]+s$/.test(st.time), st.timeColor, st.linkWeight], ['700', 'italic', 'rgb(245, 239, 224)', true, 'rgb(232, 163, 61)', '400'], 'result line bold italic, time in amber, View leaderboard unchanged');
    await ctx.close();
  }],
  ['result line appears once, complete with the rank - no time-only flash first; a slow query (>2s) shows the time, then the rank', async ({ browser, base: b }) => {
    const docs = { 'leaderboardEntries/a': { date: DAY, tier: 'easy', timeMs: 100, visible: true, uid: 'x1' } };
    for(const [delay, label] of [[700, 'answer in 0.7s'], [3200, 'answer in 3.2s']]){
      const { ctx, page } = await openGame(browser, b, { fake: { user: null, docs } });
      // Record every distinct text the result line shows, from the moment it exists.
      await page.evaluate(d => {
        window.__seen = []; window.__t0 = null;
        new MutationObserver(() => { const el = document.getElementById('leaderboard-rank-text'); if(!el) return; if(window.__t0 === null) window.__t0 = performance.now();
          const t = el.textContent.trim(); if(t && window.__seen[window.__seen.length - 1]?.t !== t) window.__seen.push({ t, at: Math.round(performance.now() - window.__t0) }); }).observe(document.body, { childList: true, subtree: true, characterData: true });
        window.__FAKE_FB.readDelayMs = d;
      }, delay);
      await solveEasy(page); await closeModal(page);
      await page.waitForFunction(() => /ranked #/.test((document.getElementById('leaderboard-rank-text') || {}).textContent || ''), null, { timeout: 8000 });
      const seen = await page.evaluate(() => window.__seen);
      if(delay < 2000){
        assertEqual([seen.length, /^Completed in [\d.]+s — ranked #2 on today's Easy$/.test(seen[0].t)], [1, true], `${label}: shown once, complete: ${JSON.stringify(seen)}`);
      } else {
        assertEqual([seen.length, /^Completed in [\d.]+s$/.test(seen[0].t), seen[0].at >= 1800 && seen[0].at <= 2600, /ranked #2/.test(seen[1].t)], [2, true, true, true], `${label}: time alone at ~2s, then the rank: ${JSON.stringify(seen)}`);
      }
      await ctx.close();
    }
  }],
  ['rank lookup fails: still "Completed in …" with View leaderboard below, never a dangling "·"', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b);
    await solveEasy(page); await closeModal(page);
    await page.evaluate(() => { window.__FAKE_FB.failReads = true; leaderboardRankCache['2026-10-30:easy'] = undefined; render(); });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ text: document.getElementById('leaderboard-rank-text').textContent, block: document.getElementById('leaderboard-rank').textContent }));
    assertEqual([/^Completed in [\d.]+s$/.test(r.text), r.block.includes('View leaderboard'), r.block.includes('·')], [true, true, false], `"${r.block}"`);
    await ctx.close();
  }],
  ['"Share results" reopens the same share modal after it was dismissed', async ({ browser, base: b }) => {
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await openGame(browser, b, { device, ls: base({ 'letterladder:keyboardEnabled': 'true' }) });
      await solveEasy(page);
      await page.waitForSelector('.sm-scrim', { timeout: 9000 });
      const first = await page.evaluate(() => document.querySelector('.sm-modal').innerText);
      await page.click('.sm-close-x'); await page.waitForTimeout(300);
      const link = await page.evaluate(() => { const a = document.getElementById('share-results-link'); const cs = getComputedStyle(a); return { text: a.textContent, color: cs.color, size: cs.fontSize, border: cs.borderBottomStyle, bg: cs.backgroundColor }; });
      assertEqual([link.text, link.color, link.border, link.bg], ['Share results', 'rgb(159, 179, 200)', 'dotted', 'rgba(0, 0, 0, 0)'], 'quiet dim link like View solution');
      if(device) await page.tap('#share-results-link'); else await page.click('#share-results-link');
      await page.waitForSelector('.sm-scrim', { timeout: 2000 });
      assertEqual(await page.evaluate(() => document.querySelector('.sm-modal').innerText), first, `same modal content (${device || 'desktop'})`);
      await ctx.close();
    }
  }],
  ['practice mode: Clear on a solved puzzle locks the time, re-solving changes nothing', async ({ browser, base: b }) => {
    const ls = base({ 'letterladder:accountUsername': 'dad' });
    const { ctx, page } = await openGame(browser, b, { ls, fake: { user: { uid: 'dad', isAnonymous: false }, docs: { 'players/dad': { username: 'dad' } } } });
    await solveEasy(page); await closeModal(page);
    const snap = () => page.evaluate(() => ({
      locked: localStorage.getItem(timerElapsedKey('easy')), stats: JSON.stringify(loadStats()), solved: localStorage.getItem(`letterladder:${accountScope}:${dateKey}:easy:solvedCounted`),
      lbWrites: (window.__FAKE_FB_WRITES || []).filter(w => /^(leaderboardEntries|scores)\//.test(w.path)).length,
      completedEvents: (window.dataLayer || []).filter(e => e && e.event === 'puzzle_completed').length,
      share: buildShareText() }));
    const before = await snap();
    const lockedText = await page.evaluate(() => formatDurationForShare(Number(localStorage.getItem(timerElapsedKey('easy')))));
    await page.click('#clear-btn'); await page.waitForSelector('.confirm-ok'); await page.click('.confirm-ok'); await page.waitForTimeout(200);
    const p = await page.evaluate(() => ({ note: (document.getElementById('practice-note') || {}).textContent, timer: document.querySelector('.timer-display').textContent, lock: !!document.querySelector('#timer-widget svg, .timer-lock'), filled: Object.keys(loadGuesses('easy')).length }));
    assertEqual(p, { note: `Your time for today is locked in at ${lockedText} — this is just practice.`, timer: lockedText, lock: false, filled: 0 }, 'practice note (text only) + locked time, no lock icon');
    await page.waitForTimeout(2200);
    assertEqual(await page.$eval('.timer-display', e => e.textContent), lockedText, 'timer does not run in practice');
    await solveEasy(page, ['ante', 'ant']);   // a different path
    await page.waitForTimeout(6500);           // longer than confetti + modal delay
    assertEqual([await page.$('.sm-scrim').then(Boolean), await page.$('.confetti-piece').then(Boolean)], [false, false], 'no modal or confetti on a practice re-solve');
    const after = await snap();
    assertEqual(after, before, 'time, stats, solved flag, leaderboard writes, analytics and share text all unchanged');
    assertEqual(await page.$eval('#leaderboard-rank-text', (e, t) => e.textContent.startsWith(`Completed in ${t}`), lockedText), true, 'result line shows the locked time');
    await ctx.close();
  }],
  ['timer widget: no lock icon after a solve; same size and position solved and unsolved; clear of the title at 390px', async ({ browser, base: b }) => {
    for(const device of ['iPhone 13', false]){
      const { ctx, page } = await openGame(browser, b, { device });
      if(!device) await page.setViewportSize({ width: 390, height: 844 });
      const box = () => page.evaluate(() => { const w = document.querySelector('.timer-widget-btn').getBoundingClientRect(), em = document.querySelector('.timer-emoji').getBoundingClientRect();
        const r = document.createRange(); r.selectNodeContents(document.querySelector('h1')); const t = r.getBoundingClientRect();
        return { left: Math.round(w.left), width: Math.round(w.width), clear: Math.round(em.left - t.right), icon: !!document.querySelector('#timer-widget svg, .timer-lock') }; });
      const before = await box();
      await solveEasy(page); await closeModal(page);
      const after = await box();
      assertEqual([after.icon, after.left, after.width], [false, before.left, before.width], `no icon; widget unchanged (${device || '390'}): ${JSON.stringify([before, after])}`);
      assertEqual(before.clear >= 12 && after.clear >= 12, true, `clear space from the title (${before.clear}px / ${after.clear}px)`);
      await ctx.close();
    }
  }],
  ['Clear on an unsolved puzzle: words clear, timer keeps running, no practice note', async ({ browser, base: b }) => {
    const { ctx, page } = await openGame(browser, b);
    await typeWord(page, 'neat');
    const t1 = await page.evaluate(() => getCurrentElapsedMs('easy'));
    await page.click('#clear-btn'); await page.waitForSelector('.confirm-ok'); await page.click('.confirm-ok'); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ t: getCurrentElapsedMs('easy'), running: localStorage.getItem(timerStartKey('easy')) !== null, note: !!document.getElementById('practice-note'), lock: !!document.querySelector('.timer-lock'), filled: Object.keys(loadGuesses('easy')).length }));
    assertEqual([r.t > t1 + 1000, r.running, r.note, r.lock, r.filled], [true, true, false, false, 0], 'unchanged behaviour');
    await ctx.close();
  }],
  ['dictionary loads after the game is interactive; a guess made before it arrives is checked once it does', async ({ browser, base: b }) => {
    const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: base(), now: NOW });
    let release; const gate = new Promise(r => release = r);
    await ctx.route(/data\/words\.js/, async route => { await gate; route.continue(); });
    await page.goto(b + '/game.html');
    await page.waitForFunction(() => accountScopeReady === true, null, { timeout: 15000 });
    assertEqual(await page.evaluate(() => typeof WORD_SET), 'undefined', 'game is playable before the dictionary');
    await typeWord(page, 'neat');
    assertEqual(await page.evaluate(() => [document.querySelector('.feedback').textContent.trim(), loadGuesses('easy')[4] || null]), ['Checking word…', null], 'held while checking');
    release(); await page.waitForFunction(() => typeof WORD_SET !== 'undefined'); await page.waitForTimeout(400);
    assertEqual(await page.evaluate(() => loadGuesses('easy')[4] || null), 'neat', 'accepted once the dictionary arrived');
    await page.keyboard.type('nta', { delay: 20 }); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    assertEqual(await page.evaluate(() => document.querySelector('.feedback').textContent.trim()), 'Not a valid English word', 'invalid words are still rejected');
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
