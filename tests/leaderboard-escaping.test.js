// Leaderboard pages must show player-supplied values (names, dates) as plain
// text: never as HTML, never running script. Normal entries must keep their
// existing content and layout (rank, name, hints, time; top 3 per tier;
// hidden entries excluded).
const { newPage, run, assertEqual } = require('./helpers/harness');

const TODAY = '2026-10-26';
const NOW = new Date(TODAY + 'T12:00:00-04:00');

const HOSTILE_NAMES = [
  '<img src=x onerror="window.__pwned=1">',
  '<script>window.__pwned=2</script>',
  '"><svg onload=window.__pwned=3>',
  "<b>bold</b><iframe src=javascript:window.__pwned=5></iframe>",
];
const HOSTILE_DATE = '2026-10-19"><img src=x onerror="window.__pwned=4">';

let n = 0;
const entry = (date, tier, displayName, timeMs, hintsUsed = 0, visible = true) =>
  [`leaderboardEntries/e${++n}`, { date, tier, displayName, timeMs, hintsUsed, visible, uid: 'u' + n, isGuest: false, createdAt: 1 }];

function seed(date){
  return Object.fromEntries([
    entry(date, 'easy', 'jmaser', 30000),
    entry(date, 'easy', HOSTILE_NAMES[0], 33000, 1),
    entry(date, 'easy', "Tom & Jerry's", 36000),
    entry(date, 'easy', 'fourth place', 39000),          // beyond top 3: not shown
    entry(date, 'medium', 'Guest', 31000, 1),
    entry(date, 'medium', HOSTILE_NAMES[1], 34000),
    entry(date, 'medium', 'HiddenPlayer', 1000, 0, false), // opted out: not shown
    entry(date, 'hard', 'Word_Nerd-99', 32000),
    entry(date, 'hard', HOSTILE_NAMES[2], 35000, 2),
    entry(date, 'hard', HOSTILE_NAMES[3], 61500),
  ]);
}

// Expected visible rows per tier: [rank, name exactly as typed, hints, time]
const EXPECTED_ROWS = [
  ['Easy', [['1', 'jmaser', '', '30.0s'], ['2', HOSTILE_NAMES[0], '💡', '33.0s'], ['3', "Tom & Jerry's", '', '36.0s']]],
  ['Medium', [['1', 'Guest', '💡', '31.0s'], ['2', HOSTILE_NAMES[1], '', '34.0s']]],
  ['Hard', [['1', 'Word_Nerd-99', '', '32.0s'], ['2', HOSTILE_NAMES[2], '💡💡', '35.0s'], ['3', HOSTILE_NAMES[3], '', '1m 1s']]],
];

async function openPage(browser, base, pageName, docs){
  const { ctx, page } = await newPage(browser, { fake: { user: null, docs }, now: NOW });
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(base + '/' + pageName);
  await page.waitForSelector('.score-row', { timeout: 10000 });
  await page.waitForTimeout(500);
  return { ctx, page, dialogs };
}

// Nothing a player could type may turn into an element or run.
async function assertNothingInjected(page, dialogs, containerSel){
  const injected = await page.$$eval(`${containerSel} img, ${containerSel} script, ${containerSel} svg, ${containerSel} iframe, ${containerSel} b`, els => els.length);
  assertEqual(injected, 0, 'elements created from player text');
  assertEqual(await page.evaluate(() => window.__pwned || null), null, 'injected script ran');
  assertEqual(dialogs, [], 'dialogs opened');
}

async function tierRows(page, cardSel){
  return page.$$eval(`${cardSel} .tier-row`, tiers => tiers.map(t => [
    t.querySelector('.tier-label').textContent.trim(),
    [...t.querySelectorAll('.score-row')].map(r => [...r.children].map(c => c.textContent.trim())),
  ]));
}

