// Past Leaderboards: each difficulty label shows that day's puzzle for that
// tier, as "EASY  (START → FINAL)", taken from data/puzzles.js. Rows (rank,
// name, hints, time) are unchanged.
const { newPage, run, assertEqual } = require('./helpers/harness');
const fs = require('fs'), path = require('path'), vm = require('vm');

// The schedule, read independently of the page.
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'puzzles.js'), 'utf8') + ';this.S = PUZZLE_SCHEDULE;', ctx);
const SCHEDULE = ctx.S;

const NOW = new Date('2026-11-10T12:00:00-05:00');
const DATES = ['2026-11-09', '2026-11-07', '2026-10-24', '2026-07-27'];
const NO_DATA_DATE = '2026-07-01';                 // before launch: no puzzle data
const TIERS = ['easy', 'medium', 'hard'];

let n = 0;
const docs = {};
for(const date of [...DATES, NO_DATA_DATE]) for(const tier of TIERS){
  docs[`leaderboardEntries/e${++n}`] = { date, tier, displayName: `player${n}`, timeMs: 30000 + n * 1000, hintsUsed: n % 2, visible: true, uid: 'u' + n, isGuest: false, createdAt: 1 };
}

const expectedLabel = (date, tier) => {
  const p = SCHEDULE[date] && SCHEDULE[date][tier];
  return tier.toUpperCase() + (p ? `  (${p.start.toUpperCase()} → ${p.final.toUpperCase()})` : '');
};

async function openPage(browser, base, device){
  const { ctx, page } = await newPage(browser, { fake: { user: null, docs }, mobile: device || false, now: NOW });
  await page.goto(base + '/past-leaderboards.html');
  await page.waitForSelector('.score-row', { timeout: 10000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}

// Visible label text (innerText applies the label's uppercase styling).
const labels = (page, date) => page.$$eval(`[id="day-${date}"] .tier-label`, els => els.map(e => e.innerText.trim()));

module.exports = run('Past leaderboards puzzle labels', [
  ['matches the requested example for 2026-11-09', async ({ browser, base }) => {
    const { ctx, page } = await openPage(browser, base);
    assertEqual(await labels(page, '2026-11-09'), ['EASY  (EN → UNWED)', 'MEDIUM  (SIT → UNSPILT)', 'HARD  (DIE → DISCOVERY)'], '2026-11-09 labels');
    await ctx.close();
  }],
  ['every date and tier shows that day\'s puzzle from data/puzzles.js', async ({ browser, base }) => {
    const { ctx, page } = await openPage(browser, base);
    for(const date of DATES){
      assertEqual(await labels(page, date), TIERS.map(t => expectedLabel(date, t)), `${date} labels`);
    }
    await ctx.close();
  }],
  ['a day with no puzzle data shows the plain label', async ({ browser, base }) => {
    const { ctx, page } = await openPage(browser, base);
    assertEqual(await labels(page, NO_DATA_DATE), ['EASY', 'MEDIUM', 'HARD'], `${NO_DATA_DATE} labels`);
    await ctx.close();
  }],
  ['uses a real arrow character, and rows are unchanged', async ({ browser, base }) => {
    const { ctx, page } = await openPage(browser, base);
    const html = await page.$eval('#past-leaderboards-list', el => el.innerHTML);
    assertEqual([html.includes('→'), html.includes('-&gt;'), html.includes('->')], [true, false, false], 'arrow is "→", never "->"');
    const rows = await page.$$eval('[id="day-2026-11-09"] .score-row', rs => rs.map(r => [...r.children].map(c => c.className + '=' + c.textContent.trim())));
    assertEqual(rows.map(r => r.map(c => c.split('=')[0]).join(',')), Array(3).fill('score-rank,score-name,score-hints,score-time'), 'row structure');
    assertEqual(rows.map(r => r[1].split('=')[1]), ['player1', 'player2', 'player3'], 'names in rank order per tier');
    await ctx.close();
  }],
  ['labels fit on one line on phones (Android and iPhone)', async ({ browser, base }) => {
    for(const device of ['Pixel 7', 'iPhone 13']){
      const { ctx, page } = await openPage(browser, base, device);
      // One line is about 1.2x the font size tall; two lines would be about 2.4x.
      const multiLine = await page.$$eval('.tier-label', els => els.filter(e => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).fontSize) * 1.8).map(e => e.innerText));
      assertEqual(multiLine, [], `labels wrapping on ${device}`);
      await ctx.close();
    }
  }],
]).then(failed => process.exit(failed ? 1 : 0));
