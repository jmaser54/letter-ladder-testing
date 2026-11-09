// Static, crawlable content: How to Play page, sitemap entry, homepage text,
// Open Graph / Twitter tags, the "Read the full rules" links in both How to
// Play modals, and the homepage "Missed a day?" link with a live count.
const { newPage, run, assertEqual } = require('./helpers/harness');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const raw = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = new Date('2026-11-10T12:00:00-05:00');
const sched = {}; vm.runInNewContext(raw('data/puzzles.js') + ';this.S=PUZZLE_SCHEDULE;', sched);
const PAST_COUNT = Object.keys(sched.S).filter(k => k < '2026-11-10').reduce((n, k) => n + Object.keys(sched.S[k]).length, 0);

const MODAL_TEXT = [
  'Fill in the missing words by adding exactly one letter to the word below. Rearrange the letters as needed to make a new word.',
  'Words can be guessed in any order',
  'Every word must be a real English word',
  'New puzzles drop daily at 12am EST.',
];
function hasSocialTags(html){
  return ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:title', 'twitter:image']
    .filter(t => !html.includes(`"${t}"`)) ;
}
const headOf = html => html.slice(0, html.indexOf('</head>'));

module.exports = run('Static pages', [
  ['how-to-play.html: modal rules text, details and FAQ are in the static HTML', async () => {
    const html = raw('how-to-play.html').replace(/<[^>]+>/g, '');
    for(const t of [...MODAL_TEXT, 'How to Play', 'How do you play Letter Ladder?', 'How is it different from a classic word ladder?', 'How do hints and timing work?', 'up to two hints', 'adds 3 minutes'])
      assertEqual(html.includes(t), true, `contains "${t}"`);
  }],
  ['how-to-play.html: the example ladders are valid by the game\'s rules', async () => {
    const W = new Set(raw('data/words.js').match(/new Set\("([\s\S]*?)"\.split\("/)[1].split('\\n'));
    const count = w => [...w].reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
    const step = (a, b) => b.length === a.length + 1 && W.has(b) && Object.entries(count(a)).every(([c, n]) => (count(b)[c] || 0) >= n);
    for(const ladder of [['cat', 'cart', 'cater'], ['air', 'hair', 'chair', 'chairs', 'cashier', 'archives']])
      for(let i = 1; i < ladder.length; i++) assertEqual(step(ladder[i - 1], ladder[i]), true, `${ladder[i - 1]} → ${ladder[i]}`);
  }],
  ['sitemap.xml lists how-to-play.html; robots.txt untouched', async () => {
    assertEqual(raw('sitemap.xml').includes('<loc>https://letterladder.io/how-to-play.html</loc>'), true, 'sitemap entry');
    assertEqual(raw('robots.txt').includes('Sitemap: https://letterladder.io/sitemap.xml'), true, 'robots.txt still points to the sitemap');
  }],
  ['homepage static HTML has the heading, intro and "Missed a day?" link', async () => {
    const html = raw('index.html');
    assertEqual(html.includes('<h1 class="brand">Letter Ladder</h1>'), true, 'heading');
    assertEqual(html.includes('Add one letter, scramble to a new word, climb to the top.'), true, 'intro');
    assertEqual(html.includes('<a href="past-puzzles.html" class="past-puzzles-link" id="past-puzzles-link">Missed a day? Play past puzzles'), true, 'past puzzles link');
  }],
  ['Open Graph / Twitter tags are in the head of the homepage, How to Play, About and game pages', async () => {
    for(const f of ['index.html', 'how-to-play.html', 'about.html', 'game.html']){
      assertEqual(hasSocialTags(headOf(raw(f))), [], `missing tags in ${f}`);
      assertEqual(headOf(raw(f)).includes('https://letterladder.io/og-image.png'), true, `${f} uses og-image.png`);
    }
  }],
  ['about.html text is static HTML', async () => {
    assertEqual(raw('about.html').includes('<p>All puzzles are crafted by humans.</p>'), true, 'about text');
  }],
  ['how-to-play.html loads in a browser with no errors (desktop and Android)', async ({ browser, base }) => {
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await newPage(browser, { mobile: device });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const res = await page.goto(base + '/how-to-play.html');
      assertEqual([res.status(), await page.textContent('h1'), errors], [200, 'How to Play', []], `load on ${device || 'desktop'}`);
      await ctx.close();
    }
  }],
  ['homepage: "Missed a day?" link sits under Play with the live puzzle count', async ({ browser, base }) => {
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await newPage(browser, { fake: { user: null }, mobile: device, now: NOW });
      await page.goto(base + '/index.html'); await page.waitForTimeout(600);
      const r = await page.evaluate(() => {
        const a = document.getElementById('past-puzzles-link'), p = document.querySelector('.play-buttons');
        return [a.textContent.trim(), a.getAttribute('href'), Math.round(a.getBoundingClientRect().top - p.getBoundingClientRect().bottom)];
      });
      assertEqual([r[0], r[1]], [`Missed a day? Play past puzzles — ${PAST_COUNT} puzzles`, 'past-puzzles.html'], `link on ${device || 'desktop'}`);
      assertEqual(r[2] >= 0 && r[2] <= 20, true, `link directly under the Play button (gap ${r[2]}px)`);
      await ctx.close();
    }
  }],
  ['both How to Play modals link to how-to-play.html', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: { 'letterladder:howToPlaySeen': '1' }, now: NOW });
    await page.goto(base + '/index.html'); await page.waitForTimeout(400);
    await page.click('#howto-btn'); await page.waitForTimeout(300);
    assertEqual(await page.$eval('.howto-card a[href="how-to-play.html"]', a => a.textContent.trim()), 'Read the full rules', 'homepage modal link');
    await page.goto(base + '/game.html'); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    await page.click('#howto-icon-btn'); await page.waitForTimeout(300);
    assertEqual(await page.$eval('.howto-card a[href="how-to-play.html"]', a => a.textContent.trim()), 'Read the full rules', 'game modal link');
    for(const t of MODAL_TEXT) assertEqual((await page.textContent('.howto-card')).includes(t), true, `game modal still says "${t}"`);
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