module.exports = run('Leaderboard escaping', [
  ['leaderboard.html: hostile names show as literal text and run nothing', async ({ browser, base }) => {
    const { ctx, page, dialogs } = await openPage(browser, base, 'leaderboard.html', seed(TODAY));
    await assertNothingInjected(page, dialogs, '#leaderboard-content');
    assertEqual(await tierRows(page, '#leaderboard-content'), EXPECTED_ROWS, 'rows (rank, name, hints, time)');
    await ctx.close();
  }],
  ['leaderboard.html: normal entries keep their content and markup', async ({ browser, base }) => {
    const docs = Object.fromEntries([entry(TODAY, 'easy', 'jmaser', 30000), entry(TODAY, 'easy', "O'Brien & Co", 45200, 2), entry(TODAY, 'hard', 'Guest', 3725000, 1)]);
    const { ctx, page } = await openPage(browser, base, 'leaderboard.html', docs);
    assertEqual(await tierRows(page, '#leaderboard-content'), [
      ['Easy', [['1', 'jmaser', '', '30.0s'], ['2', "O'Brien & Co", '💡💡', '45.2s']]],
      ['Medium', []],
      ['Hard', [['1', 'Guest', '💡', '1h 2m 5s']]],
    ], 'rows');
    // Each row keeps the same four-column structure and class names.
    const structure = await page.$$eval('#leaderboard-content .score-row', rows => rows.map(r => [...r.children].map(c => c.className).join(',')));
    assertEqual([...new Set(structure)], ['score-rank,score-name,score-hints,score-time'], 'row structure');
    assertEqual(await page.$eval('#leaderboard-content', el => el.textContent.includes('No times posted yet today')), true, 'empty-tier message kept');
    await ctx.close();
  }],
  ['past-leaderboards.html: hostile names and a hostile date show as text and run nothing', async ({ browser, base }) => {
    const docs = { ...seed('2026-10-20'), ...Object.fromEntries([entry(HOSTILE_DATE, 'easy', 'datecase', 1000)]) };
    const { ctx, page, dialogs } = await openPage(browser, base, 'past-leaderboards.html', docs);
    await assertNothingInjected(page, dialogs, '#past-leaderboards-list');
    const cards = await page.$$eval('#past-leaderboards-list .day-card', els => els.map(e => e.id));
    assertEqual(cards, ['day-2026-10-20', 'day-' + HOSTILE_DATE], 'day-card ids hold the date as plain text');
    assertEqual(await tierRows(page, '#day-2026-10-20'), EXPECTED_ROWS, 'rows for 2026-10-20');
    await ctx.close();
  }],
  ['past-leaderboards.html: normal days keep their content, order and markup', async ({ browser, base }) => {
    const docs = Object.fromEntries([
      entry('2026-10-24', 'easy', 'jmaser', 30000), entry('2026-10-25', 'medium', "O'Brien & Co", 45200, 1),
      entry(TODAY, 'easy', 'today is excluded', 1000), entry('2026-10-25', 'hard', 'hidden', 1000, 0, false),
    ]);
    const { ctx, page } = await openPage(browser, base, 'past-leaderboards.html', docs);
    const days = await page.$$eval('#past-leaderboards-list .day-card', els => els.map(e => [e.id, e.querySelector('.day-date').textContent.trim()]));
    // Expected day labels, formatted in the page's own locale.
    const dayLabel = key => page.evaluate(k => {
      const [y, m, d] = k.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }, key);
    assertEqual(days, [['day-2026-10-25', await dayLabel('2026-10-25')], ['day-2026-10-24', await dayLabel('2026-10-24')]], 'days (newest first, today excluded)');
    assertEqual(await tierRows(page, '#day-2026-10-25'), [['Medium', [['1', "O'Brien & Co", '💡', '45.2s']]]], 'rows for 2026-10-25');
    assertEqual(await tierRows(page, '#day-2026-10-24'), [['Easy', [['1', 'jmaser', '', '30.0s']]]], 'rows for 2026-10-24');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
